/**
 * Prints the whole economy: every way to earn, what it pays, and what a
 * player is worth to us over time.
 *
 *   npx tsx src/scripts/economy-report.ts
 *
 * Reads rules.ts, so it can never drift from the game. Run it after ANY
 * change to a rate - the projections at the bottom are the ones that decide
 * whether the game funds itself.
 */
import {
  AD_STREAK_REWARD_WP,
  BOOST_MAX_BANKED_SECONDS,
  AD_WALK_POINTS,
  BOOST_MULTIPLIER,
  BOOST_SECONDS_PER_AD,
  COIN_REDEMPTION_USD,
  CHECKIN_NEW_PLACE_BONUS_WP,
  CHECKIN_WP,
  DAILY_QUESTS,
  MAX_BOOST_ADS_PER_DAY,
  MAX_WP_ADS_PER_DAY,
  MIN_REDEMPTION_COINS,
  PARCEL_BASE_PRICE_WP,
  PARCEL_MAX_UPGRADE,
  PARCEL_PRICE_STEP_WP,
  PIT_STOP_COOLDOWN_SECONDS,
  PIT_STOP_NEW_BONUS_WP,
  PIT_STOP_WP_NEIGHBOUR,
  PIT_STOP_WP_OWN,
  RARITY_TABLE,
  REFERRAL_REWARD_REFEREE_WP,
  REFERRAL_REWARD_REFERRER_WP,
  SIGNUP_BONUS_WP,
  STEPS_PER_WALK_POINT,
  TREASURE_FREE_PER_DAY,
  TREASURE_MAX_WP,
  TREASURE_MIN_WP,
  boostMultiplierFor,
  coinsPerMonthToUsdPerYear,
  dailyChestWp,
  parcelPriceWp,
  parcelUpgradeCostWp,
} from '../game/rules';

const money = (n: number) => '$' + n.toFixed(n < 0.01 ? 5 : 2);
const line = (s = '') => console.log(s);
const rule = (c = '-') => line(c.repeat(72));

// ---------------------------------------------------------------- WP sources
line();
rule('=');
line('  WHERE WALK POINTS COME FROM');
rule('=');
line();
line(`  Walking            ${STEPS_PER_WALK_POINT} steps = 1 WP`);
line(`                     10,000 steps = ${10_000 / STEPS_PER_WALK_POINT} WP`);
line();
line(`  Daily chest        ${[1, 2, 3, 4, 5, 6, 7].map((d) => dailyChestWp(d)).join(' -> ')} WP on a 7-day streak`);
line(`  Daily quests       ${DAILY_QUESTS.map((q) => `${q.rewardWp}`).join(' + ')} = ${DAILY_QUESTS.reduce((s, q) => s + q.rewardWp, 0)} WP for all four`);
line(`  Ad-streak chest    ${AD_STREAK_REWARD_WP} WP`);
line(`  Bonus-WP ads       ${AD_WALK_POINTS} WP x ${MAX_WP_ADS_PER_DAY}/day = ${AD_WALK_POINTS * MAX_WP_ADS_PER_DAY} WP`);
line(`  Treasure boxes     ${TREASURE_MIN_WP}-${TREASURE_MAX_WP} WP, ${TREASURE_FREE_PER_DAY} free/day then one ad each`);
line(`  Place visits       ${CHECKIN_WP} WP, +${CHECKIN_NEW_PLACE_BONUS_WP} somewhere new`);
line(`  Pit stops          ${PIT_STOP_WP_OWN} WP your land / ${PIT_STOP_WP_NEIGHBOUR} WP a neighbour's, +${PIT_STOP_NEW_BONUS_WP} first time`);
line(`                     one every ${PIT_STOP_COOLDOWN_SECONDS / 60} min, or an ad to skip the wait`);
line(`  Invite a friend    ${REFERRAL_REWARD_REFERRER_WP} WP you / ${REFERRAL_REWARD_REFEREE_WP} WP them`);
line(`  Signing up         ${SIGNUP_BONUS_WP} WP (exactly one parcel)`);
line();
line('  Almost all of the above can be DOUBLED by watching an ad.');

