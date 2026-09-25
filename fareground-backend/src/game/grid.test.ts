/**
 * Tests for the world grid.
 *
 * The VECTORS below are a contract between the server and the mobile app,
 * which carries its own copy of grid.ts. If they disagree about which cell a
 * position is in, a player sees one parcel under their feet and claims another.
 * Change grid.ts -> regenerate these -> paste them into the app's copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cellBounds,
  cellCenter,
  cellForLatLng,
  cellRadius,
  cellSizeMetres,
} from './grid';

export const GRID_VECTORS = [
  { name: 'London',         lat: 51.5129,  lng: -0.1471,  cellX: -1170,   cellY: 479466 },
  { name: 'New York',       lat: 40.758,   lng: -73.9855, cellX: -588288, cellY: 355479 },
  { name: 'Sydney',         lat: -33.8568, lng: 151.2153, cellX: 1202372, cellY: -286400 },
  { name: 'Null Island',    lat: 0,        lng: 0,        cellX: 0,       cellY: 0 },
  { name: 'just NW of 0,0', lat: 0.00001,  lng: -0.00001, cellX: -1,      cellY: 0 },
] as const;

test('known positions land in the agreed cells', () => {
  for (const v of GRID_VECTORS) {
    assert.deepEqual(cellForLatLng(v.lat, v.lng), { cellX: v.cellX, cellY: v.cellY }, v.name);
  }
});

test('every position lies inside the bounds of the cell it maps to', () => {
  // The round trip that the equator case used to break.
  for (const v of GRID_VECTORS) {
    const c = cellForLatLng(v.lat, v.lng);
    const b = cellBounds(c.cellX, c.cellY);
    assert.ok(v.lat >= b.south - 1e-12 && v.lat < b.north, `${v.name} lat outside its cell`);
    assert.ok(v.lng >= b.west - 1e-12 && v.lng < b.east, `${v.name} lng outside its cell`);
  }
});

test('a cell centre maps back to the same cell', () => {
  for (const v of GRID_VECTORS) {
    const centre = cellCenter(v.cellX, v.cellY);
    assert.deepEqual(cellForLatLng(centre.lat, centre.lng), { cellX: v.cellX, cellY: v.cellY });
  }
});

test('ten thousand random positions all round-trip', () => {
  for (let i = 0; i < 10_000; i++) {
    const lat = (Math.random() * 2 - 1) * 80;
    const lng = (Math.random() * 2 - 1) * 180;
    const c = cellForLatLng(lat, lng);
    const b = cellBounds(c.cellX, c.cellY);
    assert.ok(lat >= b.south - 1e-9 && lat <= b.north + 1e-9, `lat ${lat}`);
    assert.ok(lng >= b.west - 1e-9 && lng <= b.east + 1e-9, `lng ${lng}`);
  }
});

test('cells are roughly nine metres across in London', () => {
  const size = cellSizeMetres(51.5129);
  assert.ok(size > 8.5 && size < 9, `got ${size.toFixed(2)} m`);
});

test('a 300 m radius is a sensible number of cells', () => {
  // Guards the /parcels/nearby query from being asked for a million cells.
  const r = cellRadius(51.5129, 300);
  assert.ok(r > 30 && r < 40, `got ${r}`);
});

test("the mobile app's copy of grid.ts is identical to this one", async () => {
  // The phone draws the grid and highlights "the square you are on" using
  // its own copy of this file. If the copies drift, the player is shown one
  // square and the server claims another. So: byte-identical, or fail.
  const { readFile, access } = await import('node:fs/promises');
  const path = await import('node:path');
  const here = path.resolve(__dirname, 'grid.ts');
  const app = path.resolve(__dirname, '../../../fareground-app/src/game/grid.ts');

  try {
    await access(app);
  } catch {
    return; // app not checked out alongside - nothing to compare
  }
  const [a, b] = await Promise.all([readFile(here, 'utf8'), readFile(app, 'utf8')]);
  assert.equal(b, a, 'fareground-app/src/game/grid.ts has drifted - copy this file over it');
});
