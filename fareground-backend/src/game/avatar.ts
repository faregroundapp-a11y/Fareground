/**
 * Avatars: the character that is a player's profile picture.
 *
 * Every part is drawn by the app (the same runner as on the map), so there
 * are no photo uploads to store, host or moderate - and nobody can put
 * someone else's face, or worse, on their profile.
 *
 * Parts unlock in four ways:
 *   FREE    everyone has it
 *   LEVEL   reach a level
 *   BADGE   earn a badge
 *   AD      watch a rewarded ad, once, and keep it forever
 *
 * AD items are the best possible ad placement: people watch willingly for
 * something they want, and a hat costs us nothing at all - unlike anything
 * that pays out coins.
 */

export type UnlockKind = 'FREE' | 'LEVEL' | 'BADGE' | 'AD';

/**
 * SHOES were added on 2026-09-25, once the runner was redrawn on chibi
 * proportions and actually had feet worth looking at. They are the only slot
 * that shows on the MAP but not in the head-and-shoulders portrait, which
 * makes them the reward for people who look at their own runner.
 */
export type AvatarSlot = 'skin' | 'hair' | 'hat' | 'shirt' | 'face' | 'shoes';

/**
 * How hard a part is to get. Purely presentational - it changes nothing about
 * the unlock rules - but a collection needs structure or it reads as a list.
 *
 *   COMMON     everyone has it, or a low level
 *   UNCOMMON   a mid level, or one rewarded ad
 *   RARE       a badge most players will earn eventually
 *   LEGENDARY  a badge almost nobody has
 */
export type AvatarRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'LEGENDARY';

export interface AvatarItem {
  key: string;
  slot: AvatarSlot;
  name: string;
  unlock: UnlockKind;
  /** For LEVEL: the level needed. For BADGE: the badge key. */
  level?: number;
  badge?: string;
  /** Colour, where the part is just a colour (skin, shirt, shoes). */
  color?: string;
  /** A second colour, for parts drawn in two tones (shoes: sole and trim). */
  accent?: string;
  /** Set explicitly only where the derived tier would be wrong. */
  rarity?: AvatarRarity;
}

const skin = (key: string, name: string, color: string): AvatarItem => ({ key, slot: 'skin', name, unlock: 'FREE', color });
const shirt = (key: string, name: string, color: string, extra: Partial<AvatarItem> = {}): AvatarItem => ({
  key, slot: 'shirt', name, unlock: 'FREE', color, ...extra,
});

