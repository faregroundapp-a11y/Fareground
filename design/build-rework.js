// Builds rework.html: today's character next to three polished versions of
// it. Same three-quarter runner, same original face (dot eyes, small smile);
// better body, clothes, hair and shading.
const fs = require('fs');
const S = '/tmp/claude-0/-home-user-Fareground/bb0f6094-9845-5b93-a9b3-45d8e56f1b29/scratchpad/av';
const { load, React, renderToStaticMarkup, APP } = require(S + '/harness');
const { Runner } = load(APP + '/src/components/Runner.tsx');
const { AvatarPortrait } = load(APP + '/src/components/AvatarPortrait.tsx');
const R = (C, p) => renderToStaticMarkup(React.createElement(C, p));

const INK = '#14201A';
const L = 'stroke-linejoin="round" stroke-linecap="round"';
const shade = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
};

/* The shared look: skin, hair colour, shirt, trousers, shoes, hat (optional). */
const LOOKS = {
  default: { skin: '#E7B48C', hair: '#2B2018', shirt: '#2F5D50', pants: '#3B4A68', shoe: '#FFFFFF', trim: '#F2A93B', hat: null },
  violet: { skin: '#F4D3B8', hair: '#C2551F', shirt: '#7E56A6', pants: '#2B3750', shoe: '#E8EBEF', trim: '#2A5FA8', hat: null },
  ruby: { skin: '#8A5533', hair: '#141A2B', shirt: '#C0304A', pants: '#3B4048', shoe: '#C0304A', trim: '#FFFFFF', hat: '#F2A93B' },
  ocean: { skin: '#D79A69', hair: '#E0B93C', shirt: '#1F7A8C', pants: '#3B4A68', shoe: '#4DBE94', trim: '#141A2B', hat: '#2A5FA8' },
};

