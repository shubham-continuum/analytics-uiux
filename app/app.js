// GridSense Analyzer Studio: isolated preview shell.
// Seven dashboards in workflow order; redesigned dashboards render analyzer tabs, the rest show the
// copied Studio (legacy.html, isolated API :5035 and gspreview.* storage). No network writes.
import { PRICES, renderPrices } from './views/prices.js';
import { GRID, renderGrid } from './views/grid.js';
import { ECONOMICS, renderEconomics } from './views/economics.js';
import { MARKET, renderMarket } from './views/market.js';
import { QUEUE, renderQueue } from './views/queue.js';
import { LAND, renderLand } from './views/land.js';
import { fleetProfile } from './views/prices-data.js';
import { DECISION, renderDecision, buildRecord, chosen, candidateTally, sizeNotHeld, SIZE_NOT_HELD } from './views/decision.js';
import { screeningGates } from './gridrules.js';
import { mountInspector } from './views/inspector.js';
import { taxUiUpdate, finUiUpdate } from './views/cards-finance.js';
import { deepFreeze } from './decisioncore.js';
import { prepare as prepareMarket } from './marketcore.js';
import { defaultBasis, availableYears, forecastRuns, describe, basisHash } from './basis.js';
import { resetCharts, mountCharts, handleChartToggle } from './charts.js';
import { mountTables, mountMaps, openDrawer, closeDrawer, focusKey, restoreFocus, DEPTHS, DEPTH_LABEL, normDepth, applyDepth, depthFooter, tabLabel, normSamples, stepPatch, resolveStep, basisFromSample, presetPatch, applyPreset, togglePin, pinsForCompare, PIN_SVG,
  handoffStates, selectionChips, decorateCards, fuelSizes } from './ui.js';
import { parseStudioHash, toStudioHash, CASE_KEYS, HZ_YEARS, hzRun, caseScenario, resolveStudioHash, LIVE_DEFAULTS } from './studiohash.js';
import * as C from './chrome.js';
import { STAGE_Q, TAB_Q, tabName } from './v2copy.js';
import { loadBasemap } from './geomap.js';
import { evaluate as evaluateMarket } from './marketcore.js';
import { optionMetrics } from './decisioncore.js';
import { resetTraces, downloadCsv } from './trace.js';
import { setOnReady } from './dispatch-client.js';
import { mountFrame, normFrame, featureOn } from './frame.js';
import { evictList, keepSet } from './buscache.js';
import * as PRJ from './projects.js';
import * as CFG from './views/configurator-host.js';
import { mount as mountContinuum } from './views/continuum.js';

const fmtInt = n => Number(n).toLocaleString('en-US');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STORE = 'gspreview.analyzer.v1';

const STAGES = [
  { key: 'market', name: 'Market', q: MARKET.question, view: MARKET, render: renderMarket },
  { key: 'land', name: 'Land', q: LAND.question, view: LAND, render: renderLand },
  { key: 'grid', name: 'Grid', q: GRID.question, view: GRID, render: renderGrid },
  { key: 'queue', name: 'Queue', q: QUEUE.question, view: QUEUE, render: renderQueue },
  { key: 'prices', name: 'Prices', q: PRICES.question, view: PRICES, render: renderPrices },
  { key: 'economics', name: 'Economics', q: ECONOMICS.question, view: ECONOMICS, render: renderEconomics },
  { key: 'decision', name: 'Decision', q: DECISION.question, view: DECISION, render: renderDecision },
];
export function registerStage(key, view, render) {
  const s = STAGES.find(x => x.key === key);
  Object.assign(s, { view, render, q: view.question });
}

let D = null;           // merged bus payloads {metadata, nodes, series, grid, index}
let ONLY = null;        // standalone page: the one stage this page shows
const PAGES = { market: 'market.html', land: 'land.html', grid: 'grid.html', queue: 'queue.html', prices: 'prices.html', economics: 'economics.html', decision: 'decision.html' };
const busLoad = new Map(); // id -> 'loading' | 'ok' | Error
const S = {             // app state (persisted)
  stage: 'market', tabs: {}, nodeId: '111403', tech: 'solar', exportMW: 100, importMW: 0,
  basis: null, draft: null, ui: {}, scenarios: [], handoffs: {}, decisions: [],
  depth: 'review',      // 'screen' | 'review' | 'study' (GAP-BRIEF v4 depth contract); in the hash as depth=
  pins: [],             // pinned bus ids (strings); "Compare pinned" loads them into Decision (S.ui.dOpts)
  walk: null,           // guided walkthrough {project, option, step} over data/samples.json
  // Live Studio study basis (hash case/hz/hist): case = the Grid focus case; hz = forecast horizon (applies that solved
  // run as the price basis); the history year is read from the applied basis (one number, one home).
  caseKey: 'sp', hz: 2030, walkHidden: false,
  userWidgets: [],      // L3: the Graph Configurator's saved analyses (views/configurator-host.js, App.save → 'cfg-widgets')
  top: null,            // L4: 'continuum' while the LMP Continuum tab is open (hash v=continuum); the 7 stages otherwise
};
let pendingCmp = null;   // cmp= option ids from a live link, applied once samples.json is loaded
let pendingHist = null;  // hist= from a live link, applied once the bus's years are known
let SAMPLES = { projects: [], problems: [] };
let samplesState = 'loading'; // 'loading' | 'ok' | 'missing' | Error message
let pendingHashWalk = null;
let linkHash = null;     // the last parsed hash (02 hash restore: a link-started walk keeps the cmp and pins it does not name)
/** The sample projects as a resolveStudioHash catalogue (the shape tests/hash-corpus holds equal to the live oracle). */
const oneCatalogue = () => ({ projects: SAMPLES.projects.map(p => ({ id: p.id, options: p.options.map(o => ({ id: String(o.id), busId: String(o.busId), status: o.status })) })), hasBus: id => D.index.some(n => n.id === String(id)) });

function load() {
  try { Object.assign(S, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch { /* storage unavailable: defaults */ }
  S.pins = Array.isArray(S.pins) ? S.pins.map(String) : [];
  readHash();
}
/** Reads the live Studio vocabulary (v, stage, project, option, depth, case, hz, hist, cmp, pins) and the preview's own (tab, bus, step). */
function readHash() {
  const h = parseStudioHash(location.hash);
  linkHash = h;
  const hStage = h.stage === 'iso' ? 'market' : h.stage; // the live ISO-wide concern is the Market board here
  if (hStage && STAGES.some(s => s.key === hStage)) S.stage = hStage;
  if (ONLY) S.stage = ONLY;
  if (h.tab) S.tabs[S.stage] = h.tab;
  if (h.bus && D.index.some(n => n.id === h.bus) && h.bus !== String(S.nodeId)) { S.nodeId = h.bus; S.basis = null; }
  if (h.depth) S.depth = h.depth;
  S.depth = normDepth(S.depth);
  if (h.hasEq) S.top = h.view === 'continuum' && featureOn('continuum') && !ONLY ? 'continuum' : null; // L4: v=continuum opens the LMP Continuum tab
  if (h.caseKey) S.caseKey = h.caseKey;
  if (h.hz) S.hz = h.hz;
  if (h.hist) pendingHist = h.hist;
  // live: `pins=` (even empty) replaces the pins; ids are canonical digits, de-duplicated, held, first five (studiohash)
  const pinsSeen = (h.seen || []).includes('pins');
  const hashPins = resolveStudioHash(h, { projects: [], hasBus: id => D.index.some(n => n.id === id) }, { ...LIVE_DEFAULTS, pins: S.pins }).pins;
  if (pinsSeen) S.pins = hashPins;
  if (h.project) {
    const same = S.walk?.project === h.project && (!h.option || S.walk?.option === h.option);
    // Re-reading our own hash (same project and option) must not restart the walkthrough.
    if (same && !h.bus) pendingHashWalk = { project: h.project, option: S.walk.option, step: S.walk.step || 0, keep: true, depth: h.depth, pins: pinsSeen ? hashPins : null, stage: h.stage === 'iso' ? 'market' : h.stage /* an explicit stage wins over step: linkWins keeps the step when it is on that stage, else opens the project's first stop there (smoke-oneurl h048) */, tab: h.tab };
    // a live link keeps what it does not name (live readHash): no depth → the current depth, not the first stop's
    if (!same) pendingHashWalk = { project: h.project, option: h.option, step: Math.max(0, (h.step || 1) - 1), depth: h.depth || (h.step ? null : S.depth), pins: pinsSeen ? hashPins : null, stage: h.stage === 'iso' ? 'market' : h.stage /* an explicit stage wins over step: linkWins keeps the step when it is on that stage, else opens the project's first stop there (smoke-oneurl h048) */, tab: h.tab, bus: h.bus };
    else if (h.step && h.step - 1 !== S.walk.step) pendingHashWalk = { project: h.project, option: h.option, step: h.step - 1, keep: true };
  }
  if (h.cmp.length) pendingCmp = h.cmp;
}
const basisYear = () => (S.basis?.mode === 'historical' && S.basis.years?.length === 1 ? S.basis.years[0] : null);
/** The hash in the live Studio's key order; the preview's tab/bus/step follow. */
function hashNow() {
  const st = stage(), tab = activeTab(st), p = walkProject();
  const optOf = id => p?.options.find(o => String(o.busId) === String(id))?.id;
  const cmp = p ? [...new Set([S.walk?.option, ...(S.ui.dOpts || []).map(optOf)].filter(Boolean))] : [];
  return {
    view: ONLY ? null : S.top === 'continuum' ? 'continuum' : 'stage', stage: ONLY ? null : st.key, project: p?.id || null, option: p ? S.walk.option : null, depth: S.depth,
    caseKey: S.caseKey, hz: S.hz, hist: basisYear(), cmp, pins: S.pins,
    tab, bus: String(S.nodeId), step: p && !p.user ? (S.walk.step || 0) + 1 : null,
  };
}
let lastHash = null; // the hash this page last wrote
/** The one store, without the URL: the frame persists dock state through this and never through save(). */
function persist() { try { localStorage.setItem(STORE, JSON.stringify({ ...S, draft: undefined })); } catch { /* storage off: session only */ } }
function save() {
  persist();
  const hash = `#${toStudioHash(hashNow())}`;
  // A navigation (link, Back, typed URL) changed the hash since our last write and its hashchange has not run yet:
  // a render landing in between (e.g. a slider's debounced render) must not overwrite it with the old view.
  if (lastHash !== null && location.hash !== lastHash && location.hash !== hash) {
    // Self-healing: if that navigation's hashchange never arrives, apply it ourselves so the URL can never get stuck.
    clearTimeout(save.heal); save.heal = setTimeout(() => { if (location.hash !== lastHash) { lastHash = location.hash; readHash(); render(); } }, 300);
    return;
  }
  if (location.hash !== hash) history.replaceState(null, '', hash);
  lastHash = hash;
}
// ---------- L1 user projects (projects.js store; plan 14 §6/§6a). Samples stay read-only "Dummy" projects beside them. ----------
let RULES = null, PROJECTS = PRJ.loadProjects(); // rules/isone-2026/defaults.json; null until fetched → defaults read "not held"
fetch('./rules/isone-2026/defaults.json').then(r => (r.ok ? r.json() : null)).then(j => { RULES = j; }).catch(() => { RULES = null; });
const projectsOn = () => featureOn('projects');
const allProjects = () => [...(projectsOn() ? PROJECTS : []), ...SAMPLES.projects];
function saveProject(p) { PROJECTS = PRJ.upsertProject(PROJECTS, p); PRJ.saveProjects(PROJECTS); }
/** A user project into the dashboard state, as goStep does for samples. Group REPLACEMENT of econ/fin/land (applyPreset
 *  merges one level deep, so a previous sample's keys the user project does not hold would leak). */
function applyProject(p, opt) { // null = not held stays null (fix-1); no option (the bus in view is not one) keeps the bus
  const o = opt ?? S.walk?.option, oo = typeof o === 'string' ? p.options.find(x => x.id === o) : o, bid = String(oo?.busId ?? S.nodeId);
  const st = PRJ.toState(p, o ?? { busId: S.nodeId }, { busCoord: busCoordOf(bid) }); // fix-3: site default follows the option's bus
  S.tech = st.tech; S.exportMW = st.exportMW ?? null; S.importMW = st.importMW ?? null;
  if (st.nodeId && st.nodeId !== String(S.nodeId) && indexOf(st.nodeId)) { S.nodeId = st.nodeId; S.basis = null; if (busReady(st.nodeId)) resetBasisForNode(); }
  S.ui = { ...S.ui, econ: st.ui.econ, fin: st.ui.fin, land: st.ui.land, qCod: st.ui.qCod, qService: st.ui.qService, inputProv: st.inputProv, inputSrc: Object.fromEntries(Object.entries(st.inputSrc || {}).map(([k, src]) => [k, { src, v: [st.ui.econ, st.ui.fin, st.ui.land].find(g => k in g)?.[k] ?? PRJ.fieldValue(p, k) }])) }; // labelled defaults {k: {src, v}}: a held value equal to v is the default, never 'your entry' (fix-3)
  const others = p.options.map(o => String(o.busId)).filter(b => b !== String(S.nodeId));
  S.ui.dOpts = others.slice(0, 2); for (const b of S.ui.dOpts) ensureBus(b);
}
const busCoordOf = id => { const b = indexOf(id); return b && Number.isFinite(b.lat) && Number.isFinite(b.lon) ? { lat: b.lat, lon: b.lon, name: `${b.name} · ${id}` } : null; };
/** fix-site: a user project's DEFAULT site follows the bus in view: an option (Add option makes the bus in view one) or a
 *  non-option bus (walk.option null), as toState's busCoord contract says. Only siteLat/siteLon and their labels are
 *  re-derived: econ/fin edits stay, a stated site stays, and a site edited on a dashboard (≠ the default it was given) stays. */
function followSite() {
  const p = walkProject(); if (!p?.user || p.stated?.siteLat === 'stated' || p.stated?.siteLon === 'stated') return;
  const L = S.ui.land || {}, was = k => S.ui.inputProv?.[k]?.v ?? S.ui.inputSrc?.[k]?.v ?? null;
  if (['siteLat', 'siteLon'].some(k => L[k] != null && !Object.is(L[k], was(k)))) return; // a dashboard edit: theirs
  const st = PRJ.toState(p, S.walk.option ?? { busId: S.nodeId }, { busCoord: busCoordOf(String(S.nodeId)) }), nl = st.ui.land || {};
  if (['siteLat', 'siteLon'].every(k => Object.is(L[k] ?? null, nl[k] ?? null) && (S.ui.inputSrc?.[k]?.src ?? null) === (st.inputSrc?.[k] ?? null))) return;
  const src = { ...(S.ui.inputSrc || {}) }, prov = { ...(S.ui.inputProv || {}) };
  for (const k of ['siteLat', 'siteLon']) {
    if (st.inputSrc?.[k]) src[k] = { src: st.inputSrc[k], v: nl[k] ?? null }; else delete src[k];
    if (st.inputProv?.[k]) prov[k] = st.inputProv[k]; else delete prov[k];
  }
  S.ui = { ...S.ui, land: { ...L, siteLat: nl.siteLat ?? null, siteLon: nl.siteLon ?? null }, inputSrc: src, inputProv: prov };
}
/** Open a user project at an option (default its first): S.walk carries it, so hash project=/option= round-trips. */
function openUserProject(p, optId) {
  const o = p.options.find(x => x.id === optId) || p.options[0];
  S.walk = { project: p.id, option: o?.id ?? null, step: 0, lockOption: true }; S.walkHidden = false;
  applyProject(p, o); window.dispatchEvent(new CustomEvent('gsone:project', { detail: { id: p.id, user: true } }));
}
/** A hash naming a user project (pendingHashWalk): applied here, before the sample fallback ever sees it. */
function takeUserHashWalk() {
  const hw = pendingHashWalk; if (!hw || !projectsOn()) return;
  const p = PROJECTS.find(x => x.id === hw.project); if (!p) return;
  pendingHashWalk = null;
  if (hw.keep && S.walk?.project === p.id && (!hw.option || hw.option === S.walk.option)) return;
  if (hw.option && !p.options.some(o => o.id === hw.option)) toast(`Option “${hw.option}” is not in ${p.name}: opened its first option.`);
  openUserProject(p, hw.option);
  if (hw.bus && !hw.option && String(hw.bus) !== String(S.nodeId) && indexOf(hw.bus)) { S.nodeId = String(hw.bus); S.basis = null; } // the link's bus is not an option: keep it (fix-1)
  if (hw.stage && STAGES.some(x => x.key === hw.stage)) S.stage = hw.stage;
  if (hw.tab && hw.stage) S.tabs[hw.stage] = hw.tab;
  if (hw.depth) S.depth = hw.depth;
}
const walkProject = () => (S.walk ? allProjects().find(p => p.id === S.walk.project) || null : null);
/** fix-1: a user project's option follows the bus in view (null when that bus is not one of its options). */
function syncOption() { const p = walkProject(); if (!p?.user) return; S.walk.option = p.options.find(o => String(o.busId) === String(S.nodeId))?.id ?? null; }
/** The open project (user or Dummy sample) for the bridge and the inspector; null when none. */
export const currentProject = () => walkProject();
const stage = () => STAGES.find(s => s.key === S.stage) || STAGES[4];
// A view may keep former tab ids as aliases (view.tabAlias, e.g. Market's find · rank · size · regions → map): the
// alias resolves to its tab here, and the view reads the raw S.tabs value once to open the matching section.
const activeTab = st => { if (!st.view) return null; const t = S.tabs[st.key]; if (st.view.tabs.find(x => x.id === t)) return t; const a = st.view.tabAlias?.[t] ?? st.view.tabAlias?.[String(t ?? '').toLowerCase()]; return a && st.view.tabs.find(x => x.id === a) ? a : st.view.tabs[0].id; };
const node = () => D.nodes.find(n => String(n.id) === String(S.nodeId));
const indexOf = id => D.index.find(n => n.id === String(id));

/** Load one bus's payload from the read-only API and merge it into D (idempotent). */
const busUse = []; // loaded bus ids, oldest use first (bounded cache: buscache.js)
function touchBus(id) { const i = busUse.indexOf(id); if (i >= 0) busUse.splice(i, 1); busUse.push(id); }
function evictBuses() {
  const opts = (walkProject()?.options || []).map(o => o.busId);
  for (const id of evictList(busUse, keepSet(S, opts))) {
    busUse.splice(busUse.indexOf(id), 1); busLoad.delete(id);
    D.nodes = D.nodes.filter(n => String(n.id) !== id); D.series = D.series.filter(x => String(x.nodeId) !== id);
    D.grid.headroom = D.grid.headroom.filter(r => String(r.bus_id) !== id); D.grid.constraints = D.grid.constraints.filter(r => String(r.bus_id) !== id);
    if (D.metadata.coverage) D.metadata.coverage = D.metadata.coverage.filter(c => String(c.nodeId) !== id);
  }
}
export function ensureBus(id) {
  id = String(id);
  if (busLoad.get(id) === 'ok') touchBus(id);
  if (busLoad.has(id)) return;
  busLoad.set(id, 'loading');
  fetch(`./api/bus/${encodeURIComponent(id)}`).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'bus not held' : `HTTP ${r.status}`))))
    .then(p => {
      D.nodes = D.nodes.filter(n => String(n.id) !== id).concat(p.nodes);
      D.series = D.series.filter(s => String(s.nodeId) !== id).concat(p.series);
      D.grid.headroom = D.grid.headroom.filter(r => String(r.bus_id) !== id).concat(p.grid.headroom);
      D.grid.constraints = D.grid.constraints.filter(r => String(r.bus_id) !== id).concat(p.grid.constraints);
      if (!D.metadata.createdAt) D.metadata = p.metadata; else D.metadata.coverage = [...(D.metadata.coverage || []).filter(c => String(c.nodeId) !== id), ...p.metadata.coverage];
      busLoad.set(id, 'ok'); touchBus(id); evictBuses();
      if (id === String(S.nodeId) && (!S.basis || String(S.basis.nodeId) !== id)) { resetBasisForNode(); }
      renderSoon();
    })
    .catch(e => { busLoad.set(id, e); renderSoon(); });
}
export const busReady = id => busLoad.get(String(id)) === 'ok' && busLoad.get('hub') === 'ok';
/** The load error for a bus, or null (Decision shows it instead of a spinner). */
export const busError = id => { const v = busLoad.get(String(id)); return v instanceof Error ? v : null; };

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
}

