/**
 * Anti-spoofing: the layers that sit outside the step-sync path.
 *
 * WHAT THIS IS DEFENDING AGAINST, and why it takes more than one check:
 *
 *   SHAKING A PHONE produces a textbook step signal. The accelerometer sees
 *   regular oscillation at walking frequency and the pedometer counts it.
 *   Nothing about the step COUNT can reveal it - only the fact that the
 *   ground did not move (layer 2, in rules.ts).
 *
 *   FAKING GPS defeats layer 2, because a spoofer can supply displacement to
 *   match. But a spoofed track has to be physically coherent over time, and
 *   most are not: they teleport, they move at impossible speeds, or they are
 *   suspiciously free of the noise every real receiver produces (layer 3).
 *
 *   ROOTING THE PHONE hides `isMock`, so that flag is a hint and never a
 *   verdict. What root cannot hide is being in two places at once, because
 *   that is computed from positions the SERVER saw.
 *
 * Every one of these has an innocent explanation - a treadmill, a tunnel, a
 * developer with mock locations on, a passenger on a train. So no single
 * signal does anything on its own. They accumulate into a score, and the
 * score throttles quietly long before a human is ever asked to look.
 *
 * NOTHING HERE BANS ANYONE. The only irreversible action needs a person.
 */
import type { PoolClient } from 'pg';
import { pool, query } from '../db/pool';
import {
  INTEGRITY_SCORE_WINDOW_DAYS,
  STEP_FLAG,
  TRACK_USABLE_ACCURACY_M,
  describeStepFlags,
  flagScore,
  integrityTier,
  payoutMultiplier,
  travelVerdict,
  applyShare as applyShareFn,
  type IntegrityTier,
} from '../game/rules';
import { metresBetween } from './parcels.service';

/** Anything that can run a query: the pool helper or a transaction's client. */
type Db = { query: typeof query };

export type IntegrityAction = 'STEPS' | 'CLAIM' | 'PITSTOP' | 'CHECKIN' | 'TREASURE';

export interface PositionReport {
  lat: number;
  lng: number;
  accuracyM: number;
  /** The phone's own "this fix is mocked" bit, when it offered one. */
  mocked?: boolean;
}

/**
 * Check a position against the last one we believed, and remember it.
 *
 * THE ONE CHECK ROOT CANNOT DEFEAT. Both endpoints were reported to the
 * server at times the server recorded, so the implied speed is ours to
 * compute and nothing on the device can change it.
 *
 * Returns the flags raised. Deliberately does NOT throw: a teleport is
 * evidence, not grounds to refuse an action, because the commonest cause of
 * one is a phone that lost GPS in a tunnel and re-acquired it forty miles
 * later on a train.
 */
export async function checkAndRecordPosition(
  db: Db,
  userId: string,
  action: IntegrityAction,
  at: PositionReport,
): Promise<number> {
  let flags = 0;
  if (at.mocked) flags |= STEP_FLAG.MOCKED_LOCATION;

  const previous = await db.query<{ lat: number | null; lng: number | null; at: Date | null }>(
    'SELECT last_fix_lat AS lat, last_fix_lng AS lng, last_fix_at AS at FROM users WHERE id = $1',
    [userId],
  );

  const row = previous.rows[0];
  let detail: Record<string, unknown> = { action, accuracyM: at.accuracyM };

  if (row?.lat != null && row.lng != null && row.at) {
    const metres = metresBetween(row.lat, row.lng, at.lat, at.lng);
    const seconds = (Date.now() - new Date(row.at).getTime()) / 1000;
    const verdict = travelVerdict({ metres, seconds });
    if (verdict.impossible) {
      flags |= STEP_FLAG.TELEPORT;
      detail = { ...detail, metres: Math.round(metres), seconds: Math.round(seconds), speedMps: verdict.speedMps };
    }
  }

  // Only a fix we can trust becomes the new reference point. A 500 m
  // accuracy reading would otherwise poison the next comparison and
  // manufacture a teleport out of ordinary drift.
  if (at.accuracyM <= TRACK_USABLE_ACCURACY_M) {
    await db.query(
      'UPDATE users SET last_fix_lat = $2, last_fix_lng = $3, last_fix_at = NOW() WHERE id = $1',
      [userId, at.lat, at.lng],
    );
  }

  if (flags !== 0) await recordEvent(db, userId, action, flags, detail);
  return flags;
}

/**
 * Write one flagged event and move the account's running score.
 *
 * The event log is append-only: it is what an appeal would be decided from,
 * so nothing in the system edits or deletes a row after the fact.
 */
