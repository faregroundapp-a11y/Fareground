import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { API_URL } from '@/config';
import { colors, fonts } from '@/theme';

/**
 * How a player appears everywhere they are listed: the map HUD, the walk tab,
 * the leaderboard.
 *
 * Two states, in order:
 *   1. Their uploaded photo.
 *   2. Otherwise the first letter of their name on a colour.
 *
 * The letter is NOT a placeholder to be embarrassed about - it is the default
 * look, it is legible at 24px where a photo is mud, and it means a brand-new
 * account has an identity before it has done anything.
 *
 * The colour is derived from the NAME, not chosen at random, so the same
 * player is the same colour on every device and in every list - which is what
 * makes it recognisable at a glance in a leaderboard.
 *
 * (The character avatar is a different thing and still used where there is
 * room for it: the profile, the editor, and the runner on the map.)
 */

/** Picked to stay legible as a background behind white text. */
const PALETTE = [
  '#2F5D50', // brand green
  '#C4801E', // amber deep
  '#8C1C31', // ruby deep
  '#3B5A8C', // sapphire
  '#6536D9', // boost violet
  '#1F7A4D', // good green
  '#9A4A1F', // rust
  '#4A4F63', // slate
];

/** Stable across devices: same name, same colour, forever. */
function colourFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** First real character of a name, uppercased. Falls back to a dot. */
function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  // Array.from, not [0], so an emoji or accented letter is not cut in half.
  return trimmed.length > 0 ? (Array.from(trimmed)[0] ?? '•').toUpperCase() : '•';
}

export function PlayerPicture({
  photoUrl,
  username,
  size = 44,
  ring,
}: {
  /** Server-relative path, e.g. "/photos/ab12.jpg". Null = use the initial. */
  photoUrl?: string | null;
  username?: string | null;
  size?: number;
  /** Ring colour, e.g. gold for a leaderboard winner. */
  ring?: string;
}) {
  const [broken, setBroken] = useState(false);

  const name = username ?? '';
  const colour = colourFor(name);
  const showPhoto = !!photoUrl && !broken;
  const border = ring ?? (showPhoto ? colors.line : colour);

  return (
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2, borderColor: border, backgroundColor: colour },
      ]}
    >
      {showPhoto ? (
        <Image
          // Paths come back server-relative so the same row works on any host.
          source={{ uri: photoUrl.startsWith('http') ? photoUrl : `${API_URL}${photoUrl}` }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          // A photo that 404s (moderated away, or the server moved) must fall
          // back to the initial rather than leaving a hole in the layout.
          onError={() => setBroken(true)}
        />
      ) : (
        <Text
          style={[styles.initial, { fontSize: size * 0.42, lineHeight: size * 0.52 }]}
          allowFontScaling={false}
        >
          {initialOf(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
  },
  initial: {
    // Never fontWeight with a custom font - it fakes bold and blurs the edges.
    fontFamily: fonts.black,
    color: '#FFFFFF',
    includeFontPadding: false,
    textAlign: 'center',
  },
});
