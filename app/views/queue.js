// Queue dashboard: what could change cost, timing or commitments.
// Data (provenance on every card):
//   solved-case set  = the 110 queue positions the planning study modelled: unified DB dim_queue (primary), via
//                      /api/x/queue/study/all; the Studio copy (data/queue.json) is compared and differences noted.
//   public register  = ISO-NE public queue, 1,751 records (GridSense store acquired.queue + POI match), read-only
//                      extract in data/queue-register.json (plan/extract_queue.py).
//   context          = unified dim_retirement, dim_transmission_upgrade, dim_substation_upgrade, dim_generator.
// Rules in ../queuecore.js over ../rules/isone.js (S3: ISO-NE Schedule 22 profile by default, every figure cited);
// rule widgets in ./queue-rules.js; traces in ./queue-trace.js.
import {
  nearby, commitments, scheduleBand, PROFILE, profileOf, queueInputs, NAME_MATCH_MAX_MI, miles, registerRows, requestedMW, fuelGroup,
  outcomesBy, vintages, durationsObserved, summary, projectedDurations, registerNear, studyStatusNow, sizeBand,
  depositCurve, crossTab, REG_STATUS, ratioDirs, requestRatios, serviceGroup, SERVICE_GROUPS, penaltyExemptions, cashApplies, materialModChecklist, queueAhead,
} from '../queuecore.js';
import * as RX from '../rules/isone.js';
import { profileSwitch, citeLine, costToEnterBody, siteControlBody, depositNarrative } from './queue-rules.js';
import { traceRatios, traceServiceMix, traceExemptions } from './queue-trace-v5.js';
import { withDcCards, dropGeneratorOnly } from './grid-dc.js';
import { caseTable, binding } from '../gridrules.js';
import { fmt } from '../basis.js';
import * as C from '../charts.js';
import { geoMap } from '../geomap.js';
import { queueMapSpec } from './queue-map.js';
import * as T from './queue-trace.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const kpi = (label, value, unit, note) => `<div class="kpi${value === 'not held' ? ' nh' : ''}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
// Depth, trace and provenance per card (view contract): [title pattern, minimum depth, trace id, chips]. First match wins.
const CARD_META = [
  [/^Requests around/, 'screen', 'q-cluster', ''], [/^Placement and join/, 'review', 'q-cluster', 'geo-proxy'], [/ratio|vs the export limit/i, 'screen', 'q-ratio', ''],
  [/^Service type/, 'review', 'q-service', ''], [/^Requested MW by type/, 'review', 'q-cluster', ''], [/^Requested vs modelled/, 'review', 'q-cluster', 'modelled'],
  [/^Request table/, 'study', 'q-cluster', ''], [/^Register history/, 'review', 'q-reg-near', 'geo-proxy'], [/^Solved-case set by request/, 'review', '', ''],
  [/^Queue crowding/, 'review', '', ''], [/^Register requests within/, 'study', 'q-reg-near', 'geo-proxy'],
  [/^Timing inputs/, 'review', 'q-schedule', 'assumption'], [/^Study steps/, 'screen', 'q-schedule', ''], [/^Observed|^Projected: request/, 'review', 'q-durations', ''],
  [/^Has it got slower/, 'review', 'q-durations', ''], [/^Clocks against/, 'review', 'q-durations', ''], [/^Projected in-service dates/, 'review', '', ''], [/^Nearby delivery timeline/, 'study', '', ''],
  [/^Cost to enter/, 'screen', 'q-deposit', ''], [/^Site control at request/, 'screen', 'q-cash', ''], [/^Inputs/, 'review', 'q-cash', 'assumption'], [/^Cash posted by phase/, 'screen', 'q-cash', ''], [/^Forfeit exposure/, 'review', 'q-cash', ''], [/^By phase/, 'study', 'q-cash', ''],
  [/^Penalty exemptions/, 'review', 'q-exempt', 'assumption'], [/^Entry cash by project size/, 'review', 'q-deposit', ''], [/^Deposit tiers/, 'study', 'q-deposit', ''],
  [/^How often requests of each size/, 'review', 'q-size-band', ''], [/^Outcomes by size band/, 'study', 'q-size-band', ''], [/^Cash and commitments/, 'screen', '', 'not-held'],
  [/^What changed since/, 'screen', 'q-study-now', ''], [/^Changes near here/, 'review', 'q-study-now', ''], [/^Register trends/, 'review', 'q-changes', ''], [/^Completion and withdrawal/, 'review', 'q-changes', ''],
  [/^Completion by resource/, 'review', 'q-type', ''], [/^Outcomes by resource/, 'study', 'q-type', ''], [/^Late-stage/, 'review', '', ''], [/^Additions, retirements/, 'review', 'q-timeline', ''],
  [/^Approved upgrades/, 'study', 'q-timeline', ''], [/^Delivery dependencies/, 'review', '', ''], [/^Queue state in/, 'study', '', ''], [/^Material-modification/, 'review', '', 'not-held'],
];
const metaOf = title => CARD_META.find(([rx]) => rx.test(title)) || [null, 'review', '', ''];
// answer: the card's one computed sentence (trusted HTML from esc'd values; <b> marks the key numbers).
const card = (cls, title, sub, body, foot = '', tools = '', answer = '') => { const [, depth, tr, chips] = metaOf(title); return `<section class="card ${cls}" data-depth="${depth}"${tr ? ` data-trace="${tr}"` : ''}${chips ? ` data-chips="${chips}"` : ''}><header class="card-h"><h3>${esc(title)}</h3>${sub ? `<span class="card-sub">${esc(sub)}</span>` : ''}${tools ? `<div class="card-tools">${tools}</div>` : ''}</header><div class="card-b">${answer ? `<p class="card-answer">${answer}</p>` : ''}${body}</div>${foot ? `<footer class="card-f">${foot}</footer>` : ''}</section>` };
const B = v => `<b>${esc(v)}</b>`;
const more = inner => `<details class="more-ctl"><summary>More options</summary>${inner}</details>`;
const nextStep = (text, stage, tab, btn = 'Open') => `<div class="next-step"><span role="link" tabindex="0" class="clickable" data-act="goto" data-v="${esc(stage)}" data-tab="${esc(tab)}">Next: ${text} →</span></div>`;
const table = (head, rows, empty = 'No rows.') => (rows.length ? `<div class="table-wrap"><table class="dense sortable"><thead><tr>${head.map(h => `<th${h.startsWith('#') ? ' class="num"' : ''}>${esc(h.replace(/^#/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<div class="empty">${esc(empty)}</div>`);
const td = (v, num) => `<td${num ? ' class="num"' : ''}>${esc(v)}</td>`;
const details = (assumptions, evidence) => `<details><summary>Assumptions</summary>${assumptions}</details><details><summary>Evidence and sources</summary>${evidence}</details>`;
const usd = v => (ok(v) ? fmt.money(v) : 'not held');
const pct = v => (ok(v) ? fmt.pct(100 * v) : 'not held');
const yrs = v => (ok(v) ? `${v.toFixed(1)} yr` : 'not held');
const mi = v => (ok(v) ? `${v.toFixed(1)} mi` : '—');
const short = (s, n = 48) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const SERVICE = { CNR: 'Capacity', NR: 'Energy-only' };
const RES = { SUN: 'Solar', WND: 'Wind', WAT: 'Hydro', BAT: 'Storage', ES: 'Storage', 'SUN BAT': 'Solar + storage', 'WAT BAT': 'Hydro + storage', NG: 'Gas', 'DFO NG': 'Oil / gas', 'NG SUN BAT': 'Gas + solar + storage', OTH: 'Other' };
const res = r => RES[r] || r || 'not stated';
const STUDY_STATUS = ['Under initial study', 'SIS documet posted', 'FAC in progress', 'IA in progress', 'IA executed'];
const stLabel = s => String(s || '').replace('documet', 'document');
const NOW = { W: 'Withdrawn', C: 'In service', A: 'Active', missing: 'Not found' };
const T0 = { n: 0, W: 0, C: 0, A: 0, other: 0, mw: 0, mwHeld: 0, completion: null, withdrawnShare: null };
const LATE = /IA executed|FAC|IA in progress/i;
const sumMW = xs => xs.reduce((t, x) => t + (x.q.max_mw || 0), 0);
const nhc = v => (v == null ? 'not held' : v);

export const QUEUE = {
  key: 'queue',
  question: 'What could change cost, timing or commitments?',
  lede: 'Queue requests near the project, what happened to requests like them, study clocks against observed durations, and the cash the interconnection process asks you to post. Nearby requests are context, not proof that they share your limits.',
  tabs: [
    { id: 'cluster', label: 'Queue & cluster' },
    { id: 'schedule', label: 'Schedule & milestones' },
    { id: 'cash', label: 'Cash & commitments' },
    { id: 'changes', label: 'Changes & risk' },
  ],
  needsQueue: true,
};

// ---------- Data: unified study set + public register (loaded once, then the page re-renders) ----------
const X = { study: null, reg: null, rows: null, err: null, loading: false, set: null, derived: null };
const getJson = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${url} ${r.status}`))));
function ensureExt() {
  if (X.loading || X.err || (X.study && X.rows)) return;
  X.loading = true;
  Promise.all([getJson('./api/x/queue/study/all'), getJson('./data/queue-register.json')])
    .then(([s, r]) => { X.study = s; X.reg = r; X.rows = registerRows(r).map(x => ({ ...x, mwReq: requestedMW(x).mw })); })
    .catch(e => { X.err = e.message; })
    .finally(() => { X.loading = false; import('../app.js').then(m => (m.renderSoon || m.render)()); });
}

/** Unified dim_queue is primary; the Studio copy is compared field by field and differences are reported. */
function studySet(data) {
  if (X.set) return X.set;
  const copy = data.queue?.queue || [], cmap = new Map(copy.map(q => [q.queue_position, q]));
  const fixed = [], diffs = [];
  const rows = X.study.queue.map(q => {
    const c = cmap.get(q.queue_position);
    if (c) {
      for (const f of ['max_mw', 'summer_mw_modelled', 'light_mw_modelled', 'latitude', 'longitude']) if (ok(q[f]) !== ok(c[f]) || (ok(q[f]) && Math.abs(q[f] - c[f]) > 1e-3)) diffs.push(`Q${q.queue_position} ${f}`);
      for (const f of ['status', 'request_date', 'projected_is_date', 'resource_type', 'state']) if ((q[f] ?? null) !== (c[f] ?? null)) diffs.push(`Q${q.queue_position} ${f}`);
    }
    if (String(q.poi_name || '').includes('�') && c?.poi_name) { fixed.push(q.queue_position); return { ...q, poi_name: c.poi_name }; }
    return q;
  });
  const onlyCopy = copy.filter(q => !X.study.queue.some(u => u.queue_position === q.queue_position)).length;
  X.set = { rows, fixed, diffs, onlyCopy, copy };
  return X.set;
}
function derived(data) {
  if (X.derived) return X.derived;
  const set = studySet(data), rows = X.rows;
  const latestReq = rows.reduce((m, r) => (r.requested && r.requested > m ? r.requested : m), '');
  const cutoff = Number(latestReq.slice(0, 4)) - 6;
  const vint = vintages(rows);
  const mature = rows.filter(r => r.requested && Number(r.requested.slice(0, 4)) <= cutoff);
  const now = studyStatusNow(set.rows, rows), copyNow = studyStatusNow(set.copy, rows);
  const nowBy = new Map(now.rows.map(x => [x.q.queue_position, x]));
  const obs = durationsObserved(rows), proj = projectedDurations(set.rows);
  X.derived = { set, rows, latestReq, cutoff, vint, mature, now, copyNow, nowBy, obs, proj, asOf: X.reg.meta.latestUpdated,
    matureT: outcomesBy(mature, () => 'm')[0] || T0, allT: outcomesBy(rows, () => 'a')[0] || T0 };
  return X.derived;
}
const regNote = () => `public register (ISO-NE queue, ${fmt.int(X.reg.meta.records)} records, latest record update ${X.reg.meta.latestUpdated}; GridSense store, read-only extract)`;
function sourcesLine(dv) {
  const s = dv.set;
  const agree = s.diffs.length ? `the Studio copy differs on ${s.diffs.length} field(s): ${s.diffs.slice(0, 6).join(', ')}` : 'the Studio copy agrees on every number, date and status';
  return `<div class="notice"><b>Sources.</b> Solved-case set: unified DB <code>dim_queue</code>, ${fmt.int(s.rows.length)} positions (primary); ${esc(agree)}${s.fixed.length ? `; ${s.fixed.length} POI text(s) (Q${s.fixed.join(', Q')}) carry encoding damage in the unified DB and are shown from the Studio copy` : ''}. Public register: ${esc(regNote())}.</div>`;
}
const traceCard = (...parts) => `<section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculations</h3><span class="card-sub">formula, inputs, steps, checks and CSV for every figure on this tab</span></header><div class="card-b">${parts.join('')}</div></section>`;
const radiusTools = R => `<div class="segmented seg-sm" role="group" aria-label="Radius">${[5, 10, 25, 50].map(r => `<button data-act="ui" data-k="qRadius" data-v="${r}" class="${R === r ? 'active' : ''}">${r} mi</button>`).join('')}</div>`;

// ---------- Tab 1: Queue & cluster ----------
function tabCluster({ data, S, node }) {
  const dv = derived(data), set = dv.set, R = Number(S.ui.qRadius || 10);
  const list = nearby(set.rows, node, R), inR = list.filter(x => x.inRadius), nameOnly = list.length - inR.length;
  const all = nearby(set.rows, node, 1e5), nearest = all[0];
  const mw = sumMW(inR);
  const modelled = sumMW(inR.filter(x => x.inModel === 'modelled in summer study'));
  const notModelled = sumMW(inR.filter(x => x.inModel === 'not modelled'));
  const notHeld = sumMW(inR.filter(x => x.inModel === 'not held'));
  const regN = registerNear(dv.rows, node, R), regT = outcomesBy(regN.rows, () => 'x')[0] || T0;
  // Each fuel on its OWN case table (a data centre reads the import binding, never a solar export case).
  const t = caseTable(data.grid, S.nodeId, S.tech, Number(S.exportMW), Number(S.importMW)), ex = binding(t, 'export'), imB = binding(t, 'import');
  // P2 C30: MW ahead = within the radius, not in the solved summer case and not withdrawn in the register (queueAhead),
  // never every nearby MW (that double-counted the solved case and counted withdrawn requests).
  const ahead = queueAhead(list, { nowOf: q => dv.nowBy.get(q.queue_position) || { now: 'missing' } });
  const ratios = requestRatios(S.tech, { exportMW: Number(S.exportMW), importMW: Number(S.importMW), aheadMW: ahead.aheadMW }, { export: ex, import: imB });
  const r0 = ratios[0], projMW = r0.mw;
  const ratio = r0.dir === 'export' ? { mw: projMW, limit: r0.limit, value: r0.value, basis: `${r0.row?.label || 'binding case'} · ${r0.status}` }
    : { mw: null, limit: null, value: null, basis: 'a load has no export request: see the load-ratio trace (import ÷ import limit)' };
  // Service type: solved-case set within the radius + register records placed within it.
  const svcRows = [...inR.map(x => ({ src: 'solved-case', id: `Q${x.q.queue_position}`, code: x.q.interconnection_service_requested, group: serviceGroup(x.q.interconnection_service_requested), mw: x.q.max_mw })),
    ...regN.rows.map(r => ({ src: 'register', id: `QP${r.qp}`, code: r.serv, group: serviceGroup(r.serv), mw: r.mwReq }))];
  const svcChart = C.groupedBar(SERVICE_GROUPS.map(g => ({ label: g, values: ['solved-case', 'register'].map(src => { const v = svcRows.filter(r => r.src === src && r.group === g && ok(r.mw)); return v.length ? v.reduce((a, r) => a + r.mw, 0) : null; }) })), { series: ['Solved-case set', 'Public register'], fmt: v => `${v.toFixed(0)} MW`, title: `Requested MW by service type within ${R} mi`, height: 200, emptyText: `No request placed within ${R} mi.` });
  const svcIso = SERVICE_GROUPS.map(g => ({ g, n: dv.rows.filter(r => serviceGroup(r.serv) === g).length, mw: dv.rows.filter(r => serviceGroup(r.serv) === g && ok(r.mwReq)).reduce((a, r) => a + r.mwReq, 0) }));
  const summerBinds = /Summer peak/.test(ex.row?.label || '');
  const whatIf = S.ui.qWhatIf && ok(ex.value) && summerBinds ? ex.value - notModelled : null;
  const matchTxt = x => (x.inRadius ? x.match : 'name match, outside radius');
  const nowOf = q => dv.nowBy.get(q.queue_position);

  // Map (shared geoMap: live basemap, rings, request points by study status; register and model units underneath)
  const spec = queueMapSpec({ node, study: set.rows, register: dv.rows, generators: X.study.generators, R, statuses: STUDY_STATUS, stLabel,
    tips: { study: q => `<b>Q${esc(q.queue_position)}</b> ${esc(short(q.poi_name, 60))}<br>${esc(fmt.mw(q.max_mw))} · ${esc(res(q.resource_type))} · ${esc(stLabel(q.status))}<br>Register now: ${esc(NOW[nowOf(q)?.now] || 'not found')}`,
      register: r => `<b>QP ${esc(r.qp)}</b> ${esc(short(r.poi, 60))}<br>${esc(ok(r.mwReq) ? fmt.mw(r.mwReq) : 'MW not held')} · ${esc(r.fuel || 'fuel not stated')} · ${esc(REG_STATUS[r.status])}<br>requested ${esc(r.requested || '—')} · placed by ${esc(r.tier)}`,
      gen: g => `<b>${esc(g[1])}</b><br>${esc(ok(g[3]) ? fmt.mw(g[3]) : 'MW not held')} · bus ${esc(g[0])}` } });
  const mapHtml = spec.center ? geoMap({ id: 'queue-near', width: 760, height: 470, fit: { points: [spec.center], padMi: spec.padMi }, layers: spec.layers, legend: spec.legend, title: `Queue requests around ${node?.name || 'the bus'}` })
    : '<div class="notice">Not held: the bus has no coordinate, so nothing can be placed around it.</div>';

  // Placement / join confidence
  const cty = x => x.q.county && node?.county && String(x.q.county).toUpperCase() === String(node.county).toUpperCase() && x.q.state === node.state_code;
  const sameCounty = inR.filter(cty).length, sameState = inR.filter(x => !cty(x) && x.q.state === node?.state_code).length, otherState = inR.length - sameCounty - sameState;
  const tiers = {}; regN.rows.forEach(r => { tiers[r.tier] = (tiers[r.tier] || 0) + 1; });
  const placeRows = [
    ['Solved-case requests within the radius', inR.length, 'haversine distance from each request\'s own coordinate'],
    ['… in this county and state', sameCounty, `${node?.county || '—'}, ${node?.state_code || '—'}`],
    ['… elsewhere in this state', sameState, ''],
    ['… in another state', otherState, ''],
    [`Whole-word POI-name matches outside the radius (≤ ${NAME_MATCH_MAX_MI} mi)`, nameOnly, 'listed, not counted'],
    ...Object.entries(tiers).map(([k, v]) => [`Register records placed by POI match: ${k}`, v, 'matched substation\'s coordinate, copied']),
    ['Register records with no coordinate', regN.unplaced, `of ${fmt.int(dv.rows.length)}: in no radius count anywhere`],
  ].map(([a, b, c]) => `<tr><td class="wrap">${esc(a)}</td><td class="num">${fmt.int(b)}</td><td class="wrap muted">${esc(c)}</td></tr>`);

  // Type × status (nearby, study set)
  const typeKeys = [...new Set(inR.map(x => res(x.q.resource_type)))];
  const ts = crossTab(inR, x => res(x.q.resource_type), x => x.q.status, x => x.q.max_mw, { rows: typeKeys, cols: STUDY_STATUS });
  const typeStatus = C.stackedBar(ts.rows.map((r, i) => ({ label: r, values: ts.values[i] })), { series: STUDY_STATUS.map(stLabel), fmt: v => `${v.toFixed(0)} MW`, title: `Requested MW by type and status within ${R} mi`, height: 220, emptyText: `No solved-case request within ${R} mi. Only ${fmt.int(set.rows.length)} of ${fmt.int(dv.rows.length)} register requests are in the solved case, so this does not mean the area is empty.` });
  // Requested vs modelled by status
  const stIn = STUDY_STATUS.filter(s => inR.some(x => x.q.status === s));
  const reqMod = C.groupedBar(stIn.map(s => { const g = inR.filter(x => x.q.status === s); return { label: stLabel(s), values: [sumMW(g), g.reduce((t2, x) => t2 + (ok(x.q.summer_mw_modelled) ? x.q.summer_mw_modelled : 0), 0), g.reduce((t2, x) => t2 + (ok(x.q.light_mw_modelled) ? x.q.light_mw_modelled : 0), 0)] }; }), { series: ['Requested', 'Modelled · summer', 'Modelled · light load'], fmt: v => `${v.toFixed(0)} MW`, title: `Requested vs modelled within ${R} mi`, height: 220, emptyText: `No solved-case request within ${R} mi.` });
  // Register history near here by entry year × outcome
  const rv = vintages(regN.rows);
  const regVint = C.stackedBar(rv.map(v => ({ label: String(v.year), values: [v.W || null, v.C || null, v.A || null] })), { series: ['Withdrawn', 'In service', 'Active'], fmt: v => `${v.toFixed(0)}`, title: `Register requests within ${R} mi by entry year`, height: 220, emptyText: `No register record is placed within ${R} mi (${fmt.int(regN.unplaced)} register records carry no coordinate).` });
  // Solved-case set ISO-wide by request year × type (Studio QX-40 year × fuel)
  const yk = [...new Set(set.rows.map(q => Number(String(q.request_date).slice(0, 4))))].sort((a, b) => a - b);
  const fk = [...new Set(set.rows.map(q => fuelGroup(q.resource_type)))];
  const yf = crossTab(set.rows, q => Number(String(q.request_date).slice(0, 4)), q => fuelGroup(q.resource_type), q => q.max_mw, { rows: yk, cols: fk });
  const setVint = C.stackedBar(yf.rows.map((y, i) => ({ label: String(y), values: yf.values[i] })), { series: fk, fmt: v => `${v.toFixed(0)} MW`, title: 'Solved-case set by request year and type (ISO-NE)', height: 220 });
  // State crowding (Studio Q-11)
  const st = node?.state_code, inState = set.rows.filter(q => q.state === st);
  const sk = [...new Set(inState.map(q => res(q.resource_type)))];
  const sc = crossTab(inState, q => res(q.resource_type), q => q.status, q => q.max_mw, { rows: sk, cols: STUDY_STATUS });
  const crowd = C.stackedBar(sc.rows.map((r, i) => ({ label: r, values: sc.values[i] })), { series: STUDY_STATUS.map(stLabel), fmt: v => `${v.toFixed(0)} MW`, title: `Queue crowding in ${st || 'this state'} (state-level)`, height: 220, emptyText: `No solved-case request in ${st || 'this state'}.` });

  // Request table + drawers
  const drawers = list.map(x => { const n = nowOf(x.q); return `<template data-drawer="q-${esc(x.q.queue_position)}" data-title="Queue #${esc(x.q.queue_position)}"><dl>
    <dt>Point of interconnection</dt><dd>${esc(x.q.poi_name)}</dd><dt>Requested</dt><dd>${fmt.mw(x.q.max_mw)} · ${esc(res(x.q.resource_type))}</dd>
    <dt>Service</dt><dd>${esc(SERVICE[x.q.interconnection_service_requested] || 'not held')}</dd><dt>Status in the solved case</dt><dd>${esc(stLabel(x.q.status))}</dd>
    <dt>Register now</dt><dd>${esc(NOW[n?.now] || 'not found')}${n?.r?.wd_date ? ` (withdrawn ${esc(n.r.wd_date)})` : ''}${n?.r?.ia_status ? ` · IA ${esc(n.r.ia_status)}` : ''}</dd>
    <dt>Requested on</dt><dd>${esc(x.q.request_date)} (${esc(x.era)})</dd><dt>Projected in service</dt><dd>${esc(x.q.projected_is_date || 'not held')}</dd>
    <dt>Summer / light-load study MW</dt><dd>${ok(x.q.summer_mw_modelled) ? fmt.mw(x.q.summer_mw_modelled) : 'not held'} / ${ok(x.q.light_mw_modelled) ? fmt.mw(x.q.light_mw_modelled) : 'not held'} (${esc(x.inModel)}${x.q.summer_mw_modelled < 0 ? ', charging' : ''})</dd>
    <dt>Distance</dt><dd>${mi(x.distance)} · matched by ${esc(matchTxt(x))}</dd><dt>County</dt><dd>${esc(x.q.county || '')} ${esc(x.q.state || '')}</dd></dl>
    <p class="audit-note">Being nearby does not show that this request loads the same facilities as your project.</p></template>`; }).join('');
  const reqRows = list.map(x => { const n = nowOf(x.q); return `<tr class="clickable" tabindex="0" data-open-drawer="q-${esc(x.q.queue_position)}"><td>${esc(x.q.queue_position)}</td><td class="wrap">${esc(short(x.q.poi_name, 70))}</td><td class="num">${fmt.mw(x.q.max_mw)}</td><td>${esc(res(x.q.resource_type))}</td><td>${esc(serviceGroup(x.q.interconnection_service_requested))}</td><td>${esc(stLabel(x.q.status))}</td><td>${n?.now === 'W' ? '<span class="pill warn">Withdrawn</span>' : esc(NOW[n?.now] || 'not found')}</td><td>${esc(x.q.request_date)}</td><td>${esc(x.q.projected_is_date || 'not held')}</td><td class="num">${mi(x.distance)}</td><td>${x.inRadius ? esc(x.match) : `<span class="pill warn">${esc(matchTxt(x))}</span>`}</td><td><span class="pill ${x.inModel.startsWith('modelled') ? 'good' : ''}">${esc(x.inModel)}</span></td></tr>`; });
  const regRows = regN.rows.slice(0, 60).map(r => `<tr><td>${esc(r.qp)}</td><td class="wrap">${esc(short(r.poi, 56))}</td><td>${esc(r.fuel || 'not stated')}</td><td class="num">${ok(r.mwReq) ? fmt.mw(r.mwReq) : 'not held'}</td><td>${esc(REG_STATUS[r.status] || r.status)}</td><td>${esc(r.requested || '—')}</td><td>${esc(r.status === 'W' ? (r.wd_date || 'not dated') : (r.op_date || '—'))}</td><td>${esc(r.tier)}</td><td class="num">${mi(r.distance)}</td></tr>`);

  const unlinked = dv.rows.length - set.rows.length;
  return `${drawers}${sourcesLine(dv)}
    <div class="kpis">
      ${kpi(`Solved-case requests within ${R} mi`, fmt.int(inR.length), '', `${fmt.mw(mw)} requested${nameOnly ? ` · ${fmt.int(nameOnly)} name match${nameOnly > 1 ? 'es' : ''} outside the radius listed, not counted` : ''}`)}
      ${kpi('Modelled in the summer study case', fmt.mw(modelled), '', `Of the requests within ${R} mi (storage may be modelled charging)${notModelled ? ` · ${fmt.mw(notModelled)} not modelled` : ''}${notHeld ? ` · ${fmt.mw(notHeld)} study status not held` : ''}`)}
      ${kpi('Nearest solved-case request', nearest ? mi(nearest.distance) : 'not held', '', nearest ? `Q${nearest.q.queue_position} · ${res(nearest.q.resource_type)} · ${stLabel(nearest.q.status)}` : 'No located request')}
      ${kpi(`Register requests within ${R} mi`, fmt.int(regT.n), '', `${regT.W} withdrawn · ${regT.C} in service · ${regT.A} active · placed by POI name`)}
      ${kpi('Register requests not placed', fmt.int(regN.unplaced), '', `of ${fmt.int(dv.rows.length)} carry no coordinate; ${fmt.int(unlinked)} are outside the solved case: the real unknown`)}
    </div>
    <div class="cards">
      ${card('c-8 r-2', `Requests around ${node?.name || 'the bus'}`, `rings at 5, 10 and 25 mi${[5, 10, 25].includes(R) ? '' : ` and ${R} mi`}; dots = solved-case set (size ∝ √MW), rings = public register, squares = operating model units`, mapHtml, `Unified dim_queue, dim_generator · register placed by POI-name → substation coordinate (copied, not surveyed) · not placed (no coordinate): ${spec.notPlaced.study} solved-case, ${fmt.int(spec.notPlaced.register)} register · scroll to zoom, drag to pan`, radiusTools(R),
        `${B(inR.length)} solved-case request${inR.length === 1 ? '' : 's'} (${B(fmt.mw(mw))}) and ${B(regT.n)} register records lie within ${R} mi${nearest ? `; the nearest solved-case request is ${B(mi(nearest.distance))} away` : ''}.`)}
      ${card('c-4', 'Placement and join confidence', 'how each count was placed; no queue record carries a bus key', table(['How placed', '#Count', 'Basis'], placeRows), `Radius ${R} mi. County agreement is the placement check the Studio used (Q-01).`, '', `${B(inR.length)} placed by their own coordinate (${B(sameCounty)} in this county); ${B(fmt.int(regN.unplaced))} register records carry no coordinate and are in no count.`)}
      ${card('c-4', S.tech === 'datacenter' ? 'Load ratio: import request vs the import limit' : 'MW ahead + this project vs the export limit', S.tech === 'datacenter' ? 'request ÷ element-study import limit' : 'MW ahead = not in the solved case, not withdrawn; arithmetic, not a study', `<div class="kpis">${ratios.map(r => kpi(r.label, ok(r.value) ? pct(r.value) : 'not held', '', ok(r.value) ? `(${r.nearby != null ? `${fmt.mw(r.nearby)} ahead + ` : ''}${fmt.mw(r.mw)}) ÷ ${fmt.mw(r.limit)} · ${r.row?.label || ''} ${r.status}` : `${r.dir} limit not held (${r.status})`)).join('')}</div>
        ${S.tech === 'datacenter' ? '' : more(`<label class="inline-check"><input type="checkbox" data-act="q-whatif" ${S.ui.qWhatIf ? 'checked' : ''}> What-if: subtract nearby requests not modelled from the export limit</label>`)}
        ${S.ui.qWhatIf && S.tech !== 'datacenter' ? `<div class="notice warn">What-if only: ${ok(whatIf) ? `${fmt.mw(ex.value)} − not-modelled MW (${fmt.mw(notModelled)}) = <b>${fmt.mw(whatIf)}</b>` : summerBinds ? 'export limit not established' : 'not available: the modelled tag covers the summer case only, and a different case binds here'}. It assumes one-for-one loading of the same facilities, which is not established, and is not a headroom result.</div>` : ''}`, `Limit from Grid rules on this fuel's own cases (${esc(ratios.map(r => r.dir).join(' + '))}). A withdrawal is never assumed to free capacity.`, '', ok(r0.value) ? `${esc(r0.label)}: ${B(pct(r0.value))} of the ${esc(r0.dir)} limit; distance arithmetic, never a pass.` : `The ${esc(r0.dir)} limit is not held (${esc(r0.status)}), so the ratio is not held.`)}
      ${card('c-6', 'Service type: capacity (CNR) vs energy-only (NR)', `requested MW by interconnection service within ${R} mi`, svcChart + table(['Service', '#Register records (ISO-NE)', '#Register MW'], svcIso.map(x => `<tr><td>${esc(x.g)}</td><td class="num">${fmt.int(x.n)}</td><td class="num">${fmt.mw(x.mw)}</td></tr>`)), 'dim_queue interconnection_service_requested; register "serv" as published (MIS, CNI, NI, ES kept as other codes). CNR requests can auto-downgrade to NR (research note, not in the vault).', '', svcRows.length ? `Within ${R} mi: ${SERVICE_GROUPS.map(g => { const v = svcRows.filter(r => r.group === g && ok(r.mw)); return v.length ? `${esc(g)} ${B(fmt.mw(v.reduce((a2, r) => a2 + r.mw, 0)))}` : ''; }).filter(Boolean).join(', ')}.` : `No request is placed within ${R} mi.`)}
      ${card('c-6', 'Requested MW by type and status', `solved-case requests within ${R} mi`, typeStatus, 'Unified dim_queue · status words as published', '', inR.length ? `${B(fmt.mw(mw))} requested within ${R} mi across ${B(typeKeys.length)} resource type${typeKeys.length === 1 ? '' : 's'}.` : `No solved-case request within ${R} mi.`)}
      ${card('c-6', 'Requested vs modelled MW', 'the study\'s own dispatched MW per position, summer and light-load cases', reqMod, 'Negative modelled MW = storage charging in that case. Modelled MW records inclusion in a study, not electrical participation at this bus.', '', `${B(fmt.mw(modelled))} of ${B(fmt.mw(mw))} requested within ${R} mi is modelled in the summer study case.`)}
      ${card('c-12', 'Request table', `${list.length} solved-case request(s) within ${R} mi or matched by POI name; click a row for detail`, list.length ? table(['Queue #', 'POI', '#MW', 'Type', 'Service', 'Status (study)', 'Register now', 'Requested', 'Projected in service', '#Distance', 'Match', 'In study'], reqRows) : `<div class="empty"><strong>No solved-case request within ${R} mi</strong>Only ${fmt.int(set.rows.length)} of ${fmt.int(dv.rows.length)} register requests are in the solved case, so this does not mean the area is empty. See the register history below.</div>`, `"Register now" joins each position to the ${esc(regNote())} on QP + request date.`, '', `${B(list.length)} request${list.length === 1 ? '' : 's'} listed; ${B(list.filter(x => nowOf(x.q)?.now === 'W').length)} have since withdrawn.`)}
      ${card('c-6', 'Register history near here', `public-register requests within ${R} mi by entry year and outcome`, regVint, 'Register records placed by POI-name match; recent entry years have had less time to withdraw.', '', `Within ${R} mi: ${B(regT.W)} withdrawn, ${B(regT.C)} in service, ${B(regT.A)} active.`)}
      ${card('c-6', 'Solved-case set by request year', 'all 110 positions, requested MW by EIA fuel group (Studio queue trends)', setVint, 'Unified dim_queue. A request is not a build: no delivery rate is applied.', '', `${B(set.rows.length)} positions requesting ${B(fmt.mw(sumMW(set.rows.map(q => ({ q })))))} in total.`)}
      ${card('c-6', `Queue crowding in ${st || 'this state'}`, 'state-level: resource × status, requested MW', crowd, `${fmt.int(inState.length)} solved-case positions in ${esc(st || '—')} · ${fmt.mw(inState.reduce((a, q) => a + (q.max_mw || 0), 0))}`, '', `${B(inState.length)} solved-case positions in ${esc(st || 'this state')} request ${B(fmt.mw(inState.reduce((a, q) => a + (q.max_mw || 0), 0)))}.`)}
      ${card('c-6', 'Register requests within the radius', `nearest ${Math.min(60, regN.rows.length)} of ${regN.rows.length}; withdrawn date or op date as published`, table(['QP', 'POI', 'Fuel', '#MW', 'Outcome', 'Requested', 'Withdrawn / op date', 'Placed by', '#Distance'], regRows, `No register record placed within ${R} mi.`), 'MW = net, else summer; neither = not held.', '', regN.rows.length ? `${B(regN.rows.length)} register records placed within ${R} mi; the nearest is ${B(mi(regN.rows[0].distance))} away.` : `No register record is placed within ${R} mi.`)}
      ${traceCard(T.traceCluster(node, list, R, { total: mw, modelled, notModelled, notHeld, nameOnly, unplaced: regN.unplaced, registerTotal: dv.rows.length, setSize: set.rows.length }, ratio), T.traceRegisterNear(node, R, regN, regT, dv.rows.length), traceRatios(S.tech, ratios, R, ahead), traceServiceMix(SERVICE_GROUPS, svcRows, R),
        details(`<p>Match: great-circle distance ≤ the radius, or every distinctive word of the bus name appears as a whole word in the POI name and the request is within ${NAME_MATCH_MAX_MI} mi. Only requests within the radius are counted. "Modelled" = summer-case MW is non-zero (negative = storage charging).</p><p>Cluster era = requested on or after ${esc(PROFILE.clusterEraStart || "not held")} (ISO-NE Order 2023 compliance, ${esc(PROFILE.clusterEraSource || "")}). The register marks ${fmt.int(dv.rows.filter(r => r.cluster).length)} records as the transitional cluster (TCS); cluster membership of the solved-case set is not held.</p>`, `<p>${esc(PROFILE.source)}. ${esc(X.reg.meta.tierNote)}</p>`))}
    </div>
    ${nextStep('see when these requests and yours could finish in <b>Queue › Schedule &amp; milestones</b>', 'queue', 'schedule')}`;
}

// ---------- Tab 2: Schedule & milestones ----------
function tabSchedule({ data, S, node }) {
  const dv = derived(data), q = queueInputs(S), prof = profileOf(q.profile);
  const band = scheduleBand(q.windowClose, { restudy: q.restudy, facilities: q.facilities, profile: q.profile });
  const start = band ? band.rows.find(r => r.key === 'window_close').date : (q.windowClose || 'not held');
  const winCite = RX.cite('interconnection.schedule22.request_window');
  const facLabel = q.facilities === 'waived' ? 'facilities study waived' : `${q.facilities}-day facilities study`;
  const sObs = summary(dv.obs.service.map(x => x.years)), sWd = summary(dv.obs.withdraw.map(x => x.years)), sProj = summary(dv.proj.values.map(x => x.years));
  const R = Number(S.ui.qRadius || 10), cod = Number(S.ui.qCod) || null;
  const near = nearby(dv.set.rows, node, Math.max(R, 25)).filter(x => x.inRadius);
  const asOf = dv.asOf;
  const cls = q => (!q.projected_is_date ? 'undated' : q.projected_is_date < asOf ? 'past' : cod && Number(q.projected_is_date.slice(0, 4)) > cod ? 'after' : cod ? 'before' : 'ahead');
  const CLS = { past: `Already past at ${asOf}`, before: `On or before ${cod}`, after: `After ${cod}`, ahead: 'Ahead (no target COD set)', undated: 'Not dated' };
  const fy = d => { const t = Date.parse(d); return ok(t) ? 1970 + t / (365.25 * 864e5) : null; };
  // gantt: one bar per deadline step, from the previous deadline to this one (dates are tariff deadlines)
  const tasks = (band?.rows || []).filter(r => r.kind === 'deadline').map(r => ({ label: r.step, start: Date.parse(r.from), end: Date.parse(r.date), note: `${r.used ?? ''}${r.used != null ? ' · ' : ''}${r.cite?.src || ''}` }));
  const ganttHtml = tasks.length && Number.isFinite(tasks[0].start) ? C.gantt(tasks, { title: 'Deadline chain' }) : '';
  const clockRows = (band?.rows || []).map(r => `<tr${r.key === 'cluster_report' ? ' class="hi"' : ''}><td>${esc(r.step)}</td><td class="num">${r.used == null ? '—' : esc(r.used)}</td><td>${esc(r.kind === 'deadline' ? r.from : '—')}</td><td><b>${esc(r.date)}</b></td><td class="wrap">${esc(r.note || '')}</td><td class="wrap">${citeLine(r.cite)}</td></tr>`);
  const facBtn = (v, label) => `<button data-act="ui" data-k="qFac" data-v="${v}" class="${String(q.facilities) === v ? 'active' : ''}">${esc(label)}</button>`;
  // durations by entry period
  const per = outcomesBy(dv.obs.service.map(x => ({ ...x, status: 'C' })), x => Math.floor(Number(x.r.requested.slice(0, 4)) / 5) * 5).sort((a, b) => a.key - b.key)
    .map(o => { const s = summary(dv.obs.service.filter(x => Math.floor(Number(x.r.requested.slice(0, 4)) / 5) * 5 === o.key).map(x => x.years)); return { label: `${o.key}–${String(o.key + 4).slice(2)} (n ${s.n})`, s }; }).filter(p => p.s.n >= 5);
  const perChart = C.groupedBar(per.map(p => ({ label: p.label, values: [p.s.p25, p.s.p50, p.s.p75] })), { series: ['p25', 'Median', 'p75'], fmt: v => `${v.toFixed(1)} yr`, title: 'Request → in service by entry period (register)', height: 220 });
  const qRow = (name, s, basis) => `<tr><td class="wrap">${esc(name)}</td><td class="num">${fmt.int(s.n)}</td>${['p10', 'p25', 'p50', 'p75', 'p90'].map(k => `<td class="num">${yrs(s[k])}</td>`).join('')}<td class="wrap muted">${esc(basis)}</td></tr>`;
  const qTable = `<div class="table-wrap"><table class="dense"><thead><tr><th>Measure</th><th class="num">n</th><th class="num">p10</th><th class="num">p25</th><th class="num">Median</th><th class="num">p75</th><th class="num">p90</th><th>Basis</th></tr></thead><tbody>
    <tr><td class="wrap">Tariff deadline chain from the window close</td><td class="num">—</td><td colspan="5" class="num">${band ? (band.deadlineDays / 365.25).toFixed(2) : '—'} yr (${band ? band.deadlineDays : '—'} days to ${band ? esc(band.endStep.toLowerCase()) : '—'}; tariff deadlines (latest dates), not durations)</td><td class="wrap muted">${esc(prof.label)} (rule)</td></tr>
    ${qRow('Request → in service (observed)', sObs, 'register, in service; includes construction')}${qRow('Request → withdrawal (observed)', sWd, 'register, withdrawn')}${qRow('Request → projected in service', sProj, 'solved-case set: applicants\' projections, not actuals')}</tbody></table></div>`;
  const pts = near.map(x => ({ x: fy(x.q.projected_is_date), y: x.q.max_mw, label: `Q${x.q.queue_position} ${short(x.q.poi_name, 30)}`, group: CLS[cls(x.q)] })).filter(p => ok(p.x));
  const tl = C.scatter(pts, { xLabel: 'Projected in service', yLabel: 'Requested MW', fmt: v => `${v.toFixed(0)} MW`, xfmt: v => String(Math.floor(v)), title: 'Projected in-service dates near here', height: 220, emptyText: `No dated solved-case request within ${Math.max(R, 25)} mi.` });
  const tlRows = near.map(x => { const n = dv.nowBy.get(x.q.queue_position); return `<tr><td>${esc(x.q.projected_is_date || 'not held')}</td><td>Q${esc(x.q.queue_position)}</td><td class="wrap">${esc(short(x.q.poi_name, 44))}</td><td>${esc(res(x.q.resource_type))}</td><td class="num">${fmt.mw(x.q.max_mw)}</td><td>${esc(stLabel(x.q.status))}</td><td>${n?.now === 'W' ? '<span class="pill warn">Withdrawn</span>' : esc(NOW[n?.now] || 'not found')}</td><td>${esc(CLS[cls(x.q)])}</td><td class="num">${mi(x.distance)}</td></tr>`; });
  return `${sourcesLine(dv)}
    <div class="kpis">
      ${kpi('Cluster Study Report deadline', band ? band.deadline : 'not held', '', band ? `a deadline, not an earliest date · ${band.deadlineCite.text} · effective ${band.deadlineCite.effective}` : 'the window-close date is not valid')}
      ${kpi('End of this path', band ? band.end : 'not held', '', band ? `${band.endStep} (${q.restudy ? 'one restudy' : 'no restudy'}, ${facLabel})` : '')}
      ${kpi('Observed: request → in service', yrs(sObs.p50), '', `median of ${fmt.int(sObs.n)} register records · p25–p75 ${yrs(sObs.p25)}–${yrs(sObs.p75)} · includes construction`)}
      ${kpi('Observed: request → withdrawal', yrs(sWd.p50), '', `median of ${fmt.int(sWd.n)} withdrawn register records`)}
      ${kpi('Projected: request → in service', yrs(sProj.p50), '', `median of ${fmt.int(sProj.n)} solved-case projections (applicants' dates, not actuals)`)}
    </div>
    <div class="cards">
      ${card('c-4', 'Timing inputs', 'the window close, the process profile and the path', `${profileSwitch(S)}<div class="form-grid">
        <label class="field">Cluster request window closes <span class="pill ${winCite.status === 'verified' ? 'good' : 'warn'}">${esc(winCite.status)}</span><input type="date" data-act="ui-text" data-k="qStart" value="${esc(band ? start : '')}"><span class="audit-note">Default: the ISO-NE 2026 window ${esc((RX.getRules()?.interconnection?.schedule22?.request_window?.window_2026 || []).join(' to '))}. ${citeLine(winCite)}.</span></label>
        <label class="field">Target COD year (your input)<input type="number" min="2025" max="2045" step="1" data-act="ui-text" data-k="qCod" value="${esc(S.ui.qCod || '')}" placeholder="not set"></label></div>
        <div class="segmented seg-sm" role="group" aria-label="Facilities study">${facBtn('waived', 'FS waived')}${facBtn('90', 'FS 90 d')}${facBtn('180', 'FS 180 d')}</div>
        <label class="inline-check"><input type="checkbox" data-act="q-flag" data-k="qRestudy" ${q.restudy ? 'checked' : ''}> Include one cluster restudy (more can follow)</label>`, `<span class="pill${prof.labelled ? ' warn' : ''}">${esc(prof.label)}</span> ${esc(prof.note)}`, '', `Window closes ${B(start)}; ${cod ? `target COD ${B(cod)}` : 'no target COD set'}; ${q.restudy ? 'one restudy' : 'no restudy'}; ${esc(facLabel)}.`)}
      ${card('c-8', 'Study steps', `tariff deadlines from the window close (${esc(prof.label)})`, `${ganttHtml}${table(['Step', '#Days', 'From', 'Deadline', 'Note', 'Rule'], clockRows)}`, `Every date is the latest the tariff allows, not a forecast. Business days are Mon–Fri with no holiday calendar. ${esc(band?.note || '')}`, '', band ? `The Cluster Study Report is due by ${B(band.deadline)} (${esc(band.deadlineCite.text)}); this path ends with ${esc(band.endStep.toLowerCase())} by ${B(band.end)}.` : 'Not held: the window-close date is not valid.')}
      ${card('c-4', 'Observed: request → in service', 'register records that reached operation (years)', C.histogram(dv.obs.service.map(x => x.years), { bins: 22, fmt: v => `${v.toFixed(1)} yr`, title: 'Register: request → in service (years)', height: 200 }), `Excluded and counted: ${dv.obs.excluded.serviceBeforeRequest} op date before the request (register defects), ${dv.obs.excluded.serviceUndated} undated.`, '', `Median ${B(yrs(sObs.p50))} from request to in service over ${B(fmt.int(sObs.n))} records (p25–p75 ${yrs(sObs.p25)}–${yrs(sObs.p75)}).`)}
      ${card('c-4', 'Observed: request → withdrawal', 'withdrawn register records (years)', C.histogram(dv.obs.withdraw.map(x => x.years), { bins: 24, fmt: v => `${v.toFixed(1)} yr`, title: 'Register: request → withdrawal (years)', height: 200 }), `${dv.obs.excluded.withdrawUndated} withdrawn records carry no withdrawal date and are left out.`, '', `Withdrawn requests left after a median ${B(yrs(sWd.p50))} (${B(fmt.int(sWd.n))} records).`)}
      ${card('c-4', 'Projected: request → in service', 'solved-case set: the register\'s projections, not actuals', C.histogram(dv.proj.values.map(x => x.years), { bins: 14, fmt: v => `${v.toFixed(1)} yr`, title: 'Solved-case set: request → projected in service (years)', height: 200 }), `${dv.proj.undated} undated · ${dv.proj.values.filter(x => x.q.projected_is_date < asOf).length} projected dates are already behind ${esc(asOf)} while the study status stayed open.`, '', `Applicants project a median ${B(yrs(sProj.p50))} from request to in service (${B(fmt.int(sProj.n))} positions); projections, not actuals.`)}
      ${card('c-6', 'Has it got slower?', 'observed request → in service quartiles by the year the request entered', perChart, 'Periods with fewer than 5 completed records are not drawn. Recent periods only include the fast completions so far (survivor bias), so they read short.', '', per.length >= 2 ? `The median moved from ${B(yrs(per[0].s.p50))} (${esc(per[0].label)}) to ${B(yrs(per.at(-1).s.p50))} (${esc(per.at(-1).label)}); recent periods read short (survivor bias).` : 'Fewer than two entry periods have 5 or more completions.')}
      ${card('c-6', 'Clocks against history', 'tariff deadlines vs observed and projected durations', qTable, 'Observed = public register; projected = unified dim_queue. Different populations: read side by side, never differenced.', '', `Tariff deadline chain ${B(band ? `${(band.minDays / 365.25).toFixed(2)} yr` : 'not held')} against an observed median of ${B(yrs(sObs.p50))} to in service.`)}
      ${card('c-6', 'Projected in-service dates near here', `solved-case requests within ${Math.max(R, 25)} mi against ${cod ? `a ${cod} target COD` : 'no target COD (set one in Timing inputs)'}`, tl, 'Applicants\' projected dates, as published. Distance is not a dependency.', '', pts.length ? `${B(pts.length)} dated request${pts.length === 1 ? '' : 's'} within ${Math.max(R, 25)} mi; ${B(near.filter(x => cls(x.q) === 'past').length)} already past their projected date.` : `No dated solved-case request within ${Math.max(R, 25)} mi.`)}
      ${card('c-6', 'Nearby delivery timeline', 'each request with its projected date and register status now', table(['Projected', 'Queue #', 'POI', 'Type', '#MW', 'Status (study)', 'Register now', 'Against target', '#Distance'], tlRows, `No solved-case request within ${Math.max(R, 25)} mi.`), '', '', `${B(near.length)} request${near.length === 1 ? '' : 's'} within ${Math.max(R, 25)} mi; ${B(near.filter(x => dv.nowBy.get(x.q.queue_position)?.now === 'W').length)} withdrawn since.`)}
      ${traceCard(T.traceSchedule(start, band, q), T.traceDurations(dv.obs, sObs, sWd, dv.proj, sProj, { C: dv.allT.C, W: dv.allT.W, study: dv.set.rows.length }),
        details('<p>Each date = the previous deadline + the tariff clock for the step (calendar days, or business days Mon–Fri where the tariff says so). The Cluster Study Report date is a deadline, not an earliest date: ISO-NE may finish sooner. Observed durations are the register\'s own dates; a record without a date is left out and counted, never given a zero.</p>', `<p>${esc(prof.source)}. ${esc(regNote())}.</p>`))}
    </div>
    ${nextStep(S.tech === 'datacenter' ? 'check readiness and actions in <b>Decision › Readiness &amp; actions</b>' : 'size the cash you post along this schedule in <b>Queue › Cash &amp; commitments</b>', S.tech === 'datacenter' ? 'decision' : 'queue', S.tech === 'datacenter' ? 'readiness' : 'cash')}`;
}

// ---------- Tab 3: Cash & commitments ----------
const SIZE_BANDS = [[0, 20, '≤ 20 MW'], [20, 50, '20–50 MW'], [50, 100, '50–100 MW'], [100, 200, '100–200 MW'], [200, 500, '200–500 MW'], [500, Infinity, '> 500 MW']];
function tabCash({ data, S }) {
  const dv = derived(data);
  const ca = cashApplies(S.tech);
  if (!ca.applies) return `${sourcesLine(dv)}
    <div class="kpis">${kpi('Cost to enter', 'n/a', '', 'Generator interconnection deposits do not apply to a load')}${kpi('Readiness deposits', 'n/a', '', 'Not applicable to a data centre')}${kpi('Withdrawal penalty', 'n/a', '', 'Not applicable to a data centre')}${kpi('Large-load procedure', 'pending', '', ca.badge || 'not held')}</div>
    <div class="cards">${card('c-12', 'Cash and commitments: not applicable to a data centre', 'the Schedule 22 / 23 deposits, readiness and penalties are for generating facilities', `<div class="notice">Not applicable to data centre: ${esc(ca.why)}</div>`, 'Switch the fuel to a generator or storage to see the Schedule 22 cash schedule.', '', 'Not applicable to a data centre: the ISO-NE large-load procedure is pending.')}</div>
    ${nextStep('see what changed near here in <b>Queue › Changes &amp; risk</b>', 'queue', 'changes')}`;
  const q = queueInputs(S), prof = profileOf(q.profile), mw = q.mw;
  const cost = S.handoffs.cost, costMatch = cost && String(cost.busId) === String(S.nodeId) && Number(cost.size) === mw && (!cost.tech || cost.tech === (S.tech === 'datacenter' ? 'datacenter' : S.tech));
  // Only a fully priced (or evidenced true-zero) scenario is a known allocation; lower bounds and unverified cases are not.
  const gridNu = costMatch && ok(cost.knownNetwork) && !(cost.networkUnpriced > 0) && ['Priced', 'True zero'].includes(cost.status) ? cost.knownNetwork * 1e6 : null;
  const userNu = gridNu == null && S.ui.qNuUser !== undefined && S.ui.qNuUser !== '' && ok(Number(S.ui.qNuUser)) && Number(S.ui.qNuUser) >= 0 ? Number(S.ui.qNuUser) * 1e6 : null;
  const nu = gridNu ?? userNu, nuSource = gridNu != null ? 'grid' : userNu != null ? 'user' : null;
  // F016: queue cash honours Land's site-control entry (blocked, or the deposit-in-lieu path), never "assumed demonstrable".
  const qc = RX.queueCash(q), entry = RX.entryCost({ mw, nrisHeld: q.nrisHeld, profile: q.profile });
  const c = commitments(mw, nu, { profile: q.profile, nrisHeld: q.nrisHeld, depositInLieu: qc.status === 'ok' ? qc.dil : 0 });
  const curve = depositCurve(Array.from({ length: 496 }, (_, i) => 5 + i), q.profile);
  const heldRows = dv.rows.filter(r => ok(r.mwReq));
  const bands = SIZE_BANDS.map(([lo, hi, key]) => ({ key, ...(outcomesBy(heldRows.filter(r => r.mwReq > lo && r.mwReq <= hi), () => key)[0] || T0) }));
  const band = sizeBand(dv.rows, mw);
  const tierOf = p => (p.schedule === '22' ? 'Schedule 22 (flat)' : p.schedule === '23' ? 'Schedule 23 (≤ 20 MW)' : p.schedule === 'proforma' ? 'pro forma tier' : '—');
  const pt = curve.find(p2 => p2.mw === Math.round(mw));
  const entryCard = card('c-4', 'Cost to enter', `at ${fmt.mw(mw)}, the deposits posted with the request`, costToEnterBody(entry), `${esc(prof.label)}. The readiness deposit is security (cash, letter of credit or surety bond), not capital cost.`, '',
    entry.status === 'ok' ? `At ${esc(fmt.mw(mw))}: ${B(entry.text)} · ${esc(entry.cite.text)}.` : esc(entry.reason));
  const siteCard = card('c-4', 'Site control at request', 'read from Land; the deposit in lieu is the NRIS-only alternative', siteControlBody(S, q, qc), `${esc(prof.label)}.`, '',
    qc.status === 'ok' ? `Cash at request ${B(usd(qc.cash))} (${esc(qc.path)}).` : qc.status === 'blocked' ? `${B(qc.reason)}: no single cash-at-request figure until site control is held.` : esc(qc.reason || 'not held'));
  const sizeCards = `${card('c-6', 'Entry cash by project size', `total at request and its cash part, 5–500 MW (${esc(prof.label)})`, C.lineChart([
      { name: 'Total at request', points: curve.filter(p => !p.notModelled).map(p => ({ x: p.mw, y: p.cashAtRequest })) },
      { name: 'Cash part', points: curve.filter(p => !p.notModelled).map(p => ({ x: p.mw, y: p.cash })) },
      { name: 'Study deposit', points: curve.filter(p => !p.notModelled).map(p => ({ x: p.mw, y: p.studyDeposit })) }], { fmt: v => usd(v), xfmt: v => `${v} MW`, xLabel: 'Size (MW)', title: 'Entry cash by project size', height: 220 }), `${q.profile === 'isone' ? 'Flat above 20 MW (Schedule 22); Schedule 23 at or below.' : '20 MW and below: small-generator procedures, not modelled under the pro forma.'} Current size ${esc(fmt.mw(mw))}.`, '', pt && !pt.notModelled ? `At ${esc(fmt.mw(mw))} the entry is ${B(usd(pt.cashAtRequest))}, of which ${B(usd(pt.cash))} is cash.` : `${esc(fmt.mw(mw))} is outside the modelled range for this profile.`)}
    ${card('c-6', 'Deposit tiers at key sizes', 'the rule table behind the curve', table(['Size', '#Study deposit', '#Readiness at entry', '#Cash part', '#Total at request', 'Schedule'], depositCurve([10, 20, 21, 50, 79, 80, 100, 150, 199, 200, 300, 500], q.profile).map(p => `<tr${p.mw === mw ? ' class="hi"' : ''}><td>${fmt.mw(p.mw)}</td>${p.notModelled ? '<td class="num" colspan="4">not modelled (small-generator procedures)</td><td>—</td>' : `<td class="num">${usd(p.studyDeposit)}</td><td class="num">${usd(p.readiness)}</td><td class="num">${usd(p.cash)}</td><td class="num">${usd(p.cashAtRequest)}</td><td>${esc(tierOf(p))}</td>`}</tr>`)), citeLine(entry.cite), '', pt ? `${esc(fmt.mw(mw))} falls under ${B(pt.notModelled ? 'no modelled schedule' : tierOf(pt))}.` : '')}
    ${card('c-6', 'How often requests of each size withdrew', 'public register, all entry years: withdrawn ÷ records', C.barChart(bands.map(b => ({ label: b.key, value: b.withdrawnShare == null ? null : 100 * b.withdrawnShare, note: `${b.W} of ${b.n} withdrawn · ${b.C} in service · ${b.A} active` })), { fmt: v => `${v.toFixed(0)}%`, title: 'Withdrawn share by requested size', height: 220 }), `Requested MW = net, else summer; ${fmt.int(dv.rows.length - heldRows.length)} records with neither are left out.`, '', band ? `In your band (${band.lo.toFixed(0)}–${band.hi.toFixed(0)} MW), ${B(`${band.W} of ${band.n}`)} requests withdrew (${B(pct(band.withdrawnShare))}).` : 'Enter a size to see its band.')}
    ${card('c-6', 'Outcomes by size band', band ? `your band: ${fmt.mw(band.lo)}–${fmt.mw(band.hi)} (half to twice ${fmt.mw(mw)})` : 'enter a size', table(['Band', '#Records', '#Withdrawn', '#In service', '#Active', '#Withdrawn share', '#Completion (resolved)'], [...bands, ...(band ? [{ key: `Your band ${band.lo.toFixed(0)}–${band.hi.toFixed(0)} MW`, ...band }] : [])].map(b => `<tr><td>${esc(b.key)}</td><td class="num">${fmt.int(b.n)}</td><td class="num">${fmt.int(b.W)}</td><td class="num">${fmt.int(b.C)}</td><td class="num">${fmt.int(b.A)}</td><td class="num">${pct(b.withdrawnShare)}</td><td class="num">${pct(b.completion)}</td></tr>`)), 'An observed share of named records, not a probability for this project; it shows how often forfeit exposure was actually triggered.', '', band ? `Of resolved requests in your band, ${B(pct(band.completion))} reached operation.` : 'Enter a size to see its band.')}`;
  const traces = [T.traceDepositCurve(curve, mw, q.profile), T.traceSizeBand(bands, band, mw, heldRows.length)];
  if (c.errors.length) {
    return `${sourcesLine(dv)}${profileSwitch(S)}<div class="notice warn">${c.errors.map(esc).join(' ')}</div>
      <div class="kpis">${kpi('Cost to enter', 'not held', '', esc(c.errors[0]))}${kpi('Withdrawn share at this size', pct(sizeBand(dv.rows, mw)?.withdrawnShare), '', 'register, half-to-twice band')}</div>
      <div class="cards">${entryCard}${sizeCards}${traceCard(...traces)}</div>
      ${nextStep('see what changed near here in <b>Queue › Changes &amp; risk</b>', 'queue', 'changes')}`;
  }
  const num = k => (S.ui[k] !== undefined && S.ui[k] !== '' && ok(Number(S.ui[k])) ? Number(S.ui[k]) : null);
  const exType = S.ui.qExType === 'cluster' ? 'cluster' : 'restudy';
  const ex = penaltyExemptions({ priorReport: num('qExPrior'), current: num('qExNow') ?? (gridNu != null ? gridNu / 1e6 : null), reportType: exType, clusterStudy: num('qExCluster'), facilitiesStudy: num('qExFac') });
  const exIn = (k, label, ph) => `<label class="field">${esc(label)}, $M<input type="number" min="0" step="0.1" data-act="ui-text" data-k="${k}" value="${esc(S.ui[k] ?? '')}" placeholder="${esc(ph)}"></label>`;
  const exTypeBtn = (v, label) => `<button data-act="ui" data-k="qExType" data-v="${v}" class="${exType === v ? 'active' : ''}">${esc(label)}</button>`;
  const exCard = card('c-6', 'Penalty exemptions', 'withdrawal penalty waived on a large network-upgrade cost increase', more(`<div class="segmented seg-sm" role="group" aria-label="Current report">${exTypeBtn('restudy', 'Current report: restudy')}${exTypeBtn('cluster', 'Current report: first cluster study')}</div><div class="form-grid">${exIn('qExPrior', 'Preceding report', 'not set')}${exIn('qExNow', 'Current report', gridNu != null ? 'Grid value' : 'not set')}${exIn('qExCluster', 'Cluster study / restudy', 'not set')}${exIn('qExFac', 'Facilities study', 'not set')}</div>`)
    + table(['Test', '#Before', '#Now', '#Increase', 'Threshold', 'Result'], ex.map(e => `<tr><td class="wrap">${esc(e.test)}${e.note ? `<br><small>${esc(e.note)}</small>` : ''}</td><td class="num">${ok(e.from) ? `$${e.from}M` : 'not set'}</td><td class="num">${ok(e.to) ? `$${e.to.toFixed(2)}M` : 'not set'}</td><td class="num">${pct(e.increase)}</td><td>${e.op} ${ok(e.threshold) ? (100 * e.threshold).toFixed(0) : '—'}%</td><td>${e.exempt == null ? '<span class="pill">not held</span>' : e.exempt ? '<span class="pill good">Exempt</span>' : '<span class="pill warn">Not exempt</span>'}</td></tr>`)),
    `${citeLine(ex[0].cite)}. Strictly more than the threshold; the 25% test runs on a Cluster Restudy Report only. A missing cost is not held, never "not exempt". The materiality screen (no material effect on any request in the cluster) applies first.`, '', `${B(ex.filter(e => e.exempt === true).length)} exempt, ${B(ex.filter(e => e.exempt === false).length)} not exempt, ${B(ex.filter(e => e.exempt == null).length)} not held: enter report costs under More options.`);
  // P2 C32: the pre-construction peak leaves out the post-LGIA phase (one rule: RX.peakPreLgia); a later phase not held = a lower bound.
  const pk = RX.peakPreLgia(c);
  const rows = c.phases.map(p => `<tr><td>${esc(p.phase)}</td><td class="num">${usd(p.readiness)}</td><td class="num">${usd(p.topUp)}</td><td class="num">${usd(p.cashPosted)}</td><td class="num">${usd(p.cashMin)}</td><td class="num">${p.penaltyIfWithdrawn === 0 ? '$0 (true zero)' : `${p.penaltyLowerBound && ok(p.penaltyIfWithdrawn) ? '≥ ' : ''}${usd(p.penaltyIfWithdrawn)}`}</td><td class="wrap">${esc(p.penaltyNote || '')}<br><small>${(p.cite || []).map(citeLine).join('; ')}</small></td></tr>`);
  const SHORT = { 'Cluster request': 'Request', 'Cluster study': 'Study', 'After the cluster study report': 'After report', 'Cluster restudy (if triggered)': 'Restudy', 'Facilities study / draft LGIA': 'Facilities', 'After LGIA execution': 'Post-LGIA' };
  const lbl = p => SHORT[p.phase] || p.phase;
  const nuNotice = gridNu == null
    ? `<div class="notice warn">Allocated network-upgrade cost is ${costMatch ? (!ok(cost.knownNetwork) ? 'not held in the Grid scenario' : cost.status === 'Lower bound' ? 'only a lower bound' : cost.status === 'No upgrades indicated' ? 'unverified (envelope-only cases)' : 'only partly priced') : 'not sent for this bus, size and technology'}, so the later readiness totals, the LGIA deposit and later penalties are ${userNu != null ? `computed on <b>your what-if of ${usd(userNu)}</b> (an assumption, not an allocation)` : 'not held'}. Send a fully priced scenario from Grid › Upgrade cost allocator${userNu != null ? '' : ', or enter a what-if under Inputs › More options'}.</div>`
    : `<div class="notice">Network-upgrade cost ${usd(gridNu)} from Grid: <b>${cost.edited ? 'edited allocation' : 'standalone allocation (project pays 100%)'}</b>${cost.edited ? '' : ' unless edited in Grid'}. Direct-facility and affected-system costs are excluded from the deposit basis.</div>`;
  const cashKpi = qc.status === 'ok' ? kpi('Cash at request', usd(qc.cash), '', `${qc.path === 'deposit in lieu' ? `entry cash ${usd(entry.cash)} + deposit in lieu ${usd(qc.dil)}` : `initial + study deposit; site control ${q.sitePct}% (Land)`} · ${qc.cite.map(x => x.src).join('; ')}`)
    : kpi('Cash at request', 'blocked', '', `${qc.reason}. If demonstrated: ${usd(qc.ifDemonstrated?.cash)} cash (an assumption, not Land's entry).`);
  return `${sourcesLine(dv)}${profileSwitch(S)}${nuNotice}
    <div class="kpis">
      ${kpi('Cost to enter', entry.status === 'ok' ? RX.usdK(entry.total) : 'not held', '', entry.status === 'ok' ? `${entry.text} · ${entry.cite.text} · effective ${entry.cite.effective}` : entry.reason)}
      ${cashKpi}
      ${kpi('Peak security + deposits posted (pre-LGIA)', ok(pk.value) ? `${pk.lowerBound ? '≥ ' : ''}${usd(pk.value)}` : 'not held', '', `${pk.lowerBound ? 'Later phases not held' : `Readiness balance (cash, LC or bond) + study deposit while studies run${nuSource === 'user' ? ' · on your what-if' : ''}`}${pk.phase ? ` · peak in ${pk.phase.toLowerCase()}` : ''}. The post-LGIA phase and construction security under the LGIA are not counted.`)}
      ${kpi('Forfeited if withdrawn during the cluster study', `≥ ${usd(c.phases[1].penaltyIfWithdrawn)}`, '', 'Only if it materially affects a request in the same cluster')}
      ${kpi('Register requests of this size that withdrew', pct(band?.withdrawnShare), '', band ? `${band.W} of ${band.n} requesting ${band.lo.toFixed(0)}–${band.hi.toFixed(0)} MW (observed, all years)` : 'enter a size')}
    </div>
    <div class="cards">
      ${entryCard}
      ${siteCard}
      ${card('c-4', 'Inputs', 'the upgrade-cost basis', more(`<label class="field">What-if allocated network-upgrade cost, $M <span class="pill warn">Your assumption</span><input type="number" min="0" step="0.1" data-act="ui-text" data-k="qNuUser" value="${esc(S.ui.qNuUser ?? '')}" placeholder="${gridNu != null ? 'Grid value in use' : 'not set'}" ${gridNu != null ? 'disabled' : ''}><span class="audit-note">Used only while Grid has not sent a fully priced allocation. Leave blank to keep later phases "not held".</span></label>`), `<span class="pill${prof.labelled ? ' warn' : ''}">${esc(prof.label)}</span> ${esc(prof.note)}`, '', `Upgrade-cost basis: ${B(nuSource === 'grid' ? 'Grid allocation' : nuSource === 'user' ? 'your what-if' : 'not held')}; site control ${B(ok(q.sitePct) ? `${q.sitePct}% (Land)` : 'not held (Land)')}.`)}
      ${card('c-4', 'Security + deposits posted by phase', 'cash, letter of credit or bond: readiness balance + study deposit while studies run', C.barChart(c.phases.map(p => ({ label: lbl(p), value: p.cashPosted, note: ok(p.penaltyIfWithdrawn) ? `Forfeit if withdrawn: ${usd(p.penaltyIfWithdrawn)}` : 'Forfeit not held' })), { fmt: v => usd(v), title: 'Cash posted by phase', height: 220, emptyText: 'Later phases need an allocated upgrade cost from Grid.' }), qc.status === 'blocked' ? `Shown with no deposit in lieu: ${esc(qc.reason)}.` : '', '', `${B(usd(c.fee + c.phases[0].cashPosted))} is paid or posted at request, ${B(usd(c.fee + c.phases[0].cashMin))} of it in cash (the readiness deposit may be an LC or bond)${ok(pk.value) ? `; security and deposits posted peak before the LGIA at ${B(`${pk.lowerBound ? '≥ ' : ''}${usd(pk.value)}`)}` : ''}${pk.lowerBound ? ' (later phases not held)' : ''}.`)}
      ${card('c-4', 'Forfeit exposure by phase', 'cash posted vs what is forfeited on withdrawal', C.groupedBar(c.phases.map(p => ({ label: lbl(p), values: [p.cashPosted, p.penaltyIfWithdrawn] })), { series: ['Cash posted', 'Forfeit if withdrawn'], fmt: v => usd(v), title: 'Forfeit exposure by phase', height: 220 }), 'Cluster-study stages show the study deposit, a lower bound (allocated study costs not held).', '', `Withdrawing during the cluster study forfeits at least ${B(usd(c.phases[1].penaltyIfWithdrawn))}, and only if it materially affects a request in the same cluster.`)}
      ${card('c-12', 'By phase', 'readiness top-ups, cash posted and forfeits', table(['Phase', '#Readiness balance', '#Top-up', '#Posted (cash, LC or bond)', '#Of which cash', '#Forfeit if withdrawn', 'Rule'], rows), `Deposits, letters of credit and surety bonds are <b>security posted, not capital cost</b>. LGIA deposit: ${c.lgiaDeposit == null ? 'not held' : usd(c.lgiaDeposit)} (20% of network upgrades less readiness already paid).`, '', `${B(c.phases.length)} phases; ${B(c.phases.filter(p2 => !ok(p2.cashPosted)).length)} have no cash figure because the allocated upgrade cost is ${nu == null ? 'not held' : 'held'}.`)}
      ${exCard}
      ${sizeCards}
      ${traceCard(T.traceCash(mw, c, nu, qc.status === 'ok' ? qc.dil : 0, nuSource, q.profile), ...traces, traceExemptions(ex),
        details(depositNarrative(q.profile), `<p>${esc(prof.source)}. Size bands: ${esc(regNote())}.</p>`))}
    </div>
    ${nextStep('see what changed near here in <b>Queue › Changes &amp; risk</b>', 'queue', 'changes')}`;
}

// ---------- Tab 4: Changes & risk ----------
function tabChanges({ data, S, node }) {
  const dv = derived(data), set = dv.set, R = 50;
  const vint = dv.vint, cutoff = dv.cutoff, p = dv.matureT;
  const n = dv.now.counts;
  const near25 = nearby(set.rows, node, 25).filter(x => x.inRadius);
  const late = near25.filter(x => LATE.test(x.q.status || ''));
  // then vs now
  const tn = crossTab(dv.now.rows, x => x.q.status, x => x.now, () => 1, { rows: STUDY_STATUS.filter(s => set.rows.some(q => q.status === s)), cols: ['W', 'C', 'A', 'missing'] });
  const thenNow = C.stackedBar(tn.rows.map((r, i) => ({ label: stLabel(r), values: tn.values[i] })), { series: ['Withdrawn', 'In service', 'Active', 'Not found'], fmt: v => v.toFixed(0), title: 'Solved-case set: status in the study vs register now', height: 220 });
  const changedRows = near25.map(x => { const r = dv.nowBy.get(x.q.queue_position); return `<tr><td>Q${esc(x.q.queue_position)}</td><td class="wrap">${esc(short(x.q.poi_name, 44))}</td><td class="num">${fmt.mw(x.q.max_mw)}</td><td>${esc(stLabel(x.q.status))}</td><td>${r?.now === 'W' ? '<span class="pill warn">Withdrawn</span>' : esc(NOW[r?.now] || 'not found')}</td><td>${esc(r?.r?.wd_date || (r?.now === 'C' ? r.r.op_date : '') || '—')}</td><td class="num">${mi(x.distance)}</td></tr>`; });
  // vintages
  const vChart = C.stackedBar(vint.map(v => ({ label: String(v.year), values: [v.W || null, v.C || null, v.A || null] })), { series: ['Withdrawn', 'In service', 'Active'], fmt: v => v.toFixed(0), title: 'Register entries by year and outcome', height: 220 });
  const rateChart = C.lineChart([
    { name: 'Reached operation (of resolved)', points: vint.map(v => ({ x: v.year, y: ok(v.completion) ? 100 * v.completion : null })) },
    { name: 'Withdrawn (of all)', points: vint.map(v => ({ x: v.year, y: ok(v.withdrawnShare) ? 100 * v.withdrawnShare : null })) }], { fmt: v => `${v.toFixed(0)}%`, xfmt: v => String(v), xLabel: 'Entry year', title: 'Completion and withdrawal by entry year', height: 220 });
  // by type (mature)
  const types = outcomesBy(dv.mature, r => fuelGroup(r.fuel)).sort((a, b) => b.n - a.n);
  const typesAll = new Map(outcomesBy(dv.rows, r => fuelGroup(r.fuel)).map(o => [o.key, o]));
  const typeChart = C.barChart(types.filter(t => ok(t.completion)).map(t => ({ label: t.key, value: 100 * t.completion, note: `${t.C} in service of ${t.C + t.W} resolved (n ${t.n})` })), { fmt: v => `${v.toFixed(0)}%`, title: `Completion by resource type (entered ≤ ${cutoff})`, height: 220 });
  const typeRows = types.map(t => { const a = typesAll.get(t.key) || T0; return `<tr><td>${esc(t.key)}</td><td class="num">${fmt.int(t.n)}</td><td class="num">${fmt.int(t.C)}</td><td class="num">${fmt.int(t.W)}</td><td class="num">${fmt.int(t.A)}</td><td class="num">${pct(t.completion)}</td><td class="num">${fmt.int(a.n)}</td><td class="num">${pct(a.completion)}</td></tr>`; });
  // late-stage
  const lateRows = late.map(x => { const r = dv.nowBy.get(x.q.queue_position); return `<tr><td>Q${esc(x.q.queue_position)}</td><td class="wrap">${esc(short(x.q.poi_name, 56))}</td><td class="num">${fmt.mw(x.q.max_mw)}</td><td>${esc(res(x.q.resource_type))}</td><td>${esc(stLabel(x.q.status))}</td><td>${r?.now === 'W' ? '<span class="pill warn">Withdrawn</span>' : esc(NOW[r?.now] || 'not found')}</td><td>${esc(r?.r?.ia_status || 'not published')}</td><td>${esc(x.q.projected_is_date || 'not held')}</td><td class="num">${mi(x.distance)}</td></tr>`; });
  // retirements / active requests / upgrades within R
  const bus = { lat: node?.latitude, lon: node?.longitude };
  const dist = (lat, lon) => miles(bus, { lat, lon });
  const req = dv.rows.filter(r => r.status === 'A' && ok(r.lat)).map(r => ({ ...r, d: dist(r.lat, r.lon), year: r.op_date ? Number(r.op_date.slice(0, 4)) : null, mw: r.mwReq })).filter(r => ok(r.d) && r.d <= R && ok(r.mw));
  const ret = X.study.retirements.map(r => ({ ...r, d: dist(r.lat, r.lon) })).filter(r => ok(r.d) && r.d <= R && ok(r.mw));
  const up = [...X.study.txUpgrades.map(u => ({ ...u, d: Math.min(dist(u.lat1, u.lon1) ?? Infinity, dist(u.lat2, u.lon2) ?? Infinity), where: `${u.from} – ${u.to}` })), ...X.study.subUpgrades.map(u => ({ ...u, d: dist(u.lat, u.lon), where: u.substation }))].filter(u => ok(u.d) && u.d <= R);
  const undatedReq = req.filter(r => !ok(r.year));
  const yrsAll = [...new Set([...req.map(r => r.year), ...ret.map(r => r.year), ...up.map(u => u.year)].filter(ok))].sort((a, b) => a - b);
  const byYear = yrsAll.map(y => ({ year: y, req: req.filter(r => r.year === y).reduce((a, r) => a + r.mw, 0), ret: ret.filter(r => r.year === y).reduce((a, r) => a + r.mw, 0), up: up.filter(u => u.year === y).length }));
  const tlChart = C.stackedBar(byYear.map(y => ({ label: String(y.year), values: [y.req || null, y.ret ? -y.ret : null] })), { series: ['Active requests (MW)', 'Retirements (MW)'], fmt: v => `${v.toFixed(0)} MW`, title: `Additions and retirements within ${R} mi`, height: 220, emptyText: `No active request or retirement placed within ${R} mi.` });
  const upRows = up.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999)).map(u => `<tr><td>${esc(u.year ?? 'not held')}</td><td class="wrap">${esc(short(u.name, 90))}</td><td>${esc(u.where)}</td><td class="num">${ok(u.kv) ? `${u.kv.toFixed(0)} kV` : '—'}</td><td class="num">${mi(u.d)}</td></tr>`);
  // delivery dependencies (Studio Q-10), each measured with its denominator
  const Rq = Number(S.ui.qRadius || 10), inRq = nearby(set.rows, node, Rq).filter(x => x.inRadius);
  const light0 = inRq.filter(x => !(x.q.light_pct_modelled > 0)).length, past = inRq.filter(x => x.q.projected_is_date && x.q.projected_is_date < dv.asOf).length;
  const wdNear = inRq.filter(x => dv.nowBy.get(x.q.queue_position)?.now === 'W').length;
  const tg = caseTable(data.grid, S.nodeId, S.tech, Number(S.exportMW), Number(S.importMW)), bx = binding(tg, S.tech === 'datacenter' ? 'import' : 'export');
  const cost = S.handoffs.cost, costHeld = cost && String(cost.busId) === String(S.nodeId) && ['Priced', 'True zero'].includes(cost.status);
  const regNear = registerNear(dv.rows, node, Rq);
  const deps = [
    ['Register requests with no coordinate (in no radius count)', fmt.int(regNear.unplaced), `of ${fmt.int(dv.rows.length)}`, 'Register POI match'],
    [`Solved-case positions within ${Rq} mi`, fmt.int(inRq.length), `of ${fmt.int(set.rows.length)} · ${fmt.mw(sumMW(inRq))}`, 'Queue & cluster'],
    ['… withdrawn since the study', fmt.int(wdNear), `of ${fmt.int(inRq.length)} near here`, 'Register now (QP + date)'],
    ['… dispatched at 0 MW in the light-load case', fmt.int(light0), `of ${fmt.int(inRq.length)} near here`, 'dim_queue light_pct_modelled'],
    [`… projected in service before ${dv.asOf} while still open`, fmt.int(past), `of ${fmt.int(inRq.length)} near here`, 'dim_queue projected_is_date'],
    [`Binding ${S.tech === 'datacenter' ? 'import' : 'export'} limit vs requested size`, ok(bx.value) ? fmt.mw(bx.value) : 'not held', `${bx.status} · requested ${fmt.mw(Number(S.tech === 'datacenter' ? S.importMW : S.exportMW))}`, 'Grid rules'],
    ['Allocated network-upgrade cost for this configuration', costHeld ? 'sent from Grid' : 'not held', costHeld ? cost.status : 'no fully priced Grid scenario', 'Grid › Upgrade cost allocator'],
    ['Affected-system study', 'not held', 'none in any store', '—'],
    ['Dated milestone schedule for any queue record', 'none', 'the register publishes stage words, no dates for them', 'Register'],
  ].map(([a, b, c2, d]) => `<tr><td class="wrap">${esc(a)}</td><td class="num"><b>${esc(b)}</b></td><td class="wrap muted">${esc(c2)}</td><td class="muted">${esc(d)}</td></tr>`);
  // state-level status table (Studio Q-09)
  const st = node?.state_code, inState = set.rows.filter(q => q.state === st), stMW = inState.reduce((a, q) => a + (q.max_mw || 0), 0);
  const stRows = STUDY_STATUS.map(s => inState.filter(q => q.status === s)).filter(g => g.length).map(g => { const m = g.reduce((a, q) => a + (q.max_mw || 0), 0), w = g.filter(q => dv.nowBy.get(q.queue_position)?.now === 'W').length; return `<tr><td>${esc(stLabel(g[0].status))}</td><td class="num">${fmt.int(g.length)}</td><td class="num">${fmt.mw(m)}</td><td class="num">${pct(stMW ? m / stMW : null)}</td><td>${esc(g.map(q => q.request_date).sort()[0])}</td><td>${esc(g.map(q => q.projected_is_date).filter(Boolean).sort().at(-1) || 'not held')}</td><td class="num">${fmt.int(w)}</td></tr>`; });
  return `${sourcesLine(dv)}
    <div class="kpis">
      ${kpi('Solved-case positions withdrawn since', fmt.int(n.W), '', `of ${fmt.int(set.rows.length)} modelled · ${n.C} now in service · ${n.A} still active${n.missing ? ` · ${n.missing} not found` : ''} (register, QP + date)`)}
      ${kpi('Reached operation (mature entries)', pct(p.completion), '', `${fmt.int(p.C)} of ${fmt.int(p.C + p.W)} resolved register requests entered ≤ ${cutoff}`)}
      ${kpi('Late-stage requests within 25 mi', fmt.int(late.length), '', `IA executed / in progress or facilities study · ${late.filter(x => dv.nowBy.get(x.q.queue_position)?.now === 'W').length} since withdrawn`)}
      ${kpi('Register withdrawn share', pct(dv.allT.withdrawnShare), '', `${fmt.int(dv.allT.W)} of ${fmt.int(dv.allT.n)} requests, all years`)}
    </div>
    <div class="cards">
      ${card('c-6', 'What changed since the study', 'the 110 positions the solved case modelled, by study status, looked up in the register now', thenNow, 'The solved envelope was not re-run after these withdrawals, and a withdrawal is never assumed to free capacity: that depends on which facilities it loaded.', '', `${B(`${n.W} of ${set.rows.length}`)} modelled positions have withdrawn since the study; ${B(n.C)} are in service and ${B(n.A)} still active.`)}
      ${card('c-6', 'Changes near here', 'solved-case requests within 25 mi and what the register says now', table(['Queue #', 'POI', '#MW', 'Status (study)', 'Register now', 'Withdrawn / op date', '#Distance'], changedRows, 'No solved-case request within 25 mi.'), '', '', `${B(near25.length)} solved-case request${near25.length === 1 ? '' : 's'} within 25 mi; ${B(near25.filter(x => dv.nowBy.get(x.q.queue_position)?.now === 'W').length)} withdrawn since.`)}
      ${card('c-6', 'Register trends by vintage', 'entries per year, stacked by outcome', vChart, `${esc(regNote())}. Recount matches the Studio copy of queue_trends year for year.`, '', vint.length ? (() => { const top = vint.reduce((a2, v) => ((v.W + v.C + v.A) > (a2.W + a2.C + a2.A) ? v : a2)); return `Entries peaked in ${B(top.year)} at ${B(fmt.int(top.W + top.C + top.A))} requests.`; })() : 'No register entries.')}
      ${card('c-6', 'Completion and withdrawal by vintage', 'reached operation ÷ resolved; withdrawn ÷ all', rateChart, `Entry years after ${cutoff} are immature: withdrawals resolve years before completions, so their rates will move.`, '', `${B(pct(p.completion))} of resolved requests entered by ${cutoff} reached operation.`)}
      ${card('c-6', 'Completion by resource type', `register requests entered ≤ ${cutoff}, resolved only`, typeChart, 'EIA fuel codes; hybrids kept apart. n is in each bar\'s tooltip and the table.', '', (() => { const t2 = types.filter(t => ok(t.completion)).sort((a2, b2) => b2.n - a2.n)[0]; return t2 ? `The largest group, ${B(t2.key)}, reached operation in ${B(pct(t2.completion))} of resolved cases (n ${t2.n}).` : 'No resolved group.'; })())}
      ${card('c-6', 'Outcomes by resource type', 'mature entries, with all-years for comparison', table(['Type', '#Records', '#In service', '#Withdrawn', '#Active', '#Completion', '#All-years n', '#All-years completion'], typeRows), '', '', `${B(types.length)} resource types among ${B(fmt.int(dv.mature.length))} mature register entries.`)}
      ${card('c-12', 'Late-stage requests within 25 mi', 'most likely to build: agreement executed or in progress, or facilities study', table(['Queue #', 'POI', '#MW', 'Type', 'Status (study)', 'Register now', 'IA status (register)', 'Projected in service', '#Distance'], lateRows, 'No late-stage solved-case request within 25 mi.'), '', '', `${B(late.length)} late-stage request${late.length === 1 ? '' : 's'} within 25 mi; ${B(late.filter(x => dv.nowBy.get(x.q.queue_position)?.now === 'W').length)} since withdrawn.`)}
      ${card('c-6', `Additions, retirements and upgrades within ${R} mi`, 'active register requests by projected op year above zero; retirements below', tlChart, `${undatedReq.length ? `${undatedReq.length} active request(s) carry no op date and are not drawn. ` : ''}Retirements and upgrades: unified DB. A request is not a build.`, '', `Within ${R} mi: ${B(fmt.mw(req.reduce((a2, r) => a2 + r.mw, 0)))} of active requests and ${B(fmt.mw(ret.reduce((a2, r) => a2 + r.mw, 0)))} of retirements.`)}
      ${card('c-6', `Approved upgrades within ${R} mi`, 'transmission (either end) and substation upgrades, as published', table(['In service', 'Upgrade', 'Where', '#kV', '#Distance'], upRows, `No approved upgrade within ${R} mi.`), 'Unified dim_transmission_upgrade, dim_substation_upgrade. No MW is published for upgrades.', '', `${B(up.length)} approved upgrade${up.length === 1 ? '' : 's'} within ${R} mi; none is netted into any limit.`)}
      ${card('c-6', 'Delivery dependencies', 'each measured, with its denominator; none is a judgement', table(['Dependency', '#Measured', 'Of', 'Read from'], deps), '', '', `${B(`${wdNear} of ${inRq.length}`)} nearby positions have withdrawn and ${B(past)} are past their projected date; the affected-system study is not held.`)}
      ${(() => { const mm = materialModChecklist(S.tech); return card('c-12', 'Material-modification checklist', 'changes after entering the queue and whether position is kept, by the rule the vault documents', mm.applies ? `<div class="notice">${esc(mm.isoNe)}</div>` + table(['Change', 'Rule (vault)', 'Standard / condition', 'Source', 'Status'], mm.rows.map(r => `<tr><td class="wrap">${esc(r.change)}</td><td class="wrap">${esc(r.rule)}</td><td class="wrap">${esc(r.standard)}</td><td class="wrap muted">${esc(r.source)}</td><td><span class="pill ${r.status === 'Not held' ? '' : r.status === 'Research note' ? 'warn' : 'good'}">${esc(r.status)}</span></td></tr>`)) : `<div class="notice">Not applicable to data centre: ${esc(mm.why)}</div>`, 'Evidence labels, never a pass. Confirm any change with ISO-NE before assuming the queue position is kept.', '', mm.applies ? `${B(mm.rows.length)} kinds of change listed; ${B(mm.rows.filter(r => r.status === 'Not held').length)} have no rule held. None is a pass.` : 'Not applicable to a data centre.'); })()}
      ${card('c-6', `Queue state in ${st || 'this state'}`, 'state-level: the study\'s status words, in rulebook order', table(['Status', '#Positions', '#MW', '#Share of MW', 'Earliest request', 'Latest projected', '#Withdrawn now'], stRows, `No solved-case position in ${st || 'this state'}.`), 'Rulebook order: under initial study → SIS posted → FAC in progress → IA in progress → IA executed.', '', `${B(inState.length)} positions in ${esc(st || 'this state')} (${B(fmt.mw(stMW))}).`)}
      ${traceCard(T.traceChanges(vint, data.queue.trends, cutoff, p), T.traceStudyNow(dv.now, dv.copyNow), T.traceType(types, cutoff, dv.rows.length), T.traceTimeline(R, byYear, { req: req.filter(r => ok(r.year)), ret, up }),
        details(`<p>Share reaching operation = in service ÷ (in service + withdrawn) over register entry years ≤ ${cutoff} (latest register request year − 6). The solved-case set is joined to the register on QP + request date, because QP alone is recycled.</p>`, `<p>${esc(regNote())}. Retirements and upgrades: unified DB. ${esc(X.reg.meta.tierNote)}</p>`))}
    </div>
    ${nextStep('carry the queue risks into <b>Decision › Readiness &amp; actions</b>', 'decision', 'readiness')}`;
}

export function renderQueue(tab, ctx) {
  if (!ctx.data.queue) return '<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Loading queue data…</b></div>';
  ensureExt();
  if (X.err) return `<div class="notice error" role="alert">Could not load the queue data: ${esc(X.err)}. The solved-case set comes from /api/x/queue/study/all and the register from data/queue-register.json.</div>`;
  if (!X.study || !X.rows) return '<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Loading the queue register…</b><span>1,751 public-register records and the solved-case set from the unified database.</span></div>';
  const key = { cluster: 1, schedule: 1, cash: 1, changes: 1 }[tab] ? tab : 'cluster';
  const html = ({ cluster: tabCluster, schedule: tabSchedule, cash: tabCash, changes: tabChanges })[key](ctx);
  // S6 #2 / #7: a data centre gets the large-load service and timeline cards and loses any generator-titled card.
  return ctx.S?.tech === 'datacenter' ? withDcCards(dropGeneratorOnly(html), 'queue', key, ctx) : html;
}
