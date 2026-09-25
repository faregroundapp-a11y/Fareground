-- ===========================================================================
--  004 - Coins become money, so they need a ledger.
--
--  WHY THIS EXISTS
--  Up to now `users.coin_balance` was just a number we added to. That is fine
--  for a score. It is not fine for anything redeemable for real money, because
--  it cannot answer the only question that ever matters in a dispute:
--
--      "Why does this account have 4,812 coins?"
--
--  So every coin movement now gets an immutable row saying where it came from.
--  `users.coin_balance` stays, but demoted to a CACHED PROJECTION of this
--  table - fast to read, and checkable against the truth at any time:
--
--      SELECT SUM(amount) FROM coin_ledger WHERE user_id = $1;
--
--  Retrofitting this after a payout dispute, an audit or a tax question is
--  miserable, because the history you need was never written down. Doing it
--  now costs one migration.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- What kind of movement a row represents.
--   ACCRUAL     passive income from owned parcels (the only source today)
--   PAYOUT      coins converted to money and sent out - always negative
--   ADJUSTMENT  a human correction; always needs a note saying who and why
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'coin_entry_type') THEN
        CREATE TYPE coin_entry_type AS ENUM ('ACCRUAL', 'PAYOUT', 'ADJUSTMENT');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS coin_ledger (
    id             UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entry_type     coin_entry_type NOT NULL,

    -- Signed on purpose: credits are positive, payouts negative. That way the
    -- balance is a plain SUM and can never disagree with itself about which
    -- direction a row went.
    amount         BIGINT          NOT NULL CHECK (amount <> 0),

    -- The balance immediately after this row was written. Redundant by design:
    -- it makes a corrupted or missing row obvious instead of silent.
    balance_after  BIGINT          NOT NULL CHECK (balance_after >= 0),

    -- Provenance for ACCRUAL rows: exactly which window was paid, and at what
    -- rate. This is what lets you reconstruct or re-audit any payment.
    earned_from    TIMESTAMPTZ,
    earned_to      TIMESTAMPTZ,
    coins_per_hour INTEGER,

    note           TEXT,
    created_at     TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- An accrual must say what period it covers; anything else must not.
    CONSTRAINT coin_ledger_accrual_window CHECK (
        (entry_type = 'ACCRUAL' AND earned_from IS NOT NULL
                                AND earned_to IS NOT NULL
                                AND coins_per_hour IS NOT NULL
                                AND amount > 0)
        OR
        (entry_type <> 'ACCRUAL' AND earned_from IS NULL
                                 AND earned_to IS NULL
                                 AND coins_per_hour IS NULL)
    ),

    -- Money leaving must actually be negative.
    CONSTRAINT coin_ledger_payout_negative CHECK (
        entry_type <> 'PAYOUT' OR amount < 0
    )
);

CREATE INDEX IF NOT EXISTS idx_coin_ledger_user_created
    ON coin_ledger (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Existing balances predate the ledger. Write one opening row per account so
-- the invariant (SUM(amount) = coin_balance) holds from today onward, rather
-- than pretending we know a history we never recorded.
-- ---------------------------------------------------------------------------
INSERT INTO coin_ledger (user_id, entry_type, amount, balance_after, note)
SELECT u.id, 'ADJUSTMENT', u.coin_balance, u.coin_balance,
       'Opening balance carried in when the ledger was introduced (migration 004).'
FROM users u
WHERE u.coin_balance > 0
  AND NOT EXISTS (SELECT 1 FROM coin_ledger l WHERE l.user_id = u.id);

COMMIT;
