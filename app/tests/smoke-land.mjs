import { BASE, pwRequire } from './env.mjs';
// Land smoke: 4 tabs × 2 viewports on a screened bus, plus an unscreened geo_proxy bus; lease-vs-buy and permits inputs.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const U = `${BASE}/land.html`;
const b = await chromium.launch({ channel: 'chrome' });
const settle = async p => { await p.waitForSelector('.kpis', { timeout: 120000 }); await p.waitForFunction(() => !document.querySelector('.card .loading-panel'), null, { timeout: 60000 }).catch(() => {}); };
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await b.newContext({ viewport: vp }); const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${U}#tab=area&bus=111403`); await settle(page);
  for (const tab of ['area', 'footprint', 'corridor', 'permits']) {
    await page.click(`[data-act="tab"][data-v="${tab}"]`); await settle(page);
    const vals = await page.locator('.kpi .value').allInnerTexts();
    const body = await page.locator('[role="tabpanel"]').innerText();
    check(vals.length === 4 && !/NaN|undefined|Infinity/.test(body), `[${vp.width}] ${tab}: 4 KPIs, no NaN ${JSON.stringify(vals)}`);
    check((await page.locator('[role="tabpanel"] .chart-host, [role="tabpanel"] .land-ring, [role="tabpanel"] .land-gauge').count()) >= 2, `[${vp.width}] ${tab}: ≥ 2 charts`);
    check((await page.locator('[role="tabpanel"] .table-wrap table').count()) >= 1, `[${vp.width}] ${tab}: ≥ 1 table`);
    check((await page.locator('.card-trace details.trace').count()) >= 3, `[${vp.width}] ${tab}: traces in the calculation card`);
  }
  await page.click('[data-act="tab"][data-v="area"]'); await settle(page);
  let v = await page.locator('.kpi .value').allInnerTexts();
  check(v[1].startsWith('11,913'), `[${vp.width}] Mashpee largest block 11,913 ac: ${v[1]}`);
  await page.click('[data-act="tab"][data-v="footprint"]'); await settle(page);
  check((await page.locator('.kpi .value').first().innerText()).startsWith('560'), `[${vp.width}] solar 100 MW needs 560 ac`);
  check((await page.locator('.kpi .value').nth(3).innerText()) === 'not held', `[${vp.width}] lease vs buy not held until inputs`);
  for (const [k, x] of [['buy', '10000'], ['lease', '800'], ['disc', '8'], ['years', '30'], ['esc', '2']]) { await page.fill(`input[data-act="land"][data-k="${k}"]`, x); await page.waitForTimeout(150); await page.evaluate(() => document.activeElement?.blur()); await page.waitForTimeout(150); }
  v = await page.locator('.kpi .value').nth(3).innerText();
  check(/^(Lease|Buy)/.test(v), `[${vp.width}] lease vs buy computed: ${v}`);
  await page.click('[data-act="tab"][data-v="corridor"]'); await settle(page);
  check((await page.locator('.kpi .value').first().innerText()) === 'not held', `[${vp.width}] no site → distance not held`);
  check(/Hatchville/.test(await page.locator('.kpi').nth(2).innerText()), `[${vp.width}] nearest other station is Hatchville`);
  await page.click('[data-act="tab"][data-v="permits"]'); await settle(page);
  await page.selectOption('select[data-act="land-permit"][data-k="zoning"]', 'done'); await page.waitForTimeout(200);
  check((await page.locator('.kpi .value').nth(1).innerText()).startsWith('1 of 9'), `[${vp.width}] permit status counts (solar: 7 common + glare + decommissioning)`);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); check(!hs, `[${vp.width}] no horizontal scroll`);
  // Unscreened geo_proxy bus: nothing assumed clear.
  await page.goto(`${U}#tab=area&bus=119759`); await page.reload(); await settle(page);
  await page.click('[data-act="tab"][data-v="area"]'); await settle(page);
  v = await page.locator('.kpi .value').allInnerTexts();
  check(v[1] === 'not held' && v[3] === 'not held', `[${vp.width}] unscreened bus: block and cover not held ${JSON.stringify(v)}`);
  check(errors.filter(e => !/ERR_CONNECTION_REFUSED/.test(e)).length === 0, `[${vp.width}] console errors: ${errors.join(' | ') || 'none'}`);
  await ctx.close();
}
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
