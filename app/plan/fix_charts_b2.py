"""Chart fixes from the Phase B render check:
1. Legacy `.chart{height:260px}` forced every SVG to 260 px, so non-260 charts were centred and clipped.
2. Gantt date ticks came from niceTicks on epoch ms and ran past the range: use month starts inside it.
3. Decision scenarios are categories, not a timeline: grouped bars (new groupedBar) instead of a line.
"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in t, f"{name}: MISSING {old[:90]}"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


css = P / "app.css"
css.write_text(css.read_text(encoding="utf-8") + ".chart-canvas svg.chart{height:100%}\n.chart .glegend text{font-size:11px}\n", encoding="utf-8")

patch("charts.js", [
    # gantt: month ticks inside [lo, hi]
    ("  const ticks = niceTicks(lo, hi, Math.max(3, Math.floor(W / 140)));\n  svg += ticks.map(v => `<text x=\"${x(v)}\" y=\"${H - 8}\" text-anchor=\"middle\">${new Date(v).toISOString().slice(0, 7)}</text>`).join('');",
     "  const months = []; { const d = new Date(lo); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); for (; d.getTime() <= hi; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.getTime()); }\n"
     "  const step = Math.max(1, Math.ceil(months.length / Math.max(3, Math.floor((W - M.l) / 90))));\n"
     "  svg += months.filter((_, i) => i % step === 0).map(v => `<line class=\"axis\" x1=\"${x(v)}\" x2=\"${x(v)}\" y1=\"${M.t}\" y2=\"${H - M.b}\"/><text x=\"${x(v)}\" y=\"${H - 8}\" text-anchor=\"middle\">${new Date(v).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</text>`).join('');"),
    # groupedBar API
    ("/** Heatmap: rows [{label, cells:[{label, value}]}] (e.g. month × hour). */",
     "/** Grouped bars: groups [{label, values:[v per series]}], series names in opts.series. */\n"
     "export function groupedBar(groups, opts = {}) {\n"
     "  if (!groups.some(g => g.values.some(ok))) return empty(opts.emptyText);\n"
     "  const id = `c${++seq}`, spec = { type: 'gbar', groups, opts: { fmt: v => v.toFixed(0), series: [], height: 300, ...opts } };\n"
     "  REG.set(id, spec); return host(id, spec);\n"
     "}\n"
     "/** Heatmap: rows [{label, cells:[{label, value}]}] (e.g. month × hour). */"),
    ("  if (spec.type === 'gantt') return `<table>",
     "  if (spec.type === 'gbar') return `<table class=\"sortable\"><thead><tr><th>${esc(o.xLabel || 'Group')}</th>${o.series.map(s => `<th class=\"num\">${esc(s)}</th>`).join('')}</tr></thead><tbody>${spec.groups.map(g => `<tr><td>${esc(g.label)}</td>${g.values.map(v => `<td class=\"num\">${cell(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;\n"
     "  if (spec.type === 'gantt') return `<table>"),
    ("function drawGantt(spec, W, H) {",
     "function drawGBar(spec, W, H) {\n"
     "  const o = spec.opts, G = spec.groups, n = o.series.length, M = { l: 58, r: 12, t: 26, b: 40 };\n"
     "  const vals = G.flatMap(g => g.values).filter(ok), ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));\n"
     "  const y = scale(ticks[0], ticks.at(-1), H - M.b, M.t), zero = y(0), gw = (W - M.l - M.r) / G.length, bw = Math.max(2, (gw * 0.76) / n);\n"
     "  let svg = ticks.map(t => `<line class=\"axis\" x1=\"${M.l}\" x2=\"${W - M.r}\" y1=\"${y(t)}\" y2=\"${y(t)}\"/><text x=\"${M.l - 8}\" y=\"${y(t) + 4}\" text-anchor=\"end\">${esc(o.fmt(t))}</text>`).join('');\n"
     "  svg += `<g class=\"glegend\">${o.series.map((s, i) => `<rect x=\"${M.l + i * 150}\" y=\"4\" width=\"10\" height=\"10\" rx=\"2\" style=\"fill:${COLORS[i % COLORS.length]}\"/><text x=\"${M.l + i * 150 + 15}\" y=\"13\">${esc(s)}</text>`).join('')}</g>`;\n"
     "  const wrap = s => { const w = String(s).split(' '), a = [], lim = Math.max(6, Math.floor(gw / 6.2)); let cur = ''; for (const x of w) { if ((cur + ' ' + x).trim().length > lim && cur) { a.push(cur); cur = x; } else cur = (cur + ' ' + x).trim(); } if (cur) a.push(cur); return a.slice(0, 2); };\n"
     "  G.forEach((g, gi) => {\n"
     "    const x0 = M.l + gi * gw + gw * 0.12;\n"
     "    wrap(g.label).forEach((ln, li) => { svg += `<text x=\"${M.l + gi * gw + gw / 2}\" y=\"${H - 24 + li * 13}\" text-anchor=\"middle\" ${g.highlight ? 'style=\"font-weight:700;fill:#1c3944\"' : ''}>${esc(ln)}</text>`; });\n"
     "    g.values.forEach((v, si) => { if (!ok(v)) return; const top = Math.min(y(v), zero), h = Math.max(1, Math.abs(y(v) - zero)); svg += `<rect x=\"${x0 + si * bw}\" y=\"${top}\" width=\"${bw - 1}\" height=\"${h}\" rx=\"1.5\" style=\"fill:${COLORS[si % COLORS.length]}\"/>`; });\n"
     "  });\n"
     "  return { svg, hover: px => { const gi = Math.floor((px - M.l) / gw), g = G[gi]; if (!g) return null; return { x: M.l + gi * gw + gw / 2, html: `<b>${esc(g.label)}</b><br>${o.series.map((s, i) => `<span style=\"color:${COLORS[i % COLORS.length]}\">●</span> ${esc(s)}: ${ok(g.values[i]) ? esc(o.fmt(g.values[i])) : 'not held'}`).join('<br>')}` }; } };\n"
     "}\n\n"
     "function drawGantt(spec, W, H) {"),
    ("const fn = { bar: drawBar, line: drawLine, heat: drawHeat, gantt: drawGantt }[spec.type];",
     "const fn = { bar: drawBar, gbar: drawGBar, line: drawLine, heat: drawHeat, gantt: drawGantt }[spec.type];"),
    ("if (spec.type === 'line' || spec.type === 'bar') { cross",
     "if (spec.type === 'line' || spec.type === 'bar' || spec.type === 'gbar') { cross"),
])

p = P / "views/decision.js"
t = p.read_text(encoding="utf-8")
t = t.replace("import { lineChart } from '../charts.js';", "import { groupedBar } from '../charts.js';", 1)
i0 = t.index("${lineChart(opts.map((n, oi) =>")
i1 = t.index("<div class=\"table-wrap\">", i0)
t = t[:i0] + "${groupedBar(table.map(r => ({ label: r.sc.applied ? 'Applied basis' : r.sc.label.replace(' (12% gas case)', ' (12% gas)'), values: r.vals, highlight: r.sc.applied })), { series: opts.map(n => n.name), fmt: v => fmt.money(v), title: 'Revenue by scenario', xLabel: 'Scenario' })}" + t[i1:]
p.write_text(t, encoding="utf-8")
print("ok")
