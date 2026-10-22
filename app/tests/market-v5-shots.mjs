import { BASE, pwRequire } from './env.mjs';
// Market v5: fuels × depths on the four tabs (1440 px), with the upgrade-cost and curtailment screens switched on.
// Screenshots to tests/shots/v5/market-<tech>-<depth>-<tab>.png; reports console errors, NaN and render time.
// node tests/market-v5-shots.mjs [techs] [depths]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = pwRequire;
const { chromium } = require('playwright');
const [techs = 'solar,wind,storage,hybrid,datacenter', depths = 'screen,review,study'] = process.argv.slice(2);
mkdirSync('tests/shots/v5', { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], notes = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${BASE}/market.html#tab=find&bus=111403&depth=review`);
await page.waitForSelector('.kpis', { timeout: 120000 });
await page.waitForFunction(() => !/Loading the (extra|curtail)/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(3000);
const setNum = async (k, v) => { const l = page.locator(`[data-act="mkt"][data-k="${k}"]`); if (!(await l.count())) return false; await l.fill(v); const t = Date.now(); await l.dispatchEvent('change'); await page.waitForTimeout(200); await page.waitForSelector('.kpis'); return Date.now() - t; };
for (const tech of techs.split(',')) {
  await page.selectOption('[data-act="tech"]', tech); await page.waitForTimeout(500);
  await page.click('[data-act="tab"][data-v="find"]');
  const t1 = await setNum('maxUpgrade', '5'), t2 = await setNum('maxCurtail', '2');
  notes.push(`${tech}: upgrade screen render ${t1} ms, curtail ${t2 === false ? 'n/a' : `${t2} ms`}`);
  for (const depth of depths.split(',')) {
    await page.click(`[data-act="depth"][data-v="${depth}"]`); await page.waitForTimeout(300);
    for (const tab of ['find', 'rank', 'size', 'regions']) {
      await page.click(`[data-act="tab"][data-v="${tab}"]`); await page.waitForSelector('.kpis'); await page.waitForTimeout(600);
      const txt = await page.locator('[role="tabpanel"]').innerText();
      if (/\bNaN\b|undefined|Infinity/.test(txt)) notes.push(`${tech}/${depth}/${tab}: NaN/undefined`);
      notes.push(`${tech}/${depth}/${tab}: ${await page.locator('[role="tabpanel"] section.card:not([hidden])').count()} cards`);
      await page.screenshot({ path: `tests/shots/v5/market-${tech}-${depth}-${tab}.png`, fullPage: true });
    }
  }
  await page.click('[data-act="tab"][data-v="find"]'); await setNum('maxUpgrade', ''); await setNum('maxCurtail', '');
}
await b.close();
console.log(notes.join('\n'));
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
