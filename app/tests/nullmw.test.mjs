// fixer nullmw: a project size that is not held (null) never reaches Decision or Grid as 0 MW, and the cards say so
// in one phrase: "size not held — set it in Project inputs". Nothing is computed from a missing size (no 0, no 100).
// Provenance: Claude Opus 5.5 (fixer nullmw) · one-studio/design/14-lift-projects-configurator-continuum.md · 2026-10-14 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidateGates, candidateTally, renderDecision, sizeNotHeld, SIZE_NOT_HELD } from '../views/decision.js';
import { renderGrid } from '../views/grid.js';

const rd = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const D = { ...rd('snapshot.json'), queue: rd('queue.json'), land: rd('land.json'), flags: rd('flags.json') };
const basis = { mode: 'historical', market: 'RT', years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false };
const S = (o = {}) => ({ nodeId: '111403', tech: 'solar', exportMW: 100, importMW: 0, basis: { ...basis, nodeId: '111403' }, handoffs: {}, ui: {}, caseKey: 'sp', hz: 2030, pins: [], walk: null, ...o });
const ZERO = /\b(0|null|100) MW\b|÷ 0\b|Request 0|NaN/;

test('sizeNotHeld names the missing required size per technology; a held size (0 for a load\'s export) is never "missing"', () => {
  assert.equal(SIZE_NOT_HELD, 'size not held — set it in Project inputs');
  assert.equal(sizeNotHeld(S({ exportMW: null })), 'Export size');
  assert.equal(sizeNotHeld(S({ tech: 'wind', exportMW: undefined })), 'Export size');
  assert.equal(sizeNotHeld(S({ exportMW: '' })), 'Export size');
  assert.equal(sizeNotHeld(S({ tech: 'datacenter', exportMW: 0, importMW: null })), 'Import / charge size');
  assert.equal(sizeNotHeld(S({ tech: 'datacenter', exportMW: null, importMW: 200 })), null, 'a data centre never needs an export size');
  assert.equal(sizeNotHeld(S({ tech: 'storage', exportMW: 50, importMW: null })), 'Import / charge size');
  assert.equal(sizeNotHeld(S({ tech: 'hybrid', exportMW: 100, importMW: null })), null, 'a hybrid without a battery size is still screenable');
  assert.equal(sizeNotHeld(S()), null);
});

test('Decision: a not-held size shows "size not held — set it in Project inputs" on every tab and computes nothing', () => {
  for (const tab of ['compare', 'stress', 'readiness', 'record']) {
    const html = renderDecision(tab, { data: D, S: S({ exportMW: null }) });
    assert.match(html, /size not held — set it in Project inputs/i, tab);
    assert.doesNotMatch(html, ZERO, tab);
  }
});

test('Decision gates: no verdict is computed from a not-held size (null, never a 0 MW tally)', () => {
  assert.equal(candidateGates(D, S({ exportMW: null })), null);
  assert.equal(candidateTally(D, S({ exportMW: null })), null);
  assert.equal(candidateGates(D, S({ tech: 'datacenter', exportMW: 0, importMW: null })), null);
  assert.ok(Array.isArray(candidateGates(D, S())), 'a held size still gets its gates');
});

test('Grid: a not-held size shows "size not held — set it in Project inputs" on every tab (no SCR ÷ 0, no Request 0, no slider 100)', () => {
  for (const tab of ['capacity', 'constraints', 'cost', 'mitigation']) {
    for (const o of [{ exportMW: null }, { tech: 'datacenter', exportMW: 0, importMW: null }]) {
      const html = renderGrid(tab, { data: D, S: S(o) });
      assert.match(html, /size not held — set it in Project inputs/i, `${tab} ${o.tech || 'solar'}`);
      assert.doesNotMatch(html, ZERO, `${tab} ${o.tech || 'solar'}`);
      assert.doesNotMatch(html, /type="range"/, 'no size slider');
    }
  }
});
