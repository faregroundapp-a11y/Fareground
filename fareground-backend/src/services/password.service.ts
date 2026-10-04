/**
 * FORGOT PASSWORD AND CHANGE PASSWORD (2026-10-04).
 *
 *   1. POST /auth/password/forgot { email } - if the email has an account,
 *      a 6-digit code is emailed to it. The answer is the same either way,
 *      so nobody can use this to find out who plays.
 *   2. POST /auth/password/reset { email, code, password } - a right code
 *      sets the new password and signs the player in.
 *   3. POST /user/password { current, password } - change it while signed in.
 *
 * The code is stored hashed, lasts 15 minutes, allows 5 wrong guesses, and a
 * new one cannot be sent more than once a minute. Email goes out through
 * Resend (RESEND_API_KEY); without a key, development servers print the code
 * to the log instead and production says reset is not set up yet.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { config } from '../config/env';
import { query, withTransaction } from '../db/pool';
import { HttpError } from '../utils/httpError';
import { createAuthToken, type AuthResult, type UserRow } from './auth.service';

const CODE_TTL_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const RESEND_AFTER_SECONDS = 60;

const hashCode = (userId: string, code: string) =>
  createHash('sha256').update(`${userId}:${code}:${config.jwtSecret}`).digest('hex');

async function sendResetEmail(to: string, username: string, code: string): Promise<void> {
  if (!config.resendApiKey) {
    if (config.nodeEnv === 'production') {
      throw new HttpError(503, 'Password reset by email is not set up yet. Please contact support.');
    }
    console.log(`[password] reset code for ${to}: ${code}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: config.mailFrom,
      to: [to],
      subject: `Your Fareground code: ${code}`,
      text:
        `Hi ${username},\n\nYour code to reset your Fareground password is ${code}.\n` +
        `It works for ${CODE_TTL_MINUTES} minutes.\n\nIf you did not ask for this, ignore this email - your password has not changed.`,
      html:
        `<div style="font-family:Arial,sans-serif;font-size:16px;color:#121814">` +
        `<p>Hi ${username.replace(/[<>&]/g, '')},</p><p>Your code to reset your Fareground password is:</p>` +
        `<p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#2F5D50">${code}</p>` +
        `<p>It works for ${CODE_TTL_MINUTES} minutes.</p>` +
        `<p style="color:#545E51">If you did not ask for this, ignore this email - your password has not changed.</p></div>`,
    }),
  });
  if (!res.ok) {
    console.error('[password] email failed', res.status, await res.text().catch(() => ''));
    throw new HttpError(502, 'Could not send the email. Please try again in a minute.');
  }
}

/** Step 1. Always resolves the same way, account or not. */
export async function requestPasswordReset(emailRaw: string): Promise<{ sent: true }> {
  const email = emailRaw.trim().toLowerCase();
  const u = await query<Pick<UserRow, 'id' | 'username' | 'email'>>(
    'SELECT id, username, email FROM users WHERE lower(email) = $1',
    [email],
  );
  if (u.rowCount === 0) return { sent: true };
  const user = u.rows[0];

  const recent = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM password_resets
      WHERE user_id = $1 AND created_at > NOW() - ($2 || ' seconds')::interval`,
    [user.id, RESEND_AFTER_SECONDS],
  );
  if (recent.rows[0].n > 0) throw new HttpError(429, 'A code was just sent. Check your email, or try again in a minute.');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // Only the newest code works.
  await query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
  await query(
    `INSERT INTO password_resets (user_id, code_hash, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval)`,
    [user.id, hashCode(user.id, code), CODE_TTL_MINUTES],
  );
  await sendResetEmail(user.email, user.username, code);
  return { sent: true };
}

/** Step 2. A right code sets the password and signs the player in. */
export async function resetPassword(input: { email: string; code: string; password: string }): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  // Null means "wrong code": the failed guess is counted and committed first,
  // then reported - throwing inside the transaction would undo the count.
  const result = await withTransaction(async (client): Promise<AuthResult | null> => {
    const u = await client.query<UserRow>('SELECT * FROM users WHERE lower(email) = $1 FOR UPDATE', [email]);
    const wrong = new HttpError(400, 'That code is wrong or has expired. Ask for a new one.');
    if (u.rowCount === 0) throw wrong;
    const user = u.rows[0];
    const r = await client.query<{ id: string; code_hash: string; attempts: number; live: boolean }>(
      `SELECT id, code_hash, attempts, (expires_at > NOW()) AS live
         FROM password_resets
        WHERE user_id = $1 AND used_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [user.id],
    );
    const row = r.rows[0];
    if (!row || !row.live || row.attempts >= MAX_ATTEMPTS) throw wrong;

    const given = Buffer.from(hashCode(user.id, input.code.trim()));
    const stored = Buffer.from(row.code_hash);
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
      await client.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return null;
    }

    const hash = await bcrypt.hash(input.password, config.bcryptSaltRounds);
    await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
    await client.query('UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [user.id]);
    return {
      user: {
        id: user.id, username: user.username, email: user.email,
        walkPoints: user.walk_points_balance, coins: user.coin_balance, createdAt: user.created_at,
      },
      token: createAuthToken(user.id),
    };
  });
  if (!result) throw new HttpError(400, 'That code is wrong or has expired. Ask for a new one.');
  return result;
}

/** 3. Change it while signed in. A Google-only account may set its first password. */
export async function changePassword(userId: string, current: string | undefined, next: string): Promise<{ changed: true }> {
  const u = await query<Pick<UserRow, 'password_hash'>>('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (u.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
  const existing = u.rows[0].password_hash;
  if (existing) {
    if (!current || !(await bcrypt.compare(current, existing))) {
      throw new HttpError(400, 'Your current password is not right.');
    }
  }
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, await bcrypt.hash(next, config.bcryptSaltRounds)]);
  return { changed: true };
}
