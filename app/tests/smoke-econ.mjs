import { BASE, pwRequire } from './env.mjs';
// Browser smoke for Economics: KPIs match the cores on the same inputs; missing finance inputs stay incomplete.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await b.newPage({ viewport: vp }); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=economics&tab=revenue&bus=111403`);
  await page.waitForSelector('.kpis', { timeout: 60000 });
  let v = await page.locator('.kpi .value').allInnerTexts();
  check(/^\$\d/.test(v[0]) && /^\$\d/.test(v[1]), `[${vp.width}] solar revenue KPIs ${JSON.stringify(v)}`);
  check(await page.locator('text=conditional').first().isVisible(), `[${vp.width}] capacity shown as conditional`);
  await page.selectOption('[data-act="export"]', '250');
  check(await page.locator('text=Does not fit without network upgrades').isVisible(), `[${vp.width}] 250 MW over the 152.8 MW limit: all streams conditional`);
  await page.selectOption('[data-act="export"]', '100');
  await page.click('[data-act="tab"][data-v="bess"]'); await page.waitForSelector('.kpis', { timeout: 60000 });
  v = await page.locator('.kpi .value').allInnerTexts();
  check(/^\$\d/.test(v[0]) && /^\d+/.test(v[1]), `[${vp.width}] BESS KPIs ${JSON.stringify(v)}`);
  check(await page.locator('text=perfect-foresight ceiling').first().isVisible(), `[${vp.width}] BESS labelled perfect-foresight`);
  // S2-EM F008: the old assertion pinned the shoulder-only cap text (the defect); the card now names the governing caps.
  check(await page.locator('text=Shoulder charge governs').first().isVisible(), `[${vp.width}] charge cap names the governing case (shoulder) and any summer-peak screening cap`);
  await page.click('[data-act="tab"][data-v="hybrid"]'); await page.waitForSelector('.kpis', { timeout: 60000 });
  v = await page.locator('.kpi .value').allInnerTexts();
  check(v.every(x => !/NaN|undefined/.test(x)), `[${vp.width}] hybrid KPIs ${JSON.stringify(v)}`);
  await page.click('[data-act="tab"][data-v="finance"]');
  check(await page.locator('text=Incomplete valuation').isVisible(), `[${vp.width}] finance incomplete until inputs entered`);
  for (const [k, val] of [['capex', '120000000'], ['annualOM', '2000000'], ['discountRate', '0.08'], ['years', '20.5'], ['annualRevenue', '9000000'], ['constructionYears', '1']]) {
    await page.fill(`[data-act="fin"][data-k="${k}"]`, val); await page.locator(`[data-act="fin"][data-k="${k}"]`).dispatchEvent('change');
  }
  check(await page.locator('text=must be a whole number').isVisible(), `[${vp.width}] invalid years rejected without crashing`);
  await page.fill('[data-act="fin"][data-k="years"]', '20'); await page.locator('[data-act="fin"][data-k="years"]').dispatchEvent('change');
  v = await page.locator('.kpi .value').allInnerTexts();
  check(/\$/.test(v[0]) && await page.locator('text=grid upgrade scope is not fully priced').isVisible(), `[${vp.width}] finance NPV ${JSON.stringify(v)} flagged incomplete without a Grid cost scenario`);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); check(!hs, `[${vp.width}] no horizontal scroll`);
  check(!errors.length, `[${vp.width}] console errors: ${errors.join(' | ') || 'none'}`);
  await page.screenshot({ path: `tests/shots/econ-${vp.width}.png`, fullPage: true });
  await page.evaluate(() => localStorage.clear()); await page.close();
}
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
