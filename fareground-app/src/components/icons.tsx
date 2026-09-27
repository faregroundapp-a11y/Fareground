import type { ColorValue } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect } from 'react-native-svg';

/**
 * Fareground's icon set. Drawn here rather than pulled from an icon font so
 * they share one visual language - rounded 1.8 px strokes on a 24 grid - and
 * so the game objects (coin, gem) can be properly coloured and faceted.
 */

type IconProps = { size?: number; color?: ColorValue };

/** A gold coin with a raised rim and a shine. */
export function CoinIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="10.5" fill="#C98A1C" />
      <Circle cx="12" cy="11.2" r="10" fill="#F2B53B" />
      <Circle cx="12" cy="11.2" r="7.2" fill="#E29E24" />
      <Circle cx="12" cy="11.2" r="7.2" fill="none" stroke="#FFD774" strokeWidth={1.1} opacity={0.8} />
      {/* embossed footprint - the currency of walking */}
      <Path d="M10.2 13.6c-.9 0-1.4-.9-1.4-2.3s.6-3 1.6-3 1.3 1.3 1.2 2.6c-.1 1.5-.5 2.7-1.4 2.7z" fill="#FFE39A" />
      <Path d="M13.9 15.3c-.9 0-1.3-.8-1.2-2.1.1-1.3.7-2.6 1.6-2.6s1.2 1.1 1.1 2.3c-.2 1.4-.6 2.4-1.5 2.4z" fill="#FFE39A" />
      <Path d="M5.6 7.4a7.6 7.6 0 013.6-3" stroke="#FFF3CC" strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.9} />
    </Svg>
  );
}

/** Walk Points: two footprints mid-stride. */
export function StepsIcon({ size = 20, color = '#5CC7A0' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M8.1 14.2c-1.8 0-2.8-1.7-2.8-4.4S6.5 3.9 8.4 3.9s2.6 2.5 2.4 5c-.2 2.9-.9 5.3-2.7 5.3z" fill={color} />
      <Rect x="5.6" y="15.3" width="4.6" height="3.1" rx="1.55" fill={color} />
      <Path d="M15.8 17.6c-1.7 0-2.5-1.6-2.3-4.1.2-2.5 1.3-5 3.1-5s2.4 2.2 2.1 4.5c-.3 2.7-1.1 4.6-2.9 4.6z" fill={color} opacity={0.72} />
      <Rect x="13.4" y="18.6" width="4.4" height="3" rx="1.5" fill={color} opacity={0.72} />
    </Svg>
  );
}

/** Lighten or darken a #RRGGBB colour. */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** A faceted gem in any mineral colour - the icon for a parcel's contents. */
export function GemIcon({ size = 24, color = '#7E56A6' }: { size?: number; color?: string }) {
  const light = tint(color, 0.45), lighter = tint(color, 0.7), dark = tint(color, -0.35);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* pavilion (bottom) */}
      <Polygon points="2.5,8.5 21.5,8.5 12,21.5" fill={color} />
      <Polygon points="12,8.5 21.5,8.5 12,21.5" fill={dark} />
      <Polygon points="7.5,8.5 12,8.5 12,21.5" fill={light} opacity={0.55} />
      {/* crown (top) */}
      <Polygon points="6.5,3.5 17.5,3.5 21.5,8.5 2.5,8.5" fill={light} />
      <Polygon points="9.5,3.5 14.5,3.5 12,8.5" fill={lighter} />
      <Polygon points="6.5,3.5 9.5,3.5 7.5,8.5 2.5,8.5" fill={lighter} opacity={0.7} />
      <Polygon points="14.5,3.5 17.5,3.5 21.5,8.5 16.5,8.5" fill={color} opacity={0.9} />
      <Path d="M2.5 8.5h19" stroke={dark} strokeWidth={0.6} opacity={0.5} />
      <Circle cx="8.2" cy="5.6" r="0.9" fill="#FFFFFF" opacity={0.9} />
    </Svg>
  );
}

/** A flag planted in a square - used for claiming. */
export function FlagIcon({ size = 22, color = '#2A1A03' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M6 21V3.8" stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Path d="M6 4.2c3.6-1.8 6.4 1.9 11.3.1V12c-4.9 1.8-7.7-1.9-11.3-.1" fill={color} />
      <Ellipse cx="6" cy="21" rx="3.4" ry="1.1" fill={color} opacity={0.35} />
    </Svg>
  );
}

/** Compass rose. The needle is rotated by the caller to show heading. */
export function CompassIcon({ size = 26, rotation = 0 }: { size?: number; rotation?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Circle cx="13" cy="13" r="11" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={1.2} />
      <G rotation={rotation} origin="13, 13">
        <Path d="M13 3.2L16.6 13H9.4z" fill="#FF6B5E" />
        <Path d="M13 22.8L9.4 13h7.2z" fill="#F4F6F2" opacity={0.85} />
      </G>
      <Circle cx="13" cy="13" r="1.8" fill="#F4F6F2" />
    </Svg>
  );
}

