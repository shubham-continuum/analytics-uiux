import { BASE, pwRequire } from './env.mjs';
// M3 cross-surface family (08-tests): 50 sampled buses × 5 fuels. The grid's engine columns equal the card's own
// function on the card's own data (the bus payload /api/bus/<id>, as Grid and Prices read it):
//   headroom  Grid › Connection capacity: binding(caseTable(grid, bus, tech, MW…)) — export, or import for a data
//             centre; storage/hybrid compare the per-case governing limits (sto_sp_dis, sto_sh_chg)
//   cost      Grid › Upgrade cost: stepCostService at 100 MW (decisioncore.costText rule; a bound with no element
//             evidence is not held)
//   LMP hist  Prices: analyzePrices on Historical RT 2025 (observed-hour weighted), the applied-basis mean
//   TB4       Prices › Storage spreads: tbMart(pcr2030 hourly, 4) — the grid's "TB4 2030"
// and the map tooltip (hover rows) states the grid cell's text. Three buses are also read off the rendered Grid card.
// The sample: the buses whose payload the server already holds (cache/), sorted, else every 53rd bus.
// Provenance: Claude Opus 5.5 (M3 build agent) · one-studio/design (T3, slice M3) · 2026-10-06 · sign-off pending · v1
import { readdirSync, existsSync } from 'node:fs';
import http from 'node:http';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { caseTable, binding, stepCostService } from '../gridrules.js';
import { analyzePrices } from '../prices.js';
import { heldRows, tbMart } from '../views/prices-calc.js';
const { chromium } = pwRequire('playwright');
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fails = []; let checks = 0;
const check = (c, m) => { checks++; if (!c) { fails.push(m); console.log(`FAIL ${m}`); } };
const near = (a, b, tol) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) <= tol);
const FUELS = ['solar', 'wind', 'storage', 'datacenter', 'hybrid'];
const N = Number(process.env.XS_BUSES || 50);

