import { useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, ApiError } from '@/api/client';
import { formatMultiplier } from '@/game/minerals';
import type { AdRewardKind } from '@/api/types';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { adsAvailable } from '@/native/ads';
import { useGameBalance, useGameDaily } from '@/state/game';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, space, type } from '@/theme';
import { useDistance } from '@/state/prefs';
import { Button } from './Button';
import { Countdown } from './Countdown';
import { BoltIcon, CoinIcon, PinIcon, PlayAdIcon, StepsIcon } from './icons';
import { DraggableSheet, SheetScrollView } from './DraggableSheet';

/** Bonus-WP ads come one at a time, this far apart (the server decides). */
const WP_AD_EVERY_MIN = 20;

/**
 * "Free rewards": every rewarded ad offer in one place.
 *
 * All of them are the player's choice, all are capped daily, and the ones
 * that cost the game nothing (scouting, and the looks in the avatar editor)
 * are the ones we lean on hardest.
 */
export function BoostSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const dist = useDistance();
  const insets = useSafeAreaInsets();
  const { balance, refresh, boostEndsAt } = useGameBalance();
  const { refresh: refreshDaily } = useGameDaily();
  // An ad also counts toward the "use a power-up" quest, so refresh both.
  const { watch, busy } = useRewardedAd(() => {
    refresh();
    refreshDaily();
  });
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const { token } = useSession();
  const [trading, setTrading] = useState(false);

  /**
   * Coins into land: one parcel's worth of Walk Points at a time. Not an ad -
   * it lives here because this is where players go to "get more", and it is
   * the one offer that turns what their land earned into more land.
   */
  async function trade(walkPoints: number) {
    if (!token) return;
    setNote(null);
    setTrading(true);
    try {
      const t = await api.tradeWalkPoints(token, walkPoints);
      setNote({ text: `+${t.walkPoints} Walk Points for ${t.coinsSpent.toLocaleString()} coins.`, good: true });
      refresh();
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : 'Something went wrong. Please try again.', good: false });
    } finally {
      setTrading(false);
    }
  }

  async function run(kind: AdRewardKind) {
    setNote(null);
    const r = await watch(kind);
    if (!r.ok) {
      setNote({ text: r.message, good: false });
      return;
    }
    const said: Record<string, string> = {
      // The multiplier is no longer 2, so never say "double" - read it from
      // the server, which is the only place that knows.
      BOOST: `Boost on! +${Math.round(r.amount / 60)} minutes at ${formatMultiplier(balance?.rewards.boost.multiplier ?? 1)}× coins.`,
      WALK_POINTS: `+${r.amount} Walk Points added.`,
      INSTANT_COLLECT: `+${r.amount.toLocaleString()} coins collected early.`,
      SCOUT: `Scouting for ${Math.round(r.amount / 60)} minutes - your reach is wider.`,
    };
    setNote({ text: said[r.kind] ?? 'Done!', good: true });
  }

  const r = balance?.rewards;
  const wpCooling = (r?.walkPoints.nextInSeconds ?? 0) > 0;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <DraggableSheet onClose={onClose} style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]} gripStyle={styles.grip}>
        <SheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.sm }}>
          <Text style={type.title}>Free rewards</Text>
          <Text style={[type.body, { marginTop: 2, marginBottom: space.lg }]}>Watch a short ad, take your pick.</Text>

          {balance && r && (
            <>
              {/* double coins */}
              <Offer
                icon={<BoltIcon size={26} />}
                wellColor={colors.boostSoft}
                title={`${formatMultiplier(r.boost.multiplier)}× coins`}
                subtitle={`+${Math.round(r.boost.secondsPerAd / 60)} min per ad · up to ${r.boost.maxBankedSeconds / 3600} h banked`}
                right={r.boost.active && boostEndsAt ? <Live endsAt={boostEndsAt} /> : null}
                bar={{ fill: r.boost.remainingSeconds / r.boost.maxBankedSeconds, color: colors.boost, track: colors.boostSoft }}
                button={{
                  label: r.boost.canAdd
                    ? `Watch ad · +${Math.round(r.boost.secondsPerAd / 60)} min`
                    : r.boost.needsLand ? 'Claim land first'
                    : r.boost.adsLeftToday === 0 ? 'Back tomorrow'
                    : 'Boost is full',
                  variant: 'boost',
                  disabled: !r.boost.canAdd,
                  busy: busy === 'BOOST',
                  onPress: () => run('BOOST'),
                }}
                left={`${r.boost.adsLeftToday} left today`}
                disabledAll={busy !== null}
              />

              {/* bonus walk points */}
              <Offer
                icon={<StepsIcon size={24} color={colors.steps} />}
                wellColor={colors.accentSoft}
                title={`+${r.walkPoints.perAd} Walk Points`}
                subtitle={`Worth ${(r.walkPoints.perAd * balance.stepsPerWalkPoint).toLocaleString()} steps · one every ${WP_AD_EVERY_MIN} min`}
                // Cooling down: tick to the next one, then refresh so the
                // button wakes up by itself. The 2 s spare covers a phone
                // clock a little ahead of the server's.
                right={wpCooling && r.walkPoints.nextAt ? (
                  <Live endsAt={Date.parse(r.walkPoints.nextAt) + 2000} onDone={refresh} />
                ) : null}
                button={{
                  label: wpCooling ? 'Next one soon'
                    : r.walkPoints.adsLeftToday > 0 ? `Watch ad · +${r.walkPoints.perAd} WP` : 'Back tomorrow',
                  variant: 'primary',
                  disabled: wpCooling || r.walkPoints.adsLeftToday === 0,
                  busy: busy === 'WALK_POINTS',
                  onPress: () => run('WALK_POINTS'),
                }}
                left={wpCooling ? 'Ready when the timer ends' : 'Ready now'}
                disabledAll={busy !== null}
              />

              {/* scouting */}
              <Offer
                icon={<PinIcon size={24} color={colors.accentText} />}
                wellColor={colors.accentSoft}
                title="Scout further"
                subtitle={`Claim up to ${dist(r.scout.reachM)} away for ${Math.round(r.scout.secondsPerAd / 60)} minutes`}
                right={r.scout.active && r.scout.endsAt ? <Live endsAt={new Date(r.scout.endsAt).getTime()} /> : null}
                button={{
                  label: r.scout.canAdd
                    ? `Watch ad · ${Math.round(r.scout.secondsPerAd / 60)} min`
                    : r.scout.adsLeftToday === 0 ? 'Back tomorrow' : 'Already scouting',
                  variant: 'secondary',
                  disabled: !r.scout.canAdd,
                  busy: busy === 'SCOUT',
                  onPress: () => run('SCOUT'),
                }}
                left={`${r.scout.adsLeftToday} left today`}
                disabledAll={busy !== null}
              />

              {/* coins into land - no ad, just a trade */}
              <Offer
                icon={<CoinIcon size={26} />}
                wellColor={colors.claimSoft}
                title={`Turn coins into land`}
                subtitle={`${(balance.parcelPrice * balance.coinsPerWalkPoint).toLocaleString()} coins buys ${balance.parcelPrice} WP - a whole parcel`}
                button={{
                  label: `Trade · +${balance.parcelPrice} WP`,
                  variant: 'light',
                  disabled: balance.coins < balance.parcelPrice * balance.coinsPerWalkPoint,
                  busy: trading,
                  onPress: () => trade(balance.parcelPrice),
                }}
                left={`${balance.coins.toLocaleString()} coins`}
                disabledAll={busy !== null || trading}
              />

              <Text style={[type.caption, { textAlign: 'center', marginTop: space.xs }]}>
                More looks for your character are in your profile.
              </Text>
            </>
          )}

          {note && <Text style={[styles.note, { color: note.good ? colors.goodInk : colors.danger }]}>{note.text}</Text>}
          {!adsAvailable() && (
            <Text style={styles.note}>Ads arrive with the next app update - install the new build to use these.</Text>
          )}
        </SheetScrollView>
      </DraggableSheet>
    </Modal>
  );
}

