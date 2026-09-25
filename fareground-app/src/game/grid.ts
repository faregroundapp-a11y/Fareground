/**
 * ===========================================================================
 *  THE WORLD GRID - how a GPS position becomes a claimable parcel.
 * ===========================================================================
 *  The whole planet is divided into square cells, and each cell can have
 *  exactly one owner, ever. A cell is identified by two integers (cellX, cellY)
 *  and that pair is the parcel's primary identity in the database.
 *
 *  WHY WEB MERCATOR
 *  Every mainstream map SDK (MapLibre, Google, Apple) draws the world in the
 *  Web Mercator projection (EPSG:3857). If the grid is square in THAT space,
 *  then on the player's screen every cell is an exact square, the grid lines
 *  are perfectly straight, and the phone can draw the grid itself from two
 *  integers - no server round trip, no geometry download.
 *
 *  THE TRADE-OFF, stated honestly: Mercator stretches as you move away from
 *  the equator, so a cell's REAL size on the ground varies with latitude:
 *
 *      equator          14.0 m
 *      40 deg (NYC)     10.7 m
 *      51.5 deg (London) 8.7 m
 *      60 deg (Oslo)     7.0 m
 *
 *  For a game that is fine - a parcel is "the square under your feet" and
 *  nobody measures it. The alternative (true equal-area cells) makes cells
 *  render as skewed shapes on every map and costs far more code.
 *
 *  This file is DUPLICATED in the mobile app (fareground-app/src/game/grid.ts)
 *  so the phone can draw the grid without asking the server. The two MUST
 *  agree; the test vectors in grid.test.ts are the contract - copy them over
 *  whenever you change anything here.
 */

/** WGS84 radius used by Web Mercator, in metres. */
const EARTH_RADIUS = 6_378_137;

/** Edge length of one cell, in Web Mercator metres. */
export const CELL_SIZE_MERCATOR = 14;

/** Latitude beyond which Web Mercator is undefined (the map simply stops). */
export const MAX_LATITUDE = 85.05112878;

export interface Cell {
  cellX: number;
  cellY: number;
}

export interface CellBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

function toMercator(lat: number, lng: number): { x: number; y: number } {
  const clampedLat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));
  const x = EARTH_RADIUS * ((lng * Math.PI) / 180);
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360));
  return { x, y };
}

function fromMercator(x: number, y: number): { lat: number; lng: number } {
  const lng = (x / EARTH_RADIUS) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI);
  return { lat, lng };
}

/**
 * Snap to the nearest micrometre before flooring.
 *
 * Without this, floating point puts points that sit exactly on a grid line
 * into the wrong cell. The equator is the clearest case: tan(pi/4) evaluates
 * to 0.9999999999999999, its log is a hair below zero, and latitude 0 floors
 * into the cell SOUTH of the one whose bounds contain it. A GPS fix is never
 * better than a few metres, so a micrometre of snapping costs nothing.
 */
function snap(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** The cell containing a GPS position. */
export function cellForLatLng(lat: number, lng: number): Cell {
  const { x, y } = toMercator(lat, lng);
  // `+ 0` turns JavaScript's -0 (from snapping a tiny negative) into plain 0.
  return {
    cellX: Math.floor(snap(x) / CELL_SIZE_MERCATOR) + 0,
    cellY: Math.floor(snap(y) / CELL_SIZE_MERCATOR) + 0,
  };
}

/** The lat/lng rectangle a cell covers. */
export function cellBounds(cellX: number, cellY: number): CellBounds {
  const sw = fromMercator(cellX * CELL_SIZE_MERCATOR, cellY * CELL_SIZE_MERCATOR);
  const ne = fromMercator((cellX + 1) * CELL_SIZE_MERCATOR, (cellY + 1) * CELL_SIZE_MERCATOR);
  return { north: ne.lat, south: sw.lat, east: ne.lng, west: sw.lng };
}

/** The centre of a cell - where a parcel is stored as "being". */
export function cellCenter(cellX: number, cellY: number): { lat: number; lng: number } {
  return fromMercator((cellX + 0.5) * CELL_SIZE_MERCATOR, (cellY + 0.5) * CELL_SIZE_MERCATOR);
}

/** Real-world edge length of a cell at a given latitude, in metres. */
export function cellSizeMetres(lat: number): number {
  return CELL_SIZE_MERCATOR * Math.cos((lat * Math.PI) / 180);
}

/**
 * How many cells either side of a point cover `radiusMetres` of real ground.
 * Used to turn "parcels within 300 m" into an integer range query that the
 * (cell_x, cell_y) index can answer without any geo extension.
 */
export function cellRadius(lat: number, radiusMetres: number): number {
  return Math.ceil(radiusMetres / cellSizeMetres(lat));
}

/** Short human-readable reference, e.g. "-1147:8274203". */
export function cellRef(cellX: number, cellY: number): string {
  return `${cellX}:${cellY}`;
}
