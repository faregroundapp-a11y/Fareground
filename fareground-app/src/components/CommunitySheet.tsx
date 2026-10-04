import { Linking, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { haptics } from '@/native/haptics';
import { colors, fonts, radius, space, TOUCH, type } from '@/theme';
import { DraggableSheet, SheetScrollView } from './DraggableSheet';
import { DiscordIcon, RedditIcon } from './icons';

/**
 * Community: where the players are.
 *
 * A walking game is played alone, in the street, with nobody to tell when you
 * finally turn up a ruby. This is the door to the places where that
 * conversation happens.
 *
 * Discord is live (2026-09-27); Instagram and TikTok were removed at the
 * product owner's request. Every `url: null` below renders as a greyed row
 * that says "coming soon" rather than opening a dead page - which is what a
 * real URL you have not created yet actually does. Fill them in as the
 * communities exist; nothing else has to change.
 */
export interface CommunityLink {
  key: string;
  name: string;
  blurb: string;
  /** null = not set up yet. The row greys out rather than opening nothing. */
  url: string | null;
  colour: string;
}

export const COMMUNITIES: CommunityLink[] = [
  {
    key: 'discord',
    name: 'Discord',
    blurb: 'Rare finds, bugs, and who is winning this week',
    url: 'https://discord.gg/ZEAtJzVDtM',
    colour: '#5865F2',
  },
  {
    key: 'reddit',
    name: 'Reddit',
    blurb: 'Longer posts, maps and arguments about the economy',
    url: null,
    colour: '#FF4500',
  },
];

/** Each community's own logo, drawn as an icon (no image assets). */
function Logo({ which, live }: { which: string; live: boolean }) {
  if (which === 'discord') return <DiscordIcon size={26} eyes={live ? '#5865F2' : colors.lineStrong} />;
  return <RedditIcon size={26} face={live ? '#FF4500' : colors.lineStrong} />;
}

export function CommunitySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <DraggableSheet onClose={onClose} style={[styles.sheet, { paddingBottom: space.lg + insets.bottom }]} gripStyle={styles.grip}>

        <Text style={type.title}>Community</Text>
        <Text style={[type.caption, { marginTop: 4, marginBottom: space.lg }]}>
          Walking is a solo sport. Talking about it does not have to be.
        </Text>

        {/* Was a flat 380px, which on a small phone was taller than the
            space left under the header and safe area. */}
        <SheetScrollView style={{ maxHeight: height * 0.45 }} contentContainerStyle={{ gap: space.sm }}>
          {COMMUNITIES.map((c) => {
            const live = !!c.url;
            return (
              <Pressable
                key={c.key}
                style={[styles.row, !live && styles.rowSoon]}
                disabled={!live}
                onPress={() => {
                  haptics.tap();
                  if (c.url) void Linking.openURL(c.url);
                }}
                accessibilityRole="link"
                accessibilityState={{ disabled: !live }}
              >
                <View style={[styles.glyph, { backgroundColor: live ? c.colour : colors.lineStrong }]}>
                  <Logo which={c.key} live={live} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={type.label}>{c.name}</Text>
                  <Text style={styles.blurb} numberOfLines={2}>
                    {c.blurb}
                  </Text>
                </View>
                <Text style={live ? styles.chevron : styles.soon}>{live ? '›' : 'Soon'}</Text>
              </Pressable>
            );
          })}
        </SheetScrollView>

        <Text style={styles.foot}>
          More opens up as there are more walkers. Nothing here shares your location.
        </Text>
      </DraggableSheet>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: space.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: TOUCH + 8,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowSoon: { opacity: 0.6 },
  glyph: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  blurb: { ...type.caption, marginTop: 2 },
  chevron: { fontFamily: fonts.bold, fontSize: 22, color: colors.ink3 },
  soon: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink3 },
  foot: { ...type.caption, marginTop: space.lg, textAlign: 'center' },
});
