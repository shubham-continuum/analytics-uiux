// Calculation traces for Market. Independent checks where a second data path exists (the screening summary price
// vs the bus's own hourly prices; the unified generation mix vs the Studio copy; the Grid page's size sweep);
// otherwise the check is labelled a consistency check or an arithmetic re-check.
import { trace } from '../trace.js';
import { MEASURES, quantile, contributions, populationRule } from '../marketcore.js';
import { sizeSweep as gridSizeSweep } from '../gridrules.js';
import { fmt } from '../basis.js';
import { rowsOf, priceTierLabel } from '../prices.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const n1 = v => (ok(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : 'not held');
const n2 = v => (ok(v) ? v.toFixed(2) : 'not held');
const int = v => fmt.int(v);

/** Find: the candidate bus's requirement-by-requirement evaluation. */
export function traceFind(data, S, ev, lims, r) {
  const e = ev.find(x => String(x.node.bus_id) === String(S.nodeId)); if (!e) return '';
  const counts = ['met', 'unknown', 'unmet', 'excluded'].map(s => ev.filter(x => x.status === s).length);
  const steps = [];
  if (r.zones?.length) steps.push({ label: 'Zone', work: `${e.node.zone} in {${r.zones.join(', ')}}?`, value: r.zones.includes(e.node.zone) ? 'yes' : 'no → excluded' });
  if (r.minKv > 0) steps.push({ label: 'Voltage', work: `${n1(e.node.kv)} kV ≥ ${r.minKv} kV?`, value: ok(e.node.kv) ? (e.node.kv >= r.minKv ? 'pass' : 'fail') : 'unknown' });
  for (const l of lims) {
    const mw = r.tech === 'datacenter' ? r.importMW : l.dir === 'export' ? r.exportMW : Math.max(r.importMW || 0, r.exportMW || 0);
    if (!(mw > 0)) continue;
    steps.push({ label: l.label, work: `${ok(l.value) ? fmt.mw(l.value) : 'not held'} (${l.basis}) vs request ${fmt.mw(mw)}`, value: !ok(l.value) ? 'unknown' : l.value >= mw ? `pass (+${n1(l.value - mw)} MW)` : `fail (−${n1(mw - l.value)} MW)` });
  }
  const tierWords = priceTierLabel({ tier: e.node.tier, km: e.node.proxyKm, relinkMi: e.node.relinkMi, relinkedFrom: e.node.relinkedFrom });
  if (r.ownPriceNode) steps.push({ label: 'Own price node', work: `${e.node.tier}: ${tierWords}`, value: e.node.tier === 'relinked' || (e.node.tier === 'geo_proxy' && !(e.node.proxyKm < 0.05)) ? 'fail' : 'pass' });
  if (ok(r.maxPrice2025) || ok(r.minPrice2025)) steps.push({ label: '2025 price filter', work: `${ok(populationRule(e, 'lmp_2025')) ? fmt.price(populationRule(e, 'lmp_2025')) : 'not held (part-year 2025)'} within [${ok(r.minPrice2025) ? '$' + r.minPrice2025 : '—'}, ${ok(r.maxPrice2025) ? '$' + r.maxPrice2025 : '—'}]`, value: !ok(populationRule(e, 'lmp_2025')) ? 'unknown' : 'see status' });
  steps.push({ label: 'Status', work: 'any fail → does not meet; else any unknown → unknown; else meets', value: { met: 'Meets', unknown: 'Unknown', unmet: 'Does not meet', excluded: 'Excluded' }[e.status] });
  const s = data.series.find(x => String(x.nodeId) === String(S.nodeId) && x.mode === 'historical' && x.market === 'RT' && Number(x.year) === 2025);
  const rows = s ? rowsOf(s) : [], h = rows.reduce((t, x) => t + x.dtHours, 0), hourlyMean = h ? rows.reduce((t, x) => t + x.price * x.dtHours, 0) / h : null;
  return trace({
    id: 'm-find', title: `Screening of ${e.node.name}`,
    formula: 'Meets = every applicable case limit ≥ request (Grid rules) AND every filter passes;  any missing evidence → unknown, never meets',
    inputs: [
      { name: 'Candidate bus', value: `${e.node.name} (${e.node.bus_id})`, source: 'measured', note: `${e.node.zone} · ${n1(e.node.kv)} kV` },
      { name: 'Service, request', value: `${r.tech}, export ${fmt.mw(r.exportMW)}${r.importMW ? `, import ${fmt.mw(r.importMW)}` : ''}`, source: 'user' },
      { name: 'Shoulder export case', value: r.useShoulder !== false ? 'required' : 'not required', source: 'user', note: 'Envelope only (vendor-asserted); storage charging at shoulder is always required' },
      { name: 'Price source', value: e.node.pnode, source: 'measured', note: tierWords },
    ],
    steps,
    result: { label: 'Status', value: { met: 'Meets requirements', unknown: 'Unknown', unmet: 'Does not meet', excluded: 'Outside selected zones' }[e.status] },
    checks: [
      { label: 'Independent data path: 2025 RT price in the screening summary = mean of this bus\'s hourly prices (Prices data)', a: e.node.lmp_2025, b: hourlyMean, tol: 5e-4, fmt: v => fmt.price(v) },
      { label: `Partition: meets ${counts[0]} + unknown ${counts[1]} + does not meet ${counts[2]} + excluded ${counts[3]} = all buses`, a: counts.reduce((a, b) => a + b, 0), b: data.study.nodes.length, fmt: int },
    ],
    csv: { name: `market-screen-${r.tech}-${r.exportMW}mw.csv`, meta: [['requirements', JSON.stringify(r)], ['source', data.study.source]], columns: ['bus_id', 'name', 'zone', 'kv', 'status', 'margin_mw', 'price_2025_usd_mwh', 'price_source', 'proxy_km', 'reasons', 'unknown'], rows: () => ev.map(x => [x.node.bus_id, x.node.name, x.node.zone, x.node.kv, x.status, x.margin, x.node.lmp_2025, x.node.tier, x.node.proxyKm, x.reasons.join('; '), x.unknown.join('; ')]) },
  });
}

