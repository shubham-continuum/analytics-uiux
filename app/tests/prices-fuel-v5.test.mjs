// Prices v5: the per-series composition helpers the fuel cards read (views/prices-fuel.js), tab labels by fuel and
// provenance chips. Written before the code (TDD). Null = not held, never 0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadYears, windYears, blockYears, priceTabLabel, provenanceChips, typicalShape } from '../views/prices-fuel.js';

const day = (date, prices) => prices.map((p, h) => ({ timestamp: `${date}T${String(h).padStart(2, '0')}:00:00-05:00`, price: p }));
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const set = (rows, o = {}) => ({ kind: 'settled', key: 'RT2025', label: '2025 RT', market: 'RT', year: 2025, rows, stats: null, ...o });

test('priceTabLabel: Shape and Tails are relabelled per fuel; other tabs keep their own label', () => {
  assert.equal(priceTabLabel('shape', 'datacenter'), 'Load cost & bill shape');
  assert.equal(priceTabLabel('shape', 'storage'), 'Shape & cycling');
  assert.equal(priceTabLabel('shape', 'wind'), 'Shape & wind capture');
  assert.equal(priceTabLabel('shape', 'hybrid'), 'Shape, capture & cycling');
  assert.equal(priceTabLabel('shape', 'solar'), 'Shape & capture');
  assert.equal(priceTabLabel('tails', 'datacenter'), 'Tails & scarcity');
  assert.equal(priceTabLabel('tails', 'solar'), null);
  assert.equal(priceTabLabel('lmp', 'datacenter'), null);
});

test('loadYears: per held series, flat-load cost, hours under $20, hours above $X with their bill share and excess, and the 5.21 proxy', () => {
  const rows = [...day('2025-01-01', Array.from({ length: 24 }, (_, h) => (h === 18 ? 300 : h < 4 ? 10 : 40))), ...day('2025-01-02', Array.from({ length: 24 }, () => 40))];
  const stats = { gt200: 1, p95: 120, mean: rows.reduce((t, r) => t + r.price, 0) / rows.length };
  const [r] = loadYears([set(rows, { stats })], 200, 50);
  const total = 4 * 10 + 300 + 43 * 40;
  assert.equal(r.hours, 48);
  close(r.mean, total / 48);
  close(r.perMW, total);
  close(r.perMWyr, (total / 48) * 8760);
  close(r.cost, (total / 48) * 8760 * 50);
  assert.equal(r.cheapHours, 4); close(r.cheapShare, 100 * 4 / 48);
  assert.equal(r.above, 1); close(r.aboveShare, 100 * 300 / total);
  close(r.excess, 300 - total / 48);
  close(r.excessYr, (300 - total / 48) * 8760 / 48);
  close(r.proxy, 1 * (120 - stats.mean));
  // No size: the cost at size is not held, the per-MW figures stay.
  assert.equal(loadYears([set(rows, { stats })], 200, 0)[0].cost, null);
  // A series without stats has no proxy (not held), never 0; an empty series is left out.
  assert.equal(loadYears([set(rows)], 200)[0].proxy, null);
  assert.equal(loadYears([set([])]).length, 0);
});

test('windYears: overnight window P5/P25 and fleet-shape capture per series; model calendars use the typical shape and say so', () => {
  const rows = day('2025-01-01', Array.from({ length: 24 }, (_, h) => h));
  const shape = Object.fromEntries(rows.map((r, h) => [r.timestamp.slice(0, 13), h < 12 ? 2 : 0]));
  const [w] = windYears([set(rows)], shape, null);
  // Window = clock hours 0–6 and 18–23: prices 0..6 and 18..23.
  assert.equal(w.floor.n, 13);
  close(w.floor.p5, 0.6);
  close(w.capture, (0 + 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11) / 12);
  close(w.avg, 11.5); assert.equal(w.matched, 24); assert.equal(w.typical, 0);
  // Model calendar 2030: nothing matches by stamp; the month × hour typical shape fills it.
  const run = day('2030-01-01', Array.from({ length: 24 }, (_, h) => h)).map(r => ({ ...r, timestamp: r.timestamp.slice(0, 19) }));
  const [m] = windYears([set(run, { kind: 'solved', key: '5yr', run: '5yr', year: 2030 })], shape, typicalShape(shape));
  assert.equal(m.matched, 0); assert.equal(m.typical, 24); close(m.capture, w.capture);
  // No shape held: capture not held, the floor still computed.
  const [n] = windYears([set(rows)], null, null);
  assert.equal(n.capture, null); assert.equal(n.ratio, null); assert.equal(n.floor.n, 13);
});

test('blockYears: charge/discharge blocks per series with the share of days each block holds', () => {
  const prices = h => (h >= 16 && h <= 19 ? 100 + h : h >= 1 && h <= 4 ? h : 50);
  const rows = [...day('2025-01-01', Array.from({ length: 24 }, (_, h) => prices(h))), ...day('2025-01-02', Array.from({ length: 24 }, (_, h) => prices(h)))];
  const [b] = blockYears([set(rows)], 4);
  assert.deepEqual(b.discharge, [16, 17, 18, 19]); assert.deepEqual(b.charge, [1, 2, 3, 4]);
  assert.equal(b.days, 2); close(b.dischargePct, 100); close(b.chargePct, 100);
  const [e] = blockYears([set(day('2025-01-01', [1, 2, 3]))], 4);
  assert.equal(e.days, 0); assert.equal(e.dischargePct, null);
});

test('provenanceChips: borrowed settled series → geo-proxy; Studio copy, modelled and assumption tags pass through; unknown tags dropped', () => {
  assert.equal(provenanceChips({ tier: 'geo_proxy', km: 3.2 }), 'geo-proxy');
  // P2 C19: an unnamed 0.01 km geo-proxy is borrowed (only a node at the bus's own substation is not); old '' encoded the defect.
  assert.equal(provenanceChips({ tier: 'geo_proxy', km: 0.01 }), 'geo-proxy');
  assert.equal(provenanceChips({ tier: 'geo_proxy', km: 0.004, pnodeName: 'UN.POWERSVL115 GNRT', busSubstation: 'Powersville' }), '');
  assert.equal(provenanceChips({ tier: 'direct' }, ['modelled', 'assumption', 'bogus']), 'modelled assumption');
  assert.equal(provenanceChips(null, ['studio-copy', 'not-held']), 'studio-copy not-held');
  assert.equal(provenanceChips({ tier: 'geo_proxy', km: 5 }, ['modelled', 'modelled']), 'modelled geo-proxy');
});
