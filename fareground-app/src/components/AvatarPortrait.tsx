import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
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
 */

/** Same dark edge the Runner uses. Keep them identical. */
const CONTOUR = '#14201A';

/** Head geometry, in the 64x64 viewBox. */
const CX = 32;
const CY = 30;
const R = 19;

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
  const gid = `portraitFace${size}`;

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        {/* The same soft top-light the runner's head has, so a big round
            shape is not a flat disc. */}
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.22} />
          <Stop offset="0.6" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>

      {/* background + ring */}
      <Circle cx="32" cy="32" r="32" fill={shirt} opacity={0.18} />
      <Circle cx="32" cy="32" r="30.5" fill="none" stroke={ring ?? shirt} strokeWidth={3} />

      <G>
        {/* Shoulders: a suggestion at the bottom, mostly behind the head. */}
        <Path d="M13 64c2.2-9 9-14 19-14s16.8 5 19 14z" fill={CONTOUR} />
        <Path d="M15 64c2-7.6 8-12 17-12s15 4.4 17 12z" fill={shirt} />
        {a.face === 'face_medal' && <Circle cx="32" cy="58" r="3.6" fill={extra} stroke="#B98A1C" strokeWidth={1} />}
        {a.face === 'face_scarf' && <Path d="M21 52c3.4 3.2 17.6 3.2 22 0v5c-4 3.4-18 3.4-22 0z" fill={extra} />}

        {/* Head. No neck: a chibi head sits straight on the shoulders. */}
        <Circle cx={CX} cy={CY} r={R + 1.4} fill={CONTOUR} />
        <Circle cx={CX} cy={CY} r={R} fill={skin} />
        <Circle cx={CX} cy={CY} r={R} fill={`url(#${gid})`} />

        {/* ---- hair, under the hat ---- */}
        {a.hair === 'hair_short' || a.hair === 'hair_ginger' || a.hair === 'hair_silver' ? (
          <Path d={`M${CX - R} ${CY}a${R} ${R} 0 01${R * 2} 0q-8-6-19-6t-19 6z`} fill={hair} />
        ) : null}
        {a.hair === 'hair_curls' && (
          <G fill={hair}>
            <Circle cx="19" cy="20" r="7.5" />
            <Circle cx="32" cy="14.5" r="8.5" />
            <Circle cx="45" cy="20" r="7.5" />
          </G>
        )}
        {a.hair === 'hair_long' && (
          <G fill={hair}>
            <Path d={`M${CX - R} ${CY}a${R} ${R} 0 01${R * 2} 0q-8-6-19-6t-19 6z`} />
            <Path d="M12.4 28c-1.2 12 0 19 1.2 25h6.4c-2.6-8.6-2.6-17-1.2-25zM51.6 28c1.2 12 0 19-1.2 25h-6.4c2.6-8.6 2.6-17 1.2-25z" />
          </G>
        )}
        {a.hair === 'hair_bun' && (
          <G fill={hair}>
            <Path d={`M${CX - R} ${CY}a${R} ${R} 0 01${R * 2} 0q-8-6-19-6t-19 6z`} />
            {/* Pulled in from the frame edge: the taller head pushed the
                bun to y=0.5, where the viewBox clipped a flat line off it. */}
            <Circle cx="32" cy="9.5" r="6" />
          </G>
        )}
        {/* Tapered, not a rectangle. A straight bar on a big round head
            read as an antenna rather than hair. */}
        {a.hair === 'hair_punk' && <Path d="M32 4l5 8v14h-10V12z" fill={hair} />}

        {/* ---- face: the runner's eyes, at the runner's spacing ---- */}
        {a.face === 'face_shades' ? (
          <Rect x="19" y="26" width="26" height="8.5" rx="3.8" fill={extra} />
        ) : a.face === 'face_glasses' ? (
          <G stroke={extra} strokeWidth={2} fill="none">
            <Circle cx="25" cy="30" r="5.6" />
            <Circle cx="39" cy="30" r="5.6" />
            <Path d="M30.6 30h2.8" />
          </G>
        ) : (
          <G fill="#1B2330">
            <Circle cx="25.4" cy="30" r="2.6" />
            <Circle cx="38.6" cy="30" r="2.6" />
          </G>
        )}
        {a.face === 'face_beard' && (
          <Path d="M15 33c1.4 10 8 15 17 15s15.6-5 17-15c-5 6-11 7.6-17 7.6S20 39 15 33z" fill={extra} />
        )}
        <Path d="M27.6 38.4q4.4 4 8.8 0" stroke="#1B2330" strokeWidth={2} strokeLinecap="round" fill="none" />

        {/* ---- hat, on top of everything ---- */}
        {hasHat && a.hat === 'hat_crown' && (
          <Path
            d="M13 17l6.5 5L27 11l5 7 5-7 7.5 11L51 17l2.5 10H10.5z"
            fill={hat}
            stroke={CONTOUR}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        )}
        {hasHat && (a.hat === 'hat_cap' || a.hat === 'hat_miner') && (
          <G>
            <Path
              d={`M${CX - R} ${CY - 2}a${R} ${R} 0 01${R * 2} 0z`}
              fill={hat}
              stroke={CONTOUR}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
            {/* Brim: SHORT. A scaled-up brim reads as a beak - the runner
                made exactly this mistake before it was measured. */}
            <Rect x={CX + R - 3} y={CY - 6} width="11" height="5" rx="2.5" fill={CONTOUR} />
            <Rect x={CX + R - 3} y={CY - 5.4} width="10" height="3.6" rx="1.8" fill={hat} />
            {a.hat === 'hat_miner' && (
              <G>
                <Circle cx="32" cy="14" r="4" fill={CONTOUR} />
                <Circle cx="32" cy="14" r="3" fill="#FFF3CC" />
              </G>
            )}
          </G>
        )}
        {hasHat && a.hat === 'hat_beanie' && (
          <G>
            <Path
              d={`M${CX - R} ${CY - 1}a${R} ${R} 0 01${R * 2} 0z`}
              fill={hat}
              stroke={CONTOUR}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
            <Rect x={CX - R - 1} y={CY - 5} width={R * 2 + 2} height="6" rx="3" fill={hat} opacity={0.75} />
          </G>
        )}
        {hasHat && a.hat === 'hat_band' && (
          <Rect x={CX - R - 0.5} y={CY - 6} width={R * 2 + 1} height="5.5" rx="2.6" fill={hat} />
        )}
        {hasHat && a.hat === 'hat_bucket' && (
          <G>
            <Path
              d={`M${CX - R + 3} ${CY - 2}a${R - 3} ${R - 3} 0 01${(R - 3) * 2} 0z`}
              fill={hat}
              stroke={CONTOUR}
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
            <Ellipse cx="32" cy={CY - 2} rx="24" ry="4.6" fill={CONTOUR} />
            <Ellipse cx="32" cy={CY - 2.4} rx="23" ry="3.8" fill={hat} />
          </G>
        )}
        {hasHat && a.hat === 'hat_visor' && (
          <G>
            <Rect x={CX - R - 0.5} y={CY - 6.5} width={R * 2 + 1} height="4.4" rx="2.2" fill={hat} opacity={0.85} />
            <Path d="M7 24c7.5-3.6 41.5-3.6 50 0-7.5 3.6-42.5 3.6-50 0z" fill={hat} />
          </G>
        )}
      </G>
    </Svg>
  );
}
