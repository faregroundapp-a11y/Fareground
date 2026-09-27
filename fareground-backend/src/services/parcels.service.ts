/**
 * Parcels on the map.
 *
 *   POST /parcels/claim    spend WP to claim a free square within reach (price rises with land held)
 *   GET  /parcels/nearby   every claimed square around a position, for the map
 *   GET  /parcels          the squares you own
 */
import { config } from '../config/env';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool';
import {
  PARCEL_MAX_UPGRADE,
  SCOUT_CLAIM_DISTANCE_M,
  parcelCoinsPerMonth,
  parcelPriceWp,
  parcelUpgradeCostWp,
  rollParcelRarity,
  type ParcelRarity,
} from '../game/rules';
import { cellCenter, cellForLatLng, cellRadius, cellRef } from '../game/grid';
import { settleCoinIncome } from './user.service';
import { HttpError } from '../utils/httpError';
import { checkAndRecordPosition } from './integrity.service';
import { spendGateAd } from './rewards.service';

/**
 * The worst GPS accuracy we accept for a claim, in metres.
 *
 * A parcel is roughly 9 m across. With a fix worse than about three parcels,
 * the phone genuinely does not know which square you are on, and we would be
 * handing out land at random. The honest answer is "move somewhere with a
 * clearer sky and try again".
 */
export const MAX_CLAIM_ACCURACY_M = 25;

/** Largest area the map may ask about in one go. */
export const MAX_NEARBY_RADIUS_M = 500;

/**
 * How far from the player a claimed square's centre may be, in metres.
 *
 * Originally you could only claim the exact square under your feet. In
 * practice that barely worked: a square is ~9 m across, GPS wanders by about
 * that much, and the square you are USUALLY standing on (home) is the one you
 * already own. So a claim may now target any free square within reach.
 *
 * The phone shows a slightly smaller reach (35 m) than the server allows, so a
 * few metres of drift between tapping a square and the request arriving never
 * turns a valid claim into a refusal.
 */
export const MAX_CLAIM_DISTANCE_M = 40;

/** Great-circle distance between two points, in metres. */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface Parcel {
  id: string;
  rarity: ParcelRarity;
  /** What it earns now: its mineral plus any upgrades. */
  coinsPerMonth: number;
  /** The mineral's own rate, before upgrades. */
  baseCoinsPerMonth: number;
  upgradeLevel: number;
  maxUpgradeLevel: number;
  /** Walk Points for the next upgrade, or null when fully upgraded. */
  nextUpgradeCostWp: number | null;
  cellX: number | null;
  cellY: number | null;
  cellRef: string | null;
  purchasedAt: Date;
}

export interface ClaimParcelResult {
  parcel: Parcel;
  walkPointsSpent: number;
  walkPointsBalance: number;
  /** What the parcel after this one will cost. */
  nextParcelPrice: number;
}

export interface NearbyParcel {
  /**
   * The parcel's own id, so tapping a square on the map can ring its
   * doorbell without a second lookup. An opaque uuid identifies the PLOT,
   * never the person - the owner stays anonymous either way.
   */
  id: string;
  cellX: number;
  cellY: number;
  rarity: ParcelRarity;
  /** Whether it is yours. Nobody else's identity is ever sent. */
  mine: boolean;
}

type ParcelRow = {
  id: string;
  rarity: ParcelRarity;
  coins_per_month: number;
  upgrade_level: number;
  cell_x: number | null;
  cell_y: number | null;
  purchased_at: Date;
};

function toParcel(row: ParcelRow): Parcel {
  const level = row.upgrade_level ?? 0;
  return {
    id: row.id,
    rarity: row.rarity,
    coinsPerMonth: parcelCoinsPerMonth(row.coins_per_month, level),
    // NUMERIC arrives from node-pg as a string.
    baseCoinsPerMonth: Number(row.coins_per_month),
    upgradeLevel: level,
    maxUpgradeLevel: PARCEL_MAX_UPGRADE,
    nextUpgradeCostWp: level >= PARCEL_MAX_UPGRADE ? null : parcelUpgradeCostWp(level),
    cellX: row.cell_x,
    cellY: row.cell_y,
    cellRef: row.cell_x === null || row.cell_y === null ? null : cellRef(row.cell_x, row.cell_y),
    purchasedAt: row.purchased_at,
  };
}

/** PostgreSQL error code 23505 = "unique_violation". */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}

/**
 * Claim a square within reach of the player.
 *
 * Four things can stop a claim, and each is enforced where it cannot be
 * raced:
 *
 *   1. Not enough Walk Points - a single conditional UPDATE, exactly as before.
 *   2. Someone already owns it - the unique index on (cell_x, cell_y). We look
 *      first so the player gets a clear message, but the index is the real
 *      guard: if two people claim the same square at the same instant, one
 *      INSERT fails, and its transaction rolls back INCLUDING the Walk Points
 *      it deducted. Nobody pays for land they did not get.
 *   3. The GPS fix is too vague to trust where they are.
 *   4. The target square is out of reach of where they are standing.
 *
 * The client may name the square it wants (`target`) - the server still
 * decides whether it is close enough. With no target, it is the square under
 * the reported position.
 */
