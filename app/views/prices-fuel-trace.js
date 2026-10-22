// Calculation traces for the Prices fuel cards (v5): data centre / load (bill share 5.18, cost to a flat load 5.31,
// scarcity-hour cost 5.21), storage (charge/discharge blocks 5.16, spread duration curve 5.17) and wind (overnight
// floor 5.20, fleet-shape capture). Each carries a check: an independent path where one exists (SQL mart vs the
// browser, or a second implementation), otherwise a labelled consistency or arithmetic re-check.
import { trace } from '../trace.js';
import { finite } from '../prices.js';
import { fmt, describe } from '../basis.js';
import { captureRatio } from '../decisionfuel.js';
import { tbMart } from './prices-calc.js';
import { flatLoadCost, isWindHour } from './prices-fuel.js';
import { csvMeta } from './prices-trace.js';
import { RUN, heRange, MONTHS } from './prices-ui.js';

const n2 = v => (finite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'not held');
const p = v => fmt.price(v);
const d6 = v => (finite(v) ? (Math.abs(v) < 1e-6 ? v.toExponential(1) : v.toFixed(6)) : 'not held');
const maxAbs = pairs => { const d = pairs.filter(([a, b]) => finite(a) && finite(b)).map(([a, b]) => Math.abs(a - b)); return d.length ? Math.max(...d) : null; };
const busIn = node => ({ name: 'Bus', value: `${node?.name ?? '?'} (${node?.id ?? '?'})`, source: 'measured' });
const basisIn = S => ({ name: 'Applied basis', value: describe(S.basis), source: 'user', note: 'chosen in LMP & years' });
const noCheck = reason => [`No check possible: ${reason}`];
const serLabel = r => (r.kind === 'solved' ? RUN[r.run] || r.run : `${r.year} settled ${r.market}`);
const allMeta = node => csvMeta(node, { mode: 'all years', market: '—', years: [], weighting: 'duration', nodeId: node?.id }).filter(([k]) => k !== 'basis').concat([['scope', 'every settled year and solved run held for this bus']]);
const martOf = (sum, r) => (r.kind === 'solved' ? (sum?.fcstYear || []).find(x => x.scenario === r.run) : (sum?.year || []).find(x => x.market === r.market && x.y === r.year)) || null;

