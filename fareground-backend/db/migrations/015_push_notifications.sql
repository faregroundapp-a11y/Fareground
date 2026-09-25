-- ---------------------------------------------------------------------------
--  015 - Push notifications.
--
--  A walking game is played away from the phone, so everything we built to
--  bring people back - streaks, the daily chest, land that keeps earning - is
--  invisible while the app is shut. This is the channel that fixes that.
--
--    push_tokens          one row per device, per account.
--    notification_sends   what we already sent, so nobody is told twice.
--    users.push_enabled   a kill switch the player controls.
--    users.last_active_at drives the "come back" notification.
--
--  Design notes:
--   * Tokens are UNIQUE across the table, not per user. A phone handed to
--     someone else re-registers the same Expo token against the new account,
--     and the old row must not keep receiving that account's notifications.
--   * notification_sends is keyed on the user's LOCAL day, so "one chest
--     reminder a day" means their day, not UTC's.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS push_tokens (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- An Expo push token: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]".
    token        VARCHAR(255) NOT NULL UNIQUE,
    platform     VARCHAR(16)  NOT NULL DEFAULT 'android'
                              CHECK (platform IN ('android', 'ios')),

    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- Set when Expo tells us the device is gone (DeviceNotRegistered), or the
    -- player signs out. Kept rather than deleted so we can see the history.
    disabled_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS push_tokens_live
    ON push_tokens (user_id) WHERE disabled_at IS NULL;


CREATE TABLE IF NOT EXISTS notification_sends (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind       VARCHAR(24) NOT NULL,
    local_day  DATE        NOT NULL,
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The whole anti-spam guarantee, in one index: one of each kind, per person,
-- per local day. The dispatcher INSERTs before sending and lets a conflict
-- mean "someone already handled this".
CREATE UNIQUE INDEX IF NOT EXISTS notification_sends_once
    ON notification_sends (user_id, kind, local_day);

CREATE INDEX IF NOT EXISTS notification_sends_recent
    ON notification_sends (sent_at);


ALTER TABLE users ADD COLUMN IF NOT EXISTS push_enabled   BOOLEAN     NOT NULL DEFAULT TRUE;

-- Backfilled to created_at so existing accounts are not all told to "come
-- back" the moment this ships.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
UPDATE users SET last_active_at = COALESCE(last_active_at, created_at, NOW()) WHERE last_active_at IS NULL;
ALTER TABLE users ALTER COLUMN last_active_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS users_last_active ON users (last_active_at);

COMMIT;
