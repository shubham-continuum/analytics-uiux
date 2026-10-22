// GridSense One Studio: the bridge between One Studio (store S + the preview engine) and the vendored live map and
// grid (vendor/live/31-map-grid.js, 32-basemap.js, never edited).
// Provenance: Claude Opus 5.5 (M3 build agent) · one-studio/design (T3, slice M3) · 2026-10-06 · sign-off pending · v1
//
// Contract: design/04a-bridge-contract.md (tables 1–5). Two layers:
//   1. a pure core (createBridge and helpers, no DOM at build time, unit-tested in tests/bridge.test.mjs) that
//      builds window.App / window.GS / window.GS_DATA_EXT from api_mapgrid (display-only) and the ENGINE: every
//      engine-class value is the same function the card calls (gridrules caseTable/binding/stepCostService,
//      marketcore evaluate/rank/nearbyCurtailment, decisioncore gates / Decision's candidateGates, landcore screen,
//      measures/all for prices). A value a card would state differently is null with a reason ("not held"), never a
//      second number.
//   2. browser glue (boot) that imports app.js dynamically (the page's own module instance), loads the data in
//      parallel once a dock is open, pins one mapgrid generation, injects 31 then 32 (32 needs GSMapGrid, L49-53),
//      fires `gsframe:bus` when S.nodeId moves and calls GSMapGrid.sync() after every renderBoard().
// The bridge never writes the URL: every change is an app action (dispatch → save() → studiohash.js).
import { caseTable, binding, stepCostService, perKw, costDisplay } from './gridrules.js';
import { prepare, attachMeasures, attachCurtailment, evaluate, rank, weightPreset, WEIGHT_PRESETS, MEASURES, curtailFuel, curtailRows, nearbyCurtailment } from './marketcore.js';
import { gates as decisionGates, envelopeOnlyCases } from './decisioncore.js';
import { screen as landScreen, footprint, fit as landFit } from './landcore.js';
import { CASE_KEYS, caseScenario, hzRun } from './studiohash.js';
import { heldRows, captureOf } from './views/prices-calc.js';
import { clearSky } from './solar.js';
// P2 grid columns (W-A wiring, 2026-10-07): each owner's columns/<domain>.js in the vendored registry shape; the bridge
// only registers them. Rules come from the one file loaded in loadSources (S3 #2, S4 #4, S5 #5, S6 #6).
import { queueColumns } from './columns/queue.js';
import { revenueColumns } from './columns/revenue.js';
import { TAX_COLUMNS, taxCells } from './columns/tax.js';
import { largeLoadColumns } from './columns/largeload.js';
import { revenueUiOpts } from './views/cards-revenue.js';
import { llYear } from './views/grid-dc.js';

export const BRIDGE_VERSION = 'm3-1';
const ok = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- vocabulary (ids, fuels, cases) ----------
const TO_LIVE = { solar: 'solar', wind: 'wind', storage: 'bess', datacenter: 'dc', hybrid: 'hybrid' };
export const LIVE_FUELS = Object.values(TO_LIVE);
export const fuelToLive = t => TO_LIVE[t] || 'solar';
export const fuelFromLive = f => Object.keys(TO_LIVE).find(k => TO_LIVE[k] === f) || 'solar';
// Labels: app.js TECHS (L158) and CASE_LABEL (L159); directions from gridrules.applicableCases (export / import / both).
const FUEL_LABEL = { solar: 'Solar', wind: 'Wind', bess: 'BESS', dc: 'Data centre', hybrid: 'Solar + storage' };
const CURT_LABEL = { solar: 'Curtailment', wind: 'Curtailment', bess: 'Opportunity loss', dc: 'Reliability risk', hybrid: 'Curtailment' };
const DIRECTION = { solar: 'injection', wind: 'injection', bess: 'both', dc: 'withdrawal', hybrid: 'both' };
const FUELS = Object.fromEntries(LIVE_FUELS.map(f => [f, { key: f, label: FUEL_LABEL[f], plural: FUEL_LABEL[f], direction: DIRECTION[f], curt: f === 'hybrid' ? 'solar' : f, curtLabel: CURT_LABEL[f] }]));
const CASE_LABEL = { sp: 'Summer peak', sh: 'Shoulder', ll: 'Large load' };
const CASES = CASE_KEYS.map(k => ({ key: k, label: CASE_LABEL[k] }));
const caseOf = k => CASES.find(c => c.key === k) || CASES[0];
/** sp|sh|ll + injection|withdrawal → the store's case key (no large-load injection envelope). */
const caseKeyFor = (ck, dir) => { const sc = caseScenario(ck); if (!sc) return null; return dir === 'withdrawal' ? `${sc}|charge` : sc === 'large_load' ? null : `${sc}|discharge`; };
const SIZES = [100, 250, 500, 1000];

// ---------- formatters (GS.fmt): missing prints "not held", never "—" or 0 ----------
export function makeFmt() {
  const nil = v => v == null || (typeof v === 'number' && Number.isNaN(v)) || (v instanceof Number && Number.isNaN(+v));
  const num = (v, dp) => {
    if (nil(v)) return 'not held';
    const x = +v; if (dp == null) dp = Math.abs(x) >= 10000 ? 0 : Math.abs(x) >= 100 ? 1 : Math.abs(x) >= 1 ? 2 : 3;
    let s = x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
    return v instanceof Number && v.lowerBound ? `≥ ${s}` : s;
  };
  return {
    num, int: v => (nil(v) ? 'not held' : `${v instanceof Number && v.lowerBound ? '≥ ' : ''}${Math.round(+v).toLocaleString('en-US')}`),
    mw: (v, dp) => (nil(v) ? 'not held' : `${num(v, dp ?? 1)} MW`),
    lmp: v => (nil(v) ? 'not held' : `${+v < 0 ? '−' : ''}$${num(Math.abs(+v), 2)}/MWh`),
    pct: (v, dp = 1) => (nil(v) ? 'not held' : `${num(v, dp)}%`),
    money: (v, dp = 2) => (nil(v) ? 'not held' : `${+v < 0 ? '−' : ''}$${num(Math.abs(+v), dp)}`),
  };
}
const lowerBound = v => Object.assign(new Number(v), { lowerBound: true }); // eslint-disable-line no-new-wrappers

