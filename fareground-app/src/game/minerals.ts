import type { Mineral } from '@/api/types';

/**
 * How each mineral looks and what it is worth. The rates and odds are
 * display copies of the backend's rules.ts - the server decides every real
 * number; these only label what it sends back.
 */
export const MINERALS: Record<
  Mineral,
  { label: string; color: string; odds: number; coinsPerMonth: number; heightM: number }
> = {
  // heightM: how tall the parcel stands as a 3D block on the map. Rarer
  // ground rises higher, so a Ruby is findable at a glance from down the street.
  ROCKY:    { label: 'Rocky',    color: '#8A887B', odds: 60, coinsPerMonth: 3,  heightM: 0.6 },
  COAL:     { label: 'Coal',     color: '#3B4048', odds: 25, coinsPerMonth: 4,  heightM: 1.0 },
  AMETHYST: { label: 'Amethyst', color: '#7E56A6', odds: 10, coinsPerMonth: 5,  heightM: 1.8 },
  SAPPHIRE: { label: 'Sapphire', color: '#2A5FA8', odds: 4,  coinsPerMonth: 8,  heightM: 2.8 },
  RUBY:     { label: 'Ruby',     color: '#C0304A', odds: 1,  coinsPerMonth: 25, heightM: 4.0 },
};

export const MINERAL_ORDER: Mineral[] = ['ROCKY', 'COAL', 'AMETHYST', 'SAPPHIRE', 'RUBY'];

/** Must match COIN_REDEMPTION_USD in the backend's rules.ts: 1,000 coins = $1. Display only. */
export const COIN_USD = 0.001;

/** Rates are per 30-day month, so a year is this many of them. */
export const MONTHS_PER_YEAR = 365 / 30;
