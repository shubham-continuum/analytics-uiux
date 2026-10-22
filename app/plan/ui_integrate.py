"""Integrate the interactive layer (charts v2, ui.js) into the shell and add its CSS."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in t, f"{name}: MISSING {old[:70]}"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


patch("charts.js", [("    const xv = x.inv ? null : null; // no inverse needed: search nearest x in pixel space\n", "")])

patch("app.js", [
    ("import { defaultBasis, availableYears, forecastRuns, describe, basisHash } from './basis.js';",
     "import { defaultBasis, availableYears, forecastRuns, describe, basisHash } from './basis.js';\n"
     "import { resetCharts, mountCharts, handleChartToggle } from './charts.js';\n"
     "import { mountTables, mountMaps, openDrawer, closeDrawer, focusKey, restoreFocus } from './ui.js';"),
    ("export function render() {\n  ensureStudy();",
     "export function render() {\n  const fk = focusKey();\n  resetCharts();\n  ensureStudy();"),
    ("${scenariosModal()}`;\n  save();",
     "${scenariosModal()}`;\n  const root = document.getElementById('app');\n  mountCharts(root); mountTables(root); mountMaps(root); restoreFocus(root, fk);\n  save();"),
    ("function onEvent(e) {\n  const el = e.target.closest('[data-act]');",
     "let liveT = null;\n"
     "function onEvent(e) {\n"
     "  if (e.type === 'click') {\n"
     "    if (handleChartToggle(e.target)) return;\n"
     "    const od = e.target.closest('[data-open-drawer]'); if (od) { openDrawer(document.getElementById('app'), od.dataset.openDrawer); return; }\n"
     "  }\n"
     "  if (e.type === 'input') {\n"
     "    const el = e.target.closest('[data-live][data-act]'); if (!el) return;\n"
     "    const fn = ACTIONS[el.dataset.act]; if (!fn) return;\n"
     "    fn(el.value, el);\n"
     "    const out = el.parentElement.querySelector('output'); if (out) out.textContent = el.value;\n"
     "    clearTimeout(liveT); liveT = setTimeout(render, 140);\n"
     "    return;\n"
     "  }\n"
     "  const el = e.target.closest('[data-act]');"),
    ("  app.addEventListener('change', onEvent);",
     "  app.addEventListener('change', onEvent);\n"
     "  app.addEventListener('input', onEvent);\n"
     "  document.addEventListener('click', e => {\n"
     "    if (e.target.closest('[data-close-drawer]')) { closeDrawer(); return; }\n"
     "    const a = e.target.closest('.drawer [data-act]'); if (a) { closeDrawer(); onEvent({ type: 'click', target: a }); }\n"
     "  });\n"
     "  window.addEventListener('keydown', e => {\n"
     "    if (e.key === 'Escape') closeDrawer();\n"
     "    const tab = e.target.closest?.('[role=\"tab\"]');\n"
     "    if (tab && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {\n"
     "      const st = stage(); if (!st.view) return;\n"
     "      const ids = st.view.tabs.map(x => x.id), i = ids.indexOf(activeTab(st));\n"
     "      S.tabs[st.key] = ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]; render();\n"
     "      document.querySelector('[role=\"tab\"][aria-selected=\"true\"]')?.focus();\n"
     "    }\n"
     "  });"),
    ("<button role=\"tab\" aria-selected=\"${t.id === tab}\" class=\"${t.id === tab ? 'active' : ''}\" data-act=\"tab\" data-v=\"${t.id}\">",
     "<button role=\"tab\" aria-selected=\"${t.id === tab}\" tabindex=\"${t.id === tab ? 0 : -1}\" class=\"${t.id === tab ? 'active' : ''}\" data-act=\"tab\" data-v=\"${t.id}\">"),
])

css = P / "app.css"
css.write_text(css.read_text(encoding="utf-8") + (P / "plan" / "ui_v2.css").read_text(encoding="utf-8"), encoding="utf-8")
print("integrated OK")
