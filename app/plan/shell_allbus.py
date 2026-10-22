"""Shell → all buses + standalone pages.

- Data: /api/buses (index of 2,678), /api/bus/<id> loaded on demand and merged into D; the hub always.
- Bus picker: searchable input over the index; price-mapping notice (own node / same substation / proxy km).
- Standalone: mount(root, {only}) renders one dashboard with links to the other pages; cross-dashboard
  jumps navigate to <stage>.html with the same bus (state is shared through preview localStorage).
"""
from pathlib import Path

P = Path(__file__).resolve().parent.parent
a = P / "app.js"
t = a.read_text(encoding="utf-8")


def rep(old, new, count=1):
    global t
    assert t.count(old) >= 1, f"MISSING: {old[:100]}"
    t = t.replace(old, new, count)


# ---- state: only-mode + loading ----
rep("let D = null;           // snapshot data",
    "let D = null;           // merged bus payloads {metadata, nodes, series, grid, index}\n"
    "let ONLY = null;        // standalone page: the one stage this page shows\n"
    "const PAGES = { market: 'market.html', land: 'land.html', grid: 'grid.html', queue: 'queue.html', prices: 'prices.html', economics: 'economics.html', decision: 'decision.html' };\n"
    "const busLoad = new Map(); // id -> 'loading' | 'ok' | Error")

rep("  if (h.get('bus') && D.nodes.some(n => String(n.id) === h.get('bus')) && h.get('bus') !== String(S.nodeId)) { S.nodeId = h.get('bus'); S.basis = null; }",
    "  if (ONLY) S.stage = ONLY;\n"
    "  if (h.get('bus') && D.index.some(n => n.id === h.get('bus')) && h.get('bus') !== String(S.nodeId)) { S.nodeId = h.get('bus'); S.basis = null; }")

rep("  const hash = `#stage=${st.key}${tab ? `&tab=${tab}` : ''}&bus=${S.nodeId}`;",
    "  const hash = ONLY ? `#tab=${tab}&bus=${S.nodeId}` : `#stage=${st.key}${tab ? `&tab=${tab}` : ''}&bus=${S.nodeId}`;")

rep("const node = () => D.nodes.find(n => String(n.id) === String(S.nodeId));",
    "const node = () => D.nodes.find(n => String(n.id) === String(S.nodeId));\n"
    "const indexOf = id => D.index.find(n => n.id === String(id));\n\n"
    "/** Load one bus's payload from the read-only API and merge it into D (idempotent). */\n"
    "export function ensureBus(id) {\n"
    "  id = String(id);\n"
    "  if (busLoad.has(id)) return;\n"
    "  busLoad.set(id, 'loading');\n"
    "  fetch(`./api/bus/${encodeURIComponent(id)}`).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status === 404 ? 'bus not held' : `HTTP ${r.status}`))))\n"
    "    .then(p => {\n"
    "      D.nodes = D.nodes.filter(n => String(n.id) !== id).concat(p.nodes);\n"
    "      D.series = D.series.filter(s => String(s.nodeId) !== id).concat(p.series);\n"
    "      D.grid.headroom = D.grid.headroom.filter(r => String(r.bus_id) !== id).concat(p.grid.headroom);\n"
    "      D.grid.constraints = D.grid.constraints.filter(r => String(r.bus_id) !== id).concat(p.grid.constraints);\n"
    "      if (!D.metadata.createdAt) D.metadata = p.metadata; else D.metadata.coverage = [...(D.metadata.coverage || []).filter(c => String(c.nodeId) !== id), ...p.metadata.coverage];\n"
    "      busLoad.set(id, 'ok');\n"
    "      if (id === String(S.nodeId) && (!S.basis || String(S.basis.nodeId) !== id)) { resetBasisForNode(); }\n"
    "      render();\n"
    "    })\n"
    "    .catch(e => { busLoad.set(id, e); render(); });\n"
    "}\n"
    "export const busReady = id => busLoad.get(String(id)) === 'ok' && busLoad.get('hub') === 'ok';")

# ---- header badge ----
rep("<span class=\"badge\">ISOLATED PREVIEW · SNAPSHOT ${esc(created)}</span>",
    "<span class=\"badge\">ISOLATED PREVIEW · ${fmtInt(D.index.length)} BUSES · DATA ${esc(created || '…')}</span>")
rep("const esc = s =>", "const fmtInt = n => Number(n).toLocaleString('en-US');\nconst esc = s =>")

