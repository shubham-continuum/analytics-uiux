"""Market → all-bus v2: /api/market (unified DB, Grid rules), any bus analysable, price-source filter, traces."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert t.count(old) == 1, f"{name}: expected one match for {old[:100]!r} (found {t.count(old)})"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


patch("app.js", [
    ("import { deepFreeze } from './decisioncore.js';", "import { deepFreeze } from './decisioncore.js';\nimport { prepare as prepareMarket } from './marketcore.js';"),
    ("  fetch('./data/study.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(`study.json ${r.status}`))))\n    .then(j => { D.study = j; render(); })",
     "  // Market v2: the same unified database and grid rules as Grid/Prices (was data/study.json, an older copy).\n"
     "  fetch('./api/market').then(r => (r.ok ? r.json() : Promise.reject(new Error(`market data ${r.status}`))))\n    .then(j => { D.study = prepareMarket(j); render(); })"),
    ("  'mkt-shoulder': (v, el) => { (S.ui.mkt ||= {}).shoulder = el.checked; },",
     "  'mkt-shoulder': (v, el) => { (S.ui.mkt ||= {}).shoulder = el.checked; },\n  'mkt-own': (v, el) => { (S.ui.mkt ||= {}).ownPrice = el.checked; },"),
])

patch("views/market.js", [
    ("// Market dashboard: where to investigate. ISO-wide screening over data/study.json (loaded on demand).\nimport { evaluate, rank, sizeSweep, regions, MEASURES, serviceLimits } from '../marketcore.js';",
     "// Market dashboard: where to investigate. ISO-wide screening over /api/market (unified database, Grid rules).\nimport { evaluate, rank, sizeSweep, regions, MEASURES, serviceLimits } from '../marketcore.js';\nimport { traceFind, traceRank, traceSize, traceRegions } from './market-trace.js';"),
    ("const details = (calc, assumptions, evidence) => `<details><summary>View calculation</summary>${calc}</details><details>", "const details = (calc, assumptions, evidence) => `<details>"),
    ("maxPrice2025: ok(m.maxPrice) ? m.maxPrice : null, minPrice2025: ok(m.minPrice) ? m.minPrice : null };",
     "maxPrice2025: ok(m.maxPrice) ? m.maxPrice : null, minPrice2025: ok(m.minPrice) ? m.minPrice : null, ownPriceNode: !!m.ownPrice };"),
    ("const evidence = study => `<p>ISO-wide study copy: ${fmt.int(study.nodes.length)} buses. Export headroom uses the element study (lowest facility transfer, same basis as Grid); shoulder cases use the substation envelope (vendor-asserted, unreconciled) and can be switched off. Prices: 2025 settled average at each bus's price node; about 1,460 buses read a nearby proxy node, which this copy does not flag per bus. Snapshot is a read-only copy of the Studio data.</p>`;",
     "const evidence = study => `<p>${fmt.int(study.nodes.length)} buses from the unified database (read-only), the same source as Prices, Grid and Economics. Limits are evaluated with the Grid page's rules, so every bus shows the same limit on both pages. Shoulder cases use the substation envelope (vendor-asserted, unreconciled) and the shoulder export case can be switched off. Prices: 2025 real-time average at each bus's price node; ${fmt.int(study.nodes.filter(n => n.tier === 'geo_proxy' && !(n.proxyKm < 0.05)).length)} buses borrow a neighbouring node's price (flagged per bus; filter them out with \"Require own price node\").</p>`;"),
    ("      <label class=\"field\">2025 price at least ($/MWh)", "      <label class=\"field\">2025 RT price at least ($/MWh)"),
    ("      <label class=\"field\">2025 price at most ($/MWh)", "      <label class=\"field\">2025 RT price at most ($/MWh)"),
    ("Storage charging at shoulder is always required.</label></div>`;",
     "Storage charging at shoulder is always required.</label>\n    <label class=\"inline-check\"><input type=\"checkbox\" data-act=\"mkt-own\" ${m.ownPrice ? 'checked' : ''}> Require own price node (exclude buses that borrow a neighbour's price)</label></div>`;"),
    ("    <p class=\"audit-note\">Scroll to zoom, drag to pan, click a bus to inspect it. Orange rings = buses with hourly price data in this preview.</p>`;",
     "    <p class=\"audit-note\">Scroll to zoom, drag to pan, click a bus to inspect it. Orange ring = the current candidate bus.</p>`;"),
    ("  const inPreview = data.nodes.some(n => String(n.id) === String(e.node.bus_id));\n", ""),
    ("      <dt>2025 average price</dt><dd>${fmt.price(e.node.lmp_2025)}/MWh</dd>",
     "      <dt>2025 average price</dt><dd>${fmt.price(e.node.lmp_2025)}/MWh <span class=\"audit-note\">${e.node.tier === 'geo_proxy' && !(e.node.proxyKm < 0.05) ? `borrowed from ${esc(e.node.pnode)}, ${Number(e.node.proxyKm).toFixed(1)} km` : esc(e.node.pnode)}</span></dd>"),
    ("<div class=\"actions\" style=\"margin-top:10px\">${inPreview ? `<button class=\"primary tiny\" data-act=\"pick-bus\" data-v=\"${e.node.bus_id}\">Analyse in Grid, Prices and Economics</button>` : '<span class=\"audit-note\">Hourly prices for this bus are not in the preview snapshot: screening only.</span>'}</div></div>`;",
     "<div class=\"actions\" style=\"margin-top:10px\"><button class=\"primary tiny\" data-act=\"pick-bus\" data-v=\"${e.node.bus_id}\">Analyse in Grid, Prices and Economics</button></div></div>`;"),
    ("  const preview = new Set(data.nodes.map(n => String(n.id)));\n", "  const candidate = new Set([String(S.nodeId)]);\n"),
    ("<td><button class=\"tiny\" data-act=\"map-bus\" data-v=\"${e.node.bus_id}\">Show</button> ${preview.has(String(e.node.bus_id)) ? `<button class=\"tiny\" data-act=\"pick-bus\" data-v=\"${e.node.bus_id}\">Analyse</button>` : ''}</td></tr>`).join('');",
     "<td><button class=\"tiny\" data-act=\"map-bus\" data-v=\"${e.node.bus_id}\">Show</button> <button class=\"tiny\" data-act=\"pick-bus\" data-v=\"${e.node.bus_id}\">Analyse</button></td></tr>`).join('');"),
    ("<div class=\"two-col map-grid\"><div>${map(ev, preview, S)}</div>", "<div class=\"two-col map-grid\"><div>${map(ev, candidate, S)}</div>"),
    ("    <div class=\"panel\">${details('<p>A bus meets the requirements when every applicable study case has a published limit",
     "    ${traceFind(data, S, ev, study.nodes.find(n => String(n.bus_id) === String(S.nodeId)) ? serviceLimits(study, study.nodes.find(n => String(n.bus_id) === String(S.nodeId)), S.tech) : [], r)}\n"
     "    <div class=\"panel\">${details('<p>A bus meets the requirements when every applicable study case has a published limit"),
    ("      ${details('<p>Score = mean of percentiles of the chosen measures among qualifying buses (direction per measure). Ties are broken by coverage, then bus id.</p>', '<p>Vendor solar capture is not offered as a measure: it is nearly flat across ISO-NE and barely separates buses.</p>', evidence(study))}</div>`;",
     "      ${traceRank(r, pri)}\n      ${details('<p>Score = mean of percentiles of the chosen measures among qualifying buses (direction per measure). Ties are broken by coverage, then bus id.</p>', '<p>The solar-hour price ratio uses the database mart\\'s solar weighting (not the clear-sky shape in Prices); it varies little across ISO-NE. The 4-hour spread is a gross benchmark, not battery revenue. The 2030 price is one forecast run (pcr2030), not an average of runs.</p>', evidence(study))}</div>`;"),
    ("  const lims = node ? serviceLimits(study, node, S.tech).filter(l => (S.ui.mkt || {}).shoulder !== false || l.key !== 'export-sh') : [];",
     "  const lims = node ? serviceLimits(study, node, S.tech).filter(l => (S.ui.mkt || {}).shoulder !== false || l.key !== 'export-sh') : [];\n"
     "  const metAtReq = evals(study, req(S)).filter(e => e.status === 'met').length;"),
    ("      ${details('<p>Directional margin = case limit − size.",
     "      ${traceSize(sw, Number(S.exportMW), metAtReq)}\n      ${details('<p>Directional margin = case limit − size."),
    ("      ${details('<p>Shares = buses meeting (or unknown) ÷ buses in the zone.",
     "      ${traceRegions(rg, evals(study, { ...req(S), zones: null }).filter(e => e.status !== 'excluded').length)}\n      ${details('<p>Shares = buses meeting (or unknown) ÷ buses in the zone."),
    ("  if (!ctx.data.study) return '<div class=\"empty\"><strong>Loading the ISO-wide study copy…</strong>About 15 MB, loaded once.</div>';",
     "  if (!ctx.data.study) return '<div class=\"loading-panel\" role=\"status\"><span class=\"spinner\" aria-hidden=\"true\"></span><b>Loading every ISO-NE bus</b><span>Limits, prices and facility rows for 2,678 buses from the local database (about 2 MB, loaded once).</span></div>';"),
])
print("ok")
