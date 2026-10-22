// Prices fuel calculations (views/prices-fuel.js): load cost, scarcity, storage blocks, spread curve, wind floor,
// fleet-shape capture. Written before the module (TDD). Null = not held, never 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isWindHour, billShare, billShareFromMeans, scarcity, scarcityProxy, cheapHours, flatLoadCost,
  blockHours, blockByMonth, spreadCurve, shareAtOrAbove, windowStats, fleetCapture, typicalShape, fuelOf,
} from '../views/prices-fuel.js';

const day = (date, prices, off = '-05:00') => prices.map((p, h) => ({ timestamp: `${date}T${String(h).padStart(2, '0')}:00:00${off}`, price: p, dtHours: 1 }));
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('fuelOf maps the shell tech to one of five fuels; unknown falls back to solar', () => {
  assert.equal(fuelOf('datacenter'), 'datacenter'); assert.equal(fuelOf('storage'), 'storage'); assert.equal(fuelOf('hybrid'), 'hybrid');
  assert.equal(fuelOf('wind'), 'wind'); assert.equal(fuelOf(undefined), 'solar'); assert.equal(fuelOf('x'), 'solar');
});

test('isWindHour: HE 1–7 and HE 19–24 (clock hours 0–6 and 18–23), the Studio agg window', () => {
  const on = Array.from({ length: 24 }, (_, h) => h).filter(isWindHour);
  assert.deepEqual(on, [0, 1, 2, 3, 4, 5, 6, 18, 19, 20, 21, 22, 23]);
});

test('billShare: each clock hour\'s share of a flat load\'s bill = Σ price in that hour ÷ Σ all prices', () => {
  const rows = [...day('2025-01-01', Array.from({ length: 24 }, (_, h) => (h === 18 ? 100 : 10))), ...day('2025-01-02', Array.from({ length: 24 }, (_, h) => (h === 18 ? 50 : 10)))];
  const b = billShare(rows);
  const total = 2 * (23 * 10) + 150;
  assert.equal(b.total, total);
  close(b.hours[18].share, 100 * 150 / total);
  close(b.hours[0].share, 100 * 20 / total);
  close(b.hours.reduce((t, x) => t + x.share, 0), 100);
  assert.equal(b.hours[18].mean, 75); assert.equal(b.hours[18].n, 2);
  assert.equal(b.dearest.h, 18);
  // A block share (HE17–21 = clock hours 16–20)
  close(b.block([16, 17, 18, 19, 20]), 100 * (150 + 4 * 20) / total);
  // Not held: no rows, or a bill that is not positive
  assert.equal(billShare([]).total, null);
  assert.equal(billShare(day('2025-01-01', [-5, 0])).hours[0].share, null);
});

test('billShareFromMeans: the Studio 5.18 method from hour-of-day means; a missing hour makes every share not held', () => {
  const s = billShareFromMeans(Array.from({ length: 24 }, (_, h) => (h === 0 ? 48 : 24)));
  close(s[0], 100 * 48 / (48 + 23 * 24)); close(s.reduce((t, v) => t + v, 0), 100);
  assert.ok(billShareFromMeans([1, 2, null]).every(v => v === null));
});

test('scarcity: hours above $X, their cost, their share of the bill and their excess over the mean', () => {
  const rows = day('2025-07-01', [10, 20, 30, 300, 500]);
  const s = scarcity(rows, 200);
  assert.equal(s.hours, 5); assert.equal(s.above, 2);
  assert.equal(s.total, 860); assert.equal(s.costAbove, 800);
  close(s.share, 100 * 800 / 860);
  close(s.mean, 172);
  close(s.excess, (300 - 172) + (500 - 172));
  assert.equal(scarcity(rows, 1000).above, 0); assert.equal(scarcity(rows, 1000).share, 0);
  assert.equal(scarcity([], 200).share, null);
  // threshold is strictly above
  assert.equal(scarcity(day('2025-07-01', [200, 201]), 200).above, 1);
});

test('scarcityProxy is the Studio 5.21 proxy: hours > $200 × (P95 − mean), not held when any input is missing', () => {
  assert.equal(scarcityProxy(10, 120, 40), 800);
  assert.equal(scarcityProxy(null, 120, 40), null);
  assert.equal(scarcityProxy(10, undefined, 40), null);
});

test('cheapHours: hours strictly below the threshold and their share', () => {
  const c = cheapHours(day('2025-01-01', [5, 19.99, 20, 40]), 20);
  assert.equal(c.hours, 2); assert.equal(c.n, 4); close(c.share, 50);
  assert.equal(cheapHours([], 20).share, null);
});

test('flatLoadCost: Σ price × hours × MW; per-MW when MW is not given', () => {
  const rows = day('2025-01-01', [10, 20, 30]);
  const f = flatLoadCost(rows, 300);
  assert.equal(f.hours, 3); assert.equal(f.perMW, 60); assert.equal(f.cost, 18000); assert.equal(f.mean, 20);
  assert.equal(flatLoadCost(rows, 0).cost, null); assert.equal(flatLoadCost(rows, null).perMW, 60);
  assert.equal(flatLoadCost([], 10).mean, null);
});

