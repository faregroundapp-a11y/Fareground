/**
 * Rewarded ads: boosts and bonus Walk Points.
 *
 *   POST /rewards/start      "I am about to watch an ad for X" -> single-use ticket
 *   POST /rewards/complete   "I finished it" (trusted in dev; a status check with SSV)
 *   GET  /rewards/ssv        Google's signed callback that the ad really was watched
 *
 * THE FLOW
 *   1. The phone asks for a ticket BEFORE showing the ad. That is where caps
 *      are checked, so nobody sits through an ad that cannot pay out.
 *   2. The ticket's nonce is handed to the ad SDK as `customData`, with our
 *      user id as `userId`.
 *   3. When the ad finishes, Google calls /rewards/ssv, signed with Google's
 *      key, carrying that nonce. We verify the signature, then grant.
 *   4. The phone calls /rewards/complete to find out it was granted.
 *
 * With AD_REWARD_VERIFICATION=client (local development, where Google cannot
 * reach a server on your Wi-Fi), step 4 grants directly. That trusts the
 * phone, which is exactly why production must use `ssv`.
 *
 * Whichever path grants, it goes through ONE function, `grant`, which
 * spends the ticket with a conditional UPDATE. A ticket pays out once, ever.
 */
import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { config } from '../config/env';
import { localMidnightSql, nextLocalMidnightSql, USER_TZ } from '../db/localTime';
import { query, withTransaction } from '../db/pool';
import { AD_UNLOCKABLE } from '../game/avatar';
import {
  AD_TICKET_TTL_SECONDS,
  AD_WALK_POINTS,
  BOOST_MAX_BANKED_SECONDS,
  BOOST_MULTIPLIER,
  BOOST_SECONDS_PER_AD,
  INSTANT_COLLECT_HOURS,
  MAX_INSTANT_COLLECT_ADS_PER_DAY,
  MAX_SCOUT_ADS_PER_DAY,
  SCOUT_CLAIM_DISTANCE_M,
  SCOUT_MAX_BANKED_SECONDS,
  SCOUT_SECONDS_PER_AD,
  dailyAdCap,
  type AdRewardKind,
} from '../game/rules';
import { HttpError } from '../utils/httpError';
import { throttledAmount } from './integrity.service';
import { applyStreakSave, assertCanSaveStreak, assertDoubleable, payDouble } from './daily.service';
import { applyUpgrade, assertCanUpgrade } from './parcels.service';
import { assertCanSpawnBox, spawnAdBox } from './treasure.service';
import { settleCoinIncome } from './user.service';

/**
 * Every daily ad cap counts from the player's LOCAL midnight (see
 * db/localTime.ts). It used to be a rolling 24 hours, so an ad watched at
 * 9pm blocked the next one until 9pm the following day.
 */
const TODAY_BEGAN = localMidnightSql(USER_TZ);

export interface RewardStatus {
  boost: {
    active: boolean;
    multiplier: number;
    /** When the banked boost runs out, or null if none. */
    endsAt: Date | null;
    remainingSeconds: number;
    secondsPerAd: number;
    maxBankedSeconds: number;
    /** False when the bank is full, today's boost ads are used up, or there is no land to boost. */
    canAdd: boolean;
    /** True when the player owns no land yet - a boost would earn nothing. */
    needsLand: boolean;
    adsLeftToday: number;
  };
  walkPoints: {
    perAd: number;
    adsLeftToday: number;
  };
  /** A leaderboard prize boost, if one is running. */
  prize: {
    active: boolean;
    multiplier: number;
    endsAt: Date | null;
    remainingSeconds: number;
  };
  /** Everything running right now, added up: 1 = no boost, 4 = prize 3x + ad 2x. */
  activeMultiplier: number;
  /** Take the next couple of hours of income now. */
  instantCollect: {
    hours: number;
    /** Roughly what it would pay at the current rate. */
    coins: number;
    adsLeftToday: number;
    canCollect: boolean;
    /** True when the player owns no land - there is no income to collect. */
    needsLand: boolean;
  };
  /** A wider claim reach for a few minutes. */
  scout: {
    active: boolean;
    endsAt: Date | null;
    remainingSeconds: number;
    secondsPerAd: number;
    maxBankedSeconds: number;
    reachM: number;
    adsLeftToday: number;
    canAdd: boolean;
  };
  /** When every "adsLeftToday" above resets: the player's next local midnight. */
  resetsAt: Date;
}

