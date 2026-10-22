// Live-hash corpus (M5, 08-tests): 200 :8103 URLs, expected state generated from the LIVE readHash (the oracle,
// plan/gen_hash_corpus.mjs over the pinned snapshot). One Studio's studiohash.js parse + resolve must open the same
// context for every URL; every place it deliberately differs is a named rule below, applied to the LIVE value.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStudioHash, resolveStudioHash, toStudioHash, LIVE_DEFAULTS, ONE_STAGES, CASE_KEYS, HZ_YEARS } from '../studiohash.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = JSON.parse(readFileSync(path.join(APP, 'tests', 'fixtures', 'hash-corpus.json'), 'utf8'));
const LIVE_IDS = new Set(C.catalogue.busIds);
const LIVE_CAT = { projects: C.catalogue.projects, hasBus: id => LIVE_IDS.has(String(id)) };
// live field → ours (explicit): projectId→project, optionId→option, basis.case→caseKey, basis.horizon→hz,
// basis.histYear→hist, compare→cmp, pins (Number)→pins (String), listView→list, selectedBlock→block. view/stage/depth same.
const FIELDS = ['view', 'stage', 'project', 'option', 'depth', 'caseKey', 'hz', 'hist', 'cmp', 'pins', 'list', 'block'];
const pickF = s => Object.fromEntries(FIELDS.map(k => [k, s[k]]));
const live2ours = e => ({ ...pickF(e), pins: e.pins.map(String) });
const rawOf = (hash, k) => { let v; for (const kv of hash.split('&')) { const i = kv.indexOf('='); if (i > 0 && kv.slice(0, i) === k) v = kv.slice(i + 1); } return v; };

/** The documented differences (M5.md "Intentional differences"), each a transform of the LIVE state. */
const D = LIVE_DEFAULTS;
const RULES = [
  ['D1 stage: a non-stage value keeps the default; "iso" (the live ISO-wide concern) opens Market', (e, h) => {
    if (ONE_STAGES.includes(e.stage)) return null;
    return { stage: e.stage === 'iso' ? 'market' : D.stage }; }],
  ['D2 case: only sp/sh/ll are accepted; live stores any string', e => (CASE_KEYS.includes(e.caseKey) ? null : { caseKey: D.caseKey })],
  ['D3 hz: only 2030/2035/2040/2045/2050; live stores +hz unchecked (2031, NaN)', e => (HZ_YEARS.includes(e.hz) ? null : { hz: D.hz })],
  ['D4 hist: only 2020–2026; live stores +hist unchecked', e => (Number.isInteger(e.hist) && e.hist >= 2020 && e.hist <= 2026 ? null : { hist: D.hist })],
  ['D5 pins: a pin set: duplicates dropped (first kept), only plain digit ids (live Number() also takes "111403.0"), then the first five', (e, h) => {
    const raw = rawOf(h, 'pins'); if (raw == null) return null;
    const tok = raw.split(',').filter(Boolean);
    if (new Set(tok).size === tok.length && tok.every(t => /^\d+$/.test(t))) return null;
    const out = [];
    for (const t of tok) { if (!/^\d+$/.test(t)) continue; const id = String(Number(t)); if (LIVE_IDS.has(id) && !out.includes(id)) out.push(id); }
    return { pins: out.slice(0, 5) }; }],
  ['D6 cmp: duplicates dropped (first kept)', e => (new Set(e.cmp).size === e.cmp.length ? null : { cmp: [...new Set(e.cmp)] })],
  ['D7 a value containing "=" is kept whole (live keeps the text before the second "=")', (e, h) => {
    const b = rawOf(h, 'block'); return b && b.includes('=') ? { block: b } : null; }],
];
function intended(c) {
  // D8 percent-encoding: ours decodes (a copied link often arrives as %2C); live does not. The oracle recorded the decoded
  // form's live state too, so the intended value is still the live reader's.
  const decoded = !!c.expectedDecoded;
  const base = live2ours(decoded ? c.expectedDecoded : c.expected);
  const hash = decoded ? c.hash.split('&').map(kv => kv.split('=').map(decodeURIComponent).join('=')).join('&') : c.hash;
  const applied = decoded ? ['D8 percent-encoded values are decoded'] : [];
  let s = base;
  for (const [name, f] of RULES) { const p = f(s, hash); if (p) { s = { ...s, ...p }; applied.push(name); } }
  return { s, applied };
}

test('corpus header: generated from the pinned live snapshot, 200 cases, the live defaults are ours', () => {
  const snap = readFileSync(path.resolve(APP, '..', C.source.app_js), 'utf8');
  assert.equal(createHash('sha256').update(snap).digest('hex'), C.source.app_js_sha256, 'fixture is stale: regenerate with node plan/gen_hash_corpus.mjs');
  assert.ok(snap.includes(C.source.readHash), 'the recorded readHash is the snapshot text');
  assert.equal(C.cases.length, 200);
  assert.deepEqual(pickF(LIVE_DEFAULTS), C.liveDefaults);
  assert.ok(C.cases.some(c => c.tags.includes('acceptance-1')));
});

const stats = { equal: 0, intended: 0, rules: {} };
for (const c of C.cases) {
  test(`${c.id} ${c.tags.join(',')} #${c.hash.slice(0, 80)}`, () => {
    const ours = pickF(resolveStudioHash(parseStudioHash(`#${c.hash}`), LIVE_CAT));
    const { s, applied } = intended(c);
    assert.deepEqual(ours, s, `rules applied: ${applied.join(' | ') || 'none'}`);
    if (!applied.length) stats.equal++; else { stats.intended++; for (const a of applied) stats.rules[a.slice(0, 2)] = (stats.rules[a.slice(0, 2)] || 0) + 1; }
  });
}

