/**
 * Where the backend lives.
 *
 * Set EXPO_PUBLIC_API_URL in fareground-app/.env.local. It must be an address
 * the PHONE can reach - `localhost` on a phone means the phone itself, not
 * your computer. Use your computer's LAN address, e.g. http://192.168.1.20:3000.
 * (Android emulator only: http://10.0.2.2:3000 reaches the host machine.)
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000').replace(/\/+$/, '');

/**
 * Free vector map tiles from OpenFreeMap - no API key, no account. Built on
 * OpenStreetMap data, so the attribution control must stay visible.
 *
 * "liberty" is the full-colour style, with its own 3D buildings. (A pale
 * "positron" variant was tried and reverted - it read as washed out.)
 */
export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Must match MAX_CLAIM_ACCURACY_M in the backend's parcels.service.ts. */
export const MAX_CLAIM_ACCURACY_M = 25;

/**
 * Fallbacks only, for the moment before the first balance arrives. The
 * server sends the real numbers (`parcelPrice`, `stepsPerWalkPoint`) with
 * every balance and is always the authority - these exist so the sign-up
 * screen and the first frame have something to show.
 *
 * The price is FLAT now (every parcel 50 WP), so this fallback is correct
 * rather than just approximately right. It used to rise with land held.
 * Keep it in step with PARCEL_BASE_PRICE_WP in the backend's rules.ts;
 * nothing tests that they match.
 */
export const DEFAULT_PARCEL_PRICE = 50;
export const DEFAULT_STEPS_PER_WP = 100;

/**
 * AdMob ad unit ids. Until real ones are set in .env.local these are
 * Google's official TEST units - they show "Test Ad" and earn nothing, which
 * is exactly what you want while developing (clicking your own real ads can
 * get an AdMob account banned).
 */
const env = (v: string | undefined) => (v && v.trim() ? v.trim() : undefined);
export const ADMOB_UNITS = {
  rewarded: env(process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID),
};

/**
 * The WEB OAuth client id from Google Cloud Console. Android asks Google for
 * an ID token addressed to this id, and the backend checks it (its
 * GOOGLE_CLIENT_IDS must contain the same value). Empty = button hidden.
 */
export const GOOGLE_WEB_CLIENT_ID = env(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID);

/**
 * The privacy policy, linked from Settings.
 *
 * Google Play AND AdMob both require one reachable from inside the app, not
 * only from the store listing. This points at the marketing site; it must be
 * live before the first Play submission.
 */
export const PRIVACY_URL = env(process.env.EXPO_PUBLIC_PRIVACY_URL) ?? 'https://play.fareground.app/privacy';

/** Where "Contact support" writes to. */
export const SUPPORT_EMAIL = env(process.env.EXPO_PUBLIC_SUPPORT_EMAIL) ?? 'support@fareground.app';

