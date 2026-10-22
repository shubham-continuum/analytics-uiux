// Calculation traces for Decision. Checks are labelled for what they are: the energy-revenue loop and the scenario
// recount are arithmetic re-checks (same prices, same limit); the export limit is checked independently against
// the raw grid rows.
import { trace } from '../trace.js';
import { analyzePrices, dailySpreads } from '../prices.js';
import { clearSky } from '../solar.js';
import { coreBasis, describe, fmt } from '../basis.js';
import { costText, ownExportLimit, fleetShapeFor } from '../decisioncore.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const usd = v => (ok(v) ? `$${Math.round(v).toLocaleString('en-US')}` : 'not held');

/** Own energy-revenue loop: nameplate cap → losses → export cap, Σ MWh × price, annualised on observed hours. */
function ownRevenue(data, node, basis, p, cap, shape = null) {
  if (!['solar', 'wind', 'hybrid'].includes(p.tech)) return null; // hybrid: the PV side, solar method at the export size
  const res = analyzePrices(data, coreBasis({ ...basis, nodeId: String(node.id) })); if (!res.summary) return null;
  const rows = res.rows, H = rows.reduce((t, r) => t + r.dtHours, 0);
  // Wind: the fleet shape when the revenue used it (re-read here from the same profile), else the flat proxy.
  const fs = p.tech === 'wind' && shape === 'fleet' && p.fleet ? fleetShapeFor(rows, p.fleet, 'wind') : null;
  if (p.tech === 'wind' && shape === 'fleet' && !fs) return null;
  const g = rows.map((r, i) => (p.tech === 'wind' ? (fs ? fs.shape[i] : 1) : clearSky(r.timestamp, node.latitude, node.longitude) ?? 0));
  const m = g.reduce((t, v, i) => t + v * rows[i].dtHours, 0) / H;
  let rev = 0;
  for (let i = 0; i < rows.length; i++) { const mw = Math.min(ok(cap) ? cap : Infinity, Math.min(p.exportMW, m ? (p.exportMW * p.cf * g[i]) / m : 0) * (1 - p.lossPct / 100)); rev += mw * rows[i].dtHours * rows[i].price; }
  return rev / (H / 8760);
}

