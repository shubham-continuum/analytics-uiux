// views/configurator-host.js (lift plan 14 · L3): the vendored live Graph Configurator, loaded once on the ONE window.GS /
// window.App, reading the pinned data.js extract (labelled with its vintage), and the "My analyses" section per stage.
// Provenance: Claude Opus 5.5 (builder G-configurator) · one-studio/design 14-lift (slice L3) · 2026-10-13 · sign-off pending · v1
// The browser's <script src> is emulated with node:vm on a context whose global IS the fake window (as live-runtime.test).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createBridge } from '../live-bridge.js';
import { bootLiveRuntime } from '../live-runtime.js';
import * as H from '../views/configurator-host.js';

const APP = new URL('..', import.meta.url);
const PIN11 = new URL('../app-tools/live-snapshot/2026-10-11/', APP);
const sha256 = b => createHash('sha256').update(b).digest('hex');
const M = () => JSON.parse(readFileSync(new URL('vendor/live/MANIFEST.json', APP), 'utf8'));

// ---------- vendoring ----------
test('vendor: MANIFEST `configurator` = the pinned src/app.js Configurator section, cut by marker, patched only by F*', () => {
  const sec = M().configurator, src = readFileSync(new URL('src/app.js', PIN11)), lines = src.toString('utf8').split('\n');
  assert.ok(sec, 'MANIFEST.configurator');
  assert.equal(sec.snapshot, '2026-10-11'); assert.equal(sec.dir, 'vendor/live/configurator'); assert.equal(sec.loader, 'views/configurator-host.js');
  const f = sec.files['app-configurator.js'];
  assert.equal(f.source, 'src/app.js'); assert.equal(f.source_sha256, sha256(src));
  const [a, b] = f.lines; assert.ok(a < 5549 && b === lines.length - (lines.at(-1) === '' ? 1 : 0), 'the section holds L5549 to EOF');
  assert.equal(f.section_sha256, sha256(Buffer.from(lines.slice(a - 1, b).join('\n') + '\n', 'utf8')));
  assert.deepEqual(f.patches, ['F1-extract-view', 'F3-configurator-icons']); assert.deepEqual(Object.keys(sec.patches), ['F1-extract-view', 'F2-icons-module', 'F3-configurator-icons']);
  assert.deepEqual(sec.order, ['app-icons.js', 'app-configurator.js'], 'icons load first');
  const body = readFileSync(new URL('vendor/live/configurator/app-configurator.js', APP));
  assert.equal(f.result_sha256, sha256(body));
  const s = body.toString('utf8');
  assert.match(s, /^\/\* VENDORED from live Studio src\/app\.js L\d+-\d+ /);
  assert.match(s, /window\.Configurator = \{ open, asDef, removeWidget, undoRemove/);
  assert.equal(s.split('window.GSX_CFG').length - 1, 1, 'F1 reads the load-time view once');
  assert.match(s, /const ctx = \(\) => \(GSX \? GSX\.ctx\(App\.ctx\(\)\) : App\.ctx\(\)\);/);
  assert.match(s, /const icon = n => \(GSX && GSX\.icon \? GSX\.icon\(n\) : App\.icon\(n\)\);/);
  // the live icon set: ICONS + icon() cut from the shell IIFE (pinned lines), wrapped as one expression (F2)
  const fi = sec.files['app-icons.js'], ib = readFileSync(new URL('vendor/live/configurator/app-icons.js', APP));
  assert.equal(fi.source_sha256, sha256(src)); assert.deepEqual(fi.patches, ['F2-icons-module']); assert.equal(fi.result_sha256, sha256(ib));
  assert.equal(fi.section_sha256, sha256(Buffer.from(lines.slice(fi.lines[0] - 1, fi.lines[1]).join('\n') + '\n', 'utf8')));
  assert.match(ib.toString('utf8'), /window\.GSX_CFG_ICON = \(function \(\) \{[\s\S]*const ICONS = \{[\s\S]*return icon;\r?\n\}\)\(\);\s*$/);
});
test('vendor: only views/configurator-host.js names vendor/live/configurator (it ships dark)', () => {
  const hits = [];
  for (const r of ['.', 'views', 'columns', 'rules', 'studio']) {
    let names; try { names = readdirSync(new URL(`${r}/`, APP)); } catch { continue; }
    for (const n of names) {
      if (!/\.(html|js|mjs|css)$/.test(n)) continue;
      const p = new URL(`${r}/${n}`, APP); if (!statSync(p).isFile()) continue;
      if (readFileSync(p, 'utf8').includes('vendor/live/configurator/') && `${r}/${n}` !== 'views/configurator-host.js') hits.push(`${r}/${n}`);
    }
  }
  assert.deepEqual(hits, []);
  assert.equal(H.CFG_FILES.js, 'vendor/live/configurator/app-configurator.js');
});

// ---------- widget store helpers (pure; never mutate their input) ----------
const W = (id, concern, projectId = '*', name = id) => ({ id, name, concern, projectId, kind: 'chart', chartType: 'column', section: 'ECONOMIC', spec: { yFields: [] }, savedAt: '2026-10-13' });
test('store: widgetList / widgetsFor (stage + this project or every project; all) without mutating', () => {
  assert.deepEqual(H.widgetList({}), []); assert.deepEqual(H.widgetList({ userWidgets: 'x' }), []);
  const list = Object.freeze([W('a', 'grid'), W('b', 'grid', 'p1'), W('c', 'grid', 'p2'), W('d', 'prices'), W('e', null)]);
  assert.deepEqual(H.widgetsFor(list, { stage: 'grid', projectId: 'p1' }).map(u => u.id), ['a', 'b']);
  assert.deepEqual(H.widgetsFor(list, { stage: 'grid', projectId: null }).map(u => u.id), ['a']);
  assert.deepEqual(H.widgetsFor(list, { stage: 'grid', all: true }).map(u => u.id), ['a', 'b', 'c']);
  assert.deepEqual(H.widgetsFor(list, { all: true }).map(u => u.id), ['a', 'b', 'c', 'd', 'e']);
});
test('store: remove / duplicate / update / setProjectOf return the next list, input untouched', () => {
  const list = Object.freeze([W('a', 'grid'), W('b', 'grid', 'p1')].map(Object.freeze)), before = JSON.stringify(list);
  assert.deepEqual(H.removeFrom(list, 'a').map(u => u.id), ['b']);
  assert.equal(H.removeFrom(list, 'zz'), list, 'unknown id: same list');
  const d = H.duplicateIn(list, 'b', { id: 'u9', today: '2026-10-14' });
  assert.deepEqual(d.list.map(u => u.id), ['a', 'b', 'u9'], 'the copy sits right after its original');
  assert.equal(d.copy.name, 'b copy'); assert.equal(d.copy.projectId, 'p1'); assert.equal(d.copy.savedAt, '2026-10-14');
  assert.notEqual(d.copy.spec, list[1].spec, 'deep copy');
  assert.equal(H.updateIn(list, 'a', { name: 'New' })[0].name, 'New');
  assert.equal(H.setProjectOf(list, 'b', '*')[1].projectId, '*');
  assert.equal(JSON.stringify(list), before);
});
test('store: the mutable working list syncs from the frozen state and commits through one dispatch action', () => {
  let S = Object.freeze({ userWidgets: Object.freeze([Object.freeze(W('a', 'grid'))]) }); const sent = [];
  const st = H.createWidgetStore({ getState: () => S, dispatch: a => sent.push(a) });
  st.sync(); const ref = st.list;
  assert.equal(Object.isFrozen(st.list[0]), false, 'the vendored code mutates widgets in place');
  st.list.push(W('b', 'grid')); st.commit();
  assert.deepEqual(sent, [[['cfg-widgets', JSON.stringify(ref)]]]);
  S = Object.freeze({ userWidgets: [W('b', 'grid')] }); st.sync();
  assert.equal(st.list, ref, 'same array: App.state.userWidgets stays the one list'); assert.deepEqual(st.list.map(u => u.id), ['b']);
  assert.deepEqual(st.stateExtras().userWidgets, st.list);
  assert.deepEqual(Object.keys(st.stateExtras()).sort(), ['mineLayout', 'published', 'tier', 'userWidgets']);
});

// ---------- the vendored Configurator on the one GS / App ----------
function shimWindow(S) {
  const host = { getState: () => S, getData: () => ({}), project: () => null, dispatch() {}, render() {}, toast() {}, candidateGates: () => null };
  const b = createBridge({ meta: {}, groups: { identity: { cols: ['bus_id'], rows: [] } }, market: { nodes: [], grid: { headroom: [], constraints: [] } }, measures: { buses: {} }, curtail: { cols: [], rows: [] }, land: {} }, host);
  const win = { GS: b.GS, App: b.App, GS_DATA_EXT: b.EXT, console, getComputedStyle: () => ({ getPropertyValue: v => `var(${v})` }), document: { documentElement: {} } }; // Charts.cv reads CSS tokens
  win.window = win; vm.createContext(win);
  return win;
}
function diskIO(win, calls = []) {
  return {
    calls,
    loadScript: async src => { calls.push(src); vm.runInContext(readFileSync(new URL(src, APP), 'utf8'), win, { filename: src }); },
    loadCss: async src => { calls.push(src); },
    fetchJson: async src => { calls.push(src); return JSON.parse(readFileSync(new URL(src, APP), 'utf8')); },
  };
}
/** What the integrator wires into live-bridge (Lead wiring 1): the members + App.state extras. */
function wireApp(win, store, toasts = []) {
  const A = win.App, before = Object.getOwnPropertyDescriptors(A);
  assert.deepEqual(H.installOnApp(A, { store, toast: m => toasts.push(m), render() {} }).sort(), ['CONCERNS', 'Drawer', 'Palette', 'TIERS', 'concernOf', 'isAdmin', 'reqId', 'safeAnswer', 'save']);
  for (const [k, d] of Object.entries(before)) if (k !== 'state') assert.equal(Object.getOwnPropertyDescriptor(A, k).value ?? Object.getOwnPropertyDescriptor(A, k).get, d.value ?? d.get, `App.${k} kept`);
  assert.equal(A.state.optionId, null, 'the shim state is kept'); assert.equal(A.state.userWidgets, store.list, 'App.state.userWidgets is the one working list');
}
const S0 = () => ({ tech: 'solar', exportMW: 100, importMW: 0, caseKey: 'sp', pins: ['100179'], ui: {}, nodeId: '100179', hz: 2030, userWidgets: [] });
const COL = { id: 'u1', name: 'Average LMP by year', concern: 'prices', projectId: '*', kind: 'chart', chartType: 'column', section: 'ECONOMIC', savedAt: '2026-10-13',
  spec: { busScope: 'buses', buses: [100179], xMode: 'dimension', xDimension: 'year', yFields: [{ template: 'Avg_LMP_{year}', label: 'Average LMP', pins: {} }] } };

test('boot: missing App members are named (no silent fallback); nothing loads', async () => {
  const S = S0(), win = shimWindow(S), io = diskIO(win);
  const st = H.createWidgetStore({ getState: () => S, dispatch() {} });
  await assert.rejects(H.bootConfigurator(win, { store: st, getState: () => S }, io), e => /App members missing: .*Drawer/.test(e.message) && /state\.userWidgets/.test(e.message));
  assert.equal(io.calls.some(c => c.includes('configurator/')), false);
  assert.ok(H.CFG_APP_MEMBERS.includes('safeAnswer') && H.CFG_APP_MEMBERS.includes('state.userWidgets'));
});

test('boot: loads once on the one GS / App; the extract view is local to the IIFE; asDef answers on the extract, labelled', async () => {
  const S = S0(), win = shimWindow(S), GS0 = win.GS, App0 = win.App, io = diskIO(win);
  assert.equal(H.sectionHTML('prices'), '', 'no section before the Configurator is booted');
  const store = H.createWidgetStore({ getState: () => S, dispatch() {} }); wireApp(win, store);
  assert.deepEqual(H.missingAppMembers(win.App), []);
  await bootLiveRuntime(win, io);
  const p1 = H.bootConfigurator(win, { store, getState: () => S }, io), p2 = H.bootConfigurator(win, { store, getState: () => S }, io);
  assert.equal(p1, p2, 'one load per window');
  const Cfg = await p1;
  assert.deepEqual(io.calls.filter(c => c.includes('configurator')), ['views/configurator-host.css', 'vendor/live/configurator/app-icons.js', 'vendor/live/configurator/app-configurator.js'], 'css, icons, then the Configurator, once each');
  assert.equal('GSX_CFG_ICON' in win, false, 'the icon set is not left global');
  assert.equal(win.GS, GS0, 'one window.GS'); assert.equal(win.App, App0, 'one window.App');
  assert.equal('GSX_CFG' in win, false, 'the load-time view is removed after load');
  assert.equal(Cfg, win.Configurator); for (const k of ['open', 'asDef', 'removeWidget', 'undoRemove']) assert.equal(typeof Cfg[k], 'function', k);
  // the view: the extract's nodes, the shim's everything else
  const v = H.extractView(win.GS), model = win.GS.liveRuntime.model;
  assert.equal(v.nodes, model.nodes); assert.notEqual(win.GS.nodes, model.nodes, 'window.GS.nodes untouched (the engine)');
  assert.equal(v.fmt, win.GS.fmt, 'the shim formatter: missing reads "not held"'); assert.equal(Object.getPrototypeOf(v), win.GS);
  // ctx: the current bus from the extract, pins as numbers
  const c = H.cfgCtx(win.App.ctx(), S, win.GS);
  assert.equal(c.node.bus_id, 100179); assert.deepEqual(c.pins, [100179]); assert.deepEqual(c.compare, []); assert.equal(c.horizon, 2030);
  // a saved column widget answers with the pinned extract's own values at that bus
  const def = Cfg.asDef(COL); assert.equal(def.id, 'u:u1'); assert.equal(def.concern, 'prices');
  const ans = win.App.safeAnswer(def, c);
  assert.equal(ans.state, 'answered', JSON.stringify(ans).slice(0, 300));
  assert.equal(typeof ans.render, 'function');
  // values = the pinned extract at the same bus (history) and the one price basis GS.px (forecast); unembedded years are not invented
  const row = y => ans.table.rows.find(r => r.x === y), n = model.node(100179), px = win.GS.px(n, 2030);
  assert.equal(row('2025').s0, n.lmp_2025); assert.equal(row('2030').s0, px && typeof px === 'object' ? px.value : px);
  assert.equal(row('2020'), undefined, 'a year not embedded is absent, never 0'); assert.ok(ans.notes.some(x => /not embedded/.test(x)));
  // the booted host's section: the stored widget, labelled with the runtime's vintage
  S.userWidgets = [COL];
  const sec = H.sectionHTML('prices');
  assert.match(sec, /data-gsx-cfg-w="u1"/); assert.ok(sec.includes(win.GS.liveRuntime.vintage)); assert.match(sec, /Average LMP moves from/);
  assert.equal(store.list.length, 1, 'synced from state');
  // App.safeAnswer turns a throw into an unsupported answer naming it
  const err = console.error; console.error = () => {};
  try { assert.match(win.App.safeAnswer({ answer() { throw new Error('boom'); } }, c).missing, /boom/); } finally { console.error = err; }
});

test('myAnalysesHTML: the stage\'s widgets (this project or every project), each with actions and the catalogue vintage', () => {
  const vintage = 'ISONE_GridSense.duckdb (3.0 GB) · extract built 2026-09-20 05:47';
  const list = [{ ...COL }, { ...COL, id: 'u2', name: 'Other <project>', projectId: 'p2' }, { ...COL, id: 'u3', name: 'Mine on p1', projectId: 'p1' }, { ...COL, id: 'u4', concern: 'grid' }];
  const ans = { state: 'answered', principal: 'At 100179 the average LMP …', caption: 'Pinned extract', badges: [{ kind: 'model', text: 'modelled' }] };
  const Cfg = { asDef: u => ({ id: 'u:' + u.id, controls: [{ id: 'scope', default: () => 'buses' }], answer: () => ans }) };
  const html = H.myAnalysesHTML('prices', { list, projectId: 'p1', Configurator: Cfg, c: {}, vintage, projectName: 'Kennebec' });
  assert.match(html, /^<section class="gsx-cfg gsx-cfg-mine" data-gsx-cfg-stage="prices"/);
  const ids = [...html.matchAll(/data-gsx-cfg-w="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, ['u1', 'u3'], 'every-project and this-project widgets of this stage');
  assert.equal(html.split('data-gsx-cfg-vintage').length - 1, ids.length, 'the vintage label on every widget');
  assert.ok(html.includes(vintage));
  for (const a of ['cfg-edit', 'cfg-dup', 'cfg-rm']) assert.equal(html.split(`data-act="${a}"`).length - 1, ids.length, a);
  assert.match(html, /data-act="cfg-add" data-stage="prices"/);
  assert.match(html, /At 100179 the average LMP/); assert.match(html, /data-gsx-cfg-body="u1"/);
  assert.match(html, /Only Kennebec/); assert.match(html, /Every project/);
  const all = H.myAnalysesHTML('prices', { list, projectId: 'p1', all: true, Configurator: Cfg, c: {}, vintage });
  assert.ok(all.includes('Other &lt;project&gt;'), 'names escaped; all = every project');
  // empty stage and an unloaded Configurator: no invented values
  assert.match(H.myAnalysesHTML('land', { list, projectId: 'p1', Configurator: Cfg, c: {}, vintage }), /No analyses of your own on Land yet/);
  const dark = H.myAnalysesHTML('prices', { list, projectId: 'p1', Configurator: null, c: {}, vintage: null });
  assert.match(dark, /field catalogue is not loaded/i); assert.match(dark, /vintage not stated/);
  // empty / unsupported answers say what is missing
  const none = H.myAnalysesHTML('prices', { list: [COL], Configurator: { asDef: () => ({ answer: () => ({ state: 'empty', emptyTitle: 'No bus in scope', searched: 'the saved list is empty' }) }) }, c: {}, vintage });
  assert.match(none, /No bus in scope/); assert.match(none, /the saved list is empty/);
});

test('readEvent / handleAction: edit, duplicate, remove and add go to the live Configurator with the stored widget', async () => {
  const calls = [], u = { ...COL };
  const Cfg = { open: o => calls.push(['open', o]), asDef: x => ({ id: 'u:' + x.id, userWidget: x }), removeWidget: x => calls.push(['rm', x]) };
  const store = { list: [u], sync() {} };
  const el = id => ({ closest: () => ({ dataset: { act: id[0], id: id[1], stage: id[2] } }) });
  assert.deepEqual(H.readEvent(el(['cfg-edit', 'u1'])), { act: 'cfg-edit', id: 'u1', stage: null });
  assert.equal(H.readEvent({ closest: () => null }), null);
  await H.handleAction({ act: 'cfg-edit', id: 'u1' }, { Configurator: Cfg, store });
  await H.handleAction({ act: 'cfg-dup', id: 'u1' }, { Configurator: Cfg, store });
  await H.handleAction({ act: 'cfg-rm', id: 'u1' }, { Configurator: Cfg, store });
  await H.handleAction({ act: 'cfg-add', stage: 'grid' }, { Configurator: Cfg, store });
  await H.handleAction({ act: 'cfg-add', stage: 'nowhere' }, { Configurator: Cfg, store });
  assert.equal(calls[0][1].edit, u, 'edit opens the stored (mutable) widget');
  assert.equal(calls[1][1].duplicate, true); assert.equal(calls[1][1].from.userWidget, u);
  assert.deepEqual(calls[2], ['rm', u]);
  assert.deepEqual(calls[3], ['open', { concern: 'grid' }]); assert.deepEqual(calls[4], ['open', { concern: null }]);
});

test('appMembers: the live CONCERNS / concernOf / TIERS / isAdmin / reqId, copied from the pin', () => {
  const m = H.appMembers({ store: { list: [], commit() {} }, toast() {}, render() {} });
  assert.deepEqual(m.CONCERNS.map(c => c.key), ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision']);
  assert.equal(m.concernOf('mine').label, 'My dashboards'); assert.equal(m.concernOf('grid').n, 3); assert.equal(m.concernOf('zz').label, 'zz');
  assert.deepEqual(Object.keys(m.TIERS), ['T1A', 'T1B', 'T2', 'T3', 'ADMIN']);
  assert.equal(m.isAdmin(), false, 'publishing packs is an administrator action; One Studio has none');
  assert.match(m.reqId(), /^req_[a-z0-9]+$/);
  const pin = readFileSync(new URL('src/app.js', PIN11), 'utf8');
  for (const c of m.CONCERNS) assert.ok(pin.includes(`q: '${c.q.replace(/'/g, "\\'")}'`), `${c.key} question as live`);
});
