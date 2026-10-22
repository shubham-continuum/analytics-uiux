"""Decision → all buses: option search over every bus (loaded on demand), traces, loading state."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert t.count(old) == 1, f"{name}: expected one match for {old[:100]!r} (found {t.count(old)})"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


patch("views/decision.js", [
    ("import { groupedBar } from '../charts.js';", "import { groupedBar } from '../charts.js';\nimport { traceCompare, traceStress, traceReadiness } from './decision-trace.js';"),
    ("const details = (calc, assumptions, evidence) => `<details><summary>View calculation</summary>${calc}</details><details>", "const details = (calc, assumptions, evidence) => `<details>"),
    # options: explicit ids only (any bus); loaded ones are returned, the rest are loaded on demand
    ("""export function chosen(data, S) {
  const others = data.nodes.filter(n => n.id !== 'hub' && String(n.id) !== String(S.nodeId));
  const extra = (S.ui.dOpts?.length ? S.ui.dOpts.map(String).filter(id => id !== String(S.nodeId)) : others.slice(0, 2).map(n => String(n.id))).slice(0, 2);
  return [String(S.nodeId), ...extra].map(id => data.nodes.find(n => String(n.id) === id)).filter(Boolean);
}""", """export const optionIds = S => [String(S.nodeId), ...(S.ui.dOpts || []).map(String).filter(id => id !== String(S.nodeId))].slice(0, 3);
export function chosen(data, S) {
  return optionIds(S).map(id => data.nodes.find(n => String(n.id) === id)).filter(Boolean);
}
/** Options not loaded yet: ask the shell to load them; the page re-renders when they arrive. */
function pendingOptions(ctx) {
  const missing = optionIds(ctx.S).filter(id => !ctx.data.nodes.some(n => String(n.id) === id));
  missing.forEach(id => ctx.ensureBus?.(id));
  return missing;
}"""),
    ("const picker = (data, S) => `<div class=\"checks\" role=\"group\" aria-label=\"Options\">${data.nodes.filter(n => n.id !== 'hub').map(n => { const cand = String(n.id) === String(S.nodeId), on = chosen(data, S).some(c => c.id === n.id); return `<label class=\"year\"><input type=\"checkbox\" data-act=\"d-opt\" value=\"${n.id}\" ${on ? 'checked' : ''} ${cand || (!on && chosen(data, S).length >= 3) ? 'disabled' : ''}>${esc(n.name)}${cand ? ' <em>candidate</em>' : ''}</label>`; }).join('')}</div>`;",
     "const picker = (data, S) => { const ids = optionIds(S), name = id => (data.index?.find(b => b.id === id)?.name || id);\n"
     "  const chips = ids.map((id, i) => `<span class=\"year\">${esc(name(id))} <span class=\"audit-note\" style=\"margin:0\">${id}</span>${i === 0 ? ' <em>candidate</em>' : ` <button class=\"tiny quiet\" data-act=\"d-remove\" data-v=\"${id}\" aria-label=\"Remove ${esc(name(id))}\">×</button>`}</span>`).join('');\n"
     "  const add = ids.length < 3 ? `<label class=\"bus-pick\">Add an option <span class=\"audit-note\" style=\"margin:0\">(any of ${(data.index?.length || 0).toLocaleString('en-US')} buses)</span><input list=\"bus-list\" data-act=\"d-add\" value=\"\" placeholder=\"type a name, substation or id\" autocomplete=\"off\"></label>` : '<span class=\"audit-note\">Up to three options: remove one to add another.</span>';\n"
     "  return `<div class=\"checks\" role=\"group\" aria-label=\"Options\">${chips}</div>${add}`; };"),
    ("function tabCompare({ data, S }) {\n  const ms = metricsFor(data, S), p = params(S), gs = ms.map(m => gates(m, p));",
     "function tabCompare(ctx) {\n  const { data, S } = ctx, waiting = pendingOptions(ctx);\n  const ms = metricsFor(data, S), p = params(S), gs = ms.map(m => gates(m, p));"),
    ("  return `<div class=\"panel\"><h2>Options (candidate plus up to two)</h2>${picker(data, S)}<p class=\"audit-note\">Common basis:",
     "  return `<div class=\"panel\"><h2>Options (candidate plus up to two)</h2>${picker(data, S)}${waiting.length ? `<div class=\"notice\"><span class=\"spinner\" style=\"display:inline-block;width:14px;height:14px;vertical-align:middle\"></span> Loading ${waiting.length} option(s) from the database…</div>` : ''}<p class=\"audit-note\">Common basis:"),
    ("      ${details('<p>Each value is read from its home dashboard: Grid limits and cost,",
     "      ${traceCompare(data, S, ms, gs, p)}\n      ${details('<p>Each value is read from its home dashboard: Grid limits and cost,"),
    ("function tabStress({ data, S }) {\n  const opts = chosen(data, S), p = params(S);",
     "function tabStress(ctx) {\n  const { data, S } = ctx, waiting = pendingOptions(ctx);\n  if (waiting.length) return `<div class=\"loading-panel\" role=\"status\"><span class=\"spinner\" aria-hidden=\"true\"></span><b>Loading ${waiting.length} option(s)</b><span>Hourly prices are read from the local database the first time.</span></div>`;\n  const opts = chosen(data, S), p = params(S);"),
    ("      ${details('<p>Each cell recomputes energy revenue with the Economics method",
     "      ${traceStress(opts, table, leaders, base)}\n      ${details('<p>Each cell recomputes energy revenue with the Economics method"),
    ("      <p class=\"audit-note\">A sent result records evidence; it does not establish engineering approval or completed diligence.</p></div>",
     "      <p class=\"audit-note\">A sent result records evidence; it does not establish engineering approval or completed diligence.</p>${traceReadiness(ev)}</div>"),
    ("function tabRecord({ data, S }) {", "function tabRecord(ctx) {\n  const { data, S } = ctx; pendingOptions(ctx);"),
    ("  const cur = inputHash(data, S, chosen(data, S).map(n => n.id));", "  const cur = inputHash(data, S, optionIds(S));"),
    ("inputHash: inputHash(data, S, chosen(data, S).map(n => n.id)),", "inputHash: inputHash(data, S, optionIds(S)),"),
    ("'<p>Historical real-time years plus the forecast runs held in the snapshot.</p>'", "'<p>Historical real-time years plus the forecast runs held in the unified database.</p>'"),
])

patch("app.js", [
    ("  try { body = st.render(tab, { data: D, S, node: node() }); }", "  try { body = st.render(tab, { data: D, S, node: node(), ensureBus, busReady }); }"),
    ("  'd-opt': (v, el) =>",
     "  'd-add': v => { const id = (String(v).match(/·\\s*(\\d+)\\s*$/) || [])[1] || (D.index.find(b => b.name.toLowerCase() === String(v).trim().toLowerCase()) || {}).id; if (!id) { toast('Pick a bus from the list.'); return; } if (id === String(S.nodeId) || (S.ui.dOpts || []).map(String).includes(id)) { toast('Already an option.'); return; } S.ui.dOpts = [...(S.ui.dOpts || []).map(String).filter(x => x !== String(S.nodeId)), id].slice(-2); ensureBus(id); },\n"
     "  'd-remove': v => { S.ui.dOpts = (S.ui.dOpts || []).map(String).filter(x => x !== String(v)); },\n"
     "  'd-opt': (v, el) =>"),
])
print("ok")
