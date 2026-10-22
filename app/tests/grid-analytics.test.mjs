// Grid dashboard v3 analytics (added 2026-09-29): facility parsing, size sweep, cost-to-unlock steps, $/kW,
// short-circuit metrics, loading bars, type/voltage summary, severity bins, study curtailment at size and the
// delivered-value index. Written before the implementation (red → green).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFacility, sizeSweep, unlockSteps, perKw, scMetrics, loadingBars, typeVoltageSummary, severityBins, studyAtSize, deliveredValue, offeredMwh, copyNote, stepCostService, elementLimit } from '../gridrules.js';

const grid = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url))).grid;
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) <= e, `${a} vs ${b}`);

test('parseFacility reads the PSS/E fixed-width label, either end first, names with digits and spaces', () => {
  const p = parseFacility('111407 FAL TAP 136   115  111209 HATCHVILLE    115  1  ');
  assert.deepEqual([p.a, p.aName, p.kv, p.b, p.bName, p.ckt, p.key], [111407, 'FAL TAP 136', 115, 111209, 'HATCHVILLE', '1', '111209-111407-1']);
  assert.equal(parseFacility('111209 HATCHVILLE    115  111407 FAL TAP 136   115  1').key, '111209-111407-1');
  assert.equal(parseFacility('DNEAST Export'), null);
  assert.equal(parseFacility(null), null);
});

test('perKw: $M ÷ MW → $/kW; not held stays null, never 0', () => {
  near(perKw(2.94, 200), 14.7);
  assert.equal(perKw(null, 200), null);
  assert.equal(perKw(2.94, 0), null);
});

test('scMetrics: ratio at request, size at a ratio of 3, fault current; suspect current above 63 kA is suppressed', () => {
  const m = scMetrics(2520.1, 115, 100);
  near(m.scr, 25.201); near(m.mwAtRatio3, 840.0333333333333, 1e-9); near(m.kA, 2520.1 / (Math.sqrt(3) * 115), 1e-12);
  assert.equal(scMetrics(20000, 115, 100).kA, null);
  assert.equal(scMetrics(20000, 115, 100).kASuspect, true);
  assert.equal(scMetrics(null, 115, 100).scr, null);
  assert.equal(scMetrics(2520.1, 115, 0).scr, null);
});

test('sizeSweep (solar at Mashpee): statuses and costs follow stepCostService at every size', () => {
  const sw = sizeSweep(grid, 111403, 'solar', [100, 200, 270, 300]);
  const at = s => sw.find(r => r.size === s);
  assert.equal(at(100).cost.status, 'No upgrades indicated'); // shoulder is envelope-only: never a true zero
  // S2-GD (D6.1 / F009): was `fits === true`, which counted the envelope-only shoulder case as a fit. Not established now.
  assert.equal(at(100).fits, null); assert.ok(at(100).statuses.includes('Envelope only'));
  assert.equal(at(200).cost.status, 'Lower bound'); near(at(200).cost.total, 2.94, 1e-9); // P2 C10: shoulder envelope-only (was 'Priced') assert.equal(at(200).fits, false);
  assert.equal(at(270).cost.status, 'Lower bound'); near(at(270).cost.total, 2.94 + 5.22, 1e-9);
  for (const r of sw) { const c = stepCostService(grid, 111403, 'solar', r.size, 0); assert.equal(r.cost.status, c.status); assert.equal(r.cost.total, c.total); }
  assert.equal(at(200).perKw, null); // P2 C10: a lower bound gets no $/kW (was 14.7, the defect)
  assert.equal(at(270).perKw, null); // only complete totals get a $/kW
});

test('sizeSweep (data centre) costs the import cases at the size', () => {
  const sw = sizeSweep(grid, 111403, 'datacenter', [50]);
  const c = stepCostService(grid, 111403, 'datacenter', 0, 50);
  assert.equal(sw[0].cost.status, c.status); assert.equal(sw[0].cost.total, c.total);
});

