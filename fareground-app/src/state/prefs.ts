import * as SecureStore from 'expo-secure-store';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * PLAYER PREFERENCES (2026-10-04): distance units and the colour theme.
 *
 * Read SYNCHRONOUSLY at start-up (SecureStore.getItem), because the theme has
 * to be known before the first style sheet is built - see theme.ts. Writes
 * are saved in the background and every screen using usePrefs re-renders.
 */
export type Units = 'metric' | 'imperial';
export type ThemePref = 'system' | 'light' | 'dark';
export interface Prefs {
  units: Units;
  theme: ThemePref;
}

const KEY = 'fareground.prefs';
const DEFAULTS: Prefs = { units: 'metric', theme: 'system' };

function readSaved(): Prefs {
  try {
    const raw = SecureStore.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current: Prefs = readSaved();
const listeners = new Set<() => void>();

/** The preferences as saved when the app started, for theme.ts. */
export const prefsAtLaunch: Prefs = current;

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  current = { ...current, [key]: value };
  void SecureStore.setItemAsync(KEY, JSON.stringify(current)).catch(() => undefined);
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, () => current);
}

/**
 * A distance in the player's units: metres/kilometres, or feet/miles.
 * Short distances stay whole numbers; long ones get one decimal place.
 */
export function formatDistance(metres: number, units: Units): string {
  const m = Math.max(0, metres);
  if (units === 'imperial') {
    const ft = m * 3.28084;
    if (ft < 1000) return `${Math.round(ft)} ft`;
    return `${(m / 1609.344).toFixed(1)} mi`;
  }
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

/** formatDistance bound to the player's current units. */
export function useDistance(): (metres: number) => string {
  const { units } = usePrefs();
  return useCallback((metres: number) => formatDistance(metres, units), [units]);
}
