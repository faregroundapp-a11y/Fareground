/**
 * The daily chest and daily quests.
 *
 *   GET  /daily                 today's chest + quests, with progress
 *   POST /daily/claim           open today's chest
 *   POST /daily/quests/:key     collect a finished quest
 *   POST /user/timezone         so "today" is the player's today
 *
 * "Today" is the player's local calendar day (users.time_zone). Changing time
 * zone to get a second "today" is blocked by minimum gaps between claims
 * (DAILY_MIN_GAP_HOURS / QUEST_MIN_GAP_HOURS), and every claim is unique per
 * local day in the database.
 */
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { query, withTransaction } from '../db/pool';
import {
  AD_STREAK_REWARD_WP,
  AD_STREAK_TARGET,
  DAILY_CHEST_WP,
  DAILY_MIN_GAP_HOURS,
  DAILY_QUESTS,
  DOUBLE_WINDOW_HOURS,
  MAX_STREAK_SAVES_PER_WEEK,
  QUEST_MIN_GAP_HOURS,
  STREAK_SAVE_WITHIN_DAYS,
  dailyChestWp,
  type QuestDefinition,
  type QuestMetric,
} from '../game/rules';
import { HttpError } from '../utils/httpError';
import { throttledAmount } from './integrity.service';
import { checkinStatus, type CheckinStatus } from './checkin.service';

/** Anything that can run a query: the pool helper or a transaction's client. */
type Db = { query<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> };

export interface ClaimSummary {
  id: string;
  amount: number;
  doubled: boolean;
  /** Can a "watch an ad to double it" still be used on this reward? */
  canDouble: boolean;
}

export interface DailyStatus {
  today: string;
  daily: {
    available: boolean;
    /** The streak day you are on (the one you would open now, or opened today). */
    streak: number;
    reward: number;
    /** The whole week's chest rewards, for the 7-day strip. */
    week: readonly number[];
    claimedToday: ClaimSummary | null;
  };
  quests: {
    key: string;
    title: string;
    target: number;
    progress: number;
    rewardWp: number;
    ready: boolean;
    claim: ClaimSummary | null;
  }[];
  /** Today's location check-in. */
  checkin: CheckinStatus;
  /** A missed day a rewarded ad could forgive, keeping the streak alive. */
  streakSave: {
    missedDay: string | null;
    savesStreak: number;
    savesLeftThisWeek: number;
  };
  /** Watch a few ads in a day for a bonus chest. */
  adStreak: {
    adsToday: number;
    target: number;
    rewardWp: number;
    ready: boolean;
    claim: ClaimSummary | null;
  };
  /** How many rewards are waiting to be collected right now (for a badge). */
  claimable: number;
}

type ClaimRow = {
  id: string;
  source: 'DAILY' | 'QUEST' | 'CHECKIN' | 'ADSTREAK';
  quest_key: string | null;
  local_day: string;
  amount: number;
  streak: number | null;
  doubled_at: Date | null;
  can_double: boolean;
};

const summary = (r: ClaimRow): ClaimSummary => ({
  id: r.id,
  amount: r.amount,
  doubled: r.doubled_at !== null,
  canDouble: r.can_double,
});

