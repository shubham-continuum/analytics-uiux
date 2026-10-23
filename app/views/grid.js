// Grid dashboard (v3, dense card layout): four analyzer tabs. Rules in ../gridrules.js (Claude pack §G1/§G2/§G4
// merged with Codex's allocator in ../grid.js, all-bus review rules kept). Consumes stored thermal screening, the PCR
// solved runs and the element/planning tables; it does not run new power-flow, voltage or stability studies.
// Per-bus context (network, short circuit, PCR binding, association, curtailment, nearby changes, older copies) is read
// lazily from api_grid.py (/api/x/grid/<name>/<bus>) through ./grid-data.js.
import { parseFacility, caseTable, binding, elementLimit, envelope, stepCost, stepCostAll, stepCostService, applicableCases, CASE_LABEL, loadingBasis, loadingAt, loadingScreen, costOf,
  sizeSweep, unlockSteps, perKw, scMetrics, loadingBars, typeVoltageSummary, severityBins, studyAtSize, deliveredValue, offeredMwh, copyNote,
  ENVELOPE_ONLY, unstudiedCases, studyBasis, STUDY_VINTAGE, studyStaleness, preExistingCounts, largestWithoutUpgrades } from '../gridrules.js';
// P2 grid fixes 2026-10-10 (C03 C04 C10 C11 C13 C34 C39 C42 C72, map tips): one home for each rule in gridrules.js.
import { bindingText, SET_LABEL, ENVELOPE_METHOD, sourceLabel, costDisplay, chargeMW, preExistingText, PRE_EXISTING_LABEL, transferCheck, facilityKey, sweepSummary, CCIS_NOTE } from '../gridrules.js';
import { stalenessFor } from './grid-staleness.js';
import { serviceTag, cnrBound, NOT_ASSESSED, affectedSystemFlag, proportionalImpact, parseCluster, weightedScr, surplusScreen, order1920Screen } from '../gridrules.js';
import { allocateCosts } from '../grid.js';
import { fmt } from '../basis.js';
import * as CH from '../charts.js';
import { traceCapacity, traceConstraints, traceCost, traceMitigation, traceSweep, traceScr, tracePcr, traceAssoc, traceUnlock, tracePerKw, traceCurtail, traceNearby } from './grid-trace.js';
import { traceWscr, traceSurplus, traceAffected, traceProp, trace1920 } from './grid-trace-v5.js';
import { gridData, pending } from './grid-data.js';
import { sizeNotHeld, sizeNotHeldCard } from './decision.js'; // nullmw: one rule and one phrase for a not-held size
import { oneLine, scatterSvg } from './grid-charts.js';
import { getRules, rulesError } from '../rules/isone.js';
import { pendingBadge } from '../rules/largeload.js';
import { withDcCards, dropGeneratorOnly } from './grid-dc.js';
import { geoMap, geoMapSvg, geoLegend } from '../geomap.js';
import { boxOf, padExtent, mapGeom, frameMap, afterMapRender, categoryBar, tabEnter } from './mapview.js';
import { netMapModel, netAnswer, substationTip, busTip } from './grid-netmap.js';
import { traceNetMap } from './grid-trace-v6.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
// One view (2026-10-22): while renderGrid collects a tab's figures (SINK), every KPI the tab builds is also handed to it, in order.
let SINK = null;
// True while a category tab is drawn as before (its own slider and network card); false while the Map tab reads the parts.
let AS_TAB = false;
// A figure whose value is words (a status such as "No upgrades indicated", never $0) is set smaller and wraps in the map
// view rather than being cut; every value carries its full text as a tooltip.
const kpi = (label, value, unit, note, nh = false) => { const txt = String(value ?? ''), word = txt.length > 3 && !/^[\s≥≤<>~+−–$€£-]*\d/.test(txt); const h = `<div class="kpi${nh ? ' nh' : ''}${word ? ' kpi-word' : ''}"><div class="label">${esc(label)}</div><div class="value" title="${esc(txt)}${unit ? ` ${esc(unit)}` : ''}">${esc(value)}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>${note ? `<div class="note" title="${esc(note)}">${esc(note)}</div>` : ''}</div>`; if (SINK) SINK.push(h); return h; };
// D6.1 / F009: an envelope-only case is amber "Envelope only · unverified", never the green Fits.
const pill = s => { const t = s === ENVELOPE_ONLY ? 'Envelope only · unverified' : s; return `<span class="pill ${/^Fits|Priced|True zero|Held/.test(t) ? 'good' : /Does not fit|Hold|Lower bound|Not assessed|Not studied|Envelope only/.test(t) ? 'warn' : ''}" ${s === ENVELOPE_ONLY ? 'title="Vendor substation envelope: the headline element set (first element to reach rating), vintage unconfirmed (D-007); context only (D6.1), never a pass"' : ''}>${esc(t)}</span>`; };
const musd = v => (ok(v) ? `$${v.toFixed(2)}M` : 'not held');
const n1 = v => (ok(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : 'not held');
const n2 = v => (ok(v) ? v.toFixed(2) : 'not held');
const n3 = v => (ok(v) ? v.toFixed(3) : '—');
const pct = v => (ok(v) ? `${v.toFixed(1)}%` : '—');
const fac = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const short = s => { const p = /^\s*\d+\s(.{12})\s*[\d.]+\s+\d+\s(.{12})\s*[\d.]+\s+(\S+)/.exec(String(s ?? '')); return p ? `${p[1].trim()} – ${p[2].trim()}${p[3] !== '1' ? ` ckt ${p[3]}` : ''}` : fac(s); };
// o = { depth: 'screen'|'review'|'study' (minimum depth, default review), trace: trace id of the headline number, chips: provenance tokens }
const DEPTHS = ['screen', 'review', 'study'];
// o.answer: the card's one computed sentence (trusted HTML built from esc'd values; <b> marks the key numbers).
const card = (cls, title, sub, body, foot = '', tools = '', o = {}) => `<section class="card ${cls}" data-depth="${DEPTHS.includes(o.depth) ? o.depth : 'review'}"${o.trace ? ` data-trace="${esc(o.trace)}"` : ''}${o.chips ? ` data-chips="${esc(o.chips)}"` : ''}><header class="card-h"><h3>${esc(title)}</h3>${sub ? `<span class="card-sub">${esc(sub)}</span>` : ''}${tools ? `<div class="card-tools">${tools}</div>` : ''}</header><div class="card-b">${o.answer ? `<p class="card-answer">${o.answer}</p>` : ''}${body}</div>${foot ? `<footer class="card-f">${foot}</footer>` : ''}</section>`;
const B = v => `<b>${esc(v)}</b>`;
const more = inner => `<details class="more-ctl"><summary>More options</summary>${inner}</details>`;
const nextLink = (text, stage, tab, btn = 'Open') => `<div class="next-step"><span role="link" tabindex="0" class="clickable" data-act="goto" data-v="${esc(stage)}" data-tab="${esc(tab)}">Next: ${text} →</span></div>`;
const dense = (head, rows, cls = '') => `<div class="table-wrap ${cls}"><table class="dense"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
const seg = (k, items, cur) => `<div class="segmented seg-sm" role="group">${items.map(([v, l]) => `<button type="button" data-act="ui" data-k="${k}" data-v="${esc(v)}" class="${v === cur ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
const details = (calc, assumptions, evidence) => `<details><summary>Method</summary>${calc}</details><details><summary>Assumptions</summary>${assumptions}</details><details><summary>Evidence and sources</summary>${evidence}</details>`;
const traceCard = (traces, extra = '') => `<section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculations</h3><span class="card-sub">formula, inputs with sources, working, checks and a CSV for every figure on this tab</span></header><div class="card-b">${traces.join('')}${extra}</div></section>`;

// The former four tabs, now the four groups of the one view (2026-10-22), and the strip's lean names for them (v8 copy).
const GROUPS = [
  { id: 'capacity', label: 'Connection capacity', short: 'Limit', labelFor: t => ({ datacenter: 'Load connection capacity', storage: 'Discharge & charge capacity', hybrid: 'Export & charge capacity' }[t] || 'Connection capacity') },
  { id: 'constraints', label: 'Constraints & coverage', short: 'Bottlenecks' },
  { id: 'cost', label: 'Upgrade cost allocator', short: 'Upgrades', labelFor: t => (t === 'datacenter' ? 'Load upgrade cost allocator' : 'Upgrade cost allocator') },
  { id: 'mitigation', label: 'Mitigation & phasing', short: 'Phasing', labelFor: t => (t === 'datacenter' ? 'Load phasing & alternatives' : 'Mitigation & phasing') },
];
const groupLabel = (id, tech) => { const g = GROUPS.find(x => x.id === id); return (g.labelFor && g.labelFor(tech)) || g.label; };
/** A step or link naming a tab (by id, label for any fuel or lean name) → the tab. */
const FOCUS = Object.fromEntries(GROUPS.flatMap(g => [g.id, g.short, g.label, ...(g.labelFor ? ['solar', 'wind', 'storage', 'hybrid', 'datacenter'].map(t => g.labelFor(t)) : [])].map(k => [String(k).toLowerCase(), g.id])));
export const GRID = {
  key: 'grid',
  question: 'What can connect, and what might need upgrading?',
  lede: 'The map first: the network around the bus with the facilities that limit it, the connection limits, what upgrades would cost and what fits without them, with the inputs and the limiting facilities beside it. Limit, Bottlenecks, Upgrades and Phasing each keep their full analysis on their own tab, as before.',
  // The map is one tab; the four analyses are their own tabs again (2026-10-23), so the case matrix or the cost allocator
  // starts at the top of its page instead of under the map. One bar (views/mapview.js) draws them as buttons.
  ownTabs: true,
  tabs: [{ id: 'map', label: 'Grid map' }, ...GROUPS.map(({ id, label, labelFor }) => (labelFor ? { id, label, labelFor } : { id, label }))],
  tabAlias: { ...Object.fromEntries(Object.entries(FOCUS).filter(([k, v]) => k !== v)), 'grid map': 'map' },
};
const TECH_WORD = { solar: 'solar', wind: 'wind', storage: 'storage', hybrid: 'hybrid', datacenter: 'data centre' };
const na = (cls, title, tech, why, depth = 'review') => card(cls, title, `not applicable to ${TECH_WORD[tech] || tech}`, `<div class="notice">${esc(why)}</div>`, '', '', { depth, chips: 'not-held', answer: `Not applicable to ${esc(TECH_WORD[tech] || tech)}.` });
/** The large-load pending badge from the rules file (S6, REGISTER §5); never a hand-typed date. Not held if the rules file is not loaded. */
const llBadge = () => { try { return pendingBadge(getRules()).text; } catch { return `large-load filing status not held (${rulesError() || 'rules file not loaded'})`; } };
const svcPill = (key, tech = null) => { const t = serviceTag(key, tech); return `<span class="pill" title="${esc(t.long)}">${esc(t.short)}</span>`; };

const techKey = t => (t === 'datacenter' ? 'datacenter' : t);
const isStorage = t => ['storage', 'hybrid'].includes(t);
function evidence(data) {
  return `<p>${esc(sourceLabel(data.grid))}. ${esc(data.grid.coverageNote)} Snapshot ${esc(data.metadata.createdAt?.slice(0, 10))}, read-only.</p>
    <p>Two headroom datasets exist and disagree on many buses: the substation <b>envelope</b> (${esc(SET_LABEL.envelope)}: the ${esc(ENVELOPE_METHOD)}) and the <b>element study</b> (${esc(SET_LABEL.element)}: lowest facility transfer). They are two element sets of different vintage; the element study governs here (D6.1).</p>
    <p>Solar and storage cannot show a proven $0 upgrade cost: the shoulder export case has no usable facility list in the store (its rows are the large-load table under a shoulder label), so it rests on the vendor envelope. Such results read "no upgrades indicated".</p>
    <p>Context cards read api_grid.py: the unified database first; the headroom study's injection test and the older envelope copy from ISONE_GridSense.duckdb; the Studio's own figures from studio/src/data-ext.js (plan/extract_grid.py). Every figure from an older copy is labelled so.</p>`;
}
const ctxOf = (S, name) => gridData(name, S.nodeId);
const depthOf = (ctx, S) => (DEPTHS.includes(ctx?.depth) ? ctx.depth : DEPTHS.includes(S?.depth) ? S.depth : 'review');
const IDLE = { state: 'ok', value: null, idle: true }; // a Study-only endpoint skipped below Study
// Study-only fetches are skipped below Study (depth contract): the record stays idle and the card is hidden anyway.
const studyOnly = (ctx, S, name) => (depthOf(ctx, S) === 'study' ? ctxOf(S, name) : IDLE);
const v5Of = S => gridData('v5', S.nodeId, 'gridext');

// ---------- Tab 1: Connection capacity ----------
const MATRIX_ROWS = [['summer_peak', 'Summer peak'], ['shoulder', 'Shoulder'], ['large_load', 'Large load']];
const EL_TEXT = { noViolation: 'no violations; tested max not published', unpublished: 'every row pre-existing', mislabel: 'rows not usable (store mislabel)', none: 'no facility rows' };
function caseMatrix(data, S, tech, focus) {
  const app = applicableCases(tech), on = new Set([...app.export, ...app.import]);
  const cell = key => {
    const [sc, dir] = key.split('|');
    if (sc === 'large_load' && dir === 'discharge') return '<div class="gx-cell off"><b>not studied</b><span>no large-load injection case in the store</span></div>';
    const env = envelope(data.grid, S.nodeId, key), el = elementLimit(data.grid, S.nodeId, key);
    const gov = el.status === 'held' ? el.limit : ['noViolation', 'unpublished'].includes(el.status) ? null : env;
    const req = dir === 'discharge' ? Number(S.exportMW) : chargeMW(tech, S.exportMW, S.importMW); // C13: one charge convention
    const row = on.has(key) ? caseTable(data.grid, S.nodeId, tech, dir === 'discharge' ? req : 0, dir === 'charge' ? req : 0).find(r => r.key === key) : null;
    const st = !on.has(key) ? 'context' : !(req > 0) ? 'not requested' : row ? row.status : 'Not studied'; // the engine's status (one home)
    return `<div class="gx-cell ${on.has(key) ? 'on' : ''}"><b>${ok(gov) ? fmt.mw(gov) : ['noViolation', 'unpublished'].includes(el.status) ? 'Hold' : 'not held'}</b><span>element ${el.status === 'held' ? fmt.mw(el.limit) : esc(EL_TEXT[el.status])}</span><span>envelope ${ok(env) ? fmt.mw(env) : 'not held'}${el.status === 'held' && ok(env) && Math.abs(env - el.limit) / Math.max(env, el.limit) > 0.1 ? ' · <span class="gx-note-warn">differ &gt;10%</span>' : ''}</span><span>${on.has(key) ? pill(st) : '<span class="pill">context</span>'} ${svcPill(key, tech)} ${el.rows?.length ? `${el.rows.length} rows · ${el.pre.length} pre-existing` : ''}</span></div>`;
  };
  // F010: the cases ISO-NE studies that the store does not hold are Hold rows here, not a footnote.
  const unst = unstudiedCases(tech).map(u => `<div class="r">${esc(u.label.replace(' · export', ''))}</div><div class="gx-cell ${Number(S.exportMW) > 0 ? 'on' : ''}"><b>not studied</b><span>${esc(u.why)}</span><span>${pill('Hold')} <span class="pill" title="${esc(u.src)}">ISO-NE studies this case</span></span></div><div class="gx-cell off"><b>not studied</b><span>no case in the store</span></div>`).join('');
  return `<div class="gx-matrix"><div></div><div class="h">Injection (export / discharge)</div><div class="h">Withdrawal (import / charge)</div>
    ${MATRIX_ROWS.map(([sc, l]) => `<div class="r">${sc === focus ? `◂ ${l}` : l}</div>${cell(`${sc}|discharge`)}${cell(`${sc}|charge`)}`).join('')}${unst}</div>`;
}

function scCard(S, ctxRec) {
  const p = pending(ctxRec, 'the substation record');
  if (p) return { html: card('c-4', 'Short-circuit strength', 'fault duty at the bus against its neighbours', p, '', '', { depth: 'review' }), trace: '' };
  const load = S.tech === 'datacenter';
  const ctx = ctxRec.value, m = scMetrics(ctx.sc.own, ctx.bus.nominal_kv, load ? null : Number(S.exportMW) || Number(S.importMW));
  const items = [{ label: 'This bus', value: m.sc, note: `${ctx.bus.bus_name} ${ctx.bus.nominal_kv} kV` }, ...ctx.neighbours.slice(0, 6).map(n => ({ label: `${String(n.name).slice(0, 9)}`, value: n.sc_mva, note: `${n.name} ${n.kv} kV · ${n.mi.toFixed(1)} mi · bus ${n.bus_id}` }))];
  const pr = (b, n) => (ok(b) && n ? `P${Math.round((100 * b) / n)}` : 'not held');
  const stats = `<div class="gx-stats"><div class="gx-stat"><span>Fault duty</span><b>${ok(m.sc) ? `${fmt.int(m.sc)} MVA` : 'not held'}</b></div><div class="gx-stat"><span>Ratio at request</span><b>${load ? 'n/a (load)' : ok(m.scr) ? m.scr.toFixed(1) : '—'}</b></div><div class="gx-stat"><span>Size at ratio 3</span><b>${fmt.mw(m.mwAtRatio3)}</b></div><div class="gx-stat"><span>Fault current</span><b>${ok(m.kA) ? `${m.kA.toFixed(1)} kA` : m.kASuspect ? 'suspect' : 'not held'}</b></div><div class="gx-stat"><span>Rank, all buses</span><b>${pr(ctx.sc.all.below, ctx.sc.all.n)}</b></div><div class="gx-stat"><span>Rank, ${esc(ctx.bus.nominal_kv)} kV</span><b>${pr(ctx.sc.kv.below, ctx.sc.kv.n)}</b></div></div>`;
  return { html: card('c-4', 'Short-circuit strength', 'fault duty at the bus against its six nearest substations (hover for distance)', stats + CH.barChart(items, { fmt: v => `${Math.round(v).toLocaleString('en-US')}`, title: 'Short-circuit MVA vs neighbours', height: 170 }),
    `Unified dim_substation (corrected ×100 per data_quality). A ratio is reported as the size at which it reaches 3 (the Studio's convention), not as a threshold met; the vault holds no ISO-NE SCR criterion. Not a breaker-duty study.${load ? ' A load is not screened on a short-circuit ratio here; fault duty is system-strength context.' : ''}`, '', { depth: 'review', trace: 'g-scr', answer: ok(m.sc) ? `Fault duty is ${B(`${fmt.int(m.sc)} MVA`)}, ${B(pr(ctx.sc.all.below, ctx.sc.all.n))} of all buses${load ? '' : `; the ratio falls to 3 at ${B(fmt.mw(m.mwAtRatio3))}`}.` : 'Fault duty is not held for this bus.' }), trace: traceScr(ctx, m, load ? null : Number(S.exportMW) || Number(S.importMW)) };
}

/** Weighted SCR indicator with nearby inverter-based units (dim_generator) and the SC data note. */
function wscrCard(S, tech, v5Rec, req) {
  const title = 'System strength with nearby IBR', sub = 'weighted short-circuit ratio: an indicator, not an ISO-NE criterion';
  if (tech === 'datacenter') return { html: na('c-4', title, tech, 'a short-circuit ratio screens inverter-based injection; a data centre is a load. Fault duty is shown in the short-circuit card.'), trace: traceWscr(S.nodeId, null, req, {}, tech) };
  const p = pending(v5Rec, 'nearby generating units');
  if (p) return { html: card('c-4', title, sub, p, '', '', { depth: 'review' }), trace: '' };
  const v = v5Rec.value, sc = v.sc.corrected;
  const w = weightedScr({ scMVA: sc, requestMW: req, ibr: v.ibr.map(u => ({ ...u, mw: u.mw })) }, { radiusMi: v.ibr_radius_mi });
  const stats = `<div class="gx-stats"><div class="gx-stat"><span>SCR (project alone)</span><b>${ok(w.scr) ? w.scr.toFixed(1) : 'not held'}</b></div><div class="gx-stat"><span>Station-only SCR</span><b>${ok(w.stationOnly) ? w.stationOnly.toFixed(1) : 'not held'}</b></div><div class="gx-stat"><span>Weighted SCR</span><b>${ok(w.wscr) ? `${w.bound === 'upper' ? '≤ ' : ''}${w.wscr.toFixed(1)}` : 'not held'}</b></div><div class="gx-stat"><span>IBR counted (weighted)</span><b>${w.counted} · ${n1(w.ibrWeightedMW)} MW</b></div></div>`;
  const tbl = w.rows.length ? dense('<th>Unit</th><th>Status</th><th class="num">Pmax</th><th class="num">Miles</th><th class="num">Weight</th>', w.rows.slice(0, 10).map(u => `<tr><td class="wrap">${esc(u.name)}</td><td>${esc(u.status)}</td><td class="num">${fmt.mw(u.mw)}</td><td class="num">${u.atStation ? 'station' : n1(u.mi)}</td><td class="num">${u.weight.toFixed(2)}</td></tr>`).join(''))
    : `<div class="notice">No inverter-based unit (by name) within ${v.ibr_radius_mi} mi in dim_generator: the weighted ratio equals the project-alone ratio.</div>`;
  const note = ok(v.sc.published) && ok(sc) ? `Data note: the Studio copy's short-circuit value is ${fmt.int(v.sc.published)} MVA, ${Math.round(sc / v.sc.published)}× smaller than the corrected ${fmt.int(sc)} MVA used here (data_quality: source column exactly 100× too small).` : 'Short-circuit value not held for this bus.';
  return { html: card('c-4', title, sub, stats + tbl, `${esc(note)} ${esc(v.notes.ibr)} Distance weight w = max(0, 1 − mi ÷ ${v.ibr_radius_mi}) is an assumption (no impedances held).`, '', { depth: 'review', trace: 'g-wscr', chips: 'assumption studio-copy', answer: ok(w.wscr) ? `Weighted SCR ${B(`${w.bound === 'upper' ? '≤ ' : ''}${w.wscr.toFixed(1)}`)} with ${B(w.counted)} nearby inverter-based unit${w.counted === 1 ? '' : 's'} (project alone ${ok(w.scr) ? w.scr.toFixed(1) : 'not held'}); an indicator, not a criterion.` : 'The weighted ratio is not held: the short-circuit value or the request is missing.' }), trace: traceWscr(S.nodeId, sc, req, w, tech) };
}

/** Surplus interconnection screen (G5) at the existing generators of this POI. */
function surplusCard(S, tech, v5Rec, ex) {
  const title = 'Surplus interconnection (existing POI)', sub = 'Order 845 surplus service at the existing units of this station; ERIS stays ERIS';
  if (tech === 'datacenter') { const s = surplusScreen({ tech }); return { html: na('c-4', title, tech, s.why), trace: traceSurplus(S.nodeId, s, Number(S.importMW), null) }; }
  const p = pending(v5Rec, 'units at the point of interconnection');
  if (p) return { html: card('c-4', title, sub, p, '', '', { depth: 'review' }), trace: '' };
  const req = Number(S.exportMW), lim = ok(ex.value) ? ex.value : null;
  const s = surplusScreen({ units: v5Rec.value.poi_units, requestMW: req, limitMW: lim, tech });
  const tone = /^Candidate/.test(s.verdict) ? 'warn' : '';
  const body = `<div class="gx-stats"><div class="gx-stat"><span>Existing units at POI</span><b>${s.units.length}${s.units.length ? ` · ${s.operating} operating` : ''}</b></div><div class="gx-stat"><span>Existing Pmax (service proxy)</span><b>${!s.units.length ? '—' : ok(s.pmax) ? `${s.pmaxBound === 'lower' ? '≥ ' : ''}${fmt.mw(s.pmax)}` : 'not held'}</b></div><div class="gx-stat"><span>Connection limit</span><b>${ok(lim) ? `${fmt.mw(lim)} NR` : 'not held'}</b></div><div class="gx-stat"><span>Coverable by surplus</span><b>${ok(s.coverable) && /^Candidate/.test(s.verdict) ? fmt.mw(s.coverable) : '—'}</b></div></div>
    <p><span class="pill ${tone}">${esc(s.verdict)}</span> ${esc(s.why)}</p>`
    + (s.units.length ? dense('<th>Unit</th><th>Status</th><th class="num">In case</th><th class="num">Pmax</th><th>IBR</th>', s.units.map(u => `<tr><td class="wrap">${esc(u.name)} ${esc(u.id || '')}</td><td>${esc(u.status)}</td><td class="num">${fmt.mw(u.gen_mw)}</td><td class="num">${fmt.mw(u.max_mw)}</td><td>${u.ibr ? 'yes (name)' : 'no'}</td></tr>`).join('')) : '');
  return { html: card('c-4', title, sub, body, `${esc(s.service)}. ${esc(v5Rec.value.notes.surplus)} Never a pass: the owner must offer the surplus and a study must show no new network upgrades.`, '', { depth: 'review', trace: 'g-surplus', chips: 'assumption', answer: `${B(s.verdict)}: ${B(s.units.length)} existing unit${s.units.length === 1 ? '' : 's'} at this point of interconnection. Never a pass.` }), trace: traceSurplus(S.nodeId, s, req, lim) };
}

function copyNotesCard(data, S, ctxRec, stRec) {
  const p = pending(ctxRec, 'the older study copy');
  if (p) return card('c-8', 'Data notes: unified vs older copies', 'where the Studio\'s sources disagree with the unified database', p, '', '', { depth: 'study', chips: 'studio-copy' });
  const old = ctxRec.value.older, stu = stRec.state === 'ok' ? stRec.value?.bus : null;
  const rows = [];
  const tag = n => ({ same: '<span class="pill good">same</span>', differs: `<span class="pill warn">differs ${n.diff > 0 ? '+' : '−'}${Math.abs(n.diff).toFixed(1)} MW</span>`, 'older not held': '<span class="pill">older not held</span>', 'unified not held': '<span class="pill">unified not held</span>' }[n.kind]);
  for (const key of ['summer_peak|discharge', 'summer_peak|charge', 'shoulder|discharge', 'shoulder|charge', 'large_load|charge']) {
    const u = envelope(data.grid, S.nodeId, key), o = old?.envelope?.[key];
    rows.push(`<tr><td>Envelope · ${esc(CASE_LABEL[key] || key)}</td><td class="num">${fmt.mw(u)}</td><td class="num">${fmt.mw(o)}</td><td>ISONE_GridSense substations_corrected</td><td>${tag(copyNote(u, o))}</td></tr>`);
  }
  for (const key of ['summer_peak|discharge', 'summer_peak|charge', 'large_load|charge']) {
    const el = elementLimit(data.grid, S.nodeId, key), u = el.status === 'held' ? el.limit : null;
    if (key === 'summer_peak|discharge') rows.push(`<tr><td>Element limit · ${esc(CASE_LABEL[key])}</td><td class="num">${fmt.mw(u)}</td><td class="num">${fmt.mw(old?.sp_dis_element_min)}</td><td>ISONE_GridSense constraints_sp_sub_dis (${old?.sp_dis_rows ?? 0} rows)</td><td>${tag(copyNote(u, old?.sp_dis_element_min))}</td></tr>`);
    const s = stu?.lim?.[key];
    rows.push(`<tr><td>Element limit · ${esc(CASE_LABEL[key])}</td><td class="num">${fmt.mw(u)}</td><td class="num">${fmt.mw(s?.min_transfer)}</td><td>Studio data-ext.js${s ? ` (${s.rows_published} of ${s.rows_measured} rows published)` : ''}</td><td>${tag(copyNote(u, s?.min_transfer))}</td></tr>`);
  }
  return card('c-8', 'Data notes: unified vs older copies', 'the unified database is primary; a difference is shown, never blended',
    dense('<th>Quantity</th><th class="num">Unified</th><th class="num">Older copy</th><th>Older source</th><th>Note</th>', rows.join('')),
    `${esc(old?.label || 'Older study copy not held')} · Studio copy: ${esc(stRec.value?.meta?.label || (stRec.state === 'loading' ? 'loading…' : 'not held'))}. The Studio caps element rows at 12 per governing case, so its lowest limit can sit above the full list's.`, '', { depth: 'study', chips: 'studio-copy', answer: `${B(rows.filter(r => r.includes('>differs')).length)} of ${rows.length} quantities differ between the unified database and the older copies; the unified figure is used.` });
}

/** F013 + F005: the study basis under the KPI row (every field, "not held" with a reason), and the staleness of the solved
 *  case with a link to Queue › Changes & risk. Every Grid figure rests on this strip. */
function studyBasisStrip(sb, stale) {
  const cells = sb.map(r => `<div title="${esc(`${r.label}: ${r.value} · source ${r.src}`)}" style="min-width:0"><span class="audit-note" style="margin:0;display:block">${esc(r.label)}</span><b class="${r.status === 'not held' ? 'nh' : ''}" style="font-weight:${r.status === 'not held' ? 400 : 600}">${esc(r.status === 'not held' ? 'not held' : r.value)}</b></div>`).join('');
  return `<section class="gx-basis notice" data-gx="study-basis" aria-label="Study basis" style="margin:6px 0">
    <div style="display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline"><b>Study basis</b><span>${esc(stale.text)}</span><span role="link" tabindex="0" class="clickable" data-act="goto" data-v="queue" data-tab="changes">Queue › Changes &amp; risk →</span></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:4px 12px;margin-top:4px;font-size:11px">${cells}</div></section>`;
}

function tabCapacity(vctx) {
  const { data, S, node } = vctx;
  const tech = techKey(S.tech), t = caseTable(data.grid, S.nodeId, tech, Number(S.exportMW), chargeMW(tech, S.exportMW, S.importMW)); // C13
  const ex = binding(t, 'export'), im = binding(t, 'import');
  // C03: a cap handed to Economics is element-study evidence only (capMW); an envelope-only figure travels as labelled context.
  S.ui.gridLimits = { exportMW: ex.capMW, exportCase: ex.case, exportStatus: ex.status, exportRowStatus: ex.rowStatus, exportSet: ex.set, exportContextMW: ex.capMW == null && ok(ex.value) ? ex.value : null,
    importMW: im.capMW, importCase: im.case, importStatus: im.status, importRowStatus: im.rowStatus, importSet: im.set, importContextMW: im.capMW == null && ok(im.value) ? im.value : null,
    exportService: ex.row ? serviceTag(ex.row.key, tech).code : null, importService: im.row ? serviceTag(im.row.key, tech).code : null };
  const show = b => (ok(b.value) ? fmt.mw(b.value) : b.status === 'Hold' ? 'Hold' : b.status === 'Not requested' ? '—' : 'not held');
  const ctxRec = ctxOf(S, 'context'), stRec = studyOnly(vctx, S, 'studio'), v5Rec = v5Of(S);
  const req = tech === 'datacenter' ? Number(S.importMW) : Number(S.exportMW);
  const focus = vctx.caseScenario; // the scope strip's Case: display focus only; every applicable case still counts
  const rows = t.map(r => `<tr class="${focus && r.key.startsWith(`${focus}|`) ? 'gx-hi' : ''}"><td>${esc(r.label)}${focus && r.key.startsWith(`${focus}|`) ? ' ◂' : ''}</td><td>${r.dir === 'export' ? 'Export' : 'Import'}</td><td>${svcPill(r.key, tech)}</td><td class="num">${fmt.mw(r.envelope)}</td>
      <td class="num">${r.element.status === 'held' ? fmt.mw(r.element.limit) : esc({ noViolation: 'no violations', unpublished: 'not published', mislabel: 'not usable', none: 'not held' }[r.element.status])}</td>
      <td class="num"><b>${ok(r.governing) ? fmt.mw(r.governing) : '—'}</b></td><td class="num">${ok(r.requested) && r.requested > 0 ? fmt.mw(r.requested) : '—'}</td>
      <td class="num">${ok(r.margin) ? `${r.margin >= 0 ? '+' : '−'}${fmt.mw(Math.abs(r.margin))}` : '—'}</td><td>${pill(r.status)}</td>
      <td class="wrap">${esc(r.basis)}${r.disagree ? ' · <span class="pill warn">sources disagree &gt;10%</span>' : ''}${r.status === ENVELOPE_ONLY ? ` · context only: the envelope ${r.envelopeFits ? 'clears' : 'is below'} the request, which is never counted as a pass` : ''}</td></tr>`).join('')
    + (Number(S.exportMW) > 0 ? unstudiedCases(tech).map(u => `<tr><td>${esc(u.label)}</td><td>Export</td><td>${svcPill('summer_peak|discharge')}</td><td class="num">not held</td><td class="num">not studied</td><td class="num"><b>—</b></td><td class="num">${fmt.mw(Number(S.exportMW))}</td><td class="num">—</td><td>${pill('Hold')}</td><td class="wrap" title="${esc(u.src)}">${esc(u.why)}</td></tr>`).join('') : '');
  const SENDABLE = ['Fits', 'Does not fit', 'Partly studied', ENVELOPE_ONLY]; // an envelope-only limit is sent labelled, as context, never as a cap (C03)
  const capLine = (b, what) => (ok(b.capMW) ? `Economics will cap ${what} at ${fmt.mw(b.capMW)} (${esc(b.case)}, ${esc(SET_LABEL.element)}).` : ok(b.value) ? `No element-study cap for ${what}: the ${fmt.mw(b.value)} figure (${esc(b.case)}) is the envelope only, sent as context and never applied as a cap.` : `No ${what} limit is held.`);
  const canSend = SENDABLE.includes(ex.status) || SENDABLE.includes(im.status);
  // C34: a data centre gets the load's own basis (firm / non-firm withdrawal), never the generator energy-only / capacity pills.
  const caveats = (S.tech === 'datacenter'
    ? ['<span class="pill">Firm withdrawal (FCDS): the lowest withdrawal case must hold</span>', '<span class="pill warn">Non-firm (NFCDS / ICDS): curtailable above the firm limit; curtailment hours not held</span>',
      `<span class="pill warn">Large loads: no ISO-NE procedure yet; ${esc(llBadge())}</span>`,
      `<label class="field gx-llapp">Large-load application date <span class="pill warn">Your input</span><input type="date" data-act="ui-text" data-k="llAppDate" value="${esc(S.ui.llAppDate || '')}" aria-label="Large-load application date"><span class="audit-note">${S.ui.llAppDate ? 'Anchors the large-load study timeline.' : 'not held: the large-load study timeline is not anchored (the Schedule 22 cluster window does not apply to a load)'}</span></label>`]
    : ['<span class="pill">Energy-only service: all held export cases</span>', '<span class="pill warn">Capacity service: ≤ energy-only (capacity case not validated)</span>', '<span class="pill warn">Fits the studied cases only (summer peak element study; shoulder rests on the vendor envelope). Light-load and minimum-load cases not studied: Hold rows below</span>',
      `<span class="pill" title="${esc(CCIS_NOTE)}">CCIS-named column (dim_substation): not used</span>`]).join(' ');
  const storageNote = isStorage(S.tech) ? '<div class="notice warn"><b>Storage charging: envelope only.</b> The store holds no shoulder-charge facility rows, so the charge limit is the vendor-asserted substation envelope, not a facility study. Storage charging is checked only in the shoulder case. ISO-NE does not study storage charging at summer peak.</div>' : '';
  // Size sweep over the service
  const sizes = [...new Set([...Array.from({ length: 24 }, (_, i) => 25 * (i + 1)), req > 0 ? req : null].filter(v => ok(v) && v > 0))].sort((a, b) => a - b);
  const sweep = sizeSweep(data.grid, S.nodeId, tech, sizes, { importMW: Number(S.importMW) }); // C13: a hybrid's battery stays at its rating
  const sweepTbl = sweep.filter(r => [50, 100, 150, 200, 250, 300, 400, 500, 600].includes(r.size) || r.size === req).map(r => `<tr class="${r.size === req ? 'gx-hi' : ''}"><td class="num">${fmt.mw(r.size)}${r.size === req ? ' ◂' : ''}</td><td>${r.fits === true ? pill('Fits') : r.fits === false ? pill('Does not fit') : pill(r.statuses.includes('Hold') ? 'Hold' : r.statuses.includes(ENVELOPE_ONLY) ? ENVELOPE_ONLY : 'Not studied')}</td><td class="num">${ok(r.limit) ? `${r.limit - r.size >= 0 ? '+' : '−'}${fmt.mw(Math.abs(r.limit - r.size))}` : '—'}</td><td class="num">${r.overloaded ?? '—'}</td><td class="num">${esc(costDisplay(r.cost))}</td></tr>`).join('');
  const margins = CH.groupedBar(t.map(r => ({ label: r.label, values: [r.envelope, r.element.status === 'held' ? r.element.limit : null, ok(r.requested) && r.requested > 0 ? r.requested : null], highlight: r === ex.row || r === im.row })),
    { series: ['Envelope (vendor)', 'Element study', 'Request'], fmt: v => `${v.toFixed(0)} MW`, title: 'Envelope, element limit and request by case', height: 230 });
  const sc = scCard(S, ctxRec);
  const gap = (() => { const sp = t.find(r => r.key === 'summer_peak|discharge' || r.key === 'large_load|charge'); return sp && sp.element.status === 'held' && ok(sp.envelope) ? sp.envelope - sp.element.limit : null; })();
  const preC = preExistingCounts(data.grid, S.nodeId, tech); // FORMULAS D6: both sources, labelled apart
  const sb = studyBasis(data.grid, S.nodeId, { queueModelled: data.queue?.queue?.length ?? null }), stale = stalenessFor(data, S, node);
  const m = ctxRec.state === 'ok' && ctxRec.value ? scMetrics(ctxRec.value.sc.own, ctxRec.value.bus.nominal_kv, req) : null;
  const load = tech === 'datacenter';
  const svcNote = b => (b.row ? `${serviceTag(b.row.key, tech).short}${serviceTag(b.row.key, tech).code === 'NR' && ok(b.value) ? ` · ${cnrBound(b.value).text}` : ''}` : '');
  const wscr = wscrCard(S, tech, v5Rec, req), sur = surplusCard(S, tech, v5Rec, ex);
  const envOnly = t.some(r => r.status !== 'Not requested' && /^Envelope only/.test(r.basis));
  const sliderK = load ? 'Import request' : 'Export request';
  // C03: the number, its case, its set and its own status come from one row; the direction's overall verdict follows apart.
  const lim1 = (b, what, mw) => (b.row ? `${what} ${B(show(b))} (${esc(b.case)}, ${esc(SET_LABEL[b.set] || 'set not held')}): ${B(b.rowStatus)}${ok(b.value) && mw > 0 ? ` at ${esc(fmt.mw(mw))}` : ''}${b.verdict !== b.rowStatus ? `; overall ${B(b.verdict)}${b.envelopeCases?.length ? ` (${esc(b.envelopeCases.join(', '))} envelope only)` : ''}` : ''}` : `${what} ${B(show(b))} (${esc(b.status)})`);
  const capAnswer = load ? `${lim1(im, 'The import limit is', Number(S.importMW))}; a data centre is checked on large load and summer-peak charge together.`
    : `${lim1(ex, 'The export limit is', Number(S.exportMW))}${isStorage(S.tech) ? `; charging ${B(show(im))} is checked at shoulder only (envelope only)` : ''}.`;
  const fitsN = t.filter(r => r.status === 'Fits').length, askedN = t.filter(r => r.status !== 'Not requested').length;
  const lastFit = sweep.filter(r => r.fits === true).at(-1), atReqSweep = sweep.find(r => r.size === req);
  const sweepSum = sweepSummary(sweep, load ? im.capMW : ex.capMW, load ? 'Import limit' : 'Export limit', fmt.mw); // C72: step and exact limit apart
  return `${storageNote}
    <!--gx:kpis--><div class="kpis">
      ${kpi('Export limit', load ? 'n/a' : show(ex), '', load ? 'A data centre does not export' : ex.row ? `${bindingText(ex, fmt.mw)} · ${svcNote(ex)}` : ex.status, !load && !ok(ex.value) && ex.status !== 'Not requested')}
      ${kpi(load ? 'Import limit (load)' : 'Import / charge limit', show(im), '', im.row ? `${bindingText(im, fmt.mw)} · ${svcNote(im)}` : im.status, !ok(im.value) && im.status !== 'Not requested')}
      ${load ? kpi('Import margin at request', ok(im.value) && S.importMW > 0 ? `${im.value - S.importMW >= 0 ? '+' : '−'}${fmt.mw(Math.abs(im.value - S.importMW))}` : '—', '', `Request ${fmt.mw(Number(S.importMW))} · load`)
        : kpi('Export margin at request', ok(ex.value) && S.exportMW > 0 ? `${ex.value - S.exportMW >= 0 ? '+' : '−'}${fmt.mw(Math.abs(ex.value - S.exportMW))}` : '—', '', `Request ${fmt.mw(Number(S.exportMW))} · NR (energy-only)`)}
      ${kpi('Envelope above element', ok(gap) ? `${gap >= 0 ? '+' : '−'}${fmt.mw(Math.abs(gap))}` : 'not held', '', 'Governing case: vendor envelope − element study', !ok(gap))}
      ${load ? kpi('Fault duty at the bus', m && ok(m.sc) ? fmt.int(m.sc) : ctxRec.state === 'loading' ? '…' : 'not held', 'MVA', 'System strength context; no ratio for a load', !(m && ok(m.sc)))
        : kpi('Short-circuit ratio', m && ok(m.scr) ? m.scr.toFixed(1) : ctxRec.state === 'loading' ? '…' : 'not held', '', m && ok(m.sc) ? `${fmt.int(m.sc)} MVA ÷ ${fmt.mw(req)} · indicator` : 'Fault duty ÷ request', !(m && ok(m.scr)))}
      ${kpi(PRE_EXISTING_LABEL, `${preC.envelope == null ? 'not held' : fmt.int(preC.envelope)} · ${preC.element == null ? 'not held' : fmt.int(preC.element)}`, '', `${preExistingText(preC)}: two sources, this technology's cases only`, preC.envelope == null && preC.element == null)}
    </div><!--/gx:kpis-->
    ${studyBasisStrip(sb, stale)}
    <!--gx:cards--><div class="cards">
      ${card('c-6', 'Case matrix', `injection and withdrawal × summer peak / shoulder / large load; highlighted = cases this service uses${focus ? ` · focus: ${focus.replace('_', ' ')}` : ''}`, caseMatrix(data, S, tech, focus), 'Governing = element study where a usable facility list exists (the source of record, D6.1); else the vendor envelope, shown amber as context and never counted as a fit. Hold = a case with no published limit or not studied. Every injection figure is NR (NCIS) energy-only service; CNR (capacity) is at most that figure until a deliverability screen exists.',
        // on its tab the request slider sits in the case-matrix tools, as before; on the Map tab it is with the Grid inputs
        AS_TAB && !load ? `<div class="gx-slider"><span>${sliderK}</span><input type="range" min="10" max="600" step="5" value="${Number(S.exportMW) || 100}" data-act="grid-size" data-live aria-label="Export request MW"><output>${Number(S.exportMW) || 100}</output><span>MW</span></div>` : '',
        { depth: 'screen', trace: 'g-capacity', chips: envOnly ? 'envelope-only' : '', answer: capAnswer })}
      ${card('c-6', 'Margin by case', 'envelope and element limit side by side against the request', margins, 'Bold label = the binding case. Envelope: fact_headroom (vendor-asserted). Element: lowest positive transfer, fact_limiting_element. Service: NR (energy-only) for injection.', '', { depth: 'screen', trace: 'g-capacity', answer: ok(gap) ? `In the governing case the vendor envelope sits ${B(fmt.mw(Math.abs(gap)))} ${gap >= 0 ? 'above' : 'below'} the element study; the element study governs.` : 'The envelope and the element limit are not both held in the governing case, so the gap between them is not held.' })}
      ${card('c-12', 'Governing limit by study case', 'element-study limit where published; envelope only where no facility list exists; service type on every figure',
        dense('<th>Case</th><th>Direction</th><th>Service</th><th class="num">Envelope</th><th class="num">Element limit</th><th class="num">Governing</th><th class="num">Request</th><th class="num">Margin</th><th>Status</th><th>Basis</th>', rows)
        + `<p class="gx-cap lead">${caveats}</p><div class="handoff"><div><strong>Carry these limits into revenue</strong><p>${canSend ? `${load ? capLine(im, 'the load') : `${capLine(ex, 'export')}${isStorage(S.tech) ? ` ${capLine(im, 'charging')}` : ''}`} The case and set are recorded.` : 'Not available: the governing case is on hold or not studied, so there is no limit to send.'}</p></div><button class="primary" data-act="handoff-grid" ${canSend ? '' : 'disabled'}>Use these connection limits in Economics</button></div>`, '', '', { depth: 'review', trace: 'g-capacity', chips: envOnly ? 'envelope-only' : '', answer: `${B(fitsN)} of ${askedN} requested case${askedN === 1 ? '' : 's'} fit at the request on element-study evidence${t.some(r => r.status === ENVELOPE_ONLY) ? `; ${B(t.filter(r => r.status === ENVELOPE_ONLY).length)} rest${t.filter(r => r.status === ENVELOPE_ONLY).length === 1 ? 's' : ''} on the vendor envelope only (context, never a pass)` : ''}${Number(S.exportMW) > 0 && unstudiedCases(tech).length ? '; light-load and minimum-load cases are not studied' : ''}.` })}
      ${card('c-8', 'Size sweep', 'facilities that would need upgrading as the request grows (distinct facilities, all cases of the service)',
        CH.lineChart([{ name: 'Facilities to upgrade', points: sweep.flatMap((r, i) => (i && sweep[i - 1].overloaded !== r.overloaded ? [{ x: r.size, y: sweep[i - 1].overloaded }, { x: r.size, y: r.overloaded }] : [{ x: r.size, y: r.overloaded }])) }], { fmt: v => `${v.toFixed(0)}`, xfmt: v => `${v} MW`, title: 'Facilities to upgrade by size', height: 200 })
        + dense('<th class="num">Size</th><th>Connection</th><th class="num">Margin</th><th class="num">Facilities</th><th class="num">Network cost</th>', sweepTbl),
        'Same engine as the cost tab at every size. Envelope-only cases confirm a size but never prove $0; above them the cost is a lower bound (≥).', '', { depth: 'review', trace: 'g-sweep', answer: lastFit ? `The ${esc(sweepSum.text)}${atReqSweep && ok(atReqSweep.overloaded) ? `; at ${esc(fmt.mw(req))}, ${B(atReqSweep.overloaded)} facilit${atReqSweep.overloaded === 1 ? 'y needs' : 'ies need'} upgrading` : ''}.` : `No swept size fits on element-study evidence in every case: a case rests on the envelope only, is on hold, not studied or binds below 25 MW; exact limit ${esc(ok(sweepSum.exact) ? fmt.mw(sweepSum.exact) : 'not held')}.` })}
      ${sc.html}
      ${wscr.html}
      ${sur.html}
      ${copyNotesCard(data, S, ctxRec, stRec)}
      ${card('c-4', 'Study coverage at a glance', 'what the thermal screen does and does not establish', dense('<th>Area</th><th>Status</th>', [['Thermal N-1 (element study)', 'Held'], ['Substation envelope', 'Held'], ['Short-circuit strength', m && ok(m.sc) ? 'Indicator only' : 'Not held'], ...NOT_ASSESSED.map(x => [x.area, x.status]), ['Affected systems', 'Not assessed']].map(([a, s]) => `<tr><td>${a}</td><td>${pill(s)}</td></tr>`).join('')), 'Reasons and the affected-system tie flag: Constraints &amp; coverage tab.', '', { depth: 'review', answer: `Only the thermal screen is held; ${B(NOT_ASSESSED.length + 1)} study areas are not assessed, so a fit here is not a feasibility result.` })}
      ${traceCard([traceCapacity(data, S, node, t, ex, im), traceSweep(data, S, tech, sweep, req > 0 ? req : null), sc.trace, wscr.trace, sur.trace],
        details(`<p>Element limit = lowest positive transfer MW among facilities not already overloaded before the project, where transfer = (rating − flow) ÷ sensitivity. Governing = element limit where published, else the envelope. Margin = governing − request. The size sweep re-runs the same rules and the cost engine at 25 MW steps.</p>`,
          `<p>Energy-only service uses all held export cases; capacity service is not separately studied here, and can never exceed energy-only. The shoulder export case has an envelope only: its facility rows in the store are the large-load table under a shoulder label, so they are not used.</p>`, evidence(data)))}
    </div><!--/gx:cards-->
    ${nextLink('see which facilities set these limits on the map in <b>Grid › Constraints &amp; coverage</b>', 'grid', 'constraints')}`;
}

// ---------- Network around the bus (v6 map; geoMap over /api/x/gridnet/around/<bus>) ----------
function netMapCard(S, tech, depth = 'screen') {
  const title = 'Network around the bus', sub = 'branches within 15 mi; this bus\'s limiting facilities and pre-existing overloads · click a line or a row to select';
  const rec = gridData('around', S.nodeId, 'gridnet');
  const p = pending(rec, 'the network around the bus');
  if (p) return { html: card('c-8', title, sub, p, '', '', { depth }), trace: '', model: null };
  const m = netMapModel(rec.value, { tech, sel: S.ui.gfac });
  const b = m.bus, r = m.radius || 15, dLat = r / 69, dLon = r / (69 * Math.cos((b.lat * Math.PI) / 180));
  const fit = [[b.lon - dLon, b.lat - dLat], [b.lon + dLon, b.lat + dLat], ...m.fac.flatMap(l => [l.a, l.b])].map(([lon, lat]) => ({ lon, lat }));
  const sel = m.selected;
  const layers = [
    { kind: 'rings', center: [b.lon, b.lat], miles: [5, 10, r] },
    { kind: 'lines', lines: m.net },
    { kind: 'lines', lines: m.fac.filter(l => /gm-pre/.test(l.cls)) },
    { kind: 'lines', lines: m.fac.filter(l => /gm-lim/.test(l.cls) && !/gm-sel/.test(l.cls)) },
    { kind: 'points', points: rec.value.substations.map(s => ({ lon: s.lon, lat: s.lat, r: 2.6, fill: 'var(--ink-4)', tip: substationTip(s) })) }, // data-tip is HTML: DB names escaped
    ...(sel && sel.drawn ? [{ kind: 'lines', lines: m.fac.filter(l => l.key === sel.key) }, { kind: 'points', points: [sel.a, sel.b].map(q => ({ lon: q[0], lat: q[1], r: 4.5, cls: 'gm-sel', fill: 'var(--bad)', tip: `${esc(sel.label)} (selected)` })) }] : []),
    { kind: 'points', points: [{ lon: b.lon, lat: b.lat, r: 6.5, cls: 'gm-sel', fill: 'var(--accent)', label: b.bus_name, tip: busTip(b) }] },
  ];
  const legend = { items: [{ label: `Network (${m.net.length})`, cls: 'gm-net', shape: 'line', fill: '#3a4d6b' }, { label: `Limits this bus (${m.counts.lim})`, shape: 'line', fill: 'var(--bad)' }, { label: `Pre-existing overload (${m.counts.pre})`, shape: 'line', fill: 'var(--warn)' }, { label: 'Substation', fill: 'var(--ink-4)' }, { label: 'This bus', fill: 'var(--accent)' }] };
  const map = geoMap({ id: 'grid-net', width: 820, height: 380, fit: { points: fit, padMi: 2 }, layers, legend, title: `Network within ${r} mi of ${b.bus_name}` });
  const list = m.facilities.slice().sort((x, y) => (y.limiting - x.limiting) || ((x.minTransfer ?? 1e9) - (y.minTransfer ?? 1e9)));
  const twin = list.length ? dense('<th>Facility</th><th class="num">kV</th><th>Class</th><th>Case · rating used</th><th class="num">Loading before</th><th class="num">DFAX</th><th class="num">Transfer</th><th class="num">Miles</th>',
    list.map(f => { const c0 = f.cases[0]; return `<tr class="clickable${sel && sel.key === f.key ? ' gx-hi' : ''}" data-act="ui" data-k="gfac" data-v="${esc(sel && sel.key === f.key ? '' : f.key)}" tabindex="0"><td class="wrap">${esc(f.label)}${f.drawn ? '' : ' <span class="pill">not drawn: no coordinate</span>'}</td><td class="num">${ok(f.kv) ? f.kv : '—'}</td><td>${f.limiting ? '<span class="pill warn">Limits</span>' : '<span class="pill warn">Pre-existing</span>'}</td><td class="wrap">${f.cases.map(c => `${esc(c.caseLabel)} · rate ${c.rate} ${ok(c.rating) ? fmt.int(c.rating) : 'n/h'} MVA`).join('<br>')}</td><td class="num">${ok(c0.pct_loading_no_transfer) ? `${c0.pct_loading_no_transfer.toFixed(1)}%` : 'not held'}</td><td class="num">${n3(c0.dfax)}</td><td class="num">${ok(f.minTransfer) ? fmt.mw(f.minTransfer) : '—'}</td><td class="num">${ok(f.mi) ? f.mi.toFixed(1) : '—'}</td></tr>`; }).join(''))
    : '<div class="notice">No limiting facility is listed for this bus in the cases this service uses.</div>';
  const nd = m.counts.branchNotDrawn;
  const foot = `dim_branch (${m.counts.branches} within ${r} mi) placed from dim_bus latitude/longitude; fact_limiting_element for this bus. Tooltip rating: rate A for a base-case row, rate C for a contingency row. Pre-existing = |loading before the project| ≥ 100%. Not drawn: ${ok(nd) ? nd : 'not held'} branch(es) with an end inside ${r} mi whose other end has no coordinate${m.counts.facNotDrawn ? `, ${m.counts.facNotDrawn} facilit${m.counts.facNotDrawn === 1 ? 'y' : 'ies'} likewise` : ''}; ${m.counts.branchUnplaceable ?? 'not held'} branches ISO-wide have no placed end. Nothing is placed at 0,0.`;
  const ans = netAnswer(m) + (sel ? ` Selected: ${B(sel.label)}${sel.drawn ? '' : ' (not drawn)'}.` : '');
  return { html: card('c-8', title, sub, map + `<details class="more-ctl" ${sel ? 'open' : ''}><summary>Facility table: click a row to highlight its line</summary>${twin}</details>`, foot, sel ? '<button type="button" class="tiny" data-act="ui" data-k="gfac" data-v="">Clear selection</button>' : '', { depth, trace: 'g-netmap', answer: ans }), trace: traceNetMap(S.nodeId, m), model: m };
}

/** The network model's calculation alone (the one view draws the map itself, with the floats on it). */
function netTraceOnly(S, tech) {
  const rec = gridData('around', S.nodeId, 'gridnet');
  if (pending(rec, 'the network around the bus')) return { html: '', trace: '' };
  return { html: '', trace: traceNetMap(S.nodeId, netMapModel(rec.value, { tech, sel: S.ui.gfac })) };
}

// ---------- Tab 2: Constraints & coverage ----------
function tabConstraints(vctx) {
  const { data, S, node } = vctx;
  const tech = techKey(S.tech), cases = applicableCases(tech), all = [...cases.export, ...cases.import];
  const tb = caseTable(data.grid, S.nodeId, tech, Number(S.exportMW), chargeMW(tech, S.exportMW, S.importMW)); // C13
  const bindKey = (binding(tb, 'export').row || binding(tb, 'import').row)?.key;
  // Default filter: the scope strip's focus case where this service uses it (display only), else the binding case.
  const focusKey = vctx.caseScenario ? all.find(k => k.startsWith(`${vctx.caseScenario}|`) && k !== 'shoulder|discharge') : null;
  const key = all.includes(S.ui.gcase) ? S.ui.gcase : focusKey || (all.includes(bindKey) ? bindKey : all[0]);
  const el = elementLimit(data.grid, S.nodeId, key);
  const req = key.endsWith('discharge') ? Number(S.exportMW) : chargeMW(tech, S.exportMW, S.importMW);
  const drawers = [];
  const rows = (el.rows || []).map(r => {
    const lb = loadingBasis(r), pre = el.pre.includes(r), scr = req > 0 ? loadingScreen(r, req) : null, after = scr && ok(scr.loading) ? 100 * scr.loading : null;
    const pfBound = scr && ok(scr.loadingPfBound) ? `${(100 * scr.loadingPfBound).toFixed(1)}%` : null;
    const pfCite = scr?.cite?.find(c => /pf_min_sensitivity/.test(c.path));
    const did = `fac-${S.nodeId}-${key}-${(r.monitored_facility || '').replace(/[^A-Za-z0-9]/g, '')}-${r.binding_contingency}`;
    const pre100 = ok(r.pct_loading_no_transfer) ? r.pct_loading_no_transfer : null;
    drawers.push(`<template data-drawer="${esc(did)}" data-title="${esc(r.monitored_facility?.trim())}"><dl>
      <dt>Contingency</dt><dd>${esc(r.binding_contingency)} (${esc(r.facility_type || 'facility')})</dd>
      <dt>Rating (${lb.rate})</dt><dd>${fmt.int(lb.rating)} MVA · screened on the ${lb.kind} flow ${ok(lb.flow) ? fmt.mw(lb.flow) : 'not held'}</dd>
      <dt>Sensitivity to this project</dt><dd>${ok(r.dfax) ? r.dfax.toFixed(3) : 'not held'} MW per MW</dd>
      <dt>Transfer to 100%</dt><dd>${fmt.mw(r.transfer_mw)}</dd>
      <dt>Upgrade cost</dt><dd>${costOf(r) == null && r.fix_cost_musd === 0 ? 'not held ($0 on a zero-length facility)' : musd(costOf(r))}</dd>
      <dt>Length</dt><dd>${ok(r.length_miles) ? r.length_miles.toFixed(1) + ' mi' : 'not held'}</dd></dl>
      <h3 class="gx-h4">Loading before the project</h3><div class="meter"><i class="${pre100 >= 100 ? 'over' : ''}" style="width:${Math.min(100, Math.abs(pre100 ?? 0))}%"></i></div><span class="audit-note">${ok(pre100) ? pre100.toFixed(1) + '% of rating' : 'not held'}</span>
      <h3 class="gx-h4">Loading at ${fmt.mw(req)}</h3><div class="meter"><i class="${after > 100 ? 'over' : ''}" style="width:${Math.min(100, after ?? 0)}%"></i></div><span class="audit-note">${ok(after) ? after.toFixed(1) + '% of rating' : 'not computed'}</span>
      ${pfBound ? `<p class="audit-note"><span class="pill warn">Sensitivity</span> Apparent-power bound at pf ${esc(String(scr.pf))}: ${esc(pfBound)} of rating. Q is not in the store, so the MW loading above is a bound; this pf case is a labelled sensitivity, never a study result (${esc(pfCite?.src || 'not held')} · ${esc(pfCite?.status || 'missing')}).</p>` : ''}
      <p class="audit-note">Loading at request = |flow + sensitivity × request| ÷ rating (rate ${lb.rate}, ${lb.kind} flow${scr?.ratingBasis ? `; rules file maps it to ${esc(scr.ratingBasis)}, as stored` : ''}). Screen: GAPS §4.4 via rules/isone.js thermalScreen.</p></template>`);
    const fk = parseFacility(r.monitored_facility)?.key || '', on = fk && S.ui.gfac === fk;
    return `<tr class="clickable${on ? ' gx-hi' : ''}" data-act="ui" data-k="gfac" data-v="${esc(on ? '' : fk)}" tabindex="0" title="Select to highlight on the network map"><td class="wrap">${esc(short(r.monitored_facility))} <button type="button" class="tiny" data-open-drawer="${esc(did)}">Details</button></td><td>${esc(r.binding_contingency)}</td><td>${esc(r.facility_type || '—')}</td><td class="num">${ok(r.kv) ? r.kv : '—'}</td><td class="num">${fmt.int(lb.rating)} ${lb.rate}</td><td class="num">${ok(r.pct_loading_no_transfer) ? r.pct_loading_no_transfer.toFixed(1) + '%' : '—'}</td><td class="num">${ok(r.dfax) ? r.dfax.toFixed(3) : '—'}</td><td class="num">${fmt.mw(r.transfer_mw)}${(() => { const tc = transferCheck(r); return tc.differs ? ` <span class="pill warn" title="${esc(`Stored transfer ${fmt.mw(tc.stored)} differs from (rating − flow) ÷ DFAX = ${fmt.mw(tc.recomputed)} by ${tc.diffPct.toFixed(1)}% (more than 5%): the stored figure is used, flagged`)}">stored ≠ recompute ${esc(fmt.mw(tc.recomputed))}</span>` : ''; })()}</td><td class="num">${ok(after) ? after.toFixed(1) + '%' : '—'}</td><td class="num">${musd(costOf(r))}</td><td>${pre ? `<span class="pill warn">${ok(r.dfax) && r.dfax > 0 ? 'Contingent on existing upgrade' : 'Pre-existing'}</span>` : !ok(after) ? '<span class="pill">Not computed</span>' : after > 100 ? '<span class="pill warn">Overloads at request</span>' : '<span class="pill good">Within rating</span>'}</td></tr>`;
  }).join('');
  const over = (el.rows || []).filter(r => !el.pre.includes(r) && ok(r.transfer_mw) && r.transfer_mw > 0 && r.transfer_mw < req).length;
  const msg = { noViolation: 'The study found no facility violations in this case.', unpublished: 'The published rows here are all pre-existing overloads, so the limit for this case is not published. Result: Hold.', mislabel: 'This case has no usable facility list (store rows are mislabelled).', none: 'No facility rows are held for this case.' }[el.status];
  const caseSeg = seg('gcase', all.map(k => [k, CASE_LABEL[k]]), key);
  // Loading bars (before / at request)
  const bars = loadingBars(el, req).sort((a, b) => (b.after ?? b.before ?? -1) - (a.after ?? a.before ?? -1)).slice(0, 10);
  const barsHtml = bars.length ? CH.groupedBar(bars.map(b => ({ label: short(b.facility), values: [b.before, b.after], highlight: b.pre })), { series: ['Before the project', `At ${fmt.mw(req)}`], fmt: v => `${v.toFixed(0)}%`, title: 'Facility loading before and at request', height: 240 }) : `<div class="notice">${esc(msg || 'No facility rows.')}</div>`;
  // DFAX scatter over every case with a facility list
  const allRows = all.filter(k => k !== 'shoulder|discharge').flatMap(k => { const e = elementLimit(data.grid, S.nodeId, k); return e.status === 'held' || e.status === 'unpublished' ? e.rows.map(r => ({ r, k, pre: e.pre.includes(r) })) : []; });
  const pts = allRows.filter(x => !x.pre && ok(x.r.transfer_mw) && x.r.transfer_mw > 0 && ok(x.r.dfax)).map(x => ({ x: x.r.transfer_mw, y: x.r.dfax, label: short(x.r.monitored_facility), group: CASE_LABEL[x.k] }));
  const scat = typeof CH.scatter === 'function' ? CH.scatter(pts, { xLabel: 'Transfer to 100% (MW)', yLabel: 'Sensitivity (DFAX)', fmt: v => v.toFixed(2), xfmt: v => `${Math.round(v)} MW`, title: 'Sensitivity vs transfer limit', height: 220 })
    : scatterSvg(pts, { xLabel: 'Transfer to 100% (MW)', yLabel: 'DFAX', fmt: v => v.toFixed(2), xfmt: v => `${Math.round(v)}`, height: 220, refX: req > 0 ? [{ x: req, label: 'request' }] : [] });
  // Type × voltage and severity over the whole element list of this bus (all cases)
  const busRows = data.grid.constraints.filter(r => String(r.bus_id) === String(S.nodeId) && r.monitored_facility && !/violations/i.test(r.monitored_facility) && !(r.scenario === 'shoulder' && r.direction === 'discharge'));
  const tv = typeVoltageSummary(busRows);
  const sev = severityBins(busRows.map(r => loadingAt(r, 0)));
  const ctxRec = ctxOf(S, 'context'), kRec = ctxOf(S, 'constraints');
  const ctx = ctxRec.state === 'ok' ? ctxRec.value : null, K = kRec.state === 'ok' ? kRec.value : null;
  // PCR binding of this bus's own facilities
  let pcrHtml = pending(ctxRec, 'PCR binding records'), pcrTrace = '';
  if (!pcrHtml) {
    const pr = ctx.pcr, runs = ['pcr2030', 'pcr2035', 'pcr2040'], fk = [...new Set(pr.map(r => r.key))];
    const byF = fk.map(k => { const f = ctx.facilities.find(x => x.key === k); return { label: f ? `${f.a_name} – ${f.b_name}` : k, values: runs.map(run => { const h = pr.filter(r => r.key === k && r.run === run).reduce((a, r) => a + r.hours, 0); return h || null; }) }; });
    pcrHtml = (pr.length ? CH.groupedBar(byF, { series: runs, fmt: v => `${v.toFixed(0)} h`, title: 'Binding hours of this bus\'s facilities in the PCR runs', height: 190 })
      + dense('<th>Run</th><th>Facility</th><th>For loss of</th><th class="num">Hours</th><th class="num">Mean |μ|</th><th class="num">Max |μ|</th>', [...pr].sort((a, b) => a.run.localeCompare(b.run) || b.hours - a.hours).map(r => `<tr><td>${r.run}</td><td class="wrap">${esc(short(r.facility))}</td><td>${esc(r.contingency)}</td><td class="num">${fmt.int(r.hours)}</td><td class="num">$${n2(r.mean_abs_shadow)}</td><td class="num">$${n2(r.max_abs_shadow)}</td></tr>`).join(''))
      : `<div class="notice">None of this bus's ${ctx.facilities.length} limiting facilities binds in any PCR run (${Object.entries(ctx.pcr_run_hours).map(([k, v]) => `${k}: ${fmt.int(v)} h solved`).join(' · ')}). The study limits them at the request; the solved market years do not congest them.</div>`);
    pcrTrace = tracePcr(ctx);
  }
  // Association / exact by period
  const periods = K ? K.periods : [];
  const pkey = periods.some(p => p.key === S.ui.gper) ? S.ui.gper : (periods.find(p => p.key === 'pcr2035' && p.held) || periods.find(p => p.held) || {}).key;
  const P = periods.find(p => p.key === pkey);
  let assocHtml = pending(kRec, 'binding constraints for this bus'), assocTrace = '';
  if (!assocHtml) {
    const pseg = seg('gper', periods.map(p => [p.key, p.key]), pkey);
    if (!P || !P.held) assocHtml = `${pseg}<div class="notice">${esc(P?.reason || 'No period held.')}</div>`;
    else {
      const top = P.rows.slice(0, 8).map(r => ({ label: short(r.name.split(' · ')[0]).slice(0, 26), value: ok(r.contrib) ? r.contrib : r.assoc, note: `${fac(r.name)} · ${r.hours} h${ok(r.contrib) ? ' · exact share' : ' · association'}` }));
      assocHtml = `${pseg}<div class="gx-stats"><div class="gx-stat"><span>Annual mean MCC</span><b>$${n3(P.mcc)}/MWh</b></div><div class="gx-stat"><span>Hours priced</span><b>${fmt.int(P.hours)}</b></div><div class="gx-stat"><span>Constraints that bound</span><b>${fmt.int(P.constraints)}</b></div><div class="gx-stat"><span>Measure</span><b>${P.exact ? 'exact (unit DFAX)' : 'association'}</b></div></div>`
        + CH.barChart(top, { fmt: v => `$${v.toFixed(3)}`, title: `Constraint share of the annual MCC · ${pkey}`, height: 170 })
        + dense('<th>Constraint · contingency</th><th class="num">Hours</th><th class="num">MCC on</th><th class="num">MCC off</th><th class="num">Assoc $/MWh</th><th class="num">DFAX</th><th class="num">Exact $/MWh</th><th class="num">Mean |μ|</th><th>Study link</th>',
          P.rows.map(r => `<tr><td class="wrap">${esc(fac(r.name))}</td><td class="num">${fmt.int(r.hours)}</td><td class="num">${n3(r.mcc_on)}</td><td class="num">${n3(r.mcc_off)}</td><td class="num">${n3(r.assoc)}</td><td class="num">${n3(r.dfax)}</td><td class="num">${n3(r.contrib)}</td><td class="num">${ok(r.mean_abs_shadow) ? `$${r.mean_abs_shadow.toFixed(1)}` : '—'}</td><td>${r.limiting ? `<span class="pill warn">limits this bus: ${esc(r.limiting.map(x => CASE_LABEL[`${x[0]}|${x[1]}`] || x.join(' ')).join(', '))}</span>` : ''}</td></tr>`).join(''));
    }
    assocTrace = traceAssoc(K, P);
  }
  // Flowgates (interfaces) in the PCR runs
  let fgHtml = pending(ctxRec, 'PCR interface records');
  if (!fgHtml) {
    const fg = ctx.flowgates.filter(g => g.binding_hours > 0).sort((a, b) => b.binding_hours - a.binding_hours);
    fgHtml = fg.length ? dense('<th>Run</th><th>Interface / flowgate</th><th class="num">Binding h</th><th class="num">Mean |μ|</th><th class="num">Max |μ|</th><th class="num">Peak use</th>', fg.slice(0, 24).map(g => `<tr class="${g.this_bus ? 'gx-hi' : ''}"><td>${g.run}</td><td class="wrap">${esc(short(g.name))}${g.this_bus ? ' <span class="pill warn">this bus\'s facility</span>' : ''}</td><td class="num">${fmt.int(g.binding_hours)}</td><td class="num">$${n2(g.mean_abs_shadow)}</td><td class="num">$${n2(g.max_abs_shadow)}</td><td class="num">${ok(g.max_util) ? pct(100 * g.max_util) : '—'}</td></tr>`).join('')) : '<div class="notice">No PCR flowgate binds in any run.</div>';
  }
  // Shared limits: how many other connection points each facility limits
  let shHtml = pending(ctxRec, 'the facility index');
  if (!shHtml) {
    const f = ctx.facilities.filter(x => x.shared).sort((a, b) => b.shared.buses - a.shared.buses);
    shHtml = f.length ? dense('<th>Facility</th><th class="num">kV</th><th class="num">Buses it limits</th><th class="num">Lowest limit anywhere</th><th>Located</th>', f.map(x => { const lo = Object.values(x.shared.cases).map(c => c.min_transfer).filter(ok); return `<tr><td class="wrap">${esc(`${x.a_name} – ${x.b_name}${x.ckt !== '1' ? ` ckt ${x.ckt}` : ''}`)}</td><td class="num">${x.kv}</td><td class="num">${fmt.int(x.shared.buses)}</td><td class="num">${lo.length ? fmt.mw(Math.min(...lo)) : '—'}</td><td>${x.located ? `<span class="pill good">${esc(x.line.name)}</span>` : '<span class="pill">not on branch table</span>'}</td></tr>`; }).join('')) : '<div class="notice">No facility rows to index.</div>';
  }
  const coverage = [
    ['Thermal N-1 element study', el.status === 'held' || el.status === 'unpublished' ? 'Held' : 'Not studied', `${(el.rows || []).length} rows for ${CASE_LABEL[key]}; ${SET_LABEL.element}`],
    ['Substation envelope', ok(envelope(data.grid, S.nodeId, key)) ? 'Held' : 'Not held', `fact_headroom: ${SET_LABEL.envelope}`],
    ['Solved runs (PCR 2030/2035/2040)', ctx ? (ctx.pcr.length ? 'Held' : 'Held, no binding') : 'Loading', ctx ? `${new Set(ctx.pcr.map(r => r.key)).size} of ${ctx.facilities.length} facilities bind` : ''],
    ['Settled binding constraints', K ? (K.periods.some(p => p.kind === 'settled' && p.held) ? 'Association only' : 'Not held') : 'Loading', 'fact_constraint_hourly carries no shift factor'],
    ['Short-circuit strength', ok(node?.short_circuit_mva) ? 'Indicator only' : 'Not held', ok(node?.short_circuit_mva) ? `${fmt.int(node.short_circuit_mva)} MVA at the bus; not a breaker-duty study` : ''],
    ...NOT_ASSESSED.map(x => [x.area, x.status, x.why]),
  ];
  // Affected systems: stays Not assessed; the tie-adjacency flag is an indicator beside it.
  const v5Rec = v5Of(S), NEAR_MI = 25;
  let affHtml = pending(v5Rec, 'the tie branches and facility areas'), affTrace = '', aff = null;
  if (!affHtml) {
    const v = v5Rec.value;
    aff = affectedSystemFlag({ busArea: v.bus.pf_area, homeArea: v.home_area, ties: v.ties, facilityEnds: v.facilities }, { nearMi: NEAR_MI });
    const tone = aff.level >= 2 ? 'warn' : aff.level === 1 ? 'warn' : '';
    const tiesNear = v.ties.slice(0, 8);
    affHtml = `<div class="gx-stats"><div class="gx-stat"><span>Tie-adjacency flag</span><b>${esc(aff.flag)}</b></div><div class="gx-stat"><span>Bus area</span><b>${esc(v.bus.pf_area ?? 'not held')} ${esc(v.bus.area_label ? `(${v.bus.area_label})` : '')}</b></div><div class="gx-stat"><span>Nearest tie</span><b>${aff.nearest ? `${n1(aff.nearest.mi)} mi · ${esc(aff.nearest.label)}` : 'not held'}</b></div><div class="gx-stat"><span>Facilities leaving ISO-NE</span><b>${aff.external.length} of ${v.facilities.length}</b></div></div>
      <p><span class="pill ${tone}">${esc(aff.flag)}</span> ${esc(aff.reasons.join('; '))}.</p>`
      + dense('<th>Tie branch</th><th>Neighbour</th><th class="num">kV</th><th class="num">Miles</th>', tiesNear.map(x => `<tr class="${ok(x.mi) && x.mi <= NEAR_MI ? 'gx-hi' : ''}"><td class="wrap">${esc(x.name)}</td><td>${esc(x.label)}</td><td class="num">${n1(x.kv)}</td><td class="num">${n1(x.mi)}</td></tr>`).join(''));
    affTrace = traceAffected(v, aff, NEAR_MI);
  }
  coverage.push(['Affected systems', 'Not assessed', `No neighbouring-system study or model is held. Tie-adjacency indicator: ${aff ? aff.flag : 'loading'}.`]);
  const net = AS_TAB ? netMapCard(S, tech, 'screen') : netTraceOnly(S, tech); // its tab draws the network card, as before; the Map tab draws the map
  const olHtml = pending(ctxRec, 'the connection-point elements') || oneLine(ctx, new Set(ctx.facilities.map(f => f.key)), { height: 320 })
    + dense('<th>Element</th><th>Between</th><th class="num">kV</th><th class="num">Rate A</th><th class="num">Rate B</th><th>Status</th>', [...ctx.elements.branches.map(b => `<tr><td>Line</td><td class="wrap">${esc(b.from_name)} ${b.from} – ${esc(b.to_name)} ${b.to}</td><td class="num">${b.kv}</td><td class="num">${ok(b.rate_a) ? b.rate_a : 'not held'}</td><td class="num">${ok(b.rate_b) ? b.rate_b : 'not held'}</td><td>${esc(b.status)}</td></tr>`), ...ctx.elements.transformers.map(x => `<tr><td>Transformer</td><td class="wrap">${esc(x.fname)} ${x.f} – ${esc(x.tname)} ${x.t}</td><td class="num">${esc(String(x.kv).trim())}</td><td class="num">${ok(x.rate_a) ? x.rate_a : 'not held'}</td><td class="num">${ok(x.rate_b) ? x.rate_b : 'not held'}</td><td>${esc(x.status)}</td></tr>`), ...ctx.elements.generators.map(g => `<tr><td>Generator</td><td class="wrap">${esc(g.gen_name)}</td><td class="num">—</td><td class="num">${ok(g.max_capacity_mw) ? `${g.max_capacity_mw} MW` : 'not held'}</td><td class="num">—</td><td>${esc(g.status)}</td></tr>`), ...ctx.elements.loads.map(l => `<tr><td>Load</td><td class="wrap">${esc(l.load_name)}</td><td class="num">—</td><td class="num">${ok(l.load_mw) ? `${l.load_mw} MW` : 'not held'}</td><td class="num">—</td><td>${esc(l.zone || '')}</td></tr>`)].join(''));
  const pcrN = ctx ? new Set(ctx.pcr.map(r => r.key)).size : null, pcrH = ctx ? Math.max(0, ...ctx.pcr.map(r => r.hours)) : null;
  return `${drawers.join('')}
    <!--gx:kpis--><div class="kpis">
      ${kpi('Lowest facility limit', el.status === 'held' ? fmt.mw(el.limit) : '—', '', el.facility ? short(el.facility) : msg || '', el.status !== 'held')}
      ${kpi('Facilities overloaded at request', req > 0 && el.status === 'held' ? fmt.int(over) : '—', '', `Of ${fmt.int((el.rows || []).length - (el.pre || []).length)} not already overloaded`)}
      ${(() => { const heldEl = ['held', 'unpublished', 'noViolation'].includes(el.status); return kpi(PRE_EXISTING_LABEL, heldEl ? fmt.int(el.pre.length) : 'not held', '', heldEl ? `element list, ${CASE_LABEL[key]}: excluded from the project’s own limit and cost` : `no element list for ${CASE_LABEL[key]}`, !heldEl); })()}
      ${kpi('Facilities in the whole list', fmt.int(new Set(busRows.map(r => facilityKey(r.monitored_facility, r.facility_type))).size), '', `${busRows.length} rows across the studied cases; reversed ends and 3-winding legs counted once`)}
      ${kpi('Own facilities binding in PCR', ctx ? `${pcrN} of ${ctx.facilities.length}` : '…', '', ctx ? (pcrN ? `up to ${fmt.int(pcrH)} h in a run` : 'none binds in 2030/2035/2040') : 'loading')}
      ${kpi('Leading constraint', P?.held && P.rows[0] ? `$${n3(ok(P.rows[0].contrib) ? P.rows[0].contrib : P.rows[0].assoc)}` : K ? 'not held' : '…', '/MWh', P?.held && P.rows[0] ? `${pkey}: ${short(P.rows[0].name.split(' · ')[0])}` : '', !(P?.held && P.rows[0]))}
    </div><!--/gx:kpis-->
    <!--gx:cards--><div class="cards">
      ${net.html}
      ${card('c-4', 'Facility loading', `before the project and at the request, ten most loaded · ${CASE_LABEL[key]}`, barsHtml, 'Magnitude of loading; counter-flow shows positive. Bold label = pre-existing overload.', caseSeg, { depth: 'screen', trace: 'g-constraints', answer: bars.length ? `Most loaded ${req > 0 ? `at ${B(fmt.mw(req))}` : 'before the project'}: ${B(short(bars[0].facility))} at ${B(pct(bars[0].after ?? bars[0].before))}${bars.filter(b => ok(b.after) && b.after > 100).length ? `; ${B(bars.filter(b => ok(b.after) && b.after > 100).length)} of these exceed 100%` : ''}.` : esc(msg || 'No facility rows are held for this case.') })}
      ${card('c-8', 'Limiting facilities', `loading at request = |flow + sensitivity × ${fmt.mw(req)}| ÷ rating · click a row to highlight it on the map; Details opens the record`,
        (msg ? `<div class="notice">${esc(msg)}</div>` : '') + (rows ? dense('<th>Facility</th><th>Contingency</th><th>Type</th><th class="num">kV</th><th class="num">Rating MVA</th><th class="num">Loading before</th><th class="num">DFAX</th><th class="num">Transfer</th><th class="num">At request</th><th class="num">Cost</th><th>Status</th>', rows) : ''),
        'fact_limiting_element · base-case rows on rate A with base flow, contingency rows on rate C · $0 on a zero-length facility is not held', '', { depth: 'study', trace: 'g-constraints', answer: el.status === 'held' ? `The lowest limit in ${esc(CASE_LABEL[key])} is ${B(fmt.mw(el.limit))} on ${B(short(el.facility))}; ${B(req > 0 ? over : '—')} of ${fmt.int((el.rows || []).length - (el.pre || []).length)} facilities overload at ${esc(fmt.mw(req))}, and ${B(el.pre.length)} are pre-existing.` : esc(msg || 'No facility rows are held for this case.') })}
      ${card('c-4', 'Study coverage matrix', 'thermal screening alone does not establish that a connection is feasible', dense('<th>Study area</th><th>Status</th><th>Note</th>', coverage.map(([a, s, n]) => `<tr><td class="wrap">${a}</td><td>${pill(s)}</td><td class="wrap">${esc(n)}</td></tr>`).join('')), '', '', { depth: 'review', answer: `${B(coverage.filter(c => /^Held/.test(c[1])).length)} of ${coverage.length} study areas are held; ${B(coverage.filter(c => /Not assessed|Not studied|Not held/.test(c[1])).length)} are not assessed or not held, so this is a screen, not a feasibility result.` })}
      ${card('c-6', 'Sensitivity (DFAX) vs transfer limit', 'every facility not already overloaded, all cases of this service', scat, 'Low limit + high DFAX = the facility this project loads hardest. Shoulder export rows are excluded (store mislabel).', '', { depth: 'study', answer: pts.length ? (() => { const h = pts.reduce((a, b2) => (b2.y > a.y ? b2 : a)); return `${B(pts.length)} facility rows; the project loads ${B(h.label)} hardest (DFAX ${B(h.y.toFixed(3))}, limit ${esc(fmt.mw(h.x))}).`; })() : 'No facility outside the pre-existing set has a positive transfer limit and a DFAX here.' })}
      ${card('c-6', 'Affected systems: tie adjacency', 'indicator from the tie branches and the areas of this bus\'s limiting facilities; the study area stays Not assessed', affHtml, `dim_branch.from_area / to_area (${v5Rec.value ? v5Rec.value.ties.length : '…'} tie branches), dim_bus.pf_area. ${esc(v5Rec.value?.notes?.pf_ba || '')} Adjacency radius ${NEAR_MI} mi is an assumption. Order 2023 sets a 150-day affected-system study; none is held here.`, '', { depth: 'review', trace: 'g-affected', chips: 'assumption', answer: aff ? `Tie-adjacency indicator: ${B(aff.flag)}${aff.nearest ? `; the nearest tie is ${B(`${n1(aff.nearest.mi)} mi`)} away (${esc(aff.nearest.label)})` : ''}. The affected-system study itself is not assessed.` : '' })}
      ${card('c-6', 'Facility type and voltage', 'the whole element list of this bus, all studied cases', dense('<th>Type</th><th class="num">kV</th><th class="num">Rows</th><th class="num">Pre-existing</th><th class="num">Lowest limit</th><th class="num">Priced</th><th class="num">Cost of priced</th>', tv.map(x => `<tr><td>${esc(x.type)}</td><td class="num">${x.kv ?? 'not held'}</td><td class="num">${x.n}</td><td class="num">${x.pre}</td><td class="num">${fmt.mw(x.minTransfer)}</td><td class="num">${x.priced}</td><td class="num">${musd(x.costTotal)}</td></tr>`).join('')) + CH.barChart(sev.map(b => ({ label: b.label, value: b.n })), { fmt: v => `${v.toFixed(0)} rows`, title: 'Loading severity before the project', height: 150 }), `Severity = |flow| ÷ rating on each row's basis, before the project${sev.notHeld ? ` · ${sev.notHeld} row(s) without flow or rating not counted` : ''}.`, '', { depth: 'review', answer: `${B(busRows.length)} facility rows in ${B(tv.length)} type and voltage groups; ${B(tv.reduce((a, x) => a + x.pre, 0))} rows are pre-existing overloads.` })}
      ${card('c-6', 'How often this bus\'s facilities bind (PCR runs)', 'binding hours and shadow prices of the same branches in the solved market years', pcrHtml, 'fact_pcr_binding_hourly matched on bus numbers + circuit. Shadow price μ = $/MWh value of one more MW on the facility.', '', { depth: 'review', trace: 'g-pcr', chips: 'modelled', answer: ctx ? (pcrN ? `${B(`${pcrN} of ${ctx.facilities.length}`)} of this bus's facilities bind in a solved run, for up to ${B(`${fmt.int(pcrH)} h`)} in one run.` : `None of this bus's ${B(ctx.facilities.length)} facilities binds in the 2030, 2035 or 2040 runs.`) : '' })}
      ${card('c-6', 'Shared limits', 'how many connection points each of this bus\'s facilities also limits', shHtml, 'Count of distinct buses whose element study lists the facility (any case). A widely shared limit is contested headroom.', '', { depth: 'study', answer: ctx ? (() => { const f = ctx.facilities.filter(x => x.shared).sort((a, b) => b.shared.buses - a.shared.buses)[0]; return f ? `The most shared facility, ${B(`${f.a_name} – ${f.b_name}`)}, limits ${B(fmt.int(f.shared.buses))} connection points.` : 'No facility rows to index.'; })() : '' })}
      ${card('c-12', 'Binding constraints at this bus by period', 'settled DA/RT and the PCR runs: the bus\'s own congestion component when each constraint binds', assocHtml, `${esc(K?.rules?.association || '')} ${esc(K?.not_held?.join(' ') || '')}`, '', { depth: 'review', trace: 'g-assoc', chips: K?.settled_series?.price_tier === 'geo_proxy' ? 'geo-proxy modelled' : 'modelled', answer: K ? (P?.held && P.rows[0] ? `In ${esc(pkey)}, ${B(short(P.rows[0].name.split(' · ')[0]))} moves this bus's congestion component most: ${B(`$${n3(ok(P.rows[0].contrib) ? P.rows[0].contrib : P.rows[0].assoc)}/MWh`)} of an annual mean MCC of $${n3(P.mcc)}/MWh.` : `No binding constraint is held for ${esc(pkey || 'any period')}.`) : '' })}
      ${card('c-4', 'PCR interfaces', 'flowgates that bind in the solved runs (context; highlighted = one of this bus\'s facilities)', fgHtml, 'fact_pcr_flowgate_hourly · peak use = max |flow| ÷ limit.', '', { depth: 'study', chips: 'modelled', answer: ctx ? `${B(ctx.flowgates.filter(g => g.binding_hours > 0).length)} interface-run pairs bind; ${B(ctx.flowgates.filter(g => g.binding_hours > 0 && g.this_bus).length)} are this bus's own facilities.` : '' })}
      ${card('c-8', 'Connection point', 'feeders, transformers, generators and loads at the station', olHtml, 'dim_branch, dim_transformer, dim_generator, dim_load; a 0 MVA rating in the source is shown as not held.', '', { depth: 'study', answer: ctx ? `The station has ${B(ctx.elements.branches.length)} lines, ${B(ctx.elements.transformers.length)} transformers, ${B(ctx.elements.generators.length)} generators and ${B(ctx.elements.loads.length)} loads in the model.` : '' })}
      ${traceCard([net.trace, traceConstraints(data, S, key, el, req), pcrTrace, assocTrace, affTrace], details('<p>Loading at request = |flow + sensitivity × request| ÷ rating × 100 on the row\'s basis. Association = (MCC in binding hours − MCC otherwise) × hours ÷ year hours.</p>', '<p>Pre-existing overloads with positive project sensitivity are shown as contingent on an existing upgrade, not hidden. PCR binding is matched by branch (both bus numbers + circuit), never by name.</p>', evidence(data)))}
    </div><!--/gx:cards-->
    ${nextLink(`price the facilities that overload in <b>Grid › ${tech === 'datacenter' ? 'Load upgrade cost allocator' : 'Upgrade cost allocator'}</b>`, 'grid', 'cost')}`;
}

// ---------- Tab 3: Upgrade cost allocator ----------
function costDirection(S) { return S.tech === 'datacenter' ? 'import' : 'export'; }
function costSize(S) { return costDirection(S) === 'export' ? Number(S.exportMW) : Number(S.importMW); }
/** One display rule for an upgrade-cost result (gridrules.costDisplay): a bound with nothing priced is "not held", never "≥ $0". */
const costLabel = c => costDisplay(c, musd);
const CASE_KEY_OF = Object.fromEntries(Object.entries(CASE_LABEL).map(([k, l]) => [l, k]));
/** Proportional-impact allocation over the user-defined cluster (Order 2023 §3; vault summary line 58). */
function propModel(S, step, size, clRec) {
  const cl = clRec.state === 'ok' ? clRec.value : null;
  const parsed = parseCluster(S.ui.gCluster, S.nodeId);
  const members = [{ bus: String(S.nodeId), mw: size, self: true }, ...parsed.members];
  const dx = (fkey, ck, bus) => cl?.facilities?.[fkey]?.[ck]?.[bus]?.dfax;
  const facilities = step.items.map(i => {
    const fkey = parseFacility(i.label)?.key, ck = CASE_KEY_OF[i.case];
    const d = {};
    for (const m of members) { const v = fkey ? dx(fkey, ck, m.bus) : null; d[m.bus] = ok(v) ? v : m.self && ok(i.dfax) ? i.dfax : null; }
    return { id: i.id, label: i.label, cost: i.cost, dfax: d };
  });
  return { cl, parsed, members, p: proportionalImpact(facilities, members) };
}
function propCard(S, step, size, clRec, model) {
  const title = 'Proportional-impact allocation', sub = 'Order 2023 method over a cluster you define: DFAX-weighted MW share per facility';
  const p0 = pending(clRec, 'the other buses on these facilities');
  if (p0) return card('c-6', title, sub, p0, '', '', { depth: 'review' });
  const { cl, parsed, members, p } = model;
  const inCluster = new Set(members.map(m => m.bus));
  const station = new Set((v5Of(S).value?.station || []).map(String));
  const addTo = b => [S.ui.gCluster, `${b}:${size}`].filter(x => x && String(x).trim()).join(', ');
  const cand = (cl?.candidates || []).filter(c => !inCluster.has(c.bus)).slice(0, 8);
  const input = `<label class="field">Cluster members (bus:MW, comma-separated) <span class="pill warn">Your input</span><input type="text" data-act="ui-text" data-k="gCluster" value="${esc(S.ui.gCluster || '')}" placeholder="e.g. 111209:80, 111408:50" aria-label="Cluster members as bus:MW"></label>`
    + (parsed.errors.length ? `<div class="notice warn">${parsed.errors.map(esc).join('; ')}</div>` : '');
  const candTbl = cand.length ? dense('<th>Bus sharing these facilities</th><th class="num">Shared</th><th class="num">Miles</th><th></th>', cand.map(c => `<tr><td class="wrap">${esc(c.name || '')} ${c.bus}${station.has(c.bus) ? ' <span class="pill warn">same station</span>' : ''}</td><td class="num">${c.shared}</td><td class="num">${n1(c.mi)}</td><td><button type="button" class="tiny" data-act="ui" data-k="gCluster" data-v="${esc(addTo(c.bus))}">Add at ${fmt.mw(size)}</button></td></tr>`).join('')) : '';
  if (!step.items.length) return card('c-6', title, sub, `${more(input)}<div class="notice">No facility overloads below ${fmt.mw(size)} in the element cases (${esc(step.status)}), so there is nothing to allocate.</div>`, '', '', { depth: 'review', trace: 'g-prop', answer: `Nothing to allocate: no facility overloads below ${B(fmt.mw(size))}.` });
  const fRows = p.facilities.map(f => `<tr><td class="wrap">${esc(short(f.label))}</td><td class="num">${musd(f.cost)}</td><td class="num">${f.members.map(m => `${m.self ? 'P' : m.bus} ${n3(m.dfax)}`).join(' · ')}</td><td class="num">${f.share == null ? 'not held' : `${f.bound === 'upper' ? '≤ ' : ''}${(100 * f.share).toFixed(1)}%`}</td><td class="num">${f.allocation == null ? (f.cost == null ? 'unpriced' : 'not held') : `${f.bound === 'upper' ? '≤ ' : ''}${musd(f.allocation)}`}</td></tr>`).join('');
  const chart = CH.barChart(p.facilities.map(f => ({ label: short(f.label).slice(0, 22), value: f.share == null ? null : 100 * f.share, note: `${f.members.length} member(s)${f.missing ? ` · ${f.missing} DFAX not held (≤)` : ''}` })), { fmt: v => `${v.toFixed(0)}%`, title: 'Project share of each facility', height: 150 });
  const canApply = p.facilities.some(f => f.share != null);
  // S3 #5: ISO-NE's own method (PP5-6 §10.4.4, rules/isone.js allocateProportional) leads; the per-facility Order 2023 view is the comparison.
  const pp = p.pp56, ppOk = pp?.status === 'ok', thrTxt = ok(pp?.threshold) ? `${(100 * pp.threshold).toFixed(0)}%` : 'not held';
  const ppVal = ppOk ? (pp.cost == null ? `${(100 * pp.share).toFixed(1)}% · $ not held` : musd(pp.cost)) : pp?.status === 'not_applicable' ? 'nothing allocated' : 'not held';
  const kpis = `<div class="gx-stats"><div class="gx-stat"><span>ISO-NE PP5-6 share</span><b>${ppVal}</b>${ppOk ? `<span class="audit-note">${(100 * pp.share).toFixed(1)}% of ${musd(pp.standaloneTotal)} · DFAX &gt; ${esc(thrTxt)} · ${esc(pp.cite?.status || '')}</span>` : pp?.reason ? `<span class="audit-note">${esc(pp.reason)}</span>` : ''}</div><div class="gx-stat"><span>Per-facility (Order 2023 view)</span><b>${p.projectTotal == null ? 'not held' : `${p.status === 'Upper bound' ? '≤ ' : ''}${musd(p.projectTotal)}`}</b></div><div class="gx-stat"><span>Standalone (100%)</span><b>${musd(p.standaloneTotal)}</b></div><div class="gx-stat"><span>Members</span><b>${members.length - 1} + project</b></div><div class="gx-stat"><span>Status</span><b>${esc(p.status)}</b></div></div>`;
  const ppAns = ppOk ? `ISO-NE's method (PP5-6 §10.4.4, DFAX above ${esc(thrTxt)}) gives the project ${B(`${(100 * pp.share).toFixed(1)}%`)} of the cluster's priced upgrades${pp.cost == null ? '' : ` = ${B(musd(pp.cost))}`}` : pp?.status === 'not_applicable' ? `ISO-NE's method (PP5-6 §10.4.4) allocates nothing: ${esc(pp.reason)}` : `ISO-NE's method (PP5-6 §10.4.4) is not held${pp?.reason ? ` (${esc(pp.reason)})` : ''}`;
  return card('c-6', title, sub, kpis + more(input + candTbl) + chart + dense('<th>Facility</th><th class="num">Cost</th><th class="num">DFAX by member</th><th class="num">Project share</th><th class="num">Project $</th>', fRows)
    + `<div class="handoff"><div><strong>Use these shares in the allocator</strong><p>Sets each facility's share % in the editable allocator to the per-facility proportional share. Illustrative: the ISO-NE study issues the real allocation.</p></div><button class="primary" data-act="ui" data-k="gApplyProp" data-v="${esc(S.ui.allocKey)}" ${canApply ? '' : 'disabled'}>Apply proportional shares</button></div>`,
    `${esc(pp?.cite?.src || 'PP5-6 Rev 15 §10.4.4')} · ${esc(pp?.cite?.status || 'not held')}${pp?.cite?.effective ? ` · effective ${esc(pp.cite.effective)}` : ''}: impact = MW × max(DFAX NR, CNR) where DFAX &gt; ${esc(thrTxt)}, summed over elements (the store holds one DFAX per bus and facility). Per-facility rows: vault ferc-order-2023-summary.md line 58 (pro forma view). ${esc(cl?.rule || '')} Counter-flow pays nothing (expert judgement). Member MW default to your request size when added from the list: an assumption to edit.`, '', { depth: 'review', trace: 'g-prop', chips: 'assumption', answer: `${ppAns}; per facility (Order 2023 view) ${p.projectTotal == null ? `not held (${esc(p.status)})` : B(`${p.status === 'Upper bound' ? '≤ ' : ''}${musd(p.projectTotal)}`)} against ${B(musd(p.standaloneTotal))} standalone with ${B(members.length - 1)} other member${members.length === 2 ? '' : 's'}.` });
}
/** Order 1920 context: approved upgrades ISO-wide and the ≥200 kV / ≥$30M screen on this bus's limiting facilities. */
function order1920Card(S, v5Rec) {
  const title = 'Order 1920 context', sub = 'long-term regional planning: approved upgrades and the interconnection-need size screen';
  const p = pending(v5Rec, 'the approved upgrade lists');
  if (p) return { html: card('c-6', title, sub, p, '', '', { depth: 'review' }), trace: '' };
  const v = v5Rec.value, ups = v.upgrades;
  const rows = v.facilities.map(f => ({ label: short(f.facility), kv: f.kv, cost: f.cost }));
  const s = { ...order1920Screen(rows), checkedRows: rows };
  const years = [...new Set(ups.map(u => u.year).filter(ok))].sort();
  const chart = CH.groupedBar(years.map(y => ({ label: String(y), values: ['Transmission', 'Substation'].map(k => ups.filter(u => u.year === y && u.kind === k).length || null) })), { series: ['Transmission', 'Substation'], fmt: x => `${x.toFixed(0)}`, title: 'Approved upgrades ISO-wide by in-service year', height: 150 });
  const hv = ups.filter(u => ok(u.kv) && u.kv >= 200).length;
  const crit = dense('<th>Order 1920 §3 criterion</th><th>Status</th><th>Here</th>', s.criteria.map(c => `<tr><td class="wrap">${esc(c.text)}</td><td>${pill(c.status === 'Screened' ? 'Held' : 'Not held')}</td><td class="wrap">${esc(c.why)}</td></tr>`).join(''));
  const fac = rows.filter(r => ok(r.kv) && r.kv >= 200);
  const facTbl = fac.length ? dense('<th>Facility ≥ 200 kV</th><th class="num">kV</th><th class="num">Study cost</th><th>≥ $30M</th>', fac.map(r => `<tr><td class="wrap">${esc(r.label)}</td><td class="num">${n1(r.kv)}</td><td class="num">${musd(r.cost)}</td><td>${ok(r.cost) ? (r.cost >= 30 ? '<span class="pill warn">yes</span>' : 'no') : 'not held'}</td></tr>`).join('')) : `<div class="notice">None of this bus's ${rows.length} limiting facilities is at 200 kV or above, so none meets the size criterion.</div>`;
  return { html: card('c-6', title, sub, `<div class="gx-stats"><div class="gx-stat"><span>Approved upgrades</span><b>${ups.length}</b></div><div class="gx-stat"><span>At ≥ 200 kV</span><b>${hv}</b></div><div class="gx-stat"><span>Facilities meeting size screen</span><b>${s.meets.length} of ${rows.length}</b></div></div>${chart}${crit}${facTbl}`,
    'Vault: ferc-order-1920-summary.md §2 (20-year horizon, right-sizing ≥ 200 kV) and §3 (interconnection-related needs: two queue cycles in 5 years, ≥ 200 kV and ≥ $30M, unbuilt after withdrawal, not in an IA). dim_transmission_upgrade / dim_substation_upgrade publish no cost. Context: no planned upgrade is netted into any limit.', '', { depth: 'review', trace: 'g-1920', chips: 'not-held', answer: `${B(`${s.meets.length} of ${rows.length}`)} of this bus's limiting facilities meet the ≥ 200 kV and ≥ $30M screen; ${B(ups.length)} approved upgrades are listed ISO-wide.` }), trace: trace1920(S.nodeId, s, ups) };
}

function tabCost(vctx) {
  const { data, S } = vctx;
  const dir = costDirection(S), size = costSize(S), tech = techKey(S.tech);
  const step = stepCostService(data.grid, S.nodeId, tech, Number(S.exportMW), Number(S.importMW));
  S.ui.allocKey = `${S.nodeId}|${tech}|${dir}|${size}`;
  const edits = (S.ui.alloc ||= {})[S.ui.allocKey] ||= {};
  const clRec = gridData('cluster', S.nodeId, 'gridext'), model = propModel(S, step, size, clRec);
  if (S.ui.gApplyProp) { // one-shot: the Apply button writes the proportional shares into the editable allocator
    if (S.ui.gApplyProp === S.ui.allocKey) for (const f of model.p.facilities) if (f.share != null) (edits[f.id] ||= {}).share = Math.round(10000 * f.share) / 100;
    delete S.ui.gApplyProp;
  }
  const gapRows = step.gaps.map(g => ({ id: `gap|${g.key}`, label: `Network upgrades for ${g.label}`, category: 'Network upgrade', cost: null, share: 100, source: `${g.reason}${ok(g.envelope) ? ` · envelope ${fmt.mw(g.envelope)} is below the request` : ''}` }));
  const scope = [
    ...step.items.map(i => ({ id: i.id, label: i.label, category: 'Network upgrade', cost: i.cost, share: 100, source: `Study facility cost · ${i.case} · overloads at ${fmt.mw(i.transfer)}` })),
    ...gapRows,
    { id: 'direct', label: 'Direct connection facilities (POI bay, gen-tie)', category: 'Direct facility', cost: null, share: 100, source: 'Enter from a vendor quote or study' },
    { id: 'affected', label: 'Affected-system upgrades', category: 'Affected system', cost: null, share: 100, source: 'Not in the store' },
  ].map(r => ({ ...r, ...(edits[r.id] || {}) }));
  const res = allocateCosts(scope);
  const known = res.rows.filter(r => r.allocation != null).reduce((t, r) => t + r.allocation, 0);
  const networkUnpriced = res.rows.filter(r => r.category === 'Network upgrade' && r.allocation == null).length;
  S.ui.allocSummary = { tech, dir, size, known, knownNetwork: res.rows.filter(r => r.category === 'Network upgrade' && r.allocation != null).reduce((t, r) => t + r.allocation, 0), unpriced: res.unpriced, networkUnpriced, unverified: (step.unverified || []).length, status: step.status, edited: Object.keys(edits).length > 0 };
  const rows = res.rows.map(r => `<tr><td class="wrap">${esc(short(r.label))}</td><td>${esc(r.category)}</td>
      <td class="num"><input class="cost-input" type="number" min="0" step="0.01" aria-label="Cost $M for ${esc(r.label)}" data-act="alloc" data-id="${esc(r.id)}" data-f="cost" value="${r.cost ?? ''}" placeholder="not held"></td>
      <td class="num"><input class="cost-input sm" type="number" min="0" max="100" step="1" aria-label="Project share % for ${esc(r.label)}" data-act="alloc" data-id="${esc(r.id)}" data-f="share" value="${r.share}"></td>
      <td class="num">${r.allocation != null ? musd(r.allocation) : 'unpriced'}</td><td class="wrap">${esc(r.source)}</td></tr>`).join('');
  // Settled rule: "No upgrades indicated" (envelope-only) never shows $0; nothing requested shows a dash.
  // "≥ $0.0M" finding: a bound with nothing priced reads "not held", never a $0 figure.
  const bounded = networkUnpriced || step.status === 'Lower bound';
  const subtotal = step.status === 'Not requested' ? '—' : step.status === 'No upgrades indicated' && !(known > 0) ? 'none indicated' : bounded ? (known > 0 ? `≥ ${musd(known)}` : 'not held: nothing priced') : musd(known);
  const completeCost = ['Priced', 'True zero'].includes(step.status) && !networkUnpriced;
  // Cost to unlock (step chart)
  const u = unlockSteps(data.grid, S.nodeId, tech, { importMW: Number(S.importMW) }), complete = s => ['Priced', 'True zero'].includes(s), unver = s => s === 'No upgrades indicated';
  // C10: three series: complete, unverified (envelope only, no facility list), lower bound.
  const xs = [], full = [], lower = [], unv = [];
  const push = (x, y, st) => { xs.push(x); full.push({ x, y: complete(st) ? y : null }); unv.push({ x, y: unver(st) ? y : null }); lower.push({ x, y: complete(st) || unver(st) ? null : y }); };
  let prev = u.start, prevCum = ok(u.start.total) ? u.start.total : 0;
  push(0, prevCum, prev.status);
  for (const s of u.steps) { push(s.mw, prevCum, prev.status); push(s.mw, s.cum, s.status); prev = s; prevCum = s.cum; }
  if (u.steps.length) push(Math.round(Math.max(u.steps.at(-1).mw * 1.1, size || 0)), prevCum, prev.status);
  // Bridge: a status change point belongs to both series so the line is continuous.
  for (let i = 1; i < full.length; i++) {
    const prevY = full[i - 1].y ?? unv[i - 1].y ?? lower[i - 1].y;
    if (prevY == null) continue;
    if (lower[i].y != null && lower[i - 1].y == null) lower[i - 1] = { x: xs[i - 1], y: prevY };
    if (unv[i].y != null && unv[i - 1].y == null) unv[i - 1] = { x: xs[i - 1], y: prevY };
  }
  const unlockChart = u.steps.length ? CH.lineChart([{ name: 'Complete total', points: full }, { name: 'Unverified (envelope only)', points: unv, dashed: true, color: 'var(--ink-3)' }, { name: 'Lower bound (≥)', points: lower, dashed: true, color: 'var(--warn)' }], { fmt: v => `$${v.toFixed(1)}M`, xfmt: v => `${Math.round(v)} MW`, title: 'Cost to unlock (cumulative)', height: 220 })
    : `<div class="notice">No facility limit is held in the cases this service uses, so there is no cost step to draw. ${esc(u.start.status)}.</div>`;
  const nextStep = u.steps.find(s => s.mw >= size);
  const sweep = sizeSweep(data.grid, S.nodeId, tech, [...new Set([50, 100, 150, 200, 250, 300, 400, 500, size].filter(v => ok(v) && v > 0))].sort((a, b) => a - b), { importMW: Number(S.importMW) });
  const perKwChart = CH.barChart(sweep.map(r => ({ label: `${r.size}`, value: r.perKw, note: `${r.cost.status}${ok(r.cost.total) ? ` · ${costLabel(r.cost)}` : ''}` })), { fmt: v => `$${v.toFixed(0)}/kW`, title: 'Network cost per kW by size', height: 180, emptyText: 'No size has a complete (priced or proven-zero) total here; see the table.' });
  const itemsChart = step.items.length ? CH.barChart(step.items.map(i => ({ label: short(i.label).slice(0, 24), value: i.cost, note: `${fac(i.label)} · ${i.case} · limit ${fmt.mw(i.transfer)}` })), { fmt: v => `$${v.toFixed(2)}M`, title: 'Network cost by facility at request', height: 180 }) : `<div class="notice">${esc(step.status === 'Not requested' ? 'Nothing requested in this direction.' : `No facility overloads below ${fmt.mw(size)} in the element cases (${step.status}).`)}</div>`;
  const ctxRec = ctxOf(S, 'context'), stRec = studyOnly(vctx, S, 'studio'), v5Rec = v5Of(S);
  const o1920 = order1920Card(S, v5Rec);
  let upHtml = pending(ctxRec, 'planned upgrades'), nearTrace = '';
  if (!upHtml) {
    const up = ctxRec.value.upgrades, years = [...new Set(up.map(x => x.year).filter(ok))].sort();
    upHtml = up.length ? CH.groupedBar(years.map(y => ({ label: String(y), values: ['Transmission', 'Substation'].map(k => up.filter(x => x.year === y && x.kind === k).length || null) })), { series: ['Transmission', 'Substation'], fmt: v => `${v.toFixed(0)}`, title: 'Planned upgrades by in-service year', height: 170 })
      + dense('<th>Kind</th><th>Upgrade</th><th>Where</th><th class="num">kV</th><th class="num">Year</th><th class="num">Miles</th>', up.slice(0, 30).map(x => `<tr><td>${x.kind}</td><td class="wrap">${esc(x.name)}</td><td class="wrap">${esc(x.where)}</td><td class="num">${x.kv ?? '—'}</td><td class="num">${x.year ?? 'not held'}</td><td class="num">${x.mi.toFixed(1)}</td></tr>`).join(''))
      : `<div class="notice">No planned transmission or substation upgrade within ${ctxRec.value.radius.upgrades_mi} mi.</div>`;
    nearTrace = traceNearby(ctxRec.value);
  }
  // Studio copy of the cost at 100 / 250 MW per case (rule differs: ≤ size, $0 counted)
  const stu = stRec.state === 'ok' ? stRec.value?.bus : null;
  const costNotes = ['summer_peak|discharge', 'summer_peak|charge', 'large_load|charge'].flatMap(k => [100, 250].map(mw => { const c = stepCost(data.grid, S.nodeId, k, mw), s = stu?.cost?.[`${k}|${mw}`]; const n = copyNote(['Priced', 'True zero'].includes(c.status) ? c.total : null, s?.total_musd, 0.005); const anyPriced = (c.items || []).some(i => i.cost != null); return `<tr><td>${esc(CASE_LABEL[k])}</td><td class="num">${mw}</td><td class="num">${c.status === 'Not held' ? 'not held' : c.status === 'Partly priced' && !anyPriced ? 'not held: nothing priced' : `${c.status === 'Partly priced' ? '≥ ' : ''}${musd(c.total)}`} <span class="muted">${esc(c.status)}</span></td><td class="num">${s ? musd(s.total_musd) : 'not held'}</td><td>${n.kind === 'same' ? '<span class="pill good">same</span>' : n.kind === 'differs' ? `<span class="pill warn">differs ${n.diff > 0 ? '+' : '−'}$${Math.abs(n.diff).toFixed(2)}M</span>` : `<span class="pill">${esc(n.kind)}</span>`}</td></tr>`; })).join('');
  const nUp = ctxRec.state === 'ok' && ctxRec.value ? ctxRec.value.upgrades.length : null;
  return `<div class="notice">Allocation scenario: <b>${Object.keys(edits).length ? 'Edited' : 'Standalone (project pays 100%)'}</b>. A simple MW share is illustrative only; ISO-NE's cluster allocation method is not held. Study-issued allocations replace these when available.${S.tech === 'datacenter' ? ' Data-centre cost covers the large-load and summer-peak charge cases.' : ''}</div>
    ${res.errors.length ? `<div class="notice error" role="alert">${res.errors.map(esc).join(' ')}</div>` : ''}
    ${(step.unverified || []).length ? `<div class="notice">${step.unverified.map(x => `<b>${esc(x.label)}</b>: ${esc(x.reason)}`).join('<br>')}<br>No upgrades are indicated for these cases, but without a facility list that is not a proven $0.</div>` : ''}
    ${step.gaps.length ? `<div class="notice warn">${step.gaps.map(g => esc(g.label)).join(', ')}: no facility costs are held for this case, so the network-upgrade total is a lower bound.</div>` : ''}
    <!--gx:kpis--><div class="kpis">
      ${kpi('Known subtotal', subtotal, '', `Network: ${costLabel(step)} (${step.status.toLowerCase()}) at ${fmt.mw(size)}`)}
      ${kpi('Unpriced scope', fmt.int(res.unpriced), 'items', res.unpriced ? 'Total is at least the subtotal' : 'All listed scope priced')}
      ${kpi('Per kW (known)', step.status === 'Not requested' || !(size > 0) ? '—' : completeCost && ok(known) ? `$${((known * 1e6) / (size * 1000)).toFixed(0)}` : step.status === 'No upgrades indicated' ? 'not priced' : 'not held', step.status === 'Not requested' || !completeCost ? '' : '/kW', completeCost ? 'Known subtotal ÷ request' : step.status === 'No upgrades indicated' ? 'none indicated, unverified (envelope only): never $0/kW' : `no complete total: ${step.status.toLowerCase()}${known > 0 ? ` (known part ≥ $${((known * 1e6) / (size * 1000)).toFixed(0)}/kW)` : ''}`, !completeCost)}
      ${kpi('Cost status', step.status === 'Lower bound' && !(step.gaps || []).length && (step.unverified || []).length ? 'Partly verified · lower bound' : step.status, '', step.status === 'No upgrades indicated' ? 'Envelope-only: never a proven $0' : step.status === 'True zero' ? 'Element evidence in every costed case' : step.status === 'Lower bound' ? (step.boundWhy || []).join('; ') : `${step.items.length} facilit${step.items.length === 1 ? 'y' : 'ies'} below the request`)}
      ${kpi('Next cost step', nextStep ? fmt.mw(nextStep.mw) : 'none', '', nextStep ? `${short(nextStep.facility.split('; ')[0])} · ${nextStep.counted ? '+ $0.00M (already counted at a lower step)' : `+ ${musd(nextStep.cost)}`}` : 'No facility limit above the request', !nextStep)}
      ${kpi('Planned upgrades nearby', nUp == null ? '…' : fmt.int(nUp), '', `within ${ctxRec.value?.radius?.upgrades_mi ?? 50} mi (context)`)}
    </div><!--/gx:kpis-->
    <!--gx:cards--><div class="cards">
      ${card('c-8', 'Cost to unlock', 'cumulative network cost as the size passes each facility limit', unlockChart, 'Solid = complete total (every facility priced, every case evidenced); dashed = lower bound. Same engine as the allocator; no interpolation between study sizes.', '', { depth: 'screen', trace: 'g-unlock', answer: `At ${esc(fmt.mw(size))} the network cost is ${B(costLabel(step))} (${esc(step.status.toLowerCase())})${nextStep ? `; the next step is at ${B(fmt.mw(nextStep.mw))}, adding ${B(musd(nextStep.cost))}` : '; no facility limit lies above the request'}.` })}
      ${card('c-4', 'Cost steps', 'each facility limit, its cost and the running total', u.steps.length ? dense('<th class="num">Above</th><th>Facility</th><th class="num">Step</th><th class="num">Total</th>', u.steps.map(s => `<tr class="${s.mw < size ? 'gx-hi' : ''}"><td class="num">${fmt.mw(s.mw)}</td><td class="wrap">${esc(s.facility.split('; ').map(short).join('; '))}</td><td class="num"${s.counted ? ' title="Already counted at a lower step: adds nothing"' : ''}>${s.counted ? '$0.00M' : s.cost == null ? 'unpriced' : musd(s.cost)}</td><td class="num">${ok(s.cum) ? `${s.status === 'Lower bound' || s.unpriced ? '≥ ' : ''}${musd(s.cum)}` : 'not held'}</td></tr>`).join('')) : '<div class="notice">No facility limits in these cases.</div>', 'Highlighted = below the request (in the allocator). A facility already counted at a lower step adds $0, so the steps sum to the total.', '', { depth: 'screen', trace: 'g-unlock', answer: u.steps.length ? `${B(u.steps.length)} facility limit${u.steps.length === 1 ? '' : 's'}; ${B(u.steps.filter(x => x.mw < size).length)} lie below the request.` : 'No facility limit is held in these cases.' })}
      ${card('c-12', 'Upgrade scope and allocation', 'facilities that overload below the request in any applicable case, plus direct and affected-system scope',
        dense('<th>Scope</th><th>Category</th><th class="num">Cost $M</th><th class="num">Share %</th><th class="num">Allocated</th><th>Source</th>', rows)
        + (step.contingent ? `<div class="notice warn">${step.contingent} pre-existing overload(s) carry flow from this project and may need upgrades first (contingent facilities).</div>` : '')
        + `<div class="handoff"><div><strong>Use this cost scenario in finance</strong><p>Project finance adds the known subtotal to capital cost and lists the ${fmt.int(res.unpriced)} unpriced item(s).</p></div><button class="primary" data-act="handoff-cost">Use this upgrade-cost scenario in Finance</button></div>`,
        'Editable: cost and share per row. Proportional shares from the card beside can be applied here.', '<button class="tiny" data-act="alloc-reset">Reset to study values</button>', { depth: 'review', trace: 'g-cost', chips: Object.keys(edits).length ? 'assumption' : '', answer: `Known subtotal ${B(subtotal)}; ${B(res.unpriced)} scope item${res.unpriced === 1 ? ' is' : 's are'} unpriced, so the total is at least that.` })}
      ${propCard(S, step, size, clRec, model)}
      ${o1920.html}
      ${card('c-4', '$/kW by size', 'complete totals only', perKwChart + dense('<th class="num">MW</th><th>Status</th><th class="num">Cost</th><th class="num">$/kW</th>', sweep.map(r => `<tr class="${r.size === size ? 'gx-hi' : ''}"><td class="num">${r.size}</td><td>${pill(r.cost.status)}</td><td class="num">${costLabel(r.cost)}</td><td class="num">${ok(r.perKw) ? `$${r.perKw.toFixed(0)}` : '—'}</td></tr>`).join('')), '', '', { depth: 'review', trace: 'g-perkw', answer: `${B(`${sweep.filter(r => ok(r.perKw)).length} of ${sweep.length}`)} sizes have a complete total${(() => { const r = sweep.find(x => x.size === size); return r && ok(r.perKw) ? `; at the request it is ${B(`$${r.perKw.toFixed(0)}/kW`)}` : ''; })()}.` })}
      ${card('c-4', 'Network cost by facility', `facilities that overload below ${fmt.mw(size)}`, itemsChart, 'Study refurbishment cost per facility ($M); unpriced facilities are listed in the allocator, never $0.', '', { depth: 'review', trace: 'g-cost', answer: `${B(step.items.length)} facilit${step.items.length === 1 ? 'y overloads' : 'ies overload'} below ${esc(fmt.mw(size))}${step.items.length ? `, the costliest ${B(musd(Math.max(...step.items.map(i => i.cost).filter(ok), -Infinity) > -Infinity ? Math.max(...step.items.map(i => i.cost).filter(ok)) : null))}` : ''}.` })}
      ${card('c-4', 'Data notes: Studio cost copy', 'single-case cost at 100 / 250 MW, unified vs the live Studio', dense('<th>Case</th><th class="num">MW</th><th class="num">Unified</th><th class="num">Studio copy</th><th>Note</th>', costNotes), `${esc(stRec.value?.meta?.label || 'Studio copy')}. The Studio counts facilities at transfer ≤ size and prints a zero-length $0 as $0; here it is &lt; size and not held, so small differences are rule, not data.`, '', { depth: 'study', chips: 'studio-copy', answer: `${B((costNotes.match(/>differs/g) || []).length)} of 6 case-size costs differ from the Studio copy; the unified figure is used.` })}
      ${card('c-12', 'Planned upgrades nearby', `approved transmission and substation upgrades within ${ctxRec.value?.radius?.upgrades_mi ?? 50} mi (context: none is netted into the limit)`, upHtml, 'dim_transmission_upgrade, dim_substation_upgrade (ISO-NE approved lists). No MW is published for an upgrade; years as published.', '', { depth: 'review', trace: 'g-nearby', answer: nUp == null ? '' : `${B(nUp)} approved upgrade${nUp === 1 ? '' : 's'} within ${esc(ctxRec.value?.radius?.upgrades_mi ?? 50)} mi; none is netted into the connection limit.` })}
      ${traceCard([traceCost(data, S, tech, dir, size, step, res, known), traceUnlock(data, S, tech, u), tracePerKw(S, sweep), nearTrace, traceProp(S.nodeId, model.p, model.members, model.cl?.rule || ''), o1920.trace],
        details('<p>Project estimate = Σ (cost × project share). Facilities are unioned across all applicable study cases. A case with no facility costs that binds below the request makes the total a lower bound (≥). Unpriced items are counted, never treated as $0. Cost to unlock evaluates the same engine just above each facility limit.</p>', '<p>Costs come from the stored facility study. No interpolation between study sizes. A true $0 is shown only when every applicable case has evidence that nothing overloads below the request.</p>', evidence(data)))}
    </div><!--/gx:cards-->
    ${tech === 'datacenter' ? nextLink('add this cost to the load case in <b>Economics › Project finance</b>', 'economics', 'finance') : nextLink('size the deposits on this cost in <b>Queue › Cash &amp; commitments</b>', 'queue', 'cash')}`;
}

// ---------- Tab 4: Mitigation & phasing ----------
function tabMitigation({ data, S }) {
  const noInj = S.tech === 'datacenter' ? 'a data centre withdraws; it is not curtailed by an injection test (it is interrupted or flexed, which the store does not model)' : S.tech === 'storage' ? 'storage discharge is dispatched on price, not a fixed injection profile; Economics › dispatch holds its output' : null;
  const tech = techKey(S.tech), dir = costDirection(S), req = costSize(S);
  // Storage charges at its power rating: the charge case is tested at max(import, export), as in stepCostService.
  const t = caseTable(data.grid, S.nodeId, tech, Number(S.exportMW), chargeMW(tech, S.exportMW, S.importMW)); // C13: one charge convention
  const ex = binding(t, 'export'), im = binding(t, 'import');
  const limits = [dir === 'export' ? ex.value : im.value, isStorage(S.tech) ? im.value : null].filter(ok);
  const lim = limits.length ? Math.min(...limits) : null;
  const curRec = ctxOf(S, 'curtailment'), ctxRec = ctxOf(S, 'context');
  const cur = curRec.state === 'ok' ? curRec.value : null, study = cur?.study || null;
  const sizes = [...new Set([25, 50, 75, 100, 150, 200, 250, 300, 400, 500, req, ok(lim) ? largestWithoutUpgrades(lim) : null].filter(v => ok(v) && v > 0))].sort((a, b) => a - b);
  const alt = sizes.map(s => { const c = dir === 'import' ? stepCostAll(data.grid, S.nodeId, tech, s, dir) : stepCostService(data.grid, S.nodeId, tech, s, tech === 'hybrid' ? Number(S.importMW) : isStorage(S.tech) ? s : 0); const st = studyAtSize(study, s)?.exact; return { s, fits: ok(lim) ? s <= lim : null, env: ok(lim) && s <= lim && [ex.status, im.status].includes(ENVELOPE_ONLY), c, st }; });
  const showStudy = dir === 'export' && !isStorage(S.tech);
  const rows = alt.map(a => `<tr class="${a.s === req ? 'gx-hi' : ''}"><td class="num">${fmt.mw(a.s)}${a.s === req ? ' (request)' : ''}${ok(lim) && a.s === largestWithoutUpgrades(lim) ? " (largest that fits)" : ''}</td><td>${a.fits == null ? '<span class="pill">not studied</span>' : a.env ? pill(ENVELOPE_ONLY) : a.fits ? '<span class="pill good">Fits</span>' : '<span class="pill warn">Needs upgrades</span>'}</td><td class="num">${esc(costLabel(a.c))}${a.c.unpriced && ok(a.c.total) ? ` + ${a.c.unpriced} unpriced` : ''}</td><td class="num">${ok(a.c.total) && ['Priced', 'True zero'].includes(a.c.status) && a.s > 0 ? `$${((a.c.total * 1e6) / (a.s * 1000)).toFixed(0)}/kW` : '—'}</td>${showStudy ? `<td class="num">${a.st ? pct(a.st.pct) : [100, 250, 500].includes(a.s) && study ? 'not tested' : '—'}</td><td class="num">${a.st && ok(deliveredValue(a.st)) ? `$${deliveredValue(a.st).toFixed(2)}` : '—'}</td>` : ''}</tr>`).join('');
  const atReq = stepCostService(data.grid, S.nodeId, tech, Number(S.exportMW), Number(S.importMW));
  const pts = alt.filter(a => ['Priced', 'True zero'].includes(a.c.status) && ok(a.c.total)).map(a => ({ x: a.s, y: a.c.total }));
  // Curtailment (study injection test, PCR units, price proxy)
  let curHtml = pending(curRec, 'the injection test'), valHtml = curHtml, unitHtml = curHtml, priceHtml = curHtml, curTrace = '';
  if (cur) {
    const tested = (study || []).filter(r => r.tested);
    curHtml = study ? CH.barChart(study.map(r => ({ label: `${r.mw} MW`, value: r.tested ? r.pct : null, note: r.tested ? `${n1(r.mwh)} MWh over ${fmt.int(r.hours)} h · max ${n1(r.max_mw)} MW` : 'not tested' })), { fmt: v => `${v.toFixed(1)}%`, title: 'Curtailed share of offered energy by size', height: 170 })
      + dense('<th class="num">Size</th><th class="num">Curtailed</th><th class="num">MWh</th><th class="num">Hours</th><th class="num">Max MW</th><th class="num">Avg LMP after</th>', study.map(r => `<tr class="${r.mw === req ? 'gx-hi' : ''}"><td class="num">${r.mw}</td><td class="num">${r.tested ? pct(r.pct) : 'not tested'}</td><td class="num">${r.tested ? fmt.int(r.mwh) : '—'}</td><td class="num">${r.tested ? fmt.int(r.hours) : '—'}</td><td class="num">${r.tested ? n1(r.max_mw) : '—'}</td><td class="num">${r.tested && ok(r.avg_lmp) ? `$${r.avg_lmp.toFixed(2)}` : '—'}</td></tr>`).join(''))
      : '<div class="notice">Not held: the headroom study tested no injection size at this bus.</div>';
    valHtml = tested.length ? CH.barChart([...tested.map(r => ({ label: `${r.mw} MW`, value: deliveredValue(r), note: `(1 − ${(r.pct / 100).toFixed(3)}) × $${n2(r.avg_lmp)}` })), ...(ok(cur.study_base_lmp) ? [{ label: 'No injection', value: cur.study_base_lmp, note: 'Study base-case average LMP (5-year run)' }] : [])], { fmt: v => `$${v.toFixed(2)}`, title: 'Delivered value per offered MWh by size', height: 190 })
      : '<div class="notice">Not held: no tested size, so no delivered value.</div>';
    unitHtml = cur.units.length ? dense('<th>Unit</th><th>Fuel</th><th class="num">Max MW</th>', cur.units.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.fuel)}</td><td class="num">${n1(x.econ_max_mw)}</td></tr>`).join(''))
      + dense('<th>Run</th><th class="num">Available MWh</th><th class="num">Dispatched</th><th class="num">Curtailed</th><th class="num">Share</th><th class="num">Hours</th><th class="num">Uncommitted MWh</th>', cur.unit_runs.map(r => `<tr><td>${r.run}</td><td class="num">${fmt.int(r.avail_mwh)}</td><td class="num">${fmt.int(r.dispatch_mwh)}</td><td class="num">${fmt.int(r.curt_mwh)}</td><td class="num">${pct(r.pct)}</td><td class="num">${fmt.int(r.curt_hours)}</td><td class="num">${fmt.int(r.uncommitted_mwh)}</td></tr>`).join(''))
      : `<div class="notice">Not held: the PCR runs place no solar or wind unit at this bus's price node, so no solved curtailment can be read here.</div>`;
    const pr = cur.price.filter(p => p.kind === 'settled' && /^RT/.test(p.key)).concat(cur.price.filter(p => p.kind === 'solved'));
    priceHtml = pr.length ? CH.barChart(pr.map(p => ({ label: p.key.replace(/^RT/, 'RT '), value: p.le0, note: `${fmt.int(p.le0)} of ${fmt.int(p.hours)} h${p.hours < 8000 ? ' (part year)' : ''}` })), { fmt: v => `${v.toFixed(0)} h`, title: 'Hours priced at or below $0', height: 170 })
      : '<div class="notice">Not held: no price series for this bus.</div>';
    curTrace = traceCurtail(cur, req, deliveredValue, offeredMwh);
  }
  // Nearby retirements and additions
  let nearHtml = pending(ctxRec, 'nearby retirements and requests'), genHtml = nearHtml;
  const ctx = ctxRec.state === 'ok' ? ctxRec.value : null;
  if (ctx) {
    const years = [...new Set([...ctx.retirements.map(r => r.year), ...ctx.queue.map(q => (q.is_date ? Number(String(q.is_date).slice(0, 4)) : null))].filter(ok))].sort();
    nearHtml = years.length ? CH.groupedBar(years.map(y => ({ label: String(y), values: [ctx.retirements.filter(r => r.year === y).reduce((a, r) => a + (r.mw || 0), 0) || null, ctx.queue.filter(q => q.is_date && Number(String(q.is_date).slice(0, 4)) === y).reduce((a, q) => a + (q.mw || 0), 0) || null] })), { series: [`Retirements ≤ ${ctx.radius.retirements_mi} mi (MW)`, `Queue requests ≤ ${ctx.radius.queue_mi} mi (MW)`], fmt: v => `${v.toFixed(0)} MW`, title: 'Retirements and queue requests by year', height: 190 }) : '<div class="notice">No retirement or located queue request nearby.</div>';
    nearHtml += dense('<th>Record</th><th>Name / POI</th><th class="num">MW</th><th class="num">Year</th><th>Status / zone</th><th class="num">Miles</th>', [...ctx.retirements.map(r => `<tr><td>Retirement</td><td class="wrap">${esc(r.name)}</td><td class="num">${n1(r.mw)}</td><td class="num">${r.year ?? 'not held'}</td><td>${esc(r.zone || '')}</td><td class="num">${r.mi.toFixed(1)}</td></tr>`), ...ctx.queue.map(q => `<tr><td>Queue #${q.qp} ${esc(q.type)}</td><td class="wrap">${esc(q.poi)}</td><td class="num">${n1(q.mw)}</td><td class="num">${q.is_date ? String(q.is_date).slice(0, 4) : 'not held'}</td><td>${esc(q.status)}</td><td class="num">${q.mi.toFixed(1)}</td></tr>`)].join(''));
    const op = ctx.generators.filter(g => g.status === 'Operating'), off = ctx.generators.filter(g => g.status !== 'Operating');
    genHtml = `<div class="gx-stats"><div class="gx-stat"><span>Operating units ≤ ${ctx.radius.generators_mi} mi</span><b>${op.length} · ${n1(op.reduce((a, g) => a + (g.max_mw || 0), 0))} MW</b></div><div class="gx-stat"><span>Other status</span><b>${off.length} · ${n1(off.reduce((a, g) => a + (g.max_mw || 0), 0))} MW</b></div><div class="gx-stat"><span>Queue ≤ ${ctx.radius.queue_mi} mi</span><b>${ctx.queue.length} · ${n1(ctx.queue.reduce((a, q) => a + (q.mw || 0), 0))} MW</b></div><div class="gx-stat"><span>Retired ≤ ${ctx.radius.retirements_mi} mi</span><b>${ctx.retirements.length} · ${n1(ctx.retirements.reduce((a, r) => a + (r.mw || 0), 0))} MW</b></div></div>`
      + dense('<th>Generator</th><th>Status</th><th class="num">Max MW</th><th class="num">Miles</th>', ctx.generators.slice(0, 20).map(g => `<tr><td class="wrap">${esc(g.name)}</td><td>${esc(g.status)}</td><td class="num">${n1(g.max_mw)}</td><td class="num">${g.mi.toFixed(1)}</td></tr>`).join(''));
  }
  const st = studyAtSize(study, req);
  const unitLatest = cur?.unit_runs?.at(-1);
  const retMW = ctx ? ctx.retirements.reduce((a, r) => a + (r.mw || 0), 0) : null;
  return `<!--gx:kpis--><div class="kpis">
      ${kpi('Largest size without upgrades', ok(lim) ? fmt.mw(largestWithoutUpgrades(lim)) : 'not held', '', isStorage(S.tech) ? 'Lower of export and shoulder-charge limits' : (dir === 'export' ? ex.row?.label : im.row?.label) || '', !ok(lim))}
      ${kpi('Upgrade cost at request', costLabel(atReq), '', `${fmt.mw(req)} · ${esc(atReq.status.toLowerCase())}`)}
      ${kpi('Output given up by downsizing', ok(lim) && req > lim ? fmt.mw(req - largestWithoutUpgrades(lim)) : '—', '', 'Request − largest size that fits')}
      ${noInj ? kpi('Study curtailment at request', 'n/a', '', `Not applicable to ${TECH_WORD[S.tech]}`, true) : kpi('Study curtailment at request', !cur ? '…' : st?.exact ? pct(st.exact.pct) : 'not tested', '', !cur ? 'loading' : st?.exact ? `${fmt.int(st.exact.mwh)} MWh · injection test (older copy)` : `Tested: ${(study || []).filter(r => r.tested).map(r => `${r.mw} MW ${pct(r.pct)}`).join(', ') || 'none'}`, cur && !st?.exact)}
      ${S.tech === 'datacenter' ? kpi('Cheap-energy hours (latest RT year)', !cur ? '…' : (() => { const r = cur.price.filter(x => x.kind === 'settled' && /^RT/.test(x.key)).at(-1); return r ? fmt.int(r.le0) : 'not held'; })(), 'h', 'Hours priced at or below $0: an energy-cost signal for a load') : kpi('PCR solar/wind curtailment', !cur ? '…' : unitLatest ? pct(unitLatest.pct) : 'not held', '', !cur ? 'loading' : unitLatest ? `${unitLatest.run}, units at this price node` : 'No unit at this price node', cur && !unitLatest)}
      ${kpi('Retirements nearby', ctx ? fmt.mw(retMW) : '…', '', ctx ? `${ctx.retirements.length} within ${ctx.radius.retirements_mi} mi` : 'loading')}
    </div><!--/gx:kpis-->
    <!--gx:cards--><div class="cards">
      ${card('c-8', 'Size alternatives', 'connection, upgrade cost and study curtailment at each size', dense(`<th class="num">Size</th><th>Connection</th><th class="num">Upgrade cost</th><th class="num">Per kW</th>${showStudy ? '<th class="num">Study curtailment</th><th class="num">Value $/offered MWh</th>' : ''}`, rows),
        `Cost from published facility limits (screening; no new study). ${showStudy ? 'Curtailment and value only at the study\'s tested sizes (100 / 250 / 500 MW); never interpolated.' : 'The injection test covers export only; storage and loads are not tested.'}`, '', { depth: 'screen', trace: 'g-mitigation', answer: `The largest size that fits is ${B(ok(lim) ? fmt.mw(largestWithoutUpgrades(lim)) : 'not held')}; at the request (${esc(fmt.mw(req))}) the upgrade cost is ${B(costLabel(atReq))}.` })}
      ${card('c-4', 'Upgrade cost by size', 'complete totals only', pts.length ? CH.lineChart([{ name: 'Upgrade cost', points: pts }], { fmt: v => `$${v.toFixed(1)}M`, xfmt: v => `${v} MW`, title: 'Upgrade cost by size', height: 200 }) : '<div class="notice">No complete cost is held for any size in this configuration.</div>', 'Partly priced, lower-bound and unverified sizes are in the table with ≥ or "none indicated".', '', { depth: 'screen', trace: 'g-mitigation', answer: pts.length ? `${B(pts.length)} size${pts.length === 1 ? ' has' : 's have'} a complete cost, from ${B(musd(pts[0].y))} at ${esc(fmt.mw(pts[0].x))} to ${B(musd(pts.at(-1).y))} at ${esc(fmt.mw(pts.at(-1).x))}.` : 'No size has a complete cost in this configuration.' })}
      ${noInj ? na('c-6', 'Curtailment at size', S.tech, noInj) : card('c-6', 'Curtailment at size', 'the headroom study\'s fixed injection on the PROBE 5-year run', curHtml, `${esc(cur?.study_label || 'Older study copy')}. A smaller size is tested only where the larger one curtails: "not tested" is not zero. The vendor curtailment ramp is excluded (data_quality: validated=false).`, '', { depth: 'review', trace: 'g-curtail', chips: 'studio-copy', answer: !cur ? '' : (study || []).some(r => r.tested) ? `Tested: ${(study || []).filter(r => r.tested).map(r => `${B(`${r.mw} MW`)} curtails ${B(pct(r.pct))}`).join(', ')}.` : 'Not held: the study tested no injection size at this bus.' })}
      ${noInj ? na('c-6', 'Delivered value by size', S.tech, noInj) : card('c-6', 'Delivered value by size', 'what each offered MWh earns after curtailment and price suppression', valHtml, 'Value = (1 − curtailed share) × the study\'s average LMP after the injection (time-average, not capture-weighted). A proxy for comparing sizes, not a revenue forecast; Economics holds the revenue model.', '', { depth: 'review', trace: 'g-curtail', chips: 'studio-copy', answer: !cur ? '' : (study || []).filter(r => r.tested && ok(deliveredValue(r))).length ? `Each offered MWh earns ${(study || []).filter(r => r.tested && ok(deliveredValue(r))).map(r => `${B(`$${deliveredValue(r).toFixed(2)}`)} at ${r.mw} MW`).join(', ')}.` : 'Not held: no tested size, so no delivered value.' })}
      ${S.tech === 'datacenter' ? na('c-6', 'Solved curtailment of existing units', S.tech, 'curtailment of solar and wind units at the price node does not bear on a load\'s connection', 'study') : card('c-6', 'Solved curtailment of existing units', 'PCR solar and wind units at this bus\'s price node', unitHtml, 'Curtailed = max_bid − dispatch on committed hours; uncommitted output counted apart. Existing and planned units in the run, not the plant being sited.', '', { depth: 'study', chips: 'modelled', answer: !cur ? '' : unitLatest ? `In ${esc(unitLatest.run)}, solar and wind units at this price node lose ${B(pct(unitLatest.pct))} of available energy.` : 'Not held: no solar or wind unit sits at this price node in the runs.' })}
      ${card('c-6', S.tech === 'datacenter' ? 'Price signal: cheap-energy hours' : 'Price signal: hours at or below $0', 'settled RT by year and each solved run', priceHtml, S.tech === 'datacenter' ? 'Hours priced at or below $0: when a flexible load could draw at no energy cost. Not a curtailment count.' : 'A market signal of economic curtailment, not a count of curtailed energy. Part years are marked in the hover.', '', { depth: 'review', chips: 'modelled', answer: !cur ? '' : (() => { const r = cur.price.filter(x => x.kind === 'settled' && /^RT/.test(x.key)).at(-1); return r ? `In ${esc(r.key)}, ${B(`${fmt.int(r.le0)} h`)} of ${fmt.int(r.hours)} priced at or below $0.` : 'Not held: no price series for this bus.'; })() })}
      ${card('c-8', 'Retirements and queue requests nearby', 'context for phasing: capacity leaving and requests competing nearby', nearHtml, `dim_retirement (ISO-NE list), dim_queue (${ctx ? ctx.queue_unplaced : '…'} requests have no coordinate and are not placed). Not netted into any limit.`, '', { depth: 'review', trace: 'g-nearby', answer: ctx ? `${B(ctx.retirements.length)} retirement${ctx.retirements.length === 1 ? '' : 's'} (${B(fmt.mw(retMW))}) within ${ctx.radius.retirements_mi} mi and ${B(ctx.queue.length)} queue request${ctx.queue.length === 1 ? '' : 's'} within ${ctx.radius.queue_mi} mi.` : '' })}
      ${card('c-4', 'Generators nearby', 'units in the power-flow model near the bus', genHtml, 'dim_generator (status as in the model).', '', { depth: 'study', answer: ctx ? `${B(ctx.generators.filter(g => g.status === 'Operating').length)} operating units within ${ctx.radius.generators_mi} mi.` : '' })}
      ${card('c-12', 'Other levers', 'mitigations the store cannot size, listed so they are not forgotten', S.tech === 'datacenter' ? `<p class="gx-cap lead">Phased energisation (energise to the largest import that fits, add after upgrades) · flexible or interruptible load during constrained hours (not modelled) · on-site generation or storage to shave the summer-peak draw (not modelled) · alternative POIs (switch the candidate bus; Market ranks all 2,678 buses) · reactive or voltage support (not studied here). No ISO-NE large-load procedure exists yet (${esc(llBadge())}).</p>` : `<p class="gx-cap lead">${isStorage(S.tech) ? 'Charging caps (Economics › BESS dispatch uses the shoulder charge limit) · ' : ''}staged capacity (build to the largest size that fits, add after upgrades) · alternative POIs (switch the candidate bus; Market ranks all 2,678 buses on the same rules) · surplus interconnection at an existing POI (screened on Connection capacity; never a pass) · reactive or voltage support (not studied here).</p>`, '', '', { depth: 'review', answer: 'These levers cannot be sized from the store; they are listed so they are not forgotten.' })}
      ${traceCard([traceMitigation(data, S, tech, dir, lim), curTrace, ctx ? traceNearby(ctx) : ''], details('<p>Cost(S) = Σ facility costs whose transfer limit is below S, across all applicable cases, excluding pre-existing overloads. Delivered value = (1 − curtailed share) × average LMP after the injection.</p>', '<p>Sizes between study points are screened from facility transfer limits, which are size-independent. This is not an interconnection study result.</p>', evidence(data)))}
    </div><!--/gx:cards-->
    ${nextLink(`value the size that fits in <b>Economics › ${{ storage: 'Storage revenue', hybrid: 'Hybrid sizing', datacenter: 'Load cost' }[S.tech] || 'Solar &amp; wind revenue'}</b>`, 'economics', { storage: 'bess', hybrid: 'hybrid' }[S.tech] || 'revenue')}`;
}

