import { BASE, pwRequire } from './env.mjs';
// Decision all-bus gate: add two options of other kinds by search, wait for them to load, and require the
// Compare / Stress / Readiness traces to reconcile across three options.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const U = `${BASE}/`;
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const idx = (await (await fetch(U + 'api/buses')).json()).buses;
const cand = idx.find((b, i) => b.tier === 'direct' && b.hist && i % 11 === 5);
const adds = [idx.find(b => b.tier === 'geo_proxy' && b.proxyKm > 1 && b.hist), idx.find((b, i) => b.tier === 'same_substation' && b.hist && i % 13 === 7)];
const label = b => `${b.name} · ${b.substation || ''} · ${b.kv ?? '?'} kV · ${b.zone || ''} · ${b.id}`;
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${U}decision.html#tab=compare&bus=${cand.id}&depth=study`); await page.waitForSelector('details.trace[data-trace="d-compare"]', { timeout: 180000 });
await page.selectOption('[data-act="tech"]', 'solar');
for (const a of adds) {
  await page.fill('[data-act="d-add"]', label(a)); await page.locator('[data-act="d-add"]').dispatchEvent('change');
  await page.waitForFunction(id => [...document.querySelectorAll('.table-wrap th')].some(th => th.closest('table')) && document.body.innerText.includes(id), a.id, { timeout: 180000 });
}
await page.waitForFunction(() => !document.body.innerText.includes('Loading') , null, { timeout: 180000 });
const heads = await page.locator(".card:has(h3:text(\"Side by side (raw values)\")) .table-wrap table").first().locator("thead th").allInnerTexts();
check(heads.length === 4, `three options side by side (${heads.slice(1).join(' | ')})`);
for (const [tab, id] of [['compare', 'd-compare'], ['compare', 'd-position'], ['compare', 'd-shared'], ['compare', 'd-studio'], ['stress', 'd-stress'], ['stress', 'd-range'], ['readiness', 'd-readiness'], ['readiness', 'd-coverage'], ['record', 'd-record']]) {
  await page.click(`[data-act="tab"][data-v="${tab}"]`);
  const t = page.locator(`details.trace[data-trace="${id}"]`); await t.waitFor({ timeout: 180000 });
  // d-position and d-stress gain their independent checks once the unified marts load (a re-render).
  if (id === 'd-position' || id === 'd-stress') await page.waitForFunction(i => /Independent check/.test(document.querySelector(`details.trace[data-trace="${i}"]`)?.textContent || ''), id, { timeout: 60000 }).catch(() => {});
  await t.evaluate(d => { d.open = true; });
  const body = await t.innerText();
  check(!/Does not reconcile/.test(body), `${id} reconciles${/Does not reconcile/.test(body) ? ` — ${body.match(/Does not reconcile[^\n]*/g).join(' | ')}` : ''}`);
  check(/Reconciles/.test(body) || /No check possible/.test(body), `${id} carries a check`);
  check(!/NaN|undefined|Infinity/.test(body), `${id} no NaN/undefined`);
  if (id === 'd-compare') {
    // Review 12: the revenue loop is an arithmetic re-check (same prices and limit); the export limit is checked independently.
    check((body.match(/Reconciles\s+Arithmetic re-check \(same prices and limit\)/g) || []).length === 3, `${id}: all three revenues re-checked (labelled arithmetic re-check)`);
    check(!/Independent re-implementation/.test(body), `${id}: no revenue check is called independent`);
    check((body.match(/Reconciles\s+Independent check: .*export limit/g) || []).length >= 1, `${id}: export limit checked independently from the raw grid rows`);
  }
  if (id === 'd-stress') {
    check(/Arithmetic re-check: leaders recounted/.test(body), `${id}: recount labelled arithmetic re-check`);
    check((body.match(/Reconciles\s+Independent check: .*mean price from the hourly series vs mart_bus_year/g) || []).length >= 3, `${id}: settled-year prices checked independently against the marts`);
  }
  if (id === 'd-position') check((body.match(/Reconciles\s+Independent check: .*mart_bus_year vs recomputed/g) || []).length >= 1, `${id}: mart RT mean checked independently against the hourly series`);
  await t.screenshot({ path: `tests/shots/trace-${id}.png` }).catch(() => {}); // a late data re-render may detach it
}
await page.click('[data-act="tab"][data-v="compare"]');
await page.locator('[data-act="d-remove"]').first().click(); await page.waitForTimeout(400);
check((await page.locator(".card:has(h3:text(\"Side by side (raw values)\")) .table-wrap table").first().locator("thead th").count()) === 3, 'removing an option leaves two');
// Review 11: an ambiguous bus name is rejected with a request to pick from the list; an unknown id is rejected.
const counts = idx.reduce((m, x) => m.set(x.name, (m.get(x.name) || 0) + 1), new Map());
const dup = [...counts].find(([, c]) => c > 1)?.[0];
if (dup) {
  await page.fill('[data-act="d-add"]', dup); await page.locator('[data-act="d-add"]').dispatchEvent('change');
  check(/pick one from the list/.test(await page.locator('#toast').innerText()), `ambiguous name "${dup}" asks for a pick from the list`);
}
await page.fill('[data-act="d-add"]', '99999999'); await page.locator('[data-act="d-add"]').dispatchEvent('change');
check(/Pick a bus from the list/.test(await page.locator('#toast').innerText()), 'unknown id rejected');
check((await page.locator(".card:has(h3:text(\"Side by side (raw values)\")) .table-wrap table").first().locator("thead th").count()) === 3, 'rejected adds leave the options unchanged');
check(!errors.length, `console errors: ${errors.join(' | ') || 'none'}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