/** Compare: every option's values with their home dashboards, gate by gate. */
export function traceCompare(data, S, ms, gs, p, lossText = `${p.lossPct}%`) {
  const steps = [];
  ms.forEach((m, i) => {
    steps.push({ label: `${m.node.name}: price node`, work: 'Pricing tier from the bus-to-node mapping', value: m.tier || 'not held' });
    steps.push({ label: `${m.node.name}: export limit`, work: `${m.sent ? 'Sent from Grid' : 'Grid rules'} · ${m.exportStatus}${m.envelopeOnly?.length ? ` · envelope only (vendor-asserted) for ${m.envelopeOnly.join(', ')}` : ''}`, value: ok(m.exportLimit) ? fmt.mw(m.exportLimit) : 'not held' });
    steps.push({ label: `${m.node.name}: upgrade cost`, work: `Grid cost engine · ${m.cost.status}${m.cost.unverified?.length ? ` · unverified for ${m.cost.unverified.map(u => u.label).join(', ')}` : ''}`, value: costText(m.cost) });
    steps.push({ label: `${m.node.name}: energy revenue`, work: ok(m.revenue.value) ? `Economics method on ${describe(S.basis)}${m.revenue.clippedAt ? `, clipped at ${fmt.mw(m.revenue.clippedAt)}` : ''}` : (m.revenue.reason || 'not held'), value: usd(m.revenue.value) });
    steps.push({ label: `${m.node.name}: gates`, work: gs[i].map(g => `${g.gate} ${g.verdict}`).join(' · '), value: gs[i].every(g => g.verdict === 'Pass') ? 'all pass' : `${gs[i].filter(g => g.verdict !== 'Pass').length} not passed` });
  });
  // Independent: the export limit recomputed straight from the raw grid rows (not via the Grid rules module).
  // Skipped where the limit was sent from Grid (the sent value is the record) or no export is requested.
  const limitChecks = p.tech === 'datacenter' ? [] : ms.filter(m => !m.sent && ok(m.exportLimit)).map(m => ({ label: `Independent check: ${m.node.name}'s export limit recomputed from the raw grid rows (lowest positive transfer on facilities not already overloaded; envelope where no facility list)`, a: ownExportLimit(data.grid, m.node.id), b: m.exportLimit, tol: 1e-9, fmt: v => fmt.mw(v) }));
  const revChecks = ms.filter(m => ok(m.revenue.value)).map(m => ({ label: `Arithmetic re-check (same prices and limit): ${m.node.name}'s energy revenue re-summed hour by hour`, a: ownRevenue(data, m.node, S.basis, p, m.exportLimit, m.revenue.shape), b: m.revenue.value, tol: 1e-9, fmt: usd }));
  const checks = [...limitChecks, ...revChecks];
  return trace({
    id: 'd-compare', title: 'Options side by side',
    formula: 'Every value is read from its home dashboard (Grid limits and cost, Economics revenue method, Queue matching, Land screen);  gate = Fail on a known breach, Hold on anything unknown, Pass only when all is known and none breaches;  no combined score',
    inputs: [{ name: 'Options', value: ms.map(m => `${m.node.name} (${m.node.id})`).join(', '), source: 'user' },
      { name: 'Common basis', value: `${p.tech}, ${fmt.mw(p.exportMW)} · ${describe(S.basis)}`, source: 'user' },
      { name: 'Capacity factor, losses', value: `${(100 * p.cf).toFixed(1)}%, ${lossText}`, source: 'assumption', note: 'From Economics' }],
    steps,
    result: { label: 'Options passing every gate', value: `${gs.filter(g => g.every(x => x.verdict === 'Pass')).length} of ${ms.length}` },
    checks,
    notes: [...(ms.some(m => m.sent) ? ['Export limits sent from Grid are the recorded values; the independent limit check is not applied to them.'] : []),
      ...(checks.length ? [] : ['No check possible: no export limit or energy revenue is held on this basis (storage and data centres are valued in Economics).'])],
  });
}

/** Stress: which option leads in each comparable scenario, recounted (arithmetic re-check), plus independent price checks. */
export function traceStress(opts, table, st, leaders, base, { metric = 'revenue', fmtV = usd, lowerBetter = false, checks = [] } = {}) {
  // Own recount: a scenario with any missing value is skipped, as on the page.
  const own = table.map(r => { if (r.vals.some(v => !ok(v))) return null; let b = 0; r.vals.forEach((v, i) => { if (lowerBetter ? v < r.vals[b] : v > r.vals[b]) b = i; }); return b; });
  const otherOwn = own[0] == null ? 0 : own.slice(1).filter(l => l != null && l !== own[0]).length, other = st.other;
  const what = { revenue: "energy revenue (Economics method: CF-scaled shape, losses, export clipping)", tb4: 'TB4 spread (mean over complete days of top-4 minus bottom-4 hourly prices)', price: 'average price (observed-hour weighted)' }[metric];
  const unit = { revenue: 'usd_yr', tb4: 'usd_mwh', price: 'usd_mwh' }[metric];
  return trace({
    id: 'd-stress', title: 'Leader by price scenario',
    formula: `For each scenario, recompute every option's ${what} on that scenario's prices only;  leader = ${lowerBetter ? 'lowest' : 'highest'} value;  a scenario where any option has no value is not comparable and not counted;  counts are not probabilities`,
    inputs: [{ name: 'Scenarios', value: `${table.length - 1} (+ applied basis), ${st.comparable} comparable`, source: 'derived', note: 'Complete years held for every option, plus forecast runs held for every option except the 5-yr run' },
      { name: 'Hourly prices', value: opts.map(o => o.name).join(', '), source: 'measured', note: 'fact_lmp_hourly (settled) and fact_fcst_lmp_hourly (runs), unified DB' }],
    steps: table.map((r, i) => ({ label: r.sc.label, work: r.vals.map((v, j) => `${opts[j].name} ${fmtV(v)}`).join(' · '), value: leaders[i] != null ? opts[leaders[i]].name : `— (${st.rows[i].reason || 'no value'})` })),
    result: { label: 'Comparable scenarios led by another option', value: `${other} of ${st.comparable}` },
    checks: [{ label: 'Arithmetic re-check: leaders recounted from the same values', a: otherOwn, b: other, atol: 0, fmt: v => `${v}` }, ...checks],
    notes: checks.length ? [] : ['The independent price checks need the settled-year summaries from the database; they appear once those load.'],
    csv: { name: 'decision-stress.csv', meta: [['options', opts.map(o => `${o.name} (${o.id})`).join('; ')], ['metric', what], ['note', 'counts are not probabilities; blank = not held']], columns: ['scenario', ...opts.map(o => `${o.name}_${unit}`), 'leader', 'comparability'], rows: table.map((r, i) => [r.sc.label, ...r.vals, leaders[i] != null ? opts[leaders[i]].name : null, st.rows[i].reason || 'comparable']) },
  });
}

