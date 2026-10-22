import { BASE, pwRequire } from './env.mjs';
// Grid screenshots: every tab at 1440 and 390 on one bus (argv[2], default 111403), tech (argv[3], default solar).
// Writes tests/shots/grid-<tab>-<width>.png (full page) and prints console errors.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const bus = process.argv[2] || '111403', tech = process.argv[3] || 'solar', tabs = (process.argv[4] || 'capacity,constraints,cost,mitigation').split(',');
const b = await chromium.launch({ channel: 'chrome' });
const errors = [];
for (const width of [1440, 390]) {
  const p = await b.newPage({ viewport: { width, height: 900 } });
  p.on('console', m => { if (m.type() === 'error') errors.push(`[${width}] ${m.text()}`); }); p.on('pageerror', e => errors.push(`[${width}] ${e}`));
  await p.goto(`${BASE}/grid.html#tab=capacity&bus=${bus}`); await p.waitForSelector('.kpis', { timeout: 120000 });
  if (tech !== 'keep') { await p.selectOption('[data-act="tech"]', tech); await p.waitForTimeout(300); }
  for (const tab of tabs) {
    await p.click(`[data-act="tab"][data-v="${tab}"]`); await p.waitForSelector('.kpis');
    await p.waitForTimeout(7000); // async grid context endpoint
    await p.screenshot({ path: `tests/shots/grid-${tab}-${width}.png`, fullPage: true });
  }
  await p.close();
}
await b.close();
console.log(errors.length ? errors.join('\n') : 'no console errors');
