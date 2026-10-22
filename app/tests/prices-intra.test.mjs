// Pure logic for the Prices "Within the hour" cards (views/prices-intra.js): 5-minute vs hourly, intra-hour range,
// intervals above a threshold, and the 5-minute TB uplift over the hourly TB.
import test from 'node:test';
import assert from 'node:assert/strict';
import { intraHours, intraSummary, dayTb, heldMonths } from '../views/prices-intra.js';

const flat = (v, n = 12) => Array(n).fill(v);
// One full day: hour h has twelve intervals; hour 18 spikes in one interval.
const day = (date, spikeHour = 18) => Array.from({ length: 24 }, (_, h) => {
  const base = 20 + h; const p = flat(base); if (h === spikeHour) p[5] = 500;
  return [`${date} ${String(h).padStart(2, '0')}`, p, null];
});

test('intraHours: mean, min, max, range, complete flag and published hour carried', () => {
  const H = intraHours([['2026-01-01 00', [10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40], 25], ['2026-01-01 01', [5, 7], null]]);
  assert.equal(H.length, 2);
  assert.equal(H[0].mean, 25); assert.equal(H[0].min, 10); assert.equal(H[0].max, 40); assert.equal(H[0].range, 30);
  assert.equal(H[0].complete, true); assert.equal(H[0].pub, 25); assert.equal(H[0].date, '2026-01-01'); assert.equal(H[0].month, 1);
  assert.equal(H[1].complete, false); assert.equal(H[1].pub, null);
});

test('intraHours: nulls are dropped, an hour with no price is skipped (not held, never zero)', () => {
  const H = intraHours([['2026-01-01 00', [null, 10, 20], null], ['2026-01-01 01', [null], null]]);
  assert.equal(H.length, 1); assert.equal(H[0].n, 2); assert.equal(H[0].mean, 15);
});

test('dayTb: k dearest minus k cheapest, hourly means vs 5-minute intervals', () => {
  const H = intraHours(day('2026-01-02'));
  const t = dayTb(H, 4);
  // Hourly means: 20..43 with hour 18 = (38*11 + 500)/12. Top 4 hourly: 18 (76.5), 23, 22, 21 (43, 42, 41).
  const h18 = (38 * 11 + 500) / 12;
  assert.ok(Math.abs(t.tbH - ((h18 + 43 + 42 + 41) / 4 - (20 + 21 + 22 + 23) / 4)) < 1e-9);
  // 5-minute: top 48 intervals = 500 + the 11 others at 38? No: hours 23,22,21,20 (12 each = 48) beat 38: 500 + 43*12 + 42*12 + 41*12 + 40*11.
  const top = (500 + 43 * 12 + 42 * 12 + 41 * 12 + 40 * 11) / 48, bot = (20 * 12 + 21 * 12 + 22 * 12 + 23 * 12) / 48;
  assert.ok(Math.abs(t.tb5 - (top - bot)) < 1e-9);
  assert.ok(t.tb5 > t.tbH);
});

test('dayTb: a day with an incomplete hour or fewer than 23 hours is not a full day', () => {
  const rows = day('2026-01-03'); rows[3][1] = rows[3][1].slice(0, 6);
  assert.equal(dayTb(intraHours(rows), 4), null);
  assert.equal(dayTb(intraHours(day('2026-01-04').slice(0, 20)), 4), null);
  // The spring-forward day holds 23 complete hours and counts.
  assert.ok(dayTb(intraHours(day('2026-03-08').filter((_, i) => i !== 2)), 4));
});

test('intraSummary: counts, std, range quantiles, threshold counts and the TB uplift', () => {
  const s = intraSummary([...day('2026-01-02'), ...day('2026-06-02', 17)], { thr: 200, dur: 4 });
  assert.equal(s.hours, 48); assert.equal(s.intervals, 576);
  assert.equal(s.above5, 2);            // two 5-minute intervals at $500
  assert.equal(s.aboveH, 0);            // no hourly mean above $200
  assert.equal(s.hoursWithSpike, 2);
  assert.ok(s.sd5 > s.sdH);
  assert.equal(s.range.max, 500 - 37);   // the June spike sits on hour 17 (base $37)
  assert.equal(s.days, 2);
  assert.ok(s.uplift > 0 && Math.abs(s.uplift - (s.tb5 - s.tbH)) < 1e-9);
  assert.ok(Math.abs(s.upliftPct - (100 * s.uplift) / s.tbH) < 1e-9);
  assert.deepEqual(s.byMonth.map(m => [m.m, m.above5]), [[1, 1], [2, null], [3, null], [4, null], [5, null], [6, 1]]);
  assert.equal(s.meanAbsDev > 0, true);
});

test('intraSummary: empty input returns nulls, not zeros', () => {
  const s = intraSummary([], { thr: 100, dur: 4 });
  assert.equal(s.hours, 0); assert.equal(s.tb5, null); assert.equal(s.uplift, null); assert.equal(s.sd5, null);
});

test('heldMonths: names the months held and the months missing inside the span', () => {
  const m = heldMonths(intraHours([...day('2026-01-02'), ...day('2026-03-02'), ...day('2026-06-02')]));
  assert.deepEqual(m.held, ['Jan', 'Mar', 'Jun']); assert.deepEqual(m.missing, ['Feb', 'Apr', 'May']);
});