// ---------- One view (2026-10-22): the network map in the middle, every input and figure on screen ----------
// The former four tabs (capacity · constraints · cost · mitigation) are one view around the network map, as Market's and
// Land's are. Each tab function still computes and builds everything it did: its cards, its six figures, its notices and
// its side effects (the limits and the cost scenario the hand-offs send, which every render now keeps current).
// renderGrid takes each tab's output apart by its markers (gx:kpis, gx:cards) and the figures it hands to SINK, and lays
// them out: a strip naming, under each of the four, what is set and what it gives (it stays at the top while the page
// scrolls); the answer, two figures per group and the study basis; the network around the bus, with the Grid inputs on
// its left (each group's other four figures, the request slider, the case and period, both hand-offs) and the limiting
// facilities on its right (click one to select it on the map); then every card of the four tabs in four groups under
// the map, each with its one-line answer readable while closed. The old ids and labels stay as aliases (GRID.tabAlias).
const GROUP_KPIS = {
  capacity: ['export', 'import', 'margin', 'envgap', 'scr', 'pre'],
  constraints: ['lowest', 'overloaded', 'pre', 'whole', 'pcr', 'leading'],
  cost: ['subtotal', 'unpriced', 'perkw', 'status', 'next', 'planned'],
  mitigation: ['largest', 'atreq', 'givenup', 'curtail', 'pcrcurt', 'retire'],
};
const TAB_FN = { capacity: tabCapacity, constraints: tabConstraints, cost: tabCost, mitigation: tabMitigation };
const stripTags = s => String(s ?? '').replace(/<[^>]+>/g, '');
const valueOf = h => stripTags(String((/<div class="value"[^>]*>([\s\S]*?)<\/div>/.exec(h || '') || [])[1] || '').replace(/<span class="unit">/g, ' ')).replace(/\s+/g, ' ').trim();
const firstAnswer = h => (/<p class="card-answer">([\s\S]*?)<\/p>/.exec(h || '') || [])[1] || '';
const grab = (h, rx) => (rx.exec(h || '') || [])[0] || '';
// A chip clears one input through that input's own action (mk-chip forwards to data-a), so a selector for the input never
// also finds its chip.
const gchip = (text, act, k, v, title) => `<button type="button" class="mk-chip" data-act="mk-chip" data-a="${act}"${k ? ` data-k="${k}"` : ''} data-v="${esc(v)}" title="${esc(title)}">${esc(text)}<span aria-hidden="true">×</span></button>`;
/** One tab's output taken apart: before its figures (notices, drawers), its figures by name, between them and the cards
 *  (the study basis), the cards, its next step. The figures are the ones the tab built, in its own order (SINK). */