export async function claimParcel(
  userId: string,
  position: { lat: number; lng: number; accuracyM: number; mocked?: boolean },
  target?: { cellX: number; cellY: number },
  /** The CLAIM ad paying for this parcel. Required when AD_GATES is on. */
  adNonce?: string,
): Promise<ClaimParcelResult> {
  if (config.adGates === 'on' && !adNonce) {
    throw new HttpError(402, 'Watch an ad to claim this parcel.');
  }
  if (position.accuracyM > MAX_CLAIM_ACCURACY_M) {
    throw new HttpError(
      422,
      `Your location is only accurate to ${Math.round(position.accuracyM)} m, and a parcel is ` +
        `about 9 m across. Step outside or away from tall buildings and try again.`,
    );
  }

  const { cellX, cellY } = target ?? cellForLatLng(position.lat, position.lng);

  // Scouting (a rewarded ad) widens the reach for a few minutes.
  const scouting = await query<{ scouting: boolean }>(
    'SELECT scout_until > NOW() AS scouting FROM users WHERE id = $1',
    [userId],
  );
  const reach = scouting.rows[0]?.scouting ? SCOUT_CLAIM_DISTANCE_M : MAX_CLAIM_DISTANCE_M;

  const centre = cellCenter(cellX, cellY);
  const distance = metresBetween(position.lat, position.lng, centre.lat, centre.lng);
  if (distance > reach) {
    throw new HttpError(
      422,
      `That parcel is ${Math.round(distance)} m away. Walk within ${reach} m of it to claim it.`,
    );
  }

  // Layer 3: could they have GOT here from where we last saw them? Records a
  // teleport and moves the score; deliberately does not refuse the claim,
  // because losing GPS in a tunnel and re-acquiring it on a moving train
  // looks identical and is not cheating.
  await checkAndRecordPosition({ query }, userId, 'CLAIM', position);

  try {
    return await withTransaction(async (client) => {
      // 0. Settle income before the new parcel exists, so it is not paid for
      //    time before it was claimed. Also takes the user-row lock, which
      //    makes the parcel count - and so the price - safe to rely on.
      const settled = await settleCoinIncome(client, userId);
      const price = parcelPriceWp(settled.totalParcels);

      // 1. Friendly early check. NOT the real guard - see the unique index.
      const taken = await client.query<{ mine: boolean }>(
        'SELECT owner_id = $3 AS mine FROM parcels WHERE cell_x = $1 AND cell_y = $2',
        [cellX, cellY, userId],
      );
      if ((taken.rowCount ?? 0) > 0) {
        throw new HttpError(
          409,
          taken.rows[0].mine ? 'You already own this parcel.' : 'Someone else already owns this parcel.',
        );
      }

      // 1b. The claim ad. Spent in this transaction, so a claim that fails
      //     below (not enough WP, the square taken a moment ago) rolls back
      //     and the player keeps the ad for their next try.
      if (adNonce && !(await spendGateAd(client, userId, 'CLAIM', adNonce))) {
        throw new HttpError(402, 'That ad has already been used. Watch another to claim.');
      }

      // 2. Atomic check-and-deduct.
      const deduction = await client.query<{ walk_points_balance: number }>(
        `UPDATE users
            SET walk_points_balance = walk_points_balance - $2
          WHERE id = $1 AND walk_points_balance >= $2
          RETURNING walk_points_balance`,
        [userId, price],
      );

      if (deduction.rowCount === 0) {
        const current = await client.query<{ walk_points_balance: number }>(
          'SELECT walk_points_balance FROM users WHERE id = $1',
          [userId],
        );
        if (current.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
        throw new HttpError(
          400,
          `Not enough Walk Points. Your next parcel costs ${price} WP ` +
            `but you only have ${current.rows[0].walk_points_balance} WP.`,
        );
      }

      // 3. Roll the mineral and plant the flag.
      // Dev-only testing hook: listed accounts always find a Ruby.
      let lucky = false;
      if (config.devLuckyEmails.length > 0) {
        const who = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [userId]);
        lucky = config.devLuckyEmails.includes(who.rows[0]?.email ?? '');
      }
      const drop = rollParcelRarity({ forceBest: lucky });
      const inserted = await client.query<ParcelRow>(
        `INSERT INTO parcels
           (owner_id, rarity, coins_per_month, cell_x, cell_y,
            claimed_lat, claimed_lng, claimed_accuracy_m)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, rarity, coins_per_month::float8 AS coins_per_month, upgrade_level, cell_x, cell_y, purchased_at`,
        [
          userId, drop.rarity, drop.coinsPerMonth, cellX, cellY,
          position.lat, position.lng, position.accuracyM,
        ],
      );

      return {
        parcel: toParcel(inserted.rows[0]),
        walkPointsSpent: price,
        walkPointsBalance: deduction.rows[0].walk_points_balance,
        nextParcelPrice: parcelPriceWp(settled.totalParcels + 1),
      };
    });
  } catch (error) {
    // Lost a same-instant race for this square. The transaction has already
    // rolled back, so the Walk Points were never spent.
    if (isUniqueViolation(error)) {
      throw new HttpError(409, 'Someone else claimed this parcel a moment before you.');
    }
    throw error;
  }
}

