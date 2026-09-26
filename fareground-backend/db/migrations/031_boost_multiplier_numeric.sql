-- 031: boost multipliers can be fractional
--
-- The boost taper became BRACKETS (see BOOST_TIERS in rules.ts): the first
-- 400 parcels at 20x, the next 300 at 15x, and so on, averaged over the whole
-- holding - so a player with 450 parcels buys a 19.44x boost. The old steps
-- dropped everyone to a round 15x at parcel 401, which CUT their income for
-- buying land. An averaged multiplier is rarely a whole number, so the column
-- becomes NUMERIC. Existing whole-number boosts convert exactly.

ALTER TABLE boosts ALTER COLUMN multiplier TYPE NUMERIC(8,4);
