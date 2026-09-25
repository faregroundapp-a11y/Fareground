import { Redirect } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import { Button } from '@/components/Button';
import { GoogleIcon, CheckIcon, GemIcon, PinIcon } from '@/components/icons';
import { AppIcon } from '@/components/Logo';
import { DEFAULT_PARCEL_PRICE, DEFAULT_STEPS_PER_WP } from '@/config';
import { GoogleSignInCancelled, googleSignInAvailable } from '@/native/googleSignIn';
import { haptics } from '@/native/haptics';
import { useSession } from '@/state/session';
import { colors, fonts, radius, space, TOUCH, type } from '@/theme';

/**
 * The first screen anyone sees.
 *
 * Two things it has to do, in order: say what the game is (nobody types their
 * email for something they cannot picture), and get out of the way.
 *
 * Every rule below MIRRORS the server's registerSchema in auth.routes.ts. It
 * is duplicated on purpose - a round trip to be told "usernames cannot have
 * spaces" is a bad first impression, and the server still enforces all of it.
 * If those rules change, change them here too.
 */
const USERNAME_RE = /^[a-zA-Z0-9_]+$/;
const MIN_USERNAME = 3;
const MIN_PASSWORD = 8;

type Mode = 'in' | 'up';
type Field = 'username' | 'email' | 'password' | 'invite';

/** Invite codes are 4-12 characters, letters and digits. Mirrors the server. */
const INVITE_RE = /^[A-Za-z0-9]{4,12}$/;

