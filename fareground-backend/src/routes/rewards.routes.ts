import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getUserId } from '../middleware/auth';
import { verifySsv } from '../security/admobSsv';
import { completeAdReward, grantFromSsv, startAdReward } from '../services/rewards.service';
import { asyncHandler } from '../utils/asyncHandler';

export const rewardsRouter = Router();

const startSchema = z.object({
  kind: z.enum([
    'BOOST', 'WALK_POINTS', 'DOUBLE', 'INSTANT_COLLECT', 'SCOUT', 'COSMETIC',
    'UPGRADE', 'EXTRA_CHECKIN', 'STREAK_SAVE', 'TREASURE', 'PIT_STOP', 'PHOTO',
    'CLAIM', 'TREASURE_KEY', 'CLAIM_BONUS',
  ]),
  /** For DOUBLE: the daily-chest or quest reward to double. */
  targetClaimId: z.string().uuid().optional(),
  /** For COSMETIC: the avatar part to unlock. */
  cosmeticKey: z.string().max(32).optional(),
  /** For UPGRADE: the parcel to improve. */
  targetParcelId: z.string().uuid().optional(),
});
const completeSchema = z.object({
  nonce: z.string().regex(/^[0-9a-f]{32}$/, 'Bad reward ticket.'),
  /** For a TREASURE box: where to put it. */
  lat: z.number().min(-85).max(85).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

/** POST /rewards/start  { "kind": "BOOST" } -> a single-use ticket. */
rewardsRouter.post(
  '/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { kind, targetClaimId, cosmeticKey, targetParcelId } = startSchema.parse(req.body);
    res.status(201).json(await startAdReward(getUserId(req), kind, targetClaimId, cosmeticKey, targetParcelId));
  }),
);

/** POST /rewards/complete  { "nonce": "..." } */
rewardsRouter.post(
  '/complete',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { nonce, lat, lng } = completeSchema.parse(req.body);
    const at = lat !== undefined && lng !== undefined ? { lat, lng } : null;
    res.json(await completeAdReward(getUserId(req), nonce, at));
  }),
);

/**
 * GET /rewards/ssv - called by GOOGLE, not by the app, so no auth header.
 * The signature is the authentication. Set this URL as the "server-side
 * verification" callback on each rewarded ad unit in the AdMob console.
 */
rewardsRouter.get(
  '/ssv',
  asyncHandler(async (req, res) => {
    const rawQuery = req.originalUrl.split('?')[1] ?? '';
    const params = await verifySsv(rawQuery);
    if (!params) {
      res.status(400).json({ error: 'Invalid signature.' });
      return;
    }
    // AdMob's "verify URL" button sends a genuine, signed callback with no
    // custom data. Acknowledge it.
    if (!params.customData) {
      res.json({ ok: true });
      return;
    }
    const outcome = await grantFromSsv({
      nonce: params.customData,
      userId: params.userId,
      transactionId: params.transactionId,
    });
    // 200 whatever the outcome, so Google stops retrying a callback we have
    // already dealt with. The outcome is logged for support.
    if (outcome === 'refused') console.warn('[ssv] refused', params.transactionId, params.userId);
    res.json({ ok: true, outcome });
  }),
);
