import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from '@/api/client';
import type { Balance } from '@/api/types';
import { useSession } from '@/state/session';

/** How often to settle passive income while the app is open. */
const REFRESH_MS = 60_000;

/**
 * Walk Points, coins, income rate and boost state. Asking the server for a
 * balance is also what settles passive income (lazy evaluation), so this
 * polls gently rather than trying to be real-time.
 *
 * `boostEndsAt` is worked out on the PHONE from the seconds remaining, so a
 * phone whose clock is a few minutes off still counts down correctly.
 */
export function useBalance() {
  const { token } = useSession();
  const [balance, setBalance] = useState<Balance | null>(null);
  const [boostEndsAt, setBoostEndsAt] = useState<number | null>(null);
  const [prizeEndsAt, setPrizeEndsAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Coins your land earned while the app was closed, for a "welcome back". */
  const [awayCoins, setAwayCoins] = useState(0);
  const inFlight = useRef(false);
  const firstSinceOpen = useRef(true);

  const apply = useCallback((next: Balance) => {
    if (firstSinceOpen.current) {
      firstSinceOpen.current = false;
      if (next.coinsJustEarned > 0) setAwayCoins(next.coinsJustEarned);
    }
    setBalance(next);
    setError(null);
    const remaining = next.rewards.boost.remainingSeconds;
    setBoostEndsAt(remaining > 0 ? Date.now() + remaining * 1000 : null);
    const prize = next.rewards.prize?.remainingSeconds ?? 0;
    setPrizeEndsAt(prize > 0 ? Date.now() + prize * 1000 : null);
  }, []);

  /** Fetch once. Resolves to the new balance, or throws. */
  const load = useCallback(async (): Promise<Balance | null> => {
    if (!token || inFlight.current) return null;
    inFlight.current = true;
    try {
      return await api.balance(token);
    } finally {
      inFlight.current = false;
    }
  }, [token]);

  /** For callers - after a claim, a step sync, an ad reward. */
  const refresh = useCallback(async () => {
    try {
      const next = await load();
      if (next) apply(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your balance.');
    }
  }, [load, apply]);

  // Poll while signed in. State is only set from the async callbacks.
  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      load().then(
        (next) => { if (!cancelled && next) apply(next); },
        (e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your balance.'); },
      );
    };
    tick();
    const id = setInterval(tick, REFRESH_MS);
    // Back from the background: the next balance tells us what was earned
    // while away. Settle it straight away rather than waiting for the timer.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        firstSinceOpen.current = true;
        tick();
      }
    });
    return () => { cancelled = true; clearInterval(id); sub.remove(); };
  }, [load, apply]);

  const dismissAway = useCallback(() => setAwayCoins(0), []);

  return { balance, boostEndsAt, prizeEndsAt, error, refresh, awayCoins, dismissAway };
}
