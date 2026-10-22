// Direct labels at line ends: 2–4 series only, spaced so they never overlap, clamped inside the plot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels } from '../charts.js';

test('converging ends are pushed apart by at least the line height and stay within the plot', () => {
  const out = placeLabels([{ y: 100 }, { y: 101 }, { y: 102 }], 20, 200, 12);
  const ys = out.map(o => o.ly).sort((a, b) => a - b);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 12 - 1e-9);
  assert.ok(ys[0] >= 20 && ys.at(-1) <= 200);
});
test('labels near the bottom are pushed up, never below the plot', () => {
  const out = placeLabels([{ y: 199 }, { y: 200 }], 20, 200, 12);
  assert.ok(Math.max(...out.map(o => o.ly)) <= 200);
});
test('well-separated labels stay where their line ends', () => {
  const out = placeLabels([{ y: 40 }, { y: 150 }], 20, 200, 12);
  assert.deepEqual(out.map(o => o.ly), [40, 150]);
});
