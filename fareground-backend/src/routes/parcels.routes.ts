import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getUserId } from '../middleware/auth';
import {
  MAX_NEARBY_RADIUS_M,
  claimParcel,
  myParcels,
  nearbyParcels,
} from '../services/parcels.service';
import { neighboursHere } from '../services/neighbours.service';
import { asyncHandler } from '../utils/asyncHandler';

export const parcelsRouter = Router();

const latitude = z.number().min(-85, 'The map does not reach that far north or south.').max(85);
const longitude = z.number().min(-180).max(180);

const claimSchema = z.object({
  lat: latitude,
  lng: longitude,
  /** The phone's own estimate of how wrong its fix might be, in metres. */
  accuracyM: z.number().nonnegative().max(10_000),
  /** The phone's own mock-location bit. A hint, never a verdict. */
  mocked: z.boolean().optional(),
  /** Optional: the square the player picked. Must be within reach. */
  cellX: z.number().int().optional(),
  cellY: z.number().int().optional(),
  /** The CLAIM ad that pays for this parcel (see AD_GATES). */
  adNonce: z.string().regex(/^[0-9a-f]{32}$/).optional(),
}).refine((b) => (b.cellX === undefined) === (b.cellY === undefined), {
  message: 'Send both cellX and cellY, or neither.',
});

/**
 * POST /parcels/claim
 * Body: { "lat": 51.5129, "lng": -0.1471, "accuracyM": 6, "cellX": -1170, "cellY": 479466 }
 *
 * `lat`/`lng` is where the player IS. `cellX`/`cellY` (optional) is the square
 * they picked; the server refuses it if it is out of reach. Without it, the
 * square under the player is claimed.
 */
parcelsRouter.post(
  '/claim',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = claimSchema.parse(req.body);
    const target =
      body.cellX !== undefined && body.cellY !== undefined ? { cellX: body.cellX, cellY: body.cellY } : undefined;
    const result = await claimParcel(getUserId(req), body, target, body.adNonce);
    res.status(201).json(result);
  }),
);

const nearbySchema = z.object({
  lat: z.coerce.number().pipe(latitude),
  lng: z.coerce.number().pipe(longitude),
  radius: z.coerce.number().positive().max(MAX_NEARBY_RADIUS_M).default(300),
});

/** GET /parcels/nearby?lat=51.5129&lng=-0.1471&radius=300 */
parcelsRouter.get(
  '/nearby',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = nearbySchema.parse(req.query);
    const parcels = await nearbyParcels(getUserId(req), { lat: q.lat, lng: q.lng, radiusM: q.radius });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ parcels });
  }),
);

/** GET /parcels - everything you own. */
parcelsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ parcels: await myParcels(getUserId(req)) });
  }),
);

const hereSchema = z.object({
  lat: z.coerce.number().pipe(latitude),
  lng: z.coerce.number().pipe(longitude),
});

/**
 * GET /parcels/neighbours?lat=51.5129&lng=-0.1471
 *
 * Who else owns land around here. Note there is NO radius: the area is a
 * fixed ~1 km square, so nobody can shrink the query to pin a person down.
 * Names are never attached to a square - see neighbours.service.ts.
 */
parcelsRouter.get(
  '/neighbours',
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = hereSchema.parse(req.query);
    res.json(await neighboursHere(getUserId(req), q.lat, q.lng));
  }),
);