// ---------- Rendering ----------
const busLabel = b => `${b.name} · ${b.substation || ''} · ${b.kv ?? '?'} kV · ${b.zone || ''} · ${b.id}`;

const TECHS = [['solar', 'Solar'], ['wind', 'Wind'], ['storage', 'BESS'], ['datacenter', 'Data centre'], ['hybrid', 'Solar + storage']]; // live Studio order and labels
const CASE_LABEL = { sp: 'Summer peak', sh: 'Shoulder', ll: 'Large load' };
// ---------- v6 chrome: the live Studio's markup (chrome.js) fed from the preview's state ----------
/** Buses that fit each sweep size on every case the fuel needs (Grid element-study rule, marketcore.evaluate); cached per fuel and case. */
const sweepCache = new Map();
function sweepCounts() {
  const sizes = [100, 250, 500, 1000];
  if (!D.study) return sizes.map(size => ({ size, n: null }));
  const key = `${S.tech}`;
  if (!sweepCache.has(key)) {
    sweepCache.set(key, sizes.map(size => {
      const req = S.tech === 'datacenter' ? { tech: S.tech, exportMW: 0, importMW: size } : { tech: S.tech, exportMW: size, importMW: ['storage'].includes(S.tech) ? size : 0, useShoulder: true };
      return { size, n: evaluateMarket(D.study, req).filter(e => e.status === 'met').length };
    }));
  }
  return sweepCache.get(key);
}
let studyIdle = false;
/** The sweep needs the ISO-wide screening set: load it once, after first paint, whatever the stage. */
function ensureStudyIdle() {
  if (D.study || studyIdle) return; studyIdle = true;
  (window.requestIdleCallback || (f => setTimeout(f, 1500)))(() => fetch('./api/market').then(r => (r.ok ? r.json() : null)).then(j => { if (j && !D.study) { D.study = prepareMarket(j); renderSoon(); } }).catch(() => {}));
}