/** Today in the player's zone, plus yesterday, as YYYY-MM-DD strings. */
async function days(client: Db, userId: string) {
  const r = await client.query<{ tz: string; today: string; yesterday: string }>(
    `SELECT time_zone AS tz,
            to_char((NOW() AT TIME ZONE time_zone)::date, 'YYYY-MM-DD') AS today,
            to_char((NOW() AT TIME ZONE time_zone)::date - 1, 'YYYY-MM-DD') AS yesterday
       FROM users WHERE id = $1`,
    [userId],
  );
  if (r.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
  return r.rows[0];
}

async function progressToday(
  client: Db,
  userId: string,
  tz: string,
  today: string,
): Promise<Record<QuestMetric, number>> {
  // Only look back two days so these stay index range scans.
  const r = await client.query<{ steps: number; claims: number; ads: number }>(
    `SELECT
       COALESCE((SELECT SUM(raw_steps) FROM step_logs
                  WHERE user_id = $1 AND logged_at > NOW() - INTERVAL '2 days'
                    AND (logged_at AT TIME ZONE $2)::date = $3::date), 0)::bigint AS steps,
       (SELECT COUNT(*) FROM parcels
         WHERE owner_id = $1 AND purchased_at > NOW() - INTERVAL '2 days'
           AND (purchased_at AT TIME ZONE $2)::date = $3::date)::int AS claims,
       (SELECT COUNT(*) FROM ad_rewards
         WHERE user_id = $1 AND status = 'GRANTED' AND granted_at > NOW() - INTERVAL '2 days'
           AND (granted_at AT TIME ZONE $2)::date = $3::date)::int AS ads`,
    [userId, tz, today],
  );
  const row = r.rows[0];
  return { STEPS: row.steps, CLAIMS: row.claims, ADS: row.ads };
}

async function recentClaims(client: Db, userId: string): Promise<ClaimRow[]> {
  const r = await client.query<ClaimRow>(
    `SELECT id, source, quest_key, to_char(local_day, 'YYYY-MM-DD') AS local_day, amount, streak, doubled_at,
            (doubled_at IS NULL AND created_at > NOW() - ($2 || ' hours')::interval) AS can_double
       FROM reward_claims
      WHERE user_id = $1 AND created_at > NOW() - INTERVAL '8 days'
      ORDER BY created_at DESC`,
    [userId, DOUBLE_WINDOW_HOURS],
  );
  return r.rows;
}

const DAY_MS = 86_400_000;
const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;
const dayString = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** The days between two dates, exclusive of both. */
function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = dayNumber(from) + 1; n < dayNumber(to); n++) out.push(dayString(n));
  return out;
}

/**
 * The streak day the NEXT chest would be.
 *
 * A gap normally resets it to 1 - unless every missed day was forgiven with
 * a "save your streak" ad (streak_saves), in which case the streak carries
 * straight on.
 */
function nextStreak(
  lastDaily: ClaimRow | undefined,
  today: string,
  yesterday: string,
  saved: Set<string> = new Set(),
): number {
  if (!lastDaily) return 1;
  if (lastDaily.local_day === today) return lastDaily.streak ?? 1;
  if (lastDaily.local_day === yesterday) return (lastDaily.streak ?? 0) + 1;
  const missed = daysBetween(lastDaily.local_day, today);
  if (missed.length > 0 && missed.every((d) => saved.has(d))) return (lastDaily.streak ?? 0) + 1;
  return 1;
}

/** Saved days, and how many saves are left this week. */
async function savedDays(client: Db, userId: string) {
  const r = await client.query<{ day: string; recent: number }>(
    `SELECT to_char(for_day, 'YYYY-MM-DD') AS day,
            (SELECT COUNT(*) FROM streak_saves WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days')::int AS recent
       FROM streak_saves WHERE user_id = $1 AND for_day > (NOW() - INTERVAL '400 days')::date`,
    [userId],
  );
  return {
    days: new Set(r.rows.map((x) => x.day)),
    usedThisWeek: r.rows[0]?.recent ?? 0,
  };
}

/**
 * The most recent missed day that an ad could still forgive: inside the
 * window, not already saved, and with a streak worth saving.
 */
function saveableDay(lastDaily: ClaimRow | undefined, today: string, saved: Set<string>): string | null {
  if (!lastDaily || !lastDaily.streak || lastDaily.streak < 1) return null;
  const missed = daysBetween(lastDaily.local_day, today).filter((d) => !saved.has(d));
  if (missed.length === 0) return null;
  // Only worth offering if saving them all is possible within the window.
  const oldest = missed[0];
  if (dayNumber(today) - dayNumber(oldest) > STREAK_SAVE_WITHIN_DAYS) return null;
  return missed[missed.length - 1];
}

