-- ---------------------------------------------------------------------------
--  018 - Pit stops.
--
--  Visits were keyed on a ~250 m square of the world. A pit stop is keyed on
--  a PARCEL, which is the thing worth walking to: it puts other players' land
--  on your route instead of an arbitrary patch of map.
--
--    pit_stops              one row per (player, parcel, time).
--    users.last_pit_stop_at drives the 5-minute cooldown.
--
--  The old `checkins` table is LEFT ALONE. It holds real history, the streak
--  query reads it, and nothing is gained by destroying it - pit stops are a
--  new table beside it, not a rewrite of it.
--
--  Two cooldowns, enforced in different places on purpose:
--   * per-parcel 24 h, from the pit_stops rows themselves (an index lookup).
--   * global 5 min, from users.last_pit_stop_at under the row lock the
--     transaction already takes - so two phones cannot both slip through.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS pit_stops (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    parcel_id   UUID        NOT NULL REFERENCES parcels(id) ON DELETE CASCADE,

    -- Denormalised so the reward can be audited later without re-deriving who
    -- owned the parcel at the time; ownership is permanent today, but a row
    -- that explains its own amount is worth the extra column.
    was_own     BOOLEAN     NOT NULL,
    first_ever  BOOLEAN     NOT NULL,
    amount_wp   INTEGER     NOT NULL CHECK (amount_wp >= 0),

    -- The ad that skipped the cooldown, if one was spent.
    from_ad     BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Pit stop rewards are reward_claims rows like every other collectable,
    -- so "watch an ad to double it" works with no special case.
    claim_id    UUID        REFERENCES reward_claims(id) ON DELETE SET NULL,

    accuracy_m  REAL        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The 24-hour per-parcel check: "has this player stopped here recently?"
CREATE INDEX IF NOT EXISTS pit_stops_user_parcel_recent
    ON pit_stops (user_id, parcel_id, created_at DESC);

-- "Where have I been today", newest first, for the app's list.
CREATE INDEX IF NOT EXISTS pit_stops_user_recent
    ON pit_stops (user_id, created_at DESC);

-- The global cooldown. NULL means "never stopped", which is not the same as
-- "stopped long ago" only in that the first stop is always allowed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_pit_stop_at TIMESTAMPTZ;

-- reward_claims gains a source so a pit stop reward can be doubled by ad
-- exactly like a chest, a quest or a treasure box.
ALTER TABLE reward_claims DROP CONSTRAINT IF EXISTS reward_claims_source_check;
ALTER TABLE reward_claims ADD CONSTRAINT reward_claims_source_check
    CHECK (source IN ('DAILY', 'QUEST', 'CHECKIN', 'ADSTREAK', 'TREASURE', 'PITSTOP'));

COMMIT;
