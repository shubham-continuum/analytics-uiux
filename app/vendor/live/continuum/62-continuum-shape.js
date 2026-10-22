/* VENDORED from live Studio ext/62-continuum-shape.js (snapshot 2026-10-11, sha256 7019c92f27a94816).
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/continuum/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   ext: 62-continuum-shape.js — the LMP Continuum's Shape and Assumptions panels (continuum S1-S3 2026-10-06).

   Dossier: design/10-build-slices.md S1 · S2 · S3 · 03 W3 · 05-ui (wireframes §Shape/§Assumptions, screen-states)
   · 08 A3–A7 · D-001 (no feature dropped; history beside forecast on every view) · D-002 (proxies reach every
   forecast chart) · D-009 (API-first). Registered through GSContinuum.register (ext/59, S0); no line of ext/59 or
   ext/60 is edited. Build log: design/build-logs/S1-S3-ui.md.

   cs-pvg      Price vs generation (#2), on Shape. Hour-of-day price (LMP, or energy / congestion / loss) against the
               generation shape for the asset's fuel, settled year beside each run the strip selects. The shape is
               named on every chart ("unit at this node" / the run's fleet / ISO-NE system metered); curtailment
               (offered − dispatched on committed hours) is stacked over dispatch where the run holds it.
   cs-capture  Capture by year (#7), on Shape. Node · zone · hub, settled 2021–26 → solved runs. The headline is the
               HOURLY capture (Σ shape_h × LMP_h ÷ Σ shape_h over every hour); the hour-of-day approximation the
               API also serves overstates it and is never on the face.
   cs-assume   Run assumptions (#9), on Assumptions. One row per assumption, one column per run, every row with its
               source and vintage; what neither :5034 nor this build carries is written "not served", never filled.

   Data: GET /api/v2/continuum/{price-vs-generation, capture, status} through GSContinuum.api (one request per
   answer; failures are never cached here, so the next paint asks again) and the embedded cathy block. A proxy
   scenario is sent as `scenario=` on run reads only — the server scales; settled history is never sent one.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  const C = root.GSContinuum, A = root.App, GS = root.GS;
  if (!C || typeof C.register !== 'function' || !A || !GS) { console.warn('[continuum-shape] GSContinuum or the host app is absent — module idle'); return; }
  const fmt = GS.fmt;

  /* ── helpers ───────────────────────────────────────────────────────────── */
  const H = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
  const SV = (t, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', t);
    if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    return n;
  };
  const tok = name => {
    const s = getComputedStyle(document.getElementById('app') || document.body).getPropertyValue(name).trim();
    return s || '#888888';
  };
  const uniq = a => [...new Set(a)];
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const money = v => isNum(v) ? fmt.money(v, 2) : '—';
  const pct = (v, dp = 1) => isNum(v) ? `${fmt.num(v * 100, dp)} %` : '—';
  const r2 = (v, dp) => isNum(v) ? +v.toFixed(dp) : null;
  /** 1 / 2 / 5 × 10ⁿ ticks over [lo, hi] (SKL-091 nice ticks) */
  function nice(lo, hi, n) {
    if (!isNum(lo) || !isNum(hi)) { lo = 0; hi = 1; }
    if (hi - lo < 1e-9) { const d = Math.abs(hi) > 1 ? Math.abs(hi) * 0.1 : 1; lo -= d; hi += d; }
    const raw = (hi - lo) / (n || 5), p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    const step = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    const ticks = []; for (let v = a; v <= b + step * 1e-6; v += step) ticks.push(+v.toFixed(10));
    return { lo: a, hi: b, ticks };
  }

  /* ── the embedded block ────────────────────────────────────────────────── */
  const EXT = () => root.GS_DATA_EXT || {};
  const CATHY = () => EXT().cathy || null;
  const META = () => (CATHY() || {}).meta || {};
  const scenRow = id => (META().scenarios || []).find(s => s.id === id) || null;
  const runIds = () => (META().scenarios || []).filter(s => s.held && s.id !== 'hist').map(s => s.id);
  const runYear = id => { const s = scenRow(id); return s ? s.target_year : null; };
  /** "PROBE 5-year 2028" · "PCR 2030" · "PCR 2040 · 12% gas case" — the case name read off the run's own note */
  function runLabel(id) {
    let m, out = String(id);
    if ((m = /^(\d+)yr$/i.exec(out))) out = `PROBE ${m[1]}-year`;
    else if ((m = /^pcr(\d{4})$/i.exec(out))) out = `PCR ${m[1]}`;
    const s = scenRow(id), y = s && s.target_year;
    if (y && !out.includes(String(y))) out += ` ${y}`;
    const gc = s && /(\d+(?:\.\d+)?% gas case)/i.exec(s.note || '');
    if (gc) out += ` · ${gc[1]}`;
    return out;
  }
  const hubAnnual = () => ((CATHY() || {}).annual || []).filter(r => r.scope === 'hub' && r.scenario === 'hist');
  const partialYear = y => hubAnnual().some(r => r.year === y && r.partial);

  /* ── scope, asset, market ──────────────────────────────────────────────── */
  const ST = () => C.st || {};
  function loc() {
    const s = C.state(); if (!s || !s.scope) return null;
    const sc = s.scope;
    if (sc.kind === 'bus' && sc.key != null) return { api: String(sc.key), kind: 'bus', bus: Number(sc.key) };
    if (sc.kind === 'hub') return { api: 'HUB', kind: 'hub', bus: null };
    if (sc.kind === 'zone' && sc.key) return { api: String(sc.key), kind: 'zone', bus: null };
    return null;
  }
  const FUELS = ['solar', 'wind', 'storage', 'load'];
  const FUEL_WORD = { solar: 'Solar', wind: 'Wind', storage: 'Storage', load: 'Load' };
  const FUEL_OF = { solar: 'solar', wind: 'wind', bess: 'storage', dc: 'load', hybrid: 'solar' };
  /** the Studio's asset key → the fuel the API reads its shape for (hybrid reads its solar shape) */
  const fuelFor = a => FUEL_OF[a] || 'solar';
  const projectFuel = () => { const s = C.state(); return fuelFor(s && s.asset ? s.asset.fuel : null); };
  const fuel = () => FUELS.includes(ST().csFuel) ? ST().csFuel : projectFuel();
  /** settled reads take the one market (DA / RT); a run has one solved price, so it is never sent one */
  const mkt = () => (ST().market === 'DA' || ST().market === 'RT') ? ST().market : 'RT';
  const clock = () => ST().csClock === 'standard' ? 'standard' : 'local';
  /** the proxy reaches a request only when the page itself applies it (the list is loaded and the id is in it) */
  function scenSent() {
    const S = C.scen, sid = ST().scenario || 'base';
    return (sid !== 'base' && S && S.state === 'ok' && S.entry(sid) && S.entry(sid).kind !== 'base') ? sid : null;
  }
  /** the run the price basis reads at a year (the server's plan when the scenario list is loaded, else ext/76's) */
  function basisRun(year, bus) {
    const S = C.scen;
    if (S && S.state === 'ok') return S.baseRun(year, bus);
    const P = (root.GSX_PRICE && root.GSX_PRICE.PLAN) || {};
    let r = P[year] || null;
    if (r === '5yr' && bus != null && +year === 2028) {
      try { const n = GS.priceBasisNote && GS.priceBasisNote(bus, 2028); if (n && n.applied) r = 'pcr2030'; } catch (e) { /* no note: as planned */ }
    }
    return r;
  }
  const horizon = () => { const s = C.state(); return (s && s.year) || 2030; };

  /* ── the data cache: one entry per request; answers kept, failures asked again ── */
  const CACHE = new Map();
  const STATUS_P = {};
  /** one entry per request, kept for the page's life: a retry re-asks through the SAME entry, so every panel
   *  holding it sees the new answer. Render paths only read entries; builds (and Retry) ask. */
  function fetchOne(kind, p, opt) {
    const key = kind + ' ' + JSON.stringify(Object.keys(p).sort().map(k => [k, p[k]]));
    let ent = CACHE.get(key);
    if (ent && !(opt && opt.fresh) && (ent.state === 'loading' || ent.state === 'ok')) return ent;
    /* S-nav 2026-10-07: one live connection for the whole Continuum — until it is made, the read is not sent */
    if (C.live && !C.live.allowed()) {
      return { key, kind, p, state: 'idle', gen: 0, res: { why: 'Live data not connected — Connect live data (top bar) once; this browser then reads it on every open' } };
    }
    if (!ent) { ent = { key, kind, p, state: 'loading', res: null, gen: 0 }; CACHE.set(key, ent); }
    const gen = ++ent.gen;
    ent.state = 'loading'; ent.res = null; ASKED++;
    const api = C.api;
    const call = kind === 'pvg' ? api.priceVsGeneration(p, opt) : kind === 'cap' ? api.capture(p, opt) : api.status(opt);
    Promise.resolve(call).then(res => {
      if (gen !== ent.gen) return;
      ent.res = res; ent.state = res && res.ok ? 'ok' : ((res && res.state) || 'offline');
    }, e => { if (gen !== ent.gen) return; ent.res = { why: `the request failed: ${(e && e.message) || e}` }; ent.state = 'offline'; })
      .then(() => { if (gen === ent.gen) refreshSoon(); });
    return ent;
  }
  let ASKED = 0, RAF = null;
  /** many reads land together: one redraw per frame */
  function refreshSoon() {
    if (RAF) return;
    RAF = (root.requestAnimationFrame || (f => setTimeout(f, 16)))(() => { RAF = null; refreshAll(); });
  }
  const status = () => fetchOne('status', STATUS_P);
  /** the status entry as held — read without asking (render paths never fetch) */
  const statusHeld = () => CACHE.get('status ' + JSON.stringify([])) || null;
  const body = ent => (ent && ent.state === 'ok' && ent.res) ? ent.res.body : null;
  /** the sentence a failed read prints (the API client's own words) */
  function failWord(ent) {
    const r = (ent && ent.res) || {};
    switch (ent && ent.state) {
      case 'offline': return r.why || 'Live server offline';
      case 'server-error': return r.why || 'Live server erroring';
      case 'no-route': return r.why || 'the live server does not carry this route — restart it so the route is mounted';
      case 'not-found': return `Not held here: ${r.why || 'the server holds nothing for this request'}`;
      case 'bad-request': return `The server refused the request: ${r.why || 'a parameter was not accepted'}`;
      case 'idle': return r.why || 'Live data not connected';
      default: return 'Reading from the live server…';
    }
  }
  function retryAll() {
    [...CACHE.values()].filter(e => e.state !== 'ok' && e.state !== 'loading').forEach(e => fetchOne(e.kind, e.p, { fresh: true }));
    refreshAll();
  }
  /* the panels on screen: id -> {body, fn}. A finished read redraws them in place, never the whole screen */
  const RENDER = {};
  function refreshAll() {
    Object.keys(RENDER).forEach(id => {
      const r = RENDER[id];
      if (!r || !r.body || !r.body.isConnected) { delete RENDER[id]; return; }
      try { r.fn(r.body); } catch (e) { failPanel(r.body, e); }
    });
  }
  function failPanel(b, e) {
    b.innerHTML = '';
    const d = H('div', 'gsc-empty'); d.appendChild(H('b', null, 'This panel could not be drawn'));
    d.appendChild(H('p', null, `${(e && e.message) || e}. Nothing from a previous selection is left on screen.`));
    b.appendChild(d);
    console.warn('[continuum-shape] ' + ((e && e.message) || e));
  }

  /* ── controls ──────────────────────────────────────────────────────────── */
  function repaint() { const b = C.bound; if (b) { if (b.store) b.store(); if (b.paint) b.paint(); } }
  function seg(name, opts, cur, onPick) {
    const w = H('div', 'csh-ctl');
    w.appendChild(H('span', 'csh-lab', name));
    const g = H('div', 'gsc-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', name);
    g.setAttribute('data-cs-seg', name.toLowerCase().replace(/\s+/g, '-'));
    opts.forEach(o => {
      const b = H('button', null, o.l); b.type = 'button'; b.dataset.csVal = String(o.v);
      b.setAttribute('aria-pressed', String(o.v) === String(cur) ? 'true' : 'false');
      if (o.t) b.title = o.t;
      b.onclick = () => onPick(o.v);
      g.appendChild(b);
    });
    w.appendChild(g);
    return w;
  }
  function pickYear(name, years, cur, onPick) {
    const w = H('label', 'csh-ctl'); w.appendChild(H('span', 'csh-lab', name));
    const s = H('select', 'csh-sel'); s.setAttribute('aria-label', name);
    years.forEach(y => { const o = H('option', null, `${y}${partialYear(y) ? ' (part)' : ''}`); o.value = String(y); if (+y === +cur) o.selected = true; s.appendChild(o); });
    s.onchange = () => onPick(+s.value);
    w.appendChild(s);
    return w;
  }
  function assetCtl() {
    const pf = projectFuel();
    return seg('Asset', FUELS.map(f => ({ v: f, l: FUEL_WORD[f], t: f === pf ? 'The project\'s asset' : `Read the ${FUEL_WORD[f].toLowerCase()} shape` })), fuel(),
      v => { ST().csFuel = v === pf ? null : v; repaint(); });
  }
  const marketCtl = () => seg('Market', [{ v: 'DA', l: 'DA' }, { v: 'RT', l: 'RT' }], mkt(), v => { ST().market = v; repaint(); });
  function infoBtn(pid, note) {
    const b = H('button', 'gsc-btn csh-i'); b.type = 'button';
    b.setAttribute('aria-label', 'Show method'); b.title = 'Show method'; b.setAttribute('aria-expanded', 'false');
    b.setAttribute('data-cs-info', pid); b.textContent = 'i';
    b.onclick = () => { const on = note.hidden; note.hidden = !on; b.setAttribute('aria-expanded', on ? 'true' : 'false');
      const pnl = b.closest('.gsc-panel'); if (pnl) pnl.classList.toggle('csh-src-on', on); };
    return b;
  }
  function openAssume(run, words) {
    const b = H('button', 'gsc-btn csh-open', words || 'Open assumptions'); b.type = 'button';
    b.setAttribute('data-cs-open-assume', run);
    b.title = `Open the Assumptions screen at ${runLabel(run)}: the inputs behind this run`;
    b.onclick = () => { const s = ST(); s.csFocus = run; s.screen = 'wf:assumptions'; repaint(); };
    return b;
  }
  /** move a panel (and its section label) to the head of its workflow screen, in registration order (05-ui: Shape
   *  leads with price vs generation and capture; Assumptions with the run table) */
  function lead(host, k, nodes) {
    const head = host.querySelector(':scope > .gsc-wf-head'); if (!head) return;
    const sec = host.querySelector(`:scope > [data-gsc-wf-view="${k}"]`);
    let anchor = host.__csAnchor && host.__csAnchor.parentNode === host ? host.__csAnchor : head;
    [sec].concat(nodes).filter(Boolean).forEach(n => { anchor.after(n); anchor = n; });
    host.__csAnchor = anchor;
  }
  /** a panel from ext/60's factory, wearing this module's class (32 px targets, the six-size scale) */
  function mount(host, cx, k, cfg, tableFn) {
    const p = cx.panel(Object.assign({ wide: true, csv: true, table: tableFn }, cfg));
    p.classList.add('gsc-cs');
    host.appendChild(p);
    const b = p.querySelector(':scope > .gsc-body');
    const tableMode = !!(cx.ST.tables && cx.ST.tables[cfg.id]);
    RENDER[cfg.id] = { body: b, fn: tableMode ? (bb => drawTable(bb, tableFn())) : cfg.draw };
    lead(host, k, [p]);
    return p;
  }
  /** a table in place, the same look as ext/60's (used when a read lands while the panel shows its table) */
  function drawTable(b, t) {
    b.innerHTML = '';
    if (!t || !t.rows.length) { const d = H('div', 'gsc-empty'); d.appendChild(H('b', null, 'No rows at this selection')); d.appendChild(H('p', null, (t && t.why) || 'Nothing is held here.')); b.appendChild(d); return; }
    const sc = H('div', 'gsc-scroll'), tb = H('table', 'gsc-tbl'), th = H('thead'), tr = H('tr');
    t.cols.forEach(c => tr.appendChild(H('th', null, c.l))); th.appendChild(tr); tb.appendChild(th);
    const bd = H('tbody');
    t.rows.forEach(r => { const x = H('tr'); t.cols.forEach((c, i) => x.appendChild(H('td', i === 0 ? 't' : null, r[i] == null ? '—' : String(r[i])))); bd.appendChild(x); });
    tb.appendChild(bd); sc.appendChild(tb); b.appendChild(sc);
  }
  const busy = ents => ents.some(e => e && e.state === 'loading');

  /* ═══════════════════════════════════════════════════════════════════════
     S1 · Price vs generation (#2)
     ═══════════════════════════════════════════════════════════════════════ */
  const COMP = [{ v: 'lmp', l: 'LMP' }, { v: 'energy', l: 'Energy' }, { v: 'congestion', l: 'Congestion' }, { v: 'loss', l: 'Loss' }];
  const compWord = v => (COMP.find(c => c.v === v) || COMP[0]).l;
  const comp = () => COMP.some(c => c.v === ST().csComp) ? ST().csComp : 'lmp';
  function settledYears() {
    const s = body(statusHeld());
    const ys = s && Array.isArray(s.settled_years) && s.settled_years.length ? s.settled_years : uniq(hubAnnual().map(r => r.year)).filter(y => y >= 2021);
    return ys.slice().sort((a, b) => a - b);
  }
  function settledYear() {
    const ys = settledYears(), want = +ST().csYear;
    if (want && ys.includes(want)) return want;
    const whole = ys.filter(y => !partialYear(y));
    return (whole.length ? whole : ys).slice(-1)[0] || 2025;
  }
  /** the runs a Shape chart draws: the strip's runs, or the run the price basis reads at the horizon (D-001) */
  function shapeRuns() {
    const s = C.state(), sel = ((s && s.runs) || []).filter(id => id !== 'hist');
    if (sel.length) return sel.slice(0, 3);
    const L = loc(), r = basisRun(horizon(), L && L.bus);
    return r ? [r] : [];
  }
  let PVG = null;   // the periods the panel was last built for
  function pvgPeriods() {
    const L = loc(); if (!L) return null;
    const fu = fuel(), mk = mkt(), ck = clock(), sid = scenSent();
    const y = settledYear();
    const ps = [{ id: `settled:${y}`, settled: true, year: y, label: `Settled ${y} · ${mk}` }]
      .concat(shapeRuns().map(r => ({ id: r, settled: false, year: runYear(r), label: runLabel(r) })));
    ps.forEach(pd => {
      const p = { bus: L.api, source: pd.id };
      if (pd.settled && mk === 'DA') p.market = 'DA';
      if (fu !== 'solar') p.fuel = fu;
      if (ck !== 'local') p.clock = ck;
      if (!pd.settled && sid) p.scenario = sid;
      pd.ent = fetchOne('pvg', p);
    });
    return { L, fu, mk, ck, sid, ps };
  }
  function pvgTable() {
    const P = PVG;
    const cols = ['Period', 'HE', 'Generation (MW)', 'Curtailed (MW)', 'LMP ($/MWh)', 'Energy ($/MWh)', 'Congestion ($/MWh)', 'Loss ($/MWh)', 'Hours', 'Source'].map(l => ({ l }));
    if (!P) return { cols, rows: [], why: 'No location in scope.' };
    if (busy(P.ps.map(p => p.ent))) return { cols, rows: [], why: 'Reading the hour-of-day shapes from the live server…' };
    const rows = [];
    P.ps.forEach(pd => {
      const b = body(pd.ent); if (!b || !b.price) return;
      const g = b.generation || {}, pr = b.price;
      for (let h = 0; h < 24; h++) rows.push([pd.label, h + 1, g.mw ? g.mw[h] : null, g.curtailed_mw ? g.curtailed_mw[h] : null,
        pr.lmp[h], pr.energy[h], pr.congestion[h], pr.loss[h], b.hours, g.label || g.not_held || '']);
    });
    return { cols, rows, why: 'No period at this selection was served.' };
  }
  function buildPvg(host, cx) {
    status();
    PVG = pvgPeriods();
    const P = PVG;
    if (P) P.ps.filter(pd => !pd.settled).forEach(pd => C.scen.adjust({ run: pd.id, year: pd.year, kind: 'solved', bus: P.L.bus, view: 'cs-pvg' }));
    const note = H('div', 'gsc-note csh-method'); note.hidden = true; note.setAttribute('data-cs-method', 'cs-pvg');
    const scopeWord = P ? (P.L.kind === 'hub' ? 'ISO-NE Internal Hub (hub)' : P.L.kind === 'zone' ? `${P.L.api} zone` : `bus ${P.L.api}`) : 'no location';
    mount(host, cx, 'cs-pvg', {
      id: 'cs-pvg', title: 'Price vs generation', controls: [infoBtn('cs-pvg', note)],
      sig: cx.sig ? cx.sig('price-vs-generation', 'hour of day · settled year + runs', P ? P.mk : '-') : null,
      faceText: P ? `${scopeWord} · Asset ${FUEL_WORD[P.fu]} · Market ${P.mk} (settled) · Clock ${P.ck} · Price line ${compWord(comp())} · hour-of-day means, HE = hour index + 1` : 'no location in scope',
      draw: b => drawPvg(b, note),
    }, pvgTable);
  }
  function drawPvg(b, note) {
    b.innerHTML = '';
    const P = PVG;
    if (!P) { const d = H('div', 'gsc-empty'); d.appendChild(H('b', null, 'No location in scope')); d.appendChild(H('p', null, 'Pick a bus, a load zone or the hub on the left; price vs generation is read per location.')); b.appendChild(d); return; }
    const bar = H('div', 'csh-bar');
    bar.appendChild(assetCtl());
    bar.appendChild(seg('Price line', COMP, comp(), v => { ST().csComp = v; repaint(); }));
    bar.appendChild(pickYear('Settled year', settledYears(), settledYear(), v => { ST().csYear = v; repaint(); }));
    bar.appendChild(seg('Clock', [{ v: 'local', l: 'Local', t: 'Settled hours on local prevailing time (the store\'s labels)' }, { v: 'standard', l: 'Standard', t: 'Settled hours re-binned to standard time, aligned with the runs' }], P.ck, v => { ST().csClock = v === 'local' ? null : v; repaint(); }));
    b.appendChild(bar);
    const grid = H('div', 'csh-grid'); b.appendChild(grid);
    /* the slot decides the geometry (SKL-091 §1.1): two charts a row from 860 px, three from 1,300 px */
    const gw = grid.clientWidth || b.clientWidth || 900, n = P.ps.length;
    const ncol = n === 1 ? 1 : gw >= 1300 && n >= 3 ? 3 : gw >= 860 ? 2 : 1;
    grid.style.gridTemplateColumns = `repeat(${ncol}, minmax(0, 1fr))`;
    const cellW = Math.floor((gw - 10 * (ncol - 1)) / ncol) - 18;
    /* one price scale across the charts, so a run and a settled year compare at a glance */
    const cp = comp();
    const vals = P.ps.map(pd => body(pd.ent)).filter(x => x && x.price).flatMap(x => x.price[cp] || []).filter(isNum);
    const py = nice(Math.min(0, ...vals), Math.max(1, ...vals), 5);
    P.ps.forEach(pd => grid.appendChild(pvgCell(pd, P, py, cp, cellW)));
    b.appendChild(legendPvg(P.fu));
    /* the calendars differ: say so when a settled year sits beside a run */
    if (P.ck === 'local' && P.ps.some(pd => !pd.settled)) b.appendChild(H('div', 'gsc-note csh-cal', 'Settled hours are local prevailing time; runs are flat standard time, so summer bins sit one hour apart. Clock: Standard lines them up.'));
    note.innerHTML = '';
    const first = P.ps.map(pd => body(pd.ent)).find(Boolean);
    const lines = [];
    if (first) {
      lines.push(first.method || '');
      const hc = first.hour_convention || {};
      lines.push(hc.he_rule || '', hc.settled || '', hc.solved || '');
    }
    P.ps.forEach(pd => {
      const x = body(pd.ent); if (!x) return;
      const g = x.generation || {}, cap = x.capture || {};
      if (g.curtailment_rule) lines.push(`${pd.label}: ${g.curtailment_rule}`);
      if (cap.hod_approximation && isNum(cap.hod_approximation.ratio)) lines.push(`${pd.label}: hour-of-day approximation ${pct(cap.hod_approximation.ratio)} (${money(cap.hod_approximation.price)}) — ${cap.hod_approximation.warning || ''}`);
    });
    lines.push(first && first.sign ? first.sign : '');
    lines.filter(Boolean).forEach(t => note.appendChild(H('p', null, t)));
    b.appendChild(note);
  }
  function legendPvg(fu) {
    const lg = H('div', 'gsc-lg csh-lg');
    const add = (cls, word, color, dash) => { const s = H('span'); const i = H('i', dash ? 'gsc-dash' : cls); if (color) { if (dash) i.style.color = color; else i.style.background = color; } s.appendChild(i); s.appendChild(H('span', null, word)); lg.appendChild(s); };
    if (fu === 'storage') { add(null, 'Discharge (MW)', tok('--s6')); add(null, 'Charge (MW)', tok('--s5')); }
    else if (fu !== 'load') { add(null, `${FUEL_WORD[fu]} dispatched (MW)`, fu === 'wind' ? tok('--s3') : tok('--s4')); add('csh-curt-key', 'Curtailed: offered − dispatched (MW)', null); }
    add(null, `${compWord(comp())} ($/MWh), right axis`, tok('--s1'), true);
    return lg;
  }
  function pvgCell(pd, P, py, cp, cellW) {
    const cell = H('div', 'csh-cell'); cell.setAttribute('data-cs-chart', pd.id);
    const ent = pd.ent, x = body(ent);
    cell.setAttribute('data-cs-state', ent ? ent.state : 'loading');
    const head = H('div', 'csh-ch');
    head.appendChild(H('b', 'csh-t', pd.label));
    if (!pd.settled) head.appendChild(openAssume(pd.id));
    cell.appendChild(head);
    if (!x) {
      const m = H('div', ent && ent.state === 'loading' ? 'csh-msg csh-loading' : 'csh-msg'); m.setAttribute('data-cs-msg', ent ? ent.state : 'loading');
      m.textContent = ent && ent.state === 'loading' ? `Reading ${pd.label} from the live server…` : failWord(ent);
      cell.appendChild(m);
      if (ent && ent.state !== 'loading' && ent.state !== 'idle') { const r = H('button', 'gsc-btn csh-retry', 'Retry');   /* S-nav: before the live connection the action is Connect live data (top bar) */ r.type = 'button'; r.setAttribute('data-cs-retry', pd.id); r.title = 'Ask the live server again'; r.onclick = retryAll; cell.appendChild(r); }
      return cell;
    }
    const g = x.generation || {}, cap = x.capture || {};
    const src = H('div', 'csh-src'); src.setAttribute('data-cs-source', g.kind || 'none');
    src.textContent = g.label || g.not_held || 'no generation shape served';
    cell.appendChild(src);
    if (x.cape && x.cape.flagged) { const c = H('span', 'badge gsp-cape csh-cape', x.cape.badge || 'Cape input case'); c.setAttribute('data-cs-cape', '5yr'); c.title = x.cape.note || x.cape.word || ''; src.appendChild(c); }
    /* the headline: the hourly capture, never the hour-of-day approximation */
    const k = H('div', 'csh-kpi'); k.setAttribute('data-cs-kpi', pd.id);
    const kv = (v, l) => { k.appendChild(H('span', 'csh-kv', v)); k.appendChild(H('span', 'csh-kl', l)); };
    if (g.kind === 'flat_load') kv(money(cap.price), `a flat load pays the flat mean · ${fmt.int(x.hours)} h`);
    else if (P.fu === 'storage') {
      if (isNum(cap.discharge_weighted_price)) kv(money(cap.discharge_weighted_price), `discharge-weighted · charge-weighted ${money(cap.charge_weighted_price)} · hour-of-day means · flat ${money(x.price.flat_mean)}`);
      else kv(money(x.price.flat_mean), 'flat mean · no unit dispatch held here');
    } else if (isNum(cap.ratio)) kv(pct(cap.ratio), `capture · hourly · ${money(cap.price)} vs flat ${money(x.price.flat_mean)}`);
    else kv(money(x.price.flat_mean), 'flat mean · capture not held hour by hour for this shape (method: the hour-of-day figure only)');
    cell.appendChild(k);
    if (g.kind === 'flat_load') cell.setAttribute('data-cs-gen', 'flat');
    else cell.setAttribute('data-cs-gen', g.mw ? 'ok' : 'not-held');
    cell.appendChild(pvgSvg(cellW, pd, x, py, cp, P.fu));
    /* the foot: hours, part year, fleet, calendar, curtailment, the scenario as the server applied it */
    const ft = H('div', 'csh-foot');
    const bits = [`${fmt.int(x.hours)} h`];
    if (x.partial) bits.push('part year');
    if (isNum(x.missing_hours) && x.missing_hours > 0) bits.push(`${fmt.int(x.missing_hours)} h not solved`);
    if (isNum(g.units) && isNum(g.fleet_mw)) bits.push(`${fmt.int(g.units)} units · ${fmt.num(g.fleet_mw, 1)} MW`);
    if (g.unit_names) bits.push(`${g.unit_names}${isNum(g.unit_mw) ? ` · ${fmt.num(g.unit_mw, 0)} MW` : ''}${isNum(g.unit_mwh) ? ` / ${fmt.num(g.unit_mwh, 0)} MWh` : ''}`);
    bits.push(`flat ${money(x.price.flat_mean)}`);
    if (x.calendar_note) bits.push(x.calendar_note);
    if (g.curtailment_not_held) bits.push(g.curtailment_not_held);
    if (g.not_held && g.mw == null) bits.push(g.not_held);
    if (g.fallback) bits.push(g.fallback);
    const sp = x.scenario && x.scenario.by_period && x.scenario.by_period[x.period || pd.id];
    if (sp) bits.push(sp.applied ? `${String(sp.label || '').split(' — ')[0]} × ${fmt.num(sp.factor, 2)} applied` : `drawn as solved: ${sp.note || 'not the Base run here'}`);
    ft.textContent = bits.join(' · ');
    cell.appendChild(ft);
    return cell;
  }
  function pvgSvg(cellW, pd, x, py, cp, fu) {
    const W = Math.max(300, Math.floor(cellW || 420));
    const Hh = 232, Pd = { l: 48, r: 52, t: 26, b: 30 };
    const iw = W - Pd.l - Pd.r, ih = Hh - Pd.t - Pd.b, bw = iw / 24;
    const svg = SV('svg', { class: 'csh-svg', viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': `${pd.label}: generation by hour of day with ${compWord(cp)}` });
    const g = x.generation || {}, pr = x.price || {};
    const mw = Array.isArray(g.mw) && g.kind !== 'flat_load' ? g.mw : null, cu = Array.isArray(g.curtailed_mw) ? g.curtailed_mw : null;
    let my;
    if (mw && fu === 'storage') { const m = Math.max(1, ...mw.map(v => Math.abs(v || 0))); my = nice(-m, m, 4); }
    else if (mw) my = nice(0, Math.max(1, ...mw.map((v, h) => (v || 0) + ((cu && cu[h]) || 0))), 4);
    const Y = (v, s) => Pd.t + ih - (v - s.lo) / (s.hi - s.lo) * ih;
    /* grid and left axis (MW) */
    (my ? my.ticks : py.ticks).forEach(t => {
      const yy = Y(t, my || py);
      svg.appendChild(SV('line', { class: 'csh-grid-l', x1: Pd.l, x2: W - Pd.r, y1: yy, y2: yy }));
      if (my) { const tx = SV('text', { class: 'csh-ax', x: Pd.l - 6, y: yy + 4, 'text-anchor': 'end' }); tx.textContent = fmt.num(t, Math.abs(my.hi) < 10 ? 1 : 0); svg.appendChild(tx); }
    });
    if (my) { const u = SV('text', { class: 'csh-ax', x: Pd.l - 6, y: Pd.t - 14, 'text-anchor': 'end' }); u.textContent = 'MW'; svg.appendChild(u); }
    py.ticks.forEach(t => { const tx = SV('text', { class: 'csh-ax', x: W - Pd.r + 6, y: Y(t, py) + 4 }); tx.textContent = fmt.num(t, py.hi - py.lo < 5 ? 1 : 0); svg.appendChild(tx); });
    { const u = SV('text', { class: 'csh-ax', x: W - Pd.r + 6, y: Pd.t - 14 }); u.textContent = '$/MWh'; svg.appendChild(u); }
    svg.appendChild(SV('line', { class: 'csh-axis', x1: Pd.l, x2: W - Pd.r, y1: Pd.t + ih, y2: Pd.t + ih }));
    /* bars */
    const genC = fu === 'wind' ? tok('--s3') : fu === 'storage' ? tok('--s6') : tok('--s4');
    if (mw) {
      const y0 = Y(fu === 'storage' ? 0 : Math.max(0, my.lo), my);
      if (fu === 'storage') svg.appendChild(SV('line', { class: 'csh-zero', x1: Pd.l, x2: W - Pd.r, y1: y0, y2: y0 }));
      for (let h = 0; h < 24; h++) {
        const v = mw[h]; if (!isNum(v)) continue;
        const x0 = Pd.l + h * bw + bw * 0.14, w0 = bw * 0.72;
        const yv = Y(v, my);
        const r = SV('rect', { x: x0, y: Math.min(yv, y0), width: w0, height: Math.max(0, Math.abs(y0 - yv)), fill: fu === 'storage' && v < 0 ? tok('--s5') : genC, 'data-cs-bar': h });
        svg.appendChild(r);
        const c = cu && cu[h];
        if (isNum(c) && c > 0) svg.appendChild(SV('rect', { class: 'csh-curt', x: x0, y: Y(v + c, my), width: w0, height: Math.max(0.5, yv - Y(v + c, my)), 'data-cs-curt': h }));
      }
    }
    /* the price line, on the shared right axis */
    const vs = pr[cp] || [];
    let d = '';
    vs.forEach((v, h) => { if (!isNum(v)) return; const xx = Pd.l + (h + 0.5) * bw, yy = Y(v, py); d += `${d ? 'L' : 'M'}${xx.toFixed(1)},${yy.toFixed(1)}`; });
    if (d) svg.appendChild(SV('path', { d, class: 'csh-line', stroke: tok('--s1'), 'data-cs-line': cp }));
    /* x axis */
    [1, 6, 12, 18, 24].forEach(he => { const tx = SV('text', { class: 'csh-ax', x: Pd.l + (he - 0.5) * bw, y: Hh - Pd.b + 15, 'text-anchor': 'middle' }); tx.textContent = String(he); svg.appendChild(tx); });
    { const tx = SV('text', { class: 'csh-ax', x: Pd.l + iw / 2, y: Hh - 3, 'text-anchor': 'middle' }); tx.textContent = 'Hour ending (HE)'; svg.appendChild(tx); }
    /* one readable mark per hour: the CSV's row */
    for (let h = 0; h < 24; h++) {
      const hit = SV('rect', { class: 'csh-hit', x: Pd.l + h * bw, y: Pd.t, width: bw, height: ih, 'data-cs-hour': h + 1 });
      const t = SV('title');
      const gv = mw && isNum(mw[h]) ? `${fmt.num(mw[h], 1)} MW` : (g.kind === 'flat_load' ? 'flat 1 MW load' : 'no generation shape');
      t.textContent = `${pd.label} · HE${h + 1} · ${gv}${cu && isNum(cu[h]) && cu[h] > 0 ? ` (+${fmt.num(cu[h], 1)} MW curtailed)` : ''} · ${compWord(cp)} ${money(vs[h])}`;
      hit.appendChild(t); svg.appendChild(hit);
    }
    return svg;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     S2 · Capture by year (#7)
     ═══════════════════════════════════════════════════════════════════════ */
  const MEASURES = [{ v: 'ratio', l: 'Ratio', t: 'Capture price ÷ the flat mean at the same location' },
    { v: 'price', l: 'Price', t: 'Capture price, $/MWh' }, { v: 'vs_hub', l: 'vs hub', t: 'Capture price ÷ the hub\'s flat mean in the same period' }];
  const measure = () => MEASURES.some(m => m.v === ST().csMeasure) ? ST().csMeasure : 'ratio';
  const capFuel = () => fuel() === 'wind' ? 'wind' : 'solar';
  let CAP = null;
  function capReq() {
    const L = loc(); if (!L) return null;
    const mk = mkt(), sid = scenSent();
    const p = { bus: L.api };
    if (mk === 'DA') p.market = 'DA';
    if (sid) p.scenario = sid;
    return { L, mk, sid, ent: fetchOne('cap', p) };
  }
  /** the drawn series: node · zone · hub, a location once */
  function capSeries(b) {
    const out = [], seen = new Set(), sr = (b && b.series) || {};
    ['node', 'zone', 'hub'].forEach(role => {
      const s = sr[role]; if (!s || !s.location) return;
      const id = String(s.location.id); if (seen.has(id)) return; seen.add(id);
      out.push({ role, s, label: s.location.label || id });
    });
    return out;
  }
  function capRows() {
    const R = CAP; if (!R) return [];
    const b = body(R.ent); if (!b) return [];
    const fu = capFuel(), mk = R.mk, rows = [];
    const by = (b.scenario && b.scenario.by_period) || {};
    capSeries(b).forEach(({ role, s, label }) => {
      (s.settled || []).forEach(r => rows.push({ role, label, period: `Settled ${r.year} · ${mk}`, id: r.period, year: r.year, kind: r.partial ? 'settled, part year' : 'settled', settled: true, partial: !!r.partial,
        flat: r.flat, price: r[`${fu}_price`], ratio: r[`${fu}_ratio`], vsHub: r[`${fu}_vs_hub`], hours: r.hours,
        note: r.partial ? (r.partial_note || 'part year') : '' }));
      (s.runs || []).forEach(r => {
        const sp = by[r.period];
        const notes = [];
        if (r.cape && r.cape.flagged) notes.push(r.cape.word || 'Cape input case');
        if (sp) notes.push(sp.applied ? `${String(sp.label || '').split(' — ')[0]} × ${fmt.num(sp.factor, 2)} (illustrative proxy — not a PROBE run)` : `drawn as solved — ${sp.note || 'not the Base run here'}`);
        if (isNum(r.missing_hours) && r.missing_hours > 0) notes.push(`${fmt.int(r.missing_hours)} h not solved`);
        rows.push({ role, label, period: runLabel(r.period), id: r.period, year: r.year, kind: 'solved', settled: false, cape: !!(r.cape && r.cape.flagged),
          flat: r.flat, price: r[`${fu}_price`], ratio: r[`${fu}_ratio`], vsHub: r[`${fu}_vs_hub`], hours: r.hours, note: notes.join('; ') });
      });
    });
    return rows;
  }
  const mVal = r => { const m = measure(); return m === 'price' ? r.price : m === 'vs_hub' ? (isNum(r.vsHub) ? r.vsHub * 100 : null) : (isNum(r.ratio) ? r.ratio * 100 : null); };
  const mWord = v => measure() === 'price' ? money(v) : (isNum(v) ? `${fmt.num(v, 1)} %` : '—');
  function capTable() {
    const cols = ['Location', 'Period', 'Year', 'Kind', 'Flat mean ($/MWh)', 'Capture price ($/MWh)', 'Capture ratio (%)', 'Capture ÷ hub flat (%)', 'Hours', 'Note'].map(l => ({ l }));
    if (!CAP) return { cols, rows: [], why: 'No location in scope.' };
    if (CAP.off) return { cols, rows: [], why: CAP.off };
    if (busy([CAP.ent])) return { cols, rows: [], why: 'Reading capture from the live server…' };
    if (!body(CAP.ent)) return { cols, rows: [], why: failWord(CAP.ent) };
    return { cols, rows: capRows().map(r => [r.label, r.period, r.year, r.kind, r2(r.flat, 3), r2(r.price, 3), isNum(r.ratio) ? r2(r.ratio * 100, 2) : null,
      isNum(r.vsHub) ? r2(r.vsHub * 100, 2) : null, r.hours, r.note]) };
  }
  function buildCapture(host, cx) {
    const fu = fuel();
    CAP = capReq();
    if (CAP && !['solar', 'wind'].includes(fu)) CAP.off = `Capture is defined for solar and wind output; the asset read here is ${FUEL_WORD[fu].toLowerCase()}.`;
    if (CAP && !CAP.off) runIds().forEach(r => C.scen.adjust({ run: r, year: runYear(r), kind: 'solved', bus: CAP.L.bus, view: 'cs-capture' }));
    const note = H('div', 'gsc-note csh-method'); note.hidden = true;
    mount(host, cx, 'cs-capture', {
      id: 'cs-capture', title: 'Capture by year', controls: [infoBtn('cs-capture', note)],
      sig: cx.sig ? cx.sig('capture', 'annual settled 2021–26 + solved runs', 'node · zone · hub') : null,
      faceText: CAP ? `${FUEL_WORD[capFuel()]} capture · ${CAP.L.kind === 'bus' ? `bus ${CAP.L.api}` : CAP.L.api} vs its zone and the hub · settled ${CAP.mk} · runs solved · hourly capture (Σ shape × LMP ÷ Σ shape over every hour)` : 'no location in scope',
      draw: b => drawCapture(b, note),
    }, capTable);
  }
  function drawCapture(b, note) {
    b.innerHTML = '';
    const R = CAP;
    if (!R) { const d = H('div', 'gsc-empty'); d.appendChild(H('b', null, 'No location in scope')); d.appendChild(H('p', null, 'Pick a bus, a load zone or the hub on the left.')); b.appendChild(d); return; }
    const bar = H('div', 'csh-bar');
    bar.appendChild(assetCtl());
    bar.appendChild(seg('Measure', MEASURES, measure(), v => { ST().csMeasure = v; repaint(); }));
    b.appendChild(bar);
    if (R.off) {
      const d = H('div', 'gsc-empty'); d.appendChild(H('b', null, 'Capture is defined for solar and wind output'));
      d.appendChild(H('p', null, `${R.off} Storage is read on Spreads and Price vs generation (charge and discharge prices); a data centre pays the flat mean. Pick Solar or Wind under Asset to read capture here.`));
      b.appendChild(d); return;
    }
    const st = H('div', 'csh-cap'); st.setAttribute('data-cs-state', R.ent.state); b.appendChild(st);
    const x = body(R.ent);
    if (!x) {
      const m = H('div', 'csh-msg'); m.setAttribute('data-cs-msg', R.ent.state);
      m.textContent = R.ent.state === 'loading' ? 'Reading capture from the live server…' : failWord(R.ent);
      st.appendChild(m);
      if (R.ent.state !== 'loading' && R.ent.state !== 'idle') { const r = H('button', 'gsc-btn csh-retry', 'Retry'); r.type = 'button'; r.setAttribute('data-cs-retry', 'capture'); r.onclick = retryAll; st.appendChild(r); }
      return;
    }
    const rows = capRows(), ser = capSeries(x);
    /* KPIs: the lead is the node's latest whole settled year, hourly; beside it the run the basis reads at the horizon */
    const kp = H('div', 'csh-kpis');
    const main = ser[0];
    const sRows = rows.filter(r => r.role === main.role && r.settled && !r.partial && isNum(mVal(r)));
    const last = sRows.slice(-1)[0];
    const bRun = basisRun(horizon(), R.L.bus);
    const fRow = rows.find(r => r.role === main.role && r.id === bRun);
    const fu = capFuel(), mw = MEASURES.find(m => m.v === measure()).l.toLowerCase();
    if (last) {
      const l = H('div', 'csh-leadbox'); l.setAttribute('data-cs-lead', last.id);
      l.appendChild(H('span', 'csh-lead', mWord(mVal(last))));
      l.appendChild(H('span', 'csh-kl', `${FUEL_WORD[fu]} capture ${mw} ${last.year} · ${main.label} · settled ${R.mk} · hourly`));
      kp.appendChild(l);
    }
    if (fRow && isNum(mVal(fRow))) {
      const f = H('div', 'csh-kbox'); f.setAttribute('data-cs-kpi', fRow.id);
      f.appendChild(H('span', 'csh-kv', mWord(mVal(fRow))));
      f.appendChild(H('span', 'csh-kl', `${fRow.period} · solved · hourly${fRow.note ? ' · ' + fRow.note : ''}`));
      kp.appendChild(f);
      bar.appendChild(openAssume(fRow.id, 'Open run assumptions'));
    }
    const beside = ser.slice(1).map(sx => {
      const r = last && rows.find(q => q.role === sx.role && q.settled && q.year === last.year);
      return r && isNum(mVal(r)) ? `${sx.label} ${mWord(mVal(r))}` : null;
    }).filter(Boolean);
    if (beside.length && last) { const z = H('div', 'csh-kbox csh-beside'); z.appendChild(H('span', 'csh-kz', beside.join(' · '))); z.appendChild(H('span', 'csh-kl', `same year, ${last.year}`)); kp.appendChild(z); }
    st.appendChild(kp);
    st.appendChild(capSvg(st, rows, ser, R));
    st.appendChild(capLegend(ser));
    const ft = H('div', 'gsc-note');
    ft.textContent = 'Settled: ISO-NE system metered shape × the location\'s hourly price (not the plant; behind-the-meter excluded). Runs: the same run\'s ISO fleet dispatch × its own price — run duck curves are flatter than settled, so the two are marked apart and never spliced.';
    st.appendChild(ft);
    note.innerHTML = '';
    [x.method, (x.hour_convention || {}).note, x.sign].filter(Boolean).forEach(t => note.appendChild(H('p', null, t)));
    st.appendChild(note);
  }
  const ROLE_TOK = { node: '--s1', zone: '--s3', hub: '--s7' };
  function capLegend(ser) {
    const lg = H('div', 'gsc-lg csh-lg');
    ser.forEach(s => { const sp = H('span'); const i = H('i'); i.style.background = tok(ROLE_TOK[s.role]); sp.appendChild(i); sp.appendChild(H('span', null, `${s.label}${s.role === 'node' ? '' : ` (${s.role})`}`)); lg.appendChild(sp); });
    [['csh-k-solid', 'settled (solid)'], ['csh-k-dash', 'solved runs the price basis reads (dashed)'], ['csh-k-hollow', 'other solved run (hollow)'], ['csh-k-part', 'part year (hollow ring)']]
      .forEach(([c, w]) => { const sp = H('span'); sp.appendChild(H('i', c)); sp.appendChild(H('span', null, w)); lg.appendChild(sp); });
    return lg;
  }
  function capSvg(host, rows, ser, R) {
    const W = Math.max(320, Math.floor(host.getBoundingClientRect().width || 600)), Hh = 262, Pd = { l: 52, r: 18, t: 16, b: 46 };
    const iw = W - Pd.l - Pd.r, ih = Hh - Pd.t - Pd.b;
    const svg = SV('svg', { class: 'csh-svg', viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': 'Capture by year, settled then solved' });
    const pts = rows.filter(r => isNum(mVal(r)));
    if (!pts.length) { const t = SV('text', { class: 'csh-ax', x: W / 2, y: Hh / 2, 'text-anchor': 'middle' }); t.textContent = 'No capture value at this location for the selected asset.'; svg.appendChild(t); return svg; }
    const yrs = pts.map(r => r.year), x0 = Math.min(...yrs) - 0.6, x1 = Math.max(...yrs) + 0.6;
    const vs = pts.map(mVal), ref = measure() === 'price' ? null : 100;
    const ys = nice(Math.min(...vs, ref == null ? Infinity : ref), Math.max(...vs, ref == null ? -Infinity : ref), 5);
    /* two runs in one study year sit side by side, never on top of each other */
    const off = new Map();
    uniq(pts.filter(r => !r.settled).map(r => r.year)).forEach(y => {
      const ids = uniq(pts.filter(r => !r.settled && r.year === y).map(r => r.id));
      ids.forEach((id, i) => off.set(id, ids.length > 1 ? (i - (ids.length - 1) / 2) * 0.55 : 0));
    });
    const X = r => Pd.l + ((r.year + (r.settled ? 0 : (off.get(r.id) || 0))) - x0) / (x1 - x0) * iw;
    const Y = v => Pd.t + ih - (v - ys.lo) / (ys.hi - ys.lo) * ih;
    ys.ticks.forEach(t => {
      svg.appendChild(SV('line', { class: 'csh-grid-l', x1: Pd.l, x2: W - Pd.r, y1: Y(t), y2: Y(t) }));
      const tx = SV('text', { class: 'csh-ax', x: Pd.l - 6, y: Y(t) + 4, 'text-anchor': 'end' }); tx.textContent = measure() === 'price' ? `$${fmt.num(t, 0)}` : `${fmt.num(t, 0)}%`; svg.appendChild(tx);
    });
    if (ref != null && ref >= ys.lo && ref <= ys.hi) svg.appendChild(SV('line', { class: 'csh-ref', x1: Pd.l, x2: W - Pd.r, y1: Y(ref), y2: Y(ref) }));
    uniq(yrs).sort((a, b) => a - b).forEach(y => { const tx = SV('text', { class: 'csh-ax', x: Pd.l + (y - x0) / (x1 - x0) * iw, y: Hh - Pd.b + 16, 'text-anchor': 'middle' }); tx.textContent = String(y); svg.appendChild(tx); });
    /* the divider between the last settled year and the first run */
    const sY = pts.filter(r => r.settled).map(r => r.year), fY = pts.filter(r => !r.settled).map(r => r.year);
    if (sY.length && fY.length) {
      const dx = Pd.l + ((Math.max(...sY) + Math.min(...fY)) / 2 - x0) / (x1 - x0) * iw;
      svg.appendChild(SV('line', { class: 'csh-div', x1: dx, x2: dx, y1: Pd.t, y2: Pd.t + ih }));
      const t1 = SV('text', { class: 'csh-ax', x: dx - 6, y: Hh - 6, 'text-anchor': 'end' }); t1.textContent = '← settled'; svg.appendChild(t1);
      const t2 = SV('text', { class: 'csh-ax', x: dx + 6, y: Hh - 6 }); t2.textContent = 'solved runs →'; svg.appendChild(t2);
    }
    ser.slice().reverse().forEach(sx => {
      const col = tok(ROLE_TOK[sx.role]);
      const mine = pts.filter(r => r.role === sx.role);
      const sett = mine.filter(r => r.settled).sort((a, b) => a.year - b.year);
      if (sett.length > 1) svg.appendChild(SV('path', { class: 'csh-cap-line', stroke: col, d: sett.map((r, i) => `${i ? 'L' : 'M'}${X(r).toFixed(1)},${Y(mVal(r)).toFixed(1)}`).join('') }));
      /* the runs the price basis reads, joined dashed in year order (Cape 2028 reads PCR 2030 at a flagged bus) */
      const chain = uniq([2028, 2030, 2035, 2040].map(y => basisRun(y, sx.role === 'node' ? R.L.bus : null)).filter(Boolean));
      const cr = chain.map(id => mine.find(r => r.id === id)).filter(Boolean).sort((a, b) => a.year - b.year);
      if (cr.length > 1) svg.appendChild(SV('path', { class: 'csh-cap-dash', stroke: col, d: cr.map((r, i) => `${i ? 'L' : 'M'}${X(r).toFixed(1)},${Y(mVal(r)).toFixed(1)}`).join('') }));
      mine.forEach(r => {
        const onChain = r.settled || cr.includes(r);
        const hollow = r.partial || !onChain;
        const c = SV('circle', { cx: X(r), cy: Y(mVal(r)), r: r.settled ? 3.6 : 4.2, class: hollow ? 'csh-pt csh-pt-hollow' : 'csh-pt', stroke: col, fill: hollow ? 'none' : col,
          'data-cs-pt': r.role, 'data-cs-period': r.id });
        const t = SV('title'); t.textContent = `${sx.label} · ${r.period} · ${mWord(mVal(r))} · capture ${money(r.price)} vs flat ${money(r.flat)} · ${fmt.int(r.hours)} h${r.note ? ' · ' + r.note : ''}`;
        c.appendChild(t); svg.appendChild(c);
        if (r.cape) { const f = SV('text', { class: 'csh-ax csh-flag', x: X(r) + 6, y: Y(mVal(r)) - 6 }); f.textContent = 'Cape'; svg.appendChild(f); }
      });
    });
    return svg;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     S3 · Run assumptions (#9)
     ═══════════════════════════════════════════════════════════════════════ */
  let AS = null;
  function asReq() {
    return {
      status: status(),
      cap: fetchOne('cap', { bus: 'HUB' }),
      fleet: {
        '5yr': { solar: fetchOne('pvg', { bus: 'HUB', source: '5yr' }), wind: fetchOne('pvg', { bus: 'HUB', source: '5yr', fuel: 'wind' }) },
        '10yr': { solar: fetchOne('pvg', { bus: 'HUB', source: '10yr' }), wind: fetchOne('pvg', { bus: 'HUB', source: '10yr', fuel: 'wind' }) },
      },
    };
  }
  const isPcr = id => /^pcr\d{4}$/i.test(id);
  const fcst = (id, f) => ((CATHY() || {}).gen_fcst || []).find(r => r.scenario === id && r.fuel === f) || null;
  const demand = id => ((CATHY() || {}).gen_not_generation || []).find(r => r.scenario === id && /^Demand/.test(r.fuel)) || null;
  const capeMeta = () => ((EXT().run_input_flags || {}).meta || {}).cape_5yr || null;
  const capeBuses = () => Object.keys((EXT().run_input_flags || {}).cape_5yr || {}).length;
  /** a cell from a live read: the value, or the read's own failure sentence */
  function apiCell(ent, fn) {
    if (!ent || ent.state === 'loading') return { t: 'reading…', s: 'loading' };
    const b = body(ent); if (!b) return { t: failWord(ent), s: 'fail' };
    const v = fn(b); return v == null ? { t: 'not served', s: 'not-served' } : { t: v, s: 'ok' };
  }
  const NS = why => ({ t: 'not in the runs we hold', s: 'not-served', why });
  function asRows() {
    const R = AS, m = META(), runs = runIds();
    const st = body(R.status), vin = st && st.vintage;
    const ext = `data-ext.js built ${m.built_at || 'unknown'}`;
    const marts = vin ? `marts built ${String(vin.views_built_at || '').replace('T', ' ').slice(0, 16)}${vin.stale ? ' · stale' : ''}` : (R.status.state === 'loading' ? 'reading…' : failWord(R.status));
    const capRun = id => apiCell(R.cap, b => { const r = (((b.series || {}).node || {}).runs || []).find(x => x.period === id); return r ? `${fmt.int(r.hours)} h${r.missing_hours ? ` · ${fmt.int(r.missing_hours)} h not solved (${fmt.num(r.missing_hours / 24, 0)} day${r.missing_hours === 24 ? '' : 's'})` : ''}` : null; });
    const fleetApi = (id, f) => apiCell(R.fleet[id] && R.fleet[id][f], b => { const g = b.generation || {}; return isNum(g.fleet_mw) ? `${fmt.num(g.fleet_mw, 1)} · ${fmt.int(g.units)} units` : null; });
    const fleetEmb = (id, f) => { const r = fcst(id, f); return r ? { t: `${fmt.num(r.capacity_mw, 1)} · ${fmt.int(r.units)} units`, s: 'ok' } : { t: 'not held in this build', s: 'not-served' }; };
    const S = C.scen, reg = S && S.state === 'ok' ? S.registry() : null;
    const plan = (reg && reg.base_plan) || (root.GSX_PRICE && root.GSX_PRICE.PLAN) || {};
    const yearsFor = id => Object.keys(plan).filter(y => plan[y] === id).map(Number).sort((a, b) => a - b);
    const capeTo = (reg && reg.cape && reg.cape.to) || 'pcr2030';
    const L = loc();
    const flaggedHere = L && L.bus != null && !!(((EXT().run_input_flags || {}).cape_5yr || {})[String(L.bus)]);
    const sign = m.component_sign || '';
    const out = [];
    const row = (k, label, cell, source, vintage) => out.push({ k, label, cells: Object.fromEntries(runs.map(id => [id, cell(id)])), source, vintage });
    row('study', 'Study year', id => ({ t: String(runYear(id) || '—'), s: 'ok' }), 'uni.dim_scenario (cathy.meta.scenarios)', ext);
    row('run', 'Run', id => ({ t: (scenRow(id) || {}).note || id, s: 'ok' }), 'uni.dim_scenario description, in the store\'s words', ext);
    row('engine', 'Engine version', id => isPcr(id) ? { t: 'not held — the PCR files carry no engine version', s: 'not-held' } : NS('probeVersion is in the run file, not on a :5034 route or in this build'), 'PROBE run files (engine version field)', 'not served');
    row('hours', 'Solved hours', id => capRun(id), 'live server · capture view (hub)', marts);
    row('load', 'Modelled load (TWh)', id => { if (!isPcr(id)) return NS('probeN.bidTypeSum (Dmnd) is not on a route or in this build'); const d = demand(id); return d ? { t: fmt.num(d.mwh / 1e6, 2), s: 'ok' } : { t: 'not held in this build', s: 'not-served' }; },
      'cathy.gen_not_generation — the run\'s Dmnd resources (PCR)', ext);
    row('solar', 'Solar fleet (MW)', id => isPcr(id) ? fleetEmb(id, 'Solar') : fleetApi(id, 'solar'), 'PCR: resource capacity (this build) · PROBE 5/10-year: live server · run ISO fleet, econ max > 0', `${ext} · ${marts}`);
    row('wind', 'Wind fleet incl. offshore (MW)', id => isPcr(id) ? fleetEmb(id, 'Wind') : fleetApi(id, 'wind'), 'PCR: resource capacity (this build) · PROBE 5/10-year: live server · wind incl. offshore', `${ext} · ${marts}`);
    row('storage', 'Storage fleet (MW)', id => isPcr(id) ? fleetEmb(id, 'Battery') : NS('storage dispatch is read at a unit node; an aggregate has none'), 'PCR: cathy.gen_fcst (Battery) · PROBE: no ISO storage read is served', ext);
    row('gas', 'Natural gas fleet (MW)', id => isPcr(id) ? fleetEmb(id, 'Natural Gas') : NS('probeN.bdDefinitions by fuel is not on a route or in this build'), 'PCR: cathy.gen_fcst capacity', ext);
    row('other', 'Other fuels (MW)', id => {
      if (!isPcr(id)) return NS('probeN.bdDefinitions by fuel is not on a route or in this build');
      const xs = ['Nuclear', 'Hydro', 'Oil', 'Coal', 'Wood', 'Refuse', 'Landfill Gas'].map(f => fcst(id, f)).filter(Boolean);
      return xs.length ? { t: xs.map(r => `${r.fuel} ${fmt.num(r.capacity_mw, 1)}`).join(' · '), s: 'ok' } : { t: 'not held in this build', s: 'not-served' };
    }, 'PCR: cathy.gen_fcst capacity', ext);
    { const gd = root.GSGridDepth && root.GSGridDepth.runGas ? root.GSGridDepth.runGas : null, has = !!gd && runs.some(id => gd(id) != null); row('gasprice', 'Gas price implied by the run ($/MMBtu)', id => { const v = has ? gd(id) : null; return v != null ? { t: v, s: 'ok' } : isPcr(id) ? NS('pcr.resource_daily fuel cost ÷ fuel use is measured in the dossier sample (v09) only') : NS('probeN.bidderSum is measured in the dossier sample (v09) only'); }, gd ? 'live server · fuel-price path (fuel cost ÷ fuel burn of the run\'s gas units)' : 'probeN.bidderSum · pcr.resource_daily (no route, no embed)', gd ? 'grid depth store' : 'not served'); }   // step4-ui 2026-10-08: GSGridDepth.runGas (ext/69) reads the run-implied gas price
    row('co2', 'CO₂ cost implied by the run', id => isPcr(id) ? { t: 'not held — the PCR files carry no emission cost', s: 'not-held' } : NS('probeN.genEmisSum is measured in the dossier sample (v09) only; its unit is not stated'), 'probeN.genEmisSum (no route, no embed)', 'not served');
    row('retire', 'Retirements by run', () => ({ t: 'not held — uni.dim_retirement carries no run or fuel', s: 'not-held' }), 'cathy.meta.coverage.retirements', ext);
    const cm = capeMeta();
    row('cape', 'Cape input flag', id => {
      if (id !== ((cm && cm.run) || '5yr')) return { t: 'no input flag', s: 'ok' };
      if (!cm) return { t: 'not held in this build', s: 'not-served' };
      return { t: `${cm.note || ''} · ${fmt.int(capeBuses())} buses flagged${L && L.bus != null ? ` · ${flaggedHere ? `flagged at this bus: 2028 reads ${runLabel(capeTo)}` : 'not flagged at this bus'}` : ''}`, s: 'ok' };
    }, 'run_input_flags.cape_5yr (studio/PRICE-BASIS.md)', ext);
    row('basis', 'Price basis reads it for', id => {
      const ys = yearsFor(id);
      if (!ys.length) return { t: 'no year — shown beside the Base run, never in its place', s: 'ok' };
      const words = ys.map(y => y > 2040 ? `${y} (escalated)` : String(y));
      const cape = id === '5yr' ? ` (${runLabel(capeTo)} at the ${fmt.int(capeBuses())} Cape-flagged buses)` : id === capeTo ? ' (and 2028 at Cape-flagged buses)' : '';
      return { t: words.join(', ') + cape, s: 'ok' };
    }, reg ? 'live server · scenario list (base plan)' : 'the Studio price basis (PRICE-BASIS)', reg ? `scenario list, dataset ${reg.dataset_version || 'unknown'}` : ext);
    row('proxy', 'Proxy scenarios', id => {
      if (!reg) return { t: S && S.state === 'loading' ? 'reading the scenario list…' : 'arrives with live data', s: 'not-served' };
      const ys = yearsFor(id);
      if (!ys.length) return { t: 'not Base for any year: drawn as solved under a proxy', s: 'ok' };
      const px = S.list().filter(e => e.kind === 'proxy').map(e => `${S.short(e.id)} ${S.factorWord(e.factor)}`).join(' · ');
      return { t: `${px} on ${ys.join(', ')} (${reg.proxy_label || 'illustrative proxy'})`, s: 'ok' };
    }, 'live server · scenario list (D-002)', reg ? `dataset ${reg.dataset_version || 'unknown'}` : 'not loaded');
    row('escal', 'Escalation to 2045 / 2050', id => {
      const ys = yearsFor(id).filter(y => y > 2040);
      return ys.length && isNum(m.vendor_step) ? { t: `× ${m.vendor_step} per five years (2045 × ${m.vendor_step}, 2050 × ${m.vendor_step}²) — no hourly run`, s: 'ok' } : { t: 'not escalated', s: 'ok' };
    }, `cathy.meta.vendor_step — ${m.vendor_step_basis || 'vendor step'}`, ext);
    row('sign', 'Sign rule', () => ({ t: 'stored LMP = energy − congestion + loss; congestion negated at read, so LMP = energy + congestion + loss (ISO-NE convention)', s: 'ok' }),
      sign ? 'cathy.meta.component_sign · tools/lmp_components.py' : 'tools/lmp_components.py', ext);
    const hc = body(R.fleet['5yr'].solar);
    row('calendar', 'Hour convention', id => {
      const base = 'flat standard time, no daylight saving; HE = hour index + 1';
      if (id === '5yr') return apiCell(R.fleet['5yr'].solar, b => `${base}; ${b.calendar_note || '365 study days'}`);
      return { t: base, s: 'ok' };
    }, hc && hc.hour_convention ? 'live server · price vs generation (hour convention)' : 'run calendars (dossier samples)', marts);
    row('pack', 'Assumption book', () => ({ t: 'assumption pack not linked', s: 'not-held' }), 'U2 open — no run is linked to an assumption-book file', 'not linked');
    row('store', 'Store vintage', () => vin ? { t: `${vin.store_file || 'store'} ${String(vin.store_mtime || '').replace('T', ' ').slice(0, 16)} · ${marts}`, s: 'ok' } : { t: marts, s: R.status.state === 'loading' ? 'loading' : 'fail' },
      'live server · status', vin ? `${vin.builder || 'continuum views'}` : marts);
    return out;
  }
  function asTable() {
    const runs = runIds();
    const cols = [{ l: 'Assumption' }].concat(runs.map(id => ({ l: runLabel(id) })), [{ l: 'Source' }, { l: 'Vintage' }]);
    if (!AS) return { cols, rows: [] };
    return { cols, rows: asRows().map(r => [r.label].concat(runs.map(id => r.cells[id].t), [r.source, r.vintage])) };
  }
  function buildAssume(host, cx) {
    AS = asReq();
    const note = H('div', 'gsc-note csh-method'); note.hidden = true;
    note.appendChild(H('p', null, 'One column per solved run, one row per input, each with its source and vintage. A value neither the live server nor this build carries is written "not served" with the table it lives in; nothing is filled from another run or typed in. The PROBE 5- and 10-year fleets are the runs\' own ISO dispatch sets (econ max > 0); the PCR fleets are the PCR resource table\'s capacity.'));
    const p = mount(host, cx, 'cs-assume', {
      id: 'cs-assume', title: 'Run assumptions', controls: [infoBtn('cs-assume', note)],
      faceText: `every solved run · ${runIds().length} runs · each row with its source and vintage`,
      draw: b => drawAssume(b, note),
    }, asTable);
  }
  function drawAssume(b, note) {
    b.innerHTML = '';
    const runs = runIds();
    if (!runs.length) { const d = H('div', 'gsc-empty'); d.appendChild(H('b', null, 'No runs in this build')); d.appendChild(H('p', null, 'cathy.meta.scenarios lists no solved run, so there is nothing to describe. Re-export the data block.')); b.appendChild(d); return; }
    const rows = asRows();
    const wrap = H('div', 'gsc-scroll csh-as'); wrap.setAttribute('data-cs-state', rows.some(r => Object.values(r.cells).some(c => c.s === 'loading')) ? 'loading' : 'ok');
    const tb = H('table', 'gsc-tbl csh-as-tbl'); tb.setAttribute('data-cs-assume', 'runs');
    const th = H('thead'), tr = H('tr');
    tr.appendChild(H('th', 'csh-as-k', 'Assumption'));
    const focus = ST().csFocus;
    runs.forEach(id => { const c = H('th', null, runLabel(id)); c.setAttribute('data-run', id); if (id === focus) { c.setAttribute('data-cs-focus', 'true'); c.classList.add('csh-focus'); } tr.appendChild(c); });
    tr.appendChild(H('th', 'csh-as-s', 'Source · vintage'));
    th.appendChild(tr); tb.appendChild(th);
    const bd = H('tbody');
    rows.forEach(r => {
      const x = H('tr'); x.setAttribute('data-cs-row', r.k);
      x.appendChild(H('td', 't', r.label));
      runs.forEach(id => { const c = r.cells[id]; const td = H('td', `csh-c csh-${c.s}${id === focus ? ' csh-focus' : ''}`, c.t); td.setAttribute('data-run', id); if (c.why) td.title = c.why; x.appendChild(td); });
      const s = H('td', 'csh-src-c'); s.setAttribute('data-cs-src', r.k);
      s.appendChild(H('span', null, r.source));
      const v = H('span', 'csh-vin-c', r.vintage); v.setAttribute('data-cs-vin', r.k); s.appendChild(v);
      x.appendChild(s);
      bd.appendChild(x);
    });
    tb.appendChild(bd); wrap.appendChild(tb); b.appendChild(wrap);
    const ns = rows.filter(r => Object.values(r.cells).some(c => c.s === 'not-served')).map(r => r.label);
    b.appendChild(H('div', 'gsc-note', `${rows.length} rows × ${runs.length} runs · not in the runs we hold for at least one run: ${ns.join(' · ') || 'none'}. Source and vintage per row behind (i).`));
    b.appendChild(note);
  }

  /* ── registration (GSContinuum, S0) ────────────────────────────────────── */
  const REG = [
    { k: 'cs-pvg', label: 'Price vs generation', screen: 'shape', module: 'ext/62', scenario: 'applied', build: buildPvg },
    { k: 'cs-capture', label: 'Capture by year', screen: 'shape', module: 'ext/62', scenario: 'applied', build: buildCapture },
    { k: 'cs-assume', label: 'Run assumptions', screen: 'assumptions', module: 'ext/62', scenario: 'not-applied',
      why: 'assumptions are the runs\' own inputs; a proxy is a price factor applied after the solve, not a re-solved run — the Proxy scenarios row states how each run is scaled', build: buildAssume },
  ];
  REG.forEach(v => C.register(v));
  /* the screens' "planned" lists stop naming what is now built (S0 states planned panels as a written empty state) */
  REG.forEach(v => { const w = C.workflowOf(v.screen); if (w && Array.isArray(w.planned)) w.planned = w.planned.filter(p => p.panel !== v.label); });

  root.GSContinuumShape = {
    version: 'continuum S1-S3 2026-10-06',
    fuelFor, runLabel, basisRun,
    get cache() { return [...CACHE.values()].map(e => ({ kind: e.kind, p: Object.assign({}, e.p), state: e.state, asks: e.gen })); },
    get asked() { return ASKED; },
    retry: retryAll, refresh: refreshAll,
  };
})(window);
