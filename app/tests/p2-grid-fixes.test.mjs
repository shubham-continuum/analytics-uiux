// P2 grid fixes (C03, C04, C10, C11, C13, C34, C39, C42, C72, map-tip escaping, lower-bound "≥ $0.0M"): engine rules
// pinned on the unified DB's own rows for the buses the findings name. The DB is read once, read-only, with bound
// parameters (busdata.rows), exactly the columns the engine reads.
// Provenance: Claude Opus 5.5 (P2 grid fix agent) · one-studio/design (P2 wave, grid group) · 2026-10-10 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as G from '../gridrules.js';
import { netMapModel, substationTip, busTip } from '../views/grid-netmap.js';
import { dropGeneratorOnly } from '../views/grid-dc.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IDS = [111348, 100179, 110815, 103029, 110762, 103005, 111403, 111209];
const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(APP)})
import busdata
ids = json.loads(sys.argv[1])
c = busdata.connect()
q = 'IN (SELECT unnest(?::BIGINT[]))'
print(json.dumps({
 'headroom': busdata.rows(c, 'SELECT bus_id, scenario, direction, headroom_mw, pre_existing_issues FROM fact_headroom WHERE bus_id ' + q, [ids]),
 'constraints': busdata.rows(c, 'SELECT bus_id, scenario, direction, monitored_facility, binding_contingency, contingency_id, dfax, transfer_mw, base_flow_mw, contingency_flow_mw, rating_a_mva, rating_c_mva, pct_loading_no_transfer, fix_cost_musd, length_miles, facility_type, kv FROM fact_limiting_element WHERE bus_id ' + q, [ids]),
}, default=str))
`;
const r = spawnSync('python', ['-c', PY, JSON.stringify(IDS)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const grid = r.status === 0 ? JSON.parse(r.stdout) : null;
const skip = grid ? false : `unified DB not readable: ${(r.stderr || '').slice(-300)}`;
const SNAP = JSON.parse(readFileSync(path.join(APP, 'data', 'snapshot.json'), 'utf8')).grid;

// ---------- C03: one row behind value, status, case and set ----------
test('C03: 111348 solar 100 MW binds on the summer-peak element row (93.1 MW, Does not fit), never the 55.7 MW shoulder envelope', { skip }, () => {
  const b = G.binding(G.caseTable(grid, 111348, 'solar', 100, 0), 'export');
  assert.equal(b.status, 'Does not fit');
  assert.equal(b.value, 93.1);
  assert.equal(b.key, 'summer_peak|discharge');
  assert.equal(b.case, 'Summer peak · export');
  assert.equal(b.rowStatus, 'Does not fit', 'value and verdict carry one case label');
  assert.equal(b.set, 'element');
  assert.equal(b.capMW, 93.1);
  assert.deepEqual(b.envelopeBelow, ['Shoulder · export'], 'the low envelope stays visible as context');
  const sh = b.cases.find(c => c.key === 'shoulder|discharge');
  assert.equal(sh.status, G.ENVELOPE_ONLY); assert.equal(sh.value, 55.7); assert.equal(sh.set, 'envelope');
});

test('C03: 100179 solar 200 MW binds on summer peak 199.6 MW (Does not fit), not the 131.3 MW shoulder envelope', () => {
  const b = G.binding(G.caseTable(SNAP, 100179, 'solar', 200, 0), 'export');
  assert.equal(b.value, 199.6);
  assert.equal(b.status, 'Does not fit');
  assert.equal(b.rowStatus, 'Does not fit');
  assert.equal(b.case, 'Summer peak · export');
  assert.match(G.bindingText(b), /^199\.6 MW \(Summer peak · export, Interconnection element study \(2026-05 set\)\): does not fit · other cases: Shoulder · export: envelope only/);
});

test('C03: whenever the verdict is Fits or Does not fit, the number comes from a row with that same status', { skip }, () => {
  const all = { headroom: [...grid.headroom, ...SNAP.headroom], constraints: [...grid.constraints, ...SNAP.constraints] };
  const buses = [...new Set(all.headroom.map(h => h.bus_id))];
  let n = 0;
  for (const bus of buses) for (const tech of ['solar', 'storage', 'hybrid', 'datacenter']) for (const mw of [25, 60, 100, 150, 200, 300, 600]) {
    const t = G.caseTable(all, bus, tech, tech === 'datacenter' ? 0 : mw, tech === 'solar' ? 0 : mw);
    for (const dir of ['export', 'import']) {
      const b = G.binding(t, dir);
      if (b.status === 'Fits' || b.status === 'Does not fit') { n++; assert.equal(b.rowStatus, b.status, `${bus} ${tech} ${mw} ${dir}`); assert.equal(b.set, 'element'); assert.equal(b.capMW, b.value); }
    }
  }
  assert.ok(n > 20);
});

test('C03: an envelope-only binding value is context, never a cap (capMW null)', () => {
  const b = G.binding(G.caseTable(SNAP, '100179', 'solar', 150, 0), 'export');
  assert.equal(b.status, G.ENVELOPE_ONLY);
  assert.equal(b.valueBasis, 'envelope');
  assert.equal(b.rowStatus, G.ENVELOPE_ONLY);
  assert.equal(b.capMW, null);
});

// ---------- C04: the set is named on every figure ----------
test('C04: studyBasis "Vintage" and the source line name both sets; the bare 2026-05 vintage is never the envelope\'s', () => {
  const v = G.studyBasis(SNAP, 111403).find(r => r.label === 'Vintage');
  assert.match(v.value, /Interconnection element study \(2026-05 set\)/);
  assert.match(v.value, /headline set, vintage unconfirmed \(D-007\)/);
  assert.notEqual(v.value, G.STUDY_VINTAGE);
  assert.match(G.sourceLabel(SNAP), /element rows: Interconnection element study \(2026-05 set\); envelope: ISO-NE GridSense data, headline set/);
  const env = G.caseTable(SNAP, 111209, 'solar', 100, 0).find(r => r.evidence === 'envelope');
  assert.match(env.basis, /^Envelope only \(headline set/);
  assert.doesNotMatch(env.basis, /not reproducible|2026-05/);
  assert.match(G.studyStaleness().text, /^Study case 2026-05/, 'the staleness line is about the element study solved case, so its vintage is the element set');
});

// ---------- C10 + "≥ $0.0M": cost status and not-held totals ----------
test('C10: 110815 storage with facilities priced but both shoulder cases envelope-only is a lower bound, never "Priced"; no $/kW', { skip }, () => {
  const c = G.stepCostService(grid, 110815, 'storage', 150, 150);
  assert.equal(c.status, 'Lower bound');
  assert.equal(c.total, 556.22);
  assert.deepEqual(c.unverified.map(u => u.label).sort(), ['Shoulder · charge', 'Shoulder · export']);
  assert.match(G.costDisplay(c), /^≥ \$556\.22M/);
  const sw = G.sizeSweep(grid, 110815, 'storage', [150]);
  assert.equal(sw[0].perKw, null);
});

test('C10: Mashpee / Hatchville solar at 200 MW with shoulder export envelope-only read lower bound, not Priced', () => {
  for (const bus of [111403, 111209]) assert.equal(G.stepCostService(SNAP, bus, 'solar', 200, 0).status, 'Lower bound', String(bus));
});

test('C10: a gap whose envelope is held but below the request says so (103029 shoulder charge 57.3 MW)', { skip }, () => {
  const c = G.stepCostService(grid, 103029, 'storage', 100, 100);
  const g = c.gaps.find(x => x.key === 'shoulder|charge');
  assert.ok(g);
  assert.doesNotMatch(g.reason, /no envelope/);
  assert.match(g.reason, /envelope \(57 MW\) is below the request/);
});

test('"≥ $0.0M": a lower bound with nothing priced has total null and displays "not held: <case> may bind"', { skip }, () => {
  const c = G.stepCostService(grid, 103029, 'storage', 100, 100);
  assert.equal(c.status, 'Lower bound');
  assert.equal(c.items.length, 0);
  assert.equal(c.total, null, 'never a bound of $0 with no evidence');
  assert.equal(c.known, 0);
  assert.match(G.costDisplay(c), /^not held: Shoulder · charge may bind/);
  assert.doesNotMatch(G.costDisplay(c), /\$0/);
});

test('costDisplay: one rule for every status', () => {
  assert.equal(G.costDisplay({ status: 'Not requested' }), '—');
  assert.equal(G.costDisplay({ status: 'No upgrades indicated', total: 0 }), 'none indicated (unverified)');
  assert.equal(G.costDisplay({ status: 'True zero', total: 0 }), '$0.00M');
  assert.equal(G.costDisplay({ status: 'Priced', total: 2.94 }), '$2.94M');
  assert.equal(G.costDisplay({ status: 'Partly priced', total: null, items: [{}] }), 'not held: no facility priced');
});

// ---------- C11: facility identity ----------
test('C11: 3-winding legs map to the star point; reversed ends are one facility', () => {
  const t = 'Transformer 3-Windings';
  assert.equal(G.facilityKey('999997 ORRINGTON T1  115  100002 ORRINGTON     345  1  ', t), G.facilityKey('103027 ORRINGTON     115  999997 ORRINGTON T1  115  1  ', t));
  assert.notEqual(G.facilityKey('999997 ORRINGTON T1  115  100002 ORRINGTON     345  1  ', t), G.facilityKey('999996 ORRINGTON T2  115  100002 ORRINGTON     345  2  ', t));
  assert.equal(G.facilityKey('110820 MYSTIC GIS    115  110799 WOBURN        115  1  '), G.facilityKey('110799 WOBURN        115  110820 MYSTIC GIS    115  1  '));
});

test('C11: Powersville (103029) costs the ORRINGTON T1 once, at its highest leg', { skip }, () => {
  const c = G.stepCostAll(grid, 103029, 'solar', 260, 'export');
  const t1 = c.items.filter(i => /ORRINGTON T1/.test(i.label));
  assert.equal(t1.length, 1);
  assert.equal(t1[0].cost, 10.16);
});

test('C11: Mystic (110762) data centre counts MYSTIC GIS – WOBURN once across its reversed ends', { skip }, () => {
  const rows = grid.constraints.filter(x => x.bus_id === 110762 && x.scenario !== 'shoulder');
  const tv = G.typeVoltageSummary(rows);
  const distinct = new Set(rows.filter(x => !/violations/i.test(x.monitored_facility)).map(x => G.facilityKey(x.monitored_facility, x.facility_type))).size;
  assert.equal(tv.reduce((a, x) => a + x.facilities, 0), distinct);
});

test('C11: BHE (103005) data-centre cost steps sum to the running total; an already-counted facility steps $0', { skip }, () => {
  const u = G.unlockSteps(grid, 103005, 'datacenter');
  const at626 = u.steps.find(s => s.mw === 626.4);
  assert.equal(at626.cost, 0); assert.equal(at626.counted, true);
  const last = u.steps.at(-1);
  const sum = u.steps.reduce((a, s) => a + (s.cost ?? 0), 0) + (Number.isFinite(u.start.total) ? u.start.total : 0);
  assert.ok(Math.abs(sum - last.cum) < 1e-9, `${sum} vs ${last.cum}`);
});

test('C11: stored transfer_mw that differs from (rating − flow) ÷ DFAX by more than 5% is flagged (103005)', { skip }, () => {
  const flagged = grid.constraints.filter(x => x.bus_id === 103005).map(x => ({ x, c: G.transferCheck(x) })).filter(o => o.c.differs);
  const stored = flagged.map(o => o.x.transfer_mw).sort((a, b) => a - b);
  assert.deepEqual(stored, [626.4, 1188.3, 1396.6]);
  const r1396 = flagged.find(o => o.x.transfer_mw === 1396.6).c;
  assert.equal(Math.round(r1396.recomputed * 10) / 10, 1737.1);
});

// ---------- C13: hybrid battery = importMW ----------
test('C13: hybrid charge is the battery rating (importMW) in fit and cost alike', () => {
  assert.equal(G.chargeMW('hybrid', 150, 75), 75);
  assert.equal(G.chargeMW('hybrid', 150, 0), 0);
  assert.equal(G.chargeMW('storage', 100, 80), 100);
  assert.equal(G.chargeMW('solar', 100, 50), 0);
  const svc = G.stepCostService(SNAP, 111403, 'hybrid', 150, 75), im75 = G.stepCostAll(SNAP, 111403, 'hybrid', 75, 'import');
  assert.ok(!svc.gaps.some(g => g.key === 'shoulder|charge') || im75.gaps.some(g => g.key === 'shoulder|charge'), 'charge costed at 75, not 150');
  assert.equal(svc.gaps.some(g => g.key === 'shoulder|charge'), im75.gaps.some(g => g.key === 'shoulder|charge'));
  const noBatt = G.stepCostService(SNAP, 111403, 'hybrid', 150, 0);
  assert.ok(!noBatt.gaps.some(g => g.key === 'shoulder|charge') && !noBatt.unverified.some(g => g.key === 'shoulder|charge'), 'no battery: no charge test');
  const sw = G.sizeSweep(SNAP, 111403, 'hybrid', [150], { importMW: 75 });
  assert.equal(sw[0].cost.status, svc.status);
});

// ---------- C34: data centre ----------
test('C34: a data centre\'s withdrawal case carries a load service tag (FCDS / NFCDS / ICDS), never NR/ERIS or a CNR bound', () => {
  const t = G.serviceTag('summer_peak|charge', 'datacenter');
  assert.notEqual(t.code, 'NR');
  assert.doesNotMatch(t.short + t.long, /ERIS|NR \(NCIS\)/);
  assert.match(t.long, /FCDS/);
  assert.equal(G.serviceTag('summer_peak|charge', 'storage').code, 'NR');
});

test('C34: generator-only content is dropped by data attribute (sections and rows), not only by title', () => {
  const html = '<section class="card c-4" data-gen-only="1"><header><h3>Neutral title</h3></header></section><section class="card c-4"><h3>Keep</h3><table><tr data-gen-only="1"><td>Export row</td></tr><tr><td>Import row</td></tr></table></section>';
  const out = dropGeneratorOnly(html);
  assert.doesNotMatch(out, /Neutral title|Export row/);
  assert.match(out, /Keep/); assert.match(out, /Import row/);
});

// ---------- C39: pre-existing counts on applicable cases ----------
test('C39: pre-existing envelope count is over the technology\'s own cases and names the case (BHE 103005)', { skip }, () => {
  const solar = G.preExistingCounts(grid, 103005, 'solar');
  assert.equal(solar.envelope, 3, 'not the 11 of shoulder charge, which a solar plant never uses');
  assert.equal(solar.envelopeCase, 'Shoulder · export');
  const st = G.preExistingCounts(grid, 103005, 'storage');
  assert.equal(st.envelope, 11); assert.equal(st.envelopeCase, 'Shoulder · charge');
  const dc = G.preExistingCounts(grid, 103005, 'datacenter');
  assert.equal(dc.envelope, 3);
  assert.equal(G.PRE_EXISTING_LABEL, 'Pre-existing overloads');
});

test('C39: the element count is not held when no applicable case has an element status held', () => {
  const g = { headroom: [{ bus_id: 1, scenario: 'summer_peak', direction: 'discharge', headroom_mw: 50, pre_existing_issues: 2 }], constraints: [] };
  const p = G.preExistingCounts(g, 1, 'solar');
  assert.equal(p.element, null); assert.equal(p.envelope, 2);
});

// ---------- C42 ----------
test('C42: the CNR bound states that a CCIS-named column exists and is not used', () => {
  assert.match(G.cnrBound(100).text, /CNR ≤ 100\.0 MW/); // text unchanged (grid-v5 pins it); the CCIS note prints beside it on Grid
  assert.match(G.CCIS_NOTE, /max_injection_ccis_mw/);
  assert.match(G.CCIS_NOTE, /not used/);
});

// ---------- C72 ----------
test('C72: the sweep answer gives the largest swept step and the exact limit apart', () => {
  const sw = G.sizeSweep(SNAP, 111403, 'datacenter', [25, 50]);
  const s = G.sweepSummary([{ size: 150, fits: true }, { size: 175, fits: true }, { size: 200, fits: false }], 197.8, 'Export limit');
  assert.equal(s.largestStep, 175); assert.equal(s.exact, 197.8);
  assert.match(s.text, /largest swept step that fits is 175 MW; exact limit 197\.8 MW \(Export limit\)/);
  assert.ok(Array.isArray(sw));
});

// ---------- map tips: DB names are text, not HTML ----------
test('map tips escape DB names (data-tip is HTML by contract)', () => {
  const evil = '<img src=x onerror=1> & Co';
  const m = netMapModel({ bus: { bus_id: 1, bus_name: evil, lon: -70, lat: 42 }, radius_mi: 15,
    rows: [{ key: '1-2-1', a: 1, b: 2, a_name: evil, b_name: 'B&B', ckt: '1', scenario: 'summer_peak', direction: 'discharge', monitored_facility: 'x', binding_contingency: evil, transfer_mw: 10, dfax: 0.1, pct_loading_no_transfer: 50, contingency_id: 0, base_flow_mw: 10, rating_a_mva: 100 }],
    facility_geo: { '1-2-1': { a: [-70, 42], b: [-70.1, 42.1] } },
    branches: [{ key: '3-4-1', a: [-70, 42], b: [-70.2, 42.2], name: evil, from_name: 'x', to_name: 'y', status: evil, kv: 115, rate_a: 100 }] }, { tech: 'solar' });
  for (const tip of [...m.fac.map(l => l.tip), ...m.net.map(l => l.tip)]) { assert.doesNotMatch(tip, /<img/); assert.match(tip, /&lt;img/); }
  assert.doesNotMatch(substationTip({ name: evil, kv: 115, sc_mva: 1000, mi: 2 }), /<img/);
  assert.match(substationTip({ name: 'Pratt & Whitney Middletown', kv: 115, sc_mva: 1000, mi: 2 }), /Pratt &amp; Whitney/);
  assert.doesNotMatch(busTip({ bus_name: evil, bus_id: 1, kv: 115 }), /<img/);
});