test('unlockSteps: one step per distinct facility limit, cumulative total = the cost engine just above each limit', () => {
  const u = unlockSteps(grid, 111403, 'solar');
  assert.deepEqual(u.steps.map(s => s.mw), [152.8, 263.2, 286.7]);
  near(u.steps[0].cum, 2.94, 1e-9); assert.equal(u.steps[0].status, 'Lower bound'); // P2 C10 (was 'Priced')
  near(u.steps[1].cum, 8.16, 1e-9); assert.equal(u.steps[1].status, 'Lower bound');
  near(u.steps[2].cum, 9.83, 1e-9);
  assert.equal(u.start.status, 'No upgrades indicated');
  for (const s of u.steps) assert.ok(typeof s.facility === 'string' && s.facility.length > 3);
});

test('loadingBars: before = |flow| ÷ rating on the row basis; at request adds sensitivity × MW; pre-existing flagged', () => {
  const el = elementLimit(grid, 111403, 'summer_peak|discharge');
  const bars = loadingBars(el, 100);
  const r = bars.find(b => /MASHPEE_136/.test(b.facility));
  near(r.before, 100 * 192.7 / 243, 1e-9);
  near(r.after, 100 * Math.abs(192.7 + 0.32934 * 100) / 243, 1e-9);
  assert.equal(r.pre, false);
  assert.equal(loadingBars({ status: 'none', rows: [], pre: [] }, 100).length, 0);
});

test('typeVoltageSummary groups by facility type and kV with counts, pre-existing, lowest limit and priced cost', () => {
  const rows = [
    { facility_type: 'Transmission Line', kv: 115, transfer_mw: 100, pct_loading_no_transfer: 50, fix_cost_musd: 2, length_miles: 3 },
    { facility_type: 'Transmission Line', kv: 115, transfer_mw: -5, pct_loading_no_transfer: 120, fix_cost_musd: 1, length_miles: 1 },
    { facility_type: 'Transformer', kv: 345, transfer_mw: 300, pct_loading_no_transfer: 40, fix_cost_musd: 0, length_miles: 0 },
  ];
  const s = typeVoltageSummary(rows);
  const line = s.find(x => x.type === 'Transmission Line' && x.kv === 115);
  assert.deepEqual([line.n, line.pre, line.minTransfer, line.priced, line.costTotal], [2, 1, 100, 2, 3]);
  const xf = s.find(x => x.type === 'Transformer');
  assert.deepEqual([xf.n, xf.priced, xf.costTotal], [1, 0, null]); // $0 on a zero-length facility is not held
});

test('severityBins counts |loading before| per band; not-held loadings are counted apart', () => {
  const b = severityBins([10, 55, 75, 85, 95, 105, -120, null]);
  assert.deepEqual(b.map(x => x.n), [1, 1, 1, 1, 1, 2]);
  assert.equal(b.notHeld, 1);
});

test('studyAtSize: exact tested size, else the nearest tested sizes around it; never interpolated', () => {
  const study = [{ mw: 100, tested: false }, { mw: 250, tested: true, pct: 14.88 }, { mw: 500, tested: true, pct: 43.38 }];
  assert.equal(studyAtSize(study, 250).exact.pct, 14.88);
  const s = studyAtSize(study, 300);
  assert.equal(s.exact, null); assert.equal(s.below.mw, 250); assert.equal(s.above.mw, 500);
  assert.equal(studyAtSize(study, 100).exact, null); // untested, not zero
  assert.equal(studyAtSize(null, 100), null);
});

test('deliveredValue and offeredMwh from the study row', () => {
  const r = { mw: 500, tested: true, pct: 43.3768707, mwh: 102878.3582, avg_lmp: 39.22164 };
  near(offeredMwh(r), 102878.3582 / 0.433768707, 1e-6);
  near(deliveredValue(r), (1 - 0.433768707) * 39.22164, 1e-9);
  assert.equal(offeredMwh({ ...r, pct: 0 }), null);
  assert.equal(deliveredValue({ ...r, avg_lmp: null }), null);
  assert.equal(deliveredValue({ mw: 100, tested: false }), null);
});

test('copyNote: equal within tolerance is "same"; a difference names both values; missing side is "not held"', () => {
  assert.equal(copyNote(152.8, 152.8).kind, 'same');
  const d = copyNote(152.8, 166.4);
  assert.equal(d.kind, 'differs'); near(d.diff, -13.6, 1e-9);
  assert.equal(copyNote(152.8, null).kind, 'older not held');
  assert.equal(copyNote(null, 10).kind, 'unified not held');
});
