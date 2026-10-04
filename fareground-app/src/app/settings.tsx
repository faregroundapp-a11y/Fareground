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
import { prefsAtLaunch, setPref, usePrefs, type ThemePref, type Units } from '@/state/prefs';
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
              trackColor={{ true: colors.accentText }}
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

        {/* --- display (2026-10-04) -------------------------------------- */}
        <DisplaySettings />

        {/* --- password (2026-10-04) ------------------------------------- */}
        <ChangePassword />

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
  choice: { flexDirection: 'row', gap: 4, backgroundColor: colors.sunk, borderRadius: radius.md, padding: 4, marginTop: space.sm },
  choiceItem: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  choiceOn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  choiceText: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.ink3 },
  choiceTextOn: { color: colors.ink },
  error: { fontFamily: fonts.medium, fontSize: 13, color: colors.danger },
});

/**
 * Change your password. A Google-only account has no current one, so the
 * server lets it set a first password without - which is also how such a
 * player gets an email + password sign-in.
 */
function ChangePassword() {
  const { token } = useSession();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);

  async function save() {
    if (!token || busy || next.length < 8) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.changePassword(token, current || undefined, next);
      haptics.success();
      setMsg({ text: 'Password changed.', good: true });
      setCurrent('');
      setNext('');
      setOpen(false);
    } catch (e) {
      haptics.warn();
      setMsg({ text: e instanceof ApiError ? e.message : 'Could not change your password.', good: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={type.label}>Password</Text>
          <Text style={styles.sub}>Change the password you sign in with.</Text>
        </View>
        {!open && <Button variant="secondary" label="Change" onPress={() => { setOpen(true); setMsg(null); }} />}
      </View>
      {open && (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <TextInput
            style={styles.input}
            value={current}
            onChangeText={setCurrent}
            placeholder="Current password (leave empty if you use Google)"
            placeholderTextColor={colors.ink3}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="current-password"
          />
          <TextInput
            style={styles.input}
            value={next}
            onChangeText={setNext}
            placeholder="New password (at least 8 characters)"
            placeholderTextColor={colors.ink3}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
          />
          <Button label="Save new password" onPress={save} busy={busy} disabled={busy || next.length < 8} />
          <Pressable onPress={() => setOpen(false)} hitSlop={8}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      )}
      {msg && <Text style={[styles.sub, { marginTop: space.sm, color: msg.good ? colors.goodInk : colors.danger }]}>{msg.text}</Text>}
    </View>
  );
}

/** Distance units and light / dark theme. */
function DisplaySettings() {
  const prefs = usePrefs();
  const themeChanged = prefs.theme !== prefsAtLaunch.theme;
  return (
    <View style={styles.card}>
      <Text style={type.label}>Distances</Text>
      <Choice<Units>
        value={prefs.units}
        options={[{ value: 'metric', label: 'Metres & km' }, { value: 'imperial', label: 'Feet & miles' }]}
        onChange={(v) => setPref('units', v)}
      />
      <Text style={[type.label, { marginTop: space.lg }]}>Theme</Text>
      <Choice<ThemePref>
        value={prefs.theme}
        options={[{ value: 'system', label: 'Phone' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
        onChange={(v) => setPref('theme', v)}
      />
      <Text style={[styles.sub, { marginTop: space.sm }]}>
        {themeChanged
          ? 'Close and reopen Fareground to switch the theme.'
          : '"Phone" follows your phone\'s light or dark setting.'}
      </Text>
    </View>
  );
}

/** A row of pill buttons, one selected. */
function Choice<T extends string>({
  value, options, onChange,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.choice}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => { haptics.tap(); onChange(o.value); }}
            style={[styles.choiceItem, on && styles.choiceOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
