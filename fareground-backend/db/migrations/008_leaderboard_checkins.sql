-- ===========================================================================
--  008 - Weekly step leaderboards by area, prize land boosts, and check-ins.
--
--  users.area_*       the player's current city / region / country, named by
--                     the phone (reverse geocoding) - that is what "areas" on
--                     the leaderboard mean. Only names are stored, never an
--                     exact position.
--  boosts.source      'AD' (rewarded ad, bank capped at 4 h) or 'PRIZE'
--                     (leaderboard win). Prize boosts sit alongside ad boosts
--                     and their multipliers add up.
--  leaderboard_weeks  which weeks have had their prizes handed out.
--  leaderboard_awards one row per winner per week (a player keeps only their
--                     best prize that week - see the unique index).
--  checkins           one location check-in per player per local day.
--  reward_claims gains the 'CHECKIN' source so an ad can double a check-in.
-- ===========================================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS area_city    VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS area_region  VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS area_country VARCHAR(80);
ALTER TABLE users ADD COLUMN IF NOT EXISTS area_updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_area_city    ON users (area_country, area_region, area_city);
CREATE INDEX IF NOT EXISTS idx_users_area_country ON users (area_country);

ALTER TABLE boosts ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'AD';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'boosts_source_valid') THEN
        ALTER TABLE boosts ADD CONSTRAINT boosts_source_valid CHECK (source IN ('AD', 'PRIZE'));
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS leaderboard_weeks (
    week_start  DATE        PRIMARY KEY,
    settled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leaderboard_awards (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    week_start  DATE        NOT NULL,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope       VARCHAR(16) NOT NULL CHECK (scope IN ('CITY', 'REGION', 'COUNTRY', 'WORLD')),
    area_name   VARCHAR(200) NOT NULL,
    rank        INTEGER     NOT NULL CHECK (rank BETWEEN 1 AND 3),
    steps       BIGINT      NOT NULL,
    multiplier  INTEGER     NOT NULL,
    seconds     INTEGER     NOT NULL,
    boost_id    UUID        REFERENCES boosts(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT leaderboard_awards_one_per_week UNIQUE (week_start, user_id)
);

CREATE INDEX IF NOT EXISTS idx_step_logs_logged_at ON step_logs (logged_at);

CREATE TABLE IF NOT EXISTS checkins (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    local_day   DATE        NOT NULL,
    -- ~1 km squares (lat/lng x 100, rounded), to spot a new place
    place_x     INTEGER     NOT NULL,
    place_y     INTEGER     NOT NULL,
    place_name  VARCHAR(160),
    accuracy_m  REAL        NOT NULL,
    new_place   BOOLEAN     NOT NULL,
    claim_id    UUID        REFERENCES reward_claims(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT checkins_once_per_day UNIQUE (user_id, local_day)
);
CREATE INDEX IF NOT EXISTS idx_checkins_user_place ON checkins (user_id, place_x, place_y);

ALTER TABLE reward_claims DROP CONSTRAINT IF EXISTS reward_claims_source_check;
ALTER TABLE reward_claims ADD CONSTRAINT reward_claims_source_check
    CHECK (source IN ('DAILY', 'QUEST', 'CHECKIN'));

COMMIT;
