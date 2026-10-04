import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { query } from '../db/pool';
import { createAuthToken } from '../services/auth.service';
import { HttpError } from '../utils/httpError';

/** A token older than this is swapped for a fresh one on the next request. */
const RENEW_AFTER_SECONDS = 24 * 60 * 60;

/** The build each user was last seen on, so the column is written only when it changes. */
const seenBuild = new Map<string, number>();

/**
 * Remember which app build a player is on (users.app_build). The leaderboards
 * leave out anyone on a build older than MIN_APP_BUILD. Written in the
 * background and only when the number changes - never slows a request down.
 */
function rememberBuild(userId: string, header: string | undefined): void {
  const build = Number(header ?? 0);
  if (!Number.isInteger(build) || build <= 0 || seenBuild.get(userId) === build) return;
  seenBuild.set(userId, build);
  query('UPDATE users SET app_build = $2 WHERE id = $1 AND app_build IS DISTINCT FROM $2', [userId, build]).catch(() => {
    seenBuild.delete(userId);
  });
}

/**
 * Protects a route: the caller must send a valid JWT.
 *
 *     Authorization: Bearer <token>
 *
 * On success it stores the user's id on `req.userId` so handlers further down
 * the chain know who is talking to them. It never trusts a user id sent in the
 * body or query string - only the signed token.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing Authorization header. Expected "Bearer <token>".');
  }

  const token = header.slice('Bearer '.length).trim();

  try {
    // verify() checks the signature AND the expiry date. If either is wrong it
    // throws, which is exactly what we want.
    const payload = jwt.verify(token, config.jwtSecret);

    // We always sign tokens with `subject: userId`, so `sub` is our user id.
    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new Error('Token payload is missing a "sub" claim.');
    }

    req.userId = payload.sub;
    rememberBuild(payload.sub, req.get('X-Fareground-Build'));

    // SLIDING SESSION: a token more than a day old comes back renewed in a
    // response header, which the app saves. So the expiry only ever bites
    // someone who has not opened the game for the whole lifetime of a token.
    if (typeof payload.iat === 'number' && Date.now() / 1000 - payload.iat > RENEW_AFTER_SECONDS) {
      res.setHeader('X-Fareground-Token', createAuthToken(payload.sub));
    }
  } catch {
    // Deliberately vague: do not tell an attacker whether the token was
    // malformed, expired, or signed with the wrong key.
    throw new HttpError(401, 'Invalid or expired token.');
  }
  next();
}

/**
 * Reads the authenticated user id, with a type-safe guarantee that it exists.
 * Only ever call this from a route that sits behind `requireAuth`.
 */
export function getUserId(req: Request): string {
  if (!req.userId) {
    // This means a developer forgot to add requireAuth to the route.
    throw new HttpError(401, 'Not authenticated.');
  }
  return req.userId;
}
