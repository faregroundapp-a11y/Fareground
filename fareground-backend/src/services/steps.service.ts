/**
 * POST /steps/sync - turn walked steps into Walk Points.
 *
 * This endpoint is the one an attacker cares about, because it is where value
 * enters the economy. It has three layers of defence:
 *
 *   1. ATTESTATION  - is this our real app on a real phone? (src/security)
 *   2. IDEMPOTENCY  - has this exact sync already been paid out?
 *   3. PLAUSIBILITY - could a human actually have walked this much?
 *   4. INTEGRITY    - would a human have walked it like THAT?
 *
 * Layers 2, 3 and 4 live here. They work identically on iOS and Android and
 * do not depend on layer 1, so they protect you even before attestation is
 * switched on.
 *
 * Layer 4 is the only one that does not change the payout. It writes flags
 * onto the row so that a pattern is visible in the data before any policy is
 * built on it - see STEP_FLAG in rules.ts for why that restraint is
 * deliberate rather than unfinished.
 */
import type { PoolClient } from 'pg';
import { localMidnightSql } from '../db/localTime';
import { withTransaction } from '../db/pool';
import {
  STEPS_PER_WALK_POINT,
  STEP_FLAG,
  STEP_PATTERN_WINDOW,
  DEVICE_SHARING_WINDOW_DAYS,
  MAX_ACCOUNTS_PER_DEVICE,
  UNCORROBORATED_STEPS_PER_DAY,
  describeStepFlags,
  plausibleStepAllowance,
  stepDisplacementVerdict,
  stepPatternFlags,
  stepsUntilNextWalkPoint,
  traceAuthenticityFlags,
  walkPointsForTotalSteps,
  type StepLimitReason,
  type TraceQuality,
} from '../game/rules';
import { applyShare, payoutShare, recordEvent } from './integrity.service';
import { HttpError } from '../utils/httpError';
import { maybeQualifyReferral } from './referral.service';

export type DevicePlatform = 'IOS' | 'ANDROID';

/**
 * Where the count came from, which matters for how much to trust it.
 *
 *   DEVICE_SENSOR   the OS pedometer, live, while the app was open
 *   HEALTH_STORE    Health Connect - a shared store ANY app can write to,
 *                   including a fake-steps app, so it is the weak one
 *   MOTION_HISTORY  iOS CMPedometer history, which only the OS writes
 */
export type StepSource = 'DEVICE_SENSOR' | 'HEALTH_STORE' | 'MOTION_HISTORY' | 'UNKNOWN';

export interface StepSyncInput {
  userId: string;
  /** What the phone claims was walked. */
  rawSteps: number;
  /** Client-generated unique id for this sync, so retries are safe. */
  idempotencyKey?: string;
  platform?: DevicePlatform;
  deviceId?: string;
  /** Whether this request carried a verified attestation. */
  attested?: boolean;
  /** Which counter on the phone produced these steps. */
  source?: StepSource;
  /** Android: did the phone report its last location as mocked? */
  mockedLocation?: boolean;
  /**
   * Ground the phone's own GPS trace covered since the last sync, in metres,
   * or undefined when there was no usable trace (indoors, permission off).
   *
   * THE DIFFERENCE BETWEEN undefined AND 0 IS THE WHOLE POINT. Zero means
   * "the phone watched and nothing moved"; undefined means "the phone could
   * not tell", and those deserve opposite treatment.
   */
  distanceM?: number;
  /**
   * Statistics about the GPS trace itself - does it look like it came from a
   * receiver, or from arithmetic? See traceAuthenticityFlags.
   */
  trace?: TraceQuality;
}

export interface StepSyncResult {
  stepsSubmitted: number;
  stepsAccepted: number;
  stepsRejected: number;
  limit: StepLimitReason;
  wpEarned: number;
  walkPointsBalance: number;
  lifetimeSteps: number;
  stepsUntilNextWalkPoint: number;
  stepsPerWalkPoint: number;
  /** WP paid to whoever invited this player, if they just qualified. */
  referralBonusPaid: number;
  /** True when this was a retry we recognised and did NOT pay out again. */
  replayed: boolean;
}

type StepLogRow = {
  raw_steps: number;
  wp_earned: number;
  rejected_steps: number;
};

