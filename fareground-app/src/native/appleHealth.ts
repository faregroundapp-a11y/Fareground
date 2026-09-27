import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { optional } from './optional';

/**
 * iPhone step history from APPLE HEALTH - the store every watch writes into.
 *
 * Until 2026-09-27 the iPhone read only its own motion history (Core Motion,
 * via expo-sensors' Pedometer). That is steps the PHONE counted: an Apple
 * Watch, a Garmin, an Oura ring or a Withings band were invisible, and a
 * walk with the phone left on the desk earned nothing. Apple Health is where
 * all of those land, merged and de-duplicated by Health itself, so reading
 * its daily total is what makes outside gadgets count on iOS - the same job
 * Health Connect does on Android.
 *
 * TWO APPLE RULES SHAPE THIS FILE:
 *
 *   * Reading a type before asking for it CRASHES the app (the library says
 *     so plainly). So every read checks `asked()` first, and the ask is only
 *     ever made from a button the player pressed.
 *   * iOS never says whether reading was ALLOWED - only whether we asked. A
 *     refusal looks exactly like "no steps". So the motion history stays as a
 *     floor: the app uses whichever of the two is higher, and nobody who
 *     says no to Health loses the steps their phone counted.
 *
 * On a build without the module (made before it was added) everything here
 * reports "unavailable" instead of crashing - see optional.ts.
 */
type HK = typeof import('@kingstinct/react-native-healthkit');
const hk =
  Platform.OS === 'ios'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: an import would crash builds without the native module (see optional.ts)
      optional<HK>(() => require('@kingstinct/react-native-healthkit'), 'NitroModules')
    : null;

const STEPS = 'HKQuantityTypeIdentifierStepCount' as const;
/** Set once the player has been shown Apple's Health permission sheet. */
const ASKED_KEY = 'fareground.appleHealthAsked';

/** Does this phone have Apple Health, and does this build know how to read it? */
export function appleHealthAvailable(): boolean {
  if (!hk) return false;
  try {
    return hk.isHealthDataAvailable();
  } catch {
    return false;
  }
}

/** Has the player been asked? (iOS will not say whether they said yes.) */
export async function appleHealthAsked(): Promise<boolean> {
  if (!appleHealthAvailable()) return false;
  try {
    return (await AsyncStorage.getItem(ASKED_KEY)) === '1';
  } catch {
    return false;
  }
}

/**
 * Show Apple's Health sheet for steps. Resolves true once it has been shown
 * (which is all iOS will tell us). Only ever call this from a button.
 */
export async function requestAppleHealth(): Promise<boolean> {
  if (!hk || !appleHealthAvailable()) return false;
  try {
    await hk.requestAuthorization({ toRead: [STEPS] });
    await AsyncStorage.setItem(ASKED_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/**
 * Steps Apple Health holds between two moments, merged across every source
 * the way the Health app shows them. Null when it cannot be read (not asked,
 * no module, or the phone is locked - Health data is encrypted then).
 */
export async function appleStepsBetween(start: Date, end: Date): Promise<number | null> {
  if (!hk || !(await appleHealthAsked())) return null;
  try {
    const r = await hk.queryStatisticsForQuantity(STEPS, ['cumulativeSum'], {
      filter: { date: { startDate: start, endDate: end } },
      unit: 'count',
    });
    const n = r.sumQuantity?.quantity;
    return typeof n === 'number' ? Math.max(0, Math.floor(n)) : 0;
  } catch {
    return null;
  }
}

export interface AppleSource {
  id: string;
  name: string;
  steps: number;
}

/** Which apps and devices gave Apple Health steps today, and how many each. */
export async function appleSourcesToday(): Promise<AppleSource[] | null> {
  if (!hk || !(await appleHealthAsked())) return null;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  try {
    const rows = await hk.queryStatisticsForQuantitySeparateBySource(STEPS, ['cumulativeSum'], {
      filter: { date: { startDate: start, endDate: new Date() } },
      unit: 'count',
    });
    return rows
      .map((r) => ({
        id: r.source.bundleIdentifier,
        name: r.source.name,
        steps: Math.max(0, Math.floor(r.sumQuantity?.quantity ?? 0)),
      }))
      .filter((r) => r.steps > 0)
      .sort((a, b) => b.steps - a.steps);
  } catch {
    return null;
  }
}
