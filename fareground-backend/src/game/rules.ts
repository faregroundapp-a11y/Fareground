/**
 * ===========================================================================
 *  THE ECONOMY - single source of truth.
 * ===========================================================================
 *  Every number that defines how Fareground "feels" lives in this one file.
 *  Want to make parcels cheaper or RUBY rarer? Change it here and nowhere
 *  else. Nothing in this file touches the database or the network, which also
 *  makes it trivial to unit-test later.
 */
import { randomInt } from 'node:crypto';

/**
 * 100 steps convert into 1 Walk Point (WP).
 *
 * This was 1,000 steps per WP with a flat 100 WP parcel - 100,000 steps, about
 * two weeks of walking, before a new player saw their first reward. Nobody
 * stays for that. Small WP units also make the counter tick while you walk.
 */
export const STEPS_PER_WALK_POINT = 100;

/**
 * ---------------------------------------------------------------------------
 *  PARCEL PRICE - 50 WP, +1 for every 10 parcels owned.
 * ---------------------------------------------------------------------------
 *  5,000 steps buys a first parcel. It was flat from 2026-09-26 ("I don't
 *  want prices to increase") until the 2026-09-27 rate cut, when the product
 *  owner asked for a rising price alongside it.
 *
 *  History, because the trade is the same whoever tunes this next: it rose
 *  (20 WP + 8 per parcel owned) until 2026-09-24, went flat at 20 then 50,
 *  rose gently again (+1) for two days, went flat, and RISES AGAIN from
 *  2026-09-27 at the product owner's request: +1 WP for every 10 parcels
 *  owned. Gentle on purpose - the first parcels are unchanged and a player
 *  on 400 pays 90 WP - but it bends the line: land owed no longer grows in
 *  step with walking, it slows as a holding gets big.
 *
 *      owned     0     50    100    200    400    1,000
 *      price    50     55     60     70     90      150 WP
 *
 *  Reaching 400 parcels takes 27,800 WP instead of 20,000 (+39%).
 */
export const PARCEL_BASE_PRICE_WP = 50;

/** +PARCEL_PRICE_STEP_WP for every PARCEL_PRICE_STEP_EVERY parcels owned. */
export const PARCEL_PRICE_STEP_WP: number = 1;
export const PARCEL_PRICE_STEP_EVERY = 10;

/** What the NEXT parcel costs, given how many the player already owns. */
export function parcelPriceWp(owned: number): number {
  return PARCEL_BASE_PRICE_WP + PARCEL_PRICE_STEP_WP * Math.floor(Math.max(0, Math.floor(owned)) / PARCEL_PRICE_STEP_EVERY);
}

/** Kept for older callers: the price of a first parcel. */
export const WALK_POINTS_PER_PARCEL = PARCEL_BASE_PRICE_WP;

/**
 * Every new account starts with exactly one parcel's worth of WP, so the
 * first thing a new player does is claim land, not read an explainer.
 *
 * DERIVED ON PURPOSE. It tracks the parcel price, so raising the price can
 * never quietly leave a new player unable to afford their first claim -
 * which would break the only part of onboarding that matters.
 */
export const SIGNUP_BONUS_WP = PARCEL_BASE_PRICE_WP;

/**
 * ---------------------------------------------------------------------------
 *  REWARDED ADS - the revenue engine.
 * ---------------------------------------------------------------------------
 *  Every ad is opt-in: a player chooses to watch one for a reward. The two
 *  plainest are BOOST (20x coins for 30 minutes) and WALK_POINTS (+5 WP);
 *  the rest are listed below. Each has a cap per LOCAL day - they protect
 *  us, since every reward is a real cost, and ad networks pay less for a
 *  player who watches forty in a row. One rewarded ad earns us roughly
 *  $0.008-0.025 depending mostly on the viewer's country.
 */
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
  // 2026-09-27: an ad is the price of claiming a parcel, and the key to a
  // treasure box. Both are spent by the action they unlock (see AD_GATES).
  | 'CLAIM'
  | 'TREASURE_KEY'
  // 2026-09-28: the "bonus" ad offered right after claiming a parcel. One per
  // parcel, and NOT one of the day's MAX_WP_ADS_PER_DAY - it is extra.
  | 'CLAIM_BONUS'
  // 2026-10-05: breaks the chains on steps - see STEPS_PER_UNLOCK_AD.
  | 'UNLOCK_STEPS';

/**
 * CHAINED STEPS (2026-10-05, the product owner's call).
 *
 * Walk Points from steps no longer land in the balance on their own. They
 * build up, chained, in users.locked_wp, and each rewarded ad breaks the
 * chain on STEPS_PER_UNLOCK_AD steps' worth. Nothing chained is ever lost -
 * a player who skips a day just has more to unlock - and a daily push
 * reminds them when there is at least one ad's worth waiting.
 *
 * Builds from STEP_LOCK_FROM_BUILD know about the chains; older ones are
 * paid straight in as before, until MIN_APP_BUILD retires them (setting
 * MIN_APP_BUILD to this or higher turns the chains on for everyone).
 */
export const STEPS_PER_UNLOCK_AD = 1_000;
export const UNLOCK_WP_PER_AD = STEPS_PER_UNLOCK_AD / STEPS_PER_WALK_POINT;
export const STEP_LOCK_FROM_BUILD = 10;

/**
 * ---------------------------------------------------------------------------
 *  THE BOOST - TerraMine's shape, because testers compare us with it.
 * ---------------------------------------------------------------------------
 *  20x coins, 30 minutes per rewarded ad, banking up to 24 hours, and up to
 *  48 ads a day - boosted around the clock, exactly as TerraMine allows. The
 *  2026-09-26 target was about 400 parcels fully boosted = $1 a day. The
 *  2026-09-27 rate cut (see RARITY_TABLE) brings that to about $0.22 a day:
 *  400 x 0.82 coins/month x 20 / 30 = ~219 coins.
 *
 *  THE PROBLEM A BIG BOOST HAS, and the valve for it. What one ad COSTS us
 *  grows with the land it multiplies, while what the ad EARNS us does not. At
 *  20x and 400 parcels a 30-minute ad pays the player about $0.02 - roughly
 *  what the ad itself earns. Beyond that, every ad would lose money. So the
 *  multiplier TAPERS as land grows (BOOST_TIERS below), the way Atlas Earth's
 *  does: a new or ordinary player always gets the full 20x, and only a very
 *  large holder sees it ease off. The cost of one ad stays roughly level
 *  however much land is behind it.
 *
 *  Boosts are stored with the multiplier they were bought at, so a player who
 *  crosses a tier mid-boost keeps what they watched for.
 */
export const BOOST_MULTIPLIER = 20;

/** Thirty minutes per ad - TerraMine's piece size. */
export const BOOST_SECONDS_PER_AD = 30 * 60;

/**
 * A whole day banked, so one sitting of ads can cover the day - "make it way
 * easier" (2026-09-26). MAX_BOOST_ADS_PER_DAY is what bounds the cost.
 */
export const BOOST_MAX_BANKED_SECONDS = 24 * 60 * 60;

/** 48 x 30 min = the whole day, which the 24-hour bank holds exactly. */
export const MAX_BOOST_ADS_PER_DAY = 48;

/**
 * The taper, as BRACKETS - like tax bands, not like steps. The first 400
 * parcels are boosted 20x, parcels 401-700 at 15x, 701-1,000 at 10x, and
 * every one after that at 5x.
 *
 * It used to be steps: the whole holding dropped to 15x at parcel 401, so
 * buying the 401st parcel CUT a player's boosted income by a quarter - $0.54
 * a day down to $0.41. Buying land must never lower what you earn. As
 * brackets, every extra parcel adds at least 5x its rate, so income only ever
 * rises, and the cost of one ad still levels off for very large holders.
 */
export const BOOST_TIERS: readonly { upToParcels: number; multiplier: number }[] = [
  { upToParcels: 400, multiplier: 20 },
  { upToParcels: 700, multiplier: 15 },
  { upToParcels: 1_000, multiplier: 10 },
  { upToParcels: Number.POSITIVE_INFINITY, multiplier: 5 },
] as const;

/**
 * The multiplier a boost ad buys for a player holding `parcels`: the brackets
 * above averaged over the whole holding. 20 for anyone up to 400 parcels.
 *
 * Rounded to 4 decimals because boosts.multiplier is NUMERIC(8,4); at that
 * precision parcels x multiplier still rises with every parcel.
 */
export function boostMultiplierFor(parcels: number): number {
  const n = Math.max(0, Math.floor(parcels));
  if (n === 0) return BOOST_TIERS[0].multiplier;
  let total = 0;
  let from = 0;
  for (const t of BOOST_TIERS) {
    const inBand = Math.max(0, Math.min(n, t.upToParcels) - from);
    total += inBand * t.multiplier;
    if (n <= t.upToParcels) break;
    from = t.upToParcels;
  }
  return Math.round((total / n) * 10_000) / 10_000;
}

