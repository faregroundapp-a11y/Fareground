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
 *  PARCEL PRICE - 50 WP, plus 1 WP for every parcel you already own.
 * ---------------------------------------------------------------------------
 *  1st 50 WP, 10th 59, 50th 99, 100th 149, 200th 249. The welcome bonus
 *  covers the first one.
 *
 *  2026-09-26: the flat price below was made to rise again, gently. Testers
 *  worked the numbers out and were right: with a flat price AND a boost that
 *  covered the whole day, a regular walker's land paid out about ten times
 *  what their ads earned us - a loss on every engaged player the moment coins
 *  are worth cash. The step is +1, not the old +8: early land stays almost as
 *  cheap as flat (the first 50 parcels average 75 WP), and only a player
 *  holding hundreds feels it. Modelled for a regular walker (8,000 steps and
 *  the daily rewards): ~200 parcels after a year, ~370 after three, first
 *  $0.25 in about 2-3 months - and ad revenue covers the land at 1.0-2.1x
 *  for a 3-ad player and 1.7-3.9x for a 12-ad one, from year one to three.
 *
 *  The history, kept because the trade is the same whoever tunes this next:
 *
 *  This replaced a RISING price (20 WP + 8 per parcel owned) on 2026-09-24,
 *  at the product owner's decision. It went flat at 20 WP first and was
 *  raised to 50 the same day. Both halves of the flat-price trade are real
 *  and whoever reads this next should understand them:
 *
 *  WHAT A FLAT PRICE BUYS. It is the single biggest thing separating us from
 *  TerraMine, whose mines are a flat 100 TB. Flat means land grows in a
 *  STRAIGHT LINE with walking; rising means it grows like a square root. It
 *  is why their players reach 1,400 mines where ours reached a few hundred,
 *  and it is why their totals read as worth playing for. It is also simply
 *  easier to understand: "5,000 steps is a parcel" needs no explaining, and
 *  a price that climbs is a treadmill the player feels even if they cannot
 *  name it.
 *
 *  WHY 50 AND NOT 20. At 20 WP a 10,000-step day bought FIVE parcels, every
 *  day, for ever - about 1,800 in the first year. That is more land than the
 *  map around one person can absorb, it makes a claim feel like nothing, and
 *  it piles up liability at a rate no ad revenue could ever meet. 50 WP is
 *  half a normal day's walking per parcel: still roughly six times the land
 *  the old rising price gave, still simple to explain, and 2.5x cheaper to
 *  us than the 20 WP version.
 *
 *  WHAT IT STILL COSTS. Parcels pay FOREVER, so every one is an annuity.
 *  With a flat price what we owe grows in a straight line with time walked,
 *  with no ceiling - just a shallower line than at 20 WP. A player walking
 *  8,000 steps a day gains ~0.6 parcels a day for ever instead of tapering.
 *
 *  >> THAT ONLY COSTS REAL MONEY IF CASH REDEMPTION IS SWITCHED ON. <<
 *
 *  Nothing writes a PAYOUT ledger row today, so the liability is currently
 *  notional. If redemption is ever built, THIS NUMBER IS THE FIRST THING TO
 *  REVISIT - either restore the rising step, or cap total parcels, or price
 *  redemption against a flat-price world from the start. Do not build
 *  payouts on top of a flat price without redoing the solvency model in
 *  rules.test.ts; the old one assumed a square root and is no longer valid.
 */
export const PARCEL_BASE_PRICE_WP = 50;

/**
 * The rise per parcel owned. 0 made the price flat (2026-09-24 to -26), 8 was
 * the original steep curve. 1 is what keeps land growing more slowly than
 * walking - which is the whole solvency argument - without making the tenth
 * parcel feel expensive.
 */
export const PARCEL_PRICE_STEP_WP: number = 1;

