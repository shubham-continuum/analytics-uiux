// Prices dashboard: four analyzer tabs. Two kinds of evidence, never mixed without saying so:
//  - the APPLIED BASIS (years or one forecast run chosen in the basis form) drives the basis cards, computed in the
//    browser from the bus's hourly payload (Claude pack §P1–§P5, Codex cores in ../prices.js);
//  - ALL YEARS AND RUNS at this bus come from the unified marts through api_prices.py (per-bus aggregates), each
//    re-checked in its trace against the hourly payload by an independent path.
// The live Studio's figures (vendor sheet, extension) are shown beside the unified database as a labelled second
// source with the difference; the unified database is primary. Missing values print "not held", never zero.
import { analyzePrices, matchedBasis, hourlyShape, dailySpreads, quantile, weightedQuantile, finite, priceTierText, priceLinkFields, isBorrowedPrice } from '../prices.js';
import { clearSky, capture, solarWindowLabel, inSolarWindow } from '../solar.js';
const SW = solarWindowLabel(); // S2-EM D5: one solar-window label
import { availableYears, forecastRuns, LABELS, describe, coreBasis, fmt } from '../basis.js';
import * as C from '../charts.js';
import { traceLmp, traceBasis, traceShape, traceTails } from './prices-trace.js';
import { traceYears, traceDaRt, traceSheet, traceZones, traceConstraints, traceCompYears, traceCapYears, tracePeak, traceTb, traceScarcity } from './prices-trace-years.js';
import { px } from './prices-data.js';
import { heldRows, yearStats, monthStats, tbMart, thresholdCounts, topHours, zoneYears, durationGrid, captureOf, componentYears, clockDate, clockHour, clockMonth, sheetRows, daFerNote } from './prices-calc.js';
import { priceMap } from './prices-charts.js';
import { kpi, card, tbl, tr, td, tn, pending, seg, sel, notApplicable, traceCard, FUEL_LABEL, B, nextStep, moreCtl, answerP } from './prices-ui.js';
import { intraCards } from './prices-intra-card.js';
import { econTabLabel } from './economics-fuel.js';
import { fuelOf, priceTabLabel, provenanceChips } from './prices-fuel.js';
import { dcShape, storageCards, windShape } from './prices-fuelcards.js';
import { loadRevenueRules } from '../rules/revenue.js';

const { barChart, lineChart, heatmap, groupedBar } = C;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RUN = { '5yr': 'PROBE 5-yr (2028)', '10yr': 'PROBE 10-yr (2035)', pcr2030: 'PCR 2030', pcr2035: 'PCR 2035', pcr2040: 'PCR 2040 (12% gas)' };
const RUNS = { '5yr': '5y28', '10yr': '10y35', pcr2030: 'P2030', pcr2035: 'P2035', pcr2040: 'P2040' };
const perShort = p => RUNS[p] || String(p).replace(/^(RT|DA)20(\d\d)$/, '$1 $2');
const RUN_ORDER = ['5yr', 'pcr2030', '10yr', 'pcr2035', 'pcr2040'];
// P2 C59: the run legend under the PCR 2030 KPI. The vendor sheet's "2030" (the 5-yr run relabelled and scaled) is not a
// headline figure: it is in the Studio-copy card only, marked not used.
const RUN_LEGEND = 'PCR 2030 = the 2030 solved run (unified); the vendor sheet’s “2030” is the 5-yr (2028) run relabelled, not used (Studio-copy card)';
const calHours = y => (y % 4 === 0 ? 8784 : 8760);
const sgn = v => (finite(v) ? `${v > 0 ? '+' : ''}${fmt.price(v)}` : 'not held');
const n2 = v => (finite(v) ? v.toFixed(2) : 'not held');
const r3 = v => (finite(v) ? v.toFixed(3) : 'not held');
const usd0 = v => `$${Math.round(v)}`;
const usd1 = v => `$${v.toFixed(1)}`;
const usd2 = v => `$${v.toFixed(2)}`;

export const PRICES = {
  key: 'prices',
  question: 'What does the selected price evidence show?',
  lede: 'Choose the years or forecast run once for the basis cards. The all-years cards read every settled year and solved run held for this bus from the unified database.',
  tabs: [
    { id: 'lmp', label: 'LMP & years' },
    { id: 'basis', label: 'Basis & congestion' },
    { id: 'shape', label: 'Shape & capture', labelFor: tech => priceTabLabel('shape', tech) },
    { id: 'tails', label: 'Tails & spreads', labelFor: tech => priceTabLabel('tails', tech) },
  ],
};

/** data-chips for a settled-data card: geo-proxy when this bus borrows its settled series, plus the given tags. */
function chipsOf(node, link) {
  const l = priceLinkFields(node, link); // P2 C19: the same inputs as the tier label (substation name check included)
  return (tags = []) => provenanceChips(l, tags);
}
// P2 C58: the FER/DASI footnote reads the rules file (energy_settlement.da_premium_2025); until it loads the note states
// the exclusion without a figure. Cached once per page; a failed load leaves the figure-less note.
let DA_FER = null, DA_FER_ASKED = false;
const ferNote = () => {
  if (!DA_FER_ASKED) { DA_FER_ASKED = true; try { loadRevenueRules().then(R => { DA_FER = R?.energy_settlement?.da_premium_2025 || null; }, () => {}); } catch { /* no fetch: figure-less note */ } }
  return esc(daFerNote(DA_FER));
};
const studyTrace = inner => traceCard(inner, 'study', 'Formula, inputs, steps, a check and the working as CSV for every figure on this tab');

/** Memoised analysis of the applied basis (recomputed only when the basis changes). */
const memo = new Map();
export function analysis(data, basis) {
  const key = JSON.stringify(basis);
  if (!memo.has(key)) { memo.clear(); memo.set(key, analyzePrices(data, coreBasis(basis))); }
  return memo.get(key);
}

/** Every held hourly series at a node (settled years and solved runs) with its mart-definition statistics. */
const hmemo = new Map();
export function hourlySets(data, nodeId) {
  const list = data.series.filter(s => String(s.nodeId) === String(nodeId));
  const key = `${nodeId}|${list.length}|${list.reduce((t, s) => t + (s.records?.length || 0), 0)}`;
  if (hmemo.has(key)) return hmemo.get(key);
  const out = list.map(s => {
    const rows = heldRows(s), kind = s.mode === 'forecast' ? 'solved' : 'settled';
    return { s, kind, key: kind === 'solved' ? s.run : `${s.market}${s.year}`, label: kind === 'solved' ? RUN[s.run] || s.run : `${s.year} ${s.market}`, market: s.market, year: s.year, run: s.run, rows, stats: yearStats(rows) };
  }).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'settled' ? -1 : 1) || a.year - b.year || String(a.market || a.run).localeCompare(String(b.market || b.run)));
  if (hmemo.size > 6) hmemo.clear();
  hmemo.set(key, out);
  return out;
}

// Markup helpers (layout contract: kpis + 12-column cards + depth/trace/chips tags) live in prices-ui.js.

/** Provenance of the settled figures at this bus (one bus, one price; a borrowed series is said so). */
function histSrc(node, link) {
  const pm = node?.priceMapping || {}, f = priceLinkFields(node, link);
  // One home for the tier words (prices.priceTierText, P2 C19): tier incl. D-008 relinked, node type/kV when it differs
  // from the POI, a node in another state's load zone, and the shared-series count.
  const where = `${priceTierText(node, link)}${isBorrowedPrice(f) ? " — its congestion and losses are the neighbour's" : ''}`;
  return `settled: <b>${esc(link?.pnode_name || pm.pnode_name || '—')}</b> (${esc(where)})`;
}
const martFoot = (node, sum, extra = '') => `${histSrc(node, sum?.link)} · solved: model bus ${esc(node?.id)} · unified marts via api_prices${extra ? ` · ${extra}` : ''}`;

/** The latest settled year of a market that holds ≥ 95% of its calendar hours. */
function fullYear(rows, market) {
  const r = (rows || []).filter(x => x.market === market && x.n_hours >= 0.95 * calHours(x.y)).map(x => x.y);
  return r.length ? Math.max(...r) : null;
}
const runRow = (sum, run) => (sum?.fcstYear || []).find(r => r.scenario === run) || null;

/** Claude pack §P3 Cape rule: the 5-yr run carries 2,905 MW of offshore wind on Cape Cod that no other run has. */
export function capeNotice(data, basis) {
  const f = data.flags, v = f?.buses?.[String(basis.nodeId)];
  if (!f || basis.mode !== 'forecast' || basis.run !== f.run || !v) return '';
  const [capeUsd, share] = v;
  return `<div class="notice warn" role="note"><strong>5-yr input under review.</strong> ${esc(f.note)}. At this bus ${fmt.price(capeUsd)}/MWh (${(100 * share).toFixed(0)}% of its congestion) comes from that assumption. Treat this run with caution; decisions that depend on it are held, not passed.</div>`;
}
/** Cape flag for the all-years cards, where the 5-yr run is always drawn. */
function capeAllYears(data, nodeId) {
  const f = data.flags, v = f?.buses?.[String(nodeId)];
  if (!f || !v) return '';
  return `<div class="notice warn" role="note"><strong>5-yr run input under review at this bus.</strong> ${esc(f.note)}: ${fmt.price(v[0])}/MWh (${(100 * v[1]).toFixed(0)}% of its 5-yr congestion) comes from that assumption. Every 5-yr figure below carries it.</div>`;
}

function errorsBlock(res) {
  if (!res.errors?.length) return '';
  const partial = res.audit.filter(a => /Incomplete/.test(a.status));
  const fix = partial.length ? ` <button class="tiny" data-act="include-partial">Include ${partial.map(a => `${a.year} (${(100 * a.series.coverage).toFixed(1)}% of hours)`).join(', ')} and apply</button>` : '';
  return `<div class="notice error" role="alert"><strong>No result for this basis.</strong> ${res.errors.map(esc).join(' ')}${fix}</div>`;
}
/** Basis-card placeholder where the applied basis gives no result (e.g. a bus without history). */
const noBasis = (res, what) => `<div class="empty"><strong>No ${esc(what)} on the applied basis</strong>${esc((res.errors || []).join(' ') || 'Apply an analysis basis in LMP & years.')}</div>`;

// ---------- Basis form (LMP tab) ----------
function basisForm(data, draft, answer = '') {
  const node = draft.nodeId;
  const mode = `<div class="segmented" role="group" aria-label="Price mode">
      <button data-act="basis-mode" data-v="historical" class="${draft.mode === 'historical' ? 'active' : ''}">Historical</button>
      <button data-act="basis-mode" data-v="forecast" class="${draft.mode === 'forecast' ? 'active' : ''}">Forecast</button></div>`;
  let body;
  if (draft.mode === 'historical') {
    const years = availableYears(data, node, 'historical', draft.market);
    const checks = years.map(y => `<label class="year"><input type="checkbox" data-act="basis-year" value="${y.year}" ${draft.years.includes(y.year) ? 'checked' : ''}>${y.year}${y.complete ? '' : ` <em>${y.coverage >= 0.99 ? `${fmt.int(Math.round((1 - y.coverage) * calHours(y.year)))} h missing` : `partial ${(100 * y.coverage).toFixed(0)}%`}</em>`}</label>`).join('');
    body = `
      <div class="form-grid">
        <label class="field">Market<select data-act="basis-market">${['RT', 'DA'].map(m => `<option value="${m}" ${draft.market === m ? 'selected' : ''}>${LABELS[m]}</option>`).join('')}</select></label>
        <div class="field">Quick select<div class="quick">
          <button class="tiny" data-act="basis-quick" data-v="latest">Latest complete year</button>
          <button class="tiny" data-act="basis-quick" data-v="last3">Last 3 complete</button>
          <button class="tiny" data-act="basis-quick" data-v="all">All complete</button></div></div>
      </div>
      <div class="checks" role="group" aria-label="Years">${checks || '<span class="muted">No settled years are held for this bus in this market. Switch to Forecast.</span>'}</div>
      ${moreCtl(`<div class="form-grid"><div class="field">Weighting<div class="segmented" role="group" aria-label="Weighting">${['duration', 'equal', 'custom'].map(w => `<button data-act="basis-weight" data-v="${w}" class="${draft.weighting === w ? 'active' : ''}">${LABELS[w]}</button>`).join('')}</div></div></div>
      ${draft.weighting === 'custom' ? `<div class="form-grid">${draft.years.map(y => `<label class="field">${y} weight<input type="number" min="0" step="0.1" data-act="basis-cw" data-year="${y}" value="${esc(draft.weights?.[y] ?? 1)}"></label>`).join('')}</div>` : ''}
      <label class="inline-check"><input type="checkbox" data-act="basis-partial" ${draft.includePartial ? 'checked' : ''}> Include partial years (coverage shown in the audit)</label>
      <label class="inline-check"><input type="checkbox" data-act="basis-strict" ${draft.strict ? '' : 'checked'}> Use available selected years and report omissions</label>`, draft.weighting !== 'duration' || draft.includePartial || !draft.strict)}`;
  } else {
    const runs = forecastRuns(data, node);
    body = `<div class="form-grid"><label class="field">Forecast run<select data-act="basis-run">${runs.map(r => `<option value="${r.run}" ${draft.run === r.run ? 'selected' : ''}>${esc(LABELS[r.run] || r.run)}</option>`).join('')}</select></label></div>
      ${runs.length ? '' : '<p class="muted">No forecast run is held for this bus.</p>'}
      <p class="audit-note">Each forecast run is one modelled year from a separate study. Runs are never averaged together, and a selected run does not stand in for the years between runs.</p>
      ${moreCtl(`<label class="inline-check"><input type="checkbox" data-act="basis-partial" ${draft.includePartial ? 'checked' : ''}> Include a run with missing hours (missing hours stay missing; coverage shown in the audit)</label>`, draft.includePartial)}`;
  }
  return card('c-12', 'Analysis basis', describe(draft), `${answerP(answer)}${body}
    <div class="form-footer"><span class="audit-note" style="margin:0">Applying updates every basis card on the four tabs and marks saved scenarios on a different basis as stale.</span>
    <div class="actions"><button class="tiny" data-act="save-scenario">Save scenario</button><button class="tiny primary" data-act="apply-basis">Apply analysis</button></div></div>`, { tools: mode, id: 'basis-form', depth: 'screen' });
}

