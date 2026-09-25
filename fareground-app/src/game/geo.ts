import { cellCenter, cellForLatLng, cellRadius, type Cell } from './grid';

/**
 * How far from you a square can be and still be claimed, as SHOWN on the map.
 *
 * The server allows 40 m (MAX_CLAIM_DISTANCE_M in parcels.service.ts). The
 * phone offers a little less, so GPS drift between tapping a square and the
 * request arriving never turns a claim the map promised into a refusal.
 */
export const CLAIM_REACH_M = 35;

export const cellKey = (c: Cell) => `${c.cellX}:${c.cellY}`;
export const sameCell = (a: Cell | null, b: Cell | null) =>
  !!a && !!b && a.cellX === b.cellX && a.cellY === b.cellY;

/** Great-circle distance between two points, in metres. */
export function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Metres from a position to the centre of a square. */
export function distanceToCell(lat: number, lng: number, cell: Cell): number {
  const c = cellCenter(cell.cellX, cell.cellY);
  return metresBetween(lat, lng, c.lat, c.lng);
}

/**
 * Every free square within reach, and the nearest of them.
 *
 * The nearest one is what gets selected automatically - so standing on land
 * you already own (which is exactly the situation at home) still leaves a
 * one-tap claim for the square next door.
 */
export function claimableAround(
  lat: number,
  lng: number,
  taken: Set<string>,
  /** Reach in metres - wider while scouting (a rewarded ad). */
  reachM: number = CLAIM_REACH_M,
): { cells: Cell[]; nearest: Cell | null } {
  const me = cellForLatLng(lat, lng);
  const r = cellRadius(lat, reachM) + 1;
  const cells: Cell[] = [];
  let nearest: Cell | null = null;
  let best = Infinity;

  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      const cell = { cellX: me.cellX + dx, cellY: me.cellY + dy };
      if (taken.has(cellKey(cell))) continue;
      const d = distanceToCell(lat, lng, cell);
      if (d > reachM) continue;
      cells.push(cell);
      if (d < best) {
        best = d;
        nearest = cell;
      }
    }
  }
  return { cells, nearest };
}