function partOf(key, ctx) {
  SINK = [];
  let html = '';
  try { html = TAB_FN[key](ctx); } finally { /* the figures are read below */ }
  const figs = SINK; SINK = null;
  const M = { k0: '<!--gx:kpis-->', k1: '<!--/gx:kpis-->', c0: '<!--gx:cards-->', c1: '<!--/gx:cards-->' }, at = m => html.indexOf(m);
  const names = GROUP_KPIS[key];
  const K = Object.fromEntries(figs.map((h, i) => { const n = names[i] || `k${i}`; return [n, h.replace('<div class="kpi', `<div data-kg="${key}" data-kpi="${n}" class="kpi`)]; }));
  if (at(M.k0) < 0 || at(M.c0) < 0) return { key, pre: '', mid: '', cards: html, next: '', K }; // no markers: every part as cards (never lose content)
  const cards = html.slice(at(M.c0) + M.c0.length, at(M.c1)).replace(/^\s*<div class="cards">/, '').replace(/<\/div>\s*$/, '');
  return { key, pre: html.slice(0, at(M.k0)), mid: html.slice(at(M.k1) + M.k1.length, at(M.c0)), cards, next: html.slice(at(M.c1) + M.c1.length), K };
}
const MAP_LAYERS0 = { gNet: true, gPre: true, gSub: true, gRing: true, gShared: true, gGen: false, gIbr: false };
/** The network map's content: the model (views/grid-netmap.js) plus what the payloads place near the bus. */
function gridMapSpec(m, subs, x, L) {
  const b = m.bus, r = m.radius || 15, dLat = r / 69, dLon = r / (69 * Math.cos((b.lat * Math.PI) / 180));
  const box = [[b.lon - dLon, b.lat - dLat], [b.lon + dLon, b.lat + dLat], ...m.fac.flatMap(l => [l.a, l.b])];
  const sel = m.selected, layers = [], items = [];
  if (L.gRing) layers.push({ kind: 'rings', center: [b.lon, b.lat], miles: [5, 10, r] });
  if (L.gNet) { layers.push({ kind: 'lines', lines: m.net }); items.push({ label: `Network (${m.net.length})`, cls: 'gm-net', shape: 'line', fill: '#3a4d6b' }); }
  if (L.gPre) { layers.push({ kind: 'lines', lines: m.fac.filter(l => /gm-pre/.test(l.cls)) }); items.push({ label: `Pre-existing overload (${m.counts.pre})`, shape: 'line', fill: 'var(--warn)' }); }
  layers.push({ kind: 'lines', lines: m.fac.filter(l => /gm-lim/.test(l.cls) && !/gm-sel/.test(l.cls)) });
  items.unshift({ label: `Limits this bus (${m.counts.lim})`, shape: 'line', fill: 'var(--bad)' });
  if (L.gSub) { layers.push({ kind: 'points', points: subs.map(s => ({ lon: s.lon, lat: s.lat, r: 2.6, fill: 'var(--ink-4)', tip: substationTip(s) })) }); items.push({ label: 'Substation', fill: 'var(--ink-4)' }); }
  if (L.gGen && x.gens.length) { layers.push({ kind: 'points', cls: 'g-gen', points: x.gens.map(g => ({ lon: g.lon, lat: g.lat, r: 3 + Math.min(7, Math.sqrt(Math.max(0, g.mw)) / 2.5), cls: 'g-gen', tip: `<b>Generation at ${esc(g.bus)}</b><br>${g.units.slice(0, 6).map(u => `${esc(u.name)}: ${n1(u.mw)} MW ${esc(String(u.status || '').toLowerCase())}`).join('<br>')}${g.units.length > 6 ? `<br>+${g.units.length - 6} more` : ''}<br>drawn at its connection bus` })) }); items.push({ label: 'Generators within 10 mi (at their bus; size = max MW)', fill: 'var(--gs-amber, #e0a63a)' }); }
  if (L.gIbr && x.ibr.length) { layers.push({ kind: 'points', cls: 'g-ibr', points: x.ibr.map(u => ({ lon: u.lon, lat: u.lat, r: 4.5, cls: 'g-ibr', tip: `<b>${esc(u.name)}</b> · inverter-based (by name)<br>${n1(u.mw)} MW · ${esc(u.status || '')}${ok(u.mi) ? ` · ${u.mi.toFixed(1)} mi` : ''}<br>counts toward the weighted SCR indicator` })) }); items.push({ label: 'Inverter-based units (by name; weighted-SCR indicator)', fill: 'var(--s3, #2bb3a3)' }); }
  if (L.gShared && x.shared.length) { layers.push({ kind: 'labels', labels: x.shared }); items.push({ label: 'N buses on a limiting line: the connection points it also limits (contested headroom)', fill: 'transparent', cls: 'g-shared-sw' }); }
  if (sel && sel.drawn) { layers.push({ kind: 'lines', lines: m.fac.filter(l => l.key === sel.key) }, { kind: 'points', points: [sel.a, sel.b].map(q => ({ lon: q[0], lat: q[1], r: 4.5, cls: 'gm-sel', fill: 'var(--bad)', tip: `${esc(sel.label)} (selected)` })) }); items.push({ label: `Selected: ${sel.label}`, shape: 'line', fill: 'var(--bad)', cls: 'g-sel-sw' }); }
  layers.push({ kind: 'points', points: [{ lon: b.lon, lat: b.lat, r: 6.5, cls: 'gm-sel', fill: 'var(--accent)', label: b.bus_name, tip: busTip(b) }] });
  items.push({ label: 'This bus', fill: 'var(--accent)' });
  return { box, layers, legend: { items }, title: `Network within ${r} mi of ${b.bus_name}` };
}
/** Right of the map: this bus's facilities in the cases its service uses (limiting first, tightest first); a row selects
 *  its line on the map (the map line does the same), and the selected one's cases are listed under the list. */
