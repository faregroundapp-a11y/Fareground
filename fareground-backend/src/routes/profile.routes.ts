import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getUserId } from '../middleware/auth';
import { markBadgesSeen, myProfile, publicProfile, updateProfile } from '../services/profile.service';
import { asyncHandler } from '../utils/asyncHandler';
import { REPORT_REASONS, clearPhoto, reportPhoto, setPhoto } from '../services/photo.service';
import { spendPhotoAd } from '../services/rewards.service';
import { query } from '../db/pool';

export const profileRouter = Router();

/** GET /profile - you, with progress on every badge. */
profileRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await myProfile(getUserId(req)));
  }),
);

const patchSchema = z.object({
  username: z.string().trim().min(3).max(32).optional(),
  title: z.string().max(32).nullable().optional(),
  avatar: z
    .object({
      skin: z.string().max(32).optional(),
      hair: z.string().max(32).optional(),
      hat: z.string().max(32).optional(),
      shirt: z.string().max(32).optional(),
      face: z.string().max(32).optional(),
    })
    .optional(),
});

/** PATCH /profile { username?, title?, avatar? } */
profileRouter.patch(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await updateProfile(getUserId(req), patchSchema.parse(req.body)));
  }),
);

/** POST /profile/badges/seen - clears the "new badge" dot. */
profileRouter.post(
  '/badges/seen',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await markBadgesSeen(getUserId(req)));
  }),
);

const usernameSchema = z.string().trim().min(1).max(32).regex(/^[a-zA-Z0-9_]+$/, 'No such player.');

/** GET /profile/:username - another player's public profile. */
profileRouter.get(
  '/:username',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await publicProfile(getUserId(req), usernameSchema.parse(req.params.username)));
  }),
);

/* ------------------------------- photos ------------------------------- */

const photoSchema = z.object({
  /** A base64 JPEG or PNG. The phone resizes to ~256x256 before sending. */
  image: z.string().min(16).max(800_000),
  /** The rewarded-ad ticket that pays for the change. */
  adNonce: z.string().regex(/^[0-9a-f]{32}$/),
});

/**
 * POST /profile/photo { image, adNonce }
 *
 * Changing your picture costs one rewarded ad. The ad is spent AFTER the
 * image has been validated and stored, so a rejected file (wrong type, too
 * big) leaves the ticket intact to try again with a different one.
 */
profileRouter.post(
  '/photo',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = photoSchema.parse(req.body);
    const userId = getUserId(req);
    const result = await setPhoto(userId, body.image);
    await spendPhotoAd({ query }, userId, body.adNonce);
    res.status(201).json(result);
  }),
);

/** DELETE /profile/photo - going back to your initial. Free. */
profileRouter.delete(
  '/photo',
  requireAuth,
  asyncHandler(async (req, res) => {
    await clearPhoto(getUserId(req));
    res.json({ ok: true });
  }),
);

const reportSchema = z.object({
  username: z.string().min(1).max(32),
  reason: z.enum(REPORT_REASONS as unknown as [string, ...string[]]),
  note: z.string().max(500).optional(),
});

/**
 * POST /profile/report { username, reason, note? }
 *
 * Reporting somebody's picture. Google Play requires this to exist for any
 * app carrying user images; `npm run moderate` is the other half.
 */
profileRouter.post(
  '/report',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = reportSchema.parse(req.body);
    await reportPhoto(getUserId(req), body.username, body.reason as never, body.note);
    res.status(202).json({ ok: true });
  }),
);
