// Calculation traces for Economics. Checks are independent of the arithmetic they audit (review 2026-09-29):
// energy balances against closed-form targets, physical constraint audits of the optimal schedule, a no-battery
// lower bound for hybrids, and NPV(IRR) = 0 / PV(LCOE × MWh) = PV(costs) for finance. Arithmetic re-runs are
// labelled as such. Hourly working downloads as CSV with a provenance header.
import { trace } from '../trace.js';
import { clearSky } from '../solar.js';
import { describe, fmt } from '../basis.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const n0 = v => (ok(v) ? Math.round(v).toLocaleString('en-US') : 'not held');
const n2 = v => (ok(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'not held');
const usd = v => (ok(v) ? `${v < 0 ? '−' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-US')}` : 'not held');
const src = tag => ({ A: 'assumption', P: 'assumption', U: 'user' }[tag] || 'derived');
const sum = (rows, f) => rows.reduce((t, r) => t + f(r), 0);
const count = v => `${n0(v)} h`;

function common(S, node, x) {
  const pm = node?.priceMapping || {};
  const series = S.basis?.mode === 'forecast' ? { value: `Model bus ${S.nodeId} (${S.basis.run})`, note: 'forecast for this bus itself' }
    : { value: pm.pnode_name ?? '—', note: pm.tier === 'geo_proxy' ? (pm.distance_km < 0.05 ? 'co-located node' : `borrowed, ${n2(pm.distance_km)} km away`) : pm.tier === 'same_substation' ? 'same substation' : 'own node' };
  return [
    { name: 'Bus', value: `${node?.name ?? '?'} (${S.nodeId})`, source: 'measured' },
    { name: S.basis?.mode === 'forecast' ? 'Price series' : 'Price node', value: series.value, source: 'measured', note: series.note },
    { name: 'Price basis', value: describe(S.basis), source: 'user', note: `${n0(x.res.summary?.hours)} hours → ${ok(x.yearsEq) ? x.yearsEq.toFixed(4) : '—'} year-equivalents (÷ 8,760); years weighted by observed hours` },
  ];
}
const meta = (S, node) => [['bus', `${node?.name} (${S.nodeId})`], ['basis', describe(S.basis)], ['units', 'MW, MWh, $ ; price $/MWh'], ['missing', 'empty cell = not held, never zero']];

/** Solar & wind revenue. v: { tech, mw, cf, loss, cap, raw (pre-loss profile), afterLoss, clipped, energy, mwh, rec, … } */
export function traceRevenue(S, node, x, v) {
  const n = x.yearsEq, H = sum(v.clipped, r => r.dtHours);
  const rawE = sum(v.raw, r => r.generationMW * r.dtHours), afterE = sum(v.afterLoss, r => r.generationMW * r.dtHours), mwhAll = sum(v.clipped, r => r.generationMW * r.dtHours);
  const rev = sum(v.clipped, r => r.generationMW * r.dtHours * r.price);
  // Independent target: an unclipped profile with this CF delivers exactly MW × CF × hours before any loss or cap.
  const unclipped = v.tech === 'solar'
    ? (() => { const g = v.clipped.map(r => clearSky(r.timestamp, node?.latitude, node?.longitude) ?? 0), m = sum(g.map((w, i) => w * v.clipped[i].dtHours), w => w) / H; return g.map(w => (m ? (v.mw * v.cf * w) / m : 0)); })()
    : (v.unclipped || v.clipped.map(() => v.mw * v.cf));
  const nameplateClip = sum(unclipped.map((u, i) => Math.max(0, u - v.mw) * v.clipped[i].dtHours), w => w);
  const lossE = rawE - afterE, spill = afterE - mwhAll, target = v.mw * v.cf * H;
  return trace({
    id: 'e-revenue', title: 'Revenue per year',
    formula: 'MW_h = min(nameplate, MW × CF × g_h ÷ mean g);  delivered_h = min(MW_h × (1 − losses), cap);  cap = min(nameplate, export limit);  energy/yr = Σ delivered_h × price_h × Δt ÷ (H ÷ 8,760);  headline = the labelled stack (energy + RECs where held; capacity excluded)',
    inputs: [...common(S, node, x),
      { name: 'Technology, size', value: `${v.tech}, ${fmt.mw(v.mw)}`, source: 'user' },
      { name: 'Capacity factor', value: `${n2(v.cf * 100)}%`, source: src(v.tags.cf), note: v.srcs.cf },
      { name: 'Losses', value: `${v.loss}%`, source: src(v.tags.loss), note: `${v.srcs.loss} · applied before the connection cap` },
      { name: 'Export limit', value: fmt.mw(x.exportLimit), source: 'derived', note: x.gridSource },
      { name: 'Connection cap (D10)', value: fmt.mw(v.cap), source: 'derived', note: v.capRule?.label || 'min(nameplate, export limit)' },
      { name: 'REC price', value: ok(v.recPrice) ? `$${v.recPrice}/MWh` : 'not held', source: ok(v.recPrice) ? src(v.tags.rec) : 'measured', note: v.recMarket },
      { name: 'Capacity stream (S4 rules)', value: ok(v.capacity) ? usd(v.capacity) : 'not held', source: ok(v.capacity) ? 'assumption' : 'not held', note: `${v.capNote || ''} · ${v.capSrc || ''} · on ${fmt.mw(v.capMW)} (capped at the connection); shown, not in the headline` }],
    steps: [
      { label: 'Profile energy (before losses)', work: v.tech === 'solar' ? `clear-sky shape scaled to CF ${n2(v.cf * 100)}%, capped at ${fmt.mw(v.mw)}` : v.profileLabel && !/^Flat/.test(v.profileLabel) ? `${v.profileLabel} ${n2(v.cf * 100)}%, capped at ${fmt.mw(v.mw)}` : `flat ${fmt.mw(v.mw)} × ${n2(v.cf * 100)}% every hour`, value: `${n0(rawE)} MWh` },
      { label: 'Losses', work: `${n0(rawE)} × ${v.loss}%`, value: `−${n0(lossE)} MWh` },
      { label: 'Spilled at the export limit', work: `Σ max(0, after-loss MW − ${fmt.mw(v.cap)})`, value: `−${n0(spill)} MWh` },
      { label: 'Delivered', work: 'Σ delivered_h × Δt', value: `${n0(mwhAll)} MWh` },
      { label: 'Energy revenue (all hours)', work: `Σ delivered_h × price_h over ${n0(H)} h`, value: usd(rev) },
      { label: 'Per year', work: `${usd(rev)} ÷ ${n.toFixed(4)}`, value: usd(rev / n) },
      { label: 'Capture price', work: `${usd(rev)} ÷ ${n0(mwhAll)} MWh`, value: fmt.price(mwhAll ? rev / mwhAll : null) },
      { label: 'RECs per year', work: ok(v.recPrice) ? `${n0(mwhAll / n)} MWh × $${v.recPrice}` : 'REC price not held for this market', value: usd(v.rec) },
      { label: 'Revenue per year', work: `${usd(rev / n)} + ${ok(v.rec) ? usd(v.rec) : '$0 (RECs not held)'}`, value: usd(rev / n + (v.rec ?? 0)) },
      { label: 'Capacity (conditional, not added)', work: 'rules/revenue.js capacity stream (regime, accreditation and price path cited there)', value: usd(v.capacity) },
    ],
    result: { label: 'Revenue per year', value: usd(v.headline) },
    checks: [
      { label: 'Profile-scaling check: delivered + spilled + losses + clipped at nameplate = MW × CF × hours (closed form; confirms the CF scaling, not the loss or cap logic)', a: mwhAll + spill + lossE + nameplateClip, b: target, tol: 1e-6, fmt: w => `${n0(w)} MWh` },
      { label: 'Arithmetic re-run: energy revenue per year = revenue engine', a: rev / n, b: v.energy, fmt: usd },
    ],
    notes: v.tech === 'solar' ? ['The clear-sky shape scaled to a capacity factor peaks below nameplate, so clipping is understated.'] : v.profileLabel && !/^Flat/.test(v.profileLabel) ? ['Wind uses the ISO-NE fleet wind output shape (unified fact_genfuel_hourly), a system-wide shape rather than the wind at this site; the scaling check confirms it delivers MW × CF × hours before losses and the cap.'] : ['Wind is a flat proxy (no wind shape is held for this calendar): its "capture" is the average price.'],
    csv: { name: `econ-revenue-${S.nodeId}.csv`, meta: meta(S, node), columns: ['timestamp', 'price_usd_mwh', 'profile_mw', 'after_losses_mw', 'delivered_mw', 'revenue_usd'], rows: () => v.clipped.map((r, i) => [r.timestamp, r.price, v.raw[i].generationMW, v.afterLoss[i].generationMW, r.generationMW, r.generationMW * r.dtHours * r.price]) },
  });
}

/** BESS: sums over the optimal schedule and a physical audit of that schedule. */
export function traceBess(S, node, x, v) {
  const b = v.b, s = b.summary, n = x.yearsEq, rows = b.rows, eta = Math.sqrt(v.rte / 100), E = v.mw * v.dur, g = b.grid, tol = 1e-6;
  const imp = sum(rows, r => r.importMW * r.dtHours), exp = sum(rows, r => r.exportMW * r.dtHours), dis = sum(rows, r => r.dischargeMW * r.dtHours);
  const buy = sum(rows, r => r.importMW * r.price * r.dtHours), sell = sum(rows, r => r.exportMW * r.price * r.dtHours), cyc = dis * v.cycleCost, net = sell - buy - cyc;
  const overLimit = rows.filter(r => r.chargeMW > v.chargeCap + tol || r.importMW > v.chargeCap + tol || r.exportMW > v.exportCap + tol || r.dischargeMW > v.mw + tol).length;
  const socBad = rows.filter((r, i) => r.socEndMWh < -tol || r.socEndMWh > E + tol || (i && Math.abs(r.socStartMWh - rows[i - 1].socEndMWh) > tol)).length + (Math.abs((rows.at(-1)?.socEndMWh ?? 0) - (rows[0]?.socStartMWh ?? 0)) > tol ? 1 : 0);
  const both = rows.filter(r => r.chargeMW > tol && r.dischargeMW > tol).length;
  const limitNote = v.chargeBasis ? `min(MW, shoulder import limit ${fmt.mw(x.importLimit)}) · ${v.chargeBasis}` : `min(MW, shoulder import limit ${fmt.mw(x.importLimit)})`;
  return trace({
    id: 'e-bess', title: 'Battery arbitrage value',
    formula: 'Maximise Σ_h (export_h − import_h) × price_h × Δt − discharge_h × Δt × cycling cost,  SOC_(h+1) = SOC_h + charge_h × η × Δt − discharge_h × Δt ÷ η,  0 ≤ SOC ≤ MWh,  power and connection limits,  SOC_end = SOC_start',
    inputs: [...common(S, node, x),
      { name: 'Power, duration', value: `${fmt.mw(v.mw)} × ${v.dur} h = ${n0(E)} MWh`, source: src(v.tags.dur), note: v.srcs.dur },
      { name: 'Round-trip efficiency', value: `${v.rte}% → η = √${v.rte / 100} = ${eta.toFixed(4)} each way`, source: src(v.tags.rte), note: v.srcs.rte },
      { name: 'Charge limit', value: fmt.mw(v.chargeCap), source: 'derived', note: limitNote },
      { name: 'Export limit', value: fmt.mw(v.exportCap), source: 'derived', note: x.gridSource },
      { name: 'Cycling cost', value: `$${v.cycleCost}/MWh discharged`, source: src(v.tags.cyc), note: v.srcs.cyc },
      { name: 'Solver grid', value: `${n0(g.states)} SOC steps of ${n2(g.stepMWh)} MWh`, source: 'assumption', note: `Whole steps per hour: usable ${n2(g.usableChargeMW)} of ${n2(v.chargeCap)} MW charging, ${n2(g.usableDischargeMW)} of ${n2(Math.min(v.mw, v.exportCap))} MW discharging. Perfect foresight: a ceiling.` }],
    steps: [
      { label: 'Energy bought (grid import)', work: `Σ import × Δt over ${n0(s.hours)} h`, value: `${n0(imp)} MWh` },
      { label: 'Cost of charging', work: `Σ import × price × Δt; average ${fmt.price(imp ? buy / imp : null)}/MWh`, value: usd(buy) },
      { label: 'Energy sold (export)', work: 'Σ export × Δt', value: `${n0(exp)} MWh` },
      { label: 'Revenue from discharging', work: `Σ export × price × Δt; average ${fmt.price(exp ? sell / exp : null)}/MWh`, value: usd(sell) },
      { label: 'Cycling cost', work: `${n0(dis)} MWh × $${v.cycleCost}`, value: usd(cyc) },
      { label: 'Net value (all hours)', work: `${usd(sell)} − ${usd(buy)} − ${usd(cyc)}`, value: usd(net) },
      { label: 'Per year', work: `${usd(net)} ÷ ${n.toFixed(4)}`, value: usd(net / n) },
      { label: 'Equivalent cycles per year', work: `${n0(dis)} ÷ ${eta.toFixed(4)} ÷ ${n0(E)} MWh ÷ ${n.toFixed(4)}`, value: n2(dis / eta / E / n) },
    ],
    result: { label: 'Arbitrage value per year', value: usd(net / n) },
    checks: [
      { label: 'Schedule audit: hours exceeding a power or connection limit', a: overLimit, b: 0, fmt: count },
      { label: 'Schedule audit: hours with SOC outside 0–MWh, a jump between hours, or end ≠ start', a: socBad, b: 0, fmt: count },
      { label: 'Schedule audit: hours charging and discharging at once', a: both, b: 0, fmt: count },
      { label: 'Arithmetic re-run: re-priced schedule = optimiser objective', a: net, b: s.netValue, fmt: usd },
    ],
    csv: { name: `econ-bess-${S.nodeId}-${v.dur}h.csv`, meta: meta(S, node), columns: ['timestamp', 'price_usd_mwh', 'charge_mw', 'discharge_mw', 'import_mw', 'export_mw', 'soc_start_mwh', 'soc_end_mwh', 'net_value_usd'], rows: () => rows.map(r => [r.timestamp, r.price, r.chargeMW, r.dischargeMW, r.importMW, r.exportMW, r.socStartMWh, r.socEndMWh, r.netValue]) },
  });
}

/** Hybrid: the best configuration, audited against the POI, no-grid-charging and the solar-only lower bound. */
export function traceHybrid(S, node, x, v) {
  const c = v.best; if (!c?.rows) return '';
  const rows = c.rows, n = x.yearsEq, tol = 1e-6, g = c.grid;
  const gen = sum(rows, r => r.generationMW * r.dtHours), toB = sum(rows, r => r.renewableToBatteryMW * r.dtHours), dir = sum(rows, r => r.renewableExportMW * r.dtHours);
  const spill = sum(rows, r => r.renewableCurtailmentMW * r.dtHours), dis = sum(rows, r => r.dischargeMW * r.dtHours), value = sum(rows, r => r.netValue);
  const overPoi = rows.filter(r => r.exportMW > v.poi + tol).length, imports = rows.filter(r => r.importMW > tol).length;
  return trace({
    id: 'e-hybrid', title: `Hybrid: ${fmt.mw(c.mw)} storage added`,
    formula: 'Each hour: solar_h = to battery_h + exported_h + spilled_h;  export_h = exported_h + discharge_h ≤ POI limit;  no grid charging;  value = Σ export_h × price_h × Δt − cycling cost',
    inputs: [...common(S, node, x),
      { name: 'Solar, POI limit', value: `${fmt.mw(v.pv)}, ${fmt.mw(v.poi)}`, source: 'user' },
      { name: 'Storage', value: `${fmt.mw(c.mw)} / ${n0(c.mw * v.dur)} MWh`, source: 'user' },
      { name: 'Grid charging', value: 'No', source: 'rule', note: 'The battery charges only from the solar plant' },
      { name: 'Solver grid', value: `${n0(g.states)} SOC steps of ${n2(g.stepMWh)} MWh`, source: 'assumption', note: `${n2(100 * (g.solarAbsorbed ?? 1))}% of hourly solar charging representable; perfect foresight` }],
    steps: [
      { label: 'Solar after losses', work: 'Σ solar_h × Δt', value: `${n0(gen)} MWh` },
      { label: 'Solar exported directly', work: 'Σ exported_h × Δt', value: `${n0(dir)} MWh` },
      { label: 'Solar into the battery', work: 'Σ to battery_h × Δt', value: `${n0(toB)} MWh` },
      { label: 'Solar spilled at the POI', work: 'Σ spilled_h × Δt', value: `${n0(spill)} MWh` },
      { label: 'Battery discharged', work: 'Σ discharge_h × Δt', value: `${n0(dis)} MWh` },
      { label: 'Value per year', work: `Σ net value_h ÷ ${n.toFixed(4)}`, value: usd(value / n) },
      { label: 'Solar-only value per year', work: 'same solar, no battery, capped at the POI (computed separately)', value: usd(v.base) },
      { label: 'Incremental value per year', work: `${usd(value / n)} − ${usd(v.base)}`, value: usd(value / n - v.base) },
    ],
    result: { label: 'Incremental value', value: `${usd(value / n - v.base)}/yr` },
    checks: [
      { label: 'Schedule audit: hours exporting above the POI limit', a: overPoi, b: 0, fmt: count },
      { label: 'Schedule audit: hours importing from the grid', a: imports, b: 0, fmt: count },
      { label: 'Lower bound: hybrid value ≥ solar-only value (the battery can always stay idle)', a: Math.min(0, value / n - v.base), b: 0, tol: 1e-6, fmt: usd },
    ],
    csv: { name: `econ-hybrid-${S.nodeId}.csv`, meta: meta(S, node), columns: ['timestamp', 'price_usd_mwh', 'solar_mw', 'solar_export_mw', 'solar_to_battery_mw', 'spilled_mw', 'discharge_mw', 'soc_end_mwh', 'net_value_usd'], rows: () => rows.map(r => [r.timestamp, r.price, r.generationMW, r.renewableExportMW, r.renewableToBatteryMW, r.renewableCurtailmentMW, r.dischargeMW, r.socEndMWh, r.netValue]) },
  });
}

/** Project finance: year-by-year cash flow, NPV, IRR and LCOE, with checks on an independent footing. */
const finDef = (S, k) => { const d = S.ui?.inputProv?.[k] ?? (S.ui?.inputSrc?.[k] ? { state: 'default', ...S.ui.inputSrc[k] } : null); return d && d.state === 'default' && S.ui.fin?.[k] != null && Object.is(S.ui.fin[k], d.v) ? d.src : null; }; // fix-3: a user project's labelled rules default
export function traceFinance(S, v) {
  const dc = finDef(S, 'capex'), dm = finDef(S, 'annualOM'), dr = finDef(S, 'discountRate'), dy = finDef(S, 'years');
  const r = v.r, rr = v.rate, irr = r.summary.irr;
  const npvAt = rate => r.rows.reduce((t, row) => t + row.projectCashFlow / (1 + rate) ** row.year, 0);
  const steps = r.rows.map(row => ({
    label: row.year === 0 ? 'Year 0: capital' : row.operatingYear ? `Year ${row.year} (operating ${row.operatingYear})` : `Year ${row.year} (construction)`,
    work: row.year === 0 ? `−${usd(row.capex)}` : row.operatingYear ? `${usd(row.revenue)} − ${usd(row.om)} = ${usd(row.projectCashFlow)}; ÷ ${(1 + rr).toFixed(4)}^${row.year}` : 'no output',
    value: usd(row.projectCashFlow / (1 + rr) ** row.year),
  }));
  steps.push({ label: 'Net present value', work: 'Σ discounted cash flows', value: usd(npvAt(rr)) });
  steps.push({ label: 'IRR', work: ok(irr) ? 'rate where NPV = 0 (bisection; cash flows change sign once)' : 'not defined: cash flows do not change sign exactly once', value: ok(irr) ? fmt.pct(100 * irr) : 'not defined' });
  let lcoeCheck = null;
  if (v.lc?.value != null) {
    steps.push({ label: 'LCOE', work: `PV(capital + O&M) ÷ PV(MWh) = ${usd(v.lc.pvCost)} ÷ ${n0(v.lc.pvMWh)} MWh (capital at year 0, output from year ${v.construction + 1})`, value: `$${v.lc.value.toFixed(2)}/MWh` });
    // Independent of lcoe.js: costs from the finance engine's own year rows, MWh on the same operating years.
    const pvCost = r.rows.reduce((t, row) => t + (row.capex + row.om) / (1 + rr) ** row.year, 0);
    const pvMWh = r.rows.filter(row => row.operatingYear > 0).reduce((t, row) => t + (v.mwh[row.operatingYear - 1] ?? 0) / (1 + rr) ** row.year, 0);
    lcoeCheck = { label: 'LCOE from the finance engine\'s own cash-flow rows: PV(capital + O&M) ÷ PV(MWh)', a: pvMWh ? pvCost / pvMWh : null, b: v.lc.value, fmt: w => (ok(w) ? `$${w.toFixed(2)}/MWh` : 'not held') };
  }
  return trace({
    id: 'e-finance', title: 'Net present value',
    formula: 'NPV = Σ_t CF_t ÷ (1 + r)^t;  CF_0 = −capital;  CF_t = revenue_1 × (1 − decline)^(k−1) − O&M in operating year k;  LCOE = PV(costs) ÷ PV(MWh)',
    inputs: [
      { name: 'Capital (incl. Grid upgrades)', value: usd(v.capex), source: dc ? 'assumption' : 'user', note: `${dc ? `default · ${dc}; ` : ''}${v.upgrade ? `includes ${usd(v.upgrade)} upgrade subtotal sent from Grid` : 'no upgrade subtotal included'}` },
      { name: 'O&M per year', value: usd(v.om), source: dm ? 'assumption' : 'user', note: dm ? `default · ${dm}` : '' },
      { name: 'Discount rate', value: fmt.pct(100 * rr), source: dr ? 'assumption' : 'user', note: dr ? `default · ${dr}` : '' },
      { name: 'Construction, operating years', value: `${v.construction}, ${v.years}`, source: dy ? 'assumption' : 'user', note: dy ? `life: default · ${dy}` : '' },
      { name: 'Revenue year 1', value: usd(v.revenue1), source: v.revSource === 'Sent' ? 'derived' : 'user', note: v.revSource === 'Sent' ? `sent from an Economics revenue tab${v.proxy ? ' (wind: flat proxy)' : ''}` : '' },
      { name: 'Output decline', value: `${v.decline}%/yr`, source: src(v.tags.deg), note: v.srcs.deg }],
    steps,
    result: { label: 'NPV', value: usd(r.summary.npv) },
    checks: [
      ...(ok(irr) ? [{ label: 'IRR search converged: NPV at the reported IRR = 0', a: npvAt(irr), b: 0, tol: 1e-6 * Math.max(1, Math.abs(v.capex)), fmt: usd }] : []),
      ...(lcoeCheck ? [lcoeCheck] : []),
      { label: 'Arithmetic re-run: Σ discounted cash flows = finance engine', a: npvAt(rr), b: r.summary.npv, fmt: usd },
    ],
    csv: { name: `econ-finance-${S.nodeId}.csv`, meta: [['bus', S.nodeId], ['basis', 'pre-tax, unlevered; capital at year 0'], ['units', '$']], columns: ['year', 'operating_year', 'revenue_usd', 'om_usd', 'capex_usd', 'cash_flow_usd', 'discount_factor', 'discounted_usd'], rows: r.rows.map(row => [row.year, row.operatingYear, row.revenue, row.om, row.capex, row.projectCashFlow, 1 / (1 + rr) ** row.year, row.projectCashFlow / (1 + rr) ** row.year]) },
  });
}