/** Find: the qualifying funnel, step by step. */
export function traceFunnel(f, ev, r) {
  const met = ev.filter(e => e.status === 'met').length, s0 = f.steps[0].remain;
  const drops = f.steps.slice(1).reduce((t, s) => t + s.fail + s.unknown + s.excluded, 0);
  return trace({
    id: 'm-funnel', title: 'Qualifying funnel',
    formula: 'remain_k = remain_(k−1) − fail_k − unknown_k − outside_k,  requirements applied in order (zone, voltage, study cases, price node, price filters)',
    inputs: [{ name: 'Buses screened', value: int(s0), source: 'measured', note: 'every geolocated bus in the unified database' }, { name: 'Requirements', value: JSON.stringify(r), source: 'user' }],
    steps: f.steps.slice(1).map(s => ({ label: s.label, work: `${int(s.remain + s.fail + s.unknown + s.excluded)} − ${int(s.fail)} fail − ${int(s.unknown)} unknown − ${int(s.excluded)} outside`, value: int(s.remain) })),
    result: { label: 'Qualifying', value: int(f.steps.at(-1).remain) },
    checks: [
      { label: 'Consistency check: the funnel end (per-requirement checks) = meets count from the screen (evaluate)', a: f.steps.at(-1).remain, b: met, fmt: int },
      { label: 'Partition: qualifying + every bus dropped = buses screened', a: f.steps.at(-1).remain + drops, b: s0, fmt: int },
    ],
    notes: ['Sequential: a bus is counted at the first requirement it cannot clear, so the per-step drops depend on the order. The requirement matrix beside it counts each requirement on its own.'],
    csv: { name: 'market-funnel.csv', columns: ['step', 'requirement', 'fail', 'unknown', 'outside_zones', 'remaining'], rows: f.steps.map((s, i) => [i, s.label, s.fail, s.unknown, s.excluded, s.remain]) },
  });
}

