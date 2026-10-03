import { useWindowDimensions } from 'react-native';

/**
 * ONE PLACE THAT DECIDES HOW BIG THINGS ARE (2026-10-04). Phones run from
 * 320pt-wide budget Androids to tablets, and the refresh was laid out on a
 * 390pt phone. Screens read these instead of each guessing:
 *
 *   narrow  under 380pt wide: smaller rings, bubbles and pills
 *   short   under 720pt tall: the map's tool rail tightens up
 *   wide    tablets: cards stop growing and sit centred
 *   s(n)    n scaled to the width, within 85%-115%, for the few sizes that
 *           should grow and shrink with the screen (rings, big numbers)
 */
export function useScreenSize() {
  const { width, height } = useWindowDimensions();
  const k = Math.min(1.15, Math.max(0.85, width / 390));
  return {
    width,
    height,
    narrow: width < 380,
    short: height < 720,
    wide: width >= 600,
    /** The widest a floating card or the tab bar should get. */
    maxCardWidth: 560,
    s: (n: number) => Math.round(n * k),
  };
}
