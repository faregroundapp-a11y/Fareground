/**
 * Unit tests for the economy rules.
 *
 * Run with:  npm test
 *
 * These use Node's own built-in test runner - no Jest, no Vitest, no config.
 * `rules.ts` is pure (no database, no network), which is exactly why it is the
 * cheapest and most valuable thing in the codebase to test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_STEPS_PER_DAY,
  MAX_STEPS_PER_MINUTE,
  SHORT_WINDOW_MINUTES,
  RARITY_TABLE,
  STEPS_PER_WALK_POINT,
  WALK_POINTS_PER_PARCEL,
  SIGNUP_BONUS_WP,
  BOOST_MULTIPLIER,
  BOOST_SECONDS_PER_AD,
  BOOST_MAX_BANKED_SECONDS,
  MAX_BOOST_ADS_PER_DAY,
  accruedMicroCoins,
  dailyChestWp,
  DAILY_QUESTS,
  CHECKIN_WP,
  CHECKIN_NEW_PLACE_BONUS_WP,
  AD_WALK_POINTS,
  MAX_WP_ADS_PER_DAY,
  REFERRAL_MAX_REWARDED,
  REFERRAL_REWARD_REFEREE_WP,
  REFERRAL_REWARD_REFERRER_WP,
  REFERRAL_STEPS_TO_QUALIFY,
  parcelPriceWp,
  splitMicroCoins,
  COIN_REDEMPTION_USD,
  MIN_REDEMPTION_COINS,
  canRedeem,
  coinsPerMonthToUsdPerSecond,
  coinsPerMonthToUsdPerYear,
  BOOST_TIERS,
  boostMultiplierFor,
  COINS_PER_WALK_POINT,
  MAX_WALK_POINTS_PER_TRADE,
  SECONDS_PER_MONTH,
  coinsToUsd,
  formatCoinsAsUsd,
  USD_DISPLAY_DECIMALS,
  MAX_STEPS_PER_DAY,
  MAX_STEPS_PER_MINUTE,
  STEP_FLAG,
  describeStepFlags,
  plausibleStepAllowance,
  stepPatternFlags,
  sustainablePace,
  rollParcelRarity,
  stepsUntilNextWalkPoint,
  walkPointsForTotalSteps,
  type ParcelRarity,
  PIT_STOP_COOLDOWN_SECONDS,
  PIT_STOP_NEW_BONUS_WP,
  PIT_STOP_PROPERTY_COOLDOWN_HOURS,
  PIT_STOP_WP_NEIGHBOUR,
  PIT_STOP_WP_OWN,
  pitStopWp,
  CASH_REDEMPTION_ENABLED,
  FLAG_WEIGHT,
  DEVICE_SHARING_WINDOW_DAYS,
  MAX_ACCOUNTS_PER_DEVICE,
  traceAuthenticityFlags,
  JITTER_MAX_METRES,
  applyShare,
  INTEGRITY_REVIEW_SCORE,
  INTEGRITY_THROTTLE_SCORE,
  INTEGRITY_WATCH_SCORE,
  UNCORROBORATED_STEPS_PER_DAY,
  flagScore,
  integrityTier,
  payoutMultiplier,
  stepDisplacementVerdict,
  travelVerdict,
  PARCEL_BASE_PRICE_WP,
  PARCEL_PRICE_STEP_WP,
} from './rules';

test('the headline economy numbers are what the design doc says', () => {
  assert.equal(STEPS_PER_WALK_POINT, 100);
  assert.equal(WALK_POINTS_PER_PARCEL, 50);
  // Derived from the price, so this can never silently drift apart - a new
  // player who cannot afford their first claim has no onboarding at all.
  assert.equal(SIGNUP_BONUS_WP, PARCEL_BASE_PRICE_WP, 'the welcome bonus must buy exactly one parcel');
  assert.equal(SIGNUP_BONUS_WP, 50);
});

test('every parcel costs the same - flat, for ever', () => {
  // The product owner's decision, 2026-09-26: "I don't want prices to increase."
  assert.equal(PARCEL_PRICE_STEP_WP, 0);
  assert.equal(parcelPriceWp(0), 50, 'the first parcel is exactly the welcome bonus');
  assert.equal(parcelPriceWp(-3), 50, 'never below the base price');
  for (let n = 0; n < 500; n++) {
    assert.equal(parcelPriceWp(n + 1), parcelPriceWp(n), `the price moved at parcel ${n}`);
  }
  // The consequence, stated as a property: land grows in a STRAIGHT LINE with
  // walking. That is what the boost taper and the coin trade exist to absorb.
  assert.equal(parcelsAfter(200, 100) - parcelsAfter(100, 100), parcelsAfter(100, 100) - parcelsAfter(0, 100));
});

test('the boost is 20x, 30 minutes an ad, 12 hours banked', () => {
  assert.equal(BOOST_MULTIPLIER, 20);
  assert.equal(BOOST_SECONDS_PER_AD, 1_800, 'thirty minutes an ad');
  assert.equal(BOOST_MAX_BANKED_SECONDS, 43_200, 'twelve hours banked');
  // Enough ads to stay boosted all day, for a player who wants to.
  assert.ok(MAX_BOOST_ADS_PER_DAY * BOOST_SECONDS_PER_AD >= 86_400, 'a whole day must be reachable');
  // Bank must hold at least one ad, or an ad could buy nothing.
  assert.ok(BOOST_MAX_BANKED_SECONDS >= BOOST_SECONDS_PER_AD);
});

test('the boost tapers only for very large holders', () => {
  // Full 20x for every ordinary player, TerraMine's "$1 a day" point included.
  assert.equal(boostMultiplierFor(0), 20);
  assert.equal(boostMultiplierFor(1), 20);
  assert.equal(boostMultiplierFor(400), 20);
  assert.equal(boostMultiplierFor(401), 15);
  assert.equal(boostMultiplierFor(1_000), 10);
  assert.equal(boostMultiplierFor(50_000), 5);
  // Never rises with more land, never falls below a real boost.
  for (let n = 1; n < 3_000; n++) {
    assert.ok(boostMultiplierFor(n) <= boostMultiplierFor(n - 1), `the boost rose at ${n} parcels`);
  }
  assert.ok(BOOST_TIERS[BOOST_TIERS.length - 1].multiplier >= 2, 'the last tier must still be a boost');

  // THE POINT OF THE TAPER: what one 30-minute ad hands out stays level
  // however much land is behind it, instead of growing without limit. Here it
  // never goes past about $0.03 (at 20x with 400 parcels it is ~$0.02).
  const avgPerMonth = RARITY_TABLE.reduce((s, e) => s + (e.weightBasisPoints / 10_000) * e.coinsPerMonth, 0);
  const perAdUsd = (parcels: number) =>
    parcels * coinsPerMonthToUsdPerSecond(avgPerMonth) * BOOST_SECONDS_PER_AD * (boostMultiplierFor(parcels) - 1);
  for (const n of [100, 400, 700, 1_000, 2_000]) {
    assert.ok(perAdUsd(n) < 0.035, `one ad at ${n} parcels hands out $${perAdUsd(n).toFixed(4)}`);
  }
});

test('income is exact in micro-coins, and nothing is lost to rounding', () => {
  // 3 coins a month for one day = a tenth of a coin.
  const oneDay = accruedMicroCoins({ coinsPerMonth: 3, elapsedSeconds: 86_400, boostedSeconds: 0 });
  assert.equal(oneDay, 100_000);
  // Ten polls of a day add up to a whole coin - the old "reset the clock and
  // round down" bug would have paid 0.
  let carried = 0, coins = 0;
  for (let i = 0; i < 10; i++) {
    const split = splitMicroCoins(carried + oneDay);
    coins += split.coins;
    carried = split.remainderMicro;
  }
  assert.equal(coins, 1);
  assert.equal(SECONDS_PER_MONTH, 30 * 86_400);
});

test('a boost multiplies only the boosted seconds, not the whole window', () => {
  // At 20x getting the window wrong would overpay twenty times over.
  const month = { coinsPerMonth: 10, elapsedSeconds: SECONDS_PER_MONTH };
  assert.equal(accruedMicroCoins({ ...month, boostedSeconds: 0 }), 10_000_000);
  // A fully boosted month: 10 x 20 = 200 coins.
  assert.equal(accruedMicroCoins({ ...month, boostedSeconds: SECONDS_PER_MONTH }), 200_000_000);
  // Half boosted: 5 normal + 5 at 20x = 105 coins. NOT half of 200.
  assert.equal(accruedMicroCoins({ ...month, boostedSeconds: SECONDS_PER_MONTH / 2 }), 105_000_000);
  // Boost claimed beyond the window is clamped to the window.
  assert.equal(accruedMicroCoins({ ...month, boostedSeconds: 99_999_999 }), 200_000_000);
  assert.deepEqual(splitMicroCoins(15_500_000), { coins: 15, remainderMicro: 500_000 });
});

test('the drop table adds up to exactly 100%', () => {
  const total = RARITY_TABLE.reduce((sum, entry) => sum + entry.weightBasisPoints, 0);
  assert.equal(total, 10_000, 'drop chances must sum to 10,000 basis points');
});

test('each mineral pays the correct monthly rate', () => {
  const expected: Record<ParcelRarity, { chance: number; coinsPerMonth: number }> = {
    ROCKY: { chance: 6_000, coinsPerMonth: 3 },
    COAL: { chance: 2_500, coinsPerMonth: 4 },
    AMETHYST: { chance: 1_000, coinsPerMonth: 5 },
    SAPPHIRE: { chance: 400, coinsPerMonth: 8 },
    RUBY: { chance: 100, coinsPerMonth: 25 },
  };

  assert.equal(RARITY_TABLE.length, 5);

  for (const entry of RARITY_TABLE) {
    assert.equal(entry.weightBasisPoints, expected[entry.rarity].chance, `${entry.rarity} chance`);
    assert.equal(entry.coinsPerMonth, expected[entry.rarity].coinsPerMonth, `${entry.rarity} rate`);
  }
});

test('walk points are floored, and the remainder is never counted twice', () => {
  assert.equal(walkPointsForTotalSteps(0), 0);
  assert.equal(walkPointsForTotalSteps(99), 0);
  assert.equal(walkPointsForTotalSteps(100), 1);
  assert.equal(walkPointsForTotalSteps(199), 1);
  assert.equal(walkPointsForTotalSteps(275), 2);
  assert.equal(walkPointsForTotalSteps(10_000), 100);
});

test('syncing in small batches earns the same as syncing in one big batch', () => {
  // THE REGRESSION TEST for the bug described in steps.service.ts.
  // Walking 120 steps must be worth 1 WP whether the phone reports it as
  // one sync of 120 or two syncs of 60.
  const oneBigSync = walkPointsForTotalSteps(120) - walkPointsForTotalSteps(0);

  const firstSmallSync = walkPointsForTotalSteps(60) - walkPointsForTotalSteps(0);
  const secondSmallSync = walkPointsForTotalSteps(120) - walkPointsForTotalSteps(60);

  assert.equal(oneBigSync, 1);
  assert.equal(firstSmallSync + secondSmallSync, oneBigSync);
});

test('one hundred tiny syncs still pay out correctly', () => {
  // Someone whose phone syncs 5 steps at a time, 100 times = 500 steps.
  let lifetime = 0;
  let earned = 0;

  for (let i = 0; i < 100; i++) {
    const before = lifetime;
    lifetime += 5;
    earned += walkPointsForTotalSteps(lifetime) - walkPointsForTotalSteps(before);
  }

  assert.equal(lifetime, 500);
  assert.equal(earned, 5, 'must earn the full 5 WP, not 0');
});

test('stepsUntilNextWalkPoint counts down correctly', () => {
  assert.equal(stepsUntilNextWalkPoint(0), 100);
  assert.equal(stepsUntilNextWalkPoint(60), 40);
  assert.equal(stepsUntilNextWalkPoint(99), 1);
  assert.equal(stepsUntilNextWalkPoint(100), 100);
});

test('every roll returns a valid parcel', () => {
  for (let i = 0; i < 1_000; i++) {
    const drop = rollParcelRarity();
    const known = RARITY_TABLE.find((entry) => entry.rarity === drop.rarity);

    assert.ok(known, `unknown rarity: ${drop.rarity}`);
    assert.equal(drop.coinsPerMonth, known.coinsPerMonth);
  }
});

test('rolls converge on 60 / 25 / 10 / 4 / 1 over 200,000 draws', () => {
  const ROLLS = 200_000;
  const counts: Record<ParcelRarity, number> = {
    ROCKY: 0, COAL: 0, AMETHYST: 0, SAPPHIRE: 0, RUBY: 0,
  };

  for (let i = 0; i < ROLLS; i++) {
    counts[rollParcelRarity().rarity]++;
  }

  // A 0.75 percentage-point window. For the rarest drop (1%) that is roughly
  // 34 standard deviations and for the commonest (60%) about 7, so this test
  // will not flake - if it fails, the drop table really is wrong.
  const TOLERANCE_PERCENTAGE_POINTS = 0.75;

  for (const entry of RARITY_TABLE) {
    const expectedPercent = entry.weightBasisPoints / 100;
    const actualPercent = (counts[entry.rarity] / ROLLS) * 100;
    const drift = Math.abs(actualPercent - expectedPercent);

    assert.ok(
      drift <= TOLERANCE_PERCENTAGE_POINTS,
      `${entry.rarity}: expected ~${expectedPercent}%, got ${actualPercent.toFixed(3)}%`,
    );
  }

  // Sanity: every mineral must actually show up at least once.
  for (const entry of RARITY_TABLE) {
    assert.ok(counts[entry.rarity] > 0, `${entry.rarity} never dropped`);
  }
});

test('the tiers get rarer and richer in step, with no ties', () => {
  // A ladder where a rarer mineral paid less would be a design bug, and the
  // kind that is easy to introduce by editing one number.
  for (let i = 1; i < RARITY_TABLE.length; i++) {
    const prev = RARITY_TABLE[i - 1];
    const here = RARITY_TABLE[i];
    assert.ok(here.weightBasisPoints < prev.weightBasisPoints, `${here.rarity} not rarer`);
    assert.ok(here.coinsPerMonth > prev.coinsPerMonth, `${here.rarity} pays no better`);
  }
});

test('the average parcel is worth 3.87 coins a month', () => {
  // Pins the economy down: if someone retunes a rate, this says by how much
  // the whole game's coin flow just moved.
  const expectedValue = RARITY_TABLE.reduce(
    (sum, entry) => sum + (entry.weightBasisPoints / 10_000) * entry.coinsPerMonth,
    0,
  );

  assert.equal(Number(expectedValue.toFixed(4)), 3.87);
});

// ---------------------------------------------------------------------------
//  Plausibility limits (anti-cheat layer 3)
// ---------------------------------------------------------------------------

/**
 * An hour's worth of allowance: the smallest window we ever use.
 *
 * Derived from sustainablePace, NOT from MAX_STEPS_PER_MINUTE. The ceiling
 * used to be a flat 250/min at every duration, which made this 15,000; over
 * a whole hour the honest number is 200/min, so it is 12,000. Computing it
 * here rather than writing the figure down means retuning PACE_CURVE moves
 * the tests with it instead of breaking them.
 */
