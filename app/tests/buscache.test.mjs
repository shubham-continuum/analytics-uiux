// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-08 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { evictList, keepSet } from '../buscache.js';

test('nothing is evicted under the cap', () => {
  assert.deepEqual(evictList(['a', 'b', 'c'], new Set(['a']), 12), []);
});
test('the oldest non-kept ids go first, the most recent `max` stay', () => {
  const order = Array.from({ length: 20 }, (_, i) => String(i));
  const out = evictList(order, new Set(['0', '1']), 12);
  assert.deepEqual(out, ['2', '3', '4', '5', '6', '7']); // 18 evictable, keep the 12 most recent
});
test('a kept id is never evicted, however old', () => {
  const order = ['old-pin', ...Array.from({ length: 30 }, (_, i) => `b${i}`)];
  assert.ok(!evictList(order, new Set(['old-pin']), 2).includes('old-pin'));
});
test('keepSet: current, hub, pins, compare set and project option buses', () => {
  const k = keepSet({ nodeId: 111403, pins: ['100178', 110807], ui: { dOpts: ['111209'] } }, ['111348', null]);
  for (const id of ['hub', '111403', '100178', '110807', '111209', '111348']) assert.ok(k.has(id), id);
  assert.equal(k.size, 6);
});