/** Stress ranges: min / max / worst against the applied basis, recomputed by sorting (arithmetic re-check). */
export function traceRange(names, table, ranges, { fmtV = usd, lowerBetter = false } = {}) {
  const steps = ranges.map((r, j) => ({ label: names[j], work: ok(r.min) ? `held in ${r.n} of ${table.length} scenarios · min ${fmtV(r.min)} (${r.minLabel}) · max ${fmtV(r.max)} (${r.maxLabel}) · applied ${fmtV(r.applied)} · worst − applied = ${fmtV(r.worst)} − ${fmtV(r.applied)}` : 'no value in any scenario', value: ok(r.downsidePct) ? `${r.downsidePct >= 0 ? '+' : ''}${r.downsidePct.toFixed(1)}%` : 'not held' }));
  const checks = ranges.map((r, j) => {
    const vs = table.map(t => t.vals[j]).filter(ok).sort((a, b) => a - b);
    return { label: `Arithmetic re-check: ${names[j]} spread from the sorted column`, a: vs.length ? vs.at(-1) - vs[0] : null, b: r.spread, tol: 1e-9, fmt: fmtV };
  }).filter(c => ok(c.b));
  const widest = ranges.map((r, j) => ({ j, s: r.spread })).filter(x => ok(x.s)).sort((a, b) => b.s - a.s)[0];
  return trace({
    id: 'd-range', title: 'Sensitivity range and downside per option',
    formula: `range = [min, max] of the option's value over every scenario it holds;  spread = max − min;  worst = ${lowerBetter ? 'max (lower is better)' : 'min'};  downside = (worst − applied) ÷ |applied| × 100`,
    inputs: [{ name: 'Scenario table', value: `${table.length} rows × ${names.length} options`, source: 'derived', note: 'The same cells as the Leader-by-scenario calculation' }],
    steps, result: { label: 'Widest spread', value: widest ? `${names[widest.j]} ${fmtV(widest.s)}` : 'not held' },
    checks, notes: checks.length ? [] : ['No check possible: no option holds a value in any scenario.'],
    csv: { name: 'decision-ranges.csv', meta: [['note', 'blank = not held; the ranges are not probabilities']], columns: ['option', 'scenarios_held', 'min', 'min_scenario', 'max', 'max_scenario', 'applied', 'worst', 'worst_scenario', 'downside', 'downside_pct'], rows: ranges.map((r, j) => [names[j], r.n, r.min, r.minLabel ?? null, r.max, r.maxLabel ?? null, r.applied, r.worst, r.worstLabel ?? null, r.downside, r.downsidePct]) },
  });
}

