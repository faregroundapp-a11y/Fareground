/**
 * Pit stops: stand on claimed land, take Walk Points off it.
 *
 *   GET  /pitstops        what is around you, and when you may stop again
 *   POST /pitstops        stop at a parcel
 *
 * The successor to place-based visits. A visit rewarded "I was in this square
 * of the world"; a pit stop rewards "I stood on THIS parcel", which puts other
 * players' land on your route.
 *
 * THE THREE RULES (see rules.ts for why each exists):
 *   1. Someone else's land pays more than your own.
 *   2. The same parcel pays at most once per 24 hours.
 *   3. Five minutes between stops - a rewarded ad skips the remainder, and
 *      the clock resets to five minutes either way.
 *
 * Rule 3 is enforced under the same `FOR UPDATE` lock on the user row that the
 * reward is paid under. Checking it with a plain SELECT would let two phones
 * on one account both read "cooldown expired" and both collect.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool';
import {
  PIT_STOP_COOLDOWN_SECONDS,
  PIT_STOP_MAX_ACCURACY_M,
  PIT_STOP_PROPERTY_COOLDOWN_HOURS,
  PIT_STOP_REACH_M,
  pitStopWp,
  type ParcelRarity,
} from '../game/rules';
import { cellCenter, cellForLatLng, cellRadius } from '../game/grid';
import { metresBetween } from './parcels.service';
import { spendPitStopAd } from './rewards.service';
import { HttpError } from '../utils/httpError';
import { applyShare, guardAction, payoutShare } from './integrity.service';
import type { ClaimSummary } from './daily.service';

export interface PitStopTarget {
  parcelId: string;
  rarity: ParcelRarity;
  /** Yours, or a neighbour's. Never says WHOSE - see neighbours.service.ts. */
  mine: boolean;
  distanceM: number;
  /** Walk Points this stop would pay right now. */
  wp: number;
  /** You have never stopped here before, so it carries the explorer bonus. */
  firstEver: boolean;
  /** Seconds until this parcel pays again; 0 when it is ready. */
  readyInSeconds: number;
}

export interface PitStopStatus {
  /** Seconds left on the five-minute clock. 0 when you may stop freely. */
  cooldownSeconds: number;
  /** Total seconds the cooldown runs for, so the app can draw a ring. */
  cooldownTotalSeconds: number;
  /** Parcels in reach, nearest first. */
  targets: PitStopTarget[];
  /** How many stops you have made today. */
  today: number;
}

