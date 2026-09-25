/**
 * GET /user/balance - "lazy evaluation" of passive coin income.
 */
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool';
import {
  MIN_REDEMPTION_COINS,
  STEPS_PER_WALK_POINT,
  canRedeem,
  coinsPerHourToUsdPerSecond,
  formatCoinsAsUsd,
  microCoinsFor,
  parcelPriceWp,
  splitMicroCoins,
} from '../game/rules';
import { HttpError } from '../utils/httpError';
import { settleFinishedWeek } from './leaderboard.service';
import { unseenBadgeCount } from './profile.service';
import { rewardStatus, type RewardStatus } from './rewards.service';
import { photoUrl } from './photo.service';

export interface BalanceResult {
  walkPoints: number;
  coins: number;
  totalParcels: number;
  /** Base income from land, before any boost. */
  coinsPerHour: number;
  /** What land is earning right now, boost included. */
  effectiveCoinsPerHour: number;
  /** How many coins this particular call just credited. Nice for a UI pop-up. */
  coinsJustEarned: number;
  /** The moment income is now paid up to. */
  lastCoinClaimAt: Date;

  /** What the next parcel costs, and how many steps make a Walk Point. */
  parcelPrice: number;
  stepsPerWalkPoint: number;

  /** Boost and rewarded-ad state, for the boost button and the timer. */
  rewards: RewardStatus;

  /**
   * Dollar value of the balance, as a STRING and for display only.
   * Integer `coins` above is the authoritative number - money is never stored
   * or compared as a float. See COIN_REDEMPTION_USD in game/rules.ts.
   */
  redeemableUsd: string;
  /** Earning rate shown the way Atlas Earth shows it. Display only. */
  usdPerSecond: number;
  /** Coins needed before a payout can be requested, and whether we are there. */
  minRedemptionCoins: number;
  canRedeem: boolean;
}

/**
 * ===========================================================================
 *  LAZY EVALUATION
 * ===========================================================================
 *  We do NOT run a background job every hour handing coins to a million
 *  players. We do nothing until something needs an up-to-date balance, then
 *  work out what was earned since last time:
 *
 *      micro-coins = coins/hour x (seconds elapsed + boosted seconds x (multiplier - 1))
 *                    x 1,000,000 / 3600
 *
 *  WHY MICRO-COINS. Coins are whole numbers, and a player with one ROCKY
 *  parcel (1 coin/hour) checking every 5 minutes earns 0.083 coins a time.
 *  Rounding that down and resetting the clock would pay them NOTHING, ever.
 *  So the fraction is kept: `coin_remainder_micro` carries the part-coin
 *  forward, and only whole coins are credited. The clock can then always move
 *  to NOW(), which is what lets the rate change over time (boosts) while
 *  staying exact. Checking often is neither a reward nor a punishment.
 *
 *  (The previous design moved the clock forward by "the time actually paid
 *  for". That only works for a constant rate, and it let a brand-new parcel
 *  share in the unpaid minutes. Neither problem exists now.)
 *
 *  Callers MUST wrap this in a transaction - see getBalanceWithLazyEvaluation.
 *  `claimParcel` calls it inside ITS transaction before adding the parcel,
 *  so a new parcel is never paid for time before it existed.
 */
