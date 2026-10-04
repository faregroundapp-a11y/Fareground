-- 037 - Forgot password (2026-10-04). A 6-digit code emailed to the player,
-- stored only as a hash, good for 15 minutes and a handful of guesses.
CREATE TABLE IF NOT EXISTS password_resets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT        NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  attempts    INTEGER     NOT NULL DEFAULT 0,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id, created_at DESC);
