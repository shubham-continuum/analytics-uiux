// M3 bridge contract (04a §1, §2, §3 and the selection rule): no browser. The bridge's pure core is built on small
// fixtures and checked member by member: shape and arity of every 04a §1 member, id/fuel mapping, the live
// selection rule (snapshot ext/30 L608-619, five-pin rule from the brief), null encodings, engine equality
// (each value equals the engine function called directly), and the ownership grep (no card reads a display-only field).
// Provenance: Claude Opus 5.5 (M3 build agent) · one-studio/design (T3, slice M3) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBridge, makeFmt, fuelToLive, fuelFromLive, selectionPlan, pinsAfterSelect, priceAt, queueKnown, WHY, LIVE_FUELS,
} from '../live-bridge.js';
import { caseTable, binding, stepCostService } from '../gridrules.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- fixtures: three buses, one with no grid rows at all ----------
const A = 100001, B = 111209, C = 111403;
const identity = {
  cols: ['bus_id', 'name', 'kv', 'zone', 'zone_sheet', 'zone_src', 'state', 'county', 'lat', 'lon', 'station', 'hourly_conf', 'shared_n', 'series_n', 'outlets', 'branch_deg', 'gen_mw', 'load_mw', 'top_constraint', 'top_constraint_contingency', 'top_shadow', 'tier', 'proxy_mi', 'pnode', 'pnode_mi'],
  rows: [
    [A, 'Chester', 345, 'ME', 'ME', 'pnode', 'ME', 'Penobscot', 45.39, -68.52, 'Chester', 'exact', 1, 1, 4, 3, null, null, 'X 345', null, null, 'direct', null, 'LD.CHESTER', 0],
    [B, 'Hatchville', 115, 'SEMA', 'SEMA', 'pnode', 'MA', 'Barnstable', 41.62, -70.55, 'Hatchville', 'exact', 1, 1, 3, 2, null, null, null, null, null, 'direct', null, 'LD.HATCHVL', 0],
    [C, 'Mashpee', 115, 'SEMA', 'SEMA', 'county', 'MA', 'Barnstable', 41.64, -70.48, 'Mashpee', null, null, null, null, 1, null, null, null, null, null, 'geo_proxy', 2.1, 'LD.HATCHVL', 2.1],
  ],
};
const groups = {
  identity,
  branches: { branches: [[A, B, 345], [B, C, 115]] },
  zones: { zones: [{ zone: 'SEMA', lat: 41.6, lon: -70.5, buses: 2 }, { zone: 'ME', lat: 45.4, lon: -68.5, buses: 1 }], zone_fix: { [C]: 'SEMA' } },
  stations: { stations: [[A], [B], [C]] },
  loading: { [`${B}|summer_peak|injection`]: { n_rows: 3, violations_before: 0, pre_existing_n: 0 }, [`${B}|summer_peak|discharge`]: `${B}|summer_peak|injection` },
  pre_issues: { [A]: { sp_dis: 1, sp_chg: 2, sh_dis: 5, sh_chg: 2, ll_chg: 2 }, [B]: { sp_dis: 0, sp_chg: 0, sh_dis: 0, sh_chg: 0, ll_chg: 0 } },
  short_circuit: { [A]: 4152.9, [B]: 2100 },
  queue: { points: [{ latitude: 41.63, longitude: -70.5, max_mw: 50, resource_type: 'SUN' }, { latitude: 41.6, longitude: -70.5, max_mw: null, resource_type: 'BAT' }], top_facilities: [{ facility: '111209 HATCHVL   115  111403 MASHPEE   115  1', n: 4 }] },
  load_pays: { [B]: { year: 2025, mean_rt: 66.7, cheap_hours_lt20: 700, cheap_share: 8, hours: 8760 } },
  forecast_delta: { [B]: { delta: 3.9, delta_pct: 7.6 } },
  land_cost_proxy: { rows: null, why: 'no land-cost table in the unified DB' },
  cathy: { [A]: { tier: 'direct', pnode: 'LD.CHESTER', distance_mi: null }, [B]: { tier: 'direct', pnode: 'LD.HATCHVL', distance_mi: null }, [C]: { tier: 'geo_proxy', pnode: 'LD.HATCHVL', distance_mi: 2.1 } },
  run_input_flags: { mcc_5yr: { [B]: 0.2 }, cape_5yr: null },
};
const meta = { generation: 'g1', coverage: { network_source: 'unified dim_branch', network_branches: 2, network_branches_in_store: 2, network_branches_dropped_off_spine: 0 } };
const H = (bus, scenario, direction, mw) => ({ bus_id: bus, scenario, direction, headroom_mw: mw });
const E = (bus, scenario, direction, facility, transfer, cost, o = {}) => ({ bus_id: bus, scenario, direction, monitored_facility: facility, binding_contingency: 'C1', contingency_id: 1, dfax: 0.2, transfer_mw: transfer, base_flow_mw: 50, contingency_flow_mw: 80, rating_a_mva: 100, rating_c_mva: 120, pct_loading_no_transfer: 60, fix_cost_musd: cost, length_miles: 3, facility_type: 'Line', ...o });
const market = {
  nodes: [
    { bus_id: A, name: 'Chester', zone: 'ME', kv: 345, lat: 45.39, lon: -68.52, sc_mva: 4152.9, tier: 'direct', proxyKm: 0, lmp_2025: 50, lmp_2030: 40 },
    { bus_id: B, name: 'Hatchville', zone: 'SEMA', kv: 115, lat: 41.62, lon: -70.55, sc_mva: 2100, tier: 'direct', proxyKm: 0, lmp_2025: 66.745, lmp_2030: 47.2146 },
    { bus_id: C, name: 'Mashpee', zone: 'SEMA', kv: 115, lat: 41.64, lon: -70.48, sc_mva: null, tier: 'geo_proxy', proxyKm: 3.4, lmp_2025: 66.7, lmp_2030: null },
  ],
  grid: {
    headroom: [H(A, 'summer_peak', 'discharge', 300), H(A, 'shoulder', 'discharge', 280), H(A, 'shoulder', 'charge', 150), H(A, 'large_load', 'charge', 400), H(A, 'summer_peak', 'charge', 350),
      H(B, 'summer_peak', 'discharge', 198), H(B, 'shoulder', 'discharge', 220), H(B, 'shoulder', 'charge', 90)],
    constraints: [E(B, 'summer_peak', 'discharge', 'LINE-1', 120, 4.5), E(B, 'summer_peak', 'discharge', 'LINE-2', 180, null)],
  },
};
const measures = { buses: {
  [A]: { y: { 2024: 40.1, 2025: 50 }, n: {}, f: { pcr2030: 40, pcr2035: 45, pcr2040: 50 }, std: 30, neg: 100, h200: 20, cong: -1, loss: 1, tb2: 50, tb4: 40, tb8: 30, p5_30: 10, p95_30: 90, tb4_30: 12, bZone: -1, bHours: 8760 },
  [B]: { y: { 2025: 66.745, 2026: 78.9 }, n: { 2026: 4655 }, f: { pcr2030: 47.2146, pcr2035: 53.0939 }, std: 57.5, neg: 74, h200: 306, cong: 0.1049, loss: 1.0266, tb2: 75.6, tb4: 62.749, tb8: 45.7, p5_30: 24.3, p95_30: 120, tb4_30: 14.9128, bZone: 0.4551, bHours: 8759 },
  [C]: { y: {}, n: {}, f: {}, unpriced: ['pcr2030'] },
} };
const curtail = { cols: ['run', 'type', 'bidder', 'lat', 'lon', 'mwh_offered', 'mwh_curtailed'], rows: [['pcr2030', 'Solar', 's1', 41.63, -70.52, 1000, 30], ['pcr2030', 'Wind', 'w1', 45.4, -68.5, 2000, 100]] };
const land = { exclusions: { [B]: { radius_mi: 8, disc_acres: 128000, clear_acres: 64000, clear_blocks: 9, layers: [] } }, intensity: null };

