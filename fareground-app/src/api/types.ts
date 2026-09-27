/**
 * Response shapes from the Fareground backend.
 *
 * These mirror the backend's services by hand. When you change a response
 * there, change it here - the typecheck on both sides is what catches drift.
 * (A shared package would remove the duplication; for two small projects it
 * is not yet worth the build tooling.)
 */

export type Mineral = 'ROCKY' | 'COAL' | 'AMETHYST' | 'SAPPHIRE' | 'RUBY';

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  walkPoints: number;
  coins: number;
  createdAt: string;
}

export interface AuthResult {
  user: PublicUser;
  token: string;
  /** Google sign-in only: true when this created the account. */
  created?: boolean;
}

export type AdRewardKind =
  | 'BOOST'
  | 'WALK_POINTS'
  | 'DOUBLE'
  | 'INSTANT_COLLECT'
  | 'SCOUT'
  | 'COSMETIC'
  | 'UPGRADE'
  | 'EXTRA_CHECKIN'
  | 'STREAK_SAVE'
  | 'TREASURE'
  | 'PIT_STOP'
  | 'PHOTO'
  /** An ad is the price of a parcel, and the key to a treasure box. */
  | 'CLAIM'
  | 'TREASURE_KEY';

/**
 * `shoes` was added 2026-09-25, once the runner had chibi proportions and
 * feet worth looking at. It is the only slot that shows on the MAP but not
 * in the head-and-shoulders portrait.
 */
export type AvatarSlot = 'skin' | 'hair' | 'hat' | 'shirt' | 'shoes' | 'face';

/** How hard a part is to come by. Presentational - it changes no rules. */
export type AvatarRarity = 'COMMON' | 'UNCOMMON' | 'RARE' | 'LEGENDARY';
export type AvatarChoice = Partial<Record<AvatarSlot, string>>;

export interface RewardStatus {
  boost: {
    active: boolean;
    multiplier: number;
    endsAt: string | null;
    remainingSeconds: number;
    secondsPerAd: number;
    maxBankedSeconds: number;
    canAdd: boolean;
    /** No land yet, so a boost would earn nothing. */
    needsLand: boolean;
    adsLeftToday: number;
  };
  walkPoints: {
    perAd: number;
    adsLeftToday: number;
  };
  /** A leaderboard prize boost, if one is running. */
  prize: {
    active: boolean;
    multiplier: number;
    endsAt: string | null;
    remainingSeconds: number;
  };
  /** All running boosts added up: 1 = none. */
  activeMultiplier: number;
  /** When every adsLeftToday resets: the player's next local midnight (ISO). */
  resetsAt: string;
  /** Take the next couple of hours of income now. */
  instantCollect: {
    hours: number;
    coins: number;
    adsLeftToday: number;
    canCollect: boolean;
    /** No land yet, so nothing to collect - not a daily limit. */
    needsLand: boolean;
  };
  /** A wider claim reach for a few minutes. */
  scout: {
    active: boolean;
    endsAt: string | null;
    remainingSeconds: number;
    secondsPerAd: number;
    maxBankedSeconds: number;
    reachM: number;
    adsLeftToday: number;
    canAdd: boolean;
  };
}

export interface AdTicket {
  nonce: string;
  kind: AdRewardKind;
  expiresAt: string;
  userId: string;
}

export interface AdCompleteResult {
  granted: boolean;
  kind: AdRewardKind;
  amount: number | null;
  replayed: boolean;
}

export interface Balance {
  walkPoints: number;
  coins: number;
  totalParcels: number;
  /** Base income from land. */
  coinsPerMonth: number;
  /** Income right now, boost included. */
  effectiveCoinsPerMonth: number;
  coinsJustEarned: number;
  lastCoinClaimAt: string;
  /** What the NEXT parcel costs - it rises with land owned. */
  parcelPrice: number;
  stepsPerWalkPoint: number;
  rewards: RewardStatus;
  /** Your runner's colour (it follows your shirt). */
  jerseyColor: string;
  /** Your character, for the map and the profile button. */
  avatar: AvatarChoice;
  /** Uploaded picture, or null to fall back to your initial. */
  photoUrl: string | null;
  /** Badges unlocked but not looked at yet. */
  unseenBadges: number;
  /** Dollars, as a string - display only. `coins` is the real number. */
  redeemableUsd: string;
  usdPerSecond: number;
  /** Coins that buy one Walk Point in the store. */
  coinsPerWalkPoint: number;
  minRedemptionCoins: number;
  canRedeem: boolean;
}

/** What deleting an account would destroy. */
export interface DeleteSummary {
  username: string;
  parcels: number;
  coins: number;
  walkPoints: number;
  /** True when the account has a password and must supply it to delete. */
  needsPassword: boolean;
}

