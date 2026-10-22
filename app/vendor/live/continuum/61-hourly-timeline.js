/* VENDORED from live Studio ext/61-hourly-timeline.js (snapshot 2026-10-11, sha256 b80cd80111cb3098).
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/continuum/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   ext: 61-hourly-timeline.js — LMP Continuum screen "Hourly · history + forecast",
   and the Prices-stage card 5.41 that opens it at the bus.

   Ganesh (2026-09-28): "I need a line graph for hourly data for both historical
   and future on a single graph under LMP Continuum."

   One chronological axis, 2020 → 2040:
     settled hours      bus_full[bus].hourly['hist:<year>'] (RT/DA), solid
     solved runs        bus_full[bus].hourly['5yr'|'pcr2030'|'10yr'|'pcr2035'|'pcr2040'],
                        dashed, each run a labelled segment at its own study year
     a year no run holds, or a stretch after the last settled hour, is a labelled
     gap; no path is ever drawn across it (a null lifts the pen, always)
   A "last settled hour" divider separates the record from the runs. A second
   mode overlays the same month or week of every year on one day-of-month axis.

   Where the hours come from (studio/CATHY-CONTRACT.md):
     embedded           the twelve demo buses, LMP only, every settled year the
                        build carries plus the five runs
     live server        GET /api/v2/prices/hours on 127.0.0.1:5034 (the Hourly
                        Explorer's route, concern_hourly_api.py) for: a year the
                        exporter withheld, any other bus, the hub, and the energy /
                        congestion / loss components. Offline, each such segment
                        is a labelled hole ("withheld — offline"), never a line.
   The first call to the server is a probe; until it answers no other call goes
   out, so an offline server costs one failed request, not twelve.

   Calendars. A settled year is indexed on local hour labels: 8,759 in a common
   year, because the spring-forward 02:00 does not exist (the autumn repeat is one
   averaged label). A solved run is a flat 8,760 (8,784 leap) with no daylight
   saving. Every hour is placed at its own wall-clock date on the axis, so the
   missing 02:00 is one hour of axis with no point on it, not a shifted series.

   Readability for ~100k points: min/max per pixel (the band is every hour's range
   in that pixel column, the line the column's mean); at or below 1.5 hours per
   pixel every hour is drawn as its own vertex. Drag on the chart to zoom, drag or
   click the overview strip to move, Reset zoom to go back. Hover moves a DOM
   readout and a crosshair; it never redraws (GSHourlyTimeline.draws).

   Hooks into ext/60 through ONE line in its paint() (`// hourly timeline hook`),
   which hands every `window.GSCathyScreens[i].attach(cx)` the screen list, the
   build table, the tab row and the Continuum's panel/scope helpers.
   Gate: client/tests/studio-hourly-timeline.mjs.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const A = window.App, GS = window.GS;
  if (!A || !GS) { console.warn('ext 61: the Studio app is not on the page; the hourly timeline is not installed'); return; }
  const H = A.H, esc = A.esc, icon = A.icon, fmt = GS.fmt;

  /* ── constants ─────────────────────────────────────────────────────────── */
  const HOUR = 3600000, DAY = 86400000;
  const HUB = '.H.INTERNAL_HUB';
  const SCREEN_K = 'timeline', SCREEN_L = 'Hourly · history + forecast';
  const DEFAULT_API = 'http://127.0.0.1:5034/api/v2/prices/hours';
  const apiUrl = () => window.GSX_HOURS_API || DEFAULT_API;
  const RUN_ORDER = ['5yr', 'pcr2030', '10yr', 'pcr2035', 'pcr2040'];
  /* validated Studio series tokens (studio/src/styles.css --s1…--s8): settled is
     --s1, each run keeps one hue on both modes, the hub is the neutral --s7 */
  const RUN_TOK = { '5yr': 's4', pcr2030: 's2', '10yr': 's5', pcr2035: 's3', pcr2040: 's6' };
  const SETTLED_TOK = 's1', HUB_TOK = 's7';
  const SERIES = [['lmp', 'LMP'], ['energy', 'Energy'], ['congestion', 'Congestion'], ['loss', 'Loss']];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TIER_WORD = { direct: 'direct — its own settled node', same_substation: 'same substation — the station\'s settled node', geo_proxy: 'geo_proxy (geographic proxy) — another node\'s settled record', hub: 'hub', run_bus: 'the run\'s own bus' };
  const EXACT_HOURS_PER_PX = 1.5;
  /* the default y scale: a handful of scarcity hours ($2,000+) would otherwise flatten
     every other hour into the axis. Hours beyond it sit on the plot edge and are
     counted on the screen; Y range · Full shows them at scale. */
  const ROBUST = [0.005, 0.995], ROBUST_L = 'P0.5–P99.5';

  /* ── state ─────────────────────────────────────────────────────────────── */
  const KEY = 'gs.htl.v1';
  const DEF = { bus: null, seen: null, market: 'RT', series: 'lmp', runs: ['5yr', 'pcr2030', 'pcr2035', 'pcr2040'],
    hub: false, mode: 'timeline', from: 2020, view: null, yr: 'robust', period: 'month', month: 7, week: 28 };
  const ST = Object.assign({}, DEF);
  try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(ST, JSON.parse(raw)); }
  catch (e) { /* storage refused — this session's defaults stand */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) { /* storage refused — the state lives for this session */ } };
  /* a stored value from an older build must not reach a lookup that assumes it */
  (function sanitise() {
    const one = (k, ok) => { if (!ok.includes(ST[k])) ST[k] = DEF[k]; };
    one('market', ['DA', 'RT']); one('series', ['lmp', 'energy', 'congestion', 'loss']); one('mode', ['timeline', 'overlay']);
    one('period', ['month', 'week']); one('yr', ['full', 'robust']);
    if (!Array.isArray(ST.runs)) ST.runs = DEF.runs.slice();
    if (!(ST.month >= 1 && ST.month <= 12)) ST.month = DEF.month;
    if (!(ST.week >= 1 && ST.week <= 52)) ST.week = DEF.week;
    if (!Number.isFinite(+ST.from)) ST.from = DEF.from;
    if (ST.view && !(Array.isArray(ST.view) && ST.view.length === 2 && ST.view.every(Number.isFinite))) ST.view = null;
  })();
  const COUNT = { draws: 0 };
  let NO_FETCH = false;      // the card reads the embedded file only; the server is the screen's business
  let UP = null;             // the one window mouseup, handed to whichever screen is mounted
  window.addEventListener('mouseup', ev => { if (UP) UP(ev); });
  let LAST = null;           // what the last draw put on screen — the tests read it
  let CX = null;             // the Continuum's helpers, handed over by the hook line
  let BODY = null, FACE = null;

  /* ── the data block ────────────────────────────────────────────────────── */
  const DATA = () => (window.GS_DATA_EXT && window.GS_DATA_EXT.cathy) || null;
  const META = () => (DATA() && DATA().meta) || {};
  const busFull = id => {
    const d = DATA(); if (!d || !d.bus_full || id == null || id === HUB) return null;
    return d.bus_full[String(id)] || null;
  };
  const demoIds = () => { const d = DATA(); return d && d.bus_full ? Object.keys(d.bus_full).map(Number).sort((a, b) => a - b) : []; };
  const isDemo = id => id !== HUB && !!busFull(id);
  function settledYears() {
    const ids = demoIds(); const b = ids.length ? busFull(ids[0]) : null;
    const ys = b && b.hourly ? Object.keys(b.hourly).filter(k => k.startsWith('hist:')).map(k => +k.slice(5)).filter(Number.isFinite) : [];
    return ys.length ? ys.sort((a, b) => a - b) : [2020, 2021, 2022, 2023, 2024, 2025, 2026];
  }
  /** the held solved runs, in chronological order (a run is its own study year) */
  function runList() {
    return (META().scenarios || []).filter(s => s.held && s.id !== 'hist' && s.kind !== 'historical' && s.target_year)
      .sort((a, b) => a.target_year - b.target_year || RUN_ORDER.indexOf(a.id) - RUN_ORDER.indexOf(b.id));
  }
  const runOf = id => runList().find(r => r.id === id) || null;
  /** "PROBE 5-year 2028", "PCR 2040 · 12% gas case" — the case name is read off the
   *  store's own note and never renamed */
  function runName(id, withYear) {
    const r = runOf(id); let m, out = id;
    if ((m = /^(\d+)yr$/i.exec(id))) out = `PROBE ${m[1]}-year`;
    else if ((m = /^pcr(\d{4})$/i.exec(id))) out = `PCR ${m[1]}`;
    if (withYear && r && out.indexOf(String(r.target_year)) < 0) out += ` ${r.target_year}`;
    const gc = r && /(\d+(?:\.\d+)?% gas case)/i.exec(r.note || '');
    if (gc) out += ` · ${gc[1]}`;
    return out;
  }
  function busName(id) {
    if (id === HUB) return 'ISO-NE hub (.H.INTERNAL_HUB)';
    const n = GS.node(Number(id));
    return n ? `${n.name} ${n.kv} kV · #${id}` : `bus #${id}`;
  }
  function busShort(id) { if (id === HUB) return 'ISO-NE Hub'; const n = GS.node(Number(id)); return n ? n.name : `bus ${id}`; }

  /* ── calendars ─────────────────────────────────────────────────────────── */
  const isLeap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const Y0 = y => Date.UTC(y, 0, 1);
  const SPRING = {};
  /** the naive hour-of-year of the 02:00 that does not exist: US rule since 2007,
   *  the second Sunday of March. Settled index i sits at hour i before it, i+1 after. */
  function springH(y) {
    if (SPRING[y] != null) return SPRING[y];
    const d1 = new Date(Date.UTC(y, 2, 1)).getUTCDay();
    const day = 1 + ((7 - d1) % 7) + 7;
    return (SPRING[y] = ((Date.UTC(y, 2, day) - Y0(y)) / DAY) * 24 + 2);
  }
  const calLen = (settled, y) => settled ? (isLeap(y) ? 8783 : 8759) : (isLeap(y) ? 8784 : 8760);
  const tI = (seg, i) => seg.base + (seg.settled && i >= seg.s ? i + 1 : i) * HOUR;
  /** nearest hour to t; -1 is the spring-forward 02:00, which has no label */
  function iAt(seg, t) {
    const h = Math.round((t - seg.base) / HOUR);
    if (!seg.settled) return h;
    if (h === seg.s) return -1;
    return h < seg.s ? h : h - 1;
  }
  function idxFloor(seg, t) { const h = Math.floor((t - seg.base) / HOUR); return !seg.settled || h < seg.s ? h : h - 1; }
  function idxCeil(seg, t) { const h = Math.ceil((t - seg.base) / HOUR); return !seg.settled || h <= seg.s ? h : h - 1; }
  function idxOfLabel(settled, y, m0, d, h) {
    const hh = (Date.UTC(y, m0, d) - Y0(y)) / HOUR + h;
    if (!settled) return hh;
    const s = springH(y);
    return hh < s ? hh : hh === s ? -1 : hh - 1;
  }
  const pad2 = n => String(n).padStart(2, '0');
  function fmtTs(t) { const d = new Date(t); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:00`; }
  function fmtLong(t) { const d = new Date(t); return `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:00`; }
  function fmtMonthYear(t) { const d = new Date(t); return `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
  const money = v => v == null || !Number.isFinite(v) ? 'no value' : fmt.money(v, 2);

  /* ── the live server ───────────────────────────────────────────────────── */
  let API = { url: null, state: 'unknown', why: '', probe: null, offlineAt: 0 };
  /* continuum fix 2026-10-06 (D8): one rejected fetch used to mark the server offline for the session.
     Now a request is retried with backoff (TRIES attempts), a failure while the server is known to answer
     is that year's failure only, "offline" needs the probe to fail every attempt, and it expires. */
  const TRIES = 3, BACKOFF_MS = 350, OFFLINE_TTL_MS = 30000, ERROR_TTL_MS = 15000;
  const CACHE = new Map();
  let redrawQueued = false;
  function redrawSoon() {
    if (redrawQueued) return; redrawQueued = true;
    requestAnimationFrame(() => { redrawQueued = false; if (BODY && BODY.isConnected) drawAll(); });
  }
  function apiReset(force) {
    if (!force && API.url === apiUrl()) return;
    API = { url: apiUrl(), state: 'unknown', why: '', probe: null, offlineAt: 0 };
    CACHE.clear();
  }
  function fetchInto(c, bus, source, market, year, attempt) {
    const tryNo = attempt || 1;
    const url = `${API.url}?bus=${encodeURIComponent(bus)}&start=${year}-01-01&end=${year}-12-31&market=${encodeURIComponent(market)}&source=${encodeURIComponent(source)}`;
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const to = ctl ? setTimeout(() => ctl.abort(), 30000) : null;
    const was = API.url;
    return fetch(url, { mode: 'cors', credentials: 'omit', signal: ctl ? ctl.signal : undefined })
      .then(r => r.json().catch(() => null).then(body => ({ r, body })))
      .then(({ r, body }) => {
        if (was !== API.url) return;
        if (r.ok && body && Array.isArray(body.rows)) { c.state = 'ok'; c.body = body; API.state = 'online'; API.why = ''; return; }
        if (r.status === 404 && !(body && body.error)) {
          API.state = 'no-route'; API.why = 'the server on 127.0.0.1:5034 answered but does not carry /api/v2/prices/hours — restart it so the Hourly Explorer\'s route is mounted';
          c.state = 'error'; c.why = API.why; return;
        }
        API.state = 'online';
        c.state = 'error'; c.why = (body && body.error) ? `the server said: ${body.error}` : `the server answered HTTP ${r.status}`;
      })
      .catch(() => {
        if (was !== API.url) return;
        if (to) clearTimeout(to);
        if (tryNo < TRIES) {
          c.state = 'loading'; c.why = `retrying (${tryNo} of ${TRIES - 1})`;
          return new Promise(res => setTimeout(res, BACKOFF_MS * Math.pow(2, tryNo - 1)))
            .then(() => (was === API.url ? fetchInto(c, bus, source, market, year, tryNo + 1) : null));
        }
        if (API.state === 'online') {
          /* the server answers other years: this one request failed (a timeout or an abort) */
          c.state = 'error'; c.at = Date.now();
          c.why = `the request for ${year} did not complete after ${TRIES} tries — the server itself is answering; it is asked again on the next draw after ${Math.round(ERROR_TTL_MS / 1000)} s`;
          return;
        }
        API.state = 'offline'; API.offlineAt = Date.now(); API.why = 'the live server (127.0.0.1:5034) did not answer';
        c.state = 'offline'; c.at = Date.now(); c.why = API.why;
      })
      .finally(() => { if (to) clearTimeout(to); redrawSoon(); });
  }
  /** one year of one source at one bus and market, or the reason there is none */
  function need(bus, source, market, year) {
    if (NO_FETCH) return { state: 'skipped', why: 'read from the live server on the timeline screen' };
    apiReset(false);
    const k = [bus, source, market, year].join('|');
    /* an "offline" verdict expires: re-probe rather than keep the session dark */
    if (API.state === 'offline' && Date.now() - (API.offlineAt || 0) > OFFLINE_TTL_MS) {
      API = { url: API.url, state: 'unknown', why: '', probe: null, offlineAt: 0 };
      [...CACHE.keys()].forEach(x => { const e = CACHE.get(x); if (e.state === 'offline') CACHE.delete(x); });
    }
    let c = CACHE.get(k);
    if (c && c.state === 'error' && c.at && Date.now() - c.at > ERROR_TTL_MS) { CACHE.delete(k); c = null; }
    if (c) return c;
    c = { state: 'loading', why: '' };
    CACHE.set(k, c);
    if (API.state === 'offline' || API.state === 'no-route') { c.state = API.state === 'offline' ? 'offline' : 'error'; c.why = API.why; c.at = Date.now(); return c; }
    const go = () => fetchInto(c, bus, source, market, year);
    if (API.state === 'online') go();
    else if (!API.probe) API.probe = go();
    else API.probe.then(() => {
      if (API.state === 'online') go();
      else { c.state = API.state === 'offline' ? 'offline' : 'error'; c.why = API.why; redrawSoon(); }
    });
    return c;
  }
  function retryServer() {
    API = { url: apiUrl(), state: 'unknown', why: '', probe: null, offlineAt: 0 };
    [...CACHE.keys()].forEach(k => { const c = CACHE.get(k); if (c.state !== 'ok') CACHE.delete(k); });
    drawAll();
  }
  /** the API's rows placed at their own hour index, for one component */
  function liveArray(c, seg, field) {
    c.arr = c.arr || {};
    const k = field + '|' + (seg.settled ? 's' : 'v') + seg.year;
    if (c.arr[k]) return c.arr[k];
    const a = new Array(calLen(seg.settled, seg.year)).fill(null);
    (c.body.rows || []).forEach(r => {
      const ts = String(r.ts || '');
      const y = +ts.slice(0, 4); if (y !== seg.year) return;
      const i = idxOfLabel(seg.settled, y, +ts.slice(5, 7) - 1, +ts.slice(8, 10), +ts.slice(11, 13));
      if (i >= 0 && i < a.length && r[field] != null && Number.isFinite(+r[field])) a[i] = +r[field];
    });
    return (c.arr[k] = a);
  }

  /* ── segments ──────────────────────────────────────────────────────────── */
  function shape(key, kind, year, extra) {
    const settled = kind === 'settled';
    return Object.assign({ key, kind, settled, year, base: Y0(year), s: settled ? springH(year) : Infinity, n: calLen(settled, year) }, extra || {});
  }
  function segLabel(seg) {
    const of = seg.kind === 'hub' ? seg.of : seg.kind;
    const base = of === 'settled' ? `Settled ${seg.year}${seg.partial ? ' · partial' : ''}` : `Solved run ${runName(seg.scenario, true)}`;
    return seg.kind === 'hub' ? `Hub · ${base}` : base;
  }
  function segShort(seg) {
    const of = seg.kind === 'hub' ? seg.of : seg.kind;
    return of === 'settled' ? `Settled ${seg.year}` : runName(seg.scenario, false).replace(/ · .*$/, '');
  }
  function segToken(seg) { return seg.kind === 'hub' ? HUB_TOK : seg.settled ? SETTLED_TOK : (RUN_TOK[seg.scenario] || 's8'); }

  function wanted() {
    const bus = ST.bus, out = [];
    settledYears().filter(y => y >= ST.from).forEach(y => out.push(shape('hist:' + y, 'settled', y, { scenario: 'hist', market: ST.market, bus })));
    runList().filter(r => ST.runs.includes(r.id)).forEach(r => out.push(shape(r.id, 'solved', r.target_year, { scenario: r.id, market: 'model', bus })));
    if (ST.hub && bus !== HUB) out.slice().forEach(s => out.push(Object.assign({}, s, { key: 'hub|' + s.key, kind: 'hub', of: s.kind, bus: HUB })));
    return out;
  }
  /** decide where one segment's hours come from, and whether it can be drawn */
  function resolve(seg) {
    seg.values = null; seg.status = null; seg.source = null; seg.reason = ''; seg.withheld = false;
    if (seg.bus !== HUB) {
      const b = busFull(seg.bus), e = b && b.hourly ? b.hourly[seg.key] : null;
      if (e) {
        seg.entry = e; seg.partial = !!e.partial;
        seg.calendar_hours = e.calendar_hours; seg.calendar_basis = e.calendar_basis;
        const mk = seg.settled ? seg.market : 'model';
        if (seg.settled && mk === 'DA' && e.da_held === false) {
          seg.status = 'not-held'; seg.reason = e.note || 'day-ahead is not held for this year'; return seg;
        }
        const arr = Array.isArray(e[mk]) ? e[mk] : null;
        if (ST.series === 'lmp' && arr && !e.hourly_withheld) {
          seg.values = arr; seg.n = arr.length; seg.status = 'drawn'; seg.source = 'embedded';
          seg.hoursHeld = e.hours && e.hours[mk] != null ? e.hours[mk] : null; return seg;
        }
        seg.withheld = !!e.hourly_withheld; seg.withheldNote = e.hourly_withheld_note || null;
      }
    }
    const src = seg.settled ? 'settled' : seg.scenario, mk = seg.settled ? seg.market : 'model';
    const c = need(seg.bus, src, mk, seg.year);
    seg.cache = c;
    if (c.state === 'ok') {
      const arr = liveArray(c, seg, ST.series);
      if (arr.some(v => v != null)) {
        seg.values = arr; seg.status = 'drawn'; seg.source = 'live';
        seg.partial = seg.partial || (seg.settled && c.body.hours < calLen(true, seg.year) - 24);
        seg.liveBody = c.body;
      } else { seg.status = 'not-held'; seg.reason = (c.body && c.body.note) || 'the live server holds no hours here'; }
    } else if (c.state === 'skipped') { seg.status = 'skipped'; seg.reason = seg.withheld ? 'withheld — live server on the timeline' : 'live server on the timeline'; }
    else if (c.state === 'loading') { seg.status = 'loading'; seg.reason = 'reading the live server…'; }
    else if (c.state === 'offline') { seg.status = 'offline'; seg.reason = seg.withheld ? 'withheld — offline' : 'live server offline'; }
    else { seg.status = 'error'; seg.reason = c.why || 'the live server could not serve this'; }
    return seg;
  }
  /* continuum S0 2026-10-06: on the Continuum's own screen the chosen scenario reaches a solved segment through
     the one rule (GSContinuum.scen.adjust — the Base run for its year at this location only); settled hours are
     never scaled, and the card (NO_FETCH) stays on Base. A new array: the cached hours are never touched. */
  function scenSeg(s) {
    const C = window.GSContinuum;
    if (NO_FETCH || !s.values || !C || !C.active() || !C.scen) return;
    const of = s.kind === 'hub' ? s.of : s.kind;
    if (of !== 'solved') return;
    const a = C.scen.adjust({ run: s.scenario, year: s.year, kind: 'solved', bus: s.bus === HUB ? null : Number(s.bus), view: SCREEN_K });
    if (!a.applied) return;
    s.values = s.values.map(v => v == null ? v : v * a.f);
    s.scen = a;
  }
  function segments() {
    const segs = wanted().map(resolve);
    segs.forEach(s => {
      s.label = segLabel(s); s.short = segShort(s); s.tok = segToken(s);
      scenSeg(s);
      if (s.values) {
        let f = -1, l = -1;
        for (let i = 0; i < s.values.length; i++) if (s.values[i] != null) { f = i; break; }
        for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) { l = i; break; }
        s.first = f; s.last = l;
        if (f < 0) { s.values = null; s.status = 'not-held'; s.reason = 'no hour carries a value'; }
      }
    });
    return segs;
  }

  /* ── small svg helpers ─────────────────────────────────────────────────── */
  let UID = 0;
  const svgEl = (t, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', t);
    if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    return n;
  };
  const txt = (attrs, s) => { const t = svgEl('text', attrs); t.textContent = s; return t; };
  function niceStep(span, n) {
    const raw = span / Math.max(1, n), p = Math.pow(10, Math.floor(Math.log10(raw || 1))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  /* ── one segment's path: exact vertices, or min/max per pixel column ─────── */
  function segPath(seg, vals, v0, v1, g, Y, exact) {
    const n = vals.length; if (!n) return null;
    const iA = Math.max(0, idxFloor(seg, v0) - 1), iB = Math.min(n - 1, idxCeil(seg, v1) + 1);
    if (iB < iA) return null;
    const base = seg.base, s = seg.s, st = seg.settled, x0 = g.x0, k = g.k;
    const xOf = i => x0 + (base + (st && i >= s ? i + 1 : i) * HOUR - v0) * k;
    let line = '', band = '', valid = 0;
    if (exact) {
      let pen = false;
      for (let i = iA; i <= iB; i++) {
        const v = vals[i];
        if (v == null) { pen = false; continue; }
        line += (pen ? 'L' : 'M') + xOf(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; valid++;
      }
      return { line, band, valid };
    }
    const runs = []; let cols = null;
    for (let i = iA; i <= iB; i++) {
      const v = vals[i];
      if (v == null) { if (cols) { runs.push(cols); cols = null; } continue; }
      const c = Math.floor(xOf(i));
      if (!cols) cols = [];
      let b = cols.length ? cols[cols.length - 1] : null;
      if (!b || b.c !== c) { b = { c, mn: v, mx: v, s: 0, n: 0 }; cols.push(b); }
      if (v < b.mn) b.mn = v;
      if (v > b.mx) b.mx = v;
      b.s += v; b.n++; valid++;
    }
    if (cols) runs.push(cols);
    for (const r of runs) {
      let top = '', bot = '';
      for (let j = 0; j < r.length; j++) { const b = r[j], y = Y(b.mx).toFixed(1); top += (j ? 'L' : 'M') + b.c + ',' + y + 'L' + (b.c + 1) + ',' + y; }
      for (let j = r.length - 1; j >= 0; j--) { const b = r[j], y = Y(b.mn).toFixed(1); bot += 'L' + (b.c + 1) + ',' + y + 'L' + b.c + ',' + y; }
      band += top + bot + 'Z';
      for (let j = 0; j < r.length; j++) { const b = r[j]; line += (j ? 'L' : 'M') + (b.c + 0.5) + ',' + Y(b.s / b.n).toFixed(1); }
    }
    return { line, band, valid };
  }
  /** the hours of a segment strictly inside [v0, v1): index range */
  function inView(seg, v0, v1) {
    const n = seg.values ? seg.values.length : seg.n;
    return [Math.max(0, idxCeil(seg, v0)), Math.min(n - 1, idxCeil(seg, v1) - 1)];
  }

  /* ── time axis ticks ───────────────────────────────────────────────────── */
  function timeTicks(v0, v1, pw) {
    const hrs = (v1 - v0) / HOUR, out = [];
    const yA = new Date(v0).getUTCFullYear(), yB = new Date(v1).getUTCFullYear();
    if (hrs > 24 * 500) {
      const pxYear = pw / (hrs / 8766), step = pxYear >= 34 ? 1 : pxYear >= 17 ? 2 : 5;
      for (let y = yA; y <= yB + 1; y++) {
        const t = Y0(y); if (t > v0 && t < v1) out.push({ t, line: true });
        const mid = (Y0(y) + Y0(y + 1)) / 2;
        if (y % step === 0 && mid >= v0 && mid <= v1) out.push({ t: mid, l: String(y) });
      }
    } else if (hrs > 24 * 45) {
      const pxMonth = pw / (hrs / 730), step = [1, 2, 3, 6].find(s => s * pxMonth >= 46) || 12;
      for (let y = yA; y <= yB; y++) for (let m = 0; m < 12; m += step) {
        const t = Date.UTC(y, m, 1); if (t >= v0 && t <= v1) out.push({ t, line: true, l: m === 0 ? `${MON[m]} ${y}` : MON[m] });
      }
    } else if (hrs > 60) {
      const pxDay = pw / (hrs / 24), step = [1, 2, 7, 14].find(s => s * pxDay >= 44) || 28;
      const d0 = new Date(v0); let t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
      for (let j = 0; t <= v1 && j < 400; t += DAY, j++) {
        const d = new Date(t);
        if (t >= v0 && (d.getUTCDate() - 1) % step === 0) out.push({ t, line: true, l: `${d.getUTCDate()} ${MON[d.getUTCMonth()]}${d.getUTCDate() === 1 && d.getUTCMonth() === 0 ? ' ' + d.getUTCFullYear() : ''}` });
      }
    } else {
      const pxHour = pw / Math.max(1, hrs), step = [1, 2, 3, 6, 12].find(s => s * pxHour >= 42) || 24;
      let t = Math.ceil(v0 / HOUR) * HOUR;
      for (let j = 0; t <= v1 && j < 900; t += HOUR, j++) {
        const d = new Date(t), h = d.getUTCHours();
        if (h % step === 0) out.push({ t, line: true, l: h === 0 ? `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` : `${pad2(h)}:00` });
      }
    }
    return out;
  }

  /* ── coverage: what the axis holds, and the labelled gaps between ──────── */
  function spanLabel(t0, t1) {
    const a = new Date(t0), b = new Date(t1 - 1);
    const yStart = a.getUTCMonth() === 0 && a.getUTCDate() === 1 && a.getUTCHours() === 0;
    const yEnd = new Date(t1).getUTCMonth() === 0 && new Date(t1).getUTCDate() === 1 && new Date(t1).getUTCHours() === 0;
    if (yStart && yEnd) return a.getUTCFullYear() === b.getUTCFullYear() ? String(a.getUTCFullYear()) : `${a.getUTCFullYear()}–${b.getUTCFullYear()}`;
    return `${fmtMonthYear(t0)} – ${fmtMonthYear(t1 - 1)}`;
  }
  function layout(segs) {
    const own = segs.filter(s => s.kind !== 'hub');
    if (!own.length) return null;
    const d0 = Math.min(...own.map(s => s.base)), d1 = Math.max(...own.map(s => Y0(s.year + 1)));
    const cover = own.map(s => {
      if (s.values && s.last >= 0) {
        /* a partial settled year covers only to its last settled hour; what
           follows is a gap like any other, not a flat line */
        const end = s.settled && s.partial ? tI(s, s.last) + HOUR : Y0(s.year + 1);
        return { t0: s.base, t1: end, seg: s };
      }
      return { t0: s.base, t1: Y0(s.year + 1), seg: s, hole: true };
    }).sort((a, b) => a.t0 - b.t0);
    const gaps = []; let at = d0;
    const years = (a, b) => { const ya = new Date(a).getUTCFullYear(), yb = new Date(b - 1).getUTCFullYear(); return ya === yb ? String(ya) : `${ya}–${yb}`; };
    const gap = (a, b) => ({ t0: a, t1: b, label: `${spanLabel(a, b)} · no hours held`, short: years(a, b), shortRest: 'none held' });
    cover.forEach(c => { if (c.t0 - at >= HOUR) gaps.push(gap(at, c.t0)); at = Math.max(at, c.t1); });
    if (d1 - at >= HOUR) gaps.push(gap(at, d1));
    const holes = cover.filter(c => c.hole).map(c => ({ t0: c.t0, t1: c.t1, seg: c.seg,
      label: `${c.seg.year} · ${c.seg.settled ? '' : runName(c.seg.scenario, false) + ' · '}${c.seg.reason || 'not drawn'}`,
      short: String(c.seg.year), shortRest: c.seg.withheld ? 'withheld' : ({ offline: 'offline', loading: 'loading…', 'not-held': 'not held', error: 'not served', skipped: 'live only' }[c.seg.status] || '') }));
    const settledDrawn = own.filter(s => s.settled && s.values && s.last >= 0);
    const lastSettled = settledDrawn.length ? Math.max(...settledDrawn.map(s => tI(s, s.last))) : null;
    return { domain: [d0, d1], gaps, holes, lastSettled };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     The timeline chart
     ═══════════════════════════════════════════════════════════════════════ */
  function drawTimeline(box, segs, opts) {
    const o = opts || {}, compact = !!o.compact;
    const lay = layout(segs);
    const W = Math.max(300, Math.floor(o.width || box.clientWidth || 800));
    const Hh = compact ? 150 : 300;
    const P = compact ? { l: 40, r: 8, t: 8, b: 18 } : { l: 54, r: 12, t: 34, b: 22 };
    const g = { W, H: Hh, x0: P.l, x1: W - P.r, y0: P.t, y1: Hh - P.b };
    const svg = svgEl('svg', { class: 'htl-svg', width: W, height: Hh, 'data-htl': compact ? 'card' : 'chart', role: 'img',
      'aria-label': `Hourly ${ST.series === 'lmp' ? 'LMP' : ST.series} at ${busName(ST.bus)}: settled hours then the solved runs on one time axis` });
    const info = { segments: [], gaps: [], holes: [], divider: null, plot: { x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1, W, H: Hh }, view: null, domain: null, clipped: 0, exact: false };
    if (!lay) { box.appendChild(svg); return info; }
    let view = compact || !ST.view ? lay.domain.slice() : ST.view.slice();
    view[0] = Math.max(lay.domain[0], view[0]); view[1] = Math.min(lay.domain[1], view[1]);
    if (view[1] - view[0] < 6 * HOUR) view = [view[0], Math.min(lay.domain[1], view[0] + 6 * HOUR)];
    g.k = (g.x1 - g.x0) / (view[1] - view[0]);
    g.v0 = view[0]; g.v1 = view[1];
    const X = t => g.x0 + (t - view[0]) * g.k;
    info.view = view; info.domain = lay.domain.slice();
    const exact = 1 / (HOUR * g.k) <= EXACT_HOURS_PER_PX;
    info.exact = exact;

    /* pass 1 · the y range from the hours in view */
    const drawn = segs.filter(s => s.values);
    let lo = Infinity, hi = -Infinity, all = null, allN = 0;
    const ranges = drawn.map(s => {
      const r = inView(s, view[0], view[1]);
      for (let i = r[0]; i <= r[1]; i++) { const v = s.values[i]; if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; allN++; } }
      return r;
    });
    let beyond = 0;
    if (ST.yr !== 'full' && allN > 50) {
      all = new Float64Array(allN); let j = 0;
      drawn.forEach((s, q) => { const r = ranges[q]; for (let i = r[0]; i <= r[1]; i++) { const v = s.values[i]; if (v != null) all[j++] = v; } });
      all.sort(); const qlo = quantile(all, ROBUST[0]), qhi = quantile(all, ROBUST[1]);
      if (qlo > lo || qhi < hi) { for (let i = 0; i < allN; i++) if (all[i] < qlo || all[i] > qhi) beyond++; lo = qlo; hi = qhi; }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (lo > 0 && lo < (hi - lo) * 0.25) lo = 0;
    const padV = (hi - lo) * 0.06 || 1; lo -= padV; hi += padV;
    const ky = (g.y1 - g.y0) / (hi - lo);
    let clipped = 0;
    const Y = beyond
      ? v => { let y = g.y0 + (hi - v) * ky; if (y < g.y0 - 1) y = g.y0 - 1; else if (y > g.y1 + 1) y = g.y1 + 1; return y; }
      : v => g.y0 + (hi - v) * ky;
    clipped = beyond;
    info.yRange = [lo, hi];

    /* the frame */
    const uid = 'htl' + (++UID);
    const defs = svgEl('defs');
    const cp = svgEl('clipPath', { id: uid + '-clip' }); cp.appendChild(svgEl('rect', { x: g.x0, y: g.y0 - 2, width: g.x1 - g.x0, height: g.y1 - g.y0 + 4 }));
    const pat = svgEl('pattern', { id: uid + '-hatch', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' });
    pat.appendChild(svgEl('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'htl-hatch' }));
    defs.appendChild(cp); defs.appendChild(pat); svg.appendChild(defs);

    const step = niceStep(hi - lo, compact ? 3 : 5);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Y(v);
      svg.appendChild(svgEl('line', { x1: g.x0, x2: g.x1, y1: y.toFixed(1), y2: y.toFixed(1), class: Math.abs(v) < step / 1e6 ? 'gsc-axis htl-zero' : 'gsc-grid' }));
      svg.appendChild(txt({ x: g.x0 - 5, y: y + 3, class: 'gsc-ax', 'text-anchor': 'end' }, '$' + fmt.num(v, step < 1 ? 2 : 0)));
    }
    if (!compact) svg.appendChild(txt({ x: 10, y: (g.y0 + g.y1) / 2, class: 'gsc-axl', transform: `rotate(-90 10 ${(g.y0 + g.y1) / 2})`, 'text-anchor': 'middle' },
      `${SERIES.find(s => s[0] === ST.series)[1]} $/MWh`));
    timeTicks(view[0], view[1], g.x1 - g.x0).forEach(tk => {
      const x = X(tk.t);
      if (tk.line) svg.appendChild(svgEl('line', { x1: x.toFixed(1), x2: x.toFixed(1), y1: g.y0, y2: g.y1, class: 'gsc-grid' }));
      if (tk.l && (!compact || /^\d{4}$/.test(tk.l))) {
        const lab = txt({ x: x.toFixed(1), y: g.y1 + 14, class: 'gsc-ax', 'text-anchor': 'middle', 'data-htl-xtick': '' }, tk.l);
        if (x > g.x0 + 8 && x < g.x1 - 8) svg.appendChild(lab);
      }
    });
    svg.appendChild(svgEl('line', { x1: g.x0, x2: g.x1, y1: g.y1, y2: g.y1, class: 'gsc-axis' }));

    /* gaps and holes — labelled, hatched, and nothing drawn across them */
    const band = (list, kind) => list.forEach(gp => {
      const a = Math.max(g.x0, X(gp.t0)), b = Math.min(g.x1, X(gp.t1));
      if (b - a < 0.5) return;
      const r = svgEl('rect', { x: a.toFixed(1), y: g.y0, width: (b - a).toFixed(1), height: g.y1 - g.y0, class: kind === 'gap' ? 'htl-gap' : 'htl-hole',
        fill: `url(#${uid}-hatch)`, 'data-label': gp.label, 'data-x0': a.toFixed(1), 'data-x1': b.toFixed(1) });
      if (kind === 'gap') r.setAttribute('data-htl-gap', '');
      else { r.setAttribute('data-htl-hole', gp.seg.key); if (gp.seg.withheld || /withheld/.test(gp.label)) r.setAttribute('data-htl-withheld', gp.seg.key); }
      const tt = svgEl('title'); tt.textContent = gp.label + (kind === 'gap' ? ' — a gap, never bridged' : ''); r.appendChild(tt);
      svg.appendChild(r);
      (kind === 'gap' ? info.gaps : info.holes).push({ t0: gp.t0, t1: gp.t1, x0: a, x1: b, label: gp.label, key: gp.seg ? gp.seg.key : null });
      /* the full words where they fit, a short form where they do not, and the
         whole sentence always on the rect's own title and data-label */
      const w = b - a, cx = (a + b) / 2, parts = gp.label.split(' · ');
      const head = parts[0], rest = parts.slice(1).join(' · ');
      const cw = compact ? 5.3 : 5.75, fits = s => !!s && s.length * cw + 3 <= w;
      const h1 = [head, gp.short].find(fits);
      if (h1) {
        svg.appendChild(txt({ x: cx.toFixed(1), y: g.y0 + 13, class: 'htl-gapl', 'text-anchor': 'middle' }, h1));
        const r1 = compact ? null : [rest, gp.shortRest].find(fits);
        if (r1) svg.appendChild(txt({ x: cx.toFixed(1), y: g.y0 + 25, class: 'htl-gapl', 'text-anchor': 'middle' }, r1));
        else if (!compact && rest && w >= 30) {
          const lines = []; let lineS = '';
          rest.split(' ').forEach(wd => { if (lineS && (lineS + ' ' + wd).length * cw > w - 6) { lines.push(lineS); lineS = wd; } else lineS = (lineS + ' ' + wd).trim(); });
          if (lineS) lines.push(lineS);
          if (lines.length <= 3 && lines.every(fits)) lines.forEach((l, q) => svg.appendChild(txt({ x: cx.toFixed(1), y: g.y0 + 25 + q * 11, class: 'htl-gapl', 'text-anchor': 'middle' }, l)));
        }
      }
    });
    band(lay.gaps, 'gap');
    band(lay.holes, 'hole');

    /* pass 2 · the paths */
    const gp = svgEl('g', { 'clip-path': `url(#${uid}-clip)` });
    const order = drawn.slice().sort((a, b) => (a.kind === 'hub') - (b.kind === 'hub'));
    order.forEach(s => {
      const r = inView(s, view[0], view[1]);
      const p = segPath(s, s.values, view[0], view[1], g, Y, exact);
      const walked = Math.max(0, r[1] - r[0] + 1);
      const rec = { key: s.key, kind: s.kind, source: s.source, status: s.status, label: s.label, drawn: !!(p && p.valid), points: walked, valid: p ? p.valid : 0,
        px0: X(tI(s, s.first)), px1: X(tI(s, s.last)) };
      info.segments.push(rec);
      if (!p || !p.valid) return;
      const common = { 'data-htl-seg': s.key, 'data-htl-kind': s.kind, 'data-htl-src': s.source };
      if (p.band) gp.appendChild(svgEl('path', Object.assign({ d: p.band, class: 'htl-band' + (s.kind === 'hub' ? ' hub' : ''), style: `fill:var(--${s.tok})`, 'data-htl-part': 'band' }, common)));
      const dashed = !(s.kind === 'hub' ? s.of === 'settled' : s.settled);
      gp.appendChild(svgEl('path', Object.assign({ d: p.line, class: 'htl-line' + (s.kind === 'hub' ? ' hub' : '') + (exact ? ' exact' : ''),
        style: `stroke:var(--${s.tok})`, 'stroke-dasharray': dashed ? (compact ? '4 2' : '6 3') : 'none', 'data-htl-part': 'line' }, common)));
    });
    segs.filter(s => !s.values).forEach(s => info.segments.push({ key: s.key, kind: s.kind, source: null, status: s.status, label: s.label, drawn: false, points: 0, valid: 0, reason: s.reason }));
    svg.appendChild(gp);
    info.clipped = clipped;

    /* the last settled hour */
    if (lay.lastSettled != null && lay.lastSettled >= view[0] && lay.lastSettled <= view[1]) {
      const x = X(lay.lastSettled);
      svg.appendChild(svgEl('line', { x1: x.toFixed(1), x2: x.toFixed(1), y1: g.y0 - (compact ? 0 : 4), y2: g.y1, class: 'htl-div', 'data-htl-divider': '' }));
      const label = compact ? 'last settled hour' : `Last settled hour · ${fmtLong(lay.lastSettled)}`;
      const right = x > g.x1 - label.length * 6;
      svg.appendChild(txt({ x: (x + (right ? -4 : 4)).toFixed(1), y: compact ? g.y1 - 4 : g.y1 - 6, class: 'htl-divl', 'text-anchor': right ? 'end' : 'start', 'data-htl-divider-label': '' }, label));
      info.divider = { t: lay.lastSettled, x, label };
    }

    /* segment names above the plot, two lanes, no overlaps */
    if (!compact) {
      const groups = [];
      drawn.filter(s => s.kind !== 'hub').sort((a, b) => a.base - b.base).forEach(s => {
        const a = X(tI(s, s.first)), b = X(tI(s, s.last) + HOUR);
        const prev = groups[groups.length - 1];
        if (s.settled && prev && prev.settled && Math.abs(prev.tEnd - s.base) <= HOUR * 2) { prev.b = b; prev.tEnd = tI(s, s.last) + HOUR; prev.last = s; return; }
        groups.push({ settled: s.settled, a, b, first: s, last: s, tEnd: tI(s, s.last) + HOUR, tok: s.tok });
      });
      const lanes = [[], []];
      groups.forEach(gr => {
        const name = gr.settled ? (gr.first === gr.last ? `Settled ${gr.first.year}` : `Settled ${gr.first.year} – ${gr.last.partial ? fmtMonthYear(tI(gr.last, gr.last.last)) : gr.last.year}`)
          : `Solved run ${runName(gr.first.scenario, true).replace(/ · .*$/, '')}`;
        const a = Math.max(g.x0, gr.a), b = Math.min(g.x1, gr.b); if (b <= a) return;
        const w = name.length * 5.9, cx = Math.max(g.x0 + w / 2, Math.min(g.x1 - w / 2, (a + b) / 2));
        const lane = lanes.findIndex(l => !l.some(q => cx - w / 2 < q[1] + 6 && cx + w / 2 > q[0] - 6));
        if (lane < 0) return;
        lanes[lane].push([cx - w / 2, cx + w / 2]);
        const y = g.y0 - 6 - lane * 13;
        svg.appendChild(svgEl('line', { x1: a.toFixed(1), x2: b.toFixed(1), y1: y + 3, y2: y + 3, class: 'htl-segbar', style: `stroke:var(--${gr.tok})`, 'stroke-dasharray': gr.settled ? 'none' : '4 2' }));
        const t = txt({ x: cx.toFixed(1), y: y - 1, class: 'htl-segl', 'text-anchor': 'middle', 'data-htl-seglabel': gr.first.key }, name);
        svg.appendChild(t);
      });
    }
    box.appendChild(svg);
    info.g = g; info.X = X;
    return info;
  }

  /* ── the overview strip and its brush ──────────────────────────────────── */
  function drawOverview(box, segs, info) {
    const W = info.plot.W, Hh = 46;
    const lay = layout(segs); if (!lay) return;
    const g = { x0: info.plot.x0, x1: info.plot.x1, y0: 4, y1: Hh - 4 };
    g.k = (g.x1 - g.x0) / (lay.domain[1] - lay.domain[0]);
    const svg = svgEl('svg', { class: 'htl-svg htl-ov', width: W, height: Hh, 'data-htl': 'overview', role: 'img', 'aria-label': 'Overview of the whole axis; drag to choose the window' });
    const drawn = segs.filter(s => s.values && s.kind !== 'hub');
    let lo = Infinity, hi = -Infinity;
    drawn.forEach(s => { for (let i = 0; i < s.values.length; i++) { const v = s.values[i]; if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; } } });
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const ky = (g.y1 - g.y0) / ((hi - lo) || 1);
    const Y = v => g.y0 + (hi - v) * ky;
    svg.appendChild(svgEl('rect', { x: g.x0, y: 0, width: g.x1 - g.x0, height: Hh, class: 'htl-ovbg' }));
    lay.gaps.forEach(gp => svg.appendChild(svgEl('rect', { x: (g.x0 + (gp.t0 - lay.domain[0]) * g.k).toFixed(1), y: 0, width: Math.max(0, (gp.t1 - gp.t0) * g.k).toFixed(1), height: Hh, class: 'htl-ovgap' })));
    drawn.forEach(s => {
      const p = segPath(s, s.values, lay.domain[0], lay.domain[1], { x0: g.x0, k: g.k }, Y, false);
      if (!p || !p.valid) return;
      svg.appendChild(svgEl('path', { d: p.band, class: 'htl-band ov', style: `fill:var(--${s.tok})` }));
      svg.appendChild(svgEl('path', { d: p.line, class: 'htl-line ov', style: `stroke:var(--${s.tok})`, 'stroke-dasharray': s.settled ? 'none' : '3 2' }));
    });
    const bx = g.x0 + (info.view[0] - lay.domain[0]) * g.k, bw = Math.max(2, (info.view[1] - info.view[0]) * g.k);
    svg.appendChild(svgEl('rect', { x: bx.toFixed(1), y: 1, width: bw.toFixed(1), height: Hh - 2, class: 'htl-brush', 'data-htl-brush': '' }));
    box.appendChild(svg);
    return { g, domain: lay.domain, svg };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     The same-hour-of-year overlay
     ═══════════════════════════════════════════════════════════════════════ */
  const REF_YEAR = 2025;          // a common year: a week is placed by DATE, so 29 Feb falls out of week views
  function weekStart(w) { return Y0(REF_YEAR) + 7 * (w - 1) * DAY; }
  function periodSeries(s) {
    const out = [];
    if (ST.period === 'week') {
      const t0 = weekStart(ST.week);
      for (let k = 0; k < 168; k++) {
        const d = new Date(t0 + k * HOUR);
        const i = idxOfLabel(s.settled, s.year, d.getUTCMonth(), d.getUTCDate(), d.getUTCHours());
        out.push(i >= 0 && i < s.values.length ? s.values[i] : null);
      }
      return out;
    }
    const m0 = ST.month - 1, days = new Date(Date.UTC(s.year, m0 + 1, 0)).getUTCDate();
    for (let d = 1; d <= days; d++) for (let h = 0; h < 24; h++) {
      const i = idxOfLabel(s.settled, s.year, m0, d, h);
      out.push(i >= 0 && i < s.values.length ? s.values[i] : null);
    }
    return out;
  }
  function overlaySets(segs) {
    const drawn = segs.filter(s => s.values && s.kind !== 'hub');
    const settled = drawn.filter(s => s.settled);
    return drawn.map(s => {
      const vals = periodSeries(s);
      const rank = settled.indexOf(s);
      const op = s.settled ? (settled.length <= 1 ? 1 : 0.35 + 0.65 * rank / (settled.length - 1)) : 1;
      return { seg: s, vals, op };
    }).filter(x => x.vals.some(v => v != null));
  }
  function periodLabel() {
    if (ST.period === 'week') { const d = new Date(weekStart(ST.week)), e = new Date(weekStart(ST.week) + 6 * DAY); return `week ${ST.week} · ${d.getUTCDate()} ${MON[d.getUTCMonth()]} – ${e.getUTCDate()} ${MON[e.getUTCMonth()]}`; }
    return MONTH_FULL[ST.month - 1];
  }
  function drawOverlay(box, segs) {
    const sets = overlaySets(segs);
    const W = Math.max(300, Math.floor(box.clientWidth || 800)), Hh = 300;
    const P = { l: 54, r: 12, t: 12, b: 24 };
    const g = { W, H: Hh, x0: P.l, x1: W - P.r, y0: P.t, y1: Hh - P.b };
    const L = ST.period === 'week' ? 168 : Math.max(24, ...sets.map(x => x.vals.length));
    const kx = (g.x1 - g.x0) / Math.max(1, L - 1);
    const X = k => g.x0 + k * kx;
    const svg = svgEl('svg', { class: 'htl-svg', width: W, height: Hh, 'data-htl': 'overlay', role: 'img',
      'aria-label': `${periodLabel()} of every settled year and every selected solved run on one day-of-${ST.period === 'week' ? 'week' : 'month'} axis` });
    let lo = Infinity, hi = -Infinity; const allv = [];
    let beyond = 0;
    sets.forEach(x => x.vals.forEach(v => { if (v != null) { if (v < lo) lo = v; if (v > hi) hi = v; if (ST.yr !== 'full') allv.push(v); } }));
    if (ST.yr !== 'full' && allv.length > 50) {
      allv.sort((a, b) => a - b); const qlo = quantile(allv, ROBUST[0]), qhi = quantile(allv, ROBUST[1]);
      if (qlo > lo || qhi < hi) { beyond = allv.filter(v => v < qlo || v > qhi).length; lo = qlo; hi = qhi; }
    }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    if (lo > 0 && lo < (hi - lo) * 0.25) lo = 0;
    const pv = (hi - lo) * 0.06 || 1; lo -= pv; hi += pv;
    const ky = (g.y1 - g.y0) / (hi - lo);
    const Y = v => Math.max(g.y0 - 1, Math.min(g.y1 + 1, g.y0 + (hi - v) * ky));
    const step = niceStep(hi - lo, 5);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const y = Y(v);
      svg.appendChild(svgEl('line', { x1: g.x0, x2: g.x1, y1: y.toFixed(1), y2: y.toFixed(1), class: Math.abs(v) < step / 1e6 ? 'gsc-axis htl-zero' : 'gsc-grid' }));
      svg.appendChild(txt({ x: g.x0 - 5, y: y + 3, class: 'gsc-ax', 'text-anchor': 'end' }, '$' + fmt.num(v, step < 1 ? 2 : 0)));
    }
    svg.appendChild(txt({ x: 10, y: (g.y0 + g.y1) / 2, class: 'gsc-axl', transform: `rotate(-90 10 ${(g.y0 + g.y1) / 2})`, 'text-anchor': 'middle' },
      `${SERIES.find(s => s[0] === ST.series)[1]} $/MWh`));
    const days = Math.round(L / 24);
    const dayStep = W < 700 ? 5 : 5;
    for (let d = 0; d < days; d++) {
      const x = X(d * 24);
      svg.appendChild(svgEl('line', { x1: x.toFixed(1), x2: x.toFixed(1), y1: g.y0, y2: g.y1, class: 'gsc-grid' }));
      let lab = null;
      if (ST.period === 'week') { const dd = new Date(weekStart(ST.week) + d * DAY); lab = `${dd.getUTCDate()} ${MON[dd.getUTCMonth()]}`; }
      else if (d === 0 || (d + 1) % dayStep === 0 || d === days - 1) lab = String(d + 1);
      if (lab) svg.appendChild(txt({ x: (x + 12 * kx).toFixed(1), y: g.y1 + 14, class: 'gsc-ax', 'text-anchor': 'middle', 'data-htl-xtick': '' }, lab));
    }
    svg.appendChild(svgEl('line', { x1: g.x0, x2: g.x1, y1: g.y1, y2: g.y1, class: 'gsc-axis' }));
    const gp = svgEl('g');
    sets.slice().sort((a, b) => (b.seg.settled - a.seg.settled)).forEach(x => {
      let d = '', pen = false;
      x.vals.forEach((v, k) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(v).toFixed(1); pen = true; });
      if (!d) return;
      gp.appendChild(svgEl('path', { d, class: 'htl-line exact', style: `stroke:var(--${x.seg.tok})`, 'stroke-opacity': x.op.toFixed(2),
        'stroke-dasharray': x.seg.settled ? 'none' : '6 3', 'data-htl-seg': x.seg.key, 'data-htl-kind': x.seg.kind, 'data-htl-src': x.seg.source, 'data-htl-part': 'line' }));
    });
    svg.appendChild(gp);
    box.appendChild(svg);
    return { plot: { x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1, W, H: Hh }, sets, L, X, kx, g, beyond };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Stats strip — one row per segment, on the hours in view
     ═══════════════════════════════════════════════════════════════════════ */
  function statOf(vals) {
    let n = 0, sum = 0, neg = 0, mx = -Infinity, absent = 0;
    const a = new Float64Array(vals.length);
    for (let i = 0; i < vals.length; i++) { const v = vals[i]; if (v == null) { absent++; continue; } a[n++] = v; sum += v; if (v < 0) neg++; if (v > mx) mx = v; }
    if (!n) return { n: 0, absent };
    const s = a.subarray(0, n).sort();
    return { n, absent, mean: sum / n, p10: quantile(s, 0.10), p90: quantile(s, 0.90), neg, max: mx };
  }
  function statsRows(segs, info, sets) {
    if (ST.mode === 'overlay' && sets) return sets.map(x => Object.assign({ seg: x.seg }, statOf(x.vals)));
    const v0 = info && info.view ? info.view[0] : -Infinity, v1 = info && info.view ? info.view[1] : Infinity;
    return segs.filter(s => s.values).map(s => {
      const r = inView(s, v0, v1);
      return Object.assign({ seg: s }, r[1] >= r[0] ? statOf(s.values.slice(r[0], r[1] + 1)) : { n: 0, absent: 0 });
    }).filter(r => r.n > 0 || r.absent > 0);
  }
  const STAT_COLS = [
    { l: 'Segment' }, { l: 'Market' }, { l: 'Source' }, { l: 'Hours' },
    { l: 'Mean ($/MWh)' }, { l: 'P10 ($/MWh)' }, { l: 'P90 ($/MWh)' }, { l: 'Negative hours' }, { l: 'Max ($/MWh)' },
  ];
  const srcWord = s => s === 'embedded' ? 'embedded' : s === 'live' ? 'live server' : s || '—';
  const mktWord = seg => (seg.kind === 'hub' ? seg.of : seg.kind) === 'settled' ? seg.market : 'model';
  function statCells(r) {
    const f = v => v == null ? 'no value' : fmt.num(v, 2);
    return [r.seg.label, mktWord(r.seg), srcWord(r.seg.source), `${fmt.int(r.n)}${r.absent ? ` (+${fmt.int(r.absent)} absent)` : ''}`,
      f(r.mean), f(r.p10), f(r.p90), r.n ? fmt.int(r.neg) : 'no value', f(r.max)];
  }
  function statsTable(rows, where) {
    const t = H('table', 'gsc-tbl htl-stats'); t.setAttribute('data-htl', 'stats');
    const th = H('thead'), tr = H('tr');
    STAT_COLS.forEach(c => tr.appendChild(H('th', null, c.l)));
    th.appendChild(tr); t.appendChild(th);
    const tb = H('tbody');
    rows.forEach(r => {
      const x = H('tr'); x.setAttribute('data-htl-stat', r.seg.key);
      if (r.n) { x.dataset.mean = String(r.mean); x.dataset.neg = String(r.neg); }
      statCells(r).forEach((c, i) => {
        const td = H('td', i === 0 ? 't' : null, c);
        if (i === 0) { const sw = H('i', 'htl-sw' + (r.seg.settled || (r.seg.kind === 'hub' && r.seg.of === 'settled') ? '' : ' dash')); sw.style.setProperty('--c', `var(--${r.seg.tok})`); td.insertBefore(sw, td.firstChild); }
        x.appendChild(td);
      });
      tb.appendChild(x);
    });
    t.appendChild(tb);
    const wrap = H('div', 'htl-statwrap');
    wrap.appendChild(H('div', 'htl-k', `Segment statistics · ${where} · ${SERIES.find(s => s[0] === ST.series)[1]}`));
    const sc = H('div', 'gsc-scroll'); sc.appendChild(t); wrap.appendChild(sc);
    return wrap;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     The face (scope, node, tier, distance, sources, calendars) and notices
     ═══════════════════════════════════════════════════════════════════════ */
  function sourcesText(segs) {
    const own = segs.filter(s => s.kind !== 'hub');
    const parts = [];
    const settled = own.filter(s => s.settled);
    const grp = {};
    settled.forEach(s => { const w = s.source ? srcWord(s.source) : (s.reason || s.status); (grp[w] = grp[w] || []).push(s.year); });
    Object.keys(grp).forEach(w => { const ys = grp[w]; parts.push(`Settled ${ys.length > 1 ? ys[0] + '–' + ys[ys.length - 1] : ys[0]} · ${w}`); });
    own.filter(s => !s.settled).forEach(s => parts.push(`${runName(s.scenario, true).replace(/ · .*$/, '')} · ${s.source ? srcWord(s.source) : (s.reason || s.status)}`));
    const hub = segs.filter(s => s.kind === 'hub');
    if (hub.length) { const d = hub.filter(s => s.values).length; parts.push(`Hub · ${d ? `live server (${d} of ${hub.length} segments)` : (hub[0].reason || 'live server needed')}`); }
    return parts.join('; ');
  }
  function nodeFacts(segs) {
    if (ST.bus === HUB) return { node: HUB, tier: 'hub', mi: null, note: 'the ISO-NE internal hub; the runs read their own aggregate hub node 80000' };
    const b = busFull(ST.bus);
    if (b) return { node: b.price_node || 'not stated', tier: b.tier || 'not stated', mi: b.tier === 'geo_proxy' && b.distance_mi != null ? +b.distance_mi : null, note: b.proxy_note || null, shared: b.buses_sharing_series };
    const live = segs.find(s => s.settled && s.kind !== 'hub' && s.liveBody);
    if (live) { const x = live.liveBody; return { node: x.price_node || 'not stated', tier: x.tier || 'not stated', mi: x.distance_mi != null ? +x.distance_mi : null, note: x.tier_label || null, shared: x.buses_sharing_series }; }
    return { node: 'not known offline — the live server resolves it', tier: 'not known offline', mi: null, note: null };
  }
  function updateFace(segs) {
    if (!FACE) return;
    const nf = nodeFacts(segs);
    const parts = [
      ['bus', busName(ST.bus) + (ST.bus !== HUB ? (isDemo(ST.bus) ? ' · embedded (demo bus)' : ' · not embedded — live server') : ' · live server')],
      ['price node', `${nf.node} (settled record)`],
      ['tier', TIER_WORD[nf.tier] || nf.tier],
      ['distance', nf.mi != null ? `${fmt.num(nf.mi, 2)} mi from the bus` : 'none — not a proxy read'],
      ['solved runs', 'keyed by bus — the bus\'s own series; a settled proxy does not apply to a run'],
      ['market', `settled ${ST.market} · runs model`],
      ['sources', sourcesText(segs)],
      ['calendar', 'settled: local hour labels, 8,759 h in a common year (8,783 leap) · solved run: flat 8,760 h (8,784 leap), no daylight saving'],
    ];
    FACE.innerHTML = '';
    parts.forEach(([k, v]) => { const s = H('span'); s.innerHTML = `<b>${esc(k)}</b> ${esc(String(v))}`; if (k === 'sources') s.setAttribute('data-htl-sources', ''); FACE.appendChild(s); });
  }
  function noticeText(segs) {
    const out = [];
    const own = segs.filter(s => s.kind !== 'hub'), hub = segs.filter(s => s.kind === 'hub');
    const serverWhy = API.why || 'the live server did not answer';
    const needs = own.filter(s => !s.values && (s.status === 'offline' || s.status === 'error'));
    const loading = segs.filter(s => s.status === 'loading');
    const sName = SERIES.find(s => s[0] === ST.series)[1];
    if (ST.series !== 'lmp' && needs.length) out.push(`${sName} is not in the embedded file — it holds the LMP alone, so ${sName.toLowerCase()} comes from the live server. ${API.state === 'offline' ? 'The live server is offline' : serverWhy}: nothing is drawn for ${sName.toLowerCase()} rather than a stand-in.`);
    else if (ST.bus !== HUB && !isDemo(ST.bus) && needs.length) out.push(`${busShort(ST.bus)} is not one of the ${demoIds().length} demo buses embedded offline; its hours come from the live server, and ${API.state === 'offline' ? 'the live server is offline' : serverWhy}. Pick a demo bus to read the embedded record.`);
    else if (ST.bus === HUB && needs.length) out.push(`The hub's hourly record is not embedded; it comes from the live server, and ${API.state === 'offline' ? 'the live server is offline' : serverWhy}.`);
    else if (needs.length) out.push(`${needs.map(s => `${s.year}${s.settled ? '' : ' ' + runName(s.scenario, false)}: ${s.reason}`).join('; ')}. ${needs.some(s => s.withheld) ? (needs.find(s => s.withheldNote) || {}).withheldNote || 'The exporter withheld these hours from the offline file for size.' : ''} ${API.state === 'offline' ? 'The live server is offline, so the year stays a labelled hole — never a line.' : serverWhy}`);
    const hubNeeds = hub.filter(s => !s.values && s.status !== 'loading' && s.status !== 'not-held');
    if (hubNeeds.length) out.push(`Hub comparison: the hub's hours are not embedded and come from the live server; ${API.state === 'offline' ? 'the live server is offline, so no hub line is drawn' : serverWhy}.`);
    if (loading.length) out.push(`Reading ${loading.length} segment${loading.length === 1 ? '' : 's'} from the live server…`);
    /* orchestrator 2026-09-28 sign fix: the 5-year run's Cape input case, named where that run is drawn at a flagged bus */
    const rs = window.GSX_RUNSIGN, cf = rs && ST.bus !== HUB ? rs.cape(ST.bus) : null;
    if (cf && own.some(s => !s.settled && s.scenario === '5yr' && s.values)) out.push(rs.text(cf));
    return out.join(' ');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     The screen: controls, chart, overview, legend, stats
     ═══════════════════════════════════════════════════════════════════════ */
  function segCtl(name, id, opts, cur, on) {
    const g = H('div', 'gsc-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', name);
    g.setAttribute('data-htl-ctl', id);
    opts.forEach(o => {
      const b = H('button', null, o.l); b.type = 'button'; b.dataset.val = String(o.v);
      b.setAttribute('aria-pressed', String(o.v) === String(cur) ? 'true' : 'false');
      if (o.t) b.title = o.t;
      b.onclick = () => on(o.v);
      g.appendChild(b);
    });
    return g;
  }
  function field(label, ...kids) {
    const f = H('div', 'htl-f'); f.appendChild(H('span', 'htl-lab', label)); kids.forEach(k => k && f.appendChild(k)); return f;
  }
  function select(id, label, opts, cur, on) {
    const s = document.createElement('select'); s.className = 'htl-sel'; s.setAttribute('data-htl-ctl', id); s.setAttribute('aria-label', label);
    opts.forEach(o => { const op = document.createElement('option'); op.value = String(o.v); op.textContent = o.l; if (String(o.v) === String(cur)) op.selected = true; s.appendChild(op); });
    s.onchange = () => on(s.value);
    return s;
  }
  const set = (patch, full) => { Object.assign(ST, patch); save(); if (full && CX) CX.paint(); else drawAll(true); };

  function setBus(v) {
    const id = v === HUB || v === 'hub' ? HUB : Number(v);
    if (id !== HUB && (!Number.isFinite(id) || id <= 0)) { A.toast('A bus number is a positive whole number.'); return; }
    ST.bus = id;
    if (CX) {
      /* a bus the Continuum carries becomes its scope too, so the rail and every
         other screen agree; any other bus (or the hub) stays this screen's own */
      if (id !== HUB && CX.busIds().includes(id)) { CX.ST.scopeKind = 'bus'; CX.ST.scopeKey = id; ST.seen = String(id); }
      save(); CX.store(); CX.paint();
    } else { save(); drawAll(true); }
  }

  function controls() {
    const bar = H('div', 'htl-ctl');
    const demo = demoIds();
    const busOpts = demo.map(id => ({ v: id, l: `${busShort(id)} · #${id}${(busFull(id) || {}).tier === 'geo_proxy' ? ' · proxy' : ''}` }));
    busOpts.push({ v: 'hub', l: 'ISO-NE hub · live server' });
    const cur = ST.bus === HUB ? 'hub' : ST.bus;
    if (ST.bus !== HUB && !demo.includes(Number(ST.bus))) busOpts.unshift({ v: ST.bus, l: `${busShort(ST.bus)} · #${ST.bus} · live server` });
    const other = document.createElement('input'); other.type = 'number'; other.min = '1'; other.step = '1'; other.className = 'htl-num';
    other.placeholder = 'bus #'; other.setAttribute('data-htl-ctl', 'otherbus'); other.setAttribute('aria-label', 'Other bus number');
    other.title = 'Any bus number in the study model — its hours come from the live server';
    const load = H('button', 'gsc-btn', 'Show bus'); load.type = 'button'; load.setAttribute('data-htl-ctl', 'loadbus');
    load.title = 'Read the typed bus number — from the live server unless it is one of the embedded demo buses';
    load.onclick = () => { if (other.value) setBus(other.value); };
    other.onkeydown = e => { if (e.key === 'Enter' && other.value) setBus(other.value); };
    bar.appendChild(field('Bus', select('bus', 'Bus', busOpts, cur, v => setBus(v)), other, load));
    bar.appendChild(field('View', segCtl('View', 'mode', [{ v: 'timeline', l: 'Timeline', t: 'Every hour in date order on one axis' },
      { v: 'overlay', l: 'Same hour of year', t: 'The same month or week of every year on one day axis' }], ST.mode, v => set({ mode: v }))));
    if (ST.mode === 'overlay') {
      bar.appendChild(field('Period', segCtl('Period', 'period', [{ v: 'month', l: 'Month' }, { v: 'week', l: 'Week' }], ST.period, v => set({ period: v })),
        ST.period === 'week'
          ? select('week', 'Week', Array.from({ length: 52 }, (_, i) => { const d = new Date(weekStart(i + 1)); return { v: i + 1, l: `Week ${i + 1} · from ${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }; }), ST.week, v => set({ week: +v }))
          : select('month', 'Month', MONTH_FULL.map((m, i) => ({ v: i + 1, l: m })), ST.month, v => set({ month: +v }))));
    }
    /* S-nav 2026-10-07: the settled market is the Continuum's one Market control (main row) — not repeated here */
    if (!CX) bar.appendChild(field('Market', segCtl('Market', 'market', [{ v: 'DA', l: 'DA', t: 'Settled day-ahead (held from 2021)' }, { v: 'RT', l: 'RT', t: 'Settled real time' }], ST.market, v => set({ market: v }))));
    bar.appendChild(field('Series', segCtl('Series', 'series', SERIES.map(s => ({ v: s[0], l: s[1], t: s[0] === 'lmp' ? 'Embedded offline for the demo buses' : 'From the live server — the embedded file holds the LMP alone' })), ST.series, v => set({ series: v }))));
    const runs = H('div', 'htl-runs'); runs.setAttribute('role', 'group'); runs.setAttribute('aria-label', 'Solved runs');
    runList().forEach(r => {
      const on = ST.runs.includes(r.id);
      const b = H('button', 'gsc-chip htl-run'); b.type = 'button'; b.setAttribute('data-htl-run', r.id);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const sw = H('span', 'htl-sw dash'); sw.style.setProperty('--c', `var(--${RUN_TOK[r.id] || 's8'})`); b.appendChild(sw);
      b.appendChild(H('span', null, runName(r.id, true)));
      b.title = `${r.note || r.label || r.id} — a solved run for ${r.target_year}`;
      b.onclick = () => set({ runs: on ? ST.runs.filter(x => x !== r.id) : ST.runs.concat(r.id) });
      runs.appendChild(b);
    });
    const nh = (META().scenarios || []).filter(s => !s.held);
    if (nh.length) {
      const n = H('span', 'htl-nh', `${nh.map(s => s.label || s.id).join(' · ')}: not held`);
      n.title = nh[0].note || 'not held — a PROBE run with this assumption set is needed';
      runs.appendChild(n);
    }
    bar.appendChild(field('Runs', runs));
    const hub = H('button', 'gsc-btn htl-tg'); hub.type = 'button'; hub.setAttribute('data-htl-ctl', 'hub');
    hub.setAttribute('aria-pressed', ST.hub ? 'true' : 'false'); hub.textContent = 'Hub comparison';
    hub.title = 'Draw the ISO-NE hub on the same axis (live server — the hub\'s hours are not embedded)';
    if (ST.bus === HUB) { hub.disabled = true; hub.title = 'The hub is already the location in view'; }
    hub.onclick = () => set({ hub: !ST.hub });
    bar.appendChild(field('Compare', hub));
    bar.appendChild(field('History from', select('from', 'History from', settledYears().map(y => ({ v: y, l: String(y) })), ST.from, v => set({ from: +v, view: null }))));
    bar.appendChild(field('Y range', segCtl('Y range', 'yrange', [{ v: 'robust', l: ROBUST_L, t: 'Scale to the 0.5th–99.5th percentile of the hours in view; hours beyond it sit on the plot edge and are counted under the chart' }, { v: 'full', l: 'Full', t: 'Scale to every hour in view, spikes included' }], ST.yr, v => set({ yr: v }))));
    const act = H('div', 'htl-f htl-act');
    if (ST.mode === 'timeline') {
      const rs = H('button', 'gsc-btn', 'Reset zoom'); rs.type = 'button'; rs.setAttribute('data-htl-ctl', 'reset');
      rs.title = 'Back to the whole axis'; rs.onclick = () => api.reset();
      act.appendChild(rs);
    }
    const dl = H('button', 'gsc-btn'); dl.type = 'button'; dl.setAttribute('data-htl-ctl', 'download');
    dl.innerHTML = icon('download') + 'Download hours';
    dl.title = 'Download every hour in view, one row per hour and segment, as CSV';
    dl.onclick = () => downloadHours();
    act.appendChild(dl);
    if (API.state === 'offline' || API.state === 'no-route') {
      const rt = H('button', 'gsc-btn', 'Load live hours'); rt.type = 'button'; rt.setAttribute('data-htl-ctl', 'retry');
      rt.title = 'Ask the live server again (start it with Start-Portfolio-Canvas.ps1)'; rt.onclick = () => retryServer();
      act.appendChild(rt);
    }
    bar.appendChild(act);
    return bar;
  }

  let GEO = null;            // the geometry the hover and the drag read
  function mount(body) {
    BODY = body; body.innerHTML = '';
    body.classList.add('htl-body');
    body.appendChild(controls());
    const notice = H('div', 'htl-notice'); notice.setAttribute('data-htl-notice', ''); body.appendChild(notice);
    const box = H('div', 'htl-box'); box.setAttribute('data-htl-box', ''); body.appendChild(box);
    const ov = H('div', 'htl-ovbox'); body.appendChild(ov);
    const lg = H('div', 'htl-lg'); body.appendChild(lg);
    const stats = H('div', 'htl-statsbox'); body.appendChild(stats);
    wire(box, ov);
    drawAll();
  }

  function legend(host, segs) {
    host.innerHTML = '';
    const add = (label, tok, dash, cls, op) => {
      const s = H('span'); const i = H('i', 'htl-sw' + (dash ? ' dash' : '') + (cls ? ' ' + cls : ''));
      if (tok) i.style.setProperty('--c', `var(--${tok})`);
      if (op != null) i.style.opacity = String(op);
      s.appendChild(i); s.appendChild(H('span', null, label)); host.appendChild(s);
    };
    const own = segs.filter(s => s.values && s.kind !== 'hub');
    const st = own.filter(s => s.settled);
    if (ST.mode === 'overlay') {
      st.forEach((s, k) => add(`Settled ${s.year}${s.partial ? ' (partial)' : ''}`, SETTLED_TOK, false, null, st.length <= 1 ? 1 : 0.35 + 0.65 * k / (st.length - 1)));
    } else if (st.length) add(`Settled ${st[0].year}${st.length > 1 ? '–' + st[st.length - 1].year : ''} · solid`, SETTLED_TOK, false);
    own.filter(s => !s.settled).forEach(s => add(`Solved run ${runName(s.scenario, true)} · dashed`, s.tok, true));
    if (segs.some(s => s.kind === 'hub' && s.values)) add('Hub · grey', HUB_TOK, false);
    if (ST.mode === 'timeline') {
      add('No hours held (gap, never bridged)', null, false, 'gap');
      if (segs.some(s => !s.values && s.kind !== 'hub')) add('Held elsewhere / withheld — reason on the hole', null, false, 'hole');
      add('Band = min–max of the hours in each pixel · line = their mean', null, false, 'band');
    }
  }

  function drawAll(rebuildControls) {
    if (!BODY || !BODY.isConnected) return;
    if (rebuildControls) { mount(BODY); return; }
    const t0 = performance.now();
    const box = BODY.querySelector('[data-htl-box]'), ov = BODY.querySelector('.htl-ovbox'), lg = BODY.querySelector('.htl-lg'), stats = BODY.querySelector('.htl-statsbox');
    const notice = BODY.querySelector('[data-htl-notice]');
    const oldCtl = BODY.querySelector('.htl-ctl [data-htl-ctl="retry"]');
    const segs = segments();
    box.querySelectorAll('svg').forEach(n => n.remove());
    ov.innerHTML = '';
    COUNT.draws++;
    let info, sets = null;
    if (ST.mode === 'overlay') {
      const o = drawOverlay(box, segs);
      sets = o.sets;
      info = { mode: 'overlay', plot: o.plot, segments: o.sets.map(x => ({ key: x.seg.key, kind: x.seg.kind, source: x.seg.source, drawn: true, points: x.vals.length })), gaps: [], holes: [], divider: null, view: null, overlay: o };
      GEO = { mode: 'overlay', o, segs };
    } else {
      info = drawTimeline(box, segs, {});
      info.mode = 'timeline';
      const ovi = info.view ? drawOverview(ov, segs, info) : null;
      GEO = { mode: 'timeline', info, segs, ov: ovi };
    }
    legend(lg, segs);
    const rows = statsRows(segs, info, sets);
    stats.innerHTML = '';
    const where = ST.mode === 'overlay' ? periodLabel() : info.view ? `${fmtTs(info.view[0]).slice(0, 10)} to ${fmtTs(info.view[1] - HOUR).slice(0, 10)}` : 'nothing in view';
    stats.appendChild(statsTable(rows, where));
    LAST_STATS = rows;
    const nt = noticeText(segs);
    notice.textContent = nt; notice.classList.toggle('on', !!nt);
    const empty = !segs.some(s => s.values);
    BODY.querySelectorAll('.htl-clip').forEach(n => n.remove());
    let emp = BODY.querySelector('.htl-empty');
    if (emp) emp.remove();
    if (empty) {
      emp = H('div', 'gsc-empty htl-empty');
      emp.appendChild(H('b', null, API.state === 'offline' ? 'Nothing drawn — the live server is offline' : segs.some(s => s.status === 'loading') ? 'Reading the live server…' : 'No hours held at this selection'));
      emp.appendChild(H('p', null, nt || 'Every segment is a labelled hole or gap on the axis above.'));
      box.parentNode.insertBefore(emp, box.nextSibling);
    }
    const clip = ST.mode === 'overlay' ? (info.overlay && info.overlay.beyond) : info.clipped;
    if (clip) { const c = H('div', 'htl-clip'); c.setAttribute('data-htl-clipped', String(clip)); c.textContent = `Y range ${ROBUST_L}: ${fmt.int(clip)} hour${clip === 1 ? '' : 's'} in view lie beyond the scale and sit on the plot edge — Y range · Full draws them at scale.`; box.parentNode.insertBefore(c, box.nextSibling); }
    updateFace(segs);
    /* the Load live hours button appears / goes with the server state */
    const wantRetry = API.state === 'offline' || API.state === 'no-route';
    if (!!oldCtl !== wantRetry) { const ctl = BODY.querySelector('.htl-ctl'); if (ctl) { const n = controls(); ctl.replaceWith(n); } }
    info.drawMs = performance.now() - t0;
    info.api = API.state;
    LAST = info;
  }
  let LAST_STATS = [];

  /* ── interaction: hover (a DOM readout), drag-zoom, the brush ──────────── */
  function wire(box, ovHost) {
    const tip = H('div', 'htl-tip'); tip.setAttribute('data-htl-tip', ''); box.appendChild(tip);
    const cross = H('div', 'htl-cross'); box.appendChild(cross);
    const sel = H('div', 'htl-selr'); box.appendChild(sel);
    let drag = null, raf = null, lastEv = null;
    const hide = () => { tip.classList.remove('on'); cross.classList.remove('on'); };
    const rectOf = () => { const s = box.querySelector('svg'); return s ? s.getBoundingClientRect() : box.getBoundingClientRect(); };
    function hover(ev) {
      if (!GEO) return;
      const r = rectOf(), mx = ev.clientX - r.left, my = ev.clientY - r.top;
      const P = GEO.mode === 'overlay' ? GEO.o.plot : GEO.info.plot;
      if (mx < P.x0 - 2 || mx > P.x1 + 2 || my < P.y0 - 4 || my > P.y1 + 4) { hide(); return; }
      let lines = [], cx = mx, ds = { seg: '', ts: '', i: '', v: '', n: '0' };
      if (GEO.mode === 'overlay') {
        const o = GEO.o, k = Math.max(0, Math.min(o.L - 1, Math.round((mx - o.plot.x0) / o.kx)));
        cx = o.X(k);
        const day = Math.floor(k / 24), hh = k % 24;
        let head;
        if (ST.period === 'week') { const d = new Date(weekStart(ST.week) + k * HOUR); head = `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${pad2(hh)}:00 (HE ${hh + 1}) · every year`; }
        else head = `${day + 1} ${MON[ST.month - 1]} ${pad2(hh)}:00 (HE ${hh + 1}) · every year`;
        lines.push(head);
        let n = 0;
        o.sets.forEach(x => { const v = x.vals[k]; if (v != null) n++; lines.push(`${x.seg.settled ? 'Settled ' + x.seg.year : 'Solved run ' + runName(x.seg.scenario, true)} · ${money(v)}`); });
        ds = { seg: '', ts: head, i: String(k), v: '', n: String(n) };
      } else {
        const info = GEO.info, t = info.view[0] + (mx - info.plot.x0) / info.g.k;
        const hits = GEO.segs.filter(s => s.values && t >= s.base - HOUR / 2 && t < Y0(s.year + 1) - HOUR / 2);
        const own = hits.filter(s => s.kind !== 'hub');
        if (own.length) {
          const p = own[0], i = iAt(p, t);
          if (i < 0) {
            lines.push(`${fmtTs(p.base + p.s * HOUR).slice(0, 10)} 02:00 — the spring-forward hour does not exist on the local clock; no settled label, no value`);
            cx = info.X(p.base + p.s * HOUR); ds = { seg: p.key, ts: '', i: '-1', v: '', n: '0' };
          } else {
            const tt = tI(p, Math.max(0, Math.min(p.values.length - 1, i)));
            cx = info.X(tt);
            const hh = new Date(tt).getUTCHours();
            lines.push(`${fmtLong(tt)} (HE ${hh + 1})${p.settled ? ' · local label, EPT (inferred)' : ' · flat run calendar'}`);
            let n = 0, v0 = null;
            hits.forEach((s, q) => {
              const j = iAt(s, tt); const v = j >= 0 && j < s.values.length ? s.values[j] : null;
              if (q === 0) v0 = v;
              if (v != null) n++;
              lines.push(`${s.label} · ${mktWord(s)} · ${money(v)}${v == null ? ' — absent hour' : '/MWh'} · ${srcWord(s.source)}`);
            });
            ds = { seg: p.key, ts: fmtTs(tt), i: String(i), v: v0 == null ? '' : String(v0), n: String(n) };
          }
        } else {
          const gp = info.gaps.concat(info.holes).find(x => t >= x.t0 && t < x.t1);
          lines.push(gp ? `${gp.label} — ${info.holes.includes(gp) ? 'not drawn' : 'a gap, never bridged'}` : `${fmtLong(Math.round(t / HOUR) * HOUR)} · no segment here`);
        }
      }
      tip.innerHTML = '';
      lines.forEach((l, q) => { const d = H('div', q === 0 ? 'h' : null, l); tip.appendChild(d); });
      Object.keys(ds).forEach(k => { tip.dataset[k] = ds[k]; });
      const bw = box.clientWidth;
      tip.classList.add('on');
      const tw = tip.offsetWidth || 260;
      tip.style.left = Math.max(2, Math.min(bw - tw - 2, cx + 14 > bw - tw ? cx - tw - 12 : cx + 14)) + 'px';
      tip.style.top = Math.max(2, Math.min(P.y1 - 20, my - 30)) + 'px';
      cross.style.left = cx + 'px'; cross.style.top = P.y0 + 'px'; cross.style.height = (P.y1 - P.y0) + 'px';
      cross.classList.add('on');
    }
    box.addEventListener('mousemove', ev => {
      if (drag) {
        const r = rectOf(), P = GEO.info.plot, x = Math.max(P.x0, Math.min(P.x1, ev.clientX - r.left));
        drag.x1 = x;
        sel.style.left = Math.min(drag.x0, x) + 'px'; sel.style.width = Math.abs(x - drag.x0) + 'px';
        sel.style.top = P.y0 + 'px'; sel.style.height = (P.y1 - P.y0) + 'px'; sel.classList.add('on');
        hide(); return;
      }
      lastEv = ev;
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = null; if (lastEv) hover(lastEv); });
    });
    box.addEventListener('mouseleave', () => { lastEv = null; hide(); });
    box.addEventListener('mousedown', ev => {
      if (!GEO || GEO.mode !== 'timeline' || ev.button !== 0) return;
      const r = rectOf(), P = GEO.info.plot, x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (x < P.x0 || x > P.x1 || y < P.y0 || y > P.y1) return;
      drag = { x0: x, x1: x }; ev.preventDefault();
    });
    const endMain = () => {
      if (!drag) return;
      const d = drag; drag = null; sel.classList.remove('on');
      if (Math.abs(d.x1 - d.x0) < 5 || !GEO || GEO.mode !== 'timeline') return;
      const info = GEO.info, a = Math.min(d.x0, d.x1), b = Math.max(d.x0, d.x1);
      api.zoom(info.view[0] + (a - info.plot.x0) / info.g.k, info.view[0] + (b - info.plot.x0) / info.g.k);
    };
    box.addEventListener('dblclick', () => { if (GEO && GEO.mode === 'timeline') api.reset(); });
    /* the overview: drag to choose a window, click to centre the current one */
    let od = null;
    ovHost.addEventListener('mousedown', ev => {
      const s = ovHost.querySelector('svg');
      if (!GEO || !GEO.ov || !s) return;
      const r = s.getBoundingClientRect(); od = { x0: ev.clientX - r.left, x1: ev.clientX - r.left, r }; ev.preventDefault();
    });
    ovHost.addEventListener('mousemove', ev => { if (od) od.x1 = ev.clientX - od.r.left; });
    const endOv = () => {
      if (!od || !GEO || !GEO.ov) { od = null; return; }
      const o = GEO.ov, d = od; od = null;
      const tOf = x => o.domain[0] + (Math.max(o.g.x0, Math.min(o.g.x1, x)) - o.g.x0) / o.g.k;
      if (Math.abs(d.x1 - d.x0) >= 4) api.zoom(tOf(Math.min(d.x0, d.x1)), tOf(Math.max(d.x0, d.x1)));
      else { const v = GEO.info.view, half = (v[1] - v[0]) / 2, c = tOf(d.x0); api.zoom(c - half, c + half); }
    };
    UP = () => { endMain(); endOv(); };
  }

  /* ── the CSV of every hour in view ─────────────────────────────────────── */
  function downloadHours() {
    const segs = segments().filter(s => s.values);
    const lines = ['timestamp_local_label,segment,kind,source,market,series,value_usd_per_mwh'];
    const sName = ST.series;
    if (ST.mode === 'overlay') {
      overlaySets(segs).forEach(x => x.vals.forEach((v, k) => { if (v != null) lines.push(`${ST.period === 'week' ? 'week ' + ST.week : MON[ST.month - 1]} +${k}h,"${x.seg.label}",${x.seg.kind},${srcWord(x.seg.source)},${mktWord(x.seg)},${sName},${v}`); }));
    } else {
      const v = LAST && LAST.view ? LAST.view : [-Infinity, Infinity];
      segs.forEach(s => { const r = inView(s, v[0], v[1]); for (let i = r[0]; i <= r[1]; i++) { const x = s.values[i]; if (x != null) lines.push(`${fmtTs(tI(s, i))},"${s.label}",${s.kind},${srcWord(s.source)},${mktWord(s)},${sName},${x}`); } });
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `lmp-continuum-hourly-${ST.bus === HUB ? 'hub' : ST.bus}-${ST.mode}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    A.toast(`${fmt.int(lines.length - 1)} hours downloaded — exactly the hours in view, as held.`);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     The Continuum screen and its hook
     ═══════════════════════════════════════════════════════════════════════ */
  const HONESTY = 'A <b>solved run</b> is one modelled outcome of its PROBE / PCR assumption set, drawn dashed at its own study year — not a forecast of what will settle, and not a continuation of the settled line. ' +
    'Settled years count local hour labels: <b>8,759</b> in a common year, because the spring-forward 02:00 does not exist and the autumn 01:00 is one averaged label (8,783 in a leap year). ' +
    'A solved run models a flat <b>8,760</b> (8,784 leap) with no daylight saving, so it holds one hour the settled calendar does not. Every hour sits at its own date on the axis. ' +
    'Years no run holds are hatched gaps and no line crosses them; a year the offline file withheld is a labelled hole until the live server fills it. ' +
    'Beyond 1.5 hours per pixel the band is the min–max of the hours behind each pixel and the line their mean, so a spike is never averaged away; drag on the chart to zoom to single hours.';
  function build(host, cx) {
    CX = cx;
    /* S-nav 2026-10-07: the settled market follows the Continuum's Market (DA / RT) */
    if (cx.ST && (cx.ST.market === 'DA' || cx.ST.market === 'RT') && ST.market !== cx.ST.market) { ST.market = cx.ST.market; save(); }
    const sc = cx.scope();
    /* continuum fix 2026-10-06 (D5): a zone scope never shows another scope's bus here — the hourly route
       reads one bus or the hub, and no zone hourly series is held */
    if (sc.kind === 'zone') {
      const p = cx.panel({ id: 'htl', wide: true, title: `${SCREEN_L} · ${sc.key} zone`,
        draw: body => body.appendChild(cx.emptyBox('Bus-level only — pick a bus',
          `${sc.key} zone is in scope. This screen draws one bus, or ISO-NE Hub (${HUB}), hour by hour from 2020 to 2040; no zone hourly series is held. Pick a bus or the hub in the scope picker.`)) });
      p.setAttribute('data-gsc-busonly', SCREEN_K);
      host.appendChild(p);
      return;
    }
    if (sc.kind === 'bus') {
      const tag = String(sc.key);
      if (tag !== ST.seen) { ST.seen = tag; ST.bus = Number(sc.key); save(); }
    } else if (sc.kind === 'hub' && ST.seen !== 'hub') { ST.seen = 'hub'; ST.bus = HUB; ST.hub = false; save(); }
    if (ST.bus == null || (ST.bus !== HUB && !Number.isFinite(Number(ST.bus)))) {
      const pref = cx.preferredBus ? cx.preferredBus() : null;
      ST.bus = pref != null && isDemo(pref) ? pref : (demoIds()[0] != null ? demoIds()[0] : HUB); save();
    }
    FACE = H('div', 'gsc-face htl-face');
    const p = cx.panel({
      id: 'htl', wide: true, title: `${SCREEN_L} · ${busShort(ST.bus)}`,
      sig: cx.sig ? cx.sig('lmp', 'hourly · span control (window or 2020–2040)', 'settled + solved') : null,   // S-nav 2026-10-07: the Hourly page's 2020 → 2040 span
      face: FACE, faceText: `ISO-NE | ${busName(ST.bus)} | hourly ${ST.series} | settled ${ST.market} + solved runs ${ST.runs.join('+')}`,
      csv: true,
      table: () => ({ cols: STAT_COLS, rows: LAST_STATS.map(statCells), why: 'No segment holds hours in view.' }),
      note: HONESTY,
      draw: body => mount(body),
    });
    host.appendChild(p);
  }
  function attach(cx) {
    const S = cx.SCREENS;
    if (!S.some(s => s.k === SCREEN_K)) {
      let at = S.findIndex(s => s.k === 'hourly');
      if (at < 0) at = S.findIndex(s => s.k === 'surface');
      const ex = S.findIndex(s => s.k === 'export');
      S.splice(at >= 0 ? at + 1 : (ex >= 0 ? ex : S.length), 0, { k: SCREEN_K, label: SCREEN_L });
    }
    cx.BUILD[SCREEN_K] = host => build(host, cx);
    CX = cx;
    /* S-nav 2026-10-07: the Continuum's page row comes from its registry (this view is the Hourly page's
       "2020 → 2040" span), so no button is inserted here */
  }
  (window.GSCathyScreens = window.GSCathyScreens || []).push({ k: SCREEN_K, attach });

  /** open the Continuum on this screen at a bus */
  function open(bus) {
    const cat = window.GSCathy;
    if (!cat) { A.toast('The LMP Continuum is not loaded in this build, so the hourly timeline has nowhere to open.'); return false; }
    if (bus != null) {
      const id = bus === HUB ? HUB : Number(bus);
      ST.bus = id; ST.view = null;
      const known = id !== HUB && ((DATA() && ((DATA().bus_annual || {})[String(id)] || (DATA().bus_full || {})[String(id)])));
      if (known) { cat.state.scopeKind = 'bus'; cat.state.scopeKey = id; ST.seen = String(id); }
      save();
    }
    cat.state.screen = SCREEN_K;
    if (cat.on) cat.paint(); else cat.open();
    return true;
  }
  /* the Tree and any card: a request naming the timeline lands here */
  document.addEventListener('cathy:open', ev => {
    const det = (ev && ev.detail) || {};
    const words = [det.template, det.dataset, det.block, det.id, det.screen].filter(Boolean).map(String).join(' ');
    if (!(/hourly[ _-]?timeline|history[ _-]?\+?[ _-]?forecast/i.test(words) || det.cardId === '5.41' || det.screen === SCREEN_K)) return;
    const bus = det.bus != null ? det.bus : (Array.isArray(det.pins) && det.pins.length ? det.pins[0] : null);
    setTimeout(() => open(bus), 0);
  });

  /* ═══════════════════════════════════════════════════════════════════════
     The Prices-stage card 5.41
     ═══════════════════════════════════════════════════════════════════════ */
  function cardSegments(bus) {
    const keep = { bus: ST.bus, market: ST.market, series: ST.series, runs: ST.runs, hub: ST.hub, from: ST.from };
    Object.assign(ST, { bus, market: 'RT', series: 'lmp', hub: false, from: settledYears()[0], runs: runList().map(r => r.id).filter(id => DEF.runs.includes(id)) });
    NO_FETCH = true;
    try { return segments().filter(s => s.source === 'embedded'); }
    finally { Object.assign(ST, keep); NO_FETCH = false; }
  }
  const meanOf = a => { let s = 0, n = 0; for (const v of a) if (v != null) { s += v; n++; } return n ? { mean: s / n, n } : null; };
  function registerCard() {
    const W = window.W, GSX = window.GSX || {};
    if (!W || !W.defs) return;
    const reg = GSX.reg || (def => { if (W.defs.has(def.id)) { console.warn('ext 61: block id ' + def.id + ' is already registered — the hourly timeline card was not added'); return; } W.register(def); });
    if (window.GSX_HEADINGS && !window.GSX_HEADINGS['5.41']) window.GSX_HEADINGS['5.41'] = 'Hourly history + forecast';
    reg({ id: '5.41', code: 'PX-41', concern: 'prices', tier: 'P1', form: 'LINE', span: 12, feature: 'econ', fuels: 'all', depths: ['screen'], minDepth: 'screen',
      question: 'How do this bus\'s settled hours run into the solved runs, hour by hour?',
      title: 'Hourly history + forecast — settled hours and the solved runs on one time axis',
      tables: ['GS_DATA_EXT.cathy.bus_full', '/api/v2/prices/hours'],
      answer(c) {
        const basisOf = (src, year) => (GSX.basis ? GSX.basis : (o => Object.assign({ study: 'Canvas data extension', vintage: 'not stated', year: '—', source: 'GS_DATA_EXT' }, o)))({
          study: 'Settled hourly record + PROBE / PCR solved runs', size: 'a node price — not read at a size', year, source: src });
        if (!DATA()) return GSX.noExt ? GSX.noExt('the hourly record') : { state: 'unsupported', emptyTitle: 'The cathy block is not loaded', recalc: 'unavailable', next: 'request evidence' };
        if (!c.node) return GSX.noScope ? GSX.noScope() : { state: 'unsupported', emptyTitle: 'No connection point in scope', next: 'select', recalc: 'unavailable' };
        const bus = c.node.bus_id;
        if (!isDemo(bus)) {
          return {
            state: 'empty', emptyTitle: 'No embedded hourly record at this bus',
            searched: `the hourly record embedded for ${demoIds().length} demo buses — bus ${bus} is not one; the Hourly · history + forecast screen reads it from the live server`,
            coverage: { present: 0, required: 1, absent: [`hourly rows for bus ${bus} in the offline file`] },
            notes: ['The timeline in the LMP Continuum reads this bus from the live server (GET /api/v2/prices/hours on 127.0.0.1:5034) and says so on every segment; offline it draws nothing rather than a stand-in.'],
            basis: basisOf('GET /api/v2/prices/hours (GridSense server)', '2020–2040'), recalc: 'unavailable', next: 'request evidence',
          };
        }
        const segs = cardSegments(bus);
        const settled = segs.filter(s => s.settled), solved = segs.filter(s => !s.settled);
        const full = settled.filter(s => !s.partial);
        const lastFull = full[full.length - 1] || settled[settled.length - 1];
        const lm = lastFull ? meanOf(lastFull.values) : null;
        const runMeans = solved.map(s => ({ s, m: meanOf(s.values) })).filter(x => x.m);
        const b = busFull(bus) || {};
        const principal = (lm ? `Settled ${lastFull.year} real-time mean ${fmt.money(lm.mean, 2)}/MWh over ${fmt.int(lm.n)} h` : 'No settled hours embedded')
          + (runMeans.length ? (() => { const ms = runMeans.map(x => x.m.mean), ys = runMeans.map(x => x.s.year);
            return `; solved-run means ${fmt.money(Math.min(...ms), 2)} to ${fmt.money(Math.max(...ms), 2)}/MWh, ${Math.min(...ys)}–${Math.max(...ys)}.`; })() : '.');
        const rows = settled.concat(solved).map(s => Object.assign({ seg: s }, statOf(s.values)));
        return {
          state: 'answered', principal,
          render: w => {
            const d = H('div', 'htl-card');
            const box = H('div', 'htl-cardbox'); d.appendChild(box);
            const keep = { bus: ST.bus, market: ST.market, series: ST.series, runs: ST.runs, hub: ST.hub, from: ST.from, view: ST.view };
            Object.assign(ST, { bus, market: 'RT', series: 'lmp', hub: false, from: settledYears()[0], runs: DEF.runs.slice(), view: null });
            NO_FETCH = true;
            try { drawTimeline(box, segments().filter(s => s.source === 'embedded' || !s.values), { compact: true, width: Math.max(300, Math.min(1400, (w || 600) - 4)) }); }
            finally { Object.assign(ST, keep); NO_FETCH = false; }
            const foot = H('div', 'htl-cardfoot');
            const lg = H('span', 'htl-cardlg');
            lg.innerHTML = `<i class="htl-sw" style="--c:var(--${SETTLED_TOK})"></i>settled (RT) <i class="htl-sw dash" style="--c:var(--${RUN_TOK.pcr2030})"></i>solved runs, each at its study year · hatched = no hours held`;
            foot.appendChild(lg);
            const btn = H('button', 'btn sm htl-open'); btn.type = 'button'; btn.setAttribute('data-htl-open', String(bus));
            btn.innerHTML = icon('clock') + 'Open hourly timeline';
            btn.title = 'Open in LMP Continuum — the hourly timeline at this bus, with zoom, hover, the overlay and the stats';
            btn.onclick = e => { e.stopPropagation(); open(bus); };
            foot.appendChild(btn);
            d.appendChild(foot);
            return d;
          },
          table: { cols: STAT_COLS.map((x, i) => ({ k: 'c' + i, l: x.l })), rows: rows.map(r => { const cells = statCells(r); const o = {}; cells.forEach((v, i) => { o['c' + i] = v; }); return o; }) },
          caption: 'Every settled hour at this bus (solid) and each solved run at its own study year (dashed) on one time axis; hatched stretches are years no run holds and no line crosses them. The band is the min–max of the hours in each pixel.',
          badges: [{ kind: b.tier === 'geo_proxy' ? 'warn' : '', text: b.tier === 'geo_proxy' ? `settled via ${b.price_node} · ${fmt.num(+b.distance_mi, 2)} mi` : `settled node ${b.price_node || 'not stated'}`, title: b.proxy_note || 'The settled record is read at this node; the solved runs are keyed by the bus itself.' },
            { kind: 'model', text: 'solved runs · modelled', title: 'A solved run is one modelled outcome of its assumption set, not a forecast of what will settle.' }],
          notes: [
            'Settled years count local hour labels (8,759 in a common year); a solved run is a flat 8,760 with no daylight saving. Each hour is placed at its own date.',
            `The solved runs are PROBE 5-year 2028, PCR 2030, PCR 2035 and PCR 2040 (${runName('pcr2040', false).replace(/^PCR 2040 · /, '') || 'as stored'}); PROBE 10-year 2035 is one click away on the timeline.`,
            'Components (energy, congestion, loss), the hub and other buses come from the live server on the timeline screen.',
          ],
          basis: basisOf(`GS_DATA_EXT.cathy.bus_full["${bus}"].hourly`, `${settled.length ? settled[0].year : '—'}–${solved.length ? solved[solved.length - 1].year : '—'}`),
          coverage: { present: settled.length + solved.length, required: settled.length + solved.length, absent: [] },
          recalc: 'fixed', next: 'compare',
        };
      } });
  }
  registerCard();

  /* ── the test surface ──────────────────────────────────────────────────── */
  const api = window.GSHourlyTimeline = {
    state: ST, open, attach,
    get api() { return API.state; },
    get draws() { return COUNT.draws; },
    get last() { return LAST; },
    refresh() { if (BODY && BODY.isConnected) mount(BODY); else if (window.GSCathy && GSCathy.on && GSCathy.state.screen === SCREEN_K) GSCathy.paint(); },
    invalidate() { CACHE.forEach(c => { c.arr = null; }); },
    zoom(t0, t1) { ST.view = [Math.min(t0, t1), Math.max(t0, t1)]; save(); drawAll(); },
    zoomYear(y) { api.zoom(Y0(y), Y0(y + 1)); },
    reset() { ST.view = null; save(); drawAll(); },
    setBus(id) { ST.bus = id === HUB ? HUB : Number(id); save(); },
    tOf(key, i) {
      const r = runOf(key);
      const seg = key.startsWith('hist:') ? shape(key, 'settled', +key.slice(5)) : shape(key, 'solved', r ? r.target_year : 0);
      return tI(seg, i);
    },
    xOfT(t) { return LAST && LAST.X ? LAST.X(t) : null; },
  };
})();
