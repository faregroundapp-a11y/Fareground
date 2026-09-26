import { useEffect, useRef, useState } from 'react';
import { Text, type TextStyle, type StyleProp } from 'react-native';

/**
 * A number that rolls to its new value instead of snapping - so spending
 * 100 WP or earning coins is something you SEE happen.
 */
/**
 * Compact form for a number that has to fit a fixed-width chip.
 *
 * WHY: the HUD pills sit on one row with the profile picture, the boost chip
 * and the compass. A player with a few million coins rendered
 * "1,234,567" - about 80pt of extra width - and on a 320pt phone the row ran
 * off the screen. Nobody reads the exact figure on a map HUD anyway; they
 * read whether it is going up.
 */
function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  // 10k, not 100k. At the higher threshold the WIDEST possible output was
  // "99,999" - six characters, wider than "1.2M" - so the worst case was in
  // the middle of the range rather than at the top of it, which is exactly
  // where nobody looks for it.
  if (abs >= 10_000) return `${Math.round(n / 1_000)}k`;
  return n.toLocaleString();
}

export function CountUp({
  value,
  style,
  durationMs = 700,
  short = false,
}: {
  value: number;
  style?: StyleProp<TextStyle>;
  durationMs?: number;
  /** Abbreviate past 100k, for chips that cannot grow. */
  short?: boolean;
}) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    const from = current.current;
    if (from === value) return;
    const t0 = Date.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (Date.now() - t0) / durationMs);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(from + (value - from) * e);
      current.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return (
    <Text style={style} numberOfLines={1}>
      {short ? compact(shown) : shown.toLocaleString()}
    </Text>
  );
}