export interface ReferralStatus {
  code: string;
  invited: number;
  qualified: number;
  earned: number;
  rewardForYou: number;
  rewardForFriend: number;
  stepsToQualify: number;
  maxRewarded: number;
  canRedeem: boolean;
  redeemedCode: string | null;
}

export interface RedeemResult {
  invitedBy: string;
  reward: number;
  walkPointsBalance: number;
  stepsToQualify: number;
}

export interface StepSyncResult {
  stepsSubmitted: number;
  stepsAccepted: number;
  stepsRejected: number;
  limit: 'OK' | 'RATE_LIMIT' | 'DAILY_LIMIT';
  wpEarned: number;
  walkPointsBalance: number;
  lifetimeSteps: number;
  stepsUntilNextWalkPoint: number;
  stepsPerWalkPoint: number;
  /** WP just paid to whoever invited you, if you qualified with this sync. */
  referralBonusPaid: number;
  replayed: boolean;
}

export interface Parcel {
  id: string;
  rarity: Mineral;
  /** What it earns now, upgrades included. */
  coinsPerMonth: number;
  /** The mineral's own rate, before upgrades. */
  baseCoinsPerMonth: number;
  upgradeLevel: number;
  maxUpgradeLevel: number;
  /** Walk Points for the next upgrade, or null when fully upgraded. */
  nextUpgradeCostWp: number | null;
  cellX: number | null;
  cellY: number | null;
  cellRef: string | null;
  purchasedAt: string;
}

export interface ClaimResult {
  parcel: Parcel;
  walkPointsSpent: number;
  walkPointsBalance: number;
  nextParcelPrice: number;
}

export interface NearbyParcel {
  /** The plot's own id - identifies the LAND, never its owner. */
  id: string;
  cellX: number;
  cellY: number;
  rarity: Mineral;
  mine: boolean;
}

/**
 * Who else owns land around here.
 *
 * Names are never tied to a square, and the area is a fixed ~1 km box - see
 * the server's neighbours.service.ts for why. `neighbours` is empty in a
 * quiet area even when `count` is 1, because naming the only other player
 * present would locate them.
 */
export interface Neighbour {
  username: string;
  title: string | null;
  jerseyColor: string;
  parcels: number;
}

export interface NeighboursHere {
  count: number;
  neighbours: Neighbour[];
  claimedHere: number;
  yoursHere: number;
}

/* --------------------------------- pit stops --------------------------------- */

/**
 * A claimed parcel you are standing near. `mine` says whether it is yours;
 * it never says WHOSE it is otherwise - the map deliberately does not name
 * owners (see the server's neighbours.service.ts).
 */
export interface PitStopTarget {
  parcelId: string;
  rarity: Mineral;
  mine: boolean;
  distanceM: number;
  wp: number;
  firstEver: boolean;
  /** Seconds until this parcel pays again; 0 when it is ready. */
  readyInSeconds: number;
}

export interface PitStopStatus {
  /** Seconds left on the shared cooldown. 0 when you may stop freely. */
  cooldownSeconds: number;
  cooldownTotalSeconds: number;
  targets: PitStopTarget[];
  today: number;
}

export interface PitStopResult {
  claim: ClaimSummary;
  parcelId: string;
  rarity: Mineral;
  mine: boolean;
  firstEver: boolean;
  walkPointsBalance: number;
  cooldownSeconds: number;
  /** What the parcel's owner earned from this check-in (older servers omit it). */
  ownerWp?: number;
}

/* ---------------------------- daily chest + quests ---------------------------- */

export interface ClaimSummary {
  id: string;
  amount: number;
  doubled: boolean;
  /** Can an ad still double this reward? */
  canDouble: boolean;
}

export interface Quest {
  key: string;
  title: string;
  target: number;
  progress: number;
  rewardWp: number;
  ready: boolean;
  claim: ClaimSummary | null;
}

export interface DailyStatus {
  today: string;
  /** The player's next local midnight (ISO), worked out on the server. */
  resetsAt: string;
  daily: {
    available: boolean;
    streak: number;
    reward: number;
    week: number[];
    claimedToday: ClaimSummary | null;
  };
  quests: Quest[];
  checkin: CheckinStatus;
  /** A missed day an ad could forgive, keeping your streak alive. */
  streakSave: {
    missedDay: string | null;
    savesStreak: number;
    savesLeftThisWeek: number;
  };
  /** Watch a few ads today for a bonus chest. */
  adStreak: {
    adsToday: number;
    target: number;
    rewardWp: number;
    ready: boolean;
    claim: ClaimSummary | null;
  };
  claimable: number;
}

/* -------------------------------- treasure -------------------------------- */

