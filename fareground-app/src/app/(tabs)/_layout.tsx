import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LandTabIcon, MapTabIcon, RanksTabIcon, WalkTabIcon } from '@/components/icons';
import { LoadingScreen } from '@/components/LoadingScreen';
import { haptics } from '@/native/haptics';
import { GameProvider } from '@/state/game';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

/** Everything behind sign-in. No token, no tabs. */
export default function TabsLayout() {
  const { ready, token } = useSession();
  const insets = useSafeAreaInsets();

  if (!ready) return <LoadingScreen message="Finding your ground…" />;
  if (!token) return <Redirect href="/sign-in" />;

  return (
    <GameProvider>
      <Tabs
        screenListeners={{ tabPress: () => haptics.tap() }}
        screenOptions={{
          headerShown: false,
          // A tab you are not looking at stops re-rendering entirely. The map
          // keeps its state, but its runner, GPS updates and balance ticks
          // cost nothing while you are on Walk or Land.
          freezeOnBlur: true,
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.ink3,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.line,
            // Room for the phone's gesture bar, so icons are never cramped.
            height: 62 + insets.bottom,
            paddingTop: 7,
            paddingBottom: Math.max(insets.bottom, 8),
            elevation: 0,
          },
          tabBarLabelStyle: { fontSize: 11.5, fontFamily: fonts.bold, letterSpacing: 0.2, includeFontPadding: false },
        }}
      >
        <Tabs.Screen name="index" options={{ title: 'Map', tabBarIcon: ({ color }) => <MapTabIcon color={color} /> }} />
        <Tabs.Screen name="walk" options={{ title: 'Walk', tabBarIcon: ({ color }) => <WalkTabIcon color={color} /> }} />
        <Tabs.Screen name="ranks" options={{ title: 'Ranks', tabBarIcon: ({ color }) => <RanksTabIcon color={color} /> }} />
        <Tabs.Screen name="land" options={{ title: 'Land', tabBarIcon: ({ color }) => <LandTabIcon color={color} /> }} />
        {/* Opened from the Walk tab and the leaderboard, not from the tab bar. */}
        <Tabs.Screen name="profile" options={{ href: null }} />
        <Tabs.Screen name="player/[username]" options={{ href: null }} />
      </Tabs>
    </GameProvider>
  );
}
