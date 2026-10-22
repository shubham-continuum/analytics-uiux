import { BASE, pwRequire } from './env.mjs';
// M3 map/grid smoke: acceptance examples 1–3 and 5 (design/02), the registry against 04a §2, a stale
// gs.mapgrid.view.v1 cannot change the fuel, no console error, first paint ≤ 3 s and map ready ≤ 6 s at 1440,
// the picker-blur render regression (NotFoundError from a nested slot swap), and the M3 screenshots
// (Grid and Prices stages, docks open, dark + light × 1280 / 1440) under tests/shots/m3/.
// Provenance: Claude Opus 5.5 (M3 build agent) · one-studio/design (T3, slice M3) · 2026-10-06 · sign-off pending · v1
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = pwRequire('playwright');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots', 'm3');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const U = `${BASE}/analytics-analyzer-studio.html`;
const LIVE = '#v=stage&stage=grid&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&cmp=o1,o2&pins=111403,100178,110807';
const STALE_VIEW = { fuel: 'dc', preset: 'load', picked: true, kpi: 'load_cost', kpi2: 'hr_ll_chg', size: 'none', surface: 'points' };

/** 04a §2 column ids, parsed from the contract table (braces and slash lists expanded, parentheses dropped). */
function ids04a() {
  const md = readFileSync(path.join(HERE, '..', '..', 'design', '04a-bridge-contract.md'), 'utf8');
  const sec = md.slice(md.indexOf('## 2. Grid columns'), md.indexOf('## 3.'));
  const out = new Set();
  const brace = t => { const m = /\{([^}]*)\}/.exec(t); return m ? m[1].split(',').flatMap(x => brace(t.slice(0, m.index) + x.trim() + t.slice(m.index + m[0].length))) : [t]; };
  for (const line of sec.split('\n').filter(l => /^\| [A-Z]/.test(l) && !/^\| Family/.test(l))) {
    const cell = line.split(/(?<!\\)\|/)[2].replace(/\\\|/g, '/').replace(/\([^)]*\)/g, '');
    for (let tok of cell.split(/,(?![^{]*\})/)) {
      tok = tok.trim().split(/\s+/)[0]; if (!tok) continue;
      for (const t of brace(tok)) {
        if (t.includes('/')) { const [first, ...rest] = t.split('/'); const pre = first.slice(0, first.lastIndexOf('_') + 1); out.add(first); rest.forEach(r => out.add(pre + r)); } else out.add(t);
      }
    }
  }
  return out;
}

const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(v => { try { if (!sessionStorage.getItem('m3-seeded')) { localStorage.setItem('gs.mapgrid.view.v1', JSON.stringify(v)); sessionStorage.setItem('m3-seeded', '1'); } } catch { } }, STALE_VIEW);
const page = await ctx.newPage(); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
const S = () => page.evaluate(async () => (await import(`${location.origin}/app.js`)).getState());
const ready = () => page.waitForFunction(() => window.__gsBridgePerf?.ready && window.GSMapGrid, null, { timeout: 60000 });
const quiet = ms => page.waitForTimeout(ms);

