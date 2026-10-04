import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '@/api/client';
import type { NeighboursHere } from '@/api/types';
import { useSession } from '@/state/session';
import { colors, fonts, mono, radius, shadow, space, type } from '@/theme';

/**
 * "Who else is here."
 *
 * The map shows other people's land but never whose it is, on purpose. This
 * card is the other half of that trade: you learn the neighbourhood has
 * players in it, and who they are, without any name ever being pinned to a
 * square. The server aggregates to a fixed ~1 km box and stays silent when
 * there are too few people to stay anonymous.
 *
 * Uses the LAST KNOWN position rather than asking for a fresh fix: this is a
 * "roughly where am I" question, and spinning up the GPS for it would cost
 * battery for no extra accuracy that matters at 1 km.
 */
export function NeighboursCard() {
  const { token } = useSession();
  const [data, setData] = useState<NeighboursHere | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'nolocation' | 'error'>('loading');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') {
        setState('nolocation');
        return;
      }
      const fix =
        (await Location.getLastKnownPositionAsync({ maxAge: 30 * 60_000 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      if (!fix) {
        setState('nolocation');
        return;
      }
      setData(await api.neighbours(token, fix.coords.latitude, fix.coords.longitude));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [token]);

  // Refreshed whenever the tab comes into view, so walking somewhere new and
  // coming back shows the neighbours there rather than a stale list.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (state === 'loading' || state === 'error') return null;

  if (state === 'nolocation') {
    return (
      <View style={styles.card}>
        <Text style={styles.heading}>Neighbours</Text>
        <Text style={styles.body}>Turn on location to see who else owns land around you.</Text>
      </View>
    );
  }

  const d = data!;
  const quiet = d.count === 0;
  const anonymous = d.count > 0 && d.neighbours.length === 0;

  return (
    <Pressable style={styles.card} onPress={() => void load()}>
      <View style={styles.headRow}>
        <Text style={styles.heading}>Neighbours</Text>
        <Text style={styles.count}>{d.count}</Text>
      </View>

      {quiet ? (
        <Text style={styles.body}>
          Nobody else has claimed anything around here yet. The whole neighbourhood is yours to take.
        </Text>
      ) : anonymous ? (
        <Text style={styles.body}>
          {d.count === 1 ? 'One other player owns' : `${d.count} other players own`} land around here. It is too quiet to
          name anyone yet.
        </Text>
      ) : (
        <>
          <Text style={styles.body}>
            {d.count} {d.count === 1 ? 'player owns' : 'players own'} land around here.
          </Text>
          <View style={styles.chips}>
            {d.neighbours.map((n) => (
              <View key={n.username} style={styles.chip}>
                <View style={[styles.dot, { backgroundColor: n.jerseyColor }]} />
                <Text style={styles.chipName} numberOfLines={1}>
                  {n.username}
                </Text>
                <Text style={styles.chipCount}>{n.parcels}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {d.claimedHere > 0 ? (
        <Text style={styles.foot}>
          {d.claimedHere} {d.claimedHere === 1 ? 'square is' : 'squares are'} taken around here
          {d.yoursHere > 0 ? ` · ${d.yoursHere} ${d.yoursHere === 1 ? 'is' : 'are'} yours` : ''}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    ...shadow.card,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { ...type.headline },
  count: { fontFamily: fonts.black, fontSize: 20, color: colors.accentText, ...mono },
  body: { ...type.body },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    maxWidth: '100%',
    backgroundColor: colors.sunk,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: space.md,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chipName: { fontFamily: fonts.bold, fontSize: 13.5, color: colors.ink, flexShrink: 1 },
  chipCount: { fontFamily: fonts.bold, fontSize: 12.5, color: colors.ink3, ...mono },
  foot: { ...type.caption, marginTop: space.xs },
});
