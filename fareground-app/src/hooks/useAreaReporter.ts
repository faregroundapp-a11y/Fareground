import * as Location from 'expo-location';
import { useEffect, useRef } from 'react';
import { api } from '@/api/client';
import { metresBetween } from '@/game/geo';
import { useSession } from '@/state/session';

/** Re-check the area after moving this far... */
const MOVE_M = 3_000;
/** ...or after this long, whichever comes first. */
const EVERY_MS = 6 * 60 * 60 * 1000;

/** A short, human name for where you are: "Camden", "Hyde Park"... */
export async function placeNameFor(lat: number, lng: number): Promise<string | undefined> {
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!a) return undefined;
    const local = a.district ?? a.subregion ?? a.name ?? undefined;
    const town = a.city ?? undefined;
    if (local && town && local !== town) return `${local}, ${town}`;
    return town ?? local;
  } catch {
    return undefined;
  }
}

/**
 * Tells the server which city / region / country you are in, so you appear
 * on the right leaderboards. The PHONE turns its position into place names
 * (reverse geocoding) and sends only the names - the server never stores
 * where you are.
 */
export function useAreaReporter(lat: number, lng: number) {
  const { token } = useSession();
  const last = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (!token || busy.current) return;
    const prev = last.current;
    const stale = !prev || Date.now() - prev.at > EVERY_MS || metresBetween(prev.lat, prev.lng, lat, lng) > MOVE_M;
    if (!stale) return;

    busy.current = true;
    (async () => {
      try {
        const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (a?.country) {
          await api.setArea(token, {
            city: a.city ?? a.subregion ?? undefined,
            region: a.region ?? a.subregion ?? undefined,
            country: a.country,
          });
        }
        last.current = { lat, lng, at: Date.now() };
      } catch {
        // No geocoder or no network: try again on the next move.
      } finally {
        busy.current = false;
      }
    })();
  }, [token, lat, lng]);
}
