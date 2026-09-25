import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/theme';
import { LogoMark } from './Logo';

/**
 * What the player looks at while the app wakes up.
 *
 * It carries the WORDMARK, which the launcher icon deliberately does not: at
 * 48px a word is a grey smear, but here it is 40px on a dark ground and it is
 * the first time most people will read the name.
 *
 * Deliberately dark, not the app's usual bone background. The loading screen
 * matches the splash colour in app.json, so launching goes
 *   native splash -> this -> the app
 * with no white flash between them. A flash is the cheapest-looking thing an
 * app can do on launch.
 *
 * `wordmark={false}` is for the moment BEFORE Nunito has loaded, where the
 * name would render in the system font and jump when the real one arrives.
 * The mark alone holds that half-second perfectly well.
 */
export function LoadingScreen({
  message,
  wordmark = true,
}: {
  /** What we are waiting for, if it is worth saying. */
  message?: string;
  wordmark?: boolean;
}) {
  const [reduceMotion, setReduceMotion] = useState(false);
  // Held in state, not a ref: the React Compiler forbids reading a ref
  // during render, and `interpolate()` below is read during render.
  // `useState` with an initialiser gives the same single stable instance.
  const [pulse] = useState(() => new Animated.Value(0));

  // `useReducedMotion` is a react-native-reanimated hook, not a React Native
  // one. The platform API is AccessibilityInfo, which needs both a read and a
  // subscription - the setting can change while the app is open.
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) setReduceMotion(on); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    // A slow breath under the gem - enough to say "working", not enough to
    // be a thing you watch.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  const glowStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.5] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.12] }) }],
  };

  return (
    <View style={styles.screen}>
      <View style={styles.centre}>
        <View style={styles.markWrap}>
          <Animated.View style={[styles.glow, glowStyle]} pointerEvents="none" />
          <LogoMark size={176} />
        </View>

        {wordmark ? (
          <>
            <Text style={styles.wordmark} allowFontScaling={false}>
              Fareground
            </Text>
            <Text style={styles.tagline}>Walk it. Claim it. Keep it.</Text>
          </>
        ) : null}
      </View>

      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches the splash backgroundColor in app.json, so there is no flash
  // between the native splash and this.
  screen: { flex: 1, backgroundColor: '#1F4A3F', alignItems: 'center', justifyContent: 'center', padding: 32 },
  centre: { alignItems: 'center' },
  markWrap: { alignItems: 'center', justifyContent: 'center' },
  glow: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: '#F2A93B',
  },
  wordmark: {
    // Never fontWeight with a custom font - it fakes bold and blurs the edges.
    fontFamily: fonts.black,
    fontSize: 40,
    letterSpacing: -1.2,
    color: '#F1F5F0',
    marginTop: 28,
    includeFontPadding: false,
  },
  tagline: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: '#8FD4B3',
    marginTop: 8,
    letterSpacing: 0.3,
  },
  message: {
    position: 'absolute',
    bottom: 56,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: 'rgba(241,245,240,0.55)',
  },
});
