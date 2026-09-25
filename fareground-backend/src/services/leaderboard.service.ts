/**
 * Weekly step leaderboards, by area, with land-boost prizes for the top 3.
 *
 *   GET  /leaderboard?scope=CITY|REGION|COUNTRY|WORLD
 *   POST /user/area   { city, region, country }  (the phone names the area)
 *
 * PRIZES WITHOUT A CRON JOB. The first request after a week ends (any
 * leaderboard view or balance check) settles that week: it works out the top
 * 3 of every board, gives each winner their best prize as a boost, and
 * records the week as settled. An advisory lock plus the leaderboard_weeks
 * row make that happen exactly once, however many requests race for it.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool';
import {
  LEADERBOARD_MIN_WALKERS,
  LEADERBOARD_PAGE,
  LEADERBOARD_PRIZES,
  betterPrize,
  weekStart,
  type LeaderboardScope,
  type PrizeTier,
} from '../game/rules';
import { photoUrl } from './photo.service';
import { HttpError } from '../utils/httpError';

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** SQL for "which area a user row belongs to", per board. */
const AREA: Record<LeaderboardScope, { keys: string; name: string; present: string }> = {
  CITY: {
    keys: 'u.area_country, u.area_region, u.area_city',
    name: `u.area_city || COALESCE(', ' || u.area_region, '')`,
    present: 'u.area_city IS NOT NULL AND u.area_country IS NOT NULL',
  },
  REGION: {
    keys: 'u.area_country, u.area_region',
    name: `u.area_region || ', ' || u.area_country`,
    present: 'u.area_region IS NOT NULL AND u.area_country IS NOT NULL',
  },
  COUNTRY: { keys: 'u.area_country', name: 'u.area_country', present: 'u.area_country IS NOT NULL' },
  WORLD: { keys: `'world'`, name: `'World'`, present: 'TRUE' },
};

export interface LeaderboardEntry {
  rank: number;
  username: string;
  steps: number;
  you: boolean;
  jerseyColor: string;
  /** Uploaded picture, or null to fall back to the initial. */
  photoUrl: string | null;
  /** Their character, so the board shows faces rather than initials. */
  avatar: Record<string, string>;
  title: string | null;
}

export interface LeaderboardResult {
  scope: LeaderboardScope;
  /** e.g. "Camden, England" - null if we do not know your area yet. */
  areaName: string | null;
  week: { start: string; endsAt: string };
  entries: LeaderboardEntry[];
  me: { rank: number | null; steps: number };
  walkers: number;
  /** Does this board have enough walkers to pay prizes? */
  prizesActive: boolean;
  minWalkers: number;
  prizes: readonly PrizeTier[];
  /** What you won last week, if anything. */
  lastWeek: { scope: LeaderboardScope; areaName: string; rank: number; multiplier: number; seconds: number } | null;
}

/* ------------------------------ your area ------------------------------ */

const clean = (s: unknown): string | null => {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim().slice(0, 80);
  return t.length > 0 ? t : null;
};

