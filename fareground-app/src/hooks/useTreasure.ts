import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/client';
import type { ClaimSummary, TreasureStatus } from '@/api/types';
import { metresBetween } from '@/game/geo';
import { useSession } from '@/state/session';

/** Ask again after this long, or after moving this far. */
const REFRESH_MS = 60_000;
const MOVE_M = 100;

/**
 * Treasure boxes waiting nearby. The server places them and decides how many
 * you are owed; the app just shows them and reports where you are when you
 * open one.
 */
export function useTreasure(lat: number, lng: number) {
  const { token } = useSession();
  const [treasure, setTreasure] = useState<TreasureStatus | null>(null);
  const lastAt = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(
    async (atLat: number, atLng: number) => {
      if (!token || busy.current) return;
      busy.current = true;
      try {
        setTreasure(await api.treasure(token, atLat, atLng));
        lastAt.current = { lat: atLat, lng: atLng, at: Date.now() };
      } catch {
        // Keep whatever we had; the next move or tick will try again.
      } finally {
        busy.current = false;
      }
    },
    [token],
  );

  useEffect(() => {
    const prev = lastAt.current;
    const stale = !prev || Date.now() - prev.at > REFRESH_MS || metresBetween(prev.lat, prev.lng, lat, lng) > MOVE_M;
    if (stale) refresh(lat, lng);
  }, [lat, lng, refresh]);

  /** Open a box you have reached. Resolves to its reward, ready to double. */
  const open = useCallback(
    async (id: string, at: { lat: number; lng: number }): Promise<ClaimSummary> => {
      if (!token) throw new Error('Not signed in.');
      const r = await api.openBox(token, id, at);
      await refresh(at.lat, at.lng);
      return r.claim;
    },
    [token, refresh],
  );

  return { treasure, open, refresh: () => refresh(lat, lng) };
}
