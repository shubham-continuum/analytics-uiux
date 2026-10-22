// Shell v5 (Studio parity): hand-off freshness behind the stage dots, provenance chips, selection chips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handoffStates, chipList, selectionChips, CHIP_LABEL } from '../ui.js';

const S0 = { nodeId: '111403', tech: 'solar', exportMW: 100, importMW: 0, handoffs: {}, decisions: [] };

test('no hand-offs: every stage is "none"; Market, Land and Queue never send one', () => {
  const h = handoffStates(S0, 'H1');
  assert.deepEqual(Object.keys(h), ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision']);
  assert.ok(Object.values(h).every(x => x.state === 'none'));
  assert.match(h.market.why, /no hand-off/i);
});

test('a hand-off is current only for this bus and inputs; otherwise stale with the reason', () => {
  const at = '2026-09-30T10:00:00Z';
  const S = { ...S0, handoffs: {
    prices: { busId: '111403', hash: 'H1', at },
    grid: { busId: '111403', tech: 'solar', requestMW: 100, at },
    revenue: { busId: '111403', tech: 'solar', mw: 100, hash: 'H1', at },
  } };
  const h = handoffStates(S, 'H1');
  assert.equal(h.prices.state, 'current'); assert.equal(h.grid.state, 'current'); assert.equal(h.economics.state, 'current');
  const s2 = handoffStates({ ...S, nodeId: '100178' }, 'H1');
  assert.equal(s2.prices.state, 'stale'); assert.match(s2.prices.why, /another bus/);
  const s3 = handoffStates({ ...S, exportMW: 250 }, 'H1');
  assert.equal(s3.grid.state, 'stale'); assert.match(s3.grid.why, /100 MW/);
  const s4 = handoffStates(S, 'H2');
  assert.equal(s4.prices.state, 'stale'); assert.match(s4.prices.why, /basis/);
  assert.equal(s4.economics.state, 'stale');
});

test('the upgrade-cost hand-off lights Grid when the connection limits were not sent; a recorded decision lights Decision', () => {
  const h = handoffStates({ ...S0, handoffs: { cost: { busId: '111403', at: 'x' } }, decisions: [{ at: 'x' }] }, 'H');
  assert.equal(h.grid.state, 'current'); assert.equal(h.decision.state, 'current');
});

test('chip list: known provenance tokens become labelled chips; unknown tokens are ignored', () => {
  assert.deepEqual(chipList('assumption  geo-proxy bogus not-held').map(c => c.key), ['assumption', 'geo-proxy', 'not-held']);
  assert.deepEqual(chipList(''), []); assert.deepEqual(chipList(null), []);
  for (const k of ['studio-copy', 'modelled', 'assumption', 'geo-proxy', 'not-held', 'envelope-only']) assert.ok(CHIP_LABEL[k]);
});

test('selection chips: a sample shows its options (current first-class); without one, the current bus and the pins', () => {
  const p = { options: [{ id: 'o1', label: 'Same-substation price', busId: '111403', busName: 'Mashpee' }, { id: 'o2', label: 'Own price node', busId: '111209', busName: 'Hatchville' }] };
  const a = selectionChips({ ...S0, walk: { project: 'kennebec', option: 'o2' }, ui: { dOpts: ['111403'] } }, p, id => ({ name: `N${id}` }));
  assert.deepEqual(a.map(c => [c.id, c.current, c.compare, c.act]), [['o1', false, true, 'sel-opt'], ['o2', true, true, 'sel-opt']]);
  const b = selectionChips({ ...S0, pins: ['100178', '111403'], ui: {} }, null, id => (id === '100178' ? { name: 'Otis', kv: 115 } : { name: 'Mashpee', kv: 115 }));
  assert.deepEqual(b.map(c => [c.id, c.current, c.act]), [['111403', true, 'node'], ['100178', false, 'node']]);
  assert.equal(b[1].label, 'Otis');
});

test('fuel switch sets the fuel direction (live Studio FUELS): a load imports, storage runs both ways, generators export', async () => {
  const { fuelSizes } = await import('../ui.js');
  assert.deepEqual(fuelSizes('datacenter', 100, 0), { exportMW: 0, importMW: 100 });
  assert.deepEqual(fuelSizes('datacenter', 0, 0), { exportMW: 0, importMW: 250 });
  assert.deepEqual(fuelSizes('storage', 100, 0), { exportMW: 100, importMW: 100 });
  assert.deepEqual(fuelSizes('storage', 0, 300), { exportMW: 300, importMW: 300 });
  assert.deepEqual(fuelSizes('solar', 0, 300), { exportMW: 300, importMW: 0 });
  assert.deepEqual(fuelSizes('wind', 0, 0), { exportMW: 150, importMW: 0 });
  assert.deepEqual(fuelSizes('hybrid', 150, 75), { exportMW: 150, importMW: 75 }, 'a hybrid keeps its charge size');
  assert.deepEqual(fuelSizes('hybrid', 0, 0), { exportMW: 100, importMW: 0 });
});
