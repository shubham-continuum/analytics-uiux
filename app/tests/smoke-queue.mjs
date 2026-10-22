import { BASE, pwRequire } from './env.mjs';
import { createRequire } from 'node:module';
import * as RX from '../rules/isone.js';
const require = pwRequire;
// S3 (2026-10-06): the default process profile is ISO-NE Schedule 22 (flat $800k total at 100 MW), not the pro forma
// $455k the pre-S3 check typed; the expected figure is the engine's own (rules/isone.js entryCost), never a typed number.
const ENTRY = RX.entryCost({ mw: 100 });
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await b.newPage({ viewport: vp }); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=queue&tab=cluster&bus=111403`);
  await page.waitForSelector('.kpis', { timeout: 30000 });
  for (const tab of ['cluster', 'schedule', 'cash', 'changes']) {
    await page.click(`[data-act="tab"][data-v="${tab}"]`); await page.waitForSelector('.kpis');
    const vals = await page.locator('.kpi .value').allInnerTexts();
    check(vals.length >= 4 && vals.every(x => !/NaN|undefined|Infinity/.test(x)), `[${vp.width}] ${tab} KPIs ${JSON.stringify(vals)}`);
    const cards = await page.locator('section.card').count(), charts = await page.locator('.chart-host').count(), tables = await page.locator('table.dense').count();
    check(cards >= 6 && charts >= 2 && tables >= 1, `[${vp.width}] ${tab}: ${cards} cards, ${charts} charts, ${tables} tables`);
  }
  await page.click('[data-act="tab"][data-v="cash"]');
  const cash = await page.locator('.kpi .value').first().innerText();
  check(ENTRY.status === 'ok' && cash.startsWith(RX.usdK(ENTRY.total)), `[${vp.width}] cost to enter at 100 MW = ${ENTRY.status === 'ok' ? `${RX.usdK(ENTRY.total)} (${ENTRY.text} · ${ENTRY.cite.text})` : ENTRY.reason}: ${cash}`);
  check(await page.locator('[role="tabpanel"] >> text=not held').first().isVisible(), `[${vp.width}] NU-based items not held without a Grid cost scenario`);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); check(!hs, `[${vp.width}] no horizontal scroll`);
  check(!errors.length, `[${vp.width}] console errors: ${errors.join(' | ') || 'none'}`);
  await page.evaluate(() => localStorage.clear()); await page.close();
}
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
