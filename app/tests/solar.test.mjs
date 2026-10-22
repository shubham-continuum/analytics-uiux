import test from 'node:test';
import assert from 'node:assert/strict';
import { clearSky, capture } from '../solar.js';

test('clear-sky shape is zero at night and positive at midday', () => {
  assert.equal(clearSky('2025-06-21T01:00:00-04:00', 42, -71), 0);
  assert.ok(clearSky('2025-06-21T12:00:00-04:00', 42, -71) > 0.8);
  assert.ok(clearSky('2025-12-21T12:00:00-05:00', 42, -71) < clearSky('2025-06-21T12:00:00-04:00', 42, -71));
});

test('missing location gives null, never zero', () => {
  assert.equal(clearSky('2025-06-21T12:00:00', null, -71), null);
});

test('capture of a flat profile equals the time-weighted mean', () => {
  const rows = [10, 20, 30, 40].map((p, i) => ({ timestamp: `2025-01-01T0${i}:00:00`, price: p, dtHours: 1 }));
  const r = capture(rows, () => 1);
  assert.equal(r.capture, 25);
  assert.equal(r.ratio, 1);
});

test('capture weights prices by generation', () => {
  const rows = [{ price: 10, dtHours: 1 }, { price: 50, dtHours: 1 }];
  const r = capture(rows, row => (row.price === 50 ? 1 : 0));
  assert.equal(r.capture, 50);
  assert.equal(r.ratio, 50 / 30);
});

test('no generation gives null capture, never zero', () => {
  const r = capture([{ price: 10, dtHours: 1 }], () => 0);
  assert.equal(r.capture, null);
});
