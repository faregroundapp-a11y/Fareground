/**
 * Builds the Express application (routes + middleware) but does NOT start it
 * listening. Keeping those separate makes the app easy to test later.
 */
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { authRouter } from './routes/auth.routes';
import { stepsRouter, attestRouter } from './routes/steps.routes';
import { parcelsRouter } from './routes/parcels.routes';
import { userRouter } from './routes/user.routes';
import { rewardsRouter } from './routes/rewards.routes';
import { dailyRouter } from './routes/daily.routes';
import { checkinRouter, leaderboardRouter, treasureRouter } from './routes/leaderboard.routes';
import { pitStopRouter } from './routes/pitstop.routes';
import { profileRouter } from './routes/profile.routes';
import { referralRouter } from './routes/referral.routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { config } from './config/env';
import { PHOTO_URL_PREFIX, UPLOAD_DIR } from './services/photo.service';

/**
 * Rate limits. These are per-IP and held in memory, which is fine for one
 * server. The moment you run more than one instance you need a shared store
 * (the `rate-limit-redis` package), or each instance will happily allow the
 * full quota on its own.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: config.rateLimitAuthMax, // login/register attempts per IP per window
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: config.rateLimitApiMax, // a phone syncing every few seconds stays well under this
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});

export function createApp() {
  const app = express();

  // Behind a host's proxy, read the player's real IP from X-Forwarded-For
  // so rate limits are per player, not shared. See TRUST_PROXY in env.ts.
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  // --- Global middleware. Order matters: these run top to bottom. ---

  app.use(helmet()); // sensible security headers
  app.use(cors()); // allow the mobile app / browser to call us
  app.use(express.json({ limit: '64kb' })); // attestation tokens can be chunky

  // --- Health check, handy for uptime monitoring. Not rate limited. ---
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'fareground-backend', time: new Date().toISOString() });
  });

  /**
   * Profile pictures, served straight off disk.
   *
   * `dotfiles: 'deny'` and express.static's own path handling keep this to
   * the upload directory; names are random hex, so nothing here is guessable.
   * Long cache lifetime is safe because a changed picture gets a NEW filename
   * rather than overwriting the old one.
   */
  app.use(
    PHOTO_URL_PREFIX,
    express.static(UPLOAD_DIR, {
      dotfiles: 'deny',
      index: false,
      maxAge: '30d',
      fallthrough: false,
    }),
  );

  // --- Feature routes. ---
  app.use('/auth', authLimiter, authRouter); // POST /auth/register, /auth/login
  app.use('/attest', apiLimiter, attestRouter); // POST /attest/challenge
  app.use('/steps', apiLimiter, stepsRouter); // POST /steps/sync
  app.use('/parcels', apiLimiter, parcelsRouter); // POST /parcels/claim, GET /parcels/nearby
  app.use('/rewards', apiLimiter, rewardsRouter); // rewarded ads: boosts and bonus WP
  app.use('/daily', apiLimiter, dailyRouter); // daily chest + quests
  app.use('/leaderboard', apiLimiter, leaderboardRouter); // weekly steps by area
  app.use('/checkin', apiLimiter, checkinRouter); // location check-ins (extras by ad)
  app.use('/treasure', apiLimiter, treasureRouter); // boxes to walk to
  app.use('/pitstops', apiLimiter, pitStopRouter); // stop on claimed land for WP
  app.use('/profile', apiLimiter, profileRouter); // profiles and badges
  app.use('/referral', apiLimiter, referralRouter); // invite a friend
  app.use('/user', apiLimiter, userRouter); // GET  /user/balance

  // --- Fallbacks. These MUST be registered last. ---
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