// 1. Live link opens (acceptance 1), with timings
// Measured in the page from navigation start: first paint = the board's question header; map ready = the bridge's
// ready mark (data loaded, module booted, first sync done).
await page.goto(U + LIVE);
const firstPaint = Math.round(await page.waitForFunction(() => (document.querySelector('#board .gsx-question') ? performance.now() : 0), null, { polling: 20, timeout: 30000 }).then(h => h.jsonValue()));
await ready();
const mapReady = Math.round(await page.evaluate(() => window.__gsBridgePerf.ready));
await page.waitForFunction(() => window.GSMapGrid.stats().drawn.points > 0 && window.GSMapGrid.stats().rows > 0, null, { timeout: 30000 });
await quiet(1500);
check(firstPaint <= 3000, `first paint ${firstPaint} ms (≤ 3,000)`);
check(mapReady <= 6000, `map ready ${mapReady} ms (≤ 6,000)`);
{
  const s = await S(), st = await page.evaluate(() => window.GSMapGrid.stats());
  check(s.stage === 'grid' && s.walk?.project === 'kennebec' && s.walk?.option === 'o2' && s.nodeId === '111209' && s.depth === 'review', `Grid · kennebec o2 (Hatchville 111209) · Review (stage ${s.stage}, option ${s.walk?.option}, bus ${s.nodeId}, depth ${s.depth})`);
  check(st.selected === 111209, `map/grid selection is 111209 (${st.selected})`);
  check(JSON.stringify([...s.pins].sort()) === JSON.stringify(['100178', '110807', '111403']), `3 pins in the store (${s.pins})`);
  check(st.drawn.pins === 3, `3 pins drawn on the map (${st.drawn.pins})`);
  const gridPins = await page.evaluate(() => window.GSMapGrid.viewValues('pin').filter(v => v === 'pinned').length);
  check(gridPins === 3, `3 pins in the grid's pin column (${gridPins})`);
  check(!st.fallbackDocks && await page.evaluate(() => !!document.querySelector('#gsx-map-dock .gsx-map-pane') && !!document.querySelector('#gsx-grid-dock .gsx-grid-pane')), 'map and grid mounted inside the frame docks (no fallback docks)');
  check(Object.keys(st.broken).length === 0, `no module surface disabled (${JSON.stringify(st.broken)})`);
  const cmp = await page.evaluate(() => location.hash.match(/cmp=([^&]*)/)?.[1]);
  check(cmp && cmp.split(',').sort().join() === 'o1,o2', `cmp o1,o2 kept for Decision (${cmp})`);
}
// stale gs.mapgrid.view.v1 cannot change the fuel
{
  const scope = await page.evaluate(() => ({ fuel: window.App.ctx().fuel, count: document.querySelector('.gsx-grid-bar .n')?.textContent || '' }));
  check(scope.fuel === 'solar' && /Solar 100 MW/.test(scope.count), `a stale gs.mapgrid.view.v1 (fuel dc) left the scope at Solar 100 MW (${scope.count})`);
}
// registry vs 04a §2
{
  const reg = await page.evaluate(() => window.GSMapGrid.registry().map(c => c.id)), a = ids04a();
  const extra = reg.filter(id => !a.has(id)), absent = [...a].filter(id => !reg.includes(id));
  check(!extra.length, `every registry id is in 04a §2 (${extra.join(', ') || 'all listed'})`);
  check(JSON.stringify(absent) === JSON.stringify(['land_cost']), `04a ids not registered: ${absent.join(', ')} (land_cost only: no land_cost_proxy in the unified DB)`);
  check(reg.length === a.size - 1, `registry().length ${reg.length} = 04a count ${a.size} − land_cost`);
}

