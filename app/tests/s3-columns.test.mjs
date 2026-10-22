// S3: the queue grid columns (columns/queue.js) read the same engine functions as the Queue cards (one home).
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S3) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { queueColumns } from '../columns/queue.js';
import { queueInputs } from '../queuecore.js';
import { queueCash, clusterDeadline } from '../rules/isone.js';

const S0 = { tech: 'solar', exportMW: 150, importMW: 0, ui: { land: { control: 100 } } };
const row = { n: { bus_id: 111209 } };
const cols = st => Object.fromEntries(queueColumns(() => st).map(c => [c.label, c]));

test('two columns, in the vendored grid registry shape, family "Queue & system"', () => {
  const defs = queueColumns(() => S0);
  assert.deepEqual(defs.map(c => c.label), ['Entry cash', 'Cluster deadline']);
  for (const c of defs) {
    for (const k of ['id', 'key', 'label', 'unit', 'family', 'source', 'type', 'dp', 'sort', 'fuels', 'hideFor', 'get', 'why', 'hint']) assert.ok(k in c, `${c.label}: ${k}`);
    assert.equal(c.family, 'Queue & system');
    assert.deepEqual(c.hideFor, ['dc']);
  }
});

test('queueInputs maps the store: size by fuel, Land site control, service, flags, profile', () => {
  const q = queueInputs({ ...S0, ui: { land: { control: 95 }, qService: 'NRIS', qRegLimit: true, qNrisHeld: true, qProfile: 'proforma', qStart: '2026-11-19', qRestudy: true, qFac: 'waived' } });
  assert.deepEqual(q, { mw: 150, tech: 'solar', profile: 'proforma', service: 'NRIS', nrisHeld: true, regulatoryLimitation: true, sitePct: 95, windowClose: '2026-11-19', restudy: true, facilities: 'waived' });
  assert.equal(queueInputs({ tech: 'solar', exportMW: 50, ui: {} }).sitePct, null, 'no Land entry → not held, never assumed');
  assert.equal(queueInputs({ tech: 'solar', exportMW: 50, ui: { qLongFac: true } }).facilities, 180);
});

test('Entry cash = the engine\'s queue cash (150 MW, site control 100%): $300k; same value as the card function', () => {
  const c = cols(S0)['Entry cash'];
  assert.equal(c.get(row), 300000);
  assert.equal(c.get(row), queueCash(queueInputs(S0)).value);
  assert.match(c.hint, /Sched 22 §3\.4\.1\.1/);
});

test('F016 in the grid: Land not held → the cell is empty with "blocked: site control not held", never $300k', () => {
  const st = { ...S0, ui: {} };
  const c = cols(st)['Entry cash'];
  assert.equal(c.get(row), null);
  assert.equal(c.why(row), 'blocked: site control not held');
});

test('Cluster deadline = the engine\'s Cluster Study Report deadline (2026-11-19 close → 2027-10-15)', () => {
  const c = cols(S0)['Cluster deadline'];
  assert.equal(c.get(row), '2027-10-15');
  assert.equal(c.get(row), clusterDeadline(queueInputs(S0)).value);
  assert.match(c.hint, /Sched 22 §7\.4/);
  const bad = cols({ ...S0, ui: { qStart: 'nope' } })['Cluster deadline'];
  assert.equal(bad.get(row), null); assert.match(bad.why(row), /not held/);
});

test('a data centre has no generator entry cash (not applicable, with the reason)', () => {
  const c = cols({ tech: 'datacenter', importMW: 300, ui: { land: { control: 100 } } })['Entry cash'];
  assert.equal(c.get(row), null); assert.match(c.why(row), /load/);
});
