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
};

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
    const names = [...new Set((result.dataOrigins ?? []).map((pkg) => SOURCE_NAMES[pkg] ?? pkg))];
    return { names, weekSteps: Math.max(0, Math.floor(result.COUNT_TOTAL ?? 0)) };
  } catch {
    return null;
  }
}
