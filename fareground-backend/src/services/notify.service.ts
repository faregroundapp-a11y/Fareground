/**
 * Push notifications: what to send, and when.
 *
 * Three messages, in order of how much they are worth:
 *
 *   STREAK_RISK  evening, the streak they have been building ends at midnight
 *   CHEST_READY  morning, the daily chest is waiting
 *   COMEBACK     away for days, their land has been earning the whole time
 *
 * Rules the whole file obeys:
 *
 *   * EVERYTHING is in the player's LOCAL time (users.time_zone). "Evening"
 *     means their evening; "today" means their today.
 *   * Nothing is sent outside 09:00-21:00 local. A game about walking has no
 *     business buzzing at 3am.
 *   * At most ONE of each kind, per person, per local day - guaranteed by the
 *     unique index on notification_sends, not by hoping. The row is claimed
 *     BEFORE the send, so two dispatchers racing produce one notification.
 *   * A person gets at most one notification per run, highest value first, so
 *     a lapsed player with an unclaimed chest is not buzzed twice at once.
 */
import { pool } from '../db/pool';
import { parcelRateSql } from '../game/rules';
import { sendToUsers, type PushMessage } from './push.service';

export type NotificationKind = 'STREAK_RISK' | 'CHEST_READY' | 'COMEBACK' | 'BOOST_ENDED';

/** Quiet hours, in the player's own clock. */
const EARLIEST_HOUR = 9;
const LATEST_HOUR = 21;

/** Never wake more than this many people in one pass. */
const MAX_PER_KIND = 500;

/** Shared by every candidate query: has a live device, wants notifications. */
const CONTACTABLE = `
  u.push_enabled
  AND EXISTS (SELECT 1 FROM push_tokens pt WHERE pt.user_id = u.id AND pt.disabled_at IS NULL)
  AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.time_zone)) >= ${EARLIEST_HOUR}
  AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.time_zone)) < ${LATEST_HOUR}
`;

/** Today, on the player's calendar. */
const LOCAL_DAY = `(NOW() AT TIME ZONE u.time_zone)::date`;
const LOCAL_HOUR = `EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.time_zone))`;