export interface TreasureBox {
  id: string;
  lat: number;
  lng: number;
  rewardWp: number;
  expiresAt: string;
  fromAd: boolean;
}

export interface TreasureStatus {
  boxes: TreasureBox[];
  usedToday: number;
  freePerDay: number;
  maxPerDay: number;
  /** True when the next box costs a rewarded ad. */
  nextNeedsAd: boolean;
  collectWithinM: number;
}

export interface OpenBoxResult {
  rewardWp: number;
  walkPointsBalance: number;
  /** The reward, so an ad can double it. */
  claim: ClaimSummary;
}

export interface CheckinStatus {
  /** True when today's FREE visit is still unused. */
  available: boolean;
  today: { placeName: string | null; newPlace: boolean; claim: ClaimSummary } | null;
  /** How many places you have visited today. */
  countToday: number;
  /** After the free one, each visit costs a rewarded ad. */
  extraNeedsAd: boolean;
  streak: number;
  placesVisited: number;
  baseWp: number;
  newPlaceBonusWp: number;
}

/**
 * Today's destination. ONE place, rolled by the server and written down, so
 * walking towards it never moves it.
 */
export interface AreaTarget {
  key: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
  distanceM: number;
  /** Standing in it - the only time a check-in is accepted. */
  here: boolean;
  areaSizeM: number;
  visited: boolean;
  wp: number;
  fromAd: boolean;
}

export interface AreasStatus {
  target: AreaTarget | null;
  claimedToday: number;
  /** No open target and the next one costs an ad. */
  nextNeedsAd: boolean;
  extraNeedsAd: boolean;
}

export interface CheckinResult {
  claim: ClaimSummary;
  newPlace: boolean;
  placeName: string | null;
  walkPointsBalance: number;
}

/* ------------------------------- leaderboard ------------------------------- */

export type LeaderboardScope = 'CITY' | 'REGION' | 'COUNTRY' | 'WORLD';

export interface Leaderboard {
  scope: LeaderboardScope;
  areaName: string | null;
  week: { start: string; endsAt: string };
  entries: {
    rank: number;
    username: string;
    steps: number;
    you: boolean;
    jerseyColor: string;
    avatar: AvatarChoice;
    /** Uploaded picture, or null to fall back to their initial. */
    photoUrl: string | null;
    title: string | null;
  }[];
  me: { rank: number | null; steps: number };
  walkers: number;
  prizesActive: boolean;
  minWalkers: number;
  prizes: { rank: 1 | 2 | 3; multiplier: number; seconds: number }[];
  lastWeek: { scope: LeaderboardScope; areaName: string; rank: number; multiplier: number; seconds: number } | null;
}

/* --------------------------------- profile --------------------------------- */

export type BadgeTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'DIAMOND';
export type BadgeIconName = 'steps' | 'flag' | 'gem' | 'chest' | 'pin' | 'trophy' | 'bolt' | 'crown';

export interface Badge {
  key: string;
  name: string;
  description: string;
  tier: BadgeTier;
  icon: BadgeIconName;
  color?: string;
  unlocked: boolean;
  progress: number;
  target: number;
  unlockedAt: string | null;
  isNew: boolean;
}

export interface AvatarItemState {
  key: string;
  slot: AvatarSlot;
  name: string;
  unlock: 'FREE' | 'LEVEL' | 'BADGE' | 'AD';
  level?: number;
  badge?: string;
  color?: string;
  /** A second colour, for parts drawn in two tones (shoes: upper and trim). */
  accent?: string;
  rarity: AvatarRarity;
  unlocked: boolean;
  /** A locked item a rewarded ad can unlock right now. */
  buyable: boolean;
  requirement: string | null;
}

export interface Profile {
  username: string;
  joinedAt: string;
  jerseyColor: string;
  avatar: AvatarChoice;
  /** Uploaded picture, or null to fall back to their initial. */
  photoUrl: string | null;
  /** A badge shown next to their name. */
  title: string | null;
  /** Own profile only. */
  avatarItems?: AvatarItemState[];
  usernameChangeableAt?: string | null;
  level: { level: number; current: number; next: number };
  stats: {
    lifetimeSteps: number;
    thisWeekSteps: number;
    parcels: number;
    amethysts: number;
    sapphires: number;
    rubies: number;
    mineralKinds: number;
    bestChestStreak: number;
    bestCheckinStreak: number;
    placesVisited: number;
    podiums: number;
    wins: number;
    adsWatched: number;
  };
  badges: Badge[];
  badgeCount: { unlocked: number; total: number };
  isYou: boolean;
}

export interface RewardClaimResult {
  claim: ClaimSummary;
  streak?: number;
  walkPointsBalance: number;
}