// ---------- reasons for every value the bridge serves as null (04a §2; M3 brief step 3) ----------
export const WHY = {
  lmp_2050: 'Not held: no 2045/2050 run in the unified DB (the vendor 2045/2050 were 2040 × 1.0816 per step, a flat escalation)',
  tb4_2050: 'Not held: no 2050 run in the unified DB (the vendor 2050 was a flat escalation)',
  tb4_2035: 'Not held: measures/all publishes TB4 for the 2030 run only; TB4 by run is per bus on Prices › Storage spreads',
  tb_2030: 'Not held: measures/all publishes TB4 for the 2030 run only; TB2 and TB8 by run are per bus on Prices › Storage spreads',
  curt_bess: 'Not modelled: the PCR runs hold no storage curtailment (Market curtailment covers solar and wind resources)',
  curt_dc: 'Not modelled: a data centre has no curtailment in the PCR runs',
  basis_zone: 'Not held here: zone basis 2030 has no all-bus provider yet (per bus on Prices › Basis & congestion; follow-up endpoint)',
  land: 'Not screened: the land screen (data/land.json) holds this many buses; open Land for any other bus',
  land_cost: 'Not held: no land-cost table in the unified DB (the live figure is an assumption band from GridSense_one)',
  top_shadow: 'Not held: no per-bus shadow price in the unified DB (the vendor Top_Constraint fields are excluded: data_quality)',
  demo_syn: 'Hidden: demo (synthetic) data is not One Studio data',
  cape: 'Not held: the Cape 5-yr flag needs 5-yr binding rows the unified DB does not hold',
  cong_share: 'Not held: no card states a congestion share; Congestion (MCC) in $/MWh is the held component',
  capture: 'Not loaded: the clear-sky capture ratio is computed from the bus’s hourly 2030 run (Prices › Capture ratio by year, pcr2030 row); select or pin the bus to load it',
  capture_wind: 'Not held all-bus: wind capture needs the ISO-NE fleet shape (Prices › Wind capture), computed per bus',
  sheet: 'Not applicable: One Studio holds no vendor sheet to compare with the solved run',
  partial: 'Not held: a part year (under 95% of its hours) is never shown as an annual mean',
  run: 'Not held: no solved run priced at this bus for that year',
  open: 'Open: needs this bus\'s hourly prices; select the bus and Decision computes it',
  score: 'Not scored: the bus does not meet the Market requirements at this scope, or holds under 60% of the weighted measures (Market › Rank & compare)',
};
const TB_NULL = { tb2_2030: WHY.tb_2030, tb8_2030: WHY.tb_2030, tb4_2035: WHY.tb4_2035, tb4_2050: WHY.tb4_2050 };

// ---------- prices: measures/all on the basis (settled RT history, solved PCR runs) ----------
/** One price at one bus and year: settled RT annual mean (≤ 2026, complete years only) or the solved run for that horizon. */
export function priceAt(m, y) {
  if (!m) return null;
  y = Number(y);
  if (y <= 2026) {
    const v = m.y?.[String(y)];
    return ok(v) && m.n?.[String(y)] == null ? { value: v, source: 'settled', run: null, year: y } : null;
  }
  const run = hzRun(y);
  if (!run || m.unpriced?.includes(run)) return null;
  const v = m.f?.[run];
  return ok(v) ? { value: v, source: 'solved', run, year: y } : null;
}
const settled = (m, v) => (m && m.n?.['2025'] == null && ok(v) ? v : null); // marketcore MEASURES `settled`: partial 2025 → not held

// ---------- queue (D-007: requests with unknown MW are dropped and counted, no patch P3) ----------
export function queueKnown(points) {
  const all = Array.isArray(points) ? points : [];
  const known = all.filter(q => ok(Number(q.max_mw)) && q.max_mw != null);
  return { known, unknown: all.length - known.length };
}

// ---------- selection (the live rule: snapshot ext/30-app-frame.js selectBus L608-619) ----------
/** Pins after selecting a bus that is not an option: added if new; at five, the oldest drops (brief; live L616 refuses). */
export function pinsAfterSelect(pins, id, max = 5) {
  const a = (pins || []).map(String), s = String(id);
  if (a.includes(s)) return { pins: a, dropped: null, added: false };
  const dropped = a.length >= max ? a[0] : null;
  return { pins: [...a.slice(dropped ? 1 : 0), s], dropped, added: true };
}
/**
 * What one map/grid selection does, as app actions applied in one batch (one render, no hash write here):
 *   option bus → `sel-opt` (live L614-615); other bus → `node` (S.nodeId, dashboards follow) + pin (live L616)
 *   with the live "add it as an option" toast; already pinned → `node` only (live L617-618). Every click also sets
 *   S.ui.inspect for the inspector (M4 hook), applied last because `sel-opt` may replace S.ui.
 */
export function selectionPlan({ S, project, id, node }) {
  const s = String(id);
  if (!node) return { actions: [], toast: `Bus ${s} is not in this dataset.` };
  const who = `${node.name} ${node.kv ?? '?'} kV`;
  const inspect = ['ui', { kind: 'bus', id: s }, { dataset: { k: 'inspect' } }];
  const hit = project?.options?.find(o => String(o.busId) === s);
  if (hit) {
    if (S.walk?.option !== hit.id) return { kind: 'option', actions: [['sel-opt', hit.id], inspect], toast: `${who} selected — it is an option on ${project.name}, so every dashboard now reads it.` };
    return { kind: 'option-bus', actions: String(S.nodeId) === s ? [inspect] : [['node', s], inspect], toast: null };
  }
  const actions = String(S.nodeId) === s ? [] : [['node', s]];
  const pp = pinsAfterSelect(S.pins, s);
  if (!pp.added) return { kind: 'bus', actions: [...actions, inspect], toast: `${who} selected. It was already pinned.` };
  if (pp.dropped) actions.push(['pin', pp.dropped]);
  actions.push(['pin', s], inspect);
  const where = project ? project.name : 'any project';
  return { kind: 'bus', actions, dropped: pp.dropped,
    toast: `${who} selected and pinned (${pp.pins.length} of 5)${pp.dropped ? `; the oldest pin (${pp.dropped}) was dropped` : ''}. It is not an option on ${where}: add it as an option in Decision to read every gate at it.` };
}

// ---------- Market's request and weights: ONE home, views/market.js req()/weights() (exported by W-B 2026-10-07) ----------
// The earlier copy had already diverged (shoulder default): never replicate these again.
import { req as marketReqView, weights as marketWeightsView } from './views/market.js';
export const marketReq = S => marketReqView(S);
export const marketWeights = S => marketWeightsView(S);

// ---------- the bridge ----------
/**
 * sources: { meta, groups: {identity, branches, zones, stations, loading, pre_issues, short_circuit, queue, load_pays,
 *   forecast_delta, land_cost_proxy, cathy, run_input_flags}, market (/api/market), measures (measures/all),
 *   curtail (data/market-curtail.json), land (data/land.json) }
 * host: { getState, getData, project, dispatch, render, toast, candidateGates }
 */
