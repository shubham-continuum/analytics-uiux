// GridSense One Studio: host for the vendored live Graph Configurator (lift plan 14, slice L3) — "Add analysis" on every
// stage and the "My analyses" section, drawn by the live asDef() -> answer() -> Charts path.
// Provenance: Claude Opus 5.5 (builder G-configurator) · one-studio/design 14-lift (slice L3) · 2026-10-13 · sign-off pending · v1
//
// Contract (design/14-lift-projects-configurator-continuum.md §3 L3, §4, §5.3; tests/configurator.test.mjs):
//   - vendor/live/configurator/app-configurator.js is the pinned src/app.js Configurator section + reviewed patch F1.
//     It loads ONCE, after live-runtime.js (GS.catalog, Charts), on the ONE page GS / App (the bridge's globals).
//   - The catalogue, GS.resolve and every column it reads are the pinned data.js extract's (older vintage: plan §5.3, lift
//     as-is, labelled). F1 gives the IIFE a local GS = extractView(the page GS): Object.create(the one GS) with the extract's
//     nodes / node / CASES / caseOf / shortCircuitMVA / detail; the page GS is never replaced. Handed in at load time
//     only (window.GSX_CFG, removed in `finally`), with cfgCtx (current bus from the extract, pins, compare, horizon) and
//     the live icon set (app-icons.js, patch F2: its window.GSX_CFG_ICON assignment is trapped; the shim's App.icon
//     stays '' for the vendored map/grid).
//   - Saved analyses live in One Studio state S.userWidgets (getState() is frozen; the vendored code mutates
//     App.state.userWidgets in place) -> createWidgetStore keeps ONE mutable working list; App.save commits it with the
//     `cfg-widgets` dispatch action (Lead wiring). Pure helpers (widgetsFor, removeFrom, duplicateIn, updateIn,
//     setProjectOf) never mutate their input.
//   - Every widget states the field-catalogue vintage (the extract's own words). Null reads "not held", never 0: the
//     shim's GS.fmt is kept; an empty / unsupported answer says what is missing.
//   - Never writes the URL (studiohash.js is the only hash writer).
import { bootLiveRuntime } from '../live-runtime.js';

export const CFG_FILES = Object.freeze({ icons: 'vendor/live/configurator/app-icons.js', js: 'vendor/live/configurator/app-configurator.js', css: 'views/configurator-host.css' });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = v => JSON.parse(JSON.stringify(v ?? null));

// ---------- live vocabulary, copied from the pinned src/app.js (L885-897, L926) ----------
export const CONCERNS = Object.freeze([
  { key: 'market', n: 1, label: 'Market', rail: 'Market', short: 'Market', q: 'Where should this program investigate first?', sheet: 'Ranking' },
  { key: 'land', n: 2, label: 'Land', rail: 'Land', short: 'Land', q: 'Can a real location support a feasible connection?', sheet: 'Site' },
  { key: 'grid', n: 3, label: 'Grid', rail: 'Grid', short: 'Grid', q: 'What limits the requested connection?', sheet: 'Grid Analysis' },
  { key: 'queue', n: 4, label: 'Queue', rail: 'Queue', short: 'Queue', q: 'What could change cost or delivery timing?', sheet: 'Queue' },
  { key: 'prices', n: 5, label: 'Prices', rail: 'Prices', short: 'Prices', q: 'When and why is this node commercially exposed?', sheet: 'Price Summary' },
  { key: 'economics', n: 6, label: 'Economics', rail: 'Economics', short: 'Economics', q: 'Does this configuration work under explicit assumptions?', sheet: 'Economics' },
  { key: 'decision', n: 7, label: 'Decision', rail: 'Decision', short: 'Decision', q: 'Which options advance, and what work remains?', sheet: 'Compare' },
].map(Object.freeze));
const EXTRA_CONCERNS = { iso: { key: 'iso', n: 8, label: 'ISO-wide', rail: 'ISO-wide', short: 'ISO-wide', q: 'What is actually happening in ISO-NE?', sheet: 'Market' }, mine: { key: 'mine', n: 9, label: 'My dashboards', rail: 'My dashboards', short: 'Mine', q: 'Your own analyses', sheet: 'My analyses' } };
export const concernOf = k => CONCERNS.find(c => c.key === k) || EXTRA_CONCERNS[k] || { key: k, n: 0, label: k || 'Analysis', rail: k, short: k, q: '', sheet: 'Analysis' };
const TIERS = { T1A: { label: 'Level 1(a) · Grid Capacity Only', features: ['grid'] }, T1B: { label: 'Level 1(b) · Economic Only', features: ['econ'] }, T2: { label: 'Level 2 · Full Dataset Access', features: ['grid', 'econ', 'downloads'] }, T3: { label: 'Level 3 · Full + Advanced Analytics', features: ['grid', 'econ', 'downloads', 'analytics'] }, ADMIN: { label: 'Administrator', features: ['grid', 'econ', 'downloads', 'analytics', 'admin'] } };