const project = { id: 'kennebec', name: 'Kennebec solar', options: [{ id: 'o1', busId: String(A), label: 'Option 1' }, { id: 'o2', busId: String(B), label: 'Option 2' }], steps: [] };
function makeHost(over = {}) {
  const calls = [], toasts = [];
  const S = { stage: 'grid', tech: 'solar', exportMW: 100, importMW: 0, caseKey: 'sp', hz: 2030, nodeId: String(B), pins: ['111403'], walk: { project: 'kennebec', option: 'o2', step: 0 }, ui: {}, handoffs: {}, basis: null, ...over };
  return { S, calls, toasts, host: {
    getState: () => S, getData: () => ({ nodes: [], grid: { headroom: [], constraints: [] } }), project: () => (S.walk ? project : null),
    dispatch: (a, v, el) => { calls.push(Array.isArray(a) ? a : [[a, v, el]]); }, render: () => calls.push('render'), toast: m => toasts.push(m),
    candidateGates: () => null,
  } };
}
const sources = { meta, groups, market, measures, curtail, land };
const mk = over => { const h = makeHost(over); return { ...h, br: createBridge(sources, h.host) }; };

// ---------- 04a §1: every member, with its shape ----------
test('App members exist with the live arity and shapes (04a §1)', () => {
  const { br } = mk(), { App } = br;
  for (const k of ['H', 'esc', 'icon', 'toast', 'project', 'options', 'option', 'setOption', 'addOptionFor', 'ctx', 'render', 'weightsFor']) assert.equal(typeof App[k], 'function', `App.${k}`);
  assert.equal(App.H.length, 3, 'H(tag, class, text)');
  assert.equal(App.esc('<a&"'), '&lt;a&amp;&quot;');
  const p = App.project();
  assert.equal(p.id, 'kennebec'); assert.ok(Array.isArray(p.evidence) && Array.isArray(p.locations));
  const opts = App.options(p);
  assert.deepEqual(opts.map(o => [o.id, o.busId]), [['o1', A], ['o2', B]], 'options carry numeric bus ids');
  assert.deepEqual(App.option(), { ...opts[1] });
  const st = App.state;
  assert.equal(st.optionId, 'o2'); assert.deepEqual(st.pins, [C], 'pins as numbers'); assert.equal(st.projects.length, 1);
  const c = App.ctx();
  assert.deepEqual([c.fuel, c.size, c.case, c.caseObj.key, c.direction], ['solar', 100, 'sp', 'sp', 'injection']);
  const w = App.weightsFor('solar');
  assert.ok(Object.keys(w).some(k => !k.startsWith('$') && w[k] > 0), 'Market weights'); assert.ok('$scope' in w, 'scope token for the module\'s rebuild key');
});

