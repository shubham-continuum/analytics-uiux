// Decision v4: per-fuel verdict (fuelVerdict) with editable thresholds, the capture gate (gate 6) on two bases,
// hybrid revenue including PV, wind on the fleet shape, and the load cost for a data centre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fuelVerdict, thresholdsFor, THRESHOLDS, FUEL_TESTS, fuelMetrics, captureRatio, fleetShapeFor, revenueFor, optionMetrics, gates,
  stressMetric, stressCell, openItems } from '../decisioncore.js';
import { analyzePrices } from '../prices.js';
import { clearSky, capture } from '../solar.js';
import { coreBasis } from '../basis.js';
import { stampHour } from '../economics.js';

const rd = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const data = { ...rd('snapshot.json'), queue: rd('queue.json'), land: rd('land.json'), flags: rd('flags.json') };
const basis = { mode: 'historical', market: 'RT', years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false };
const node = id => data.nodes.find(n => n.id === id);
const rowsOf = id => analyzePrices(data, coreBasis({ ...basis, nodeId: id })).rows;
const byTest = (list, t) => list.find(x => x.test === t);

// ---------- thresholds ----------
test('thresholds: visible defaults labelled as assumptions; a valid user entry overrides and is labelled; junk is ignored', () => {
  const t = thresholdsFor('solar');
  // S2-GD (F003): was a 90% 'assumption' default; capture now has no default until open decision #2 is agreed.
  assert.equal(t.capture.value, null); assert.equal(t.capture.source, 'not set'); assert.equal(t.capture.default, null);
  assert.equal(t.curtail.value, 2); assert.equal(t.curtail.source, 'assumption');
  const u = thresholdsFor('solar', { user: { capture: '85', curtail: 'abc' } });
  assert.equal(u.capture.value, 85); assert.equal(u.capture.source, 'user'); assert.equal(u.capture.default, null);
  assert.equal(u.curtail.value, 2, 'a non-number entry falls back to the default'); assert.equal(u.curtail.source, 'assumption');
  assert.equal(thresholdsFor('storage').tb4.value, 10);
  assert.equal(thresholdsFor('storage').oppLoss.value, 5);
  assert.ok(Object.values(THRESHOLDS).every(d => d.label && d.unit && d.note), 'every threshold says what it is and where the default comes from');
  assert.equal(t.curtail.default, 2, 'other defaults are unchanged');
});

test('data-centre price threshold is derived from the market (mean LMP 2030 over the buses holding it); not held without the population', () => {
  const pop = { ids: ['1', '2', '3'], values: { lmp_2030: [40, 50, null], std: [10, 30, 20], outlets: [2, 4, 3] }, measures: [] };
  const t = thresholdsFor('datacenter', { pop });
  assert.equal(t.dcPrice.value, 45); assert.equal(t.dcPrice.source, 'derived');
  assert.equal(thresholdsFor('datacenter').dcPrice.value, null);
  assert.equal(thresholdsFor('datacenter', { pop, user: { dcPrice: 42 } }).dcPrice.value, 42);
});

test('the tests follow the fuel: nothing solar for a load or a battery; hybrid carries both sides', () => {
  assert.deepEqual(FUEL_TESTS.solar, ['curtail', 'capture']);
  assert.deepEqual(FUEL_TESTS.wind, ['curtail', 'capture']);
  assert.deepEqual(FUEL_TESTS.storage, ['tb4', 'oppLoss']);
  assert.deepEqual(FUEL_TESTS.hybrid, ['curtail', 'capture', 'tb4']);
  assert.deepEqual(FUEL_TESTS.datacenter, ['dcPrice', 'dcVol', 'dcOutlets']);
  const v = fuelVerdict({}, 'datacenter', thresholdsFor('datacenter'));
  assert.ok(!v.some(x => /capture|curtail/i.test(x.test)));
  assert.ok(v.every(x => x.verdict === 'Hold'), 'nothing held → every test Holds, never Pass');
});

