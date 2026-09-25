/**
 * Deleting an account, permanently.
 *
 *   POST /user/delete { password? }
 *
 * Google Play requires any app with accounts to offer deletion FROM INSIDE THE
 * APP as well as from a web page. This is the in-app half.
 *
 * It is a real delete, not a flag. Every table that references `users` does so
 * with ON DELETE CASCADE, so one statement removes the steps, the parcels, the
 * ledger, the boosts, the claims, the reports and the push tokens. Nothing is
 * kept "just in case" - that is the whole point of the promise.
 *
 * ONE CONSEQUENCE WORTH UNDERSTANDING: deleting an account frees its land.
 * The parcels rows go, so those squares become claimable by somebody else.
 * That is the right behaviour - land nobody owns should not stay locked
 * forever - but it does mean deletion is not reversible in any sense, and the
 * confirmation wording says so.
 */
import bcrypt from 'bcryptjs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db/pool';
import { HttpError } from '../utils/httpError';
import { UPLOAD_DIR } from './photo.service';

export interface DeleteSummary {
  /** What is about to be destroyed, so the confirmation can be specific. */
  username: string;
  parcels: number;
  coins: number;
  walkPoints: number;
  /** True when the account has a password and must supply it to delete. */
  needsPassword: boolean;
}

/** What the player is about to lose. Shown on the confirmation screen. */
export async function deletionSummary(userId: string): Promise<DeleteSummary> {
  const r = await pool.query<{
    username: string;
    coin_balance: number;
    walk_points_balance: number;
    has_password: boolean;
    parcels: number;
  }>(
    `SELECT u.username, u.coin_balance, u.walk_points_balance,
            (u.password_hash IS NOT NULL) AS has_password,
            (SELECT COUNT(*)::int FROM parcels p WHERE p.owner_id = u.id) AS parcels
       FROM users u WHERE u.id = $1`,
    [userId],
  );
  if (r.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
  const row = r.rows[0];
  return {
    username: row.username,
    parcels: row.parcels,
    coins: row.coin_balance,
    walkPoints: row.walk_points_balance,
    needsPassword: row.has_password,
  };
}

/**
 * Delete the account and everything attached to it.
 *
 * An account with a password must supply it. An account that only ever signed
 * in with Google cannot - there is nothing to check - so for those the
 * confirmation in the app is the whole gate. That is a real difference in
 * strength and it is the best available: re-running Google's sign-in here
 * would prove possession of the phone, which is exactly what an attacker
 * holding the unlocked phone already has.
 */
export async function deleteAccount(userId: string, password?: string): Promise<void> {
  const r = await pool.query<{ password_hash: string | null; photo_path: string | null }>(
    'SELECT password_hash, photo_path FROM users WHERE id = $1',
    [userId],
  );
  if (r.rowCount === 0) throw new HttpError(401, 'User no longer exists.');
  const { password_hash: hash, photo_path: photo } = r.rows[0];

  if (hash) {
    if (!password) throw new HttpError(400, 'Enter your password to delete your account.');
    const ok = await bcrypt.compare(password, hash);
    if (!ok) throw new HttpError(401, 'That password is not right.');
  }

  // The row goes first. If the file delete then fails we have an orphaned
  // image rather than an account that half-exists.
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);

  if (photo) await unlink(path.join(UPLOAD_DIR, photo)).catch(() => {});
}
