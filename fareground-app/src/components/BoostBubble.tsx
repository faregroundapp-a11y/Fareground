import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Polygon } from 'react-native-svg';
import { colors, fonts } from '@/theme';

/**
 * "when boosted $2.60 / year" - a faceted purple speech bubble beside the
 * Land tab's income, pointing at it. The product owner sketched it on a
 * screenshot (2026-09-28): the unboosted figure alone ("$0.13 per year")
 * undersold what the same land earns with the boost running.
 *
 * Drawn, not an image: a low-poly gem shape in the boost purples, with a tail
 * down and to the left towards the number it annotates.
 */
export function BoostBubble({ usdPerYear }: { usdPerYear: number }) {
  const money = usdPerYear >= 10 ? usdPerYear.toFixed(0) : usdPerYear.toFixed(2);
  return (
    <View style={styles.wrap} accessibilityLabel={`When boosted, $${money} a year`}>
      <Svg width={126} height={96} viewBox="0 0 126 96" style={StyleSheet.absoluteFill}>
        {/* tail */}
        <Polygon points="10,94 26,62 40,70" fill={colors.boost} />
        {/* the gem body, in facets */}
        <Polygon points="4,40 22,8 70,2 118,16 124,40 104,74 58,80 24,70" fill={colors.boostHi} />
        <Polygon points="22,8 70,2 58,40 4,40" fill="#B8A2FF" />
        <Polygon points="70,2 118,16 124,40 58,40" fill="#9C7CFA" />
        <Polygon points="4,40 58,40 58,80 24,70" fill={colors.boost} />
        <Polygon points="58,40 124,40 104,74 58,80" fill={colors.boostDeep} opacity={0.85} />
        <Path d="M22 8L70 2L118 16" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.5} fill="none" />
      </Svg>
      <Text style={styles.small}>when boosted</Text>
      <Text style={styles.big} numberOfLines={1} adjustsFontSizeToFit>
        ${money} / year
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 126, height: 96, alignItems: 'center', justifyContent: 'center', paddingBottom: 18, paddingHorizontal: 12 },
  small: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 12.5, includeFontPadding: false },
  big: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 16, includeFontPadding: false, marginTop: 2 },
});
