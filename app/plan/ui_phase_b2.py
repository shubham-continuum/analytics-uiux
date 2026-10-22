"""Phase B interactions for Economics, Prices, Queue, Land and Decision, plus the KPI font fix."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in t, f"{name}: MISSING {old[:80]}"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


# ---------- KPI font: body face with tabular figures (mono spaced out thousands separators) ----------
css = P / "app.css"
t = css.read_text(encoding="utf-8").replace(".kpi .value{font-family:'Cascadia Mono',Consolas,ui-monospace,monospace;font-size:32px;letter-spacing:-1.2px}",
                                           ".kpi .value{font-size:32px;letter-spacing:-1px;font-weight:650;font-feature-settings:'tnum' 1}")
t += "\n.week-bar{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--muted);margin:6px 0 2px}.week-bar input{flex:1;accent-color:var(--primary)}\n.site-map{max-width:420px}\n"
css.write_text(t, encoding="utf-8")

# ---------- Economics: sliders + dispatch week scrubber ----------
patch("views/economics.js", [
    ("const REC_MARKETS = [",
     "// Slider variant of `input`. live = recompute while dragging (light calcs); otherwise on release.\n"
     "const slider = (S, k, label, unit, min, max, step, live = true) => `<div class=\"range-field\"><span>${esc(label)} <span class=\"pill ${tag(S, k) === 'P' ? 'warn' : ''}\" title=\"${esc(DEFAULTS[k][2])}\">${tag(S, k)}</span> <span class=\"audit-note\">${esc(unit)}</span></span><div class=\"row\"><input type=\"range\" min=\"${min}\" max=\"${max}\" step=\"${step}\" value=\"${val(S, k)}\" data-act=\"econ\" data-k=\"${k}\" ${live ? 'data-live' : ''} aria-label=\"${esc(label)}\"><output>${val(S, k)}</output></div><span class=\"audit-note\">${esc(DEFAULTS[k][2])}</span></div>`;\n"
     "const REC_MARKETS = ["),
    ("        ${input(S, tech === 'wind' ? 'windCF' : 'solarCF', 'Capacity factor', '%')}${input(S, 'lossPct', 'Losses', '%')}",
     "        ${slider(S, tech === 'wind' ? 'windCF' : 'solarCF', 'Capacity factor', '%', 5, 50, 0.5)}${slider(S, 'lossPct', 'Losses', '%', 0, 15, 0.5)}"),
    ("<div class=\"panel\"><h2>Battery</h2><div class=\"form-grid\">${input(S, 'duration', 'Duration', 'hours', 1)}${input(S, 'rte', 'Round-trip efficiency', '%')}${input(S, 'cycleCost', 'Cycling cost', '$/MWh discharged')}</div>",
     "<div class=\"panel\"><h2>Battery</h2><div class=\"form-grid\">${slider(S, 'duration', 'Duration', 'hours', 1, 8, 1, false)}${slider(S, 'rte', 'Round-trip efficiency', '%', 70, 95, 1, false)}${slider(S, 'cycleCost', 'Cycling cost', '$/MWh discharged', 0, 50, 1, false)}</div><p class=\"audit-note\">Battery sliders recompute when you release them (each year of dispatch takes about half a second).</p>"),
    ("  const soc = b.rows.slice(0, 168).map((r, i) => ({ x: i, y: r.socEndMWh })), price = b.rows.slice(0, 168).map((r, i) => ({ x: i, y: r.price }));",
     "  const weeks = Math.max(1, Math.floor(b.rows.length / 168)), wk = Math.min(weeks, Math.max(1, Number(S.ui.week) || 1)), w0 = (wk - 1) * 168;\n"
     "  const soc = b.rows.slice(w0, w0 + 168).map((r, i) => ({ x: i, y: r.socEndMWh })), price = b.rows.slice(w0, w0 + 168).map((r, i) => ({ x: i, y: r.price }));\n"
     "  const wkStart = String(b.rows[w0]?.timestamp || '').slice(0, 10);"),
    ("<div class=\"panel\"><div class=\"panel-head\"><div><h2>First week of dispatch</h2><p class=\"sub\">State of charge (MWh, solid) and hourly price ($/MWh, dashed)</p></div></div>",
     "<div class=\"panel\"><div class=\"panel-head\"><div><h2>Dispatch: week ${wk} of ${weeks}</h2><p class=\"sub\">From ${esc(wkStart)} · state of charge (MWh, solid) and hourly price ($/MWh, dashed)</p></div></div>\n"
     "      <div class=\"week-bar\"><span>Week</span><input type=\"range\" min=\"1\" max=\"${weeks}\" step=\"1\" value=\"${wk}\" data-act=\"ui\" data-k=\"week\" data-live aria-label=\"Dispatch week\"><output>${wk}</output></div>"),
])

# ---------- Prices: month × hour heatmap; price threshold slider ----------
patch("views/prices.js", [
    ("import { barChart, lineChart } from '../charts.js';", "import { barChart, lineChart, heatmap } from '../charts.js';"),
    ("      <h2 style=\"margin-top:18px\">Capture by month</h2>",
     "      <h2 style=\"margin-top:18px\">Price by month and hour</h2><p class=\"sub\">Hover a cell for the average; darker = higher</p>\n"
     "      ${heatmap(MONTHS.map((m, mi) => ({ label: m, cells: Array.from({ length: 24 }, (_, h) => { const rs = res.rows.filter(r => Number(String(r.timestamp).slice(5, 7)) === mi + 1 && Number(String(r.timestamp).slice(11, 13)) === h), hh = rs.reduce((t, r) => t + r.dtHours, 0); return { label: `${h}:00`, value: hh ? rs.reduce((t, r) => t + r.price * r.dtHours, 0) / hh : null }; }) })), { fmt: v => `$${v.toFixed(0)}`, title: 'Price by month and hour' })}\n"
     "      <h2 style=\"margin-top:18px\">Capture by month</h2>"),
    ("      <h2 style=\"margin-top:18px\">Distribution</h2>",
     "      ${(() => { const thr = Number.isFinite(Number(S.ui.thr)) ? Number(S.ui.thr) : 100, hrs = rows.filter(r => r.price > thr).reduce((t, r) => t + r.dtHours, 0); return `<div class=\"range-field\" style=\"margin-top:10px\"><span>Hours above a price threshold</span><div class=\"row\"><input type=\"range\" min=\"0\" max=\"500\" step=\"5\" value=\"${thr}\" data-act=\"ui\" data-k=\"thr\" data-live aria-label=\"Price threshold\"><output>${thr}</output><span class=\"audit-note\">$/MWh</span></div><b>${fmt.int(hrs)} hours</b> above $${thr}/MWh (${fmt.pct((100 * hrs) / hours)} of observed hours)</div>`; })()}\n"
     "      <h2 style=\"margin-top:18px\">Distribution</h2>"),
])

# ---------- Queue: request drawers, schedule gantt, cash chart ----------
p = P / "views/queue.js"
t = p.read_text(encoding="utf-8")
t = t.replace("import { barChart } from '../charts.js';", "import { barChart, gantt } from '../charts.js';")
old = "  const rows = list.map(x => `<tr><td>${esc(x.q.queue_position)}</td>"
assert old in t
t = t.replace(old, """  const drawers = list.map(x => `<template data-drawer="q-${esc(x.q.queue_position)}" data-title="Queue #${esc(x.q.queue_position)}"><dl>
    <dt>Point of interconnection</dt><dd>${esc(x.q.poi_name)}</dd><dt>Requested</dt><dd>${fmt.mw(x.q.max_mw)} · ${esc(RES[x.q.resource_type] || x.q.resource_type || '—')}</dd>
    <dt>Service</dt><dd>${esc(SERVICE[x.q.interconnection_service_requested] || 'not held')}</dd><dt>Status</dt><dd>${esc(x.q.status)}</dd>
    <dt>Requested on</dt><dd>${esc(x.q.request_date)} (${esc(x.era)})</dd><dt>Projected in service</dt><dd>${esc(x.q.projected_is_date || 'not held')}</dd>
    <dt>Summer study MW</dt><dd>${ok(x.q.summer_mw_modelled) ? fmt.mw(x.q.summer_mw_modelled) : 'not held'} (${esc(x.inModel)})</dd>
    <dt>Distance</dt><dd>${ok(x.distance) ? x.distance.toFixed(1) + ' mi' : '—'} · matched by ${esc(x.match)}</dd><dt>County</dt><dd>${esc(x.q.county || '')} ${esc(x.q.state || '')}</dd></dl>
    <p class="audit-note">Being nearby does not show that this request loads the same facilities as your project.</p></template>`).join('');