export async function recordEvent(
  db: Db,
  userId: string,
  action: IntegrityAction,
  flags: number,
  detail?: Record<string, unknown>,
): Promise<void> {
  if (flags === 0) return;
  const score = flagScore(flags);

  await db.query(
    'INSERT INTO integrity_events (user_id, action, flags, score, detail) VALUES ($1, $2, $3, $4, $5)',
    [userId, action, flags, score, detail ? JSON.stringify(detail) : null],
  );

  if (score > 0) {
    console.warn(
      `[integrity] ${userId} ${action}: ${describeStepFlags(flags).join(', ')} (+${score})` +
        (detail ? ` ${JSON.stringify(detail)}` : ''),
    );
    await refreshScore(db, userId);
  }
}

/**
 * Recompute the score from the last fortnight and set the tier.
 *
 * A ROLLING WINDOW, NOT A LIFETIME TOTAL. An account that tripped something
 * last spring and has walked honestly since is clear, and should be: the
 * point is to find what is happening now, not to keep a permanent record
 * against somebody. It also means a throttle lifts by itself once the
 * behaviour stops, with no appeal needed for the commonest false positives.
 */
export async function refreshScore(db: Db, userId: string): Promise<void> {
  const r = await db.query<{ total: number; exempt: boolean }>(
    `SELECT COALESCE((
              SELECT SUM(score)::int FROM integrity_events
               WHERE user_id = $1 AND created_at > NOW() - ($2 || ' days')::interval
            ), 0) AS total,
            (SELECT integrity_exempt FROM users WHERE id = $1) AS exempt`,
    [userId, INTEGRITY_SCORE_WINDOW_DAYS],
  );
  const total = r.rows[0]?.total ?? 0;
  // A human has vouched for this account: keep scoring it so the evidence
  // keeps accruing, but never let the tier move.
  const tier: IntegrityTier = r.rows[0]?.exempt ? 'CLEAR' : integrityTier(total);

  await db.query('UPDATE users SET integrity_score = $2, integrity_tier = $3 WHERE id = $1', [
    userId,
    total,
    tier,
  ]);
}

/**
 * What share of a reward this account actually receives.
 *
 * THROTTLED pays a quarter, not zero. A player who suddenly earns nothing
 * knows precisely which trick stopped working and iterates until it works
 * again; one who earns a little assumes the game is mean and drifts away.
 * It also means an honest player caught by a false positive keeps
 * progressing - slowly - instead of hitting a silent wall.
 */
export async function payoutShare(db: Db, userId: string): Promise<number> {
  const r = await db.query<{ tier: IntegrityTier }>(
    'SELECT integrity_tier AS tier FROM users WHERE id = $1',
    [userId],
  );
  return payoutMultiplier(r.rows[0]?.tier ?? 'CLEAR');
}

/** Re-exported so callers take the rule and the plumbing from one place. */
export { applyShare } from '../game/rules';

/**
 * THE ONE PLACE A REWARD IS SIZED. Every faucet must go through this.
 *
 * Take an amount and return what this account actually gets, after its
 * integrity tier. Call it ONCE per reward, before writing the reward_claims
 * row - not just before crediting the balance - or a "double it" ad would
 * pay out the un-throttled figure and undo the whole thing.
 *
 * >> WHY THIS EXISTS AS A HELPER RATHER THAN EIGHT CALL SITES <<
 *
 * It was eight call sites, and five of them were missed. A throttled account
 * could still farm the daily chest, quests, treasure, the ad-streak chest,
 * referrals and bonus-WP ads at the full rate - which is most of the ways WP
 * enters the game. The throttle looked like it worked because the three
 * paths I happened to test were the three I had wired.
 *
 * If you are adding a new way to earn Walk Points, it goes through here.
 */
export async function throttledAmount(
  db: Db | PoolClient,
  userId: string,
  amount: number,
): Promise<number> {
  const q = typeof (db as PoolClient).query === 'function'
    ? ({ query: (db as PoolClient).query.bind(db) } as Db)
    : (db as Db);
  return applyShareFn(amount, await payoutShare(q, userId));
}

/**
 * Was this action reachable from where we last saw them?
 *
 * Used by claiming, pit stops and check-ins - the three places where a
 * position turns directly into value. Takes the transaction's client so the
 * check runs inside the same transaction as the reward.
 */
export async function guardAction(
  client: PoolClient,
  userId: string,
  action: IntegrityAction,
  at: PositionReport,
): Promise<number> {
  return checkAndRecordPosition({ query: client.query.bind(client) as typeof query }, userId, action, at);
}

/** The accounts a human should look at, worst first. */
export async function reviewQueue(limit = 50) {
  const r = await pool.query(
    `SELECT u.id, u.username, u.email, u.integrity_score, u.integrity_tier, u.integrity_reviewed_at,
            (SELECT COUNT(*)::int FROM integrity_events e
              WHERE e.user_id = u.id AND e.created_at > NOW() - ($2 || ' days')::interval) AS events
       FROM users u
      WHERE u.integrity_tier <> 'CLEAR' AND NOT u.integrity_exempt
      ORDER BY u.integrity_score DESC
      LIMIT $1`,
    [limit, INTEGRITY_SCORE_WINDOW_DAYS],
  );
  return r.rows;
}