/* ------------------------------------------------------------------ */
/* POLISHED - today's shapes, finished properly: shaded body, collar,  */
/* sleeves with hands, cuffed trousers, real trainers, hair with shine. */
/* ------------------------------------------------------------------ */
function polished(lk, scale = 1) {
  const { skin, hair, shirt, pants, shoe, trim, hat } = lk;
  return `<svg viewBox="0 0 64 84" width="${64 * scale}" height="${84 * scale}">
  <ellipse cx="32" cy="77" rx="13" ry="3.2" fill="#0B1410" opacity=".2"/>
  <!-- far leg + shoe -->
  <path d="M30 55l-2 16" stroke="${INK}" stroke-width="9.6" ${L}/><path d="M30 55l-2 16" stroke="${shade(pants, 0.8)}" stroke-width="7" ${L}/>
  <path d="M24 71.5h7.5q3 0 3 3H24.5q-1.6 0-.5-3z" fill="${shade(shoe, 0.85)}" stroke="${INK}" stroke-width="1.3" ${L}/>
  <!-- far arm -->
  <path d="M27 43l-3 10" stroke="${INK}" stroke-width="7.4" ${L}/><path d="M27 43l-3 10" stroke="${shade(shirt, 0.75)}" stroke-width="5" ${L}/>
  <!-- torso: rounded, shaded on the far side, with a collar and hem -->
  <rect x="24" y="37" width="16.5" height="21" rx="7.5" fill="${shirt}" stroke="${INK}" stroke-width="1.5"/>
  <path d="M24.8 44v7q0 5 5 6h-1q-4.8-1-4-13z" fill="#000" opacity=".16"/>
  <path d="M28.5 38.4q3.8 3 7.6 0" fill="none" stroke="${shade(shirt, 0.65)}" stroke-width="1.6" ${L}/>
  <path d="M25 54.5h15" stroke="${shade(shirt, 0.7)}" stroke-width="1.4"/>
  <path d="M37.5 41v12" stroke="#fff" stroke-width="1.4" opacity=".25" ${L}/>
  <!-- near leg: trousers with a turned-up cuff, then the trainer -->
  <path d="M34 55l1 16" stroke="${INK}" stroke-width="10" ${L}/><path d="M34 55l1 16" stroke="${pants}" stroke-width="7.4" ${L}/>
  <path d="M31.6 69.6h7" stroke="${shade(pants, 0.75)}" stroke-width="2"/>
  <path d="M31.2 71.4h8.4q3.6 0 3.8 3.6H31.6q-1.8 0-.4-3.6z" fill="${shoe}" stroke="${INK}" stroke-width="1.4" ${L}/>
  <path d="M31.5 73.6h11.4" stroke="${trim}" stroke-width="1.3" ${L}/>
  <!-- near arm: sleeve then hand -->
  <path d="M37.5 42.5l3.5 9" stroke="${INK}" stroke-width="7.6" ${L}/><path d="M37.5 42.5l3.5 9" stroke="${shirt}" stroke-width="5.2" ${L}/>
  <circle cx="41.6" cy="53.2" r="2.9" fill="${skin}" stroke="${INK}" stroke-width="1.2"/>
  <!-- head -->
  <circle cx="33" cy="26" r="12.3" fill="${INK}"/><circle cx="33" cy="26" r="11.2" fill="${skin}"/>
  <path d="M22 28a11.2 11.2 0 0 0 16 9.2q-11 0-16-9.2z" fill="#000" opacity=".1"/>
  ${hairOrHat(hair, hat, 33, 26, 11.2)}
  <!-- the ORIGINAL face: two dot eyes -->
  <circle cx="34" cy="28.6" r="1.75" fill="#1B2330"/><circle cx="39.1" cy="28.6" r="1.75" fill="#1B2330"/>
</svg>`;
}
function hairOrHat(hair, hat, x, y, r, fuller = 0) {
  const hairPath = `M${x + r * 0.86} ${y - r * 0.48}A${r + 0.6 + fuller} ${r + 0.6 + fuller} 0 1 0 ${x - r * 0.98} ${y + r * 0.3}Q${x - r * 0.55} ${y + r * 0.05} ${x - r * 0.28} ${y - r * 0.3}Q${x + r * 0.2} ${y - r * 0.7} ${x + r * 0.86} ${y - r * 0.48}z`;
  const hairEl = `<path d="${hairPath}" fill="${hair}" stroke="${INK}" stroke-width="1.3" ${L}/>
    <path d="M${x - r * 0.5} ${y - r * 0.62}q${r * 0.4} -${r * 0.32} ${r * 0.85} -${r * 0.18}" fill="none" stroke="#fff" stroke-width="1.3" opacity=".3" ${L}/>`;
  if (!hat) return hairEl;
  return hairEl + `<path d="M${x - r - 0.6} ${y - 1.6}C${x - r} ${y - r * 1.3} ${x + r} ${y - r * 1.3} ${x + r + 0.6} ${y - 1.6}z" fill="${hat}" stroke="${INK}" stroke-width="1.4" ${L}/>
    <path d="M${x + r * 0.35} ${y - 3}h${r * 0.65 + 5}q1.6 0 1.2 1.4q-.4 1 -2 1h-${r * 0.65 + 4.2}z" fill="${hat}" stroke="${INK}" stroke-width="1.3" ${L}/>
    <circle cx="${x - 1}" cy="${y - r + 1}" r="1.1" fill="${INK}"/>`;
}

