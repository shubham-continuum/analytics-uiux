import { BASE, pwRequire } from './env.mjs';
// Screenshots of the four Queue tabs at 1440 and 390 px: node tests/queue-shots.mjs [bus]
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const bus = process.argv[2] || '111403';
const b = await chromium.launch({ channel: 'chrome' });
const errors = [];
for (const w of [1440, 390]) {
  const page = await b.newPage({ viewport: { width: w, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  for (const tab of ['cluster', 'schedule', 'cash', 'changes']) {
    await page.goto(`${BASE}/queue.html#tab=${tab}&bus=${bus}`);
    await page.waitForSelector('.kpis', { timeout: 120000 }); await page.waitForTimeout(700);
    await page.screenshot({ path: `tests/shots/queue-${tab}-${w}.png`, fullPage: true });
    console.log(`${w} ${tab}: ${JSON.stringify(await page.locator('.kpi .value').allInnerTexts())}`);
  }
  await page.close();
}
console.log(errors.length ? `console errors: ${errors.join(' | ')}` : 'no console errors');
await b.close();
