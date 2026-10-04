import { Marker } from '@maplibre/maplibre-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import type { TreasureBox } from '@/api/types';
import { colors, fonts } from '@/theme';
import { useDistance } from '@/state/prefs';

/** A chest on a post, so it reads against buildings and parks alike. */
function ChestPin({ size = 44 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.25} viewBox="0 0 44 55">
      <Circle cx="22" cy="50" r="7" fill="#0B1410" opacity={0.22} />
      <Path d="M22 50V34" stroke="#8C4F14" strokeWidth={3} strokeLinecap="round" />
      <Path d="M7 16a15 15 0 0130 0z" fill="#C47A26" />
      <Rect x="6" y="15" width="32" height="18" rx="3" fill="#D98E2E" />
      <Rect x="6" y="15" width="32" height="4" fill="#A8621C" />
      <Rect x="18" y="14" width="8" height="9" rx="2" fill="#FFD27A" stroke="#8C4F14" strokeWidth={1.2} />
      <Path d="M11 9a13 13 0 018-4" stroke="#FFE8B8" strokeWidth={2} strokeLinecap="round" opacity={0.7} fill="none" />
    </Svg>
  );
}

/**
 * Treasure boxes on the map: something to walk TO. The distance is shown
 * under each one so it is obvious whether it is worth the detour.
 */
export function TreasureMarkers({
  boxes,
  distances,
  withinM,
  onPressBox,
}: {
  boxes: TreasureBox[];
  /** Metres from the player to each box, by id. */
  distances: Record<string, number>;
  withinM: number;
  /**
   * Tapping a box. It was decoration before: the ONLY way to open one was a
   * button that appeared at the bottom of the screen once you were already
   * in range, so the thing on the map that looked like a button was not one.
   * Testers tapped the chest and nothing happened.
   */
  onPressBox?: (box: TreasureBox, metresAway: number | undefined) => void;
}) {
  const dist = useDistance();
  return (
    <>
      {boxes.map((box) => {
        const away = distances[box.id];
        const near = away !== undefined && away <= withinM;
        return (
          <Marker key={box.id} id={`box-${box.id}`} lngLat={[box.lng, box.lat]} anchor="bottom">
            <Pressable
              onPress={() => onPressBox?.(box, away)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={
                near
                  ? `Treasure box, open it for ${box.rewardWp} Walk Points`
                  : `Treasure box, ${away !== undefined ? Math.round(away) + ' metres away' : 'nearby'}`
              }
              style={({ pressed }) => [styles.wrap, pressed && { opacity: 0.8 }]}
            >
              <ChestPin size={near ? 50 : 42} />
              <View style={[styles.tag, near && styles.tagNear]}>
                <Text style={styles.tagText}>
                  {near ? 'Open it!' : away !== undefined ? dist(away) : `+${box.rewardWp} WP`}
                </Text>
              </View>
            </Pressable>
          </Marker>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  tag: {
    marginTop: -6, backgroundColor: colors.glass, borderColor: colors.glassLine, borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
  },
  tagNear: { backgroundColor: colors.claimDeep, borderColor: colors.claimHi },
  tagText: { color: '#FFFFFF', fontFamily: fonts.heavy, fontSize: 11, includeFontPadding: false },
});
