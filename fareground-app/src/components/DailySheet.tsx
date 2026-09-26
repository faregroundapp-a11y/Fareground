import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import type { ClaimSummary, Quest } from '@/api/types';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { adsAvailable } from '@/native/ads';
import { haptics } from '@/native/haptics';
import { useGameBalance, useGameDaily } from '@/state/game';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, space, type } from '@/theme';
import { AreasCard } from './AreasCard';
import { Button } from './Button';
import { BoltIcon, CheckIcon, ChestIcon, PlayAdIcon } from './icons';
import { DraggableSheet, SheetScrollView } from './DraggableSheet';

/**
 * "Today": the daily chest (a 7-day streak) and daily quests. Every reward
 * collected here can be doubled by watching an ad - the moment someone has
 * just been given something is when they are happiest to watch one.
 */
export function DailySheet({
  visible,
  onClose,
  position,
}: {
  visible: boolean;
  onClose: () => void;
  /** Where you are - needed to record a visit. Only the map screen knows. */
  position?: { lat: number; lng: number; accuracyM: number; mocked?: boolean } | null;
}) {
  const insets = useSafeAreaInsets();
  const { token } = useSession();
  const { daily, refresh: refreshDaily } = useGameDaily();
  const { refresh: refreshBalance } = useGameBalance();
  const refreshAll = () => {
    refreshDaily();
    refreshBalance();
  };
  const { watch, busy: adBusy } = useRewardedAd(refreshAll);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);

  async function collect(what: 'chest' | string) {
    if (!token) return;
    setBusy(what);
    setNote(null);
    try {
      const r = what === 'chest' ? await api.claimDaily(token) : await api.claimQuest(token, what);
      haptics.success();
      setNote({ text: `+${r.claim.amount} Walk Points!`, good: true });
      refreshAll();
    } catch (e) {
      haptics.warn();
      setNote({ text: e instanceof ApiError ? e.message : 'Something went wrong.', good: false });
    } finally {
      setBusy(null);
    }
  }



  async function saveStreak() {
    setNote(null);
    const r = await watch('STREAK_SAVE');
    setNote(r.ok ? { text: 'Streak saved!', good: true } : { text: r.message, good: false });
  }

  async function openAdChest() {
    if (!token) return;
    setBusy('adstreak');
    setNote(null);
    try {
      const r = await api.claimAdStreak(token);
      haptics.success();
      setNote({ text: `Bonus chest: +${r.claim.amount} WP!`, good: true });
      refreshAll();
    } catch (e) {
      haptics.warn();
      setNote({ text: e instanceof ApiError ? e.message : 'Something went wrong.', good: false });
    } finally {
      setBusy(null);
    }
  }

  async function double(claim: ClaimSummary) {
    const r = await watch('DOUBLE', { targetClaimId: claim.id });
    setNote(r.ok ? { text: `Doubled! +${r.amount} more Walk Points.`, good: true } : { text: r.message, good: false });
  }

  const d = daily?.daily;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <DraggableSheet onClose={onClose} style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]} gripStyle={styles.grip}>
        <SheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.sm }}>
          <Text style={type.title}>Today</Text>
          <Text style={[type.body, { marginTop: 2, marginBottom: space.lg }]}>Open your chest, finish quests, walk.</Text>

          {/* Pit stops used to sit here as a list of parcel ids you had to
              match against the map yourself. They are a PLACE, so they moved
              onto the place: tap a neighbour's plot and ring its doorbell.
              Visits stayed, because an AREA is bigger than the map view. */}
          <View style={[styles.card, { marginBottom: space.md }]}>
            <AreasCard position={position} onCollected={refreshAll} />
          </View>

          {d && (
            <View style={styles.card}>
              <View style={styles.week}>
                {d.week.map((wp, i) => {
                  const day = i + 1;
                  const pos = ((d.streak - 1) % 7) + 1;
                  const done = day < pos || (day === pos && !d.available);
                  const current = day === pos;
                  return (
                    <View
                      key={day}
                      style={[
                        styles.day,
                        done && styles.dayDone,
                        current && d.available && styles.dayNow,
                        day === 7 && styles.dayBig,
                      ]}
                    >
                      <Text style={[styles.dayLabel, (done || (current && d.available)) && { color: '#FFFFFF' }]}>
                        {day === 7 ? 'Day 7' : `D${day}`}
                      </Text>
                      {done ? <CheckIcon size={16} color="rgba(255,255,255,0.9)" /> : <ChestIcon size={day === 7 ? 22 : 18} />}
                      <Text style={[styles.dayWp, mono, (done || (current && d.available)) && { color: '#FFFFFF' }]}>{wp}</Text>
                    </View>
                  );
                })}
              </View>

              {d.available ? (
                <Button
                  label={`Open chest · +${d.reward} WP`}
                  icon={<ChestIcon size={20} open />}
                  onPress={() => collect('chest')}
                  busy={busy === 'chest'}
                  disabled={busy !== null}
                />
              ) : (
                <DoubleRow claim={d.claimedToday} busy={adBusy === 'DOUBLE'} onDouble={double} label="Today's chest opened" />
              )}
              <Text style={styles.caption}>
                {d.available ? `Day ${d.streak} of your streak` : `Streak: ${d.streak} day${d.streak === 1 ? '' : 's'} · come back tomorrow`}
              </Text>
            </View>
          )}

          {/* Streak insurance: the strongest ad in the app, because it
              stops something you built from being lost. */}
          {daily?.streakSave.missedDay && adsAvailable() && (
            <View style={[styles.card, { borderColor: colors.danger, marginTop: space.md }]}>
              <View style={styles.checkHead}>
                <View style={[styles.pinWell, { backgroundColor: colors.dangerSoft }]}>
                  <ChestIcon size={26} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.headline}>Save your streak</Text>
                  <Text style={[type.caption, { marginTop: 2 }]}>
                    You missed a day. One ad brings back your {daily.streakSave.savesStreak - 1}-day streak.
                  </Text>
                </View>
              </View>
              <Button
                variant="boost"
                label="Watch ad · save streak"
                icon={<PlayAdIcon size={20} />}
                onPress={saveStreak}
                busy={adBusy === 'STREAK_SAVE'}
                disabled={adBusy !== null || busy !== null}
              />
              <Text style={styles.caption}>{daily.streakSave.savesLeftThisWeek} saves left this week</Text>
            </View>
          )}

          {/* Watch a few ads today, get a bonus chest. */}
          {daily && (
            <View style={[styles.card, { marginTop: space.md }]}>
              <View style={styles.checkHead}>
                <View style={[styles.pinWell, { backgroundColor: colors.boostSoft }]}>
                  <BoltIcon size={26} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.headline}>Bonus chest</Text>
                  <Text style={[type.caption, { marginTop: 2 }]}>
                    Watch {daily.adStreak.target} rewards today for +{daily.adStreak.rewardWp} WP
                  </Text>
                </View>
                <Text style={[styles.checkNum, mono]}>
                  {Math.min(daily.adStreak.adsToday, daily.adStreak.target)}/{daily.adStreak.target}
                </Text>
              </View>
              <View style={styles.bank}>
                <View
                  style={[
                    styles.bankFill,
                    { width: `${Math.min(1, daily.adStreak.adsToday / daily.adStreak.target) * 100}%` },
                  ]}
                />
              </View>
              {daily.adStreak.claim ? (
                <DoubleRow claim={daily.adStreak.claim} busy={adBusy === 'DOUBLE'} onDouble={double} label="Bonus chest opened" />
              ) : (
                <Button
                  label={daily.adStreak.ready ? `Open · +${daily.adStreak.rewardWp} WP` : `${daily.adStreak.target - daily.adStreak.adsToday} more to go`}
                  icon={daily.adStreak.ready ? <ChestIcon size={20} open /> : undefined}
                  onPress={openAdChest}
                  busy={busy === 'adstreak'}
                  disabled={!daily.adStreak.ready || busy !== null}
                />
              )}
            </View>
          )}

          <Text style={[type.overline, { marginTop: space.lg, marginBottom: space.sm }]}>DAILY QUESTS</Text>
          {daily?.quests.map((q) => (
            <QuestRow
              key={q.key}
              quest={q}
              busy={busy === q.key}
              disabled={busy !== null}
              adBusy={adBusy === 'DOUBLE'}
              onCollect={() => collect(q.key)}
              onDouble={double}
            />
          ))}

          {note && <Text style={[styles.note, { color: note.good ? colors.goodInk : colors.danger }]}>{note.text}</Text>}
          {!daily && <Text style={styles.note}>Loading…</Text>}
        </SheetScrollView>
      </DraggableSheet>
    </Modal>
  );
}

