import { Pedometer } from 'expo-sensors';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { GADGET_PACKAGES } from '@/game/gadgets';
import { appleHealthAsked, appleHealthAvailable, appleSourcesToday } from '@/native/appleHealth';
import { hcAvailability, hcPermissions, sourcesToday, type HcAvailability } from '@/native/healthSteps';

/**
 * IS STEP COUNTING SET UP PROPERLY? One answer for the Walk tab's card and
 * the step setup screen, so the two can never disagree.
 *
 * Everything a tester has hit, as a question with a yes or no:
 *   - Is there a health store at all, and is it up to date?  (Android)
 *   - May Fareground read steps from it - and in the background?
 *   - Is ANY app actually writing steps into it today?
 *   - Is a watch's app behind (has not synced for hours)?
 *   - Are two apps both writing, so the phone may out-rank the watch?
 *
 * Re-checked whenever the app comes back to the foreground, because most
 * fixes happen in another app (Health Connect, Samsung Health, Fitbit).
 */
export interface StepSource {
  id: string;
  name: string;
  steps: number;
  lastUpdate: Date | null;
  /** A watch, band or ring's app, rather than the phone. */
  gadget: boolean;
}

export interface StepHealth {
  platform: 'android' | 'ios';
  /** Android only. */
  hc: HcAvailability;
  /** May Fareground read steps? (iOS: motion permission.) */
  canRead: boolean;
  /** Android: reading while closed is allowed. iOS: always true (the OS allows it). */
  background: boolean;
  /** iOS: Apple Health is on this phone and build. */
  appleHealth: boolean;
  /** iOS: the player has been asked to connect Apple Health. */
  appleHealthAsked: boolean;
  /** Who wrote steps today. Null when it cannot be read. */
  sources: StepSource[] | null;
  /** A gadget's app that has not written anything for a while, if any. */
  staleGadget: StepSource | null;
  /** More than one app wrote steps today. */
  severalWriters: boolean;
  /** Things still to fix. Zero is "all set". */
  issues: number;
}

/** A watch app silent for longer than this is probably not syncing. */
const STALE_MS = 3 * 60 * 60 * 1000;

async function diagnose(): Promise<StepHealth> {
  if (Platform.OS === 'ios') {
    const motion = await Pedometer.getPermissionsAsync().catch(() => ({ granted: false }));
    const available = appleHealthAvailable();
    const asked = await appleHealthAsked();
    const raw = asked ? await appleSourcesToday() : null;
    const sources = raw?.map((s) => ({ ...s, lastUpdate: null, gadget: !/iphone/i.test(s.name) })) ?? null;
    const issues = (motion.granted ? 0 : 1) + (available && !asked ? 1 : 0);
    return {
      platform: 'ios',
      hc: 'unsupported',
      canRead: motion.granted,
      background: true,
      appleHealth: available,
      appleHealthAsked: asked,
      sources,
      staleGadget: null,
      severalWriters: (sources?.length ?? 0) > 1,
      issues,
    };
  }

  const hc = await hcAvailability();
  const perms = hc === 'available' ? await hcPermissions() : { steps: false, background: false };
  const raw = perms.steps ? await sourcesToday() : null;
  const sources =
    raw?.map((s) => ({ ...s, gadget: GADGET_PACKAGES.has(s.id) || /watch|band|ring/i.test(s.name) })) ?? null;
  const now = Date.now();
  const staleGadget =
    sources?.find((s) => s.gadget && s.lastUpdate && now - s.lastUpdate.getTime() > STALE_MS) ?? null;
  const severalWriters = (sources?.length ?? 0) > 1;

  let issues = 0;
  if (hc === 'not-installed' || hc === 'needs-update') issues++;
  if (hc === 'available' && !perms.steps) issues++;
  if (perms.steps && sources !== null && sources.length === 0) issues++;
  if (staleGadget) issues++;
  return {
    platform: 'android',
    hc,
    canRead: perms.steps,
    background: perms.background,
    appleHealth: false,
    appleHealthAsked: false,
    sources,
    staleGadget,
    severalWriters,
    issues,
  };
}

export function useStepHealth() {
  const [health, setHealth] = useState<StepHealth | null>(null);

  const refresh = useCallback(async () => {
    try {
      setHealth(await diagnose());
    } catch {
      // Keep what we had; the next look will try again.
    }
  }, []);

  // State is only set from the async callback, as in useBalance.
  useEffect(() => {
    let live = true;
    const look = () => {
      diagnose().then(
        (h) => { if (live) setHealth(h); },
        () => undefined,
      );
    };
    look();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') look();
    });
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  return { health, refresh };
}

/** "5 min ago", "3 h ago" - for when a source last wrote. */
export function ago(d: Date | null): string {
  if (!d) return '';
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return `${h} h ago`;
}
