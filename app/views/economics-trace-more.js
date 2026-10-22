// Calculation traces for the Economics cards added 2026-09-29 (year-by-year revenue, negative prices, tornado,
// spill by size, monthly battery value, spread benchmarks, reserves, hybrid curve, finance grid, payback, revenue path).
// Each check is independent of the arithmetic it audits, or labelled "arithmetic re-check" / "consistency check";
// where nothing can be checked the trace says "No check possible: <reason>".
import { trace } from '../trace.js';
import { describe, fmt } from '../basis.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const n0 = v => (ok(v) ? Math.round(v).toLocaleString('en-US') : 'not held');
const n2 = v => (ok(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'not held');
const usd = v => (ok(v) ? `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}` : 'not held');
const meta = (S, node) => [['bus', `${node?.name ?? ''} (${S.nodeId})`], ['basis', describe(S.basis)], ['units', 'MW, MWh, $ ; price $/MWh'], ['missing', 'empty cell = not held, never zero']];
const busIn = (S, node) => ({ name: 'Bus', value: `${node?.name ?? '?'} (${S.nodeId})`, source: 'measured' });
const noCheck = why => ({ label: `No check possible: ${why}`, a: null, b: null, fmt: () => '—' });

/** Revenue on every held year and run. v: {years, tech, mw, cf, loss, cap, recPrice, basisEnergy} */
export function traceRevYears(S, node, v) {
  const inc = v.years.filter(r => r.status === 'included');
  const b = S.basis, inBasis = r => (b.mode === 'forecast' ? r.run === b.run : r.kind === 'settled' && b.years.map(Number).includes(r.year));
  const basisRows = inc.filter(inBasis), expected = b.mode === 'forecast' ? 1 : b.years.length;
  const combined = basisRows.length === expected && basisRows.length ? basisRows.reduce((t, r) => t + r.totalRaw, 0) / (basisRows.reduce((t, r) => t + r.hours, 0) / 8760) : null;
  return trace({
    id: 'e-rev-years', title: 'Revenue by year and forecast run',
    formula: 'For each held series s: energy_s = Σ_h delivered_h × price_h × Δt ÷ (H_s ÷ 8,760);  RECs_s = MWh_s × REC price;  capture_s = Σ delivered × price ÷ Σ delivered',
    inputs: [busIn(S, node),
      { name: 'Series', value: `${inc.length} included of ${v.years.length} held`, source: 'measured', note: 'unified fact_lmp_hourly (settled) and fact_fcst_lmp_hourly (runs), via the bus payload' },
      { name: 'Technology, size, CF, losses', value: `${v.tech}, ${fmt.mw(v.mw)}, ${n2(v.cf * 100)}%, ${v.loss}%`, source: 'user' },
      { name: 'Connection cap', value: fmt.mw(v.cap), source: 'derived', note: 'the same limit on every series' },
      { name: 'REC price', value: ok(v.recPrice) ? `$${v.recPrice}/MWh` : 'not held', source: 'assumption' }],
    steps: inc.map(r => ({ label: r.label, work: `${n0(r.mwhRaw)} MWh × capture ${fmt.price(r.capture)} = ${usd(r.totalRaw)} over ${n0(r.hours)} h; ÷ ${r.n.toFixed(4)}`, value: `${usd(r.energy)}/yr` })),
    result: { label: 'Series included', value: String(inc.length) },
    checks: [
      combined != null ? { label: `Consistency check: the basis years re-derived from their own series (${basisRows.map(r => r.label).join(', ')}) = the headline energy revenue`, a: combined, b: v.basisEnergy, tol: 1e-6, fmt: usd }
        : noCheck('the basis includes a year or run that is not in the held list (partial or excluded), so it cannot be re-derived here'),
      ...inc.slice(0, 1).map(r => ({ label: `Arithmetic re-check (${r.label}): capture × MWh = energy revenue`, a: r.capture * r.mwhRaw, b: r.totalRaw, fmt: usd })),
    ],
    notes: ['Partial settled years (< 99% of hours) and runs below 95% coverage are listed but excluded: a partial year is seasonally biased.'],
    csv: { name: `econ-revenue-years-${S.nodeId}.csv`, meta: meta(S, node), columns: ['series', 'status', 'hours', 'mean_price', 'capture_price', 'capture_ratio', 'mwh_per_yr', 'energy_usd_per_yr', 'rec_usd_per_yr', 'neg_price_mwh', 'neg_price_usd', 'spill_mwh', 'shape'], rows: v.years.map(r => [r.label, r.status, r.hours, r.meanPrice, r.capture, r.ratio, r.mwh, r.energy, r.rec, r.negMWh, r.negRev, r.spill, r.profile]) },
  });
}

/** Negative-price exposure on the basis. v: {rows (delivered), neg, n, total} */
export function traceNegPrice(S, node, x, v) {
  const rest = v.rows.reduce((t, r) => t + (r.price < 0 && r.generationMW > 0 ? 0 : r.generationMW * r.dtHours * r.price), 0);
  const total = v.rows.reduce((t, r) => t + r.generationMW * r.dtHours * r.price, 0);
  return trace({
    id: 'e-negprice', title: 'Energy sold below $0',
    formula: 'hours = Σ Δt where price_h < 0 and delivered_h > 0;  MWh = Σ delivered_h × Δt;  cost = Σ delivered_h × price_h × Δt (< 0);  avoidable by self-curtailing = −cost',
    inputs: [busIn(S, node), { name: 'Price basis', value: describe(S.basis), source: 'user' }, { name: 'Delivered profile', value: `${v.tech}, after losses and the cap`, source: 'derived' }],
    steps: [
      { label: 'Hours below $0 with output', work: `over ${n0(x.res.summary.hours)} h`, value: `${n2(v.neg.hours)} h` },
      { label: 'Energy delivered in those hours', work: 'Σ delivered × Δt', value: `${n0(v.neg.mwh)} MWh` },
      { label: 'Revenue in those hours', work: 'Σ delivered × price × Δt', value: usd(v.neg.revenue) },
      { label: 'Per year', work: `÷ ${v.n.toFixed(4)}`, value: `${usd(v.neg.revenue / v.n)}/yr` },
    ],
    result: { label: 'Avoidable per year', value: usd(v.neg.uplift / v.n) },
    checks: [{ label: 'Consistency check: revenue below $0 + revenue in all other hours = total energy revenue', a: v.neg.revenue + rest, b: total, fmt: usd }],
    notes: ['Self-curtailing is a merchant option; a PPA, REC or tax-credit contract may pay for every MWh and change the answer.'],
    csv: { name: `econ-negprice-${S.nodeId}.csv`, meta: meta(S, node), columns: ['timestamp', 'price_usd_mwh', 'delivered_mw', 'revenue_usd'], rows: () => v.rows.filter(r => r.price < 0 && r.generationMW > 0).map(r => [r.timestamp, r.price, r.generationMW, r.generationMW * r.dtHours * r.price]) },
  });
}

/** Sensitivity tornado. v: {rows, base, baseRerun, tech} */
export function traceTornado(S, node, v) {
  return trace({
    id: 'e-tornado', title: 'Revenue sensitivity (tornado)',
    formula: 'For each assumption: re-run the revenue per year at its low and at its high case, all else at your entries;  swing = max − min',
    inputs: [busIn(S, node), ...v.rows.map(r => ({ name: r.label, value: `${r.low.label} / ${r.high.label}`, source: /Price year/.test(r.label) ? 'measured' : 'assumption', note: r.src }))],
    steps: v.rows.map(r => ({ label: r.label, work: `${usd(r.lowValue)} to ${usd(r.highValue)} around ${usd(v.base)}`, value: usd(r.swing) })),
    result: { label: 'Largest swing', value: v.rows[0] ? `${v.rows[0].label}: ${usd(v.rows[0].swing)}` : 'not held' },
    checks: [ok(v.baseRerun) ? { label: 'Consistency check: the tornado engine re-run at your entries = the headline revenue', a: v.baseRerun, b: v.base, fmt: usd } : noCheck('the base case could not be re-run')],
    notes: ['Capacity revenue is conditional (the capacity case is not studied); its bar shows what it would add, not a settled value.'],
    csv: { name: `econ-tornado-${S.nodeId}.csv`, meta: meta(S, node), columns: ['assumption', 'low_case', 'low_usd_per_yr', 'high_case', 'high_usd_per_yr', 'swing_usd', 'source'], rows: v.rows.map(r => [r.label, r.low.label, r.lowValue, r.high.label, r.highValue, r.swing, r.src]) },
  });
}

/** Spill against size. v: {rows:[{size, limit, cap, after, spill, pct}], mw, headSpill, vendor, studioSrc} */
export function traceSpillSize(S, node, v) {
  const at = v.rows.find(r => r.size === v.mw);
  return trace({
    id: 'e-spill-size', title: 'Spill against project size',
    formula: 'For size S: delivered_h(S) = after-loss_h × S ÷ MW;  cap(S) = min(S, export limit at S);  spill(S) = Σ max(0, delivered_h(S) − cap(S)) × Δt ÷ years',
    inputs: [busIn(S, node), { name: 'After-loss profile', value: `${v.tech} at ${fmt.mw(v.mw)}, scaled linearly to each size`, source: 'derived' },
      { name: 'Export limits', value: 'Grid element-study rules at each size', source: 'rule', note: 'unified fact_limiting_element / fact_headroom; unknown limit = not assessed' },
      ...(v.vendor.length ? [{ name: 'Vendor ramp (comparison only)', value: v.vendor.map(p => `${p.x} MW ${n2(p.y)}%`).join(' · '), source: 'assumption', note: `${v.studioSrc}; not screened, excluded from the unified DB` }] : [])],
    steps: v.rows.map(r => ({ label: `${fmt.mw(r.size)}`, work: ok(r.cap) ? `limit ${fmt.mw(r.limit)} → cap ${fmt.mw(r.cap)}; ${n0(r.after)} MWh/yr after losses` : 'limit not established: not assessed', value: ok(r.pct) ? `${n0(r.spill)} MWh/yr (${n2(r.pct)}%)` : 'not assessed' })),
    result: { label: `Spill at ${fmt.mw(v.mw)}`, value: at && ok(at.spill) ? `${n0(at.spill)} MWh/yr` : 'not assessed' },
    checks: [at && ok(at.spill) ? { label: 'Consistency check: spill at the project size = the revenue engine\'s spill', a: at.spill, b: v.headSpill, tol: 1e-6, fmt: w => `${n0(w)} MWh` } : noCheck('the export limit at the project size is not established')],
    csv: { name: `econ-spill-size-${S.nodeId}.csv`, meta: meta(S, node), columns: ['size_mw', 'export_limit_mw', 'cap_mw', 'after_loss_mwh_per_yr', 'spill_mwh_per_yr', 'spill_pct'], rows: v.rows.map(r => [r.size, r.limit, r.cap, r.after, r.spill, r.pct]) },
  });
}

/** Monthly battery value and daily cycles. v: {months, total, n, cyc, E, eta} */
export function traceBessMonths(S, node, v) {
  const sum = v.months.reduce((t, m) => t + m.value, 0), cycSum = v.cyc.reduce((t, d) => t + d.cycles, 0), disSum = v.months.reduce((t, m) => t + m.dis, 0);
  return trace({
    id: 'e-bess-months', title: 'Battery value by month and cycles by day',
    formula: 'value_m = Σ_(h in m) net value_h;  cycles_d = Σ_(h in d) discharge_h × Δt ÷ η ÷ MWh',
    inputs: [busIn(S, node), { name: 'Schedule', value: 'the optimal dispatch above', source: 'derived' }, { name: 'Energy, η', value: `${n0(v.E)} MWh, ${v.eta.toFixed(4)}`, source: 'user' }],
    steps: v.months.map(m => ({ label: m.key, work: `${n0(m.dis)} MWh out; sold ${usd(m.sell)} − bought ${usd(m.buy)}`, value: usd(m.value) })),
    result: { label: 'Total over the basis', value: usd(sum) },
    checks: [
      { label: 'Arithmetic re-check: Σ monthly value = optimiser objective', a: sum, b: v.total, fmt: usd },
      { label: 'Consistency check: Σ daily cycles = Σ monthly discharge ÷ η ÷ MWh', a: cycSum, b: disSum / v.eta / v.E, fmt: n2 },
    ],
    csv: { name: `econ-bess-days-${S.nodeId}.csv`, meta: meta(S, node), columns: ['day', 'equivalent_cycles'], rows: v.cyc.map(d => [d.day, d.cycles]) },
  });
}

/** Spread benchmarks. v: {rows, dur, mw, rte, basisTb, basisDays, basis, bench, dispatch, benchBasis} */
export function traceSpread(S, node, v) {
  const b = v.basis, db = [];
  if ([2, 4, 8].includes(v.dur)) {
    if (b.mode === 'forecast') { const r = v.bench.tbFcst.find(t => t.scenario === b.run); if (r) db.push(r); }
    else for (const y of b.years) { const r = v.bench.tbHist.find(t => t.market === b.market && t.y === Number(y)); if (r) db.push(r); }
  }
  const expected = b.mode === 'forecast' ? 1 : b.years.length;
  const dbTb = db.length === expected && db.length ? db.reduce((t, r) => t + r[`tb${v.dur}`] * r.n_days, 0) / db.reduce((t, r) => t + r.n_days, 0) : null;
  return trace({
    id: 'e-spread', title: `Spread benchmark at ${v.dur} h`,
    formula: 'TBk = mean over days of (mean of the k highest hourly prices − mean of the k lowest);  TB at d hours = linear between the 2/4/8 h anchors;  benchmark = MW × d × TB × 365 × RTE',
    inputs: [busIn(S, node), { name: 'Battery', value: `${fmt.mw(v.mw)} × ${v.dur} h, RTE ${v.rte}%`, source: 'user' }, { name: 'Cycles', value: '365 per year (one a day)', source: 'assumption', note: 'ext/75 bess_cycles base, cited' },
      { name: 'Settled TB', value: `${v.bench.tbHist.length} market-years`, source: 'measured', note: v.bench.sources.tbHist }, { name: 'Forecast TB', value: `${v.bench.tbFcst.length} runs`, source: 'measured', note: v.bench.sources.tbFcst },
      ...(v.bench.studio ? [{ name: 'Studio copy TB', value: '2030 TB2/4/8; TB4 2035, 2050', source: 'assumption', note: v.bench.sources.studio }] : [])],
    steps: [...v.rows.map(r => ({ label: `${r.src}: ${r.label}`, work: ok(r.sp) ? `${fmt.mw(v.mw)} × ${v.dur} h × ${fmt.price(r.sp)} × 365 × ${v.rte}%` : 'spread not held', value: ok(r.bench) ? `${usd(r.bench)}/yr` : 'not held' })),
      { label: 'Basis TB recomputed in the browser', work: `${v.basisDays.length} full days of the basis (Prices › daily spreads)`, value: fmt.price(v.basisTb) },
      { label: 'Dispatch value ÷ basis benchmark', work: `${usd(v.dispatch)} ÷ ${usd(v.benchBasis)}`, value: ok(v.benchBasis) && v.benchBasis > 0 ? `${n2((100 * v.dispatch) / v.benchBasis)}%` : 'not held' }],
    result: { label: `Basis TB${v.dur}`, value: fmt.price(v.basisTb) },
    checks: [dbTb != null && ok(v.basisTb) ? { label: `Independent: TB${v.dur} from the database (${b.mode === 'forecast' ? 'SQL over the run' : 'mart_bus_tb'}) vs recomputed in the browser from the hourly series (days with missing hours differ, so 2% tolerance)`, a: v.basisTb, b: dbTb, tol: 0.02, fmt: w => fmt.price(w) }
      : noCheck(![2, 4, 8].includes(v.dur) ? `the database holds TB2/4/8 only; TB at ${v.dur} h is interpolated` : 'the database holds no TB row for every basis year')],
    notes: ['A spread benchmark assumes one full cycle a day at the day\'s best hours with perfect foresight; the dispatch above respects SOC continuity, limits and the grid, so it usually earns less.'],
    csv: { name: `econ-spreads-${S.nodeId}.csv`, meta: meta(S, node), columns: ['source', 'series', 'days', 'tb2', 'tb4', 'tb8', 'tb4_p10', 'tb4_p90', `tb_at_${v.dur}h`, 'benchmark_usd_per_yr'], rows: v.rows.map(r => [r.src, r.label, r.days, r.tb2, r.tb4, r.tb8, r.p10, r.p90, r.sp, r.bench]) },
  });
}

/** Reserve opportunity. v: {reserve:[{product, matched, idleMatched, idleValue, allValue}], mw, zone, src, rows, hoursMap} */
export function traceReserves(S, node, v) {
  const busy = v.rows.reduce((t, r) => { if (!(r.chargeMW > 1e-6) && !(r.dischargeMW > 1e-6)) return t; const p = v.hoursMap[String(r.timestamp).slice(0, 13)]?.[0]; return ok(p) ? t + v.mw * p * (r.dtHours ?? 1) : t; }, 0);
  const t0 = v.reserve[0];
  return trace({
    id: 'e-reserves', title: 'Reserve opportunity in idle hours',
    formula: 'value = MW × Σ_(idle h with a price) reserve price_h × Δt;  per year = value × 8,760 ÷ priced hours;  ceiling = the same over every priced hour',
    inputs: [busIn(S, node), { name: 'Reserve zone', value: v.zone, source: 'rule', note: 'load zone CT → CT, NEMA → NEMABSTN, else rest of system (SWCT cannot be placed from the bus table)' },
      { name: 'Reserve prices', value: 'TMSR, TMNSR, TMOR hourly means', source: 'measured', note: v.src }, { name: 'MW offered', value: fmt.mw(v.mw), source: 'assumption', note: 'full power in idle hours; SOC and eligibility not checked' }],
    steps: v.reserve.map(r => ({ label: r.product, work: `${n0(r.idleMatched)} idle of ${n0(r.matched)} priced hours (${n0(r.unmatched)} basis hours have no reserve price)`, value: r.matched ? `${usd((r.idleValue * 8760) / r.matched)}/yr` : 'not held' })),
    result: { label: 'TMSR, idle hours', value: t0.matched ? `${usd((t0.idleValue * 8760) / t0.matched)}/yr` : 'not held' },
    checks: [t0.matched ? { label: 'Consistency check (TMSR): idle-hour value + value in charging/discharging hours = all-hour ceiling', a: t0.idleValue + busy, b: t0.allValue, fmt: usd } : noCheck('no basis hour has a reserve price (prices held 2023-07 to 2026-07)')],
    notes: ['Not added to the arbitrage value: the same MW cannot be both held in reserve and dispatched for energy in the same hour, and the co-optimised value is not modelled here.'],
    csv: { name: `econ-reserves-${S.nodeId}.csv`, meta: meta(S, node), columns: ['product', 'priced_hours', 'idle_priced_hours', 'unpriced_hours', 'idle_value_usd', 'all_hours_value_usd'], rows: v.reserve.map(r => [r.product, r.matched, r.idleMatched, r.unmatched, r.idleValue, r.allValue]) },
  });
}

/** Hybrid incremental curve. v: {configs, base, dur, genTotal, label} */
export function traceHybridCurve(S, node, v) {
  const held = v.configs.filter(c => ok(c.value) && ok(c.spill));
  const imbalance = Math.max(0, ...held.map(c => Math.abs(c.direct + c.toBattery + c.spill - v.genTotal)));
  return trace({
    id: 'e-hybrid-curve', title: 'Incremental value by storage size',
    formula: 'incremental(B) = value(solar + B) − value(solar only);  per kW = incremental ÷ (B × 1,000);  solar_after_loss = direct + into battery + spilled',
    inputs: [busIn(S, node), { name: 'Configurations', value: v.configs.map(v.label).join(' · '), source: 'user' }, { name: 'Duration', value: `${v.dur} h`, source: 'user' }],
    steps: v.configs.map(c => ({ label: v.label(c), work: ok(c.value) ? `${usd(c.value)} − ${usd(v.base)}; ${n0(c.direct)} direct + ${n0(c.toBattery)} stored + ${n0(c.spill)} spilled MWh` : (c.errors?.[0] || 'not assessed'), value: ok(c.value) ? usd(c.value - v.base) : 'not assessed' })),
    result: { label: 'Configurations assessed', value: `${held.length} of ${v.configs.length}` },
    checks: [
      { label: 'Energy balance (closed form): largest |direct + stored + spilled − solar after losses| over all configurations', a: imbalance, b: 0, atol: 1e-3 * Math.max(1, v.genTotal), fmt: w => `${n2(w)} MWh` },
      { label: 'Lower bound: no configuration is worth less than solar only (the battery can stay idle)', a: Math.min(0, ...held.map(c => c.value - v.base)), b: 0, tol: 1e-6, fmt: usd },
    ],
    csv: { name: `econ-hybrid-curve-${S.nodeId}.csv`, meta: meta(S, node), columns: ['storage_mw', 'storage_mwh', 'value_usd_per_yr', 'incremental_usd_per_yr', 'direct_mwh', 'into_battery_mwh', 'discharged_mwh', 'spilled_mwh', 'note'], rows: v.configs.map(c => [c.mw, c.mw * v.dur, c.value, ok(c.value) ? c.value - v.base : null, c.direct, c.toBattery, c.discharged, c.spill, c.errors?.[0] || '']) },
  });
}

/** Finance grid. v: {grid, rates, capMul, capex, npv, rate} */
export function traceFinGrid(S, v) {
  const i = v.rates.indexOf(v.rate), j = v.capMul.indexOf(1);
  return trace({
    id: 'e-fin-grid', title: 'NPV over discount rate × capital',
    formula: 'NPV(r, K) = −K + Σ_t CF_t(K) ÷ (1 + r)^t, re-run for every rate r and capital K;  IRR(K) solves NPV = 0',
    inputs: [{ name: 'Rates', value: v.rates.map(r => `${(100 * r).toFixed(1)}%`).join(', '), source: 'derived', note: 'your rate ± 1 and 2 points' },
      { name: 'Capital', value: v.capMul.map(m => usd(v.capex * m)).join(', '), source: 'derived', note: 'your capital (incl. Grid upgrades) × 80–120%' }],
    steps: v.rates.map((r, a) => ({ label: `${(100 * r).toFixed(1)}%`, work: v.capMul.map((m, b) => `${(100 * m).toFixed(0)}%: ${usd(v.grid.npv[a][b])}`).join(' · '), value: usd(v.grid.npv[a][j]) })),
    result: { label: 'NPV at your inputs', value: usd(v.npv) },
    checks: [i >= 0 ? { label: 'Consistency check: the grid cell at your rate and capital = the headline NPV', a: v.grid.npv[i][j], b: v.npv, fmt: usd } : noCheck('your rate is outside the grid')],
    csv: { name: `econ-npv-grid-${S.nodeId}.csv`, meta: [['bus', S.nodeId], ['basis', 'pre-tax, unlevered'], ['units', '$']], columns: ['discount_rate', ...v.capMul.map(m => `npv_capex_${Math.round(m * 100)}pct`), ...v.capMul.map(m => `irr_capex_${Math.round(m * 100)}pct`)], rows: v.rates.map((r, a) => [r, ...v.grid.npv[a], ...v.grid.irr[a]]) },
  });
}

/** Payback. v: {r, rate, pb} */
export function tracePayback(S, v) {
  const rows = v.r.rows;
  const cumAt = (t, disc) => { let c = 0; for (const row of rows) { const cf = disc ? row.projectCashFlow / (1 + v.rate) ** row.year : row.projectCashFlow; if (row.year <= Math.floor(t)) c += cf; else if (row.year === Math.floor(t) + 1) { c += cf * (t - Math.floor(t)); break; } } return c; };
  let c = 0, d = 0;
  return trace({
    id: 'e-payback', title: 'Payback',
    formula: 'payback = first year t where Σ_(0..t) CF ≥ 0, interpolated linearly inside that year;  discounted payback uses CF_t ÷ (1 + r)^t',
    inputs: [{ name: 'Cash flows', value: `${rows.length} years from the NPV engine`, source: 'derived' }, { name: 'Discount rate', value: fmt.pct(100 * v.rate), source: 'user' }],
    steps: rows.map(row => { c += row.projectCashFlow; d += row.projectCashFlow / (1 + v.rate) ** row.year; return { label: `Year ${row.year}`, work: `cumulative ${usd(c)} · discounted ${usd(d)}`, value: usd(row.projectCashFlow) }; }),
    result: { label: 'Simple / discounted', value: `${ok(v.pb.simple) ? `${v.pb.simple.toFixed(2)} y` : 'never'} / ${ok(v.pb.discounted) ? `${v.pb.discounted.toFixed(2)} y` : 'never'}` },
    checks: ok(v.pb.simple) ? [{ label: 'Independent: cumulative cash flow evaluated at the reported payback point = 0', a: cumAt(v.pb.simple, false), b: 0, atol: 1e-6 * Math.max(1, Math.abs(rows[0].projectCashFlow)), fmt: usd },
      ...(ok(v.pb.discounted) ? [{ label: 'Independent: discounted cumulative at the discounted payback = 0', a: cumAt(v.pb.discounted, true), b: 0, atol: 1e-6 * Math.max(1, Math.abs(rows[0].projectCashFlow)), fmt: usd }] : [])]
      : [noCheck('the cash flows never repay the capital, so there is no payback point to test')],
    csv: { name: `econ-payback-${S.nodeId}.csv`, meta: [['bus', S.nodeId], ['units', '$']], columns: ['year', 'cash_flow_usd', 'discount_factor'], rows: rows.map(row => [row.year, row.projectCashFlow, 1 / (1 + v.rate) ** row.year]) },
  });
}

/** Revenue path along the forecast runs. v: {path, rows, cod, decline, revenues} */
export function traceRevPath(S, v) {
  const hits = v.rows.map((r, t) => ({ r, t, a: v.path.find(p => p.y === r.y) })).filter(h => h.a);
  return trace({
    id: 'e-revpath', title: 'Revenue path from the forecast runs',
    formula: 'R(y) = run value at the run year;  linear between run years;  held at the first run before it and flat after the last;  revenue_k = R(COD + k − 1) × (1 − decline)^(k−1)',
    inputs: [...v.path.map(p => ({ name: `${p.kind}`, value: usd(p.v), source: 'derived', note: 'energy + RECs on this project, from the run\'s hourly prices' })),
      { name: 'First operating year', value: String(v.cod), source: 'user' }, { name: 'Output decline', value: `${v.decline}%/yr`, source: 'assumption' }],
    steps: v.rows.map((r, t) => ({ label: `${r.y} (operating ${t + 1})`, work: `${usd(r.v)} ${r.kind} × (1 − ${v.decline}%)^${t}`, value: usd(v.revenues[t]) })),
    result: { label: 'Year-1 revenue', value: usd(v.revenues[0]) },
    checks: hits.length ? [{ label: `Consistency check: the path at run year ${hits[0].r.y} = that run's value`, a: hits[0].r.v, b: hits[0].a.v, fmt: usd }] : [noCheck('no run year falls inside the operating years, so every year is held or extrapolated')],
    notes: ['The unified DB holds no 2045/2050 simulation (vendor escalations were excluded), so the path is held flat past the last run rather than escalated.'],
    csv: { name: `econ-revpath-${S.nodeId}.csv`, meta: [['bus', S.nodeId], ['units', '$']], columns: ['calendar_year', 'path_usd', 'path_basis', 'revenue_after_decline_usd'], rows: v.rows.map((r, t) => [r.y, r.v, r.kind, v.revenues[t]]) },
  });
}