/* ------------------------------------------------------------------ */
/* ROUNDER - softer and cuter: a bigger head, a bean-shaped body,      */
/* stubby legs and mitten hands. Still today's face.                    */
/* ------------------------------------------------------------------ */
function rounder(lk, scale = 1) {
  const { skin, hair, shirt, pants, shoe, trim, hat } = lk;
  return `<svg viewBox="0 0 64 84" width="${64 * scale}" height="${84 * scale}">
  <ellipse cx="32" cy="77" rx="14" ry="3.4" fill="#0B1410" opacity=".2"/>
  <path d="M28.5 58v13" stroke="${INK}" stroke-width="10" ${L}/><path d="M28.5 58v13" stroke="${shade(pants, 0.8)}" stroke-width="7.4" ${L}/>
  <ellipse cx="28" cy="73.6" rx="5.6" ry="3" fill="${shade(shoe, 0.85)}" stroke="${INK}" stroke-width="1.3"/>
  <circle cx="22.5" cy="52" r="3.8" fill="${shade(skin, 0.9)}" stroke="${INK}" stroke-width="1.3"/>
  <path d="M32 38c8 0 11 6 11 13s-4 9-11 9-11-2-11-9 3-13 11-13z" fill="${shirt}" stroke="${INK}" stroke-width="1.5"/>
  <path d="M22 50c0 6 3 9 9 9.6-7 .6-10-3-9-9.6z" fill="#000" opacity=".15"/>
  <path d="M28 39.4q4 3 8 0" fill="none" stroke="${shade(shirt, 0.65)}" stroke-width="1.6" ${L}/>
  <path d="M36.5 58v13" stroke="${INK}" stroke-width="10.4" ${L}/><path d="M36.5 58v13" stroke="${pants}" stroke-width="7.8" ${L}/>
  <ellipse cx="38" cy="73.4" rx="6.2" ry="3.2" fill="${shoe}" stroke="${INK}" stroke-width="1.4"/>
  <path d="M33 74.4h10" stroke="${trim}" stroke-width="1.3" ${L}/>
  <path d="M40 44q4 3 4.5 8" fill="none" stroke="${INK}" stroke-width="7.4" ${L}/><path d="M40 44q4 3 4.5 8" fill="none" stroke="${shirt}" stroke-width="5" ${L}/>
  <circle cx="44.6" cy="54" r="3.9" fill="${skin}" stroke="${INK}" stroke-width="1.3"/>
  <circle cx="33" cy="24" r="13.6" fill="${INK}"/><circle cx="33" cy="24" r="12.5" fill="${skin}"/>
  <path d="M21 27a12.5 12.5 0 0 0 17.5 9.6q-12 0-17.5-9.6z" fill="#000" opacity=".1"/>
  ${hairOrHat(hair, hat, 33, 24, 12.5)}
  ${hat ? '' : `<path d="M38 13.5q3-2 4.5 1.4" fill="none" stroke="${INK}" stroke-width="1.3" ${L}/><path d="M38.3 14q2.5-1.4 3.8 1" fill="${hair}"/>`}
  <circle cx="34.5" cy="27" r="1.9" fill="#1B2330"/><circle cx="40" cy="27" r="1.9" fill="#1B2330"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* SPORTY - dressed for walking: a zip-up track top with a stripe,     */
/* shorts and socks, a wristband, chunky runners.                       */
/* ------------------------------------------------------------------ */
function sporty(lk, scale = 1) {
  const { skin, hair, shirt, pants, shoe, trim, hat } = lk;
  return `<svg viewBox="0 0 64 84" width="${64 * scale}" height="${84 * scale}">
  <ellipse cx="32" cy="77" rx="13" ry="3.2" fill="#0B1410" opacity=".2"/>
  <path d="M30 60l-2 11" stroke="${INK}" stroke-width="7" ${L}/><path d="M30 60l-2 11" stroke="${shade(skin, 0.85)}" stroke-width="4.6" ${L}/>
  <path d="M28.4 66.5l-.4 4" stroke="#fff" stroke-width="4.6" ${L} opacity=".8"/>
  <path d="M23.6 71.2h8q3.4 0 3.6 3.4H24.2q-1.8 0-.6-3.4z" fill="${shade(shoe, 0.85)}" stroke="${INK}" stroke-width="1.3" ${L}/>
  <path d="M27 43l-3 10" stroke="${INK}" stroke-width="7.4" ${L}/><path d="M27 43l-3 10" stroke="${shade(shirt, 0.75)}" stroke-width="5" ${L}/>
  <path d="M24 55h17l-1 6h-6l-1-3-1 3h-7z" fill="${pants}" stroke="${INK}" stroke-width="1.4" ${L}/>
  <rect x="24" y="37" width="16.5" height="19" rx="7" fill="${shirt}" stroke="${INK}" stroke-width="1.5"/>
  <path d="M24.8 44v6q0 4 5 5h-1q-4.8-1-4-11z" fill="#000" opacity=".16"/>
  <path d="M32.3 38v17" stroke="${shade(shirt, 0.6)}" stroke-width="1.2"/><path d="M30 38.4l2.3 2 2.3-2" fill="none" stroke="${shade(shirt, 0.6)}" stroke-width="1.2" ${L}/>
  <path d="M34 60l1 11" stroke="${INK}" stroke-width="7.4" ${L}/><path d="M34 60l1 11" stroke="${skin}" stroke-width="5" ${L}/>
  <path d="M34.6 66.4l.3 4.2" stroke="#fff" stroke-width="5" ${L}/><path d="M34.6 67.4h.3" stroke="${trim}" stroke-width="5" ${L} opacity=".9"/>
  <path d="M31 71h9q4 0 4.2 4H31.4q-2 0-.4-4z" fill="${shoe}" stroke="${INK}" stroke-width="1.4" ${L}/>
  <path d="M31.4 73.2h12.4" stroke="${trim}" stroke-width="1.4" ${L}/><path d="M35 71.4l1.4 1.8M37.4 71.4l1.4 1.8" stroke="${INK}" stroke-width=".8"/>
  <path d="M37.5 42.5l3.5 9" stroke="${INK}" stroke-width="7.6" ${L}/><path d="M37.5 42.5l3.5 9" stroke="${shirt}" stroke-width="5.2" ${L}/>
  <path d="M38.6 43.4l3 7.6" stroke="#fff" stroke-width="1.3" opacity=".75" ${L}/>
  <path d="M40.4 50.6l1.4 2.2" stroke="${trim}" stroke-width="4.4" ${L}/>
  <circle cx="42.2" cy="54.2" r="2.8" fill="${skin}" stroke="${INK}" stroke-width="1.2"/>
  <circle cx="33" cy="26" r="12.3" fill="${INK}"/><circle cx="33" cy="26" r="11.2" fill="${skin}"/>
  <path d="M22 28a11.2 11.2 0 0 0 16 9.2q-11 0-16-9.2z" fill="#000" opacity=".1"/>
  ${hairOrHat(hair, hat, 33, 26, 11.2)}
  ${hat ? '' : `<path d="M22.2 21.6Q33 16.6 44 21.4" fill="none" stroke="${INK}" stroke-width="4.4" ${L}/><path d="M22.2 21.6Q33 16.6 44 21.4" fill="none" stroke="${trim}" stroke-width="2.4" ${L}/>`}
  <circle cx="34" cy="28.6" r="1.75" fill="#1B2330"/><circle cx="39.1" cy="28.6" r="1.75" fill="#1B2330"/>
</svg>`;
}

/* Matching portraits: the original front face (two dots and a smile), with
   the same finishing as the runner - shaded jaw, hair shine, shirt collar. */
function portrait(lk, style, size = 120) {
  const { skin, hair, shirt, hat, trim } = lk;
  const R = style === 'rounder' ? 18.5 : 17;
  const cy = style === 'rounder' ? 30 : 31;
  return `<svg viewBox="0 0 64 64" width="${size}" height="${size}">
  <defs><clipPath id="c${style}${size}${shirt.slice(1)}"><circle cx="32" cy="32" r="30.5"/></clipPath>
  <radialGradient id="g${style}${size}${shirt.slice(1)}" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="${shirt}" stop-opacity=".25"/></radialGradient></defs>
  <circle cx="32" cy="32" r="32" fill="url(#g${style}${size}${shirt.slice(1)})"/>
  <g clip-path="url(#c${style}${size}${shirt.slice(1)})">
    <path d="M9 66c2.4-10.4 10.4-17 23-17s20.6 6.6 23 17z" fill="${INK}"/>
    <path d="M11.4 66c2.2-8.8 9.4-14.6 20.6-14.6S50.4 57.2 52.6 66z" fill="${shirt}"/>
    <path d="M11.4 66c1-5 3-8.6 6-11 0 4 1 8 3 11z" fill="#000" opacity=".15"/>
    ${style === 'sporty'
      ? `<path d="M32 52v14" stroke="${shade(shirt, 0.6)}" stroke-width="1.4"/><path d="M27 51.6l5 3.6 5-3.6" fill="none" stroke="${shade(shirt, 0.6)}" stroke-width="1.6"/><path d="M14 60q4-5 9-7" stroke="#fff" stroke-width="1.6" opacity=".7" fill="none"/>`
      : `<path d="M24 51.8q8 5.6 16 0" fill="none" stroke="${shade(shirt, 0.6)}" stroke-width="2" stroke-linecap="round"/>`}
    ${[-1, 1].map((s) => `<ellipse cx="${32 + s * (R - 0.4)}" cy="${cy + 3.4}" rx="3.6" ry="4.3" fill="${INK}"/><ellipse cx="${32 + s * (R - 0.4)}" cy="${cy + 3.4}" rx="2.5" ry="3.2" fill="${skin}"/>`).join('')}
    <circle cx="32" cy="${cy}" r="${R + 1.4}" fill="${INK}"/><circle cx="32" cy="${cy}" r="${R}" fill="${skin}"/>
    <path d="M${32 - R + 1} ${cy + 4}a${R} ${R} 0 0 0 ${2 * R - 2} 0q-${R - 1} ${R * 0.75} -${2 * R - 2} 0z" fill="#000" opacity=".08"/>
    ${hat
      ? `<path d="M14.4 ${cy - 5}A18 18 0 0 1 49.6 ${cy - 5}Q32 ${cy - 8.4} 14.4 ${cy - 5}z" fill="${hat}" stroke="${INK}" stroke-width="1.4"/><path d="M15 ${cy - 4.6}Q32 ${cy + 4.4} 49 ${cy - 4.6}Q32 ${cy - 8} 15 ${cy - 4.6}z" fill="${hat}" stroke="${INK}" stroke-width="1.4"/><circle cx="32" cy="${cy - R + 0.4}" r="1.5" fill="${INK}"/>`
      : `<path d="M${32 - R - 0.6} ${cy + 1}A${R + 0.6} ${R + 0.6} 0 0 1 ${32 + R + 0.6} ${cy + 1}C${32 + R} ${cy - 5} ${32 + R - 4} ${cy - 8.4} ${32 + 8} ${cy - 7.6}Q32 ${cy - 4.6} ${32 - 8} ${cy - 7.6}C${32 - R + 4} ${cy - 8.4} ${32 - R} ${cy - 5} ${32 - R - 0.6} ${cy + 1}z" fill="${hair}" stroke="${INK}" stroke-width="1.2"/>
         <path d="M${32 - 9} ${cy - R + 4}q6 -3 12 -1.6" fill="none" stroke="#fff" stroke-width="1.6" opacity=".3" stroke-linecap="round"/>
         ${style === 'sporty' ? `<path d="M${32 - R} ${cy - 6}Q32 ${cy - 12} ${32 + R} ${cy - 6}" fill="none" stroke="${INK}" stroke-width="5"/><path d="M${32 - R} ${cy - 6}Q32 ${cy - 12} ${32 + R} ${cy - 6}" fill="none" stroke="${trim}" stroke-width="3"/>` : ''}`}
    <circle cx="26" cy="${cy + 2}" r="2.4" fill="#1B2330"/><circle cx="38" cy="${cy + 2}" r="2.4" fill="#1B2330"/>
    <path d="M28.5 ${cy + 9}q3.5 3 7 0" stroke="#1B2330" stroke-width="1.9" stroke-linecap="round" fill="none"/>
  </g>
  <circle cx="32" cy="32" r="30.5" fill="none" stroke="${shirt}" stroke-width="3"/>
</svg>`;
}

/* Today's character, drawn by the app's own components. */
const nowAvatar = { skin: 'skin_2', hair: 'hair_short', hat: 'hat_none', shirt: 'shirt_forest', shoes: 'shoes_trainers', face: 'face_none' };
const nowLooks = [
  { skin: 'skin_1', hair: 'hair_ginger', hat: 'hat_none', shirt: 'shirt_violet', shoes: 'shoes_runners', face: 'face_none' },
  { skin: 'skin_5', hair: 'hair_short', hat: 'hat_cap', shirt: 'shirt_ruby', shoes: 'shoes_hitops', face: 'face_none' },
  { skin: 'skin_3', hair: 'hair_silver', hat: 'hat_beanie', shirt: 'shirt_teal', shoes: 'shoes_track', face: 'face_none' },
];

const tile = (svg) => `<div class="tile"><svg class="tbg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#F2EFE9"/>
  <rect x="8" y="8" width="64" height="44" rx="4" fill="#E2DCD1"/><rect x="88" y="8" width="64" height="44" rx="4" fill="#CFE5B8"/>
  <rect x="0" y="58" width="160" height="12" fill="#fff"/><rect x="74" y="0" width="12" height="120" fill="#FBE4A6"/>
  <rect x="94" y="76" width="34" height="34" rx="5" fill="#7E56A6AA" stroke="#E39A2E"/><rect x="40" y="76" width="34" height="34" rx="5" fill="#F2A93B55" stroke="#F2A93B" stroke-width="2"/></svg>
  <div class="tchar">${svg}</div></div>`;

const rows = [
  {
    key: 'Now', title: 'Today', note: 'What players see in the current build.',
    big: R(Runner, { gait: 'idle', size: 150, avatar: nowAvatar }), face: R(AvatarPortrait, { avatar: nowAvatar, size: 120 }),
    looks: nowLooks.map((a) => R(Runner, { gait: 'idle', size: 72, avatar: a })),
    map: R(Runner, { gait: 'idle', size: 30, avatar: nowAvatar }),
  },
  {
    key: '1', title: 'Polished', note: 'Same shapes, finished properly: a shaded body with a collar, sleeves and hands, trousers with a turned-up cuff, real trainers, and a shine on the hair.',
    big: polished(LOOKS.default, 2.35), face: portrait(LOOKS.default, 'polished'),
    looks: [polished(LOOKS.violet, 1.13), polished(LOOKS.ruby, 1.13), polished(LOOKS.ocean, 1.13)], map: polished(LOOKS.default, 0.47),
  },
  {
    key: '2', title: 'Rounder', note: 'Softer and cuter: a slightly bigger head, a bean-shaped body, stubby legs and mitten hands. Reads best at map size.',
    big: rounder(LOOKS.default, 2.35), face: portrait(LOOKS.default, 'rounder'),
    looks: [rounder(LOOKS.violet, 1.13), rounder(LOOKS.ruby, 1.13), rounder(LOOKS.ocean, 1.13)], map: rounder(LOOKS.default, 0.47),
  },
  {
    key: '3', title: 'Sporty', note: 'Dressed for walking: a zip-up track top with a stripe, shorts and socks, a wristband and chunky runners. Fits a walking game best.',
    big: sporty(LOOKS.default, 2.35), face: portrait(LOOKS.default, 'sporty'),
    looks: [sporty(LOOKS.violet, 1.13), sporty(LOOKS.ruby, 1.13), sporty(LOOKS.ocean, 1.13)], map: sporty(LOOKS.default, 0.47),
  },
];

const css = `
:root{--page:#E9ECE6;--ink:#121814;--card:#fff;--line:#E0E3DB;--muted:#545E51;--accent:#2F5D50}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--page:#0F1512;--ink:#EEF2EC;--card:#18201C;--line:#26302B;--muted:#A9B3A6}}
:root[data-theme=dark]{--page:#0F1512;--ink:#EEF2EC;--card:#18201C;--line:#26302B;--muted:#A9B3A6}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--page);color:var(--ink);font-family:Nunito,system-ui,sans-serif;padding:28px 16px 60px}
h1{font-weight:900;font-size:30px;text-align:center}
.lede{text-align:center;font-weight:700;color:var(--muted);margin:6px auto 22px;max-width:640px}
.row{max-width:1000px;margin:0 auto 18px;background:var(--card);border:1px solid var(--line);border-radius:24px;padding:18px;display:flex;gap:18px;flex-wrap:wrap;align-items:center}
.row.now{opacity:.92;border-style:dashed}
.big{width:170px;height:210px;border-radius:18px;background:linear-gradient(180deg,#F4F5F1,#E1EBE6);display:grid;place-items:center}
.face{width:130px;display:grid;place-items:center}
.info{flex:1;min-width:240px}
.head{display:flex;gap:10px;align-items:center}
.key{min-width:34px;height:34px;padding:0 8px;border-radius:10px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:900}
.now .key{background:#8A9386}
h2{font-weight:900;font-size:22px}
.note{font-weight:700;margin:6px 0 10px;line-height:1.45;color:var(--muted)}
.looks{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.look{width:84px;height:104px;border-radius:14px;background:#F4F5F1;display:grid;place-items:center}
.tile{position:relative;width:150px;height:112px;border-radius:14px;overflow:hidden;border:1px solid var(--line)}
.tbg{position:absolute;inset:0;width:100%;height:100%}
.tchar{position:absolute;left:44px;top:38px}
.cap{font-size:11.5px;font-weight:800;color:var(--muted);text-align:center;margin-top:3px}
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Character Rework</title><link href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&display=swap" rel="stylesheet"><style>${css}</style></head><body>
<h1>Today's character, reworked</h1>
<p class="lede">The original face is kept on every version: two dot eyes, and the small smile on the picture. Everything else is redrawn.</p>
${rows.map((r) => `<section class="row ${r.key === 'Now' ? 'now' : ''}">
  <div class="big">${r.big}</div>
  <div class="face">${r.face}</div>
  <div class="info"><div class="head"><span class="key">${r.key}</span><h2>${r.title}</h2></div>
    <p class="note">${r.note}</p>
    <div class="looks">${r.looks.map((l) => `<div class="look">${l}</div>`).join('')}<div>${tile(r.map)}<div class="cap">On the map, real size</div></div></div>
  </div></section>`).join('')}
</body></html>`;
fs.writeFileSync(__dirname + '/rework.html', html);
console.log('ok');