const HOUR_CAPACITY = SHORT_WINDOW_MINUTES * sustainablePace(SHORT_WINDOW_MINUTES); // 12,000

test('a normal sync passes through untouched', () => {
  const result = plausibleStepAllowance({
    requestedSteps: 800,
    minutesSinceLastSync: 30,
    acceptedStepsInLastHour: 2_000,
    acceptedStepsInLast24h: 2_000,
  });

  assert.equal(result.accepted, 800);
  assert.equal(result.rejected, 0);
  assert.equal(result.reason, 'OK');
});

test('back-to-back syncs are NOT clipped', () => {
  // THE REGRESSION TEST for the flaw the e2e suite caught: an allowance based
  // on "time since last sync" threw away the second batch here, turning an
  // honest 600 + 600 into 1,100 credited steps.
  const first = plausibleStepAllowance({
    requestedSteps: 600,
    minutesSinceLastSync: 240,
    acceptedStepsInLastHour: 0,
    acceptedStepsInLast24h: 0,
  });
  assert.equal(first.accepted, 600);

  // ...and now a second sync one second later.
  const second = plausibleStepAllowance({
    requestedSteps: 600,
    minutesSinceLastSync: 0.016,
    acceptedStepsInLastHour: 600,
    acceptedStepsInLast24h: 600,
  });

  assert.equal(second.accepted, 600, 'the second batch must not be clipped');
  assert.equal(first.accepted + second.accepted, 1_200);
});