/** Market position: percentile among all buses; the mart values are checked independently against the hourly series. */
export function tracePosition(data, pos, ms, pop) {
  const names = ms.map(m => m.node.name), steps = [];
  pos.rows.forEach(r => r.cells.forEach((c, i) => steps.push({ label: `${names[i]}: ${r.label}`, work: ok(c.value) ? `${c.below} below + ½ × ${c.equal} equal of ${r.n} buses → 100 × (${c.below} + ${c.equal / 2}) ÷ ${r.n}` : 'value not held at this bus', value: ok(c.pct) ? `P${c.pct.toFixed(0)}` : 'not held' })));
  // Independent: the mart's 2025 RT mean and TB4 recomputed in the browser from the hourly facts of this bus.
  const checks = [];
  ms.forEach(m => {
    const b = { nodeId: String(m.node.id), mode: 'historical', market: 'RT', years: [pop.year], weighting: 'duration', weights: {}, strict: true, includePartial: false };
    const res = analyzePrices(data, coreBasis(b)); if (!res.summary) return;
    const mart = pop.ids.indexOf(String(m.node.id));
    if (mart < 0) return;
    const mv = pop.values.lmp_rt?.[mart];
    if (ok(mv)) checks.push({ label: `Independent check: ${m.node.name}'s ${pop.year} RT mean, mart_bus_year vs recomputed from the hourly series`, a: res.summary.mean, b: mv, tol: 1e-6, fmt: v => fmt.price(v) });
    const tv = pop.values.tb4?.[mart], sp = dailySpreads(res.rows, 4);
    if (ok(tv) && sp.length) checks.push({ label: `Independent check: ${m.node.name}'s ${pop.year} TB4, mart_bus_tb vs recomputed from the hourly series (${sp.length} complete days)`, a: sp.reduce((t, d) => t + d.spread, 0) / sp.length, b: tv, tol: 1e-6, fmt: v => fmt.price(v) });
  });
  return trace({
    id: 'd-position', title: 'Market position on the deciding measures',
    formula: 'percentile = 100 × (buses below + ½ × buses equal) ÷ buses holding the measure;  read in the stated direction;  no weights and no combined score',
    inputs: [{ name: 'Population', value: `${pop.ids.length.toLocaleString('en-US')} geolocated buses`, source: 'measured', note: `${pop.source}; ${pop.note}` },
      ...pos.rows.map(r => ({ name: r.label, value: `${r.n.toLocaleString('en-US')} buses hold it`, unit: r.unit, source: /headroom/.test(r.key) ? 'assumption' : 'measured', note: `${r.source} · ${r.higher ? 'higher' : 'lower'} is better · ${r.note || ''}` }))],
    steps, result: { label: 'Measures compared', value: `${pos.rows.length} × ${ms.length} options` },
    checks, notes: checks.length ? ['Headroom values are the vendor envelope (data_quality: vendor-asserted); they are positioned, not verified.'] : ['No check possible: no option holds a complete settled year to recompute the mart values from.'],
    csv: { name: 'decision-position.csv', meta: [['source', pop.source], ['note', 'percentile among buses holding the measure; blank = not held']], columns: ['measure', 'unit', 'direction', 'buses_holding', ...names.flatMap(n => [`${n}_value`, `${n}_percentile`])], rows: pos.rows.map(r => [r.label, r.unit, r.higher ? 'higher is better' : 'lower is better', r.n, ...r.cells.flatMap(c => [c.value, c.pct])]) },
  });
}

/** Shared limiting elements: per facility, per option; each option's lowest usable transfer equals its element limit. */
export function traceShared(sh, ms) {
  const names = ms.map(m => m.node.name);
  const checks = ms.map((m, i) => {
    const lims = (m.cases || []).filter(c => c.status !== 'Not requested' && c.element?.status === 'held').map(c => c.element.limit);
    return lims.length ? { label: `Consistency check: ${names[i]}'s lowest usable transfer over its facilities equals the lowest element limit of its requested cases (Grid rules)`, a: sh.minTransfer[i], b: Math.min(...lims), tol: 1e-9, fmt: v => fmt.mw(v) } : null;
  }).filter(Boolean);
  return trace({
    id: 'd-shared', title: 'Limiting elements shared across the options',
    formula: 'For each requested case, every monitored facility in the element study (fact_limiting_element);  per option: lowest positive transfer on non-pre-existing rows, highest |loading| without the transfer;  shared = named at two or more options',
    inputs: [{ name: 'Element rows', value: ms.map((m, i) => `${names[i]} ${sh.counts[i]} facilities`).join(' · '), source: 'measured', note: 'unified fact_limiting_element; shoulder export rows are mislabelled in the store and not read' }],
    steps: (sh.rows.length ? sh.rows : sh.all.slice(0, 12)).map(r => ({ label: r.facility, work: r.cells.map((c, i) => `${names[i]}: ${c ? `${c.pre ? 'pre-existing overload' : ok(c.transfer) ? `limit ${fmt.mw(c.transfer)}` : 'no usable transfer'}, loading ${ok(c.loading) ? c.loading.toFixed(1) + '%' : 'not held'}` : 'not in its study'}`).join(' · '), value: `${r.shared} option(s)` })),
    result: { label: 'Facilities shared by two or more options', value: String(sh.rows.length) },
    checks, notes: checks.length ? [] : ['No check possible: no option holds an element-study limit for a requested case.'],
    csv: { name: 'decision-shared-elements.csv', meta: [['note', 'transfer = lowest usable transfer (MW); blank = not in that option\'s study or not held']], columns: ['facility', 'options', ...names.flatMap(n => [`${n}_transfer_mw`, `${n}_loading_pct`, `${n}_dfax`, `${n}_pre_existing`])], rows: sh.all.map(r => [r.facility, r.shared, ...r.cells.flatMap(c => (c ? [c.transfer, c.loading, c.dfax, c.pre ? 'yes' : 'no'] : [null, null, null, null]))]) },
  });
}

