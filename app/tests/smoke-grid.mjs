import { BASE, pwRequire } from './env.mjs';
// Browser smoke for the Grid dashboard.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { caseTable, binding, stepCost, stepCostService } from '../gridrules.js';
const require = pwRequire;
const { chromium } = require('playwright');
const grid = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url))).grid;
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await b.newPage({ viewport: vp }); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=grid&tab=capacity&bus=111403`);
  await page.waitForSelector('.kpis');
  const v = await page.locator('.kpi .value').allInnerTexts();
  const ex = binding(caseTable(grid, 111403, 'solar', 100, 0), 'export');
  check(v[0].startsWith(`${ex.value.toFixed(1)} MW`), `[${vp.width}] export limit ${v[0]} = core ${ex.value}`);
  check(await page.locator('text=sources disagree').first().isVisible(), `[${vp.width}] envelope/element disagreement flagged`);
  await page.selectOption('[data-act="export"]', '250');
  await page.click('[data-act="tab"][data-v="cost"]'); await page.waitForSelector('.kpis');
  const k = await page.locator('.kpi .value').first().innerText();
  const sc = stepCost(grid, 111403, 'summer_peak|discharge', 250);
  // P2 C10: shoulder export is envelope-only, so the engine calls the total a lower bound and the KPI must print '≥ ' (was a bare '$').
  const lb = ['Lower bound', 'Partly priced'].includes(stepCostService(grid, 111403, 'solar', 250, 0).status) ? '≥ ' : '';
  check(k.startsWith(`${lb}$${sc.total.toFixed(2)}M`), `[${vp.width}] known subtotal ${k} = step cost $${sc.total}M`);
  await page.fill('[data-act="alloc"][data-id="direct"][data-f="cost"]', '1.5'); await page.locator('[data-act="alloc"][data-id="direct"][data-f="cost"]').dispatchEvent('change');
  const k2 = await page.locator('.kpi .value').first().innerText();
  check(k2.startsWith(`${lb}$${(sc.total + 1.5).toFixed(2)}M`), `[${vp.width}] edited direct cost adds to subtotal ${k2}`);
  for (const tab of ['constraints', 'mitigation']) { await page.click(`[data-act="tab"][data-v="${tab}"]`); await page.waitForSelector('.kpis'); const vals = await page.locator('.kpi .value').allInnerTexts(); check(vals.length >= 3 && vals.every(x => !/NaN|undefined/.test(x)), `[${vp.width}] ${tab} KPIs ${JSON.stringify(vals)}`); }
  await page.selectOption('[data-act="tech"]', 'storage'); await page.click('[data-act="tab"][data-v="capacity"]');
  check(await page.locator('text=never checked at summer peak').or(page.locator('text=does not study storage charging at summer peak')).first().isVisible(), `[${vp.width}] storage shoulder-only note`);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); check(!hs, `[${vp.width}] no horizontal scroll`);
  check(!errors.length, `[${vp.width}] console errors: ${errors.join(' | ') || 'none'}`);
  await page.evaluate(() => localStorage.clear()); await page.close();
}
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
