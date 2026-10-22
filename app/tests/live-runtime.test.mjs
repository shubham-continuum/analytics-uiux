// live-runtime.js (lift plan 14 · L2): the vendored live GS model + Charts load ONCE into the ONE window.GS / window.App
// the live-bridge shim made, merge-only; GS.catalog comes from the pinned data.js extract, labelled with its vintage.
// Provenance: Claude Opus 5.5 (builder R-runtime) · one-studio/design 14-lift (slice L2) · 2026-10-13 · sign-off pending · v1
// The browser's <script src> is emulated with node:vm on a context whose global IS the fake window (so `window.GS = …`
// and a bare `GS` resolve as they do in a page); fetch reads vendor/live from disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createBridge } from '../live-bridge.js';
import { bootLiveRuntime, mergeInto, vintageOf, RUNTIME_FILES } from '../live-runtime.js';

const APP = new URL('..', import.meta.url);
const PIN11 = new URL('../app-tools/live-snapshot/2026-10-11/', APP);
const sha256 = b => createHash('sha256').update(b).digest('hex');

function shimWindow() {
  const S = { tech: 'solar', exportMW: 100, importMW: 0, caseKey: 'sp', pins: [], ui: {} };
  const host = { getState: () => S, getData: () => ({}), project: () => null, dispatch() {}, render() {}, toast() {}, candidateGates: () => null };
  const b = createBridge({ meta: {}, groups: { identity: { cols: ['bus_id'], rows: [] } }, market: { nodes: [], grid: { headroom: [], constraints: [] } }, measures: { buses: {} }, curtail: { cols: [], rows: [] }, land: {} }, host);
  const win = { GS: b.GS, App: b.App, GS_DATA_EXT: b.EXT };
  win.window = win; vm.createContext(win);
  return win;
}
function diskIO(win, calls = []) {
  return {
    calls,
    loadScript: async src => { calls.push(src); vm.runInContext(readFileSync(new URL(src, APP), 'utf8'), win, { filename: src }); },
    fetchJson: async src => { calls.push(src); return JSON.parse(readFileSync(new URL(src, APP), 'utf8')); },
  };
}
/** The pinned code's OWN derivation: the GS section cut from the pinned src/app.js (hash-checked), run on the pinned data.js. */
function pinnedGS() {
  const sums = Object.fromEntries(readFileSync(new URL('SHA256SUMS.txt', PIN11), 'utf8').trim().split('\n').map(l => { const [h, p] = l.trim().split(/\s+\*?/); return [p.replace(/^\*?\.\//, ''), h]; }));
  const app = readFileSync(new URL('src/app.js', PIN11)), data = readFileSync(new URL('src/data.js', PIN11));
  assert.equal(sha256(app), sums['src/app.js']); assert.equal(sha256(data), sums['src/data.js']);
  const lines = app.toString('utf8').split('\n');
  const a = lines.findIndex(l => l.startsWith('window.GS = (function () {')), b = lines.findIndex(l => l.startsWith('   GridSense Analytics — chart renderers (Charts).'));
  assert.ok(a > 0 && b > a);
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(data.toString('utf8'), ctx); vm.runInContext(lines.slice(a, b - 1).join('\n'), ctx);
  return ctx.GS;
}

test('mergeInto: adds what is missing, never replaces an existing member (getters not invoked), lists conflicts', () => {
  let reads = 0;
  const t = { a: 1, f() { return 'shim'; }, get g() { reads++; return 'getter'; } }, before = Object.getOwnPropertyDescriptors(t);
  const r = mergeInto(t, { a: 2, f() { return 'vendored'; }, g: 3, b: 4, c: null });
  assert.deepEqual(r, { added: ['b', 'c'], conflicts: ['a', 'f', 'g'] });
  assert.equal(t.a, 1); assert.equal(t.f(), 'shim'); assert.equal(t.b, 4); assert.equal(t.c, null);
  for (const k of ['a', 'f']) assert.equal(t[k], before[k].value);
  assert.equal(Object.getOwnPropertyDescriptor(t, 'g').get, before.g.get); assert.equal(reads, 0, 'merge never reads a getter');
});

test('boot: loads data, GS model and Charts once; window.GS / window.App stay the shim objects, no shim member overwritten', async () => {
  const win = shimWindow(), GS0 = win.GS, App0 = win.App;
  const gsBefore = Object.getOwnPropertyDescriptors(GS0), appBefore = Object.getOwnPropertyDescriptors(App0);
  const io = diskIO(win);
  const p1 = bootLiveRuntime(win, io), p2 = bootLiveRuntime(win, io);
  assert.equal(p1, p2, 'second call returns the same load');
  const rt = await p1;
  assert.deepEqual(io.calls.filter(c => /app-(gs-model|charts)\.js$/.test(c)).length, 2, 'two scripts, once each');
  assert.equal(io.calls.filter(c => c.endsWith('app-data.json')).length, 1, 'data fetched once');
  assert.deepEqual(RUNTIME_FILES, { data: 'vendor/live/app-data.json', model: 'vendor/live/app-gs-model.js', charts: 'vendor/live/app-charts.js', manifest: 'vendor/live/MANIFEST.json' });
  assert.equal(win.GS, GS0, 'one window.GS'); assert.equal(win.App, App0, 'one window.App');
  for (const [k, d] of Object.entries(gsBefore)) {
    const now = Object.getOwnPropertyDescriptor(win.GS, k);
    if ('value' in d) assert.equal(now.value, d.value, `GS.${k} kept`); else assert.equal(now.get, d.get, `GS.${k} getter kept`);
  }
  for (const [k, d] of Object.entries(appBefore)) { const now = Object.getOwnPropertyDescriptor(win.App, k); assert.equal(now.value ?? now.get, d.value ?? d.get, `App.${k} kept`); }
  // the conflicts are exactly the shim members the vendored model also defines
  const model = rt.model, shimKeys = Object.keys(gsBefore);
  assert.deepEqual(rt.conflicts.GS, Object.keys(model).filter(k => shimKeys.includes(k)).sort());
  for (const k of ['nodes', 'node', 'fmt', 'FUELS']) assert.ok(rt.conflicts.GS.includes(k), `${k} is a conflict (the shim's wins)`);
  for (const k of ['catalog', 'resolve', 'templateOf', 'stat', 'truths']) { assert.ok(rt.added.GS.includes(k), `${k} added`); assert.equal(win.GS[k], model[k]); }
  assert.equal(win.GS.liveRuntime, rt, 'status on GS.liveRuntime');
  assert.ok(win.Charts && typeof win.Charts.bars === 'function' && typeof win.Charts.line === 'function', 'window.Charts from the vendored renderers');
  assert.deepEqual(rt.conflicts.Charts, []);
  assert.equal('GS_DATA' in win, false, 'no window.GS_DATA global: the extract lives on the model only');
  assert.equal(Object.getOwnPropertyDescriptor(win, 'GS').value, GS0, 'the capture trap was removed');
});

test('GS.catalog: the pinned data.js 453-column extract, family count = the pinned code\'s own derivation, labelled with its vintage', async () => {
  const win = shimWindow(), rt = await bootLiveRuntime(win, diskIO(win));
  const D = rt.model.D, live = pinnedGS();
  assert.equal(D.columns.length, 453); assert.equal(rt.catalogMeta.columns, 453);
  assert.equal(win.GS.catalog.length, live.catalog.length, 'family count');
  const fams = c => JSON.stringify(c.map(F => [F.fam, F.templates.length, F.cols])); // JSON: the two vm realms' arrays differ in prototype only
  assert.equal(fams(win.GS.catalog), fams(live.catalog));
  assert.equal(rt.catalogMeta.families, live.catalog.length);
  const idCols = D.columns.filter(c => /^(Substation |FIPS|County|State|Longitude|Latitude|bus_id|Confidence level)/.test(c)).length;
  assert.equal(win.GS.catalog.reduce((s, F) => s + F.cols, 0) + idCols, 453, 'every column is in a family or is an identity column');
  const v = vintageOf(D.meta);
  assert.equal(v, `${D.meta.source} · extract built ${D.meta.built_at}`);
  assert.match(v, /ISONE_GridSense\.duckdb/);
  assert.equal(win.GS.catalog.vintage, v); assert.equal(rt.catalogMeta.vintage, v);
  assert.equal(rt.catalogMeta.pin, '2026-10-11'); assert.equal(rt.catalogMeta.source, 'src/data.js');
  assert.ok(!Object.keys(win.GS.catalog).includes('vintage'), 'vintage is not an enumerable family');
});

test('the vendored price helpers read the merged shim (one price basis), not the old sheet', async () => {
  const win = shimWindow(), rt = await bootLiveRuntime(win, diskIO(win));
  let asked = null; const n = rt.model.nodes[0];
  win.GS.priceAt = (node, y) => { asked = [node, y]; return { value: 42, year: y }; }; // stand-in for the shim's engine price
  assert.deepEqual(win.GS.pxAt(n, 2035), { value: 42, year: 2035 }); assert.deepEqual(asked, [n, 2035]);
});

test('a failed load leaves window.GS the shim, adds nothing, and the error names the file', async () => {
  const win = shimWindow(), GS0 = win.GS, keys = Object.keys(GS0).sort();
  const io = { loadScript: async src => { if (src.endsWith('app-gs-model.js')) throw new Error(`could not load ${src}`); }, fetchJson: diskIO(win).fetchJson };
  await assert.rejects(bootLiveRuntime(win, io), /app-gs-model\.js/);
  assert.equal(Object.getOwnPropertyDescriptor(win, 'GS').value, GS0); assert.deepEqual(Object.keys(win.GS).sort(), keys);
  const io2 = { loadScript: async () => {}, fetchJson: diskIO(win).fetchJson }; // script ran but never set window.GS
  await assert.rejects(bootLiveRuntime(win, io2), /did not define window\.GS/);
});
