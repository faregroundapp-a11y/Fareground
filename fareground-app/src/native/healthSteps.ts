import { Platform } from 'react-native';
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

/** Show Health Connect's own permission screen. Resolves true if granted. */
export async function requestHealthPermission(): Promise<boolean> {
  if (!hc || !(await init())) return false;
  try {
    const granted = await hc.requestPermission([{ accessType: 'read', recordType: 'Steps' }]);
    return granted.some((p) => p.recordType === 'Steps' && p.accessType === 'read');
  } catch {
    return false;
  }
}

/** Open Health Connect itself - to install it, or to connect a step source. */
export function openHealthConnect(): void {
  try {
    hc?.openHealthConnectSettings();
  } catch {
    /* nothing to open */
  }
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