export async function setArea(userId: string, area: { city?: string; region?: string; country?: string }) {
  const country = clean(area.country);
  if (!country) throw new HttpError(400, 'A country is needed.');
  const r = await query<{ area_city: string | null; area_region: string | null; area_country: string }>(
    `UPDATE users SET area_city = $2, area_region = $3, area_country = $4, area_updated_at = NOW()
      WHERE id = $1 RETURNING area_city, area_region, area_country`,
    [userId, clean(area.city), clean(area.region), country],
  );
  if (r.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
  const row = r.rows[0];
  return { city: row.area_city, region: row.area_region, country: row.area_country };
}

/* ------------------------------ the board ------------------------------ */

export async function leaderboard(userId: string, scope: LeaderboardScope): Promise<LeaderboardResult> {
  await settleFinishedWeek();

  const start = weekStart(new Date());
  const end = new Date(start.getTime() + 7 * DAY_MS);
  const a = AREA[scope];

  const meRow = await query<{
    area_country: string | null; area_region: string | null; area_city: string | null; area_name: string | null; present: boolean;
  }>(
    `SELECT u.area_country, u.area_region, u.area_city, ${a.name} AS area_name, (${a.present}) AS present
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (meRow.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
  const me = meRow.rows[0];

  const base = {
    scope,
    week: { start: isoDay(start), endsAt: end.toISOString() },
    minWalkers: LEADERBOARD_MIN_WALKERS,
    prizes: LEADERBOARD_PRIZES,
    lastWeek: await lastWeekAward(userId, start),
  };

  // No area yet (the phone has not told us): only the world board works.
  if (!me.present) {
    return { ...base, areaName: null, entries: [], me: { rank: null, steps: 0 }, walkers: 0, prizesActive: false };
  }

  // Everyone in the same area as me, ranked by steps this week. Ties go to
  // whoever reached the total first.
  const sameArea: Record<LeaderboardScope, string> = {
    CITY: 'u.area_country = me.area_country AND u.area_region IS NOT DISTINCT FROM me.area_region AND u.area_city = me.area_city',
    REGION: 'u.area_country = me.area_country AND u.area_region = me.area_region',
    COUNTRY: 'u.area_country = me.area_country',
    WORLD: 'TRUE',
  };
  const rows = await query<{
    user_id: string; username: string; jersey_color: string; avatar: Record<string, string> | null; photo_path: string | null;
    title: string | null; steps: number; rn: number; walkers: number;
  }>(
    `WITH me AS (SELECT area_country, area_region, area_city FROM users WHERE id = $3),
     totals AS (
       SELECT s.user_id, SUM(s.raw_steps)::bigint AS steps, MAX(s.logged_at) AS last
         FROM step_logs s
        WHERE s.logged_at >= $1 AND s.logged_at < $2 AND s.raw_steps > 0
        GROUP BY s.user_id
     ),
     ranked AS (
       SELECT t.user_id, u.username, u.jersey_color, u.avatar, u.photo_path, u.title, t.steps,
              ROW_NUMBER() OVER (ORDER BY t.steps DESC, t.last ASC)::int AS rn,
              COUNT(*) OVER ()::int AS walkers
         FROM totals t
         JOIN users u ON u.id = t.user_id
         CROSS JOIN me
        WHERE ${sameArea[scope]}
     )
     SELECT * FROM ranked WHERE rn <= $4 OR user_id = $3
     ORDER BY rn`,
    [start, end, userId, LEADERBOARD_PAGE],
  );

  const walkers = rows.rows[0]?.walkers ?? 0;
  const mine = rows.rows.find((r) => r.user_id === userId);
  return {
    ...base,
    areaName: me.area_name,
    entries: rows.rows
      .filter((r) => r.rn <= LEADERBOARD_PAGE)
      .map((r) => ({
        rank: r.rn,
        username: r.username,
        steps: r.steps,
        you: r.user_id === userId,
        jerseyColor: r.jersey_color,
        photoUrl: photoUrl(r.photo_path),
        avatar: r.avatar ?? {},
        title: r.title,
      })),
    me: { rank: mine?.rn ?? null, steps: mine?.steps ?? 0 },
    walkers,
    prizesActive: walkers >= LEADERBOARD_MIN_WALKERS,
  };
}

async function lastWeekAward(userId: string, thisWeek: Date) {
  const last = new Date(thisWeek.getTime() - 7 * DAY_MS);
  const r = await query<{ scope: LeaderboardScope; area_name: string; rank: number; multiplier: number; seconds: number }>(
    `SELECT scope, area_name, rank, multiplier, seconds FROM leaderboard_awards
      WHERE user_id = $1 AND week_start = $2::date`,
    [userId, isoDay(last)],
  );
  const a = r.rows[0];
  return a ? { scope: a.scope, areaName: a.area_name, rank: a.rank, multiplier: a.multiplier, seconds: a.seconds } : null;
}

/* ------------------------------ settlement ------------------------------ */

/** Weeks already settled, so balance checks do not hit the database each time. */
let settledThrough: string | null = null;

/**
 * Pay out the week that just finished, once. Safe to call on every request:
 * after the first success it is a string comparison.
 */
export async function settleFinishedWeek(now = new Date()): Promise<void> {
  const last = new Date(weekStart(now).getTime() - 7 * DAY_MS);
  const key = isoDay(last);
  if (settledThrough === key) return;

  await withTransaction(async (client) => {
    // One settler at a time; everyone else waits, then sees it done.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('fareground.leaderboard'))`);
    const done = await client.query('SELECT 1 FROM leaderboard_weeks WHERE week_start = $1::date', [key]);
    if ((done.rowCount ?? 0) > 0) return;
    await payPrizes(client, last, new Date(last.getTime() + 7 * DAY_MS));
    await client.query('INSERT INTO leaderboard_weeks (week_start) VALUES ($1::date)', [key]);
  });
  settledThrough = key;
}

async function payPrizes(client: PoolClient, start: Date, end: Date): Promise<void> {
  type Winner = { user_id: string; steps: number; rn: number; area_name: string };
  const best = new Map<string, { scope: LeaderboardScope; w: Winner; prize: PrizeTier }>();

  for (const scope of ['CITY', 'REGION', 'COUNTRY', 'WORLD'] as const) {
    const a = AREA[scope];
    const r = await client.query<Winner>(
      `WITH totals AS (
         SELECT user_id, SUM(raw_steps)::bigint AS steps, MAX(logged_at) AS last
           FROM step_logs
          WHERE logged_at >= $1 AND logged_at < $2 AND raw_steps > 0
          GROUP BY user_id
       ),
       ranked AS (
         SELECT t.user_id, t.steps, ${a.name} AS area_name,
                ROW_NUMBER() OVER (PARTITION BY ${a.keys} ORDER BY t.steps DESC, t.last ASC)::int AS rn,
                COUNT(*) OVER (PARTITION BY ${a.keys})::int AS walkers
           FROM totals t JOIN users u ON u.id = t.user_id
          WHERE ${a.present}
       )
       SELECT user_id, steps, rn, area_name FROM ranked WHERE rn <= 3 AND walkers >= $3`,
      [start, end, LEADERBOARD_MIN_WALKERS],
    );
    for (const w of r.rows) {
      const prize = LEADERBOARD_PRIZES[w.rn - 1];
      const current = best.get(w.user_id);
      if (!current || betterPrize(prize, current.prize)) best.set(w.user_id, { scope, w, prize });
    }
  }

  const week = isoDay(start);
  for (const [userId, { scope, w, prize }] of best) {
    const boost = await client.query<{ id: string }>(
      `INSERT INTO boosts (user_id, starts_at, ends_at, multiplier, source)
       VALUES ($1, NOW(), NOW() + ($2 || ' seconds')::interval, $3, 'PRIZE') RETURNING id`,
      [userId, prize.seconds, prize.multiplier],
    );
    await client.query(
      `INSERT INTO leaderboard_awards (week_start, user_id, scope, area_name, rank, steps, multiplier, seconds, boost_id)
       VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (week_start, user_id) DO NOTHING`,
      [week, userId, scope, w.area_name, w.rn, w.steps, prize.multiplier, prize.seconds, boost.rows[0].id],
    );
  }
  if (best.size > 0) console.log(`[leaderboard] week ${week}: ${best.size} prize boost(s) awarded`);
}

/** For tests: forget the in-memory "already settled" note. */
export function resetSettlementCache(): void {
  settledThrough = null;
}
