import { Marker } from '@maplibre/maplibre-react-native';
import { useEffect, useRef, useState } from 'react';
import type { AvatarChoice } from '@/api/types';
import type { Fix } from '@/hooks/useLocation';
import { Runner, type Gait } from './Runner';

/** Must match the camera's follow duration so the runner and view move as one. */
export const FOLLOW_MS = 900;

/** ~30 fps for the glide. */
const FRAME_MS = 33;

/** Speeds in m/s. A brisk walk is ~1.6; jogging starts around 2.4. */
function gaitFor(speed: number): Gait {
  if (speed > 2.4) return 'run';
  if (speed > 0.6) return 'walk';
  return 'idle';
}

/**
 * The runner, pinned to the player's position.
 *
 * GPS arrives in jumps - one fix a second, a few metres apart. Snapping the
 * marker to each one makes the character teleport, so instead it glides from
 * where it is to the new fix over the same time the camera takes to follow.
 */
export function PlayerMarker({
  fix,
  bearing,
  celebrating,
  avatar,
}: {
  /** The player's character, chosen on their profile. */
  avatar?: AvatarChoice | null;
  fix: Fix;
  /** Current camera bearing, so "left" and "right" are as the player sees them. */
  bearing: number;
  celebrating: boolean;
}) {
  const [pos, setPos] = useState<[number, number]>([fix.lng, fix.lat]);
  const [facing, setFacing] = useState<1 | -1>(1);
  const from = useRef<[number, number]>([fix.lng, fix.lat]);
  const shown = useRef<[number, number]>([fix.lng, fix.lat]);

  // Glide to each new fix.
  //
  // Performance: a Marker is a native view that React re-positions on every
  // state change, so this is capped at ~30 updates a second (plenty for a
  // figure moving a few metres), and GPS wobble of under a metre while you
  // stand still does not animate at all.
  useEffect(() => {
    const target: [number, number] = [fix.lng, fix.lat];
    const [lng0, lat0] = shown.current;
    const dLat = (target[1] - lat0) * 111_320;
    const dLng = (target[0] - lng0) * 111_320 * Math.cos((lat0 * Math.PI) / 180);
    if (Math.hypot(dLat, dLng) < 0.8) return;

    from.current = shown.current;
    const t0 = Date.now();
    let raf = 0;
    let lastPaint = 0;
    const step = () => {
      const now = Date.now();
      const k = Math.min(1, (now - t0) / FOLLOW_MS);
      if (k < 1 && now - lastPaint < FRAME_MS) {
        raf = requestAnimationFrame(step);
        return;
      }
      lastPaint = now;
      const e = 1 - Math.pow(1 - k, 3);
      const next: [number, number] = [
        from.current[0] + (target[0] - from.current[0]) * e,
        from.current[1] + (target[1] - from.current[1]) * e,
      ];
      shown.current = next;
      setPos(next);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fix.lng, fix.lat]);

  // Face the way you are travelling, relative to how the camera is turned.
  // Only update when actually moving - standing still keeps the last facing.
  useEffect(() => {
    if (fix.heading === null || fix.speed < 0.6) return;
    const relative = ((fix.heading - bearing) * Math.PI) / 180;
    const next: 1 | -1 = Math.sin(relative) < 0 ? -1 : 1;
    const id = requestAnimationFrame(() => setFacing(next));
    return () => cancelAnimationFrame(id);
  }, [fix.heading, fix.speed, bearing]);

  return (
    <Marker id="me" lngLat={pos} anchor="bottom">
      <Runner gait={celebrating ? 'cheer' : gaitFor(fix.speed)} facing={facing} size={58} avatar={avatar} />
    </Marker>
  );
}
