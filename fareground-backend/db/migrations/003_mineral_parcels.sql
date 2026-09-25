-- ===========================================================================
--  003 - Parcels become minerals.
--
--  The four abstract tiers (COMMON / RARE / EPIC / LEGENDARY) become five
--  named minerals, and a fifth, much rarer tier is added at the top:
--
--      ROCKY      60%      1 coin/hour
--      COAL       25%      2
--      AMETHYST   10%      5
--      SAPPHIRE    4%     12
--      RUBY        1%     40
--
--  We build a NEW enum type and swap the column over rather than using
--  ALTER TYPE ... ADD VALUE. That is deliberate: adding a value to an enum
--  and then referring to it in the same transaction is rejected by
--  PostgreSQL, and our migration runner wraps every file in one transaction.
--  Creating a fresh type sidesteps that entirely and is fully transactional,
--  so a failure here leaves the database exactly as it was.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The new type.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parcel_mineral') THEN
        CREATE TYPE parcel_mineral AS ENUM ('ROCKY', 'COAL', 'AMETHYST', 'SAPPHIRE', 'RUBY');
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Drop the old constraints. They name the old enum's literals, so they
--    have to go before the column can change type.
-- ---------------------------------------------------------------------------
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_rarity_matches_rate;
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_coins_per_hour_check;

-- ---------------------------------------------------------------------------
-- 3. Convert the column, mapping every existing parcel onto its new tier.
--    Tier order is preserved: the old top tier becomes SAPPHIRE, and RUBY is
--    new ground that nobody can have owned yet.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'parcels' AND column_name = 'rarity' AND udt_name = 'parcel_rarity'
    ) THEN
        ALTER TABLE parcels
            ALTER COLUMN rarity TYPE parcel_mineral
            USING (
                CASE rarity::text
                    WHEN 'COMMON'    THEN 'ROCKY'
                    WHEN 'RARE'      THEN 'COAL'
                    WHEN 'EPIC'      THEN 'AMETHYST'
                    WHEN 'LEGENDARY' THEN 'SAPPHIRE'
                END
            )::parcel_mineral;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Existing rows still carry the OLD hourly rates. Re-price them so the
--    constraint below can be trusted. (AMETHYST 4 -> 5, SAPPHIRE 10 -> 12.)
-- ---------------------------------------------------------------------------
UPDATE parcels SET coins_per_hour = 1  WHERE rarity = 'ROCKY'    AND coins_per_hour <> 1;
UPDATE parcels SET coins_per_hour = 2  WHERE rarity = 'COAL'     AND coins_per_hour <> 2;
UPDATE parcels SET coins_per_hour = 5  WHERE rarity = 'AMETHYST' AND coins_per_hour <> 5;
UPDATE parcels SET coins_per_hour = 12 WHERE rarity = 'SAPPHIRE' AND coins_per_hour <> 12;
UPDATE parcels SET coins_per_hour = 40 WHERE rarity = 'RUBY'     AND coins_per_hour <> 40;

-- ---------------------------------------------------------------------------
-- 5. Put the guard rails back, now naming the new tiers. The database still
--    refuses any parcel whose mineral and hourly rate disagree.
-- ---------------------------------------------------------------------------
ALTER TABLE parcels
    ADD CONSTRAINT parcels_coins_per_hour_check
    CHECK (coins_per_hour IN (1, 2, 5, 12, 40));

ALTER TABLE parcels
    ADD CONSTRAINT parcels_rarity_matches_rate CHECK (
        (rarity = 'ROCKY'    AND coins_per_hour = 1)  OR
        (rarity = 'COAL'     AND coins_per_hour = 2)  OR
        (rarity = 'AMETHYST' AND coins_per_hour = 5)  OR
        (rarity = 'SAPPHIRE' AND coins_per_hour = 12) OR
        (rarity = 'RUBY'     AND coins_per_hour = 40)
    );

-- ---------------------------------------------------------------------------
-- 6. The old type has no users left.
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS parcel_rarity;

COMMIT;