/**
 * A two-way street sign on a post - the map-labels toggle. Struck through
 * when labels are hidden, so the button always says what state the map is in.
 */
export function StreetSignIcon({ size = 26, off = false }: { size?: number; off?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 26 26">
      <Rect x="12" y="4" width="2" height="19" rx="1" fill="#C9D2CC" />
      {/* upper board points right, lower board points left */}
      <Path d="M5 6.5h13.2l2.8 2.6-2.8 2.6H5z" fill="#2F9E6E" stroke="#F4F6F2" strokeWidth={1} strokeLinejoin="round" />
      <Path d="M21 13.5H7.8L5 16.1l2.8 2.6H21z" fill="#2F9E6E" stroke="#F4F6F2" strokeWidth={1} strokeLinejoin="round" />
      {off && <Line x1="4" y1="22" x2="22" y2="4" stroke="#FF6B5E" strokeWidth={2.4} strokeLinecap="round" />}
    </Svg>
  );
}

/** The treasure finder's pointer: an arrow that turns toward the nearest box. */
export function PointerIcon({ size = 22, rotation = 0, color = '#FFD37A' }: { size?: number; rotation?: number; color?: ColorValue }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <G rotation={rotation} origin="12, 12">
        <Path d="M12 2.5l6.5 17.2L12 16.2l-6.5 3.5z" fill={color} stroke="#2A1A03" strokeWidth={1.2} strokeLinejoin="round" />
      </G>
    </Svg>
  );
}

/** A cog, for Settings. Same 1.8 px rounded stroke as the tab icons. */
export function GearIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
      <Path d="M10.3 3.2h3.4l.5 2.3 1.6.9 2.2-.8 1.7 2.9-1.7 1.6v1.8l1.7 1.6-1.7 2.9-2.2-.8-1.6.9-.5 2.3h-3.4l-.5-2.3-1.6-.9-2.2.8-1.7-2.9 1.7-1.6v-1.8L4.3 8.5 6 5.6l2.2.8 1.6-.9z" />
      <Circle cx="12" cy="12" r="2.8" />
    </Svg>
  );
}

/* ---------- tab bar ---------- */

export function MapTabIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
      <Path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0113 0c0 5.3-6.5 11-6.5 11z" />
      <Circle cx="12" cy="10" r="2.4" />
    </Svg>
  );
}

export function WalkTabIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
      {/* a running shoe */}
      <Path d="M3 16.5h15.2c1.9 0 3.3-1.2 3.3-2.6 0-1-.8-1.6-2-1.9l-4.6-1.1-3.1-4.4H8.6L7.4 9H4.2L3 16.5z" />
      <Path d="M3 19.5h18" />
      <Line x1="10.2" y1="9.4" x2="11.6" y2="8.2" />
      <Line x1="12" y1="11" x2="13.4" y2="9.8" />
    </Svg>
  );
}

export function LandTabIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
      {/* a plot of ground, seen at an angle, with a flag on it */}
      <Path d="M2.5 15.5L12 11l9.5 4.5L12 20z" />
      <Path d="M12 15.8V4" />
      <Path d="M12 4.3c2-.9 3.6 1 6.2 0v4.2c-2.6 1-4.2-.9-6.2 0" fill={color} />
    </Svg>
  );
}

/* ---------- boosts, ads, accounts ---------- */

/** A lightning bolt: the boost. */
export function BoltIcon({ size = 20, color = '#8A5CF6' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M13.6 2.5L4.8 13.6h6.1l-1.3 7.9 8.8-11.1h-6.1z" fill={color} strokeLinejoin="round" />
      <Path d="M13.6 2.5L10.9 10.4" stroke="#FFFFFF" strokeWidth={1.1} strokeLinecap="round" opacity={0.45} />
    </Svg>
  );
}

/** A play button in a rounded square: "watch an ad". */
export function PlayAdIcon({ size = 20, color = '#FFFFFF' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="5" width="18" height="14" rx="3.5" stroke={color} strokeWidth={1.8} />
      <Path d="M10.2 9.2v5.6l4.8-2.8z" fill={color} />
    </Svg>
  );
}

/** Heart-rate line, for Health Connect. */
export function PulseIcon({ size = 20, color = '#2F5D50' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 12.5h4l2-5 3.2 10 2.4-6.5 1.4 1.5H21" />
    </Svg>
  );
}

/** Google's "G", in its own colours (required by Google's branding rules). */
export function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <Path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <Path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </Svg>
  );
}

