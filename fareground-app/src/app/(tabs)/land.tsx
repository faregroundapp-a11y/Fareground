import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '@/api/client';
import type { Parcel } from '@/api/types';
import { Countdown } from '@/components/Countdown';
import { NeighboursCard } from '@/components/NeighboursCard';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { haptics } from '@/native/haptics';
import { BoltIcon, CoinIcon, GemIcon, PlayAdIcon } from '@/components/icons';
import { DEFAULT_PARCEL_PRICE, DEFAULT_STEPS_PER_WP } from '@/config';
import { COIN_USD, MINERALS, MINERAL_ORDER, MONTHS_PER_YEAR, UPGRADE_COINS_PER_LEVEL, formatMultiplier, formatRate } from '@/game/minerals';
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
    setNote(r.ok ? `Upgraded to level ${r.amount}: +1 coin/hour, forever.` : r.message);
  }

  // Reload whenever the tab opens - you may have just claimed.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const rate = parcels.reduce((sum, p) => sum + p.coinsPerMonth, 0);
  const boost = balance?.rewards.boost;
  const boosted = !!boost?.active && boostEndsAt !== null;
  const firstPriceSteps = (balance?.parcelPrice ?? DEFAULT_PARCEL_PRICE) * (balance?.stepsPerWalkPoint ?? DEFAULT_STEPS_PER_WP);
  const counts = MINERAL_ORDER.map((k) => ({ k, n: parcels.filter((p) => p.rarity === k).length }));

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <FlatList
        data={parcels}
        keyExtractor={(p) => p.id}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        contentContainerStyle={styles.body}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 14 }}>
            <Text style={styles.title}>My land</Text>

            <NeighboursCard />

            <View style={styles.summary}>
              <View style={styles.summaryTop}>
                <CoinIcon size={30} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rate, mono]}>{formatRate(rate)} <Text style={styles.rateUnit}>coins / month</Text></Text>
                  <Text style={[styles.usd, mono]}>${(rate * MONTHS_PER_YEAR * COIN_USD).toFixed(3)} per year</Text>
                </View>
              </View>
              {boosted && boostEndsAt && (
                <View style={styles.boostRow}>
                  <BoltIcon size={18} color="#FFFFFF" />
                  <Text style={styles.boostText}>{formatMultiplier(boost?.multiplier ?? 1)}× boost · earning {Math.round(rate * (boost?.multiplier ?? 1))}/month</Text>
                  <Countdown endsAt={boostEndsAt} onDone={refreshBalance} style={[styles.boostText, mono, { marginLeft: 'auto' }]} />
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
            {parcels.length > 0 && <Text style={styles.section}>{parcels.length} PARCEL{parcels.length === 1 ? '' : 'S'}</Text>}
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
            <View style={styles.row}>
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
                  {/* The cell reference used to lead this line. It is a grid
                      coordinate - meaningless to a player, and the product
                      owner had already rejected showing one on the map. The
                      date is the part anyone actually reads. */}
                  <Text style={[styles.rowSub, mono]} numberOfLines={1}>
                    Claimed {new Date(item.purchasedAt).toLocaleDateString()}
                  </Text>
                </View>
                <View style={styles.rowRate}>
                  <CoinIcon size={14} />
                  <Text style={[styles.rowRateText, mono]}>+{formatRate(item.coinsPerMonth)}/mo</Text>
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
                    <PlayAdIcon size={16} color={canAfford ? '#FFFFFF' : colors.ink3} />
                    <Text style={[styles.upgradeText, !canAfford && { color: colors.ink3 }]}>
                      {adBusy === 'UPGRADE' ? 'Loading ad…' : `Upgrade +${UPGRADE_COINS_PER_LEVEL}/mo · ${cost} WP + ad`}
                    </Text>
                    <View style={{ flex: 1 }} />
                    <Text style={[styles.upgradeLvl, !canAfford && { color: colors.ink3 }]}>
                      {item.upgradeLevel}/{item.maxUpgradeLevel}
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
  body: { padding: space.xl, paddingBottom: space.xxl },
  title: type.display,
  boostRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.boost,
    borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm + 2,
  },
  boostText: { fontFamily: fonts.heavy, fontSize: 13.5, color: '#FFFFFF', includeFontPadding: false },
  summary: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, gap: 14, ...shadow.card },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rate: { fontSize: 28, fontFamily: fonts.black, color: colors.ink, letterSpacing: -0.5 },
  rateUnit: { fontSize: 14, fontFamily: fonts.medium, color: colors.ink2 },
  usd: { fontSize: 12.5, color: colors.ink3, fontFamily: fonts.medium },
  collection: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.sunk, borderRadius: radius.md, padding: 10 },
  slot: { alignItems: 'center', gap: 4, flex: 1 },
  slotN: { fontSize: 14, fontFamily: fonts.heavy, color: colors.ink },
  error: { fontFamily: fonts.medium, fontSize: 14, color: colors.danger },
  section: { ...type.overline },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.heavy, color: colors.ink },
  emptyBody: { fontFamily: fonts.regular, fontSize: 14, color: colors.ink2, textAlign: 'center' },
  row: {
    backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, gap: space.sm, ...shadow.card,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lvl: { backgroundColor: colors.accent, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  lvlText: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 9.5, includeFontPadding: false },
  upgrade: {
    flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40, paddingHorizontal: 12,
    borderRadius: radius.md, backgroundColor: colors.boost,
  },
  upgradeOff: { backgroundColor: colors.sunk },
  upgradeText: { color: '#FFFFFF', fontFamily: fonts.heavy, fontSize: 13, includeFontPadding: false },
  upgradeLvl: { color: 'rgba(255,255,255,0.8)', fontFamily: fonts.bold, fontSize: 12, includeFontPadding: false },
  maxed: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.goodInk, textAlign: 'center', paddingVertical: 6 },
  note: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.goodInk },
  gemWell: { width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  rowName: { fontSize: 16, fontFamily: fonts.heavy },
  rowSub: { fontFamily: fonts.regular, fontSize: 12, color: colors.ink3, marginTop: 2 },
  rowRate: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.sunk, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 5 },
  rowRateText: { fontSize: 13, fontFamily: fonts.heavy, color: colors.ink },
});