export interface AdTicket {
  nonce: string;
  kind: AdRewardKind;
  expiresAt: Date;
  /** For TREASURE: where to put the box, remembered from the request. */
  /** Pass this to the ad SDK's server-side verification options. */
  userId: string;
}

export interface CompleteResult {
  granted: boolean;
  kind: AdRewardKind;
  /** WP for WALK_POINTS, seconds for BOOST. */
  amount: number | null;
  replayed: boolean;
}

/** Boost and ad-allowance state. Works inside or outside a transaction. */
export async function rewardStatus(client: PoolClient, userId: string): Promise<RewardStatus> {
  const r = await client.query<{
    ends_at: Date | null;
    remaining_s: number;
    boost_ads: number;
    wp_ads: number;
    parcels: number;
    prize_ends_at: Date | null;
    prize_remaining_s: number;
    prize_multiplier: number | null;
    active_extra: number;
    collect_ads: number;
    scout_ads: number;
    scout_remaining_s: number;
    scout_ends_at: Date | null;
    coins_per_hour: number;
    resets_at: Date;
  }>(
    `SELECT
       (SELECT MAX(ends_at) FROM boosts WHERE user_id = $1 AND source = 'AD' AND ends_at > NOW()) AS ends_at,
       COALESCE((SELECT GREATEST(EXTRACT(EPOCH FROM (MAX(ends_at) - NOW())), 0)
                   FROM boosts WHERE user_id = $1 AND source = 'AD' AND ends_at > NOW()), 0)::double precision AS remaining_s,
       (SELECT MAX(ends_at) FROM boosts WHERE user_id = $1 AND source = 'PRIZE' AND ends_at > NOW()) AS prize_ends_at,
       COALESCE((SELECT GREATEST(EXTRACT(EPOCH FROM (MAX(ends_at) - NOW())), 0)
                   FROM boosts WHERE user_id = $1 AND source = 'PRIZE' AND ends_at > NOW()), 0)::double precision AS prize_remaining_s,
       (SELECT MAX(multiplier) FROM boosts WHERE user_id = $1 AND source = 'PRIZE'
           AND starts_at <= NOW() AND ends_at > NOW()) AS prize_multiplier,
       COALESCE((SELECT SUM(multiplier - 1) FROM boosts WHERE user_id = $1
           AND starts_at <= NOW() AND ends_at > NOW()), 0)::int AS active_extra,
       (SELECT COUNT(*) FROM ad_rewards WHERE user_id = $1 AND kind = 'BOOST'
           AND status = 'GRANTED' AND granted_at >= ${TODAY_BEGAN})::int AS boost_ads,
       (SELECT COUNT(*) FROM ad_rewards WHERE user_id = $1 AND kind = 'WALK_POINTS'
           AND status = 'GRANTED' AND granted_at >= ${TODAY_BEGAN})::int AS wp_ads,
       (SELECT COUNT(*) FROM parcels WHERE owner_id = $1)::int AS parcels,
       (SELECT COUNT(*) FROM ad_rewards WHERE user_id = $1 AND kind = 'INSTANT_COLLECT'
           AND status = 'GRANTED' AND granted_at >= ${TODAY_BEGAN})::int AS collect_ads,
       (SELECT COUNT(*) FROM ad_rewards WHERE user_id = $1 AND kind = 'SCOUT'
           AND status = 'GRANTED' AND granted_at >= ${TODAY_BEGAN})::int AS scout_ads,
       COALESCE((SELECT GREATEST(EXTRACT(EPOCH FROM (scout_until - NOW())), 0) FROM users WHERE id = $1), 0)::double precision AS scout_remaining_s,
       (SELECT CASE WHEN scout_until > NOW() THEN scout_until END FROM users WHERE id = $1) AS scout_ends_at,
       COALESCE((SELECT SUM(coins_per_hour + upgrade_level) FROM parcels WHERE owner_id = $1), 0)::int AS coins_per_hour,
       ${nextLocalMidnightSql(USER_TZ)} AS resets_at`,
    [userId],
  );
  const row = r.rows[0];
  const remaining = Math.floor(row.remaining_s);
  const boostAdsLeft = Math.max(0, dailyAdCap('BOOST') - row.boost_ads);

  return {
    boost: {
      active: remaining > 0,
      multiplier: BOOST_MULTIPLIER,
      endsAt: row.ends_at,
      remainingSeconds: remaining,
      secondsPerAd: BOOST_SECONDS_PER_AD,
      maxBankedSeconds: BOOST_MAX_BANKED_SECONDS,
      // Allow topping up while at least a minute of room is left - and only
      // for someone with land, or the ad would pay nothing.
      canAdd: row.parcels > 0 && boostAdsLeft > 0 && remaining < BOOST_MAX_BANKED_SECONDS - 60,
      needsLand: row.parcels === 0,
      adsLeftToday: boostAdsLeft,
    },
    walkPoints: {
      perAd: AD_WALK_POINTS,
      adsLeftToday: Math.max(0, dailyAdCap('WALK_POINTS') - row.wp_ads),
    },
    instantCollect: {
      hours: INSTANT_COLLECT_HOURS,
      coins: row.coins_per_hour * INSTANT_COLLECT_HOURS,
      adsLeftToday: Math.max(0, MAX_INSTANT_COLLECT_ADS_PER_DAY - row.collect_ads),
      canCollect: row.coins_per_hour > 0 && row.collect_ads < MAX_INSTANT_COLLECT_ADS_PER_DAY,
      needsLand: row.coins_per_hour === 0,
    },
    scout: {
      active: Math.floor(row.scout_remaining_s) > 0,
      endsAt: row.scout_ends_at,
      remainingSeconds: Math.floor(row.scout_remaining_s),
      secondsPerAd: SCOUT_SECONDS_PER_AD,
      maxBankedSeconds: SCOUT_MAX_BANKED_SECONDS,
      reachM: SCOUT_CLAIM_DISTANCE_M,
      adsLeftToday: Math.max(0, MAX_SCOUT_ADS_PER_DAY - row.scout_ads),
      canAdd: row.scout_ads < MAX_SCOUT_ADS_PER_DAY && row.scout_remaining_s < SCOUT_MAX_BANKED_SECONDS - 30,
    },
    prize: {
      active: Math.floor(row.prize_remaining_s) > 0,
      multiplier: row.prize_multiplier ?? 1,
      endsAt: row.prize_ends_at,
      remainingSeconds: Math.floor(row.prize_remaining_s),
    },
    activeMultiplier: 1 + row.active_extra,
    resetsAt: row.resets_at,
  };
}

