import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, api } from '@/api/client';
import type { ReferralStatus } from '@/api/types';
import { haptics } from '@/native/haptics';
import { useGameBalance } from '@/state/game';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, shadow, space, TOUCH, type } from '@/theme';
import { Button } from './Button';

/**
 * "Invite a friend": your code to share, and - for a new account - a box to
 * enter someone else's.
 *
 * Your friend gets their reward at once; you get yours once they have really
 * walked, which is what stops made-up accounts being worth anything.
 */
export function InviteCard() {
  const { token } = useSession();
  const { refresh: refreshBalance } = useGameBalance();
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    api.referral(token).then(
      (s) => { if (!cancelled) setStatus(s); },
      () => {},
    );
    return () => { cancelled = true; };
  }, [token]);

  if (!status) return null;

  async function share() {
    if (!status) return;
    haptics.tap();
    try {
      await Share.share({
        message:
          `Walk, claim real land, earn coins. Use my Fareground code ${status.code} ` +
          `and start with ${status.rewardForFriend} Walk Points.`,
      });
    } catch {
      // The share sheet was dismissed - nothing to do.
    }
  }

  async function redeem() {
    if (!token) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await api.redeemReferral(token, code.trim());
      haptics.success();
      setNote({ text: `${r.invitedBy} invited you: +${r.reward} WP!`, good: true });
      setStatus(await api.referral(token));
      refreshBalance();
      setCode('');
    } catch (e) {
      haptics.warn();
      setNote({ text: e instanceof ApiError ? e.message : 'Could not use that code.', good: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <Text style={type.headline}>Invite a friend</Text>
      <Text style={[type.caption, { marginTop: 2 }]}>
        They start with {status.rewardForFriend} WP. You get {status.rewardForYou} WP once they have walked{' '}
        {status.stepsToQualify.toLocaleString()} steps.
      </Text>

      <View style={styles.codeRow}>
        <Pressable
          style={styles.code}
          onLongPress={share}
          accessibilityLabel={`Your invite code is ${status.code.split('').join(' ')}`}
        >
          <Text style={[styles.codeText, mono]}>{status.code}</Text>
        </Pressable>
        <Button label="Share" onPress={share} variant="secondary" style={{ flex: 1 }} />
      </View>

      {status.invited > 0 && (
        <Text style={[type.caption, mono]}>
          {status.invited} invited · {status.qualified} walking · {status.earned} WP earned
        </Text>
      )}

      {status.canRedeem && (
        <View style={styles.redeem}>
          <Text style={type.label}>Got a code?</Text>
          <View style={styles.redeemRow}>
            <TextInput
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase().slice(0, 12))}
              placeholder="ABC123"
              placeholderTextColor={colors.ink3}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.input, mono]}
              accessibilityLabel="Invite code"
            />
            <Button label="Use" onPress={redeem} busy={busy} disabled={code.trim().length < 4} />
          </View>
        </View>
      )}

      {note && <Text style={[styles.note, { color: note.good ? colors.goodInk : colors.danger }]}>{note.text}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.md, ...shadow.card },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  code: {
    flex: 1.2, minHeight: TOUCH + 4, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.sunk, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.lineStrong,
  },
  codeText: { fontFamily: fonts.black, fontSize: 24, letterSpacing: 3, color: colors.ink, includeFontPadding: false },
  redeem: { gap: space.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.md },
  redeemRow: { flexDirection: 'row', gap: space.sm },
  input: {
    flex: 1, minHeight: TOUCH + 4, borderRadius: radius.md, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: space.lg,
    fontFamily: fonts.black, fontSize: 18, letterSpacing: 2, color: colors.ink,
  },
  note: { ...type.body, fontFamily: fonts.bold },
});
