"""Economics all-bus review (2026-09-29, verdict FAIL): H1 grid under-use, H2 hybrid $0 trap, M1 tautological
checks, M2 UI-blocking runtime, M3 weights, M4 envelope-only charge limit, M5 labels, L1–L5.
Core changes are in economics.js (stepMWh, band-limited DP) and dispatchgrid.js; this patches the view."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent
p = P / "views/economics.js"
t = p.read_text(encoding="utf-8")


def rep(old, new):
    global t
    assert t.count(old) == 1, f"expected one match: {old[:110]!r} (found {t.count(old)})"
    t = t.replace(old, new, 1)


rep("import { socStepsFor } from '../dispatchgrid.js';",
    "import { dispatchGrid } from '../dispatchgrid.js';\nimport { solve } from '../dispatch-client.js';")

# ---- inputs: L4 (sent null import stays null), M4 (charge-limit basis) ----
rep("  const importLimit = sent && ok(sent.importMW) ? sent.importMW : im.value;",
    "  const importLimit = sent ? (ok(sent.importMW) ? sent.importMW : null) : im.value;\n"
    "  // Review M4: the shoulder-charge case has no element rows in the store, so its limit is the vendor envelope.\n"
    "  const chargeBasis = sent ? `sent from Grid (${sent.importCase || 'case not recorded'})` : im.row?.basis || null;\n"
    "  const chargeEnvelopeOnly = !sent && /^Envelope/.test(im.row?.basis || '');")
rep("  return { res, records, exportLimit, importLimit, ex, im, gridSource, stalePrices, node, yearsEq };",
    "  return { res, records, exportLimit, importLimit, ex, im, gridSource, stalePrices, node, yearsEq, chargeBasis, chargeEnvelopeOnly };")

# ---- basis strip: M3 weights, M4 envelope disclosure ----
rep("    ${x.stalePrices ? '<br><span class=\"pill warn\">Prices changed since they were sent here: results use the current basis.</span>' : ''}</div>`;",
    "    ${x.stalePrices ? '<br><span class=\"pill warn\">Prices changed since they were sent here: results use the current basis.</span>' : ''}\n"
    "    ${ctx.S.basis?.weighting && ctx.S.basis.weighting !== 'duration' ? '<br><span class=\"pill warn\">Year weights</span> Economics weights the selected years by their observed hours; your equal or custom year weights apply only to the Prices headline.' : ''}\n"
    "    ${x.chargeEnvelopeOnly && ['storage', 'hybrid'].includes(ctx.S.tech) ? '<br><span class=\"pill warn\">Charge limit is the substation envelope</span> vendor-asserted and not reconciled with a facility study, so storage results are conditional on it.' : ''}</div>`;")

# ---- gate: M5 wording ----
rep("Results are conditional on those upgrades (Grid › Upgrade cost allocator).` };",
    "Values below are for output capped at the limit (no upgrades); the full size needs upgrades (Grid › Upgrade cost allocator).` };")

# ---- no-history buses: L5 ----
NOBASIS = "  if (!x.res.summary) return `<div class=\"notice error\">Apply a valid price basis in Prices first.</div>`;"
assert t.count(NOBASIS) == 3
t = t.replace(NOBASIS, "  if (!x.res.summary) return noBasis(ctx);")
rep("const needSize = S =>",
    "const noBasis = ctx => (ctx.data.series.some(s => String(s.nodeId) === String(ctx.S.nodeId) && s.mode === 'historical')\n"
    "  ? '<div class=\"notice error\">Apply a valid price basis in Prices first.</div>'\n"
    "  : '<div class=\"notice error\">No price history is held for this bus\\'s node. Choose a forecast run in Prices › LMP &amp; years.</div>');\n"
    "const needSize = S =>")

# ---- revenue: L1 losses before the cap, L2 capacity at the connection, L5 proxy flag, new trace inputs ----
rep("  const recs = tech === 'solar' ? solarRecords(x.records, x.node, mw, cf) : x.records.map(r => ({ ...r, generationMW: mw * cf }));\n"
    "  const clipped = recs.map(r => ({ ...r, generationMW: Math.min(r.generationMW, cap) }));\n"
    "  const g = generationRevenue(clipped, { lossPct: loss });",
    "  // Review L1: losses first, then the connection cap (as in Hybrid), so both tabs give the same solar-only value.\n"
    "  const recs = tech === 'solar' ? solarRecords(x.records, x.node, mw, cf) : x.records.map(r => ({ ...r, generationMW: mw * cf }));\n"
    "  const afterLoss = recs.map(r => ({ ...r, generationMW: r.generationMW * (1 - loss / 100) }));\n"
    "  const clipped = afterLoss.map(r => ({ ...r, generationMW: Math.min(r.generationMW, cap) }));\n"
    "  const g = generationRevenue(clipped, { lossPct: 0 });")
rep("  const capacity = mw * 1000 * (acc / 100) * val(S, 'capacityPrice') * 12;\n  const headline = energy + (rec ?? 0);",
    "  const capMW = Math.min(mw, cap), capacity = capMW * 1000 * (acc / 100) * val(S, 'capacityPrice') * 12; // review L2: at the connection\n  const headline = energy + (rec ?? 0);")
rep("conditional: !g0.ok, at: new Date().toISOString() };\n  const spill = recs.reduce((t, r, i) => t + (r.generationMW - clipped[i].generationMW) * r.dtHours, 0) / n;",
    "conditional: !g0.ok, proxy: tech === 'wind', at: new Date().toISOString() };\n  const spill = afterLoss.reduce((t, r, i) => t + (r.generationMW - clipped[i].generationMW) * r.dtHours, 0) / n;")
rep("${kpi('Revenue per year', fmt.money(headline), g0.ok ? '' : ' conditional',",
    "${kpi(g0.ok ? 'Revenue per year' : 'Revenue per year at the limit', fmt.money(headline), g0.ok ? '' : ' conditional',")
rep("    ${traceRevenue(S, x.node, x, { tech, mw, cfPct: cf * 100, loss, cap, recs, clipped, energy, mwh, rec, recPrice, recMarket: market[1], capPrice: val(S, 'capacityPrice'), acc, capacity, headline, shapeMean: recs.shapeMean,",
    "    ${traceRevenue(S, x.node, x, { tech, mw, cf, loss, cap, raw: recs, afterLoss, clipped, energy, mwh, rec, recPrice, recMarket: market[1], capPrice: val(S, 'capacityPrice'), capMW, acc, capacity, headline,")
rep("Delivered = min(profile × MW, connection limit) × (1 − losses).", "Delivered = min(profile × MW × (1 − losses), connection limit).")
rep("Capacity = MW × accreditation × $/kW-month × 12 (shown, not in the headline).", "Capacity = min(MW, connection limit) × accreditation × $/kW-month × 12 (shown, not in the headline).")

# ---- battery: sized grid + background solve (H1, M2) ----
rep("""function battery(ctx, mw, hours, x) {
  const S = ctx.S, k = JSON.stringify(['bess', basisHash(S.basis), S.nodeId, mw, hours, x.importLimit, x.exportLimit, val(S, 'rte'), val(S, 'cycleCost')]);
  return memo(k, () => {
    const eta = Math.sqrt(val(S, 'rte') / 100);
    const chargeCap = ok(x.importLimit) ? Math.min(mw, x.importLimit) : mw, exportCap = ok(x.exportLimit) ? Math.min(mw, x.exportLimit) : mw;
    // Size the SOC grid to the tightest limit; a grid too coarse to move one step an hour returned $0 (Economics gate, 2026-09-29).
    const grid = socStepsFor({ energyMWh: mw * hours, chargeMW: chargeCap, dischargeMW: exportCap, etaC: eta, etaD: eta });
    if (!grid.feasible) return { errors: [grid.reason], summary: {}, rows: [], notAssessed: true };
    const r = batteryDispatch(x.records, { capacityMW: mw, energyMWh: mw * hours, chargeMW: chargeCap, importMW: chargeCap, exportMW: exportCap, chargeEfficiency: eta, dischargeEfficiency: eta, cycleCostPerMWh: val(S, 'cycleCost'), socSteps: grid.steps });
    r.socSteps = grid.steps;
    return r;
  });
}""",
"""/** Battery dispatch on a grid sized to the limits (dispatchgrid.js), solved in the background. {pending} while solving. */
function battery(ctx, mw, hours, x) {
  const S = ctx.S, eta = Math.sqrt(val(S, 'rte') / 100);
  const chargeCap = ok(x.importLimit) ? Math.min(mw, x.importLimit) : mw, exportCap = ok(x.exportLimit) ? Math.min(mw, x.exportLimit) : mw;
  const grid = dispatchGrid({ energyMWh: mw * hours, chargeMW: chargeCap, dischargeMW: mw, exportMW: exportCap, etaC: eta, etaD: eta });
  if (!grid.feasible) return { errors: [grid.reason], summary: {}, rows: [], notAssessed: true, grid };
  const k = JSON.stringify(['bess', basisHash(S.basis), S.nodeId, mw, hours, chargeCap, exportCap, val(S, 'rte'), val(S, 'cycleCost'), grid.stepMWh]);
  const r = solve('battery', k, x.records, { capacityMW: mw, energyMWh: mw * hours, chargeMW: chargeCap, importMW: chargeCap, exportMW: exportCap, chargeEfficiency: eta, dischargeEfficiency: eta, cycleCostPerMWh: val(S, 'cycleCost'), stepMWh: grid.stepMWh });
  return r ? { ...r, grid } : { pending: true, grid, errors: [] };
}
const solvingPanel = (x, what, grid) => `<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Optimising ${what} over ${fmt.int(x.res.summary?.hours)} hours</b><span>Runs in the background on ${fmt.int(grid?.states)} state-of-charge steps; the page stays usable and updates when it finishes.</span></div>`;""")
rep("  const b = battery(ctx, mw, dur, x);\n  if (b.errors.length) return",
    "  const b = battery(ctx, mw, dur, x);\n  if (b.pending) return `${basisStrip(ctx, x)}${solvingPanel(x, `a ${fmt.mw(mw)} / ${fmt.int(mw * dur)} MWh battery`, b.grid)}`;\n  if (b.errors.length) return")
rep("  const n = x.yearsEq, s = b.summary, cond = !gc.ok || !ge.ok;",
    "  const n = x.yearsEq, s = b.summary, cond = !gc.ok || !ge.ok || x.chargeEnvelopeOnly;")
rep("  const capacity = mw * 1000 * (val(S, 'accStorage') / 100) * val(S, 'capacityPrice') * 12;\n  const days = s.hours / 24;",
    "  const capacity = Math.min(mw, ok(x.exportLimit) ? x.exportLimit : mw) * 1000 * (val(S, 'accStorage') / 100) * val(S, 'capacityPrice') * 12;\n  const days = s.hours / 24;")
rep("  const durations = [2, 4, 8].map(d => { const r = battery(ctx, mw, d, x); return { label: `${d}-hour`, value: r.errors.length ? null : r.summary.netValue / n / (mw * 1000) }; });",
    "  const durations = [2, 4, 8].map(d => { const r = battery(ctx, mw, d, x); return { label: `${d}-hour`, value: r.pending || r.errors.length ? null : r.summary.netValue / n / (mw * 1000), note: r.pending ? 'solving…' : r.errors[0] || '' }; });")
rep("<p class=\"audit-note\">Battery sliders recompute when you release them (each year of dispatch takes about half a second).</p>",
    "<p class=\"audit-note\">Battery sliders recompute when you release them; the dispatch runs in the background.</p>")
rep("The state of charge is solved on a ${b.socSteps}-step grid (sized so the tightest limit can move one step an hour), which slightly understates value.</p></div>",
    "Solved on ${fmt.int(b.grid.states)} state-of-charge steps of ${b.grid.stepMWh.toFixed(2)} MWh: the solver can use ${fmt.mw(b.grid.usableChargeMW)} of charging and ${fmt.mw(b.grid.usableDischargeMW)} of discharging (whole steps per hour), so value can be understated by up to ${Math.max(0, 100 - (100 * b.grid.usableDischargeMW) / Math.min(mw, ok(x.exportLimit) ? x.exportLimit : mw)).toFixed(0)}%.</p></div>")
rep("<p class=\"audit-note\">Same prices and limits; only energy (MWh) changes.</p>",
    "<p class=\"audit-note\">Same prices and limits; only energy (MWh) changes.${durations.some(d => d.note === 'solving…') ? ' Other durations are still solving.' : ''}</p>")
rep("${kpi('Arbitrage value', fmt.money(s.netValue / n), cond ? '/yr conditional' : '/yr',",
    "${kpi(ge.ok ? 'Arbitrage value' : 'Arbitrage value at the limit', fmt.money(s.netValue / n), cond ? '/yr conditional' : '/yr',")
rep("${traceBess(S, x.node, x, { b, mw, dur,", "${traceBess(S, x.node, x, { b, mw, dur, chargeBasis: x.chargeBasis,")
rep("Each year of dispatch takes about half a second to compute.</p>`)}", "Dispatch runs in a background worker.</p>`)}")

# ---- hybrid: sized grid, background solve, conditional label (H2, M2, L5) ----
rep("""  const configs = [0, 0.25, 0.5, 1].map(f => memo(JSON.stringify(['hyb', basisHash(S.basis), S.nodeId, pv, poi, cf, loss, f, val(S, 'duration'), val(S, 'rte'), val(S, 'cycleCost')]), () => {
    if (f === 0) { const g = generationRevenue(recs.map(r => ({ ...r, generationMW: Math.min(r.generationMW, poi) })), { lossPct: 0 }); return { f, mw: 0, value: g.summary.merchantRevenue / n, spill: recs.reduce((t, r) => t + Math.max(0, r.generationMW - poi) * r.dtHours, 0) / n, errors: g.errors }; }
    const bm = pv * f, h = hybridDispatch(recs, { renewableCapacityMW: pv, capacityMW: bm, energyMWh: bm * val(S, 'duration'), exportMW: poi, importMW: 0, gridCharging: false, chargeEfficiency: eta, dischargeEfficiency: eta, cycleCostPerMWh: val(S, 'cycleCost'), socSteps: 30 });
    return { f, mw: bm, value: h.errors.length ? null : h.summary.netValue / n, spill: h.errors.length ? null : h.summary.curtailedMWh / n, errors: h.errors, rows: h.errors.length ? null : h.rows };
  }));""",
"""  const solarMW = recs.map(r => r.generationMW);
  const configs = [0, 0.25, 0.5, 1].map(f => {
    if (f === 0) return memo(JSON.stringify(['hyb0', basisHash(S.basis), S.nodeId, pv, poi, cf, loss]), () => { const g = generationRevenue(recs.map(r => ({ ...r, generationMW: Math.min(r.generationMW, poi) })), { lossPct: 0 }); return { f, mw: 0, value: g.summary.merchantRevenue / n, spill: recs.reduce((t, r) => t + Math.max(0, r.generationMW - poi) * r.dtHours, 0) / n, errors: g.errors }; });
    // Review H2: the old fixed 30-step grid could not absorb small solar hours ($0); size it to the battery and the solar.
    const bm = pv * f, grid = dispatchGrid({ energyMWh: bm * val(S, 'duration'), chargeMW: bm, dischargeMW: bm, exportMW: poi, etaC: eta, etaD: eta, solarMW });
    if (!grid.feasible) return { f, mw: bm, value: null, spill: null, errors: [grid.reason], grid };
    const h = solve('hybrid', JSON.stringify(['hyb', basisHash(S.basis), S.nodeId, pv, poi, cf, loss, f, val(S, 'duration'), val(S, 'rte'), val(S, 'cycleCost'), grid.stepMWh]), recs, { renewableCapacityMW: pv, capacityMW: bm, energyMWh: bm * val(S, 'duration'), exportMW: poi, importMW: 0, gridCharging: false, chargeEfficiency: eta, dischargeEfficiency: eta, cycleCostPerMWh: val(S, 'cycleCost'), stepMWh: grid.stepMWh });
    if (!h) return { f, mw: bm, pending: true, grid, errors: [] };
    return { f, mw: bm, value: h.errors.length ? null : h.summary.netValue / n, spill: h.errors.length ? null : h.summary.curtailedMWh / n, errors: h.errors, rows: h.errors.length ? null : h.rows, grid };
  });
  if (configs.some(c => c.pending)) return `${basisStrip(ctx, x)}${solvingPanel(x, `${configs.filter(c => c.pending).length} storage configurations`, configs.find(c => c.pending).grid)}`;""")
rep("${kpi('Incremental value (best)', best ? fmt.money(best.value - base) : '—', '/yr', 'Compare with storage capital cost in Project finance')}",
    "${kpi('Incremental value (best)', best ? fmt.money(best.value - base) : '—', g0.ok ? '/yr' : '/yr conditional', 'Compare with storage capital cost in Project finance')}")

# ---- finance: L3 tech in the cost match, L5 proxy note, LCOE check inputs ----
rep("  const costMatch = cost && String(cost.busId) === String(S.nodeId) && Number(cost.size) === Number(cost.dir === 'import' ? S.importMW : S.exportMW);",
    "  const costMatch = cost && String(cost.busId) === String(S.nodeId) && Number(cost.size) === Number(cost.dir === 'import' ? S.importMW : S.exportMW) && (!cost.tech || cost.tech === (S.tech === 'datacenter' ? 'datacenter' : S.tech));")
rep("revSource: ok(f.annualRevenue) ? 'U' : 'Sent', decline: val(S, 'degradation'),",
    "revSource: ok(f.annualRevenue) ? 'U' : 'Sent', proxy: !ok(f.annualRevenue) && revMatch && rev.proxy, mwh: ok(mwh) ? Array.from({ length: f.years }, (_, t) => mwh * (1 - d) ** t) : null, decline: val(S, 'degradation'),")
p.write_text(t, encoding="utf-8")

# app: re-render when a background dispatch finishes
a = P / "app.js"
s = a.read_text(encoding="utf-8")
old = "import { resetTraces, downloadCsv } from './trace.js';"
assert s.count(old) == 1
s = s.replace(old, old + "\nimport { setOnReady } from './dispatch-client.js';", 1)
old = "export async function mount(opts = {}) {\n  ONLY = opts.only || null;"
assert s.count(old) == 1
s = s.replace(old, "export async function mount(opts = {}) {\n  ONLY = opts.only || null;\n  setOnReady(() => render());", 1)
old = "(window.GS_STANDALONE ? Promise.resolve() : boot())"
assert s.count(old) == 1
s = s.replace(old, "(window.GS_STANDALONE ? Promise.resolve() : (setOnReady(() => render()), boot()))", 1)
a.write_text(s, encoding="utf-8")
print("ok")
