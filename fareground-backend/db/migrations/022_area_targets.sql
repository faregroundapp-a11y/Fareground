-- 022: the daily area assignment
--
-- Visits changed from "check in wherever you happen to be" to "here is ONE
-- place to walk to today". The 5x5 board it replaced showed everything
-- around you and asked you to pick, which is not a goal - it is a menu. A
-- single assigned destination is a reason to leave the house.
--
-- WHY THIS NEEDS A TABLE AT ALL. The target has to be STABLE: if it were
-- recomputed from the player's current position every time they opened the
-- app, it would run away from them as they walked towards it, which is the
-- one behaviour that would make the feature worthless. So it is rolled once,
-- written down, and read back until it is claimed.

CREATE TABLE IF NOT EXISTS area_targets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The player's LOCAL day, so "today's area" means their today.
    local_day       DATE NOT NULL,

    -- The square, on the same lattice as checkins.place_x/place_y. The scale
    -- is stored for the same reason it is on checkins: it has changed once
    -- already (migration 016) and a row must be comparable to its own era.
    place_x         INTEGER NOT NULL,
    place_y         INTEGER NOT NULL,
    place_scale     INTEGER NOT NULL,

    -- Where the player was when this was rolled. Kept so the distance shown
    -- in the app can be sanity-checked against what was actually assigned,
    -- and so an absurd target (rolled in another city) is visible in the data.
    origin_lat      DOUBLE PRECISION NOT NULL,
    origin_lng      DOUBLE PRECISION NOT NULL,

    -- FALSE for the free one each day, TRUE for every extra bought with an ad.
    from_ad         BOOLEAN NOT NULL DEFAULT FALSE,

    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    claimed_at      TIMESTAMPTZ,
    -- The reward_claims row, so "watch an ad to double it" works exactly as
    -- it does for the chest and the quests.
    claim_id        UUID REFERENCES reward_claims(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_area_targets_user_day
    ON area_targets (user_id, local_day DESC);

-- AT MOST ONE UNCLAIMED TARGET PER PERSON, ENFORCED BY THE DATABASE.
--
-- This is the rule the whole feature rests on: you have one place to go.
-- Without it, two phones (or two taps) could each roll a target and a player
-- would accumulate destinations, which is the menu we just removed. A partial
-- unique index is the cheapest way to say it and it cannot be raced.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_area_target_open
    ON area_targets (user_id)
    WHERE claimed_at IS NULL;
