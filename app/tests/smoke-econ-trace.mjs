import { BASE, pwRequire } from './env.mjs';
// Economics gate: on three kinds of bus, every tab renders, every calculation trace reconciles (net
// value, energy balance, NPV), no NaN, and the finance path works end to end from a sent revenue.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const U = `${BASE}/`;
const idx = (await (await fetch(U + 'api/buses')).json()).buses;
const pick = tier => idx.find((b, i) => b.tier === tier && i % 11 === 5);
const buses = [['direct', pick('direct')], ['same_substation', pick('same_substation')], ['geo_proxy', pick('geo_proxy')]];
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
async function traceOk(label, id) {
  const t = page.locator(`details.trace[data-trace="${id}"]`);
  if (!(await t.count())) {
    const why = await page.locator('.notice.error, .notice.warn, .empty').first().innerText().catch(() => '');
    check(false, `${label}: trace ${id} present ${why ? `(${why.slice(0, 120)})` : ''}`); return;
  }
  // Open and read in one task: a background render (a solve or the bus payload landing) between two calls rebuilds the
  // board with this <details> closed, and a closed trace's innerText is its summary only (the 2026-10-14 suite flake).
  const body = await t.evaluate(d => { d.open = true; return d.innerText; });
  check(!/Does not reconcile/.test(body), `${label}: ${id} reconciles${/Does not reconcile/.test(body) ? ` — ${body.match(/Does not reconcile[^\n]*/g).join(' | ')}` : ''}`);
  check(!/NaN|undefined|Infinity/.test(body), `${label}: ${id} has no NaN/undefined`);
  check(/Reconciles/.test(body), `${label}: ${id} carries a passing check`);
}
/** Element screenshot that survives a re-render when a background solve lands (retries on a detached node). */
async function shot(sel, o) { for (let i = 0; i < 4; i++) { try { await page.locator(sel).screenshot({ ...o, timeout: 15000 }); return; } catch { await page.waitForTimeout(1500); } } }
async function setTech(v) { await page.selectOption('[data-act="tech"]', v); await page.waitForTimeout(300); }
for (const [tier, bus] of buses) {
  const L = `${tier} ${bus.id}`;
  await page.goto(`${U}economics.html#tab=revenue&bus=${bus.id}&depth=study`); await page.waitForSelector('.kpis, .notice, .empty', { timeout: 120000 });
  await page.waitForSelector('.kpis', { timeout: 120000 }).catch(() => {});
  await setTech('solar'); await traceOk(`${L} solar revenue`, 'e-revenue');
  await traceOk(`${L} solar revenue vs decisioncore.revenueFor`, 'e-revfor');
  await setTech('wind'); await traceOk(`${L} wind revenue`, 'e-revenue');
  await setTech('storage'); await page.click('[data-act="tab"][data-v="bess"]'); await page.waitForSelector('details.trace[data-trace="e-bess"], .notice.error', { timeout: 120000 });
  await traceOk(`${L} BESS`, 'e-bess');
  if (tier === 'direct') {
    await shot('details.trace[data-trace="e-bess"]', { path: 'tests/shots/trace-e-bess.png' });
    await page.click('[data-act="tab"][data-v="hybrid"]'); await page.waitForSelector('details.trace[data-trace="e-hybrid"], .notice.error', { timeout: 180000 });
    await traceOk(`${L} hybrid`, 'e-hybrid');
    await traceOk(`${L} hybrid DC:AC`, 'e-dcac');
    // v5 fuel routing: storage revenue stack and a data centre's load cost / flex / cost finance.
    await setTech('storage'); await page.click('[data-act="tab"][data-v="revenue"]'); await page.waitForSelector('details.trace[data-trace="e-bridge"], .notice.error', { timeout: 180000 });
    await traceOk(`${L} storage bridge`, 'e-bridge');
    await page.waitForSelector('details.trace[data-trace="e-sweep"]', { timeout: 180000 }).catch(() => {}); await traceOk(`${L} storage sweep`, 'e-sweep');
    await page.waitForSelector('details.trace[data-trace="e-esr"]', { timeout: 120000 }).catch(() => {}); await traceOk(`${L} PCR modelled storage (V6)`, 'e-esr');
    await page.selectOption('[data-act="import"]', (await page.locator('[data-act="import"] option').evaluateAll(o => o.map(x => x.value))).find(x => Number(x) >= 100));
    await setTech('datacenter'); await page.click('[data-act="tab"][data-v="revenue"]'); await page.waitForSelector('details.trace[data-trace="e-loadcost"]', { timeout: 60000 });
    await traceOk(`${L} load cost`, 'e-loadcost');
    await page.click('[data-act="tab"][data-v="bess"]'); await traceOk(`${L} load flex`, 'e-flex');
    await page.click('[data-act="tab"][data-v="finance"]');
    for (const [k, v] of [['discountRate', '0.08'], ['years', '20']]) { await page.fill(`[data-act="fin"][data-k="${k}"]`, v); await page.locator(`[data-act="fin"][data-k="${k}"]`).dispatchEvent('change'); await page.waitForTimeout(150); }
    await traceOk(`${L} cost finance`, 'e-costfin');
    await page.selectOption('[data-act="import"]', '0');
    // Finance from a sent solar revenue, with 2 construction years (LCOE timeline).
    await setTech('solar'); await page.click('[data-act="tab"][data-v="revenue"]'); await page.waitForSelector('[data-act="handoff-revenue"]');
    await page.click('[data-act="handoff-revenue"]'); await page.click('[data-act="tab"][data-v="finance"]');
    for (const [k, v] of [['capex', '120000000'], ['annualOM', '1800000'], ['discountRate', '0.08'], ['years', '25'], ['constructionYears', '2']]) {
      await page.fill(`[data-act="fin"][data-k="${k}"]`, v); await page.locator(`[data-act="fin"][data-k="${k}"]`).dispatchEvent('change'); await page.waitForTimeout(150);
    }
    await traceOk(`${L} finance`, 'e-finance');
    const lcoeTxt = await page.locator('.kpi', { hasText: 'Levelised cost' }).innerText();
    check(/\$\d/.test(lcoeTxt), `LCOE shown from the sent MWh (${lcoeTxt.replace(/\s+/g, ' ').slice(0, 60)})`);
    await shot('details.trace[data-trace="e-finance"]', { path: 'tests/shots/trace-e-finance.png' });
  }
}
check(!errors.length, `console errors: ${errors.join(' | ') || 'none'}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