/** Rank: the top bus's score, measure by measure, with the percentile recomputed by counting. */
export function traceRank(r, keys, w) {
  const top = r.scored[0]; if (!top) return '';
  const c = contributions(top, keys, w);
  const steps = keys.map(k => {
    const v = MEASURES[k].get(top), vals = r.sorted[k], below = vals.filter(x => x < v).length, equal = vals.filter(x => x === v).length;
    return { label: `${MEASURES[k].label} (w ${w[k]})`, work: ok(v) ? `value ${n1(v)} ${MEASURES[k].unit}; ${below} of ${vals.length} qualifying lower, ${equal} equal → (${below} + ${equal}/2) ÷ ${vals.length}${MEASURES[k].dir < 0 ? ', reversed (lower is better)' : ''}; points = ${w[k]} × P ÷ weight used` : 'not held: drops out of numerator and denominator', value: top.parts[k] == null ? '—' : `P${top.parts[k].toFixed(1)} → ${c.find(x => x.key === k).points.toFixed(2)}` };
  });
  steps.push({ label: 'Score', work: `Σ points; weight used ${c.filter(x => x.pct != null).reduce((t, x) => t + x.weight, 0)} of ${keys.reduce((t, k) => t + w[k], 0)} (coverage ${(100 * top.coverage).toFixed(0)}%)`, value: top.score.toFixed(2) });
  const k0 = keys.find(k => ok(MEASURES[k].get(top))) || keys[0], v0 = MEASURES[k0].get(top), vals = r.sorted[k0];
  const recount = ok(v0) ? (() => { let lo = 0, eq = 0; for (const x of vals) { if (x < v0) lo++; else if (x === v0) eq++; } const p = ((lo + eq / 2) / vals.length) * 100; return MEASURES[k0].dir > 0 ? p : 100 - p; })() : null;
  return trace({
    id: 'm-rank', title: `Score of the top bus: ${top.node.name}`,
    formula: 'P_k = (buses below + half of ties) ÷ qualifying buses × 100 (reversed where lower is better);  score = Σ_k w_k × P_k ÷ Σ_k w_k over criteria held;  < 60% of weight held → not ranked',
    inputs: [{ name: 'Qualifying buses', value: int(r.poolSize), source: 'derived' }, { name: 'Weights', value: keys.map(k => `${MEASURES[k].label} ${w[k]}`).join(', '), source: 'user', note: 'defaults: the live Studio profile for this technology' }],
    steps,
    result: { label: 'Score', value: `${top.score.toFixed(1)} / 100` },
    checks: [
      { label: `Independent recount of the ${MEASURES[k0].label.toLowerCase()} percentile`, a: recount, b: top.parts[k0], fmt: v => (ok(v) ? v.toFixed(2) : 'not held') },
      { label: 'Arithmetic re-check: Σ contributions = score', a: c.reduce((t, x) => t + (x.points ?? 0), 0), b: top.score, fmt: v => v.toFixed(3) },
    ],
    csv: { name: 'market-ranking.csv', meta: [['weights', JSON.stringify(Object.fromEntries(keys.map(k => [k, w[k]])))]], columns: ['rank', 'bus_id', 'name', 'zone', 'score', 'coverage', ...keys.flatMap(k => [`${k}_value`, `${k}_percentile`])], rows: () => r.scored.map((x, i) => [i + 1, x.node.bus_id, x.node.name, x.node.zone, x.score, x.coverage, ...keys.flatMap(k => [MEASURES[k].get(x), x.parts[k]])]) },
  });
}

/** Rank: the discrimination statement. */
export function traceWeights(r, d, keys, w) {
  if (!r.scored.length) return '';
  const sc = r.scored.map(x => x.score).sort((a, b) => a - b);
  const at = q => { const pos = (sc.length - 1) * q, lo = Math.floor(pos); return sc[lo] + (sc[Math.ceil(pos)] - sc[lo]) * (pos - lo); };
  return trace({
    id: 'm-weights', title: 'Does this weighting separate the candidates?',
    formula: 'spread = P95(score) − P5(score);  ≥ 20 separates clearly, ≥ 6 separates but not sharply, < 6 does not separate;  a criterion is flat when its P10 = P90 among qualifying buses',
    inputs: [{ name: 'Scored buses', value: int(sc.length), source: 'derived' }, { name: 'Weighted criteria', value: String(keys.length), source: 'user' }],
    steps: [
      { label: 'P5 of scores', work: `linear interpolation at position ${((sc.length - 1) * 0.05).toFixed(2)} of ${sc.length}`, value: n2(d.p5) },
      { label: 'P95 of scores', work: `position ${((sc.length - 1) * 0.95).toFixed(2)}`, value: n2(d.p95) },
      { label: 'Spread', work: `${n2(d.p95)} − ${n2(d.p5)}`, value: n2(d.spread) },
      { label: 'Within 2 points of the top', work: `scores ≥ ${n2(d.top)} − 2`, value: int(d.within2) },
      { label: 'Flat criteria', work: d.flat.length ? d.flat.map(k => `${MEASURES[k].label}: P10 = P90 = ${n2(quantile(r.sorted[k], 0.1))}`).join('; ') : 'none', value: `${d.flatWeight} of ${d.totalWeight} weight` },
    ],
    result: { label: 'Verdict', value: d.verdict },
    check: { label: 'Arithmetic re-check: spread recomputed from an independently sorted score list', a: at(0.95) - at(0.05), b: d.spread, fmt: n2 },
    csv: { name: 'market-score-distribution.csv', columns: ['rank', 'bus_id', 'score'], rows: r.scored.map((x, i) => [i + 1, x.node.bus_id, x.score]) },
  });
}

/** Rank: sensitivity of the top 10. */
export function traceSens(sens, r, keys, w) {
  if (!sens.length) return '';
  const base = sens[0].base;
  return trace({
    id: 'm-sens', title: 'Sensitivity of the top 10',
    formula: 'overlap = |top10(weights) ∩ top10(weights with w_k dropped, halved or doubled)|',
    inputs: [{ name: 'Today\'s top 10', value: r.scored.slice(0, 10).map(x => x.node.bus_id).join(', '), source: 'derived' }],
    steps: sens.map(s => ({ label: MEASURES[s.key].label, work: `weight ${w[s.key]} → 0 / ${w[s.key] / 2} / ${w[s.key] * 2}`, value: `${s.dropped ?? '—'} / ${s.halved} / ${s.doubled} of ${s.base}` })),
    result: { label: 'Least stable criterion', value: (() => { const m = sens.slice().sort((a, b) => (a.dropped ?? 99) - (b.dropped ?? 99))[0]; return `${MEASURES[m.key].label} (${m.dropped ?? '—'} of ${base} stay)`; })() },
    check: { label: 'Consistency check: the base top 10 has 10 members (or all qualifying buses if fewer)', a: base, b: Math.min(10, r.scored.length), fmt: int },
    csv: { name: 'market-sensitivity.csv', columns: ['criterion', 'weight', 'kept_if_dropped', 'kept_if_halved', 'kept_if_doubled', 'base'], rows: sens.map(s => [s.key, w[s.key], s.dropped, s.halved, s.doubled, s.base]) },
  });
}