test('the acceptance-1 link opens Grid · kennebec o2 (bus 111209) · Review · 3 pins · cmp o1,o2', () => {
  const c = C.cases.find(x => x.tags.includes('acceptance-1'));
  const r = resolveStudioHash(parseStudioHash(c.hash), LIVE_CAT);
  assert.equal(r.stage, 'grid'); assert.equal(r.project, 'kennebec'); assert.equal(r.option, 'o2'); assert.equal(r.optionBus, '111209');
  assert.equal(r.depth, 'review'); assert.deepEqual(r.pins, ['111403', '100178', '110807']); assert.deepEqual(r.cmp, ['o1', 'o2']);
  assert.deepEqual(r.notices, []);
});

test('One Studio additions: bus preview, notices for what the live app drops silently', () => {
  const conflict = resolveStudioHash(parseStudioHash(C.cases.find(x => x.tags.includes('bus-conflict')).hash), LIVE_CAT);
  assert.equal(conflict.option, 'o2', 'a bus that conflicts with the option keeps the option');
  assert.equal(conflict.bus, '111403'); assert.equal(conflict.optionBus, '111209');
  assert.ok(conflict.notices.includes('bus-preview'));
  const agrees = resolveStudioHash(parseStudioHash(C.cases.find(x => x.tags.includes('bus-agrees')).hash), LIVE_CAT);
  assert.ok(!agrees.notices.includes('bus-preview'));
  const unk = resolveStudioHash(parseStudioHash('project=nope&option=o2'), LIVE_CAT);
  assert.equal(unk.project, 'kennebec'); assert.ok(unk.notices.includes('unknown-project'));
  assert.ok(resolveStudioHash(parseStudioHash('project=kennebec&option=o99'), LIVE_CAT).notices.includes('unknown-option'));
  assert.ok(resolveStudioHash(parseStudioHash('case=xx&hz=2031&hist=1999&stage=foo'), LIVE_CAT).notices.join() === 'unknown-stage,bad-case,bad-hz,bad-hist');
  const six = resolveStudioHash(parseStudioHash('pins=111403,100178,110807,111209,111214,104319'), LIVE_CAT);
  assert.deepEqual(six.pins, ['111403', '100178', '110807', '111209', '111214'], 'six pins: the sixth (last) is dropped, as live');
  assert.ok(six.notices.includes('pins-capped'));
});

test('a hashchange applies over the current state, as live: pins= clears, a missing key keeps', () => {
  const prev = { ...LIVE_DEFAULTS, stage: 'grid', pins: ['111403'], caseKey: 'sh' };
  assert.deepEqual(resolveStudioHash(parseStudioHash('stage=land&pins='), LIVE_CAT, prev).pins, []);
  const kept = resolveStudioHash(parseStudioHash('stage=land&pins'), LIVE_CAT, prev);
  assert.deepEqual(kept.pins, ['111403'], 'a key without "=" is absent in live (q.pins undefined)');
  assert.equal(kept.caseKey, 'sh'); assert.equal(kept.stage, 'land');
});

test('round trip: the written hash re-reads to the same state for every corpus URL', () => {
  for (const c of C.cases) {
    const r = resolveStudioHash(parseStudioHash(c.hash), LIVE_CAT);
    const back = resolveStudioHash(parseStudioHash(toStudioHash({ ...r, live: undefined })), LIVE_CAT);
    assert.deepEqual(pickF(back), pickF(r), c.id);
  }
});

// Catalogue parity (report, not a gate): the same parse+resolve over One Studio's own samples.json. The live seed's
// option ids are global (o1..o12 across four projects); samples.json reuses o1..o3 per project with other buses and has
// no 'merrimack'. Until that is decided (M5.md open issue 1) a live link to those projects opens other buses here.
const SAMPLES = JSON.parse(readFileSync(path.join(APP, 'data', 'samples.json'), 'utf8'));
const ONE_CAT = { projects: SAMPLES.projects.map(p => ({ id: p.id, options: p.options.map(o => ({ id: String(o.id), busId: String(o.busId), status: o.status })) })), hasBus: LIVE_CAT.hasBus };
const cmpBuses = (cat, r) => r.cmp.map(id => cat.projects.flatMap(p => p.options).find(o => o.id === id)?.busId ?? null);
let catSame = 0;
for (const c of C.cases) {
  const h = parseStudioHash(c.hash), a = resolveStudioHash(h, LIVE_CAT), b = resolveStudioHash(h, ONE_CAT);
  if (a.project === b.project && a.optionBus === b.optionBus && JSON.stringify(cmpBuses(LIVE_CAT, a)) === JSON.stringify(cmpBuses(ONE_CAT, b))) catSame++;
}
test(`catalogue parity: ${catSame}/200 links open the same project, option bus and compare buses with samples.json`, { todo: catSame < 200 ? 'samples.json vs the live seed (M5.md open issue 1)' : false }, () => {
  assert.equal(catSame, 200);
});

test('summary', t => {
  t.diagnostic(`corpus: ${stats.equal}/200 equal to live as-is; ${stats.intended}/200 equal after documented rules ${JSON.stringify(stats.rules)}`);
  assert.equal(stats.equal + stats.intended, 200);
});
