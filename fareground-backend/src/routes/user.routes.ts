import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getUserId } from '../middleware/auth';
import { getBalanceWithLazyEvaluation } from '../services/user.service';
import { setTimeZone } from '../services/daily.service';
import { setArea } from '../services/leaderboard.service';
import { deleteAccount, deletionSummary } from '../services/account.service';
import { disablePushToken, registerPushToken, setPushEnabled } from '../services/push.service';
import { asyncHandler } from '../utils/asyncHandler';

export const userRouter = Router();

/**
 * GET /user/balance
 *
 * Careful: this is a GET but it WRITES (it credits passive coins). That is a
 * deliberate trade-off for Step 1 - the client asks for a balance exactly when
 * it wants one settled. Just be aware it must never be cached, which is why
 * we set Cache-Control below.
 */
userRouter.get(
  '/balance',
  requireAuth,
  asyncHandler(async (req, res) => {
    const balance = await getBalanceWithLazyEvaluation(getUserId(req));

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(balance);
  }),
);

const tzSchema = z.object({ timeZone: z.string().trim().min(1).max(64) });

/** POST /user/timezone { "timeZone": "Europe/London" } - so "today" is yours. */
userRouter.post(
  '/timezone',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { timeZone } = tzSchema.parse(req.body);
    res.json(await setTimeZone(getUserId(req), timeZone));
  }),
);

const areaSchema = z.object({
  city: z.string().max(200).optional(),
  region: z.string().max(200).optional(),
  country: z.string().min(1).max(200),
});

/**
 * POST /user/area { city, region, country } - which leaderboards you are on.
 * The phone names the area from its own location; only names are stored.
 */
userRouter.post(
  '/area',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await setArea(getUserId(req), areaSchema.parse(req.body)));
  }),
);

const pushSchema = z.object({
  token: z.string().trim().min(1).max(255),
  platform: z.enum(['android', 'ios']).default('android'),
});

/**
 * POST /user/push { token, platform } - remember this device.
 *
 * The app sends this after sign-in and again whenever Expo hands it a new
 * token (they rotate). Registering the same token twice is a no-op, so the
 * app can call it as often as it likes.
 */
userRouter.post(
  '/push',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { token, platform } = pushSchema.parse(req.body);
    const stored = await registerPushToken(getUserId(req), token, platform);
    // Truthful: a token we could not store means notifications will never
    // arrive, and the app should not be told otherwise.
    res.json({ ok: stored });
  }),
);

/** POST /user/push/remove { token } - signing out, or turning this device off. */
userRouter.post(
  '/push/remove',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { token } = pushSchema.parse(req.body);
    await disablePushToken(getUserId(req), token);
    res.json({ ok: true });
  }),
);

const pushPrefSchema = z.object({ enabled: z.boolean() });

/** POST /user/push/enabled { enabled } - the whole-account switch. */
userRouter.post(
  '/push/enabled',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { enabled } = pushPrefSchema.parse(req.body);
    await setPushEnabled(getUserId(req), enabled);
    res.json({ ok: true, pushEnabled: enabled });
  }),
);

/* --------------------------- deleting an account --------------------------- */

/**
 * GET /user/delete - what deletion would destroy.
 *
 * A confirmation that says "this deletes your account" is worth much less than
 * one that says "this deletes 47 parcels and 320,000 coins". The app asks for
 * this first so it can be specific.
 */
userRouter.get(
  '/delete',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await deletionSummary(getUserId(req)));
  }),
);

const deleteSchema = z.object({ password: z.string().max(128).optional() });

/**
 * POST /user/delete { password? } - permanently delete the account.
 *
 * Required by Google Play for any app with accounts. Everything cascades, so
 * this really does remove the steps, the land, the ledger and the push tokens.
 * The freed parcels become claimable by other players again.
 */
userRouter.post(
  '/delete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { password } = deleteSchema.parse(req.body);
    await deleteAccount(getUserId(req), password);
    res.status(200).json({ deleted: true });
  }),
);