function assertCanEarn(status: RewardStatus, kind: AdRewardKind): void {
  if (kind === 'BOOST') {
    if (status.boost.needsLand) {
      throw new HttpError(409, 'Claim some land first - a boost doubles what your land earns.');
    }
    if (status.boost.adsLeftToday <= 0) {
      throw new HttpError(429, 'You have used all of today\'s boosts. They come back at midnight.');
    }
    if (!status.boost.canAdd) {
      throw new HttpError(409, `Your boost is already full (${BOOST_MAX_BANKED_SECONDS / 3600} hours). Top it up later.`);
    }
  } else if (kind === 'WALK_POINTS' && status.walkPoints.adsLeftToday <= 0) {
    throw new HttpError(429, 'You have collected all of today\'s bonus Walk Points. Walking still counts!');
  } else if (kind === 'INSTANT_COLLECT') {
    // Land first: with none, the real reason is "nothing to collect", and
    // saying "none left today" sent players to wait for a reset that could
    // never help them.
    if (status.instantCollect.needsLand) {
      throw new HttpError(409, 'Claim some land first - there is nothing to collect yet.');
    }
    if (status.instantCollect.adsLeftToday <= 0) {
      throw new HttpError(429, "That's all the instant collects for today. They come back at midnight.");
    }
  } else if (kind === 'SCOUT') {
    if (status.scout.adsLeftToday <= 0) {
      throw new HttpError(429, "That's all the scouting for today. It comes back at midnight.");
    }
    if (!status.scout.canAdd) throw new HttpError(409, 'You already have scouting running.');
  }
}

