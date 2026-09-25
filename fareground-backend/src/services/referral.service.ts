/**
 * Invite a friend.
 *
 *   GET  /referral            your code, and how your invites are doing
 *   POST /referral/redeem     { code } - new players only
 *
 * WHO GETS PAID, AND WHEN
 *   - The INVITEE gets REFERRAL_REWARD_REFEREE_WP the moment they redeem.
 *   - The INVITER gets REFERRAL_REWARD_REFERRER_WP only once that friend has
 *     walked REFERRAL_STEPS_TO_QUALIFY steps. Making up accounts therefore
 *     costs real walking, which is the point.
 *
 * Other guards: you cannot redeem your own code, you can redeem only once and
 * only while your account is new, a phone that has already synced steps for
 * the inviter cannot qualify an invite, and each inviter is paid for at most
 * REFERRAL_MAX_REWARDED friends.
 */
import { randomInt } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../db/pool';
import {
  REFERRAL_MAX_REWARDED,
  REFERRAL_REDEEM_WINDOW_HOURS,
  REFERRAL_REWARD_REFEREE_WP,
  REFERRAL_REWARD_REFERRER_WP,
  REFERRAL_STEPS_TO_QUALIFY,
} from '../game/rules';
import { HttpError } from '../utils/httpError';

/** No 0/O/1/I - these get read aloud and typed in by hand. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 6;

function makeCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(0, ALPHABET.length)];
  return out;
}

export interface ReferralStatus {
  code: string;
  invited: number;
  /** Friends who walked enough for you to be paid. */
  qualified: number;
  earned: number;
  rewardForYou: number;
  rewardForFriend: number;
  stepsToQualify: number;
  maxRewarded: number;
  /** Can this account still redeem someone else's code? */
  canRedeem: boolean;
  redeemedCode: string | null;
}

