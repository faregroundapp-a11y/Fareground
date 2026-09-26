import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { MAP_STYLE_URL } from '@/config';

/**
 * Street names on the map, on or off.
 *
 * WHY IT IS A STYLE SWAP AND NOT A LAYER CALL. maplibre-react-native takes a
 * whole style for the `mapStyle` prop; there is no supported way to reach in
 * and hide one layer of a style loaded from a URL. So the style JSON is
 * fetched once, and a second copy is kept with the street-name layers set to
 * `visibility: none`. Toggling swaps which copy the map is given.
 *
 * WHAT STAYS VISIBLE. Only STREET names go. Town, city and country labels
 * remain, because they are what tells you roughly where you are - and the
 * point of turning street names off is a cleaner board to claim squares on,
 * not a blank map you cannot navigate.
 *
 * Street names were already rejected once as a permanent feature (the map is
 * a game board, and names crowd the squares). This makes it the player's
 * call instead of ours.
 */

/**
 * The layers that draw street names and road shields, in the OpenMapTiles
 * schema that OpenFreeMap's `liberty` style follows.
 *
 * `road_one_way_arrow*` is deliberately NOT here: those are direction arrows
 * rather than names, and they read as part of the road itself.
 */
const STREET_LABEL_LAYERS = new Set([
  'highway-name-path',
  'highway-name-minor',
  'highway-name-major',
  'highway-shield-non-us',
  'highway-shield-us-interstate',
  'road_shield_us',
]);

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
          STREET_LABEL_LAYERS.has(l.id)
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
 * The style the map should draw, following the saved preference.
 *
 * Returns the plain URL until the JSON has loaded (and for ever, if it never
 * does), so the map is never blank while this resolves.
 */
export function useMapStyle(): string | StyleSpec {
  const [style, setStyle] = useState<string | StyleSpec>(MAP_STYLE_URL);

  // ON FOCUS, not on mount. The toggle lives in Settings, which is a
  // different screen; with a plain effect the map would keep the old style
  // until something else happened to remount it, and the switch would look
  // broken. The style JSON is cached after the first fetch, so coming back to
  // the map costs one AsyncStorage read.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        const [on, styles] = await Promise.all([getStreetNamesPref(), loadStyles()]);
        if (cancelled || !styles) return;
        setStyle(on ? styles.withNames : styles.withoutNames);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return style;
}
