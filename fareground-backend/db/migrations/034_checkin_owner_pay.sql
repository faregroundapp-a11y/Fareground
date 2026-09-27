-- ===========================================================================
--  034 - Check-ins pay the parcel's owner too (2026-09-27).
--
--  The doorbell became a check-in: the visitor earns 5 WP and the owner 3.
--  Each pit_stops row now records who owned the land and what they were paid,
--  which is also how the owner's daily cap (CHECKIN_OWNER_DAILY_MAX) is
--  counted. Old rows keep 0: nobody was paid as an owner before today.
-- ===========================================================================

ALTER TABLE pit_stops ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE pit_stops ADD COLUMN IF NOT EXISTS owner_wp INTEGER NOT NULL DEFAULT 0 CHECK (owner_wp >= 0);

CREATE INDEX IF NOT EXISTS idx_pit_stops_owner_day ON pit_stops (owner_id, created_at) WHERE owner_wp > 0;