/**
 * BONUS WALK POINTS - the plainest ad in the game.
 *
 * No context, no unlock, no cleverness: watch one, get Walk Points. It is
 * the ad a player reaches for when they want land and cannot be bothered
 * walking further today, and the cap is the only thing shaping it.
 *
 * The cap went 6 -> 20 a day. At 5 WP each that is 100 WP, or two parcels at
 * the flat 50 WP price - meaningful without being the main way anyone gets
 * land (a 10,000-step day is still 100 WP by itself). Twenty ads is also
 * about $0.16 a day at the pessimistic rate, against 100 WP of land costing
 * us roughly $0.027 a year. The alignment is the point: this is the faucet
 * players pay us the most directly to open.
 */
export const AD_WALK_POINTS = 1;

/**
 * ONE bonus-WP ad every 20 minutes (2026-09-29, the product owner's call):
 * "1 WP ad every 20 minutes, not the 50 consecutive ones". The wait is the
 * limit now - it spreads the ads through the day instead of letting someone
 * watch fifty in a row. The daily cap is only the arithmetic ceiling that
 * follows from it (24 h / 20 min = 72), kept so nothing else changes shape.
 * History: 6, 20, 10, 20, 10 at 5 WP, then 50 at 1 WP.
 */
export const WP_AD_COOLDOWN_MINUTES = 20;
export const MAX_WP_ADS_PER_DAY = (24 * 60) / WP_AD_COOLDOWN_MINUTES;

/** The post-claim bonus ad: once per parcel, within this long of claiming it. */
export const CLAIM_BONUS_WP = AD_WALK_POINTS;
export const CLAIM_BONUS_WINDOW_MINUTES = 30;

/** How long a "start watching" ticket stays valid. An ad is ~30 s. */
export const AD_TICKET_TTL_SECONDS = 10 * 60;

/**
 * Three more things a rewarded ad can buy. Two are deliberately CHEAP to us:
 *
 *   INSTANT_COLLECT  the next couple of hours of income, right now. Costs
 *                    what it says and no more - it is income brought forward,
 *                    not created, so it is capped per day and stays tiny.
 *   SCOUT            a wider claim reach for a few minutes. Costs nothing at
 *                    all; it just saves walking round a corner.
 *   COSMETIC         an avatar part, forever. Costs nothing, ever. The best
 *                    kind of ad: people ask for it.
 */
export const INSTANT_COLLECT_HOURS = 2;
/**
 * ZERO: "collect 2 hours now" was removed on 2026-09-27 (product owner's
 * call). Kept at 0 rather than deleted so an older APK that still shows the
 * button gets "back tomorrow" instead of a payout.
 */
export const MAX_INSTANT_COLLECT_ADS_PER_DAY = 0;

export const SCOUT_SECONDS_PER_AD = 10 * 60;
export const SCOUT_MAX_BANKED_SECONDS = 30 * 60;
export const MAX_SCOUT_ADS_PER_DAY = 6;
/** Claim reach while scouting, against MAX_CLAIM_DISTANCE_M normally. */
export const SCOUT_CLAIM_DISTANCE_M = 75;

/**
 * Every "per day" cap in this file means per LOCAL day: it resets at the
 * player's own midnight, computed on the server (see db/localTime.ts). Until
 * 2026-09-26 the ad caps were a rolling 24 hours, which testers rightly
 * reported as "the daily rewards don't reset".
 *
 * The only thing a player could move to reach "tomorrow" early is their time
 * zone, so it may change at most once in this many days. A change inside the
 * window is quietly ignored - a traveller keeps their home day for a while.
 */
export const TIME_ZONE_CHANGE_COOLDOWN_DAYS = 7;

export function dailyAdCap(kind: AdRewardKind): number {
  if (kind === 'BOOST') return MAX_BOOST_ADS_PER_DAY;
  if (kind === 'WALK_POINTS') return MAX_WP_ADS_PER_DAY;
  if (kind === 'INSTANT_COLLECT') return MAX_INSTANT_COLLECT_ADS_PER_DAY;
  if (kind === 'SCOUT') return MAX_SCOUT_ADS_PER_DAY;
  // The rest are capped by the thing itself: DOUBLE needs a reward to double,
  // COSMETIC an item you do not own, UPGRADE the Walk Points, PIT_STOP a
  // parcel in reach that has not paid in 24 h, EXTRA_CHECKIN
  // somewhere new, STREAK_SAVE a missed day, TREASURE the daily box limit.
  return Number.POSITIVE_INFINITY;
}

/**
 * ---------------------------------------------------------------------------
 *  DAILY CHEST AND QUESTS - reasons to open the app every day.
 * ---------------------------------------------------------------------------
 *  The chest pays WP on a 7-day streak, with the big one on day 7; miss a day
 *  and the streak starts again. Quests are small daily goals. Every one of
 *  these can be DOUBLED by watching an ad: an ad placement the player asks
 *  for, at the moment they are happiest.
 *
 *  Kept modest on purpose. Most quests need walking anyway, and at most
 *  about 50 WP a day come from here (doubled) - half a day's walking for a
 *  10,000-step walker, and every doubling is an ad watched.
 */
export const DAILY_CHEST_WP = [3, 4, 5, 6, 8, 10, 20] as const;

/** WP for the chest on day `streak` of a streak (1-based, repeating weekly). */
export function dailyChestWp(streak: number): number {
  const i = (Math.max(1, Math.floor(streak)) - 1) % DAILY_CHEST_WP.length;
  return DAILY_CHEST_WP[i];
}

/*
 * DAILY_MIN_GAP_HOURS and QUEST_MIN_GAP_HOURS lived here until 2026-09-26: a
 * reward could not be paid twice within 4 hours, to stop time-zone hopping.
 * They are GONE because they broke the midnight reset - a chest opened at
 * 11:30pm could not be opened again until 3:30am, while the app said it was
 * ready, and a quest collected late showed "Collect" and then errored.
 * TIME_ZONE_CHANGE_COOLDOWN_DAYS now does their job properly.
 */

export type QuestMetric = 'STEPS' | 'CLAIMS' | 'ADS';

export interface QuestDefinition {
  key: string;
  title: string;
  metric: QuestMetric;
  target: number;
  rewardWp: number;
}

export const DAILY_QUESTS: readonly QuestDefinition[] = [
  { key: 'steps_3k', title: 'Walk 3,000 steps', metric: 'STEPS', target: 3_000, rewardWp: 6 },
  { key: 'steps_8k', title: 'Walk 8,000 steps', metric: 'STEPS', target: 8_000, rewardWp: 12 },
  { key: 'claim_1', title: 'Claim a parcel', metric: 'CLAIMS', target: 1, rewardWp: 5 },
  { key: 'power_1', title: 'Use a power-up', metric: 'ADS', target: 1, rewardWp: 3 },
] as const;

/** How long after collecting a reward it can still be doubled. */
export const DOUBLE_WINDOW_HOURS = 24;

/**
 * ---------------------------------------------------------------------------
 *  WEEKLY STEP LEADERBOARDS - by area.
 * ---------------------------------------------------------------------------
 *  Everyone is ranked by steps walked this week (Monday 00:00 UTC to the next
 *  Monday), on four boards: their city, region, country, and the world.
 *
 *  When a week ends, the top 3 of every board win a LAND BOOST - their parcels
 *  earn multiplied coins for a while:
 *
 *      1st   3x coins for 3 days
 *      2nd   2x coins for 2 days
 *      3rd   2x coins for 1 day
 *
 *  Someone who places on several boards (say 1st in their city and 2nd in
 *  their country) keeps only their BEST prize. A board needs at least
 *  LEADERBOARD_MIN_WALKERS people before it pays out, so nobody can win by
 *  naming a hamlet where they are the only player.
 *
 *  Cost: a 3x boost for 3 days on 100 parcels (~250 coins/hr) is ~36,000
 *  coins, about 7 cents. Cheap for a reason to walk more every week.
 */
export type LeaderboardScope = 'CITY' | 'REGION' | 'COUNTRY' | 'WORLD';
export const LEADERBOARD_SCOPES: readonly LeaderboardScope[] = ['CITY', 'REGION', 'COUNTRY', 'WORLD'];
export const LEADERBOARD_MIN_WALKERS = 5;
export const LEADERBOARD_PAGE = 50;

export interface PrizeTier {
  rank: 1 | 2 | 3;
  multiplier: number;
  seconds: number;
}
export const LEADERBOARD_PRIZES: readonly PrizeTier[] = [
  { rank: 1, multiplier: 3, seconds: 3 * 24 * 3600 },
  { rank: 2, multiplier: 2, seconds: 2 * 24 * 3600 },
  { rank: 3, multiplier: 2, seconds: 1 * 24 * 3600 },
] as const;

/** Is prize `a` better than prize `b`? Extra coins = (multiplier - 1) x time. */
export function betterPrize(a: PrizeTier, b: PrizeTier): boolean {
  return (a.multiplier - 1) * a.seconds > (b.multiplier - 1) * b.seconds;
}

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}

