import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

export interface Fix {
  lat: number;
  lng: number;
  /** The phone's own estimate of how wrong this fix could be, in metres. */
  accuracyM: number;
  /** Ground speed in metres per second (0 when unknown). */
  speed: number;
  /** Direction of travel, degrees clockwise from north, or null if unknown. */
  heading: number | null;
  /** Android reports when a fix came from a mock-location app. */
  mocked: boolean;
  timestamp: number;
  /**
   * The most recent fix that was sharp enough to claim with (see
   * CLEAR_FIX_M). Underground or indoors the GPS goes fuzzy for a while;
   * claims fall back to this rather than flickering on and off.
   */
  lastClear: { lat: number; lng: number; accuracyM: number; timestamp: number } | null;
}

/** A fix this sharp or better is remembered as the last clear one. Matches MAX_CLAIM_ACCURACY_M. */
const CLEAR_FIX_M = 25;

type State =
  | { status: 'asking' }
  | { status: 'denied' }
  | { status: 'searching' }
  | { status: 'ok'; fix: Fix };

function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const φ1 = (aLat * Math.PI) / 180, φ2 = (bLat * Math.PI) / 180;
  const Δλ = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * The player's live position while the app is open.
 *
 * Foreground only, on purpose: background location needs a stronger
 * permission and a store-review justification, and drains the battery of a
 * phone that is already running a map. Steps are what accrue in the
 * background; position only matters while you are looking at the map.
 *
 * Speed and heading drive the runner. Many Android phones report speed as -1
 * or omit heading at walking pace, so both fall back to being worked out from
 * the last two fixes.
 */
export function useLocation(): State {
  const [state, setState] = useState<State>({ status: 'asking' });

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    let prev: Fix | null = null;
    let lastClear: Fix['lastClear'] = null;

    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (permission.status !== 'granted') {
        setState({ status: 'denied' });
        return;
      }
      setState({ status: 'searching' });

      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 1, timeInterval: 1000 },
        (loc) => {
          const lat = loc.coords.latitude, lng = loc.coords.longitude;
          let speed = loc.coords.speed ?? -1;
          let heading = loc.coords.heading ?? -1;

          if (prev) {
            const dt = (loc.timestamp - prev.timestamp) / 1000;
            const d = metresBetween(prev.lat, prev.lng, lat, lng);
            if (speed < 0 && dt > 0) speed = d / dt;
            // Below ~1.5 m of movement a heading is GPS jitter, not direction.
            if (heading < 0 && d > 1.5) heading = bearingBetween(prev.lat, prev.lng, lat, lng);
          }

          const accuracyM = loc.coords.accuracy ?? 999;
          if (accuracyM <= CLEAR_FIX_M) lastClear = { lat, lng, accuracyM, timestamp: loc.timestamp };
          const fix: Fix = {
            lat,
            lng,
            accuracyM,
            speed: Math.max(0, speed),
            heading: heading >= 0 ? heading : prev?.heading ?? null,
            mocked: loc.mocked === true,
            timestamp: loc.timestamp,
            lastClear,
          };
          prev = fix;
          setState({ status: 'ok', fix });
        },
      );
      if (cancelled) sub.remove();
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  return state;
}