test('GS members exist with the live arity and shapes (04a §1)', () => {
  const { br } = mk(), { GS } = br;
  const fns = { node: 1, headroom: 3, primaryHeadroom: 3, preIssues: 3, shortCircuitMVA: 1, curt: 3, candidates: 0, score: 1, gates: 3, caseOf: 1, priceAt: 2, priceColumn: 1 };
  for (const [k, n] of Object.entries(fns)) { assert.equal(typeof GS[k], 'function', `GS.${k}`); assert.ok(GS[k].length >= n, `GS.${k} takes ${n}+ arguments`); }
  for (const k of ['int', 'num', 'mw', 'lmp']) assert.equal(typeof GS.fmt[k], 'function', `GS.fmt.${k}`);
  assert.equal(GS.nodes.length, 3); assert.equal(GS.node(B).bus_id, B); assert.equal(GS.node(String(B)).bus_id, B, 'string id accepted');
  assert.equal(typeof GS.nodes[0].bus_id, 'number', 'bus ids are numbers for the module');
  assert.ok(GS.stations.every(s => Array.isArray(s) && s.every(n => n.bus_id)), 'stations are lists of nodes');
  assert.deepEqual(Object.keys(GS.FUELS).sort(), [...LIVE_FUELS].sort());
  for (const f of LIVE_FUELS) for (const k of ['label', 'direction', 'curtLabel']) assert.ok(GS.FUELS[f][k], `FUELS.${f}.${k}`);
  assert.deepEqual(GS.SIZES, [100, 250, 500, 1000]);
  assert.equal(GS.caseOf('sh').key, 'sh'); assert.equal(GS.caseOf('zz').key, 'sp');
  const cand = GS.candidates({ fuel: 'solar', size: 100, case: 'sp', gate: false });
  assert.equal(cand.rows.length, 3, 'every bus is a grid row'); assert.ok(cand.rows.every(r => r.n && 'curt' in r && 'cap' in r));
  const sc = GS.score('solar', br.App.weightsFor('solar'), { gate: false, size: 100, case: 'sp' });
  assert.ok(Array.isArray(sc.rows) && sc.rows.every(r => r.n && typeof r.score === 'number'));
  const g = GS.gates('solar', GS.node(B), 100, 'sp');
  assert.ok(Number.isInteger(g.clear) && Number.isInteger(g.total) && Array.isArray(g.gates) && g.gates.every(x => x.label && x.value));
  assert.ok(Array.isArray(GS.D.queue) && Array.isArray(GS.D.iso.top_facilities));
  assert.ok(Array.isArray(GS.priceAnomalies.list) && Array.isArray(GS.priceAnomaliesNeighbour.list));
  assert.equal(GS.priceColumn(2030).length, 3);
});

