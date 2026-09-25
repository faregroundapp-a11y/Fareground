/**
 * Push notifications: the delivery layer.
 *
 * Registering a device, sending through Expo's push service, and retiring
 * tokens the moment Expo tells us a device is gone. WHAT to send and WHEN is
 * `notify.service.ts` - this file only knows how to get a message onto a
 * phone.
 *
 * Expo is used rather than FCM directly because the app is an Expo app: one
 * endpoint covers Android and iOS, and no service-account key has to live on
 * the server. If the app ever leaves Expo, only this file changes.
 */
import { pool } from '../db/pool';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Expo rejects batches larger than this. */
const MAX_BATCH = 100;

/** An Expo token always looks like this; anything else is a bug or an attack. */
const TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;

export const isExpoPushToken = (t: string) => TOKEN_RE.test(t);

export interface PushMessage {
  title: string;
  body: string;
  /** Read by the app to decide which screen to open. */
  data?: Record<string, string>;
}

/**
 * Remember a device against an account.
 *
 * The token is UNIQUE table-wide on purpose: if this phone was previously
 * signed in as someone else, that row is moved to the new owner rather than
 * duplicated, so the previous account stops receiving on a phone it no longer
 * has.
 */
/**
 * Remember a device. Returns whether the token was actually stored.
 *
 * IT USED TO RETURN void AND THE ROUTE ALWAYS REPLIED `ok: true`. A token
 * that failed the format check was quietly dropped while the app was told it
 * had registered - so notifications simply never arrived and nothing,
 * anywhere, said why. That is the exact failure push-check.ts was written to
 * diagnose, produced by our own endpoint.
 *
 * Still not an ERROR: a format we do not recognise should not break sign-in
 * if Expo ever changes it. But the caller is now told, and the server says so
 * in the log.
 */
export async function registerPushToken(
  userId: string,
  token: string,
  platform: 'android' | 'ios',
): Promise<boolean> {
  if (!isExpoPushToken(token)) {
    console.warn(`[push] refused a token that is not an Expo push token: ${token.slice(0, 24)}…`);
    return false;
  }
  await pool.query(
    `INSERT INTO push_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           platform = EXCLUDED.platform,
           last_seen_at = NOW(),
           disabled_at = NULL`,
    [userId, token, platform],
  );
  return true;
}

/** Signing out, or turning notifications off on this device. */
export async function disablePushToken(userId: string, token: string): Promise<void> {
  await pool.query(
    'UPDATE push_tokens SET disabled_at = NOW() WHERE user_id = $1 AND token = $2 AND disabled_at IS NULL',
    [userId, token],
  );
}

/** The whole-account switch, from the app's settings. */
export async function setPushEnabled(userId: string, enabled: boolean): Promise<void> {
  await pool.query('UPDATE users SET push_enabled = $2 WHERE id = $1', [userId, enabled]);
}

async function liveTokensFor(userIds: string[]): Promise<Map<string, string[]>> {
  const byUser = new Map<string, string[]>();
  if (userIds.length === 0) return byUser;
  const r = await pool.query<{ user_id: string; token: string }>(
    `SELECT pt.user_id, pt.token
       FROM push_tokens pt
       JOIN users u ON u.id = pt.user_id
      WHERE pt.user_id = ANY($1::uuid[]) AND pt.disabled_at IS NULL AND u.push_enabled`,
    [userIds],
  );
  for (const row of r.rows) {
    const list = byUser.get(row.user_id) ?? [];
    list.push(row.token);
    byUser.set(row.user_id, list);
  }
  return byUser;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Send one message per user. Returns how many devices accepted it.
 *
 * Never throws: a push failing must not take down whatever triggered it. A
 * missed notification is a missed notification; a 500 on /user/balance
 * because Expo was slow is a broken app.
 */
export async function sendToUsers(messages: { userId: string; message: PushMessage }[]): Promise<number> {
  if (messages.length === 0) return 0;

  const tokens = await liveTokensFor(messages.map((m) => m.userId));

  // Flatten to one Expo message per DEVICE, remembering which token produced
  // which entry so an error can be traced back to the row to disable.
  const outgoing: { token: string; body: Record<string, unknown> }[] = [];
  for (const { userId, message } of messages) {
    for (const token of tokens.get(userId) ?? []) {
      outgoing.push({
        token,
        body: {
          to: token,
          title: message.title,
          body: message.body,
          data: message.data ?? {},
          sound: 'default',
          channelId: 'default',
          priority: 'high',
        },
      });
    }
  }
  if (outgoing.length === 0) return 0;

  let accepted = 0;
  for (let i = 0; i < outgoing.length; i += MAX_BATCH) {
    const chunk = outgoing.slice(i, i + MAX_BATCH);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(chunk.map((c) => c.body)),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        console.warn(`[push] Expo returned ${res.status}`);
        continue;
      }
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];

      const dead: string[] = [];
      tickets.forEach((ticket, n) => {
        if (ticket.status === 'ok') {
          accepted += 1;
          return;
        }
        // The device was uninstalled or the token rotated. Retire it, or we
        // keep paying to shout into the void every day forever.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          const token = chunk[n]?.token;
          if (token) dead.push(token);
        } else {
          console.warn(`[push] ${ticket.details?.error ?? 'error'}: ${ticket.message ?? ''}`);
        }
      });
      if (dead.length > 0) {
        await pool.query('UPDATE push_tokens SET disabled_at = NOW() WHERE token = ANY($1::text[])', [dead]);
      }
    } catch (e) {
      console.warn('[push] send failed:', e instanceof Error ? e.message : e);
    }
  }
  return accepted;
}
