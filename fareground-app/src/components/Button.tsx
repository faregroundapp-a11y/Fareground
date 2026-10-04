import type { ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { haptics } from '@/native/haptics';
import { colors, fonts, radius, TOUCH } from '@/theme';

type Variant = 'primary' | 'secondary' | 'boost' | 'light' | 'ghost';

const LOOK: Record<Variant, { bg: string; ink: string; border?: string }> = {
  primary: { bg: colors.accent, ink: colors.accentInk },
  secondary: { bg: colors.accentSoft, ink: colors.accentText },
  boost: { bg: colors.boost, ink: '#FFFFFF' },
  light: { bg: colors.card, ink: colors.ink, border: colors.lineStrong },
  ghost: { bg: 'transparent', ink: colors.ink2 },
};

/**
 * The app's one button. It springs down under your thumb and ticks, so every
 * press feels acknowledged even before the network answers.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  trailing,
  busy = false,
  disabled = false,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: ReactNode;
  /** Something small on the right, e.g. a price. */
  trailing?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}) {
  const look = LOOK[variant];
  const [scale] = useState(() => new Animated.Value(1));
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const off = disabled || busy;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={() => {
          haptics.tap();
          onPress();
        }}
        onPressIn={() => to(0.97)}
        onPressOut={() => to(1)}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityState={{ disabled: off, busy }}
        style={[
          styles.btn,
          { backgroundColor: look.bg, opacity: disabled ? 0.45 : 1 },
          look.border ? { borderWidth: 1, borderColor: look.border } : null,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={look.ink} />
        ) : (
          <View style={styles.row}>
            {icon}
            <Text style={[styles.label, { color: look.ink }]} numberOfLines={1}>
              {label}
            </Text>
            {trailing}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: TOUCH + 4,
    borderRadius: radius.md,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  label: { fontFamily: fonts.heavy, fontSize: 16, includeFontPadding: false },
});
