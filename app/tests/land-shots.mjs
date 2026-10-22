import { BASE, pwRequire } from './env.mjs';
// Land screenshots: all 4 tabs at 1440 and 390 for a screened bus (and the corridor with a placed site and inputs).
// Usage: node tests/land-shots.mjs [bus]
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const bus = process.argv[2] || '111403';
const b = await chromium.launch({ channel: 'chrome' });
const errors = [];
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const p = await b.newPage({ viewport: vp });
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e)));
  await p.goto(`${BASE}/land.html#tab=area&bus=${bus}`);
  await p.waitForSelector('.kpis', { timeout: 120000 });
  for (const tab of ['area', 'footprint', 'corridor', 'permits']) {
    await p.click(`[data-act="tab"][data-v="${tab}"]`);
    await p.waitForSelector('.kpis'); await p.waitForTimeout(1500);
    await p.screenshot({ path: `tests/shots/land-${tab}-${vp.width}.png`, fullPage: true });
  }
  await p.close();
}
console.log(errors.length ? `console errors: ${errors.join(' | ')}` : 'no console errors');
await b.close();
