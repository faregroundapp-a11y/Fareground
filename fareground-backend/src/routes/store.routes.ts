import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getUserId } from '../middleware/auth';
import { MAX_WALK_POINTS_PER_TRADE } from '../game/rules';
import { tradeCoinsForWalkPoints } from '../services/store.service';
import { asyncHandler } from '../utils/asyncHandler';

export const storeRouter = Router();

const tradeSchema = z.object({ walkPoints: z.number().int().min(1).max(MAX_WALK_POINTS_PER_TRADE) });

/** POST /store/walk-points { walkPoints } - spend coins on Walk Points. */
storeRouter.post(
  '/walk-points',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { walkPoints } = tradeSchema.parse(req.body);
    res.status(201).json(await tradeCoinsForWalkPoints(getUserId(req), walkPoints));
  }),
);