// ---------------------------------------------------------------- what WP buys
line();
rule('=');
line('  WHAT WALK POINTS BUY');
rule('=');
line();
line(
  PARCEL_PRICE_STEP_WP === 0
    ? `  Parcel price:  ${PARCEL_BASE_PRICE_WP} WP, flat - every parcel costs the same`
    : `  Parcel price:  ${PARCEL_BASE_PRICE_WP} WP + ${PARCEL_PRICE_STEP_WP} WP for every parcel you already own`,
);
line();
line('     parcel #      cost        steps to earn it by walking alone');
for (const n of [1, 5, 10, 25, 50, 100, 200]) {
  const p = parcelPriceWp(n - 1);
  line(`     ${String(n).padStart(6)}   ${String(p).padStart(6)} WP   ${(p * STEPS_PER_WALK_POINT).toLocaleString().padStart(10)}`);
}
line();
const upgradeTotal = Array.from({ length: PARCEL_MAX_UPGRADE }, (_, i) => parcelUpgradeCostWp(i)).reduce((a, b) => a + b, 0);
line(`  Upgrades:      ${Array.from({ length: PARCEL_MAX_UPGRADE }, (_, i) => parcelUpgradeCostWp(i)).join('/')} WP = ${upgradeTotal} WP + ${PARCEL_MAX_UPGRADE} ads`);
line(`                 for +${PARCEL_MAX_UPGRADE} coins/hour on one parcel`);

// ---------------------------------------------------------------- coins
line();
rule('=');
line('  WHAT LAND PAYS');
rule('=');
line();
line(`  ${(1 / COIN_REDEMPTION_USD).toLocaleString()} coins = $1.00      payout threshold ${MIN_REDEMPTION_COINS.toLocaleString()} coins (${money(MIN_REDEMPTION_COINS * COIN_REDEMPTION_USD)})`);
line();
line('     mineral      odds   coins/month   per day      per year');
let avg = 0;
for (const e of RARITY_TABLE) {
  const pct = e.weightBasisPoints / 100;
  avg += (e.weightBasisPoints / 10_000) * e.coinsPerMonth;
  line(
    `     ${e.rarity.padEnd(10)} ${String(pct).padStart(4)}%   ${String(e.coinsPerMonth).padStart(6)}   ` +
      `${(e.coinsPerMonth / 30).toFixed(2).padStart(7)} coins   ${money(coinsPerMonthToUsdPerYear(e.coinsPerMonth)).padStart(9)}`,
  );
}
line();
line(`     AVERAGE parcel:  ${avg.toFixed(2)} coins/month  =  ${money(coinsPerMonthToUsdPerYear(avg))} per year`);
line();
line(`  A boost pays ${BOOST_MULTIPLIER}x for ${BOOST_SECONDS_PER_AD / 60} min per ad, banking to `
     + `${BOOST_MAX_BANKED_SECONDS / 3600}h (up to ${MAX_BOOST_ADS_PER_DAY} ads/day), tapering above 400 parcels.`);

// ---------------------------------------------------------------- projections
function parcelsAfter(days: number, wpPerDay: number): number {
  let wp = SIGNUP_BONUS_WP;
  let owned = 0;
  const spend = () => {
    while (wp >= parcelPriceWp(owned)) {
      wp -= parcelPriceWp(owned);
      owned++;
    }
  };
  spend();
  for (let d = 0; d < days; d++) {
    wp += wpPerDay;
    spend();
  }
  return owned;
}

const perParcelYear = coinsPerMonthToUsdPerYear(avg);

/**
 * What a full day of boost ads is worth, averaged over 24 hours.
 *
 * Declared HERE rather than beside the player table, because the business
 * section below needs it too - a boosted player is the expensive case.
 */
const boostedFraction = Math.min(
  (MAX_BOOST_ADS_PER_DAY * BOOST_SECONDS_PER_AD) / 86_400,
  BOOST_MAX_BANKED_SECONDS / 86_400,
);
const boostMultiplier = 1 + boostedFraction * (BOOST_MULTIPLIER - 1);

