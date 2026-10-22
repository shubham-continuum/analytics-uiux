"""Economics re-review (PASS WITH FIXES) F1–F5, and two Grid trace-gate gaps."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert t.count(old) == 1, f"{name}: expected one match for {old[:100]!r} (found {t.count(old)})"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


# F1: work estimate + budget in the grid selector (measured ≈ 2.4e-8 s per state-move in the browser worker)
patch("dispatchgrid.js", [
    ("export const MIN_STATES = 40, MAX_STATES = 1500, TARGET = 0.95, FLOOR = 0.95;",
     "export const SEC_PER_MOVE = 2.4e-8, BUDGET_SEC = 20; // measured solver speed; a longer solve is not run in the browser\nexport const MIN_STATES = 40, MAX_STATES = 1500, TARGET = 0.95, FLOOR = 0.95;"),
    ("export function dispatchGrid({ energyMWh, chargeMW, dischargeMW, exportMW = dischargeMW, etaC = 1, etaD = 1, solarMW = null, dtHours = 1 }) {",
     "export function dispatchGrid({ energyMWh, chargeMW, dischargeMW, exportMW = dischargeMW, etaC = 1, etaD = 1, solarMW = null, dtHours = 1, hours = 8760 }) {"),
    ("  if (!out.feasible) out.reason = `No affordable grid",
     "  // Work ≈ hours × states × reachable moves per state (band width in steps).\n"
     "  out.moves = Math.ceil((cS + dS) / best.step) + 1; out.estSeconds = hours * best.states * out.moves * SEC_PER_MOVE;\n"
     "  if (out.feasible && out.estSeconds > BUDGET_SEC) { out.feasible = false; out.reason = `This battery needs a ${best.states}-step grid to represent its limits${solar ? ' and the hourly solar charging' : ''}; solving ${Math.round(hours).toLocaleString('en-US')} hours would take about ${Math.round(out.estSeconds)} s in the browser. Value not assessed: choose a single-year basis, a shorter duration or a larger battery-to-solar ratio.`; }\n"
     "  if (!out.feasible && !out.reason) out.reason = `No affordable grid"),
])
patch("views/economics.js", [
    ("  const grid = dispatchGrid({ energyMWh: mw * hours, chargeMW: chargeCap, dischargeMW: mw, exportMW: exportCap, etaC: eta, etaD: eta });",
     "  const dt = Math.min(...x.records.map(r => r.dtHours)); // F4: size to the finest interval\n  const grid = dispatchGrid({ energyMWh: mw * hours, chargeMW: chargeCap, dischargeMW: mw, exportMW: exportCap, etaC: eta, etaD: eta, dtHours: dt, hours: x.res.summary.hours });"),
    ("    const bm = pv * f, grid = dispatchGrid({ energyMWh: bm * val(S, 'duration'), chargeMW: bm, dischargeMW: bm, exportMW: poi, etaC: eta, etaD: eta, solarMW });",
     "    const bm = pv * f, grid = dispatchGrid({ energyMWh: bm * val(S, 'duration'), chargeMW: bm, dischargeMW: bm, exportMW: poi, etaC: eta, etaD: eta, solarMW, dtHours: Math.min(...recs.map(r => r.dtHours)), hours: x.res.summary.hours });"),
    ("<span>Runs in the background on ${fmt.int(grid?.states)} state-of-charge steps; the page stays usable and updates when it finishes.</span></div>`;",
     "<span>Runs in the background on ${fmt.int(grid?.states)} state-of-charge steps (about ${Math.max(1, Math.round(grid?.estSeconds || 1))} s); the page stays usable and updates when it finishes.</span></div>`;"),
    ("so value can be understated by up to ${Math.max(0, 100 - (100 * b.grid.usableDischargeMW) / Math.min(mw, ok(x.exportLimit) ? x.exportLimit : mw)).toFixed(0)}%.</p></div>",
     "so value can be understated by up to ${Math.max(0, 100 - 100 * Math.min(b.grid.usableChargeMW / (ok(x.importLimit) ? Math.min(mw, x.importLimit) : mw), b.grid.usableDischargeMW / Math.min(mw, ok(x.exportLimit) ? x.exportLimit : mw))).toFixed(1)}% (worse of charging and discharging).</p></div>"),
])
# F3: worker failure → solve inline and re-render
patch("dispatch-client.js", [
    ("    worker.onerror = () => { worker = false; };",
     "    worker.onerror = () => { worker = false; for (const k of PENDING) DONE.delete(k); PENDING.clear(); waiting.clear(); onReady(); }; // next render solves inline"),
])
# F5: honest labels; independent LCOE check from the projectFinance rows
patch("views/economics-trace.js", [
    ("{ label: 'Energy balance: delivered + spilled + losses + clipped at nameplate = MW × CF × hours (closed form)',",
     "{ label: 'Profile-scaling check: delivered + spilled + losses + clipped at nameplate = MW × CF × hours (closed form; confirms the CF scaling, not the loss or cap logic)',"),
    ("{ label: 'NPV at the IRR = 0 (independent of the discount rate you entered)',", "{ label: 'IRR search converged: NPV at the reported IRR = 0',"),
    ("    const first = v.construction + 1, pvRev = v.mwh.reduce((t, m, k) => t + (v.lc.value * m) / (1 + rr) ** (first + k), 0), pvCost = v.capex + v.mwh.reduce((t, _, k) => t + v.om / (1 + rr) ** (first + k), 0);\n    lcoeCheck = { label: 'LCOE definition: PV(LCOE × MWh) = PV(capital + O&M), summed year by year', a: pvRev, b: pvCost, fmt: usd };",
     "    // Independent of lcoe.js: costs from the finance engine's own year rows, MWh on the same operating years.\n"
     "    const pvCost = r.rows.reduce((t, row) => t + (row.capex + row.om) / (1 + rr) ** row.year, 0);\n"
     "    const pvMWh = r.rows.filter(row => row.operatingYear > 0).reduce((t, row) => t + (v.mwh[row.operatingYear - 1] ?? 0) / (1 + rr) ** row.year, 0);\n"
     "    lcoeCheck = { label: 'LCOE from the finance engine\\'s own cash-flow rows: PV(capital + O&M) ÷ PV(MWh)', a: pvMWh ? pvCost / pvMWh : null, b: v.lc.value, fmt: w => (ok(w) ? `$${w.toFixed(2)}/MWh` : 'not held') };"),
])
# Grid gate gaps: constraints trace always renders; mitigation always carries an independent check
patch("views/grid-trace.js", [
    ("export function traceConstraints(data, S, key, el, req) {\n  if (el.status !== 'held') return '';",
     "export function traceConstraints(data, S, key, el, req) {\n"
     "  if (el.status !== 'held') return trace({ id: 'g-constraints', title: `Facility loading · ${CASE_LABEL[key]}`, formula: 'Loading_f(MW) = |flow_f + sensitivity_f × MW| ÷ rating_f × 100', inputs: [{ name: 'Case', value: CASE_LABEL[key], source: 'user' }], steps: [{ label: 'Facility list', work: { noViolation: 'study reports no violations; tested maximum not published', unpublished: 'every listed facility is already overloaded', mislabel: 'store rows are mislabelled (large-load table)', none: 'no facility rows held' }[el.status] || el.status, value: '—' }], result: { label: 'Lowest facility limit', value: 'not held' }, notes: ['No check possible: there is no usable facility list for this case, so nothing is computed.'] });"),
    ("    check: ok(lim) && ok(lowest) && lowest <= lim + 1e-6 ? { label: 'Lowest facility transfer limit = largest size without upgrades (from the case table)', a: lowest, b: lim, atol: 1e-9, fmt: mwCheck } : undefined,",
     "    check: ok(lim) ? { label: 'Independent re-derivation of the largest size without upgrades from the raw rows and headroom table', a: (() => { const a = applicableCases(tech), e = dir === 'export' ? ownBinding(data.grid, S.nodeId, a.export) : ownBinding(data.grid, S.nodeId, a.import), c = ['storage', 'hybrid'].includes(tech) ? ownBinding(data.grid, S.nodeId, a.import) : null; return [e, c].filter(ok).length ? Math.min(...[e, c].filter(ok)) : null; })(), b: lim, atol: 1e-9, fmt: mwCheck } : undefined,"),
])
patch("tests/smoke-traces.mjs", [
    ("check(/Reconciles/.test(body) || /by construction/.test(body),", "check(/Reconciles/.test(body) || /by construction|No check possible/.test(body),"),
])
print("ok")