export async function settleCoinIncome(
  client: PoolClient,
  userId: string,
): Promise<BalanceResult> {
  // Lock the user row FIRST. Without this, two simultaneous requests could
  // both read the same old clock and both pay out for it.
  const locked = await client.query<{
    walk_points_balance: number;
    coin_balance: number;
    coin_remainder_micro: number;
    last_coin_claim_at: Date;
    now: Date;
  }>(
    `SELECT walk_points_balance, coin_balance, coin_remainder_micro, last_coin_claim_at, NOW() AS now
       FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  if (locked.rowCount === 0) {
    throw new HttpError(401, 'User no longer exists.');
  }
  const user = locked.rows[0];
  const paidFrom = user.last_coin_claim_at;

  // What the land produces, and how much of the window was boosted. Boost
  // windows never overlap (they are stacked end to end), so a plain SUM of
  // each window's overlap with [paidFrom, NOW] is exact.
  const facts = await client.query<{
    coins_per_hour: number;
    parcel_count: number;
    elapsed_s: number;
    boosted_extra_s: number;
    boosted_s: number;
  }>(
    `SELECT
       (SELECT COALESCE(SUM(coins_per_hour + upgrade_level), 0)::bigint FROM parcels WHERE owner_id = $1) AS coins_per_hour,
       (SELECT COUNT(*)::bigint FROM parcels WHERE owner_id = $1)                        AS parcel_count,
       GREATEST(EXTRACT(EPOCH FROM ($3::timestamptz - $2::timestamptz)), 0)::double precision AS elapsed_s,
       COALESCE((
         SELECT SUM(GREATEST(EXTRACT(EPOCH FROM (LEAST(b.ends_at, $3) - GREATEST(b.starts_at, $2))), 0)
                    * (b.multiplier - 1))
           FROM boosts b
          WHERE b.user_id = $1 AND b.ends_at > $2 AND b.starts_at < $3
       ), 0)::double precision AS boosted_extra_s,
       COALESCE((
         SELECT SUM(GREATEST(EXTRACT(EPOCH FROM (LEAST(b.ends_at, $3) - GREATEST(b.starts_at, $2))), 0))
           FROM boosts b
          WHERE b.user_id = $1 AND b.ends_at > $2 AND b.starts_at < $3
       ), 0)::double precision AS boosted_s`,
    [userId, paidFrom, user.now],
  );
  const f = facts.rows[0];

  // boosted_extra_s already carries the (multiplier - 1) weighting, so the
  // weighted time is simply elapsed + boosted_extra_s.
  const earnedMicro = microCoinsFor(f.coins_per_hour, f.elapsed_s + f.boosted_extra_s);

  const { coins: coinsEarned, remainderMicro } = splitMicroCoins(user.coin_remainder_micro + earnedMicro);

  const updated = await client.query<{ coin_balance: number; last_coin_claim_at: Date }>(
    // GREATEST, never a plain assignment: "instant collect" (a rewarded ad)
    // pays income in advance by pushing this clock INTO THE FUTURE, and
    // settling afterwards must not drag it back - that would pay those hours
    // a second time.
    `UPDATE users
        SET coin_balance = coin_balance + $2,
            coin_remainder_micro = $3,
            -- Free to piggyback here: it is the same row in the same
            -- transaction, and it drives the "come back" notification.
            last_active_at = NOW(),
            last_coin_claim_at = GREATEST(last_coin_claim_at, $4::timestamptz)
      WHERE id = $1
      RETURNING coin_balance, last_coin_claim_at`,
    [userId, coinsEarned, f.coins_per_hour === 0 ? 0 : remainderMicro, user.now],
  );
  const row = updated.rows[0];

  // Coins are redeemable for money, so every credit gets an immutable row
  // saying where it came from. `users.coin_balance` is only a cached
  // projection of this table - see db/migrations/004.
  if (coinsEarned > 0) {
    await client.query(
      `INSERT INTO coin_ledger
         (user_id, entry_type, amount, balance_after, earned_from, earned_to, coins_per_hour, boosted_seconds)
       VALUES ($1, 'ACCRUAL', $2, $3, $4, $5, $6, $7)`,
      [userId, coinsEarned, row.coin_balance, paidFrom, row.last_coin_claim_at, f.coins_per_hour, Math.round(f.boosted_s)],
    );
  }

  const rewards = await rewardStatus(client, userId);
  // Ad and prize boosts add up (a 3x prize plus a 2x ad boost is 4x).
  const effectiveCoinsPerHour = f.coins_per_hour * rewards.activeMultiplier;

  return {
    walkPoints: user.walk_points_balance,
    coins: row.coin_balance,
    totalParcels: f.parcel_count,
    coinsPerHour: f.coins_per_hour,
    effectiveCoinsPerHour,
    coinsJustEarned: coinsEarned,
    lastCoinClaimAt: row.last_coin_claim_at,
    parcelPrice: parcelPriceWp(f.parcel_count),
    stepsPerWalkPoint: STEPS_PER_WALK_POINT,
    rewards,
    redeemableUsd: formatCoinsAsUsd(row.coin_balance),
    usdPerSecond: coinsPerHourToUsdPerSecond(effectiveCoinsPerHour),
    minRedemptionCoins: MIN_REDEMPTION_COINS,
    canRedeem: canRedeem(row.coin_balance),
  };
}

/**
 * The GET /user/balance entry point: settle income, then report the result.
 */
export async function getBalanceWithLazyEvaluation(
  userId: string,
): Promise<BalanceResult & { jerseyColor: string; avatar: Record<string, string>; unseenBadges: number; photoUrl: string | null }> {
  // If a leaderboard week has just ended, hand out its prizes first, so a
  // winner sees their boost the first time they open the app.
  await settleFinishedWeek();
  const balance = await withTransaction((client) => settleCoinIncome(client, userId));
  // Badges are checked here too, so a new one shows up without opening the
  // profile - it drives the "new badge" dot.
  const [unseenBadges, me] = await Promise.all([
    unseenBadgeCount(userId),
    query<{ jersey_color: string; avatar: Record<string, string> | null; photo_path: string | null }>(
      'SELECT jersey_color, avatar, photo_path FROM users WHERE id = $1',
      [userId],
    ),
  ]);
  return {
    ...balance,
    jerseyColor: me.rows[0]?.jersey_color ?? '#2F5D50',
    avatar: me.rows[0]?.avatar ?? {},
    photoUrl: photoUrl(me.rows[0]?.photo_path),
    unseenBadges,
  };
}