const PROFILES: { name: string; wp: number; note: string }[] = [
  { name: 'Casual', wp: 30, note: '3,000 steps, collects the chest' },
  { name: 'Regular', wp: 80, note: '8,000 steps, chest + quests' },
  { name: 'Keen', wp: 130, note: '10,000 steps, everything but the ads' },
  {
    name: 'Maxed',
    wp:
      80 +
      dailyChestWp(7) +
      DAILY_QUESTS.reduce((s, q) => s + q.rewardWp, 0) * 2 +
      (CHECKIN_WP + CHECKIN_NEW_PLACE_BONUS_WP) * 2 +
      AD_WALK_POINTS * MAX_WP_ADS_PER_DAY,
    note: 'squeezes every single source, every day',
  },
];

line();
rule('=');
line('  PROJECTIONS - what a player ends up holding, and what it costs us');
rule('=');
for (const p of PROFILES) {
  line();
  line(`  ${p.name}  (${p.wp} WP/day - ${p.note})`);
  line('        after      parcels    their income/yr     their total so far');
  let cumulative = 0;
  for (const years of [1, 2, 3, 5]) {
    const parcels = parcelsAfter(365 * years, p.wp);
    const perYear = parcels * perParcelYear;
    cumulative += perYear; // rough: assumes this year's holding for this year
    line(
      `     ${String(years + ' year' + (years > 1 ? 's' : '')).padEnd(9)} ${String(parcels).padStart(7)}    ` +
        `${money(perYear).padStart(10)}          ${money(cumulative).padStart(9)}`,
    );
  }
}

// -------------------------------------------------- the player's side of it
line();
rule('=');
line('  THE PLAYER SIDE - how long until any of this is worth something');
rule('=');
line();
line('  Coins accumulate from the day a parcel is claimed, so the wait is not');
line('  linear: early parcels are earning while later ones are still being');
line('  bought. This walks it day by day.');
line();
line('     player      first $0.25    first $0.50    first $1.00');

for (const p of PROFILES) {
  let wp = SIGNUP_BONUS_WP;
  let owned = 0;
  let coins = 0;
  const marks: Record<string, string> = { '0.25': 'never', '0.5': 'never', '1': 'never' };
  const spend = () => {
    while (wp >= parcelPriceWp(owned)) {
      wp -= parcelPriceWp(owned);
      owned++;
    }
  };
  spend();
  for (let d = 1; d <= 365 * 6; d++) {
    wp += p.wp;
    spend();
    coins += (owned * avg) / 30; // a day of income at today's holding
    const usd = coins * COIN_REDEMPTION_USD;
    for (const target of ['0.25', '0.5', '1']) {
      if (marks[target] === 'never' && usd >= Number(target)) {
        marks[target] = d < 365 ? `${Math.round(d / 30.4)} mo` : `${(d / 365).toFixed(1)} yr`;
      }
    }
  }
  line(
    `     ${p.name.padEnd(11)} ${marks['0.25'].padStart(9)}      ${marks['0.5'].padStart(9)}      ${marks['1'].padStart(9)}`,
  );
}
line();
line(`  The payout threshold is ${money(MIN_REDEMPTION_COINS * COIN_REDEMPTION_USD)}, so the last column is the real`);
line('  "when can I actually cash out" answer.');

line();
rule('=');
line('  THE BUSINESS - what an engaged player is worth, against what they cost');
rule('=');
line();
line('  A rewarded ad pays roughly $0.008-0.025 per view. The spread is almost');
line('  entirely GEOGRAPHY: a UK or US viewer is worth several times a viewer');
line('  in a low-income country. These three cases bracket it.');
line();

const AD_CASES: { name: string; adsPerDay: number; perAd: number }[] = [
  { name: 'Pessimistic', adsPerDay: 3, perAd: 0.008 },
  { name: 'Middling', adsPerDay: 6, perAd: 0.015 },
  { name: 'Good (UK/US)', adsPerDay: 10, perAd: 0.025 },
];

const maxed = PROFILES[PROFILES.length - 1];
const landY1 = parcelsAfter(365, maxed.wp) * perParcelYear;
const landY3 = parcelsAfter(365 * 3, maxed.wp) * perParcelYear;

/**
 * A player's land COSTS MORE THE MORE ADS THEY WATCH, because boost ads are
 * most of what they watch. Charging every case the base rate flattered the
 * middle and good columns badly.
 */
