// Calculation traces for the Prices dashboard. Every figure is recomputed here from the same rows the
// view uses, independently of the headline, so each trace can reconcile against it.
import { trace } from '../trace.js';
import { finite, matchedBasis, weightedQuantile, quantile, QUANTILE_METHOD, QUANTILE_METHOD_MIXED, priceTierLabel } from '../prices.js';
import { clearSky } from '../solar.js';
import { LABELS, describe, fmt } from '../basis.js';

const n2 = v => (finite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'not held');
const n4 = v => (finite(v) ? v.toFixed(4) : 'not held');
const sumBy = (rows, f) => rows.reduce((t, r) => t + f(r), 0);
const priceCheck = v => fmt.price(v);

export function priceSource(node, basis) {
  const pm = node?.priceMapping || {};
  if (basis?.mode === 'forecast') return { value: `Model bus ${node?.id ?? '?'} (${basis.run})`, note: 'Forecast modelled for this bus itself; nothing borrowed' };
  // S2-D (W-B): tier words from one home (prices.priceTierLabel), incl. the D-008 relinked tier.
  return { value: pm.pnode_name ?? '—', note: priceTierLabel({ tier: pm.tier, km: pm.distance_km, relinkMi: pm.distance_mi, relinkedFrom: pm.relinked_from }) };
}

function busInputs(node, basis) {
  const ps = priceSource(node, basis);
  return [
    { name: 'Bus', value: `${node?.name ?? '?'} (${node?.id ?? '?'})`, source: 'measured' },
    { name: basis?.mode === 'forecast' ? 'Price series' : 'Price node', value: ps.value, source: 'measured', note: ps.note },
    { name: 'Basis', value: describe(basis), source: 'user' },
  ];
}

export const csvMeta = (node, basis) => { const ps = priceSource(node, basis); return [['bus', `${node?.name} (${node?.id})`], ['price series', `${ps.value} — ${ps.note}`], ['basis', describe(basis)], ['convention', 'price = energy + congestion + loss, $/MWh, settled sign'], ['missing', 'empty cell = not held, never zero']]; };

const hourlyCsv = (res, name, node, basis) => ({
  name, meta: csvMeta(node, basis), columns: ['timestamp', 'price_usd_mwh', 'energy_usd_mwh', 'congestion_usd_mwh', 'loss_usd_mwh', 'interval_hours'],
  rows: () => res.rows.map(r => [r.timestamp, r.price, r.energy, r.congestion, r.loss, r.dtHours]),
  note: 'Hourly rows exactly as used. Empty cells are values not held, never zero.',
});