/** Studio copy against the unified DB: a difference table, not a computation. */
export function traceStudio(names, notesPer, meta) {
  const steps = [];
  notesPer.forEach((ns, i) => (ns || []).filter(n => n.state !== 'same').forEach(n => steps.push({ label: `${names[i]}: ${n.label}`, work: `Studio copy ${n.studio ?? 'not held'} vs unified ${n.unified == null ? 'not held' : +n.unified.toFixed(4)}${n.note ? ` — ${n.note}` : ''}`, value: n.state })));
  const diff = notesPer.flat().filter(n => n && n.state === 'differs').length;
  return trace({
    id: 'd-studio', title: 'Studio copy against the unified database',
    formula: 'difference = Studio copy − unified value;  "same" when |difference| ≤ max(0.01, 0.5% of the unified value);  the unified value is always the one used',
    inputs: [{ name: 'Studio copy', value: meta ? `built ${meta.built_at}` : 'not loaded', source: 'measured', note: meta ? `${meta.source} (older database, read-only)` : '' }, { name: 'Unified DB', value: 'ISONE_GridSense_unified.duckdb', source: 'measured', note: 'primary' }],
    steps, result: { label: 'Quantities that differ', value: String(diff) },
    notes: ['No check possible: this card reports the difference between two stored sources; neither is recomputed here.'],
    csv: { name: 'decision-studio-vs-unified.csv', meta: [['studio_copy', meta ? `${meta.source} built ${meta.built_at}` : 'not loaded']], columns: ['option', 'field', 'studio_copy', 'unified', 'difference', 'state', 'note'], rows: notesPer.flatMap((ns, i) => (ns || []).map(n => [names[i], n.label, typeof n.studio === 'number' ? n.studio : n.studio == null ? null : String(n.studio), n.unified, n.diff, n.state, n.note])) },
  });
}

/** Coverage grid: held / partial / not held per concern and option (consistency check on the tallies). */
export function traceCoverage(grid, names) {
  const tally = names.map((_, i) => ({ held: grid.filter(r => r.cells[i].status === 'held').length, partial: grid.filter(r => r.cells[i].status === 'partial').length, nh: grid.filter(r => r.cells[i].status === 'not held').length }));
  const total = tally.reduce((t, x) => t + x.held + x.partial + x.nh, 0);
  return trace({
    id: 'd-coverage', title: 'Evidence coverage per option',
    formula: 'held = the database holds the evidence in full;  partial = held with a stated limit (borrowed price, envelope only, habitat-only screen, linked subset of the queue);  not held = absent',
    inputs: [{ name: 'Concerns', value: String(grid.length), source: 'rule', note: 'Coordinates, price node, settled history, forecast runs, element study, upgrade cost, land screen, queue linkage' }],
    steps: grid.flatMap(r => r.cells.map((c, i) => ({ label: `${names[i]}: ${r.concern}`, work: c.detail, value: c.status }))),
    result: { label: 'Cells held in full', value: `${tally.reduce((t, x) => t + x.held, 0)} of ${total}` },
    check: { label: 'Consistency check: held + partial + not held = concerns × options', a: total, b: grid.length * names.length, atol: 0, fmt: v => String(v) },
    csv: { name: 'decision-coverage.csv', columns: ['concern', ...names.flatMap(n => [`${n}_status`, `${n}_detail`])], rows: grid.map(r => [r.concern, ...r.cells.flatMap(c => [c.status, c.detail])]) },
  });
}