const b = await chromium.launch({ channel: 'chrome' });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=grid&bus=111209&depth=review&case=sp`);
await page.waitForFunction(() => window.__gsBridgePerf?.ready && window.GSMapGrid?.stats().rows > 0, null, { timeout: 90000 });

const all = await page.evaluate(() => window.GS.nodes.map(n => n.bus_id));
const cached = existsSync(path.join(APP, 'cache')) ? readdirSync(path.join(APP, 'cache')).map(f => /^bus-(\d+)-/.exec(f)?.[1]).filter(Boolean).map(Number).filter(id => all.includes(id)) : [];
const sample = [...new Set([111209, ...cached.sort((x, y) => x - y), ...all.filter((_, i) => i % 53 === 0)])].slice(0, N);
console.log(`sample: ${sample.length} buses (${Math.min(cached.length, N)} from the server's cache)`);

// The card's data: each bus's own payload, fetched once.
const P = new Map();
// node:http + zlib rather than fetch: undici asserts (`!this.paused`) on these large gzip bodies under Node 24.
const getBus = id => new Promise(res => http.get(`${BASE}/api/bus/${id}`, r => { if (r.statusCode !== 200) { r.resume(); res(null); return; }
  const z = r.headers['content-encoding'] === 'gzip' ? r.pipe(zlib.createGunzip()) : r, parts = []; z.on('data', d => parts.push(d)); z.on('end', () => res(JSON.parse(Buffer.concat(parts).toString('utf8')))); z.on('error', () => res(null)); }).on('error', () => res(null)));
for (const id of sample) P.set(id, await getBus(id));

const serviceArgs = (tech, s) => (tech === 'datacenter' ? [0, s] : ['storage', 'hybrid'].includes(tech) ? [s, s] : [s, 0]);
const costExpect = c => (c.status === 'True zero' ? 0 : c.status === 'Priced' ? c.total : ['Lower bound', 'Partly priced'].includes(c.status) ? ((c.items || []).length ? c.total : null) : null);
let compared = { hr: 0, cost: 0, lmp: 0, tb4: 0, tip: 0 };
for (const fuel of FUELS) {
  await page.selectOption('select[data-act="tech"]', fuel);
  await page.waitForFunction(f => window.App.ctx().fuel === ({ storage: 'bess', datacenter: 'dc' }[f] || f) && window.GSMapGrid.stats().rows > 0, fuel, { timeout: 30000 });
  await page.waitForTimeout(300);
  const cols = fuel === 'storage' || fuel === 'hybrid' ? ['sto_sp_dis', 'sto_sh_chg', 'cost100', 'lmp_2025', 'tb4'] : ['hr', 'cost100', 'lmp_2025', 'tb4'];
  const got = await page.evaluate(({ ids, cols }) => Object.fromEntries(ids.map(id => [id, Object.fromEntries(cols.map(c => { const v = window.GSMapGrid.value(c, id); return [c, v && { value: v.value == null ? null : Number(v.value), text: v.text }]; }))])), { ids: sample, cols });
  // tooltip == grid: the hover's KPI row for each column states the cell text (with its unit)
  // The map KPI that reads each column (lmp_2025 is not a KPI; lmp2025_pb is the same GS.priceAt value).
  const KPI = { lmp_2025: 'lmp2025_pb' };
  for (const c of cols) {
    const k = KPI[c] || c;
    check(await page.evaluate(x => window.GSMapGrid.setKpi(x) != null && window.GSMapGrid.layers().kpi === x, k), `${fuel}: map colours by ${k}`);
    const tips = await page.evaluate(ids => Object.fromEntries(ids.map(id => [id, (window.GSMapGrid.hoverRows(id)[0] || [])[1] || null])), sample);
    for (const id of sample) {
      const g = got[id][c]; if (!g || tips[id] == null) continue;
      check(tips[id] === 'not held' ? g.text === 'not held' : tips[id].startsWith(g.text), `${fuel} ${id} ${c}: tooltip "${tips[id]}" = grid "${g.text}"`); compared.tip++;
    }
  }
  for (const id of sample) {
    const p = P.get(id); if (!p) continue;
    const grid = p.grid, tech = fuel, [e, i] = serviceArgs(tech, 100);
    if (cols.includes('hr')) {
      const t = caseTable(grid, id, tech, tech === 'datacenter' ? 0 : 100, tech === 'datacenter' ? 250 : 0), bd = binding(t, tech === 'datacenter' ? 'import' : 'export');
      check(near(got[id].hr.value, bd.value ?? null, 1e-9), `${fuel} ${id} headroom: grid ${got[id].hr.value} = card ${bd.value} (${bd.status})`); compared.hr++;
    } else {
      const t = caseTable(grid, id, tech, 100, 100), row = k => t.find(r => r.key === k)?.governing ?? null;
      check(near(got[id].sto_sp_dis.value, row('summer_peak|discharge'), 1e-9), `${fuel} ${id} summer-peak discharge: grid ${got[id].sto_sp_dis.value} = card ${row('summer_peak|discharge')}`);
      check(near(got[id].sto_sh_chg.value, row('shoulder|charge'), 1e-9), `${fuel} ${id} shoulder charge: grid ${got[id].sto_sh_chg.value} = card ${row('shoulder|charge')}`); compared.hr += 2;
    }
    const c = stepCostService(grid, id, tech, e, i);
    check(near(got[id].cost100.value, costExpect(c), 1e-9), `${fuel} ${id} cost 100 MW: grid ${got[id].cost100.text} = card ${c.status} ${c.total}`); compared.cost++;
    // P2 C10: a bound is held only when something is priced (engine total non-null); a bound with nothing priced reads not held (checked above).
    if (['Lower bound', 'Partly priced'].includes(c.status) && c.total != null) check(/^≥ /.test(got[id].cost100.text), `${fuel} ${id} cost bound printed "≥" (${got[id].cost100.text})`);
    const a = analyzePrices(p, { nodeId: String(id), mode: 'historical', market: 'RT', run: null, years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false });
    const mean = a.summary ? a.summary.mean : null;
    check(near(got[id].lmp_2025.value, mean, 0.005), `${fuel} ${id} LMP 2025 (hist): grid ${got[id].lmp_2025.value} = card ${mean}`); compared.lmp++;
    const s30 = p.series.find(s => s.mode === 'forecast' && s.run === 'pcr2030');
    const tb = s30 ? tbMart(heldRows(s30), 4).mean : null;
    check(near(got[id].tb4.value, tb, 0.01), `${fuel} ${id} TB4 2030: grid ${got[id].tb4.value} = card ${tb}`); compared.tb4++;
  }
}
// Three buses read off the rendered Grid card (solar, 100 MW): the Export limit KPI equals the grid's headroom cell.
await page.selectOption('select[data-act="tech"]', 'solar'); await page.waitForTimeout(400);
for (const id of sample.slice(0, 3)) {
  await page.evaluate(i => { location.hash = `stage=grid&tab=capacity&bus=${i}&depth=review&case=sp`; }, id);
  await page.waitForFunction(i => { const k = [...document.querySelectorAll('#board .kpi')].find(x => /Export limit/i.test(x.textContent)); return k && new URLSearchParams(location.hash.slice(1)).get('bus') === String(i); }, id, { timeout: 90000 });
  await page.waitForTimeout(300);
  const card = await page.evaluate(() => [...document.querySelectorAll('#board .kpi')].find(x => /Export limit/i.test(x.textContent)).querySelector('.value').textContent.trim());
  const g = await page.evaluate(i => window.GSMapGrid.value('hr', i), id);
  const cardNum = /not held|Hold/.test(card) ? null : Number(card.replace(/[^\d.-]/g, ''));
  check(cardNum == null ? g.value == null : near(cardNum, g.value, 0.051), `rendered Grid card ${id}: Export limit "${card}" = grid "${g.text}"`);
}
check(!errors.length, `console errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
await b.close();
console.log(`compared: ${JSON.stringify(compared)} · ${checks} checks`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
