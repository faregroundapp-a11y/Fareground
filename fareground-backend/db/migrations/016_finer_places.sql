-- ---------------------------------------------------------------------------
--  016 - Visits: finer places.
--
--  A "place" was a ~1 km square (lat/lng x 100). That is far too coarse for a
--  game played on foot: the park, the station and the shop 400 m away were
--  all the same place, so a second visit was refused with "you have already
--  visited here today - walk somewhere new" when the player demonstrably had.
--
--  Places are now ~250 m squares (lat/lng x 400). In London that is roughly
--  280 m north-south by 170 m east-west - about a block, which is what a
--  person means by "somewhere else".
--
--  WHY A SCALE COLUMN RATHER THAN REWRITING THE ROWS
--  -------------------------------------------------
--  A scale-100 square contains sixteen scale-400 squares, and the row does
--  not say which one the player was in - that precision was never stored.
--  Rewriting would be inventing data. So every row records the scale it was
--  written at, and "have I been here before" only ever compares like with
--  like. Old rows stay true about what they recorded; they simply describe a
--  coarser world.
-- ---------------------------------------------------------------------------

BEGIN;

-- Existing rows were all written at the old scale.
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS place_scale SMALLINT NOT NULL DEFAULT 100;

-- New rows come in at the finer scale. (The default only affects inserts that
-- omit the column; the service always sends it explicitly.)
ALTER TABLE checkins ALTER COLUMN place_scale SET DEFAULT 400;

-- The "is this somewhere new?" lookup is now scale-aware, so the index must be
-- too, or every check scans the old rows as well.
DROP INDEX IF EXISTS idx_checkins_user_place;
CREATE INDEX IF NOT EXISTS idx_checkins_user_place
    ON checkins (user_id, place_scale, place_x, place_y);

COMMIT;
