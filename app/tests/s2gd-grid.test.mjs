// Provenance: Claude Opus 5.5 · one-studio P2 slice S2-GD (Grid + Decision correctness blockers) · 2026-10-06 · v1
// Grid side of S2-GD. D6.1 (decided 2026-10-06): the headroom source of record is the element study; an envelope-only
// case is context, never a green Fits / MET and never counted as a pass (Findings F009, F010). Plus the study basis
// (F013), the staleness of the solved case (F005) and the FORMULAS §10 discrepancies D1, D2, D6, D7.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { caseTable, binding, sizeSweep, screeningGates, unstudiedCases, ENVELOPE_ONLY, studyBasis, STUDY_VINTAGE, studyStaleness,
  preExistingCounts, largestWithoutUpgrades, unpricedScope, queueNearbySummary } from '../gridrules.js';
import { traceNearby, traceCost } from '../views/grid-trace.js';
import { resetTraces } from '../trace.js';

const grid = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url))).grid;
const HATCH = '111209'; // Hatchville 115 kV: summer-peak element 197.8 MW, shoulder envelope 283.2 MW (kit worked example)

// ---------- F009 / D6.1: envelope-only is context, never Fits ----------
test('F009: an envelope-only case is never "Fits"; it reads "Envelope only" and keeps its number as context', () => {
  const t = caseTable(grid, HATCH, 'solar', 100, 0);
  const sp = t.find(r => r.key === 'summer_peak|discharge'), sh = t.find(r => r.key === 'shoulder|discharge');
  assert.equal(sp.status, 'Fits'); assert.equal(sp.evidence, 'element');
  assert.equal(sh.status, ENVELOPE_ONLY); assert.equal(ENVELOPE_ONLY, 'Envelope only');
  assert.equal(sh.evidence, 'envelope'); assert.equal(sh.governing, 283.2, 'the envelope stays visible as context');
  assert.equal(sh.envelopeFits, true, 'the envelope clears the request, but that is context only');
  assert.ok(!t.some(r => r.evidence === 'envelope' && r.status === 'Fits'));
});

test('F009: the binding status with an envelope-only case is "Envelope only", never Fits; the limit number is unchanged', () => {
  const b = binding(caseTable(grid, HATCH, 'solar', 100, 0), 'export');
  assert.equal(b.status, ENVELOPE_ONLY);
  assert.equal(b.value, 197.8, 'binding = min(197.8 element, 283.2 envelope)');
  assert.equal(b.valueBasis, 'element');
  assert.deepEqual(b.envelopeCases, ['Shoulder · export']);
  assert.deepEqual(b.envelopeBelow, []);
});

test('F009: an envelope below the request is not a known breach (Envelope only), an element breach is (Does not fit)', () => {
  const lowEnv = binding(caseTable(grid, '100179', 'solar', 150, 0), 'export'); // element 199.6 fits, shoulder envelope 131.3 < 150
  assert.equal(lowEnv.status, ENVELOPE_ONLY);
  assert.deepEqual(lowEnv.envelopeBelow, ['Shoulder · export']);
  assert.equal(lowEnv.valueBasis, 'envelope', 'the conservative number comes from the envelope and says so');
  assert.equal(binding(caseTable(grid, '100178', 'solar', 100, 0), 'export').status, 'Does not fit', 'element 67.6 < 100');
});

test('F009: a size sweep never reports "fits" on envelope-only evidence', () => {
  const sw = sizeSweep(grid, HATCH, 'solar', [50, 100, 150]);
  assert.ok(sw.every(r => r.fits !== true));
  assert.ok(sw.every(r => r.statuses.includes(ENVELOPE_ONLY)));
  // A data centre has element rows in both of its cases: it can still fit.
  assert.equal(sizeSweep(grid, '114417', 'datacenter', [100])[0].fits, true);
});

// ---------- F010: light load / minimum load are unstudied Hold rows ----------
test('F010: light-load and minimum-load injection cases are listed as not studied, with the ISO-NE study scope cited', () => {
  const u = unstudiedCases('solar');
  assert.deepEqual(u.map(r => r.key), ['light_load|discharge', 'minimum_load|discharge']);
  assert.ok(u.every(r => r.status === 'Not studied' && r.verdict === 'Hold' && /PP5-6/.test(r.src) && r.why.length > 20));
  assert.deepEqual(unstudiedCases('datacenter'), [], 'a load is screened on withdrawal cases');
  assert.equal(unstudiedCases('storage').length, 2);
});

// ---------- the strip's two screening gates (moved out of app.js so the strip and Grid share one rule) ----------
test('screening gates: envelope-only and unstudied cases make G1 unknown, never met', () => {
  const g = screeningGates(caseTable(grid, HATCH, 'solar', 100, 0), 'solar');
  assert.equal(g.total, 2);
  assert.equal(g.gates[0].state, 'unknown');
  assert.match(g.gates[0].why, /Shoulder · export: envelope only/);
  assert.match(g.gates[0].why, /light load/i);
  assert.equal(g.gates[1].state, 'unknown', 'shoulder has no element study, so pre-existing overloads are unknown there');
  assert.equal(g.met, 0); assert.equal(g.label, '0 of 2 met · 2 unknown');
  const f = screeningGates(caseTable(grid, '100178', 'solar', 100, 0), 'solar');
  assert.equal(f.gates[0].state, 'not met');
  const dc = screeningGates(caseTable(grid, '114417', 'datacenter', 0, 100), 'datacenter');
  assert.equal(dc.gates[0].state, 'met', 'element evidence in every case the load needs');
  assert.ok(g.lines.split('\n').length === 2);
});

