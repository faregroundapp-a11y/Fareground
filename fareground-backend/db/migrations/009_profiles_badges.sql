-- ===========================================================================
--  009 - Player profiles and badges.
--
--  users.jersey_color  the colour of your runner on the map and in profiles.
--  user_badges         when each badge was first unlocked, and whether the
--                      player has seen it yet (for the "new badge" dot).
--                      Badges themselves are worked out from stats on the fly.
-- ===========================================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS jersey_color VARCHAR(9) NOT NULL DEFAULT '#2F5D50';

CREATE TABLE IF NOT EXISTS user_badges (
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_key   VARCHAR(32) NOT NULL,
    unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    seen        BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (user_id, badge_key)
);

COMMIT;