test('syncing every ten seconds earns the same as syncing hourly', () => {
  // The property that makes the window model fair. Walk 6,000 steps in an
  // hour and report it in 360 dribbles, or in one lump: same credit.
  let banked = 0;
  for (let i = 0; i < 360; i++) {
    const result = plausibleStepAllowance({
      requestedSteps: 50 / 3,
      minutesSinceLastSync: 0.16,
      acceptedStepsInLastHour: banked,
      acceptedStepsInLast24h: banked,
    });
    banked += result.accepted;
  }

  const inOneGo = plausibleStepAllowance({
    requestedSteps: 6_000,
    minutesSinceLastSync: 60,
    acceptedStepsInLastHour: 0,
    acceptedStepsInLast24h: 0,
  });

  assert.equal(Math.round(banked), 6_000);
  assert.equal(inOneGo.accepted, 6_000);
});

test('the window limit truncates an impossible sprint', () => {
  const result = plausibleStepAllowance({
    requestedSteps: 50_000,
    minutesSinceLastSync: 1,
    acceptedStepsInLastHour: 0,
    acceptedStepsInLast24h: 0,
  });

  assert.equal(result.accepted, HOUR_CAPACITY);
  assert.equal(result.rejected, 50_000 - HOUR_CAPACITY);
  assert.equal(result.reason, 'RATE_LIMIT');
});

test('an hour already spent leaves no allowance', () => {
  const result = plausibleStepAllowance({
    requestedSteps: 5_000,
    minutesSinceLastSync: 0.5,
    acceptedStepsInLastHour: HOUR_CAPACITY,
    acceptedStepsInLast24h: HOUR_CAPACITY,
  });

  assert.equal(result.accepted, 0);
  assert.equal(result.reason, 'RATE_LIMIT');
});

test('an honest phone offline all morning is NOT punished', () => {
  // The legitimate case truncation must never hit: 12,000 steps walked with
  // the app closed. The window stretches to cover the time away.
  const result = plausibleStepAllowance({
    requestedSteps: 12_000,
    minutesSinceLastSync: 10 * 60,
    acceptedStepsInLastHour: 0,
    acceptedStepsInLast24h: 0,
  });

  assert.equal(result.accepted, 12_000);
  assert.equal(result.rejected, 0);
  assert.equal(result.reason, 'OK');
});

test('a week offline cannot bank a week of allowance', () => {
  const result = plausibleStepAllowance({
    requestedSteps: 200_000,
    minutesSinceLastSync: 7 * 24 * 60,
    acceptedStepsInLastHour: 0,
    acceptedStepsInLast24h: 0,
  });

  // The window clamps to 24h, and the daily cap then binds.
  assert.equal(result.accepted, MAX_STEPS_PER_DAY);
  assert.equal(result.reason, 'DAILY_LIMIT');
});

test('the daily cap stops drip-feed farming', () => {
  // Hammer the endpoint forever with small, individually-plausible batches.
  let inHour = 0;
  let inDay = 0;

  for (let i = 0; i < 5_000; i++) {
    const result = plausibleStepAllowance({
      requestedSteps: 250,
      minutesSinceLastSync: 0.01,
      acceptedStepsInLastHour: inHour,
      acceptedStepsInLast24h: inDay,
    });
    inHour += result.accepted;
    inDay += result.accepted;
  }

  // The hourly window binds first, and the daily cap is the hard ceiling.
  assert.ok(inDay <= MAX_STEPS_PER_DAY, `banked ${inDay}`);
  assert.equal(inDay, HOUR_CAPACITY, 'cannot exceed one window without waiting');
});

test('once the daily budget is spent, nothing more is accepted', () => {
  const result = plausibleStepAllowance({
    requestedSteps: 5_000,
    minutesSinceLastSync: 120, // fresh window, so only the daily cap can bind
    acceptedStepsInLastHour: 0,
    acceptedStepsInLast24h: MAX_STEPS_PER_DAY,
  });

  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 5_000);
  assert.equal(result.reason, 'DAILY_LIMIT');
});

test('clock skew cannot produce a negative allowance', () => {
  const result = plausibleStepAllowance({
    requestedSteps: 100,
    minutesSinceLastSync: -500,
    acceptedStepsInLastHour: 0,
    acceptedStepsInLast24h: 0,
  });

  assert.ok(result.accepted >= 0);
  assert.equal(result.accepted, 100);
  assert.equal(result.rejected, 0);
});

// ---------------------------------------------------------------------------
//  Redemption - the numbers that decide whether the business survives
// ---------------------------------------------------------------------------

/** Atlas Earth's published rates, for calibration. Dollars per second. */
const ATLAS = { common: 1.1e-9, rare: 1.6e-9, epic: 2.2e-9, legendary: 4.4e-9 };

/**
 * The two comparable games, in DOLLARS PER PARCEL PER YEAR, from published
 * community figures (checked 2026-09-24).
 *
 * Atlas Earth's base is ~$0.000000001589/sec = ~$0.0496/parcel/year.
 * TerraMine's community-verified monthly rents are $0.002851 rock,
 * $0.004147 coal, $0.00507 gold, $0.011405 diamond - so ~$0.0342/yr for a
 * rock and ~$0.0415/yr across their mix.
 *
 * THE THING THAT MATTERS MOST when reading these: in BOTH games parcels are
 * BOUGHT WITH MONEY. Ours are earned by walking, and we have no purchase
 * revenue at all - only ads. We therefore cannot match them per parcel, and
 * should not try. What we can match is the SHAPE: in both, the base rate is
 * close to worthless and the real earnings come from boosts. Ours now do too.
 */
