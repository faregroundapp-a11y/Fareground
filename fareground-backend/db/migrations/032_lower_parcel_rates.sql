-- ===========================================================================
--  032 - Parcels earn less: average 3.87 -> 0.82 coins a month.
--
--  Product owner's call (2026-09-27), with the arithmetic in rules.ts beside
--  RARITY_TABLE: at the old rates a boost ad on a large holding cost about
--  what the ad earns, and unboosted income had no ad behind it at all.
--
--      ROCKY 3 -> 0.6   COAL 4 -> 0.8   AMETHYST 5 -> 1.2
--      SAPPHIRE 8 -> 2  RUBY 25 -> 6
--
--  Rates now need fractions, so the column becomes NUMERIC(6,2) (and the
--  ledger's copy of it, which records the rate an accrual was paid at).
--  Every parcel is re-rated, not only new ones: the point is what the land
--  costs from here on. Coins already earned are untouched.
-- ===========================================================================

BEGIN;

ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_rarity_matches_rate;

ALTER TABLE parcels ALTER COLUMN coins_per_month TYPE NUMERIC(6,2);

UPDATE parcels SET coins_per_month = CASE rarity
    WHEN 'ROCKY'    THEN 0.6
    WHEN 'COAL'     THEN 0.8
    WHEN 'AMETHYST' THEN 1.2
    WHEN 'SAPPHIRE' THEN 2
    WHEN 'RUBY'     THEN 6
END;

ALTER TABLE parcels
    ADD CONSTRAINT parcels_rarity_matches_rate
    CHECK (
        (rarity = 'ROCKY'    AND coins_per_month = 0.6) OR
        (rarity = 'COAL'     AND coins_per_month = 0.8) OR
        (rarity = 'AMETHYST' AND coins_per_month = 1.2) OR
        (rarity = 'SAPPHIRE' AND coins_per_month = 2)   OR
        (rarity = 'RUBY'     AND coins_per_month = 6)
    );

ALTER TABLE coin_ledger ALTER COLUMN coins_per_month TYPE NUMERIC(10,2);

COMMIT;
