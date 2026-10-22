/* VENDORED from live Studio ext/64-continuum-value.js (snapshot 2026-10-11, sha256 1eb5c989f00fb560).
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/continuum/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   ext: 64-continuum-value.js — the LMP Continuum's Value screen (continuum S5-S6 2026-10-06).

   Dossier: design/10-build-slices.md S5 + S6 · 05-ui/wireframes.md §Value · 08 (A11, A12, A13, A15, F4) ·
   D-002 (proxy scenarios) · D-003 (OPEN: straight-line fill between solved years is the default, drawn hollow and
   labelled; Hold nearest / None are a visible toggle) · D-004 (CA defaults, each labelled with source and vintage,
   per-project override kept in the browser) · design/build-logs/S5-data.md (the route and its sample values).

   Owns only this file and 64-continuum-value.css. Registers two views on the Value workflow screen through
   GSContinuum (ext/59); draws nothing anywhere else.

     value-profit   Case and returns (asset, size, COD, fill; NPV · IRR · LCOE tiles) · Profit over time (stacked
                    revenue vs cost by year 2020–2050, net-margin line, settled solid / solved dashed / filled years
                    hollow, the settled→forecast handover marked) · Margin by scenario (Base + proxies at the solved
                    horizons; the 2035 two-run range) · Cost inputs (CA defaults with source + vintage; overrides)
     value-net      Net of interconnection ($/kW-yr after the network-upgrade annuity) · Nearby buses ranked (+ map)

   Data: GET /api/v2/continuum/profitability through GSContinuum.api (every call resolves to a state; never throws).
   The first open in a browser asks the server nothing — the reader presses "Load profitability" (the S0 rule: a
   fetch nobody asked for logs a console error when the route is not mounted). After one successful read this
   browser reads on every open (localStorage gs.continuum.value.ok). Results are kept per request; a new main case
   repaints the screen once, the scenario and nearby reads fill their panels in place.

   window.GSContinuumValue   {set(patch), reset(), busy, nearby(bus, fuel, mw), ui, results()} — the test surface.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const C = root.GSContinuum;
  if (!C || typeof C.register !== 'function') return;

  const PATH = '/api/v2/continuum/profitability';
  /* the nearby rule — tools/record_continuum_value_fixtures.py holds the same three constants (a test asserts it) */
  const NEARBY_K = 6;
  const EARTH_MI = 3958.8;
  const NETWORK_CASE = {
    solar: ['summer_peak', 'injection'], wind: ['summer_peak', 'injection'], hybrid: ['summer_peak', 'injection'],
    bess: ['summer_peak', 'discharge'], dc: ['large_load', 'charge'],
  };
  /* the node headroom field for each network case (GS.nodes columns) */
  const HEADROOM = { injection: 'hr_sp_dis', discharge: 'hr_sp_dis', charge: 'hr_ll_chg' };
  const CASE_WORD = { summer_peak: 'summer peak', large_load: 'large load' };
  const FUELS = [
    { v: 'solar', l: 'Solar' }, { v: 'wind', l: 'Wind' }, { v: 'bess', l: 'BESS' },
    { v: 'hybrid', l: 'Solar + storage' }, { v: 'dc', l: 'Data centre' },
  ];
  const MEASURED_MW = [100, 250];
  const COD_MIN = 2027, COD_MAX = 2050;
  const FILLS = [
    { v: 'interpolate', l: 'Straight line', t: 'A year with no solved run reads the straight line between the solved years either side (drawn hollow). The default while decision D-003 is open.' },
    { v: 'hold', l: 'Hold nearest', t: 'A year with no solved run reads the nearest solved year, as it is (drawn hollow).' },
    { v: 'none', l: 'None', t: 'A year with no solved run is not held: no bar, no margin, and NPV/IRR/LCOE say which years are missing.' },
  ];
  const SCEN_YEARS = [2030, 2035, 2040];
  /* the six overridable inputs this screen offers (the route takes 17; D-004 asks for these). Ranges are the
     route's own (concern_profitability_api.OVERRIDES), so a value refused here would be refused there too. */
  const OV = [
    { k: 'discount_pct', l: 'Discount rate', u: '%', lo: 0, hi: 25, from: ['inputs', 'discount_pct'] },
    { k: 'capex_usd_per_kw', l: 'Capex', u: '$/kW', lo: 0, hi: 20000, from: ['inputs', 'capex_usd_per_kw'], not: ['dc'] },
    { k: 'itc_pct', l: 'ITC', u: '%', lo: 0, hi: 60, from: ['inputs', 'itc_pct'], not: ['dc'] },
    { k: 'ptc_usd_per_mwh', l: 'PTC', u: '$/MWh', lo: 0, hi: 100, from: ['inputs', 'ptc_usd_per_mwh'], not: ['dc', 'bess'] },
    { k: 'rec_usd_per_mwh', l: 'REC price', u: '$/MWh', lo: 0, hi: 200, from: ['revenue_inputs', 'rec_usd_per_mwh'], not: ['dc', 'bess'] },
    { k: 'capacity_usd_kw_month', l: 'Capacity price', u: '$/kW-month', lo: 0, hi: 30, from: ['revenue_inputs', 'capacity_forward_usd_kw_month'] },
  ];
  /* S5-fixes (power review §2): regulation is its own battery stream, on by default; the route switches it off with
     overrides {"regulation": false}. Offered only when the body carries revenue_inputs.regulation, so the switch
     never appears for an asset the route does not stack it for. */
  const REG = { k: 'regulation', l: 'Regulation stream', from: ['revenue_inputs', 'regulation'] };
  const hasReg = P => !!(P && P.body && P.body.revenue_inputs && P.body.revenue_inputs.regulation);
  const ovWord = (k, v) => k === REG.k ? (v === false ? 'off' : 'on') : v;
  const STREAMS = {
    gen: [
      { k: 'energy', l: 'Energy', c: 'var(--s1)', sign: 1 },
      { k: 'capacity', l: 'Capacity', c: 'var(--s3)', sign: 1 },
      { k: 'rec', l: 'REC', c: 'var(--s6)', sign: 1 },
      { k: 'reserves', l: 'Reserves', c: 'var(--s5)', sign: 1 },
      /* S5-fixes 2026-10-06: the route stacks regulation (battery, default on) and PTC (gen, when overridden) as their
         own streams; without them the bars stop summing to revenue. s8 is the one hue left; the two meet only on a
         hybrid with a PTC override. */
      { k: 'regulation', l: 'Regulation', c: 'var(--s8)', sign: 1 },
      { k: 'ptc', l: 'PTC', c: 'var(--s8)', sign: 1 },
    ],
    dc: [
      { k: 'energy', l: 'Energy cost', c: 'var(--s1)', sign: 1 },
      { k: 'capacity', l: 'Capacity cost', c: 'var(--s3)', sign: 1 },
    ],
    cost: [
      { k: 'capex_annuity', l: 'Capex annuity', c: 'var(--s2)' },
      { k: 'om', l: 'O&M', c: 'var(--s4)' },
      { k: 'network_annuity', l: 'Network annuity', c: 'var(--s7)' },
    ],
  };
  const SCEN_COLOUR = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];

  /* ── storage ───────────────────────────────────────────────────────────── */
  const K_OK = 'gs.continuum.value.ok', K_UI = 'gs.continuum.value.ui.v1', K_OV = 'gs.continuum.value.ov.v1';
  const rd = (k, d) => { try { const v = root.localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const wr = (k, v) => { try { root.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage refused */ } };
  const UI = Object.assign({ fuel: null, mw: 100, duration: 4, cod: 2029, fill: 'interpolate', mwFor: {} }, rd(K_UI, {}));
  /* S-nav 2026-10-07 (review P2 11): the asset is the project's — a stored asset from an earlier session is not
     carried (GSContinuumValue.set({fuel}) still overrides it for one page, the gate's lever); the size is the project's
     option size unless the reader set one for this project (mwFor) */
  UI.fuel = null;
  if (!UI.mwFor || typeof UI.mwFor !== 'object') UI.mwFor = {};
  const saveUI = () => wr(K_UI, Object.assign({}, UI, { fuel: null }));
  let ASKED = false;   // a read was asked for in this page (Retry)
  /* S-nav 2026-10-07: one live connection for the whole Continuum (GSContinuum.live) replaces "Load profitability" */
  const allowed = () => ASKED || (C.live && C.live.allowed()) || (() => { try { return !!root.localStorage.getItem(K_OK); } catch (e) { return false; } })();

  /* ── small helpers ─────────────────────────────────────────────────────── */
  const NS = 'http://www.w3.org/2000/svg';
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function sv(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(k => { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  const MINUS = '−';
  const neg = s => s.replace(/^-/, MINUS);
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const fmt = {
    m: v => isNum(v) ? neg(`${v < 0 ? '-' : ''}$${Math.abs(v / 1e6).toFixed(2)}M`) : 'not held',
    m4: v => isNum(v) ? +(v / 1e6).toFixed(4) : null,
    pct: (v, dp = 2) => isNum(v) ? neg(`${(v * 100).toFixed(dp)} %`) : 'not held',
    usd: (v, dp = 2) => isNum(v) ? neg(`${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(dp)}`) : 'not held',
    kw: v => isNum(v) ? neg(`${v < 0 ? '-' : ''}$${Math.abs(v).toFixed(2)}`) : 'not held',
    int: v => isNum(v) ? Math.round(v).toLocaleString('en-US') : '—',
    num: (v, dp) => isNum(v) ? neg(v.toFixed(dp)) : '—',
  };
  const isLoad = f => f === 'dc';
  const sortedJson = o => JSON.stringify(Object.keys(o).sort().reduce((a, k) => { a[k] = o[k]; return a; }, {}));
  function niceStep(span, n) {
    const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function ticks(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; }
    const st = niceStep(hi - lo, n || 5), a = Math.floor(lo / st) * st, b = Math.ceil(hi / st) * st, out = [];
    for (let v = a; v <= b + st / 2; v += st) out.push(+v.toFixed(10));
    return { lo: a, hi: b, list: out, step: st };
  }

  /* ── the case ──────────────────────────────────────────────────────────── */
  function projectId() { try { return (root.App && root.App.state && root.App.state.projectId) || 'none'; } catch (e) { return 'none'; } }
  function projectMw() { try { const o = root.App && root.App.option && root.App.option(); const v = o ? +o.sizeMW : NaN; return Number.isFinite(v) && v > 0 ? v : null; } catch (e) { return null; } }
  /** the size this paint reads: the reader's size for this project, else the project's own */
  function syncSize() { const own = UI.mwFor[projectId()]; UI.mw = isNum(own) ? own : (projectMw() || 100); return UI.mw; }
  function setSize(v) { UI.mwFor = Object.assign({}, UI.mwFor, { [projectId()]: v }); UI.mw = v; saveUI(); }
  function fuelNow() {
    if (UI.fuel && NETWORK_CASE[UI.fuel]) return UI.fuel;
    const s = C.state(), a = s && s.asset;
    return a && NETWORK_CASE[a.fuel] ? a.fuel : 'solar';
  }
  const ovKey = fuel => `${projectId()}|${fuel}`;
  const overridesFor = fuel => Object.assign({}, (rd(K_OV, {}) || {})[ovKey(fuel)] || {});
  function setOverrides(fuel, o) {
    const all = rd(K_OV, {}) || {};
    if (o && Object.keys(o).length) all[ovKey(fuel)] = o; else delete all[ovKey(fuel)];
    wr(K_OV, all);
  }
  function scenNow() {
    const S = C.scen;
    if (!S || S.state !== 'ok') return 'base';
    const id = S.current();
    return S.entry(id) ? id : 'base';
  }
  /** the query exactly as the route takes it; tools/record_continuum_value_fixtures.params is the same rule */
  function params(bus, fuel, sid) {
    const p = { bus, fuel, mw: UI.mw, cod: UI.cod, fill: UI.fill };
    if (fuel === 'bess') p.duration = UI.duration;
    if (sid && sid !== 'base') p.scenario = sid;
    const ov = overridesFor(fuel);
    if (Object.keys(ov).length) p.overrides = sortedJson(ov);
    return p;
  }
  const keyOf = p => sortedJson(Object.keys(p).reduce((a, k) => { a[k] = String(p[k]); return a; }, {}));

  /* ── nearby: buses with a price series and a network entry at the case, nearest first ───────────────── */
  function miles(a, b) {
    const r = x => x * Math.PI / 180;
    const h = Math.sin((r(b.lat) - r(a.lat)) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin((r(b.lon) - r(a.lon)) / 2) ** 2;
    return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const costSec = () => (root.GS_DATA_EXT && root.GS_DATA_EXT.cost) || null;
  const nodeOf = id => (root.GS && typeof root.GS.node === 'function' ? root.GS.node(Number(id)) : null) || null;
  const pricedBuses = () => { const d = root.GSCathy && root.GSCathy.data; return d && d.bus_annual ? Object.keys(d.bus_annual).map(Number) : []; };
  function nearby(bus, fuel, mw) {
    const [cs, dir] = NETWORK_CASE[fuel] || NETWORK_CASE.solar;
    const size = MEASURED_MW.includes(+mw) ? +mw : 100;
    const here = nodeOf(bus), cost = costSec();
    if (!here || !isNum(here.lat) || !isNum(here.lon) || !cost) return [];
    const cand = [];
    pricedBuses().forEach(b => {
      if (b === +bus) return;
      const n = nodeOf(b);
      if (!n || !isNum(n.lat) || !isNum(n.lon) || !(`${b}|${cs}|${dir}|${size}` in cost)) return;
      cand.push([Math.round(miles(here, n) * 1e9) / 1e9, b]);
    });
    cand.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
    return cand.slice(0, NEARBY_K).map(c => c[1]);
  }
  /** this bus's network cost against every bus the transfer screen priced at the same case and size */
  function networkRank(bus, fuel, mw) {
    const cost = costSec(); if (!cost || !MEASURED_MW.includes(+mw)) return null;
    const [cs, dir] = NETWORK_CASE[fuel];
    const suf = `|${cs}|${dir}|${+mw}`;
    const val = k => { let e = cost[k]; if (typeof e === 'string') e = cost[e]; return e && isNum(e.per_kw) ? e.per_kw : null; };
    const all = []; let mine = null;
    Object.keys(cost).forEach(k => { if (!k.endsWith(suf)) return; const v = val(k); if (v == null) return; all.push(v); if (k === `${bus}${suf}`) mine = v; });
    if (mine == null) return { n: all.length, rank: null };
    return { n: all.length, rank: 1 + all.filter(v => v < mine).length, at: mine, zero: all.filter(v => v === 0).length, case: cs, dir };
  }

  /* ── the request queue: main first, then scenarios, then the nearby buses; three in flight ─────────── */
  const DONE = new Map();     // key -> GSContinuum.api result (ok or a failure state)
  const QUEUED = new Map();   // key -> {p, prio, fresh}
  const INFL = new Set();
  let RUNNING = 0, MAXRUN = 3;
  let CURMAIN = null;         // the key the screen was last built for
  const LAST_OK = {};         // fuel -> the last body read: the CA defaults the inputs form shows when a case is refused
  function want(p, prio, fresh) {
    const k = keyOf(p);
    if (DONE.has(k) || INFL.has(k) || QUEUED.has(k)) return k;
    QUEUED.set(k, { p, prio, fresh: !!fresh });
    pump();
    return k;
  }
  function pump() {
    while (RUNNING < MAXRUN && QUEUED.size) {
      const [k, j] = [...QUEUED.entries()].sort((a, b) => a[1].prio - b[1].prio)[0];
      QUEUED.delete(k); INFL.add(k); RUNNING++;
      C.api.get(PATH, j.p, j.fresh ? { fresh: true } : undefined).then(res => {
        DONE.set(k, res);
        if (res.ok) { try { root.localStorage.setItem(K_OK, String(Date.now())); } catch (e) { /* storage refused */ } }
      }).catch(e => {
        DONE.set(k, { ok: false, state: 'server-error', why: `the request failed in the page: ${(e && e.message) || e}` });
      }).finally(() => {
        RUNNING--; INFL.delete(k);
        arrived(k);
        pump();
      });
    }
  }
  const busy = () => RUNNING > 0 || QUEUED.size > 0 || PAINT_DUE;
  const res = p => DONE.get(keyOf(p)) || null;

  /* a new main result repaints the screen once (faces, titles and CSV headers carry its numbers); the rest fill
     their own panels in place, so a reader who has scrolled to the ranking is not thrown back to the top */
  let PAINT_DUE = false;
  const SLOTS = new Map();    // panel id -> {run(), sig()}
  function onValue() { const st = C.st; return !!(st && String(st.screen) === 'wf:value' && C.active()); }
  function arrived(k) {
    if (!onValue()) return;
    if (k === CURMAIN) { repaintKeepScroll(); return; }
    /* a progressive panel shown as a table was painted by the host, not by its slot: repaint once for it */
    const st = C.st;
    if (st && st.tables && (st.tables['value-scen'] || st.tables['value-rank']) && !busyReads()) { repaintKeepScroll(); return; }
    SLOTS.forEach(s => { try { s.run(); } catch (e) { console.warn('[value] refresh: ' + ((e && e.message) || e)); } });
  }
  const busyReads = () => RUNNING > 0 || QUEUED.size > 0;
  function repaintKeepScroll() {
    if (PAINT_DUE) return;
    PAINT_DUE = true;
    setTimeout(() => {
      PAINT_DUE = false;
      if (!onValue()) return;
      const scr = document.getElementById('gsc-screen'), top = scr ? scr.scrollTop : 0;
      try { C.bound.paint(); } finally { const s2 = document.getElementById('gsc-screen'); if (s2) s2.scrollTop = top; }
    }, 20);
  }

  /* ── the plan of one paint ─────────────────────────────────────────────── */
  function plan(cx) {
    syncSize();
    const sc = cx.scope();
    const fuel = fuelNow();
    const out = { fuel, load: isLoad(fuel), sc, sid: scenNow(), ov: overridesFor(fuel) };
    if (!sc || sc.kind !== 'bus') { out.state = 'zone'; return out; }
    out.bus = Number(sc.key);
    out.main = params(out.bus, fuel, out.sid);
    out.mainKey = keyOf(out.main);
    out.near = nearby(out.bus, fuel, UI.mw);
    if (!allowed()) { out.state = 'first-open'; return out; }
    want(out.main, 0);
    const S = C.scen;
    out.scens = S && S.state === 'ok' ? S.list().map(e => e.id) : null;
    if (out.scens) out.scens.forEach(id => want(params(out.bus, fuel, id), 1));
    out.near.forEach(b => want(params(b, fuel, out.sid), 2));
    CURMAIN = out.mainKey;
    const r = res(out.main);
    out.res = r; out.body = r && r.ok ? r.body : null;
    if (out.body) LAST_OK[fuel] = out.body;
    out.state = !r ? 'loading' : r.ok ? 'ok' : r.state;
    return out;
  }

  /* ── reading a body ────────────────────────────────────────────────────── */
  const yearsOf = b => (b && Array.isArray(b.years)) ? b.years : [];
  function streamsOf(fuel, b) {
    if (isLoad(fuel)) return STREAMS.dc;
    const held = new Set(); yearsOf(b).forEach(y => Object.keys(y.streams || {}).forEach(k => held.add(k)));
    return STREAMS.gen.filter(s => held.has(s.k));
  }
  function costParts(y) {
    const c = y.costs || {};
    const om = (isNum(c.fom) ? c.fom : 0) + (isNum(c.vom) ? c.vom : 0);
    return { capex_annuity: isNum(c.capex_annuity) ? c.capex_annuity : null, om: (isNum(c.fom) || isNum(c.vom)) ? om : null,
      network_annuity: isNum(c.network_annuity) ? c.network_annuity : null };
  }
  const runWord = id => (C.scen && C.scen.runWord) ? C.scen.runWord(id) : String(id);
  function kindWord(y) {
    switch (y.kind) {
      case 'settled': return y.partial ? 'settled (part year)' : 'settled';
      case 'solved': return `solved run ${runWord(y.run)}`;
      case 'escalated': return `escalated from ${runWord(y.run)}`;
      case 'interpolated': return 'straight line between solved years';
      case 'held': return `held from ${y.from_year}`;
      case 'not_held': return 'not held';
      default: return y.kind || '';
    }
  }
  const lastSettled = b => yearsOf(b).filter(y => y.kind === 'settled').reduce((m, y) => Math.max(m, y.year), -Infinity);
  function seamOf(b, fuel) {
    if (fuel !== 'bess') return null;
    const ys = yearsOf(b);
    const full = ys.filter(y => y.kind === 'settled' && !y.partial && y.price && isNum(y.price.spread_usd_mwh)).pop();
    const firstRun = ys.find(y => y.kind === 'solved' && y.price && isNum(y.price.spread_usd_mwh));
    if (!full || !firstRun) return null;
    return { from: full, to: firstRun, ratio: firstRun.price.spread_usd_mwh / full.price.spread_usd_mwh, tb: `TB${b.duration_h || UI.duration}` };
  }
  /** $/kW-yr over the operating window — the S6 measure (the gate's oracle computes it independently) */
  function perKw(b, fuel) {
    if (!b) return null;
    const kw = b.mw * 1000, cf = b.cash_flows || [];
    const load = isLoad(fuel);
    const held = cf.length && cf.every(c => isNum(c.revenue) && (load || (isNum(c.fom) && isNum(c.vom))));
    const op = held ? cf.reduce((s, c) => s + c.revenue - (c.fom || 0) - (c.vom || 0), 0) / cf.length / kw : null;
    const n = b.network || {};
    const network = n.measured && isNum(n.annuity_usd) ? n.annuity_usd / kw : null;
    const net = op != null && network != null ? op - network : null;
    const capex = b.costs && isNum(b.costs.capex_annuity_usd) ? b.costs.capex_annuity_usd / kw : null;
    return { op, network, net, after: net != null && capex != null ? net - capex : null, capex, why: held ? null : (cf.length ? 'a year in the operating window is not held' : 'no operating window') };
  }
  /* cost basis 2026-10-07 (Ganesh): the network cost reads the HEADLINE element set. The face carries the compact
     line once; the six sentences and the 2026-05 study comparison sit behind the (i) — a comparison, never a range.
     A case that reaches only elements the vendor does not price is "cost not held", never $0. */
  const CB_LINE_DEFAULT = 'per-mile rate card, no base year · upper bound per facility · not an allocation · excludes POI/gen-tie · thermal screen · vintage unconfirmed';
  const cbLine = n => (n && n.label_line) || CB_LINE_DEFAULT;
  function cbNote(n) {   /* the (i): six sentences + the comparison line, as HTML */
    const esc = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const six = ((n && n.labels) || []).map(x => `<li>${esc(x.detail)}</li>`).join('');
    const c = n && n.comparison, at = n && (n.mw_measured || n.mw_requested);
    const cmp = !c ? '' : `Other vendor vintage (${esc(c.name || 'study 2026-05')}) at ${at} MW: ${isNum(c.total_usd) ? fmt.m(c.total_usd) : esc(c.status || 'not held')}`
      + `${c.status && isNum(c.total_usd) && c.status !== 'measured' ? ` (${esc(c.status)})` : ''} — ${esc(c.role || 'comparison only — never the low end of a range')}.`;
    return `<b>Network cost basis</b> — ${esc((n && n.element_set) === 'headline' ? 'headline element set (ISO-NE GRIDSENSE DATA)' : 'element set not stated')}.${six ? `<ul>${six}</ul>` : ''}${cmp ? `<div data-gscv-costcmp="1">${cmp}</div>` : ''}`;
  }
  function networkShort(n) {
    if (!n) return 'not read';
    if (n.cost_status === 'cost_not_held') return 'cost not held';
    if (!n.measured) return `not held at ${UI.mw} MW`;
    if (n.total_usd === 0) return '$0 measured';
    return `${fmt.m(n.total_usd)} · ${n.elements_charged} element${n.elements_charged === 1 ? '' : 's'}`;
  }
  function networkWords(n) {
    if (!n) return 'not read';
    if (n.cost_status === 'cost_not_held') return n.label || 'cost not held';
    if (!n.measured) return n.reason || n.label || 'not measured';
    if (n.total_usd === 0) return `$0 measured: ${String(n.label || '').replace(/^\$0\.00:\s*/, '')}`;
    return n.label;
  }

  /* ── shared UI pieces ──────────────────────────────────────────────────── */
  function segCtl(name, label, opts, cur, onPick) {
    const w = el('div', 'gscv-field');
    w.appendChild(el('span', 'gscv-lbl', label));
    const g = el('div', 'gscv-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label); g.setAttribute('data-gscv-seg', name);
    opts.forEach(o => {
      const b = el('button', null, o.l); b.type = 'button'; b.dataset.v = String(o.v);
      b.setAttribute('aria-pressed', String(o.v) === String(cur) ? 'true' : 'false');
      if (o.t) b.title = o.t;
      if (o.disabled) { b.disabled = true; b.title = o.why || ''; } else b.onclick = () => onPick(o.v);
      g.appendChild(b);
    });
    w.appendChild(g);
    return w;
  }
  function stateBox(state, title, why, extra) {
    const d = el('div', 'gscv-state'); d.setAttribute('data-gscv-state', state);
    const b = el('div', 'gsc-empty');
    b.appendChild(el('b', null, title)); b.appendChild(el('p', null, why));
    if (extra) b.appendChild(extra);
    d.appendChild(b);
    return d;
  }
  function failWords(r) {
    if (!r) return ['Reading', ''];
    switch (r.state) {
      case 'server-error': return ['Live server erroring — HTTP ' + (r.status || ''), `${r.why}${r.detail ? ': ' + r.detail : ''}. Nothing from a previous case is left on screen.`];
      case 'no-route': return ['Profitability route not mounted', `${r.why}.`];
      case 'not-found': return ['Not held at this bus', `${r.why || 'the route holds nothing for this case'}.`];
      case 'bad-request': return ['The server refused this case', `${r.field ? r.field + ': ' : ''}${r.why}.`];
      case 'offline': return ['Live server offline', `${r.why}. The screen retries on the next open, or now with Retry.`];
      default: return ['Could not read', r.why || r.state];
    }
  }
  function retryBtn() {
    const b = el('button', 'gscv-btn', 'Retry'); b.type = 'button'; b.setAttribute('data-gscv-retry', '1');
    b.title = 'Ask the live server again for every read that failed';
    b.onclick = () => {
      [...DONE.entries()].forEach(([k, r]) => { if (!r.ok) DONE.delete(k); });
      C.api.reset();
      C.bound.paint();
    };
    return b;
  }
  /* S-nav 2026-10-07: "Load profitability" is retired — the Continuum's one "Connect live data" (top bar) reads it */
  /** the panel's state for the non-ok cases (zone, first open, loading, failures); null when ok */
  function notOk(P, what) {
    if (P.state === 'zone') return stateBox('zone', 'Pick a bus — this screen is per bus',
      `The scope is ${P.sc ? `${P.sc.kind} ${P.sc.key}` : 'not set'}. Profitability is read per plant at one bus; pick a bus in the list on the left.`);
    if (P.state === 'first-open') {
      return stateBox('first-open', what === 'profit' ? 'Live data not connected' : 'Not read yet',
        what === 'profit' ? `Profitability is read from the live GridSense server for this case and the ${NEARBY_K} nearest buses. Connect live data (top bar) once; this browser then reads it on every open.`
          : 'Waits for the live connection (top bar).', null);
    }
    if (P.state === 'loading') return stateBox('loading', 'Reading profitability', `Bus ${P.bus} · ${labelOfFuel(P.fuel)} ${UI.mw} MW · COD ${UI.cod}. The first read of a bus takes a few seconds; later reads are instant.`);
    if (P.state !== 'ok') {
      const [t, w] = failWords(P.res);
      const box = el('div', 'gscv-act'); box.appendChild(retryBtn());
      return stateBox(P.state, t, w, box);
    }
    return null;
  }
  const labelOfFuel = f => (FUELS.find(x => x.v === f) || {}).l || f;
  function legend(items) {
    const d = el('div', 'gscv-legend'); d.setAttribute('data-gscv-legend', '1');
    items.forEach(it => {
      const s = el('span');
      const i = el('i', it.cls || ''); if (it.c) i.style.color = it.c; if (it.c && !it.cls) i.style.background = it.c;
      s.appendChild(i); s.appendChild(document.createTextNode(it.l)); d.appendChild(s);
    });
    return d;
  }
  function svgFor(body, h) {
    const W = Math.max(320, Math.floor(body.clientWidth || body.getBoundingClientRect().width || 640) - 2);
    const svg = sv('svg', { class: 'gscv-svg', width: W, height: h, viewBox: `0 0 ${W} ${h}`, role: 'img' });
    return { svg, W };
  }
  function tableInto(host, t) {
    const sc = el('div', 'gscv-tw'); const tb = el('table', 'gscv-t');
    const th = el('thead'), tr = el('tr'); t.cols.forEach(c => tr.appendChild(el('th', null, c.l))); th.appendChild(tr); tb.appendChild(th);
    const bd = el('tbody');
    t.rows.forEach(r => { const x = el('tr'); r.forEach((v, i) => x.appendChild(el('td', i ? 'n' : null, v == null ? '—' : String(v)))); bd.appendChild(x); });
    tb.appendChild(bd); sc.appendChild(tb); host.appendChild(sc);
  }

  /* ══ S5 · Case and returns ══════════════════════════════════════════════ */
  function casePanel(cx, P) {
    const load = P.load;
    return cx.panel({ id: 'value-case', wide: true, title: load ? 'Case and load cost' : 'Case and returns',
      faceText: faceText(P, true),
      draw: body => {
        const w = el('div', 'gscv'); w.setAttribute('data-gscv', 'case');
        const row = el('div', 'gscv-row');
        /* S-nav 2026-10-07: the asset is the project's (the top bar's asset) — stated here, not a second control */
        const as = el('div', 'gscv-field'); as.setAttribute('data-gscv-asset', P.fuel);
        as.appendChild(el('span', 'gscv-lbl', 'Asset'));
        as.appendChild(el('span', 'gscv-fixed', `${labelOfFuel(P.fuel)}${UI.fuel ? ' · override' : ' · the project\'s'}`));
        row.appendChild(as);
        const pm = projectMw(), own = isNum(UI.mwFor[projectId()]);
        const size = segCtl('size', `Size${pm ? ` · project ${pm} MW` : ''}`, MEASURED_MW.map(m => ({ v: m, l: `${m} MW` })), UI.mw, v => { setSize(+v); C.bound.paint(); });
        if (own && pm && pm !== UI.mw) {
          const back = el('button', 'gscv-btn', 'Reset size'); back.title = `Reset to the project's ${pm} MW`; back.type = 'button'; back.setAttribute('data-gscv-mw-project', '1');
          back.onclick = () => { const m = Object.assign({}, UI.mwFor); delete m[projectId()]; UI.mwFor = m; saveUI(); C.bound.paint(); };
          size.appendChild(back);
        }
        const inp = el('input', 'gscv-in'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.setAttribute('data-gscv-mw', '1');
        inp.setAttribute('aria-label', 'Size · other (MW)'); inp.placeholder = 'other MW';
        inp.value = MEASURED_MW.includes(UI.mw) ? '' : String(UI.mw);
        const mwErr = el('span', 'gscv-err'); mwErr.setAttribute('data-gscv-err', 'mw');
        const commit = () => {
          const v = Number(String(inp.value).trim());
          if (!String(inp.value).trim()) return;
          if (!Number.isFinite(v) || v < 1 || v > 2000) { mwErr.textContent = 'Size must be 1–2,000 MW'; return; }
          setSize(Math.round(v * 1000) / 1000); C.bound.paint();
        };
        inp.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
        inp.addEventListener('change', commit);
        size.appendChild(inp); size.appendChild(mwErr);
        row.appendChild(size);
        if (P.fuel === 'bess') row.appendChild(segCtl('duration', 'Duration', [{ v: 2, l: '2 h' }, { v: 4, l: '4 h' }], UI.duration, v => { UI.duration = +v; saveUI(); C.bound.paint(); }));
        const cod = el('div', 'gscv-field'); cod.appendChild(el('span', 'gscv-lbl', 'COD'));
        const sel = el('select', 'gscv-sel'); sel.setAttribute('data-gscv-cod', '1'); sel.setAttribute('aria-label', 'COD');
        for (let y = COD_MIN; y <= COD_MAX; y++) { const o = el('option', null, String(y)); o.value = String(y); if (y === UI.cod) o.selected = true; sel.appendChild(o); }
        sel.onchange = () => { UI.cod = +sel.value; saveUI(); C.bound.paint(); };
        cod.appendChild(sel); row.appendChild(cod);
        const fill = segCtl('fill', 'Years without a run', FILLS.map(f => ({ v: f.v, l: f.v === 'interpolate' ? 'Straight line (default)' : f.l, t: f.t })), UI.fill, v => { UI.fill = v; saveUI(); C.bound.paint(); });
        const fn = el('span', 'gscv-note'); fn.setAttribute('data-gscv-fillnote', '1');
        fn.textContent = 'Default while decision D-003 is open; filled years are drawn hollow.';
        fill.title = fn.textContent;   // S-nav 2026-10-07: on hover, so the case's controls keep one row
        fill.appendChild(fn);
        row.appendChild(fill);
        w.appendChild(row);
        w.appendChild(kpis(P));
        body.appendChild(w);
      } });
  }
  function kpis(P) {
    const box = el('div', 'gscv-kpis');
    const tile = (k, label, value, v, sub) => {
      const t = el('div', 'gscv-kpi'); t.setAttribute('data-gscv-kpi', k); t.setAttribute('data-v', v == null ? '' : String(v));
      t.appendChild(el('span', 'gscv-kl', label)); t.appendChild(el('span', 'gscv-kv', value));
      if (sub) t.appendChild(el('span', 'gscv-ks', sub));
      box.appendChild(t); return t;
    };
    if (P.state !== 'ok') { box.appendChild(el('span', 'gscv-note', P.state === 'first-open' ? 'NPV, IRR and LCOE appear with live data.' : P.state === 'zone' ? '' : 'NPV, IRR and LCOE appear when the case is read.')); return box; }
    const b = P.body, m = b.metrics || {}, load = P.load;
    const disc = isNum(m.discount_pct) ? `${m.discount_pct.toFixed(2)} %` : 'not held';
    const win = Array.isArray(m.window) ? `${m.window[0]}–${m.window[1]}` : '';
    const tx = (Array.isArray(b.not_modelled) ? b.not_modelled : []).find(n => n && n.item === 'transmission');
    tile('npv', load ? 'PV of load cost' : 'NPV', fmt.m(m.npv_usd), isNum(m.npv_usd) ? m.npv_usd : null, `at ${disc} · ${m.life_yr || '—'} yr ${win}${m.includes_network ? ' · network included' : ''}${tx ? ' · before transmission' : ''}`);
    if (load) tile('irr', 'IRR', 'not applicable', null, 'a load has no return to solve for');
    else tile('irr', 'IRR', isNum(m.irr) ? fmt.pct(m.irr) : 'not defined', isNum(m.irr) ? m.irr : null,
      isNum(m.irr) ? `discount rate ${disc}` : (m.irr_note ? `${m.irr_note} · discount rate ${disc}` : `discount rate ${disc}`));
    const lcos = P.fuel === 'bess';
    if (load) tile('lcoe', 'LCOE', 'not applicable', null, 'a load has no generation to levelise over');
    else tile('lcoe', lcos ? 'LCOS' : 'LCOE', isNum(m.lcoe_usd_per_mwh) ? `${fmt.usd(m.lcoe_usd_per_mwh)}/MWh` : 'not held', isNum(m.lcoe_usd_per_mwh) ? m.lcoe_usd_per_mwh : null,
      lcos ? 'per discharged MWh, network included' : 'per MWh generated, network included');
    const c = b.costs || {};
    if (!load) tile('capex', 'Capex at COD', fmt.m(c.capex_total_usd), c.capex_total_usd, `${fmt.usd(c.capex_usd_per_kw_at_cod)}/kW${c.itc_pct ? ` after ${c.itc_pct} % ITC` : ''}`);
    { const n = b.network, nh = n && n.cost_status === 'cost_not_held';   /* cost basis 2026-10-07: upper bound · rate card */
      const t = tile('network', 'Network upgrade', n && n.measured ? fmt.m(n.total_usd) : nh ? 'cost not held' : 'not held', n ? n.total_usd : null,
        n && n.measured ? 'upper bound · rate card · POI/gen-tie not included' : nh ? 'an element the vendor does not price · never $0' : `measured at ${MEASURED_MW.join(' and ')} MW only`);
      t.title = cbLine(n); }
    if (tx) { const t = tile('transmission', 'Transmission', 'not modelled', null, 'RNS / Schedule 9 · every NPV here is before it'); t.title = tx.label || ''; }
    if (m.reason) { const w = el('div', 'gscv-why'); w.setAttribute('data-gscv-kpi-why', '1'); w.textContent = `NPV, IRR and LCOE not held: ${m.reason}`; box.appendChild(w); }
    return box;
  }
  function faceText(P, csv) {
    const parts = [];
    if (P.bus != null) { const n = nodeOf(P.bus); parts.push(`Bus ${n && n.name ? n.name + ' ' : ''}${P.bus}`); }
    parts.push(`${labelOfFuel(P.fuel)} ${UI.mw} MW${P.fuel === 'bess' ? ` ${UI.duration} h` : ''} · COD ${UI.cod}`);
    parts.push(`Scenario ${P.sid === 'base' ? 'Base' : (C.scen.short ? C.scen.short(P.sid) : P.sid)}`);
    parts.push(`Years without a run: ${(FILLS.find(f => f.v === UI.fill) || {}).l}`);
    const ov = Object.keys(P.ov || {});
    parts.push(ov.length ? `Cost inputs: User override (${ov.map(k => `${(OV.find(o => o.k === k) || (k === REG.k ? REG : {})).l || k} ${ovWord(k, P.ov[k])}`).join(', ')})` : 'Cost inputs: CA defaults');
    if (P.body) {
      parts.push(`Network: ${networkWords(P.body.network)}`);
      const v = P.body.vintage || {};
      if (csv) parts.push(`source ${PATH} · store ${v.store_mtime || 'not stated'} · costs ${v.cost_table || 'not stated'}`);
    }
    return parts.join(' · ');
  }
  function faceEl(P) {
    const f = el('div', 'gsc-face');
    faceText(P).split(' · ').forEach(t => f.appendChild(el('span', null, t)));
    return f;
  }

  /* ══ S5 · Profit over time ══════════════════════════════════════════════ */
  function profitRows(P) {
    const b = P.body; if (!b) return { cols: [], rows: [] };
    const st = streamsOf(P.fuel, b), load = P.load;
    const cols = [{ l: 'Year' }, { l: 'Kind' }, { l: 'Run' }].concat(st.map(s => ({ l: `${s.l} ($M)` })));
    if (load) cols.push({ l: 'Network annuity ($M)' }, { l: 'Net load cost ($M, cost −)' });
    else cols.push({ l: 'Revenue ($M)' }, { l: 'Capex annuity ($M)' }, { l: 'O&M ($M)' }, { l: 'Network annuity ($M)' }, { l: 'Net margin ($M)' });
    cols.push({ l: 'Note' });
    const rows = yearsOf(b).map(y => {
      const cp = costParts(y), s = y.streams || {};
      const r = [String(y.year), y.kind, y.run ? runWord(y.run) : (y.from_year ? `from ${y.from_year}` : '')]
        .concat(st.map(x => fmt.m4(s[x.k])));
      if (load) r.push(fmt.m4(cp.network_annuity == null ? null : -cp.network_annuity), fmt.m4(y.net_margin));
      else r.push(fmt.m4(y.revenue), fmt.m4(cp.capex_annuity == null ? null : -cp.capex_annuity), fmt.m4(cp.om == null ? null : -cp.om),
        fmt.m4(cp.network_annuity == null ? null : -cp.network_annuity), fmt.m4(y.net_margin));
      r.push([y.partial ? 'part year' : '', y.reason || '', y.cape && y.cape.applied ? y.cape.word : '', y.missing && y.missing.length ? `missing: ${y.missing.join(', ')}` : ''].filter(Boolean).join('; '));
      return r;
    });
    return { cols, rows, why: 'Nothing read for this case yet.' };
  }
  function profitPanel(cx, P) {
    const load = P.load;
    const face = faceEl(P);
    return cx.panel({ id: 'value-profit', wide: true, title: load ? 'Load cost over time' : 'Profit over time', face, faceText: faceText(P, true),
      sig: cx.sig ? cx.sig('profit', 'annual 2020–2050 · the case', UI.fill) : null,
      table: () => profitRows(P), csv: true,
      draw: body => {
        const w = el('div', 'gscv'); w.setAttribute('data-gscv', 'profit'); body.appendChild(w);
        const bad = notOk(P, 'profit'); if (bad) { w.appendChild(bad); return; }
        const sd = el('div'); sd.setAttribute('data-gscv-state', 'ok'); sd.hidden = true; w.appendChild(sd);
        drawProfit(w, P);
      } });
  }
  function drawProfit(w, P) {
    const b = P.body, fuel = P.fuel, load = P.load;
    const ys = yearsOf(b), st = streamsOf(fuel, b);
    const ls = lastSettled(b);
    /* the answer line: numbers, not a verdict */
    const y30 = ys.find(y => y.year === 2030), m = b.metrics || {};
    const ans = el('div', 'gscv-answer');
    ans.textContent = load
      ? `Net load cost 2030 ${fmt.m(y30 && y30.net_margin)} · PV over ${m.life_yr || '—'} years ${fmt.m(m.npv_usd)} at ${isNum(m.discount_pct) ? m.discount_pct.toFixed(2) + ' %' : '—'}`
      : `Net margin 2030 ${fmt.m(y30 && y30.net_margin)} · revenue ${fmt.m(y30 && y30.revenue)} · NPV ${fmt.m(m.npv_usd)} at ${isNum(m.discount_pct) ? m.discount_pct.toFixed(2) + ' %' : '—'}`;
    w.appendChild(ans);
    const leg = legend(st.map(s => ({ l: s.l, c: s.c })).concat(load ? [{ l: 'Network annuity', c: 'var(--s7)' }] : STREAMS.cost.map(s => ({ l: s.l, c: s.c })))
      .concat([{ l: load ? 'Net load cost' : 'Net margin', cls: 'gscv-line', c: 'var(--ink)' },
        { l: 'solid = settled', cls: 'gscv-k-solid' }, { l: 'dashed = solved run', cls: 'gscv-k-dash' },
        { l: UI.fill === 'interpolate' ? 'hollow = straight line between solved years, or held / escalated' : UI.fill === 'hold' ? 'hollow = held from the nearest solved year, or escalated' : 'hollow = escalated · blank = not held', cls: 'gscv-k-hollow' }]));
    w.appendChild(leg);
    const host = el('div', 'gscv-chart'); w.appendChild(host);
    const H = 300, { svg, W } = svgFor(w, H);
    svg.setAttribute('data-gscv-chart', 'profit');
    svg.setAttribute('aria-label', `${load ? 'Load cost' : 'Revenue, cost and net margin'} by year ${ys.length ? ys[0].year + '–' + ys[ys.length - 1].year : ''}`);
    const PAD = { l: 58, r: 10, t: 22, b: 24 };
    /* stacks: positive streams up, costs down (a load's streams are already negative) */
    const stack = ys.map(y => {
      if (y.kind === 'not_held') return { y, up: [], dn: [] };
      const s = y.streams || {}, cp = costParts(y), up = [], dn = [];
      let a = 0, d = 0;
      st.forEach(x => { const v = s[x.k]; if (!isNum(v) || v === 0) return; if (v > 0) { up.push({ x, v0: a, v1: a + v }); a += v; } else { dn.push({ x, v0: d, v1: d + v }); d += v; } });
      (load ? [STREAMS.cost[2]] : STREAMS.cost).forEach(x => { const v = cp[x.k]; if (!isNum(v) || v === 0) return; dn.push({ x, v0: d, v1: d - v }); d -= v; });
      return { y, up, dn, top: a, bot: d };
    });
    const vals = [0];
    stack.forEach(s => { vals.push(s.top || 0, s.bot || 0); if (isNum(s.y.net_margin)) vals.push(s.y.net_margin); });
    const tk = ticks(Math.min(...vals) / 1e6, Math.max(...vals) / 1e6, 6);
    const X0 = PAD.l, X1 = W - PAD.r, Y0 = PAD.t, Y1 = H - PAD.b;
    const yv = v => Y1 - (v / 1e6 - tk.lo) / (tk.hi - tk.lo) * (Y1 - Y0);
    const band = (X1 - X0) / Math.max(1, ys.length), bw = Math.max(3, band * 0.68);
    const xc = i => X0 + band * i + band / 2;
    tk.list.forEach(t => {
      svg.appendChild(sv('line', { class: t === 0 ? 'gscv-zero' : 'gscv-grid', x1: X0, x2: X1, y1: yv(t * 1e6), y2: yv(t * 1e6) }));
      svg.appendChild(sv('text', { class: 'gscv-ax', x: X0 - 6, y: yv(t * 1e6) + 4, 'text-anchor': 'end' }, neg(`${t < 0 ? '-' : ''}${Math.abs(t).toLocaleString('en-US', { maximumFractionDigits: 2 })}`)));
    });
    svg.appendChild(sv('text', { class: 'gscv-ax', x: 4, y: 12 }, '$M per year, nominal'));
    /* the operating life NPV/IRR/LCOE read (every other year is drawn as if the plant ran that year) */
    const win = (b.metrics || {}).window;
    if (Array.isArray(win)) {
      const i0 = ys.findIndex(y => y.year === win[0]), i1 = ys.findIndex(y => y.year === win[1]);
      if (i0 >= 0 && i1 >= i0) {
        const g = sv('g', { 'data-gscv-life': `${win[0]}-${win[1]}` });
        g.appendChild(sv('rect', { class: 'gscv-life', x: (X0 + band * i0).toFixed(2), width: (band * (i1 - i0 + 1)).toFixed(2), y: Y0, height: Y1 - Y0 }));
        g.appendChild(sv('text', { class: 'gscv-ax', x: (X0 + band * (i1 + 1) - 4).toFixed(2), y: Y0 + 12, 'text-anchor': 'end' }, `operating life ${win[0]}–${win[1]} (NPV, IRR, ${fuel === 'bess' ? 'LCOS' : 'LCOE'})`));
        svg.appendChild(g);
      }
    }
    const style = y => y.kind === 'settled' ? 'settled' : y.kind === 'solved' ? 'solved' : 'hollow';
    stack.forEach((s, i) => {
      const y = s.y, cls = style(y);
      s.up.concat(s.dn).forEach(seg => {
        const ya = yv(seg.v0), yb = yv(seg.v1);
        const r = sv('rect', { class: `gscv-bar gscv-${cls}`, x: (xc(i) - bw / 2).toFixed(2), width: bw.toFixed(2), y: Math.min(ya, yb).toFixed(2), height: Math.max(0.5, Math.abs(yb - ya)).toFixed(2),
          'data-gscv-bar': '1', 'data-year': y.year, 'data-stream': seg.x.k, 'data-kind': y.kind });
        r.style.color = seg.x.c;
        r.appendChild(sv('title', null, `${y.year} · ${seg.x.l} ${fmt.m(seg.v1 - seg.v0)} · ${kindWord(y)}`));
        svg.appendChild(r);
      });
      const above = Math.min(yv(s.top || 0), yv(0)) - 5;
      if (y.kind === 'not_held' || (y.missing && y.missing.length)) {
        const t = sv('text', { class: 'gscv-ax gscv-nh', x: xc(i), y: above, 'text-anchor': 'middle' }, 'n/h');
        t.appendChild(sv('title', null, `${y.year}: ${y.reason || 'not held: ' + (y.missing || []).join(', ')}`));
        svg.appendChild(t);
      }
      const lab = (i % (band < 26 ? 5 : 2) === 0 || y.year === ls) ? `${y.year}${y.partial ? '*' : ''}` : null;
      if (lab) svg.appendChild(sv('text', { class: 'gscv-ax', x: xc(i), y: H - 8, 'text-anchor': 'middle' }, lab));
      if (y.cape && y.cape.applied) {
        const t = sv('text', { class: 'gscv-ax gscv-cape', x: xc(i), y: above - ((y.kind === 'not_held' || (y.missing && y.missing.length)) ? 12 : 0), 'text-anchor': 'middle' }, '⚑');
        t.appendChild(sv('title', null, y.cape.word)); svg.appendChild(t);
      }
    });
    /* the settled → forecast handover */
    const iLast = ys.findIndex(y => y.year === ls);
    if (iLast >= 0 && iLast < ys.length - 1) {
      const hx = X0 + band * (iLast + 1);
      const g = sv('g', { 'data-gscv-handover': '1', 'data-x': hx.toFixed(2) });
      g.appendChild(sv('line', { class: 'gscv-handover', x1: hx, x2: hx, y1: Y0 - 14, y2: Y1 }));
      g.appendChild(sv('text', { class: 'gscv-ax', x: hx - 4, y: Y0 - 4, 'text-anchor': 'end' }, `settled to ${ls}`));
      g.appendChild(sv('text', { class: 'gscv-ax', x: hx + 4, y: Y0 - 4 }, 'forecast →'));
      svg.appendChild(g);
    }
    /* the net-margin line: solid over settled years, dashed after; hollow markers on filled years */
    const pts = stack.map((s, i) => isNum(s.y.net_margin) ? { x: xc(i), y: yv(s.y.net_margin), yr: s.y } : null);
    const segs = []; let cur = null;
    pts.forEach(p => { if (!p) { cur = null; return; } const dash = p.yr.kind !== 'settled'; if (!cur || cur.dash !== dash) { const prev = cur && cur.pts[cur.pts.length - 1]; cur = { dash, pts: prev ? [prev] : [] }; segs.push(cur); } cur.pts.push(p); });
    segs.forEach(sg => { if (sg.pts.length < 2) return; svg.appendChild(sv('path', { class: `gscv-net${sg.dash ? ' gscv-net-dash' : ''}`, d: sg.pts.map((p, j) => `${j ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(''), 'data-gscv-net': '1' })); });
    pts.forEach(p => {
      if (!p) return;
      const hollow = !['settled', 'solved'].includes(p.yr.kind);
      const c = sv('circle', { class: `gscv-netpt${hollow ? ' gscv-netpt-h' : ''}`, cx: p.x.toFixed(2), cy: p.y.toFixed(2), r: 3, 'data-gscv-netpt': p.yr.year });
      c.appendChild(sv('title', null, `${p.yr.year} · ${load ? 'net load cost' : 'net margin'} ${fmt.m(p.yr.net_margin)} · ${kindWord(p.yr)}`));
      svg.appendChild(c);
    });
    host.appendChild(svg);
    /* notes: the seam, reserves, Cape, partial year, what a proxy never scales */
    const notes = el('div', 'gscv-notes');
    const seam = seamOf(b, fuel);
    if (seam) {
      const n = el('div', 'gscv-seam'); n.setAttribute('data-gscv-seam', '1');
      n.textContent = `Settled → run seam: ${seam.tb} spread settled ${seam.from.year} ${fmt.usd(seam.from.price.spread_usd_mwh)}/MWh → ${runWord(seam.to.run)} ${seam.to.year} ${fmt.usd(seam.to.price.spread_usd_mwh)}/MWh (ratio ${seam.ratio.toFixed(2)}). Battery energy revenue steps down at the handover.`;
      notes.appendChild(n);
    }
    /* the reserve year the forecast holds flat (else the last whole measured year) — A15 reads TMSR 2025 */
    const held = ys.find(y => y.reserves && y.reserves.kind === 'held');
    const resY = (held && ys.find(y => y.year === held.reserves.from_year && y.reserves && y.reserves.kind === 'measured'))
      || ys.filter(y => y.reserves && y.reserves.kind === 'measured' && !y.reserves.partial).pop();
    if (resY) {
      const r0 = resY.reserves;
      /* a body carrying schedule_hours is priced on the battery's own daily schedule (S5-fixes #1); an older body
         used the idle share, and the sentence says which one the numbers on screen came from */
      const how = isNum(r0.schedule_hours)
        ? `on the battery's own daily schedule (${r0.schedule_hours} h charging earn TMSR on the charging MW, ${r0.schedule_hours} h discharging earn none, idle hours min(1, SOC) × MW; perfect foresight, not co-optimised)`
        : '× the idle share (an upper bound, not co-optimised)';
      notes.appendChild(el('div', null, `Reserves: measured RT ${r0.product} at ${r0.region}, ${resY.year} mean ${fmt.usd(r0.mean_usd_mwh, 3)}/MWh over ${fmt.int(r0.hours)} h ${how}; one MW earns one reserve price, so TMNSR and TMOR are not added.${held ? ` ${held.reserves.note}.` : ''}`));
    }
    const regY = ys.find(y => y.regulation && y.regulation.on && isNum(y.streams && y.streams.regulation) && y.streams.regulation > 0);
    if (regY) {
      const ri = b.revenue_inputs || {}, sh = ri.reg_share && ri.reg_share.value, pr = regY.regulation.price_usd_mwh;
      notes.appendChild(el('div', null, `Regulation: ${isNum(sh) ? sh + ' % of ' : ''}the battery MW over idle hours${isNum(pr) ? ` at ${fmt.usd(pr)}/MW-h` : ''}, a thin market, never scaled by a proxy; those MW come off the idle-hour reserve MW.`));
    }
    else if (b.revenue_inputs && b.revenue_inputs.regulation && overridesFor(fuel)[REG.k] === false) notes.appendChild(el('div', null, 'Regulation: switched off (user override) — the idle-hour MW earn reserves only.'));
    (Array.isArray(b.not_modelled) ? b.not_modelled : []).forEach(n => {
      if (n && n.label) { const d = el('div', null, `Not modelled: ${n.label}`); d.setAttribute('data-gscv-notmodelled', n.item || ''); notes.appendChild(d); }
    });
    (Array.isArray(b.caveats) ? b.caveats : []).forEach(c => { if (typeof c === 'string' && c) notes.appendChild(el('div', 'gscv-caveat', `Caveat: ${c}`)); });
    const cape = ys.find(y => y.cape && y.cape.applied);
    if (cape) notes.appendChild(el('div', null, `⚑ ${cape.year}: ${cape.cape.word}.`));
    const part = ys.find(y => y.partial);
    if (part) notes.appendChild(el('div', null, `${part.year}* is a part year, read as held hours × the calendar.`));
    notes.appendChild(el('div', null, load
      ? 'Energy and capacity are costs to a load (shown below zero). A proxy scenario scales energy prices on solved and escalated years only; capacity prices and network cost are never scaled, and settled years never move.'
      : 'A proxy scenario scales energy prices and spreads on solved and escalated years only; capacity, REC, reserves and every cost are never scaled, and settled years never move. Capex and network upgrades are level annuities at the discount rate.'));
    w.appendChild(notes);
  }

  /* ══ S5 · Margin by scenario (interim: proxies; S10 replaces them with solved runs) ══════════════════ */
  function scenRows(P) {
    const cols = [{ l: 'Scenario' }, { l: 'Year' }, { l: P.load ? 'Net load cost ($M)' : 'Net margin ($M)' }, { l: P.load ? 'Energy and capacity cost ($M)' : 'Revenue ($M)' }, { l: P.load ? 'PV of load cost ($M)' : 'NPV ($M)' }, { l: 'Kind' }];
    const rows = [];
    (P.scens || []).forEach(id => {
      const r = res(params(P.bus, P.fuel, id)); if (!r || !r.ok) return;
      SCEN_YEARS.forEach(yr => {
        const y = yearsOf(r.body).find(x => x.year === yr); if (!y) return;
        rows.push([scenLabel(id), String(yr), fmt.m4(y.net_margin), fmt.m4(y.revenue), fmt.m4(r.body.metrics && r.body.metrics.npv_usd), y.kind]);
      });
    });
    return { cols, rows, why: C.scen && C.scen.state === 'ok' ? 'The scenario reads have not arrived.' : 'The scenario list is not loaded.' };
  }
  function scenLabel(id) {
    if (id === 'base') return 'Base';
    const e = C.scen.entry(id);
    return e && e.kind === 'proxy' ? `${C.scen.short(id)} · proxy` : (C.scen.short ? C.scen.short(id) : id);
  }
  function scenPanel(cx, P) {
    return cx.panel({ id: 'value-scen', title: P.load ? 'Load cost by scenario' : 'Margin by scenario', faceText: faceText(P, true), table: () => scenRows(P), csv: true,
      sig: cx.sig ? cx.sig('margin-by-scenario', 'solved horizons 2030 · 2035 · 2040', 'Base + proxies') : null,
      draw: body => slot('value-scen', body, () => `${P.mainKey}|${(P.scens || []).map(id => { const r = res(params(P.bus, P.fuel, id)); return r ? r.state : '-'; }).join(',')}`, b => drawScen(b, P)) });
  }
  function drawScen(body, P) {
    const w = el('div', 'gscv'); w.setAttribute('data-gscv', 'scen'); body.appendChild(w);
    const bad = notOk(P, 'scen'); if (bad) { w.appendChild(bad); w.appendChild(twoRun(P)); return; }
    if (!P.scens) {
      w.appendChild(stateBox('no-scenarios', 'Scenarios not loaded', 'Press "Load proxy scenarios" on the scenario row above: Base, High Gas, Low Gas and High Load are then read for this case and drawn side by side. The proxies are Base × one factor (illustrative proxy — not a PROBE run).'));
      w.appendChild(twoRun(P)); return;
    }
    const got = P.scens.map(id => ({ id, r: res(params(P.bus, P.fuel, id)) }));
    const done = got.filter(g => g.r).length;
    if (done < got.length) w.appendChild(el('div', 'gscv-note', `Reading ${done} of ${got.length} scenarios…`));
    const ok = got.filter(g => g.r && g.r.ok);
    got.filter(g => g.r && !g.r.ok).forEach(g => w.appendChild(el('div', 'gscv-note', `${scenLabel(g.id)}: ${failWords(g.r)[0]} — ${g.r.why || ''}`)));
    if (ok.length) {
      w.appendChild(legend(ok.map((g, i) => ({ l: scenLabel(g.id), c: SCEN_COLOUR[P.scens.indexOf(g.id) % SCEN_COLOUR.length] }))));
      const H = 220, { svg, W } = svgFor(w, H);
      svg.setAttribute('data-gscv-scen-chart', '1');
      svg.setAttribute('aria-label', `${P.load ? 'Net load cost' : 'Net margin'} by scenario at ${SCEN_YEARS.join(', ')}`);
      const PAD = { l: 58, r: 8, t: 14, b: 22 };
      const vals = [0];
      ok.forEach(g => SCEN_YEARS.forEach(yr => { const y = yearsOf(g.r.body).find(x => x.year === yr); if (y && isNum(y.net_margin)) vals.push(y.net_margin); }));
      const tk = ticks(Math.min(...vals) / 1e6, Math.max(...vals) / 1e6, 5);
      const X0 = PAD.l, X1 = W - PAD.r, Y0 = PAD.t, Y1 = H - PAD.b;
      const yv = v => Y1 - (v / 1e6 - tk.lo) / (tk.hi - tk.lo) * (Y1 - Y0);
      tk.list.forEach(t => {
        svg.appendChild(sv('line', { class: t === 0 ? 'gscv-zero' : 'gscv-grid', x1: X0, x2: X1, y1: yv(t * 1e6), y2: yv(t * 1e6) }));
        svg.appendChild(sv('text', { class: 'gscv-ax', x: X0 - 6, y: yv(t * 1e6) + 4, 'text-anchor': 'end' }, neg(`${t < 0 ? '-' : ''}${Math.abs(t).toLocaleString('en-US', { maximumFractionDigits: 2 })}`)));
      });
      svg.appendChild(sv('text', { class: 'gscv-ax', x: 4, y: 11 }, '$M'));
      const group = (X1 - X0) / SCEN_YEARS.length, bw = Math.min(28, group * 0.8 / Math.max(1, ok.length));
      SCEN_YEARS.forEach((yr, gi) => {
        const gx = X0 + group * gi + group / 2;
        ok.forEach((g, i) => {
          const y = yearsOf(g.r.body).find(x => x.year === yr); if (!y || !isNum(y.net_margin)) return;
          const x = gx - (ok.length * bw) / 2 + i * bw, a = yv(0), bb = yv(y.net_margin);
          const r = sv('rect', { class: `gscv-bar gscv-${y.kind === 'settled' ? 'settled' : y.kind === 'solved' ? 'solved' : 'hollow'}`, x: x.toFixed(2), width: (bw - 2).toFixed(2), y: Math.min(a, bb).toFixed(2), height: Math.max(0.5, Math.abs(bb - a)).toFixed(2),
            'data-gscv-sbar': '1', 'data-sid': g.id, 'data-year': yr });
          r.style.color = SCEN_COLOUR[P.scens.indexOf(g.id) % SCEN_COLOUR.length];
          r.appendChild(sv('title', null, `${scenLabel(g.id)} ${yr} · ${P.load ? 'net load cost' : 'net margin'} ${fmt.m(y.net_margin)} · ${kindWord(y)}`));
          svg.appendChild(r);
        });
        svg.appendChild(sv('text', { class: 'gscv-ax', x: gx, y: H - 6, 'text-anchor': 'middle' }, String(yr)));
      });
      w.appendChild(svg);
      const npv = ok.map(g => `${scenLabel(g.id)} ${fmt.m(g.r.body.metrics && g.r.body.metrics.npv_usd)}`).join(' · ');
      w.appendChild(el('div', 'gscv-note', `${P.load ? 'PV of load cost' : 'NPV'}: ${npv}. Proxies are Base × one factor on solved and escalated years — illustrative proxy — not a PROBE run; S10 replaces them with solved runs.`));
    }
    w.appendChild(twoRun(P));
  }
  /** A11: the 2035 pair is two vendors' runs, a range, not scenarios — read from the embedded annual block */
  function twoRun(P) {
    const d = el('div', 'gscv-tworun'); d.setAttribute('data-gscv-tworun', '1');
    const data = root.GSCathy && root.GSCathy.data;
    const rows = P.bus != null && data && data.bus_annual && data.bus_annual[String(P.bus)] ? data.bus_annual[String(P.bus)].rows || [] : [];
    const at = id => { const r = rows.find(x => x[0] === id && x[1] === 2035 && x[2] === 'model'); return r && isNum(r[3]) ? r[3] : null; };
    const a = at('10yr'), b = at('pcr2035');
    if (a == null || b == null) { d.textContent = '2035: two runs, not scenarios — the PROBE 10-year and PCR 2035 runs are not both held at this scope.'; return d; }
    const dlt = a - b;
    d.textContent = `2035: two runs, not scenarios — LMP PROBE 10-year $${a.toFixed(2)} vs PCR 2035 $${b.toFixed(2)}/MWh (Δ ${dlt >= 0 ? '+' : MINUS}${Math.abs(dlt).toFixed(2)}, ${(Math.abs(dlt) / b * 100).toFixed(1)} %). Base reads PCR 2035.`;
    return d;
  }

  /* ══ S5 · Cost inputs (D-004) ═══════════════════════════════════════════ */
  function inputRows(P) {
    const cols = [{ l: 'Input' }, { l: 'Value' }, { l: 'Unit' }, { l: 'Origin' }, { l: 'Source' }, { l: 'Vintage' }, { l: 'Confidence' }];
    if (!P.body) return { cols, rows: [], why: 'The case has not been read.' };
    const rows = OV.filter(o => !(o.not || []).includes(P.fuel)).map(o => {
      const d = (P.body[o.from[0]] || {})[o.from[1]] || {};
      const user = P.ov[o.k] != null;
      return [o.l, user ? P.ov[o.k] : d.value, o.u, user ? 'User override' : 'CA default', user ? 'user input (this browser)' : d.source, user ? '' : d.vintage, user ? 'user' : d.confidence];
    });
    if (hasReg(P)) {
      const d = P.body.revenue_inputs.regulation, user = P.ov[REG.k] === false;
      rows.push([REG.l, user ? 'off' : (d.value === false ? 'off' : 'on'), 'on/off', user ? 'User override' : 'CA default', user ? 'user input (this browser)' : d.source, user ? '' : d.vintage, user ? 'user' : d.confidence]);
    }
    return { cols, rows };
  }
  function inputsPanel(cx, P) {
    return cx.panel({ id: 'value-inputs', wide: true, title: 'Cost inputs', faceText: faceText(P, true), table: () => inputRows(P), csv: true,
      draw: body => {
        const w = el('div', 'gscv'); w.setAttribute('data-gscv', 'inputs'); body.appendChild(w);
        /* a refused case keeps the form (with the last defaults read for this asset), so the reader can fix it */
        const refused = P.state === 'bad-request' && LAST_OK[P.fuel];
        const bad = refused ? null : notOk(P, 'inputs'); if (bad) { w.appendChild(bad); return; }
        if (refused) P = Object.assign({}, P, { body: LAST_OK[P.fuel] });
        const tb = el('table', 'gscv-t gscv-ov');
        const hr = el('tr'); ['Input', 'CA default', 'Source · vintage', 'Override'].forEach(h => hr.appendChild(el('th', null, h)));
        const th = el('thead'); th.appendChild(hr); tb.appendChild(th);
        const bd = el('tbody');
        const fields = {};
        OV.filter(o => !(o.not || []).includes(P.fuel)).forEach(o => {
          const d = (P.body[o.from[0]] || {})[o.from[1]] || {};
          const user = P.ov[o.k] != null;
          const tr = el('tr'); tr.setAttribute('data-gscv-row', o.k); tr.setAttribute('data-gscv-origin', user ? 'user' : 'default');
          const c0 = el('td'); c0.appendChild(el('span', 'gscv-in-l', o.l));
          const chip = el('span', `gscv-chip ${user ? 'u' : 'a'}`, user ? 'User override' : 'CA default'); c0.appendChild(chip);
          tr.appendChild(c0);
          const dv = o.k === 'itc_pct' && (d.value === 0 || d.value == null) ? `0 % · not applied (${(P.body.inputs.tax_credit_treatment || {}).value === 'not_applied' ? 'eligibility is per project' : 'see source'})`
            : `${d.value == null ? 'not held' : d.value} ${d.unit || o.u}${o.k === 'capacity_usd_kw_month' ? ' forward; cleared FCA prices before' : ''}`;
          tr.appendChild(el('td', 'n', dv));
          const src = el('td', 'gscv-src'); src.title = `${d.source || ''}${d.note ? ' — ' + d.note : ''}`;
          const short = String(d.source || 'source not stated').replace(/04 Market Research\/ISO_Knowledge_Vault\/ISO_Vault_SHIP\/catalog\//g, '').split(' — ')[0];
          src.textContent = `${short.slice(0, 110)}${short.length > 110 ? '…' : ''} · ${d.vintage || 'vintage not stated'} · ${d.confidence || ''}`;
          tr.appendChild(src);
          const c3 = el('td');
          const inp = el('input', 'gscv-in'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.setAttribute('data-gscv-ov', o.k);
          inp.setAttribute('aria-label', `${o.l} override (${o.u})`); inp.placeholder = `${o.lo}–${o.hi}`;
          inp.value = user ? String(P.ov[o.k]) : '';
          const err = el('span', 'gscv-err'); err.setAttribute('data-gscv-err', o.k);
          c3.appendChild(inp); c3.appendChild(el('span', 'gscv-u', o.u)); c3.appendChild(err);
          tr.appendChild(c3);
          bd.appendChild(tr);
          fields[o.k] = { o, inp, err };
        });
        if (hasReg(P)) {
          const d = P.body.revenue_inputs.regulation, ri = P.body.revenue_inputs, user = P.ov[REG.k] === false;
          const tr = el('tr'); tr.setAttribute('data-gscv-row', REG.k); tr.setAttribute('data-gscv-origin', user ? 'user' : 'default');
          const c0 = el('td'); c0.appendChild(el('span', 'gscv-in-l', REG.l));
          c0.appendChild(el('span', `gscv-chip ${user ? 'u' : 'a'}`, user ? 'User override' : 'CA default'));
          tr.appendChild(c0);
          const sh = ri.reg_share && ri.reg_share.value, pr = ri.reg_price && ri.reg_price.value;
          tr.appendChild(el('td', 'n', `${d.value === false ? 'off' : 'on'}${isNum(sh) && isNum(pr) ? ` · ${sh} % of MW, idle hours, ${fmt.usd(pr)}/MW-h` : ''}`));
          const src = el('td', 'gscv-src'); src.title = `${d.source || ''}${d.note ? ' — ' + d.note : ''}`;
          src.textContent = `${String(d.source || 'source not stated').slice(0, 110)} · ${d.vintage || 'vintage not stated'} · ${d.confidence || ''}`;
          tr.appendChild(src);
          const c3 = el('td');
          const g = el('div', 'gscv-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Regulation stream on or off'); g.setAttribute('data-gscv-seg', 'regulation');
          [['on', 'On', 'Stack regulation (the CA default): a thin market, never scaled'], ['off', 'Off', 'Leave regulation out: reserves take the idle-hour MW']].forEach(([v, l, t]) => {
            const b = el('button', null, l); b.type = 'button'; b.dataset.v = v; b.title = t;
            b.setAttribute('aria-pressed', String((user ? 'off' : 'on') === v));
            b.onclick = () => { const o = overridesFor(P.fuel); if (v === 'off') o[REG.k] = false; else delete o[REG.k]; setOverrides(P.fuel, o); C.bound.paint(); };
            g.appendChild(b);
          });
          c3.appendChild(g); tr.appendChild(c3);
          bd.appendChild(tr);
        }
        tb.appendChild(bd);
        const tw = el('div', 'gscv-tw'); tw.appendChild(tb); w.appendChild(tw);
        const act = el('div', 'gscv-act');
        const apply = el('button', 'gscv-btn pri', 'Apply'); apply.type = 'button'; apply.setAttribute('data-gscv-apply', '1');
        apply.title = 'Check every override and redraw the case with them (kept in this browser, for this project and asset)';
        apply.onclick = () => {
          const out = P.ov && P.ov[REG.k] === false ? { [REG.k]: false } : {}; let bad2 = false;   // the switch is kept
          Object.values(fields).forEach(({ o, inp, err }) => {
            err.textContent = '';
            const raw = String(inp.value).trim();
            if (!raw) return;
            const v = Number(raw);
            if (!Number.isFinite(v)) { err.textContent = `${o.l} must be a number`; bad2 = true; return; }
            if (v < o.lo || v > o.hi) { err.textContent = `${o.l} must be ${o.lo}–${o.hi.toLocaleString('en-US')} ${o.u}`; bad2 = true; return; }
            out[o.k] = v;
          });
          if (bad2) return;
          setOverrides(P.fuel, out);
          C.bound.paint();
        };
        const reset = el('button', 'gscv-btn', 'Reset to defaults'); reset.type = 'button'; reset.setAttribute('data-gscv-reset', '1');
        reset.title = 'Reset to CA defaults: clear every override for this project and asset';
        reset.onclick = () => { setOverrides(P.fuel, {}); C.bound.paint(); };
        act.appendChild(apply); act.appendChild(reset);
        w.appendChild(act);
        const r = P.res && P.res.state === 'bad-request' ? P.res : null;
        if (r) w.appendChild(el('div', 'gscv-err', `The server refused: ${r.why}`));
        w.appendChild(el('div', 'gscv-note', 'CA defaults come from data/assumptions/ca_cost_defaults.csv and the Studio revenue table, each with its source and vintage. Overrides are COD-year dollars, stay in this browser, and apply to this project and asset only.'));
      } });
  }

  /* ══ S6 · Net of interconnection ════════════════════════════════════════ */
  function netRows(P) {
    const cols = [{ l: 'Measure' }, { l: '$/kW-yr' }, { l: 'Note' }];
    if (!P.body) return { cols, rows: [], why: 'The case has not been read.' };
    const v = perKw(P.body, P.fuel);
    const rows = [
      [P.load ? 'Energy and capacity cost' : 'Operating margin (revenue − O&M)', fmt.num(v.op, 2), v.why || `mean over ${(P.body.metrics || {}).window ? P.body.metrics.window.join('–') : 'the operating life'}`],
      ['Network upgrade annuity', v.network == null ? null : fmt.num(-v.network, 2), networkWords(P.body.network)],
      ['Net of interconnection', fmt.num(v.net, 2), ''],
    ];
    if (!P.load) rows.push(['After capex annuity', fmt.num(v.after, 2), `capex annuity ${fmt.num(v.capex, 2)} $/kW-yr`]);
    return { cols, rows };
  }
  function netPanel(cx, P) {
    return cx.panel({ id: 'value-net', title: 'Net of interconnection', faceText: faceText(P, true), table: () => netRows(P), csv: true,
      note: P.body && P.body.network ? cbNote(P.body.network) : null,   /* cost basis 2026-10-07: six sentences + study comparison behind (i) */
      sig: cx.sig ? cx.sig('net-of-interconnection', 'mean over the operating life · this bus', `${UI.mw} MW`) : null,
      draw: body => {
        const w = el('div', 'gscv'); w.setAttribute('data-gscv', 'net'); body.appendChild(w);
        const bad = notOk(P, 'net'); if (bad) { w.appendChild(bad); return; }
        const b = P.body, v = perKw(b, P.fuel), n = b.network || {};
        const lines = el('div', 'gscv-netvals');
        /* data-v carries the measure as named: the network annuity as a positive cost, drawn with its minus */
        const line = (k, l, val, sub, dataV) => {
          const d = el('div', 'gscv-nv'); const s = el('span', 'gscv-nv-v', val == null ? 'not held' : `${fmt.kw(val)}/kW-yr`);
          const dv = dataV === undefined ? val : dataV;
          s.setAttribute('data-gscv-netval', k); s.setAttribute('data-v', dv == null ? '' : String(dv));
          d.appendChild(el('span', 'gscv-nv-l', l)); d.appendChild(s); if (sub) d.appendChild(el('span', 'gscv-nv-s', sub)); lines.appendChild(d);
        };
        line('op', P.load ? 'Energy and capacity cost' : 'Operating margin', v.op, v.why || 'revenue − O&M, mean over the operating life');
        line('network', 'Network upgrade', v.network == null ? null : -v.network, n.measured ? `annuity of ${fmt.m(n.total_usd)} at the discount rate` : null, v.network);
        line('net', 'Net of interconnection', v.net, null);
        if (!P.load) line('after', 'After capex annuity', v.after, `capex annuity ${fmt.kw(v.capex)}/kW-yr`);
        w.appendChild(lines);
        if (v.op != null) w.appendChild(netBars(w, v, P.load));
        const nw = el('div', 'gscv-netword');
        nw.appendChild(el('div', null, n.measured ? `Network at ${n.mw_measured} MW (${CASE_WORD[n.case] || n.case} ${n.direction}): ${networkWords(n)}`
          : n.cost_status === 'cost_not_held' ? `Network at ${n.mw_measured} MW: ${networkWords(n)}.`   /* cost basis 2026-10-07 */
          : `Network cost not held at ${UI.mw} MW — ${n.reason || 'not measured'}.`));
        (n.brackets || []).forEach(br => {
          const d = el('div', 'gscv-bracket'); d.setAttribute('data-gscv-bracket', String(br.mw));
          d.textContent = `${br.mw} MW: ${br.total_usd === 0 ? '$0 measured' : fmt.m(br.total_usd)} across ${br.elements_charged} element${br.elements_charged === 1 ? '' : 's'} ($${br.per_kw}/kW) · ${br.excluded_above_request} above the request`;
          nw.appendChild(d);
        });
        (n.also_screened || []).forEach(a => nw.appendChild(el('div', null, `Also screened, not in this sum: ${CASE_WORD[a.case] || a.case} ${a.direction} at ${a.mw} MW ${fmt.m(a.total_usd)} ($${a.per_kw}/kW).`)));
        nw.appendChild(el('div', null, 'Network upgrades only: the elements the transfer screen loads past their rating. POI/gen-tie not included.'));
        { const cl = el('div', 'gscv-costbasis', cbLine(n)); cl.setAttribute('data-gs-costbasis', n.element_set || 'headline'); nw.appendChild(cl); }   /* cost basis 2026-10-07: the compact line, once */
        w.appendChild(nw);
      } });
  }
  function netBars(w, v, load) {
    const items = [{ l: load ? 'Load cost' : 'Operating', v: v.op }, { l: 'Network', v: v.network == null ? null : -v.network }, { l: 'Net', v: v.net }]
      .concat(load ? [] : [{ l: 'After capex', v: v.after }]).filter(x => isNum(x.v));
    const H = 128, { svg, W } = svgFor(w, H);
    svg.setAttribute('data-gscv-netchart', '1'); svg.setAttribute('aria-label', '$/kW-yr: operating, network, net');
    const L = 92, R = 70, rowH = (H - 8) / items.length;
    const tk = ticks(Math.min(0, ...items.map(x => x.v)), Math.max(0, ...items.map(x => x.v)), 4);
    const xv = x => L + (x - tk.lo) / (tk.hi - tk.lo) * (W - L - R);
    svg.appendChild(sv('line', { class: 'gscv-zero', x1: xv(0), x2: xv(0), y1: 2, y2: H - 4 }));
    items.forEach((it, i) => {
      const y = 4 + i * rowH, a = xv(0), b = xv(it.v);
      svg.appendChild(sv('text', { class: 'gscv-ax', x: L - 6, y: y + rowH / 2 + 4, 'text-anchor': 'end' }, it.l));
      const r = sv('rect', { class: 'gscv-bar gscv-settled', x: Math.min(a, b).toFixed(2), width: Math.max(0.5, Math.abs(b - a)).toFixed(2), y: (y + 3).toFixed(2), height: (rowH - 8).toFixed(2) });
      r.style.color = it.l === 'Network' ? 'var(--s7)' : it.l.startsWith('After') ? 'var(--s2)' : 'var(--s1)';
      svg.appendChild(r);
      svg.appendChild(sv('text', { class: 'gscv-ax', x: Math.max(a, b) + 4, y: y + rowH / 2 + 4 }, `${fmt.kw(it.v)}`));
    });
    return svg;
  }

  /* ══ S6 · Nearby buses ranked + map ═════════════════════════════════════ */
  function rankData(P) {
    const ids = [P.bus].concat(P.near || []);
    const here = nodeOf(P.bus);
    const [cs, dir] = NETWORK_CASE[P.fuel];
    return ids.map(b => {
      const r = res(params(b, P.fuel, P.sid)), n = nodeOf(b);
      const v = r && r.ok ? perKw(r.body, P.fuel) : null;
      const hr = n ? n[HEADROOM[dir]] : null;
      return { bus: b, name: (r && r.ok && r.body.location && r.body.location.label) || (n && n.name) || '', zone: n ? n.zone : '', mi: here && n && b !== P.bus ? miles(here, n) : 0,
        r, v, net: v ? v.net : null, tier: r && r.ok && r.body.location ? r.body.location.tier : null, hr: isNum(hr) ? hr : null, words: r && r.ok ? networkWords(r.body.network) : null,
        short: r && r.ok ? networkShort(r.body.network) : null, self: b === P.bus };
    }).sort((a, b) => (a.net == null) - (b.net == null) || (b.net - a.net) || (a.bus - b.bus));
  }
  /* ══ S6 · Net value ranking over every costed bus (S-nav 2026-10-07; review P2 15, 03-workflow W4.5) ══════
     The same plant at every bus the transfer screen priced at this case and size: this bus's modelled operating
     margin, moved by the bus's own price (Base price basis, GS.priceAt, year by year over the operating life × this
     plant's energy stream) and by the bus's own network annuity (its $/kW × the case's capital recovery factor). Capacity,
     REC, O&M and capex are this plant's — the same everywhere. Storage holds its arbitrage at this bus (a spread is not
     a price level), so only the network moves; a data centre is ranked over its nearest buses only (full model reads).
     The nearest buses keep their full model read ("model"); every other row is "scaled". */
  const RANK_CACHE = new Map();
  function costPerKw(cost, key) { let e = cost[key]; if (typeof e === 'string') e = cost[e]; return e && isNum(e.per_kw) ? e.per_kw : null; }
  function priceOf(bus, y) {
    try { const p = root.GS && root.GS.priceAt ? root.GS.priceAt(Number(bus), y) : null; return p && isNum(p.value) ? p.value : null; } catch (e) { return null; }
  }
  function allRank(P) {
    if (!P.body || P.state !== 'ok') return { why: 'the case has not been read' };
    if (P.load) return { why: 'a data centre is ranked over its nearest buses only — its cost is not a price level a scale can move' };
    /* one computation per case AND per state of the nearest buses' model reads (a read that lands replaces its estimate) */
    const ck = `${P.mainKey}|${(P.near || []).map(x => { const r = res(params(x, P.fuel, P.sid)); return r ? r.state : '-'; }).join(',')}`;
    if (RANK_CACHE.has(ck)) return RANK_CACHE.get(ck);
    const b = P.body, cost = costSec(), crf = b.costs && b.costs.crf, base = perKw(b, P.fuel);
    const done = r => { if (RANK_CACHE.size > 40) RANK_CACHE.clear(); RANK_CACHE.set(ck, r); return r; };
    if (!cost) return done({ why: 'the network cost section is not in this build' });
    if (!MEASURED_MW.includes(+UI.mw)) return done({ why: `network cost is measured at ${MEASURED_MW.join(' and ')} MW only; this case is ${UI.mw} MW` });
    if (!isNum(crf) || !base || base.op == null) return done({ why: base && base.why ? base.why : 'the case carries no operating margin or capital recovery factor' });
    const [cs, dir] = NETWORK_CASE[P.fuel], suf = `|${cs}|${dir}|${+UI.mw}`, kw = b.mw * 1000;
    const window = (b.cash_flows || []).map(c => c.year);
    const energy = new Map(yearsOf(b).map(y => [y.year, y.streams && isNum(y.streams.energy) ? y.streams.energy : null]));
    const scaleE = P.fuel !== 'bess';
    /* GS.priceAt answers at the price basis's anchor years (the solved runs, escalated 2045/2050): the bus-to-this-bus
       price ratio is read there and drawn straight between them across the operating window */
    const ANCH = [2028, 2030, 2035, 2040, 2045, 2050];
    const caseP = ANCH.map(a => priceOf(P.bus, a));
    const ratioOf = bus => {
      const pts = ANCH.map((a, i) => { const pb = priceOf(bus, a), pc = caseP[i]; return isNum(pb) && isNum(pc) && pc !== 0 ? [a, pb / pc] : null; }).filter(Boolean);
      if (!pts.length) return null;
      return y => {
        if (y <= pts[0][0]) return pts[0][1];
        const last = pts[pts.length - 1]; if (y >= last[0]) return last[1];
        for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) { const [x0, r0] = pts[i - 1], [x1, r1] = pts[i]; return r0 + (r1 - r0) * (y - x0) / (x1 - x0); }
        return last[1];
      };
    };
    const near = new Map((P.near || []).concat([P.bus]).map(x => { const r = res(params(x, P.fuel, P.sid)); return [x, r && r.ok ? perKw(r.body, P.fuel) : null]; }));
    const rows = [];
    Object.keys(cost).forEach(key => {
      if (!key.endsWith(suf)) return;
      const bus = Number(key.split('|')[0]), pk = costPerKw(cost, key);
      if (!Number.isFinite(bus) || pk == null) return;
      const network = pk * crf;
      const m = near.get(bus);
      if (m && m.net != null) { rows.push({ bus, net: m.net, network: m.network, dE: null, basis: 'model' }); return; }
      let dE = 0;
      if (scaleE) {
        const R = ratioOf(bus);
        if (!R) { rows.push({ bus, net: null, network, dE: null, basis: 'no price', why: 'no Base price at this bus' }); return; }
        for (let i = 0; i < window.length; i++) {
          const e = energy.get(window[i]);
          if (!isNum(e)) { rows.push({ bus, net: null, network, dE: null, basis: 'no price', why: `the case holds no energy in ${window[i]}` }); return; }
          dE += e * (R(window[i]) - 1);
        }
        dE = dE / window.length / kw;
      }
      rows.push({ bus, net: base.op + dE - network, network, dE: scaleE ? dE : null, basis: 'scaled' });
    });
    rows.sort((x, y) => (x.net == null) - (y.net == null) || (y.net - x.net) || (x.bus - y.bus));
    rows.forEach((r, i) => { r.rank = r.net == null ? null : i + 1; });
    const ranked = rows.filter(r => r.net != null);
    return done({ rows, n: ranked.length, mine: rows.find(r => r.bus === P.bus) || null, cs, dir, crf, scaleE, window });
  }
  function rankRows(P) {
    const cols = [{ l: 'Rank' }, { l: 'Bus' }, { l: 'Name' }, { l: 'Zone' }, { l: 'Net of interconnection ($/kW-yr)' }, { l: 'Network ($/kW-yr)' },
      { l: 'Energy vs this bus ($/kW-yr)' }, { l: 'Basis' }];
    if (P.bus == null) return { cols, rows: [], why: 'Pick a bus.' };
    const A = allRank(P);
    if (!A.rows) {
      /* a data centre, or no network cost at this size: the nearest buses' full model reads, as before */
      const rows = rankData(P).map((d, i) => [d.net == null ? 'not held' : String(i + 1), String(d.bus), d.name, d.zone, d.v ? fmt.num(d.v.net, 2) : null,
        d.v && d.v.network != null ? fmt.num(-d.v.network, 2) : null, null, d.r ? (d.r.ok ? 'model' : failWords(d.r)[0]) : 'reading']);
      return { cols, rows, why: A.why };
    }
    return { cols, rows: A.rows.map(r => { const n = nodeOf(r.bus); return [r.rank == null ? 'not held' : String(r.rank), String(r.bus), n && n.name ? n.name : '', n ? n.zone : '',
      r.net == null ? null : fmt.num(r.net, 2), fmt.num(-r.network, 2), r.dE == null ? null : fmt.num(r.dE, 2), r.basis === 'no price' ? `not held — ${r.why}` : r.basis]; }) };
  }
  function rankPanel(cx, P) {
    const [cs, dir] = NETWORK_CASE[P.fuel];
    return cx.panel({ id: 'value-rank', wide: true, title: P.load ? 'Nearby buses ranked' : 'Net value ranking · every costed bus', faceText: faceText(P, true), table: () => rankRows(P), csv: true,
      sig: cx.sig ? cx.sig('net-value-rank', P.load ? 'nearest buses' : 'every costed bus', `${CASE_WORD[cs] || cs} ${dir} ${UI.mw} MW`) : null,
      note: 'Every bus the transfer screen priced at this case and size. Each row is this plant moved to that bus: this bus\'s modelled operating margin, plus this plant\'s energy revenue × (that bus\'s Base price ÷ this bus\'s − 1) — the ratio read at each solved-run year and straight-line between them over the operating life — minus that bus\'s network annuity ($/kW × the capital recovery factor of this case). Capacity, REC, O&M and capex are this plant\'s everywhere. Storage holds its arbitrage at this bus — a spread is not a price level — so only the network moves. Rows marked "model" are full model reads (this bus and its nearest buses); "scaled" rows are the estimate. Network upgrades only: POI and gen-tie are not included; $0 means no tested element reaches its rating.',
      draw: body => slot('value-rank', body, () => `${P.mainKey}|${(P.near || []).map(b => { const r = res(params(b, P.fuel, P.sid)); return r ? r.state : '-'; }).join(',')}`, b => drawRank(b, P)) });
  }
  function drawRank(body, P) {
    const w = el('div', 'gscv'); w.setAttribute('data-gscv', 'rank'); body.appendChild(w);
    const bad = notOk(P, 'rank'); if (bad) { w.appendChild(bad); return; }
    const A = allRank(P), t = rankRows(P);
    const nl = el('div', 'gscv-answer'); nl.setAttribute('data-gscv-netrank', '1');
    if (A.rows) {
      const top = A.rows.find(r => r.rank === 1), me = A.mine;
      nl.textContent = `${fmt.int(A.n)} costed buses at ${CASE_WORD[A.cs] || A.cs} ${A.dir} ${UI.mw} MW · this bus ${me && me.rank ? `rank ${fmt.int(me.rank)}, ${fmt.kw(me.net)}/kW-yr` : 'not ranked'} · top ${top ? `${top.bus} ${fmt.kw(top.net)}/kW-yr` : '—'}`;
    } else nl.textContent = `Nearest buses, full model reads: ${A.why}.`;
    nl.title = nl.textContent;
    w.appendChild(nl);
    const grid = el('div', 'gscv-rankgrid');
    /* the map: this bus and the 30 best-ranked, rank numbered (every row is in the table) */
    const mapRows = A.rows ? A.rows.filter(r => r.rank != null && (r.rank <= 30 || r.bus === P.bus))
      .map(r => { const n = nodeOf(r.bus); return { bus: r.bus, name: n ? n.name : '', net: r.net, self: r.bus === P.bus, rank: r.rank }; }) : rankData(P);
    grid.appendChild(miniMap(w, mapRows, P));
    const tw = el('div', 'gscv-tw gscv-rankscroll'); const tb = el('table', 'gscv-t gscv-rank');
    const hr = el('tr'); t.cols.forEach(c => hr.appendChild(el('th', null, c.l))); const th = el('thead'); th.appendChild(hr); tb.appendChild(th);
    const bd = el('tbody');
    t.rows.forEach((r, i) => {
      const bus = Number(r[1]), self = bus === P.bus;
      const tr = el('tr', self ? 'self' : null); tr.setAttribute('data-gscv-rank', r[0]); tr.setAttribute('data-bus', r[1]);
      const src = A.rows ? A.rows[i] : null; tr.setAttribute('data-net', src && src.net != null ? String(src.net) : '');
      r.forEach((v, j) => tr.appendChild(el('td', j >= 4 && j <= 6 ? 'n' : null, v == null ? '—' : String(v))));
      bd.appendChild(tr);
    });
    tb.appendChild(bd); tw.appendChild(tb); grid.appendChild(tw);
    w.appendChild(grid);
    /* the reader lands on this bus's row */
    setTimeout(() => { const me = tb.querySelector('tr.self'); if (me && tw.scrollHeight > tw.clientHeight) tw.scrollTop = Math.max(0, me.offsetTop - tw.clientHeight / 2); }, 0);
  }
  function miniMap(w, data, P) {
    const W = 240, H = 220, svg = sv('svg', { class: 'gscv-map', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'data-gscv-map': '1', 'aria-label': 'Nearby buses by position, rank numbered' });
    const pts = data.map(d => ({ d, n: nodeOf(d.bus) })).filter(p => p.n && isNum(p.n.lat) && isNum(p.n.lon));
    if (!pts.length) { svg.appendChild(sv('text', { class: 'gscv-ax', x: 8, y: 20 }, 'No positions held')); return svg; }
    const lat0 = pts.reduce((s, p) => s + p.n.lat, 0) / pts.length, k = Math.cos(lat0 * Math.PI / 180);
    const xs = pts.map(p => p.n.lon * k), ys = pts.map(p => p.n.lat);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 0.02);
    const cx0 = (Math.max(...xs) + Math.min(...xs)) / 2, cy0 = (Math.max(...ys) + Math.min(...ys)) / 2, sc = (Math.min(W, H) - 44) / span;
    svg.appendChild(sv('rect', { class: 'gscv-mapbg', x: 0.5, y: 0.5, width: W - 1, height: H - 1 }));
    const spots = new Map();   // buses at one position (one substation) share a label
    pts.forEach(p => {
      const x = W / 2 + (p.n.lon * k - cx0) * sc, y = H / 2 - (p.n.lat - cy0) * sc;
      const i = data.indexOf(p.d);
      const c = sv('circle', { class: `gscv-dot${p.d.self ? ' self' : ''}`, cx: x.toFixed(1), cy: y.toFixed(1), r: p.d.self ? 7 : 5, 'data-bus': p.d.bus });
      c.appendChild(sv('title', null, `${p.d.bus} ${p.d.name} · ${p.d.net == null ? 'not held' : fmt.kw(p.d.net) + '/kW-yr'}`));
      svg.appendChild(c);
      const key = `${Math.round(x)}|${Math.round(y)}`;
      if (!spots.has(key)) spots.set(key, { x, y, ranks: [] });
      spots.get(key).ranks.push(p.d.net == null ? '–' : String(p.d.rank != null ? p.d.rank : i + 1));
    });
    spots.forEach(sp => { const left = sp.x + 9 + sp.ranks.join(',').length * 7 > W - 4;
      svg.appendChild(sv('text', { class: 'gscv-ax', x: (left ? sp.x - 9 : sp.x + 9).toFixed(1), y: (sp.y + 4).toFixed(1), 'text-anchor': left ? 'end' : 'start' }, sp.ranks.join(','))); });
    svg.appendChild(sv('text', { class: 'gscv-ax', x: 6, y: H - 6 }, `${(span * 69).toFixed(1)} mi across`));
    return svg;
  }

  /* ── slots: a panel that fills in place as its reads arrive ───────────── */
  function slot(id, body, sig, draw) {
    let last = null;
    const run = () => {
      if (!body.isConnected) { SLOTS.delete(id); return; }
      const s = sig(); if (s === last) return; last = s;
      body.innerHTML = '';
      const st = C.st;
      if (st && st.tables && st.tables[id]) {
        const x = SLOT_TABLE[id] && SLOT_TABLE[id]();
        if (x && x.rows.length) tableInto(body, x); else body.appendChild(stateBox('empty', 'No rows yet', (x && x.why) || 'Nothing read.'));
        return;
      }
      draw(body);
    };
    SLOTS.set(id, { run });
    run();
  }
  const SLOT_TABLE = {};

  /* ── the two views ─────────────────────────────────────────────────────── */
  let LASTPLAN = null;
  function planOnce(cx) {
    /* one plan per paint, shared by the two views (they build back to back) */
    const p = plan(cx);
    LASTPLAN = p;
    SLOT_TABLE['value-scen'] = () => scenRows(p);
    SLOT_TABLE['value-rank'] = () => rankRows(p);
    return p;
  }
  function buildProfit(host, cx) {
    SLOTS.clear();
    const P = planOnce(cx);
    host.appendChild(casePanel(cx, P));
    host.appendChild(profitPanel(cx, P));
    host.appendChild(scenPanel(cx, P));
  }
  function buildNet(host, cx) {
    const P = LASTPLAN && LASTPLAN.mainKey === keyOf(params(Number((cx.scope() || {}).key), fuelNow(), scenNow())) ? LASTPLAN : planOnce(cx);
    host.appendChild(netPanel(cx, P));
    host.appendChild(rankPanel(cx, P));
    host.appendChild(inputsPanel(cx, P));   // S-nav 2026-10-07: margin by scenario and net of interconnection share a row
  }

  C.register({ k: 'value-profit', label: 'Profit over time', screen: 'value', module: 'ext/64', scenario: 'applied',
    replaces: ['Profit over time', 'Measured reserves'], build: buildProfit });
  C.register({ k: 'value-net', label: 'Net of interconnection', screen: 'value', module: 'ext/64', scenario: 'applied',
    replaces: ['Net value ranking'], build: buildNet });

  root.GSContinuumValue = {
    get busy() { return busy(); },
    get ui() { return Object.assign({}, UI); },
    set(patch) {
      Object.keys(patch || {}).forEach(k => { if (k === 'mw') setSize(+patch[k]); else if (k in UI) UI[k] = patch[k]; });
      saveUI();
    },
    allRank: () => (LASTPLAN ? allRank(LASTPLAN) : null),
    reset() { DONE.clear(); QUEUED.clear(); SLOTS.clear(); CURMAIN = null; },
    nearby, networkRank, perKw,
    results: () => [...DONE.entries()].map(([k, r]) => ({ k, state: r.state })),
    last: fuel => LAST_OK[fuel] || null,   // the last good body per fuel (the gate checks every held stream is drawn)
  };
})(window);
