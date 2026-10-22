import { BASE, pwRequire } from './env.mjs';
// Debug: the smoke-econ 390 px path (combined page, revenue tab), with timings and errors.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 390, height: 844 } });
page.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
page.on('pageerror', e => console.log('pageerror', String(e)));
page.on('requestfailed', r => console.log('requestfailed', r.url(), r.failure()?.errorText));
const t0 = Date.now();
await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=economics&tab=revenue&bus=111403`);
console.log('loaded', Date.now() - t0);
for (let i = 0; i < 40; i++) {
  const n = await page.locator('.kpis').count(), vis = n ? await page.locator('.kpis').first().isVisible() : false;
  if (vis) { console.log('kpis visible', Date.now() - t0); break; }
  if (i % 5 === 0) console.log(i, 'kpis', n, (await page.locator('main').innerText().catch(() => '')).slice(0, 200).replace(/\s+/g, ' '));
  await page.waitForTimeout(2000);
}
await page.screenshot({ path: 'tests/shots/econ-debug-390.png' });
await b.close();
