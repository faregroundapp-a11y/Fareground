/**
 * Treasure boxes: somewhere to walk TO.
 *
 *   GET  /treasure?lat&lng   the boxes waiting for you (spawning one if due)
 *   POST /treasure/:id/open  open one you have reached
 *
 * Two boxes a day are free. Every further box costs a rewarded ad (the
 * EXTRA-box ad is granted first, and this counts how many are owed). Boxes
 * expire, so nobody can bank a pile of them.
 *
 * A box is placed a few hundred metres from where the player is - far enough
 * to be a walk, near enough to be worth it - and can only be opened from
 * within TREASURE_COLLECT_DISTANCE_M, which the server checks.
 */
import { randomInt } from 'node:crypto';
import { query, withTransaction } from '../db/pool';
import {
  TREASURE_COLLECT_DISTANCE_M,
  TREASURE_FREE_PER_DAY,
  TREASURE_MAX_DISTANCE_M,
  TREASURE_MAX_PER_DAY,
  TREASURE_MAX_WP,
  TREASURE_MIN_DISTANCE_M,
  TREASURE_MIN_WP,
  TREASURE_TTL_MINUTES,
} from '../game/rules';
import { HttpError } from '../utils/httpError';
import { throttledAmount } from './integrity.service';

export interface TreasureBox {
  id: string;
  lat: number;
  lng: number;
  rewardWp: number;
  expiresAt: Date;
  fromAd: boolean;
}

export interface TreasureStatus {
  boxes: TreasureBox[];
  /** Boxes opened or waiting today, and how many were free. */
  usedToday: number;
  freePerDay: number;
  maxPerDay: number;
  /** True when the next box needs a rewarded ad. */
  nextNeedsAd: boolean;
  collectWithinM: number;
}

/** Great-circle distance in metres. */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A random point between MIN and MAX metres from here, in any direction. */
function somewhereNear(lat: number, lng: number): { lat: number; lng: number } {
  const bearing = (randomInt(0, 3600) / 3600) * 2 * Math.PI;
  const distance = TREASURE_MIN_DISTANCE_M + randomInt(0, TREASURE_MAX_DISTANCE_M - TREASURE_MIN_DISTANCE_M);
  const dLat = (distance * Math.cos(bearing)) / 111_320;
  const dLng = (distance * Math.sin(bearing)) / (111_320 * Math.cos((lat * Math.PI) / 180) || 1);
  return { lat: lat + dLat, lng: lng + dLng };
}

const rewardWp = () => TREASURE_MIN_WP + randomInt(0, TREASURE_MAX_WP - TREASURE_MIN_WP + 1);

type Counts = { live: number; used_today: number; ad_boxes: number; today: string };

