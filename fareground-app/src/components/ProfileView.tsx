import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AvatarChoice, Badge, Profile } from '@/api/types';
import { haptics } from '@/native/haptics';
import { colors, fonts, mono, radius, shadow, space, TOUCH, type } from '@/theme';
import { AvatarEditor } from './AvatarEditor';
import { AvatarPortrait } from './AvatarPortrait';
import { ApiError, api } from '@/api/client';
import { useSession } from '@/state/session';
import { BadgeMedal, TIER_COLORS, TIER_LABEL } from './BadgeMedal';
import { Button } from './Button';
import { PlayerPicture } from './PlayerPicture';

const fmt = (n: number) => n.toLocaleString();

/**
 * A player's profile: their character, level, stats and badge collection.
 *
 * The same view shows your own profile (where the character, name and title
 * can be changed, and locked badges show progress) and other people's (what
 * they have, not how close they are to the rest).
 */
export function ProfileView({
  profile,
  onEdit,
  onReload,
}: {
  profile: Profile;
  /** Given only on your own profile: save a change. */
  onEdit?: (change: { avatar?: AvatarChoice; username?: string; title?: string | null }) => Promise<string | null>;
  /** Given only on your own profile: something was unlocked, reload. */
  onReload?: () => void;
}) {
  const [picked, setPicked] = useState<Badge | null>(null);
  const [gridW, setGridW] = useState(0);
  const [dressing, setDressing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(profile.username);
  const [error, setError] = useState<string | null>(null);
  const mine = !!onEdit;
  const { token } = useSession();
  const [reporting, setReporting] = useState(false);

  /**
   * Report someone's picture.
   *
   * Google Play requires a way to report user images from INSIDE the app, not
   * just an email address in a store listing. Reasons are fixed rather than
   * free text so a moderator can triage a queue at a glance.
   */
  function reportPicture() {
    if (!token) return;
    const send = async (reason: string) => {
      setReporting(true);
      try {
        await api.reportPhoto(token, profile.username, reason);
        Alert.alert('Thank you', 'A moderator will look at this picture.');
      } catch (e) {
        Alert.alert('Could not report', e instanceof ApiError ? e.message : 'Please try again.');
      } finally {
        setReporting(false);
      }
    };
    Alert.alert(
      `Report ${profile.username}'s picture`,
      'What is wrong with it?',
      [
        { text: 'Sexual', onPress: () => void send('SEXUAL') },
        { text: 'Violent', onPress: () => void send('VIOLENT') },
        { text: 'Hateful', onPress: () => void send('HATE') },
        { text: 'Pretending to be someone', onPress: () => void send('IMPERSONATION') },
        { text: 'Cancel', style: 'cancel' },
      ],
      { cancelable: true },
    );
  }
  const titleBadge = profile.badges.find((b) => b.key === profile.title);

  async function save(change: { avatar?: AvatarChoice; username?: string; title?: string | null }) {
    const problem = (await onEdit?.(change)) ?? null;
    setError(problem);
    if (!problem && change.username) setRenaming(false);
  }
  const { level, stats } = profile;
  const levelPct = Math.min(1, (stats.lifetimeSteps - level.current) / Math.max(1, level.next - level.current));
  const unlockedFirst = [...profile.badges].sort((a, b) => Number(b.unlocked) - Number(a.unlocked));

  return (
    <View style={{ gap: space.md }}>
      {/* who */}
      <View style={[styles.card, styles.hero]}>
        <Pressable
          onPress={() => { if (mine) { haptics.tap(); setDressing(true); } }}
          accessibilityLabel={mine ? 'Change your character' : undefined}
        >
          {/* THE PICTURE IS THE HERO and the character is the badge on it.
              It was the other way round; a photo is who someone IS and the
              runner is what they dressed it in, so the photo leads. The
              character still shows, because it is what you see on the map. */}
          <PlayerPicture photoUrl={profile.photoUrl} username={profile.username} size={92} />
          <View style={styles.avatarBadge}>
            <AvatarPortrait avatar={profile.avatar} size={38} />
          </View>
          {mine && (
            <View style={styles.editBadge}>
              <Text style={styles.editBadgeText}>EDIT</Text>
            </View>
          )}
        </Pressable>
        <View style={{ flex: 1 }}>
          <Pressable
            onPress={() => { if (mine) { haptics.tap(); setRenaming(true); } }}
            disabled={!mine}
            accessibilityLabel={mine ? 'Change your name' : undefined}
          >
            <Text style={type.title} numberOfLines={1}>{profile.username}</Text>
          </Pressable>
          {titleBadge && (
            <View style={[styles.titleChip, { borderColor: TIER_COLORS[titleBadge.tier][1] }]}>
              <Text style={[styles.titleText, { color: TIER_COLORS[titleBadge.tier][1] }]}>{titleBadge.name}</Text>
            </View>
          )}
          <Text style={[type.caption, { marginTop: 2 }]}>
            Walking since {new Date(profile.joinedAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </Text>
          <View style={styles.levelRow}>
            <View style={styles.levelBadge}>
              <Text style={styles.levelText}>LV {level.level}</Text>
            </View>
            <View style={styles.levelTrack}>
              <View style={[styles.levelFill, { width: `${levelPct * 100}%` }]} />
            </View>
          </View>
          <Text style={[type.caption, mono, { marginTop: 4 }]}>
            {fmt(level.next - stats.lifetimeSteps)} steps to level {level.level + 1}
          </Text>
        </View>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* rename (own profile only) */}
      {mine && renaming && (
        <View style={styles.card}>
          <Text style={type.label}>Change your name</Text>
          <Text style={[type.caption, { marginTop: 2, marginBottom: space.sm }]}>
            Letters, numbers and underscores. You can change it again after 30 days.
          </Text>
          <View style={styles.renameRow}>
            <TextInput
              value={name}
              onChangeText={(t) => setName(t.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32))}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              accessibilityLabel="New name"
            />
            <Button label="Save" onPress={() => save({ username: name })} disabled={name.length < 3} />
          </View>
          <Pressable onPress={() => { setRenaming(false); setName(profile.username); setError(null); }} style={styles.cancel}>
            <Text style={type.caption}>Cancel</Text>
          </Pressable>
        </View>
      )}

      {/* stats */}
      <View style={styles.grid}>
        <Stat label="Steps, all time" value={fmt(stats.lifetimeSteps)} />
        <Stat label="This week" value={fmt(stats.thisWeekSteps)} />
        <Stat label="Parcels" value={fmt(stats.parcels)} />
        <Stat label="Rubies" value={fmt(stats.rubies)} accent="#C0304A" />
        <Stat label="Places visited" value={fmt(stats.placesVisited)} />
        <Stat label="Podiums" value={`${stats.podiums}${stats.wins ? ` · ${stats.wins} win${stats.wins === 1 ? '' : 's'}` : ''}`} />
      </View>

      {/* badges */}
      <View style={styles.card}>
        <View style={styles.badgeHead}>
          <Text style={type.headline}>Badges</Text>
          <Text style={[type.caption, mono]}>
            {profile.badgeCount.unlocked} / {profile.badgeCount.total}
          </Text>
        </View>

        {/* Tapping a badge opens its details in a bubble beside it, rather
            than in a panel at the top of the card that you had to look away
            to read. Tap the badge again, or the bubble, to close it. */}
        <View style={styles.badges} onLayout={(e) => setGridW(e.nativeEvent.layout.width)}>
          {unlockedFirst.map((b, i) => {
            const open = picked?.key === b.key;
            const col = i % 3;
            const lastRow = Math.floor(i / 3) === Math.floor((unlockedFirst.length - 1) / 3);
            // Centre the bubble on the badge, then keep it inside the card.
            const colW = gridW / 3;
            const bubbleW = Math.min(250, Math.max(0, gridW - 8));
            const inGrid = Math.max(0, Math.min(gridW - bubbleW, col * colW + colW / 2 - bubbleW / 2));
            const left = inGrid - col * colW;
            return (
              <View key={b.key} style={[styles.badge, open && styles.badgeOpen]}>
                <Pressable
                  onPress={() => { haptics.tap(); setPicked(open ? null : b); }}
                  style={({ pressed }) => [styles.badgeTap, pressed && { opacity: 0.7 }]}
                  accessibilityLabel={`${b.name}${b.unlocked ? '' : ', locked'}`}
                  accessibilityState={{ expanded: open }}
                >
                  <BadgeMedal tier={b.tier} icon={b.icon} color={b.color} size={58} locked={!b.unlocked} />
                  {b.isNew && (
                    <View style={styles.newTag}>
                      <Text style={styles.newText}>NEW</Text>
                    </View>
                  )}
                  <Text style={[styles.badgeName, !b.unlocked && { color: colors.ink3 }]} numberOfLines={2}>
                    {b.name}
                  </Text>
                  {!b.unlocked && profile.isYou && (
                    <View style={styles.miniTrack}>
                      <View style={[styles.miniFill, { width: `${(b.progress / b.target) * 100}%` }]} />
                    </View>
                  )}
                </Pressable>

                {open && gridW > 0 && (
                  <Pressable
                    onPress={() => setPicked(null)}
                    style={[
                      styles.bubble,
                      { width: bubbleW, left, borderColor: b.unlocked ? TIER_COLORS[b.tier][1] : colors.lineStrong },
                      // The bottom row opens upwards, so the bubble never
                      // hangs off the end of the screen.
                      lastRow ? styles.bubbleUp : styles.bubbleDown,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Close badge details"
                  >
                    <View
                      style={[
                        styles.arrow,
                        { left: colW / 2 - left - 7, borderColor: b.unlocked ? TIER_COLORS[b.tier][1] : colors.lineStrong },
                        lastRow ? styles.arrowDown : styles.arrowUp,
                      ]}
                    />
                    <Text style={type.label}>{b.name}</Text>
                    <Text style={[type.caption, { marginTop: 2 }]}>
                      {TIER_LABEL[b.tier]} · {b.description}
                    </Text>
                    <Text style={[type.caption, mono, { marginTop: 4, color: b.unlocked ? colors.goodInk : colors.ink3 }]}>
                      {b.unlocked
                        ? `Unlocked${b.unlockedAt ? ` ${new Date(b.unlockedAt).toLocaleDateString()}` : ''}`
                        : profile.isYou
                          ? `${fmt(b.progress)} / ${fmt(b.target)}`
                          : 'Not yet unlocked'}
                    </Text>
                    {mine && b.unlocked && (
                      <Pressable
                        onPress={() => { haptics.tap(); save({ title: profile.title === b.key ? null : b.key }); }}
                        style={styles.wear}
                        accessibilityRole="button"
                      >
                        <Text style={styles.wearText}>
                          {profile.title === b.key ? 'Stop wearing this title' : 'Wear as my title'}
                        </Text>
                      </Pressable>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      </View>

      {/* Reporting somebody else's picture. Only shown when there IS one -
          offering to report an initial on a colour would be nonsense. */}
      {!mine && profile.photoUrl ? (
        <Pressable style={styles.reportRow} onPress={reportPicture} disabled={reporting} hitSlop={8}>
          <Text style={styles.reportText}>{reporting ? 'Reporting…' : 'Report this picture'}</Text>
        </Pressable>
      ) : null}

      {mine && (
        <AvatarEditor
          visible={dressing}
          profile={profile}
          onClose={() => setDressing(false)}
          onChange={(choice) => save({ avatar: choice })}
          onUnlocked={() => onReload?.()}
        />
      )}
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, mono, accent ? { color: accent } : null]} numberOfLines={1}>{value}</Text>
      <Text style={type.caption} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatarBadge: {
    position: 'absolute',
    right: -6,
    bottom: -4,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.card,
    backgroundColor: colors.sunk,
    overflow: 'hidden',
  },
  reportRow: { alignItems: 'center', paddingVertical: space.md },
  reportText: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.ink3 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  levelBadge: { backgroundColor: colors.accent, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  levelText: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 11, includeFontPadding: false },
  levelTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.sunk, overflow: 'hidden' },
  levelFill: { height: '100%', borderRadius: 4, backgroundColor: colors.steps },
  // Bottom-LEFT, because the character badge now sits bottom-right and a
  // centred pill clipped the corner of it.
  editBadge: {
    position: 'absolute', bottom: -2, left: -2, backgroundColor: colors.solid,
    borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3,
  },
  editBadgeText: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 9.5, letterSpacing: 0.6, includeFontPadding: false },
  titleChip: {
    alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: radius.pill,
    paddingHorizontal: 9, paddingVertical: 2, marginTop: 4,
  },
  titleText: { fontFamily: fonts.heavy, fontSize: 11.5, includeFontPadding: false },
  renameRow: { flexDirection: 'row', gap: space.sm },
  input: {
    flex: 1, minHeight: TOUCH, borderRadius: radius.md, backgroundColor: colors.bg,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: space.md,
    fontFamily: fonts.bold, fontSize: 16, color: colors.ink,
  },
  cancel: { alignItems: 'center', paddingTop: space.sm, minHeight: 36, justifyContent: 'center' },
  error: { ...type.body, color: colors.danger, fontFamily: fonts.bold },
  wear: { marginTop: space.sm, minHeight: 34, justifyContent: 'center' },
  wearText: { fontFamily: fonts.heavy, fontSize: 13, color: colors.accentText, includeFontPadding: false },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stat: {
    width: '31.8%', flexGrow: 1, backgroundColor: colors.card, borderRadius: radius.md,
    paddingVertical: space.md, paddingHorizontal: space.sm + 2, gap: 2, ...shadow.card,
  },
  statValue: { fontFamily: fonts.black, fontSize: 18, color: colors.ink, includeFontPadding: false },
  badgeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.lg },
  badge: { width: '33.33%', paddingHorizontal: 4 },
  // The open badge sits above its neighbours so its bubble overlaps them.
  badgeOpen: { zIndex: 10, elevation: 10 },
  badgeTap: { alignItems: 'center', gap: 5 },
  bubble: {
    ...shadow.card, position: 'absolute', padding: space.md, borderRadius: radius.md, borderWidth: 1.5,
    backgroundColor: colors.card, elevation: 12,
  },
  bubbleDown: { top: '100%', marginTop: 10 },
  bubbleUp: { bottom: '100%', marginBottom: 10 },
  // A square turned 45 degrees, half hidden behind the bubble: the pointer.
  arrow: {
    position: 'absolute', width: 14, height: 14, backgroundColor: colors.card,
    transform: [{ rotate: '45deg' }],
  },
  arrowUp: { top: -8, borderTopWidth: 1.5, borderLeftWidth: 1.5 },
  arrowDown: { bottom: -8, borderBottomWidth: 1.5, borderRightWidth: 1.5 },
  badgeName: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink, textAlign: 'center', lineHeight: 15 },
  newTag: { position: 'absolute', top: -2, right: '18%', backgroundColor: colors.danger, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  newText: { color: '#FFFFFF', fontFamily: fonts.black, fontSize: 9, includeFontPadding: false },
  miniTrack: { width: 52, height: 4, borderRadius: 2, backgroundColor: colors.sunk, overflow: 'hidden' },
  miniFill: { height: '100%', backgroundColor: colors.steps },
});
