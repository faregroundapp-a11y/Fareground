import { useCallback, useState } from 'react';
import { Modal, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import type { ClaimSummary, PitStopStatus, PitStopTarget } from '@/api/types';
import { MINERALS } from '@/game/minerals';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { adsAvailable } from '@/native/ads';
import { haptics } from '@/native/haptics';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, space, type } from '@/theme';
import { useDistance } from '@/state/prefs';
import { Button } from './Button';
import { Countdown } from './Countdown';
import { GemIcon, PlayAdIcon } from './icons';
import { DraggableSheet, SheetScrollView } from './DraggableSheet';

/**
 * "Ring the doorbell?" - reached by tapping someone else's land.
 *
 * Since 2026-09-27 ringing works like a check-in: you earn Walk Points AND so
 * does the plot's owner. Your own land has no doorbell to ring.
 *
 * Originally a pit stop, reached by tapping someone's land.
 *
 * WHY IT MOVED OFF THE MENU. A pit stop on the daily sheet was a list of
 * anonymous parcel ids you had to cross-reference against the map yourself.
 * The action is inherently about a PLACE, so it belongs on the place: you see
 * a square that is not yours, you tap it, you ring the bell. Nothing to find
 * in a menu, and it teaches the mechanic the first time somebody taps a
 * neighbour by accident.
 *
 * Two clocks are running at once and the sheet has to make both legible:
 *   - the SHARED five-minute one between any two stops, which an ad skips
 *   - THIS parcel's own 24 hours, which nothing skips
 * A parcel can be ready while you are not, and vice versa, so the button
 * always names whichever rule is actually blocking.
 */
