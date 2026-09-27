import { optional } from './optional';

/**
 * Vibration, in a few named flavours so the whole app feels consistent.
 * Every call is fire-and-forget and safe on a build without the module.
 */
type HapticsModule = typeof import('expo-haptics');
// eslint-disable-next-line @typescript-eslint/no-require-imports -- deliberate: an import would crash builds without the native module (see optional.ts)
const H = optional<HapticsModule>(() => require('expo-haptics'), 'ExpoHaptics');

/**
 * OFF (2026-09-27): the product owner turned vibration off across the app.
 * Every call site stays as it is, so turning it back on is this one line.
 */
const ENABLED = false;

function run(fn: (h: HapticsModule) => Promise<void>) {
  if (!ENABLED || !H) return;
  fn(H).catch(() => {});
}

export const haptics = {
  /** A light tick: selecting a square, switching tabs, toggles. */
  tap: () => run((h) => h.selectionAsync()),
  /** A firm press: the claim button, watching an ad. */
  press: () => run((h) => h.impactAsync(h.ImpactFeedbackStyle.Medium)),
  /** Something good happened: WP earned, boost started. */
  success: () => run((h) => h.notificationAsync(h.NotificationFeedbackType.Success)),
  /** Something was refused: out of reach, not enough WP. */
  warn: () => run((h) => h.notificationAsync(h.NotificationFeedbackType.Warning)),

  /**
   * The claim. Rarer finds hit harder and longer, so you can FEEL a Ruby
   * before you have read the word.
   */
  claim: (rank: number) => {
    if (!ENABLED || !H) return;
    const heavy = () => H.impactAsync(H.ImpactFeedbackStyle.Heavy).catch(() => {});
    const rigid = () => H.impactAsync(H.ImpactFeedbackStyle.Rigid).catch(() => {});
    heavy();
    if (rank >= 1) setTimeout(rigid, 140);
    if (rank >= 2) setTimeout(heavy, 300);
    if (rank >= 3) setTimeout(heavy, 480);
    if (rank >= 4) {
      setTimeout(heavy, 660);
      setTimeout(() => H.notificationAsync(H.NotificationFeedbackType.Success).catch(() => {}), 900);
    }
  },
};
