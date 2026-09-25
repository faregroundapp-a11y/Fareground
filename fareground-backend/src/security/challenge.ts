/**
 * Server-issued, single-use nonces for device attestation.
 *
 * Both Apple and Google require the SERVER to choose a random challenge that
 * the phone folds into its attestation. Without one, an attacker captures a
 * single valid attestation and replays it forever.
 *
 * This part is completely platform-agnostic, so it works for iOS and Android
 * alike and can be built and tested today - unlike the platform-specific
 * verifiers, which need real devices and developer credentials.
 */
import { randomBytes } from 'node:crypto';
import { query } from '../db/pool';
import { HttpError } from '../utils/httpError';

/** How long a challenge stays usable. Short: the phone should use it at once. */
export const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

export interface Challenge {
  nonce: string;
  expiresAt: Date;
}

/**
 * Issue a fresh nonce for this user.
 *
 * 32 random bytes from crypto.randomBytes - not Math.random, which is
 * predictable and would let an attacker pre-compute attestations.
 */
export async function issueChallenge(userId: string): Promise<Challenge> {
  const nonce = randomBytes(32).toString('hex');

  const result = await query<{ nonce: string; expires_at: Date }>(
    `INSERT INTO attestation_challenges (user_id, nonce, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' seconds')::interval)
     RETURNING nonce, expires_at`,
    [userId, nonce, CHALLENGE_TTL_SECONDS],
  );

  return { nonce: result.rows[0].nonce, expiresAt: result.rows[0].expires_at };
}

/**
 * Spend a nonce. Succeeds at most once per nonce, ever.
 *
 * The single UPDATE is what makes that guarantee hold: the WHERE clause
 * requires the challenge to still be unconsumed and unexpired, so two
 * simultaneous requests carrying the same nonce cannot both match. The second
 * one updates zero rows. Same trick as the parcel purchase.
 */
export async function consumeChallenge(userId: string, nonce: string): Promise<void> {
  const result = await query(
    `UPDATE attestation_challenges
        SET consumed_at = NOW()
      WHERE user_id = $1
        AND nonce = $2
        AND consumed_at IS NULL
        AND expires_at > NOW()`,
    [userId, nonce],
  );

  if (result.rowCount === 0) {
    throw new HttpError(401, 'Attestation challenge is unknown, already used, or expired.');
  }
}

/**
 * Housekeeping: drop challenges that expired a while ago.
 * Call this from a cron job, or just let the table grow - it is tiny.
 */
export async function purgeExpiredChallenges(): Promise<number> {
  const result = await query(
    `DELETE FROM attestation_challenges WHERE expires_at < NOW() - INTERVAL '1 day'`,
  );
  return result.rowCount ?? 0;
}
