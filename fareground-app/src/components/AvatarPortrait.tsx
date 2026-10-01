import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import type { AvatarSlot } from '@/api/types';
import { avatarOf, partColor } from '@/game/avatar';
import { colors } from '@/theme';

/**
 * A player's character, head and shoulders, in a circle.
 *
 * ---------------------------------------------------------------------------
 *  REDRAWN 2026-09-25 TO MATCH THE RUNNER
 * ---------------------------------------------------------------------------
 *  The runner on the map went to chibi proportions (2-3 heads tall, bold
 *  silhouette, dark contour). This portrait did not, so the same character
 *  appeared as two different people depending on where you looked: a
 *  realistic head-and-shoulders bust here, a big-headed cartoon out on the
 *  map. Since this now sits as a small badge ON the player's photo, the
 *  mismatch was right next to the thing it clashed with.
 *
 *  What changed, and why each one:
 *
 *    * HEAD 14 -> 19 RADIUS on the same 64 frame. The head is the character -
 *      it carries the hat, the hair and the face, which are the three things
 *      the player actually chose. It now fills the circle the way the
 *      runner's head dominates its body.
 *    * THE CONTOUR from the runner (#14201A), so the figure reads on a pale
 *      leaderboard row and on the dark map HUD alike.
 *    * SHOULDERS SHRANK to a suggestion at the bottom. On a chibi the body is
 *      support, not subject, and at 34px a detailed torso is mud.
 *    * THE NECK WENT. A big head sits straight on the shoulders; a neck under
 *      it reads as a lollipop.
 *    * EYES AND SMILE match the runner's spacing and weight exactly, so the
 *      face is recognisably the same face.
 *
 *  Every avatar part the editor offers is still drawn - the shapes were
 *  re-cut for the bigger head rather than scaled, because a scaled 14px cap
 *  brim became a beak (the same mistake the runner made first time).
 *
 * ---------------------------------------------------------------------------
 *  RE-CUT 2026-09-26: "those avatar things look so weird"
 * ---------------------------------------------------------------------------
 *  Seen side by side in the editor's grid, four things were wrong:
 *
 *    * THE HAIR CAME DOWN TO THE EYES. It filled the whole top half of the
 *      head, so every face wore a helmet. Hair now ends in a fringe well above
 *      the eyes, with short sideburns.
 *    * THE VISOR AND HEADBAND CROSSED THE EYES, for the same reason: they sat
 *      at the head's middle. Both are on the forehead now, clipped to the head
 *      so a band never pokes out past it.
 *    * THE CAP BRIM STUCK OUT SIDEWAYS - a side-view brim from the runner on a
 *      face that looks straight at you. Brims now face the viewer.
 *    * SIX PARTS WERE NEVER DRAWN: the explorer hat, flat cap, winter hat,
 *      monocle and the snow-white and amethyst hair. Their tiles showed a bare
 *      head, so the grid looked like a bug. Every key the server offers now
 *      has a shape.
 *
 *  The head is a little smaller (R 17) with room for proper shoulders, so the
 *  character sits in the circle instead of being jammed into it.
 */

/** Same dark edge the Runner uses. Keep them identical. */
const CONTOUR = '#14201A';

/** Head geometry, in the 64x64 viewBox. */
const CX = 32;
const CY = 31;
const R = 17;
/** Where the eyes sit - every face part lines up on this. */
const EYE_Y = 33;

/** Hair that covers the top of the head and stops in a fringe above the eyes. */
const HAIR_CAP =
  'M13.6 32A18.4 18.4 0 0 1 50.4 32C50.2 27 47.6 23.2 41.5 23.6Q32 25.8 22.5 23.6C16.4 23.2 13.8 27 13.6 32Z';

/** Styles drawn as the plain cap of hair, in their own colour. */
const PLAIN_HAIR = new Set(['hair_short', 'hair_ginger', 'hair_silver', 'hair_snow', 'hair_amethyst']);
/** Hats that cover the crown, so a bun or a mohawk would poke through them. */
const CROWN_HATS = new Set(['hat_cap', 'hat_miner', 'hat_beanie', 'hat_winter', 'hat_bucket', 'hat_explorer', 'hat_flatcap']);

