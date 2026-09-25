import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import type { BadgeIconName, BadgeTier } from '@/api/types';
import { BoltIcon, ChestIcon, CrownIcon, FlagIcon, GemIcon, PinIcon, StepsIcon, TrophyIcon } from './icons';

/** The metal of each tier: [light, dark] for the rim gradient. */
export const TIER_COLORS: Record<BadgeTier, [string, string]> = {
  BRONZE: ['#E3A06A', '#9C5B2E'],
  SILVER: ['#E6EAEE', '#8D98A3'],
  GOLD: ['#FFD978', '#C98A1C'],
  DIAMOND: ['#B9F0FF', '#4FA3D9'],
};

export const TIER_LABEL: Record<BadgeTier, string> = {
  BRONZE: 'Bronze',
  SILVER: 'Silver',
  GOLD: 'Gold',
  DIAMOND: 'Diamond',
};

function Glyph({ icon, color, size }: { icon: BadgeIconName; color?: string; size: number }) {
  switch (icon) {
    case 'steps': return <StepsIcon size={size} color="#2F8F6A" />;
    case 'flag': return <FlagIcon size={size} color="#8C4F14" />;
    case 'gem': return <GemIcon size={size} color={color ?? '#7E56A6'} />;
    case 'chest': return <ChestIcon size={size} />;
    case 'pin': return <PinIcon size={size} color="#2F5D50" />;
    case 'trophy': return <TrophyIcon size={size} color="#D98E2E" />;
    case 'bolt': return <BoltIcon size={size} />;
    case 'crown': return <CrownIcon size={size} color="#D98E2E" />;
  }
}

/**
 * A badge as a medal: a metal rim in its tier's colour around its icon.
 * Locked badges are greyed out, so the collection reads at a glance.
 */
export function BadgeMedal({
  tier, icon, color, size = 64, locked = false,
}: { tier: BadgeTier; icon: BadgeIconName; color?: string; size?: number; locked?: boolean }) {
  const [light, dark] = locked ? ['#DADDD6', '#A9AEA4'] : TIER_COLORS[tier];
  const id = `medal-${tier}-${locked ? 'l' : 'u'}`;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity: locked ? 0.55 : 1 }}>
      <Svg width={size} height={size} viewBox="0 0 64 64" style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={light} />
            <Stop offset="1" stopColor={dark} />
          </LinearGradient>
        </Defs>
        {/* scalloped rim */}
        <Path
          d="M32 2l5 4.6 6.7-.9 2.6 6.2 6.2 2.6-.9 6.7L56.2 26 54 32l2.2 6-4.6 4.8.9 6.7-6.2 2.6-2.6 6.2-6.7-.9L32 62l-5-4.6-6.7.9-2.6-6.2-6.2-2.6.9-6.7L7.8 38 10 32l-2.2-6 4.6-4.8-.9-6.7 6.2-2.6 2.6-6.2 6.7.9z"
          fill={`url(#${id})`}
        />
        <Circle cx="32" cy="32" r="21" fill="#FFFFFF" opacity={locked ? 0.7 : 0.92} />
        <Circle cx="32" cy="32" r="21" fill="none" stroke={dark} strokeWidth={1.5} opacity={0.6} />
      </Svg>
      <Glyph icon={icon} color={locked ? '#A9AEA4' : color} size={size * 0.42} />
    </View>
  );
}
