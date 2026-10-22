"""Wire calculation traces into Prices and the shell (CSV download, trace open-state across renders)."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert t.count(old) == 1, f"{name}: expected exactly one match for {old[:90]!r} (found {t.count(old)})"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


patch("views/prices.js", [
    ("import { barChart, lineChart, heatmap } from '../charts.js';",
     "import { barChart, lineChart, heatmap } from '../charts.js';\nimport { traceLmp, traceBasis, traceShape, traceTails } from './prices-trace.js';"),
    # The trace replaces the old one-paragraph "View calculation"; assumptions and evidence stay.
    ("const details = (calc, assumptions, evidence) => `\n  <details><summary>View calculation</summary>${calc}</details>\n  <details>",
     "const details = (calc, assumptions, evidence) => `\n  <details>"),
    ("      <h2 style=\"margin-top:18px\">Coverage and contribution audit</h2>${table}\n      ${details(",
     "      <h2 style=\"margin-top:18px\">Coverage and contribution audit</h2>${table}\n      ${traceLmp(data, S, ctx.node, res)}\n      ${details("),
    ("        <tr><td>Losses</td><td class=\"num\">${fmt.price(L)}</td></tr><tr><td><b>Total (hour-weighted over the included years)</b></td><td class=\"num\"><b>${fmt.price(res.summary.observedMean)}</b></td></tr></tbody></table></div>\n      ${details(",
     "        <tr><td>Losses</td><td class=\"num\">${fmt.price(L)}</td></tr><tr><td><b>Total (hour-weighted over the included years)</b></td><td class=\"num\"><b>${fmt.price(res.summary.observedMean)}</b></td></tr></tbody></table></div>\n      ${traceBasis(data, S, ctx.node, res, refSeriesFor)}\n      ${details("),
    ("      ${monthlyRows.map(r => `<tr><td>${r.m}</td><td class=\"num\">${fmt.price(r.avg)}</td><td class=\"num\">${fmt.price(r.capture)}</td><td class=\"num\">${finite(r.ratio) ? r.ratio.toFixed(3) : 'not held'}</td></tr>`).join('')}</tbody></table></div>\n      ${details(",
     "      ${monthlyRows.map(r => `<tr><td>${r.m}</td><td class=\"num\">${fmt.price(r.avg)}</td><td class=\"num\">${fmt.price(r.capture)}</td><td class=\"num\">${finite(r.ratio) ? r.ratio.toFixed(3) : 'not held'}</td></tr>`).join('')}</tbody></table></div>\n      ${traceShape(data, S, node, res, profile, c.capture)}\n      ${details("),
    ("  const dur = Number(S.ui.duration || 4);",
     "  const dur = Number(S.ui.duration || 4), thrV = Number.isFinite(Number(S.ui.thr)) ? Number(S.ui.thr) : 100;"),
    ("      <div class=\"handoff\"><div><strong>Value storage on these prices</strong>",
     "      ${traceTails(data, S, ctx.node, res, dur, spreads, thrV)}\n      <div class=\"handoff\"><div><strong>Value storage on these prices</strong>"),
])

patch("app.js", [
    ("import { mountTables, mountMaps, openDrawer, closeDrawer, focusKey, restoreFocus } from './ui.js';",
     "import { mountTables, mountMaps, openDrawer, closeDrawer, focusKey, restoreFocus } from './ui.js';\nimport { resetTraces, downloadCsv } from './trace.js';"),
    ("  resetCharts();\n  ensureBus('hub');", "  resetCharts(); resetTraces();\n  ensureBus('hub');"),
    ("  mountCharts(root); mountTables(root); mountMaps(root); restoreFocus(root, fk);",
     "  root.querySelectorAll('details.trace[data-trace]').forEach(d => { if (openTraces.has(d.dataset.trace)) d.open = true; });\n"
     "  mountCharts(root); mountTables(root); mountMaps(root); restoreFocus(root, fk);"),
    ("let liveT = null;", "const openTraces = new Set(); // traces the user expanded stay expanded across re-renders\nlet liveT = null;"),
    ("  'alloc-reset': () =>", "  'trace-csv': v => { if (!downloadCsv(v)) toast('Nothing to download for this calculation.'); return 'no-render'; },\n  'alloc-reset': () =>"),
    ("  fn(isField ? el.value : el.dataset.v, el);\n  render();\n}",
     "  if (fn(isField ? el.value : el.dataset.v, el) === 'no-render') return;\n  render();\n}"),
    ("  app.addEventListener('input', onEvent);\n  document.addEventListener",
     "  app.addEventListener('input', onEvent);\n"
     "  app.addEventListener('toggle', e => { const d = e.target; if (d.matches?.('details.trace[data-trace]')) { if (d.open) openTraces.add(d.dataset.trace); else openTraces.delete(d.dataset.trace); } }, true);\n"
     "  document.addEventListener"),
])

css = P / "app.css"
css.write_text(css.read_text(encoding="utf-8") +
    ".trace{border:1px solid #cfe0e2;border-radius:9px;background:#fbfdfd;padding:0;margin-top:16px}\n"
    ".trace>summary{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:12px 16px;font-size:12.5px;color:#1c4f57}\n"
    ".trace[open]>summary{border-bottom:1px solid #e1ecee}\n"
    ".trace-result{font-weight:500;color:var(--muted)}.trace-result b{color:var(--ink);font-variant-numeric:tabular-nums}\n"
    ".trace-body{padding:6px 16px 16px}.trace-body h4{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 6px}\n"
    ".trace-formula{font-family:'Cambria Math',Cambria,Georgia,serif;font-size:14px;background:#eef5f6;border-radius:6px;padding:10px 12px;margin-top:10px;color:#173c44;overflow-x:auto}\n"
    ".trace-t{font-size:12px}.trace-t th,.trace-t td{padding:7px 10px}.trace-work{color:#48606b;font-variant-numeric:tabular-nums}\n"
    ".trace-final{margin-top:12px;font-size:14px}.trace-final b{font-variant-numeric:tabular-nums}\n"
    ".trace-check{margin-top:8px;font-size:12px;color:var(--muted)}\n"
    ".trace-notes{font-size:12px;color:var(--muted);margin:10px 0 0;padding-left:18px}\n"
    ".trace-csv{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}\n", encoding="utf-8")
print("ok")
