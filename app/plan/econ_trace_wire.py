"""Wire Economics traces; replace the inline LCOE (ignored construction delay) with lcoe.js."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent
p = P / "views/economics.js"
t = p.read_text(encoding="utf-8")


def rep(old, new):
    global t
    assert t.count(old) == 1, f"expected one match: {old[:100]!r} (found {t.count(old)})"
    t = t.replace(old, new, 1)


rep("import { lineChart, barChart } from '../charts.js';",
    "import { lineChart, barChart } from '../charts.js';\nimport { lcoe as lcoeCalc } from '../lcoe.js';\nimport { traceRevenue, traceBess, traceHybrid, traceFinance } from './economics-trace.js';")
rep("const details = (calc, assumptions, evidence) => `<details><summary>View calculation</summary>${calc}</details><details>",
    "const details = (calc, assumptions, evidence) => `<details>")
# solar shape mean travels with the records for the trace
rep("  return records.map((r, i) => ({ ...r, generationMW: mean ? Math.min(mw, (mw * cf * shape[i]) / mean) : 0 }));",
    "  const out = records.map((r, i) => ({ ...r, generationMW: mean ? Math.min(mw, (mw * cf * shape[i]) / mean) : 0 }));\n  out.shapeMean = mean;\n  return out;")

# ---- Revenue ----
rep("    <div class=\"handoff\"><div><strong>Use this revenue in Project finance</strong>",
    "    ${traceRevenue(S, x.node, x, { tech, mw, cfPct: cf * 100, loss, cap, recs, clipped, energy, mwh, rec, recPrice, recMarket: market[1], capPrice: val(S, 'capacityPrice'), acc, capacity, headline, shapeMean: recs.shapeMean, tags: { cf: tag(S, tech === 'wind' ? 'windCF' : 'solarCF'), loss: tag(S, 'lossPct'), rec: tag(S, 'rec') }, srcs: { cf: DEFAULTS[tech === 'wind' ? 'windCF' : 'solarCF'][2], loss: DEFAULTS.lossPct[2] } })}\n"
    "    <div class=\"handoff\"><div><strong>Use this revenue in Project finance</strong>")

# ---- BESS ----
rep("      <div class=\"handoff\"><div><strong>Use this storage value in Project finance</strong>",
    "      ${traceBess(S, x.node, x, { b, mw, dur, rte: val(S, 'rte'), cycleCost: val(S, 'cycleCost'), chargeCap: ok(x.importLimit) ? Math.min(mw, x.importLimit) : mw, exportCap: ok(x.exportLimit) ? Math.min(mw, x.exportLimit) : mw, tags: { dur: tag(S, 'duration'), rte: tag(S, 'rte'), cyc: tag(S, 'cycleCost') }, srcs: { dur: DEFAULTS.duration[2], rte: DEFAULTS.rte[2], cyc: DEFAULTS.cycleCost[2] } })}\n"
    "      <div class=\"handoff\"><div><strong>Use this storage value in Project finance</strong>")

# ---- Hybrid: keep the dispatch rows for the trace ----
rep("    return { f, mw: bm, value: h.errors.length ? null : h.summary.netValue / n, spill: h.errors.length ? null : h.summary.curtailedMWh / n, errors: h.errors };",
    "    return { f, mw: bm, value: h.errors.length ? null : h.summary.netValue / n, spill: h.errors.length ? null : h.summary.curtailedMWh / n, errors: h.errors, rows: h.errors.length ? null : h.rows };")
rep("      ${details('<p>One shared hourly energy balance",
    "      ${traceHybrid(S, x.node, x, { best, pv, poi, dur: val(S, 'duration'), base })}\n      ${details('<p>One shared hourly energy balance")

# ---- Finance: LCOE on the projectFinance timeline ----
rep("      const crf = rr > 0 ? (rr * (1 + rr) ** f.years) / ((1 + rr) ** f.years - 1) : 1 / f.years;\n"
    "      const disc = t => 1 / (1 + rr) ** (t + 1);\n"
    "      const lev = ok(mwh) ? Array.from({ length: f.years }, (_, t) => mwh * (1 - d) ** t * disc(t)).reduce((a, b) => a + b, 0) / Array.from({ length: f.years }, (_, t) => disc(t)).reduce((a, b) => a + b, 0) : null;\n"
    "      const lcoe = ok(lev) && lev > 0 ? (crf * (f.capex + upgrade) + f.annualOM) / lev : null;",
    "      // Same timeline as projectFinance: capital at year 0, output from year constructionYears + 1 (review: the old CRF form ignored the delay).\n"
    "      const lc = lcoeCalc({ capex: f.capex + upgrade, annualOM: f.annualOM, rate: rr, years: f.years, constructionYears: f.constructionYears, mwh: ok(mwh) ? Array.from({ length: f.years }, (_, t) => mwh * (1 - d) ** t) : null });\n"
    "      const lcoe = lc.value;")
rep("Capital recovery + O&M ÷ levelised MWh",
    "PV(capital + O&M) ÷ PV(MWh), same timeline as NPV")
rep("        <div class=\"panel\"><h2>Annual cash flow</h2>${barChart(r.rows.map(x => ({ label: String(x.year), value: x.projectCashFlow })), { fmt: v => fmt.money(v), title: 'Annual project cash flow' })}</div>`;",
    "        <div class=\"panel\"><h2>Annual cash flow</h2>${barChart(r.rows.map(x => ({ label: String(x.year), value: x.projectCashFlow })), { fmt: v => fmt.money(v), title: 'Annual project cash flow' })}\n"
    "        ${traceFinance(S, { r, rate: rr, capex: f.capex + upgrade, upgrade, om: f.annualOM, construction: f.constructionYears, years: f.years, revenue1: annualRevenue, revSource: ok(f.annualRevenue) ? 'U' : 'Sent', decline: val(S, 'degradation'), tags: { deg: tag(S, 'degradation') }, srcs: { deg: DEFAULTS.degradation[2] }, lc })}</div>`;")
rep("LCOE = (CRF × capital + O&M) ÷ levelised MWh.", "LCOE = PV(capital + O&M) ÷ PV(MWh) on the same timeline as NPV.")
p.write_text(t, encoding="utf-8")
print("ok")
