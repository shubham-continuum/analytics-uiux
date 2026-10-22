import { BASE, pwRequire } from './env.mjs';
// Market screenshots: all four tabs at 1440 and 390, console errors reported. node tests/market-shots.mjs [bus]
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const bus = process.argv[2] || '111403';
const b = await chromium.launch({ channel: 'chrome' });
let bad = 0;
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await b.newPage({ viewport: vp }); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/market.html#tab=find&bus=${bus}`);
  await page.waitForSelector('.kpis', { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('.notice[role="status"]'), null, { timeout: 120000 }).catch(() => {});
  for (const tab of ['find', 'rank', 'size', 'regions']) {
    await page.click(`[data-act="tab"][data-v="${tab}"]`); await page.waitForSelector('.kpis');
    await page.waitForFunction(() => !document.querySelector('.notice[role="status"]'), null, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(400);
    const txt = await page.locator('main').innerText();
    const nan = (txt.match(/NaN|undefined|Infinity/g) || []).length;
    const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    console.error(`${vp.width} ${tab}: cards=${await page.locator('.card').count()} charts=${await page.locator('.chart-host').count()} tables=${await page.locator('table').count()} NaN/undef=${nan} hscroll=${hs}`);
    if (nan || hs) bad++;
    await page.screenshot({ path: `tests/shots/market-${tab}-${vp.width}.png`, fullPage: true, timeout: 120000 });
  }
  if (errors.length) { bad++; console.log('ERRORS', errors.join(' | ')); }
  await page.close();
}
await b.close(); process.exit(bad ? 1 : 0);