/** Decision record: what changed since each record, by input component. */
export function traceRecord(recs, cur, diffs) {
  const same = recs.filter(r => r.inputHash === cur).length, emptyDiff = diffs.filter(d => d && !d.length).length;
  return trace({
    id: 'd-record', title: 'Records against the current inputs',
    formula: 'For each record, compare its frozen input fingerprint with the current one, component by component (snapshot, technology, sizes, basis, options, Economics inputs, site control, data vintages, hand-offs)',
    inputs: [{ name: 'Records', value: String(recs.length), source: 'user', note: 'Stored in this browser' }],
    steps: recs.map((r, i) => ({ label: `${r.at.slice(0, 16).replace('T', ' ')} · ${r.status} · ${r.candidate}`, work: diffs[i] == null ? 'fingerprint unreadable' : diffs[i].length ? `changed: ${diffs[i].join(', ')}` : 'no component changed', value: r.inputHash === cur ? 'same inputs' : 'changed' })),
    result: { label: 'Records on the same inputs as now', value: `${same} of ${recs.length}` },
    ...(recs.length ? { check: { label: 'Consistency check: records whose whole fingerprint matches = records with no changed component', a: same, b: emptyDiff, atol: 0, fmt: v => String(v) } } : { notes: ['No check possible: no decision has been recorded yet.'] }),
    csv: { name: 'decision-records.csv', columns: ['recorded_at', 'decision', 'candidate', 'by', 'basis', 'same_inputs_as_now', 'changed_components'], rows: recs.map((r, i) => [r.at, r.status, r.candidate, r.by || null, r.basisText, r.inputHash === cur ? 'yes' : 'no', diffs[i] ? diffs[i].join('; ') : null]) },
  });
}

/** Readiness: evidence status and what it rests on. */
export function traceReadiness(ev) {
  return trace({
    id: 'd-readiness', title: 'Evidence status',
    formula: 'Current = sent for this bus, size and technology and still matching;  Needs refresh = sent for another size or technology;  Incomplete = sent but conditional, partly priced or a lower bound;  Missing = not sent',
    inputs: [{ name: 'Evidence items', value: String(ev.length), source: 'derived' }],
    steps: ev.map(e => ({ label: e.name, work: e.where, value: e.status })),
    result: { label: 'Evidence current', value: `${ev.filter(e => e.status === 'Current').length} of ${ev.length}` },
    notes: ['No check possible: these statuses describe your own hand-offs between dashboards; nothing is computed.'],
  });
}