/** Remember (or refresh) which phone this account is syncing from. */
async function touchDevice(
  client: PoolClient,
  userId: string,
  platform: DevicePlatform,
  deviceId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO devices (user_id, platform, device_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, device_id)
     DO UPDATE SET last_seen_at = NOW(), platform = EXCLUDED.platform`,
    [userId, platform, deviceId],
  );
}

/**
 * Record a batch of steps and award the Walk Points they are worth.
 *
 * THE SUBTLE BIT - why we work from a LIFETIME step total instead of just
 * doing `Math.floor(rawSteps / 100)` on this one batch:
 *
 *   A phone might sync 60 steps, then 60 more. Per batch that is
 *   floor(60/100) + floor(60/100) = 0 WP, and the player is robbed of the
 *   Walk Point their 120 steps clearly earned. A player syncing once a day
 *   would earn far more than one syncing every few minutes - a nasty,
 *   invisible unfairness.
 *
 *   So instead we ask: how many WP is the player's ENTIRE step history worth,
 *   and how many have we already paid out? The difference is what we owe them
 *   right now. Leftover steps are never lost, they just sit in the total and
 *   count towards the next Walk Point.
 *
 * Everything runs inside one transaction with the user row locked, so two
 * phones syncing at the same moment cannot both read the same "previous total"
 * and double-pay.
 */
export async function syncSteps(input: StepSyncInput): Promise<StepSyncResult> {
  const {
    userId, rawSteps, idempotencyKey, platform, deviceId,
    attested = false, source = 'UNKNOWN', mockedLocation, distanceM, trace,
  } = input;

  return withTransaction(async (client) => {
    // 1. Lock this user's row for the rest of the transaction. Any other
    //    request touching the same user waits here until we commit, which is
    //    what makes every read below safe.
    const userResult = await client.query<{ walk_points_balance: number; created_at: Date; minutes_today: number }>(
      `SELECT walk_points_balance, created_at,
              EXTRACT(EPOCH FROM (NOW() - ${localMidnightSql('time_zone')})) / 60 AS minutes_today
         FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );

    if (userResult.rowCount === 0) {
      throw new HttpError(401, 'User no longer exists.');
    }

    if (platform && deviceId) {
      await touchDevice(client, userId, platform, deviceId);
    }

    // 2. IDEMPOTENCY. If we have already processed this key, replay the
    //    original answer rather than paying out again. Phones retry constantly
    //    on flaky mobile networks; without this, every retry is free money.
    if (idempotencyKey) {
      const existing = await client.query<StepLogRow>(
        `SELECT raw_steps, wp_earned, rejected_steps
           FROM step_logs
          WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, idempotencyKey],
      );

      // rowCount is typed `number | null` by the pg driver, hence the ?? 0.
      if ((existing.rowCount ?? 0) > 0) {
        const row = existing.rows[0];
        const lifetime = await sumLifetimeSteps(client, userId);

        return {
          stepsSubmitted: row.raw_steps + row.rejected_steps,
          stepsAccepted: row.raw_steps,
          stepsRejected: row.rejected_steps,
          limit: row.rejected_steps > 0 ? 'RATE_LIMIT' : 'OK',
          wpEarned: row.wp_earned,
          walkPointsBalance: userResult.rows[0].walk_points_balance,
          lifetimeSteps: lifetime,
          stepsUntilNextWalkPoint: stepsUntilNextWalkPoint(lifetime),
          stepsPerWalkPoint: STEPS_PER_WALK_POINT,
          referralBonusPaid: 0,
          replayed: true,
        };
      }
    }

    // 3. PLAUSIBILITY. Gather the two facts the rule needs.
    const history = await client.query<{
      last_sync: Date | null;
      steps_1h: number;
      steps_24h: number;
    }>(
      `SELECT
         MAX(logged_at) AS last_sync,
         -- The hourly pace check is about the LIVE counter. A health-store
         -- batch in the last hour holds steps walked hours earlier, so
         -- counting it here refused an honest walk right after a Fitbit
         -- upload. Store batches are still in the 24-hour total below.
         COALESCE(SUM(raw_steps) FILTER (WHERE logged_at > NOW() - INTERVAL '1 hour'
                                           AND source IS DISTINCT FROM 'HEALTH_STORE'), 0)::bigint
           AS steps_1h,
         COALESCE(SUM(raw_steps) FILTER (WHERE logged_at > NOW() - INTERVAL '24 hours'), 0)::bigint
           AS steps_24h
       FROM step_logs
       WHERE user_id = $1`,
      [userId],
    );

    // A brand-new account has never synced, so measure from when it was made.
    const lastSync = history.rows[0].last_sync ?? userResult.rows[0].created_at;
    const minutesSinceLastSync = (Date.now() - lastSync.getTime()) / 60_000;

    // A COUNT FROM THE HEALTH STORE IS A DAY TOTAL THAT ARRIVES LATE.
    //
    // Fitbit, Samsung Health and Google Fit write into Health Connect in
    // batches, often hours after the walk. So "time since the last sync" says
    // nothing about when those steps were walked: a sync ten minutes ago, then
    // a Fitbit upload of the whole morning, used to be judged as ten minutes of
    // walking and capped at an hour's pace - and the rest was lost for good.
    // Testers walking 27,000 steps saw 14,000 of them vanish.
    //
    // For a store count the honest window is the player's whole day so far.
    // The rolling 24-hour ceiling (MAX_STEPS_PER_DAY) still bounds it.
    const fromStore = source === 'HEALTH_STORE';
    const minutesToday = Number(userResult.rows[0].minutes_today) || 0;

    const allowance = plausibleStepAllowance({
      requestedSteps: rawSteps,
      minutesSinceLastSync: fromStore ? Math.max(minutesSinceLastSync, minutesToday) : minutesSinceLastSync,
      acceptedStepsInLastHour: history.rows[0].steps_1h,
      acceptedStepsInLast24h: history.rows[0].steps_24h,
    });

    // 4. DID THE GROUND MOVE? The layer that answers a shaken phone.
    //
    //    Steps the GPS trace cannot account for still COUNT - a treadmill and
    //    a shopping centre both produce them honestly - but only up to a
    //    daily allowance. Past that they stop earning. An hour of treadmill
    //    is fully paid; a shaker hits the ceiling and stops.
    //    ONLY FOR THE LIVE COUNTER. The GPS trace covers the minutes the app
    //    was open; a health-store batch holds steps walked with it closed,
    //    hours earlier. Judging those against a trace of the last few minutes
    //    called a whole day's walk "uncorroborated", capped it at 6,000 and
    //    flagged the player - the other half of the lost 14,000.
    const judgedDistance = fromStore ? null : (distanceM ?? null);
    const displacement = stepDisplacementVerdict({
      steps: allowance.accepted,
      distanceM: judgedDistance,
    });

    // THE CAP APPLIES ONLY WHEN THERE WAS A TRACE TO JUDGE BY.
    //
    // This distinction is load-bearing and was got wrong first time. Steps in
    // this game mostly accumulate while the app is CLOSED - you open it to
    // claim, not to walk - and arrive later in one catch-up batch from the
    // health store. There is no trace for that window and there never could
    // be, so capping it would punish the single most ordinary way anyone
    // plays. The e2e suite caught this immediately: an honest 12,000-step
    // offline day was paying half.
    //
    // So: a trace that says "I watched and nothing moved" is evidence and is
    // capped. No trace at all is not evidence, and is not.
    //
    // >> THE GAP THIS LEAVES, STATED PLAINLY <<
    //
    // Shaking a phone with the app CLOSED still reaches the health store
    // untraced and uncapped. That case is left to the pattern checks, which
    // catch it well because a machine produces identical batches and a
    // metronomic cadence, and to attestation once it is real. What is closed
    // here is the cheap, obvious attack: shaking while watching the screen.
    const traced = !fromStore && distanceM !== undefined;
    const uncorroboratedToday = traced
      ? await client.query<{ n: number }>(
          `SELECT COALESCE(SUM(uncorroborated_steps), 0)::int AS n
             FROM step_logs
            WHERE user_id = $1 AND logged_at > NOW() - INTERVAL '24 hours'
              AND distance_m IS NOT NULL`,
          [userId],
        )
      : null;
    const uncorroboratedRoom = uncorroboratedToday
      ? Math.max(0, UNCORROBORATED_STEPS_PER_DAY - uncorroboratedToday.rows[0].n)
      : Number.POSITIVE_INFINITY;
    // Steps that actually earn: everything the ground backs up, plus as much
    // of the rest as the day's allowance still has room for.
    //
    // `creditedUncorroborated` is what gets STORED, not the raw figure. That
    // is what makes the cap real: the daily sum then saturates at the
    // allowance by construction, and the lifetime paying total can never
    // include a step the cap refused. Storing the raw number instead paid
    // out every refused step the moment the next sync arrived - a bug this
    // comment exists to stop anyone reintroducing.
    const creditedUncorroborated = Math.min(displacement.uncorroborated, uncorroboratedRoom);
    const earningSteps = displacement.corroborated + creditedUncorroborated;

    // 4b. Work out the Walk Points owed.
    //
    //     Lifetime totals still drive this (600 + 600 steps must equal 1,200
    //     at once), so the EARNING total is tracked separately from the raw
    //     one: uncorroborated steps beyond the cap are recorded and shown,
    //     they simply do not move the paying total.
    const previousLifetimeSteps = await sumEarningSteps(client, userId);
    const newLifetimeSteps = previousLifetimeSteps + earningSteps;

    const wpBeforeShare =
      walkPointsForTotalSteps(newLifetimeSteps) - walkPointsForTotalSteps(previousLifetimeSteps);

    // 5. THE THROTTLE. An account the score has moved off CLEAR earns a
    //    quarter - never nothing, so a false positive still progresses and a
    //    farmer cannot tell precisely which trick stopped working.
    const share = await payoutShare({ query: client.query.bind(client) as never }, userId);
    const wpEarned = applyShare(wpBeforeShare, share);

    // 4b. INTEGRITY. What the shape of this account's syncs looks like.
    //     Advisory only - it never changes `allowance` above.
    const recent = await client.query<{ steps: number; minutes: number }>(
      `SELECT raw_steps AS steps,
              GREATEST(
                EXTRACT(EPOCH FROM (logged_at - LAG(logged_at) OVER (ORDER BY logged_at))) / 60,
                0
              ) AS minutes
         FROM step_logs
        WHERE user_id = $1
        ORDER BY logged_at DESC
        LIMIT $2`,
      [userId, STEP_PATTERN_WINDOW],
    );

    let flags = stepPatternFlags({
      recent: recent.rows.map((r) => ({ steps: r.steps, minutes: Number(r.minutes) || 0 })),
      steps: allowance.accepted,
      minutes: minutesSinceLastSync,
    });
    if (allowance.rejected > 0) flags |= STEP_FLAG.OVER_LIMIT;
    if (mockedLocation) flags |= STEP_FLAG.MOCKED_LOCATION;
    flags |= displacement.flags;
    // Health Connect is a store any app can write into, so a count sourced
    // from it is weaker evidence than the OS's own pedometer. Not a problem
    // by itself - it is how most honest Android steps arrive - but it is the
    // difference between a hard signal and a soft one when combined.
    if (source === 'HEALTH_STORE') flags |= STEP_FLAG.WRITABLE_SOURCE;

    // Layer 3b: is the track itself receiver-shaped, or drawn?
    if (trace) flags |= traceAuthenticityFlags(trace);

    // Layer 0: UNATTESTED IS DELIBERATELY NOT SET YET.
    //
    // The verifiers are stubs, so every single sync is unattested and the
    // flag would fire on 100% of traffic. A signal that is always on carries
    // no information: it would make `integrity_flags <> 0` meaningless and
    // turn the partial index built for the flagged rows into a full one.
    //
    // Nothing is lost by waiting - `step_logs.attested` already records the
    // same fact in its own column. Turn this on in the same change that
    // makes verifyAttestation real:
    //
    //     if (!attested) flags |= STEP_FLAG.UNATTESTED;
    //
    // ...and give it a weight above 0 in FLAG_WEIGHT at the same time.

    // Layer 4: how many accounts has this phone been used by? A family
    // tablet is two or three; a farm is twenty.
    if (deviceId) {
      const owners = await client.query<{ n: number }>(
        `SELECT COUNT(DISTINCT user_id)::int AS n
           FROM devices
          WHERE device_id = $1
            AND last_seen_at > NOW() - ($2 || ' days')::interval`,
        [deviceId, DEVICE_SHARING_WINDOW_DAYS],
      );
      if (owners.rows[0].n > MAX_ACCOUNTS_PER_DEVICE) flags |= STEP_FLAG.DEVICE_SHARED;
    }

    // 5. Write the audit-trail row. `raw_steps` holds what we accepted;
    //    whatever we refused is kept alongside it as evidence.
    await client.query(
      `INSERT INTO step_logs
         (user_id, raw_steps, wp_earned, rejected_steps, idempotency_key, platform, device_id,
          attested, source, integrity_flags, mocked_location,
          corroborated_steps, uncorroborated_steps, distance_m)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        userId,
        allowance.accepted,
        wpEarned,
        allowance.rejected,
        idempotencyKey ?? null,
        platform ?? null,
        deviceId ?? null,
        attested,
        source,
        flags,
        mockedLocation ?? null,
        displacement.corroborated,
        creditedUncorroborated,
        // A store batch was never judged against the trace, so it is stored
        // as untraced: otherwise its steps would fill the daily
        // uncorroborated allowance and cap the player's next LIVE walk.
        judgedDistance,
      ],
    );

    // A flag that only counts the SOFT signals is noise: almost every Android
    // sync sets WRITABLE_SOURCE. Only the ones that say something about
    // behaviour go on the account's running total.
    const hardFlags =
      flags &
      (STEP_FLAG.IDENTICAL_BATCHES |
        STEP_FLAG.ROBOTIC_CADENCE |
        STEP_FLAG.MOCKED_LOCATION |
        STEP_FLAG.NO_DISPLACEMENT);
    if (hardFlags !== 0) {
      await client.query('UPDATE users SET step_flag_count = step_flag_count + 1 WHERE id = $1', [userId]);
      console.warn(
        `[steps] ${userId} flagged: ${describeStepFlags(flags).join(', ')} ` +
        `(${allowance.accepted} steps over ${minutesSinceLastSync.toFixed(1)} min, source ${source})`,
      );
    }

    // Feed the score. Only the behavioural flags carry weight; the event log
    // is what a human would read months later if this is ever appealed.
    await recordEvent(
      { query: client.query.bind(client) as never },
      userId,
      'STEPS',
      flags,
      {
        steps: allowance.accepted,
        minutes: Number(minutesSinceLastSync.toFixed(1)),
        distanceM: distanceM ?? null,
        corroborated: displacement.corroborated,
        // The raw figure goes in the evidence log even though the credited
        // one is what is stored, so a reviewer can see what was refused.
        uncorroborated: displacement.uncorroborated,
        credited: creditedUncorroborated,
        source,
        ...(trace ? { trace } : {}),
      },
    );

    // 6. Credit the balance. We add in SQL (`= balance + $2`) rather than
    //    computing the new number in JavaScript and overwriting - the database
    //    is the one place that always holds the current truth.
    const updated = await client.query<{ walk_points_balance: number }>(
      `UPDATE users
          SET walk_points_balance = walk_points_balance + $2
        WHERE id = $1
        RETURNING walk_points_balance`,
      [userId, wpEarned],
    );

    // Walking enough pays back whoever invited this player.
    const referralBonusPaid = await maybeQualifyReferral(client, userId, newLifetimeSteps, deviceId);

    return {
      stepsSubmitted: rawSteps,
      stepsAccepted: allowance.accepted,
      stepsRejected: allowance.rejected,
      limit: allowance.reason,
      wpEarned,
      walkPointsBalance: updated.rows[0].walk_points_balance,
      lifetimeSteps: newLifetimeSteps,
      stepsUntilNextWalkPoint: stepsUntilNextWalkPoint(newLifetimeSteps),
      stepsPerWalkPoint: STEPS_PER_WALK_POINT,
      referralBonusPaid,
      replayed: false,
    };
  });
}

