-- 023: multi-layered spoofing defence
--
-- Steps and location are the two things this game converts into value, so
-- they are the two things worth faking. Neither can be secured by a single
-- check: every individual signal here has an innocent explanation, and
-- several of them can be defeated on a rooted phone. The design assumes that
-- and leans on the fact that faking ALL of them CONSISTENTLY is much harder
-- than any one of them.
--
--   Layer 0  device integrity     attestation (still stubs - see security/)
--   Layer 1  plausibility         could a body have done this? (rules.ts)
--   Layer 2  displacement         did the ground move? -- answers SHAKING
--   Layer 3  physics              was the movement possible? -- answers TELEPORTS
--   Layer 4  correlation          do the signals agree with each other?
--   Layer 5  response             score, then throttle, then a human
--
-- This migration adds the storage layers 2-5 need.

-- ---------------------------------------------------------------------------
-- The last position we believe, per account.
--
-- ONE ROW PER USER, not a track. A full breadcrumb history of everyone who
-- plays would be the most sensitive thing in the database and is not needed:
-- catching a teleport only requires the PREVIOUS point and its timestamp.
-- Keeping less is both cheaper and the right call for a game that already
-- refuses to put names on the map.
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_fix_lat DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_fix_lng DOUBLE PRECISION;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_fix_at  TIMESTAMPTZ;

-- Running integrity score, and where it puts the account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS integrity_score INTEGER NOT NULL DEFAULT 0;

DO $$ BEGIN
    CREATE TYPE integrity_tier AS ENUM ('CLEAR', 'WATCH', 'THROTTLED', 'REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS integrity_tier integrity_tier NOT NULL DEFAULT 'CLEAR';

-- Set by a HUMAN, never by the system. The score can throttle an account on
-- its own; only a person clears one or bans one, because every signal feeding
-- the score has a false-positive story and a wrongly-banned honest player is
-- a far worse outcome than a farmer who has a thin week.
ALTER TABLE users ADD COLUMN IF NOT EXISTS integrity_reviewed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS integrity_exempt BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- Steps the ground could not account for.
--
-- Split out from step_logs because the daily cap is a rolling sum over it and
-- a dedicated column keeps that query cheap.
-- ---------------------------------------------------------------------------
ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS corroborated_steps INTEGER NOT NULL DEFAULT 0;
ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS uncorroborated_steps INTEGER NOT NULL DEFAULT 0;
-- Ground the phone's own trace covered over the same window. NULL means the
-- trace was unusable (indoors, permission off) - which is NOT evidence of
-- anything and is deliberately distinguishable from a reported zero.
ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS distance_m DOUBLE PRECISION;

-- ---------------------------------------------------------------------------
-- The evidence log.
--
-- One row per flagged event, with enough context for a human to judge it
-- months later. Deliberately append-only: it is the record an appeal is
-- decided from, so nothing in the system rewrites it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrity_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- What was happening: STEPS, CLAIM, PITSTOP, CHECKIN, TREASURE.
    action      VARCHAR(24) NOT NULL,
    flags       INTEGER NOT NULL,
    score       INTEGER NOT NULL,
    -- Free-form, for the numbers that made the call: speeds, ratios, counts.
    detail      JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrity_events_user
    ON integrity_events (user_id, created_at DESC);

-- Finding the accounts worth a human's time, cheaply.
CREATE INDEX IF NOT EXISTS idx_users_integrity
    ON users (integrity_score DESC)
    WHERE integrity_tier <> 'CLEAR';
