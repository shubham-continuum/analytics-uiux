import { BASE, pwRequire } from './env.mjs';
// Generic trace gate: node tests/smoke-traces.mjs <page> <tab:traceId,...> [bus kinds]
// On an own-node, a same-substation and a borrowed-price bus, every listed trace must render, carry at least one
// passing check (or state why it cannot), never "Does not reconcile", and contain no NaN/undefined.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const [pageName, spec, techArg] = process.argv.slice(2);
const U = `${BASE}/`;
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const idx = (await (await fetch(U + 'api/buses')).json()).buses;
const buses = [['direct', idx.find((b, i) => b.tier === 'direct' && b.hist && i % 11 === 5)], ['same_substation', idx.find((b, i) => b.tier === 'same_substation' && b.hist && i % 11 === 5)], ['geo_proxy', idx.find(b => b.tier === 'geo_proxy' && b.proxyKm > 1 && b.hist)]];
const items = spec.split(',').map(s => s.split(':'));
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
for (const [tier, bus] of buses) {
  await page.goto(`${U}${pageName}.html#bus=${bus.id}`); await page.waitForSelector('.kpis, .empty', { timeout: 180000 });
  if (techArg) { await page.selectOption('[data-act="tech"]', techArg); await page.waitForTimeout(300); }
  for (const [tab, id] of items) {
    await page.click(`[data-act="tab"][data-v="${tab}"]`);
    const t = page.locator(`details.trace[data-trace="${id}"]`);
    try { await t.waitFor({ timeout: 120000 }); } catch { const why = await page.locator('.notice.error, .notice.warn, .empty').first().innerText().catch(() => ''); check(false, `${tier} ${bus.id} › ${tab}: trace ${id} present ${why ? `(${why.replace(/\s+/g, ' ').slice(0, 120)})` : ''}`); continue; }
    await t.evaluate(d => { d.open = true; });
    const body = await t.innerText();
    const bad = body.match(/Does not reconcile[^\n]*/g);
    check(!bad, `${tier} ${bus.id} › ${tab} › ${id}: reconciles${bad ? ` — ${bad.join(' | ')}` : ''}`);
    check(!/NaN|undefined|Infinity/.test(body), `${tier} ${bus.id} › ${tab} › ${id}: no NaN/undefined`);
    check(/Reconciles/.test(body) || /by construction|No check possible/.test(body), `${tier} ${bus.id} › ${tab} › ${id}: carries a check`);
    if (tier === 'direct') await t.screenshot({ path: `tests/shots/trace-${id}.png`, timeout: 15000 }).catch(() => {}); // a late data re-render can detach it
  }
}
check(!errors.length, `console errors: ${errors.join(' | ') || 'none'}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
