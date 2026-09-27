import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { PlayerPicture } from '@/components/PlayerPicture';
import { BoostSheet } from '@/components/BoostSheet';
import { DailySheet } from '@/components/DailySheet';
import { Button } from '@/components/Button';
import { CountUp } from '@/components/CountUp';
import { BoltIcon, ChestIcon, FlagIcon, PulseIcon, StepsIcon } from '@/components/icons';
import { Runner } from '@/components/Runner';
import { DEFAULT_PARCEL_PRICE, DEFAULT_STEPS_PER_WP } from '@/config';
import { useGame, useGameDaily } from '@/state/game';
import { openHealthConnect } from '@/native/healthSteps';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, shadow, space, type } from '@/theme';

/** A ring that fills as you close in on your next Walk Point. */
function StepRing({ progress, children }: { progress: number; children: React.ReactNode }) {
  const size = 224, stroke = 14, r = (size - stroke) / 2, circ = 2 * Math.PI * r;
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
  const { balance: { balance }, steps: sync } = useGame();
  const [boostOpen, setBoostOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const { daily } = useGameDaily();
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
  const bonusLeft = balance?.rewards.walkPoints.adsLeftToday ?? 0;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={type.overline}>
              {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()}
            </Text>
            <Text style={[type.display, { marginTop: 2 }]}>Today</Text>
          </View>
          <View style={styles.headerRight}>
            <Pressable
              onPress={sync.syncByHand}
              style={({ pressed }) => [styles.syncChip, pressed && { opacity: 0.6 }]}
              accessibilityLabel="Sync steps now"
              hitSlop={8}
            >
              <View style={[styles.dot, { backgroundColor: sync.error ? colors.danger : colors.steps }]} />
              <Text style={styles.syncChipText}>
                {sync.lastSyncedAt ? sync.lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Sync'}
              </Text>
            </Pressable>
            {/* Your profile and badges. The dot means a badge you have not seen. */}
            <Pressable onPress={() => router.push('/profile')} accessibilityLabel="Your profile" hitSlop={8}>
              <PlayerPicture photoUrl={balance?.photoUrl} username={user?.username} size={44} />
              {!!balance?.unseenBadges && (
                <View style={styles.avatarDot}>
                  <Text style={styles.avatarDotText}>{balance.unseenBadges}</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>

        <View style={styles.hero}>
          <StepRing progress={wpProgress}>
            <Runner gait={sync.stepsToday ? 'walk' : 'idle'} size={46} />
            <CountUp value={sync.stepsToday ?? 0} style={[styles.steps, mono]} />
            <Text style={type.caption}>steps today</Text>
          </StepRing>
          <Text style={styles.nextWp}>
            {(sync.stepsToday ?? 0) >= DAILY_STEP_CAP
              ? `You've hit today's ${DAILY_STEP_CAP.toLocaleString()} steps. More WP tomorrow!`
              : result
                ? `${result.stepsUntilNextWalkPoint.toLocaleString()} steps to your next Walk Point`
                : `Every ${stepsPerWp} steps is a Walk Point`}
          </Text>
        </View>

        {/* Android: steps walked with the app closed come from Health Connect. */}
        {Platform.OS === 'android' && sync.health !== 'ready' && sync.health !== 'unsupported' && (
          <View style={[styles.card, styles.healthCard]}>
            <View style={styles.row}>
              <View style={[styles.well, { backgroundColor: colors.accentSoft }]}>
                <PulseIcon size={24} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.headline}>Count every step</Text>
                <Text style={[type.caption, { marginTop: 2 }]}>
                  {sync.health === 'not-installed'
                    ? 'Install Health Connect so steps count even when Fareground is closed.'
                    : 'Connect Health Connect so steps count even when Fareground is closed.'}
                </Text>
              </View>
            </View>
            <Button
              label={sync.health === 'not-installed' ? 'Get Health Connect' : 'Connect'}
              onPress={sync.connectHealth}
              variant="primary"
            />
          </View>
        )}

        {/* Android: connected, but nothing is WRITING steps into Health
            Connect - the usual reason steps "only count with the app open". */}
        {Platform.OS === 'android' && sync.health === 'ready' && sync.sources?.weekSteps === 0 && (
          <View style={[styles.card, styles.healthCard]}>
            <View style={styles.row}>
              <View style={[styles.well, { backgroundColor: colors.accentSoft }]}>
                <PulseIcon size={24} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.headline}>No app is sending steps yet</Text>
                <Text style={[type.caption, { marginTop: 2 }]}>
                  Health Connect is on, but nothing has written steps to it this week, so steps only count while
                  Fareground is open. Samsung phones: open Samsung Health, then Settings, then Health Connect, and allow
                  Steps. Other phones: turn on step counting in Google Fit or your phone&apos;s health app.
                </Text>
              </View>
            </View>
            <Button label="Open Health Connect" onPress={openHealthConnect} variant="primary" />
          </View>
        )}

        {/* Where steps come from, and a button that syncs right now. */}
        <View style={[styles.card, styles.row]}>
          <View style={{ flex: 1 }}>
            <Text style={type.label}>
              {Platform.OS === 'ios'
                ? "Steps from your iPhone's motion history"
                : sync.sources?.names.length
                  ? `Steps from ${sync.sources.names.join(' + ')} ✓`
                  : sync.health === 'ready'
                    ? 'Steps from Health Connect'
                    : 'Steps counted while the app is open'}
            </Text>
            <Text style={[type.caption, { marginTop: 2 }]}>
              {sync.lastSyncedAt
                ? `Last synced ${sync.lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Not synced yet'}
            </Text>
          </View>
          <Button label="Sync steps" onPress={sync.syncByHand} variant="secondary" busy={sync.syncing} />
        </View>

        {sync.available === false && (
          <Note tone="warn">{"Step counting isn't available, or motion access is off. Walk Points need it."}</Note>
        )}
        {result && result.stepsRejected > 0 && (
          // Neutral wording on purpose: most refusals are honest phones
          // double-counting, not cheats, and an accusation drives people off.
          <Note>
            {`${result.stepsRejected.toLocaleString()} steps weren't counted: `}
            {result.limit === 'DAILY_LIMIT' ? "you've hit the 60,000-step daily limit." : 'more than can be walked since your last sync.'}
          </Note>
        )}
        {!!result?.referralBonusPaid && (
          <Note>{`You walked enough to thank your inviter: they got +${result.referralBonusPaid} WP.`}</Note>
        )}
        {sync.error && <Note tone="warn">{sync.error}</Note>}

        <View style={styles.pair}>
          <View style={[styles.card, styles.half]}>
            <StepsIcon size={24} />
            <CountUp value={wp} style={[styles.cardValue, mono]} />
            <Text style={type.caption}>Walk Points</Text>
          </View>
          <View style={[styles.card, styles.half]}>
            <FlagIcon size={24} color={colors.claimDeep} />
            <Text style={[styles.cardValue, mono]}>
              {toNextParcel === 0 ? 'Ready!' : stepsToNext.toLocaleString()}
            </Text>
            <Text style={type.caption}>{toNextParcel === 0 ? 'claim on the map' : 'steps to next parcel'}</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.barHead}>
            <Text style={type.label}>Next parcel</Text>
            <Text style={[styles.barValue, mono]}>{Math.min(wp, price)} / {price} WP</Text>
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, (wp / price) * 100)}%` }]} />
          </View>
          <Text style={[type.caption, { marginTop: space.sm }]}>
            This one is {(price * stepsPerWp).toLocaleString()} steps and an ad. Land costs 1 WP more for every 10
            parcels you own.
          </Text>
        </View>

        {/* Daily chest + quests. */}
        <Pressable
          onPress={() => setDailyOpen(true)}
          style={({ pressed }) => [styles.card, styles.row, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel="Open today's chest and quests"
        >
          <View style={[styles.well, { backgroundColor: '#FFF3DC' }]}>
            <ChestIcon size={28} open={!daily?.daily.available} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={type.headline}>Today</Text>
            <Text style={[type.caption, { marginTop: 2 }]}>
              {daily
                ? `${daily.daily.available ? 'Chest ready' : `${daily.daily.streak}-day streak`} · ${questsDone}/${daily.quests.length} quests done`
                : 'Daily chest and quests'}
            </Text>
          </View>
          {!!daily?.claimable && (
            <View style={styles.pill}>
              <Text style={styles.pillText}>{daily.claimable} ready</Text>
            </View>
          )}
        </Pressable>

        {/* Rewarded ads: always the player's choice. */}
        <View style={[styles.card, { gap: space.md }]}>
          <View style={styles.row}>
            <View style={[styles.well, { backgroundColor: colors.boostSoft }]}>
              <BoltIcon size={24} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.headline}>Free rewards</Text>
              <Text style={[type.caption, { marginTop: 2 }]}>
                Double coins, bonus WP, collect early or scout further{bonusLeft ? ` · ${bonusLeft} bonus WP left today` : ''}.
              </Text>
            </View>
          </View>
          <Button label="See free rewards" variant="boost" onPress={() => setBoostOpen(true)} />
        </View>

      </ScrollView>
      <BoostSheet visible={boostOpen} onClose={() => setBoostOpen(false)} />
      <DailySheet visible={dailyOpen} onClose={() => setDailyOpen(false)} />
    </SafeAreaView>
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
  body: { padding: space.xl, paddingBottom: space.xxl, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  avatarDot: {
    position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
    backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg,
  },
  avatarDotText: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 11, includeFontPadding: false },
  syncChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: 36, paddingHorizontal: 13,
    borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  syncChipText: { fontFamily: fonts.bold, fontSize: 13, color: colors.ink2, includeFontPadding: false },
  hero: { alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  steps: { fontSize: 46, fontFamily: fonts.black, letterSpacing: -1.5, color: colors.ink, marginTop: 2, includeFontPadding: false },
  nextWp: { ...type.body, fontFamily: fonts.medium, textAlign: 'center' },
  pair: { flexDirection: 'row', gap: space.md },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  healthCard: { gap: space.md, borderColor: colors.accentHi },
  half: { flex: 1, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  well: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  pill: { backgroundColor: colors.danger, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  pillText: { color: '#FFFFFF', fontFamily: fonts.heavy, fontSize: 12, includeFontPadding: false },
  cardValue: { fontSize: 26, fontFamily: fonts.black, color: colors.ink, marginTop: 6, letterSpacing: -0.5, includeFontPadding: false },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.sm + 2 },
  barValue: { fontSize: 14, fontFamily: fonts.heavy, color: colors.ink2, includeFontPadding: false },
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
