import { Redirect, Tabs } from 'expo-router';
import { useWindowDimensions } from 'react-native';
import { LandTabIcon, MapTabIcon, RanksTabIcon, WalkTabIcon } from '@/components/icons';
import { LoadingScreen } from '@/components/LoadingScreen';
import { StepSetupPrompt } from '@/components/StepSetupPrompt';
import { haptics } from '@/native/haptics';
import { TAB_BAR_HEIGHT, useTabBarBottom } from '@/hooks/useTabBarSpace';
import { GameProvider } from '@/state/game';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme';

/** Everything behind sign-in. No token, no tabs. */
export default function TabsLayout() {
  const { ready, token } = useSession();
  const tabBarBottom = useTabBarBottom();
  // On a tablet the bar stops at a phone's width, centred.
  const { width } = useWindowDimensions();
  const barInset = Math.max(12, (width - 560) / 2);

  if (!ready) return <LoadingScreen message="Finding your ground…" />;
  if (!token) return <Redirect href="/sign-in" />;

  return (
    <GameProvider>
      <StepSetupPrompt />
      <Tabs
        screenListeners={{ tabPress: () => haptics.tap() }}
        screenOptions={{
          headerShown: false,
          // A tab you are not looking at stops re-rendering entirely. The map
          // keeps its state, but its runner, GPS updates and balance ticks
          // cost nothing while you are on Walk or Land.
          freezeOnBlur: true,
          // The floating dark-glass bar (2026-10-03): the same glass as the
          // map's HUD, lifted off the bottom edge with rounded ends. The active
          // tab sits in a lighter capsule with amber ink.
          tabBarActiveTintColor: colors.claimHi,
          tabBarInactiveTintColor: colors.glassInk2,
          tabBarActiveBackgroundColor: 'rgba(255,255,255,0.12)',
          tabBarStyle: {
            position: 'absolute',
            marginHorizontal: barInset,
            bottom: tabBarBottom,
            height: TAB_BAR_HEIGHT,
            paddingTop: 7,
            paddingBottom: 7,
            paddingHorizontal: 6,
            borderRadius: 24,
            backgroundColor: colors.glass,
            borderTopWidth: 1,
            borderWidth: 1,
            borderColor: colors.glassLine,
            borderTopColor: colors.glassLine,
            elevation: 0,
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
          },
          tabBarItemStyle: { borderRadius: 18, marginHorizontal: 3, overflow: 'hidden' },
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
