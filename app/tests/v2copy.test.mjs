// v8 copy layer: Workflow-v2 §10.2 lean names, every stage and tab covered, no hand-typed numbers in copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_Q, TAB_NAME, TAB_Q, VERDICT, verdictLine, tabName } from '../v2copy.js';

const TABS = { market: ['find', 'rank', 'size', 'regions'], land: ['area', 'footprint', 'corridor', 'permits'], grid: ['capacity', 'constraints', 'cost', 'mitigation'], queue: ['cluster', 'schedule', 'cash', 'changes'], prices: ['lmp', 'basis', 'shape', 'tails'], economics: ['revenue', 'bess', 'hybrid', 'finance'], decision: ['compare', 'stress', 'readiness', 'record'] };

test('every stage has its lean question and every tab a lean name and a one-line question', () => {
  assert.equal(STAGE_Q.grid, 'Can it connect?'); assert.equal(STAGE_Q.decision, 'Go or no-go?');
  for (const [st, tabs] of Object.entries(TABS)) {
    assert.ok(STAGE_Q[st], st);
    for (const t of tabs) { assert.ok(TAB_NAME[st]?.[t], `${st}/${t} name`); assert.ok(TAB_Q[st]?.[t], `${st}/${t} question`); }
  }
  assert.equal(TAB_NAME.grid.capacity, 'Limit'); assert.equal(TAB_NAME.economics.finance, 'Return');
});

test('copy never carries a number (numbers come from the data, never the copy)', () => {
  const all = [...Object.values(STAGE_Q), ...Object.values(TAB_NAME).flatMap(Object.values), ...Object.values(TAB_Q).flatMap(Object.values)];
  for (const s of all) assert.ok(!/\d/.test(s), s);
});

test('tab names follow the technology: storage revenue is "Battery value"; a fuel-specific view label wins', () => {
  assert.equal(tabName('economics', 'revenue', 'storage'), 'Battery value');
  assert.equal(tabName('economics', 'revenue', 'solar'), 'Revenue');
  assert.equal(tabName('grid', 'capacity', 'solar', 'Connection capacity'), 'Limit', 'the default view label maps to the lean name');
  assert.equal(tabName('prices', 'shape', 'datacenter', 'Load cost & bill shape'), 'Load cost & bill shape', 'a fuel-specific label is kept');
});

test('one verdict vocabulary: Pass · Open · Fail; all three counts always printed, Fail first (F001; S2-GD #6)', () => {
  assert.deepEqual(Object.keys(VERDICT), ['Pass', 'Open', 'Fail']);
  assert.equal(verdictLine({ pass: 0, hold: 5, fail: 1 }), '1 Fail · 5 Open · 0 Pass (of 6)');
  assert.equal(verdictLine({ pass: 2, hold: 0, fail: 0 }), '0 Fail · 0 Open · 2 Pass (of 2)', 'a zero Fail count is printed, never folded away');
  assert.equal(verdictLine({ pass: 1, hold: 1, fail: 0 }), '0 Fail · 1 Open · 1 Pass (of 2)');
  assert.equal(verdictLine({}), '0 Fail · 0 Open · 0 Pass (of 0)');
});