function facilitiesFloat(m, sharedOf) {
  const sel = m.selected, list = m.facilities.slice().sort((x, y) => (y.limiting - x.limiting) || ((x.minTransfer ?? 1e9) - (y.minTransfer ?? 1e9)));
  const rows = list.map(f => { const sh = sharedOf(f.key); return `<tr class="clickable${sel && sel.key === f.key ? ' sel' : ''}" data-act="grid-fac" data-v="${esc(f.key)}" data-fk="${esc(f.key)}" tabindex="0" title="${sel && sel.key === f.key ? 'Clear the selection' : 'Select to highlight its line on the map'}"><td><b>${esc(f.label)}</b><div class="audit-note" style="margin:0">${ok(f.kv) ? `${esc(f.kv)} kV · ` : ''}${esc(f.cases.map(c => c.caseLabel).join(', '))}${ok(f.mi) ? ` · ${f.mi.toFixed(1)} mi` : f.drawn ? '' : ' · not drawn'}${ok(sh) && sh > 1 ? ` · limits ${fmt.int(sh)} buses` : ''}</div></td><td class="num">${ok(f.minTransfer) ? fmt.mw(f.minTransfer) : '—'}</td><td>${f.limiting ? '<span class="pill warn">Limits</span>' : '<span class="pill warn">Pre-existing</span>'}</td></tr>`; }).join('');
  const selBox = sel ? `<section class="mk-selb" aria-label="Selected facility"><h4>${esc(sel.label)} <span class="audit-note">${ok(sel.kv) ? `${esc(sel.kv)} kV · ` : ''}${sel.limiting ? 'limits this bus' : 'pre-existing overload'}${ok(sel.mi) ? ` · ${sel.mi.toFixed(1)} mi` : ''}${ok(sharedOf(sel.key)) ? ` · limits ${fmt.int(sharedOf(sel.key))} buses` : ''}</span></h4>${dense('<th>Case</th><th class="num">Rating</th><th class="num">Before</th><th class="num">DFAX</th><th class="num">Transfer</th>', sel.cases.map(c => `<tr><td class="wrap">${esc(c.caseLabel)}</td><td class="num">rate ${esc(c.rate)} ${ok(c.rating) ? fmt.int(c.rating) : 'n/h'}</td><td class="num">${ok(c.pct_loading_no_transfer) ? `${c.pct_loading_no_transfer.toFixed(1)}%` : 'not held'}</td><td class="num">${n3(c.dfax)}</td><td class="num">${ok(c.transfer_mw) ? fmt.mw(c.transfer_mw) : '—'}</td></tr>`).join(''))}${sel.drawn ? '' : '<p class="audit-note" style="margin:0">Not drawn: an end has no coordinate.</p>'}<button type="button" class="tiny" data-act="ui" data-k="gfac" data-v="" style="align-self:flex-start">Clear the selection</button></section>` : '';
  return `<aside class="mk-float mk-fl" aria-label="This bus's limiting facilities" data-trace="g-netmap"><header class="mk-float-h"><h3>Limiting facilities</h3><span class="mk-float-sub">${esc(m.counts.lim)} limit · ${esc(m.counts.pre)} pre-existing · click to select</span><button type="button" class="mk-x" data-act="mk-float" data-k="gridList" data-v="0" aria-label="Fold the facilities" title="Fold">–</button></header>
    <p class="mk-float-a">${netAnswer(m)}</p>
    ${rows ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Facility</th><th class="num">Limit</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="notice">No limiting facility is listed for this bus in the cases this service uses.</div>'}
    ${selBox}
    <p class="card-f">Limit = the lowest transfer to 100% among the facility's rows that are not already overloaded. Pre-existing = |loading before the project| ≥ 100%. Contingencies, loading at the request and each row's record (Details) are in Constraints &amp; coverage, under the map.</p></aside>
    <button type="button" class="mk-float-min mk-fl-min" data-act="mk-float" data-k="gridList" data-v="1" title="Show the limiting facilities">Facilities · ${esc(m.counts.lim)} limit ▸</button>`;
}