/** Size: the qualifying count at each size, consistent with Find at the request. */
export function traceSize(sw, reqMW, metAtReq) {
  const at = sw.find(s => s.size === reqMW);
  return trace({
    id: 'm-size', title: 'Qualifying buses by size',
    formula: 'For each size S: re-run the full screen with export (and, for storage, charge) = S; count meets / unknown / does not meet',
    inputs: [{ name: 'Sizes', value: sw.map(s => s.size).join(', ') + ' MW', source: 'user' }],
    steps: sw.map(s => ({ label: `${s.size} MW`, work: `${int(s.met)} meet · ${int(s.unknown)} unknown · ${int(s.unmet)} do not meet`, value: int(s.met) })),
    result: { label: 'Meet at the request', value: at ? int(at.met) : '—' },
    ...(at ? { check: { label: 'Consistency check: sweep at the request size = Find locations count', a: at.met, b: metAtReq, fmt: int } } : { notes: ['No check possible: the request size is 0 MW, so it is not in the sweep.'] }),
    csv: { name: 'market-size-sweep.csv', columns: ['size_mw', 'meet', 'unknown', 'do_not_meet'], rows: sw.map(s => [s.size, s.met, s.unknown, s.unmet]) },
  });
}

/** Size: margin distribution, largest qualifying size and the flips. */
export function traceFlips(p, sizes, iR, fragile, near, margins, ev) {
  const inScope = ev.filter(e => e.status !== 'excluded').length, noMargin = inScope - margins.length;
  const nextMet = iR >= 0 && iR < sizes.length - 1 ? p.sweep[iR + 1].met : null;
  const B = [...p.buses.values()], byMax = sizes.map(s => B.filter(b => b.maxMet === s).length);
  return trace({
    id: 'm-flips', title: 'Margins, breakpoints and flips',
    formula: 'margin = min over required cases (limit − size);  largest qualifying size = max{S : status(S) = meets};  fragile = meets at R and not at the next size;  near miss = fails at R and meets one size down',
    inputs: [{ name: 'Request R', value: iR >= 0 ? `${sizes[iR]} MW` : 'not in the sweep', source: 'user' }, { name: 'Buses in scope', value: int(inScope), source: 'derived' }],
    steps: [
      { label: 'Buses with a margin', work: `${int(inScope)} in scope − ${int(noMargin)} with a case not held`, value: int(margins.length) },
      { label: 'Short at R', work: 'margin < 0', value: int(margins.filter(v => v < 0).length) },
      { label: 'Room at R', work: 'margin ≥ 0', value: int(margins.filter(v => v >= 0).length) },
      ...sizes.map((s, i) => ({ label: `Largest met = ${s} MW`, work: 'buses whose last qualifying step is this size', value: int(byMax[i]) })),
      { label: 'Fragile at R', work: iR >= 0 && nextMet != null ? `meet at ${sizes[iR]} MW, not at ${sizes[iR + 1]} MW` : 'no larger step', value: int(fragile.length) },
      { label: 'Near misses at R', work: iR > 0 ? `fail at ${sizes[iR]} MW, meet at ${sizes[iR - 1]} MW` : 'no smaller step', value: int(near.length) },
    ],
    result: { label: 'Fragile · near misses', value: `${int(fragile.length)} · ${int(near.length)}` },
    checks: [
      ...(nextMet != null ? [{ label: 'Consistency check: fragile = meets at R − meets at the next size (a qualifying bus holds every case, so it can only turn into "does not meet")', a: fragile.length, b: p.sweep[iR].met - nextMet, fmt: int }] : []),
      { label: 'Partition: Σ buses by largest qualifying size = buses that meet at the smallest size', a: byMax.reduce((a, b) => a + b, 0), b: p.sweep[0].met, fmt: int },
    ],
    csv: { name: 'market-size-profile.csv', columns: ['bus_id', 'name', 'zone', ...sizes.map(s => `status_${s}mw`), ...sizes.map(s => `margin_${s}mw`), 'largest_met_mw'], rows: () => B.map(b => [b.node.bus_id, b.node.name, b.node.zone, ...b.statuses, ...b.margins, b.maxMet]) },
  });
}

