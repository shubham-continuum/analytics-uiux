import { BASE, pwRequire } from './env.mjs';
// M3 desync family (08-tests): seeded random action sequences — map click, grid row, pin, unpin, option chip,
// stage, tab, depth, fuel, size, case, back/forward — and after EVERY step: map selection == grid selection ==
// S.nodeId == URL bus, and the pins agree in the store, the URL, the map (drawn rings) and the grid (pin column).
// Pass bar: 0 desyncs. Seeded and reproducible: a failure prints the seed and the step.
//   node tests/smoke-desync.mjs [--steps 500] [--seeds 11,23,47]
// Provenance: Claude Opus 5.5 (M3 build agent) · one-studio/design (T3, slice M3) · 2026-10-06 · sign-off pending · v1
const { chromium } = pwRequire('playwright');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const STEPS = Number(arg('--steps', process.env.DESYNC_STEPS || 500));
const SEEDS = String(arg('--seeds', process.env.DESYNC_SEEDS || '11,23,47')).split(',').map(Number);
const U = `${BASE}/analytics-analyzer-studio.html`;
const START = '#v=stage&stage=grid&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&pins=111403,100178,110807';
const ACTIONS = ['map', 'grid', 'pin', 'unpin', 'option', 'stage', 'tab', 'depth', 'fuel', 'size', 'case', 'back', 'forward'];

/** mulberry32: a small seeded PRNG, so a failing sequence replays exactly. */
const rng = seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const b = await chromium.launch({ channel: 'chrome' });
let desyncs = 0; const report = [];