test('blockHours: per day, which clock hours fall in the N cheapest and N dearest (ties: earlier hour cheaper)', () => {
  const p1 = Array.from({ length: 24 }, (_, h) => h);          // cheapest 0–3, dearest 20–23
  const p2 = Array.from({ length: 24 }, (_, h) => 100 - h);    // cheapest 20–23, dearest 0–3
  const b = blockHours([...day('2025-01-01', p1), ...day('2025-01-02', p2), ...day('2025-01-03', [1, 2, 3])], 4);
  assert.equal(b.days, 2); // the 3-hour day has fewer than 2N hours
  assert.equal(b.hours[0].top, 1); assert.equal(b.hours[0].bot, 1);
  assert.equal(b.hours[10].top, 0); assert.equal(b.hours[10].bot, 0);
  assert.equal(b.hours.reduce((t, x) => t + x.top, 0), 8);
  close(b.hours[0].topPct, 50);
  assert.deepEqual(b.discharge, [0, 1, 2, 3]);
  // tie-break
  const t = blockHours(day('2025-01-01', Array.from({ length: 8 }, () => 5)), 2);
  assert.equal(t.hours[0].bot, 1); assert.equal(t.hours[1].bot, 1); assert.equal(t.hours[7].top, 1); assert.equal(t.hours[6].top, 1);
});

test('blockByMonth: mean of the N cheapest and N dearest per day, by month; day-weighted pooling = the whole-year spread', () => {
  const jan = [...day('2025-01-01', Array.from({ length: 24 }, (_, h) => h)), ...day('2025-01-02', Array.from({ length: 24 }, (_, h) => 2 * h))];
  const feb = day('2025-02-01', Array.from({ length: 24 }, (_, h) => 10 + h));
  const m = blockByMonth([...jan, ...feb], 4);
  assert.equal(m[0].days, 2); assert.equal(m[1].days, 1); assert.equal(m[2].days, 0); assert.equal(m[2].spread, null);
  close(m[0].cheap, ((0 + 1 + 2 + 3) / 4 + (0 + 2 + 4 + 6) / 4) / 2);
  close(m[0].dear, ((20 + 21 + 22 + 23) / 4 + (40 + 42 + 44 + 46) / 4) / 2);
  close(m[0].spread, m[0].dear - m[0].cheap);
  close(m[1].spread, 20);
  const pooled = (m[0].spread * 2 + m[1].spread) / 3;
  close(pooled, (20 + 40 + 20) / 3);
  assert.deepEqual(m[1].chargeHours, [0, 1, 2, 3]); assert.deepEqual(m[1].dischargeHours, [20, 21, 22, 23]);
});

test('spreadCurve: daily max − min, days with fewer than minHours excluded, widest first; shareAtOrAbove', () => {
  const rows = [...day('2025-01-01', Array.from({ length: 24 }, (_, h) => h)), ...day('2025-01-02', Array.from({ length: 24 }, () => 7)), ...day('2025-01-03', [0, 99])];
  const c = spreadCurve(rows, 20);
  assert.deepEqual(c.map(d => d.spread), [23, 0]);
  assert.equal(c[0].day, '2025-01-01');
  assert.equal(shareAtOrAbove(c.map(d => d.spread), 20), 50);
  assert.equal(shareAtOrAbove([], 20), null);
});

test('windowStats: quantile_cont P5 / P25, mean, min and negative hours over a window\'s hours only', () => {
  const rows = day('2025-01-01', Array.from({ length: 24 }, (_, h) => (isWindHour(h) ? h - 10 : 999)));
  const w = windowStats(rows, isWindHour);
  assert.equal(w.n, 13);
  const v = [0, 1, 2, 3, 4, 5, 6, 18, 19, 20, 21, 22, 23].map(h => h - 10).sort((a, b) => a - b);
  close(w.p5, v[0] + (v[1] - v[0]) * (12 * 0.05));
  close(w.p25, v[3]);
  assert.equal(w.min, -10); assert.equal(w.neg, 7);
  assert.equal(windowStats([], isWindHour), null);
});

test('fleetCapture: generation-weighted price with the fleet MW matched by clock hour; unmatched hours are counted, not zeroed', () => {
  const rows = day('2025-03-01', [10, 20, 30, 40]);
  const shape = { '2025-03-01T00': 0, '2025-03-01T01': 100, '2025-03-01T02': 300 };
  const c = fleetCapture(rows, shape);
  close(c.capture, (100 * 20 + 300 * 30) / 400);
  assert.equal(c.matched, 3); assert.equal(c.missing, 1);
  close(c.avg, 20); close(c.ratio, c.capture / 20);
  // typical shape: fall back to a month × hour mean
  const typ = typicalShape({ '2024-03-05T01': 50, '2025-03-09T01': 150, '2025-04-01T01': 999 });
  assert.equal(typ.get('3|1'), 100);
  const c2 = fleetCapture([{ timestamp: '2030-03-02T01:00:00', price: 12, dtHours: 1 }], {}, typ);
  assert.equal(c2.capture, 12); assert.equal(c2.typical, 1); assert.equal(c2.missing, 0);
  assert.equal(fleetCapture(rows, null).capture, null);
});
