/**
 * Badges and levels - pure rules, no database, so they are easy to test.
 *
 * A badge is unlocked by a player's stats crossing a threshold. The server
 * works badges out from stats every time (so they can never drift out of
 * step), and separately remembers WHEN each was first unlocked and whether
 * the player has seen it yet (user_badges).
 */

export type BadgeTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND';
export type BadgeIcon = 'steps' | 'flag' | 'gem' | 'chest' | 'pin' | 'trophy' | 'bolt' | 'crown';

export interface PlayerStats {
  lifetimeSteps: number;
  parcels: number;
  amethysts: number;
  sapphires: number;
  rubies: number;
  /** Distinct minerals owned, out of 5. */
  mineralKinds: number;
  bestChestStreak: number;
  bestCheckinStreak: number;
  placesVisited: number;
  podiums: number;
  wins: number;
  adsWatched: number;
}

export interface BadgeDefinition {
  key: string;
  name: string;
  description: string;
  tier: BadgeTier;
  icon: BadgeIcon;
  /** The stat that counts toward it, and the target. */
  stat: keyof PlayerStats;
  target: number;
  /** Colour for gems and similar, so a Ruby badge is red. */
  color?: string;
}

export const BADGES: readonly BadgeDefinition[] = [
  // walking
  { key: 'first_steps', name: 'First Steps', description: 'Walk 1,000 steps', tier: 'BRONZE', icon: 'steps', stat: 'lifetimeSteps', target: 1_000 },
  { key: 'walker', name: 'Walker', description: 'Walk 50,000 steps', tier: 'SILVER', icon: 'steps', stat: 'lifetimeSteps', target: 50_000 },
  { key: 'trekker', name: 'Trekker', description: 'Walk 250,000 steps', tier: 'GOLD', icon: 'steps', stat: 'lifetimeSteps', target: 250_000 },
  { key: 'marathoner', name: 'Globetrotter', description: 'Walk 1,000,000 steps', tier: 'DIAMOND', icon: 'steps', stat: 'lifetimeSteps', target: 1_000_000 },
  // land
  { key: 'first_claim', name: 'Homesteader', description: 'Claim your first parcel', tier: 'BRONZE', icon: 'flag', stat: 'parcels', target: 1 },
  { key: 'landowner', name: 'Landowner', description: 'Own 10 parcels', tier: 'SILVER', icon: 'flag', stat: 'parcels', target: 10 },
  { key: 'baron', name: 'Land Baron', description: 'Own 50 parcels', tier: 'GOLD', icon: 'flag', stat: 'parcels', target: 50 },
  { key: 'tycoon', name: 'Tycoon', description: 'Own 200 parcels', tier: 'DIAMOND', icon: 'crown', stat: 'parcels', target: 200 },
  // finds
  { key: 'amethyst', name: 'Purple Patch', description: 'Find an Amethyst parcel', tier: 'BRONZE', icon: 'gem', stat: 'amethysts', target: 1, color: '#7E56A6' },
  { key: 'sapphire', name: 'Deep Blue', description: 'Find a Sapphire parcel', tier: 'SILVER', icon: 'gem', stat: 'sapphires', target: 1, color: '#2A5FA8' },
  { key: 'ruby', name: 'Red Letter Day', description: 'Find a Ruby parcel', tier: 'GOLD', icon: 'gem', stat: 'rubies', target: 1, color: '#C0304A' },
  { key: 'ruby_hoard', name: 'Ruby Hoard', description: 'Own 10 Ruby parcels', tier: 'DIAMOND', icon: 'gem', stat: 'rubies', target: 10, color: '#C0304A' },
  { key: 'collector', name: 'Collector', description: 'Own every kind of mineral', tier: 'GOLD', icon: 'gem', stat: 'mineralKinds', target: 5, color: '#F2A93B' },
  // habits
  { key: 'week_streak', name: 'Week Warrior', description: 'Open the daily chest 7 days in a row', tier: 'SILVER', icon: 'chest', stat: 'bestChestStreak', target: 7 },
  { key: 'month_streak', name: 'Unstoppable', description: 'Open the daily chest 30 days in a row', tier: 'GOLD', icon: 'chest', stat: 'bestChestStreak', target: 30 },
  { key: 'explorer', name: 'Explorer', description: 'Visit 10 different places', tier: 'SILVER', icon: 'pin', stat: 'placesVisited', target: 10 },
  { key: 'cartographer', name: 'Cartographer', description: 'Visit 50 different places', tier: 'GOLD', icon: 'pin', stat: 'placesVisited', target: 50 },
  { key: 'regular', name: 'Regular', description: 'Visit somewhere 7 days in a row', tier: 'SILVER', icon: 'pin', stat: 'bestCheckinStreak', target: 7 },
  // competing
  { key: 'podium', name: 'On the Podium', description: 'Finish top 3 on a weekly leaderboard', tier: 'GOLD', icon: 'trophy', stat: 'podiums', target: 1 },
  { key: 'champion', name: 'Champion', description: 'Finish 1st on a weekly leaderboard', tier: 'DIAMOND', icon: 'trophy', stat: 'wins', target: 1 },
  { key: 'powered_up', name: 'Powered Up', description: 'Use 25 power-ups', tier: 'BRONZE', icon: 'bolt', stat: 'adsWatched', target: 25 },
] as const;

export interface BadgeState {
  key: string;
  name: string;
  description: string;
  tier: BadgeTier;
  icon: BadgeIcon;
  color?: string;
  unlocked: boolean;
  /** Progress toward it, capped at the target. */
  progress: number;
  target: number;
}

export function badgeStates(stats: PlayerStats): BadgeState[] {
  return BADGES.map((b) => {
    const value = stats[b.stat];
    return {
      key: b.key,
      name: b.name,
      description: b.description,
      tier: b.tier,
      icon: b.icon,
      color: b.color,
      unlocked: value >= b.target,
      progress: Math.min(value, b.target),
      target: b.target,
    };
  });
}

/**
 * Level from lifetime steps: each level needs a little more walking than the
 * last. Level 2 at 2,500 steps, 5 at 40,000, 10 at 202,500, 20 at 902,500.
 */
export const STEPS_PER_LEVEL_UNIT = 2_500;

export function levelFor(lifetimeSteps: number): { level: number; current: number; next: number } {
  const level = Math.floor(Math.sqrt(Math.max(0, lifetimeSteps) / STEPS_PER_LEVEL_UNIT)) + 1;
  const stepsFor = (l: number) => (l - 1) * (l - 1) * STEPS_PER_LEVEL_UNIT;
  return { level, current: stepsFor(level), next: stepsFor(level + 1) };
}

/** Runner jersey colours a player can pick. */
export const JERSEY_COLORS = [
  '#2F5D50', '#2A5FA8', '#7E56A6', '#C0304A', '#D9822B', '#1F7A8C', '#3B4048', '#E0559A',
] as const;