const RIVALS_PER_PARCEL_YEAR = { atlasBase: 0.0496, terramineRock: 0.0342, terramineAverage: 0.0415 };
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

/** The average parcel's monthly coins, across the drop table. */
const averageCoinsPerMonth = RARITY_TABLE.reduce((sum, e) => sum + (e.weightBasisPoints / 10_000) * e.coinsPerMonth, 0);

/** Compare two dollar figures to the nearest hundredth of a cent. */
function nearlyEqual(a: number, b: number, tolerance = 1e-4): boolean {
  return Math.abs(a - b) < tolerance;
}

test('a thousand coins is one dollar', () => {
  // Balances read in the thousands, never the millions (2026-09-26).
  assert.equal(COIN_REDEMPTION_USD, 0.001);
  assert.ok(nearlyEqual(coinsToUsd(1_000), 1, 1e-9));
  // $5 to cash out - the same minimum as Atlas Earth and TerraMine.
  assert.equal(MIN_REDEMPTION_COINS, 5_000);
  assert.ok(nearlyEqual(coinsToUsd(MIN_REDEMPTION_COINS), 5, 1e-9));
});

test('a parcel pays TerraMine rates: between their average and Atlas base', () => {
  // Testers compare us with both, and TerraMine's rates ARE Atlas's. So the
  // average parcel sits just above TerraMine's and under Atlas's base - which
  // is only affordable with the valves (taper, trade, $5 minimum).
  const oursPerYear = coinsPerMonthToUsdPerYear(averageCoinsPerMonth);
  const terramineAverage = (0.6 * 0.002851 + 0.3 * 0.004147 + 0.09 * 0.00507 + 0.01 * 0.011405) * 12;
  assert.ok(oursPerYear > terramineAverage, `ours $${oursPerYear.toFixed(4)}/yr, TerraMine $${terramineAverage.toFixed(4)}`);
  assert.ok(oursPerYear < RIVALS_PER_PARCEL_YEAR.atlasBase, 'must stay under Atlas base');
});

test('each tier annualises to the documented dollar figure', () => {
  // Monthly rates x 365/30 months a year.
  const expected: Record<string, number> = {
    ROCKY: 0.0365,
    COAL: 0.0487,
    AMETHYST: 0.0608,
    SAPPHIRE: 0.0973,
    RUBY: 0.3042,
  };
  for (const entry of RARITY_TABLE) {
    // A "month" is 30 days, so a year is 365/30 of them - hence the tolerance.
    const perYear = coinsPerMonthToUsdPerYear(entry.coinsPerMonth);
    assert.ok(
      nearlyEqual(perYear, expected[entry.rarity], 1e-3),
      `${entry.rarity}: expected ~$${expected[entry.rarity]}/yr, got $${perYear.toFixed(4)}`,
    );
  }
});

test('a rocky parcel matches TerraMine, and the ruby is still the jackpot', () => {
  const rocky = coinsPerMonthToUsdPerSecond(3);
  const ruby = coinsPerMonthToUsdPerSecond(25);
  // Rocky = TerraMine Rock = Atlas Common, to within a tenth.
  assert.ok(Math.abs(rocky / ATLAS.common - 1) < 0.1, `rocky is ${(rocky / ATLAS.common).toFixed(2)}x Atlas Common`);
  // Ruby about twice their best tier: finding one should change an account.
  assert.ok(ruby > ATLAS.legendary * 2, 'RUBY should beat Atlas Legendary twice over');
});

/** How many parcels someone earning `wpPerDay` holds after `days`, buying as soon as they can. */
function parcelsAfter(days: number, wpPerDay: number): number {
  let wp = SIGNUP_BONUS_WP, owned = 0;
  const spend = () => { while (wp >= parcelPriceWp(owned)) { wp -= parcelPriceWp(owned); owned++; } };
  spend();
  for (let d = 0; d < days; d++) {
    wp += wpPerDay;
    spend();
  }
  return owned;
}

test('a hard-walking player gains land in a straight line - and what that costs', () => {
  // 10,000 steps a day = 100 WP a day, every day, and nothing else. With the
  // flat price, two parcels a day for ever.
  const costAt = (years: number) => parcelsAfter(365 * years, 100) * coinsPerMonthToUsdPerYear(averageCoinsPerMonth);
  const y1 = parcelsAfter(365, 100);
  assert.ok(y1 >= 700 && y1 <= 760, `year one: ${y1} parcels`);
  const addedY2 = costAt(2) - costAt(1);
  const addedY3 = costAt(3) - costAt(2);
  assert.ok(Math.abs(addedY3 - addedY2) < 0.5, 'a flat price adds the same liability every year');
  // Unboosted land per year, pinned so a silent rate change shows up here.
  // It is REAL money only if cash redemption is switched on - see below.
  assert.ok(costAt(1) > 25 && costAt(1) < 45, `year one costs $${costAt(1).toFixed(2)}/yr`);
});

test('CASH REDEMPTION CANNOT BE SWITCHED ON WITHOUT A REVIEW', () => {
  // The guard that turns a slow disaster into a red build.
  //
  // Option A (2026-09-26): TerraMine-level rates, a flat price and a
  // TerraMine boost, with cash-out OFF. The economy report shows a regular
  // walker's land costing more than their ads earn once coins are cash, so
  // payouts must not be switched on as things stand.
  //
  // IF YOU ARE HERE BECAUSE THIS TEST FAILED: you set CASH_REDEMPTION_ENABLED
  // to true. The owner's plan is option B - pay a fixed share of real ad
  // revenue each month, split by coins earned, so payouts can never exceed
  // what came in - or option C, lower rates. Build one, then rewrite this.
  assert.equal(CASH_REDEMPTION_ENABLED, false, 'read the comment above before switching payouts on');
});

test('a new player gets their first land fast', () => {
  // The welcome bonus is a parcel on day one, and a 5,000-step day earns
  // several more in the first week.
  assert.equal(parcelsAfter(0, 50), 1);
  assert.ok(parcelsAfter(7, 50) >= 5, `only ${parcelsAfter(7, 50)} parcels in week one`);
});

test('the dollar display can always show a single coin', () => {
  // At too few decimals a player reads $0.00 and assumes the app is broken.
  assert.notEqual(Number(formatCoinsAsUsd(1)), 0, 'one coin must be visible');
  assert.equal(formatCoinsAsUsd(1), '0.001');
  assert.equal(formatCoinsAsUsd(0), '0.000');
  assert.equal(formatCoinsAsUsd(500), '0.500');
  assert.equal(formatCoinsAsUsd(1_000), '1.000');
  const smallestVisible = Number('1e-' + USD_DISPLAY_DECIMALS);
  assert.ok(COIN_REDEMPTION_USD >= smallestVisible, `a coin ($${COIN_REDEMPTION_USD}) is smaller than the display can show`);
});

test('the payout threshold gates redemption', () => {
  assert.equal(canRedeem(MIN_REDEMPTION_COINS - 1), false);
  assert.equal(canRedeem(MIN_REDEMPTION_COINS), true);
});

