// Each weight imported from its own path. Importing from the package root
// would bundle all 16 Nunito files (~2 MB, italics included) for the 5 used.
import { Nunito_500Medium } from '@expo-google-fonts/nunito/500Medium';
import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { Nunito_900Black } from '@expo-google-fonts/nunito/900Black';
import { useFonts } from 'expo-font';
import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { LoadingScreen } from '@/components/LoadingScreen';
import { UpdateGate } from '@/components/UpdateRequired';
// Side effect: defines the background step-sync task at load time, which the
// OS needs when it wakes the app headless to run it.
import '@/native/backgroundSteps';
import { SessionProvider } from '@/state/session';

export default function RootLayout() {
  // Only the weights the app actually uses - each one is a file to load.
  const [loaded, error] = useFonts({
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    Nunito_900Black,
  });

  // A split second on first launch. If loading ever fails we carry on with
  // system fonts rather than leave the player on a blank screen.
  //
  // No wordmark here: Nunito is exactly what has not arrived yet, so the name
  // would render in the system font and visibly jump a moment later.
  if (!loaded && !error) return <LoadingScreen wordmark={false} />;

  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <UpdateGate>
        <Stack screenOptions={{ headerShown: false }} />
      </UpdateGate>
    </SessionProvider>
  );
}

/**
 * THE SAFETY NET. Expo Router shows this instead of the screen whenever a
 * screen throws while drawing. Without it, a single error in a release build
 * closes the whole app ("Fareground keeps stopping") - which is exactly what
 * the 2026-09-27 build did when the step setup screen read game state it did
 * not have. Now the player gets a message and a button to try again.
 *
 * Plain styles only: this must still draw if the fonts or the theme failed.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#F4F5F1', gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '800', color: '#121814' }}>Something went wrong</Text>
      <Text style={{ fontSize: 15, color: '#545E51', textAlign: 'center' }}>
        That screen hit a problem. Your land, steps and Walk Points are safe.
      </Text>
      <Pressable
        onPress={() => void retry()}
        style={{ backgroundColor: '#2F5D50', paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 }}
        accessibilityRole="button"
      >
        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>Try again</Text>
      </Pressable>
      <Text style={{ fontSize: 11, color: '#8A9386', textAlign: 'center' }} numberOfLines={3}>
        {error.message}
      </Text>
    </View>
  );
}
