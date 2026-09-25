/**
 * Neighbours: who else owns land around here.
 *
 *   GET /parcels/neighbours?lat&lng
 *
 * WHY THIS IS NOT PART OF /parcels/nearby
 * ---------------------------------------
 * `nearbyParcels` deliberately returns no owner identity, because a map that
 * labels each square with a name is a record of where somebody walks every
 * day. That decision stands. This endpoint gives the *feeling* of neighbours -
 * the world is inhabited, other people are near - without that being true:
 *
 *   * Names are NEVER attached to a square. You learn that four people own
 *     land around here; you cannot learn which square is whose.
 *   * The area is a FIXED ~1 km square (the same coarse grid visits use), not
 *     the caller's radius. Without this, anyone could binary-search a person's
 *     home by shrinking the radius until they dropped out of the list.
 *   * A square with fewer than MIN_NEIGHBOURS distinct owners names nobody.
 *     In an empty area, naming the one other person there WOULD locate them
 *     to within a kilometre.
 *
 * The result is roughly what a local leaderboard already tells you - "these
 * people play near you" - and nothing more precise.
 */
import { query } from '../db/pool';
import { cellForLatLng } from '../game/grid';

/** Sides of the ~1 km aggregation square, in degrees x100 (as visits use). */
const PLACE_SCALE = 100;

/** Below this many distinct owners, the square names nobody. */
export const MIN_NEIGHBOURS = 2;

/** Never return more than this many names. */
const MAX_NAMES = 12;

export interface Neighbour {
  username: string;
  title: string | null;
  jerseyColor: string;
  /** How much land they hold in this square. Never where it is. */
  parcels: number;
}

export interface NeighboursResult {
  /** Distinct other owners with land in this ~1 km square. */
  count: number;
  /** Named only when `count >= MIN_NEIGHBOURS`; otherwise empty. */
  neighbours: Neighbour[];
  /** Squares in this area that belong to somebody - including yours. */
  claimedHere: number;
  /** How many of those are yours. */
  yoursHere: number;
}

/**
 * The corners of the ~1 km square containing this position, as grid cells.
 *
 * Snapping to a fixed lat/lng lattice (not to the caller's position) is what
 * makes the resolution constant: two people standing 50 m apart get the same
 * square, and therefore the same answer.
 */
function placeBounds(lat: number, lng: number) {
  const south = Math.round(lat * PLACE_SCALE - 0.5) / PLACE_SCALE;
  const west = Math.round(lng * PLACE_SCALE - 0.5) / PLACE_SCALE;
  const north = south + 1 / PLACE_SCALE;
  const east = west + 1 / PLACE_SCALE;

  // Convert the two opposite corners into grid cells. The grid's y axis runs
  // opposite to latitude in Web Mercator, so normalise with min/max rather
  // than assuming which corner is which.
  const a = cellForLatLng(south, west);
  const b = cellForLatLng(north, east);
  return {
    minX: Math.min(a.cellX, b.cellX),
    maxX: Math.max(a.cellX, b.cellX),
    minY: Math.min(a.cellY, b.cellY),
    maxY: Math.max(a.cellY, b.cellY),
  };
}

export async function neighboursHere(userId: string, lat: number, lng: number): Promise<NeighboursResult> {
  const { minX, maxX, minY, maxY } = placeBounds(lat, lng);

  const r = await query<{
    owner_id: string;
    username: string;
    title: string | null;
    jersey_color: string;
    parcels: number;
  }>(
    `SELECT p.owner_id, u.username, u.title, u.jersey_color, COUNT(*)::int AS parcels
       FROM parcels p
       JOIN users u ON u.id = p.owner_id
      WHERE p.cell_x BETWEEN $1 AND $2
        AND p.cell_y BETWEEN $3 AND $4
      GROUP BY p.owner_id, u.username, u.title, u.jersey_color
      ORDER BY parcels DESC, u.username ASC
      LIMIT 200`,
    [minX, maxX, minY, maxY],
  );

  const mine = r.rows.find((row) => row.owner_id === userId);
  const others = r.rows.filter((row) => row.owner_id !== userId);
  const claimedHere = r.rows.reduce((n, row) => n + row.parcels, 0);

  return {
    count: others.length,
    // k-anonymity: one neighbour in an empty square is a located person.
    neighbours:
      others.length >= MIN_NEIGHBOURS
        ? others.slice(0, MAX_NAMES).map((row) => ({
            username: row.username,
            title: row.title,
            jerseyColor: row.jersey_color,
            parcels: row.parcels,
          }))
        : [],
    claimedHere,
    yoursHere: mine?.parcels ?? 0,
  };
}
