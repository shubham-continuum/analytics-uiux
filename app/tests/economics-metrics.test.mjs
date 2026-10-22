// Tests for the Economics dashboard metrics (economics.js, "dashboard metrics" section). Written before the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupSum, negativePriceHours, spreadAt, spreadBenchmark, dailyCycles, reserveValue, tornado,
  financeGrid, payback, pathAlong, fillGaps, shapeProfile, stampHour, projectFinance,
} from '../economics.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const ts = (d, h) => `2025-01-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00-05:00`;

test('groupSum sums named amounts per key and counts rows', () => {
  const rows = [{ timestamp: '2025-01-01T00', a: 1, b: 2 }, { timestamp: '2025-01-31T23', a: 3, b: null }, { timestamp: '2025-02-01T00', a: 5, b: 1 }];
  const g = groupSum(rows, r => r.timestamp.slice(0, 7), { a: r => r.a, b: r => r.b });
  assert.deepEqual(g.map(x => x.key), ['2025-01', '2025-02']);
  near(g[0].a, 4); near(g[1].a, 5); assert.equal(g[0].n, 2);
  assert.equal(g[0].b, null, 'a month with a missing amount is not held, never a partial sum');
});

test('negativePriceHours counts generation sold below zero and the avoidable loss', () => {
  const rows = [{ price: -10, generationMW: 5, dtHours: 1 }, { price: 20, generationMW: 5, dtHours: 1 }, { price: -4, generationMW: 0, dtHours: 1 }, { price: -2, generationMW: 2, dtHours: 0.5 }];
  const r = negativePriceHours(rows);
  near(r.hours, 1.5); near(r.mwh, 6); near(r.revenue, -52); near(r.uplift, 52);
});

test('spreadAt interpolates between the 2/4/8 h anchors and clamps outside', () => {
  const a = { 2: 60, 4: 40, 8: 20 };
  near(spreadAt(a, 4), 40); near(spreadAt(a, 3), 50); near(spreadAt(a, 6), 30); near(spreadAt(a, 1), 60); near(spreadAt(a, 10), 20);
  near(spreadAt({ 2: null, 4: 40, 8: null }, 8), 40);
  assert.equal(spreadAt({ 2: null, 4: null, 8: null }, 4), null);
});

test('spreadBenchmark = MW × hours × spread × cycles × RTE; null when an input is not held', () => {
  near(spreadBenchmark({ mw: 100, dur: 4, spread: 50, cycles: 365, rte: 0.86 }), 100 * 4 * 50 * 365 * 0.86);
  assert.equal(spreadBenchmark({ mw: 100, dur: 4, spread: null, cycles: 365, rte: 0.86 }), null);
});

test('dailyCycles counts stored energy discharged per calendar day', () => {
  const rows = [{ timestamp: ts(1, 1), dischargeMW: 9, dtHours: 1 }, { timestamp: ts(1, 2), dischargeMW: 9, dtHours: 1 }, { timestamp: ts(2, 1), dischargeMW: 0, dtHours: 1 }];
  const d = dailyCycles(rows, 20, 0.9);
  assert.deepEqual(d.map(x => x.day), ['2025-01-01', '2025-01-02']);
  near(d[0].cycles, 1); near(d[1].cycles, 0);
});

test('stampHour keys a local clock hour, and reserveValue prices only idle matched hours', () => {
  assert.equal(stampHour('2025-01-01T05:00:00-05:00'), '2025-01-01T05');
  assert.equal(stampHour('2030-06-01T13:00:00'), '2030-06-01T13');
  const rows = [{ timestamp: ts(1, 1), chargeMW: 0, dischargeMW: 0, dtHours: 1 }, { timestamp: ts(1, 2), chargeMW: 5, dischargeMW: 0, dtHours: 1 }, { timestamp: ts(1, 3), chargeMW: 0, dischargeMW: 0, dtHours: 1 }];
  const prices = { '2025-01-01T01': 10, '2025-01-01T02': 100 };
  const r = reserveValue(rows, k => prices[k], 50);
  assert.equal(r.matched, 2); assert.equal(r.idleMatched, 1); assert.equal(r.unmatched, 1);
  near(r.idleValue, 500); near(r.allValue, 5500);
});