/**
 * ---------------------------------------------------------------------------
 *  CHECK-INS - go somewhere, say you were there.
 * ---------------------------------------------------------------------------
 *  Once a day, wherever you are, you can record a VISIT. Somewhere you have
 *  never visited before (a new ~1 km square) pays a bonus, which rewards
 *  exploring rather than walking the same loop. An ad can double it.
 */
/**
 * How fine a "place" is: lat/lng are multiplied by this and rounded, so the
 * square is 1/PLACE_SCALE of a degree on each side.
 *
 * 400 gives ~278 m north-south, and ~170 m east-west in London - about a
 * block. It was 100 (a ~1 km square), which was coarse enough that the park
 * and the station counted as the same place and a genuine second visit was
 * refused. Changing this needs a migration: see 016_finer_places.sql for why
 * old rows carry the scale they were written at.
 */
export const PLACE_SCALE = 400;

/**
 * How far today's area may drift from the player before it is abandoned and
 * re-rolled for free.
 *
 * WHY THIS EXISTS: the target is rolled near wherever the player was and
 * never moves. Open the app in another city - a train, a holiday, moving
 * house - and it sits hundreds of kilometres away, refusing every check-in
 * with "keep walking", and the only escape is a rewarded ad. The one thing a
 * player could not do was give up on it.
 *
 * 5 km is well beyond the 750 m the roll can produce, so ordinary walking
 * never triggers it - you cannot walk away from a target to reroll it. It
 * only fires when somebody has genuinely relocated, and the re-roll is free
 * because travelling is not cheating.
 */
export const MAX_TARGET_DRIFT_M = 5_000;

export const CHECKIN_WP = 4;
export const CHECKIN_NEW_PLACE_BONUS_WP = 6;
export const CHECKIN_MAX_ACCURACY_M = 60;

/**
 * The first visit of the day is free. After that you may visit as often as
 * you like - each one costs a rewarded ad, and must be somewhere NEW (a
 * different ~1 km square you have not visited today). That rewards actually
 * walking somewhere rather than standing still tapping a button.
 */
export const CHECKIN_EXTRA_NEEDS_AD = true;

/**
 * ---------------------------------------------------------------------------
 *  PIT STOPS - stand on claimed land and take Walk Points off it.
 * ---------------------------------------------------------------------------
 *  The successor to place-based visits. A visit used to be "I was in this
 *  ~250 m square"; a pit stop is "I stood on THIS parcel", which is a far
 *  better thing to reward: it puts other players' land on your route and
 *  turns the map into somewhere to go rather than something to look at.
 *
 *  Three rules, and they interlock:
 *
 *   1. SOMEONE ELSE'S land pays more than your own. Walking to a neighbour's
 *      plot is the behaviour worth paying for; standing in your own garden is
 *      not. Your own land still pays a little, so a player with no neighbours
 *      yet is not locked out of the feature entirely - that matters while the
 *      map is thin, and stops being the common case as it fills.
 *
 *   2. The SAME parcel pays once per 24 hours. Without this, two players
 *      could stand on each other's land and farm the pair of them forever.
 *
 *   3. A 5-MINUTE cooldown between any two pit stops, which a rewarded ad
 *      skips. This is the revenue: the cooldown is short enough that waiting
 *      is a real option (so the ad never feels compulsory) and long enough
 *      that a street full of parcels is worth several ads to clear. After
 *      every stop - waited for or paid for - the clock resets to 5 minutes.
 */
/*
 *  CHECK-INS (2026-09-27). The product owner turned the doorbell into a
 *  check-in: you stand on SOMEONE ELSE'S land, check in, and BOTH of you earn
 *  - the visitor 5 WP, the owner 3. Your own land is no longer a stop at all
 *  (checking in on yourself is not a visit), and the first-visit bonus went,
 *  so a check-in is always the same simple +5 / +3. The 5-minute wait, the ad
 *  that skips it and the ad that doubles the visitor's 5 all stay.
 */
/** Your own land: not a check-in. Kept at 0 so old callers read "pays nothing". */
export const PIT_STOP_WP_OWN = 0;
export const PIT_STOP_WP_NEIGHBOUR = 5;

/** Retired with the check-in rework: every check-in pays the same. */
export const PIT_STOP_NEW_BONUS_WP = 0;

/** What the parcel's OWNER earns when someone checks in on it. */
export const CHECKIN_OWNER_WP = 3;

/**
 * The most check-ins an owner is paid for per day (local), so two friends
 * checking in on each other's land all day cannot farm it: 20 x 3 = 60 WP.
 * Visitors are not limited by this - only what the owner receives.
 */
export const CHECKIN_OWNER_DAILY_MAX = 20;

/** Between any two pit stops. A rewarded ad skips whatever is left of it. */
export const PIT_STOP_COOLDOWN_SECONDS = 5 * 60;

/** How long before the same parcel pays again. */
export const PIT_STOP_PROPERTY_COOLDOWN_HOURS = 24;

/** You must genuinely be on it - the same accuracy a claim demands. */
export const PIT_STOP_MAX_ACCURACY_M = 25;

/** How close to the parcel's centre counts as standing on it, in metres. */
export const PIT_STOP_REACH_M = 40;

/** What a pit stop on this parcel is worth, before any doubling ad. */
export function pitStopWp(mine: boolean, firstEver: boolean): number {
  return (mine ? PIT_STOP_WP_OWN : PIT_STOP_WP_NEIGHBOUR) + (firstEver ? PIT_STOP_NEW_BONUS_WP : 0);
}

/**
 * ---------------------------------------------------------------------------
 *  WHAT COINS ARE FOR - nothing yet, and that is a known gap.
 * ---------------------------------------------------------------------------
 *  There WAS a coin store here: coins bought Walk Points, treasure boxes, a
 *  streak save, a cosmetic, a pit-stop skip. Removed 2026-09-24.
 *
 *  Keep the reasoning, because it will be needed again. A coin that can only
 *  sit in a balance waiting for a redemption nobody has built is an
 *  unsatisfying reward at ANY exchange rate, and the store existed to fix
 *  exactly that. Whatever replaces it should obey the same single rule:
 *
 *      IT MUST COST US ALMOST NOTHING AND REDUCE WHAT WE OWE.
 *
 *  And the one thing that must never be sold for coins: PARCEL UPGRADES.
 *  Trading a permanent +1 coin/hour for a one-off pile of coins swaps a
 *  fixed liability for a perpetual one - strictly worse for us however good
 *  the price looks. Upgrades stay on Walk Points and ads.
 *
 *  The coins-for-Walk-Points trade is worth recovering from git if it comes
 *  back. It was 1,500 coins/WP, priced against the BOOSTED yield, not the
 *  base one - an earlier attempt at 350 looked like a fifteen-year payback
 *  and was really three and a half, which would have paid for itself and
 *  then profited forever after.
 */

/**
 * ---------------------------------------------------------------------------
 *  PARCEL UPGRADES - a Walk Point sink that is CHEAPER for us than more land.
 * ---------------------------------------------------------------------------
 *  A parcel can be upgraded four times. Each level costs Walk Points AND a
 *  rewarded ad, and adds a flat +0.15 coins a month (was +1 before the
 *  2026-09-27 rate cut - kept at the same share of an average parcel):
 *
 *      level 1   25 WP + 1 ad     level 3   75 WP + 1 ad
 *      level 2   50 WP + 1 ad     level 4  100 WP + 1 ad
 *
 *  Fully upgrading one parcel costs 250 WP (25,000 steps) and four ads, and
 *  adds 0.6 coins a month - it doubles a rocky parcel. Those 250 WP would otherwise buy five parcels earning about as
 *  much between them, so upgrading costs us no more, and it pays four ads.
 */
export const PARCEL_MAX_UPGRADE = 4;
export const PARCEL_UPGRADE_COINS_PER_LEVEL = 0.15;

/**
 * A parcel's monthly rate as SQL, for queries that total a player's land.
 * One definition, because four queries used to hard-code "+1 per level".
 * Cast to float8: node-pg hands NUMERIC back as a string.
 */
export function parcelRateSql(alias = ''): string {
  const a = alias ? `${alias}.` : '';
  return `(${a}coins_per_month + ${a}upgrade_level * ${PARCEL_UPGRADE_COINS_PER_LEVEL})::float8`;
}

/** Walk Points to go from `level` to `level + 1`. */
export function parcelUpgradeCostWp(level: number): number {
  return 25 * (Math.max(0, Math.floor(level)) + 1);
}

/** A parcel's real monthly rate: its mineral plus whatever it has been upgraded by. */
export function parcelCoinsPerMonth(baseCoinsPerMonth: number, upgradeLevel: number): number {
  const level = Math.max(0, Math.min(PARCEL_MAX_UPGRADE, upgradeLevel));
  // Rounded to the cent-of-a-coin the column holds, so 0.6 + 0.15 is 0.75, not 0.7499999.
  return Math.round((Number(baseCoinsPerMonth) + PARCEL_UPGRADE_COINS_PER_LEVEL * level) * 100) / 100;
}

