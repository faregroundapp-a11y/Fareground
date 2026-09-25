#!/usr/bin/env node
/**
 * Is AdMob actually connected, or is this build still on Google's test ads?
 *
 *   node scripts/admob-check.js
 *
 * Every one of these can be wrong in a way that shows no error at all: a
 * build on test ids runs perfectly and earns nothing, and a real unit id in
 * a development build earns nothing either (Google refuses to serve, and
 * clicking your own ads gets the account banned). So the state is worth
 * printing rather than remembering.
 *
 * Reads the resolved Expo config, so it sees exactly what a build would.
 */
const { execFileSync } = require('node:child_process');

const TEST_APP_IDS = new Set([
  'ca-app-pub-3940256099942544~3347511713',
  'ca-app-pub-3940256099942544~1458002511',
]);

/** Google's public test REWARDED unit ids. */
const TEST_UNIT_IDS = new Set([
  'ca-app-pub-3940256099942544/5224354917',
  'ca-app-pub-3940256099942544/1712485313',
]);

const UNIT_RE = /^ca-app-pub-\d{16}\/\d{10}$/;

function resolvedConfig() {
  const out = execFileSync('npx', ['expo', 'config', '--type', 'public', '--json'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  // `expo config` can print a banner before the JSON.
  return JSON.parse(out.slice(out.indexOf('{')));
}

function row(label, value, ok, note) {
  const mark = ok ? 'OK  ' : '--  ';
  console.log(`  ${mark}${label.padEnd(22)}${value}`);
  if (note) console.log(`      ${note}`);
}

const config = resolvedConfig();
const ads = (config.plugins ?? []).find((p) => Array.isArray(p) && p[0] === 'react-native-google-mobile-ads');
const opts = ads?.[1] ?? {};

console.log('\n  AdMob wiring\n  ' + '-'.repeat(60));

const androidReal = opts.androidAppId && !TEST_APP_IDS.has(opts.androidAppId);
row('Android app id', opts.androidAppId ?? '(missing)', !!androidReal,
  androidReal ? undefined : 'test id - set ADMOB_ANDROID_APP_ID (needs a rebuild to take effect)');

const iosReal = opts.iosAppId && !TEST_APP_IDS.has(opts.iosAppId);
row('iOS app id', opts.iosAppId ?? '(missing)', !!iosReal,
  iosReal ? undefined : 'test id - set ADMOB_IOS_APP_ID');

const unit = process.env.EXPO_PUBLIC_ADMOB_REWARDED_ID?.trim();
const unitReal = unit && UNIT_RE.test(unit) && !TEST_UNIT_IDS.has(unit);
row('Rewarded unit id', unit || '(unset - falls back to a test unit)', !!unitReal,
  !unit
    ? 'set EXPO_PUBLIC_ADMOB_REWARDED_ID in .env.local; this one is read at RUNTIME, so no rebuild'
    : !UNIT_RE.test(unit)
      ? 'malformed - a UNIT id uses / not ~, e.g. ca-app-pub-1234567890123456/1234567890'
      : undefined);

console.log('\n  What is left, in order\n  ' + '-'.repeat(60));
const steps = [
  [androidReal, 'Create the AdMob account and an Android app, and set ADMOB_ANDROID_APP_ID.'],
  [unitReal, 'Create ONE rewarded unit, set EXPO_PUBLIC_ADMOB_REWARDED_ID (every rewarded ad in the game shares it).'],
  [false, 'Put the server somewhere public with HTTPS.'],
  [false, 'On the rewarded unit: Server-side verification -> <server>/rewards/ssv'],
  [false, 'Backend .env: AD_REWARD_VERIFICATION=ssv (until then the phone is trusted, which is dev-only).'],
  [false, 'One EAS build, because the app id is native.'],
];
let n = 0;
for (const [done, text] of steps) {
  n += 1;
  console.log(`  ${done ? '[x]' : '[ ]'} ${n}. ${text}`);
}
console.log('\n  Until step 5 the game runs fine on test ads and earns nothing.\n');