test('tornado sorts by swing and keeps a not-held side as null', () => {
  const t = tornado(100, [{ label: 'A', low: { value: 90 }, high: { value: 110 } }, { label: 'B', low: { value: 50 }, high: { value: 160 } }, { label: 'C', low: { value: null }, high: { value: 120 } }]);
  assert.deepEqual(t.map(x => x.label), ['B', 'A', 'C']);
  near(t[0].swing, 110); near(t[0].lowDelta, -50); near(t[0].highDelta, 60);
  assert.equal(t[2].lowDelta, null); near(t[2].swing, 20);
});

test('financeGrid reproduces projectFinance at every rate × capex cell', () => {
  const base = { capex: 100, annualOM: 5, years: 10, constructionYears: 1, annualRevenue: Array(10).fill(25), discountRate: 0.08 };
  const g = financeGrid(base, [0.06, 0.08], [80, 100]);
  near(g.npv[1][1], projectFinance(base).summary.npv);
  near(g.npv[0][0], projectFinance({ ...base, discountRate: 0.06, capex: 80 }).summary.npv);
  assert.ok(g.npv[0][0] > g.npv[1][1]);
});

test('payback interpolates within the crossing year; never = null', () => {
  const rows = [{ year: 0, projectCashFlow: -100 }, { year: 1, projectCashFlow: 40 }, { year: 2, projectCashFlow: 40 }, { year: 3, projectCashFlow: 40 }];
  const p = payback(rows, 0);
  near(p.simple, 2.5); near(p.discounted, 2.5);
  assert.ok(payback(rows, 0.05).discounted > 2.5); assert.equal(payback(rows, 0.1).discounted, null, 'discounted flows never repay at 10%');
  assert.equal(payback([{ year: 0, projectCashFlow: -100 }, { year: 1, projectCashFlow: 10 }], 0).simple, null);
});

test('pathAlong holds before the first anchor, interpolates between, holds flat past the last', () => {
  const a = [{ y: 2028, v: 10, kind: 'run' }, { y: 2030, v: 20, kind: 'run' }];
  const p = pathAlong(a, [2027, 2028, 2029, 2030, 2031]);
  assert.deepEqual(p.map(x => x.v), [10, 10, 15, 20, 20]);
  assert.deepEqual(p.map(x => x.kind), ['held at 2028', 'run', 'interpolated', 'run', 'held flat past 2030']);
  assert.deepEqual(pathAlong([], [2030]), [{ y: 2030, v: null, kind: 'not held' }]);
});

test('fillGaps interpolates short gaps only and reports what it filled', () => {
  const r = fillGaps([1, null, 3, null, null, null, 7, null], 2);
  assert.deepEqual(r.values, [1, 2, 3, null, null, null, 7, null]);
  assert.equal(r.filled, 1); assert.equal(r.unfilled, 4);
});

test('shapeProfile scales a measured shape to the capacity factor and caps at nameplate', () => {
  const recs = [0, 1, 2, 3].map(i => ({ timestamp: ts(1, i), price: 10, dtHours: 1 }));
  const shape = [0, 1, 1, 2];
  const g = shapeProfile(recs, shape, 10, 0.5);
  near(g.values.reduce((a, b) => a + b, 0), 20 - 0); // mean shape 1 → MW × CF × s: 0, 5, 5, 10 (none clipped)
  const c = shapeProfile(recs, shape, 10, 0.9);
  assert.ok(c.values.every(v => v <= 10)); near(c.clippedMWh, 18 - 10);
  assert.equal(shapeProfile(recs, [0, null, 1, 1], 10, 0.5).values, null, 'a missing shape hour is not held');
});