test('coins trade into Walk Points at TerraMine\'s price for land', () => {
  // A parcel is $0.50 of earnings, exactly TerraMine's 100 TB at 200 TB/$.
  assert.equal(COINS_PER_WALK_POINT, 10);
  assert.ok(nearlyEqual(coinsToUsd(parcelPriceWp(0) * COINS_PER_WALK_POINT), 0.5, 1e-9));
  // And the land it buys pays back slowly - reinvesting is fun, not a money
  // machine. Payback in years, unboosted:
  const payback = coinsToUsd(parcelPriceWp(0) * COINS_PER_WALK_POINT) / coinsPerMonthToUsdPerYear(averageCoinsPerMonth);
  assert.ok(payback > 5, `a traded-for parcel pays for itself in ${payback.toFixed(1)} years`);
  assert.ok(MAX_WALK_POINTS_PER_TRADE >= parcelPriceWp(0), 'one trade must at least buy a parcel');
});

test('the daily chest climbs to a big day 7, then repeats', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(dailyChestWp), [3, 4, 5, 6, 8, 10, 20]);
  assert.equal(dailyChestWp(8), 3, 'week two starts again');
  assert.equal(dailyChestWp(14), 20);
  assert.equal(dailyChestWp(0), 3, 'never below day one');
});

test('daily rewards stay modest next to walking', () => {
  // Chest (at its best) + every quest, both doubled by ads.
  const best = (dailyChestWp(7) + DAILY_QUESTS.reduce((s, q) => s + q.rewardWp, 0)) * 2;
  assert.ok(best <= 100, `a perfect day pays ${best} WP - more than a 10,000-step walk`);
  const keys = new Set(DAILY_QUESTS.map((q) => q.key));
  assert.equal(keys.size, DAILY_QUESTS.length, 'quest keys must be unique');
  for (const q of DAILY_QUESTS) assert.match(q.key, /^[a-z0-9_]{1,32}$/);
});

test('EVERY way to earn together still funds itself', () => {
  // The number that matters once chests, quests, check-ins, bonus-WP ads and
  // referrals all exist. A player squeezing every source earns ~200 WP a day:
  //   80 steps (8,000) + ~16 chest + ~50 quests + ~20 check-in + 30 ad WP
  const perDay =
    80 +
    dailyChestWp(7) +
    DAILY_QUESTS.reduce((sum, q) => sum + q.rewardWp, 0) * 2 +
    (CHECKIN_WP + CHECKIN_NEW_PLACE_BONUS_WP) * 2 +
    AD_WALK_POINTS * MAX_WP_ADS_PER_DAY;
  // Moves with the bonus-WP ad cap: 6/day -> 20 -> 10 -> 20 again.
  assert.ok(perDay >= 250 && perDay <= 300, `a maxed-out day is ${perDay} WP`);

  const costAt = (years: number) => parcelsAfter(365 * years, perDay) * coinsPerMonthToUsdPerYear(averageCoinsPerMonth);

  // OPTION A, stated honestly (2026-09-26). This player's UNBOOSTED land is
  // ~$90/yr in year one, rising in a straight line - more than any realistic
  // ad revenue. It costs nothing while cash redemption is off, which is the
  // whole of why option A is allowed; the guard above keeps it that way.
  assert.equal(CASH_REDEMPTION_ENABLED, false);
  assert.ok(costAt(1) > 60 && costAt(1) < 120, `year one costs $${costAt(1).toFixed(2)}/yr - did a rate move?`);
});

test('an invite costs far less than a player is worth, and cannot be farmed', () => {
  // The friend must walk REFERRAL_STEPS_TO_QUALIFY before anyone is paid.
  assert.ok(REFERRAL_STEPS_TO_QUALIFY >= 2_000, 'qualifying must take a real walk');
  assert.ok(REFERRAL_REWARD_REFERRER_WP <= 300 && REFERRAL_REWARD_REFEREE_WP <= 150);
  // What the pair of rewards costs us, in land, is pennies.
  const wp = REFERRAL_REWARD_REFEREE_WP + REFERRAL_REWARD_REFERRER_WP;
  let spent = 0, owned = 0;
  while (spent + parcelPriceWp(owned) <= wp) { spent += parcelPriceWp(owned); owned++; }
  const cost = owned * coinsPerMonthToUsdPerYear(averageCoinsPerMonth);
  // Six parcels at TerraMine-level rates is ~$0.28/yr - still far less than
  // an active invited player earns us in ads.
  assert.ok(cost < 0.5, `an invite costs $${cost.toFixed(3)}/yr of land`);
  assert.ok(REFERRAL_MAX_REWARDED * REFERRAL_REWARD_REFERRER_WP <= 6_000, 'lifetime invite WP must stay bounded');
});

// ---------------------------------------------------------------------------
//  Pit stops
// ---------------------------------------------------------------------------

test('a pit stop pays more on a neighbour plot than on your own', () => {
  // The whole point of the feature: walking to a neighbour's plot is the
  // behaviour worth paying for. Standing in your own garden is not.
  assert.ok(
    PIT_STOP_WP_NEIGHBOUR > PIT_STOP_WP_OWN,
    'a neighbour must beat your own land, or there is no reason to walk',
  );
  // But your own land must still pay SOMETHING, or a player with no
  // neighbours yet cannot use the feature at all - which is most players
  // while the map is thin.
  assert.ok(PIT_STOP_WP_OWN > 0, 'your own land must not pay nothing');

  assert.equal(pitStopWp(true, false), PIT_STOP_WP_OWN);
  assert.equal(pitStopWp(false, false), PIT_STOP_WP_NEIGHBOUR);
  assert.equal(pitStopWp(false, true), PIT_STOP_WP_NEIGHBOUR + PIT_STOP_NEW_BONUS_WP);
});

test('pit stop cooldowns make farming slower than walking', () => {
  // The 24-hour rule is what stops two players standing on each other's land
  // and milking the pair forever.
  assert.ok(PIT_STOP_PROPERTY_COOLDOWN_HOURS >= 24, 'a parcel must not pay twice in a day');

  // The 5-minute clock has to sit in a narrow band: long enough that a street
  // of parcels is worth several ads, short enough that waiting stays a real
  // choice so the ad never feels compulsory.
  assert.ok(PIT_STOP_COOLDOWN_SECONDS >= 120 && PIT_STOP_COOLDOWN_SECONDS <= 600);

  // The ceiling if someone waits out the clock all day and every parcel is a
  // neighbour's first-time plot. It must stay under what a day of walking
  // pays, or pit stops become the game instead of a reason to leave the house.
  const perDayCeiling =
    (86_400 / PIT_STOP_COOLDOWN_SECONDS) * (PIT_STOP_WP_NEIGHBOUR + PIT_STOP_NEW_BONUS_WP);
  assert.ok(perDayCeiling < 3_000, `pit stops could pay ${perDayCeiling} WP/day`);
});

// ---------------------------------------------------------------------------
//  The player's side
//
//  Every other solvency test here asks "can we afford this player?". These
//  two ask the opposite question, which is just as capable of killing the
//  game: is it worth the player's time? A rate change that quietly pushes the
//  first payout past a year is a retention bug, and nothing else would catch
//  it.
// ---------------------------------------------------------------------------

