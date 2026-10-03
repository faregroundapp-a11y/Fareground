// Builds ui-preview.html: current vs proposed Map / Walk / Land screens.
// Characters are rendered from the app's real Runner and AvatarPortrait.
const S = '/tmp/claude-0/-home-user-Fareground/bb0f6094-9845-5b93-a9b3-45d8e56f1b29/scratchpad/av';
const { load, React, renderToStaticMarkup, APP } = require(S + '/harness');
const { Runner } = load(APP + '/src/components/Runner.tsx');
const { AvatarPortrait } = load(APP + '/src/components/AvatarPortrait.tsx');
const me = { skin: 'skin_2', hair: 'hair_short', hat: 'hat_cap', shirt: 'shirt_forest', shoes: 'shoes_trainers', face: 'face_shades' };
const runner = (size, gait = 'idle') => renderToStaticMarkup(React.createElement(Runner, { gait, size, avatar: me }));
const face = (size) => renderToStaticMarkup(React.createElement(AvatarPortrait, { avatar: me, size }));

const ic = {
  coin: (s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 26 26"><circle cx="13" cy="13" r="12" fill="#F2B53B" stroke="#C4801E" stroke-width="2"/><circle cx="13" cy="13" r="7" fill="none" stroke="#FFE3A0" stroke-width="2"/></svg>`,
  steps: (s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 26 26"><circle cx="13" cy="13" r="13" fill="#4DBE94"/><ellipse cx="10" cy="11" rx="3" ry="4.5" fill="#fff"/><ellipse cx="16.5" cy="15" rx="3" ry="4.5" fill="#fff"/></svg>`,
  bolt: (s = 18, c = '#A98BFF') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="${c}"/></svg>`,
  chest: (s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 30 30"><rect x="4" y="12" width="22" height="13" rx="2" fill="#B8651E" stroke="#2A1A03" stroke-width="1.6"/><path d="M4 14a11 7 0 0 1 22 0" fill="#D9822B" stroke="#2A1A03" stroke-width="1.6"/><rect x="12.5" y="14" width="5" height="6" rx="1" fill="#F2B53B" stroke="#2A1A03" stroke-width="1.2"/></svg>`,
  sign: (s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect x="11" y="10" width="2" height="12" fill="#C9CDD2"/><path d="M4 4h13l3 3-3 3H4z" fill="#4DBE94" stroke="#0E131A" stroke-width="1"/></svg>`,
  compass: (s = 24) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#F5F7F3" stroke-opacity=".5" stroke-width="1.5"/><path d="M12 3l3 9h-6z" fill="#D24B5E"/><path d="M12 21l-3-9h6z" fill="#F5F7F3"/></svg>`,
  people: (s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.4" fill="#FFC968"/><circle cx="16.5" cy="9.5" r="2.8" fill="#4DBE94"/><path d="M2.5 20c.6-4 3.3-6 6.5-6s5.9 2 6.5 6z" fill="#FFC968"/><path d="M13 20c.5-3 2-4.6 4-4.6s3.6 1.6 4 4.6z" fill="#4DBE94"/></svg>`,
  pointer: (s = 14) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M12 2l7 19-7-4-7 4z" fill="#F2A93B"/></svg>`,
  ad: (s = 16, c = '#2A1A03') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="4" fill="none" stroke="${c}" stroke-width="2.4"/><path d="M10 9l5 3-5 3z" fill="${c}"/></svg>`,
  pulse: (s = 22, c = '#2F5D50') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M2 12h5l2-5 4 10 2-5h7" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  flag: (s = 22) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M5 3v18" stroke="#2A1A03" stroke-width="2"/><path d="M6 4h12l-3 4 3 4H6z" fill="#E39A2E"/></svg>`,
  gem: (s, c) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 13L2 9z" fill="${c}" stroke="#14201A" stroke-width="1.4" stroke-linejoin="round"/><path d="M2 9h20M8 3l4 19M16 3l-4 19" stroke="#fff" stroke-opacity=".35" stroke-width="1"/></svg>`,
  map: (c) => `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/><path d="M9 3v15M15 6v15" stroke="${c}" stroke-width="2"/></svg>`,
  walk: (c) => `<svg width="22" height="22" viewBox="0 0 24 24"><circle cx="13" cy="4" r="2.4" fill="${c}"/><path d="M11 8l-3 5 3 2-1 6M13 9l2 4 4 1M11 15l3 3v4" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  ranks: (c) => `<svg width="22" height="22" viewBox="0 0 24 24"><rect x="3" y="12" width="5" height="9" rx="1" fill="${c}"/><rect x="9.5" y="6" width="5" height="15" rx="1" fill="${c}"/><rect x="16" y="9" width="5" height="12" rx="1" fill="${c}"/></svg>`,
  land: (c) => `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M6 3h12l4 6-10 13L2 9z" fill="none" stroke="${c}" stroke-width="2.2" stroke-linejoin="round"/></svg>`,
};
const MIN = { ROCKY: '#8A887B', COAL: '#3B4048', AMETHYST: '#7E56A6', SAPPHIRE: '#2A5FA8', RUBY: '#C0304A' };

function mapBg() {
  let o = `<svg class="mapbg" width="360" height="780" viewBox="0 0 360 780"><rect width="360" height="780" fill="#F2EFE9"/>`;
  for (let y = -40; y < 780; y += 130) for (let x = -30; x < 380; x += 140) {
    const k = ((x + 30) / 140 + (y + 40) / 130 * 2) % 4;
    o += `<rect x="${x + 12}" y="${y + 12}" width="116" height="106" rx="5" fill="${k === 1 ? '#CFE5B8' : '#EAE5DB'}"/>`;
    if (k !== 1) o += `<rect x="${x + 22}" y="${y + 22}" width="40" height="30" rx="3" fill="#DDD6CA"/><rect x="${x + 70}" y="${y + 70}" width="44" height="36" rx="3" fill="#DDD6CA"/>`;
    else o += `<circle cx="${x + 50}" cy="${y + 50}" r="14" fill="#B9D89E"/>`;
  }
  for (let y = -40; y < 780; y += 130) o += `<rect x="0" y="${y - 2}" width="360" height="14" fill="#fff"/>`;
  for (let x = -30; x < 380; x += 140) o += `<rect x="${x - 2}" y="0" width="14" height="780" fill="#fff"/>`;
  o += `<rect x="168" y="0" width="26" height="780" fill="#FBE4A6"/>`;
  // claim grid around the player
  const c = 46, ox = 180 - c * 3, oy = 300;
  for (let r = 0; r < 5; r++) for (let q = 0; q < 6; q++) {
    const owned = { '1,1': 'AMETHYST', '3,1': 'ROCKY', '4,3': 'SAPPHIRE', '0,3': 'COAL' }[`${q},${r}`];
    const pick = q === 3 && r === 2;
    o += `<rect x="${ox + q * c + 2}" y="${oy + r * c + 2}" width="${c - 4}" height="${c - 4}" rx="6" fill="${owned ? MIN[owned] + 'AA' : pick ? '#F2A93B66' : '#E39A2E14'}" stroke="${pick ? '#F2A93B' : '#E39A2E'}" stroke-opacity="${pick ? 1 : 0.55}" stroke-width="${pick ? 2.5 : 1.2}"/>`;
  }
  return o + `</svg>`;
}

const css = `
:root{--ink:#121814;--ink2:#545E51;--ink3:#8A9386;--bg:#F4F5F1;--card:#fff;--line:#E0E3DB;--sunk:#ECEEE8;--accent:#2F5D50;--accentHi:#3C7564;--accentSoft:#E1EBE6;
--glass:rgba(14,19,26,.84);--glassLine:rgba(255,255,255,.14);--gi:#F5F7F3;--gi2:rgba(245,247,243,.64);--claim:#F2A93B;--claimHi:#FFC968;--claimDeep:#C4801E;--claimInk:#2A1A03;--boost:#8A5CF6;--boostHi:#A98BFF;--boostSoft:#EFE9FF;--steps:#4DBE94;--good:#7FD99A;--danger:#D24B5E;
--page:#E9ECE6;--pageInk:#121814}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--page:#0F1512;--pageInk:#EEF2EC}}
:root[data-theme=dark]{--page:#0F1512;--pageInk:#EEF2EC}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--page);color:var(--pageInk);font-family:Nunito,system-ui,sans-serif;padding:28px 16px 60px}
h1{font-weight:900;font-size:30px;letter-spacing:-.6px;text-align:center}
.lede{text-align:center;font-weight:700;opacity:.7;margin:6px auto 26px;max-width:640px;font-size:15px}
section{max-width:1000px;margin:0 auto 46px}
h2{font-weight:900;font-size:22px;margin:0 0 4px}
.pairs{display:flex;gap:26px;flex-wrap:wrap;justify-content:center;margin-top:14px}
.col{display:flex;flex-direction:column;align-items:center;gap:10px}
.tag{font-weight:900;font-size:13px;letter-spacing:1px;text-transform:uppercase;padding:5px 12px;border-radius:999px}
.tag.before{background:#D9DDD4;color:#545E51}.tag.after{background:var(--accent);color:#fff}
.notes{max-width:300px;font-size:14px;font-weight:700;line-height:1.45;opacity:.85}
.notes li{margin:0 0 6px 18px}
.phone{position:relative;width:360px;height:780px;border-radius:44px;overflow:hidden;background:var(--bg);border:10px solid #10151B;box-shadow:0 20px 50px rgba(0,0,0,.25);color:var(--ink);flex-shrink:0}
.mapbg{position:absolute;inset:0}
.status{height:30px}
.abs{position:absolute}
.glass{background:var(--glass);border:1px solid var(--glassLine);color:var(--gi)}
.pill{display:flex;align-items:center;gap:6px;height:38px;border-radius:999px;padding:0 12px 0 8px;font-weight:900;font-size:15px}
.rbtn{width:42px;height:42px;border-radius:50%;display:grid;place-items:center}
.mono{font-variant-numeric:tabular-nums}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;border-radius:18px;font-weight:900}
.claim{background:linear-gradient(180deg,var(--claimHi),var(--claim));color:var(--claimInk);box-shadow:0 4px 0 var(--claimDeep)}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:14px}
.cap{font-size:12px;font-weight:700;color:var(--ink3)}
.lbl{font-size:15px;font-weight:900}
.track{height:10px;border-radius:5px;background:var(--sunk);overflow:hidden}
.fill{height:100%;border-radius:5px}
.tabs{position:absolute;left:0;right:0;bottom:0;height:68px;background:#fff;border-top:1px solid var(--line);display:flex;justify-content:space-around;align-items:center;padding-bottom:6px}
.tab{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;font-weight:800;color:var(--ink3)}
.tabs.new{left:14px;right:14px;bottom:14px;height:64px;border-radius:24px;border:1px solid var(--glassLine);background:var(--glass);padding:0 6px}
.tabs.new .tab{color:var(--gi2);flex:1;height:50px;justify-content:center;border-radius:18px}
.tabs.new .tab.on{background:rgba(255,255,255,.12);color:#fff}
.tabs.new .tab.on .dot{width:5px;height:5px;border-radius:50%;background:var(--claim);margin-top:1px}
.badge{position:absolute;top:-3px;right:-3px;min-width:18px;height:18px;border-radius:9px;background:var(--danger);color:#fff;font-size:10px;font-weight:900;display:grid;place-items:center;border:2px solid #1b2129;padding:0 4px}
.row{display:flex;align-items:center;gap:10px}
.well{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;flex-shrink:0}
`;

const tabsOld = (on) => `<div class="tabs">${['Map', 'Walk', 'Ranks', 'Land'].map((t) => `<div class="tab" style="${t === on ? 'color:var(--accent)' : ''}">${ic[t.toLowerCase()](t === on ? '#2F5D50' : '#8A9386')}${t}</div>`).join('')}</div>`;
const tabsNew = (on) => `<div class="tabs new">${['Map', 'Walk', 'Ranks', 'Land'].map((t) => `<div class="tab ${t === on ? 'on' : ''}">${ic[t.toLowerCase()](t === on ? '#FFC968' : 'rgba(245,247,243,.6)')}${t}${t === on ? '<span class="dot"></span>' : ''}</div>`).join('')}</div>`;

/* ---------------- MAP ---------------- */
const mapBefore = `<div class="phone">${mapBg()}
  <div class="abs" style="left:156px;top:376px">${runner(48)}</div>
  <div class="abs row" style="left:10px;top:40px;gap:6px">
    <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:#fff">${face(40)}</div>
    <div class="glass pill">${ic.coin(20)}<span class="mono">12.4K</span></div>
    <div class="glass pill">${ic.steps(18)}<span class="mono">38</span><span style="font-size:10px;opacity:.6">WP</span></div>
  </div>
  <div class="abs" style="right:10px;top:40px;display:flex;flex-direction:column;align-items:flex-end;gap:7px">
    <div class="glass pill">${ic.bolt()}<span style="font-size:13px">Boost</span></div>
    <div class="glass rbtn" style="position:relative">${ic.chest()}<span class="badge">2</span></div>
    <div class="glass rbtn" style="font-size:20px">🤗</div>
    <div class="glass rbtn">${ic.sign()}</div>
    <div class="glass rbtn" style="position:relative">${ic.chest(20)}<span class="abs" style="top:2px;right:3px">${ic.pointer(11)}</span></div>
    <div class="glass rbtn">${ic.compass()}</div>
  </div>
  <div class="abs glass" style="left:10px;right:10px;bottom:78px;border-radius:26px;padding:10px">
    <div class="row" style="gap:7px;padding:0 4px 8px"><span style="width:9px;height:9px;border-radius:3px;background:var(--claim)"></span><span style="font-weight:900;font-size:12.5px">Nearest free square · 38 m</span><span style="margin-left:auto;font-size:11px;opacity:.6">tap a lit square</span></div>
    <div class="btn claim" style="height:52px;font-size:16px">${ic.ad(16)} Claim · 50 WP</div>
    <div class="row" style="gap:6px;padding:9px 4px 0;font-size:12.5px">${ic.coin(14)}<b class="mono">0</b><span style="opacity:.6">coins / month</span><span style="margin-left:auto;color:var(--good);font-weight:900">+0.05/day</span></div>
  </div>
  ${tabsOld('Map')}</div>`;

const mapAfter = `<div class="phone">${mapBg()}
  <div class="abs" style="left:156px;top:376px">${runner(48)}</div>
  <div class="abs" style="left:0;right:0;top:0;height:120px;background:linear-gradient(rgba(14,19,26,.35),rgba(14,19,26,0))"></div>
  <div class="abs row" style="left:12px;right:12px;top:40px;gap:8px">
    <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;background:#fff;border:2px solid var(--claim);flex-shrink:0">${face(40)}</div>
    <div class="glass row" style="height:44px;border-radius:999px;padding:0 6px 0 10px;gap:0">
      <div class="row" style="gap:6px;padding-right:10px">${ic.coin(22)}<b class="mono" style="font-size:16px">12.4K</b></div>
      <div style="width:1px;height:22px;background:var(--glassLine)"></div>
      <div class="row" style="gap:6px;padding:0 6px 0 10px">${ic.steps(20)}<b class="mono" style="font-size:16px">38</b><span style="font-size:11px;font-weight:800;opacity:.6">WP</span></div>
    </div>
    <div style="margin-left:auto;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(180deg,#9D74FF,#7A4BEA);box-shadow:0 4px 14px rgba(138,92,246,.45);flex-shrink:0">${ic.bolt(22, '#fff')}</div>
  </div>
  <div class="abs glass" style="right:12px;top:100px;border-radius:24px;padding:5px;display:flex;flex-direction:column;gap:2px">
    <div class="rbtn" style="position:relative">${ic.chest()}<span class="badge">2</span></div>
    <div class="rbtn">${ic.people()}</div>
    <div class="rbtn" style="position:relative">${ic.chest(20)}<span class="abs" style="top:4px;right:5px">${ic.pointer(11)}</span></div>
    <div class="rbtn">${ic.sign()}</div>
    <div style="height:1px;background:var(--glassLine);margin:2px 6px"></div>
    <div class="rbtn">${ic.compass()}</div>
  </div>
  <div class="abs" style="left:12px;right:12px;bottom:92px;border-radius:26px;background:#fff;box-shadow:0 14px 36px rgba(0,0,0,.28);padding:14px">
    <div class="row" style="gap:10px">
      <div class="well" style="background:#FFF3DC;width:42px;height:42px">${ic.flag(22)}</div>
      <div style="flex:1;min-width:0"><div class="lbl">Free square · 38 m</div><div class="cap">Tap any lit square to pick another</div></div>
      <div style="width:30px;height:30px;border-radius:50%;background:var(--sunk);display:grid;place-items:center;font-weight:900;color:var(--ink3)">⌄</div>
    </div>
    <div style="margin:12px 0 4px" class="row"><span class="cap" style="flex:1">Next parcel</span><b class="mono" style="font-size:13px">38 / 50 WP</b></div>
    <div class="track"><div class="fill" style="width:76%;background:linear-gradient(90deg,#4DBE94,#7FD99A)"></div></div>
    <div class="row" style="gap:8px;margin-top:12px">
      <div class="btn claim" style="flex:1;height:52px;font-size:16px;opacity:.55">Claim · 50 WP</div>
      <div class="btn" style="height:52px;padding:0 14px;background:var(--accent);color:#fff;font-size:14px">${ic.ad(16, '#fff')} +1 WP</div>
    </div>
    <div class="row" style="gap:6px;margin-top:11px;font-size:12.5px;font-weight:800;color:var(--ink2)">${ic.coin(15)}<span class="mono">0.6 coins / month</span><span style="margin-left:auto;color:#1F7A4D" class="mono">+0.02 / day</span></div>
  </div>
  ${tabsNew('Map')}</div>`;

/* ---------------- WALK ---------------- */
const ring = (p, inner, D = 200, sw = 16) => { const c = D / 2, rr = c - sw / 2 - 6; return `<div style="position:relative;width:${D}px;height:${D}px">
  <svg width="${D}" height="${D}" viewBox="0 0 ${D} ${D}" style="position:absolute;inset:0"><circle cx="${c}" cy="${c}" r="${rr}" fill="none" stroke="#E1EBE6" stroke-width="${sw}"/>
  <circle cx="${c}" cy="${c}" r="${rr}" fill="none" stroke="url(#rg)" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * rr * p} 9999" transform="rotate(-90 ${c} ${c})"/>
  <defs><linearGradient id="rg"><stop offset="0" stop-color="#4DBE94"/><stop offset="1" stop-color="#2F5D50"/></linearGradient></defs></svg>
  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">${inner}</div></div>`; };

const walkBefore = `<div class="phone" style="overflow:hidden"><div style="padding:40px 16px 0">
  <div class="row"><div><div class="cap" style="letter-spacing:1px">FRIDAY, 3 OCTOBER</div><div style="font-weight:900;font-size:30px">Today</div></div>
  <div class="row" style="margin-left:auto;gap:8px"><div class="row card" style="padding:6px 10px;gap:6px;border-radius:999px"><span style="width:8px;height:8px;border-radius:50%;background:var(--steps)"></span><b style="font-size:12px">10:42</b></div><div style="width:40px;height:40px;border-radius:50%;overflow:hidden">${face(40)}</div></div></div>
  <div style="display:flex;flex-direction:column;align-items:center;margin:10px 0 4px">${ring(0.55, `${runner(34, 'walk')}<b class="mono" style="font-size:30px">6,420</b><span class="cap">steps today</span>`)}
  <div class="cap" style="margin-top:6px">80 steps to your next Walk Point</div></div>
  <div class="card" style="margin-top:8px"><div class="row"><div class="well" style="background:var(--accentSoft)">${ic.pulse()}</div><div><div class="lbl">Steps from Health Connect ✓</div><div class="cap">Last synced 10:42</div></div></div>
  <div class="row" style="margin-top:10px;gap:8px"><div class="btn" style="flex:1;height:42px;background:var(--sunk);font-size:14px">Sync steps</div><div class="btn" style="flex:1;height:42px;font-size:14px;color:var(--accent)">Step setup</div></div></div>
  <div class="row" style="gap:10px;margin-top:10px"><div class="card" style="flex:1">${ic.steps(22)}<div class="mono" style="font-weight:900;font-size:22px">38</div><div class="cap">Walk Points</div></div><div class="card" style="flex:1">${ic.flag(22)}<div class="mono" style="font-weight:900;font-size:22px">1,280</div><div class="cap">steps to next parcel</div></div></div>
  <div class="card" style="margin-top:10px"><div class="row"><span class="lbl" style="flex:1">Next parcel</span><b class="mono" style="font-size:13px">38 / 50 WP</b></div><div class="track" style="margin-top:8px"><div class="fill" style="width:76%;background:var(--accent)"></div></div></div>
  </div>${tabsOld('Walk')}</div>`;

const walkAfter = `<div class="phone" style="overflow:hidden">
  <div style="background:linear-gradient(180deg,#2F5D50,#3C7564);color:#fff;padding:40px 16px 22px;border-radius:0 0 30px 30px">
    <div class="row"><div><div style="font-size:12px;font-weight:800;opacity:.75;letter-spacing:1px;white-space:nowrap">FRI 3 OCT</div><div style="font-weight:900;font-size:28px">Today</div></div>
    <div class="row" style="margin-left:auto;gap:8px"><div class="row" style="padding:6px 11px;gap:6px;border-radius:999px;background:rgba(255,255,255,.14);font-size:12px;font-weight:900"><span style="width:8px;height:8px;border-radius:50%;background:#7FD99A"></span>10:42</div><div style="width:42px;height:42px;border-radius:50%;overflow:hidden;border:2px solid #FFC968">${face(38)}</div></div></div>
    <div class="row" style="margin-top:14px;gap:14px;align-items:center">
      <div style="background:#fff;border-radius:50%;flex-shrink:0">${ring(0.43, `${runner(26, 'walk')}<b class="mono" style="font-size:24px;color:var(--ink);line-height:1.1">6,420</b><span class="cap">of 15,000</span>`, 150, 12)}</div>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:800;opacity:.75">WALK POINTS</div><div class="mono" style="font-weight:900;font-size:34px;line-height:1">38</div>
        <div style="font-size:12.5px;font-weight:700;opacity:.85;margin-top:6px">80 steps to the next one</div>
        <div style="height:6px;border-radius:3px;background:rgba(255,255,255,.2);margin-top:6px"><div style="width:20%;height:100%;border-radius:3px;background:#FFC968"></div></div>
      </div>
    </div>
  </div>
  <div style="padding:14px 16px">
    <div class="card row" style="padding:12px 14px"><div class="well" style="background:#FFF3DC;width:40px;height:40px">${ic.flag(22)}</div><div style="flex:1"><div class="lbl">Next parcel in 1,280 steps</div><div class="track" style="margin-top:7px"><div class="fill" style="width:76%;background:linear-gradient(90deg,#F2A93B,#FFC968)"></div></div></div><b class="mono" style="font-size:13px">38/50</b></div>
    <div class="row" style="gap:10px;margin-top:10px">
      <div class="card" style="flex:1;padding:12px;position:relative"><div class="well" style="background:#FFF3DC;width:40px;height:40px">${ic.chest(26)}</div><div class="lbl" style="margin-top:8px">Daily chest</div><div class="cap">Ready · 2/3 quests</div><span class="badge" style="top:10px;right:10px;border-color:#fff">2</span></div>
      <div class="card" style="flex:1;padding:12px"><div class="well" style="background:var(--boostSoft);width:40px;height:40px">${ic.bolt(22, '#8A5CF6')}</div><div class="lbl" style="margin-top:8px">Free rewards</div><div class="cap">Bonus WP ready</div></div>
    </div>
    <div class="card row" style="margin-top:10px;padding:10px 14px"><span style="width:10px;height:10px;border-radius:50%;background:var(--steps)"></span><div style="flex:1"><div style="font-weight:900;font-size:13.5px">Steps from Fitbit + Health Connect</div><div class="cap">All set · counting with the app closed</div></div><span style="font-weight:900;font-size:13px;color:var(--accent)">Setup ›</span></div>
  </div>
  ${tabsNew('Walk')}</div>`;

/* ---------------- LAND ---------------- */
const parcels = [['RUBY', 'Ruby', 2, '6.3'], ['SAPPHIRE', 'Sapphire', 1, '2.15'], ['AMETHYST', 'Amethyst', 0, '1.2'], ['ROCKY', 'Rocky', 0, '0.6']];
const landBefore = `<div class="phone"><div style="padding:40px 16px 0">
  <div style="font-weight:900;font-size:28px;margin-bottom:12px">My land</div>
  <div class="card"><div class="row" style="align-items:flex-start">${ic.coin(30)}<div style="flex:1"><div class="mono" style="font-weight:900;font-size:22px">10.25 <span style="font-size:13px;color:var(--ink3)">coins / month</span></div><div class="cap mono">$0.123 per year</div><div class="cap mono">You have 12,431 coins · $12.43</div></div>
  <div style="background:#8A5CF6;color:#fff;border-radius:14px;padding:6px 8px;font-size:10px;font-weight:900;text-align:center">when boosted<br>$2.46 / year</div></div>
  <div class="row" style="gap:6px;margin-top:12px">${Object.entries(MIN).map(([k, c]) => `<div class="row" style="flex:1;justify-content:center;gap:4px;background:var(--sunk);border-radius:10px;padding:6px 0">${ic.gem(18, c)}<b style="font-size:13px">${k === 'COAL' ? 0 : 1}</b></div>`).join('')}</div></div>
  <div class="cap" style="margin:14px 0 6px;letter-spacing:1px">4 PARCELS</div>
  ${parcels.map(([k, n, lv, r]) => `<div style="padding:12px 0;border-bottom:1px solid var(--line)"><div class="row"><div class="well" style="background:${MIN[k]}1F;width:40px;height:40px">${ic.gem(24, MIN[k])}</div><div style="flex:1"><b style="color:${MIN[k]}">${n}</b><div class="cap">Claimed 28/09/2026</div></div><span class="mono" style="font-size:13px;font-weight:900">+${r}/mo</span></div>
  <div class="row" style="margin-top:8px;background:var(--accent);color:#fff;border-radius:12px;padding:8px 12px;font-size:12.5px;font-weight:900">${ic.ad(14, '#fff')} Upgrade +0.15/mo · 20 WP + ad<span style="margin-left:auto">${lv}/5</span></div></div>`).join('')}
  </div>${tabsOld('Land')}</div>`;

const landAfter = `<div class="phone"><div style="padding:40px 16px 0">
  <div class="row" style="margin-bottom:12px"><div style="font-weight:900;font-size:28px">My land</div><span class="cap" style="margin-left:auto;font-size:13px">4 parcels</span></div>
  <div style="border-radius:24px;padding:16px;color:#fff;background:linear-gradient(150deg,#2F5D50,#1F3F36);box-shadow:0 10px 26px rgba(47,93,80,.35)">
    <div style="font-size:12px;font-weight:800;opacity:.7;letter-spacing:1px">YOUR COINS</div>
    <div class="row" style="gap:8px;margin-top:2px">${ic.coin(28)}<span class="mono" style="font-weight:900;font-size:32px">12,431</span><span class="mono" style="font-weight:800;opacity:.75;margin-top:8px">$12.43</span></div>
    <div class="row" style="gap:8px;margin-top:12px">
      <div style="flex:1;background:rgba(255,255,255,.1);border-radius:14px;padding:9px 10px"><div style="font-size:11px;font-weight:800;opacity:.7">EARNING</div><div class="mono" style="font-weight:900;font-size:16px">10.25<span style="font-size:11px;opacity:.7"> /mo</span></div></div>
      <div style="flex:1;background:linear-gradient(180deg,#9D74FF,#7A4BEA);border-radius:14px;padding:9px 10px"><div style="font-size:11px;font-weight:800;opacity:.85">BOOSTED 20×</div><div class="mono" style="font-weight:900;font-size:16px">$2.46<span style="font-size:11px;opacity:.85"> /yr</span></div></div>
    </div>
    <div class="row" style="gap:6px;margin-top:12px">${Object.entries(MIN).map(([k, c]) => `<div class="row" style="flex:1;justify-content:center;gap:4px;background:rgba(255,255,255,.1);border-radius:10px;padding:6px 0;${k === 'COAL' ? 'opacity:.4' : ''}">${ic.gem(17, c)}<b style="font-size:13px">${k === 'COAL' ? 0 : 1}</b></div>`).join('')}</div>
  </div>
  <div style="display:flex;flex-direction:column;gap:9px;margin-top:14px">
  ${parcels.slice(0, 3).map(([k, n, lv, r]) => `<div class="card" style="padding:12px;border-left:5px solid ${MIN[k]}"><div class="row"><div class="well" style="background:${MIN[k]}1F;width:40px;height:40px">${ic.gem(24, MIN[k])}</div><div style="flex:1"><div class="row" style="gap:6px"><b style="color:${MIN[k]};font-size:15px">${n}</b>${lv ? `<span style="background:var(--sunk);border-radius:6px;padding:1px 6px;font-size:10px;font-weight:900">LV ${lv}</span>` : ''}</div>
  <div class="row" style="gap:3px;margin-top:5px">${[0, 1, 2, 3, 4].map((i) => `<span style="width:14px;height:5px;border-radius:3px;background:${i < lv ? MIN[k] : 'var(--sunk)'}"></span>`).join('')}</div></div>
  <div style="text-align:right"><div class="mono" style="font-size:14px;font-weight:900">+${r}</div><div class="cap">coins / mo</div></div></div>
  <div class="row" style="margin-top:10px;gap:8px"><div class="btn" style="flex:1;height:38px;background:var(--accentSoft);color:var(--accent);font-size:13px">${ic.ad(14, '#2F5D50')} Upgrade · 20 WP</div><span class="cap">+0.15/mo</span></div></div>`).join('')}
  </div></div>${tabsNew('Land')}</div>`;

const section = (title, sub, before, after, notesB, notesA) => `<section><h2>${title}</h2><div class="cap" style="font-size:14px;color:inherit;opacity:.7">${sub}</div>
<div class="pairs"><div class="col"><span class="tag before">Now</span>${before}<ul class="notes">${notesB.map((n) => `<li>${n}</li>`).join('')}</ul></div>
<div class="col"><span class="tag after">Proposed</span>${after}<ul class="notes">${notesA.map((n) => `<li>${n}</li>`).join('')}</ul></div></div></section>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fareground UI Preview</title><link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&display=swap" rel="stylesheet"><style>${css}</style></head><body>
<h1>Fareground UI refresh</h1><p class="lede">Same colours, font, characters and dark-glass map style. Cleaner hierarchy, fewer floating buttons, bigger numbers where they matter.</p>
${section('Map', 'The screen people spend most time on', mapBefore, mapAfter,
  ['Six round buttons stacked down the right edge', 'The 🤗 emoji does not match the other icons', 'Claim panel: the WP you have and the price are far apart'],
  ['Coins and WP share one capsule; Boost stands out in violet', 'Map tools grouped into one slim rail, with a proper Community icon', 'Claim card shows your progress to the parcel and the +1 WP ad right beside the button', 'Floating tab bar in the same dark glass as the map'])}
${section('Walk', 'Steps and Walk Points', walkBefore, walkAfter,
  ['Steps, WP and the next parcel spread over four cards', 'A big health card even when everything works'],
  ['One green header: steps ring and WP side by side', 'Next parcel as one progress row', 'Daily chest and Free rewards as two tiles', 'Step health shrinks to one line when all is well'])}
${section('Land', 'Your parcels and earnings', landBefore, landAfter,
  ['Coin total is a small grey line', 'Every row has a full-width green upgrade bar'],
  ['Coin total and dollar value up top, big', 'Earning and boosted earning side by side', 'Each parcel is a card with its mineral colour and upgrade pips', 'Softer upgrade button so the list reads calmly'])}
</body></html>`;
require('fs').writeFileSync(__dirname + '/ui-preview.html', html);
console.log('ok', html.length);