export function createBridge(sources, host) {
  const G = sources.groups, M = sources.measures?.buses || {};
  const st = () => host.getState();
  const fmt = makeFmt();
  const RULES = sources.rules && typeof sources.rules === 'object' ? sources.rules : null; // rules/isone-2026.json, loaded once in loadSources

  // ---- engine: the Market study copy over /api/market (gridrules filters per bus; prepare indexes it) ----
  const study = prepare(sources.market);
  attachMeasures(study, sources.measures);
  const curtRowsAll = curtailRows(sources.curtail);
  const mNode = new Map(study.nodes.map(n => [Number(n.bus_id), n]));
  const gridOf = b => study.gridOf(b);
  const GOV = new Map(); // bus → { caseKey: {governing, element status, basis} } over the five store cases
  function govOf(bus) {
    if (!GOV.has(bus)) {
      const o = {};
      for (const tech of ['storage', 'datacenter']) for (const r of caseTable(gridOf(bus), bus, tech, 1, 1)) o[r.key] = { value: ok(r.governing) ? r.governing : null, el: r.element.status, basis: r.basis };
      GOV.set(bus, o);
    }
    return GOV.get(bus);
  }
  const PRIM = new Map();
  function primary(bus, tech) {
    // P2 C03: binding() names the breaching element row AT the request size, so the column reads the project's own size
    // (the Grid › Connection capacity call, as gatesAt does), never a 1 MW probe that reports the envelope minimum.
    const S = st() || {}, e = tech === 'datacenter' ? 0 : Number(S.exportMW) || 0, i = Number(S.importMW) || 0;
    const k = `${bus}|${tech}|${e}|${i}`;
    if (!PRIM.has(k)) {
      if (PRIM.size > 50000) PRIM.clear();
      const t = caseTable(gridOf(bus), bus, tech, e, i), ex = binding(t, 'export'), im = binding(t, 'import');
      const v = tech === 'datacenter' ? im : ['storage', 'hybrid'].includes(tech) ? null : ex;
      let value, status;
      if (v) ({ value, status } = v);
      else { const a = ok(ex.value) ? ex.value : null, b = ok(im.value) ? im.value : null; value = a == null ? b : b == null ? a : Math.min(a, b); status = [ex.status, im.status].join(' / '); }
      PRIM.set(k, { value: ok(value) ? value : null, status, row: (v || ex).row || null });
    }
    return PRIM.get(k);
  }
  // Upgrade cost at 100 / 250 MW: Market networkCost's service arguments (views/market.js L404), the Grid card's function.
  const COSTS = new Map();
  function costAt(bus, tech, mw) {
    const k = `${bus}|${tech}|${mw}`;
    if (!COSTS.has(k)) {
      const [e, i] = tech === 'datacenter' ? [0, mw] : ['storage', 'hybrid'].includes(tech) ? [mw, mw] : [mw, 0];
      const c = stepCostService(gridOf(bus), bus, tech, e, i);
      let total = null, why = null;
      if (c.status === 'True zero') total = 0;
      else if (c.status === 'Priced') total = c.total;
      else if (['Lower bound', 'Partly priced'].includes(c.status)) {
        // P2 C10 (grid lead wiring 18): a bound with nothing priced has total null in the engine; never a '≥ $0' cell.
        if (ok(c.total)) total = lowerBound(c.total);
        else why = `Not held: ${costDisplay(c)}`;
      } else why = c.status === 'No upgrades indicated' ? 'No upgrades indicated on the envelope only (vendor-asserted): not a verified $0' : `Not held: ${c.status}`;
      COSTS.set(k, { total_musd: total, per_kw: ['Priced', 'True zero'].includes(c.status) ? perKw(c.total, mw) : null, status: c.status, why: why || (total instanceof Number ? null : null) });
    }
    return COSTS.get(k);
  }
  const CURT = new Map();
  function curtAt(bus, tech, run = 'pcr2030') {
    const type = curtailFuel(tech); if (!type) return null;
    const k = `${bus}|${type}|${run}`;
    if (!CURT.has(k)) { const n = mNode.get(bus), v = n ? nearbyCurtailment(n, curtRowsAll, run, type, 25) : null; CURT.set(k, v ? 100 * v.share : null); }
    return CURT.get(k);
  }
  // Land: landcore.screen over data/land.json (the 166 screened buses), the Land and Decision cards' reader.
  const landEx = sources.land?.exclusions || {};
  const nScreened = Object.keys(landEx).length;
  const landWhy = WHY.land.replace('this many buses', `${nScreened.toLocaleString('en-US')} buses`);

  // ---- node records: identity (display-only) + engine fields, numbers for the module ----
  const ident = G.identity || { cols: [], rows: [] };
  const ix = Object.fromEntries(ident.cols.map((c, i) => [c, i]));
  const PI = G.pre_issues || {}, SC = G.short_circuit || {};
  const nodes = ident.rows.map(r => {
    const g = k => (ix[k] == null ? null : r[ix[k]]);
    const bus = Number(g('bus_id')), m = M[String(bus)] || null, gv = govOf(bus), pi = PI[String(bus)] || {};
    const p = y => priceAt(m, y)?.value ?? null;
    const p30 = m && !m.unpriced?.includes('pcr2030');
    const n = {
      bus_id: bus, name: g('name'), kv: g('kv'), zone: g('zone_sheet'), zone_source: g('zone_src'), state: g('state'), county: g('county'), lat: g('lat'), lon: g('lon'),
      hourly_conf: g('hourly_conf'), shared_n: g('shared_n'), outlets: g('outlets'), branch_deg: g('branch_deg'), gen_mw: g('gen_mw'), load_mw: g('load_mw'),
      top_constraint: g('top_constraint'), top_shadow: null,
      // engine: governing limit per case (gridrules caseTable; the Grid › Connection capacity table)
      hr_sp_dis: gv['summer_peak|discharge']?.value ?? null, hr_sh_dis: gv['shoulder|discharge']?.value ?? null, hr_sp_chg: gv['summer_peak|charge']?.value ?? null,
      hr_sh_chg: gv['shoulder|charge']?.value ?? null, hr_ll_chg: gv['large_load|charge']?.value ?? null,
      pi_sp_dis: pi.sp_dis ?? null, pi_sp_chg: pi.sp_chg ?? null, // sheet counts (display-only, labelled "sheet")
      // prices (measures/all)
      lmp_2025: p(2025), lmp_2030: p(2030), lmp_2035: p(2035), lmp_2050: null,
      p5_2030: p30 && ok(m.p5_30) ? m.p5_30 : null, p95_2030: p30 && ok(m.p95_30) ? m.p95_30 : null,
      basis_own_2025: m && m.bHours >= 0.95 * 8760 && ok(m.bZone) ? m.bZone : null, // MEASURES.basisZone rule
      cong_2025: null, hneg_2025: settled(m, m?.neg), rt_neg_2025: settled(m, m?.neg), h200_2025: settled(m, m?.h200), std_2025: settled(m, m?.std),
      wind_cap_2030: null, tb2_2030: null, tb8_2030: null, tb4_2035: null, tb4_2050: null,
      tb4_2030: p30 && ok(m.tb4_30) ? m.tb4_30 : null,
    };
    for (const z of ['ME', 'NH', 'VT', 'CT', 'RI', 'SEMA', 'WCMA', 'NEMA']) n[`basis_${z}_2030`] = null;
    for (const s of SIZES) { n[`solar_${s}MW_2030`] = curtAt(bus, 'solar'); n[`wind_${s}MW_2030`] = curtAt(bus, 'wind'); n[`bess_${s}MW_2030`] = null; n[`dc_${s}MW_2030`] = null; }
    return n;
  });
  // Solar capture 2030 = Prices › "Capture ratio by year", pcr2030 row (views/prices.js capYears L592-603): clear-sky
  // weighted over the bus's own hourly pcr2030 series. Held for buses whose payload the app has loaded (current, pinned).
  const CAP = new WeakMap();
  function capSolar(bus) {
    const D = host.getData ? host.getData() : null; if (!D?.series) return null;
    const s = D.series.find(x => String(x.nodeId) === String(bus) && x.mode === 'forecast' && x.run === 'pcr2030');
    const dn = (D.nodes || []).find(x => String(x.id) === String(bus));
    if (!s || !dn) return null;
    if (!CAP.has(s)) { const c = captureOf(heldRows(s), r => clearSky(r.timestamp, dn.latitude, dn.longitude)); CAP.set(s, ok(c.ratio) ? c.ratio : null); }
    return CAP.get(s);
  }
  for (const n of nodes) Object.defineProperty(n, 'solar_cap_2030', { get: () => capSolar(n.bus_id), enumerable: true });
  const byId = new Map(nodes.map(n => [n.bus_id, n]));
  const node = id => byId.get(Number(id));
  const stations = ((G.stations || {}).stations || []).map(list => list.map(id => byId.get(Number(id))).filter(Boolean)).filter(l => l.length);
  const q = queueKnown(G.queue?.points);

  // ---- per-scope memo (Market ranking and gates are scope-wide) ----
  const MEMO = new Map();
  const memo = (k, f) => { if (!MEMO.has(k)) { if (MEMO.size > 60) MEMO.clear(); MEMO.set(k, f()); } return MEMO.get(k); };
  // Gates are one entry per bus: in MEMO (cap 60) a single rebuild of 2,678 rows cleared it ~45 times, so the scope-wide
  // rank above and every bus's gates were recomputed on each rebuild. Their own memo holds one scope of buses.
  const GMEMO = new Map();
  const gmemo = (k, f) => { if (!GMEMO.has(k)) { if (GMEMO.size > 20000) GMEMO.clear(); GMEMO.set(k, f()); } return GMEMO.get(k); };

  function score(fuel, weights, o = {}) {
    const S = st(), r = { ...marketReq(S), tech: fuelFromLive(fuel) };
    if (r.maxCurtailPct != null && !study.curtail) attachCurtailment(study, sources.curtail); // Market's curtailment requirement reads node.curt
    const w = Object.fromEntries(Object.entries(weights || marketWeights(S)).filter(([k]) => !k.startsWith('$')));
    const keys = Object.keys(w).filter(k => w[k] > 0);
    const rk = memo(JSON.stringify(['rank', r, w]), () => rank(memo(JSON.stringify(['ev', r]), () => evaluate(study, r)), keys, w));
    return { rows: rk.scored.map(x => ({ n: node(x.node.bus_id), score: x.score, coverage: x.coverage })).filter(x => x.n), poolSize: rk.poolSize, gate: !!o.gate };
  }

  /** Decision gates: the current bus reads Decision's own candidateGates(D, S); elsewhere decisioncore.gates on the
   *  inputs held all-bus (grid connection and cost, land screen); revenue, capture and queue stay Open. */
  const VERDICT = { Pass: 'Pass', Fail: 'Fail', Hold: 'Open' };
  const pack = list => ({ gates: list.map(x => ({ label: x.gate, value: `${VERDICT[x.verdict] || x.verdict} — ${x.why}`, state: x.verdict })), clear: list.filter(x => x.verdict === 'Pass').length, total: list.length });
  function currentGates() {
    try { const S = st(); const g = host.candidateGates ? host.candidateGates(host.getData(), S) : null; return g && g.length ? g : null; } catch { return null; }
  }
  function gatesAt(fuel, n, mw, ck = 'sp') {
    const S = st(), tech = fuelFromLive(fuel), bus = Number(n.bus_id);
    if (String(bus) === String(S.nodeId)) { const g = currentGates(); if (g) return pack(g); }
    const e = Number(S.exportMW), i = Number(S.importMW);
    return gmemo(JSON.stringify(['gate', bus, tech, e, i]), () => {
      const t = caseTable(gridOf(bus), bus, tech, e, i), ex = binding(t, 'export'), im = binding(t, 'import');
      const fp = footprint(sources.land?.intensity, tech, tech === 'datacenter' ? i : e);
      const m = { node: { id: String(bus) }, cases: t, envelopeOnly: envelopeOnlyCases(t), exportLimit: ex.value, exportStatus: ex.status, importLimit: im.value, importStatus: im.status,
        cost: stepCostService(gridOf(bus), bus, tech, e, i), queueMatched: null, queueNotModelled: null, queueLinkedMW: null, queueLinkedTotal: null,
        land: landFit(fp, landScreen(landEx, bus)), revenue: { value: null, reason: WHY.open }, loadCost: { value: null, reason: WHY.open }, fuel: {} };
      const list = decisionGates(m, { tech }).map(x => (/^(Queue exposure|Revenue evidence|Load cost evidence|Capture)$/.test(x.gate) && x.verdict === 'Hold' ? { ...x, why: `${WHY.open} (${x.why})` } : x));
      return pack(list);
    });
  }

  const GS = {
    D: { queue: q.known, queueUnknown: q.unknown, iso: { top_facilities: G.queue?.top_facilities || [] } },
    nodes, node, stations, fmt, FUELS, SIZES, caseOf, CASES,
    headroom(n, ck, dir) { const k = n ? caseKeyFor(ck, dir) : null; return k ? govOf(Number(n.bus_id))[k]?.value ?? null : null; },
    primaryHeadroom(n, fuel, ck) { return n ? primary(Number(n.bus_id), fuelFromLive(fuel)).value : null; },
    preIssues(n, ck, dir) { if (!n) return null; const p = PI[String(n.bus_id)]; const k = `${ck}_${dir === 'withdrawal' ? 'chg' : 'dis'}`; return p && p[k] != null ? p[k] : null; },
    shortCircuitMVA(n) { const v = n ? SC[String(n.bus_id)] : null; return ok(v) ? v : null; },
    curt(n, fuel, mw, year = 2030) { return n ? curtAt(Number(n.bus_id), fuelFromLive(fuel), year === 2030 ? 'pcr2030' : hzRun(year) || 'pcr2030') : null; },
    candidates(o = {}) {
      const fuel = o.fuel || 'solar', size = o.size || 100, ck = o.case || 'sp';
      let rows = nodes.map(n => ({ n, hr: GS.primaryHeadroom(n, fuel, ck), curt: GS.curt(n, fuel, size), cap: null }));
      if (o.gate) rows = rows.filter(r => r.hr != null && r.hr >= size);
      return { rows, count: rows.length, universe: nodes.length };
    },
    score, gates: gatesAt,
    priceAt(n, y) { return n ? priceAt(M[String(n.bus_id)], y) : null; },
    priceColumn(y) { return nodes.map(n => priceAt(M[String(n.bus_id)], y)?.value ?? null); },
    // No vendor sheet is held, so no sheet-vs-run anomaly exists to flag (the live ext/76 lists are sheet-based).
    priceAnomalies: { list: [], why: WHY.sheet }, priceAnomaliesNeighbour: { list: [], why: WHY.sheet },
  };

  // ---- GS_DATA_EXT: display-only groups as served, engine groups built here ----
  const STOH = {};
  for (const n of nodes) STOH[n.bus_id] = { sp_dis: n.hr_sp_dis, sh_dis: n.hr_sh_dis, sh_chg: n.hr_sh_chg, pi_sh_chg: PI[String(n.bus_id)]?.sh_chg ?? null };
  const DECOMP = {};
  for (const n of nodes) {
    const m = M[String(n.bus_id)], lmp = priceAt(m, 2025)?.value;
    if (ok(lmp) && ok(m.cong) && ok(m.loss)) DECOMP[n.bus_id] = { years: [{ year: 2025, market: 'RT', energy: lmp - m.cong - m.loss, congestion: m.cong, loss: m.loss }] };
  }
  const EXCL = {};
  for (const id of Object.keys(landEx)) { const s = landScreen(landEx, id); if (s) EXCL[id] = { clear_acres: s.clear ?? null, disc_acres: s.gross ?? null, clear_blocks: s.blocks ?? null, radius_mi: s.radiusMi ?? null }; }
  const COST_KEY = /^(\d+)\|([a-z_]+)\|([a-z]+)\|(\d+)$/;
  const cost = new Proxy({}, { get(t, k) {
    const mm = typeof k === 'string' && COST_KEY.exec(k); if (!mm) return undefined;
    const c = costAt(Number(mm[1]), st().tech, Number(mm[4]));
    return { total_musd: c.total_musd, per_kw: c.per_kw };
  } });
  const cathy = { bus_annual: {}, bus_full: {}, meta: { bus_annual_cols: ['scenario', 'year', 'market', 'mean', 'hours', 'kind'], demo_buses: [] }, retirements: [] };
  for (const [id, c] of Object.entries(G.cathy || {})) { cathy.bus_annual[id] = { tier: c.tier, rows: [] }; if (c.distance_mi != null) cathy.bus_full[id] = { distance_mi: c.distance_mi }; }
  const EXT = {
    meta: { coverage: sources.meta?.coverage || {}, generation: sources.meta?.generation || null },
    network: { branches: G.branches?.branches || [] }, zones: G.zones?.zones || [], zone_fix: G.zones?.zone_fix || {},
    loading: G.loading || {}, cost, storage_headroom: STOH, decomp: DECOMP, load_pays: G.load_pays || {}, forecast_delta: G.forecast_delta || {},
    exclusions: EXCL, land_cost_proxy: Array.isArray(G.land_cost_proxy?.rows) && G.land_cost_proxy.rows.length ? G.land_cost_proxy : null,
    cathy, run_input_flags: G.run_input_flags || {},
  };

  // ---- App (UI shims over S) ----
  const projView = new Map();
  function projectOf() {
    const p = host.project ? host.project() : null; if (!p) return null;
    if (!projView.has(p)) projView.set(p, { ...p, locations: [], evidence: [], options: p.options });
    return projView.get(p);
  }
  let regVersion = 0;
  const App = {
    H(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; },
    esc, icon: () => '',
    toast: m => host.toast(m),
    project: projectOf,
    options: p => (p?.options || []).map(o => ({ id: o.id, busId: Number(o.busId), label: o.label })),
    option() { const p = projectOf(), S = st(); return p ? App.options(p).find(o => o.id === S.walk?.option) || null : null; },
    setOption: id => host.dispatch([['sel-opt', String(id)]]),
    addOptionFor(n) {
      if (!n) return;
      if (host.project?.()?.user) { host.dispatch([['proj-add-opt', String(n.bus_id)]]); return; } // L1: an option of the open user project
      host.dispatch([['d-add', String(n.bus_id)]]); host.toast(`${n.name} ${n.kv ?? '?'} kV added as a Decision option.`);
    },
    get state() { const S = st(), p = projectOf(); return { optionId: S.walk?.option || null, pins: (S.pins || []).map(Number), projects: p ? [p] : [], view: 'stage' }; },
    ctx() {
      const S = st(), fuel = fuelToLive(S.tech), F = FUELS[fuel], ck = CASE_KEYS.includes(S.caseKey) ? S.caseKey : 'sp';
      return { fuel, F, size: S.tech === 'datacenter' ? Number(S.importMW) : Number(S.exportMW), case: ck, caseObj: caseOf(ck), direction: F.direction === 'both' ? 'injection' : F.direction, project: projectOf(), option: App.option() };
    },
    render: () => host.render(),
    /** Market's weights, plus a `$scope` token: the module's rebuild key reads JSON(weightsFor), so anything the engine
     *  values depend on (request, Market inputs, the current bus's Decision gates, registry edits) re-reads the rows. */
    weightsFor(fuel) {
      const S = st(), g = currentGates();
      const token = JSON.stringify([BRIDGE_VERSION, regVersion, marketReq(S), S.nodeId, g ? g.map(x => x.verdict).join('') : null, host.getData?.()?.series?.length || 0]);
      return { ...marketWeights({ ...S, tech: fuelFromLive(fuel) }), $scope: token };
    },
  };

  function selectBus(id) {
    const S = st(), plan = selectionPlan({ S, project: projectOf(), id, node: node(id) });
    if (plan.actions.length) host.dispatch(plan.actions);
    if (plan.toast) host.toast(plan.toast);
    return node(id) ? Number(id) : null;
  }

  // ---- S5 #5: TAX_COLUMNS (the 04 column-spec shape) adapted to the registry shape. The gate is project-scoped
  //      (technology, size, Queue COD year, the user's BOC / MACR entries), so one taxCells() per state serves every row;
  //      an undecided gate is an empty cell with its reason, never a pass. ----
  function taxGridColumns() {
    let memoKey = null, memoVal = null;
    const cells = () => {
      const S = st(), row = { tech: S.tech, mw: Number(S.tech === 'datacenter' ? S.importMW : S.exportMW), queueCod: Number(S.ui?.qCod) || null, tax: S.ui?.tax || {} };
      const k = JSON.stringify([row, !!RULES]);
      if (k !== memoKey) { memoKey = k; memoVal = RULES ? taxCells(row, RULES) : null; }
      return memoVal;
    };
    return TAX_COLUMNS.map(c => ({ id: c.id, key: c.id, label: c.label, unit: c.unit, family: c.family, source: c.source, type: 'text', dp: 0, sort: 1, fuels: ['solar', 'wind', 'bess', 'hybrid'], hideFor: ['dc'],
      get: () => { const x = cells()?.[c.id]; return x && x.value != null ? x.text : null; },
      why: () => { const x = cells()?.[c.id]; return x ? `Not held: ${x.reason || x.text}` : 'Not held: rules/isone-2026.json did not load'; },
      hint: `${c.label} · ${c.nullRender}. Same value at every bus: the gate is project-scoped (technology, size, Queue COD year, your BOC / MACR entries on Economics › Project finance). ${c.source}.` }));
  }

  // ---- registry: reasons, header badges and sources the engine owns (applied once the module has booted) ----
  const nowFuel = () => fuelToLive(st().tech);
  /** regBy: the module's private id index (REG_BY), when loadVendor() could reach it; null → new columns are listed only. */
  function applyRegistry(MG, regBy = null) {
    const C = new Map((MG?.COLUMNS || []).map(c => [c.id, c]));
    const set = (id, o) => { const c = C.get(id); if (c) Object.assign(c, o); };
    const why = s => () => s;
    const caseWhy = key => r => { const g = govOf(r.n.bus_id)[key]; return g ? `${g.basis} (element study: ${g.el})` : 'Not held'; };
    const U = { hist: '$/MWh · hist 2025', p30: '$/MWh · proj 2030 · pcr2030' };
    set('hr', { source: 'engine: gridrules binding over the fuel\'s cases (caseTable)', why: r => { const p = primary(r.n.bus_id, fuelFromLive(nowFuel())); return `${p.status}: no governing limit held for the fuel's cases at this bus`; } });
    for (const [id, key] of [['hr_sp_dis', 'summer_peak|discharge'], ['hr_sh_dis', 'shoulder|discharge'], ['hr_sp_chg', 'summer_peak|charge'], ['hr_sh_chg', 'shoulder|charge'], ['hr_ll_chg', 'large_load|charge'],
      ['sto_sp_dis', 'summer_peak|discharge'], ['sto_sh_dis', 'shoulder|discharge'], ['sto_sh_chg', 'shoulder|charge']]) set(id, { source: `engine: gridrules caseTable governing · ${key}`, why: caseWhy(key) });
    for (const mw of [100, 250]) {
      const cw = r => costAt(r.n.bus_id, st().tech, mw).why || 'Not held';
      set(`cost${mw}`, { source: `engine: gridrules stepCostService at ${mw} MW (Grid › Upgrade cost)`, why: cw, hint: `Network upgrade cost to connect ${mw} MW of the scope fuel, every case it needs (Grid › Upgrade cost rule). "≥" marks a lower bound: a case without an element list may add to it.` });
      set(`kw${mw}`, { source: `engine: stepCostService at ${mw} MW ÷ ${mw} MW`, why: r => (costAt(r.n.bus_id, st().tech, mw).total_musd instanceof Number ? 'Not held: the cost is a lower bound (≥), so no $/kW is stated' : cw(r)) });
    }
    set('sc', { source: 'api_mapgrid short_circuit (dim_bus.short_circuit_mva, corrected)', why: why('Not held: dim_bus.short_circuit_mva is null for this bus') });
    set('lmp_2025', { label: 'LMP 2025', unit: U.hist, source: 'engine: measures/all y[2025] (settled RT mean)', why: why(`${WHY.partial}; or no settled series at this bus`) });
    set('lmp_2030', { unit: U.p30, source: 'engine: measures/all f.pcr2030', why: why(WHY.run) });
    set('lmp_2035', { unit: '$/MWh · proj 2035 · pcr2035', source: 'engine: measures/all f.pcr2035', why: why(WHY.run) });
    set('lmp_2050', { why: why(WHY.lmp_2050) });
    for (const y of [2025, 2030, 2035, 2040]) set(`lmp${y}_pb`, { unit: y === 2025 ? U.hist : `$/MWh · proj ${y} · ${hzRun(y)}`, source: `engine: GS.priceAt(bus, ${y}) = measures/all`, why: why(y === 2025 ? WHY.partial : WHY.run) });
    set('px_src', { why: why('Not held: no price for 2030 at this bus') });
    set('px_gap', { why: why(WHY.sheet) });
    set('p5', { unit: U.p30 }); set('p95', { unit: U.p30 });
    set('basis', { unit: '$/MWh · hist 2025 · own zone', source: 'engine: measures/all bZone (hour-matched, Market basisZone rule)', why: why('Not held: under 95% of 2025 hours matched against the own zone') });
    for (const z of ['ME', 'NH', 'VT', 'CT', 'RI', 'SEMA', 'WCMA', 'NEMA']) set(`basis_${z}`, { why: why(WHY.basis_zone) });
    set('cong', { why: why(WHY.cong_share) });
    for (const id of ['hneg', 'rt_neg', 'h200']) set(id, { unit: 'h · hist 2025', why: why(`${WHY.partial} (2025)`) });
    set('std', { unit: U.hist, why: why(`${WHY.partial} (2025)`) });
    for (const id of ['energy', 'cong_part', 'loss_part']) set(id, { unit: '$/MWh · hist 2025 · ISO-NE sign', source: 'engine: measures/all 2025 RT (E = LMP − C − L on the settled ISO-NE sign)', why: why('Not held: no complete settled 2025 series at this bus') });
    set('curt', { unit: '% · proj 2030 · pcr2030', source: 'engine: marketcore.nearbyCurtailment (pcr2030, 25 km)', why: r => (['bess', 'dc'].includes(nowFuel()) ? (nowFuel() === 'bess' ? WHY.curt_bess : WHY.curt_dc) : 'Not held: no modelled resource of this type within 25 km in the 2030 run') });
    for (const f of ['solar', 'wind', 'bess', 'dc']) for (const s of SIZES) set(`curt_${f}_${s}`, f === 'bess' || f === 'dc' ? { why: why(f === 'bess' ? WHY.curt_bess : WHY.curt_dc) }
      : { unit: '% · proj 2030 · pcr2030', hint: `Market curtailment screen: modelled ${f} curtailment of the 2030 run's resources within 25 km. Not size-specific: the same value at every size.`, why: why(`Not held: no modelled ${f} resource within 25 km in the 2030 run`) });
    set('cap_solar', { unit: 'ratio · proj 2030 · pcr2030 · clear-sky', source: 'engine: Prices capYears (captureOf × clearSky) on the bus payload, pcr2030', why: why(WHY.capture), hint: 'Clear-sky solar capture ratio of the 2030 run at this bus: the Prices › Capture ratio by year row for pcr2030. Computed from the bus’s hourly series, so it is held for the buses loaded in this session (the current bus and the pins). The Prices KPI "Capture ratio" reads the applied basis instead.' });
    set('cap_wind', { why: why(WHY.capture_wind) });
    set('tb2', { why: why(WHY.tb_2030) }); set('tb8', { why: why(WHY.tb_2030) }); set('tb4_2035', { why: why(WHY.tb4_2035) }); set('tb4_2050', { why: why(WHY.tb4_2050) });
    set('tb4', { unit: U.p30, source: 'engine: measures/all tb4_30 (pcr2030, the mart rule)', why: why(WHY.run) });
    for (const id of ['clear_ac', 'disc_ac', 'clear_pct', 'clear_blocks', 'disc_mi']) set(id, { why: why(landWhy) });
    set('top_shadow', { why: why(WHY.top_shadow) });
    set('queue_mi', { hint: `Queue MW (max_mw) of the ${q.known.length} requests within 10 miles of the bus, great-circle: known MW; ${q.unknown} requests of unknown size are not counted.` });
    set('score', { source: 'engine: marketcore evaluate + rank (Market › Rank & compare)', why: why(WHY.score) });
    set('rank', { source: 'engine: Market score order', why: why(WHY.score) });
    set('gates', { source: 'engine: Decision gates (candidateGates at the current bus; decisioncore.gates elsewhere, unknown inputs Open)' });
    set('demo_syn', { hideFor: [...LIVE_FUELS], hideWhy: WHY.demo_syn, why: why(WHY.demo_syn) });
    // ---- P2 columns (04a §2 rows "Queue & system", "Economics · revenue", "Tax", "Large load"): pushed into the module's
    //      registry (COLUMNS = REG) and, when reachable, its id index, so setShown / the chooser / value() can show them.
    //      The rules file is RULES (one load), never fetched per cell. Nothing here computes a value: every cell is the
    //      owner's engine call (rules/isone.js, rules/revenue.js, rules/tax.js, rules/largeload.js). ----
    if (MG?.COLUMNS) {
      const add = c => { if (C.has(c.id)) return; MG.COLUMNS.push(c); C.set(c.id, c); if (regBy) regBy.set(c.id, c); };
      for (const c of queueColumns(() => st())) add(c);                                                            // S3 #2
      for (const c of revenueColumns(() => ({ tech: st().tech, mw: Number(st().exportMW), cod: st().ui?.fin?.cod ?? null, // S4 #4
        durationH: Number(st().ui?.duration) || null, ...revenueUiOpts(st().ui || {}) }), () => RULES)) add(c);
      for (const c of taxGridColumns()) add(c);                                                                       // S5 #5
      if (RULES?.large_load) {                                                                                        // S6 #6
        for (const c of largeLoadColumns({ rules: RULES, gridFor: bus => gridOf(bus), sizeMW: () => Number(st().importMW), service: () => st().ui?.llService || 'FCDS', year: () => llYear(RULES) })) add(c);
      } else console.warn('[bridge] large-load columns not registered: rules/isone-2026.json (large_load) did not load');
    }
    regVersion++;
  }

  return { GS, App, EXT, Views: {}, engine: { study, govOf, primary, costAt, curtAt }, selectBus, applyRegistry, WHY };
}

