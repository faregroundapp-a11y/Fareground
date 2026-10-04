import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import type { AvatarChoice, Profile } from '@/api/types';
import { DraggableSheet, SheetScrollView } from '@/components/DraggableSheet';
import { GearIcon } from '@/components/icons';
import { InviteCard } from '@/components/InviteCard';
import { ProfileView } from '@/components/ProfileView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useTabBarSpace } from '@/hooks/useTabBarSpace';
import { haptics } from '@/native/haptics';
import { useGameBalance } from '@/state/game';
import { useSession } from '@/state/session';
import { colors, fonts, radius, space, TOUCH, type } from '@/theme';

/** Your own profile: level, stats, badges, jersey colour - and sign out. */
export default function ProfileScreen() {
  const { token } = useSession();
  const { refresh: refreshBalance } = useGameBalance();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const tabBarSpace = useTabBarSpace();
  // The two sheets opened from the top-right buttons.
  const [sheet, setSheet] = useState<'invite' | 'friends' | null>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const p = await api.profile(token);
      setProfile(p);
      setError(null);
      // "NEW" tags show this once; tell the server they have been seen so the
      // dot on the Walk tab goes away.
      if (p.badges.some((b) => b.isNew)) {
        await api.badgesSeen(token);
        refreshBalance();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, [token, refreshBalance]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  /** Save a change. Resolves to a problem to show, or null when it worked. */
  async function save(change: { avatar?: AvatarChoice; username?: string; title?: string | null }): Promise<string | null> {
    if (!token) return 'Not signed in.';
    try {
      setProfile(await api.updateProfile(token, change));
      refreshBalance(); // your character on the map changes too
      haptics.success();
      return null;
    } catch (e) {
      haptics.warn();
      return e instanceof ApiError ? e.message : 'Could not save that.';
    }
  }

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: tabBarSpace }]}
        refreshControl={<RefreshControl refreshing={loading && !!profile} onRefresh={load} tintColor={colors.accentText} />}
      >
        <ScreenHeader
          title="Your profile"
          right={
            <Pressable
              style={({ pressed }) => [styles.gear, pressed && { opacity: 0.6 }]}
              onPress={() => { haptics.tap(); router.push('/settings'); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Settings, privacy and account"
            >
              <GearIcon size={24} color={colors.ink} />
            </Pressable>
          }
        />
        {/* Invites and friends live up here with Settings, rather than at the
            bottom under the badges where nobody scrolled to them. One row of
            two: stacked on the right they left half the screen empty. */}
        <View style={styles.sideButtons}>
          <Pressable
            style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
            onPress={() => { haptics.tap(); setSheet('invite'); }}
            accessibilityRole="button"
          >
            <Text style={styles.pillText}>🎁  Invite</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
            onPress={() => { haptics.tap(); setSheet('friends'); }}
            accessibilityRole="button"
          >
            <Text style={styles.pillText}>👥  Friends</Text>
          </Pressable>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
        {profile ? (
          <ProfileView profile={profile} onEdit={save} onReload={load} />
        ) : (
          <View style={styles.loading}><ActivityIndicator color={colors.accentText} /></View>
        )}
      </ScrollView>

      <Modal visible={sheet !== null} transparent animationType="none" onRequestClose={closeSheet} statusBarTranslucent>
        <DraggableSheet
          onClose={closeSheet}
          style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]}
          gripStyle={styles.grip}
        >
          {sheet === 'invite' && (
            <SheetScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <InviteCard />
            </SheetScrollView>
          )}
          {sheet === 'friends' && (
            <View style={styles.soon}>
              <Text style={styles.soonEmoji}>🤫</Text>
              <Text style={type.title}>Coming soon</Text>
              <Text style={[type.caption, { textAlign: 'center' }]}>
                Friends are on the way. Keep it quiet for now.
              </Text>
            </View>
          )}
        </DraggableSheet>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, paddingBottom: space.xxl, gap: space.md },
  loading: { paddingVertical: 60, alignItems: 'center' },
  error: { ...type.body, color: colors.danger },
  gear: {
    width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    marginRight: -8,
  },
  // Side by side under the header, sharing the width equally.
  sideButtons: { flexDirection: 'row', gap: space.sm, marginTop: -space.xs },
  pill: {
    flex: 1, minHeight: TOUCH, paddingHorizontal: space.md, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  pillText: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink, includeFontPadding: false },
  scrim: { flex: 1, backgroundColor: 'rgba(8,14,11,0.55)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    maxHeight: '85%',
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: space.lg },
  soon: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  soonEmoji: { fontSize: 56 },
});
