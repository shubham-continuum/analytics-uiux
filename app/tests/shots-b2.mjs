import { BASE, pwRequire } from './env.mjs';
// Screenshots of the Phase B interactions: one element per shot, full panel.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const B = `${BASE}/analytics-analyzer-studio.html#`;
const SHOTS = [
  ['stage=prices&tab=shape', 'b2-prices-heatmap', '.panel:has(h2:text("Price by month and hour"))'],
  ['stage=prices&tab=tails', 'b2-prices-threshold', '.range-field:has-text("Hours above")'],
  ['stage=queue&tab=schedule', 'b2-queue-gantt', '.panel:has(h2:text("Study steps"))'],
  ['stage=queue&tab=cash', 'b2-queue-cash', '.panel:has(h2:text("By phase"))'],
  ['stage=queue&tab=cluster', 'b2-queue-list', '.panel:has(h2:has-text("Requests near"))'],
  ['stage=land&tab=corridor', 'b2-land-map', '.panel:has(h2:text("Place the site"))'],
  ['stage=economics&tab=revenue', 'b2-econ-sliders', '.panel:has(.range-field)'],
  ['stage=economics&tab=bess', 'b2-econ-week', '.panel:has(.week-bar)'],
  ['stage=decision&tab=stress', 'b2-decision-stress', '.panel:has(h2:text("Energy revenue per year by price scenario"))'],
  ['stage=decision&tab=readiness', 'b2-decision-go', '.panel:has(button:has-text("Go:"))'],
  ['stage=market&tab=find', 'b2-market-kpi', '.kpis'],
];
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
for (const [h, name, sel] of SHOTS) {
  await p.goto(B + h); await p.waitForSelector('.kpis', { timeout: 90000 }); await p.waitForTimeout(900);
  const el = p.locator(sel).first();
  if (!(await el.count())) { console.log('MISSING', name, sel); continue; }
  await el.scrollIntoViewIfNeeded(); await el.screenshot({ path: `tests/shots/${name}.png` }); console.log('ok', name);
}
// Queue drawer + land click
await p.goto(B + 'stage=queue&tab=cluster'); await p.waitForSelector('.kpis'); await p.waitForTimeout(800);
const r = p.locator('tr.clickable[data-open-drawer^="q-"]').first();
if (await r.count()) { await r.dispatchEvent('click'); await p.waitForTimeout(300); console.log('drawer', await p.locator('.drawer').count()); await p.screenshot({ path: 'tests/shots/b2-queue-drawer.png' }); }
await p.goto(B + 'stage=land&tab=corridor'); await p.waitForSelector('.kpis'); await p.waitForTimeout(800);
const m = p.locator('svg[data-site-map]');
if (await m.count()) { await m.scrollIntoViewIfNeeded(); const bb = await m.boundingBox(); await p.mouse.click(bb.x + bb.width * 0.75, bb.y + bb.height * 0.3); await p.waitForTimeout(500); await p.locator('.panel:has(h2:text("Place the site"))').screenshot({ path: 'tests/shots/b2-land-placed.png' }); console.log('site dot', await p.locator('svg[data-site-map] circle[fill="#b76d44"]').count(), await p.evaluate(() => localStorage.getItem('gspreview.analyzer.v1')?.match(/"site(Lat|Lon)":[^,}]*/g))); }
console.log('page errors', errs);
await b.close();
