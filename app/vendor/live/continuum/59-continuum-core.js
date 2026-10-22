/* VENDORED from live Studio ext/59-continuum-core.js (snapshot 2026-10-11, sha256 98bc8436799623a5).
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/continuum/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   ext: 59-continuum-core.js — the LMP Continuum's foundations (continuum S0 2026-10-06).

   Dossier: design/10-build-slices.md S0 · 04-architecture §Scenarios · D-001 (six workflow screens, no feature
   dropped) · D-002 (proxy scenarios) · D-009 (API-first). Loads before ext/60 (name order) and owns nothing on
   screen: ext/60 draws, this module answers.

   window.GSContinuum
     api        the :5034 client — /api/v2/scenarios*, /api/v2/continuum/*. Base URL window.GSX_CONTINUUM_API or
                http://127.0.0.1:5034. Every call resolves (never throws) to
                  {ok, state, status, body, why, field, url}
                state: ok · bad-request (400, `field` names it) · not-found (404 with a JSON error — "nothing held
                here") · no-route (404 without one: the server has not mounted the route; restart it) ·
                server-error ("Live server erroring — HTTP <n>") · offline (no answer after 3 tries with backoff;
                the verdict expires after 30 s and the server is asked again — the D8 rule).
     live       S-nav 2026-10-07: the ONE live connection (connect · resume · allowed) that replaced five "Load …" buttons
     leadScreen the workflow screen an asset opens on (solar/wind/BESS/hybrid → Shape, data centre → Offtake)
     sig()      a chart's signature for the duplicate-chart audit: measure|period|market
     views() / workflow() / register()
                the screen registry: the 13 views the Continuum carries today, each tagged with the workflow screen
                it moves to (Outlook · Drivers · Shape · Value · Offtake · Assumptions; Export is the header action
                on every screen). New panels register here with a screen tag; the tab bar is unchanged until the
                consolidation slice.
     scen       the scenario store: the registry read from GET /api/v2/scenarios (factors are never typed in the
                page), and the ONE rule every panel scales through — adjust():
                  settled history is never scaled; a proxy scales a value only where its run is the Base run for
                  that year (the price basis plan the server publishes, with the Cape 2028 rule read through
                  GS.priceBasisNote); anything else is drawn as solved and says why.
     bind(), state()
                ext/60's one state object `ST` is bound here; state() is the snapshot every panel reads:
                {scope, asset, market, runs, scenario, year, screen, workflow}.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  /* ── the :5034 client ──────────────────────────────────────────────────── */
  const API_DEFAULT = 'http://127.0.0.1:5034';
  const apiBase = () => String(root.GSX_CONTINUUM_API || API_DEFAULT).replace(/\/+$/, '');
  const TRIES = 3, BACKOFF_MS = 300, TIMEOUT_MS = 30000, OFFLINE_TTL_MS = 30000, OK_TTL_MS = 10 * 60 * 1000;
  const HEALTH = { state: 'unknown', at: 0, why: '' };
  const CACHE = new Map();      // url -> {at, res}: answers only, never failures
  const INFLIGHT = new Map();   // url -> promise: one request per url at a time
  const hostWord = () => apiBase().replace(/^https?:\/\//, '');

  function result(state, extra) {
    return Object.assign({ ok: state === 'ok', state, status: null, body: null, why: '', field: null, url: null }, extra || {});
  }
  function query(params) {
    const q = new URLSearchParams();
    Object.keys(params || {}).sort().forEach(k => {
      const v = params[k];
      if (v == null || v === '') return;
      q.append(k, String(v));
    });
    return q.toString();
  }
  async function once(url, timeoutMs) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const r = await root.fetch(url, { mode: 'cors', credentials: 'omit', signal: ctl ? ctl.signal : undefined });
      let body = null;
      try { const txt = await r.text(); body = txt ? JSON.parse(txt) : null; } catch (e) { body = null; }
      return { r, body };
    } finally { if (t) clearTimeout(t); }
  }
  /** GET one route. Answers are cached for ten minutes; a failure is never cached, except the offline verdict,
   *  which stands for 30 s so a dead server is not asked once per panel. `opt.fresh` skips both. */
  async function get(path, params, opt) {
    const o = opt || {};
    const qs = query(params);
    const url = apiBase() + path + (qs ? '?' + qs : '');
    const hit = CACHE.get(url);
    if (hit && !o.fresh && Date.now() - hit.at < OK_TTL_MS) return hit.res;
    if (!o.fresh && HEALTH.state === 'offline' && Date.now() - HEALTH.at < OFFLINE_TTL_MS) return result('offline', { why: HEALTH.why, url });
    if (INFLIGHT.has(url)) return INFLIGHT.get(url);
    const p = (async () => {
      for (let i = 1; i <= TRIES; i++) {
        try {
          const { r, body } = await once(url, o.timeoutMs || TIMEOUT_MS);
          HEALTH.state = 'online'; HEALTH.at = Date.now(); HEALTH.why = '';
          if (r.ok) { const res = result('ok', { status: r.status, body, url }); CACHE.set(url, { at: Date.now(), res }); return res; }
          const err = body && typeof body === 'object' && body.error ? String(body.error) : null;
          if (r.status === 404 && !err) return result('no-route', { status: 404, url,
            why: `the live server (${hostWord()}) answers but does not carry ${path} — restart it so the route is mounted` });
          if (r.status === 404) return result('not-found', { status: 404, body, why: err, url });
          if (r.status === 400) return result('bad-request', { status: 400, body, why: err || 'the server refused the request', field: (body && body.field) || null, url });
          return result('server-error', { status: r.status, body, why: `Live server erroring — HTTP ${r.status}`, detail: err, url });
        } catch (e) {
          if (i < TRIES) { await new Promise(res => setTimeout(res, BACKOFF_MS * Math.pow(2, i - 1))); continue; }
          HEALTH.state = 'offline'; HEALTH.at = Date.now(); HEALTH.why = `Live server offline — ${hostWord()} did not answer`;
          return result('offline', { why: HEALTH.why, url });
        }
      }
      return result('offline', { why: HEALTH.why, url });
    })();
    INFLIGHT.set(url, p);
    try { return await p; } finally { INFLIGHT.delete(url); }
  }
  /** a missing required parameter is refused here, before any request, naming the field as the API would */
  const need = (p, field, why) => (p && p[field] != null && p[field] !== '') ? null : result('bad-request', { why, field });
  /** the parameters a route takes; `scenario=base` is the route's own answer, so it is not sent */
  function pick(p, keys) {
    const o = {};
    keys.forEach(k => { if (p && p[k] != null && p[k] !== '' && !(k === 'scenario' && p[k] === 'base')) o[k] = p[k]; });
    return o;
  }
  const BUS_WHY = 'bus is required: a bus number, or HUB or a load zone';
  const api = {
    get, base: apiBase,
    health: () => Object.assign({}, HEALTH),
    reset() { CACHE.clear(); INFLIGHT.clear(); HEALTH.state = 'unknown'; HEALTH.at = 0; HEALTH.why = ''; },
    scenarios: o => get('/api/v2/scenarios', {}, o),
    async scenariosAnnual(p, o) {
      return need(p, 'bus', 'bus is required: a bus number') ||
        get('/api/v2/scenarios/annual', { bus: p.bus, measure: p.measure || 'lmp', market: p.market || 'RT' }, o);
    },
    status: o => get('/api/v2/continuum/status', {}, o),
    async priceVsGeneration(p, o) {
      return need(p, 'bus', BUS_WHY) || need(p, 'source', 'source is required: settled:<year> or a run id') ||
        get('/api/v2/continuum/price-vs-generation', pick(p, ['bus', 'source', 'market', 'fuel', 'clock', 'shape', 'scenario']), o);
    },
    async capture(p, o) { return need(p, 'bus', BUS_WHY) || get('/api/v2/continuum/capture', pick(p, ['bus', 'fuel', 'market', 'scenario']), o); },
    async congestion(p, o) {
      return need(p, 'bus', BUS_WHY) ||
        get('/api/v2/continuum/congestion-by-constraint', pick(p, ['bus', 'periods', 'top', 'min_hours', 'method', 'scenario']), o);
    },
    async basis(p, o) { return need(p, 'bus', BUS_WHY) || get('/api/v2/continuum/basis', pick(p, ['bus', 'periods', 'scenario']), o); },
  };

  /* ── the screen registry ───────────────────────────────────────────────── */
  /** The six workflow screens (D-001). `planned` names the panels later slices add — shown as a written empty
   *  state on a hosted screen, never as a placeholder chart. `slice` is for the build log, not the reader. */
  const WORKFLOW = [
    { k: 'outlook', label: 'Outlook', question: 'What is the long-term price here?', planned: [] },
    { k: 'drivers', label: 'Drivers', question: 'Why is the price here different?',
      planned: [{ panel: 'Congestion by constraint', slice: 'S4' }, { panel: 'Basis by year', slice: 'S4' }] },
    { k: 'shape', label: 'Shape', question: 'When does the plant make money?',
      planned: [{ panel: 'Price vs generation', slice: 'S1' }, { panel: 'Capture by year', slice: 'S2' }] },
    { k: 'value', label: 'Value', question: 'Is it profitable, net of cost, by scenario?',
      planned: [{ panel: 'Profit over time', slice: 'S5' }, { panel: 'Profit by scenario', slice: 'S10' },
        { panel: 'Net value ranking', slice: 'S6' }, { panel: 'Measured reserves', slice: 'S5' }] },
    { k: 'offtake', label: 'Offtake', question: 'Basis, PPA and load risk',
      planned: [{ panel: 'Basis fan', slice: 'S8' }, { panel: 'PPA settlement', slice: 'S8' },
        { panel: 'Load cost', slice: 'S8' }, { panel: 'Carbon and 24×7 match', slice: 'S9' }] },
    { k: 'assumptions', label: 'Assumptions', question: 'What is behind every number?',
      planned: [{ panel: 'Run assumptions', slice: 'S3' }, { panel: 'Vintage log', slice: 'S12' }] },
  ];
  /** The 13 views the Continuum carries today — none dropped (D-001). `scenario` is how a proxy reaches the view:
   *  applied (values scaled through scen.adjust), unchanged (applied, and the measure is invariant under a
   *  positive factor), not-applied (with the reason the panel prints), inherit (Export lists another view). */
  const VIEWS = [
    { k: 'explorer', label: 'Price explorer', screen: 'outlook', module: 'ext/60', scenario: 'applied' },
    { k: 'year-analysis', label: 'Year analysis', screen: 'outlook', module: 'ext/86', scenario: 'applied' },
    { k: 'surface', label: 'Hourly surface', screen: 'shape', module: 'ext/60', scenario: 'applied' },
    { k: 'hourly', label: 'Hourly explorer', screen: 'shape', module: 'ext/85', scenario: 'applied' },
    { k: 'timeline', label: 'Hourly · history + forecast', screen: 'shape', module: 'ext/61', scenario: 'applied' },
    { k: 'duration', label: 'Duration curve', screen: 'shape', module: 'ext/60', scenario: 'applied' },
    { k: 'makeup', label: 'Price components', screen: 'drivers', module: 'ext/60', scenario: 'applied' },
    { k: 'spreads', label: 'Spreads', screen: 'shape', module: 'ext/60', scenario: 'applied' },
    { k: 'negative', label: 'Negative hours', screen: 'shape', module: 'ext/60', scenario: 'unchanged',
      why: 'a proxy multiplies every price by one positive factor, so the hours at or below $0 are the same hours as Base' },
    { k: 'generation', label: 'Generation outlook', screen: 'assumptions', module: 'ext/60', scenario: 'not-applied',
      why: 'a proxy scales prices only; the generation outlook is the solved fleet' },
    { k: 'capacity', label: 'Capacity & gas', screen: 'assumptions', module: 'ext/60', scenario: 'not-applied',
      why: 'a proxy scales prices only; capacity prices and the gas path are the published run inputs' },
    { k: 'nodecc', label: 'Constraints & curtailment', screen: 'drivers', module: 'ext/67', scenario: 'not-applied',
      why: 'binding constraints and curtailment are read as the runs solved them; a proxy is a price factor, not a re-solved run' },
    { k: 'export', label: 'Export', screen: null, action: 'Export view', module: 'ext/60', scenario: 'inherit' },
  ];
  const EXTRA = [];             // views registered by later slices: {k, label, screen, module, scenario, why, build}
  const allViews = () => VIEWS.concat(EXTRA);
  const viewOf = k => allViews().find(v => v.k === k) || null;
  const wfOf = k => WORKFLOW.find(w => w.k === k) || null;
  /** a new panel joins a workflow screen. It is hosted on that screen only; no tab is added (S7 regroups). */
  function register(v) {
    if (!v || typeof v.k !== 'string' || !/^[a-z][a-z0-9-]*$/.test(v.k)) throw new Error('register: k must be a lower-case key');
    if (VIEWS.some(x => x.k === v.k)) throw new Error(`register: ${v.k} is one of the 13 views already`);
    if (!wfOf(v.screen)) throw new Error(`register: screen must be one of ${WORKFLOW.map(w => w.k).join(', ')}`);
    if (typeof v.build !== 'function') throw new Error('register: build(host, cx) is required');
    const e = Object.assign({ module: 'registered', scenario: 'not-applied', why: 'this panel has not declared how a scenario reaches it' }, v);
    const i = EXTRA.findIndex(x => x.k === v.k);
    if (i >= 0) EXTRA[i] = e; else EXTRA.push(e);
    if (Array.isArray(v.replaces)) WORKFLOW.forEach(w => { w.planned = w.planned.filter(p => !v.replaces.includes(p.panel)); });   // slice S5: a built panel retires the planned entry it fulfils (S-nav: on any screen — a panel can move home)
    emit('registry', e);
    return e;
  }

  /* ── events ────────────────────────────────────────────────────────────── */
  const LISTEN = {};
  function on(name, fn) { (LISTEN[name] = LISTEN[name] || []).push(fn); return () => { LISTEN[name] = (LISTEN[name] || []).filter(f => f !== fn); }; }
  function emit(name, payload) {
    (LISTEN[name] || []).slice().forEach(fn => { try { fn(payload); } catch (e) { console.warn('[continuum] ' + name + ' listener: ' + ((e && e.message) || e)); } });
  }

  /* ── the scenario store ────────────────────────────────────────────────── */
  const OK_FLAG = 'gs.continuum.scen.ok';   // this browser has read the registry before: restore it on open
  const SCEN = { state: 'idle', why: '', reg: null, at: 0, pending: null };
  let BOUND = null;
  function load(force) {
    if (SCEN.state === 'loading' && SCEN.pending) return SCEN.pending;
    SCEN.state = 'loading'; SCEN.why = '';
    emit('scenario', { state: 'loading' });
    SCEN.pending = api.scenarios({ fresh: !!force }).then(res => {
      if (res.ok && res.body && Array.isArray(res.body.scenarios) && res.body.scenarios.length) {
        SCEN.state = 'ok'; SCEN.reg = res.body; SCEN.at = Date.now(); SCEN.why = '';
        try { root.localStorage.setItem(OK_FLAG, String(Date.now())); } catch (e) { /* storage refused */ }
      } else {
        SCEN.state = 'unavailable'; SCEN.reg = null;
        SCEN.why = res.ok ? 'the server answered with no scenario list' : (res.why || `HTTP ${res.status}`);
      }
      SCEN.pending = null;
      emit('scenario', { state: SCEN.state });
      return SCEN;
    });
    return SCEN.pending;
  }
  const list = () => (SCEN.reg && SCEN.reg.scenarios) || [];
  const entry = id => list().find(s => s.id === id) || null;
  const current = () => (BOUND && BOUND.ST && BOUND.ST.scenario) || 'base';
  /** the short name the strip shows: the label before its first " — " ("High Gas") */
  function short(id) {
    const e = entry(id); if (!e) return id === 'base' ? 'Base' : id;
    return String(e.label || e.id).split(' — ')[0];
  }
  function runWord(id) {
    let m;
    if (id === 'hist') return 'Settled';
    if ((m = /^(\d+)yr$/i.exec(String(id)))) return `PROBE ${m[1]}-year`;
    if ((m = /^pcr(\d{4})$/i.exec(String(id)))) return `PCR ${m[1]}`;
    return String(id);
  }
  /** the factor as the reader sees it, from the server's number: "× 1.10" */
  const factorWord = f => (typeof f === 'number' && Number.isFinite(f)) ? `× ${f.toFixed(2)}` : '';
  /** Base at one year, at one bus (null for a zone or the hub: the Cape rule is per bus) */
  function baseRun(year, bus) {
    const reg = SCEN.reg; if (!reg) return null;
    let run = (reg.base_plan || {})[String(year)] || null;
    const c = reg.cape;
    if (run && c && bus != null && +year === +c.year && run === c.from) {
      let applied = false;
      try {
        const n = root.GS && typeof root.GS.priceBasisNote === 'function' ? root.GS.priceBasisNote(bus, +year) : null;
        applied = !!(n && n.applied);
      } catch (e) { applied = false; }
      if (applied) run = c.to;
    }
    return run;
  }
  /* the per-view log: what a paint scaled and what it drew as solved, and why — the panel notes read it */
  const LOG = new Map();
  let BUILDING = null;
  function logFor(view) { const k = view || BUILDING || 'other'; if (!LOG.has(k)) LOG.set(k, { applied: new Set(), skipped: new Map() }); return LOG.get(k); }
  /** THE rule. {run, year, kind, bus, sid?, view?} -> {f, applied, why, sid}. Never throws. */
  function adjust(a) {
    const x = a || {};
    const sid = x.sid || current();
    const out = (f, applied, why, extra) => Object.assign({ f, applied, why, sid }, extra || {});
    if (sid === 'base') return out(1, false, null, { base: true });
    if (SCEN.state !== 'ok') {
      return out(1, false, SCEN.state === 'loading' ? 'the scenario list is still loading'
        : `the scenario list is not served (${SCEN.why || 'not loaded'})`, { unavailable: true });
    }
    const e = entry(sid);
    if (!e) return out(1, false, `${sid} is not in the scenario list the server published`, { unavailable: true });
    if (e.kind === 'base') return out(1, false, null, { base: true });
    const never = (SCEN.reg.never_scaled || ['settled']);
    if (x.run === 'hist' || never.includes(x.kind)) return out(1, false, 'settled history is never scaled', { settled: true });
    if (e.kind !== 'proxy') {
      const why = `${short(sid)} is a solved run: it is read from the server, not scaled in the page`;
      logFor(x.view).skipped.set(`${runWord(x.run)} ${x.year}`, why);
      return out(1, false, why);
    }
    const want = baseRun(x.year, x.bus);
    if (!want || want !== x.run) {
      const why = !want ? `no Base run is planned for ${x.year}`
        : `not the Base run for ${x.year}${x.bus != null && +x.year === +(SCEN.reg.cape || {}).year && want === (SCEN.reg.cape || {}).to ? ` at this bus (${runWord(want)} is read for ${x.year})` : ` (Base reads ${runWord(want)})`}`;
      logFor(x.view).skipped.set(`${runWord(x.run)} ${x.year}`, why);
      return out(1, false, why);
    }
    logFor(x.view).applied.add(`${runWord(x.run)} ${x.year}`);
    return out(e.factor, true, null);
  }
  const scaleNum = (v, f) => (v == null || typeof v !== 'number' || !Number.isFinite(v)) ? v : v * f;
  const scen = {
    get state() { return SCEN.state; },
    get why() { return SCEN.why; },
    registry: () => SCEN.reg,
    load, list, entry, short, runWord, factorWord, baseRun, adjust, current,
    wasLoaded() { try { return !!root.localStorage.getItem(OK_FLAG); } catch (e) { return false; } },
    isProxy: id => { const e = entry(id); return !!(e && e.kind === 'proxy'); },
    scaleNum,
    scaleArr: (arr, f) => Array.isArray(arr) ? arr.map(v => scaleNum(v, f)) : arr,
    /** the line a panel prints when the scenario reaches it */
    appliedLine(id) {
      const e = entry(id || current()); if (!e) return '';
      return `Scenario ${e.label}: Base ${factorWord(e.factor)} on solved and escalated years; settled history is never scaled.`;
    },
    /** the method behind (i): built from the server's own plan and step, never typed here */
    methodLine() {
      const r = SCEN.reg; if (!r) return '';
      const plan = r.base_plan || {}, c = r.cape || {};
      const yrs = Object.keys(plan).sort().map(y => `${y} ${runWord(plan[y])}${(r.escalated_years || {})[y] ? ' escalated' : ''}`).join(' · ');
      return `A proxy is Base × one factor, not a solved market outcome. Base is the run the price basis reads each year: ${yrs}` +
        (c.year ? `; at a Cape-flagged bus ${c.year} reads ${runWord(c.to)}` : '') +
        (r.vendor_step ? `; 2045 and 2050 escalate PCR 2040 ${factorWord(r.vendor_step)} per five years` : '') +
        '. Settled history is never scaled. LMP, energy, congestion and loss scale together, so the components still sum to the LMP.';
    },
    /** the per-view log of the last paint */
    log: view => { const l = LOG.get(view); return l ? { applied: [...l.applied], skipped: [...l.skipped.entries()] } : { applied: [], skipped: [] }; },
    resetLog() { LOG.clear(); },
    building(view) { BUILDING = view || null; },
    get viewNow() { return BUILDING; },
  };

  /* ── the one state ─────────────────────────────────────────────────────── */
  /** ext/60 binds {ST, store, paint, scope, runs, market, asset, on}. ST is the object itself — not a copy — so
   *  every panel, and every module the Continuum hooks, reads the same scope, runs, market and scenario. */
  function bind(b) { BOUND = b; emit('bind', b); }
  function horizon() {
    try { return (root.App && root.App.state && root.App.state.basis && root.App.state.basis.horizon) || 2030; } catch (e) { return 2030; }
  }
  function state() {
    if (!BOUND) return null;
    const ST = BOUND.ST, sc = BOUND.scope(), sid = ST.scenario || 'base', e = entry(sid);
    const scr = String(ST.screen || '');
    return {
      scope: { kind: sc.kind, key: sc.key },
      asset: BOUND.asset ? BOUND.asset() : null,
      market: BOUND.market ? BOUND.market() : ST.market,
      runs: BOUND.runs ? BOUND.runs() : (ST.scenarios || []).slice(),
      scenario: { id: sid, label: e ? e.label : (sid === 'base' ? 'Base' : sid), kind: e ? e.kind : (sid === 'base' ? 'base' : null),
        factor: e ? e.factor : (sid === 'base' ? 1 : null), registry: SCEN.state },
      year: ST.year != null ? ST.year : horizon(),
      screen: scr,
      workflow: scr.startsWith('wf:') ? scr.slice(3) : ((viewOf(scr) || {}).screen || null),
    };
  }
  function setScenario(id) {
    if (!BOUND) return false;
    const ok = id === 'base' || !!entry(id);
    if (!ok) return false;
    BOUND.ST.scenario = id;
    if (BOUND.store) BOUND.store();
    emit('scenario', { state: SCEN.state, id });
    return true;
  }

  /* ── S-nav 2026-10-07 · ONE live connection ─────────────────────────────────────────────────────────────────
     Replaces the five first-use buttons (Load constraint data · Load basis data · Load profitability · Load emissions ·
     Load proxy scenarios). A browser that has never read the live server is asked once ("Connect live data", in the
     toolbar); after one good answer — or any of the old per-panel flags — every open probes /continuum/status and, when
     it answers, every route reads on open and the scenario list loads. A page that never connected sends nothing, so a
     file:// session without the server puts no failed request in the console. */
  const LIVE_FLAG = 'gs.continuum.live.ok';
  const LEGACY_FLAGS = ['gs.continuum.drivers.ok', 'gs.continuum.value.ok', 'gs.continuum.em.ok', OK_FLAG];
  const LIVE = { state: 'idle', why: '', at: 0, pending: null };
  function remembered() { try { return [LIVE_FLAG].concat(LEGACY_FLAGS).some(k => !!root.localStorage.getItem(k)); } catch (e) { return false; } }
  function connect(force) {
    if (LIVE.pending) return LIVE.pending;
    if (LIVE.state === 'on' && !force) return Promise.resolve(LIVE);
    LIVE.state = 'connecting'; LIVE.why = '';
    emit('live', { state: LIVE.state });
    LIVE.pending = api.status({ fresh: true }).then(res => {
      LIVE.at = Date.now(); LIVE.pending = null;
      if (res.ok) {
        LIVE.state = 'on';
        try { root.localStorage.setItem(LIVE_FLAG, String(Date.now())); } catch (e) { /* storage refused: this session only */ }
        if (SCEN.state === 'idle' || SCEN.state === 'unavailable') load(SCEN.state === 'unavailable');
      } else { LIVE.state = 'off'; LIVE.why = res.why || `HTTP ${res.status}`; }
      emit('live', { state: LIVE.state });
      return LIVE;
    });
    return LIVE.pending;
  }
  const live = {
    get state() { return LIVE.state; },
    get why() { return LIVE.why; },
    /** may a panel read its route on paint: connected this session, or this browser connected before */
    allowed: () => LIVE.state === 'on' || LIVE.state === 'connecting' || (LIVE.state !== 'off' && remembered()),
    remembered, connect,
    /** the open: a browser that connected before reconnects without being asked */
    resume() { if (LIVE.state === 'idle' && remembered()) return connect(); return null; },
    flag: LIVE_FLAG,
  };

  /* ── S-nav 2026-10-07 · the screen the asset opens on (03-workflow, fuel-adaptive table) ── */
  const LEAD = { solar: 'shape', wind: 'shape', bess: 'shape', hybrid: 'shape', dc: 'offtake' };
  const leadScreen = fuel => LEAD[fuel] || 'shape';

  /* ── S-nav 2026-10-07 · chart signatures (the duplicate-chart audit, Ganesh's rule 1) ─────────────────────────
     Every chart a Continuum page draws carries data-gsc-sig="<measure>|<period>|<market>" on its panel; the scope is the
     page's. Two homes drawing one signature is a duplicate graph — client/tests/studio-continuum-nav.mjs fails on it, and
     on any chart that carries no signature at all. sig() builds the attribute so the words are one vocabulary. */
  const MEASURES = ['lmp', 'lmp-components', 'basis', 'ppa-settlement', 'congestion-by-constraint', 'curtailment', 'tb-spread',
    'neg-hours', 'price-duration', 'price-vs-generation', 'capture', 'generation-by-fuel', 'marginal-fuel', 'queue-additions',
    'capacity-price', 'gas-price', 'co2-intensity', 'cfe-match', 'profit', 'net-of-interconnection', 'net-value-rank', 'margin-by-scenario'];
  function sig(measure, period, market) {
    if (!MEASURES.includes(measure)) throw new Error(`sig: unknown measure ${measure} — add it to GSContinuum's vocabulary`);
    return [measure, String(period || '-'), String(market || '-')].join('|');
  }

  root.GSContinuum = {
    api, scen, on, emit, bind, state, setScenario, register, live, leadScreen, sig, measures: () => MEASURES.slice(),
    get bound() { return BOUND; },
    get st() { return BOUND ? BOUND.ST : null; },
    active: () => !!(BOUND && BOUND.on && BOUND.on()),
    views: () => allViews().map(v => Object.assign({}, v)),
    view: viewOf,
    workflow: () => WORKFLOW.map(w => Object.assign({}, w, { views: allViews().filter(v => v.screen === w.k).map(v => v.k) })),
    screenOf: k => { const v = viewOf(k); return v ? v.screen : (String(k).startsWith('wf:') ? String(k).slice(3) : null); },
    workflowOf: wfOf,
  };
})(window);
