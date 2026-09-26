-- 028: profile pictures live in the database, not on the server's disk
--
-- They were written to uploads/avatars on local disk. On the PC that was
-- fine; on Render the disk is thrown away on EVERY deploy, so each update
-- wiped every tester's picture and the app fell back to initials - which
-- testers reasonably reported as "profile pictures aren't working".
--
-- The phone already shrinks a picture to ~256x256 JPEG (tens of KB) before
-- uploading, so a bytea row is the simplest thing that survives a deploy with
-- no extra service to pay for or configure. users.photo_path keeps holding
-- the random file name, which is now this table's key; URLs are unchanged.
--
-- ON DELETE CASCADE: deleting an account removes its pictures with it.

CREATE TABLE IF NOT EXISTS photo_files (
    name        VARCHAR(64) PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime        VARCHAR(32) NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
    data        BYTEA       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_photo_files_user ON photo_files (user_id);
