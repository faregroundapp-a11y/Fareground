-- 021: step integrity signals
--
-- The plausibility rules in rules.ts bound what is POSSIBLE. They cannot see
-- what is merely implausible: a count that arrives in identical lumps, at a
-- machine-perfect cadence, from a phone that never moves. Those are the marks
-- a shaker, a pendulum or a fake-steps app leaves and a person does not.
--
-- Nothing here refuses a sync on its own. Each flag is recorded on the row
-- that earned it, so the evidence is in the data before any policy is built
-- on top of it. A score that silently confiscated a real walker's Walk Points
-- would be far worse than a farmer getting away with it for a week.

-- What the phone said it was, so a count sourced from a third-party app that
-- WROTE steps into Health Connect is distinguishable from the OS's own
-- pedometer. This is the single most useful field here: the commonest
-- Android spoof is an app that writes fake records into the health store.
DO $$ BEGIN
    CREATE TYPE step_source AS ENUM ('DEVICE_SENSOR', 'HEALTH_STORE', 'MOTION_HISTORY', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS source step_source NOT NULL DEFAULT 'UNKNOWN';

-- A bitmask of the checks this batch tripped. A mask, not a boolean, because
-- one flag alone means very little and three together mean a great deal.
ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS integrity_flags INTEGER NOT NULL DEFAULT 0;

-- Whether the phone reported its location as mocked at the time of the sync.
-- Android exposes this; a spoofed GPS alongside a big step count is the
-- clearest signal there is. NULL means the app did not say.
ALTER TABLE step_logs ADD COLUMN IF NOT EXISTS mocked_location BOOLEAN;

-- Rolling count of flagged syncs, so a query does not have to scan the log to
-- answer "is this account worth looking at". Advisory only - nothing gates on
-- it yet, deliberately.
ALTER TABLE users ADD COLUMN IF NOT EXISTS step_flag_count INTEGER NOT NULL DEFAULT 0;

-- Finding the flagged rows is the whole point, so make it cheap. Partial, so
-- the index only covers rows that tripped something - which should be almost
-- none of them.
CREATE INDEX IF NOT EXISTS idx_step_logs_flagged
    ON step_logs (user_id, logged_at DESC)
    WHERE integrity_flags <> 0;