/**
 * ---------------------------------------------------------------------------
 *  STREAK INSURANCE
 * ---------------------------------------------------------------------------
 *  Miss a day and your chest streak goes back to 1. One rewarded ad forgives
 *  ONE missed day, and only within two days of missing it - so a streak can
 *  be rescued, but not resurrected weeks later.
 */
export const STREAK_SAVE_WITHIN_DAYS = 2;
export const MAX_STREAK_SAVES_PER_WEEK = 2;

/**
 * ---------------------------------------------------------------------------
 *  AD STREAK - watch a few ads in a day, get a bonus chest.
 * ---------------------------------------------------------------------------
 *  Turns scattered ad watching into a daily goal. It pays Walk Points, which
 *  are earned rather than owed, so it costs us nothing directly.
 */
export const AD_STREAK_TARGET = 3;
export const AD_STREAK_REWARD_WP = 10;

/**
 * ---------------------------------------------------------------------------
 *  TREASURE BOXES - somewhere to walk TO.
 * ---------------------------------------------------------------------------
 *  A box appears a few hundred metres away; reach it and open it for Walk
 *  Points. Two a day are free, and each further one costs a rewarded ad.
 *  They expire, so they cannot be hoarded.
 *
 *  THE KEY (2026-09-27). The two free boxes now open with a rewarded ad - a
 *  TREASURE_KEY - once AD_GATES is on, and pay more for it: 10-20 WP, up
 *  from 6-14. A box that an ad already paid to spawn opens without a key:
 *  one ad per box, never two.
 */
export const TREASURE_FREE_PER_DAY = 2;
export const TREASURE_MAX_PER_DAY = 10;
export const TREASURE_MIN_DISTANCE_M = 150;
export const TREASURE_MAX_DISTANCE_M = 400;
export const TREASURE_COLLECT_DISTANCE_M = 30;
export const TREASURE_TTL_MINUTES = 120;
export const TREASURE_MIN_WP = 10;
export const TREASURE_MAX_WP = 20;

/**
 * ---------------------------------------------------------------------------
 *  INVITES - the cheapest way to grow, if it cannot be farmed.
 * ---------------------------------------------------------------------------
 *  The friend gets 100 WP as a welcome. The inviter gets 200 WP, but only
 *  once that friend has walked 3,000 real steps: making up accounts then
 *  costs a genuine walk each, which is far more effort than the reward is
 *  worth. Codes only work in a new account's first week, one each, and an
 *  inviter is paid for at most 25 friends.
 *
 *  Cost to us: 200 WP is about two early parcels, roughly $0.04/year of
 *  land. Getting a real new player for four pence is a bargain.
 */
export const REFERRAL_REWARD_REFEREE_WP = 100;
export const REFERRAL_REWARD_REFERRER_WP = 200;
export const REFERRAL_STEPS_TO_QUALIFY = 3_000;
export const REFERRAL_REDEEM_WINDOW_HOURS = 7 * 24;
export const REFERRAL_MAX_REWARDED = 25;

/**
 * Coin maths is done in MICRO-coins (millionths) so that time never has to be
 * rounded away. Only whole coins are ever credited; the fraction is carried
 * on the user row. See settleCoinIncome in services/user.service.ts.
 *
 * It matters more than ever with rates per MONTH: a rocky parcel earns about
 * 1.16 micro-coins a second, and every one of them is kept.
 */
export const MICRO_PER_COIN = 1_000_000;

/** A "month" of income is 30 days, so every month pays the same. */
export const SECONDS_PER_MONTH = 30 * 24 * 60 * 60;

/**
 * Micro-coins earned over a stretch of time.
 *
 * `boostedSeconds` must lie inside `elapsedSeconds`. Boosted time pays
 * `multiplier` times over: the base rate for all the time, plus
 * (multiplier - 1) extra for the boosted part.
 */
export function accruedMicroCoins(input: {
  coinsPerMonth: number;
  elapsedSeconds: number;
  boostedSeconds: number;
  multiplier?: number;
}): number {
  const { coinsPerMonth, multiplier = BOOST_MULTIPLIER } = input;
  const elapsed = Math.max(0, input.elapsedSeconds);
  const boosted = Math.min(elapsed, Math.max(0, input.boostedSeconds));
  return microCoinsFor(coinsPerMonth, elapsed + boosted * (multiplier - 1));
}

/** Micro-coins for `weightedSeconds` of income at `coinsPerMonth`. */
export function microCoinsFor(coinsPerMonth: number, weightedSeconds: number): number {
  if (coinsPerMonth <= 0 || weightedSeconds <= 0) return 0;
  return Math.floor((coinsPerMonth * weightedSeconds * MICRO_PER_COIN) / SECONDS_PER_MONTH);
}

/** Split a micro-coin total into whole coins plus the remainder carried over. */
export function splitMicroCoins(totalMicro: number): { coins: number; remainderMicro: number } {
  const safe = Math.max(0, Math.floor(totalMicro));
  const coins = Math.floor(safe / MICRO_PER_COIN);
  return { coins, remainderMicro: safe - coins * MICRO_PER_COIN };
}

/** Hard ceiling on a single request body, before any other checks. */
export const MAX_STEPS_PER_SYNC = 200_000;

/**
 * ---------------------------------------------------------------------------
 *  PLAUSIBILITY LIMITS
 * ---------------------------------------------------------------------------
 *  Device attestation (App Attest / Play Integrity) proves a request came from
 *  your real app on a real phone. It does NOT prove the human actually walked:
 *  someone can still strap the phone to a dog, a ceiling fan, or a metronome.
 *
 *  So we also bound what is physically possible. These limits are deliberately
 *  generous - the goal is to make large-scale farming pointless, not to shave
 *  steps off a keen hiker.
 */

/** Burst pace ceiling. Elite race-walkers hit ~200/min; 250 leaves room. */
export const MAX_STEPS_PER_MINUTE = 250;

/**
 * ---------------------------------------------------------------------------
 *  PACE FALLS OFF WITH DURATION - the check that a flat ceiling cannot make
 * ---------------------------------------------------------------------------
 *  A flat 250/min is right for one minute and absurd for a day: it would wave
 *  through 360,000 steps in 24 hours, which is roughly three back-to-back
 *  ultramarathons. Every shaker, pendulum and "step hack" app produces
 *  exactly that shape - a pace a human can hit for a minute, held for hours -
 *  so a flat ceiling is precisely the wrong check.
 *
 *  What a body can actually sustain drops sharply with duration. These points
 *  are set from real endurance data with headroom on top: the world 24-hour
 *  walking record is about 230 km, and a marathon world record pace is
 *  roughly 180 steps/min held for two hours.
 *
 *      1 min    250/min   a sprint
 *      1 hour   200/min   a very fast hour - about 12,000 steps
 *      6 hours  150/min   a long hard day out
 *      24 hours 100/min   144,000 steps; beyond any record
 *
 *  In between, the ceiling is interpolated on a log scale, because that is
 *  how endurance curves actually behave. Every honest player sits far under
 *  this; it only bites on machine-generated counts.
 */
const PACE_CURVE: readonly { minutes: number; perMinute: number }[] = [
  { minutes: 1, perMinute: MAX_STEPS_PER_MINUTE },
  { minutes: 60, perMinute: 200 },
  { minutes: 360, perMinute: 150 },
  { minutes: 1_440, perMinute: 100 },
] as const;

/**
 * The fastest average pace a human could hold for this many minutes.
 * Log-interpolated between the points above, flat outside them.
 */
export function sustainablePace(minutes: number): number {
  if (minutes <= PACE_CURVE[0].minutes) return PACE_CURVE[0].perMinute;
  const last = PACE_CURVE[PACE_CURVE.length - 1];
  if (minutes >= last.minutes) return last.perMinute;
  for (let i = 1; i < PACE_CURVE.length; i++) {
    const a = PACE_CURVE[i - 1];
    const b = PACE_CURVE[i];
    if (minutes <= b.minutes) {
      const t = (Math.log(minutes) - Math.log(a.minutes)) / (Math.log(b.minutes) - Math.log(a.minutes));
      return a.perMinute + t * (b.perMinute - a.perMinute);
    }
  }
  return last.perMinute;
}

/**
 * The allowance is measured over a SLIDING WINDOW, never over "time since the
 * last sync". That distinction matters more than it looks.
 *
 * An earlier version of this granted `minutes since last sync x 250`, with a
 * floor so that rapid syncing was not throttled to nothing. It quietly threw
 * away honest steps: a phone reporting 600 steps and then 600 more a second
 * later had the second batch clipped, because "time since last sync" forgets
 * the allowance the player had already accrued and not spent.
 *
 * A window has no such memory loss. We ask "how much has this account already
 * banked inside the window?" and allow the rest - so syncing once an hour and
 * syncing every ten seconds earn exactly the same, which is the property we
 * actually wanted.
 */