/** LMP & years: headline mean (year-weighted) and the pooled distribution. */
export function traceLmp(data, S, node, res) {
  const s = res.summary; if (!s) return '';
  const inc = res.audit.filter(a => a.status === 'Included');
  const sumW = sumBy(inc, a => a.weight);
  const steps = [];
  for (const a of res.audit) {
    if (a.status !== 'Included') { steps.push({ label: `${a.year}: left out`, work: a.status, value: '—' }); continue; }
    const ph = sumBy(a.rows, r => r.price * r.dtHours);
    steps.push({ label: `${a.year} annual mean`, work: `Σ price × hours ÷ Σ hours = ${n2(ph)} ÷ ${fmt.int(a.hours)}`, value: fmt.price(ph / a.hours) });
  }
  for (const a of inc) steps.push({ label: `${a.year} weight`, work: `${LABELS[S.basis.weighting]}: ${n2(a.weight)} ÷ ${n2(sumW)}`, value: `${(100 * a.weight / sumW).toFixed(2)}%` });
  let mean = 0;
  for (const a of inc) { const c = (sumBy(a.rows, r => r.price * r.dtHours) / a.hours) * (a.weight / sumW); mean += c; steps.push({ label: `${a.year} contribution`, work: `${fmt.price(a.mean)} × ${(100 * a.weight / sumW).toFixed(2)}%`, value: fmt.price(c) }); }
  steps.push({ label: 'Mean price', work: `Σ contributions (${inc.length} year${inc.length > 1 ? 's' : ''})`, value: fmt.price(mean) });
  const meanTrace = trace({
    id: 'p-mean', title: 'Mean price', formula: 'Mean = Σ_y ( annual mean_y × w_y ÷ Σw ),  annual mean_y = Σ_h price_h × Δt_h ÷ Σ_h Δt_h',
    inputs: [...busInputs(node, S.basis), { name: 'Weighting', value: LABELS[S.basis.weighting], source: 'user', note: S.basis.weighting === 'duration' ? 'Each year weighted by its observed hours' : '' },
      ...res.audit.map(a => ({ name: `${a.year} observed hours`, value: fmt.int(a.hours), source: 'measured', note: a.status }))],
    steps, result: { label: 'Mean price', value: `${fmt.price(s.mean)}/MWh` },
    check: S.basis.weighting === 'duration'
      ? { label: 'Independent path: observed-hour weighting equals the pooled hourly mean Σ price × h ÷ Σ h', a: s.observedMean, b: s.mean, fmt: priceCheck }
      : { label: 'Arithmetic re-run of Σ contributions (no independent path for equal or custom weights)', a: mean, b: s.mean, fmt: priceCheck },
    csv: hourlyCsv(res, `prices-hourly-${node?.id}.csv`, node, S.basis),
  });
  // Distribution: pooled observed hours, hour-weighted quantiles.
  const H = s.hours, neg = sumBy(res.rows.filter(r => r.price < 0), r => r.dtHours);
  // S2-EM D11: one stated method. Equal intervals: linear interpolation at (n − 1)q, re-run here with the shared
  // quantile() on the sorted prices (a separate routine from analyzePrices); mixed intervals: duration nearest rank.
  const eqDt = res.rows.every(r => Math.abs(r.dtHours - res.rows[0].dtHours) < 1e-9), pr = res.rows.map(r => r.price);
  const q = p => (eqDt ? quantile(pr, p) : weightedQuantile(res.rows, p)), pos = p => n2((res.rows.length - 1) * p);
  const distTrace = trace({
    id: 'p-dist', title: 'Price range and negative hours', formula: `p_q = ${eqDt ? QUANTILE_METHOD : QUANTILE_METHOD_MIXED};  negative share = hours with price < $0 ÷ H`,
    inputs: [{ name: 'Pooled hours H', value: fmt.int(H), source: 'measured', note: 'All included years together; year weighting does not apply here' }],
    steps: [
      { label: 'p5', work: eqDt ? `sort ${fmt.int(res.rows.length)} hourly prices; interpolate at position ${pos(0.05)}` : `cumulative hours reach 5% × ${fmt.int(H)} = ${n2(0.05 * H)} h`, value: fmt.price(q(0.05)) },
      { label: 'Median (p50)', work: eqDt ? `position ${pos(0.5)}` : `cumulative hours reach ${n2(0.5 * H)} h`, value: fmt.price(q(0.5)) },
      { label: 'p95', work: eqDt ? `position ${pos(0.95)}` : `cumulative hours reach ${n2(0.95 * H)} h`, value: fmt.price(q(0.95)) },
      { label: 'Hours below $0', work: `${fmt.int(neg)} h ÷ ${fmt.int(H)} h`, value: fmt.pct(100 * neg / H) },
    ],
    result: { label: 'p5 – p95', value: `${fmt.price(s.p05)} – ${fmt.price(s.p95)}/MWh` },
    checks: [
      { label: 'p5 from a separate quantile routine = headline', a: q(0.05), b: s.p05, fmt: priceCheck },
      { label: 'p50 from a separate quantile routine = headline', a: q(0.5), b: s.p50, fmt: priceCheck },
      { label: 'p95 from a separate quantile routine = headline', a: q(0.95), b: s.p95, fmt: priceCheck },
      { label: 'Arithmetic re-run of the negative-hour share', a: 100 * neg / H, b: s.negativePct, fmt: v => fmt.pct(v) },
    ],
  });
  return meanTrace + distTrace;
}

