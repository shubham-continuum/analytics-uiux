"""Phase B interactions for Market (zoom/pan map, layers, click-to-inspect) and Grid (live size
slider, facility drawer). Kept for audit."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in t, f"{name}: MISSING {old[:70]}"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


# ---------------- Market ----------------
p = P / "views/market.js"
t = p.read_text(encoding="utf-8")
a = t.index("function map(ev, highlight) {")
b = t.index("// ---------- Tab 1: Find locations ----------")
t = t[:a] + r'''function map(ev, highlight, S) {
  const W = 900, H = 600, x = lon => ((lon + 73.8) / 7.0) * W, y = lat => H - ((lat - 40.9) / 6.6) * H;
  const L = { met: true, unknown: true, unmet: true, ...(S.ui.mapLayers || {}) };
  const sel = String(S.ui.mapBus || '');
  const tip = e => esc(`<b>${e.node.name}</b> · ${e.node.bus_id}<br>${e.node.zone} · ${ok(e.node.kv) ? e.node.kv + ' kV' : ''}<br>${e.status === 'met' ? 'Meets' : e.status === 'unknown' ? 'Unknown' : e.status === 'unmet' ? 'Does not meet' : 'Outside zones'}${ok(e.margin) ? ` · margin ${e.margin.toFixed(0)} MW` : ''}`);
  const dot = (e, r, cls) => (ok(e.node.lat) && ok(e.node.lon) ? `<circle cx="${x(e.node.lon).toFixed(1)}" cy="${y(e.node.lat).toFixed(1)}" r="${r}" data-r="${r}" class="${cls}" data-act="map-bus" data-v="${e.node.bus_id}" data-tip="${tip(e)}"/>` : '');
  const order = ['excluded', 'unmet', 'unknown', 'met'].filter(s => s === 'excluded' || L[s]);
  const dots = order.flatMap(s => ev.filter(e => e.status === s).map(e => dot(e, s === 'met' ? 3.4 : 2.6, `m-${s}`))).join('');
  const hl = ev.filter(e => highlight.has(String(e.node.bus_id))).map(e => dot(e, 7, 'm-hl')).join('');
  const sl = ev.filter(e => String(e.node.bus_id) === sel).map(e => dot(e, 9, 'm-sel')).join('');
  const toggles = [['met', 'Meets', '#237780'], ['unknown', 'Unknown', '#7d8f99'], ['unmet', 'Does not meet', '#b9c6cc']].map(([k, l, c]) => `<label class="inline-check"><input type="checkbox" data-act="map-layer" data-k="${k}" ${L[k] ? 'checked' : ''}><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c}"></span> ${l} (${fmt.int(ev.filter(e => e.status === k).length)})</label>`).join('');
  return `<div class="chip-row" style="margin-bottom:8px">${toggles}</div>
    <div class="map-wrap"><div class="map-ctl"><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="reset" aria-label="Reset view">⟲</button></div>
    <svg data-map="market" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of screened buses">
    <style>.m-met{fill:#237780;cursor:pointer}.m-unknown{fill:#fff;stroke:#7d8f99;stroke-width:1;cursor:pointer}.m-unmet{fill:#c9d4d9;cursor:pointer}.m-excluded{fill:#eef2f4}.m-hl{fill:none;stroke:#b76d44;stroke-width:2.5;pointer-events:none}.m-sel{fill:none;stroke:#1c3944;stroke-width:3;pointer-events:none}circle:hover{stroke:#1c3944;stroke-width:2}</style>${dots}${hl}${sl}</svg><div class="chart-tip" hidden></div></div>
    <p class="audit-note">Scroll to zoom, drag to pan, click a bus to inspect it. Orange rings = buses with hourly price data in this preview.</p>`;
}

function selectedCard(ev, S, study, data) {
  const e = ev.find(z => String(z.node.bus_id) === String(S.ui.mapBus));
  if (!e) return '<div class="selected-card"><h3>No bus selected</h3><span class="audit-note">Click a bus on the map, or "Show" in a table, to see its limits and why it passes or fails.</span></div>';
  const lims = serviceLimits(study, e.node, S.tech);
  const inPreview = data.nodes.some(n => String(n.id) === String(e.node.bus_id));
  return `<div class="selected-card"><h3>${esc(e.node.name)} <span class="audit-note">${e.node.bus_id} · ${esc(e.node.zone)} · ${esc(e.node.county || '')} ${esc(e.node.state || '')}</span></h3>
    <dl class="mini-dl">
      <dt>Status</dt><dd>${esc({ met: 'Meets requirements', unknown: 'Unknown (evidence missing)', unmet: 'Does not meet', excluded: 'Outside selected zones' }[e.status])}</dd>
      ${lims.map(l => `<dt>${esc(l.label)}</dt><dd>${ok(l.value) ? fmt.mw(l.value) : 'not held'} <span class="audit-note">${esc(l.basis)}</span></dd>`).join('')}
      <dt>2025 average price</dt><dd>${fmt.price(e.node.lmp_2025)}/MWh</dd>
      <dt>Short-circuit strength</dt><dd>${ok(e.node.sc_mva) ? fmt.int(e.node.sc_mva) + ' MVA' : 'not held'}</dd>
      ${e.reasons.length ? `<dt>Fails on</dt><dd>${e.reasons.map(esc).join('<br>')}</dd>` : ''}
      ${e.unknown.length ? `<dt>Unknown</dt><dd>${e.unknown.map(esc).join('<br>')}</dd>` : ''}
    </dl>
    <div class="actions" style="margin-top:10px">${inPreview ? `<button class="primary tiny" data-act="pick-bus" data-v="${e.node.bus_id}">Analyse in Grid, Prices and Economics</button>` : '<span class="audit-note">Hourly prices for this bus are not in the preview snapshot: screening only.</span>'}</div></div>`;
}

''' + t[b:]
t = t.replace("<div class=\"panel\"><div class=\"panel-head\"><div><h2>Where the qualifying buses are</h2><p class=\"sub\">Every ISO-NE bus, plotted by location</p></div></div>${map(ev, preview)}</div>",
              "<div class=\"panel\"><div class=\"panel-head\"><div><h2>Where the qualifying buses are</h2><p class=\"sub\">Every ISO-NE bus, plotted by location</p></div></div><div class=\"two-col map-grid\"><div>${map(ev, preview, S)}</div><div>${selectedCard(ev, S, study, data)}</div></div></div>")
t = t.replace("<td>${preview.has(String(e.node.bus_id)) ? `<button class=\"tiny\" data-act=\"pick-bus\" data-v=\"${e.node.bus_id}\">Analyse</button>` : '<span class=\"audit-note\">screening only</span>'}</td></tr>`).join('');",
              "<td><button class=\"tiny\" data-act=\"map-bus\" data-v=\"${e.node.bus_id}\">Show</button> ${preview.has(String(e.node.bus_id)) ? `<button class=\"tiny\" data-act=\"pick-bus\" data-v=\"${e.node.bus_id}\">Analyse</button>` : ''}</td></tr>`).join('');")
t = t.replace("<td class=\"num\">${(100 * x.coverage).toFixed(0)}%</td></tr>`).join('');",
              "<td class=\"num\">${(100 * x.coverage).toFixed(0)}%</td><td><button class=\"tiny\" data-act=\"map-bus-find\" data-v=\"${x.node.bus_id}\">Show on map</button></td></tr>`).join('');")
t = t.replace("<th class=\"num\">Coverage</th></tr></thead>", "<th class=\"num\">Coverage</th><th></th></tr></thead>")
p.write_text(t, encoding="utf-8")

patch("app.js", [
    ("  'alloc-reset': () =>",
     "  'map-bus': v => { S.ui.mapBus = v; },\n"
     "  'map-bus-find': v => { S.ui.mapBus = v; S.tabs.market = 'find'; },\n"
     "  'map-layer': (v, el) => { (S.ui.mapLayers ||= {})[el.dataset.k] = el.checked; },\n"
     "  'grid-size': v => { S.exportMW = Number(v); },\n"
     "  'alloc-reset': () =>"),
])
patch("ui.js", [
    ("    const set = () => { svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`); MAPVIEW.set(id, [x, y, w, h]); svg.style.setProperty('--k', base[2] / w); };",
     "    const dots = [...svg.querySelectorAll('circle[data-r]')];\n"
     "    const set = () => { svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`); MAPVIEW.set(id, [x, y, w, h]); const k = base[2] / w; for (const c of dots) c.setAttribute('r', (c.dataset.r / Math.sqrt(k)).toFixed(2)); };"),
])

# ---------------- Grid ----------------
p = P / "views/grid.js"
t = p.read_text(encoding="utf-8")
old = "  return `${storageNote}\n    <div class=\"kpis\">"
assert old in t
t = t.replace(old, """  const slider = `<div class="panel"><div class="range-field"><span>Export request (drag to test sizes; updates every tab)</span><div class="row"><input type="range" min="10" max="500" step="5" value="${Number(S.exportMW) || 100}" data-act="grid-size" data-live aria-label="Export request MW"><output>${Number(S.exportMW) || 100}</output><span class="audit-note">MW</span></div></div></div>`;
  return `${storageNote}${slider}
    <div class="kpis">""", 1)
# Facility rows open a drawer with loading meters
old = "    return `<tr><td class=\"wrap\">${esc(r.monitored_facility?.trim())}</td>"
assert old in t
t = t.replace(old, """    const did = `fac-${S.nodeId}-${key}-${(r.monitored_facility || '').replace(/[^A-Za-z0-9]/g, '')}-${r.binding_contingency}`;
    const pre100 = ok(r.pct_loading_no_transfer) ? r.pct_loading_no_transfer : null;
    drawers.push(`<template data-drawer="${esc(did)}" data-title="${esc(r.monitored_facility?.trim())}"><dl>
      <dt>Contingency</dt><dd>${esc(r.binding_contingency)} (${esc(r.facility_type || 'facility')})</dd>
      <dt>Rating (C)</dt><dd>${fmt.int(rating)} MVA</dd>
      <dt>Sensitivity to this project</dt><dd>${ok(r.dfax) ? r.dfax.toFixed(3) : 'not held'} MW per MW</dd>
      <dt>Transfer to 100%</dt><dd>${fmt.mw(r.transfer_mw)}</dd>
      <dt>Upgrade cost</dt><dd>${musd(r.fix_cost_musd)}</dd>
      <dt>Length</dt><dd>${ok(r.length_miles) ? r.length_miles.toFixed(1) + ' mi' : 'not held'}</dd></dl>
      <h3 style="font-size:13px;margin:16px 0 4px">Loading before the project</h3><div class="meter"><i class="${pre100 >= 100 ? 'over' : ''}" style="width:${Math.min(100, pre100 ?? 0)}%"></i></div><span class="audit-note">${ok(pre100) ? pre100.toFixed(1) + '% of rating' : 'not held'}</span>
      <h3 style="font-size:13px;margin:16px 0 4px">Loading at ${fmt.mw(req)}</h3><div class="meter"><i class="${after > 100 ? 'over' : ''}" style="width:${Math.min(100, after ?? 0)}%"></i></div><span class="audit-note">${ok(after) ? after.toFixed(1) + '% of rating' : 'not computed'}</span>
      <p class="audit-note">Loading at request = (post-contingency flow + sensitivity × request) ÷ rating C.</p></template>`);
    return `<tr class="clickable" data-open-drawer="${esc(did)}" tabindex="0"><td class="wrap">${esc(r.monitored_facility?.trim())}</td>""", 1)
old = "  const rows = (el.rows || []).map(r => {"
assert old in t
t = t.replace(old, "  const drawers = [];\n" + old, 1)
old = "  return `<div class=\"panel\"><div class=\"panel-head\"><div><h2>Limiting facilities</h2>"
assert old in t
t = t.replace(old, "  return `${drawers.join('')}<div class=\"panel\"><div class=\"panel-head\"><div><h2>Limiting facilities</h2>", 1)
t = t.replace("<p class=\"sub\">Loading at request uses the post-contingency flow plus sensitivity × ${fmt.mw(req)}</p>",
              "<p class=\"sub\">Loading at request uses the post-contingency flow plus sensitivity × ${fmt.mw(req)}. Click a facility for details.</p>")
p.write_text(t, encoding="utf-8")

css = P / "app.css"
css.write_text(css.read_text(encoding="utf-8") + """
.map-grid{grid-template-columns:minmax(0,1.6fr) minmax(260px,1fr);align-items:start}
.mini-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12.5px;margin:0}
.mini-dl dt{color:var(--muted)}.mini-dl dd{margin:0;font-variant-numeric:tabular-nums}
@media(max-width:1100px){.map-grid{grid-template-columns:1fr}}
""", encoding="utf-8")
print("patched OK")