export default function SignIn() {
  const { token, signIn, signUp, signInWithGoogle } = useSession();
  const [mode, setMode] = useState<Mode>('in');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [reveal, setReveal] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const inviteRef = useRef<TextInput>(null);

  /**
   * Per-field problems. Only SHOWN once a field has been left, so nobody is
   * told their email is wrong while they are still typing the first letter.
   */
  const problems = useMemo(() => {
    const p: Partial<Record<Field, string>> = {};
    const u = username.trim();
    if (mode === 'up') {
      if (u.length > 0 && u.length < MIN_USERNAME) p.username = `At least ${MIN_USERNAME} characters.`;
      else if (u.length > 32) p.username = 'At most 32 characters.';
      else if (u.length > 0 && !USERNAME_RE.test(u)) p.username = 'Letters, numbers and underscores only.';
    }
    const e = email.trim();
    if (e.length > 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) p.email = "That does not look like an email address.";
    if (mode === 'up' && password.length > 0 && password.length < MIN_PASSWORD) {
      p.password = `At least ${MIN_PASSWORD} characters.`;
    }
    const code = invite.trim();
    if (mode === 'up' && code.length > 0 && !INVITE_RE.test(code)) {
      p.invite = "That code does not look right.";
    }
    return p;
  }, [mode, username, email, password, invite]);

  const complete =
    email.trim().length > 0 &&
    password.length > 0 &&
    (mode === 'in' || (username.trim().length >= MIN_USERNAME && password.length >= MIN_PASSWORD));
  const canSubmit = complete && Object.keys(problems).length === 0;

  if (token) return <Redirect href="/" />;

  function switchTo(next: Mode) {
    if (next === mode) return;
    haptics.tap();
    setMode(next);
    setError(null);
    setTouched({});
  }

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy('email');
    setError(null);
    try {
      if (mode === 'in') {
        await signIn(email.trim(), password);
      } else {
        const fresh = await signUp(username.trim(), email.trim(), password);
        await redeemInvite(fresh);
      }
      haptics.success();
    } catch (e) {
      haptics.warn();
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * Use the invite code, if one was typed.
   *
   * Runs AFTER the account exists, because redeeming needs a token - hence
   * `signUp` handing one back. A bad code must NEVER throw from here: the
   * account is already made and signed in, and failing the whole sign-up over
   * a typo would be absurd. The code stays valid for a week, and the profile
   * screen can still take it.
   */
  async function redeemInvite(freshToken: string) {
    const code = invite.trim().toUpperCase();
    if (!code) return;
    try {
      await api.redeemReferral(freshToken, code);
    } catch (e) {
      // Swallowed on purpose - see above. Worth a console line for debugging
      // an invite that should have worked.
      console.warn('[invite] code not applied:', e instanceof ApiError ? e.message : e);
    }
  }

  async function google() {
    setBusy('google');
    setError(null);
    try {
      await signInWithGoogle();
      haptics.success();
    } catch (e) {
      if (!(e instanceof GoogleSignInCancelled)) {
        haptics.warn();
        setError(e instanceof Error ? e.message : 'Google sign-in failed.');
      }
    } finally {
      setBusy(null);
    }
  }

  const showGoogle = googleSignInAvailable();
  const signingUp = mode === 'up';

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* --- who we are -------------------------------------------- */}
          <View style={styles.hero}>
            <AppIcon size={72} />
            <Text style={styles.mark}>
              Fare<Text style={{ color: colors.accent }}>ground</Text>
            </Text>
            <Text style={styles.lede}>
              Walk the real world. Claim the ground you cover. Every square you take pays you coins, every hour, forever.
            </Text>
          </View>

          {/* --- sign in / create account ------------------------------ */}
          <View style={styles.segment} accessibilityRole="tablist">
            {(['in', 'up'] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => switchTo(m)}
                style={[styles.segmentItem, mode === m && styles.segmentItemOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === m }}
              >
                <Text style={[styles.segmentText, mode === m && styles.segmentTextOn]}>
                  {m === 'in' ? 'Sign in' : 'Create account'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* --- what a new player gets -------------------------------- */}
          {signingUp && (
            <View style={styles.welcome}>
              <View style={styles.welcomeRow}>
                <GemIcon size={18} />
                <Text style={styles.welcomeText}>
                  You start with <Text style={styles.welcomeStrong}>{DEFAULT_PARCEL_PRICE} Walk Points</Text> — enough to
                  claim your first parcel the moment you are outside.
                </Text>
              </View>
              <View style={styles.welcomeRow}>
                <PinIcon size={18} />
                <Text style={styles.welcomeText}>
                  After that, every {DEFAULT_STEPS_PER_WP} steps earns another Walk Point.
                </Text>
              </View>
              <View style={styles.welcomeRow}>
                <CheckIcon size={18} color={colors.accent} />
                <Text style={styles.welcomeText}>
                  Got an invite code from a friend? Put it in below for a{' '}
                  <Text style={styles.welcomeStrong}>head start</Text>.
                </Text>
              </View>
            </View>
          )}

          {showGoogle && (
            <>
              <Pressable
                onPress={google}
                disabled={busy !== null}
                style={({ pressed }) => [
                  styles.google,
                  pressed && { backgroundColor: colors.sunk },
                  busy !== null && { opacity: 0.6 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
              >
                <GoogleIcon size={20} />
                <Text style={styles.googleText}>{busy === 'google' ? 'Signing in…' : 'Continue with Google'}</Text>
              </Pressable>
              <View style={styles.or}>
                <View style={styles.orLine} />
                <Text style={styles.orText}>or with email</Text>
                <View style={styles.orLine} />
              </View>
            </>
          )}

          {signingUp && (
            <LabelledInput
              label="Username"
              hint="How other walkers see you"
              value={username}
              onChangeText={setUsername}
              problem={touched.username ? problems.username : undefined}
              onBlur={() => setTouched((t) => ({ ...t, username: true }))}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
            />
          )}

          <LabelledInput
            ref={emailRef}
            label="Email"
            value={email}
            onChangeText={setEmail}
            problem={touched.email ? problems.email : undefined}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />

          <LabelledInput
            ref={passwordRef}
            label="Password"
            hint={signingUp ? `At least ${MIN_PASSWORD} characters` : undefined}
            value={password}
            onChangeText={setPassword}
            problem={touched.password ? problems.password : undefined}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            secureTextEntry={!reveal}
            autoComplete={signingUp ? 'new-password' : 'current-password'}
            returnKeyType={signingUp ? 'next' : 'go'}
            onSubmitEditing={() => (signingUp ? inviteRef.current?.focus() : submit())}
            accessory={
              <Pressable onPress={() => setReveal((r) => !r)} hitSlop={10} style={styles.reveal}>
                <Text style={styles.revealText}>{reveal ? 'Hide' : 'Show'}</Text>
              </Pressable>
            }
          />

          {signingUp && (
            <LabelledInput
              ref={inviteRef}
              label="Invite code"
              hint="Optional"
              value={invite}
              onChangeText={(t) => setInvite(t.toUpperCase())}
              problem={touched.invite ? problems.invite : undefined}
              onBlur={() => setTouched((t) => ({ ...t, invite: true }))}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              returnKeyType="go"
              onSubmitEditing={submit}
            />
          )}

          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Button
            label={signingUp ? 'Create account' : 'Sign in'}
            onPress={submit}
            busy={busy === 'email'}
            disabled={!canSubmit || busy !== null}
            style={{ marginTop: space.sm }}
          />

          {/* --- what we will ask for, before we ask -------------------- */}
          <View style={styles.perm}>
            <Text style={type.overline}>BEFORE YOU START</Text>
            <PermRow text="Your location, only while the app is open — it is how the map knows which ground is yours to take." />
            <PermRow text="Your step count, which becomes Walk Points." />
            <PermRow text="Neither is ever shared, and your exact position is never stored." />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PermRow({ text }: { text: string }) {
  return (
    <View style={styles.permRow}>
      <CheckIcon size={14} color={colors.accent} />
      <Text style={styles.permText}>{text}</Text>
    </View>
  );
}

type InputProps = React.ComponentProps<typeof TextInput> & {
  label: string;
  hint?: string;
  problem?: string;
  accessory?: React.ReactNode;
};

const LabelledInput = function LabelledInput({ ref, label, hint, problem, accessory, ...input }: InputProps & { ref?: React.Ref<TextInput> }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <View style={styles.fieldHead}>
        <Text style={styles.fieldLabel}>{label.toUpperCase()}</Text>
        {hint && !problem ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      </View>
      <View>
        <TextInput
          ref={ref}
          style={[
            styles.input,
            accessory ? { paddingRight: 68 } : null,
            focused && styles.inputFocused,
            problem ? styles.inputBad : null,
          ]}
          placeholderTextColor={colors.ink3}
          onFocus={() => setFocused(true)}
          {...input}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
        />
        {accessory ? <View style={styles.accessory}>{accessory}</View> : null}
      </View>
      {problem ? <Text style={styles.problem}>{problem}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flexGrow: 1, padding: space.xxl, paddingTop: space.lg, paddingBottom: space.xxl },

  hero: { alignItems: 'center', marginBottom: space.xl },
  mark: {
    fontSize: 38,
    fontFamily: fonts.black,
    letterSpacing: -1.3,
    color: colors.ink,
    marginTop: space.sm,
    includeFontPadding: false,
  },
  lede: { ...type.body, textAlign: 'center', marginTop: space.sm, maxWidth: 330 },

  segment: {
    flexDirection: 'row',
    backgroundColor: colors.sunk,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: space.lg,
  },
  segmentItem: { flex: 1, minHeight: TOUCH - 6, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  segmentItemOn: { backgroundColor: colors.card, ...StyleSheet.flatten({ borderWidth: 1, borderColor: colors.line }) },
  segmentText: { fontFamily: fonts.bold, fontSize: 14.5, color: colors.ink2, includeFontPadding: false },
  segmentTextOn: { color: colors.ink, fontFamily: fonts.heavy },

  welcome: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.md,
    marginBottom: space.lg,
  },
  welcomeRow: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  welcomeText: { flex: 1, fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 19, color: colors.ink2 },
  welcomeStrong: { fontFamily: fonts.bold, color: colors.ink },

  google: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: TOUCH + 4,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.lineStrong,
  },
  googleText: { fontFamily: fonts.heavy, fontSize: 16, color: colors.ink, includeFontPadding: false },
  or: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.lg },
  orLine: { flex: 1, height: 1, backgroundColor: colors.line },
  orText: { ...type.caption },

  field: { marginBottom: space.md + 2 },
  fieldHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  fieldLabel: { ...type.overline },
  fieldHint: { ...type.caption, fontSize: 11.5 },
  input: {
    fontFamily: fonts.regular,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: TOUCH + 4,
    fontSize: 16,
    color: colors.ink,
  },
  inputFocused: { borderColor: colors.accent, borderWidth: 1.5 },
  inputBad: { borderColor: colors.danger, borderWidth: 1.5 },
  accessory: { position: 'absolute', right: space.md, top: 0, bottom: 0, justifyContent: 'center' },
  reveal: { paddingHorizontal: space.sm, paddingVertical: 6 },
  revealText: { fontFamily: fonts.bold, fontSize: 13, color: colors.accent, includeFontPadding: false },
  problem: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.danger, marginTop: 5 },

  errorBox: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.sm },
  errorText: { fontFamily: fonts.medium, color: colors.danger, fontSize: 14, lineHeight: 19 },

  perm: { marginTop: space.xl, borderRadius: radius.md, padding: space.lg, backgroundColor: colors.card, gap: space.sm, borderWidth: 1, borderColor: colors.line },
  permRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  permText: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.ink2 },
});
