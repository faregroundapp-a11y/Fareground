import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';
import type { AvatarChoice } from '@/api/types';
import { avatarOf, partAccent, partColor } from '@/game/avatar';

/**
 * The player's runner.
 *
 * Not a sprite sheet - the pose is COMPUTED from a gait phase, so the same
 * figure walks, runs, idles and cheers, and the cadence follows your real
 * speed. Each limb is two segments with angles driven by the phase, which is
 * what gives the knees and elbows their bend instead of the scissor-legs of a
 * two-frame cartoon.
 *
 * ---------------------------------------------------------------------------
 *  REDRAWN 2026-09-24, ON CHIBI PROPORTIONS
 * ---------------------------------------------------------------------------
 *  The old figure was ~5.6 heads tall - real adult proportions. That is the
 *  correct way to draw a person and the wrong way to draw a 64px map marker:
 *  at that size the head was 15px, the limbs were 6px sticks, and the whole
 *  thing read as a generic stick figure that could have belonged to any app.
 *
 *  The rule the genre actually follows (and what the references agree on) is
 *  2-3 HEADS TALL, with a bold silhouette and almost no interior detail,
 *  because at 28-112px the silhouette is the only thing that survives. So:
 *
 *    * THE HEAD IS THE CHARACTER. Now ~2.6 heads tall. The head carries the
 *      hat, the hair and the face - the three things a player picked - so it
 *      gets the room. Everything below it is support.
 *    * THICKER, SHORTER LIMBS. Stroke 6 -> 8.5 on legs. Short limbs on a big
 *      head is what reads as "character" rather than "diagram".
 *    * A CONTOUR AROUND THE WHOLE FIGURE. Every reference on small-size
 *      character art says the same thing: a clean outer edge. Ours is drawn
 *      as a dark under-stroke on each shape, so the figure stays legible on
 *      a pale road, a dark park and a satellite photo alike. Without it the
 *      runner disappeared over light map tiles.
 *    * A SOFTER, ROUNDER SHADOW that scales with the bob, so the figure
 *      feels planted on the ground instead of floating over it.
 *
 *  The gait maths is unchanged - it was good - but the angles are retuned for
 *  the new proportions, since short legs need a wider swing to read as
 *  walking at all.
 */

export type Gait = 'idle' | 'walk' | 'run' | 'cheer';

const W = 64, H = 84;

/**
 * The skeleton. Everything is measured from the head, which is the unit that
 * matters: HEAD_R 11 makes the figure about 2.6 heads tall.
 */
const HEAD_R = 11;
const HIP = { x: 32, y: 55 };
const SHOULDER = { x: 32, y: 40 };
const THIGH = 9, SHIN = 9, UPPER_ARM = 7, FOREARM = 6.5;
const GROUND = 76;

/** The dark edge that keeps the figure readable on any map tile. */
/** Half the distance between the shoulders. */
const SHOULDER_SPAN = 4.6;

const CONTOUR = '#14201A';

const deg = (d: number) => (d * Math.PI) / 180;

/** Angles are measured from straight down; positive swings FORWARD (+x). */
function joint(from: { x: number; y: number }, len: number, angleDeg: number) {
  return { x: from.x + len * Math.sin(deg(angleDeg)), y: from.y + len * Math.cos(deg(angleDeg)) };
}

interface Pose {
  bob: number;
  lean: number;
  legs: [number, number, number, number]; // thighA, shinA, thighB, shinB
  arms: [number, number, number, number]; // upperA, foreA, upperB, foreB
  /** Head tilt, in degrees. A little life costs nothing. */
  tilt: number;
}

