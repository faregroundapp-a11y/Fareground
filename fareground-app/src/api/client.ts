import { API_URL } from '@/config';
import type {
  AdCompleteResult,
  AdRewardKind,
  AdTicket,
  AuthResult,
  Balance,
  AreasStatus,
  CheckinResult,
  DailyStatus,
  Leaderboard,
  LeaderboardScope,
  AvatarChoice,
  OpenBoxResult,
  Profile,
  RedeemResult,
  ReferralStatus,
  RewardClaimResult,
  TreasureStatus,
  ClaimResult,
  DeleteSummary,
  NearbyParcel,
  NeighboursHere,
  Parcel,
  PitStopResult,
  PitStopStatus,
  StepSyncResult,
} from './types';

/**
 * An error the server chose to send us, with its status code.
 * `retryable` separates "try again later" (no connection, 5xx, 429) from
 * "this request is wrong and will stay wrong" (every other 4xx).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryable = status === 0 || status === 429 || status >= 500;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

async function request<T>(
  method: Method,
  path: string,
  options: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    // No response at all: offline, wrong address, server down.
    throw new ApiError(0, `Can't reach Fareground. Check your connection. (${API_URL})`);
  }

  const text = await response.text();
  const json = text ? safeParse(text) : null;

  if (!response.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
        ? json.error
        : `Request failed (${response.status}).`;
    throw new ApiError(response.status, message);
  }

  return json as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ------------------------------ endpoints ------------------------------ */