/** A treasure chest: the daily reward. */
export function ChestIcon({ size = 22, open = false }: { size?: number; open?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {open ? (
        <Path d="M4 9.5L6 4.5h12l2 5z" fill="#A8621C" />
      ) : (
        <Path d="M3.5 10.5V9a5 5 0 015-5h7a5 5 0 015 5v1.5z" fill="#C47A26" />
      )}
      <Rect x="3.5" y="10" width="17" height="10" rx="2" fill="#D98E2E" />
      <Rect x="3.5" y="10" width="17" height="2.4" fill="#A8621C" />
      <Rect x="10" y="9" width="4" height="5.4" rx="1" fill="#FFD27A" stroke="#8C4F14" strokeWidth={0.8} />
      {open && <Circle cx="12" cy="7" r="2.4" fill="#FFE39A" opacity={0.9} />}
    </Svg>
  );
}

/** A tick in a circle: done. */
export function CheckIcon({ size = 18, color = '#1F7A4D' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="10" fill={color} />
      <Path d="M7.5 12.3l3 3 6-6.3" stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** A trophy cup: leaderboards. */
export function TrophyIcon({ size = 24, color = '#F2A93B' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M7 4h10v4.5a5 5 0 01-10 0z" fill={color} />
      <Path d="M7 5.5H4.2a.7.7 0 00-.7.8C3.8 9 5.4 10.6 7.4 10.9M17 5.5h2.8a.7.7 0 01.7.8c-.3 2.7-1.9 4.3-3.9 4.6" stroke={color} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Rect x="10.8" y="13" width="2.4" height="4" fill={color} />
      <Rect x="7.5" y="17" width="9" height="3" rx="1" fill={color} />
      <Path d="M9.3 5.8v2.6a2.7 2.7 0 001.5 2.4" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.55} fill="none" />
    </Svg>
  );
}

/** A map pin: visits and places. */
export function PinIcon({ size = 22, color = '#2F5D50' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 22s-7-6.2-7-12a7 7 0 0114 0c0 5.8-7 12-7 12z" fill={color} />
      <Circle cx="12" cy="10" r="2.8" fill="#FFFFFF" />
    </Svg>
  );
}

/** A crown: the very top. */
export function CrownIcon({ size = 22, color = '#F2A93B' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M3.5 8l4.3 3.6L12 5l4.2 6.6L20.5 8l-1.8 10H5.3z" fill={color} strokeLinejoin="round" />
      <Rect x="5.3" y="18.4" width="13.4" height="2" rx="1" fill={color} />
    </Svg>
  );
}

export function RanksTabIcon({ size = 24, color = '#000' }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round">
      {/* a podium */}
      <Path d="M9 20V9h6v11M3 20v-7h6M15 20v-5h6v5M2 20h20" />
      <Path d="M12 3.2l.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" fill={color} strokeWidth={1} />
    </Svg>
  );
}

/**
 * Discord's mark, simplified to read at tile size: the rounded "controller"
 * head with two eyes. Drawn white, to sit on Discord's blurple tile.
 */
export function DiscordIcon({ size = 24, color = '#FFFFFF', eyes = '#5865F2' }: IconProps & { eyes?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M5.2 6.3c1.7-1.2 3.4-1.8 4.8-2l.5 1.1c1-.2 2-.2 3 0l.5-1.1c1.4.2 3.1.8 4.8 2 1.9 2.9 2.7 6 2.4 9.5-1.8 1.4-3.6 2.2-5.3 2.6l-1.1-1.8c.7-.3 1.3-.6 1.9-1l-.5-.4c-3.3 1.5-7 1.5-10.3 0l-.5.4c.6.4 1.2.7 1.9 1l-1.1 1.8c-1.7-.4-3.5-1.2-5.3-2.6-.3-3.5.5-6.6 2.3-9.5z"
        fill={color}
      />
      <Ellipse cx="9" cy="12.4" rx="1.5" ry="1.7" fill={eyes} />
      <Ellipse cx="15" cy="12.4" rx="1.5" ry="1.7" fill={eyes} />
    </Svg>
  );
}

/** Reddit's Snoo, simplified: head, ears, antenna and a smile. White on orange. */
export function RedditIcon({ size = 24, color = '#FFFFFF', face = '#FF4500' }: IconProps & { face?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M12 9.2l1.2-5 4 .9" stroke={color} strokeWidth={1.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx="18.2" cy="5.2" r="1.7" fill={color} />
      <Circle cx="4.6" cy="11.8" r="2" fill={color} />
      <Circle cx="19.4" cy="11.8" r="2" fill={color} />
      <Ellipse cx="12" cy="14.6" rx="8.2" ry="5.6" fill={color} />
      <Circle cx="9" cy="13.8" r="1.3" fill={face} />
      <Circle cx="15" cy="13.8" r="1.3" fill={face} />
      <Path d="M9.2 16.8c1.7 1.1 3.9 1.1 5.6 0" stroke={face} strokeWidth={1.2} fill="none" strokeLinecap="round" />
    </Svg>
  );
}