// ---------- verdict rules ----------
const cap = (cs, fl) => ({ capture: { clearSky: cs == null ? null : { ratio: cs }, fleet: fl == null ? null : { ratio: fl } } });
test('capture (gate 6): Pass only when both bases clear; Fail when both miss; Hold when they disagree or one is not held', () => {
  const t = thresholdsFor('solar', { user: { capture: 90 } }); // S2-GD: was the 90% default (F003); same mechanics at an entered 90%
  assert.equal(byTest(fuelVerdict(cap(0.95, 0.92), 'solar', t), 'capture').verdict, 'Pass');
  assert.equal(byTest(fuelVerdict(cap(0.85, 0.80), 'solar', t), 'capture').verdict, 'Fail');
  const mixed = byTest(fuelVerdict(cap(0.95, 0.85), 'solar', t), 'capture');
  assert.equal(mixed.verdict, 'Hold'); assert.match(mixed.why, /clear-sky/); assert.match(mixed.why, /fleet/); assert.match(mixed.why, /basis/i);
  assert.equal(byTest(fuelVerdict(cap(0.95, null), 'solar', t), 'capture').verdict, 'Hold');
  assert.equal(byTest(fuelVerdict(cap(0.80, null), 'solar', t), 'capture').verdict, 'Hold', 'one basis failing is not a known breach while the other is not held');
  const c = byTest(fuelVerdict(cap(0.85, 0.80), 'solar', t), 'capture');
  assert.equal(c.value, 80, 'value = the lower held basis, in %'); assert.equal(c.threshold, 90);
  assert.deepEqual(c.bases.map(b => b.basis), ['clear-sky', 'fleet']);
});

test('wind capture is judged on the fleet shape only (a flat shape is 100% by construction, clear-sky is solar)', () => {
  const t = thresholdsFor('wind', { user: { capture: 90 } }); // S2-GD: was the 90% default (F003)
  const w = byTest(fuelVerdict(cap(0.5, 0.95), 'wind', t), 'capture');
  assert.equal(w.verdict, 'Pass'); assert.deepEqual(w.bases.map(b => b.basis), ['fleet']);
  assert.equal(byTest(fuelVerdict(cap(null, null), 'wind', t), 'capture').verdict, 'Hold');
});

test('curtailment never passes: ISO curtailment is not held; POI clipping above the threshold on element evidence fails', () => {
  const t = thresholdsFor('solar');
  const low = byTest(fuelVerdict({ clip: { share: 0.004, evidence: 'element' } }, 'solar', t), 'curtail');
  assert.equal(low.verdict, 'Hold'); assert.match(low.why, /not held/); assert.ok(Math.abs(low.value - 0.4) < 1e-12);
  assert.equal(byTest(fuelVerdict({ clip: { share: 0.05, evidence: 'element' } }, 'solar', t), 'curtail').verdict, 'Fail');
  assert.equal(byTest(fuelVerdict({ clip: { share: 0.05, evidence: 'envelope' } }, 'solar', t), 'curtail').verdict, 'Hold', 'envelope-only is vendor-asserted');
  assert.equal(byTest(fuelVerdict({ clip: null }, 'solar', t), 'curtail').verdict, 'Hold');
});

test('storage: TB4 must exceed the threshold; opportunity loss from the grid limits, envelope-only never passes', () => {
  const t = thresholdsFor('storage');
  assert.equal(byTest(fuelVerdict({ tb4: { value: 12 } }, 'storage', t), 'tb4').verdict, 'Pass');
  assert.equal(byTest(fuelVerdict({ tb4: { value: 10 } }, 'storage', t), 'tb4').verdict, 'Fail', 'strictly above $10');
  assert.equal(byTest(fuelVerdict({ tb4: null }, 'storage', t), 'tb4').verdict, 'Hold');
  assert.equal(byTest(fuelVerdict({ oppLoss: { value: 0, evidence: 'element' } }, 'storage', t), 'oppLoss').verdict, 'Pass');
  assert.equal(byTest(fuelVerdict({ oppLoss: { value: 30, evidence: 'element' } }, 'storage', t), 'oppLoss').verdict, 'Fail');
  assert.equal(byTest(fuelVerdict({ oppLoss: { value: 0, evidence: 'envelope' } }, 'storage', t), 'oppLoss').verdict, 'Hold');
  assert.equal(byTest(fuelVerdict({ oppLoss: { value: 30, evidence: 'envelope' } }, 'storage', t), 'oppLoss').verdict, 'Hold');
});

