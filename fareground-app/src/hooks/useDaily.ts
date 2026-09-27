import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '@/api/client';
import type { DailyStatus } from '@/api/types';
import { useSession } from '@/state/session';

const REFRESH_MS = 2 * 60_000;

/** The phone's IANA time zone, e.g. "Europe/London", or null if unknown. */
function phoneTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Today's chest and quests. Refreshed gently, when the app comes back to the
 * foreground, and whenever a caller knows something changed (steps synced, a
 * parcel claimed, an ad watched).
 */
export function useDaily() {
  const { token } = useSession();
  const [daily, setDaily] = useState<DailyStatus | null>(null);
  const inFlight = useRef(false);
  /**
   * A refresh asked for while one is running. It used to be DROPPED, and that
   * left "Double it" on screen after doubling: closing the ad brings the app
   * back to the foreground, which starts a refresh BEFORE the double is paid;
   * the refresh asked for after the payout was then skipped, and the stale
   * answer stuck until the next timer. Now it waits its turn and runs.
   */
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        try {
          setDaily(await api.daily(token));
        } catch {
          // Keep the last good state; the next refresh will retry.
        }
      } while (again.current);
    } finally {
      inFlight.current = false;
    }
  }, [token]);

  // Tell the server our time zone once per sign-in, then load.
  useEffect(() => {
    if (!token) return;
    const tz = phoneTimeZone();
    (tz ? api.setTimeZone(token, tz).catch(() => undefined) : Promise.resolve()).then(refresh);
    const id = setInterval(refresh, REFRESH_MS);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [token, refresh]);

  return { daily, refresh };
}
