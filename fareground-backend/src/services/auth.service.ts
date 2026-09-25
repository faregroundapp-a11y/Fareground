/**
 * Registration and login.
 *
 * "Service" files hold the business logic and all the SQL. Route files stay
 * thin: they read the request, call a service, and send the response.
 */
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { config } from '../config/env';
import { query } from '../db/pool';
import { SIGNUP_BONUS_WP } from '../game/rules';
import { verifyGoogleIdToken } from '../security/googleIdToken';
import { HttpError } from '../utils/httpError';

/** The raw shape of a row in the "users" table (snake_case, like the DB). */
export type UserRow = {
  id: string;
  username: string;
  email: string;
  /** Null for accounts that only ever sign in with Google. */
  password_hash: string | null;
  google_sub: string | null;
  walk_points_balance: number;
  coin_balance: number;
  last_coin_claim_at: Date;
  created_at: Date;
}

/** What we are willing to send back to a client (camelCase, no password!). */
export interface PublicUser {
  id: string;
  username: string;
  email: string;
  walkPoints: number;
  coins: number;
  createdAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
  /** True when this call created the account (Google sign-in). */
  created?: boolean;
}

/** Strip the password hash and rename fields for the API response. */
function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    walkPoints: row.walk_points_balance,
    coins: row.coin_balance,
    createdAt: row.created_at,
  };
}

/** Create a signed login token for a user. */
export function createAuthToken(userId: string): string {
  const options: SignOptions = {
    subject: userId, // becomes the "sub" claim, read back by requireAuth
    expiresIn: config.jwtExpiresIn as SignOptions['expiresIn'],
  };

  // The payload stays empty on purpose. Anyone can decode a JWT (it is only
  // signed, not encrypted), so never put anything private in it.
  return jwt.sign({}, config.jwtSecret, options);
}

/** PostgreSQL error code 23505 = "unique_violation". */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === '23505'
  );
}

export async function registerUser(input: {
  username: string;
  email: string;
  password: string;
}): Promise<AuthResult> {
  // Normalise before storing so "Ada@Mail.com" and "ada@mail.com" are one user.
  const email = input.email.trim().toLowerCase();
  const username = input.username.trim();

  // NEVER store the raw password. bcrypt.hash is deliberately slow, which is
  // what makes a stolen database expensive to crack. The salt is generated
  // automatically and stored inside the resulting hash string.
  const passwordHash = await bcrypt.hash(input.password, config.bcryptSaltRounds);

  try {
    // New accounts start with one parcel's worth of WP (SIGNUP_BONUS_WP),
    // so the first thing a new player does is claim land.
    const result = await query<UserRow>(
      `INSERT INTO users (username, email, password_hash, walk_points_balance)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [username, email, passwordHash, SIGNUP_BONUS_WP],
    );

    const user = toPublicUser(result.rows[0]);
    return { user, token: createAuthToken(user.id) };
  } catch (error) {
    // We let the database's UNIQUE constraint be the referee rather than doing
    // a "SELECT ... then INSERT" check, which two simultaneous signups could
    // both pass.
    if (isUniqueViolation(error)) {
      throw new HttpError(409, 'That username or email is already taken.');
    }
    throw error;
  }
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();

  const result = await query<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
  const row = result.rows[0];

  if (!row) {
    // Same message as a wrong password below: never reveal which emails are
    // registered, that is free information for an attacker.
    throw new HttpError(401, 'Invalid email or password.');
  }

  // A Google-only account has no password. Same message as a wrong password,
  // so this does not reveal how an account signs in.
  if (!row.password_hash) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  const passwordMatches = await bcrypt.compare(input.password, row.password_hash);
  if (!passwordMatches) {
    throw new HttpError(401, 'Invalid email or password.');
  }

  return { user: toPublicUser(row), token: createAuthToken(row.id) };
}

/** Turn a name or email into a valid, probably-free username. */
function usernameBase(name: string | null, email: string): string {
  const raw = (name ?? email.split('@')[0]).normalize('NFKD').replace(/[^a-zA-Z0-9_]+/g, '');
  const base = raw.slice(0, 24);
  return base.length >= 3 ? base : `walker${base}`;
}

/**
 * Sign in with Google: verify the ID token, then find or create the account.
 *
 *   1. Known Google account (google_sub)  -> sign in.
 *   2. Existing email/password account with the same VERIFIED email -> link
 *      Google to it and sign in. Google has proved the person owns that
 *      inbox, which is exactly what a password reset would prove.
 *   3. Otherwise create a new account, with a username made from their name.
 */
export async function googleSignIn(idToken: string): Promise<AuthResult> {
  const google = await verifyGoogleIdToken(idToken);

  const bySub = await query<UserRow>('SELECT * FROM users WHERE google_sub = $1', [google.sub]);
  if (bySub.rows[0]) {
    return { user: toPublicUser(bySub.rows[0]), token: createAuthToken(bySub.rows[0].id), created: false };
  }

  const linked = await query<UserRow>(
    `UPDATE users SET google_sub = $2 WHERE email = $1 AND google_sub IS NULL RETURNING *`,
    [google.email, google.sub],
  );
  if (linked.rows[0]) {
    return { user: toPublicUser(linked.rows[0]), token: createAuthToken(linked.rows[0].id), created: false };
  }

  // New player. Try the plain name first, then add digits until one is free.
  const base = usernameBase(google.name, google.email);
  for (let attempt = 0; attempt < 8; attempt++) {
    const username = attempt === 0 ? base : `${base.slice(0, 26)}${Math.floor(Math.random() * 1_000_000)}`;
    try {
      const created = await query<UserRow>(
        `INSERT INTO users (username, email, google_sub, walk_points_balance)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [username, google.email, google.sub, SIGNUP_BONUS_WP],
      );
      return { user: toPublicUser(created.rows[0]), token: createAuthToken(created.rows[0].id), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Either the username was taken (try another) or the same Google
      // account signed up a moment ago on another request (sign it in).
      const again = await query<UserRow>('SELECT * FROM users WHERE google_sub = $1', [google.sub]);
      if (again.rows[0]) {
        return { user: toPublicUser(again.rows[0]), token: createAuthToken(again.rows[0].id), created: false };
      }
    }
  }
  throw new HttpError(409, 'Could not pick a username for you. Please try again.');
}