function boostedCostFor(adsPerDay: number): number {
  const boostAds = Math.min(adsPerDay, MAX_BOOST_ADS_PER_DAY);
  const hours = Math.min((boostAds * BOOST_SECONDS_PER_AD) / 3600, BOOST_MAX_BANKED_SECONDS / 3600);
  // The multiplier this player's land actually gets, after the taper.
  const m = boostMultiplierFor(parcelsAfter(365 * 3, maxed.wp));
  const dayMultiplier = (hours * m + (24 - hours)) / 24;
  return landY3 * dayMultiplier;
}

line('     case            ads/day   $/ad     revenue/yr   land cost/yr   margin');
for (const c of AD_CASES) {
  const rev = c.adsPerDay * 365 * c.perAd;
  const cost = boostedCostFor(c.adsPerDay);
  line(
    `     ${c.name.padEnd(14)} ${String(c.adsPerDay).padStart(5)}   ${c.perAd.toFixed(3)}   ` +
      `${money(rev).padStart(9)}    ${money(cost).padStart(9)}     ${(rev / cost).toFixed(1)}x`,
  );
}
line();
line('  Land cost RISES with ads watched, because boost ads are most of what');
line('  a player watches. Charging every column the unboosted rate flattered');
line('  the middle and right badly.');
line();
line(`  Land cost is the WORST case: a maxed player, three years in (${money(landY3)}/yr).`);
line(`  In year one the same player costs ${money(landY1)}.`);
line();
line('  ONE THING THAT TABLE GLOSSES OVER: a player who boosts all day costs');
line(`  ${boostMultiplier.toFixed(2)}x that (${money(landY3 * boostMultiplier)}/yr) - but to do it they must watch ${MAX_BOOST_ADS_PER_DAY} ads,`);
line(`  which at the worst price is ${money(MAX_BOOST_ADS_PER_DAY * 365 * 0.008)}/yr against ${money(landY3 * boostMultiplier)} of land:`);
line(`  ${((MAX_BOOST_ADS_PER_DAY * 365 * 0.008) / (landY3 * boostMultiplier)).toFixed(1)}x.`);
line();
line('  THE BIG CAVEAT, and it is the whole business:');
line('  land only costs anything IF REDEMPTION IS SWITCHED ON. Nothing writes a');
line('  PAYOUT ledger row today. Ship without cash redemption and the land');
line('  column above is zero - every figure is margin.');

line();
rule();
line('  AT SCALE - yearly, after paying for land, before tax');
rule();
line();
line('  Hosting is a small server + managed Postgres. It barely moves with');
line('  players at this size; bandwidth is tiny because the map tiles come');
line('  from OpenFreeMap, not from us.');
line();
line('     daily players    hosting/yr    pessimistic      middling         good');
for (const dau of [100, 1_000, 10_000, 100_000]) {
  const hosting = dau <= 1_000 ? 300 : dau <= 10_000 ? 1_800 : 12_000;
  const cells = AD_CASES.map((c) => {
    const rev = c.adsPerDay * 365 * c.perAd;
    return money(dau * (rev - boostedCostFor(c.adsPerDay)) - hosting).padStart(13);
  });
  line(`     ${String(dau.toLocaleString()).padStart(12)}  ${money(hosting).padStart(10)}   ${cells.join('  ')}`);
}
line();
line('  Those subtract the full land liability, boost included. Without cash');
line('  redemption every one of those costs is zero, so add back between');
line(`  ${money(boostedCostFor(3))} and ${money(boostedCostFor(12))} per player.`);