/** 5.18: each clock hour's share of a flat load's energy bill on the applied basis. */
export function traceBill(node, S, bill, rows) {
  const flat = flatLoadCost(rows, null), held = bill.hours.filter(h => finite(h.share));
  const sumShare = held.reduce((t, h) => t + h.share, 0), sumCost = bill.hours.reduce((t, h) => t + (h.cost ?? 0), 0);
  const eve = bill.block([16, 17, 18, 19, 20]);
  return trace({
    id: 'p-bill', title: 'Share of a flat load\'s energy bill by hour',
    formula: 'share_h = Σ_(t in hour h) price_t × Δt ÷ Σ_t price_t × Δt × 100',
    inputs: [busIn(node), basisIn(S), { name: 'Hours on the basis', value: fmt.int(flat.hours), source: 'measured', note: 'hourly payload (fact_lmp_hourly / fact_fcst_lmp_hourly)' }, { name: 'Load shape', value: 'flat (1 MW every hour)', source: 'assumption', note: 'no site load profile is held' }],
    steps: [
      { label: 'Bill per MW over the basis', work: `Σ price × Δt over ${fmt.int(flat.hours)} h`, value: `$${n2(bill.total)}` },
      { label: `Dearest hour: HE${(bill.dearest?.h ?? 0) + 1}`, work: `$${n2(bill.dearest?.cost)} ÷ $${n2(bill.total)} × 100`, value: fmt.pct(bill.dearest?.share) },
      { label: 'Evening block HE17–21', work: 'Σ share over clock hours 16–20', value: fmt.pct(eve) },
      { label: 'A flat price would give', work: '100 ÷ 24', value: fmt.pct(100 / 24) },
    ],
    result: { label: `HE${(bill.dearest?.h ?? 0) + 1} share`, value: fmt.pct(bill.dearest?.share) },
    checks: held.length ? [
      { label: 'Consistency check: the 24 shares sum to 100%', a: sumShare, b: 100, tol: 1e-9, fmt: v => v.toFixed(6) },
      { label: 'Second code path: Σ of the 24 hourly bills = the flat-load bill (flatLoadCost)', a: sumCost, b: flat.perMW, tol: 1e-9, fmt: n2 },
    ] : [],
    notes: ['Energy only: no capacity, transmission, ancillary or retail charge.', ...(held.length ? [] : noCheck('the bill on this basis is not positive, so no share is held'))],
    csv: { name: `prices-bill-share-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['clock_hour', 'hour_ending', 'rows', 'hours', 'mean_usd_mwh', 'bill_usd_per_mw', 'share_pct'], rows: bill.hours.map(h => [h.h, h.h + 1, h.n, h.n ? h.n : null, h.mean, h.cost, h.share]) },
  });
}

/** 5.31: cost to a flat load and hours under $20 for every held series, the mean re-checked against the marts. */
export function traceLoad(node, sum, L, mw) {
  const pairs = L.map(r => [martOf(sum, r)?.avg_lmp ?? null, r.mean]);
  const can = pairs.some(([a, b]) => finite(a) && finite(b));
  const latest = [...L].reverse().find(r => r.kind === 'settled' && r.market === 'RT') || L[0];
  return trace({
    id: 'p-load', title: 'Cost to a flat load and hours under $20',
    formula: 'cost_yr = mean price × 8,760 h × MW; cheap share = hours with price < $20 ÷ hours held × 100',
    inputs: [busIn(node), { name: 'Load size', value: finite(mw) && mw > 0 ? fmt.mw(mw) : 'not held', source: 'user', note: 'Import MW in the project strip' }, { name: 'Cheap-hour threshold', value: '$20/MWh', source: 'rule', note: 'the Studio card 5.31 cut, not a market definition' }],
    steps: L.map(r => ({ label: serLabel(r), work: `mean ${p(r.mean)} over ${fmt.int(r.hours)} h × 8,760${finite(mw) && mw > 0 ? ` × ${fmt.int(mw)} MW` : ''} · < $20: ${fmt.int(r.cheapHours)} h (${fmt.pct(r.cheapShare)})`, value: finite(r.cost) ? fmt.money(r.cost) : `$${n2(r.perMWyr)}/MW-yr` })),
    result: { label: latest ? `${serLabel(latest)} per MW-year` : 'Per MW-year', value: latest ? `$${n2(latest.perMWyr)}` : 'not held' },
    checks: can ? [{ label: 'Independent path: every series mean from the hourly payload = the SQL mart (largest difference, $/MWh)', a: maxAbs(pairs), b: 0, atol: 1e-6, fmt: d6 }] : [],
    notes: ['A part year is annualised by its mean (× 8,760 h), never by its sum.', 'Energy only: capacity, transmission and retail charges are not in this figure.', ...(can ? [] : noCheck('no held series has a mart row'))],
    csv: { name: `prices-load-cost-${node?.id}.csv`, meta: allMeta(node), columns: ['year', 'series', 'hours', 'mean_usd_mwh', 'mart_mean_usd_mwh', 'usd_per_mw_year', 'cost_usd_year_at_size', 'hours_below_20', 'share_below_20_pct'], rows: L.map((r, i) => [r.year, r.kind === 'solved' ? r.run : r.market, r.hours, r.mean, pairs[i][0], r.perMWyr, r.cost, r.cheapHours, r.cheapShare]) },
  });
}

/** 5.21: hours above $X, their share of the bill and their excess over the mean; the proxy re-checked against the marts. */
export function traceScarce(node, sum, L, X) {
  const proxyPairs = L.map(r => { const m = martOf(sum, r); return [m && finite(m.hours_gt_200) && finite(m.p95) && finite(m.avg_lmp) ? m.hours_gt_200 * (m.p95 - m.avg_lmp) : null, r.proxy]; });
  const countPairs = X === 200 ? L.filter(r => r.kind === 'settled').map(r => [martOf(sum, r)?.hours_gt_200 ?? null, r.above]) : [];
  const canP = proxyPairs.some(([a, b]) => finite(a) && finite(b)), canC = countPairs.some(([a, b]) => finite(a) && finite(b));
  const latest = [...L].reverse().find(r => r.kind === 'settled' && r.market === 'RT') || L[0];
  return trace({
    id: 'p-scarce', title: `Scarcity-hour cost to a flat load (hours above $${X})`,
    formula: `excess = Σ_(price > ${X}) (price − mean) × Δt; share = Σ_(price > ${X}) price ÷ Σ price × 100; Studio proxy = hours > $200 × (P95 − mean)`,
    inputs: [busIn(node), { name: 'Threshold X', value: `$${X}/MWh`, source: 'user' }, { name: 'Series', value: fmt.int(L.length), source: 'measured', note: 'every settled year and solved run in the payload' }],
    steps: L.map(r => ({ label: serLabel(r), work: `${fmt.int(r.above)} h above $${X} · ${fmt.pct(r.aboveShare)} of the bill · excess $${n2(r.excess)} over ${fmt.int(r.hours)} h → $${n2(r.excessYr)}/MW-yr · proxy $${n2(r.proxy)}`, value: `$${n2(r.excessYr)}` })),
    result: { label: latest ? `${serLabel(latest)} excess per MW-year` : 'Excess per MW-year', value: latest ? `$${n2(latest.excessYr)}` : 'not held' },
    checks: [
      ...(canP ? [{ label: 'Independent path: the 5.21 proxy from the hourly payload = the proxy from the SQL mart (largest difference, $/MW-yr)', a: maxAbs(proxyPairs), b: 0, atol: 1e-3, fmt: d6 }] : []),
      ...(canC ? [{ label: 'Independent path: settled hours above $200 from the payload = mart hours_gt_200 (largest difference, hours)', a: maxAbs(countPairs), b: 0, atol: 0, fmt: v => fmt.int(v) }] : []),
    ],
    notes: ['The proxy understates the true excess when the tail is fat: the P95 sits below most hours above $200.', 'The excess is energy cost above the series mean; it is not a demand or capacity charge.', ...(canP || canC ? [] : noCheck('no held series has a mart row'))],
    csv: { name: `prices-scarcity-cost-${node?.id}.csv`, meta: allMeta(node), columns: ['year', 'series', 'hours', 'threshold_usd_mwh', 'hours_above', 'share_of_bill_pct', 'excess_usd_per_mw', 'excess_usd_per_mw_year', 'proxy_usd_per_mw_year', 'mart_proxy_usd_per_mw_year'], rows: L.map((r, i) => [r.year, r.kind === 'solved' ? r.run : r.market, r.hours, X, r.above, r.aboveShare, r.excess, r.excessYr, r.proxy, proxyPairs[i][0]]) },
  });
}

/** 5.16: charge and discharge blocks on the applied basis, by hour of day and by month. */
export function traceBlocks(node, S, b, bm) {
  const top = b.hours.reduce((t, h) => t + h.top, 0), bot = b.hours.reduce((t, h) => t + h.bot, 0), mDays = bm.reduce((t, m) => t + m.days, 0);
  return trace({
    id: 'p-blocks', title: `Charge and discharge blocks (${b.N} hours)`,
    formula: `per day: the ${b.N} dearest hours (discharge) and the ${b.N} cheapest (charge); share_h = days hour h is in the block ÷ days × 100`,
    inputs: [busIn(node), basisIn(S), { name: 'Block length N', value: `${b.N} h`, source: 'user', note: 'the storage duration chosen on the card' }, { name: 'Days counted', value: fmt.int(b.days), source: 'measured', note: `days with at least ${2 * b.N} priced hours` }],
    steps: [
      { label: 'Usual discharge block', work: `the ${b.N} clock hours most often among the day's dearest`, value: heRange(b.discharge) },
      { label: 'Usual charge block', work: `the ${b.N} clock hours most often among the day's cheapest`, value: heRange(b.charge) },
      ...bm.filter(m => m.days).map(m => ({ label: MONTHS[m.m - 1], work: `${fmt.int(m.days)} days · cheapest ${b.N} mean ${p(m.cheap)} · dearest ${p(m.dear)}`, value: p(m.spread) })),
    ],
    result: { label: 'Discharge / charge', value: `${heRange(b.discharge)} / ${heRange(b.charge)}` },
    checks: b.days ? [
      { label: `Consistency check: Σ days in the dearest block over the 24 hours = N × days (${b.N} × ${fmt.int(b.days)})`, a: top, b: b.N * b.days, atol: 0, fmt: v => fmt.int(v) },
      { label: 'Consistency check: Σ days in the cheapest block = N × days', a: bot, b: b.N * b.days, atol: 0, fmt: v => fmt.int(v) },
      { label: 'Consistency check: days by month sum to the days counted', a: mDays, b: b.days, atol: 0, fmt: v => fmt.int(v) },
    ] : [],
    notes: ['A price pattern, not a dispatch: state of charge, efficiency and connection limits are applied in Economics.', ...(b.days ? [] : noCheck(`no day holds ${2 * b.N} priced hours on this basis`))],
    csv: { name: `prices-blocks-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['clock_hour', 'hour_ending', 'days_in_dearest', 'pct_dearest', 'days_in_cheapest', 'pct_cheapest', 'mean_usd_mwh'], rows: b.hours.map(h => [h.h, h.h + 1, h.top, h.topPct, h.bot, h.botPct, h.mean]) },
  });
}

/** 5.17: each day's max − min, widest first, and the share of days that clear the cycle threshold. */
export function traceSpreadCurve(node, S, rows, curve, T, share) {
  const days = new Set(curve.map(d => d.day)), alt = tbMart(rows, 1).daily.filter(d => days.has(d.day));
  const mean = curve.length ? curve.reduce((t, d) => t + d.spread, 0) / curve.length : null, altMean = alt.length ? alt.reduce((t, d) => t + d.spread, 0) / alt.length : null;
  const med = curve.length ? curve[Math.floor((curve.length - 1) / 2)].spread : null;
  return trace({
    id: 'p-spreadcurve', title: 'Daily spread duration curve',
    formula: 'spread_d = max_(t in d) price_t − min_(t in d) price_t; days with fewer than 20 priced hours excluded; share = days with spread ≥ T ÷ days',
    inputs: [busIn(node), basisIn(S), { name: 'Cycle threshold T', value: `$${T}/MWh`, source: 'user', note: 'below this a cycle costs more in degradation than it earns (your call)' }],
    steps: [
      { label: 'Days on the curve', work: `${fmt.int(curve.length)} days with ≥ 20 priced hours`, value: fmt.int(curve.length) },
      { label: 'Widest day', work: curve[0] ? `${curve[0].day}: ${p(curve[0].max)} − ${p(curve[0].min)}` : '—', value: p(curve[0]?.spread) },
      { label: 'Median day', work: 'middle of the ranked curve', value: p(med) },
      { label: `Days clearing $${T}`, work: `count(spread ≥ ${T}) ÷ ${fmt.int(curve.length)}`, value: fmt.pct(share) },
    ],
    result: { label: `Days clearing $${T}`, value: fmt.pct(share) },
    checks: curve.length ? [{ label: 'Independent path: mean daily max − min = the mart-method TB1 (Prices › tbMart, N = 1) over the same days', a: mean, b: altMean, tol: 1e-9, fmt: v => p(v) }] : [],
    notes: ['A gross spread: before round-trip efficiency, degradation, state of charge or the connection limits.', ...(curve.length ? [] : noCheck('no day holds 20 priced hours on this basis'))],
    csv: { name: `prices-spread-curve-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['rank', 'date', 'max_usd_mwh', 'min_usd_mwh', 'spread_usd_mwh', 'clears_threshold'], rows: curve.map((d, i) => [i + 1, d.day, d.max, d.min, d.spread, d.spread >= T ? 1 : 0]) },
  });
}

