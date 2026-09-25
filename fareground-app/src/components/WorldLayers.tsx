import { GeoJSONSource, Layer, type FillExtrusionLayerSpecification } from '@maplibre/maplibre-react-native';
import { useMemo } from 'react';
import type { NearbyParcel } from '@/api/types';
import { CLAIM_REACH_M } from '@/game/geo';
import { cellBounds, type Cell } from '@/game/grid';
import { MINERALS, MINERAL_ORDER } from '@/game/minerals';
import { colors } from '@/theme';

/** How many cells either side of the player the grid is drawn for. */
const GRID_RADIUS = 18;

/**
 * Style layers from the base map that ours should sit BELOW, so street and
 * place names stay readable on top of buildings and parcels.
 * (First label layer in OpenFreeMap's "liberty" style.)
 */
const FIRST_LABEL_LAYER = 'waterway_line_label';

type Ring = [number, number][];

/** A circle of `radiusM` metres around a point, as a GeoJSON ring. */
function circleRing(lat: number, lng: number, radiusM: number, steps = 64): Ring {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const ring: Ring = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    ring.push([lng + Math.cos(a) * dLng, lat + Math.sin(a) * dLat]);
  }
  return ring;
}

function cellRing(cellX: number, cellY: number): Ring {
  const b = cellBounds(cellX, cellY);
  return [[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]];
}

/**
 * The parcel grid around the player, drawn by the PHONE from the shared grid
 * maths. The grid is square in Web Mercator, so every boundary is a straight
 * meridian or parallel and each line needs just two points.
 */
function gridLines(centre: Cell): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const x0 = centre.cellX - GRID_RADIUS, x1 = centre.cellX + GRID_RADIUS + 1;
  const y0 = centre.cellY - GRID_RADIUS, y1 = centre.cellY + GRID_RADIUS + 1;
  const south = cellBounds(centre.cellX, y0).south;
  const north = cellBounds(centre.cellX, y1 - 1).north;
  const west = cellBounds(x0, centre.cellY).west;
  const east = cellBounds(x1 - 1, centre.cellY).east;

  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (let x = x0; x <= x1; x++) {
    const lng = cellBounds(x, centre.cellY).west;
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lng, south], [lng, north]] } });
  }
  for (let y = y0; y <= y1; y++) {
    const lat = cellBounds(centre.cellX, y).south;
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[west, lat], [east, lat]] } });
  }
  return { type: 'FeatureCollection', features };
}

/**
 * The style-expression type, from a type the MapLibre package re-exports - so
 * no extra dependency (the style-spec package drags in a react-dom peer that
 * conflicts with the React version Expo pins).
 */
type Expression = Extract<NonNullable<FillExtrusionLayerSpecification['paint']>['fill-extrusion-color'], unknown[]>;

/** A style expression mapping a feature's mineral to one of its attributes. */
function byMineral(pick: (m: (typeof MINERALS)[keyof typeof MINERALS]) => string | number): Expression {
  const cases: (string | number)[] = [];
  for (const key of MINERAL_ORDER) cases.push(key, pick(MINERALS[key]));
  // ['match', input, label1, out1, ..., fallback]. TypeScript cannot express a
  // match with a variable number of pairs, hence the one cast via unknown.
  return ['match', ['get', 'rarity'], ...cases, pick(MINERALS.ROCKY)] as unknown as Expression;
}

