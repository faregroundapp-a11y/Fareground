/**
 * Loads and validates environment variables ONCE, at startup.
 *
 * Why bother? Because if DATABASE_URL is missing we want a loud, clear crash
 * the second the server boots - not a confusing error three hours later when
 * the first player tries to log in.
 */
import dotenv from 'dotenv';

// Reads the ".env" file in the project root and puts its values on process.env.
dotenv.config();

/** Fetch a variable that the app cannot run without. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        'Copy .env.example to .env and fill in the values.',
    );
  }
  return value.trim();
}

/** Fetch an optional numeric variable, falling back to a default. */
function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable "${name}" must be a number, got "${raw}".`);
  }
  return parsed;
}

/**
 * Fetch a variable that must be one of a fixed set of words. Catches typos
 * like ATTESTATION_MODE=requried at boot instead of silently doing nothing.
 */
function enumEnv<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;

  const value = raw.trim() as T;
  if (!allowed.includes(value)) {
    throw new Error(
      `Environment variable "${name}" must be one of: ${allowed.join(', ')}. Got "${raw}".`,
    );
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: numberEnv('PORT', 3000),

  databaseUrl: requireEnv('DATABASE_URL'),

  jwtSecret: requireEnv('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',

  bcryptSaltRounds: numberEnv('BCRYPT_SALT_ROUNDS', 12),

  /**
   * Rate limits. The defaults are the production-sane values; local
   * development raises them in .env so the test suite is not throttled.
   */
  rateLimitAuthMax: numberEnv('RATE_LIMIT_AUTH_MAX', 20), // per IP per 15 min
  rateLimitApiMax: numberEnv('RATE_LIMIT_API_MAX', 120), // per IP per minute

  /**
   * How many reverse proxies sit in front of the server. 0 on a PC. A host
   * like Render or Railway puts ONE proxy in front, and without this every
   * request appears to come from that proxy's IP - so all players share a
   * single rate-limit bucket and 20 sign-ins lock everybody out.
   */
  trustProxy: numberEnv('TRUST_PROXY', 0),

  /**
   * Device attestation policy - see src/security/attestation.ts.
   *   off       do not check at all (local development)
   *   optional  verify when supplied, but never block  (use during rollout)
   *   required  no valid attestation, no step sync
   */
  attestationMode: enumEnv('ATTESTATION_MODE', ['off', 'optional', 'required'] as const, 'off'),

  /**
   * How a rewarded ad is confirmed before it pays out - see
   * services/rewards.service.ts.
   *   client  trust the phone (local development only: Google cannot reach
   *           a server on your Wi-Fi to confirm the ad)
   *   ssv     wait for Google's signed server-side callback (production)
   */
  adRewardVerification: enumEnv(
    'AD_REWARD_VERIFICATION',
    ['client', 'ssv'] as const,
    process.env.NODE_ENV === 'production' ? 'ssv' : 'client',
  ),

  /**
   * OAuth client ids whose Google ID tokens may sign people in. Comma
   * separated. The Android app asks Google for a token addressed to the
   * WEB client id, so that is the one that must be listed.
   */
  /**
   * TESTING ONLY: accounts (by email, comma separated) whose every claim is a
   * RUBY. Ignored completely when NODE_ENV=production, so it cannot leak into
   * the real game even if the variable is left set.
   */
  devLuckyEmails:
    process.env.NODE_ENV === 'production'
      ? []
      : (process.env.DEV_LUCKY_EMAILS ?? '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),

  googleClientIds: (process.env.GOOGLE_CLIENT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** Needed by the Apple App Attest verifier when you implement it. */
  appleTeamId: process.env.APPLE_TEAM_ID ?? '',
  appleBundleId: process.env.APPLE_BUNDLE_ID ?? '',

  /** Needed by the Google Play Integrity verifier when you implement it. */
  androidPackageName: process.env.ANDROID_PACKAGE_NAME ?? '',
  googleServiceAccountJson: process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
} as const;

export const isProduction = config.nodeEnv === 'production';