export function AvatarPortrait({
  avatar,
  size = 48,
  ring,
}: {
  avatar: Partial<Record<AvatarSlot, string>> | null | undefined;
  size?: number;
  /** Colour of the outer ring, e.g. gold for a leaderboard winner. */
  ring?: string;
}) {
  const a = avatarOf(avatar);
  const skin = partColor(a.skin, '#E7B48C');
  const hair = partColor(a.hair, 'transparent');
  const hat = partColor(a.hat, 'transparent');
  const shirt = partColor(a.shirt, colors.accent);
  const extra = partColor(a.face, 'transparent');
  const hasHat = a.hat !== 'hat_none';
  const tallHairHidden = hasHat && CROWN_HATS.has(a.hat);
  const gid = `portraitFace${size}`;
  const clipId = `portraitHead${size}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        {/* The same soft top-light the runner's head has, so a big round
            shape is not a flat disc. */}
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
          <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
        {/* Bands (headband, visor) are clipped to the head so they wrap it. */}
        <ClipPath id={clipId}>
          <Circle cx={CX} cy={CY} r={R} />
        </ClipPath>
      </Defs>

      {/* background + ring */}
      <Circle cx="32" cy="32" r="32" fill={shirt} opacity={0.18} />

      <G>
        {/* Long hair falls BEHIND the shoulders and head. */}
        {a.hair === 'hair_long' && (
          <Path
            d="M13.2 30C12 40 12.4 48 14 55h8c-2.4-7-3-15-2-24zM50.8 30c1.2 10 .8 18-.8 25h-8c2.4-7 3-15 2-24z"
            fill={hair}
            stroke={CONTOUR}
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        )}

        {/* Shoulders, with the head resting on them. */}
        <Path d="M9 66c2.4-10.4 10.4-17 23-17s20.6 6.6 23 17z" fill={CONTOUR} />
        <Path d="M11.4 66c2.2-8.8 9.4-14.6 20.6-14.6S50.4 57.2 52.6 66z" fill={shirt} />
        {/* A crew neck, so the shirt is a shirt and not a coloured blob. */}
        <Path d="M23.5 51.6q8.5 5.6 17 0" stroke="#000000" strokeWidth={1.6} strokeLinecap="round" fill="none" opacity={0.22} />
        {a.face === 'face_scarf' && (
          <Path
            d="M19.5 48.5c4.4 3.6 20.6 3.6 25 0v5.4c-4.4 3.6-20.6 3.6-25 0z"
            fill={extra}
            stroke={CONTOUR}
            strokeWidth={1}
          />
        )}
        {a.face === 'face_medal' && (
          <G>
            <Path d="M25 49.5l7 7.5 7-7.5" stroke="#2A5FA8" strokeWidth={3} strokeLinejoin="round" fill="none" />
            <Circle cx="32" cy="58.6" r="5" fill={extra} stroke={CONTOUR} strokeWidth={1.3} />
            <Circle cx="32" cy="58.6" r="2.8" fill="none" stroke="#FFFFFF" strokeWidth={1} opacity={0.55} />
          </G>
        )}

        {/* EARS, redrawn 2026-10-01. They used to be two outlined circles
            stuck on the sides of the head, which read as handles. Now they
            are drawn BEHIND the head, so only the outer half shows: a soft
            oval with the head's own outline running across it, and a little
            inner curve so it reads as an ear. */}
        {[-1, 1].map((side) => (
          <G key={side}>
            <Ellipse cx={CX + side * (R - 0.4)} cy={EYE_Y + 1.4} rx={3.6} ry={4.3} fill={CONTOUR} />
            <Ellipse cx={CX + side * (R - 0.4)} cy={EYE_Y + 1.4} rx={2.5} ry={3.2} fill={skin} />
            <Path
              d={`M${CX + side * (R + 1.2)} ${EYE_Y - 0.4}q${side * 1.1} 1.8 0 3.6`}
              stroke="#000000"
              strokeWidth={1}
              strokeLinecap="round"
              fill="none"
              opacity={0.22}
            />
          </G>
        ))}

        {/* Head. */}
        <Circle cx={CX} cy={CY} r={R + 1.4} fill={CONTOUR} />
        <Circle cx={CX} cy={CY} r={R} fill={skin} />
        <Circle cx={CX} cy={CY} r={R} fill={`url(#${gid})`} />

        {/* ---- hair, under the hat ---- */}
        {(PLAIN_HAIR.has(a.hair) || a.hair === 'hair_long' || a.hair === 'hair_bun') && (
          <Path d={HAIR_CAP} fill={hair} stroke={CONTOUR} strokeWidth={1.2} strokeLinejoin="round" />
        )}
        {a.hair === 'hair_bun' && !tallHairHidden && (
          <Circle cx="32" cy="11" r="5.4" fill={hair} stroke={CONTOUR} strokeWidth={1.2} />
        )}
        {a.hair === 'hair_curls' && (
          <G fill={hair} stroke={CONTOUR} strokeWidth={1.2}>
            <Circle cx="18" cy="24" r="5.6" />
            <Circle cx="46" cy="24" r="5.6" />
            <Circle cx="23.5" cy="17.5" r="6.2" />
            <Circle cx="40.5" cy="17.5" r="6.2" />
            <Circle cx="32" cy="15" r="6.6" />
          </G>
        )}
        {a.hair === 'hair_punk' && (
          <G>
            {/* Shaved sides, then a crest of spikes from the forehead back. */}
            <Path d={HAIR_CAP} fill={hair} opacity={0.3} />
            <Path
              d={
                tallHairHidden
                  ? 'M27 22.5Q32 20.5 37 22.5L36 15Q32 13.6 28 15z'
                  : 'M26.6 23.4L23.6 13.6 28.4 15.6 28.6 6.4 32.4 12 35.6 5.2 36.4 13.2 41 10.4 37.4 23.4Q32 21.4 26.6 23.4z'
              }
              fill={hair}
              stroke={CONTOUR}
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
          </G>
        )}

        {/* ---- face ---- */}
        {a.face === 'face_beard' && (
          <G fill={extra} stroke={CONTOUR} strokeWidth={1.1} strokeLinejoin="round">
            <Path d="M15.4 32.5c.4 10.4 7.4 16 16.6 16s16.2-5.6 16.6-16c-2.6 5-6 7.6-9.6 8.2q-7-2.6-14 0c-3.6-.6-7-3.2-9.6-8.2z" />
            <Path d="M26.4 39.6q5.6-3.4 11.2 0q-5.6 1.6-11.2 0z" />
          </G>
        )}
        {a.face === 'face_shades' ? (
          <G>
            {/* Sunglasses (2026-10-01): two lenses, flat on top and rounded
                below, on a frame with a bridge - not a black bar. */}
            <Path d={`M14.6 ${EYE_Y - 3.4}h34.8`} stroke={CONTOUR} strokeWidth={1.6} strokeLinecap="round" />
            {[26, 38].map((ex) => (
              <G key={ex}>
                <Path
                  d={`M${ex - 5.4} ${EYE_Y - 3.6}h10.8q.4 7.6-5.4 7.8q-5.8-.2-5.4-7.8z`}
                  fill={extra}
                  stroke={CONTOUR}
                  strokeWidth={1.3}
                  strokeLinejoin="round"
                />
                <Path d={`M${ex - 3.2} ${EYE_Y - 1.6}l2.6-1`} stroke="#FFFFFF" strokeWidth={1.3} strokeLinecap="round" opacity={0.6} />
              </G>
            ))}
            <Path d={`M30.6 ${EYE_Y - 2.2}q1.4-1.2 2.8 0`} stroke={CONTOUR} strokeWidth={1.4} fill="none" />
          </G>
        ) : (
          <G fill="#1B2330">
            <Circle cx="26" cy={EYE_Y} r="2.4" />
            <Circle cx="38" cy={EYE_Y} r="2.4" />
          </G>
        )}
        {a.face === 'face_glasses' && (
          <G stroke={extra} strokeWidth={1.8} fill="none">
            <Circle cx="26" cy={EYE_Y} r="4.8" />
            <Circle cx="38" cy={EYE_Y} r="4.8" />
            <Path d={`M30.8 ${EYE_Y}h2.4`} />
          </G>
        )}
        {a.face === 'face_monocle' && (
          <G>
            <Circle cx="38" cy={EYE_Y} r="4.8" stroke={extra} strokeWidth={1.8} fill="#FFFFFF" fillOpacity={0.15} />
            <Path d={`M42.4 ${EYE_Y + 2}q2 6-1 12`} stroke={extra} strokeWidth={1} fill="none" />
          </G>
        )}
        <Path d="M28.5 40q3.5 3 7 0" stroke="#1B2330" strokeWidth={1.9} strokeLinecap="round" fill="none" />

        {/* ---- hats, on top of everything. Brims face the viewer. ---- */}
        {hasHat && a.hat === 'hat_crown' && (
          <G>
            <Path
              d="M17.5 21L19.5 9.5 25.5 15.5 32 6 38.5 15.5 44.5 9.5 46.5 21z"
              fill={hat}
              stroke={CONTOUR}
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
            <Circle cx="32" cy="16" r="1.8" fill="#D8434F" />
          </G>
        )}
        {hasHat && (a.hat === 'hat_cap' || a.hat === 'hat_miner') && (
          <G>
            <Path
              d="M14.4 26A18 18 0 0 1 49.6 26Q32 22.6 14.4 26z"
              fill={hat}
              stroke={CONTOUR}
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
            <Circle cx="32" cy="13.2" r="1.5" fill={CONTOUR} />
            <Path d="M15 26.4Q32 35.4 49 26.4Q32 23 15 26.4z" fill={hat} stroke={CONTOUR} strokeWidth={1.4} strokeLinejoin="round" />
            <Path d="M19 27.6Q32 33 45 27.6" stroke="#000000" strokeWidth={1.2} fill="none" opacity={0.18} />
            {a.hat === 'hat_miner' && (
              <G>
                <Circle cx="32" cy="18" r="3.8" fill={CONTOUR} />
                <Circle cx="32" cy="18" r="2.8" fill="#FFF3CC" />
              </G>
            )}
          </G>
        )}
        {hasHat && a.hat === 'hat_flatcap' && (
          <G>
            <Path
              d="M13.6 26.5C14 16 22 12 32.5 12.5 43 13 51 17 51 24.5c-6 2.4-30 3.4-37.4 2z"
              fill={hat}
              stroke={CONTOUR}
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
            <Path d="M17 24.6c8 1.4 22 1 31-1.4" stroke="#000000" strokeWidth={1} opacity={0.25} fill="none" />
          </G>
        )}
        {hasHat && (a.hat === 'hat_beanie' || a.hat === 'hat_winter') && (
          <G>
            <Path
              d="M14.4 26A18 18 0 0 1 49.6 26z"
              fill={hat}
              stroke={CONTOUR}
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
            <Rect x="13.4" y="21.4" width="37.2" height="6.4" rx="3.2" fill={hat} stroke={CONTOUR} strokeWidth={1.4} />
            <Rect x="14.6" y="22.6" width="34.8" height="4" rx="2" fill="#000000" opacity={0.12} />
            {a.hat === 'hat_winter' && (
              <G>
                <Path d="M20 17h24" stroke="#FFFFFF" strokeWidth={2} strokeDasharray="2.4 2.4" opacity={0.85} />
                <Circle cx="32" cy="9.8" r="4" fill="#FFFFFF" stroke={CONTOUR} strokeWidth={1.2} />
              </G>
            )}
          </G>
        )}
        {hasHat && (a.hat === 'hat_bucket' || a.hat === 'hat_explorer') && (
          <G>
            <Path
              d={a.hat === 'hat_explorer' ? 'M17 24.5C17 13 23 9.5 32 9.5S47 13 47 24.5z' : 'M17.5 24.5A15 13 0 0 1 46.5 24.5z'}
              fill={hat}
              stroke={CONTOUR}
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
            {a.hat === 'hat_explorer' && <Rect x="17.6" y="19.6" width="28.8" height="3.2" fill="#3B2F1C" />}
            <Ellipse cx="32" cy="25.2" rx="21.5" ry="4.4" fill={hat} stroke={CONTOUR} strokeWidth={1.4} />
          </G>
        )}
        {hasHat && (a.hat === 'hat_band' || a.hat === 'hat_visor') && (
          <G clipPath={`url(#${clipId})`}>
            <Path d="M12 23.6Q32 17.6 52 23.6v5Q32 22.6 12 28.6z" fill={hat} stroke={CONTOUR} strokeWidth={1.3} strokeLinejoin="round" />
          </G>
        )}
        {hasHat && a.hat === 'hat_visor' && (
          <Path d="M17 26.4Q32 36 47 26.4Q32 24.4 17 26.4z" fill={hat} stroke={CONTOUR} strokeWidth={1.3} strokeLinejoin="round" />
        )}
      </G>

      {/* The ring last, so shoulders never cover it. */}
      <Circle cx="32" cy="32" r="30.5" fill="none" stroke={ring ?? shirt} strokeWidth={3} />
    </Svg>
  );
}