function chromeModel() {
  const st = stage(), cur = indexOf(S.nodeId), p = walkProject();
  const hz = S.basis ? describe(S.basis) : 'loading basis…';
  const hs = handoffStates(S, S.basis ? basisHash(S.basis) : null);
  const sent = ['prices', 'grid', 'economics'].filter(k => hs[k].state === 'current').length;
  const mwOpts = (list, v) => `${v == null ? '<option value="" selected>not held</option>' : ''}${[...new Set([...list, ...(v == null ? [] : [Number(v)])])].sort((a, b) => a - b).map(x => `<option value="${x}" ${v != null && Number(v) === x ? 'selected' : ''}>${x} MW</option>`).join('')}`;
  const mwTxt = v => (v == null ? 'not held' : `${v} MW`);
  const fc = S.basis?.mode === 'forecast', hy = basisYear();
  const years = S.basis ? availableYears(D, S.nodeId, 'historical', S.basis.market || 'RT').map(y => y.year) : [];
  const stages = STAGES.map(s => {
    const h = hs[s.key];
    return { key: s.key, name: s.name, active: !S.top && s.key === (ONLY || S.stage), state: h.state, why: h.state === 'none' ? h.why : `${h.state}: ${h.why}`,
      title: `${s.q} · ${h.state === 'none' ? h.why : `hand-off ${h.state} (${h.why})`}`, href: `./${PAGES[s.key]}#${toStudioHash({ ...hashNow(), stage: null, view: null, tab: null })}` };
  });
  const read = stages.filter(s => s.state === 'current').length;
  const sweep = sweepCounts().map(s => ({ ...s, on: Number(S.tech === 'datacenter' ? S.importMW : S.exportMW) === s.size,
    title: s.n == null ? 'Counting buses… (loads the ISO-wide screening set once)' : `${s.n.toLocaleString('en-US')} buses fit ${s.size} MW of ${S.tech} on the element-study cases; the shoulder case rests on the vendor envelope (context only) and light-load / minimum-load cases are not studied` }));
  const reqRaw = S.tech === 'datacenter' ? S.importMW : S.exportMW, reqMW = reqRaw == null || reqRaw === '' ? null : Number(reqRaw); // nullmw: never "null MW"
  // Gate row: the Decision gates for this bus at this request (Connect, Upgrade cost known, Queue, Land, Revenue/Load cost, Capture).
  const g = gateSummary();
  const others = S.pins.filter(id => id !== String(S.nodeId)).length;
  const nCmp = 1 + (S.ui.dOpts || []).filter(x => String(x) !== String(S.nodeId)).length;
  const tier = cur ? tierLabel(cur) : ['', 'not held'];
  const chips = selectionChips(S, p, indexOf).map(c => ({ ...c, title: `${c.current ? 'Current' : `Switch to ${c.label}`}${c.compare ? ' · in Decision compare' : ''}`,
    sub: (() => { const bus = p ? p.options.find(o => o.id === c.id)?.busId : c.id, b = indexOf(bus) || {}; return `${b.kv ?? '?'} kV · ${mwTxt(S.tech === 'datacenter' ? S.importMW : S.exportMW)} · ${c.current ? (p ? 'Shortlisted' : 'Current') : c.compare ? 'In compare' : 'Exploring'}`; })(),
    label: p ? (indexOf(p.options.find(o => o.id === c.id)?.busId)?.name || c.label) : c.label, title: `${c.title} · ${p ? `${c.label} · #${p.options.find(o => o.id === c.id)?.busId}` : `#${c.id}`}` }));
  const cardsShown = document.querySelectorAll('[role="tabpanel"] section.card:not([hidden])').length;
  const user = !!p?.user, pOpt = id => `<option value="${esc(id.id)}" ${p?.id === id.id ? 'selected' : ''}>${esc(id.user ? id.name : projectsOn() ? `Dummy — ${id.name}` : id.name)}</option>`;
  const wsOptions = projectsOn() ? `${PROJECTS.length ? `<optgroup label="My projects">${PROJECTS.map(pOpt).join('')}</optgroup>` : ''}<optgroup label="Dummy samples (read-only)">${SAMPLES.projects.map(pOpt).join('')}</optgroup>` : SAMPLES.projects.map(pOpt).join('');
  return {
    only: !!ONLY, modal: S.ui.modal, busId: String(S.nodeId), pinned: S.pins.includes(String(S.nodeId)), projectsOn: projectsOn(), continuumOn: featureOn('continuum') && !ONLY, top: S.top,
    proj: p ? { user, name: p.name, option: S.walk?.option || '', opts: (S.walk?.option == null && user ? '<option value="" selected>(bus in view: not an option)</option>' : '') + p.options.map(o => `<option value="${esc(o.id)}" ${o.id === S.walk?.option ? 'selected' : ''}>${esc(`${o.label || indexOf(o.busId)?.name || o.busName || 'Bus'} · ${o.busId}`)}</option>`).join('') } : null,
    ws: { options: `<option value="" ${p ? '' : 'selected'}>ISO-NE screening (single bus)</option>${wsOptions}`, ic: p ? p.name[0] : 'I', name: p ? p.name : 'ISO-NE screening', sub: p ? (user ? `${p.client_type || 'My project'} · ${p.tech} · ${PRJ.statedCount(p).stated} of ${PRJ.statedCount(p).total} inputs stated` : `${p.client_type || 'Sample project'} · ${p.tech} · illustrative inputs`) : 'ISO-NE · analyzer preview · single bus', title: p ? p.narrative || p.name : 'No project in scope: pick a sample project from Projects' },
    search: { value: cur ? busLabel(cur) : '', options: D.index.map(b => `<option value="${esc(busLabel(b))}"></option>`).join(''), n: fmtInt(D.index.length) },
    built: D.metadata.createdAt?.slice(0, 16).replace('T', ' ') || '…', engine: D.metadata.createdAt?.slice(0, 10) || '…', nBuses: fmtInt(D.index.length), sample: (!user && p?.name) || null,
    nSamples: SAMPLES.projects.length + (projectsOn() ? PROJECTS.length : 0), nPins: S.pins.length, nScen: S.scenarios.length, readLine: `${read} of 7 sent`, stages,
    techOpts: TECHS.map(([v, l]) => `<option value="${v}" ${S.tech === v ? 'selected' : ''}>${l}</option>`).join(''),
    exportOpts: mwOpts([0, 50, 100, 150, 250, 500, 1000], S.exportMW), importOpts: mwOpts([0, 25, 50, 100, 250, 500, 1000], S.importMW), showImport: S.tech === 'storage' || S.tech === 'hybrid', sizeIsImport: S.tech === 'datacenter',
    yearOpts: `${!fc && hy == null ? `<option value="" selected>${S.basis ? 'multi-year' : '…'}</option>` : ''}<optgroup label="Settled (real-time)">${years.map(y => `<option value="h${y}" ${!fc && hy === y ? 'selected' : ''}>${y}</option>`).join('')}</optgroup><optgroup label="Forecast (solved run)">${HZ_YEARS.map(y => `<option value="f${y}" ${fc && S.hz === y ? 'selected' : ''} ${hzRun(y) ? '' : 'disabled title="Not held: the vendor 2045/2050 figures were a flat escalation"'}>${y}</option>`).join('')}</optgroup>`,
    caseOpts: CASE_KEYS.map(k => `<option value="${k}" ${S.caseKey === k ? 'selected' : ''}>${CASE_LABEL[k]}</option>`).join(''),
    sweep, depth: S.depth, scopeOpen: !!S.ui.scopeOpen, guidedOn: !!(S.walk && !S.walkHidden), guidedStep: p?.steps?.length ? ` · ${(S.walk.step || 0) + 1}/${p.steps.length}` : '',
    guidedTitle: p ? (S.walkHidden ? 'Show the guided review bar (g)' : 'Hide the guided review bar (g)') : 'Choose a sample project and walk the seven dashboards (g)',
    score: { a: sent, b: 3, note: S.basis ? (S.basis.mode === 'forecast' ? `${S.basis.run} run` : `${S.basis.market} ${S.basis.years.length === 1 ? S.basis.years[0] : `${S.basis.years.length} yrs`}`) : '…', title: 'Hand-offs current for this bus and these inputs: Prices → Economics, Grid → Economics, Economics → Finance/Decision. No combined score: the preview never weights criteria into one number.' },
    analyses: `${st.view?.tabs.length || 0} ${st.view?.tabs.length === 1 ? 'analyzer' : 'analyzers'} · ${cardsShown || '—'} cards · ${DEPTH_LABEL[S.depth]}`,
    head: (() => { const tid = activeTab(st), tv = st.view?.tabs.find(x => x.id === tid); return { key: st.key, cfg: featureOn('configurator') && !!st.view, idx: STAGES.indexOf(st) + 1, name: st.name, question: STAGE_Q[st.key] || st.q, tabName: tv ? tabName(st.key, tid, S.tech, tabLabel(tv, S.tech)) : '', tabQ: TAB_Q[st.key]?.[tid] || '', tag: st.view?.tabs.length === 1 ? 'one view' : `${st.view?.tabs.length || 0} tabs`, depth: S.depth }; })(),
    band: {
      kill: { state: g.state, tone: g.fail ? 'bad' : g.pass === g.total && g.total ? 'ok' : 'warn', label: g.total ? g.label : (g.label || 'gates loading'),
        title: g.lines, text: g.kill, src: `${cur?.name || S.nodeId} ${cur?.kv ?? ''} kV · ${reqMW == null ? 'size not held' : `${reqMW} MW`} · ${CASE_LABEL[S.caseKey]}` },
      ctx: { kick: user ? `My project · ${p.name}` : p ? 'Active review' : 'Single bus', name: cur ? `${cur.name} ${cur.kv ?? ''} kV` : String(S.nodeId), sub: `${reqMW == null ? 'size not held ·' : `${reqMW} MW`} ${S.tech} · ${CASE_LABEL[S.caseKey]} · ${hy || (fc ? S.hz : 'multi-year')}`, title: `${cur ? busLabel(cur) : ''} · price node ${cur?.pnode || 'not held'}` },
      facts: [
        { k: 'Decision gates', v: g.dec?.label ?? '…', tone: g.dec?.tone || '', title: g.dec?.lines || '', act: 'goto', v2: 'decision', tab: 'compare' },
        { k: 'Evidence', v: tier[1], tone: tier[0], cls: 'mapping-note', html: `${esc(tier[1])} <code class="gsx-pn">${esc(cur?.pnode || 'no price node')}</code>`, title: `Historical prices for this bus come from ${cur?.pnode || 'not held'}${cur?.tier === 'geo_proxy' && Number(cur.proxyKm) >= 0.05 ? ': a neighbouring node, so its congestion and losses are the neighbour’s' : cur?.tier === 'relinked' ? ` (D-008: the rank-1 node ${cur.relinkedFrom || ''} was too far to be this bus’s price, so it is read through the nearest co-located node)` : ''}` },
        { k: 'Hand-offs', v: `${sent} of 3 current`, tone: Object.values(hs).some(h => h.state === 'stale') ? 'warn' : sent ? 'ok' : '', title: 'Prices, Grid and Economics results sent for this bus and these inputs' },
        { k: 'Shortlist', v: `${S.pins.length} pinned · ${nCmp} in compare`, act: 'goto', v2: 'decision', tab: 'compare', title: 'Decision compares the current bus with up to two others' },
      ],
      flags: [...(cur?.tier === 'geo_proxy' && Number(cur.proxyKm) >= 0.05 ? [{ tone: 'warn', text: 'borrowed price', title: 'This bus has no settlement node of its own; its historical prices are a neighbour\'s.' }] : []),
        ...(cur?.tier === 'relinked' ? [{ tone: 'warn', text: 'relinked price', title: `${tier[1]} (D-008)` }] : []),
        ...(p && !user ? [{ tone: 'warn', text: 'sample · illustrative inputs', title: p.assumptions?.label || '' }] : []),
        ...(user ? [{ tone: '', text: `my project · ${PRJ.statedCount(p).stated} of ${PRJ.statedCount(p).total} stated`, title: 'Inputs the developer stated; every other input is a labelled default (Inspector › Project inputs)' }] : []),
        { tone: '', cls: 'gsx-basis', text: hz, title: 'Price basis applied on every dashboard (one bus, one price)' }],
    },
    sel: { label: p ? 'Selection' : 'Selection', chips, note: p ? 'switches every analyzer to that option\'s bus; the price basis and depth are kept' : 'the current bus and your pinned buses; pin more with the pin in the top bar' },
    foot: { showText: !!S.showText, others, built: D.metadata.createdAt?.slice(0, 10) || '…', nBuses: fmtInt(D.index.length), sample: !!p && !user },
  };
}

/** Gate summary for the band, from decisioncore (the same gates Decision shows); memoised on the inputs. */
let gateMemo = { key: null, val: null };
function gateSummary() {
  const n = node();
  if (!n || !busReady(S.nodeId) || !S.basis) return { total: 0, pass: 0, fail: 0, state: 'unknown', lines: 'Loading this bus…', kill: 'Gates load with the bus.' };
  // nullmw: a required size that is not held gets no verdict (never a 0 MW screen): the band says so on every stage.
  const miss = sizeNotHeld(S);
  if (miss) return { total: 0, pass: 0, fail: 0, state: 'unknown', label: 'size not held', lines: `${miss} is not held for ${S.tech}: no gate is computed.`, kill: `${SIZE_NOT_HELD[0].toUpperCase()}${SIZE_NOT_HELD.slice(1)}.`,
    dec: { pass: 0, hold: 0, fail: 0, label: 'size not held', lines: SIZE_NOT_HELD, tone: 'warn' } };
  // The key names every input candidateTally reads besides the bus payload: Decision thresholds, the Grid hand-off, the
  // fleet shape, and (S3/S5) the Queue COD year, service and profile, the tax inputs and Land's site control.
  const key = JSON.stringify([S.nodeId, S.tech, S.exportMW, S.importMW, basisHash(S.basis), !!D.queue, !!D.land, S.ui.decision || null, Object.keys(S.ui).filter(k => k.startsWith('dTh_')).map(k => S.ui[k]), S.handoffs.grid?.at || null, fleetProfile().status,
    S.ui.qCod ?? null, S.ui.qService ?? null, !!S.ui.qRegLimit, S.ui.qProfile ?? null, S.ui.tax || null, S.ui.land?.control ?? null]);
  if (gateMemo.key === key) return gateMemo.val;
  let val;
  try {
    const e = S.ui.econ || {};
    const p = { tech: S.tech, exportMW: S.exportMW, importMW: S.importMW, basis: S.basis, cf: (S.tech === 'wind' ? (e.windCF ?? 32.5) : (e.solarCF ?? 15)) / 100, lossPct: e.lossPct ?? 3 };
    const m = optionMetrics(D, n, p);
    // The stage's out-criteria ("Stop here if", 2 gates) come from gridrules.screeningGates: the one rule the strip and
    // Grid share (F001/F009/D3); envelope-only and unstudied cases are unknown, never met. Decision's gates come from
    // candidateTally: the one tally every surface prints (strip, band, inspector, Decision), never a second computation.
    const sg = screeningGates(m.cases || [], S.tech), dt = candidateTally(D, S);
    const kill = S.tech === 'datacenter' ? `the import limit on the large-load or summer-peak charge case is below ${S.importMW} MW, or a limiting facility is overloaded before any transfer here.`
      : `the ${['storage', 'hybrid'].includes(S.tech) ? 'export or shoulder-charge' : 'export'} limit on any case the fuel needs is below the request, or a limiting facility is overloaded before any transfer here.`;
    val = { total: sg.total, pass: sg.met, fail: sg.notMet, state: sg.state, label: sg.label, lines: sg.lines, kill,
      dec: dt ? { pass: dt.pass, hold: dt.hold, fail: dt.fail, lines: dt.title, label: dt.label, tone: dt.tone } : null };
  } catch (err) { val = { total: 0, pass: 0, fail: 0, state: 'unknown', lines: `Gates not computed: ${err.message}`, kill: 'Gates not computed.' }; }
  gateMemo = { key, val };
  return val;
}

/** Guided walkthrough bar: project, option, step i of n, where, what to look at, Prev/Next. */
function walkBar() {
  const w = S.walk; if (!w) return '';
  const up = projectsOn() ? PROJECTS.find(x => x.id === w.project) : null;
  if (up) return userBar(up);
  const p = SAMPLES.projects.find(x => x.id === w.project);
  if (!p) return samplesState === 'loading' ? '' : `<section class="walk"><div class="walk-h"><span class="pill warn">Sample</span><span>The sample project "${esc(w.project)}" is not in data/samples.json.</span><div class="walk-nav"><button class="tiny quiet" data-act="walk-exit">Close</button></div></div></section>`;
  const n = p.steps.length, i = Math.min(w.step || 0, Math.max(0, n - 1)), r = n ? resolveStep(p.steps[i], STAGES) : null;
  const st = r && STAGES.find(s => s.key === r.stage), tb = st?.view?.tabs.find(t => t.id === r.tab);
  const where = r ? `${st.name}${tb ? ` › ${tabLabel(tb, S.tech)}` : ''}${r.focus ? ` · ${tabName(st.key, r.focus, S.tech)}` : ''} · ${DEPTH_LABEL[r.depth]}` : 'no steps';
  const off = r && (S.stage !== r.stage || (r.tab && activeTab(stage()) !== r.tab) || S.depth !== r.depth);
  const opt = p.options.find(o => o.id === w.option) || p.options[0];
  const mw = [p.exportMW ? `${p.exportMW} MW export` : '', p.importMW ? `${p.importMW} MW import` : ''].filter(Boolean).join(' · ');
  const stops = p.steps.map((s, k) => { const rr = resolveStep(s, STAGES), ss = rr && STAGES.find(x => x.key === rr.stage), tt = ss?.view?.tabs.find(x => x.id === rr.tab); return `<option value="${k}" ${k === i ? 'selected' : ''}>${k + 1}. ${esc(ss?.name || s.stage)} / ${esc(tt ? tabLabel(tt, S.tech) : s.tab)}${rr?.focus ? ` · ${esc(tabName(ss.key, rr.focus, S.tech))}` : ''}</option>`; }).join('');
  return `<section class="walk" aria-label="Guided walkthrough">
    <div class="walk-h"><span class="pill good">Sample</span><b class="walk-name" title="${esc(p.narrative || '')}">${esc(p.name)}</b><span class="walk-meta">${esc([p.client_type, p.tech, mw].filter(Boolean).join(' · '))}</span>
      <label class="walk-opt">Option<select data-act="sample-opt">${p.options.map(o => `<option value="${esc(o.id)}" ${o.id === opt.id ? 'selected' : ''} title="${esc(o.note || '')}">${esc(o.label)} · ${esc(o.busId)}</option>`).join('')}</select></label>
      <label class="walk-opt">Analyzer<select data-act="walk" aria-label="Jump to analyzer">${stops}</select></label>
      <div class="walk-nav"><span class="walk-n">Step ${n ? i + 1 : 0} of ${n}</span><button type="button" class="tiny" data-act="walk" data-v="prev" ${i <= 0 ? 'disabled' : ''}>Prev</button><button type="button" class="tiny primary" data-act="walk" data-v="next" ${i >= n - 1 ? 'disabled' : ''}>Next</button><button type="button" class="tiny quiet" data-act="walk-exit" title="Leave the walkthrough (your settings stay)">Exit</button></div></div>
    <div class="walk-b"><span class="walk-where">${esc(where)}</span>${off ? '<button type="button" class="tiny" data-act="walk" data-v="here">Back to this step</button>' : ''}<p class="walk-what">${p.steps[i]?.option && p.steps[i].option !== S.walk.option ? `<span class="pill warn" title="This stop's figures were computed for that option; the dashboards below show your current option.">written for ${esc(p.options.find(o => o.id === p.steps[i].option)?.label || p.steps[i].option)}</span> ` : ''}${esc(r?.text || '')}</p></div>
    ${p.assumptions || p.narrative || opt.note ? `<details class="walk-assumptions"><summary>Demo inputs and evidence</summary>${p.narrative ? `<p class="walk-narr">${esc(p.narrative)}</p>` : ''}${opt.note ? `<p class="walk-note"><b>${esc(opt.label)}:</b> ${esc(opt.note)}</p>` : ''}${p.assumptions ? `<p class="walk-note"><b>Demo inputs:</b> ${esc(p.assumptions.label)}.</p><p class="walk-note"><b>Current bus’s illustrative year-one revenue:</b> ${esc(Number.isFinite(p.assumptions.optionAnnualRevenue?.[S.nodeId]) ? `$${p.assumptions.optionAnnualRevenue[S.nodeId].toLocaleString('en-US')}` : 'not held')}. ${esc(S.nodeId === p.options[0].busId ? p.assumptions.revenueMethod || '' : 'Option-specific price or spread changes this planning input; it is not an executed contract.')}</p><p class="walk-note">${esc(p.assumptions.networkUpgradeMethod || '')}</p>${Object.entries(p.assumptions.provenance || {}).map(([k, v]) => `<p class="walk-note"><b>${esc(k)}:</b> ${esc(v)}</p>`).join('')}<p class="walk-note"><b>Still open:</b> ${esc((p.coverage?.openEvidence || []).join('; '))}.</p>` : ''}</details>` : ''}</section>`;
}

/** The open user project's bar (no guided stops): name, inputs stated, option switcher, add the current bus, inputs. */
function userBar(p) {
  const sc = PRJ.statedCount(p), opt = p.options.find(o => o.id === S.walk.option), cur = String(S.nodeId), isOpt = p.options.some(o => String(o.busId) === cur);
  const mw = [p.exportMW ? `${p.exportMW} MW export` : '', p.importMW ? `${p.importMW} MW import` : ''].filter(Boolean).join(' · ');
  return `<section class="walk gsx-proj-bar" aria-label="My project" data-gsx-proj="${esc(p.id)}">
    <div class="walk-h"><span class="pill">My project</span><b class="walk-name">${esc(p.name)}</b><span class="walk-meta">${esc([TECHS.find(t => t[0] === p.tech)?.[1] || p.tech, mw, `${sc.stated} of ${sc.total} inputs stated`].filter(Boolean).join(' · '))}</span>
      <label class="walk-opt">Option<select data-act="sample-opt">${opt ? '' : '<option value="" selected>(bus in view: not an option)</option>'}${p.options.map(o => `<option value="${esc(o.id)}" ${o.id === opt?.id ? 'selected' : ''}>${esc(`${o.label || indexOf(o.busId)?.name || o.busName || 'Bus'} · ${o.busId}`)}</option>`).join('')}</select></label>
      <div class="walk-nav">${isOpt ? '' : `<button type="button" class="tiny" data-act="proj-add-opt" data-v="${esc(cur)}" title="Add the bus in view (${esc(indexOf(cur)?.name || cur)}) as an option of ${esc(p.name)}">Add option: ${esc(indexOf(cur)?.name || cur)}</button>`}<button type="button" class="tiny primary" data-act="proj-inputs">Project inputs</button><button type="button" class="tiny quiet" data-act="walk-exit" title="Close the project (it stays saved in this browser)">Close</button></div></div></section>`;
}

const KM_PER_MI = 1.609344; // unit conversion (busdata.KM_PER_MI), not a market parameter
/** The price-link tier as a [tone, label] pill: one home for the band's Evidence fact, its flag and the mapping note.
 *  `relinked` (D-008, busdata.price_links): the rank-1 price node was farther than any geo-proxy link, so the bus is
 *  priced through the nearest co-located node and the far node it left is disclosed with its distance. */
function tierLabel(b) {
  const km = Number(b.proxyKm);
  if (b.tier === 'relinked') {
    const mi = Number.isFinite(Number(b.relinkedFromMi)) ? Number(b.relinkedFromMi) : Number.isFinite(Number(b.relinkMi)) ? Number(b.relinkMi) : Number.isFinite(km) ? km / KM_PER_MI : null;
    return ['warn', `relinked · ${mi == null ? 'distance not held' : `${mi.toFixed(1)} mi`} from ${b.relinkedFrom || 'the rank-1 node'}`];
  }
  return { direct: ['ok', 'Own price node'], same_substation: ['', 'Same-substation price node'], geo_proxy: km < 0.05 ? ['', 'Co-located price node'] : ['warn', `Borrowed price · ${km.toFixed(1)} km`] }[b.tier] || ['warn', b.tier];
}
/** Price-mapping pill with the full sentence as its tooltip (the live Studio's "Exact hourly mapping" chip). */
function mappingNote(b) {
  if (!b) return '';
  if (S.basis?.mode === 'forecast') return `<span class="mapping-note" title="${esc(`Forecast prices are modelled for this bus itself (model bus ${b.id}); nothing is borrowed. Historical prices come from ${b.pnode}${b.tier === 'geo_proxy' ? ' (a neighbouring node)' : b.tier === 'relinked' ? ' (relinked, D-008)' : ''}.`)}"><span class="pill good">Own forecast</span></span>`;
  const km = Number(b.proxyKm);
  const t0 = tierLabel(b), t = [t0[0] === 'ok' ? 'good' : t0[0], t0[1]];
  const why = `Historical prices for this bus come from ${b.pnode}.${b.tier === 'geo_proxy' && km >= 0.05 ? ' This bus has no settlement node of its own, so its historical congestion and losses are the neighbour\'s, not its own.' : b.tier === 'relinked' ? ` D-008: the rank-1 price node ${b.relinkedFrom || ''} is farther than any geo-proxy link (${t[1].replace(/^relinked · /, '').replace(/ from .*$/, '')}), so this bus is priced through the nearest co-located node.` : ''}`;
  return `<span class="mapping-note" title="${esc(why)}"><span class="pill ${t[0]}">${esc(t[1])}</span> <span class="mono-s">${esc(b.pnode || '')}</span>${b.hist === false ? ' <span class="pill warn">No price history: use a forecast run</span>' : ''}</span>`;
}

function mainView() {
  const st = stage(), head = '';
  if (!st.view) {
    return `${head}<div class="notice">This dashboard has not been redesigned yet in the preview. You are seeing the copied Studio, isolated from the live app.</div>
      <iframe class="legacy" title="${esc(st.name)} (copied Studio)" src="./legacy.html#v=stage&stage=${st.key}&project=kennebec&option=o2&depth=study"></iframe>`;
  }
  const tab = activeTab(st);
  const bl = busLoad.get(String(S.nodeId)), hl = busLoad.get('hub');
  if (bl instanceof Error || hl instanceof Error) return `${head}<div class="notice error" role="alert">Could not load data for this bus: ${esc((bl instanceof Error ? bl : hl).message)}. Pick another bus.</div>`;
  if (!busReady(S.nodeId)) return `${head}<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Loading hourly prices for ${esc(indexOf(S.nodeId)?.name || S.nodeId)}</b><span>Six years of history and five forecast runs are read from the local database: about 5–8 s the first time, instant after that.</span></div>`;
  // A view with its own bar (Market, Land, Grid: the map and the categories as buttons, views/mapview.js) draws its tabs.
  const tabs = st.view.tabs.length < 2 || st.view.ownTabs ? '' : `<div class="tabs" role="tablist">${st.view.tabs.map(t => `<button role="tab" aria-selected="${t.id === tab}" tabindex="${t.id === tab ? 0 : -1}" class="${t.id === tab ? 'active' : ''}" data-act="tab" data-v="${t.id}" title="${esc(TAB_Q[st.key]?.[t.id] || tabLabel(t, S.tech))}">${esc(tabName(st.key, t.id, S.tech, tabLabel(t, S.tech)))}</button>`).join('')}</div>`;
  let body;
  try { body = st.render(tab, { data: D, S, node: node(), ensureBus, busReady, busError, depth: S.depth, tech: S.tech, caseKey: S.caseKey, caseScenario: caseScenario(S.caseKey), hz: S.hz, hzRun: hzRun(S.hz) }); } catch (e) { console.error(e); body = `<div class="notice error" role="alert">Could not compute this analysis: ${esc(e.message)}</div>`; }
  if (st.view.tabAlias?.[S.tabs[st.key]]) S.tabs[st.key] = tab; // a former tab id (an alias) is consumed by the one render that read it
  return `${head}${tabs}<section role="tabpanel">${body}</section>`;
}

function pinsModal() {
  const wp = walkProject(), up = wp?.user ? wp : null;
  const projBtns = id => (!projectsOn() || !indexOf(id) ? '' : `${up && !up.options.some(o => String(o.busId) === id) ? ` <button class="tiny" data-act="proj-add-opt" data-v="${esc(id)}" title="Add this bus as an option of ${esc(up.name)}">Add option</button>` : ''} <button class="tiny quiet" data-act="proj-new-here" data-v="${esc(id)}">New project here</button>`);
  const rows = S.pins.map(id => { const b = indexOf(id); return `<tr><td>${esc(b?.name || 'not in the bus index')}</td><td>${esc(b?.substation || '')}</td><td>${esc(b?.zone || '')}</td><td>${esc(b?.tier || '')}</td><td class="num">${esc(id)}</td><td>${id === String(S.nodeId) ? '<span class="pill good">Current</span>' : ''}</td><td><button class="tiny" data-act="node" data-v="${esc(id)}" ${b ? '' : 'disabled'}>Open</button> <button class="tiny quiet" data-act="pin" data-v="${esc(id)}">Unpin</button>${projBtns(id)}</td></tr>`; }).join('');
  const others = S.pins.filter(id => id !== String(S.nodeId)).length;
  return `<div class="modal-backdrop" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="Pinned buses">
    <div class="modal-head"><h2>Pinned buses</h2><div class="actions"><button class="primary" data-act="compare-pinned" ${others ? '' : 'disabled'}>Compare in Decision</button>${S.pins.length ? '<button class="quiet" data-act="clear-pins">Clear</button>' : ''}<button data-act="close-modal">Close</button></div></div>
    ${S.pins.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Bus</th><th>Substation</th><th>Zone</th><th>Price node</th><th class="num">Id</th><th></th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><strong>No pinned buses</strong>Use the pin next to the bus search to pin the current bus.</div>'}
    <p class="audit-note">Decision compares the current bus with up to two pinned buses${others > 2 ? `; ${others - 2} more pinned will not be loaded` : ''}. Pins are stored in this browser only.</p></div></div>`;
}

/** Projects: the sample projects, each a guided review across the seven dashboards. */
function samplesModal() {
  const cards = SAMPLES.projects.map(p => {
    const mw = [p.exportMW ? `${p.exportMW} MW export` : '', p.importMW ? `${p.importMW} MW import` : ''].filter(Boolean).join(' · ');
    const on = S.walk?.project === p.id;
    return `<article class="proj-card ${on ? 'on' : ''}"><header><b>${projectsOn() ? 'Dummy — ' : ''}${esc(p.name)}</b><span class="pill">${esc(TECHS.find(t => t[0] === p.tech)?.[1] || p.tech)}</span></header>
      <div class="proj-meta">${esc([p.client_type, mw, `${p.options.length} options`, `${p.steps.length} guided stops`].filter(Boolean).join(' · '))}</div>
      <p>${esc(p.narrative || '')}</p>
      <ul>${p.options.map(o => `<li><b>${esc(o.label)}</b> · ${esc(o.busName || '')} ${esc(o.busId)}</li>`).join('')}</ul>
      <button class="${on ? '' : 'primary'}" data-act="sample" data-v="${esc(p.id)}">${on ? 'Restart guided review' : 'Start guided review'}</button></article>`;
  }).join('');
  const cur = String(S.nodeId), mine = !projectsOn() ? '' : `<h3>My projects</h3>${PROJECTS.length ? `<div class="proj-grid gsx-my-projects">${PROJECTS.map(p => {
    const on = S.walk?.project === p.id, sc = PRJ.statedCount(p), mw = [p.exportMW ? `${p.exportMW} MW export` : '', p.importMW ? `${p.importMW} MW import` : ''].filter(Boolean).join(' · ');
    return `<article class="proj-card ${on ? 'on' : ''}" data-gsx-user-project="${esc(p.id)}"><header><b>${esc(p.name)}</b><span class="pill">${esc(TECHS.find(t => t[0] === p.tech)?.[1] || p.tech)}</span></header>
      <div class="proj-meta">${esc([p.client_type, mw, `${p.options.length} option${p.options.length === 1 ? '' : 's'}`, `${sc.stated} of ${sc.total} stated`, p.created ? `created ${p.created}` : ''].filter(Boolean).join(' · '))}</div>
      <ul>${p.options.map(o => `<li><b>${esc(o.label || o.id)}</b> · ${esc(indexOf(o.busId)?.name || o.busName || '')} ${esc(o.busId)} · ${esc(o.status)}</li>`).join('')}</ul>
      <div class="actions"><button class="${on ? '' : 'primary'}" data-act="sample" data-v="${esc(p.id)}">${on ? 'Open' : 'Open project'}</button>${p.options.some(o => String(o.busId) === cur) ? '' : `<button class="quiet" data-act="proj-add-opt" data-v="${esc(cur)}" data-p="${esc(p.id)}">Add ${esc(indexOf(cur)?.name || cur)} as an option</button>`}<button class="quiet" data-act="proj-del" data-v="${esc(p.id)}">Delete</button></div></article>`;
  }).join('')}</div>` : '<div class="empty"><strong>No projects of your own yet</strong>New project starts one on the bus in view (or any bus) with the few inputs you know.</div>'}
    <h3>Dummy samples (read-only)</h3>`;
  return `<div class="modal-backdrop" data-act="close-modal"><div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="${projectsOn() ? 'Projects' : 'Sample projects'}">
    <div class="modal-head"><h2>${projectsOn() ? 'Projects' : 'Sample projects'}</h2><div class="actions">${projectsOn() ? `<button class="primary" data-act="open-new-project">New project</button><button class="quiet" data-act="proj-export" ${PROJECTS.length ? '' : 'disabled'}>Export JSON</button><label class="btn quiet gsx-import">Import JSON<input type="file" accept="application/json,.json" data-gsx-import hidden></label>` : ''}${S.walk ? '<button class="quiet" data-act="walk-exit">Leave the project</button>' : ''}<button data-act="close-modal">Close</button></div></div>
    ${mine}
    ${SAMPLES.projects.length ? `<div class="proj-grid">${cards}</div>` : `<div class="empty"><strong>No sample projects</strong>${esc(samplesState === 'loading' ? 'Loading data/samples.json…' : 'data/samples.json is not available: run python plan/build_samples.py')}</div>`}
    <p class="audit-note">Buses, prices, limits, queue and land figures are read from the database; revenue, capital, site and schedule inputs are illustrative planning assumptions, labelled wherever they appear.</p></div></div>`;
}

/** New project (plan 14 §6): the few inputs the developer knows; the bus is pre-filled when started from a bus. Fields carry
 *  data-np (no data-act: typing never re-renders); "Create" validates with projects.js and shows each reason under its field. */
let npDraft = null, npErr = {};
const busText = id => { const b = indexOf(id); return b ? busLabel(b) : String(id ?? ''); };
const busFromText = v => { const t = String(v || '').trim(); const id = (t.match(/·\s*(\d+)\s*$/) || [])[1] || (/^\d+$/.test(t) ? t : (D.index.find(b => b.name.toLowerCase() === t.toLowerCase()) || {}).id); return id && indexOf(id) ? String(id) : null; };
function newProjectModal() {
  const d = npDraft || { tech: S.tech, bus: busText(S.nodeId) };
  const f = (k, label, ctl, help = '') => `<label class="gsx-np-f${npErr[k] ? ' bad' : ''}" data-np-f="${k}"><span class="gsx-np-l">${esc(label)}</span>${ctl}${help ? `<small>${esc(help)}</small>` : ''}${npErr[k] ? `<em class="gsx-np-err" role="alert" data-np-err="${k}">${esc(npErr[k])}</em>` : ''}</label>`;
  const inp = (k, type = 'text', extra = '') => `<input data-np="${k}" type="${type}" value="${esc(d[k] ?? '')}" ${extra}>`;
  const sel = (k, opts) => `<select data-np="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(d[k] ?? '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `<div class="modal-backdrop" data-act="close-modal"><div class="modal gsx-np" role="dialog" aria-modal="true" aria-label="New project">
    <div class="modal-head"><h2>New project</h2><button data-act="close-modal">Close</button></div>
    <p class="audit-note">Only what you know. Every other input every dashboard needs is a labelled default from rules/isone-2026/defaults.json (or the bus), never a typed number; edit any of them later in Inspector › Project inputs.</p>
    <div class="gsx-np-grid">
      ${f('name', 'Project name *', inp('name', 'text', 'maxlength="120" autocomplete="off"'))}
      ${f('bus', 'Connection bus *', inp('bus', 'text', 'list="bus-list" autocomplete="off" spellcheck="false"'), 'Any of the ISO-NE buses: name, substation or id')}
      ${f('tech', 'Technology *', sel('tech', TECHS))}
      ${f('exportMW', 'Export MW', inp('exportMW', 'number', 'step="any" min="0"'), 'Solar, wind, storage, hybrid (required for those)')}
      ${f('importMW', 'Import / charge MW', inp('importMW', 'number', 'step="any" min="0"'), 'Storage, hybrid, data centre (required for storage and data centre)')}
      ${f('cod', 'Target COD *', inp('cod', 'number', 'step="1" min="2026" max="2050"'), 'Year, 2026–2050')}
      ${f('service', 'Interconnection service', sel('service', [['', 'not stated'], ...PRJ.SERVICES.map(s => [s, s])]))}
      ${f('client_type', 'Client type', inp('client_type', 'text', 'maxlength="80"'))}
    </div>
    <div class="actions gsx-np-acts"><button class="primary" data-act="np-create">Create project</button><button data-act="close-modal">Cancel</button></div></div></div>`;
}
/** Ctrl-K: the command palette (new project, add option, open a project, the LMP Continuum, the seven stages). */
function paletteModal() {
  const p = walkProject(), cur = String(S.nodeId), b = indexOf(cur), cmd = (act, v, label, extra = '') => `<button type="button" class="gsx-pal-i" data-act="${act}" data-v="${esc(v)}" ${extra}>${esc(label)}</button>`;
  const items = [
    ...(projectsOn() ? [cmd('open-new-project', '', 'New project…'), cmd('proj-new-here', cur, `New project here: ${b?.name || cur} · ${cur}`)] : []),
    ...(projectsOn() && p?.user && !p.options.some(o => String(o.busId) === cur) ? [cmd('proj-add-opt', cur, `Add option: ${b?.name || cur} → ${p.name}`)] : []),
    ...(projectsOn() && p?.user ? [cmd('proj-inputs', '', `Project inputs: ${p.name}`)] : []),
    ...allProjects().map(x => cmd('sample', x.id, `Open project: ${x.user ? x.name : `${projectsOn() ? 'Dummy — ' : ''}${x.name}`}`)),
    ...(featureOn('continuum') && !ONLY ? [cmd('continuum', '', 'Open LMP Continuum')] : []),
    ...STAGES.map((s, i) => cmd('stage', s.key, `Go to ${i + 1} · ${s.name}`)),
    cmd('open-pins', '', 'Pinned buses'), cmd('open-scenarios', '', 'Saved scenarios'),
  ];
  return `<div class="modal-backdrop" data-act="close-modal"><div class="modal gsx-pal" role="dialog" aria-modal="true" aria-label="Command palette">
    <input class="gsx-pal-q" data-pal placeholder="Type a command: new project, add option, open, continuum, a stage…" aria-label="Command" autocomplete="off">
    <div class="gsx-pal-list" role="list">${items.join('')}</div><p class="audit-note">Enter runs the first match · Esc closes.</p></div></div>`;
}

/** Inputs & evidence (live Studio drawer): the basis, every hand-off, the sample's inputs and provenance, and what is still open. */
function evidenceModal() {
  const p = walkProject(), hs = handoffStates(S, S.basis ? basisHash(S.basis) : null);
  const H = S.handoffs || {};
  const row = (k, v, src, note = '') => `<tr><td>${esc(k)}</td><td class="wrap">${esc(v)}</td><td>${src ? `<span class="pill ${src === 'assumption' ? 'warn' : src === 'measured' ? 'good' : ''}">${esc(src)}</span>` : ''}</td><td class="wrap">${esc(note)}</td></tr>`;
  const basisRows = [
    row('Price basis', S.basis ? describe(S.basis) : 'loading', 'measured', 'One bus, one price: every price figure on every dashboard uses this basis'),
    row('Study case (Grid focus)', `${CASE_LABEL[S.caseKey]} · ${caseScenario(S.caseKey)}`, 'rule', 'Requirement checks always test every case the fuel needs'),
    row('Forecast horizon', `${S.hz}${hzRun(S.hz) ? ` · ${hzRun(S.hz)} run` : ' · not held'}`, hzRun(S.hz) ? 'measured' : '', S.basis?.mode === 'forecast' ? 'Applied as the price basis' : 'Not applied (the basis is historical)'),
    row('Request', `${TECHS.find(t => t[0] === S.tech)?.[1]} · export ${S.exportMW ?? 'not held'}${S.exportMW == null ? '' : ' MW'} · import ${S.importMW ?? 'not held'}${S.importMW == null ? '' : ' MW'}`, 'user'),
  ].join('');
  const ho = [['Prices → Economics', 'prices', H.prices], ['Grid limits → Economics', 'grid', H.grid], ['Upgrade cost → Finance', 'grid', H.cost], ['Revenue → Finance, Decision', 'economics', H.revenue]]
    .map(([k, st, h]) => row(k, h ? `bus ${h.busId} · ${String(h.at || '').slice(0, 16).replace('T', ' ')}` : 'not sent', h ? hs[st].state : '', h ? hs[st].why : 'Use the "Send" button on that dashboard')).join('');
  const sample = p?.user ? `<h3>My project: ${esc(p.name)}</h3><table class="dense"><thead><tr><th>Input</th><th>Value</th><th>Source</th><th>Note</th></tr></thead><tbody>${Object.keys(PRJ.FIELDS).filter(k => PRJ.applies(k, p.tech)).map(k => { const v = PRJ.fieldValue(p, k), s = p.stated?.[k]; return row(PRJ.FIELDS[k].label, v == null || v === '' ? 'not held' : `${v}${PRJ.FIELDS[k].unit ? ` ${PRJ.FIELDS[k].unit}` : ''}`, s === 'stated' ? 'user' : s === 'default' ? 'assumption' : '', s === 'default' ? p.sources?.[k] || '' : ''); }).join('')}</tbody></table>`
    : p ? `<h3>Sample project: ${esc(p.name)}</h3><table class="dense"><thead><tr><th>Input</th><th>Value / method</th><th>Source</th><th>Note</th></tr></thead><tbody>
      ${row('Demo inputs', p.assumptions?.label || '', 'assumption')}
      ${Object.entries(p.assumptions?.provenance || {}).map(([k, v]) => row(k, v, /database|unified|measured/i.test(v) ? 'measured' : 'assumption')).join('')}
      ${p.assumptions?.revenueMethod ? row('Revenue method', p.assumptions.revenueMethod, 'assumption') : ''}${p.assumptions?.networkUpgradeMethod ? row('Network upgrade allowance', p.assumptions.networkUpgradeMethod, 'assumption') : ''}
      </tbody></table><p class="audit-note"><b>Still open:</b> ${esc((p.coverage?.openEvidence || []).join('; ') || 'none listed')}</p>` : '';
  const open = ['Headroom source of record: element study vs substation envelope', 'Gate-6 capture basis: clear-sky vs fleet shape', 'Proxy-bus prices in the exporter', 'Data-centre binding rule', 'Wiring the remaining gates', 'Structural cuts', 'Exporter backlog item #15'];
  return `<div class="modal-backdrop" data-act="close-modal"><div class="modal modal-wide" role="dialog" aria-modal="true" aria-label="Inputs and evidence" onclick="event.stopPropagation()">
    <div class="modal-head"><h2>Inputs &amp; evidence</h2><button data-act="close-modal">Close</button></div>
    <h3>Study basis and request</h3><table class="dense"><thead><tr><th>Input</th><th>Value</th><th>Source</th><th>Note</th></tr></thead><tbody>${basisRows}</tbody></table>
    <h3>Hand-offs between dashboards</h3><table class="dense"><thead><tr><th>Hand-off</th><th>Sent</th><th>State</th><th>Why</th></tr></thead><tbody>${ho}</tbody></table>
    ${sample}
    <h3>Decisions still open (spec pack)</h3><ol class="open-list">${open.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    <p class="audit-note">Screening evidence, not an interconnection approval. Missing values print "not held", never zero.</p></div></div>`;
}

function scenariosModal() {
  if (!S.ui.modal) return '';
  if (S.ui.modal === 'pins') return pinsModal();
  if (S.ui.modal === 'samples') return samplesModal();
  if (S.ui.modal === 'evidence') return evidenceModal();
  if (S.ui.modal === 'new-project') return projectsOn() ? newProjectModal() : '';
  if (S.ui.modal === 'palette') return paletteModal();
  const cur = basisHash(S.basis);
  const rows = S.scenarios.map((s, i) => `<tr><td>${esc(s.name)}</td><td>${esc(s.stage)}</td><td class="wrap">${esc(describe(s.basis))}</td><td>${esc(s.bus)}</td><td>${s.hash === cur ? '<span class="pill good">Current basis</span>' : '<span class="pill warn">Different basis</span>'}</td><td>${esc(s.at.slice(0, 16).replace('T', ' '))}</td><td><button class="tiny" data-act="load-scenario" data-v="${i}">Open</button> <button class="tiny quiet" data-act="del-scenario" data-v="${i}">Delete</button></td></tr>`).join('');
  return `<div class="modal-backdrop" data-act="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="Scenarios" onclick="event.stopPropagation()">
    <div class="modal-head"><h2>Saved scenarios</h2><button data-act="close-modal">Close</button></div>
    ${S.scenarios.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Dashboard</th><th>Basis</th><th>Bus</th><th>Status</th><th>Saved</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><strong>No saved scenarios</strong>Use "Save scenario" on any analyzer.</div>'}
    <p class="audit-note">Scenarios are stored in this browser only (preview storage), never in the live app.</p></div></div>`;
}

let studyLoading = false;
let queueLoading = false;
function ensureQueue() {
  if (D.queue || queueLoading) return; // D3: loaded on every stage so the gate tally reads the same inputs everywhere
  queueLoading = true;
  fetch('./data/queue.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(`queue.json ${r.status}`))))
    .then(j => { D.queue = j; renderSoon(); }).catch(e => toast(`Could not load queue data: ${e.message}`)).finally(() => { queueLoading = false; });
}
let landLoading = false;
function ensureLand() {
  if (D.land || landLoading) return; // D3: as ensureQueue
  landLoading = true;
  fetch('./data/land.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(`land.json ${r.status}`))))
    .then(j => { D.land = j; renderSoon(); }).catch(e => toast(`Could not load land data: ${e.message}`)).finally(() => { landLoading = false; });
}
function ensureStudy() {
  if (D.study || studyLoading || !stage().view?.needsStudy) return;
  studyLoading = true;
  // Market v2: the same unified database and grid rules as Grid/Prices (was data/study.json, an older copy).
  fetch('./api/market').then(r => (r.ok ? r.json() : Promise.reject(new Error(`market data ${r.status}`))))
    .then(j => { D.study = prepareMarket(j); renderSoon(); })
    .catch(e => { toast(`Could not load the study copy: ${e.message}`); })
    .finally(() => { studyLoading = false; });
}

/** A live link's explicit depth and pins win over the sample step's own (the step still sets bus, fuel, size and stage). */
function linkWins(hw) {
  // A link that names a stage but no step opens the project's first stop on that stage (live links carry no step).
  if (hw.stage && hw.stage !== S.stage && STAGES.some(x => x.key === hw.stage)) {
    const p = walkProject(), i = p ? p.steps.findIndex(st => resolveStep(st, STAGES)?.stage === hw.stage) : -1;
    if (i >= 0) goStep(i); else S.stage = hw.stage;
    if (hw.tab) S.tabs[hw.stage] = hw.tab;
  }
  // A fresh link-started walk that names no cmp compares the live set (the project's first two options, the live
  // readHash rule in resolveStudioHash), not the sample step's; a named cmp is applied by applyPending.
  if (!hw.keep && linkHash && !linkHash.cmp.length) {
    const p = walkProject();
    if (p) S.ui.dOpts = resolveStudioHash(linkHash, oneCatalogue(), LIVE_DEFAULTS).cmp.map(id => p.options.find(o => o.id === id)?.busId).filter(b => b && String(b) !== String(S.nodeId)).map(String).slice(0, 2);
  }
  if (hw.depth) S.depth = hw.depth;
  if (hw.pins) S.pins = hw.pins.filter(id => D.index.some(n => n.id === id)).slice(0, 5);
  // 02 hash restore: a bus that conflicts with the option opens as a preview of that bus, and says so
  if (hw.bus && String(hw.bus) !== String(S.nodeId) && D.index.some(n => n.id === String(hw.bus))) {
    const was = S.nodeId; S.nodeId = String(hw.bus); S.basis = null; if (busReady(S.nodeId)) resetBasisForNode();
    toast(`Bus ${hw.bus} is not this option's bus (${was}): opened as a preview. Pick the option chip to return to it.`);
  }
}
/** 02 hash restore: a project or option this workspace does not hold opens the default sample (the live fresh-open
 *  project) with the live readHash's option choice, and says so. Never silent. */
function fallbackProject(hw) {
  const has = (p, id) => p.options.some(o => o.id === id);
  let p = SAMPLES.projects.find(x => x.id === hw.project);
  if (!p) {
    p = SAMPLES.projects.find(x => x.id === LIVE_DEFAULTS.project); if (!p) return;
    toast(`Project “${hw.project}” is not in this workspace: opened ${p.name}.`); hw.project = p.id;
    if (!has(p, hw.option)) hw.option = has(p, LIVE_DEFAULTS.option) ? LIVE_DEFAULTS.option : p.options[0].id;
  } else if (hw.option && !has(p, hw.option)) {
    toast(`Option “${hw.option}” is not in ${p.name}: opened its ${p.id === LIVE_DEFAULTS.project && has(p, LIVE_DEFAULTS.option) ? 'default' : 'first'} option.`);
    hw.option = p.id === LIVE_DEFAULTS.project && has(p, LIVE_DEFAULTS.option) ? LIVE_DEFAULTS.option : p.options[0].id;
  }
}
/** Live-link values that need loaded data: the history year (the bus's held years) and cmp (the sample's options). */
function applyPending() {
  if (pendingHist && busReady(S.nodeId) && S.basis) {
    const y = pendingHist; pendingHist = null;
    const held = availableYears(D, S.nodeId, 'historical', 'RT').map(x => x.year);
    if (held.includes(y) && !(S.basis.mode === 'historical' && S.basis.years.length === 1 && S.basis.years[0] === y)) {
      S.basis = { ...defaultBasis(D, S.nodeId), market: 'RT', years: [y] }; S.draft = structuredClone(S.basis);
    } else if (!held.includes(y)) toast(`History year ${y} is not held for bus ${S.nodeId}; keeping ${describe(S.basis)}.`);
  }
  if (pendingCmp && samplesState !== 'loading') {
    const p = walkProject(), ids = pendingCmp; pendingCmp = null;
    if (p) S.ui.dOpts = ids.map(id => p.options.find(o => o.id === id)?.busId).filter(b => b && String(b) !== String(S.nodeId)).map(String).slice(0, 2);
  }
}

/** v8 "Next" panel (Workflow-v2 §4): the tab's next step, lifted from the end of the tab to the top, with the same action. */
function liftNextPanel(root) {
  const an = root.querySelector('.gsx-an'), panel = an?.querySelector('[role="tabpanel"]'), ns = panel?.querySelector('.next-step');
  if (!ns) return;
  const target = ns.querySelector('[data-act]') || (ns.matches('[data-act]') ? ns : null);
  const text = (ns.textContent || '').replace(/\s+/g, ' ').trim().replace(/^Next:\s*/i, '').replace(/\s*(Open|Go)\s*→?\s*$/, '').replace(/\s*→\s*$/, '');
  const st = target?.dataset.v && STAGES.find(x => x.key === target.dataset.v), tv = st?.view?.tabs.find(x => x.id === target.dataset.tab);
  const label = target?.dataset.act === 'goto' && st ? `Open ${st.name}${tv ? ` · ${tabName(st.key, tv.id, S.tech, tabLabel(tv, S.tech))}` : ''}` : (target?.textContent || 'Open').trim();
  const attrs = target ? [...target.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}="${esc(a.value)}"`).join(' ') : '';
  const sec = document.createElement('section');
  sec.className = 'mk-next gsx-next next-step'; sec.setAttribute('aria-label', 'Next step');
  sec.innerHTML = `<div class="mk-next-ico" aria-hidden="true">→</div><div class="gsx-next-body"><h2>Next: ${esc(text)}</h2></div><div class="mk-next-act">${target ? `<button type="button" class="mk-primary" ${attrs}>${esc(label)}</button>` : ''}</div>`;
  ns.remove();
  const tabs = an.querySelector('.tabs'); (tabs || panel).before(sec);
}

/** (i) on a card: open its calculation trace, raising depth to Study when the trace is hidden below it. */
function openTrace(id) {
  const find = () => [...document.querySelectorAll('details.trace[data-trace]')].find(d => d.dataset.trace === id);
  let d = find();
  if ((!d || d.closest('[hidden]')) && S.depth !== 'study') { S.depth = 'study'; openTraces.add(id); render(); toast('Depth raised to Study to show the calculation.'); d = find(); }
  if (!d) { toast('No calculation trace on this card.'); return; }
  d.open = true; openTraces.add(id);
  d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 1400);
}
/** Dark / light (v8 design system): the html class + data-theme switch the tokens read; remembered in this browser. */
function toggleTheme() {
  const h = document.documentElement, light = !h.classList.contains('light');
  h.classList.toggle('light', light); h.classList.toggle('dark', !light); h.dataset.theme = light ? 'light' : 'dark';
  try { localStorage.setItem('gspreview.theme', light ? 'light' : 'dark'); } catch { /* storage off: session only */ }
  toast(`Theme: ${light ? 'light' : 'dark'} (press t to switch)`);
}
function closeCardMax() { document.querySelectorAll('section.card.card-max').forEach(s => s.classList.remove('card-max')); document.querySelector('.card-max-bg')?.remove(); }

/* ---------- Persistent frame (M1) ----------
   renderFrame() builds the skeleton once: the docks, splitters, #gsf-ws, #board and the inspector are created here and
   never again. renderBoard() refills only the slots inside it (top bar, rail, scope, stage strip, #board .board-in,
   footer, dialog layer). frame.js owns the dock sizes, folds and the narrow/tight rule (the live two-step board-width
   rule, NARROW 1000 / TIGHT 800, was fitBoard() here). */
let FRAME = null;     // frame.js api (window.GSFrame)
let lastNav = null;   // stage|tab of the last board render: a navigation scrolls the board back to the top
const frameState = () => (S.ui.frame && typeof S.ui.frame === 'object' ? S.ui.frame : (S.ui.frame = normFrame(S.ui.frame)));
function renderFrame() {
  const app = document.getElementById('app');
  app.className = C.APP_CLASS;
  app.innerHTML = `<header class="hdr"></header><aside class="sb"></aside><div class="sm"><div class="scope"></div><div class="body">${C.dockLeft()}${C.SPLIT_V}<div id="gsf-ws"><nav id="gsf-stages"></nav><main id="board" class="board"><div class="board-in"></div></main>${C.SPLIT_I}${C.dockRight()}</div></div>${C.SPLIT_H}${C.dockBottom()}<footer class="sfoot"></footer></div><div class="gsx-layer"></div>`;
  FRAME = mountFrame(app, { state: frameState, persist, toast });
}
/** Replace one frame slot with freshly rendered markup (one root element). */
function swap(el, html) {
  const t = document.createElement('template'); t.innerHTML = html;
  const n = t.content.firstElementChild;
  // Removing a slot that holds focus fires blur (and a pending `change`) synchronously, which can render and replace
  // this very slot first; then replaceWith throws NotFoundError. Blur first, and skip a slot a nested render replaced.
  if (el && el.contains(document.activeElement)) document.activeElement.blur();
  if (el && n && el.isConnected) el.replaceWith(n);
  return n;
}

export function render() { renderBoard(); }
/** Data that landed (a bus payload, a lazy card's endpoint, a worker result, the basemap): one board render at the next
 *  frame however many land together. Any render in between already drew them, so the queued one is then a no-op. During
 *  a page load ~10 arrivals each rebuilt the whole board (2026-10-14: ~2 s of the 6 s "map ready" budget). */
let wantBoard = false, soonF = 0, soonT = 0;
export function renderSoon() {
  wantBoard = true;
  if (soonF || soonT) return;
  const go = () => { if (soonF) cancelAnimationFrame(soonF); clearTimeout(soonT); soonF = soonT = 0; if (wantBoard) renderBoard(); };
  soonF = requestAnimationFrame(go); soonT = setTimeout(go, 100);
}
/** The Configurator booted after first paint: draw only its "My analyses" section, never the whole board (a full render
 *  would detach the cards the reader is clicking; fix-1). */
export function refreshCfgSection() {
  const board = document.querySelector('#board'), an = board?.querySelector(':scope>.board-in>.gsx-an'); if (!an || S.top) return;
  const html = cfgSection(), old = an.querySelector(':scope>section.gsx-cfg-mine');
  if (old) old.outerHTML = html; else if (html) an.insertAdjacentHTML('beforeend', html);
  try { CFG.mountMyAnalyses(board); } catch (e) { console.error('[configurator]', e); }
}

/* ---------- L3 Graph Configurator: "My analyses" per stage (views/configurator-host.js; '' until the bridge booted it) ---------- */
function cfgSection() {
  if (!featureOn('configurator') || !stage().view || !busReady(S.nodeId)) return '';
  try { return CFG.sectionHTML(S.stage); } catch (e) { console.error('[configurator]', e); return `<div class="notice error" role="alert">My analyses could not be drawn: ${esc(e.message)}</div>`; }
}

/* ---------- L4 LMP Continuum: a top-level tab (views/continuum.js) on a persistent host beside .board-in, so a board
   render never rebuilds it; mount re-scopes only when the bus, case, horizon or history year changes. ---------- */
let contH = null, contKey = null;
function contHead() {
  const b = indexOf(S.nodeId), p = walkProject();
  return `<header class="mk-question gsx-question gsx-cont-head"><div class="mk-eyebrow kick">LMP Continuum</div><h1>How does this node's price run from settled history into the solved forecast?</h1><p class="mk-tab-answer"><b>Scope:</b> ${esc(b ? `${b.name} ${b.kv ?? ''} kV · bus ${b.id} · ${b.zone || 'zone not held'}` : `bus ${S.nodeId}`)}${p ? ` · ${esc(p.name)}` : ''} · ${esc(CASE_LABEL[S.caseKey])} · horizon ${esc(S.hz)}</p></header>`;
}
function syncContinuum(board, on) {
  let host = board.querySelector(':scope>.gsx-cont-stage');
  if (!on) { if (host) host.hidden = true; if (contH) { try { contH.unmount(); } catch (e) { console.warn('[continuum]', e.message); } } contH = null; contKey = null; return; }
  if (!host) { host = document.createElement('div'); host.className = 'gsx-cont-stage'; board.appendChild(host); }
  host.hidden = false;
  const ctx = { bus: S.nodeId, zone: null, project: S.walk?.project ?? null, option: S.walk?.option ?? null, caseKey: S.caseKey, hz: S.hz, hist: basisYear(), onHash: h => dispatch('cont-hash', h) };
  const k = JSON.stringify([ctx.bus, ctx.caseKey, ctx.hz, ctx.hist]);
  if (k === contKey) return;
  contKey = k;
  window.dispatchEvent(new Event('gsx:need-bridge')); // the bridge starts even with both docks folded
  mountContinuum(host, ctx).then(h => { if (S.top !== 'continuum') { h.unmount(); return; } contH = h; }).catch(e => console.error('[continuum]', e));
}

/* ---------- M3 bridge surface (live-bridge.js): read-only state, one action path, a post-render hook ---------- */
const renderHooks = [];
let renderN = 0, snap = null, snapN = -1;
/** Called after every renderBoard() (after save()): the bridge syncs the docked map and grid here. */
export function onRender(cb) { if (typeof cb === 'function') renderHooks.push(cb); }
/** A frozen copy of S, refreshed once per render or dispatch. Never the live object. */
export function getState() {
  if (snapN !== renderN || !snap) { snap = deepFreeze(structuredClone({ ...S, draft: undefined })); snapN = renderN; }
  return snap;
}
/** The loaded bus payloads, read-only by contract (Decision's candidateGates needs them for the one verdict). */
export const getData = () => D;
/** Run app actions as one batch — `dispatch(act, v, el)` or `dispatch([[act, v, el], …])` — then render once. */
export function dispatch(act, v, el) {
  const list = Array.isArray(act) ? act : [[act, v, el]];
  let draw = false;
  for (const [a, x, e] of list) {
    const fn = ACTIONS[a];
    if (!fn) throw new Error(`unknown action: ${a}`);
    if (fn(x, e || { dataset: {} }) !== 'no-render') draw = true;
  }
  renderN++;
  if (draw) render();
}

let lastStageSeen = null; // any path that moves S.stage (goto, Next, a pick, keys 1–7) leaves the LMP Continuum tab
function renderBoard() {
  renderN++; wantBoard = false; syncOption(); followSite();
  if (S.top && lastStageSeen !== null && S.stage !== lastStageSeen) S.top = null;
  lastStageSeen = S.stage;
  const fk = focusKey();
  resetCharts(); resetTraces();
  ensureBus('hub'); ensureBus(S.nodeId);
  if (busReady(S.nodeId) && (!S.basis || String(S.basis.nodeId) !== String(S.nodeId))) resetBasisForNode();
  ensureStudy();
  ensureQueue();
  ensureLand();
  applyPending();
  ensureStudyIdle();
  loadBasemap(() => renderSoon());
  const m = chromeModel(), app = document.getElementById('app');
  if (!FRAME || !app.querySelector(':scope>.sm>.body>#gsf-ws>#board>.board-in')) renderFrame();
  swap(app.querySelector(':scope>header.hdr'), C.hdr(m));
  swap(app.querySelector(':scope>aside.sb'), C.sb(m));
  swap(app.querySelector(':scope>.sm>.scope'), C.scope(m));
  swap(app.querySelector('#gsf-stages'), C.stages(m));
  const board = app.querySelector('#board');
  const cont = S.top === 'continuum' && featureOn('continuum') && !ONLY;
  board.querySelector(':scope>.board-in').innerHTML = cont ? contHead() : `${C.bhead(m.head)}${C.band(m.band)}${C.selection(m.sel)}<div class="gsx-an${S.showText ? '' : ' gsx-quiet'}" data-depth-cur="${S.depth}">${S.walkHidden ? '' : walkBar()}${mainView()}${cfgSection()}</div>`;
  syncContinuum(board, cont);
  if (!cont && featureOn('configurator')) { try { CFG.mountMyAnalyses(board); } catch (e) { console.error('[configurator]', e); } }
  swap(app.querySelector(':scope>.sm>footer.sfoot'), C.sfoot(m.foot));
  // The dialog layer is rebuilt only when its markup changes: a background render (a bus or the basemap loading) never
  // wipes what is being typed in a dialog (New project, the palette filter).
  const layer = app.querySelector(':scope>.gsx-layer'), mh = scenariosModal();
  if (mh !== layer._gsxHtml || (!!mh !== !!layer.firstElementChild)) { layer.innerHTML = mh; layer._gsxHtml = mh; }
  // #board persists, so its scroll does too: keep it through a re-render (a slider, a toggle), reset it on a navigation.
  const nav = `${S.stage}|${activeTab(stage())}`;
  if (nav !== lastNav) { board.scrollTop = 0; lastNav = nav; }
  const root = app;
  FRAME.applySizes();
  decorateCards(board);
  liftNextPanel(root);
  root.querySelectorAll('details.trace[data-trace]').forEach(d => { if (openTraces.has(d.dataset.trace)) d.open = true; });
  root.querySelectorAll('[role="tabpanel"] details.more-ctl').forEach(d => { if (openMore.has(moreKey(d))) d.open = true; });
  // Depth contract: hide cards tagged above the current depth, then say how many a higher depth shows.
  const panel = root.querySelector('[role="tabpanel"]');
  if (panel) panel.insertAdjacentHTML('beforeend', depthFooter(applyDepth(panel, S.depth), S.depth));
  // The stage strip's analyses chip counts the cards actually shown at this depth.
  const chip = root.querySelector('#gsf-stages .gsf-chip.gsf-quiet'), st0 = stage();
  if (chip && panel) { { const nCards = panel.querySelectorAll('section.card:not([hidden])').length; chip.textContent = `${nCards} ${nCards === 1 ? 'analysis' : 'analyses'}`; } chip.title = `${st0.view?.tabs.length || 0} analyzer tabs; cards shown on this tab at ${DEPTH_LABEL[S.depth]} depth`; }
  // Scoped to the board (M1 open issue 4): the docked map and grid are never decorated as cards.
  // (mountTables keeps #app: the dialog layer's tables sort too, and the vendored grid holds no <table>.)
  mountCharts(board); mountTables(root); mountMaps(board); restoreFocus(root, fk);
  // A clamped card subtitle keeps its full text as a tooltip.
  // (every size read first, then the titles: a title written between reads forced a style + layout per subtitle)
  [...root.querySelectorAll('.card-sub:not([title])')].filter(s => s.scrollHeight > s.clientHeight + 1 || s.scrollWidth > s.clientWidth + 1).forEach(s => { s.title = s.textContent.trim(); });
  save();
  for (const cb of renderHooks) { try { cb(); } catch (e) { console.error(e); } }
}

// ---------- Map views: panel and group toggles drawn in place ----------
// Folding a filter group or a whole panel on the map changes nothing but what is shown, so it never rebuilds the board:
// the attribute changes, CSS animates it, the map and the scroll stay where they are, and the state is saved.
function secInPlace(key, el) {
  const o = (S.ui[key] ||= {}), k = el.dataset.k; o[k] = !o[k];
  const sec = el.closest('.mk-sec');
  if (!sec?.querySelector(':scope > .mk-sec-b')) return; // not drawn yet: the render draws it
  sec.toggleAttribute('data-shut', !!o[k]); el.setAttribute('aria-expanded', String(!o[k]));
  save(); return 'no-render';
}
const FLOAT_KEYS = { mktFilters: 'ff', landFilters: 'ff', gridFilters: 'ff', mktList: 'fl', landList: 'fl', gridList: 'fl' };
function floatInPlace(k, v) {
  if (!FLOAT_KEYS[k]) return;
  S.ui[k] = v === '1' ? '1' : '0';
  const wb = document.querySelector('.gsx-an .mk-wb[data-ff]');
  if (!wb) return;
  wb.dataset[FLOAT_KEYS[k]] = S.ui[k];
  save(); return 'no-render';
}

// ---------- Events ----------
function draft() { S.draft = S.draft || structuredClone(S.basis); return S.draft; }
function resetBasisForNode() {
  const keep = S.basis;
  S.basis = defaultBasis(D, S.nodeId);
  const wp = S.walk && SAMPLES.projects.find(p => p.id === S.walk.project);
  if (wp?.basis && wp.options.some(o => o.busId === String(S.nodeId))) {
    // A sample project's basis, over this bus's default; years and runs only where this bus holds them.
    const b = basisFromSample(S.basis, wp.basis, m => availableYears(D, S.nodeId, 'historical', m).map(y => y.year));
    if (b.mode === 'forecast') {
      const runs = forecastRuns(D, S.nodeId), run = runs.some(r => r.run === b.run) ? b.run : null;
      S.basis = run ? { ...b, run, years: runs.filter(r => r.run === run).map(r => r.year), weighting: b.weighting || 'duration' } : S.basis;
      if (!run) toast(`Sample basis: forecast run ${wp.basis.run} is not held for bus ${S.nodeId}; using the default basis.`);
    } else S.basis = b;
  } else if (keep && keep.mode === 'historical') {
    const held = availableYears(D, S.nodeId, 'historical', keep.market).map(y => y.year);
    const years = keep.years.filter(y => held.includes(y));
    if (years.length) S.basis = { ...keep, nodeId: S.nodeId, years };
  }
  S.draft = structuredClone(S.basis);
}

/** Apply walkthrough step i of the active sample project to S. Returns 'left' when a standalone page hands over. */
/** `link`: the walk starts from a URL (live readHash semantics: pins and cmp the link does not name are kept, so the
 *  sample's own pins are not applied; the Projects-modal start keeps them). */
function goStep(i, { fresh = false, link = false } = {}) {
  const p = allProjects().find(x => x.id === S.walk?.project); if (!p) return null;
  if (p.user) { applyProject(p, S.walk.option); return 'ok'; } // a user project has no guided stops: its inputs drive every dashboard
  const lockOption = !!S.walk.lockOption;
  const P = stepPatch(p, S.walk.option, i, STAGES);
  if (lockOption) P.nodeId = (p.options.find(o => o.id === P.option) || p.options[0]).busId;
  S.walk = { project: p.id, option: P.option, step: P.step, lockOption };
  if (P.nodeId !== String(S.nodeId) || fresh) { S.nodeId = P.nodeId; S.basis = null; if (busReady(P.nodeId)) resetBasisForNode(); }
  if (P.tech) S.tech = P.tech;
  if (P.exportMW != null) S.exportMW = P.exportMW;
  if (P.importMW != null) S.importMW = P.importMW;
  if (fresh) {
    if (!link) S.pins = [...new Set([...P.pins])];
    if (p.assumptions?.ui) {
      S.ui = applyPreset(S.ui, p.assumptions.ui); delete S.ui.inputSrc; delete S.ui.inputProv; // a sample's inputs carry their own labels
    }
  }
  const demoRevenue = p.assumptions?.optionAnnualRevenue;
  const yr = demoRevenue?.[P.nodeId];
  if (Number.isFinite(yr) && (fresh || Object.values(demoRevenue).includes(S.ui.fin?.annualRevenue))) {
    S.ui.fin = { ...(S.ui.fin || {}), annualRevenue: yr };
  }
  const demoSites = p.assumptions?.optionSite;
  const site = demoSites?.[P.nodeId];
  if (site && (fresh || Object.values(demoSites).some(x => x.siteLat === S.ui.land?.siteLat && x.siteLon === S.ui.land?.siteLon))) {
    S.ui.land = { ...(S.ui.land || {}), ...site };
  }
  S.ui.dOpts = P.dOpts.slice(0, 2);
  if (P.depth) S.depth = P.depth;
  if (P.stage) {
    if (P.tab) S.tabs[P.stage] = P.focus || P.tab; // focus = a former tab id the view reads once (ui.resolveStep tabAlias)
    if (ONLY && P.stage !== ONLY) { leave(P.stage, P.tab); return 'left'; }
    S.stage = P.stage;
  }
  return 'ok';
}

function loadSamples() {
  fetch('./data/samples.json').then(r => (r.ok ? r.json() : Promise.reject(Object.assign(new Error(`samples.json ${r.status}`), { missing: r.status === 404 }))))
    .then(j => {
      SAMPLES = normSamples(j); samplesState = 'ok';
      if (SAMPLES.problems.length) console.warn('samples.json:', SAMPLES.problems.join('; '));
      takeUserHashWalk();
      const hw = pendingHashWalk; pendingHashWalk = null;
      if (hw) fallbackProject(hw);
      if (hw && SAMPLES.projects.some(p => p.id === hw.project)) { S.walk = { ...(hw.keep ? S.walk : {}), project: hw.project, option: hw.option || S.walk?.option, step: hw.step, lockOption: !!hw.option || !!S.walk?.lockOption }; if (goStep(hw.step, { fresh: !hw.keep, link: true }) === 'left') return; linkWins(hw); }
      render();
    })
    .catch(e => { samplesState = e.missing ? 'missing' : e.message; if (S.walk) render(); });
}

/** A rejected new-project form keeps what was typed; a created project opens on its bus and the Project inputs tab. */
function createProject() {
  const val = k => document.querySelector(`.gsx-np [data-np="${k}"]`)?.value ?? '';
  const d = Object.fromEntries(['name', 'bus', 'tech', 'exportMW', 'importMW', 'cod', 'service', 'client_type'].map(k => [k, val(k)]));
  npDraft = d;
  const busId = busFromText(d.bus), b = busId ? indexOf(busId) : null, input = { name: d.name, tech: d.tech };
  for (const k of ['exportMW', 'importMW', 'cod', 'service', 'client_type']) if (String(d[k]).trim() !== '') input[k] = d[k];
  const r = PRJ.newProject(input, { rules: RULES, taken: allProjects().map(x => x.id), bus: b ? { busId, busName: b.name, lat: b.lat, lon: b.lon, src: `bus coordinate (${b.name} · ${busId})` } : null });
  npErr = { ...r.errors, ...(b ? {} : { bus: d.bus ? `“${d.bus}” is not a bus in the index: pick one from the list.` : 'Pick the connection bus.' }) };
  if (Object.keys(npErr).length) { toast(`Not created: ${Object.values(npErr)[0]}`); return; }
  saveProject(r.project); npDraft = null; S.ui.modal = false; openUserProject(r.project);
  const mw = r.project.tech === 'datacenter' ? `${r.project.importMW} MW import` : `${r.project.exportMW} MW`;
  toast(`Created ${r.project.name}: ${mw} ${r.project.tech} at ${b.name}. Every dashboard now reads it; edit inputs in Project inputs.`);
  setTimeout(() => window.dispatchEvent(new CustomEvent('gsone:insp-tab', { detail: 'inputs' })), 0);
}
function addOptionTo(p, busId) {
  if (!p) { toast('Open one of your projects first (Projects › New project).'); return false; }
  const b = indexOf(busId), r = PRJ.addOption(p, { busId: String(busId), busName: b?.name ?? null, lat: b?.lat, lon: b?.lon, src: b ? `bus coordinate (${b.name} · ${busId})` : undefined });
  if (!r.ok) { toast(r.reason); return false; }
  saveProject(r.project); if (S.walk?.project === p.id && String(busId) === String(S.nodeId)) { S.walk.option = r.option.id; followSite(); } // the bus in view is now that option; its site default with it (fix-site)
  if (S.walk?.project === p.id) { S.ui.dOpts = r.project.options.map(o => String(o.busId)).filter(b => b !== String(S.nodeId)).slice(0, 2); for (const b of S.ui.dOpts) ensureBus(b); } // as applyProject: every other option stays in the compare (fix-2)
  toast(`${b?.name || busId} added to ${p.name} as option ${r.option.id} (${r.project.options.length} options).`); return true;
}

const ACTIONS = {
  stage: v => { S.top = null; if (ONLY && v !== ONLY) { leave(v); return; } S.stage = v; },
  // L4: the LMP Continuum top-level tab; Analytics returns to the seven stages
  continuum: () => { if (!featureOn('continuum') || ONLY) return 'no-render'; S.top = 'continuum'; S.ui.modal = false; },
  analytics: () => { if (!S.top) return 'no-render'; S.top = null; },
  'cont-hash': h => { if (!h) return 'no-render'; if (HZ_YEARS.includes(Number(h.hz)) && Number(h.hz) !== S.hz) S.hz = Number(h.hz); if (h.hist && Number(h.hist) !== basisYear()) pendingHist = Number(h.hist); },
  // L3: the Configurator's saved analyses (App.save); App.render follows
  'cfg-widgets': v => { S.userWidgets = JSON.parse(v); persist(); return 'no-render'; },
  // L1: user projects (projects.js)
  'open-new-project': v => { if (!projectsOn()) return 'no-render'; npDraft = { tech: S.tech, bus: busText(v || S.nodeId) }; npErr = {}; S.ui.modal = 'new-project'; },
  'proj-new-here': v => { if (!projectsOn()) return 'no-render'; npDraft = { tech: S.tech, bus: busText(v || S.nodeId) }; npErr = {}; S.ui.modal = 'new-project'; },
  'np-create': () => { createProject(); },
  'proj-add-opt': (v, el) => { const p = el?.dataset?.p ? PROJECTS.find(x => x.id === el.dataset.p) : walkProject()?.user ? walkProject() : null; addOptionTo(p, v || S.nodeId); },
  'proj-del': v => { const p = PROJECTS.find(x => x.id === v); if (!p) return; PROJECTS = PRJ.deleteProject(PROJECTS, v); PRJ.saveProjects(PROJECTS); if (S.walk?.project === v) S.walk = null; toast(`Deleted ${p.name} from this browser.`); },
  'proj-export': () => {
    const url = URL.createObjectURL(new Blob([PRJ.exportJSON(PROJECTS)], { type: 'application/json' })), a = document.createElement('a');
    a.href = url; a.download = `gridsense-projects-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Exported ${PROJECTS.length} project(s) as JSON.`); return 'no-render';
  },
  'proj-inputs': () => { window.GSFrame?.setDock('inspector', true); window.dispatchEvent(new CustomEvent('gsone:insp-tab', { detail: 'inputs' })); return 'no-render'; },
  'open-palette': () => { S.ui.modal = 'palette'; },
  tab: v => { S.tabs[S.stage] = v; },
  goto: (v, el) => { S.top = null; if (el.dataset.tab) S.tabs[v] = el.dataset.tab; if (ONLY && v !== ONLY) { leave(v, el.dataset.tab); return; } S.stage = v; },
  node: v => { S.nodeId = v; S.basis = null; S.ui.modal = false; if (busReady(v)) resetBasisForNode(); },
  'node-find': v => { const id = (String(v).match(/·\s*(\d+)\s*$/) || [])[1] || (D.index.find(b => b.name.toLowerCase() === String(v).trim().toLowerCase()) || {}).id; if (!id) { toast('Pick a bus from the list.'); return; } ACTIONS.node(id); },
  tech: v => { const was = [S.exportMW, S.importMW], mw = x => (x == null || x === '' ? 'not held' : `${x} MW`); S.tech = v; Object.assign(S, fuelSizes(v, S.exportMW, S.importMW)); if (was[0] !== S.exportMW || was[1] !== S.importMW) toast(`Sizes set for ${v}: export ${mw(S.exportMW)} · import ${mw(S.importMW)}`); },
  depth: v => { S.depth = normDepth(v); },
  pin: v => { const id = String(v); if (!id) return; const was = S.pins.includes(id); S.pins = togglePin(S.pins, id); if (!was) ensureBus(id); toast(was ? `Unpinned ${indexOf(id)?.name || id}.` : `Pinned ${indexOf(id)?.name || id} (${S.pins.length} pinned).`); },
  'clear-pins': () => { S.pins = []; },
  'open-pins': () => { S.ui.modal = 'pins'; },
  'compare-pinned': () => {
    const { dOpts, dropped } = pinsForCompare(S.pins, S.nodeId);
    if (!dOpts.length) { toast('Pin at least one bus other than the current one.'); return 'no-render'; }
    S.ui.dOpts = dOpts; S.ui.modal = false; S.tabs.decision = 'compare';
    if (dropped.length) toast(`Decision compares up to three options: ${dropped.length} pinned bus(es) left out.`);
    if (ONLY && ONLY !== 'decision') { leave('decision', 'compare'); return 'no-render'; }
    S.stage = 'decision';
  },
  preset: (v, el) => {
    const st = stage(), ps = st.view?.presets, p = ps?.[v];
    const patch = presetPatch(p, S.ui, S);
    if (!patch) { toast(`No "${v}" preset on this dashboard.`); return 'no-render'; }
    S.ui = applyPreset(S.ui, patch);
    S.ui.presetOn = { ...(S.ui.presetOn || {}), [el?.dataset.scope || st.key]: v };
    toast(`Preset applied: ${p.label || v}`);
  },
  year: v => { const k = String(v)[0], y = String(v).slice(1); if (k === 'h') return ACTIONS.hist(y); if (k === 'f') return ACTIONS.hz(y); return 'no-render'; },
  case: v => { S.caseKey = CASE_KEYS.includes(v) ? v : 'sp'; },
  hz: v => {
    const y = Number(v), run = hzRun(y), runs = forecastRuns(D, S.nodeId);
    if (!run || !runs.some(r => r.run === run)) { toast(`No ${y} solved run is held for bus ${S.nodeId}.`); return; }
    S.hz = y;
    S.basis = { ...(S.basis || defaultBasis(D, S.nodeId)), nodeId: S.nodeId, mode: 'forecast', run, years: runs.filter(r => r.run === run).map(r => r.year), weighting: 'duration' };
    S.draft = structuredClone(S.basis); toast(`Price basis: ${describe(S.basis)}`);
  },
  hist: v => {
    const y = Number(v), mk = S.basis?.mode === 'historical' ? S.basis.market : 'RT';
    if (!availableYears(D, S.nodeId, 'historical', mk).some(x => x.year === y)) { toast(`${y} ${mk} prices are not held for bus ${S.nodeId}.`); return; }
    S.basis = { ...defaultBasis(D, S.nodeId), market: mk, years: [y] }; S.draft = structuredClone(S.basis); toast(`Price basis: ${describe(S.basis)}`);
  },
  'scope-open': () => { S.ui.scopeOpen = !S.ui.scopeOpen; },
  guided: () => { if (!S.walk) { S.ui.modal = 'samples'; return; } S.walkHidden = !S.walkHidden; },
  'open-samples': () => { S.ui.modal = 'samples'; },
  'open-evidence': () => { S.ui.modal = 'evidence'; },
  'card-expand': (v, el) => {
    const sec = el.closest('section.card'); if (!sec) return 'no-render';
    const on = !sec.classList.contains('card-max'); closeCardMax();
    if (on) { sec.classList.add('card-max'); const bg = document.createElement('div'); bg.className = 'card-max-bg'; bg.addEventListener('click', closeCardMax); (document.getElementById('gsx-overlay') || document.body).appendChild(bg); }
    return 'no-render';
  },
  'card-trace': v => { openTrace(v); return 'no-render'; },
  'toggle-text': () => { S.showText = !S.showText; },
  sweep: v => { if (S.tech === 'datacenter') S.importMW = Number(v); else { S.exportMW = Number(v); if (S.tech === 'storage') S.importMW = Number(v); } },
  'toggle-theme': () => { toggleTheme(); return 'no-render'; },
  'grid-fac': v => { S.ui.gfac = S.ui.gfac === String(v) ? null : String(v); }, // map line or facility row: select / clear the facility
  noop: () => 'no-render',
  'export-pack': () => { S.stage = 'decision'; S.tabs.decision = 'record'; if (ONLY && ONLY !== 'decision') { leave('decision', 'record'); return 'no-render'; } toast('Decision › Decision record: use "Download evidence pack".'); },
  // Decision evidence pack: the view registers the downloader for its current context (no inline handler, CSP-safe).
  'print-memo': () => { window.print(); return 'no-render'; },
  'd-pack': () => { if (typeof window.__gsDecisionPack === 'function') window.__gsDecisionPack(); else toast('Open Decision to build the evidence pack.'); return 'no-render'; },
  sample: v => {
    S.ui.modal = false; S.walkHidden = false;
    if (!v) { S.walk = null; return; }
    const up = projectsOn() ? PROJECTS.find(x => x.id === v) : null;
    if (up) { openUserProject(up); toast(`Project: ${up.name} · ${TECHS.find(t => t[0] === up.tech)?.[1] || up.tech} · every dashboard reads its inputs.`); return; }
    const p = SAMPLES.projects.find(x => x.id === v); if (!p) return;
    S.walk = { project: p.id, option: p.options[0].id, step: 0 };
    if (goStep(0, { fresh: true }) === 'left') return 'no-render';
    toast(`Sample project: ${p.name}. Use Next to walk through it.`);
  },
  'sel-opt': v => ACTIONS['sample-opt'](v),
  'sample-opt': v => { if (!S.walk || v === '' || v == null) return 'no-render'; S.walk.option = String(v); S.walk.lockOption = true; if (goStep(S.walk.step, { fresh: true }) === 'left') return 'no-render'; },
  walk: v => {
    if (!S.walk) return;
    const i = v === 'next' ? (S.walk.step || 0) + 1 : v === 'prev' ? (S.walk.step || 0) - 1 : v === 'here' ? S.walk.step || 0 : Number(v);
    if (goStep(i) === 'left') return 'no-render';
  },
  'walk-exit': () => { S.walk = null; S.ui.modal = false; toast('Walkthrough closed. Your bus, fuel and depth stay as they are.'); },
  export: v => { S.exportMW = Number(v); },
  import: v => { S.importMW = v === '' || v == null ? null : Number(v); },
  ui: (v, el) => { S.ui[el.dataset.k] = v; },
  'basis-mode': v => {
    const d = draft(); d.mode = v;
    if (v === 'forecast') { const runs = forecastRuns(D, S.nodeId); d.run = d.run || (runs.find(r => r.run === '10yr') || runs[0])?.run; d.years = runs.filter(r => r.run === d.run).map(r => r.year); d.weighting = 'duration'; }
    else { Object.assign(d, defaultBasis(D, S.nodeId), { mode: 'historical' }); }
  },
  'basis-run': v => { const d = draft(); d.run = v; d.years = forecastRuns(D, S.nodeId).filter(r => r.run === v).map(r => r.year); },
  'basis-market': v => { const d = draft(); d.market = v; const held = availableYears(D, S.nodeId, 'historical', v).map(y => y.year); d.years = d.years.filter(y => held.includes(y)); },
  'basis-year': (v, el) => { const d = draft(), y = Number(v); d.years = el.checked ? [...new Set([...d.years, y])].sort() : d.years.filter(x => x !== y); },
  'basis-quick': v => {
    const d = draft(), c = availableYears(D, S.nodeId, 'historical', d.market).filter(y => y.complete).map(y => y.year);
    d.years = v === 'latest' ? c.slice(-1) : v === 'last3' ? c.slice(-3) : c;
  },
  'basis-weight': v => { draft().weighting = v; },
  'include-partial': () => { S.basis = { ...S.basis, includePartial: true }; S.draft = { ...(S.draft || S.basis), includePartial: true }; toast('Applied with partial coverage. Missing hours stay missing.'); },
  'basis-cw': (v, el) => { const d = draft(); d.weights = { ...d.weights, [el.dataset.year]: Number(v) }; },
  'basis-partial': (v, el) => { draft().includePartial = el.checked; },
  'basis-strict': (v, el) => { draft().strict = !el.checked; },
  'apply-basis': () => {
    S.basis = structuredClone(draft());
    const stale = S.scenarios.filter(s => s.hash !== basisHash(S.basis)).length;
    toast(`Analysis applied: ${describe(S.basis)}${stale ? ` · ${stale} saved scenario(s) on another basis` : ''}`);
  },
  'save-scenario': () => {
    const name = `${stage().name} · ${node()?.name} · ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    S.scenarios.push({ name, stage: stage().name, tab: activeTab(stage()), bus: node()?.name, busId: S.nodeId, basis: structuredClone(S.basis), hash: basisHash(S.basis), tech: S.tech, exportMW: S.exportMW, importMW: S.importMW, ui: { ...S.ui, frame: undefined }, project: S.walk?.project ?? null, option: S.walk?.option ?? null, at: new Date().toISOString() });
    toast(`Saved "${name}"`);
  },
  'open-scenarios': () => { S.ui.modal = true; },
  'close-modal': () => { S.ui.modal = false; },
  'load-scenario': v => {
    const s = S.scenarios[Number(v)];
    Object.assign(S, { nodeId: s.busId, basis: structuredClone(s.basis), draft: structuredClone(s.basis), tech: s.tech, exportMW: s.exportMW, importMW: s.importMW });
    S.stage = STAGES.find(x => x.name === s.stage)?.key || S.stage; S.tabs[S.stage] = s.tab; S.ui = { ...s.ui, modal: false, frame: frameState() }; // a scenario never resizes the docks
  },
  'del-scenario': v => { S.scenarios.splice(Number(v), 1); },
  alloc: (v, el) => { const k = S.ui.allocKey, row = ((S.ui.alloc ||= {})[k] ||= {})[el.dataset.id] ||= {}; row[el.dataset.f] = v === '' ? null : Number(v); },
  econ: (v, el) => { (S.ui.econ ||= {})[el.dataset.k] = v === '' ? undefined : Number(v); },
  fin: (v, el) => { (S.ui.fin ||= {})[el.dataset.k] = v === '' ? undefined : Number(v); },
  // S5: the tax-credit gate inputs and the labelled finance presets (views/cards-finance.js owns the field rules)
  tax: (v, el) => { S.ui.tax = taxUiUpdate(S.ui.tax, el.dataset.k, v); },
  'fin-preset': v => { S.ui.fin = finUiUpdate(S.ui.fin, 'preset', v); },
  mkt: (v, el) => { (S.ui.mkt ||= {})[el.dataset.k] = v === '' ? undefined : Number(v); },
  'mkt-zone': (v, el) => { const m = (S.ui.mkt ||= {}); m.zones = el.checked ? [...new Set([...(m.zones || []), v])] : (m.zones || []).filter(z => z !== v); },
  'mkt-shoulder': (v, el) => { (S.ui.mkt ||= {}).shoulder = el.checked; },
  'mkt-own': (v, el) => { (S.ui.mkt ||= {}).ownPrice = el.checked; },
  'mkt-sec': (v, el) => secInPlace('mktSec', el), // Market filters: fold or unfold one group (in place)
  'land-sec': (v, el) => secInPlace('landSec', el), // Land inputs: fold or unfold one group (in place)
  'grid-sec': (v, el) => secInPlace('gridSec', el), // Grid inputs: fold or unfold one group (in place)
  'mk-float': (v, el) => floatInPlace(el.dataset.k, v), // a map view's panel folded or shown (in place)
  'mk-chip': (v, el) => { const fn = ACTIONS[el.dataset.a]; return fn && el.dataset.a !== 'mk-chip' ? fn(v, el) : 'no-render'; }, // a chip in the stage bar: its input's own action
  'land-site-clear': () => { const L = (S.ui.land ||= {}); L.siteLat = undefined; L.siteLon = undefined; }, // Land strip: remove the placed site (as clearing both fields)
  'mkt-pri': (v, el) => { const m = (S.ui.mkt ||= {}); const cur = m.pri?.length ? m.pri : ['margin', 'price']; m.pri = el.checked ? [...new Set([...cur, v])].slice(0, 3) : cur.filter(x => x !== v); },
  'pick-bus': v => { S.nodeId = v; S.basis = null; S.tabs.grid = 'capacity'; if (ONLY && ONLY !== 'grid') { leave('grid', 'capacity'); return; } S.stage = 'grid'; toast('Candidate set. Opened in Grid.'); },
  'q-whatif': (v, el) => { S.ui.qWhatIf = el.checked; },
  'q-flag': (v, el) => { S.ui[el.dataset.k] = el.checked; },
  'ui-text': (v, el) => { S.ui[el.dataset.k] = v; },
  land: (v, el) => { (S.ui.land ||= {})[el.dataset.k] = v === '' ? undefined : Number(v); },
  'land-permit': (v, el) => { const L = (S.ui.land ||= {}); (L.permits ||= {})[el.dataset.k] = v; },
  'd-add': v => {
    const txt = String(v).trim(), byId = (txt.match(/·\s*(\d+)\s*$/) || [])[1] || (/^\d+$/.test(txt) ? txt : null);
    const named = byId ? [] : D.index.filter(b => String(b.name).toLowerCase() === txt.toLowerCase());
    if (named.length > 1) { toast(`${named.length} buses are named "${txt}": pick one from the list.`); return; }
    const id = byId || named[0]?.id;
    if (!id || !D.index.some(b => String(b.id) === String(id))) { toast('Pick a bus from the list.'); return; }
    if (id === String(S.nodeId) || (S.ui.dOpts || []).map(String).includes(id)) { toast('Already an option.'); return; }
    S.ui.dOpts = [...(S.ui.dOpts || []).map(String).filter(x => x !== String(S.nodeId)), String(id)].slice(-2); ensureBus(id);
  },
  'd-remove': v => { S.ui.dOpts = (S.ui.dOpts || []).map(String).filter(x => x !== String(v)); if (busError(v) && String(v) !== String(S.nodeId)) busLoad.delete(String(v)); },
  'd-opt': (v, el) => { const cur = chosen(D, S).map(n => String(n.id)).filter(id => id !== String(S.nodeId)); S.ui.dOpts = el.checked ? [...new Set([...cur, v])].slice(0, 2) : cur.filter(x => x !== v); },
  'd-form': (v, el) => { (S.ui.dForm ||= {})[el.dataset.k] = v; },
  'add-action': () => { if (!S.ui.aText) { toast('Enter the action first.'); return; } (S.ui.actions ||= []).push({ text: S.ui.aText, owner: S.ui.aOwner || '', due: S.ui.aDue || '', bus: D.nodes.find(n => String(n.id) === String(S.nodeId))?.name, done: false, at: new Date().toISOString() }); S.ui.aText = ''; },
  'toggle-action': v => { const a = S.ui.actions?.[Number(v)]; if (a) a.done = !a.done; },
  'record-decision': () => { if (!S.ui.dForm?.status) { toast('Choose a decision first.'); return; } S.decisions.push(deepFreeze({ ...buildRecord(D, S), project: S.walk?.project ?? null, option: S.walk?.option ?? null })); toast('Decision recorded.'); },
  'map-bus': v => { S.ui.mapBus = v; },
  'map-bus-find': v => { S.ui.mapBus = v; S.tabs.market = 'find'; },
  'map-layer': (v, el) => { (S.ui.mapLayers ||= {})[el.dataset.k] = el.checked; },
  'grid-size': v => { S.exportMW = Number(v); },
  'goto-where': v => { const [stg, tb] = String(v).split(' › '); const st = STAGES.find(s => s.name === stg.trim()); if (!st) return; const t = st.view?.tabs.find(x => x.label === (tb || '').trim() || tabLabel(x, S.tech) === (tb || '').trim()); if (t) S.tabs[st.key] = t.id; if (ONLY && st.key !== ONLY) { leave(st.key, t?.id); return; } S.stage = st.key; },
  'trace-csv': v => { if (!downloadCsv(v)) toast('Nothing to download for this calculation.'); return 'no-render'; },
  'alloc-reset': () => { if (S.ui.alloc) delete S.ui.alloc[S.ui.allocKey]; },
  'handoff-grid': () => {
    const L = S.ui.gridLimits || {};
    S.handoffs.grid = { busId: S.nodeId, tech: S.tech, requestMW: S.exportMW, exportMW: L.exportMW, exportCase: L.exportCase, importMW: L.importMW, importCase: L.importCase, status: L.exportStatus, importStatus: L.importStatus, at: new Date().toISOString() };
    toast('Connection limits sent to Economics.');
  },
  'handoff-bess': () => {
    const r = S.ui.revenueOutBess; if (!r) return;
    S.handoffs.revenue = { ...r, mwh: null }; toast('Storage value sent to Project finance.');
  },
  'handoff-revenue': () => {
    const r = S.ui.revenueOut; if (!r) return;
    S.handoffs.revenue = { ...r }; toast('Revenue sent to Project finance.');
  },
  'handoff-cost': () => {
    S.handoffs.cost = { busId: S.nodeId, ...(S.ui.allocSummary || {}), at: new Date().toISOString() };
    toast('Upgrade-cost scenario sent to Project finance.');
  },
  'handoff-prices': () => {
    S.handoffs.prices = { basis: structuredClone(S.basis), hash: basisHash(S.basis), busId: S.nodeId, at: new Date().toISOString() };
    toast('Prices sent to Economics. Economics results on another basis will show as needing recalculation.');
  },
};

/** Standalone mode: open another dashboard's page on the same bus (state travels via localStorage). */
function leave(key, tab) { save(); location.href = `./${PAGES[key]}#${toStudioHash({ ...hashNow(), view: null, stage: null, tab: tab || null })}`; }

/** True when a field's value is still the value it was rendered with (defaultValue / defaultChecked / the
 *  option marked selected at render). data-live inputs commit on `input`, so their rendered value is stale;
 *  they are compared with the last value the input handler committed (el._committed). */
function unchanged(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked === el.defaultChecked;
  if (el.tagName === 'SELECT') { const d = [...el.options].find(o => o.defaultSelected) || el.options[0]; return !!d && el.value === d.value; }
  if ('_committed' in el) return el.value === el._committed;
  return el.value === el.defaultValue;
}
const openTraces = new Set(); // traces the user expanded stay expanded across re-renders
const openMore = new Set();   // "More options" panels the user opened stay open across re-renders (per stage, tab and position)
function moreKey(d) { const all = [...document.querySelectorAll('[role="tabpanel"] details.more-ctl')]; return `${S.stage}|${activeTab(stage())}|${all.indexOf(d)}|${d.querySelector('summary')?.textContent.trim() || ''}`; }
let liveT = null;
function onEvent(e) {
  if (e.type === 'click') {
    if (handleChartToggle(e.target)) return;
    const od = e.target.closest('[data-open-drawer]'); if (od) { openDrawer(document.getElementById('app'), od.dataset.openDrawer); return; }
    const cv = featureOn('configurator') ? CFG.readEvent(e.target) : null;
    if (cv) { if (!window.Configurator) toast('The Graph Configurator is still loading: it opens once the map and grid data are in.'); else CFG.handleAction(cv).catch(err => toast(`Analysis: ${err.message}`)); return; }
  }
  if (e.type === 'input' && e.target.matches?.('[data-pal]')) { // palette filter: no render
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll('.gsx-pal-list .gsx-pal-i').forEach(b => { b.hidden = !!q && !b.textContent.toLowerCase().includes(q); });
    return;
  }
  if (e.type === 'input') {
    const el = e.target.closest('[data-live][data-act]'); if (!el) return;
    const fn = ACTIONS[el.dataset.act]; if (!fn) return;
    fn(el.value, el); el._committed = el.value;
    const out = el.parentElement.querySelector('output'); if (out) out.textContent = el.value;
    clearTimeout(liveT); liveT = setTimeout(render, 140);
    return;
  }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  // Live-markup links (header nav) carry href="#": run the action, never navigate (a hash change would close the dialog it opens).
  if (e.type === 'click' && el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
  const act = el.dataset.act;
  const isField = el.matches('select, input');
  if (e.type === 'click' && isField) return;
  if (e.type === 'change' && !isField) return;
  // Leaving a field fires `change` even when nothing changed; re-rendering then swallows the next click
  // (a typed value lost, a tab click eaten). Skip the action and the render when the value equals the one
  // the field was rendered with. Checkboxes/radios compare their checked state.
  if (e.type === 'change' && isField && unchanged(el)) return;
  if (act === 'close-modal' && e.target !== el) return;
  const fn = ACTIONS[act];
  if (!fn) return;
  if (el.matches('.gsx-pal-i') || el.closest('.gsx-bus-pop')) { S.ui.modal = false; el.closest('.gsx-bus-pop')?.remove(); } // a palette command or a map/grid pop action closes it first
  if (fn(isField ? el.value : el.dataset.v, el) === 'no-render') { if (el.matches('.gsx-pal-i')) render(); return; }
  render();
}

export async function mount(opts = {}) {
  ONLY = opts.only || null;
  setOnReady(() => renderSoon());
  if (ONLY) S.stage = ONLY;
  return boot();
}

async function boot() {
  const r = await fetch('./api/buses');
  if (!r.ok) throw new Error(`Bus index not available (${r.status}). Start the preview with server.py.`);
  D = { metadata: {}, nodes: [], series: [], grid: { headroom: [], constraints: [], source: 'unified.fact_headroom / fact_limiting_element' }, index: (await r.json()).buses };
  try { const f = await fetch('./data/flags.json'); D.flags = f.ok ? await f.json() : null; } catch { D.flags = null; }
  load();
  S.userWidgets = Array.isArray(S.userWidgets) ? S.userWidgets : [];
  if (S.top && !featureOn('continuum')) S.top = null;
  S.decisions = (S.decisions || []).map(deepFreeze);
  S.ui.modal = false; // a dialog never reopens on reload
  S.ui.frame = normFrame(S.ui.frame); // dock state lives here only; the live gs.frame.v1 is never read (04a §4)
  if (!indexOf(S.nodeId)) S.nodeId = '111403';
  if (S.basis && String(S.basis.nodeId) !== String(S.nodeId)) S.basis = null;
  S.draft = S.basis ? structuredClone(S.basis) : null;
  const app = document.getElementById('app');
  // Land site map: place the site where the user clicks. The point is read in the drawing's own coordinates (screen CTM
  // inverse), so zoom and pan don't shift it; a drag (pan) of more than 4 px never places the site.
  let siteDown = null;
  app.addEventListener('pointerdown', e => { if (e.target.closest('svg[data-site-map]')) siteDown = [e.clientX, e.clientY]; }, true);
  app.addEventListener('click', e => {
    const svg = e.target.closest('svg[data-site-map]'); if (!svg) return;
    if (e.target.closest('[data-act]')) return;
    if (siteDown && Math.hypot(e.clientX - siteDown[0], e.clientY - siteDown[1]) > 4) { siteDown = null; return; }
    siteDown = null;
    const vb = (svg.dataset.vb0 || svg.getAttribute('viewBox')).split(' ').map(Number), m = svg.getScreenCTM();
    if (!m) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const fx = (pt.x - vb[0]) / vb[2], fy = (pt.y - vb[1]) / vb[3], span = Number(svg.dataset.span), lspan = Number(svg.dataset.lspan);
    if (!(fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1)) return;
    const L = (S.ui.land ||= {}); L.siteLon = +(Number(svg.dataset.lon0) + fx * lspan).toFixed(5); L.siteLat = +(Number(svg.dataset.lat0) + (1 - fy) * span).toFixed(5);
    e.stopImmediatePropagation(); render();
  });
  app.addEventListener('click', onEvent);
  app.addEventListener('change', onEvent);
  app.addEventListener('input', onEvent);
  app.addEventListener('toggle', e => {
    const d = e.target;
    if (d.matches?.('details.trace[data-trace]')) { if (d.open) openTraces.add(d.dataset.trace); else openTraces.delete(d.dataset.trace); }
    if (d.matches?.('details.more-ctl')) { const k = moreKey(d); if (d.open) openMore.add(k); else openMore.delete(k); }
  }, true);
  document.addEventListener('click', e => {
    if (e.target.closest('[data-close-drawer]')) { closeDrawer(); return; }
    const a = e.target.closest('.drawer [data-act]'); if (a) { closeDrawer(); onEvent({ type: 'click', target: a }); }
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeDrawer(); closeCardMax(); }
    // Live Studio shortcuts: d depth, g guided review, 1–7 dashboards (never while typing).
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, select, textarea, [contenteditable]') && !S.ui.modal) {
      if (e.key === 'd') { S.depth = DEPTHS[(DEPTHS.indexOf(S.depth) + 1) % DEPTHS.length]; render(); toast(`Depth: ${DEPTH_LABEL[S.depth]}`); return; }
      if (e.key === 'g') { ACTIONS.guided(); render(); return; }
      if (e.key === 't') { toggleTheme(); return; }
      if (/^[1-7]$/.test(e.key)) { const k = STAGES[Number(e.key) - 1].key; if (ONLY && k !== ONLY) { leave(k); return; } S.stage = k; S.top = null; render(); return; }
    }
    // Ctrl-K / ⌘K: the command palette (also from a field: it is the live omnibox key)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); S.ui.modal = 'palette'; render(); document.querySelector('.gsx-pal-q')?.focus(); return; }
    if (e.key === 'Enter' && e.target.matches?.('[data-pal]')) { e.preventDefault(); document.querySelector('.gsx-pal-list .gsx-pal-i:not([hidden])')?.click(); return; }
    const tab = e.target.closest?.('[role="tab"]');
    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const st = stage(); if (!st.view) return;
      const ids = st.view.tabs.map(x => x.id), i = ids.indexOf(activeTab(st));
      S.tabs[st.key] = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]; render();
      document.querySelector('[role="tab"][aria-selected="true"]')?.focus();
    }
  });
  window.addEventListener('hashchange', () => {
    lastHash = location.hash; // accept the navigation; save() canonicalises it after the render
    closeDrawer(); closeCardMax(); S.ui.modal = false; readHash();
    takeUserHashWalk();
    const hw = pendingHashWalk;
    if (hw && samplesState === 'ok') fallbackProject(hw);
    if (hw && samplesState === 'ok' && SAMPLES.projects.some(p => p.id === hw.project)) { pendingHashWalk = null; S.walk = { ...(hw.keep ? S.walk : {}), project: hw.project, option: hw.option || S.walk?.option, step: hw.step, lockOption: !!hw.option || !!S.walk?.lockOption }; if (goStep(hw.step, { fresh: !hw.keep, link: true }) === 'left') return; linkWins(hw); }
    if (!S.basis && busReady(S.nodeId)) resetBasisForNode(); render();
  });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && S.ui.modal) { S.ui.modal = false; render(); } });
  // L1: Projects › Import JSON (own export, a bare list, one project or a live-Studio store); invalid projects are reported
  app.addEventListener('change', e => {
    const f = e.target.matches?.('[data-gsx-import]') ? e.target.files?.[0] : null; if (!f) return;
    f.text().then(text => {
      const r = PRJ.importJSON(text, { existing: PROJECTS, reserved: SAMPLES.projects.map(p => p.id), rules: RULES, busName: id => indexOf(id)?.name ?? null });
      PROJECTS = r.projects; PRJ.saveProjects(PROJECTS);
      toast(`Imported ${r.added.length} project(s)${r.errors.length ? `; not imported: ${r.errors.join(' ')}` : ''}.`); render();
    }).catch(err => toast(`Import failed: ${err.message}`));
  });
  takeUserHashWalk();
  loadSamples();
  render();
  // M4: the native Inspector in the right dock, on the shell's four exports (the bridge hands it the map/grid meta).
  // L1 (§6a): the open project and the Project inputs tab's write path (validated by projects.js, applied, stale-marked).
  mountInspector(document.getElementById('inspector'), { getState, dispatch, onRender, getData, toast,
    getProject: () => walkProject(), rules: () => RULES, projectsOn, sizes: () => window.GS?.SIZES ?? null,
    busCoord: S => { const b = indexOf(S.nodeId); return b && Number.isFinite(b.lat) && Number.isFinite(b.lon) ? { lat: b.lat, lon: b.lon, name: `${b.name} · ${S.nodeId}` } : null; }, // legacy options without busLat (FINAL-store wiring)
    saveProject: p => { saveProject(p); },
    applyProject: p => { if (S.walk?.project === p.id) applyProject(p, S.walk.option); render(); },
    markStaleAll(k, oldV, newV) { // saved scenarios and decision records built on this project (live markStale; pins carry no basis yet)
      const pid = walkProject()?.id ?? null; let n = 0; if (pid == null) return 0;
      for (const key of ['scenarios', 'decisions']) { if (!Array.isArray(S[key])) continue; const m = PRJ.markStale(S[key], k, oldV, newV, r => r.project === pid); S[key] = key === 'decisions' ? m.records.map(deepFreeze) : m.records; n += m.n; }
      persist(); return n;
    },
    duplicate(id) { const src = allProjects().find(x => x.id === id); if (!src) return null; const c = PRJ.duplicateProject(src, { taken: allProjects().map(x => x.id) }); saveProject(c); openUserProject(c); render(); toast(`Duplicated as ${c.name}: your copy is editable.`); return c; },
  });
}

(window.GS_STANDALONE ? Promise.resolve() : (setOnReady(() => renderSoon()), boot())).catch(e => { document.getElementById('app').innerHTML = `<div class="notice error" role="alert" style="margin:40px">Preview could not start: ${esc(e.message)}</div>`; });