test('data centre: price at or below the market mean, volatility below $25, three or more outlets', () => {
  const pop = { ids: ['1', '2'], values: { lmp_2030: [40, 60], std: [10, 30], outlets: [2, 4] }, measures: [] };
  const t = thresholdsFor('datacenter', { pop });
  const v = fuelVerdict({ dc: { lmp2030: 44, std: 30, outlets: 3 } }, 'datacenter', t);
  assert.equal(byTest(v, 'dcPrice').verdict, 'Pass');
  assert.equal(byTest(v, 'dcVol').verdict, 'Fail');
  assert.equal(byTest(v, 'dcOutlets').verdict, 'Pass');
  assert.equal(byTest(fuelVerdict({ dc: { lmp2030: 44, std: 30, outlets: 3 } }, 'datacenter', thresholdsFor('datacenter')), 'dcPrice').verdict, 'Hold', 'no market mean → Hold');
  assert.ok(v.every(x => 'test' in x && 'value' in x && 'threshold' in x && 'verdict' in x && 'why' in x));
});

// ---------- metrics on real data ----------
test('capture ratio: with no missing hours it equals the Prices clear-sky capture; missing weights count in the average only', () => {
  const n = node('111403'), rows = rowsOf('111403');
  const g = r => clearSky(r.timestamp, n.latitude, n.longitude);
  const a = captureRatio(rows, g), b = capture(rows, g);
  assert.ok(Math.abs(a.ratio - b.ratio) < 1e-12 && Math.abs(a.capture - b.capture) < 1e-9);
  const half = captureRatio(rows, (r, i) => (i % 2 ? null : 1));
  assert.ok(half.missingHours > 0 && Math.abs(half.avg - b.avg) < 1e-9, 'average price stays on every hour');
});

test('fleet shape: same clock hour, else the 2025 reference hour; solar night hours absent from the feed are zero; day gaps stay not held', () => {
  const recs = [{ timestamp: '2030-06-01T02:00:00' }, { timestamp: '2030-06-01T12:00:00' }, { timestamp: '2025-06-02T12:00:00-04:00' }, { timestamp: '2025-06-02T13:00:00-04:00' }];
  const prof = { solar: { '2025-06-01T12': 900, '2025-06-02T12': 1000 }, wind: {} };
  const f = fleetShapeFor(recs, prof, 'solar', r => /T02/.test(r.timestamp));
  assert.equal(f.shape[0], 0); assert.equal(f.nightZero, 1);
  assert.equal(f.shape[1], 900); assert.equal(f.usedRef, 1);
  assert.equal(f.shape[2], 1000); assert.equal(f.shape[3], null, 'a daylight gap at the end is not held'); assert.equal(f.unfilled, 1);
  assert.equal(fleetShapeFor(recs, {}, 'solar'), null);
});

test('fleet capture on a shape equal to clear-sky reproduces the clear-sky capture (consistency)', () => {
  const n = node('100178'), rows = rowsOf('100178');
  const prof = { solar: Object.fromEntries(rows.map(r => [stampHour(r.timestamp), clearSky(r.timestamp, n.latitude, n.longitude)])) };
  const m = fuelMetrics(data, n, basis, { tech: 'solar', exportMW: 100, cf: 0.15, lossPct: 3 }, { fleet: prof });
  assert.ok(Math.abs(m.capture.fleet.ratio - m.capture.clearSky.ratio) < 1e-9);
  assert.equal(m.capture.fleet.label.includes('fleet'), true);
});

test('fuel metrics: TB4 for storage equals the mart value; clipping share from the revenue method; Cape 5-yr not used', () => {
  const n = node('111403');
  const st = fuelMetrics(data, n, basis, { tech: 'storage', exportMW: 100, importMW: 100, cf: 0.15, lossPct: 3 }, { m: { exportLimit: 150, importLimit: 60, envelopeOnly: [] } });
  assert.ok(Math.abs(st.tb4.value - 62.708232876712344) < 1e-6);
  assert.ok(Math.abs(st.oppLoss.value - 40) < 1e-9, '1 − 60/100 of the power cannot be charged');
  assert.equal(st.oppLoss.evidence, 'element');
  const sol = fuelMetrics(data, node('100178'), basis, { tech: 'solar', exportMW: 100, cf: 0.15, lossPct: 3 }, { m: { exportLimit: 50, envelopeOnly: ['Shoulder · export'] } });
  // 50 MW: the CF-scaled clear-sky shape peaks at ~59.7 MW at 100178, so a 67.6 MW limit clips nothing.
  const rev = revenueFor(data, node('100178'), basis, 'solar', 100, { cf: 0.15, lossPct: 3, exportLimit: 50 });
  assert.ok(sol.clip.share > 0 && Math.abs(sol.clip.share - rev.spillMWh / rev.genMWh) < 1e-12);
  assert.equal(sol.clip.evidence, 'envelope');
  const b5 = { mode: 'forecast', market: 'model', run: '5yr', years: [2028], weighting: 'duration', weights: {}, strict: true, includePartial: true };
  const cape = fuelMetrics(data, n, b5, { tech: 'solar', exportMW: 100, cf: 0.15, lossPct: 3 }, {});
  assert.equal(cape.capture.clearSky, null); assert.match(cape.reason, /5-yr/);
});

