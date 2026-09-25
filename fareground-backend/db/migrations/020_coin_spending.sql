-- ===========================================================================
--  020 - Coins can be SPENT.
--
--  Until now a coin could only sit in a balance waiting for a redemption that
--  is not implemented. A number that goes up and does nothing is not a
--  reward, whatever the exchange rate - and no rate change fixes that.
--
--  So the ledger gains a SPEND type, and coins buy things the player actually
--  wants: a streak save, an extra treasure box, skipping a pit stop cooldown,
--  an avatar part.
--
--  WHY THIS IS GOOD FOR BOTH SIDES. Every one of those sinks costs us close
--  to nothing to hand out, and spending coins REDUCES what we would owe if
--  redemption is ever switched on. The player gets something immediately; the
--  liability goes down. Compare a sink that raises a parcel's rate, which
--  would trade a one-off balance for a perpetuity - strictly worse for us and
--  the reason upgrades are NOT sold for coins.
--
--  A NEW ENUM TYPE, NOT `ALTER TYPE ... ADD VALUE`. Adding a value to an enum
--  and using it in the same transaction is rejected by PostgreSQL, and the
--  migration runner wraps every file in one transaction. Migration 003 hit
--  exactly this and solved it the same way: build a fresh type, swap the
--  column, drop the old one. Fully transactional, so a failure here leaves
--  the database exactly as it was.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The new type, with SPEND added.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coin_entry_type_v2') THEN
        CREATE TYPE coin_entry_type_v2 AS ENUM ('ACCRUAL', 'PAYOUT', 'ADJUSTMENT', 'SPEND');
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. The constraints name the old type's literals, so they come off first.
-- ---------------------------------------------------------------------------
ALTER TABLE coin_ledger DROP CONSTRAINT IF EXISTS coin_ledger_accrual_window;
ALTER TABLE coin_ledger DROP CONSTRAINT IF EXISTS coin_ledger_payout_negative;

-- ---------------------------------------------------------------------------
-- 3. Swap the column over. Every existing value exists in the new type, so
--    the cast through text is total.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'coin_ledger' AND column_name = 'entry_type'
           AND udt_name = 'coin_entry_type'
    ) THEN
        ALTER TABLE coin_ledger
            ALTER COLUMN entry_type TYPE coin_entry_type_v2
            USING entry_type::text::coin_entry_type_v2;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Put the constraints back, now covering SPEND.
-- ---------------------------------------------------------------------------
ALTER TABLE coin_ledger
    ADD CONSTRAINT coin_ledger_accrual_window CHECK (
        (entry_type = 'ACCRUAL' AND earned_from IS NOT NULL
                                AND earned_to IS NOT NULL
                                AND coins_per_hour IS NOT NULL
                                AND amount > 0)
        OR
        (entry_type <> 'ACCRUAL' AND earned_from IS NULL
                                 AND earned_to IS NULL
                                 AND coins_per_hour IS NULL)
    );

-- Money leaving must actually be negative - now true of spending as well as
-- payouts. This is what stops a "purchase" that quietly credits coins.
ALTER TABLE coin_ledger
    ADD CONSTRAINT coin_ledger_outgoing_negative CHECK (
        entry_type NOT IN ('PAYOUT', 'SPEND') OR amount < 0
    );

-- ---------------------------------------------------------------------------
-- 5. Retire the old type and take its name.
-- ---------------------------------------------------------------------------
DROP TYPE IF EXISTS coin_entry_type;
ALTER TYPE coin_entry_type_v2 RENAME TO coin_entry_type;

-- ---------------------------------------------------------------------------
-- 6. What was bought, so a purchase can be audited and consumables can be
--    counted against their daily caps.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coin_purchases (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key   VARCHAR(32) NOT NULL,
    -- Denormalised: the price may change, and a row must explain itself.
    price      BIGINT      NOT NULL CHECK (price > 0),
    -- For COSMETIC, which part was bought.
    detail     VARCHAR(32),
    ledger_id  UUID        REFERENCES coin_ledger(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coin_purchases_user_recent
    ON coin_purchases (user_id, created_at DESC);

COMMIT;
