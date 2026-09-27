import { Linking, Platform } from 'react-native';
import { optional } from './optional';

/**
 * Android step history from Health Connect.
 *
 * Health Connect is Android's shared health store (built in from Android 14,
 * an app from the Play Store before that). Phones and fitness apps (Samsung
 * Health, Google Fit, Fitbit, the phone's own step counter on newer Pixels)
 * write steps into it all day - including while Fareground is closed. Reading
 * "steps since midnight" from it is what finally gives Android the same
 * behaviour iOS gets from the motion coprocessor.
 */
type HC = typeof import('react-native-health-connect');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: an import would crash builds without the native module (see optional.ts)
const hc = Platform.OS === 'android' ? optional<HC>(() => require('react-native-health-connect'), 'HealthConnect') : null;

export type HealthStatus =
  | 'unsupported' // not Android, or this build lacks the module
  | 'not-installed' // Health Connect missing or needs an update
  | 'needs-permission'
  | 'ready';

let initialised = false;

async function init(): Promise<boolean> {
  if (!hc) return false;
  if (initialised) return true;
  const status = await hc.getSdkStatus();
  if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return false;
  initialised = await hc.initialize();
  return initialised;
}

export async function healthStatus(): Promise<HealthStatus> {
  if (!hc) return 'unsupported';
  try {
    const status = await hc.getSdkStatus();
    if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'not-installed';
    if (!(await init())) return 'not-installed';
    const granted = await hc.getGrantedPermissions();
    return granted.some((p) => p.recordType === 'Steps' && p.accessType === 'read') ? 'ready' : 'needs-permission';
  } catch {
    return 'unsupported';
  }
}

/**
 * Show Health Connect's own permission screen. Resolves true if steps were
 * granted.
 *
 * Asks for READING IN THE BACKGROUND in the same screen, so the periodic step
 * sync (native/backgroundSteps.ts) works without a second prompt. Older
 * Health Connect versions do not know that permission and reject the whole
 * request, so on failure it asks again for steps alone.
 */
export async function requestHealthPermission(): Promise<boolean> {
  if (!hc || !(await init())) return false;
  const steps = { accessType: 'read', recordType: 'Steps' } as const;
  const hasSteps = (granted: { recordType: string; accessType?: string }[]) =>
    granted.some((p) => p.recordType === 'Steps' && p.accessType === 'read');
  try {
    return hasSteps(
      await hc.requestPermission([steps, { accessType: 'read', recordType: 'BackgroundAccessPermission' }]),
    );
  } catch {
    try {
      return hasSteps(await hc.requestPermission([steps]));
    } catch {
      return false;
    }
  }
}

/** Open Health Connect itself - to connect a step source. */
export function openHealthConnect(): void {
  try {
    hc?.openHealthConnectSettings();
  } catch {
    /* nothing to open */
  }
}

/**
 * Before Android 14 Health Connect is a separate app, and its settings
 * screen cannot open until it is installed - so send the player straight to
 * its Play Store page instead of a button that silently does nothing.
 */
export function installHealthConnect(): void {
  Linking.openURL('market://details?id=com.google.android.apps.healthdata').catch(() => {
    void Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata');
  });
}

/**
 * Steps between two moments, or null if they cannot be read. Health Connect
 * merges every source itself (de-duplicating a watch and a phone that both
 * counted the same walk), which is why we ask for the aggregate, not raw
 * records.
 */
export async function readStepsBetween(start: Date, end: Date): Promise<number | null> {
  if (!hc || !(await init())) return null;
  try {
    const result = await hc.aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
    });
    return Math.max(0, Math.floor(result.COUNT_TOTAL ?? 0));
  } catch {
    return null;
  }
}

/** Today's step total so far. */
export function readStepsToday(): Promise<number | null> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return readStepsBetween(start, new Date());
}

