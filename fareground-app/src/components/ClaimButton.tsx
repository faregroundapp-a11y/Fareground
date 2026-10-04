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
    // Short of Walk Points: the button, faded, still says what a claim costs
    // - and the ad that earns WP sits right beside it. The card above shows
    // the progress bar, so it is not repeated here (2026-10-03 refresh).
    if (state.kind === 'short') {
      return (
        <View style={styles.shortRow}>
          <View style={[styles.btn, styles.btnOff]} accessibilityLabel={`${state.need - state.have} more Walk Points to claim`}>
            <View style={styles.content}>
              <FlagIcon size={20} color={colors.claimInk} />
              <Text style={[styles.label, styles.labelOff]}>Claim · {price} WP</Text>
            </View>
          </View>
          {adOffer && (
            <Pressable
              onPress={adOffer.onPress}
              disabled={adOffer.busy}
              style={({ pressed }) => [styles.adBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={`Watch an ad for ${adOffer.label}`}
            >
              {adOffer.busy ? <ActivityIndicator color="#FFFFFF" size="small" /> : <PlayAdIcon size={18} />}
              <Text style={styles.adBtnText}>{adOffer.label}</Text>
            </Pressable>
          )}
        </View>
      );
    }
    return (
      <View style={styles.off}>
        <Text style={styles.offText}>{state.reason}</Text>
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
        accessibilityLabel={`Watch an ad and claim this parcel for ${price} Walk Points`}
        style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
      >
        <View style={styles.sheen} />
        {busy ? (
          <ActivityIndicator color={colors.claimInk} />
        ) : (
          <View style={styles.content}>
            <FlagIcon size={22} color={colors.claimInk} />
            <Text style={styles.label}>Claim land</Text>
            {/* An ad plays first - the price of land, alongside the WP. */}
            <View style={[styles.cost, styles.costRow]}>
              <PlayAdIcon size={13} color={colors.claimInk} />
              <Text style={[styles.costText, mono]}>{price} WP</Text>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
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

  shortRow: { flexDirection: 'row', gap: 8 },
  btnOff: { flex: 1, height: 56, opacity: 0.5, borderBottomWidth: 3 },
  labelOff: { fontSize: 16, letterSpacing: 0.4, textTransform: 'none' },
  adBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 56, paddingHorizontal: 16,
    borderRadius: radius.lg, backgroundColor: colors.accent, borderBottomWidth: 3, borderBottomColor: colors.accentDeep,
  },
  adBtnText: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 15, includeFontPadding: false },

  // Can't claim for another reason (GPS, owned, nothing in reach): say why.
  off: {
    borderRadius: radius.lg, backgroundColor: colors.sunk,
    paddingHorizontal: 16, paddingVertical: 14, minHeight: 56, justifyContent: 'center',
  },
  offText: { color: colors.ink2, fontSize: 14, fontFamily: fonts.bold, lineHeight: 19, textAlign: 'center' },
});
