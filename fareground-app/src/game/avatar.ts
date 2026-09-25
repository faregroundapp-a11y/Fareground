import type { AvatarSlot } from '@/api/types';

/**
 * Colours for avatar parts, mirrored from the backend's game/avatar.ts.
 *
 * The server owns what is unlocked and what is valid; this is only so the app
 * can DRAW a part it is given (on the leaderboard, say, where all it receives
 * is the part's key). Keep the two in step - a missing key just falls back to
 * a sensible colour, never a crash.
 */
export const PART_COLOR: Record<string, string> = {
  // shoes - the slot that shows on the map runner rather than the portrait
  shoes_trainers: '#FFFFFF',
  shoes_runners: '#E8EBEF',
  shoes_boots: '#8A5533',
  shoes_hitops: '#C0304A',
  shoes_sandals: '#D79A69',
  shoes_wellies: '#1F7A8C',
  shoes_track: '#4DBE94',
  shoes_gold: '#E0B93C',
  // parts added with the badge pass
  hat_explorer: '#7A6A4A',
  hat_flatcap: '#5B6470',
  hat_winter: '#2A5FA8',
  hair_snow: '#F0F2F5',
  hair_amethyst: '#9B6BC9',
  face_monocle: '#E0B93C',
  shirt_sapphire: '#2E6FBF',
  shirt_hoard: '#8E1B33',
  shirt_streak: '#E86A1C',
  shirt_collector: '#3D8B7A',
  shirt_charged: '#5B3FBF',
  skin_1: '#F4D3B8', skin_2: '#E7B48C', skin_3: '#D79A69',
  skin_4: '#B87A4E', skin_5: '#8A5533', skin_6: '#5C3721',

  hair_none: 'transparent', hair_short: '#2B2018', hair_curls: '#39271A', hair_long: '#8A5A2B',
  hair_bun: '#2B2018', hair_ginger: '#C2551F', hair_silver: '#C9CDD2', hair_punk: '#7E56A6',

  hat_none: 'transparent', hat_cap: '#F2A93B', hat_beanie: '#2A5FA8', hat_band: '#D24B5E',
  hat_bucket: '#4DBE94', hat_visor: '#E0559A', hat_crown: '#F2B53B', hat_miner: '#D9822B',

  shirt_forest: '#2F5D50', shirt_ocean: '#2A5FA8', shirt_violet: '#7E56A6', shirt_ruby: '#C0304A',
  shirt_amber: '#D9822B', shirt_teal: '#1F7A8C', shirt_slate: '#3B4048', shirt_rose: '#E0559A',
  shirt_mint: '#4DBE94', shirt_sun: '#F2A93B', shirt_night: '#141A2B', shirt_gold: '#E0B93C',

  face_none: 'transparent', face_glasses: '#3B4048', face_shades: '#141A2B',
  face_scarf: '#D24B5E', face_beard: '#39271A', face_medal: '#F2B53B',
};

/**
 * A second colour for parts drawn in two tones. Shoes are the only slot that
 * uses it: an upper and a sole read as footwear where one flat colour reads
 * as a blob.
 */
export const PART_ACCENT: Record<string, string> = {
  shoes_trainers: '#F2A93B',
  shoes_runners: '#2A5FA8',
  shoes_boots: '#39271A',
  shoes_hitops: '#FFFFFF',
  shoes_sandals: '#8A5533',
  shoes_wellies: '#14505C',
  shoes_track: '#141A2B',
  shoes_gold: '#8A6A12',
};

export const partAccent = (key: string | undefined, fallback = '#F2A93B') =>
  (key ? PART_ACCENT[key] : undefined) ?? fallback;

export const DEFAULT_AVATAR: Record<AvatarSlot, string> = {
  skin: 'skin_2',
  hair: 'hair_short',
  hat: 'hat_none',
  shirt: 'shirt_forest',
  shoes: 'shoes_trainers',
  face: 'face_none',
};

/** The parts of an avatar, with anything missing filled in. */
export function avatarOf(a: Partial<Record<AvatarSlot, string>> | null | undefined): Record<AvatarSlot, string> {
  return { ...DEFAULT_AVATAR, ...(a ?? {}) };
}

export const partColor = (key: string | undefined, fallback = '#2B2018') =>
  (key ? PART_COLOR[key] : undefined) ?? fallback;

/** Slots in the order the editor shows them. */
export const SLOT_ORDER: { slot: AvatarSlot; label: string }[] = [
  { slot: 'skin', label: 'Skin' },
  { slot: 'hair', label: 'Hair' },
  { slot: 'hat', label: 'Hat' },
  { slot: 'shirt', label: 'Shirt' },
  { slot: 'shoes', label: 'Shoes' },
  { slot: 'face', label: 'Extras' },
];
