import { useMemo, useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * A bottom sheet you can drag down to close.
 *
 * Every sheet had a grip bar on top - the universal "pull me" sign - and
 * none of them could be pulled, which testers reasonably reported as broken.
 * The drag lives on a strip across the top of the sheet (the grip and the
 * space around it), not on the whole sheet, because the body is a scroll
 * view and a scroll must stay a scroll.
 *
 * Let go past about a third of a thumb's travel, or flick downward, and it
 * closes; anything less springs back.
 */
export function DraggableSheet({
  onClose,
  style,
  gripStyle,
  children,
}: {
  onClose: () => void;
  style: StyleProp<ViewStyle>;
  gripStyle: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const [y] = useState(() => new Animated.Value(0));

  // Rebuilt only when onClose changes; the drag position lives in `y`, so a
  // rebuild never loses a drag in progress.
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
        // Only downward: pulling up past the top would just look loose.
        onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 110 || g.vy > 0.9) {
            Animated.timing(y, { toValue: 900, duration: 180, useNativeDriver: true }).start(() => {
              onClose();
              y.setValue(0);
            });
          } else {
            Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 220 }).start();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(y, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [y, onClose],
  );

  return (
    <Animated.View style={[style, { transform: [{ translateY: y }] }]}>
      <View style={styles.dragZone} {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Drag down to close">
        <View style={gripStyle} />
      </View>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Tall enough to grab without aiming; the grip's own margin sits inside it.
  dragZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 6, paddingBottom: 10, marginTop: -6 },
});