/** Regions: shares per zone; populations add up to the buses in scope. */
export function traceRegions(rg, inScope) {
  return trace({
    id: 'm-regions', title: 'Zone shares',
    formula: 'Share meeting = buses meeting ÷ buses in the zone;  medians over the stated population',
    inputs: [{ name: 'Buses in scope', value: int(inScope), source: 'derived' }],
    steps: rg.map(z => ({ label: z.zone, work: `${int(z.met)} of ${int(z.buses)} meet; median margin ${fmt.mw(z.medianMargin)}`, value: ok(z.metShare) ? `${(100 * z.metShare).toFixed(0)}%` : '—' })),
    result: { label: 'Zones', value: int(rg.length) },
    check: { label: 'Partition: Σ zone populations = buses in scope', a: rg.reduce((t, z) => t + z.buses, 0), b: inScope, fmt: int },
    csv: { name: 'market-zones.csv', columns: ['zone', 'buses', 'meet', 'share_meet', 'share_unknown', 'median_margin_mw', 'median_price_2025_full_year', 'buses_full_2025'], rows: rg.map(z => [z.zone, z.buses, z.met, z.metShare, z.unknownShare, z.medianMargin, z.medianPrice, z.priceHeld]) },
  });
}

/** Regions: zone basis against the hub. */
export function traceBasis(Z, zy) {
  const zones = ['ME', 'NH', 'VT', 'NEMA', 'WCMA', 'SEMA', 'RI', 'CT'], hub = zy('HUB', 'RT', 2025);
  if (!hub) return '';
  const rows = zones.map(z => zy(z, 'RT', 2025)).filter(Boolean);
  const worst = rows.slice().sort((a, b) => Math.abs(b.bhub) - Math.abs(a.bhub))[0];
  return trace({
    id: 'm-basis', title: 'Zone basis against the hub, RT 2025',
    formula: 'basis_z = mean over hours both nodes hold of (LMP_zone,h − LMP_hub,h);  each node averaged per timestamp first',
    inputs: [{ name: 'Hub', value: Z.hub, source: 'measured', note: `${int(hub.hours)} settled RT hours, mean ${fmt.price(hub.lmp)}` }, { name: 'Zone nodes', value: Object.values(Z.zonePnode).join(', '), source: 'measured' }],
    steps: rows.map(r => ({ label: r.zone, work: `mean(zone) ${fmt.price(r.lmp)} vs mean(hub) ${fmt.price(hub.lmp)}; ${int(r.matched)} matched hours`, value: `${r.bhub >= 0 ? '+' : '−'}$${Math.abs(r.bhub).toFixed(3)}` })),
    result: { label: 'Widest', value: worst ? `${worst.zone} ${worst.bhub >= 0 ? '+' : '−'}$${Math.abs(worst.bhub).toFixed(2)}` : '—' },
    check: worst ? { label: `Consistency check (${worst.zone}): with the same ${int(worst.matched)} hours on both nodes, mean(zone − hub) = mean(zone) − mean(hub)`, a: worst.bhub, b: worst.lmp - hub.lmp, atol: 0.005, fmt: v => v.toFixed(4) } : undefined,
    csv: { name: 'market-zone-years.csv', meta: [['source', Z.source]], columns: ['zone', 'market', 'year', 'hours', 'mean_lmp', 'energy', 'congestion', 'loss', 'p5', 'p95', 'std', 'neg_hours', 'hours_gt_200', 'basis_vs_hub', 'matched_hours'], rows: Z.years.map(r => [r.zone, r.market, r.y, r.hours, r.lmp, r.energy, r.cong, r.loss, r.p5, r.p95, r.std, r.neg, r.h200, r.bhub, r.matched]) },
  });
}

/** Regions: generation mix, checked against the Studio's copy from the older database. */
export function traceGenmix(SY, ST) {
  const y = 2025, g = SY.gen.filter(x => x.y === y), tot = g.reduce((t, x) => t + x.mwh, 0), hours = SY.genHours.find(h => h.y === y)?.hours;
  const gas = g.find(x => x.fuel === 'Natural Gas'), sGas = ST?.outlook.find(o => o.scenario === 'hist' && o.year === y && o.fuel === 'Natural Gas');
  return trace({
    id: 'm-genmix', title: `Generation by fuel, ${y}`,
    formula: 'MWh_f = Σ_hours mean(MW_f within the hour);  share_f = MWh_f ÷ Σ_f MWh_f',
    inputs: [{ name: 'Hours with data', value: int(hours), source: 'measured', note: 'fact_genfuel_hourly snapshots, region ISONE' }],
    steps: g.slice().sort((a, b) => b.mwh - a.mwh).map(x => ({ label: x.fuel, work: `${int(x.hours)} hours reported; ${n1(x.mwh / 1e6)} TWh ÷ ${n1(tot / 1e6)} TWh`, value: `${(100 * x.mwh / tot).toFixed(1)}%` })),
    result: { label: 'Total metered', value: `${n1(tot / 1e6)} TWh` },
    ...(sGas ? { check: { label: 'Independent copy: natural gas MWh 2025, unified vs the Studio copy (GridSense_one.duckdb)', a: gas?.mwh, b: sGas.mwh, tol: 1e-4, fmt: v => int(v) } } : { notes: ['No check possible: the Studio copy is not loaded.'] }),
    csv: { name: 'market-genmix.csv', meta: [['rule', SY.rules.gen]], columns: ['year', 'fuel', 'mwh', 'hours_reported'], rows: SY.gen.map(x => [x.y, x.fuel, x.mwh, x.hours]) },
  });
}

