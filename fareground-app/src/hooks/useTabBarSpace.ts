import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * THE FLOATING TAB BAR (2026-10-03 UI refresh) sits over the bottom of every
 * screen instead of taking its own strip, so the map runs edge to edge. That
 * means each screen has to leave room for it itself: scroll lists pad their
 * bottom by this much, and the map lifts its claim card above it.
 */
export const TAB_BAR_HEIGHT = 64;
/** Gap between the bar and the bottom edge (on top of the system inset). */
export const TAB_BAR_GAP = 10;

/** Where the bar's bottom edge sits, measured up from the screen's bottom. */
export function useTabBarBottom() {
  const insets = useSafeAreaInsets();
  return insets.bottom + TAB_BAR_GAP;
}

/** How much of the screen's bottom the bar covers, plus breathing room. */
export function useTabBarSpace() {
  return useTabBarBottom() + TAB_BAR_HEIGHT + 12;
}
