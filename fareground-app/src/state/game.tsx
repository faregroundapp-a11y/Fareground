import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react';
import { useBalance } from '@/hooks/useBalance';
import { useDaily } from '@/hooks/useDaily';
import { useStepSync } from '@/hooks/useStepSync';
import { initAds } from '@/native/ads';
import { getPushToken, initPushHandling } from '@/native/push';
import { api } from '@/api/client';
import { useSession } from './session';
import { Platform } from 'react-native';

/**
 * One balance, one step-sync loop and one daily-rewards state for the whole
 * signed-in app.
 *
 * Tabs stay mounted, so if each screen called these hooks itself there would
 * be two sync timers and two balances that disagree after a claim.
 *
 * SEPARATE CONTEXTS, ON PURPOSE. The step count changes every couple of
 * seconds while you walk. If it shared a context with the balance, every step
 * would re-render the map screen - the most expensive screen in the app - for
 * a number it does not even show. So each screen subscribes only to what it
 * uses.
 */
type BalanceState = ReturnType<typeof useBalance>;
type StepsState = ReturnType<typeof useStepSync>;
type DailyState = ReturnType<typeof useDaily>;

const BalanceContext = createContext<BalanceState | null>(null);
const StepsContext = createContext<StepsState | null>(null);
const DailyContext = createContext<DailyState | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const { token } = useSession();
  const balance = useBalance();
  const daily = useDaily();
  const { refresh: refreshBalance } = balance;
  const { refresh: refreshDaily } = daily;

  // Steps landing on the server can finish a quest, so refresh both.
  const onSynced = useCallback(() => {
    refreshBalance();
    refreshDaily();
  }, [refreshBalance, refreshDaily]);
  const steps = useStepSync(onSynced);

  // Ask for ad consent and warm the ad SDK up once, after sign-in, so the
  // first rewarded ad does not have to wait for it.
  useEffect(() => {
    initAds();
    initPushHandling();
  }, []);

  // Register this device for push once we are signed in. Expo rotates tokens,
  // so this runs on every sign-in rather than only the first - the server
  // treats a repeat registration as a no-op.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      const pushToken = await getPushToken();
      if (!pushToken || cancelled) return;
      try {
        const r = await api.registerPush(token, pushToken, Platform.OS === 'ios' ? 'ios' : 'android');
        // The server refuses a token it does not recognise as an Expo one.
        // Not worth interrupting the player, but it must not pass silently -
        // a device that cannot be reached is invisible otherwise.
        if (r && r.ok === false) {
          console.warn('[push] the server refused this device token; notifications will not arrive');
        }
      } catch {
        // Not being reachable by notification is not worth an error on screen.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <BalanceContext.Provider value={balance}>
      <DailyContext.Provider value={daily}>
        <StepsContext.Provider value={steps}>{children}</StepsContext.Provider>
      </DailyContext.Provider>
    </BalanceContext.Provider>
  );
}

/** Balance only - re-renders on balance changes, never on step ticks. */
export function useGameBalance(): BalanceState {
  const ctx = useContext(BalanceContext);
  if (!ctx) throw new Error('useGameBalance must be used inside <GameProvider>.');
  return ctx;
}

/** Steps only. */
export function useGameSteps(): StepsState {
  const ctx = useContext(StepsContext);
  if (!ctx) throw new Error('useGameSteps must be used inside <GameProvider>.');
  return ctx;
}

/** Daily chest and quests. */
export function useGameDaily(): DailyState {
  const ctx = useContext(DailyContext);
  if (!ctx) throw new Error('useGameDaily must be used inside <GameProvider>.');
  return ctx;
}

/** Balance and steps, for screens that show both (the Walk tab). */
export function useGame(): { balance: BalanceState; steps: StepsState } {
  return { balance: useGameBalance(), steps: useGameSteps() };
}
