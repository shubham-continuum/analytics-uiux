// Calculation traces for the Economics fuel tabs (v5): data-centre load cost, load flex and cost finance; the storage
// net bridge, duration sweep and run projection; the hybrid DC:AC sweep and the Decision revenue-method consistency.
// Each has a check that is independent where one exists, otherwise labelled a consistency / arithmetic re-check.
import { LOAD_ENERGY_METHOD } from '../economics-load.js';
import { trace } from '../trace.js';
import { describe, fmt } from '../basis.js';
import { blockByMonth } from './prices-fuel.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const n0 = v => (ok(v) ? Math.round(v).toLocaleString('en-US') : 'not held');
const n2 = v => (ok(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'not held');
const usd = v => (ok(v) ? `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}` : 'not held');
const bus = (S, node) => ({ name: 'Bus', value: `${node?.name ?? '?'} (${S.nodeId})`, source: 'measured' });
const basis = (S, x) => ({ name: 'Price basis', value: describe(S.basis), source: 'user', note: `${n0(x.res.summary?.hours)} hours → ${ok(x.yearsEq) ? x.yearsEq.toFixed(4) : '—'} year-equivalents` });
const meta = (S, node) => [['bus', `${node?.name} (${S.nodeId})`], ['basis', describe(S.basis)], ['missing', 'empty cell = not held, never zero']];

/** Data centre: annual energy cost of a flat load, and the cost stack around it. */
export function traceLoadCost(S, node, x, v) {
  // S2-EM: the one energy definition (economics-load.js); capacity and transmission now come from the S6
  // delivered-cost stack (large-load proposal), shown on its own card, so they are not re-derived here.
  const rows = x.records, H = rows.reduce((t, r) => t + r.dtHours, 0), bill = rows.reduce((t, r) => t + r.price * r.dtHours, 0);
  const independent = ok(v.le.mean) ? v.le.mean * v.mw * 8760 : null;
  return trace({
    id: 'e-loadcost', title: 'Energy cost of a flat load (the one definition)',
    formula: `energy_yr = ${LOAD_ENERGY_METHOD}`,
    inputs: [bus(S, node), basis(S, x), { name: 'Load (import)', value: fmt.mw(v.mw), source: 'user', note: 'Import MW in the project strip; a flat 24 × 7 load' }],
    steps: [
      { label: 'Bill per MW over the basis', work: `Σ price × Δt over ${n0(H)} h`, value: usd(bill) },
      { label: 'Energy per year', work: `${usd(bill)} × ${n2(v.mw)} MW ÷ (${n0(H)} ÷ 8,760)`, value: usd(v.le.value) },
    ],
    result: { label: 'Energy cost per year', value: usd(v.le.value) },
    checks: [{ label: 'Independent form: observed-hour mean × MW × 8,760 h', a: v.le.value, b: independent, tol: 1e-6, fmt: usd }],
    notes: ['Decision, the delivered-cost stack and this tab read the same function (economics-load.js loadEnergyCost).', S.basis?.weighting !== 'duration' ? 'Year weights apply only to the Prices headline mean; the load bill weights years by observed hours.' : 'Years weighted by observed hours.'],
    csv: { name: `econ-load-cost-${S.nodeId}.csv`, meta: meta(S, node), columns: ['timestamp', 'price_usd_mwh', 'load_mw', 'cost_usd', 'interval_hours'], rows: () => rows.map(r => [r.timestamp, r.price, v.mw, r.price * v.mw * r.dtHours, r.dtHours]) },
  });
}

/** Load flex: move a share of a flat load from the N dearest to the N cheapest hours of each day. */
export function traceFlex(S, node, x, v) {
  const bm = blockByMonth(x.records, v.f.N), alt = bm.reduce((t, m) => t + (ok(m.spread) ? m.spread * m.days : 0), 0);
  const total = v.f.spreads.reduce((t, s) => t + s, 0);
  return trace({
    id: 'e-flex', title: 'Load-flex value (shift between the dearest and cheapest hours)',
    formula: 'saving_d = shift MW × N × (mean of the N dearest − mean of the N cheapest); per year = Σ_d saving_d × 365 ÷ days',
    inputs: [bus(S, node), basis(S, x), { name: 'Load', value: fmt.mw(v.mw), source: 'user' }, { name: 'Share that can move', value: `${v.share}%`, source: 'assumption', note: 'placeholder: no site flexibility study is held' }, { name: 'Block length N', value: `${v.f.N} h`, source: 'user' }],
    steps: [
      { label: 'Days with 2N priced hours', work: 'calendar days on the basis', value: n0(v.f.days) },
      { label: 'Mean daily spread (dearest N − cheapest N)', work: `Σ spread ÷ ${n0(v.f.days)}`, value: fmt.price(v.f.meanSpread) },
      { label: 'Shifted MW', work: `${n2(v.mw)} × ${v.share}%`, value: fmt.mw(v.f.shiftMW) },
      { label: 'Saving over the basis', work: `${n2(v.f.shiftMW)} × ${v.f.N} × Σ spreads ${n2(total)}`, value: usd(v.f.saving) },
      { label: 'Per year', work: `× 365 ÷ ${n0(v.f.days)}`, value: usd(v.f.savingYr) },
    ],
    result: { label: 'Load-flex saving per year', value: usd(v.f.savingYr) },
    checks: [{ label: 'Independent path: Σ daily spreads = Σ monthly (dearest − cheapest) × days (Prices › blockByMonth)', a: total, b: alt, tol: 1e-9, fmt: n2 }],
    notes: ['Energy only, perfect foresight of the day\'s prices, no rebound or process constraint: a ceiling for a shiftable load.'],
    csv: { name: `econ-load-flex-${S.nodeId}.csv`, meta: meta(S, node), columns: ['day_index', 'spread_usd_mwh', 'saving_usd'], rows: v.f.spreads.map((s, i) => [i + 1, s, ok(v.f.shiftMW) ? v.f.shiftMW * v.f.N * s : null]) },
  });
}

/** Data centre finance on cost: PV of the energy cost stream and its levelised $/MWh. */
export function traceCostFin(S, node, v) {
  const r = v.rate, n = v.years, annuity = v.escalation === 0 && ok(v.annual) ? (r === 0 ? v.annual * n : (v.annual * (1 - (1 + r) ** -n)) / r) : null;
  return trace({
    id: 'e-costfin', title: 'Present value of the load\'s energy cost',
    formula: 'PV = Σ_t cost × (1 + g)^(t−1) ÷ (1 + r)^t; levelised = PV ÷ Σ_t MWh ÷ (1 + r)^t',
    inputs: [bus(S, node), { name: 'Annual energy cost (year 1)', value: usd(v.annual), source: 'derived', note: 'Load cost tab, measured on the basis' }, { name: 'Annual MWh', value: n0(v.mwh), source: 'derived' },
      { name: 'Discount rate', value: `${(100 * r).toFixed(2)}%`, source: 'user' }, { name: 'Years', value: String(n), source: 'user' }, { name: 'Price escalation', value: `${(100 * v.escalation).toFixed(2)}%/yr`, source: v.escalation ? 'user' : 'assumption', note: '0 = flat real prices' }],
    steps: v.c.rows.map(x => ({ label: `Year ${x.year}`, work: `${usd(x.cost)} ÷ ${(1 + r).toFixed(4)}^${x.year}`, value: usd(x.pv) })),
    result: { label: 'PV of energy cost', value: usd(v.c.pv) },
    checks: annuity != null ? [{ label: 'Independent closed form: flat stream = annual × (1 − (1 + r)^−n) ÷ r', a: v.c.pv, b: annuity, tol: 1e-9, fmt: usd }]
      : [{ label: 'Arithmetic re-check: Σ of the yearly PVs', a: v.c.pv, b: v.c.rows.reduce((t, x) => t + x.pv, 0), tol: 1e-9, fmt: usd }],
    notes: ['A cost, not a revenue: capacity and transmission charges are not in it (see the Load cost stack).'],
    csv: { name: `econ-cost-pv-${S.nodeId}.csv`, meta: meta(S, node), columns: ['year', 'cost_usd', 'pv_usd'], rows: v.c.rows.map(x => [x.year, x.cost, x.pv]) },
  });
}

/** Storage net bridge. */
export function traceBridge(S, node, x, v) {
  const s = v.bridge.steps, sumSteps = s.slice(0, 5).reduce((t, z) => t + (z.value ?? 0), 0);
  return trace({
    id: 'e-bridge', title: 'Storage net bridge: gross spread to net value',
    formula: 'net = TB_N × MWh × days − (1 − RTE) × TOP_N × MWh × days (the loss on the discharged energy only) − (benchmark − free dispatch) − cycling − degradation',
    inputs: [bus(S, node), basis(S, x), { name: `TB${v.dur} on the basis`, value: fmt.price(v.tb), source: 'measured', note: `${n0(v.days)} full days (Prices › dailySpreads)` }, { name: 'Energy', value: `${n0(v.E)} MWh`, source: 'user' },
      { name: 'Round-trip efficiency', value: `${v.rte}%`, source: 'assumption', note: 'ORTP battery (ext/75 bess_rte)' }, { name: 'Degradation', value: `${v.deg}%/yr`, source: 'assumption', note: 'ext/75 deg_bess: storage degradation is not covered by the vault' },
      { name: 'Cycling cost', value: `$${v.cycleCost}/MWh`, source: v.cycleCost ? 'user' : 'assumption' }],
    steps: s.map(z => ({ label: z.label, work: z.key === 'ceiling' ? `${fmt.price(v.tb)} × ${n0(v.E)} MWh × ${n0(v.days)} days ÷ ${x.yearsEq.toFixed(4)}` : z.key === 'rte' ? (ok(v.top) ? `−(1 − ${v.rte}%) × top-${v.dur}-hour mean ${fmt.price(v.top)} × ${n0(v.E)} MWh × ${n0(v.days)} days ÷ ${x.yearsEq.toFixed(4)}` : 'top-hour prices not held') : z.key === 'net' ? 'sum of the steps above' : '', value: usd(z.value) })),
    result: { label: 'Net value per year', value: usd(v.bridge.net) },
    checks: [{ label: 'Consistency check: the bridge steps sum to the net', a: sumSteps, b: v.bridge.net, tol: 1e-9, fmt: usd },
      { label: 'Consistency check: the dispatch step ends on the optimiser\'s own net value (BESS schedule, cycling included)', a: s[0].value + s[1].value + s[2].value + s[3].value, b: v.dispatchNet, tol: 1e-6, fmt: usd }],
    notes: ['Perfect foresight: a ceiling. Degradation is a year-1 capacity fade applied to the net, a placeholder until a warranty curve is held.'],
    csv: { name: `econ-storage-bridge-${S.nodeId}.csv`, meta: meta(S, node), columns: ['step', 'usd_per_year'], rows: s.map(z => [z.label, z.value]) },
  });
}

/** Duration sweep and run projection. */
export function traceSweep(S, node, x, v) {
  const held = v.sweep.filter(r => ok(r.value));
  const monotone = held.every((r, i) => !i || r.value >= held[i - 1].value - 1e-6);
  return trace({
    id: 'e-sweep', title: 'Storage value by duration (2–8 h) and by run',
    formula: 'value_d = perfect-foresight dispatch at MW × d MWh (same prices and limits); run_k ≈ benchmark_k × (dispatch ÷ benchmark on the basis)',
    inputs: [bus(S, node), basis(S, x), { name: 'Power', value: fmt.mw(v.mw), source: 'user' }, { name: 'Durations', value: v.sweep.map(r => `${r.dur} h`).join(', '), source: 'user' }, { name: 'Basis dispatch ÷ benchmark', value: ok(v.ratio) ? v.ratio.toFixed(3) : 'not held', source: 'derived' }],
    steps: [...v.sweep.map(r => ({ label: `${r.dur} h (${n0(v.mw * r.dur)} MWh)`, work: r.note || 'dispatch', value: usd(r.value) })), ...v.proj.map(r => ({ label: `Projection · ${r.label}`, work: `${usd(r.bench)} × ${ok(v.ratio) ? v.ratio.toFixed(3) : '—'}`, value: usd(r.value) }))],
    result: { label: `Value at ${v.dur} h`, value: usd(v.sweep.find(r => r.dur === v.dur)?.value) },
    checks: [{ label: 'Independent property: more energy at the same power never lowers the optimal value (1 = holds)', a: monotone ? 1 : 0, b: 1, fmt: n0 }],
    notes: ['Runs are projected, not dispatched: each run\'s spread benchmark scaled by the basis ratio (modelled).'],
    csv: { name: `econ-storage-sweep-${S.nodeId}.csv`, meta: meta(S, node), columns: ['kind', 'label', 'value_usd_per_year'], rows: [...v.sweep.map(r => ['duration', `${r.dur}h`, r.value]), ...v.proj.map(r => ['run', r.label, r.value])] },
  });
}

/** Hybrid DC:AC sweep. */
export function traceDcac(S, node, v) {
  const r1 = v.rows.find(r => r.ratio === 1);
  return trace({
    id: 'e-dcac', title: 'DC:AC ratio and clipping',
    formula: 'gen_h(k) = k × P_h (P = CF-scaled clear-sky AC output at DC:AC 1, after losses); clipped = Σ max(0, gen − AC) × Δt',
    inputs: [bus(S, node), { name: 'AC nameplate', value: fmt.mw(v.ac), source: 'user' }, { name: 'Shape', value: 'clear-sky at the bus, scaled to the CF', source: 'assumption', note: 'peaks below nameplate at DC:AC 1, so clipping starts only at higher ratios' }],
    steps: v.rows.map(r => ({ label: `DC:AC ${r.ratio.toFixed(2)}`, work: `${n0(r.rawMWh)} MWh produced − ${n0(r.clippedMWh)} clipped`, value: `${n2(r.share)}%` })),
    result: { label: `Clipped at DC:AC ${v.rows.at(-1)?.ratio.toFixed(2)}`, value: `${n2(v.rows.at(-1)?.share)}%` },
    checks: [{ label: 'Consistency check: at DC:AC 1 the CF-scaled output equals MW × CF × hours × (1 − losses) (MWh)', a: r1?.rawMWh, b: v.target, tol: 1e-6, fmt: n0 }],
    notes: ['Clear-sky understates clouds and so understates clipping on bright days only; a measured site profile would change this.'],
    csv: { name: `econ-dcac-${S.nodeId}.csv`, meta: meta(S, node), columns: ['dc_ac', 'produced_mwh', 'clipped_mwh', 'delivered_mwh', 'clipped_pct'], rows: v.rows.map(r => [r.ratio, r.rawMWh, r.clippedMWh, r.deliveredMWh, r.share]) },
  });
}

/** Economics energy revenue vs the shared method decisioncore.revenueFor (nameplate cap → losses → export cap). */
export function traceRevFor(S, node, v) {
  return trace({
    id: 'e-revfor', title: 'Consistency with the Decision revenue method',
    formula: 'revenueFor: min(MW, MW × CF × s_h ÷ mean s) × (1 − losses), capped at the export limit; Σ × price ÷ year-equivalents',
    inputs: [bus(S, node), { name: 'Technology', value: v.tech, source: 'user' }, { name: 'Shape', value: v.shape, source: v.shape === 'fleet' ? 'measured' : 'assumption' }, { name: 'Export limit', value: fmt.mw(v.cap), source: 'derived' }],
    steps: [{ label: 'This page (Economics)', work: 'settle(): losses then the connection cap', value: usd(v.energy) }, { label: 'decisioncore.revenueFor', work: 'the shared method Decision ranks on', value: usd(v.other) }],
    result: { label: 'Energy revenue per year', value: usd(v.energy) },
    checks: v.checkable ? [{ label: 'Independent implementation: Economics = decisioncore.revenueFor on the same inputs', a: v.energy, b: v.other, tol: 1e-6, fmt: usd }] : [],
    notes: v.checkable ? ['Both apply the nameplate cap, then losses, then the export cap.'] : [`No check possible: ${v.why}`],
    csv: { name: `econ-revfor-${S.nodeId}.csv`, meta: meta(S, node), columns: ['method', 'usd_per_year'], rows: [['economics', v.energy], ['decisioncore.revenueFor', v.other]] },
  });
}