# ---- sidebar: in standalone mode, links to the other pages ----
rep("  const items = STAGES.map((s, i) => `<button class=\"stage ${s.key === S.stage ? 'active' : ''}\" data-act=\"stage\" data-v=\"${s.key}\"",
    "  if (ONLY) {\n"
    "    const links = STAGES.map((s, i) => `<a class=\"stage button ${s.key === ONLY ? 'active' : ''}\" href=\"./${PAGES[s.key]}#bus=${S.nodeId}\" aria-current=\"${s.key === ONLY ? 'page' : 'false'}\"><span class=\"n\">${i + 1}</span>${esc(s.name)}</a>`).join('');\n"
    "    return `<nav class=\"sidebar\" aria-label=\"Dashboards\"><div class=\"eyebrow\">Standalone dashboards</div>${links}<div class=\"sidebar-foot\"><strong>One page per dashboard.</strong>Each opens on the same bus; settings and hand-offs are shared in this browser.</div></nav>`;\n"
    "  }\n"
    "  const items = STAGES.map((s, i) => `<button class=\"stage ${s.key === S.stage ? 'active' : ''}\" data-act=\"stage\" data-v=\"${s.key}\"")

# ---- context: searchable picker over all buses + price mapping notice ----
rep("  const opts = D.nodes.filter(n => n.id !== 'hub').map(n => `<option value=\"${n.id}\" ${String(n.id) === String(S.nodeId) ? 'selected' : ''}>${esc(n.name)} · ${esc(n.load_zone || '')} · ${n.id}</option>`).join('');",
    "  const cur = indexOf(S.nodeId);\n"
    "  const label = b => `${b.name} · ${b.substation || ''} · ${b.kv ?? '?'} kV · ${b.zone || ''} · ${b.id}`;\n"
    "  const opts = D.index.map(b => `<option value=\"${esc(label(b))}\"></option>`).join('');")
rep("    <label>Candidate bus<select data-act=\"node\">${opts}</select></label>",
    "    <label class=\"bus-pick\">Candidate bus <span class=\"audit-note\" style=\"margin:0\">(${fmtInt(D.index.length)} buses: type a name, substation, zone or id)</span><input list=\"bus-list\" data-act=\"node-find\" value=\"${esc(cur ? label(cur) : '')}\" autocomplete=\"off\" spellcheck=\"false\"><datalist id=\"bus-list\">${opts}</datalist></label>")
rep("  </section>`;\n}\n\nfunction mainView() {",
    "  </section>${mappingNote(cur)}`;\n}\n\n"
    "function mappingNote(b) {\n"
    "  if (!b) return '';\n"
    "  const t = { direct: ['good', 'Own price node'], same_substation: ['', 'Price node at the same substation'], geo_proxy: ['warn', `Borrowed price: nearest node ${Number(b.proxyKm).toFixed(1)} km away`] }[b.tier] || ['warn', b.tier];\n"
    "  return `<div class=\"mapping-note\"><span class=\"pill ${t[0]}\">${esc(t[1])}</span> Prices for this bus come from <b>${esc(b.pnode)}</b>.${b.tier === 'geo_proxy' ? ' This bus has no settlement node of its own, so its congestion and losses are the neighbour\\'s, not its own.' : ''}</div>`;\n"
    "}\n\n"
    "function mainView() {")

# ---- mainView: loading / error gate for price data ----
rep("  const tab = activeTab(st);\n  const tabs = `<div class=\"tabs\" role=\"tablist\">",
    "  const tab = activeTab(st);\n"
    "  const bl = busLoad.get(String(S.nodeId)), hl = busLoad.get('hub');\n"
    "  if (bl instanceof Error || hl instanceof Error) return `${head}<div class=\"notice error\" role=\"alert\">Could not load data for this bus: ${esc((bl instanceof Error ? bl : hl).message)}. Pick another bus.</div>`;\n"
    "  if (!busReady(S.nodeId)) return `${head}<div class=\"loading-panel\" role=\"status\"><span class=\"spinner\" aria-hidden=\"true\"></span><b>Loading hourly prices for ${esc(indexOf(S.nodeId)?.name || S.nodeId)}</b><span>Six years of history and five forecast runs are read from the local database: about 5–8 s the first time, instant after that.</span></div>`;\n"
    "  const tabs = `<div class=\"tabs\" role=\"tablist\">")

# ---- render: always ask for the current bus + hub ----
rep("  resetCharts();\n  ensureStudy();",
    "  resetCharts();\n  ensureBus('hub'); ensureBus(S.nodeId);\n  ensureStudy();")

# ---- actions ----
rep("  node: v => { S.nodeId = v; resetBasisForNode(); },",
    "  node: v => { S.nodeId = v; S.basis = null; if (busReady(v)) resetBasisForNode(); },\n"
    "  'node-find': v => { const id = (String(v).match(/·\\s*(\\d+)\\s*$/) || [])[1] || (D.index.find(b => b.name.toLowerCase() === String(v).trim().toLowerCase()) || {}).id; if (!id) { toast('Pick a bus from the list.'); return; } ACTIONS.node(id); },")
rep("  stage: v => { S.stage = v; },",
    "  stage: v => { if (ONLY && v !== ONLY) { leave(v); return; } S.stage = v; },")
rep("  goto: (v, el) => { S.stage = v; if (el.dataset.tab) S.tabs[v] = el.dataset.tab; },",
    "  goto: (v, el) => { if (el.dataset.tab) S.tabs[v] = el.dataset.tab; if (ONLY && v !== ONLY) { leave(v, el.dataset.tab); return; } S.stage = v; },")