/** Parcels within reach of a position, with everything the app needs to draw them. */
async function targetsAround(
  db: { query: typeof query },
  userId: string,
  lat: number,
  lng: number,
): Promise<PitStopTarget[]> {
  const { cellX, cellY } = cellForLatLng(lat, lng);
  const r = cellRadius(lat, PIT_STOP_REACH_M) + 1;

  const rows = await query<{
    id: string;
    cell_x: number;
    cell_y: number;
    rarity: ParcelRarity;
    mine: boolean;
    last_stop: Date | null;
    ever: boolean;
  }>(
    `SELECT p.id, p.cell_x, p.cell_y, p.rarity, (p.owner_id = $5) AS mine,
            (SELECT MAX(ps.created_at) FROM pit_stops ps
              WHERE ps.user_id = $5 AND ps.parcel_id = p.id) AS last_stop,
            EXISTS (SELECT 1 FROM pit_stops ps2
                     WHERE ps2.user_id = $5 AND ps2.parcel_id = p.id) AS ever
       FROM parcels p
      WHERE p.cell_x BETWEEN $1 AND $2 AND p.cell_y BETWEEN $3 AND $4
      LIMIT 200`,
    [cellX - r, cellX + r, cellY - r, cellY + r, userId],
  );

  const now = Date.now();
  const cooldownMs = PIT_STOP_PROPERTY_COOLDOWN_HOURS * 3600 * 1000;

  return rows.rows
    .map((row) => {
      const centre = cellCenter(row.cell_x, row.cell_y);
      const distanceM = metresBetween(lat, lng, centre.lat, centre.lng);
      const since = row.last_stop ? now - new Date(row.last_stop).getTime() : Infinity;
      const readyInSeconds = since >= cooldownMs ? 0 : Math.ceil((cooldownMs - since) / 1000);
      const firstEver = !row.ever;
      return {
        parcelId: row.id,
        rarity: row.rarity,
        mine: row.mine,
        distanceM: Math.round(distanceM),
        wp: pitStopWp(row.mine, firstEver),
        firstEver,
        readyInSeconds,
      };
    })
    .filter((t) => t.distanceM <= PIT_STOP_REACH_M)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Seconds left on the global clock for this user. */
function cooldownLeft(lastAt: Date | null): number {
  if (!lastAt) return 0;
  const elapsed = (Date.now() - new Date(lastAt).getTime()) / 1000;
  return Math.max(0, Math.ceil(PIT_STOP_COOLDOWN_SECONDS - elapsed));
}

export async function pitStopStatus(userId: string, lat: number, lng: number): Promise<PitStopStatus> {
  const u = await query<{ last_pit_stop_at: Date | null; today: number }>(
    `SELECT u.last_pit_stop_at,
            (SELECT COUNT(*)::int FROM pit_stops ps
              WHERE ps.user_id = u.id
                AND ps.created_at >= (NOW() AT TIME ZONE u.time_zone)::date AT TIME ZONE u.time_zone) AS today
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (u.rowCount === 0) throw new HttpError(401, 'User no longer exists.');

  return {
    cooldownSeconds: cooldownLeft(u.rows[0].last_pit_stop_at),
    cooldownTotalSeconds: PIT_STOP_COOLDOWN_SECONDS,
    targets: await targetsAround({ query }, userId, lat, lng),
    today: u.rows[0].today,
  };
}

export interface PitStopResult {
  claim: ClaimSummary;
  parcelId: string;
  rarity: ParcelRarity;
  mine: boolean;
  firstEver: boolean;
  walkPointsBalance: number;
  /** The clock, freshly reset. */
  cooldownSeconds: number;
}

export async function pitStop(
  userId: string,
  input: { lat: number; lng: number; accuracyM: number; parcelId?: string; mocked?: boolean },
  /** A rewarded-ad ticket, which skips whatever is left of the cooldown. */
  adNonce?: string,
): Promise<PitStopResult> {
  if (input.accuracyM > PIT_STOP_MAX_ACCURACY_M) {
    throw new HttpError(
      422,
      `Your location is only accurate to ${Math.round(input.accuracyM)} m. Step into the open and try again.`,
    );
  }

  return withTransaction(async (client: PoolClient) => {
    // The lock that makes the cooldown real. Everything below runs while this
    // row is held, so a second request waits rather than racing.
    const u = await client.query<{ last_pit_stop_at: Date | null }>(
      'SELECT last_pit_stop_at FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    if (u.rowCount === 0) throw new HttpError(401, 'User no longer exists.');

    // Layer 3, inside the same transaction as the reward.
    await guardAction(client, userId, 'PITSTOP', input);

    const left = cooldownLeft(u.rows[0].last_pit_stop_at);
    if (left > 0 && !adNonce) {
      throw new HttpError(
        429,
        `You are still catching your breath - ${left}s to go, or watch a short ad to go again now.`,
      );
    }

    // Which parcel? The app names one; without that, the nearest in reach.
    const near = await targetsAround({ query }, userId, input.lat, input.lng);
    const target = input.parcelId ? near.find((t) => t.parcelId === input.parcelId) : near[0];
    if (!target) {
      throw new HttpError(404, 'There is no claimed land within reach. Walk onto a parcel and try again.');
    }
    if (target.readyInSeconds > 0) {
      const hours = Math.ceil(target.readyInSeconds / 3600);
      // Refused BEFORE the ad is spent, so the ticket survives for another
      // parcel - the same courtesy the old visit flow extended.
      throw new HttpError(409, `You have already stopped here today. Back in about ${hours}h.`);
    }

    // Only now that the stop will definitely happen is the ad consumed.
    if (left > 0 && adNonce) await spendPitStopAd(client, userId, adNonce);

    const amount = applyShare(
      pitStopWp(target.mine, target.firstEver),
      await payoutShare({ query: client.query.bind(client) as never }, userId),
    );

    const today = await client.query<{ day: string }>(
      `SELECT to_char((NOW() AT TIME ZONE time_zone)::date, 'YYYY-MM-DD') AS day FROM users WHERE id = $1`,
      [userId],
    );

    const claim = await client.query<{ id: string }>(
      `INSERT INTO reward_claims (user_id, source, local_day, amount)
       VALUES ($1, 'PITSTOP', $2::date, $3) RETURNING id`,
      [userId, today.rows[0].day, amount],
    );

    await client.query(
      `INSERT INTO pit_stops (user_id, parcel_id, was_own, first_ever, amount_wp, from_ad, claim_id, accuracy_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [userId, target.parcelId, target.mine, target.firstEver, amount, left > 0, claim.rows[0].id, input.accuracyM],
    );

    const bal = await client.query<{ walk_points_balance: number }>(
      `UPDATE users
          SET walk_points_balance = walk_points_balance + $2,
              last_pit_stop_at = NOW()
        WHERE id = $1
        RETURNING walk_points_balance`,
      [userId, amount],
    );

    return {
      claim: { id: claim.rows[0].id, amount, doubled: false, canDouble: true },
      parcelId: target.parcelId,
      rarity: target.rarity,
      mine: target.mine,
      firstEver: target.firstEver,
      walkPointsBalance: bal.rows[0].walk_points_balance,
      cooldownSeconds: PIT_STOP_COOLDOWN_SECONDS,
    };
  });
}
