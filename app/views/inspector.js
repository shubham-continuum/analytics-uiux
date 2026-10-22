// GridSense One Studio: the native Inspector (M4) in the persistent right dock (#inspector, frame.js).
// Provenance: Claude Opus 5.5 (M4 build agent) · one-studio/design (T3, slice M4) · 2026-10-06 · sign-off pending · v1
//
// Tabs: Bus · Card · Evidence · Notes · Export. Two halves:
//   - a pure model per tab (node-testable, tests/inspector.test.mjs): every number is read from the engine that owns it
//     (gates = Decision's candidateGates, verdict text = v2copy.verdictLine, the summary band's own formatter; card
//     numbers are the card's rendered text; rules from rules/isone-2026.json), never computed a second time here;
//   - mountInspector(hostEl, api) with api = app.js { getState, dispatch, onRender, getData } (the M3 bridge surface;
//     optional: toast, getMeta → the map/grid meta {generation, coverage}, else the bridge's gsbridge:ready event):
//     it re-renders only itself inside hostEl after every board render. Selection lives in S.ui.inspect
//     ({kind:'bus'|'card', id}) and is written only through dispatch('ui', v, {dataset:{k:'inspect'}}) — the action
//     the bridge already uses. The current tab is inspector-only UI state: module-local + localStorage gsone.insp.v1.
// Not held = the words "not held", never 0 or blank. Notes are plain text, escaped on render, never sent to a server
// except inside the user's own export request.
import { verdictLine } from '../v2copy.js';
import { describe, basisHash } from '../basis.js';
import { handoffStates, normSamples } from '../ui.js';
import { hzRun, fuelToStudio } from '../studiohash.js';
import { candidateGates, candidateTally } from './decision.js';
import * as RX from '../rules/isone.js';
import { CITED_PATHS } from '../rules/revenue.js';
import { citations as finCitations } from '../rules/finance.js';
import * as PI from './project-inputs.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NH = 'not held';

export const INSP_TABS = [{ id: 'bus', label: 'Bus' }, { id: 'card', label: 'Card' }, { id: 'evidence', label: 'Evidence' }, { id: 'notes', label: 'Notes' }, { id: 'export', label: 'Export' }];
export const TAB_KEY = 'gsone.insp.v1';
const CASE_LABEL = { sp: 'Summer peak', sh: 'Shoulder', ll: 'Large load' }; // app.js CASE_LABEL (L159)
export const SIGN_CONVENTION = 'ISO-NE: LMP = E + C + L';

// ---------- Bus ----------
/** The gate line: Decision's own tally (candidateTally → gateTally → v2copy.verdictLine) when the host passes it, so the
 *  inspector prints the band's and Decision's exact words, including "as of this stage" while an input still loads
 *  (S2-GD #5); else verdictLine over the gates (the same call the band makes). */
export function gateLine(gs, tally = null) {
  if (!Array.isArray(gs)) return null;
  const pass = gs.filter(x => x.verdict === 'Pass').length, fail = gs.filter(x => x.verdict === 'Fail').length, hold = gs.length - pass - fail;
  const t = tally && typeof tally.label === 'string' && tally.total === gs.length ? tally : null;
  return { text: t ? t.label : verdictLine({ pass, hold, fail }), pass, hold, fail, total: gs.length, tone: t ? t.tone : fail ? 'bad' : pass === gs.length && gs.length ? 'ok' : 'warn',
    title: t ? t.title : null, pending: t ? t.pending || [] : [],
    lines: gs.map(x => ({ gate: x.gate, verdict: x.verdict === 'Hold' ? 'Open' : x.verdict, why: x.why || '' })) };
}
/** Price-mapping label: the band's tier rule (app.js chromeModel `tier`), one wording everywhere. */
export function tierLabel(b) {
  if (!b || !b.tier) return NH;
  const km = Number(b.proxyKm);
  if (b.tier === 'direct') return 'Own price node';
  if (b.tier === 'same_substation') return 'Same-substation price node';
  if (b.tier === 'geo_proxy') return km < 0.05 ? 'Co-located price node' : `Borrowed price · ${km.toFixed(1)} km`;
  return String(b.tier);
}
const HANDOFF_ROWS = [['Prices → Economics', 'prices'], ['Grid → Economics / Finance', 'grid'], ['Economics → Finance, Decision', 'economics']];

/** Bus tab: identity, the one gate verdict (current bus only), hand-offs, pin / option state and the D-008 note. */
export function busModel({ S, D, id, gates, tally = null, meta, project }) {
  id = String(id ?? S.nodeId);
  const b = (D?.index || []).find(x => String(x.id) === id) || {}, n = (D?.nodes || []).find(x => String(x.id) === id) || {};
  const name = b.name || n.name || null, kv = b.kv ?? n.nominal_kv ?? null;
  const current = id === String(S.nodeId);
  const sus = meta?.coverage?.suspect_pnode_links;
  const suspect = sus && (sus.buses || []).map(Number).includes(Number(id))
    ? `Price node relinked (suspect link): the rank-1 price node ${b.pnode ? `${b.pnode} ` : ''}is farther from this bus than any geo-proxy link${sus.threshold_mi != null ? ` (> ${sus.threshold_mi} mi)` : ''}, so it is read as a same-name node in another town. The zone is corrected to the best co-located node's; prices are still read through the rank-1 node (D-008).`
    : null;
  const hs = handoffStates(S, S.basis ? basisHash(S.basis) : null);
  const pinned = (S.pins || []).map(String).includes(id);
  const inCompare = current || (S.ui?.dOpts || []).map(String).includes(id);
  let setOption;
  if (project) {
    const o = project.options.find(x => String(x.busId) === id);
    setOption = !o ? { act: null, v: null, why: `Not an option of ${project.name}: the options come from the sample project.` }
      : o.id === S.walk?.option ? { act: null, v: null, why: `Already the selected option (${o.label}).` }
        : { act: 'sel-opt', v: o.id, label: `Set as option (${o.label})` };
  } else setOption = current ? { act: null, v: null, why: 'This is the current bus.' } : { act: 'node', v: id, label: 'Make this the current bus' };
  const gate = current ? gateLine(gates, tally) : null;
  return {
    id, title: name || `Bus ${id}`, current, pinned, inCompare, suspect, setOption,
    sub: [kv != null ? `${kv} kV` : null, b.zone || n.load_zone || null, current ? 'current bus' : 'not the current bus'].filter(Boolean).join(' · '),
    rows: [['Bus id', id], ['Voltage', kv != null ? `${kv} kV` : NH], ['Zone', b.zone || n.load_zone || NH], ['Substation', b.substation || n.substation_name || NH],
      ['Price node', b.pnode || NH], ['Price mapping', tierLabel(b)]],
    gate, gateWhy: current ? (gate ? null : 'Gates load with the bus.') : 'Gates are computed for the current bus only: make this the current bus to read its verdict.',
    handoffs: HANDOFF_ROWS.map(([k, s]) => ({ k, state: hs[s]?.state || 'none', why: hs[s]?.why || '' })),
    pin: { act: 'pin', v: id, label: pinned ? 'Unpin' : 'Pin' },
  };
}

// ---------- Evidence: rule citations ----------
const S22 = 'interconnection.schedule22', S23 = 'interconnection.schedule23';
/** The rules each stage/tab's cards rest on, by path in rules/isone-2026.json. Lookup order: stage/tab@fuel, stage@fuel,
 *  stage/tab, stage. A stage with no entry cites nothing (the Evidence tab says so). */