rep("  'pick-bus': v => { S.nodeId = v; resetBasisForNode(); S.stage = 'grid'; S.tabs.grid = 'capacity'; toast('Candidate set. Opened in Grid.'); },",
    "  'pick-bus': v => { S.nodeId = v; S.basis = null; S.tabs.grid = 'capacity'; if (ONLY && ONLY !== 'grid') { leave('grid', 'capacity'); return; } S.stage = 'grid'; toast('Candidate set. Opened in Grid.'); },")
rep("  'goto-where': v => { const [stg, tb] = String(v).split(' › '); const st = STAGES.find(s => s.name === stg.trim()); if (!st) return; S.stage = st.key; const t = st.view?.tabs.find(x => x.label === (tb || '').trim()); if (t) S.tabs[st.key] = t.id; },",
    "  'goto-where': v => { const [stg, tb] = String(v).split(' › '); const st = STAGES.find(s => s.name === stg.trim()); if (!st) return; const t = st.view?.tabs.find(x => x.label === (tb || '').trim()); if (t) S.tabs[st.key] = t.id; if (ONLY && st.key !== ONLY) { leave(st.key, t?.id); return; } S.stage = st.key; },")
rep("let liveT = null;",
    "/** Standalone mode: open another dashboard's page on the same bus (state travels via localStorage). */\n"
    "function leave(key, tab) { save(); location.href = `./${PAGES[key]}#${tab ? `tab=${tab}&` : ''}bus=${S.nodeId}`; }\n\n"
    "let liveT = null;")

# ---- node-find is an input: commit on change only ----
# (onEvent treats inputs as fields: change → action; typing does not render.)

# ---- boot: index instead of snapshot ----
rep("async function boot() {\n  const r = await fetch('./data/snapshot.json');\n  if (!r.ok) throw new Error(`Snapshot not found (${r.status})`);\n  D = await r.json();",
    "export async function mount(opts = {}) {\n  ONLY = opts.only || null;\n  if (ONLY) S.stage = ONLY;\n  return boot();\n}\n\n"
    "async function boot() {\n  const r = await fetch('./api/buses');\n  if (!r.ok) throw new Error(`Bus index not available (${r.status}). Start the preview with server.py.`);\n"
    "  D = { metadata: {}, nodes: [], series: [], grid: { headroom: [], constraints: [], source: 'unified.fact_headroom / fact_limiting_element' }, index: (await r.json()).buses };")
rep("  if (!D.nodes.some(n => String(n.id) === String(S.nodeId))) S.nodeId = D.nodes.find(n => n.id !== 'hub').id;\n  if (!S.basis || String(S.basis.nodeId) !== String(S.nodeId)) S.basis = defaultBasis(D, S.nodeId);\n  S.draft = structuredClone(S.basis);",
    "  if (!indexOf(S.nodeId)) S.nodeId = '111403';\n  if (S.basis && String(S.basis.nodeId) !== String(S.nodeId)) S.basis = null;\n  S.draft = S.basis ? structuredClone(S.basis) : null;")
rep("  window.addEventListener('hashchange', () => { closeDrawer(); readHash(); if (!S.basis) { S.basis = defaultBasis(D, S.nodeId); S.draft = structuredClone(S.basis); } render(); });",
    "  window.addEventListener('hashchange', () => { closeDrawer(); readHash(); if (!S.basis && busReady(S.nodeId)) resetBasisForNode(); render(); });")
rep("boot().catch(e =>", "(window.GS_STANDALONE ? Promise.resolve() : boot()).catch(e =>")
# render(): basis-dependent context must tolerate a bus still loading
rep("<div class=\"basis\"><b>Price basis</b><br>${esc(describe(S.basis))}",
    "<div class=\"basis\"><b>Price basis</b><br>${S.basis ? esc(describe(S.basis)) : 'loading…'}")
a.write_text(t, encoding="utf-8")

css = P / "app.css"
css.write_text(css.read_text(encoding="utf-8") +
               ".bus-pick input{min-width:min(460px,80vw);border:1px solid #bacbd3;border-radius:6px;padding:8px 10px;font-weight:600;font-size:13px;color:var(--ink)}\n"
               ".mapping-note{font-size:12px;color:var(--muted);margin:-14px 0 20px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}\n"
               ".loading-panel{display:grid;gap:8px;justify-items:center;text-align:center;padding:60px 20px;border:1px dashed #bacbd3;border-radius:10px;background:#fff;color:var(--muted);font-size:13px}.loading-panel b{color:var(--ink);font-size:15px}\n"
               ".spinner{width:26px;height:26px;border:3px solid #d6e3e7;border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}\n"
               "a.stage{justify-content:flex-start;border:0;padding:13px 12px;background:transparent;font-size:14px;gap:12px;min-height:0}a.stage.active{background:var(--soft);color:#135960}\n", encoding="utf-8")

# standalone pages
html = (P / "analytics-analyzer-studio.html").read_text(encoding="utf-8")
print(html[:600])