/** Regions: system load and forecast accuracy. */
export function traceLoad(SY) {
  const l = SY.load.find(x => x.y === 2025), p = SY.load.find(x => x.y === 2024), f = SY.forecast.find(x => x.y === 2025);
  if (!l) return '';
  return trace({
    id: 'm-load', title: 'System load 2025',
    formula: 'energy = Σ_h load_h;  mean = energy ÷ hours;  growth = energy_2025 ÷ energy_2024 − 1 (full years only);  MAPE = mean_h |forecast_h − load_h| ÷ load_h',
    inputs: [{ name: 'Hours held 2025', value: int(l.hours), source: 'measured', note: 'fact_load_hourly zone SYSTEM' }, { name: 'Forecast hours matched', value: int(f?.matched), source: 'measured', note: 'fact_load_forecast, day-ahead posting' }],
    steps: [
      { label: 'Energy', work: `Σ of ${int(l.hours)} hourly MW`, value: `${n1(l.mwh / 1e6)} TWh` },
      { label: 'Mean load', work: `${n1(l.mwh)} MWh ÷ ${int(l.hours)} h`, value: `${int(l.mean_mw)} MW` },
      { label: 'Peak', work: String(l.peak_ts).slice(0, 16).replace('T', ' '), value: `${int(l.peak_mw)} MW` },
      ...(p ? [{ label: 'Growth vs 2024', work: `${n1(l.mwh / 1e6)} ÷ ${n1(p.mwh / 1e6)} − 1`, value: `${(100 * (l.mwh / p.mwh - 1)).toFixed(2)}%` }] : []),
      ...(f ? [{ label: 'Forecast MAPE', work: `${int(f.matched)} matched hours`, value: `${f.mape.toFixed(2)}%` }, { label: 'Forecast bias', work: 'mean(forecast − actual)', value: `${int(f.bias_mw)} MW` }] : []),
    ],
    result: { label: 'Energy 2025', value: `${n1(l.mwh / 1e6)} TWh` },
    check: { label: 'Arithmetic re-check: mean × hours = energy', a: l.mean_mw * l.hours, b: l.mwh, tol: 1e-9, fmt: v => int(v) },
    csv: { name: 'market-load.csv', meta: [['rule', SY.rules.load]], columns: ['year', 'hours', 'energy_mwh', 'mean_mw', 'peak_mw', 'peak_hour', 'forecast_mape_pct', 'forecast_bias_mw'], rows: SY.load.map(x => { const q = SY.forecast.find(y => y.y === x.y); return [x.y, x.hours, x.mwh, x.mean_mw, x.peak_mw, x.peak_ts, q?.mape, q?.bias_mw]; }) },
  });
}

/** Regions: supply by zone. */
export function traceSupply(SU) {
  const op = SU.generators.filter(g => g.status === 'Operating'), zoned = op.filter(g => g.zone), total = op.reduce((t, g) => t + (g.cap_mw || 0), 0);
  const zones = [...new Set(zoned.map(g => g.zone))].sort();
  const q = SU.queue, qz = q.filter(x => x.zone);
  return trace({
    id: 'm-supply', title: 'Operating capacity, retirements and queue by zone',
    formula: 'capacity_z = Σ max_capacity_mw of operating units whose bus sits in zone z;  queue_z = Σ max_mw of requests whose nearest bus (≤ 25 km) sits in z',
    inputs: [{ name: 'Operating units', value: int(op.reduce((t, g) => t + g.units, 0)), source: 'measured', note: 'dim_generator' }, { name: 'Queue requests', value: int(q.length), source: 'measured', note: `dim_queue; ${int(qz.length)} attributed to a zone` }],
    steps: zones.map(z => ({ label: z, work: `${int(zoned.filter(g => g.zone === z).reduce((t, g) => t + g.units, 0))} units`, value: `${int(zoned.filter(g => g.zone === z).reduce((t, g) => t + (g.cap_mw || 0), 0))} MW` })),
    result: { label: 'Operating capacity', value: `${int(total)} MW` },
    checks: [
      { label: 'Partition: Σ zone capacity + capacity at buses without a zone = all operating capacity', a: zones.reduce((t, z) => t + zoned.filter(g => g.zone === z).reduce((s, g) => s + (g.cap_mw || 0), 0), 0) + op.filter(g => !g.zone).reduce((t, g) => t + (g.cap_mw || 0), 0), b: total, tol: 1e-9, fmt: v => int(v) },
      { label: 'Partition: attributed + unattributed queue MW = all queue MW', a: qz.reduce((t, x) => t + (x.max_mw || 0), 0) + q.filter(x => !x.zone).reduce((t, x) => t + (x.max_mw || 0), 0), b: q.reduce((t, x) => t + (x.max_mw || 0), 0), tol: 1e-9, fmt: v => int(v) },
    ],
    csv: { name: 'market-queue-attribution.csv', meta: [['rule', SU.rules.queueZone]], columns: ['queue_position', 'poi', 'type', 'status', 'max_mw', 'state', 'nearest_bus', 'distance_km', 'zone'], rows: q.map(x => [x.queue_position, x.poi_name, x.resource_type, x.status, x.max_mw, x.state, x.nearBus, x.nearKm, x.zone]) },
  });
}

