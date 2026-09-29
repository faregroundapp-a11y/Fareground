import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, getUserId } from '../middleware/auth';
import { MAX_STEPS_PER_SYNC } from '../game/rules';
import { syncSteps } from '../services/steps.service';
import { enforceAttestationPolicy } from '../security/attestation';
import { consumeChallenge, issueChallenge } from '../security/challenge';
import { asyncHandler } from '../utils/asyncHandler';

export const stepsRouter = Router();
export const attestRouter = Router();

const syncSchema = z.object({
  // int() rejects 1500.5, nonnegative() rejects negatives, and the max is a
  // crude first guard - the real limits are applied server-side afterwards.
  steps: z
    .number({ invalid_type_error: 'steps must be a number.' })
    .int('steps must be a whole number.')
    .nonnegative('steps cannot be negative.')
    .max(MAX_STEPS_PER_SYNC, `steps must be at most ${MAX_STEPS_PER_SYNC} per sync.`),

  /**
   * The phone's own step total for each day this batch covers: today, plus a
   * finished day it is catching up on. The server pays only what is above the
   * highest total it has already seen for that day, so a phone that forgot
   * what it sent (app data cleared, reinstalled) cannot be paid twice.
   * Omitted by builds before 4, which get the old behaviour.
   */
  days: z
    .array(
      z.object({
        day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'day must be YYYY-MM-DD.'),
        total: z.number().int().nonnegative().max(500_000),
      }),
    )
    .max(8)
    .optional(),

  /** Which phone this came from. Optional until attestation is required. */
  platform: z.enum(['IOS', 'ANDROID']).optional(),
  deviceId: z.string().trim().min(1).max(255).optional(),

  /**
   * Which counter produced these steps. Advisory - a lying client can put
   * anything here, which is exactly why it only ever sets a FLAG and never
   * changes the payout.
   */
  source: z.enum(['DEVICE_SENSOR', 'HEALTH_STORE', 'MOTION_HISTORY', 'UNKNOWN']).optional(),

  /** Android: the phone's own "this location is mocked" bit, if it has one. */
  mockedLocation: z.boolean().optional(),

  /**
   * Ground the phone's GPS trace covered since the last sync, in metres.
   *
   * OMITTED means "no usable trace" and is treated very differently from a
   * reported zero - see stepDisplacementVerdict. A client can of course lie
   * about this, which is why it only ever splits steps into paid and capped
   * rather than refusing them, and why the positions it implies are checked
   * independently on every claim.
   */
  distanceM: z.number().nonnegative().max(500_000).optional(),

  /**
   * Statistics about the GPS trace itself. Real receivers are noisy; drawn
   * tracks are not. Advisory like everything else the client reports - it
   * raises a flag, never a refusal.
   */
  trace: z
    .object({
      samples: z.number().int().nonnegative().max(100_000),
      accuracySpreadM: z.number().nonnegative().max(100_000),
      altitudeSpreadM: z.number().nonnegative().max(100_000).nullable(),
      straightness: z.number().min(0).max(1).nullable(),
      speedAgreement: z.number().min(0).max(1).nullable(),
    })
    .optional(),

  /** Present only when the client has an attestation to offer. */
  attestation: z
    .object({
      token: z.string().min(1).max(20_000),
      nonce: z.string().min(1).max(64),
    })
    .optional(),
});

/**
 * POST /attest/challenge
 *
 * Step 1 of attestation: hand the client a single-use random nonce to fold
 * into its App Attest assertion (iOS) or Play Integrity request hash
 * (Android). See src/security/attestation.ts for the whole flow.
 */
attestRouter.post(
  '/challenge',
  requireAuth,
  asyncHandler(async (req, res) => {
    const challenge = await issueChallenge(getUserId(req));
    res.status(201).json(challenge);
  }),
);

/**
 * POST /steps/sync
 *
 * Body: { "steps": 3500, "platform": "IOS", "deviceId": "..." }
 * Header (recommended): Idempotency-Key: <a uuid the client generates>
 *
 * Send the SAME Idempotency-Key when retrying a sync that timed out. The
 * server recognises it and replays the original result instead of paying the
 * steps out twice. Use a fresh key for a genuinely new batch of steps.
 */
stepsRouter.post(
  '/sync',
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = syncSchema.parse(req.body);
    const userId = getUserId(req);

    const idempotencyKey = readIdempotencyKey(req.get('Idempotency-Key'));

    // Attestation, if the client offered one and the policy wants it.
    let attested = false;
    if (body.attestation && body.platform && body.deviceId) {
      // Spend the nonce FIRST so a replayed attestation is dead on arrival,
      // whatever the verifier goes on to decide.
      await consumeChallenge(userId, body.attestation.nonce);

      attested = await enforceAttestationPolicy({
        platform: body.platform,
        token: body.attestation.token,
        nonce: body.attestation.nonce,
        deviceId: body.deviceId,
      });
    } else {
      // No attestation supplied - the policy decides whether that is allowed.
      attested = await enforceAttestationPolicy(null);
    }

    const result = await syncSteps({
      userId,
      rawSteps: body.steps,
      days: body.days,
      idempotencyKey,
      platform: body.platform,
      deviceId: body.deviceId,
      attested,
      source: body.source,
      mockedLocation: body.mockedLocation,
      distanceM: body.distanceM,
      trace: body.trace,
    });

    res.status(200).json(result);
  }),
);

/** Validate the Idempotency-Key header without blowing up on a missing one. */
function readIdempotencyKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;

  const key = raw.trim();
  if (key.length === 0) return undefined;
  if (key.length > 128) {
    throw new z.ZodError([
      {
        code: z.ZodIssueCode.too_big,
        maximum: 128,
        type: 'string',
        inclusive: true,
        path: ['Idempotency-Key'],
        message: 'Idempotency-Key must be at most 128 characters.',
      },
    ]);
  }
  return key;
}
