/**
 * THE WEEKLY SUMMARY on the Walk tab (2026-10-04): the player's last seven
 * local days - steps for each, Walk Points those steps earned, land claimed
 * and doorbells rung. Read-only; nothing here settles or pays anything.
 */
import { query } from '../db/pool';
import { USER_TZ } from '../db/localTime';

export interface WeekSummary {
  /** Oldest first, today last. `day` is YYYY-MM-DD on the player's calendar. */
  days: { day: string; steps: number }[];
  totalSteps: number;
  walkPoints: number;
  parcelsClaimed: number;
  doorbells: number;
  bestDay: { day: string; steps: number } | null;
}

export async function weekSummary(userId: string): Promise<WeekSummary> {
  const today = `(NOW() AT TIME ZONE ${USER_TZ})::date`;
  const since = `((${today} - 6)::timestamp AT TIME ZONE ${USER_TZ})`;
  const [days, totals] = await Promise.all([
    query<{ day: string; steps: number }>(
      `SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
              COALESCE((SELECT SUM(raw_steps) FROM step_logs s
                         WHERE s.user_id = $1
                           AND (s.logged_at AT TIME ZONE ${USER_TZ})::date = d::date), 0)::int AS steps
         FROM generate_series(${today} - 6, ${today}, INTERVAL '1 day') AS d
        ORDER BY d`,
      [userId],
    ),
    query<{ wp: number; parcels: number; doorbells: number }>(
      `SELECT
         COALESCE((SELECT SUM(wp_earned) FROM step_logs WHERE user_id = $1 AND logged_at >= ${since}), 0)::int AS wp,
         (SELECT COUNT(*) FROM parcels WHERE owner_id = $1 AND purchased_at >= ${since})::int AS parcels,
         (SELECT COUNT(*) FROM pit_stops WHERE user_id = $1 AND created_at >= ${since})::int AS doorbells`,
      [userId],
    ),
  ]);
  const list = days.rows.map((r) => ({ day: r.day, steps: Number(r.steps) }));
  const best = list.reduce<{ day: string; steps: number } | null>((b, d) => (d.steps > (b?.steps ?? 0) ? d : b), null);
  return {
    days: list,
    totalSteps: list.reduce((n, d) => n + d.steps, 0),
    walkPoints: totals.rows[0].wp,
    parcelsClaimed: totals.rows[0].parcels,
    doorbells: totals.rows[0].doorbells,
    bestDay: best,
  };
}
