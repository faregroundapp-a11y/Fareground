import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import { Stack } from 'expo-router';
import { Pedometer } from 'expo-sensors';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { CheckIcon } from '@/components/icons';
import { WatchGuide } from '@/components/WatchGuide';
import { ago, useStepHealth, type StepHealth } from '@/hooks/useStepHealth';
import { requestAppleHealth } from '@/native/appleHealth';
import {
  androidRelease,
  installHealthConnect,
  openAndroidApp,
  openHealthConnect,
  requestBackgroundPermission,
  requestHealthPermission,
  updateHealthConnect,
} from '@/native/healthSteps';
import { notifyStepSetupChanged } from '@/native/stepEvents';
import { runStepSync } from '@/hooks/useStepSync';
import { useSession } from '@/state/session';
import { colors, fonts, radius, shadow, space, type } from '@/theme';

/**
 * STEP SETUP - every step counted, on any phone, with any watch.
 *
 * A checklist, top to bottom in the order things have to happen, where each
 * row says in plain words whether it is done and offers the ONE button that
 * does it. It replaces the bare Health Connect dialog testers used to meet on
 * first launch (and say no to), and the scattered cards on the Walk tab.
 *
 * It re-checks itself whenever the app comes back to the front, because
 * nearly every fix happens in another app - installing Health Connect,
 * switching on Samsung Health's link, syncing a Fitbit - and the player
 * should come back to a green tick without pressing anything.
 *
 * Older phones are handled honestly: below Android 9 there is no Health
 * Connect, so the screen says steps count while Fareground is open, rather
 * than offering buttons that cannot work.
 */
type RowState = 'done' | 'todo' | 'info';

const BG_TRIED_KEY = 'fareground.bgPermissionTried';