/** Basis & congestion: node − hub on matched hours, and the component split. */
export function traceBasis(data, S, node, res, refSeriesFor) {
  const s = res.summary; if (!s) return '';
  const per = [], all = [];
  for (const a of res.audit.filter(x => x.status === 'Included')) {
    const ref = refSeriesFor(data, a, S.basis);
    const m = ref ? matchedBasis(a.series, ref) : [];
    per.push({ year: a.year, n: sumBy(m, r => r.dtHours), total: a.hours, sum: sumBy(m, r => r.price * r.dtHours), ref: !!ref }); all.push(...m);
  }
  const n = sumBy(all, r => r.dtHours), sum = sumBy(all, r => r.price * r.dtHours), above = sumBy(all.filter(r => r.price > 0), r => r.dtHours);
  const withC = res.rows.filter(r => finite(r.energy) && finite(r.congestion) && finite(r.loss)), hc = sumBy(withC, r => r.dtHours);
  const avg = k => (hc ? sumBy(withC, r => r[k] * r.dtHours) / hc : null), E = avg('energy'), C = avg('congestion'), L = avg('loss'), P = avg('price');
  const nodeSum = sumBy(all, r => r.node * r.dtHours), refSum = sumBy(all, r => r.reference * r.dtHours);
  const refName = S.basis.mode === 'forecast' ? `Model bus 80000 (ISO-NE hub, ${S.basis.run})` : (data.nodes.find(x => x.id === 'hub')?.priceMapping?.pnode_name || '.H.INTERNAL_HUB');
  const basisTrace = trace({
    id: 'p-basis', title: 'Basis to the ISO-NE hub', formula: 'Basis = Σ_h (node_h − hub_h) × Δt_h ÷ Σ_h Δt_h, over hours present in both series with the same interval',
    inputs: [...busInputs(node, S.basis), { name: 'Reference', value: refName, source: 'measured' }],
    steps: [
      ...per.map(p => ({ label: `${p.year} matched hours`, work: p.ref ? `${fmt.int(p.n)} of ${fmt.int(p.total)} node hours have a hub price` : 'no hub series on this basis: year left out', value: p.ref ? fmt.price(p.n ? p.sum / p.n : null) : '—' })),
      { label: 'Pooled basis', work: `Σ (node − hub) × h ÷ Σ h = ${n2(sum)} ÷ ${fmt.int(n)}`, value: fmt.price(n ? sum / n : null) },
      { label: 'Hours node above hub', work: `${fmt.int(above)} h ÷ ${fmt.int(n)} h`, value: fmt.pct(n ? 100 * above / n : null) },
    ],
    result: { label: 'Basis to hub', value: `${fmt.price(n ? sum / n : null)}/MWh` },
    check: { label: 'Independent path: mean node price − mean hub price over the same hours', a: n ? sum / n : null, b: n ? (nodeSum - refSum) / n : null, fmt: priceCheck },
    notes: S.basis.mode === 'historical' ? ['The two readings of the repeated autumn 1 a.m. hour have no recorded order in the source; node and hub are paired by price rank for that hour (2 hours a year).'] : [],
    csv: { name: `prices-basis-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['timestamp', 'node_usd_mwh', 'hub_usd_mwh', 'basis_usd_mwh', 'interval_hours'], rows: () => all.map(r => [r.timestamp, r.node, r.reference, r.price, r.dtHours]) },
  });
  const compTrace = trace({
    id: 'p-comp', title: 'Price components at the node', formula: 'Price = Energy + Congestion + Losses (settled sign; forecast congestion converted once, on extraction)',
    inputs: [{ name: 'Hours with all three components', value: `${fmt.int(hc)} of ${fmt.int(s.hours)}`, source: 'measured', note: hc < s.hours ? 'Hours missing a component are left out of this split' : '' }],
    steps: [
      { label: 'Energy', work: `Σ energy × h ÷ ${fmt.int(hc)}`, value: fmt.price(E) },
      { label: 'Congestion', work: `Σ congestion × h ÷ ${fmt.int(hc)}`, value: fmt.price(C) },
      { label: 'Losses', work: `Σ loss × h ÷ ${fmt.int(hc)}`, value: fmt.price(L) },
      { label: 'Sum of components', work: `${fmt.price(E)} + ${fmt.price(C)} + ${fmt.price(L)}`, value: fmt.price(finite(E) ? E + C + L : null) },
    ],
    result: { label: 'Congestion', value: `${fmt.price(C)}/MWh` },
    ...(S.basis.mode === 'forecast'
      ? { notes: ['Forecast energy is derived as price − congestion − losses, so the three add up to the price by construction; this split is not an independent check.'] }
      : { check: { label: 'Data check: hours where energy + congestion + losses differs from price by more than $0.01', a: withC.filter(r => Math.abs(r.energy + r.congestion + r.loss - r.price) > 0.01).length, b: 0, fmt: v => `${fmt.int(v)} h` } }),
  });
  return basisTrace + compTrace;
}

function monthlyCapture(rows, g) {
  const m = new Map();
  for (const r of rows) { const w = g(r); if (w == null) continue; const k = String(r.timestamp).slice(0, 7), o = m.get(k) || { num: 0, den: 0 }; o.num += w * r.price * r.dtHours; o.den += w * r.dtHours; m.set(k, o); }
  let num = 0, den = 0; for (const o of m.values()) if (o.den) { num += (o.num / o.den) * o.den; den += o.den; }
  return den ? num / den : null;
}

/** Shape & capture: clear-sky (or flat) weighted price. */
export function traceShape(data, S, node, res, profile, headline) {
  if (!res.summary) return '';
  const lat = node?.latitude, lon = node?.longitude;
  const g = r => (profile === 'solar' ? clearSky(r.timestamp, lat, lon) : 1);
  let num = 0, den = 0, ph = 0, h = 0, skipped = 0;
  for (const r of res.rows) { const w = g(r); if (w == null) { skipped++; continue; } num += w * r.price * r.dtHours; den += w * r.dtHours; ph += r.price * r.dtHours; h += r.dtHours; }
  const cap = den ? num / den : null, avg = h ? ph / h : null;
  return trace({
    id: 'p-capture', title: profile === 'solar' ? 'Solar capture price' : 'Time-weighted price',
    formula: 'Capture = Σ_h g_h × price_h × Δt_h ÷ Σ_h g_h × Δt_h;  ratio = capture ÷ (Σ price × Δt ÷ Σ Δt);  clear-sky bound = Σ g × Δt ÷ Σ Δt',
    inputs: [...busInputs(node, S.basis),
      { name: 'Latitude, longitude', value: `${n4(lat)}, ${n4(lon)}`, source: 'measured', note: 'Bus location from the network model' },
      { name: 'Generation shape g', value: profile === 'solar' ? 'Clear-sky sun elevation (per MW)' : 'Flat (1 every hour)', source: 'assumption', note: profile === 'solar' ? 'No clouds, clipping or losses; not measured output' : 'Price proxy, not a capture price' }],
    steps: [
      { label: 'Σ g × hours', work: `over ${fmt.int(res.rows.length - skipped)} hours`, value: n2(den) },
      { label: 'Σ g × price × hours', work: '', value: n2(num) },
      { label: 'Capture price', work: `${n2(num)} ÷ ${n2(den)}`, value: fmt.price(cap) },
      { label: 'Time-weighted average', work: `${n2(ph)} ÷ ${fmt.int(h)}`, value: fmt.price(avg) },
      { label: 'Capture ratio', work: `${fmt.price(cap)} ÷ ${fmt.price(avg)}`, value: finite(cap) && avg ? (cap / avg).toFixed(3) : 'not held' },
      { label: 'Clear-sky upper bound', work: `${n2(den)} ÷ ${fmt.int(h)}`, value: h ? fmt.pct(100 * den / h) : 'not held' },
    ],
    result: { label: profile === 'solar' ? 'Capture price' : 'Time-weighted price', value: `${fmt.price(cap)}/MWh` },
    checks: [
      { label: 'Monthly decomposition: Σ (monthly capture × monthly Σ g × h) ÷ Σ g × h = annual capture', a: monthlyCapture(res.rows, g), b: headline, fmt: priceCheck },
      { label: 'Arithmetic re-run of the capture loop', a: cap, b: headline, fmt: priceCheck },
    ],
    csv: { name: `prices-capture-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['timestamp', 'price_usd_mwh', 'g_per_mw', 'g_x_price_x_hours_usd_per_mw', 'interval_hours'], rows: () => res.rows.map(r => { const w = g(r); return [r.timestamp, r.price, w, w == null ? null : w * r.price * r.dtHours, r.dtHours]; }) },
  });
}

