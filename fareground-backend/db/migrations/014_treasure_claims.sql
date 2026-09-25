-- ===========================================================================
--  014 - A treasure box's reward becomes a reward_claims row, so the same
--        "watch an ad to double it" works on it as on chests and quests.
-- ===========================================================================

BEGIN;

ALTER TABLE reward_claims DROP CONSTRAINT IF EXISTS reward_claims_source_check;
ALTER TABLE reward_claims ADD CONSTRAINT reward_claims_source_check
    CHECK (source IN ('DAILY', 'QUEST', 'CHECKIN', 'ADSTREAK', 'TREASURE'));

ALTER TABLE treasure_boxes ADD COLUMN IF NOT EXISTS claim_id UUID REFERENCES reward_claims(id) ON DELETE SET NULL;

COMMIT;
