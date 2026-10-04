// Builds characters.html: five complete character reworks, each shown large,
// at real map size on a map tile, and in three outfits.
const fs = require('fs');
const INK = '#14201A';
const o = (w = 3) => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

/* ------------------------------------------------------------------ */
/* A. TRAILBLAZER - a grown-up version of today's runner: same chibi   */
/* proportions and outline, but a real face, a backpack and boots.     */
/* ------------------------------------------------------------------ */
function trailblazer({ skin = '#E7B48C', hair = '#2B2018', shirt = '#2F5D50', pants = '#3B4A68', pack = '#F2A93B', hat = null, boots = '#5B3A22' } = {}) {
  return `<svg viewBox="0 0 120 160">
  <ellipse cx="60" cy="152" rx="30" ry="6" fill="#0B1410" opacity=".18"/>
  <rect x="26" y="78" width="26" height="40" rx="10" fill="${pack}" ${o()}/>
  <rect x="30" y="86" width="18" height="10" rx="4" fill="#000" opacity=".12"/>
  <rect x="44" y="112" width="13" height="30" rx="6" fill="${pants}" ${o()}/>
  <rect x="63" y="112" width="13" height="30" rx="6" fill="${pants}" ${o()}/>
  <path d="M40 146q0-8 10-8h8v10H42q-2 0-2-2z" fill="${boots}" ${o(2.5)}/>
  <path d="M61 146q0-8 10-8h8v10H63q-2 0-2-2z" fill="${boots}" ${o(2.5)}/>
  <rect x="40" y="78" width="40" height="42" rx="14" fill="${shirt}" ${o()}/>
  <path d="M48 80v36" stroke="${INK}" stroke-width="3" opacity=".35"/>
  <path d="M74 84q12 10 8 26" fill="none" stroke="${shirt}" stroke-width="11" stroke-linecap="round"/>
  <path d="M74 84q12 10 8 26" fill="none" ${o(3)} stroke-opacity="0" />
  <circle cx="82" cy="112" r="6" fill="${skin}" ${o(2.5)}/>
  <circle cx="60" cy="52" r="34" fill="${skin}" ${o()}/>
  <path d="M27 50a33 33 0 0 1 66 0q-8-12-22-12q-6 6-16 5q-14-2-20 9z" fill="${hair}" ${o(2.5)}/>
  ${hat ? `<path d="M24 40a36 30 0 0 1 72 0z" fill="${hat}" ${o()}/><path d="M86 38h18q4 0 3 4l-3 2H86z" fill="${hat}" ${o(2.5)}/>` : ''}
  <ellipse cx="48" cy="58" rx="6.5" ry="8" fill="#fff" ${o(2)}/><ellipse cx="72" cy="58" rx="6.5" ry="8" fill="#fff" ${o(2)}/>
  <circle cx="49.5" cy="60" r="3.8" fill="#1B2330"/><circle cx="73.5" cy="60" r="3.8" fill="#1B2330"/>
  <circle cx="51" cy="58" r="1.4" fill="#fff"/><circle cx="75" cy="58" r="1.4" fill="#fff"/>
  <circle cx="40" cy="70" r="4.5" fill="#F0786A" opacity=".35"/><circle cx="80" cy="70" r="4.5" fill="#F0786A" opacity=".35"/>
  <path d="M54 72q6 5 12 0" fill="none" ${o(2.5)}/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* B. PEBBLE - a round little creature, the game's mascot. One shape,  */
/* so it reads instantly on the map; a gem on its forehead shows the   */
/* player's best mineral.                                               */
/* ------------------------------------------------------------------ */
function pebble({ body = '#7FD99A', belly = '#D8F5E1', gem = '#7E56A6', hat = null, scarf = null } = {}) {
  return `<svg viewBox="0 0 120 160">
  <ellipse cx="60" cy="150" rx="34" ry="7" fill="#0B1410" opacity=".18"/>
  <ellipse cx="44" cy="142" rx="12" ry="8" fill="${body}" ${o()}/><ellipse cx="76" cy="142" rx="12" ry="8" fill="${body}" ${o()}/>
  <path d="M60 30C92 30 104 62 104 96c0 30-20 46-44 46S16 126 16 96C16 62 28 30 60 30z" fill="${body}" ${o()}/>
  <ellipse cx="60" cy="112" rx="26" ry="22" fill="${belly}"/>
  <path d="M16 100q-10 4-8 16" fill="none" stroke="${body}" stroke-width="10" stroke-linecap="round"/>
  <path d="M104 100q10 4 8 16" fill="none" stroke="${body}" stroke-width="10" stroke-linecap="round"/>
  ${scarf ? `<path d="M24 92q36 14 72 0v10q-36 14-72 0z" fill="${scarf}" ${o(2.5)}/><path d="M80 98l8 22-12-2z" fill="${scarf}" ${o(2.5)}/>` : ''}
  <path d="M60 40l8 10-8 10-8-10z" fill="${gem}" ${o(2.5)}/><path d="M56 46l4-4" stroke="#fff" stroke-width="2" opacity=".7"/>
  ${hat ? `<path d="M30 46q30-32 60 0z" fill="${hat}" ${o()}/><rect x="26" y="42" width="68" height="9" rx="4.5" fill="${hat}" ${o(2.5)}/>` : ''}
  <ellipse cx="46" cy="76" rx="8" ry="10" fill="#fff" ${o(2.5)}/><ellipse cx="74" cy="76" rx="8" ry="10" fill="#fff" ${o(2.5)}/>
  <circle cx="48" cy="79" r="4.5" fill="#1B2330"/><circle cx="76" cy="79" r="4.5" fill="#1B2330"/>
  <circle cx="50" cy="76" r="1.7" fill="#fff"/><circle cx="78" cy="76" r="1.7" fill="#fff"/>
  <path d="M54 92q6 6 12 0" fill="none" ${o(2.5)}/>
  <circle cx="34" cy="90" r="5" fill="#F0786A" opacity=".35"/><circle cx="86" cy="90" r="5" fill="#F0786A" opacity=".35"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* C. GEM SPRITE - a walking crystal made of facets, in the style of   */
/* the "when boosted" bubble. Its colour is the mineral you love.      */
/* ------------------------------------------------------------------ */
function sprite({ hi = '#B8A2FF', mid = '#8A5CF6', lo = '#6536D9', crown = false, trail = true } = {}) {
  return `<svg viewBox="0 0 120 160">
  <ellipse cx="60" cy="150" rx="28" ry="6" fill="#0B1410" opacity=".18"/>
  ${trail ? `<g fill="${hi}" opacity=".8"><path d="M18 60l3-6 3 6-3 6z"/><path d="M98 40l2-4 2 4-2 4z"/><path d="M102 96l3-6 3 6-3 6z"/></g>` : ''}
  <path d="M46 128l-4 16h12l2-16zM64 128l2 16h12l-4-16z" fill="${lo}" ${o(2.5)}/>
  <path d="M60 18L94 46 98 90 78 132H42L22 90 26 46z" fill="${mid}" ${o()}/>
  <path d="M60 18L94 46 60 60 26 46z" fill="${hi}"/>
  <path d="M26 46L60 60 42 132 22 90z" fill="${mid}"/>
  <path d="M94 46L98 90 78 132 60 60z" fill="${lo}"/>
  <path d="M60 60L78 132H42z" fill="${mid}" opacity=".9"/>
  <path d="M60 18L94 46 98 90 78 132H42L22 90 26 46z" fill="none" ${o()}/>
  <path d="M34 44L60 26" stroke="#fff" stroke-width="3" opacity=".55" stroke-linecap="round"/>
  ${crown ? `<path d="M40 22l4-14 8 8 8-12 8 12 8-8 4 14z" fill="#F2B53B" ${o(2.5)}/>` : ''}
  <ellipse cx="48" cy="74" rx="6" ry="8" fill="#fff"/><ellipse cx="72" cy="74" rx="6" ry="8" fill="#fff"/>
  <circle cx="49" cy="76" r="3.4" fill="#1B2330"/><circle cx="73" cy="76" r="3.4" fill="#1B2330"/>
  <path d="M54 90q6 5 12 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* D. CRITTERS - pick an animal, then dress it. Fox, cat, frog, bear.  */
/* ------------------------------------------------------------------ */
function critter({ kind = 'fox', fur = '#E8823A', shirt = '#2F5D50', hat = null } = {}) {
  const head = {
    fox: `<path d="M30 30l8 24 14-10zM90 30l-8 24-14-10z" fill="${fur}" ${o()}/><path d="M33 36l5 13 6-4zM87 36l-5 13-6-4z" fill="#2B2018"/>
          <ellipse cx="60" cy="62" rx="32" ry="28" fill="${fur}" ${o()}/><path d="M36 70q24 26 48 0q-6 18-24 18t-24-18z" fill="#FFF4E8"/>`,
    cat: `<path d="M32 34l4 22 16-8zM88 34l-4 22-16-8z" fill="${fur}" ${o()}/><path d="M36 41l2 10 7-4zM84 41l-2 10-7-4z" fill="#F0A0A8"/>
          <ellipse cx="60" cy="62" rx="32" ry="28" fill="${fur}" ${o()}/><path d="M30 66h-12M30 72l-11 4M90 66h12M90 72l11 4" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>`,
    frog: `<ellipse cx="60" cy="66" rx="34" ry="24" fill="${fur}" ${o()}/><circle cx="42" cy="44" r="13" fill="${fur}" ${o()}/><circle cx="78" cy="44" r="13" fill="${fur}" ${o()}/>`,
    bear: `<circle cx="34" cy="40" r="11" fill="${fur}" ${o()}/><circle cx="86" cy="40" r="11" fill="${fur}" ${o()}/><circle cx="34" cy="40" r="5" fill="#000" opacity=".2"/><circle cx="86" cy="40" r="5" fill="#000" opacity=".2"/>
          <ellipse cx="60" cy="62" rx="32" ry="28" fill="${fur}" ${o()}/><ellipse cx="60" cy="74" rx="13" ry="10" fill="#F2DCC0"/>`,
  }[kind];
  const ey = kind === 'frog' ? 44 : 60;
  const ex = kind === 'frog' ? [42, 78] : [48, 72];
  return `<svg viewBox="0 0 120 160">
  <ellipse cx="60" cy="152" rx="28" ry="6" fill="#0B1410" opacity=".18"/>
  <rect x="45" y="118" width="12" height="26" rx="6" fill="${fur}" ${o()}/><rect x="63" y="118" width="12" height="26" rx="6" fill="${fur}" ${o()}/>
  ${kind === 'fox' ? `<path d="M80 120q30-4 26-30q-2 18-22 16z" fill="${fur}" ${o()}/><path d="M100 96q4 6 1 12l-6-6z" fill="#FFF4E8"/>` : ''}
  <rect x="40" y="86" width="40" height="38" rx="15" fill="${shirt}" ${o()}/>
  ${head}
  ${hat ? `<path d="M34 38a28 20 0 0 1 52 0z" fill="${hat}" ${o()}/><rect x="28" y="34" width="64" height="8" rx="4" fill="${hat}" ${o(2.5)}/>` : ''}
  <circle cx="${ex[0]}" cy="${ey}" r="5" fill="#1B2330"/><circle cx="${ex[1]}" cy="${ey}" r="5" fill="#1B2330"/>
  <circle cx="${ex[0] + 1.6}" cy="${ey - 1.6}" r="1.7" fill="#fff"/><circle cx="${ex[1] + 1.6}" cy="${ey - 1.6}" r="1.7" fill="#fff"/>
  ${kind === 'frog' ? `<path d="M44 72q16 10 32 0" fill="none" ${o(2.5)}/>` : `<path d="M57 70l3 3 3-3z" fill="${INK}"/><path d="M54 76q6 4 12 0" fill="none" ${o(2.2)}/>`}
</svg>`;
}

/* ------------------------------------------------------------------ */
/* E. MINIMAL - flat geometric figures, no outline, long soft shadow.  */
/* Calm and modern; shown from above it is a dot with a direction.     */
/* ------------------------------------------------------------------ */
function minimal({ head = '#E7B48C', body = '#2F5D50', accent = '#F2A93B', cap = true } = {}) {
  return `<svg viewBox="0 0 120 160">
  <path d="M40 150L96 128 104 134 52 156z" fill="#0B1410" opacity=".12"/>
  <rect x="48" y="112" width="10" height="38" rx="5" fill="#2B3750"/><rect x="62" y="112" width="10" height="38" rx="5" fill="#2B3750"/>
  <rect x="40" y="70" width="40" height="50" rx="20" fill="${body}"/>
  <rect x="40" y="70" width="40" height="50" rx="20" fill="#fff" opacity=".1" style="clip-path:inset(0 50% 0 0)"/>
  <circle cx="60" cy="44" r="24" fill="${head}"/>
  ${cap ? `<path d="M36 40a24 24 0 0 1 48 0z" fill="${accent}"/><rect x="74" y="36" width="18" height="6" rx="3" fill="${accent}"/>` : ''}
  <circle cx="68" cy="48" r="3" fill="#1B2330"/>
  <rect x="40" y="96" width="40" height="5" fill="${accent}" opacity=".9"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
const map = (svg) => `<div class="tile"><svg class="tbg" viewBox="0 0 160 120"><rect width="160" height="120" fill="#F2EFE9"/>
  <rect x="8" y="8" width="64" height="44" rx="4" fill="#E2DCD1"/><rect x="88" y="8" width="64" height="44" rx="4" fill="#CFE5B8"/>
  <rect x="0" y="58" width="160" height="12" fill="#fff"/><rect x="74" y="0" width="12" height="120" fill="#FBE4A6"/>
  <rect x="94" y="76" width="34" height="34" rx="5" fill="#7E56A6AA" stroke="#E39A2E"/><rect x="40" y="76" width="34" height="34" rx="5" fill="#F2A93B55" stroke="#F2A93B" stroke-width="2"/></svg>
  <div class="tchar">${svg}</div></div>`;

const concepts = [
  {
    key: 'A', name: 'Trailblazer', tag: 'Closest to today',
    pitch: 'Today’s runner, grown up: the same chunky outline and big head, but a proper face with shining eyes, a backpack for the explorer feel, and real boots.',
    pros: ['Least work: the editor, items and shop all carry over', 'Players keep the character they made', 'Backpack is a new item slot to sell'],
    cons: ['Still “a person” – the least distinctive of the five'],
    big: trailblazer({ hat: '#F2A93B' }),
    looks: [trailblazer({ hair: '#C2551F', shirt: '#7E56A6', pack: '#4DBE94' }), trailblazer({ skin: '#8A5533', shirt: '#C0304A', pack: '#2A5FA8', hat: '#141A2B' }), trailblazer({ skin: '#F4D3B8', hair: '#E0B93C', shirt: '#1F7A8C', pack: '#E0559A', boots: '#E0B93C' })],
  },
  {
    key: 'B', name: 'Pebble', tag: 'Mascot',
    pitch: 'A round little creature that becomes the face of Fareground. The gem on its forehead takes the colour of your rarest mine, so your best land shows on you.',
    pros: ['Reads instantly at map size – one simple shape', 'Great for the icon, promo videos and merch', 'Gem-on-forehead ties the character to the game'],
    cons: ['Fewer outfit slots (hat, scarf, colour, gem)', 'Players who like human avatars may miss them'],
    big: pebble({ hat: '#F2A93B' }),
    looks: [pebble({ body: '#A98BFF', belly: '#EFE9FF', gem: '#C0304A', scarf: '#F2A93B' }), pebble({ body: '#F2A93B', belly: '#FFF3DC', gem: '#2A5FA8', hat: '#2F5D50' }), pebble({ body: '#8AB4F8', belly: '#E6F0FF', gem: '#4DBE94', scarf: '#D24B5E' })],
  },
  {
    key: 'C', name: 'Gem Sprite', tag: 'Most unique',
    pitch: 'A walking crystal cut from facets, matching the boost bubble. Choose the mineral it is made of; rare minerals unlock as you claim them, so the character itself is a trophy.',
    pros: ['Unlike anything in other walking games', 'Built-in progression: Ruby sprite = Ruby owner', 'Matches the faceted bubble and gem style'],
    cons: ['Less “cute”; harder to dress up with clothes', 'Needs a sparkle animation to feel alive'],
    big: sprite({ crown: true }),
    looks: [sprite({ hi: '#8FB6EE', mid: '#2A5FA8', lo: '#1B3F73' }), sprite({ hi: '#F08A9C', mid: '#C0304A', lo: '#8E1B33' }), sprite({ hi: '#C9C7BC', mid: '#8A887B', lo: '#5E5C52', trail: false })],
  },
  {
    key: 'D', name: 'Critters', tag: 'Most choice',
    pitch: 'Pick an animal – fox, cat, frog or bear – then dress it with the same shirts and hats as now. New animals become rare unlocks and event prizes.',
    pros: ['Huge appeal; people love picking an animal', 'Animals are perfect limited-time rewards', 'Easy to tell friends apart on the map'],
    cons: ['Most drawing work: every hat must fit every head', 'A bigger change for current players'],
    big: critter({ kind: 'fox' }),
    looks: [critter({ kind: 'cat', fur: '#9AA3AD', shirt: '#7E56A6', hat: '#F2A93B' }), critter({ kind: 'frog', fur: '#7FD99A', shirt: '#2A5FA8' }), critter({ kind: 'bear', fur: '#8A5533', shirt: '#C0304A', hat: '#141A2B' })],
  },
  {
    key: 'E', name: 'Minimal', tag: 'Cleanest',
    pitch: 'Flat geometric figures with no outlines and a long soft shadow. Calm, modern and premium – the map stays the hero.',
    pros: ['Sharpest at tiny sizes; lightest to draw', 'Looks premium in screenshots and the store', 'Fast to add colours and caps'],
    cons: ['Less personality; harder to make items exciting', 'Clashes a little with the chunky outlined UI'],
    big: minimal(),
    looks: [minimal({ body: '#7E56A6', accent: '#4DBE94' }), minimal({ head: '#8A5533', body: '#C0304A', accent: '#141A2B', cap: false }), minimal({ head: '#F4D3B8', body: '#1F7A8C', accent: '#E0559A' })],
  },
];

const css = `
:root{--page:#E9ECE6;--ink:#121814;--card:#fff;--line:#E0E3DB;--muted:#545E51;--accent:#2F5D50}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--page:#0F1512;--ink:#EEF2EC;--card:#18201C;--line:#26302B;--muted:#A9B3A6}}
:root[data-theme=dark]{--page:#0F1512;--ink:#EEF2EC;--card:#18201C;--line:#26302B;--muted:#A9B3A6}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--page);color:var(--ink);font-family:Nunito,system-ui,sans-serif;padding:28px 16px 60px}
h1{font-weight:900;font-size:30px;text-align:center;letter-spacing:-.5px}
.lede{text-align:center;font-weight:700;color:var(--muted);margin:6px auto 24px;max-width:640px}
.concept{max-width:1000px;margin:0 auto 22px;background:var(--card);border:1px solid var(--line);border-radius:26px;padding:20px;display:grid;grid-template-columns:240px 1fr;gap:20px}
@media (max-width:720px){.concept{grid-template-columns:1fr}}
.hero{background:linear-gradient(180deg,#F4F5F1,#E1EBE6);border-radius:20px;display:grid;place-items:center;padding:10px}
.hero svg{width:200px;height:260px}
.head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.letter{width:34px;height:34px;border-radius:10px;background:var(--accent);color:#fff;display:grid;place-items:center;font-weight:900}
h2{font-weight:900;font-size:24px}
.tag{font-size:12px;font-weight:900;letter-spacing:.8px;text-transform:uppercase;background:#FFF3DC;color:#8A5A12;padding:4px 10px;border-radius:999px}
.pitch{font-weight:700;margin:8px 0 12px;line-height:1.45}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end}
.look{background:#F4F5F1;border-radius:16px;width:96px;height:120px;display:grid;place-items:center}
.look svg{width:84px;height:110px}
.tile{position:relative;width:160px;height:120px;border-radius:16px;overflow:hidden;border:1px solid var(--line)}
.tbg{position:absolute;inset:0;width:100%;height:100%}
.tchar{position:absolute;left:46px;top:40px;width:28px;height:38px}
.tchar svg{width:28px;height:38px}
.cap{font-size:12px;font-weight:800;color:var(--muted);margin-top:4px;text-align:center}
.lists{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
@media (max-width:520px){.lists{grid-template-columns:1fr}}
.lists h3{font-size:13px;font-weight:900;letter-spacing:.6px;text-transform:uppercase;margin-bottom:4px}
.lists li{margin:0 0 4px 18px;font-weight:700;font-size:14px;line-height:1.4}
.good h3{color:#1F7A4D}.bad h3{color:#C0304A}
`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Character Reworks</title><link href="https://fonts.googleapis.com/css2?family=Nunito:wght@700;800;900&display=swap" rel="stylesheet"><style>${css}</style></head><body>
<h1>Character rework drafts</h1>
<p class="lede">Five completely different directions. Each is shown large, at the real size it appears on the map, and in three outfits.</p>
${concepts.map((c) => `<section class="concept">
  <div class="hero">${c.big}</div>
  <div>
    <div class="head"><span class="letter">${c.key}</span><h2>${c.name}</h2><span class="tag">${c.tag}</span></div>
    <p class="pitch">${c.pitch}</p>
    <div class="row">
      ${c.looks.map((l) => `<div><div class="look">${l}</div></div>`).join('')}
      <div>${map(c.big)}<div class="cap">On the map, real size</div></div>
    </div>
    <div class="lists"><div class="good"><h3>Good</h3><ul>${c.pros.map((p) => `<li>${p}</li>`).join('')}</ul></div>
    <div class="bad"><h3>Watch out</h3><ul>${c.cons.map((p) => `<li>${p}</li>`).join('')}</ul></div></div>
  </div></section>`).join('')}
</body></html>`;
fs.writeFileSync(__dirname + '/characters.html', html);
console.log('ok');