test('hybrid revenue includes PV (the solar method at the export size), labelled PV energy only; never "n/a"', () => {
  const n = node('100178');
  const h = revenueFor(data, n, basis, 'hybrid', 100, { cf: 0.15, lossPct: 3, exportLimit: 67.6 });
  const s = revenueFor(data, n, basis, 'solar', 100, { cf: 0.15, lossPct: 3, exportLimit: 67.6 });
  assert.ok(h.value > 0 && Math.abs(h.value - s.value) < 1e-6);
  assert.equal(h.pvOnly, true); assert.match(h.note, /PV/);
  assert.equal(stressMetric('hybrid'), 'revenue');
  const c = stressCell(data, n, basis, { tech: 'hybrid', exportMW: 100, cf: 0.15, lossPct: 3 }, 67.6);
  assert.ok(c.value > 0 && c.tb4 > 0, 'hybrid stress carries the PV revenue and the TB4 spread');
});

test('wind revenue uses the fleet shape when it is held on every hour (Economics method), else a labelled flat proxy', () => {
  const n = node('111403'), rows = rowsOf('111403');
  const flat = revenueFor(data, n, basis, 'wind', 100, { cf: 0.325, lossPct: 3 });
  assert.equal(flat.shape, 'flat');
  const prof = { wind: Object.fromEntries(rows.map((r, i) => [stampHour(r.timestamp), 100 + (i % 24)])) };
  const fl = revenueFor(data, n, basis, 'wind', 100, { cf: 0.325, lossPct: 3, fleet: prof });
  assert.equal(fl.shape, 'fleet'); assert.ok(fl.value > 0 && fl.value !== flat.value);
});

test('data centre: flat-load energy cost = mean price × import MW × 8,760; no revenue figure', () => {
  const n = node('111403');
  const m = optionMetrics(data, n, { tech: 'datacenter', exportMW: 0, importMW: 100, basis, cf: 0.15, lossPct: 3 });
  assert.equal(m.revenue.value, null);
  assert.ok(Math.abs(m.loadCost.value - 66.70873401826483 * 100 * 8760) < 1e-3);
  const g = gates(m, { tech: 'datacenter' });
  assert.ok(g.some(x => x.gate === 'Load cost evidence') && !g.some(x => x.gate === 'Revenue evidence'));
});

test('data centre with no import size: load cost is not held (never $0) and its gate Holds', () => {
  const m = optionMetrics(data, node('111403'), { tech: 'datacenter', exportMW: 100, importMW: 0, basis, cf: 0.15, lossPct: 3 });
  assert.equal(m.loadCost.value, null);
  assert.match(m.loadCost.reason, /import/i);
  assert.equal(gates(m, { tech: 'datacenter' }).find(x => x.gate === 'Load cost evidence').verdict, 'Hold');
});

test('gate 6 (Capture) appears for solar, wind and hybrid only, with the basis named; unknown is Hold', () => {
  const p = { tech: 'solar', exportMW: 100, importMW: 0, basis, cf: 0.15, lossPct: 3 };
  const m = optionMetrics(data, node('111403'), p);
  const g = gates(m, p).find(x => x.gate === 'Capture');
  assert.ok(g); assert.match(g.why, /clear-sky/); assert.match(g.why, /fleet/);
  assert.notEqual(g.verdict, 'Pass', 'the fleet basis is not loaded here, so it cannot pass');
  const ps = { ...p, tech: 'storage', importMW: 100 };
  assert.ok(!gates(optionMetrics(data, node('111403'), ps), ps).some(x => x.gate === 'Capture'));
  const items = openItems([m], [gates(m, p)]);
  const it = items.find(i => i.gate === 'Capture'); assert.ok(it && /Prices|Economics/.test(it.where));
});
