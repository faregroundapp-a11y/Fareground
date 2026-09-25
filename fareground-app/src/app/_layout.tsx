// Each weight imported from its own path. Importing from the package root
// would bundle all 16 Nunito files (~2 MB, italics included) for the 5 used.
import { Nunito_500Medium } from '@expo-google-fonts/nunito/500Medium';
import { Nunito_600SemiBold } from '@expo-google-fonts/nunito/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { Nunito_900Black } from '@expo-google-fonts/nunito/900Black';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { LoadingScreen } from '@/components/LoadingScreen';
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
      <Stack screenOptions={{ headerShown: false }} />
    </SessionProvider>
  );
}
