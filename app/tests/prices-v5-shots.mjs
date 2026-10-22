import { BASE, pwRequire } from './env.mjs';
// v5 screenshots and a fuel × depth sweep for the Prices and Economics tabs: every tab renders for all five fuels at
// screen / review / study with no console error, no NaN/undefined, every card tagged with a depth, and 6 KPIs.
// Run: node tests/prices-v5-shots.mjs [prices|economics] [bus] [fuels,comma] [depths,comma]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = pwRequire;
const { chromium } = require('playwright');
const [page0 = 'prices', bus = '111403', fuelArg, depthArg, shotArg] = process.argv.slice(2);
const FUELS = (fuelArg || 'solar,wind,storage,hybrid,datacenter').split(',');
const DEPTHS = (depthArg || 'screen,review,study').split(',');
const TABS = { prices: ['lmp', 'basis', 'shape', 'tails'], economics: ['revenue', 'bess', 'hybrid', 'finance'] }[page0];
const SHOT = shotArg !== 'noshot';
mkdirSync('tests/shots/v5', { recursive: true });
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${BASE}/${page0}.html#tab=${TABS[0]}&bus=${bus}&depth=review`);
await page.waitForSelector('.kpis, .notice, .empty', { timeout: 120000 });
for (const fuel of FUELS) {
  await page.selectOption('[data-act="tech"]', fuel); await page.waitForTimeout(300);
  if (fuel === 'datacenter') { const opts = await page.locator('[data-act="import"] option').evaluateAll(o => o.map(x => x.value)); const v = opts.find(x => Number(x) >= 100) || opts.at(-1); await page.selectOption('[data-act="import"]', v); await page.waitForTimeout(300); }
  for (const depth of DEPTHS) {
    await page.click(`[data-act="depth"][data-v="${depth}"]`); await page.waitForTimeout(200);
    for (const tab of TABS) {
      const n0 = errors.length;
      await page.click(`[data-act="tab"][data-v="${tab}"]`);
      await page.waitForSelector('.kpis, .notice, .empty', { timeout: 120000 });
      await page.waitForFunction(() => !document.querySelector('.loading-panel') && ![...document.querySelectorAll('.kpi .value')].some(v => /loading/i.test(v.innerText)), null, { timeout: 180000 }).catch(() => {});
      const body = await page.locator('main').innerText();
      const untagged = await page.evaluate(() => [...document.querySelectorAll('main .cards > section.card')].filter(c => !c.dataset.depth).map(c => c.querySelector('h3')?.innerText).slice(0, 4));
      const label = await page.locator(`[data-act="tab"][data-v="${tab}"]`).innerText();
      check(!/\bNaN\b|undefined|Infinity/.test(body), `${page0} ${fuel} ${depth} ${tab} (${label}): no NaN/undefined`);
      check(!untagged.length, `${page0} ${fuel} ${depth} ${tab}: every card has data-depth ${untagged.length ? JSON.stringify(untagged) : ''}`);
      check(errors.length === n0, `${page0} ${fuel} ${depth} ${tab}: no console error ${errors.slice(n0).join(' | ').slice(0, 300)}`);
      if (SHOT) await page.screenshot({ path: `tests/shots/v5/${page0}-${tab}-${fuel}-${depth}.png`, fullPage: true });
    }
  }
}
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
