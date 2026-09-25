import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';

/**
 * The Fareground mark: an amber map pin with a ruby in its head, planted on
 * a glowing parcel of isometric grid. Same shapes as scripts/logo.py, which
 * renders the app icons - change both together.
 */

const PIN = 'M512 712 C 468 632 336 530 336 404 A 176 176 0 1 1 688 404 C 688 530 556 632 512 712 Z';
const GRID: [number, number, number, number][] = [
  [612, 600, 312, 750], [412, 600, 712, 750],
  [712, 650, 412, 800], [312, 650, 612, 800],
];

function Mark() {
  return (
    <G>
      <Polygon points="212,700 512,850 512,894 212,744" fill="#1E4638" />
      <Polygon points="512,850 812,700 812,744 512,894" fill="#173A2E" />
      <Polygon points="512,550 812,700 512,850 212,700" fill="url(#lgTile)" />
      {GRID.map(([x1, y1, x2, y2]) => (
        <Line key={`${x1}${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#FFFFFF" strokeOpacity={0.22} strokeWidth={6} strokeLinecap="round" />
      ))}
      <Polygon points="512,650 612,700 512,750 412,700" fill="url(#lgCell)" />
      <Ellipse cx={512} cy={712} rx={64} ry={22} fill="#000" opacity={0.28} />
      <Path d={PIN} fill="url(#lgPin)" />
      <Path
        d="M512 712 C 556 632 688 530 688 404 A 176 176 0 0 0 600 252 C 650 300 660 360 652 420 C 640 520 560 620 512 712 Z"
        fill="#B8741A" opacity={0.35}
      />
      <Path d="M392 330 A 150 150 0 0 1 500 238" stroke="#FFF1CF" strokeWidth={16} strokeLinecap="round" fill="none" opacity={0.7} />
      <Circle cx={512} cy={398} r={118} fill="#FFF6E2" stroke="#E7B25A" strokeWidth={6} />
      <Polygon points="447,352 577,352 612,388 512,478 412,388" fill="#C0304A" />
      <Polygon points="447,352 482,388 412,388" fill="#E4566E" />
      <Polygon points="482,388 542,388 512,352 447,352" fill="#EE7086" />
      <Polygon points="512,352 542,388 577,352" fill="#D8435C" />
      <Polygon points="542,388 612,388 577,352" fill="#A62540" />
      <Polygon points="412,388 482,388 512,478" fill="#D23A55" />
      <Polygon points="482,388 542,388 512,478" fill="#B0283F" />
      <Polygon points="542,388 612,388 512,478" fill="#8C1C31" />
      <Polygon points="462,360 490,360 478,378" fill="#FFFFFF" opacity={0.75} />
    </G>
  );
}

function Gradients() {
  return (
    <Defs>
      <LinearGradient id="lgTile" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#6FB08F" />
        <Stop offset="1" stopColor="#3E7F63" />
      </LinearGradient>
      <LinearGradient id="lgCell" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor="#FFD37A" />
        <Stop offset="1" stopColor="#F2A93B" />
      </LinearGradient>
      <LinearGradient id="lgPin" x1="0" y1="0" x2="0.6" y2="1">
        <Stop offset="0" stopColor="#FFD27A" />
        <Stop offset="0.5" stopColor="#F6AE3E" />
        <Stop offset="1" stopColor="#DC8C1F" />
      </LinearGradient>
      <LinearGradient id="lgBg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor="#43806A" />
        <Stop offset="0.55" stopColor="#2F5D50" />
        <Stop offset="1" stopColor="#143328" />
      </LinearGradient>
      <RadialGradient id="lgShine" cx="0.3" cy="0.22" r="0.7">
        <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.16} />
        <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
      </RadialGradient>
    </Defs>
  );
}

/** Just the mark, on a transparent background. */
export function LogoMark({ size = 64 }: { size?: number }) {
  // Cropped tight to the art (212..812 x 228..894 on the 1024 canvas).
  return (
    <Svg width={size} height={size * (700 / 640)} viewBox="192 210 640 700">
      <Gradients />
      <Mark />
    </Svg>
  );
}

/** The mark on its rounded brand tile - the app icon, drawn live. */
export function AppIcon({ size = 72 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 1024 1024">
      <Gradients />
      <Rect width={1024} height={1024} rx={230} fill="url(#lgBg)" />
      <Rect width={1024} height={1024} rx={230} fill="url(#lgShine)" />
      <G transform="translate(512 512) scale(0.88) translate(-512 -553)">
        <Mark />
      </G>
    </Svg>
  );
}