/** Days until `wpPerDay` of walking banks enough coins to reach the threshold. */
function daysToThreshold(wpPerDay: number): number {
  let wp = SIGNUP_BONUS_WP;
  let owned = 0;
  let coins = 0;
  const spend = () => {
    while (wp >= parcelPriceWp(owned)) {
      wp -= parcelPriceWp(owned);
      owned++;
    }
  };
  spend();
  for (let d = 1; d <= 365 * 10; d++) {
    wp += wpPerDay;
    spend();
    coins += (owned * averageCoinsPerMonth) / 30;
    if (coins >= MIN_REDEMPTION_COINS) return d;
  }
  return Infinity;
}

test('a regular player can reach the $5 cash-out inside a year', () => {
  // 8,000 steps a day plus the chest and quests, WITHOUT a single boost ad.
  const days = daysToThreshold(80);
  assert.ok(days <= 365, `a regular player waits ${Math.round(days / 30.4)} months to cash out`);
});

test('even a casual player gets there eventually', () => {
  // 3,000 steps and the daily chest. If THIS one runs past about 18 months
  // the bottom of the funnel has nothing to hope for and will not stay.
  const days = daysToThreshold(30);
  assert.ok(days <= 450, `a casual player waits ${Math.round(days / 30.4)} months to cash out`);
});

test('a day of ads is worth staying boosted for, and every ad still earns its keep', () => {
  // A full day of boost ads reaches a whole day at 20x for an ordinary player.
  const boostedHours = Math.min((MAX_BOOST_ADS_PER_DAY * BOOST_SECONDS_PER_AD) / 3600, 24);
  assert.equal(boostedHours, 24);

  // What ONE ad hands out, in dollars, against what one ad earns us at the
  // pessimistic $0.008. With the taper it stays within ~4x of that at any
  // size - a flat 20x would hand out $0.10+ an ad at 2,000 parcels.
  const perAdUsd = (parcels: number) =>
    parcels * coinsPerMonthToUsdPerSecond(averageCoinsPerMonth) * BOOST_SECONDS_PER_AD * (boostMultiplierFor(parcels) - 1);
  for (const n of [50, 200, 400, 1_000, 3_000]) {
    assert.ok(perAdUsd(n) <= 0.035, `an ad at ${n} parcels hands out $${perAdUsd(n).toFixed(4)}`);
  }
  assert.ok(MAX_BOOST_ADS_PER_DAY >= 10, 'a full day of boost must cost a real number of ads');
});

// The coin-store price test lived here and went with the store on
// 2026-09-24. What it protected is worth keeping in view: the price had to
// be set against the BOOSTED yield, not the base one, or converting pays for
// itself in under four years and profits for ever after. The full reasoning
// is in rules.ts where STORE used to be.
//
// COINS NOW BUY NOTHING AT ALL, which is the exact complaint the store was
// built to answer. That gap is deliberate, not forgotten.

/* ------------------------------------------------------------------------ *
 *  STEP INTEGRITY
 * ------------------------------------------------------------------------ */

test('the pace ceiling falls off with duration, so a sprint pace cannot be held all day', () => {
  // A minute of sprinting is fine.
  assert.equal(sustainablePace(1), MAX_STEPS_PER_MINUTE);

  // It must be monotonically non-increasing. A curve that went back up
  // somewhere would hand a farmer a window to aim at.
  let previous = Infinity;
  for (const minutes of [1, 5, 15, 30, 60, 120, 360, 720, 1_440, 5_000]) {
    const pace = sustainablePace(minutes);
    assert.ok(pace <= previous + 1e-9, `pace rose again at ${minutes} min`);
    previous = pace;
  }

  // The number that matters: a full day. A flat 250/min would wave through
  // 360,000 steps, roughly three back-to-back ultramarathons.
  const dayCeiling = sustainablePace(1_440) * 1_440;
  assert.ok(dayCeiling < 150_000, `a day's ceiling is ${dayCeiling} steps - far too generous`);

  // ...but the 24-hour walking record is about 230 km, which is somewhere
  // near 300,000 steps for a short stride. The DAILY cap is what really
  // bounds this; the pace curve must not be so tight it clips a real athlete
  // inside the day cap.
  assert.ok(dayCeiling > MAX_STEPS_PER_DAY, 'the pace curve now bites before the daily cap, which it should not');
});

test('an honest walker trips no integrity flags', () => {
  // Six syncs of real walking: bursty counts, varying gaps. This is the test
  // that matters - a heuristic that fires on this is worse than no heuristic.
  const recent = [
    { steps: 420, minutes: 4 },
    { steps: 180, minutes: 3 },
    { steps: 900, minutes: 7 },
    { steps: 240, minutes: 5 },
    { steps: 610, minutes: 6 },
  ];
  assert.equal(stepPatternFlags({ recent, steps: 330, minutes: 4 }), 0);
});

test('identical batches three times running are flagged', () => {
  const recent = [
    { steps: 1_000, minutes: 5 },
    { steps: 1_000, minutes: 5 },
    { steps: 640, minutes: 4 },
  ];
  const flags = stepPatternFlags({ recent, steps: 1_000, minutes: 5 });
  assert.ok((flags & STEP_FLAG.IDENTICAL_BATCHES) !== 0, 'three identical batches went unflagged');

  // Two in a row is NOT enough - that happens on a steady walk with a
  // regular sync timer, and flagging it would flag half the players.
  const twice = stepPatternFlags({
    recent: [{ steps: 1_000, minutes: 5 }, { steps: 640, minutes: 4 }, { steps: 820, minutes: 6 }],
    steps: 1_000,
    minutes: 5,
  });
  assert.equal(twice & STEP_FLAG.IDENTICAL_BATCHES, 0, 'two identical batches should not be enough');
});

test('a metronomic cadence is flagged, a human one is not', () => {
  // Exactly 120 steps a minute, every time: a shaker or a pendulum.
  const robot = [
    { steps: 600, minutes: 5 },
    { steps: 360, minutes: 3 },
    { steps: 840, minutes: 7 },
    { steps: 480, minutes: 4 },
  ];
  const flags = stepPatternFlags({ recent: robot, steps: 720, minutes: 6 });
  assert.ok((flags & STEP_FLAG.ROBOTIC_CADENCE) !== 0, 'a perfectly constant pace went unflagged');

  // The same pace, walked by a person: 15-40% variation is normal.
  const human = [
    { steps: 600, minutes: 5 },
    { steps: 300, minutes: 3 },
    { steps: 980, minutes: 7 },
    { steps: 410, minutes: 4 },
  ];
  assert.equal(
    stepPatternFlags({ recent: human, steps: 810, minutes: 6 }) & STEP_FLAG.ROBOTIC_CADENCE,
    0,
    'ordinary variation in pace must not read as robotic',
  );
});

test('small batches are never flagged', () => {
  // Three identical 50-step syncs means nothing at all.
  const recent = [{ steps: 50, minutes: 2 }, { steps: 50, minutes: 2 }, { steps: 50, minutes: 2 }];
  assert.equal(stepPatternFlags({ recent, steps: 50, minutes: 2 }), 0);
});

test('every flag has a name, so a log line is readable', () => {
  const mask = STEP_FLAG.IDENTICAL_BATCHES | STEP_FLAG.MOCKED_LOCATION;
  const names = describeStepFlags(mask);
  assert.deepEqual(names.sort(), ['IDENTICAL_BATCHES', 'MOCKED_LOCATION']);

  // And the flags must not collide - a mask only works if every bit is unique.
  const bits = Object.values(STEP_FLAG);
  assert.equal(new Set(bits).size, bits.length, 'two step flags share a bit');
});

