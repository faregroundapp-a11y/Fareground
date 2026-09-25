/**
 * Profile photos: upload, serve, report, remove.
 *
 * DESIGN NOTES, because this is the one part of the product that carries
 * real-world risk:
 *
 *  * The phone resizes and re-encodes before uploading (expo-image-manipulator,
 *    256x256 JPEG). The server therefore needs NO image library - it only has
 *    to verify that what arrived really is a small JPEG or PNG. Doing the
 *    resize here would mean `sharp`, a native dependency, on a server that
 *    currently has none.
 *  * The file is written under a RANDOM name, never anything derived from the
 *    user. Guessing another player's photo URL should be impossible, and the
 *    filename must never leak an id.
 *  * The magic bytes are checked, not the declared type. A client saying
 *    "image/jpeg" proves nothing; the first bytes of the file do.
 *  * Nothing here scans the image. Every report lands in `photo_reports` for
 *    a human. That is the honest limit of this implementation.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pool, query } from '../db/pool';
import { HttpError } from '../utils/httpError';

/** Where uploads live. Relative to the backend's working directory. */
export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'avatars');

/** The phone sends ~256x256 JPEG; 512 KB is generous for that. */
const MAX_BYTES = 512 * 1024;

/** What the URL path prefix is, for building the public URL. */
export const PHOTO_URL_PREFIX = '/photos';

export type PhotoKind = 'jpeg' | 'png';

/**
 * Identify the image from its FIRST BYTES, not from anything the client said.
 * Returns null for anything that is not a plain JPEG or PNG - which includes
 * SVG, because an SVG is a document that can carry script.
 */
export function sniff(buf: Buffer): PhotoKind | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return 'png';
  }
  return null;
}

/** The public URL for a stored path, or null when there is no photo. */
export const photoUrl = (stored: string | null | undefined): string | null =>
  stored ? `${PHOTO_URL_PREFIX}/${stored}` : null;

export interface PhotoResult {
  photoPath: string;
  photoUrl: string;
}

/**
 * Store a new photo and point the account at it.
 *
 * The OLD file is deleted afterwards, and only after the database has been
 * updated - if the write fails, the account still points at a file that
 * exists. An orphaned file is a tidiness problem; a missing one is a broken
 * profile for everybody who sees it.
 */
export async function setPhoto(userId: string, base64: string): Promise<PhotoResult> {
  let buf: Buffer;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    throw new HttpError(400, 'That image could not be read.');
  }
  if (buf.length === 0) throw new HttpError(400, 'That image is empty.');
  if (buf.length > MAX_BYTES) {
    throw new HttpError(413, 'That picture is too large. Please pick a smaller one.');
  }

  const kind = sniff(buf);
  if (!kind) throw new HttpError(415, 'Profile pictures must be a JPEG or PNG photo.');

  const name = `${randomBytes(16).toString('hex')}.${kind === 'jpeg' ? 'jpg' : 'png'}`;

  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(path.join(UPLOAD_DIR, name), buf);

  // A CTE reads the OLD path before the UPDATE overwrites it. Doing this as
  // `RETURNING (SELECT ...)` happens to work through snapshot rules, but it
  // reads as though it should return the new value - too subtle to leave in
  // code that deletes files.
  const previous = await pool.query<{ old_path: string | null }>(
    `WITH prev AS (SELECT photo_path FROM users WHERE id = $1 FOR UPDATE)
     UPDATE users SET photo_path = $2, photo_updated_at = NOW()
      WHERE id = $1
      RETURNING (SELECT photo_path FROM prev) AS old_path`,
    [userId, name],
  );
  if (previous.rowCount === 0) throw new HttpError(401, 'User no longer exists.');

  const old = previous.rows[0].old_path;
  if (old && old !== name) {
    // Best effort. A file left behind costs a few kilobytes; a failed request
    // because cleanup threw would cost the player their upload.
    await unlink(path.join(UPLOAD_DIR, old)).catch(() => {});
  }

  return { photoPath: name, photoUrl: photoUrl(name)! };
}

/** The player removing their own picture. Free - only changing it costs an ad. */
export async function clearPhoto(userId: string): Promise<void> {
  const r = await pool.query<{ old_path: string | null }>(
    `WITH prev AS (SELECT photo_path FROM users WHERE id = $1 FOR UPDATE)
     UPDATE users SET photo_path = NULL, photo_updated_at = NOW()
      WHERE id = $1
      RETURNING (SELECT photo_path FROM prev) AS old_path`,
    [userId],
  );
  const old = r.rows[0]?.old_path;
  if (old) await unlink(path.join(UPLOAD_DIR, old)).catch(() => {});
}

export type ReportReason = 'SEXUAL' | 'VIOLENT' | 'HATE' | 'IMPERSONATION' | 'OTHER';
export const REPORT_REASONS: readonly ReportReason[] = [
  'SEXUAL', 'VIOLENT', 'HATE', 'IMPERSONATION', 'OTHER',
];

/**
 * Report somebody's picture.
 *
 * Deliberately cheap to do and impossible to spam: the unique index allows one
 * OPEN report per reporter per subject, so reporting twice is a no-op rather
 * than an error the reporter has to understand.
 */
export async function reportPhoto(
  reporterId: string,
  username: string,
  reason: ReportReason,
  note?: string,
): Promise<void> {
  const subject = await query<{ id: string; photo_path: string | null }>(
    'SELECT id, photo_path FROM users WHERE LOWER(username) = LOWER($1)',
    [username],
  );
  if (subject.rowCount === 0) throw new HttpError(404, 'No such player.');
  const s = subject.rows[0];
  if (s.id === reporterId) throw new HttpError(400, 'You cannot report yourself.');
  if (!s.photo_path) throw new HttpError(409, 'That player has no picture to report.');

  await pool.query(
    `INSERT INTO photo_reports (subject_id, reporter_id, reported_path, reason, note)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subject_id, reporter_id) WHERE handled_at IS NULL DO NOTHING`,
    [s.id, reporterId, s.photo_path, reason, note ?? null],
  );
}

/**
 * Take a picture down. There is no admin UI yet - this is called from
 * `npm run moderate` (scripts/moderate.ts) by whoever operates the game.
 */
export async function removePhotoAsModerator(userId: string, note: string): Promise<boolean> {
  const r = await pool.query<{ old_path: string | null }>(
    `WITH prev AS (SELECT photo_path FROM users WHERE id = $1 FOR UPDATE)
     UPDATE users
        SET photo_path = NULL,
            photo_removed_at = NOW(),
            photo_strikes = photo_strikes + 1
      WHERE id = $1
      RETURNING (SELECT photo_path FROM prev) AS old_path`,
    [userId],
  );
  if (r.rowCount === 0) return false;
  const old = r.rows[0].old_path;
  if (old) await unlink(path.join(UPLOAD_DIR, old)).catch(() => {});

  await pool.query(
    `UPDATE photo_reports SET handled_at = NOW(), handled_note = $2
      WHERE subject_id = $1 AND handled_at IS NULL`,
    [userId, note.slice(0, 500)],
  );
  return true;
}