function Live({ endsAt, onDone }: { endsAt: number; onDone?: () => void }) {
  return (
    <View style={styles.live}>
      <Countdown endsAt={endsAt} onDone={onDone} style={[styles.liveText, mono]} />
    </View>
  );
}

function Offer({
  icon, wellColor, title, subtitle, right, bar, button, left, disabledAll,
}: {
  icon: React.ReactNode;
  wellColor: string;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  bar?: { fill: number; color: string; track: string };
  button: { label: string; variant: 'boost' | 'primary' | 'secondary' | 'light'; disabled: boolean; busy: boolean; onPress: () => void };
  left: string;
  disabledAll: boolean;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.well, { backgroundColor: wellColor }]}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={type.headline}>{title}</Text>
          <Text style={[type.caption, { marginTop: 2 }]}>{subtitle}</Text>
        </View>
        {right}
      </View>
      {bar && (
        <View style={[styles.bank, { backgroundColor: bar.track }]}>
          <View style={[styles.bankFill, { width: `${Math.min(1, bar.fill) * 100}%`, backgroundColor: bar.color }]} />
        </View>
      )}
      <Button
        variant={button.variant}
        label={button.label}
        icon={button.disabled ? undefined : <PlayAdIcon size={20} color={button.variant === 'light' ? colors.ink : '#FFFFFF'} />}
        onPress={button.onPress}
        busy={button.busy}
        disabled={disabledAll || button.disabled}
      />
      <Text style={styles.left}>{left}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.scrim },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '90%',
    backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl, paddingTop: space.sm,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: space.lg },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line,
    padding: space.lg, gap: space.md, marginBottom: space.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  well: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  live: { backgroundColor: colors.boost, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  liveText: { color: '#FFFFFF', fontFamily: fonts.heavy, fontSize: 13, includeFontPadding: false },
  bank: { height: 8, borderRadius: 4, overflow: 'hidden' },
  bankFill: { height: '100%', borderRadius: 4 },
  left: { ...type.caption, textAlign: 'center', marginTop: -4 },
  note: { ...type.body, fontFamily: fonts.bold, textAlign: 'center', marginTop: space.xs },
});
