import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { Mineral } from '@/api/types';
import { MINERALS, MINERAL_ORDER, formatRate } from '@/game/minerals';
import { GemIcon } from './icons';
import { fonts } from '@/theme';

/**
 * The claim, as it happens ON THE GLASS - the part you feel.
 *
 * Everything scales with rarity: a Rocky gets a modest pop, a Ruby gets a
 * flash, light rays, a screen shake and a fountain of gems. All animation runs
 * on the native driver, so it stays smooth even while the map redraws.
 */

export const CELEBRATION_MS = 2100;

const INTENSITY: Record<Mineral, { gems: number; shake: number; rays: boolean; flash: number }> = {
  ROCKY:    { gems: 10, shake: 0,  rays: false, flash: 0.35 },
  COAL:     { gems: 14, shake: 0,  rays: false, flash: 0.4 },
  AMETHYST: { gems: 20, shake: 3,  rays: true,  flash: 0.5 },
  SAPPHIRE: { gems: 26, shake: 6,  rays: true,  flash: 0.6 },
  RUBY:     { gems: 36, shake: 10, rays: true,  flash: 0.75 },
};

const TIER_LABEL: Record<Mineral, string> = {
  ROCKY: 'Common find',
  COAL: 'Solid find',
  AMETHYST: 'Rare find!',
  SAPPHIRE: 'Epic find!',
  RUBY: 'LEGENDARY!',
};

/** Deterministic pseudo-random, so a burst does not reshuffle on re-render. */
function seeded(n: number) {
  let s = n * 9301 + 49297;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function Gem({ i, total, color, seed }: { i: number; total: number; color: string; seed: number }) {
  const spec = useMemo(() => {
    const rnd = seeded(seed + i * 17);
    const angle = (i / total) * Math.PI * 2 + rnd() * 0.6;
    const dist = 90 + rnd() * 120;
    return {
      dx: Math.cos(angle) * dist,
      up: -(60 + rnd() * 110),
      fall: 90 + rnd() * 120,
      spin: (rnd() > 0.5 ? 1 : -1) * (180 + rnd() * 360),
      size: 12 + rnd() * 14,
      delay: rnd() * 120,
    };
  }, [i, total, seed]);

  const [p] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(p, {
      toValue: 1,
      duration: 1300,
      delay: spec.delay,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [p, spec.delay]);

  // A throw: out at a steady rate, up then down under "gravity".
  const translateX = p.interpolate({ inputRange: [0, 1], outputRange: [0, spec.dx] });
  const translateY = p.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, spec.up, spec.up + spec.fall],
    easing: Easing.out(Easing.quad),
  });
  const rotate = p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${spec.spin}deg`] });
  const opacity = p.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] });
  const scale = p.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0.3, 1.1, 0.7] });

  return (
    <Animated.View style={[styles.particle, { opacity, transform: [{ translateX }, { translateY }, { rotate }, { scale }] }]}>
      <GemIcon size={spec.size} color={color} />
    </Animated.View>
  );
}

function Rays({ color }: { color: string }) {
  const [spin] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(spin, { toValue: 1, duration: CELEBRATION_MS, easing: Easing.linear, useNativeDriver: true }).start();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '70deg'] });
  const rays = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const a2 = a + 0.13;
    return `M150 150L${150 + Math.cos(a) * 150} ${150 + Math.sin(a) * 150}L${150 + Math.cos(a2) * 150} ${150 + Math.sin(a2) * 150}Z`;
  }).join('');
  return (
    <Animated.View style={[styles.rays, { transform: [{ rotate }] }]}>
      <Svg width={300} height={300} viewBox="0 0 300 300">
        <Path d={rays} fill={color} opacity={0.22} />
      </Svg>
    </Animated.View>
  );
}

export function ClaimCelebration({
  rarity,
  seed,
  onShake,
}: {
  rarity: Mineral;
  seed: number;
  /** Called with the shake strength so the caller can shake the whole screen. */
  onShake?: (strength: number) => void;
}) {
  const m = MINERALS[rarity];
  const fx = INTENSITY[rarity];

  const [flash] = useState(() => new Animated.Value(0));
  const [ring] = useState(() => new Animated.Value(0));
  const [banner] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(flash, { toValue: fx.flash, duration: 90, useNativeDriver: true }),
        Animated.timing(flash, { toValue: 0, duration: 420, useNativeDriver: true }),
      ]),
      Animated.timing(ring, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(160),
        Animated.spring(banner, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }),
      ]),
    ]).start();
    if (fx.shake) onShake?.(fx.shake);
  }, [flash, ring, banner, fx.flash, fx.shake, onShake]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [0.2, 4.2] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
  const bannerScale = banner.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  const tierIndex = MINERAL_ORDER.indexOf(rarity);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: tierIndex >= 3 ? m.color : '#FFFFFF', opacity: flash }]} />

      <View style={styles.centre}>
        {fx.rays && <Rays color={m.color} />}
        <Animated.View style={[styles.ring, { borderColor: m.color, opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
        {Array.from({ length: fx.gems }, (_, i) => (
          <Gem key={i} i={i} total={fx.gems} color={m.color} seed={seed} />
        ))}
      </View>

      <Animated.View style={[styles.banner, { opacity: banner, transform: [{ scale: bannerScale }] }]}>
        <GemIcon size={44} color={m.color} />
        <View>
          <Text style={[styles.tier, { color: m.color }]}>{TIER_LABEL[rarity]}</Text>
          <Text style={styles.name}>{m.label}</Text>
          <Text style={styles.rate}>+{formatRate(m.coinsPerMonth)} coins / month</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  particle: { position: 'absolute' },
  ring: { position: 'absolute', width: 80, height: 80, borderRadius: 40, borderWidth: 4 },
  rays: { position: 'absolute', width: 300, height: 300 },
  banner: {
    position: 'absolute', top: '22%', alignSelf: 'center',
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(16,22,30,0.86)', borderRadius: 18,
    paddingVertical: 12, paddingLeft: 14, paddingRight: 22,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  tier: { fontSize: 11, fontFamily: fonts.heavy, letterSpacing: 1.4, textTransform: 'uppercase' },
  name: { fontSize: 28, fontFamily: fonts.black, color: '#FFFFFF', letterSpacing: -0.5, lineHeight: 32 },
  rate: { fontSize: 13, color: 'rgba(255,255,255,0.7)', fontFamily: fonts.medium },
});