/* ------------------------------------------------------------------------ *
 *  ANTI-SPOOFING: LAYER 2 - did the ground move?
 * ------------------------------------------------------------------------ */

test('a shaken phone earns nothing the ground can account for', () => {
  // 2,000 steps, three metres covered. This is the whole attack.
  const v = stepDisplacementVerdict({ steps: 2_000, distanceM: 3 });
  assert.ok(v.corroborated <= 25, `${v.corroborated} steps credited to 3 m of walking`);
  assert.equal(v.uncorroborated, 2_000 - v.corroborated);
  assert.ok((v.flags & STEP_FLAG.NO_DISPLACEMENT) !== 0, 'shaking went unflagged');
});

test('an ordinary walk is fully corroborated, with room to spare', () => {
  // 1,000 steps over 750 m is a normal 0.75 m stride.
  const v = stepDisplacementVerdict({ steps: 1_000, distanceM: 750 });
  assert.equal(v.corroborated, 1_000, 'a normal walk must be fully credited');
  assert.equal(v.uncorroborated, 0);
  assert.equal(v.flags, 0);
});

test('BAD GPS MUST NOT COST AN HONEST WALKER ANYTHING', () => {
  // The case that decides whether this feature is shippable. A real walk
  // under tree cover or between tall buildings can have its distance badly
  // understated - here by 75%, which is worse than anything realistic.
  const v = stepDisplacementVerdict({ steps: 1_000, distanceM: 190 });
  assert.equal(v.corroborated, 1_000, 'a 75% GPS undercount still has to credit the whole walk');
  assert.equal(v.flags, 0, 'poor GPS is not evidence of anything');
});

test('no usable trace is "cannot tell", not "zero"', () => {
  // Indoors, or location permission off. Absence of evidence is not
  // evidence, so nothing is flagged - the daily cap is what bounds it.
  const v = stepDisplacementVerdict({ steps: 5_000, distanceM: null });
  assert.equal(v.corroborated, 0);
  assert.equal(v.uncorroborated, 5_000);
  assert.equal(v.flags, 0, 'having no trace must never be a flag on its own');
});

test('a treadmill is paid for, and is why the cap is not zero', () => {
  // An hour of brisk treadmill walking is about 6,000 steps with no
  // displacement at all. The allowance must cover it in full.
  assert.ok(
    UNCORROBORATED_STEPS_PER_DAY >= 6_000,
    `only ${UNCORROBORATED_STEPS_PER_DAY} uncorroborated steps a day - a treadmill hour would not be paid`,
  );
  // ...but not a whole farming day.
  assert.ok(
    UNCORROBORATED_STEPS_PER_DAY <= MAX_STEPS_PER_DAY / 2,
    'the allowance is so large that shaking is still worth doing',
  );
});

test('a short indoor stretch is not flagged', () => {
  // Below PATTERN_MIN_STEPS nothing means anything: walking to the kitchen
  // and back produces exactly this.
  const v = stepDisplacementVerdict({ steps: 80, distanceM: 2 });
  assert.equal(v.flags, 0);
});

/* ------------------------------------------------------------------------ *
 *  ANTI-SPOOFING: LAYER 3 - was the movement possible?
 * ------------------------------------------------------------------------ */

test('a teleport is impossible, a train is not', () => {
  // 40 km in 11 minutes: 60 m/s. Nothing a player does covers that.
  assert.equal(travelVerdict({ metres: 40_000, seconds: 660 }).impossible, true);

  // A fast train: 30 km in 20 minutes = 25 m/s. Legitimate, and a passenger
  // is not cheating - the steps they generate are handled elsewhere.
  assert.equal(travelVerdict({ metres: 30_000, seconds: 1_200 }).impossible, false);

  // A brisk walk.
  assert.equal(travelVerdict({ metres: 1_000, seconds: 720 }).impossible, false);
});

test('fixes too close together in time cannot imply a speed', () => {
  // GPS jitter alone can put 30 m between consecutive readings. A second
  // apart that reads as 108 km/h, which is why short gaps are not judged.
  assert.equal(travelVerdict({ metres: 30, seconds: 1 }).impossible, false);
  assert.equal(travelVerdict({ metres: 30, seconds: 1 }).speedMps, null);
});

/* ------------------------------------------------------------------------ *
 *  ANTI-SPOOFING: LAYER 5 - the response ladder
 * ------------------------------------------------------------------------ */

test('no single signal can move an account off CLEAR', () => {
  // The design rule: it takes a PATTERN. The worst single flag must not be
  // enough on its own, or one tunnel or one developer phone throttles a
  // real player.
  const worst = Math.max(...Object.values(FLAG_WEIGHT));
  assert.ok(worst < INTEGRITY_WATCH_SCORE, `one flag scores ${worst} and WATCH starts at ${INTEGRITY_WATCH_SCORE}`);
  for (const name of Object.keys(STEP_FLAG) as (keyof typeof STEP_FLAG)[]) {
    assert.equal(integrityTier(flagScore(STEP_FLAG[name])), 'CLEAR', `${name} alone moved the tier`);
  }
});

test('the ladder escalates in order and never bans', () => {
  assert.equal(integrityTier(0), 'CLEAR');
  assert.equal(integrityTier(INTEGRITY_WATCH_SCORE), 'WATCH');
  assert.equal(integrityTier(INTEGRITY_THROTTLE_SCORE), 'THROTTLED');
  assert.equal(integrityTier(INTEGRITY_REVIEW_SCORE), 'REVIEW');
  assert.equal(integrityTier(10_000), 'REVIEW', 'there is no tier above REVIEW - a human decides');

  // WATCH is silent: being watched must not cost a player anything, because
  // most accounts that reach it are honest.
  assert.equal(payoutMultiplier('WATCH'), 1, 'WATCH must not be a punishment');
});

test('a throttle pays a little, never nothing', () => {
  // Zero tells a farmer exactly which trick stopped working, and tells a
  // false positive that the game is broken. A quarter does neither.
  assert.ok(payoutMultiplier('THROTTLED') > 0, 'a throttle must never pay zero');
  assert.ok(payoutMultiplier('THROTTLED') < 0.5, 'a throttle has to actually bite');
  assert.equal(applyShare(20, payoutMultiplier('THROTTLED')), 5);
  // And a real reward never rounds away to nothing.
  assert.equal(applyShare(2, payoutMultiplier('THROTTLED')), 1);
  assert.equal(applyShare(0, payoutMultiplier('THROTTLED')), 0);
});

test('a persistent shaker reaches a throttle, an unlucky walker does not', () => {
  // Someone shaking all day: displacement plus robotic cadence, repeatedly.
  const shaker = flagScore(STEP_FLAG.NO_DISPLACEMENT | STEP_FLAG.ROBOTIC_CADENCE);
  assert.ok(shaker * 5 >= INTEGRITY_THROTTLE_SCORE, 'five flagged syncs should reach a throttle');

  // Someone with a flaky phone: over-limit and a writable source, all
  // fortnight. Must stay clear - neither says anything about behaviour.
  const unlucky = flagScore(STEP_FLAG.OVER_LIMIT | STEP_FLAG.WRITABLE_SOURCE);
  assert.ok(unlucky * 11 < INTEGRITY_WATCH_SCORE, 'a fortnight of clipped syncs must stay CLEAR');
});

