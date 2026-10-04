import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptics } from '@/native/haptics';
import { useGameBalance } from '@/state/game';
import { useSession } from '@/state/session';
import { markTutorialClosed } from '@/state/tutorialGate';
import { colors, fonts, radius, space, type } from '@/theme';
import { Button } from './Button';
import { CoinIcon, GemIcon, StepsIcon } from './icons';
import { Runner } from './Runner';

const SEEN_KEY = 'fareground.tutorialSeen';
/** Only accounts this new see it: the update must not quiz existing players. */
const NEW_ACCOUNT_MS = 24 * 60 * 60 * 1000;


const PAGES = [
  {
    title: 'Walk to earn',
    body: 'Every 100 steps you walk becomes a Walk Point. Your steps count even with the app closed.',
    icon: <StepsIcon size={34} />,
    well: colors.accentSoft,
  },
  {
    title: 'Claim real land',
    body: 'Spend Walk Points on the glowing squares near you. Each one becomes a mine: Rocky, Coal, Amethyst, Sapphire or a rare Ruby.',
    icon: <GemIcon size={34} color="#7E56A6" />,
    well: colors.boostSoft,
  },
  {
    title: 'Your land earns coins',
    body: 'Your mines earn coins all day, even while you sleep. Boost them, open treasure boxes, and ring your neighbours’ doorbells for more.',
    icon: <CoinIcon size={34} />,
    well: colors.claimSoft,
  },
];

/**
 * FIRST-TIME TUTORIAL (2026-10-04): three short pages for a brand-new player
 * - walk, claim, earn - shown once, the first time they reach the map.
 * Players who already had an account when it shipped never see it.
 */
export function Tutorial() {
  const { user } = useSession();
  const { balance } = useGameBalance();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!user) return;
    let live = true;
    const isNew = user.createdAt ? Date.now() - new Date(user.createdAt).getTime() < NEW_ACCOUNT_MS : false;
    AsyncStorage.getItem(SEEN_KEY)
      .then((seen) => {
        if (!live) return;
        if (seen === '1' || !isNew) markTutorialClosed();
        else setOpen(true);
      })
      .catch(() => markTutorialClosed());
    return () => {
      live = false;
    };
  }, [user]);

  const finish = () => {
    haptics.success();
    setOpen(false);
    void AsyncStorage.setItem(SEEN_KEY, '1').catch(() => undefined);
    markTutorialClosed();
  };

  if (!open) return null;
  const p = PAGES[page];
  const last = page === PAGES.length - 1;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={finish} statusBarTranslucent>
      <View style={[styles.scrim, { paddingTop: insets.top + space.lg, paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.card}>
          <View style={styles.top}>
            <Text style={type.overline}>WELCOME TO FAREGROUND</Text>
            <Pressable onPress={finish} hitSlop={10} accessibilityRole="button">
              <Text style={styles.skip}>Skip</Text>
            </Pressable>
          </View>

          <View style={styles.art}>
            <Runner gait={page === 0 ? 'walk' : page === 1 ? 'idle' : 'cheer'} size={84} avatar={balance?.avatar} />
            <View style={[styles.well, { backgroundColor: p.well }]}>{p.icon}</View>
          </View>

          <Text style={styles.title}>{p.title}</Text>
          <Text style={styles.body}>{p.body}</Text>

          <View style={styles.dots}>
            {PAGES.map((_, i) => (
              <View key={i} style={[styles.dot, i === page && styles.dotOn]} />
            ))}
          </View>

          <Button
            label={last ? "Let's go!" : 'Next'}
            onPress={() => {
              if (last) finish();
              else {
                haptics.tap();
                setPage(page + 1);
              }
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(8,12,10,0.6)', justifyContent: 'center', padding: space.lg },
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: space.xl, gap: space.md, maxWidth: 440, width: '100%', alignSelf: 'center' },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  skip: { fontFamily: fonts.heavy, fontSize: 14, color: colors.ink3 },
  art: { height: 150, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: space.lg, backgroundColor: colors.sunk, borderRadius: radius.lg },
  well: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.black, fontSize: 26, letterSpacing: -0.6, color: colors.ink, marginTop: space.xs },
  body: { ...type.body, fontSize: 15.5, lineHeight: 22 },
  dots: { flexDirection: 'row', gap: 6, alignSelf: 'center', marginVertical: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotOn: { width: 22, backgroundColor: colors.accent },
});
