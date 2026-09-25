-- ===========================================================================
--  007 - Daily chest, daily quests, and "watch an ad to double it".
--
--  reward_claims  one row per daily-chest or quest reward collected. The
--                 unique index makes each reward collectable once per local
--                 day. `doubled_at` records a "double it" ad being paid.
--  users.time_zone  so "today" means the player's today, not the server's.
--  ad_rewards.target_claim_id  which claim a DOUBLE ad is for.
-- ===========================================================================

-- A new enum value cannot be used in the same transaction that adds it, so
-- this runs before BEGIN.
ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'DOUBLE';

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64) NOT NULL DEFAULT 'UTC';

CREATE TABLE IF NOT EXISTS reward_claims (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source      VARCHAR(16) NOT NULL CHECK (source IN ('DAILY', 'QUEST')),
    quest_key   VARCHAR(32),
    local_day   DATE        NOT NULL,
    amount      INTEGER     NOT NULL CHECK (amount > 0),
    streak      INTEGER,
    doubled_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT reward_claims_quest_key CHECK ((source = 'QUEST') = (quest_key IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS reward_claims_once_per_day
    ON reward_claims (user_id, source, COALESCE(quest_key, ''), local_day);
CREATE INDEX IF NOT EXISTS idx_reward_claims_user_created
    ON reward_claims (user_id, created_at DESC);

ALTER TABLE ad_rewards ADD COLUMN IF NOT EXISTS target_claim_id UUID REFERENCES reward_claims(id) ON DELETE SET NULL;

COMMIT;