function poseFor(gait: Gait, phase: number): Pose {
  const s = Math.sin(phase), c = Math.cos(phase);

  if (gait === 'idle') {
    // Breathing, with the head drifting a fraction behind the chest - the
    // thing that stops an idle pose looking like a paused frame.
    const breathe = Math.sin(phase * 0.5) * 0.9;
    return {
      bob: breathe,
      lean: 0,
      legs: [6, 2, -6, -2],
      arms: [-10, 14, 10, 18],
      tilt: Math.sin(phase * 0.5 - 0.6) * 1.6,
    };
  }
  if (gait === 'cheer') {
    // A hop with both arms thrown up, and the head thrown back with them.
    const hop = Math.max(0, Math.sin(phase)) * 8;
    return {
      bob: -hop,
      lean: 0,
      legs: [30, -20, -30, 20],
      arms: [105, 125, -105, -125],
      tilt: -4 - hop * 0.3,
    };
  }

  const run = gait === 'run';
  // Wider than before: short legs need a bigger swing to read as walking.
  const swing = run ? 46 : 30;
  const bend = (p: number) => (run ? 22 + 78 * (0.5 - 0.5 * Math.cos(p)) : 8 + 38 * (0.5 - 0.5 * Math.cos(p)));
  const thighA = swing * s, thighB = -swing * s;
  return {
    // lowest at foot-strike, highest mid-flight
    bob: -(run ? 3.4 : 1.6) * Math.abs(c),
    lean: run ? 10 : 3.5,
    legs: [thighA, thighA - bend(phase), thighB, thighB - bend(phase + Math.PI)],
    // arms swing opposite the legs, elbows bent more when running
    arms: [-swing * 0.8 * s, -swing * 0.8 * s + (run ? 78 : 34), swing * 0.8 * s, swing * 0.8 * s + (run ? 78 : 34)],
    tilt: run ? -3 : -1,
  };
}

function limb(root: { x: number; y: number }, l1: number, a1: number, l2: number, a2: number) {
  const mid = joint(root, l1, a1);
  const end = joint(mid, l2, a2);
  return { d: `M${root.x} ${root.y}L${mid.x} ${mid.y}L${end.x} ${end.y}`, end };
}

/** Steps per second of the gait cycle (one phase turn = two steps). */
const CADENCE: Record<Gait, number> = { idle: 0.35, walk: 0.9, run: 1.45, cheer: 1.6 };

/**
 * A limb, drawn twice: a dark fat stroke underneath for the contour, then the
 * colour on top. Two paths is cheaper and sharper than an SVG filter, and it
 * is the only thing that keeps a 6px limb visible on a white road.
 */