/** Every App member the vendored Configurator reads (state.* = members of App.state). */
export const CFG_APP_MEMBERS = Object.freeze(['ctx', 'options', 'toast', 'render', 'icon', 'save', 'Drawer', 'Palette', 'CONCERNS', 'concernOf', 'TIERS', 'isAdmin', 'reqId', 'safeAnswer', 'state.userWidgets', 'state.published', 'state.mineLayout', 'state.tier']);
export function missingAppMembers(App) {
  if (!App) return [...CFG_APP_MEMBERS];
  let st = null; try { st = App.state; } catch { st = null; }
  return CFG_APP_MEMBERS.filter(k => (k.startsWith('state.') ? !(st && k.slice(6) in st) : !(k in App)));
}

// ---------- widget store helpers (pure) ----------
export const widgetList = S => (Array.isArray(S?.userWidgets) ? S.userWidgets : []);
/** A stage's analyses: every-project ones plus this project's (all: every project's); no stage = every stage. */
export const widgetsFor = (list, { stage = null, projectId = null, all = false } = {}) =>
  list.filter(u => (!stage || u.concern === stage) && (all || u.projectId === '*' || !u.projectId || (projectId != null && u.projectId === projectId)));
export const removeFrom = (list, id) => (list.some(u => u.id === id) ? list.filter(u => u.id !== id) : list);
export const updateIn = (list, id, patch) => list.map(u => (u.id === id ? { ...clone(u), ...patch } : u));
export const setProjectOf = (list, id, projectId) => updateIn(list, id, { projectId: projectId || '*' });
/** The live "{name} copy", right after its original; deep copy of the spec. → {list, copy} (copy null for an unknown id). */
export function duplicateIn(list, id, { id: nid = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), today = new Date().toISOString().slice(0, 10) } = {}) {
  const i = list.findIndex(u => u.id === id); if (i < 0) return { list, copy: null };
  const copy = { ...clone(list[i]), id: nid, name: `${list[i].name || 'Untitled analysis'} copy`, savedAt: today };
  return { list: [...list.slice(0, i + 1), copy, ...list.slice(i + 1)], copy };
}
/** ONE mutable working list over the frozen One Studio state: sync() pulls S.userWidgets in place (same array),
 *  commit() hands it back through the `cfg-widgets` action. stateExtras() = what App.state adds for the Configurator. */
export function createWidgetStore({ getState, dispatch }) {
  const list = [];
  let seen = '[]';
  return {
    list,
    sync() { const src = JSON.stringify(widgetList(getState())); if (src !== seen || JSON.stringify(list) !== src) { list.splice(0, list.length, ...JSON.parse(src)); seen = src; } return list; },
    commit() { seen = JSON.stringify(list); dispatch([['cfg-widgets', seen]]); },
    stateExtras: () => ({ userWidgets: list, published: [], mineLayout: '2x2', tier: 'T3' }),
  };
}

