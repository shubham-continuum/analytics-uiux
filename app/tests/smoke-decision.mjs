import { BASE, pwRequire } from './env.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = pwRequire;
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await b.newPage({ viewport: vp }); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=decision&tab=compare&bus=111403`);
  await page.waitForSelector('.kpis', { timeout: 60000 });
  for (const tab of ['compare', 'stress', 'readiness', 'record']) {
    await page.click(`[data-act="tab"][data-v="${tab}"]`); await page.waitForTimeout(300);
    const n = await page.locator('.kpi .value').count(); const vals = await page.locator('.kpi .value').allInnerTexts();
    check(tab === 'record' ? true : (n >= 3 && vals.every(x => !/NaN|undefined/.test(x))), `[${vp.width}] ${tab} ${JSON.stringify(vals)}`);
  }
  await page.click('[data-act="tab"][data-v="compare"]');
  check(await page.locator('text=Gate: Connect').isVisible(), `[${vp.width}] gate rows shown`);
  // v5: per-fuel verdict with editable thresholds (default = assumption, override = your input); evidence pack.
  check(await page.locator('h3:has-text("Per-fuel verdict")').isVisible(), `[${vp.width}] per-fuel verdict card`);
  check(await page.locator('.card:has(h3:text("Thresholds")) .pill:text("assumption")').first().isVisible(), `[${vp.width}] threshold defaults labelled assumption`);
  await page.fill('[data-act="ui"][data-k="dTh_capture"]', '85'); await page.locator('[data-act="ui"][data-k="dTh_capture"]').dispatchEvent('change'); await page.waitForTimeout(300);
  check(await page.locator('.card:has(h3:text("Thresholds")) .pill:text("your input")').first().isVisible(), `[${vp.width}] threshold override labelled your input`);
  await page.click('[data-act="tab"][data-v="record"]');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('button[data-pack]')]);
  const xml = readFileSync(await dl.path(), 'utf8');
  const sheets = [...xml.matchAll(/<Worksheet ss:Name="([^"]*)"/g)].map(m => m[1]);
  check(xml.startsWith('<?xml') && sheets.slice(0, 3).join() === 'Summary,Assumptions,Contents' && sheets.length > 5, `[${vp.width}] evidence pack: ${sheets.length} sheets (${sheets.slice(0, 6).join(' | ')} …)`);
  check(sheets.every(n => n.length <= 31 && !/[[\]:*?/\\]/.test(n)) && /your input/.test(xml) && !/NaN/.test(xml), `[${vp.width}] pack sheet names valid, override recorded, no NaN`);
  await page.click('[data-act="tab"][data-v="compare"]'); await page.fill('[data-act="ui"][data-k="dTh_capture"]', ''); await page.locator('[data-act="ui"][data-k="dTh_capture"]').dispatchEvent('change'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-v="record"]');
  await page.selectOption('[data-act="d-form"][data-k="status"]', 'Hold');
  await page.fill('[data-act="d-form"][data-k="why"]', 'Test rationale'); await page.locator('[data-act="d-form"][data-k="why"]').dispatchEvent('change');
  await page.click('[data-act="record-decision"]');
  check(await page.locator('text=Same inputs as now').first().isVisible(), `[${vp.width}] decision recorded as a snapshot`);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); check(!hs, `[${vp.width}] no horizontal scroll`);
  check(!errors.length, `[${vp.width}] console errors: ${errors.join(' | ') || 'none'}`);
  await page.evaluate(() => localStorage.clear()); await page.close();
}
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
