import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import type { AvatarChoice, Profile } from '@/api/types';
import { InviteCard } from '@/components/InviteCard';
import { ProfileView } from '@/components/ProfileView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { haptics } from '@/native/haptics';
import { useGameBalance } from '@/state/game';
import { useSession } from '@/state/session';
import { colors, fonts, space, type } from '@/theme';

/** Your own profile: level, stats, badges, jersey colour - and sign out. */
export default function ProfileScreen() {
  const { token } = useSession();
  const { refresh: refreshBalance } = useGameBalance();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={loading && !!profile} onRefresh={load} tintColor={colors.accent} />}
      >
        <ScreenHeader title="Your profile" />
        {error && <Text style={styles.error}>{error}</Text>}
        {profile ? (
          <>
            <ProfileView profile={profile} onEdit={save} onReload={load} />
            <InviteCard />
          </>
        ) : (
          <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>
        )}
        <Pressable
          style={styles.settings}
          onPress={() => router.push('/settings')}
          hitSlop={8}
          accessibilityRole="button"
        >
          <Text style={styles.settingsText}>Settings, privacy and account</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, paddingBottom: space.xxl, gap: space.md },
  loading: { paddingVertical: 60, alignItems: 'center' },
  error: { ...type.body, color: colors.danger },
  settings: { alignItems: 'center', minHeight: 48, justifyContent: 'center', marginTop: space.sm },
  settingsText: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink2 },
});
