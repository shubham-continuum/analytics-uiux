// Shim inventory (lift plan 14 §2.3, slice L0): every App.* / App.state.* / GS.* / Charts.* member the newly vendored
// lift code reads, against what the ONE live-bridge shim (createBridge → GS, App) provides today.
// Provenance: Claude Opus 5.5 · one-studio/design 14-lift (slice L0) · 2026-10-11 · sign-off pending · v1
// Readers: the dark vendored files (vendor/live/MANIFEST.json loaded:false) except app-gs-model.js (it IS the live GS:
// its own GS reads are self-reads) and app-project-store.ref.js (a reference fragment, ported natively in L1).
// Aliases are resolved per file: `const A = window.App`, `const C = Charts, …`, `const { fmt, stat } = GS`,
// `const S = () => App.state` (S().x reads App.state.x). The members not yet wired are listed in
// tests/shim-expected-missing.json; each later slice (L1–L4) wires its members and deletes them from that list, so the
// test fails on a new gap AND on a stale entry. Regenerate the list (after a review): UPDATE_SHIM_INVENTORY=1 node --test tests/shim-inventory.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createBridge } from '../live-bridge.js';

const APP = new URL('..', import.meta.url);
const MAN = JSON.parse(readFileSync(new URL('vendor/live/MANIFEST.json', APP), 'utf8'));
const NOT_READERS = new Set(['app-gs-model.js', 'app-project-store.ref.js']);
export const READERS = Object.entries(MAN.files).filter(([k, f]) => !f.loaded && k.endsWith('.js') && !NOT_READERS.has(k)).map(([k]) => k).sort();
const ID = '[A-Za-z_$][\\w$]*', OWN = '(?:window\\.|root\\.)?';

