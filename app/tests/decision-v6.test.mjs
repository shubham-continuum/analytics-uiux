// Decision v6: per-option percentile-strip rows on the deciding measures, and the placement summary used in the
// card's answer sentence. Raw only: a profile, never a score.
import test from 'node:test';
import assert from 'node:assert/strict';
import { positionTable, positionStrip } from '../decisioncore.js';
import { percentileRow } from '../charts.js';

const pop = {
  ids: ['a', 'b', 'c', 'd'],
  measures: [
    { key: 'lmp_2030', label: 'Forecast LMP 2030', unit: '$/MWh', higher: true },
    { key: 'tb4', label: 'TB4 spread 2025', unit: '$/MWh', higher: true },
    { key: 'neg', label: 'Negative-price hours 2025', unit: 'hours', higher: false },
  ],
  values: { lmp_2030: [40, 50, 60, null], tb4: [10, 20, 30, 40], neg: [100, 200, 300, 400] },
};

test('positionStrip: one row per measure held in the table; value and population straight from the payload', () => {
  const pos = positionTable(pop, ['b', 'd'], 'solar', ['lmp_2030', 'tb4', 'neg']);
  const s = positionStrip(pos, pop, 1);
  assert.equal(s.rows.length, 3);
  assert.equal(s.rows[0].value, null); // bus d holds no 2030 price: not held, never 0
  assert.deepEqual(s.rows[1].pop, [10, 20, 30, 40]);
  assert.equal(s.rows[1].value, 40);
  // context rows: no reference, so the strip never says Met
  for (const r of s.rows) assert.notEqual(percentileRow(r.value, r.pop, r.ref, r.dir).status, 'met');
});

test('positionStrip summary: better-placed count uses the reading direction; not-held measures are counted apart', () => {
  const pos = positionTable(pop, ['b', 'd'], 'solar', ['lmp_2030', 'tb4', 'neg']);
  const b = positionStrip(pos, pop, 0), d = positionStrip(pos, pop, 1);
  // b: lmp P50 (oriented 50), tb4 P37.5, neg P37.5 → oriented 62.5 (lower is better)
  assert.equal(b.held, 3); assert.equal(b.better, 2); assert.equal(b.notHeld, 0);
  // d: lmp not held; tb4 P87.5 → better; neg P87.5 → oriented 12.5 → worse
  assert.equal(d.held, 2); assert.equal(d.better, 1); assert.equal(d.notHeld, 1);
  assert.equal(d.best.key, 'tb4'); assert.equal(d.worst.key, 'neg');
});

test('positionStrip labels carry the reading direction in words', () => {
  const pos = positionTable(pop, ['a'], 'solar', ['tb4', 'neg']);
  const s = positionStrip(pos, pop, 0);
  assert.match(s.rows[0].label, /higher is better/); assert.match(s.rows[1].label, /lower is better/);
});