/** 5.20: overnight (wind-window) P5 and P25 per series, re-checked by a second quantile implementation. */
export function traceFloor(node, W, H) {
  const q = (a, pr) => { const v = [...a].sort((x, y) => x - y); if (!v.length) return null; const pos = pr * (v.length - 1), lo = Math.floor(pos), hi = Math.min(v.length - 1, lo + 1); return v[lo] * (1 - (pos - lo)) + v[hi] * (pos - lo); };
  const pairs = [];
  for (const w of W) {
    const h = H.find(x => x.key === w.key); if (!h || !w.floor) continue;
    const pw = h.rows.filter(r => finite(r.price) && isWindHour(Number(String(r.timestamp).slice(11, 13)))).map(r => r.price);
    pairs.push([w.floor.p5, q(pw, 0.05)], [w.floor.p25, q(pw, 0.25)]);
  }
  const held = W.filter(w => w.floor);
  const last = [...held].reverse().find(w => w.kind === 'settled' && w.market === 'RT') || held[0];
  return trace({
    id: 'p-floor', title: 'Overnight price floor (wind window P5 and P25)',
    formula: 'P_q = quantile_cont(price over clock hours 0–6 and 18–23, q); q = 0.05 and 0.25',
    inputs: [busIn(node), { name: 'Wind window', value: 'HE 1–7 and HE 19–24', source: 'rule', note: 'the Studio rollup window (agg_build.py), clock hours 0–6 and 18–23' }],
    steps: held.map(w => ({ label: serLabel(w), work: `${fmt.int(w.floor.n)} window hours · P5 ${p(w.floor.p5)} · P25 ${p(w.floor.p25)} · min ${p(w.floor.min)} · ${fmt.int(w.floor.neg)} below $0`, value: p(w.floor.p5) })),
    result: { label: last ? `${serLabel(last)} P5` : 'P5', value: p(last?.floor?.p5) },
    checks: pairs.length ? [{ label: 'Arithmetic re-check: every P5 and P25 recomputed by a second sort-and-interpolate (largest difference, $/MWh)', a: maxAbs(pairs), b: 0, atol: 1e-9, fmt: d6 }] : [],
    notes: ['Settled series are real time; solved runs are modelled day-ahead years. Read each on its own.', ...(pairs.length ? [] : noCheck('no window hour is held'))],
    csv: { name: `prices-overnight-floor-${node?.id}.csv`, meta: allMeta(node), columns: ['year', 'series', 'window_hours', 'p5_usd_mwh', 'p25_usd_mwh', 'p50_usd_mwh', 'mean_usd_mwh', 'min_usd_mwh', 'hours_below_0'], rows: held.map(w => [w.year, w.kind === 'solved' ? w.run : w.market, w.floor.n, w.floor.p5, w.floor.p25, w.floor.p50, w.floor.mean, w.floor.min, w.floor.neg]) },
  });
}

