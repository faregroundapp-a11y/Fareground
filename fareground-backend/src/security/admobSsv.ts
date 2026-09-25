/**
 * AdMob rewarded-ad server-side verification (SSV).
 *
 * When a player finishes a rewarded ad, Google calls our /rewards/ssv URL
 * with the details in the query string, signed with one of Google's ECDSA
 * keys. The signature covers every parameter BEFORE `&signature=`, exactly as
 * sent, so we verify against the raw query string, not a re-encoded copy.
 *
 * Google publishes its current keys here, and rotates them - so they are
 * fetched and cached, and re-fetched when a key id we do not know shows up.
 * https://developers.google.com/admob/android/ssv
 */
import { createPublicKey, verify } from 'node:crypto';

const KEYS_URL = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const CACHE_MS = 12 * 60 * 60 * 1000;

let cache: { at: number; keys: Map<string, string> } | null = null;

async function loadKeys(force = false): Promise<Map<string, string>> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.keys;
  const res = await fetch(KEYS_URL);
  if (!res.ok) throw new Error(`Could not fetch AdMob verifier keys (${res.status}).`);
  const json = (await res.json()) as { keys: { keyId: number | string; pem: string }[] };
  const keys = new Map(json.keys.map((k) => [String(k.keyId), k.pem]));
  cache = { at: Date.now(), keys };
  return keys;
}

export interface SsvParams {
  customData: string;
  userId: string;
  transactionId: string;
  rewardAmount: string;
  rewardItem: string;
  adUnit: string;
}

/**
 * Check a callback's signature. `rawQuery` is everything after the `?`.
 * Returns the parsed parameters when genuine, or null when not.
 */
export async function verifySsv(rawQuery: string): Promise<SsvParams | null> {
  const sigAt = rawQuery.indexOf('&signature=');
  if (sigAt < 0) return null;
  const message = rawQuery.slice(0, sigAt);

  const params = new URLSearchParams(rawQuery);
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  if (!signature || !keyId) return null;

  let keys = await loadKeys();
  if (!keys.has(keyId)) keys = await loadKeys(true); // rotated since we cached
  const pem = keys.get(keyId);
  if (!pem) return null;

  const ok = verify(
    'sha256',
    Buffer.from(message, 'utf8'),
    { key: createPublicKey(pem), dsaEncoding: 'der' },
    Buffer.from(signature, 'base64url'),
  );
  if (!ok) return null;

  return {
    customData: params.get('custom_data') ?? '',
    userId: params.get('user_id') ?? '',
    transactionId: params.get('transaction_id') ?? '',
    rewardAmount: params.get('reward_amount') ?? '',
    rewardItem: params.get('reward_item') ?? '',
    adUnit: params.get('ad_unit') ?? '',
  };
}
