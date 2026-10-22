// Studio-parity URL contract: the preview reads and writes the live Studio's hash vocabulary, so a live link opens the
// same project, option, stage, depth, case, horizon, history year, compare set and pins here (and back).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStudioHash, toStudioHash, fuelToStudio, fuelFromStudio, caseScenario, hzRun, liveStudioUrl, CASE_KEYS } from '../studiohash.js';

const LIVE = 'v=stage&stage=market&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&cmp=o1,o2&pins=111403,100178';

test('parses the live Studio URL from Ganesh’s message', () => {
  const h = parseStudioHash(`#${LIVE}`);
  assert.equal(h.view, 'stage'); assert.equal(h.stage, 'market');
  assert.equal(h.project, 'kennebec'); assert.equal(h.option, 'o2');
  assert.equal(h.depth, 'review'); assert.equal(h.caseKey, 'sp'); assert.equal(h.hz, 2030); assert.equal(h.hist, 2025);
  assert.deepEqual(h.cmp, ['o1', 'o2']); assert.deepEqual(h.pins, ['111403', '100178']);
  assert.equal(h.tab, null); assert.equal(h.bus, null);
});

test('round-trips the live URL exactly; preview extras (tab, bus, step) follow the live keys', () => {
  assert.equal(toStudioHash(parseStudioHash(LIVE)), LIVE);
  const withTab = `${LIVE}&tab=find&bus=111209&step=3`;
  assert.equal(toStudioHash(parseStudioHash(withTab)), withTab);
});

test('unknown keys are preserved in order; bad values are dropped, not guessed', () => {
  const h = parseStudioHash('stage=grid&depth=deep&case=xx&hz=2031&hist=1999&list=1&block=g-3&foo=bar');
  assert.equal(h.depth, null); assert.equal(h.caseKey, null); assert.equal(h.hz, null); assert.equal(h.hist, null);
  assert.deepEqual(h.extra, [['list', '1'], ['block', 'g-3'], ['foo', 'bar']]);
  assert.equal(toStudioHash(h), 'v=stage&stage=grid&list=1&block=g-3&foo=bar');
});

test('the preview-only legacy hash still parses (stage, tab, bus, depth)', () => {
  const h = parseStudioHash('#stage=prices&tab=shape&bus=111403&depth=study');
  assert.equal(h.stage, 'prices'); assert.equal(h.tab, 'shape'); assert.equal(h.bus, '111403'); assert.equal(h.depth, 'study');
  assert.equal(h.view, null);
});

test('empty lists and missing values are omitted when writing', () => {
  assert.equal(toStudioHash({ view: 'stage', stage: 'decision', depth: 'study', cmp: [], pins: [] }), 'v=stage&stage=decision&depth=study');
  assert.equal(toStudioHash({}), '');
});

test('values are URI-encoded when written and decoded when read', () => {
  const s = toStudioHash({ stage: 'market', extra: [['note', 'a&b c']] });
  assert.equal(s, 'stage=market&note=a%26b%20c');
  assert.deepEqual(parseStudioHash(s).extra, [['note', 'a&b c']]);
});

test('fuel vocabulary: preview ↔ live (bess and dc are the live keys)', () => {
  const pairs = [['solar', 'solar'], ['wind', 'wind'], ['storage', 'bess'], ['hybrid', 'hybrid'], ['datacenter', 'dc']];
  for (const [p, l] of pairs) { assert.equal(fuelToStudio(p), l); assert.equal(fuelFromStudio(l), p); }
  assert.equal(fuelFromStudio('nuclear'), null);
});

test('case keys map to the preview study scenarios; the horizon maps to a held solved run or null', () => {
  assert.deepEqual(CASE_KEYS, ['sp', 'sh', 'll']);
  assert.equal(caseScenario('sp'), 'summer_peak'); assert.equal(caseScenario('sh'), 'shoulder'); assert.equal(caseScenario('ll'), 'large_load');
  assert.equal(caseScenario('zz'), null);
  assert.equal(hzRun(2030), 'pcr2030'); assert.equal(hzRun(2035), 'pcr2035'); assert.equal(hzRun(2040), 'pcr2040');
  assert.equal(hzRun(2045), null, 'the vendor 2045/2050 flat escalation is not held in the unified DB');
});

test('live Studio link: same project, option, stage, depth and basis; pins numeric; preview-only keys dropped', () => {
  const u = liveStudioUrl({ view: 'stage', stage: 'grid', project: 'kennebec', option: 'o1', depth: 'study', caseKey: 'sh', hz: 2035, hist: 2024, cmp: ['o1', 'o3'], pins: ['111403'], tab: 'capacity', bus: '111403', step: 4 });
  assert.equal(u, 'http://127.0.0.1:8103/analytics-tab-studio.html#v=stage&stage=grid&project=kennebec&option=o1&depth=study&case=sh&hz=2035&hist=2024&cmp=o1,o3&pins=111403');
  assert.match(liveStudioUrl({ stage: 'market', pins: ['x', '12'] }), /pins=12$/, 'non-numeric pins cannot exist in the live Studio');
});
