import { router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { PlayerPicture } from '@/components/PlayerPicture';
import { BoostSheet } from '@/components/BoostSheet';
import { DailySheet } from '@/components/DailySheet';
import { Button } from '@/components/Button';
import { CountUp } from '@/components/CountUp';
import { BoltIcon, ChestIcon, FlagIcon, PulseIcon } from '@/components/icons';
import { Runner } from '@/components/Runner';
import { DEFAULT_PARCEL_PRICE, DEFAULT_STEPS_PER_WP } from '@/config';
import { useGame, useGameDaily } from '@/state/game';
import { useStepHealth } from '@/hooks/useStepHealth';
import { useScreenSize } from '@/hooks/useScreenSize';
import { useTabBarSpace } from '@/hooks/useTabBarSpace';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, shadow, space, type } from '@/theme';

/** A ring that fills as you close in on your next Walk Point. */
function StepRing({
  progress, children, size = 224, stroke = 14,
}: { progress: number; children: React.ReactNode; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2, circ = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.sunk} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={colors.steps} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={circ * (1 - Math.max(0.02, Math.min(1, progress)))}
          rotation={-90} origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      {children}
    </View>
  );
}

export default function WalkScreen() {
  const { user } = useSession();
  const insets = useSafeAreaInsets();
  const tabBarSpace = useTabBarSpace();
  const screen = useScreenSize();
  const ringSize = screen.s(148);
  const { balance: { balance }, steps: sync } = useGame();
  const [boostOpen, setBoostOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const { daily } = useGameDaily();
  // Step health, re-checked whenever this tab comes back into view - most
  // fixes happen on the setup screen or in another app.
  const { health: stepHealth, refresh: refreshStepHealth } = useStepHealth();
  useFocusEffect(useCallback(() => { void refreshStepHealth(); }, [refreshStepHealth]));
  // The green header wants light status-bar icons; put them back on the way out.
  useFocusEffect(useCallback(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle('dark');
  }, []));
  const stepIssues = stepHealth?.issues ?? 0;
  const questsDone = daily ? daily.quests.filter((q) => q.claim).length : 0;

  const wp = balance?.walkPoints ?? 0;
  const price = balance?.parcelPrice ?? DEFAULT_PARCEL_PRICE;
  const stepsPerWp = balance?.stepsPerWalkPoint ?? DEFAULT_STEPS_PER_WP;
  const toNextParcel = Math.max(0, price - wp);
  const result = sync.lastResult;
  const wpProgress = result ? 1 - result.stepsUntilNextWalkPoint / (result.stepsPerWalkPoint || stepsPerWp) : 0;
  // Steps, not whole Walk Points, so the number goes DOWN with every step
  // walked. Counting in whole WP made it sit still for 100 steps at a time
  // and then jump - which, with the old rising price jumping UP after every
  // claim, testers read as "it increases instead of decreasing".
  const stepsToNext =
    toNextParcel === 0 ? 0 : (toNextParcel - 1) * stepsPerWp + (result?.stepsUntilNextWalkPoint ?? stepsPerWp);
  const bonusReady =
    (balance?.rewards.walkPoints.adsLeftToday ?? 0) > 0 && (balance?.rewards.walkPoints.nextInSeconds ?? 0) === 0;

  const stepsToday = sync.stepsToday ?? 0;
  const capped = stepsToday >= DAILY_STEP_CAP;

  return (
    <View style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: tabBarSpace }]} showsVerticalScrollIndicator={false}>
        {/* THE HEADER (2026-10-03 refresh): one green panel with today's steps
            on a ring (towards the daily step cap) and your Walk Points
            beside it, with the bar to the next one. */}
        <View style={[styles.head, { paddingTop: insets.top + space.md }]}>
          <View style={styles.header}>
            <View>
              <Text style={styles.headDate}>
                {new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase()}
              </Text>
              <Text style={styles.headTitle}>Today</Text>
            </View>
            <View style={styles.headerRight}>
              <Pressable
                onPress={sync.syncByHand}
                style={({ pressed }) => [styles.syncChip, pressed && { opacity: 0.6 }]}
                accessibilityLabel="Sync steps now"
                hitSlop={8}
              >
                <View style={[styles.dot, { backgroundColor: sync.error ? colors.danger : colors.good }]} />
                <Text style={styles.syncChipText}>
                  {sync.syncing
                    ? 'Syncing'
                    : sync.lastSyncedAt
                      ? sync.lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : 'Sync'}
                </Text>
              </Pressable>
              {/* Your profile and badges. The dot means a badge you have not seen. */}
              <Pressable onPress={() => router.push('/profile')} accessibilityLabel="Your profile" hitSlop={8} style={styles.me}>
                <PlayerPicture photoUrl={balance?.photoUrl} username={user?.username} size={40} />
                {!!balance?.unseenBadges && (
                  <View style={styles.avatarDot}>
                    <Text style={styles.avatarDotText}>{balance.unseenBadges}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.heroRow}>
            <View style={styles.ringWell}>
              <StepRing progress={stepsToday / DAILY_STEP_CAP} size={ringSize} stroke={Math.round(ringSize / 12)}>
                <Runner gait={stepsToday ? 'walk' : 'idle'} size={screen.s(30)} avatar={balance?.avatar} />
                <CountUp value={stepsToday} style={[styles.steps, { fontSize: screen.s(26) }, mono]} />
                <Text style={type.caption}>of {DAILY_STEP_CAP.toLocaleString()}</Text>
              </StepRing>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headLabel}>WALK POINTS</Text>
              <CountUp value={wp} style={[styles.headWp, { fontSize: screen.s(40) }, mono]} />
              <Text style={styles.headNext}>
                {capped
                  ? 'Daily steps done. More WP tomorrow!'
                  : result
                    ? `${result.stepsUntilNextWalkPoint.toLocaleString()} steps to the next one`
                    : `Every ${stepsPerWp} steps is one`}
              </Text>
              <View style={styles.headTrack}>
                <View style={[styles.headFill, { width: `${Math.max(3, Math.min(100, wpProgress * 100))}%` }]} />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.content}>
        {/* Next parcel: one row with its bar. */}
        <View style={[styles.card, styles.row]}>
          <View style={[styles.wellSm, { backgroundColor: '#FFF3DC' }]}>
            <FlagIcon size={22} color={colors.claimDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.label}>
              {toNextParcel === 0 ? 'A parcel is ready to claim!' : `Next parcel in ${stepsToNext.toLocaleString()} steps`}
            </Text>
            <View style={[styles.track, { marginTop: 7 }]}>
              <View style={[styles.fill, { width: `${Math.min(100, (wp / Math.max(1, price)) * 100)}%` }]} />
            </View>
          </View>
          <Text style={[styles.barValue, mono]}>{Math.min(wp, price)}/{price}</Text>
        </View>

        {/* Daily chest + Free rewards, side by side. */}
        <View style={styles.pair}>
          <Pressable
            onPress={() => setDailyOpen(true)}
            style={({ pressed }) => [styles.card, styles.tile, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Open today's chest and quests"
          >
            <View style={[styles.wellSm, { backgroundColor: '#FFF3DC' }]}>
              <ChestIcon size={28} open={!daily?.daily.available} />
            </View>
            <Text style={[type.label, { marginTop: space.sm }]}>Daily chest</Text>
            <Text style={type.caption} numberOfLines={2}>
              {daily
                ? `${daily.daily.available ? 'Ready' : `${daily.daily.streak}-day streak`} · ${questsDone}/${daily.quests.length} quests`
                : 'Chest and quests'}
            </Text>
            {!!daily?.claimable && (
              <View style={styles.tileBadge}>
                <Text style={styles.pillText}>{daily.claimable}</Text>
              </View>
            )}
          </Pressable>
          <Pressable
            onPress={() => setBoostOpen(true)}
            style={({ pressed }) => [styles.card, styles.tile, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Open free rewards"
          >
            <View style={[styles.wellSm, { backgroundColor: colors.boostSoft }]}>
              <BoltIcon size={24} />
            </View>
            <Text style={[type.label, { marginTop: space.sm }]}>Free rewards</Text>
            <Text style={type.caption} numberOfLines={2}>{bonusReady ? 'Bonus WP ready' : 'Boosts, scouting, bonus WP'}</Text>
          </Pressable>
        </View>

        {/* STEP HEALTH: one quiet line when all is well; the full card with
            its two buttons only when something needs fixing. */}
        {stepIssues > 0 ? (
          <View style={[styles.card, styles.healthCard]}>
            <View style={styles.row}>
              <View style={[styles.wellSm, { backgroundColor: '#FFF3DC' }]}>
                <PulseIcon size={24} color={colors.claimDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.label}>Steps need setting up</Text>
                <Text style={[type.caption, { marginTop: 2 }]}>
                  {`${stepIssues} thing${stepIssues === 1 ? '' : 's'} to fix so every step counts, even with the app closed.`}
                </Text>
              </View>
            </View>
            <View style={styles.row}>
              <Button label="Sync steps" onPress={sync.syncByHand} variant="secondary" busy={sync.syncing} style={{ flex: 1 }} />
              <Button label="Fix it" onPress={() => router.push('/step-setup')} variant="primary" style={{ flex: 1 }} />
            </View>
          </View>
        ) : (
          <Pressable
            onPress={() => router.push('/step-setup')}
            style={({ pressed }) => [styles.card, styles.row, styles.healthLine, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel="Step setup"
          >
            <View style={[styles.dot, { backgroundColor: colors.steps, width: 10, height: 10, borderRadius: 5 }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.healthTitle} numberOfLines={1}>
                {stepHealth?.sources?.length
                  ? `Steps from ${stepHealth.sources.slice(0, 2).map((x) => x.name).join(' + ')}`
                  : Platform.OS === 'ios'
                    ? 'Steps from your iPhone'
                    : sync.health === 'ready'
                      ? 'Steps from Health Connect'
                      : 'Steps counted while the app is open'}
              </Text>
              <Text style={type.caption}>All set · counting with the app closed</Text>
            </View>
            <Text style={styles.healthLink}>Setup ›</Text>
          </Pressable>
        )}

        {sync.available === false && (
          <Note tone="warn">{"Step counting isn't available, or motion access is off. Walk Points need it."}</Note>
        )}
        {result && result.stepsRejected > 0 && (
          // Neutral wording on purpose: most refusals are honest phones
          // double-counting, not cheats, and an accusation drives people off.
          <Note>
            {`${result.stepsRejected.toLocaleString()} steps weren't counted: `}
            {result.limit === 'DAILY_LIMIT' ? `you've hit the ${DAILY_STEP_CAP.toLocaleString()}-step daily limit.` : 'more than can be walked since your last sync.'}
          </Note>
        )}
        {!!result?.referralBonusPaid && (
          <Note>{`You walked enough to thank your inviter: they got +${result.referralBonusPaid} WP.`}</Note>
        )}
        {sync.error && <Note tone="warn">{sync.error}</Note>}

        </View>
      </ScrollView>
      <BoostSheet visible={boostOpen} onClose={() => setBoostOpen(false)} />
      <DailySheet visible={dailyOpen} onClose={() => setDailyOpen(false)} />
    </View>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <View style={[styles.note, tone === 'warn' && { borderLeftColor: colors.danger, backgroundColor: colors.dangerSoft }]}>
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

/**
 * Steps that earn per local day. Must match MAX_STEPS_PER_DAY in the backend's
 * rules.ts. Display only - the server is what enforces it.
 */
const DAILY_STEP_CAP = 15_000;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { gap: space.md },
  content: { paddingHorizontal: space.lg, gap: space.md },
  head: {
    backgroundColor: colors.accent, paddingHorizontal: space.lg, paddingBottom: space.xl,
    borderBottomLeftRadius: 30, borderBottomRightRadius: 30, gap: space.lg,
  },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headDate: { fontFamily: fonts.heavy, fontSize: 12, letterSpacing: 1.2, color: 'rgba(255,255,255,0.72)', includeFontPadding: false },
  headTitle: { fontFamily: fonts.black, fontSize: 30, letterSpacing: -0.8, color: '#FFFFFF', marginTop: 2, includeFontPadding: false },
  me: { borderRadius: 24, borderWidth: 2, borderColor: colors.claimHi },
  avatarDot: {
    position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.accent,
  },
  avatarDotText: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 11, includeFontPadding: false },
  syncChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 34, paddingHorizontal: 12,
    borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.14)',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  syncChipText: { fontFamily: fonts.heavy, fontSize: 13, color: '#FFFFFF', includeFontPadding: false },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  ringWell: { backgroundColor: colors.card, borderRadius: 80, padding: 2 },
  steps: { fontSize: 26, fontFamily: fonts.black, letterSpacing: -0.8, color: colors.ink, includeFontPadding: false },
  headLabel: { fontFamily: fonts.heavy, fontSize: 12, letterSpacing: 1.2, color: 'rgba(255,255,255,0.72)', includeFontPadding: false },
  headWp: { fontFamily: fonts.black, fontSize: 40, letterSpacing: -1, color: '#FFFFFF', includeFontPadding: false },
  headNext: { fontFamily: fonts.bold, fontSize: 13, color: 'rgba(255,255,255,0.88)', marginTop: 4, includeFontPadding: false },
  headTrack: { height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 8, overflow: 'hidden' },
  headFill: { height: '100%', borderRadius: 4, backgroundColor: colors.claimHi },
  pair: { flexDirection: 'row', gap: space.md },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  tile: { flex: 1, padding: space.md + 2 },
  tileBadge: {
    position: 'absolute', top: space.md, right: space.md, minWidth: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  healthCard: { gap: space.md, borderColor: colors.accentHi },
  healthLine: { paddingVertical: space.md },
  healthTitle: { fontFamily: fonts.heavy, fontSize: 14, color: colors.ink, includeFontPadding: false },
  healthLink: { fontFamily: fonts.heavy, fontSize: 13, color: colors.accent, includeFontPadding: false },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  wellSm: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  pillText: { color: '#FFFFFF', fontFamily: fonts.heavy, fontSize: 12, includeFontPadding: false },
  barValue: { fontSize: 13, fontFamily: fonts.heavy, color: colors.ink2, includeFontPadding: false },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.sunk, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: colors.claim },
  note: {
    borderLeftWidth: 3, borderLeftColor: colors.accent, backgroundColor: colors.accentSoft,
    paddingHorizontal: space.md, paddingVertical: space.sm + 2, borderRadius: 8,
  },
  noteText: { fontFamily: fonts.medium, color: colors.ink2, fontSize: 13.5, lineHeight: 19 },
  signOut: { alignItems: 'center', paddingVertical: space.md, minHeight: 44, justifyContent: 'center' },
  signOutText: { color: colors.ink3, fontSize: 13, fontFamily: fonts.medium },
});
