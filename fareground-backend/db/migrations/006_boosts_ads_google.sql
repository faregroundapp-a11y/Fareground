-- ===========================================================================
--  006 - Boosts, rewarded ads, exact coin maths, and Google sign-in.
--
--  1. users.coin_remainder_micro
--     Income is now worked out in millionths of a coin and the fraction is
--     carried on the user row, so the clock can always move to NOW(). The old
--     "advance the clock by the time paid for" trick could not cope with an
--     income rate that changes over time, which a boost does.
--
--  2. ad_rewards - one row per rewarded ad a player STARTED. The row is the
--     single-use ticket (its nonce) and, once granted, the audit record of
--     what the ad paid out. `network_txn_id` is unique so the ad network's
--     own transaction id can never pay twice.
--
--  3. boosts - windows of multiplied coin income. They are stacked end to
--     end, never overlapping, which keeps the income maths a simple sum.
--
--  4. Google accounts - users.google_sub (Google's stable user id), and
--     password_hash becomes optional for accounts that only ever use Google.
--
--  5. coin_ledger.boosted_seconds - how much of an accrual window was boosted,
--     so a boosted payment can still be re-derived exactly.
-- ===========================================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS coin_remainder_micro BIGINT NOT NULL DEFAULT 0;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_coin_remainder_range') THEN
        ALTER TABLE users ADD CONSTRAINT users_coin_remainder_range
            CHECK (coin_remainder_micro >= 0 AND coin_remainder_micro < 1000000);
    END IF;
END
$$;

-- Google sign-in.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique ON users (google_sub) WHERE google_sub IS NOT NULL;
DO $$
BEGIN
    -- Every account must have SOME way to sign in.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_has_login_method') THEN
        ALTER TABLE users ADD CONSTRAINT users_has_login_method
            CHECK (password_hash IS NOT NULL OR google_sub IS NOT NULL);
    END IF;
END
$$;

-- Rewarded ads.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ad_reward_kind') THEN
        CREATE TYPE ad_reward_kind AS ENUM ('BOOST', 'WALK_POINTS');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ad_reward_status') THEN
        CREATE TYPE ad_reward_status AS ENUM ('PENDING', 'GRANTED');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS ad_rewards (
    id              UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID             NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind            ad_reward_kind   NOT NULL,
    nonce           VARCHAR(64)      NOT NULL UNIQUE,
    status          ad_reward_status NOT NULL DEFAULT 'PENDING',
    created_at      TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ      NOT NULL,
    granted_at      TIMESTAMPTZ,
    -- What was paid: WP for WALK_POINTS, seconds of boost for BOOST.
    amount          INTEGER          CHECK (amount IS NULL OR amount > 0),
    -- 'client' (trusted report, dev only) or 'ssv' (Google's signed callback).
    verified_by     VARCHAR(16),
    network_txn_id  VARCHAR(255)     UNIQUE,

    CONSTRAINT ad_rewards_granted_complete CHECK (
        (status = 'PENDING' AND granted_at IS NULL AND amount IS NULL)
        OR
        (status = 'GRANTED' AND granted_at IS NOT NULL AND amount IS NOT NULL AND verified_by IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_ad_rewards_user_granted ON ad_rewards (user_id, kind, granted_at DESC);

CREATE TABLE IF NOT EXISTS boosts (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    starts_at    TIMESTAMPTZ NOT NULL,
    ends_at      TIMESTAMPTZ NOT NULL,
    multiplier   INTEGER     NOT NULL CHECK (multiplier >= 2),
    ad_reward_id UUID        REFERENCES ad_rewards(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT boosts_window_valid CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_boosts_user_ends ON boosts (user_id, ends_at DESC);

ALTER TABLE coin_ledger ADD COLUMN IF NOT EXISTS boosted_seconds INTEGER;

COMMIT;