async function counts(userId: string): Promise<Counts> {
  const r = await query<Counts>(
    `SELECT
       (SELECT COUNT(*) FROM treasure_boxes
         WHERE user_id = $1 AND collected_at IS NULL AND expires_at > NOW())::int AS live,
       (SELECT COUNT(*) FROM treasure_boxes
         WHERE user_id = $1 AND local_day = (NOW() AT TIME ZONE u.time_zone)::date)::int AS used_today,
       (SELECT COUNT(*) FROM ad_rewards
         WHERE user_id = $1 AND kind = 'TREASURE' AND status = 'GRANTED'
           AND granted_at > NOW() - INTERVAL '24 hours')::int AS ad_boxes,
       to_char((NOW() AT TIME ZONE u.time_zone)::date, 'YYYY-MM-DD') AS today
     FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (r.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
  return r.rows[0];
}

const allowance = (c: Counts) => Math.min(TREASURE_MAX_PER_DAY, TREASURE_FREE_PER_DAY + c.ad_boxes);

/**
 * Today's boxes. Spawns one near the player when they are owed one and have
 * none waiting - so a box is always there to walk to, without piling up.
 */
export async function treasureStatus(
  userId: string,
  at?: { lat: number; lng: number },
): Promise<TreasureStatus> {
  let c = await counts(userId);

  if (at && c.live === 0 && c.used_today < allowance(c)) {
    const where = somewhereNear(at.lat, at.lng);
    await query(
      `INSERT INTO treasure_boxes (user_id, lat, lng, reward_wp, from_ad, local_day, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6::date, NOW() + ($7 || ' minutes')::interval)`,
      [userId, where.lat, where.lng, rewardWp(), c.used_today >= TREASURE_FREE_PER_DAY, c.today, TREASURE_TTL_MINUTES],
    );
    c = await counts(userId);
  }

  const boxes = await query<{ id: string; lat: number; lng: number; reward_wp: number; expires_at: Date; from_ad: boolean }>(
    `SELECT id, lat, lng, reward_wp, expires_at, from_ad FROM treasure_boxes
      WHERE user_id = $1 AND collected_at IS NULL AND expires_at > NOW()
      ORDER BY created_at`,
    [userId],
  );

  return {
    boxes: boxes.rows.map((b) => ({
      id: b.id,
      lat: b.lat,
      lng: b.lng,
      rewardWp: b.reward_wp,
      expiresAt: b.expires_at,
      fromAd: b.from_ad,
    })),
    usedToday: c.used_today,
    freePerDay: TREASURE_FREE_PER_DAY,
    maxPerDay: TREASURE_MAX_PER_DAY,
    nextNeedsAd: c.used_today >= TREASURE_FREE_PER_DAY,
    collectWithinM: TREASURE_COLLECT_DISTANCE_M,
  };
}

/** Can another box be spawned right now? Used before showing an ad for one. */
export async function assertCanSpawnBox(userId: string): Promise<void> {
  const c = await counts(userId);
  if (c.live > 0) throw new HttpError(409, 'Open the box you already have first.');
  if (c.used_today >= TREASURE_MAX_PER_DAY) {
    throw new HttpError(429, "That's every box for today. More tomorrow!");
  }
}

export interface OpenResult {
  rewardWp: number;
  walkPointsBalance: number;
  /** The reward, so an ad can double it like any other. */
  claim: { id: string; amount: number; doubled: boolean; canDouble: boolean };
}

/** Open a box you have walked to. */
export async function openBox(
  userId: string,
  boxId: string,
  at: { lat: number; lng: number },
): Promise<OpenResult> {
  return withTransaction(async (client) => {
    const r = await client.query<{ lat: number; lng: number; reward_wp: number }>(
      `SELECT lat, lng, reward_wp FROM treasure_boxes
        WHERE id = $1 AND user_id = $2 AND collected_at IS NULL AND expires_at > NOW()
        FOR UPDATE`,
      [boxId, userId],
    );
    const box = r.rows[0];
    if (!box) throw new HttpError(404, 'That box is gone.');

    const away = metresBetween(at.lat, at.lng, box.lat, box.lng);
    if (away > TREASURE_COLLECT_DISTANCE_M) {
      throw new HttpError(422, `You are ${Math.round(away)} m from the box. Get within ${TREASURE_COLLECT_DISTANCE_M} m.`);
    }

    const spent = await client.query('UPDATE treasure_boxes SET collected_at = NOW() WHERE id = $1 AND collected_at IS NULL', [
      boxId,
    ]);
    if ((spent.rowCount ?? 0) === 0) throw new HttpError(409, 'That box was already opened.');

    // Written as a reward_claims row so "watch an ad to double it" works here
    // exactly as it does for the daily chest, quests and visits.
    const boxAmount = await throttledAmount(client, userId, box.reward_wp);

    const claim = await client.query<{ id: string }>(
      `INSERT INTO reward_claims (user_id, source, local_day, amount)
       SELECT $1, 'TREASURE', (NOW() AT TIME ZONE time_zone)::date, $2 FROM users WHERE id = $1
       RETURNING id`,
      [userId, boxAmount],
    );
    await client.query('UPDATE treasure_boxes SET claim_id = $2 WHERE id = $1', [boxId, claim.rows[0].id]);

    const bal = await client.query<{ walk_points_balance: number }>(
      'UPDATE users SET walk_points_balance = walk_points_balance + $2 WHERE id = $1 RETURNING walk_points_balance',
      [userId, boxAmount],
    );
    return {
      rewardWp: box.reward_wp,
      walkPointsBalance: bal.rows[0].walk_points_balance,
      claim: { id: claim.rows[0].id, amount: box.reward_wp, doubled: false, canDouble: true },
    };
  });
}

/** Spawn a box paid for by a rewarded ad. Called from the reward grant. */
export async function spawnAdBox(
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  userId: string,
  at: { lat: number; lng: number } | null,
): Promise<number> {
  // Without a position the ad still counts (see `counts.ad_boxes`), and the
  // box appears the next time the map asks.
  if (!at) return 1;
  const where = somewhereNear(at.lat, at.lng);
  await client.query(
    `INSERT INTO treasure_boxes (user_id, lat, lng, reward_wp, from_ad, local_day, expires_at)
     SELECT $1, $2, $3, $4, TRUE, (NOW() AT TIME ZONE time_zone)::date, NOW() + ($5 || ' minutes')::interval
       FROM users WHERE id = $1`,
    [userId, where.lat, where.lng, rewardWp(), TREASURE_TTL_MINUTES],
  );
  return 1;
}
