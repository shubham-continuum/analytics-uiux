import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applicableCases, elementLimit, caseTable, binding, stepCost, stepCostAll, stepCostService, loadingBasis, recomputeTransfer, loadingAt, costOf } from '../gridrules.js';

const grid = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url))).grid;

test('storage charging is studied at shoulder only, never summer-peak charge', () => {
  assert.deepEqual(applicableCases('storage').import, ['shoulder|charge']);
  assert.ok(!applicableCases('hybrid').import.includes('summer_peak|charge'));
});

test('data centre import uses large-load and summer-peak charge', () => {
  assert.deepEqual(applicableCases('datacenter').import.sort(), ['large_load|charge', 'summer_peak|charge']);
});

test('Mashpee summer-peak export: element limit 152.8 MW governs over envelope 260.4 MW', () => {
  const el = elementLimit(grid, 111403, 'summer_peak|discharge');
  assert.equal(el.status, 'held');
  assert.equal(el.limit, 152.8);
  const t = caseTable(grid, 111403, 'solar', 100, 0);
  const sp = t.find(r => r.key === 'summer_peak|discharge');
  assert.equal(sp.envelope, 260.4);
  assert.equal(sp.governing, 152.8);
  assert.equal(sp.disagree, true);
  assert.equal(sp.status, 'Fits');
});

test('shoulder-discharge element rows are never used (store mislabel)', () => {
  assert.equal(elementLimit(grid, 111403, 'shoulder|discharge').status, 'mislabel');
});

test('"No Violations found" without a published tested maximum is Hold, never an unbounded pass', () => {
  const el = elementLimit(grid, 114417, 'summer_peak|discharge');
  assert.equal(el.status, 'noViolation');
  assert.equal(stepCost(grid, 114417, 'summer_peak|discharge', 2000).total, null);
  const t = caseTable(grid, 114417, 'solar', 2000, 0);
  assert.equal(t.find(r => r.key === 'summer_peak|discharge').status, 'Hold');
});

test('cost above a case with no element data is a lower bound, not a complete figure (N1)', () => {
  const c = stepCostAll(grid, 111403, 'solar', 300, 'export');
  assert.equal(c.status, 'Lower bound');
  assert.ok(c.gaps.some(g => g.key === 'shoulder|discharge'));
  assert.ok(c.total > 0);
});

test('below the element limits but with an envelope-only case: "no upgrades indicated", never a true zero (review H3)', () => {
  const c = stepCostAll(grid, 111403, 'solar', 150, 'export');
  assert.equal(c.status, 'No upgrades indicated');
  assert.ok(c.unverified.some(u => u.key === 'shoulder|discharge'));
  assert.equal(c.total, 0);
});

test('storage cost includes the charge case: 111403 at 100/100 MW is a lower bound (shoulder charge 99.2 MW)', () => {
  const c = stepCostService(grid, 111403, 'storage', 100, 100);
  assert.equal(c.status, 'Lower bound');
  assert.ok(c.gaps.some(g => g.key === 'shoulder|charge'));
});

test('a no-violation case without a tested maximum is never a silent true zero', () => {
  const c = stepCostAll(grid, 114417, 'solar', 100, 'export');
  assert.notEqual(c.status, 'True zero');
});

test('data-centre cost unions the large-load and summer-peak charge cases (review H5)', () => {
  const g = { headroom: [], constraints: [
    { bus_id: 1, scenario: 'large_load', direction: 'charge', monitored_facility: 'A', transfer_mw: 300, dfax: 0.5, contingency_id: 7, contingency_flow_mw: 10, rating_c_mva: 160, fix_cost_musd: 4, length_miles: 3 },
    { bus_id: 1, scenario: 'summer_peak', direction: 'charge', monitored_facility: 'B', transfer_mw: 80, dfax: 0.5, contingency_id: 7, contingency_flow_mw: 60, rating_c_mva: 100, fix_cost_musd: 9, length_miles: 5 }] };
  const c = stepCostAll(g, 1, 'datacenter', 150, 'import');
  assert.deepEqual(c.items.map(i => i.label).sort(), ['B']);
  assert.equal(c.total, 9);
  assert.equal(c.status, 'Priced');
});

test('request above the element limit does not fit; binding reports it', () => {
  const t = caseTable(grid, 111403, 'solar', 250, 0);
  assert.equal(t.find(r => r.key === 'summer_peak|discharge').status, 'Does not fit');
  assert.equal(binding(t, 'export').status, 'Does not fit');
});

