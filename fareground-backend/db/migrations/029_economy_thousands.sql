-- ===========================================================================
--  029 - Coins in the thousands, parcels paid per month.
--
--  The product owner's economy (2026-09-26), researched against Atlas Earth
--  and TerraMine, whose rates are identical to each other:
--
--    1,000 coins = $1          (was 2,000,000 - "in the millions" read as
--                               an inflation problem to testers)
--    parcel rates PER MONTH    Rocky 3, Coal 4, Amethyst 5, Sapphire 8,
--                              Ruby 25 - TerraMine-level, ruby the jackpot
--
--  Three things change here, all in one transaction:
--
--  1. parcels.coins_per_hour becomes parcels.coins_per_month, re-valued by
--     rarity. A per-hour integer cannot express TerraMine-level rates at
--     1,000 coins to the dollar (a rocky parcel earns ~0.004 coins an hour),
--     and income is already accrued in micro-coins, so the unit is free to
--     change.
--
--  2. EVERY BALANCE IS CONVERTED, NEVER LOST. 2,000 old coins = 1 new coin,
--     exactly the same dollar value. The micro-coin remainder carries the
--     fraction, so nobody loses even a part of a coin, and each account gets
--     one ADJUSTMENT ledger row so SUM(ledger) = balance still holds.
--
--  3. The ledger records new accruals in coins_per_month. Old rows keep their
--     coins_per_hour: history is not rewritten into a unit it was never in.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Parcel rates.
-- ---------------------------------------------------------------------------
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_coins_per_hour_check;
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_rarity_matches_rate;

ALTER TABLE parcels RENAME COLUMN coins_per_hour TO coins_per_month;

UPDATE parcels SET coins_per_month = CASE rarity
    WHEN 'ROCKY'    THEN 3
    WHEN 'COAL'     THEN 4
    WHEN 'AMETHYST' THEN 5
    WHEN 'SAPPHIRE' THEN 8
    WHEN 'RUBY'     THEN 25
END;

ALTER TABLE parcels
    ADD CONSTRAINT parcels_rarity_matches_rate
    CHECK (
        (rarity = 'ROCKY'    AND coins_per_month = 3)  OR
        (rarity = 'COAL'     AND coins_per_month = 4)  OR
        (rarity = 'AMETHYST' AND coins_per_month = 5)  OR
        (rarity = 'SAPPHIRE' AND coins_per_month = 8)  OR
        (rarity = 'RUBY'     AND coins_per_month = 25)
    );

-- ---------------------------------------------------------------------------
-- 2. Balances: 2,000 old coins = 1 new coin, fraction kept in micro-coins.
--
--    total micro (new) = (balance * 1,000,000 + remainder) / 2,000
--                      = balance * 500 + remainder / 2,000
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE conv ON COMMIT DROP AS
SELECT id,
       coin_balance AS old_balance,
       (coin_balance * 500 + coin_remainder_micro / 2000) AS total_micro
  FROM users;

UPDATE users u
   SET coin_balance         = c.total_micro / 1000000,
       coin_remainder_micro = c.total_micro % 1000000
  FROM conv c
 WHERE u.id = c.id;

-- ---------------------------------------------------------------------------
-- 3. The ledger: a coins_per_month column for new accruals, and the accrual
--    rule accepting either unit.
-- ---------------------------------------------------------------------------
ALTER TABLE coin_ledger ADD COLUMN IF NOT EXISTS coins_per_month INTEGER;

ALTER TABLE coin_ledger DROP CONSTRAINT IF EXISTS coin_ledger_accrual_window;
ALTER TABLE coin_ledger
    ADD CONSTRAINT coin_ledger_accrual_window CHECK (
        (entry_type = 'ACCRUAL' AND earned_from IS NOT NULL
                                AND earned_to IS NOT NULL
                                AND (coins_per_hour IS NOT NULL OR coins_per_month IS NOT NULL)
                                AND amount > 0)
        OR
        (entry_type <> 'ACCRUAL' AND earned_from IS NULL
                                 AND earned_to IS NULL
                                 AND coins_per_hour IS NULL
                                 AND coins_per_month IS NULL)
    );

-- One row per account whose balance changed, so SUM(ledger) = balance.
INSERT INTO coin_ledger (user_id, entry_type, amount, balance_after, note)
SELECT u.id, 'ADJUSTMENT', u.coin_balance - c.old_balance, u.coin_balance,
       'Re-denominated: 2,000 old coins = 1 new coin, same dollar value (migration 029).'
  FROM users u JOIN conv c ON c.id = u.id
 WHERE u.coin_balance <> c.old_balance;

COMMIT;