// 2. Map click selects (acceptance 2). The layer panel covers the middle of a 340 px dock: fold it first.
{
  check(await page.evaluate(() => { const w = document.getElementById('gsx-map-dock')?.clientWidth || 0, off = !!document.querySelector('#gsx-map-dock .gsx-layers')?.classList.contains('off'); return w < 520 ? off : true; }), 'Layers panel folded at boot when the map dock is narrower than 520 px (bridge rule)');
  await page.evaluate(() => { window.GSMapGrid.panTo(111403); });
  for (let i = 0; i < 6; i++) { const p = await page.evaluate(() => window.GSMapGrid.xyOf(111403)); await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -500); await quiet(60); }
  let s = null;
  for (let i = 0; i < 6; i++) {
    const p = await page.evaluate(() => window.GSMapGrid.xyOf(111403));
    await page.mouse.click(p.x, p.y); await quiet(500);
    s = await S(); if (s.nodeId === '111403') break;
  }
  check(s.nodeId === '111403', `map click: S.nodeId 111403 (${s.nodeId})`);
  check(/[#&]bus=111403(&|$)/.test(await page.evaluate(() => location.hash)), 'map click: URL bus=111403');
  await quiet(400);
  const row = await page.evaluate(() => { const r = document.querySelector('.gsx-r.on'); const body = document.querySelector('[data-gsx="grid-body"]'); if (!r) return null; const a = r.getBoundingClientRect(), c = body.getBoundingClientRect(); return { id: r.getAttribute('data-gsx-row'), inView: a.top >= c.top && a.bottom <= c.bottom + 1 }; });
  check(row?.id === '111403' && row.inView, `grid row 111403 highlighted and in view (${JSON.stringify(row)})`);
  const name = await page.evaluate(() => document.querySelector('.gswf-kill, #board .bhead')?.closest('#board')?.textContent || '');
  check(/Mashpee 115 kV/.test(name), 'dashboards re-rendered for Mashpee 115 kV (111403)');
  check(s.ui?.inspect?.id === '111403' && s.ui.inspect.kind === 'bus', `S.ui.inspect = {kind:'bus', id:'111403'} (${JSON.stringify(s.ui?.inspect)})`);
}

// 3. Grid row selects with the keyboard (acceptance 3)
{
  await page.click('[data-gsx="grid-body"] .gsx-r.on');
  await quiet(500);
  const before = await page.evaluate(() => { const v = document.querySelectorAll('.gsx-r'); const on = document.querySelector('.gsx-r.on'); const nx = on?.nextElementSibling; return nx?.getAttribute('data-gsx-row'); });
  await page.focus('[data-gsx="grid-body"]');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await quiet(700);
  const s = await S(), sel = await page.evaluate(() => window.GSMapGrid.stats().selected);
  check(before && s.nodeId === before && sel === Number(before), `ArrowDown + Enter selects the next row ${before} (store ${s.nodeId}, map/grid ${sel})`);
  check(new RegExp(`[#&]bus=${before}(&|$)`).test(await page.evaluate(() => location.hash)), `URL bus=${before}`);
}

// 5. Not held is never 0 (acceptance 5): a bus with no headroom at the scope
{
  const n = await page.evaluate(() => window.GSMapGrid.setFilter('hr', '-'));
  await page.waitForFunction(() => !!document.querySelector('.gsx-r'), null, { timeout: 15000 }).catch(() => {}); // the virtual grid draws the filtered rows on the next frame
  const cell = await page.evaluate(() => { const r = document.querySelector('.gsx-r'); const i = [...document.querySelectorAll('.gsx-hc')].findIndex(h => h.getAttribute('data-gsx-colid') === 'hr'); const c = r?.children[i]; return r && { id: Number(r.getAttribute('data-gsx-row')), text: c?.textContent, why: c?.title, nil: c?.classList.contains('nil') }; });
  check(n > 0 && cell?.text === 'not held' && cell.nil && /./.test(cell.why), `grid cell: "not held" with a reason at ${cell?.id} (${n} buses; "${cell?.why}")`);
  const v = await page.evaluate(id => window.GSMapGrid.value('hr', id), cell.id);
  check(v.value === null && v.text === 'not held', 'GSMapGrid.value: null, "not held"');
  await page.evaluate(() => window.GSMapGrid.setFilter('hr', ''));
  await page.evaluate(() => { window.GSMapGrid.setKpi('hr'); window.GSMapGrid.setKpi2('none'); }); // one KPI: a bivariate legend counts either value missing
  const lay = await page.evaluate(() => window.GSMapGrid.layers());
  const nulls = await page.evaluate(() => { const nodes = window.GS.nodes.filter(n => n.lat != null && n.lon != null); return nodes.filter(n => window.GSMapGrid.value('hr', n.bus_id)?.value == null).length; });
  if (process.env.M3_DEBUG) console.log(await page.evaluate(() => { const L = GSMapGrid.layers(), c = L.classOfBus; const odd = GS.nodes.filter(n => n.lat != null && c[n.bus_id] < 0 && GSMapGrid.value('hr', n.bus_id)?.value != null).slice(0, 4).map(n => [n.bus_id, GSMapGrid.value('hr', n.bus_id).value]); return { kpi: L.kpi, kpi2: L.kpi2, biv: L.biv, colourCol: L.colourCol, colourCol2: L.colourCol2, odd, out: L.outOfFilter }; }));
  const legendMissing = await page.evaluate(() => document.querySelector('[data-gsx="missing-count"]')?.textContent);
  check(lay.missing === nulls && Number(String(legendMissing).replace(/,/g, '')) === nulls, `legend counts ${legendMissing} (layers() ${lay.missing}) buses as missing = ${nulls} with no headroom`);
  // Hover target: a no-headroom bus with no other bus within ~0.015 deg (about a mile), so the pointer cannot land on a
  // co-located bus of the same substation stack (the wider 40% map dock changed which bus sat on top, 2026-10-07).
  const hoverId = await page.evaluate(() => { const N = window.GS.nodes.filter(n => n.lat != null && n.lon != null);
    const iso = n => !N.some(m => m !== n && Math.abs(m.lat - n.lat) < 0.015 && Math.abs(m.lon - n.lon) < 0.015);
    return (N.find(n => window.GSMapGrid.value('hr', n.bus_id)?.value == null && iso(n)) || {}).bus_id ?? null; });
  check(hoverId != null, `an isolated no-headroom bus exists to hover (#${hoverId})`);
  cell.id = hoverId ?? cell.id;
  await page.evaluate(id => window.GSMapGrid.panTo(id), cell.id);
  for (let i = 0; i < 4; i++) { const p = await page.evaluate(id => window.GSMapGrid.xyOf(id), cell.id); await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -500); await quiet(60); }
  const p = await page.evaluate(id => window.GSMapGrid.xyOf(id), cell.id);
  await page.mouse.move(p.x + 1, p.y); await page.mouse.move(p.x, p.y); await quiet(200);
  const tip = await page.evaluate(() => document.querySelector('[data-gsx="hover"]')?.innerText || '');
  const tipBus = Number((tip.match(/#(\d+)/) || [])[1]);
  check(tipBus === Number(cell.id) && (await page.evaluate(id => window.GSMapGrid.value('hr', id).value, tipBus)) === null, `hovered bus #${tipBus} is the target #${cell.id} and holds no headroom at the scope`);
  check(/Headroom[^\n]*\n?\s*not held/i.test(tip) && !/Headroom[^\n]*\n?\s*0(\.0)? MW/.test(tip), `map tooltip says "not held" for headroom (${tip.split('\n').slice(0, 4).join(' | ')})`);
  await page.evaluate(() => window.GSMapGrid.setPreset('siting'));
}

// Picker blur (lead regression): change → blur during the header swap must not throw
{
  const before = errors.length;
  await page.fill('[data-act="node-find"]', 'Hatchville');
  await page.locator('[data-act="node-find"]').dispatchEvent('change'); await quiet(300);
  await page.click('#board', { position: { x: 20, y: 20 } }); await quiet(500);
  check(errors.length === before, `node-find change + blur: no console error (${errors.slice(before).join(' | ')})`);
}

check(!errors.length, `console errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);

// Screenshots (looked at by the builder): Grid and Prices, docks open, dark + light × 1280 / 1440
mkdirSync(SHOTS, { recursive: true });
for (const theme of ['dark', 'light']) for (const w of [1280, 1440]) for (const st of ['grid', 'prices']) {
  const c2 = await b.newContext({ viewport: { width: w, height: 900 } });
  await c2.addInitScript(t => { try { localStorage.setItem('gspreview.theme', t); } catch { } }, theme);
  const p2 = await c2.newPage();
  await p2.goto(U + LIVE.replace('stage=grid', `stage=${st}`));
  await p2.waitForFunction(() => window.__gsBridgePerf?.ready && window.GSMapGrid?.stats().drawn.points > 0, null, { timeout: 60000 });
  await p2.waitForSelector('[role="tabpanel"] .card, [role="tabpanel"] .kpis', { timeout: 90000 }).catch(() => {});
  await p2.waitForTimeout(1200);
  await p2.screenshot({ path: path.join(SHOTS, `m3-${st}-${theme}-${w}.png`) });
  await c2.close();
}
console.log(`screenshots: ${SHOTS}`);
await b.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