export const SHORT_WINDOW_MINUTES = 60;

/**
 * The window stretches to cover however long the phone was away, up to a day.
 * This is what lets someone who walked all morning with the app closed sync
 * the lot in one go - while still stopping an account dormant for a year from
 * claiming a year of allowance.
 */
export const CATCHUP_WINDOW_MINUTES = 24 * 60;

/**
 * Steps that earn per LOCAL DAY (resets at the player's midnight).
 *
 * 15,000 since 2026-09-27, the product owner's call - it was 60,000, a pure
 * anti-cheat backstop. Now it is also the economy's ceiling: at most 150 WP a
 * day from walking, whoever you are. Steps past it are still counted by the
 * phone, they just stop paying (the Walk tab says so).
 */
export const MAX_STEPS_PER_DAY = 15_000;

export type StepLimitReason = 'OK' | 'RATE_LIMIT' | 'DAILY_LIMIT';

export interface StepAllowance {
  accepted: number;
  rejected: number;
  reason: StepLimitReason;
}

/**
 * Decide how many of the submitted steps we are willing to believe.
 *
 * We truncate rather than reject the whole request: a phone that genuinely sat
 * offline all day should still be credited what it plausibly walked. The
 * excess is recorded in `step_logs.rejected_steps` so repeat offenders are
 * visible in the data.
 */
export function plausibleStepAllowance(input: {
  requestedSteps: number;
  /** Used only to decide how wide the window should be. */
  minutesSinceLastSync: number;
  acceptedStepsInLastHour: number;
  acceptedStepsInLast24h: number;
}): StepAllowance {
  const {
    requestedSteps,
    minutesSinceLastSync,
    acceptedStepsInLastHour,
    acceptedStepsInLast24h,
  } = input;

  // 1. How wide is the window? At least an hour, at most a day, and otherwise
  //    however long the phone has been away.
  const windowMinutes = Math.min(
    Math.max(minutesSinceLastSync, SHORT_WINDOW_MINUTES),
    CATCHUP_WINDOW_MINUTES,
  );

  // 2. How much has already been banked inside that window? If the last sync
  //    was over an hour ago then by definition nothing was synced during it.
  const alreadyInWindow =
    minutesSinceLastSync >= SHORT_WINDOW_MINUTES ? 0 : acceptedStepsInLastHour;

  // The ceiling is the pace a human could SUSTAIN for a window this wide,
  // not the pace they could sprint for a minute. Over an hour that is 200/min
  // rather than 250; over a full day, 100. See PACE_CURVE.
  const windowAllowance = Math.max(
    0,
    Math.floor(windowMinutes * sustainablePace(windowMinutes)) - alreadyInWindow,
  );

  // 3. The daily backstop.
  const dailyRemaining = Math.max(0, MAX_STEPS_PER_DAY - acceptedStepsInLast24h);

  const accepted = Math.max(0, Math.min(requestedSteps, windowAllowance, dailyRemaining));

  // Report which limit actually bit, so the client can show something useful
  // and so we can tell "offline all day" apart from "farming".
  let reason: StepLimitReason = 'OK';
  if (accepted < requestedSteps) {
    reason = dailyRemaining <= windowAllowance ? 'DAILY_LIMIT' : 'RATE_LIMIT';
  }

  return { accepted, rejected: requestedSteps - accepted, reason };
}

/**
 * ---------------------------------------------------------------------------
 *  STEP INTEGRITY - what is merely implausible, as opposed to impossible
 * ---------------------------------------------------------------------------
 *  plausibleStepAllowance decides what a body COULD have done. These flags
 *  catch the things a body would not have done, which is a different
 *  question and needs different evidence.
 *
 *  NONE OF THESE REFUSE A SYNC. Every one of them has an innocent
 *  explanation - a treadmill really does produce a metronomic cadence, and a
 *  developer really does use a mock location. They are recorded on the row so
 *  that a pattern is visible in the data BEFORE anything is built on top of
 *  it. Silently confiscating a real walker's Walk Points on a heuristic would
 *  be much worse than a farmer getting away with it for a week.
 *
 *  A single flag means little. Three at once, repeatedly, is an account worth
 *  looking at by hand.
 */
export const STEP_FLAG = {
  /** Several syncs in a row carried the exact same step count. */
  IDENTICAL_BATCHES: 1 << 0,
  /** The pace held within a hair of constant across several syncs. */
  ROBOTIC_CADENCE: 1 << 1,
  /** The phone said its location was mocked. */
  MOCKED_LOCATION: 1 << 2,
  /** One device, many accounts - a farm, or a shared family phone. */
  DEVICE_SHARED: 1 << 3,
  /** This batch was clipped by the plausibility rules. */
  OVER_LIMIT: 1 << 4,
  /** Steps came from a health store rather than the OS's own pedometer. */
  WRITABLE_SOURCE: 1 << 5,
  /** More steps than the ground covered can account for - the shaking signal. */
  NO_DISPLACEMENT: 1 << 6,
  /** Moved between two fixes faster than is physically possible. */
  TELEPORT: 1 << 7,
  /** The GPS trace has none of the noise a real receiver produces. */
  SYNTHETIC_TRACK: 1 << 8,
  /** Claimed, stopped or checked in somewhere unreachable from the last fix. */
  UNREACHABLE_ACTION: 1 << 9,
  /** The device failed, or declined to offer, an integrity attestation. */
  UNATTESTED: 1 << 10,
} as const;

export type StepFlagName = keyof typeof STEP_FLAG;

/** How many recent syncs the pattern checks look at. */
export const STEP_PATTERN_WINDOW = 6;

/**
 * Identical counts this many times running is the flag. Three, not two: two
 * in a row happens naturally when a phone syncs twice inside one minute of a
 * steady walk, and flagging that would flag half the honest population.
 */
export const IDENTICAL_BATCH_STREAK = 3;

/**
 * Coefficient of variation below which a cadence reads as machine-made.
 *
 * Real walking is bursty even on a treadmill - you break stride, you pause at
 * a junction, the sensor misses a step. Across six syncs a human's pace
 * typically varies by 15-40%. Under 3% is a motor.
 */
export const ROBOTIC_CADENCE_CV = 0.03;

/** Below this many steps a batch is too small for the pattern checks to mean anything. */
export const PATTERN_MIN_STEPS = 200;

export interface StepPatternInput {
  /** Recent syncs, newest first: accepted steps and how long they covered. */
  recent: readonly { steps: number; minutes: number }[];
  /** This batch. */
  steps: number;
  minutes: number;
}

/** The standard deviation over the mean. Zero when every value is the same. */
function coefficientOfVariation(values: readonly number[]): number {
  if (values.length < 2) return Infinity;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean <= 0) return Infinity;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * Pattern flags for one sync, given the account's recent history.
 *
 * Pure, so it is testable without a database - which matters, because the
 * only way to be confident a heuristic does not fire on honest walking is to
 * run honest walking through it.
 */
export function stepPatternFlags(input: StepPatternInput): number {
  const { recent, steps, minutes } = input;
  let flags = 0;

  // Too small to say anything about. A 12-step batch being identical to the
  // last 12-step batch is not evidence of anything.
  if (steps < PATTERN_MIN_STEPS) return 0;

  const batches = [steps, ...recent.map((r) => r.steps)].slice(0, STEP_PATTERN_WINDOW);

  // 1. IDENTICAL BATCHES. A person's count between two syncs is never the
  //    same number three times running; a generator's almost always is.
  if (batches.length >= IDENTICAL_BATCH_STREAK) {
    const head = batches.slice(0, IDENTICAL_BATCH_STREAK);
    if (head.every((b) => b === head[0] && b >= PATTERN_MIN_STEPS)) {
      flags |= STEP_FLAG.IDENTICAL_BATCHES;
    }
  }

  // 2. ROBOTIC CADENCE. Steps per minute, across the window, holding almost
  //    perfectly constant. Only meaningful over several syncs covering real
  //    time - two samples a second apart tell you nothing.
  const paces = [{ steps, minutes }, ...recent]
    .slice(0, STEP_PATTERN_WINDOW)
    .filter((r) => r.minutes >= 1 && r.steps >= PATTERN_MIN_STEPS)
    .map((r) => r.steps / r.minutes);
  if (paces.length >= 4 && coefficientOfVariation(paces) < ROBOTIC_CADENCE_CV) {
    flags |= STEP_FLAG.ROBOTIC_CADENCE;
  }

  return flags;
}

/** The names of the flags set in a mask, for logging and for a human to read. */
export function describeStepFlags(mask: number): StepFlagName[] {
  return (Object.keys(STEP_FLAG) as StepFlagName[]).filter((k) => (mask & STEP_FLAG[k]) !== 0);
}