/** Total accepted steps this account has ever logged. */
async function sumLifetimeSteps(client: PoolClient, userId: string): Promise<number> {
  const result = await client.query<{ lifetime_steps: number }>(
    'SELECT COALESCE(SUM(raw_steps), 0)::bigint AS lifetime_steps FROM step_logs WHERE user_id = $1',
    [userId],
  );
  return result.rows[0].lifetime_steps;
}

/**
 * Total steps this account has ever been PAID for.
 *
 * Separate from the raw lifetime total because uncorroborated steps past the
 * daily allowance are still recorded - they show in the player's count and in
 * the evidence log - but must not move the paying total, or the cap would
 * only delay the payout rather than withhold it.
 *
 * Rows written before migration 023 have both columns at 0, so they fall back
 * to raw_steps: an existing player's history is not retroactively unpaid.
 */
async function sumEarningSteps(client: PoolClient, userId: string): Promise<number> {
  const result = await client.query<{ steps: number }>(
    `SELECT COALESCE(SUM(
              CASE WHEN corroborated_steps = 0 AND uncorroborated_steps = 0
                   THEN raw_steps
                   ELSE LEAST(raw_steps, corroborated_steps + uncorroborated_steps)
              END
            ), 0)::bigint AS steps
       FROM step_logs WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0].steps;
}