/** Wind capture with the ISO-NE fleet wind shape on the applied basis, re-checked by the Decision method (captureRatio). */
export function traceWindCap(node, S, rows, c, weightOf, W, src) {
  const alt = captureRatio(rows.filter(r => finite(weightOf(r))), r => weightOf(r));
  return trace({
    id: 'p-windcap', title: 'Wind capture price (ISO-NE fleet wind shape)',
    formula: 'capture = Σ fleetMW_h × price_h × Δt ÷ Σ fleetMW_h × Δt; ratio = capture ÷ time-weighted mean of the same hours',
    inputs: [busIn(node), basisIn(S), { name: 'Generation shape', value: 'ISO-NE fleet wind output', source: 'measured', note: `${src || 'unified fact_genfuel_hourly'} · a system-wide shape, not this site's wind` },
      { name: 'Hours matched by clock hour', value: fmt.int(c.matched), source: 'measured' }, { name: 'Hours on the typical month × hour shape', value: fmt.int(c.typical), source: 'derived', note: 'model calendars (solved runs) and gaps: mean fleet MW for that month and clock hour' }, { name: 'Hours without a shape', value: fmt.int(c.missing), source: 'measured', note: 'left out, never zero-weighted' }],
    steps: [
      { label: 'Fleet-weighted price', work: `Σ MW × price × Δt ÷ Σ MW × Δt over ${fmt.int(c.hours)} h`, value: p(c.capture) },
      { label: 'Time-weighted mean of the same hours', work: 'Σ price × Δt ÷ Σ Δt', value: p(c.avg) },
      { label: 'Capture ratio', work: `${n2(c.capture)} ÷ ${n2(c.avg)}`, value: finite(c.ratio) ? c.ratio.toFixed(3) : 'not held' },
      ...W.filter(w => finite(w.ratio)).map(w => ({ label: serLabel(w), work: `capture ${p(w.capture)} ÷ mean ${p(w.avg)} (${fmt.int(w.matched)} matched, ${fmt.int(w.typical)} typical)`, value: w.ratio.toFixed(3) })),
    ],
    result: { label: 'Wind capture price', value: p(c.capture) },
    checks: finite(c.capture) ? [{ label: 'Independent path: the Decision capture method (decisionfuel.captureRatio) on the same hours and weights', a: c.capture, b: alt.capture, tol: 1e-9, fmt: v => p(v) }] : [],
    notes: ['Behind-the-meter and curtailed output are not in the fleet series; a site profile would differ.', ...(finite(c.capture) ? [] : noCheck('no fleet wind shape is held on these hours'))],
    csv: { name: `prices-wind-capture-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['timestamp', 'price_usd_mwh', 'fleet_wind_mw', 'interval_hours'], rows: () => rows.map(r => [r.timestamp, r.price, weightOf(r), r.dtHours ?? 1]) },
  });
}
