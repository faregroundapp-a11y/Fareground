import type { CameraRef, LngLat } from '@maplibre/maplibre-react-native';
import { createRef, useEffect, useState } from 'react';
import {
  PanResponder,
  type GestureResponderEvent,
  type GestureResponderHandlers,
  type View,
} from 'react-native';
import { FOLLOW_MS } from '@/components/PlayerMarker';

/**
 * The game camera.
 *
 * WHY WE OWN THE GESTURES
 * The map SDK's built-in gestures fight a follow-camera: drag the map away and
 * the next GPS fix yanks it back. In a game where you ARE the centre of the
 * world, panning away is never what you want. So the player stays locked at
 * the centre and every gesture is re-mapped to something that makes sense
 * around them:
 *
 *   one finger   grab the world and spin it around you, with momentum
 *   two fingers  pinch to zoom, twist to rotate
 *   tilt         not a gesture at all - it follows zoom, so leaning in to
 *                look closely also tips the camera toward the horizon
 *
 * WHY A CLASS
 * Gestures change the camera up to 60 times a second. That state must never
 * trigger React renders, so it lives in one plain controller object created
 * once per map. React only hears about the bearing, a few degrees at a time,
 * for the compass and the runner's facing.
 */

const MIN_ZOOM = 16.2, MAX_ZOOM = 19.6, START_ZOOM = 18.4;

/** Closer in = more tilted. 38 deg at street level, 62 deg right up close. */
export function pitchFor(zoom: number): number {
  return Math.max(38, Math.min(62, 38 + (zoom - MIN_ZOOM) * 7));
}