// ---------- Tab 1: LMP & years ----------
function tabLmp(ctx) {
  const { data, S, node } = ctx, id = String(S.nodeId), res = analysis(data, S.basis), s = res.summary;
  const sumE = px('summary', id), sum = sumE.data, stE = px('studio', id), st = stE.data, zsE = px('zones', id), fleetE = px('fleet', 'all'), fl = fleetE.data;
  const ch = chipsOf(node, sum?.link);
  const H = hourlySets(data, id);
  const omitted = res.audit.filter(a => a.status !== 'Included');
  const rtFull = fullYear(sum?.year, 'RT'), rtRow = (sum?.year || []).find(r => r.market === 'RT' && r.y === rtFull);
  const p30 = runRow(sum, 'pcr2030');
  const kp = `<div class="kpis">
      ${kpi('Mean price', s ? fmt.price(s.mean) : 'not held', '/MWh', s ? `${s.yearCount} year${s.yearCount > 1 ? 's' : ''} · ${fmt.int(s.hours)} h · ${LABELS[S.basis.weighting]}` : 'No result on the applied basis')}
      ${kpi('Typical range (p5 to p95)', s ? `${fmt.price(s.p05)} – ${fmt.price(s.p95)}` : 'not held', '/MWh', s ? `Median ${fmt.price(s.p50)} · hour-weighted` : '')}
      ${kpi('Hours below $0', s ? fmt.pct(s.negativePct) : 'not held', 'of hours', 'Applied basis. Curtailment screens use ≤ $0 (Tails & spreads).')}
      ${kpi(`Latest full year${rtFull ? ` (${rtFull} RT)` : ''}`, sum ? (rtRow ? fmt.price(rtRow.avg_lmp) : 'not held') : 'loading…', '/MWh', rtRow ? `${fmt.int(rtRow.n_hours)} h · settled · mart_bus_year` : 'No settled real-time year held')}
      ${kpi('2030 solved run (PCR 2030)', sum ? (p30 ? fmt.price(p30.avg_lmp) : 'not held') : 'loading…', '/MWh', `${p30 ? `${fmt.int(p30.n_hours)} h · modelled for this bus` : 'No PCR 2030 run at this bus'} · ${RUN_LEGEND}`)}
    </div>`;

  // All-years chart: settled RT/DA and the solved runs at their study years.
  const yrs = m => (sum?.year || []).filter(r => r.market === m);
  const fy = sum?.fcstYear || [];
  const yearSeries = [
    { name: 'RT mean', points: yrs('RT').map(r => ({ x: r.y, y: r.avg_lmp })) },
    { name: 'RT p95', dashed: true, points: yrs('RT').map(r => ({ x: r.y, y: r.p95 })) },
    { name: 'RT p5', dashed: true, points: yrs('RT').map(r => ({ x: r.y, y: r.p5 })) },
    { name: 'DA mean', points: yrs('DA').map(r => ({ x: r.y, y: r.avg_lmp })) },
    { name: 'PCR runs (solved)', dashed: true, points: fy.filter(r => /^pcr/.test(r.scenario)).map(r => ({ x: r.target_year, y: r.avg_lmp })) },
    { name: 'PROBE runs (solved)', dashed: true, points: fy.filter(r => !/^pcr/.test(r.scenario)).map(r => ({ x: r.target_year, y: r.avg_lmp })) },
  ]; // six series at most (dataviz rule): the runs' p95 is in the table below
  const yearChart = sum ? lineChart(yearSeries, { fmt: usd0, xfmt: v => String(Math.round(v)), title: 'Mean price by year, settled and solved', height: 250, emptyText: 'No settled year or solved run is held for this bus.' }) : pending(sumE, 'the yearly marts');

  // Hours held.
  const hoursChart = sum ? groupedBar([
    ...[...new Set((sum.year || []).map(r => r.y))].sort().map(y => ({ label: String(y), values: [yrs('RT').find(r => r.y === y)?.n_hours ?? null, yrs('DA').find(r => r.y === y)?.n_hours ?? null, null, calHours(y)] })),
    ...fy.map(r => ({ label: RUNS[r.scenario] || r.scenario, values: [null, null, r.n_hours, calHours(r.target_year)] })),
  ], { series: ['Real-time', 'Day-ahead', 'Solved run', 'Calendar hours'], fmt: v => fmt.int(v), title: 'Hours held per year', height: 250 }) : pending(sumE, 'the hours held');

  // Every year and run.
  const yearRows = sum ? [
    ...(sum.year || []).map(r => { const part = r.n_hours < 0.95 * calHours(r.y); return tr([td(`${r.y}${part ? ' <span class="pill warn">part year</span>' : ''}`), td(r.market === 'RT' ? 'Settled RT' : 'Settled DA'), tn(`${fmt.int(r.n_hours)} <span class="muted">${(100 * r.n_hours / calHours(r.y)).toFixed(1)}%</span>`), tn(n2(r.avg_lmp)), tn(n2(r.min_lmp)), tn(n2(r.p5)), tn(n2(r.p25)), tn(n2(r.p50)), tn(n2(r.p75)), tn(n2(r.p95)), tn(n2(r.max_lmp)), tn(n2(r.std_lmp)), tn(n2(r.peak_lmp)), tn(n2(r.offpeak_lmp)), tn(fmt.int(r.neg_hours)), tn(fmt.int(r.hours_gt_200))]); }),
    ...fy.map(r => tr([td(`${r.target_year}`), td(`Solved · ${esc(RUN[r.scenario] || r.scenario)}`), tn(`${fmt.int(r.n_hours)} <span class="muted">${(100 * r.n_hours / calHours(r.target_year)).toFixed(1)}%</span>`), tn(n2(r.avg_lmp)), tn(n2(r.min_lmp)), tn(n2(r.p5)), tn('—'), tn(n2(r.p50)), tn('—'), tn(n2(r.p95)), tn(n2(r.max_lmp)), tn(n2(r.std_lmp)), tn(n2(r.peak_lmp)), tn(n2(r.offpeak_lmp)), tn(fmt.int(r.neg_hours)), tn('—')])),
  ] : [];
  const yearTable = sum ? tbl(['Year', 'Series', ['Hours'], ['Mean'], ['Min'], ['p5'], ['p25'], ['p50'], ['p75'], ['p95'], ['Max'], ['Std'], ['Peak'], ['Off-peak'], ['< $0 h'], ['> $200 h']], yearRows, { max: 340 }) : pending(sumE, 'the yearly marts');

  // RT vs DA.
  const dr = sum?.daRt || [];
  const dartBody = sum ? (dr.length ? `${groupedBar(dr.map(r => ({ label: String(r.y), values: [r.avg_da, r.avg_rt] })), { series: ['Day-ahead', 'Real-time'], fmt: usd0, title: 'Real-time against day-ahead by year', height: 170 })}
      ${tbl(['Year', ['Hours both'], ['DA'], ['RT'], ['RT − DA'], ['|RT − DA|'], ['Std'], ['p5'], ['p95'], ['RT > DA']], dr.map(r => tr([td(r.y), tn(fmt.int(r.n_hours)), tn(n2(r.avg_da)), tn(n2(r.avg_rt)), tn(sgn(r.avg_rt_less_da)), tn(n2(r.avg_abs_spread)), tn(n2(r.std_spread)), tn(n2(r.p5_spread)), tn(n2(r.p95_spread)), tn(fmt.pct(100 * r.share_rt_above_da))])))}`
    : '<div class="empty"><strong>Not held</strong>No hour with both a day-ahead and a real-time price is held for this bus\'s series.</div>') : pending(sumE, 'the DA–RT mart');

  // Month × year matrix.
  const mm = S.ui.pMonMkt === 'DA' ? 'DA' : 'RT';
  const monRows = sum ? [
    ...[...new Set((sum.month || []).filter(r => r.market === mm).map(r => r.y))].sort().map(y => ({ label: String(y), cells: MONTHS.map((m, i) => ({ label: m, value: (sum.month.find(r => r.market === mm && r.y === y && r.m === i + 1) || {}).avg_lmp ?? null })) })),
    ...RUN_ORDER.filter(run => (sum.fcstMonth || []).some(r => r.scenario === run)).map(run => ({ label: RUNS[run], cells: MONTHS.map((m, i) => ({ label: m, value: (sum.fcstMonth.find(r => r.scenario === run && r.m === i + 1) || {}).avg_lmp ?? null })) })),
  ] : [];
  const monthMatrix = sum ? heatmap(monRows, { fmt: usd0, title: 'Monthly mean price by year', emptyText: 'No monthly marts are held for this bus.' }) : pending(sumE, 'the monthly marts');

  // Selected-basis monthly lines and audit (applied basis).
  const monthly = res.audit.filter(a => a.status === 'Included').map(a => ({
    name: String(a.year), dashed: S.basis.mode === 'forecast',
    points: MONTHS.map((_, i) => { const rs = a.rows.filter(r => clockMonth(r.timestamp) === i + 1), h = rs.reduce((t, r) => t + r.dtHours, 0); return { x: i + 1, y: h ? rs.reduce((t, r) => t + r.price * r.dtHours, 0) / h : null }; }),
  }));
  const audit = tbl(['Year', 'Status', ['Hours'], ['Mean $/MWh'], ['Weight'], ['Contribution']],
    res.audit.map(a => tr([td(a.year), td(`<span class="pill ${a.status === 'Included' ? 'good' : 'warn'}">${esc(a.status)}</span>`), tn(fmt.int(a.hours)), tn(fmt.price(a.mean)), tn(finite(a.normalizedWeight) ? (100 * a.normalizedWeight).toFixed(1) + '%' : '—'), tn(fmt.price(a.contribution))])));

  // Timeline: every month held, settled then solved.
  const tlRuns = sum ? RUN_ORDER.map(run => { const ty = runRow(sum, run)?.target_year; return { name: RUN[run], dashed: true, points: ty ? (sum.fcstMonth || []).filter(r => r.scenario === run).map(r => ({ x: ty + (r.m - 0.5) / 12, y: r.avg_lmp })) : [] }; }).filter(x => x.points.length) : [];
  const tl = sum ? [
    { name: 'Settled RT', points: (sum.month || []).filter(r => r.market === 'RT').map(r => ({ x: r.y + (r.m - 0.5) / 12, y: r.avg_lmp })) },
    // Six series at most: day-ahead is drawn only when fewer than five runs are held (it is in the matrix either way).
    ...(tlRuns.length < 5 ? [{ name: 'Settled DA', points: (sum.month || []).filter(r => r.market === 'DA').map(r => ({ x: r.y + (r.m - 0.5) / 12, y: r.avg_lmp })) }] : []),
    ...tlRuns,
  ] : [];
  const timeline = sum ? lineChart(tl, { fmt: usd0, xfmt: v => String(Math.floor(v)), title: 'Monthly price timeline, settled then solved', height: 220, emptyText: 'No monthly marts are held for this bus.' }) : pending(sumE, 'the monthly marts');

  // Forecast runs table (+ the 2035 pair).
  const fm = fl?.fcstMean || [];
  const t10 = runRow(sum, '10yr'), p35 = runRow(sum, 'pcr2035');
  const runsBody = sum ? (fy.length ? tbl(['Run', ['Year'], ['Hours'], ['Mean'], ['p5'], ['p50'], ['p95'], ['Peak'], ['Off-peak'], ['MCC'], ['< $0 h'], ['Fleet p50']],
    fy.map(r => tr([td(esc(RUN[r.scenario] || r.scenario)), tn(r.target_year), tn(fmt.int(r.n_hours)), tn(n2(r.avg_lmp)), tn(n2(r.p5)), tn(n2(r.p50)), tn(n2(r.p95)), tn(n2(r.peak_lmp)), tn(n2(r.offpeak_lmp)), tn(sgn(r.avg_cong)), tn(fmt.int(r.neg_hours)), tn(n2((fm.find(x => x.scenario === r.scenario) || {}).p50))]))
      .concat(t10 && p35 ? [tr([td('<b>2035 gap: 10-yr − PCR 2035</b>'), tn(2035), tn('—'), tn(`<b>${sgn(t10.avg_lmp - p35.avg_lmp)}</b>`), tn('—'), tn('—'), tn('—'), tn('—'), tn('—'), tn('—'), tn('—'), tn(`${(100 * (t10.avg_lmp - p35.avg_lmp) / p35.avg_lmp).toFixed(1)}%`)])] : []), { max: 300 })
    : '<div class="empty"><strong>No forecast run at this bus</strong>None of the five solved runs publishes a price for this model bus.</div>') : pending(sumE, 'the forecast marts');
  const fd = st?.bus?.fdelta;

  // Answer sentences (V6): computed from the same rows the cards draw; a value not held says so.
  const P = v => B(`$${Number(v).toFixed(2)}`);
  const aBasis = s ? `The applied basis averages ${P(s.mean)}/MWh over ${B(fmt.int(s.hours))} hours (${esc(describe(S.basis))}).` : 'No result on the applied basis yet: choose years or a run and apply.';
  const aYears = sum ? (rtRow || p30 ? `${rtRow ? `Settled real time averaged ${P(rtRow.avg_lmp)}/MWh in ${rtFull}` : 'No full settled real-time year is held'}${p30 ? `; the PCR 2030 run puts this bus at ${P(p30.avg_lmp)}${rtRow ? ` (${B(sgn(p30.avg_lmp - rtRow.avg_lmp))})` : ''}.` : '; no PCR 2030 run is held here.'}` : 'No settled year or solved run is held for this bus.') : '';
  const yrsRT = yrs('RT'), part = (sum?.year || []).filter(r => r.n_hours < 0.95 * calHours(r.y)).map(r => `${r.y} ${r.market}`);
  const aHeld = sum ? `${B(fmt.int(new Set(yrsRT.map(r => r.y)).size))} settled real-time years and ${B(fmt.int(fy.length))} solved runs are held; ${part.length ? `part years: ${esc(part.join(', '))}` : 'no part years'}.` : '';
  const fullRT = yrsRT.filter(r => r.n_hours >= 0.95 * calHours(r.y)), hiY = fullRT.reduce((a, r) => (!a || r.avg_lmp > a.avg_lmp ? r : a), null), loY = fullRT.reduce((a, r) => (!a || r.avg_lmp < a.avg_lmp ? r : a), null);
  const aTable = hiY ? `Among full settled real-time years the dearest was ${B(hiY.y)} at ${P(hiY.avg_lmp)} and the cheapest ${B(loY.y)} at ${P(loY.avg_lmp)}.` : sum ? 'No full settled real-time year is held; solved runs are listed.' : '';
  const dLast = dr.at(-1);
  const aDart = dLast ? `In ${dLast.y} real time settled ${B(sgn(dLast.avg_rt_less_da))} against day-ahead on average, above it in ${B(fmt.pct(100 * dLast.share_rt_above_da))} of hours.` : sum ? 'No hour with both a day-ahead and a real-time price is held.' : '';
  const cells = monRows.flatMap(r => r.cells.map(c => ({ row: r.label, ...c }))).filter(c => finite(c.value)), dear = cells.reduce((a, c) => (!a || c.value > a.value ? c : a), null);
  const aMatrix = dear ? `The dearest month shown is ${B(`${dear.label} ${dear.row}`)} at ${P(dear.value)}/MWh.` : sum ? 'No monthly mean is held.' : '';
  const lastM = (sum?.month || []).filter(r => r.market === 'RT').at(-1);
  const aTimeline = sum ? `${B(fmt.int((sum.month || []).filter(r => r.market === 'RT').length))} settled real-time months and ${B(fmt.int(tlRuns.length))} solved run years are drawn${lastM ? `; the latest settled month, ${MONTHS[lastM.m - 1]} ${lastM.y}, averaged ${P(lastM.avg_lmp)}` : ''}.` : '';
  const mPts = monthly.flatMap(sr => sr.points.filter(p => finite(p.y)).map(p => ({ yr: sr.name, ...p }))), mHi = mPts.reduce((a, p) => (!a || p.y > a.y ? p : a), null), mLo = mPts.reduce((a, p) => (!a || p.y < a.y ? p : a), null);
  const aMonthly = mHi ? `On the applied basis the dearest month is ${B(`${MONTHS[mHi.x - 1]} ${mHi.yr}`)} (${P(mHi.y)}) and the cheapest ${B(`${MONTHS[mLo.x - 1]} ${mLo.yr}`)} (${P(mLo.y)}).` : 'No month on the applied basis.';
  const inc = res.audit.filter(a => a.status === 'Included');
  const aAudit = `${B(`${inc.length} of ${res.audit.length}`)} selected ${S.basis.mode === 'forecast' ? 'runs' : 'years'} enter the mean${omitted.length ? `; left out: ${esc(omitted.map(a => `${a.year} (${a.status})`).join(', '))}` : ''}.`;
  const fHi = fy.reduce((a, r) => (!a || r.avg_lmp > a.avg_lmp ? r : a), null), fLo = fy.reduce((a, r) => (!a || r.avg_lmp < a.avg_lmp ? r : a), null);
  const aRuns = sum ? (fy.length ? `${B(fmt.int(fy.length))} solved runs price this bus from ${P(fLo.avg_lmp)} (${esc(RUN[fLo.scenario] || fLo.scenario)}) to ${P(fHi.avg_lmp)} (${esc(RUN[fHi.scenario] || fHi.scenario)}).` : 'None of the five solved runs publishes a price for this model bus.') : '';
  const sRows = sum && st ? sheetRows(sum, st, zsE.data) : [], sDiff = sRows.filter(r => finite(r.d) && Math.abs(r.d) > 0.5);
  const aSheet = st ? `${B(`${sDiff.length} of ${sRows.filter(r => finite(r.d)).length}`)} comparable quantities differ by more than 0.5 between the unified database (primary) and the Studio copy.` : stE.status === 'loading' ? '' : 'The live Studio sheet has no row for this bus.';

  return `${capeNotice(data, S.basis)}${errorsBlock(res)}
    ${omitted.length && s ? `<div class="notice warn">Omitted from this result: ${omitted.map(a => `${a.year} (${esc(a.status)})`).join(', ')}.</div>` : ''}
    ${kp}
    <div class="cards">
      ${basisForm(data, S.draft, aBasis)}
      ${card(S.depth === 'screen' ? 'c-12' : 'c-8', 'Mean price by year, settled and solved', 'Annual mean with p5 and p95 · settled RT/DA and every solved run at its study year', `${capeAllYears(data, id)}${yearChart}`, { answer: aYears, depth: 'screen', trace: 'p-years', chips: ch([]), foot: martFoot(node, sum) })}
      ${card('c-4', 'Years held', 'Hours with a price, against the calendar', hoursChart, { answer: aHeld, depth: 'review', trace: 'p-years', chips: ch([]), foot: 'A part year (2026) is compared by mean, never by sum.' })}
      ${card('c-12', 'Every settled year and solved run at this bus', 'unified mart_bus_year / mart_bus_fcst_year · $/MWh · quantiles interpolated over every hour', yearTable, { answer: aTable, depth: 'review', trace: 'p-years', chips: ch([]), foot: `${martFoot(node, sum)} · peak = hour 7–22 every day (HE08–HE23); solved peak = the run's own flag · < $0 is strictly below zero · Settled DA rows: ${ferNote()}` })}
      ${card('c-6', 'Real-time against day-ahead', 'Hour-matched, settled · unified mart_bus_da_rt', dartBody, { answer: aDart, depth: 'review', trace: 'p-dart', chips: ch([]), foot: `${histSrc(node, sum?.link)} · RT − DA > 0 means real time settled above the day-ahead price · ${ferNote()}` })}
      ${card('c-6', 'Monthly mean price by year', `${mm === 'RT' ? 'Real-time' : 'Day-ahead'} settled months, then each solved run`, monthMatrix, { answer: aMatrix, depth: 'review', chips: ch([]), tools: seg('pMonMkt', mm, [['RT', 'RT'], ['DA', 'DA']]), foot: 'unified mart_bus_month / mart_bus_fcst_month · darker = dearer' })}
      ${card('c-12', 'Monthly price timeline, settled then solved', 'Every month held at this bus; solved runs drawn at their study years (dashed)', timeline, { answer: aTimeline, depth: 'review', chips: ch([]), foot: martFoot(node, sum, 'a solved run is one modelled year, not a path between years') })}
      ${card('c-6', 'Monthly mean on the applied basis', describe(S.basis), s ? lineChart(monthly, { fmt: usd0, xfmt: v => MONTHS[v - 1] || '', xTicks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], title: 'Monthly mean price by year', height: 200 }) : noBasis(res, 'monthly means'), { answer: aMonthly, depth: 'review', trace: 'p-mean', chips: ch([]), foot: 'Hour-weighted from the hourly payload' })}
      ${card('c-6', 'Coverage and contribution audit', 'How each selected year enters the mean', audit, { answer: aAudit, depth: 'review', trace: 'p-mean', chips: ch([]), foot: `${esc(data.metadata?.componentConvention || '')}` })}
      ${card('c-6', 'Forecast runs at this bus', 'Each run is a separate study year; runs are never averaged', runsBody, { answer: aRuns, depth: 'review', trace: 'p-years', chips: ch(['modelled']), foot: `solved: fact_fcst_lmp_hourly · MCC on the settlement sign (runs' stored sign negated once)${fd ? ` · Studio extension (GridSense_one): 10-yr ${fmt.price(fd.a)} vs PCR 2035 ${fmt.price(fd.b)} (${sgn(fd.delta)})` : ''} · fleet p50 = median bus` })}
      ${hourlyExplorer(ctx, H)}
      ${card('c-12', 'Studio figures beside the unified database', 'The live Studio reads an older vendor sheet; the unified database is primary and the difference is shown', sheetTable(sum, st, stE, zsE), { answer: aSheet, depth: 'study', trace: 'p-sheet', chips: ch(['studio-copy']), foot: `Studio copy: ${esc(st?.meta?.sheet?.file || 'studio/src/data.js')} built ${esc(st?.meta?.sheet?.built_at || '—')} from ${esc(st?.meta?.sheet?.source || 'ISONE_GridSense.duckdb')} · extracted read-only by plan/extract_prices.py` })}
      <section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculations</h3><span class="card-sub">Formula, inputs, steps, a check and the working as CSV for every figure on this tab</span></header><div class="card-b">
        ${s ? traceLmp(data, S, node, res) : ''}
        ${sum ? traceYears(node, sum, H) : ''}
        ${sum ? traceDaRt(node, sum, H) : ''}
        ${sum && stE.status !== 'loading' ? traceSheet(node, sum, st, zsE.data) : ''}
        ${details(evidenceBlock(data, res))}
      </div></section>
    </div>
    ${nextStep('compare this bus with the hub and its zone in Prices › Basis & congestion', 'prices', 'basis')}`;
}

function sheetTable(sum, st, stE, zsE) {
  if (stE.status === 'loading' || !sum) return pending(stE.status === 'loading' ? stE : { status: 'loading' }, 'the Studio copy');
  if (!st) return '<div class="empty"><strong>No Studio figures for this bus</strong>The live Studio sheet has no row for this bus.</div>';
  const f = (v, int) => (finite(v) ? (int ? fmt.int(v) : n2(v)) : 'not held');
  return tbl(['Quantity', ['Unified database'], ['Studio copy (older database)'], ['Unified − Studio'], 'Data note'],
    sheetRows(sum, st, zsE.data).map(r => tr([td(esc(r.q)), tn(f(r.u, r.int)), tn(f(r.s, r.int)), tn(finite(r.d) ? `<span class="${Math.abs(r.d) > 0.5 ? 'pill warn' : ''}">${r.int ? `${r.d > 0 ? '+' : ''}${fmt.int(r.d)}` : sgn(r.d)}</span>` : '—'), `<td class="wrap">${esc(r.note)}</td>`])));
}

/** Hourly explorer: one day at this bus, node against the hub, with the components. */
function hourlyExplorer(ctx, H) {
  const { data, S } = ctx;
  const sets = H.filter(h => h.rows.length), hist = sets.filter(h => h.kind === 'settled');
  if (!sets.length) return card('c-6', 'Hourly explorer', 'One day, hour by hour', '<div class="empty"><strong>No hourly prices held</strong>This bus has neither settled history nor a solved run.</div>', { depth: 'study' });
  const serKey = sets.some(h => h.key === S.ui.pExpSer) || S.ui.pExpSer === 'hist' ? S.ui.pExpSer : hist.length ? 'hist' : sets[0].key;
  const pool = serKey === 'hist' ? hist.filter(h => h.market === 'RT') : sets.filter(h => h.key === serKey);
  const dates = [...new Set(pool.flatMap(h => h.rows.map(r => clockDate(r.timestamp))))].sort();
  const date = dates.includes(S.ui.pDate) ? S.ui.pDate : (() => { const all = pool.flatMap(h => h.rows); const t = topHours(all, 1)[0]; return t ? clockDate(t.timestamp) : dates.at(-1); })();
  const pick = (h, d) => (h ? h.rows.filter(r => clockDate(r.timestamp) === d) : []);
  const yr = Number(String(date).slice(0, 4));
  const node = serKey === 'hist' ? pick(hist.find(h => h.market === 'RT' && h.year === yr), date) : pick(pool[0], date);
  const da = serKey === 'hist' ? pick(hist.find(h => h.market === 'DA' && h.year === yr), date) : [];
  const hubSets = hourlySets(data, 'hub');
  const hub = serKey === 'hist' ? pick(hubSets.find(h => h.kind === 'settled' && h.market === 'RT' && h.year === yr), date) : pick(hubSets.find(h => h.key === serKey), date);
  const pts = rows => rows.map(r => ({ x: clockHour(r.timestamp) + 1, y: r.price }));
  const series = [{ name: serKey === 'hist' ? 'Node RT' : `Node ${RUN[serKey] || serKey}`, points: pts(node) }, ...(da.length ? [{ name: 'Node DA', points: pts(da) }] : []), ...(hub.length ? [{ name: 'Hub', dashed: true, points: pts(hub) }] : [])];
  const opts = [...(hist.length ? [['hist', 'Settled history']] : []), ...sets.filter(h => h.kind === 'solved').map(h => [h.key, RUN[h.key] || h.key])];
  const hubAt = hr => hub.find(r => clockHour(r.timestamp) === hr)?.price;
  const table = tbl(['HE', ['Node'], ['Energy'], ['Congestion'], ['Loss'], ['Hub'], ['Node − hub'], ...(da.length ? [['DA']] : [])],
    node.map(r => { const hr = clockHour(r.timestamp), hp = hubAt(hr), d = da.find(x => clockHour(x.timestamp) === hr); return tr([td(`${hr + 1}${/-04:00$|-05:00$/.test(r.timestamp) && node.filter(x => clockHour(x.timestamp) === hr).length > 1 ? ` <span class="muted">${r.timestamp.slice(-6)}</span>` : ''}`), tn(n2(r.price)), tn(n2(r.energy)), tn(sgn(r.congestion)), tn(n2(r.loss)), tn(n2(hp)), tn(finite(hp) ? sgn(r.price - hp) : 'not held'), ...(da.length ? [tn(n2(d?.price))] : [])]); }), { max: 260 });
  const tools = `${sel('pExpSer', serKey, opts, 'Series')}<input type="date" data-act="ui" data-k="pDate" value="${esc(date)}" min="${esc(dates[0])}" max="${esc(dates.at(-1))}" aria-label="Date" style="font-size:11.5px;min-height:22px;padding:1px 6px">`;
  const pk = node.reduce((a, r) => (!a || r.price > a.price ? r : a), null);
  const aExp = pk ? `On ${B(date)} the node peaked at ${B(`$${pk.price.toFixed(2)}`)} in ${B(`HE${clockHour(pk.timestamp) + 1}`)}${finite(hubAt(clockHour(pk.timestamp))) ? `, ${B(sgn(pk.price - hubAt(clockHour(pk.timestamp))))} against the hub` : ''}.` : `No hour is held on ${esc(date)}.`;
  return card('c-6', 'Hourly explorer', `${date} · hour ending (HE) 1–24${serKey === 'hist' ? ' · settled clock' : ' · model calendar'}`,
    `${answerP(aExp)}${lineChart(series, { fmt: usd0, xfmt: v => `HE${v}`, xTicks: [1, 6, 12, 18, 24], title: 'Hourly explorer', height: 170, emptyText: `No hour held on ${date}.` })}${table}`,
    { tools, depth: 'study', foot: `Opens on the dearest hour's day. ${serKey === 'hist' ? 'Settled' : 'Solved-run'} hours from the hourly payload (${node.length} held on this day); hub = ${serKey === 'hist' ? '.H.INTERNAL_HUB' : 'model bus 80000 (5-yr and 10-yr runs only)'}.` });
}

