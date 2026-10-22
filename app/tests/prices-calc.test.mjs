// Prices all-years calculations: the browser re-computations must follow the unified mart SQL definitions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { yearStats, monthStats, tbMart, daRt, thresholdCounts, topHours, zoneYears, zoneMonths, assocRebuild, durationGrid, captureOf, heldRows, componentYears } from '../views/prices-calc.js';

const day = (date, prices, off = '-05:00') => prices.map((p, h) => ({ timestamp: `${date}T${String(h).padStart(2, '0')}:00:00${off}`, price: p }));

test('yearStats: equal-weight rows, quantile_cont, peak hour 7–22, window 9–16, < 0 and > 200 counts', () => {
  const rows = day('2025-01-02', Array.from({ length: 24 }, (_, h) => h * 10 - 20));
  const s = yearStats(rows);
  assert.equal(s.n, 24);
  assert.equal(s.mean, rows.reduce((t, r) => t + r.price, 0) / 24);
  assert.equal(s.neg, 2);            // −20, −10
  assert.equal(s.le0, 3);            // and 0
  assert.equal(s.gt200, 1);          // 210 only (h = 23 → 210)
  assert.equal(s.peak, [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22].reduce((t, h) => t + h * 10 - 20, 0) / 16);
  assert.equal(s.window, [9, 10, 11, 12, 13, 14, 15, 16].reduce((t, h) => t + h * 10 - 20, 0) / 8);
  // quantile_cont: linear interpolation at (n − 1) p
  assert.ok(Math.abs(s.p5 - (-20 + 0.05 * 23 * 10)) < 1e-9);
  assert.ok(Math.abs(s.std - Math.sqrt(rows.reduce((t, r) => t + (r.price - s.mean) ** 2, 0) / 23)) < 1e-9);
  assert.equal(yearStats([]), null);
});

test('heldRows drops nulls (not held), keeps both autumn fold readings like the mart', () => {
  const rows = heldRows({ records: [['2025-11-02T01:00:00-04:00', 10, null, 9, 0.5, 0.5], ['2025-11-02T01:00:00-05:00', 12, null, 11, 0.5, 0.5], ['2025-11-02T02:00:00-05:00', null, null, null, null, null]] });
  assert.equal(rows.length, 2);
});

test('monthStats: month mean, solar-window mean, negative hours; empty month is not held', () => {
  const m = monthStats(day('2025-03-04', Array.from({ length: 24 }, (_, h) => (h === 3 ? -5 : 40))));
  assert.equal(m[2].n, 24); assert.equal(m[2].neg, 1); assert.equal(m[2].window, 40);
  assert.equal(m[0].mean, null); assert.equal(m[0].neg, null);
});

test('tbMart: per-date top-N minus bottom-N, days with fewer than N rows use what they have', () => {
  const rows = [...day('2025-01-01', Array.from({ length: 24 }, (_, h) => h)), ...day('2025-01-02', [5, 7])];
  const t = tbMart(rows, 4);
  assert.equal(t.days, 2);
  assert.equal(t.daily[0].spread, (20 + 21 + 22 + 23) / 4 - (0 + 1 + 2 + 3) / 4);
  assert.equal(t.daily[1].spread, 0); // two rows: top-2 and bottom-2 are the same rows, as the SQL
  assert.equal(t.mean, (t.daily[0].spread + 0) / 2);
});

test('daRt pairs by clock stamp (offset ignored, larger fold reading) and only where both are held', () => {
  const rt = [{ timestamp: '2025-11-02T01:00:00-04:00', price: 30 }, { timestamp: '2025-11-02T01:00:00-05:00', price: 50 }, { timestamp: '2025-11-02T02:00:00-05:00', price: 20 }];
  const da = [{ timestamp: '2025-11-02T01:00:00-04:00', price: 40 }, { timestamp: '2025-11-02T03:00:00-05:00', price: 99 }];
  const d = daRt(rt, da);
  assert.equal(d.n, 1); assert.equal(d.rt, 50); assert.equal(d.da, 40); assert.equal(d.spread, 10); assert.equal(d.shareRtAbove, 1);
  assert.equal(daRt([], da), null);
});

test('thresholdCounts and topHours', () => {
  const c = thresholdCounts([-1, 0, 50, 150, 600, 1200], [100, 500, 1000]);
  assert.deepEqual([c.lt0, c.le0, c.gt100, c.gt500, c.gt1000], [1, 2, 3, 2, 1]);
  const t = topHours(day('2025-01-01', [1, 9, 3, 9]), 2);
  assert.deepEqual(t.map(r => r.timestamp.slice(11, 13)), ['01', '03']);
});

test('zoneYears and zoneMonths aggregate endpoint sums exactly', () => {
  const s = [{ zone: 'Hub', market: 'RT', y: 2025, m: 1, hours: 10, sum_basis: 5, sum_node: 505, sum_ref: 500, hours_above: 6 },
    { zone: 'Hub', market: 'RT', y: 2025, m: 2, hours: 30, sum_basis: -15, sum_node: 1485, sum_ref: 1500, hours_above: 3 }];
  const y = zoneYears(s)[0];
  assert.equal(y.hours, 40); assert.equal(y.basis, -10 / 40); assert.equal(y.node - y.ref, y.basis); assert.equal(y.abovePct, 100 * 9 / 40);
  const m = zoneMonths(s, 'Hub', 'RT', [2025]);
  assert.equal(m[0].basis, 0.5); assert.equal(m[1].basis, -0.5); assert.equal(m[2].basis, null);
});

test('assocRebuild rebuilds Σ MCC; not held without both means', () => {
  assert.equal(assocRebuild({ mcc_on: 2, mcc_off: 1, hours: 10 }, 100), 2 * 10 + 1 * 90);
  assert.equal(assocRebuild({ mcc_on: null, mcc_off: 1, hours: 10 }, 100), null);
});

test('durationGrid is high → low on a 0..100 percentile grid', () => {
  const g = durationGrid([5, 1, 3, 2, 4], 25);
  assert.deepEqual(g.map(p => p.y), [5, 4, 3, 2, 1]);
  assert.deepEqual(durationGrid([]), []);
});

test('captureOf is hour-weighted and skips hours with no shape value', () => {
  const rows = day('2025-06-01', [10, 20, 30]).map(r => ({ ...r, dtHours: 1 }));
  const c = captureOf(rows, r => (r.price === 30 ? null : r.price === 20 ? 1 : 0));
  assert.equal(c.capture, 20); assert.equal(c.avg, 15); assert.equal(c.ratio, 20 / 15);
});

test('componentYears keeps settled and solved rows apart', () => {
  const rows = componentYears({ year: [{ market: 'RT', y: 2025, n_hours: 8760, avg_energy: 60, avg_cong: 1, avg_loss: 2, avg_lmp: 63 }, { market: 'DA', y: 2025 }], fcstYear: [{ scenario: '5yr', target_year: 2028, avg_energy: 40, avg_cong: 16, avg_loss: 1, avg_lmp: 57 }] });
  assert.equal(rows.length, 2); assert.equal(rows[0].kind, 'settled'); assert.equal(rows[1].kind, 'solved'); assert.equal(rows[1].label, '2028 5yr');
});