test('GS_DATA_EXT carries every field 31/32 read (04a §1)', () => {
  const { EXT } = mk().br;
  assert.equal(EXT.meta.coverage.network_branches, 2);
  assert.deepEqual(EXT.network.branches, groups.branches.branches);
  assert.equal(EXT.zones.length, 2); assert.equal(EXT.zone_fix[C], 'SEMA');
  for (const k of ['loading', 'cost', 'storage_headroom', 'decomp', 'load_pays', 'forecast_delta', 'exclusions', 'cathy', 'run_input_flags']) assert.ok(EXT[k] && typeof EXT[k] === 'object', `EXT.${k}`);
  assert.equal(EXT.land_cost_proxy, null, 'land cost: not in the unified DB, so the column is not registered');
  assert.ok(EXT.cathy.bus_annual && EXT.cathy.meta && EXT.cathy.bus_full);
});

// ---------- id / fuel mapping ----------
test('fuel keys map both ways (bess↔storage, dc↔datacenter)', () => {
  for (const t of ['solar', 'wind', 'storage', 'datacenter', 'hybrid']) assert.equal(fuelFromLive(fuelToLive(t)), t);
  assert.equal(fuelToLive('storage'), 'bess'); assert.equal(fuelToLive('datacenter'), 'dc');
  const { br } = mk({ tech: 'datacenter', exportMW: 0, importMW: 250 });
  assert.deepEqual([br.App.ctx().fuel, br.App.ctx().size, br.App.ctx().direction], ['dc', 250, 'withdrawal']);
  assert.equal(mk({ tech: 'storage', exportMW: 100, importMW: 100 }).br.App.ctx().direction, 'injection', 'both → injection (live ctx L904)');
});

