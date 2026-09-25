import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError, api } from '@/api/client';
import type { AreasStatus, ClaimSummary } from '@/api/types';
import { placeNameFor } from '@/hooks/useAreaReporter';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { adsAvailable } from '@/native/ads';
import { haptics } from '@/native/haptics';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, space, type } from '@/theme';
import { Button } from './Button';
import { PinIcon, PlayAdIcon } from './icons';

/**
 * Today's area: ONE place to walk to.
 *
 * This replaced a 5x5 board of nearby squares, which replaced a button you
 * could press anywhere. The board was better than the button but it was
 * still a menu - everything around you, pick one - and a menu is not a
 * reason to leave the house. A single rolled destination is.
 *
 * The loop: walk there -> check in -> ad to double it -> ad for the next one.
 *
 * WHAT THIS SCREEN MUST NEVER DO is let the target look claimable when it is
 * not. The server refuses a check-in unless your own coordinates fall inside
 * the square, so the button state here is a courtesy; the distance readout is
 * the thing the player actually steers by, and it updates as they walk.
 */
export function AreasCard({
  position,
  onCollected,
}: {
  position?: { lat: number; lng: number; accuracyM: number; mocked?: boolean } | null;
  onCollected?: () => void;
}) {
  const { token } = useSession();
  const [status, setStatus] = useState<AreasStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const [claimed, setClaimed] = useState<ClaimSummary | null>(null);

  const refresh = useCallback(async () => {
    if (!token || !position) return;
    try {
      setStatus(await api.areas(token, position.lat, position.lng));
    } catch {
      // Keep the last good state rather than blanking a card mid-walk.
    }
  }, [token, position]);

  const { watch, busy: adBusy } = useRewardedAd(() => {
    void refresh();
    onCollected?.();
  });

  const checkIn = useCallback(async () => {
    if (!token || !position) return;
    setBusy(true);
    setNote(null);
    try {
      // The name is looked up on the PHONE, so the server never needs a
      // position precise enough to reverse-geocode.
      const placeName = await placeNameFor(position.lat, position.lng);
      const r = await api.checkIn(token, { ...position, placeName });
      haptics.success();
      setClaimed(r.claim);
      setNote({
        text: r.newPlace
          ? `Somewhere new${r.placeName ? ` — ${r.placeName}` : ''}!`
          : `Made it${r.placeName ? ` to ${r.placeName}` : ''}.`,
        good: true,
      });
      await refresh();
      onCollected?.();
    } catch (e) {
      haptics.warn();
      setNote({ text: e instanceof ApiError ? e.message : 'That did not work.', good: false });
    } finally {
      setBusy(false);
    }
  }, [token, position, refresh, onCollected]);

  /** Watch an ad to be sent somewhere else. */
  const nextArea = useCallback(async () => {
    if (!token || !position) return;
    const r = await watch('EXTRA_CHECKIN');
    if (!r.ok) {
      setNote({ text: r.message, good: false });
      return;
    }
    setBusy(true);
    try {
      setStatus(await api.nextArea(token, position.lat, position.lng, r.nonce));
      setClaimed(null);
      setNote({ text: 'New area. Off you go.', good: true });
      haptics.success();
    } catch (e) {
      setNote({ text: e instanceof ApiError ? e.message : 'That did not work.', good: false });
    } finally {
      setBusy(false);
    }
  }, [token, position, watch]);

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

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (!position) {
    return (
      <View style={{ gap: space.sm }}>
        <Header />
        <Text style={styles.body}>Open the map so we know where to send you.</Text>
      </View>
    );
  }

  const t = status?.target ?? null;

  return (
    <View style={{ gap: space.sm }}>
      <Header count={status?.claimedToday} />

      {/* --- where you are being sent -------------------------------- */}
      {t ? (
        <View style={[styles.target, t.here && styles.targetHere]}>
          <PinIcon size={22} color={t.here ? colors.accent : colors.ink2} />
          <View style={{ flex: 1 }}>
            <Text style={type.label}>
              {t.here ? "You're here" : t.visited ? 'Somewhere you know' : 'Somewhere new'}
            </Text>
            <Text style={styles.sub}>
              {t.here
                ? `Check in to collect · this area is ~${t.areaSizeM} m across`
                : `${t.distanceM} m away — walk into it to check in`}
            </Text>
          </View>
          <View style={styles.pay}>
            <Text style={[styles.payValue, mono]}>+{t.wp}</Text>
            <Text style={styles.payUnit}>WP</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.body}>
          {status?.nextNeedsAd
            ? "You've been everywhere we sent you today. Watch an ad for somewhere else."
            : 'Finding you somewhere to go…'}
        </Text>
      )}

      {/* --- the one thing to do next -------------------------------- */}
      {claimed ? (
        <View style={{ gap: space.sm }}>
          <View style={styles.got}>
            <Text style={styles.gotValue}>+{claimed.doubled ? claimed.amount * 2 : claimed.amount} WP</Text>
          </View>
          {claimed.canDouble && !claimed.doubled && adsAvailable() ? (
            <Button
              variant="boost"
              label={`Double it to ${claimed.amount * 2} WP`}
              icon={<PlayAdIcon size={18} />}
              onPress={() => void double(claimed)}
              busy={adBusy === 'DOUBLE'}
            />
          ) : null}
          {adsAvailable() ? (
            <Button
              variant="secondary"
              label="Send me somewhere else"
              icon={<PlayAdIcon size={18} color={colors.accent} />}
              onPress={() => void nextArea()}
              busy={busy || adBusy === 'EXTRA_CHECKIN'}
            />
          ) : null}
        </View>
      ) : t?.here ? (
        <Button label={`Check in here · +${t.wp} WP`} onPress={() => void checkIn()} busy={busy} />
      ) : adsAvailable() ? (
        <Button
          variant="secondary"
          label={t ? 'Somewhere else instead' : 'Get an area'}
          icon={<PlayAdIcon size={18} color={colors.accent} />}
          onPress={() => void nextArea()}
          busy={busy || adBusy === 'EXTRA_CHECKIN'}
        />
      ) : null}

      {note ? (
        <Text style={[styles.note, !note.good && { color: colors.ink3 }]}>{note.text}</Text>
      ) : null}
    </View>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <View>
      <Text style={type.label}>Today&apos;s area</Text>
      <Text style={styles.sub}>
        {count ? `${count} reached today.` : 'Walk to the spot to check in.'} One free a day.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { ...type.caption, lineHeight: 19 },
  sub: { ...type.caption, marginTop: 2 },

  target: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.card, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.line,
  },
  targetHere: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  pay: { alignItems: 'center' },
  payValue: { fontFamily: fonts.black, fontSize: 18, color: colors.accent },
  payUnit: { ...type.caption, fontSize: 10, marginTop: -2 },

  got: { alignItems: 'center', backgroundColor: colors.accentSoft, borderRadius: radius.md, paddingVertical: space.md },
  gotValue: { fontFamily: fonts.black, fontSize: 24, color: colors.accent },

  note: { ...type.caption, fontFamily: fonts.bold, color: colors.goodInk, textAlign: 'center' },
});