/** Tails & spreads: ≤ $0 hours, daily top-N − bottom-N spread with a worked day, threshold count. */
export function traceTails(data, S, node, res, dur, spreads, thr) {
  const s = res.summary; if (!s) return '';
  const H = s.hours, le0 = sumBy(res.rows.filter(r => r.price <= 0), r => r.dtHours), above = sumBy(res.rows.filter(r => r.price > thr), r => r.dtHours);
  const days = new Set(res.rows.map(r => String(r.timestamp).slice(0, 10))).size;
  const mean = spreads.length ? sumBy(spreads, d => d.spread) / spreads.length : null;
  const best = spreads.reduce((b, d) => (!b || d.spread > b.spread ? d : b), null);
  let worked = [], rawSpread = null;
  if (best) {
    const p = res.rows.filter(r => String(r.timestamp).slice(0, 10) === best.day).map(r => r.price).sort((a, b) => a - b);
    const lo = p.slice(0, dur), hi = p.slice(-dur);
    rawSpread = sumBy(hi, v => v) / dur - sumBy(lo, v => v) / dur;
    worked = [
      { label: `Worked day ${best.day}: ${dur} lowest prices`, work: lo.map(v => fmt.price(v)).join(', '), value: fmt.price(sumBy(lo, v => v) / dur) },
      { label: `${dur} highest prices`, work: hi.map(v => fmt.price(v)).join(', '), value: fmt.price(sumBy(hi, v => v) / dur) },
      { label: 'That day’s spread', work: 'mean of highest − mean of lowest', value: fmt.price(best.spread) },
    ];
  }
  return trace({
    id: 'p-tails', title: `Daily ${dur}-hour spread and risk hours`,
    formula: `Daily spread = mean(${dur} highest) − mean(${dur} lowest) prices of each complete day;  headline = Σ spreads ÷ days`,
    inputs: [...busInputs(node, S.basis), { name: 'Storage duration', value: `${dur} h`, source: 'user' }, { name: 'Price threshold', value: `$${thr}/MWh`, source: 'user' }],
    steps: [
      { label: 'Days in the basis', work: `${fmt.int(days)} calendar days`, value: fmt.int(days) },
      { label: 'Complete days used', work: `days with every hour present (23–25 on clock changes); ${fmt.int(days - spreads.length)} skipped`, value: fmt.int(spreads.length) },
      ...worked,
      { label: 'Average daily spread', work: `Σ spreads ÷ ${fmt.int(spreads.length)} days`, value: fmt.price(mean) },
      { label: 'Hours at or below $0', work: `${fmt.int(le0)} h ÷ ${fmt.int(H)} h`, value: fmt.pct(100 * le0 / H) },
      { label: `Hours above $${thr}`, work: `${fmt.int(above)} h ÷ ${fmt.int(H)} h`, value: fmt.pct(100 * above / H) },
    ],
    result: { label: `Daily ${dur}-hour spread`, value: `${fmt.price(mean)}/MWh` },
    check: { label: 'Worked day recomputed from its raw hours = spread routine', a: rawSpread, b: best?.spread ?? null, fmt: priceCheck },
    notes: ['A gross spread ignores round-trip losses, charge limits and state of charge. It is a benchmark, not battery revenue (Economics › BESS dispatch).'],
    csv: { name: `prices-spreads-${dur}h-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['day', `spread_${dur}h_usd_mwh`], rows: spreads.map(d => [d.day, d.spread]) },
  });
}
