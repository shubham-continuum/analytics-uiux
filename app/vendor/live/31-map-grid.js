/* VENDORED from live Studio ext/31-map-grid.js (snapshot 2026-10-06, sha256 f9dbc10dd1f2f73e).
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   ext: 31-map-grid.js — the map dock and the bottom data grid.

   The signature of the app frame (studio/APP-FRAME-BRIEF.md, "the map is the
   floor"). This is an offline single file, so there is no tile server and none
   is faked: the map draws the NETWORK ITSELF from geometry the store already
   holds — 2,787 branches between buses the Studio already draws, the 2,678 buses
   as points, the eight load zones labelled at their own centroids. It is a
   network diagram in geographic coordinates and it says so in its corner.

   Nothing in studio/src is edited. This module reaches the host only through
   window.App, window.GS, window.Views and window.GS_DATA_EXT.

   ── the three things worth knowing before reading on ─────────────────────────

   1 ONE SELECTION, NOT TWO. `App` exposes no `selectBus`, but it needs no diff
     to get one: `setOption`, `options`, `project` and `addOptionFor` are already
     public on `window.App`. `ext/30` assembles them into the app-wide rule and
     publishes it as `GSFrame.selectBus`, so the map and the grid DELEGATE to it
     rather than restate it — two spellings of "select" would drift within a
     release. `window.GSSelect.bus(busId)` is the stable alias, and it falls back
     to the same App calls when the frame is off or has thrown.

   2 THE DOCKS MAY BE WIPED UNDER US. The host's `render()` does
     `app.innerHTML = ''` on every paint and `ext/30` re-runs `docks()` after it,
     so the element holding these panes is usually a NEW element. Every sync
     re-attaches. When no dock exists at all — the frame off, or this module
     built ahead of it — it makes its own as siblings of `#app`
     (`body.gsx-fallback`), which is what let the two be built in parallel.

   3 THE DRAW BUDGET IS THE PAN. 2,678 points and 2,787 lines have to move at 60
     fps. Screen coordinates are projected into two Float32Arrays once per view
     change, never per mark; branches stroke as four paths (one per kV class),
     points fill as at most eight paths (one per colour bucket); the base canvas
     redraws only when the view, the layers or the scope change, and the
     selection pulse lives on a second canvas so the animation never touches it.

   House rules kept: the data is stated, never the conclusion; missing stays
   missing (a bus with no value is drawn hollow and the cell says —, never 0);
   no verdict words anywhere on either surface; miles lead.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const A = window.App, GS = window.GS, Views = window.Views;
  if (!A || !GS) { console.warn('[mapgrid] host app not on window — module idle'); return; }
  const H = A.H, esc = A.esc, fmt = GS.fmt;
  const EXT = window.GS_DATA_EXT || {};
  const COV = (EXT.meta && EXT.meta.coverage) || {};
  const BRANCHES = (EXT.network && EXT.network.branches) || [];
  const ANCHORS = EXT.zones || [];
  const ZFIX = EXT.zone_fix || {};

  /* A throw in one surface must not take the other down with it, and must never
     be swallowed — a feature that fails silently is the trap this workspace
     keeps rediscovering. */
  const broken = Object.create(null);
  function guard(name, fn, fallback) {
    if (broken[name]) return fallback;
    try { return fn(); } catch (e) {
      broken[name] = String((e && e.message) || e);
      console.warn(`[mapgrid] ${name} disabled after a throw: ${broken[name]}`);
      return fallback;
    }
  }

  /* ═══ 1 · selection, spoken once ═════════════════════════════════════════ */

  /** Select a bus everywhere: workspace, grid, inspector, map.
   *
   *  ONE PATH, NOT TWO. `ext/30` owns the app-wide rule (`GSFrame.selectBus`):
   *  switch to the open project's option at that bus if it has one, otherwise
   *  pin it and say why it cannot be read at depth. It also records the frame's
   *  own `busId` and fires `gsframe:bus`, which other surfaces listen for — so
   *  restating the rule here would give the Studio two selections that drift.
   *  This delegates, and only falls back when the frame is off or has thrown.
   *
   *  No app.js diff is needed for any of it: `setOption`, `options`, `project`
   *  and `addOptionFor` are all already public on `window.App`. */
  function selectBus(busId, why) {
    const id = Number(busId);
    const n = GS.node(id);
    if (!n) { console.warn('[mapgrid] no such bus: ' + busId); return null; }
    selId = id;
    const F = window.GSFrame;
    if (F && typeof F.selectBus === 'function') { F.selectBus(id); return id; }
    const p = A.project();
    if (!p) { A.toast(`${n.name} ${n.kv} kV — create a project to read it as an option.`); return id; }
    const hit = A.options(p).find(o => Number(o.busId) === id);
    if (hit) {
      if (A.state.optionId !== hit.id) A.setOption(hit.id); else sync();
    } else A.addOptionFor(n);
    if (why) A.toast(`${n.name} ${n.kv} kV — ${why}`);
    return id;
  }

  /* The selected bus, reconciled across the two ways it can move. The option is
     authoritative the moment it changes (the rail and the stage switcher move it
     without going near the frame); otherwise the frame's own record stands, which
     is what covers a bus selected but not an option on any project. */
  let selId = null, lastOptBus = null;
  function selectedBus() {
    const o = A.option();
    const optBus = o ? Number(o.busId) : null;
    if (optBus !== lastOptBus) { lastOptBus = optBus; if (optBus != null) selId = optBus; }
    if (selId == null) selId = optBus;
    return selId;
  }
  document.addEventListener('gsframe:bus', e => {
    const id = e && e.detail && e.detail.busId;
    if (id != null) { selId = Number(id); }
  });
  window.GSSelect = { bus: selectBus, current: selectedBus };

  /* ═══ 2 · the spine ══════════════════════════════════════════════════════ */

  const NODES = GS.nodes.filter(n => n.lat != null && n.lon != null);
  const IX = new Map(NODES.map((n, i) => [n.bus_id, i]));
  /** The corrected load zone — `zone_fix` over the column GS_DATA ships, the same
   *  attribution the exporter drew the label anchors from. */
  const zoneOf = n => ZFIX[String(n.bus_id)] || n.zone || null;
  const QUEUE = (GS.D.queue || []).filter(q => q.latitude != null && q.longitude != null);
  /** Queue fuel groups — four, so the CA palette's four CVD-separable hues carry
   *  them (violet collapses onto blue under protanopia and is not used). Every
   *  resource_type the file holds lands in exactly one group, counted below. */
  const QFUEL = [
    { key: 'other', label: 'wind · hydro · gas', cat: 1, test: t => true },
    { key: 'solar_bess', label: 'solar + storage', cat: 3, test: t => /SUN/.test(t) && /BAT/.test(t) },
    { key: 'solar', label: 'solar', cat: 2, test: t => /SUN/.test(t) },
    { key: 'bess', label: 'storage', cat: 0, test: t => /BAT/.test(t) },
  ];
  const qGroup = t => { const s = String(t || ''); for (const k of [1, 2, 3]) if (QFUEL[k].test(s)) return k; return 0; };
  const QG = new Int8Array(QUEUE.length), QR = new Float32Array(QUEUE.length);
  const Q_MAX = Math.max(1, ...QUEUE.map(q => Number(q.max_mw) || 0));
  QUEUE.forEach((q, i) => { QG[i] = qGroup(q.resource_type); QR[i] = 2.4 + 4.2 * Math.sqrt(Math.max(0, Number(q.max_mw) || 0) / Q_MAX); });
  const Q_COUNT = QFUEL.map((_, g) => QUEUE.filter((q, i) => QG[i] === g).length);
  /** Queue MW within 10 miles of each bus — a real zero where none is near. */
  const Q_NEAR_MI = 10;
  const miles = (la1, lo1, la2, lo2) => {
    const r = Math.PI / 180, a = Math.sin((la2 - la1) * r / 2) ** 2
      + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
  };
  const QNEAR = new Map(NODES.map(n => [n.bus_id, QUEUE.reduce((s, q) =>
    s + (miles(n.lat, n.lon, q.latitude, q.longitude) <= Q_NEAR_MI ? (Number(q.max_mw) || 0) : 0), 0)]));

  /* branch endpoints resolved to node indices once; the exporter guarantees both
     ends are on the spine, so a miss here is a data defect and is counted. */
  const BX = new Int32Array(BRANCHES.length * 2);
  const BKV = new Float32Array(BRANCHES.length);
  let branchMisses = 0;
  BRANCHES.forEach((b, i) => {
    const a = IX.has(b[0]) ? IX.get(b[0]) : -1, c = IX.has(b[1]) ? IX.get(b[1]) : -1;
    if (a < 0 || c < 0) branchMisses++;
    BX[i * 2] = a; BX[i * 2 + 1] = c; BKV[i] = b[2];
  });
  if (branchMisses) console.warn(`[mapgrid] ${branchMisses} branch endpoints are not on the spine`);

  /** The four classes the map gives a weight to, low to high — the same cut the
   *  exporter publishes its census on. */
  const KV_CLASS = [
    { key: 1, floor: 0, label: 'under 100 kV', w: 0.45 },
    { key: 2, floor: 100, label: '100–199 kV', w: 0.75 },
    { key: 3, floor: 200, label: '200–344 kV', w: 1.20 },
    { key: 4, floor: 345, label: '345 kV and above', w: 2.10 },
  ];
  const kvClass = kv => kv >= 345 ? 3 : kv >= 200 ? 2 : kv >= 100 ? 1 : 0;

  /** The 2030 price range on the one basis (price-basis 2026-09-27), kept on
   *  `stats().priceRange` for the first gate: the solved run at each bus, the
   *  corrected sheet only where no run is held — GS.priceColumn (ext/76), computed
   *  when asked, never typed. Before ext/76 boots, the solved-run reader below.
   *  Point colour is no longer one linear ramp: it is whichever KPI "Colour by"
   *  names, classed 5–7 bins on a validated ramp (§5b). */
  function priceRange() {
    const col = typeof GS.priceColumn === 'function' ? GS.priceColumn(2030)
      : NODES.map(n => { const p = priceBasis(n, 2030); return p ? p.value : null; });
    let lo = Infinity, hi = -Infinity;
    col.forEach(v => { if (v != null && v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    return lo <= hi ? [lo, hi] : [null, null];
  }

  /** The study cap the headroom columns saturate at (memory: injection headroom
     saturates at 1,500 MW). The radius scale states its own ceiling. */
  const HR_CAP = 1500;

  /* ═══ 3 · tokens → canvas colours ════════════════════════════════════════ */

  const TOK = {};
  function readTokens() {
    const cs = getComputedStyle(document.documentElement);
    const g = k => (cs.getPropertyValue(k) || '').trim();
    TOK.price = [1, 2, 3, 4, 5, 6, 7].map(i => g('--gsx-price-' + i));
    TOK.kv = [1, 2, 3, 4].map(i => g('--gsx-kv-' + i));
    TOK.node = g('--gsx-node'); TOK.sel = g('--gsx-sel');
    TOK.queue = g('--gsx-queue'); TOK.pin = g('--gsx-pin');
    TOK.ink = g('--ink'); TOK.sunk = g('--sunk');
    /* the siting ramps, validated per theme (studio/MAP-LAYERS.md §3) */
    const seven = p => [1, 2, 3, 4, 5, 6, 7].map(i => g(`--gsx-${p}-${i}`));
    TOK.seq = seven('seq'); TOK.warm = seven('warm'); TOK.div = seven('div');
    TOK.biv = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => g('--gsx-biv-' + i));
    TOK.cat = [1, 2, 3, 4].map(i => g('--gsx-cat-' + i));
    TOK.cat8 = [1, 2, 3, 4, 5, 6, 7, 8].map(i => g('--gsx-cat8-' + i));
    TOK.bind = g('--gsx-bind'); TOK.halo = g('--gsx-halo'); TOK.missing = g('--gsx-missing');
    TOK.flagAnom = g('--gsx-flag-anom'); TOK.flagZone = g('--gsx-flag-zone'); TOK.flagSyn = g('--gsx-flag-syn');
    TOK.border = g('--gsx-zone-edge');
    TOK.sig = TOK.seq.join() + TOK.div[3] + TOK.biv[0];
  }
  readTokens();

  /* ═══ 4 · mounting ═══════════════════════════════════════════════════════ */

  const MAP_ID = 'gsx-map-dock', GRID_ID = 'gsx-grid-dock';
  let mapPane = null, gridPane = null;

  let ownDocks = false;
  /** The live dock for an id, preferring the frame's over the one this module
   *  makes for itself.
   *
   *  `getElementById` would hide the defect this guards: when `ext/31` boots
   *  ahead of the frame's first paint it builds its own `#gsx-map-dock`, and the
   *  frame then builds a second element with the SAME id — two nodes, one id,
   *  and every later lookup silently picks whichever the DOM ordered first. The
   *  module's own copy is tagged and removed the moment a real dock appears. */
  function dockFor(id) {
    const all = [...document.querySelectorAll('#' + id)];
    const real = all.find(e => !e.hasAttribute('data-gsx-own'));
    const own = all.find(e => e.hasAttribute('data-gsx-own'));
    if (real) { if (own) own.remove(); return real; }
    if (own) return own;
    const el = H('div');
    el.id = id;
    el.setAttribute('data-gsx-own', '1');
    el.classList.add('gsx-dock', id === MAP_ID ? 'gsx-map' : 'gsx-grid');
    document.body.appendChild(el);
    return el;
  }
  /** Re-attach the panes into whichever dock is live.
   *
   *  Both the host and the frame rebuild their DOM on every paint — the host
   *  blanks `#app`, and `ext/30` re-runs `docks()` — so the element holding these
   *  panes is a new one most paints. This is cheap and is what keeps the map and
   *  the grid on screen through that. */
  function attach() {
    const md = dockFor(MAP_ID), gd = dockFor(GRID_ID);
    const mine = md.hasAttribute('data-gsx-own') || gd.hasAttribute('data-gsx-own');
    ownDocks = mine;
    document.body.classList.toggle('gsx-fallback', mine);
    if (mapPane && mapPane.parentNode !== md) md.appendChild(mapPane);
    if (gridPane && gridPane.parentNode !== gd) gd.appendChild(gridPane);
  }

  /* ═══ 5 · the map ════════════════════════════════════════════════════════ */

  /* `headroom` and `price` keep their storage keys from the first release, but
     they are now the two ENCODING switches: `headroom` turns point size on
     (whatever "Size by" names) and `price` turns point colour on (whatever
     "Colour by" names). Renaming them would silently reset every reader's
     saved panel. */
  const LAYERS = { kv: true, zone: true, headroom: true, price: true, queue: false, pins: true,
    constraints: false, flags: false, retire: false };
  const LAYER_DEF = [
    ['kv', 'Branches', 'by kV'],
    ['zone', 'Zone labels', 'text'],
    ['headroom', 'Size', 'by KPI'],
    ['price', 'Colour', 'by KPI'],
    ['queue', 'Queue projects', String(QUEUE.length)],
    ['constraints', 'Limiting facilities', 'lines'],
    ['flags', 'Data flags', 'rings'],
    ['retire', 'Retirements', 'points'],
    ['pins', 'Pinned buses', 'rings'],
  ];
  const LAY_KEY = 'gs.mapgrid.layers.v1';
  try { const raw = localStorage.getItem(LAY_KEY); if (raw) Object.assign(LAYERS, JSON.parse(raw)); }
  catch (e) { /* storage refused — the defaults stand */ }
  const saveLayers = () => { try { localStorage.setItem(LAY_KEY, JSON.stringify(LAYERS)); } catch (e) { } };

  /* Equirectangular, the projection the brief names. x = lon·cos(lat0), y = −lat,
     with lat0 the middle of the footprint — so a mile east and a mile north are
     the same number of pixels at the centre of the market. It is a projection for
     a network diagram and nothing is measured off it. */
  const LAT0 = NODES.reduce((s, n) => s + n.lat, 0) / (NODES.length || 1);
  const COS0 = Math.cos(LAT0 * Math.PI / 180);
  const wx = lon => lon * COS0, wy = lat => -lat;

  const BOUNDS = (() => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    NODES.forEach(n => { const x = wx(n.lon), y = wy(n.lat); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; });
    return { x0, x1, y0, y1 };
  })();

  /** How many places the 2,678 buses actually occupy. Stated, because "2,678
   *  points" and "2,678 visible marks" are not the same claim on this data. */
  const DISTINCT_COORDS = new Set(NODES.map(n => `${n.lat},${n.lon}`)).size;

  const view = { cx: (BOUNDS.x0 + BOUNDS.x1) / 2, cy: (BOUNDS.y0 + BOUNDS.y1) / 2, k: 1 };
  let W = 0, Hh = 0, dpr = 1;
  const SX = new Float32Array(NODES.length), SY = new Float32Array(NODES.length);
  const QX = new Float32Array(QUEUE.length), QY = new Float32Array(QUEUE.length);
  let base = null, fx = null, bctx = null, fctx = null, stage = null, labelLayer = null;
  let hoverCard = null, hoverId = null, hoverStack = 0, needsBase = true;
  const drawn = { points: 0, branches: 0, queue: 0, pins: 0, zones: 0, zonesHidden: 0 };
  const UNDER = []; // basemap hook: fn(view) called on every base redraw, before the network

  /** The rectangle a fit actually targets: the stage, less the layer panel while
   *  it is expanded.
   *
   *  Fitting to the whole stage and then drawing a 190 px panel over the top-left
   *  is how the network ended up at half the dock with the panel sitting on the
   *  emptiest part of it. The panel is the only thing that covers the map, it is
   *  collapsible, and collapsing it re-fits — so the network fills whatever is
   *  actually visible either way. */
  function viewport() {
    const panel = stage && stage.querySelector('.gsx-layers');
    const open = panel && !panel.classList.contains('off');
    const pad = open ? Math.min(W * 0.45, panel.offsetWidth + 18) : 8;
    return { x: pad, y: 8, w: Math.max(40, W - pad - 8), h: Math.max(40, Hh - 16) };
  }

  function fit(pts) {
    if (!pts || !pts.length || !W) return;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(p => { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; });
    const dx = Math.max(x1 - x0, 1e-4), dy = Math.max(y1 - y0, 1e-4);
    const vp = viewport();
    view.k = Math.min(vp.w / dx, vp.h / dy) * 0.98;
    // put the bounding box's centre at the centre of the VISIBLE rectangle
    view.cx = (x0 + x1) / 2 - ((vp.x + vp.w / 2) - W / 2) / view.k;
    view.cy = (y0 + y1) / 2 - ((vp.y + vp.h / 2) - Hh / 2) / view.k;
    project();
  }
  const fitAll = () => { fit(NODES.map(n => [wx(n.lon), wy(n.lat)])); userMoved = false; };

  /* The docks are built by the frame on its first paint, so the stage's real
     size arrives AFTER this module's boot fit. Until the reader moves the view
     themselves, a resize re-fits rather than keeping a scale computed against a
     box that no longer exists — which is how 28 buses ended up off the edge. */
  let userMoved = false;
  function refit() { if (userMoved) project(); else fitAll(); }

  function project() {
    const hw = W / 2, hh = Hh / 2;
    for (let i = 0; i < NODES.length; i++) {
      SX[i] = (wx(NODES[i].lon) - view.cx) * view.k + hw;
      SY[i] = (wy(NODES[i].lat) - view.cy) * view.k + hh;
    }
    for (let i = 0; i < QUEUE.length; i++) {
      QX[i] = (wx(QUEUE[i].longitude) - view.cx) * view.k + hw;
      QY[i] = (wy(QUEUE[i].latitude) - view.cy) * view.k + hh;
    }
    buildHitGrid();
    needsBase = true;
  }
  const toScreen = (lat, lon) => [(wx(lon) - view.cx) * view.k + W / 2,
                                  (wy(lat) - view.cy) * view.k + Hh / 2];

  /* hit test: a uniform bucket grid in screen space, rebuilt with the projection */
  const CELL = 26;
  let hit = null, hitW = 0, hitH = 0;
  function buildHitGrid() {
    hitW = Math.max(1, Math.ceil(W / CELL)); hitH = Math.max(1, Math.ceil(Hh / CELL));
    hit = new Array(hitW * hitH);
    for (let i = 0; i < NODES.length; i++) {
      const cx = Math.floor(SX[i] / CELL), cy = Math.floor(SY[i] / CELL);
      if (cx < 0 || cy < 0 || cx >= hitW || cy >= hitH) continue;
      const k = cy * hitW + cx;
      (hit[k] || (hit[k] = [])).push(i);
    }
  }
  /** Every bus under the cursor, nearest first.
   *
   *  THE CO-LOCATED BUS. The 2,678 buses sit on 1,242 distinct coordinates — 341
   *  pairs, and one substation carries 54 of them. Zoom cannot separate those,
   *  ever. A map that returned "the bus at this pixel" would be answering a
   *  question the geometry cannot answer, and it would answer it differently
   *  depending on array order.
   *
   *  So the whole set under the cursor is returned, the hover card says how many
   *  there are AND how many places the market's buses actually occupy, and a
   *  click steps through them. Note the set is zoom-dependent — at the fitted
   *  scale a 9 px radius covers miles — which is why the card says "under the
   *  cursor at this zoom" and never "at this coordinate".
   *
   *  The order is deterministic: nearest (to the pixel), then highest kV, then
   *  lowest bus id. So the first click at a substation lands on its
   *  highest-voltage bus rather than on whichever row the file held first. */
  function pickAll(px, py, radius) {
    if (!hit) return [];
    const r = radius || 9;
    const c0 = Math.max(0, Math.floor((px - r) / CELL)), c1 = Math.min(hitW - 1, Math.floor((px + r) / CELL));
    const r0 = Math.max(0, Math.floor((py - r) / CELL)), r1 = Math.min(hitH - 1, Math.floor((py + r) / CELL));
    const found = [];
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const b = hit[cy * hitW + cx]; if (!b) continue;
      for (let j = 0; j < b.length; j++) {
        const i = b[j], dx = SX[i] - px, dy = SY[i] - py, d = dx * dx + dy * dy;
        if (d <= r * r) found.push(i);
      }
    }
    if (found.length < 2) return found;
    const d2 = i => (SX[i] - px) * (SX[i] - px) + (SY[i] - py) * (SY[i] - py);
    // buses within a pixel of each other are one stack, not an ordering
    return found.sort((a, b) => (Math.round(d2(a)) - Math.round(d2(b)))
      || ((NODES[b].kv || 0) - (NODES[a].kv || 0))
      || (NODES[a].bus_id - NODES[b].bus_id));
  }
  function pick(px, py, radius) {
    const s = pickAll(px, py, radius);
    return s.length ? s[0] : -1;
  }
  /** The bus a click here would land on: the next one in the stack when the
   *  selection is already in it, so the hover card and the click agree. */
  function nextInStack(stack) {
    if (!stack.length) return -1;
    const cur = selectedBus();
    const at = stack.findIndex(i => NODES[i].bus_id === cur);
    return stack[(at + 1) % stack.length];
  }

  /* NO ZONE BOUNDARY IS CLAIMED.
     The first release drew no zone polygon: a convex hull of Maine's buses is a
     triangle reaching over New Hampshire and Vermont, and it reads as a boundary
     this workspace does not hold. The zone layer is still the eight label
     anchors. The ZONES VIEW (§5b) is the one place regions are drawn, and it
     draws them as what they are — every point within 10 miles of a bus takes
     that nearest bus's zone — with the legend saying "derived from bus
     positions, not official zone boundaries". */

  function buildMap() {
    const pane = H('div', 'gsx-pane gsx-map-pane');

    const bar = H('div', 'gsx-map-bar');
    bar.appendChild(H('b', null, 'Network'));
    const count = H('span', 'n');
    count.textContent = `${fmt.int(NODES.length)} buses · ${fmt.int(BRANCHES.length)} branches`;
    count.title = COV.network_source
      ? `${COV.network_source}. ${fmt.int(COV.network_branches_dropped_off_spine || 0)} of `
        + `${fmt.int(COV.network_branches_in_store || 0)} branches are not drawn: an endpoint is not a bus the Studio holds.`
      : 'uni.dim_branch';
    bar.appendChild(count);
    bar.appendChild(H('span', 'sp')).style.flex = '1';
    const bFitF = H('button', 'gsx-btn', 'Fit filtered');
    bFitF.setAttribute('data-gsx', 'fit-filtered');
    bFitF.title = 'Frame the buses the grid filters leave in view';
    bFitF.onclick = () => fitFiltered();
    bar.appendChild(bFitF);
    const bFitSel = H('button', 'gsx-btn', 'Fit selection');
    bFitSel.setAttribute('data-gsx', 'fit-selection');
    bFitSel.onclick = () => fitSelection();
    const bFitAll = H('button', 'gsx-btn', 'Fit all');
    bFitAll.setAttribute('data-gsx', 'fit-all');
    bFitAll.onclick = () => { fitAll(); drawBase(); };
    bar.appendChild(bFitSel); bar.appendChild(bFitAll);
    pane.appendChild(bar);
    pane.appendChild(presetRow());

    stage = H('div', 'gsx-map-stage');
    stage.setAttribute('data-gsx', 'map-stage');
    base = H('canvas'); base.className = 'base';
    fx = H('canvas'); fx.className = 'fx';
    stage.appendChild(base); stage.appendChild(fx);
    bctx = base.getContext('2d'); fctx = fx.getContext('2d');

    labelLayer = H('div', 'gsx-labels');
    labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2';
    stage.appendChild(labelLayer);

    stage.appendChild(layerPanel());

    const note = H('div', 'gsx-note');
    note.setAttribute('data-gsx', 'map-note');
    note.textContent = 'network diagram in geographic coordinates · not a basemap';
    note.title = 'Lines are modelled branches between two buses. A zone is a label at the '
      + 'centroid of its buses. The Zones view shades nearest-bus regions — derived from bus '
      + 'positions, not official zone boundaries, because none is held. The Heat view is a '
      + 'kernel-weighted average of the buses, not a measured field. Nothing behind this is a map.';
    stage.appendChild(note);

    hoverCard = H('div', 'gsx-hover'); hoverCard.style.display = 'none';
    hoverCard.setAttribute('data-gsx', 'hover');
    stage.appendChild(hoverCard);

    pane.appendChild(stage);
    wireMap();
    /* The dock is dragged by the frame's splitters and collapsed by its edge
       tabs, neither of which repaints the host — so the stage's size can change
       with no `sync()` behind it. Without this the canvas keeps a scale fitted
       to a box that no longer exists and the network sits off-centre in the new
       one. `refit()` re-fills the dock while the view is untouched and only
       re-projects once the reader has framed it themselves. */
    if (window.ResizeObserver) {
      let t = 0;
      new ResizeObserver(() => {
        clearTimeout(t);
        t = setTimeout(() => guard('map', () => {
          if (resize()) { refit(); drawBase(); paintLabels(); }
        }), 40);
      }).observe(stage);
    }
    return pane;
  }

  function layerPanel() {
    const box = H('div', 'gsx-layers');
    box.setAttribute('data-gsx', 'layers');
    const head = H('button', 'gsx-layers-h');
    head.innerHTML = '<b>Layers</b><i>▾</i>';
    head.setAttribute('aria-expanded', 'true');
    head.onclick = () => {
      box.classList.toggle('off');
      const open = !box.classList.contains('off');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.querySelector('i').textContent = open ? '▾' : '▸';
      /* the visible rectangle just changed by ~190 px; re-fill it, unless the
         reader has already framed the map themselves */
      if (!userMoved) { fitAll(); drawBase(); paintLabels(); }
    };
    box.appendChild(head);
    const body = H('div', 'gsx-layers-b');
    /* the KPI legend leads: it is what the colours on the map mean */
    kLegend = H('div', 'gsx-klegend');
    kLegend.setAttribute('data-gsx', 'kpi-legend');
    body.appendChild(kLegend);
    body.appendChild(viewControls());
    const lays = H('div', 'gsx-lays');
    LAYER_DEF.forEach(([key, label, hint]) => {
      const l = H('label', 'gsx-lay');
      const cb = H('input'); cb.type = 'checkbox'; cb.checked = !!LAYERS[key];
      cb.setAttribute('data-gsx-layer', key);
      const why = layerUnavailable(key);
      if (why) { cb.checked = false; cb.disabled = true; l.classList.add('off'); l.title = why; LAYERS[key] = false; }
      cb.onchange = () => { LAYERS[key] = cb.checked; saveLayers(); drawBase(); paintLabels(); paintLegend(true); };
      l.appendChild(cb);
      l.appendChild(H('span', null, label));
      l.appendChild(H('em', null, why ? 'not held' : hint));
      lays.appendChild(l);
    });
    body.appendChild(lays);
    body.appendChild(kvLegend());
    box.appendChild(body);
    return box;
  }

  /** The network's own key: four kV classes on line weight and lightness. */
  function kvLegend() {
    const g = H('div', 'gsx-legend');
    KV_CLASS.slice().reverse().forEach(c => {
      const r = H('div', 'r');
      const sw = H('span', 'sw');
      sw.style.background = `var(--gsx-kv-${c.key})`;
      sw.style.height = Math.max(2, c.w) + 'px';
      r.appendChild(sw); r.appendChild(H('span', null, c.label));
      g.appendChild(r);
    });
    return g;
  }

  /* ── drawing ────────────────────────────────────────────────────────────── */

  function resize() {
    if (!stage) return false;
    const r = stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const d = window.devicePixelRatio || 1;
    if (w === W && h === Hh && d === dpr) return false;
    W = w; Hh = h; dpr = d;
    [base, fx].forEach(c => { c.width = Math.round(W * dpr); c.height = Math.round(Hh * dpr); });
    return true;
  }

  function drawBase() {
    if (!bctx || !W) return;
    const c = bctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, Hh);
    UNDER.forEach(f => guard('basemap', () => f({ cx: view.cx, cy: view.cy, k: view.k, W, H: Hh, dpr, cos0: COS0, stage, base }))); // basemap hook
    drawn.branches = drawn.points = drawn.queue = drawn.pins = 0;
    drawn.surface = null; drawn.constraints = 0; drawn.flags = 0; drawn.topN = 0; drawn.retire = 0;

    /* order: the surface is the floor, the network over it, the buses over the
       network, and the marks a reader operates on last */
    const enc = guard('layers', encoding, null);
    if (enc && MV.surface !== 'points') guard('surface', () => drawSurface(c, enc));
    if (LAYERS.kv) drawBranches(c);
    if (LAYERS.constraints) guard('layers', () => drawConstraints(c));
    drawPoints(c, enc);
    if (LAYERS.flags) guard('layers', () => drawFlags(c));
    if (LAYERS.queue) drawQueue(c);
    if (LAYERS.retire) guard('layers', () => drawRetire(c));
    if (enc) guard('layers', () => drawTopN(c, enc));
    if (LAYERS.pins) drawPins(c);
    needsBase = false;
    drawFx();
  }

  function drawBranches(c) {
    // one path per kV class; the payload is sorted kV ascending so the 345 kV
    // backbone strokes last and lands on top of the 115 kV mesh
    const scale = Math.min(2.2, Math.max(0.6, view.k / (Math.min(W, Hh) / 6)));
    for (let cls = 0; cls < 4; cls++) {
      c.beginPath();
      let any = 0;
      for (let i = 0; i < BRANCHES.length; i++) {
        if (kvClass(BKV[i]) !== cls) continue;
        const a = BX[i * 2], b = BX[i * 2 + 1];
        if (a < 0 || b < 0) continue;
        const ax = SX[a], ay = SY[a], bx = SX[b], by = SY[b];
        if ((ax < -60 && bx < -60) || (ax > W + 60 && bx > W + 60)
          || (ay < -60 && by < -60) || (ay > Hh + 60 && by > Hh + 60)) continue;
        c.moveTo(ax, ay); c.lineTo(bx, by);
        any++;
      }
      if (!any) continue;
      c.strokeStyle = TOK.kv[cls];
      c.lineWidth = KV_CLASS[cls].w * scale;
      c.lineCap = 'round';
      c.stroke();
      drawn.branches += any;
    }
  }

  /** The buses. Colour index and radius per bus come from `encoding()` (§5b),
   *  held in typed arrays and recomputed only when the KPI, the classes, the
   *  scope, the filters or the theme move — never inside a frame. A pan redraws
   *  the marks and must not also re-read 2,678 values.
   *
   *  One fill per colour class, so a pan is at most nine fills. On the Heat,
   *  Zones and Hex views the surface carries the colour and the buses are drawn
   *  as small neutral dots over it, so position is never lost to the shading. */
  function drawPoints(c, enc) {
    const onScreen = i => !(SX[i] < -8 || SY[i] < -8 || SX[i] > W + 8 || SY[i] > Hh + 8);
    const counts = enc ? new Array(enc.colours.length).fill(0) : [0];
    let hollow = 0, faded = 0;
    const surf = enc && MV.surface !== 'points';
    if (!enc || surf) {
      c.beginPath();
      let any = 0;
      for (let i = 0; i < NODES.length; i++) {
        if (enc && !enc.inF[i]) continue;
        if (!onScreen(i)) continue;
        c.moveTo(SX[i] + 1.3, SY[i]); c.arc(SX[i], SY[i], 1.3, 0, 6.2832); any++;
        if (enc && enc.col[i] >= 0) counts[enc.col[i]]++;
      }
      c.save(); c.fillStyle = TOK.node; c.globalAlpha = surf ? 0.7 : 1; c.fill(); c.restore();
      drawn.points += any;
    } else {
      for (let b = 0; b < enc.colours.length; b++) {
        c.beginPath();
        let any = 0;
        for (let i = 0; i < NODES.length; i++) {
          if (enc.col[i] !== b || !enc.inF[i]) continue;
          const r = enc.rad[i];
          if (!(r > 0)) continue;                     // NaN: no size value, drawn hollow below
          if (!onScreen(i)) continue;
          c.moveTo(SX[i] + r, SY[i]);
          c.arc(SX[i], SY[i], r, 0, 6.2832);
          any++;
        }
        if (!any) continue;
        c.fillStyle = enc.colours[b];
        c.fill();
        /* a hairline halo in the ground's opposite, so the light end of a ramp
           still has an edge on the light theme and the dark end on the dark one */
        c.save(); c.strokeStyle = TOK.halo; c.lineWidth = 0.6; c.stroke(); c.restore();
        counts[b] = any;
        drawn.points += any;
      }
      /* Missing stays missing. A bus with no value for the colour KPI or the
         size KPI is a hollow grey ring — never a dot at the bottom of the ramp,
         which would read as the lowest bus in the market. */
      c.beginPath();
      for (let i = 0; i < NODES.length; i++) {
        if (!enc.inF[i] || (enc.col[i] >= 0 && enc.rad[i] > 0)) continue;
        if (!onScreen(i)) continue;
        c.moveTo(SX[i] + 2.2, SY[i]); c.arc(SX[i], SY[i], 2.2, 0, 6.2832);
        hollow++;
      }
      if (hollow) {
        c.save();
        c.strokeStyle = TOK.missing || TOK.node; c.lineWidth = 0.9; c.globalAlpha = 0.8; c.stroke();
        c.restore();
        drawn.points += hollow;
      }
    }
    /* buses the grid's filters leave out: faint, or not drawn at all when the
       reader asks for "hide out-of-filter" */
    if (enc && !MV.hideOut && enc.outN) {
      c.beginPath();
      for (let i = 0; i < NODES.length; i++) {
        if (enc.inF[i] || !onScreen(i)) continue;
        c.moveTo(SX[i] + 1.4, SY[i]); c.arc(SX[i], SY[i], 1.4, 0, 6.2832); faded++;
      }
      c.save(); c.fillStyle = TOK.node; c.globalAlpha = 0.28; c.fill(); c.restore();
      drawn.points += faded;
    }
    drawn.classCounts = counts; drawn.hollow = hollow; drawn.faded = faded;
  }

  /** Queue projects: triangles sized by MW (area ∝ MW) and coloured by fuel
   *  group on the CA categorical palette. The 110 on the page are all active —
   *  the file holds no withdrawn project to leave out. */
  function drawQueue(c) {
    c.save();
    c.globalAlpha = 0.92;
    c.strokeStyle = TOK.halo; c.lineWidth = 0.6;
    for (let g = 0; g < QFUEL.length; g++) {
      c.beginPath();
      let any = 0;
      for (let i = 0; i < QUEUE.length; i++) {
        if (QG[i] !== g) continue;
        const x = QX[i], y = QY[i];
        if (x < -8 || y < -8 || x > W + 8 || y > Hh + 8) continue;
        const s = QR[i];
        c.moveTo(x, y - s * 1.1); c.lineTo(x + s, y + s * 0.75); c.lineTo(x - s, y + s * 0.75); c.closePath();
        any++;
      }
      if (!any) continue;
      c.fillStyle = TOK.cat[QFUEL[g].cat]; c.fill(); c.stroke();
      drawn.queue += any;
    }
    c.restore();
  }

  function drawPins(c) {
    const pins = (A.state.pins || []);
    c.save();
    c.strokeStyle = TOK.pin; c.lineWidth = 1.6;
    pins.forEach(id => {
      const i = IX.get(Number(id)); if (i == null) return;
      c.beginPath(); c.arc(SX[i], SY[i], 6, 0, 6.2832); c.stroke();
      c.beginPath(); c.moveTo(SX[i], SY[i] - 9); c.lineTo(SX[i], SY[i] - 6); c.stroke();
      drawn.pins++;
    });
    c.restore();
  }

  /** The selection pulse and the hover ring, on their own canvas so the pan never
   *  pays for the animation and the animation never redraws 5,465 marks. */
  let raf = 0, t0 = performance.now();
  function drawFx() {
    if (!fctx || !W) return;
    const c = fctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, Hh);
    const sel = selectedBus(), i = sel == null ? null : IX.get(sel);
    if (i != null) {
      const phase = ((performance.now() - t0) % 1600) / 1600;
      const r = 6 + 12 * phase;
      c.save();
      c.strokeStyle = TOK.sel; c.globalAlpha = Math.max(0, 0.75 * (1 - phase)); c.lineWidth = 1.6;
      c.beginPath(); c.arc(SX[i], SY[i], r, 0, 6.2832); c.stroke();
      c.globalAlpha = 1; c.lineWidth = 2;
      c.beginPath(); c.arc(SX[i], SY[i], 5, 0, 6.2832); c.stroke();
      c.restore();
    }
    if (hoverId != null) {
      const j = IX.get(hoverId);
      if (j != null) {
        c.save(); c.strokeStyle = TOK.ink; c.globalAlpha = 0.8; c.lineWidth = 1;
        c.beginPath(); c.arc(SX[j], SY[j], 7, 0, 6.2832); c.stroke(); c.restore();
      }
    }
  }
  function tick() { raf = requestAnimationFrame(tick); if (selectedBus() != null) drawFx(); }

  /** The eight zone labels. Placed largest-first and a later one is dropped
   *  rather than stacked: four of the southern zones share a few degrees, and
   *  two names written over each other name neither zone. What was dropped is
   *  counted on `drawn.zonesHidden`, so "8" on the panel is never a lie. */
  const LAB_W = 62, LAB_H = 24;
  function paintLabels() {
    if (!labelLayer) return;
    labelLayer.innerHTML = '';
    drawn.zones = 0; drawn.zonesHidden = 0;
    if (!LAYERS.zone) return;
    const placed = [];
    ANCHORS.slice().sort((a, b) => b.buses - a.buses).forEach(z => {
      const [x, y] = toScreen(z.lat, z.lon);
      if (x < -40 || y < -20 || x > W + 40 || y > Hh + 20) { drawn.zonesHidden++; return; }
      const clash = placed.some(p => Math.abs(p[0] - x) < LAB_W && Math.abs(p[1] - y) < LAB_H);
      if (clash) { drawn.zonesHidden++; return; }
      placed.push([x, y]);
      const el = H('div', 'gsx-zone-lab');
      el.setAttribute('data-gsx-zone', z.zone);
      el.style.left = x + 'px'; el.style.top = y + 'px';
      el.innerHTML = `${esc(z.zone)}<span>${fmt.int(z.buses)} buses</span>`;
      el.title = `${z.zone} — the centroid of its ${fmt.int(z.buses)} buses. `
        + 'A label position, not a load centre, and not a zone boundary.';
      labelLayer.appendChild(el);
      drawn.zones++;
    });
  }

  /* ── interaction ────────────────────────────────────────────────────────── */

  function wireMap() {
    let dragging = false, moved = 0, lx = 0, ly = 0;
    /* The layer panel sits inside the stage, and capturing the pointer on the
       stage retargets the whole gesture to it — the click never reaches the
       checkbox and the panel looks dead. Chrome that the reader operates is
       excluded from the drag before capture is taken. */
    const onChrome = e => !!(e.target && e.target.closest
      && e.target.closest('.gsx-layers, .gsx-hover, .gsx-note'));

    stage.addEventListener('pointerdown', e => {
      if (e.button !== 0 || onChrome(e)) return;
      dragging = true; moved = 0; lx = e.clientX; ly = e.clientY;
      stage.classList.add('dragging');
      // a synthetic pointer has no active id to capture; the drag still tracks
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    });
    stage.addEventListener('pointermove', e => {
      const r = stage.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      if (!dragging && onChrome(e)) { if (hoverId != null) { hoverId = null; hoverStack = 0; hoverCard.style.display = 'none'; drawFx(); } return; }
      if (dragging) {
        const dx = e.clientX - lx, dy = e.clientY - ly;
        moved += Math.abs(dx) + Math.abs(dy);
        lx = e.clientX; ly = e.clientY;
        view.cx -= dx / view.k; view.cy -= dy / view.k;
        userMoved = true;
        project(); drawBase(); paintLabels();
        return;
      }
      const stack = pickAll(px, py);
      const i = nextInStack(stack);
      const id = i < 0 ? null : NODES[i].bus_id;
      if (id !== hoverId || stack.length !== hoverStack) {
        hoverId = id; hoverStack = stack.length; showHover(px, py); drawFx();
      } else if (id != null) positionHover(px, py);
    });
    const end = e => {
      if (!dragging) return;
      dragging = false; stage.classList.remove('dragging');
      try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      if (moved < 4) {
        const r = stage.getBoundingClientRect();
        const i = nextInStack(pickAll(e.clientX - r.left, e.clientY - r.top));
        if (i >= 0) selectBus(NODES[i].bus_id);
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('pointerleave', () => { hoverId = null; hoverStack = 0; hoverCard.style.display = 'none'; drawFx(); });
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      // keep the world point under the cursor fixed
      const wxp = (px - W / 2) / view.k + view.cx, wyp = (py - Hh / 2) / view.k + view.cy;
      const f = Math.exp(-e.deltaY * 0.0016);
      view.k = Math.max(0.15, Math.min(400, view.k * f)) ;
      view.cx = wxp - (px - W / 2) / view.k;
      view.cy = wyp - (py - Hh / 2) / view.k;
      userMoved = true;
      project(); drawBase(); paintLabels();
    }, { passive: false });
    window.addEventListener('resize', () => { if (resize()) { refit(); drawBase(); paintLabels(); } });
  }

  function showHover(px, py) {
    if (hoverId == null) { hoverCard.style.display = 'none'; return; }
    const n = GS.node(hoverId);
    const hr = scopeHr(n, SCOPE.fuel, SCOPE.case);
    const pb = guard('layers', () => priceBasis(n, 2030), null);
    const rows = [
      ['kV', n.kv == null ? 'not held' : fmt.num(n.kv, 0) + ' kV'],
      ['Zone', zoneOf(n) || 'not held'],
      [`Headroom · ${esc(GS.caseOf(SCOPE.case).label)}`, hr == null ? 'not held' : fmt.mw(hr)],
      ['LMP 2030', pb ? `${fmt.lmp(pb.value)} · ${SRC_WORD[pb.source] || pb.source}` : 'not held'],
    ];
    const kr = guard('layers', () => hoverKpis(n.bus_id), []);
    hoverCard.innerHTML = `<b>${esc(n.name)}</b>`
      + `<div class="kv"><span>bus</span><span>#${n.bus_id}</span></div>`
      + rows.map(([k, v]) => `<div class="kv"><span>${k}</span><span>${esc(String(v))}</span></div>`).join('')
      + (kr.length ? `<div class="gsx-hk" data-gsx="hover-kpis">${kr.map(([k, v, sw]) =>
        `<div class="kv"><span>${sw ? `<i class="sw" style="background:${sw}"></i>` : ''}${esc(k)}</span><span>${esc(String(v))}</span></div>`).join('')}</div>` : '')
      + (hoverStack > 1
        ? `<div class="gsx-stack">${fmt.int(hoverStack)} buses are under the cursor at this zoom — `
          + `a click steps through them, and zooming in separates the ones that are not co-located. `
          + `${fmt.int(NODES.length)} buses sit on ${fmt.int(DISTINCT_COORDS)} distinct coordinates.</div>`
        : '');
    hoverCard.style.display = '';
    positionHover(px, py);
  }
  function positionHover(px, py) {
    if (hoverCard.style.display === 'none') return;
    const w = hoverCard.offsetWidth || 200, h = hoverCard.offsetHeight || 80;
    hoverCard.style.left = Math.max(4, Math.min(W - w - 4, px + 12)) + 'px';
    hoverCard.style.top = Math.max(4, Math.min(Hh - h - 4, py + 12)) + 'px';
  }

  function fitSelection() {
    const sel = selectedBus();
    const ids = new Set((A.state.pins || []).map(Number));
    if (sel != null) ids.add(sel);
    const pts = [...ids].map(id => GS.node(id)).filter(Boolean)
      .map(n => [wx(n.lon), wy(n.lat)]);
    if (!pts.length) { A.toast('Nothing is selected or pinned to fit to.'); return; }
    if (pts.length === 1) {
      view.cx = pts[0][0]; view.cy = pts[0][1];
      view.k = Math.max(view.k, Math.min(W, Hh) / 0.9);
      project();
    } else fit(pts);
    userMoved = true;
    drawBase(); paintLabels();
  }
  function panTo(busId) {
    const n = GS.node(busId); if (!n) return;
    view.cx = wx(n.lon); view.cy = wy(n.lat);
    userMoved = true;
    project(); drawBase(); paintLabels();
  }

  /* ═══ 6 · the bottom data grid ═══════════════════════════════════════════ */

  /* ── 6.1 · the column registry ───────────────────────────────────────────
     Every column the grid can show, grouped into seven families. Each one names
     the key it reads (`source`), its unit, how it formats, which way it sorts
     first, and the fuels it serves. Nothing here is computed from a constant:
     every value is a GS_DATA.nodes column, a GS_DATA_EXT per-bus map, or the
     host's own reader over one of those (GS.curt, GS.gates, GS.score).

     THREE RULES THE REGISTRY OBEYS
     · Missing stays missing. `get` returns null when the key is absent and the
       cell prints "—" with the reason in its tooltip — not held at this bus, not
       run at this case, or not applicable to this fuel. A zero is only ever a
       zero the source published.
     · Storage never sees a summer-peak-charge column. ISO-NE does not study
       storage charging at peak (memory: isone-study-conditions-by-asset), so
       `hideFor: STORAGE` removes the column from the grid and greys it in the
       chooser, and the scope headroom for storage pairs the case's discharge
       with the SHOULDER charge, the way GS.gates does.
     · "Basis vs zone", never "vs hub". `basis_own_2025` is the bus against its
       own load zone; the only hub-relative series (zones_vs_hub) has no per-bus
       value, so no hub column exists to offer.

     `fuels` is where a column is the natural read — it drives the chooser's
     "other fuel" tag and nothing else; a fact about the bus is never hidden
     because the scope is another fuel. `hideFor` is the hard exclusion. */
  const FAMILIES = ['Identity', 'Grid', 'Prices', 'Fuel fit', 'Land', 'Queue & system', 'Workflow'];
  const STORAGE = ['bess', 'hybrid'];
  const SPINE_N = GS.nodes.length;
  const LOADING = EXT.loading || {}, COST = EXT.cost || {}, STOH = EXT.storage_headroom || {};
  /* integration 2026-09-28: a second spelling of one measurement is an alias string naming the key
     that holds it (DATA-EXT-CONTRACT §loading); ext/20 resolves them on load, this follows one if met */
  const aliasAt = (m, k) => { const v = m[k]; return typeof v === 'string' ? m[v] : v; };
  const DECOMP = EXT.decomp || {}, LOADP = EXT.load_pays || {}, FDELTA = EXT.forecast_delta || {};
  const EXCL = EXT.exclusions || {};
  const CATHY = EXT.cathy || {};
  const BUS_ANNUAL = CATHY.bus_annual || {};
  const DEMO = new Map((((CATHY.meta || {}).demo_buses) || []).map(d => [String(d.bus_id), d]));
  const BUS_FULL = CATHY.bus_full || {};
  const fuelWord = f => ((GS.FUELS[f] || {}).label) || f;
  const sid = r => String(r.n.bus_id);
  const pick1 = (o, k) => (o == null ? null : (o[k] == null ? null : o[k]));

  /* ── the price basis, read once for map and grid ─────────────────────── */
  const PB_YEARS = [2025, 2030, 2035, 2040];
  const PB_RUN = { 2030: 'pcr2030', 2035: 'pcr2035', 2040: 'pcr2040' };
  const SRC_WORD = { solved: 'solved run', escalated: 'escalated run', sheet: 'sheet · no run', settled: 'settled' };
  const BA_COLS = ((CATHY.meta || {}).bus_annual_cols) || ['scenario', 'year', 'market', 'mean', 'hours', 'kind'];
  const BA_I = k => BA_COLS.indexOf(k);
  /** The solved run's annual mean at a bus, straight off cathy.bus_annual. */
  function runMean(n, y) {
    const a = BUS_ANNUAL[String(n.bus_id)], sc = PB_RUN[y];
    if (!a || !sc || !Array.isArray(a.rows)) return null;
    const r = a.rows.find(x => x[BA_I('scenario')] === sc && x[BA_I('year')] === y && x[BA_I('mean')] != null);
    return r ? +r[BA_I('mean')] : null;
  }
  /** One price at one bus in one year, with where it came from. */
  function priceBasis(n, y) {
    if (typeof GS.priceAt === 'function') {
      const r = GS.priceAt(n, y);
      return r && r.value != null ? r : null;
    }
    if (y <= 2026) { const v = n[`lmp_${y}`]; return v == null ? null : { value: +v, source: 'settled' }; }
    const v = runMean(n, y);
    return v == null ? null : { value: v, source: 'solved' };
  }
  /** Sheet against the solved run at 2030, in per cent — the anomaly measure. */
  function sheetVsRun(n) {
    const run = runMean(n, 2030), s = n.lmp_2030;
    return run == null || !run || s == null ? null : 100 * (s / run - 1);
  }
  /** The demo layer (ext/70) marks buses whose run it synthesised. */
  function demoSynthetic(id) {
    const d = window.GSXDemo;
    try { return !!(d && d.active && d.applied && d.applied.busNew && d.applied.busNew.has(String(id))); }
    catch (e) { return false; }
  }
  /** GS_DATA_EXT.land_cost_proxy, if the exporter publishes it — rows of
   *  { state, county, low, base, high, provenance } — indexed by STATE|COUNTY. */
  function landCostIndex() {
    const L = (window.GS_DATA_EXT || {}).land_cost_proxy;
    const rows = L && (Array.isArray(L) ? L : L.rows);
    if (!Array.isArray(rows) || !rows.length) return null;
    const m = new Map();
    rows.forEach(r => { if (r && r.base != null) m.set(`${String(r.state || '').toUpperCase()}|${String(r.county || '').toUpperCase()}`, r); });
    return m.size ? m : null;
  }

  /* the settled 2025 real-time make-up, indexed once rather than searched per cell */
  const DEC25 = new Map();
  Object.keys(DECOMP).forEach(id => {
    const y = (DECOMP[id].years || []).find(x => x.year === 2025 && x.market === 'RT');
    if (y) DEC25.set(id, y);
  });
  /* buses at the same (name-grouped) station — the host's own grouping */
  const STATION_N = new Map();
  if (GS.stations) GS.stations.forEach(list => list.forEach(n => STATION_N.set(n.bus_id, list.length)));

  /** The price series a bus reads. bus_annual and decomp carry the tier for
   *  the 1,218 buses with a direct or same-substation series; the demo list
   *  carries it for three geo-proxy buses. A bus with neither is a geographic
   *  proxy — that is the exporter's own census rule
   *  (`meta.coverage.price_tiers_on_the_spine`: 297 + 921 + 1,460 = 2,678),
   *  not an inference made here. */
  const TIER_WORD = { direct: 'direct', same_substation: 'same station', geo_proxy: 'geo proxy' };
  function tierOf(n) {
    const id = String(n.bus_id);
    const t = (BUS_ANNUAL[id] && BUS_ANNUAL[id].tier) || (DEMO.get(id) && DEMO.get(id).tier)
      || (DECOMP[id] && DECOMP[id].tier)
      || (n.hourly_conf === 'exact' ? 'direct' : n.hourly_conf ? 'same_substation' : 'geo_proxy');
    return t;
  }
  function proxyMiles(n) {
    const id = String(n.bus_id);
    const d = DEMO.get(id) || BUS_FULL[id];
    return d && d.distance_mi != null ? d.distance_mi : null;
  }

  /** The loading run that governs this fuel at this case — the key form the
   *  exporter publishes `loading` and `cost` under. The loading screen was run
   *  at summer peak for injection and discharge, and at summer peak and large
   *  load for withdrawal; every other combination is not held, and says so. */
  function govCase(fuel, ck) {
    const f = GS.FUELS[fuel] || GS.FUELS.solar;
    const cl = GS.caseOf(ck).label;
    if (fuel === 'bess') return ck === 'sp' ? { key: 'summer_peak|discharge' }
      : { why: `no loading run for storage at the ${cl} case — discharge is run at summer peak only` };
    if (f.direction === 'withdrawal') return ck === 'll' ? { key: 'large_load|charge' }
      : ck === 'sp' ? { key: 'summer_peak|charge' }
      : { why: `no loading run for withdrawal at the ${cl} case` };
    return ck === 'sp' ? { key: 'summer_peak|injection' }
      : { why: `no loading run for injection at the ${cl} case — injection is run at summer peak only` };
  }
  let GOV = { key: 'summer_peak|injection' };

  /** Headroom at the scope. Storage reads the case's discharge against the
   *  SHOULDER charge when the case is summer peak — the pairing GS.gates uses —
   *  because summer-peak charging is not a storage study condition. */
  function scopeHr(n, fuel, ck) {
    const f = GS.FUELS[fuel] || GS.FUELS.solar;
    if (f.direction !== 'both') return GS.primaryHeadroom(n, fuel, ck);
    const a = GS.headroom(n, ck, 'injection'), b = GS.headroom(n, ck === 'sp' ? 'sh' : ck, 'withdrawal');
    return a == null ? b : b == null ? a : Math.min(a, b);
  }

  let EVID = new Map();
  /** Evidence pinned per bus, across every project's options — the host's own
   *  `project.evidence`, which ext/10's pins write into. */
  function countEvidence() {
    const m = new Map();
    (A.state.projects || []).forEach(p => {
      const bus = new Map((A.options(p) || []).map(o => [o.id, Number(o.busId)]));
      (p.evidence || []).forEach(e => { const b = bus.get(e.optionId); if (b != null) m.set(b, (m.get(b) || 0) + 1); });
    });
    EVID = m;
  }

  const REG = [];
  /** id · label (≤ 3 words) · unit · family · source · options */
  function C(id, label, unit, family, source, o) {
    REG.push(Object.assign({ id, key: id, label, unit: unit || '', family, source, type: 'num', dp: 2,
      sort: -1, fuels: 'all', hideFor: [] }, o));
  }
  const notHeldAt = src => r => `Not held: ${src} has no value for bus #${r.n.bus_id}`;
  const nodeCol = (id, label, unit, family, key, o) =>
    C(id, label, unit, family, `node.${key}`, Object.assign({ get: r => r.n[key] }, o));

  /* Identity */
  C('name', 'Bus', '', 'Identity', 'node.name', { type: 'text', sort: 1, min: 108, grow: 4, get: r => r.n.name });
  nodeCol('bus_id', 'Bus ID', '', 'Identity', 'bus_id', { type: 'int', sort: 1 });
  nodeCol('kv', 'kV', '', 'Identity', 'kv', { dp: 0 });
  C('zone', 'Zone', '', 'Identity', 'zone_fix over node.zone', { type: 'text', sort: 1, grow: 1, get: r => zoneOf(r.n),
    hint: 'The operator pnode zone_id where it differs from the sheet (GS_DATA_EXT.zone_fix); a marked cell was corrected.' });
  nodeCol('zone_sheet', 'Sheet zone', '', 'Identity', 'zone', { type: 'text', sort: 1,
    hint: 'The zone as the substation sheet states it, before zone_fix.' });
  nodeCol('zone_src', 'Zone source', '', 'Identity', 'zone_source', { type: 'text', sort: 1 });
  nodeCol('state', 'State', '', 'Identity', 'state', { type: 'text', sort: 1, grow: 1 });
  nodeCol('county', 'County', '', 'Identity', 'county', { type: 'text', sort: 1, grow: 3, min: 72 });
  nodeCol('lat', 'Latitude', '°', 'Identity', 'lat', { dp: 4 });
  nodeCol('lon', 'Longitude', '°', 'Identity', 'lon', { dp: 4 });
  C('station', 'Station buses', '', 'Identity', 'GS.stations (buses sharing the station name)', { type: 'int',
    get: r => STATION_N.has(r.n.bus_id) ? STATION_N.get(r.n.bus_id) : null });
  nodeCol('hourly', 'Hourly', '', 'Identity', 'hourly_conf', { type: 'text', sort: 1, grow: 2,
    why: r => 'No hourly price series is held for this bus (1,218 of 2,678 carry one)' });
  nodeCol('shared_n', 'Series shared', 'buses', 'Identity', 'shared_n', { type: 'int',
    why: r => 'No hourly series at this bus, so nothing is shared' });

  /* Grid */
  C('hr', 'Headroom', 'MW', 'Grid', 'GS.headroom at the scope case', { dp: 1, scope: true, get: r => r.hr,
    hint: 'The scope case and the fuel\'s direction. Storage pairs the case\'s discharge with the shoulder charge — summer-peak charging is not a storage study condition.',
    why: r => `No ${GS.caseOf(SCOPE.case).label} headroom published for ${fuelWord(SCOPE.fuel)}'s direction at this bus` });
  /* integration 2026-09-28: the four pi_* columns read the vendor sheet's "# Pre-existing Issues"; every other surface
     reads the engine's count (§F). They stay in the registry, labelled "(sheet)" in header and tooltip. */
  C('pi', 'Pre-existing (sheet)', '', 'Grid', 'GS.preIssues at the scope case', { type: 'int', sort: 1, scope: true,
    hint: 'SHEET · # Pre-existing Issues (pi_*) at the scope case and in the fuel direction, as the substation sheet states it. The Studio states the ENGINE count instead (PANEL §F, elements with transfer_mw < 0, at the fuel governing case) on 3.20, the Market requirement, 6.01 and the grid-stage kill row; the "Pre-existing elements" column reads the engine at the scope case.',
    get: r => GS.preIssues(r.n, SCOPE.case, SCOPE.direction),
    why: r => `The ${GS.caseOf(SCOPE.case).label} case publishes no pre-existing count in this direction` });
  nodeCol('hr_sp_dis', 'Summer-peak injection', 'MW', 'Grid', 'hr_sp_dis', { dp: 1, fuels: ['solar', 'wind', 'hybrid'], hideFor: ['bess'] });
  nodeCol('hr_sh_dis', 'Shoulder injection', 'MW', 'Grid', 'hr_sh_dis', { dp: 1, fuels: ['solar', 'wind', 'hybrid'], hideFor: ['bess'] });
  nodeCol('hr_sp_chg', 'Summer-peak withdrawal', 'MW', 'Grid', 'hr_sp_chg', { dp: 1, fuels: ['dc'], hideFor: STORAGE,
    hideWhy: 'summer-peak charging is not a storage study condition' });
  nodeCol('hr_sh_chg', 'Shoulder withdrawal', 'MW', 'Grid', 'hr_sh_chg', { dp: 1, fuels: ['dc'], hideFor: ['bess'] });
  nodeCol('hr_ll_chg', 'Large-load withdrawal', 'MW', 'Grid', 'hr_ll_chg', { dp: 1, fuels: ['dc'] });
  nodeCol('pi_sp_dis', 'Injection issues (sheet)', '', 'Grid', 'pi_sp_dis', { type: 'int', sort: 1,
    hint: 'SHEET · # Pre-existing Issues at the summer-peak case, injection (pi_sp_dis). The Studio states the ENGINE count instead (PANEL §F, elements with transfer_mw < 0, at the fuel governing case) on 3.20, the Market requirement, 6.01 and the grid-stage kill row; the "Pre-existing elements" column reads the engine at the scope case.' });
  nodeCol('pi_sp_chg', 'Withdrawal issues (sheet)', '', 'Grid', 'pi_sp_chg', { type: 'int', sort: 1, fuels: ['dc'], hideFor: STORAGE,
    hint: 'SHEET · # Pre-existing Issues at the summer-peak case, withdrawal (pi_sp_chg). The Studio states the ENGINE count instead (PANEL §F, elements with transfer_mw < 0, at the fuel governing case) on 3.20, the Market requirement, 6.01 and the grid-stage kill row; the "Pre-existing elements" column reads the engine at the scope case.',
    hideWhy: 'summer-peak charging is not a storage study condition' });
  const sto = (id, label, k, o) => C(id, label, o && o.unit != null ? o.unit : 'MW', 'Grid', `storage_headroom.${k}`,
    Object.assign({ dp: 1, fuels: STORAGE, get: r => pick1(STOH[sid(r)], k),
      why: notHeldAt('GS_DATA_EXT.storage_headroom') }, o));
  sto('sto_sp_dis', 'Summer-peak discharge', 'sp_dis', { hideFor: ['solar', 'wind', 'dc'] });
  sto('sto_sh_dis', 'Shoulder discharge', 'sh_dis', { hideFor: ['solar', 'wind', 'dc'] });
  sto('sto_sh_chg', 'Shoulder charge', 'sh_chg', { hideFor: ['solar', 'wind', 'dc'] });
  sto('pi_sh_chg', 'Charge issues (sheet)', 'pi_sh_chg', { unit: '', type: 'int', sort: 1, fuels: 'all',
    hint: 'SHEET · # Pre-existing Issues at the shoulder case, charging (storage_headroom.pi_sh_chg, from the headroom study sheet). The Studio states the ENGINE count instead (PANEL §F, elements with transfer_mw < 0, at the fuel governing case) on 3.20, the Market requirement, 6.01 and the grid-stage kill row; the "Pre-existing elements" column reads the engine at the scope case.' });
  const ldWhy = r => GOV.why ? `Not run: ${GOV.why}` : `Not held: no loading row for bus #${r.n.bus_id} at ${GOV.key.replace('|', ' · ')} (2,291 of 2,678 buses carry one)`;
  const ld = (r, k) => GOV.key ? pick1(aliasAt(LOADING, `${sid(r)}|${GOV.key}`), k) : null;
  C('viol', 'Violations', '', 'Grid', 'loading[bus|governing case].violations_before', { type: 'int', sort: 1, scope: true,
    get: r => ld(r, 'violations_before'), why: ldWhy,
    hint: 'Element overloads before any transfer, at the loading run that governs the scope\'s fuel and case (N-0 on Rate A, N-1 on Rate C).' });
  C('pre_el', 'Pre-existing elements', '', 'Grid', 'loading[bus|governing case].pre_existing_n', { type: 'int', sort: 1, scope: true,
    get: r => ld(r, 'pre_existing_n'), why: ldWhy });
  C('el_n', 'Elements loaded', '', 'Grid', 'loading[bus|governing case].n_rows', { type: 'int', scope: true,
    get: r => ld(r, 'n_rows'), why: ldWhy });
  const cost = (r, mw, k) => GOV.key ? pick1(aliasAt(COST, `${sid(r)}|${GOV.key}|${mw}`), k) : null;
  [100, 250].forEach(mw => {
    C(`cost${mw}`, `Cost ${mw} MW`, '$M', 'Grid', `cost[bus|governing case|${mw}].total_musd`, { sort: 1, scope: true,
      get: r => cost(r, mw, 'total_musd'), why: ldWhy,
      hint: `Network upgrade cost to connect ${mw} MW — elements at or below the request, pre-existing excluded (Grid 3.17 rule).` });
    C(`kw${mw}`, `Cost/kW ${mw} MW`, '$/kW', 'Grid', `cost[bus|governing case|${mw}].per_kw`, { sort: 1, scope: true,
      get: r => cost(r, mw, 'per_kw'), why: ldWhy });
  });
  C('sc', 'Short-circuit strength', 'MVA', 'Grid', 'node.sc_mva × 100', { dp: 0, get: r => GS.shortCircuitMVA(r.n),
    why: notHeldAt('node.sc_mva') });
  nodeCol('outlets', 'Outlets', '', 'Grid', 'outlets', { type: 'int' });
  nodeCol('branch_deg', 'Branch degree', '', 'Grid', 'branch_deg', { type: 'int',
    why: r => 'No modelled branch ends at this bus in the substation sheet' });

  /* Prices */
  [2025, 2030, 2035, 2050].forEach(y => nodeCol(`lmp_${y}`, y === 2025 ? 'LMP 2025 (sheet)' : `LMP ${y}`, '$/MWh', 'Prices', `lmp_${y}`, { sort: 1 }));
  nodeCol('p5', 'LMP P5 2030', '$/MWh', 'Prices', 'p5_2030', { sort: 1 });
  nodeCol('p95', 'LMP P95 2030', '$/MWh', 'Prices', 'p95_2030', { sort: 1 });
  nodeCol('basis', 'Basis vs zone', '$/MWh', 'Prices', 'basis_own_2025', {
    hint: 'Basis_Vs_Own_Zone_2025 — the bus against its own load zone, 2025. Not hub-relative: no per-bus hub series is held.' });
  ['ME', 'NH', 'VT', 'CT', 'RI', 'SEMA', 'WCMA', 'NEMA'].forEach(z =>
    nodeCol(`basis_${z}`, `Basis vs ${z}`, '$/MWh', 'Prices', `basis_${z}_2030`, { hint: `The bus against the ${z} load zone, 2030.` }));
  nodeCol('cong', 'Congestion share 2025', '%', 'Prices', 'cong_2025', { sort: 1, hint: 'Congestion share of the 2025 price.' });
  nodeCol('hneg', 'Negative hours', 'h', 'Prices', 'hneg_2025', { type: 'int', sort: 1 });
  nodeCol('rt_neg', 'RT negative hours', 'h', 'Prices', 'rt_neg_2025', { type: 'int', sort: 1,
    hint: 'Settled real-time negative-price hours, 2025 — held where an hourly series is.',
    why: r => 'No settled hourly series at this bus (1,218 of 2,678 carry one)' });
  nodeCol('h200', 'Hours over $200', 'h', 'Prices', 'h200_2025', { type: 'int' });
  nodeCol('std', 'Volatility 2025', '$/MWh', 'Prices', 'std_2025', { hint: 'Std_LMP_2025 — settled.' });
  const decWhy = r => `Not held: no settled 2025 real-time series at this bus (${fmt.int(DEC25.size)} carry one)`;
  C('energy', 'Energy component', '$/MWh', 'Prices', 'decomp[bus].years[2025 RT].energy', { sort: 1,
    get: r => pick1(DEC25.get(sid(r)), 'energy'), why: decWhy });
  C('cong_part', 'Congestion (MCC)', '$/MWh', 'Prices', 'decomp[bus].years[2025 RT].congestion', { sort: 1,
    get: r => pick1(DEC25.get(sid(r)), 'congestion'), why: decWhy });
  C('loss_part', 'Loss (MLC)', '$/MWh', 'Prices', 'decomp[bus].years[2025 RT].loss', { sort: 1,
    get: r => pick1(DEC25.get(sid(r)), 'loss'), why: decWhy });
  const fdWhy = notHeldAt('GS_DATA_EXT.forecast_delta');
  C('run_gap', 'Forecast run gap', '$/MWh', 'Prices', 'forecast_delta[bus].delta', { get: r => pick1(FDELTA[sid(r)], 'delta'), why: fdWhy,
    hint: 'Two forecast runs apart at this bus, 2035: the 10-year run less the PCR 2035 run.' });
  C('run_gap_pct', 'Forecast gap share', '%', 'Prices', 'forecast_delta[bus].delta_pct', { get: r => pick1(FDELTA[sid(r)], 'delta_pct'), why: fdWhy });
  const lpWhy = notHeldAt('GS_DATA_EXT.load_pays');
  C('load_cost', 'Flat-load cost', '$/MWh', 'Prices', 'load_pays[bus].mean_rt', { sort: 1, fuels: ['dc'],
    get: r => pick1(LOADP[sid(r)], 'mean_rt'), why: lpWhy, hint: 'What a flat load pays: mean real-time price over the settled year.' });
  C('cheap_share', 'Share under $20', '%', 'Prices', 'load_pays[bus].cheap_share', { dp: 1, fuels: ['dc'],
    get: r => pick1(LOADP[sid(r)], 'cheap_share'), why: lpWhy, hint: 'Share of settled hours under $20/MWh.' });
  C('cheap_h', 'Hours under $20', 'h', 'Prices', 'load_pays[bus].cheap_hours_lt20', { type: 'int', fuels: ['dc'],
    get: r => pick1(LOADP[sid(r)], 'cheap_hours_lt20'), why: lpWhy });
  C('tier', 'Price tier', '', 'Prices', 'cathy.bus_annual.tier · decomp.tier · demo_buses', { type: 'text', sort: 1,
    get: r => TIER_WORD[tierOf(r.n)] || tierOf(r.n),
    hint: 'Direct pnode, the substation\'s pnode, or a geographic proxy. A bus with no direct or same-station series is a proxy — the exporter\'s own census (price_tiers_on_the_spine).' });
  C('proxy_mi', 'Proxy distance', 'mi', 'Prices', 'cathy.meta.demo_buses.distance_mi', { dp: 2, sort: 1,
    get: r => proxyMiles(r.n),
    why: r => tierOf(r.n) === 'geo_proxy'
      ? 'Not held: the proxy distance is published for the demo buses only'
      : 'Not applicable: this bus reads its own or its station\'s node, so there is no distance' });
  /* The Economics price basis — the same reader the Economics cards use, so the
     map, the grid and the cards read one number. GS.priceAt (ext/76) returns the
     solved run at the bus where one is held and the corrected sheet elsewhere,
     LABELLED as the sheet; before ext/76 has booted, or without it, the reader
     falls back to the solved run in cathy.bus_annual and never to the sheet. */
  PB_YEARS.forEach(y => C(`lmp${y}_pb`, y <= 2025 ? `LMP ${y} (settled)` : `LMP ${y}`, '$/MWh', 'Prices', `GS.priceAt(bus, ${y})`, { sort: 1,
    get: r => { const p = priceBasis(r.n, y); return p ? p.value : null; },
    srcOf: r => { const p = priceBasis(r.n, y); return p ? (SRC_WORD[p.source] || p.source) : null; },
    hint: y <= 2025 ? `Settled real-time annual mean, ${y}.`
      : `The Economics price basis, ${y}: the solved run at this bus where one is held; elsewhere the corrected sheet, labelled "sheet · no run" in the hover and in Price source.`,
    why: r => y === 2040 ? 'Not held: no solved 2040 run at this bus, and the sheet has no 2040 column'
      : `Not held: no price for ${y} at this bus` }));
  C('px_src', 'Price source', '', 'Prices', 'GS.priceAt(bus, 2030).source', { type: 'text', sort: 1,
    get: r => { const p = priceBasis(r.n, 2030); return p ? (SRC_WORD[p.source] || p.source) : null; },
    hint: 'Where LMP 2030 comes from at this bus: the solved PROBE run, or the corrected sheet where no run is held.' });
  C('px_gap', 'Sheet vs run', '%', 'Prices', 'cathy.bus_annual pcr2030 against node.lmp_2030', { dp: 1,
    get: r => sheetVsRun(r.n),
    hint: 'The corrected sheet\'s Avg_LMP_2030 against the solved PCR 2030 run at the same bus, in per cent. Beyond ±20 % the Economics stage flags the bus as a data anomaly.',
    why: r => 'Not held: this bus carries no solved 2030 run to compare the sheet with' });

  /* Fuel fit */
  C('curt', 'Curtailment', '%', 'Fuel fit', 'GS.curt at the scope fuel and size', { scope: true,
    label: f => f === 'bess' ? 'Opportunity loss' : f === 'dc' ? 'Reliability risk' : 'Curtailment',
    sort: 1, get: r => r.curt, why: r => `Not held: no ${fuelWord(SCOPE.fuel)} ramp at this bus` });
  const CURT_FAM = [['solar', 'Solar curtailment', ['solar', 'hybrid']], ['wind', 'Wind curtailment', ['wind']],
    ['bess', 'Opportunity loss', ['bess', 'hybrid']], ['dc', 'Reliability risk', ['dc']]];
  CURT_FAM.forEach(([f, word, fuels]) => GS.SIZES.forEach(s =>
    nodeCol(`curt_${f}_${s}`, `${word} ${s}`, '%', 'Fuel fit', `${f}_${s}MW_2030`, { sort: 1, fuels,
      hint: `${GS.FUELS[f].curtLabel} at ${s} MW, 2030 — vendor ramp unless the bus was screened.` })));
  nodeCol('cap_solar', 'Solar capture', '', 'Fuel fit', 'solar_cap_2030', { dp: 3, fuels: ['solar', 'hybrid'] });
  nodeCol('cap_wind', 'Wind capture', '', 'Fuel fit', 'wind_cap_2030', { dp: 3, fuels: ['wind'] });
  [['tb2', 'TB2 2030', 'tb2_2030'], ['tb4', 'TB4 2030', 'tb4_2030'], ['tb8', 'TB8 2030', 'tb8_2030'],
   ['tb4_2035', 'TB4 2035', 'tb4_2035'], ['tb4_2050', 'TB4 2050', 'tb4_2050']].forEach(([id, l, k]) =>
    nodeCol(id, l, '$/MWh', 'Fuel fit', k, { fuels: STORAGE,
      why: r => `Not held: ${k} is published for ${k.endsWith('2030') ? '2,415' : '2,470'} of 2,678 buses` }));

  /* Land */
  const exWhy = r => `Not screened: the land screen ran at ${fmt.int(Object.keys(EXCL).length)} buses — the example projects plus the top 50 per fuel`;
  const ex = (r, k) => pick1(EXCL[sid(r)], k);
  C('clear_ac', 'Clear acres', 'ac', 'Land', 'exclusions[bus].clear_acres', { dp: 0, fuels: ['solar', 'wind', 'hybrid', 'bess'],
    get: r => ex(r, 'clear_acres'), why: exWhy });
  C('disc_ac', 'Study-circle acres', 'ac', 'Land', 'exclusions[bus].disc_acres', { dp: 0, get: r => ex(r, 'disc_acres'), why: exWhy });
  C('clear_pct', 'Clear share', '%', 'Land', 'exclusions[bus].clear_acres ÷ disc_acres', { dp: 1,
    get: r => { const c = ex(r, 'clear_acres'), d = ex(r, 'disc_acres'); return c == null || !d ? null : 100 * c / d; }, why: exWhy });
  C('clear_blocks', 'Clear blocks', '', 'Land', 'exclusions[bus].clear_blocks', { type: 'int', sort: 1, get: r => ex(r, 'clear_blocks'), why: exWhy });
  C('disc_mi', 'Study-circle radius', 'mi', 'Land', 'exclusions[bus].radius_mi', { dp: 0, get: r => ex(r, 'radius_mi'), why: exWhy });

  /* Queue & system */
  nodeCol('gen_mw', 'Generation', 'MW', 'Queue & system', 'gen_mw', { dp: 1,
    why: r => 'No generator is modelled at this bus (64 of 2,678 carry one)' });
  nodeCol('load_mw', 'Load', 'MW', 'Queue & system', 'load_mw', { dp: 1,
    why: r => 'No load is modelled at this bus (92 of 2,678 carry one)' });
  nodeCol('top_con', 'Top constraint', '', 'Queue & system', 'top_constraint', { type: 'text', sort: 1, grow: 3, min: 120 });
  nodeCol('top_shadow', 'Shadow price', '$/MWh', 'Queue & system', 'top_shadow', { dp: 1 });
  C('queue_mi', 'Queue nearby', 'MW', 'Queue & system', `GS.D.queue max_mw within ${Q_NEAR_MI} mi`, { dp: 0,
    get: r => QNEAR.has(r.n.bus_id) ? QNEAR.get(r.n.bus_id) : null,
    hint: `Queue MW (max_mw) of the ${QUEUE.length} active projects within ${Q_NEAR_MI} miles of the bus, great-circle. Zero is a measured zero: no project that close.` });
  C('zone_fixed', 'Zone corrected', '', 'Identity', 'zone_fix against node.zone', { type: 'text', sort: 1,
    get: r => { const f = ZFIX[sid(r)]; return f && f !== r.n.zone ? `${r.n.zone || '—'} → ${f}` : null; },
    why: r => 'The sheet\'s zone and the operator\'s pnode zone agree at this bus' });
  /* land cost is an ASSUMPTION band at county grain (derived.mart_land_cost_proxy,
     one rate on all 70 rows). It is read only if the exporter publishes it as
     GS_DATA_EXT.land_cost_proxy; nothing here types a dollar figure. */
  const LANDC = landCostIndex();
  if (LANDC) C('land_cost', 'Land cost', '$/acre', 'Land', 'land_cost_proxy[state|county].base', { dp: 0, sort: 1,
    get: r => { const x = LANDC.get(`${String(r.n.state || '').toUpperCase()}|${String(r.n.county || '').toUpperCase()}`); return x ? x.base : null; },
    hint: 'ASSUMPTION — derived.mart_land_cost_proxy, a stated $/acre band at county grain with provenance "assumption". No price per acre is measured anywhere in the workspace.',
    why: r => 'Not held: no land-cost row for this county' });

  /* Workflow */
  C('score', 'Score', '', 'Workflow', 'GS.score at the scope weights', { dp: 1, scope: true, get: r => r.score,
    why: r => 'Not scored at this scope' });
  C('rank', 'Rank', '', 'Workflow', 'GS.score order at the scope weights', { type: 'int', sort: 1, scope: true,
    get: r => r.rank, why: r => 'Not ranked: not scored at this scope' });
  C('gates', 'Gates', '', 'Workflow', 'GS.gates at the scope', { type: 'gate', scope: true, get: r => r.gate });
  C('demo_syn', 'Synthetic', '', 'Workflow', 'GSXDemo.applied.busNew (the Demo data toggle)', { type: 'text', state: true,
    get: r => demoSynthetic(r.n.bus_id) ? 'synthetic' : null,
    why: r => 'No synthetic demo value is applied at this bus' });
  C('pin', 'Pinned bus', '', 'Workflow', 'App.state.pins', { type: 'text', state: true,
    get: r => PINS.has(r.n.bus_id) ? 'pinned' : null, why: r => 'Not pinned' });
  C('evidence', 'Evidence', '', 'Workflow', 'project.evidence (all projects)', { type: 'int', state: true,
    get: r => EVID.has(r.n.bus_id) ? EVID.get(r.n.bus_id) : null, why: r => 'No evidence pinned against this bus on any project' });

  const REG_BY = new Map(REG.map(c => [c.id, c]));
  const COLUMNS = REG;                       // the name the test surface has always used
  const labelOf = (c, fuel) => typeof c.label === 'function' ? c.label(fuel || SCOPE.fuel) : c.label;
  const hiddenFor = (c, fuel) => c.hideFor.includes(fuel);
  const servesFuel = (c, fuel) => c.fuels === 'all' || c.fuels.includes(fuel);
  const isNum = c => c.type === 'num' || c.type === 'int';

  /* ── 6.2 · defaults by fuel ─────────────────────────────────────────────
     Each the read that fuel's question needs, always with bus, kV, zone,
     score and gates. Switching the scope's fuel swaps them — unless the
     reader has customised the set, which is then theirs.
     integration 2026-09-28: each set fits the 1440 × 900 dock (1392 px) with
     no sideways scroll; the header floors are the labels' measured widths, so
     the fit is made by the set, never by clipping a label. Measured at 1440
     before the trim: solar 1486 px, wind 1473, storage 1649, data centre 1729.
     Moved to the chooser (still one click away): solar "Solar curtailment
     250" (the at-size curtailment stays), wind "Basis vs zone", storage "TB2
     2030", "TB8 2030" and "Volatility 2025" (TB4 stays), data centre
     "Summer-peak withdrawal" and "Short-circuit strength" (the large-load
     governing case stays), hybrid "Summer-peak injection" (the scope
     headroom reads it at summer peak) and "Basis vs zone". */
  const DEFAULTS = {
    solar: ['name', 'kv', 'zone', 'hr', 'pi', 'viol', 'cost100', 'curt', 'cap_solar',
      'lmp_2030', 'basis', 'hneg', 'score', 'gates'],
    wind: ['name', 'kv', 'zone', 'hr', 'pi', 'viol', 'cost100', 'curt', 'curt_wind_250', 'cap_wind',
      'lmp_2030', 'hneg', 'score', 'gates'],
    bess: ['name', 'kv', 'zone', 'sto_sp_dis', 'sto_sh_chg', 'pi_sh_chg', 'viol', 'cost100', 'tb4',
      'curt', 'score', 'gates'],
    dc: ['name', 'kv', 'zone', 'hr_ll_chg', 'viol', 'cost100', 'load_cost', 'cheap_share',
      'lmp_2030', 'std', 'outlets', 'score', 'gates'],
    hybrid: ['name', 'kv', 'zone', 'hr', 'sto_sh_chg', 'viol', 'cost100', 'curt', 'cap_solar',
      'tb4', 'lmp_2030', 'score', 'gates'],
  };
  const defaultsFor = fuel => (DEFAULTS[fuel] || DEFAULTS.solar).slice();

  /* ── 6.3 · the shown set, persisted ─────────────────────────────────── */
  const COL_KEY = 'gs.grid.cols.v1';
  let SCOPE = A.ctx();
  let custom = false, shownFuel = SCOPE.fuel;
  let shown = defaultsFor(SCOPE.fuel);
  try {
    const raw = localStorage.getItem(COL_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      const ids = v && Array.isArray(v.cols) ? v.cols.filter(k => REG_BY.has(k)) : [];
      if (ids.length) { shown = ids; custom = true; }
    }
  } catch (e) { /* storage refused or corrupt — the fuel's defaults stand */ }
  function saveCols() {
    try {
      if (custom) localStorage.setItem(COL_KEY, JSON.stringify({ v: 1, cols: shown }));
      else localStorage.removeItem(COL_KEY);
    } catch (e) { /* storage refused — the set still applies for this session */ }
  }
  /** the columns on screen: the shown set, less any the scope's fuel excludes */
  const cols = () => shown.map(k => REG_BY.get(k)).filter(c => c && !hiddenFor(c, SCOPE.fuel));

  function setShown(ids, isCustom) {
    const next = [...new Set(ids.filter(k => REG_BY.has(k)))];
    shown = next.length ? next : ['name'];
    custom = isCustom !== false;
    saveCols();
    if (!cols().some(c => c.id === sortKey)) { sortKey = cols().some(c => c.id === 'score') ? 'score' : cols()[0].id; sortDir = -1; }
    if (gHead) { buildHead(); applyView(); }
    if (chooser && !chooser.hidden) renderChooser();
  }
  function resetCols() { custom = false; setShown(defaultsFor(SCOPE.fuel), false); }
  function moveCol(id, to) {
    const from = shown.indexOf(id); if (from < 0) return;
    const next = shown.slice(); next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
    setShown(next, true);
  }

  /* ── 6.4 · floors, measured ─────────────────────────────────────────────
     A floor is the header's natural width — label, unit and the gap between —
     measured in the header's own 10 px uppercase and tracking, plus 12 px of
     padding, 1 px of border and 3 px of slack. The slack is not decoration:
     "PRE-EXISTING" is 85.23 px and a column that leaves 85.00 rounds to no
     overflow in scrollWidth while the browser still draws the ellipsis. With
     106 columns and labels that move with the fuel, the floors are measured,
     cached per string, and never typed in by hand. */
  const SORT_W = 14;
  const NAT = new Map();
  let measurer = null;
  const unitText = c => {
    const cv = COVER.get(c.id);
    const sparse = cv && !c.state && cv.share < 0.5 ? `${cv.share < 0.1 ? (100 * cv.share).toFixed(1) : Math.round(100 * cv.share)}% held` : '';
    return [c.unit, sparse].filter(Boolean).join(' · ');
  };
  function natural(c) {
    const lab = labelOf(c), u = unitText(c), k = lab + '\u0001' + u;
    if (NAT.has(k)) return NAT.get(k);
    const est = lab.length * 7.2 + u.length * 6 + 6;
    if (!gHead || !gHead.isConnected) return est;
    if (!measurer) {
      measurer = H('div', 'gsx-hc gsx-measure');
      measurer.innerHTML = '<button type="button"><span class="t"></span><span class="u"></span></button>';
    }
    gHead.appendChild(measurer);
    measurer.querySelector('.t').textContent = lab;
    measurer.querySelector('.u').textContent = u;
    const w = measurer.querySelector('button').getBoundingClientRect().width;
    measurer.remove();
    if (w > 0) { NAT.set(k, w); return w; }
    return est;
  }
  const floorOf = c => Math.max(c.min || 40, Math.ceil(natural(c)) + 14) + (c.id === sortKey ? SORT_W : 0);
  /* A floor measured before the web font arrives is measured in the fallback
     face — "PRE-EXISTING" came out 4 px short and ellipsised. The cache is
     dropped and the header re-laid whenever the font set settles. */
  if (document.fonts) {
    const remeasure = () => { NAT.clear(); if (gHead && gHead.isConnected) guard('grid', () => { buildHead(); paintGrid(true); }); };
    if (document.fonts.ready) document.fonts.ready.then(remeasure);
    if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', remeasure);
  }

  /** Spread the dock's spare width over the growing columns, and hand the
   *  rounding remainder to the last of them so the row ends exactly at the edge
   *  rather than one pixel short of it. Below the sum of the floors the grid
   *  scrolls sideways — the header is inside the scroller, so nothing is pushed
   *  past the dock. */
  function layoutCols() {
    const cs = cols();
    const avail = gBody ? gBody.clientWidth : 0;
    cs.forEach(c => { c._f = floorOf(c); });
    const base = cs.reduce((t, c) => t + c._f, 0);
    const growers = cs.some(c => c.grow) ? cs.filter(c => c.grow) : cs;
    const grow = growers.reduce((t, c) => t + (c.grow || 1), 0);
    if (avail > base + 2 && grow > 0) {
      const extra = avail - base;
      cs.forEach(c => { c._w = c._f + (growers.includes(c) ? Math.floor(extra * (c.grow || 1) / grow) : 0); });
      const last = growers[growers.length - 1];
      last._w += avail - cs.reduce((t, c) => t + c._w, 0);
    } else cs.forEach(c => { c._w = c._f; });
    return cs;
  }

  /* ── 6.5 · rows, coverage, filters, sort ─────────────────────────────── */
  const FILTERS = Object.create(null);
  let sortKey = 'score', sortDir = -1;
  let ROWS = [], VIEWR = [], cursor = -1, ROW_BY = new Map();
  let gBody = null, gRows = null, gSpacer = null, gHead = null, gCount = null;
  let scopeKey = '';
  let PINS = new Set();
  const COVER = new Map();

  /** Every bus at the current scope, with the derived measures the columns
   *  read. `GS.candidates` with the gate off is the whole spine — 2,678 rows —
   *  and the gate is a column here, not a filter, so nothing is silently absent. */
  function rebuildRows() {
    const c = SCOPE;
    GOV = govCase(c.fuel, c.case);
    const res = GS.candidates({ fuel: c.fuel, size: c.size, case: c.case, gate: false });
    const scored = GS.score(c.fuel, A.weightsFor(c.fuel), { gate: false, size: c.size, case: c.case });
    const byBus = new Map(scored.rows.map(r => [r.n.bus_id, r.score]));
    ROWS = res.rows.map(r => {
      const g = GS.gates(c.fuel, r.n, c.size, c.case);
      return { n: r.n, hr: scopeHr(r.n, c.fuel, c.case), curt: r.curt, cap: r.cap,
               score: byBus.has(r.n.bus_id) ? byBus.get(r.n.bus_id) : null,
               gate: { clear: g.clear, total: g.total, why: g.gates }, rank: null };
    });
    /* rank = order by score at the scope's weights, 1 first; ties by bus id so
       the order never depends on the array the host happened to return */
    ROWS.filter(r => r.score != null).sort((a, b) => (b.score - a.score) || (a.n.bus_id - b.n.bus_id))
      .forEach((r, i) => { r.rank = i + 1; });
    ROW_BY = new Map(ROWS.map(r => [r.n.bus_id, r]));
    measureCoverage();
    applyView();
  }

  /** The non-null share of every registry column across the rows in scope,
   *  measured on the data rather than declared. Scope columns move with the
   *  scope, so this re-runs whenever the rows are rebuilt. */
  function measureCoverage() {
    const total = ROWS.length || 1;
    REG.forEach(c => {
      let n = 0;
      for (let i = 0; i < ROWS.length; i++) { const v = c.get(ROWS[i]); if (v != null && v !== '') n++; }
      COVER.set(c.id, { n, total: ROWS.length, share: n / total });
    });
  }

  /** A numeric filter understands `>100`, `<5`, `10-20` and a plain number as a
   *  prefix match; anything else is a substring on the rendered text. The rule is
   *  in the input's title so it is not folklore. */
  function matches(col, raw, row) {
    const q = raw.trim(); if (!q) return true;
    const v = col.get(row);
    if (col.type === 'gate') {
      const t = v ? `${v.clear}/${v.total}` : '';
      return t.indexOf(q) >= 0;
    }
    /* `[a,b)` and `[a,b]` are the map legend's classes, written back into the
       grid — lower edge inclusive, upper edge exclusive except for the top class,
       exactly the rule the map classes by. `=x` is an exact match, so a zone
       filter of `=ME` does not also catch SEMA and NEMA. */
    const br = q.match(/^\[\s*(-?[\d.]+(?:e-?\d+)?)\s*,\s*(-?[\d.]+(?:e-?\d+)?)\s*([\])])$/i);
    if (br && isNum(col)) {
      if (v == null) return false;
      const a = parseFloat(br[1]), b = parseFloat(br[2]);
      return v >= a && (br[3] === ']' ? v <= b : v < b);
    }
    if (q[0] === '=' && q.length > 1) {
      if (v == null) return false;
      const x = q.slice(1).trim();
      return isNum(col) ? Number(v) === Number(x) : String(v).toLowerCase() === x.toLowerCase();
    }
    if (isNum(col)) {
      if (v == null) return q === '-' || q === '—' || q.toLowerCase() === 'not held';
      const m = q.match(/^(>=|<=|>|<)\s*(-?[\d.]+)$/);
      if (m) { const x = parseFloat(m[2]);
        return m[1] === '>' ? v > x : m[1] === '<' ? v < x : m[1] === '>=' ? v >= x : v <= x; }
      const rg = q.match(/^(-?[\d.]+)\s*-\s*(-?[\d.]+)$/);
      if (rg) { const a = parseFloat(rg[1]), b = parseFloat(rg[2]); return v >= Math.min(a, b) && v <= Math.max(a, b); }
      return String(v).indexOf(q) >= 0;
    }
    if (v == null) return q === '-' || q === '—' || q.toLowerCase() === 'not held';
    return String(v).toLowerCase().indexOf(q.toLowerCase()) >= 0;
  }

  function applyView() {
    /* only the columns on screen filter: a filter left on a column the reader
       has since removed would hide rows with nothing on screen to say why */
    const active = cols().filter(c => (FILTERS[c.id] || '').trim());
    VIEWR = active.length ? ROWS.filter(r => active.every(c => matches(c, FILTERS[c.id], r))) : ROWS.slice();
    const col = REG_BY.get(sortKey);
    if (col) {
      const val = r => { const v = col.get(r); return col.type === 'gate' ? (v ? v.clear : null) : v; };
      VIEWR.sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1; if (y == null) return -1;
        return (typeof x === 'string' ? String(x).localeCompare(String(y)) : x - y) * sortDir;
      });
    }
    paintGrid(true);
    /* the map mirrors the grid's filters: what the grid leaves out, the map
       fades or hides */
    guard('layers', () => mapFilterChanged(active.length > 0));
  }

  /* ── 6.6 · the grid ───────────────────────────────────────────────────── */
  let chooser = null, chooserBtn = null, chooserQ = '', dragId = null;

  function buildGrid() {
    const pane = H('div', 'gsx-pane gsx-grid-pane');

    const bar = H('div', 'gsx-grid-bar');
    bar.appendChild(H('b', null, 'All buses'));
    gCount = H('span', 'n');
    bar.appendChild(gCount);
    bar.appendChild(H('span', 'sp'));
    const clear = H('button', 'gsx-btn', 'Clear filters');
    clear.setAttribute('data-gsx', 'clear-filters');
    clear.onclick = () => {
      Object.keys(FILTERS).forEach(k => delete FILTERS[k]);
      gHead.querySelectorAll('input').forEach(i => { i.value = ''; });
      applyView();
    };
    bar.appendChild(clear);

    chooserBtn = H('button', 'gsx-btn', 'Columns ▾');
    chooserBtn.setAttribute('data-gsx', 'columns');
    chooserBtn.setAttribute('aria-haspopup', 'dialog');
    chooserBtn.onclick = e => { e.stopPropagation(); if (chooser && !chooser.hidden) closeChooser(); else openChooser(); };
    bar.appendChild(chooserBtn);
    pane.appendChild(bar);

    /* ONE SCROLL CONTAINER. The header row is a child of the scrolling body and
       sticks to its top, rather than a separate strip whose scrollLeft was kept
       in step by hand. A column set wider than the dock scrolls the grid
       sideways instead of pushing the header past the dock and out of the
       window, and the frame sweep's "no element wider than the viewport"
       measure reads a scroll container correctly. The cost is that scrollTop
       counts the header, so the virtualiser and `scrollTo` subtract `headH()`. */
    gBody = H('div', 'gsx-body');
    gBody.tabIndex = 0;
    gBody.setAttribute('data-gsx', 'grid-body');
    gHead = H('div', 'gsx-head');
    gBody.appendChild(gHead);
    gSpacer = H('div', 'gsx-spacer');
    gRows = H('div', 'gsx-rows');
    gRows.setAttribute('data-gsx', 'grid-rows');
    gSpacer.appendChild(gRows);
    gBody.appendChild(gSpacer);
    gBody.addEventListener('scroll', () => paintGrid());
    if (window.ResizeObserver) {
      let t = 0;
      new ResizeObserver(() => {
        clearTimeout(t);
        t = setTimeout(() => guard('grid', () => { buildHead(); paintGrid(true); }), 60);
      }).observe(gBody);
    }
    gBody.addEventListener('keydown', onGridKey);
    pane.appendChild(gBody);

    buildHead();
    return pane;
  }

  function headTitle(c) {
    const cv = COVER.get(c.id);
    return [`Sort on ${labelOf(c)}${c.unit ? ` (${c.unit})` : ''}`,
      `Source: ${c.source}`,
      c.hint || '',
      cv ? `Held at ${fmt.int(cv.n)} of ${fmt.int(cv.total)} buses (${(100 * cv.share).toFixed(cv.share < 0.1 ? 1 : 0)}%)` : ''].filter(Boolean).join('\n');
  }

  function buildHead() {
    gHead.innerHTML = '';
    const row = H('div', 'hrow');
    layoutCols().forEach(col => {
      const c = H('div', 'gsx-hc' + (isNum(col) ? ' num' : ''));
      c.style.width = (col._w || col._f) + 'px';
      c.setAttribute('data-gsx-colid', col.id);
      /* label, unit and sort mark are three elements: the label is the part
         that would ellipsise, and the unit and the mark stay legible */
      const b = H('button');
      const on = sortKey === col.id;
      b.appendChild(H('span', 't', labelOf(col)));
      const cv = COVER.get(col.id);
      const u = H('span', 'u' + (cv && !col.state && cv.share < 0.5 ? ' sparse' : ''), unitText(col));
      b.appendChild(u);
      if (on) b.appendChild(H('span', 's', sortDir < 0 ? '↓' : '↑'));
      b.title = headTitle(col);
      b.onclick = () => { if (sortKey === col.id) sortDir = -sortDir; else { sortKey = col.id; sortDir = col.sort || -1; } buildHead(); applyView(); };
      const i = H('input');
      i.type = 'text'; i.value = FILTERS[col.id] || '';
      i.placeholder = isNum(col) ? '>100' : 'filter';
      i.title = isNum(col)
        ? 'Numbers: >100 · <5 · >=100 · 10-20 · [10,20) · =5 · or a digit string. A dash matches the buses with no value. A map legend click writes a [a,b) class here.'
        : 'Substring, case-insensitive; =ME for an exact match. A dash matches the buses with no value.';
      i.setAttribute('data-gsx-filter', col.id);
      i.oninput = () => { FILTERS[col.id] = i.value; applyView(); };
      i.onkeydown = e => { if (e.key === 'Escape') { i.value = ''; FILTERS[col.id] = ''; applyView(); } e.stopPropagation(); };
      c.appendChild(b); c.appendChild(i);
      row.appendChild(c);
    });
    gHead.appendChild(row);
  }

  const ROW_H = 26;
  const OVERSCAN = 6;
  /* The sticky header is inside the scroller, so it eats the top of the body's
     client box: the rows a reader can actually see are `clientHeight - headH`.
     Measured, never assumed — the header's height moves with font settings. */
  const headH = () => (gHead ? Math.round(gHead.getBoundingClientRect().height) : 0);

  function cellText(col, row) {
    const v = col.get(row);
    if (col.type === 'gate') return v ? `${v.clear}/${v.total}` : 'not held';
    if (v == null || v === '') return 'not held';
    if (col.type === 'int') return fmt.int(v);
    if (col.type === 'num') return fmt.num(v, col.dp);
    return String(v);
  }
  /** Why a cell is empty — the column's own reason, else "not held". */
  function whyNil(col, row) {
    if (!servesFuel(col, SCOPE.fuel) && col.scope) return `Not applicable to ${fuelWord(SCOPE.fuel)}`;
    return col.why ? col.why(row) : `Not held: ${col.source} has no value for bus #${row.n.bus_id}`;
  }

  function paintGrid(force) {
    if (!gRows) return;
    const total = VIEWR.length;
    gSpacer.style.height = (total * ROW_H) + 'px';
    const cc = cols();
    const w = cc.reduce((s, c) => s + (c._w || c._f || 60), 0);
    gSpacer.style.width = w + 'px';
    const top = Math.max(0, gBody.scrollTop);
    const h = Math.max(ROW_H, (gBody.clientHeight || ROW_H * 8) - headH());
    const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    const last = Math.min(total, Math.ceil((top + h) / ROW_H) + OVERSCAN);
    const sel = selectedBus();

    if (!force && gRows._first === first && gRows._last === last && gRows._sel === sel
      && gRows._cursor === cursor) return;
    gRows._first = first; gRows._last = last; gRows._sel = sel; gRows._cursor = cursor;

    gRows.style.transform = `translateY(${first * ROW_H}px)`;
    gRows.innerHTML = '';
    if (!total) {
      const e = H('div', 'gsx-empty');
      e.innerHTML = `<b>No bus matches these filters</b>${fmt.int(ROWS.length)} buses are in scope; `
        + `every filter is a column filter, and clearing them brings them all back.`;
      gRows.appendChild(e);
      gCount.textContent = `0 of ${fmt.int(ROWS.length)} rows`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const row = VIEWR[i];
      const el = H('div', 'gsx-r' + (row.n.bus_id === sel ? ' on' : '') + (i === cursor ? ' cur' : ''));
      el.setAttribute('data-gsx-row', String(row.n.bus_id));
      el.dataset.index = String(i);
      cc.forEach(col => {
        const c = H('div', 'gsx-c' + (isNum(col) ? ' num' : ''));
        c.style.width = (col._w || col._f) + 'px';
        if (col.type === 'gate' && col.get(row)) {
          const g = col.get(row);
          c.innerHTML = `<span class="gsx-gate">${Array.from({ length: g.total }, (_, k) =>
            `<i class="${k < g.clear ? 'y' : ''}"></i>`).join('')}</span> ${g.clear}/${g.total}`;
          c.title = g.why.map(x => `${x.label}: ${x.value}`).join('\n');
        } else {
          const t = cellText(col, row);
          c.textContent = t;
          if (t === 'not held') { c.classList.add('nil'); c.title = whyNil(col, row); }
          else if (col.id === 'name') c.title = `#${row.n.bus_id} · ${row.n.county || ''}, ${row.n.state}`;
          else if (col.id === 'zone' && ZFIX[String(row.n.bus_id)] && ZFIX[String(row.n.bus_id)] !== row.n.zone) {
            c.classList.add('fixed');
            c.title = `Corrected: the operator's pnode zone_id says ${t}; the substation sheet says ${row.n.zone || '—'}`;
          } else if (col.type === 'text') c.title = t;
        }
        el.appendChild(c);
      });
      el.onclick = () => { cursor = i; selectBus(row.n.bus_id); panTo(row.n.bus_id); };
      frag.appendChild(el);
    }
    gRows.appendChild(frag);
    const filtered = total !== ROWS.length;
    gCount.textContent = `${fmt.int(total)}${filtered ? ` of ${fmt.int(ROWS.length)}` : ''} rows`
      + ` · ${GS.FUELS[SCOPE.fuel].label} ${fmt.int(SCOPE.size)} MW · ${SCOPE.caseObj.label}`
      + ` · ${cc.length} columns${custom ? '' : ' (fuel defaults)'}`;
  }

  /* ── 6.7 · the column chooser ────────────────────────────────────────────
     A popover on <body>, not inside the dock: the grid dock is 220 px tall and
     clips its children, and a 106-row chooser needs the screen above it. Left,
     the shown set in order, dragged to reorder; right, the whole registry by
     family, searchable, each row with its unit, its measured coverage across
     the buses in scope, and a tag when it is another fuel's read or excluded
     for this one. Every change persists at once to `gs.grid.cols.v1`. */
  function openChooser() {
    if (!chooser) {
      chooser = H('div', 'gsx-chooser');
      chooser.setAttribute('data-gsx', 'columns-menu');
      chooser.setAttribute('role', 'dialog');
      chooser.setAttribute('aria-label', 'Choose grid columns');
      chooser.hidden = true;
      chooser.addEventListener('click', e => e.stopPropagation());
      chooser.addEventListener('keydown', e => { if (e.key === 'Escape') { closeChooser(); if (chooserBtn) chooserBtn.focus(); } e.stopPropagation(); });
      document.body.appendChild(chooser);
      document.addEventListener('click', () => closeChooser());
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && chooser && !chooser.hidden) closeChooser(); });
      window.addEventListener('resize', () => { if (chooser && !chooser.hidden) placeChooser(); });
    }
    chooser.hidden = false;
    if (chooserBtn) chooserBtn.setAttribute('aria-expanded', 'true');
    renderChooser();
    placeChooser();
    const q = chooser.querySelector('[data-gsx="col-search"]');
    if (q) q.focus({ preventScroll: true });
  }
  function closeChooser() {
    if (!chooser || chooser.hidden) return;
    chooser.hidden = true;
    if (chooserBtn) chooserBtn.setAttribute('aria-expanded', 'false');
  }
  /** Above the Columns button when there is room (the grid is at the bottom of
   *  the screen), below it otherwise; never wider than the window. */
  function placeChooser() {
    if (!chooser || !chooserBtn) return;
    const r = chooserBtn.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(680, vw - 16);
    chooser.style.width = w + 'px';
    chooser.style.left = Math.max(8, Math.min(vw - w - 8, r.right - w)) + 'px';
    const above = r.top - 14, below = vh - r.bottom - 14;
    if (above >= 280 || above >= below) {
      chooser.style.top = ''; chooser.style.bottom = (vh - r.top + 6) + 'px';
      chooser.style.maxHeight = Math.max(200, Math.min(620, above)) + 'px';
    } else {
      chooser.style.bottom = ''; chooser.style.top = (r.bottom + 6) + 'px';
      chooser.style.maxHeight = Math.max(200, Math.min(620, below)) + 'px';
    }
  }
  const covText = cv => !cv ? '' : cv.share >= 0.995 ? '100%' : cv.share < 0.1 ? `${(100 * cv.share).toFixed(1)}%` : `${Math.round(100 * cv.share)}%`;

  function renderChooser() {
    if (!chooser) return;
    const fuel = SCOPE.fuel;
    const keepAll = chooser.querySelector('.all'), keepSh = chooser.querySelector('.sh ol');
    const scAll = keepAll ? keepAll.scrollTop : 0, scSh = keepSh ? keepSh.scrollTop : 0;
    const hadFocus = document.activeElement && document.activeElement.getAttribute('data-gsx') === 'col-search';
    chooser.innerHTML = '';

    const head = H('div', 'hd');
    head.appendChild(H('b', null, 'Columns'));
    const vis = cols();
    head.appendChild(H('span', 'n', `${vis.length} shown · ${REG.length} in the registry · ${custom ? 'customised' : `${fuelWord(fuel)} defaults`}`));
    head.appendChild(H('span', 'sp'));
    const reset = H('button', 'gsx-btn', 'Reset to fuel defaults');
    reset.setAttribute('data-gsx', 'cols-reset');
    reset.title = `Show the sixteen ${fuelWord(fuel)} defaults again, and follow the fuel from now on.`;
    reset.onclick = () => resetCols();
    head.appendChild(reset);
    const x = H('button', 'gsx-btn', 'Close');
    x.onclick = () => closeChooser();
    head.appendChild(x);
    chooser.appendChild(head);

    const q = H('input', 'q');
    q.type = 'search'; q.placeholder = 'Search columns — name, source key or family';
    q.value = chooserQ;
    q.setAttribute('data-gsx', 'col-search');
    q.oninput = () => { chooserQ = q.value; renderChooser(); };
    chooser.appendChild(q);

    const body = H('div', 'bd');
    /* left · the shown set, in order */
    const sh = H('div', 'sh');
    sh.appendChild(H('div', 'cap', 'Shown · drag to reorder'));
    const ol = H('ol');
    vis.forEach((c, idx) => {
      const li = H('li');
      li.draggable = true;
      li.tabIndex = 0;
      li.setAttribute('data-gsx-shown', c.id);
      li.title = 'Drag to reorder · Alt+↑ / Alt+↓ moves it';
      li.innerHTML = `<i class="grip" aria-hidden="true">⋮⋮</i><span>${esc(labelOf(c))}</span><em>${esc(c.unit)}</em>`;
      const rm = H('button', 'rm', '×');
      rm.title = `Remove ${labelOf(c)}`;
      rm.setAttribute('aria-label', `Remove ${labelOf(c)}`);
      rm.onclick = () => setShown(shown.filter(k => k !== c.id));
      li.appendChild(rm);
      li.addEventListener('dragstart', e => { dragId = c.id; li.classList.add('drag'); try { e.dataTransfer.setData('text/plain', c.id); e.dataTransfer.effectAllowed = 'move'; } catch (err) { /* no transfer */ } });
      li.addEventListener('dragend', () => { dragId = null; li.classList.remove('drag'); });
      li.addEventListener('dragover', e => {
        if (!dragId || dragId === c.id) return;
        e.preventDefault();
        const b = li.getBoundingClientRect();
        li.classList.toggle('before', e.clientY < b.top + b.height / 2);
        li.classList.toggle('after', e.clientY >= b.top + b.height / 2);
      });
      li.addEventListener('dragleave', () => li.classList.remove('before', 'after'));
      li.addEventListener('drop', e => {
        e.preventDefault();
        const id = dragId || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
        li.classList.remove('before', 'after');
        if (!id || id === c.id) return;
        const b = li.getBoundingClientRect();
        const after = e.clientY >= b.top + b.height / 2;
        const rest = shown.filter(k => k !== id);
        const at = rest.indexOf(c.id) + (after ? 1 : 0);
        dragId = null;
        moveCol(id, at);
      });
      li.addEventListener('keydown', e => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        e.preventDefault();
        const from = shown.indexOf(c.id);
        moveCol(c.id, from + (e.key === 'ArrowUp' ? -1 : 1));
        const again = chooser.querySelector(`[data-gsx-shown="${c.id}"]`); if (again) again.focus();
      });
      ol.appendChild(li);
    });
    sh.appendChild(ol);
    body.appendChild(sh);

    /* right · the registry, by family */
    const all = H('div', 'all');
    const needle = chooserQ.trim().toLowerCase();
    let listed = 0;
    FAMILIES.forEach(fam => {
      const members = REG.filter(c => c.family === fam && (!needle
        || `${labelOf(c)} ${c.id} ${c.source} ${c.family} ${c.unit}`.toLowerCase().indexOf(needle) >= 0));
      if (!members.length) return;
      const g = H('div', 'fam');
      g.setAttribute('data-gsx-family', fam);
      g.appendChild(H('div', 'cap', `${fam} · ${members.length}`));
      members.forEach(c => {
        listed++;
        const hid = hiddenFor(c, fuel);
        const l = H('label', 'opt' + (hid ? ' off' : ''));
        const cb = H('input'); cb.type = 'checkbox';
        cb.checked = shown.includes(c.id) && !hid;
        cb.disabled = hid;
        cb.setAttribute('data-gsx-col', c.id);
        cb.onchange = () => setShown(cb.checked ? shown.concat([c.id]) : shown.filter(k => k !== c.id));
        l.appendChild(cb);
        l.appendChild(H('span', 'lb', labelOf(c)));
        l.appendChild(H('em', 'un', c.unit));
        const tag = hid ? `not for ${fuelWord(fuel)}` : !servesFuel(c, fuel) ? 'other fuel' : '';
        if (tag) l.appendChild(H('small', 'tag', tag));
        const cv = COVER.get(c.id);
        const cov = H('span', 'cov' + (cv && !c.state && cv.share < 0.5 ? ' sparse' : ''), c.state ? 'state' : covText(cv));
        cov.setAttribute('data-gsx-cov', c.id);
        l.appendChild(cov);
        l.title = [`${labelOf(c)}${c.unit ? ` (${c.unit})` : ''} · ${c.family}`, `Source: ${c.source}`, c.hint || '',
          c.state ? 'Reflects the workspace (pins, evidence), not the dataset.'
            : cv ? `Held at ${fmt.int(cv.n)} of ${fmt.int(cv.total)} buses at this scope` : '',
          hid ? `Hidden for ${fuelWord(fuel)}: ${c.hideWhy || 'the storage columns carry this read'}` : ''].filter(Boolean).join('\n');
        g.appendChild(l);
      });
      all.appendChild(g);
    });
    if (!listed) all.appendChild(H('div', 'none', `No column matches “${chooserQ}”.`));
    body.appendChild(all);
    chooser.appendChild(body);

    const nall = chooser.querySelector('.all'), nsh = chooser.querySelector('.sh ol');
    if (nall) nall.scrollTop = scAll;
    if (nsh) nsh.scrollTop = scSh;
    if (hadFocus) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  /** Arrow keys move the cursor at once; the app-wide selection follows on a
   *  short debounce, so holding the key does not put a full repaint between
   *  every row. */
  let keyTimer = null;
  function onGridKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
    if (!VIEWR.length) return;
    if (e.key === 'Enter') {
      if (cursor >= 0) { selectBus(VIEWR[cursor].n.bus_id); panTo(VIEWR[cursor].n.bus_id); }
      e.preventDefault(); return;
    }
    e.preventDefault();
    const sel = selectedBus();
    if (cursor < 0) cursor = Math.max(0, VIEWR.findIndex(r => r.n.bus_id === sel));
    cursor = Math.max(0, Math.min(VIEWR.length - 1, cursor + (e.key === 'ArrowDown' ? 1 : -1)));
    scrollTo(cursor);
    paintGrid(true);
    clearTimeout(keyTimer);
    keyTimer = setTimeout(() => {
      const r = VIEWR[cursor]; if (!r) return;
      selectBus(r.n.bus_id); panTo(r.n.bus_id);
    }, 160);
  }

  /* Bring row i out from under the sticky header, not merely inside the box:
     the header covers the first `headH()` px of the body, so a row scrolled to
     the literal top of the scroller would be hidden behind it. */
  function scrollTo(i) {
    if (!gBody) return;
    const y = i * ROW_H;
    const h = Math.max(ROW_H, gBody.clientHeight - headH());
    if (y < gBody.scrollTop) gBody.scrollTop = y;
    else if (y + ROW_H > gBody.scrollTop + h) gBody.scrollTop = y + ROW_H - h;
  }

  /* ⌘F / Ctrl-F focuses the grid's own name filter rather than the browser find:
     the thing a reader wants to find here is a bus, and the browser's find would
     only search the ~20 rows the virtualiser has in the DOM. */
  document.addEventListener('keydown', e => {
    if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f') return;
    const input = gHead && gHead.querySelector('[data-gsx-filter]');
    if (!input) return;
    e.preventDefault(); e.stopPropagation();
    input.focus(); input.select();
  }, true);

  /* ═══ 5b · the siting layers — KPIs, ramps, surfaces, presets ════════════

     Built 2026-09-26 on Ganesh's ask: "the heat map colours are light blue,
     which is not clear… the user should be able to see rank and LMP heat maps,
     headroom and many other KPIs." What the section adds, and the rules it keeps:

     · COLOUR BY and SIZE BY are independent, over a KPI catalogue that is the
       grid's own column registry (§6.1) — a map KPI names a registry column, so
       the map and the grid read one number and a legend click can filter both.
     · Every KPI is CLASSED, 5–7 bins, quantile / equal / natural breaks, the bin
       edges printed. Sequential KPIs take a viridis-class ramp (grid, rank) or an
       inferno-class ramp (price); diverging KPIs a blue–orange ramp centred on 0;
       categorical KPIs the CA palette's four CVD-separable hues. Every ramp is a
       per-theme token in 31-map-grid.css, validated in studio/MAP-LAYERS.md §3.
     · Four VIEWS: points, a heat surface (kernel-weighted average of the buses),
       zones (nearest-bus regions coloured by zone median — derived, and the
       legend says so) and hex bins (median per hex). BIVARIATE takes two KPIs on
       a 3 × 3 palette for "where headroom meets price".
     · PRESETS set KPI + view + layers in one click and follow the scope's fuel
       until the reader picks one.
     · Missing stays missing: a bus with no value is a hollow grey ring, a hex
       with no value is an outline, a zone with none is left unshaded. Never 0.

     The pure geometry — class breaks, the kernel surface, the nearest-bus
     raster, hex binning — is `MC`, below, with no DOM and no
     GS, so it is tested on its own (MAP-LAYERS.md §6). */
  const MC = (function () {
    'use strict';
  
    // 1. breaks
    function breaks(values, n, method) {
      const finite = values.filter(v => Number.isFinite(v));
      if (finite.length === 0) return [];
      const sorted = finite.slice().sort((a, b) => a - b);
      const min = sorted[0], max = sorted[sorted.length - 1];
      if (min === max) return [min, max];
      const m = sorted.length;
      if (method === 'equal') {
        const edges = new Array(n + 1);
        edges[0] = min;
        edges[n] = max;
        for (let i = 1; i < n; i++) edges[i] = min + i * (max - min) / n;
        return edges;
      }
      if (method === 'quantile') {
        const edges = [min];
        for (let i = 1; i < n; i++) {
          const idx = Math.round(i * (m - 1) / n);
          edges.push(sorted[idx]);
        }
        edges.push(max);
        let j = 1;
        for (let i = 1; i < edges.length; i++) {
          if (edges[i] > edges[j - 1]) edges[j++] = edges[i];
        }
        edges.length = j;
        return edges;
      }
      // jenks
      let sample = sorted;
      if (m > 600) {
        sample = [];
        const step = (m - 1) / 599;
        for (let i = 0; i < 600; i++) {
          sample.push(sorted[Math.round(i * step)]);
        }
      }
      const k = Math.min(n, sample.length);
      const dp = Array.from({ length: sample.length }, () => new Array(k).fill(Infinity));
      const cuts = Array.from({ length: sample.length }, () => new Array(k).fill(-1));
      const sums = Array(sample.length + 1).fill(0);
      const sumsq = Array(sample.length + 1).fill(0);
      for (let i = 0; i < sample.length; i++) {
        sums[i + 1] = sums[i] + sample[i];
        sumsq[i + 1] = sumsq[i] + sample[i] * sample[i];
      }
      for (let i = 0; i < sample.length; i++) {
        const mean = (sums[i + 1] - sums[0]) / (i + 1);
        dp[i][0] = sumsq[i + 1] - sumsq[0] - (i + 1) * mean * mean;
      }
      for (let c = 1; c < k; c++) {
        for (let i = c; i < sample.length; i++) {
          let best = Infinity, bestCut = -1;
          for (let j = c - 1; j < i; j++) {
            const mean = (sums[i + 1] - sums[j + 1]) / (i - j);
            const sse = sumsq[i + 1] - sumsq[j + 1] - (i - j) * mean * mean;
            const val = dp[j][c - 1] + sse;
            if (val < best) {
              best = val;
              bestCut = j;
            }
          }
          dp[i][c] = best;
          cuts[i][c] = bestCut;
        }
      }
      const edges = [min];
      let idx = sample.length - 1;
      for (let c = k - 1; c > 0; c--) {
        const cut = cuts[idx][c];
        if (cut < 0) break;
        edges.push((sample[cut] + sample[cut + 1]) / 2);
        idx = cut;
      }
      edges.push(max);
      edges.sort((a, b) => a - b);
      let j = 1;
      for (let i = 1; i < edges.length; i++) {
        if (edges[i] > edges[j - 1]) edges[j++] = edges[i];
      }
      edges.length = j;
      return edges;
    }
  
    // 2. divBreaks
    function divBreaks(values, n, method) {
      let k = n;
      if (k % 2 === 0) k++;
      const finite = values.filter(v => Number.isFinite(v));
      const abs = finite.map(v => Math.abs(v));
      let M = 0; for (let i = 0; i < abs.length; i++) if (abs[i] > M) M = abs[i];
      if (!(M > 0)) M = 1;
      const half = (k - 1) / 2;
      let pos = [];
      if (method === 'equal') {
        for (let j = 1; j <= half; j++) {
          pos.push(M * (2 * j - 1) / k);
        }
        pos.push(M);
      } else if (method === 'quantile') {
        /* The centre class is the smallest 1/k of |v| — or, when zeros alone are
           at least that share (congestion: 2,332 of 2,678 buses are exactly 0),
           exactly the zeros, cut at half the smallest non-zero |v|. The arms then
           split what lies beyond the centre into equal-count classes. */
        const nz = abs.filter(v => v > 0).sort((a, b) => a - b);
        const zeroShare = abs.length ? (abs.length - nz.length) / abs.length : 0;
        let e1 = nz.length ? nz[Math.round((nz.length - 1) / k)] : M / k;
        if (zeroShare >= 1 / k) e1 = nz.length ? nz[0] / 2 : M / k;
        pos.push(e1);
        const rest = nz.filter(v => v > e1);
        for (let j = 1; j < half; j++) pos.push(rest.length ? rest[Math.round(j * (rest.length - 1) / half)] : M * (2 * j + 1) / k);
        pos.push(M);
        pos.sort((a, b) => a - b);
        let j = 1;
        for (let i = 1; i < pos.length; i++) {
          if (pos[i] > pos[j - 1]) pos[j++] = pos[i];
        }
        pos.length = j;
      } else {
        // jenks fallback
        const edges = breaks(abs, half + 1, 'jenks');
        if (edges.length > 1) {
          pos = edges.slice(1, -1);
          pos.push(M);
        } else {
          for (let j = 1; j <= half; j++) pos.push(M * (2 * j - 1) / k);
          pos.push(M);
        }
      }
      while (method !== 'quantile' && pos.length < half + 1) {
        const j = pos.length;
        pos.push(M * (2 * j - 1) / k);
      }
      pos.sort((a, b) => a - b);
      const last = pos[pos.length - 1];
      if (last < M) pos[pos.length - 1] = M;
      const edges = [];
      for (let i = pos.length - 1; i >= 0; i--) edges.push(-pos[i]);
      for (let i = 0; i < pos.length; i++) edges.push(pos[i]);
      return edges;
    }
  
    // 3. classOf
    function classOf(v, edges) {
      if (!Number.isFinite(v) || edges.length < 2) return -1;
      if (v < edges[0]) return 0;
      if (v >= edges[edges.length - 1]) return edges.length - 2;
      let lo = 0, hi = edges.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (v < edges[mid]) hi = mid;
        else lo = mid;
      }
      return lo;
    }
  
    // 4. median
    function median(arr) {
      const finite = arr.filter(v => Number.isFinite(v));
      if (finite.length === 0) return null;
      const sorted = finite.slice().sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
  
    // 5. kernelGrid
    function kernelGrid(xs, ys, vs, grid, sigma, radius, mode) {
      const { x0, y0, cell, nx, ny } = grid;
      const n = nx * ny;
      const val = new Float32Array(n);
      const w = new Float32Array(n);
      const sigma2 = 2 * sigma * sigma;
      const r2 = radius * radius;
      for (let idx = 0; idx < xs.length; idx++) {
        const v = vs[idx];
        if (!Number.isFinite(v)) continue;
        const px = (xs[idx] - x0) / cell, py = (ys[idx] - y0) / cell;
        const pix = Math.floor(px), piy = Math.floor(py);
        const minx = Math.max(pix - radius, 0);
        const maxx = Math.min(pix + radius, nx - 1);
        const miny = Math.max(piy - radius, 0);
        const maxy = Math.min(piy + radius, ny - 1);
        for (let cy = miny; cy <= maxy; cy++) {
          const dy = cy - py;
          const dy2 = dy * dy;
          const ky = Math.exp(-dy2 / sigma2);
          const row = cy * nx;
          for (let cx = minx; cx <= maxx; cx++) {
            const dx = cx - px;
            const d2 = dx * dx + dy2;
            if (d2 > r2) continue;
            const kx = Math.exp(-dx * dx / sigma2);
            const k = kx * ky;
            const pos = row + cx;
            w[pos] += k;
            val[pos] += k * v;
          }
        }
      }
      if (mode === 'mean') {
        for (let i = 0; i < n; i++) {
          val[i] = w[i] ? val[i] / w[i] : 0;
        }
      }
      return { val, w };
    }
  
    // 6. nearestGrid
    function nearestGrid(xs, ys, grid, maxCells) {
      const { x0, y0, cell, nx, ny } = grid;
      const n = nx * ny;
      const best = new Float32Array(n).fill(Infinity);
      const idxArr = new Int32Array(n).fill(-1);
      const maxDist = maxCells * maxCells;
      for (let pi = 0; pi < xs.length; pi++) {
        const px = (xs[pi] - x0) / cell, py = (ys[pi] - y0) / cell;
        const pix = Math.floor(px), piy = Math.floor(py);
        const minx = Math.max(pix - maxCells, 0);
        const maxx = Math.min(pix + maxCells, nx - 1);
        const miny = Math.max(piy - maxCells, 0);
        const maxy = Math.min(piy + maxCells, ny - 1);
        for (let cy = miny; cy <= maxy; cy++) {
          const dy = cy - py;
          const dy2 = dy * dy;
          const row = cy * nx;
          for (let cx = minx; cx <= maxx; cx++) {
            const dx = cx - px;
            const d2 = dx * dx + dy2;
            if (d2 > maxDist) continue;
            const pos = row + cx;
            if (d2 < best[pos]) {
              best[pos] = d2;
              idxArr[pos] = pi;
            }
          }
        }
      }
      return idxArr;
    }
  
    // 7. hexbin
    const SQRT3 = Math.sqrt(3), THIRD = 1 / 3, TWO_THIRD = 2 / 3;
    function hexbin(xs, ys, vs, size) {
      const map = new Map();
      for (let idx = 0; idx < xs.length; idx++) {
        const x = xs[idx], y = ys[idx];
        let q = (SQRT3 * THIRD * x - THIRD * y) / size;
        let r = (TWO_THIRD * y) / size;
        const s = -q - r;
        let qi = Math.round(q), ri = Math.round(r), si = Math.round(s);
        const dq = Math.abs(qi - q), dr = Math.abs(ri - r), ds = Math.abs(si - s);
        if (dq > dr && dq > ds) qi = -ri - si;
        else if (dr > ds) ri = -qi - si;
        const key = `${qi},${ri}`;
        const entry = map.get(key);
        if (entry) {
          entry.idx.push(idx);
        } else {
          map.set(key, { q: qi, r: ri, idx: [idx] });
        }
      }
      const bins = [];
      for (const [key, bin] of map) {
        const held = bin.idx.filter(i => Number.isFinite(vs[i])).length;
        const fvals = bin.idx.map(i => vs[i]).filter(v => Number.isFinite(v));
        bins.push({
          q: bin.q,
          r: bin.r,
          cx: size * SQRT3 * (bin.q + bin.r / 2),
          cy: size * 1.5 * bin.r,
          n: bin.idx.length,
          held,
          median: median(fvals),
          idx: bin.idx
        });
      }
      bins.sort((a, b) => a.r - b.r || a.q - b.q);
      return bins;
    }
  
    // 8. hexCorners
    function hexCorners(cx, cy, size) {
      const corners = [];
      for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 6 + i * Math.PI / 3;
        corners.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
      }
      return corners;
    }
  
    return { breaks, divBreaks, classOf, median, kernelGrid, nearestGrid, hexbin, hexCorners };
  })();

  /* ── 5b.2 · colour: tokens, Lab interpolation ────────────────────────────
     Every ramp is seven stops declared per theme in 31-map-grid.css and
     validated there (studio/MAP-LAYERS.md §3). Five and six bins are sampled
     from the same seven stops in CIELAB, so the lightness steps stay even and no
     raw hex is invented at a use site. */
  /* a token may be #hex or rgb()/rgba() — the canvas needs the three channels */
  const hexRgb = h => {
    const t = String(h || '').trim(), m = t.match(/^rgba?\(([^)]+)\)/i);
    if (m) return m[1].split(',').slice(0, 3).map(x => Math.round(parseFloat(x)) || 0);
    const s = t.replace('#', ''), f = s.length === 3 ? s.split('').map(x => x + x).join('') : s;
    return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16) || 0);
  };
  const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const fLab = t => t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29;
  function rgbLab(rgb) {
    const [r, g, b] = rgb.map(toLin);
    const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047, Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
      Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    const fx = fLab(X), fy = fLab(Y), fz = fLab(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function labHex([Lv, a, b]) {
    const fy = (Lv + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
    const inv = t => t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29);
    const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
    const lin = [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
    const gm = c => { c = Math.max(0, Math.min(1, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
    return '#' + lin.map(c => Math.round(gm(c) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  /** n colours from a seven-stop token ramp, evenly spaced in CIELAB. */
  function rampColours(kind, n) {
    const stops = TOK[kind] || TOK.seq;
    if (n === stops.length) return stops.map(s => s.toUpperCase());
    const labs = stops.map(s => rgbLab(hexRgb(s)));
    return Array.from({ length: n }, (_, i) => {
      const x = n === 1 ? (labs.length - 1) / 2 : i * (labs.length - 1) / (n - 1);
      const j = Math.min(labs.length - 2, Math.floor(x)), f = x - j;
      return labHex(labs[j].map((v, k) => v + (labs[j + 1][k] - v) * f));
    });
  }

  /* ── 5b.3 · the KPI catalogue — the grid's registry, read by the map ──────
     A map KPI names a registry column and adds only what a map needs: its
     group in the selector, which ramp grammar it takes, and whether it inverts
     (rank 1 is the most salient). So the map and the grid read one number. */
  const MKPI = [];
  const KGROUPS = ['Rank', 'Price', 'Grid', 'Storage & fuel', 'Load', 'Queue & land', 'Data quality', 'Categories'];
  function K(id, group, ramp, o) { MKPI.push(Object.assign({ id, col: id, group, ramp }, o)); }
  K('score', 'Rank', 'seq', { topN: true });
  K('rank', 'Rank', 'seq', { invert: true, topN: true });
  PB_YEARS.forEach(y => K(`lmp${y}_pb`, 'Price', 'warm', { price: y }));
  /* the registry's lmp_2030 column reads GS.priceAt through ext/76, so the layer is the one basis */
  K('lmp_2030', 'Price', 'warm', { label: 'LMP 2030', price: 2030, alias: 'lmp2030_pb' });
  K('basis', 'Price', 'div'); K('cong', 'Price', 'div'); K('hneg', 'Price', 'warm'); K('std', 'Price', 'warm');
  K('run_gap', 'Price', 'div');
  K('hr', 'Grid', 'seq', { cap: HR_CAP });
  ['hr_sp_dis', 'hr_sh_dis', 'hr_sp_chg', 'hr_sh_chg', 'hr_ll_chg', 'sto_sp_dis', 'sto_sh_dis', 'sto_sh_chg']
    .forEach(id => K(id, 'Grid', 'seq', { cap: HR_CAP }));
  ['pi', 'viol', 'cost100', 'cost250', 'kw100', 'kw250', 'sc'].forEach(id => K(id, 'Grid', 'seq'));
  ['tb2', 'tb4', 'tb8'].forEach(id => K(id, 'Storage & fuel', 'seq'));
  K('cap', 'Storage & fuel', 'seq', { col: f => f === 'wind' ? 'cap_wind' : 'cap_solar' });
  K('curt', 'Storage & fuel', 'seq');
  K('load_cost', 'Load', 'warm'); K('cheap_h', 'Load', 'seq'); K('cheap_share', 'Load', 'seq');
  K('queue_mi', 'Queue & land', 'seq');
  K('clear_ac', 'Queue & land', 'seq');
  K('land_cost', 'Queue & land', 'seq', { badge: 'assumption' });
  K('px_gap', 'Data quality', 'div');
  K('px_src', 'Data quality', 'cat');
  K('zone_fixed', 'Data quality', 'cat', { catOf: v => v ? 'corrected' : null });
  K('demo_syn', 'Data quality', 'cat', { badge: 'synthetic' });
  K('zone', 'Categories', 'cat', { zoneColours: true });
  K('kvc', 'Categories', 'cat', { col: 'kv', label: 'kV class',
    catOf: v => v == null ? null : KV_CLASS[kvClass(v)].label, order: KV_CLASS.map(c => c.label) });
  const MK_BY = new Map(MKPI.map(k => [k.id, k]));
  const colIdOf = k => typeof k.col === 'function' ? k.col(SCOPE.fuel) : k.col;
  const kpiCol = k => k ? REG_BY.get(colIdOf(k)) || null : null;
  const kLabel = k => k.label || (kpiCol(k) ? labelOf(kpiCol(k)) : k.id);
  const kUnit = k => { const c = kpiCol(k); return c ? c.unit : ''; };
  /** Why a KPI cannot be drawn at this scope, or null when it can. */
  function kpiUnavailable(k) {
    if (!k) return 'no such KPI';
    const c = kpiCol(k);
    if (!c) return k.id === 'land_cost'
      ? 'Not on the page: needs GS_DATA_EXT.land_cost_proxy exported from derived.mart_land_cost_proxy'
      : `Not on the page: ${colIdOf(k)}`;
    if (hiddenFor(c, SCOPE.fuel)) return `Not for ${fuelWord(SCOPE.fuel)}: ${c.hideWhy || 'the storage columns carry this read'}`;
    return null;
  }
  const numericKpi = k => k.ramp !== 'cat';

  /* the per-KPI values, one Float64Array per column per scope — NaN is missing */
  const VCACHE = new Map();
  function kpiData(k) {
    const c = kpiCol(k); if (!c || kpiUnavailable(k)) return null;
    const key = `${k.id}|${c.id}|${scopeKey}`;
    if (VCACHE.has(key)) return VCACHE.get(key);
    const N = NODES.length, vals = new Float64Array(N).fill(NaN);
    let cats = null, names = null, held = 0;
    if (k.ramp === 'cat') {
      cats = new Int16Array(N).fill(-1); names = [];
      const ix = new Map(), tally = new Map();
      const raw = new Array(N);
      for (let i = 0; i < N; i++) {
        const r = ROW_BY.get(NODES[i].bus_id); if (!r) continue;
        const v = c.get(r), s = k.catOf ? k.catOf(v) : v;
        if (s == null || s === '') continue;
        raw[i] = String(s); tally.set(raw[i], (tally.get(raw[i]) || 0) + 1);
      }
      names = k.order ? k.order.filter(s => tally.has(s)) : [...tally.keys()].sort((a, b) => tally.get(b) - tally.get(a) || a.localeCompare(b));
      names.forEach((s, j) => ix.set(s, j));
      for (let i = 0; i < N; i++) if (raw[i] != null) { cats[i] = ix.get(raw[i]); held++; }
    } else {
      for (let i = 0; i < N; i++) {
        const r = ROW_BY.get(NODES[i].bus_id); if (!r) continue;
        const v = c.get(r);
        if (v != null && v !== '' && isFinite(v)) { vals[i] = +v; held++; }
      }
    }
    const d = { k, col: c, vals, cats, names, held };
    VCACHE.set(key, d);
    if (VCACHE.size > 80) VCACHE.delete(VCACHE.keys().next().value);
    return d;
  }

  /* ── 5b.4 · view state, persisted ────────────────────────────────────── */
  const MV_KEY = 'gs.mapgrid.view.v1';
  const MV = { preset: null, kpi: 'score', kpi2: 'none', size: 'hr', surface: 'points', method: 'quantile',
    bins: 7, opacity: 0.78, hideOut: false, topN: 25, picked: false, fuel: null };
  try { const raw = localStorage.getItem(MV_KEY); if (raw) Object.assign(MV, JSON.parse(raw), { fuel: null }); }
  catch (e) { /* storage refused — the defaults stand */ }
  const saveMV = () => { try { localStorage.setItem(MV_KEY, JSON.stringify(MV)); } catch (e) { } };
  const SURFACES = [['points', 'Points'], ['heat', 'Heat'], ['choro', 'Zones'], ['hex', 'Hex']];
  const METHODS = [['quantile', 'Quantile'], ['equal', 'Equal interval'], ['jenks', 'Natural breaks']];

  /* ── 5b.5 · presets ───────────────────────────────────────────────────── */
  const PRESETS = [
    { id: 'siting', label: 'Siting overview', kpi: 'score', size: 'hr', surface: 'points', topN: 25,
      hint: 'Score at the scope\'s weights, point size = headroom at the scope case, the top 25 labelled by rank' },
    { id: 'price', label: 'Price', kpi: 'lmp2030_pb', size: 'none', surface: 'heat',
      hint: 'LMP 2030 on the Economics price basis (solved run; sheet where no run, labelled), as a heat surface' },
    { id: 'basis', label: 'Basis', kpi: 'basis', size: 'none', surface: 'points',
      hint: 'Basis vs own zone 2025 on a diverging ramp centred on zero' },
    { id: 'capacity', label: 'Grid capacity', kpi: 'hr', size: 'hr', surface: 'points',
      hint: 'Headroom at the scope case and the fuel\'s direction, on colour and size' },
    { id: 'congestion', label: 'Congestion & constraints', kpi: 'cong', size: 'none', surface: 'points', layers: { constraints: true },
      hint: 'Congestion share of the 2025 price, with the limiting facilities drawn' },
    { id: 'storage', label: 'Storage', kpi: 'tb4', kpi2: f => STORAGE.includes(f) ? 'sto_sh_chg' : 'hr_sh_chg', size: 'none', surface: 'points',
      hint: 'TB4 2030 against shoulder charge headroom — storage is never studied charging at summer peak' },
    { id: 'load', label: 'Load / data centre', kpi: 'load_cost', kpi2: 'hr_ll_chg', size: 'none', surface: 'points',
      hint: 'What a flat load pays against large-load withdrawal headroom' },
    { id: 'queue', label: 'Queue pressure', kpi: 'queue_mi', size: 'none', surface: 'heat', method: 'jenks', layers: { queue: true, retire: true },
      hint: `Queue MW within ${Q_NEAR_MI} miles as a heat surface, with the queue projects by fuel and MW` },
    /* land cost when the exporter publishes it (an assumption: one county band);
       clear acres only as the fallback on a page without GS_DATA_EXT.land_cost_proxy */
    { id: 'land', label: 'Land', kpi: () => kpiUnavailable(MK_BY.get('land_cost')) ? 'clear_ac' : 'land_cost', size: 'none', surface: 'points',
      hint: 'Land cost, $/acre — assumption · one county band (derived.mart_land_cost_proxy). Not a measured price; the map holds one class while every county carries the same band' },
    { id: 'quality', label: 'Data quality', kpi: 'px_gap', size: 'none', surface: 'points', layers: { flags: true },
      hint: 'The sheet against the solved run at 2030, with price anomalies, zone corrections and synthetic values ringed' },
  ];
  const PRESET_BY = new Map(PRESETS.map(p => [p.id, p]));
  const FUEL_PRESET = { solar: 'siting', wind: 'siting', hybrid: 'siting', bess: 'storage', dc: 'load' };
  const PRESET_LAYERS = ['constraints', 'queue', 'retire', 'flags'];

  function applyPreset(id, byReader) {
    const p = PRESET_BY.get(id); if (!p) return false;
    MV.preset = id;
    const at = v => typeof v === 'function' ? v(SCOPE.fuel) : v;
    MV.kpi = at(p.kpi); MV.kpi2 = at(p.kpi2) || 'none'; MV.size = at(p.size); MV.surface = p.surface;
    MV.method = p.method || 'quantile';
    if (p.topN != null) MV.topN = p.topN;
    if (byReader) MV.picked = true;
    PRESET_LAYERS.forEach(k => { LAYERS[k] = !!(p.layers && p.layers[k]) && !layerUnavailable(k); });
    LAYERS.price = true; LAYERS.headroom = true;
    /* a preset KPI this fuel cannot read falls back to the score rather than
       drawing an empty map */
    if (kpiUnavailable(MK_BY.get(MV.kpi))) MV.kpi = 'score';
    if (MV.kpi2 !== 'none' && kpiUnavailable(MK_BY.get(MV.kpi2))) MV.kpi2 = 'none';
    saveMV(); saveLayers();
    syncControls();
    return true;
  }
  /** The preset follows the scope's fuel until the reader picks one. */
  function followFuel() {
    if (MV.fuel === SCOPE.fuel) return;
    MV.fuel = SCOPE.fuel;
    if (!MV.picked) applyPreset(FUEL_PRESET[SCOPE.fuel] || 'siting', false);
    else if (MV.preset) applyPreset(MV.preset, false);          // re-read its fuel-aware KPIs
    else {
      if (kpiUnavailable(MK_BY.get(MV.kpi))) MV.kpi = 'score';
      if (MV.kpi2 !== 'none' && kpiUnavailable(MK_BY.get(MV.kpi2))) MV.kpi2 = 'none';
      if (MV.size !== 'none' && kpiUnavailable(MK_BY.get(MV.size))) MV.size = 'hr';
      syncControls();
    }
  }

  /* ── 5b.6 · the map's filter = the grid's filters ─────────────────────── */
  const INF = new Uint8Array(NODES.length).fill(1);
  let FILTER_SIG = '', filterOn = false;
  function mapFilterChanged(on) {
    filterOn = !!on;
    if (!filterOn) INF.fill(1);
    else { INF.fill(0); VIEWR.forEach(r => { const i = IX.get(r.n.bus_id); if (i != null) INF[i] = 1; }); }
    const sig = filterOn ? cols().map(c => `${c.id}=${FILTERS[c.id] || ''}`).join('&') : '';
    if (sig === FILTER_SIG) return;
    FILTER_SIG = sig;
    if (bctx && W) { drawBase(); paintLegend(); }
  }
  /** Write a filter into the grid, adding its column if it is not on screen —
   *  the grid only filters on columns it shows, so a filter must be visible. */
  function setGridFilter(colId, text) {
    if (!REG_BY.has(colId)) return;
    if (!cols().some(c => c.id === colId)) setShown(shown.concat([colId]), true);
    FILTERS[colId] = text;
    const inp = gHead && gHead.querySelector(`[data-gsx-filter="${colId}"]`);
    if (inp) inp.value = text;
    applyView();
  }
  const edgeText = e => String(+(+e).toPrecision(12));
  /** A legend class, clicked: filter the grid (and so the map) to it; clicking
   *  the active class again clears it. */
  function clickBin(which) {
    const e = encoding(); if (!e || !e.k) return;
    const c1 = kpiCol(e.k);
    const toggle = (id, t) => (FILTERS[id] || '') === t ? '' : t;
    if (which === 'missing') { setGridFilter(c1.id, toggle(c1.id, '-')); return; }
    if (e.biv) {
      const [a, b] = String(which).split(',').map(Number), c2 = kpiCol(e.k2);
      const t1 = binText(e.edges, a), t2 = binText(e.edges2, b);
      const same = (FILTERS[c1.id] || '') === t1 && (FILTERS[c2.id] || '') === t2;
      if (!cols().some(c => c.id === c2.id)) setShown(shown.concat([c2.id]), true);
      FILTERS[c2.id] = same ? '' : t2;
      setGridFilter(c1.id, same ? '' : t1);
      return;
    }
    if (e.cat) { setGridFilter(c1.id, toggle(c1.id, e.k.catOf ? catFilter(e, +which) : `=${e.names[+which]}`)); return; }
    setGridFilter(c1.id, toggle(c1.id, binText(e.edges, e.invert ? e.edges.length - 2 - +which : +which)));
  }
  function binText(edges, i) {
    const top = i >= edges.length - 2;
    return `[${edgeText(edges[i])},${edgeText(edges[i + 1])}${top ? ']' : ')'}`;
  }
  /* a category built from a numeric column (kV class) filters on its range */
  function catFilter(e, j) {
    if (e.k.id === 'kvc') { const f = KV_CLASS.find(c => c.label === e.names[j]); const nx = KV_CLASS[KV_CLASS.indexOf(f) + 1];
      return nx ? `[${f.floor},${nx.floor})` : `>=${f.floor}`; }
    if (e.k.id === 'zone_fixed') return '→';
    return `=${e.names[j]}`;
  }

  /* ── 5b.7 · the encoding: KPI → classes → colour per bus ─────────────── */
  let ENC = null, encKey = '';
  function sizeScale(sk) {
    const d = kpiData(sk); if (!d) return null;
    if (sk.cap) return { d, lo: 0, hi: sk.cap, abs: false };
    const a = []; for (let i = 0; i < d.vals.length; i++) if (d.vals[i] === d.vals[i]) a.push(Math.abs(d.vals[i]));
    if (!a.length) return null;
    a.sort((x, y) => x - y);
    return { d, lo: 0, hi: a[Math.floor(0.98 * (a.length - 1))] || a[a.length - 1] || 1, abs: true };
  }
  function encoding() {
    if (!ROWS.length) return null;
    const key = [MV.kpi, MV.kpi2, MV.size, MV.method, MV.bins, LAYERS.price, LAYERS.headroom,
      scopeKey, FILTER_SIG, TOK.sig].join('|');
    if (ENC && key === encKey) return ENC;
    const t0 = performance.now();
    const N = NODES.length;
    const k = MK_BY.get(MV.kpi) || MK_BY.get('score');
    const k2 = MV.kpi2 && MV.kpi2 !== 'none' ? MK_BY.get(MV.kpi2) : null;
    const e = { key, k, k2: null, biv: false, cat: false, invert: !!k.invert, colours: [TOK.node], col: new Int8Array(N),
      rad: new Float32Array(N), inF: INF, outN: 0, edges: null, edges2: null, names: null, counts: [], missing: 0,
      held: 0, why: kpiUnavailable(k), ramp: k.ramp, size: null, ms: 0 };
    for (let i = 0; i < N; i++) if (!INF[i]) e.outN++;
    const d = e.why ? null : kpiData(k);
    if (!LAYERS.price) e.col.fill(0);
    else if (!d) { e.col.fill(-1); }
    else if (k2 && numericKpi(k) && numericKpi(k2) && !kpiUnavailable(k2)) {
      const d2 = kpiData(k2);
      e.biv = true; e.k2 = k2; e.ramp = 'biv';
      e.edges = MC.breaks(d.vals, 3, MV.method); e.edges2 = MC.breaks(d2.vals, 3, MV.method);
      e.colours = TOK.biv.slice(0, 9).map(s => s.toUpperCase());
      for (let i = 0; i < N; i++) {
        const a = MC.classOf(d.vals[i], e.edges), b = MC.classOf(d2.vals[i], e.edges2);
        e.col[i] = a < 0 || b < 0 ? -1 : b * 3 + a;
      }
      e.held = d.held; e.held2 = d2.held;
    } else if (k.ramp === 'cat') {
      e.cat = true; e.names = d.names;
      /* up to four classes take the CA hues themselves; five to eight take the
         eight-class extension (four hues × two lightness levels) */
      const zc = k.zoneColours ? zoneColours() : null;
      const pal = zc || d.names.length > TOK.cat.length ? TOK.cat8 : TOK.cat;
      e.colours = d.names.map((s, j) => pal[zc && zc[s] != null ? zc[s] : j % pal.length].toUpperCase());
      for (let i = 0; i < N; i++) e.col[i] = d.cats[i];
      e.held = d.held;
    } else {
      e.edges = k.ramp === 'div' ? MC.divBreaks(d.vals, MV.bins % 2 ? MV.bins : MV.bins + 1, MV.method)
        : MC.breaks(d.vals, MV.bins, MV.method);
      const nC = Math.max(1, e.edges.length - 1);
      const ramp = rampColours(k.ramp === 'warm' ? 'warm' : k.ramp === 'div' ? 'div' : 'seq', nC);
      e.colours = e.invert ? ramp.slice().reverse() : ramp;
      for (let i = 0; i < N; i++) e.col[i] = MC.classOf(d.vals[i], e.edges);
      e.held = d.held;
    }
    /* size */
    const sk = LAYERS.headroom && MV.size !== 'none' ? MK_BY.get(MV.size) : null;
    const sc = sk && !kpiUnavailable(sk) ? sizeScale(sk) : null;
    e.size = sc ? { k: sk, hi: sc.hi } : null;
    for (let i = 0; i < N; i++) {
      if (!sc) { e.rad[i] = 2.3; continue; }
      const v = sc.d.vals[i];
      e.rad[i] = v !== v ? NaN : 1.4 + 4.0 * Math.sqrt(Math.max(0, Math.min(1, (sc.abs ? Math.abs(v) : v) / (sc.hi || 1))));
    }
    /* counts per colour among the buses in the filter — what the legend prints */
    e.counts = new Array(e.colours.length).fill(0);
    for (let i = 0; i < N; i++) {
      if (!INF[i]) continue;
      if (e.col[i] >= 0) e.counts[e.col[i]]++; else e.missing++;
    }
    e.ms = +(performance.now() - t0).toFixed(2);
    ENC = e; encKey = key;
    scheduleSurface();
    return e;
  }

  /* ── 5b.8 · surfaces — heat, zones, hex ───────────────────────────────────
     All three are computed in WORLD coordinates once per KPI × scope × filter ×
     classes × theme, cached, and only re-projected on a pan (a drawImage or a
     few hundred hexagons), so the pan budget never pays for them. They are
     computed on a timer after the switch, off the switch's own path: the
     points repaint at once and the surface lands a frame later. */
  const MI_PER_UNIT = 69.05;                          // one degree of latitude, in miles
  const WX = new Float32Array(NODES.length), WY = new Float32Array(NODES.length);
  NODES.forEach((n, i) => { WX[i] = wx(n.lon); WY[i] = wy(n.lat); });
  const G_PAD = 12 / MI_PER_UNIT;
  const GRID0 = (() => {
    const x0 = BOUNDS.x0 - G_PAD, y0 = BOUNDS.y0 - G_PAD;
    const sw = BOUNDS.x1 - BOUNDS.x0 + 2 * G_PAD, sh = BOUNDS.y1 - BOUNDS.y0 + 2 * G_PAD;
    const cell = Math.max(sw, sh) / 320;
    return { x0, y0, cell, nx: Math.ceil(sw / cell), ny: Math.ceil(sh / cell) };
  })();
  const CELL_MI = GRID0.cell * MI_PER_UNIT;
  const HEAT_SIGMA_MI = 5, ZONE_REACH_MI = 25, HEX_ACROSS_MI = 12;
  const HEX_R = HEX_ACROSS_MI / 2 / MI_PER_UNIT;
  let OWNER = null, ZCOL = null;
  /** The nearest bus for every cell inside the network's outline — the convex
   *  hull of the 2,678 buses — and within ZONE_REACH_MI of a bus, so the hull's
   *  chords across open water (the Gulf of Maine) stay empty. Computed once. */
  function owner() {
    if (OWNER) return OWNER;
    const own = MC.nearestGrid(WX, WY, GRID0, Math.round(ZONE_REACH_MI / CELL_MI));
    const pts = NODES.map((n, i) => [WX[i], WY[i]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    pts.forEach(p => { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); });
    pts.slice().reverse().forEach(p => { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); });
    const hull = lo.slice(0, -1).concat(up.slice(0, -1));
    const inside = (x, y) => { let c = false; for (let i = 0, j = hull.length - 1; i < hull.length; j = i++) {
      const [xi, yi] = hull[i], [xj, yj] = hull[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    const { x0, y0, cell, nx, ny } = GRID0;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const p = y * nx + x;
      if (own[p] >= 0 && !inside(x0 + (x + 0.5) * cell, y0 + (y + 0.5) * cell)) own[p] = -1;
    }
    OWNER = own; HULL_N = hull.length;
    return OWNER;
  }
  let HULL_N = 0;
  /** Zone colours: one class each. Eight zones need eight classes and the CA
   *  palette carries four CVD-separable hues, so the eight are those four hues
   *  at two lightness levels (--gsx-cat8-*, validated in MAP-LAYERS.md §3).
   *  Colouring the regions with four hues so that neighbours differ was built
   *  and measured first: the stray buses a zone holds far from the rest of it
   *  (a Maine bus inside Connecticut) make the derived regions border almost
   *  every other zone, and no four-colouring exists. */
  function zoneColours() {
    if (ZCOL) return ZCOL;
    ZCOL = {};
    ANCHORS.slice().sort((a, b) => b.buses - a.buses || String(a.zone).localeCompare(String(b.zone)))
      .forEach((a, i) => { ZCOL[a.zone] = i % 8; });
    return ZCOL;
  }

  let SURF = null, surfTimer = 0, surfWaiters = [];
  const surfKey = () => ENC ? `${ENC.key}|${MV.surface}` : '';
  function scheduleSurface() {
    if (MV.surface === 'points' || !ENC) return;
    if (SURF && SURF.key === surfKey()) return;
    clearTimeout(surfTimer);
    surfTimer = setTimeout(() => {
      guard('surface', () => { computeSurface(); if (bctx && W) { drawBase(); paintLegend(true); } });
      /* a waiter is answered even when the surface threw — the throw is on
         stats().broken, and a promise left hanging would hide it */
      const w = surfWaiters; surfWaiters = []; w.forEach(f => f(SURF));
    }, 0);
  }
  const rgbaOf = hex => { const [r, g, b] = hexRgb(hex); return [r, g, b]; };
  /** the value(s) a region shows: the median of its buses, or the modal
   *  category — over the buses in the filter */
  function regionValue(idx, e, d, d2) {
    const live = idx.filter(i => INF[i]);
    if (!live.length) return { col: -2 };
    if (e.cat) {
      const t = new Map(); live.forEach(i => { const c = d.cats[i]; if (c >= 0) t.set(c, (t.get(c) || 0) + 1); });
      if (!t.size) return { col: -1 };
      return { col: [...t.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] };
    }
    const m = MC.median(live.map(i => d.vals[i]).filter(v => v === v));
    if (m == null) return { col: -1 };
    if (e.biv) {
      const m2 = MC.median(live.map(i => d2.vals[i]).filter(v => v === v));
      if (m2 == null) return { col: -1 };
      return { col: MC.classOf(m2, e.edges2) * 3 + MC.classOf(m, e.edges), v: m, v2: m2 };
    }
    return { col: MC.classOf(m, e.edges), v: m };
  }
  function computeSurface() {
    const e = ENC; if (!e) return;
    const t0 = performance.now();
    const kind = MV.surface, key = surfKey();
    const d = e.why ? null : kpiData(e.k), d2 = e.biv ? kpiData(e.k2) : null;
    const { nx, ny } = GRID0;
    const out = { key, kind, ms: 0, classCounts: new Array(e.colours.length).fill(0), cells: 0, hexes: null, canvas: null, note: '' };
    if (!d || !LAYERS.price) { out.ms = 0; SURF = out; return; }
    if (kind === 'hex') {
      const v = new Float64Array(NODES.length);
      for (let i = 0; i < v.length; i++) v[i] = INF[i] ? 1 : NaN;
      out.hexes = MC.hexbin(WX, WY, v, HEX_R).filter(h => h.held > 0).map(h => {
        const r = regionValue(h.idx, e, d, d2);
        if (r.col >= 0) out.classCounts[r.col]++;
        return { cx: h.cx, cy: h.cy, n: h.held, col: r.col };
      });
      out.cells = out.hexes.length;
    } else {
      const img = new ImageData(nx, ny), px = img.data;
      const pal = e.colours.map(rgbaOf);
      const put = (p, col, a) => { const c = pal[col]; px[p * 4] = c[0]; px[p * 4 + 1] = c[1]; px[p * 4 + 2] = c[2]; px[p * 4 + 3] = a; };
      if (kind === 'choro') {
        const own = owner();
        /* zone → the buses in it, then each zone's value once */
        const members = new Map();
        NODES.forEach((n, i) => { const z = zoneOf(n); if (!z) return; (members.get(z) || members.set(z, []).get(z)).push(i); });
        const zv = new Map([...members].map(([z, idx]) => [z, regionValue(idx, e, d, d2)]));
        out.zones = Object.fromEntries([...zv].map(([z, r]) => [z, r.col]));
        const edge = rgbaOf(TOK.sunk || TOK.border);
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
          const p = y * nx + x, o = own[p]; if (o < 0) continue;
          const z = zoneOf(NODES[o]); const r = zv.get(z); if (!r || r.col < 0) continue;
          const zr = x + 1 < nx && own[p + 1] >= 0 ? zoneOf(NODES[own[p + 1]]) : z;
          const zd = y + 1 < ny && own[p + nx] >= 0 ? zoneOf(NODES[own[p + nx]]) : z;
          if (zr !== z || zd !== z) { px[p * 4] = edge[0]; px[p * 4 + 1] = edge[1]; px[p * 4 + 2] = edge[2]; px[p * 4 + 3] = 235; continue; }
          put(p, r.col, 255); out.classCounts[r.col]++; out.cells++;
        }
      } else {
        /* heat: a Gaussian kernel-weighted average of the buses' values
           (Nadaraya–Watson), σ = 5 mi, faded out where the buses thin out */
        const sig = HEAT_SIGMA_MI / CELL_MI, rad = Math.ceil(3 * sig);
        const mask = arr => { const v = new Float64Array(NODES.length); for (let i = 0; i < v.length; i++) v[i] = INF[i] ? arr[i] : NaN; return v; };
        const W_MIN = 0.2, W_FULL = 0.34;
        if (e.cat) {
          const own = owner();
          const g = MC.kernelGrid(WX, WY, mask(new Float64Array(NODES.length).fill(1)), GRID0, sig, rad, 'mean');
          for (let p = 0; p < nx * ny; p++) {
            const o = own[p]; if (o < 0 || g.w[p] < W_MIN || !INF[o]) continue;
            const col = d.cats[o]; if (col < 0) continue;
            put(p, col, Math.round(255 * Math.min(1, (g.w[p] - W_MIN) / (W_FULL - W_MIN)))); out.classCounts[col]++; out.cells++;
          }
        } else {
          const g = MC.kernelGrid(WX, WY, mask(d.vals), GRID0, sig, rad, 'mean');
          const g2 = e.biv ? MC.kernelGrid(WX, WY, mask(d2.vals), GRID0, sig, rad, 'mean') : null;
          for (let p = 0; p < nx * ny; p++) {
            if (g.w[p] < W_MIN || (g2 && g2.w[p] < W_MIN)) continue;
            const col = e.biv ? MC.classOf(g2.val[p], e.edges2) * 3 + MC.classOf(g.val[p], e.edges) : MC.classOf(g.val[p], e.edges);
            if (col < 0) continue;
            put(p, col, Math.round(255 * Math.min(1, (g.w[p] - W_MIN) / (W_FULL - W_MIN)))); out.classCounts[col]++; out.cells++;
          }
        }
      }
      const cv = document.createElement('canvas');
      cv.width = nx; cv.height = ny;
      cv.getContext('2d').putImageData(img, 0, 0);
      out.canvas = cv;
    }
    out.ms = +(performance.now() - t0).toFixed(1);
    SURF = out;
  }
  function drawSurface(c, e) {
    if (!SURF || SURF.key !== surfKey()) { scheduleSurface(); drawn.surface = { kind: MV.surface, ready: false }; return; }
    const S = SURF;
    c.save();
    c.globalAlpha = MV.opacity;
    if (S.canvas) {
      const x = (GRID0.x0 - view.cx) * view.k + W / 2, y = (GRID0.y0 - view.cy) * view.k + Hh / 2;
      c.imageSmoothingEnabled = S.kind === 'heat';
      c.drawImage(S.canvas, x, y, GRID0.nx * GRID0.cell * view.k, GRID0.ny * GRID0.cell * view.k);
    } else if (S.hexes) {
      const r = HEX_R * view.k;
      for (let b = 0; b < e.colours.length; b++) {
        c.beginPath();
        let any = 0;
        S.hexes.forEach(h => {
          if (h.col !== b) return;
          const cx = (h.cx - view.cx) * view.k + W / 2, cy = (h.cy - view.cy) * view.k + Hh / 2;
          if (cx < -r || cy < -r || cx > W + r || cy > Hh + r) return;
          MC.hexCorners(cx, cy, r).forEach((p, j) => j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
          c.closePath(); any++;
        });
        if (!any) continue;
        c.fillStyle = e.colours[b]; c.fill();
        c.strokeStyle = TOK.sunk; c.lineWidth = 0.8; c.stroke();
      }
      /* a hex whose buses hold no value is outlined, not filled */
      c.beginPath();
      S.hexes.forEach(h => {
        if (h.col !== -1) return;
        const cx = (h.cx - view.cx) * view.k + W / 2, cy = (h.cy - view.cy) * view.k + Hh / 2;
        MC.hexCorners(cx, cy, r * 0.82).forEach((p, j) => j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]));
        c.closePath();
      });
      c.globalAlpha = 0.7; c.strokeStyle = TOK.missing || TOK.node; c.lineWidth = 0.8; c.stroke();
    }
    c.restore();
    drawn.surface = { kind: S.kind, ready: true, cells: S.cells, ms: S.ms };
  }

  /* ── 5b.9 · overlays: limiting facilities, flags, retirements, top N ──── */
  /* The limiting facilities are GS_DATA.iso.top_facilities, written by the
     transfer screen as two exact powerflow bus numbers
     ("115010 NGR_338_NST   345  110756 WOBURN   345  1") — so a facility is drawn
     between the two buses it names, with no name matching at all. */
  const FAC_RX = /^(\d+)\s+(.+?)\s{2,}(\d+(?:\.\d+)?)\s{2,}(\d+)\s+(.+?)\s{2,}(\d+(?:\.\d+)?)\s{2,}(\S+)$/;
  const FACS = (((GS.D.iso || {}).top_facilities) || []).map(f => {
    const m = String(f.facility || '').trim().match(FAC_RX);
    if (!m) return null;
    const a = IX.get(Number(m[1])), b = IX.get(Number(m[4]));
    return { a: a == null ? -1 : a, b: b == null ? -1 : b, n: f.n || 0, label: `${m[2].trim()} ${m[3]} — ${m[5].trim()} ${m[6]} ckt ${m[7]}`,
      loading: f.loading, contingency: f.contingency };
  }).filter(Boolean);
  const FACS_HELD = (((GS.D.iso || {}).top_facilities) || []).length;
  const FAC_MAX = Math.max(1, ...FACS.map(f => f.n));
  function drawConstraints(c) {
    c.save();
    c.strokeStyle = TOK.bind; c.lineCap = 'round'; c.globalAlpha = 0.95;
    FACS.forEach(f => {
      if (f.a < 0 || f.b < 0) return;
      c.lineWidth = 1.6 + 2.8 * Math.sqrt(f.n / FAC_MAX);
      c.beginPath(); c.moveTo(SX[f.a], SY[f.a]); c.lineTo(SX[f.b], SY[f.b]); c.stroke();
      c.beginPath(); c.arc(SX[f.a], SY[f.a], 2.4, 0, 6.2832); c.arc(SX[f.b], SY[f.b], 2.4, 0, 6.2832); c.fillStyle = TOK.bind; c.fill();
      drawn.constraints++;
    });
    c.restore();
  }
  function flagSets() {
    const anom = GS.priceAnomalies && Array.isArray(GS.priceAnomalies.list)
      ? GS.priceAnomalies.list.map(a => a.bus).concat(GS.priceAnomaliesNeighbour && Array.isArray(GS.priceAnomaliesNeighbour.list) ? GS.priceAnomaliesNeighbour.list.map(a => a.bus) : [])
      : NODES.filter(n => { const g = sheetVsRun(n); return g != null && Math.abs(g) > 20; }).map(n => n.bus_id);
    const zone = NODES.filter(n => ZFIX[String(n.bus_id)] && ZFIX[String(n.bus_id)] !== n.zone).map(n => n.bus_id);
    const syn = NODES.filter(n => demoSynthetic(n.bus_id)).map(n => n.bus_id);
    return { anom, zone, syn, anomFrom: GS.priceAnomalies ? 'GS.priceAnomalies (ext/76)' : 'sheet vs run beyond ±20 %' };
  }
  function drawFlags(c) {
    const f = flagSets();
    c.save(); c.lineWidth = 1.3;
    [[f.zone, TOK.flagZone, 7.5, [2, 2]], [f.syn, TOK.flagSyn, 6.5, [1, 2]], [f.anom, TOK.flagAnom, 5, null]].forEach(([ids, col, r, dash]) => {
      c.strokeStyle = col; c.setLineDash(dash || []);
      c.beginPath();
      ids.forEach(id => { const i = IX.get(Number(id)); if (i == null) return; c.moveTo(SX[i] + r, SY[i]); c.arc(SX[i], SY[i], r, 0, 6.2832); drawn.flags++; });
      c.stroke();
    });
    c.restore();
  }
  const RETIRE = (CATHY.retirements || []).filter(r => (r.lat != null || r.latitude != null) && (r.lon != null || r.longitude != null));
  function layerUnavailable(key) {
    if (key === 'retire' && !RETIRE.length) return `Not on the page: the ${fmt.int((CATHY.retirements || []).length)} retirements in GS_DATA_EXT.cathy.retirements carry no coordinates. uni.dim_retirement holds lat/lon for 29 rows; exporting them as cathy.retirements[].lat/.lon would draw them.`;
    return null;
  }
  function drawRetire(c) {
    const mx = Math.max(1, ...RETIRE.map(r => Number(r.mw) || 0));
    c.save(); c.strokeStyle = TOK.ink; c.lineWidth = 1.4; c.globalAlpha = 0.85;
    RETIRE.forEach(r => {
      const [x, y] = toScreen(r.lat != null ? r.lat : r.latitude, r.lon != null ? r.lon : r.longitude);
      const s = 2.5 + 4 * Math.sqrt((Number(r.mw) || 0) / mx);
      c.beginPath(); c.moveTo(x - s, y - s); c.lineTo(x + s, y + s); c.moveTo(x + s, y - s); c.lineTo(x - s, y + s); c.stroke();
      drawn.retire++;
    });
    c.restore();
  }
  let FONT = '';
  function drawTopN(c, e) {
    if (!e.k.topN || !(MV.topN > 0) || !LAYERS.price) return;
    if (!FONT) FONT = (getComputedStyle(document.documentElement).getPropertyValue('--sans') || 'sans-serif').trim();
    const top = ROWS.filter(r => r.rank != null && r.rank <= MV.topN).sort((a, b) => a.rank - b.rank);
    c.save();
    c.font = `600 9px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle';
    /* every top-N bus gets its ring; its number is placed at the first of four
       corners that collides with no number already placed, in rank order, so
       rank 1 is never the one crowded out. A number with no free corner is
       left off (counted) — the ring still marks the bus, and the hover names it. */
    const placed = [];
    const hit = (x, y, w) => placed.some(p => x < p[0] + p[2] && x + w > p[0] && y < p[1] + 11 && y + 11 > p[1]);
    drawn.topNUnlabelled = 0;
    top.forEach(r => {
      const i = IX.get(r.n.bus_id); if (i == null || !INF[i]) return;
      const x = SX[i], y = SY[i];
      if (x < -10 || y < -10 || x > W + 10 || y > Hh + 10) return;
      c.strokeStyle = TOK.ink; c.lineWidth = 1.1; c.globalAlpha = 0.9;
      c.beginPath(); c.arc(x, y, 6.2, 0, 6.2832); c.stroke();
      drawn.topN++;
      const t = String(r.rank), w = Math.max(11, c.measureText(t).width + 5);
      const spot = [[x + 6, y - 13], [x - 6 - w, y - 13], [x + 6, y + 2], [x - 6 - w, y + 2]].find(([lx, ly]) => !hit(lx, ly, w));
      if (!spot) { drawn.topNUnlabelled++; return; }
      placed.push([spot[0], spot[1], w]);
      c.globalAlpha = 0.92; c.fillStyle = TOK.sunk;
      c.fillRect(spot[0], spot[1], w, 11);
      c.globalAlpha = 1; c.fillStyle = TOK.ink; c.fillText(t, spot[0] + w / 2, spot[1] + 5.5);
    });
    c.restore();
  }

  function fitFiltered() {
    const pts = [];
    for (let i = 0; i < NODES.length; i++) if (INF[i]) pts.push([WX[i], WY[i]]);
    if (!pts.length) { A.toast('No bus is left by the grid filters.'); return; }
    if (pts.length === 1) { view.cx = pts[0][0]; view.cy = pts[0][1]; view.k = Math.max(view.k, Math.min(W, Hh) / 0.9); project(); }
    else fit(pts);
    userMoved = true;
    drawBase(); paintLabels();
  }

  /* ── 5b.10 · the hover rows for the active KPIs ────────────────────────── */
  function fmtK(k, v) {
    const c = kpiCol(k);
    if (v == null || v !== v) return 'not held';
    if (k.ramp === 'cat') return String(v);
    const u = c.unit ? ` ${c.unit}` : '';
    return (c.type === 'int' ? fmt.int(v) : fmt.num(v, c.dp)) + u;
  }
  /** The price-basis mark a price row carries in the hover: the source, and the
   *  anomaly (own-bus or neighbour) named — price-basis 2026-09-27. */
  function pxMark(n, y) {
    const p = priceBasis(n, y); if (!p) return null;
    const a = p.anomaly;
    if (a && a.neighbour) return `sheet (no run) · data anomaly (neighbour): the run at ${a.neighbour.name || 'bus'} ${a.neighbour.bus} reads $${a.run.toFixed(2)}`;
    if (a) return `solved run · data anomaly (sheet $${a.sheet.toFixed(2)})`;
    return p.source === 'sheet' ? 'sheet (no run)' : (SRC_WORD[p.source] || p.source);
  }
  function hoverKpis(busId) {
    const e = ENC; if (!e) return [];
    const i = IX.get(busId), r = ROW_BY.get(busId); if (i == null || !r) return [];
    const out = [];
    const row = (k, main) => {
      const c = kpiCol(k); if (!c) return;
      const v = c.get(r);
      const vv = k.ramp === 'cat' ? (k.catOf ? k.catOf(v) : v) : v;
      const pm = k.price && k.price > 2026 && v != null ? pxMark(r.n, k.price) : null;
      const src = pm ? ` · ${pm}` : c.srcOf && v != null ? ` · ${c.srcOf(r)}` : '';
      out.push([kLabel(k), fmtK(k, vv) + src, main && e.col[i] >= 0 ? e.colours[e.col[i]] : null]);
    };
    row(e.k, true);
    if (e.k2) row(e.k2, false);
    /* headroom at the scope is already a base row of the card */
    if (e.size && e.size.k.id !== e.k.id && e.size.k.id !== 'hr') row(e.size.k, false);
    if (e.col[i] >= 0 && !e.cat) out.push(['Class', e.biv ? `${['low', 'mid', 'high'][e.col[i] % 3]} × ${['low', 'mid', 'high'][Math.floor(e.col[i] / 3)]}` : `${e.col[i] + 1} of ${e.colours.length}`, null]);
    if (!INF[i]) out.push(['Grid filter', 'outside', null]);
    return out;
  }

  /* ── 5b.11 · the legend ─────────────────────────────────────────────────── */
  let kLegend = null, legendKey = '';
  const swatch = (col, cls) => `<i class="sw${cls ? ' ' + cls : ''}"${col
    ? ` style="${cls === 'tri' || cls === 'ring' ? 'color' : 'background'}:${col}"` : ''}></i>`;
  function fmtEdge(k, v) { const c = kpiCol(k); return c && c.type === 'int' ? fmt.int(Math.round(v)) : fmt.num(v, c ? Math.min(2, c.dp) : 2); }
  function paintLegend(force) {
    if (!kLegend) return;
    const e = encoding();
    const lk = [e ? e.key : '', MV.surface, SURF ? SURF.key : '', LAYERS.queue, LAYERS.constraints, LAYERS.flags, LAYERS.retire,
      MV.hideOut, JSON.stringify(FILTERS)].join('#');
    if (!force && lk === legendKey) return;
    legendKey = lk;
    if (!e) { kLegend.innerHTML = ''; return; }
    const k = e.k, c = kpiCol(k), H0 = [];
    const unit = kUnit(k);
    const badge = k.badge === 'assumption' ? '<span class="bdg asm" title="A stated assumption band, not a measurement">assumption</span>'
      : k.badge === 'synthetic' || (k.price && window.GSXDemo && window.GSXDemo.active) ? '<span class="bdg syn" title="The Demo data toggle is on: synthetic values fill gaps and are not evidence">synthetic</span>' : '';
    H0.push(`<div class="lh"><b>${esc(kLegend ? (e.biv ? `${kLabel(k)} × ${kLabel(e.k2)}` : kLabel(k)) : '')}</b>${!e.biv && unit ? `<span class="u">${esc(unit)}</span>` : ''}${badge}</div>`);
    if (!LAYERS.price) {
      H0.push('<div class="ls">colour is off — the "colour" layer below turns it back on</div>');
    } else if (e.why) {
      H0.push(`<div class="ls why" data-gsx="kpi-why">${esc(e.why)}</div>`);
    } else {
      const tot = ROWS.length;
      H0.push(`<div class="ls" data-gsx="kpi-held">held at ${fmt.int(e.held)} of ${fmt.int(tot)} buses${e.biv ? ` · ${fmt.int(e.held2)} for the second` : ''}`
        + `${e.cat ? '' : ` · ${METHODS.find(m => m[0] === MV.method)[1].toLowerCase()} classes`}</div>`);
      /* an assumption drawn at one value is one band, not a finding: say so */
      if (k.badge === 'assumption' && !e.biv && !e.cat && e.edges && e.edges.length && e.edges[0] === e.edges[e.edges.length - 1])
        H0.push('<div class="ls" data-gsx="kpi-oneband">assumption · one county band — every held county carries the same stated value, so the map holds one class</div>');
      if (k.price && k.price > 2026) {
        let solved = 0, sheet = 0;
        ROWS.forEach(r => { const p = priceBasis(r.n, k.price); if (!p) return; if (p.source === 'sheet') sheet++; else solved++; });
        H0.push(`<div class="ls" data-gsx="price-split">${fmt.int(solved)} solved run · ${fmt.int(sheet)} sheet · no run${typeof GS.priceAt === 'function' ? '' : ' (price basis not loaded: solved run only)'}</div>`);
      }
      if (e.biv) {
        const cell = (a, b) => {
          const j = b * 3 + a, on = FILTERS[c.id] === binText(e.edges, a) && FILTERS[kpiCol(e.k2).id] === binText(e.edges2, b);
          return `<button type="button" class="bc${on ? ' on' : ''}" data-gsx-bin="${a},${b}" title="${esc(kLabel(k))} ${['low', 'mid', 'high'][a]} · ${esc(kLabel(e.k2))} ${['low', 'mid', 'high'][b]} — ${fmt.int(e.counts[j])} buses. Click to filter the grid and the map to it." style="background:${e.colours[j]}"><span>${fmt.int(e.counts[j])}</span></button>`;
        };
        const rows = [2, 1, 0].map(b => `<div class="br">${[0, 1, 2].map(a => cell(a, b)).join('')}</div>`).join('');
        const ed = (k1, E) => `${fmtEdge(k1, E[0])} · ${fmtEdge(k1, E[1])} · ${fmtEdge(k1, E[2])} · ${fmtEdge(k1, E[3])}`;
        H0.push(`<div class="biv" data-gsx="biv-legend"><div class="ya">${esc(kLabel(e.k2))} ↑</div><div class="bg">${rows}</div><div class="xa">${esc(kLabel(k))} →</div></div>`);
        H0.push(`<div class="ls edges" data-gsx="biv-edges">${esc(kLabel(k))} ${esc(kUnit(k))}: ${ed(k, e.edges)}<br>${esc(kLabel(e.k2))} ${esc(kUnit(e.k2))}: ${ed(e.k2, e.edges2)}</div>`);
      } else if (e.cat) {
        H0.push('<div class="bins">' + e.names.map((s, j) => `<button type="button" class="bin" data-gsx-bin="${j}" title="Click to filter the grid and the map to ${esc(s)}">${swatch(e.colours[j])}<span class="rg">${esc(s)}</span><span class="kc">${fmt.int(e.counts[j])}</span></button>`).join('') + '</div>');
        if (k.zoneColours) H0.push('<div class="ls">eight classes: the CA palette’s four hues at two lightness levels</div>');
      } else {
        const rows = [];
        for (let j = e.edges.length - 2; j >= 0; j--) {
          const ci = e.invert ? e.edges.length - 2 - j : j;
          const t = binText(e.edges, j), on = FILTERS[c.id] === t;
          rows.push(`<button type="button" class="bin${on ? ' on' : ''}" data-gsx-bin="${ci}" data-gsx-edges="${edgeText(e.edges[j])},${edgeText(e.edges[j + 1])}" title="Click to filter the grid and the map to ${t}">${swatch(e.colours[ci])}<span class="rg">${fmtEdge(k, e.edges[j])} – ${fmtEdge(k, e.edges[j + 1])}</span><span class="kc">${fmt.int(e.counts[ci])}</span></button>`);
        }
        H0.push(`<div class="bins" data-gsx="bins">${rows.join('')}</div>`);
        if (k.ramp === 'div') H0.push('<div class="ls">diverging, centred on 0 — the middle class straddles zero</div>');
        if (e.invert) H0.push('<div class="ls">rank 1 is drawn most prominent</div>');
      }
      H0.push(`<button type="button" class="bin miss" data-gsx-bin="missing" title="Buses with no value: drawn as hollow grey rings, never as the bottom of the ramp. Click to filter the grid to them.">${swatch(null, 'hollow')}<span class="rg">no value</span><span class="kc" data-gsx="missing-count">${fmt.int(e.missing)}</span></button>`);
      if (e.outN) H0.push(`<div class="ls" data-gsx="out-of-filter">${fmt.int(e.outN)} buses outside the grid filters · ${MV.hideOut ? 'hidden' : 'faded'}</div>`);
    }
    if (e.size) H0.push(`<div class="ls">size = ${esc(kLabel(e.size.k))} 0–${fmtEdge(e.size.k, e.size.hi)} ${esc(kUnit(e.size.k))}${e.size.k.cap ? ' (study cap)' : ' (98th percentile)'}</div>`);
    const surfNote = {
      heat: `Heat · kernel-weighted average of bus values, σ ${HEAT_SIGMA_MI} mi · smoothed, not a measured field`,
      choro: `Zones · each point inside the buses' outline takes its nearest bus's zone (within ${ZONE_REACH_MI} mi) · derived from bus positions, not official zone boundaries · colour = zone median`,
      hex: `Hex · ${HEX_ACROSS_MI} mi across · colour = median of the buses in the hex`,
    }[MV.surface];
    if (surfNote) H0.push(`<div class="ls sn" data-gsx="surface-note">${esc(surfNote)}${SURF && SURF.key === surfKey() ? '' : ' · computing…'}</div>`);
    if (LAYERS.queue) H0.push('<div class="sub">queue projects · size = MW</div>' + QFUEL.map((g, j) => `<div class="r">${swatch(`var(--gsx-cat-${g.cat + 1})`, 'tri')}<span>${esc(g.label)}</span><span class="kc">${fmt.int(Q_COUNT[j])}</span></div>`).join(''));
    if (LAYERS.constraints) {
      const drawnF = FACS.filter(f => f.a >= 0 && f.b >= 0).length;
      H0.push(`<div class="sub" data-gsx="constraints-legend">${swatch('var(--gsx-bind)', 'line')}limiting facilities · ${fmt.int(drawnF)} of ${fmt.int(FACS_HELD)} rows drawn</div>`
        + `<div class="ls">top_facilities, width = buses limited by it; ${fmt.int(FACS_HELD - FACS.length)} row(s) name no facility</div>`);
    }
    if (LAYERS.flags) {
      const f = flagSets();
      H0.push(`<div class="sub" data-gsx="flags-legend">data flags</div>`
        + `<div class="r">${swatch('var(--gsx-flag-anom)', 'ring')}<span>price anomaly · sheet vs run &gt; ±20 % (own bus or neighbour)</span><span class="kc">${fmt.int(f.anom.length)}</span></div>`
        + `<div class="r">${swatch('var(--gsx-flag-zone)', 'ring')}<span>zone corrected</span><span class="kc">${fmt.int(f.zone.length)}</span></div>`
        + `<div class="r">${swatch('var(--gsx-flag-syn)', 'ring')}<span>synthetic (demo)</span><span class="kc">${fmt.int(f.syn.length)}</span></div>`);
    }
    kLegend.innerHTML = H0.join('');
    kLegend.querySelectorAll('[data-gsx-bin]').forEach(b => { b.onclick = ev => { ev.stopPropagation(); guard('layers', () => clickBin(b.getAttribute('data-gsx-bin'))); }; });
  }

  /* ── 5b.12 · presets row and the view controls ──────────────────────────── */
  let presetBar = null, ctlBox = null;
  function presetRow() {
    presetBar = H('div', 'gsx-presets');
    presetBar.setAttribute('data-gsx', 'presets');
    presetBar.setAttribute('role', 'toolbar');
    presetBar.setAttribute('aria-label', 'Map view presets');
    PRESETS.forEach(p => {
      const b = H('button', 'gsx-chip', p.label);
      b.type = 'button';
      b.setAttribute('data-gsx-preset', p.id);
      b.title = p.hint;
      b.onclick = () => guard('layers', () => { setPreset(p.id); });
      presetBar.appendChild(b);
    });
    return presetBar;
  }
  const optList = (sel, pick, withNone) => {
    /* naming 2026-09-27: an alias layer (the same reader under a second id) is listed only while it is the one in use, so no select shows one measure twice */
    const groups = KGROUPS.map(g => [g, MKPI.filter(k => k.group === g && pick(k) && !(k.alias && MV.kpi !== k.id && MV.kpi2 !== k.id && MV.size !== k.id))]).filter(x => x[1].length);
    sel.innerHTML = (withNone ? `<option value="none">${esc(withNone)}</option>` : '') + groups.map(([g, ks]) =>
      `<optgroup label="${esc(g)}">${ks.map(k => { const why = kpiUnavailable(k);
        return `<option value="${k.id}"${why ? ` disabled title="${esc(why)}"` : ''}>${esc(kLabel(k))}${kUnit(k) ? ` · ${esc(kUnit(k))}` : ''}${why ? ' — not held' : ''}</option>`; }).join('')}</optgroup>`).join('');
  };
  function viewControls() {
    ctlBox = H('div', 'gsx-ctl');
    ctlBox.setAttribute('data-gsx', 'view-controls');
    const field = (label, el, cls) => { const l = H('label', 'f' + (cls ? ' ' + cls : '')); l.appendChild(H('span', null, label)); l.appendChild(el); ctlBox.appendChild(l); return l; };
    const sK = H('select'); sK.setAttribute('data-gsx', 'kpi'); sK.onchange = () => guard('layers', () => setKpi(sK.value));
    field('Colour by', sK);
    const sK2 = H('select'); sK2.setAttribute('data-gsx', 'kpi2'); sK2.onchange = () => guard('layers', () => setKpi2(sK2.value));
    field('Bivariate', sK2);
    const sS = H('select'); sS.setAttribute('data-gsx', 'size'); sS.onchange = () => guard('layers', () => setSize(sS.value));
    field('Size by', sS);
    const seg = (name, items, on) => {
      const s = H('div', 'seg'); s.setAttribute('data-gsx', name); s.setAttribute('role', 'group');
      items.forEach(([v, l]) => { const b = H('button', null, l); b.type = 'button'; b.setAttribute(`data-gsx-${name}`, v); b.onclick = () => guard('layers', () => on(v)); s.appendChild(b); });
      ctlBox.appendChild(s); return s;
    };
    seg('surface', SURFACES, v => setSurface(v));
    const row = H('div', 'crow');
    const m = H('div', 'seg'); m.setAttribute('data-gsx', 'method'); m.setAttribute('role', 'group');
    METHODS.forEach(([v, l]) => { const b = H('button', null, l); b.type = 'button'; b.setAttribute('data-gsx-method', v); b.onclick = () => guard('layers', () => setMethod(v)); m.appendChild(b); });
    const bins = H('select'); bins.setAttribute('data-gsx', 'bins'); bins.title = 'Number of classes';
    bins.innerHTML = [5, 6, 7].map(n => `<option value="${n}">${n}</option>`).join('');
    bins.onchange = () => guard('layers', () => setBins(Number(bins.value)));
    row.appendChild(m); row.appendChild(bins); ctlBox.appendChild(row);
    const op = H('input'); op.type = 'range'; op.min = '0.2'; op.max = '1'; op.step = '0.05'; op.setAttribute('data-gsx', 'opacity');
    op.oninput = () => guard('layers', () => setOpacity(Number(op.value)));
    field('Opacity', op, 'op');
    const hl = H('label', 'gsx-lay');
    const hc = H('input'); hc.type = 'checkbox'; hc.setAttribute('data-gsx', 'hide-out');
    hc.onchange = () => guard('layers', () => setHideOut(hc.checked));
    hl.appendChild(hc); hl.appendChild(H('span', null, 'Hide out-of-filter buses'));
    ctlBox.appendChild(hl);
    const tn = H('input'); tn.type = 'number'; tn.min = '0'; tn.max = '100'; tn.step = '5'; tn.setAttribute('data-gsx', 'topn');
    tn.onchange = () => guard('layers', () => setTopN(Number(tn.value)));
    field('Top labels', tn, 'tn');
    syncControls();
    return ctlBox;
  }
  function syncControls() {
    if (presetBar) presetBar.querySelectorAll('[data-gsx-preset]').forEach(b => b.setAttribute('aria-pressed', b.getAttribute('data-gsx-preset') === MV.preset ? 'true' : 'false'));
    if (!ctlBox) return;
    const q = s => ctlBox.querySelector(s);
    optList(q('[data-gsx="kpi"]'), () => true);
    optList(q('[data-gsx="kpi2"]'), numericKpi, 'one KPI');
    optList(q('[data-gsx="size"]'), numericKpi, 'uniform');
    q('[data-gsx="kpi"]').value = MV.kpi; q('[data-gsx="kpi2"]').value = MV.kpi2 || 'none'; q('[data-gsx="size"]').value = MV.size;
    q('[data-gsx="kpi2"]').disabled = !numericKpi(MK_BY.get(MV.kpi) || {});
    ctlBox.querySelectorAll('[data-gsx-surface]').forEach(b => b.setAttribute('aria-pressed', b.getAttribute('data-gsx-surface') === MV.surface ? 'true' : 'false'));
    ctlBox.querySelectorAll('[data-gsx-method]').forEach(b => b.setAttribute('aria-pressed', b.getAttribute('data-gsx-method') === MV.method ? 'true' : 'false'));
    q('[data-gsx="bins"]').value = String(MV.bins);
    q('[data-gsx="opacity"]').value = String(MV.opacity);
    q('.f.op').style.display = MV.surface === 'points' ? 'none' : '';
    q('[data-gsx="hide-out"]').checked = !!MV.hideOut;
    q('[data-gsx="topn"]').value = String(MV.topN);
    q('.f.tn').style.display = (MK_BY.get(MV.kpi) || {}).topN ? '' : 'none';
    if (stage) stage.querySelectorAll('[data-gsx-layer]').forEach(cb => { cb.checked = !!LAYERS[cb.getAttribute('data-gsx-layer')]; });
  }
  /** every setter ends here: re-encode, redraw, re-legend, and time it */
  function commit(manual) {
    if (manual) { MV.preset = null; MV.picked = true; }
    saveMV(); syncControls();
    const t0 = performance.now();
    encoding(); drawBase(); paintLabels(); paintLegend(true);
    return +(performance.now() - t0).toFixed(2);
  }
  function setPreset(id) { const t0 = performance.now(); if (!applyPreset(id, true)) return null; commit(false); return +(performance.now() - t0).toFixed(2); }
  function setKpi(id) {
    const k = MK_BY.get(id); if (!k || kpiUnavailable(k)) return null;
    const t0 = performance.now();
    MV.kpi = id; if (!numericKpi(k)) MV.kpi2 = 'none';
    commit(true);
    return +(performance.now() - t0).toFixed(2);
  }
  function setKpi2(id) { MV.kpi2 = id && MK_BY.has(id) && !kpiUnavailable(MK_BY.get(id)) ? id : 'none'; return commit(true); }
  function setSize(id) { MV.size = id && MK_BY.has(id) && !kpiUnavailable(MK_BY.get(id)) ? id : 'none'; if (MV.size !== 'none') LAYERS.headroom = true; saveLayers(); return commit(true); }
  function setSurface(s) { if (!SURFACES.some(x => x[0] === s)) return null; MV.surface = s; return commit(true); }
  function setMethod(m) { if (!METHODS.some(x => x[0] === m)) return null; MV.method = m; return commit(false); }
  function setBins(n) { MV.bins = Math.max(5, Math.min(7, Math.round(n) || 7)); return commit(false); }
  function setOpacity(o) { MV.opacity = Math.max(0.2, Math.min(1, +o || 0.78)); saveMV(); drawBase(); return MV.opacity; }
  function setHideOut(b) { MV.hideOut = !!b; SURF = null; encKey = ''; return commit(false); }
  function setTopN(n) { MV.topN = Math.max(0, Math.min(100, Math.round(n) || 0)); return commit(false); }

  /* ═══ 7 · syncing with the host ══════════════════════════════════════════ */

  /** Pins and evidence are the workspace, not the dataset: they move on any
   *  paint, so they are re-read every sync rather than frozen into the rows. */
  function workspaceState() {
    PINS = new Set((A.state.pins || []).map(Number));
    countEvidence();
  }

  function sync() {
    attach();
    readTokens();
    SCOPE = A.ctx();
    guard('grid', workspaceState);
    /* the fuel moved: its defaults replace the set unless the reader made the
       set their own, in which case it stays and only the fuel's exclusions
       (storage never sees a summer-peak-charge column) apply */
    if (SCOPE.fuel !== shownFuel) {
      shownFuel = SCOPE.fuel;
      if (!custom) shown = defaultsFor(SCOPE.fuel);
      if (!cols().some(c => c.id === sortKey)) { sortKey = 'score'; sortDir = -1; }
    }
    /* the price basis (ext/76) and the demo toggle (ext/70) change what a
       price column reads, so either moving re-reads the rows */
    const demoOn = !!(window.GSXDemo && window.GSXDemo.active);
    const key = `${SCOPE.fuel}|${SCOPE.size}|${SCOPE.case}|${JSON.stringify(A.weightsFor(SCOPE.fuel))}`
      + `|${typeof GS.priceAt === 'function'}|${demoOn}`;
    if (key !== scopeKey) {
      scopeKey = key;
      guard('rows', rebuildRows);
      guard('grid', buildHead);
      if (chooser && !chooser.hidden) guard('grid', renderChooser);
    }
    guard('layers', followFuel);
    if (resize()) refit();
    // the map selection highlights the row, and brings it into view
    const sel = selectedBus();
    if (sel != null) {
      const i = VIEWR.findIndex(r => r.n.bus_id === sel);
      if (i >= 0 && i !== cursor) { cursor = i; scrollTo(i); }
    }
    guard('grid', () => paintGrid(true));
    guard('map', () => { drawBase(); paintLabels(); });
    guard('layers', () => paintLegend());
  }

  /* The host calls exactly one Views.* per paint, so wrapping them is a per-paint
     hook that needs no edit to app.js and no MutationObserver. */
  ['stage', 'portfolio', 'compare', 'mine', 'market', 'all', 'dashboard'].forEach(k => {
    const orig = Views && Views[k];
    if (typeof orig !== 'function') return;
    Views[k] = function (host, c) {
      const out = orig.apply(this, arguments);
      requestAnimationFrame(() => { try { sync(); } catch (e) { console.warn('[mapgrid] sync: ' + e.message); } });
      return out;
    };
  });

  /* ═══ 8 · boot and the test surface ══════════════════════════════════════ */

  function boot() {
    mapPane = guard('map', buildMap);
    gridPane = guard('grid', buildGrid);
    attach();
    resize();
    fitAll();
    SCOPE = A.ctx();
    shownFuel = SCOPE.fuel;
    if (!custom) shown = defaultsFor(SCOPE.fuel);
    guard('grid', workspaceState);
    guard('rows', rebuildRows);
    guard('grid', buildHead);
    guard('layers', followFuel);
    guard('map', () => { drawBase(); paintLabels(); });
    guard('layers', () => paintLegend(true));
    raf = requestAnimationFrame(tick);
  }

  window.GSMapGrid = {
    onDrawUnder(fn) { UNDER.push(fn); drawBase(); }, // basemap hook
    LAYERS, COLUMNS,
    select: selectBus,
    panTo, fitSelection,
    fitAll() { fitAll(); drawBase(); paintLabels(); },
    setLayer(k, v) {
      LAYERS[k] = !!v; saveLayers();
      const cb = stage && stage.querySelector(`[data-gsx-layer="${k}"]`);
      if (cb) cb.checked = !!v;
      drawBase(); paintLabels();
    },
    setFilter(col, text) {
      FILTERS[col] = text;
      const i = gHead && gHead.querySelector(`[data-gsx-filter="${col}"]`);
      if (i) i.value = text;
      applyView();
      return VIEWR.length;
    },
    /* the column registry, for the gate — plain data, no functions */
    registry: () => REG.map(c => ({ id: c.id, label: labelOf(c), unit: c.unit, family: c.family, source: c.source,
      type: c.type, sort: c.sort, fuels: c.fuels, hideFor: c.hideFor.slice(), scope: !!c.scope, state: !!c.state })),
    families: FAMILIES.slice(),
    defaults: fuel => defaultsFor(fuel || SCOPE.fuel),
    shown: () => cols().map(c => c.id),
    custom: () => custom,
    setShown: ids => setShown(ids, true),
    resetCols,
    moveCol,
    coverage: () => Object.fromEntries([...COVER].map(([k, v]) => [k, Object.assign({}, v)])),
    /** a column's value at a bus, and the reason when there is none */
    value(id, busId) {
      const c = REG_BY.get(id), r = ROWS.find(x => x.n.bus_id === Number(busId));
      if (!c || !r) return null;
      const v = c.get(r);
      return { value: c.type === 'gate' ? (v ? `${v.clear}/${v.total}` : null) : v,
               text: cellText(c, r), why: v == null ? whyNil(c, r) : null };
    },
    /** a column's values in the grid's current (filtered, sorted) order */
    viewValues(id) {
      const c = REG_BY.get(id); if (!c) return null;
      return VIEWR.map(r => { const v = c.get(r); return c.type === 'gate' ? (v ? v.clear : null) : v; });
    },
    openChooser, closeChooser,
    /* ── the siting layers (§5b) ── */
    presets: () => PRESETS.map(p => ({ id: p.id, label: p.label, kpi: typeof p.kpi === 'function' ? p.kpi(SCOPE.fuel) : p.kpi, kpi2: (typeof p.kpi2 === 'function' ? p.kpi2(SCOPE.fuel) : p.kpi2) || 'none', size: p.size, method: p.method || 'quantile',
      surface: p.surface, layers: Object.assign({}, p.layers || {}) })),
    kpis: () => MKPI.map(k => ({ id: k.id, col: colIdOf(k), label: kLabel(k), unit: kUnit(k), group: k.group,
      ramp: k.ramp, invert: !!k.invert, why: kpiUnavailable(k) })),
    setPreset, setKpi, setKpi2, setSize, setSurface, setMethod, setBins, setOpacity, setHideOut, setTopN,
    /** the hover card's KPI rows at one bus, as the pointer would show them (price-basis marks included) */
    hoverRows: busId => { encoding(); return hoverKpis(Number(busId)).map(r => [r[0], r[1]]); },
    clickBin: which => { clickBin(which); return VIEWR.length; },
    /** resolves once the current view's surface is computed (at once for points) */
    whenSurface: () => new Promise(res => {
      encoding();
      if (MV.surface === 'points' || (SURF && SURF.key === surfKey())) res(SURF);
      else { surfWaiters.push(res); scheduleSurface(); }
    }),
    core: MC,
    layers: () => {
      const e = encoding();
      return {
        preset: MV.preset, kpi: MV.kpi, kpi2: MV.kpi2, size: MV.size, surface: MV.surface, method: MV.method,
        bins: MV.bins, opacity: MV.opacity, hideOut: MV.hideOut, topN: MV.topN, picked: MV.picked,
        ramp: e ? e.ramp : null, colours: e ? e.colours.slice() : [], edges: e && e.edges ? e.edges.slice() : null,
        edges2: e && e.edges2 ? e.edges2.slice() : null, counts: e ? e.counts.slice() : [], missing: e ? e.missing : 0,
        held: e ? e.held : 0, outOfFilter: e ? e.outN : 0, invert: e ? e.invert : false, cat: e ? e.cat : false,
        biv: e ? e.biv : false, names: e && e.names ? e.names.slice() : null, why: e ? e.why : null,
        colourCol: e ? (kpiCol(e.k) || {}).id || null : null, colourCol2: e && e.k2 ? (kpiCol(e.k2) || {}).id : null,
        classOfBus: e ? Object.fromEntries(NODES.map((n, i) => [n.bus_id, e.col[i]])) : {},
        encodeMs: e ? e.ms : null,
        surfaceState: SURF ? { kind: SURF.kind, current: SURF.key === surfKey(), cells: SURF.cells, ms: SURF.ms,
          classCounts: SURF.classCounts.slice(), zones: SURF.zones || null, hexes: SURF.hexes ? SURF.hexes.length : 0 } : null,
        drawnClassCounts: (drawn.classCounts || []).slice(),
        facilities: { held: FACS_HELD, parsed: FACS.length, drawable: FACS.filter(f => f.a >= 0 && f.b >= 0).length },
        flags: (() => { const f = flagSets(); return { anom: f.anom.length, zone: f.zone.length, syn: f.syn.length, anomFrom: f.anomFrom }; })(),
        grid: { nx: GRID0.nx, ny: GRID0.ny, cellMi: +CELL_MI.toFixed(3) },
        retire: { held: (CATHY.retirements || []).length, geo: RETIRE.length, why: layerUnavailable('retire') },
        queueGroups: QFUEL.map((g, j) => ({ key: g.key, label: g.label, n: Q_COUNT[j] })),
        zoneColours: ZCOL ? Object.assign({}, ZCOL) : null,
      };
    },
    stats: () => ({
      buses: NODES.length,
      branches: BRANCHES.length,
      branchesInMeta: COV.network_branches == null ? null : COV.network_branches,
      zoneAnchors: ANCHORS.length,
      queue: QUEUE.length,
      drawn: Object.assign({}, drawn),
      rows: ROWS.length,
      visibleRows: VIEWR.length,
      domRows: gRows ? gRows.querySelectorAll('.gsx-r').length : 0,
      rowHeight: ROW_H,
      selected: selectedBus(),
      cursor,
      distinctCoords: DISTINCT_COORDS,
      fallbackDocks: ownDocks,
      broken: Object.assign({}, broken),
      view: { k: view.k, cx: view.cx, cy: view.cy },
      priceRange: priceRange(),
    }),
    /** Screen coordinates of a bus, in the page's own frame — so a test can put a
     *  real mouse click on it rather than calling the selection API. */
    xyOf(busId) {
      const i = IX.get(Number(busId)); if (i == null || !stage) return null;
      const r = stage.getBoundingClientRect();
      return { x: r.left + SX[i], y: r.top + SY[i], inView: SX[i] >= 0 && SY[i] >= 0 && SX[i] <= W && SY[i] <= Hh };
    },
    /** Pan the map N frames and report the frame times — the 60 fps claim,
     *  measured on the machine it is claimed on rather than asserted. */
    panBench(frames) {
      const n = frames || 90;
      const times = [];
      const k0 = view.cx;
      for (let i = 0; i < n; i++) {
        const t = performance.now();
        view.cx += 0.004 * (i % 2 ? 1 : -1) * (1 + (i % 7));
        project(); drawBase(); paintLabels();
        times.push(performance.now() - t);
      }
      view.cx = k0; project(); drawBase(); paintLabels();
      times.sort((a, b) => a - b);
      const mean = times.reduce((a, b) => a + b, 0) / times.length;
      return { frames: n, meanMs: +mean.toFixed(2), medianMs: +times[Math.floor(n / 2)].toFixed(2),
               p95Ms: +times[Math.floor(n * 0.95)].toFixed(2), maxMs: +times[n - 1].toFixed(2),
               fpsAtMean: +(1000 / mean).toFixed(1), fpsAtP95: +(1000 / times[Math.floor(n * 0.95)]).toFixed(1) };
    },
    sync,
  };

  boot();
  // A module loaded after the host has painted needs one repaint to be decorated.
  const appEl = document.getElementById('app');
  if (appEl && appEl.children.length) A.render();
})();
