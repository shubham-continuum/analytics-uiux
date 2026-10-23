// Shared interaction helpers: sortable tables, a detail drawer, zoom/pan maps, focus restore.
const num = t => { const s = String(t).replace(/[,\s]/g, ''); const m = /^[≥−-]?\$?(-?[\d.]+)([kM])?/.exec(s.replace('−', '-')); if (!m) return null; let v = parseFloat(m[1]); if (m[2] === 'k') v *= 1e3; if (m[2] === 'M') v *= 1e6; return (s.startsWith('−') || s.startsWith('-')) && v > 0 ? -v : v; };

/** Click any header of a .sortable table (or any table inside .table-wrap) to sort by that column. */
export function mountTables(root) {
  root.querySelectorAll('.table-wrap table').forEach(tb => {
    if (tb.dataset.nosort !== undefined || tb.dataset.sortReady) return;
    tb.dataset.sortReady = '1';
    tb.querySelectorAll('thead th').forEach((th, ci) => {
      if (!th.textContent.trim()) return;
      th.tabIndex = 0; th.classList.add('sortable-th'); th.setAttribute('aria-sort', 'none');
      const go = () => {
        const dir = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : 'ascending';
        tb.querySelectorAll('thead th').forEach(x => x.setAttribute('aria-sort', 'none')); th.setAttribute('aria-sort', dir);
        const body = tb.tBodies[0]; if (!body) return;
        const rows = [...body.rows].filter(r => r.cells.length > ci && !r.querySelector('td[colspan]'));
        rows.sort((a, b) => {
          const x = a.cells[ci].textContent.trim(), y = b.cells[ci].textContent.trim(), nx = num(x), ny = num(y);
          const c = nx != null && ny != null ? nx - ny : nx != null ? -1 : ny != null ? 1 : x.localeCompare(y);
          return dir === 'ascending' ? c : -c;
        });
        rows.forEach(r => body.appendChild(r));
      };
      th.addEventListener('click', go);
      th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  });
}

// ---------- Drawer: views render <template data-drawer="id" data-title="..."> ----------
export function openDrawer(root, id) {
  const tpl = root.querySelector(`template[data-drawer="${CSS.escape(id)}"]`); if (!tpl) return;
  closeDrawer();
  const d = document.createElement('aside');
  d.className = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', tpl.dataset.title || 'Details');
  d.innerHTML = `<div class="drawer-head"><h2>${tpl.dataset.title || 'Details'}</h2><button type="button" class="tiny" data-close-drawer>Close</button></div><div class="drawer-body"></div>`;
  d.querySelector('.drawer-body').appendChild(tpl.content.cloneNode(true));
  const bg = document.createElement('div'); bg.className = 'drawer-bg'; bg.dataset.closeDrawer = '';
  // v6: overlays live in #gsx-overlay (.gsx-layer), the root the scoped preview stylesheet styles.
  (document.getElementById('gsx-overlay') || document.body).append(bg, d);
  d.querySelector('[data-close-drawer]').focus();
  return d;
}
export function closeDrawer() { document.querySelectorAll('.drawer, .drawer-bg').forEach(n => n.remove()); }

// ---------- Maps: <svg data-map="id" viewBox="..."> with wheel zoom, drag pan, +/−/reset ----------
const MAPVIEW = new Map();
/** Forget a map's zoom and pan (its drawing changed frame, so the stored view no longer fits it). */
export function forgetMapView(id) { MAPVIEW.delete(id); }
export function mountMaps(root) {
  root.querySelectorAll('svg[data-map]').forEach(svg => {
    const id = svg.dataset.map, base = svg.getAttribute('viewBox').split(' ').map(Number);
    svg.dataset.vb0 = base.join(' '); // the drawn coordinate frame, for handlers that map a click back to lon/lat
    let [x, y, w, h] = MAPVIEW.get(id) || base;
    const dots = [...svg.querySelectorAll('circle[data-r]')];
    const set = () => { svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`); MAPVIEW.set(id, [x, y, w, h]); const k = base[2] / w; for (const c of dots) c.setAttribute('r', (c.dataset.r / Math.sqrt(k)).toFixed(2)); };
    set();
    // The drawn frame inside the element (preserveAspectRatio meet): a map held at a fixed height is letterboxed.
    const box = () => { const b = svg.getBoundingClientRect(), ar = base[2] / base[3]; let { left, top, width, height } = b; if (width / height > ar) { const w2 = height * ar; left += (width - w2) / 2; width = w2; } else { const h2 = width / ar; top += (height - h2) / 2; height = h2; } return { left, top, width, height }; };
    const zoom = (f, cx = x + w / 2, cy = y + h / 2) => { const nw = Math.min(base[2], Math.max(base[2] / 12, w * f)), nh = nw * (base[3] / base[2]); x = cx - (cx - x) * (nw / w); y = cy - (cy - y) * (nh / h); w = nw; h = nh; set(); };
    svg.addEventListener('wheel', e => { e.preventDefault(); const b = box(); zoom(e.deltaY > 0 ? 1.2 : 1 / 1.2, x + ((e.clientX - b.left) / b.width) * w, y + ((e.clientY - b.top) / b.height) * h); }, { passive: false });
    let drag = null;
    svg.addEventListener('pointerdown', e => { if (e.target.closest('[data-act]')) return; drag = { sx: e.clientX, sy: e.clientY, x, y }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener('pointermove', e => { if (!drag) return; const b = box(); x = drag.x - ((e.clientX - drag.sx) / b.width) * w; y = drag.y - ((e.clientY - drag.sy) / b.height) * h; set(); });
    svg.addEventListener('pointerup', () => { drag = null; });
    const ctl = svg.parentElement.querySelector('.map-ctl');
    ctl?.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.z === 'in') zoom(1 / 1.5); else if (b.dataset.z === 'out') zoom(1.5); else { [x, y, w, h] = base; set(); } });
    // Hover tooltip from data-tip
    const tip = svg.parentElement.querySelector('.chart-tip');
    if (tip) {
      svg.addEventListener('pointerover', e => { const c = e.target.closest('[data-tip]'); if (!c) return; const b = svg.parentElement.getBoundingClientRect(); tip.innerHTML = c.dataset.tip; tip.hidden = false; tip.style.left = `${Math.min(e.clientX - b.left + 12, b.width - 220)}px`; tip.style.top = `${e.clientY - b.top - 10}px`; });
      svg.addEventListener('pointerout', e => { if (e.target.closest('[data-tip]')) tip.hidden = true; });
    }
  });
}

// ---------- Depth contract (GAP-BRIEF v4 "Shared contracts › Depth") ----------
// Cumulative levels as in the Studio (src/app.js:858-909). Views tag each card with the MINIMUM depth
// at which it appears (data-depth); the shell hides the rest and says how many more a higher depth shows.
export const DEPTHS = ['screen', 'review', 'study'];
export const DEPTH_LABEL = { screen: 'Screen', review: 'Review', study: 'Study' };
export const normDepth = v => { const d = String(v ?? '').toLowerCase(); return DEPTHS.includes(d) ? d : 'review'; };
export const depthAllows = (min, cur) => DEPTHS.indexOf(min) <= DEPTHS.indexOf(normDepth(cur));
/** An element's minimum depth: its tag when valid; an untagged trace card is Study; any other untagged card always shows. */
export function elementDepth({ depth, trace }) {
  const d = String(depth ?? '').toLowerCase();
  if (DEPTHS.includes(d)) return d;
  return trace ? 'study' : 'screen';
}
/** Cards (their minimum depths) hidden at `cur`, by level. */
export function hiddenSummary(depths, cur) {
  const out = { total: 0, review: 0, study: 0 };
  for (const d of depths) if (!depthAllows(d, cur)) { out.total++; out[d]++; }
  return out;
}
/** DOM: hide every [data-depth] element (and untagged trace cards) above `cur` inside `root`; returns the card summary. */
export function applyDepth(root, cur) {
  if (!root) return { total: 0, review: 0, study: 0 };
  const cardDepths = [];
  root.querySelectorAll('[data-depth], section.card-trace').forEach(el => {
    const d = elementDepth({ depth: el.getAttribute('data-depth'), trace: el.classList.contains('card-trace') });
    const show = depthAllows(d, cur);
    el.hidden = !show; el.classList.toggle('depth-off', !show);
    if (el.matches('section.card, .card')) cardDepths.push(d);
  });
  return hiddenSummary(cardDepths, cur);
}
/** Footer under a tab: "Raise depth to see N more" with one button per higher level that has hidden cards. */
export function depthFooter(sum, cur) {
  if (!sum.total) return '';
  const parts = DEPTHS.filter(d => sum[d]).map(d => `${sum[d]} at ${DEPTH_LABEL[d]}`);
  const btns = DEPTHS.filter(d => DEPTHS.indexOf(d) > DEPTHS.indexOf(cur) && DEPTHS.slice(DEPTHS.indexOf(cur) + 1, DEPTHS.indexOf(d) + 1).some(x => sum[x]))
    .map(d => `<button type="button" class="tiny" data-act="depth" data-v="${d}">Show ${DEPTH_LABEL[d]}</button>`).join('');
  return `<div class="depth-more" role="note"><span>Raise depth to see ${sum.total} more card${sum.total === 1 ? '' : 's'} (${parts.join(', ')}).</span>${btns}</div>`;
}

/** A tab's label for the selected fuel: view.tabs[i].labelFor?.(tech), falling back to label. */
export function tabLabel(t, tech) {
  try { const l = t.labelFor?.(tech); if (l) return String(l); } catch { /* a view's labelFor failed: use the plain label */ }
  return t.label;
}

// ---------- Sample projects (data/samples.json, written by the Samples agent) ----------
/** Keep only well-formed projects; ids become strings. Returns {projects, problems}. */
export function normSamples(j) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.projects)) return { projects: [], problems: ['samples file is not an object with a projects list'] };
  const projects = [], problems = [];
  j.projects.forEach((p, i) => {
    if (!p || !p.id) { problems.push(`project ${i + 1}: no id`); return; }
    const options = (p.options || []).filter(o => o && o.id && o.busId != null).map(o => ({ ...o, id: String(o.id), busId: String(o.busId) }));
    if (!options.length) { problems.push(`${p.id}: no options with a bus`); return; }
    const steps = (p.steps || []).filter(s => s && s.stage);
    projects.push({ ...p, id: String(p.id), name: p.name || String(p.id), options, steps,
      exportMW: Number.isFinite(Number(p.exportMW)) ? Number(p.exportMW) : null, importMW: Number.isFinite(Number(p.importMW)) ? Number(p.importMW) : null });
  });
  return { projects, problems };
}
/** A step's stage (key or name) and tab (id or label) resolved against the app's stages; null when the stage is unknown. */
export function resolveStep(step, stages) {
  const lc = s => String(s ?? '').trim().toLowerCase();
  const st = stages.find(s => lc(s.key) === lc(step?.stage) || lc(s.name) === lc(step?.stage));
  if (!st) return null;
  const tabs = st.view?.tabs || [];
  const t = tabs.find(x => lc(x.id) === lc(step.tab) || lc(x.label) === lc(step.tab) || (x.labelFor && ['solar', 'wind', 'storage', 'hybrid', 'datacenter'].some(f => { try { return lc(x.labelFor(f)) === lc(step.tab); } catch { return false; } })));
  // A former tab id a view keeps as an alias (view.tabAlias) resolves to its tab; the alias itself is the step's focus.
  const alias = !t && st.view?.tabAlias ? st.view.tabAlias[lc(step.tab)] : null, ta = alias ? tabs.find(x => x.id === alias) : null;
  return { stage: st.key, tab: t ? t.id : ta ? ta.id : null, ...(ta ? { focus: lc(step.tab) } : {}), depth: normDepth(step.depth), text: String(step.what_to_look_at ?? ''), option: step.option != null ? String(step.option) : null };
}
/** The state a walkthrough step sets: bus (the step's option, else the chosen one), fuel, MW, depth, stage/tab, pins and Decision options. */
export function stepPatch(project, optionId, i, stages) {
  const n = project.steps.length, step = n ? Math.max(0, Math.min(n - 1, Number(i) || 0)) : 0;
  const r = n ? resolveStep(project.steps[step], stages) : null;
  const opt = project.options.find(o => o.id === (r?.option || optionId)) || project.options.find(o => o.id === optionId) || project.options[0];
  const chosenOpt = project.options.find(o => o.id === optionId) || project.options[0];
  const pins = [...new Set(project.options.map(o => o.busId))];
  return {
    project: project.id, option: chosenOpt.id, step, of: n,
    nodeId: opt.busId, tech: project.tech || null, exportMW: project.exportMW, importMW: project.importMW,
    depth: r ? r.depth : null, stage: r ? r.stage : null, tab: r ? r.tab : null, focus: r?.focus ?? null, text: r ? r.text : '',
    pins, dOpts: pins.filter(id => id !== opt.busId),
  };
}
/** A sample's basis over the bus default: only known keys; historical years kept only where held (none held → default years). */
export function basisFromSample(def, sb, heldYears) {
  if (!sb || typeof sb !== 'object') return def;
  const out = { ...def };
  for (const k of ['mode', 'market', 'run', 'weighting', 'includePartial', 'strict']) if (sb[k] !== undefined) out[k] = sb[k];
  if (out.mode === 'historical' && Array.isArray(sb.years)) {
    const held = heldYears(out.market) || [];
    const ys = sb.years.map(Number).filter(y => held.includes(y));
    out.years = ys.length ? ys : def.years;
    if (!ys.length) { out.market = def.market; }
  }
  return out;
}

// ---------- Presets (views define view.presets; the shell applies them) ----------
const plain = v => v && typeof v === 'object' && !Array.isArray(v);
/** The S.ui patch a preset stands for: {ui:{…}} | function(ui, S) → patch | a plain patch object. */
export function presetPatch(p, ui, S) {
  if (!p) return null;
  if (typeof p === 'function') return p(ui, S) || null;
  if (plain(p.ui)) return p.ui;
  return p;
}
/** New S.ui with the patch applied: plain objects merge one level deep, undefined deletes a key. */
export function applyPreset(ui, patch) {
  const out = { ...ui };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v === undefined) delete out[k];
    else if (plain(v) && plain(out[k])) out[k] = { ...out[k], ...structuredClone(v) };
    else out[k] = plain(v) || Array.isArray(v) ? structuredClone(v) : v;
  }
  return out;
}
/** Markup for a view's preset switch (views place it in a card's tools). */
export function presetBar(presets, active, label = 'Assumptions') {
  const names = Object.keys(presets || {});
  if (!names.length) return '';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<div class="segmented seg-sm preset-bar" role="group" aria-label="${esc(label)} preset">${names.map(n => `<button type="button" class="${n === active ? 'active' : ''}" data-act="preset" data-v="${esc(n)}" title="${esc(presets[n]?.note || '')}">${esc(presets[n]?.label || n)}</button>`).join('')}</div>`;
}

// ---------- Pins ----------
export function togglePin(pins, id) { const s = String(id), a = (pins || []).map(String); return a.includes(s) ? a.filter(x => x !== s) : [...a, s]; }
/** Decision compares the current bus plus up to two others. */
export function pinsForCompare(pins, cur) { const o = (pins || []).map(String).filter(x => x !== String(cur)); return { dOpts: o.slice(0, 2), dropped: o.slice(2) }; }
/** A pin toggle for any bus (views may put it on rows or map popups). */
export function pinButton(busId, S) {
  const on = (S.pins || []).map(String).includes(String(busId));
  return `<button type="button" class="pin-btn tiny ${on ? 'on' : ''}" data-act="pin" data-v="${String(busId).replace(/"/g, '')}" aria-pressed="${on}" title="${on ? 'Unpin this bus' : 'Pin this bus for comparison'}">${PIN_SVG}<span class="sr">${on ? 'Unpin' : 'Pin'}</span></button>`;
}
export const PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l-1 6 4 4H6l4-4z"/><path d="M12 13v8"/></svg>';

// ---------- v5 Studio parity: stage dots, provenance chips, selection chips, card decorator ----------
const STAGE_KEYS = ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision'];
/**
 * Stage dot per dashboard from its hand-off: current (sent for this bus and these inputs), stale (sent, but the bus,
 * size, fuel or price basis has changed since) or none. Market, Land and Queue send nothing downstream.
 */
export function handoffStates(S, basisHash) {
  const H = S.handoffs || {}, bus = String(S.nodeId), out = {};
  const judge = (h, checks) => {
    if (!h) return null;
    if (String(h.busId) !== bus) return { state: 'stale', why: `sent for another bus (${h.busId})` };
    for (const [bad, why] of checks) if (bad) return { state: 'stale', why };
    return { state: 'current', why: `sent ${String(h.at || '').slice(0, 16).replace('T', ' ')}` };
  };
  for (const k of STAGE_KEYS) out[k] = { state: 'none', why: ['market', 'land', 'queue'].includes(k) ? 'No hand-off from this dashboard: its results are read in place' : 'Nothing sent yet' };
  const pr = judge(H.prices, [[H.prices?.hash !== basisHash, 'the price basis has changed since it was sent']]);
  if (pr) out.prices = pr;
  const g = judge(H.grid, [[H.grid?.tech !== S.tech, `sent for ${H.grid?.tech}`], [Number(H.grid?.requestMW) !== Number(S.exportMW), `sent for ${H.grid?.requestMW} MW`]]) || judge(H.cost, []);
  if (g) out.grid = g;
  const r = judge(H.revenue, [[H.revenue?.tech !== S.tech && !(H.revenue?.tech === 'storage' && S.tech === 'hybrid'), `sent for ${H.revenue?.tech}`], [H.revenue?.hash && H.revenue.hash !== basisHash, 'the price basis has changed since it was sent']]);
  if (r) out.economics = r;
  if ((S.decisions || []).length) out.decision = { state: 'current', why: `${S.decisions.length} decision(s) recorded` };
  return out;
}

export const CHIP_LABEL = { 'studio-copy': ['warn', 'Studio copy'], modelled: ['', 'modelled'], assumption: ['warn', 'assumption'], 'geo-proxy': ['warn', 'borrowed price'], 'not-held': ['', 'not held'], 'envelope-only': ['warn', 'envelope only'], pending: ['warn', 'pending §205 filing'] }; // pending: S6 large-load proposal (rules/isone-2026.json large_load.filing)
/** data-chips="a b c" → [{key, tone, label}] for the known provenance tokens. */
export function chipList(attr) { return String(attr || '').split(/\s+/).filter(k => CHIP_LABEL[k]).map(k => ({ key: k, tone: CHIP_LABEL[k][0], label: CHIP_LABEL[k][1] })); }

/** The SELECTION row: a sample's options, or (no sample) the current bus followed by the pinned buses. */
export function selectionChips(S, project, infoOf) {
  const cmp = new Set([String(S.nodeId), ...(S.ui?.dOpts || []).map(String)]);
  if (project) return project.options.map(o => ({ id: o.id, label: o.label, sub: `${o.busName || infoOf(o.busId)?.name || ''} · ${o.busId}`, current: o.id === S.walk?.option, compare: o.id === S.walk?.option || cmp.has(String(o.busId)), act: 'sel-opt' }));
  const ids = [...new Set([String(S.nodeId), ...(S.pins || []).map(String)])];
  return ids.map(id => { const b = infoOf(id) || {}; return { id, label: b.name || id, sub: `${b.kv ?? '?'} kV · ${id}`, current: id === String(S.nodeId), compare: cmp.has(id), act: 'node' }; });
}

const ICON_SVG = {
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path d="M20 4l-7 7"/><path d="M4 20l7-7"/></svg>',
};
/** DOM: give every analyzer card the live Studio card grammar (section.w > .w-h > h3.w-q + .w-tools; .w-badges), so the
 *  live stylesheet styles it: pin, menu-less tools (expand, i → its calculation, live link) and provenance badges. */
const LIVE_ICON = {
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M5 17h14l-1.5-5H6.5z"></path><path d="M9 3h6l-1 9H10z"></path></svg>',
};
const BADGE = { 'studio-copy': 'warn', modelled: 'model', assumption: 'warn', 'geo-proxy': 'warn', 'not-held': '', 'envelope-only': 'warn', pending: 'warn' };
/** M4 Inspector selection key per card: its title, plus #n when the title repeats on the tab. Pure (node-tested). */
export function cardKeys(titles) {
  const seen = new Map();
  return titles.map(t => { const s = String(t || '').replace(/\s+/g, ' ').trim() || 'Card', n = seen.get(s) || 0; seen.set(s, n + 1); return n ? `${s}#${n}` : s; });
}
/** M4: a click on a board card (not on its controls) selects it for the Inspector; the (i) icon also opens its Card tab.
 *  Emitted as `gsone:card` {key, trace, open} on window; views/inspector.js turns it into S.ui.inspect. Installed once. */
const CARD_SKIP = 'a, button, input, select, textarea, label, summary, details.trace, [data-act], [role="button"], [contenteditable], svg[data-map], svg[data-site-map], .map-ctl, .table-wrap th';
function installCardSelect() {
  if (installCardSelect.done || typeof document === 'undefined') return;
  installCardSelect.done = true;
  // Capture phase: read the card before the shell's handler re-renders the board (the (i) may raise the depth), then
  // emit after it, so the Inspector reads the board the shell left.
  document.addEventListener('click', e => {
    const sec = e.target.closest?.('#board [role="tabpanel"] section.card[data-insp-key]'); if (!sec) return;
    const info = e.target.closest('[data-act="card-trace"]');
    if (!info && e.target.closest(CARD_SKIP)) return;
    if (!info && String(window.getSelection?.() || '').trim()) return; // selecting text is not a click
    const detail = { key: sec.dataset.inspKey, trace: info?.dataset.v || null, open: !!info };
    setTimeout(() => window.dispatchEvent(new CustomEvent('gsone:card', { detail })), 0);
  }, true);
}
export function decorateCards(root) {
  const panel = root.querySelector('[role="tabpanel"]'); if (!panel) return;
  const firstTrace = panel.querySelector('details.trace[data-trace]')?.dataset.trace || null;
  const secs = [...panel.querySelectorAll('section.card')], keys = cardKeys(secs.map(s => s.querySelector(':scope > .card-h h3')?.textContent));
  secs.forEach((s, i) => { s.dataset.inspKey = keys[i]; });
  installCardSelect();
  panel.querySelectorAll('section.card').forEach(sec => {
    const h = sec.querySelector(':scope > .card-h'); if (!h || h.querySelector('.w-tools')) return;
    sec.classList.add('w'); h.classList.add('w-h'); h.querySelector('h3')?.classList.add('w-q');
    // Quiet mode hides captions (live default); the caption stays one hover away on the title.
    const h3 = h.querySelector('h3'), sub = h.querySelector('.card-sub')?.textContent.trim(); if (h3 && sub && !h3.title) h3.title = sub;
    const own = sec.dataset.trace || sec.querySelector('details.trace[data-trace]')?.dataset.trace || null;
    const tr = sec.classList.contains('card-trace') ? null : own || (sec.querySelector('.kpis, .chart-host, table') ? firstTrace : null);
    const tools = document.createElement('div'); tools.className = 'w-tools card-icons';
    tools.innerHTML = `<button type="button" class="ibtn ci" data-act="card-expand" title="Expand card">${LIVE_ICON.expand}<span class="sr">Expand</span></button>${tr ? `<button type="button" class="ibtn gsq-i ci" data-act="card-trace" data-v="${tr.replace(/"/g, '')}" title="How this is calculated: open the calculation trace${own ? '' : ' for this tab'}">i</button>` : ''}`;
    h.appendChild(tools);
    const chips = chipList(sec.dataset.chips);
    if (chips.length) h.insertAdjacentHTML('afterend', `<div class="w-badges card-chips">${chips.map(c => `<span class="badge ${BADGE[c.key] ?? ''} chip" data-chip="${c.key}">${c.label}</span>`).join('')}</div>`);
  });
}

/** Sizes after a fuel switch, in the live Studio's directions and default sizes (solar 100, wind 150, BESS 100, DC 250). */
const DEF_MW = { solar: 100, wind: 150, storage: 100, hybrid: 100, datacenter: 250 };
export function fuelSizes(tech, exportMW, importMW) {
  const ex = Number(exportMW) > 0 ? Number(exportMW) : 0, im = Number(importMW) > 0 ? Number(importMW) : 0;
  if (tech === 'datacenter') return { exportMW: 0, importMW: im || ex || DEF_MW.datacenter };
  if (tech === 'storage') { const e = ex || im || DEF_MW.storage; return { exportMW: e, importMW: im || e }; }
  if (tech === 'hybrid') return { exportMW: ex || DEF_MW.hybrid, importMW: im };
  return { exportMW: ex || im || DEF_MW[tech] || 100, importMW: 0 };
}

// ---------- Focus restore across re-renders ----------
export function focusKey() {
  const a = document.activeElement; if (!a || a === document.body) return null;
  const pick = ['act', 'k', 'id', 'f', 'v'].map(k => a.dataset?.[k]).filter(Boolean);
  if (!pick.length) return null;
  return { sel: ['act', 'k', 'id', 'f'].filter(k => a.dataset?.[k]).map(k => `[data-${k}="${CSS.escape(a.dataset[k])}"]`).join('') + (a.dataset.v && !a.dataset.k ? `[data-v="${CSS.escape(a.dataset.v)}"]` : ''), pos: a.selectionStart };
}
export function restoreFocus(root, key) {
  if (!key?.sel) return;
  const el = root.querySelector(key.sel); if (!el) return;
  el.focus({ preventScroll: true });
  try { if (key.pos != null && el.setSelectionRange) el.setSelectionRange(key.pos, key.pos); } catch { /* number inputs do not support selection */ }
}
