// Percentile strip (the live Studio's "Requirements at bus"): value vs the ISO population, threshold, verdict.
import test from 'node:test';
import assert from 'node:assert/strict';
import { percentileRow, percentileStrip } from '../charts.js';

const pop = Array.from({ length: 101 }, (_, i) => i); // 0..100

test('percentileRow: mid-rank percentile, P5/P50/P95 of the held population, n counts only held values', () => {
  const r = percentileRow(65, [...pop, null, NaN], 50, 'ge');
  assert.equal(r.n, 101); assert.ok(Math.abs(r.pct - 64.85) < 0.1, `pct ${r.pct}`);
  assert.equal(r.p50, 50); assert.equal(r.p5, 5); assert.equal(r.p95, 95);
  assert.equal(r.status, 'met');
});

test('verdicts: ≥ and ≤ against the reference; a missing value or reference is unknown, never met', () => {
  assert.equal(percentileRow(40, pop, 50, 'ge').status, 'not met');
  assert.equal(percentileRow(40, pop, 50, 'le').status, 'met');
  assert.equal(percentileRow(null, pop, 50, 'ge').status, 'unknown');
  assert.equal(percentileRow(40, pop, null, 'ge').status, 'context', 'no reference: shown for context only');
  assert.equal(percentileRow(40, [], 50, 'ge').pct, null, 'no population: no percentile');
});

test('percentileStrip renders one track per row with the band, the reference tick and the value dot; text never colour-only', () => {
  const h = percentileStrip([{ label: 'Injection headroom', unit: 'MW', value: 65, pop, ref: 50, dir: 'ge' }, { label: 'Short-circuit', unit: 'MVA', value: null, pop, ref: null }], { title: 'Requirements' });
  assert.match(h, /class="ps-band"/); assert.match(h, /class="ps-ref"/); assert.match(h, /class="ps-dot ps-met"/);
  assert.match(h, /P65 of 101/); assert.match(h, /ref ≥ 50/); assert.match(h, /Met/); assert.match(h, /not held/);
});
