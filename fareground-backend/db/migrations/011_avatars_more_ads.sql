-- ===========================================================================
--  011 - Avatars, usernames, titles, and three more rewarded-ad rewards.
--
--  users.avatar            the chosen character parts (see game/avatar.ts)
--  users.title             a badge the player shows off next to their name
--  users.username_changed_at  so names cannot churn every day
--  users.scout_until       a temporary longer claim reach, from an ad
--  user_cosmetics          avatar parts unlocked by watching an ad
--  ad_rewards.cosmetic_key which part a COSMETIC ad was for
-- ===========================================================================

ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'INSTANT_COLLECT';
ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'SCOUT';
ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'COSMETIC';

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS title VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS scout_until TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_cosmetics (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_key    VARCHAR(32) NOT NULL,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, item_key)
);

ALTER TABLE ad_rewards ADD COLUMN IF NOT EXISTS cosmetic_key VARCHAR(32);

-- Names are compared case-insensitively from here on, so "Ada" and "ada"
-- cannot both exist.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON users (lower(username));

COMMIT;