/** "Doubled" badge, or a "watch an ad to double it" button. */
function DoubleRow({
  claim, busy, onDouble, label,
}: { claim: ClaimSummary | null; busy: boolean; onDouble: (c: ClaimSummary) => void; label: string }) {
  if (!claim) return null;
  if (claim.doubled) {
    return (
      <View style={styles.doneRow}>
        <CheckIcon size={18} />
        <Text style={styles.doneText}>{label} · doubled to {claim.amount * 2} WP</Text>
      </View>
    );
  }
  if (!claim.canDouble || !adsAvailable()) {
    return (
      <View style={styles.doneRow}>
        <CheckIcon size={18} />
        <Text style={styles.doneText}>{label} · +{claim.amount} WP</Text>
      </View>
    );
  }
  return (
    <Button
      variant="boost"
      label={`Double it · +${claim.amount} WP`}
      icon={<PlayAdIcon size={20} />}
      onPress={() => onDouble(claim)}
      busy={busy}
    />
  );
}

function QuestRow({
  quest, busy, disabled, adBusy, onCollect, onDouble,
}: {
  quest: Quest; busy: boolean; disabled: boolean; adBusy: boolean;
  onCollect: () => void; onDouble: (c: ClaimSummary) => void;
}) {
  const pct = Math.min(1, quest.progress / quest.target);
  return (
    <View style={styles.quest}>
      <View style={styles.questHead}>
        <View style={{ flex: 1 }}>
          <Text style={type.label}>{quest.title}</Text>
          <Text style={[type.caption, mono, { marginTop: 2 }]}>
            {quest.progress.toLocaleString()} / {quest.target.toLocaleString()}
          </Text>
        </View>
        <View style={styles.reward}>
          <Text style={[styles.rewardText, mono]}>+{quest.rewardWp} WP</Text>
        </View>
      </View>
      {!quest.claim && !quest.ready && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct * 100}%` }]} />
        </View>
      )}
      {quest.ready && (
        <Button label="Collect" onPress={onCollect} busy={busy} disabled={disabled} variant="primary" />
      )}
      {quest.claim && <DoubleRow claim={quest.claim} busy={adBusy} onDouble={onDouble} label="Collected" />}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(8,12,10,0.45)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '88%',
    backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl, paddingTop: space.sm,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: space.lg },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line,
    padding: space.lg, gap: space.md,
  },
  week: { flexDirection: 'row', gap: 5 },
  checkHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pinWell: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  checkStats: { alignItems: 'center', minWidth: 48 },
  checkNum: { fontFamily: fonts.black, fontSize: 20, color: colors.ink, includeFontPadding: false },
  checkLabel: { ...type.caption, fontSize: 11 },
  bank: { height: 8, borderRadius: 4, backgroundColor: colors.boostSoft, overflow: 'hidden' },
  bankFill: { height: '100%', borderRadius: 4, backgroundColor: colors.boost },
  day: {
    flex: 1, alignItems: 'center', gap: 3, paddingVertical: 8, borderRadius: 10,
    backgroundColor: colors.sunk, borderWidth: 1, borderColor: colors.line,
  },
  dayBig: { flex: 1.35, borderColor: colors.claim },
  dayDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayNow: { backgroundColor: colors.claimDeep, borderColor: colors.claimDeep },
  dayLabel: { fontFamily: fonts.bold, fontSize: 10, color: colors.ink3, includeFontPadding: false },
  dayWp: { fontFamily: fonts.heavy, fontSize: 12, color: colors.ink, includeFontPadding: false },
  caption: { ...type.caption, textAlign: 'center', marginTop: -4 },
  quest: {
    backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    padding: space.md, gap: space.sm + 2, marginBottom: space.sm,
  },
  questHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  reward: { backgroundColor: colors.accentSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  rewardText: { fontFamily: fonts.heavy, fontSize: 12.5, color: colors.accent, includeFontPadding: false },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.sunk, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: colors.steps },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 36 },
  doneText: { fontFamily: fonts.bold, fontSize: 14, color: colors.goodInk, includeFontPadding: false },
  note: { ...type.body, fontFamily: fonts.bold, textAlign: 'center', marginTop: space.sm },
});
