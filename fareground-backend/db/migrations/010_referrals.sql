-- ===========================================================================
--  010 - Invite a friend.
--
--  users.referral_code  a short code the player shares (made on first use).
--  referrals            one row per accepted invite. The INVITEE is paid at
--                       once; the INVITER is paid only when that friend has
--                       really walked (see REFERRAL_STEPS_TO_QUALIFY), which
--                       is what stops someone farming themselves with throwaway
--                       accounts. One row per invitee, ever.
-- ===========================================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code VARCHAR(12);
CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique ON users (referral_code) WHERE referral_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS referrals (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    referee_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    code            VARCHAR(12) NOT NULL,
    referee_reward  INTEGER     NOT NULL,
    referrer_reward INTEGER,
    qualified_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT referrals_not_self CHECK (referrer_id <> referee_id),
    CONSTRAINT referrals_reward_complete CHECK ((qualified_at IS NULL) = (referrer_reward IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals (referrer_id, created_at DESC);

COMMIT;
