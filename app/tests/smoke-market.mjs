import { BASE, pwRequire } from './env.mjs';
import { createRequire } from 'node:module';
import { get } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { evaluate, prepare } from '../marketcore.js';
const require = pwRequire;
const { chromium } = require('playwright');
// Market v2 reads /api/market (unified database). node:http, not fetch: undici asserts on large HTTP/1.0 bodies.
const study = prepare(await new Promise((res, rej) => get(`${BASE}/api/market`, r => { const b = []; r.on('data', c => b.push(c)); r.on('end', () => { const buf = Buffer.concat(b); res(JSON.parse((r.headers['content-encoding'] === 'gzip' ? gunzipSync(buf) : buf).toString('utf8'))); }); }).on('error', rej)));
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await b.newPage({ viewport: vp }); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=market&tab=find&bus=111403`);
  await page.waitForSelector('.kpis', { timeout: 60000 });
  // W-B option (b): the Market default does not require the envelope-only shoulder export case (marketcore.shoulderRequired({})).
  const met = evaluate(study, { tech: 'solar', exportMW: 100, importMW: 0, useShoulder: false }).filter(e => e.status === 'met').length;
  const v = await page.locator('.kpi .value').allInnerTexts();
  check(v[0].startsWith(met.toLocaleString('en-US')), `[${vp.width}] qualifying ${v[0]} = core ${met}`);
  check(await page.locator('svg circle').count() > 2000, `[${vp.width}] map plots all buses`);
  await page.selectOption('[data-act="export"]', '500'); await page.click('[data-act="tab"][data-v="find"]');
  await page.fill('[data-act="mkt"][data-k="maxPrice"]', '1'); await page.locator('[data-act="mkt"][data-k="maxPrice"]').dispatchEvent('change');
  check(await page.locator('text=No locations meet these requirements.').first().isVisible(), `[${vp.width}] zero-qualifying message`);
  await page.fill('[data-act="mkt"][data-k="maxPrice"]', ''); await page.locator('[data-act="mkt"][data-k="maxPrice"]').dispatchEvent('change');
  await page.selectOption('[data-act="export"]', '100');
  for (const tab of ['rank', 'size', 'regions']) { await page.click(`[data-act="tab"][data-v="${tab}"]`); await page.waitForSelector('.kpis'); const vals = await page.locator('.kpi .value').allInnerTexts(); check(vals.length >= 4 && vals.every(x => !/NaN|undefined/.test(x)), `[${vp.width}] ${tab} KPIs ${JSON.stringify(vals)}`); }
  const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); check(!hs, `[${vp.width}] no horizontal scroll`);
  check(!errors.length, `[${vp.width}] console errors: ${errors.join(' | ') || 'none'}`);
  await page.click('[data-act="tab"][data-v="find"]'); await page.screenshot({ path: `tests/shots/market-${vp.width}.png`, fullPage: true });
  await page.evaluate(() => localStorage.clear()); await page.close();
}
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