/**
 * Step 1: check the caps and hand out a single-use ticket.
 * A DOUBLE ticket names the daily-chest or quest reward it would double.
 */
export async function startAdReward(
  userId: string,
  kind: AdRewardKind,
  targetClaimId?: string,
  cosmeticKey?: string,
  targetParcelId?: string,
): Promise<AdTicket> {
  return withTransaction(async (client) => {
    await lockUser(client, userId);
    if (kind === 'DOUBLE') {
      if (!targetClaimId) throw new HttpError(400, 'Say which reward to double.');
      await assertDoubleable(client, userId, targetClaimId);
    } else if (kind === 'UPGRADE') {
      if (!targetParcelId) throw new HttpError(400, 'Say which parcel to upgrade.');
      await assertCanUpgrade(client, userId, targetParcelId);
    } else if (kind === 'STREAK_SAVE') {
      await assertCanSaveStreak(client, userId);
    } else if (kind === 'TREASURE') {
      await assertCanSpawnBox(userId);
    } else if (kind === 'EXTRA_CHECKIN') {
      // Nothing to check here: the check-in itself refuses a place you have
      // already been today, and the ad is spent when it is used.
    } else if (kind === 'PIT_STOP') {
      // Same shape: the pit stop request refuses a parcel that already paid
      // today, and rolls back without spending the ticket if it does.
    } else if (kind === 'PHOTO') {
      // Nothing to check: the upload itself validates the image, and the
      // ticket is spent only once a valid one has been stored.
    } else if (kind === 'COSMETIC') {
      if (!cosmeticKey || !AD_UNLOCKABLE.includes(cosmeticKey)) {
        throw new HttpError(400, 'That item is not unlocked by watching an ad.');
      }
      const owned = await client.query('SELECT 1 FROM user_cosmetics WHERE user_id = $1 AND item_key = $2', [
        userId, cosmeticKey,
      ]);
      if ((owned.rowCount ?? 0) > 0) throw new HttpError(409, 'You already have that one.');
    } else {
      assertCanEarn(await rewardStatus(client, userId), kind);
    }

    const nonce = randomBytes(16).toString('hex');
    const inserted = await client.query<{ expires_at: Date }>(
      `INSERT INTO ad_rewards (user_id, kind, nonce, expires_at, target_claim_id, cosmetic_key, target_parcel_id)
       VALUES ($1, $2, $3, NOW() + ($4 || ' seconds')::interval, $5, $6, $7)
       RETURNING expires_at`,
      [
        userId, kind, nonce, AD_TICKET_TTL_SECONDS,
        kind === 'DOUBLE' ? targetClaimId : null,
        kind === 'COSMETIC' ? cosmeticKey : null,
        kind === 'UPGRADE' ? targetParcelId : null,
      ],
    );
    return { nonce, kind, expiresAt: inserted.rows[0].expires_at, userId };
  });
}

