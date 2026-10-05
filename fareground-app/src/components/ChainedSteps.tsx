import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { adsAvailable } from '@/native/ads';
import { colors, fonts, mono, radius, space, type } from '@/theme';
import { Button } from './Button';
import { CountUp } from './CountUp';
import { PlayAdIcon } from './icons';

/**
 * CHAINED STEPS (2026-10-05).
 *
 * Walk Points from steps wait here, in chains, until the player watches an
 * ad; each ad breaks the chains on 1,000 steps. Nothing chained is ever lost.
 *
 * The look: a steel vault panel with two chains wrapped round it and a
 * padlock hanging off the lower one. Every few seconds the chains give a
 * small rattle. When an ad pays, the padlock pops and spins away, every link
 * flies apart under "gravity", "+10 WP" floats up - and if steps are still
 * chained, the links fly back in and lock again.
 */

/** Links per chain - more than the widest card needs; the panel clips the rest. */
const LINKS = 22;
const LINK_W = 24;
/** How much neighbouring links overlap, so the chain reads as interlocked. */
const LINK_OVERLAP = 7;

/** A fixed, scattered direction for each link to fly in - no Math.random in render. */
function scatter(i: number, row: number) {
  const a = Math.sin(i * 12.9898 + row * 78.233) * 43758.5453;
  const r = a - Math.floor(a); // 0..1
  return {
    x: (i - LINKS / 2) * 9 + (r - 0.5) * 70,
    up: 18 + r * 40,
    fall: 110 + r * 90,
    spin: (r - 0.5) * 540,
  };
}

