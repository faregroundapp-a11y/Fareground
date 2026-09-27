/**
 * WATCHES, BANDS AND RINGS - how to get each one's steps into Fareground.
 *
 * Fareground never talks to a watch directly. Every gadget's own app writes
 * steps into the phone's health store - Health Connect on Android, Apple
 * Health on iPhone - and Fareground reads that. So "connect my Garmin" is
 * always the same job: open the Garmin app, find its Health Connect (or
 * Apple Health) switch, turn Steps on. What differs is where the switch is,
 * and that is what this list holds.
 *
 * The menu paths are where each app keeps the switch as of 2026-09; apps
 * move things, so every entry says "look for" rather than promising a path.
 * `android`/`ios` null means the brand does not share steps with that
 * platform's health store at all - said plainly, with the workaround if one
 * exists, rather than leaving someone to hunt for a switch that is not there.
 */
export interface Gadget {
  key: string;
  name: string;
  /** The companion app, as Android knows it: opened by the "Open" button. */
  androidPackage?: string;
  /** Its App Store page, for the iPhone "Open" button. */
  iosAppStore?: string;
  /** How to switch on sharing on Android (Health Connect), or null if it cannot. */
  android: string | null;
  /** How to switch on sharing on iPhone (Apple Health), or null if it cannot. */
  ios: string | null;
  /** When a platform cannot share: what to do instead. */
  workaround?: string;
}

export const GADGETS: Gadget[] = [
  {
    key: 'fitbit',
    name: 'Fitbit / Pixel Watch',
    androidPackage: 'com.fitbit.FitbitMobile',
    iosAppStore: 'https://apps.apple.com/app/fitbit-health-fitness/id462638897',
    android:
      'Open the Fitbit app, tap your profile picture, then look for Health Connect in the settings and turn on Steps. ' +
      'Fitbit only passes steps on when its app syncs with your watch, so open it after a walk if steps look behind.',
    ios: null,
    workaround:
      'Fitbit does not share steps with Apple Health. On iPhone, Fareground counts the steps your phone felt - carry it on walks.',
  },
  {
    key: 'garmin',
    name: 'Garmin',
    androidPackage: 'com.garmin.android.apps.connectmobile',
    iosAppStore: 'https://apps.apple.com/app/garmin-connect/id583446403',
    android: 'Open Garmin Connect, go to More, then Settings, then Connected Apps, and choose Health Connect. Turn on Steps.',
    ios: 'Open Garmin Connect, go to More, then Settings, then Connected Apps, and choose Apple Health. Turn on Steps.',
  },
  {
    key: 'samsung',
    name: 'Samsung Galaxy Watch',
    androidPackage: 'com.sec.android.app.shealth',
    android:
      'Open Samsung Health, tap the three dots, then Settings, then Health Connect. Allow Samsung Health to write Steps.',
    ios: null,
    workaround: 'Galaxy Watches only pair with Android phones.',
  },
  {
    key: 'apple',
    name: 'Apple Watch',
    android: null,
    ios: 'Nothing to do on the watch: it already saves steps to Apple Health. Just connect Apple Health above.',
    workaround: 'Apple Watches only pair with iPhones.',
  },
  {
    key: 'wearos',
    name: 'Other Wear OS watches',
    androidPackage: 'com.google.android.apps.fitness',
    android:
      'Most Wear OS watches count steps through Google Fit. Open Google Fit, tap Profile, then the settings cog, and turn on "Sync Fit with Health Connect".',
    ios: null,
    workaround: 'Wear OS watches only pair with Android phones.',
  },
  {
    key: 'xiaomi',
    name: 'Xiaomi / Mi Band',
    androidPackage: 'com.xiaomi.wearable',
    iosAppStore: 'https://apps.apple.com/app/mi-fitness/id1579185271',
    android: 'Open Mi Fitness, go to Profile, and look for Health Connect under third-party access. Turn on Steps.',
    ios: 'Open Mi Fitness, go to Profile, and look for Apple Health under third-party access. Turn on Steps.',
  },
  {
    key: 'amazfit',
    name: 'Amazfit (Zepp)',
    androidPackage: 'com.huami.watch.hmwatchmanager',
    iosAppStore: 'https://apps.apple.com/app/zepp-formerly-amazfit/id1127269366',
    android: 'Open Zepp, go to Profile, then Add accounts, and choose Health Connect. Turn on Steps.',
    ios: 'Open Zepp, go to Profile, then Add accounts, and choose Apple Health. Turn on Steps.',
  },
  {
    key: 'huawei',
    name: 'Huawei',
    androidPackage: 'com.huawei.health',
    iosAppStore: 'https://apps.apple.com/app/huawei-health/id1244350479',
    android: null,
    ios: 'Open Huawei Health, go to Me, then Privacy management or Data sharing, and turn on Apple Health for Steps.',
    workaround:
      'Huawei Health does not share with Health Connect. A separate app called Health Sync can copy Huawei steps into Health Connect for you.',
  },
  {
    key: 'withings',
    name: 'Withings',
    androidPackage: 'com.withings.wiscale2',
    iosAppStore: 'https://apps.apple.com/app/withings-health-mate/id542701020',
    android: 'Open Withings, go to Devices or Profile, then Health Connect, and turn on Steps.',
    ios: 'Open Withings, go to Profile, then Apple Health, and turn on Steps.',
  },
  {
    key: 'polar',
    name: 'Polar',
    androidPackage: 'fi.polar.polarflow',
    iosAppStore: 'https://apps.apple.com/app/polar-flow/id717172678',
    android: 'Open Polar Flow, go to General settings, then Health Connect, and turn on Steps.',
    ios: 'Open Polar Flow, go to General settings, then Apple Health, and turn on Steps.',
  },
  {
    key: 'oura',
    name: 'Oura Ring',
    androidPackage: 'com.ouraring.oura',
    iosAppStore: 'https://apps.apple.com/app/oura/id1043837948',
    android: 'Open Oura, go to Settings, then Health Connect, and turn on Steps.',
    ios: 'Open Oura, go to Settings, then Apple Health, and turn on Steps.',
  },
];

/** Package names that belong to a gadget, for spotting a watch among the step sources. */
export const GADGET_PACKAGES = new Set(
  [
    ...GADGETS.map((g) => g.androidPackage),
    'com.samsung.android.wear.shealth',
    'com.google.android.apps.fitness.wearable',
    'com.huami.midong',
  ].filter((p): p is string => !!p),
);
