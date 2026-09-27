import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db/pool';
import { requireAuth, getUserId } from '../middleware/auth';
import { areasStatus, checkIn, rollNextArea } from '../services/checkin.service';
import { leaderboard } from '../services/leaderboard.service';
import { openBox, treasureStatus } from '../services/treasure.service';
import { asyncHandler } from '../utils/asyncHandler';

export const leaderboardRouter = Router();
export const checkinRouter = Router();

const scopeSchema = z.object({ scope: z.enum(['CITY', 'REGION', 'COUNTRY', 'WORLD']).default('CITY') });

/** GET /leaderboard?scope=CITY - this week's steps, ranked, in your area. */
leaderboardRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { scope } = scopeSchema.parse(req.query);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await leaderboard(getUserId(req), scope));
  }),
);

const areasSchema = z.object({
  lat: z.coerce.number().min(-85).max(85),
  lng: z.coerce.number().min(-180).max(180),
});

/** Today's local date for a user, used by every area call. */
async function localDay(userId: string): Promise<string> {
  const r = await pool.query<{ today: string }>(
    `SELECT to_char((NOW() AT TIME ZONE time_zone)::date, 'YYYY-MM-DD') AS today FROM users WHERE id = $1`,
    [userId],
  );
  return r.rows[0].today;
}

/**
 * GET /checkin/areas?lat&lng - where to go today.
 *
 * Returns ONE target, not a board. The first call of the day rolls the free
 * one; after that the target only changes when it is claimed or a new one is
 * bought with an ad, so walking towards it never moves it.
 */
checkinRouter.get(
  '/areas',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = areasSchema.parse(req.query);
    const userId = getUserId(req);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await areasStatus(pool, userId, q.lat, q.lng, await localDay(userId)));
  }),
);

const nextAreaSchema = areasSchema.extend({
  adNonce: z.string().regex(/^[0-9a-f]{32}$/),
});

/**
 * POST /checkin/areas/next { lat, lng, adNonce } - buy the next destination.
 *
 * 409 when one is already open: you get one place to go at a time, and the
 * ad is not spent on a refusal.
 */
checkinRouter.post(
  '/areas/next',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = nextAreaSchema.parse(req.body);
    res.status(201).json(await rollNextArea(getUserId(req), body.lat, body.lng, body.adNonce));
  }),
);

const checkinSchema = z.object({
  lat: z.number().min(-85).max(85),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().nonnegative().max(10_000),
  placeName: z.string().max(200).optional(),
  /** The phone's own mock-location bit. A hint, never a verdict. */
  mocked: z.boolean().optional(),
});

/**
 * POST /checkin - claim the area you were sent to.
 *
 * No ad needed: the FREE daily target is what this claims. Paying with an ad
 * happens earlier, at /checkin/areas/next, when the next destination is
 * bought. 409 when there is nowhere to go, 422 when you are not in it yet.
 */
checkinRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = checkinSchema.parse(req.body);
    res.status(201).json(await checkIn(getUserId(req), body));
  }),
);

/* -------------------------------- treasure -------------------------------- */

export const treasureRouter = Router();

const whereSchema = z.object({
  lat: z.coerce.number().min(-85).max(85).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/** GET /treasure?lat&lng - the boxes waiting for you. */
treasureRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = whereSchema.parse(req.query);
    const at = q.lat !== undefined && q.lng !== undefined ? { lat: q.lat, lng: q.lng } : undefined;
    res.setHeader('Cache-Control', 'no-store');
    res.json(await treasureStatus(getUserId(req), at));
  }),
);

const openSchema = z.object({
  lat: z.number().min(-85).max(85),
  lng: z.number().min(-180).max(180),
  /** The TREASURE_KEY ad that opens a free box (see AD_GATES). */
  adNonce: z.string().regex(/^[0-9a-f]{32}$/).optional(),
});

/** POST /treasure/:id/open - open a box you have walked to. */
treasureRouter.post(
  '/:id/open',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = z.string().uuid('No such box.').parse(req.params.id);
    const body = openSchema.parse(req.body);
    res.json(await openBox(getUserId(req), id, body, body.adNonce));
  }),
);
