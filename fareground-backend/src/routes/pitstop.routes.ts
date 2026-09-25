import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getUserId } from '../middleware/auth';
import { pitStop, pitStopStatus } from '../services/pitstop.service';
import { asyncHandler } from '../utils/asyncHandler';

export const pitStopRouter = Router();

const latitude = z.number().min(-85).max(85);
const longitude = z.number().min(-180).max(180);

const whereSchema = z.object({
  lat: z.coerce.number().pipe(latitude),
  lng: z.coerce.number().pipe(longitude),
});

/**
 * GET /pitstops?lat=51.5129&lng=-0.1471
 *
 * Claimed parcels within reach, what each would pay, when each pays again,
 * and how long is left on the five-minute clock.
 */
pitStopRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = whereSchema.parse(req.query);
    res.json(await pitStopStatus(getUserId(req), q.lat, q.lng));
  }),
);

const stopSchema = z.object({
  lat: latitude,
  lng: longitude,
  accuracyM: z.number().nonnegative().max(10_000),
  /** The phone's own mock-location bit. A hint, never a verdict. */
  mocked: z.boolean().optional(),
  /** Which parcel. Omitted means the nearest one in reach. */
  parcelId: z.string().uuid().optional(),
  /** A rewarded-ad ticket, which skips whatever is left of the cooldown. */
  adNonce: z.string().regex(/^[0-9a-f]{32}$/).optional(),
});

/**
 * POST /pitstops { lat, lng, accuracyM, parcelId?, adNonce? }
 *
 * 429 when the cooldown is still running and no ad was offered - the message
 * carries the seconds left, so the app can show a countdown rather than a
 * blank refusal.
 */
pitStopRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = stopSchema.parse(req.body);
    const result = await pitStop(getUserId(req), body, body.adNonce);
    res.status(201).json(result);
  }),
);
