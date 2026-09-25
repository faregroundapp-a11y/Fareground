import { GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { useEffect, useState } from 'react';
import type { Mineral } from '@/api/types';
import { cellBounds, cellCenter } from '@/game/grid';
import { MINERALS } from '@/game/minerals';

/**
 * The claim, as it happens ON the map.
 *
 * The square erupts out of the ground - overshooting its final height and
 * settling back, like something with weight - while shockwave rings roll out
 * across the street from it. This lives in the map itself rather than as an
 * overlay, so it is correctly in perspective, rotates with the world and sits
 * behind buildings.
 */

export const CLAIM_FX_MS = 1700;

export interface ClaimFxSpec {
  cellX: number;
  cellY: number;
  rarity: Mineral;
  key: number;
}

/** A circle of `radiusM` metres around a point, as a GeoJSON ring. */
function circle(lat: number, lng: number, radiusM: number, steps = 40): [number, number][] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
  }
  return ring;
}

/** Springy rise: overshoots to ~130 % then settles at 1. */
function rise(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.exp(-7 * t) * Math.cos(9 * t);
}

export function ClaimFx({ spec }: { spec: ClaimFxSpec }) {
  const [t, setT] = useState(0);

  useEffect(() => {
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (Date.now() - start) / CLAIM_FX_MS);
      setT(k);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spec.key]);

  const m = MINERALS[spec.rarity];
  const b = cellBounds(spec.cellX, spec.cellY);
  const c = cellCenter(spec.cellX, spec.cellY);

  // The block: rises in the first half, then holds.
  const height = m.heightM * rise(t * 1.6);
  const block: GeoJSON.Feature<GeoJSON.Polygon> = {
    type: 'Feature',
    properties: { h: Math.max(0.01, height) },
    geometry: {
      type: 'Polygon',
      coordinates: [[[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]]],
    },
  };

  // Three shockwave rings, staggered, each growing and fading.
  const rings: GeoJSON.Feature<GeoJSON.LineString>[] = [0, 0.14, 0.28].flatMap((delay) => {
    const p = (t - delay) / 0.7;
    if (p <= 0 || p >= 1) return [];
    const eased = 1 - Math.pow(1 - p, 3);
    return [{
      type: 'Feature',
      properties: { o: (1 - p) * 0.9, w: 5 * (1 - p) + 1 },
      geometry: { type: 'LineString', coordinates: circle(c.lat, c.lng, 4 + eased * 38) },
    }];
  });

  return (
    <>
      <GeoJSONSource id="claim-rings" data={{ type: 'FeatureCollection', features: rings }}>
        <Layer
          id="claim-rings-line"
          type="line"
          paint={{ 'line-color': m.color, 'line-opacity': ['get', 'o'], 'line-width': ['get', 'w'], 'line-blur': 1 }}
        />
      </GeoJSONSource>
      <GeoJSONSource id="claim-block" data={block}>
        <Layer
          id="claim-block-glow"
          type="fill"
          paint={{ 'fill-color': m.color, 'fill-opacity': 0.35 * (1 - t) + 0.1 }}
        />
        <Layer
          id="claim-block-3d"
          type="fill-extrusion"
          paint={{ 'fill-extrusion-color': m.color, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95 }}
        />
      </GeoJSONSource>
    </>
  );
}