// ---------- the extract view and the ctx adapter ----------
const VIEW_KEYS = ['nodes', 'node', 'byId', 'detail', 'CASES', 'caseOf', 'shortCircuitMVA'];
const VIEWS = new WeakMap();
/** The Configurator's GS: the one page GS as prototype, with the pinned extract's node members on top. */
export function extractView(GS) {
  if (VIEWS.has(GS)) return VIEWS.get(GS);
  const model = GS?.liveRuntime?.model;
  if (!model) throw new Error('configurator: the live GS model is not loaded (live-runtime.js)');
  const v = Object.create(GS);
  for (const k of VIEW_KEYS) if (k in model) Object.defineProperty(v, k, { value: model[k], enumerable: true });
  VIEWS.set(GS, v);
  return v;
}
/** App.ctx() plus what the Configurator reads: the current bus as an extract node, pins, compare, horizon. */
export function cfgCtx(base, S, GS) {
  const v = extractView(GS), node = v.node(Number(S?.nodeId)) || null;
  return { ...base, node, detail: node && v.detail ? v.detail(node.bus_id) : null, caseObj: base?.case && v.caseOf ? v.caseOf(base.case) : base?.caseObj,
    pins: (S?.pins || []).map(Number), compare: (S?.ui?.dOpts || []).map(id => ({ busId: Number(id) })), horizon: S?.hz ?? null,
    vintage: GS.liveRuntime?.vintage ?? null };
}

