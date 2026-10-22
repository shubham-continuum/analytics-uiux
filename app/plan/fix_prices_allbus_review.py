"""Prices all-bus review (2026-09-29): 2 High, 6 Medium, 4 Low. See the review log in the README.

H1 E+C+L check was an identity → data check (history) / 'derived by construction' (forecast); false rounding note removed.
H2 Forecast mode claimed borrowed prices for proxy buses → mode-aware notes (app + trace).
M3/M4/M5 tautological or missing checks → independent paths (pooled mean, quantiles, difference of means,
    raw worked day, monthly decomposition) or honestly labelled 'arithmetic re-run'. Smoke requires a check.
M6 component table used per-component hours → one set of hours; total = E + C + L beside the observed mean.
M7 reference name in forecast mode → from the reference series (model bus 80000).
M8 CSV units + provenance header lines.
L9 fold-pair note · L10 CSV guard trims leading spaces · L11 0.0 km → co-located; buses with no history flagged
L12 server: static allow-list, Host check, id normalised, cache keyed by the database mtime.
"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert t.count(old) == 1, f"{name}: expected one match for {old[:100]!r} (found {t.count(old)})"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


# ---------------- trace.js: meta header lines, CSV guard ----------------
patch("trace.js", [
    ("    if (/^[=+\\-@\\t\\r]/.test(s)) s = `'${s}`;", "    if (/^\\s*[=+\\-@\\t\\r]/.test(s)) s = `'${s}`;"),
    ("export function csvFor(id) { const s = REG.get(id); return s ? { name: s.name, text: toCsv(s.columns, typeof s.rows === 'function' ? s.rows() : s.rows) } : null; }",
     "/** Provenance lines (# key: value) precede the header; pandas reads them with comment='#'. */\n"
     "export function csvFor(id) {\n  const s = REG.get(id); if (!s) return null;\n"
     "  const meta = (s.meta || []).map(([k, v]) => `# ${String(k).replace(/[\\r\\n]/g, ' ')}: ${String(v ?? '').replace(/[\\r\\n]/g, ' ')}\\r\\n`).join('');\n"
     "  return { name: s.name, text: meta + toCsv(s.columns, typeof s.rows === 'function' ? s.rows() : s.rows) };\n}"),
])

# ---------------- app.js: mode-aware mapping note ----------------
patch("app.js", [
    ("function mappingNote(b) {\n  if (!b) return '';\n  const t = { direct: ['good', 'Own price node'], same_substation: ['', 'Price node at the same substation'], geo_proxy: ['warn', `Borrowed price: nearest node ${Number(b.proxyKm).toFixed(1)} km away`] }[b.tier] || ['warn', b.tier];\n  return `<div class=\"mapping-note\"><span class=\"pill ${t[0]}\">${esc(t[1])}</span> Prices for this bus come from <b>${esc(b.pnode)}</b>.${b.tier === 'geo_proxy' ? ' This bus has no settlement node of its own, so its congestion and losses are the neighbour\\'s, not its own.' : ''}</div>`;\n}",
     "function mappingNote(b) {\n  if (!b) return '';\n"
     "  if (S.basis?.mode === 'forecast') return `<div class=\"mapping-note\"><span class=\"pill good\">Own forecast</span> Forecast prices are modelled for this bus itself (model bus ${esc(b.id)}); nothing is borrowed. Historical prices come from <b>${esc(b.pnode)}</b>${b.tier === 'geo_proxy' ? ' (a neighbouring node)' : ''}.</div>`;\n"
     "  const km = Number(b.proxyKm);\n"
     "  const t = { direct: ['good', 'Own price node'], same_substation: ['', 'Price node at the same substation'], geo_proxy: km < 0.05 ? ['', 'Co-located price node (0.0 km)'] : ['warn', `Borrowed price: nearest node ${km.toFixed(1)} km away`] }[b.tier] || ['warn', b.tier];\n"
     "  const noHist = b.hist === false ? ' <span class=\"pill warn\">No price history held for this node</span> Use a forecast run.' : '';\n"
     "  return `<div class=\"mapping-note\"><span class=\"pill ${t[0]}\">${esc(t[1])}</span> Historical prices for this bus come from <b>${esc(b.pnode)}</b>.${b.tier === 'geo_proxy' && km >= 0.05 ? ' This bus has no settlement node of its own, so its historical congestion and losses are the neighbour\\'s, not its own.' : ''}${noHist}</div>`;\n}"),
])

# ---------------- views/prices.js: one set of hours for the component table ----------------
patch("views/prices.js", [
    ("  const comp = key => { const v = res.rows.filter(r => finite(r[key])); const h = v.reduce((t, r) => t + r.dtHours, 0); return h ? v.reduce((t, r) => t + r[key] * r.dtHours, 0) / h : null; };",
     "  // One set of hours for every component (review M6): hours where energy, congestion and losses are all held.\n"
     "  const withC = res.rows.filter(r => finite(r.energy) && finite(r.congestion) && finite(r.loss)), hc = withC.reduce((t, r) => t + r.dtHours, 0);\n"
     "  const comp = key => (hc ? withC.reduce((t, r) => t + r[key] * r.dtHours, 0) / hc : null);"),
    ("<tr><td><b>Total (hour-weighted over the included years)</b></td><td class=\"num\"><b>${fmt.price(res.summary.observedMean)}</b></td></tr></tbody></table></div>",
     "<tr><td><b>Energy + congestion + losses</b> (${fmt.int(hc)} h with all three)</td><td class=\"num\"><b>${fmt.price(finite(E) ? E + C + L : null)}</b></td></tr><tr><td>Observed mean price (all ${fmt.int(res.summary.hours)} h)</td><td class=\"num\">${fmt.price(res.summary.observedMean)}</td></tr></tbody></table></div>"),
    ("${kpi('Congestion component', fmt.price(C), '/MWh', 'Node average; + adds to price (settled sign)')}",
     "${kpi('Congestion component', fmt.price(C), '/MWh', `Node average; + adds to price (settled sign)${S.basis.mode === 'forecast' ? ' · modelled for this bus' : ''}`)}"),
])

# ---------------- views/prices-trace.js ----------------
patch("views/prices-trace.js", [
    # mode-aware price source
    ("function busInputs(node, basis) {\n  const pm = node?.priceMapping || {};\n  const tier = { direct: 'own price node', same_substation: 'node at the same substation', geo_proxy: `borrowed from a node ${n2(pm.distance_km)} km away`, hub: 'hub' }[pm.tier] || pm.tier || '—';\n  return [\n    { name: 'Bus', value: `${node?.name ?? '?'} (${node?.id ?? '?'})`, source: 'measured' },\n    { name: 'Price node', value: pm.pnode_name ?? '—', source: 'measured', note: tier },",
     "export function priceSource(node, basis) {\n  const pm = node?.priceMapping || {};\n"
     "  if (basis?.mode === 'forecast') return { value: `Model bus ${node?.id ?? '?'} (${basis.run})`, note: 'Forecast modelled for this bus itself; nothing borrowed' };\n"
     "  const km = pm.distance_km;\n"
     "  const tier = { direct: 'own price node', same_substation: 'node at the same substation', geo_proxy: km < 0.05 ? 'co-located node (0.0 km)' : `borrowed from a node ${n2(km)} km away`, hub: 'hub' }[pm.tier] || pm.tier || '—';\n"
     "  return { value: pm.pnode_name ?? '—', note: tier };\n}\n\n"
     "function busInputs(node, basis) {\n  const ps = priceSource(node, basis);\n  return [\n    { name: 'Bus', value: `${node?.name ?? '?'} (${node?.id ?? '?'})`, source: 'measured' },\n    { name: basis?.mode === 'forecast' ? 'Price series' : 'Price node', value: ps.value, source: 'measured', note: ps.note },"),
    # CSV units + provenance
    ("const hourlyCsv = (res, name) => ({\n  name, columns: ['timestamp', 'price_usd_mwh', 'energy', 'congestion', 'loss', 'interval_hours'],",
     "export const csvMeta = (node, basis) => { const ps = priceSource(node, basis); return [['bus', `${node?.name} (${node?.id})`], ['price series', `${ps.value} — ${ps.note}`], ['basis', describe(basis)], ['convention', 'price = energy + congestion + loss, $/MWh, settled sign'], ['missing', 'empty cell = not held, never zero']]; };\n\n"
     "const hourlyCsv = (res, name, node, basis) => ({\n  name, meta: csvMeta(node, basis), columns: ['timestamp', 'price_usd_mwh', 'energy_usd_mwh', 'congestion_usd_mwh', 'loss_usd_mwh', 'interval_hours'],"),
    ("    csv: hourlyCsv(res, `prices-hourly-${node?.id}.csv`),",
     "    csv: hourlyCsv(res, `prices-hourly-${node?.id}.csv`, node, S.basis),"),
    # M3: mean check on an independent path when weighting is by duration; otherwise labelled honestly
    ("    check: { label: 'Recomputed Σ contributions = headline mean', a: mean, b: s.mean, fmt: priceCheck },",
     "    check: S.basis.weighting === 'duration'\n"
     "      ? { label: 'Independent path: observed-hour weighting equals the pooled hourly mean Σ price × h ÷ Σ h', a: s.observedMean, b: s.mean, fmt: priceCheck }\n"
     "      : { label: 'Arithmetic re-run of Σ contributions (no independent path for equal or custom weights)', a: mean, b: s.mean, fmt: priceCheck },"),
    # M4: quantiles checked against the core's separate implementation
    ("    check: { label: 'Recomputed negative-hour share = headline', a: 100 * neg / H, b: s.negativePct, fmt: v => fmt.pct(v) },",
     "    checks: [\n"
     "      { label: 'p5 from a separate quantile routine = headline', a: q(0.05), b: s.p05, fmt: priceCheck },\n"
     "      { label: 'p50 from a separate quantile routine = headline', a: q(0.5), b: s.p50, fmt: priceCheck },\n"
     "      { label: 'p95 from a separate quantile routine = headline', a: q(0.95), b: s.p95, fmt: priceCheck },\n"
     "      { label: 'Arithmetic re-run of the negative-hour share', a: 100 * neg / H, b: s.negativePct, fmt: v => fmt.pct(v) },\n"
     "    ],"),
    # M5 + M7: basis check via difference of means; reference from the series
    ("  const hub = data.nodes.find(x => x.id === 'hub');",
     "  const nodeSum = sumBy(all, r => r.node * r.dtHours), refSum = sumBy(all, r => r.reference * r.dtHours);\n"
     "  const refName = S.basis.mode === 'forecast' ? `Model bus 80000 (ISO-NE hub, ${S.basis.run})` : (data.nodes.find(x => x.id === 'hub')?.priceMapping?.pnode_name || '.H.INTERNAL_HUB');"),
    ("{ name: 'Reference', value: hub?.priceMapping?.pnode_name || '.H.INTERNAL_HUB', source: 'measured' }",
     "{ name: 'Reference', value: refName, source: 'measured' }"),
    ("    result: { label: 'Basis to hub', value: `${fmt.price(n ? sum / n : null)}/MWh` },\n    csv: { name: `prices-basis-${node?.id}.csv`, columns: ['timestamp', 'node_usd_mwh', 'hub_usd_mwh', 'basis_usd_mwh', 'interval_hours'],",
     "    result: { label: 'Basis to hub', value: `${fmt.price(n ? sum / n : null)}/MWh` },\n"
     "    check: { label: 'Independent path: mean node price − mean hub price over the same hours', a: n ? sum / n : null, b: n ? (nodeSum - refSum) / n : null, fmt: priceCheck },\n"
     "    notes: S.basis.mode === 'historical' ? ['The two readings of the repeated autumn 1 a.m. hour have no recorded order in the source; node and hub are paired by price rank for that hour (2 hours a year).'] : [],\n"
     "    csv: { name: `prices-basis-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['timestamp', 'node_usd_mwh', 'hub_usd_mwh', 'basis_usd_mwh', 'interval_hours'],"),
    # H1: component 'check' → data check (history) or derived (forecast)
    ("    check: { label: 'Energy + congestion + losses = price over the same hours', a: finite(E) ? E + C + L : null, b: P, tol: 5e-3, fmt: priceCheck },\n    notes: ['A small difference is rounding in the source (components are stored to the cent); a large one means the components do not add up for this node.'],",
     "    ...(S.basis.mode === 'forecast'\n"
     "      ? { notes: ['Forecast energy is derived as price − congestion − losses, so the three add up to the price by construction; this split is not an independent check.'] }\n"
     "      : { check: { label: 'Data check: hours where energy + congestion + losses differs from price by more than $0.01', a: withC.filter(r => Math.abs(r.energy + r.congestion + r.loss - r.price) > 0.01).length, b: 0, fmt: v => `${fmt.int(v)} h` } }),"),
    # M3: capture — monthly decomposition (different grouping path) + honest label
    ("    check: { label: 'Recomputed capture = headline', a: cap, b: headline, fmt: priceCheck },\n    csv: { name: `prices-capture-${node?.id}.csv`, columns: ['timestamp', 'price_usd_mwh', 'g_per_mw', 'g_x_price_x_hours', 'interval_hours'],",
     "    checks: [\n"
     "      { label: 'Monthly decomposition: Σ (monthly capture × monthly Σ g × h) ÷ Σ g × h = annual capture', a: monthlyCapture(res.rows, g), b: headline, fmt: priceCheck },\n"
     "      { label: 'Arithmetic re-run of the capture loop', a: cap, b: headline, fmt: priceCheck },\n"
     "    ],\n"
     "    csv: { name: `prices-capture-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['timestamp', 'price_usd_mwh', 'g_per_mw', 'g_x_price_x_hours_usd_per_mw', 'interval_hours'],"),
    ("/** Shape & capture: clear-sky (or flat) weighted price. */",
     "function monthlyCapture(rows, g) {\n  const m = new Map();\n  for (const r of rows) { const w = g(r); if (w == null) continue; const k = String(r.timestamp).slice(0, 7), o = m.get(k) || { num: 0, den: 0 }; o.num += w * r.price * r.dtHours; o.den += w * r.dtHours; m.set(k, o); }\n"
     "  let num = 0, den = 0; for (const o of m.values()) if (o.den) { num += (o.num / o.den) * o.den; den += o.den; }\n  return den ? num / den : null;\n}\n\n"
     "/** Shape & capture: clear-sky (or flat) weighted price. */"),
    # M5: tails — the worked day's spread from its raw hours vs the spread routine
    ("  let worked = [];\n  if (best) {\n    const p = res.rows.filter(r => String(r.timestamp).slice(0, 10) === best.day).map(r => r.price).sort((a, b) => a - b);\n    const lo = p.slice(0, dur), hi = p.slice(-dur);",
     "  let worked = [], rawSpread = null;\n  if (best) {\n    const p = res.rows.filter(r => String(r.timestamp).slice(0, 10) === best.day).map(r => r.price).sort((a, b) => a - b);\n    const lo = p.slice(0, dur), hi = p.slice(-dur);\n    rawSpread = sumBy(hi, v => v) / dur - sumBy(lo, v => v) / dur;"),
    ("    notes: ['A gross spread ignores round-trip losses, charge limits and state of charge. It is a benchmark, not battery revenue (Economics › BESS dispatch).'],\n    csv: { name: `prices-spreads-${dur}h-${node?.id}.csv`, columns: ['day', `spread_${dur}h_usd_mwh`],",
     "    check: { label: 'Worked day recomputed from its raw hours = spread routine', a: rawSpread, b: best?.spread ?? null, fmt: priceCheck },\n"
     "    notes: ['A gross spread ignores round-trip losses, charge limits and state of charge. It is a benchmark, not battery revenue (Economics › BESS dispatch).'],\n"
     "    csv: { name: `prices-spreads-${dur}h-${node?.id}.csv`, meta: csvMeta(node, S.basis), columns: ['day', `spread_${dur}h_usd_mwh`],"),
])

# ---------------- busdata.py: history flag, normalised id, cache keyed by DB mtime ----------------
patch("busdata.py", [
    ("    q = '''SELECT b.bus_id, b.bus_name, b.substation_name, b.nominal_kv, b.latitude, b.longitude, b.county, b.state_code,\n                  b.load_zone, p.pnode_name, p.tier, p.distance_km, p.buses_at_substation\n           FROM dim_bus b JOIN bridge_bus_pnode p ON p.bus_id=b.bus_id AND p.link_rank=1\n           WHERE b.latitude IS NOT NULL ORDER BY b.bus_name, b.bus_id'''",
     "    q = '''SELECT b.bus_id, b.bus_name, b.substation_name, b.nominal_kv, b.latitude, b.longitude, b.county, b.state_code,\n                  b.load_zone, p.pnode_name, p.tier, p.distance_km, p.buses_at_substation,\n                  p.pnode_name IN (SELECT DISTINCT pnode_name FROM fact_lmp_hourly) AS has_hist,\n                  (SELECT count(DISTINCT scenario) FROM fact_fcst_lmp_hourly f WHERE f.bus_id=b.bus_id) AS n_runs\n           FROM dim_bus b JOIN bridge_bus_pnode p ON p.bus_id=b.bus_id AND p.link_rank=1\n           WHERE b.latitude IS NOT NULL ORDER BY b.bus_name, b.bus_id'''"),
    ("             'proxyKm': r['distance_km'] if r['tier'] == 'geo_proxy' else None} for r in rows(c, q)]",
     "             'proxyKm': r['distance_km'] if r['tier'] == 'geo_proxy' else None,\n             'hist': bool(r['has_hist']), 'runs': r['n_runs']} for r in rows(c, q)]"),
    ("    CACHE.mkdir(exist_ok=True)\n    f = CACHE / f'{name}.json.gz'",
     "    CACHE.mkdir(exist_ok=True)\n    stamp = int(SOURCE.stat().st_mtime)  # a rebuilt database invalidates every cached payload\n    f = CACHE / f'{name}-{stamp}.json.gz'"),
])

# ---------------- server.py: static allow-list, Host check, normalised id ----------------
patch("server.py", [
    ("  path=self.path.split('?')[0]\n  if path.startswith('/api/'):return self.api(path)\n  if self.path=='/':self.path='/analytics-analyzer-studio.html'\n  return super().do_GET()",
     "  host=(self.headers.get('Host') or '').split(':')[0]\n"
     "  if host not in ('127.0.0.1','localhost'):return self.send_error(403,'Local preview only')  # DNS-rebinding guard\n"
     "  path=self.path.split('?')[0]\n"
     "  if path.startswith('/api/'):return self.api(path)\n"
     "  if path=='/':self.path='/analytics-analyzer-studio.html';path=self.path\n"
     "  # Static allow-list: pages, modules, styles, data, images. No listings, logs, pids, scripts, cache or plan files.\n"
     "  if path.endswith('/') or any(path.startswith(p) for p in ('/cache','/plan','/tests','/baseline')) or not re.search(r'\\.(html|js|mjs|css|json|svg|png|ico|woff2?)$',path):return self.send_error(404,'Not found')\n"
     "  return super().do_GET()"),
    ("    body=busdata.cached(f'bus-{m.group(1)}',lambda:busdata.bus_payload(conn(),m.group(1)))",
     "    bid=m.group(1) if m.group(1)=='hub' else str(int(m.group(1)))  # /api/bus/0001 and /api/bus/1 share one cache entry\n"
     "    body=busdata.cached(f'bus-{bid}',lambda:busdata.bus_payload(conn(),bid))"),
])

# ---------------- smoke: every trace must carry a check or an explicit derived note ----------------
patch("tests/smoke-prices-trace.mjs", [
    ("      check(!/NaN|undefined|Infinity/.test(body), `${label} › ${tab} › ${id}: no NaN/undefined`);",
     "      check(!/NaN|undefined|Infinity/.test(body), `${label} › ${tab} › ${id}: no NaN/undefined`);\n"
     "      check(/Reconciles/.test(body) || /by construction/.test(body), `${label} › ${tab} › ${id}: carries a check (or says why it cannot)`);"),
])
print("ok")
