import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import type { Leaderboard, LeaderboardScope } from '@/api/types';
import { PlayerPicture } from '@/components/PlayerPicture';
import { BoltIcon, TrophyIcon } from '@/components/icons';
import { haptics } from '@/native/haptics';
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

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <FlatList
        data={board?.scope === scope ? board.entries : []}
        keyExtractor={(e) => `${e.rank}-${e.username}`}
        contentContainerStyle={styles.body}
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

            {board && (
              <View style={styles.card}>
                <Text style={type.label}>Top 3 win a land boost</Text>
                <View style={styles.prizes}>
                  {board.prizes.map((p) => (
                    <View key={p.rank} style={[styles.prize, { borderColor: MEDAL[p.rank - 1] }]}>
                      <Text style={[styles.prizePlace, { color: MEDAL[p.rank - 1] }]}>{PLACE[p.rank - 1]}</Text>
                      <View style={styles.prizeX}>
                        <BoltIcon size={14} color={colors.boost} />
                        <Text style={styles.prizeXText}>{p.multiplier}×</Text>
                      </View>
                      <Text style={type.caption}>{days(p.seconds)}</Text>
                    </View>
                  ))}
                </View>
                {!board.prizesActive && board.areaName && (
                  <Text style={[type.caption, { marginTop: space.sm }]}>
                    Prizes start once {board.minWalkers} people walk on this board ({board.walkers} so far). Invite friends!
                  </Text>
                )}
              </View>
            )}

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
              <Text style={styles.name} numberOfLines={1}>
                {item.username}{item.you ? '  (you)' : ''}
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
        <View style={styles.meBar}>
          <Text style={styles.meText}>You · #{board.me.rank}</Text>
          <Text style={[styles.meText, mono]}>{board.me.steps.toLocaleString()} steps</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function Sep() {
  return <View style={{ height: space.sm }} />;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, paddingBottom: space.xxl },
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
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  prizes: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  prize: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: space.md, borderRadius: radius.md, borderWidth: 1.5 },
  prizePlace: { fontFamily: fonts.black, fontSize: 15, includeFontPadding: false },
  prizeX: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  prizeXText: { fontFamily: fonts.black, fontSize: 20, color: colors.boost, includeFontPadding: false },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.card,
    borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: space.md, minHeight: 60, ...shadow.card,
  },
  rowYou: { borderColor: colors.accent, borderWidth: 1.5 },
  rank: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontFamily: fonts.black, fontSize: 14, color: colors.ink2, includeFontPadding: false },
  name: { fontFamily: fonts.heavy, fontSize: 15, color: colors.ink, includeFontPadding: false },
  rowTitle: { fontFamily: fonts.bold, fontSize: 11.5, color: colors.ink3, marginTop: 1, includeFontPadding: false },
  steps: { fontFamily: fonts.black, fontSize: 15, color: colors.ink, includeFontPadding: false },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl },
  error: { ...type.body, color: colors.danger },
  meBar: {
    position: 'absolute', left: space.md, right: space.md, bottom: space.md,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: space.lg,
  },
  meText: { fontFamily: fonts.heavy, fontSize: 15, color: '#FFFFFF', includeFontPadding: false },
});