line();
rule();
line('  WHAT A PLAYER ACTUALLY EARNS - be honest about this');
rule();
line();
line('                        BASE ONLY (never watches an ad)        FULLY BOOSTED');
line('     player          1 yr     3 yrs     5 yrs        1 yr     3 yrs     5 yrs');
for (const p of PROFILES) {
  let total = 0;
  const base: string[] = [];
  const boosted: string[] = [];
  for (let y = 1; y <= 5; y++) {
    total += parcelsAfter(365 * y, p.wp) * perParcelYear;
    if (y === 1 || y === 3 || y === 5) {
      base.push(money(total).padStart(8));
      boosted.push(money(total * boostMultiplier).padStart(8));
    }
  }
  line(`     ${p.name.padEnd(12)} ${base.join('  ')}    ${boosted.join('  ')}`);
}
line();
line(`  Boosting all day multiplies earnings by ${boostMultiplier.toFixed(2)}x, and costs`);
line(`  ${MAX_BOOST_ADS_PER_DAY} ads a day - which is exactly how we get paid. The player who`);
line('  earns most is the player who pays us most. That alignment is the whole');
line('  design; without it the base rate has to carry the game alone.');
line();
rule();
line('  IS IT WORTH IT? - the test that actually matters');
rule();
line();
line('  Money per YEAR is the wrong question, because the walking is free: a');
line('  player was going to do those steps anyway. The real cost to them is');
line('  the ADS - about 30 seconds each - so the honest measure is what an');
line('  hour of ad-watching returns.');
line();

const AD_SECONDS = 30;
const adHoursPerYear = (MAX_BOOST_ADS_PER_DAY * AD_SECONDS * 365) / 3600;

line('     player        parcels @3yr   $/yr boosted   ad-hours/yr   $ per ad-hour');
for (const p of PROFILES) {
  const parcels = parcelsAfter(365 * 3, p.wp);
  const perYear = parcels * perParcelYear * boostMultiplier;
  line(
    `     ${p.name.padEnd(12)} ${String(parcels).padStart(9)}   ${money(perYear).padStart(12)}   ` +
      `${adHoursPerYear.toFixed(1).padStart(10)}   ${money(perYear / adHoursPerYear).padStart(12)}`,
  );
}
line();
line('  For comparison, a published Atlas Earth account: one reviewer earned');
line('  $0.094 after roughly 30 hours of playing, games and ads - about');
line(`  $0.003 an hour. A Regular player here returns ${money((parcelsAfter(365 * 3, 80) * perParcelYear * boostMultiplier) / adHoursPerYear)} an hour of ads.`);
line();
line('  THE HONEST CONCLUSION: the cash is small and always will be. Ad');
line('  revenue is $9-91 per player per year, so paying a player tens of');
line('  pounds a year is arithmetically impossible - a rate that paid $60/yr');
line('  would cost more than most players ever earn us.');
line();
line('  What makes it worth playing cannot therefore be the money. It has to');
line('  be the game: claiming ground, finding a ruby, the streak, the local');
line('  leaderboard. The cash is a bonus that proves the land is real.');
line();
line('  >> THE BIGGEST GAP LEFT IS NOT THE RATE, IT IS THAT COINS DO NOTHING.');
line('     A coin today can only sit in a balance waiting for a payout that is');
line('     not implemented. Letting coins BUY things - upgrades, cosmetics,');
line('     boosts - would make them worth something the moment they are earned,');
line('     and costs us nothing because those sinks are free to hand out.');
line('     That is worth more to a player than any rate change here.');

line();
rule('=');
line('  PARCELS -> EARNINGS, AND WHAT A 20x BOOST WOULD MEAN');
rule('=');
line();
line('  Atlas Earth runs "Super Rent Boost" events - a big multiplier for a');
line('  short window, twice a month. A published account: two 32-hour SRBs a');
line('  month on 1,500 parcels adds about $30. That shape is worth copying;');
line('  a flat 20x is not, and the two columns show why.');
line();

const SRB_HOURS_PER_MONTH = 64;   // two 32-hour events, as Atlas runs them
const SRB_FRACTION = (SRB_HOURS_PER_MONTH * 12) / 8760;
const SRB_MULTIPLIER = 20;
// Only the boosted slice is multiplied; the rest of the year is normal.
const srbYearMultiplier = 1 + SRB_FRACTION * (SRB_MULTIPLIER - 1);