test('step cost at 250 MW charges the facility that overloads below 250 MW (2.94 $M)', () => {
  const c = stepCost(grid, 111403, 'summer_peak|discharge', 250);
  assert.equal(c.items.length, 1);
  assert.equal(c.total, 2.94);
  assert.equal(stepCost(grid, 111403, 'summer_peak|discharge', 150).total, 0);
});

test('missing request is "Not requested", never a pass or zero margin', () => {
  const t = caseTable(grid, 111403, 'solar', 0, 0);
  assert.ok(t.every(r => r.status === 'Not requested' && r.margin === null));
});

// ---------- all-bus review (2026-09-29) ----------
const row = o => ({ bus_id: 9, scenario: 'summer_peak', direction: 'discharge', monitored_facility: 'F', dfax: 0.5, contingency_id: 3, contingency_flow_mw: 80, base_flow_mw: 60, rating_a_mva: 90, rating_c_mva: 100, transfer_mw: 40, fix_cost_musd: 2, length_miles: 4, ...o });

test('base-case rows use rate A with base flow; contingency rows use rate C with contingency flow (review H1)', () => {
  const base = row({ contingency_id: 0, contingency_flow_mw: null, transfer_mw: 60 });
  assert.deepEqual([loadingBasis(base).rate, loadingBasis(base).flow, loadingBasis(base).rating], ['A', 60, 90]);
  assert.equal(recomputeTransfer(base), (90 - 60) / 0.5);
  assert.equal(recomputeTransfer(row()), (100 - 80) / 0.5);
  assert.ok(Math.abs(loadingAt(base, 60) - 100) < 1e-9);
});

test('loading is a magnitude: counter-flow never shows a negative loading (review L9)', () => {
  assert.equal(loadingAt(row({ contingency_flow_mw: -150 }), 0), 150);
});

test('a $0 cost on a zero-length facility is not held, never a real $0 (review H2)', () => {
  assert.equal(costOf(row({ fix_cost_musd: 0, length_miles: 0 })), null);
  assert.equal(costOf(row({ fix_cost_musd: 0, length_miles: null })), null);
  assert.equal(costOf(row({ fix_cost_musd: 1.5, length_miles: 0 })), 1.5);
  const g = { headroom: [], constraints: [row({ fix_cost_musd: 0, length_miles: 0 })] };
  const c = stepCost(g, 9, 'summer_peak|discharge', 100);
  assert.equal(c.status, 'Partly priced');
  assert.equal(c.unpriced, 1);
});

test('a case whose rows are all pre-existing makes the cost a lower bound, matching capacity Hold (review H4)', () => {
  const g = { headroom: [{ bus_id: 9, scenario: 'summer_peak', direction: 'discharge', headroom_mw: 500 }, { bus_id: 9, scenario: 'shoulder', direction: 'discharge', headroom_mw: 500 }],
    constraints: [row({ pct_loading_no_transfer: 120, transfer_mw: -5 })] };
  assert.equal(binding(caseTable(g, 9, 'solar', 100, 0), 'export').status, 'Hold');
  assert.equal(stepCostAll(g, 9, 'solar', 100, 'export').status, 'Lower bound');
});

test('a true zero needs element evidence in every costed case', () => {
  const g = { headroom: [], constraints: [
    row({ scenario: 'large_load', direction: 'charge', transfer_mw: 400 }), row({ scenario: 'summer_peak', direction: 'charge', transfer_mw: 500 })] };
  assert.equal(stepCostAll(g, 9, 'datacenter', 100, 'import').status, 'True zero');
});

test('a no-violations case with the envelope below the request binds (lower bound), matching capacity Hold (re-review R1)', () => {
  const g = { headroom: [{ bus_id: 9, scenario: 'large_load', direction: 'charge', headroom_mw: 100 }],
    constraints: [row({ scenario: 'large_load', direction: 'charge', monitored_facility: 'No Violations found' }), row({ scenario: 'summer_peak', direction: 'charge', transfer_mw: 500 })] };
  assert.equal(stepCostAll(g, 9, 'datacenter', 150, 'import').status, 'Lower bound');
  assert.equal(stepCostAll(g, 9, 'datacenter', 80, 'import').status, 'No upgrades indicated');
});

test('a row already at or beyond −100% before the project is pre-existing (re-review R5)', () => {
  const g = { headroom: [], constraints: [row({ pct_loading_no_transfer: -104, transfer_mw: 30 }), row({ monitored_facility: 'G', transfer_mw: 70 })] };
  assert.equal(elementLimit(g, 9, 'summer_peak|discharge').limit, 70);
});
