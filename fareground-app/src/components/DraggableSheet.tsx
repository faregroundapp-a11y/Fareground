import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
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

/** True the first time only: a sheet closes once, however many ways it is told to. */
class Once {
  private done = false;
  take() {
    if (this.done) return false;
    this.done = true;
    return true;
  }
}

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
  const { height: screenH } = useWindowDimensions();
  // Starts off-screen and slides up on open (2026-10-04). The Modal around it
  // no longer animates: its "slide" moved the dark scrim up with the sheet,
  // and closing by a tap snapped shut with no motion at all.
  const [y] = useState(() => new Animated.Value(screenH));
  const [scroll] = useState(() => new ScrollTop());
  const [sheetH, setSheetH] = useState(screenH * 0.6);
  const [closing] = useState(() => new Once());

  useEffect(() => {
    Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 24, stiffness: 260, mass: 0.9 }).start();
  }, [y]);

  /** Slide away, then tell the parent. Used by a drag, a flick and a tap outside. */
  const dismiss = useCallback(
    (velocity = 0) => {
      if (!closing.take()) return;
      Animated.timing(y, {
        toValue: Math.max(sheetH, 400) + 40,
        // A faster flick leaves faster.
        duration: Math.max(120, 220 - velocity * 45),
        useNativeDriver: true,
      }).start(() => onClose());
    },
    [y, sheetH, onClose, closing],
  );

  // Rebuilt only when dismiss changes; the drag position lives in `y`, so a
  // rebuild never loses a drag in progress.
  const pan = useMemo(() => {
    const downward = (dx: number, dy: number) => dy > 6 && dy > Math.abs(dx) * 1.2;
    const settle = () =>
      Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 320 }).start();
    return PanResponder.create({
      // Capture phase: the sheet gets first say over a downward drag, before
      // a button or the list underneath the finger. Only at the list's top.
      onMoveShouldSetPanResponderCapture: (_e, g) => scroll.atTop && downward(g.dx, g.dy),
      onMoveShouldSetPanResponder: (_e, g) => downward(g.dx, g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => y.stopAnimation(),
      // Follows the finger 1:1 downward; upward it gives a little and stops,
      // so the sheet feels attached rather than loose.
      onPanResponderMove: (_e, g) => y.setValue(g.dy >= 0 ? g.dy : Math.max(-14, g.dy * 0.2)),
      onPanResponderRelease: (_e, g) => {
        // Close on a third of the way down, or a clear flick at any point.
        if (g.dy > Math.min(140, sheetH * 0.33) || (g.vy > 0.5 && g.dy > 10)) dismiss(g.vy);
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [y, scroll, sheetH, dismiss]);

  // The scrim darkens as the sheet rises and lightens as it is dragged away.
  const scrimOpacity = y.interpolate({ inputRange: [0, Math.max(1, sheetH)], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <ScrollTopContext.Provider value={scroll}>
      <View style={styles.host} pointerEvents="box-none">
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrimOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss()} accessibilityLabel="Close" />
        </Animated.View>
        <Animated.View
          style={[style, { transform: [{ translateY: y }] }]}
          onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
          {...pan.panHandlers}
        >
          <View style={styles.dragZone} accessibilityRole="adjustable" accessibilityLabel="Drag down to close">
            <View style={gripStyle} />
          </View>
          {children}
        </Animated.View>
      </View>
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
  // Fills the Modal and stands the sheet on the bottom edge.
  host: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(8,12,10,0.5)' },
  // Tall enough to grab without aiming; the grip's own margin sits inside it.
  dragZone: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 6, paddingBottom: 10, marginTop: -6 },
});
