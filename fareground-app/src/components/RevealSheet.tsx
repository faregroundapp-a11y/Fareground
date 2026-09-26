import { useEffect, useState } from 'react';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { adsAvailable } from '@/native/ads';
import { useGameBalance, useGameDaily } from '@/state/game';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Parcel } from '@/api/types';
import { COIN_USD, MINERALS, MINERAL_ORDER, MONTHS_PER_YEAR } from '@/game/minerals';
import { colors, fonts, mono, radius } from '@/theme';
import { CoinIcon, GemIcon, PlayAdIcon } from './icons';


/**
 * The receipt that follows the celebration: what you got, what it earns,
 * where it is. Slides up over the map so your new block stays in view above.
 */
export function RevealSheet({ parcel, onClose }: { parcel: Parcel | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [y] = useState(() => new Animated.Value(420));
  const { balance, refresh } = useGameBalance();
  const { refresh: refreshDaily } = useGameDaily();
  const { watch, busy } = useRewardedAd(() => {
    refresh();
    refreshDaily();
  });
  const [bonus, setBonus] = useState<{ parcelId: string; text: string } | null>(null);
  const bonusLeft = balance?.rewards.walkPoints.adsLeftToday ?? 0;
  const perAd = balance?.rewards.walkPoints.perAd ?? 5;

  useEffect(() => {
    Animated.spring(y, { toValue: parcel ? 0 : 420, useNativeDriver: true, damping: 17, stiffness: 160 }).start();
  }, [parcel, y]);

  if (!parcel) return null;
  const m = MINERALS[parcel.rarity];
  const rank = MINERAL_ORDER.indexOf(parcel.rarity);

  return (
    <Animated.View style={[styles.sheet, { paddingBottom: 18 + insets.bottom, transform: [{ translateY: y }] }]}>
      <View style={styles.grip} />

      <View style={styles.head}>
        <View style={[styles.gemWell, { backgroundColor: m.color + '22', borderColor: m.color + '55' }]}>
          <GemIcon size={40} color={m.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>YOU CLAIMED</Text>
          <Text style={[styles.name, { color: m.color }]}>{m.label}</Text>
          <View style={styles.pips}>
            {MINERAL_ORDER.map((k, i) => (
              <View key={k} style={[styles.pip, { backgroundColor: i <= rank ? m.color : colors.line }]} />
            ))}
            <Text style={styles.odds}>{m.odds}% chance</Text>
          </View>
        </View>
      </View>

      <View style={styles.stats}>
        <View style={styles.stat}>
          <CoinIcon size={18} />
          <Text style={[styles.statValue, mono]}>+{parcel.coinsPerMonth}</Text>
          <Text style={styles.statLabel}>coins / month</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, mono]}>${(parcel.coinsPerMonth * MONTHS_PER_YEAR * COIN_USD).toFixed(3)}</Text>
          <Text style={styles.statLabel}>per year</Text>
        </View>
        {/* The cell reference was here. A grid coordinate tells a player
            nothing they can use, and it was the least interesting thing on
            the best screen in the game. Two stats that mean something beat
            three where one is noise. */}
      </View>

      {/* The best moment to offer a rewarded ad: they just found something. */}
      {bonus?.parcelId === parcel.id ? (
        <Text style={styles.bonusDone}>{bonus.text}</Text>
      ) : (
        adsAvailable() && bonusLeft > 0 && (
          <Pressable
            style={({ pressed }) => [styles.bonus, pressed && { opacity: 0.85 }]}
            disabled={busy !== null}
            onPress={async () => {
              const r = await watch('WALK_POINTS');
              setBonus({ parcelId: parcel.id, text: r.ok ? `+${r.amount} WP bonus added!` : r.message });
            }}
            accessibilityRole="button"
          >
            <PlayAdIcon size={20} color={colors.boostDeep} />
            <Text style={styles.bonusText}>
              {busy ? 'Loading ad…' : `Bonus: watch an ad for +${perAd} WP  ·  ${bonusLeft} left today`}
            </Text>
          </Pressable>
        )
      )}

      <Pressable
        style={({ pressed }) => [styles.btn, pressed && { opacity: 0.85 }]}
        onPress={onClose}
        accessibilityRole="button"
      >
        <Text style={styles.btnText}>Back to exploring</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.card, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 20, paddingTop: 10,
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 24, shadowOffset: { width: 0, height: -6 }, elevation: 20,
  },
  grip: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  gemWell: { width: 68, height: 68, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 11, letterSpacing: 1.6, color: colors.ink3, fontFamily: fonts.bold },
  name: { fontSize: 32, fontFamily: fonts.black, letterSpacing: -0.8, lineHeight: 36 },
  pips: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  pip: { width: 14, height: 5, borderRadius: 2.5 },
  odds: { marginLeft: 6, fontSize: 12, color: colors.ink2, fontFamily: fonts.medium },
  stats: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.sunk,
    borderRadius: radius.md, paddingVertical: 12, marginBottom: 16,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 17, fontFamily: fonts.heavy, color: colors.ink },
  statLabel: { fontSize: 11, color: colors.ink3, fontFamily: fonts.medium },
  divider: { width: 1, height: 30, backgroundColor: colors.line },
  btn: { backgroundColor: colors.accent, borderRadius: radius.md, height: 52, alignItems: 'center', justifyContent: 'center' },
  bonus: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, height: 50, marginBottom: 10,
    borderRadius: radius.md, backgroundColor: colors.boostSoft, borderWidth: 1, borderColor: colors.boostHi,
  },
  bonusText: { fontFamily: fonts.heavy, fontSize: 15, color: colors.boostDeep, includeFontPadding: false },
  bonusDone: { fontFamily: fonts.bold, fontSize: 14, color: colors.goodInk, textAlign: 'center', marginBottom: 12 },
  btnText: { color: colors.accentInk, fontFamily: fonts.heavy, fontSize: 16 },
});