async function lockUser(client: PoolClient, userId: string): Promise<void> {
  const r = await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
  if (r.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
}

type TicketRow = {
  id: string;
  user_id: string;
  kind: AdRewardKind;
  status: 'PENDING' | 'GRANTED';
  amount: number | null;
  expired: boolean;
  target_claim_id: string | null;
  cosmetic_key: string | null;
  target_parcel_id: string | null;
};

async function findTicket(client: PoolClient, nonce: string): Promise<TicketRow | null> {
  const r = await client.query<TicketRow>(
    `SELECT id, user_id, kind, status, amount, expires_at <= NOW() AS expired,
            target_claim_id, cosmetic_key, target_parcel_id
       FROM ad_rewards WHERE nonce = $1`,
    [nonce],
  );
  return r.rows[0] ?? null;
}

/**
 * Pay a ticket out. The only place rewards are granted.
 * Must run inside a transaction that has already locked the user row.
 */
async function grant(
  client: PoolClient,
  ticket: TicketRow,
  verifiedBy: 'client' | 'ssv',
  networkTxnId: string | null,
  /** Where the player is, for a TREASURE box. */
  boxAt: { lat: number; lng: number } | null = null,
): Promise<number> {
  assertCanEarn(await rewardStatus(client, ticket.user_id), ticket.kind);

  let amount: number;
  if (ticket.kind === 'DOUBLE') {
    if (!ticket.target_claim_id) throw new HttpError(409, 'That reward no longer exists.');
    amount = await payDouble(client, ticket.user_id, ticket.target_claim_id);
  } else if (ticket.kind === 'UPGRADE') {
    if (!ticket.target_parcel_id) throw new HttpError(409, 'That parcel is gone.');
    const info = await applyUpgrade(client, ticket.user_id, ticket.target_parcel_id);
    amount = info.level;
  } else if (ticket.kind === 'STREAK_SAVE') {
    amount = await applyStreakSave(client, ticket.user_id);
  } else if (ticket.kind === 'TREASURE') {
    amount = await spawnAdBox(client, ticket.user_id, boxAt);
  } else if (ticket.kind === 'EXTRA_CHECKIN') {
    // The ad itself is the permission; the check-in request spends it.
    amount = 1;
  } else if (ticket.kind === 'PIT_STOP') {
    // The ad itself is the permission to skip the cooldown; the pit stop
    // request spends it.
    amount = 1;
  } else if (ticket.kind === 'PHOTO') {
    // The ad is permission to change your picture; the upload spends it.
    amount = 1;
  } else if (ticket.kind === 'COSMETIC') {
    if (!ticket.cosmetic_key) throw new HttpError(409, 'That item is no longer available.');
    await client.query(
      `INSERT INTO user_cosmetics (user_id, item_key) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [ticket.user_id, ticket.cosmetic_key],
    );
    amount = 1;
  } else if (ticket.kind === 'INSTANT_COLLECT') {
    // Pay up to now first, then hand over the next couple of hours. This is
    // income brought FORWARD: the clock is pushed on by the same amount, so
    // nothing is created out of thin air.
    const settled = await settleCoinIncome(client, ticket.user_id);
    amount = settled.coinsPerHour * INSTANT_COLLECT_HOURS;
    if (amount <= 0) throw new HttpError(409, 'Claim some land first - there is nothing to collect yet.');
    const paid = await client.query<{ coin_balance: number }>(
      `UPDATE users
          SET coin_balance = coin_balance + $2,
              last_coin_claim_at = last_coin_claim_at + ($3 || ' hours')::interval
        WHERE id = $1 RETURNING coin_balance`,
      [ticket.user_id, amount, INSTANT_COLLECT_HOURS],
    );
    await client.query(
      `INSERT INTO coin_ledger (user_id, entry_type, amount, balance_after, note)
       VALUES ($1, 'ADJUSTMENT', $2, $3, $4)`,
      [ticket.user_id, amount, paid.rows[0].coin_balance, `Instant collect: ${INSTANT_COLLECT_HOURS}h of income, taken early (ad)`],
    );
  } else if (ticket.kind === 'SCOUT') {
    const r = await client.query<{ seconds: number }>(
      `UPDATE users
          SET scout_until = LEAST(
                GREATEST(NOW(), COALESCE(scout_until, NOW())) + ($2 || ' seconds')::interval,
                NOW() + ($3 || ' seconds')::interval)
        WHERE id = $1
        RETURNING EXTRACT(EPOCH FROM (scout_until - NOW()))::double precision AS seconds`,
      [ticket.user_id, SCOUT_SECONDS_PER_AD, SCOUT_MAX_BANKED_SECONDS],
    );
    amount = Math.max(1, Math.floor(r.rows[0].seconds));
  } else if (ticket.kind === 'WALK_POINTS') {
    amount = await throttledAmount(client, ticket.user_id, AD_WALK_POINTS);
    await client.query('UPDATE users SET walk_points_balance = walk_points_balance + $2 WHERE id = $1', [
      ticket.user_id,
      amount,
    ]);
  } else {
    // Stack onto the end of any boost already banked, but never bank more
    // than the maximum ahead of now.
    const w = await client.query<{ starts_at: Date; ends_at: Date; seconds: number }>(
      `WITH last AS (
         SELECT GREATEST(NOW(), COALESCE(MAX(ends_at), NOW())) AS s
           FROM boosts WHERE user_id = $1 AND source = 'AD'
       )
       SELECT s AS starts_at,
              LEAST(s + ($2 || ' seconds')::interval, NOW() + ($3 || ' seconds')::interval) AS ends_at,
              EXTRACT(EPOCH FROM (LEAST(s + ($2 || ' seconds')::interval,
                                        NOW() + ($3 || ' seconds')::interval) - s))::double precision AS seconds
         FROM last`,
      [ticket.user_id, BOOST_SECONDS_PER_AD, BOOST_MAX_BANKED_SECONDS],
    );
    const win = w.rows[0];
    amount = Math.floor(win.seconds);
    if (amount <= 0) throw new HttpError(409, `Your boost is already full (${BOOST_MAX_BANKED_SECONDS / 3600} hours). Top it up later.`);
    await client.query(
      `INSERT INTO boosts (user_id, starts_at, ends_at, multiplier, ad_reward_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [ticket.user_id, win.starts_at, win.ends_at, BOOST_MULTIPLIER, ticket.id],
    );
  }

  // Spend the ticket. The WHERE makes it single-use even under a race; if it
  // matched nothing, throwing rolls back the reward above.
  const spent = await client.query(
    `UPDATE ad_rewards
        SET status = 'GRANTED', granted_at = NOW(), amount = $2, verified_by = $3, network_txn_id = $4
      WHERE id = $1 AND status = 'PENDING'`,
    [ticket.id, amount, verifiedBy, networkTxnId],
  );
  if ((spent.rowCount ?? 0) === 0) throw new HttpError(409, 'This reward was already collected.');
  return amount;
}

/**
 * Step 4: the phone reports the ad finished.
 * In `client` mode this grants; in `ssv` mode it only reports whether
 * Google's callback has granted it yet.
 */
export async function completeAdReward(
  userId: string,
  nonce: string,
  boxAt?: { lat: number; lng: number } | null,
): Promise<CompleteResult> {
  return withTransaction(async (client) => {
    await lockUser(client, userId);
    const ticket = await findTicket(client, nonce);
    if (!ticket || ticket.user_id !== userId) throw new HttpError(404, 'Unknown reward ticket.');

    if (ticket.status === 'GRANTED') {
      return { granted: true, kind: ticket.kind, amount: ticket.amount, replayed: true };
    }
    if (config.adRewardVerification === 'ssv') {
      return { granted: false, kind: ticket.kind, amount: null, replayed: false };
    }
    if (ticket.expired) throw new HttpError(410, 'That ad took too long. Please try again.');

    const amount = await grant(client, ticket, 'client', null, boxAt ?? null);
    return { granted: true, kind: ticket.kind, amount, replayed: false };
  });
}

/**
 * Step 3: Google's server-side verification callback, AFTER its signature
 * has been checked (see security/admobSsv.ts). Idempotent: Google retries,
 * and a retry of a granted ticket is simply acknowledged.
 */
export async function grantFromSsv(input: {
  nonce: string;
  userId: string;
  transactionId: string;
}): Promise<'granted' | 'already' | 'refused'> {
  return withTransaction(async (client) => {
    const peek = await findTicket(client, input.nonce);
    if (!peek || peek.user_id !== input.userId) return 'refused';
    await lockUser(client, peek.user_id);
    const ticket = await findTicket(client, input.nonce);
    if (!ticket) return 'refused';
    if (ticket.status === 'GRANTED') return 'already';
    // A slow ad network is not the player's fault; the ticket TTL is only
    // enforced for the trusted client path.
    // A savepoint, so a refusal part-way through undoes any reward already
    // written before the transaction commits.
    await client.query('SAVEPOINT grant_ssv');
    try {
      await grant(client, ticket, 'ssv', input.transactionId);
      return 'granted';
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT grant_ssv');
      if (e instanceof HttpError) return 'refused';
      throw e;
    }
  });
}

/**
 * Spend an EXTRA_CHECKIN ad: that kind of reward grants PERMISSION, which the
 * check-in request uses a moment later. The conditional UPDATE is what makes
 * it single-use - one ad, one extra check-in.
 *
 * It takes the CALLER'S client so it runs inside the check-in's transaction:
 * if the check-in is then refused (somewhere you have already been today),
 * the whole thing rolls back and the ad is still there to use.
 */
/**
 * Spend the ad that skips a pit stop's five-minute cooldown.
 *
 * Takes the CALLER'S client so it runs inside the pit stop's transaction: if
 * the stop is then refused (that parcel already paid today), everything rolls
 * back and the ticket is still there to spend on the next parcel along.
 */
/** Spend the ad that pays for changing a profile picture. */
export async function spendPhotoAd(
  client: { query: typeof query },
  userId: string,
  nonce: string,
): Promise<boolean> {
  const r = await client.query(
    `UPDATE ad_rewards SET consumed_at = NOW()
      WHERE user_id = $1 AND nonce = $2 AND kind = 'PHOTO'
        AND status = 'GRANTED' AND consumed_at IS NULL`,
    [userId, nonce],
  );
  if ((r.rowCount ?? 0) === 0) {
    throw new HttpError(409, 'That ad has already been used. Watch another to change your picture.');
  }
  return true;
}

export async function spendPitStopAd(
  client: { query: typeof query },
  userId: string,
  nonce: string,
): Promise<boolean> {
  const r = await client.query(
    `UPDATE ad_rewards SET consumed_at = NOW()
      WHERE user_id = $1 AND nonce = $2 AND kind = 'PIT_STOP'
        AND status = 'GRANTED' AND consumed_at IS NULL`,
    [userId, nonce],
  );
  if ((r.rowCount ?? 0) === 0) {
    throw new HttpError(409, 'That ad has already been used. Watch another to go again now.');
  }
  return true;
}

export async function spendExtraCheckinAd(
  client: { query: typeof query },
  userId: string,
  nonce: string,
): Promise<boolean> {
  const r = await client.query(
    `UPDATE ad_rewards SET consumed_at = NOW()
      WHERE user_id = $1 AND nonce = $2 AND kind = 'EXTRA_CHECKIN'
        AND status = 'GRANTED' AND consumed_at IS NULL`,
    [userId, nonce],
  );
  if ((r.rowCount ?? 0) === 0) {
    throw new HttpError(409, 'That ad has already been used. Watch another to check in again.');
  }
  return true;
}