/**
 * ===========================================================================
 *  LAYER 2 - DID THE GROUND MOVE? The check that answers shaking.
 * ===========================================================================
 *  A phone shaken in a hand produces a textbook step signal: the accelerometer
 *  sees regular oscillation at walking frequency and the pedometer counts it.
 *  Nothing about the STEP COUNT ITSELF can tell you it was fake, which is why
 *  every check above it is a heuristic about shape rather than substance.
 *
 *  What shaking cannot fake is GROUND COVERED. Walking biomechanics are
 *  tightly constrained: stride length grows roughly linearly with cadence,
 *  from about 0.7 m per step at 90 steps/min to about 1.0 m at 140. Nobody
 *  walks a thousand steps on the spot and moves three metres.
 *
 *  >> THE HONEST PROBLEM WITH THIS CHECK, STATED PLAINLY <<
 *
 *  A TREADMILL LOOKS EXACTLY LIKE SHAKING. So does a walking pad, a lap of an
 *  indoor track, and a shopping centre where GPS cannot see the sky. Those are
 *  real steps taken by a real person and they produce no displacement either.
 *  Displacement alone therefore CANNOT separate honest from dishonest, and any
 *  design that refuses on it will punish real walkers.
 *
 *  So this does not refuse. It SORTS steps into two kinds:
 *
 *    CORROBORATED    the GPS trace moved far enough to account for them
 *    UNCORROBORATED  it did not - treadmill, indoors, or a shaken phone
 *
 *  Both still count as steps. Uncorroborated ones are capped per day at
 *  UNCORROBORATED_STEPS_PER_DAY, which is set generously enough that an hour
 *  on a treadmill is fully paid, and low enough that a shaker hits the ceiling
 *  and stops earning. The honest indoor walker loses nothing they would have
 *  noticed; the farmer's yield collapses. That asymmetry is the whole design.
 */

/**
 * The least ground a real walking step covers, in metres.
 *
 * Deliberately far below the 0.7 m floor from the biomechanics: GPS under
 * trees, in streets with tall buildings, or on a phone that sampled its
 * position rarely will understate distance badly. This is the line below
 * which NO plausible receiver error explains the gap - a tenth of a stride.
 */
export const MIN_METRES_PER_STEP = 0.12;

/**
 * The most ground a step can cover before it stops being walking.
 *
 * A long running stride is about 1.5 m. Beyond 2.5 m per step the "walk" is a
 * vehicle, and the steps are the phone rattling in a cupholder. Those are not
 * fraud, but they are not walking either, so they do not corroborate anything.
 */
export const MAX_METRES_PER_STEP = 2.5;

/**
 * How many uncorroborated steps a day still earn at the full rate.
 *
 * 6,000 is about an hour of brisk treadmill walking, or a long indoor day at
 * a conference or a hospital shift. Past it, steps with nothing on the ground
 * to back them up simply stop paying.
 */
export const UNCORROBORATED_STEPS_PER_DAY = 6_000;

/** GPS worse than this tells us nothing about distance, either way. */
export const TRACK_USABLE_ACCURACY_M = 35;

export interface DisplacementVerdict {
  /** Steps the ground covered can account for. */
  corroborated: number;
  /** Steps it cannot - treadmill, indoors, or shaken. */
  uncorroborated: number;
  flags: number;
}

/**
 * Split a batch of steps by whether the ground moved enough to explain them.
 *
 * `distanceM` is what the phone's own GPS trace covered over the same window,
 * already filtered client-side for junk fixes. When there is no usable trace
 * at all, EVERYTHING is uncorroborated - which is correct: we simply do not
 * know, and the daily cap is what bounds our exposure to not knowing.
 */
export function stepDisplacementVerdict(input: {
  steps: number;
  /** Ground covered over the same window, or null when the trace is unusable. */
  distanceM: number | null;
}): DisplacementVerdict {
  const { steps, distanceM } = input;
  if (steps <= 0) return { corroborated: 0, uncorroborated: 0, flags: 0 };

  if (distanceM === null) {
    // No trace: not evidence of cheating, just absence of evidence. No flag.
    return { corroborated: 0, uncorroborated: steps, flags: 0 };
  }

  // What the distance could plausibly have been walked as.
  const explained = Math.floor(distanceM / MIN_METRES_PER_STEP);
  const corroborated = Math.max(0, Math.min(steps, explained));
  const uncorroborated = steps - corroborated;

  let flags = 0;
  // Flag only when there were enough steps for the gap to mean something AND
  // most of them are unexplained. A short indoor stretch is not a signal.
  if (steps >= PATTERN_MIN_STEPS && uncorroborated > steps * 0.8) {
    flags |= STEP_FLAG.NO_DISPLACEMENT;
  }
  return { corroborated, uncorroborated, flags };
}

/**
 * ===========================================================================
 *  LAYER 3 - IS THE MOVEMENT PHYSICALLY POSSIBLE?
 * ===========================================================================
 *  This is the layer a rooted phone cannot lie its way past, because it is
 *  computed from positions the SERVER has seen, not from anything the client
 *  reports about itself.
 *
 *  Hiding the mock-location flag is a solved problem for anyone with Magisk,
 *  so `isMock` is treated as a useful hint and nothing more. Being in two
 *  places at once is not hideable: whatever the phone claims about its own
 *  integrity, a claim in London eleven minutes after one in Leeds is a
 *  physical impossibility and no amount of root hides it.
 */

/**
 * The fastest a player can move and still be walking to their next action.
 *
 * 35 m/s is about 78 mph - a motorway. The point is not to catch people in
 * cars (they are not cheating, and the steps they generate are handled by
 * MAX_METRES_PER_STEP) but to catch TELEPORTS, where a position changes by
 * kilometres between two fixes seconds apart.
 */
export const MAX_TRAVEL_SPEED_MPS = 35;

/**
 * Under this many seconds, two fixes are usually too close together in time
 * for a speed to mean anything: GPS jitter alone can put 30 m between
 * consecutive readings, which at one second apart looks like 108 km/h.
 */
export const TRAVEL_MIN_SECONDS = 20;

/**
 * ...BUT ONLY FOR SMALL DISTANCES. A jump bigger than this is beyond any
 * receiver error, so it is judged however little time has passed.
 *
 * THIS EXISTS BECAUSE THE FIRST VERSION HAD IT EXACTLY BACKWARDS: skipping
 * every interval under 20 seconds meant the FASTER a teleport was, the less
 * it was checked. Two claims 260 km apart, two seconds apart, sailed through
 * untouched - which is the single most obvious spoof there is. Caught by
 * actually trying it against the server rather than reasoning about it.
 *
 * 200 m is deliberately far above real GPS error (rarely past 100 m even
 * indoors) so that nothing honest lands above the line.
 */
export const JITTER_MAX_METRES = 200;

export interface TravelVerdict {
  /** Implied speed in metres per second, or null when it cannot be judged. */
  speedMps: number | null;
  /** True when no human, in any vehicle, could have covered it. */
  impossible: boolean;
}

/** Was getting from A to B in this long physically possible? */
export function travelVerdict(input: { metres: number; seconds: number }): TravelVerdict {
  const { metres, seconds } = input;

  if (seconds < TRAVEL_MIN_SECONDS) {
    // Short interval, small distance: jitter. Says nothing either way.
    if (metres < JITTER_MAX_METRES) return { speedMps: null, impossible: false };
    // Short interval, LARGE distance: judged on the most generous reading of
    // the gap there is, so an unknown interval can never flatter a teleport.
    const generous = metres / TRAVEL_MIN_SECONDS;
    return { speedMps: generous, impossible: generous > MAX_TRAVEL_SPEED_MPS };
  }

  const speedMps = metres / seconds;
  return { speedMps, impossible: speedMps > MAX_TRAVEL_SPEED_MPS };
}

/**
 * ===========================================================================
 *  LAYER 3b - IS THE TRACK ITSELF REAL?
 * ===========================================================================
 *  A spoofer that supplies displacement defeats layer 2 outright: it can
 *  claim any distance it likes. What it struggles with is making that
 *  movement look like it came from a RECEIVER rather than from arithmetic.
 *
 *  The GNSS literature on this is mostly about signal power and satellite
 *  geometry, none of which a phone app can see. But four of its findings do
 *  survive the trip down to what a handset exposes, and all four describe the
 *  same thing: REAL GPS IS NOISY AND FAKE GPS IS NOT.
 *
 *    ACCURACY never repeats. A real receiver reports 6.8 m, then 11.2, then
 *    7.4, as satellites come and go. Fake tracks report a constant.
 *
 *    ALTITUDE drifts by metres even standing still, and is frequently
 *    negative. Fake tracks report 0, or the same number every time.
 *
 *    A PATH WOBBLES. A person walking a straight street still produces a
 *    trace that wanders a metre either side. Interpolated coordinates run
 *    dead straight - the "position changes without corresponding changes in
 *    speed or heading" that the spoofing literature describes.
 *
 *    SPEED AND DISPLACEMENT AGREE. The receiver derives speed from Doppler,
 *    independently of position. A generated track sets one and computes the
 *    other, or leaves speed at zero entirely.
 *
 *  NONE OF THESE IS CONCLUSIVE and a determined faker can add noise to all
 *  four. The point is cost: it moves spoofing from "install an app" to
 *  "write a plausible receiver simulator", which is a different population of
 *  attacker entirely.
 */

