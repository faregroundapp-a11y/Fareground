-- 040 - Moderation (2026-10-05). Bans, and a permanent record of every
-- action taken from the mod console (scripts/mod.ts): who did what, to whom,
-- and why. Rows are never edited or deleted.
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;

CREATE TABLE IF NOT EXISTS mod_actions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kept when the account is deleted, so the history outlives the player.
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  username    VARCHAR(32),
  action      VARCHAR(24) NOT NULL,
  detail      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  actor       VARCHAR(64) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mod_actions_user_idx ON mod_actions (user_id, created_at DESC);
