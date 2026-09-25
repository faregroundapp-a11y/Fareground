import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts, mono, radius } from '@/theme';
import { FlagIcon, PlayAdIcon } from './icons';

export type ClaimState =
  | { kind: 'ready' }
  | { kind: 'short'; have: number; need: number }
  | { kind: 'blocked'; reason: string };

/**
 * The one button that matters. When you can claim it breathes - a slow glow
 * that pulls the eye without nagging. When you cannot, it says why, and if the
 * reason is Walk Points it shows how close you are instead of a flat "no".
 */
export function ClaimButton({
  state,
  price,
  busy,
  onPress,
  adOffer,
}: {
  state: ClaimState;
  /** What this claim costs - it rises with the land you already own. */
  price: number;
  busy: boolean;
  onPress: () => void;
  /** When short of WP: a shortcut to earn some by watching an ad. */
  adOffer?: { label: string; busy: boolean; onPress: () => void } | null;
}) {
  const ready = state.kind === 'ready';
  const [glow] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!ready) {
      glow.stopAnimation();
      glow.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ready, glow]);

  if (!ready) {
    return (
      <View style={styles.off}>
        {state.kind === 'short' ? (
          <>
            <View style={styles.offRow}>
              <Text style={styles.offText}>Walk to earn your next parcel</Text>
              <Text style={[styles.offCount, mono]}>{state.have} / {state.need} WP</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.min(100, (state.have / state.need) * 100)}%` }]} />
            </View>
            {adOffer && (
              <Pressable
                onPress={adOffer.onPress}
                disabled={adOffer.busy}
                style={({ pressed }) => [styles.adPill, pressed && { opacity: 0.8 }]}
                accessibilityRole="button"
              >
                {adOffer.busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <PlayAdIcon size={18} />}
                <Text style={styles.adPillText}>{adOffer.label}</Text>
              </Pressable>
            )}
          </>
        ) : (
          <Text style={styles.offText}>{state.reason}</Text>
        )}
      </View>
    );
  }

  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });

  return (
    <View>
      <Animated.View style={[styles.halo, { opacity: glowOpacity, transform: [{ scaleX: glowScale }, { scaleY: glowScale }] }]} />
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Claim this parcel for ${price} Walk Points`}
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
      >
        <View style={styles.sheen} />
        {busy ? (
          <ActivityIndicator color={colors.claimInk} />
        ) : (
          <View style={styles.content}>
            <FlagIcon size={22} color={colors.claimInk} />
            <Text style={styles.label}>Claim land</Text>
            <View style={styles.cost}>
              <Text style={[styles.costText, mono]}>{price} WP</Text>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: 'absolute', left: -4, right: -4, top: -4, bottom: -4,
    borderRadius: radius.lg + 4, backgroundColor: colors.claimHi,
  },
  btn: {
    height: 62, borderRadius: radius.lg, backgroundColor: colors.claim,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    borderBottomWidth: 4, borderBottomColor: colors.claimDeep,
  },
  btnPressed: { transform: [{ translateY: 2 }, { scale: 0.985 }], borderBottomWidth: 2 },
  sheen: {
    position: 'absolute', left: 0, right: 0, top: 0, height: '48%',
    backgroundColor: '#FFFFFF', opacity: 0.18,
  },
  content: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { color: colors.claimInk, fontSize: 19, fontFamily: fonts.black, letterSpacing: 1.4, textTransform: 'uppercase', includeFontPadding: false },
  cost: { backgroundColor: 'rgba(42,26,3,0.14)', borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  costText: { color: colors.claimInk, fontSize: 12, fontFamily: fonts.heavy, includeFontPadding: false },

  off: {
    borderRadius: radius.lg, backgroundColor: colors.glassHi,
    paddingHorizontal: 16, paddingVertical: 14, gap: 10, minHeight: 62, justifyContent: 'center',
  },
  offRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  offText: { color: colors.glassInk, fontSize: 14, fontFamily: fonts.medium, lineHeight: 19, flexShrink: 1 },
  offCount: { color: colors.steps, fontSize: 13, fontFamily: fonts.heavy },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: colors.steps },
  adPill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40,
    borderRadius: radius.md, backgroundColor: colors.boost,
  },
  adPillText: { color: '#FFFFFF', fontFamily: fonts.heavy, fontSize: 14, includeFontPadding: false },
});
