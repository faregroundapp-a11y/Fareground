-- ===========================================================================
--  Fareground - Step 1 database schema
--  Target: PostgreSQL 13 or newer (we rely on the built-in gen_random_uuid()).
--
--  Run it with:   npm run db:migrate
--  or manually:   psql "postgresql://user:pass@localhost:5432/walkscape" -f db/schema.sql
--
--  Everything here is written to be re-runnable (idempotent): running the file
--  twice will not blow up and will not destroy data.
-- ===========================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The rarity ENUM.
--    An ENUM means the database itself rejects any value that is not one of
--    these four strings, so bad data can never sneak in.
--    "CREATE TYPE" has no "IF NOT EXISTS", hence the little DO block.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'parcel_rarity') THEN
        CREATE TYPE parcel_rarity AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY');
    END IF;
END
$$;


-- ---------------------------------------------------------------------------
-- 2. USERS
--    NOTE: we use TIMESTAMPTZ (timestamp *with* time zone) rather than plain
--    TIMESTAMP. Players walk in every time zone on earth, and our passive-coin
--    maths is time based - storing a timestamp without its zone is the single
--    most common way to get that maths silently wrong.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    username            VARCHAR(32)  NOT NULL UNIQUE,
    email               VARCHAR(255) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,

    -- Walk Points: the "currency" earned by walking. 1,000 steps = 1 WP.
    walk_points_balance INTEGER      NOT NULL DEFAULT 0
                                     CHECK (walk_points_balance >= 0),

    -- Coins: passive income produced by owned parcels. BIGINT because a
    -- long-lived account with many LEGENDARY parcels will overflow INTEGER.
    coin_balance        BIGINT       NOT NULL DEFAULT 0
                                     CHECK (coin_balance >= 0),

    -- The moment up to which passive coins have already been paid out.
    -- See src/services/user.service.ts for how this drives "lazy evaluation".
    last_coin_claim_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Login looks users up by email, so give that lookup an index.
-- (The UNIQUE constraint above already creates one, so nothing extra needed.)


-- ---------------------------------------------------------------------------
-- 3. STEP_LOGS
--    An append-only audit trail: one row per sync from the phone.
--    Keeping the raw steps lets us recompute balances or investigate cheating
--    later without guessing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS step_logs (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ON DELETE CASCADE: deleting a user also deletes their step history.
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    raw_steps  INTEGER     NOT NULL CHECK (raw_steps > 0),
    wp_earned  INTEGER     NOT NULL CHECK (wp_earned >= 0),
    logged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- We constantly ask "all step logs for this user, newest first" and
-- "SUM(raw_steps) for this user", so index on user_id.
CREATE INDEX IF NOT EXISTS idx_step_logs_user_logged_at
    ON step_logs (user_id, logged_at DESC);


-- ---------------------------------------------------------------------------
-- 4. PARCELS
--    One row per parcel a player owns. coins_per_hour is stored on the row
--    (rather than looked up from rarity at read time) so that if we ever
--    re-balance the economy, parcels already sold keep the rate they were
--    bought with.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS parcels (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rarity         parcel_rarity NOT NULL,
    coins_per_hour INTEGER       NOT NULL CHECK (coins_per_hour IN (1, 2, 4, 10)),
    purchased_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    -- Belt and braces: the database refuses a parcel whose rarity and hourly
    -- rate disagree (e.g. a COMMON paying 10 coins/hour because of an app bug).
    CONSTRAINT parcels_rarity_matches_rate CHECK (
        (rarity = 'COMMON'    AND coins_per_hour = 1)  OR
        (rarity = 'RARE'      AND coins_per_hour = 2)  OR
        (rarity = 'EPIC'      AND coins_per_hour = 4)  OR
        (rarity = 'LEGENDARY' AND coins_per_hour = 10)
    )
);

-- GET /user/balance sums coins_per_hour for one owner on every single call.
CREATE INDEX IF NOT EXISTS idx_parcels_owner_id
    ON parcels (owner_id);

COMMIT;