/** Regions: network cost per kW by zone, checked against the Grid page's own size sweep for the candidate. */
export function traceCost(cost, study, S) {
  const zones = [...new Set(cost.map(c => c.zone))].sort();
  const med = a => quantile(a.filter(ok), 0.5);
  const me = cost.find(c => String(c.bus) === String(S.nodeId));
  const g = me ? gridSizeSweep(study.gridOf(me.bus), me.bus, S.tech, [100])[0] : null;
  return trace({
    id: 'm-cost', title: `Network cost per kW by zone (${S.tech})`,
    formula: '$/kW = step cost at S ($M, facilities overloaded below S, Grid rules) × 1,000 ÷ S;  zone figure = median over buses priced or true zero',
    inputs: [{ name: 'Sizes', value: '100 and 250 MW', source: 'user' }, { name: 'Buses', value: int(cost.length), source: 'measured' }],
    steps: zones.map(z => { const cs = cost.filter(c => c.zone === z); return { label: z, work: `${int(cs.filter(c => ok(c[100])).length)} of ${int(cs.length)} buses priced at 100 MW; ${int(cs.filter(c => ok(c[250])).length)} at 250 MW`, value: `${ok(med(cs.map(c => c[100]))) ? '$' + int(med(cs.map(c => c[100]))) : 'not held'} · ${ok(med(cs.map(c => c[250]))) ? '$' + int(med(cs.map(c => c[250]))) : 'not held'}` }; }),
    result: { label: 'Buses priced at 100 MW', value: int(cost.filter(c => ok(c[100])).length) },
    ...(me && ok(me[100]) && g ? { check: { label: 'Independent path: the candidate bus at 100 MW = the Grid page\'s size sweep (gridrules.sizeSweep)', a: me[100], b: g.perKw, tol: 1e-9, fmt: v => (ok(v) ? `$${v.toFixed(2)}` : 'not held') } } : { notes: [`No check possible: the candidate bus has no priced or true-zero cost at 100 MW (${me ? me.st100 : 'not in the screen'}).`] }),
    csv: { name: `market-network-cost-${S.tech}.csv`, columns: ['bus_id', 'zone', 'usd_per_kw_100', 'status_100', 'usd_per_kw_250', 'status_250'], rows: () => cost.map(c => [c.bus, c.zone, c[100], c.st100, c[250], c.st250]) },
  });
}

/** v5 upgrade-cost screen: each in-scope bus's Grid cost at the request size against the ceiling. */
export function traceUpgrade(ev, r, S) {
  const inScope = ev.filter(e => e.status !== 'excluded' && e.upgrade);
  const by = {}; for (const e of inScope) { const k = `${e.upgrade.kind} → ${e.upgrade.status}`; by[k] = (by[k] || 0) + 1; }
  const cand = ev.find(e => String(e.node.bus_id) === String(S.nodeId));
  const c = cand?.cost, sum = c?.items ? c.items.filter(i => i.cost != null).reduce((t, i) => t + i.cost, 0) : null;
  return trace({
    id: 'm-upgrade', title: `Upgrade-cost screen (≤ $${r.maxUpgradeMusd}M)`,
    formula: 'cost = Grid stepCostService at the request size (same engine as Grid › Upgrade cost);  pass = "No upgrades indicated" (envelope only, never $0) or true $0 or priced total ≤ X;  fail = priced part > X;  unknown = partly priced / lower bound with the priced part ≤ X (never passes)',
    inputs: [{ name: 'Ceiling X', value: `$${r.maxUpgradeMusd}M`, source: 'user' }, { name: 'Request', value: `${r.tech} · export ${r.exportMW} MW${r.importMW ? ` · import ${r.importMW} MW` : ''}`, source: 'user' },
      { name: 'Facility costs', value: 'dim_transmission_upgrade / fix_cost_musd on fact_limiting_element', source: 'measured', note: 'unified DB; unpriced facilities stay unpriced' }],
    steps: [...Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ label: k, work: 'buses in scope', value: int(n) })),
      ...(c ? [{ label: `Candidate ${cand.node.name}`, work: `${c.status} · ${c.items?.length || 0} facilities, ${c.unpriced || 0} unpriced`, value: cand.upgrade?.label || 'not held' }] : [])],
    result: { label: 'Buses passing the cost screen', value: int(inScope.filter(e => e.upgrade.status === 'pass').length) },
    ...(c && ok(c.total) && c.items?.length ? { check: { label: 'Arithmetic re-check: candidate total = Σ priced facility costs', a: sum, b: c.total, tol: 1e-9, fmt: v => (ok(v) ? `$${v.toFixed(3)}M` : 'not held') } } : { notes: ['No check possible: the candidate bus has no priced facility at this size (nothing to re-add).'] }),
    csv: { name: 'market-upgrade-screen.csv', meta: [['ceiling_musd', r.maxUpgradeMusd], ['note', 'value blank = not held (no upgrades indicated is not $0)']], columns: ['bus_id', 'name', 'zone', 'cost_status', 'priced_total_musd', 'facilities', 'unpriced', 'screen'], rows: inScope.map(e => [e.node.bus_id, e.node.name, e.node.zone, e.cost?.status ?? null, e.upgrade.value, e.cost?.items?.length ?? null, e.cost?.unpriced ?? null, e.upgrade.status]) },
  });
}

