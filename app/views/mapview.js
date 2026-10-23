// Map views (Market, Land, Grid; 2026-10-22, tabs back 2026-10-23). Each stage opens on a Map tab: the map drawn at its
// own pixel size and framed so what it shows sits in the room the floating panels take (a padding-aware fit that does not
// change when a panel folds, so the map never jumps), redrawn in place only when its size changes (a dock folds, the
// window changes, the card is maximised). The categories' long evidence (checklists, tables, charts) is on their own tabs
// again, as before; one bar of buttons switches between the map and them, each showing its result and the inputs set in
// it. The evidence cards are packed by their own height, so a short chart never leaves a row of empty space beside a
// long table.
import { geoMapSvg } from '../geomap.js';
import { mountMaps, forgetMapView } from '../ui.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const escA = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const COS0 = 0.725374; // the basemap's reference cosine (data/basemap.json cos0, geomap's default)

/** The box {lon0, lat0, lon1, lat1} around the points ({lon, lat} or [lon, lat]), padded by padMi miles. */
export function boxOf(pts, padMi = 0) {
  let lon0 = Infinity, lon1 = -Infinity, lat0 = Infinity, lat1 = -Infinity;
  for (const p of pts) {
    const lon = p.lon ?? p[0], lat = p.lat ?? p[1];
    if (!ok(lon) || !ok(lat)) continue;
    if (lon < lon0) lon0 = lon; if (lon > lon1) lon1 = lon; if (lat < lat0) lat0 = lat; if (lat > lat1) lat1 = lat;
  }
  if (!Number.isFinite(lon0)) return null;
  const pLat = Math.max(padMi, 0.5) / 69, pLon = Math.max(padMi, 0.5) / (69 * COS0);
  return { lon0: lon0 - pLon, lat0: lat0 - pLat, lon1: lon1 + pLon, lat1: lat1 + pLat };
}
/** The extent at which the box fills the canvas minus the padding, at one scale, centred in that room. Its aspect is the
 *  canvas's, so the projection has no letterbox and a click fraction maps linearly to lon/lat. */
export function padExtent(box, W, H, pad) {
  if (!box) return { lon0: -73.8, lat0: 41.0, lon1: -66.8, lat1: 47.5 };
  const { lon0, lat0, lon1, lat1 } = box;
  const fw = Math.max(60, W - pad.l - pad.r), fh = Math.max(60, H - pad.t - pad.b), s = Math.min(fw / ((lon1 - lon0) * COS0), fh / (lat1 - lat0));
  const X0 = ((lon0 + lon1) / 2) * COS0 - (pad.l + fw / 2) / s, Y1 = (lat0 + lat1) / 2 + (pad.t + fh / 2) / s;
  return { lon0: X0 / COS0, lon1: (X0 + W / s) / COS0, lat0: Y1 - H / s, lat1: Y1 };
}
/** Padding for the floats; a float that would leave the content under ~45% of the width overlays instead. */
export function padFor(W, lw, rw, mins) {
  let l = lw ? lw + 18 : 14, r = rw ? rw + 18 : 14;
  const tight = () => W - l - r < Math.max(320, 0.45 * W);
  if (tight()) r = 14;
  if (tight()) l = 14;
  return { l, r, t: mins ? 46 : 14, b: 44 };
}
// The floats' widths by board width (app.css: 290 / 320 px from 1,100 px of board, 250 / 300 px from 720 px; below
// 720 px they overlay). The frame reserves their room whether they are open or folded, so folding one never moves the map.
const floatsFor = (cw, W) => (cw >= 720 ? { l: Math.min(cw >= 1100 ? 290 : 250, W - 20), r: Math.min(cw >= 1100 ? 320 : 300, W - 20) } : { l: 0, r: 0 });
/** Render-time geometry: the last drawn map's size (or an estimate from the board) and the floats' room. */
export function mapGeom() {
  const doc = typeof document !== 'undefined', wb = doc ? document.querySelector('.gsx-an .mk-wb') : null, mw = doc ? document.querySelector('.mk-map-wrap .map-wrap') : null;
  const board = doc ? document.querySelector('#board') : null, vh = doc ? innerHeight : 900;
  const cw = wb?.clientWidth || (board ? board.clientWidth - 24 : 1100);
  const W = Math.round(mw?.clientWidth || cw - 22);
  const H = Math.round(mw?.clientHeight || (cw < 720 ? Math.min(560, Math.max(380, 0.62 * vh)) : Math.min(860, Math.max(440, vh - 330))));
  const f = floatsFor(cw, W);
  return { W, H, pad: padFor(W, f.l, f.r, true) };
}
/** Geometry as drawn on screen now (after a render, or when the map resizes). */
function measureGeom() {
  const wrap = document.querySelector('.mk-map-wrap'), mw = wrap?.querySelector('.map-wrap'); if (!mw || mw.clientWidth < 60) return null;
  const cw = wrap.closest('.mk-wb')?.clientWidth || wrap.clientWidth, W = Math.round(mw.clientWidth), H = Math.round(mw.clientHeight), f = floatsFor(cw, W);
  return { W, H, pad: padFor(W, f.l, f.r, true) };
}
const sameGeom = (a, b) => !!a && !!b && Math.abs(a.W - b.W) <= 2 && Math.abs(a.H - b.H) <= 2 && ['l', 'r', 't', 'b'].every(k => Math.abs(a.pad[k] - b.pad[k]) <= 2);

// One drawing per map id: how to draw it at a geometry (the whole geoMap block, or the svg alone for an in-place
// redraw) and the geometry it was last drawn at.
const MAPS = new Map();
let RO = null, CUR = null;
/** This render's map: drawn at g; the stored zoom is dropped when the size changed (it no longer fits the drawing). */
export function frameMap(id, g, draw) {
  const prev = MAPS.get(id);
  if (prev?.drawn && (prev.drawn.W !== g.W || prev.drawn.H !== g.H)) forgetMapView(id);
  MAPS.set(id, { draw, drawn: g });
  return draw(g, true);
}
/** Redraw the SVG alone when the map on screen no longer matches what was drawn (zoom reset: the frame changed). */
function fitMap(id) {
  const m = MAPS.get(id); if (!m || typeof document === 'undefined') return;
  const g = measureGeom(), svg = document.querySelector(`.mk-map-wrap svg[data-map="${id}"]`);
  if (!g || !svg || sameGeom(g, m.drawn)) return;
  forgetMapView(id); m.drawn = g;
  const t = document.createElement('template'); t.innerHTML = m.draw(g, false); svg.replaceWith(t.content.firstElementChild);
  const ctl = document.querySelector('.mk-map-wrap .map-ctl'); if (ctl) ctl.replaceWith(ctl.cloneNode(true)); // drop the old drawing's zoom handlers
  mountMaps(document.querySelector('.mk-map-wrap'));
}
/** After a render: the frame checked and the cards packed once the DOM is in place, in the same task as the render (a
 *  microtask, before the browser paints), so no frame ever shows unpacked cards or a map at the wrong size; then the map
 *  watched for size changes. A page without a map (a category tab) passes no id and only packs. */
export function afterMapRender(id) {
  if (typeof document === 'undefined') return;
  const run = () => {
    CUR = id || null;
    const wrap = id ? document.querySelector('.mk-map-wrap') : null;
    if (typeof ResizeObserver === 'function') { RO ||= new ResizeObserver(() => { if (CUR) fitMap(CUR); }); RO.disconnect(); if (wrap) RO.observe(wrap); }
    if (id) fitMap(id);
    packCards();
  };
  if (typeof queueMicrotask === 'function') queueMicrotask(run); else Promise.resolve().then(run);
}
/** Recompute the map frame for map id without a board render. */
export const refitMap = id => fitMap(id);

// ---------- The stage bar: the map and the categories as buttons ----------
const ICONS = {
  map: '<path d="M1.75 3.6 5.6 2.2l4.8 1.9 3.85-1.4v9.7l-3.85 1.4-4.8-1.9-3.85 1.4z"/><path d="M5.6 2.2v9.7M10.4 4.1v9.7"/>',
  find: '<circle cx="7" cy="7" r="4.4"/><path d="m10.3 10.3 4 4"/>',
  rank: '<path d="M3 13.5V9M8 13.5V3.5M13 13.5V6.5"/>',
  size: '<path d="M2.5 8h11M5 5.5 2.5 8 5 10.5M11 5.5 13.5 8 11 10.5"/>',
  zones: '<path d="M2.5 2.5h4.8v4.8H2.5zM8.7 2.5h4.8v4.8H8.7zM2.5 8.7h4.8v4.8H2.5zM8.7 8.7h4.8v4.8H8.7z"/>',
  area: '<path d="M2.5 5.2 7.6 2.6l5.9 2.6-1.4 7.4-6.9 1.5z"/><path d="m5 8.3 2-1.6 2.3 1.9 1.6-1.1"/>',
  cost: '<path d="M8 1.6v12.8"/><path d="M11 4.4c-.5-1.1-1.6-1.8-3-1.8-1.8 0-3.1 1-3.1 2.3 0 3.1 6.3 1.8 6.3 5 0 1.4-1.4 2.4-3.2 2.4-1.5 0-2.8-.8-3.3-2"/>',
  route: '<circle cx="3.6" cy="12.4" r="1.6"/><circle cx="12.4" cy="3.6" r="1.6"/><path d="M5.2 12.4h4.3a2.4 2.4 0 0 0 0-4.8h-3a2.4 2.4 0 0 1 0-4.8h4.3"/>',
  permits: '<path d="M5.6 2.2h4.8v2.2H5.6z"/><path d="M10.4 3.3h2.1v11.2h-9V3.3h2.1"/><path d="m5.7 9.4 1.7 1.7 3.1-3.4"/>',
  limit: '<path d="M2.4 11.2a5.6 5.6 0 1 1 11.2 0"/><path d="m8 11.2 2.6-3.6"/><path d="M2.4 13.6h11.2"/>',
  bottleneck: '<path d="M9 1.6 3.6 9H8l-1 5.4L12.4 7H8z"/>',
  upgrade: '<path d="M10.6 2.1a3.4 3.4 0 0 0-3.2 4.5L2.6 11.4l2 2 4.8-4.8a3.4 3.4 0 0 0 4.5-3.2l-1.9 1.9-1.9-.5-.5-1.9z"/>',
  phase: '<path d="M2.4 13.6h3v-3h3v-3h3v-3h2.2"/>',
};
export const barIcon = k => (ICONS[k] ? `<svg class="mk-ico" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>` : '');
/** The stage's tabs as one sticky bar: the map first, then each category with its result and the inputs set in it (×
 *  clears one). The buttons carry data-act="tab" data-v=<tab id>, as the shell's tab bar did, so links and tests address
 *  them the same way. items: [{ id, icon, label, title, result (html), chips (html[]), none }]. */
export function categoryBar({ label, tab, items }) {
  return `<nav class="mk-bar" role="tablist" aria-label="${escA(label)}">${items.map(it => {
    const on = it.id === tab, chips = it.chips || [];
    return `<div class="mk-tab${on ? ' on' : ''}${chips.length ? ' set' : ''}${it.id === 'map' ? ' mk-tab-map' : ''}" data-k="${escA(it.id)}"><button type="button" role="tab" id="mk-tab-${escA(it.id)}" aria-selected="${on}" tabindex="${on ? 0 : -1}" class="mk-tab-btn" data-act="tab" data-v="${escA(it.id)}" title="${escA(it.title || it.label)}">${barIcon(it.icon)}${chips.length ? `<span class="mk-tab-n" aria-label="${chips.length} set">${chips.length}</span>` : ''}<span class="mk-tab-t"><span class="mk-tab-k">${escA(it.label)}</span>${it.result ? `<span class="mk-tab-r">${it.result}</span>` : ''}</span></button>${it.id === 'map' ? '' : `<div class="mk-chips">${chips.length ? chips.join('') : `<span class="mk-chip-none">${escA(it.none || '')}</span>`}</div>`}</div>`;
  }).join('')}</nav>`;
}
// The page under the bar fades in once when the tab changes; a render for arriving data (same tab) never replays it.
const LAST_TAB = new Map();
export function tabEnter(stage, tab) { const prev = LAST_TAB.get(stage); LAST_TAB.set(stage, tab); return prev !== undefined && prev !== tab ? ' mk-enter' : ''; }
if (typeof document !== 'undefined') {
  // Arrow keys, Home and End move along the bar (the tab pattern): focus and open the next tab.
  document.addEventListener('keydown', e => {
    const b = e.target.closest?.('.mk-bar .mk-tab-btn'); if (!b || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const all = [...b.closest('.mk-bar').querySelectorAll('.mk-tab-btn')], i = all.indexOf(b);
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length;
    e.preventDefault(); all[n].focus(); all[n].click();
  });
}

// ---------- Evidence cards packed by height ----------
// Each card (and any full-width note) in an open evidence group is placed on a 12-column, 2-px-row grid by its own
// height (a skyline packing): a card takes the lowest free place for its width, aligned to the grid (a third at columns
// 1 / 5 / 9, a half at 1 / 7), so a column of short cards fills the room beside a tall one instead of a row stretching
// every card to its tallest. Where that would still leave empty space:
// - a strip of free columns beside a card that no card still to place could use (none starts there at an aligned
//   column) is taken by the card, which widens to it (two thirds beside a third, the whole row for a lone last half);
// - a column run well under where the next card goes is filled by one of the next few cards that fits it, at its own
//   width or one step narrower (a half as a third, two thirds as a half; only where that still leaves 400 px), without
//   running past that card's level;
// - the last card (or one only full-width cards follow) starts a full-width row instead of hanging past the tallest
//   column when that leaves less empty space;
// - a tall card that is much shorter across the whole row (a table squeezed into half a narrow board) may take it;
// - a card a little shorter than the one placed under it, or than the group's bottom (≤ 160 px, or a quarter of its own
//   height for a tall card), is stretched to align, the gap kept.
// Several such plans are laid out on the measured heights and the one with the least empty space wins (the group's
// height and the number of cards whose width changed weigh in, so a plan does not trade a hole for a much longer page).
// A card's height at another width is read in the plain flow (a table wraps less when wider; a chart keeps its height).
// The widths are the grid's (the c-* spans, and the container rules in app.css for a narrow board); a card's own size
// change (chart ⇄ table, a folded detail, a wider window) re-packs its group.
const ROW = 2, GAP = 8, COLS = 12, STRETCH = 160, OVER = 40, MIN_NARROW = 400, TOL = 24;
const PLANS = [
  { fill: 'all', narrow: true, widen: true, row: true, ahead: 4 },
  { fill: 'all', narrow: false, widen: true, row: true, ahead: 4 },
  { fill: 'all', narrow: true, widen: true, row: true, ahead: 4, wide: true },
  { fill: 'all', narrow: false, widen: true, row: true, ahead: 4, wide: true },
  { fill: 'all', narrow: true, widen: true, row: true, ahead: 8 },
  { fill: 'all', narrow: true, widen: true, row: true, ahead: 4, over: STRETCH }, // a filler may run past; the column beside stretches
  { fill: 'all', narrow: false, widen: true, row: true, ahead: 4, over: STRETCH },
  { fill: 'all', narrow: false, widen: true, row: true, ahead: 4, over: STRETCH, wide: true },
  { fill: 'full', narrow: false, widen: true, row: true, ahead: 4 },
  { fill: 'full', narrow: false, widen: false, row: false, ahead: 4 }, // the first packer (2026-10-22)
];
let PRO = null;
const PENDING = new Set(), RUNS = new WeakMap();
function spanOf(c) {
  const cs = getComputedStyle(c), a = cs.gridColumnStart, b = cs.gridColumnEnd, m = /^span\s+(\d+)/.exec(a) || /^span\s+(\d+)/.exec(b);
  return m ? Math.min(COLS, Number(m[1])) : COLS; // `.cards>*{grid-column:1/-1}` and any unspanned item: full width
}
const starts = s => (s === 8 ? [0, 4] : [3, 4, 6, 12].includes(s) ? Array.from({ length: COLS / s }, (_, k) => k * s) : Array.from({ length: COLS - s + 1 }, (_, k) => k));
/** One plan: where each card goes ({ m, a, b, r0, rows, stretched }) and its score (lower is better). */
function simulate(cards, o, hAt, narrower) {
  const sky = new Array(COLS).fill(0), last = new Array(COLS).fill(null), out = [];
  const queue = cards.map(m => (o.wide && m.s < COLS && m.h >= 400 && hAt(m, COLS) <= 0.7 * m.h ? { m, s: COLS, h: hAt(m, COLS) } : { m, s: m.s, h: m.h }));
  const fit = s => { let best = null; for (const i of starts(s)) { const top = Math.max(...sky.slice(i, i + s)); if (!best || top < best.top - 0.5) best = { i, top }; } return best; };
  // The columns a card at `at` with span s takes: its own, and a free run beside it (up to TOL lower) narrower than every
  // other card left; the card then starts at the lowest of them.
  const cover = (x, at, s) => {
    let a = at.i, b = at.i + s, l = a, r = b;
    if (!o.widen) return { a, b, top: at.top };
    const spans = [...new Set(queue.filter(q => q !== x).map(q => q.s))];
    while (l > 0 && sky[l - 1] <= at.top + TOL) l--;
    while (r < COLS && sky[r] <= at.top + TOL) r++;
    // the columns of [u, v) another card could take at an aligned start inside it
    const used = (u, v) => { const on = new Array(COLS).fill(false); for (const w of spans) for (const i of starts(w)) if (i >= u && i + w <= v) for (let k = i; k < i + w; k++) on[k] = true; return on; };
    if (r > b) { const on = used(b, r); let k = b; while (k < r && !on[k]) k++; b = k; } // the dead columns next to the card
    if (l < a) { const on = used(l, a); let k = a; while (k > l && !on[k - 1]) k--; a = k; }
    return { a, b, top: Math.max(at.top, ...sky.slice(a, b)) };
  };
  const stretch = (t, y) => { t.rows = Math.max(1, Math.round((y - GAP) / ROW) - t.r0); t.stretched = true; };
  const reach = t => Math.max(STRETCH, 0.25 * t.h); // how far a card may stretch: 160 px, or a quarter of its height
  const place = (x, at, s, h) => {
    const { a, b, top } = cover(x, at, s);
    if (b - a !== s) { s = b - a; h = hAt(x.m, s); }
    // A card ending a little above the one placed under it (≤ STRETCH) is stretched to it, so the row reads aligned; the
    // gap stays. Only a card that is the last in every column it covers (nothing placed under it yet).
    for (const t of new Set(last.slice(a, b))) {
      if (!t || !t.cols.every(k => last[k] === t)) continue;
      const room = top - sky[t.cols[0]];
      if (room <= 0.5 || room > reach(t)) continue;
      stretch(t, top);
      for (const k of t.cols) sky[k] = top;
    }
    const r0 = Math.round(top / ROW), rows = Math.max(1, Math.ceil((h + GAP) / ROW)), cols = Array.from({ length: s }, (_, k) => a + k);
    const p = { m: x.m, a, b, r0, rows, h, cols, stretched: false, changed: s !== x.m.s };
    out.push(p);
    for (const k of cols) { sky[k] = (r0 + rows) * ROW; last[k] = p; }
  };
  while (queue.length) {
    const x = queue[0], f = fit(x.s);
    let pick = null;
    // A column run well under where this card goes: one of the next few cards fills it, without running past that level.
    if ((o.fill === 'all' || x.s === COLS) && Math.min(...sky) < f.top - TOL) {
      for (let k = 0; k < Math.min(queue.length, o.ahead + 1) && !pick; k++) {
        const y = queue[k];
        for (const s of [y.s, o.narrow ? narrower(y.s) : 0]) {
          if (!s || s >= COLS || (k === 0 && s === y.s)) continue;
          const t = fit(s);
          if (t.top >= f.top - TOL) continue;
          const h = s === y.s ? y.h : hAt(y.m, s);
          if (t.top + h <= f.top + (o.over || OVER)) { pick = { y, at: t, s, h }; break; }
        }
      }
    }
    if (pick) { queue.splice(queue.indexOf(pick.y), 1); place(pick.y, pick.at, pick.s, pick.h); continue; }
    queue.shift();
    // The last card, or one only full-width cards follow: a full-width row of its own when hanging past the tallest
    // column (nothing left to fill beside it) would leave more empty space.
    if (o.row && x.s < COLS && queue.every(q => q.s === COLS)) {
      const hi = Math.max(...sky), c = cover(x, f, x.s), hA = c.b - c.a === x.s ? x.h : hAt(x.m, c.b - c.a);
      const LA = Math.max(hi, c.top + hA + GAP);
      let wasteA = -(c.b - c.a) * (hA + GAP), wasteB = 0;
      for (let k = 0; k < COLS; k++) { wasteA += LA - sky[k]; wasteB += hi - sky[k]; }
      if (wasteB < wasteA - 0.5) { place(x, { i: 0, top: hi }, COLS, hAt(x.m, COLS)); continue; }
    }
    place(x, f, x.s, x.h);
  }
  // The last row: a card ending a little above the group's bottom (≤ STRETCH) is stretched to it.
  const bottom = Math.max(0, ...sky);
  for (const t of new Set(last)) {
    if (!t || !t.cols.every(k => last[k] === t)) continue;
    const room = bottom - sky[t.cols[0]];
    if (room > 0.5 && room <= reach(t)) stretch(t, bottom);
  }
  // Score: the empty column-pixels between and under the cards (the normal gap not counted), the group's height, and
  // the cards whose width changed.
  const box = p => [p.r0 * ROW, p.r0 * ROW + (p.stretched ? p.rows * ROW : p.h)];
  const end = Math.max(0, ...out.map(p => box(p)[1]));
  let empty = 0;
  for (let k = 0; k < COLS; k++) {
    let y = 0;
    for (const [t0, t1] of out.filter(p => p.a <= k && k < p.b).map(box).sort((u, v) => u[0] - v[0])) { if (t0 - y > GAP + 6) empty += t0 - y - GAP; y = Math.max(y, t1); }
    if (end - y > 6) empty += end - y;
  }
  return { out, score: empty + 4 * end + 150 * out.filter(p => p.changed).length };
}
function layoutGroup(g) {
  if (!g.isConnected) return;
  // a guard against a size feedback loop (a plan's widths changing a card's height, which picks another plan…)
  const now = Date.now(), runs = (RUNS.get(g) || []).filter(t => now - t < 1000);
  if (runs.length >= 6) { if (!g._mkRetry) g._mkRetry = setTimeout(() => { g._mkRetry = 0; layoutGroup(g); }, 700); return; } // once things settle
  RUNS.set(g, [...runs, now]);
  const items = [...g.children];
  for (const c of items) { c.style.gridColumn = ''; c.style.gridRow = ''; c.style.alignSelf = ''; }
  g.classList.remove('mk-packed'); // measure in the plain flow: widths by span, heights by content (align-items: start)
  const cards = items.filter(c => !c.hidden && getComputedStyle(c).display !== 'none').map(c => ({ c, s: spanOf(c), h: c.getBoundingClientRect().height, hs: {} }));
  g.classList.add('mk-packed'); // 2-px rows from here; a width read below still gives a card's content height
  const hAt = (m, s) => {
    if (s === m.s) return m.h;
    if (!(s in m.hs)) { m.c.style.gridColumn = `span ${s}`; m.hs[s] = m.c.getBoundingClientRect().height; m.c.style.gridColumn = ''; }
    return m.hs[s];
  };
  const gs = getComputedStyle(g), cg = parseFloat(gs.columnGap) || GAP;
  const colW = (g.clientWidth - parseFloat(gs.paddingLeft) - parseFloat(gs.paddingRight) - (COLS - 1) * cg) / COLS;
  const narrower = s => { const n = s === 6 ? 4 : s === 8 ? 6 : 0; return n && n * colW + (n - 1) * cg >= MIN_NARROW ? n : 0; };
  let best = null;
  for (const o of PLANS) { const plan = simulate(cards, o, hAt, narrower); if (!best || plan.score < best.score - 0.5) best = plan; }
  for (const p of best?.out || []) {
    p.m.c.style.gridColumn = `${p.a + 1} / span ${p.b - p.a}`; p.m.c.style.gridRow = `${p.r0 + 1} / span ${p.rows}`;
    if (p.stretched) p.m.c.style.alignSelf = 'stretch';
  }
}
// The groups packed: evidence under a map, and the card grid of a category tab page (its own, not one nested in a card).
const PACKED = '.gsx-an .mk-ev[open] > .cards, .gsx-an .mk-tabpage .cards:not(.card .cards)';
const schedule = g => { if (PENDING.has(g)) return; PENDING.add(g); requestAnimationFrame(() => { PENDING.delete(g); layoutGroup(g); }); };
export function packCards() {
  if (typeof document === 'undefined' || typeof ResizeObserver !== 'function') return;
  PRO ||= new ResizeObserver(es => { for (const e of es) { const g = e.target.matches('.cards') ? e.target : e.target.parentElement; if (g?.matches?.(PACKED)) schedule(g); } });
  PRO.disconnect();
  for (const g of document.querySelectorAll(PACKED)) {
    layoutGroup(g);
    PRO.observe(g);
    for (const c of g.children) PRO.observe(c);
  }
}
