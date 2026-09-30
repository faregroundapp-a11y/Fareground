const { chromium } = require('/opt/node22/lib/node_modules/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
  await p.goto('file://' + __dirname + '/promo.html?record');
  await p.evaluate(() => document.fonts.ready);
  const out = process.argv[2];
  for (const t of [1.6, 4.8, 9.5, 15, 21.6, 25.8, 30, 33]) {
    await p.evaluate((t) => window.render(t), t);
    await p.screenshot({ path: `${out}/s_${t}.png` });
  }
  await b.close();
})();
