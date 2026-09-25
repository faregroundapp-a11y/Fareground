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
 * A ticking "time left". Only THIS text re-renders every second - the screen
 * around it does not, which matters on the map where a full re-render is
 * expensive.
 */
export function Countdown({
  endsAt,
  style,
  onDone,
}: {
  endsAt: number;
  style?: StyleProp<TextStyle>;
  onDone?: () => void;
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

  return <Text style={style}>{formatDuration((endsAt - now) / 1000)}</Text>;
}