export async function dailyStatus(userId: string): Promise<DailyStatus> {
  const client: Db = { query: (text, params) => query(text, params ?? []) };
  const { tz, today, yesterday } = await days(client, userId);
  const [claims, progress, checkin, saves, ads] = await Promise.all([
    recentClaims(client, userId),
    progressToday(client, userId, tz, today),
    checkinStatus(client, userId, today),
    savedDays(client, userId),
    adsToday(client, userId, tz, today),
  ]);

  const lastDaily = claims.find((c) => c.source === 'DAILY');
  const claimedToday = lastDaily && lastDaily.local_day === today ? lastDaily : null;
  const streak = nextStreak(lastDaily, today, yesterday, saves.days);
  const missedDay = saveableDay(lastDaily, today, saves.days);
  const adStreakClaim = claims.find((c) => c.source === 'ADSTREAK' && c.local_day === today) ?? null;

  const quests = DAILY_QUESTS.map((q) => {
    const claim = claims.find((c) => c.source === 'QUEST' && c.quest_key === q.key && c.local_day === today) ?? null;
    const p = Math.min(q.target, progress[q.metric]);
    return {
      key: q.key,
      title: q.title,
      target: q.target,
      progress: p,
      rewardWp: q.rewardWp,
      ready: !claim && p >= q.target,
      claim: claim ? summary(claim) : null,
    };
  });

  const dailyAvailable = !claimedToday;
  return {
    today,
    daily: {
      available: dailyAvailable,
      streak,
      reward: dailyChestWp(streak),
      week: DAILY_CHEST_WP,
      claimedToday: claimedToday ? summary(claimedToday) : null,
    },
    quests,
    checkin,
    streakSave: {
      missedDay: saves.usedThisWeek >= MAX_STREAK_SAVES_PER_WEEK ? null : missedDay,
      savesStreak: (lastDaily?.streak ?? 0) + 1,
      savesLeftThisWeek: Math.max(0, MAX_STREAK_SAVES_PER_WEEK - saves.usedThisWeek),
    },
    adStreak: {
      adsToday: ads,
      target: AD_STREAK_TARGET,
      rewardWp: AD_STREAK_REWARD_WP,
      ready: !adStreakClaim && ads >= AD_STREAK_TARGET,
      claim: adStreakClaim ? summary(adStreakClaim) : null,
    },
    claimable:
      (dailyAvailable ? 1 : 0) +
      (checkin.available ? 1 : 0) +
      (!adStreakClaim && ads >= AD_STREAK_TARGET ? 1 : 0) +
      quests.filter((q) => q.ready).length,
  };
}

/** Rewarded ads watched today, in the player's own day. */
async function adsToday(client: Db, userId: string, tz: string, today: string): Promise<number> {
  const r = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ad_rewards
      WHERE user_id = $1 AND status = 'GRANTED' AND granted_at > NOW() - INTERVAL '2 days'
        AND (granted_at AT TIME ZONE $2)::date = $3::date`,
    [userId, tz, today],
  );
  return r.rows[0].n;
}

/** Collect the bonus chest for watching a few ads today. */
export async function claimAdStreak(userId: string): Promise<ClaimResult> {
  return withTransaction(async (client) => {
    await lockUser(client, userId);
    const { tz, today } = await days(client, userId);
    const ads = await adsToday(client, userId, tz, today);
    if (ads < AD_STREAK_TARGET) {
      throw new HttpError(409, `Watch ${AD_STREAK_TARGET - ads} more to open the bonus chest.`);
    }
    const already = await client.query(
      `SELECT 1 FROM reward_claims WHERE user_id = $1 AND source = 'ADSTREAK' AND local_day = $2::date`,
      [userId, today],
    );
    if ((already.rowCount ?? 0) > 0) throw new HttpError(409, "You've already had today's bonus chest.");

    const streakAmount = await throttledAmount(client, userId, AD_STREAK_REWARD_WP);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reward_claims (user_id, source, local_day, amount) VALUES ($1, 'ADSTREAK', $2::date, $3) RETURNING id`,
      [userId, today, streakAmount],
    );
    const balance = await credit(client, userId, streakAmount);
    return {
      claim: { id: inserted.rows[0].id, amount: streakAmount, doubled: false, canDouble: true },
      walkPointsBalance: balance,
    };
  });
}