export const api = {
  register: (username: string, email: string, password: string) =>
    request<AuthResult>('POST', '/auth/register', { body: { username, email, password } }),

  login: (email: string, password: string) =>
    request<AuthResult>('POST', '/auth/login', { body: { email, password } }),

  /** Sign in (or up) with a Google ID token. The server verifies it. */
  google: (idToken: string) => request<AuthResult>('POST', '/auth/google', { body: { idToken } }),

  /** Rewarded ads: get a ticket BEFORE showing the ad, then report back. */
  startReward: (
    token: string,
    kind: AdRewardKind,
    extra?: { targetClaimId?: string; cosmeticKey?: string; targetParcelId?: string },
  ) => request<AdTicket>('POST', '/rewards/start', { token, body: { kind, ...extra } }),

  /** Daily chest and quests. */
  daily: (token: string) => request<DailyStatus>('GET', '/daily', { token }),
  claimDaily: (token: string) => request<RewardClaimResult>('POST', '/daily/claim', { token }),
  claimQuest: (token: string, key: string) =>
    request<RewardClaimResult>('POST', `/daily/quests/${encodeURIComponent(key)}`, { token }),
  /** Weekly steps, ranked, in your city / region / country / the world. */
  leaderboard: (token: string, scope: LeaderboardScope) =>
    request<Leaderboard>('GET', `/leaderboard?scope=${scope}`, { token }),
  /** Which leaderboards you are on - named by the phone from its location. */
  setArea: (token: string, area: { city?: string; region?: string; country: string }) =>
    request<{ city: string | null; region: string | null; country: string }>('POST', '/user/area', { token, body: area }),
  /** Today's destination: where to go, and how far it still is. */
  areas: (token: string, lat: number, lng: number) =>
    request<AreasStatus>('GET', `/checkin/areas?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`, { token }),
  /** Watch an ad to be sent somewhere else. */
  nextArea: (token: string, lat: number, lng: number, adNonce: string) =>
    request<AreasStatus>('POST', '/checkin/areas/next', { token, body: { lat, lng, adNonce } }),
  checkIn: (
    token: string,
    /**
     * No area is named: this claims the target the server already assigned,
     * and the server checks your own coordinates fall inside it.
     */
    body: { lat: number; lng: number; accuracyM: number; placeName?: string; mocked?: boolean },
  ) => request<CheckinResult>('POST', '/checkin', { token, body }),

  /** The bonus chest for watching a few ads today. */
  claimAdStreak: (token: string) => request<RewardClaimResult>('POST', '/daily/adstreak', { token }),

  /** Treasure boxes to walk to. */
  treasure: (token: string, lat: number, lng: number) =>
    request<TreasureStatus>('GET', `/treasure?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`, { token }),
  openBox: (token: string, id: string, at: { lat: number; lng: number }) =>
    request<OpenBoxResult>('POST', `/treasure/${encodeURIComponent(id)}/open`, { token, body: at }),

  /** Invite a friend: your code, and using someone else's. */
  referral: (token: string) => request<ReferralStatus>('GET', '/referral', { token }),
  /** Spend coins on Walk Points (COINS_PER_WALK_POINT on the server). */
  tradeWalkPoints: (token: string, walkPoints: number) =>
    request<{ walkPoints: number; coinsSpent: number; walkPointsBalance: number; coins: number }>(
      'POST',
      '/store/walk-points',
      { token, body: { walkPoints } },
    ),
  redeemReferral: (token: string, code: string) =>
    request<RedeemResult>('POST', '/referral/redeem', { token, body: { code } }),

  profile: (token: string) => request<Profile>('GET', '/profile', { token }),
  player: (token: string, username: string) =>
    request<Profile>('GET', `/profile/${encodeURIComponent(username)}`, { token }),
  updateProfile: (token: string, body: { avatar?: AvatarChoice; username?: string; title?: string | null }) =>
    request<Profile>('PATCH', '/profile', { token, body }),
  badgesSeen: (token: string) => request<{ ok: true }>('POST', '/profile/badges/seen', { token }),

  /** So "today" on the server is the player's today. */
  setTimeZone: (token: string, timeZone: string) =>
    request<{ timeZone: string; today: string; changed: boolean }>('POST', '/user/timezone', { token, body: { timeZone } }),
  completeReward: (token: string, nonce: string, at?: { lat: number; lng: number } | null) =>
    request<AdCompleteResult>('POST', '/rewards/complete', { token, body: { nonce, ...(at ?? {}) } }),

  balance: (token: string) => request<Balance>('GET', '/user/balance', { token }),

  /**
   * Send the SAME idempotency key when retrying a sync that failed in
   * transit. The server then replays the original answer instead of paying
   * the steps out twice.
   */
  syncSteps: (
    token: string,
    body: {
      steps: number;
      platform: 'IOS' | 'ANDROID';
      deviceId: string;
      /** Which counter produced them - the server only uses it to flag, never to pay. */
      source?: 'DEVICE_SENSOR' | 'HEALTH_STORE' | 'MOTION_HISTORY' | 'UNKNOWN';
      /** Android's own "this fix is mocked" bit, when we have a fix. */
      mockedLocation?: boolean;
      /**
       * Ground the GPS trace covered over the same window. OMITTED means no
       * usable trace, which the server treats as "cannot tell" rather than
       * as zero.
       */
      distanceM?: number;
      /** Summary statistics about the trace - four floats and a count, no positions. */
      trace?: {
        samples: number;
        accuracySpreadM: number;
        altitudeSpreadM: number | null;
        straightness: number | null;
        speedAgreement: number | null;
      };
    },
    idempotencyKey: string,
  ) =>
    request<StepSyncResult>('POST', '/steps/sync', {
      token,
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  /**
   * `position` is where the player IS; `target` is the square they picked.
   * The server refuses a target that is out of reach.
   */
  claim: (
    token: string,
    position: { lat: number; lng: number; accuracyM: number; mocked?: boolean },
    target?: { cellX: number; cellY: number },
  ) => request<ClaimResult>('POST', '/parcels/claim', { token, body: { ...position, ...target } }),

  nearby: (token: string, lat: number, lng: number, radius = 300) =>
    request<{ parcels: NearbyParcel[] }>(
      'GET',
      `/parcels/nearby?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}&radius=${radius}`,
      { token },
    ),

  myParcels: (token: string) => request<{ parcels: Parcel[] }>('GET', '/parcels', { token }),

  /**
   * Change your profile picture. Costs one rewarded ad - pass its nonce.
   * `image` is base64; the phone resizes to 256x256 JPEG first.
   */
  setPhoto: (token: string, image: string, adNonce: string) =>
    request<{ photoPath: string; photoUrl: string }>('POST', '/profile/photo', {
      token,
      body: { image, adNonce },
    }),
  /** Go back to your initial. Free. */
  clearPhoto: (token: string) => request<{ ok: true }>('DELETE', '/profile/photo', { token }),
  /** Report somebody's picture. */
  reportPhoto: (token: string, username: string, reason: string, note?: string) =>
    request<{ ok: true }>('POST', '/profile/report', { token, body: { username, reason, note } }),

  /** Turn all notifications on or off for this account. */
  setPushEnabled: (token: string, enabled: boolean) =>
    request<{ ok: true; pushEnabled: boolean }>('POST', '/user/push/enabled', { token, body: { enabled } }),

  /** What deleting the account would destroy, so the warning can be specific. */
  deletionSummary: (token: string) => request<DeleteSummary>('GET', '/user/delete', { token }),
  /** Permanently delete the account. Required in-app by Google Play. */
  deleteAccount: (token: string, password?: string) =>
    request<{ deleted: true }>('POST', '/user/delete', { token, body: { password } }),

  /** Claimed parcels in reach, and the shared cooldown. */
  pitStops: (token: string, lat: number, lng: number) =>
    request<PitStopStatus>('GET', `/pitstops?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`, { token }),
  /** Stop at a parcel. `adNonce` skips whatever is left of the cooldown. */
  pitStop: (
    token: string,
    body: {
      lat: number; lng: number; accuracyM: number;
      parcelId?: string; adNonce?: string;
      /** The phone's own mock-location bit. A hint for the server, never a verdict. */
      mocked?: boolean;
    },
  ) => request<PitStopResult>('POST', '/pitstops', { token, body }),

  /** Who else owns land around here. No radius on purpose: fixed ~1 km box. */
  neighbours: (token: string, lat: number, lng: number) =>
    request<NeighboursHere>('GET', `/parcels/neighbours?lat=${lat.toFixed(6)}&lng=${lng.toFixed(6)}`, { token }),

  /**
   * Push notifications. The token is registered after sign-in and whenever
   * Expo rotates it; registering the same one twice is a no-op server-side.
   */
  /** `ok: false` means the token was not stored - notifications will not arrive. */
  registerPush: (token: string, pushToken: string, platform: 'android' | 'ios') =>
    request<{ ok: boolean }>('POST', '/user/push', { token, body: { token: pushToken, platform } }),
  removePush: (token: string, pushToken: string) =>
    request<{ ok: true }>('POST', '/user/push/remove', { token, body: { token: pushToken } }),
};