/** {App:Set, 'App.state':Set, GS:Set, Charts:Set} of members read in one source text. */
export function membersRead(src) {
  const out = { App: new Set(), 'App.state': new Set(), GS: new Set(), Charts: new Set() };
  const alias = { App: 'App', GS: 'GS', Charts: 'Charts' }, stateFn = [];
  for (const m of src.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(${ID})\\s*=\\s*${OWN}(App|GS|Charts)\\b(?=\\s*(?:[,;\\n]|\\|\\||$))`, 'g'))) alias[m[1]] = m[2]; // whole-object aliases only: `const o = root.App && …` is not one
  for (const m of src.matchAll(new RegExp(`\\b(?:const|let|var)\\s+(${ID})\\s*=\\s*\\(\\)\\s*=>\\s*${OWN}App\\.state\\b(?!\\s*\\.)`, 'g'))) stateFn.push(m[1]);
  for (const m of src.matchAll(new RegExp(`\\{([^{}=]*)\\}\\s*=\\s*${OWN}(App|GS|Charts)\\b(?!\\s*[.(\\[])`, 'g')))
    for (const k of m[1].split(',').map(s => s.trim().split(/\s*:\s*/)[0]).filter(Boolean)) out[m[2]].add(k);
  const names = Object.keys(alias).map(s => s.replace(/\$/g, '\\$')).join('|');
  for (const m of src.matchAll(new RegExp(`(?<![\\w$.])${OWN}(${names})\\.(${ID})(?:\\.(${ID}))?`, 'g'))) {
    const obj = alias[m[1]]; out[obj].add(m[2]);
    if (obj === 'App' && m[2] === 'state' && m[3]) out['App.state'].add(m[3]);
  }
  for (const f of stateFn) for (const m of src.matchAll(new RegExp(`(?<![\\w$.])${f.replace(/\$/g, '\\$')}\\(\\)\\.(${ID})`, 'g'))) out['App.state'].add(m[1]);
  return out;
}

/** What the shim provides: createBridge on empty sources (only the member names matter here). */
function provided() {
  const S = { tech: 'solar', exportMW: 100, importMW: 0, caseKey: 'sp', pins: [], ui: {} };
  const host = { getState: () => S, getData: () => ({}), project: () => null, dispatch() {}, render() {}, toast() {}, candidateGates: () => null };
  const b = createBridge({ meta: {}, groups: { identity: { cols: ['bus_id'], rows: [] } }, market: { nodes: [], grid: { headroom: [], constraints: [] } }, measures: { buses: {} }, curtail: { cols: [], rows: [] }, land: {} }, host);
  const keys = o => new Set(Object.getOwnPropertyNames(o));
  return { App: keys(b.App), 'App.state': keys(b.App.state), GS: keys(b.GS), Charts: new Set() /* One Studio has no window.Charts yet (L2) */ };
}

function inventory() {
  const read = { App: new Set(), 'App.state': new Set(), GS: new Set(), Charts: new Set() }, where = {};
  for (const f of READERS) {
    const r = membersRead(readFileSync(new URL(`vendor/live/${f}`, APP), 'utf8'));
    for (const [o, s] of Object.entries(r)) for (const k of s) { read[o].add(k); (where[`${o}.${k}`] ||= []).push(f); }
  }
  const have = provided(), missing = {};
  for (const o of Object.keys(read)) missing[o] = [...read[o]].filter(k => !have[o].has(k)).sort();
  return { read, missing, where };
}

test('alias resolution: window.App, Charts list, destructuring, App.state accessor', () => {
  const r = membersRead('const o = root.App && root.App.option; o.lo; const A = window.App, x = 1; const C = Charts, H = C.H; const { fmt, stat } = GS; const S = () => App.state;\nA.toast(); C.line(); S().userWidgets; root.GS.priceAt(1); App.state.basis.case; GS.node(1).kv');
  assert.deepEqual([...r.App].sort(), ['option', 'state', 'toast'], 'o.lo is not an App read');
  assert.deepEqual([...r['App.state']].sort(), ['basis', 'userWidgets']);
  assert.deepEqual([...r.GS].sort(), ['fmt', 'node', 'priceAt', 'stat']);
  assert.deepEqual([...r.Charts].sort(), ['H', 'line']);
});

test('readers are the lift files: Configurator, Charts and the Continuum ext modules', () => {
  assert.deepEqual(READERS, ['59-continuum-core.js', '60-cathy.js', '61-hourly-timeline.js', '62-continuum-shape.js', '63-continuum-drivers.js', '64-continuum-value.js', '68-continuum-emissions.js', 'app-charts.js', 'app-configurator.js']);
});

test('shim inventory: what the vendored lift code reads that the live-bridge shim lacks = the expected-missing list', t => {
  const { read, missing, where } = inventory();
  for (const k of ['node', 'priceAt', 'fmt', 'nodes']) assert.ok(read.GS.has(k), `GS.${k} is read by the Continuum`);
  for (const k of ['state', 'option', 'toast', 'render']) assert.ok(read.App.has(k), `App.${k} is read`);
  assert.ok(read.GS.has('catalog') && read.Charts.size > 5, 'the Configurator reads GS.catalog and Charts');
  const report = Object.entries(missing).map(([o, ks]) => `${o}: ${ks.length} missing of ${read[o].size} read${ks.length ? ' — ' + ks.map(k => `${k} (${where[`${o}.${k}`].join(', ')})`).join('; ') : ''}`);
  for (const line of report) t.diagnostic(line);
  const file = new URL('tests/shim-expected-missing.json', APP);
  if (process.env.UPDATE_SHIM_INVENTORY) writeFileSync(file, JSON.stringify({ _about: 'Members the vendored lift code reads that live-bridge.js does not provide yet (tests/shim-inventory.test.mjs). Each slice that wires a member deletes it here; the list must be empty after L4.', ...missing }, null, 1) + '\n');
  const expected = JSON.parse(readFileSync(file, 'utf8'));
  for (const o of Object.keys(missing)) assert.deepEqual(missing[o], [...(expected[o] || [])].sort(), `${o}: shim gap differs from tests/shim-expected-missing.json (new gap, or a wired member still listed)`);
});
