-- ---------------------------------------------------------------------------
--  019 - Profile photos.
--
--  Until now there were no uploaded images anywhere in Fareground, on purpose:
--  nothing to host, and nothing to moderate. The product owner asked for real
--  photos, so this adds them WITH the machinery that makes them defensible:
--
--    users.photo_path         where the file lives, relative to the upload dir
--    users.photo_updated_at   when it last changed (one ad per change)
--    users.photo_removed_at   taken down by a moderator; the row remembers
--    photo_reports            who reported whom, and why
--
--  WHAT WHOEVER OPERATES THIS MUST KNOW
--  Google Play requires user-generated image content to have (a) a way to
--  report it, (b) a way for the operator to remove it, and (c) a way to block
--  a user. (a) and (b) are here. There is no automated scanning: every report
--  lands in `photo_reports` and a human has to look. If this ever has more
--  than a handful of players, that stops being a workable process - budget for
--  an image-moderation API before it does.
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_path       VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_updated_at TIMESTAMPTZ;

-- Set when a moderator takes an image down. The path is cleared at the same
-- time (so it stops being served) but this stays, so a repeat offender is
-- visible rather than looking like a first-timer.
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_removed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_strikes    INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS photo_reports (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Who was reported. Cascades: deleting an account clears its reports.
    subject_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reporter_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- The path AS REPORTED. The subject may change their photo a second
    -- later; a report has to point at the thing that was actually seen.
    reported_path VARCHAR(255),
    reason        VARCHAR(32)  NOT NULL,
    note          VARCHAR(500),

    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    handled_at    TIMESTAMPTZ,
    handled_note  VARCHAR(500)
);

-- One open report per reporter per subject: a pile-on tells a moderator
-- nothing that a single report does not.
CREATE UNIQUE INDEX IF NOT EXISTS photo_reports_one_open
    ON photo_reports (subject_id, reporter_id) WHERE handled_at IS NULL;

-- The moderator's queue: everything unhandled, oldest first.
CREATE INDEX IF NOT EXISTS photo_reports_queue
    ON photo_reports (created_at) WHERE handled_at IS NULL;

COMMIT;