export const AVATAR_ITEMS: readonly AvatarItem[] = [
  // skin tones - always free, never earned or sold
  skin('skin_1', 'Porcelain', '#F4D3B8'),
  skin('skin_2', 'Sand', '#E7B48C'),
  skin('skin_3', 'Honey', '#D79A69'),
  skin('skin_4', 'Bronze', '#B87A4E'),
  skin('skin_5', 'Umber', '#8A5533'),
  skin('skin_6', 'Ebony', '#5C3721'),

  // hair
  { key: 'hair_none', slot: 'hair', name: 'Shaved', unlock: 'FREE' },
  { key: 'hair_short', slot: 'hair', name: 'Short', unlock: 'FREE', color: '#2B2018' },
  { key: 'hair_curls', slot: 'hair', name: 'Curls', unlock: 'FREE', color: '#39271A' },
  { key: 'hair_long', slot: 'hair', name: 'Long', unlock: 'FREE', color: '#8A5A2B' },
  { key: 'hair_bun', slot: 'hair', name: 'Top knot', unlock: 'LEVEL', level: 3, color: '#2B2018' },
  { key: 'hair_ginger', slot: 'hair', name: 'Ginger', unlock: 'LEVEL', level: 5, color: '#C2551F' },
  { key: 'hair_silver', slot: 'hair', name: 'Silver', unlock: 'BADGE', badge: 'trekker', color: '#C9CDD2' },
  { key: 'hair_punk', slot: 'hair', name: 'Mohawk', unlock: 'AD', color: '#7E56A6' },
  { key: 'hair_snow', slot: 'hair', name: 'Snow white', unlock: 'BADGE', badge: 'cartographer', color: '#F0F2F5' },
  { key: 'hair_amethyst', slot: 'hair', name: 'Amethyst', unlock: 'BADGE', badge: 'amethyst', color: '#9B6BC9' },

  // hats
  { key: 'hat_none', slot: 'hat', name: 'No hat', unlock: 'FREE' },
  { key: 'hat_cap', slot: 'hat', name: 'Cap', unlock: 'FREE', color: '#F2A93B' },
  { key: 'hat_beanie', slot: 'hat', name: 'Beanie', unlock: 'LEVEL', level: 4, color: '#2A5FA8' },
  { key: 'hat_band', slot: 'hat', name: 'Headband', unlock: 'BADGE', badge: 'walker', color: '#D24B5E' },
  { key: 'hat_bucket', slot: 'hat', name: 'Bucket hat', unlock: 'AD', color: '#4DBE94' },
  { key: 'hat_visor', slot: 'hat', name: 'Visor', unlock: 'AD', color: '#E0559A' },
  { key: 'hat_crown', slot: 'hat', name: 'Crown', unlock: 'BADGE', badge: 'champion', color: '#F2B53B' },
  { key: 'hat_miner', slot: 'hat', name: 'Miner helmet', unlock: 'BADGE', badge: 'ruby', color: '#D9822B' },
  // FIFTEEN BADGES HAD NO COSMETIC ATTACHED. A badge that unlocks nothing is
  // a line in a list; one that changes how you look on the map is a reason to
  // go and earn it. These connect the ones that were doing nothing.
  { key: 'hat_explorer', slot: 'hat', name: 'Explorer hat', unlock: 'BADGE', badge: 'explorer', color: '#7A6A4A' },
  { key: 'hat_flatcap', slot: 'hat', name: 'Flat cap', unlock: 'BADGE', badge: 'regular', color: '#5B6470' },
  { key: 'hat_winter', slot: 'hat', name: 'Winter hat', unlock: 'BADGE', badge: 'month_streak', color: '#2A5FA8' },

  // shirts (also the runner's jersey on the map)
  shirt('shirt_forest', 'Forest', '#2F5D50'),
  shirt('shirt_ocean', 'Ocean', '#2A5FA8'),
  shirt('shirt_violet', 'Violet', '#7E56A6'),
  shirt('shirt_ruby', 'Ruby', '#C0304A'),
  shirt('shirt_amber', 'Amber', '#D9822B'),
  shirt('shirt_teal', 'Teal', '#1F7A8C'),
  shirt('shirt_slate', 'Slate', '#3B4048'),
  shirt('shirt_rose', 'Rose', '#E0559A'),
  shirt('shirt_mint', 'Mint', '#4DBE94', { unlock: 'LEVEL', level: 6 }),
  shirt('shirt_sun', 'Sunrise', '#F2A93B', { unlock: 'AD' }),
  shirt('shirt_night', 'Midnight', '#141A2B', { unlock: 'AD' }),
  shirt('shirt_gold', 'Gold kit', '#E0B93C', { unlock: 'BADGE', badge: 'tycoon' }),
  shirt('shirt_sapphire', 'Sapphire', '#2E6FBF', { unlock: 'BADGE', badge: 'sapphire' }),
  shirt('shirt_hoard', 'Ruby hoard', '#8E1B33', { unlock: 'BADGE', badge: 'ruby_hoard' }),
  shirt('shirt_streak', 'Streak stripes', '#E86A1C', { unlock: 'BADGE', badge: 'week_streak' }),
  shirt('shirt_collector', "Collector's kit", '#3D8B7A', { unlock: 'BADGE', badge: 'collector' }),
  shirt('shirt_charged', 'Charged', '#5B3FBF', { unlock: 'BADGE', badge: 'powered_up' }),

  // shoes - the slot that shows on the map runner rather than the portrait
  { key: 'shoes_trainers', slot: 'shoes', name: 'Trainers', unlock: 'FREE', color: '#FFFFFF', accent: '#F2A93B' },
  { key: 'shoes_runners', slot: 'shoes', name: 'Road runners', unlock: 'FREE', color: '#E8EBEF', accent: '#2A5FA8' },
  { key: 'shoes_boots', slot: 'shoes', name: 'Walking boots', unlock: 'LEVEL', level: 3, color: '#8A5533', accent: '#39271A' },
  { key: 'shoes_hitops', slot: 'shoes', name: 'High tops', unlock: 'LEVEL', level: 7, color: '#C0304A', accent: '#FFFFFF' },
  { key: 'shoes_sandals', slot: 'shoes', name: 'Sandals', unlock: 'AD', color: '#D79A69', accent: '#8A5533' },
  { key: 'shoes_wellies', slot: 'shoes', name: 'Wellies', unlock: 'AD', color: '#1F7A8C', accent: '#14505C' },
  { key: 'shoes_track', slot: 'shoes', name: 'Track spikes', unlock: 'BADGE', badge: 'marathoner', color: '#4DBE94', accent: '#141A2B' },
  { key: 'shoes_gold', slot: 'shoes', name: 'Golden boots', unlock: 'BADGE', badge: 'champion', color: '#E0B93C', accent: '#8A6A12' },

  // face
  { key: 'face_none', slot: 'face', name: 'Nothing', unlock: 'FREE' },
  { key: 'face_glasses', slot: 'face', name: 'Glasses', unlock: 'FREE', color: '#3B4048' },
  { key: 'face_shades', slot: 'face', name: 'Shades', unlock: 'AD', color: '#141A2B' },
  { key: 'face_scarf', slot: 'face', name: 'Scarf', unlock: 'LEVEL', level: 8, color: '#D24B5E' },
  { key: 'face_beard', slot: 'face', name: 'Beard', unlock: 'FREE', color: '#39271A' },
  { key: 'face_medal', slot: 'face', name: 'Medal', unlock: 'BADGE', badge: 'podium', color: '#F2B53B' },
  { key: 'face_monocle', slot: 'face', name: 'Monocle', unlock: 'BADGE', badge: 'baron', color: '#E0B93C' },
] as const;