// ---------- selection rule (snapshot ext/30 selectBus L608-619; five pins, oldest drops: brief) ----------
const ui = id => ['ui', { kind: 'bus', id: String(id) }, { dataset: { k: 'inspect' } }];
test('selection rule table', () => {
  const S0 = { nodeId: String(B), pins: ['111403'], walk: { project: 'kennebec', option: 'o2' } };
  // an option bus switches the option
  let p = selectionPlan({ S: S0, project, id: A, node: { name: 'Chester', kv: 345 } });
  assert.deepEqual(p.actions, [['sel-opt', 'o1'], ui(A)]); assert.match(p.toast, /option on Kennebec solar/);
  // the current option's bus: nothing but the inspector
  p = selectionPlan({ S: S0, project, id: B, node: { name: 'Hatchville', kv: 115 } });
  assert.deepEqual(p.actions, [ui(B)]);
  // the option's bus while another bus is previewed: back to it
  p = selectionPlan({ S: { ...S0, nodeId: '999' }, project, id: B, node: { name: 'Hatchville', kv: 115 } });
  assert.deepEqual(p.actions, [['node', String(B)], ui(B)]);
  // any other bus becomes S.nodeId and is pinned
  p = selectionPlan({ S: { ...S0, pins: [] }, project, id: 120000, node: { name: 'Elsewhere', kv: 115 } });
  assert.deepEqual(p.actions, [['node', '120000'], ['pin', '120000'], ui(120000)]); assert.match(p.toast, /pinned \(1 of 5\).*add it as an option/i);
  // already pinned
  p = selectionPlan({ S: S0, project, id: C, node: { name: 'Mashpee', kv: 115 } });
  assert.deepEqual(p.actions, [['node', String(C)], ui(C)]); assert.match(p.toast, /already pinned/);
  // the sixth pin drops the oldest
  const five = ['1', '2', '3', '4', '5'];
  p = selectionPlan({ S: { ...S0, pins: five }, project, id: 120000, node: { name: 'Elsewhere', kv: 115 } });
  assert.deepEqual(p.actions, [['node', '120000'], ['pin', '1'], ['pin', '120000'], ui(120000)]); assert.match(p.toast, /oldest pin/i);
  // no project: never an option
  p = selectionPlan({ S: { ...S0, walk: null }, project: null, id: A, node: { name: 'Chester', kv: 345 } });
  assert.deepEqual(p.actions[0], ['node', String(A)]);
  // unknown bus: nothing, and says so
  p = selectionPlan({ S: S0, project, id: 1, node: null });
  assert.deepEqual(p.actions, []); assert.match(p.toast, /not in this dataset/);
  assert.deepEqual(pinsAfterSelect(five, '9'), { pins: ['2', '3', '4', '5', '9'], dropped: '1', added: true });
  assert.deepEqual(pinsAfterSelect(['3'], '3'), { pins: ['3'], dropped: null, added: false });
});