/** Your code, made on first use and kept for good. */
async function ensureCode(userId: string): Promise<string> {
  const existing = await query<{ referral_code: string | null }>('SELECT referral_code FROM users WHERE id = $1', [userId]);
  if (existing.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
  if (existing.rows[0].referral_code) return existing.rows[0].referral_code;

  for (let attempt = 0; attempt < 10; attempt++) {
    const code = makeCode();
    try {
      const r = await query<{ referral_code: string }>(
        'UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL RETURNING referral_code',
        [userId, code],
      );
      if (r.rowCount === 0) {
        // Someone set it a moment ago (two requests at once): read it back.
        const again = await query<{ referral_code: string }>('SELECT referral_code FROM users WHERE id = $1', [userId]);
        return again.rows[0].referral_code;
      }
      return r.rows[0].referral_code;
    } catch {
      // Code collision - vanishingly rare, but try another.
    }
  }
  throw new HttpError(503, 'Could not make a code just now. Please try again.');
}

export async function referralStatus(userId: string): Promise<ReferralStatus> {
  const code = await ensureCode(userId);
  const r = await query<{
    invited: number; qualified: number; earned: number; redeemed_code: string | null; can_redeem: boolean;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM referrals WHERE referrer_id = $1)::int AS invited,
       (SELECT COUNT(*) FROM referrals WHERE referrer_id = $1 AND qualified_at IS NOT NULL)::int AS qualified,
       COALESCE((SELECT SUM(referrer_reward) FROM referrals WHERE referrer_id = $1), 0)::int AS earned,
       (SELECT code FROM referrals WHERE referee_id = $1) AS redeemed_code,
       (NOT EXISTS (SELECT 1 FROM referrals WHERE referee_id = $1)
          AND (SELECT created_at FROM users WHERE id = $1) > NOW() - ($2 || ' hours')::interval) AS can_redeem`,
    [userId, REFERRAL_REDEEM_WINDOW_HOURS],
  );
  const row = r.rows[0];
  return {
    code,
    invited: row.invited,
    qualified: row.qualified,
    earned: row.earned,
    rewardForYou: REFERRAL_REWARD_REFERRER_WP,
    rewardForFriend: REFERRAL_REWARD_REFEREE_WP,
    stepsToQualify: REFERRAL_STEPS_TO_QUALIFY,
    maxRewarded: REFERRAL_MAX_REWARDED,
    canRedeem: row.can_redeem,
    redeemedCode: row.redeemed_code,
  };
}

export interface RedeemResult {
  invitedBy: string;
  reward: number;
  walkPointsBalance: number;
  stepsToQualify: number;
}

/** Use a friend's code. New accounts only, once each. */
export async function redeemReferral(userId: string, rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(code)) throw new HttpError(400, 'That code does not look right.');

  return withTransaction(async (client) => {
    const me = await client.query<{ created_at: Date; referral_code: string | null }>(
      'SELECT created_at, referral_code FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    if (me.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
    if (me.rows[0].referral_code === code) throw new HttpError(409, 'That is your own code!');

    const ageHours = (Date.now() - me.rows[0].created_at.getTime()) / 3_600_000;
    if (ageHours > REFERRAL_REDEEM_WINDOW_HOURS) {
      throw new HttpError(409, `Invite codes can only be used in your first ${Math.round(REFERRAL_REDEEM_WINDOW_HOURS / 24)} days.`);
    }

    const already = await client.query('SELECT 1 FROM referrals WHERE referee_id = $1', [userId]);
    if ((already.rowCount ?? 0) > 0) throw new HttpError(409, 'You have already used an invite code.');

    const owner = await client.query<{ id: string; username: string }>(
      'SELECT id, username FROM users WHERE referral_code = $1',
      [code],
    );
    if (owner.rowCount === 0) throw new HttpError(404, 'No one has that code.');
    if (owner.rows[0].id === userId) throw new HttpError(409, 'That is your own code!');

    await client.query(
      `INSERT INTO referrals (referrer_id, referee_id, code, referee_reward) VALUES ($1, $2, $3, $4)`,
      [owner.rows[0].id, userId, code, REFERRAL_REWARD_REFEREE_WP],
    );
    const bal = await client.query<{ walk_points_balance: number }>(
      'UPDATE users SET walk_points_balance = walk_points_balance + $2 WHERE id = $1 RETURNING walk_points_balance',
      [userId, REFERRAL_REWARD_REFEREE_WP],
    );

    return {
      invitedBy: owner.rows[0].username,
      reward: REFERRAL_REWARD_REFEREE_WP,
      walkPointsBalance: bal.rows[0].walk_points_balance,
      stepsToQualify: REFERRAL_STEPS_TO_QUALIFY,
    };
  });
}

/**
 * Called from a step sync, inside its transaction: once this player has
 * walked enough, pay whoever invited them. Returns the WP paid out, if any.
 */
export async function maybeQualifyReferral(
  client: PoolClient,
  refereeId: string,
  lifetimeSteps: number,
  deviceId?: string,
): Promise<number> {
  if (lifetimeSteps < REFERRAL_STEPS_TO_QUALIFY) return 0;

  const pending = await client.query<{ id: string; referrer_id: string }>(
    'SELECT id, referrer_id FROM referrals WHERE referee_id = $1 AND qualified_at IS NULL FOR UPDATE',
    [refereeId],
  );
  const row = pending.rows[0];
  if (!row) return 0;

  // The same phone on both sides is one person with two accounts.
  if (deviceId) {
    const shared = await client.query('SELECT 1 FROM devices WHERE user_id = $1 AND device_id = $2', [row.referrer_id, deviceId]);
    if ((shared.rowCount ?? 0) > 0) {
      await client.query('UPDATE referrals SET qualified_at = NOW(), referrer_reward = 0 WHERE id = $1', [row.id]);
      return 0;
    }
  }

  const paidAlready = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM referrals WHERE referrer_id = $1 AND referrer_reward > 0`,
    [row.referrer_id],
  );
  const reward = paidAlready.rows[0].n >= REFERRAL_MAX_REWARDED ? 0 : REFERRAL_REWARD_REFERRER_WP;

  await client.query('UPDATE referrals SET qualified_at = NOW(), referrer_reward = $2 WHERE id = $1', [row.id, reward]);
  if (reward > 0) {
    await client.query('UPDATE users SET walk_points_balance = walk_points_balance + $2 WHERE id = $1', [
      row.referrer_id,
      reward,
    ]);
  }
  return reward;
}
