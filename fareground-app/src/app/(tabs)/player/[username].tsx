import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, api } from '@/api/client';
import type { Profile } from '@/api/types';
import { ProfileView } from '@/components/ProfileView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useSession } from '@/state/session';
import { colors, space, type } from '@/theme';

/** Another player's public profile - opened from the leaderboard. */
export default function PlayerScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { token } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !username) return;
    let cancelled = false;
    api.player(token, username).then(
      (p) => { if (!cancelled) setProfile(p); },
      (e: unknown) => { if (!cancelled) setError(e instanceof ApiError ? e.message : 'Could not load this player.'); },
    );
    return () => { cancelled = true; };
  }, [token, username]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={styles.body}>
        <ScreenHeader title={username ?? 'Player'} />
        {error && <Text style={styles.error}>{error}</Text>}
        {profile ? (
          <ProfileView profile={profile} />
        ) : (
          !error && <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.xl, paddingBottom: space.xxl, gap: space.md },
  loading: { paddingVertical: 60, alignItems: 'center' },
  error: { ...type.body, color: colors.danger },
});
