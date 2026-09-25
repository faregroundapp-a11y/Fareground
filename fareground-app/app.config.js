/**
 * Expo config, layered over app.json.
 *
 * WHY THIS FILE EXISTS. The AdMob APP ID is a native value: it is baked into
 * AndroidManifest.xml at build time, so it cannot be read from
 * EXPO_PUBLIC_* at runtime like the ad UNIT ids can. Left in app.json it
 * would mean editing tracked source - and almost certainly committing a real
 * account id - every time it changed. Here it comes from the environment,
 * with Google's official TEST ids as the default.
 *
 * Expo reads app.json first and passes it in as `config`, so everything that
 * is not overridden below still lives there.
 *
 *   EAS builds read these from `eas.json` -> build.<profile>.env, or from
 *   EAS secrets. A local `npx expo prebuild` reads them from .env.local.
 *
 * TEST IDS ARE THE DEFAULT ON PURPOSE. A build that accidentally ships with
 * no configuration shows "Test Ad" and earns nothing, which is the safe
 * failure. Requesting real ads from a development build - or clicking your
 * own - is what gets AdMob accounts banned.
 */

/** Google's public test app ids. Safe to ship; they never earn. */
const TEST_ANDROID_APP_ID = 'ca-app-pub-3940256099942544~3347511713';
const TEST_IOS_APP_ID = 'ca-app-pub-3940256099942544~1458002511';

const env = (v) => (v && String(v).trim() ? String(v).trim() : undefined);

/** An AdMob APP id looks like ca-app-pub-<16 digits>~<10 digits>. */
const APP_ID_RE = /^ca-app-pub-\d{16}~\d{10}$/;

function appId(value, fallback, label) {
  const v = env(value);
  if (!v) return fallback;
  if (!APP_ID_RE.test(v)) {
    // Fail loudly at config time rather than shipping a build whose ads
    // silently never load. A malformed app id is a hard AdMob SDK error on
    // launch, and tracking that back from a crash report is miserable.
    throw new Error(
      `${label} is not a valid AdMob app id: "${v}". ` +
        'It should look like ca-app-pub-1234567890123456~1234567890 ' +
        '(note the ~, not the / that separates a UNIT id).',
    );
  }
  return v;
}

module.exports = ({ config }) => {
  const android = appId(process.env.ADMOB_ANDROID_APP_ID, TEST_ANDROID_APP_ID, 'ADMOB_ANDROID_APP_ID');
  const ios = appId(process.env.ADMOB_IOS_APP_ID, TEST_IOS_APP_ID, 'ADMOB_IOS_APP_ID');

  const plugins = (config.plugins ?? []).map((p) => {
    if (Array.isArray(p) && p[0] === 'react-native-google-mobile-ads') {
      return [p[0], { ...p[1], androidAppId: android, iosAppId: ios }];
    }
    return p;
  });

  return { ...config, plugins };
};
