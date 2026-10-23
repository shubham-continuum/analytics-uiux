import { BASE, pwRequire } from './env.mjs';
// Browser smoke for the Prices dashboard. Run: node tests/smoke-prices.mjs [baseUrl]
// Playwright is loaded read-only from the original client's node_modules (nothing installed there).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { analyzePrices } from '../prices.js';

const require = pwRequire;
const { chromium } = require('playwright');
const PAGE = process.argv[2] || `${BASE}/analytics-analyzer-studio.html`;

const data = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
const fails = [];
const check = (cond, msg) => { if (!cond) fails.push(msg); console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); };

const browser = await chromium.launch({ channel: 'chrome' });
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await browser.newPage({ viewport: vp });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  const requests = [];
  page.on('request', r => requests.push(r.url()));
  await page.goto(`${PAGE}#stage=prices&tab=lmp&bus=111403`);
  await page.waitForSelector('.kpis', { timeout: 30000 });

  // Mean price KPI equals the core result for the same basis (latest complete RT year).
  const basis = await page.evaluate(() => JSON.parse(localStorage.getItem('gspreview.analyzer.v1')).basis);
  const core = analyzePrices(data, basis);
  const shown = await page.locator('.kpi .value').first().innerText();
  check(shown.startsWith(`$${core.summary.mean.toFixed(2)}`), `[${vp.width}] mean KPI ${shown} = core $${core.summary.mean.toFixed(2)} (${basis.years.join(',')})`);

  // Multi-year: last 3 complete, apply, KPI changes and audit lists 3 included years.
  await page.click('[data-act="basis-quick"][data-v="last3"]');
  await page.click('[data-act="apply-basis"]');
  const b3 = await page.evaluate(() => JSON.parse(localStorage.getItem('gspreview.analyzer.v1')).basis);
  const c3 = analyzePrices(data, b3);
  const shown3 = await page.locator('.kpi .value').first().innerText();
  check(b3.years.length === 3 && shown3.startsWith(`$${c3.summary.mean.toFixed(2)}`), `[${vp.width}] 3-year mean ${shown3} = core $${c3.summary.mean.toFixed(2)}`);
  check((await page.locator('tbody .pill.good', { hasText: /^Included$/ }).count()) === 3, `[${vp.width}] audit shows 3 included years`);

  for (const tab of ['basis', 'shape', 'tails']) {
    await page.click(`[data-act="tab"][data-v="${tab}"]`);
    await page.waitForSelector('.kpis');
    const vals = await page.locator('.kpi .value').allInnerTexts();
    check(vals.length === 6 && vals.every(v => v && !/NaN|undefined/.test(v)), `[${vp.width}] ${tab}: 6 KPIs ${JSON.stringify(vals)}`);
  }

  // Forecast mode: one run, no mixing.
  await page.click('[data-act="tab"][data-v="lmp"]');
  await page.click('[data-act="basis-mode"][data-v="forecast"]');
  await page.selectOption('[data-act="basis-run"]', 'pcr2030');
  await page.click('[data-act="apply-basis"]');
  check(await page.locator('.notice.error').isVisible(), `[${vp.width}] strict forecast with missing hours shows an error, not a number`);
  await page.click('[data-act="include-partial"]');
  const fv = await page.locator('.kpi .value').first().innerText();
  check(/^\$\d/.test(fv), `[${vp.width}] forecast mean ${fv}`);
  check(fv.startsWith('$47.17'), `[${vp.width}] pcr2030 mean = $47.17 (matches pack worked example)`);
  await page.selectOption('[data-act="basis-run"]', '5yr');
  await page.click('[data-act="apply-basis"]');
  if (await page.locator('[data-act="include-partial"]').count()) await page.click('[data-act="include-partial"]');
  check(await page.locator('.notice.warn', { hasText: '5-yr input under review' }).isVisible(), `[${vp.width}] Cape 5-yr warning shown at 111403`);

  // Unredesigned dashboard loads the isolated legacy copy.
  await page.click('[data-act="stage"][data-v="market"]');
  // 2026-10-23: Market's tabs are its own bar (the map, then its four analyzer tabs), as Land's and Grid's are
  check((await page.locator('.tabs button, .mk-bar .mk-tab-btn').count()) === 5, `[${vp.width}] market shows its map and four analyzer tabs`);

  const hscroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!hscroll, `[${vp.width}] no horizontal page scroll`);
  check(!requests.some(u => /:(5034|8101|8103)\b/.test(u)), `[${vp.width}] no requests to live services`);
  check(errors.length === 0, `[${vp.width}] console errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
  await page.screenshot({ path: `tests/shots/prices-${vp.width}.png`, fullPage: false });
  await page.evaluate(() => localStorage.clear());
  await page.close();
}
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
