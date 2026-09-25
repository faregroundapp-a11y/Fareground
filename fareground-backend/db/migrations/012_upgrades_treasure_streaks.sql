-- ===========================================================================
--  012 - Parcel upgrades, treasure boxes, streak insurance, ad streaks,
--        and unlimited check-ins.
--
--  parcels.upgrade_level   0-4. Each level adds +1 coin/hour to that parcel.
--                          The base rate stays in coins_per_hour, so the
--                          rarity/rate CHECK from migration 003 still holds;
--                          income is SUM(coins_per_hour + upgrade_level).
--  streak_saves            a missed day someone paid an ad to forgive.
--  treasure_boxes          boxes that appear near a player to walk to.
--  checkins                one per PLACE per day now, not one per day.
--  reward_claims           gains CHECKIN-per-place and ADSTREAK rows.
-- ===========================================================================

ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'UPGRADE';
ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'EXTRA_CHECKIN';
ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'STREAK_SAVE';
ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'TREASURE';

BEGIN;

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS upgrade_level INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_upgrade_level_range') THEN
        ALTER TABLE parcels ADD CONSTRAINT parcels_upgrade_level_range
            CHECK (upgrade_level BETWEEN 0 AND 4);
    END IF;
END
$$;

ALTER TABLE ad_rewards ADD COLUMN IF NOT EXISTS target_parcel_id UUID REFERENCES parcels(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS streak_saves (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    for_day    DATE        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, for_day)
);

CREATE TABLE IF NOT EXISTS treasure_boxes (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lat          DOUBLE PRECISION NOT NULL,
    lng          DOUBLE PRECISION NOT NULL,
    reward_wp    INTEGER     NOT NULL CHECK (reward_wp > 0),
    from_ad      BOOLEAN     NOT NULL DEFAULT FALSE,
    local_day    DATE        NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    collected_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_treasure_user_live ON treasure_boxes (user_id, collected_at, expires_at);

-- Check-ins: one per PLACE per day, so extra ones must be somewhere new.
ALTER TABLE checkins DROP CONSTRAINT IF EXISTS checkins_once_per_day;
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS from_ad BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS checkins_once_per_place_per_day
    ON checkins (user_id, local_day, place_x, place_y);

-- reward_claims: CHECKIN rows now carry their place in quest_key, and there
-- is a new ADSTREAK source for the "watch a few ads" bonus chest.
ALTER TABLE reward_claims DROP CONSTRAINT IF EXISTS reward_claims_source_check;
ALTER TABLE reward_claims ADD CONSTRAINT reward_claims_source_check
    CHECK (source IN ('DAILY', 'QUEST', 'CHECKIN', 'ADSTREAK'));
ALTER TABLE reward_claims DROP CONSTRAINT IF EXISTS reward_claims_quest_key;
-- Check-ins made before this migration have no place on their reward row;
-- fill it in from the check-in itself so the new rule holds for them too.
UPDATE reward_claims rc
   SET quest_key = c.place_x || ':' || c.place_y
  FROM checkins c
 WHERE c.claim_id = rc.id AND rc.source = 'CHECKIN' AND rc.quest_key IS NULL;
UPDATE reward_claims SET quest_key = 'legacy'
 WHERE source = 'CHECKIN' AND quest_key IS NULL;
ALTER TABLE reward_claims ADD CONSTRAINT reward_claims_quest_key
    CHECK ((source IN ('QUEST', 'CHECKIN')) = (quest_key IS NOT NULL));

COMMIT;
