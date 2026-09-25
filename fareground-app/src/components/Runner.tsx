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
  const showHair = !showHat && hairColor !== 'transparent';

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

          {/* A scarf and a medal hang on the CHEST, which the runner has and
              the head-and-shoulders portrait barely does. Drawn over the
              torso and under the near arm, so the arm swings in front. */}
          {faceKey === 'face_scarf' && (
            <Path
              d={`M${shoulder.x - 5} ${shoulder.y + 5}h10`}
              stroke={faceColor}
              strokeWidth={5}
              strokeLinecap="round"
            />
          )}
          {faceKey === 'face_medal' && (
            <>
              <Circle cx={shoulder.x + 1} cy={shoulder.y + 9} r={3} fill={CONTOUR} />
              <Circle cx={shoulder.x + 1} cy={shoulder.y + 9} r={2.2} fill={faceColor} />
            </>
          )}

          {/* Near limbs, in front of the torso. */}
          <Limb d={legA.d} color="#3B4A68" width={8.5} />
          <Limb d={armA.d} color={shirtColor} width={6.4} />

          {/* Shoes: a stubby wedge rather than a line, which is the difference
              between "has feet" and "ends in a point" at this size. */}
          {[legB, legA].map((leg, i) => (
            <Path
              key={i}
              d={`M${leg.end.x - 2.5} ${leg.end.y + 1}h8`}
              stroke={CONTOUR}
              strokeWidth={i === 0 ? 6.4 : 7}
              strokeLinecap="round"
            />
          ))}
          {/* Far shoe is dimmed so the two read as depth rather than as one
              shape; the near one carries the trim, which is the part anyone
              actually notices at 64px. */}
          <Path d={`M${legB.end.x - 2.5} ${legB.end.y + 1}h8`} stroke={shoeColor} strokeWidth={4.4} strokeLinecap="round" opacity={0.72} />
          <Path d={`M${legA.end.x - 2.5} ${legA.end.y + 1}h8`} stroke={shoeColor} strokeWidth={5} strokeLinecap="round" />
          <Path d={`M${legA.end.x - 2} ${legA.end.y + 2.6}h7`} stroke={shoeTrim} strokeWidth={1.6} strokeLinecap="round" />

          {/* Hands. */}
          <Circle cx={armA.end.x} cy={armA.end.y} r={2.8} fill={CONTOUR} />
          <Circle cx={armA.end.x} cy={armA.end.y} r={2.1} fill={skin} />

          {/* -------- the head: the biggest shape, and the character -------- */}
          <G transform={`rotate(${pose.tilt} ${head.x} ${head.y + HEAD_R})`}>
            <Circle cx={head.x} cy={head.y} r={HEAD_R + 1.3} fill={CONTOUR} />
            <Circle cx={head.x} cy={head.y} r={HEAD_R} fill={skin} />
            <Circle cx={head.x} cy={head.y} r={HEAD_R} fill="url(#face)" />

            {/* Hair, in the shapes the portrait uses. Only the ones that
                change the SILHOUETTE are worth distinguishing at 64px -
                a mohawk and a top knot read instantly; short and long do
                not, so they share the same cap shape. */}
            {showHair && (
              <>
                {hairKey === 'hair_punk' ? (
                  <Path
                    d={`M${head.x} ${head.y - HEAD_R - 6}l3 5v${HEAD_R}h-6v-${HEAD_R}z`}
                    fill={hairColor}
                  />
                ) : hairKey === 'hair_curls' ? (
                  <G fill={hairColor}>
                    <Circle cx={head.x - 6} cy={head.y - HEAD_R + 2} r={4.6} />
                    <Circle cx={head.x + 1} cy={head.y - HEAD_R - 1} r={5.2} />
                    <Circle cx={head.x + 7} cy={head.y - HEAD_R + 2} r={4.6} />
                  </G>
                ) : (
                  <Path
                    d={`M${head.x - HEAD_R} ${head.y - 0.5}a${HEAD_R} ${HEAD_R} 0 01${HEAD_R * 2} 0` +
                       `q-${HEAD_R * 0.5} -3 -${HEAD_R} -3q-${HEAD_R * 0.5} 0 -${HEAD_R} 3z`}
                    fill={hairColor}
                  />
                )}
                {hairKey === 'hair_bun' && <Circle cx={head.x} cy={head.y - HEAD_R - 2} r={4} fill={hairColor} />}
                {hairKey === 'hair_long' && (
                  <Path
                    d={`M${head.x - HEAD_R + 0.5} ${head.y}q-1 8 0 12h4q-2-6-1-12z` +
                       `M${head.x + HEAD_R - 0.5} ${head.y}q1 8 0 12h-4q2-6 1-12z`}
                    fill={hairColor}
                  />
                )}
              </>
            )}

            {showHat && (
              <>
                {/* Crown. */}
                <Path
                  d={`M${head.x - HEAD_R} ${head.y - 1}a${HEAD_R} ${HEAD_R} 0 01${HEAD_R * 2} 0z`}
                  fill={hatColor}
                  stroke={CONTOUR}
                  strokeWidth={1.4}
                  strokeLinejoin="round"
                />
                {(hatKey === 'hat_cap' || hatKey === 'hat_miner' || hatKey === 'hat_visor') && (
                  <Path
                    d={`M${head.x + HEAD_R - 3} ${head.y - 2.5}h5.5`}
                    stroke={CONTOUR}
                    strokeWidth={5}
                    strokeLinecap="round"
                  />
                )}
                {(hatKey === 'hat_cap' || hatKey === 'hat_miner' || hatKey === 'hat_visor') && (
                  <Path
                    d={`M${head.x + HEAD_R - 3} ${head.y - 2.5}h5.2`}
                    stroke={hatColor}
                    strokeWidth={3}
                    strokeLinecap="round"
                  />
                )}
                {hatKey === 'hat_bucket' && (
                  <>
                    <Path d={`M${head.x - HEAD_R - 3} ${head.y - 1}h${HEAD_R * 2 + 6}`} stroke={CONTOUR} strokeWidth={5} strokeLinecap="round" />
                    <Path d={`M${head.x - HEAD_R - 3} ${head.y - 1}h${HEAD_R * 2 + 6}`} stroke={hatColor} strokeWidth={3} strokeLinecap="round" />
                  </>
                )}
                {hatKey === 'hat_miner' && (
                  <>
                    <Circle cx={head.x + 1} cy={head.y - HEAD_R + 3} r={2.6} fill={CONTOUR} />
                    <Circle cx={head.x + 1} cy={head.y - HEAD_R + 3} r={1.9} fill="#FFF3CC" />
                  </>
                )}
                {/* A crown is a silhouette, and the whole point of earning
                    one is that other people can see it. */}
                {hatKey === 'hat_crown' && (
                  <Path
                    d={`M${head.x - HEAD_R} ${head.y - 2}l4 -6 3.5 4 3.5 -6 3.5 6 3.5 -4 4 6z`}
                    fill={hatColor}
                    stroke={CONTOUR}
                    strokeWidth={1.2}
                    strokeLinejoin="round"
                  />
                )}
                {hatKey === 'hat_beanie' && (
                  <Path
                    d={`M${head.x - HEAD_R - 0.5} ${head.y - 3}h${HEAD_R * 2 + 1}`}
                    stroke={hatColor}
                    strokeWidth={4.5}
                    strokeLinecap="round"
                    opacity={0.8}
                  />
                )}
                {hatKey === 'hat_band' && (
                  <Path
                    d={`M${head.x - HEAD_R} ${head.y - 4}h${HEAD_R * 2}`}
                    stroke={hatColor}
                    strokeWidth={3.6}
                    strokeLinecap="round"
                  />
                )}
              </>
            )}

            {/* A beard sits UNDER the eyes but over the face, same as the
                portrait draws it. */}
            {faceKey === 'face_beard' && (
              <Path
                d={`M${head.x - HEAD_R + 1} ${head.y + 3}q1 7 ${HEAD_R - 1} 7t${HEAD_R - 1} -7` +
                   `q-3 4 -${HEAD_R - 1} 4t-${HEAD_R - 1} -4z`}
                fill={faceColor}
              />
            )}

            {/* Two eyes, not one. A single dot read as a profile and made the
                figure look like it was always looking away.
                Shades and glasses REPLACE them, exactly as in the portrait -
                the two have to be the same character. */}
            {faceKey === 'face_shades' ? (
              <Path
                d={`M${head.x - 2.6} ${head.y + 2.6}h11`}
                stroke={faceColor}
                strokeWidth={5}
                strokeLinecap="round"
              />
            ) : faceKey === 'face_glasses' ? (
              <G stroke={faceColor} strokeWidth={1.3} fill="none">
                <Circle cx={head.x + 0.8} cy={head.y + 2.6} r={2.7} />
                <Circle cx={head.x + 6.4} cy={head.y + 2.6} r={2.7} />
                <Path d={`M${head.x + 3.5} ${head.y + 2.6}h0.6`} />
              </G>
            ) : (
              <>
                <Circle cx={head.x + 0.8} cy={head.y + 2.6} r={1.7} fill="#1B2330" />
                <Circle cx={head.x + 5.9} cy={head.y + 2.6} r={1.7} fill="#1B2330" />
              </>
            )}
            {gait === 'cheer' ? (
              <Path
                d={`M${head.x + 1.2} ${head.y + 6.4}q2.3 2.6 4.6 0`}
                stroke="#1B2330"
                strokeWidth={1.4}
                strokeLinecap="round"
                fill="none"
              />
            ) : null}
          </G>
        </G>
      </Svg>
    </View>
  );
}