/** Wrap an angle difference into [-180, 180). */
function wrap(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

type Touch = { x: number; y: number };
const touchesOf = (e: GestureResponderEvent): Touch[] =>
  e.nativeEvent.touches.map((t) => ({ x: t.pageX, y: t.pageY }));

class CameraController {
  readonly cameraRef = createRef<CameraRef>();
  readonly viewRef = createRef<View>();
  readonly panHandlers: GestureResponderHandlers;

  private zoom = START_ZOOM;
  private bearing = 0;
  private centre: LngLat;
  private pivot = { x: 0, y: 0 };  // the player, on screen - the spin centre
  private fingers = 0;
  private pinchAngle = 0;
  private pinchDist = 0;
  private lastAngle = 0;
  private spin = 0;                 // degrees per frame, for momentum
  private frame = 0;
  private dragging = false;
  private publishedBearing = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];

  // Tap detection. The gesture layer swallows every touch, so a tap on the
  // map has to be recognised here: one finger, barely moved, quickly lifted.
  private touchStart = { x: 0, y: 0, t: 0 };
  private maxFingers = 0;
  private travelled = 0;
  private tapHandler: ((x: number, y: number) => void) | null = null;
  setTapHandler(fn: ((x: number, y: number) => void) | null) {
    this.tapHandler = fn;
  }

  constructor(centre: LngLat, private readonly onBearing: (deg: number) => void) {
    this.centre = centre;
    this.panHandlers = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        this.dragging = true;
        this.stopMomentum();
        this.fingers = 0; // re-seeded on the first move
        this.touchStart = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY, t: Date.now() };
        this.maxFingers = e.nativeEvent.touches.length;
        this.travelled = 0;
      },
      onPanResponderMove: (e, g) => {
        this.maxFingers = Math.max(this.maxFingers, e.nativeEvent.touches.length);
        this.travelled = Math.max(this.travelled, Math.hypot(g.dx, g.dy));
        this.move(touchesOf(e));
      },
      onPanResponderRelease: () => {
        this.dragging = false;
        // A tap selects a square rather than turning the world.
        const isTap = this.maxFingers <= 1 && this.travelled < 10 && Date.now() - this.touchStart.t < 350;
        if (isTap) {
          this.fingers = 0;
          this.tapHandler?.(this.touchStart.x, this.touchStart.y);
          return;
        }
        // A one-finger flick keeps turning and slows down.
        if (this.fingers === 1 && Math.abs(this.spin) > 0.25) {
          this.spin = Math.max(-12, Math.min(12, this.spin));
          this.momentum();
        }
        this.fingers = 0;
      },
      onPanResponderTerminate: () => {
        this.dragging = false;
        this.fingers = 0;
      },
    }).panHandlers;
  }

  initialViewState() {
    return { center: this.centre, zoom: this.zoom, bearing: 0, pitch: pitchFor(this.zoom) };
  }

  /** Record where the player sits on screen (the middle of the map view). */
  measure = () => {
    this.viewRef.current?.measureInWindow((x, y, w, h) => {
      this.pivot = { x: x + w / 2, y: y + h / 2 };
    });
  };

  /** A new GPS fix: glide there over the same time the runner does. */
  follow(centre: LngLat) {
    this.centre = centre;
    if (!this.dragging) this.apply(FOLLOW_MS);
  }

  /** Swing back to facing north along the shortest way round. */
  faceNorth = () => {
    this.stopMomentum();
    this.bearing -= wrap(this.bearing);
    this.apply(450);
    this.bearing = 0;
    this.publish(true);
  };

  /** The claim moment: lean in, hold, then settle back. */
  swoop = () => {
    this.stopMomentum();
    const restore = this.zoom;
    this.zoom = Math.min(MAX_ZOOM, restore + 0.6);
    this.apply(650);
    this.timers.push(
      setTimeout(() => {
        this.zoom = restore;
        this.apply(900);
      }, 1900),
    );
  };

  dispose() {
    cancelAnimationFrame(this.frame);
    this.timers.forEach(clearTimeout);
  }

  private move(t: Touch[]) {
    // Finger count changed: re-seed rather than jump.
    if (t.length !== this.fingers) {
      this.fingers = t.length;
      if (t.length >= 2) {
        this.pinchAngle = Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x);
        this.pinchDist = Math.hypot(t[1].x - t[0].x, t[1].y - t[0].y);
      } else if (t.length === 1) {
        this.lastAngle = Math.atan2(t[0].y - this.pivot.y, t[0].x - this.pivot.x);
      }
      return;
    }

    if (t.length >= 2) {
      // Pinch = zoom, on a log scale so it feels the same at every level.
      const dist = Math.hypot(t[1].x - t[0].x, t[1].y - t[0].y);
      const angle = Math.atan2(t[1].y - t[0].y, t[1].x - t[0].x);
      if (this.pinchDist > 0) {
        this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom + Math.log2(dist / this.pinchDist)));
      }
      // Twist = rotate. The world turns WITH your fingers, which means the
      // camera's bearing moves the other way.
      this.bearing -= wrap(((angle - this.pinchAngle) * 180) / Math.PI);
      this.pinchDist = dist;
      this.pinchAngle = angle;
      this.spin = 0;
    } else if (t.length === 1) {
      const dx = t[0].x - this.pivot.x, dy = t[0].y - this.pivot.y;
      const angle = Math.atan2(dy, dx);
      // Right on top of the player the angle is unstable - ignore it there.
      const delta = Math.hypot(dx, dy) < 44 ? 0 : wrap(((angle - this.lastAngle) * 180) / Math.PI);
      this.lastAngle = angle;
      this.bearing -= delta;
      this.spin = -delta;
    }

    this.apply();
    this.publish();
  }

  private momentum() {
    const tick = () => {
      if (Math.abs(this.spin) < 0.04) return;
      this.bearing += this.spin;
      this.spin *= 0.93;
      this.apply();
      this.publish();
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private stopMomentum() {
    cancelAnimationFrame(this.frame);
    this.spin = 0;
  }

  private apply(durationMs?: number) {
    const opts = { center: this.centre, zoom: this.zoom, bearing: this.bearing, pitch: pitchFor(this.zoom) };
    const cam = this.cameraRef.current;
    if (!cam) return;
    if (durationMs) cam.easeTo({ ...opts, duration: durationMs, easing: 'ease' });
    else cam.jumpTo(opts);
  }

  /** Tell React about the bearing - but only when it moved noticeably. */
  private publish(force = false) {
    const b = ((this.bearing % 360) + 360) % 360;
    if (force || Math.abs(wrap(b - this.publishedBearing)) > 2.5) {
      this.publishedBearing = b;
      this.onBearing(b);
    }
  }
}

export function useGameCamera(centre: LngLat, onTap?: (x: number, y: number) => void) {
  const [bearing, setBearing] = useState(0);
  // Created once. `centre` here is only the starting point; after mount the
  // camera follows via the effect below.
  const [controller] = useState(() => new CameraController(centre, setBearing));
  const [initialViewState] = useState(() => controller.initialViewState());

  useEffect(() => {
    controller.follow(centre);
  }, [controller, centre]);

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    controller.setTapHandler(onTap ?? null);
  }, [controller, onTap]);

  // Handed out as separate values: if a caller read them off the controller
  // object, React's compiler would see one of them used as a `ref` and treat
  // every property of that object as a ref.
  return {
    cameraRef: controller.cameraRef,
    viewRef: controller.viewRef,
    panHandlers: controller.panHandlers,
    measure: controller.measure,
    faceNorth: controller.faceNorth,
    swoop: controller.swoop,
    bearing,
    initialViewState,
  };
}
