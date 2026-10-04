import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import type { Leaderboard, LeaderboardScope } from '@/api/types';
import { PlayerPicture } from '@/components/PlayerPicture';
import { BoltIcon, ShareIcon, TrophyIcon } from '@/components/icons';
import { useTabBarSpace } from '@/hooks/useTabBarSpace';
import { haptics } from '@/native/haptics';
import { shareRank } from '@/native/share';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, shadow, space, type } from '@/theme';

const SCOPES: { key: LeaderboardScope; label: string }[] = [
  { key: 'CITY', label: 'City' },
  { key: 'REGION', label: 'Region' },
  { key: 'COUNTRY', label: 'Country' },
  { key: 'WORLD', label: 'World' },
];

const MEDAL = ['#F2B53B', '#AEB7C0', '#C98A5A']; // gold, silver, bronze

/** Badge keys are snake_case; show them as words. */
const titleName = (key: string) => key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const PLACE = ['1st', '2nd', '3rd'];

function timeLeft(iso: string): string {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

const days = (s: number) => `${Math.round(s / 86_400)} day${Math.round(s / 86_400) === 1 ? '' : 's'}`;

/**
 * Weekly step leaderboards by area. The top 3 of every board win a land
 * boost when the week ends (Monday 00:00 UTC).
 */
export default function RanksScreen() {
  const { token } = useSession();
  const [scope, setScope] = useState<LeaderboardScope>('CITY');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (which: LeaderboardScope) => {
      if (!token) return;
      setLoading(true);
      try {
        setBoard(await api.leaderboard(token, which));
        setError(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Could not load the leaderboard.');
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useFocusEffect(useCallback(() => { load(scope); }, [load, scope]));

  const meInList = board?.entries.some((e) => e.you) ?? false;
  const tabBarSpace = useTabBarSpace();

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <FlatList
        data={board?.scope === scope ? board.entries : []}
        keyExtractor={(e) => `${e.rank}-${e.username}`}
        contentContainerStyle={[styles.body, { paddingBottom: tabBarSpace + 56 }]}
        refreshControl={<RefreshControl refreshing={loading && !!board} onRefresh={() => load(scope)} tintColor={colors.accent} />}
        ItemSeparatorComponent={Sep}
        ListHeaderComponent={
          <View style={{ gap: space.md, marginBottom: space.md }}>
            <View>
              <Text style={type.overline}>THIS WEEK{board ? ` · RESETS IN ${timeLeft(board.week.endsAt).toUpperCase()}` : ''}</Text>
              <Text style={[type.display, { marginTop: 2 }]}>Leaderboard</Text>
            </View>

            <View style={styles.segment}>
              {SCOPES.map((s) => (
                <Pressable
                  key={s.key}
                  onPress={() => { haptics.tap(); setScope(s.key); load(s.key); }}
                  style={[styles.segItem, scope === s.key && styles.segOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: scope === s.key }}
                >
                  <Text style={[styles.segText, scope === s.key && styles.segTextOn]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>

            {board?.scope === scope && (
              <Text style={styles.area} numberOfLines={1}>
                {board.areaName ?? (scope === 'WORLD' ? 'World' : 'Finding your area…')}
                {board.areaName ? `  ·  ${board.walkers} walker${board.walkers === 1 ? '' : 's'}` : ''}
              </Text>
            )}

            {board?.lastWeek && (
              <View style={styles.won}>
                <TrophyIcon size={30} color="#FFFFFF" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.wonTitle}>You came {PLACE[board.lastWeek.rank - 1]} last week!</Text>
                  <Text style={styles.wonSub}>
                    {board.lastWeek.areaName} · {board.lastWeek.multiplier}× coins for {days(board.lastWeek.seconds)}
                  </Text>
                </View>
              </View>
            )}

            {board && <PrizePodium board={board} />}

            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => { haptics.tap(); router.push({ pathname: '/player/[username]', params: { username: item.username } }); }}
            style={({ pressed }) => [styles.row, item.you && styles.rowYou, pressed && { opacity: 0.8 }]}
          >
            <View style={[styles.rank, item.rank <= 3 && { backgroundColor: MEDAL[item.rank - 1] }]}>
              <Text style={[styles.rankText, item.rank <= 3 && { color: '#FFFFFF' }]}>{item.rank}</Text>
            </View>
            <PlayerPicture photoUrl={item.photoUrl} username={item.username} size={40} ring={item.rank <= 3 ? MEDAL[item.rank - 1] : undefined} />
            <View style={{ flex: 1 }}>
              {/* No "(you)" suffix: the row already has its own highlight
                  (styles.rowYou), so the brackets were saying twice what the
                  colour says once - and testers read them as a glitch. */}
              <Text style={[styles.name, item.you && styles.nameYou]} numberOfLines={1}>
                {item.username}
              </Text>
              {!!item.title && <Text style={styles.rowTitle} numberOfLines={1}>{titleName(item.title)}</Text>}
            </View>
            <Text style={[styles.steps, mono]}>{item.steps.toLocaleString()}</Text>
          </Pressable>
        )}
        ListEmptyComponent={
          board?.scope === scope && !loading ? (
            <View style={styles.empty}>
              <Text style={type.headline}>{board.areaName ? 'No steps yet this week' : 'Open the map first'}</Text>
              <Text style={[type.body, { textAlign: 'center' }]}>
                {board.areaName
                  ? 'Be the first on the board - every step you sync counts.'
                  : 'Fareground needs to see where you are to put you on your local boards.'}
              </Text>
            </View>
          ) : null
        }
      />

      {board?.scope === scope && board.me.rank && !meInList && (
        <View style={[styles.meBar, { bottom: tabBarSpace - 4 }]}>
          <Text style={styles.meText}>You · #{board.me.rank}</Text>
          <Text style={[styles.meText, mono]}>{board.me.steps.toLocaleString()} steps</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/** Podium order: 2nd on the left, 1st in the middle (tallest), 3rd on the right. */
const PODIUM_ORDER = [2, 1, 3];
const STEP_HEIGHT: Record<number, number> = { 1: 62, 2: 46, 3: 34 };

/**
 * THE PRIZES, REWORKED (2026-10-03). They were three outlined boxes in a row
 * that looked like buttons and said nothing about who was winning. Now it is
 * a podium: the boost each place wins stands on its step, the player in that
 * place right now stands on top, and a line underneath tells you how far you
 * are from a prize - the thing that makes anyone walk a bit further.
 */
function PrizePodium({ board }: { board: Leaderboard }) {
  const byRank = (r: number) => board.entries.find((e) => e.rank === r);
  const third = byRank(3);
  const myRank = board.me.rank;
  const gap = third && myRank && myRank > 3 ? third.steps - board.me.steps + 1 : null;

  return (
    <View style={styles.podiumCard}>
      <View style={styles.podiumHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.podiumTitle}>Weekly prizes</Text>
          <Text style={styles.podiumSub}>{'Top 3 boost their land\'s coins'}</Text>
        </View>
        <View style={styles.endsChip}>
          <Text style={[styles.endsText, mono]}>Ends in {timeLeft(board.week.endsAt)}</Text>
        </View>
      </View>

      <View style={styles.podium}>
        {PODIUM_ORDER.map((rank) => {
          const prize = board.prizes.find((p) => p.rank === rank);
          const holder = byRank(rank);
          const medal = MEDAL[rank - 1];
          return (
            <View key={rank} style={styles.podiumCol}>
              {/* Who is there right now. */}
              <View style={styles.holder}>
                {holder ? (
                  <PlayerPicture photoUrl={holder.photoUrl} username={holder.username} size={rank === 1 ? 46 : 38} ring={medal} />
                ) : (
                  <View style={[styles.emptySeat, { width: rank === 1 ? 46 : 38, height: rank === 1 ? 46 : 38, borderColor: medal }]}>
                    <Text style={styles.emptySeatText}>?</Text>
                  </View>
                )}
                <Text style={styles.holderName} numberOfLines={1}>{holder ? (holder.you ? 'You' : holder.username) : 'Free spot'}</Text>
              </View>
              {/* The prize. */}
              {prize && (
                <View style={styles.prizeTag}>
                  <BoltIcon size={rank === 1 ? 16 : 14} color={colors.boostHi} />
                  <Text style={[styles.prizeX, rank === 1 && styles.prizeXBig]}>{prize.multiplier}×</Text>
                </View>
              )}
              {prize && <Text style={styles.prizeFor}>{days(prize.seconds)}</Text>}
              {/* The step. */}
              <View style={[styles.step, { height: STEP_HEIGHT[rank], backgroundColor: medal }]}>
                <Text style={styles.stepText}>{PLACE[rank - 1]}</Text>
              </View>
            </View>
          );
        })}
      </View>

      {myRank ? (
        <Pressable
          onPress={() => void shareRank(myRank, board.areaName ?? 'the world', board.me.steps)}
          style={({ pressed }) => [styles.shareRank, pressed && { opacity: 0.8 }]}
          accessibilityRole="button"
        >
          <ShareIcon size={16} color="#FFFFFF" />
          <Text style={styles.shareRankText}>Share my rank · #{myRank}</Text>
        </Pressable>
      ) : null}
      <Text style={styles.podiumFoot}>
        {!board.prizesActive && board.areaName
          ? `Prizes start once ${board.minWalkers} people walk on this board (${board.walkers} so far). Invite friends!`
          : myRank && myRank <= 3
            ? `You're in ${PLACE[myRank - 1]} place - hold on to it!`
            : gap !== null
              ? `${gap.toLocaleString()} more steps puts you in the top 3`
              : 'Walk this week to get on the podium'}
      </Text>
    </View>
  );
}

function Sep() {
  return <View style={{ height: space.sm }} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg },
  segment: { flexDirection: 'row', backgroundColor: colors.sunk, borderRadius: radius.md, padding: 4, gap: 4 },
  segItem: { flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  segText: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink3, includeFontPadding: false },
  segTextOn: { color: colors.ink },
  area: { ...type.caption, fontFamily: fonts.bold },
  won: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg,
    borderRadius: radius.lg, backgroundColor: colors.claimDeep,
  },
  wonTitle: { fontFamily: fonts.black, fontSize: 16, color: '#FFFFFF', includeFontPadding: false },
  wonSub: { fontFamily: fonts.medium, fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  podiumCard: {
    backgroundColor: '#1B2622', borderRadius: radius.xl, padding: space.lg, paddingBottom: space.md, gap: space.md,
    ...shadow.float,
  },
  podiumHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  podiumTitle: { fontFamily: fonts.black, fontSize: 18, color: '#FFFFFF', includeFontPadding: false },
  podiumSub: { fontFamily: fonts.bold, fontSize: 12.5, color: 'rgba(255,255,255,0.65)', marginTop: 2, includeFontPadding: false },
  endsChip: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  endsText: { fontFamily: fonts.heavy, fontSize: 12, color: colors.claimHi, includeFontPadding: false },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginTop: space.xs },
  podiumCol: { flex: 1, alignItems: 'center' },
  holder: { alignItems: 'center', gap: 4, marginBottom: 6, maxWidth: '100%' },
  holderName: { fontFamily: fonts.heavy, fontSize: 12, color: '#FFFFFF', maxWidth: 96, includeFontPadding: false },
  emptySeat: { borderRadius: 999, borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  emptySeatText: { fontFamily: fonts.black, fontSize: 16, color: 'rgba(255,255,255,0.5)', includeFontPadding: false },
  prizeTag: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  prizeX: { fontFamily: fonts.black, fontSize: 20, color: '#FFFFFF', includeFontPadding: false },
  prizeXBig: { fontSize: 26 },
  prizeFor: { fontFamily: fonts.bold, fontSize: 11.5, color: 'rgba(255,255,255,0.65)', marginBottom: 6, includeFontPadding: false },
  step: {
    alignSelf: 'stretch', borderTopLeftRadius: 12, borderTopRightRadius: 12, borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
    alignItems: 'center', paddingTop: 8,
  },
  stepText: { fontFamily: fonts.black, fontSize: 15, color: 'rgba(20,32,26,0.75)', includeFontPadding: false },
  shareRank: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, alignSelf: 'center',
    height: 36, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.12)',
  },
  shareRankText: { fontFamily: fonts.heavy, fontSize: 13, color: '#FFFFFF', includeFontPadding: false },
  podiumFoot: { fontFamily: fonts.bold, fontSize: 13, color: 'rgba(255,255,255,0.85)', textAlign: 'center', includeFontPadding: false },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.card,
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: space.md, minHeight: 60, ...shadow.card,
  },
  rowYou: { borderColor: colors.accent, borderWidth: 1.5 },
  rank: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: fonts.black, fontSize: 14, color: colors.ink2, includeFontPadding: false },
  nameYou: { fontFamily: fonts.black },
  name: { fontFamily: fonts.heavy, fontSize: 15, color: colors.ink, includeFontPadding: false },
  rowTitle: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.ink3, marginTop: 1, includeFontPadding: false },
  steps: { fontFamily: fonts.black, fontSize: 15, color: colors.ink, includeFontPadding: false },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl },
  error: { ...type.body, color: colors.danger },
  meBar: {
    position: 'absolute', left: space.md, right: space.md,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: space.lg,
  },
  meText: { fontFamily: fonts.heavy, fontSize: 15, color: '#FFFFFF', includeFontPadding: false },
});
