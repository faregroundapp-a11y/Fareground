// Preview: the sign-in screen with the Google button (light + dark), the
// first-time tutorial and the weekly summary card.
const S = '/tmp/claude-0/-home-user-Fareground/bb0f6094-9845-5b93-a9b3-45d8e56f1b29/scratchpad/av';
const { load, React, renderToStaticMarkup, APP } = require(S + '/harness');
const I = load(APP + '/src/components/icons.tsx');
const { Runner } = load(APP + '/src/components/Runner.tsx');
const R = (C, p) => renderToStaticMarkup(React.createElement(C, p));
const T = {
  light: { bg: '#F4F5F1', card: '#FFFFFF', sunk: '#ECEEE8', line: '#E0E3DB', ink: '#121814', ink2: '#545E51', ink3: '#8A9386', accent: '#2F5D50', accentSoft: '#E1EBE6' },
  dark: { bg: '#0F1512', card: '#18201C', sunk: '#222B26', line: '#2B3530', ink: '#EEF2EC', ink2: '#B6C0B3', ink3: '#859081', accent: '#4E9C83', accentSoft: '#1D332C' },
};
const signin = (t) => `<div class="phone" style="background:${t.bg};color:${t.ink}">
  <div style="padding:46px 26px 0;display:flex;flex-direction:column;align-items:center">
    <div style="width:64px;height:64px;border-radius:18px;background:${t.accent};display:grid;place-items:center">${R(Runner, { gait: 'idle', size: 40 })}</div>
    <div style="font-weight:900;font-size:34px;letter-spacing:-1px;margin-top:8px">Fare<span style="color:${t.accent}">ground</span></div>
    <div style="font-weight:600;font-size:13.5px;color:${t.ink2};text-align:center;margin-top:6px;line-height:1.4">Walk the real world. Claim the ground you cover.</div>
  </div>
  <div style="padding:20px 26px">
    <div style="display:flex;background:${t.sunk};border-radius:999px;padding:4px"><div style="flex:1;height:40px;border-radius:999px;background:${t.card};border:1px solid ${t.line};display:grid;place-items:center;font-weight:800">Sign in</div><div style="flex:1;display:grid;place-items:center;font-weight:700;color:${t.ink2}">Create account</div></div>
    <div style="margin-top:16px;height:52px;border-radius:10px;background:#fff;border:1px solid #DADCE0;box-shadow:0 1px 4px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;gap:10px;font-weight:700;font-size:16px;color:#3C4043">${R(I.GoogleIcon, { size: 22 })}Sign in with Google</div>
    <div style="display:flex;align-items:center;gap:12px;margin:18px 0;color:${t.ink3};font-size:12px;font-weight:700"><div style="flex:1;height:1px;background:${t.line}"></div>or with email<div style="flex:1;height:1px;background:${t.line}"></div></div>
    ${['EMAIL', 'PASSWORD'].map((l) => `<div style="font-size:11px;font-weight:800;letter-spacing:1px;color:${t.ink3};margin:0 0 6px">${l}</div><div style="height:50px;border-radius:14px;background:${t.card};border:1px solid ${t.line};margin-bottom:12px;display:flex;align-items:center;justify-content:flex-end;padding-right:14px;color:${t.accent};font-weight:800;font-size:13px">${l === 'PASSWORD' ? 'Show' : ''}</div>`).join('')}
    <div style="height:52px;border-radius:16px;background:${t.accent};color:#fff;display:grid;place-items:center;font-weight:900;font-size:16px;margin-top:4px">Sign in</div>
    <div style="text-align:center;margin-top:16px;color:${t.accent};font-weight:800;font-size:14px">Forgot password?</div>
  </div></div>`;
const tutorial = (t) => `<div class="phone" style="background:#5d6660">
  <div style="position:absolute;inset:0;background:rgba(8,12,10,.6);display:flex;align-items:center;padding:16px">
  <div style="background:${t.card};color:${t.ink};border-radius:26px;padding:22px;display:flex;flex-direction:column;gap:12px;width:100%">
    <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:800;letter-spacing:1px;color:${t.ink3}">WELCOME TO FAREGROUND<span style="letter-spacing:0;font-size:14px">Skip</span></div>
    <div style="height:150px;border-radius:20px;background:${t.sunk};display:flex;align-items:center;justify-content:center;gap:18px">${R(Runner, { gait: 'idle', size: 84 })}<div style="width:64px;height:64px;border-radius:20px;background:${t.accentSoft};display:grid;place-items:center">${R(I.StepsIcon, { size: 34 })}</div></div>
    <div style="font-weight:900;font-size:26px;letter-spacing:-.6px">Walk to earn</div>
    <div style="font-weight:600;font-size:15px;line-height:1.45;color:${t.ink2}">Every 100 steps you walk becomes a Walk Point. Your steps count even with the app closed.</div>
    <div style="display:flex;gap:6px;justify-content:center;margin:6px 0"><span style="width:22px;height:8px;border-radius:4px;background:${t.accent}"></span><span style="width:8px;height:8px;border-radius:4px;background:${t.line}"></span><span style="width:8px;height:8px;border-radius:4px;background:${t.line}"></span></div>
    <div style="height:52px;border-radius:16px;background:${t.accent};color:#fff;display:grid;place-items:center;font-weight:900;font-size:16px">Next</div>
  </div></div></div>`;