""" + old.replace("`<tr><td>", "`<tr class=\"clickable\" tabindex=\"0\" data-open-drawer=\"q-${esc(x.q.queue_position)}\"><td>"), 1)
old = "  return `<div class=\"panel\"><div class=\"panel-head\"><div><h2>Requests near ${esc(node?.name)}</h2>"
assert old in t
t = t.replace(old, "  return `${drawers}<div class=\"panel\"><div class=\"panel-head\"><div><h2>Requests near ${esc(node?.name)}</h2>", 1)
old = "    <div class=\"panel\"><h2>Study steps</h2><div class=\"table-wrap\">"
assert old in t
t = t.replace(old, """    <div class="panel"><h2>Study steps</h2>${(() => { let tt = band ? Date.parse(band.rows[0]?.from?.replace('closed ', '')) : NaN; const tasks = []; for (const r of band?.rows || []) { if (r.step === 'Cluster request window') continue; if (Number.isFinite(r.used)) { tasks.push({ label: r.step, start: tt, end: tt + r.used * 864e5, note: r.note }); tt += r.used * 864e5; } else tasks.push({ label: r.step, start: tt, end: null, note: r.note || 'No federal clock' }); } return Number.isFinite(tasks[0]?.start) ? gantt(tasks, { title: 'Study schedule' }) : ''; })()}<div class="table-wrap">""", 1)
old = "    <div class=\"panel\"><h2>By phase</h2><div class=\"table-wrap\">"
assert old in t
t = t.replace(old, "    <div class=\"panel\"><h2>By phase</h2>${barChart(c.phases.map(p => ({ label: p.phase.replace(' (if triggered)', ''), value: p.cashPosted, note: ok(p.penaltyIfWithdrawn) ? `Forfeit if withdrawn: ${usd(p.penaltyIfWithdrawn)}` : 'Forfeit not held' })), { fmt: v => usd(v), title: 'Cash posted by phase', emptyText: 'Later phases need an allocated upgrade cost from Grid.' })}<div class=\"table-wrap\">", 1)
p.write_text(t, encoding="utf-8")

# ---------- Land: click a local map to place the site ----------
patch("views/land.js", [
    ("  const c = corridor(site, node, { routeFactor: ok(L.route) ? L.route : 1.2, perMile: L.perMile, terminal: L.terminal, crossings: L.crossings });\n  return `<div class=\"panel\"><h2>Site and line assumptions</h2><div class=\"form-grid\">",
     "  const c = corridor(site, node, { routeFactor: ok(L.route) ? L.route : 1.2, perMile: L.perMile, terminal: L.terminal, crossings: L.crossings });\n"
     "  // Local map: ±0.15° around the bus. Clicking places the site (latitude/longitude fill in).\n"
     "  const bl = node?.latitude, bo = node?.longitude, R = 0.15, SZ = 400, px = lo => ((lo - (bo - R)) / (2 * R)) * SZ, py = la => SZ - ((la - (bl - R)) / (2 * R)) * SZ;\n"
     "  const ring = mi => `<circle cx=\"${SZ / 2}\" cy=\"${SZ / 2}\" r=\"${(mi / 69 / (2 * R)) * SZ}\" fill=\"none\" stroke=\"#cfdbe1\" stroke-dasharray=\"4 4\"/><text x=\"${SZ / 2 + (mi / 69 / (2 * R)) * SZ + 3}\" y=\"${SZ / 2 - 3}\" font-size=\"10\" fill=\"#7d8f99\">${mi} mi</text>`;\n"
     "  const siteMap = ok(bl) && ok(bo) ? `<div class=\"site-map\"><svg viewBox=\"0 0 ${SZ} ${SZ}\" data-site-map data-lat0=\"${bl - R}\" data-lon0=\"${bo - R}\" data-span=\"${2 * R}\" style=\"width:100%;border:1px solid var(--line);border-radius:8px;background:#f7fafb;cursor:crosshair\" role=\"img\" aria-label=\"Click to place the site\">${ring(3)}${ring(6)}${ring(9)}<circle cx=\"${SZ / 2}\" cy=\"${SZ / 2}\" r=\"6\" fill=\"#145f68\"/><text x=\"${SZ / 2 + 9}\" y=\"${SZ / 2 + 14}\" font-size=\"11\" fill=\"#145f68\">${esc(node?.name)} (bus)</text>${ok(site.lat) && ok(site.lon) ? `<line x1=\"${SZ / 2}\" y1=\"${SZ / 2}\" x2=\"${px(site.lon)}\" y2=\"${py(site.lat)}\" stroke=\"#b76d44\" stroke-dasharray=\"5 4\"/><circle cx=\"${px(site.lon)}\" cy=\"${py(site.lat)}\" r=\"7\" fill=\"#b76d44\"/><text x=\"${px(site.lon) + 9}\" y=\"${py(site.lat) - 8}\" font-size=\"11\" fill=\"#b76d44\">Site</text>` : ''}</svg><p class=\"audit-note\">Click the map to place the site; the straight line to the bus sets the distance. Rings every 3 miles. No basemap is drawn (offline preview).</p></div>` : '';\n"
     "  return `<div class=\"panel\"><h2>Place the site</h2>${siteMap}</div><div class=\"panel\"><h2>Site and line assumptions</h2><div class=\"form-grid\">"),
])
patch("app.js", [
    ("  app.addEventListener('input', onEvent);",
     "  app.addEventListener('input', onEvent);\n"
     "  app.addEventListener('click', e => {\n"
     "    const svg = e.target.closest('svg[data-site-map]'); if (!svg) return;\n"
     "    const b = svg.getBoundingClientRect(), fx = (e.clientX - b.left) / b.width, fy = (e.clientY - b.top) / b.height, span = Number(svg.dataset.span);\n"
     "    const L = (S.ui.land ||= {}); L.siteLon = +(Number(svg.dataset.lon0) + fx * span).toFixed(5); L.siteLat = +(Number(svg.dataset.lat0) + (1 - fy) * span).toFixed(5);\n"
     "    render();\n"
     "  });"),
])

# ---------- Decision: stress chart; "Go" links from evidence ----------
patch("views/decision.js", [
    ("import { forecastRuns, availableYears, describe, LABELS, fmt } from '../basis.js';",
     "import { forecastRuns, availableYears, describe, LABELS, fmt } from '../basis.js';\nimport { lineChart } from '../charts.js';"),
    ("    <div class=\"panel\"><h2>Energy revenue per year by price scenario</h2><div class=\"table-wrap\">",
     "    <div class=\"panel\"><h2>Energy revenue per year by price scenario</h2>${lineChart(opts.map((n, oi) => ({ name: n.name, points: table.map((r, i) => ({ x: i, y: r.vals[oi] })) })), { fmt: v => fmt.money(v), xfmt: i => (table[i]?.sc.applied ? 'Applied' : table[i]?.sc.label.replace(' actual', '').replace(' forecast', '') || ''), xTicks: table.map((_, i) => i), title: 'Revenue by scenario', xLabel: 'Scenario' })}<div class=\"table-wrap\">"),
    ("<td>${esc(e.where)}</td><td>${esc(e.at ? String(e.at).slice(0, 16).replace('T', ' ') : '—')}</td></tr>`).join('')}</tbody></table></div>",
     "<td>${e.status === 'Current' ? esc(e.where) : `<button class=\"tiny\" data-act=\"goto-where\" data-v=\"${esc(e.where)}\">Go: ${esc(e.where)}</button>`}</td><td>${esc(e.at ? String(e.at).slice(0, 16).replace('T', ' ') : '—')}</td></tr>`).join('')}</tbody></table></div>"),
])
patch("app.js", [
    ("  'alloc-reset': () =>",
     "  'goto-where': v => { const [stg, tb] = String(v).split(' › '); const st = STAGES.find(s => s.name === stg.trim()); if (!st) return; S.stage = st.key; const t = st.view?.tabs.find(x => x.label === (tb || '').trim()); if (t) S.tabs[st.key] = t.id; },\n"
     "  'alloc-reset': () =>"),
])
print("patched OK")
