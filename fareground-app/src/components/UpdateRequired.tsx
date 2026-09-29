import { useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { onUpdateRequired } from '@/api/client';

/**
 * "This version is out of date" - over the whole app.
 *
 * The server answers 426 to any build older than MIN_APP_BUILD. Rather than
 * let every screen fail with its own error, the first 426 swaps the whole app
 * for this. (Builds before 3 predate it: they just show the message as an
 * error wherever they call the server.)
 *
 * Plain styles, like the root error screen: it must draw whatever else is
 * broken.
 */
export function UpdateGate({ children }: { children: ReactNode }) {
  const [outdated, setOutdated] = useState(false);
  useEffect(() => onUpdateRequired(() => setOutdated(true)), []);
  if (!outdated) return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#F4F5F1', gap: 12 }}>
      <Text style={{ fontSize: 48 }}>🚶</Text>
      <Text style={{ fontSize: 22, fontWeight: '800', color: '#121814', textAlign: 'center' }}>Time to update</Text>
      <Text style={{ fontSize: 15, color: '#545E51', textAlign: 'center', lineHeight: 21 }}>
        This version of Fareground is out of date. Install the latest version to keep playing - your land, steps
        and Walk Points are all waiting for you.
      </Text>
    </View>
  );
}
