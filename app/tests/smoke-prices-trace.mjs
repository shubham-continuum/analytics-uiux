import { BASE, pwRequire } from './env.mjs';
// Prices gate: on three kinds of bus (own node, same substation, borrowed proxy) and on history and a
// forecast run, every calculation trace renders, reconciles with its headline, and its CSV downloads.
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = pwRequire;
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const U = `${BASE}/`;
const idx = (await (await fetch(U + 'api/buses')).json()).buses;
const pick = tier => idx.find((b, i) => b.tier === tier && i % 11 === 5);
const buses = [['direct', pick('direct')], ['same_substation', pick('same_substation')], ['geo_proxy', pick('geo_proxy')]];
mkdirSync('tests/shots', { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage(); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
const TRACES = { lmp: ['p-mean', 'p-dist', 'p-years', 'p-dart', 'p-sheet'], basis: ['p-basis', 'p-comp', 'p-zone', 'p-cons', 'p-compyears'], shape: ['p-capture', 'p-capyears', 'p-peak'], tails: ['p-tails', 'p-tb', 'p-scar', 'p-intra'] };
async function gateTabs(label) {
  for (const [tab, ids] of Object.entries(TRACES)) {
    await page.click(`[data-act="tab"][data-v="${tab}"]`); await page.waitForTimeout(250);
    for (const id of ids) {
      const t = page.locator(`details.trace[data-trace="${id}"]`);
      try { await t.waitFor({ timeout: 120000 }); } catch { /* reported below */ }
      if (!(await t.count())) { check(false, `${label} › ${tab}: trace ${id} present`); continue; }
      await t.evaluate(d => { d.open = true; });
      const body = await t.innerText();
      check(!/Does not reconcile/.test(body), `${label} › ${tab} › ${id}: reconciles${/Does not reconcile/.test(body) ? ` — ${body.match(/Does not reconcile[^\n]*/)[0]}` : ''}`);
      check(!/NaN|undefined|Infinity/.test(body), `${label} › ${tab} › ${id}: no NaN/undefined`);
      check(/Reconciles/.test(body) || /by construction|No check possible/.test(body), `${label} › ${tab} › ${id}: carries a check (or says why it cannot)`);
    }
  }
}
for (const [tier, bus] of buses) {
  await page.goto(`${U}prices.html#tab=lmp&bus=${bus.id}&depth=study`); await page.waitForSelector('.kpis', { timeout: 120000 });
  await gateTabs(`${tier} ${bus.id} history`);
  if (tier === 'direct') {
    // v5 fuel cards: each fuel's Shape tab traces (load cost, storage blocks, wind floor and fleet capture).
    const FUEL = { datacenter: ['p-bill', 'p-load', 'p-scarce'], storage: ['p-blocks', 'p-spreadcurve'], wind: ['p-floor', 'p-windcap'] };
    for (const [fuel, ids] of Object.entries(FUEL)) {
      await page.selectOption('[data-act="tech"]', fuel); await page.click('[data-act="tab"][data-v="shape"]'); await page.waitForTimeout(300);
      for (const id of ids) {
        const t = page.locator(`details.trace[data-trace="${id}"]`);
        try { await t.waitFor({ timeout: 60000 }); } catch { /* reported below */ }
        if (!(await t.count())) { check(false, `${fuel} › shape: trace ${id} present`); continue; }
        await t.evaluate(d => { d.open = true; }); const body = await t.innerText();
        check(!/Does not reconcile/.test(body) && /Reconciles/.test(body) && !/NaN|undefined|Infinity/.test(body), `${fuel} › shape › ${id}: reconciles, no NaN`);
      }
    }
    await page.selectOption('[data-act="tech"]', 'solar');
    await page.click('[data-act="tab"][data-v="lmp"]');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('details.trace[data-trace="p-mean"] [data-act="trace-csv"]').click()]);
    const path = `tests/shots/${dl.suggestedFilename()}`; await dl.saveAs(path);
    const { readFileSync } = await import('node:fs'); const all = readFileSync(path, 'utf8').trim().split('\r\n');
    const meta = all.filter(l => l.startsWith('# ')), lines = all.filter(l => !l.startsWith('# '));
    check(meta.some(l => l.startsWith('# price series:')) && meta.some(l => l.startsWith('# basis:')), `CSV carries provenance lines (${meta.length})`);
    check(lines[0] === 'timestamp,price_usd_mwh,energy_usd_mwh,congestion_usd_mwh,loss_usd_mwh,interval_hours' && lines.length > 8000, `CSV downloads with unit headers and ${lines.length - 1} hourly rows`);
    await page.locator('details.trace[data-trace="p-mean"]').screenshot({ path: 'tests/shots/trace-p-mean.png' });
  }
  if (tier === 'geo_proxy') {
    // Forecast basis on the proxy bus: forecast runs are per bus, not borrowed.
    await page.click('[data-act="tab"][data-v="lmp"]');
    await page.click('[data-act="basis-mode"][data-v="forecast"]'); await page.click('[data-act="apply-basis"]'); await page.waitForTimeout(400);
    check(/Forecast|forecast/.test(await page.locator('.summary .gsx-basis').innerText()), 'forecast basis applies on a proxy bus');
    await gateTabs(`${tier} ${bus.id} forecast`);
    await page.click('[data-act="tab"][data-v="basis"]');
    await page.locator('details.trace[data-trace="p-comp"]').screenshot({ path: 'tests/shots/trace-p-comp.png' });
  }
}
check(!errors.length, `console errors: ${errors.join(' | ') || 'none'}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
