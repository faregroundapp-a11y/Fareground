import { useEffect, useState } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

/** "1:23:45" or "23:45". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * "2h" / "1h59" / "12m" - for chips that cannot grow.
 *
 * The boost can now run for a full day, so the HUD chip was rendering
 * "23:59:04" - about 65pt of a row that did not fit on any phone. Seconds on
 * a multi-hour timer are noise anyway; nobody watches a boost tick down.
 */
export function formatDurationShort(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/**
 * A ticking "time left". Only THIS text re-renders every second - the screen
 * around it does not, which matters on the map where a full re-render is
 * expensive.
 */
export function Countdown({
  endsAt,
  style,
  onDone,
  short = false,
}: {
  endsAt: number;
  style?: StyleProp<TextStyle>;
  onDone?: () => void;
  /** Drop the seconds - for chips with no room to grow. */
  short?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= endsAt) {
        clearInterval(id);
        onDone?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [endsAt, onDone]);

  const left = (endsAt - now) / 1000;
  return (
    <Text style={style} numberOfLines={1}>
      {short ? formatDurationShort(left) : formatDuration(left)}
    </Text>
  );
}
