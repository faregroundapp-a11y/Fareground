-- 027: a player's time zone can only move once a week
--
-- Every daily reward resets at the player's LOCAL midnight, worked out on the
-- server from users.time_zone - the phone's clock is never trusted. That
-- leaves one lever: the zone itself. Hop from London to Tokyo and "tomorrow"
-- arrives nine hours early, with a fresh chest, fresh quests and fresh ad
-- caps; hop back and do it again.
--
-- So the zone is recorded when it changes, and a change inside the cooldown
-- (TIME_ZONE_CHANGE_COOLDOWN_DAYS in rules.ts) is ignored rather than refused:
-- a real traveller simply keeps their home day for a few days, which costs
-- them nothing, and nobody sees an error for something they did not choose.
--
-- NULL means "never deliberately set" - the account is still on the UTC
-- default it was created with, and its first real zone is always accepted.

ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone_changed_at TIMESTAMPTZ;