function Chain({ row, brk, rattle }: { row: number; brk: Animated.Value; rattle: Animated.Value }) {
  return (
    <Animated.View
      style={[
        styles.chain,
        row === 0 ? styles.chainTop : styles.chainBottom,
        { transform: [{ rotate: row === 0 ? '-4deg' : '3deg' }, { translateX: rattle.interpolate({ inputRange: [-1, 1], outputRange: [row ? 3 : -3, row ? -3 : 3] }) }] },
      ]}
      pointerEvents="none"
    >
      {Array.from({ length: LINKS }, (_, i) => {
        const s = scatter(i, row);
        const flat = i % 2 === 1; // side-on links between the round ones
        return (
          <Animated.View
            key={i}
            style={[
              flat ? styles.linkFlat : styles.linkRound,
              {
                opacity: brk.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 1, 0] }),
                transform: [
                  { translateX: brk.interpolate({ inputRange: [0, 1], outputRange: [0, s.x] }) },
                  // Up a little, then down hard: a cheap parabola.
                  { translateY: brk.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, -s.up, s.fall] }) },
                  { rotate: brk.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${s.spin}deg`] }) },
                ],
              },
            ]}
          />
        );
      })}
    </Animated.View>
  );
}

/** A brass padlock: shackle, body, keyhole. */
function Padlock({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.15} viewBox="0 0 40 46">
      <Defs>
        <LinearGradient id="brass" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.claimHi} />
          <Stop offset="1" stopColor={colors.claimDeep} />
        </LinearGradient>
      </Defs>
      <Path d="M11 20V13a9 9 0 0118 0v7" stroke="#B9C0C8" strokeWidth={5} fill="none" strokeLinecap="round" />
      <Rect x={4} y={18} width={32} height={26} rx={7} fill="url(#brass)" stroke={colors.claimInk} strokeOpacity={0.35} strokeWidth={1.5} />
      <Rect x={7} y={21} width={26} height={4} rx={2} fill="#FFFFFF" opacity={0.28} />
      <Circle cx={20} cy={30} r={3.6} fill={colors.claimInk} />
      <Path d="M18.6 31.5h2.8l1 6h-4.8z" fill={colors.claimInk} />
    </Svg>
  );
}

export function ChainedSteps({
  lockedWp,
  stepsPerWp,
  stepsPerUnlockAd,
  onUnlocked,
}: {
  lockedWp: number;
  stepsPerWp: number;
  stepsPerUnlockAd: number;
  onUnlocked: () => void;
}) {
  const [brk] = useState(() => new Animated.Value(0));
  const [rattle] = useState(() => new Animated.Value(0));
  const [float] = useState(() => new Animated.Value(0));
  const [gained, setGained] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  /** Just broke the last chain: say so for a moment before the card goes. */
  const [freed, setFreed] = useState(false);
  const { watch, busy } = useRewardedAd(onUnlocked);

  const lockedSteps = lockedWp * stepsPerWp;
  const wpPerAd = Math.max(1, Math.round(stepsPerUnlockAd / stepsPerWp));
  const nextBreak = Math.min(lockedWp, wpPerAd);

  // The idle rattle: a quick shake every few seconds, so the chains feel heavy and real.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(3200),
        ...[1, -1, 0.6, -0.6, 0].map((v) =>
          Animated.timing(rattle, { toValue: v, duration: 70, easing: Easing.linear, useNativeDriver: true }),
        ),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [rattle]);

  async function unlock() {
    setNote(null);
    const r = await watch('UNLOCK_STEPS');
    if (!r.ok) {
      setNote(r.message);
      return;
    }
    const remaining = Math.max(0, lockedWp - r.amount);
    setGained(r.amount);
    float.setValue(0);
    Animated.parallel([
      Animated.timing(brk, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(float, { toValue: 1, duration: 1400, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      if (remaining > 0) {
        // More still chained: the links fly back in and lock again.
        Animated.timing(brk, { toValue: 0, duration: 520, delay: 250, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start();
      } else {
        setFreed(true);
        setTimeout(() => {
          setFreed(false);
          brk.setValue(0);
        }, 2600);
      }
    });
  }

  if (lockedWp <= 0 && !freed) return null;

  return (
    <View style={styles.card}>
      <View style={styles.vault}>
        <Chain row={0} brk={brk} rattle={rattle} />
        <View style={styles.center} pointerEvents="none">
          {/* The label steps aside while "+10 WP" floats through it. */}
          <Animated.Text style={[styles.vaultLabel, { opacity: freed ? 1 : brk.interpolate({ inputRange: [0, 0.15, 1], outputRange: [1, 0, 0] }) }]}>
            {freed ? 'ALL STEPS FREE' : 'STEPS IN CHAINS'}
          </Animated.Text>
          <CountUp value={freed ? 0 : lockedSteps} style={[styles.vaultSteps, mono]} />
        </View>
        <Chain row={1} brk={brk} rattle={rattle} />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.lock,
            {
              opacity: brk.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateY: brk.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, -22, 120] }) },
                { rotate: brk.interpolate({ inputRange: [0, 0.25, 1], outputRange: ['0deg', '-18deg', '200deg'] }) },
                { scale: brk.interpolate({ inputRange: [0, 0.2, 1], outputRange: [1, 1.25, 0.9] }) },
                { rotate: rattle.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] }) },
              ],
            },
          ]}
        >
          <Padlock />
        </Animated.View>
        {gained > 0 && (
          <Animated.Text
            pointerEvents="none"
            style={[
              styles.gain,
              {
                opacity: float.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [10, -46] }) },
                  { scale: float.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.6, 1.15, 1] }) },
                ],
              },
            ]}
          >
            +{gained} WP
          </Animated.Text>
        )}
      </View>

      <Text style={[type.caption, styles.explain]}>
        {freed
          ? 'Every step is unlocked. New steps go into chains until you watch an ad.'
          : `Your steps are safe and never expire. Each ad breaks the chains on ${stepsPerUnlockAd.toLocaleString()} steps.`}
      </Text>
      {!freed &&
        (adsAvailable() ? (
          <Button
            variant="boost"
            label={busy === 'UNLOCK_STEPS' ? 'Loading ad…' : `Break the chains · +${nextBreak} WP`}
            icon={<PlayAdIcon size={18} />}
            onPress={() => void unlock()}
            busy={busy === 'UNLOCK_STEPS'}
            disabled={busy !== null}
          />
        ) : (
          <Text style={styles.note}>{"Ads aren't available in this version of the app."}</Text>
        ))}
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

const IRON = '#A3ACB6';
const IRON_DARK = '#5F6873';

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, gap: space.md,
    borderWidth: 1, borderColor: colors.line,
  },
  // Steel in both themes, like the map HUD: the chains need a dark ground to read.
  vault: {
    height: 128, borderRadius: radius.md, backgroundColor: '#1B2229', overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#2E3842',
  },
  center: { alignItems: 'center' },
  vaultLabel: { fontFamily: fonts.heavy, fontSize: 11, letterSpacing: 1.6, color: 'rgba(255,255,255,0.6)', includeFontPadding: false },
  vaultSteps: { fontFamily: fonts.black, fontSize: 34, letterSpacing: -1, color: '#FFFFFF', includeFontPadding: false, marginTop: 2 },
  chain: {
    position: 'absolute', left: -20, right: -20, height: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  chainTop: { top: 12 },
  chainBottom: { bottom: 16 },
  linkRound: {
    width: LINK_W, height: 14, borderRadius: 7, borderWidth: 3.5, borderColor: IRON,
    marginHorizontal: -LINK_OVERLAP / 2,
  },
  linkFlat: {
    width: LINK_W, height: 5, borderRadius: 3, backgroundColor: IRON_DARK,
    borderTopWidth: 1.5, borderTopColor: IRON, marginHorizontal: -LINK_OVERLAP / 2, zIndex: 1,
  },
  lock: { position: 'absolute', bottom: 0, right: '18%' },
  gain: {
    position: 'absolute', top: 40, fontFamily: fonts.black, fontSize: 24, color: colors.claimHi,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6, includeFontPadding: false,
  },
  explain: { textAlign: 'center' },
  note: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink2, textAlign: 'center' },
});