/** v5 curtailment screen: energy-weighted curtailed share of the PCR run's modelled resources near each bus. */
export function traceCurtail(study, S, run, type, zrows, maxPct) {
  const n = study.nodes.find(x => String(x.bus_id) === String(S.nodeId)), v = n?.curt?.[run]?.[type];
  const rows = study.curtail?.rows?.filter(x => x.run === run && x.type === type && v?.ids?.includes(x.bidder)) || [];
  const off = rows.reduce((t, x) => t + (x.mwh_offered || 0), 0), cur = rows.reduce((t, x) => t + (x.mwh_curtailed || 0), 0);
  const iso = zrows.find(z => z.zone === 'ISO' && z.type === type);
  return trace({
    id: 'm-curtail', title: `Modelled ${type.toLowerCase()} curtailment near ${n?.name || 'the candidate'} (${run})`,
    formula: 'share = Σ curtailed MWh ÷ Σ offered MWh over the run\'s modelled resources of this type within 25 km;  curtailed = Σ hours (max bid − dispatch): offered energy the run did not dispatch;  energy-weighted, never an average of shares',
    inputs: [{ name: 'Run', value: run, source: 'user' }, { name: 'Resource type', value: type, source: 'rule', note: 'solar and hybrid read Solar; wind reads onshore Wind; storage and data centres not applicable' },
      { name: 'Resources', value: `${int(v?.n ?? 0)} within ${v?.radiusKm ?? 25} km`, source: 'measured', note: 'unified fact_pcr_unit_hourly × dim_pcr_resource (plan/extract_market_curtail.py)' },
      ...(ok(maxPct) ? [{ name: 'Screen', value: `≤ ${maxPct}%`, source: 'user' }] : [])],
    steps: rows.slice(0, 12).map(x => ({ label: x.name, work: `${n1(x.mwh_curtailed)} of ${n1(x.mwh_offered)} MWh · ${int(x.h_curtailed)} h curtailed`, value: `${ok(x.mwh_offered) && x.mwh_offered ? (100 * (x.mwh_curtailed || 0) / x.mwh_offered).toFixed(2) : '—'}%` })),
    result: { label: 'Nearby curtailed share', value: v ? `${(100 * v.share).toFixed(2)}%` : 'not held (no modelled resource within 25 km)' },
    ...(v ? { check: { label: 'Arithmetic re-check: the share re-summed from the extract rows', a: off ? cur / off : null, b: v.share, tol: 1e-9, fmt: x => (ok(x) ? `${(100 * x).toFixed(3)}%` : 'not held') } } : { notes: ['No check possible: no modelled resource of this type lies within 25 km of the bus in this run.'] }),
    notes: [`ISO-wide ${type} in ${run}: ${iso && ok(iso.share) ? `${(100 * iso.share).toFixed(2)}% of ${n1(iso.mwhOffered / 1e6)} TWh offered` : 'not held'}.`, 'A modelled run outcome near the bus, not a curtailment forecast for this project; the vendor curtailment ramps stay excluded.'],
    csv: { name: `market-curtailment-${run}-${type}.csv`, columns: ['bidder', 'name', 'zone', 'mwh_offered', 'mwh_curtailed', 'h_curtailed', 'h_curtailed_nonpos'], rows: rows.map(x => [x.bidder, x.name, x.zone, x.mwh_offered, x.mwh_curtailed, x.h_curtailed, x.h_curtailed_nonpos]) },
  });
}
