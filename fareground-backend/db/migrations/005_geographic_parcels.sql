-- ===========================================================================
--  005 - Parcels get a place on Earth.
--
--  Until now a parcel was an abstract thing you bought. From here on it is a
--  specific square of real ground, identified by its cell on the world grid
--  (see src/game/grid.ts), and each square can have ONE owner, ever.
--
--  That last rule is what makes the world finite and claiming competitive,
--  and it is enforced by the database itself: a unique index on the cell. Two
--  players tapping "claim" on the same square in the same millisecond cannot
--  both succeed - one INSERT wins, the other gets a unique violation, and its
--  whole transaction (including the Walk Points it spent) rolls back.
--
--  Parcels created before this migration have no location. They keep earning,
--  they simply do not appear on the map.
-- ===========================================================================

BEGIN;

ALTER TABLE parcels ADD COLUMN IF NOT EXISTS cell_x BIGINT;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS cell_y BIGINT;

-- Where the player actually stood when claiming. Kept for audit and for the
-- GPS-spoofing checks to come, not for drawing - the map draws from cell_x/y.
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS claimed_lat DOUBLE PRECISION;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS claimed_lng DOUBLE PRECISION;
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS claimed_accuracy_m REAL;

DO $$
BEGIN
    -- A parcel has either all of its location or none of it.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_location_complete') THEN
        ALTER TABLE parcels ADD CONSTRAINT parcels_location_complete CHECK (
            (cell_x IS NULL AND cell_y IS NULL AND claimed_lat IS NULL AND claimed_lng IS NULL)
            OR
            (cell_x IS NOT NULL AND cell_y IS NOT NULL AND claimed_lat IS NOT NULL AND claimed_lng IS NOT NULL)
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'parcels_claimed_position_valid') THEN
        ALTER TABLE parcels ADD CONSTRAINT parcels_claimed_position_valid CHECK (
            claimed_lat IS NULL
            OR (claimed_lat BETWEEN -90 AND 90 AND claimed_lng BETWEEN -180 AND 180)
        );
    END IF;
END
$$;

-- ONE OWNER PER SQUARE OF THE PLANET. Partial, so the old location-less
-- parcels do not collide with each other.
--
-- It also serves the map: "every parcel between these cells" is a range scan
-- on this index, so no geo extension (PostGIS) is needed at all.
CREATE UNIQUE INDEX IF NOT EXISTS parcels_one_owner_per_cell
    ON parcels (cell_x, cell_y)
    WHERE cell_x IS NOT NULL;

COMMIT;
