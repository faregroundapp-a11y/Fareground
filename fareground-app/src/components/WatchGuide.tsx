import { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { GADGETS, type Gadget } from '@/game/gadgets';
import { openAndroidApp } from '@/native/healthSteps';
import { haptics } from '@/native/haptics';
import { colors, fonts, radius, space, type } from '@/theme';
import { Button } from './Button';

/**
 * "I have a watch": one row per brand, tap to open how to connect it.
 *
 * Every brand is shown on both platforms, including the ones that CANNOT
 * share with this phone's health store - saying "Fitbit does not talk to
 * Apple Health" plainly beats a missing row that leaves someone searching.
 */
export function WatchGuide({ highlight }: { highlight?: string | null }) {
  const [open, setOpen] = useState<string | null>(highlight ?? null);
  return (
    <View style={styles.list}>
      {GADGETS.map((g) => (
        <Row key={g.key} gadget={g} open={open === g.key} onToggle={() => setOpen(open === g.key ? null : g.key)} />
      ))}
    </View>
  );
}

function Row({ gadget, open, onToggle }: { gadget: Gadget; open: boolean; onToggle: () => void }) {
  const ios = Platform.OS === 'ios';
  const how = ios ? gadget.ios : gadget.android;
  const canOpen = ios ? !!gadget.iosAppStore : !!gadget.androidPackage;

  return (
    <View style={[styles.row, open && styles.rowOpen]}>
      <Pressable
        onPress={() => { haptics.tap(); onToggle(); }}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Text style={[type.label, { flex: 1 }]}>{gadget.name}</Text>
        {!how && <Text style={styles.tag}>Not on {ios ? 'iPhone' : 'Android'}</Text>}
        <Text style={styles.chevron}>{open ? '–' : '+'}</Text>
      </Pressable>
      {open && (
        <View style={styles.body}>
          <Text style={type.caption}>{how ?? gadget.workaround}</Text>
          {how && canOpen && (
            <Button
              label={`Open ${gadget.name.split(' /')[0]}`}
              variant="secondary"
              onPress={() => {
                if (ios && gadget.iosAppStore) void Linking.openURL(gadget.iosAppStore);
                else if (gadget.androidPackage) openAndroidApp(gadget.androidPackage);
              }}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  rowOpen: { borderColor: colors.accent },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, minHeight: 50 },
  tag: {
    fontFamily: fonts.bold, fontSize: 11, color: colors.ink3, backgroundColor: colors.sunk,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, overflow: 'hidden',
  },
  chevron: { fontFamily: fonts.black, fontSize: 20, color: colors.ink3, width: 18, textAlign: 'center' },
  body: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.md },
});
