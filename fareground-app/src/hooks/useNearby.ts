import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { NearbyParcel } from '@/api/types';
import { useSession } from '@/state/session';

/** Refetch once you have walked this far from the last fetch. */
const REFETCH_AFTER_M = 80;

function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Every claimed parcel around the player. Fetched as they move rather than
 * on every GPS tick - at walking pace the ground in view barely changes
 * between fixes, and each request costs the server a range scan.
 */
export function useNearby(lat: number | null, lng: number | null) {
  const { token } = useSession();
  const [parcels, setParcels] = useState<NearbyParcel[]>([]);
  const lastAt = useRef<{ lat: number; lng: number } | null>(null);

  const fetchAt = useCallback(
    async (atLat: number, atLng: number) => {
      if (!token) return;
      lastAt.current = { lat: atLat, lng: atLng };
      try {
        setParcels((await api.nearby(token, atLat, atLng)).parcels);
      } catch {
        // Keep showing the last good set; the next move will retry.
      }
    },
    [token],
  );

  useEffect(() => {
    if (lat === null || lng === null) return;
    const prev = lastAt.current;
    if (!prev || metresBetween(prev.lat, prev.lng, lat, lng) > REFETCH_AFTER_M) {
      fetchAt(lat, lng);
    }
  }, [lat, lng, fetchAt]);

  const refresh = useCallback(() => {
    if (lat !== null && lng !== null) fetchAt(lat, lng);
  }, [lat, lng, fetchAt]);

  return { parcels, refresh };
}