/** Friendly names for the apps that commonly write steps into Health Connect. */
const SOURCE_NAMES: Record<string, string> = {
  'com.sec.android.app.shealth': 'Samsung Health',
  'com.google.android.apps.fitness': 'Google Fit',
  'com.google.android.apps.healthdata': 'your phone',
  'android': 'your phone',
  'com.fitbit.FitbitMobile': 'Fitbit',
  'com.huawei.health': 'Huawei Health',
  'com.xiaomi.wearable': 'Mi Fitness',
  'com.mi.health': 'Mi Fitness',
  'com.garmin.android.apps.connectmobile': 'Garmin Connect',
  'com.oneplus.health': 'OHealth',
  'com.heytap.health': 'HeyTap Health',
  'com.strava': 'Strava',
  'com.withings.wiscale2': 'Withings',
  'com.ouraring.oura': 'Oura',
  'com.nianticlabs.pokemongo': 'Pokémon GO',
  'com.samsung.android.wear.shealth': 'Galaxy Watch',
  'com.google.android.apps.fitness.wearable': 'Pixel Watch',
  'com.huami.watch.hmwatchmanager': 'Zepp (Amazfit)',
  'com.huami.midong': 'Zepp Life (Mi Band)',
  'fi.polar.polarflow': 'Polar Flow',
  'com.coros.coach': 'COROS',
  'com.suunto.movescount.android': 'Suunto',
  'com.whoop.android': 'WHOOP',
  'com.urbandroid.sleep': 'Sleep as Android',
  'nl.appyhapps.healthsync': 'Health Sync',
};

/**
 * A name a player can read for the app behind a package id.
 *
 * Android 14+ records the phone's OWN step counter under a generated id such
 * as `com.android.healthconnect.phone.j336b2d0c...`, and testers saw that
 * whole string printed on the Walk tab. Anything from Health Connect itself or
 * the system is "your phone"; an app we do not know gets a tidy guess from its
 * id (`com.example.stepcounter` -> "Stepcounter") rather than the raw id.
 */
export function sourceName(pkg: string): string {
  if (SOURCE_NAMES[pkg]) return SOURCE_NAMES[pkg];
  if (pkg.startsWith('com.android.healthconnect') || pkg.startsWith('com.google.android.healthconnect')) return 'your phone';
  if (pkg.startsWith('com.samsung.') || pkg.startsWith('com.sec.')) return 'Samsung Health';
  const parts = pkg.split('.').filter((p) => p && !/^(com|org|net|io|app|android|apps|mobile|phone)$/i.test(p));
  const word = parts.find((p) => /^[a-z]{3,}$/i.test(p));
  return word ? word[0].toUpperCase() + word.slice(1) : 'another app';
}

export interface StepSources {
  /** Friendly names of the apps that wrote steps in the last week. */
  names: string[];
  /** Steps Health Connect holds for the last week, across all of them. */
  weekSteps: number;
}

/**
 * WHO IS FEEDING HEALTH CONNECT? The question behind "my steps only count
 * when the app is open".
 *
 * Fareground can only read steps that some app WROTE into Health Connect -
 * Samsung Health, Google Fit, the phone's own counter. Permission alone is not
 * enough: a phone where nothing writes steps reads zero, the app quietly falls
 * back to counting only while it is open, and the player never learns why.
 * Health Connect's aggregate names every app that contributed, so we can say
 * "Steps from Samsung Health" - or plainly that nothing is sending any.
 *
 * Null when it cannot be read (no permission, no module).
 */
export async function stepSources(): Promise<StepSources | null> {
  if (!hc || !(await init())) return null;
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    const result = await hc.aggregateRecord({
      recordType: 'Steps',
      timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: end.toISOString() },
    });
    const names = [...new Set((result.dataOrigins ?? []).map(sourceName))];
    return { names, weekSteps: Math.max(0, Math.floor(result.COUNT_TOTAL ?? 0)) };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------- *
 *  STEP SETUP - everything the setup screen needs to say what is wrong.
 *
 *  Added 2026-09-27 for the step rework. Testers could not see WHY steps only
 *  counted with the app open: Health Connect missing or out of date, no app
 *  writing steps into it, a watch app that had not synced for hours, or the
 *  phone's own counter out-ranking a Fitbit. Each of those is now a question
 *  this file can answer, so the screen can show the one thing to fix.
 * ------------------------------------------------------------------------- */

/**
 * Can this phone use Health Connect at all?
 *   too-old        below Android 9 - Health Connect does not run there
 *   not-installed  Android 9-13 without the Health Connect app
 *   needs-update   installed, but too old for this app
 *   available      ready to ask for permission
 *   unsupported    not Android, or this build has no Health Connect module
 */
export type HcAvailability = 'unsupported' | 'too-old' | 'not-installed' | 'needs-update' | 'available';

/** Health Connect needs Android 9 (API 28) or newer. */
const HC_MIN_API = 28;

