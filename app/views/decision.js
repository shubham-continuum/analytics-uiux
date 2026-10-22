// Decision dashboard (v3, dense card layout). Which option should advance? Every metric is read from its home
// dashboard's core (../decisioncore.js) or from the unified DB (api_decision.py). Raw side-by-side comparison only:
// no min–max or weighted score; unknown never passes; stress counts are not probabilities; records are deep-frozen.
// Live Studio counterparts: 7.01 gates · 7.02 market position · 7.04 multiples · 7.05 shared limits · 7.07 coverage ·
// 7.08 map · 7.09 open items · 7.10 record · 7.20 provenance. 7.03 (weighted flip point) is left out on purpose.
import { optionMetrics, gates, inputHash, costText, stressCell, stressMetric, stressLeaders, commonYears, commonRuns, ECON_DEFAULTS, LOSS_PLACEHOLDER_NOTE,
  positionTable, positionStrip, measureSet, sharedElements, scenarioRanges, coverageGrid, openItems, gateCounts, recordDiff, studioNotes, popValue, thresholdsFor, FUEL_TESTS,
  gateTally, gateInputsPending, memoQualifiers, capturePassCount, econRevenueStack } from '../decisioncore.js';
import { describe, LABELS, fmt } from '../basis.js';
import { groupedBar, barChart, gantt, percentileStrip } from '../charts.js';
import { nearby, queueInputs, codDate } from '../queuecore.js';
import { screen as landScreen, footprint } from '../landcore.js';
import * as RX from '../rules/isone.js';
import { withDcCards, dropGeneratorOnly } from './grid-dc.js';
import { listTraces, csvFor } from '../trace.js';
import { buildPack, userThresholds, thresholdRows } from '../decisionpack.js';
import { traceCompare, traceStress, traceReadiness, tracePosition, traceShared, traceStudio, traceRange, traceCoverage, traceRecord, traceFuel } from './decision-trace.js';
import { dx, dxData } from './decision-data.js';
import { fleetProfile } from './prices-data.js';
import { parallelBars, rangeBars, stackBars, optionMap, legend, OPT, toneOf } from './decision-charts.js';
import { verdictsFor, verdictTable, thresholdEditor, thresholdNotes, fmtUnit, FUEL_NAME } from './decision-fuel.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const kpi = (label, value, unit, note) => `<div class="kpi${value === 'not held' || value === '—' ? ' nh' : ''}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
const vpill = v => `<span class="pill ${v === 'Pass' ? 'good' : v === 'Fail' ? 'warn' : ''}">${esc(v)}</span>`;
/** A card per the layout contract. title/sub are text; body/foot/tools are HTML built here. */
// data-depth = the MINIMUM depth at which the card shows (the shell hides the rest); data-trace / data-chips feed the
// shell's (i) icon and provenance chips.
const card = (n, title, sub, body, { foot = '', tools = '', cls = '', depth = 'review', trace = '', chips = '', answer = '' } = {}) => `<section class="card c-${n}${cls ? ` ${cls}` : ''}" data-depth="${depth}"${trace ? ` data-trace="${esc(trace)}"` : ''}${chips ? ` data-chips="${esc(chips)}"` : ''}><header class="card-h"><h3>${esc(title)}</h3>${sub ? `<span class="card-sub">${esc(sub)}</span>` : ''}${tools ? `<div class="card-tools">${tools}</div>` : ''}</header><div class="card-b">${answer ? `<p class="card-answer">${answer}</p>` : ''}${body}</div>${foot ? `<footer class="card-f">${foot}</footer>` : ''}</section>`;
const traceCard = traces => { const n = (traces.match(/<details class="trace/g) || []).length; return `<section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculation traces</h3><span class="card-sub">formula, inputs with sources, steps, checks and a CSV of the working</span></header><div class="card-b"><p class="card-answer"><b>${n}</b> calculation${n === 1 ? '' : 's'} on this tab, each with its inputs, working and a check.</p>${traces}</div></section>`; };
const B = v => `<b>${esc(v)}</b>`;
/** v6: every tab ends with one named next step (the shell's goto action). */
const nextStep = (stage, tab, words) => `<div class="next-step" style="display:flex;justify-content:flex-end;margin:6px 0 0"><button type="button" class="primary tiny" style="margin:0" data-act="goto" data-v="${stage}" data-tab="${tab}">Next: ${esc(words)} →</button></div>`;
const DEPTHS = ['screen', 'review', 'study'];
const atLeast = (S, d) => DEPTHS.indexOf(DEPTHS.includes(S.depth) ? S.depth : 'review') >= DEPTHS.indexOf(d);
const heatBg = o => (ok(o) ? `background:rgba(92,138,206,${(0.05 + 0.45 * o / 100).toFixed(3)})` : '');
const verdictBg = v => ({ Pass: 'background:var(--ok-bg)', Hold: 'background:var(--warn-bg)', Fail: 'background:var(--bad-bg)' }[v] || '');
const statusBg = s => ({ held: 'background:var(--ok-bg)', partial: 'background:var(--warn-bg)', 'not held': 'background:var(--bad-bg)' }[s] || '');
const unitFmt = (v, u) => (!ok(v) ? 'not held' : u === '$/MWh' ? fmt.price(v) : u === 'MW' ? fmt.mw(v) : u === 'ratio' ? v.toFixed(3) : u === 'hours' || u === 'count' || u === 'MVA' ? fmt.int(v) : v.toFixed(2));
const loadingNote = (what) => `<div class="notice"><span class="spinner" style="display:inline-block;width:14px;height:14px;vertical-align:middle"></span> Loading ${esc(what)} from the database…</div>`;

export const DECISION = {
  key: 'decision',
  question: 'Which option should advance?',
  lede: 'Compare candidate buses on one basis, stress the result, track the evidence still missing, and record the decision with everything it rested on.',
  tabs: [
    { id: 'compare', label: 'Compare options' },
    { id: 'stress', label: 'Stress test', labelFor: t => ({ storage: 'Stress test (TB4)', datacenter: 'Stress test (load price)' }[t] || 'Stress test') },
    { id: 'readiness', label: 'Readiness & actions' },
    { id: 'record', label: 'Decision record' },
  ],
  needsQueue: true,
  needsLand: true,
};

const MEMO = new Map();
function memo(k, fn) { if (!MEMO.has(k)) { if (MEMO.size > 60) MEMO.clear(); MEMO.set(k, fn()); } return MEMO.get(k); }
/** Options on screen; the candidate bus from the project strip is always included. */
export const optionIds = S => [String(S.nodeId), ...(S.ui.dOpts || []).map(String).filter(id => id !== String(S.nodeId))].slice(0, 3);
export function chosen(data, S) {
  return optionIds(S).map(id => data.nodes.find(n => String(n.id) === id)).filter(Boolean);
}
/** Options not loaded yet: ask the shell to load them; the page re-renders when they arrive. A failed load is not pending. */
function pendingOptions(ctx) {
  const missing = optionIds(ctx.S).filter(id => !ctx.data.nodes.some(n => String(n.id) === id) && !ctx.busError?.(id));
  missing.forEach(id => ctx.ensureBus?.(id));
  return missing;
}
/** Options whose load failed: shown with the reason and a remove button, never a spinner. */
function failedOptions(ctx) {
  return optionIds(ctx.S).map(id => [id, ctx.busError?.(id)]).filter(([id, e]) => e && !ctx.data.nodes.some(n => String(n.id) === id));
}
const failedNotice = ctx => failedOptions(ctx).map(([id, e]) => `<div class="notice error" role="alert">Could not load ${esc(id)}: ${esc(e.message || String(e))}${id !== String(ctx.S.nodeId) ? ` <button class="tiny" data-act="d-remove" data-v="${esc(id)}">Remove</button>` : ''}</div>`).join('');
const val = (S, k) => (ok(S.ui.econ?.[k]) ? S.ui.econ[k] : ECON_DEFAULTS[k]);
const mwOf = v => (v == null || v === '' ? null : Number(v)); // null = not held, never 0 (fix-3)
/** nullmw: the one phrase a not-held project size prints, and the required size that is missing (export for every
 *  generator and storage, import for storage and a data centre; a hybrid without a battery size is still screenable).
 *  null when the size is held. Nothing is computed from a missing size: no 0, no 100 fallback. */
export const SIZE_NOT_HELD = 'size not held — set it in Project inputs';
export const sizeNotHeld = S => (S.tech !== 'datacenter' && mwOf(S.exportMW) == null ? 'Export size'
  : ['storage', 'datacenter'].includes(S.tech) && mwOf(S.importMW) == null ? 'Import / charge size' : null);
export const sizeNotHeldCard = S => `<div class="empty gsx-size-missing"><strong>${esc(SIZE_NOT_HELD[0].toUpperCase() + SIZE_NOT_HELD.slice(1))}</strong>${esc(sizeNotHeld(S))} is not held for ${esc(S.tech)}, so nothing on this page is computed from it.</div>`;
const params = S => ({ tech: S.tech, exportMW: mwOf(S.exportMW), importMW: mwOf(S.importMW), basis: S.basis, cf: (S.tech === 'wind' ? val(S, 'windCF') : val(S, 'solarCF')) / 100, lossPct: val(S, 'lossPct') });
/** Losses at the Economics default are a placeholder there; flag them the same way here. */
const lossLabel = S => `${val(S, 'lossPct')}%${ok(S.ui.econ?.lossPct) && S.ui.econ.lossPct !== ECON_DEFAULTS.lossPct ? ' (your entry)' : ` (${LOSS_PLACEHOLDER_NOTE})`}`;
const sentKey = g => (g ? [g.busId, g.at, g.tech, g.requestMW, g.exportMW, g.importMW] : null);
/** ISO-NE fleet solar/wind output (the Economics profile endpoint, read through Prices' loader): the second capture
 *  basis and the wind revenue shape. Only generation needs it. */
const fleetFor = S => (['solar', 'wind', 'hybrid'].includes(S.tech) ? fleetProfile() : { status: 'none', data: null });
const fleetData = S => { const f = fleetFor(S); return f.status === 'ok' ? f.data : null; };
/** Population (market position): the data-centre price threshold and the load metrics read it. */
const popData = () => dxData('population', 'all');
function metricsFor(data, S) {
  const p = params(S);
  const sentGrid = S.handoffs.grid || null, fleet = fleetData(S), pop = S.tech === 'datacenter' ? popData() : null;
  return chosen(data, S).map(n => memo(JSON.stringify(['opt', n.id, p, S.basis, sentKey(sentGrid), !!fleet, !!pop]), () => optionMetrics(data, n, { ...p, exportMW: p.exportMW ?? 0, importMW: p.importMW ?? 0, sentGrid, fleet, pop })));
}
/** Thresholds in force: defaults (assumption / derived) overridden by the user's entries (S.ui.decision.th, S.ui.dTh_*). */
const thr = S => thresholdsFor(S.tech, { user: userThresholds(S.ui), pop: popData() });
/** S5 #4: the finance/tax context the tax-credit gate reads: the user's finance and tax entries, the Queue COD date
 *  (queuecore.codDate: the target COD year as 31 Dec, or not held) and the rules file (rules/isone.js load). */
const taxCtx = S => ({ fin: S.ui?.fin || {}, tax: S.ui?.tax || {}, queueCod: codDate(S).value, rules: RX.getRules() });
const gatesOf = (m, S, p) => gates(m, { ...p, thresholds: thr(S), tax: taxCtx(S) });
/** The gates Decision shows for the current bus. The ONE engine: the shell's project band reads this too, so the strip,
 *  the stages and Decision can never disagree (Findings F001 / FORMULAS D3). Same inputs as metricsFor (fleet shape,
 *  population, the Grid hand-off) and the same thresholds in force. null while the bus is not loaded. */
export function candidateGates(data, S) {
  const n = data.nodes.find(x => String(x.id) === String(S.nodeId)); if (!n || !S.basis || sizeNotHeld(S)) return null; // nullmw: no verdict from a missing size
  const p = params(S), sentGrid = S.handoffs.grid || null, fleet = fleetData(S), pop = S.tech === 'datacenter' ? popData() : null;
  const m = memo(JSON.stringify(['opt', n.id, p, S.basis, sentKey(sentGrid), !!fleet, !!pop]), () => optionMetrics(data, n, { ...p, exportMW: p.exportMW ?? 0, importMW: p.importMW ?? 0, sentGrid, fleet, pop }));
  return gatesOf(m, S, p);
}
/** F001 / D3: the one gate tally every surface prints (strip, band, inspector, Decision), with the inputs this page has
 *  not loaded named, so a loading input never reads as a different verdict. null while the bus is not loaded. */
export function candidateTally(data, S) {
  const gs = candidateGates(data, S);
  return gs ? gateTally(gs, { pending: gateInputsPending(data, { tech: S.tech, fleetStatus: fleetFor(S).status }) }) : null;
}
/** Verdict with its qualifier (F003: "Fail (your threshold)"). */
const vText = g => `${g.verdict}${g.qualifier ? ` (${g.qualifier})` : ''}`;
/** Economics' wording when the Grid hand-off for this bus was sent for another technology or size. */
const staleNotice = ms => (ms.some(m => m.sentStale) ? '<div class="notice warn">Limits sent from Grid for a different project: resend from Grid › Connection capacity. The sent values are used until then, as in Economics.</div>' : '');
const picker = (data, S) => { const ids = optionIds(S), name = id => (data.index?.find(b => b.id === id)?.name || id);
  const chips = ids.map((id, i) => `<span class="year"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${OPT[i]};margin-right:5px"></i>${esc(name(id))} <span class="audit-note" style="margin:0">${id}</span>${i === 0 ? ' <em>candidate</em>' : ` <button class="tiny quiet" data-act="d-remove" data-v="${id}" aria-label="Remove ${esc(name(id))}">×</button>`}</span>`).join('');
  const add = ids.length < 3 ? `<label class="bus-pick">Add an option <span class="audit-note" style="margin:0">(any of ${(data.index?.length || 0).toLocaleString('en-US')} buses)</span><input list="bus-list" data-act="d-add" value="" placeholder="type a name, substation or id" autocomplete="off"></label>` : '<span class="audit-note">Up to three options: remove one to add another.</span>';
  // Pinned buses (the shell's S.pins) not yet compared: one click adds each (up to three options).
  const pins = (S.pins || []).map(String).filter(id => !ids.includes(id));
  const pinRow = pins.length ? `<div class="audit-note" style="margin:4px 0 0;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center">Pinned: ${pins.map(id => `<button type="button" class="tiny" data-act="d-add" data-v="${esc(id)}" ${ids.length >= 3 ? 'disabled title="Remove an option first"' : ''}>+ ${esc(name(id))}</button>`).join('')}</div>` : '';
  return `<div style="display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-end"><div class="checks" role="group" aria-label="Options">${chips}</div><div style="flex:1 1 280px;max-width:520px">${add}</div></div>${pinRow}`; };
const sizeTxt = p => (p.exportMW == null && p.importMW == null ? 'size not held' : `${p.exportMW == null ? 'export size not held' : `${fmt.mw(p.exportMW)} export`}${p.importMW ? ` · ${fmt.mw(p.importMW)} import` : ''}`);
const basisLine = (S, p) => `${esc(S.tech)} · ${esc(sizeTxt(p))} · ${esc(describe(S.basis))} · CF ${(100 * p.cf).toFixed(1)}%, losses ${esc(lossLabel(S))} (Economics)`;

/** Market position over the unified population (null until it loads). */
function positionFor(ms, S) {
  const pop = dxData('population', 'all');
  if (!pop) return null;
  return { pop, pos: memo(JSON.stringify(['pos', ms.map(m => m.node.id), S.tech]), () => positionTable(pop, ms.map(m => String(m.node.id)), S.tech)) };
}
const SHORT = { lmp_2030: 'LMP 2030', lmp_2035: 'LMP 2035', lmp_rt: 'RT 2025', solar_ratio: 'Solar ratio', tb2: 'TB2', tb4: 'TB4', tb8: 'TB8', std: 'σ', neg: 'Neg h', h200: '>$200 h', cong: 'Cong.', rt_da: 'RT−DA', hr_sp_dis: 'Inj. hr', hr_sh_chg: 'Chg. hr', hr_ll_chg: 'LL hr', sc_mva: 'SC MVA', outlets: 'Outlets' };
const unifiedRow = (pop, id) => Object.fromEntries(pop.measures.map(m => [m.key, popValue(pop, m.key, id)]));

// ---------- Tab 1: Compare options ----------
function tabCompare(ctx) {
  const { data, S } = ctx, waiting = pendingOptions(ctx);
  const ms = metricsFor(data, S), p = params(S), gs = ms.map(m => gatesOf(m, S, p)), names = ms.map(m => m.node.name);
  const allPass = gs.map(g => g.every(x => x.verdict === 'Pass'));
  const withRev = ms.filter(m => ok(m.revenue.value)).sort((a, z) => z.revenue.value - a.revenue.value);
  const withLim = ms.filter(m => ok(m.exportLimit)).sort((a, z) => z.exportLimit - a.exportLimit);
  const sh = memo(JSON.stringify(['sh', ms.map(m => m.node.id), p, sentKey(S.handoffs.grid)]), () => sharedElements(ms));
  const P = positionFor(ms, S), popState = dx('population', 'all').state;
  // The Studio-copy comparison is Study-only: skip its fetch below Study.
  const studios = ms.map(m => (atLeast(S, 'study') ? dx('studio', String(m.node.id)) : { state: 'skipped' }));
  const notesPer = ms.map((m, i) => (P && studios[i].state === 'ok' ? studioNotes(unifiedRow(P.pop, String(m.node.id)), studios[i].data.row) : null));
  const row = (label, f, sub = '') => `<tr><td>${esc(label)}${sub ? `<br><span class="audit-note" style="margin:0">${esc(sub)}</span>` : ''}</td>${ms.map((m, i) => `<td class="num wrap">${f(m, i)}</td>`).join('')}</tr>`;
  const head = `<thead><tr><th>Measure</th>${ms.map((m, i) => `<th class="num"><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${OPT[i]};margin-right:4px"></i>${esc(m.node.name)}</th>`).join('')}</tr></thead>`;
  const land = m => { const fp = footprint(data.land?.intensity, S.tech, S.tech === 'datacenter' ? p.importMW : p.exportMW), sc = landScreen(data.land?.exclusions, m.node.id); return { need: fp?.base ?? null, clear: sc?.clear ?? null }; };
  // Per fuel: what "value" means (PV revenue for a hybrid, load cost for a data centre, TB4 for storage), and the verdict.
  const tech = S.tech, gen = ['solar', 'wind', 'hybrid'].includes(tech), th = thr(S), vs = verdictsFor(ms, tech, th), fl = fleetFor(S);
  const thRows = thresholdRows(th, FUEL_TESTS[tech] || []);
  const revLabel = tech === 'hybrid' ? 'PV energy revenue per year' : 'Energy revenue per year';
  const revCell = m => (ok(m.revenue.value) ? `${fmt.money(m.revenue.value)}${m.revenue.clippedAt ? ` <span class="audit-note">clipped at ${fmt.mw(m.revenue.clippedAt)}</span>` : ''}${m.revenue.pvOnly ? ' <span class="audit-note">PV only; battery value in Economics</span>' : ''}${m.revenue.shape === 'flat' ? ' <span class="audit-note">flat wind proxy</span>' : m.revenue.shape === 'fleet' ? ' <span class="audit-note">ISO-NE wind fleet shape</span>' : ''}` : `not held <span class="audit-note">${esc(m.revenue.reason || '')}</span>`);
  const loadCell = m => (ok(m.loadCost?.value) ? `${fmt.money(m.loadCost.value)} <span class="audit-note">${fmt.mw(m.loadCost.importMW)} flat, billed hour by hour (mean ${fmt.price(m.loadCost.mean)}), annualised on observed hours</span>` : `not held <span class="audit-note">${esc(m.loadCost?.reason || '')}</span>`);
  const tb4Cell = m => (ok(m.fuel?.tb4?.value) ? `${fmt.price(m.fuel.tb4.value)} <span class="audit-note">${fmt.int(m.fuel.tb4.days)} complete days</span>` : `not held <span class="audit-note">${esc(m.fuel?.reason || 'no complete day on this basis')}</span>`);
  const capRatio = m => ['clear-sky', 'fleet'].filter(b => tech !== 'wind' || b === 'fleet').map(b => { const c = b === 'fleet' ? m.fuel?.capture?.fleet : m.fuel?.capture?.clearSky; return `${b} ${ok(c?.ratio) ? `${(100 * c.ratio).toFixed(1)}%` : b === 'fleet' && fl.status === 'loading' ? 'loading' : 'not held'}`; }).join(' · ');
  const fuelPass = vs.map(v => v.filter(x => x.verdict === 'Pass').length);
  const fuelCard = () => card(8, `Per-fuel verdict: ${FUEL_NAME[tech] || tech}`, 'each test against the threshold in force; unknown holds, never passes', verdictTable(ms, vs, tech, th), { trace: 'd-fuel', answer: aFuel, chips: gen ? 'modelled assumption' : 'assumption', foot: `${fl.status === 'loading' ? 'Loading the ISO-NE fleet shape (second capture basis)… ' : ''}${gen ? 'Capture: clear-sky (modelled) and ISO-NE fleet shape; the governing basis is open decision #2, so bases that disagree Hold. Curtailment = POI clipping at the export limit (ISO curtailment is not held per bus). ' : ''}${tech === 'datacenter' ? 'LMP 2030 threshold defaults to the mean over the buses holding it (derived). ' : ''}Defaults are assumptions; enter your own in Thresholds.` });
  const thCard = () => card(4, 'Thresholds', 'defaults are assumptions; your entry overrides and is labelled "your input"', thresholdEditor(th, tech, S.ui), { chips: 'assumption', answer: aTh, foot: thresholdNotes(th, tech) });

  // Side by side (raw values), one row per measure; gates at the bottom.
  const side = `<div class="table-wrap"><table class="dense">${head}<tbody>
    ${row('Zone · voltage', m => `${esc(m.node.load_zone || '—')} · ${ok(m.node.nominal_kv) ? `${m.node.nominal_kv} kV` : 'kV not held'}`)}
    ${row('Price node (pricing tier)', m => esc(m.tier))}
    ${row('Export limit (Grid)', m => `${ok(m.exportLimit) ? fmt.mw(m.exportLimit) : 'not held'} <span class="audit-note">${esc(memoQualifiers(m, S.tech, data.land).exportLimit.replace(/^[^·]*· /, ''))}</span>`)}
    ${['storage', 'hybrid', 'datacenter'].includes(S.tech) ? row('Charge / import limit (Grid)', m => `${ok(m.importLimit) ? fmt.mw(m.importLimit) : 'not held'} <span class="audit-note">${esc(m.importStatus)}${m.sent ? ' · sent from Grid' : ''}</span>`) : ''}
    ${row('Upgrade cost at request', m => `${esc(costText(m.cost))} <span class="audit-note">${esc(m.cost.status)}</span>`)}
    ${tech === 'datacenter' ? row('Load cost per year', loadCell, 'energy only, flat load, applied basis') : tech === 'storage' ? row('TB4 spread', tb4Cell, 'daily top-4 minus bottom-4, applied basis; dispatch value in Economics') : row(revLabel, revCell, tech === 'hybrid' ? 'PV side, solar method at the export size' : 'energy only, applied basis')}
    ${tech === 'hybrid' ? row('TB4 spread (battery side)', tb4Cell, 'daily top-4 minus bottom-4, applied basis') : ''}
    ${gen ? row('Capture price', m => (ok(m.revenue.capture) ? fmt.price(m.revenue.capture) : 'not held')) : ''}
    ${gen ? row('Capture ratio', capRatio, tech === 'wind' ? 'fleet shape' : 'clear-sky · fleet shape') : ''}
    ${tech === 'storage' ? '' : row(tech === 'datacenter' ? 'Average price paid' : 'Average price', m => (ok(m.revenue.mean) ? fmt.price(m.revenue.mean) : ok(m.loadCost?.mean) ? fmt.price(m.loadCost.mean) : 'not held'))}
    ${row('Linked queue within 10 mi', m => (m.queueLinkedMW == null ? 'none linked' : `${fmt.mw(m.queueLinkedMW)} <span class="audit-note">${m.queueMatched} request(s); ${m.queueNotModelled ? `${fmt.mw(m.queueNotModelled)} not in the study` : 'all in the study'}</span>`), 'information only')}
    ${row('Land fit', m => { const l = land(m); return `${esc(m.land.status)}${ok(l.need) ? ` <span class="audit-note">need ${fmt.int(l.need)} ac · clear ${ok(l.clear) ? fmt.int(l.clear) + ' ac' : 'not held'}</span>` : ''}`; })}
    ${row('Limiting elements in its study', (m, i) => `${fmt.int(sh.counts[i])} <span class="audit-note">${sh.rows.filter(r => r.cells[i]).length} shared</span>`)}
    ${gs[0].map((g, gi) => row(`Gate: ${g.gate}`, (m, i) => `<span title="${esc(gs[i][gi].why)}">${vpill(gs[i][gi].verdict)}${gs[i][gi].qualifier ? ` <span class="audit-note" style="margin:0">${esc(gs[i][gi].qualifier)}</span>` : ''}</span>`)).join('')}
  </tbody></table></div>`;

  // Parallel raw bars (no combined score): each metric scaled on its own row.
  const pb = parallelBars([
    { label: 'Export limit', sub: 'Grid, MW', values: ms.map(m => m.exportLimit), fmt: fmt.mw },
    ...(['storage', 'hybrid', 'datacenter'].includes(S.tech) ? [{ label: 'Charge / import limit', sub: 'Grid, MW', values: ms.map(m => m.importLimit), fmt: fmt.mw }] : []),
    { label: 'Upgrade cost', sub: 'Priced only; $M', values: ms.map(m => (['Priced', 'True zero'].includes(m.cost.status) && ok(m.cost.total) ? m.cost.total : null)), fmt: v => `$${v.toFixed(2)}M` },
    ...(tech === 'datacenter' ? [{ label: 'Load cost', sub: '$/yr, flat load, applied basis', values: ms.map(m => m.loadCost?.value ?? null), fmt: fmt.money }, { label: 'Average price paid', sub: '$/MWh, applied basis', values: ms.map(m => m.loadCost?.mean ?? null), fmt: fmt.price }]
      : tech === 'storage' ? [{ label: 'TB4 spread', sub: '$/MWh, applied basis', values: ms.map(m => m.fuel?.tb4?.value ?? null), fmt: fmt.price }]
        : [{ label: tech === 'hybrid' ? 'PV energy revenue' : 'Energy revenue', sub: '$/yr, applied basis', values: ms.map(m => m.revenue.value ?? null), fmt: fmt.money },
          ...(tech === 'hybrid' ? [{ label: 'TB4 spread', sub: '$/MWh, battery side', values: ms.map(m => m.fuel?.tb4?.value ?? null), fmt: fmt.price }] : []),
          { label: 'Capture price', sub: '$/MWh', values: ms.map(m => m.revenue.capture ?? null), fmt: fmt.price },
          { label: 'Average price', sub: '$/MWh, applied basis', values: ms.map(m => m.revenue.mean ?? null), fmt: fmt.price }]),
    { label: 'Linked queue nearby', sub: 'MW within 10 mi', values: ms.map(m => m.queueLinkedMW), fmt: fmt.mw },
    { label: 'Clear land (screen)', sub: 'acres, habitat/protected only', values: ms.map(m => land(m).clear), fmt: v => `${fmt.int(v)} ac` },
    ...(P ? ['lmp_2030', 'tb4', 'hr_sp_dis'].filter(k => !['hr_sp_dis'].includes(k) || S.tech !== 'datacenter').map(k => { const r = P.pos.rows.find(x => x.key === k) || positionTable(P.pop, ms.map(m => String(m.node.id)), S.tech, [k]).rows[0]; return r ? { label: r.label, sub: `${r.unit}, ${r.source}`, values: r.cells.map(c => c.value), fmt: v => unitFmt(v, r.unit) } : null; }).filter(Boolean) : []),
  ], names);

  // Gate matrix heat table.
  const gm = `<div class="table-wrap"><table class="dense"><thead><tr><th>Gate</th>${ms.map((m, i) => `<th><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${OPT[i]};margin-right:4px"></i>${esc(m.node.name)}</th>`).join('')}</tr></thead><tbody>
    ${gs[0].map((g, gi) => `<tr><td>${esc(g.gate)}</td>${gs.map(x => `<td class="wrap" title="${esc(x[gi].why)}" style="${verdictBg(x[gi].verdict)}"><b>${esc(vText(x[gi]))}</b> <span class="audit-note" style="margin:0">${esc(x[gi].why.replace(/^(Grid|Land): /, '').length > 72 ? `${x[gi].why.replace(/^(Grid|Land): /, '').slice(0, 70)}…` : x[gi].why.replace(/^(Grid|Land): /, ''))}</span></td>`).join('')}</tr>`).join('')}
    <tr><td><b>Gates</b></td>${gs.map(x => { const t = gateTally(x); return `<td title="${esc(t.lines)}"><b class="${t.fail ? 'bad' : ''}">${esc(t.label)}</b></td>`; }).join('')}</tr>
  </tbody></table></div>`;

  // Map mini-view: options, 10-mi rings, and the linked queue requests matched to each.
  const qpts = data.queue ? ms.flatMap((m, i) => nearby(data.queue.queue, m.node, 10).map(x => ({ lat: x.q.latitude, lon: x.q.longitude, i, tip: `<b>${esc(x.q.poi_name || 'Queue request')}</b><br>#${esc(x.q.queue_position)} · ${esc(x.q.resource_type || '')} · ${fmt.mw(x.q.max_mw)}<br>${esc(x.q.status || '')} · ${ok(x.distance) ? x.distance.toFixed(1) + ' mi from ' : ''}${esc(m.node.name)}` }))) : [];
  const mapHtml = optionMap(ms.map(m => ({ name: m.node.name, lat: m.node.latitude, lon: m.node.longitude, tip: `<b>${esc(m.node.name)}</b> · ${esc(m.node.id)}<br>${esc(m.node.substation_name || '')} · ${esc(m.node.load_zone || '')}<br>${esc(m.tier)}` })), qpts, 10);

  // Market position (Studio 7.02): value + percentile among all buses, per measure, heat by the reading direction.
  const posBody = !P ? (popState === 'error' ? '<div class="notice error">The market-position population could not be read from the database.</div>' : loadingNote('the market-position population (all buses)')) : `<div class="table-wrap"><table class="dense">${head.replace('<th>Measure</th>', '<th>Measure</th><th>Reads</th><th class="num">Buses</th>')}<tbody>
      ${P.pos.rows.map(r => `<tr><td${r.note ? ` title="${esc(r.note)}"` : ''}>${esc(r.label)} <span class="audit-note" style="margin:0">${esc(r.unit)}</span><br><span class="audit-note" style="margin:0">${esc(r.source)}${r.key === 'cong' ? ' · signed; Rank uses |MCC| (D9)' : ''}</span></td><td>${r.higher ? '↑ higher' : '↓ lower'}</td><td class="num">${fmt.int(r.n)}</td>${r.cells.map(c => `<td class="num" style="${heatBg(c.oriented)}">${ok(c.value) ? `${esc(unitFmt(c.value, r.unit))}<br><span class="audit-note" style="margin:0">P${c.pct.toFixed(0)}</span>` : 'not held'}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>`;

  // Shared limiting elements (Studio 7.05).
  const shBody = sh.rows.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Monitored facility</th>${ms.map(m => `<th class="num">${esc(m.node.name)}</th>`).join('')}</tr></thead><tbody>
      ${sh.rows.slice(0, 14).map(r => `<tr><td class="wrap">${esc(r.facility)}</td>${r.cells.map(c => `<td class="num">${c ? (c.pre ? '<span class="pill warn">pre-existing</span>' : ok(c.transfer) ? fmt.mw(c.transfer) : 'no usable transfer') + `<br><span class="audit-note" style="margin:0">${ok(c.loading) ? `${c.loading.toFixed(1)}% loaded` : ''}${ok(c.dfax) ? ` · DFAX ${c.dfax.toFixed(3)}` : ''}</span>` : '<span class="audit-note">not in its study</span>'}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>${sh.rows.length > 14 ? `<p class="audit-note">${sh.rows.length - 14} more in the CSV.</p>` : ''}`
    : `<div class="empty"><strong>No facility is shared</strong>${ms.length < 2 ? 'Add a second option to see the limits they share.' : `The element studies of the requested cases name ${sh.counts.map((c, i) => `${c} facilities at ${esc(names[i])}`).join(', ')}; none is common to two options.`}</div>`;

  // Studio copy vs unified DB (data notes).
  const stRows = ms.flatMap((m, i) => (notesPer[i] || []).filter(n => n.state !== 'same').map(n => ({ i, n })));
  const stState = ms.map((m, i) => (studios[i].state === 'ok' ? (P ? `${(notesPer[i] || []).filter(n => n.state === 'same').length} agree` : 'loading') : studios[i].state === 'nh' ? 'not in the Studio copy' : studios[i].state === 'loading' ? 'loading' : 'could not be read'));
  const stBody = `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11.5px;color:var(--ink-3)">${ms.map((m, i) => `<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${OPT[i]};margin-right:4px"></i>${esc(m.node.name)}: ${esc(stState[i])}</span>`).join('')}</div>
    ${stRows.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Option</th><th>Field</th><th class="num">Studio copy</th><th class="num">Unified</th><th>State</th><th>Note</th></tr></thead><tbody>${stRows.map(({ i, n }) => `<tr><td><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${OPT[i]};margin-right:4px"></i>${esc(names[i])}</td><td>${esc(n.label)}</td><td class="num">${typeof n.studio === 'number' ? esc(+n.studio.toFixed(3)) : esc(n.studio ?? 'not held')}</td><td class="num">${ok(n.unified) ? esc(+n.unified.toFixed(3)) : n.state === 'excluded' ? '—' : 'not held'}</td><td><span class="pill ${n.state === 'differs' ? 'warn' : ''}">${esc(n.state)}</span></td><td class="wrap"><span class="audit-note" style="margin:0">${esc(n.note)}</span></td></tr>`).join('')}</tbody></table></div>` : P ? '<p class="audit-note">No difference between the two sources for these options.</p>' : loadingNote('the Studio copy')}`;
  const stMeta = studios.find(s => s.state === 'ok')?.data.meta;

  // v6: per-option percentile strips on the deciding measures (positionTable's percentiles; context rows, no score)
  const strips = P ? ms.map((m, i) => ({ m, i, s: positionStrip(P.pos, P.pop, i) })) : [];
  const stripBody = P ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:10px 18px">${strips.map(x => `<div><h4 style="margin:0 0 6px;font-size:12.5px;color:var(--ink-2)"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${OPT[x.i]};margin-right:5px"></i>${esc(x.m.node.name)} <span class="audit-note" style="margin:0">better half on ${x.s.better} of ${x.s.held}</span></h4>${percentileStrip(x.s.rows)}</div>`).join('')}</div>` : (popState === 'error' ? '<div class="notice error">The market-position population could not be read from the database.</div>' : loadingNote('the market-position population (all buses)'));
  // v6 answers
  const gp = gs.map(g => gateCounts(g).Pass);
  const aOpts = `${B(ms.length)} option${ms.length === 1 ? '' : 's'} on one basis: ${names.map(n => B(n)).join(', ')}.${ms.length < 2 ? ' Add a second option to compare.' : ''}`;
  const aGates = `${B(`${allPass.filter(Boolean).length} of ${ms.length}`)} options pass every gate; ${names.map((n, i) => `${esc(n)} passes ${B(`${gp[i]} of ${gs[i].length}`)}`).join(', ')}. Unknown holds, never passes.`;
  const valueLead = tech === 'datacenter' ? (() => { const w = ms.filter(m => ok(m.loadCost?.value)).sort((a, z) => a.loadCost.value - z.loadCost.value)[0]; return w ? `lowest load cost ${B(w.node.name)} (${B(fmt.money(w.loadCost.value))}/yr)` : 'no load cost held'; })()
    : tech === 'storage' ? (() => { const w = ms.filter(m => ok(m.fuel?.tb4?.value)).sort((a, z) => z.fuel.tb4.value - a.fuel.tb4.value)[0]; return w ? `widest TB4 ${B(w.node.name)} (${B(fmt.price(w.fuel.tb4.value))}/MWh)` : 'no TB4 held'; })()
      : withRev[0] ? `highest ${tech === 'hybrid' ? 'PV ' : ''}revenue ${B(withRev[0].node.name)} (${B(fmt.money(withRev[0].revenue.value))}/yr)` : 'no revenue held';
  const aRaw = `Largest export limit: ${withLim[0] ? `${B(withLim[0].node.name)} (${B(fmt.mw(withLim[0].exportLimit))})` : 'not held'}; ${valueLead}.`;
  const bestF = fuelPass.length ? fuelPass.indexOf(Math.max(...fuelPass)) : -1;
  const aFuel = bestF >= 0 && (FUEL_TESTS[tech] || []).length ? `${B(names[bestF])} passes the most per-fuel tests: ${B(`${fuelPass[bestF]} of ${(FUEL_TESTS[tech] || []).length}`)}.` : 'No per-fuel test applies.';
  const nUser = thRows.filter(r => /your input/i.test(r.sourceLabel || '')).length;
  const capTh = thRows.find(r => r.key === 'capture'), capCount = capTh ? capturePassCount(popData(), capTh.value) : null;
  const aTh0 = thRows.length ? `${B(thRows.length)} threshold${thRows.length === 1 ? '' : 's'} in force: ${B(nUser)} your input, the rest defaults (assumptions or derived).` : 'No per-fuel threshold for this technology.';
  // F003: an unset capture threshold says whose decision it is; an entered one is shown beside the market pass count.
  const aTh = capTh && !ok(capTh.value) ? `${aTh0} The capture threshold is ${B('not set')}: open decision #2 (which basis governs, what ratio is acceptable) is Ganesh's to agree, so Capture holds.` : capCount ? `${aTh0} ${esc(capCount.text)}.` : aTh0;
  const noLim = ms.filter(m => !ok(m.exportLimit)).length, nhCost = ms.filter(m => !['Priced', 'True zero'].includes(m.cost.status)).length;
  const aSide = `Raw values from each home dashboard: ${noLim ? `${B(noLim)} option${noLim === 1 ? ' holds' : 's hold'} no export limit` : B('every option holds an export limit')}, and ${B(`${ms.length - nhCost} of ${ms.length}`)} have a priced (or true $0) upgrade cost.`;
  const aMap = `${B(qpts.length)} linked queue request${qpts.length === 1 ? ' lies' : 's lie'} within 10 mi: ${names.map((n, i) => `${esc(n)} ${B(qpts.filter(q => q.i === i).length)}`).join(', ')}.`;
  const bestPos = strips.slice().sort((a, b) => b.s.better - a.s.better)[0];
  const aPos = !P ? 'The market-position population is loading.' : bestPos ? `${B(bestPos.m.node.name)} sits in the better half of ISO-NE on the most deciding measures (${B(`${bestPos.s.better} of ${bestPos.s.held}`)})${bestPos.s.best ? `, strongest on ${B(bestPos.s.best.label)}` : ''}.` : 'No option holds a deciding measure.';
  const c0 = strips[0]?.s;
  const aPosT = !P ? 'The market-position population is loading.' : c0?.best ? `${B(names[0])} is strongest on ${B(c0.best.label)} and weakest on ${B(c0.worst.label)} (reading direction)${c0.notHeld ? `; ${B(c0.notHeld)} measure${c0.notHeld === 1 ? ' is' : 's are'} not held` : ''}.` : `${B(names[0])} holds none of the deciding measures.`;
  const aShared = ms.length < 2 ? 'Add a second option to see the limits they share.' : `${B(fmt.int(sh.rows.length))} monitored facilit${sh.rows.length === 1 ? 'y is' : 'ies are'} named in two or more options' element studies.`;
  const aStudio = stRows.length ? `${B(stRows.length)} figure${stRows.length === 1 ? '' : 's'} differ between the Studio copy and the unified database; the unified value is used.` : P ? 'No difference between the two sources for these options.' : 'The Studio copy is loading.';
  const pF = { ...p, fleet: fleetData(S) };
  const traces = `${traceCompare(data, S, ms, gs, pF, lossLabel(S))}${traceFuel(data, S.basis, ms, vs, tech, thRows, p)}${P ? tracePosition(data, P.pos, ms, P.pop) : ''}${traceShared(sh, ms)}${atLeast(S, 'study') ? traceStudio(names, notesPer, stMeta) : ''}`;
  // Value KPI per fuel: energy revenue (PV revenue for a hybrid), load cost for a data centre (lowest leads), TB4 for storage.
  const valueKpi = () => {
    if (tech === 'datacenter') { const w = ms.filter(m => ok(m.loadCost?.value)).sort((a, z) => a.loadCost.value - z.loadCost.value); return kpi('Lowest load cost', w[0] ? fmt.money(w[0].loadCost.value) : 'not held', w[0] ? '/yr' : '', w[0] ? `${w[0].node.name} · flat ${fmt.mw(p.importMW)} at ${fmt.price(w[0].loadCost.mean)}/MWh${w[1] ? ` · next ${fmt.money(w[1].loadCost.value)}` : ''}` : 'No option holds a price on this basis'); }
    if (tech === 'storage') { const w = ms.filter(m => ok(m.fuel?.tb4?.value)).sort((a, z) => z.fuel.tb4.value - a.fuel.tb4.value); return kpi('Widest TB4 spread', w[0] ? fmt.price(w[0].fuel.tb4.value) : 'not held', w[0] ? '/MWh' : '', w[0] ? `${w[0].node.name} · arbitrage room; dispatch value in Economics` : 'No complete day on this basis'); }
    return kpi(tech === 'hybrid' ? 'Highest PV revenue' : 'Highest energy revenue', withRev[0] ? fmt.money(withRev[0].revenue.value) : 'not held', withRev[0] ? '/yr' : '', withRev[0] ? `${withRev[0].node.name} · ${(st0 => (st0 ? `Economics stack: ${st0.label} · ` : 'energy only (no Economics stack sent for this bus) · '))(econRevenueStack(S, withRev[0].node.id, tech))}${withRev.length > 1 ? `next ${fmt.money(withRev[1].revenue.value)}` : 'only one option has revenue'}${tech === 'hybrid' ? ' · PV side only' : ''}` : 'No option has comparable revenue');
  };
  return `${failedNotice(ctx)}${staleNotice(ms)}<div class="kpis">
      ${kpi('Options passing every gate', `${allPass.filter(Boolean).length} of ${ms.length}`, '', 'Unknown is Hold, never Pass')}
      ${valueKpi()}
      ${kpi('Per-fuel tests passed', ms.length ? `${Math.max(...fuelPass)} of ${(FUEL_TESTS[tech] || []).length}` : '—', '', ms.length ? `best option · ${names.map((n, i) => `${n} ${fuelPass[i]}`).join(' · ')}` : '')}
      ${tech === 'datacenter' ? kpi('Largest import limit', (() => { const w = ms.filter(m => ok(m.importLimit)).sort((a, z) => z.importLimit - a.importLimit)[0]; return w ? fmt.mw(w.importLimit) : 'not held'; })(), '', `request ${fmt.mw(p.importMW)}`) : kpi('Largest export limit', withLim[0] ? fmt.mw(withLim[0].exportLimit) : 'not held', '', withLim[0] ? `${withLim[0].node.name} · request ${fmt.mw(p.exportMW)}` : 'No option holds a limit')}
      ${kpi('Shared limiting elements', ms.length > 1 ? fmt.int(sh.rows.length) : '—', '', ms.length > 1 ? 'Facilities in two or more options\' studies' : 'Add a second option')}
      ${kpi('Options on hold or failing', fmt.int(allPass.filter(x => !x).length), '', 'See the gate matrix for what is missing')}
    </div>
    <div class="cards">
      ${card(12, 'Options compared', 'the candidate plus up to two; pinned buses add with one click', `${picker(data, S)}${waiting.length ? loadingNote(`${waiting.length} option(s)`) : ''}`, { depth: 'screen', answer: aOpts, foot: `Common basis: ${basisLine(S, p)}` })}
      ${card(6, 'Gate matrix', 'Fail on a known breach · Hold on anything unknown · Pass only when all is known', `${gm}<h4 style="margin:4px 0 0;font-size:11px;color:var(--ink-3);letter-spacing:.05em">VERDICTS PER OPTION</h4>${stackBars(ms.map((x, i) => ({ label: names[i], counts: gateCounts(gs[i]) })), ['Pass', 'Hold', 'Fail'])}<h4 style="margin:4px 0 0;font-size:11px;color:var(--ink-3);letter-spacing:.05em">NOT PASSED, BY GATE</h4>${stackBars(gs[0].map((g, gi) => ({ label: g.gate, counts: { Hold: gs.filter(x => x[gi].verdict === 'Hold').length, Fail: gs.filter(x => x[gi].verdict === 'Fail').length } })), ['Hold', 'Fail'])}`, { depth: 'screen', trace: 'd-compare', answer: aGates, chips: ms.some(m => m.envelopeOnly.length) ? 'envelope-only' : '', foot: 'Envelope-only Connect is Hold; Queue exposure is never Pass; Land holds on a habitat/protected-only fit; "No upgrades indicated" carries no dollar figure. Gate 6 Capture names its basis.' })}
      ${card(6, 'Raw metrics per option', 'each row scaled to its own largest value; rows never added', pb, { depth: 'screen', trace: 'd-compare', answer: aRaw, foot: 'Parallel bars replace a combined score: units differ by row, so no row is weighted against another.' })}
      ${fuelCard()}
      ${thCard()}
      ${card(8, 'Side by side (raw values)', 'each value from its home dashboard; no combined score', side, { trace: 'd-compare', answer: aSide, chips: `${ms.some(m => /borrowed/.test(m.tier)) ? 'geo-proxy ' : ''}${ms.some(m => m.envelopeOnly.length) ? 'envelope-only ' : ''}${gen ? 'modelled' : ''}`.trim(), foot: `${tech === 'datacenter' ? 'Load cost is energy only (no capacity, transmission or retail charges): a flat import billed hour by hour on the applied basis, annualised on observed hours (the Economics load-cost definition).' : tech === 'storage' ? 'Storage is compared on the TB4 spread; revenue needs dispatch (Economics › BESS dispatch).' : `Revenue is energy only (no RECs or capacity)${tech === 'hybrid' ? '; for a hybrid it is the PV side only' : ''}.`} At Cape buses the 5-yr run is not used in comparisons. Queue exposure is information: only the linked subset of the register can be matched to a bus.` })}
      ${card(4, 'Options on the map', 'with linked queue requests within 10 mi', mapHtml, { answer: aMap, foot: `${qpts.length} linked request(s) shown. Scroll to zoom, drag to pan. Basemap: public-domain Census/Natural Earth. Queue: ${esc(data.queue?.source || 'queue.json')}.` })}
      ${card(12, 'Where each option sits in the market', 'each deciding measure against every ISO-NE bus: P5–P95 band, median, this option', stripBody, { trace: 'd-position', answer: aPos, foot: 'A profile, not a score: rows are context (no requirement), each stands alone, and a not-held value is written, never drawn at zero. The table below is the same data.' })}
      ${card(12, 'Market position on the deciding measures', `${esc(S.tech)} set · percentile among all buses holding the measure`, posBody, { trace: 'd-position', answer: aPosT, foot: P ? `Unified DB marts, ${P.pop.year} settled RT and the PCR runs. Shading follows the reading direction (darker = better placed); it is never summed. ${esc(P.pop.note)}` : '' })}
      ${card(sh.rows.length ? 12 : 4, 'Shared limiting elements', 'facilities named in two or more options\' element studies', shBody, { depth: 'study', trace: 'd-shared', answer: aShared, foot: 'unified fact_limiting_element · requested cases only · shoulder export rows are mislabelled in the store and not read.' })}
      ${card(sh.rows.length ? 12 : 8, 'Studio copy against the unified database', 'where the live Studio\'s older copy differs', stBody, { depth: 'study', trace: 'd-studio', chips: 'studio-copy', answer: aStudio, foot: `The unified DB is primary; the Studio copy is never used in a comparison.${stMeta ? ` Studio copy built ${esc(stMeta.built_at)} from ${esc(stMeta.source)}.` : ''}` })}
      ${traceCard(traces)}
    </div>
    ${nextStep('decision', 'stress', 'see whether the leader holds across price paths in Decision › Stress test')}`;
}

// ---------- Tab 2: Stress test ----------
function tabStress(ctx) {
  const { data, S } = ctx, waiting = pendingOptions(ctx);
  if (waiting.length) return `<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Loading ${waiting.length} option(s)</b><span>Hourly prices are read from the local database the first time.</span></div>`;
  const opts = chosen(data, S), p = params(S), fails = failedNotice(ctx);
  const metric = stressMetric(p.tech), lowerBetter = metric === 'price';
  const fmtV = metric === 'revenue' ? fmt.money : fmt.price;
  const mLabel = { revenue: p.tech === 'hybrid' ? 'PV energy revenue per year' : 'Energy revenue per year', tb4: 'TB4 spread (storage)', price: 'Average price (load pays)' }[metric];
  const ms = metricsFor(data, S), limitOf = n => ms.find(x => String(x.node.id) === String(n.id))?.exportLimit ?? null;
  const cy = commonYears(data, opts), years = cy.years, runs = commonRuns(data, opts);
  const scen = [{ label: `Applied basis: ${describe(S.basis)}`, short: 'Applied basis', basis: S.basis, applied: true },
    ...years.map(y => ({ label: `${y} actual`, short: `${y} actual`, year: y, basis: { mode: 'historical', market: 'RT', years: [y], weighting: 'duration', weights: {}, strict: true, includePartial: false } })),
    ...runs.map(r => ({ label: LABELS[r.run] || r.run, short: (LABELS[r.run] || r.run).replace(' (12% gas case)', ' (12% gas)'), run: r.run, basis: { mode: 'forecast', market: 'model', run: r.run, years: [r.year], weighting: 'duration', weights: {}, strict: true, includePartial: true } }))];
  // Every cell goes through stressCell (Cape 5-yr exclusion); the key carries each option's limit and the Grid hand-off.
  const sentAt = S.handoffs.grid?.at || null;
  // Wind revenue uses the ISO-NE fleet shape once it is loaded (the Economics method); the key records which.
  const pS = { ...p, fleet: fleetData(S) };
  const cells = scen.map(sc => opts.map(n => memo(JSON.stringify(['stress', n.id, p, sc.basis, limitOf(n), sentAt, !!pS.fleet]), () => stressCell(data, n, sc.basis, pS, limitOf(n)))));
  const table = scen.map((sc, i) => ({ sc, vals: cells[i].map(c => c.value ?? null) }));
  const names = opts.map(n => n.name), st = stressLeaders(table, names, { lowerBetter }), leaders = st.rows.map(r => r.leader), base = st.base;
  const ranges = scenarioRanges(table, { lowerBetter });
  const leaderCell = r => (r.leader != null ? `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${OPT[r.leader]};margin-right:4px"></i>${esc(opts[r.leader].name)}` : `— <span class="audit-note">${esc(r.reason || 'no value')}</span>`);
  const widest = ranges.map((r, j) => ({ j, r })).filter(x => ok(x.r.spread)).sort((a, b) => b.r.spread - a.r.spread)[0];
  const worst = ranges.map((r, j) => ({ j, r })).filter(x => ok(x.r.downsidePct)).sort((a, b) => (lowerBetter ? b.r.downsidePct - a.r.downsidePct : a.r.downsidePct - b.r.downsidePct))[0];

  // Independent checks: each settled-year cell's mean price (and TB4) against the unified marts (outlook).
  const outs = opts.map(n => dx('outlook', String(n.id)));
  const checks = [];
  opts.forEach((n, j) => {
    const o = outs[j].state === 'ok' ? outs[j].data : null; if (!o) return;
    scen.forEach((sc, i) => {
      if (!sc.year) return;
      const h = o.hist.find(x => x.market === 'RT' && x.year === sc.year), c = cells[i][j];
      if (h && ok(c.mean)) checks.push({ label: `Independent check: ${n.name} ${sc.year} mean price from the hourly series vs mart_bus_year`, a: c.mean, b: h.avg_lmp, tol: 1e-6, fmt: fmt.price });
      // TB4: the storage metric, or the hybrid's battery-side figure carried on the revenue cell.
      const tb = metric === 'tb4' ? c.value : p.tech === 'hybrid' ? c.tb4 : null;
      if (h && ok(h.tb4) && ok(tb)) checks.push({ label: `Independent check: ${n.name} ${sc.year} TB4 from the hourly series vs mart_bus_tb`, a: tb, b: h.tb4, tol: 1e-6, fmt: fmt.price });
    });
  });

  // Secondary scenario view: capture price (solar/wind) or average price (storage).
  const second = p.tech === 'hybrid' ? { title: 'TB4 spread by scenario (battery side)', sub: 'daily top-4 minus bottom-4, $/MWh', vals: cells.map(r => r.map(c => c.tb4 ?? null)) }
    : metric === 'revenue' ? { title: 'Capture price by scenario', sub: 'generation-weighted $/MWh on the same shape', vals: cells.map(r => r.map(c => c.capture ?? null)) }
    : metric === 'tb4' ? { title: 'Average price by scenario', sub: 'observed-hour weighted $/MWh', vals: cells.map(r => r.map(c => c.mean ?? null)) } : null;

  // Annual price record per option (unified marts): settled RT years and every forecast run.
  const outLoaded = outs.filter(o => o.state === 'ok').length;
  // Annual price record as grouped bars: settled RT years (full years only), then the PCR runs by target year.
  const recKeys = [...new Set(outs.flatMap(o => (o.state === 'ok' ? [...o.data.hist.filter(h => h.market === 'RT' && h.n_hours >= 8700).map(h => `h|${h.year}`), ...o.data.fcst.filter(f => /^pcr/.test(f.run)).map(f => `f|${f.run}|${f.year}`)] : [])))]
    .sort((x, y) => Number(x.split('|').at(-1)) - Number(y.split('|').at(-1)));
  const recGroups = recKeys.map(k => { const [kind, a, yr] = k.split('|'); return { label: kind === 'h' ? `${a} settled` : `${yr} PCR`, values: outs.map(o => { if (o.state !== 'ok') return null; const r = kind === 'h' ? o.data.hist.find(h => h.market === 'RT' && h.year === Number(a)) : o.data.fcst.find(f => f.run === a); return r ? r.avg_lmp : null; }) }; });
  const outlookTable = outLoaded ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Run</th><th class="num">Year</th>${opts.map(n => `<th class="num">${esc(n.name)}</th>`).join('')}</tr></thead><tbody>${[...new Set(outs.flatMap(o => (o.state === 'ok' ? o.data.fcst.map(f => `${f.run}|${f.year}`) : [])))].map(k => { const [run, y] = k.split('|'); return `<tr><td>${esc((LABELS[run] || run).replace(/ forecast/, ''))}${run === '5yr' ? ' <span class="audit-note" style="margin:0">(not compared)</span>' : ''}</td><td class="num">${y}</td>${outs.map(o => { const f = o.state === 'ok' ? o.data.fcst.find(x => x.run === run) : null; return `<td class="num">${f ? `${fmt.price(f.avg_lmp)}<br><span class="audit-note" style="margin:0" title="p5 ${fmt.price(f.p5)} · p95 ${fmt.price(f.p95)} · ${fmt.int(f.neg_hours)} negative hours">${Math.round(f.p5)}–${Math.round(f.p95)} · ${fmt.int(f.neg_hours)}h&lt;0</span>` : 'not held'}</td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div>` : '';

  const downside = `<div class="table-wrap"><table class="dense"><thead><tr><th>Option</th><th class="num">Applied</th><th class="num">Worst</th><th>Worst scenario</th><th class="num">Change</th><th class="num">Best</th><th class="num">Spread</th></tr></thead><tbody>
    ${ranges.map((r, j) => `<tr><td><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${OPT[j]};margin-right:4px"></i>${esc(names[j])}${r.missing ? `<br><span class="audit-note" style="margin:0">${r.missing} scenario(s) not held</span>` : ''}</td><td class="num">${fmtV(r.applied)}</td><td class="num">${fmtV(r.worst)}</td><td>${esc(r.worstLabel || '—')}</td><td class="num" style="${ok(r.downsidePct) && (lowerBetter ? r.downsidePct > 0 : r.downsidePct < 0) ? 'color:var(--bad)' : ''}">${ok(r.downsidePct) ? `${r.downsidePct >= 0 ? '+' : ''}${r.downsidePct.toFixed(1)}%` : 'not held'}</td><td class="num">${fmtV(r.best)}</td><td class="num">${fmtV(r.spread)}</td></tr>`).join('')}
  </tbody></table></div>`;

  const leaderTbl = `<div class="table-wrap"><table class="dense"><thead><tr><th>Scenario</th><th>Leader</th><th>Changed?</th></tr></thead><tbody>
    ${table.map((r, i) => `<tr${r.sc.applied ? ' class="hl"' : ''}><td>${esc(r.sc.short)}</td><td>${leaderCell(st.rows[i])}</td><td>${i === 0 ? '<span class="audit-note">reference</span>' : st.rows[i].leader == null || base == null ? '<span class="audit-note">not counted</span>' : st.rows[i].leader !== base ? '<span class="pill warn">leader changes</span>' : '<span class="pill good">same leader</span>'}</td></tr>`).join('')}
  </tbody></table></div>`;

  const fullTbl = `<div class="table-wrap"><table class="dense"><thead><tr><th>Scenario</th>${opts.map(n => `<th class="num">${esc(n.name)}</th>`).join('')}<th>Leader</th></tr></thead><tbody>
    ${table.map((r, i) => `<tr${r.sc.applied ? ' class="hl"' : ''}><td>${esc(r.sc.label)}</td>${cells[i].map(c => `<td class="num">${ok(c.value) ? fmtV(c.value) : `not held${c.reason ? `<br><span class="audit-note" style="margin:0">${esc(c.reason.slice(0, 80))}</span>` : ''}`}${metric === 'revenue' && ok(c.capture) ? `<br><span class="audit-note" style="margin:0">capture ${fmt.price(c.capture)}${p.tech === 'hybrid' ? ` · TB4 ${ok(c.tb4) ? fmt.price(c.tb4) : 'not held'}` : ''}${c.shape === 'flat' ? ' · flat wind proxy' : ''}</span>` : ''}</td>`).join('')}<td>${leaderCell(st.rows[i])}</td></tr>`).join('')}
  </tbody></table></div>`;

  // v6 answers
  const aLead = base != null ? `${B(opts[base].name)} leads on the applied basis; another option leads in ${B(`${st.other} of ${st.comparable}`)} comparable scenarios (counts, not probabilities).` : `No option leads on the applied basis${st.rows[0]?.reason ? `: ${esc(st.rows[0].reason)}` : ''}.`;
  const aLeadT = `The leader changes in ${B(`${st.other} of ${st.comparable}`)} comparable scenarios${scen.length - 1 - st.comparable ? `; ${B(scen.length - 1 - st.comparable)} are not comparable` : ''}.`;
  const aRange = widest ? `${B(names[widest.j])} has the widest range: ${B(fmtV(widest.r.min))} to ${B(fmtV(widest.r.max))}.` : 'No option holds two scenarios: no range.';
  const aDown = worst ? `Worst downside: ${B(names[worst.j])} moves ${B(`${worst.r.downsidePct >= 0 ? '+' : ''}${worst.r.downsidePct.toFixed(1)}%`)} against the applied basis in ${esc(worst.r.worstLabel)}.` : 'No applied value to compare against.';
  const sec0 = second ? second.vals[0].map((v, j) => ({ v, j })).filter(x => ok(x.v)).sort((a, b) => b.v - a.v)[0] : null;
  const aSecond = second ? (sec0 ? `On the applied basis ${B(names[sec0.j])} is highest: ${B(fmt.price(sec0.v))}/MWh.` : 'Not held on the applied basis.') : '';
  const aRec = outLoaded ? `Annual records are held for ${B(`${outLoaded} of ${opts.length}`)} options across ${B(recGroups.length)} settled years and PCR runs.` : 'The annual price record is loading.';
  const nh = cells.flat().filter(c => !ok(c.value)).length;
  const aFull = `${B(scen.length)} scenarios × ${B(opts.length)} options; ${B(nh)} cell${nh === 1 ? '' : 's'} not held (written, never zero).`;
  const nRuns = [...new Set(outs.flatMap(o => (o.state === 'ok' ? o.data.fcst.map(f => f.run) : [])))].length;
  const aRuns = outLoaded ? `${B(nRuns)} forecast run${nRuns === 1 ? '' : 's'} are held across the options; the 5-yr run is shown but never compared.` : 'The forecast runs are loading.';
  const traces = `${traceStress(opts, table, st, leaders, base, { metric, fmtV, lowerBetter, checks })}${traceRange(names, table, ranges, { fmtV, lowerBetter })}`;
  return `${fails}${staleNotice(ms)}<div class="kpis">
      ${kpi('Price scenarios', fmt.int(scen.length - 1), '', `${years.length} complete years + ${runs.length} forecast runs held for every option${st.comparable < scen.length - 1 ? ` · ${scen.length - 1 - st.comparable} not comparable` : ''}`)}
      ${kpi('Led by another option', `${fmt.int(st.other)} of ${fmt.int(st.comparable)}`, '', base != null ? `Comparable scenarios where ${opts[base].name} (leader on the applied basis) is not first` : `No leader on the applied basis${st.rows[0]?.reason ? `: ${st.rows[0].reason}` : ''}`)}
      ${kpi('Leader on the applied basis', base != null ? opts[base].name : '—', '', `${mLabel}; counts are not probabilities`)}
      ${kpi('Widest range', widest ? fmtV(widest.r.spread) : 'not held', '', widest ? `${names[widest.j]}: ${fmtV(widest.r.min)} to ${fmtV(widest.r.max)}` : 'No option holds two scenarios')}
      ${kpi('Worst downside vs applied', worst ? `${worst.r.downsidePct >= 0 ? '+' : ''}${worst.r.downsidePct.toFixed(1)}%` : 'not held', '', worst ? `${names[worst.j]} in ${worst.r.worstLabel}` : 'No applied value to compare against')}
    </div>
    ${cy.reason && !years.length ? `<div class="notice">${esc(cy.reason.charAt(0).toUpperCase() + cy.reason.slice(1))}.</div>` : ''}
    ${p.tech === 'hybrid' ? '<div class="notice">Hybrid options are stressed on PV energy revenue (the solar method at the export size); the battery side is shown as the TB4 spread by scenario. Combined value is in Economics › Hybrid sizing.</div>' : ''}
    ${metric !== 'revenue' ? `<div class="notice">${metric === 'tb4' ? 'Storage options are stressed on the TB4 spread (the daily top-4 minus bottom-4 price, the battery\'s arbitrage room). Dispatch value is in Economics › BESS dispatch.' : 'A data centre is a load: options are stressed on the average price it pays, and the lowest leads.'}</div>` : ''}
    <div class="cards">
      ${card(8, `${mLabel} by scenario`, `${lowerBetter ? 'lower' : 'higher'} leads · one bar per option`, groupedBar(table.map(r => ({ label: r.sc.short, values: r.vals, highlight: r.sc.applied })), { series: names, fmt: v => fmtV(v), title: `${mLabel} by scenario`, xLabel: 'Scenario', height: 270 }), { depth: 'screen', trace: 'd-stress', answer: aLead, chips: metric === 'revenue' ? 'modelled' : '' })}
      ${card(4, 'Leader by scenario', 'where the order changes', leaderTbl, { depth: 'screen', trace: 'd-stress', answer: aLeadT, foot: 'A scenario where any option has no value is not comparable and is not counted.' })}
      ${card(6, 'Sensitivity range per option', 'min–max across every scenario held', rangeBars(ranges.map((r, j) => ({ ...r, name: names[j] })), { fmt: fmtV, lowerBetter }), { trace: 'd-range', answer: aRange })}
      ${card(6, 'Downside against the applied basis', 'worst scenario, change and spread', downside, { trace: 'd-range', answer: aDown, foot: 'Ranges and changes are across the listed price paths; no probability is attached to any of them.' })}
      ${second ? card(6, second.title, second.sub, groupedBar(scen.map((sc, i) => ({ label: sc.short, values: second.vals[i], highlight: sc.applied })), { series: names, fmt: fmt.price, title: second.title, xLabel: 'Scenario', height: 230 }), { trace: 'd-stress', answer: aSecond }) : ''}
      ${card(second ? 6 : 12, 'Annual price record', 'average LMP: settled RT years, then the PCR forecast runs (unified marts)', outLoaded ? groupedBar(recGroups, { series: names, fmt: v => fmt.price(v), title: 'Annual price record', xLabel: 'Year', height: 230 }) : loadingNote('the annual price record'), { chips: 'modelled', answer: aRec, foot: 'Settled years with fewer than 8,700 hours (the current year) are left out. The 5-yr run (2028) is shown in the table, never used in comparisons.' })}
      ${card(8, 'Every scenario, every option', `${mLabel}; blank = not held`, fullTbl, { depth: 'study', trace: 'd-stress', answer: aFull, foot: 'Only years complete for every option, and forecast runs held for every option, are used, so all options face the same scenarios. The 2040 run is the 12% gas case; the 5-yr run is left out (offshore-wind input under review).' })}
      ${card(4, 'Forecast runs per option', 'annual mean; p5–p95 $/MWh and negative hours', outLoaded ? outlookTable : loadingNote('the forecast runs'), { depth: 'study', chips: 'modelled', answer: aRuns, foot: 'mart_bus_fcst_year + dim_scenario (unified).' })}
      ${traceCard(traces)}
    </div>
    ${nextStep('decision', 'readiness', 'close the open evidence in Decision › Readiness & actions')}`;
}

// ---------- Tab 3: Readiness & actions ----------
/** S3 #4: the site-control evidence row from rules/isone.js siteControlGate on the Queue's own inputs (one home with the
 *  Queue › Cash site card and Land): Pass → Current, Fail → Incomplete, Open → Missing. A load has no such rule: null. */
export function siteControlEvidence(S) {
  const q = queueInputs(S);
  const g = RX.siteControlGate({ pct: q.sitePct, service: q.service, regulatoryLimitation: q.regulatoryLimitation, tech: q.tech, profile: q.profile });
  if (g.verdict === 'n/a') return null;
  const status = g.verdict === 'Pass' ? 'Current' : g.verdict === 'Fail' ? 'Incomplete' : 'Missing';
  return { name: `Site control at request (${ok(g.required) ? `${g.required}%` : 'required share not held'})`, status, where: 'Land › Permits & site control', at: null,
    why: `${g.reason}${g.via === 'deposit in lieu' ? '' : ''} · ${g.cite?.text || 'not held'}`, verdict: g.verdict, required: g.required ?? null, via: g.via ?? null };
}
function evidence(data, S) {
  const same = h => h && String(h.busId) === String(S.nodeId);
  const size = Number(S.tech === 'datacenter' ? S.importMW : S.exportMW);
  const item = (name, h, check, where, incomplete) => {
    const status = !h ? 'Missing' : !same(h) ? 'Missing (other bus)' : !check(h) ? 'Needs refresh' : incomplete && incomplete(h) ? 'Incomplete' : 'Current';
    return { name, status, where, at: h?.at };
  };
  return [
    { name: `Price basis applied (snapshot ${data.metadata.createdAt?.slice(0, 10)})`, status: S.basis ? 'Current' : 'Missing', where: 'Prices › LMP & years', at: null },
    item('Connection limits sent to Economics', S.handoffs.grid, h => h.tech === S.tech && Number(h.requestMW) === Number(S.exportMW), 'Grid › Connection capacity'),
    item('Upgrade-cost scenario', S.handoffs.cost, h => Number(h.size) === size && h.tech === (S.tech === 'datacenter' ? 'datacenter' : S.tech), 'Grid › Upgrade cost allocator', h => h.networkUnpriced > 0 || h.status === 'Lower bound'),
    item('Revenue sent to finance', S.handoffs.revenue, h => Number(h.mw) === Number(S.exportMW), 'Economics', h => h.conditional),
    siteControlEvidence(S), // S3 #4: the engine's verdict (ISO-NE 100% at request; pro forma 90%, labelled); none for a load
  ].filter(Boolean);
}
const EV_ORDER = ['Current', 'Incomplete', 'Needs refresh', 'Missing'];
const evTone = s => (s === 'Current' ? 'Pass' : s === 'Incomplete' || s === 'Needs refresh' ? 'Hold' : 'Fail');
function tabReadiness(ctx) {
  const { data, S } = ctx; pendingOptions(ctx);
  const ev = evidence(data, S), acts = S.ui.actions || [];
  const ms = metricsFor(data, S), p = params(S), gs = ms.map(m => gatesOf(m, S, p)), names = ms.map(m => m.node.name);
  const m = ms[0], failed = gs[0].filter(g => g.verdict !== 'Pass');
  const items = openItems(ms, gs), grid = coverageGrid(data, ms);
  const held = grid.reduce((t, r) => t + r.cells.filter(c => c.status === 'held').length, 0), cellsN = grid.length * ms.length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = acts.filter(a => !a.done && a.due && a.due < today).length;

  const evCounts = Object.fromEntries(EV_ORDER.map(k => [k, ev.filter(e => (k === 'Missing' ? /^Missing/.test(e.status) : e.status === k)).length]));
  const evStrip = `<div style="display:grid;grid-template-columns:repeat(${ev.length},minmax(0,1fr));gap:4px;margin-bottom:8px">${ev.map(e => `<div title="${esc(e.name)}: ${esc(e.status)}" style="border-top:4px solid ${toneOf(evTone(e.status))};background:var(--sunk);padding:5px 6px;border-radius:0 0 4px 4px;font-size:10.5px;line-height:1.25;color:var(--ink-3);min-width:0;overflow:hidden">${esc(e.name.replace(/\s*\(.*$/, ''))}<br><b style="color:var(--ink-2)">${esc(e.status)}</b></div>`).join('')}</div>`;
  const evChart = barChart(EV_ORDER.map(k => ({ label: k, value: evCounts[k], tone: k === 'Current' ? '' : 'negative' })), { title: 'Evidence items by status', fmt: v => v.toFixed(0), xLabel: 'Status', yLabel: 'Items', height: 150 });
  const evTable = `<div class="table-wrap"><table class="dense"><thead><tr><th>Evidence</th><th>Status</th><th>Where</th><th>Recorded</th></tr></thead><tbody>
    ${ev.map(e => `<tr><td class="wrap">${esc(e.name)}${e.why ? `<br><span class="audit-note" style="margin:0">${esc(e.why)}</span>` : ''}</td><td><span class="pill ${e.status === 'Current' ? 'good' : 'warn'}">${esc(e.status)}</span></td><td>${e.status === 'Current' ? esc(e.where) : `<button class="tiny" data-act="goto-where" data-v="${esc(e.where)}">Go: ${esc(e.where)}</button>`}</td><td>${esc(e.at ? String(e.at).slice(0, 16).replace('T', ' ') : '—')}</td></tr>`).join('')}</tbody></table></div>`;

  const gateBars = stackBars(ms.map((x, i) => ({ label: names[i], counts: gateCounts(gs[i]) })), ['Pass', 'Hold', 'Fail']);
  const gateTbl = `<div class="table-wrap"><table class="dense"><thead><tr><th>Gate</th>${names.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>${gs[0].map((g, gi) => `<tr><td>${esc(g.gate)}</td>${gs.map(x => `<td style="${verdictBg(x[gi].verdict)}" title="${esc(x[gi].why)}">${esc(vText(x[gi]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  const covBars = stackBars(ms.map((x, i) => ({ label: names[i], counts: { held: grid.filter(r => r.cells[i].status === 'held').length, partial: grid.filter(r => r.cells[i].status === 'partial').length, 'not held': grid.filter(r => r.cells[i].status === 'not held').length } })), ['held', 'partial', 'not held']);
  const covTbl = `<div class="table-wrap"><table class="dense"><thead><tr><th>Concern</th>${names.map((n, i) => `<th><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${OPT[i]};margin-right:4px"></i>${esc(n)}</th>`).join('')}</tr></thead><tbody>
    ${grid.map(r => `<tr><td>${esc(r.concern)}</td>${r.cells.map(c => `<td class="wrap" style="${statusBg(c.status)}"><b>${esc(c.status)}</b><br><span class="audit-note" style="margin:0">${esc(c.detail)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  const itemTbl = items.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Option</th><th>Gate</th><th>What remains</th><th>Where</th><th></th></tr></thead><tbody>
    ${items.map(it => `<tr><td>${esc(it.option)}</td><td>${vpill(it.verdict)} ${esc(it.gate)}</td><td class="wrap">${esc(it.what)}</td><td><button class="tiny" data-act="goto-where" data-v="${esc(it.where)}">${esc(it.where)}</button></td><td><button class="tiny quiet" data-act="ui-text" data-k="aText" data-v="${esc(`${it.option}: ${it.what}`)}">Use as action</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty"><strong>Nothing open</strong>Every gate passes for every option.</div>';

  const actTbl = `<div class="form-grid"><label class="field">Action<input type="text" data-act="ui-text" data-k="aText" value="${esc(S.ui.aText || '')}" placeholder="e.g. Request facility cost for the shoulder case"></label>
      <label class="field">Owner<input type="text" data-act="ui-text" data-k="aOwner" value="${esc(S.ui.aOwner || '')}"></label>
      <label class="field">Due<input type="date" data-act="ui-text" data-k="aDue" value="${esc(S.ui.aDue || '')}"></label>
      <div class="field"><span>&nbsp;</span><button class="primary" data-act="add-action">Add action</button></div></div>
    <div class="table-wrap"><table class="dense"><thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>State</th><th>Bus</th><th></th></tr></thead><tbody>
    ${acts.map((a, i) => `<tr><td class="wrap">${a.done ? '<s>' : ''}${esc(a.text)}${a.done ? '</s>' : ''}</td><td>${esc(a.owner || '—')}</td><td>${esc(a.due || '—')}</td><td>${a.done ? '<span class="pill good">done</span>' : a.due && a.due < today ? '<span class="pill warn">overdue</span>' : a.due ? `<span class="pill">${Math.round((Date.parse(a.due) - Date.parse(today)) / 864e5)} d left</span>` : '<span class="pill">no due date</span>'}</td><td>${esc(a.bus)}</td><td><button class="tiny" data-act="toggle-action" data-v="${i}">${a.done ? 'Reopen' : 'Done'}</button></td></tr>`).join('') || '<tr><td colspan="6">No actions yet: use an open item below, or type one.</td></tr>'}</tbody></table></div>`;
  const dated = acts.filter(a => a.due && a.at).map(a => ({ label: `${a.done ? '✓ ' : ''}${a.text.length > 26 ? `${a.text.slice(0, 25)}…` : a.text}`, start: Date.parse(a.at.slice(0, 10)), end: Math.max(Date.parse(a.due), Date.parse(a.at.slice(0, 10)) + 864e5), note: `${a.owner || 'no owner'} · due ${a.due}${a.done ? ' · done' : ''}` }));
  const timeline = dated.length ? gantt(dated, { title: 'Actions timeline' }) : '<div class="empty"><strong>No dated actions</strong>Give an action a due date to place it on the timeline.</div>';

  // v6 answers
  const evCur = ev.filter(e => e.status === 'Current').length;
  const aEv = `${B(`${evCur} of ${ev.length}`)} evidence items are current for ${B(m.node.name)}${ev.length - evCur ? `; the first gap is ${esc(ev.find(e => e.status !== 'Current').name)}` : ''}.`;
  const aGc = `${names.map((n, i) => `${esc(n)}: ${B(gateTally(gs[i]).label)}`).join(' · ')}.`;
  const aCov = `${B(`${held} of ${cellsN}`)} concern × option cells are held in full; partial cells carry a stated limit.`;
  const aItems = items.length ? `${B(items.length)} open item${items.length === 1 ? '' : 's'}, ${B(items.filter(i => i.verdict === 'Fail').length)} on a failed gate; each names where to act.` : 'Nothing open: every gate passes for every option.';
  const aActs = acts.length ? `${B(acts.filter(a => !a.done).length)} open action${acts.filter(a => !a.done).length === 1 ? '' : 's'}${overdue ? `, ${B(overdue)} overdue` : ''}; ${acts.filter(a => a.done).length} done.` : 'No actions yet: use an open item, or type one.';
  const aTl = dated.length ? `${B(dated.length)} dated action${dated.length === 1 ? '' : 's'} on the timeline.` : 'No dated actions: give an action a due date to place it.';
  const traces = `${traceReadiness(ev)}${traceCoverage(grid, names)}`;
  return `<div class="kpis">
      ${kpi('Evidence current', `${ev.filter(e => e.status === 'Current').length} of ${ev.length}`, '', `For ${m.node.name}, the candidate in the project strip`)}
      ${kpi('Gates not passed', fmt.int(failed.length), '', failed.map(g => `${g.gate}: ${g.verdict}`).join(' · ') || 'All gates pass')}
      ${kpi('Open items (all options)', fmt.int(items.length), '', `${items.filter(i => i.verdict === 'Fail').length} on a failed gate`)}
      ${kpi('Coverage held in full', `${held} of ${cellsN}`, '', `${grid.length} concerns × ${ms.length} option(s)`)}
      ${kpi('Open actions', fmt.int(acts.filter(a => !a.done).length), '', `${acts.filter(a => a.done).length} done${overdue ? ` · ${overdue} overdue` : ''}`)}
    </div>
    <div class="cards">
      ${card(6, 'Evidence checklist', `candidate: ${m.node.name}`, `${evStrip}${evChart}${evTable}`, { depth: 'screen', trace: 'd-readiness', answer: aEv, foot: 'A sent result records evidence; it does not establish engineering approval or completed diligence.' })}
      ${card(6, 'Gate and coverage status per option', 'gate Pass / Hold / Fail, then evidence held / partial / not held', `${gateBars}${gateTbl}<h4 style="margin:6px 0 0;font-size:11px;color:var(--ink-3);letter-spacing:.05em">EVIDENCE COVERAGE (${grid.length} CONCERNS)</h4>${covBars}`, { trace: 'd-coverage', answer: aGc, foot: 'Unknown is Hold, never Pass. Queue exposure is never Pass.' })}
      ${card(12, 'Evidence coverage per option', 'what the database holds behind each concern', covTbl, { trace: 'd-coverage', answer: aCov, foot: 'Partial = held with a stated limit: borrowed price node, envelope only, habitat/protected-only land screen, or the linked subset of the queue.' })}
      ${card(12, 'Open items derived from the gates', 'one per gate not passed, with where to act', itemTbl, { answer: aItems, foot: '"Use as action" copies the item into the action form below; add an owner and due date, then Add action.' })}
      ${card(8, 'Actions', 'owner, due date and state', actTbl, { answer: aActs, foot: 'Stored in this browser only (preview storage).' })}
      ${card(4, 'Actions timeline', 'from when each was added to its due date', timeline, { depth: 'review', answer: aTl })}
      ${traceCard(traces)}
    </div>
    ${nextStep('decision', 'record', 'record the decision in Decision › Decision record')}`;
}

// ---------- Tab 4: Decision record ----------
/** The option's headline value in words, per fuel (PV revenue for a hybrid, load cost for a load, TB4 for storage). */
const VALUE_LABEL = { datacenter: 'Load cost (energy, flat load)', storage: 'TB4 spread', hybrid: 'PV energy revenue', solar: 'Energy revenue', wind: 'Energy revenue' };
function valueOf(m, tech) {
  if (tech === 'datacenter') return { v: m.loadCost?.value ?? null, unit: '$/yr', text: ok(m.loadCost?.value) ? `${fmt.money(m.loadCost.value)}/yr` : 'not held', why: m.loadCost?.reason };
  if (tech === 'storage') return { v: m.fuel?.tb4?.value ?? null, unit: '$/MWh', text: ok(m.fuel?.tb4?.value) ? `${fmt.price(m.fuel.tb4.value)}/MWh` : 'not held', why: m.fuel?.reason };
  return { v: m.revenue.value ?? null, unit: '$/yr', text: ok(m.revenue.value) ? `${fmt.money(m.revenue.value)}/yr` : 'not held', why: m.revenue.reason };
}
const thText = S => thresholdRows(thr(S), FUEL_TESTS[S.tech] || []).map(r => `${r.label} ${fmtUnit(r.value, r.unit)} (${r.sourceLabel})`).join('; ');

/** The memo lines for the current state (the record freezes the same lines). */
function memoLines(data, S) {
  const ms = metricsFor(data, S), p = params(S), d = S.ui.dForm || {}, cand = ms[0];
  const ev = evidence(data, S), vs = verdictsFor(ms, S.tech, thr(S));
  const lines = [`Decision: ${d.status || '(not chosen)'} — ${cand.node.name} (${cand.node.id})`, `Recorded: ${new Date().toISOString()}${d.by ? ` by ${d.by}` : ''}`,
    `Basis: ${S.tech}, ${sizeTxt(p).replace(' · ', ', ')}, ${describe(S.basis)}; CF ${(100 * p.cf).toFixed(1)}%, losses ${lossLabel(S)}`,
    `Per-fuel thresholds: ${thText(S) || 'none for this technology'}`,
    `Data snapshot: ${data.metadata.createdAt}`, '', `Options (${VALUE_LABEL[S.tech] || 'value'}; energy only):`];
  ms.forEach((m, i) => {
    const q = memoQualifiers(m, S.tech, data.land);
    lines.push(`- ${m.node.name}: export limit ${q.exportLimit}; upgrade cost ${q.cost}; ${(VALUE_LABEL[S.tech] || 'value').toLowerCase()} ${valueOf(m, S.tech).text}; price node ${m.tier}; linked queue nearby ${m.queueLinkedMW == null ? 'none' : fmt.mw(m.queueLinkedMW)}; land fit ${q.land}${m.cape5 ? '; Cape 5-yr input under review' : ''}`);
    for (const g of gatesOf(m, S, p)) lines.push(`    ${g.gate}: ${vText(g)} — ${g.why}`);
    for (const x of vs[i]) lines.push(`    Fuel test ${x.label} ${fmtUnit(x.threshold, x.unit)}: ${vText(x)} — ${x.why}`);
    const st = econRevenueStack(S, m.node.id, S.tech);
    if (!['datacenter', 'storage'].includes(S.tech)) lines.push(`    Revenue stack (Economics): ${st ? `${st.label}${st.sent ? ' (sent)' : ' (not sent)'}` : 'not produced for this bus; the figure above is energy only'}`);
    if (i === 0) q.footnotes.forEach((f, k) => lines.push(`    [${k + 1}] ${f}`));
  });
  lines.push('', 'Evidence:', ...ev.map(e => `- ${e.name}: ${e.status}`), '', `Rationale: ${d.why || '—'}`, `Open conditions: ${d.conditions || '—'}`, `Review when: ${d.trigger || '—'}`);
  return lines;
}
function printableMemo(data, S) {
  const ms = metricsFor(data, S), p = params(S), d = S.ui.dForm || {}, gs = ms.map(m => gatesOf(m, S, p)), ev = evidence(data, S), items = openItems(ms, gs);
  const vs = verdictsFor(ms, S.tech, thr(S));
  const td ='style="border:1px solid #c9d2dc;padding:4px 6px;vertical-align:top;color:#16202c;background:#fff;white-space:normal"';
  return `<div class="d-print" style="background:#fff;color:#16202c;padding:14px 16px;border-radius:4px;font-size:11.5px;line-height:1.45">
    <div style="display:flex;justify-content:space-between;gap:10px;border-bottom:2px solid #16202c;padding-bottom:6px;margin-bottom:8px"><div><div style="font-size:15px;font-weight:700">Decision memo · ${esc(ms[0].node.name)} (${esc(ms[0].node.id)})</div><div style="color:#4a5868">${esc(S.tech)} · ${fmt.mw(p.exportMW)} export${p.importMW ? ` · ${fmt.mw(p.importMW)} import` : ''} · ${esc(describe(S.basis))}</div></div><div style="text-align:right;color:#4a5868">${esc(new Date().toISOString().slice(0, 10))}<br>Decision: <b style="color:#16202c">${esc(d.status || 'not chosen')}</b>${d.by ? `<br>by ${esc(d.by)}` : ''}</div></div>
    <div style="overflow-x:auto;max-width:100%"><table style="border-collapse:collapse;width:100%;margin-bottom:8px"><thead><tr><th ${td}>Measure</th>${ms.map(m => `<th ${td}>${esc(m.node.name)}</th>`).join('')}</tr></thead><tbody>
      <tr><td ${td}>Export limit<sup>1</sup></td>${ms.map(m => `<td ${td}>${esc(memoQualifiers(m, S.tech, data.land).exportLimit)}</td>`).join('')}</tr>
      <tr><td ${td}>Upgrade cost<sup>2</sup></td>${ms.map(m => `<td ${td}>${esc(memoQualifiers(m, S.tech, data.land).cost)}</td>`).join('')}</tr>
      <tr><td ${td}>Land fit</td>${ms.map(m => `<td ${td}>${esc(memoQualifiers(m, S.tech, data.land).land)}</td>`).join('')}</tr>
      <tr><td ${td}>${esc(VALUE_LABEL[S.tech] || 'Value')}</td>${ms.map(m => `<td ${td}>${esc(valueOf(m, S.tech).text)}</td>`).join('')}</tr>
      <tr><td ${td}>Price node</td>${ms.map(m => `<td ${td}>${esc(m.tier)}</td>`).join('')}</tr>
      ${gs[0].map((g, gi) => `<tr><td ${td}>${esc(g.gate)}</td>${gs.map(x => `<td ${td}><b>${esc(vText(x[gi]))}</b></td>`).join('')}</tr>`).join('')}
      ${(vs[0] || []).map((x, ti) => `<tr><td ${td}>Fuel test: ${esc(x.label)} ${esc(fmtUnit(x.threshold, x.unit))}</td>${vs.map(v => `<td ${td}><b>${esc(v[ti]?.verdict || 'not held')}</b> ${esc(fmtUnit(v[ti]?.value, x.unit))}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    <ol style="margin:0 0 6px 16px;padding:0;color:#4a5868;font-size:10.5px">${memoQualifiers(ms[0], S.tech, data.land).footnotes.map(f => `<li>${esc(f)}</li>`).join('')}</ol>
    <p style="margin:0 0 6px;color:#4a5868;font-size:10.5px">Thresholds: ${esc(thText(S) || 'none for this technology')}. A default is an assumption; "your input" is an override entered in Compare.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px"><div><b>Evidence</b><ul style="margin:2px 0 0 16px;padding:0">${ev.map(e => `<li>${esc(e.name)}: ${esc(e.status)}</li>`).join('')}</ul></div>
    <div><b>Open items (${items.length})</b><ul style="margin:2px 0 0 16px;padding:0">${items.slice(0, 8).map(i => `<li>${esc(i.option)} · ${esc(i.gate)}: ${esc(i.what)}</li>`).join('')}${items.length > 8 ? `<li>${items.length - 8} more</li>` : ''}</ul></div></div>
    <p style="margin:8px 0 2px"><b>Rationale:</b> ${esc(d.why || '—')}</p><p style="margin:2px 0"><b>Open conditions:</b> ${esc(d.conditions || '—')}</p><p style="margin:2px 0"><b>Review when:</b> ${esc(d.trigger || '—')}</p>
    <p style="margin:8px 0 0;color:#4a5868;font-size:10.5px">Screening evidence, not an interconnection approval. Revenue is energy only. Unknown is never Pass. Data: unified ISO-NE GridSense database, snapshot ${esc(data.metadata.createdAt?.slice(0, 10))}. The decision is the recorder's; the tool does not decide.</p></div>`;
}
function tabRecord(ctx) {
  const { data, S } = ctx; pendingOptions(ctx);
  const recs = S.decisions || [], d = S.ui.dForm || {};
  const ms = metricsFor(data, S), cand = ms[0], cg = gatesOf(cand, S, params(S));
  const notPassed = cg.filter(g => g.verdict !== 'Pass');
  const cur = inputHash(data, S, optionIds(S));
  const diffs = recs.map(r => recordDiff(r.inputHash, cur));
  const last = recs.at(-1), lastDiff = diffs.at(-1);
  const text = memoLines(data, S).join('\n');
  const prov = dx('provenance', 'all');
  const src = data.metadata.sources?.[0];
  const byStatus = ['Advance', 'Hold', 'Reject'].map(s => ({ label: s, value: recs.filter(r => r.status === s).length }));

  const form = `${d.status === 'Advance' && notPassed.length ? `<div class="notice warn">You are recording <b>Advance</b> while ${notPassed.length} gate(s) are not passed: ${notPassed.map(g => `${g.gate} (${g.verdict})`).join(', ')}. Record the conditions below.</div>` : ''}
    <div class="form-grid">
      <label class="field">Decision<select data-act="d-form" data-k="status"><option value="" ${!d.status ? 'selected' : ''}>Choose…</option>${['Advance', 'Hold', 'Reject'].map(v => `<option ${d.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field">Decided by<input type="text" data-act="d-form" data-k="by" value="${esc(d.by || '')}"></label>
      <label class="field">Review when<input type="text" data-act="d-form" data-k="trigger" value="${esc(d.trigger || '')}" placeholder="e.g. after the cluster study report"></label>
    </div>
    <label class="field" style="margin-top:8px">Rationale<textarea data-act="d-form" data-k="why" rows="3">${esc(d.why || '')}</textarea></label>
    <label class="field">Open conditions<textarea data-act="d-form" data-k="conditions" rows="2">${esc(d.conditions || '')}</textarea></label>
    <div class="form-footer"><span class="audit-note">The status is always your recorded decision; the tool does not decide.</span><button class="primary" data-act="record-decision" ${d.status ? '' : 'disabled'}>Record decision</button></div>`;

  const hist = recs.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Recorded</th><th>Decision</th><th>Candidate</th><th>By</th><th>Basis</th><th>Now</th></tr></thead><tbody>
      ${recs.slice().reverse().map((r, k) => { const i = recs.length - 1 - k, df = diffs[i]; return `<tr><td>${esc(r.at.slice(0, 16).replace('T', ' '))}</td><td><b>${esc(r.status)}</b></td><td>${esc(r.candidate)}</td><td>${esc(r.by || '—')}</td><td class="wrap">${esc(r.basisText)}</td><td class="wrap">${r.inputHash === cur ? '<span class="pill good">Same inputs as now</span>' : `<span class="pill warn">Analysis has changed since</span><br><span class="audit-note" style="margin:0">${df ? `changed: ${esc(df.join(', '))}` : 'fingerprint unreadable'}</span>`}</td></tr>
        <tr><td colspan="6"><details><summary>Memo</summary><pre style="white-space:pre-wrap">${esc(r.memo)}</pre></details></td></tr>`; }).join('')}</tbody></table></div>`
    : '<div class="empty"><strong>No decisions recorded</strong>Record one with the form: it freezes the options, gates, basis, inputs and sent evidence.</div>';

  const provRows = [
    ['Unified database', src ? `${src.file.split(/[\\/]/).pop()} · read-only` : 'ISONE_GridSense_unified.duckdb', src?.modifiedAt ? `modified ${src.modifiedAt.slice(0, 16).replace('T', ' ')}` : ''],
    ['Bus payloads', `built ${data.metadata.createdAt?.slice(0, 16).replace('T', ' ') || 'not held'}`, 'cached per database build'],
    ['Queue register', data.queue ? `${data.queue.queue.length} linked requests` : 'not loaded', data.queue?.source || ''],
    ['Land screen', data.land ? `${Object.keys(data.land.exclusions || {}).length} buses screened` : 'not loaded', data.land?.source ? String(data.land.source).slice(0, 80) : ''],
    ['Cape flags', data.flags ? `${Object.keys(data.flags.buses || {}).length} flagged buses` : 'not loaded', '5-yr run input under review'],
  ];
  const dq = prov.state === 'ok' ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Field group</th><th>Status</th><th>Basis</th></tr></thead><tbody>${prov.data.dataQuality.map(r => `<tr><td>${esc(r.field_group)}</td><td><span class="pill ${/auditable|corrected|normalised|deterministic/.test(r.status) ? 'good' : /excluded|vendor/.test(r.status) ? 'warn' : ''}">${esc(r.status)}</span></td><td class="wrap">${esc(r.basis)}</td></tr>`).join('')}</tbody></table></div>`
    : prov.state === 'loading' ? loadingNote('the data-quality register') : '<div class="notice">The data-quality register could not be read.</div>';

  // v6 answers
  const aForm = d.status ? `Recording ${B(d.status)} for ${B(cand.node.name)}${notPassed.length ? ` while ${B(notPassed.length)} gate${notPassed.length === 1 ? ' is' : 's are'} not passed` : ''}.` : `Choose Advance, Hold or Reject for ${B(cand.node.name)}; ${B(notPassed.length)} gate${notPassed.length === 1 ? ' is' : 's are'} not passed. The tool does not decide.`;
  const aMemo = `The memo freezes ${B(ms.length)} option${ms.length === 1 ? '' : 's'}, their gates and ${B(evidence(data, S).length)} evidence items on the current basis.`;
  const aPack = `One workbook: Summary, Assumptions, Contents and a sheet per calculation trace (${B(fmt.int(optionIds(S).length))} option${optionIds(S).length === 1 ? '' : 's'}).`;
  const aHist = recs.length ? `${B(recs.length)} record${recs.length === 1 ? '' : 's'}; the latest is ${last.inputHash === cur ? B('on the same inputs as now') : B('on inputs that have since changed')}.` : 'No decision recorded yet.';
  const aBy = recs.length ? byStatus.filter(b => b.value).map(b => `${B(b.value)} ${esc(b.label)}`).join(', ') + '.' : 'No records to count yet.';
  const aProv = `Every figure rests on the read-only unified database (bus payloads built ${esc(data.metadata.createdAt?.slice(0, 10) || 'not held')}) plus the queue and land files listed.`;
  const aDq = prov.state === 'ok' ? `${B(prov.data.dataQuality.length)} field groups are classed; ${B(prov.data.dataQuality.filter(r => /excluded|vendor/.test(r.status)).length)} are excluded or vendor-asserted.` : prov.state === 'loading' ? 'The data-quality register is loading.' : 'The data-quality register could not be read.';
  const aText = `${B(text.split(/\n/).length)} lines of plain text, frozen into the record as written.`;
  const traces = traceRecord(recs, cur, diffs);
  const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  return `<div class="kpis">
      ${kpi('Decisions recorded', fmt.int(recs.length), '', recs.length ? `${byStatus.filter(b => b.value).map(b => `${b.value} ${b.label}`).join(' · ')}` : 'None yet')}
      ${kpi('Last decision', last ? last.status : '—', '', last ? `${last.candidate} · ${last.at.slice(0, 10)}${last.by ? ` · ${last.by}` : ''}` : 'Record one with the form')}
      ${kpi('Inputs since the last record', !last ? '—' : last.inputHash === cur ? 'Same' : 'Changed', '', !last ? 'No record to compare' : lastDiff?.length ? lastDiff.join(', ') : 'No component changed')}
      ${kpi('Gates not passed (candidate)', fmt.int(notPassed.length), '', notPassed.map(g => `${g.gate}: ${g.verdict}`).join(' · ') || 'All gates pass')}
    </div>
    <div class="cards">
      ${card(6, `Record a decision for ${cand.node.name}`, 'saves a frozen snapshot; later changes never rewrite it', form, { depth: 'screen', trace: 'd-record', answer: aForm })}
      ${card(6, 'Decision memo', 'live preview of what the record will freeze; Print memo prints this card only', printableMemo(data, S), { depth: 'screen', answer: aMemo, cls: 'r-2 d-memo-card', tools: `<button type="button" class="tiny" data-act="print-memo">Print memo</button><a class="button tiny" download="decision-memo-${esc(cand.node.id)}.txt" href="${esc(dataUrl)}">Download .txt</a>` })}
      ${card(6, 'Evidence pack', 'one Excel workbook: summary, assumptions and the working of every calculation', packCard(ctx), { depth: 'screen', answer: aPack, chips: 'assumption modelled', tools: '<button type="button" class="tiny primary" data-pack data-act="d-pack">Download evidence pack</button>' })}
      ${card(6, 'Decision history', 'each record against the current inputs, component by component', hist, { trace: 'd-record', answer: aHist, foot: 'Stored in this browser only (preview storage).' })}
      ${card(4, 'Decisions by status', 'recorded in this browser', recs.length ? barChart(byStatus, { title: 'Decisions by status', fmt: v => v.toFixed(0), xLabel: 'Decision', yLabel: 'Records', height: 170 }) : '<div class="empty"><strong>No records</strong>Counts appear once a decision is recorded.</div>', { answer: aBy })}
      ${card(8, 'Data provenance', 'the sources this decision rests on', `<div class="table-wrap"><table class="dense"><thead><tr><th>Source</th><th>State</th><th>Note</th></tr></thead><tbody>${provRows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="wrap">${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>`, { answer: aProv, foot: 'The live Studio reads an older copy (GS_DATA, vendor build); where it differs, Compare › Studio copy shows the difference and the unified value is used.' })}
      ${card(12, 'Data-quality register', 'unified DB data_quality: what is auditable, corrected or excluded', dq, { depth: 'study', answer: aDq })}
      ${card(12, 'Memo text', 'the plain text frozen into the record', `<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:11.5px;margin:0;max-height:260px;overflow:auto">${esc(text)}</pre>`, { answer: aText })}
      ${traceCard(traces)}
    </div>
    ${nextStep('market', 'find', 'screen the next candidate in Market › Find locations')}
    `;
}

// ---------- Evidence pack (D3): SpreadsheetML 2003 workbook built by ../decisionpack.js ----------
const TRACE_TABS = [tabCompare, tabStress, tabReadiness];
/** Summary and Assumptions rows for the pack (the same values the tabs show; blank = not held). */
function packRows(ctx) {
  const { data, S } = ctx, ms = metricsFor(data, S), p = params(S), gs = ms.map(m => gatesOf(m, S, p)), th = thr(S), vs = verdictsFor(ms, S.tech, th);
  const names = ms.map(m => m.node.name), row = (a, b, f) => [a, b, ...ms.map((m, i) => f(m, i))], d = S.ui.dForm || {};
  const num = v => (ok(v) ? v : null);
  const summary = [
    ['Section', 'Measure', ...names],
    row('Option', 'Bus id', m => String(m.node.id)),
    row('Option', 'Load zone', m => m.node.load_zone || null),
    row('Option', 'Price node (pricing tier)', m => m.tier),
    row('Grid', 'Export limit (MW)', m => num(m.exportLimit)),
    row('Grid', 'Export limit status', m => m.exportStatus),
    ...(['storage', 'hybrid', 'datacenter'].includes(S.tech) ? [row('Grid', 'Charge / import limit (MW)', m => num(m.importLimit)), row('Grid', 'Charge / import status', m => m.importStatus)] : []),
    row('Grid', 'Envelope only (vendor-asserted) for', m => m.envelopeOnly.join(', ') || null),
    row('Grid', 'Export limit with its qualifiers', m => memoQualifiers(m, S.tech, data.land).exportLimit),
    row('Grid', 'Upgrade cost with its qualifiers', m => memoQualifiers(m, S.tech, data.land).cost),
    row('Land', 'Land fit with its qualifiers', m => memoQualifiers(m, S.tech, data.land).land),
    row('Grid', 'Upgrade cost status', m => m.cost.status),
    row('Grid', 'Upgrade cost', m => costText(m.cost)),
    row('Value', `${VALUE_LABEL[S.tech] || 'Value'} (${valueOf(ms[0] || { revenue: {} }, S.tech).unit})`, m => num(valueOf(m, S.tech).v)),
    row('Value', 'Why not held', m => (ok(valueOf(m, S.tech).v) ? null : valueOf(m, S.tech).why || null)),
    ...(['solar', 'wind', 'hybrid'].includes(S.tech) ? [row('Value', 'Capture price ($/MWh)', m => num(m.revenue.capture)), row('Value', 'Capture ratio, clear-sky', m => num(m.fuel?.capture?.clearSky?.ratio)), row('Value', 'Capture ratio, ISO-NE fleet shape', m => num(m.fuel?.capture?.fleet?.ratio))] : []),
    row('Queue', 'Linked queue within 10 mi (MW)', m => num(m.queueLinkedMW)),
    row('Land', 'Land fit', m => m.land.status),
    ...(gs[0] || []).flatMap((g, gi) => [row('Gate', g.gate, (m, i) => vText(gs[i][gi])), row('Gate reason', g.gate, (m, i) => gs[i][gi].why)]),
    ...(vs[0] || []).flatMap((x, ti) => [row('Fuel verdict', `${x.label} ${fmtUnit(x.threshold, x.unit)}`, (m, i) => vs[i][ti]?.verdict ?? null), row('Fuel value', `${x.label} (${x.unit})`, (m, i) => num(vs[i][ti]?.value)), row('Fuel reason', x.label, (m, i) => vs[i][ti]?.why ?? null)]),
    [],
    ['Decision', 'Status (your record, not the tool\'s)', d.status || 'not chosen'],
    ['Decision', 'Rationale', d.why || null],
    ['Decision', 'Open conditions', d.conditions || null],
    ['Generated', new Date().toISOString(), 'Screening evidence, not an interconnection approval. Unknown is never Pass.'],
  ];
  const assumptions = [
    ['Input', 'Value', 'Unit', 'Source', 'Note'],
    ['Technology', S.tech, null, 'your input', 'Project strip'],
    ['Export size', num(p.exportMW), 'MW', 'your input', 'Project strip'],
    ['Import size', num(p.importMW), 'MW', 'your input', 'Project strip'],
    ['Price basis', describe(S.basis), null, 'your input', 'Prices › LMP & years'],
    ['Capacity factor', num(100 * p.cf), '%', ok(S.ui.econ?.[S.tech === 'wind' ? 'windCF' : 'solarCF']) ? 'your input' : 'assumption', 'Economics default unless entered there'],
    ['Losses', num(p.lossPct), '%', ok(S.ui.econ?.lossPct) ? 'your input' : 'assumption', LOSS_PLACEHOLDER_NOTE],
    ...thresholdRows(th, FUEL_TESTS[S.tech] || []).map(r => [`Threshold: ${r.label}`, r.value, r.unit, r.sourceLabel, `${ok(r.default) ? `default ${fmtUnit(r.default, r.unit)}; ` : ''}${r.note}`]),
    ['Capture bases', 'clear-sky (modelled) and ISO-NE fleet shape', null, 'rule', 'The governing basis is open decision #2; bases that disagree Hold'],
    ['Wind shape', fleetData(S) ? 'ISO-NE wind fleet shape (fact_genfuel_hourly)' : 'flat proxy (fleet profile not loaded)', null, fleetData(S) ? 'measured' : 'assumption', 'A fleet-wide shape, not a site profile'],
    ['Data snapshot', data.metadata.createdAt || null, null, 'measured', 'Unified ISO-NE GridSense database, read-only'],
    ['Rule', 'Unknown is never Pass; Queue exposure is never Pass; envelope-only Connect is Hold (D6.1: the element study is the source of record, the envelope is context); light-load and minimum-load cases are not studied', null, 'rule', 'Decision gates'],
    ['Rule', '"No upgrades indicated" carries no dollar figure; a lower bound is shown with ≥', null, 'rule', 'Grid cost engine'],
    ['Rule', 'Storage charging is tested in the shoulder case only; a data centre reads large-load and summer-peak withdrawal', null, 'rule', 'Grid rules (applicableCases)'],
  ];
  return { summary, assumptions };
}
/** Pack contents as shown on the card: which sheets the workbook will hold. */
function packCard(ctx) {
  const ids = listTraces();
  return `<p class="audit-note" style="margin:0 0 6px">Summary (options, gates, per-fuel verdict), Assumptions (every input with its source: your input, assumption, measured, rule), Contents, then one sheet per calculation trace from its CSV. Opens in Excel (XML Spreadsheet 2003); not-held values are empty cells, never 0.</p>
    <div class="table-wrap"><table class="dense"><thead><tr><th>Sheet</th><th>What</th></tr></thead><tbody>
      <tr><td>Summary</td><td class="wrap">${fmt.int(optionIds(ctx.S).length)} option(s), gates and ${fmt.int((FUEL_TESTS[ctx.S.tech] || []).length)} per-fuel test(s)</td></tr>
      <tr><td>Assumptions</td><td class="wrap">sizes, basis, CF, losses, thresholds (default = assumption, override = your input), rules</td></tr>
      <tr><td>Calculation sheets</td><td class="wrap">the Compare, Stress and Readiness traces plus the ${fmt.int(ids.length)} registered on this tab; each sheet is that trace's CSV with its provenance lines</td></tr>
    </tbody></table></div>`;
}
/** Build and download the workbook. The shell resets the trace registry on each render, so the Decision tabs are
 *  rendered here (off screen) to register every Decision trace before the pack reads them. */
function downloadPack(ctx) {
  for (const f of TRACE_TABS) { try { f(ctx); } catch (e) { console.warn('evidence pack: a tab could not be traced', e); } }
  const traces = listTraces().map(t => ({ id: t.id, title: t.title, csv: csvFor(t.id) }));
  const { xml } = buildPack({ ...packRows(ctx), traces, title: `GridSense evidence pack · ${ctx.S.tech} · ${optionIds(ctx.S).join(', ')} · ${new Date().toISOString().slice(0, 16)}` });
  const url = URL.createObjectURL(new Blob([xml], { type: 'application/vnd.ms-excel' }));
  const a = document.createElement('a'); a.href = url; a.download = `gridsense-evidence-pack-${ctx.S.nodeId}-${new Date().toISOString().slice(0, 10)}.xml`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  return xml;
}

export function buildRecord(data, S) {
  const p = params(S), d = S.ui.dForm || {}, cand = metricsFor(data, S)[0];
  return { at: new Date().toISOString(), status: d.status, by: d.by || '', candidate: cand.node.name, busId: S.nodeId, basis: structuredClone(S.basis), basisText: describe(S.basis), inputHash: inputHash(data, S, optionIds(S)), tech: S.tech, exportMW: p.exportMW, handoffs: structuredClone(S.handoffs), memo: memoLines(data, S).join('\n') };
}

export function renderDecision(tab, ctx) {
  if (sizeNotHeld(ctx.S)) return sizeNotHeldCard(ctx.S); // fix-3 / nullmw: never compared at 0 MW
  if (!ctx.data.queue || !ctx.data.land) return '<div class="empty"><strong>Loading queue and land data…</strong></div>';
  // Start every Decision read on the first render, whatever the tab, so later tabs do not re-render under the user.
  dx('population', 'all'); dx('provenance', 'all');
  optionIds(ctx.S).forEach(id => { if (atLeast(ctx.S, 'study')) dx('studio', id); dx('outlook', id); });
  // The evidence-pack button calls this (inline handler: the shell has no pack action); it always sees the latest ctx.
  if (typeof window !== 'undefined') window.__gsDecisionPack = () => downloadPack(ctx);
  const key = { compare: 1, stress: 1, readiness: 1, record: 1 }[tab] ? tab : 'compare';
  const html = ({ compare: tabCompare, stress: tabStress, readiness: tabReadiness, record: tabRecord })[key](ctx);
  if (ctx.S?.tech !== 'datacenter') return html;
  // S6 #2 / #7: the large-load eligibility and rules cards for a data centre, with Decision's own load cost as the energy
  // line (one home, decisioncore.loadCost); any generator-titled card is dropped.
  const cand = metricsFor(ctx.data, ctx.S)[0];
  return withDcCards(dropGeneratorOnly(html), 'decision', key, { ...ctx, node: cand?.node || ctx.data.nodes.find(n => String(n.id) === String(ctx.S.nodeId)), loadCost: cand?.loadCost || null });
}
