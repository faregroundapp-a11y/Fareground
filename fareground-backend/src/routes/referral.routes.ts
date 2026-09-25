import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getUserId } from '../middleware/auth';
import { redeemReferral, referralStatus } from '../services/referral.service';
import { asyncHandler } from '../utils/asyncHandler';

export const referralRouter = Router();

/** GET /referral - your code and how your invites are doing. */
referralRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await referralStatus(getUserId(req)));
  }),
);

const redeemSchema = z.object({ code: z.string().trim().min(4).max(12) });

/** POST /referral/redeem { code } - new accounts only, once each. */
referralRouter.post(
  '/redeem',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { code } = redeemSchema.parse(req.body);
    res.status(201).json(await redeemReferral(getUserId(req), code));
  }),
);