export async function hcAvailability(): Promise<HcAvailability> {
  if (Platform.OS !== 'android') return 'unsupported';
  if (typeof Platform.Version === 'number' && Platform.Version < HC_MIN_API) return 'too-old';
  if (!hc) return 'unsupported';
  try {
    const status = await hc.getSdkStatus();
    if (status === hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
    if (status === hc.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'needs-update';
    return 'not-installed';
  } catch {
    return 'not-installed';
  }
}

/** Android's version number as people know it ("Android 12"), for messages. */
export function androidRelease(): string {
  const api = typeof Platform.Version === 'number' ? Platform.Version : 0;
  const names: Record<number, string> = {
    21: '5', 22: '5.1', 23: '6', 24: '7', 25: '7.1', 26: '8', 27: '8.1', 28: '9', 29: '10', 30: '11',
    31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16',
  };
  return names[api] ?? (api > 36 ? 'the latest' : String(api));
}

/** Which Health Connect permissions Fareground holds. */
export async function hcPermissions(): Promise<{ steps: boolean; background: boolean }> {
  if (!hc || !(await init())) return { steps: false, background: false };
  try {
    const granted = await hc.getGrantedPermissions();
    return {
      steps: granted.some((p) => p.recordType === 'Steps' && p.accessType === 'read'),
      background: granted.some((p) => p.recordType === 'BackgroundAccessPermission'),
    };
  } catch {
    return { steps: false, background: false };
  }
}

/**
 * Ask for reading in the background on its own. Older Health Connect
 * versions do not have the permission and reject the request - resolves
 * false then, which the setup screen explains rather than retrying.
 */
export async function requestBackgroundPermission(): Promise<boolean> {
  if (!hc || !(await init())) return false;
  try {
    const granted = await hc.requestPermission([{ accessType: 'read', recordType: 'BackgroundAccessPermission' }]);
    return granted.some((p) => p.recordType === 'BackgroundAccessPermission');
  } catch {
    return false;
  }
}

/** Health Connect's own settings, or its Play Store page if it is not there to open. */
export function updateHealthConnect(): void {
  installHealthConnect();
}

export interface SourceToday {
  /** Package name - also what the watch guide matches on. */
  id: string;
  name: string;
  /** Steps this app wrote today. Raw: two apps counting one walk both show it. */
  steps: number;
  /** When it last wrote anything today. */
  lastUpdate: Date | null;
}

/**
 * Every app that wrote steps TODAY, with how many and when it last did.
 *
 * Raw records, not the aggregate, because the point is to name who is
 * writing and how fresh it is: "Fitbit last sent steps 5 hours ago" is the
 * whole answer to "my watch steps are missing". Null when it cannot be read.
 */
export async function sourcesToday(): Promise<SourceToday[] | null> {
  if (!hc || !(await init())) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const by = new Map<string, SourceToday>();
  try {
    let pageToken: string | undefined;
    for (let page = 0; page < 6; page++) {
      const r = await hc.readRecords('Steps', {
        timeRangeFilter: { operator: 'between', startTime: start.toISOString(), endTime: new Date().toISOString() },
        pageSize: 500,
        pageToken,
      });
      for (const rec of r.records) {
        const id = rec.metadata?.dataOrigin ?? 'unknown';
        const at = new Date(rec.metadata?.lastModifiedTime ?? rec.endTime);
        const cur = by.get(id) ?? { id, name: sourceName(id), steps: 0, lastUpdate: null };
        cur.steps += Math.max(0, Math.floor(rec.count ?? 0));
        if (!cur.lastUpdate || at > cur.lastUpdate) cur.lastUpdate = at;
        by.set(id, cur);
      }
      pageToken = r.pageToken;
      if (!pageToken) break;
    }
    return [...by.values()].sort((a, b) => b.steps - a.steps);
  } catch {
    return null;
  }
}

/**
 * Open another app by package name - the watch's own app, so the player can
 * sync it or switch on its Health Connect link. Google Play's launch link
 * opens the app when it is installed and its store page when it is not, so
 * one link covers both without any extra permission.
 */
export function openAndroidApp(pkg: string): void {
  Linking.openURL(`market://launch?id=${pkg}`).catch(() => {
    void Linking.openURL(`https://play.google.com/store/apps/details?id=${pkg}`);
  });
}