// ====================================================================================================================
// Browser glue
// ====================================================================================================================
const GROUPS = ['identity', 'branches', 'zones', 'stations', 'loading', 'pre_issues', 'short_circuit', 'queue', 'load_pays', 'forecast_delta', 'land_cost_proxy', 'cathy', 'run_input_flags'];
const VENDOR = ['vendor/live/31-map-grid', 'vendor/live/32-basemap']; // 32 binds to GSMapGrid at load (32 L49-53): 31 first

async function getJson(url) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(url);
      const body = await r.json().catch(() => null);
      if (r.ok) return body;
      last = Object.assign(new Error(body?.error ? `${body.error}${body.reason ? ` (${body.reason})` : ''}` : `HTTP ${r.status} for ${url}`), { status: r.status, fix: body?.fix });
      if (r.status === 503 || r.status === 404) break;
    } catch (e) { last = e; }
  }
  throw last;
}
/** Every source in parallel; the mapgrid groups must all carry the meta's generation (one retry if a rebuild landed between). */
export async function loadSources() {
  for (let attempt = 0; attempt < 2; attempt++) {
    const [meta, market, measures, curtail, land, samples, rules, ...gs] = await Promise.all([
      getJson('./api/x/mapgrid/meta/all'), getJson('./api/market'), getJson('./api/x/market/measures/all'),
      getJson('./data/market-curtail.json'), getJson('./data/land.json'), getJson('./data/samples.json'),
      // the P2 columns' rules, loaded once here (never per cell); the map and grid still load without it
      getJson('./rules/isone-2026.json').catch(e => { console.warn('[bridge] rules file not loaded:', e.message); return null; }),
      ...GROUPS.map(g => getJson(`./api/x/mapgrid/${g}/all`))]);
    const mixed = gs.filter(g => g.generation !== meta.generation);
    if (mixed.length && attempt === 0) continue;
    if (mixed.length) throw new Error(`map/grid data generations differ (${[...new Set(gs.map(g => g.generation))].join(', ')}); reload when the rebuild finishes`);
    return { meta, market, measures, curtail, land, samples, rules, groups: Object.fromEntries(GROUPS.map((g, i) => [g, gs[i].data])) };
  }
  return null;
}