export function DoorbellSheet({
  parcelId,
  position,
  onClose,
  onCollected,
}: {
  /** The parcel that was tapped. Null closes the sheet. */
  parcelId: string | null;
  position: { lat: number; lng: number; accuracyM: number; mocked?: boolean } | null;
  onClose: () => void;
  onCollected?: () => void;
}) {
  const dist = useDistance();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { token } = useSession();
  const [status, setStatus] = useState<PitStopStatus | null>(null);
  /**
   * When the shared cooldown runs out, as a timestamp. Resolved the moment
   * the status arrives, never during render: the React Compiler forbids
   * Date.now() in a render body, and it is right to - a countdown computed
   * there restarts on every re-render.
   */
  const [coolUntil, setCoolUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const [claimed, setClaimed] = useState<ClaimSummary | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !position) return;
    try {
      const next = await api.pitStops(token, position.lat, position.lng);
      setStatus(next);
      setCoolUntil(next.cooldownSeconds > 0 ? Date.now() + next.cooldownSeconds * 1000 : null);
    } catch {
      // Leave the last good state up rather than blanking a sheet mid-use.
    }
  }, [token, position]);

  // Loaded each time a parcel is tapped. What is in reach changes as you walk,
  // so a status from two minutes ago is already wrong.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (parcelId && loadedFor !== parcelId) {
    setLoadedFor(parcelId);
    setNote(null);
    setClaimed(null);
    void refresh();
  } else if (!parcelId && loadedFor !== null) {
    setLoadedFor(null);
  }

  const { watch, busy: adBusy } = useRewardedAd(() => {
    void refresh();
    onCollected?.();
  });

  const ring = useCallback(
    async (target: PitStopTarget, adNonce?: string) => {
      if (!token || !position) return;
      setBusy(true);
      setNote(null);
      try {
        const r = await api.pitStop(token, { ...position, parcelId: target.parcelId, adNonce });
        haptics.success();
        setClaimed(r.claim);
        setCoolUntil(Date.now() + r.cooldownSeconds * 1000);
        setNote({
          text: r.ownerWp
            ? `Ding dong! The owner got +${r.ownerWp} WP too.`
            : 'Ding dong!',
          good: true,
        });
        await refresh();
        onCollected?.();
      } catch (e) {
        haptics.warn();
        setNote({ text: e instanceof ApiError ? e.message : 'Something went wrong.', good: false });
      } finally {
        setBusy(false);
      }
    },
    [token, position, refresh, onCollected],
  );

  /** Watch an ad to skip whatever is left of the shared five minutes. */
  const ringWithAd = useCallback(
    async (target: PitStopTarget) => {
      const r = await watch('PIT_STOP');
      if (!r.ok) {
        setNote({ text: r.message, good: false });
        return;
      }
      await ring(target, r.nonce);
    },
    [watch, ring],
  );

  const double = useCallback(
    async (claim: ClaimSummary) => {
      const r = await watch('DOUBLE', { targetClaimId: claim.id });
      if (r.ok) {
        setClaimed({ ...claim, doubled: true });
        setNote({ text: `Doubled to ${claim.amount * 2} WP`, good: true });
        onCollected?.();
      } else {
        setNote({ text: r.message, good: false });
      }
    },
    [watch, onCollected],
  );

  const target = status?.targets.find((t) => t.parcelId === parcelId) ?? null;
  const cooling = coolUntil !== null;
  const mineral = target ? MINERALS[target.rarity] : null;

  return (
    <Modal visible={parcelId !== null} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <DraggableSheet onClose={onClose} style={[styles.sheet, { paddingBottom: space.lg + insets.bottom, maxHeight: height * 0.85 }]} gripStyle={styles.grip}>

        <SheetScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: space.md }}
          bounces={false}
        >
        <View style={styles.head}>
          <View style={styles.door}>
            <View style={styles.bell} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.title}>Ring the doorbell?</Text>
            <Text style={[type.caption, { marginTop: 2 }]}>
              {target
                ? "Someone else's plot. Ring the doorbell and you both earn Walk Points."
                : 'Walk closer to this plot.'}
            </Text>
          </View>
        </View>

        {target && mineral ? (
          <View style={styles.plot}>
            <GemIcon size={20} color={mineral.color} />
            <Text style={styles.plotLabel}>{mineral.label}</Text>
            <Text style={[styles.plotDistance, mono]}>{dist(target.distanceM)} away</Text>
            <View style={styles.pay}>
              <Text style={[styles.payValue, mono]}>+{target.wp}</Text>
              <Text style={styles.payUnit}>WP</Text>
            </View>
          </View>
        ) : null}

        {/* --- the one thing that is blocking, and how to get past it ---- */}
        {!target ? (
          <Text style={styles.body}>
            You need to be within {'≈'}40 m of a plot to reach its door. Keep walking.
          </Text>
        ) : target.readyInSeconds > 0 ? (
          <Text style={styles.body}>
            You already rang here today. Try again in about{' '}
            {Math.max(1, Math.ceil(target.readyInSeconds / 3600))} hours - the same door only
            answers once a day.
          </Text>
        ) : null}

        {/* --- action ---------------------------------------------------- */}
        {target && target.readyInSeconds === 0 ? (
          claimed ? (
            <View style={{ gap: space.sm }}>
              <View style={styles.got}>
                <Text style={styles.gotValue}>
                  +{claimed.doubled ? claimed.amount * 2 : claimed.amount} WP
                </Text>
              </View>
              {claimed.canDouble && !claimed.doubled && adsAvailable() ? (
                <Button
                  variant="boost"
                  label="Double it"
                  icon={<PlayAdIcon size={18} />}
                  onPress={() => void double(claimed)}
                  busy={adBusy === 'DOUBLE'}
                />
              ) : null}
            </View>
          ) : cooling ? (
            <View style={{ gap: space.sm }}>
              <View style={styles.waitRow}>
                <Text style={styles.waitLabel}>Catching your breath</Text>
                <Countdown
                  endsAt={coolUntil}
                  style={[styles.waitClock, mono]}
                  onDone={() => setCoolUntil(null)}
                />
              </View>
              {adsAvailable() ? (
                <Button
                  variant="boost"
                  label="Skip the wait and ring now"
                  icon={<PlayAdIcon size={18} />}
                  onPress={() => void ringWithAd(target)}
                  busy={busy || adBusy === 'PIT_STOP'}
                />
              ) : null}
            </View>
          ) : (
            <Button
              label={`Ring the doorbell  ·  +${target.wp} WP`}
              onPress={() => void ring(target)}
              busy={busy}
            />
          )
        ) : null}

        </SheetScrollView>

        {note ? (
          <Text style={[styles.note, !note.good && { color: colors.danger }]}>{note.text}</Text>
        ) : (
          <Text style={styles.foot}>
            {status ? `${status.today} ${status.today === 1 ? 'door' : 'doors'} today` : ' '}
          </Text>
        )}
      </DraggableSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(8,14,11,0.55)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    gap: space.md,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },

  // A door with a bell on it, drawn in views - no new asset for one icon.
  door: {
    width: 44, height: 52, borderRadius: 6, backgroundColor: colors.accentSoft,
    borderWidth: 2, borderColor: colors.accent, alignItems: 'flex-end', justifyContent: 'center',
    paddingRight: 5,
  },
  bell: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },

  plot: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.card, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.line,
  },
  plotLabel: { ...type.label, flex: 1 },
  plotDistance: { ...type.caption, fontSize: 12 },
  pay: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  payValue: { fontFamily: fonts.black, fontSize: 19, color: colors.accent },
  payUnit: { ...type.caption, fontSize: 11 },

  body: { ...type.caption, lineHeight: 19 },
  waitRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.sunk, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm,
  },
  waitLabel: { ...type.caption },
  waitClock: { fontFamily: fonts.black, fontSize: 16, color: colors.ink },

  got: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.md, paddingVertical: space.md },
  gotValue: { fontFamily: fonts.black, fontSize: 24, color: colors.accent },

  note: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.goodInk, textAlign: 'center' },
  foot: { ...type.caption, textAlign: 'center' },
});
