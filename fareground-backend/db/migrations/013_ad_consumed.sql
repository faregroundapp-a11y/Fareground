-- ===========================================================================
--  013 - Some rewards are spent LATER than they are granted.
--
--  An EXTRA_CHECKIN ad grants permission to check in again; the check-in
--  request itself spends it. `consumed_at` is what makes that single-use:
--  one ad, one extra check-in.
-- ===========================================================================

BEGIN;

ALTER TABLE ad_rewards ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_ad_rewards_unspent
    ON ad_rewards (user_id, kind, status) WHERE consumed_at IS NULL;

COMMIT;