export interface TraceQuality {
  /** How many fixes went into the window. */
  samples: number;
  /** Spread of reported accuracy, in metres (max - min). */
  accuracySpreadM: number;
  /** Spread of reported altitude, in metres (max - min). */
  altitudeSpreadM: number | null;
  /**
   * Straight-line displacement over path length. 1.0 is a perfect ruler
   * line; real walking rarely exceeds 0.98 over any meaningful distance.
   */
  straightness: number | null;
  /**
   * How well the receiver's own speed readings match the distance actually
   * covered. 1.0 is perfect agreement, 0 is none.
   */
  speedAgreement: number | null;
}

/** Fewer fixes than this and none of the statistics mean anything. */
export const TRACE_MIN_SAMPLES = 12;

/**
 * Below this spread, accuracy is not being measured - it is being stated.
 * Half a metre across a dozen fixes is not something a receiver does.
 */
export const MIN_ACCURACY_SPREAD_M = 0.5;

/** Same again for altitude, which drifts constantly on real hardware. */
export const MIN_ALTITUDE_SPREAD_M = 1.0;

/** Above this, the path is a drawn line rather than a walked one. */
export const MAX_STRAIGHTNESS = 0.985;

/**
 * Does this trace look like it came from a receiver?
 *
 * Requires at least TWO independent tells, never one. Any single statistic
 * has an innocent cause: a phone that only managed one satellite fix can
 * report a flat accuracy, and a long walk down a seafront really is nearly
 * straight. Two at once is a different matter.
 */
export function traceAuthenticityFlags(q: TraceQuality): number {
  if (q.samples < TRACE_MIN_SAMPLES) return 0;

  let tells = 0;
  if (q.accuracySpreadM < MIN_ACCURACY_SPREAD_M) tells++;
  if (q.altitudeSpreadM !== null && q.altitudeSpreadM < MIN_ALTITUDE_SPREAD_M) tells++;
  if (q.straightness !== null && q.straightness > MAX_STRAIGHTNESS) tells++;
  // Speed that contradicts the distance covered, in either direction.
  if (q.speedAgreement !== null && q.speedAgreement < 0.35) tells++;

  return tells >= 2 ? STEP_FLAG.SYNTHETIC_TRACK : 0;
}

/**
 * ===========================================================================
 *  LAYER 4 - DOES ONE DEVICE HAVE TOO MANY OWNERS?
 * ===========================================================================
 *  A rewards game attracts farms: one phone, many accounts, each collecting
 *  a signup bonus and a daily chest. The referral system already refuses to
 *  pay two accounts on the same phone, which is the expensive half - but
 *  nothing watched the general case.
 *
 *  THE INNOCENT CASE IS REAL AND COMMON: a family shares a tablet, a phone is
 *  sold or handed down, somebody reinstalls and signs in as a friend to show
 *  them the game. Two or three accounts on one device is ordinary.
 *
 *  So the threshold is set where a story stops being plausible rather than
 *  where it stops being unusual, and like everything else here it only ever
 *  contributes to a score.
 */
export const MAX_ACCOUNTS_PER_DEVICE = 4;

/**
 * ...counted over THIS MANY DAYS, not over all time.
 *
 * A phone handed down through a family over three years legitimately
 * accumulates owners, and an all-time count would eventually flag every
 * long-lived device - a false positive that gets MORE likely the longer
 * somebody stays, which is exactly backwards. Five owners in a month is a
 * farm; five owners across three years is a household.
 */
export const DEVICE_SHARING_WINDOW_DAYS = 30;

/**
 * ===========================================================================
 *  LAYER 5 - WHAT TO DO ABOUT IT
 * ===========================================================================
 *  Nothing here bans anybody, and nothing here is silent-and-permanent. The
 *  genre's own enforcement is instructive: Pokemon GO runs a three-strike
 *  ladder (7 days, 30 days, permanent) and uses SOFT bans - quietly reduced
 *  outcomes - long before anything visible happens. The reason is that false
 *  positives are inevitable and a wrongly-banned honest player is a far worse
 *  outcome than a farmer who gets a thin week.
 *
 *  So the response ladder is: watch, then quietly stop paying, then require a
 *  human to look. The only irreversible step needs a person.
 */
export type IntegrityTier = 'CLEAR' | 'WATCH' | 'THROTTLED' | 'REVIEW';

/**
 * Weight per flag. The behavioural ones cost the most because they are the
 * hardest to produce by accident; WRITABLE_SOURCE costs nothing on its own
 * because nearly every honest Android sync sets it.
 */
export const FLAG_WEIGHT: Record<StepFlagName, number> = {
  IDENTICAL_BATCHES: 3,
  ROBOTIC_CADENCE: 3,
  MOCKED_LOCATION: 4,
  DEVICE_SHARED: 3,
  OVER_LIMIT: 1,
  WRITABLE_SOURCE: 0,
  NO_DISPLACEMENT: 3,
  TELEPORT: 5,
  SYNTHETIC_TRACK: 3,
  UNREACHABLE_ACTION: 4,
  UNATTESTED: 0,
} as const;

/** Score for one sync's flags. */
export function flagScore(mask: number): number {
  return (Object.keys(STEP_FLAG) as StepFlagName[])
    .filter((k) => (mask & STEP_FLAG[k]) !== 0)
    .reduce((sum, k) => sum + FLAG_WEIGHT[k], 0);
}

/**
 * Where an account sits, given its recent score.
 *
 * The thresholds are set so that a SINGLE signal never moves anybody: the
 * worst single flag is 5, and WATCH needs 12. It takes a pattern.
 */
export const INTEGRITY_WATCH_SCORE = 12;
export const INTEGRITY_THROTTLE_SCORE = 30;
export const INTEGRITY_REVIEW_SCORE = 60;

export function integrityTier(score: number): IntegrityTier {
  if (score >= INTEGRITY_REVIEW_SCORE) return 'REVIEW';
  if (score >= INTEGRITY_THROTTLE_SCORE) return 'THROTTLED';
  if (score >= INTEGRITY_WATCH_SCORE) return 'WATCH';
  return 'CLEAR';
}

/**
 * What fraction of earnings a tier actually pays.
 *
 * THROTTLED pays a quarter rather than nothing, on purpose. A player who
 * suddenly earns zero knows exactly which trick stopped working and iterates;
 * one who earns a little assumes the game is stingy and loses interest. It
 * also means an honest player caught by a false positive still progresses,
 * slowly, rather than hitting a wall they cannot explain or appeal.
 */
export function payoutMultiplier(tier: IntegrityTier): number {
  if (tier === 'THROTTLED' || tier === 'REVIEW') return 0.25;
  return 1;
}

/**
 * Apply an account's payout share to a reward.
 *
 * Never rounds a real reward away to nothing: a throttled player who earns
 * something still sees progress, and a player who earns literally zero knows
 * precisely which behaviour stopped working.
 */
export function applyShare(amount: number, share: number): number {
  if (share >= 1) return amount;
  return Math.max(amount > 0 ? 1 : 0, Math.floor(amount * share));
}

/** How long a flag keeps counting towards the score. */
export const INTEGRITY_SCORE_WINDOW_DAYS = 14;

/**
 * The five minerals a parcel can turn out to be, commonest first.
 * These are the tier names AND the rarity ladder - a "Ruby parcel" is both
 * what the ground contains and how lucky you were.
 */
export type ParcelRarity = 'ROCKY' | 'COAL' | 'AMETHYST' | 'SAPPHIRE' | 'RUBY';

export interface RarityDefinition {
  readonly rarity: ParcelRarity;
  /**
   * Drop chance expressed in "basis points" (1/100th of a percent).
   * 6_000 = 60.00%. We use whole integers instead of 0.60 floats because
   * integer maths cannot drift, so the drop table always adds up to exactly
   * 100% - no rounding surprises in a system that hands out real value.
   */
  readonly weightBasisPoints: number;
  /** Coins a month. A "month" is SECONDS_PER_MONTH (30 days). */
  readonly coinsPerMonth: number;
}

/**
 * The drop table - TerraMine's rates, with our ruby as the jackpot.
 *
 * Researched 2026-09-26. TerraMine pays exactly what Atlas Earth does per
 * parcel (Atlas Common = TerraMine Rock = $0.00285 a month), with 60/30/9/1%
 * odds, and testers compare us with both. So a rocky parcel here pays what
 * theirs does - 3 coins a month at 1,000 coins to the dollar - and each tier
 * climbs from there. The ruby, one in a hundred, pays about twice their
 * diamond: finding one should still change an account.
 *
 *      mineral    odds   coins/month   $/year
 *      ROCKY      60%       0.6        $0.0072
 *      COAL       25%       0.8        $0.0096
 *      AMETHYST   10%       1.2        $0.0144
 *      SAPPHIRE    4%       2          $0.024
 *      RUBY        1%       6          $0.072
 *
 *  Average parcel: 0.82 coins a month. (It was 3.87 - TerraMine's level -
 *  until 2026-09-27; see the note below for why it came down.) Changing a
 *  rate is a one-line edit here plus a migration for the CHECK constraint
 *  that pins it (see db/migrations/032).
 */