export const AVATAR_SLOTS: readonly AvatarSlot[] = ['skin', 'hair', 'hat', 'shirt', 'shoes', 'face'];

export const DEFAULT_AVATAR: Record<AvatarSlot, string> = {
  skin: 'skin_2',
  hair: 'hair_short',
  hat: 'hat_none',
  shirt: 'shirt_forest',
  shoes: 'shoes_trainers',
  face: 'face_none',
};

/**
 * How hard a part is to come by.
 *
 * DERIVED from the unlock rule rather than written on every item, so a part
 * cannot claim to be legendary while being free. Only the handful of items
 * whose derived tier would be wrong carry an explicit `rarity`.
 */
export function rarityOf(item: AvatarItem): AvatarRarity {
  if (item.rarity) return item.rarity;
  if (item.unlock === 'FREE') return 'COMMON';
  if (item.unlock === 'AD') return 'UNCOMMON';
  if (item.unlock === 'LEVEL') return (item.level ?? 0) >= 7 ? 'RARE' : 'UNCOMMON';
  // BADGE: the handful nobody earns by accident are the legendary ones.
  return LEGENDARY_BADGES.has(item.badge ?? '') ? 'LEGENDARY' : 'RARE';
}

/**
 * The badges almost nobody has. Kept as a list rather than a rule because
 * "how hard is this badge" is a judgement about the player base, not
 * something derivable from the badge definition.
 */
const LEGENDARY_BADGES = new Set(['champion', 'tycoon', 'ruby_hoard', 'month_streak', 'cartographer']);

/** Every part in a slot, rarest last, for the editor. */
export function itemsForSlot(slot: AvatarSlot): AvatarItem[] {
  const order: Record<AvatarRarity, number> = { COMMON: 0, UNCOMMON: 1, RARE: 2, LEGENDARY: 3 };
  return AVATAR_ITEMS.filter((i) => i.slot === slot).sort(
    (a, b) => order[rarityOf(a)] - order[rarityOf(b)],
  );
}

const BY_KEY = new Map(AVATAR_ITEMS.map((i) => [i.key, i]));
export const avatarItem = (key: string): AvatarItem | undefined => BY_KEY.get(key);

/** Which items a player has, given their level, badges and ad unlocks. */
export function unlockedItems(input: { level: number; badges: Set<string>; bought: Set<string> }): Set<string> {
  const out = new Set<string>();
  for (const item of AVATAR_ITEMS) {
    const has =
      item.unlock === 'FREE' ||
      (item.unlock === 'LEVEL' && input.level >= (item.level ?? 0)) ||
      (item.unlock === 'BADGE' && !!item.badge && input.badges.has(item.badge)) ||
      (item.unlock === 'AD' && input.bought.has(item.key));
    if (has) out.add(item.key);
  }
  return out;
}

/**
 * Clean an avatar choice: every slot filled, every part real and unlocked.
 * Anything else falls back to the default, so a stale or tampered-with choice
 * can never break a profile.
 */
export function sanitizeAvatar(
  choice: Partial<Record<AvatarSlot, string>> | null | undefined,
  unlocked: Set<string>,
  /** What to keep for a slot whose choice is no good - what they wore before. */
  fallback: Record<AvatarSlot, string> = DEFAULT_AVATAR,
): Record<AvatarSlot, string> {
  const out = { ...DEFAULT_AVATAR, ...fallback };
  for (const slot of AVATAR_SLOTS) {
    const key = choice?.[slot];
    const item = key ? BY_KEY.get(key) : undefined;
    if (item && item.slot === slot && unlocked.has(item.key)) out[slot] = item.key;
  }
  return out;
}

/** The shirt colour, which is also the runner's jersey on the map. */
export function jerseyColorOf(avatar: Record<AvatarSlot, string>): string {
  return BY_KEY.get(avatar.shirt)?.color ?? '#2F5D50';
}

/** Items a rewarded ad can unlock. */
export const AD_UNLOCKABLE = AVATAR_ITEMS.filter((i) => i.unlock === 'AD').map((i) => i.key);

/** How long a name must wait before it can change again. */
export const USERNAME_CHANGE_DAYS = 30;
