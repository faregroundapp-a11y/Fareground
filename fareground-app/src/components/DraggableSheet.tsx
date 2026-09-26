import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * A bottom sheet you can drag down to close - from ANYWHERE on it.
 *
 * The first version only listened on a strip around the grip, because the
 * body is a scroll view and a scroll must stay a scroll. Testers found the
 * strip too small to hit and the drag too heavy. Now the whole sheet listens,
 * the way the sheets in Maps and Instagram behave:
 *
 *   * A clearly DOWNWARD drag takes the sheet, wherever it starts - on a
 *     card, a button, the text.
 *   * ...unless the sheet's list is scrolled down. Then the drag scrolls the
 *     list back up first, and only once it is at the top does a further pull
 *     move the sheet. A SheetScrollView reports its position for exactly this.
 *   * A tap is still a tap: nothing is taken until the finger has moved.
 *
 * It follows the finger 1:1, and closes on a short pull or any quick flick.
 */

/** Whether the sheet's scrolling content is at its top; written by SheetScrollView. */
class ScrollTop {
  atTop = true;
  set(atTop: boolean) {
    this.atTop = atTop;
  }
}
const ScrollTopContext = createContext<ScrollTop | null>(null);

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
  const [scroll] = useState(() => new ScrollTop());

  // Rebuilt only when onClose changes; the drag position lives in `y`, so a
  // rebuild never loses a drag in progress.
  const pan = useMemo(() => {
    const downward = (dx: number, dy: number) => dy > 6 && dy > Math.abs(dx) * 1.2;
    return PanResponder.create({
      // Capture phase: the sheet gets first say over a downward drag, before
      // a button or the list underneath the finger. Only at the list's top.
      onMoveShouldSetPanResponderCapture: (_e, g) => scroll.atTop && downward(g.dx, g.dy),
      onMoveShouldSetPanResponder: (_e, g) => downward(g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      // Only downward: pulling up past the top would just look loose.
      onPanResponderMove: (_e, g) => y.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 70 || (g.vy > 0.35 && g.dy > 12)) {
          Animated.timing(y, {
            toValue: 900,
            // A faster flick leaves faster.
            duration: Math.max(110, 200 - g.vy * 40),
            useNativeDriver: true,
          }).start(() => {
            onClose();
            y.setValue(0);
          });
        } else {
          Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 320 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 320 }).start();
      },
    });
  }, [y, scroll, onClose]);

  return (
    <ScrollTopContext.Provider value={scroll}>
      <Animated.View style={[style, { transform: [{ translateY: y }] }]} {...pan.panHandlers}>
        <View style={styles.dragZone} accessibilityRole="adjustable" accessibilityLabel="Drag down to close">
          <View style={gripStyle} />
        </View>
        {children}
      </Animated.View>
    </ScrollTopContext.Provider>
  );
}

/**
 * The ScrollView to use inside a DraggableSheet. Identical to ScrollView,
 * except that it tells the sheet when it is scrolled to the top - so a pull
 * down scrolls the list first and moves the sheet only once there is nothing
 * left to scroll.
 */
export function SheetScrollView({ onScroll, ...props }: ScrollViewProps) {
  const scroll = useContext(ScrollTopContext);
  const handle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scroll?.set(e.nativeEvent.contentOffset.y <= 1);
    onScroll?.(e);
  };
  return <ScrollView {...props} onScroll={handle} scrollEventThrottle={16} />;
}

const styles = StyleSheet.create({
  // Tall enough to grab without aiming; the grip's own margin sits inside it.
  dragZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 6, paddingBottom: 10, marginTop: -6 },
});
