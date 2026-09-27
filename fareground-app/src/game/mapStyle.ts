import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { MAP_STYLE_URL } from '@/config';

/**
 * Map labels on or off - ALL of them.
 *
 * WHY IT IS A STYLE SWAP AND NOT A LAYER CALL. maplibre-react-native takes a
 * whole style for the `mapStyle` prop; there is no supported way to reach in
 * and hide one layer of a style loaded from a URL. So the style JSON is
 * fetched once, and a second copy is kept with every text layer set to
 * `visibility: none`. Toggling swaps which copy the map is given.
 *
 * WHAT GOES. Every layer that draws TEXT - street names, road shields, place,
 * town and country names, points of interest, water and park names - so the
 * map becomes a clean board of streets and squares. It was street names only
 * at first; the product owner asked for "ANY text" gone (2026-09-26).
 * One-way arrows stay: they have no text and read as part of the road.
 *
 * The toggle is a street-sign button on the map itself, and in Settings; both
 * write the same preference.
 */

/** Does this layer draw text? Symbol layers with a text-field do. */
function drawsText(layer: { type?: string; layout?: Record<string, unknown> }): boolean {
  return layer.type === 'symbol' && layer.layout?.['text-field'] !== undefined;
}

const PREF_KEY = 'fareground.streetNames';

/**
 * MapLibre's own style type, so the map prop accepts what we hand it. The
 * cast below is the one place we assert the fetched JSON really is a style -
 * it comes straight from the style endpoint the map would have loaded
 * itself, so the shape is the same either way.
 */
type StyleSpec = StyleSpecification;
type Cached = { withNames: StyleSpec; withoutNames: StyleSpec };

/** Fetched once per app run; the map asks for it on every render. */
let cached: Cached | null = null;
let inFlight: Promise<Cached | null> | null = null;

async function loadStyles(): Promise<Cached | null> {
  if (cached) return cached;
  inFlight ??= (async () => {
    try {
      const res = await fetch(MAP_STYLE_URL);
      const withNames = (await res.json()) as StyleSpec;

      // A deep-enough copy: only `layers` is touched, and only each layer's
      // `layout`, so cloning those two levels is sufficient and much cheaper
      // than a full structured clone of a 111-layer style.
      const withoutNames = {
        ...withNames,
        layers: (withNames.layers ?? []).map((l) =>
          drawsText(l as { type?: string; layout?: Record<string, unknown> })
            ? { ...l, layout: { ...((l as { layout?: object }).layout ?? {}), visibility: 'none' } }
            : l,
        ),
      } as StyleSpec;
      cached = { withNames, withoutNames };
      return cached;
    } catch {
      // Offline, or the style host is down. Returning null makes the caller
      // fall back to the plain URL, which is exactly what it did before this
      // feature existed - a failed toggle must never cost anybody their map.
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Read the saved preference. Defaults to names ON, which is what a map does. */
export async function getStreetNamesPref(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(PREF_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export async function setStreetNamesPref(on: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    // A preference that will not save is not worth an error on screen.
  }
}

/**
 * The style the map should draw, following the saved preference, plus the
 * state and a toggle for the map's own street-sign button.
 *
 * Returns the plain URL until the JSON has loaded (and for ever, if it never
 * does), so the map is never blank while this resolves.
 */
export function useMapStyle(): {
  style: string | StyleSpec;
  /**
   * Changes whenever the style does. The map is KEYED on it, so a style change
   * rebuilds the map from scratch: MapLibre can drop layers the app added (the
   * parcels, the grid) when its style is swapped underneath them, and testers
   * saw every parcel vanish. The swap happens on every launch too - the plain
   * URL first, then the fetched style - so this was not only the toggle.
   */
  styleKey: string;
  labelsOn: boolean;
  toggleLabels: () => void;
} {
  const [labelsOn, setLabelsOn] = useState(true);
  const [styles, setStyles] = useState<Cached | null>(null);

  // ON FOCUS, not on mount: Settings can change the preference on another
  // screen, and the map must pick that up when it comes back into view. The
  // style JSON is cached after the first fetch, so this costs one read.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [on, loaded] = await Promise.all([getStreetNamesPref(), loadStyles()]);
        if (cancelled) return;
        setLabelsOn(on);
        setStyles(loaded);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Instant on the map; the write follows.
  const toggleLabels = useCallback(() => {
    setLabelsOn((on) => {
      void setStreetNamesPref(!on);
      return !on;
    });
  }, []);

  const style = styles ? (labelsOn ? styles.withNames : styles.withoutNames) : MAP_STYLE_URL;
  const styleKey = styles ? (labelsOn ? 'names' : 'plain') : 'url';
  return { style, styleKey, labelsOn, toggleLabels };
}