/**
 * Load 31 then 32 (32 binds to GSMapGrid at load). The module indexes its column registry in a private Map built as it
 * loads (`REG_BY = new Map(REG.map(c => [c.id, c]))`, 31:1280); setShown, the chooser and value() read that index, so a
 * column pushed into COLUMNS afterwards is listed in registry() but can never be shown. The vendored file is never
 * edited, so for the span of the two script executions the bridge watches Map construction and keeps the one instance
 * that indexes COLUMNS by id (identity-checked against every column). Found → applyRegistry adds the P2 columns to it
 * and they are showable; not found → they are registered without it, with a console warning. Nothing else is changed:
 * the global is restored in `finally`, and a Map built meanwhile is a Map subclass with no behaviour of its own.
 */
async function loadVendor() {
  for (const v of VENDOR) await addAsset(`./${v}.css`, 'link');
  const NativeMap = window.Map, seen = [];
  class SpyMap extends NativeMap { constructor(it) { super(it); if (it) seen.push(this); } }
  window.Map = SpyMap;
  try { for (const v of VENDOR) await addAsset(`./${v}.js`, 'script'); } finally { window.Map = NativeMap; }
  const cols = window.GSMapGrid?.COLUMNS;
  const idx = cols?.length ? seen.find(m => m.size === cols.length && cols.every(c => m.get(c.id) === c)) : null;
  if (!idx) console.warn('[bridge] the grid registry index was not reachable: the P2 columns are listed but cannot be shown');
  return idx || null;
}

