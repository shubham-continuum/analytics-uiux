"""Apply the Grid review fixes (views + Economics handoff). Kept for audit."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent
NEW_COST_TABS = (P / "plan" / "grid_tabs_3_4.js.txt").read_text(encoding="utf-8")


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in t, f"{name}: MISSING {old[:70]}"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


patch("views/grid.js", [
    ("import { caseTable, binding, elementLimit, stepCost, applicableCases, CASE_LABEL } from '../gridrules.js';",
     "import { caseTable, binding, elementLimit, stepCost, stepCostAll, applicableCases, CASE_LABEL } from '../gridrules.js';"),
    ("  const bars = t.map(r => ({ label: r.label.replace(' · ', ' '), value: r.governing }));",
     "  const bars = t.map(r => ({ label: r.label.replace(' · ', ' '), value: r.governing, note: r.status }));\n"
     "  const canSend = ['Fits', 'Does not fit', 'Partly studied'].includes(ex.status) || ['Fits', 'Does not fit', 'Partly studied'].includes(im.status);\n"
     "  const caveats = [\n"
     "    '<span class=\"pill\">Energy-only service: all held export cases</span>',\n"
     "    '<span class=\"pill warn\">Capacity service: ≤ energy-only (capacity case not validated)</span>',\n"
     "    '<span class=\"pill warn\">Light-load and minimum-load cases not studied: may bind lower</span>',\n"
     "    S.tech === 'datacenter' ? '<span class=\"pill warn\">Large loads: no ISO-NE procedure yet; ISO-NE response to FERC due 16 Nov 2026</span>' : '',\n"
     "  ].join(' ');"),
    ("      <div class=\"handoff\"><div><strong>Carry these limits into revenue</strong><p>Economics caps export and charging at the governing limits and records this basis.</p></div><button class=\"primary\" data-act=\"handoff-grid\">Use these connection limits in Economics</button></div>",
     "      <p style=\"margin:14px 0 0\">${caveats}</p>\n"
     "      <div class=\"handoff\"><div><strong>Carry these limits into revenue</strong><p>${canSend ? `Economics will cap export at ${fmt.mw(ex.value)} and charging at the shoulder limit, and record the case and basis.` : 'Not available: the governing case is on hold or not studied, so there is no limit to send.'}</p></div><button class=\"primary\" data-act=\"handoff-grid\" ${canSend ? '' : 'disabled'}>Use these connection limits in Economics</button></div>"),
    ("  const show = b => (ok(b.value) ? fmt.mw(b.value) : b.status === 'Fits (no violations found)' ? '≥ tested max' : b.status === 'Not requested' ? '—' : 'not held');",
     "  S.ui.gridLimits = { exportMW: ok(ex.value) ? ex.value : null, exportCase: ex.row?.label || null, exportStatus: ex.status, importMW: ok(im.value) ? im.value : null, importCase: im.row?.label || null, importStatus: im.status };\n"
     "  const show = b => (ok(b.value) ? fmt.mw(b.value) : b.status === 'Hold' ? 'Hold' : b.status === 'Not requested' ? '—' : 'not held');"),
    ("  const key = all.includes(S.ui.gcase) ? S.ui.gcase : all[0];",
     "  const tb = caseTable(data.grid, S.nodeId, techKey(S.tech), Number(S.exportMW), Number(S.importMW));\n"
     "  const bindKey = (binding(tb, 'export').row || binding(tb, 'import').row)?.key;\n"
     "  const key = all.includes(S.ui.gcase) ? S.ui.gcase : (all.includes(bindKey) ? bindKey : all[0]);"),
    ("after > 100 ? '<span class=\"pill warn\">Overloads at request</span>' : '<span class=\"pill\">Within rating</span>'",
     "!ok(after) ? '<span class=\"pill\">Not computed</span>' : after > 100 ? '<span class=\"pill warn\">Overloads at request</span>' : '<span class=\"pill good\">Within rating</span>'"),
])

p = P / "views/grid.js"
t = p.read_text(encoding="utf-8")
a = t.index("// ---------- Tab 3: Upgrade cost allocator ----------")
b = t.index("export function renderGrid")
p.write_text(t[:a] + NEW_COST_TABS + "\n" + t[b:], encoding="utf-8")

patch("views/economics.js", [
    ("  const records = res.rows.map(r => ({ timestamp: r.timestamp, price: r.price, dtHours: r.dtHours }));",
     "  const records = res.rows.map(r => ({ timestamp: r.timestamp, price: r.price, dtHours: r.dtHours }));\n"
     "  const gh = S.handoffs.grid;\n"
     "  const sent = gh && String(gh.busId) === String(S.nodeId) ? gh : null;\n"
     "  const exportLimit = sent && ok(sent.exportMW) ? sent.exportMW : ex.value;\n"
     "  const importLimit = sent && ok(sent.importMW) ? sent.importMW : im.value;\n"
     "  const gridSource = sent ? `sent from Grid ${String(sent.at).slice(0, 16).replace('T', ' ')}${sent.tech !== S.tech || Number(sent.requestMW) !== Number(S.exportMW) ? ' (project changed since: resend from Grid)' : ''}` : 'computed from Grid study rules (not yet sent)';"),
    ("  return { res, records, exportLimit: ex.value, importLimit: im.value, ex, im, stalePrices, node };",
     "  return { res, records, exportLimit, importLimit, ex, im, stalePrices, node, gridSource };"),
    (" · Export limit ${fmt.mw(x.exportLimit)} (${esc(x.ex.status)}) · Storage charge limit ${fmt.mw(x.importLimit)} (shoulder).",
     " · Export limit ${fmt.mw(x.exportLimit)} · Storage charge limit ${fmt.mw(x.importLimit)} (shoulder) · limits ${esc(x.gridSource)}."),
])

patch("app.js", [
    ("    S.handoffs.grid = { busId: S.nodeId, tech: S.tech, exportMW: S.exportMW, importMW: S.importMW, at: new Date().toISOString() };",
     "    const L = S.ui.gridLimits || {};\n"
     "    S.handoffs.grid = { busId: S.nodeId, tech: S.tech, requestMW: S.exportMW, exportMW: L.exportMW, exportCase: L.exportCase, importMW: L.importMW, importCase: L.importCase, status: L.exportStatus, at: new Date().toISOString() };"),
])
print("patched OK")
