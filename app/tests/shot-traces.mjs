import { BASE, pwRequire } from './env.mjs';
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const [page0, bus, list] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
for (const item of list.split(',')) {
  const [tab, id] = item.split(':');
  await p.goto(`${BASE}/${page0}.html#tab=${tab}&bus=${bus}`); await p.waitForSelector('.kpis', { timeout: 120000 }); await p.waitForTimeout(500);
  const t = p.locator(`details.trace[data-trace="${id}"]`); await t.evaluate(d => { d.open = true; }); await p.waitForTimeout(150);
  await t.screenshot({ path: `tests/shots/trace-${id}.png` }); console.log('shot', id);
}
await b.close();
