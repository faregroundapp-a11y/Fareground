/**
 * Space to leave at the bottom of a tab screen's content.
 *
 * The tab bar is the fixed white bar again (2026-10-04), which takes its own
 * strip above the phone's navigation bar, so screens only need a little
 * breathing room - not the extra the floating bar needed. Kept as one helper
 * so the bar's style can change again without touching every screen.
 */
export function useTabBarSpace() {
  return 16;
}