export const RULE_USE = {
  'queue/cash': [`${S22}.initial_deposit`, `${S22}.study_deposit`, `${S22}.readiness_deposit_initial`, `${S22}.deposit_in_lieu_site_control`, `${S22}.readiness_deposit_restudy`,
    `${S22}.readiness_deposit_facilities_study`, `${S22}.lgia_deposit`, `${S22}.withdrawal_penalty`, `${S23}.initial_deposit`, `${S23}.study_deposit`],
  'queue/schedule': [`${S22}.request_window`, `${S22}.customer_engagement_window_days`, `${S22}.cluster_study_days`, `${S22}.restudy_days`, `${S22}.facilities_study_days`],
  'queue/cluster': [`${S22}.site_control_at_request`, `${S22}.cost_allocation`],
  'queue/changes': [`${S22}.withdrawal_penalty`, `${S22}.restudy_days`],
  // Large load (S6, rules/largeload.js): the ISO-NE / PTO-AC proposal, every entry pending the §205 filing.
  'queue@datacenter': ['large_load', 'large_load.rns_rate', 'large_load.schedule1_rate', 'large_load.study_days', 'large_load.services', 'large_load.filing'],
  'grid@datacenter': ['large_load.threshold_mw', 'large_load.threshold_kv', 'large_load.services'],
  'grid': [`${S22}.ratings`, `${S22}.storage_charging_study_basis`, `${S22}.cost_allocation`],
  // S4 #3: every rule the revenue engine reads (rules/revenue.js CITED_PATHS) joins the tab's own list, once each.
  'economics': [...new Set(['tax.itc_rate', 'tax.ptc_rate_2026', 'tax.itc_basis_reduction', 'tax.bonus_depreciation', 'tax.macrs_class_years', 'tax.wind_solar_cutoffs', 'tax.notice_2025_42',
    'tax.storage_phaseout', 'tax.transfer_price', 'capacity.price_path_default', 'capacity.qc_solar_default', 'capacity.rmri_preliminary', 'recs_ma.class1_price_default', 'recs_ma.clean_peak_price_default',
    'pfp.ppr', 'pfp.balancing_ratio_cap', 'defaults_atb2025.finance', ...CITED_PATHS])],
  'economics@datacenter': ['large_load', 'large_load.rns_rate', 'large_load.schedule1_rate', 'large_load.cra', 'large_load.capacity', 'large_load.local_adders'],
  'decision@datacenter': ['large_load'],
};
export function ruleAt(rules, path) {
  let o = rules;
  for (const k of String(path).split('.')) { if (!o || typeof o !== 'object') return null; o = o[k]; }
  return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
}
const usd = v => `$${Number(v).toLocaleString('en-US')}`;
const pctS = v => `${+(v * 100).toFixed(4)}%`;
const human = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const SKIP = new Set(['src', 'status', 'note', 'effective', 'unit', 'history', 'rows', 'formula']);
/** One rule's value in words, from its own fields (no number is typed here). */
export function ruleValue(e) {
  if (!e) return NH;
  if (e.held === false) return NH;                        // e.g. large_load.local_adders: not retrieved
  if (typeof e.badge === 'string') return e.badge;        // large_load.filing: the filing state in words
  if ('value' in e && (typeof e.value !== 'object' || e.value === null)) {
    const v = e.value, op = { '>=': '≥ ', '>': '> ', '<=': '≤ ', '<': '< ' }[e.op] || '';
    if (typeof v !== 'number') return String(v);
    if (e.unit === '$') return `${usd(v)}${e.alt ? ` (${usd(e.alt.value)} when ${e.alt.when})` : ''}`;
    if (e.unit) return `${op}${v.toLocaleString('en-US')} ${e.unit}`;
    return v <= 1 && v > 0 ? pctS(v) : v.toLocaleString('en-US');
  }
  if ('pct_of_network_upgrades' in e) return `${pctS(e.pct_of_network_upgrades)} of network upgrades${e.due_days ? `, due in ${e.due_days} days` : ''}${e.less ? `, less ${e.less}` : ''}`;
  if ('multiple_of_study_deposit' in e) return `${e.multiple_of_study_deposit} × study deposit${e.forms ? ` (${e.forms.join(', ')})` : ''}`;
  if ('per_mw' in e) return `${usd(e.per_mw)}/MW, ${usd(e.min)}–${usd(e.max)}`;
  if ('days' in e) return `${e.days} days${e.window_2026 ? ` (2026 window ${e.window_2026.join(' to ')})` : ''}`;
  if (Array.isArray(e.rows) && e.rows.some(r => r && r.code)) return e.rows.map(r => `${r.code} ${r.name || ''}`.trim()).join(' · '); // large_load.services
  if (Array.isArray(e.rows) && e.rows.some(r => r && r.service)) return e.rows.map(r => `${r.service}: ${String(r.text || '').split(/[.:]\s/)[0]}`).join(' · '); // large_load.capacity
  if (typeof e.formula === 'string') return e.formula; // large_load.cra
  if ('rule' in e) return String(e.rule);
  if ('method' in e) return `${e.method}: ${e.impact}, DFAX threshold ${pctS(e.dfax_threshold)}`;
  if ('options' in e) return `${e.options.join(' or ')} days`;
  const parts = Object.entries(e).filter(([k, v]) => !SKIP.has(k) && !k.startsWith('_') && v != null && typeof v !== 'object').map(([k, v]) => `${k.replace(/_/g, ' ')} ${typeof v === 'number' && v > 0 && v < 1 ? pctS(v) : v}`);
  const nested = Object.entries(e).filter(([k, v]) => !SKIP.has(k) && v && typeof v === 'object' && !Array.isArray(v)).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Object.entries(v).map(([a, b]) => `${a} ${b}`).join(', ')}`);
  return [...parts, ...nested].join(' · ') || NH;
}
const BADGE = new Set(['pending', 'contingent', 'assumption', 'unverifiable']);
function ruleRow(rules, path) {
  const e = ruleAt(rules, path); if (!e) return null;
  const segs = path.split('.'), grp = segs.length > 1 ? segs[segs.length - 2] : '';
  const prefix = { schedule22: 'Sched 22 · ', schedule23: 'Sched 23 · ', large_load: 'Large load · ' }[grp] || '';
  const label = path === 'large_load' ? 'Large-load procedure' : `${prefix}${human(segs[segs.length - 1])}`;
  const value = path === 'large_load' ? String(e._note || '').split('. ')[0] : ruleValue(e);
  return { path, label, value, src: e.src || NH, status: e.status, effective: e.effective || null, badge: BADGE.has(e.status) ? e.status : null, note: e.note || null };
}
/** Cost to enter the ISO-NE queue at `mw`: S3's engine (rules/isone.js entryCost) is the one home for the figure and
 *  its words; this only shapes it for the Evidence row. `rules` = the file the Inspector loaded (null → not loaded). */
export function costToEnter(rules, mw) {
  if (!rules) return null;
  const e = RX.entryCost({ mw });
  if (e.status !== 'ok') return null;
  return { mw: Number(mw), total: e.total, cash: e.cash, src: e.cite.src, status: e.cite.status, value: e.text, text: `${e.text} · ${e.cite.text}`, effective: e.cite.effective };
}
function ruleKeys(stage, tab, tech) {
  for (const k of [`${stage}/${tab}@${tech}`, `${stage}@${tech}`, `${stage}/${tab}`, stage]) if (RULE_USE[k]) return RULE_USE[k];
  return [];
}
/** Paths the engines cite beyond the tab's own list: Queue (generators) → every interconnection rule the active profile
 *  uses (rules/isone.js citations, S3 #1); Economics → every finance default and tax rule (rules/finance.js citations, S5 #6). */
function engineCitedPaths(stage, tech, rules, profile) {
  if (stage === 'queue' && tech !== 'datacenter') { try { return RX.citations(profile).map(c => c.path); } catch { return []; } }
  if (stage === 'economics') { try { return finCitations(rules).map(c => c.key); } catch { return []; } }
  return [];
}
/** The rule rows for a stage/tab: the tab's own rules first, then every other rule the stage's engine cites (once each),
 *  each with src + status (+ effective date when held); the queue's cost to enter first. */
export function rulesFor(stage, tab, rules, { mw, tech, profile } = {}) {
  if (!rules) return [];
  const own = ruleKeys(stage, tab, tech), paths = [...new Set([...own, ...engineCitedPaths(stage, tech, rules, profile)])];
  const rows = paths.map(p => ruleRow(rules, p)).filter(Boolean);
  if (own.includes(`${S22}.initial_deposit`)) {
    const c = costToEnter(rules, mw);
    if (c) rows.unshift({ path: null, derived: true, label: `Cost to enter at ${c.mw} MW`, value: c.value, src: c.src, status: c.status, effective: c.effective, badge: BADGE.has(c.status) ? c.status : null, note: 'initial deposit + study deposit (cash) + readiness deposit, at the request' });
  }
  return rows;
}

/** Evidence tab: the basis, the data sources and the rules this tab rests on. */
export function evidenceModel({ S, D, rules, rulesErr, health, meta, stage, tab }) {
  const b = S.basis, hy = b?.mode === 'historical' && b.years?.length === 1 ? b.years[0] : null;
  const run = hzRun(S.hz);
  const basis = [
    ['Price basis', b ? describe(b) : 'loading'],
    ['History year', hy != null ? String(hy) : b?.mode === 'forecast' ? 'n/a (forecast basis applied)' : b ? 'multi-year' : 'loading'],
    [`PCR run (horizon ${S.hz})`, run || NH],
    ...(b?.mode === 'forecast' ? [['Applied run', b.run || NH]] : []),
    ['Study case', `${CASE_LABEL[S.caseKey] || S.caseKey} (${S.caseKey})`],
    ['Sign convention', SIGN_CONVENTION],
  ];
  const id = String(S.nodeId);
  const series = [...new Set((D?.series || []).filter(s => String(s.nodeId) === id).map(s => s.source).filter(Boolean))];
  const grid = String(D?.grid?.source || 'unified.fact_headroom / fact_limiting_element').replace(/^unified\.?\s*/, '');
  const sources = [
    ['Unified DB tables', [...series, grid].join(' · ')],
    ['DB file', health?.db || NH], ['DB modified', health?.db_mtime || NH],
    ['Map/grid generation', meta?.generation || NH],
    ['Rules file', 'rules/isone-2026.json'], ['Rules version', rules?.version || NH],
  ];
  const mw = S.tech === 'datacenter' ? S.importMW : S.exportMW;
  return { basis, sources, rules: rulesFor(stage, tab, rules, { mw, tech: S.tech, profile: S.ui?.qProfile }), rulesState: rules ? 'ok' : rulesErr ? 'error' : 'loading', rulesErr: rulesErr || null, stage, tab };
}

/** A rendered money figure back to dollars ("$455k", "≥ $1.2M", "$455,000"); null when it is not a figure. */
export function parseMoney(t) {
  const m = /\$\s?(-?[\d,]*\.?\d+)\s*([kM])?/.exec(String(t || ''));
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(v) ? v * (m[2] === 'k' ? 1e3 : m[2] === 'M' ? 1e6 : 1) : null;
}

// ---------- Card ----------
/** Card tab from a card read off the board (readCard): the card's own text, verbatim. */
export function cardModel(d) {
  if (!d) return { empty: 'Select a card', why: 'Click any card on the board to read its question, its figures and its calculation here. The (i) on a card opens its calculation.' };
  const c = d.checks || {}, parts = [];
  if (c.pass) parts.push(`${c.pass} reconcile`);
  if (c.fail) parts.push(`${c.fail} ${c.fail === 1 ? 'does' : 'do'} not reconcile`);
  if (c.unknown) parts.push(`${c.unknown} cannot be checked (value not held)`);
  return {
    title: d.title, sub: d.sub || '', answer: d.answer || '', where: [d.stage, d.tab].filter(Boolean).join(' › '), chips: d.chips || [],
    kpis: (d.kpis || []).map(k => ({ label: k.label, value: k.value, unit: /^not held/i.test(k.value) ? '' : k.unit || '', note: k.note || '' })),
    tables: (d.tables || []).filter(t => t.rows?.length).map(t => ({ head: t.head || [], rows: t.rows, more: t.more || 0 })),
    traceId: d.traceId || null, traceHtml: d.traceHtml || null, traceWhy: d.traceHtml ? null : 'No calculation trace on this card.',
    checkLine: parts.length ? parts.join(' · ') : null, checks: c, depthHidden: !!d.depthHidden,
  };
}

// ---------- Notes (localStorage gsone.notes.v1, schema v1) ----------
export const NOTES_KEY = 'gsone.notes.v1', NOTES_V = 1;
export const notesKey = (project, bus) => `${project || '-'}|${bus}`;
export function readNotes(storage) {
  let raw;
  try { raw = storage.getItem(NOTES_KEY); } catch { return { v: NOTES_V, notes: {}, skipped: 'storage unavailable' }; }
  if (raw == null) return { v: NOTES_V, notes: {} };
  let j; try { j = JSON.parse(raw); } catch { return { v: NOTES_V, notes: {}, skipped: 'unreadable' }; }
  if (!j || typeof j !== 'object') return { v: NOTES_V, notes: {}, skipped: 'unreadable' };
  if (j.v !== NOTES_V) return { v: NOTES_V, notes: {}, skipped: `schema v${j.v} is not v${NOTES_V}` };
  const notes = {};
  for (const [k, list] of Object.entries(j.notes && typeof j.notes === 'object' ? j.notes : {})) {
    if (!Array.isArray(list)) continue;
    const ok = list.filter(e => e && typeof e === 'object' && typeof e.text === 'string').map(e => ({ t: String(e.t ?? ''), text: e.text }));
    if (ok.length) notes[k] = ok;
  }
  return { v: NOTES_V, notes };
}
/** false when the write failed or would overwrite a newer schema's data. */
export function writeNotes(storage, store) {
  if (store?.skipped && /^schema/.test(store.skipped)) return false;
  try { storage.setItem(NOTES_KEY, JSON.stringify({ v: NOTES_V, notes: store.notes })); return true; } catch { return false; }
}
export function addNote(store, key, text, t) {
  const s = String(text ?? '').trim().slice(0, 4000);
  if (!s) return store;
  return { ...store, notes: { ...store.notes, [key]: [...(store.notes[key] || []), { t: String(t), text: s }] } };
}
export function removeNote(store, key, i) {
  const list = (store.notes[key] || []).filter((_, j) => j !== Number(i)), notes = { ...store.notes };
  if (list.length) notes[key] = list; else delete notes[key];
  return { ...store, notes };
}
export function notesHtml(list) {
  if (!list?.length) return '<p class="insp-empty">No notes for this bus yet.</p>';
  return `<ol class="insp-notes">${list.map((n, i) => `<li class="finding"><p>${esc(n.text)}</p><div class="m">${esc(String(n.t).slice(0, 16).replace('T', ' '))} <button type="button" class="insp-link" data-insp="note-del" data-i="${i}" aria-label="Delete this note">Delete</button></div></li>`).join('')}</ol>`;
}

// ---------- Export (POST through the server's proxy allow-list to :5034) ----------
// The real request schemas, read from the pinned live code (read-only):
//   concern_export_api.py → tools/build_siting_workbook.normalise_scope: top-level keys read by .get (others ignored),
//     `studio` checked against VIEW_KEYS (unknown keys → 400).
//   concern_sced_node_api.py → tools/build_node_sced_deliverable.normalise_request: REQUEST_KEYS only (unknown → 400).
export const SITING_KEYS = ['bus_id', 'asset', 'mw', 'direction', 'project_name', 'option_name', 'cod', 'studio'];
export const STUDIO_VIEW_KEYS = ['case', 'horizon', 'hist_year', 'gate', 'weights', 'requirements', 'duration_h', 'storage', 'revenue', 'demo'];
export const SCED_KEYS = ['bus_id', 'asset', 'mw', 'settled_year', 'runs', 'duration_h', 'client'];
const SITING_ASSET = { solar: 'solar', wind: 'wind', storage: 'storage', hybrid: 'hybrid', datacenter: 'data center' }; // ASSET_ALIASES keys
const SCED_RUNS = ['5yr', 'pcr2030', '10yr', 'pcr2035', 'pcr2040']; // RUN_YEARS keys
const SCED_SETTLED = [2020, 2025]; // SETTLED_YEARS (2026 is part-year)
const STUDIO_HORIZONS = [2025, 2030, 2035, 2040, 2045, 2050];

/** The request for one export: {kind, url, body, block (why it cannot be sent) | null, bus}. */
export function exportRequest(kind, { S, project, busName, rules, health, meta, notes }) {
  const opt = project && S.walk ? project.options.find(o => o.id === S.walk.option) || null : null;
  const bus = String(opt ? opt.busId : S.nodeId), mw = Number(S.tech === 'datacenter' ? S.importMW : S.exportMW);
  const b = S.basis, hist = b?.mode === 'historical' && b.years?.length === 1 ? Number(b.years[0]) : null;
  const pcrRun = b?.mode === 'forecast' ? b.run || null : hzRun(S.hz);
  const block = !(mw > 0) ? `Set a size above 0 MW first: the export is built at the request size.` : !/^\d+$/.test(bus) ? `Bus ${bus} is not a study bus.` : null;
  if (kind === 'sced') {
    const body = { bus_id: Number(bus), asset: fuelToStudio(S.tech), mw };
    if (hist != null && hist >= SCED_SETTLED[0] && hist <= SCED_SETTLED[1]) body.settled_year = hist;
    if (pcrRun && SCED_RUNS.includes(pcrRun)) body.runs = [pcrRun];
    return { kind, url: './api/proxy/export/sced-node', body, block, bus };
  }
  const studio = { case: S.caseKey };
  if (hzRun(S.hz) && STUDIO_HORIZONS.includes(Number(S.hz))) studio.horizon = Number(S.hz);
  if (hist != null && hist >= 2020 && hist <= 2026) studio.hist_year = hist;
  const body = {
    bus_id: Number(bus), asset: SITING_ASSET[S.tech] || 'solar', mw,
    project_name: String(project?.name || 'One Studio screening').slice(0, 120),
    option_name: String(opt?.label || busName || `Bus ${bus}`).slice(0, 120),
    studio,
    oneStudio: {
      selection: { project: project?.id || null, option: opt?.id || null, bus, case: S.caseKey, hz: Number(S.hz), hist, fuel: S.tech, size: mw },
      generation: meta?.generation ?? null, db: { path: health?.db ?? null, mtime: health?.db_mtime ?? null }, pcrRun: pcrRun || null,
      rulesVersion: rules?.version ?? null, notes: notes || [],
    },
  };
  return { kind, url: './api/proxy/export/siting-workbook', body, block, bus };
}
/** The siting export's read-only plan request: the SAME body to /plan (the SCED export writes nothing, so it has none). */
export function planRequest(r) {
  return r?.kind === 'siting' ? { url: './api/proxy/export/siting-workbook/plan', body: r.body } : null;
}
/** The plan answer ({exists, option_id, adds, message}, concern_export_api.siting_workbook_plan) in words for the panel. */
export function planView(p) {
  if (!p || typeof p !== 'object' || typeof p.exists !== 'boolean') return { writes: null, headline: 'The export service did not say what this export would change.', items: [], message: '' };
  if (p.exists) return { writes: false, headline: `This export reuses option ${p.option_id} already in the Canvas portfolio on :5034; nothing is added.`, items: [], message: String(p.message || '') };
  const a = p.adds || {}, items = [];
  if (a.project?.new) items.push(`New project: ${a.project.name}`);
  if (a.location?.new) items.push(`New location: ${a.location.name}`);
  if (a.option) items.push(`New option: ${a.option.name} (${Number(a.option.requested_mw).toLocaleString('en-US')} MW at bus ${a.option.bus_id})`);
  return { writes: true, headline: 'This export adds a new option to the Canvas portfolio on :5034.', items, message: String(p.message || '') };
}
export function exportErrorText(status, body) {
  if (status === 502) return 'Export service not running (:5034)';
  if (status === 413) return `Export request too large${body?.max_bytes ? ` (limit ${Number(body.max_bytes).toLocaleString('en-US')} bytes)` : ''}`;
  if (status === 415 || status === 400) return `Export refused: ${body?.error || 'bad request'}`;
  return `Export failed (HTTP ${status})${body?.error ? `: ${body.error}` : ''}`;
}
/** The download name from Content-Disposition, reduced to a bare file name. */
export function filenameFrom(cd, fallback) {
  let name = null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd || '');
  if (star) { try { name = decodeURIComponent(star[1].trim()); } catch { name = null; } }
  if (!name) { const m = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/.exec(cd || ''); name = m ? (m[1] ?? m[2]).trim() : null; }
  name = name ? name.split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').trim() : '';
  return name && name !== '.' && name !== '..' ? name : fallback;
}

// ======================================================================================================================
// Browser: mountInspector(hostEl, api)
// ======================================================================================================================
const TABS = new Set([...INSP_TABS.map(t => t.id), 'inputs']); // 'inputs' (plan 14 §6a) exists while a project is open
const pill = (tone, text, title = '') => `<span class="badge ${tone}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
const kv = rows => `<dl class="insp-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd${v === NH ? ' class="nh"' : ''}>${esc(v)}</dd>`).join('')}</dl>`;
const STATE_TONE = { current: 'ok', stale: 'warn', none: '' };

/** A card read off the board: its rendered text (the card's own formatters), its trace, its reconciliation checks. */
function readCard(sec, where) {
  const txt = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const kpis = [...sec.querySelectorAll('.kpi')].map(k => {
    const v = k.querySelector('.value'), u = v?.querySelector('.unit'), vc = v?.cloneNode(true);
    vc?.querySelector('.unit')?.remove();
    return { label: txt(k.querySelector('.label')), value: txt(vc), unit: txt(u), note: txt(k.querySelector('.note')) };
  }).filter(k => k.label || k.value);
  // The card's own tables (first two, first 12 rows), cell text as rendered: the same formatters, never re-formatted.
  const tables = [...sec.querySelectorAll('.card-b table')].filter(t => !t.closest('details.trace')).slice(0, 2).map(t => {
    const body = [...(t.tBodies[0]?.rows || [])].filter(r => r.cells.length);
    return { head: [...t.querySelectorAll('thead th')].map(txt), rows: body.slice(0, 12).map(r => [...r.cells].map(txt)), more: Math.max(0, body.length - 12) };
  });
  const traceId = sec.querySelector('[data-act="card-trace"]')?.dataset.v || sec.dataset.trace || sec.querySelector('details.trace[data-trace]')?.dataset.trace || null;
  const tr = traceId ? [...document.querySelectorAll('#board details.trace[data-trace]')].find(d => d.dataset.trace === traceId) : null;
  let traceHtml = null; const checks = { pass: 0, fail: 0, unknown: 0 };
  if (tr) {
    const c = tr.cloneNode(true);
    c.removeAttribute('data-trace'); c.setAttribute('data-insp-trace', traceId); c.open = true; c.classList.remove('flash');
    traceHtml = c.outerHTML;
    tr.querySelectorAll('.trace-check .pill').forEach(p => { const t = p.textContent; if (/^Reconciles/.test(t)) checks.pass++; else if (/^Does not/.test(t)) checks.fail++; else checks.unknown++; });
  }
  return { title: txt(sec.querySelector('.card-h h3')), sub: txt(sec.querySelector('.card-h .card-sub')), answer: txt(sec.querySelector('.card-answer')),
    chips: [...sec.querySelectorAll('.w-badges .badge')].map(txt), kpis, tables, traceId, traceHtml, checks, stage: where.stage, tab: where.tab, depthHidden: sec.hidden };
}

export function mountInspector(hostEl, api) {
  if (typeof document === 'undefined' || !api?.getState) return null;
  if (window.__gsInspector) return window.__gsInspector;
  if (!document.querySelector('link[data-gsx-insp]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = './inspector.css'; l.setAttribute('data-gsx-insp', '1'); document.head.appendChild(l);
  }
  if (api.getProject && !document.querySelector('link[data-gsx-pi]')) {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = './views/project-inputs.css'; l.setAttribute('data-gsx-pi', '1'); document.head.appendChild(l);
  }
  const st = { tab: 'bus', rules: null, rulesErr: null, health: null, meta: null, busy: null, last: null, draft: '', lastInsp: undefined, html: '', store: readNotes(localStorage) };
  try { const t = JSON.parse(localStorage.getItem(TAB_KEY) || '{}'); if (t.v === 1 && TABS.has(t.tab)) st.tab = t.tab; } catch { /* storage off: default tab */ }
  const saveTab = () => { try { localStorage.setItem(TAB_KEY, JSON.stringify({ v: 1, tab: st.tab })); } catch { /* session only */ } };
  const toast = msg => {
    if (typeof api.toast === 'function') return api.toast(msg);
    const t = document.getElementById('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  };
  const host = () => (hostEl?.isConnected ? hostEl : (hostEl = document.getElementById('inspector')));
  const getJson = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))));
  getJson('./rules/isone-2026.json').then(j => { st.rules = j; }).catch(e => { st.rulesErr = e.message; }).finally(() => draw());
  getJson('/health').then(j => { st.health = j; }).catch(() => {}).finally(() => draw());
  // The map/grid meta (generation id + coverage, for Evidence, Export and the D-008 note) comes from the host, never
  // from a read of its route here (bridge.test: no views/ module reads a display-only field): api.getMeta() when the
  // host passes it, else the bridge's `gsbridge:ready` event ({generation, meta}).
  const takeMeta = m => { if (m && typeof m === 'object' && m.generation) { st.meta = m; draw(); } };
  const loadMeta = () => { try { const m = api.getMeta?.(); if (m && typeof m.then === 'function') m.then(takeMeta, () => {}); else takeMeta(m); } catch { /* host has no meta yet */ } };
  loadMeta();
  // The sample projects (app.js keeps its copy private; the bridge reads the same file the same way).
  getJson('./data/samples.json').then(j => { st.samples = normSamples(j).projects; }).catch(() => { st.samples = []; }).finally(() => draw());
  window.addEventListener('gsbridge:ready', e => {
    const d = e.detail || {};
    if (d.meta) takeMeta(d.meta);
    else if (d.generation && d.generation !== st.meta?.generation) { loadMeta(); if (d.generation !== st.meta?.generation) takeMeta({ generation: d.generation }); } // coverage unknown: no D-008 note
  });

  const activeTabId = () => document.querySelector('#board .tabs [role="tab"][aria-selected="true"]')?.dataset.v || null;
  const activeTabName = () => document.querySelector('#board .tabs [role="tab"][aria-selected="true"]')?.textContent.trim() || '';
  const stageName = S => (S.stage ? S.stage[0].toUpperCase() + S.stage.slice(1) : '');
  // The open project: the host's (user projects + Dummy samples, L1) when it passes getProject, else the samples file.
  const projectOf = S => (api.getProject ? api.getProject() : S.walk ? (st.samples || []).find(p => p.id === S.walk.project) || null : null);
  const tabsFor = S => (api.getProject && projectOf(S) ? [{ id: 'inputs', label: 'Project inputs' }, ...INSP_TABS] : INSP_TABS);
  let piErr = {}, lastProj;
  const cardEl = key => [...document.querySelectorAll('#board [role="tabpanel"] section.card[data-insp-key]')].find(s => s.dataset.inspKey === key) || null;

  function busView(S, D) {
    // Always the current bus: every selection path (map, grid, search, option chip, hash) sets S.nodeId, while a
    // S.ui.inspect bus id goes stale after a later search or link (found by the D-008 smoke).
    const id = String(S.nodeId);
    // S2-GD #5: the gates and the tally are Decision's own (candidateGates / candidateTally): the band's exact words.
    let gates = null, tally = null;
    try { gates = id === String(S.nodeId) ? candidateGates(D, S) : null; tally = gates ? candidateTally(D, S) : null; } catch (e) { console.warn('[inspector] gates:', e.message); }
    const m = busModel({ S, D, id, gates, tally, meta: st.meta, project: projectOf(S) });
    const g = m.gate;
    return `<header class="insp-h"><div class="insp-kick">Bus · #${esc(m.id)}</div><h2 class="insp-title" data-insp-title>${esc(m.title)}</h2><p class="lede">${esc(m.sub)}</p></header>
      <div class="pv insp-gate"><div class="k">Decision gates</div><div class="v">${g ? `<b class="insp-verdict ${g.tone}" data-insp-gate${g.title ? ` title="${esc(g.title)}"` : ''}>${esc(g.text)}</b>
        <details class="insp-more"><summary>Each gate</summary><ul class="insp-gates">${g.lines.map(l => `<li><span class="badge ${l.verdict === 'Pass' ? 'ok' : l.verdict === 'Fail' ? 'bad' : 'warn'}">${esc(l.verdict)}</span> <b>${esc(l.gate)}</b> <span class="insp-why">${esc(l.why)}</span></li>`).join('')}</ul></details>` : `<span class="insp-why" data-insp-gate-why>${esc(m.gateWhy)}</span>`}</div></div>
      ${m.suspect ? `<div class="insp-note warn" role="note">${esc(m.suspect)}</div>` : ''}
      <div class="pv"><div class="k">Identity</div>${kv(m.rows)}</div>
      <div class="pv"><div class="k">Hand-offs</div><ul class="insp-list">${m.handoffs.map(h => `<li>${pill(STATE_TONE[h.state] ?? '', h.state === 'none' ? 'not sent' : h.state)} <b>${esc(h.k)}</b><span class="insp-why">${esc(h.why)}</span></li>`).join('')}</ul></div>
      <div class="pv"><div class="k">Pinned and compare</div><div class="v">${m.pinned ? 'Pinned' : 'Not pinned'} · ${m.inCompare ? 'in the Decision compare' : 'not in the Decision compare'}</div></div>
      <div class="insp-acts"><button type="button" class="btn sm" data-act="${m.pin.act}" data-v="${esc(m.pin.v)}" aria-pressed="${m.pinned}">${esc(m.pin.label)}</button>
        ${m.setOption.act ? `<button type="button" class="btn sm pri" data-act="${m.setOption.act}" data-v="${esc(m.setOption.v)}">${esc(m.setOption.label)}</button>` : projUser(S) ? '' : `<span class="insp-why">${esc(m.setOption.why)}</span>`}
        ${projActs(S, m.id)}</div>`;
  }

  // L1 (plan 14 §6): "New project here" on any bus; "Add option" to the open user project when the bus is not one yet.
  const projUser = S => { const p = api.projectsOn?.() ? projectOf(S) : null; return p?.user ? p : null; };
  function projActs(S, id) {
    if (!api.projectsOn?.()) return '';
    const u = projUser(S), isOpt = u?.options.some(o => String(o.busId) === String(id));
    return `${u && !isOpt ? `<button type="button" class="btn sm" data-act="proj-add-opt" data-v="${esc(id)}" title="Add this bus as an option of ${esc(u.name)}">Add option to ${esc(u.name)}</button>` : ''}<button type="button" class="btn sm" data-act="proj-new-here" data-v="${esc(id)}">New project here</button>`;
  }
  function inputsView(S) {
    const p = projectOf(S);
    return PI.render(p, { errors: piErr, sizes: api.sizes?.() ?? null, option: p && S.walk?.project === p.id ? S.walk.option ?? undefined : undefined, busCoord: api.busCoord?.(S) ?? null }); // the published study sizes: the host passes the bridge's GS.SIZES
  }

  function cardView(S) {
    const I = S.ui?.inspect;
    if (I?.kind !== 'card') { const e = cardModel(null); return `<div class="insp-empty-state"><b>${esc(e.empty)}</b><p>${esc(e.why)}</p></div>`; }
    const tabNow = activeTabId();
    if (I.stage && (I.stage !== S.stage || (I.tab && tabNow && I.tab !== tabNow))) {
      return `<div class="insp-empty-state"><b>${esc(I.id.replace(/#\d+$/, ''))}</b><p>This card is on ${esc(stageName({ stage: I.stage }))}${I.tab ? ` › ${esc(I.tab)}` : ''}, not on the board in view.</p><button type="button" class="btn sm" data-act="goto" data-v="${esc(I.stage)}" ${I.tab ? `data-tab="${esc(I.tab)}"` : ''}>Open it</button></div>`;
    }
    const sec = cardEl(I.id);
    if (!sec) return `<div class="insp-empty-state"><b>Select a card</b><p>The selected card (${esc(I.id.replace(/#\d+$/, ''))}) is not on this tab at this fuel or depth.</p></div>`;
    const m = cardModel(readCard(sec, { stage: stageName(S), tab: activeTabName() }));
    return `<header class="insp-h"><div class="insp-kick">Card · ${esc(m.where)}</div><h2 class="insp-title" data-insp-card-title>${esc(m.title)}</h2>${m.sub ? `<p class="lede">${esc(m.sub)}</p>` : ''}${m.depthHidden ? `<p class="insp-note">Hidden at this depth on the board.</p>` : ''}</header>
      ${m.answer ? `<div class="pv"><div class="k">The answer</div><div class="v">${esc(m.answer)}</div></div>` : ''}
      ${m.kpis.length ? `<div class="pv"><div class="k">Figures on the card</div><dl class="insp-kv insp-kpis">${m.kpis.map(k => `<dt>${esc(k.label)}</dt><dd data-insp-kpi="${esc(k.label)}"${/^not held/i.test(k.value) ? ' class="nh"' : ''}><span class="insp-kv-v">${esc(k.value)}</span>${k.unit ? ` <span class="unit">${esc(k.unit)}</span>` : ''}${k.note ? `<small>${esc(k.note)}</small>` : ''}</dd>`).join('')}</dl></div>` : ''}
      ${m.tables.map((t, i) => `<div class="pv"><div class="k">${i ? 'Second table' : 'Table'} on the card${t.more ? ` · first ${t.rows.length} of ${t.rows.length + t.more} rows` : ''}</div><div class="insp-tw"><table class="insp-t" data-insp-table="${i}">${t.head.length ? `<thead><tr>${t.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${t.rows.map(r => `<tr>${r.map(c => `<td${/^not held/i.test(c) ? ' class="nh"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`).join('')}
      ${m.chips.length ? `<div class="pv"><div class="k">Provenance</div><div class="v">${m.chips.map(c => pill('', c)).join(' ')}</div></div>` : ''}
      <div class="pv"><div class="k">Calculation</div>${m.checkLine ? `<div class="v insp-checks">${esc(m.checkLine)}</div>` : ''}${m.traceHtml ? `<div class="insp-trace">${m.traceHtml}</div>` : `<div class="v insp-why">${esc(m.traceWhy)}</div>`}</div>`;
  }

  function evidenceView(S, D) {
    const e = evidenceModel({ S, D, rules: st.rules, rulesErr: st.rulesErr, health: st.health, meta: st.meta, stage: S.stage, tab: activeTabId() });
    let cmp = '';
    // Queue › Cash: the card's own "Cost to enter" next to the engine's (both read rules/isone.js since S3; a guard).
    const ce = e.rules.find(r => r.derived), k = ce && [...document.querySelectorAll('#board [role="tabpanel"] .kpi')].find(x => /^(Cost to enter|Cash out at request)/i.test(x.querySelector('.label')?.textContent.trim() || '')); // S3 label, then the pre-S3 one
    if (ce && k) {
      const v = k.querySelector('.value')?.textContent.replace(/\s+/g, ' ').trim() || '', cost = costToEnter(st.rules, S.exportMW), num = parseMoney(v);
      if (cost?.total != null && num != null && Math.abs(num - cost.total) > 0.5)
        cmp = `<div class="insp-note warn" role="note" data-insp-rule-mismatch>The Queue card shows ${esc(v)} to enter; the rules engine gives ${esc(usd(cost.total))} (${esc(cost.src)}, ${esc(cost.status)}). The card does not read the rules file yet.</div>`;
    }
    const rules = e.rulesState === 'loading' ? '<p class="insp-why">Loading rules/isone-2026.json…</p>' : e.rulesState === 'error' ? `<p class="insp-note bad" role="alert">The rules file could not load: ${esc(e.rulesErr)}</p>`
      : e.rules.length ? `<ul class="insp-rules">${e.rules.map(r => `<li${r.derived ? ' class="insp-derived"' : ''}><b>${esc(r.label)}</b><span class="insp-rv">${esc(r.value)}</span><span class="insp-cite" data-insp-src><span class="mono">${esc(r.src)}</span> · ${esc(r.status)}${r.effective ? ` · effective ${esc(r.effective)}` : ''}</span>${r.badge ? ` ${pill(r.badge === 'pending' || r.badge === 'contingent' ? 'warn' : '', r.badge)}` : ''}${r.note ? `<small>${esc(r.note)}</small>` : ''}</li>`).join('')}</ul>`
        : '<p class="insp-why">No rule-file constants govern this tab.</p>';
    return `<header class="insp-h"><div class="insp-kick">Evidence · ${esc(stageName(S))}${activeTabName() ? ` › ${esc(activeTabName())}` : ''}</div><h2 class="insp-title">Basis, sources and rules</h2></header>
      <div class="pv"><div class="k">Basis</div>${kv(e.basis)}</div>
      <div class="pv"><div class="k">Data sources</div>${kv(e.sources)}</div>
      <div class="pv"><div class="k">Rules on this tab</div>${cmp}${rules}</div>
      <div class="insp-acts"><button type="button" class="btn sm" data-act="open-evidence" title="Every input, its source, the hand-offs and what is still open">Inputs &amp; evidence (full)</button></div>
      <p class="insp-foot">Screening evidence, not an interconnection approval. Missing values print "not held", never zero.</p>`;
  }

  function notesView(S) {
    const p = projectOf(S), bus = String(S.nodeId), key = notesKey(p?.id, bus), list = st.store.notes[key] || [];
    return `<header class="insp-h"><div class="insp-kick">Notes · ${esc(p ? p.name : 'no project')} · #${esc(bus)}</div><h2 class="insp-title">Notes on this bus</h2></header>
      ${st.store.skipped ? `<div class="insp-note warn" role="note">Saved notes were not read (${esc(st.store.skipped)}).${/^schema/.test(st.store.skipped) ? ' They are kept as they are; new notes are not saved over them.' : ''}</div>` : ''}
      <label class="insp-field"><span class="k">New note</span><textarea class="ta" data-insp="note-text" rows="3" maxlength="4000" placeholder="Plain text. Ctrl+Enter adds it.">${esc(st.draft)}</textarea></label>
      <div class="insp-acts"><button type="button" class="btn sm pri" data-insp="note-add">Add note</button><span class="insp-why">${list.length} note${list.length === 1 ? '' : 's'}</span></div>
      ${notesHtml(list)}
      <p class="insp-foot">Stored in this browser only (${NOTES_KEY}, schema v${NOTES_V}); no server writes. The last write wins across browser tabs. Included in the siting-workbook export.</p>`;
  }

  function ctx(S) {
    const p = projectOf(S), D = api.getData();
    const name = id => D?.index?.find(b => String(b.id) === String(id))?.name || null;
    const opt = p && S.walk ? p.options.find(o => o.id === S.walk.option) : null;
    const bus = String(opt ? opt.busId : S.nodeId);
    return { S, project: p, busName: name(bus), rules: st.rules, health: st.health, meta: st.meta, notes: st.store.notes[notesKey(p?.id, bus)] || [] };
  }
  function exportView(S) {
    const c = ctx(S), si = exportRequest('siting', c), sc = exportRequest('sced', c);
    const differs = si.bus !== String(S.nodeId);
    // The siting plan answer, with Confirm / Cancel in the panel. A selection change since the check makes it stale.
    const P = st.plan, stale = P && P.key !== JSON.stringify(si.body);
    const plan = r => (r.kind !== 'siting' || !P ? '' : `<div class="insp-plan" role="group" aria-label="Confirm the siting export" data-insp-plan="${P.view.writes === true ? 'writes' : P.view.writes === false ? 'reuses' : 'unknown'}">
      <b class="insp-plan-h">${esc(P.view.headline)}</b>${P.view.items.length ? `<ul class="insp-list">${P.view.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${P.view.message ? `<p class="insp-why">Export service: ${esc(P.view.message)}</p>` : ''}
      ${stale ? '<p class="insp-note warn" role="note">The selection changed since this check: check again before building.</p>' : ''}
      <div class="insp-acts"><button type="button" class="btn sm pri" data-insp="export-confirm" ${stale || st.busy ? 'disabled' : ''}>Confirm and build</button><button type="button" class="btn sm" data-insp="export-cancel">Cancel</button></div></div>`);
    const btn = (r, label, what) => `<div class="pv insp-exp"><div class="k">${esc(label)}</div><div class="v">${esc(what)}</div>
      ${plan(r) || `<div class="insp-acts"><button type="button" class="btn sm pri" data-insp="export" data-v="${r.kind}" ${st.busy || r.block ? 'disabled' : ''} aria-busy="${st.busy === r.kind}">${st.busy === r.kind ? (r.kind === 'siting' && !P ? 'Checking…' : 'Building…') : r.kind === 'siting' ? 'Check and download siting workbook' : `Download ${esc(label.toLowerCase())}`}</button></div>`}
      <details class="insp-more"><summary>Request sent</summary><pre class="insp-pre">${esc(JSON.stringify(r.body, null, 1))}</pre></details></div>`;
    return `<header class="insp-h"><div class="insp-kick">Export · #${esc(si.bus)} · ${esc(c.busName || '')}</div><h2 class="insp-title">Workbooks</h2><p class="lede">${esc(`${S.tech} · ${si.body.mw} MW · ${CASE_LABEL[S.caseKey] || S.caseKey}`)}${c.project ? ` · ${esc(c.project.name)}` : ''}</p></header>
      ${differs ? `<div class="insp-note" role="note">Exports use the selected option's bus (#${esc(si.bus)}), not the bus in view (#${esc(S.nodeId)}).</div>` : ''}
      ${si.block ? `<div class="insp-note warn" role="note">${esc(si.block)}</div>` : ''}
      ${!hzRun(S.hz) ? `<div class="insp-note warn" role="note">Horizon ${esc(S.hz)} has no solved run here; the request leaves the horizon to the export service's default.</div>` : ''}
      ${btn(si, 'Siting workbook', 'The 16-sheet siting assessment. The export service reuses this option in the Canvas portfolio, or adds it there: you see which, and confirm, before it builds.')}
      ${btn(sc, 'SCED node study', 'The node study for this bus alone, from the study store; writes nothing to the portfolio.')}
      ${st.last ? `<p class="insp-why" data-insp-export-last role="status">${esc(st.last)}</p>` : ''}
      <p class="insp-foot">Sent through this server's export proxy to the export service (:5034). The siting request carries the selection, map/grid generation, DB stamp, PCR run, rules version and your notes in <code>oneStudio</code>; the SCED request accepts no extra fields.</p>`;
  }

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fail = async res => { let b = null; try { b = await res.json(); } catch { /* not JSON */ } const t = exportErrorText(res.status, b); st.last = t; toast(t); };
  /** Siting: ask the read-only /plan what the export would change, then wait for Confirm in the panel. */
  async function planExport() {
    if (st.busy) return;
    const r = exportRequest('siting', ctx(api.getState()));
    if (r.block) { toast(r.block); return; }
    const p = planRequest(r);
    st.busy = 'siting'; st.plan = null; st.last = 'Checking what the export would change…'; draw();
    try {
      const res = await post(p.url, p.body);
      if (!res.ok) { await fail(res); return; }
      st.plan = { view: planView(await res.json().catch(() => null)), req: r, key: JSON.stringify(r.body) }; st.last = null;
    } catch (e) { st.last = `Export check failed: ${e.message}`; toast(st.last); } finally { st.busy = null; draw(); }
  }
  async function runExport(kind, planned) {
    if (st.busy) return;
    if (kind === 'siting' && !planned) return planExport();
    const S = api.getState(), r = planned || exportRequest(kind, ctx(S));
    if (r.block) { toast(r.block); return; }
    st.busy = kind; if (planned) st.plan = null; draw();
    try {
      const res = await post(r.url, r.body);
      if (!res.ok) { await fail(res); return; }
      const blob = await res.blob(), name = filenameFrom(res.headers.get('Content-Disposition'), `GridSense-${kind === 'sced' ? 'SCED-Node-Study' : 'Siting-Assessment'}-${r.bus}.xlsx`);
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
      st.last = `Downloaded ${name}`; toast(st.last);
    } catch (e) { st.last = `Export failed: ${e.message}`; toast(st.last); } finally { st.busy = null; draw(); }
  }

  function view(S, D) {
    const tabs = tabsFor(S);
    if (!tabs.some(t => t.id === st.tab)) st.tab = 'bus';
    const body = st.tab === 'inputs' ? inputsView(S) : st.tab === 'bus' ? busView(S, D) : st.tab === 'card' ? cardView(S) : st.tab === 'evidence' ? evidenceView(S, D) : st.tab === 'notes' ? notesView(S) : exportView(S);
    return `<div class="insp" data-insp-tab="${st.tab}"><div class="insp-tabs" role="group" aria-label="Inspector tabs">${tabs.map(t => `<button type="button" data-insp="tab" data-v="${t.id}" aria-pressed="${t.id === st.tab}" class="${t.id === st.tab ? 'on' : ''}">${t.label}</button>`).join('')}</div><div class="insp-b" role="region" aria-label="Inspector · ${tabs.find(t => t.id === st.tab).label}">${body}</div></div>`;
  }

  function markCard(S) {
    const I = S.ui?.inspect, key = I?.kind === 'card' && I.stage === S.stage ? I.id : null;
    document.querySelectorAll('#board section.card.insp-sel').forEach(s => { if (s.dataset.inspKey !== key) s.classList.remove('insp-sel'); });
    if (key) cardEl(key)?.classList.add('insp-sel');
  }

  function draw() {
    const h = host(); if (!h) return;
    let S, D;
    try { S = api.getState(); D = api.getData(); } catch { return; }
    if (!S || !D) return;
    // A new selection switches to its tab (map / grid click → Bus, card click → Card); the first read only records it.
    const ik = JSON.stringify(S.ui?.inspect ?? null);
    if (st.lastInsp !== undefined && ik !== st.lastInsp) { const k = S.ui?.inspect?.kind; if (k === 'bus' || k === 'card') { st.tab = k; saveTab(); } }
    st.lastInsp = ik;
    // A user project opening (or switching) makes Project inputs the first, current tab (plan 14 §6a).
    const pp = api.getProject ? projectOf(S) : null, pk = pp ? pp.id : null;
    if (lastProj !== undefined && pk !== lastProj) { piErr = {}; if (pp?.user) { st.tab = 'inputs'; saveTab(); } }
    lastProj = pk;
    let html;
    try { html = view(S, D); } catch (e) { console.error(e); html = `<div class="insp"><div class="insp-b"><p class="insp-note bad" role="alert">The inspector could not render this tab: ${esc(e.message)}</p></div></div>`; }
    h.querySelector(':scope>.gsf-ph[data-gsf="placeholder"]')?.remove();
    if (html !== st.html || !h.querySelector(':scope>.insp')) {
      const a = document.activeElement, inside = a && h.contains(a), fk = inside ? a.dataset.insp || null : null, sel = inside && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null;
      const sc = h.querySelector('.insp-b')?.scrollTop || 0, sameTab = h.querySelector(':scope>.insp')?.dataset.inspTab === st.tab;
      h.innerHTML = html; st.html = html;
      if (sameTab) { const b = h.querySelector('.insp-b'); if (b) b.scrollTop = sc; }
      if (fk) { const el = h.querySelector(`[data-insp="${fk}"]`); if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(...sel); } catch { /* not a text field */ } } }
    }
    markCard(S);
  }

  function selectCard(detail) {
    if (!detail?.key) return;
    const S = api.getState(), tab = activeTabId(), cur = S.ui?.inspect;
    st.tab = 'card'; saveTab();
    if (cur?.kind === 'card' && cur.id === detail.key && cur.stage === S.stage && cur.tab === tab) { draw(); return; }
    st.lastInsp = JSON.stringify({ kind: 'card', id: detail.key, stage: S.stage, tab });
    api.dispatch('ui', { kind: 'card', id: detail.key, stage: S.stage, tab }, { dataset: { k: 'inspect' } });
  }
  window.addEventListener('gsone:card', e => selectCard(e.detail));
  window.addEventListener('gsone:insp-tab', e => { if (TABS.has(e.detail)) { st.tab = e.detail; saveTab(); draw(); } });
  // Project inputs: a change is validated by projects.js; a rejected value is not applied and its reason shows under the
  // field; an accepted one is saved, pushed into the dashboard state, and earlier findings on a basis input go stale.
  document.addEventListener('change', e => {
    if (!inHost(e)) return;
    const ev = PI.readEvent(e.target); if (!ev || ev.act !== 'proj-field') return;
    const p = projectOf(api.getState()), r = PI.applyField(p, ev.k, ev.raw, { rules: api.rules?.() ?? null });
    if (!r.ok) { piErr = { [ev.k]: r.why }; st.html = ''; draw(); toast(r.why); return; }
    piErr = {}; api.saveProject(r.project);
    const n = r.basis && r.changed ? api.markStaleAll(r.k, r.old, r.value) : 0; // re-entering the same value is not a change (fix-2)
    api.applyProject(r.project); const inc = Object.values(r.incomplete || {})[0]; toast(`${PI.savedText(r.k, r.old, r.value, n)}${inc ? ` ${inc}` : ''}`); st.html = ''; draw();
  });

  const inHost = e => { const h = host(); return h && h.contains(e.target); };
  document.addEventListener('click', e => {
    if (!inHost(e)) return;
    const el = e.target.closest('[data-insp]'); if (!el || el.disabled) return;
    const k = el.dataset.insp;
    if (k === 'tab' && TABS.has(el.dataset.v)) { st.tab = el.dataset.v; saveTab(); draw(); host()?.querySelector(`[data-insp="tab"][data-v="${st.tab}"]`)?.focus(); }
    else if (k === 'note-add') addDraft();
    else if (k === 'note-del') {
      const S = api.getState(), key = notesKey(projectOf(S)?.id, String(S.nodeId));
      const next = removeNote(st.store, key, el.dataset.i);
      if (writeNotes(localStorage, next)) { st.store = next; toast('Note deleted.'); } else toast('The note could not be deleted: browser storage is unavailable.');
      draw();
    } else if (k === 'export') runExport(el.dataset.v);
    else if (k === 'export-confirm' && st.plan) runExport('siting', st.plan.req);
    else if (k === 'export-cancel') { st.plan = null; st.last = 'Siting export cancelled: nothing was built or added.'; draw(); }
  });
  document.addEventListener('click', e => {
    if (!inHost(e)) return;
    const b = e.target.closest?.('[data-act="proj-dup"]'); if (!b || PI.readEvent(b)?.act !== 'proj-dup') return;
    const p = projectOf(api.getState()); if (p && api.duplicate) { api.duplicate(p.id); st.tab = 'inputs'; saveTab(); draw(); }
  });
  function addDraft() {
    const S = api.getState(), key = notesKey(projectOf(S)?.id, String(S.nodeId));
    const next = addNote(st.store, key, st.draft, new Date().toISOString());
    if (next === st.store) { toast('Write the note first.'); return; }
    if (!writeNotes(localStorage, next)) { toast('The note was not saved: browser storage is unavailable or holds a newer notes schema.'); return; }
    st.store = next; st.draft = ''; draw(); toast('Note saved in this browser.');
  }
  document.addEventListener('input', e => { if (inHost(e) && e.target.matches('[data-insp="note-text"]')) { st.draft = e.target.value; st.html = ''; } });
  document.addEventListener('keydown', e => {
    if (inHost(e) && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.matches('[data-insp="note-text"]')) { e.preventDefault(); addDraft(); return; }
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    // The shell's own Esc targets (drawer, dialog, maximised card) go first; then Esc closes the inspector.
    if (document.querySelector('.drawer, .modal-backdrop, section.card.card-max')) return;
    if (inHost(e)) { window.GSFrame?.setDock('inspector', false); document.getElementById('board')?.focus?.(); return; }
    const S = api.getState();
    if (S.ui?.inspect?.kind === 'card' && !e.target.closest?.('input, select, textarea, [contenteditable]')) api.dispatch('ui', null, { dataset: { k: 'inspect' } });
  });
  window.addEventListener('storage', e => { if (e.key === NOTES_KEY) { st.store = readNotes(localStorage); draw(); } });

  api.onRender(draw);
  draw();
  const out = { draw, state: st };
  window.__gsInspector = out;
  return out;
}
