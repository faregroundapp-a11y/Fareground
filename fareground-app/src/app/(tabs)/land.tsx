import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import type { Parcel } from '@/api/types';
import { BoostBubble } from '@/components/BoostBubble';
import { Countdown } from '@/components/Countdown';
import { NeighboursCard } from '@/components/NeighboursCard';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { haptics } from '@/native/haptics';
import { BoltIcon, CoinIcon, GemIcon, PlayAdIcon } from '@/components/icons';
import { DEFAULT_PARCEL_PRICE, DEFAULT_STEPS_PER_WP } from '@/config';
import { COIN_USD, MINERALS, MINERAL_ORDER, MONTHS_PER_YEAR, UPGRADE_COINS_PER_LEVEL, formatMultiplier, formatRate } from '@/game/minerals';
import { useScreenSize } from '@/hooks/useScreenSize';
import { useTabBarSpace } from '@/hooks/useTabBarSpace';
import { adsAvailable } from '@/native/ads';
import { useGameBalance } from '@/state/game';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, shadow, space, type } from '@/theme';

export default function LandScreen() {
  const { token } = useSession();
  const { balance, boostEndsAt, refresh: refreshBalance } = useGameBalance();
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setParcels((await api.myParcels(token)).parcels);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your land.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  const [note, setNote] = useState<string | null>(null);
  // Upgrading a parcel costs Walk Points AND one rewarded ad per level.
  const { watch, busy: adBusy } = useRewardedAd(() => {
    refreshBalance();
    load();
  });

  async function upgrade(parcel: Parcel) {
    setNote(null);
    haptics.press();
    const r = await watch('UPGRADE', { targetParcelId: parcel.id });
    setNote(r.ok ? `Upgraded to level ${r.amount}: +${UPGRADE_COINS_PER_LEVEL} coins/month, forever.` : r.message);
  }

  // Reload whenever the tab opens - you may have just claimed.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rate = parcels.reduce((sum, p) => sum + p.coinsPerMonth, 0);
  const boost = balance?.rewards.boost;
  const boosted = !!boost?.active && boostEndsAt !== null;
  const firstPriceSteps = (balance?.parcelPrice ?? DEFAULT_PARCEL_PRICE) * (balance?.stepsPerWalkPoint ?? DEFAULT_STEPS_PER_WP);
  const tabBarSpace = useTabBarSpace();
  const screen = useScreenSize();
  const counts = MINERAL_ORDER.map((k) => ({ k, n: parcels.filter((p) => p.rarity === k).length }));

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <FlatList
        data={parcels}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        contentContainerStyle={[styles.body, { paddingBottom: tabBarSpace }]}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 14 }}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>My land</Text>
              {parcels.length > 0 && (
                <Text style={styles.titleCount}>{parcels.length} parcel{parcels.length === 1 ? '' : 's'}</Text>
              )}
            </View>

            <NeighboursCard />

            {/* THE HERO (2026-10-03 refresh): your coin total, big, first -
                testers could not find it. What your land earns sits under it,
                and the boost bubble stays on the right. */}
            <View style={styles.summary}>
              <View style={styles.summaryTop}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.heroLabel}>YOUR COINS</Text>
                  <View style={styles.heroRow}>
                    <CoinIcon size={28} />
                    <Text style={[styles.heroCoins, mono]} numberOfLines={1} adjustsFontSizeToFit>
                      {(balance?.coins ?? 0).toLocaleString()}
                    </Text>
                  </View>
                  <Text style={[styles.heroUsd, mono]}>${((balance?.coins ?? 0) * COIN_USD).toFixed(2)}</Text>
                  <View style={styles.earnChip}>
                    <Text style={[styles.earnChipText, mono]}>
                      +{formatRate(rate)} <Text style={styles.earnChipUnit}>coins / month</Text>
                    </Text>
                    <Text style={[styles.earnChipSub, mono]}>${(rate * MONTHS_PER_YEAR * COIN_USD).toFixed(3)} per year</Text>
                  </View>
                </View>
                {rate > 0 && (
                  // 126pt wide is a third of a small phone: shrink it there
                  // (scaled, so it keeps its exact facets and wording).
                  <View style={screen.narrow ? styles.bubbleSmall : null}>
                    <BoostBubble usdPerYear={rate * (boost?.multiplier ?? 20) * MONTHS_PER_YEAR * COIN_USD} />
                  </View>
                )}
              </View>
              {boosted && boostEndsAt && (
                <View style={styles.boostRow}>
                  <BoltIcon size={18} color="#FFFFFF" />
                  {/* The label gives way (one line, trimmed) so the timer always
                      fits - on narrow phones it used to push the countdown
                      out of the pill. */}
                  <Text style={[styles.boostText, { flex: 1 }]} numberOfLines={1}>
                    {formatMultiplier(boost?.multiplier ?? 1)}× boost · {formatRate(Math.round(rate * (boost?.multiplier ?? 1) * 10) / 10)}/month
                  </Text>
                  <Countdown endsAt={boostEndsAt} onDone={refreshBalance} style={[styles.boostText, mono]} />
                </View>
              )}
              <View style={styles.collection}>
                {counts.map(({ k, n }) => (
                  <View key={k} style={[styles.slot, n === 0 && { opacity: 0.35 }]}>
                    <GemIcon size={24} color={MINERALS[k].color} />
                    <Text style={[styles.slotN, mono]}>{n}</Text>
                  </View>
                ))}
              </View>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}
            {note && <Text style={styles.note}>{note}</Text>}
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <View style={styles.empty}>
              <GemIcon size={48} color={MINERALS.AMETHYST.color} />
              <Text style={styles.emptyTitle}>No land yet</Text>
              <Text style={styles.emptyBody}>
                {balance && balance.walkPoints >= balance.parcelPrice
                  ? 'You have enough Walk Points - open the Map and claim your first square!'
                  : `Walk ${firstPriceSteps.toLocaleString()} steps and your first parcel is yours.`}
              </Text>
            </View>
          )
        }
        renderItem={({ item }) => {
          const m = MINERALS[item.rarity];
          const wp = balance?.walkPoints ?? 0;
          const cost = item.nextUpgradeCostWp;
          const canAfford = cost !== null && wp >= cost;
          return (
            <View style={[styles.row, { borderLeftColor: m.color }]}>
              <View style={styles.rowTop}>
                <View style={[styles.gemWell, { backgroundColor: m.color + '1F' }]}>
                  <GemIcon size={26} color={m.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={[styles.rowName, { color: m.color }]}>{m.label}</Text>
                    {item.upgradeLevel > 0 && (
                      <View style={styles.lvl}>
                        <Text style={styles.lvlText}>LV {item.upgradeLevel}</Text>
                      </View>
                    )}
                  </View>
                  {/* Upgrade pips: one per level, filled in the mineral's colour. */}
                  <View style={styles.pips}>
                    {Array.from({ length: item.maxUpgradeLevel }, (_, i) => (
                      <View key={i} style={[styles.pip, i < item.upgradeLevel && { backgroundColor: m.color }]} />
                    ))}
                  </View>
                </View>
                <View style={styles.rowRate}>
                  <Text style={[styles.rowRateText, mono]}>+{formatRate(item.coinsPerMonth)}</Text>
                  <Text style={styles.rowRateUnit}>coins / mo</Text>
                </View>
              </View>

              {/* Upgrades: Walk Points plus one ad per level, +1 coin/hour each. */}
              {cost === null ? (
                <Text style={styles.maxed}>Fully upgraded · +{formatRate(item.maxUpgradeLevel * UPGRADE_COINS_PER_LEVEL)}/mo from upgrades</Text>
              ) : (
                adsAvailable() && (
                  <Pressable
                    onPress={() => upgrade(item)}
                    disabled={!canAfford || adBusy !== null}
                    style={({ pressed }) => [
                      styles.upgrade,
                      !canAfford && styles.upgradeOff,
                      pressed && { opacity: 0.8 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Upgrade this parcel for ${cost} Walk Points and an ad`}
                  >
                    <PlayAdIcon size={16} color={canAfford ? colors.boostDeep : colors.ink3} />
                    <Text style={[styles.upgradeText, !canAfford && { color: colors.ink3 }]}>
                      {adBusy === 'UPGRADE' ? 'Loading ad…' : `Upgrade · ${cost} WP`}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.upgradeLvl, !canAfford && { color: colors.ink3 }]}>
                      +{UPGRADE_COINS_PER_LEVEL}/mo
                    </Text>
                  </Pressable>
                )
              )}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function Separator() {
  return <View style={{ height: space.sm }} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg },
  bubbleSmall: { transform: [{ scale: 0.8 }], marginHorizontal: -12, marginVertical: -9 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  title: type.display,
  titleCount: { fontFamily: fonts.heavy, fontSize: 13, color: colors.ink3, marginBottom: 6 },
  boostRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.boost,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm + 2,
  },
  boostText: { fontFamily: fonts.heavy, fontSize: 13.5, color: '#FFFFFF', includeFontPadding: false },
  summary: {
    backgroundColor: colors.accent, borderRadius: radius.xl, padding: 18, gap: 14,
    shadowColor: colors.accent, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 4,
  },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroLabel: { fontFamily: fonts.heavy, fontSize: 12, letterSpacing: 1.2, color: 'rgba(255,255,255,0.7)' },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  heroCoins: { fontFamily: fonts.black, fontSize: 34, letterSpacing: -1, color: '#FFFFFF', flexShrink: 1 },
  heroUsd: { fontFamily: fonts.heavy, fontSize: 15, color: 'rgba(255,255,255,0.78)', marginTop: -2 },
  earnChip: { alignSelf: 'flex-start', marginTop: 10, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 14, paddingHorizontal: 11, paddingVertical: 7 },
  earnChipText: { fontFamily: fonts.black, fontSize: 15, color: '#FFFFFF' },
  earnChipUnit: { fontFamily: fonts.bold, fontSize: 12, color: 'rgba(255,255,255,0.75)' },
  earnChipSub: { fontFamily: fonts.bold, fontSize: 11.5, color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  rate: { fontSize: 28, fontFamily: fonts.black, color: colors.ink, letterSpacing: -0.5 },
  rateUnit: { fontSize: 14, fontFamily: fonts.medium, color: colors.ink2 },
  usd: { fontSize: 12.5, color: colors.ink3, fontFamily: fonts.medium },
  balanceLine: { fontSize: 12.5, color: colors.ink2, fontFamily: fonts.bold, marginTop: 2 },
  // The gem tray keeps its original look: the light tray, the same gems.
  collection: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.sunk, borderRadius: radius.md, padding: 10 },
  slot: { alignItems: 'center', gap: 4, flex: 1 },
  slotN: { fontSize: 14, fontFamily: fonts.heavy, color: colors.ink },
  error: { fontFamily: fonts.medium, fontSize: 14, color: colors.danger },
  section: { ...type.overline },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.heavy, color: colors.ink },
  emptyBody: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  row: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: space.md, gap: space.md, ...shadow.card,
    borderLeftWidth: 5,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lvl: { backgroundColor: colors.sunk, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  lvlText: { color: colors.ink2, fontFamily: fonts.black, fontSize: 10, includeFontPadding: false },
  pips: { flexDirection: 'row', gap: 4, marginTop: 6 },
  pip: { width: 16, height: 5, borderRadius: 3, backgroundColor: colors.sunk },
  upgrade: {
    flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40, paddingHorizontal: 12,
    borderRadius: radius.md, backgroundColor: colors.boostSoft,
  },
  upgradeOff: { backgroundColor: colors.sunk },
  upgradeText: { color: colors.boostDeep, fontFamily: fonts.heavy, fontSize: 13.5, includeFontPadding: false },
  upgradeLvl: { color: colors.boostDeep, fontFamily: fonts.bold, fontSize: 12, opacity: 0.8, includeFontPadding: false },
  maxed: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.goodInk, textAlign: 'center', paddingVertical: 6 },
  note: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.goodInk },
  gemWell: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  rowName: { fontSize: 16, fontFamily: fonts.heavy },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3, marginTop: 2 },
  rowRate: { alignItems: 'flex-end' },
  rowRateText: { fontSize: 15, fontFamily: fonts.black, color: colors.ink },
  rowRateUnit: { fontSize: 11, fontFamily: fonts.bold, color: colors.ink3 },
});