/*
 * RATES CUT 2026-09-27 (migration 032), average 3.87 -> 0.82 coins a month.
 *
 * The product owner asked for parcels to earn less, and a tester (Zhev) had
 * the arithmetic right: a parcel costs a day's walk and nothing else, then
 * pays real-money value for ever. At the old rates a player on 400 parcels
 * cost about $0.02 per boost ad watched - what a rewarded ad EARNS in the US,
 * and more than it earns almost anywhere else - and the unboosted part is
 * paid with no ad behind it at all. Fareground has no in-app purchases (Atlas
 * Earth and TerraMine both do), so ads are all that funds this.
 *
 * Planning figure: $0.008 per rewarded view, paying out at most ~60% of it.
 * At 400 parcels a boost ad now costs 400 x 0.82 x 19 / 1440 = 4.3 coins
 * ($0.004), and every parcel is paid for up front by its claim ad (~$0.008,
 * about a year of its unboosted income). 400 parcels boosted all day is about
 * $0.22 a day. The ratios between minerals are kept (rocky:ruby = 1:10).
 */
export const RARITY_TABLE: readonly RarityDefinition[] = [
  { rarity: 'ROCKY',    weightBasisPoints: 6_000, coinsPerMonth: 0.6 }, // 60%
  { rarity: 'COAL',     weightBasisPoints: 2_500, coinsPerMonth: 0.8 }, // 25%
  { rarity: 'AMETHYST', weightBasisPoints: 1_000, coinsPerMonth: 1.2 }, // 10%
  { rarity: 'SAPPHIRE', weightBasisPoints:   400, coinsPerMonth: 2 },   //  4%
  { rarity: 'RUBY',     weightBasisPoints:   100, coinsPerMonth: 6 },   //  1%
] as const;

/**
 * ---------------------------------------------------------------------------
 *  WHAT A COIN IS WORTH - 1,000 coins = $1.
 * ---------------------------------------------------------------------------
 *  It was 2,000,000 = $1, which testers read, fairly, as an inflation
 *  problem: balances in the millions, each coin worth nothing. Now balances
 *  read in the thousands and a coin is a tenth of a cent. Every balance was
 *  converted at 2,000 old coins to 1 new one (migration 029): the same money.
 *
 *  Money is NEVER stored as a floating-point number anywhere in this system.
 *  Integer coins (and micro-coins for fractions) are the unit of account;
 *  dollars are a derived display value computed at the edge.
 *
 *  >> CASH REDEMPTION IS STILL OFF. <<  These rates are TerraMine-level, and
 *  like TerraMine they only hold up with the valves: the boost taper
 *  (BOOST_TIERS), coins traded back into Walk Points (COINS_PER_WALK_POINT)
 *  and a $5 minimum cash-out. Ad revenue per player has to be measured for
 *  real before this pays anybody anything.
 */
export const COIN_REDEMPTION_USD = 0.001;

/**
 * Coins a player must bank before they may request a payout: 5,000 = $5,
 * the same minimum as Atlas Earth and TerraMine. It was $0.25, which cost
 * more in payment fees than it paid. Coins are spendable from the very first
 * one (COINS_PER_WALK_POINT), so nobody waits on this to use what they earn.
 */
export const MIN_REDEMPTION_COINS = 5_000;

/**
 * IS CASH REDEMPTION LIVE? FALSE. Nothing writes a PAYOUT ledger row, so every
 * coin minted costs nothing yet. Flipping this fails the build until the
 * solvency model in rules.test.ts has been re-checked against real ad data.
 */
export const CASH_REDEMPTION_ENABLED = false;

/**
 * ---------------------------------------------------------------------------
 *  TRADING COINS FOR WALK POINTS - TerraMine's real secret.
 * ---------------------------------------------------------------------------
 *  TerraMine lets players swap their cash earnings back into TerraBucks at
 *  200 per $1, and a mine costs 100 TB - so a mine is $0.50 of earnings, for
 *  land that pays ~$0.04 a year. Players do it constantly anyway, because land
 *  compounds and it is the part they enjoy. Every dollar traded is a dollar
 *  never cashed out.
 *
 *  Ours is the same deal: 10 coins = 1 WP, so a 50 WP parcel costs 500 coins
 *  ($0.50). It is the valve that makes TerraMine-level rates affordable.
 */
export const COINS_PER_WALK_POINT = 10;
/** The most Walk Points one trade can buy - a typo must not empty a balance. */
export const MAX_WALK_POINTS_PER_TRADE = 1_000;

/** Seconds in a year, for annualising a rate. */
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/** Dollar value of a coin balance. Display only - never store this. */
export function coinsToUsd(coins: number): number {
  return coins * COIN_REDEMPTION_USD;
}

/**
 * How many decimal places it takes to show ONE coin. A coin is $0.001, so
 * three. The rule for whoever retunes COIN_REDEMPTION_USD: the display must
 * always be able to show a single coin, and a test enforces it.
 */
export const USD_DISPLAY_DECIMALS = 3;

/** Format a coin balance as dollars for the UI. Display only. */
export function formatCoinsAsUsd(coins: number): string {
  return coinsToUsd(coins).toFixed(USD_DISPLAY_DECIMALS);
}

/** A monthly rate in dollars per second - for a live "per second" ticker. */
export function coinsPerMonthToUsdPerSecond(coinsPerMonth: number): number {
  return (coinsPerMonth / SECONDS_PER_MONTH) * COIN_REDEMPTION_USD;
}

/** What a monthly rate is worth over a year - the number that matters to us. */
export function coinsPerMonthToUsdPerYear(coinsPerMonth: number): number {
  return coinsPerMonthToUsdPerSecond(coinsPerMonth) * SECONDS_PER_YEAR;
}

/** Whether a balance has reached the payout threshold. */
export function canRedeem(coins: number): boolean {
  return coins >= MIN_REDEMPTION_COINS;
}

const TOTAL_WEIGHT = RARITY_TABLE.reduce((sum, entry) => sum + entry.weightBasisPoints, 0);

// Fail at startup (not at 3am in production) if someone edits the table and
// the percentages no longer add up to 100%.
if (TOTAL_WEIGHT !== 10_000) {
  throw new Error(
    `Rarity drop table must add up to 10,000 basis points (100%), got ${TOTAL_WEIGHT}.`,
  );
}

/**
 * Pick a mineral using the weighted drop table above.
 *
 * How the "weighted random" works - imagine a 10,000-slot raffle:
 *   slots     0 - 5,999  -> ROCKY      (6,000 slots = 60%)
 *   slots 6,000 - 8,499  -> COAL       (2,500 slots = 25%)
 *   slots 8,500 - 9,499  -> AMETHYST   (1,000 slots = 10%)
 *   slots 9,500 - 9,899  -> SAPPHIRE   (  400 slots =  4%)
 *   slots 9,900 - 9,999  -> RUBY       (  100 slots =  1%)
 * We draw one ticket and walk the table adding up slots until we pass it.
 *
 * We use crypto.randomInt rather than Math.random because this roll hands out
 * real in-game value: randomInt is cryptographically secure and, unlike
 * `Math.floor(Math.random() * n)`, is guaranteed free of modulo bias.
 */
export function rollParcelRarity(options: { forceBest?: boolean } = {}): RarityDefinition {
  // Testing hook (see DEV_LUCKY_EMAILS): always the rarest tier.
  if (options.forceBest) return RARITY_TABLE[RARITY_TABLE.length - 1];
  const ticket = randomInt(0, TOTAL_WEIGHT); // integer in [0, 9999]

  let cursor = 0;
  for (const entry of RARITY_TABLE) {
    cursor += entry.weightBasisPoints;
    if (ticket < cursor) {
      return entry;
    }
  }

  // Unreachable (the loop always returns), but TypeScript wants a value and a
  // defensive fallback beats a crash if someone edits the table badly.
  return RARITY_TABLE[RARITY_TABLE.length - 1];
}

/**
 * How many Walk Points a LIFETIME step total is worth.
 * Example: 2,750 lifetime steps -> 2 WP (the extra 750 steps are banked,
 * see src/services/steps.service.ts for why that matters).
 */
export function walkPointsForTotalSteps(totalSteps: number): number {
  return Math.floor(totalSteps / STEPS_PER_WALK_POINT);
}

/** Nice bit of UX data: how many more steps until the next WP drops. */
export function stepsUntilNextWalkPoint(totalSteps: number): number {
  return STEPS_PER_WALK_POINT - (totalSteps % STEPS_PER_WALK_POINT);
}