test('App.setOption / GSFrame-style selectBus dispatch one batch (one render, never a hash write)', () => {
  const { br, calls, toasts } = mk();
  br.App.setOption('o1');
  assert.deepEqual(calls.at(-1), [['sel-opt', 'o1']]);
  calls.length = 0;
  br.selectBus(120000);
  assert.equal(calls.length, 0, 'unknown bus: no dispatch'); assert.match(toasts.at(-1), /not in this dataset/);
  br.selectBus(A);
  assert.deepEqual(calls.at(-1), [['sel-opt', 'o1'], ui(A)]);
  const src = readFileSync(path.join(APP, 'live-bridge.js'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /location\.hash\s*=|history\.(push|replace)State/, 'the bridge never writes the URL');
});

// ---------- null encodings ----------
test('null encodings print "not held"; a true zero is a zero; a lower bound is "≥"', () => {
  const f = makeFmt();
  for (const k of ['int', 'num', 'mw', 'lmp']) { assert.equal(f[k](null), 'not held', k); assert.equal(f[k](undefined), 'not held', k); assert.equal(f[k](NaN), 'not held', k); }
  assert.equal(f.num(0, 2), '0.00'); assert.equal(f.int(0), '0'); assert.equal(f.mw(0), '0.0 MW'); assert.equal(f.lmp(0), '$0.00/MWh');
  assert.equal(f.num(-0.0001, 2), '0.00', 'never -0');
  const lb = Object.assign(new Number(4.5), { lowerBound: true });
  assert.equal(f.num(lb, 2), '≥ 4.50');
  const { GS, EXT } = mk().br;
  assert.equal(GS.headroom(GS.node(C), 'sp', 'injection'), null, 'no headroom row → null, never 0');
  assert.equal(GS.primaryHeadroom(GS.node(C), 'solar', 'sp'), null);
  assert.equal(GS.node(C).hr_sp_dis, null);
  assert.equal(GS.node(B).lmp_2050, null); assert.equal(GS.node(B).tb4_2050, null);
  assert.equal(GS.node(B).bess_100MW_2030, null); assert.equal(GS.node(B).dc_250MW_2030, null);
  assert.equal(GS.node(B).basis_ME_2030, null); assert.equal(GS.node(B).top_shadow, null);
  assert.equal(EXT.exclusions[C], undefined, 'unscreened bus: no land record');
  for (const k of ['lmp_2050', 'tb4_2050', 'curt_bess', 'curt_dc', 'basis_zone', 'tb4_2035', 'land', 'land_cost', 'top_shadow', 'demo_syn', 'cape']) assert.ok(typeof WHY[k] === 'string' && WHY[k].length > 10, `reason for ${k}`);
});

// ---------- engine equality: each value is the engine's own call ----------
test('headroom, cost and storage headroom equal the gridrules calls', () => {
  const { GS, EXT, engine } = mk().br;
  const g = engine.study.gridOf(B);
  const gov = (tech, key) => caseTable(g, B, tech, 1, 1).find(r => r.key === key).governing;
  assert.equal(GS.headroom(GS.node(B), 'sp', 'injection'), gov('storage', 'summer_peak|discharge'));
  assert.equal(GS.node(B).hr_sp_dis, gov('storage', 'summer_peak|discharge'));
  assert.equal(GS.node(B).hr_sh_chg, gov('storage', 'shoulder|charge'));
  assert.equal(GS.primaryHeadroom(GS.node(B), 'solar', 'sp'), binding(caseTable(g, B, 'solar', 100, 0), 'export').value);
  assert.equal(EXT.storage_headroom[B].sh_chg, gov('storage', 'shoulder|charge'));
  // The card's rule (decisioncore.costText): True zero → $0, Priced → total, Lower bound / Partly priced → "≥ total",
  // No upgrades indicated (envelope only) → no figure.
  const expect = c => (c.status === 'True zero' ? 0 : ['Priced', 'Lower bound', 'Partly priced'].includes(c.status) ? c.total : null);
  for (const mw of [100, 250]) {
    const c = stepCostService(g, B, 'solar', mw, 0), got = EXT.cost[`${B}|summer_peak|injection|${mw}`];
    const v = got.total_musd == null ? null : +got.total_musd;
    assert.equal(v, expect(c), `${mw} MW (${c.status})`);
    if (['Lower bound', 'Partly priced'].includes(c.status)) { assert.equal(got.total_musd.lowerBound, true, 'printed ≥'); assert.equal(got.per_kw, null, 'no $/kW on a bound'); }
  }
  assert.equal(stepCostService(g, B, 'solar', 250, 0).status, 'Lower bound', 'fixture exercises the bound');
  assert.equal(makeFmt().num(EXT.cost[`${B}|summer_peak|injection|250`].total_musd, 2), '≥ 4.50');
  assert.equal(EXT.cost[`${C}|summer_peak|injection|100`].total_musd, null, 'no element list, no envelope: a bound with no evidence is not held');
});

test('GS.priceAt equals measures/all on the basis (settled y, solved f; partial, unpriced and 2045/2050 not held)', () => {
  const { GS } = mk().br, m = measures.buses;
  assert.deepEqual(priceAt(m[B], 2025), { value: 66.745, source: 'settled', run: null, year: 2025 });
  assert.equal(GS.priceAt(GS.node(B), 2025).value, m[B].y['2025']);
  assert.equal(GS.priceAt(GS.node(B), 2030).value, m[B].f.pcr2030); assert.equal(GS.priceAt(GS.node(B), 2030).source, 'solved');
  assert.equal(GS.priceAt(GS.node(B), 2035).value, m[B].f.pcr2035);
  assert.equal(GS.priceAt(GS.node(B), 2026), null, 'partial settled year');
  assert.equal(GS.priceAt(GS.node(C), 2030), null, 'unpriced run node');
  assert.equal(GS.priceAt(GS.node(B), 2050), null);
  assert.equal(GS.node(B).lmp_2025, m[B].y['2025']); assert.equal(GS.node(B).lmp_2030, m[B].f.pcr2030);
  assert.equal(GS.node(B).tb4_2030, m[B].tb4_30); assert.equal(GS.node(B).std_2025, m[B].std);
});

test('curtailment: the Market function for solar and wind; storage and data centre not modelled', () => {
  const { GS } = mk().br;
  assert.ok(Math.abs(GS.curt(GS.node(B), 'solar', 100) - 3) < 1e-9, 'Solar share within 25 km, in %');
  assert.equal(GS.curt(GS.node(B), 'bess', 100), null); assert.equal(GS.curt(GS.node(B), 'dc', 250), null);
  assert.equal(GS.curt(GS.node(A), 'wind', 100), 5);
});

test('gates: unknown inputs are Open, never Pass; the current bus uses Decision\'s own gates', () => {
  const { GS } = mk().br;
  const g = GS.gates('solar', GS.node(C), 100, 'sp');
  const open = g.gates.filter(x => /^Open/.test(x.value));
  assert.ok(open.length >= 3, 'revenue, capture, queue, land: Open'); assert.ok(g.clear <= g.total - open.length);
  assert.ok(!g.gates.find(x => x.label === 'Connect').value.startsWith('Pass'), 'no grid evidence → Connect never Pass');
  const h = makeHost(); h.host.candidateGates = () => [{ gate: 'Connect', verdict: 'Pass', why: 'x' }, { gate: 'Land fit', verdict: 'Fail', why: 'y' }];
  const br2 = createBridge(sources, h.host);
  const cur = br2.GS.gates('solar', br2.GS.node(B), 100, 'sp');
  assert.deepEqual([cur.clear, cur.total], [1, 2], 'current bus = candidateGates');
});

test('queue nearby: requests of unknown size are dropped and counted (D-007)', () => {
  assert.deepEqual(queueKnown(groups.queue.points).unknown, 1);
  const { GS } = mk().br;
  assert.equal(GS.D.queue.length, 1); assert.equal(GS.D.queueUnknown, 1);
});

// ---------- ownership: no card reads a display-only field ----------
test('no views/*.js card reads a display-only (api_mapgrid) field', () => {
  // Read paths, not prose: the mapgrid API (any spelling of the route or the xd/dx loaders' module name), the page
  // globals the bridge publishes, and the display-only GS readers. (market.js mentions GS_DATA_EXT.cathy and zone_fix
  // as provenance text for its Studio copy, data/market-studio.json; that is not a read of api_mapgrid.)
  const RX = /api\/x\/mapgrid|['"]mapgrid['"]|window\.(GS_DATA_EXT|GS|GSMapGrid)\b|\bGSMapGrid\.|\bGS\.(stations|preIssues|shortCircuitMVA|D)\b/;
  const hits = [];
  for (const f of readdirSync(path.join(APP, 'views')).filter(f => f.endsWith('.js'))) {
    readFileSync(path.join(APP, 'views', f), 'utf8').split('\n').forEach((l, i) => { if (RX.test(l)) hits.push(`views/${f}:${i + 1}`); });
  }
  assert.deepEqual(hits, []);
});

test('solar capture 2030 = Prices capYears (clear-sky over the bus payload pcr2030) when loaded, else not held', async () => {
  const { captureOf, heldRows } = await import('../views/prices-calc.js');
  const { clearSky } = await import('../solar.js');
  const recs = Array.from({ length: 48 }, (_, h) => [`2030-06-${String(1 + Math.floor(h / 24)).padStart(2, '0')}T${String(h % 24).padStart(2, '0')}:00:00`, 20 + (h % 24), null, null, null, null]);
  const series = { nodeId: String(B), mode: 'forecast', run: 'pcr2030', market: 'model', year: 2030, records: recs };
  const h = makeHost(); h.host.getData = () => ({ nodes: [{ id: String(B), latitude: 41.62, longitude: -70.55 }], series: [series], grid: { headroom: [], constraints: [] } });
  const br = createBridge(sources, h.host);
  const want = captureOf(heldRows(series), r => clearSky(r.timestamp, 41.62, -70.55)).ratio;
  assert.ok(Number.isFinite(want)); assert.equal(br.GS.node(B).solar_cap_2030, want);
  assert.equal(br.GS.node(A).solar_cap_2030, null, 'payload not loaded: not held');
});
