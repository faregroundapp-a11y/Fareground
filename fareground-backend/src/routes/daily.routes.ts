import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getUserId } from '../middleware/auth';
import { claimAdStreak, claimDaily, claimQuest, dailyStatus } from '../services/daily.service';
import { asyncHandler } from '../utils/asyncHandler';

export const dailyRouter = Router();

/** GET /daily - today's chest and quests, with progress. */
dailyRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await dailyStatus(getUserId(req)));
  }),
);

/** POST /daily/claim - open today's chest. */
dailyRouter.post(
  '/claim',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(201).json(await claimDaily(getUserId(req)));
  }),
);

/** POST /daily/adstreak - the bonus chest for watching a few ads today. */
dailyRouter.post(
  '/adstreak',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(201).json(await claimAdStreak(getUserId(req)));
  }),
);

const questKey = z.string().regex(/^[a-z0-9_]{1,32}$/, 'Unknown quest.');

/** POST /daily/quests/:key - collect a finished quest. */
dailyRouter.post(
  '/quests/:key',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.status(201).json(await claimQuest(getUserId(req), questKey.parse(req.params.key)));
  }),
);
