import { Stack, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import type { DeleteSummary } from '@/api/types';
import { Button } from '@/components/Button';
import { PRIVACY_URL, SUPPORT_EMAIL } from '@/config';
import { haptics } from '@/native/haptics';
import { pushAvailable } from '@/native/push';
import { useSession } from '@/state/session';
import { colors, fonts, radius, space, TOUCH, type } from '@/theme';

/**
 * Settings. It exists mostly because two things on it are required to ship:
 *
 *   * a PRIVACY POLICY link (Google Play and AdMob both demand one reachable
 *     from inside the app, not only from the store listing)
 *   * ACCOUNT DELETION (Play requires it in-app for any app with accounts)
 *
 * Everything else here is the stuff that had nowhere to live: the push
 * notification switch, sign out, and the version.
 */
export default function Settings() {
  const { token, user, signOut } = useSession();
  const [pushOn, setPushOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [summary, setSummary] = useState<DeleteSummary | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const togglePush = useCallback(
    async (next: boolean) => {
      if (!token) return;
      setPushOn(next); // optimistic: a switch that lags feels broken
      try {
        await api.setPushEnabled(token, next);
      } catch {
        setPushOn(!next);
      }
    },
    [token],
  );

  /** Ask the server what deletion would destroy, then show the confirmation. */
  const startDelete = useCallback(async () => {
    if (!token) return;
    setError(null);
    setBusy(true);
    try {
      setSummary(await api.deletionSummary(token));
      setConfirming(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your account.');
    } finally {
      setBusy(false);
    }
  }, [token]);

  const reallyDelete = useCallback(async () => {
    if (!token || !summary) return;
    setError(null);
    setBusy(true);
    try {
      await api.deleteAccount(token, summary.needsPassword ? password : undefined);
      haptics.success();
      // Clear the local session too, or the app keeps a token for an account
      // that no longer exists and every request 401s.
      await signOut();
      router.replace('/sign-in');
    } catch (e) {
      haptics.warn();
      setError(e instanceof ApiError ? e.message : 'Could not delete your account.');
    } finally {
      setBusy(false);
    }
  }, [token, summary, password, signOut]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Settings' }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.who}>Signed in as {user?.username ?? '…'}</Text>

        {/* --- notifications ------------------------------------------- */}
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={type.label}>Notifications</Text>
              <Text style={styles.sub}>
                Streak reminders and your daily chest. Never between 9pm and 9am.
              </Text>
            </View>
            <Switch
              value={pushOn}
              onValueChange={togglePush}
              disabled={!pushAvailable()}
              trackColor={{ true: colors.accent }}
            />
          </View>
          {!pushAvailable() ? (
            <Text style={styles.note}>Update the app to turn notifications on.</Text>
          ) : null}
        </View>

        {/* --- the legally required links ------------------------------- */}
        <View style={styles.card}>
          <LinkRow label="Privacy policy" onPress={() => void Linking.openURL(PRIVACY_URL)} />
          <View style={styles.divider} />
          <LinkRow
            label="Contact support"
            onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          />
        </View>

        {/* --- account -------------------------------------------------- */}
        <View style={styles.card}>
          <Button
            variant="secondary"
            label="Sign out"
            onPress={() => {
              Alert.alert('Sign out?', 'Your land and coins stay exactly where they are.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', onPress: () => void signOut() },
              ]);
            }}
          />
        </View>

        {/* --- the dangerous one ---------------------------------------- */}
        <View style={[styles.card, styles.danger]}>
          <Text style={type.label}>Delete account</Text>
          <Text style={styles.sub}>
            Everything goes: your land, your coins, your steps and your streak. The squares you own
            become claimable by other players. This cannot be undone.
          </Text>

          {!confirming ? (
            <Button
              variant="secondary"
              label="Delete my account"
              onPress={startDelete}
              busy={busy}
              disabled={busy}
            />
          ) : (
            <>
              {summary ? (
                <Text style={styles.tally}>
                  You are about to delete <Text style={styles.tallyStrong}>{summary.parcels}</Text>{' '}
                  {summary.parcels === 1 ? 'parcel' : 'parcels'},{' '}
                  <Text style={styles.tallyStrong}>{summary.coins.toLocaleString()}</Text> coins and{' '}
                  <Text style={styles.tallyStrong}>{summary.walkPoints.toLocaleString()}</Text> Walk Points.
                </Text>
              ) : null}

              {summary?.needsPassword ? (
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Your password"
                  placeholderTextColor={colors.ink3}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="current-password"
                />
              ) : null}

              <Button
                label="Delete permanently"
                onPress={() => {
                  Alert.alert('Delete everything?', 'There is no way back from this.', [
                    { text: 'Keep my account', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => void reallyDelete() },
                  ]);
                }}
                busy={busy}
                disabled={busy || (summary?.needsPassword === true && password.length === 0)}
              />
              <Pressable onPress={() => { setConfirming(false); setPassword(''); setError(null); }} hitSlop={8}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LinkRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.linkRow} onPress={onPress} accessibilityRole="link">
      <Text style={type.label}>{label}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg, gap: space.lg },
  who: { ...type.caption, marginBottom: -space.sm },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.md, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  sub: { ...type.body, fontSize: 13.5, marginTop: 3 },
  note: { ...type.caption, color: colors.danger },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TOUCH - 8 },
  chevron: { fontFamily: fonts.bold, fontSize: 22, color: colors.ink3 },
  divider: { height: 1, backgroundColor: colors.line },
  danger: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  tally: { ...type.body, fontSize: 13.5, color: colors.ink },
  tallyStrong: { fontFamily: fonts.black, color: colors.danger },
  input: {
    fontFamily: fonts.regular, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.lineStrong,
    borderRadius: radius.md, paddingHorizontal: space.lg, minHeight: TOUCH, fontSize: 16, color: colors.ink,
  },
  cancel: { ...type.caption, textAlign: 'center', paddingVertical: space.sm },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
});