export default function StepSetup() {
  const { health, refresh } = useStepHealth();
  // This screen sits OUTSIDE the tabs, so it cannot use the game's step state
  // (GameProvider lives in the tabs layout). Reading it here threw on every
  // open and crashed the 2026-09-27 build right after login. It runs its own
  // sync instead - the same one the tabs run - and tells them it happened.
  const { token } = useSession();
  const [syncing, setSyncing] = useState(false);
  const [seen, setSeen] = useState<{ steps: number | null; at: Date | null }>({ steps: null, at: null });
  async function syncNow() {
    if (!token) return;
    setSyncing(true);
    try {
      const { total } = await runStepSync(token, {
        onTotal: (t) => setSeen((s) => ({ ...s, steps: t })),
      });
      setSeen({ steps: total, at: new Date() });
    } catch {
      // Offline or the server asleep: the batch is kept and retried.
    } finally {
      setSyncing(false);
      notifyStepSetupChanged();
    }
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [permissionRefused, setPermissionRefused] = useState(false);
  const [bgTried, setBgTried] = useState(false);
  const [phoneHelp, setPhoneHelp] = useState(false);
  const scroller = useRef<ScrollView>(null);

  // Remember a background-permission request the phone refused, so the row
  // explains rather than offering the same dead button every visit.
  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(BG_TRIED_KEY)
      .then((v) => { if (live && v === '1') setBgTried(true); })
      .catch(() => undefined);
    return () => { live = false; };
  }, []);

  /** Run a fix, then look again and tell the step sync. */
  async function act(key: string, fix: () => Promise<unknown> | unknown) {
    setBusy(key);
    try {
      await fix();
    } finally {
      setBusy(null);
      await refresh();
      notifyStepSetupChanged();
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: 'Step setup' }} />
      <ScrollView ref={scroller} contentContainerStyle={styles.body}>
        <Summary health={health} />

        {health?.platform === 'ios' && (
          <>
            <Row
              state={health.canRead ? 'done' : 'todo'}
              title="Count your iPhone's steps"
              detail={
                health.canRead
                  ? 'Fareground can read the steps your iPhone counts - even with the app closed.'
                  : 'Allow Motion & Fitness so Fareground can count the steps your iPhone feels.'
              }
              action={
                health.canRead
                  ? null
                  : {
                      label: 'Allow motion',
                      busy: busy === 'motion',
                      onPress: () =>
                        act('motion', async () => {
                          const r = await Pedometer.requestPermissionsAsync();
                          if (!r.granted) await Linking.openSettings();
                        }),
                    }
              }
            />
            {health.appleHealth ? (
              <Row
                state={health.appleHealthAsked ? 'done' : 'todo'}
                title="Connect Apple Health"
                detail={
                  health.appleHealthAsked
                    ? 'Steps from your Apple Watch and other trackers count too. Missing some? Open the Health app, tap your picture, then Apps, then Fareground, and turn on Steps.'
                    : 'So steps from an Apple Watch, Garmin, Oura or any tracker that saves to Apple Health count too.'
                }
                action={
                  health.appleHealthAsked
                    ? { label: 'Open the Health app', variant: 'secondary', onPress: () => void Linking.openURL('x-apple-health://') }
                    : { label: 'Connect Apple Health', busy: busy === 'apple', onPress: () => act('apple', requestAppleHealth) }
                }
              />
            ) : (
              <Row
                state="info"
                title="Watches and trackers"
                detail="Update Fareground to count steps from an Apple Watch and other trackers."
              />
            )}
          </>
        )}

        {health?.platform === 'android' && <AndroidRows health={health} busy={busy} act={act}
          permissionRefused={permissionRefused} setPermissionRefused={setPermissionRefused}
          bgTried={bgTried} setBgTried={setBgTried} phoneHelp={phoneHelp} setPhoneHelp={setPhoneHelp}
          onWatch={() => scroller.current?.scrollToEnd({ animated: true })} />}

        {/* Who is counting today. */}
        {health?.sources && health.sources.length > 0 && (
          <View style={styles.card}>
            <Text style={type.label}>Counting your steps today</Text>
            {health.sources.map((s) => (
              <View key={s.id} style={styles.sourceRow}>
                <Text style={[type.body, { flex: 1 }]} numberOfLines={1}>
                  {s.gadget ? '⌚ ' : '📱 '}
                  {s.name}
                </Text>
                <Text style={[type.caption, styles.mono]}>
                  {s.steps.toLocaleString()}
                  {s.lastUpdate ? ` · ${ago(s.lastUpdate)}` : ''}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Test it. */}
        <View style={styles.card}>
          <Text style={type.label}>Check it works</Text>
          <Text style={[type.caption, { marginTop: 2 }]}>
            {seen.steps !== null
              ? `Fareground sees ${seen.steps.toLocaleString()} steps today.`
              : 'Tap below and Fareground will fetch your steps now.'}
            {seen.at ? ` Synced ${seen.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''}
          </Text>
          <Button label="Sync steps now" variant="primary" busy={syncing} onPress={() => void act('sync', syncNow)} />
        </View>

        {/* Watches and bands. */}
        <View style={styles.card}>
          <Text style={type.label}>Use a watch, band or ring</Text>
          <Text style={[type.caption, { marginTop: 2, marginBottom: space.sm }]}>
            {Platform.OS === 'ios'
              ? 'Most trackers save steps to Apple Health, and Fareground reads them from there. Pick yours:'
              : 'Most trackers share steps through Health Connect, and Fareground reads them from there. Pick yours:'}
          </Text>
          <WatchGuide />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AndroidRows({
  health,
  busy,
  act,
  permissionRefused,
  setPermissionRefused,
  bgTried,
  setBgTried,
  phoneHelp,
  setPhoneHelp,
  onWatch,
}: {
  health: StepHealth;
  busy: string | null;
  act: (key: string, fix: () => Promise<unknown> | unknown) => Promise<void>;
  permissionRefused: boolean;
  setPermissionRefused: (v: boolean) => void;
  bgTried: boolean;
  setBgTried: (v: boolean) => void;
  phoneHelp: boolean;
  setPhoneHelp: (v: boolean) => void;
  onWatch: () => void;
}) {
  const { hc } = health;
  const samsung = /samsung/i.test(Device.manufacturer ?? '');

  // 1. Health Connect itself.
  const hcRow =
    hc === 'too-old' ? (
      <Row
        state="info"
        title="Steps count while Fareground is open"
        detail={`Your phone runs Android ${androidRelease()}. Health Connect, which lets steps arrive with the app closed, needs Android 9 or newer. Fareground still counts every step while it is open - keep it open on walks.`}
      />
    ) : hc === 'not-installed' ? (
      <Row
        state="todo"
        title="Install Health Connect"
        detail="Google's free app that lets your phone, watch and fitness apps share steps. Install it, then come back here."
        action={{ label: 'Install Health Connect', onPress: installHealthConnect }}
      />
    ) : hc === 'needs-update' ? (
      <Row
        state="todo"
        title="Update Health Connect"
        detail="Your Health Connect is too old for Fareground. Update it, then come back here."
        action={{ label: 'Update Health Connect', onPress: updateHealthConnect }}
      />
    ) : hc === 'unsupported' ? (
      <Row state="info" title="Update Fareground" detail="This version cannot read steps with the app closed. Update to the latest build." />
    ) : (
      <Row state="done" title="Health Connect is ready" detail="Built into your phone, and up to date." />
    );

  return (
    <>
      {hcRow}

      {/* 2. Permission to read steps. */}
      {hc === 'available' && (
        <Row
          state={health.canRead ? 'done' : 'todo'}
          title="Let Fareground read your steps"
          detail={
            health.canRead
              ? 'Fareground reads your step count - and nothing else.'
              : permissionRefused
                ? 'No window? Android stops asking after two "no"s. Open Health Connect, tap App permissions, then Fareground, and turn on Steps.'
                : 'Fareground only reads your step count - nothing else in Health Connect.'
          }
          action={
            health.canRead
              ? null
              : permissionRefused
                ? { label: 'Open Health Connect', onPress: openHealthConnect }
                : {
                    label: 'Allow steps',
                    busy: busy === 'perm',
                    onPress: () =>
                      act('perm', async () => {
                        if (!(await requestHealthPermission())) setPermissionRefused(true);
                      }),
                  }
          }
        />
      )}

      {/* 3. Reading in the background. */}
      {health.canRead && (
        <Row
          state={health.background ? 'done' : bgTried ? 'info' : 'todo'}
          title={health.background ? 'Steps arrive with the app closed' : 'Read steps in the background'}
          detail={
            health.background
              ? 'Fareground picks up new steps every so often, even when it is closed.'
              : bgTried
                ? 'Your phone only lets apps read steps while they are open. Nothing is lost - every step since midnight arrives the moment you open Fareground.'
                : 'So new steps arrive without opening Fareground.'
          }
          action={
            health.background || bgTried
              ? null
              : {
                  label: 'Allow in background',
                  busy: busy === 'bg',
                  onPress: () =>
                    act('bg', async () => {
                      const ok = await requestBackgroundPermission();
                      if (!ok) {
                        setBgTried(true);
                        await AsyncStorage.setItem(BG_TRIED_KEY, '1').catch(() => undefined);
                      }
                    }),
                }
          }
        />
      )}

      {/* 4. Something writing steps. */}
      {health.canRead && health.sources !== null && health.sources.length === 0 && (
        <Row
          state="todo"
          title="Nothing is counting your steps yet"
          detail="Health Connect is on, but no app has saved any steps to it today. What do you walk with?"
        >
          <View style={styles.choice}>
            <Button label="Just my phone" variant="secondary" onPress={() => setPhoneHelp(!phoneHelp)} style={{ flex: 1 }} />
            <Button label="A watch or band" variant="secondary" onPress={onWatch} style={{ flex: 1 }} />
          </View>
          {phoneHelp && (
            <View style={styles.help}>
              <Text style={type.caption}>
                {samsung
                  ? 'Samsung phones count steps in Samsung Health. Open it, tap the three dots, then Settings, then Health Connect, and allow it to write Steps.'
                  : 'Google Fit counts steps on most phones. Open Google Fit, tap Profile, then the settings cog, and turn on "Sync Fit with Health Connect".'}
              </Text>
              <Button
                label={samsung ? 'Open Samsung Health' : 'Open Google Fit'}
                onPress={() => openAndroidApp(samsung ? 'com.sec.android.app.shealth' : 'com.google.android.apps.fitness')}
              />
            </View>
          )}
        </Row>
      )}

      {/* 5. A watch that has gone quiet. */}
      {health.staleGadget && (
        <Row
          state="todo"
          title={`${health.staleGadget.name} is behind`}
          detail={`It last sent steps ${ago(health.staleGadget.lastUpdate)}. Watch apps only pass steps on when they sync - open it and let it sync, then come back.`}
          action={{ label: `Open ${health.staleGadget.name}`, onPress: () => openAndroidApp(health.staleGadget!.id) }}
        />
      )}

      {/* 6. Two apps counting. */}
      {health.severalWriters && (
        <Row
          state="info"
          title="More than one app counts your steps"
          detail="Health Connect uses the app at the top of its list. If you wear a watch, put its app first: Health Connect, then Data and access, then Steps, then App priority."
          action={{ label: 'Open Health Connect', variant: 'secondary', onPress: openHealthConnect }}
        />
      )}

      {/* 7. Battery saving. */}
      {health.canRead && (
        <Row
          state="info"
          title="Still only updating when you open the app?"
          detail="Some phones pause apps to save battery. Open Fareground's app info, tap Battery, and choose Unrestricted."
          action={{ label: 'Open app info', variant: 'secondary', onPress: () => void Linking.openSettings() }}
        />
      )}
    </>
  );
}

function Summary({ health }: { health: StepHealth | null }) {
  if (!health) return <Text style={type.caption}>Checking your phone…</Text>;
  const ok = health.issues === 0;
  return (
    <View style={[styles.summary, { backgroundColor: ok ? colors.accentSoft : '#FFF3DC' }]}>
      <Text style={styles.summaryTitle}>{ok ? 'All set ✓' : `${health.issues} thing${health.issues === 1 ? '' : 's'} to fix`}</Text>
      <Text style={type.caption}>
        {ok
          ? 'Every step counts, including the ones you walk with Fareground closed.'
          : 'Fix these and every step you walk will count - even with Fareground closed.'}
      </Text>
    </View>
  );
}

function Row({
  state,
  title,
  detail,
  action,
  children,
}: {
  state: RowState;
  title: string;
  detail: string;
  action?: { label: string; onPress: () => void; busy?: boolean; variant?: 'primary' | 'secondary' } | null;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.rowHead}>
        <View
          style={[
            styles.mark,
            state === 'done' && { backgroundColor: colors.accentSoft },
            state === 'todo' && { backgroundColor: colors.claim },
            state === 'info' && { backgroundColor: colors.sunk },
          ]}
        >
          {state === 'done' ? (
            <CheckIcon size={16} />
          ) : (
            <Text style={[styles.markText, state === 'info' && { color: colors.ink3 }]}>{state === 'todo' ? '!' : 'i'}</Text>
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.label}>{title}</Text>
          <Text style={[type.caption, { marginTop: 2 }]}>{detail}</Text>
        </View>
      </View>
      {action && <Button label={action.label} onPress={action.onPress} busy={action.busy} variant={action.variant ?? 'primary'} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, gap: space.md, paddingBottom: space.xxl },
  summary: { borderRadius: radius.lg, padding: space.lg, gap: 4 },
  summaryTitle: { fontFamily: fonts.black, fontSize: 20, color: colors.ink },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.md, ...shadow.card },
  rowHead: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  mark: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  markText: { fontFamily: fonts.black, fontSize: 15, color: colors.claimInk, includeFontPadding: false },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  mono: { fontVariant: ['tabular-nums'] },
  choice: { flexDirection: 'row', gap: space.sm },
  help: { gap: space.sm, backgroundColor: colors.bg, borderRadius: radius.md, padding: space.md },
});