line('     parcels    normal/yr   2x boosted   20x EVENTS/yr   flat 20x/yr');
for (const n of [10, 50, 100, 250, 500, 1000, 1500]) {
  const base = n * perParcelYear;
  line(
    `     ${String(n).padStart(7)}   ${money(base).padStart(9)}   ${money(base * boostMultiplier).padStart(10)}   ` +
      `${money(base * boostMultiplier * srbYearMultiplier).padStart(13)}   ${money(base * SRB_MULTIPLIER).padStart(11)}`,
  );
}
line();
line(`  "20x EVENTS" = the 2x day boost PLUS ${SRB_HOURS_PER_MONTH}h a month at ${SRB_MULTIPLIER}x, which is`);
line(`  ${(SRB_FRACTION * 100).toFixed(1)}% of the year - so it multiplies the YEAR by ${srbYearMultiplier.toFixed(2)}x, not by 20.`);
line('  That is the trick: it feels enormous while it is running and stays');
line('  affordable, because it is rare.');
line();
line('  A FLAT 20x IS NOT AFFORDABLE. The last column against revenue:');
for (const c of AD_CASES) {
  const rev = c.adsPerDay * 365 * c.perAd;
  const cost = parcelsAfter(365 * 3, maxed.wp) * perParcelYear * SRB_MULTIPLIER;
  const verdict = rev > cost ? 'ok' : 'LOSS';
  line(
    `     ${c.name.padEnd(14)} revenue ${money(rev).padStart(8)}  vs  flat-20x land ${money(cost).padStart(8)}  ${verdict}`,
  );
}
line();
line('  Even at the GOOD ad rate a flat 20x barely clears, and at the');
line('  pessimistic rate it loses money on every player. Events, not a');
line('  permanent multiplier.');

line();
rule();
line('  AGAINST THE COMPARABLE GAMES (checked 2026-09-24)');
rule();
line();
line('     per parcel, per year');
line(`     Atlas Earth base       $0.0496`);
line(`     TerraMine average      $0.0415`);
line(`     TerraMine rock         $0.0342`);
// Four places here, not money()'s two: the whole point of this table is
// comparing against $0.0496 and $0.0415, and "$0.01" hides the comparison.
line(`     Fareground average     $${perParcelYear.toFixed(4)}  ($${(perParcelYear * boostMultiplier).toFixed(4)} boosted)`);
line();
line('  CORRECTION WORTH RECORDING: TerraMine mines are NOT bought with real');
line('  money. They are claimed for 100 TerraBucks earned by walking - the same');
line('  model as ours. That makes TerraMine the true peer and Atlas Earth the');
line('  distant one, because Atlas parcels ARE bought with cash.');
line();
line('     TerraMine                        Fareground');
line(
  PARCEL_PRICE_STEP_WP === 0
    ? `     claim cost   100 TB, FLAT        ${PARCEL_BASE_PRICE_WP} WP, FLAT`
    : `     claim cost   100 TB, FLAT        ${PARCEL_BASE_PRICE_WP} WP + ${PARCEL_PRICE_STEP_WP} per parcel owned, RISING`,
);
line(`     boost        up to 20x           ${BOOST_MULTIPLIER}x`);
line(`                  30 min per boost    ${BOOST_SECONDS_PER_AD / 60} min per ad`);
line(`                  8h max banked       ${BOOST_MAX_BANKED_SECONDS / 3600}h max banked`);
line(`                  = 7.3x over a day   = ${boostMultiplier.toFixed(2)}x over a day`);
line('     rare tier    Diamond ~1%, 4x     Ruby 1%, 100x');
line('     visits       check in on other   pit stops on other players land');
line('                  players mines       ');
line('     cash out     PayPal, fees 0-38%  not implemented');
line();
line('  TWO REAL DIFFERENCES, and they pull opposite ways:');
line();
line('  1. THEIR CLAIM PRICE IS FLAT, ours rises. Flat means land grows in a');
line('     straight line with walking; ours grows like the square root. They');
line('     can therefore reach 1,400 mines where we reach a few hundred. That');
line('     is the single biggest reason their headline totals look bigger.');
line('     Our rising price is what keeps us solvent without purchase revenue,');
line('     so it stays - but it IS the trade being made.');
line();
line('  2. OUR RARE TIER IS FAR RARER-FEELING. Their Diamond pays 4x a Rock;');
line('     our Ruby pays 100x a Rocky. Finding one actually changes your');
line('     account. That is ours to keep.');
line();