// ---------- F013: study basis ----------
test('F013: the study basis names every field; what the store does not record is "not held" with a reason, never blank', () => {
  const sb = studyBasis(grid, HATCH, { queueModelled: 110 });
  const labels = sb.map(r => r.label);
  for (const l of ['Performed by', 'Base-case model and year', 'Season and load level', 'Generation dispatch', 'Queue positions included', 'Transfer sink', 'Method', 'Ratings used', 'Vintage'])
    assert.ok(labels.includes(l), l);
  for (const r of sb) { assert.ok(r.value && r.value.length > 2, r.label); assert.ok(['held', 'not held', 'derived'].includes(r.status), r.label); assert.ok(r.src, r.label); }
  // P2 C04: the vintage names both sets (the old `=== STUDY_VINTAGE` encoded the single-set defect); the element set is STUDY_VINTAGE.
  assert.match(sb.find(r => r.label === 'Vintage').value, /element rows: Interconnection element study \(2026-05 set\); envelope: ISO-NE GridSense data, headline set, vintage unconfirmed \(D-007\)/);
  assert.ok(sb.find(r => r.label === 'Vintage').value.includes(`(${STUDY_VINTAGE} set)`));
  assert.match(sb.find(r => r.label === 'Queue positions included').value, /110/);
  assert.equal(sb.find(r => r.label === 'Transfer sink').status, 'not held');
  assert.match(sb.find(r => r.label === 'Method').value, /DC/);
  assert.match(sb.find(r => r.label === 'Ratings used').value, /rate A/);
  assert.equal(studyBasis(grid, HATCH, {}).find(r => r.label === 'Queue positions included').status, 'not held');
});

// ---------- F005: staleness of the solved case ----------
test('F005: staleness line counts withdrawals since the study and names the largest nearby one', () => {
  const s = studyStaleness({ counts: { W: 51, C: 34, A: 25, missing: 0 }, total: 110, nearby: [{ qp: 1109, mw: 487, mi: 11.5, poi: 'West Barnstable 345' }, { qp: 900, mw: 20, mi: 3 }], radiusMi: 25 });
  assert.equal(s.withdrawn, 51); assert.equal(s.total, 110);
  assert.match(s.text, /Study case 2026-05: 51 of 110 modelled requests since withdrawn/);
  assert.match(s.text, /largest within 25 mi Q1109 487 MW, 11\.5 mi/);
  assert.match(s.text, /limits not re-run/);
  const none = studyStaleness({ counts: null, total: null });
  assert.match(none.text, /not held/); assert.equal(none.withdrawn, null);
});

// ---------- D6: pre-existing issues from two sources, both shown, one function ----------
test('D6: pre-existing counts report the envelope table and the element list apart, labelled', () => {
  const p = preExistingCounts(grid, HATCH, 'solar');
  assert.ok('envelope' in p && 'element' in p);
  assert.equal(p.element, 0, 'no element row at Hatchville is at or above 100% before the project');
  assert.match(p.note, /fact_headroom/); assert.match(p.note, /element/);
});

// ---------- D7: largest size without upgrades is the limit, not truncated ----------
test('D7: the largest size without upgrades equals the governing limit (197.8 MW, never 197)', () => {
  assert.equal(largestWithoutUpgrades(197.8), 197.8);
  assert.equal(largestWithoutUpgrades(null), null);
});

// ---------- D2: unpriced scope counts every allocator row ----------
test('D2: unpriced scope = network + gap + direct + affected-system rows, one count for the KPI and the trace', () => {
  const rows = [{ category: 'Network upgrade', cost: 1.2 }, { category: 'Network upgrade', cost: null }, { category: 'Direct facility', cost: null }, { category: 'Affected system', cost: null }];
  const u = unpricedScope(rows);
  assert.equal(u.total, 3); assert.equal(u.network, 1); assert.equal(u.other, 2);
  resetTraces();
  const S = { nodeId: HATCH, exportMW: 100, importMW: 0, ui: {} };
  const step = { status: 'No upgrades indicated', total: 0, items: [], gaps: [], unverified: [{ label: 'Shoulder · export', reason: 'Envelope only' }] };
  const res = { rows: [{ label: 'Direct connection facilities', category: 'Direct facility', cost: null, allocation: null }, { label: 'Affected-system upgrades', category: 'Affected system', cost: null, allocation: null }], unpriced: 2 };
  const html = traceCost({ grid }, S, 'solar', 'export', 100, step, res, 0);
  assert.match(html, /Unpriced scope \(all rows\)/);
  assert.match(html, /2 unpriced/);
  assert.ok(!/Does not reconcile/.test(html));
});

// ---------- D1: the nearby-queue trace sums exactly what it lists ----------
test('D1: nearby queue total is the sum of every listed request; nothing summed is hidden', () => {
  const q = [586, 50, 100].map((mw, i) => ({ qp: 1000 + i, type: 'Solar', mw, mi: i + 1 }));
  const many = Array.from({ length: 8 }, (_, i) => ({ qp: 2000 + i, type: 'Wind', mw: 10 + i, mi: i }));
  const s = queueNearbySummary(many);
  assert.equal(s.n, 8); assert.equal(s.mw, many.reduce((a, x) => a + x.mw, 0));
  assert.equal(s.listed.length, 8, 'every request summed is listed');
  assert.equal(queueNearbySummary(q).mw, 736);
  resetTraces();
  const ctx = { bus: { bus_id: HATCH, latitude: 41.6, longitude: -70.5 }, upgrades: [], retirements: [], generators: [], queue: many, queue_unplaced: 0,
    radius: { upgrades_mi: 50, retirements_mi: 50, generators_mi: 15, queue_mi: 25 } };
  const html = traceNearby(ctx);
  for (const x of many) assert.ok(html.includes(`#${x.qp}`), `Q${x.qp} listed`);
  assert.match(html, /8 requests/);
});