export function WorldLayers({
  playerCell,
  player,
  parcels,
  claimable,
  selected,
  selectedIsFree,
  hideCell,
  reachM = CLAIM_REACH_M,
}: {
  playerCell: Cell;
  /** Where the player is - the centre of the reach circle. */
  player: { lat: number; lng: number };
  parcels: NearbyParcel[];
  /** Free squares within reach - lightly lit so you can see what is on offer. */
  claimable: Cell[];
  /** The square the claim button will claim (or the one you tapped to inspect). */
  selected: Cell | null;
  selectedIsFree: boolean;
  /** A cell currently being animated by ClaimFx - skip it so it is not drawn twice. */
  hideCell: Cell | null;
  /** How far you can claim - wider while scouting. */
  reachM?: number;
}) {
  const grid = useMemo(() => gridLines(playerCell), [playerCell]);

  const owned = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features: parcels
        .filter((p) => !hideCell || p.cellX !== hideCell.cellX || p.cellY !== hideCell.cellY)
        .map((p) => ({
          type: 'Feature',
          properties: { rarity: p.rarity, mine: p.mine },
          geometry: { type: 'Polygon', coordinates: [cellRing(p.cellX, p.cellY)] },
        })),
    }),
    [parcels, hideCell],
  );

  const reach = useMemo<GeoJSON.Feature<GeoJSON.Polygon>>(
    () => ({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [circleRing(player.lat, player.lng, reachM)] },
    }),
    [player.lat, player.lng, reachM],
  );

  const offer = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features: claimable.map((c) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [cellRing(c.cellX, c.cellY)] },
      })),
    }),
    [claimable],
  );

  const pick = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon>>(
    () => ({
      type: 'FeatureCollection',
      features: selected
        ? [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'Polygon', coordinates: [cellRing(selected.cellX, selected.cellY)] },
          }]
        : [],
    }),
    [selected],
  );

  return (
    <>
      <GeoJSONSource id="grid" data={grid}>
        <Layer
          id="grid-lines"
          type="line"
          beforeId={FIRST_LABEL_LAYER}
          paint={{
            'line-color': colors.grid,
            'line-width': ['interpolate', ['linear'], ['zoom'], 16.5, 0.6, 19, 1.4],
            // invisible when zoomed out - at neighbourhood scale it is noise
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 16.2, 0, 17.2, 0.5],
          }}
        />
      </GeoJSONSource>

      {/* Claimed ground stands UP out of the map, taller for rarer minerals.
          Yours are solid; other players' are ghosted. */}
      <GeoJSONSource id="parcels" data={owned}>
        <Layer
          id="parcels-others"
          type="fill-extrusion"
          filter={['==', ['get', 'mine'], false]}
          paint={{
            'fill-extrusion-color': byMineral((m) => m.color),
            'fill-extrusion-height': byMineral((m) => m.heightM * 0.5),
            'fill-extrusion-opacity': 0.4,
          }}
        />
        <Layer
          id="parcels-mine-glow"
          type="fill"
          filter={['==', ['get', 'mine'], true]}
          paint={{ 'fill-color': byMineral((m) => m.color), 'fill-opacity': 0.25 }}
        />
        <Layer
          id="parcels-mine"
          type="fill-extrusion"
          filter={['==', ['get', 'mine'], true]}
          paint={{
            'fill-extrusion-color': byMineral((m) => m.color),
            'fill-extrusion-height': byMineral((m) => m.heightM),
            'fill-extrusion-opacity': 0.92,
          }}
        />
      </GeoJSONSource>

      {/* How far you can reach from where you stand. */}
      <GeoJSONSource id="reach" data={reach}>
        <Layer id="reach-fill" type="fill" beforeId={FIRST_LABEL_LAYER} paint={{ 'fill-color': colors.claim, 'fill-opacity': 0.06 }} />
        <Layer
          id="reach-edge"
          type="line"
          beforeId={FIRST_LABEL_LAYER}
          paint={{ 'line-color': colors.claim, 'line-width': 2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] }}
        />
      </GeoJSONSource>

      {/* Every free square you could claim from here. */}
      <GeoJSONSource id="offer" data={offer}>
        <Layer id="offer-fill" type="fill" beforeId={FIRST_LABEL_LAYER} paint={{ 'fill-color': colors.claimHi, 'fill-opacity': 0.16 }} />
      </GeoJSONSource>

      {/* The chosen square: solid amber if you can take it, a white outline if
          you are just looking at somebody's land. */}
      <GeoJSONSource id="pick" data={pick}>
        <Layer
          id="pick-fill"
          type="fill"
          paint={{ 'fill-color': selectedIsFree ? colors.claim : '#FFFFFF', 'fill-opacity': selectedIsFree ? 0.45 : 0.15 }}
        />
        <Layer
          id="pick-outline"
          type="line"
          paint={{ 'line-color': selectedIsFree ? colors.claimDeep : '#FFFFFF', 'line-width': 3.5 }}
        />
      </GeoJSONSource>
    </>
  );
}
