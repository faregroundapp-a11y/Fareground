import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { haptics } from '@/native/haptics';
import { colors, radius, TOUCH, type } from '@/theme';

/** A title row with a back button, for screens opened on top of a tab. */
export function ScreenHeader({ title }: { title: string }) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => { haptics.tap(); if (router.canGoBack()) router.back(); else router.replace('/'); }}
        style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
        accessibilityLabel="Back"
        hitSlop={8}
      >
        <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <Path d="M15 5l-7 7 7 7" stroke={colors.ink} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </Pressable>
      <Text style={[type.headline, { flex: 1 }]} numberOfLines={1}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  back: {
    width: TOUCH, height: TOUCH, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    marginLeft: -10,
  },
});
