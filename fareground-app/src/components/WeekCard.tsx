import { StyleSheet, Text, View } from 'react-native';
import type { WeekSummary } from '@/api/types';
import { colors, fonts, mono, radius, shadow, space, type } from '@/theme';

/**
 * THIS WEEK, on the Walk tab (2026-10-04): a bar for each of the last seven
 * days, today on the right in amber, and three numbers underneath.
 */
export function WeekCard({ week, cap }: { week: WeekSummary; cap: number }) {
  const max = Math.max(cap * 0.5, ...week.days.map((d) => d.steps), 1);
  const today = week.days[week.days.length - 1]?.day;
  const label = (day: string) =>
    new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' });
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={type.label}>This week</Text>
        <Text style={[styles.total, mono]}>{week.totalSteps.toLocaleString()} steps</Text>
      </View>
      <View style={styles.bars}>
        {week.days.map((d) => {
          const isToday = d.day === today;
          const best = week.bestDay?.day === d.day && d.steps > 0;
          return (
            <View key={d.day} style={styles.col} accessibilityLabel={`${d.day}: ${d.steps} steps`}>
              <View style={styles.track}>
                <View
                  style={[
                    styles.bar,
                    { height: `${Math.max(d.steps > 0 ? 6 : 0, (d.steps / max) * 100)}%` },
                    isToday && { backgroundColor: colors.claim },
                    best && !isToday && { backgroundColor: colors.accent },
                  ]}
                />
              </View>
              <Text style={[styles.day, isToday && styles.dayToday]}>{label(d.day)}</Text>
            </View>
          );
        })}
      </View>
      <View style={styles.stats}>
        <Stat value={week.walkPoints} label="Walk Points" />
        <Stat value={week.parcelsClaimed} label={week.parcelsClaimed === 1 ? 'parcel claimed' : 'parcels claimed'} />
        <Stat value={week.doorbells} label={week.doorbells === 1 ? 'doorbell rung' : 'doorbells rung'} />
      </View>
      {week.bestDay && week.bestDay.steps > 0 && (
        <Text style={[type.caption, { marginTop: space.sm }]}>
          Best day: {new Date(`${week.bestDay.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })} with{' '}
          {week.bestDay.steps.toLocaleString()} steps
        </Text>
      )}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, mono]}>{value.toLocaleString()}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { fontFamily: fonts.heavy, fontSize: 13, color: colors.ink2 },
  bars: { flexDirection: 'row', gap: 6, height: 96, marginTop: space.md },
  col: { flex: 1, alignItems: 'center', gap: 4 },
  track: { flex: 1, width: '100%', justifyContent: 'flex-end', backgroundColor: colors.sunk, borderRadius: 8, overflow: 'hidden' },
  bar: { width: '100%', backgroundColor: colors.steps, borderRadius: 8 },
  day: { fontFamily: fonts.bold, fontSize: 11, color: colors.ink3 },
  dayToday: { color: colors.ink, fontFamily: fonts.black },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  stat: { flex: 1, backgroundColor: colors.sunk, borderRadius: radius.md, padding: space.sm + 2 },
  statValue: { fontFamily: fonts.black, fontSize: 18, color: colors.ink },
  statLabel: { fontFamily: fonts.bold, fontSize: 11, color: colors.ink3, marginTop: 1 },
});