// ---------- App members (Lead wiring adds them to the live-bridge shim) ----------
function H(t, c, txt) { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; }
/** Drawer / Palette over the live studio.css classes, plus the live vocabulary; save commits the working list. */
export function appMembers({ store, toast, render, nodes = () => [] }) {
  let keyH = null;
  const Drawer = {
    current: null,
    open(o) {
      let d = document.getElementById('gsx-cfg-drawer'), s = document.getElementById('gsx-cfg-scrim');
      if (!d) { d = H('aside'); d.id = 'gsx-cfg-drawer'; document.body.appendChild(d); }
      if (!s) { s = H('div'); s.id = 'gsx-cfg-scrim'; s.onclick = Drawer.close; document.body.appendChild(s); }
      d.className = `drawer gsx-cfg gsx-cfg-dr on${o.width === 'narrow' ? ' narrow' : o.width === 'wide' ? ' wide' : ''}`; s.className = 'scrim on'; d.innerHTML = '';
      const hd = H('div', 'dr-h'), left = H('div'); left.appendChild(H('h2', null, o.title)); if (o.sub) { const p = H('p'); p.innerHTML = o.sub; left.appendChild(p); }
      hd.appendChild(left); if (o.headRight) hd.appendChild(o.headRight);
      const x = H('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.onclick = Drawer.close; hd.appendChild(x); d.appendChild(hd);
      const body = H('div', 'dr-b'); if (o.body) body.appendChild(o.body); d.appendChild(body);
      if (o.footer) { const f = H('div', 'dr-f'); f.appendChild(o.footer); d.appendChild(f); }
      d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', o.title || 'Analysis');
      Drawer.current = o;
      if (!keyH) { keyH = e => { if (e.key === 'Escape' && Drawer.current) Drawer.close(); }; document.addEventListener('keydown', keyH); }
      setTimeout(() => x.focus(), 0);
      return { el: d, body };
    },
    close() { const d = document.getElementById('gsx-cfg-drawer'), s = document.getElementById('gsx-cfg-scrim'); if (d) d.className = 'drawer gsx-cfg gsx-cfg-dr'; if (s) s.className = 'scrim'; Drawer.current = null; },
    isOpen: () => !!Drawer.current,
  };
  const Palette = {
    /** Bus picker over the extract's nodes (name, number, county, state); onPick(node). */
    open(onPick, o = {}) {
      let p = document.getElementById('gsx-cfg-palette'); if (!p) { p = H('div'); p.id = 'gsx-cfg-palette'; document.body.appendChild(p); }
      p.className = 'palette gsx-cfg on'; p.innerHTML = ''; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', o.title || 'Pick a bus');
      const close = () => { p.className = 'palette gsx-cfg'; p.innerHTML = ''; };
      const q = H('input', 'inp'); q.placeholder = o.placeholder || 'Search buses by name, number or county…'; q.setAttribute('aria-label', 'Search buses');
      const ul = H('div', 'gsx-cfg-pl'); p.appendChild(q); p.appendChild(ul);
      const draw = () => {
        const t = q.value.trim().toLowerCase(), hits = nodes().filter(n => !t || `${n.name} ${n.bus_id} ${n.county || ''} ${n.state || ''}`.toLowerCase().includes(t)).slice(0, 30);
        ul.innerHTML = ''; if (!hits.length) { ul.appendChild(H('p', 'muted', 'No bus matches.')); return; }
        for (const n of hits) { const b = H('button', 'gsx-cfg-pi', `${n.name} · ${n.kv ?? 'kV not held'} kV · ${n.state ?? ''} · ${n.bus_id}`); b.type = 'button'; b.onclick = () => { close(); onPick(n); }; ul.appendChild(b); }
      };
      q.oninput = draw; q.onkeydown = e => { if (e.key === 'Escape') close(); }; draw(); setTimeout(() => q.focus(), 0);
    },
  };
  const safeAnswer = (def, c, ctl) => {
    try {
      const dflt = {}; for (const ct of def.controls || []) dflt[ct.id] = typeof ct.default === 'function' ? ct.default(c) : ct.default;
      return def.answer(c, ctl || dflt) || { state: 'unsupported', missing: 'the block returned nothing' };
    } catch (e) { console.error(def?.id, e); return { state: 'unsupported', missing: 'the component threw: ' + e.message, principal: null }; }
  };
  return { save: () => store.commit(), render, toast, Drawer, Palette, CONCERNS, concernOf, TIERS, isAdmin: () => false, reqId: () => 'req_' + Math.random().toString(36).slice(2, 10), safeAnswer };
}

/** The live-bridge wiring in one call, merge-only: the members above that the ONE App lacks (a shim member such as
 *  toast / render is never replaced), and App.state gains the store's extras (userWidgets = the one working list); the
 *  shim's own state getter is kept and extended. → the names added. */
export function installOnApp(App, deps) {
  const base = Object.getOwnPropertyDescriptor(App, 'state')?.get, added = [];
  for (const [k, v] of Object.entries(appMembers(deps))) if (!(k in App)) { App[k] = v; added.push(k); }
  Object.defineProperty(App, 'state', { configurable: true, enumerable: true, get: () => ({ ...(base ? base.call(App) : {}), ...deps.store.stateExtras() }) });
  return added;
}

// ---------- boot ----------
function browserIO(win) {
  const doc = win.document;
  const add = (src, tag) => new Promise((res, rej) => {
    if (doc.querySelector(`[data-gsx-vendor="./${src}"]`)) { res(); return; }
    const el = doc.createElement(tag); el.setAttribute('data-gsx-vendor', `./${src}`);
    if (tag === 'script') { el.src = `./${src}`; el.async = false; } else { el.rel = 'stylesheet'; el.href = `./${src}`; }
    el.onload = () => res(); el.onerror = () => rej(new Error(`could not load ${src}`)); doc.head.appendChild(el);
  });
  return { loadScript: src => add(src, 'script'), loadCss: src => add(src, 'link'),
    fetchJson: async src => { const r = await win.fetch(`./${src}`); if (!r.ok) throw new Error(`HTTP ${r.status} for ${src}`); return r.json(); } }; // live-runtime's own io shape
}
const ONCE = new WeakMap();
let HOST = null; // {win, store, getState}: set by bootConfigurator, read by open() / the section helpers
/** Load the vendored Configurator once per window, after live-runtime.js. deps = {store, getState}. → window.Configurator.
 *  Rejects naming what is missing (App members, the runtime, the file); a failed load adds nothing and may be retried. */
export function bootConfigurator(win = globalThis.window, deps, io = browserIO(win)) {
  if (ONCE.has(win)) return ONCE.get(win);
  const p = (async () => {
    const miss = missingAppMembers(win.App);
    if (miss.length) throw new Error(`configurator: App members missing: ${miss.join(', ')} (live-bridge.js Lead wiring)`);
    await bootLiveRuntime(win, io);
    const view = extractView(win.GS);
    io.loadCss?.(CFG_FILES.css)?.catch?.(e => console.warn('[configurator]', e.message));
    let icon = null; // the icons module assigns window.GSX_CFG_ICON: captured for the span of its load, never left global
    Object.defineProperty(win, 'GSX_CFG_ICON', { configurable: true, enumerable: false, get: () => icon, set: v => { icon = v; } });
    try { await io.loadScript(CFG_FILES.icons); } finally { delete win.GSX_CFG_ICON; }
    if (typeof icon !== 'function') throw new Error(`configurator: ${CFG_FILES.icons} did not define the icon set`);
    Object.defineProperty(win, 'GSX_CFG', { configurable: true, enumerable: false, writable: true, value: { GS: view, ctx: base => cfgCtx(base, deps.getState(), win.GS), icon } });
    try { await io.loadScript(CFG_FILES.js); } finally { delete win.GSX_CFG; }
    const C = win.Configurator;
    if (!C || typeof C.asDef !== 'function') throw new Error(`configurator: ${CFG_FILES.js} did not define window.Configurator`);
    HOST = { win, store: deps.store, getState: deps.getState };
    return C;
  })();
  ONCE.set(win, p);
  p.catch(() => ONCE.delete(win));
  return p;
}
/** "Add analysis" on a stage header: the live drawer, attached to that stage (an unknown key = My dashboards only). */
export async function open(stageKey, deps) {
  const h = deps || HOST; if (!h) throw new Error('configurator: not booted');
  const C = h.Configurator || await bootConfigurator(h.win, h);
  h.store?.sync?.();
  C.open({ concern: CONCERNS.some(c => c.key === stageKey) ? stageKey : null });
}

// ---------- "My analyses" on a stage ----------
const ANS = new Map(); // widget id -> the answer drawn by the last myAnalysesHTML (mountMyAnalyses draws its chart)
const vintageLine = v => `<p class="gsx-cfg-vin" data-gsx-cfg-vintage>Field catalogue: ${esc(v || 'vintage not stated')} · the pinned data.js extract, not the unified database</p>`;
function answerOf(u, Cfg, c) {
  if (!Cfg) return null;
  try { const def = Cfg.asDef(u), ctl = {}; for (const ct of def.controls || []) ctl[ct.id] = typeof ct.default === 'function' ? ct.default(c) : ct.default; return def.answer(c, ctl) || { state: 'unsupported', missing: 'the analysis returned nothing' }; } catch (e) { return { state: 'unsupported', missing: 'the analysis threw: ' + e.message }; }
}
function cardHTML(u, ans, { vintage, projectId, projectName }) {
  const where = u.projectId && u.projectId !== '*' ? `Only ${esc(u.projectId === projectId && projectName ? projectName : u.projectId)}` : 'Every project';
  const badges = [{ kind: 'mine', text: 'your analysis · not certified' }, ...((ans && ans.badges) || [])].map(b => `<span class="badge ${esc(b.kind || '')}"${b.title ? ` title="${esc(b.title)}"` : ''}>${esc(b.text)}</span>`).join('');
  let p, body = '', cap = '';
  if (!ans) p = '<p class="gsx-cfg-p empty">The field catalogue is not loaded yet — this analysis draws once it is.</p>';
  else if (ans.state === 'answered') { p = `<p class="gsx-cfg-p">${esc(ans.principal || '')}</p>`; body = `<div class="gsx-cfg-body" data-gsx-cfg-body="${esc(u.id)}"></div>`; cap = ans.caption ? `<p class="gsx-cfg-cap">${esc(ans.caption)}</p>` : ''; }
  else if (ans.state === 'empty') p = `<p class="gsx-cfg-p empty"><b>${esc(ans.emptyTitle || 'Nothing on record')}</b>${ans.searched ? ` · Searched: ${esc(ans.searched)}` : ''}</p>`;
  else p = `<p class="gsx-cfg-p empty"><b>${esc(ans.emptyTitle || 'Not available')}</b>${ans.missing ? ` · Missing: ${esc(ans.missing)}` : ''}${ans.why ? ` · ${esc(ans.why)}` : ''}</p>`;
  const btn = (act, label) => `<button type="button" class="btn xs" data-act="${act}" data-id="${esc(u.id)}">${label}</button>`;
  return `<section class="gsx-cfg-w" data-gsx-cfg-w="${esc(u.id)}"><div class="gsx-cfg-wh"><span class="gsx-cfg-id">MINE</span><h3>${esc(u.name || 'Untitled analysis')}</h3><span class="gsx-cfg-acts">${btn('cfg-edit', 'Edit')}${btn('cfg-dup', 'Duplicate')}${btn('cfg-rm', 'Remove')}</span></div><div class="gsx-cfg-badges">${badges}</div>${p}${body}${cap}<p class="gsx-cfg-where">${where} · saved ${esc(u.savedAt || 'date not held')}</p>${vintageLine(vintage)}</section>`;
}
/** The stage's "My analyses" section. ctx = {list, projectId, projectName, all, Configurator, c (cfgCtx), vintage}. */
export function myAnalysesHTML(stageKey, { list = [], projectId = null, projectName = null, all = false, Configurator = null, c = {}, vintage = null } = {}) {
  const cn = concernOf(stageKey), mine = widgetsFor(list, { stage: stageKey, projectId, all });
  const cards = mine.map(u => { const ans = answerOf(u, Configurator, c); ANS.set(u.id, ans); return cardHTML(u, ans, { vintage, projectId, projectName }); }).join('');
  return `<section class="gsx-cfg gsx-cfg-mine" data-gsx-cfg-stage="${esc(stageKey)}" aria-label="My analyses on ${esc(cn.label)}"><header class="gsx-cfg-hd"><h2>My analyses <span class="gsx-cfg-n">${mine.length}</span></h2><p>Private to you · built in the Graph Configurator on the pinned field catalogue</p><button type="button" class="gsx-cfg-add" data-act="cfg-add" data-stage="${esc(stageKey)}">Add analysis</button></header>${mine.length ? `<div class="gsx-cfg-grid">${cards}</div>` : `<p class="gsx-cfg-none">No analyses of your own on ${esc(cn.label)} yet. Add analysis builds a chart, KPI tile or table from the field catalogue.</p>${vintageLine(vintage)}`}</section>`;
}
/** The booted host's section for a stage ('' until bootConfigurator resolved): the store's list, the open project,
 *  the Configurator ctx and the catalogue vintage. */
export function sectionHTML(stageKey, h = HOST) {
  if (!h?.win?.Configurator) return '';
  const S = h.getState(), win = h.win, list = h.store.sync(), pid = S.walk?.project ?? null, p = win.App.project?.();
  return myAnalysesHTML(stageKey, { list, projectId: pid, projectName: p?.name ?? null, Configurator: win.Configurator, c: cfgCtx(win.App.ctx(), S, win.GS), vintage: win.GS.liveRuntime?.vintage ?? null });
}
/** Draw each answered widget's chart into its slot (after the board's innerHTML is set). */
export function mountMyAnalyses(root, { Charts = globalThis.window?.Charts } = {}) {
  for (const slot of root.querySelectorAll('[data-gsx-cfg-body]')) {
    const ans = ANS.get(slot.dataset.gsxCfgBody); if (!ans || ans.state !== 'answered' || typeof ans.render !== 'function') continue;
    slot.innerHTML = '';
    try { slot.appendChild(ans.render(Math.max(280, slot.clientWidth || 480))); } catch (e) { console.error('[configurator]', e); if (Charts?.empty) slot.appendChild(Charts.empty('The chart could not be drawn', e.message)); }
  }
}
/** {act, id, stage} from a data-act="cfg-*" control, or null. */
export function readEvent(el) {
  const t = el?.closest?.('[data-act^="cfg-"]'); if (!t) return null;
  return { act: t.dataset.act, id: t.dataset.id ?? null, stage: t.dataset.stage ?? null };
}
/** Edit / duplicate / remove / add, as the live card buttons do; the widget handed over is the store's (mutable) one. */
export async function handleAction(ev, deps) {
  const h = deps || HOST; if (!ev || !h) return;
  const C = h.Configurator || await bootConfigurator(h.win, h);
  h.store?.sync?.();
  const u = ev.id != null ? h.store.list.find(x => x.id === ev.id) : null;
  if (ev.act === 'cfg-add') C.open({ concern: CONCERNS.some(c => c.key === ev.stage) ? ev.stage : null });
  else if (!u) return;
  else if (ev.act === 'cfg-edit') C.open({ edit: u });
  else if (ev.act === 'cfg-dup') C.open({ from: C.asDef(u), duplicate: true });
  else if (ev.act === 'cfg-rm') C.removeWidget(u);
}