/** Per-fuel verdict (decisioncore.fuelVerdict): each test against its threshold, per option, with re-checks. */
export function traceFuel(data, basis, ms, vs, tech, thRows, p) {
  const names = ms.map(m => m.node.name), steps = [], checks = [];
  const fu = (v, u) => (!ok(v) ? 'not held' : u === '%' ? `${v.toFixed(2)}%` : u === '$/MWh' ? `$${v.toFixed(2)}` : String(Math.round(v)));
  ms.forEach((m, i) => (vs[i] || []).forEach(x => steps.push({
    label: `${names[i]}: ${x.label}`,
    work: `${x.bases ? `${x.bases.map(b => `${b.basis} ${ok(b.ratio) ? `${(100 * b.ratio).toFixed(2)}%` : 'not held'}`).join(', ')} → lowest held ` : ''}${fu(x.value, x.unit)} vs ${fu(x.threshold, x.unit)} (${x.source === 'user' ? 'your input' : x.source || 'not held'})`,
    value: `${x.verdict}${x.qualifier ? ` (${x.qualifier})` : ''}`,
  })));
  ms.forEach(m => {
    const f = m.fuel || {};
    // Capture: the ratio is capture ÷ observed-hour average on the same rows (arithmetic re-check).
    for (const [k, c] of [['clear-sky', f.capture?.clearSky], ['fleet', f.capture?.fleet]]) if (c && ok(c.ratio) && ok(c.capture) && ok(c.avg) && c.avg) checks.push({ label: `Arithmetic re-check: ${m.node.name} ${k} capture ratio = capture price ÷ average price`, a: c.capture / c.avg, b: c.ratio, tol: 1e-9, fmt: v => (ok(v) ? `${(100 * v).toFixed(3)}%` : 'not held') });
    // TB4: re-derived from the hourly prices of the applied basis (same prices, same method: arithmetic re-check).
    if (ok(f.tb4?.value)) {
      const res = analyzePrices(data, coreBasis({ ...basis, nodeId: String(m.node.id) })), sp = res.summary ? dailySpreads(res.rows, 4) : [];
      checks.push({ label: `Arithmetic re-check: ${m.node.name} TB4 re-averaged over ${sp.length} complete days`, a: sp.length ? sp.reduce((t, d) => t + d.spread, 0) / sp.length : null, b: f.tb4.value, tol: 1e-9, fmt: v => (ok(v) ? `$${v.toFixed(3)}` : 'not held') });
    }
    // Opportunity loss: the share of battery power the binding limit cannot carry, recomputed from the limits.
    if (ok(f.oppLoss?.value)) {
      const sh = (lim, mw) => (ok(lim) && mw > 0 ? 100 * Math.max(0, 1 - Math.min(lim, mw) / mw) : null);
      const v = [sh(m.exportLimit, Number(p.exportMW)), sh(m.importLimit, Number(p.importMW))].filter(ok);
      if (v.length) checks.push({ label: `Arithmetic re-check: ${m.node.name} opportunity loss from the Grid limits`, a: Math.max(...v), b: f.oppLoss.value, tol: 1e-9, fmt: v2 => (ok(v2) ? `${v2.toFixed(3)}%` : 'not held') });
    }
  });
  const pass = vs.map(v => v.filter(x => x.verdict === 'Pass').length);
  return trace({
    id: 'd-fuel', title: `Per-fuel verdict (${tech})`,
    formula: 'Each test = the option\'s value against the threshold in force;  Pass only when the value is held and meets it;  Fail on a held breach (element-study evidence only);  Hold when anything is not held, envelope-only, or the capture bases disagree (open decision #2)',
    inputs: thRows.map(r => ({ name: r.label, value: fu(r.value, r.unit), unit: r.unit, source: r.source === 'user' ? 'user' : r.source === 'derived' ? 'derived' : r.source === 'not set' ? 'not set: open decision' : 'assumption', note: `${r.sourceLabel}${ok(r.default) ? ` · default ${fu(r.default, r.unit)}` : ''} · ${r.note || ''}` })),
    steps,
    result: { label: 'Tests passed', value: names.map((n, i) => `${n} ${pass[i]} of ${vs[i].length}`).join(' · ') },
    checks,
    notes: [...(checks.length ? [] : ['No check possible: no test value is held for any option on this basis.']),
      'Curtailment here is POI clipping at the export limit; ISO curtailment is not held per bus, so the test can Fail but never Pass.',
      'Clear-sky is a modelled shape (assumption); the fleet shape is ISO-NE fleet output (fact_genfuel_hourly), not a site profile.'],
    csv: { name: 'decision-fuel-verdict.csv', meta: [['technology', tech], ['note', 'blank = not held; threshold_source: your input / assumption / derived']],
      columns: ['option', 'bus_id', 'test', 'value', 'unit', 'threshold', 'threshold_source', 'verdict', 'clear_sky_ratio', 'fleet_ratio', 'why'],
      rows: ms.flatMap((m, i) => (vs[i] || []).map(x => [m.node.name, String(m.node.id), x.label, ok(x.value) ? x.value : null, x.unit, ok(x.threshold) ? x.threshold : null, x.source === 'user' ? 'your input' : x.source || 'not held', x.verdict, x.bases?.find(b => b.basis === 'clear-sky')?.ratio ?? null, x.bases?.find(b => b.basis === 'fleet')?.ratio ?? null, x.why])) },
  });
}
