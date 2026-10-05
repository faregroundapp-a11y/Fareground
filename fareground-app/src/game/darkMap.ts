import type { StyleSpecification } from '@maplibre/maplibre-react-native';

/**
 * A DARK MAP (2026-10-05, tester request: "a dark mode for the map, like
 * Google Maps").
 *
 * WHY RECOLOUR AND NOT SWITCH STYLES. OpenFreeMap has its own dark style,
 * but it is a different, much smaller style: it has no 3D buildings and none
 * of the layer ids our parcels and grid are drawn under (WorldLayers anchors
 * on `waterway_line_label`). Recolouring "liberty" keeps every layer, label
 * and building exactly where it was and only changes the paint.
 *
 * HOW. Every colour in the style is flipped in lightness and kept in hue, so
 * pale land turns near-black, pale blue water turns deep blue and parks stay
 * green. Two exceptions make it read like a real dark map:
 *  - roads are lifted a little above the land, so streets show as lighter
 *    lines on the dark ground (a plain flip would draw them darker);
 *  - text becomes light with a dark halo.
 */

type Hsla = { h: number; s: number; l: number; a: number };

function hexToHsla(hex: string): Hsla | null {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return rgbToHsla(n(0), n(2), n(4), h.length === 8 ? n(6) : 1);
}

function rgbToHsla(r: number, g: number, b: number, a: number): Hsla {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l, a };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue: number;
  if (max === r) hue = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  return { h: hue * 60, s, l, a };
}

/** Parses the colour forms the style uses: #hex, rgb(a)() and hsl(a)(). */
function parse(v: string): Hsla | null {
  const s = v.trim();
  if (s.startsWith('#')) return hexToHsla(s);
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[2].split(',').map((p) => p.trim());
  if (parts.length < 3) return null;
  const num = (p: string) => parseFloat(p);
  const a = parts[3] !== undefined ? num(parts[3]) : 1;
  if (m[1].startsWith('rgb')) return rgbToHsla(num(parts[0]) / 255, num(parts[1]) / 255, num(parts[2]) / 255, a);
  return { h: num(parts[0]), s: num(parts[1]) / 100, l: num(parts[2]) / 100, a };
}

const pct = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10}%`;
const format = ({ h, s, l, a }: Hsla) => `hsla(${Math.round(h)}, ${pct(s)}, ${pct(l)}, ${Math.round(a * 1000) / 1000})`;

type Role = 'ground' | 'road' | 'text' | 'halo';

/** The new lightness for an old one, by what the colour is used for. */
function relight(c: Hsla, role: Role): Hsla {
  const inv = 1 - c.l;
  switch (role) {
    case 'road': // white roads -> a lifted grey above the ground
      return { ...c, s: c.s * 0.5, l: 0.17 + inv * 0.45 };
    case 'text': // dark labels -> light
      return { ...c, s: c.s * 0.6, l: 0.62 + inv * 0.3 };
    case 'halo':
      return { ...c, s: c.s * 0.4, l: 0.08 };
    default: // land, water, parks, buildings: flipped and kept dim
      return { ...c, s: c.s * 0.45, l: 0.09 + inv * 0.32 };
  }
}

/** Recolours every colour string inside a paint value (plain, stops or expression). */
function recolour(value: unknown, role: Role): unknown {
  if (typeof value === 'string') {
    const c = parse(value);
    return c ? format(relight(c, role)) : value;
  }
  if (Array.isArray(value)) return value.map((v) => recolour(v, role));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, recolour(v, role)]));
  }
  return value;
}

const ROAD_LAYER = /road|highway|bridge|tunnel|path|rail|aeroway_(runway|taxiway)/;

export function darkenStyle<S extends StyleSpecification>(style: S): S {
  return {
    ...style,
    layers: (style.layers ?? []).map((layer) => {
      const l = layer as { id: string; type: string; paint?: Record<string, unknown> };
      if (!l.paint) return layer;
      const paint: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(l.paint)) {
        if (!key.endsWith('color')) {
          paint[key] = value;
          continue;
        }
        const role: Role =
          key === 'text-color' || key === 'icon-color'
            ? 'text'
            : key === 'text-halo-color' || key === 'icon-halo-color'
              ? 'halo'
              : l.type === 'line' && ROAD_LAYER.test(l.id)
                ? 'road'
                : 'ground';
        paint[key] = recolour(value, role);
      }
      return { ...layer, paint };
    }),
  } as S;
}