function Limb({ d, color, width }: { d: string; color: string; width: number }) {
  return (
    <>
      <Path d={d} stroke={CONTOUR} strokeWidth={width + 2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d={d} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </>
  );
}

/** A trainer: rounded toe, flat sole, heel at the ankle. */
function shoePath(end: { x: number; y: number }) {
  const x = end.x - 3, y = end.y - 1.2;
  return `M${x} ${y}h4.2q5.6 0 6.4 3.8v1.2h-10.6q-1.2 0-1.2-1.4z`;
}

/** A point on the head's outline, `deg` clockwise from "3 o'clock". */
function onHead(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
const f = (n: number) => n.toFixed(2);

/** Hats that cover the crown: a bun or a mohawk would poke through them. */
const CROWN_HATS = new Set(['hat_cap', 'hat_miner', 'hat_beanie', 'hat_winter', 'hat_bucket', 'hat_explorer', 'hat_flatcap']);

/**
 * THE RUNNER'S HEAD, redrawn 2026-10-01 ("make the characters look better,
 * some items are questionable"). The figure faces right in a three-quarter
 * view, so everything is drawn for that view rather than borrowed from the
 * front-facing portrait:
 *
 *   * HAIR covers the crown AND the back of the head, ends in a fringe at
 *     the front, and has the same dark outline as everything else - it used
 *     to be an outline-less cap that looked pasted on.
 *   * HAIR SHOWS UNDER HATS at the back, instead of every hat going bald.
 *   * THE HEADBAND AND VISOR are bands, not a full dome hat.
 *   * THE MOHAWK is a row of spikes, not a purple rectangle.
 *   * SHADES are two dark lenses with a bridge, an arm and a glint - not a
 *     black bar across the face.
 *   * A BEARD follows the jaw and leaves the mouth showing.
 *   * The face itself (eyes, the cheering smile) is unchanged.
 */
function RunnerHead({
  x, y, skin, hairKey, hairColor, hatKey, hatColor, faceKey, faceColor, happy,
}: {
  x: number; y: number; skin: string;
  hairKey: string; hairColor: string; hatKey: string; hatColor: string;
  faceKey: string; faceColor: string; happy: boolean;
}) {
  const R = HEAD_R;
  const hasHair = hairKey !== 'hair_none' && hairColor !== 'transparent';
  const hasHat = hatKey !== 'hat_none';
  const crownCovered = hasHat && CROWN_HATS.has(hatKey);
  const tall = hasHair && !crownCovered;

  // The hair cap: over the crown from a fringe at the front to the nape.
  const front = onHead(x, y, R + 0.6, -32);
  const back = onHead(x, y, R + 0.6, 198);
  const hairCap =
    `M${f(front.x)} ${f(front.y)}A${R + 0.6} ${R + 0.6} 0 0 0 ${f(back.x)} ${f(back.y)}` +
    `Q${f(x - R * 0.55)} ${f(y + R * 0.05)} ${f(x - R * 0.25)} ${f(y - R * 0.3)}` +
    `Q${f(x + R * 0.25)} ${f(y - R * 0.62)} ${f(front.x)} ${f(front.y)}z`;

  const eyeY = y + 2.6;
  const eyes: [number, number] = [x + 0.8, x + 5.9];

  return (
    <G>
      {/* Behind the head: long hair falls down the back, a bun sits high. */}
      {hasHair && hairKey === 'hair_long' && (
        <Path
          d={`M${f(x - R * 0.95)} ${f(y - 1)}q-2 ${f(R * 0.9)} 0 ${f(R * 1.45)}h${f(R * 0.75)}q-1 ${f(-R * 0.6)} 1.4 ${f(-R * 1.3)}z`}
          fill={hairColor}
          stroke={CONTOUR}
          strokeWidth={1.3}
          strokeLinejoin="round"
        />
      )}
      {tall && hairKey === 'hair_bun' && (() => {
        const b = onHead(x, y, R + 1.6, -140);
        return <Circle cx={b.x} cy={b.y} r={4.4} fill={hairColor} stroke={CONTOUR} strokeWidth={1.3} />;
      })()}

      {/* The head. */}
      <Circle cx={x} cy={y} r={R + 1.3} fill={CONTOUR} />
      <Circle cx={x} cy={y} r={R} fill={skin} />
      <Circle cx={x} cy={y} r={R} fill="url(#face)" />

      {/* Hair. */}
      {hasHair && (hairKey === 'hair_punk' ? (
        <>
          {/* Shaved sides, then the crest. */}
          <Path d={hairCap} fill={hairColor} opacity={0.3} />
          <Path
            d={(() => {
              let d = '';
              const spikes = [-40, -72, -104, -136, -166];
              spikes.forEach((deg, i) => {
                const base1 = onHead(x, y, R - 1, deg + 14);
                const tip = onHead(x, y, R + (tall ? 6.5 - Math.abs(i - 2) * 0.8 : 1.5), deg);
                const base2 = onHead(x, y, R - 1, deg - 14);
                d += `${i === 0 ? 'M' : 'L'}${f(base1.x)} ${f(base1.y)}L${f(tip.x)} ${f(tip.y)}L${f(base2.x)} ${f(base2.y)}`;
              });
              const inner = onHead(x, y, R - 4, -100);
              return `${d}Q${f(inner.x)} ${f(inner.y)} ${f(onHead(x, y, R - 1, -26).x)} ${f(onHead(x, y, R - 1, -26).y)}z`;
            })()}
            fill={hairColor}
            stroke={CONTOUR}
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        </>
      ) : hairKey === 'hair_curls' && tall ? (
        <G>
          {[-20, -55, -90, -125, -160, 195].map((deg) => {
            const c = onHead(x, y, R - 0.4, deg);
            return <Circle key={`o${deg}`} cx={c.x} cy={c.y} r={4.9} fill={CONTOUR} />;
          })}
          {[-20, -55, -90, -125, -160, 195].map((deg) => {
            const c = onHead(x, y, R - 0.4, deg);
            return <Circle key={deg} cx={c.x} cy={c.y} r={3.7} fill={hairColor} />;
          })}
        </G>
      ) : (
        <Path d={hairCap} fill={hairColor} stroke={CONTOUR} strokeWidth={1.3} strokeLinejoin="round" />
      ))}

      {/* ---- the face ---- */}
      {faceKey === 'face_beard' && (
        <Path
          d={`M${f(x - 3)} ${f(y + 2.5)}Q${f(x - 2)} ${f(y + R + 1.6)} ${f(x + 4)} ${f(y + R + 1)}Q${f(x + R)} ${f(y + R * 0.75)} ${f(x + R - 0.4)} ${f(y + 4)}` +
             `Q${f(x + 6)} ${f(y + 5.6)} ${f(x + 3.3)} ${f(y + 5.2)}Q${f(x + 0.5)} ${f(y + 6.8)} ${f(x - 3)} ${f(y + 2.5)}z`}
          fill={faceColor}
          stroke={CONTOUR}
          strokeWidth={1}
          strokeLinejoin="round"
        />
      )}

      {/* The eyes, as they always were. Shades replace them. */}
      {faceKey !== 'face_shades' &&
        eyes.map((ex) => <Circle key={ex} cx={ex} cy={eyeY} r={1.7} fill="#1B2330" />)}

      {faceKey === 'face_shades' && (
        <G>
          {/* the arm back towards the ear */}
          <Path d={`M${f(eyes[0] - 2.4)} ${f(eyeY - 1)}L${f(x - 5.5)} ${f(eyeY - 2)}`} stroke={CONTOUR} strokeWidth={1.4} strokeLinecap="round" />
          {/* two lenses: flat top, rounded bottom - sunglasses, not a bar */}
          {eyes.map((ex, i) => (
            <Path
              key={ex}
              d={`M${f(ex - (i ? 2.3 : 2.6))} ${f(eyeY - 1.6)}h${i ? 4.6 : 5.2}q0.2 3.6 -2.5 3.7q-2.6 0 -2.7 -3.7z`}
              fill={faceColor}
              stroke={CONTOUR}
              strokeWidth={1}
              strokeLinejoin="round"
            />
          ))}
          <Path d={`M${f(eyes[0] + 2.6)} ${f(eyeY - 1.2)}h${f(eyes[1] - eyes[0] - 4.9)}`} stroke={CONTOUR} strokeWidth={1.2} />
          {eyes.map((ex) => (
            <Path key={`g${ex}`} d={`M${f(ex - 1.3)} ${f(eyeY - 0.6)}l1.3 -0.6`} stroke="#FFFFFF" strokeWidth={0.8} strokeLinecap="round" opacity={0.7} />
          ))}
        </G>
      )}
      {faceKey === 'face_glasses' && (
        <G stroke={faceColor} strokeWidth={1.2} fill="#FFFFFF" fillOpacity={0.18}>
          <Path d={`M${f(eyes[0] - 2.6)} ${f(eyeY - 0.8)}L${f(x - 5.5)} ${f(eyeY - 1.8)}`} fill="none" />
          <Circle cx={eyes[0]} cy={eyeY} r={2.7} />
          <Circle cx={eyes[1]} cy={eyeY} r={2.7} />
          <Path d={`M${f(eyes[0] + 2.7)} ${f(eyeY)}h${f(eyes[1] - eyes[0] - 5.4)}`} fill="none" />
        </G>
      )}
      {faceKey === 'face_monocle' && (
        <G>
          <Circle cx={eyes[1]} cy={eyeY} r={2.9} stroke={faceColor} strokeWidth={1.3} fill="#FFFFFF" fillOpacity={0.2} />
          <Path d={`M${f(eyes[1] + 1.6)} ${f(eyeY + 2.4)}q1.6 4 -1 7.5`} stroke={faceColor} strokeWidth={0.8} fill="none" />
        </G>
      )}

      {/* A smile only when cheering, as before. */}
      {happy && (
        <Path d={`M${f(x + 1.2)} ${f(y + 6.4)}q2.3 2.6 4.6 0`} stroke="#1B2330" strokeWidth={1.4} strokeLinecap="round" fill="none" />
      )}

      {/* ---- hats, on top ---- */}
      {hasHat && <RunnerHat x={x} y={y} hatKey={hatKey} color={hatColor} />}
    </G>
  );
}

function RunnerHat({ x, y, hatKey, color }: { x: number; y: number; hatKey: string; color: string }) {
  const R = HEAD_R;
  const outline = { stroke: CONTOUR, strokeWidth: 1.4, strokeLinejoin: 'round' as const };
  // A dome over the crown, its rim a little above the eyes.
  const dome = (lift: number, h: number) =>
    `M${f(x - R - 0.6)} ${f(y - lift)}C${f(x - R)} ${f(y - lift - h)} ${f(x + R)} ${f(y - lift - h)} ${f(x + R + 0.6)} ${f(y - lift)}z`;
  // A brim that sticks out forward (the figure faces right).
  const peak = (len: number, at: number) => (
    <Path
      d={`M${f(x + R * 0.35)} ${f(y - at)}h${f(R * 0.65 + len)}q1.6 0 1.2 1.4q-0.4 1 -2 1h${f(-(R * 0.65 + len) + 0.8)}z`}
      fill={color}
      {...outline}
    />
  );

  switch (hatKey) {
    case 'hat_cap':
    case 'hat_miner':
      return (
        <G>
          <Path d={dome(1.6, R * 1.25)} fill={color} {...outline} />
          {peak(5.5, 2.4)}
          {hatKey === 'hat_miner' ? (
            <>
              <Circle cx={x + R * 0.55} cy={y - 5.6} r={2.8} fill={CONTOUR} />
              <Circle cx={x + R * 0.55} cy={y - 5.6} r={2} fill="#FFF3CC" />
            </>
          ) : (
            <Circle cx={x - 1} cy={y - R + 0.4} r={1.1} fill={CONTOUR} />
          )}
        </G>
      );
    case 'hat_flatcap':
      return (
        <G>
          <Path d={`M${f(x - R - 0.6)} ${f(y - 1.6)}C${f(x - R)} ${f(y - R - 1)} ${f(x + R * 0.6)} ${f(y - R - 1.4)} ${f(x + R + 2)} ${f(y - 3.4)}L${f(x + R + 1)} ${f(y - 1.6)}z`} fill={color} {...outline} />
          {peak(2.5, 2.2)}
        </G>
      );
    case 'hat_beanie':
    case 'hat_winter':
      return (
        <G>
          <Path d={dome(2.6, R * 1.55)} fill={color} {...outline} />
          <Path d={`M${f(x - R - 0.4)} ${f(y - 3.4)}h${f(R * 2 + 0.8)}`} stroke={CONTOUR} strokeWidth={5.2} strokeLinecap="round" />
          <Path d={`M${f(x - R - 0.4)} ${f(y - 3.4)}h${f(R * 2 + 0.8)}`} stroke={color} strokeWidth={2.8} strokeLinecap="round" />
          <Path d={`M${f(x - R + 1)} ${f(y - 3.4)}h${f(R * 2 - 2)}`} stroke="#000000" strokeWidth={2.8} strokeDasharray="1 1.6" opacity={0.15} />
          {hatKey === 'hat_winter' && (
            <Circle cx={x - 1.5} cy={y - R - 3.6} r={2.8} fill="#FFFFFF" stroke={CONTOUR} strokeWidth={1.1} />
          )}
        </G>
      );
    case 'hat_bucket':
    case 'hat_explorer':
      return (
        <G>
          <Path d={dome(2.2, R * (hatKey === 'hat_explorer' ? 1.5 : 1.3))} fill={color} {...outline} />
          {hatKey === 'hat_explorer' && (
            <Path d={`M${f(x - R + 0.4)} ${f(y - 4.2)}h${f(R * 2 - 0.8)}`} stroke="#3B2F1C" strokeWidth={2.4} />
          )}
          <Path
            d={`M${f(x - R - 4.5)} ${f(y - 0.4)}Q${f(x)} ${f(y - 4.6)} ${f(x + R + 4.5)} ${f(y - 0.4)}Q${f(x)} ${f(y - 2.2)} ${f(x - R - 4.5)} ${f(y - 0.4)}z`}
            fill={color}
            {...outline}
          />
        </G>
      );
    case 'hat_crown':
      return (
        <G>
          <Path
            d={`M${f(x - R + 1)} ${f(y - R + 3)}l1 -6.5 3.6 3.6 3.4 -5.6 3.4 5.6 3.6 -3.6 1 6.5z`}
            fill={color}
            {...outline}
          />
          <Circle cx={x + 0.5} cy={y - R + 0.4} r={1.2} fill="#D8434F" />
        </G>
      );
    case 'hat_band':
    case 'hat_visor':
      return (
        <G>
          {/* A band round the forehead: a strip, not a hat. */}
          <Path d={`M${f(x - R + 0.2)} ${f(y - 5.6)}Q${f(x)} ${f(y - 7.4)} ${f(x + R - 0.2)} ${f(y - 4.8)}`} stroke={CONTOUR} strokeWidth={4.8} strokeLinecap="round" fill="none" />
          <Path d={`M${f(x - R + 0.2)} ${f(y - 5.6)}Q${f(x)} ${f(y - 7.4)} ${f(x + R - 0.2)} ${f(y - 4.8)}`} stroke={color} strokeWidth={2.6} strokeLinecap="round" fill="none" />
          {hatKey === 'hat_visor' && peak(5, 5.6)}
        </G>
      );
    default:
      return (
        <Path d={dome(1.6, R * 1.25)} fill={color} {...outline} />
      );
  }
}

export function Runner({
  gait = 'idle',
  facing = 1,
  size = 64,
  jersey,
  avatar,
}: {
  gait?: Gait;
  /** 1 = facing right, -1 = facing left. */
  facing?: 1 | -1;
  size?: number;
  /** Shirt colour. Ignored when `avatar` is given - its shirt decides. */
  jersey?: string;
  /** The player's chosen character parts. */
  avatar?: AvatarChoice | null;
}) {
  const [phase, setPhase] = useState(0);

  // ~30 fps is plenty for a 64 px figure and keeps re-renders cheap. The
  // animation stops entirely when the app is in the background - there is no
  // one to see it, and it would keep the JS thread busy for nothing.
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setActive(s === 'active'));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!active) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const dt = (now - last) / 1000;
      last = now;
      setPhase((p) => (p + dt * CADENCE[gait] * 2 * Math.PI) % (4 * Math.PI));
    }, 33);
    return () => clearInterval(id);
  }, [gait, active]);

  // Which character to draw: the chosen parts, or a plain runner.
  const parts = avatarOf(avatar);
  const skin = avatar ? partColor(parts.skin, '#E7B48C') : '#E7B48C';
  const hairColor = avatar ? partColor(parts.hair, 'transparent') : 'transparent';
  const hatKey = avatar ? parts.hat : 'hat_cap';
  const hatColor = avatar ? partColor(parts.hat, 'transparent') : '#F2A93B';
  const shirtColor = avatar ? partColor(parts.shirt, '#2F5D50') : (jersey ?? '#2F5D50');
  // Shoes show HERE and nowhere else - the portrait is head and shoulders.
  // They are the reward for people who watch their own runner on the map.
  const shoeColor = avatar ? partColor(parts.shoes, '#FFFFFF') : '#FFFFFF';
  const shoeTrim = avatar ? partAccent(parts.shoes, '#F2A93B') : '#F2A93B';
  // FACE EXTRAS AND HAIR SHAPE WERE IGNORED HERE until 2026-09-25. The
  // portrait drew seven hair styles, eight hats and five face extras; the
  // runner drew one generic dome and no face at all. So the character on the
  // map was not the character in your own profile picture - you could put on
  // shades and a crown and your runner would carry on bare-headed.
  const faceKey = avatar ? parts.face : 'face_none';
  const faceColor = avatar ? partColor(parts.face, '#1B2330') : '#1B2330';
  const hairKey = avatar ? parts.hair : 'hair_short';
  const showHat = hatKey !== 'hat_none';
  // Hair shows UNDER a hat now - at the back and the sides, the way a hat
  // actually sits - instead of every hat making the runner bald.
  const showHair = hairColor !== 'transparent';

  const pose = poseFor(gait, phase);
  const hip = { x: HIP.x, y: HIP.y + pose.bob };
  const shoulder = { x: SHOULDER.x + pose.lean * 0.35, y: SHOULDER.y + pose.bob };

  const legA = limb(hip, THIGH, pose.legs[0], SHIN, pose.legs[1]);
  const legB = limb(hip, THIGH, pose.legs[2], SHIN, pose.legs[3]);
  // Rooted either side of the torso, not on its centreline - see the note on
  // SHOULDER_SPAN. The near arm is the one towards the viewer.
  const armRootA = { x: shoulder.x + SHOULDER_SPAN, y: shoulder.y + 1 };
  const armRootB = { x: shoulder.x - SHOULDER_SPAN, y: shoulder.y + 1 };
  const armA = limb(armRootA, UPPER_ARM, pose.arms[0], FOREARM, pose.arms[1]);
  const armB = limb(armRootB, UPPER_ARM, pose.arms[2], FOREARM, pose.arms[3]);
  const head = { x: shoulder.x + pose.lean * 0.5, y: shoulder.y - HEAD_R - 2 };

  // The shadow tightens as the figure rises, which is what sells the hop.
  const lift = Math.max(0, -pose.bob);
  const shadowScale = 1 - lift * 0.035;

  return (
    <View style={{ width: size, height: (size * H) / W }}>
      <Svg width={size} height={(size * H) / W} viewBox={`0 0 ${W} ${H}`}>
        <Defs>
          {/* A soft top-light on the head, so a big round shape is not a flat disc. */}
          <LinearGradient id="face" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
            <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <Ellipse cx={32} cy={GROUND} rx={13 * shadowScale} ry={3.4 * shadowScale} fill="#0B1410" opacity={0.22} />

        <G transform={facing === -1 ? `translate(${W} 0) scale(-1 1)` : undefined}>
          {/* Far limbs first and darker, so the figure has depth. */}
          <Limb d={legB.d} color="#2B3750" width={8} />
          <Limb d={armB.d} color="#1F4A3F" width={6} />

          {/* Torso: a rounded capsule, wider than a stroke, so the body has
              some mass under the head instead of a single line. */}
          <Path
            d={`M${shoulder.x} ${shoulder.y}L${hip.x} ${hip.y}`}
            stroke={CONTOUR}
            strokeWidth={16.6}
            strokeLinecap="round"
          />
          <Path
            d={`M${shoulder.x} ${shoulder.y}L${hip.x} ${hip.y}`}
            stroke={shirtColor}
            strokeWidth={14}
            strokeLinecap="round"
          />
          {/* One highlight down the near edge. Any more detail turns to mush. */}
          <Path
            d={`M${shoulder.x + 3.4} ${shoulder.y + 2}L${hip.x + 3.4} ${hip.y - 3}`}
            stroke="#FFFFFF"
            strokeWidth={2}
            strokeLinecap="round"
            opacity={0.28}
          />

          {/* THE SCARF wraps the neck and its ends fly out behind - it is a
              silhouette now, not a red dash on the chest. Drawn over the
              torso and under the near arm, so the arm swings in front. */}
          {faceKey === 'face_scarf' && (
            <>
              <Path
                d={`M${shoulder.x - 2} ${shoulder.y + 2}q-6 ${2 + pose.bob * 0.3} -11 ${5 - Math.sin(phase) * 1.5}`}
                stroke={CONTOUR}
                strokeWidth={6.4}
                strokeLinecap="round"
                fill="none"
              />
              <Path
                d={`M${shoulder.x - 2} ${shoulder.y + 2}q-6 ${2 + pose.bob * 0.3} -11 ${5 - Math.sin(phase) * 1.5}`}
                stroke={faceColor}
                strokeWidth={4}
                strokeLinecap="round"
                fill="none"
              />
              <Path d={`M${shoulder.x - 6} ${shoulder.y + 0.5}h12`} stroke={CONTOUR} strokeWidth={7.6} strokeLinecap="round" />
              <Path d={`M${shoulder.x - 6} ${shoulder.y + 0.5}h12`} stroke={faceColor} strokeWidth={5.2} strokeLinecap="round" />
              <Path d={`M${shoulder.x - 4} ${shoulder.y + 0.5}h8`} stroke="#FFFFFF" strokeWidth={1} strokeDasharray="1.6 2" opacity={0.5} />
            </>
          )}
          {/* THE MEDAL hangs on a ribbon, big enough to see on the map. */}
          {faceKey === 'face_medal' && (
            <>
              <Path
                d={`M${shoulder.x - 3} ${shoulder.y + 1}L${shoulder.x + 2} ${shoulder.y + 8}L${shoulder.x + 6} ${shoulder.y + 1}`}
                stroke="#2A5FA8"
                strokeWidth={2.2}
                strokeLinejoin="round"
                fill="none"
              />
              <Circle cx={shoulder.x + 2} cy={shoulder.y + 10} r={3.9} fill={CONTOUR} />
              <Circle cx={shoulder.x + 2} cy={shoulder.y + 10} r={3} fill={faceColor} />
              <Circle cx={shoulder.x + 2} cy={shoulder.y + 10} r={1.4} fill="#FFFFFF" opacity={0.45} />
            </>
          )}

          {/* Near limbs, in front of the torso. */}
          <Limb d={legA.d} color="#3B4A68" width={8.5} />
          <Limb d={armA.d} color={shirtColor} width={6.4} />

          {/* Shoes: a chunky trainer - a rounded upper on a sole - rather than
              a dash, which is the difference between "has feet" and "ends in
              a point" at this size. */}
          {[legB, legA].map((leg, i) => (
            <Path
              key={i}
              d={shoePath(leg.end)}
              fill={i === 0 ? shoeColor : shoeColor}
              opacity={i === 0 ? 0.8 : 1}
              stroke={CONTOUR}
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          ))}
          <Path
            d={`M${legA.end.x - 2.6} ${legA.end.y + 3.3}h9.6`}
            stroke={shoeTrim}
            strokeWidth={1.6}
            strokeLinecap="round"
          />

          {/* Hands. */}
          <Circle cx={armA.end.x} cy={armA.end.y} r={2.8} fill={CONTOUR} />
          <Circle cx={armA.end.x} cy={armA.end.y} r={2.1} fill={skin} />

          {/* -------- the head: the biggest shape, and the character -------- */}
          <G transform={`rotate(${pose.tilt} ${head.x} ${head.y + HEAD_R})`}>
            <RunnerHead
              x={head.x}
              y={head.y}
              skin={skin}
              hairKey={showHair ? hairKey : 'hair_none'}
              hairColor={hairColor}
              hatKey={showHat ? hatKey : 'hat_none'}
              hatColor={hatColor}
              faceKey={faceKey}
              faceColor={faceColor}
              happy={gait === 'cheer'}
            />
          </G>
        </G>
      </Svg>
    </View>
  );
}
