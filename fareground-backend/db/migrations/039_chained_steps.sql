-- 039 - CHAINED STEPS (2026-10-05). Walk Points from steps wait in a locked
-- pile until the player watches an ad; each ad releases 1,000 steps' worth.
-- They are kept forever - nothing chained is ever lost.
ALTER TYPE ad_reward_kind ADD VALUE IF NOT EXISTS 'UNLOCK_STEPS';
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_wp INTEGER NOT NULL DEFAULT 0 CHECK (locked_wp >= 0);
