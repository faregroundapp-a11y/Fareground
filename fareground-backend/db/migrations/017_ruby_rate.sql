-- ---------------------------------------------------------------------------
--  017 - RUBY pays 100 coins/hour (was 40).
--
--  Part of the 2026-09-23 rebalance. The coin was cut from $0.000001 to
--  $0.0000004, which by itself would have taken 60% off EVERY tier - including
--  the one-in-a-hundred find that is the whole reason to keep claiming.
--
--  So the cut was aimed at the average instead of the top: ROCKY, COAL,
--  AMETHYST and SAPPHIRE keep their coin rates and therefore lose 60% of their
--  dollar value, while RUBY goes 40 -> 100 coins/hour and comes out at exactly
--  the $0.35/year it was worth before. The ladder widens from 40x to 100x.
--
--  Existing ruby parcels are upgraded rather than left behind: they were
--  earned under a promise of "the best tier in the game", and the best tier
--  now pays 100.
-- ---------------------------------------------------------------------------

BEGIN;

-- Both constraints pin the old rate, so they have to come off first.
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_coins_per_hour_check;
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_rarity_matches_rate;

UPDATE parcels SET coins_per_hour = 100 WHERE rarity = 'RUBY' AND coins_per_hour <> 100;

ALTER TABLE parcels
    ADD CONSTRAINT parcels_coins_per_hour_check
    CHECK (coins_per_hour IN (1, 2, 5, 12, 100));

ALTER TABLE parcels
    ADD CONSTRAINT parcels_rarity_matches_rate
    CHECK (
        (rarity = 'ROCKY'    AND coins_per_hour = 1)   OR
        (rarity = 'COAL'     AND coins_per_hour = 2)   OR
        (rarity = 'AMETHYST' AND coins_per_hour = 5)   OR
        (rarity = 'SAPPHIRE' AND coins_per_hour = 12)  OR
        (rarity = 'RUBY'     AND coins_per_hour = 100)
    );

COMMIT;
