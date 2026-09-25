import type { Mineral } from '@/api/types';

/**
 * How each mineral looks and what it is worth. The rates and odds are
 * display copies of the backend's rules.ts - the server decides every real
 * number; these only label what it sends back.
 */
export const MINERALS: Record<
  Mineral,
  { label: string; color: string; odds: number; coinsPerHour: number; heightM: number }
> = {
  // heightM: how tall the parcel stands as a 3D block on the map. Rarer
  // ground rises higher, so a Ruby is findable at a glance from down the street.
  ROCKY:    { label: 'Rocky',    color: '#8A887B', odds: 60, coinsPerHour: 1,  heightM: 0.6 },
  COAL:     { label: 'Coal',     color: '#3B4048', odds: 25, coinsPerHour: 2,  heightM: 1.0 },
  AMETHYST: { label: 'Amethyst', color: '#7E56A6', odds: 10, coinsPerHour: 5,  heightM: 1.8 },
  SAPPHIRE: { label: 'Sapphire', color: '#2A5FA8', odds: 4,  coinsPerHour: 12, heightM: 2.8 },
  RUBY:     { label: 'Ruby',     color: '#C0304A', odds: 1,  coinsPerHour: 100, heightM: 4.0 },
};

export const MINERAL_ORDER: Mineral[] = ['ROCKY', 'COAL', 'AMETHYST', 'SAPPHIRE', 'RUBY'];

/** Must match COIN_REDEMPTION_USD on the server. Display only. */
// Must match COIN_REDEMPTION_USD in the backend's rules.ts. 2,500,000 = $1.
export const COIN_USD = 0.0000005;