export function renderGrid(tab, ctx) {
  // fix-3 / nullmw: a project that does not hold its size is never screened at 0 MW (no margin, SCR ÷ 0, "Request 0 MW"
  // or slider default of 100): the one card, Decision's phrase.
  if (ctx.S && sizeNotHeld(ctx.S)) return sizeNotHeldCard(ctx.S);
  const { S, data } = ctx;
  const tech = techKey(S.tech), load = tech === 'datacenter';
  // Every analysis computes on every render (capacity first: the limits the Economics hand-off sends; cost: the scenario
  // Finance takes): the bar shows each one's result, and the Map tab its figures and inputs.
  const P = Object.fromEntries(['capacity', 'constraints', 'cost', 'mitigation'].map(k => [k, partOf(k, ctx)]));
  const val = (g, k) => valueOf(P[g].K[k]);
  const fig = (g, ks) => ks.map(k => P[g].K[k]).filter(Boolean);
  const req = load ? Number(S.importMW) : Number(S.exportMW);
  const edits = Object.keys(S.ui.alloc?.[S.ui.allocKey] || {}).length, members = S.ui.gCluster ? parseCluster(S.ui.gCluster, S.nodeId).members.length : 0;
  const rec = gridData('around', S.nodeId, 'gridnet'), mPend = pending(rec, 'the network around the bus');
  const m = mPend ? null : netMapModel(rec.value, { tech, sel: S.ui.gfac });
  const ctxRec = ctxOf(S, 'context'), cx = ctxRec.state === 'ok' ? ctxRec.value : null, v5 = v5Of(S).value || null;
  const sharedOf = k => cx?.facilities?.find(f => f.key === k)?.shared?.buses ?? null;
  // The four groups: what each strip pill and float section shows.
  const G = [
    { key: 'capacity', short: 'Limit', top: load ? ['import', 'margin'] : ['export', 'margin'], side: load ? ['export', 'envgap', 'scr', 'pre'] : ['import', 'envgap', 'scr', 'pre'],
      chips: load && S.ui.llAppDate ? [gchip(`application ${S.ui.llAppDate}`, 'ui', 'llAppDate', '', 'Clear the large-load application date')] : [],
      none: `${fmt.mw(req)} ${load ? 'import' : 'export'}${isStorage(S.tech) ? ` + ${fmt.mw(chargeMW(tech, S.exportMW, S.importMW))} charge` : ''} · ${TECH_WORD[S.tech] || S.tech}`,
      result: `${load ? 'import' : 'export'} ${B(val('capacity', load ? 'import' : 'export'))} · margin ${B(val('capacity', 'margin'))}`,
      body: `${load ? '' : `<div class="gx-slider"><span>Export request</span><input type="range" min="10" max="600" step="5" value="${Number(S.exportMW) || 100}" data-act="grid-size" data-live aria-label="Export request MW"><output>${Number(S.exportMW) || 100}</output><span>MW</span></div>`}${grab(P.capacity.cards, /<div class="handoff">[\s\S]*?<\/button><\/div>/)}` },
    { key: 'constraints', short: 'Bottlenecks', top: ['lowest', 'overloaded'], side: ['pre', 'whole', 'pcr', 'leading'],
      chips: [S.ui.gcase && CASE_LABEL[S.ui.gcase] ? gchip(`case: ${CASE_LABEL[S.ui.gcase]}`, 'ui', 'gcase', '', 'Back to the binding case') : '', m?.selected ? gchip(`selected: ${short(m.selected.label)}`, 'ui', 'gfac', '', 'Clear the selected facility') : '', S.ui.gper ? gchip(`period ${S.ui.gper}`, 'ui', 'gper', '', 'Back to the default period') : ''].filter(Boolean),
      none: 'Binding case · no facility selected', result: `lowest ${B(val('constraints', 'lowest'))} · ${B(val('constraints', 'overloaded'))} overloaded`,
      body: `${grab(P.constraints.cards, /<div class="segmented seg-sm" role="group"><button type="button" data-act="ui" data-k="gcase"[\s\S]*?<\/div>/) ? `<div class="mk-row"><span class="audit-note" style="margin:0">Case</span>${grab(P.constraints.cards, /<div class="segmented seg-sm" role="group"><button type="button" data-act="ui" data-k="gcase"[\s\S]*?<\/div>/)}</div>` : ''}${grab(P.constraints.cards, /<div class="segmented seg-sm" role="group"><button type="button" data-act="ui" data-k="gper"[\s\S]*?<\/div>/) ? `<div class="mk-row"><span class="audit-note" style="margin:0">Period</span>${grab(P.constraints.cards, /<div class="segmented seg-sm" role="group"><button type="button" data-act="ui" data-k="gper"[\s\S]*?<\/div>/)}</div>` : ''}` },
    { key: 'cost', short: 'Upgrades', top: ['subtotal', 'status'], side: ['unpriced', 'perkw', 'next', 'planned'],
      chips: [edits ? gchip(`${edits} cost edit${edits === 1 ? '' : 's'}`, 'alloc-reset', '', '', 'Reset to study values') : '', members ? gchip(`cluster: ${members} bus${members === 1 ? '' : 'es'}`, 'ui', 'gCluster', '', 'Clear the cluster') : ''].filter(Boolean),
      none: 'Standalone: the project pays 100%', result: `${B(val('cost', 'subtotal'))} · ${esc(val('cost', 'status'))}`,
      body: `${grab(P.cost.pre, /<div class="notice">Allocation scenario:[\s\S]*?<\/div>/)}<div class="mk-row"><button type="button" class="tiny" data-act="alloc-reset">Reset to study values</button></div>${grab(P.cost.cards, /<div class="handoff">[\s\S]*?<\/button><\/div>/)}` },
    { key: 'mitigation', short: 'Phasing', top: ['largest', 'givenup'], side: ['atreq', 'curtail', 'pcrcurt', 'retire'],
      chips: [], none: 'No inputs: every size is screened', result: `largest fit ${B(val('mitigation', 'largest'))}`, body: '' },
  ].map(g => ({ ...g, label: groupLabel(g.key, S.tech), answer: firstAnswer(P[g.key].cards) }));
  // The bar: the map, then the four analyses, each with its result and the inputs set in it (× clears one).
  const ICON = { capacity: 'limit', constraints: 'bottleneck', cost: 'upgrade', mitigation: 'phase' };
  const bar = categoryBar({ label: 'Grid: the map and the four analyses', tab, items: [
    { id: 'map', icon: 'map', label: 'Map', title: 'The network around the bus, with the Grid inputs and the limiting facilities beside it', result: m ? `${B(fmt.int(m.counts.lim))} limiting · ${fmt.int(m.counts.pre)} pre-existing` : 'network loading' },
    ...G.map(g => ({ id: g.key, icon: ICON[g.key], label: g.short, title: g.label, result: g.result, chips: g.chips, none: g.none })),
  ] });
  const enter = tabEnter('grid', tab);
  if (tab !== 'map') {
    // The analysis as it was before the map view (its tab function; the request slider and the network card included).
    // S6 #2 / #7: a data centre gets the large-load cards on this tab and loses any generator-titled card.
    const key = GROUPS.some(g => g.id === tab) ? tab : 'capacity';
    let html;
    AS_TAB = true;
    try { html = TAB_FN[key](ctx); } finally { AS_TAB = false; }
    if (load) html = withDcCards(dropGeneratorOnly(html), 'grid', key, ctx);
    afterMapRender();
    return `<div class="mk-wb mk-tabwrap grd-wb">${bar}<div class="mk-tabpage${enter}" data-tab="${key}">${html}</div></div>`;
  }
  const shut = S.ui.gridSec || {}, nSet = G.reduce((t, g) => t + g.chips.length, 0);
  const inputs = `<aside class="mk-float mk-ff" aria-label="Grid inputs"><header class="mk-float-h"><h3>Grid inputs</h3><span class="mk-float-sub">${nSet ? `${nSet} set` : 'study values'} · a change redraws the map</span><button type="button" class="mk-x" data-act="mk-float" data-k="gridFilters" data-v="0" aria-label="Fold the Grid inputs" title="Fold">–</button></header>${G.map(g => `<section class="mk-sec" data-sec="${g.key}"${shut[g.key] ? ' data-shut' : ''}><button type="button" class="mk-sec-h" data-act="grid-sec" data-k="${g.key}" aria-expanded="${!shut[g.key]}"><span class="mk-sec-t">${esc(g.short)}</span><span class="mk-sec-r">${g.result}</span></button>${`<div class="mk-sec-b"><div class="kpis mk-sec-k">${fig(g.key, g.side).join('')}</div>${g.answer ? `<p class="mk-sec-a">${g.answer}</p>` : ''}${g.body}</div>`}</section>`).join('')}</aside>
    <button type="button" class="mk-float-min mk-ff-min" data-act="mk-float" data-k="gridFilters" data-v="1" title="Show the Grid inputs">Grid inputs${nSet ? ` · ${nSet} set` : ''} ▸</button>`;
  // The map: drawn at its own size, framed by the floats (views/mapview.js); a line or a row selects a facility (grid-fac).
  const Lf = { ...MAP_LAYERS0, ...(S.ui.mapLayers || {}) }, idx = new Map((data.index || []).map(b => [String(b.id), b]));
  const at = id => { const b = idx.get(String(id)); return b && ok(b.lat) && ok(b.lon) ? b : null; };
  const gensAt = new Map();
  for (const u of cx?.generators || []) { const b = at(u.bus_id); if (!b) continue; const e = gensAt.get(b.id) || { lat: b.lat, lon: b.lon, bus: b.name, mw: 0, units: [] }; e.mw += u.max_mw || 0; e.units.push({ name: u.name, mw: u.max_mw || 0, status: u.status }); gensAt.set(b.id, e); }
  const ibr = (v5?.ibr || []).map(u => { const b = at(u.bus_id); return b ? { lat: b.lat, lon: b.lon, name: u.name, mw: u.mw, status: u.status, mi: u.mi } : null; }).filter(Boolean);
  const shared = m ? m.fac.filter(l => /gm-lim/.test(l.cls) && l.a && l.b).map(l => ({ l, n: sharedOf(l.key) })).filter(x => ok(x.n) && x.n > 1).map(({ l, n }) => ({ lon: (l.a[0] + l.b[0]) / 2, lat: (l.a[1] + l.b[1]) / 2, text: `${fmt.int(n)} buses`, cls: 'g-shared' })) : [];
  let mapHtml, legend = '', toggles = '';
  if (m) {
    const spec = gridMapSpec(m, rec.value.substations || [], { gens: [...gensAt.values()], ibr, shared }, Lf);
    const drawn = frameMap('grid-map', mapGeom(), (gg, whole) => (whole ? geoMap : geoMapSvg)({ id: 'grid-map', width: gg.W, height: gg.H, extent: padExtent(boxOf(spec.box, 2), gg.W, gg.H, gg.pad), layers: spec.layers, title: spec.title }));
    mapHtml = `<div class="mk-map-wrap">${drawn}${inputs}${facilitiesFloat(m, sharedOf)}</div>`;
    legend = geoLegend(spec.legend);
    toggles = [['gNet', 'Network', m.net.length], ['gPre', 'Pre-existing overloads', m.counts.pre], ['gSub', 'Substations', (rec.value.substations || []).length], ['gRing', 'Rings 5 / 10 / 15 mi'], ['gShared', 'Shared-limit labels', shared.length], ['gGen', 'Generators (10 mi)', gensAt.size], ['gIbr', 'Inverter-based units', ibr.length]]
      .filter(([k, , c]) => !(['gShared', 'gGen', 'gIbr'].includes(k) && c === 0)) // nothing to place: no toggle
      .map(([k, l, c]) => `<label class="inline-check" style="margin:0 10px 0 0"><input type="checkbox" data-act="map-layer" data-k="${k}" ${Lf[k] ? 'checked' : ''}> ${esc(l)}${ok(c) ? ` (${fmt.int(c)})` : ''}</label>`).join('');
  } else mapHtml = `<div class="mk-map-wrap"><div class="map-wrap gx-map-pending">${mPend}</div>${inputs}</div>`;
  const nd = m?.counts.branchNotDrawn;
  const mapCard = card('mk-map', 'Network around the bus', `branches within ${m?.radius || 15} mi; this bus's limiting facilities and pre-existing overloads · click a line or a row to select`,
    `${toggles ? `<div class="chip-row" style="display:flex;flex-wrap:wrap;align-items:center">${toggles}</div>` : ''}${mapHtml}${legend}`,
    m ? `dim_branch (${m.counts.branches} within ${m.radius || 15} mi) placed from dim_bus latitude/longitude; fact_limiting_element for this bus. Tooltip rating: rate A for a base-case row, rate C for a contingency row. Pre-existing = |loading before the project| ≥ 100%. Not drawn: ${ok(nd) ? nd : 'not held'} branch(es) with an end inside ${m.radius || 15} mi whose other end has no coordinate${m.counts.facNotDrawn ? `, ${m.counts.facNotDrawn} facilit${m.counts.facNotDrawn === 1 ? 'y' : 'ies'} likewise` : ''}; ${m.counts.branchUnplaceable ?? 'not held'} branches ISO-wide have no placed end. Nothing is placed at 0,0. Shared-limit labels: the connection points whose element study lists the facility (context endpoint). Generators and inverter-based units are drawn at their bus (bus index). Scroll to zoom, drag to pan.` : '',
    m?.selected ? '<button type="button" class="tiny" data-act="ui" data-k="gfac" data-v="">Clear selection</button>' : '',
    { depth: 'screen', trace: 'g-netmap', answer: m ? netAnswer(m) + (m.selected ? ` Selected: ${B(m.selected.label)}${m.selected.drawn ? '' : ' (not drawn)'}.` : '') : '' });
  const fold = v => (v === '0' ? '0' : v === '1' ? '1' : 'auto');
  const answer = [firstAnswer(P.capacity.cards), firstAnswer(P.cost.cards)].filter(Boolean).join(' ');
  afterMapRender('grid-map');
  // The Map tab's one next step is the cost analysis's: deposits in Queue, or the load case in Economics.
  return `<div class="mk-wb grd-wb" data-ff="${fold(S.ui.gridFilters)}" data-fl="${fold(S.ui.gridList)}">
    ${bar}
    <div class="mk-mappage${enter}">
    ${answer ? `<p class="card-answer mk-wb-answer">${answer}</p>` : ''}
    <div class="kpis">${G.flatMap(g => fig(g.key, g.top)).join('')}</div>
    ${P.capacity.pre}${P.capacity.mid}
    ${mapCard}
    ${P.cost.next}
    </div>
  </div>`;
}

// Document-level and registered once (the board is rebuilt on every render): hovering a facility row lights its line on
// the Map tab's map.
if (typeof document !== 'undefined') {
  const lit = k => { for (const l of document.querySelectorAll('svg[data-map="grid-map"] .m-hov')) l.classList.remove('m-hov'); if (k) for (const l of document.querySelectorAll(`svg[data-map="grid-map"] line[data-v="${CSS.escape(k)}"]`)) l.classList.add('m-hov'); };
  document.addEventListener('pointerover', e => { const tr = e.target.closest?.('.grd-wb .mk-fl tr[data-fk]'); if (tr) lit(tr.dataset.fk); });
  document.addEventListener('pointerout', e => { const tr = e.target.closest?.('.grd-wb .mk-fl tr[data-fk]'); if (tr && !tr.contains(e.relatedTarget)) lit(null); });
}
