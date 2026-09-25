import * as Location from 'expo-location';
import { metresBetween } from '@/game/geo';

/**
 * How far the phone has actually MOVED, between step syncs.
 *
 * WHY THIS EXISTS. A phone shaken in a hand produces a textbook step signal -
 * regular oscillation at walking frequency - and the pedometer counts it as
 * walking, because from the accelerometer's point of view it is. Nothing
 * about the step count itself can tell the difference.
 *
 * What shaking cannot produce is GROUND COVERED. So the server is told how
 * far the trace moved over the same window, and splits the steps into those
 * the distance can account for and those it cannot. The second kind still
 * count - a treadmill and a shopping centre produce them honestly - but only
 * up to a daily allowance.
 *
 * WHAT THIS IS NOT. It is not a security boundary. A modified client can
 * report any number it likes here, and that is expected: this layer exists to
 * make the CHEAP attack (shake the phone) stop working. The expensive attack
 * (fake the GPS too) is what the server-side physics checks are for, and
 * those run on positions the server saw rather than anything the client says
 * about itself.
 *
 * PRIVACY. Nothing is stored and nothing is sent except a single distance in
 * metres. No track, no points, no history - the game already refuses to put
 * names on a map and a breadcrumb trail would be far worse than that.
 */

/** Fixes worse than this tell us nothing about distance. Matches the server. */
const USABLE_ACCURACY_M = 35;

/**
 * A jump bigger than this between two fixes is receiver error, not walking.
 *
 * GPS routinely throws a single wild reading - a reflection off a building,
 * a cold start, a hand-off between providers. Counting one as distance would
 * hand a shaker free corroboration for standing still next to a tall
 * building, which is precisely the case this is meant to catch.
 */
const MAX_JUMP_M = 60;

/** Below this, it is the receiver breathing rather than the player walking. */
const MIN_STEP_M = 1.5;

/**
 * Statistics about the trace itself, for the server's authenticity checks.
 *
 * REAL GPS IS NOISY AND FAKE GPS IS NOT. Accuracy never repeats exactly,
 * altitude drifts by metres standing still, a walked path wobbles, and the
 * receiver's own speed reading agrees with the ground covered because it
 * comes from Doppler rather than from the coordinates. Generated tracks tend
 * to fail several of those at once.
 *
 * These are summary numbers only - four floats and a count. No positions, no
 * timestamps, no track. Nothing here could reconstruct where anyone went.
 */
export interface TraceQuality {
  samples: number;
  accuracySpreadM: number;
  altitudeSpreadM: number | null;
  straightness: number | null;
  speedAgreement: number | null;
}

let watcher: Location.LocationSubscription | null = null;
let last: { lat: number; lng: number } | null = null;
let metres = 0;
/** True once a usable fix has been seen; distinguishes "0 m" from "no idea". */
let haveTrace = false;

/* --- the running statistics ------------------------------------------- */
let samples = 0;
let accMin = Infinity, accMax = -Infinity;
let altMin = Infinity, altMax = -Infinity;
let sawAltitude = false;
/** First and latest fix, for straight-line displacement. */
let first: { lat: number; lng: number } | null = null;
/** Sum of the receiver's own speed readings x their interval, in metres. */
let speedDistance = 0;
let sawSpeed = false;
let lastAt = 0;

function resetStats(): void {
  samples = 0;
  accMin = Infinity; accMax = -Infinity;
  altMin = Infinity; altMax = -Infinity;
  sawAltitude = false;
  first = null;
  speedDistance = 0;
  sawSpeed = false;
  lastAt = 0;
}

/**
 * Start following the phone's position, accumulating distance.
 *
 * Balanced accuracy on purpose: this only needs to answer "did the ground
 * move", not "which square is this", and the map already runs a high-accuracy
 * watcher of its own when it is open.
 */
export async function startWalkTrace(): Promise<void> {
  if (watcher) return;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return;

    watcher = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 10_000,
        distanceInterval: 5,
      },
      (fix) => {
        const acc = fix.coords.accuracy ?? 999;
        if (acc > USABLE_ACCURACY_M) return;

        const here = { lat: fix.coords.latitude, lng: fix.coords.longitude };
        haveTrace = true;

        // --- the authenticity statistics ---------------------------------
        samples += 1;
        accMin = Math.min(accMin, acc);
        accMax = Math.max(accMax, acc);

        const alt = fix.coords.altitude;
        if (alt !== null && alt !== undefined) {
          sawAltitude = true;
          altMin = Math.min(altMin, alt);
          altMax = Math.max(altMax, alt);
        }

        // The receiver's own speed, integrated over the gap. Derived from
        // Doppler rather than from the coordinates, so on real hardware it
        // agrees with the distance covered WITHOUT being computed from it.
        const now = fix.timestamp ?? Date.now();
        const speed = fix.coords.speed;
        if (speed !== null && speed !== undefined && speed >= 0 && lastAt > 0) {
          const gap = Math.min((now - lastAt) / 1000, 60);
          if (gap > 0) {
            speedDistance += speed * gap;
            sawSpeed = true;
          }
        }
        lastAt = now;
        first ??= here;

        if (last) {
          const d = metresBetween(last.lat, last.lng, here.lat, here.lng);
          // Between the two thresholds is walking; outside is noise at one
          // end and a receiver glitch at the other.
          if (d >= MIN_STEP_M && d <= MAX_JUMP_M) metres += d;
        }
        last = here;
      },
    );
  } catch {
    // No trace is a valid state: the server treats it as "cannot tell", not
    // as zero, so failing here costs the player nothing.
  }
}

export function stopWalkTrace(): void {
  watcher?.remove();
  watcher = null;
}

/**
 * Take the distance walked since the last call, and reset.
 *
 * Returns undefined when there has been no usable trace at all. THAT
 * DISTINCTION MATTERS: undefined means "we could not see", zero means "we
 * watched and nothing moved", and the server treats them very differently.
 */
export function takeWalkDistance(): number | undefined {
  if (!haveTrace) return undefined;
  const m = metres;
  metres = 0;
  return Math.round(m);
}

/**
 * Take the trace statistics since the last call, and reset.
 *
 * Call this BEFORE takeWalkDistance - straightness is measured against the
 * path length, which that call clears.
 */
export function takeTraceQuality(): TraceQuality | undefined {
  if (!haveTrace || samples === 0) return undefined;

  // How straight was the path? Net displacement over distance walked. A
  // person walking a straight street still wanders; an interpolated line
  // does not.
  let straightness: number | null = null;
  if (first && last && metres > 30) {
    const net = metresBetween(first.lat, first.lng, last.lat, last.lng);
    straightness = Math.min(1, net / metres);
  }

  // Does the receiver's own speed agree with the ground covered? Expressed
  // as a ratio in [0,1] so either direction of disagreement scores low.
  let speedAgreement: number | null = null;
  if (sawSpeed && metres > 30 && speedDistance > 0) {
    speedAgreement = Math.min(metres, speedDistance) / Math.max(metres, speedDistance);
  }

  const q: TraceQuality = {
    samples,
    accuracySpreadM: Number((accMax - accMin).toFixed(2)),
    altitudeSpreadM: sawAltitude ? Number((altMax - altMin).toFixed(2)) : null,
    straightness: straightness === null ? null : Number(straightness.toFixed(4)),
    speedAgreement: speedAgreement === null ? null : Number(speedAgreement.toFixed(4)),
  };
  resetStats();
  return q;
}

/** Forget everything - used when signing out. */
export function resetWalkTrace(): void {
  stopWalkTrace();
  last = null;
  metres = 0;
  haveTrace = false;
  resetStats();
}