/** What the NEXT parcel costs, given how many the player already owns. */
export function parcelPriceWp(owned: number): number {
  return PARCEL_BASE_PRICE_WP + PARCEL_PRICE_STEP_WP * Math.max(0, Math.floor(owned));
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
 *  A player chooses to watch an ad and gets one of two rewards:
 *
 *   BOOST        30 minutes of DOUBLE coin income. These stack, but at most 4
 *                hours can be banked ahead, so a boost is something you top
 *                up, not something you farm.
 *   WALK_POINTS  +5 WP (worth 500 steps) straight away.
 *
 *  Both have daily caps (a rolling 24 hours). The caps protect us: every
 *  reward is a real cost, and ad networks pay less for a player who watches
 *  forty ads in a row. They also keep walking the main way to earn.
 *
 *  Liability of a boost: at most 12 x 30 min = 6 hours of 2x income a day,
 *  which is +25% on that player's income. One rewarded ad earns us roughly
 *  $0.01-0.03. A player with 100 parcels makes ~0.03 coins' worth of dollars
 *  per boosted hour, so every boost pays for itself many times over.
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
  | 'PHOTO';

/**
 * BOOSTS ARE THE EARNING LEVER, not the base rate. It is the single most
 * important thing about the economy and it took three goes to get right.
 *
 * SHAPED AFTER TERRAMINE, the closest comparable game. It is worth being
 * precise about why, because the first assumption about it was wrong:
 * TerraMine mines are NOT bought with real money. They are claimed for
 * 100 TerraBucks earned by walking, exactly like our parcels. It is a true
 * peer, so its numbers are the right target.
 *
 * Its boost reaches 20x, handed out in 30-minute pieces, stacking to at most
 * 8 hours a day - a daily average of (8x20 + 16)/24 = 7.3x.
 *
 * Ours were: 30 min per ad, 4h bank, 2x (about +25% on a day). Then 2 hours
 * per ad, 24h bank, still 2x (a flat doubling). Both were the wrong SHAPE: a
 * small multiplier spread thin, where the genre uses a big multiplier in
 * short bursts. A burst is something a player plans a walk around; a flat 2x
 * is wallpaper.
 *
 * Now 20x, in THIRTY-MINUTE pieces, banking to 12 hours - two days of ads. (It was two-hour pieces and a 24-hour bank for two days; the
 * paragraphs below still describe that setting and why it was cut.)
 *
 * SECONDS PER AD IS THE LEVER, NOT THE BANK - and that lever has now been
 * pulled all the way. What a player earns per day is capped by
 * MAX_BOOST_ADS_PER_DAY x BOOST_SECONDS_PER_AD; the bank only decides when
 * those hours may be spent. At two hours an ad, twelve ads buy the whole
 * day, so the two coincide and the day-average is 20x.
 *
 * The bank being 24 hours is still the reason hours can be SAVED rather than
 * burned: a player who watches six ads today and six tomorrow gets the same
 * total boost as one who watches twelve in a morning.
 *
 * At 20 minutes an ad the heavy player's margin at the worst ad price was
 * 2.7x; at 15 it is 3.3x, and that is the row where the real money sits
 * because it carries the highest absolute cost.
 *
 * The three-ads-a-day case stays around 1.75x and that is accepted. Pushing
 * it to 2.0x needs 10-minute pieces, which costs EVERY engaged player 38% of
 * their boost to protect a player who is worth $8.76 a year in the first
 * place. Bad trade. If the ad rates turn out worse than assumed, 10 minutes
 * is the setting to fall back to.
 */
export const BOOST_MULTIPLIER = 20;

/**
 * THIRTY MINUTES PER AD - TerraMine's piece size. A day's twelve ads buy six
 * hours at 20x, a day-average of 5.75x. Cut from two hours on 2026-09-26
 * together with the rising price - see PARCEL_BASE_PRICE_WP - first to 20
 * minutes, then set to 30 by the product owner the same day. It keeps the
 * 20x burst players plan a walk around, and ends the "20x all day" that made
 * every parcel owned cost more than the ads paying for it.
 *
 * 30 rather than 20 costs about 40% more boosted land for a player watching
 * all twelve ads. If ad revenue comes in low, PARCEL_PRICE_STEP_WP = 2 is the
 * lever that pays for it (see the handoff, section 25).
 *
 * WHAT FOLLOWS IS THE HISTORY OF THE TWO-HOUR SETTING, kept for its reasoning.
 * TWO HOURS PER AD made a day's twelve ads fill a 24-hour bank exactly.
 *
 * This is a deliberate, product-owner decision to make the boost feel worth
 * watching an ad for, and it is a BIG change: a player who watches all
 * twelve now spends the whole day at 20x instead of three hours of it. The
 * day-average goes 3.38x -> 20x.
 *
 * >> WHAT THIS WOULD COST IF COINS WERE EVER REDEEMABLE FOR CASH <<
 *
 * The economy report's own "flat 20x" analysis: about $63 of land per
 * engaged player per year, against ad revenue of $8.76 (pessimistic),
 * $32.85 (middling) or $91.25 (good). That is a LOSS in two of the three
 * cases - the report has said so since before this change, and it is still
 * right.
 *
 * It is free today because CASH_REDEMPTION_ENABLED is false: nothing writes
 * a PAYOUT row, so coins cost nothing to mint. The guard in rules.test.ts
 * fails the build the moment anyone flips that flag, and it now checks the
 * boost as well as the parcel price.
 *
 * IF REDEMPTION IS EVER SWITCHED ON, THIS IS THE FIRST NUMBER TO CUT. 15
 * minutes an ad (3.38x over a day) is the setting it came from and the one
 * the solvency model was built on.
 */
export const BOOST_SECONDS_PER_AD = 30 * 60;

/**
 * Twelve hours: two days' worth of ads (12 x 30 min = 6 h a day). Hours can be
 * saved up for a long walk, but what a player can EARN per day is still
 * bounded by MAX_BOOST_ADS_PER_DAY, not by this.
 */
export const BOOST_MAX_BANKED_SECONDS = 12 * 60 * 60;
export const MAX_BOOST_ADS_PER_DAY = 12;

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
export const AD_WALK_POINTS = 5;
export const MAX_WP_ADS_PER_DAY = 20;

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
export const MAX_INSTANT_COLLECT_ADS_PER_DAY = 3;

export const SCOUT_SECONDS_PER_AD = 10 * 60;
export const SCOUT_MAX_BANKED_SECONDS = 30 * 60;
export const MAX_SCOUT_ADS_PER_DAY = 6;
/** Claim reach while scouting, against MAX_CLAIM_DISTANCE_M normally. */
export const SCOUT_CLAIM_DISTANCE_M = 75;

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

/**
 * Guards against resetting "today" by changing time zone: a reward is never
 * paid twice within this many hours. Deliberately short - opening the chest
 * at 11pm and again at 8am the next day is honest play and must work. The
 * one-per-local-day unique index does the real work; this only stops rapid
 * time-zone hopping, which could otherwise squeeze extra days out.
 */
export const DAILY_MIN_GAP_HOURS = 4;
export const QUEST_MIN_GAP_HOURS = 4;

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
export const PIT_STOP_WP_OWN = 2;
export const PIT_STOP_WP_NEIGHBOUR = 5;

/** First time on a given parcel, ever. Exploring beats a fixed circuit. */
export const PIT_STOP_NEW_BONUS_WP = 4;

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
 *  rewarded ad, and adds a flat +1 coin/hour:
 *
 *      level 1   25 WP + 1 ad     level 3   75 WP + 1 ad
 *      level 2   50 WP + 1 ad     level 4  100 WP + 1 ad
 *
 *  Fully upgrading one parcel costs 250 WP (25,000 steps) and four ads, and
 *  adds 4 coins/hour = $0.035 a year of liability.
 *
 *  Why this HELPS solvency: those same 250 WP would otherwise buy several
 *  early parcels worth more than $0.035/yr between them. Upgrading is the
 *  cheaper way for a player to spend Walk Points, and it pays us four ads.
 */
export const PARCEL_MAX_UPGRADE = 4;
export const PARCEL_UPGRADE_COINS_PER_LEVEL = 1;

/** Walk Points to go from `level` to `level + 1`. */
export function parcelUpgradeCostWp(level: number): number {
  return 25 * (Math.max(0, Math.floor(level)) + 1);
}

/** A parcel's real rate: its mineral plus whatever it has been upgraded by. */
export function parcelCoinsPerHour(baseCoinsPerHour: number, upgradeLevel: number): number {
  return baseCoinsPerHour + PARCEL_UPGRADE_COINS_PER_LEVEL * Math.max(0, Math.min(PARCEL_MAX_UPGRADE, upgradeLevel));
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
 */
export const TREASURE_FREE_PER_DAY = 2;
export const TREASURE_MAX_PER_DAY = 10;
export const TREASURE_MIN_DISTANCE_M = 150;
export const TREASURE_MAX_DISTANCE_M = 400;
export const TREASURE_COLLECT_DISTANCE_M = 30;
export const TREASURE_TTL_MINUTES = 120;
export const TREASURE_MIN_WP = 6;
export const TREASURE_MAX_WP = 14;

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
 */
export const MICRO_PER_COIN = 1_000_000;

/**
 * Micro-coins earned over a stretch of time.
 *
 * `boostedSeconds` must lie inside `elapsedSeconds`. Boosted time pays
 * `multiplier` times over: the base rate for all the time, plus
 * (multiplier - 1) extra for the boosted part.
 */
export function accruedMicroCoins(input: {
  coinsPerHour: number;
  elapsedSeconds: number;
  boostedSeconds: number;
  multiplier?: number;
}): number {
  const { coinsPerHour, multiplier = BOOST_MULTIPLIER } = input;
  const elapsed = Math.max(0, input.elapsedSeconds);
  const boosted = Math.min(elapsed, Math.max(0, input.boostedSeconds));
  return microCoinsFor(coinsPerHour, elapsed + boosted * (multiplier - 1));
}

/** Micro-coins for `weightedSeconds` of income at `coinsPerHour`. */
export function microCoinsFor(coinsPerHour: number, weightedSeconds: number): number {
  if (coinsPerHour <= 0 || weightedSeconds <= 0) return 0;
  return Math.floor((coinsPerHour * weightedSeconds * MICRO_PER_COIN) / 3600);
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
 * Rolling 24-hour ceiling, and the real backstop. For scale: 10,000 steps is
 * the usual daily target and a 100km ultramarathon is roughly 120,000 steps.
 * 60,000 is a very good day, so honest players will never touch this.
 */
export const MAX_STEPS_PER_DAY = 60_000;

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
  readonly coinsPerHour: number;
}

/**
 * The drop table. Order does not matter for fairness, only for readability.
 *
 * NOTE ON THE HOURLY RATES: the drop chances were specified, the rates were
 * not, so these are a proposal. Changing them is a one-line edit here plus a
 * migration to update the CHECK constraint - see db/migrations/003.
 *
 * For what it is worth, the average parcel is worth 3.08 coins/hour:
 *   0.60x1 + 0.25x2 + 0.10x5 + 0.04x12 + 0.01x100
 * The floor is about 1.6 whatever you do, because coins are whole numbers and
 * the commonest tier cannot pay less than 1. So the spread between tiers is
 * really a lever on EXCITEMENT, not on how fast coins pile up.
 *
 * RUBY went 40 -> 100 in the same change that cut the coin's dollar value by
 * 60%. That is the point: the CUT lands on the four common tiers, and the
 * one-in-a-hundred find comes out worth exactly what it was worth before.
 * A rebalance that also flattened the jackpot would have taken the reason to
 * keep claiming along with the liability. Needs migration 017 (a CHECK
 * constraint pins the rate).
 */
export const RARITY_TABLE: readonly RarityDefinition[] = [
  { rarity: 'ROCKY',    weightBasisPoints: 6_000, coinsPerHour: 1 },  // 60%
  { rarity: 'COAL',     weightBasisPoints: 2_500, coinsPerHour: 2 },  // 25%
  { rarity: 'AMETHYST', weightBasisPoints: 1_000, coinsPerHour: 5 },  // 10%
  { rarity: 'SAPPHIRE', weightBasisPoints:   400, coinsPerHour: 12 }, //  4%
  { rarity: 'RUBY',     weightBasisPoints:   100, coinsPerHour: 100 }, //  1%
] as const;

/**
 * ---------------------------------------------------------------------------
 *  REDEMPTION - the most consequential number in the product.
 * ---------------------------------------------------------------------------
 *  Coins are redeemable for real money, so every coin this server mints is a
 *  liability. The rate is calibrated against Atlas Earth, whose published
 *  rates annualise like this:
 *
 *      Atlas Common      $0.0000000011/sec  =  $0.035 / year
 *      Atlas Legendary   $0.0000000044/sec  =  $0.139 / year
 *
 *  Fourteen cents a year for their TOP tier. That is not stinginess, it is
 *  the only shape that funds itself: a parcel pays out forever, so its cost
 *  is an annuity, while ad revenue per player is flat. Anything generous
 *  enough to feel like wages goes insolvent within a year.
 *
 *  So: one coin is worth half a millionth of a dollar. Put another way,
 *  TWO MILLION COINS IS ONE DOLLAR.
 *
 *  That lands our average parcel on $0.0135/year, or $0.0456 once a full
 *  day of boost ads is counted in - against $0.0496 for an Atlas Earth
 *  parcel and $0.0415 for an average TerraMine mine. Under both on the base
 *  rate on purpose, level with them once the player has paid for it in ads.
 *  Each tier:
 *
 *      ROCKY      1 coin/hr   $0.00438 / year
 *      COAL       2           $0.00876 / year
 *      AMETHYST   5           $0.0219  / year
 *      SAPPHIRE  12           $0.0526  / year
 *      RUBY     100           $0.438   / year
 *
 *  NOTE THE WIDER SPREAD than Atlas, who run only 4x from bottom to top, or
 *  TerraMine, whose Diamond pays 4x a Rock. We run 100x, on purpose: they
 *  sell or flat-price their land, so the rarity roll is minor flavour on it.
 *  Here the only way to get a parcel is to walk for it, so the roll has to be
 *  worth the walk - finding a ruby should change your account.
 *
 *  SOLVENCY CHECK, with the rising parcel price and every way to earn.
 *
 *  A VERY engaged player earns about 200 WP a day: 80 from 8,000 steps, ~16
 *  from the chest, ~50 from quests, ~20 from a check-in and ~30 from bonus-WP
 *  ads (most of those doubled by watching an ad). They hold, and cost us:
 *
 *      end of year 1  ~133 parcels   ~$1.79/yr
 *      end of year 2  ~190 parcels   ~$2.56/yr
 *      end of year 3  ~233 parcels   ~$3.14/yr
 *
 *  Those are BASE figures. A player who boosts all day costs 3.38x that
 *  ($10.61/yr at year three) - but to do it they must watch twelve ads.
 *
 *  Growth slows every year, because each parcel costs more than the last.
 *  That same player watches something like 8-12 rewarded ads a day; even at a
 *  pessimistic $0.008 a view, three a day is ~$8.76/year of revenue against
 *  ~$5/year of land. The engagement features PAY for the land they buy,
 *  which is the whole point of putting the rewards behind ads.
 *
 *  It only works because the coin rate is this small. Raise it tenfold and we
 *  are underwater in the first year.
 *
 *  THE HONEST CONSEQUENCE: nobody earns a living here. A year of hard walking
 *  buys a few pence. What makes the cash defensible is the rate per HOUR OF
 *  ADS - $0.18 for a Regular player, against a published Atlas Earth figure
 *  of about $0.003 - and not the annual total, which is small and always
 *  will be. The money is a hook, not a wage, and the real reward has to be
 *  the map, the collection and the streak. Design accordingly.
 *
 *  Money is NEVER stored as a floating-point number anywhere in this system.
 *  Integer coins are the unit of account; dollars are a derived display value
 *  computed at the edge. That is not fussiness - binary floats cannot
 *  represent most decimal money exactly, and the errors accumulate.
 */

/**
 * One coin in US dollars. TWO MILLION COINS = $1.00.
 *
 * Cut from $0.000002 -> $0.000001 -> $0.0000004, then raised to $0.0000005
 * in the player-side rebalance, as more ways to earn were
 * added. Each cut has the same cause: land pays FOREVER, so every parcel is
 * an annuity we owe for the life of the account, while an ad pays us once.
 * When the faucets widened, the rate had to come down to match.
 *
 * This is the lever that costs the player the least to pull. Coin COUNTS are
 * untouched - the balance still climbs, the counter still ticks, a ruby is
 * still a hundred times a rock. Only the dollar figure at the very edge moves.
 * Trimming the chest or the quests would have been felt on every screen.
 *
 * It is also the honest comparison with Atlas Earth: their parcels are BOUGHT
 * with money, ours are earned by walking, so ours should be worth less each.
 */
export const COIN_REDEMPTION_USD = 0.0000005;

/**
 * Coins a player must bank before they may request a payout. 500,000 = $0.25.
 *
 * Was $1.00, which measured out as: a casual player waiting TWO YEARS to be
 * allowed to collect anything at all, and even a player squeezing every
 * source waiting a full year. Nobody stays for that, and a reward nobody
 * reaches is not a reward - it is a number going up next to a locked door.
 *
 * Lowering it costs the business nothing. It does not change a single rate;
 * it only changes when somebody may take what they have already earned.
 * Everything about solvency is decided by the coin value and the parcel
 * price, both of which are untouched.
 *
 * ONE CAVEAT FOR WHOEVER BUILDS REDEMPTION: sending $0.25 as CASH costs more
 * in processing than it is worth. A threshold this low only makes sense if
 * redemption is a gift-card balance, an in-app credit, or accrues toward a
 * larger withdrawal. Decide that before switching payouts on, and raise this
 * number if the answer turns out to be bank transfers.
 */
export const MIN_REDEMPTION_COINS = 500_000;

/**
 * ---------------------------------------------------------------------------
 *  IS CASH REDEMPTION LIVE? The most consequential boolean in the codebase.
 * ---------------------------------------------------------------------------
 *  FALSE today. Nothing writes a PAYOUT ledger row, so every coin minted is
 *  a number on a screen and costs us nothing at all.
 *
 *  This exists because the parcel price went FLAT on 2026-09-24 (see
 *  PARCEL_BASE_PRICE_WP). A flat price makes the land we owe grow in a
 *  straight line with time walked, with no ceiling - which is free while
 *  this is false and ruinous the moment it is true. Modelled at the current
 *  rates, a hard-walking player would cost about $50/yr of land in year one
 *  against $9-91/yr of ad revenue.
 *
 *  So: FLIPPING THIS TO TRUE FAILS THE BUILD until the solvency model in
 *  rules.test.ts is redone. That is deliberate. It converts a mistake nobody
 *  would notice for a year into a red test on the day it is made.
 *
 *  When that day comes, the options are: restore PARCEL_PRICE_STEP_WP to 8,
 *  cap total parcels per account, or price redemption for a flat-price world
 *  from the start. Pick one and rewrite the model; do not just delete the
 *  guard.
 */
export const CASH_REDEMPTION_ENABLED = false;

/** Seconds in a year, for annualising a rate. */
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/** Dollar value of a coin balance. Display only - never store this. */
export function coinsToUsd(coins: number): number {
  return coins * COIN_REDEMPTION_USD;
}

/**
 * How many decimal places it takes to show ONE coin.
 *
 * This is not a style choice, it is arithmetic: a coin is worth $0.0000005,
 * so anything less than seven decimal places literally cannot represent the
 * smallest unit of the currency. At two places a player would read $0.00 for
 * over a year; at four they would read $0.0000 for two days after buying their
 * first parcel, and reasonably conclude the app was broken.
 *
 * It went 6 -> 7 when the coin was recut. That is the rule of
 * thumb for whoever retunes COIN_REDEMPTION_USD next: the display must always
 * be able to show a single coin, and a test enforces it.
 */
export const USD_DISPLAY_DECIMALS = 7;

/** Format a coin balance as dollars for the UI. Display only. */
export function formatCoinsAsUsd(coins: number): string {
  return coinsToUsd(coins).toFixed(USD_DISPLAY_DECIMALS);
}

/**
 * The rate a parcel earns, expressed the way Atlas Earth shows it. Useful for
 * comparing tiers against theirs, and for a "per second" ticker in the app.
 */
export function coinsPerHourToUsdPerSecond(coinsPerHour: number): number {
  return (coinsPerHour / 3600) * COIN_REDEMPTION_USD;
}

/** What a rate is worth over a year - the number that actually matters to us. */
export function coinsPerHourToUsdPerYear(coinsPerHour: number): number {
  return coinsPerHourToUsdPerSecond(coinsPerHour) * SECONDS_PER_YEAR;
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
