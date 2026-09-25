/**
 * Is the push pipeline actually working? Run this instead of guessing.
 *
 *   npx tsx src/scripts/push-check.ts                  report only
 *   npx tsx src/scripts/push-check.ts you@example.com  also send a test push
 *
 * There are five things that have to be true for a notification to arrive,
 * and a silent phone tells you nothing about WHICH one failed. This walks
 * them in order and says so:
 *
 *   1. the account has a push token (the app registered one)
 *   2. the token has not been disabled by Expo (DeviceNotRegistered)
 *   3. push_enabled is on (the settings toggle)
 *   4. it is inside their quiet hours, in THEIR time zone
 *   5. Expo accepts the message
 *
 * The test send deliberately goes through `sendToUsers`, the same path the
 * dispatcher uses, so a pass here means the real thing works too. It does NOT
 * write a notification_sends row, so it can be run as often as you like and
 * cannot use up somebody's one-per-day.
 */
import { pool } from '../db/pool';
import { dispatchDueNotifications } from '../services/notify.service';
import { sendToUsers } from '../services/push.service';

const EARLIEST_HOUR = 9;
const LATEST_HOUR = 21;

interface Row {
  id: string;
  email: string;
  username: string;
  push_enabled: boolean;
  time_zone: string;
  local_hour: number;
  tokens: number;
  live_tokens: number;
  last_active_at: Date | null;
}

async function main(): Promise<void> {
  const email = process.argv[2];

  const { rows } = await pool.query<Row>(
    `SELECT u.id, u.email, u.username, u.push_enabled, u.time_zone,
            EXTRACT(HOUR FROM (NOW() AT TIME ZONE u.time_zone))::int AS local_hour,
            (SELECT COUNT(*)::int FROM push_tokens pt WHERE pt.user_id = u.id) AS tokens,
            (SELECT COUNT(*)::int FROM push_tokens pt
              WHERE pt.user_id = u.id AND pt.disabled_at IS NULL) AS live_tokens,
            u.last_active_at
       FROM users u
      WHERE $1::text IS NULL OR u.email = $1
      ORDER BY u.last_active_at DESC NULLS LAST
      LIMIT 20`,
    [email ?? null],
  );

  if (rows.length === 0) {
    console.log(email ? `No account with email ${email}.` : 'No accounts yet.');
    return;
  }

  console.log('\n  account                     tokens  enabled  local time  reachable now');
  console.log('  ' + '-'.repeat(74));
  for (const r of rows) {
    const inHours = r.local_hour >= EARLIEST_HOUR && r.local_hour < LATEST_HOUR;
    const reachable = r.live_tokens > 0 && r.push_enabled && inHours;
    const why = r.live_tokens === 0
      ? (r.tokens > 0 ? 'token disabled by Expo' : 'no token registered')
      : !r.push_enabled ? 'toggle off in Settings'
      : !inHours ? 'quiet hours' : 'YES';
    console.log(
      '  ' + r.username.padEnd(26) +
      String(r.live_tokens).padStart(4) + '/' + String(r.tokens) +
      (r.push_enabled ? '     on ' : '    off ') +
      String(r.local_hour).padStart(8) + ':00 ' + r.time_zone.padEnd(4) +
      '  ' + (reachable ? 'YES' : 'no - ' + why),
    );
  }

  // What the real dispatcher would do right now. Safe to run: it claims a
  // notification_sends row per person per day, so it will not double-send.
  console.log('\n  Running one real dispatch pass...');
  const sent = await dispatchDueNotifications();
  console.log(`  STREAK_RISK ${sent.STREAK_RISK}   CHEST_READY ${sent.CHEST_READY}   COMEBACK ${sent.COMEBACK}`);
  if (sent.STREAK_RISK + sent.CHEST_READY + sent.COMEBACK === 0) {
    console.log('  (nothing due - either already sent today, or nobody qualifies)');
  }

  if (!email) {
    console.log('\n  Pass an email to also send a test push to that account.\n');
    return;
  }

  const target = rows.find((r) => r.email === email);
  if (!target) return;
  if (target.live_tokens === 0) {
    console.log(`\n  Cannot test-send: ${target.username} has no live token.`);
    console.log('  Open the app on the phone, allow notifications, and run this again.\n');
    return;
  }

  console.log(`\n  Sending a test push to ${target.username}...`);
  const delivered = await sendToUsers([
    {
      userId: target.id,
      message: {
        title: 'Fareground',
        body: 'Push is working. Your land is still earning.',
        data: { kind: 'TEST' },
      },
    },
  ]);
  console.log(
    delivered > 0
      ? `  Expo accepted ${delivered}. If nothing arrives, the phone is blocking it (Android per-app settings or Do Not Disturb).\n`
      : '  Expo rejected it. Check the server log above for the ticket error.\n',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