const week = (t) => {
  const steps = [6200, 9100, 3400, 0, 12800, 7600, 4200];
  const max = Math.max(...steps, 7500);
  const L = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  return `<div class="phone" style="background:${t.bg};color:${t.ink}"><div style="padding:46px 16px 0">
  <div style="font-weight:900;font-size:24px;margin-bottom:12px">Walk tab</div>
  <div style="background:${t.card};border:1px solid ${t.line};border-radius:20px;padding:16px">
    <div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:15px">This week</b><span style="font-weight:800;font-size:13px;color:${t.ink2}">43,300 steps</span></div>
    <div style="display:flex;gap:6px;height:96px;margin-top:12px">${steps.map((s, i) => `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px"><div style="flex:1;width:100%;background:${t.sunk};border-radius:8px;display:flex;align-items:flex-end;overflow:hidden"><div style="width:100%;height:${s ? Math.max(6, (s / max) * 100) : 0}%;border-radius:8px;background:${i === 6 ? '#F2A93B' : i === 4 ? t.accent : '#4DBE94'}"></div></div><span style="font-size:11px;font-weight:${i === 6 ? 900 : 700};color:${i === 6 ? t.ink : t.ink3}">${L[i]}</span></div>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:12px">${[['433', 'Walk Points'], ['3', 'parcels claimed'], ['5', 'doorbells rung']].map(([v, l]) => `<div style="flex:1;background:${t.sunk};border-radius:14px;padding:10px"><div style="font-weight:900;font-size:18px">${v}</div><div style="font-size:11px;font-weight:700;color:${t.ink3}">${l}</div></div>`).join('')}</div>
    <div style="font-size:12px;font-weight:700;color:${t.ink3};margin-top:8px">Best day: Thursday with 12,800 steps</div>
  </div>
  <div style="margin-top:14px;background:${t.card};border:1px solid ${t.line};border-radius:20px;padding:14px">
    <b style="font-size:15px">Distances</b>
    <div style="display:flex;gap:4px;background:${t.sunk};border-radius:14px;padding:4px;margin-top:8px"><div style="flex:1;height:38px;border-radius:10px;background:${t.card};border:1px solid ${t.line};display:grid;place-items:center;font-weight:800;font-size:13px">Metres &amp; km</div><div style="flex:1;display:grid;place-items:center;font-weight:700;font-size:13px;color:${t.ink3}">Feet &amp; miles</div></div>
    <b style="font-size:15px;display:block;margin-top:14px">Theme</b>
    <div style="display:flex;gap:4px;background:${t.sunk};border-radius:14px;padding:4px;margin-top:8px">${['Phone', 'Light', 'Dark'].map((x) => `<div style="flex:1;height:38px;border-radius:10px;display:grid;place-items:center;font-weight:800;font-size:13px;${x === (t === T.dark ? 'Dark' : 'Phone') ? `background:${t.card};border:1px solid ${t.line}` : `color:${t.ink3}`}">${x}</div>`).join('')}</div>
    <div style="font-size:11.5px;font-weight:700;color:${t.ink3};margin-top:6px">In Settings</div>
  </div></div></div>`;
};
const css = `*{box-sizing:border-box;margin:0;padding:0}body{background:#E9ECE6;font-family:Nunito,system-ui,sans-serif;padding:24px 16px}
h1{text-align:center;font-weight:900;font-size:26px;margin-bottom:6px}.lede{text-align:center;font-weight:700;color:#545E51;margin-bottom:18px}
.grid{display:flex;flex-wrap:wrap;gap:22px;justify-content:center}.col{display:flex;flex-direction:column;align-items:center;gap:8px}
.tag{font-weight:900;font-size:12px;letter-spacing:1px;padding:4px 12px;border-radius:999px;background:#2F5D50;color:#fff}
.phone{position:relative;width:330px;height:680px;border-radius:40px;overflow:hidden;border:9px solid #10151B;box-shadow:0 18px 40px rgba(0,0,0,.25)}`;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>New Features Preview</title><link href="https://fonts.googleapis.com/css2?family=Nunito:wght@600;700;800;900&display=swap" rel="stylesheet"><style>${css}</style></head><body>
<h1>New features</h1><p class="lede">Google sign-in, forgot password, first-time tutorial, weekly summary, distance and theme settings.</p>
<div class="grid">
<div class="col"><span class="tag">SIGN IN · LIGHT</span>${signin(T.light)}</div>
<div class="col"><span class="tag">SIGN IN · DARK</span>${signin(T.dark)}</div>
<div class="col"><span class="tag">FIRST-TIME TUTORIAL</span>${tutorial(T.light)}</div>
<div class="col"><span class="tag">WEEKLY SUMMARY · SETTINGS (DARK)</span>${week(T.dark)}</div>
</div></body></html>`;
require('fs').writeFileSync(__dirname + '/features.html', html);
console.log('ok');
