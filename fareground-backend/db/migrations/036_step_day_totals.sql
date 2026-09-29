-- 036 - The step ledger moves to the server (2026-09-29).
--
-- The app used to remember, on the phone, how much of today's count it had
-- already sent. Clearing the app's storage wiped that memory, so the next
-- sync sent the whole day again and was paid again - repeatable up to the
-- daily step cap. Now the app sends the phone's own total for each day and
-- the server pays only what is above the highest total it has seen for that
-- player and day. Nothing on the phone can reset this.
CREATE TABLE IF NOT EXISTS step_day_totals (
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day         DATE        NOT NULL,
  reported    INTEGER     NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, day)
);