interface Candidate {
  user_id: string;
  local_day: string;
  /** Whatever that kind needs to write a sentence: a streak length, coins. */
  n: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Claim the right to send, then send.
 *
 * The INSERT is the lock. Whoever wins the unique index gets the rows back
 * and does the sending; a second dispatcher gets nothing and does nothing.
 */
async function claimAndSend(
  kind: NotificationKind,
  candidates: Candidate[],
  write: (c: Candidate) => PushMessage,
): Promise<number> {
  if (candidates.length === 0) return 0;

  const claimed = await pool.query<{ user_id: string }>(
    `INSERT INTO notification_sends (user_id, kind, local_day)
     SELECT * FROM UNNEST($1::uuid[], $2::text[], $3::date[])
     ON CONFLICT (user_id, kind, local_day) DO NOTHING
     RETURNING user_id`,
    [
      candidates.map((c) => c.user_id),
      candidates.map(() => kind),
      candidates.map((c) => c.local_day),
    ],
  );
  if (claimed.rowCount === 0) return 0;

  const won = new Set(claimed.rows.map((r) => r.user_id));
  const messages = candidates
    .filter((c) => won.has(c.user_id))
    .map((c) => ({ userId: c.user_id, message: write(c) }));

  return sendToUsers(messages);
}

/**
 * The streak they have been building ends at midnight and the chest is still
 * unclaimed. This is the most valuable notification in the app: it is the one
 * where the player genuinely stands to lose something they earned.
 */
async function streakRisk(exclude: Set<string>): Promise<Candidate[]> {
  const r = await pool.query<Candidate>(
    `SELECT u.id AS user_id, ${LOCAL_DAY} AS local_day, rc.streak AS n
       FROM users u
       JOIN reward_claims rc
         ON rc.user_id = u.id AND rc.source = 'DAILY'
        AND rc.local_day = ${LOCAL_DAY} - 1
      WHERE ${CONTACTABLE}
        AND ${LOCAL_HOUR} >= 18
        AND COALESCE(rc.streak, 0) >= 2
        AND NOT EXISTS (
          SELECT 1 FROM reward_claims t
           WHERE t.user_id = u.id AND t.source = 'DAILY' AND t.local_day = ${LOCAL_DAY}
        )
      LIMIT ${MAX_PER_KIND}`,
  );
  return r.rows.filter((c) => !exclude.has(c.user_id));
}

/** Morning: the chest is sitting there. */
async function chestReady(exclude: Set<string>): Promise<Candidate[]> {
  const r = await pool.query<Candidate>(
    `SELECT u.id AS user_id, ${LOCAL_DAY} AS local_day, 0 AS n
       FROM users u
      WHERE ${CONTACTABLE}
        AND ${LOCAL_HOUR} >= 9 AND ${LOCAL_HOUR} < 12
        AND u.last_active_at > NOW() - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM reward_claims t
           WHERE t.user_id = u.id AND t.source = 'DAILY' AND t.local_day = ${LOCAL_DAY}
        )
      LIMIT ${MAX_PER_KIND}`,
  );
  return r.rows.filter((c) => !exclude.has(c.user_id));
}

/**
 * Away for days. The pitch writes itself, because it is true: the land kept
 * earning the entire time. `n` is an ESTIMATE of the coins waiting - it is
 * read-only and deliberately does not settle anything, because settling moves
 * the income clock and a notification must never change the player's balance.
 */
async function comeback(exclude: Set<string>): Promise<Candidate[]> {
  const r = await pool.query<Candidate>(
    `SELECT u.id AS user_id, ${LOCAL_DAY} AS local_day,
            FLOOR(
              COALESCE((SELECT SUM(${parcelRateSql('p')}) FROM parcels p WHERE p.owner_id = u.id), 0)
              -- the rate is per 30-day month; hours are capped at 60 days
              * LEAST(EXTRACT(EPOCH FROM (NOW() - u.last_coin_claim_at)) / 3600.0, 24 * 60) / 720.0
            )::bigint AS n
       FROM users u
      WHERE ${CONTACTABLE}
        AND ${LOCAL_HOUR} >= 10 AND ${LOCAL_HOUR} < 20
        AND u.last_active_at < NOW() - INTERVAL '3 days'
        AND EXISTS (SELECT 1 FROM parcels p WHERE p.owner_id = u.id)
        AND NOT EXISTS (
          SELECT 1 FROM notification_sends ns
           WHERE ns.user_id = u.id AND ns.kind = 'COMEBACK' AND ns.sent_at > NOW() - INTERVAL '7 days'
        )
      LIMIT ${MAX_PER_KIND}`,
  );
  return r.rows.filter((c) => !exclude.has(c.user_id) && c.n > 0);
}

/**
 * A boost that ran out in the last hour, with nothing running now
 * (2026-10-04). Once a day at most - boosts can be stacked and re-bought, and
 * one nudge is plenty.
 */
async function boostEnded(exclude: Set<string>): Promise<Candidate[]> {
  const r = await pool.query<Candidate>(
    `SELECT u.id AS user_id, ${LOCAL_DAY} AS local_day, 0 AS n
       FROM users u
      WHERE ${CONTACTABLE}
        AND EXISTS (SELECT 1 FROM boosts b WHERE b.user_id = u.id AND b.source = 'AD'
                     AND b.ends_at BETWEEN NOW() - INTERVAL '1 hour' AND NOW())
        AND NOT EXISTS (SELECT 1 FROM boosts b WHERE b.user_id = u.id AND b.ends_at > NOW())
      LIMIT ${MAX_PER_KIND}`,
  );
  return r.rows.filter((c) => !exclude.has(c.user_id));
}

/**
 * SOMEONE RANG YOUR DOORBELL (2026-10-04) - sent the moment it happens, not
 * by the timer. One a day per owner (a busy parcel would otherwise buzz all
 * day), inside the same quiet hours as everything else. Never throws.
 */
export async function notifyDoorbell(stopId: string): Promise<void> {
  try {
    const r = await pool.query<{ user_id: string; local_day: string; visitor: string }>(
      `INSERT INTO notification_sends (user_id, kind, local_day)
       SELECT u.id, 'DOORBELL', ${LOCAL_DAY}
         FROM pit_stops ps
         JOIN users u ON u.id = ps.owner_id
        WHERE ps.id = $1 AND ps.owner_wp > 0 AND ${CONTACTABLE}
       ON CONFLICT DO NOTHING
       RETURNING user_id, local_day,
         (SELECT v.username FROM pit_stops s2 JOIN users v ON v.id = s2.user_id WHERE s2.id = $1) AS visitor`,
      [stopId],
    );
    if (r.rowCount === 0) return;
    const { user_id, visitor } = r.rows[0];
    await sendToUsers([{
      userId: user_id,
      message: {
        title: 'Ding dong! 🔔',
        body: `${visitor} rang your doorbell - you both earned Walk Points.`,
        data: { screen: 'land' },
      },
    }]);
  } catch (e) {
    console.warn('[push] doorbell notification failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * One pass. Safe to call on a timer and safe to run twice at once.
 *
 * Highest-value kind first, and everyone reached is excluded from the rest of
 * the pass - being buzzed three times in one minute is how people turn
 * notifications off for good.
 */
export async function dispatchDueNotifications(): Promise<Record<NotificationKind, number>> {
  const sent: Record<NotificationKind, number> = { STREAK_RISK: 0, CHEST_READY: 0, COMEBACK: 0, BOOST_ENDED: 0 };
  const reached = new Set<string>();

  const take = (rows: Candidate[]) => {
    rows.forEach((c) => reached.add(c.user_id));
    return rows;
  };

  sent.STREAK_RISK = await claimAndSend('STREAK_RISK', take(await streakRisk(reached)), (c) => ({
    title: `Your ${plural(c.n, 'day', 'day')} streak ends tonight`,
    body: "Open Fareground before midnight to keep it - the chest is still waiting.",
    data: { screen: 'daily' },
  }));

  sent.CHEST_READY = await claimAndSend('CHEST_READY', take(await chestReady(reached)), () => ({
    title: "Today's chest is ready",
    body: 'Walk Points waiting, and a longer streak if you collect it.',
    data: { screen: 'daily' },
  }));

  sent.COMEBACK = await claimAndSend('COMEBACK', take(await comeback(reached)), (c) => ({
    title: 'Your land has been busy',
    body: `About ${c.n.toLocaleString('en-GB')} coins have piled up while you were away.`,
    data: { screen: 'map' },
  }));

  sent.BOOST_ENDED = await claimAndSend('BOOST_ENDED', take(await boostEnded(reached)), () => ({
    title: 'Your boost has run out',
    body: 'Your land is back to normal speed. Watch an ad to boost it again.',
    data: { screen: 'map' },
  }));

  return sent;
}

/**
 * Run `dispatchDueNotifications` on a timer, under an advisory lock so that
 * running two server instances does not double-send.
 *
 * Deliberately a plain interval rather than a cron dependency - the same
 * choice the leaderboard settlement made, for the same reason: one less thing
 * to deploy and one less thing to get wrong.
 */
export function startNotificationLoop(everyMs = 5 * 60_000): { stop: () => void } {
  let running = false;

  const tick = async () => {
    if (running) return; // a slow pass must not stack up behind itself
    running = true;
    const client = await pool.connect();
    try {
      const lock = await client.query<{ got: boolean }>(
        `SELECT pg_try_advisory_lock(hashtext('fareground.notify')) AS got`,
      );
      if (!lock.rows[0].got) return;
      try {
        const sent = await dispatchDueNotifications();
        const total = sent.STREAK_RISK + sent.CHEST_READY + sent.COMEBACK + sent.BOOST_ENDED;
        if (total > 0) {
          console.log(
            `[push] sent ${total} (streak ${sent.STREAK_RISK}, chest ${sent.CHEST_READY}, comeback ${sent.COMEBACK})`,
          );
        }
      } finally {
        await client.query(`SELECT pg_advisory_unlock(hashtext('fareground.notify'))`);
      }
    } catch (e) {
      console.warn('[push] dispatch failed:', e instanceof Error ? e.message : e);
    } finally {
      client.release();
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), everyMs);
  timer.unref?.(); // never keep the process alive just for this
  void tick(); // one pass at boot, so a restart does not skip a window

  return { stop: () => clearInterval(timer) };
}