function evidenceBlock(data, res) {
  const m = data.metadata, src = m.sources?.[0];
  const rows = (res?.audit || []).map(a => `<li>${esc(a.year)}: ${esc(a.source || '—')} · ${fmt.int(a.hours)} h observed · ${esc(a.status)}</li>`).join('');
  return `<ul>${rows}</ul><p>Hourly payload extracted ${esc(m.createdAt?.slice(0, 10))} read-only from <span class="code">${esc(src?.file?.split('\\').pop())}</span>. ${esc(m.componentConvention)}. ${esc(m.historicalTimeNote)}</p>`;
}
const details = evidence => `<details><summary>Evidence and sources</summary>${evidence}</details>`;

// ---------- Tab 2: Basis & congestion ----------
function refSeriesFor(data, a, basis) {
  return data.series.find(s => s.nodeId === 'hub' && s.mode === basis.mode && Number(s.year) === Number(a.year) && (basis.mode === 'forecast' ? s.run === basis.run : s.market === basis.market));
}

function tabBasis(ctx) {
  const { data, S, node } = ctx, id = String(S.nodeId), res = analysis(data, S.basis);
  const sumE = px('summary', id), sum = sumE.data, zsE = px('zones', id), zs = zsE.data, csE = px('constraints', id), cs = csE.data, fleetE = px('fleet', 'all'), fl = fleetE.data, stE = px('studio', id), st = stE.data;
  const ch = chipsOf(node, sum?.link);
  let rows = [], missingRef = [];
  if (res.summary) for (const a of res.audit.filter(x => x.status === 'Included')) {
    const ref = refSeriesFor(data, a, S.basis);
    if (!ref) { missingRef.push(a.year); continue; }
    rows = rows.concat(matchedBasis(a.series, ref));
  }
  const n = rows.reduce((t, r) => t + r.dtHours, 0);
  const mean = n ? rows.reduce((t, r) => t + r.price * r.dtHours, 0) / n : null;
  const above = n ? 100 * rows.filter(r => r.price > 0).reduce((t, r) => t + r.dtHours, 0) / n : null;
  const withC = (res.rows || []).filter(r => finite(r.energy) && finite(r.congestion) && finite(r.loss)), hc = withC.reduce((t, r) => t + r.dtHours, 0);
  const comp = key => (hc ? withC.reduce((t, r) => t + r[key] * r.dtHours, 0) / hc : null);
  const E = comp('energy'), Cg = comp('congestion'), L = comp('loss');
  const zy = zs ? zoneYears(zs.settled) : [];
  const zFull = (() => { const ys = zy.filter(r => r.zone === 'Hub' && r.market === 'RT' && r.hours >= 0.95 * calHours(r.y)).map(r => r.y); return ys.length ? Math.max(...ys) : null; })();
  const own = zy.find(r => r.zone === zs?.ownZone && r.market === 'RT' && r.y === zFull);
  const rtFull = fullYear(sum?.year, 'RT'), rtRow = (sum?.year || []).find(r => r.market === 'RT' && r.y === rtFull);
  const periods = cs ? Object.keys(cs.periods) : [];
  const perOrder = p => (/^pcr/.test(p) ? 3e4 + Number(p.slice(3)) : (p.startsWith('DA') ? 0 : 1) * 1e4 + Number(p.slice(2)));
  periods.sort((a, b) => perOrder(a) - perOrder(b));
  const defPer = periods.includes(`RT${rtFull}`) ? `RT${rtFull}` : periods.at(-1);
  const per = periods.includes(S.ui.pCons) ? S.ui.pCons : defPer;
  const P = cs?.periods?.[per], exact = cs?.exact?.[per];
  const lead = cs?.periods?.[`RT${rtFull}`]?.rows?.[0];
  const kp = `<div class="kpis">
      ${kpi('Basis to ISO-NE hub', res.summary ? fmt.price(mean) : 'not held', '/MWh', res.summary ? `Applied basis · node − hub, hour-matched · ${fmt.int(n)} h` : 'No result on the applied basis')}
      ${kpi('Hours node above hub', res.summary ? fmt.pct(above) : 'not held', 'of hours', 'Applied basis · sign persistence')}
      ${kpi('Congestion component', res.summary ? fmt.price(Cg) : 'not held', '/MWh', `Applied basis · settled sign${S.basis.mode === 'forecast' ? ' · modelled for this bus' : ''}`)}
      ${kpi(`Basis to own zone${zs?.ownZone ? ` (${zs.ownZone})` : ''}`, zsE.status === 'loading' ? 'loading…' : own ? sgn(own.basis) : 'not held', '/MWh', own ? `${zFull} RT · ${fmt.int(own.hours)} matched h` : 'No settled series or zone held')}
      ${kpi(`Annual mean MCC${rtFull ? ` (${rtFull} RT)` : ''}`, sumE.status === 'loading' ? 'loading…' : rtRow ? sgn(rtRow.avg_cong) : 'not held', '/MWh', '− = priced below the system energy price (a pocket)')}
      ${kpi(`Leading settled constraint${rtFull ? ` (${rtFull} RT)` : ''}`, csE.status === 'loading' ? 'loading…' : lead ? sgn(lead.assoc) : 'not held', '/MWh', lead ? `${shortName(lead.name)} · ${fmt.int(lead.hours)} h bound · association` : 'No binding hour at this series')}
    </div>`;

  // Basis to hub by month (applied basis) and by year (all years).
  const monthly = MONTHS.map((m, i) => { const rs = rows.filter(r => clockMonth(r.timestamp) === i + 1); const h = rs.reduce((t, r) => t + r.dtHours, 0); return { label: m, value: h ? rs.reduce((t, r) => t + r.price * r.dtHours, 0) / h : null }; });
  const hubYears = [...new Set(zy.filter(r => r.zone === 'Hub').map(r => r.y))].sort();
  const fHub = zs ? RUN_ORDER.filter(r => finite(zs.forecastNode?.[r]) && finite(zs.forecastHub?.[r])) : [];
  const byYear = zs ? groupedBar([
    ...hubYears.map(y => ({ label: String(y), values: [zy.find(r => r.zone === 'Hub' && r.market === 'RT' && r.y === y)?.basis ?? null, zy.find(r => r.zone === 'Hub' && r.market === 'DA' && r.y === y)?.basis ?? null, null] })),
    ...fHub.map(r => ({ label: `${runRow(sum, r)?.target_year ?? ''} ${r}`, values: [null, null, zs.forecastNode[r] - zs.forecastHub[r]] })),
  ], { series: ['Real-time', 'Day-ahead', 'Solved run'], fmt: usd2, title: 'Basis to hub by year', height: 200, emptyText: 'No settled series is held for this bus.' }) : pending(zsE, 'the zone and hub series');

  // Node against each zone for a chosen year/market.
  const zOpts = [...new Set(zy.map(r => `${r.market}|${r.y}`))].sort().reverse().map(k => [k, k.replace('|', ' ')]);
  const zSel = zOpts.some(o => o[0] === S.ui.pZone) ? S.ui.pZone : zFull ? `RT|${zFull}` : zOpts[0]?.[0];
  const [zm, zyr] = String(zSel || '').split('|');
  const zItems = zy.filter(r => r.market === zm && r.y === Number(zyr)).sort((a, b) => b.basis - a.basis).map(r => ({ label: `${r.zone}${r.zone === zs?.ownZone ? ' (own)' : ''}`, value: r.basis }));
  const zoneChart = zs ? barChart(zItems, { fmt: usd2, title: 'Node against each load zone', height: 200, emptyText: 'No settled series is held for this bus.' }) : pending(zsE, 'the zone series');

  // Zone × year table incl. forecast (node − zone mean of buses).
  const zones = [...new Set(zy.map(r => r.zone))].sort((a, b) => (a === 'Hub') - (b === 'Hub') || a.localeCompare(b));
  const rtYears = [...new Set(zy.filter(r => r.market === 'RT').map(r => r.y))].sort();
  const fzv = (run, zone) => { const z = (zs?.forecastZones || []).find(x => x.scenario === run && x.zone === zone), nv = zs?.forecastNode?.[run]; return zone === 'Hub' ? (finite(nv) && finite(zs?.forecastHub?.[run]) ? nv - zs.forecastHub[run] : null) : z && finite(nv) ? nv - z.zone_mean : null; };
  const zoneTable = zs ? tbl(['Zone', ...rtYears.map(y => [`${y} RT`]), ['2030 PCR'], ['2035 PCR'], ['2040 PCR']],
    (zones.length ? zones : ['Hub', 'CT', 'ME', 'NEMA', 'NH', 'RI', 'SEMA', 'VT', 'WCMA']).map(z => tr([td(`${z === zs.ownZone ? '<b>' : ''}${esc(z)}${z === zs.ownZone ? ' (own)</b>' : ''}`), ...rtYears.map(y => tn(sgn(zy.find(r => r.zone === z && r.market === 'RT' && r.y === y)?.basis))), tn(sgn(fzv('pcr2030', z))), tn(sgn(fzv('pcr2035', z))), tn(sgn(fzv('pcr2040', z)))]))) : pending(zsE, 'the zone series');

  // Components by year.
  const cy = componentYears(sum, 'RT');
  const compChart = sum ? (typeof C.stackedBar === 'function'
    ? C.stackedBar(cy.map(r => ({ label: r.label, values: [r.energy, r.congestion, r.loss] })), { series: ['Energy', 'Congestion', 'Losses'], fmt: usd1, title: 'Price components by year', height: 220 })
    : groupedBar(cy.map(r => ({ label: r.label, values: [r.energy, r.congestion, r.loss] })), { series: ['Energy', 'Congestion', 'Losses'], fmt: usd1, title: 'Price components by year', height: 220 })) : pending(sumE, 'the component marts');
  const compTable = sum ? tbl(['Year', 'Series', ['Energy'], ['Congestion'], ['Losses'], ['E + C + L'], ['Mean LMP'], ['Hours']], cy.map(r => tr([td(r.y), td(r.kind === 'settled' ? 'Settled RT' : esc(RUN[r.run] || r.run)), tn(n2(r.energy)), tn(sgn(r.congestion)), tn(sgn(r.loss)), tn(n2(finite(r.energy) && finite(r.congestion) && finite(r.loss) ? r.energy + r.congestion + r.loss : null)), tn(n2(r.lmp)), tn(fmt.int(r.n))])), { max: 220 }) : '';

  // Binding constraints for the chosen period.
  const isExact = !!exact?.length;
  const consRows = isExact ? exact.slice(0, 12) : (P?.rows || []);
  const consChart = cs ? barChart(consRows.slice(0, 8).map(r => ({ label: shortName(r.name).slice(0, 18), value: isExact ? r.contrib : r.assoc })), { fmt: v => `$${v.toFixed(3)}`, title: 'Binding constraints at this bus', height: 220, emptyText: `No network constraint bound in the hours this bus has a price for (${per || 'no period'}).` }) : pending(csE, 'the binding constraints');
  const byName = new Map((P?.rows || []).map(r => [r.name, r]));
  const consTable = cs ? (consRows.length ? tbl(['Constraint', ['Hours bound'], ['MCC when bound'], ['MCC otherwise'], ['Association'], ['Mean |shadow|'], ['Max |shadow|'], ...(isExact ? [['DFAX'], ['Exact share']] : [])],
    consRows.map(r => { const a = byName.get(r.name) || r; return tr([`<td class="wrap" title="${esc(r.name)}">${esc(shortName(r.name))}</td>`, tn(fmt.int(a.hours ?? r.hours)), tn(sgn(a.mcc_on)), tn(sgn(a.mcc_off)), tn(finite(a.assoc) ? `$${a.assoc.toFixed(4)}` : 'not held'), tn(n2(a.mean_abs_shadow)), tn(n2(a.max_abs_shadow)), ...(isExact ? [tn(finite(r.dfax) ? r.dfax.toFixed(4) : 'not held'), tn(finite(r.contrib) ? `$${r.contrib.toFixed(4)}` : 'not held')] : [])]); }), { max: 260 }) : '') : '';
  const perOpts = periods.map(p => [p, periodLabel(p)]);
  const consFoot = cs ? `${/^pcr/.test(per || '') ? `solved at model bus ${esc(id)} · ${isExact ? 'EXACT: the run publishes this node\'s DFAX (fact_pcr_cong_impact), shares sum to the annual MCC' : 'association (no unit at this node, so no DFAX is published)'}` : `${histSrc(node, cs.link)} · association: settled records carry no shift factor`} · annual mean MCC ${sgn(P?.mcc)} over ${fmt.int(P?.n)} h · ${fmt.int(P?.bound)} constraints bound in its hours · ${esc(cs.rules.excluded)}` : '';

  // MCC by period and system counts.
  const mccItems = periods.map(p => ({ label: perShort(p), value: cs.periods[p].mcc }));
  const mccBody = cs ? `${barChart(mccItems, { fmt: usd2, title: 'Annual mean congestion by period', height: 180 })}${tbl(['Period', ['MCC'], ['Hours'], ['Bound here'], ['ISO constraints'], ['ISO hours binding']], periods.map(p => { const sy = cs.system?.[p] || {}; return tr([td(periodLabel(p)), tn(sgn(cs.periods[p].mcc)), tn(fmt.int(cs.periods[p].n)), tn(fmt.int(cs.periods[p].bound)), tn(fmt.int(sy.constraints)), tn(fmt.int(sy.hours_any_binding))]); }), { max: 200 })}` : pending(csE, 'the congestion periods');

  // Zone ranking (ISO-wide zones, settled).
  const zr = fl ? (() => { const y = Math.max(...fl.zones.filter(r => r.market === 'RT' && r.n_hours >= 0.95 * calHours(r.y)).map(r => r.y)); const hub = fl.zones.find(r => r.zone === 'Hub' && r.market === 'RT' && r.y === y); return { y, hub, rows: fl.zones.filter(r => r.market === 'RT' && r.y === y && r.zone !== 'Hub').sort((a, b) => b.avg_lmp - a.avg_lmp) }; })() : null;
  const rankBody = zr ? `${barChart(zr.rows.map(r => ({ label: `${r.zone}${r.zone === zs?.ownZone ? ' (own)' : ''}`, value: r.avg_lmp - zr.hub.avg_lmp })), { fmt: usd2, title: 'Zone price ranking', height: 170 })}
    ${tbl(['Zone', ['Mean'], ['vs hub'], ['p95'], ['< $0 h'], ['> $200 h'], ['MCC']], zr.rows.map(r => tr([td(`${r.zone === zs?.ownZone ? '<b>' : ''}${esc(r.zone)}${r.zone === zs?.ownZone ? ' (own)</b>' : ''}`), tn(n2(r.avg_lmp)), tn(sgn(r.avg_lmp - zr.hub.avg_lmp)), tn(n2(r.p95)), tn(fmt.int(r.neg_hours)), tn(fmt.int(r.hours_gt_200)), tn(sgn(r.avg_cong))])).concat([tr([td('Hub'), tn(n2(zr.hub.avg_lmp)), tn('—'), tn(n2(zr.hub.p95)), tn(fmt.int(zr.hub.neg_hours)), tn(fmt.int(zr.hub.hours_gt_200)), tn(sgn(zr.hub.avg_cong))])]), { max: 220 })}` : pending(fleetE, 'the zone series');

  // Price map.
  const mapYears = fl?.years || [];
  const my = mapYears.includes(Number(S.ui.pMapYear)) ? Number(S.ui.pMapYear) : (zr?.y ?? mapYears.at(-1));
  const mi = mapYears.indexOf(my);
  const mapBody = fl ? priceMap((data.index || []).map(b => ({ id: b.id, name: b.name, lat: b.lat, lon: b.lon, value: fl.rtMean[b.id]?.[mi] ?? null })), { highlight: id, fmt: usd0, title: `RT mean price by bus, ${my}`, height: 430 }) : pending(fleetE, 'the ISO-wide price marts');

  // Studio copy: constraint headlines and 2030 zonal basis.
  const stBody = st ? `${tbl(['Period', 'Studio headline constraint', ['$/MWh'], 'Kind'], (st.bus.top || []).map(t => tr([td(periodLabel(t.period)), `<td class="wrap" title="${esc(t.name)}">${esc(shortName(t.name))}</td>`, tn(finite(t.value) ? t.value.toFixed(4) : 'not held'), td(t.exact ? 'exact' : 'association')])), { max: 200 })}
    ${tbl(['Zone', ['Sheet basis 2030'], ['Unified 5-yr node − zone'], ['Difference']], ['ME', 'NH', 'VT', 'CT', 'RI', 'SEMA', 'WCMA', 'NEMA'].map(z => { const sv = st.bus.sheet?.[`basis_${z}_2030`], uv = fzv('5yr', z); return tr([td(z), tn(sgn(sv)), tn(sgn(uv)), tn(finite(sv) && finite(uv) ? sgn(uv - sv) : '—')]); }), { max: 200 })}
    <p class="audit-note" style="margin:0">Sheet top constraint: <b>${esc(st.bus.sheet?.top_constraint || 'not held')}</b> (${esc(finite(st.bus.sheet?.top_shadow) ? `$${st.bus.sheet.top_shadow}` : '—')}) — excluded by the unified database: the vendor field's 12 names have no overlap with real constraints.</p>`
    : stE.status === 'loading' ? pending(stE, 'the Studio copy') : '<div class="empty"><strong>No Studio figures for this bus</strong>The live Studio sheet has no row for this bus.</div>';

  // Answer sentences (V6).
  const mH = monthly.filter(m => finite(m.value)), mMax = mH.reduce((a, m) => (!a || m.value > a.value ? m : a), null), mMin = mH.reduce((a, m) => (!a || m.value < a.value ? m : a), null);
  const aMon = mMax ? `On the applied basis the node runs from ${B(sgn(mMin.value))} (${mMin.label}) to ${B(sgn(mMax.value))} (${mMax.label}) against the hub.` : 'No hour matched with the hub on the applied basis.';
  const hubRT = zFull ? zy.find(r => r.zone === 'Hub' && r.market === 'RT' && r.y === zFull) : null;
  const aByYear = zs ? (hubRT ? `In ${zFull} real time the node settled ${B(sgn(hubRT.basis))}/MWh against the hub${fHub.length ? `; ${fHub.length} solved run${fHub.length > 1 ? 's' : ''} with a hub bus are drawn beside it` : ''}.` : 'No full settled year with a hub match is held for this bus.') : '';
  const zMax = zItems[0], zMin = zItems.at(-1);
  const aZone = zItems.length ? `In ${esc(String(zSel || '').replace('|', ' '))} the node is furthest above ${B(zMax.label)} (${B(sgn(zMax.value))}) and furthest below ${B(zMin.label)} (${B(sgn(zMin.value))}).` : zs ? 'No settled series is held for this bus.' : '';
  const aZoneT = zs ? (own ? `Against its own zone, ${B(zs.ownZone)}, the node ran ${B(sgn(own.basis))}/MWh in ${zFull} real time.` : 'No own-zone match is held for a full settled year.') : '';
  const cLast = [...cy].reverse().find(r => r.kind === 'settled');
  const aComp = cLast ? `In ${cLast.y} settled real time, congestion was ${B(sgn(cLast.congestion))} and losses ${B(sgn(cLast.loss))} of a ${B(`$${n2(cLast.lmp)}`)} mean price.` : sum ? 'No settled component year is held; solved runs are listed.' : '';
  const top = consRows[0];
  const aCons = cs ? (top ? `${B(shortName(top.name))} leads in ${esc(periodLabel(per))}: ${B(`$${(isExact ? top.contrib : (byName.get(top.name) || top).assoc ?? 0).toFixed(3)}`)}/MWh of the annual mean congestion (${isExact ? 'exact share' : 'association'}).` : `No network constraint bound in this bus's hours in ${esc(periodLabel(per))}.`) : '';
  const mccH = mccItems.filter(m => finite(m.value)), mccMax = mccH.reduce((a, m) => (!a || Math.abs(m.value) > Math.abs(a.value) ? m : a), null);
  const aMcc = mccMax ? `Congestion here is largest in magnitude in ${B(periodLabel(periods[mccItems.indexOf(mccMax)]))} at ${B(sgn(mccMax.value))}/MWh, across ${B(fmt.int(periods.length))} periods.` : cs ? 'No congestion period is held.' : '';
  const aRank = zr?.rows?.length ? `In ${zr.y} ${B(zr.rows[0].zone)} was the dearest zone (${B(sgn(zr.rows[0].avg_lmp - zr.hub.avg_lmp))} vs hub) and ${B(zr.rows.at(-1).zone)} the cheapest (${B(sgn(zr.rows.at(-1).avg_lmp - zr.hub.avg_lmp))}).` : '';
  const mapVals = fl ? Object.values(fl.rtMean).map(v => v?.[mi]).filter(finite) : [], mine = fl?.rtMean?.[id]?.[mi];
  const aMap = fl ? (finite(mine) ? `This bus averaged ${B(`$${mine.toFixed(2)}`)} in ${my}, dearer than ${B(fmt.pct((100 * mapVals.filter(v => v < mine).length) / mapVals.length))} of ${B(fmt.int(mapVals.length))} priced buses.` : `No settled price is held for this bus in ${my}.`) : '';
  const t0 = st?.bus?.top?.[0];
  const aStudio = st ? (t0 ? `The Studio's headline constraint for ${esc(periodLabel(t0.period))} is ${B(shortName(t0.name))}; its sheet field ${B(st.bus.sheet?.top_constraint || 'not held')} is excluded by the unified database.` : 'The Studio copy lists no headline constraint for this bus.') : '';
  const aCompB = res.summary ? `On the applied basis energy is ${B(fmt.price(E))}, congestion ${B(fmt.price(Cg))} and losses ${B(fmt.price(L))} per MWh.` : '';

  return `${capeNotice(data, S.basis)}${missingRef.length ? `<div class="notice warn">No hub series for ${missingRef.join(', ')} on this basis; those years are left out of the basis result.</div>` : ''}
    ${kp}
    <div class="cards">
      ${card('c-4', 'Basis to hub by month', `Applied basis · ${describe(S.basis)}`, res.summary ? barChart(monthly, { fmt: usd1, title: 'Monthly basis to hub', height: 200, emptyText: 'No hour matched with the hub on this basis.' }) : noBasis(res, 'hub basis'), { answer: aMon, depth: 'review', trace: 'p-basis', chips: ch([]), foot: 'Mean node − hub, matched hours only' })}
      ${card(S.depth === 'screen' ? 'c-12' : 'c-4', 'Basis to hub by year', 'Every settled year, then solved runs with a hub bus', byYear, { answer: aByYear, depth: 'screen', trace: 'p-zone', chips: ch([]), foot: `unified fact_lmp_hourly, hour-matched · solved hub = model bus 80000 (5-yr, 10-yr only)` })}
      ${card('c-4', 'Node against each load zone', 'Node − zone, hour-matched', zoneChart, { answer: aZone, depth: 'review', trace: 'p-zone', chips: ch([]), tools: zOpts.length ? sel('pZone', zSel, zOpts, 'Market and year') : '', foot: `${histSrc(node, zs?.link)} · zone = the operator's .Z.* series` })}
      ${card('c-6', 'Basis to every zone, every year', 'Settled RT by year; solved = node − the mean of the zone\'s buses in that run', zoneTable, { answer: aZoneT, depth: 'review', trace: 'p-zone', chips: ch([]), foot: esc(zs?.rules?.forecast_zone || '') })}
      ${card('c-6', 'Price components by year', 'Energy + congestion + losses, settled RT then solved', `${compChart}${compTable}`, { answer: aComp, depth: 'review', trace: 'p-compyears', chips: ch([]), foot: 'unified mart_bus_year / mart_bus_fcst_year · runs: stored congestion negated once, energy = LMP − C − L' })}
      ${card('c-8', 'Binding constraints at this bus', `${periodLabel(per)} · top ${consRows.length} by ${isExact ? 'exact share' : 'association'}, $/MWh on the annual mean MCC`, `${consChart}${consTable}`, { answer: aCons, depth: 'study', trace: 'p-cons', chips: ch([]), tools: perOpts.length ? sel('pCons', per, perOpts, 'Period') : '', foot: consFoot })}
      ${card('c-4', 'Congestion by period', 'Annual mean MCC at this bus, settled and solved', mccBody, { answer: aMcc, depth: 'review', trace: 'p-cons', chips: ch([]), foot: 'ISO constraints = distinct network constraints that bound in the period anywhere' })}
      ${card('c-6', 'Zone price ranking', `${zr ? zr.y : ''} settled RT · which zones are discounted or premium`, rankBody, { answer: aRank, depth: 'review', chips: ch([]), foot: 'unified pn_year (.Z.* load-zone series and .H.INTERNAL_HUB)' })}
      ${card('c-6', 'Studio copy: constraints and zonal basis', 'What the live Studio shows for this bus, beside the unified figures', stBody, { answer: aStudio, depth: 'study', chips: ch(['studio-copy']), foot: `Constraint headlines: ${esc(st?.meta?.ext?.label || 'Studio extension')} (${esc(st?.meta?.ext?.built_at || '')}); 5-yr and 10-yr binding records are not in the unified database, so these are the only source for those runs · zonal basis: ${esc(st?.meta?.sheet?.label || 'vendor sheet')}, whose 2030 is the 5-yr run relabelled` })}
      ${card('c-8', 'Price map', `Settled RT mean by bus, ${my ?? ''} · click a bus to make it the candidate`, mapBody, { answer: aMap, depth: 'review', chips: ch([]), tools: mapYears.length ? sel('pMapYear', my, mapYears.map(y => [y, `${y}${fl?.calendarHoursHeld?.[y] < 0.95 * calHours(y) ? ' (part)' : ''}`]), 'Year') : '', foot: `unified mart_bus_year · a bus on a borrowed or shared series shows that series' price · ${esc(fl?.note || '')}` })}
      ${card('c-4', 'Components on the applied basis', describe(S.basis), res.summary ? tbl(['Component', ['$/MWh']], [tr([td('Energy'), tn(fmt.price(E))]), tr([td('Congestion'), tn(fmt.price(Cg))]), tr([td('Losses'), tn(fmt.price(L))]), tr([td(`<b>Energy + congestion + losses</b> (${fmt.int(hc)} h with all three)`), tn(`<b>${fmt.price(finite(E) ? E + Cg + L : null)}</b>`)]), tr([td(`Observed mean price (all ${fmt.int(res.summary.hours)} h)`), tn(fmt.price(res.summary.observedMean))])]) : noBasis(res, 'components'), { answer: aCompB, depth: 'review', trace: 'p-comp', chips: ch([]), foot: 'Hourly payload; one set of hours for every component' })}
      <section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculations</h3><span class="card-sub">Formula, inputs, steps, a check and the working as CSV</span></header><div class="card-b">
        ${res.summary ? traceBasis(data, S, node, res, refSeriesFor) : ''}
        ${zs ? traceZones(node, zs, data, id) : ''}
        ${cs && P ? traceConstraints(node, cs, per, sum) : ''}
        ${sum ? traceCompYears(node, sum) : ''}
        ${details(evidenceBlock(data, res))}
      </div></section>
    </div>
    ${nextStep(`see when this bus is dear or cheap in Prices › ${priceTabLabel('shape', S.tech) || 'Shape & capture'}`, 'prices', 'shape')}`;
}

/** Constraint label for a chart axis: 'A · B' names shortened to the monitored element. */
export function shortName(name) {
  const s = String(name || '');
  const m = s.split(' · ')[0].replace(/\s+/g, ' ').trim();
  return m.length > 46 ? `${m.slice(0, 44)}…` : m;
}
export function periodLabel(p) {
  if (!p) return '—';
  if (RUN[p]) return RUN[p];
  const m = /^(RT|DA)(\d{4})$/.exec(p);
  return m ? `Settled ${m[2]} ${m[1]}${Number(m[2]) >= 2026 ? ' (part)' : ''}` : p;
}

// ---------- Tab 3: Shape & capture ----------
function tabShape(ctx) {
  const { data, S, node } = ctx, id = String(S.nodeId), res = analysis(data, S.basis);
  const sumE = px('summary', id), sum = sumE.data, fleetE = px('fleet', 'all'), fl = fleetE.data, stE = px('studio', id), st = stE.data;
  const ch = chipsOf(node, sum?.link);
  const H = hourlySets(data, id);
  // Hourly shape: applied basis vs each solved run.
  const shape = res.summary ? hourlyShape(res.rows) : [];
  const shapeSeries = [{ name: `Applied basis`, points: shape.map(p => ({ x: p.hour, y: p.value })) },
    ...RUN_ORDER.filter(r => (sum?.fcstHour || []).some(x => x.scenario === r)).map(r => ({ name: RUN[r], dashed: true, points: sum.fcstHour.filter(x => x.scenario === r).map(x => ({ x: x.h, y: x.avg_lmp })) }))];
  // Peak / off-peak by year.
  const pkRows = [...(sum?.year || []).filter(r => r.market === 'RT'), ...(sum?.fcstYear || [])];
  const pkBody = sum ? `${groupedBar(pkRows.map(r => ({ label: r.scenario ? `${r.target_year} ${r.scenario}` : String(r.y), values: [r.peak_lmp, r.offpeak_lmp] })), { series: ['Peak (HE08–23)', 'Off-peak'], fmt: usd0, title: 'Peak and off-peak by year', height: 180 })}
    ${tbl(['Year', 'Series', ['Peak'], ['Off-peak'], ['Spread'], ['Ratio'], ['Mean']], pkRows.map(r => tr([td(r.scenario ? r.target_year : r.y), td(r.scenario ? esc(RUN[r.scenario]) : 'Settled RT'), tn(n2(r.peak_lmp)), tn(n2(r.offpeak_lmp)), tn(finite(r.peak_lmp) && finite(r.offpeak_lmp) ? sgn(r.peak_lmp - r.offpeak_lmp) : 'not held'), tn(finite(r.peak_lmp) && r.offpeak_lmp ? r3(r.peak_lmp / r.offpeak_lmp) : 'not held'), tn(n2(r.avg_lmp))])), { max: 220 })}` : pending(sumE, 'the yearly marts');
  const heat = res.summary ? heatmap(MONTHS.map((m, mi) => ({ label: m, cells: Array.from({ length: 24 }, (_, h) => { const rs = res.rows.filter(r => clockMonth(r.timestamp) === mi + 1 && clockHour(r.timestamp) === h), hh = rs.reduce((t, r) => t + r.dtHours, 0); return { label: `${h}:00`, value: hh ? rs.reduce((t, r) => t + r.price * r.dtHours, 0) / hh : null }; }) })), { fmt: usd0, title: 'Price by month and hour' }) : noBasis(res, 'month × hour prices');
  const dearest = res.summary ? (() => { let best = null; for (let mi = 0; mi < 12; mi++) for (let h = 0; h < 24; h++) { const rs = res.rows.filter(r => clockMonth(r.timestamp) === mi + 1 && clockHour(r.timestamp) === h); if (!rs.length) continue; const v = rs.reduce((t, r) => t + r.price, 0) / rs.length; if (!best || v > best.v) best = { v, mi, h }; } return best; })() : null;
  const aHeat = dearest ? `The dearest month-hour on the applied basis is ${B(`${MONTHS[dearest.mi]} HE${dearest.h + 1}`)} at ${B(`$${dearest.v.toFixed(2)}`)}/MWh.` : 'No result on the applied basis.';
  const shHi = shape.filter(p => finite(p.value)).reduce((a, p) => (!a || p.value > a.value ? p : a), null), shLo = shape.filter(p => finite(p.value)).reduce((a, p) => (!a || p.value < a.value ? p : a), null);
  const aShape = shHi ? `On the applied basis the dearest clock hour is ${B(`HE${shHi.hour + 1}`)} (${B(`$${shHi.value.toFixed(2)}`)}) and the cheapest ${B(`HE${shLo.hour + 1}`)} (${B(`$${shLo.value.toFixed(2)}`)}).` : 'No hourly shape on the applied basis.';
  const pkLast = [...pkRows].reverse().find(r => !r.scenario && finite(r.peak_lmp) && finite(r.offpeak_lmp));
  const aPeak = pkLast ? `In ${pkLast.y} settled real time peak hours averaged ${B(`$${pkLast.peak_lmp.toFixed(2)}`)}, ${B(sgn(pkLast.peak_lmp - pkLast.offpeak_lmp))} against off-peak.` : sum ? 'No settled peak and off-peak year is held; solved runs are listed.' : '';
  const commonCards = `${card('c-8', 'Month-hour prices', `Applied basis · ${dearest ? `dearest cell ${MONTHS[dearest.mi]} HE${dearest.h + 1} at ${fmt.price(dearest.v)}/MWh` : describe(S.basis)}`, heat, { answer: aHeat, depth: 'review', chips: ch([]), foot: 'Hour-weighted mean per month and clock hour · darker = dearer · hover a cell' })}${card('c-4', 'Hourly price shape: history against forecast', 'Applied basis and each solved run, by clock hour', lineChart(shapeSeries, { fmt: usd0, xfmt: v => `${v}:00`, xTicks: [0, 6, 12, 18, 23], title: 'Price by hour', height: 240, emptyText: 'No hourly shape held.' }), { answer: aShape, depth: 'review', chips: ch([]), foot: 'solved: unified mart_bus_fcst_hour (model calendar)' })}${card('c-6', 'Peak and off-peak by year', 'Peak = hour 7–22 every day (HE08–HE23); solved peak = the run\'s flag', pkBody, { answer: aPeak, depth: 'review', trace: 'p-peak', chips: ch([]), foot: 'unified mart_bus_year / mart_bus_fcst_year' })}`;
  const fuel = fuelOf(S.tech), rtFull = fullYear(sum?.year, 'RT');
  const env = { S, node, id, res, sum, sumE, st, H: H.filter(h => h.rows.length), chips: ch, rtFull, foot: x => martFoot(node, sum, x), noBasis: what => noBasis(res, what), cape: capeAllYears(data, id) };
  if (fuel === 'datacenter' || fuel === 'storage' || fuel === 'wind') {
    // Fuel-specific headline (GAP v4): no solar capture for a load or a battery; wind reads the fleet wind shape.
    const f = fuel === 'datacenter' ? dcShape(env) : fuel === 'storage' ? storageCards(env) : windShape(env);
    const na = fuel === 'storage' ? notApplicable('c-12', 'Generation capture price', 'storage', 'A battery buys and sells: its value is the spread it captures (the blocks and spread curve here, Tails & spreads, and Economics › Storage revenue), not a generation-weighted capture price.', 'review') : '';
    return `${capeNotice(data, S.basis)}<div class="kpis">${f.kpis.join('')}</div>
    <div class="cards">
      ${f.cards.join('')}
      ${commonCards}${na}
      ${studyTrace(`${f.traces.join('')}${sum ? tracePeak(node, sum, H) : ''}${details(evidenceBlock(data, res))}`)}
    </div>
    ${nextStep(`check the extremes in Prices › ${priceTabLabel('tails', S.tech) || 'Tails & spreads'}`, 'prices', 'tails')}`;
  }
  const profile = S.ui.profile || 'solar';
  const lat = node?.latitude, lon = node?.longitude;
  const g = profile === 'solar' ? r => clearSky(r.timestamp, lat, lon) : () => 1;
  const c = res.summary ? capture(res.rows, g) : {};
  const monthlyRows = res.summary ? MONTHS.map((m, i) => { const rs = res.rows.filter(r => clockMonth(r.timestamp) === i + 1); return { m, ...capture(rs, g) }; }) : [];
  const cs = capYears(H, lat, lon);
  const rtLast = [...cs].reverse().find(r => r.kind === 'settled' && r.market === 'RT' && r.n >= 0.95 * calHours(r.year));
  const flY = fl?.capture?.find(r => r.y === rtLast?.year);
  const pk = (sum?.year || []).find(r => r.market === 'RT' && r.y === rtFull);
  // Hybrid = the solar cards (PV side) plus the battery's charge/discharge blocks and spread curve.
  const hyb = fuel === 'hybrid' ? storageCards(env, { withKpis: false, key: 'hybrid' }) : { cards: [], traces: [] };
  const profSeg = `<div class="segmented seg-sm" role="group" aria-label="Generation profile">
    <button data-act="ui" data-k="profile" data-v="solar" class="${profile === 'solar' ? 'active' : ''}">Solar (clear-sky)</button>
    <button data-act="ui" data-k="profile" data-v="flat" class="${profile === 'flat' ? 'active' : ''}">Flat</button>
  </div>`;
  const kp = `<div class="kpis">
      ${kpi(profile === 'solar' ? 'Solar capture price' : 'Time-weighted price', res.summary ? fmt.price(c.capture) : 'not held', '/MWh', profile === 'solar' ? 'Applied basis · clear-sky assumption' : 'Applied basis · proxy')}
      ${kpi('Capture ratio', res.summary && finite(c.ratio) ? c.ratio.toFixed(3) : 'not held', '', 'Capture ÷ average price (applied basis)')}
      ${kpi('Clear-sky upper bound', res.summary && finite(c.cf) ? fmt.pct(100 * c.cf) : 'not held', '', 'Not a capacity factor: clouds and losses cut real output well below this')}
      ${kpi(`Solar-window ratio${rtLast ? ` (${rtLast.year} RT)` : ''}`, rtLast ? r3(rtLast.windowRatio) : 'not held', '', `Mean of ${SW} ÷ all hours (the mart window)`)}
      ${kpi(`Fleet median window ratio${flY ? ` (${flY.y})` : ''}`, fleetE.status === 'loading' ? 'loading…' : flY ? r3(flY.p50) : 'not held', '', flY ? `P10 ${r3(flY.p10)} · P90 ${r3(flY.p90)} across ${fmt.int(flY.buses)} buses` : '')}
      ${kpi(`Peak − off-peak${rtFull ? ` (${rtFull} RT)` : ''}`, sumE.status === 'loading' ? 'loading…' : pk ? sgn(pk.peak_lmp - pk.offpeak_lmp) : 'not held', '/MWh', pk ? `Peak ${fmt.price(pk.peak_lmp)} · off-peak ${fmt.price(pk.offpeak_lmp)}` : '')}
    </div>`;
  // Capture-ratio trend: per year clear-sky and window ratios; fleet spread; runs; Studio sheet 2030.
  const set = k => cs.filter(r => (k === 'solved' ? r.kind === 'solved' : r.kind === 'settled' && r.market === k));
  const trend = [
    { name: 'Clear-sky solar · RT', points: set('RT').map(r => ({ x: r.year, y: r.ratio })) },
    { name: 'Solar window · RT', points: set('RT').map(r => ({ x: r.year, y: r.windowRatio })) },
    { name: 'Fleet median (window)', dashed: true, points: (fl?.capture || []).map(r => ({ x: r.y, y: r.p50 })).concat((fl?.fcstCapture || []).map(r => ({ x: runRow(sum, r.scenario)?.target_year, y: r.p50 })).filter(p => finite(p.x))).sort((a, b) => a.x - b.x) },
    { name: 'Fleet P10 (window)', dashed: true, points: (fl?.capture || []).map(r => ({ x: r.y, y: r.p10 })) },
    { name: 'Fleet P90 (window)', dashed: true, points: (fl?.capture || []).map(r => ({ x: r.y, y: r.p90 })) },
    { name: 'Clear-sky solar · solved', dashed: true, points: set('solved').map(r => ({ x: r.year, y: r.ratio })) },
  ]; // six series at most (dataviz rule): the Studio sheet's 2030 ratio is in the Capture by year footer
  const aTrend = rtLast ? `In ${rtLast.year} a clear-sky solar profile here captured ${B(r3(rtLast.ratio))} of the mean price; the solar-window ratio was ${B(r3(rtLast.windowRatio))}${flY ? ` against a fleet median of ${B(r3(flY.p50))}` : ''}.` : cs.length ? 'No full settled real-time year is held; solved runs are drawn.' : 'No settled year or solved run is held at this bus.';
  const crH = cs.filter(r => finite(r.ratio)), crHi = crH.reduce((a, r) => (!a || r.ratio > a.ratio ? r : a), null), crLo = crH.reduce((a, r) => (!a || r.ratio < a.ratio ? r : a), null);
  const aCapY = crHi ? `Clear-sky capture ratios run from ${B(r3(crLo.ratio))} (${esc(crLo.kind === 'solved' ? RUN[crLo.run] || crLo.run : `${crLo.year} ${crLo.market}`)}) to ${B(r3(crHi.ratio))} (${esc(crHi.kind === 'solved' ? RUN[crHi.run] || crHi.run : `${crHi.year} ${crHi.market}`)}).` : 'No capture ratio is held.';
  const cmH = monthlyRows.filter(r => finite(r.ratio)), cmLo = cmH.reduce((a, r) => (!a || r.ratio < a.ratio ? r : a), null), cmHi = cmH.reduce((a, r) => (!a || r.ratio > a.ratio ? r : a), null);
  const aCapM = cmLo ? `On the applied basis capture is weakest in ${B(cmLo.m)} (ratio ${B(cmLo.ratio.toFixed(3))}) and strongest in ${B(cmHi.m)} (${B(cmHi.ratio.toFixed(3))}).` : 'No capture on the applied basis.';
  const trendChart = cs.length ? lineChart(trend, { fmt: v => v.toFixed(3), xfmt: v => String(Math.round(v)), title: 'Capture ratio trend by year', height: 240 }) : '<div class="empty"><strong>No hourly prices held</strong>No settled year or solved run at this bus.</div>';
  const capTable = tbl(['Year', 'Series', ['Mean'], ['Clear-sky capture'], ['Ratio'], ['Window ratio'], ['Fleet p50']],
    cs.map(r => tr([td(r.year), td(r.kind === 'solved' ? esc(RUN[r.run] || r.run) : `Settled ${r.market}`), tn(n2(r.avg)), tn(n2(r.capture)), tn(r3(r.ratio)), tn(r3(r.windowRatio)), tn(r3(r.kind === 'solved' ? fl?.fcstCapture?.find(x => x.scenario === r.run)?.p50 : r.market === 'RT' ? fl?.capture?.find(x => x.y === r.year)?.p50 : null))])), { max: 260 });
  return `${capeNotice(data, S.basis)}${kp}
    <div class="cards">
      ${card(S.depth === 'screen' ? 'c-12' : 'c-8', 'Capture ratio trend', 'Is cannibalisation getting worse here? Clear-sky solar and the solar-window ratio by year, against the fleet', `${capeAllYears(data, id)}${trendChart}`, { answer: aTrend, depth: 'screen', trace: 'p-capyears', chips: ch(['modelled', 'assumption']), tools: profSeg, foot: `Clear-sky = sun-elevation shape at ${finite(lat) ? lat.toFixed(3) : '?'}, ${finite(lon) ? lon.toFixed(3) : '?'} (assumption); window = ${SW}, the unified mart's solar window · fleet = ${esc(fl?.note || 'all buses')} · profile toggle applies to the applied-basis figures` })}
      ${card('c-4', 'Capture by year', 'Every settled year and solved run at this bus', capTable, { answer: aCapY, depth: 'review', trace: 'p-capyears', chips: ch(['modelled', 'assumption']), foot: `${histSrc(node, sum?.link)} · hourly payload · Studio sheet 2030 solar ${finite(st?.bus?.sheet?.solar_cap_2030) ? st.bus.sheet.solar_cap_2030 : 'not held'} / wind ${finite(st?.bus?.sheet?.wind_cap_2030) ? st.bus.sheet.wind_cap_2030 : 'not held'} (vendor copy, older database)` })}
      ${card('c-6', 'Capture by month on the applied basis', profile === 'solar' ? 'Clear-sky solar shape (assumption, not measured output)' : 'Every hour weighted equally: a proxy, not a capture price', res.summary ? tbl(['Month', ['Average $/MWh'], ['Capture $/MWh'], ['Ratio']], monthlyRows.map(r => tr([td(r.m), tn(fmt.price(r.avg)), tn(fmt.price(r.capture)), tn(finite(r.ratio) ? r.ratio.toFixed(3) : 'not held')]))) : noBasis(res, 'capture'), { answer: aCapM, depth: 'review', trace: 'p-capture', chips: ch(['modelled', 'assumption']), foot: 'Capture = Σ g × price × h ÷ Σ g × h · Economics applies losses and curtailment' })}
      ${hyb.cards.join('')}
      ${commonCards}
      <section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculations</h3><span class="card-sub">Formula, inputs, steps, a check and the working as CSV</span></header><div class="card-b">
        ${res.summary ? traceShape(data, S, node, res, profile, c.capture) : ''}
        ${cs.length ? traceCapYears(node, cs, sum, lat, lon, H) : ''}
        ${sum ? tracePeak(node, sum, H) : ''}
        ${hyb.traces.join('')}
        ${details(evidenceBlock(data, res))}
      </div></section>
    </div>
    ${nextStep(`check the extremes in Prices › ${priceTabLabel('tails', S.tech) || 'Tails & spreads'}`, 'prices', 'tails')}`;
}

/** Per settled year / solved run: clear-sky capture ratio and the mart solar-window ratio, from the hourly payload. */
const cmemo = new Map();
export function capYears(H, lat, lon) {
  const key = `${H.map(h => h.key + h.rows.length).join(',')}|${lat}|${lon}`;
  if (cmemo.has(key)) return cmemo.get(key);
  const out = H.filter(h => h.rows.length).map(h => {
    const c = captureOf(h.rows, r => clearSky(r.timestamp, lat, lon));
    return { key: h.key, kind: h.kind, market: h.market, run: h.run, year: h.year, n: h.rows.length, avg: h.stats.mean, capture: c.capture, ratio: c.ratio, windowRatio: h.stats.windowRatio, window: h.stats.window, weight: c.weight };
  });
  if (cmemo.size > 6) cmemo.clear();
  cmemo.set(key, out);
  return out;
}

// ---------- Tab 4: Tails & spreads ----------
function tabTails(ctx) {
  const { data, S, node } = ctx, id = String(S.nodeId), res = analysis(data, S.basis), s = res.summary;
  const sumE = px('summary', id), sum = sumE.data, stE = px('studio', id), st = stE.data;
  const ch = chipsOf(node, sum?.link);
  const H = hourlySets(data, id).filter(h => h.rows.length);
  const dur = Number(S.ui.duration || 4), thrV = Number.isFinite(Number(S.ui.thr)) ? Number(S.ui.thr) : 100;
  const rows = res.rows || [], hours = s?.hours;
  const le0 = s ? 100 * rows.filter(r => r.price <= 0).reduce((t, r) => t + r.dtHours, 0) / hours : null;
  const spreads = s ? dailySpreads(rows, dur) : [];
  const meanSpread = spreads.length ? spreads.reduce((t, d) => t + d.spread, 0) / spreads.length : null;
  const rtFull = fullYear(sum?.year, 'RT'), yr = (sum?.year || []).find(r => r.market === 'RT' && r.y === rtFull), tb = (sum?.tb || []).find(r => r.market === 'RT' && r.y === rtFull);
  const kp = `<div class="kpis">
      ${kpi('High-price hours (p95)', s ? fmt.price(s.p95) : 'not held', '/MWh', s ? `Applied basis · top 5% of hours · std ${fmt.price(s.std)}` : 'No result on the applied basis')}
      ${kpi('Hours at or below $0', s ? fmt.pct(le0) : 'not held', 'of hours', s ? `Applied basis · below $0 only: ${fmt.pct(s.negativePct)}` : '')}
      ${kpi(`Daily ${dur}-hour spread`, s ? fmt.price(meanSpread) : 'not held', '/MWh', s ? `Applied basis · ${fmt.int(spreads.length)} full days · not battery revenue` : '')}
      ${kpi(`TB4${rtFull ? ` (${rtFull} RT)` : ''}`, sumE.status === 'loading' ? 'loading…' : tb ? fmt.price(tb.tb4) : 'not held', '/MWh', tb ? `P10 ${fmt.price(tb.tb4_p10)} · P90 ${fmt.price(tb.tb4_p90)} · ${fmt.int(tb.n_days)} days` : 'No settled RT year held')}
      ${kpi(`Hours above $200${rtFull ? ` (${rtFull} RT)` : ''}`, sumE.status === 'loading' ? 'loading…' : yr ? fmt.int(yr.hours_gt_200) : 'not held', 'h', yr ? `Max ${fmt.price(yr.max_lmp)}/MWh · scarcity` : '')}
      ${kpi(`Hours below $0${rtFull ? ` (${rtFull} RT)` : ''}`, sumE.status === 'loading' ? 'loading…' : yr ? fmt.int(yr.neg_hours) : 'not held', 'h', yr ? `Min ${fmt.price(yr.min_lmp)}/MWh · curtailment signal` : '')}
    </div>`;
  // Multi-year duration curves (percentile grid).
  const durSet = S.ui.pDurSet === 'runs' ? 'runs' : 'hist';
  const dAll = H.filter(h => (durSet === 'runs' ? h.kind === 'solved' : h.kind === 'settled' && h.market === 'RT'));
  const dsets = dAll.slice(-6); // six series at most (dataviz rule): the latest six; earlier years are in the scarcity table
  const allP = dsets.flatMap(h => h.rows.map(r => r.price));
  const cap99 = allP.length ? quantile(allP, 0.99) : null;
  const durChart = dsets.length ? lineChart(dsets.map(h => ({ name: h.kind === 'solved' ? RUN[h.run] || h.run : String(h.year), dashed: h.kind === 'solved' || h.rows.length < 0.95 * calHours(h.year), points: durationGrid(h.rows.map(r => r.price), 0.5) })), { fmt: usd0, xfmt: v => `${Math.round(v)}%`, xTicks: [0, 10, 25, 50, 75, 90, 100], title: 'Price duration curve by year', height: 250, yMax: cap99 })
    : `<div class="empty"><strong>No ${durSet === 'runs' ? 'solved run' : 'settled RT year'} held</strong>Switch series above.</div>`;
  // Histogram (applied basis), clipped to p1–p99 with the outside counts stated.
  const bp = rows.map(r => r.price), q1 = bp.length ? quantile(bp, 0.01) : null, q99 = bp.length ? quantile(bp, 0.99) : null;
  const inside = bp.filter(v => v >= q1 && v <= q99);
  const histo = s ? (typeof C.histogram === 'function' ? C.histogram(inside, { bins: 30, fmt: v => fmt.int(v), xfmt: usd0, title: 'Price histogram', height: 200 }) : barChart([], { emptyText: 'Histogram chart not available.' })) : noBasis(res, 'histogram');
  // Basis duration curve + threshold slider (kept from the reviewed tab).
  const sorted = rows.map(r => r.price).sort((a, b) => b - a), step = Math.max(1, Math.floor(sorted.length / 240));
  const curve = sorted.filter((_, i) => i % step === 0).map((p, i) => ({ x: (100 * i * step) / sorted.length, y: p }));
  const q = [0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99].map(p => [p, weightedQuantile(rows, p)]);
  const segDur = `<div class="segmented seg-sm" role="group" aria-label="Storage duration">${[2, 4, 8].map(d => `<button data-act="ui" data-k="duration" data-v="${d}" class="${dur === d ? 'active' : ''}">${d}-hour</button>`).join('')}</div>`;
  const basisDur = s ? (() => { const capB = quantile(sorted, 0.99), aboveN = sorted.filter(v => v > capB).length; const hrs = rows.filter(r => r.price > thrV).reduce((t, r) => t + r.dtHours, 0);
    return `${lineChart([{ name: 'Price', points: curve }], { fmt: usd0, xfmt: v => `${v.toFixed(0)}%`, xTicks: [0, 25, 50, 75, 100], title: 'Price duration curve', yMax: capB, height: 180 })}
      <p class="audit-note" style="margin:0">Axis capped at the 99th percentile (${fmt.price(capB)}/MWh). ${fmt.int(aboveN)} hour${aboveN === 1 ? '' : 's'} above it, up to ${fmt.price(sorted[0])}/MWh, are drawn at the cap.</p>
      <div class="range-field"><span>Hours above a price threshold</span><div class="row"><input type="range" min="0" max="500" step="5" value="${thrV}" data-act="ui" data-k="thr" data-live aria-label="Price threshold"><output>${thrV}</output><span class="audit-note">$/MWh</span></div><b>${fmt.int(hrs)} hours</b> above $${thrV}/MWh (${fmt.pct((100 * hrs) / hours)} of observed hours)</div>
      ${tbl(q.map(([p]) => [`p${Math.round(p * 100)}`]), [tr(q.map(([, v]) => tn(fmt.price(v))))])}`; })() : noBasis(res, 'duration curve');
  // Negative hours by month (heatmap years × months).
  const negRows = sum ? [
    ...[...new Set((sum.month || []).filter(r => r.market === 'RT').map(r => r.y))].sort().map(y => ({ label: String(y), cells: MONTHS.map((m, i) => ({ label: m, value: (sum.month.find(r => r.market === 'RT' && r.y === y && r.m === i + 1) || {}).neg_hours ?? null })) })),
    ...RUN_ORDER.filter(run => (sum.fcstMonth || []).some(r => r.scenario === run)).map(run => ({ label: RUNS[run], cells: MONTHS.map((m, i) => ({ label: m, value: (sum.fcstMonth.find(r => r.scenario === run && r.m === i + 1) || {}).neg_hours ?? null })) })),
  ] : [];
  const negChart = sum ? heatmap(negRows, { fmt: v => fmt.int(v), title: 'Negative-price hours by month', emptyText: 'No monthly marts are held for this bus.' }) : pending(sumE, 'the monthly marts');
  // Storage spreads by year: settled from the mart, solved recomputed with the mart's method.
  const tbRows = sum ? [
    ...(sum.tb || []).filter(r => r.market === 'RT').map(r => ({ label: String(r.y), src: 'Settled RT · mart_bus_tb', days: r.n_days, tb2: r.tb2, tb4: r.tb4, tb8: r.tb8, p10: r.tb4_p10, p90: r.tb4_p90 })),
    ...H.filter(h => h.kind === 'solved').map(h => { const t = [2, 4, 8].map(N => tbMart(h.rows, N)); const d4 = t[1].daily.map(d => d.spread); return { label: `${h.year} ${h.run}`, src: `${RUN[h.run]} · computed from hourly (mart method)`, days: t[1].days, tb2: t[0].mean, tb4: t[1].mean, tb8: t[2].mean, p10: d4.length ? quantile(d4, 0.1) : null, p90: d4.length ? quantile(d4, 0.9) : null }; }),
  ] : [];
  const sh = st?.bus?.sheet;
  const tbBody = sum ? `${groupedBar(tbRows.map(r => ({ label: r.label, values: [r.tb2, r.tb4, r.tb8] })), { series: ['TB2', 'TB4', 'TB8'], fmt: usd0, title: 'Storage spreads by year', height: 190, emptyText: 'No daily spreads held.' })}
    ${tbl(['Year', 'Source', ['Days'], ['TB2'], ['TB4'], ['TB8'], ['TB4 P10'], ['TB4 P90']], tbRows.map(r => tr([td(r.label), td(r.src), tn(fmt.int(r.days)), tn(n2(r.tb2)), tn(n2(r.tb4)), tn(n2(r.tb8)), tn(n2(r.p10)), tn(n2(r.p90))]))
      .concat(sh ? [tr([td('2030 sheet'), td('Studio copy (vendor, older database)'), tn('—'), tn(n2(sh.tb2_2030)), tn(n2(sh.tb4_2030)), tn(n2(sh.tb8_2030)), tn('—'), tn('—')]), tr([td('2035 / 2050 sheet'), td('Studio copy · TB4 only · 2050 is a flat escalation'), tn('—'), tn('—'), tn(`${n2(sh.tb4_2035)} / ${n2(sh.tb4_2050)}`), tn('—'), tn('—'), tn('—')])] : []), { max: 240 })}` : pending(sumE, 'the spread marts');
  // Scarcity / negative table per series.
  const TH = [100, 200, 500, 1000];
  const scar = H.map(h => ({ h, c: thresholdCounts(h.rows.map(r => r.price), TH) }));
  const scarTable = scar.length ? tbl(['Year', 'Series', ['Hours'], ['< $0'], ['≤ $0'], ['> $100'], ['> $200'], ['> $500'], ['> $1,000'], ['Max']],
    scar.map(({ h, c }) => tr([td(h.year), td(h.kind === 'solved' ? esc(RUN[h.run]) : `Settled ${h.market}${h.rows.length < 0.95 * calHours(h.year) ? ' <span class="pill warn">part</span>' : ''}`), tn(fmt.int(c.n)), tn(fmt.int(c.lt0)), tn(fmt.int(c.le0)), tn(fmt.int(c.gt100)), tn(fmt.int(c.gt200)), tn(fmt.int(c.gt500)), tn(fmt.int(c.gt1000)), tn(n2(h.stats.max))])), { max: 300 }) : '<div class="empty"><strong>No hourly prices held</strong>No settled year or solved run at this bus.</div>';
  // Dearest settled hours.
  const hist = H.filter(h => h.kind === 'settled' && h.market === 'RT');
  const top = topHours(hist.flatMap(h => h.rows), 12);
  const season = m => (m <= 2 || m === 12 ? 'Winter' : m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Autumn');
  const fuel = fuelOf(S.tech), gen = ['solar', 'hybrid'].includes(fuel);
  // The window the dearest hours are counted in follows the fuel: the mart solar window for PV, the evening block (HE17–21) otherwise.
  const inWin = top.filter(r => { const h = clockHour(r.timestamp); return gen ? inSolarWindow(h) : h >= 16 && h <= 20; }).length;
  const dearTable = top.length ? tbl(['Date', ['HE'], 'Season', ['Price'], ['Energy'], ['Congestion'], ['Loss']], top.map(r => tr([td(clockDate(r.timestamp)), tn(clockHour(r.timestamp) + 1), td(season(clockMonth(r.timestamp))), tn(n2(r.price)), tn(n2(r.energy)), tn(sgn(r.congestion)), tn(n2(r.loss))])), { max: 300 }) : '<div class="empty"><strong>No settled real-time history</strong>This bus has no settled series.</div>';
  // Curtailment evidence (Studio copy).
  const sd = st?.bus?.study, un = st?.bus?.units;
  const curtBody = st ? `${tbl(['Size', ['Curtailed %'], ['MWh'], ['Hours'], ['Max MW']], [100, 250, 500].map(mw => tr([td(`${mw} MW`), tn(sd && finite(sd[`pct_${mw}`]) ? fmt.pct(sd[`pct_${mw}`]) : 'not tested'), tn(sd && finite(sd[`mwh_${mw}`]) ? fmt.int(sd[`mwh_${mw}`]) : '—'), tn(sd && finite(sd[`hours_${mw}`]) ? fmt.int(sd[`hours_${mw}`]) : '—'), tn(sd && finite(sd[`max_mw_${mw}`]) ? n2(sd[`max_mw_${mw}`]) : '—')])))}
      ${un ? tbl(['PCR run', ['Available MWh'], ['Dispatched'], ['Curtailed'], ['Hours'], ['%'], ['Uncommitted MWh']], un.runs.map(r => tr([td(esc(RUN[r.run] || r.run)), tn(fmt.int(r.avail_mwh)), tn(fmt.int(r.dispatch_mwh)), tn(fmt.int(r.curt_mwh)), tn(fmt.int(r.curt_hours)), tn(finite(r.pct) ? fmt.pct(r.pct) : 'not held'), tn(fmt.int(r.uncommitted_mwh))]))) + `<p class="audit-note" style="margin:0">Units in the run at this node: ${un.units.map(u => `${esc(u.name)} (${esc(u.fuel)}, ${fmt.int(u.econ_max_mw)} MW)`).join(', ')}.</p>` : '<p class="audit-note" style="margin:0">No solar or wind unit sits at this bus\'s PCR price node, so no run curtailment is held.</p>'}
      <p class="audit-note" style="margin:0">Vendor sweep (sheet): solar ${['100', '250', '500', '1000'].map(m => `${m} MW ${n2(sh?.[`solar_${m}MW_2030`])}`).join(' · ')}; wind ${['100', '250', '500', '1000'].map(m => `${m} MW ${n2(sh?.[`wind_${m}MW_2030`])}`).join(' · ')} — excluded by the unified database (2,676 of 2,678 flagged validated=false; a vendor ramp with a constant multiplier). Shown for comparison only.</p>`
    : stE.status === 'loading' ? pending(stE, 'the Studio copy') : '<div class="empty"><strong>No Studio figures for this bus</strong>The live Studio holds no curtailment record for this bus.</div>';
  // Within the hour (V6): five-minute zone prices, review depth and above.
  const intra = S.depth === 'screen' ? { cards: [], trace: '' } : intraCards(ctx, { dur });
  // Answer sentences (V6).
  const dMax = allP.length ? Math.max(...allP) : null;
  const aDur = dsets.length ? `Across the ${B(fmt.int(dsets.length))} ${durSet === 'runs' ? 'solved runs' : 'settled real-time years'} drawn, 1% of hours price above ${B(`$${cap99.toFixed(2)}`)} and the dearest reached ${B(`$${dMax.toFixed(2)}`)}${dAll.length > dsets.length ? ` (${dAll.length - dsets.length} earlier years not drawn)` : ''}.` : `No ${durSet === 'runs' ? 'solved run' : 'settled real-time year'} is held.`;
  const aHist = s ? `On the applied basis half the hours price below ${B(fmt.price(s.p50))} and nine in ten fall between ${B(fmt.price(s.p05))} and ${B(fmt.price(s.p95))}.` : '';
  const thrHrs = s ? rows.filter(r => r.price > thrV).reduce((t, r) => t + r.dtHours, 0) : null;
  const aBasisDur = s ? `${B(`${fmt.int(thrHrs)} hours`)} on the applied basis price above $${thrV}/MWh (${B(fmt.pct((100 * thrHrs) / hours))} of hours).` : '';
  // Answers quote the latest FULL settled year (a part year is never compared by count).
  const negY = negRows.find(r => r.label === String(rtFull)) || negRows.filter(r => !RUN_ORDER.some(k => RUNS[k] === r.label)).at(-1), negTot = negY ? negY.cells.reduce((t, c) => t + (finite(c.value) ? c.value : 0), 0) : null, negTop = negY ? negY.cells.filter(c => finite(c.value)).reduce((a, c) => (!a || c.value > a.value ? c : a), null) : null;
  const aNeg = negY ? `In ${negY.label} settled real time ${B(`${fmt.int(negTot)} hours`)} priced below $0${negTot && negTop ? `, most in ${B(negTop.label)} (${fmt.int(negTop.value)} h)` : ''}.` : sum ? 'No settled monthly mart is held; solved runs are shown.' : '';
  const tbLast = tbRows.find(r => r.label === String(rtFull)) || tbRows.filter(r => !/ /.test(r.label)).at(-1);
  const aTb = tbLast ? `In ${tbLast.label} settled real time the daily TB4 averaged ${B(`$${n2(tbLast.tb4)}`)} (P10 ${B(`$${n2(tbLast.p10)}`)}, P90 ${B(`$${n2(tbLast.p90)}`)}).` : tbRows.length ? `The latest solved run's TB4 is ${B(`$${n2(tbRows.at(-1).tb4)}`)}.` : sum ? 'No daily spread is held.' : '';
  const scLast = scar.find(x => x.h.kind === 'settled' && x.h.market === 'RT' && x.h.year === rtFull) || [...scar].reverse().find(x => x.h.kind === 'settled' && x.h.market === 'RT');
  const aScar = scLast ? `In ${scLast.h.year} settled real time ${B(fmt.int(scLast.c.gt200))} hours exceeded $200 and ${B(fmt.int(scLast.c.lt0))} were below $0.` : scar.length ? 'No settled real-time year is held; solved runs are listed.' : '';
  const aDear = top.length ? `The dearest settled hour was ${B(`${clockDate(top[0].timestamp)} HE${clockHour(top[0].timestamp) + 1}`)} at ${B(`$${top[0].price.toFixed(2)}`)}; ${B(`${inWin} of 12`)} of the dearest fall ${gen ? 'in the solar window' : 'in the evening block'}.` : '';
  const aCurt = st ? (sd && finite(sd.pct_100) ? `A fixed 100 MW injection here is curtailed ${B(fmt.pct(sd.pct_100))} of its energy in the headroom study.` : `The headroom study ${sd ? 'did not curtail the sizes it tested' : 'holds no test'} at this bus.`) : '';
  const aStore = s ? `The gross daily ${dur}-hour spread on the applied basis is ${B(fmt.price(meanSpread))}/MWh; Economics dispatches a battery against it within the Grid limits.` : '';

  return `${capeNotice(data, S.basis)}${kp}
    <div class="cards">
      ${card(S.depth === 'screen' ? 'c-12' : 'c-8', 'Price duration curve by year', durSet === 'runs' ? 'Every solved run at this bus, dearest hour first' : 'Every settled RT year at this bus, dearest hour first (part years dashed)', `${capeAllYears(data, id)}${durChart}`, { answer: aDur, depth: 'screen', chips: ch([]), tools: seg('pDurSet', durSet, [['hist', 'Settled RT'], ['runs', 'Solved runs']]), foot: `Axis capped at the p99 of the drawn hours (${fmt.price(cap99)}/MWh); dearer hours are drawn at the cap · 0.5% grid from the hourly payload · ${histSrc(node, sum?.link)}` })}
      ${card('c-4', 'Price histogram', `Applied basis · p1 to p99 (${fmt.price(q1)} to ${fmt.price(q99)})`, histo, { answer: aHist, depth: 'review', trace: 'p-tails', chips: ch([]), foot: s ? `${fmt.int(bp.length - inside.length)} hours outside p1–p99 are left out of the bins, not dropped from any figure` : '' })}
      ${card('c-6', 'Price duration curve', `Applied basis · ${describe(S.basis)}`, basisDur, { answer: aBasisDur, depth: 'review', trace: 'p-tails', chips: ch([]), tools: segDur, foot: 'Quantiles over observed hours, not averaged annual quantiles' })}
      ${card('c-6', 'Negative-price hours by month', 'Hours below $0 · settled RT by year, then each solved run', negChart, { answer: aNeg, depth: 'review', chips: ch([]), foot: 'unified mart_bus_month / mart_bus_fcst_month · a price below $0 is when a price-taking plant would curtail economically' })}
      ${card('c-6', 'Storage spreads by year (TB2 / TB4 / TB8)', 'Mean of the N dearest − the N cheapest hours of each day', tbBody, { answer: aTb, depth: 'review', trace: 'p-tb', chips: ch([]), foot: 'Settled: unified mart_bus_tb; solved: the same per-date method computed from the hourly payload · gross spreads, not battery revenue' })}
      ${intra.cards.join('')}
      ${card('c-6', 'Scarcity and negative hours', 'Hours beyond each threshold, every year and run', scarTable, { answer: aScar, depth: 'review', trace: 'p-scar', chips: ch([]), foot: 'Counted from the hourly payload; < $0 and > $200 are re-checked against the marts in the trace' })}
      ${card('c-6', 'Dearest hours', top.length ? `Twelve dearest settled RT hours: ${inWin} of 12 ${gen ? `inside the solar window (${SW})` : 'in the evening block (HE17–21)'}` : 'Settled RT', dearTable, { answer: aDear, depth: 'review', chips: ch([]), foot: `${histSrc(node, sum?.link)} · HE = hour ending, settled clock` })}
      ${['datacenter', 'storage'].includes(fuel) ? notApplicable('c-6', 'Curtailment evidence', FUEL_LABEL[fuel], fuel === 'datacenter' ? 'A load is not curtailed by the network the way a generator is; its connection risk is the import limit in Grid, and its price exposure is the scarcity table and Load cost & bill shape.' : 'The headroom study curtails a fixed generator injection; a battery is dispatched instead, and its charge limit (shoulder case) is applied in Grid and Economics.', 'study') : card('c-6', 'Curtailment evidence', 'Physical tests from the Studio copy; the price proxy is in the scarcity table', curtBody, { answer: aCurt, depth: 'study', chips: ch(['studio-copy']), foot: `${esc(st?.meta?.ext?.label || 'Studio extension copy')} · headroom study (May 2026): a fixed injection at this bus on the 5-yr run; a smaller size is tested only where the larger one curtails` })}
      ${fuel === 'datacenter' ? '' : card('c-12', 'Value storage on these prices', 'A gross spread is not achievable revenue', `<div class="handoff" style="margin:0"><div><strong>Chronological battery dispatch in Economics</strong><p>Economics runs a dispatch on the applied basis (${esc(describe(S.basis))}).</p></div><button class="primary" data-act="handoff-prices">Use these prices in Economics</button></div>`, { answer: aStore, depth: 'review' })}
      <section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculations</h3><span class="card-sub">Formula, inputs, steps, a check and the working as CSV</span></header><div class="card-b">
        ${s ? traceTails(data, S, node, res, dur, spreads, thrV) : ''}
        ${sum ? traceTb(node, sum, H) : ''}
        ${sum && H.length ? traceScarcity(node, sum, H) : ''}
        ${intra.trace}
        ${details(evidenceBlock(data, res))}
      </div></section>
    </div>
    ${(() => { const tab = fuel === 'hybrid' ? 'hybrid' : 'revenue'; return nextStep(`value these prices in Economics › ${econTabLabel(tab, S.tech) || (tab === 'hybrid' ? 'Hybrid sizing' : 'Solar & wind revenue')}`, 'economics', tab); })()}`;
}

export function renderPrices(tab, ctx) {
  return ({ lmp: tabLmp, basis: tabBasis, shape: tabShape, tails: tabTails }[tab] || tabLmp)(ctx);
}
