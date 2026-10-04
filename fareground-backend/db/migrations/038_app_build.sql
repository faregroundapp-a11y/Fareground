-- 038 - The app build each player last played on (2026-10-04). Players still
-- on a build older than MIN_APP_BUILD are left off the leaderboards and out
-- of the weekly prizes until they update.
ALTER TABLE users ADD COLUMN IF NOT EXISTS app_build INTEGER;
