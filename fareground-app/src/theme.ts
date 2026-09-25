import { Platform, type TextStyle } from 'react-native';

/**
 * Design tokens.
 *
 * The map (OpenFreeMap "liberty") is colourful, so everything laid over it is
 * dark glass, and the saturated colours are kept for the things that matter:
 * minerals, the claim button, coins and boosts.
 *
 * "Comfortable but sharp": generous spacing and big touch targets, but crisp
 * edges - hairline borders instead of heavy blurry shadows, and real font
 * weights (see `fonts`) instead of synthesised bold.
 */
export const colors = {
  // surfaces
  bg: '#F4F5F1',
  card: '#FFFFFF',
  sunk: '#ECEEE8',
  line: '#E0E3DB',
  lineStrong: '#CDD1C7',

  // text
  ink: '#121814',
  ink2: '#545E51',
  ink3: '#8A9386',

  // brand
  accent: '#2F5D50',
  accentHi: '#3C7564',
  accentSoft: '#E1EBE6',
  accentInk: '#FFFFFF',

  // the HUD floats over the map: dark glass in every theme
  glass: 'rgba(14,19,26,0.84)',
  glassHi: 'rgba(255,255,255,0.08)',
  glassLine: 'rgba(255,255,255,0.14)',
  glassInk: '#F5F7F3',
  glassInk2: 'rgba(245,247,243,0.64)',

  claim: '#F2A93B',
  claimHi: '#FFC968',
  claimDeep: '#C4801E',
  claimInk: '#2A1A03',

  // boosts: electric violet, distinct from every mineral
  boost: '#8A5CF6',
  boostHi: '#A98BFF',
  boostDeep: '#6536D9',
  boostSoft: '#EFE9FF',

  coin: '#F2B53B',
  steps: '#4DBE94',
  grid: '#E39A2E',
  good: '#7FD99A',
  goodInk: '#1F7A4D',
  danger: '#D24B5E',
  dangerSoft: '#FBE9EC',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;

/** Nothing tappable is smaller than this (Android's guideline is 48 dp). */
export const TOUCH = 48;

export const shadow = {
  /** Cards sit on a hairline, with only a whisper of shadow - crisp, not fuzzy. */
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#0B1410',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  float: {
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
} as const;

export const mono = { fontVariant: ['tabular-nums' as const] };

/**
 * Typography: Nunito, a rounded face that stays crisp at small sizes.
 *
 * Every weight is its OWN font file, referenced by name. Do not use
 * `fontWeight` with these: on Android a custom font plus fontWeight makes the
 * system synthesise a fake bold (smeared, blurry edges) or fall back to Roboto.
 * Picking the real weight's file is what keeps text sharp.
 */
export const fonts = {
  regular: 'Nunito_500Medium',
  medium: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  heavy: 'Nunito_800ExtraBold',
  black: 'Nunito_900Black',
} as const;

/**
 * Android pads text boxes for accents it never draws, which knocks text a
 * pixel or two off-centre in buttons and pills. Turning that off keeps
 * labels optically centred - part of looking "sharp".
 */
const tight: TextStyle = Platform.OS === 'android' ? { includeFontPadding: false } : {};

/** The type scale. Use these rather than ad-hoc sizes. */
export const type = {
  display: { fontFamily: fonts.black, fontSize: 32, letterSpacing: -0.8, color: colors.ink, ...tight },
  title: { fontFamily: fonts.black, fontSize: 24, letterSpacing: -0.5, color: colors.ink, ...tight },
  headline: { fontFamily: fonts.heavy, fontSize: 17, color: colors.ink, ...tight },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.ink2 },
  label: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink, ...tight },
  caption: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.ink3, ...tight },
  overline: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.3, color: colors.ink3, ...tight },
  number: { fontFamily: fonts.black, fontVariant: ['tabular-nums'], color: colors.ink, ...tight },
} satisfies Record<string, TextStyle>;