function addAsset(href, tag) {
  return new Promise((res, rej) => {
    if (document.querySelector(`[data-gsx-vendor="${href}"]`)) { res(); return; }
    const el = document.createElement(tag);
    el.setAttribute('data-gsx-vendor', href);
    if (tag === 'script') { el.src = href; el.async = false; } else { el.rel = 'stylesheet'; el.href = href; }
    el.onload = () => res(); el.onerror = () => rej(new Error(`could not load ${href}`));
    document.head.appendChild(el);
  });
}

async function boot() {
  const app = await import('./app.js');
  const { normSamples } = await import('./ui.js');
  let candidateGates = null;
  import('./views/decision.js').then(m => { candidateGates = m.candidateGates; }).catch(() => {});
  let SAMPLES = { projects: [] }, bridge = null, state = 'idle', lastFired = null, needed = false;
  const host = {
    getState: app.getState, getData: app.getData, dispatch: app.dispatch, render: app.render, toast: app.toast,
    // the open project: a user project (projects.js, L1) or a Dummy sample; app.js owns the list
    project: () => { if (app.currentProject) return app.currentProject(); const w = app.getState().walk; return w ? SAMPLES.projects.find(p => p.id === w.project) || null : null; },
    candidateGates: (D, S) => (candidateGates ? candidateGates(D, S) : null),
  };
  const perf = window.__gsBridgePerf = { start: null, data: null, ready: null };
  const hosts = () => [window.GSFrame?.dockHost('map'), window.GSFrame?.dockHost('grid')].filter(Boolean);
  function status(kind, text, detail) {
    for (const h of hosts()) {
      h.querySelector(':scope>.gsf-ph[data-gsf="placeholder"]')?.remove(); // the M1 empty state: replaced by the 05-ui loading state
      let el = h.querySelector(':scope>[data-gsx-bridge]');
      if (!el) { el = document.createElement('div'); el.className = 'gsf-ph'; h.prepend(el); }
      el.setAttribute('data-gsx-bridge', kind);
      el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
      el.innerHTML = `<b>${esc(text)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}${kind === 'error' ? '<button type="button" class="btn sm" data-gsx-retry>Retry</button>' : ''}`;
      el.querySelector('[data-gsx-retry]')?.addEventListener('click', () => { state = 'idle'; start(); });
    }
  }
  const docksOpen = () => { const f = app.getState().ui?.frame || {}; return !(f.mapOff && f.bottomOff); };
  async function start() {
    if (state !== 'idle' || (!docksOpen() && !needed)) return;
    state = 'loading'; perf.start = performance.now();
    status('loading', 'Loading network…', 'Branches, buses and zones from the unified database, with the engine\'s headroom, cost and prices.');
    try {
      const src = await loadSources();
      perf.data = performance.now();
      SAMPLES = normSamples(src.samples);
      bridge = createBridge(src, host);
      Object.assign(window, { GS: bridge.GS, App: bridge.App, Views: bridge.Views, GS_DATA_EXT: bridge.EXT });
      if (window.GSFrame) window.GSFrame.selectBus = selectAndOffer;
      const regBy = await loadVendor();
      if (!window.GSMapGrid) throw new Error('the map module did not start (see the console)');
      bridge.applyRegistry(window.GSMapGrid, regBy);
      // lift plan 14 L3: the vendored live Graph Configurator (loads the L2 runtime first), on this one GS / App, merge-only
      if (window.GSFrame?.featureOn?.('configurator')) import('./views/configurator-host.js').then(cfg => {
        const store = cfg.createWidgetStore({ getState: app.getState, dispatch: app.dispatch }); store.sync();
        cfg.installOnApp(bridge.App, { store, toast: app.toast, render: app.render, nodes: () => bridge.GS.liveRuntime?.model?.nodes || [] });
        return cfg.bootConfigurator(window, { store, getState: app.getState }).then(() => app.refreshCfgSection()); // only its section: a late whole-board render detaches what the reader holds (fix-1)
      }).catch(e => console.warn('[bridge] Graph Configurator not loaded:', e.message));
      // The Layers panel (~190 px) covers most of the 340 px docked map: fold it at boot when the dock is under 520 px,
      // with the module's own toggle (it re-fits the network to the uncovered area). The reader can open it again.
      const lp = document.querySelector('#gsx-map-dock .gsx-layers');
      if (lp && !lp.classList.contains('off') && (window.GSFrame?.dockHost('map')?.clientWidth || 0) < 520) lp.querySelector('.gsx-layers-h')?.click();
      state = 'ready';
      afterRender();
      perf.ready = performance.now();
      // M4: the Inspector reads the meta (generation + coverage for the D-008 note) from this event, never from the route.
      window.dispatchEvent(new CustomEvent('gsbridge:ready', { detail: { generation: src.meta.generation, meta: src.meta } }));
    } catch (e) {
      state = 'error';
      console.warn('[bridge] map/grid not loaded:', e.message);
      status('error', e.status === 503 ? 'Map and grid data are out of date' : 'Network data could not load', `${e.message}${e.fix ? ` · fix: ${e.fix}` : ''}`);
    }
  }
  /** After every renderBoard(): keep GSFrame.selectBus, move the module's selection to S.nodeId, then sync. */
  function afterRender() {
    if (state !== 'ready') { if (state === 'idle' && docksOpen()) start(); return; }
    if (window.GSFrame && window.GSFrame.selectBus !== selectAndOffer) window.GSFrame.selectBus = selectAndOffer;
    const S = app.getState(), id = Number(S.nodeId), MG = window.GSMapGrid;
    if (!MG) return;
    window.GSSelect?.current(); // let an option change land first, so it cannot override the bus fired below
    if (window.GSSelect?.current() !== id || lastFired !== id) {
      lastFired = id;
      document.dispatchEvent(new CustomEvent('gsframe:bus', { detail: { busId: id, node: bridge.GS.node(id) || null } }));
    }
    try { MG.sync(); } catch (e) { console.warn('[bridge] sync:', e.message); }
  }
  // L1 (plan 14 §6): a map or grid selection offers "New project here" / "Add option" in a small pop on that dock
  // (One Studio markup with data-act, so the shell's one action path runs it; the vendored hover card is untouched).
  let lastDock = null;
  document.addEventListener('pointerdown', e => { lastDock = e.target.closest?.('#gsx-map-dock') ? 'map' : e.target.closest?.('#gsx-grid-dock') ? 'grid' : lastDock; }, true);
  function offer(id) {
    if (!window.GSFrame?.featureOn?.('projects')) return;
    const host = window.GSFrame.dockHost(lastDock === 'grid' ? 'grid' : 'map'), n = bridge?.GS.node(id); if (!host || !n) return;
    host.querySelectorAll(':scope>.gsx-bus-pop').forEach(x => x.remove());
    const p = app.currentProject ? app.currentProject() : null, user = p?.user ? p : null, isOpt = !!user?.options.some(o => String(o.busId) === String(id));
    const el = document.createElement('div'); el.className = 'gsx-bus-pop'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', `Bus ${n.name}`); el.setAttribute('data-gsx-pop', String(id));
    el.innerHTML = `<b>${esc(n.name)} ${esc(n.kv ?? '?')} kV · ${esc(id)}</b><button type="button" class="btn xs pri" data-act="proj-new-here" data-v="${esc(id)}">New project here</button>${user && !isOpt ? `<button type="button" class="btn xs" data-act="proj-add-opt" data-v="${esc(id)}" title="Add this bus as an option of ${esc(user.name)}">Add option to ${esc(user.name)}</button>` : ''}<button type="button" class="x" data-gsx-pop-x aria-label="Close">×</button>`;
    el.querySelector('[data-gsx-pop-x]').addEventListener('click', ev => { ev.stopPropagation(); el.remove(); });
    host.appendChild(el);
  }
  function selectAndOffer(id) { const r = bridge.selectBus(id); if (r != null) offer(r); return r; }
  // L4: the LMP Continuum tab needs the one App / GS even with both docks folded
  window.addEventListener('gsx:need-bridge', () => { if (state === 'idle') { needed = true; start(); } });
  app.onRender(afterRender);
  // A folded dock opened from its edge tab starts the load (the frame toggles docks without a board render).
  document.addEventListener('click', e => { if (e.target.closest?.('[data-gsf-dock][data-gsf-open="1"]')) setTimeout(() => { if (state === 'idle') start(); }, 0); }, true);
  (window.requestIdleCallback || (f => setTimeout(f, 200)))(() => start(), { timeout: 600 });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.GS_BRIDGE_OFF) boot().catch(e => console.warn('[bridge] boot:', e.message));
