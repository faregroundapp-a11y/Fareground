import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { useStepHealth } from '@/hooks/useStepHealth';

const SHOWN_KEY = 'fareground.stepSetupShown';

/**
 * First run: if steps are not fully set up, open the step setup screen once.
 *
 * This is the "explain first" half of the rework. The app used to fire
 * Health Connect's permission dialog the moment it opened, with no word of
 * why, and a lot of testers said no to it - then wondered why steps only
 * counted with the app open. Now they land on a checklist that says what each
 * permission is for, with the button beside it. Shown once; after that the
 * Walk tab's step card is the way back.
 *
 * Renders nothing.
 */
export function StepSetupPrompt() {
  const { health } = useStepHealth();

  useEffect(() => {
    if (!health || health.issues === 0) return;
    let live = true;
    AsyncStorage.getItem(SHOWN_KEY)
      .then(async (shown) => {
        if (!live || shown === '1') return;
        await AsyncStorage.setItem(SHOWN_KEY, '1');
        // A beat after the tabs have drawn, never mid-launch, and never able
        // to take the app down if navigation is not ready yet.
        setTimeout(() => {
          if (!live) return;
          try {
            router.push('/step-setup');
          } catch {
            // Not ready: the Walk tab's step card is the way there anyway.
          }
        }, 1200);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [health]);

  return null;
}