/**
 * Every claimed square around a position.
 *
 * Deliberately returns NO owner identity for other players' land - only that
 * it is taken and what it is. Showing names on a map of where people walk
 * every day is a stalking tool, however it is meant.
 */
export async function nearbyParcels(
  userId: string,
  centre: { lat: number; lng: number; radiusM: number },
): Promise<NearbyParcel[]> {
  const { cellX, cellY } = cellForLatLng(centre.lat, centre.lng);
  const r = cellRadius(centre.lat, Math.min(centre.radiusM, MAX_NEARBY_RADIUS_M));

  const result = await query<{ id: string; cell_x: number; cell_y: number; rarity: ParcelRarity; mine: boolean }>(
    `SELECT id, cell_x, cell_y, rarity, owner_id = $5 AS mine
       FROM parcels
      WHERE cell_x BETWEEN $1 AND $2
        AND cell_y BETWEEN $3 AND $4
      LIMIT 5000`,
    [cellX - r, cellX + r, cellY - r, cellY + r, userId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    cellX: row.cell_x,
    cellY: row.cell_y,
    rarity: row.rarity,
    mine: row.mine,
  }));
}

/** Everything this player owns, newest first. */
export async function myParcels(userId: string): Promise<Parcel[]> {
  const result = await query<ParcelRow>(
    `SELECT id, rarity, coins_per_month::float8 AS coins_per_month, upgrade_level, cell_x, cell_y, purchased_at
       FROM parcels
      WHERE owner_id = $1
      ORDER BY purchased_at DESC`,
    [userId],
  );
  return result.rows.map(toParcel);
}

/* ----------------------------- upgrades ----------------------------- */

export interface UpgradeInfo {
  parcelId: string;
  level: number;
  costWp: number;
}

/**
 * Check a parcel can be upgraded right now: it is yours, not fully upgraded,
 * and you can afford the Walk Points. Called before showing the ad, so nobody
 * watches one for nothing.
 */
export async function assertCanUpgrade(
  client: PoolClient,
  userId: string,
  parcelId: string,
): Promise<UpgradeInfo> {
  const r = await client.query<{ upgrade_level: number; walk_points_balance: number }>(
    `SELECT p.upgrade_level, u.walk_points_balance
       FROM parcels p JOIN users u ON u.id = $1
      WHERE p.id = $2 AND p.owner_id = $1`,
    [userId, parcelId],
  );
  const row = r.rows[0];
  if (!row) throw new HttpError(404, 'That parcel is not yours.');
  if (row.upgrade_level >= PARCEL_MAX_UPGRADE) throw new HttpError(409, 'That parcel is fully upgraded.');

  const costWp = parcelUpgradeCostWp(row.upgrade_level);
  if (row.walk_points_balance < costWp) {
    throw new HttpError(400, `Upgrading costs ${costWp} WP and you have ${row.walk_points_balance} WP.`);
  }
  return { parcelId, level: row.upgrade_level + 1, costWp };
}

/**
 * Pay for an upgrade: spend the Walk Points and raise the level by one.
 * Runs inside the reward grant's transaction, after its ad was verified.
 */
export async function applyUpgrade(
  client: PoolClient,
  userId: string,
  parcelId: string,
): Promise<UpgradeInfo> {
  const info = await assertCanUpgrade(client, userId, parcelId);

  const paid = await client.query(
    `UPDATE users SET walk_points_balance = walk_points_balance - $2
      WHERE id = $1 AND walk_points_balance >= $2`,
    [userId, info.costWp],
  );
  if ((paid.rowCount ?? 0) === 0) throw new HttpError(400, 'Not enough Walk Points.');

  const raised = await client.query(
    `UPDATE parcels SET upgrade_level = upgrade_level + 1
      WHERE id = $1 AND owner_id = $2 AND upgrade_level = $3`,
    [parcelId, userId, info.level - 1],
  );
  if ((raised.rowCount ?? 0) === 0) throw new HttpError(409, 'That parcel changed - try again.');
  return info;
}