async function runSeed(seed) {
  const R = rng(seed), pick = a => a[Math.floor(R() * a.length)];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  let loads = 0; page.on('load', () => { loads++; if (loads > 1) console.log(`NAVIGATION seed ${seed}: page reloaded at ${page.url()}`); });
  await page.goto(U + START);
  await page.waitForFunction(() => window.__gsBridgePerf?.ready && window.GSMapGrid?.stats().rows > 0, null, { timeout: 90000 });
  // A fixed pool of buses for map, grid and link actions: every bus a page visits keeps its ~10 MB hourly payload in
  // the app's D, so an unbounded walk runs the browser out of memory. Map clicks may still land on a co-located bus.
  const POOL = await page.evaluate(() => window.GS.nodes.filter(n => n.lat != null).filter((n, i) => i % 389 === 0).slice(0, 7).map(n => n.bus_id).concat([111403, 111209, 111348]));
  await page.evaluate(() => window.GSMapGrid.setShown([...window.GSMapGrid.shown(), 'bus_id', 'pin']));
  let pushed = 0, backed = 0;
  const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 40)))));
  const snapshot = () => page.evaluate(async () => {
    const S = (await import(`${location.origin}/app.js`)).getState(), MG = window.GSMapGrid, st = MG.stats();
    const h = new URLSearchParams(location.hash.slice(1));
    // The grid is virtualised: every highlighted row must be the store's bus, and the store's row, when rendered, is highlighted.
    const onRows = [...document.querySelectorAll('.gsx-r.on')].map(r => r.getAttribute('data-gsx-row'));
    const selRow = document.querySelector(`.gsx-r[data-gsx-row="${S.nodeId}"]`);
    return { node: String(S.nodeId), map: String(st.selected), onRows, selRowRendered: !!selRow, selRowOn: !!selRow?.classList.contains('on'), url: h.get('bus'), pins: [...S.pins].map(String).sort(),
      urlPins: (h.get('pins') || '').split(',').filter(Boolean).sort(), appPins: window.App.state.pins.map(String).sort(),
      drawnPins: st.drawn.pins, gridPins: window.GS.nodes.filter(n => MG.value('pin', n.bus_id)?.value === 'pinned').length, /* every row, whatever the grid's filters */ geoPins: S.pins.filter(id => { const n = window.GS.node(id); return n && n.lat != null; }).length };
  });
  async function act(a) {
    switch (a) {
      case 'map': {
        const id = pick(POOL);
        let p = await page.evaluate(i => window.GSMapGrid.xyOf(i), id);
        if (!p?.inView) { await page.evaluate(i => window.GSMapGrid.panTo(i), id); p = await page.evaluate(i => window.GSMapGrid.xyOf(i), id); }
        if (p?.inView) await page.mouse.click(p.x, p.y);
        return `map ${id}`;
      }
      case 'grid': {
        // Filter the grid to one pool bus, click its row (a real row click), then clear the filter.
        const id = pick(POOL);
        await page.evaluate(i => window.GSMapGrid.setFilter('bus_id', `=${i}`), id);
        let r = null;
        try { r = await page.$(`[data-gsx="grid-rows"] .gsx-r[data-gsx-row="${id}"]`); if (r) await r.click(); }
        finally { await page.evaluate(() => window.GSMapGrid.setFilter('bus_id', '')); }
        return `grid ${id}${r ? '' : ' (row not shown)'}`;
      }
      case 'pin': { const el = await page.$('header [data-act="pin"]'); if (el) await el.click(); return 'pin (top bar)'; }
      case 'unpin': {
        const id = await page.evaluate(async r => { const m = await import(`${location.origin}/app.js`), p = m.getState().pins; if (!p.length) return null; const x = p[Math.floor(r * p.length)]; m.dispatch('pin', x); return x; }, R());
        return `unpin ${id}`;
      }
      case 'option': { const c = await page.$$('.gswf-sel .gswf-opt'); if (c.length) await pick(c).click(); return 'option chip'; }
      case 'stage': { await page.evaluate(() => document.activeElement?.blur()); const k = String(1 + Math.floor(R() * 7)); await page.keyboard.press(k); return `stage ${k}`; }
      case 'tab': { const t = await page.$$('#board [role="tab"]'); if (t.length) await pick(t).click(); return 'tab'; }
      case 'depth': { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('d'); return 'depth'; }
      case 'fuel': { const v = pick(['solar', 'wind', 'storage', 'datacenter', 'hybrid']); if (await page.$('select[data-act="tech"]')) await page.selectOption('select[data-act="tech"]', v); return `fuel ${v}`; }
      case 'size': { const s = await page.$$('[data-act="sweep"]'); if (s.length) await pick(s).click(); return 'size'; }
      case 'case': { const v = pick(['sp', 'sh', 'll']); if (await page.$('select[data-act="case"]')) await page.selectOption('select[data-act="case"]', v); return `case ${v}`; }
      case 'back': case 'forward': {
        if (a === 'back' && !pushed) {
          // A pasted link (a real history entry): another bus, then Back returns to the previous view.
          const id = pick(POOL);
          await page.evaluate(i => new Promise(r => { addEventListener('hashchange', () => setTimeout(r, 60), { once: true }); setTimeout(r, 2000); const h = new URLSearchParams(location.hash.slice(1)); h.set('bus', String(i)); location.hash = h.toString().replace(/%2C/g, ','); }), id);
          pushed++; backed = 0; await settle(); return `link bus=${id}`; // a new entry clears the forward list
        }
        // Never step out of the app's own entries (a link to the same hash adds none, so counters can drift):
        // the Navigation API says whether the neighbouring entry is still this document.
        const can = await page.evaluate(d => { const n = window.navigation, i = n?.currentEntry?.index ?? 0; return d === 'back' ? i > 0 : !!n?.canGoForward; }, a);
        if (!can) return `${a} (no in-app entry)`;
        if (a === 'back') { await page.evaluate(() => new Promise(r => { addEventListener('hashchange', () => setTimeout(r, 60), { once: true }); setTimeout(r, 2000); history.back(); })); pushed--; backed++; return 'back'; }
        if (!backed) return 'forward (nothing to redo)';
        await page.evaluate(() => new Promise(r => { addEventListener('hashchange', () => setTimeout(r, 60), { once: true }); setTimeout(r, 2000); history.forward(); })); backed--; pushed++; return 'forward';
      }
    }
    return a;
  }
  const t0 = Date.now(); let bad = 0;
  for (let i = 1; i <= STEPS; i++) {
    const a = pick(ACTIONS);
    if (process.env.DESYNC_DEBUG === "all" || process.env.DESYNC_FROM && i >= Number(process.env.DESYNC_FROM)) console.log(`seed ${seed} step ${i} → ${a}`);
    let what;
    try { what = await act(a); } catch (e) { what = `${a} (input error: ${String(e.message).split('\n')[0]})`; }
    await settle();
    if (process.env.DESYNC_DEBUG && (i % 10 === 0 || process.env.DESYNC_DEBUG === "all")) console.log(`seed ${seed} step ${i} ${what} · ${((Date.now() - t0) / i).toFixed(0)} ms/step · heap ${await page.evaluate(() => Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6))} MB`);
    // One retry after a short wait: a hash navigation or a bus load may still be landing (async by design).
    let s = await snapshot(), why = verdict(s);
    if (why) { await page.waitForTimeout(400); s = await snapshot(); why = verdict(s); }
    if (why) { bad++; desyncs++; report.push(`seed ${seed} step ${i} (${what}): ${why} · ${JSON.stringify(s)}`); console.log(`DESYNC seed ${seed} step ${i} (${what}): ${why}`); if (bad > 5) break; }
  }
  const ok = !bad && !errors.length;
  console.log(`${ok ? 'ok  ' : 'FAIL'} seed ${seed}: ${STEPS} steps, ${bad} desyncs, ${errors.length} console errors (${((Date.now() - t0) / 1000).toFixed(0)} s)${errors.length ? ` · ${errors.slice(0, 3).join(' | ')}` : ''}`);
  if (errors.length) report.push(`seed ${seed}: console errors ${errors.slice(0, 3).join(' | ')}`);
  await ctx.close();
  return ok;
}
function verdict(s) {
  if (!(s.node === s.map && s.node === s.url)) return `selection: store ${s.node} · map ${s.map} · URL ${s.url}`;
  if (s.onRows.some(id => id !== s.node) || (s.selRowRendered && !s.selRowOn)) return `grid highlight [${s.onRows}] ≠ store ${s.node} (store row rendered ${s.selRowRendered})`;
  const P = JSON.stringify(s.pins);
  if (P !== JSON.stringify(s.urlPins) || P !== JSON.stringify(s.appPins)) return `pins: store ${s.pins} · URL ${s.urlPins} · App.state ${s.appPins}`;
  if (s.drawnPins !== s.geoPins || s.gridPins !== s.pins.length) return `pins drawn ${s.drawnPins}/${s.geoPins} · grid ${s.gridPins}/${s.pins.length}`;
  return null;
}

const results = []; // one seed at a time: each page holds the visited buses' hourly payloads (~10 MB each)
for (const seed of SEEDS) results.push(await runSeed(seed));
await b.close();
console.log(`\n${SEEDS.length} seeds × ${STEPS} steps: ${desyncs} desyncs`);
if (report.length) console.log(report.slice(0, 10).join('\n'));
console.log(results.every(Boolean) ? 'ALL PASS' : `${results.filter(r => !r).length} seed(s) FAILED`);
process.exit(results.every(Boolean) ? 0 : 1);