test('A FAST TELEPORT IS STILL A TELEPORT', () => {
  // THE REGRESSION TEST for a bug found by trying it against the server: the
  // minimum-interval guard originally skipped EVERY gap under 20 seconds,
  // so the faster a teleport was, the less it was checked. Two claims 260 km
  // and two seconds apart went completely unnoticed.
  assert.equal(travelVerdict({ metres: 260_000, seconds: 2 }).impossible, true);
  assert.equal(travelVerdict({ metres: 260_000, seconds: 0 }).impossible, true);
  assert.equal(travelVerdict({ metres: 5_000, seconds: 3 }).impossible, true);

  // Small jumps over short intervals are still jitter, and still ignored.
  assert.equal(travelVerdict({ metres: 30, seconds: 1 }).impossible, false);
  assert.equal(travelVerdict({ metres: 150, seconds: 2 }).impossible, false);

  // And the boundary is above any real receiver error.
  assert.ok(JITTER_MAX_METRES >= 150, 'the jitter floor is tight enough to catch honest GPS error');
});

test('AN OFFLINE DAY IS NOT PUNISHED - the case that nearly shipped broken', () => {
  // Steps in this game mostly accumulate with the app CLOSED and arrive in
  // one catch-up batch from the health store. There is no GPS trace for that
  // window and there never could be.
  //
  // The first version capped those steps the same as a trace that said
  // "nothing moved", which halved the pay of the most ordinary way anyone
  // plays. The e2e suite caught it. The rule is now: a trace showing no
  // movement is evidence; no trace is not.
  const offline = stepDisplacementVerdict({ steps: 12_000, distanceM: null });
  assert.equal(offline.uncorroborated, 12_000);
  assert.equal(offline.flags, 0, 'an untraced catch-up batch must raise no flag at all');

  // ...whereas a trace that watched and saw nothing IS evidence.
  const watched = stepDisplacementVerdict({ steps: 12_000, distanceM: 0 });
  assert.ok((watched.flags & STEP_FLAG.NO_DISPLACEMENT) !== 0, 'a zero-distance trace is evidence');
});

/* ------------------------------------------------------------------------ *
 *  ANTI-SPOOFING: LAYER 3b - is the track receiver-shaped, or drawn?
 * ------------------------------------------------------------------------ */

test('a drawn track is caught, a walked one is not', () => {
  // GENERATED: constant accuracy, constant altitude, ruler-straight.
  const drawn = traceAuthenticityFlags({
    samples: 40,
    accuracySpreadM: 0,
    altitudeSpreadM: 0,
    straightness: 0.999,
    speedAgreement: 0.99,
  });
  assert.ok((drawn & STEP_FLAG.SYNTHETIC_TRACK) !== 0, 'a perfect track went unflagged');

  // WALKED: accuracy wanders, altitude drifts, the path wobbles.
  const walked = traceAuthenticityFlags({
    samples: 40,
    accuracySpreadM: 9.4,
    altitudeSpreadM: 6.2,
    straightness: 0.83,
    speedAgreement: 0.91,
  });
  assert.equal(walked, 0, 'an ordinary walk must not read as synthetic');
});

test('ONE tell is never enough - the false-positive guard', () => {
  // A genuinely straight walk: a seafront, a towpath, a long bridge. Real
  // receiver noise everywhere else, so it must pass.
  const seafront = traceAuthenticityFlags({
    samples: 40,
    accuracySpreadM: 7.1,
    altitudeSpreadM: 4.0,
    straightness: 0.995,
    speedAgreement: 0.88,
  });
  assert.equal(seafront, 0, 'a straight walk with real noise must not be flagged');

  // A phone holding a single satellite lock: accuracy pinned, everything
  // else normal.
  const poorLock = traceAuthenticityFlags({
    samples: 40,
    accuracySpreadM: 0,
    altitudeSpreadM: 5.5,
    straightness: 0.7,
    speedAgreement: 0.9,
  });
  assert.equal(poorLock, 0, 'a flat accuracy alone must not be flagged');
});

test('too few fixes means no verdict at all', () => {
  // Everything about this looks synthetic, but eight samples cannot support
  // a statistic - the app may have only just opened.
  assert.equal(
    traceAuthenticityFlags({
      samples: 8,
      accuracySpreadM: 0,
      altitudeSpreadM: 0,
      straightness: 1,
      speedAgreement: 0,
    }),
    0,
  );
});

test('a phone with no altitude or speed is judged on what it has', () => {
  // Some devices and some permission states report neither. Two remaining
  // tells must still be able to fire, and one must still not.
  const noExtras = traceAuthenticityFlags({
    samples: 40,
    accuracySpreadM: 0,
    altitudeSpreadM: null,
    straightness: 0.999,
    speedAgreement: null,
  });
  assert.ok((noExtras & STEP_FLAG.SYNTHETIC_TRACK) !== 0, 'two tells should still fire');

  const oneTell = traceAuthenticityFlags({
    samples: 40,
    accuracySpreadM: 0,
    altitudeSpreadM: null,
    straightness: 0.5,
    speedAgreement: null,
  });
  assert.equal(oneTell, 0);
});

test('a shared family phone is fine; a farm is not', () => {
  // The threshold has to sit where the story stops being plausible, not
  // where it stops being unusual. Households share tablets; phones get
  // handed down and resold.
  assert.ok(MAX_ACCOUNTS_PER_DEVICE >= 3, 'a family tablet must not be a signal');
  assert.ok(MAX_ACCOUNTS_PER_DEVICE <= 6, 'twenty accounts on one phone has to register');
});

test('every declared flag is actually used somewhere', () => {
  // A flag nobody sets is worse than no flag: it implies a check that does
  // not exist. NO_MOVEMENT was exactly that until it was removed, so this
  // test exists to stop the next one accumulating.
  const names = Object.keys(STEP_FLAG) as (keyof typeof STEP_FLAG)[];
  for (const n of names) {
    assert.ok(n in FLAG_WEIGHT, `${n} has no weight - is it wired up at all?`);
  }
  assert.equal(names.length, Object.keys(FLAG_WEIGHT).length, 'a flag and its weight went out of step');
});

test('no flag is allowed to fire on every single sync', () => {
  // UNATTESTED was set on 100% of traffic while the attestation verifiers
  // are stubs, which made `integrity_flags <> 0` meaningless and turned the
  // partial index over flagged rows into a full one. The e2e suite caught
  // it as "an honest walker trips nothing at all -> got 5 flagged rows".
  //
  // The rule: a flag must distinguish. This pins UNATTESTED at zero weight
  // so that if someone wires it up they have to weight it deliberately, and
  // face the question of whether it discriminates yet.
  assert.equal(
    FLAG_WEIGHT.UNATTESTED,
    0,
    'UNATTESTED now carries weight - is attestation real, and does the flag still fire on everything?',
  );
});

test('device sharing is counted over a window, not a lifetime', () => {
  // An all-time count makes a false positive MORE likely the longer somebody
  // stays - a phone handed down through a family legitimately accumulates
  // owners for years. Found because the e2e suite flagged its own honest
  // walker after 54 runs had shared one fixture device id.
  assert.ok(DEVICE_SHARING_WINDOW_DAYS > 0, 'the count must be windowed');
  assert.ok(DEVICE_SHARING_WINDOW_DAYS <= 90, 'too long a window is an all-time count in disguise');
});