/* --------------------------- streak insurance --------------------------- */

/** Check a missed day can still be forgiven. Runs before the ad is shown. */
export async function assertCanSaveStreak(client: PoolClient, userId: string): Promise<string> {
  const { today } = await days(client, userId);
  const claims = await recentClaims(client, userId);
  const saves = await savedDays(client, userId);
  if (saves.usedThisWeek >= MAX_STREAK_SAVES_PER_WEEK) {
    throw new HttpError(429, "That's both streak saves for this week.");
  }
  const day = saveableDay(claims.find((c) => c.source === 'DAILY'), today, saves.days);
  if (!day) throw new HttpError(409, 'There is no broken streak to save.');
  return day;
}

/** Forgive the missed day. Runs inside the reward grant's transaction. */
export async function applyStreakSave(client: PoolClient, userId: string): Promise<number> {
  const day = await assertCanSaveStreak(client, userId);
  const r = await client.query(
    `INSERT INTO streak_saves (user_id, for_day) VALUES ($1, $2::date) ON CONFLICT DO NOTHING`,
    [userId, day],
  );
  if ((r.rowCount ?? 0) === 0) throw new HttpError(409, 'That day was already saved.');
  return 1;
}

async function lockUser(client: PoolClient, userId: string) {
  const r = await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (r.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
}

async function credit(client: PoolClient, userId: string, wp: number): Promise<number> {
  const r = await client.query<{ walk_points_balance: number }>(
    'UPDATE users SET walk_points_balance = walk_points_balance + $2 WHERE id = $1 RETURNING walk_points_balance',
    [userId, wp],
  );
  return r.rows[0].walk_points_balance;
}

export interface ClaimResult {
  claim: ClaimSummary;
  streak?: number;
  walkPointsBalance: number;
}

/** Open today's chest. */
export async function claimDaily(userId: string): Promise<ClaimResult> {
  return withTransaction(async (client) => {
    await lockUser(client, userId);
    const { today, yesterday } = await days(client, userId);
    const last = (
      await client.query<ClaimRow & { hours_ago: number }>(
        `SELECT id, source, quest_key, to_char(local_day, 'YYYY-MM-DD') AS local_day, amount, streak, doubled_at,
                TRUE AS can_double,
                (EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0)::double precision AS hours_ago
           FROM reward_claims WHERE user_id = $1 AND source = 'DAILY'
          ORDER BY created_at DESC LIMIT 1`,
        [userId],
      )
    ).rows[0];

    if (last && last.local_day === today) throw new HttpError(409, "You've already opened today's chest. Come back tomorrow!");
    if (last && last.hours_ago < DAILY_MIN_GAP_HOURS) {
      throw new HttpError(409, 'Your next chest is not ready yet. Come back tomorrow!');
    }

    const saves = await savedDays(client, userId);
    const streak = nextStreak(last, today, yesterday, saves.days);
    const amount = await throttledAmount(client, userId, dailyChestWp(streak));
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reward_claims (user_id, source, local_day, amount, streak)
       VALUES ($1, 'DAILY', $2::date, $3, $4) RETURNING id`,
      [userId, today, amount, streak],
    );
    const balance = await credit(client, userId, amount);
    return {
      claim: { id: inserted.rows[0].id, amount, doubled: false, canDouble: true },
      streak,
      walkPointsBalance: balance,
    };
  });
}

/** Collect a finished quest. */
export async function claimQuest(userId: string, key: string): Promise<ClaimResult> {
  const quest: QuestDefinition | undefined = DAILY_QUESTS.find((q) => q.key === key);
  if (!quest) throw new HttpError(404, 'Unknown quest.');

  return withTransaction(async (client) => {
    await lockUser(client, userId);
    const { tz, today } = await days(client, userId);
    const progress = await progressToday(client, userId, tz, today);
    if (progress[quest.metric] < quest.target) throw new HttpError(409, 'That quest is not finished yet.');

    const recent = await client.query(
      `SELECT 1 FROM reward_claims
        WHERE user_id = $1 AND source = 'QUEST' AND quest_key = $2
          AND (local_day = $3::date OR created_at > NOW() - ($4 || ' hours')::interval)`,
      [userId, key, today, QUEST_MIN_GAP_HOURS],
    );
    if ((recent.rowCount ?? 0) > 0) throw new HttpError(409, 'You already collected that quest today.');

    const questAmount = await throttledAmount(client, userId, quest.rewardWp);


    const inserted = await client.query<{ id: string }>(
      `INSERT INTO reward_claims (user_id, source, quest_key, local_day, amount)
       VALUES ($1, 'QUEST', $2, $3::date, $4) RETURNING id`,
      [userId, key, today, questAmount],
    );
    const balance = await credit(client, userId, questAmount);
    return {
      claim: { id: inserted.rows[0].id, amount: questAmount, doubled: false, canDouble: true },
      walkPointsBalance: balance,
    };
  });
}

/**
 * Check a reward can be doubled by an ad, inside the caller's transaction.
 * Returns the WP the double would pay.
 */
export async function assertDoubleable(client: PoolClient, userId: string, claimId: string): Promise<number> {
  const r = await client.query<{ amount: number; doubled_at: Date | null; fresh: boolean }>(
    `SELECT amount, doubled_at, created_at > NOW() - ($3 || ' hours')::interval AS fresh
       FROM reward_claims WHERE id = $1 AND user_id = $2`,
    [claimId, userId, DOUBLE_WINDOW_HOURS],
  );
  const row = r.rows[0];
  if (!row) throw new HttpError(404, 'Unknown reward.');
  if (row.doubled_at) throw new HttpError(409, 'You already doubled that reward.');
  if (!row.fresh) throw new HttpError(409, 'That reward is too old to double.');
  return row.amount;
}

/** Pay a double: mark the claim doubled and credit its amount again. */
export async function payDouble(client: PoolClient, userId: string, claimId: string): Promise<number> {
  const r = await client.query<{ amount: number }>(
    `UPDATE reward_claims SET doubled_at = NOW()
      WHERE id = $1 AND user_id = $2 AND doubled_at IS NULL
        AND created_at > NOW() - ($3 || ' hours')::interval
      RETURNING amount`,
    [claimId, userId, DOUBLE_WINDOW_HOURS],
  );
  if (r.rowCount === 0) throw new HttpError(409, 'That reward was already doubled.');
  await credit(client, userId, r.rows[0].amount);
  return r.rows[0].amount;
}

/** Remember the player's time zone. Postgres itself validates the name. */
export async function setTimeZone(userId: string, timeZone: string): Promise<{ timeZone: string; today: string }> {
  try {
    await query('SELECT NOW() AT TIME ZONE $1', [timeZone]);
  } catch {
    throw new HttpError(400, 'Unknown time zone.');
  }
  const r = await query<{ today: string }>(
    `UPDATE users SET time_zone = $2 WHERE id = $1
     RETURNING to_char((NOW() AT TIME ZONE time_zone)::date, 'YYYY-MM-DD') AS today`,
    [userId, timeZone],
  );
  if (r.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
  return { timeZone, today: r.rows[0].today };
}
