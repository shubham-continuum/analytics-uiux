/* VENDORED from live Studio ext/60-cathy.js (snapshot 2026-10-11, sha256 a5bf00430f9d1a13).
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/continuum/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   ext: 60-cathy.js — Cathy, the SCED analytics tab inside the GridSense Studio.

   Ganesh: "incorporate UI similar to the NodeScope tool within analytics as a
   SCED analytics platform … name this tab Cathy … same UI as NodeScope for both
   historical and full forecast analytics till 2050, hourly data till 2040, and
   generation outlook till 2050 both historical and future from SCED assumptions
   for ISO-NE, with multi-scenario access like base case, High Gas, High Load."

   The layout is NodeScope's, copied rather than imagined: the tool was served at
   http://127.0.0.1:8780/ on 2026-09-25, every screen walked in Playwright and
   screenshotted to outputs/studio-cathy/nodescope-reference/. What was copied,
   screen by screen, is tabulated in studio/CATHY-UI-ADDED.md §2.

     left rail   ISO line · node search + level filter · the list with the
                 selected option's bus preselected · reference hub · export
     top strip   every scenario in meta.scenarios, held ones selectable (up to
                 three overlay at once), the two not held greyed and inert
     tabs        nine screens, then a context line reading
                 "ISO-NE · <scope> · <scenarios>" on the right
     surface     panels in an auto-fill grid, controls on each panel's own right
                 edge, a table view behind every chart

   Data: window.GS_DATA_EXT.cathy, exactly the shape in studio/CATHY-CONTRACT.md.
   Nothing is invented when a block is absent: the panel says what is missing and
   which control or which run would fill it.

   Four rules the contract puts above everything, and where each is enforced:
     1 a scenario that is not held is a labelled, inert chip — never a flat line
       → strip(), and DATA.held()
     2 no line across a gap — a null breaks the series and the break is drawn
       → explorerChart(), runs()
     3 2045 and 2050 are hollow and dashed and say "escalated from 2040"
       → MARK, explorerChart(), and the face line
     4 a partial year carries its hours on the mark
       → explorerChart(), faceLine()

   Performance: the month × hour surface and the duration curves are canvas; the
   explorer is SVG; hover moves a DOM readout and never re-runs a draw. The draw
   counter window.GSCathy.draws is the assertion in client/tests/studio-cathy.mjs.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const A = window.App, GS = window.GS, Views = window.Views;
  if (!A || !GS || !Views) { console.warn('[cathy] host app not on window — module idle'); return; }
  const H = A.H, esc = A.esc, icon = A.icon, fmt = GS.fmt;

  /* ── small helpers ─────────────────────────────────────────────────────── */
  const el = (t, c, txt) => H(t, c, txt);
  const svgEl = (t, attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', t);
    if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, String(attrs[k]));
    return n;
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const uniq = a => [...new Set(a)];
  /** A CSS custom property read at DRAW time, so the theme toggle repaints every
   *  chart without a single hex living at a use site. */
  const tok = (name, host) => {
    const s = getComputedStyle(host || document.getElementById('app') || document.body)
      .getPropertyValue(name).trim();
    return s || '#888888';
  };
  /** relative luminance of a resolved colour, for picking a heat cell's ink */
  function lumOf(css) {
    const m = /^#?([0-9a-f]{6})$/i.exec(css) || /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(css);
    let r, g, b;
    if (!m) return 0.5;
    if (m.length === 2) { const h = parseInt(m[1], 16); r = (h >> 16) & 255; g = (h >> 8) & 255; b = h & 255; }
    else { r = +m[1]; g = +m[2]; b = +m[3]; }
    const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }

  /* ── the data block ────────────────────────────────────────────────────── */
  const DATA = () => (window.GS_DATA_EXT && window.GS_DATA_EXT.cathy) || null;
  const META = () => { const d = DATA(); return (d && d.meta) || null; };
  const SCENARIOS = () => { const m = META(); return (m && m.scenarios) || []; };
  const scenOf = id => SCENARIOS().find(s => s.id === id) || null;
  const heldIds = () => SCENARIOS().filter(s => s.held).map(s => s.id);
  const NOT_HELD = 'not held — a PROBE run with this assumption set is needed';
  /** The name the reader sees. The code identifiers — the `cathy` data key, the
   *  `cathy:open` event, these file names — are the contract three other
   *  modules are built against and never change; only the label does. */
  const NAME = () => { const m = META(); return (m && m.display_name) || 'LMP Continuum'; };
  /** Every empty block carries its own reason on meta.coverage.<block>.reason.
   *  An empty screen shows that sentence and nothing else — never a plausible
   *  placeholder, never a number borrowed from another market. */
  function reasonFor(block, fallback) {
    const m = META(), c = m && m.coverage && m.coverage[block];
    if (!c) return fallback || '';
    return c.reason || c.note || c.settled_market_basis || fallback || '';
  }
  function coverageOf(block) { const m = META(); return (m && m.coverage && m.coverage[block]) || {}; }
  /** `settled_partial` is one word carrying two facts. Split it: the mark reads
   *  the kind, the size reads the partial flag, and neither guesses. */
  function normKind(row) {
    const k = String(row.kind || '');
    if (k.endsWith('_partial')) return { kind: k.slice(0, -('_partial'.length)), partial: true };
    return { kind: k || 'solved', partial: !!row.partial };
  }

  const SCREENS = [
    { k: 'explorer', label: 'Price explorer' },
    { k: 'surface', label: 'Hourly surface' },
    { k: 'duration', label: 'Duration curve' },
    { k: 'makeup', label: 'Price components' },
    { k: 'spreads', label: 'Spreads' },
    { k: 'negative', label: 'Negative hours' },
    { k: 'generation', label: 'Generation outlook' },
    { k: 'capacity', label: 'Capacity & gas' },
    { k: 'export', label: 'Export' },
  ];
  const KIND_WORD = { settled: 'settled', solved: 'solved', escalated: 'escalated' };
  /** "PCR 2030" at 2030 reads "PCR 2030", not "PCR 2030 2030" (continuum fix 2026-10-06, D14) */
  const withYear = (label, year) => year == null || String(label).includes(String(year)) ? String(label) : `${label} ${year}`;
  const ESC_NOTE = 'escalated from 2040, no hourly run';

  /* ── state ─────────────────────────────────────────────────────────────── */
  const KEY = 'gs.cathy.v1';
  const DEF = {
    screen: 'explorer',
    scopeKind: 'hub',            // hub | zone | bus
    scopeKey: null,              // the hub id, a zone code, or a bus_id
    scenarios: ['hist', 'pcr2030'],
    market: 'DA',                // DA | RT | model
    rel: false,                  // hub-relative basis
    surfYear: null,
    durYear: null,
    tables: {},                  // panel id -> table view on?
    query: '', level: 'all',
    zoom: 'week', hourAt: 0,     // the hourly window at a full-depth bus
    hourYear: null,              // the settled year on the hourly series (latest when null)
    from: 'explorer',            // the screen Export lists, i.e. the one you came from
    /* orchestrator 2026-09-28 lmp continuous: settled history and forecast on one axis */
    hvf: true,                   // History vs forecast: settled selected alone gets the default run beside it
    fcrun: 'basis',              // the continuous panel's forecast run set (basis | pcr | probe)
    optKey: null,                // continuum fix 2026-10-06 (D3): the project|option the scope last followed
    followed: null,              // …and the scope that following adopted ({kind, key}); a different scope was picked
    scenario: 'base',            // continuum S0 2026-10-06: the scenario every forecast panel reads (GET /api/v2/scenarios)
    year: null,                  // continuum S0 2026-10-06: the focus year; null = the Studio's horizon
    pageOf: {},                  // S-nav 2026-10-07: the last page read on each workflow screen
    openedFor: null,             // S-nav 2026-10-07: the project|option|asset the last open followed
    overlay: false,              // S-nav 2026-10-07: Outlook's scenario overlay (the strip's runs on the one price chart)
  };
  const ST = Object.assign({}, DEF, { tables: {} });
  try { const raw = localStorage.getItem(KEY); if (raw) Object.assign(ST, JSON.parse(raw)); }
  catch (e) { /* storage refused — this session's defaults stand */ }
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(ST)); return true; } catch (e) { return false; } };
  /* continuum fix 2026-10-06 (D3): the scope as this session loaded it — a stored scope that predates option
     tracking still follows the option; a scope a caller set before open() does not */
  const LOADED = { kind: ST.scopeKind, key: ST.scopeKey };
  /* S-nav 2026-10-07: the asset decides the screen the Continuum opens on — unless something chose a screen since the
     last open (a reader, a hand-off, a caller that set ST.screen before open()). Writes to ST.screen are counted here. */
  let SCREEN_V = ST.screen, SCREEN_SET = false;
  Object.defineProperty(ST, 'screen', { enumerable: true, configurable: true,
    get() { return SCREEN_V; }, set(v) { SCREEN_V = v; SCREEN_SET = true; } });

  /* ── continuum S0 2026-10-06: the scenario rule lives in ext/59 (GSContinuum.scen.adjust); these are the
     only places this file touches it. A value is scaled only where adjust() says the run is Base for that year;
     settled history never is. Every scaled row carries the verdict as `_scen`. ─────────────────────────────── */
  const CORE = () => window.GSContinuum || null;
  const SCN = () => (CORE() && CORE().scen) || null;
  const scenOn = () => !!SCN() && (ST.scenario || 'base') !== 'base';
  function scenAdj(sid, year, kind, bus) {
    const S = SCN();
    if (!S || !scenOn()) return { f: 1, applied: false };
    return S.adjust({ run: sid, year, kind: kind || (String(sid).split(':')[0] === 'hist' ? 'settled' : 'solved'), bus });
  }
  function scaleFields(row, a, fields) {
    if (!a || !a.applied) return row;
    const o = Object.assign({}, row);
    fields.forEach(k => { if (typeof o[k] === 'number' && Number.isFinite(o[k])) o[k] = o[k] * a.f; });
    o._scen = a;
    return o;
  }
  const scaleList = (arr, a) => (a && a.applied && Array.isArray(arr)) ? arr.map(v => (typeof v === 'number' && Number.isFinite(v)) ? v * a.f : v) : arr;
  /** " · High Gas proxy × 1.10" for a legend whose series the scenario reached, else '' */
  function scenWord(reached) {
    const S = SCN(); if (!reached || !S || !scenOn()) return '';
    const e = S.entry(ST.scenario); return e ? ` · ${S.short(e.id)} proxy ${S.factorWord(e.factor)}` : '';
  }

  let ON = false;              // Cathy has the workspace
  let ROOT = null;             // #gsc-root, held across the host's render()
  let mapWasOff = null;        // the map dock's state before Cathy took the screen
  let lastOpen = null;         // what the last cathy:open event carried

  /* ── scope ─────────────────────────────────────────────────────────────── */
  /** The hub's NAME and the hub's KEY are two different strings: the exporter
   *  publishes `.H.INTERNAL_HUB` as the pnode it read and keys its rows `HUB`.
   *  The key is taken from the rows themselves so a rename upstream cannot
   *  silently empty every hub panel; the name is what the reader sees. */
  function hubKey() {
    const d = DATA(); if (!d) return 'HUB';
    const r = (d.annual || []).find(x => x.scope === 'hub')
      || (d.month_hour || []).find(x => x.scope === 'hub');
    return r ? r.key : ((META() && META().hub) || 'HUB');
  }
  function hubName() { const m = META(); return (m && m.hub) || hubKey(); }
  /* continuum fix 2026-10-06 (D11): the hub has ONE label on every surface — picker, scope card, titles,
     context line and the faces that used to read "HUB zone" */
  function hubLabel() { return `ISO-NE Hub (${hubName()})`; }
  /** the reader's name for a zone or hub key on a face */
  function aggShort(kind, key) { return kind === 'hub' || key === hubKey() ? hubLabel() : key; }
  function aggLabel(kind, key) { return kind === 'hub' || key === hubKey() ? hubLabel() : `${key} zone`; }
  function zones() { const m = META(); return (m && m.zones) || []; }
  /** every bus the block can be read at. A geo_proxy demo bus has no level of
   *  its own and so no `bus_annual` row, but it does carry full depth — the
   *  union, or the picker would hide exactly the buses with the most behind
   *  them. */
  function busIds() {
    const d = DATA(); if (!d) return [];
    return uniq(Object.keys(d.bus_annual || {}).concat(Object.keys(d.bus_full || {})))
      .map(Number).filter(n => !Number.isNaN(n)).sort((a, b) => a - b);
  }

  /* ── full depth · the demo buses ───────────────────────────────────────── */
  /** `bus_full` carries the complete record at a handful of buses: the hourly
   *  series per held scenario and market, daily spreads, a duration curve, the
   *  make-up and the negative-hour count. Every other bus keeps the annual mean
   *  and the 288-cell surface, and the screens say which of the two they are
   *  reading. Field names are read tolerantly — the exporter's spelling and the
   *  sketch's spelling both work — because a silent miss here would look like
   *  "this bus has no full depth" rather than "the reader was wrong". */
  function busFull(id) {
    const d = DATA(); if (!d || id == null) return null;
    const b = (d.bus_full || {})[id] || (d.bus_full || {})[String(id)];
    return b || null;
  }
  const hasFull = id => !!busFull(id);
  function fullHourly(id) {
    const b = busFull(id); if (!b) return null;
    return b.hourly || b.hours || b.series || null;
  }
  /** The hourly block is keyed by ENTRY, not by scenario: a settled run gets one
   *  entry per year (`hist:2025`), a solved run one entry (`pcr2030`). Each
   *  entry names its year, kind, the markets it holds and the hours behind each
   *  — and the array itself may be null where the exporter withheld it for
   *  budget. Flattened here into one list, so the screens never have to know
   *  which of the two spellings arrived.  */
  function fullEntries(id) {
    const h = fullHourly(id); if (!h) return [];
    const out = [];
    Object.keys(h).forEach(k => {
      const e = h[k];
      const scenario = k.indexOf(':') > 0 ? k.slice(0, k.indexOf(':')) : k;
      if (Array.isArray(e)) { out.push({ key: k, scenario, year: null, kind: null, partial: false,
        markets: ['as stored'], values: { 'as stored': e }, hours: {}, entry: e }); return; }
      if (!e || typeof e !== 'object') return;
      /* the sketch's shape: scenario -> market -> { year, values } */
      const leafKeys = Object.keys(e).filter(m => e[m] && typeof e[m] === 'object' && Array.isArray(e[m].values));
      if (leafKeys.length) {
        leafKeys.forEach(m => out.push({ key: k + '|' + m, scenario, year: e[m].year != null ? e[m].year : null,
          kind: e[m].kind || null, partial: !!e[m].partial, markets: [m],
          values: { [m]: e[m].values }, hours: { [m]: e[m].values.length }, entry: e[m] }));
        return;
      }
      /* the exported shape: one entry, markets as sibling keys */
      const mk = e.markets_held || ['DA', 'RT', 'model'].filter(m => m in e);
      const values = {};
      mk.forEach(m => { values[m] = Array.isArray(e[m]) ? e[m] : null; });
      out.push({ key: k, scenario, year: e.year != null ? e.year : null, kind: e.kind || null,
        partial: !!e.partial, markets: mk, values,
        hours: e.hours && typeof e.hours === 'object' ? e.hours : {},
        withheld: !!e.hourly_withheld,
        withheldNote: e.hourly_withheld_note || null,
        daHeld: e.da_held !== false,
        calendar_hours: e.calendar_hours, calendar_basis: e.calendar_basis, entry: e });
    });
    return out.sort((a, b) => (a.year || 0) - (b.year || 0));
  }
  const fullScenarios = id => uniq(fullEntries(id).map(e => e.scenario));
  /** the entries of one scenario that actually carry an array. An entry with
   *  only a row is a withheld year, not an absent one — pickHourly() says so. */
  function fullDrawable(id, sid) {
    return fullEntries(id).filter(e => e.scenario === sid && Object.keys(e.values).some(m => Array.isArray(e.values[m])));
  }
  /** a named block on the bus, under either spelling, always as a flat array.
   *  `daily_tb` arrives keyed by scenario and already rolled to the year; the
   *  sketch's `tb_daily` arrives as one row per day. Both end up as year rows
   *  here, and the day count travels with them. */
  function fullBlock(id, name) {
    const b = busFull(id); if (!b) return [];
    const alt = { tb_daily: 'daily_tb', daily_tb: 'tb_daily' }[name];
    const v = b[name] != null ? b[name] : (alt ? b[alt] : null);
    if (v == null) return [];
    if (Array.isArray(v)) return v;
    /* keyed by scenario */
    return Object.keys(v).flatMap(sid => (v[sid] || []).map(r => Object.assign({ scenario: sid }, r)));
  }
  const hasBlock = (id, name) => fullBlock(id, name).length > 0;
  /** the chip: full depth, and for a proxy bus, whose node it is reading.
   *  Every bus in the block names a price node — a direct bus's node is its own
   *  — so the proxy test is the TIER and the distance, never the node's
   *  presence, or every bus would claim to be reading somewhere else. */
  function depthChip(id) {
    const b = busFull(id);
    if (!b) return { full: false, proxy: false, text: 'annual + month×hour only at this bus' };
    const node = b.price_node || b.node || null;
    /* distance_mi is NULL, not zero, on a bus that reads its own node. Zero
       miles is not a distance, and "0.0 mi away" would read as a measurement. */
    const mi = b.distance_mi != null ? b.distance_mi : null;
    const proxy = b.tier === 'geo_proxy';
    /* the distance is printed at the precision it was published at (12.05,
       7.34, 1.05) — one decimal would turn 12.05 into a different number */
    const miOk = mi != null && Number.isFinite(+mi) && +mi > 0;
    if (proxy && node) return { full: true, proxy: true, node, mi: miOk ? +mi : null,
      note: b.proxy_note || null,
      text: `reads ${node}${miOk ? ` · ${fmt.num(+mi, 2)} mi away` : ''} (settled record)` };
    return { full: true, proxy: false, node, mi: null, text: 'full depth' };
  }
  /** The proxy is a SETTLED-record substitution. Every solved run publishes a
   *  series for the bus itself, so saying "this bus reads somewhere else" of
   *  the whole screen would be wrong on five of the twelve entries. */
  const PROXY_SCOPE = 'the proxy applies to the settled record only — this bus has its own solved series in every run';
  const isSettled = sid => String(sid).split(':')[0] === 'hist';
  /** bus_annual is packed: `{ tier, rows: [[…meta.bus_annual_cols]] }`, and was
   *  sketched as a plain array of objects. Both are read, so the UI does not
   *  break on whichever the exporter ships. */
  function busRows(id) {
    const d = DATA(); if (!d) return [];
    const b = (d.bus_annual || {})[id];
    if (!b) return [];
    if (Array.isArray(b)) return b;
    const cols = (META() && META().bus_annual_cols) || ['scenario', 'year', 'market', 'mean', 'hours', 'kind'];
    const tier = b.tier || null;
    return (b.rows || []).map(r => {
      const o = { tier };
      cols.forEach((c, i) => { o[c] = r[i]; });
      return o;
    });
  }
  function busTier(id) {
    const d = DATA(); const b = d && (d.bus_annual || {})[id];
    if (!b) { const f = busFull(id); return f ? (f.tier || null) : null; }
    if (Array.isArray(b)) return (b[0] || {}).tier || null;
    return b.tier || null;
  }
  function scope() {
    if (!ST.scopeKey) resetScope();
    return { kind: ST.scopeKind, key: ST.scopeKey };
  }
  function resetScope() {
    /* the current option's bus, if Cathy holds a series for it; otherwise the hub */
    const want = preferredBus();
    if (want != null) { ST.scopeKind = 'bus'; ST.scopeKey = want; ST.followed = { kind: 'bus', key: want }; return; }
    ST.scopeKind = 'hub'; ST.scopeKey = hubKey(); ST.followed = { kind: 'hub', key: ST.scopeKey };
  }
  function preferredBus() {
    const ids = busIds(); if (!ids.length) return null;
    const frameBus = window.GSFrame && GSFrame.state ? GSFrame.state.busId : null;
    const o = A.option && A.option();
    for (const cand of [frameBus, o && o.busId]) if (cand != null && ids.includes(Number(cand))) return Number(cand);
    return null;
  }
  function scopeLabel() {
    const s = scope();
    if (s.kind === 'bus') {
      const n = GS.node(Number(s.key)), t = busTier(s.key);
      return (n ? `${n.name} ${n.kv} kV · #${s.key}` : `bus ${s.key}`) + (t ? ` · ${t.replace(/_/g, ' ')} tier` : '');
    }
    if (s.kind === 'hub') return hubLabel();
    return `${s.key} zone`;
  }
  function scopeShort() {
    const s = scope();
    if (s.kind === 'bus') { const n = GS.node(Number(s.key)); return n ? n.name : `bus ${s.key}`; }
    if (s.kind === 'hub') return hubLabel();
    return s.key;
  }
  /** Four of the nine screens read blocks the store publishes at zone and hub
   *  scope only. With a bus in scope they read that bus's zone and SAY SO —
   *  the alternative is four empty screens the moment the reader lands on the
   *  option's bus, which is where Cathy opens. A bus whose zone Cathy does not
   *  carry falls through to null and the panel states that instead. */
  function readScope(block) {
    const s = scope();
    if (s.kind !== 'bus') return { kind: s.kind, key: s.key, via: null, bus: null };
    /* a full-depth bus reads its OWN rows for these blocks, not its zone's */
    if (block && hasBlock(s.key, block)) {
      const c = depthChip(s.key);
      return { kind: 'bus', key: s.key, bus: s.key,
        via: `read at the bus itself — full depth${c.proxy ? `, ${c.text}; ${PROXY_SCOPE}` : ''}` };
    }
    /* S-nav 2026-10-07 (review P2 6): a bus scope reads the bus. Where the block is not held at this bus the screen says
       so and offers the zone as an explicit choice — it never reads the zone silently under the bus's name. */
    const n = GS.node(Number(s.key));
    const z = n && n.zone && zones().includes(n.zone) ? n.zone : null;
    return { kind: 'bus', key: s.key, bus: null, missing: true, zone: z, name: n ? n.name : `bus ${s.key}`,
      via: `not held at ${n ? n.name : 'bus'} #${s.key}` };
  }
  /** the written state for a block not held at the bus in scope, with the zone as a button, never as a fallback */
  function notAtBus(s, what) {
    const box = emptyBox(`${what}: not held at this bus`,
      `${s.name} #${s.key} carries annual means and the month × hour surface in this build; ${what.toLowerCase()} is held per bus only at the full-depth buses${s.zone ? `, and at zone level for ${s.zone}` : ''}.`);
    box.setAttribute('data-gsc-notheld', 'bus');
    if (s.zone) {
      const b = el('button', 'gsc-btn', `Show ${s.zone} zone`); b.type = 'button'; b.setAttribute('data-gsc-tozone', s.zone);   // NAMING-GUIDE: verb first, ≤ 3 words
      b.title = 'Switch the scope to the zone — every panel then reads the zone, and says so';
      b.onclick = () => { ST.scopeKind = 'zone'; ST.scopeKey = s.zone; ST.surfYear = null; store(); paint(); };
      box.appendChild(b);
    }
    return box;
  }

  /* ── selected scenarios, in slot order ─────────────────────────────────── */
  function selected() {
    const ok = heldIds();
    let list = (ST.scenarios || []).filter(id => ok.includes(id));
    if (!list.length) list = ok.slice(0, 1);
    return list.slice(0, 3);
  }
  /* orchestrator 2026-09-28 lmp continuous: a run the History vs forecast toggle adds takes the next free slot */
  const slotOf = id => { const i = selected().indexOf(id); return i >= 0 ? i + 1 : Math.min(3, selected().length + 1); };
  function scenColour(id, host) { const n = slotOf(id); return tok(`--gsc-sc-${clamp(n || 1, 1, 3)}`, host); }
  /* ── orchestrator 2026-09-28 lmp continuous · History vs forecast ───────────
     With settled history selected alone, the price screens (surface, hourly, duration, components,
     spreads) draw the forecast run GS.priceAt reads at the Studio's horizon beside it — PCR 2030 at
     2030 — so history and forecast always share the chart. The strip still decides everything else;
     the toggle turns this off. The run is named on every panel it reaches. */
  const PLAN_RUN = { 2028: '5yr', 2030: 'pcr2030', 2035: 'pcr2035', 2040: 'pcr2040', 2045: 'pcr2040', 2050: 'pcr2040' };
  function hvfRun() {
    const hz = yearNow();   // S-nav 2026-10-07: the toolbar's Year (the Studio's horizon until it is set)
    const want = PLAN_RUN[hz] || 'pcr2030', ok = heldIds();
    return ok.includes(want) ? want : ok.find(x => !isSettled(x)) || null;
  }
  /** the scenarios a price screen draws: the strip's selection, plus the default run when history is alone */
  function shapeIds() {
    const ids = selected();
    if (!ST.hvf || !ids.some(isSettled) || ids.some(id => !isSettled(id))) return ids;
    const r = hvfRun(); return r ? ids.concat([r]) : ids;
  }
  const hvfAdded = () => shapeIds().filter(id => !selected().includes(id));
  function hvfToggle() {
    const add = hvfRun();
    return toggle('History vs forecast', ST.hvf, v => { ST.hvf = v; store(); paint(); },
      `With settled history selected alone, draw the forecast run the Studio's price basis reads at its horizon (${add ? scenLabel(add) : 'none held'}) beside it on the same chart. Off: only what the strip selects.`);
  }
  /** The store's label is its id (`pcr2040`) where nobody wrote one. The reader
   *  gets a name built from the id's own parts, and the run's note supplies any
   *  case name in the store's words — "12% gas case" is read off the note,
   *  never typed here, and never renamed "High Gas". */
  function scenLabel(id) {
    const s = scenOf(id); if (!s) return id;
    let out = s.label || s.id;
    if (out === s.id) {
      let m;
      if (s.id === 'hist') out = 'Settled history';
      else if ((m = /^(\d+)yr$/i.exec(s.id))) out = `PROBE ${m[1]}-year`;
      else if ((m = /^pcr(\d{4})$/i.exec(s.id))) out = `PCR ${m[1]}`;
    }
    const gc = /(\d+(?:\.\d+)?% gas case)/i.exec(s.note || '');
    if (gc && out.toLowerCase().indexOf(gc[1].toLowerCase()) < 0) out += ` · ${gc[1]}`;
    return out;
  }

  /* ── markets available at the current scenario set ─────────────────────── */
  function marketsFor(sid) {
    const d = DATA(); if (!d) return [];
    const ids = sid ? [sid] : selected();
    const s = scope();
    const src = s.kind === 'bus' ? busRows(s.key) : (d.annual || []);
    const mk = uniq(src.filter(r => ids.includes(r.scenario) &&
      (s.kind === 'bus' || (r.scope === s.kind && r.key === s.key))).map(r => r.market));
    return ['DA', 'RT', 'model'].filter(m => mk.includes(m));
  }
  function market() {
    const mk = marketsFor();
    if (!mk.length) return ST.market;
    return mk.includes(ST.market) ? ST.market : mk[0];
  }
  /** The market a given scenario is actually read at. Historical publishes DA and
   *  RT; a solved run publishes only `model`. Overlaying the two would otherwise
   *  silently drop one series, so each is read at the chosen market when it has
   *  it and at its own market when it does not — and the series says which. */
  function marketFor(sid) {
    const mk = marketsFor(sid);
    if (!mk.length) return null;
    return mk.includes(ST.market) ? ST.market : mk[0];
  }
  const MKT_WORD = m => m === 'model' ? 'model' : m;

  /* ── row readers ───────────────────────────────────────────────────────── */
  /** annual rows at the scope, for one scenario and one market, year-ascending */
  function annualRows(sid, mk, raw) {
    const d = DATA(); if (!d) return [];
    const s = scope();
    const src = s.kind === 'bus'
      ? busRows(s.key).map(r => Object.assign({ scope: 'bus', key: s.key }, r))
      : (d.annual || []).filter(r => r.scope === s.kind && r.key === s.key);
    const rows = src.filter(r => r.scenario === sid && r.market === mk)
      .map(r => Object.assign({}, r, normKind(r)))
      .sort((a, b) => a.year - b.year);
    if (raw || !scenOn()) return rows;
    /* continuum S0 2026-10-06: the scenario reaches every annual reader here */
    const bus = s.kind === 'bus' ? s.key : null;
    return rows.map(r => scaleFields(r, scenAdj(sid, r.year, r.kind, bus), ['mean', 'p5', 'p50', 'p95']));
  }
  /** the same series at the hub, for the hub-relative basis toggle */
  function hubRows(sid, mk) {
    const d = DATA(); if (!d) return [];
    return (d.annual || []).filter(r => r.scope === 'hub' && r.key === hubKey() && r.scenario === sid && r.market === mk)
      .slice().sort((a, b) => a.year - b.year);
  }
  function relSeries(sid, mk) {
    if (!ST.rel) return annualRows(sid, mk);
    /* continuum S0 2026-10-06: the basis is taken on the unscaled rows, then scaled by the node row's own verdict —
       scaling node and hub separately would mix a scaled hub with an unscaled node at a Cape-flagged 2028 */
    const own = annualRows(sid, mk, true);
    const bus = scope().kind === 'bus' ? scope().key : null;
    const hub = new Map(hubRows(sid, mk).map(r => [r.year, r.mean]));
    return own.map(r => {
      const h = hub.get(r.year);
      const a = scenOn() ? scenAdj(sid, r.year, r.kind, bus) : { f: 1, applied: false };
      /* a basis with no hub value at that year is not zero — it is missing */
      return Object.assign({}, r, a.applied ? { _scen: a } : {},
        { mean: (r.mean == null || h == null) ? null : Math.round((r.mean - h) * a.f * 100) / 100 });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Chart primitives. Every one of them bumps the draw counter, and NONE of
     them is called from a hover handler.
     ═══════════════════════════════════════════════════════════════════════ */
  const COUNT = { draws: 0, hovers: 0 };
  const bump = () => { COUNT.draws++; };

  /** the run-length decomposition that makes "no line across a gap" structural
   *  rather than a promise: a null ends the run, and the break is returned so
   *  the chart can say where it is instead of merely not drawing there. */
  function runs(points) {
    const out = [], gaps = [];
    let cur = [];
    points.forEach(p => {
      if (p.v == null) { if (cur.length) { out.push(cur); cur = []; } gaps.push(p.x); return; }
      cur.push(p);
    });
    if (cur.length) out.push(cur);
    return { runs: out, gaps };
  }

  /** the mark a kind wears. Filled vs hollow is the contract's discriminator;
   *  the shape separates settled from solved without a second colour. */
  const MARK = {
    settled: { shape: 'circle', fill: true, dash: null },
    solved: { shape: 'square', fill: true, dash: null },
    escalated: { shape: 'diamond', fill: false, dash: '4 3' },
  };
  function markPath(shape, x, y, r) {
    if (shape === 'square') return `M${x - r} ${y - r}h${2 * r}v${2 * r}h${-2 * r}z`;
    if (shape === 'diamond') return `M${x} ${y - r * 1.3}L${x + r * 1.3} ${y}L${x} ${y + r * 1.3}L${x - r * 1.3} ${y}z`;
    return `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
  }

  /* ── continuum fix 2026-10-06 (D12): nice-number axes for every chart primitive ──────────────
     Ticks sit at 1/2/5 x 10^n. The top of the axis is rounded up to a tick; a negative floor is rounded
     down to one unless it is a sliver (under a quarter step), which keeps its true extent unlabelled
     rather than adding an empty band to an energy stack. */
  function niceStep(range, max) {
    const raw = Math.abs(range) / Math.max(1, max || 5);
    if (!(raw > 0) || !Number.isFinite(raw)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }
  function niceAxis(lo, hi, max) {
    if (!(hi > lo)) hi = lo + 1;
    const step = niceStep(hi - lo, max);
    const top = Math.ceil(hi / step - 1e-9) * step;
    const bot = lo >= 0 ? (lo === 0 ? 0 : Math.floor(lo / step + 1e-9) * step)
      : (-lo < step / 4 ? lo : Math.floor(lo / step + 1e-9) * step);
    const ticks = [];
    for (let k = Math.ceil(bot / step - 1e-9); k * step <= top + step * 1e-9; k++) ticks.push(+(k * step).toPrecision(12));
    const dec = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step) - 1e-9));
    return { lo: bot, hi: top, step, ticks, dec };
  }
  /** a tick label at the step's own precision; millions and thousands in short form */
  function tickFmt(v, ax) {
    const a = Math.abs(ax.step);
    const short = (div, suf) => { const st = a / div, d = st >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(st) - 1e-9)); return fmt.num(v / div, d) + suf; };
    if (Math.abs(ax.hi) >= 1e9 && a >= 1e8) return short(1e9, 'B');
    if (Math.abs(ax.hi) >= 1e6 && a >= 1e5) return short(1e6, 'M');
    if (Math.abs(ax.hi) >= 1e4 && a >= 1e3) return short(1e3, 'k');
    return fmt.num(v, ax.dec);
  }
  /** right-edge labels: sorted positions spread to at least `pitch` apart inside [top, bot] (D12) */
  function spreadLabels(ys, top, bot, pitch) {
    const n = ys.length; if (!n) return [];
    const p = n > 1 ? Math.min(pitch, (bot - top) / (n - 1)) : pitch;
    const out = ys.slice();
    out[0] = Math.max(out[0], top);
    for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] + p);
    if (out[n - 1] > bot) { out[n - 1] = bot; for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - p); }
    return out;
  }
  window.GSCathyAxis = { niceAxis, tickFmt, spreadLabels };

  /* ── 1 · the price explorer, SVG, one axis 2020 → 2050 ──────────────────── */
  function explorerChart(host, series, opt) {
    bump();
    const W = Math.max(360, host.clientWidth || 720), Hh = opt.height || 312;
    /* the unit sits ABOVE the plot, not beside the top tick — a label that
       collides with a figure is the tell this UI is measured against */
    const P = { l: 52, r: 96, t: 26, b: 26 };
    const x0 = 2020, x1 = 2050;
    const all = series.flatMap(s => s.points.map(p => p.v)).filter(v => v != null);
    if (!all.length) { host.appendChild(emptyBox('Nothing to plot at this scope',
      'No annual row exists for the selected scenarios, market and scope. Pick another scenario on the strip, or another market.')); return null; }
    let lo = Math.min(...all), hi = Math.max(...all);
    if (lo > 0 && !opt.signed) lo = 0;
    const pad = (hi - lo) * 0.08 || 1; hi += pad; if (opt.signed || lo < 0) lo -= pad;
    const ax = niceAxis(lo, hi, 5); lo = ax.lo; hi = ax.hi;
    const sx = y => P.l + (y - x0) / (x1 - x0) * (W - P.l - P.r);
    const sy = v => Hh - P.b - (v - lo) / (hi - lo) * (Hh - P.t - P.b);

    const svg = svgEl('svg', { class: 'gsc-svg', viewBox: `0 0 ${W} ${Hh}`, height: Hh,
      role: 'img', 'aria-label': opt.aria || 'Price by year' });
    svg.setAttribute('data-gsc-chart', opt.id);

    /* grid, y axis */
    ax.ticks.forEach(v => {
      const y = sy(v);
      svg.appendChild(svgEl('line', { class: 'gsc-grid', x1: P.l, x2: W - P.r, y1: y, y2: y }));
      const t = svgEl('text', { class: 'gsc-ax', x: P.l - 6, y: y + 3, 'text-anchor': 'end', 'data-gsc-tick': v });
      t.textContent = tickFmt(v, ax); svg.appendChild(t);
    });
    const yl = svgEl('text', { class: 'gsc-axl', x: 4, y: 11 }); yl.textContent = opt.unit || '$/MWh';
    svg.appendChild(yl);
    if (lo < 0 && hi > 0) svg.appendChild(svgEl('line', { class: 'gsc-axis', x1: P.l, x2: W - P.r, y1: sy(0), y2: sy(0) }));
    svg.appendChild(svgEl('line', { class: 'gsc-axis', x1: P.l, x2: W - P.r, y1: Hh - P.b, y2: Hh - P.b }));
    for (let y = x0; y <= x1; y += 5) {
      const X = sx(y);
      svg.appendChild(svgEl('line', { class: 'gsc-grid', x1: X, x2: X, y1: P.t, y2: Hh - P.b }));
      const t = svgEl('text', { class: 'gsc-ax', x: X, y: Hh - P.b + 14, 'text-anchor': 'middle' });
      t.textContent = String(y); svg.appendChild(t);
    }

    /* orchestrator 2026-09-28 lmp continuous: the "last settled" divider, between the last settled year and
       the first forecast year of whatever is drawn — settled and forecast never join across it */
    if (opt.divider !== false) {
      const setY = series.flatMap(s => s.points.filter(p => p.v != null && p.row && /settled/.test(p.row.kind)).map(p => p.x));
      const fcY = series.flatMap(s => s.points.filter(p => p.v != null && p.row && !/settled/.test(p.row.kind)).map(p => p.x));
      const lastS = setY.length ? Math.max(...setY) : null, firstF = fcY.length ? Math.min(...fcY.filter(y => lastS == null || y > lastS)) : null;
      if (lastS != null && firstF != null && Number.isFinite(firstF) && firstF > lastS) {
        const X = (sx(lastS) + sx(firstF)) / 2;
        svg.appendChild(svgEl('line', { x1: X, x2: X, y1: P.t - 4, y2: Hh - P.b, stroke: tok('--ink-4', host), 'stroke-width': 1, 'stroke-dasharray': '3 3', 'data-lmpc-divider': lastS }));
        const lt = svgEl('text', { class: 'gsc-ax', x: X - 4, y: P.t + 6, 'text-anchor': 'end' });
        lt.textContent = `last settled ${lastS}`; svg.appendChild(lt);
        const rt = svgEl('text', { class: 'gsc-ax', x: X + 4, y: P.t + 6 }); rt.textContent = 'forecast →'; svg.appendChild(rt);
      }
    }
    const hits = [];
    series.forEach(s => {
      const g = svgEl('g', { 'data-gsc-series': s.id });
      const pts = s.points.map(p => ({ x: p.x, v: p.v, row: p.row }));
      const { runs: segs, gaps } = runs(pts);
      /* the line, one polyline per run. A polyline never spans a gap because a
         gap ends its run — this is what studio-cathy.mjs asserts on. */
      segs.forEach(seg => {
        if (seg.length < 2) return;
        /* an escalated stretch is dashed; a run that mixes kinds is split again
           so the dash never lies about which stretch was escalated */
        let start = 0;
        for (let i = 1; i <= seg.length; i++) {
          const endHere = i === seg.length || (seg[i].row.kind === 'escalated') !== (seg[i - 1].row.kind === 'escalated');
          if (!endHere) continue;
          const part = seg.slice(start, Math.min(i + 1, seg.length));
          if (part.length >= 2) {
            const escalated = part[part.length - 1].row.kind === 'escalated';
            const pl = svgEl('polyline', {
              points: part.map(p => `${sx(p.x)},${sy(p.v)}`).join(' '),
              fill: 'none', stroke: s.colour, 'stroke-width': 1.8, 'stroke-linejoin': 'round',
              /* orchestrator 2026-09-28 lmp continuous: a forecast run is dashed, settled history solid */
              'stroke-dasharray': escalated ? '4 3' : s.dash ? '6 4' : null,
              'data-gsc-seg': s.id, 'data-from': part[0].x, 'data-to': part[part.length - 1].x,
              'data-kind': escalated ? 'escalated' : 'run',
            });
            g.appendChild(pl);
          }
          start = i;
        }
      });
      /* the break itself, stated */
      gaps.forEach(gy => {
        const X = sx(gy);
        g.appendChild(svgEl('line', { x1: X, x2: X, y1: Hh - P.b - 7, y2: Hh - P.b, stroke: s.colour,
          'stroke-width': 1, 'stroke-dasharray': '2 2', 'data-gsc-gap': gy, opacity: .8 }));
      });
      /* the marks */
      pts.forEach(p => {
        if (p.v == null) return;
        const m = MARK[p.row.kind] || MARK.solved, X = sx(p.x), Y = sy(p.v);
        const node = svgEl('path', {
          d: markPath(m.shape, X, Y, p.row.partial ? 4.4 : 3.6),
          fill: m.fill ? s.colour : 'none', stroke: s.colour,
          'stroke-width': m.fill ? 0 : 1.6,
          'stroke-dasharray': m.fill ? null : '2.2 1.8',
          'data-gsc-mark': s.id, 'data-year': p.x, 'data-kind': p.row.kind,
          'data-partial': p.row.partial ? 'true' : 'false',
        });
        const ttl = svgEl('title');
        ttl.textContent = `${s.label} · ${p.x} · ${fmt.money(p.v, 2)}/MWh · ${KIND_WORD[p.row.kind] || p.row.kind}` +
          (p.row.kind === 'escalated' ? ` (${ESC_NOTE})` : p.row.hours != null ? ` · ${fmt.int(p.row.hours)} h` : '');
        node.appendChild(ttl);
        g.appendChild(node);
        hits.push({ X, Y, p, s });
        /* a partial year carries its hours on the mark, not in a footnote */
        if (p.row.partial && p.row.hours != null) {
          const t = svgEl('text', { class: 'gsc-ax', x: X, y: Y - 9, 'text-anchor': 'middle', fill: s.colour });
          t.textContent = `${fmt.int(p.row.hours)} h`; g.appendChild(t);
        }
      });
      /* the series name at its right end — no legend hunt */
      const last = pts.filter(p => p.v != null).pop();
      if (last) {
        const t = svgEl('text', { class: 'gsc-axl', x: sx(last.x) + 7, y: sy(last.v) + 3, fill: s.colour });
        t.textContent = s.label; g.appendChild(t);
      }
      svg.appendChild(g);
    });
    host.appendChild(svg);
    return { svg, hits, geom: { W, Hh, P, sx, sy, lo, hi } };
  }

  /* ── 2 · the month × hour surface, canvas ───────────────────────────────── */
  function heatCanvas(host, cells, opt) {
    bump();
    const wrap = el('div', 'gsc-cvwrap');
    const cv = document.createElement('canvas');
    cv.className = 'gsc-cv'; cv.setAttribute('data-gsc-chart', opt.id);
    wrap.appendChild(cv); host.appendChild(wrap);

    const W = Math.max(320, host.clientWidth || 640);
    const P = { l: 30, r: 8, t: 8, b: 20 };
    const rows = 24, cols = 12;
    const cw = (W - P.l - P.r) / cols;
    const ch = clamp(opt.cellH || 13, 9, 20);
    const Hh = P.t + P.b + rows * ch;
    /* devicePixelRatio, not 1: at 125% a 1× canvas is the blurry-grid defect */
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    cv.style.width = '100%'; cv.style.height = Hh + 'px';
    const g = cv.getContext('2d'); g.scale(dpr, dpr);

    const vals = cells.filter(v => v != null);
    if (!vals.length) { host.removeChild(wrap); host.appendChild(emptyBox('No hourly run at this scope',
      opt.why || 'The store holds no month × hour block here.')); return null; }
    /* orchestrator 2026-09-28 lmp continuous: History vs forecast surfaces share one colour scale */
    const lo = opt.range ? opt.range[0] : Math.min(...vals), hi = opt.range ? opt.range[1] : Math.max(...vals);
    const ramp = [1, 2, 3, 4, 5, 6, 7].map(i => tok(`--gsc-heat-${i}`, host));
    const inkD = tok('--gsc-cell-ink-dark', host), inkL = tok('--gsc-cell-ink-light', host);
    const inks = ramp.map(c => lumOf(c) > 0.45 ? inkD : inkL);
    const stop = v => clamp(Math.floor((v - lo) / ((hi - lo) || 1) * ramp.length), 0, ramp.length - 1);
    const axis = tok('--ink-4', host), line = tok('--border', host);

    g.font = '11px ui-monospace, monospace'; g.textBaseline = 'middle';
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    for (let m = 0; m < cols; m++) for (let h = 0; h < rows; h++) {
      const v = cells[m * 24 + h];
      const X = P.l + m * cw, Y = P.t + (rows - 1 - h) * ch;
      if (v == null) { g.fillStyle = line; g.fillRect(X, Y, cw - 0.5, ch - 0.5); continue; }
      const si = stop(v);
      g.fillStyle = ramp[si]; g.fillRect(X, Y, cw - 0.5, ch - 0.5);
      if (cw >= 30 && ch >= 11) {
        g.fillStyle = inks[si]; g.textAlign = 'center';
        g.fillText(String(Math.round(v)), X + cw / 2, Y + ch / 2 + 0.5);
      }
    }
    g.fillStyle = axis; g.textAlign = 'right';
    for (let h = 0; h < rows; h += 2) g.fillText('HE ' + (h + 1), P.l - 4, P.t + (rows - 1 - h) * ch + ch / 2);
    g.textAlign = 'center';
    for (let m = 0; m < cols; m++) g.fillText(MON[m], P.l + m * cw + cw / 2, Hh - P.b / 2);

    const geom = { P, cw, ch, rows, cols, lo, hi, cells, Hh, W };
    return { wrap, cv, geom, lo, hi, ramp };
  }

  /* ── 3 · the duration curve, canvas ─────────────────────────────────────── */
  function durationCanvas(host, series, opt) {
    bump();
    const wrap = el('div', 'gsc-cvwrap');
    const cv = document.createElement('canvas');
    cv.className = 'gsc-cv'; cv.setAttribute('data-gsc-chart', opt.id);
    wrap.appendChild(cv); host.appendChild(wrap);

    const W = Math.max(320, host.clientWidth || 640), Hh = opt.height || 280;
    const P = { l: 52, r: 12, t: 24, b: 26 };   /* orchestrator 2026-09-28 lmp continuous: a header row for the unit, clear of the top tick */
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    cv.style.width = '100%'; cv.style.height = Hh + 'px';
    const g = cv.getContext('2d'); g.scale(dpr, dpr);

    const all = series.flatMap(s => s.value).filter(v => v != null);
    if (!all.length) { host.removeChild(wrap); host.appendChild(emptyBox('No duration curve at this scope',
      'The store holds no percentile block for the selected scenarios at this scope and market.')); return null; }
    const dax = niceAxis(Math.min(0, Math.min(...all)), Math.max(...all), 5), lo = dax.lo, hi = dax.hi;
    const sx = p => P.l + p / 100 * (W - P.l - P.r);
    const sy = v => Hh - P.b - (v - lo) / ((hi - lo) || 1) * (Hh - P.t - P.b);
    const gridC = tok('--grid-line', host), axisC = tok('--axis', host), ink = tok('--ink-4', host);

    g.strokeStyle = gridC; g.lineWidth = 1; g.font = '11px ui-monospace, monospace';
    g.fillStyle = ink; g.textBaseline = 'middle';
    dax.ticks.forEach(v => {
      const Y = Math.round(sy(v)) + 0.5;
      g.beginPath(); g.moveTo(P.l, Y); g.lineTo(W - P.r, Y); g.stroke();
      g.textAlign = 'right'; g.fillText(tickFmt(v, dax), P.l - 6, Y);
    });
    cv.setAttribute('data-gsc-ticks', dax.ticks.join(','));
    g.textAlign = 'center'; g.textBaseline = 'top';
    [0, 10, 25, 50, 75, 90, 100].forEach(p => {
      const X = Math.round(sx(p)) + 0.5;
      g.strokeStyle = gridC; g.beginPath(); g.moveTo(X, P.t); g.lineTo(X, Hh - P.b); g.stroke();
      g.fillText(p + '%', X, Hh - P.b + 5);
    });
    g.strokeStyle = axisC; g.beginPath(); g.moveTo(P.l, Hh - P.b + 0.5); g.lineTo(W - P.r, Hh - P.b + 0.5); g.stroke();
    if (lo < 0) { const Y = Math.round(sy(0)) + 0.5; g.beginPath(); g.moveTo(P.l, Y); g.lineTo(W - P.r, Y); g.stroke(); }

    series.forEach(s => {
      /* orchestrator 2026-09-28 lmp continuous: richest first (a stored percentile p sits at 100 − p, the
         share of hours at or above it — the block is ascending), a forecast run dashed */
      g.strokeStyle = s.colour; g.lineWidth = 1.8; g.setLineDash(s.dash ? [6, 4] : []); g.beginPath();
      let started = false;
      s.pct.forEach((p, i) => {
        const v = s.value[i]; if (v == null) { started = false; return; }
        const X = sx(100 - p), Y = sy(v);
        if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
      });
      g.stroke(); g.setLineDash([]);
    });
    g.textBaseline = 'alphabetic'; g.textAlign = 'left';
    g.fillStyle = ink; g.font = '11px ui-sans-serif, system-ui'; g.fillText(opt.unit || '$/MWh', 6, 14);
    return { wrap, cv, geom: { P, sx, sy, lo, hi, W, Hh } };
  }

  /* ── 3b · the hourly series at a full-depth bus, canvas ─────────────────── */
  const ZOOM = [
    { k: 'day', label: 'Day', n: 24 },
    { k: 'week', label: 'Week', n: 168 },
    { k: 'month', label: 'Month', n: 730 },
    { k: 'year', label: 'Year', n: 8784 },
  ];
  const zoomOf = k => ZOOM.find(z => z.k === k) || ZOOM[1];
  /** 8,760 points on an SVG is 8,760 nodes; on a canvas it is one pass. When a
   *  window holds more hours than the chart holds pixels the band drawn is the
   *  min-to-max of the hours in that column with the mean over it, so a spike
   *  is never quietly averaged away — the defect a naive decimation produces. */
  function hourlyCanvas(host, runs, opt) {
    bump();
    const wrap = el('div', 'gsc-cvwrap');
    const cv = document.createElement('canvas');
    cv.className = 'gsc-cv'; cv.setAttribute('data-gsc-chart', opt.id);
    wrap.appendChild(cv); host.appendChild(wrap);
    const W = Math.max(340, host.clientWidth || 720), Hh = opt.height || 260;
    const P = { l: 54, r: 12, t: 24, b: 26 };
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr);
    cv.style.width = '100%'; cv.style.height = Hh + 'px';
    const g = cv.getContext('2d'); g.scale(dpr, dpr);

    const from = opt.from, to = opt.to;
    const slices = runs.map(r => ({ r, v: r.values.slice(from, to) }));
    const all = slices.flatMap(s => s.v).filter(v => v != null);
    if (!all.length) { host.removeChild(wrap); host.appendChild(emptyBox('No hours in this window',
      'Move the window, or widen it — the series holds no value over these hours.')); return null; }
    const hax = niceAxis(Math.min(0, Math.min(...all)), Math.max(...all), 4), lo = hax.lo, hi = hax.hi;
    const plotW = W - P.l - P.r, n = to - from;
    const sx = i => P.l + (i / Math.max(1, n - 1)) * plotW;
    const sy = v => Hh - P.b - (v - lo) / ((hi - lo) || 1) * (Hh - P.t - P.b);
    const gridC = tok('--grid-line', host), axisC = tok('--axis', host), ink = tok('--ink-4', host);

    g.strokeStyle = gridC; g.lineWidth = 1; g.font = '11px ui-monospace, monospace';
    g.fillStyle = ink; g.textBaseline = 'middle'; g.textAlign = 'right';
    hax.ticks.forEach(v => {
      const Y = Math.round(sy(v)) + 0.5;
      g.beginPath(); g.moveTo(P.l, Y); g.lineTo(W - P.r, Y); g.stroke();
      g.fillText(tickFmt(v, hax), P.l - 6, Y);
    });
    cv.setAttribute('data-gsc-ticks', hax.ticks.join(','));
    g.strokeStyle = axisC; g.beginPath(); g.moveTo(P.l, Math.round(sy(0)) + 0.5); g.lineTo(W - P.r, Math.round(sy(0)) + 0.5); g.stroke();

    const perPx = n / plotW;
    slices.forEach(s => {
      g.strokeStyle = s.r.colour; g.fillStyle = s.r.colour;
      if (perPx > 1.4) {
        /* the envelope, then the mean over it */
        g.globalAlpha = .34; g.beginPath();
        for (let px = 0; px < plotW; px++) {
          const a = Math.floor(px * perPx), b = Math.min(n, Math.ceil((px + 1) * perPx));
          let mn = Infinity, mx = -Infinity;
          for (let i = a; i < b; i++) { const v = s.v[i]; if (v == null) continue; if (v < mn) mn = v; if (v > mx) mx = v; }
          if (mn === Infinity) continue;
          g.moveTo(P.l + px + 0.5, sy(mn)); g.lineTo(P.l + px + 0.5, sy(mx));
        }
        g.stroke(); g.globalAlpha = 1;
        g.lineWidth = 1.2; g.setLineDash(isSettled(s.r.id) ? [] : [6, 4]); g.beginPath(); let started = false;   /* orchestrator 2026-09-28 lmp continuous: a run's mean line dashed */
        for (let px = 0; px < plotW; px++) {
          const a = Math.floor(px * perPx), b = Math.min(n, Math.ceil((px + 1) * perPx));
          let sum = 0, c = 0;
          for (let i = a; i < b; i++) { const v = s.v[i]; if (v != null) { sum += v; c++; } }
          if (!c) { started = false; continue; }
          const X = P.l + px + 0.5, Y = sy(sum / c);
          if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
        }
        g.stroke();
      } else {
        g.lineWidth = 1.4; g.setLineDash(isSettled(s.r.id) ? [] : [6, 4]); g.beginPath(); let started = false;
        for (let i = 0; i < n; i++) {
          const v = s.v[i]; if (v == null) { started = false; continue; }
          const X = sx(i), Y = sy(v);
          if (!started) { g.moveTo(X, Y); started = true; } else g.lineTo(X, Y);
        }
        g.stroke();
      }
      g.setLineDash([]);
    });
    g.fillStyle = ink; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = '11px ui-sans-serif, system-ui'; g.fillText(opt.unit || '$/MWh', 6, 14);
    g.font = '11px ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
    const ticks = Math.min(8, Math.max(2, Math.floor(plotW / 110)));
    for (let t = 0; t <= ticks; t++) {
      const i = Math.round(t * (n - 1) / ticks);
      g.fillText(opt.labelAt(from + i), clamp(sx(i), P.l + 18, W - P.r - 18), Hh - P.b + 5);
    }
    return { wrap, cv, geom: { P, sx, sy, W, Hh, n, from, plotW }, slices };
  }

  /* ── 4 · stacked columns, SVG (make-up, generation) ─────────────────────── */
  function stackChart(host, cfg) {
    bump();
    const W = Math.max(340, host.clientWidth || 720), Hh = cfg.height || 300;
    const P = { l: 54, r: cfg.labelRight ? 108 : 12, t: 24, b: 26 };
    const xs = cfg.x;
    if (!xs.length) { host.appendChild(emptyBox(cfg.emptyTitle || 'Nothing to stack here', cfg.emptyWhy || '')); return null; }
    const tot = xs.map((_, i) => cfg.series.reduce((a, s) => a + Math.max(0, s.v[i] || 0), 0));
    const neg = xs.map((_, i) => cfg.series.reduce((a, s) => a + Math.min(0, s.v[i] || 0), 0));
    const sax = niceAxis(Math.min(0, ...neg), Math.max(1, ...tot), 4), hi = sax.hi, lo = sax.lo;
    const bw = (W - P.l - P.r) / xs.length;
    const sy = v => Hh - P.b - (v - lo) / ((hi - lo) || 1) * (Hh - P.t - P.b);

    const svg = svgEl('svg', { class: 'gsc-svg', viewBox: `0 0 ${W} ${Hh}`, height: Hh,
      role: 'img', 'aria-label': cfg.aria || 'Stacked by category' });
    svg.setAttribute('data-gsc-chart', cfg.id);
    sax.ticks.forEach(v => {
      const y = sy(v);
      svg.appendChild(svgEl('line', { class: 'gsc-grid', x1: P.l, x2: W - P.r, y1: y, y2: y }));
      const t = svgEl('text', { class: 'gsc-ax', x: P.l - 6, y: y + 3, 'text-anchor': 'end', 'data-gsc-tick': v });
      t.textContent = tickFmt(v, sax); svg.appendChild(t);
    });
    const yl = svgEl('text', { class: 'gsc-axl', x: 4, y: 11 }); yl.textContent = cfg.unit || '';
    svg.appendChild(yl);
    svg.appendChild(svgEl('line', { class: 'gsc-axis', x1: P.l, x2: W - P.r, y1: sy(0), y2: sy(0) }));

    const hits = [];
    const ghost = cfg.ghost || [];
    xs.forEach((x, i) => {
      /* a category the store has no run for is a NAMED empty column, not a
         zero bar and never an escalated one: the reader must be able to see
         that the axis reaches there and that nothing solved it */
      if (ghost.includes(x)) {
        const gx = P.l + i * bw + 1.5, gw = Math.max(2, bw - 3);
        svg.appendChild(svgEl('rect', { x: gx, y: P.t, width: gw, height: Math.max(2, sy(0) - P.t),
          fill: 'none', stroke: 'currentColor', 'stroke-opacity': .32, 'stroke-dasharray': '3 3',
          'data-gsc-ghost': x }));
        const t = svgEl('text', { class: 'gsc-ax', x: gx + gw / 2, y: (P.t + sy(0)) / 2,
          'text-anchor': 'middle', transform: `rotate(-90 ${gx + gw / 2} ${(P.t + sy(0)) / 2})` });
        t.textContent = cfg.ghostLabel || 'no run';
        svg.appendChild(t);
        const lab = svgEl('text', { class: 'gsc-ax', x: P.l + i * bw + bw / 2, y: Hh - P.b + 14, 'text-anchor': 'middle' });
        lab.textContent = String(x); svg.appendChild(lab);
        return;
      }
      let up = 0, dn = 0;
      cfg.series.forEach((s, si) => {
        const v = s.v[i]; if (v == null || v === 0) return;
        const y0 = v > 0 ? up : dn, y1 = y0 + v;
        const top = sy(Math.max(y0, y1)), bot = sy(Math.min(y0, y1));
        const r = svgEl('rect', { x: P.l + i * bw + 0.6, y: top, width: Math.max(1, bw - 1.2), height: Math.max(0.6, bot - top),
          fill: s.colour, 'data-gsc-band': s.label, 'data-x': x,
          'fill-opacity': cfg.hollow && cfg.hollow(x, s) ? 0.32 : 1,
          stroke: cfg.hollow && cfg.hollow(x, s) ? s.colour : 'none',
          'stroke-dasharray': cfg.hollow && cfg.hollow(x, s) ? '3 2' : null, 'stroke-width': 1 });
        const ttl = svgEl('title');
        ttl.textContent = `${x} · ${s.label} · ${cfg.fmtV ? cfg.fmtV(v) : fmt.num(v, 1)}` +
          (cfg.basisAt ? ` · basis ${cfg.basisAt(x, s) || '—'}` : '');
        r.appendChild(ttl); svg.appendChild(r);
        hits.push({ x, s, v, cx: P.l + i * bw + bw / 2, cy: (top + bot) / 2 });
        if (v > 0) up = y1; else dn = y1;
      });
      if (xs.length <= 34 || i % Math.ceil(xs.length / 24) === 0) {
        const t = svgEl('text', { class: 'gsc-ax', x: P.l + i * bw + bw / 2, y: Hh - P.b + 14, 'text-anchor': 'middle' });
        t.textContent = String(x); svg.appendChild(t);
      }
    });
    /* direct labels at the right edge: eight bands cannot clear a pairwise ΔE of
       15 in this token set, so the reader never has to match a hue to a legend.
       The anchor is the last column that HAS bands — a ghost column would put
       every label at zero. */
    if (cfg.labelRight) {
      let last = xs.length - 1;
      while (last > 0 && ghost.includes(xs[last])) last--;
      let up = 0;
      const ends = cfg.series.map(s => { const v = Math.max(0, s.v[last] || 0); const mid = up + v / 2; up += v; return { s, v, mid }; })
        .filter(e => e.v > 0).map(e => ({ e, y: sy(e.mid) }));
      /* Thin bands sit within a pixel or two of each other and their labels
         overprint — four names on one line, which is worse than no label. The
         labels are pushed apart to a legible pitch, top-down then bottom-up so
         the block stays inside the plot, and a leader line keeps each tied to
         the band it names. */
      /* continuum fix 2026-10-06 (D12): spread to a guaranteed pitch inside the plot, then draw —
         the old push-then-clamp let "Landfill Gas" and "Coal" print on one line at the top */
      const PITCH = 12, top = P.t + 5, bot = Hh - P.b - 2;
      ends.sort((a, b) => a.y - b.y);
      const spread = spreadLabels(ends.map(x => x.y), top, bot, PITCH);
      ends.forEach((x, i) => { x.y = spread[i]; });
      ends.forEach(({ e, y }) => {
        const yy = y, band = sy(e.mid);
        if (Math.abs(yy - band) > 2.5) svg.appendChild(svgEl('polyline', {
          points: `${W - P.r - 1},${band} ${W - P.r + 2},${yy} ${W - P.r + 4},${yy}`,
          fill: 'none', stroke: e.s.colour, 'stroke-width': 0.8, 'stroke-opacity': .7 }));
        const t = svgEl('text', { class: 'gsc-axl', x: W - P.r + 6, y: yy + 3, fill: e.s.colour, 'data-gsc-endlabel': e.s.label });
        t.textContent = e.s.label; svg.appendChild(t);
      });
    }
    host.appendChild(svg);
    return { svg, hits, geom: { W, Hh, P, bw, sy } };
  }

  /* ── 5 · grouped bars, SVG (spreads, negative hours, capacity, gas) ─────── */
  function barsChart(host, cfg) {
    bump();
    const W = Math.max(320, host.clientWidth || 640), Hh = cfg.height || 260;
    const P = { l: 54, r: 12, t: 24, b: 40 };
    const xs = cfg.x, gs = cfg.series;
    if (!xs.length || !gs.length) { host.appendChild(emptyBox(cfg.emptyTitle || 'Nothing to chart here', cfg.emptyWhy || '')); return null; }
    const all = gs.flatMap(s => s.v).filter(v => v != null);
    const bax = niceAxis(Math.min(0, ...all), Math.max(1, ...all), 4), hi = bax.hi, lo = bax.lo;
    const bw = (W - P.l - P.r) / xs.length, iw = (bw - 4) / gs.length;
    const sy = v => Hh - P.b - (v - lo) / ((hi - lo) || 1) * (Hh - P.t - P.b);
    const svg = svgEl('svg', { class: 'gsc-svg', viewBox: `0 0 ${W} ${Hh}`, height: Hh,
      role: 'img', 'aria-label': cfg.aria || 'By year' });
    svg.setAttribute('data-gsc-chart', cfg.id);
    bax.ticks.forEach(v => {
      const y = sy(v);
      svg.appendChild(svgEl('line', { class: 'gsc-grid', x1: P.l, x2: W - P.r, y1: y, y2: y }));
      const t = svgEl('text', { class: 'gsc-ax', x: P.l - 6, y: y + 3, 'text-anchor': 'end', 'data-gsc-tick': v });
      t.textContent = tickFmt(v, bax); svg.appendChild(t);
    });
    const yl = svgEl('text', { class: 'gsc-axl', x: 4, y: 11 }); yl.textContent = cfg.unit || '';
    svg.appendChild(yl);
    svg.appendChild(svgEl('line', { class: 'gsc-axis', x1: P.l, x2: W - P.r, y1: sy(0), y2: sy(0) }));
    xs.forEach((x, i) => {
      gs.forEach((s, j) => {
        const v = s.v[i]; if (v == null) return;
        const X = P.l + i * bw + 2 + j * iw;
        const top = sy(Math.max(0, v)), bot = sy(Math.min(0, v));
        const r = svgEl('rect', { x: X, y: top, width: Math.max(1, iw - 1), height: Math.max(0.8, bot - top),
          fill: cfg.hollow && cfg.hollow(x, s) ? 'none' : s.colour, stroke: s.colour,
          'stroke-width': cfg.hollow && cfg.hollow(x, s) ? 1.3 : 0,
          'stroke-dasharray': cfg.hollow && cfg.hollow(x, s) ? '3 2' : null,
          'data-gsc-bar': s.label, 'data-x': x });
        const ttl = svgEl('title'); ttl.textContent = `${x} · ${s.label} · ${cfg.fmtV ? cfg.fmtV(v) : fmt.num(v, 1)}`;
        r.appendChild(ttl); svg.appendChild(r);
      });
      const t = svgEl('text', { class: 'gsc-ax', x: P.l + i * bw + bw / 2, y: Hh - P.b + 14, 'text-anchor': 'middle' });
      t.textContent = String(x);
      if (xs.length > 14) { t.setAttribute('transform', `rotate(-40 ${P.l + i * bw + bw / 2} ${Hh - P.b + 14})`); t.setAttribute('text-anchor', 'end'); }
      svg.appendChild(t);
    });
    host.appendChild(svg);
    return { svg, geom: { W, Hh, P, bw } };   /* orchestrator 2026-09-28 lmp continuous: geom for the divider */
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Panels, tables, empty states
     ═══════════════════════════════════════════════════════════════════════ */
  function emptyBox(title, why) {
    const d = el('div', 'gsc-empty');
    d.appendChild(el('b', null, title));
    d.appendChild(el('p', null, why));
    return d;
  }

  /** The hours chip. The block carries `hours` (what was read), `calendar_hours`
   *  (what the calendar holds) and `calendar_basis` (why they differ: a settled
   *  year is 8,759 local hour labels, a solved one a flat 8,760). Reporting the
   *  first alone makes a settled year look short by an hour for no stated
   *  reason, so all three travel together. */
  function hoursChip(rows) {
    const hs = uniq(rows.map(r => r.hours).filter(v => v != null));
    if (!hs.length) return 'none — no hourly run behind these rows';
    const cal = uniq(rows.map(r => r.calendar_hours).filter(v => v != null));
    const basis = uniq(rows.map(r => r.calendar_basis).filter(Boolean));
    let out = hs.sort((a, b) => a - b).map(fmt.int).join(' / ');
    if (cal.length && cal.join() !== hs.join()) out += ` read of ${cal.sort((a, b) => a - b).map(fmt.int).join(' / ')} on the calendar`;
    if (basis.length) out += ` · ${basis.join('; ')}`;
    return out;
  }

  /** the face line every chart carries: scope, scenario, market, hours, kind */
  function faceLine(parts, capeWord) {
    const f = el('div', 'gsc-face');
    parts.filter(Boolean).forEach(([k, v]) => {
      const s = el('span'); s.innerHTML = `<b>${esc(k)}</b> ${esc(String(v))}`; f.appendChild(s);
    });
    /* Cape 2028 basis: ext/76's badge (gsp-cape), in ext/76's words */
    if (capeWord) { const b = el('span', 'badge gsp-cape'); b.setAttribute('data-gsc-cape', '2028'); b.textContent = capeWord; f.appendChild(b); }
    return f;
  }

  /** orchestrator 2026-09-28 sign fix: a panel that draws the PROBE 5-year run at a bus the run's
   *  Cape input case sets names that case (ext/05 GSX_RUNSIGN) — a flag, never a changed value. */
  function inputFlag(p) {
    const RS = window.GSX_RUNSIGN, s = scope();
    if (!RS || s.kind !== 'bus' || p.querySelector('[data-gsc-input]')) return;
    const f = RS.cape(s.key); if (!f || !/PROBE 5-year|\b5yr\b/.test(p.textContent || '')) return;
    const n = el('div', 'gsc-note gsc-flag'); n.setAttribute('data-gsc-input', '5yr'); n.textContent = RS.text(f); n.title = n.textContent; p.appendChild(n);   // S-nav: one line, the full sentence on hover
  }

  /** one panel. `draw(body)` paints it; `table()` returns {cols, rows} built
   *  from the SAME array the chart drew — never a second pass over the data. */
  function panel(cfg) {
    const p = el('div', 'gsc-panel' + (cfg.wide ? ' gsc-wide' : ''));
    p.setAttribute('data-gsc-panel', cfg.id);
    if (cfg.sig) p.setAttribute('data-gsc-sig', cfg.sig);   // S-nav 2026-10-07: the duplicate-chart audit's signature
    const h = el('div', 'gsc-h');
    const t = el('h3', null, cfg.title); t.id = 'gsc-h-' + cfg.id; h.appendChild(t);
    const ctl = el('div', 'gsc-ctl');
    (cfg.controls || []).forEach(c => c && ctl.appendChild(c));
    /* S-nav 2026-10-07 (SKL-091): the method and the caveats sit behind (i); the face keeps one line */
    let noteEl = null;
    if (cfg.note || cfg.basisNote) {
      const ib = el('button', 'gsc-btn gsc-i', 'i'); ib.type = 'button';
      ib.setAttribute('data-gsc-info', cfg.id); ib.setAttribute('aria-label', 'Show method and notes');
      const open = INFO_OPEN.has(cfg.id);
      ib.setAttribute('aria-expanded', open ? 'true' : 'false'); ib.title = 'Show method and notes';
      ib.onclick = () => {
        const on = !INFO_OPEN.has(cfg.id); if (on) INFO_OPEN.add(cfg.id); else INFO_OPEN.delete(cfg.id);
        ib.setAttribute('aria-expanded', on ? 'true' : 'false');
        p.querySelectorAll('.gsc-method').forEach(n => { n.hidden = !on; });
      };
      ctl.appendChild(ib);
      noteEl = open;
    }
    const tbl = cfg.table;
    if (tbl && !cfg.tableOnly) {
      const b = el('button', 'gsc-btn'); b.type = 'button';
      b.setAttribute('data-gsc-table', cfg.id);
      const on = !!ST.tables[cfg.id];
      b.innerHTML = icon('table') + (on ? 'Show chart' : 'Show table');
      b.title = on ? 'Back to the chart' : 'The same array the chart draws, as a table';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.onclick = () => { ST.tables[cfg.id] = !ST.tables[cfg.id]; store(); paint(); };
      ctl.appendChild(b);
    }
    if (cfg.csv) {
      const b = el('button', 'gsc-btn'); b.type = 'button'; b.setAttribute('data-gsc-csv', cfg.id);
      b.innerHTML = icon('download') + 'Download CSV';
      b.title = 'Download the rows behind this panel, exactly as shown';
      b.onclick = () => exportCsv(cfg.id);
      ctl.appendChild(b);
    }
    h.appendChild(ctl);
    p.appendChild(h);
    if (cfg.face) { p.appendChild(cfg.face); if (!cfg.face.title) cfg.face.title = cfg.face.textContent; }
    if (cfg.answer) { const a = el('div', 'gsc-answer'); a.setAttribute('data-gsc-answer', cfg.id); a.textContent = cfg.answer; p.appendChild(a); }
    const body = el('div', 'gsc-body'); body.setAttribute('data-gsc-body', cfg.id);
    p.appendChild(body);
    if (cfg.note) { const n = el('div', 'gsc-note gsc-method'); n.innerHTML = cfg.note; n.hidden = !noteEl; p.appendChild(n); }
    if (cfg.basisNote) { const n = el('div', 'gsc-note gsc-method'); n.setAttribute('data-gsc-basis', '2028'); n.textContent = cfg.basisNote; n.hidden = !noteEl; p.appendChild(n); }   // Cape 2028 basis
    /* the body is painted after layout so every chart reads its real width —
       a chart sized before its container exists is the fixed-aspect defect */
    PENDING.push(() => {
      try {
        if (tbl && (cfg.tableOnly || ST.tables[cfg.id])) renderTable(body, tbl());
        else cfg.draw(body);
        inputFlag(p);   // orchestrator 2026-09-28 sign fix
      } catch (e) {
        body.innerHTML = '';
        body.appendChild(emptyBox('This panel could not be drawn',
          `${(e && e.message) || e}. The rest of the screen is unaffected; nothing from a previous selection is left on screen.`));
        console.warn('[cathy] panel ' + cfg.id + ': ' + ((e && e.message) || e));
      }
    });
    if (tbl) EXPORTS[cfg.id] = { title: cfg.title, table: tbl, face: cfg.faceText || '' };
    return p;
  }

  function renderTable(host, t) {
    host.innerHTML = '';
    if (!t || !t.rows.length) { host.appendChild(emptyBox('No rows at this selection', t && t.why || 'Nothing is held here.')); return; }
    const sc = el('div', 'gsc-scroll');
    const tb = el('table', 'gsc-tbl');
    const th = el('thead'), tr = el('tr');
    t.cols.forEach(c => { const x = el('th', null, c.l); if (c.t) x.title = c.t; tr.appendChild(x); });
    th.appendChild(tr); tb.appendChild(th);
    const bd = el('tbody');
    t.rows.forEach(r => {
      const x = el('tr');
      t.cols.forEach((c, i) => {
        const td = el('td', i === 0 ? 't' : null);
        const v = r[i];
        td.textContent = v == null ? '—' : String(v);
        x.appendChild(td);
      });
      bd.appendChild(x);
    });
    tb.appendChild(bd); sc.appendChild(tb); host.appendChild(sc);
    const cap = el('div', 'gsc-note', `${fmt.int(t.rows.length)} rows — the same array the chart draws, never a second query.`);
    host.appendChild(cap);
  }

  /* work queued until after the screen is in the document */
  const INFO_OPEN = new Set();   // S-nav 2026-10-07: panels whose (i) the reader opened, kept across repaints
  let PENDING = [];
  let EXPORTS = {};

  /* ═══════════════════════════════════════════════════════════════════════
     Hover — a DOM readout, never a redraw
     ═══════════════════════════════════════════════════════════════════════ */
  function wireHover(body, find) {
    const tip = el('div', 'gsc-hover'); body.appendChild(tip);
    const cross = el('div', 'gsc-cross'); body.appendChild(cross);
    let raf = null, last = null;
    body.addEventListener('mousemove', ev => {
      COUNT.hovers++;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const r = body.getBoundingClientRect();
        const hit = find(ev.clientX - r.left, ev.clientY - r.top, r);
        if (!hit) { tip.classList.remove('on'); cross.classList.remove('on'); last = null; return; }
        if (last !== hit.key) { tip.textContent = hit.text; last = hit.key; }
        tip.style.left = clamp(hit.x + 12, 2, Math.max(2, r.width - 250)) + 'px';
        tip.style.top = clamp(hit.y - 26, 2, Math.max(2, r.height - 26)) + 'px';
        tip.classList.add('on');
        if (hit.cross != null) {
          cross.style.left = hit.cross + 'px'; cross.style.top = '0px';
          cross.style.height = r.height + 'px'; cross.classList.add('on');
        } else cross.classList.remove('on');
      });
    });
    body.addEventListener('mouseleave', () => { tip.classList.remove('on'); cross.classList.remove('on'); last = null; });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Controls
     ═══════════════════════════════════════════════════════════════════════ */
  function seg(name, opts, current, onPick, title) {
    const g = el('div', 'gsc-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', name);
    g.setAttribute('data-gsc-seg', name.toLowerCase().replace(/\s+/g, '-'));
    opts.forEach(o => {
      const b = el('button', null, o.l); b.type = 'button';
      b.dataset.gscVal = String(o.v);
      b.setAttribute('aria-pressed', String(o.v) === String(current) ? 'true' : 'false');
      if (o.disabled) { b.disabled = true; b.title = o.why || 'Not held at this selection'; }
      else { if (title) b.title = title; b.onclick = () => onPick(o.v); }
      g.appendChild(b);
    });
    return g;
  }
  function toggle(label, on, onChange, title) {
    const l = el('label', 'gsc-toggle'); l.title = title || '';
    const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!on;
    i.setAttribute('data-gsc-toggle', label.toLowerCase().replace(/\s+/g, '-'));
    i.onchange = () => onChange(i.checked);
    l.appendChild(i); l.appendChild(el('span', null, label));
    return l;
  }
  const marketCtl = () => {
    const mk = marketsFor();
    return seg('Market', [
      { v: 'DA', l: 'DA', disabled: !mk.includes('DA'), why: 'No day-ahead series at this scope for the selected scenarios' },
      { v: 'RT', l: 'RT', disabled: !mk.includes('RT'), why: 'No real-time series at this scope for the selected scenarios' },
      { v: 'model', l: 'Model', disabled: !mk.includes('model'), why: 'No solved series at this scope for the selected scenarios' },
    ], market(), v => { ST.market = v; store(); paint(); }, 'Which market the figures are read from');
  };
  function yearCtl(years, cur, set, partial) {
    return seg('Year', years.map(y => ({ v: y, l: partial && partial(y) ? `${y}*` : String(y) })), cur, v => { set(+v); store(); paint(); },
      'The study year on the surface (* a part year)');
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Screen 1 · Price explorer
     ═══════════════════════════════════════════════════════════════════════ */
  /* orchestrator 2026-09-28 lmp continuous — the continuous panel: the settled record and ONE forecast
     path at the same scope, on one axis. Solid settled, dashed forecast, a "last settled" divider, and
     the run named in the legend. The run set is the Studio's one price basis by default (PROBE 5-year
     2028 · PCR 2030/2035/2040, 2045/2050 escalated from 2040 — what GS.priceAt reads; at a Cape-flagged
     bus 2028 is PCR 2030, see capeBasis), or the PCR runs
     alone, or the two PROBE runs. A run with no row at this scope is a break with its tick, never a
     line across. The scenario explorer below keeps overlaying whatever the strip selects. */
  const FC_SETS = {
    basis: { l: 'Solved run', years: [[2028, '5yr'], [2030, 'pcr2030'], [2035, 'pcr2035'], [2040, 'pcr2040']], esc: true },
    pcr: { l: 'PCR', years: [[2030, 'pcr2030'], [2035, 'pcr2035'], [2040, 'pcr2040']], esc: true },
    probe: { l: 'PROBE', years: [[2028, '5yr'], [2035, '10yr']], esc: false },
  };
  /* Cape 2028 basis (Ganesh 2026-09-28, studio/PRICE-BASIS.md): at a bus in run_input_flags.cape_5yr the one basis
     reads PCR 2030 for 2028 (GS.priceAt). The note comes from ext/76 (GS.priceBasisNote), so the words are its words.
     Only the one-basis set reads it; the PROBE set and the scenario explorer list the runs and keep the 5-year value. */
  function capeBasis(k) {
    const s = scope();
    if (k !== 'basis' || s.kind !== 'bus' || typeof GS.priceBasisNote !== 'function') return null;
    try { return GS.priceBasisNote(s.key, 2028) || null; } catch (e) { return null; }
  }
  function fcLabel(k, cape) {
    const set = FC_SETS[k] || FC_SETS.basis;
    const runs = set.years.map(([y, sid]) => cape && cape.applied && y === 2028 ? `${scenLabel('pcr2030')} used for 2028`
      : `${scenLabel(sid)}${/\d{4}/.test(scenLabel(sid)) ? '' : ' ' + y}`);
    return `${k === 'basis' ? 'Solved run (one basis) · ' : ''}${runs.join(' · ')}${set.esc ? ' · 2045/2050 escalated from 2040' : ''}`;
  }
  function continuousPanel(host) {
    const k = FC_SETS[ST.fcrun] ? ST.fcrun : 'basis', set = FC_SETS[k];
    const hm = marketsFor('hist'); const hmk = hm.includes(ST.market) ? ST.market : hm.includes('RT') ? 'RT' : hm[0] || 'RT';
    const settled = relSeries('hist', hmk);
    const cape = capeBasis(k);
    const path = [];
    set.years.forEach(([y, sid]) => {
      if (cape && cape.applied && y === 2028) {
        /* the one basis at 2028 is the PCR 2030 run as it is: GS.priceAt's value; hub-relative, the PCR 2030 row's basis */
        const r30 = relSeries('pcr2030', 'model').find(x => x.year === 2030);
        const pa = GS.priceAt(scope().key, 2028);
        /* continuum S0 2026-10-06: GS.priceAt is the Studio's Base; the scenario reaches the 2028 point here */
        const a28 = scenAdj('pcr2030', 2028, 'solved', scope().key);
        const v = ST.rel ? (r30 ? r30.mean : null) : (pa && pa.value != null ? pa.value * a28.f : null);
        path.push(Object.assign({ hours: null, partial: false }, r30 || {}, { year: 2028, mean: v, kind: 'solved', scenario: 'pcr2030', market: 'model', cape: true, runYear: 2030 },
          v == null ? { missing: true } : {}));
        return;
      }
      const r = relSeries(sid, 'model').find(x => x.year === y);
      path.push(r && r.mean != null ? r : { year: y, mean: null, kind: 'solved', scenario: sid, market: 'model', missing: true }); });
    if (set.esc) relSeries('pcr2040', 'model').filter(r => r.kind === 'escalated').forEach(r => path.push(r));
    /* continuum S0 2026-10-06: the legend and the price-basis note name the scenario the line is drawn at */
    const scWord = scenWord(path.some(r => r._scen) || (cape && cape.applied && scenOn() && scenAdj('pcr2030', 2028, 'solved', scope().key).applied));
    const label = fcLabel(k, cape) + scWord;
    const runName = r => r.cape ? `${scenLabel('pcr2030')} (used for 2028)` : scenLabel(r.scenario);
    const series = [
      { id: 'hist', label: `Settled (${MKT_WORD(hmk)})`, colour: tok('--gsc-sc-1', host), rows: settled, points: settled.map(r => ({ x: r.year, v: r.mean, row: r })) },
      { id: 'path', label: 'Forecast', colour: tok('--gsc-sc-2', host), dash: true, rows: path.filter(r => !r.missing),
        points: path.map(r => ({ x: r.year, v: r.mean, row: r })) },
    ];
    const gaps = path.filter(r => r.missing).map(r => `${r.year} (${runName(r)})`);
    const partial = settled.filter(r => r.partial);
    /* S-nav 2026-10-07: one answer line — the numbers the chart draws, no conclusion */
    const sv = settled.filter(r => r.mean != null), fv = path.filter(r => !r.missing && r.mean != null);
    const answer = `${sv.length ? `Settled ${MKT_WORD(hmk)} ${sv[0].year}–${sv[sv.length - 1].year}: ${fmt.money(Math.min(...sv.map(r => r.mean)), 2)} to ${fmt.money(Math.max(...sv.map(r => r.mean)), 2)}` : 'No settled year held'}` +
      ` · forecast ${fv.length ? fv.map(r => `${r.year} ${fmt.money(r.mean, 2)}`).join(' · ') : 'not held'} ($/MWh)`;
    const tableRows = series.flatMap(sr => sr.rows.map(r => [sr.id === 'hist' ? scenLabel('hist') : runName(r), r.year,
      sr.id === 'hist' ? hmk : 'model', r.mean == null ? null : fmt.num(r.mean, 2), r.hours == null ? null : fmt.int(r.hours), KIND_WORD[r.kind] || r.kind, r.partial ? 'yes' : 'no']));
    let chart = null;
    return panel({
      id: 'continuous', wide: true, title: `Price by year · ${scopeShort()}`, answer,
      sig: CORE() ? CORE().sig('lmp', 'annual 2020–2050', 'settled + solved') : null,
      face: faceLine([
        ['scope', `ISO-NE · ${scopeLabel()}`], depthFace(),
        ['settled', `${scenLabel('hist')} at ${MKT_WORD(hmk)}`],
        ['forecast', label],
        ['hours', hoursChip(settled)],
        ST.rel ? ['basis', `relative to ${hubLabel()}`] : null,
      ], cape && cape.applied ? cape.word : null),
      faceText: `ISO-NE | ${scopeLabel()} | settled ${hmk} + ${label}${ST.rel ? ` | relative to ${hubLabel()}` : ''}${cape ? ` | ${cape.word}` : ''}`,
      controls: [
        seg('Forecast run', Object.keys(FC_SETS).map(x => ({ v: x, l: FC_SETS[x].l })), k, v => { ST.fcrun = v; store(); paint(); },
          'Which forecast the settled record is drawn against: the one price basis (the run each year reads), the PCR runs alone, or the two PROBE price-curve runs'),
        overlayToggle(),   // S-nav 2026-10-07: the scenario explorer is this chart's overlay, not a second chart
      ],
      csv: true,
      table: () => ({ cols: [{ l: 'Series' }, { l: 'Year' }, { l: 'Market' }, { l: ST.rel ? 'Basis $/MWh' : 'Mean $/MWh' }, { l: 'Hours' }, { l: 'Kind' }, { l: 'Partial' }],
        rows: tableRows, why: 'Neither a settled year nor a forecast anchor is held at this scope.' }),
      note: [`Solid: settled ${esc(MKT_WORD(hmk))}. Dashed: <b>${esc(label)}</b> — one mark per run year, the model price. The two never join: 2027 is held by nothing, and the divider marks the last settled year.`,
        partial.length ? `${partial.map(r => `${r.year} is a part year (${fmt.int(r.hours)} h)`).join('; ')} — drawn larger and carrying its hours, compared by mean, never annualised.` : '',
        gaps.length ? `No row at this scope for ${esc(gaps.join(', '))}: the dashed line breaks there and a tick marks it.` : '',
        set.esc ? `2045 and 2050 are hollow and dashed: <b>${esc(ESC_NOTE)}</b>.` : ''].filter(Boolean).join(' '),
      basisNote: cape ? `Price basis: ${cape.text}${scWord ? ` These are Base figures; the line above is drawn at${scWord.replace(/^ ·/, '')}.` : ''}` : null,
      draw: body => {
        chart = explorerChart(body, series, { id: 'continuous', unit: ST.rel ? '$/MWh vs hub' : '$/MWh', signed: ST.rel, aria: `Settled and forecast price by year at ${scopeLabel()}` });
        const lg = el('div', 'gsc-lg'); lg.setAttribute('data-lmpc-legend', 'true'); lg.setAttribute('data-lmpc-run-label', label);
        [[series[0].colour, `Settled ${MKT_WORD(hmk)} ${settled.length ? settled[0].year + '–' + settled[settled.length - 1].year : ''}`, false], [series[1].colour, `Forecast · ${label}`, true]].forEach(([c, t, d]) => {
          const sp = el('span'); const i = document.createElement('i'); if (d) i.className = 'gsc-dash'; i.style.background = d ? 'none' : c; if (d) i.style.borderTopColor = c;
          sp.appendChild(i); sp.appendChild(el('span', null, t)); lg.appendChild(sp); });
        body.appendChild(lg);
        if (!chart) return;
        const { hits, geom } = chart;
        wireHover(body, (mx, my, rect) => {
          const scaleX = rect.width / geom.W; let best = null, bd = 1e9;
          hits.forEach(h => { const d = Math.abs(h.X * scaleX - mx); if (d < bd) { bd = d; best = h; } });
          if (!best || bd > 26) return null; const r = best.p.row;
          return { key: 'c' + best.s.id + ':' + best.p.x, x: best.X * scaleX, y: my, cross: best.X * scaleX,
            text: `${best.s.id === 'hist' ? 'Settled' : runName(r)} ${best.p.x} · ${fmt.money(best.p.v, 2)} · ${KIND_WORD[r.kind] || r.kind}${r.kind === 'escalated' ? ' · no hourly run' : r.hours != null ? ` · ${fmt.int(r.hours)} h` : ''}` };
        });
      },
    });
  }
  /** S-nav 2026-10-07: "Scenario overlay" — the runs the strip selects, drawn on the one price-by-year chart */
  function overlayToggle() {
    return toggle('Scenario overlay', ST.overlay, v => { ST.overlay = v; store(); paint(); },
      'Draw the runs the strip selects (up to three) on this chart instead of the one forecast path. The table behind it lists every figure the block holds, p5 to p95.');
  }
  function screenExplorer(host) {
    /* S-nav 2026-10-07 (Ganesh's no-duplicate rule): ONE price-by-year chart. The scenario explorer that used to sit
       under it drew the same series and is now its overlay; the year × scenario table is its table; hub-relative basis
       is the basis fan on Offtake. */
    if (ST.rel) { ST.rel = false; store(); }
    if (!ST.overlay) {
      host.appendChild(continuousPanel(host));
      host.appendChild(shownIn('wf:offtake', 'Node − hub basis by year', ''));
      return;
    }
    const mk = market(), ids = selected();
    const built = ids.map(id => {
      const own = marketFor(id) || mk;
      const rows = relSeries(id, own);
      return { id, market: own, label: `${scenLabel(id)} (${MKT_WORD(own)})${scenWord(rows.some(r => r._scen))}`,   // continuum S0 2026-10-06
        colour: scenColour(id, host), rows, dash: !isSettled(id),   /* orchestrator 2026-09-28 lmp continuous: a run is dashed */
        points: rows.map(r => ({ x: r.year, v: r.mean, row: r })) };
    });
    const mixed = uniq(built.map(b => b.market));
    const withRows = built.filter(b => b.rows.length);
    const kinds = uniq(built.flatMap(b => b.rows.map(r => r.kind)));
    const esc2 = built.some(b => b.rows.some(r => r.kind === 'escalated'));
    const gapYears = uniq(built.flatMap(b => b.rows.filter(r => r.mean == null).map(r => r.year)));

    const face = faceLine([
      ['scope', `ISO-NE · ${scopeLabel()}`],
      depthFace(),
      ['scenario', built.map(b => `${scenLabel(b.id)} at ${MKT_WORD(b.market)}`).join(' · ') || 'none held selected'],
      ['market', mixed.length > 1 ? `${mixed.map(MKT_WORD).join(' + ')} — each series at the market its run publishes` : (MKT_WORD(mk) || '—')],
      ['hours', hoursChip(built.flatMap(b => b.rows))],
      ['kind', kinds.map(k => KIND_WORD[k] || k).join(' · ') || '—'],
      ST.rel ? ['basis', `relative to ${hubLabel()}`] : null,
    ]);
    const faceText = `ISO-NE | ${scopeLabel()} | ${built.map(b => scenLabel(b.id) + '@' + b.market).join(' + ')} | ${kinds.join('+')}` +
      (ST.rel ? ` | relative to ${hubLabel()}` : '');

    let chart = null;
    const allV = built.flatMap(b => b.rows.filter(r => r.mean != null).map(r => ({ b, r })));
    const p = panel({
      id: 'explorer', wide: true, title: `Price by year · runs overlaid · ${scopeShort()}`,
      sig: CORE() ? CORE().sig('lmp', 'annual 2020–2050', 'settled + solved') : null,
      answer: allV.length ? `${built.filter(b => b.rows.length).map(b => { const v = b.rows.filter(r => r.mean != null); return v.length ? `${scenLabel(b.id)} ${v[0].year === v[v.length - 1].year ? v[0].year : v[0].year + '–' + v[v.length - 1].year} ${fmt.money(Math.min(...v.map(r => r.mean)), 2)}${v.length > 1 ? ' to ' + fmt.money(Math.max(...v.map(r => r.mean)), 2) : ''}` : ''; }).filter(Boolean).join(' · ')} ($/MWh)` : 'No annual row held for the selected runs here',
      face, faceText,
      controls: [overlayToggle()],
      csv: true,
      table: () => ({
        cols: [{ l: 'Scenario' }, { l: 'Year' }, { l: 'Market' }, { l: 'Mean $/MWh' },
          { l: 'p5' }, { l: 'p50' }, { l: 'p95' }, { l: 'Hours' }, { l: 'Kind' }, { l: 'Partial' }],
        rows: built.flatMap(b => b.rows.map(r => [scenLabel(b.id), r.year, r.market || b.market,
          r.mean == null ? null : fmt.num(r.mean, 2), r.p5 == null ? null : fmt.num(r.p5, 2),
          r.p50 == null ? null : fmt.num(r.p50, 2),
          r.p95 == null ? null : fmt.num(r.p95, 2), r.hours == null ? null : fmt.int(r.hours),
          KIND_WORD[r.kind] || r.kind, r.partial ? 'yes' : 'no'])),
        why: 'No annual row is held for the selected scenarios at this scope and market.',
      }),
      note: [
        esc2 ? (() => {
          const e = built.flatMap(b => b.rows).filter(r => r.kind === 'escalated');
          const from = uniq(e.map(r => r.escalated_from).filter(Boolean));
          const step = (META() && META().vendor_step) || null;
          return `${uniq(e.map(r => r.year)).sort().join(' and ')} ${e.length > 1 ? 'are' : 'is'} drawn hollow and dashed: <b>${esc(ESC_NOTE)}</b>` +
            (from.length ? ` — ${esc(from.join('/'))} solved, ${step ? `× ${esc(String(step))} per five-year step` : 'escalated'}, no hours behind it.` : '.');
        })() : '',
        gapYears.length ? `No value at ${gapYears.join(', ')} — the line is broken there and a tick marks the break. Nothing is interpolated.` : '',
        mixed.length > 1 ? `The market toggle applies to every series that publishes that market. ${built.filter(b => b.market !== mk).map(b => `<b>${esc(scenLabel(b.id))}</b> publishes only <code>${esc(b.market)}</code>, so it is read there`).join('; ')}.` : '',
        `A filled circle is a settled year, a filled square a solved year, a hollow diamond an escalated one. A larger mark is a partial year and carries its hours.`,
      ].filter(Boolean).join(' '),
      draw: body => {
        chart = explorerChart(body, built, { id: 'explorer', unit: ST.rel ? '$/MWh vs hub' : '$/MWh', signed: ST.rel,
          aria: `Annual price 2020 to 2050 at ${scopeLabel()}` });
        if (!chart) return;
        const { hits, geom } = chart;
        wireHover(body, (mx, my, rect) => {
          const scaleX = rect.width / geom.W;
          let best = null, bd = 1e9;
          hits.forEach(h => { const d = Math.abs(h.X * scaleX - mx); if (d < bd) { bd = d; best = h; } });
          if (!best || bd > 26) return null;
          const r = best.p.row;
          return { key: best.s.id + ':' + best.p.x, x: best.X * scaleX, y: my, cross: best.X * scaleX,
            text: `${best.s.label} ${best.p.x} · ${fmt.money(best.p.v, 2)} · ${KIND_WORD[r.kind] || r.kind}` +
              (r.kind === 'escalated' ? ' · no hourly run' : r.hours != null ? ` · ${fmt.int(r.hours)} h` : '') };
        });
      },
    });
    host.appendChild(p);
    /* S-nav 2026-10-07: the year × scenario table that sat under the chart is the chart's own "Show table" (p5–p95) */
    host.appendChild(shownIn('wf:offtake', 'Node − hub basis by year', ''));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Screen 2 · Hourly surface — month × hour, to 2040
     ═══════════════════════════════════════════════════════════════════════ */
  /** Zone and hub surfaces carry a year per row. The per-bus block does not —
   *  `bus_month_hour[bus][scenario]` is 288 numbers and nothing else — so a bus
   *  surface states "as the run states it" rather than borrowing the scenario's
   *  target year, which would be a figure Cathy invented. */
  function surfaceRows(sid) {
    const d = DATA(); if (!d) return [];
    const s = scope();
    if (s.kind === 'bus') return [];
    return (d.month_hour || []).filter(r => r.scope === s.kind && r.key === s.key && r.scenario === sid);
  }
  function surfaceYears(sid) { return uniq(surfaceRows(sid).map(r => r.year)).sort(); }
  function surfaceMarkets(sid, year) { return uniq(surfaceRows(sid).filter(r => r.year === year).map(r => r.market)); }
  /* continuum fix 2026-10-06 (D10): the market a zone/hub surface is read at — the strip's market where the
     year holds it, else real time, else what the year holds. Printed on the face from the row itself. */
  function surfaceMarket(sid, year) {
    const mks = surfaceMarkets(sid, year); if (!mks.length) return null;
    const want = ST.market;
    return mks.includes(want) ? want : mks.includes('RT') ? 'RT' : mks[0];
  }
  /* continuum fix 2026-10-06 (D6): a whole year is one whose surface holds all 288 cells at its market */
  function surfaceWhole(sid, year) {
    const mk = surfaceMarket(sid, year);
    const r = surfaceRows(sid).find(x => x.year === year && (!mk || x.market === mk));
    if (!r) return false;
    if (Array.isArray(r.cells)) return r.cells.every(v => v != null);
    return surfaceRows(sid).filter(x => x.year === year && (!mk || x.market === mk)).length >= 288;
  }
  /** the bus surface's own year and market (D7): settled is the exporter's named settled year, a run its target */
  function busSurfaceStamp(sid) {
    const cov = coverageOf('bus_month_hour');
    if (isSettled(sid)) return { year: cov.settled_year != null ? cov.settled_year : null, market: cov.settled_market || null };
    const sc = scenOf(sid);
    return { year: sc && sc.target_year != null ? sc.target_year : null, market: 'model' };
  }
  /** Two shapes are read here. The exporter packs one row per surface with a
   *  288-element `cells` array (month-major, index = (m-1)*24 + h); the contract
   *  sketched one row per cell with `m`, `h`, `mean`. Whichever arrives, the
   *  surface is the same 288 numbers. */
  function surfaceCells(sid, year, mk) {
    const d = DATA(); if (!d) return null;
    const s = scope();
    if (s.kind === 'bus') {
      const per = (d.bus_month_hour || {})[s.key];
      if (!(per && per[sid])) return null;
      /* continuum S0 2026-10-06: a bus surface is the run's own year (its target), the settled record never scaled */
      const sc = scenOf(sid);
      return scaleList(per[sid].slice(), scenAdj(sid, sc && sc.target_year, null, s.key));
    }
    const rows = surfaceRows(sid).filter(r => r.year === year && (!mk || r.market === mk));
    if (!rows.length) return null;
    const adj = scenAdj(sid, year, null, null);
    if (rows[0] && Array.isArray(rows[0].cells)) return scaleList(rows[0].cells.slice(), adj);
    const a = new Array(288).fill(null);
    rows.forEach(r => { if (r.m != null && r.h != null) a[(r.m - 1) * 24 + r.h] = r.mean; });
    return a.some(v => v != null) ? scaleList(a, adj) : null;
  }

  /** the "full depth" / "288 cells only" chip every bus-scoped screen wears */
  function depthFace() {
    const s = scope();
    if (s.kind !== 'bus') return null;
    const c = depthChip(s.key);
    return ['depth', !c.full ? c.text
      : c.proxy ? `full depth — ${c.text}; ${PROXY_SCOPE}` : 'full depth'];
  }

  /* ── the hourly series panel, only at a full-depth bus ──────────────────── */
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  /** A day-of-year to month/day without a Date: the series is a flat hour array
   *  and a Date would quietly apply the browser's own daylight saving to it.
   *  Whether the year HAS a leap day is the year's own fact when the entry
   *  names its year, and the array's length otherwise: a settled leap year is
   *  8,783 local hour labels, not 8,784, so a length test alone reads 2020 and
   *  2024 as 365-day years and every label after February is a day early. */
  const isLeapYear = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  function leapOf(year, len) { return year != null ? isLeapYear(+year) : len >= 8783; }
  function hourLabel(i, leap) {
    const doy = Math.floor(i / 24), hod = i % 24;
    const ml = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let m = 0, d = doy;
    while (m < 12 && d >= ml[m]) { d -= ml[m]; m++; }
    return `${MONTHS[Math.min(11, m)]} ${d + 1} ${String(hod).padStart(2, '0')}:00`;
  }
  const FEB29 = 59 * 24;   // the first hour of 29 February on a leap calendar
  /** Overlaying a leap year on a common one by hour index puts 1 March of one
   *  against 29 February of the other and every day after is a day apart. The
   *  common year gets 29 February inserted as a day of nulls — a gap, drawn
   *  as a break — so the axis is the DATE and a series never runs ahead. */
  function onLeapAxis(values, leap) {
    if (leap) return values;
    return values.slice(0, FEB29).concat(new Array(24).fill(null), values.slice(FEB29));
  }
  const WITHHELD_SENTENCE = 'hourly withheld for this year — spreads, duration and decomposition are on the full series';

  /** the settled years a full-depth bus carries, drawable or withheld */
  function settledYears(id) {
    return uniq(fullEntries(id).filter(e => isSettled(e.scenario) && e.year != null).map(e => e.year)).sort((a, b) => a - b);
  }
  /** One entry per selected scenario. A solved run has one; the settled record
   *  has one per year, picked on the panel's own Year control (latest by
   *  default). Returns the run to draw, or the entry that holds a row and no
   *  array — withheld, which is not the same thing as absent. */
  function pickHourly(id, sid, host) {
    const ents = fullEntries(id).filter(e => e.scenario === sid);
    if (!ents.length) return null;
    let e;
    if (isSettled(sid)) {
      const ys = settledYears(id);
      const whole = ys.filter(y => { const x = ents.find(q => q.year === y); return x && !x.partial; });
      const y = ys.includes(ST.hourYear) ? ST.hourYear : (whole[whole.length - 1] || ys[ys.length - 1]);
      e = ents.find(x => x.year === y) || ents[ents.length - 1];
    } else {
      const drawable = ents.filter(x => Object.keys(x.values).some(m => Array.isArray(x.values[m])));
      e = drawable[drawable.length - 1] || ents[ents.length - 1];
    }
    const mks = Object.keys(e.values).filter(m => Array.isArray(e.values[m]));
    if (!mks.length || e.withheld) return { withheld: true, sid, year: e.year, note: e.withheldNote };
    const want = market();
    const mk = mks.includes(want) ? want : mks[0];
    const settledProxy = isSettled(sid) && depthChip(id).proxy;
    return { id: sid, market: mk, colour: scenColour(sid, host),
      year: e.year, kind: e.kind, partial: e.partial, hours: e.hours[mk],
      calendar_hours: e.calendar_hours, calendar_basis: e.calendar_basis,
      daHeld: e.daHeld, marketNote: mk !== want && want === 'DA' && !e.daHeld ? (e.entry && e.entry.note) || null : null,
      raw: scaleList(e.values[mk], scenAdj(sid, e.year, e.kind, id)),   // continuum S0 2026-10-06
      leap: leapOf(e.year, e.values[mk].length),
      label: `${scenLabel(sid)} (${MKT_WORD(mk)})${e.year ? ' ' + e.year : ''}${settledProxy ? ' · via ' + depthChip(id).node : ''}` };
  }

  function screenHourly(host) {
    const s = scope();
    if (s.kind !== 'bus' || !hasFull(s.key)) return false;
    const id = s.key, ids = shapeIds();   /* orchestrator 2026-09-28 lmp continuous: History vs forecast */
    const chip = depthChip(id), b = busFull(id);
    const avail = ids.filter(sid => fullScenarios(id).includes(sid));
    const picked = avail.map(sid => pickHourly(id, sid, host)).filter(Boolean);
    /* a year the block holds a ROW for and no array: withheld, not absent */
    const held = picked.filter(p => p.withheld);
    const drawn = picked.filter(p => !p.withheld);
    const leapAxis = drawn.some(r => r.leap);
    const runs = drawn.map(r => Object.assign(r, { values: leapAxis ? onLeapAxis(r.raw, r.leap) : r.raw }));
    const padded = leapAxis ? runs.filter(r => !r.leap) : [];
    const cov = coverageOf('bus_full');
    const z = zoomOf(ST.zoom);
    const len = runs.length ? Math.max(...runs.map(r => r.values.length)) : 0;
    const n = Math.min(z.n, len);
    const start = clamp(ST.hourAt || 0, 0, Math.max(0, len - n));
    const sYears = avail.some(isSettled) ? settledYears(id) : [];
    const sWhole = sYears.filter(y => { const x = fullEntries(id).find(q => isSettled(q.scenario) && q.year === y); return x && !x.partial; });
    const sYear = sYears.length ? (sYears.includes(ST.hourYear) ? ST.hourYear : (sWhole[sWhole.length - 1] || sYears[sYears.length - 1])) : null;
    const lbl = i => hourLabel(i, leapAxis);

    host.appendChild(panel({
      id: 'hourly', wide: true, title: `Hourly series · ${scopeShort()}`,
      face: faceLine([
        ['scope', `ISO-NE · ${scopeLabel()}`],
        depthFace(),
        b && b.buses_sharing_series > 1 ? ['shared', `this series is the record for ${fmt.int(b.buses_sharing_series)} buses at this substation`] : null,
        ['scenario', runs.map(r => r.label).join(' · ') || 'none of the selected scenarios has an hourly array here'],
        ['market', (uniq(runs.map(r => MKT_WORD(r.market))).join(' + ') || '—') +
          (runs.some(r => r.daHeld === false && isSettled(r.id)) ? ' — day-ahead is not published at this bus for ' +
            runs.filter(r => r.daHeld === false && isSettled(r.id)).map(r => r.year).join(', ') + ', so real time is shown' : '')],
        ['hours', runs.length
          ? runs.map(r => `${fmt.int(r.hours != null ? r.hours : r.values.filter(v => v != null).length)}${r.calendar_hours && r.calendar_hours !== r.hours ? ' of ' + fmt.int(r.calendar_hours) : ''}`).join(' / ')
            + ` · ${fmt.int(n)} in the window`
            + (uniq(runs.map(r => r.calendar_basis).filter(Boolean)).length ? ` · ${uniq(runs.map(r => r.calendar_basis).filter(Boolean)).join('; ')}` : '')
            + (padded.length ? ` · aligned on the date: ${padded.map(r => r.year || r.id).join(', ')} ha${padded.length === 1 ? 's' : 've'} no 29 Feb, drawn as a gap` : '')
          : '—'],
        ['kind', uniq(runs.map(r => r.kind).filter(Boolean)).join(' · ') || (avail.includes('hist') ? 'settled' : 'solved')],
      ]),
      faceText: `ISO-NE | ${scopeLabel()} | hourly | ${runs.map(r => r.id + '@' + r.market + (r.year ? ' ' + r.year : '')).join(' + ')}`,
      controls: [
        sYears.length > 1 ? (() => {
          /* the settled record is one entry per year; a select, not seven buttons,
             so the header keeps its controls on one line at 1280 */
          const sel = document.createElement('select'); sel.className = 'gsc-yr';
          sel.setAttribute('data-gsc-houryear', 'true');
          sel.setAttribute('aria-label', 'Settled year on the hourly series');
          sel.title = 'Which settled year the hourly series reads. Solved runs each carry one year of their own.';
          sYears.forEach(y => { const o = document.createElement('option'); o.value = String(y);
            const e = fullEntries(id).find(x => isSettled(x.scenario) && x.year === y);
            o.textContent = String(y) + (e && e.withheld ? ' · withheld' : e && e.partial ? ' · partial' : '');
            if (y === sYear) o.selected = true; sel.appendChild(o); });
          sel.onchange = () => { ST.hourYear = +sel.value; store(); paint(); };
          return sel;
        })() : null,
        seg('Window', ZOOM.map(x => ({ v: x.k, l: x.label, disabled: len > 0 && x.n > len * 1.001 })),
          z.k, v => { ST.zoom = v; store(); paint(); }, 'How many hours the window holds'),
        hvfToggle(),   /* orchestrator 2026-09-28 lmp continuous */
      ],
      csv: !!runs.length,
      table: () => ({
        cols: [{ l: 'Hour' }].concat(runs.map(r => ({ l: r.label }))),
        rows: Array.from({ length: n }, (_, i) => [lbl(start + i)]
          .concat(runs.map(r => { const v = r.values[start + i]; return v == null ? null : fmt.num(v, 2); }))),
        why: 'No hourly array is held at this bus for the selected scenarios.',
      }),
      note: (chip.proxy
        ? `This bus has no settled price node of its own: its settled series <b>${esc(chip.text)}</b>, and is that node's record read here. <b>${esc(PROXY_SCOPE)}</b>.`
        : 'The hourly record at this bus, as the run published it.')
        + ' Beyond a week the band is the min-to-max of the hours behind each pixel with the mean drawn over it, so a spike is never averaged away.'
        + (hvfAdded().length ? ` History vs forecast: <b>${esc(hvfAdded().map(scenLabel).join(', '))}</b> is drawn dashed beside the settled year, on the same date axis.` : '')
        + (held.length ? ` <b>${held.map(x => `${scenLabel(x.sid)}${x.year ? ' ' + x.year : ''}`).join(', ')}: ${esc(WITHHELD_SENTENCE)}</b>. ${esc(uniq(held.map(x => x.note).filter(Boolean))[0] || cov.reason || '')}` : '')
        + (runs.some(r => r.marketNote) ? ' ' + esc(uniq(runs.map(r => r.marketNote).filter(Boolean)).join(' ')) : ''),
      draw: body => {
        if (!runs.length) {
          body.appendChild(emptyBox('No hourly array at this bus for the selected scenarios',
            (held.length
              ? `${held.map(x => `${scenLabel(x.sid)}${x.year ? ' ' + x.year : ''}`).join(', ')}: ${WITHHELD_SENTENCE}. ${uniq(held.map(x => x.note).filter(Boolean))[0] || cov.reason || ''} `
              : '') +
            `This bus carries an hourly array for ${uniq(fullScenarios(id).filter(sid => fullDrawable(id, sid).length)).map(scenLabel).join(', ') || 'nothing'}. Select one of those on the strip above.`));
          return;
        }
        const out = hourlyCanvas(body, runs, { id: 'hourly', from: start, to: start + n,
          height: 250, unit: '$/MWh', labelAt: lbl });
        if (!out) return;
        /* the window position. An input, not a drag on the canvas: a drag would
           want a redraw per frame and this chart is deliberately drawn once. */
        if (len > n) {
          const row = el('div', 'gsc-key');
          row.appendChild(el('span', null, lbl(start)));
          const sl = document.createElement('input');
          sl.type = 'range'; sl.min = '0'; sl.max = String(len - n); sl.step = String(Math.max(1, Math.round(n / 8)));
          sl.value = String(start); sl.style.flex = '1 1 auto';
          sl.setAttribute('data-gsc-hourat', 'true');
          sl.setAttribute('aria-label', 'Move the window through the year');
          sl.onchange = () => { ST.hourAt = +sl.value; store(); paint(); };
          row.appendChild(sl);
          row.appendChild(el('span', null, lbl(start + n - 1)));
          body.appendChild(row);
        }
        const lg = el('div', 'gsc-lg');
        runs.forEach(r => { const sp = el('span'); const i = document.createElement('i');
          i.style.background = r.colour; sp.appendChild(i); sp.appendChild(el('span', null, r.label)); lg.appendChild(sp); });
        body.appendChild(lg);
        const g = out.geom;
        wireHover(body, (mx, my, rect) => {
          const k = rect.width / g.W;
          const i = Math.round(clamp((mx / k - g.P.l) / g.plotW, 0, 1) * (g.n - 1));
          const txt = out.slices.map(s => `${s.r.label} ${s.v[i] == null ? 'no value' : fmt.money(s.v[i], 2)}`).join(' · ');
          return { key: 'h' + i, x: mx, y: my, cross: (g.P.l + (i / Math.max(1, g.n - 1)) * g.plotW) * k,
            text: `${lbl(start + i)} — ${txt}` };
        });
      },
    }));
    return true;
  }

  function screenSurface(host) {
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    /* S-nav 2026-10-07: the full-depth bus's hourly series is not redrawn here — it is the Hourly page's chart */
    if (scope().kind === 'bus' && hasFull(scope().key)) host.appendChild(shownIn('hourly', 'The hourly series at this bus', ''));
    /* orchestrator 2026-09-28 lmp continuous: History (year) vs Forecast (year) — settled and a run on one
       colour scale, so a cell reads the same dollar value in both panels */
    const ids = shapeIds();
    /* continuum fix 2026-10-06 (D6): the default is the latest WHOLE year (the duration screen's rule);
       a part year stays selectable and starred */
    const yearOf = sid => { const ys = surfaceYears(sid); if (ys.includes(ST.surfYear)) return ST.surfYear;
      const whole = ys.filter(y => surfaceWhole(sid, y)); return whole[whole.length - 1] || ys[ys.length - 1] || null; };
    const cellsOf = sid => { const y = yearOf(sid); return y != null || scope().kind === 'bus' ? surfaceCells(sid, y, y != null ? surfaceMarket(sid, y) : null) : null; };
    const pair = ST.hvf && ids.some(isSettled) && ids.some(x => !isSettled(x));
    const shared = pair ? ids.map(cellsOf).filter(Boolean).flat().filter(v => v != null) : [];
    const range = shared.length ? [Math.min(...shared), Math.max(...shared)] : null;
    ids.forEach((sid, si) => {
      const sc = scenOf(sid);
      const years = surfaceYears(sid);
      const target = sc ? sc.target_year : null;
      const onBus = scope().kind === 'bus';
      const stamp = onBus ? busSurfaceStamp(sid) : null;
      const year = onBus ? stamp.year : yearOf(sid);
      const mkt = onBus ? stamp.market : (yearOf(sid) != null ? surfaceMarket(sid, yearOf(sid)) : null);
      const cells = cellsOf(sid);
      const noHourly = sc && sc.hourly === false;
      const partialYear = y => !isSettled(sid) ? false : !surfaceWhole(sid, y);
      const beyond2040 = target != null && target > 2040;
      const rows = [];
      if (cells) for (let m = 0; m < 12; m++) for (let h = 0; h < 24; h++)
        rows.push([MON[m], 'HE ' + (h + 1), cells[m * 24 + h] == null ? null : fmt.num(cells[m * 24 + h], 1)]);
      const pid = 'surface-' + sid;

      const vals = cells ? cells.filter(v => v != null) : [];
      host.appendChild(panel({
        id: pid, wide: !pair,
        sig: CORE() ? CORE().sig('lmp', `month×hour ${year || (sc && sc.target_year) || '-'} ${scenLabel(sid)}`, mkt || '-') : null,
        answer: vals.length ? `${scenLabel(sid)}${year ? ' ' + year : ''}: ${fmt.money(Math.min(...vals), 2)} to ${fmt.money(Math.max(...vals), 2)} $/MWh across ${vals.length} month × hour cells` : '',
        title: `${pair ? (isSettled(sid) ? `History${year ? ' ' + year : ''}${mkt && mkt !== 'model' ? ' · ' + mkt : ''} · ` : `Forecast${(year || (sc && sc.target_year)) ? ' ' + (year || sc.target_year) : ''} · `) : ''}Month × hour · ${scenLabel(sid)} · ${scopeShort()}`,
        face: faceLine([
          ['scope', `ISO-NE · ${scopeLabel()}`],
          depthFace(),
          ['scenario', scenLabel(sid)],
          ['market', mkt ? MKT_WORD(mkt) || mkt : '—'],
          ['year', year == null ? '—' : String(year) + (!onBus && partialYear(year) ? ' — a part year' : '')],
          ['kind', sid === 'hist' ? 'settled' : 'solved'],
          ['cells', cells ? `${cells.filter(v => v != null).length} of 288` : '0 of 288'],
        ]),
        faceText: `ISO-NE | ${scopeLabel()} | ${scenLabel(sid)} | ${year || '-'} | ${mkt || '-'} | month x hour`,
        controls: [!onBus && years.length > 1 ? yearCtl(years, year, v => { ST.surfYear = v; }, partialYear) : null],
        csv: !!cells,
        table: cells ? () => ({ cols: [{ l: 'Month' }, { l: 'Hour' }, { l: '$/MWh' }], rows }) : null,
        note: (pair ? `History vs forecast: settled and ${esc(ids.filter(x => !isSettled(x)).map(scenLabel).join(', '))} share one colour scale (${esc(range ? fmt.money(range[0], 0) + ' to ' + fmt.money(range[1], 0) : '—')} $/MWh), so a cell reads the same dollar value in both.${hvfAdded().includes(sid) ? ' This run was added beside the settled record by the History vs forecast toggle.' : ''} ` : '') + (scope().kind !== 'bus' ? ''
          : hasFull(scope().key)
            ? 'This bus carries its full hourly record, drawn above. The 288-cell surface here is the same hours folded to month × hour, kept because it is the shape that compares across buses.'
            : 'Per-bus hourly is not exported for every bus: 2,678 × 8,760 × three scenarios is not a single-file quantity. At this bus the block holds the 288-cell month × hour surface and the annual means — nothing finer.'),
        draw: body => {
          if (!cells) {
            body.appendChild(emptyBox(
              beyond2040 ? 'No hourly run' : noHourly ? 'Not held' : 'No month × hour block at this scope',
              beyond2040
                ? `${scenLabel(sid)} targets ${target}. Hourly runs stop at 2040 — ${target} is escalated from 2040 and carries no hours, so there is no surface to draw. The annual figure is on the price explorer.`
                : scope().kind === 'bus'
                  ? `Bus ${scope().key} carries annual means but no 288-cell surface in this block. The zone surface is one click away in the picker; a per-bus surface needs the exporter to publish bus_month_hour for it.`
                  : `The store holds no month × hour rows for ${scenLabel(sid)} at ${scopeLabel()}. Pick a scenario whose chip says hourly, or a zone.`));
            return;
          }
          const out = heatCanvas(body, cells, { id: pid, cellH: 14, range });   /* orchestrator 2026-09-28 lmp continuous: one scale */
          if (!out) return;
          const key = el('div', 'gsc-key');
          key.appendChild(el('span', null, fmt.money(out.lo, 0)));
          const ramp = el('div', 'gsc-ramp');
          out.ramp.forEach(c => { const i = document.createElement('i'); i.style.background = c; ramp.appendChild(i); });
          key.appendChild(ramp);
          key.appendChild(el('span', null, fmt.money(out.hi, 0)));
          body.appendChild(key);
          const g = out.geom;
          wireHover(body, (mx, my, rect) => {
            const k = rect.width / g.W;
            const m = Math.floor((mx / k - g.P.l) / g.cw), hRow = Math.floor((my / k - g.P.t) / g.ch);
            if (m < 0 || m > 11 || hRow < 0 || hRow > 23) return null;
            const h = 23 - hRow, v = g.cells[m * 24 + h];
            return { key: m + ':' + h, x: mx, y: my, cross: null,
              text: `${MON[m]} · HE ${h + 1} · ${v == null ? 'no value' : fmt.money(v, 2) + '/MWh'}` };
          });
        },
      }));
    });
    if (!ids.length) host.appendChild(panel({ id: 'surface-none', wide: true, title: 'Month × hour',
      draw: b => b.appendChild(emptyBox('No scenario selected', 'Pick a held scenario on the strip above.')) }));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Screen 3 · Duration curve
     ═══════════════════════════════════════════════════════════════════════ */
  function screenDuration(host) {
    /* orchestrator 2026-09-28 lmp continuous: History (year) vs Forecast (year). With a run beside the
       settled record, history is ONE settled year at one market (the latest whole year by default), so the
       chart reads "History 2025 vs Forecast 2030", not thirteen settled curves against one run. */
    const d = DATA(), s = readScope('duration'), ids = shapeIds();
    let rows = s.bus
      ? fullBlock(s.bus, 'duration').filter(r => ids.includes(r.scenario))
      : (d && s.key ? (d.duration || []).filter(r => ids.includes(r.scenario) && r.scope === s.kind && r.key === s.key) : []);
    /* continuum S0 2026-10-06: a percentile is a price — the whole curve scales with the run's verdict */
    if (scenOn()) rows = rows.map(r => { const a = scenAdj(r.scenario, r.year, null, s.bus || null);
      return a.applied ? Object.assign({}, r, { value: scaleList(r.value, a), _scen: a }) : r; });
    const pair = ST.hvf && rows.some(r => isSettled(r.scenario)) && rows.some(r => !isSettled(r.scenario));
    const hRows = rows.filter(r => isSettled(r.scenario));
    const hMk = uniq(hRows.map(r => r.market)); const durMk = hMk.includes(ST.market) ? ST.market : hMk.includes('RT') ? 'RT' : hMk[0];
    const hYears = uniq(hRows.filter(r => r.market === durMk).map(r => r.year)).sort();
    const wholeY = hYears.filter(y => { const r = hRows.find(x => x.year === y && x.market === durMk); return r && !(r.hours != null && r.hours < 0.95 * (y % 4 === 0 ? 8784 : 8760)); });
    const durY = hYears.includes(ST.durYear) ? ST.durYear : (wholeY[wholeY.length - 1] || hYears[hYears.length - 1]);
    if (pair) rows = rows.filter(r => !isSettled(r.scenario) || (r.year === durY && r.market === durMk));
    const years = uniq(rows.map(r => r.year)).sort();
    const series = rows.map(r => ({ id: r.scenario + ':' + r.year, colour: scenColour(r.scenario, host), dash: !isSettled(r.scenario),
      label: pair ? (isSettled(r.scenario) ? `History ${r.year} · settled ${r.market}` : `Forecast ${r.year} · ${scenLabel(r.scenario)}`) : withYear(scenLabel(r.scenario), r.year),
      pct: r.pct, value: r.value, row: r }));

    host.appendChild(panel({
      sig: CORE() ? CORE().sig('price-duration', 'one year per run', uniq(rows.map(r => r.market)).join('/') || '-') : null,
      answer: series.length ? series.map(x => { const v = x.value.filter(q => q != null); return v.length ? `${x.label} ${fmt.money(Math.min(...v), 0)} to ${fmt.money(Math.max(...v), 0)}` : ''; }).filter(Boolean).join(' · ') + ' ($/MWh, cheapest to dearest hour)' : '',
      id: 'duration', wide: true, title: `Price duration curve · ${s.bus || s.missing ? scopeShort() : (s.key ? aggShort(s.kind, s.key) : scopeShort())}`,
      face: faceLine([
        ['scope', s.bus || s.missing || !s.key ? `ISO-NE · ${scopeLabel()}` : `ISO-NE · ${aggLabel(s.kind, s.key)}`],
        s.via ? ['basis', s.via] : null,
        ['scenario', ids.map(scenLabel).join(' · ')],
        ['market', uniq(rows.map(r => r.market)).join(' / ') || '—'],
        ['hours', hoursChip(rows)],
        ['kind', uniq(rows.map(r => r.scenario === 'hist' ? 'settled' : 'solved')).join(' · ') || '—'],
      ]),
      faceText: `ISO-NE | ${scopeLabel()} | duration | ${ids.join('+')}`,
      controls: [pair && hYears.length > 1 ? seg('Settled year', hYears.map(y => ({ v: y, l: wholeY.includes(y) ? String(y) : `${y}*` })), durY, v => { ST.durYear = +v; store(); paint(); },
        'Which settled year is drawn against the forecast run (* a part year)') : null],
      csv: !!rows.length,
      table: () => ({
        cols: [{ l: 'Scenario' }, { l: 'Year' }, { l: 'Percentile' }, { l: '% of hours at or above' }, { l: '$/MWh' }],
        rows: rows.flatMap(r => r.pct.map((p, i) => [scenLabel(r.scenario), r.year, p + '%', (100 - p) + '%',
          r.value[i] == null ? null : fmt.num(r.value[i], 2)])),
        why: 'The store holds no percentile block at this scope for the selected scenarios.',
      }),
      /* orchestrator 2026-09-28 lmp continuous: the block is ASCENDING (percentile 0 = the cheapest hour —
         hub 2025 DA reads $9.25 at 0 and $474.90 at 100). The note used to say the opposite. The curve is
         now drawn richest first, like every duration card in the Studio: percentile p sits at 100 − p. */
      note: `Richest hour first: the left edge is the dearest hour of the year and the right edge the cheapest — a stored percentile p is drawn at ${'(100 − p)'}% of hours at or above. The block carries 13 percentiles, not 8,760 points — the curve is drawn through what is held and nothing between them is invented.${pair ? ` History vs forecast: settled ${esc(String(durY))} (solid) against ${esc(uniq(rows.filter(r => !isSettled(r.scenario)).map(r => withYear(scenLabel(r.scenario), r.year))).join(', '))} (dashed).` : ''}`,
      draw: body => {
        if (s.missing) { body.appendChild(notAtBus(s, 'The price duration curve')); return; }
        if (!series.length) { body.appendChild(emptyBox('No duration curve here',
          !s.key && !s.bus ? s.via + '. Pick a zone or the hub in the picker.'
            : `No percentile row is held for the selected scenarios at ${aggShort(s.kind, s.key)}. The block carries ${uniq((d && d.duration || []).map(r => r.scenario)).map(scenLabel).join(', ') || 'nothing'}.`)); return; }
        const out = durationCanvas(body, series, { id: 'duration', height: 300 });
        if (!out) return;
        const lg = el('div', 'gsc-lg');
        series.forEach(x => { const sp = el('span'); const i = document.createElement('i');
          if (x.dash) { i.className = 'gsc-dash'; i.style.borderTopColor = x.colour; } else i.style.background = x.colour;
          sp.appendChild(i); sp.appendChild(el('span', null, x.label)); lg.appendChild(sp); });
        if (pair) { lg.setAttribute('data-lmpc-legend', 'true'); lg.setAttribute('data-lmpc-run-label', uniq(rows.filter(r => !isSettled(r.scenario)).map(r => scenLabel(r.scenario))).join(', ')); }
        body.appendChild(lg);
        const g = out.geom;
        wireHover(body, (mx, my, rect) => {
          const k = rect.width / g.W;
          const at = clamp(Math.round((mx / k - g.P.l) / (g.W - g.P.l - g.P.r) * 100), 0, 100);   // % of hours at or above
          const want = 100 - at;                                                                  // the stored percentile there
          const near = series[0].pct.reduce((a, q) => Math.abs(q - want) < Math.abs(a - want) ? q : a, series[0].pct[0]);
          const txt = series.map(x => `${x.label} ${fmt.money(x.value[x.pct.indexOf(near)], 1)}`).join(' · ');
          return { key: 'p' + near, x: mx, y: my, cross: (g.P.l + (100 - near) / 100 * (g.W - g.P.l - g.P.r)) * k,
            text: `${100 - near}% of hours at or above — ${txt}` };
        });
      },
    }));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Screen 4 · Price make-up — energy / congestion / loss
     ═══════════════════════════════════════════════════════════════════════ */
  /* orchestrator 2026-09-28 lmp continuous — settled and forecast on ONE axis for the per-year screens
     (components, spreads): the settled years at one market, then each run's year, a divider between
     them, the forecast bars outlined (hollow) and the run named in the legend */
  const fcTick = (rows, r) => rows.filter(x => !isSettled(x.scenario) && x.year === r.year).length > 1 ? `${r.year} ${scenLabel(r.scenario).replace(/^PROBE (\d+)-year.*/, '$1-yr').replace(/^PCR \d{4}.*/, 'PCR')}` : String(r.year);
  function settledMarket(rows) { const mk = uniq(rows.filter(r => isSettled(r.scenario)).map(r => r.market)); return mk.includes(ST.market) ? ST.market : mk.includes('RT') ? 'RT' : mk[0]; }
  /* orchestrator 2026-09-28 lmp continuous: a part year (hours, or days, < 0.95 × its calendar) is starred on the axis and carries its hours in the legend */
  const calHours = y => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 8784 : 8760;
  const partRow = r => r && (r.hours != null ? +r.hours < 0.95 * calHours(+r.year) : r.days != null ? +r.days < 0.95 * calHours(+r.year) / 24 : false);
  function partNote(lg, rows) {
    const ps = uniq(rows.filter(partRow).map(r => r.year)).sort((a, b) => a - b); if (!ps.length) return;
    const txt = ps.map(y => { const r = rows.find(z => z.year === y && partRow(z)); return r.hours != null ? `${y} · ${fmt.int(r.hours)} h` : `${y} · ${fmt.int(r.days)} days`; }).join(', ');
    const sp = el('span', null, `* part year ${txt}`); sp.setAttribute('data-lmpc-partial', ps.join(',')); lg.appendChild(sp);
  }
  function dividerAt(svg, geom, after, year, host, part) {
    if (!svg || !geom) return;
    const X = geom.P.l + (after + 1) * geom.bw;
    svg.appendChild(svgEl('line', { x1: X, x2: X, y1: geom.P.t - 6, y2: geom.Hh - geom.P.b, stroke: tok('--ink-4', host), 'stroke-width': 1, 'stroke-dasharray': '3 3', 'data-lmpc-divider': year }));
    const t = svgEl('text', { class: 'gsc-ax', x: X - 4, y: geom.P.t - 8, 'text-anchor': 'end' }); t.textContent = `last settled ${year}${part ? ' (part)' : ''}`; svg.appendChild(t);
    const f = svgEl('text', { class: 'gsc-ax', x: X + 4, y: geom.P.t - 8 }); f.textContent = 'forecast →'; svg.appendChild(f);
  }
  function fcLegend(lg, ids) {
    const runs = ids.filter(x => !isSettled(x)).map(scenLabel);
    const sp = el('span'); const i = document.createElement('i'); i.className = 'hollow'; sp.appendChild(i);
    sp.appendChild(el('span', null, `outlined after the divider: forecast · ${runs.join(', ')}`)); lg.appendChild(sp);
    lg.setAttribute('data-lmpc-legend', 'true'); lg.setAttribute('data-lmpc-run-label', runs.join(', '));
  }
  function makeupPair(host, s, ids, rowsOf) {
    const all = ids.flatMap(rowsOf); const mk = settledMarket(all);
    const hist = all.filter(r => isSettled(r.scenario) && r.market === mk).sort((a, b) => a.year - b.year);
    const fc = all.filter(r => !isSettled(r.scenario)).sort((a, b) => a.year - b.year || String(a.scenario).localeCompare(String(b.scenario)));
    const partY = new Set(hist.filter(partRow).map(r => r.year));
    const rows = hist.concat(fc); const xs = rows.map(r => isSettled(r.scenario) ? String(r.year) + (partY.has(r.year) ? '*' : '') : fcTick(fc, r));
    const fcX = new Set(xs.slice(hist.length));
    const cols = [
      { label: 'Energy', key: 'energy', colour: tok('--gsc-mk-energy', host) },
      { label: 'Congestion', key: 'congestion', colour: tok('--gsc-mk-cong', host) },
      { label: 'Loss', key: 'loss', colour: tok('--gsc-mk-loss', host) },
    ];
    const runs = uniq(fc.map(r => r.scenario)).map(scenLabel).join(', ') || ids.filter(x => !isSettled(x)).map(scenLabel).join(', ');
    const lastH = hist.filter(r => !partRow(r)).slice(-1)[0] || hist[hist.length - 1], cong = fc.filter(r => r.congestion != null);   // the last WHOLE settled year
    host.appendChild(panel({
      sig: CORE() ? CORE().sig('lmp-components', 'annual settled + every solved run', mk || '-') : null,
      answer: rows.length ? `${lastH ? `Settled ${mk} ${lastH.year}: energy ${fmt.money(lastH.energy, 2)} · congestion ${fmt.money(lastH.congestion, 2)} · loss ${fmt.money(lastH.loss, 2)}` : 'No settled year held'}` +
        `${cong.length ? ` · runs' congestion ${fmt.money(Math.min(...cong.map(r => r.congestion)), 2)} to ${fmt.money(Math.max(...cong.map(r => r.congestion)), 2)}` : ''} ($/MWh)` : '',
      id: 'makeup-hvf', wide: true, title: `Price components · settled and forecast · ${s.bus || s.missing ? scopeShort() : (s.key ? aggShort(s.kind, s.key) : scopeShort())}`,
      face: faceLine([
        ['scope', s.bus || s.missing || !s.key ? `ISO-NE · ${scopeLabel()}` : `ISO-NE · ${aggLabel(s.kind, s.key)}`], s.via ? ['basis', s.via] : null,
        ['settled', `${scenLabel('hist')} at ${mk || '—'}`], ['forecast', runs], ['hours', hoursChip(rows)],
      ]),
      faceText: `ISO-NE | ${scopeLabel()} | make-up | settled ${mk} + ${runs}`,
      csv: !!rows.length,
      table: () => ({ cols: [{ l: 'Series' }, { l: 'Year' }, { l: 'Market' }, { l: 'Energy' }, { l: 'Congestion' }, { l: 'Loss' }, { l: 'Total' }, { l: 'Hours' }],
        rows: rows.map(r => [scenLabel(r.scenario), r.year, r.market, fmt.num(r.energy, 2), fmt.num(r.congestion, 2), fmt.num(r.loss, 2),
          fmt.num(r.mean != null ? r.mean : r.energy + r.congestion + r.loss, 2), fmt.int(r.hours)]), why: 'The store holds no energy/congestion/loss split at this scope.' }),
      note: `Settled ${esc(mk || '')} years, then ${esc(runs)} on the same axis — the run's bars are outlined and sit after the "last settled" divider. Every solved run is drawn by default (2021 → 2040); the strip's scenario scales the Base run of each year. A congestion component below zero draws below the axis: the three parts sum to the LMP, and a negative congestion term makes the node cheaper than the reference.`,
      draw: body => {
        if (!rows.length) { body.appendChild(emptyBox('No make-up at this scope', !s.key && !s.bus ? s.via + '. Pick a zone or the hub in the picker.' : `The store holds no energy/congestion/loss rows at ${s.bus ? scopeShort() : s.key}.`)); return; }
        const out = stackChart(body, { id: 'makeup-hvf', x: xs, unit: '$/MWh', height: 260,
          series: cols.map(c => ({ label: c.label, colour: c.colour, v: rows.map(r => r[c.key]) })),
          hollow: x => fcX.has(x), fmtY: v => fmt.num(v, 0), fmtV: v => fmt.money(v, 2) });
        if (out && hist.length && fc.length) dividerAt(out.svg, out.geom, hist.length - 1, hist[hist.length - 1].year, host, partY.has(hist[hist.length - 1].year));
        const lg = el('div', 'gsc-lg');
        cols.forEach(c => { const sp = el('span'); const i = document.createElement('i'); i.style.background = c.colour; sp.appendChild(i); sp.appendChild(el('span', null, c.label)); lg.appendChild(sp); });
        fcLegend(lg, uniq(fc.map(r => r.scenario))); partNote(lg, hist); body.appendChild(lg);
      },
    }));
  }
  /* S-nav 2026-10-07 (review P2 6): energy / congestion / loss AT THE BUS for every bus the price map carries
     (GS_DATA_EXT.price_map: settled RT/DA 2020–26 and the run the price basis reads at 2028/2030/2035/2040, sign already
     normalised; loss = LMP − energy − congestion). Returns null where the map does not hold the bus. */
  function priceMapRows(bus) {
    const P = (window.GS_DATA_EXT || {}).price_map; if (!P || !P.series || !Array.isArray(P.bus_ids)) return null;
    if (!P._ix) { try { Object.defineProperty(P, '_ix', { value: new Map(P.bus_ids.map((b, k) => [Number(b), k])) }); } catch (e) { return null; } }
    const i = P._ix.get(Number(bus)); if (i == null) return null;
    const at = (key, j) => { const a = P.series[key]; const v = a && a[i] ? a[i][j] : null; return typeof v === 'number' && Number.isFinite(v) ? v : null; };
    const meta = P.meta || {}, part = meta.partial_hours || {}, cal = meta.calendar_hours || {};
    const out = [];
    (P.years || []).forEach((y, j) => {
      const kind = (P.kind || {})[String(y)];
      const one = (scenario, market, l, e, c, hours) => {
        if (l == null || e == null || c == null) return;
        out.push({ scenario, year: +y, market, energy: e, congestion: c, loss: Math.round((l - e - c) * 100) / 100, mean: l, hours, src: 'price_map' });
      };
      if (kind === 'settled') ['RT', 'DA'].forEach(mk => one('hist', mk, at(mk + '|lmp', j), at(mk + '|energy', j), at(mk + '|congestion', j),
        (part[String(y)] || {})[mk] != null ? part[String(y)][mk] : (cal[String(y)] != null ? cal[String(y)] : calHours(+y))));
      else { const run = (P.run_of || {})[String(y)]; if (run) one(run, 'model', at('RUN|lmp', j), at('RUN|energy', j), at('RUN|congestion', j), null); }
    });
    return out.length ? out : null;
  }
  function screenMakeup(host) {
    /* S-nav 2026-10-07 (review P2 8): on Drivers the components show EVERY solved run 2021 → 2040 by default — the strip
       adds a proxy scenario, it does not hide runs */
    const d = DATA(), s0 = readScope('decomp');
    const held = heldIds();
    const ids = ['hist'].concat(held.filter(x => !isSettled(x))).filter(x => held.includes(x));
    let s = s0, pm = null;
    if (s0.missing) { pm = priceMapRows(s0.key); if (pm) s = { kind: 'bus', key: s0.key, bus: s0.key, via: 'read at the bus itself — the price map (settled RT/DA and the run the price basis reads each year)' }; }
    const rowsOf = sid => (pm ? pm.filter(r => r.scenario === sid)
      : s.bus
        ? fullBlock(s.bus, 'decomp').filter(r => r.scenario === sid)
        : (d && s.key && !s.missing ? (d.decomp || []).filter(r => r.scenario === sid && r.scope === s.kind && r.key === s.key) : []))
      .slice().sort((a, b) => a.year - b.year)
      /* continuum S0 2026-10-06: energy, congestion and loss scale together, so they still sum to the LMP */
      .map(r => scenOn() ? scaleFields(r, scenAdj(sid, r.year, null, s.bus || null), ['energy', 'congestion', 'loss', 'mean']) : r);
    if (s.missing) {
      host.appendChild(panel({ id: 'makeup-hvf', wide: true, title: `Price components · ${scopeShort()}`, draw: b => b.appendChild(notAtBus(s, 'Energy, congestion and loss')) }));
      return;
    }
    makeupPair(host, s, ids, rowsOf);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Screen 5 · Spreads — TB2 / TB4 / TB8, per MWh
     ═══════════════════════════════════════════════════════════════════════ */
  /* continuum fix 2026-10-06 (D14): the days behind each YEAR figure, read per year — 2026 has 190, not 366 */
  function daysWord(rows) {
    const by = {};
    rows.forEach(r => { if (r.days == null) return; const k = withYear(scenLabel(r.scenario), r.year); by[k] = Math.max(by[k] || 0, r.days); });
    const keys = Object.keys(by); if (!keys.length) return '—';
    const vals = uniq(Object.values(by));
    if (vals.length === 1) return `${fmt.int(vals[0])} days behind each year figure`;
    const common = vals.slice().sort((a, b) => keys.filter(k => by[k] === b).length - keys.filter(k => by[k] === a).length)[0];
    const odd = keys.filter(k => by[k] !== common);
    return `${fmt.int(common)} days behind each year figure; ${odd.map(k => `${k}: ${fmt.int(by[k])}`).join(' · ')}`;
  }
  function screenSpreads(host) {
    const d = DATA(), s = readScope('daily_tb'), ids = shapeIds();   /* orchestrator 2026-09-28 lmp continuous */
    const key = s.key;
    /* at a full-depth bus the block holds a spread for every DAY. The screen
       shows the year figure — the mean of those days, which is the same form
       the zone block publishes — and the day count says what is behind it. */
    let dayCount = null;
    let rows;
    /* continuum S0 2026-10-06: a spread is a price difference — it scales with the run's verdict, settled never */
    const tbScale = (r, bus) => scenOn() ? scaleFields(r, scenAdj(r.scenario, r.year, null, bus), ['spread_mwh']) : r;
    if (s.bus) {
      const daily = fullBlock(s.bus, 'daily_tb').filter(r => ids.includes(r.scenario)).map(r => tbScale(r, s.bus));
      /* the exported block already rolls the days into one year figure and says
         how many days were behind it; the sketch's shape is one row per day.
         A per-day row has a day key — that is the test, not the block's name. */
      const perDay = daily.some(r => r.doy != null || r.date != null);
      if (!perDay) {
        dayCount = daily.length ? Math.max(...daily.map(r => r.days || 0)) || null : null;
        rows = daily.map(r => Object.assign({ scope: 'bus', key: s.bus }, r));
      } else {
        dayCount = uniq(daily.map(r => r.doy != null ? r.doy : r.date)).length;
        const acc = {};
        daily.forEach(r => {
          const k = [r.scenario, r.year, r.market, r.duration].join('|');
          (acc[k] = acc[k] || { scenario: r.scenario, year: r.year, market: r.market, duration: r.duration,
            unit: r.unit || '$/MWh', sum: 0, n: 0 });
          if (r.spread_mwh != null) { acc[k].sum += r.spread_mwh; acc[k].n++; }
        });
        rows = Object.values(acc).map(a => ({ scope: 'bus', key: s.bus, scenario: a.scenario, year: a.year,
          market: a.market, duration: a.duration, spread_mwh: Math.round(a.sum / (a.n || 1) * 100) / 100,
          unit: a.unit, days: a.n }));
      }
    } else {
      rows = d && key ? (d.tb || []).filter(r => r.key === key && ids.includes(r.scenario)).map(r => tbScale(r, null)) : [];
    }
    rows = rows.slice().sort((a, b) => a.year - b.year || a.duration - b.duration);
    const xs = uniq(rows.map(r => r.year)).sort();
    const durs = [2, 4, 8].filter(n => rows.some(r => r.duration === n));
    const unit = uniq(rows.map(r => r.unit))[0] || '$/MWh';
    /* orchestrator 2026-09-28 lmp continuous: settled (one market) and the run(s) on one axis */
    const pair = ST.hvf && rows.some(r => isSettled(r.scenario)) && rows.some(r => !isSettled(r.scenario));
    const pmk = pair ? settledMarket(rows) : null;
    const pHist = pair ? rows.filter(r => isSettled(r.scenario) && r.market === pmk) : [];
    const pFc = pair ? rows.filter(r => !isSettled(r.scenario)) : [];
    const pHy = uniq(pHist.map(r => r.year)).sort((a, b) => a - b);
    const pFcKeys = uniq(pFc.map(r => r.scenario + '|' + r.year)).map(k => { const [sc, y] = k.split('|'); return { scenario: sc, year: +y }; }).sort((a, b) => a.year - b.year);
    const pPart = new Set(pHist.filter(partRow).map(r => r.year));
    const pX = pHy.map(y => String(y) + (pPart.has(y) ? '*' : '')).concat(pFcKeys.map(k => fcTick(pFcKeys, k)));
    if (pair) rows = pHist.concat(pFc);

    /* S-nav 2026-10-07 (review P3 25, 03-workflow BESS row): the run's TB4 against the last whole settled year's, printed
       beside the spreads — a solved run's price is flatter than a settled year's, and the ratio says by how much */
    function flatWord() {
      if (!pair) return '';
      const h4 = pHist.filter(r => r.duration === 4 && r.spread_mwh != null && !partRow(r)).sort((a, b) => a.year - b.year).pop();
      const f4 = pFc.filter(r => r.duration === 4 && r.spread_mwh != null).sort((a, b) => a.year - b.year)[0];
      return h4 && f4 && h4.spread_mwh ? ` · flatness ${scenLabel(f4.scenario)} TB4 ÷ settled ${h4.year} TB4 = ${fmt.num(f4.spread_mwh / h4.spread_mwh, 2)}` : '';
    }
    host.appendChild(panel({
      sig: CORE() ? CORE().sig('tb-spread', 'annual settled + solved', uniq(rows.map(r => r.market)).join('/') || '-') : null,
      answer: rows.length ? durs.map(dn => { const v = rows.filter(r => r.duration === dn && r.spread_mwh != null).map(r => r.spread_mwh); return v.length ? `TB${dn} ${fmt.money(Math.min(...v), 2)} to ${fmt.money(Math.max(...v), 2)}` : ''; }).filter(Boolean).join(' · ') + ` per MWh cycled` + flatWord() : '',
      id: 'spreads', wide: true, title: `Top-bottom spread by duration${pair ? ' · settled and forecast' : ''} · ${s.bus || s.missing ? scopeShort() : (key ? aggShort(s.kind, key) : scopeShort())}`,
      face: faceLine([
        ['scope', s.bus || s.missing ? `ISO-NE · ${scopeLabel()}` : key ? `ISO-NE · ${aggLabel(s.kind, key)}` : `ISO-NE · ${scopeLabel()}`],
        s.via ? ['basis', s.via] : null,
        dayCount ? ['days', daysWord(rows)] : null,
        ['scenario', ids.map(scenLabel).join(' · ')],
        ['market', uniq(rows.map(r => r.market)).join('/') || '—'],
        ['unit', `${unit} — per MWh cycled, not per MW-day`],
        ['kind', uniq(rows.map(r => r.scenario === 'hist' ? 'settled' : 'solved')).join(' · ') || '—'],
      ]),
      faceText: `ISO-NE | ${key || scopeLabel()} | TB spreads | ${unit}`,
      csv: !!rows.length,
      table: () => ({
        cols: [{ l: 'Scenario' }, { l: 'Year' }, { l: 'Market' }, { l: 'Duration' }, { l: 'Spread ' + unit }].concat(rows.some(r => r.days != null) ? [{ l: 'Days' }] : []),
        rows: rows.map(r => [scenLabel(r.scenario), r.year, r.market || '—', r.duration + ' h', fmt.num(r.spread_mwh, 2)].concat(rows.some(x => x.days != null) ? [r.days == null ? '—' : fmt.int(r.days)] : [])),
        why: 'The store holds no TB block at this scope.',
      }),
      note: `The spread is stated <b>per MWh cycled</b> (${esc(unit)}), which is what the store holds. It is not a per-MW-day revenue and multiplying it by 365 gives a number this block does not support.` +
        (pair ? ` Settled ${esc(pmk || '')} years, then ${esc(uniq(pFc.map(r => scenLabel(r.scenario))).join(', '))} on the same axis, outlined after the "last settled" divider.${hvfAdded().length ? ' The run was added beside the settled record by the History vs forecast toggle.' : ''}` : ''),
      draw: body => {
        if (s.missing) { body.appendChild(notAtBus(s, 'The top-bottom spread')); return; }
        if (!rows.length) { body.appendChild(emptyBox('No spread block here',
          !key && !s.bus ? s.via + '. Pick a zone in the picker.'
            : `No top-bottom spread is held for the selected scenarios at ${s.bus ? scopeShort() : key}.`)); return; }
        const tbC = [1, 2, 3].map(i => tok(`--gsc-tb-${i}`, host));
        if (pair) {
          const fcSet = new Set(pX.slice(pHy.length));
          const val = (i, dn) => { if (i < pHy.length) { const r = pHist.find(z => z.year === pHy[i] && z.duration === dn); return r ? r.spread_mwh : null; }
            const k = pFcKeys[i - pHy.length]; const r = pFc.find(z => z.scenario === k.scenario && z.year === k.year && z.duration === dn); return r ? r.spread_mwh : null; };
          const out = barsChart(body, { id: 'spreads-hvf', x: pX, unit, height: 220,
            series: durs.map((dn, i) => ({ label: dn + ' h', colour: tbC[i], v: pX.map((_, j) => val(j, dn)) })),
            hollow: x => fcSet.has(x), fmtY: v => fmt.num(v, 0), fmtV: v => fmt.money(v, 2) });
          if (out && pHy.length && pFcKeys.length) dividerAt(out.svg, out.geom, pHy.length - 1, pHy[pHy.length - 1], host, pPart.has(pHy[pHy.length - 1]));
          const lg = el('div', 'gsc-lg');
          durs.forEach((dn, i) => { const sp = el('span'); const ic = document.createElement('i'); ic.style.background = tbC[i]; sp.appendChild(ic); sp.appendChild(el('span', null, dn + ' hour')); lg.appendChild(sp); });
          fcLegend(lg, ids); partNote(lg, pHist); body.appendChild(lg);
          return;
        }
        /* one panel per scenario keeps the two channels — scenario and duration
           — from fighting; the duration ramp is ordered, the scenario is stated */
        ids.forEach(sid => {
          const sub = rows.filter(r => r.scenario === sid);
          if (!sub.length) return;
          const years = uniq(sub.map(r => r.year)).sort();
          const cap = el('div', 'gsc-note'); cap.innerHTML = `<b>${esc(scenLabel(sid))}</b>`;
          body.appendChild(cap);
          barsChart(body, { id: 'spreads-' + sid, x: years, unit, height: 200,
            series: durs.map((dn, i) => ({ label: dn + ' h', colour: tbC[i],
              v: years.map(y => { const r = sub.find(z => z.year === y && z.duration === dn); return r ? r.spread_mwh : null; }) })),
            fmtY: v => fmt.num(v, 0), fmtV: v => fmt.money(v, 2) });
        });
        const lg = el('div', 'gsc-lg');
        durs.forEach((dn, i) => { const sp = el('span'); const ic = document.createElement('i');
          ic.style.background = tbC[i]; sp.appendChild(ic); sp.appendChild(el('span', null, dn + ' hour')); lg.appendChild(sp); });
        body.appendChild(lg);
      },
    }));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Screen 6 · Negative hours
     ═══════════════════════════════════════════════════════════════════════ */
  /* S-nav 2026-10-07 (review P2 6): hours at or below $0 AT THE BUS from the curtailment block's price proxy
     (GS_DATA_EXT.curtailment.price, read through ext/67): settled full years at the chosen market and every solved run */
  function busNegRows(bus, mk) {
    const N = window.GSNodeCC; if (!N || typeof N.priceOf !== 'function') return null;
    let pr = null; try { pr = N.priceOf(Number(bus)); } catch (e) { pr = null; }
    if (!pr || (!(pr.settled || []).length && !(pr.solved || []).length)) return null;
    const sm = (pr.settled || []).some(r => r.market === mk) ? mk : 'RT';
    const out = (pr.settled || []).filter(r => r.market === sm).map(r => ({ scenario: 'hist', year: +r.year, market: sm, neg: r.le0, hours: r.hours,
      per_8760: r.partial ? null : r.per8760, partial: !!r.partial, le: true }))
      .concat((pr.solved || []).map(r => ({ scenario: r.run, year: +r.year, market: 'model', neg: r.le0, hours: r.hours, per_8760: r.per8760, partial: false, le: true })));
    return out.length ? out : null;
  }
  function screenNegative(host) {
    const d = DATA(), s0 = readScope('neg_hours'), mk = market();
    let s = s0, ids = selected();
    let busRows0 = null;
    if (s0.missing) { busRows0 = busNegRows(s0.key, mk); if (busRows0) { s = { kind: 'bus', key: s0.key, bus: s0.key, via: 'read at the bus itself — the price proxy in the curtailment block (hours at or below $0)' }; ids = uniq(busRows0.map(r => r.scenario)); } }
    const rows = (busRows0 || (s.bus
      ? fullBlock(s.bus, 'neg_hours').filter(r => ids.includes(r.scenario))
      : (d && s.key && !s.missing ? (d.neg_hours || []).filter(r => ids.includes(r.scenario) && r.scope === s.kind && r.key === s.key) : [])))
      .slice().sort((a, b) => a.year - b.year);
    const xs = uniq(rows.map(r => r.year)).sort();
    const partials = uniq(rows.filter(r => r.partial).map(r => r.year));

    host.appendChild(panel({
      sig: CORE() ? CORE().sig('neg-hours', 'annual settled + solved', uniq(rows.map(r => r.market)).join('/') || '-') : null,
      answer: rows.length ? (() => { const h = rows.filter(r => isSettled(r.scenario) && r.per_8760 != null), f = rows.filter(r => !isSettled(r.scenario) && r.per_8760 != null);
        return `${h.length ? `Settled ${h[0].year}–${h[h.length - 1].year}: ${fmt.int(Math.min(...h.map(r => r.per_8760)))} to ${fmt.int(Math.max(...h.map(r => r.per_8760)))} h` : 'No settled year'}${f.length ? ` · runs ${fmt.int(Math.min(...f.map(r => r.per_8760)))} to ${fmt.int(Math.max(...f.map(r => r.per_8760)))} h` : ''} per 8,760`; })() : '',
      id: 'negative', wide: true, title: `Hours at or below zero · ${s.bus || s.missing ? scopeShort() : (s.key ? aggShort(s.kind, s.key) : scopeShort())}`,
      face: faceLine([
        ['scope', s.bus || s.missing || !s.key ? `ISO-NE · ${scopeLabel()}` : `ISO-NE · ${aggLabel(s.kind, s.key)}`],
        s.via ? ['basis', s.via] : null,
        ['scenario', ids.map(scenLabel).join(' · ')],
        ['market', uniq(rows.map(r => r.market)).join('/') || '—'],
        ['hours', hoursChip(rows)],
        ['kind', uniq(rows.map(r => r.scenario === 'hist' ? 'settled' : 'solved')).join(' · ') || '—'],
      ]),
      faceText: `ISO-NE | ${scopeLabel()} | negative hours | ${mk}`,
      csv: !!rows.length,
      table: () => ({
        cols: [{ l: 'Scenario' }, { l: 'Year' }, { l: 'Negative h' }, { l: 'Hours read' }, { l: 'Per 8,760' }, { l: 'Partial' }],
        rows: rows.map(r => [scenLabel(r.scenario), r.year, fmt.int(r.neg), fmt.int(r.hours),
          r.per_8760 == null ? null : fmt.int(r.per_8760), r.partial ? 'yes' : 'no']),
        why: 'No negative-hour block is held at this scope.',
      }),
      note: partials.length
        ? `${partials.join(', ')} ${partials.length === 1 ? 'is' : 'are'} partial. The bars are the count normalised to a full 8,760 so the years compare; the raw count and the hours actually read are both in the table.`
        : 'Counts are normalised to a full 8,760 so the years compare. The raw count is in the table.',
      draw: body => {
        if (s.missing) { body.appendChild(notAtBus(s, 'Hours at or below $0')); return; }
        if (!rows.length) { body.appendChild(emptyBox('No negative-hour block here',
          !s.key && !s.bus ? s.via + '. Pick a zone or the hub in the picker.'
            : `The store holds no negative-hour rows for the selected scenarios at ${s.bus ? scopeShort() : s.key}.`)); return; }
        barsChart(body, { id: 'negative', x: xs, unit: 'hours per 8,760', height: 250,
          series: ids.filter(sid => rows.some(r => r.scenario === sid)).map(sid => ({
            label: scenLabel(sid), colour: scenColour(sid, host),
            v: xs.map(y => { const r = rows.find(z => z.year === y && z.scenario === sid); return r ? r.per_8760 : null; }) })),
          hollow: (x) => partials.includes(x),
          fmtY: v => fmt.int(v), fmtV: v => fmt.int(v) + ' h per 8,760' });
        const lg = el('div', 'gsc-lg');
        ids.filter(sid => rows.some(r => r.scenario === sid)).forEach(sid => {
          const sp = el('span'); const i = document.createElement('i');
          i.style.background = scenColour(sid, host); sp.appendChild(i);
          sp.appendChild(el('span', null, scenLabel(sid))); lg.appendChild(sp);
        });
        if (partials.length) { const sp = el('span'); const i = document.createElement('i');
          i.className = 'hollow'; sp.appendChild(i); sp.appendChild(el('span', null, 'partial year, outlined')); lg.appendChild(sp); }
        body.appendChild(lg);
      },
    }));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Screen 7 · Generation outlook, 2021 → 2050
     ═══════════════════════════════════════════════════════════════════════ */
  const BASIS_WORD = { fleet: 'fleet', retirement: 'retirement', queue_active: 'queue (active)',
    pcr_resource: 'PCR resource', escalated: 'escalated',
    settled_generation: 'settled generation', pcr_dispatch: 'PCR dispatch' };
  function fuelRing(host, fuels) {
    const ring = [1, 2, 3, 4, 5, 6, 7, 8].map(i => tok(`--gsc-fuel-${i}`, host));
    const over = tok('--gsc-fuel-x', host);
    const map = {};
    fuels.forEach((f, i) => { map[f] = i < ring.length ? ring[i] : over; });
    return { map, overflow: Math.max(0, fuels.length - ring.length) };
  }
  /** The outlook block is MWh in the exported form and was sketched as MW. The
   *  unit is read off the coverage rather than assumed, and the value off
   *  whichever key the row carries — a chart that silently labelled energy as
   *  capacity would be wrong by a factor of 8,760. */
  function outlookUnit() {
    const c = coverageOf('outlook');
    if (c.unit) return c.unit;
    const d = DATA(), r = (d && (d.outlook || [])[0]) || {};
    return r.mwh != null ? 'MWh' : 'MW';
  }
  const outlookVal = r => (r.mwh != null ? r.mwh : r.mw);

  function screenGeneration(host) {
    const d = DATA();
    const out = d ? (d.outlook || []) : [];
    const unit = outlookUnit();
    const years = uniq(out.map(r => r.year)).sort();
    /* the fuel list comes from the data, ordered by total — never a constant */
    const totals = {};
    out.forEach(r => { totals[r.fuel] = (totals[r.fuel] || 0) + (outlookVal(r) || 0); });
    const fuels = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    const { map: colour, overflow } = fuelRing(host, fuels);
    const byYF = {};
    out.forEach(r => { byYF[r.year + '|' + r.fuel] = r; });
    const bases = uniq(out.map(r => r.basis));
    const scenAt = {};
    out.forEach(r => { if (r.scenario) scenAt[r.year] = r.scenario; });
    /* 2045 and 2050 are on the axis the tab promises and carry no solved run.
       They are drawn as named empty columns, never as an escalated bar: the
       1.0816 step is a PRICE step, and multiplying a 2040 generation mix by it
       would assert a build-out nothing solved. */
    const cov = coverageOf('outlook');
    const promised = [2045, 2050].filter(y => !years.includes(y));
    const escCells = cov.escalated_cells;
    const axis = years.concat(promised).sort((a, b) => a - b);

    host.appendChild(panel({
      id: 'generation', wide: true, sig: CORE() ? CORE().sig('generation-by-fuel', 'annual 2021–2050', 'settled + solved') : null,
      title: `Generation outlook by fuel, ${axis[0] || '—'} → ${axis[axis.length - 1] || '—'}`,
      face: faceLine([
        ['scope', 'ISO-NE · whole system (the outlook block is not published per zone or per bus)'],
        ['scenario', uniq(out.map(r => r.scenario).filter(Boolean)).map(scenLabel).join(' · ') || 'basis per cell, not a scenario'],
        ['market', `n/a — ${unit === 'MWh' ? 'energy generated, not a price and not installed capacity' : 'installed capacity, not a price'}`],
        ['hours', 'n/a'],
        ['kind', bases.map(b => BASIS_WORD[b] || b).join(' · ') || '—'],
      ]),
      faceText: `ISO-NE | system | generation outlook | ${unit} by fuel`,
      csv: !!out.length,
      table: () => ({
        cols: [{ l: 'Year' }, { l: 'Fuel' }, { l: unit }, { l: 'Basis' }, { l: 'Scenario' }, { l: 'Partial' }],
        rows: out.slice().sort((a, b) => a.year - b.year || totals[b.fuel] - totals[a.fuel])
          .map(r => [r.year, r.fuel, fmt.int(outlookVal(r)), BASIS_WORD[r.basis] || r.basis,
            r.scenario ? scenLabel(r.scenario) : '—', r.partial ? 'yes' : 'no'])
          .concat(promised.map(y => [y, '—', null, 'no solved run', '—', '—'])),
        why: 'The store holds no outlook block.',
      }),
      note: `The axis is <b>${esc(unit)}</b>${unit === 'MWh' ? ' — energy generated, not installed capacity' : ''}. ` +
        `Every cell states the basis it came from: ${esc(bases.map(b => BASIS_WORD[b] || b).join(', '))}. ` +
        (() => {
          const part = uniq(out.filter(r => r.partial).map(r => r.year)).sort();
          if (!part.length) return '';
          const mons = uniq((d && d.gen_hist || []).filter(r => part.includes(r.year)).map(r => r.month)).length;
          return `<b>${part.join(', ')} ${part.length === 1 ? 'is' : 'are'} a partial year</b>${mons ? ` — ${mons} month${mons === 1 ? '' : 's'} of settled generation, not twelve` : ''}, so the column is outlined and is shorter for that reason and no other. `;
        })() +
        (promised.length
          ? `<b>${promised.join(' and ')} carry no solved run</b> and are drawn as named empty columns, not as escalated bars. ` +
            (escCells != null ? `The block reports ${esc(String(escCells))} escalated cell${escCells === 1 ? '' : 's'}. ` : '') +
            (cov.reason ? esc(cov.reason) + ' ' : '')
          : '') +
        `Each band is labelled at its right edge rather than by legend alone: eight bands cannot clear a pairwise ΔE00 of 15 in the Studio's series tokens, so the label is the discriminator and the hue is the aid.` +
        (overflow ? ` ${overflow} fuel${overflow === 1 ? '' : 's'} beyond the eighth share one grey — they are named in the table.` : ''),
      draw: body => {
        if (!out.length) { body.appendChild(emptyBox('No outlook block',
          reasonFor('outlook', 'The cathy block holds no `outlook` rows.'))); return; }
        stackChart(body, { id: 'generation', x: axis, unit, height: 320, labelRight: true,
          ghost: promised, ghostLabel: 'no solved run',
          series: fuels.map(f => ({ label: f, colour: colour[f],
            v: axis.map(y => outlookVal(byYF[y + '|' + f] || {}) || 0) })),
          /* a partial year is a SHORTER year, not a smaller fleet: its column is
             outlined so a reader cannot take the dip for a fall in output */
          hollow: (y, s) => { const r = byYF[y + '|' + s.label]; return !!r && (r.partial || r.basis === 'escalated'); },
          basisAt: (y, s) => {
            const r = byYF[y + '|' + s.label];
            if (!r) return null;
            return (BASIS_WORD[r.basis] || r.basis) + (r.scenario ? ` · ${scenLabel(r.scenario)}` : '');
          },
          fmtY: v => fmt.compact(v), fmtV: v => fmt.int(v) + ' ' + unit });
        const lg = el('div', 'gsc-lg');
        fuels.forEach(f => { const sp = el('span'); const i = document.createElement('i');
          i.style.background = colour[f]; sp.appendChild(i); sp.appendChild(el('span', null, f)); lg.appendChild(sp); });
        if (promised.length) { const sp = el('span'); const i = document.createElement('i');
          i.className = 'hollow'; sp.appendChild(i);
          sp.appendChild(el('span', null, `${promised.join(' / ')} — no solved run`)); lg.appendChild(sp); }
        const part = uniq(out.filter(r => r.partial).map(r => r.year)).sort();
        if (part.length) { const sp = el('span'); const i = document.createElement('i');
          i.className = 'hollow'; sp.appendChild(i);
          sp.appendChild(el('span', null, `${part.join(', ')} — partial year, outlined`)); lg.appendChild(sp); }
        body.appendChild(lg);
      },
    }));

    /* the modelled load, imports and exports — never bands on the fuel stack */
    const ng = d ? (d.gen_not_generation || []) : [];
    if (ng.length) host.appendChild(panel({
      id: 'notgen', wide: true, title: 'Modelled load, imports and exports — not generation',   // S-nav: alone on its row it left half the width empty
      face: faceLine([
        ['scope', 'ISO-NE · whole system'],
        ['scenario', uniq(ng.map(r => r.scenario)).map(scenLabel).join(' · ')],
        ['market', 'solved dispatch'], ['hours', hoursChip(ng)],
        ['kind', 'solved · split out of the resource table by unit type'],
      ]),
      faceText: 'ISO-NE | system | demand, import, export',
      csv: true,
      table: () => ({
        cols: [{ l: 'Scenario' }, { l: 'Year' }, { l: 'What' }, { l: 'MWh' }, { l: 'Units' }, { l: 'Capacity MW' }],
        rows: ng.map(r => [scenLabel(r.scenario), r.year, r.fuel, fmt.int(r.mwh), fmt.int(r.units), fmt.int(r.capacity_mw)]),
      }),
      tableOnly: true,
      note: 'These rows sit in the same resource table as the generators and carry a blank fuel string. Summed by fuel they would be the largest band on the stack above — the modelled load alone is about half of everything in the table. They are published here under their own names instead.',
      draw: () => { },
    }));

    /* the margin-share view */
    const mg = d ? (d.marginal || []) : [];
    const mScen = uniq(mg.map(r => r.scenario));
    const mYears = uniq(mg.map(r => r.year)).sort();
    const mFuels = uniq(mg.map(r => r.fuel));
    const mColour = fuelRing(host, fuels.filter(f => mFuels.includes(f)).concat(mFuels.filter(f => !fuels.includes(f)))).map;
    const mCov = coverageOf('marginal');
    /* `share` arrives as a fraction in the exported block and was sketched as a
       percentage. Read the grain off the data, never off the field name. */
    const asFraction = mg.length && Math.max(...mg.map(r => r.share || 0)) <= 1.5;
    const pct = r => r.share == null ? null : (asFraction ? r.share * 100 : r.share);
    const onMargin = r => (r.marginal_n != null ? r.marginal_n : r.hours);
    const grainWord = mCov.grain || (mg.length && mg[0].intervals != null
      ? 'the source\'s own observation intervals' : 'hours');
    host.appendChild(panel({
      id: 'margin', wide: true, sig: CORE() ? CORE().sig('marginal-fuel', 'annual', 'settled') : null, title: 'Share of intervals on the margin, by fuel',
      face: faceLine([
        ['scope', 'ISO-NE · whole system'],
        ['scenario', mScen.map(scenLabel).join(' · ') || '—'],
        ['market', 'as the marginal-fuel record states it'],
        ['hours', mg.length ? `${fmt.int(uniq(mg.map(r => r.intervals).filter(Boolean))[0] || 0)} intervals a year — ${esc(String(grainWord)).slice(0, 90)}` : '—'],
        ['kind', mScen.includes('hist') && mScen.length === 1 ? 'settled only' : 'as stored'],
      ]),
      faceText: 'ISO-NE | system | marginal fuel share',
      csv: !!mg.length,
      table: () => ({
        cols: [{ l: 'Scenario' }, { l: 'Year' }, { l: 'Fuel' }, { l: 'On the margin' }, { l: 'Intervals' }, { l: 'Share %' }],
        rows: mg.map(r => [scenLabel(r.scenario), r.year, r.fuel, fmt.int(onMargin(r)),
          r.intervals == null ? null : fmt.int(r.intervals), pct(r) == null ? null : fmt.num(pct(r), 2)]),
        why: reasonFor('marginal', 'The store holds no marginal-fuel block.'),
      }),
      note: 'Share is the count on the margin over the intervals observed in that year, as the block states them — <b>not</b> a share of 8,760 hours. ' +
        (mCov.reason ? esc(mCov.reason) : '') +
        ' A fuel that never sets price shows as an absent band, not a zero-height one.',
      draw: body => {
        if (!mg.length) { body.appendChild(emptyBox('No marginal-fuel block',
          reasonFor('marginal', 'The cathy block holds no `marginal` rows.'))); return; }
        const xs = mScen.flatMap(s => mYears.filter(y => mg.some(r => r.scenario === s && r.year === y))
          .map(y => mScen.length > 1 ? `${scenLabel(s)} ${y}` : String(y)));
        const keyed = {};
        mg.forEach(r => { keyed[`${mScen.length > 1 ? scenLabel(r.scenario) + ' ' : ''}${r.year}|${r.fuel}`] = r; });
        stackChart(body, { id: 'margin', x: xs, unit: '% of intervals', height: 240, labelRight: true,
          series: mFuels.map(f => ({ label: f, colour: mColour[f] || tok('--gsc-fuel-x', host),
            v: xs.map(x => { const r = keyed[x + '|' + f]; return r ? (pct(r) || 0) : 0; }) })),
          fmtY: v => fmt.num(v, 0), fmtV: v => fmt.num(v, 2) + '%' });
      },
    }));

    /* retirements and additions, the two things that move the stack */
    const rt = d ? (d.retirements || []) : [];
    host.appendChild(panel({
      id: 'retire', title: 'Retirements on record',
      face: faceLine([['scope', 'ISO-NE'], ['rows', String(rt.length)],
        ['kind', 'announced / filed, as the store holds them']]),
      faceText: 'ISO-NE | retirements',
      note: esc(reasonFor('retirements', '')),
      csv: !!rt.length,
      table: () => ({ cols: [{ l: 'Plant' }, { l: 'Fuel' }, { l: 'Zone' }, { l: 'MW' }, { l: 'Year' }, { l: 'Month' }],
        rows: rt.slice().sort((a, b) => a.year - b.year || a.month - b.month)
          .map(r => [r.plant, r.fuel, r.zone, fmt.int(r.mw), r.year, r.month]),
        why: 'The store holds no retirement rows.' }),
      tableOnly: !!rt.length,
      draw: body => body.appendChild(emptyBox('No retirement rows', 'uni.dim_retirement is not in this block.')),
    }));
    const ad = d ? (d.additions || []) : [];
    host.appendChild(panel({
      id: 'additions', sig: CORE() ? CORE().sig('queue-additions', 'by in-service year', '-') : null, title: 'Queue additions by expected in-service year',
      face: faceLine([['scope', 'ISO-NE'], ['rows', String(ad.length)],
        ['kind', 'active queue positions — nameplate, not a delivery forecast']]),
      faceText: 'ISO-NE | queue additions',
      csv: !!ad.length,
      table: () => ({ cols: [{ l: 'Year' }, { l: 'Fuel' }, { l: 'MW' }, { l: 'Projects' }, { l: 'Status' }],
        rows: ad.slice().sort((a, b) => a.year - b.year).map(r => [r.year, r.fuel, fmt.int(r.mw), fmt.int(r.n), r.status]),
        why: 'The store holds no queue additions.' }),
      note: 'Nameplate on active positions. What the queue actually builds is a smaller number and this block does not carry it. ' +
        (() => {
          const c = coverageOf('additions'), r = c.register;
          if (!r) return esc(c.note || '');
          return 'Register: ' + Object.entries(r).map(([k, v]) =>
            `${esc(k)} ${fmt.int(v && v.n != null ? v.n : v)}`).join(' · ') + '.';
        })(),
      draw: body => {
        if (!ad.length) { body.appendChild(emptyBox('No queue additions', 'acquired.queue is not in this block.')); return; }
        const years = uniq(ad.map(r => r.year)).sort();
        const fl = uniq(ad.map(r => r.fuel));
        const c = fuelRing(host, fl).map;
        const keyed = {}; ad.forEach(r => { keyed[r.year + '|' + r.fuel] = r; });
        stackChart(body, { id: 'additions', x: years, unit: 'MW nameplate', height: 210, labelRight: true,
          series: fl.map(f => ({ label: f, colour: c[f], v: years.map(y => (keyed[y + '|' + f] || {}).mw || 0) })),
          fmtY: v => fmt.compact(v), fmtV: v => fmt.int(v) + ' MW' });
      },
    }));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Screen 8 · Capacity & gas
     ═══════════════════════════════════════════════════════════════════════ */
  /* cardfix 2026-09-27 (audit G6): the store holds no ISO-NE auction rows (its capacity table is
     PJM-only), so the panel said "not held" at every scope while the revenue calculator (6.30)
     already carries the vault-cited FCA 15–18 clears in GSX_REVENUE_ASSUMPTIONS.cap_price. Where
     the store is empty, those clears are drawn — parsed out of that row's own source text, never
     typed here — and labelled "cited (ISO-NE FCA results), not store". Quoted document titles are
     masked before matching, so "…Results of FCA 18" inside a title is never read as a clear. */
  const CITED_WORD = 'cited (ISO-NE FCA results), not store';
  function citedFca() {
    const T = window.GSX_REVENUE_ASSUMPTIONS;
    const row = T && Array.isArray(T.rows) ? T.rows.find(r => r && r.id === 'cap_price') : null;
    if (!row || typeof row.source !== 'string') return null;
    const src = row.source, out = [];
    const masked = src.replace(/"[^"]*"/g, q => '"' + ' '.repeat(q.length - 2) + '"');
    const rx = /FCA (\d{1,2})\b([^$]{0,60}?)\$(\d+(?:\.\d+)?)(?:\/kW-month)?(,?\s(?:all zones|system)\b)?/g;
    let m;
    while ((m = rx.exec(masked))) {
      const par = /\(([^)]*)\)/.exec(m[2]);
      const zone = m[2].replace(/\([^)]*\)/g, '').trim() || (m[4] || '').replace(/^,?\s*/, '') || 'zone not stated in the citation';
      const cm = /ISO_Knowledge_Vault\/(\S+?\.(?:md|db))((?:\s§[\d.]+(?:\sand\s§[\d.]+)*)?)(?:\s·\s"([^"]+)")?/.exec(src.slice(m.index + m[0].length));
      out.push({ auction: +m[1], zone, price: +m[3], when: par ? par[1] : null,
        cite: cm ? `vault/${cm[1]}${cm[2] || ''}${cm[3] ? ` · "${cm[3]}"` : ''}` : 'the revenue calculator\'s capacity row (card 6.30)',
        doc: cm && cm[3] ? cm[3] : null });
    }
    if (!out.length) return null;
    out.sort((a, b) => a.auction - b.auction || a.price - b.price);
    const held = ['low', 'base', 'high'].filter(k => row[k] != null && !out.some(r => Math.abs(r.price - row[k]) < 5e-4));
    return { row, rows: out, unmatched: held };
  }
  const fcaLabel = r => `FCA ${r.auction} · ${r.zone}`;
  /** a vault catalogue path in reader text becomes the vault's name; the document title stays (continuum fix 2026-10-06, D13) */
  const plainCite = t => String(t || '').replace(/(?:04 Market Research\/)?ISO_Knowledge_Vault\/\S+?\.db\s*·\s*/g, 'ISO Knowledge Vault · ');
  function screenCapacity(host) {
    const d = DATA();
    const ca = d ? (d.capacity_auction || []) : [];
    const auctions = uniq(ca.map(r => r.auction));
    const czones = uniq(ca.map(r => r.zone));
    const CI = ca.length ? null : citedFca();
    host.appendChild(panel({
      id: 'fca', wide: true, sig: CORE() ? CORE().sig('capacity-price', 'by auction', '-') : null, title: 'Forward Capacity Auction results',
      face: faceLine([
        ['scope', czones.length ? `ISO-NE · ${czones.length} capacity zone${czones.length === 1 ? '' : 's'}` : CI ? `ISO-NE · FCA ${CI.rows[0].auction}–${CI.rows[CI.rows.length - 1].auction} · ${CI.rows.length} cited clears` : 'ISO-NE · nothing held'],
        ['scenario', ca.length ? 'cleared results, not a forecast' : CI ? 'cleared results as cited, not a forecast' : 'none — the reason is below'],
        ['market', 'FCM'], ['hours', 'n/a'],
        ['kind', ca.length ? 'settled' : CI ? CITED_WORD : 'settled'],
      ]),
      faceText: ca.length || !CI ? 'ISO-NE | FCA cleared results' : `ISO-NE | FCA cleared results | ${CITED_WORD}`,
      csv: !!ca.length || !!CI,
      table: () => (ca.length || !CI ? {
        cols: [{ l: 'Auction' }, { l: 'Delivery' }, { l: 'Zone' }, { l: '$/kW-month' }, { l: 'Cleared MW' }],
        rows: ca.map(r => [r.auction, r.delivery_period, r.zone, fmt.num(r.price, 2), fmt.int(r.cleared_mw)]),
        why: 'The store holds no capacity-auction rows.',
      } : {
        cols: [{ l: 'Auction' }, { l: 'Zone as cited' }, { l: '$/kW-month' }, { l: 'Held as' }, { l: 'Cited from' }],
        rows: CI.rows.map(r => [`FCA ${r.auction}${r.when ? ` (${r.when})` : ''}`, r.zone, fmt.num(r.price, 3), CITED_WORD, r.cite]),
        why: 'Neither the store nor the revenue assumption table holds an ISO-NE clear.',
      }),
      /* the reason lives in the empty state, and ONCE: printing it in the note
         as well is the same sentence twice on one card */
      note: ca.length
        ? 'Cleared prices as published, per kW-month. They are not an energy price and do not belong on the price explorer\'s axis.'
        : CI ? esc(`Clears ${CITED_WORD}: read from the revenue calculator's capacity row (card 6.30, researched ${(window.GSX_REVENUE_ASSUMPTIONS.meta || {}).researched || 'date not stated'}), each with the vault document it cites. Per kW-month, not an energy price.${CI.row.note ? ' ' + plainCite(CI.row.note) : ''}${CI.unmatched.length ? ` The row's ${CI.unmatched.join(', ')} figure is not among the clears parsed from its source.` : ''}`) : '',
      draw: body => {
        if (!ca.length) {
          const cv = coverageOf('capacity_auction');
          const inStore = cv.rows_in_store && Object.entries(cv.rows_in_store)
            .map(([k, v]) => `${k} ${fmt.int(v)}`).join(', ');
          const why = reasonFor('capacity_auction', 'The cathy block holds no `capacity_auction` rows and gives no reason.') +
            (inStore ? ` Rows in the source table: ${inStore}.` : '');
          if (!CI) {
            body.appendChild(emptyBox('No ISO-NE capacity-auction result is held', why +
              ' Nothing is drawn in its place, and no other market stands in for it.'));
            return;
          }
          const tag = el('div', 'gsc-cited'); tag.setAttribute('data-gsc-cited', 'fca'); tag.style.cssText = 'font-size:12px;line-height:1.45;margin:0 0 8px';
          tag.appendChild(el('b', null, CITED_WORD));
          tag.appendChild(el('span', null, ` · the store holds no ISO-NE auction row: ${why}`));
          body.appendChild(tag);
          barsChart(body, { id: 'fca', x: CI.rows.map(fcaLabel), unit: '$/kW-month', height: 230,
            series: [{ label: CITED_WORD, colour: tok('--gsc-tb-1', host), v: CI.rows.map(r => r.price) }],
            fmtY: v => fmt.num(v, 1), fmtV: v => '$' + fmt.num(v, 3) + '/kW-mo', aria: 'Cited FCA clears, $/kW-month' });
          const lg = el('div', 'gsc-lg');
          /* the document path stays in Show table / the CSV ("Cited from"); the legend names the document */
          CI.rows.forEach(r => { const sp = el('span'); sp.appendChild(el('span', null, `${fcaLabel(r)} $${fmt.num(r.price, 3)}${r.when ? ` (${r.when})` : ''}${r.doc ? ` — "${r.doc}"` : ''}`)); lg.appendChild(sp); });
          body.appendChild(lg);
          return;
        }
        const cols = [1, 2, 3].map(i => tok(`--gsc-tb-${i}`, host));
        barsChart(body, { id: 'fca', x: auctions, unit: '$/kW-month', height: 230,
          series: czones.map((z, i) => ({ label: z, colour: cols[i % cols.length],
            v: auctions.map(a => { const r = ca.find(x => x.auction === a && x.zone === z); return r ? r.price : null; }) })),
          fmtY: v => fmt.num(v, 1), fmtV: v => '$' + fmt.num(v, 2) + '/kW-mo' });
        const lg = el('div', 'gsc-lg');
        czones.forEach((z, i) => { const sp = el('span'); const ic = document.createElement('i');
          ic.style.background = cols[i % cols.length]; sp.appendChild(ic); sp.appendChild(el('span', null, z)); lg.appendChild(sp); });
        body.appendChild(lg);
      },
    }));

    const gs = d ? (d.gas || []) : [];
    const hubs = uniq(gs.map(r => r.hub));
    const months = uniq(gs.map(r => r.month)).sort();
    host.appendChild(panel({
      id: 'gas', wide: true, sig: CORE() ? CORE().sig('gas-price', 'monthly', '-') : null, title: hubs.length === 1 ? `${hubs[0].replace(/_/g, ' ')} gas price, monthly — the only hub held` : 'Gas hub prices, monthly',
      face: faceLine([
        ['scope', hubs.join(' · ') || 'ISO-NE gas hubs'],
        ['scenario', 'settled monthly averages'], ['market', 'gas daily, rolled to month'],
        ['hours', 'n/a'], ['kind', 'settled'],
      ]),
      faceText: 'ISO-NE | gas hub monthly prices',
      csv: !!gs.length,
      table: () => ({ cols: [{ l: 'Hub' }, { l: 'Month' }, { l: '$/MMBtu' }],
        rows: gs.map(r => [r.hub, r.month, fmt.num(r.price, 2)]),
        why: 'The store holds no gas-price rows.' }),
      note: 'Gas is the input the 12% gas case names. A $/MMBtu is not a $/MWh and the two never share an axis here. '
        + esc(reasonFor('gas', '')),
      draw: body => {
        if (!gs.length) { body.appendChild(emptyBox('No gas-price rows',
          reasonFor('gas', 'The cathy block holds no `gas` rows.'))); return; }
        const cols = [tok('--gsc-sc-1', host), tok('--gsc-sc-2', host), tok('--gsc-sc-3', host)];
        const keyed = {}; gs.forEach(r => { keyed[r.hub + '|' + r.month] = r; });
        barsChart(body, { id: 'gas', x: months, unit: '$/MMBtu', height: 240,
          series: hubs.map((h, i) => ({ label: h, colour: cols[i % cols.length],
            v: months.map(m => (keyed[h + '|' + m] || {}).price ?? null) })),
          fmtY: v => fmt.num(v, 1), fmtV: v => '$' + fmt.num(v, 2) + '/MMBtu' });
        const lg = el('div', 'gsc-lg');
        hubs.forEach((h, i) => { const sp = el('span'); const ic = document.createElement('i');
          ic.style.background = cols[i % cols.length]; sp.appendChild(ic); sp.appendChild(el('span', null, h)); lg.appendChild(sp); });
        body.appendChild(lg);
      },
    }));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Screen 9 · Export
     ═══════════════════════════════════════════════════════════════════════ */
  const LAST = { csv: null, png: null, name: null, rows: 0 };
  /** the download's name carries the tab's name, not its code identifier */
  const fileStem = () => NAME().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'cathy';


  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;                      // never a live formula in a download
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function csvFor(pid) {
    const x = EXPORTS[pid]; if (!x) return null;
    const t = x.table(); if (!t) return null;
    const m = META() || {};
    /* Provenance lines are comments, and a comment that starts with a quote
       because it happened to contain a comma is not one: every tool that skips
       `#` lines would read it as data. They are emitted raw, with commas and
       newlines flattened, so the first character really is `#`. */
    const cmt = s => '# ' + String(s).replace(/[\r\n]+/g, ' ').replace(/,/g, ' ·').trim();
    const head = [
      cmt(`GridSense · ${NAME()} — ${x.title}`),
      cmt(x.face || 'no face line recorded'),
      x.scen ? cmt(x.scen) : null,   // continuum S0 2026-10-06: the scenario line, only when one other than Base is chosen
      cmt(`built ${m.built_at || 'unknown'}${m.fixture ? '  *** TEST FIXTURE — no figure below is a GridSense number ***' : ''}`),
      cmt(`downloaded ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`),
    ].filter(Boolean);
    const body = [t.cols.map(c => c.l)].concat(t.rows.map(r => r.map(v => v == null ? '' : v)))
      .map(r => r.map(csvCell).join(','));
    return { text: head.concat(body).join('\n'), rows: t.rows.length };
  }
  function exportCsv(pid) {
    const out = csvFor(pid);
    if (!out) { A.toast('Nothing to export from this panel — it holds no rows.'); return; }
    const name = `${fileStem()}_${pid}_${String(scopeShort()).replace(/\W+/g, '')}_${selected().join('-')}${scenOn() ? '_' + ST.scenario : ''}.csv`;
    LAST.csv = out.text; LAST.name = name; LAST.rows = out.rows;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out.text], { type: 'text/csv;charset=utf-8' }));
    a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    A.toast(`${fmt.int(out.rows)} row${out.rows === 1 ? '' : 's'} downloaded as ${name} — exactly the rows on screen.`);
  }
  function exportPng(pid) {
    const body = ROOT && ROOT.querySelector(`[data-gsc-body="${pid}"]`);
    const cv = body && body.querySelector('canvas');
    const svg = body && body.querySelector('svg');
    const done = (blob, how) => {
      if (!blob) { A.toast('That panel has no chart to save — it is in table view, or it is empty.'); return; }
      const name = `${fileStem()}_${pid}_${String(scopeShort()).replace(/\W+/g, '')}.png`;
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      a.style.display = 'none'; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      LAST.png = name;
      A.toast(`Chart saved as ${name} (${how}).`);
    };
    if (cv) { cv.toBlob(b => done(b, 'canvas')); return; }
    if (!svg) { done(null); return; }
    /* the SVG reads its colours from tokens, so they have to be frozen into the
       clone before it leaves the document or the PNG comes out unstyled */
    const clone = svg.cloneNode(true);
    const ink = tok('--ink-4'), grid = tok('--grid-line'), axis = tok('--axis'), bg = tok('--surface');
    clone.querySelectorAll('.gsc-ax,.gsc-axl').forEach(n => { n.setAttribute('fill', n.getAttribute('fill') || ink); n.setAttribute('font-family', 'monospace'); n.setAttribute('font-size', '10'); });
    clone.querySelectorAll('.gsc-grid').forEach(n => n.setAttribute('stroke', grid));
    clone.querySelectorAll('.gsc-axis').forEach(n => n.setAttribute('stroke', axis));
    const vb = (svg.getAttribute('viewBox') || '0 0 800 300').split(/\s+/).map(Number);
    clone.setAttribute('width', vb[2]); clone.setAttribute('height', vb[3]);
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', 0); rect.setAttribute('y', 0); rect.setAttribute('width', vb[2]);
    rect.setAttribute('height', vb[3]); rect.setAttribute('fill', bg);
    clone.insertBefore(rect, clone.firstChild);
    const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const k = Math.min(3, window.devicePixelRatio || 1) * 2;
      c.width = vb[2] * k; c.height = vb[3] * k;
      const g = c.getContext('2d'); g.scale(k, k); g.drawImage(img, 0, 0);
      c.toBlob(b => done(b, 'svg → png at ' + k + '×'));
    };
    img.onerror = () => done(null);
    img.src = src;
  }

  function screenExport(host) {
    const ids = Object.keys(EXPORTS);
    const m = META() || {};
    host.appendChild(panel({
      id: 'export', wide: true, title: 'Export — the rows on screen, and the chart',
      face: faceLine([
        ['scope', `ISO-NE · ${scopeLabel()}`],
        ['scenario', selected().map(scenLabel).join(' · ')],
        ['market', market()], ['hours', 'as each panel states'],
        ['kind', m.fixture ? 'TEST FIXTURE — nothing here is a GridSense number' : 'as each panel states'],
      ]),
      draw: body => {
        const intro = el('div', 'gsc-note');
        intro.innerHTML = 'A download is the rows the panel actually drew, never a second query. ' +
          'The first four lines of every CSV are the panel title, its face line, the block\'s build stamp and the download time, ' +
          'each behind a <code>#</code>. A cell starting <code>= + - @</code> is prefixed with an apostrophe so no spreadsheet executes it.';
        body.appendChild(intro);
        if (!ids.length) { body.appendChild(emptyBox('Nothing is loaded to export',
          'Open a screen first — Export lists whatever the screen you came from had on it.')); return; }
        const sc = el('div', 'gsc-scroll');
        const t = el('table', 'gsc-tbl');
        t.innerHTML = '<thead><tr><th>Panel</th><th>Rows</th><th>CSV</th><th>PNG</th></tr></thead>';
        const bd = el('tbody');
        ids.forEach(pid => {
          const x = EXPORTS[pid];
          let n = 0; try { const tt = x.table && x.table(); n = tt ? tt.rows.length : 0; } catch (e) { n = 0; }
          const tr = el('tr');
          const c0 = el('td', 't', x.title); tr.appendChild(c0);
          tr.appendChild(el('td', null, fmt.int(n)));
          const c2 = el('td'); const b1 = el('button', 'gsc-btn', 'Download CSV'); b1.type = 'button';
          b1.setAttribute('data-gsc-export-csv', pid); b1.disabled = !n; b1.onclick = () => exportCsv(pid);
          c2.appendChild(b1); tr.appendChild(c2);
          const c3 = el('td'); const b2 = el('button', 'gsc-btn', 'Download PNG'); b2.type = 'button';
          b2.setAttribute('data-gsc-export-png', pid); b2.onclick = () => exportPng(pid);
          c3.appendChild(b2); tr.appendChild(c3);
          bd.appendChild(tr);
        });
        t.appendChild(bd); sc.appendChild(t); body.appendChild(sc);
      },
    }));

    /* what the block holds and does not, so the reader never guesses */
    host.appendChild(panel({
      id: 'coverage', wide: true, title: 'What this block holds',
      face: faceLine([['built', m.built_at || 'unknown'],
        ['source', m.fixture ? 'TEST FIXTURE' : (m.source || 'GridSense one-store')],
        ['scenarios', `${SCENARIOS().filter(s => s.held).length} held · ${SCENARIOS().filter(s => !s.held).length} not held`]]),
      draw: body => {
        const cov = m.coverage || {};
        /* the exported coverage is one object per block; its row count and its
           own reason are what a reader needs, never "[object Object]" */
        const show = v => Array.isArray(v) ? v.join(', ')
          : typeof v === 'number' ? fmt.int(v)
            : v && typeof v === 'object'
              ? [v.rows != null ? `${fmt.int(v.rows)} rows` : v.buses != null ? `${fmt.int(v.buses)} buses` : null,
                v.reason || v.note || null].filter(Boolean).join(' — ') || Object.keys(v).join(', ')
              : String(v);
        const rows = Object.keys(cov).map(k => [k.replace(/_/g, ' '), show(cov[k])]);
        rows.push(['scenarios not held', SCENARIOS().filter(s => !s.held).map(s => s.label).join(', ') || 'none']);
        renderTable(body, { cols: [{ l: 'Measure' }, { l: 'Value' }], rows });
      },
    }));
  }

  /* ═══════════════════════════════════════════════════════════════════════
     The picker rail — NodeScope's node list
     ═══════════════════════════════════════════════════════════════════════ */
  function pickerOptions() {
    const d = DATA(); if (!d) return [];
    const out = [{ kind: 'hub', key: hubKey(), name: hubLabel(), sub: 'system hub' }];
    zones().forEach(z => out.push({ kind: 'zone', key: z, name: z, sub: 'load zone' }));
    busIds().forEach(id => {
      const n = GS.node(id);
      const tier = busTier(id);
      const c = depthChip(id);
      out.push({ kind: 'bus', key: id, name: n ? `${n.name} ${n.kv} kV` : `bus ${id}`,
        sub: `#${id}${n && n.zone ? ' · ' + n.zone : ''}${tier ? ' · ' + tier.replace(/_/g, ' ') : ''}` +
          (c.proxy ? ' · ' + c.text : '') });
    });
    return out;
  }
  function picker() {
    const rail = el('div'); rail.id = 'gsc-pick';
    const d = DATA(), m = META();

    const s1 = el('div', 'gsc-sec');
    s1.appendChild(el('span', 'gsc-e', 'ISO'));
    const iso = el('div');
    iso.innerHTML = `<b style="font-size:13px">ISO-NE</b>` +
      `<div style="font-size:11px;color:var(--ink-3);font-family:var(--mono);margin-top:2px">` +
      `America/New_York · ${esc(String(zones().length))} zone · 1 hub · ${esc(fmt.int(busIds().length))} bus` +
      (m && m.built_at ? ` · built ${esc(m.built_at)}` : '') + `</div>`;
    s1.appendChild(iso);
    rail.appendChild(s1);

    const s2 = el('div', 'gsc-sec');
    s2.appendChild(el('span', 'gsc-e', 'Scope'));
    const sel = el('div', 'gsc-sel');
    sel.setAttribute('data-gsc-scope', scope().kind);
    sel.innerHTML = `<b>${esc(scopeShort())}</b><span>${esc(scope().kind)} · ${esc(String(scope().key))}</span>`;
    s2.appendChild(sel);
    try { const gd = window.GSGridDepth && GSGridDepth.continuumChip ? GSGridDepth.continuumChip() : null; if (gd) s2.appendChild(gd); } catch (e) { console.warn('[cathy] grade chip: ' + ((e && e.message) || e)); }   // step4-ui 2026-10-08: the bus's evidence grade under the scope (ext/69)
    rail.appendChild(s2);

    const s3 = el('div', 'gsc-sec');
    const find = el('div', 'gsc-find');
    const q = document.createElement('input'); q.type = 'text'; q.placeholder = 'Search zone, hub or bus…';
    q.value = ST.query; q.setAttribute('data-gsc-search', 'true');
    q.oninput = () => { ST.query = q.value; store(); repaintList(); };
    const lv = document.createElement('select'); lv.setAttribute('data-gsc-level', 'true');
    [['all', 'All levels'], ['hub', 'Hub'], ['zone', 'Zones'], ['bus', 'Buses']].forEach(([v, l]) => {
      const o = document.createElement('option'); o.value = v; o.textContent = l;
      if (ST.level === v) o.selected = true; lv.appendChild(o);
    });
    lv.onchange = () => { ST.level = lv.value; store(); repaintList(); };
    find.appendChild(q); find.appendChild(lv);
    s3.appendChild(find);
    rail.appendChild(s3);

    const list = el('div'); list.id = 'gsc-list';
    rail.appendChild(list);
    const count = el('div', 'gsc-count'); count.setAttribute('data-gsc-count', 'true');
    rail.appendChild(count);

    function repaintList() {
      list.innerHTML = '';
      const t = (ST.query || '').trim().toLowerCase();
      const all = pickerOptions();
      const rows = all.filter(o => (ST.level === 'all' || o.kind === ST.level) &&
        (!t || o.name.toLowerCase().includes(t) || String(o.key).toLowerCase().includes(t) || o.sub.toLowerCase().includes(t)));
      if (!rows.length) {
        list.appendChild(el('div', 'gsc-none', d ? 'Nothing matches. Buses match on name, number or zone.'
          : 'The cathy block is not in this build, so there is nothing to pick.'));
      }
      rows.forEach(o => {
        const b = el('button', 'gsc-opt'); b.type = 'button';
        b.dataset.gscKind = o.kind; b.dataset.gscKey = String(o.key);
        const on = scope().kind === o.kind && String(scope().key) === String(o.key);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        const body = el('div');
        body.appendChild(el('div', 't', o.name));
        body.appendChild(el('div', 's', o.sub));
        b.appendChild(body);
        if (o.kind === 'bus' && hasFull(o.key)) {
          const c = depthChip(o.key);
          const f = el('span', 'gsc-kind', c.proxy ? 'proxy' : 'full');
          f.title = c.proxy ? `Full depth — ${c.text}` : 'Full depth: the hourly record, daily spreads, the duration curve, the make-up and the negative-hour count all at this bus';
          b.appendChild(f);
        }
        b.appendChild(el('span', 'gsc-kind', o.kind));
        b.onclick = () => {
          ST.scopeKind = o.kind; ST.scopeKey = o.key; ST.surfYear = null; store(); paint();
        };
        list.appendChild(b);
      });
      count.textContent = `${fmt.int(rows.length)} of ${fmt.int(all.length)}`;
    }
    repaintList();

    /* S-nav 2026-10-07: Export view is the main row's action (one place, not two); hub-relative basis is Offtake's fan */
    return rail;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     The scenario strip
     ═══════════════════════════════════════════════════════════════════════ */
  /** the chip's short name: "Settled" · "PROBE 5-yr" · "PCR 2030" · "PCR 2040 · 12% gas case" (the case name stays) */
  function chipLabel(id) {
    let m;
    if (isSettled(id)) return 'Settled';
    if ((m = /^(\d+)yr$/i.exec(String(id)))) return `${m[1]}-yr`;
    return scenLabel(id);
  }
  function strip() {
    const s = el('div'); s.id = 'gsc-strip'; s.setAttribute('data-gsc', 'strip');
    s.appendChild(el('span', 'gsc-lab', 'Runs'));   // continuum S0 2026-10-06: the scenario row is its own, below
    const all = SCENARIOS();
    if (!all.length) {
      s.appendChild(el('span', 'gsc-nh', 'The cathy block carries no scenario list — nothing can be selected.'));
      return s;
    }
    const sel = selected();
    /* S-nav 2026-10-07: once the proxies are read, the "not held" chips go — the Scenario chips beside them say what is
       held for High Gas / High Load (a proxy), and two chips contradicting each other on one row read as a bug */
    const S0 = SCN(), proxied = !!(S0 && S0.state === 'ok' && S0.list().some(e => e.kind === 'proxy'));
    all.forEach(sc => {
      if (!sc.held && proxied) return;
      const b = el('button', 'gsc-chip'); b.type = 'button';
      b.dataset.gscScenario = sc.id;
      b.dataset.held = sc.held ? 'true' : 'false';
      const sw = el('span', 'gsc-sw'); b.appendChild(sw);
      const lab = chipLabel(sc.id);   // S-nav 2026-10-07: short on the chip, the full name in its title
      b.appendChild(el('span', null, lab));
      if (sc.target_year && lab.indexOf(String(sc.target_year)) < 0) b.appendChild(el('span', null, String(sc.target_year)));
      if (!sc.held) {
        /* never selectable, never a flat line, and the sentence the contract
           fixes is the one the chip carries */
        b.setAttribute('aria-disabled', 'true');
        b.setAttribute('aria-pressed', 'false');
        b.disabled = true;
        b.title = sc.note || NOT_HELD;
        b.appendChild(el('span', null, '· not held'));
      } else {
        const on = sel.includes(sc.id);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        if (on) b.dataset.slot = String(slotOf(sc.id));
        b.title = `${scenLabel(sc.id)}${sc.note ? ' — ' + sc.note : ''}` + (on ? '' : sel.length >= 3 ? ' — three scenarios are already overlaid; drop one first.' : '');
        b.onclick = () => {
          const cur = selected();
          if (cur.includes(sc.id)) {
            if (cur.length === 1) { A.toast('At least one scenario stays selected — there would be nothing to read otherwise.'); return; }
            ST.scenarios = cur.filter(x => x !== sc.id);
          } else if (cur.length >= 3) {
            A.toast('Three scenarios overlay at once. Drop one to add another — past three the hues stop separating.'); return;
          } else ST.scenarios = cur.concat(sc.id);
          ST.surfYear = null; store(); paint();
        };
      }
      s.appendChild(b);
    });
    /* S-nav 2026-10-07: the not-held sentence is the chips' own title (the contract's words), not a second line */
    return s;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     continuum S0 2026-10-06 · the scenario row — Base and the proxies the server publishes
     (GET /api/v2/scenarios). One choice, read by every forecast panel through GSContinuum.scen.adjust.
     Its own row, not part of #gsc-strip: the Year analysis replaces the strip's children and the timeline
     hides it, and the scenario still reaches both. The list is read when the reader asks for it (or on open,
     in a browser that has read it before): a server that has not mounted the route answers 404, and a
     request nobody asked for would put that 404 in every session's console.
     ═══════════════════════════════════════════════════════════════════════ */
  function scenRow() {
    const r = el('div'); r.id = 'gsc-scen'; r.setAttribute('data-gsc', 'scenario-strip');
    const S = SCN();
    r.setAttribute('data-gsc-scen-state', S ? S.state : 'absent');
    r.appendChild(el('span', 'gsc-lab', 'Scenario'));
    const cur = ST.scenario || 'base';
    const chip = (id, text, title, aria) => {
      const b = el('button', 'gsc-chip gsc-scen'); b.type = 'button';
      b.dataset.gscProxy = id;
      b.setAttribute('aria-pressed', cur === id ? 'true' : 'false');
      if (aria) b.setAttribute('aria-label', aria);
      b.title = title || '';
      b.appendChild(el('span', 'gsc-sw'));
      b.appendChild(el('span', null, text));
      b.onclick = () => {
        if ((ST.scenario || 'base') === id) return;
        const C = CORE(); if (C && C.setScenario(id)) return;   // emits: the paint follows
        ST.scenario = 'base'; store(); paint();
      };
      return b;
    };
    if (!S) {
      r.appendChild(chip('base', 'Base', 'The run the price basis reads each year'));
      r.appendChild(el('span', 'gsc-nh', 'Scenario list not in this build.'));
      return r;
    }
    if (S.state !== 'ok') {
      /* S-nav 2026-10-07: no "Load proxy scenarios" button — the proxies arrive with "Connect live data" (toolbar) */
      r.appendChild(chip('base', 'Base', 'The run the price basis reads each year'));
      const n = el('span', 'gsc-nh');
      n.setAttribute('data-gsc-scen-note', S.state);
      n.textContent = S.state === 'loading' ? 'Reading the proxy scenarios…'
        : S.state === 'unavailable' ? 'Proxy scenarios not served' : 'Proxies arrive with live data';
      n.title = S.state === 'unavailable' ? `Scenario list not served: ${S.why}. Base is drawn.`
        : 'High Gas, Low Gas and High Load: illustrative proxy — not a PROBE run (Base × a fixed factor), read from the live server with Connect live data.';
      r.appendChild(n);
      return r;
    }
    const reg = S.registry();
    let tagged = false;
    S.list().forEach(e => {
      const proxy = e.kind === 'proxy';
      /* cost-basis publish 2026-10-08: where the toolbar is too narrow for one row (1280), the proxies carry ONE visible
         "proxies" tag instead of " · proxy" on each chip (fitToolbar); the chip's text and title are unchanged */
      if (proxy && !tagged) { tagged = true; const g = el('span', 'gsc-ptag', 'proxies'); g.setAttribute('aria-hidden', 'true'); r.appendChild(g); }
      const text = proxy ? `${S.short(e.id)} ${S.factorWord(e.factor).replace(/\s+/g, '')}` : S.short(e.id);
      const b = chip(e.id, text,
        proxy ? `${e.label}. Base ${S.factorWord(e.factor)} on solved and escalated years; settled history is never scaled.`
          : e.kind === 'base' ? 'The run the price basis reads each year' : e.label,
        e.label);
      if (proxy) b.appendChild(el('span', 'gsc-sfx', ' · proxy'));
      r.appendChild(b);
    });
    /* the proxy label, the factors and the method are the row's own title and an off-screen note: one row, no
       second sentence on screen */
    const n = el('span', 'gsc-lab'); n.setAttribute('data-gsc-scen-note', 'ok');
    const px = S.list().filter(e => e.kind === 'proxy');
    n.textContent = px.length ? `${px.map(e => S.short(e.id)).join(', ')}: ${reg.proxy_label || ''} · ${px.map(e => `${S.short(e.id)} ${S.factorWord(e.factor)}`).join(' · ')}` : '';
    r.title = `${px.map(e => S.short(e.id)).join(', ')}: ${reg.proxy_label || ''}. ${S.methodLine()}`;
    r.appendChild(n);
    return r;
  }

  /* continuum S0 2026-10-06 · the line each panel carries when a scenario other than Base is chosen: applied
     (with what was drawn as solved, and why) or "Scenario not applied: <reason>". Read off the view's policy in
     the registry and the per-view log the readers wrote — never guessed from the panel. */
  function scenLines(view) {
    const S = SCN(), C = CORE(); if (!S || !scenOn()) return null;
    const sid = ST.scenario;
    if (S.state !== 'ok') return { kind: 'not-applied', text: `Scenario not applied: the scenario list is not served (${S.state === 'loading' ? 'still loading' : S.why || 'not loaded'}). Base is drawn.` };
    const e = S.entry(sid);
    if (!e) return { kind: 'not-applied', text: `Scenario not applied: ${sid} is not in the scenario list the server published. Base is drawn.` };
    const v = (C && C.view(view)) || null;
    const pol = v ? v.scenario : 'not-applied';
    if (pol === 'not-applied') return { kind: 'not-applied', text: `Scenario not applied: ${(v && v.why) || 'this view has not declared how a scenario reaches it'}.` };
    const lg = S.log(view);
    const skipped = lg.skipped.length ? ` Drawn as solved: ${lg.skipped.map(([k, why]) => `${k} — ${why}`).join('; ')}.` : '';
    if (pol === 'unchanged') return { kind: 'applied', text: `${S.appliedLine(sid)} Unchanged here: ${v.why}.` };
    return { kind: 'applied', text: S.appliedLine(sid) + skipped };
  }
  function annotateScenario(screenEl) {
    if (!scenOn()) return;
    const groups = new Map();
    /* the off-screen staging host of the Export screen is annotated too: its panels are what the CSVs read */
    screenEl.querySelectorAll('[data-gsc-view]').forEach(n => {
      const k = n.getAttribute('data-gsc-view'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n);
    });
    groups.forEach((nodes, view) => {
      const ln = scenLines(view === 'export' ? ST.from : view); if (!ln) return;
      /* a view whose own panels carry the line needs no banner as well */
      let banner = nodes.some(n => n.matches('[data-gsc-panel]') || n.querySelector('[data-gsc-panel]'));
      nodes.forEach(n => {
        const panels = n.matches('[data-gsc-panel]') ? [n] : [...n.querySelectorAll('[data-gsc-panel]')];
        if (panels.length) panels.forEach(p => {
          if (p.querySelector(':scope > [data-gsc-scen]')) return;
          const d = el('div', 'gsc-note gsc-scen-line'); d.setAttribute('data-gsc-scen', ln.kind); d.textContent = ln.text;
          const h = p.querySelector(':scope > .gsc-face') || p.querySelector(':scope > .gsc-h');
          if (h && h.nextSibling) p.insertBefore(d, h.nextSibling); else p.appendChild(d);
          const pid = p.getAttribute('data-gsc-panel'); if (pid && EXPORTS[pid]) EXPORTS[pid].scen = ln.text;
        });
        else if (!banner) {
          /* a module that paints its own panels: one line for the view, ahead of them */
          const d = el('div', 'gsc-note gsc-wide gsc-scen-line'); d.setAttribute('data-gsc-scen', ln.kind);
          d.setAttribute('data-gsc-scen-screen', view); d.textContent = ln.text;
          n.parentNode.insertBefore(d, n); banner = true;
        }
      });
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════
     S-nav 2026-10-07 · the six workflow screens are the navigation (D-001, review 2026-10-07 P0 1–3)
       main row   Outlook · Drivers · Shape · Value · Offtake · Assumptions, the context line, Export view
       toolbar    one per screen: Runs and Scenario on ONE row · Market · Year · Live data
       sub-row    the screen's pages — Overview (the panels registered for the screen, new panels first) then
                  the legacy views it hosts — and jump links to the Overview's panels. It never scrolls away.
     Every legacy view keeps its key (`data-gsc-screen`), so a card, the Tree or a test still lands on it.
     ═══════════════════════════════════════════════════════════════════════ */
  /** the pages of one workflow screen, in order. Hourly explorer and Hourly · history + forecast are ONE page with a
   *  span control (they drew the same hourly series — Ganesh's no-duplicate rule); both keys stay reachable. */
  function pagesOf(wk) {
    const C = CORE(); if (!C) return [];
    const vs = C.views().filter(v => v.screen === wk);
    const reg = vs.filter(v => v.build), core = vs.filter(v => !v.build);
    const out = [];
    if (reg.length) out.push({ k: 'wf:' + wk, label: 'Overview', overview: true, panels: reg });
    core.forEach(v => {
      if (v.k === 'timeline' && core.some(x => x.k === 'hourly')) return;
      out.push({ k: v.k, label: v.k === 'hourly' ? 'Hourly' : v.label, also: v.k === 'hourly' ? ['timeline'] : [] });
    });
    return out;
  }
  /** the workflow screen the current page belongs to (Export reads the page it lists) */
  function currentWf() {
    const C = CORE(); if (!C) return null;
    const s = String(ST.screen === 'export' ? ST.from : ST.screen);
    if (s.startsWith('wf:')) return s.slice(3);
    return C.screenOf(s) || null;
  }
  /** the page a screen key shows on: wf:<k> with no registered panel is its first page (Outlook) */
  function landing(wk) {
    const ps = pagesOf(wk); if (!ps.length) return 'wf:' + wk;
    const last = ST.pageOf && ST.pageOf[wk];
    return ps.some(p => p.k === last || (p.also || []).includes(last)) ? last : ps[0].k;
  }
  function goPage(k) {
    if (ST.screen !== 'export') ST.from = ST.screen;
    ST.screen = k;
    const wk = currentWf(); if (wk) { ST.pageOf = Object.assign({}, ST.pageOf || {}); ST.pageOf[wk] = k; }
    store(); paint();
  }
  /** the main row: six workflow screens, the context line, Export view */
  function navRow() {
    const tabs = el('nav'); tabs.id = 'gsc-tabs'; tabs.setAttribute('aria-label', NAME() + ' screens');
    const row = el('div', 'gsc-wfrow');
    const C = CORE(), cur = currentWf();
    (C ? C.workflow() : []).forEach(w => {
      const b = el('button', 'gsc-wftab', w.label); b.type = 'button';
      b.setAttribute('data-gsc-wf-tab', w.k);
      b.title = w.question;
      b.setAttribute('aria-current', cur === w.k && ST.screen !== 'export' ? 'page' : 'false');
      b.onclick = () => goPage(landing(w.k));
      row.appendChild(b);
    });
    const ctx = el('div', 'gsc-ctx');
    const m = META();
    if (m && m.fixture) { const f = el('span', 'gsc-fix', 'TEST FIXTURE'); f.title = m.source || ''; ctx.appendChild(f); }
    ctx.appendChild(el('span', null, `ISO-NE · ${scopeShort()} · ${selected().map(scenLabel).join(', ')}${assetWord() ? ' · ' + assetWord() : ''}`));
    row.appendChild(ctx);
    row.appendChild(globalCtl());
    const ex = el('button', 'gsc-btn gsc-exp'); ex.type = 'button';
    ex.dataset.gscScreen = 'export'; ex.setAttribute('data-gsc-workflow', 'action');
    ex.setAttribute('aria-current', ST.screen === 'export' ? 'page' : 'false');
    ex.innerHTML = icon('download') + 'Export view';
    ex.title = 'CSV and PNG of the page you are on';
    ex.onclick = () => { if (ST.screen !== 'export') ST.from = ST.screen; ST.screen = 'export'; store(); paint(); };
    row.appendChild(ex);
    tabs.appendChild(row);
    return tabs;
  }
  /** the sub-row: this screen's pages, then jump links to the Overview's panels */
  function subNav() {
    const wk = currentWf(), C = CORE();
    const nav = el('nav'); nav.id = 'gsc-subnav'; nav.setAttribute('aria-label', 'Pages of this screen');
    if (!wk || !C) return nav;
    nav.setAttribute('data-gsc-wf', wk);
    const cur = ST.screen === 'export' ? ST.from : ST.screen;
    pagesOf(wk).forEach(p => {
      const b = el('button', 'gsc-page', p.label); b.type = 'button';
      if (p.overview) b.setAttribute('data-gsc-page', p.k);
      else { b.dataset.gscScreen = p.k; b.setAttribute('data-gsc-workflow', wk); }
      const on = cur === p.k || (p.also || []).includes(cur);
      b.setAttribute('aria-current', on && ST.screen !== 'export' ? 'page' : 'false');
      b.title = p.overview ? `${p.panels.map(v => v.label).join(' · ')}` : (C.view(p.k) || {}).label || p.label;
      b.onclick = () => goPage(p.k);
      nav.appendChild(b);
    });
    const page = pagesOf(wk).find(p => p.k === cur);
    if (page && page.overview && page.panels.length > 1) {
      const j = el('div', 'gsc-jump'); j.setAttribute('data-gsc-jump', wk);
      j.appendChild(el('span', 'gsc-lab', 'Jump to'));
      page.panels.forEach(v => {
        const a = el('button', 'gsc-jumpto', v.label); a.type = 'button'; a.setAttribute('data-gsc-jump-to', v.k);
        a.onclick = () => {
          const t = document.querySelector(`#gsc-screen [data-gsc-view="${v.k}"]`);
          if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: 'smooth' });
        };
        j.appendChild(a);
      });
      nav.appendChild(j);
    }
    return nav;
  }
  /** the live-data control: one per browser, then automatic (GSContinuum.live) */
  function liveCtl() {
    const C = CORE(), L = C && C.live;
    const box = el('div', 'gsc-live'); box.setAttribute('data-gsc-live', L ? L.state : 'absent');
    if (!L) return box;
    if (L.state === 'on') {
      const s = el('span', 'gsc-livedot', 'Live'); s.title = 'Live data: every panel reads the GridSense server';
      box.appendChild(s); return box;
    }
    if (L.state === 'connecting') { box.appendChild(el('span', 'gsc-nh', 'Connecting to live data…')); return box; }
    const b = el('button', 'gsc-btn pri', L.state === 'off' ? 'Retry live data' : 'Connect live data'); b.type = 'button';
    b.setAttribute('data-gsc-connect', 'true');
    b.title = L.state === 'off' ? `The GridSense server did not answer (${L.why}). Ask it again.`
      : 'Read the live GridSense server once. After one good answer this browser reads it on every open: constraints, basis, profitability, emissions and the proxy scenarios.';
    b.onclick = () => { L.connect(true); };
    box.appendChild(b);
    if (L.state === 'off') { const n = el('span', 'gsc-nh', 'Server offline — embedded data shown'); n.title = L.why; box.appendChild(n); }
    return box;
  }
  /** the forecast year the price screens draw beside history (the strip's runs still decide everything else) */
  const YEAR_OPTS = [2028, 2030, 2035, 2040];
  function yearNow() {
    if (YEAR_OPTS.includes(+ST.year)) return +ST.year;
    const hz = window.App && App.state && App.state.basis ? +App.state.basis.horizon : 2030;
    return YEAR_OPTS.includes(hz) ? hz : 2030;
  }
  /** the screen-wide controls, on the main row: Market · Year · History vs forecast · Live data */
  function globalCtl() {
    const right = el('div', 'gsc-global'); right.setAttribute('data-gsc', 'global-controls');
    const mk = marketsFor();
    right.appendChild(seg('Market', [
      { v: 'DA', l: 'DA', disabled: !mk.includes('DA'), why: 'No day-ahead series at this scope for the selected runs' },
      { v: 'RT', l: 'RT', disabled: !mk.includes('RT'), why: 'No real-time series at this scope for the selected runs' },
    ], market() === 'model' ? (mk.includes('RT') ? 'RT' : 'DA') : market(), v => { ST.market = v; store(); paint(); },
    'The settled market every panel reads; a solved run has one model price'));
    const ys = document.createElement('select'); ys.className = 'gsc-yr gsc-yearsel';
    ys.setAttribute('data-gsc-year', 'true'); ys.setAttribute('aria-label', 'Forecast year');
    ys.title = 'The forecast year drawn beside settled history (the run the price basis reads that year)';
    YEAR_OPTS.forEach(y => { const o = document.createElement('option'); o.value = String(y); o.textContent = `Year ${y}`; if (y === yearNow()) o.selected = true; ys.appendChild(o); });
    ys.onchange = () => { ST.year = +ys.value; store(); paint(); };
    right.appendChild(ys);
    right.appendChild(hvfToggle());
    right.appendChild(liveCtl());
    return right;
  }
  /** the toolbar: the runs and the scenario on ONE row (review P2 9) */
  function toolbar() {
    const t = el('div'); t.id = 'gsc-toolbar'; t.setAttribute('data-gsc', 'toolbar');
    t.appendChild(strip());
    t.appendChild(scenRow());
    /* cost-basis publish 2026-10-08: at 1280 the chips took two rows — measured, not guessed from the viewport */
    try { if (!TB_RO && window.ResizeObserver) TB_RO = new ResizeObserver(es => es.forEach(x => fitToolbar(x.target))); if (TB_RO) { TB_RO.disconnect(); TB_RO.observe(t); } }
    catch (e) { console.warn('[cathy] toolbar fit: ' + ((e && e.message) || e)); }
    return t;
  }
  var TB_RO = null;   // var: toolbar() may run before this line is reached
  /** One row for the runs and the scenario: when the chips wrap at their full labels, the toolbar goes tight (11 px
   *  chip text, one "proxies" tag for the three proxy chips). Decided on the live widths, in the observer's frame. */
  function fitToolbar(t) {
    if (!t || !t.isConnected) return;
    const tops = () => [...t.querySelectorAll('.gsc-chip')].map(b => b.getBoundingClientRect()).filter(r => r.width > 0).map(r => Math.round(r.top));
    t.classList.remove('gsc-tight');
    const a = tops();
    if (a.length && new Set(a).size > 1) t.classList.add('gsc-tight');
  }

  /** continuum S0 2026-10-06: build one view into a host and tag what it added with the view's key, so the
   *  scenario line, the registry and the gates can tell which panels belong to which view */
  function buildInto(k, host, B) {
    const S = SCN(); if (S) S.building(k);
    const before = new Set(host.children);
    try { B[k](host); }
    finally {
      if (S) S.building(null);
      [...host.children].forEach(c => { if (!before.has(c) && !c.hasAttribute('data-gsc-view')) c.setAttribute('data-gsc-view', k); });
    }
  }
  /** the context a registered panel is built with: the one state, the API client, the scenario rule */
  function cxFor() {
    const C = CORE();
    return { ST, store, paint, panel, emptyBox, faceLine, scope, busIds, preferredBus, NAME, shownIn, notAtBus, readScope,
      scen: SCN(), api: C ? C.api : null, state: C ? C.state : () => null, live: C ? C.live : null, sig: C ? C.sig : null };
  }
  /** continuum S0 2026-10-06: one workflow screen, hosting every view the registry tags with it — today's views
   *  as they are, the panels later slices register, and the ones still planned as a written empty state */
  /** S-nav 2026-10-07: a workflow screen's Overview — the panels registered for it, and nothing else. The legacy views
   *  are its other pages (the sub-row), so the screen no longer appends whole views top to bottom. Planned panels are not
   *  drawn (SKL-091: no roadmap placeholders in the reader's view); the registry still lists them. */
  function buildWorkflow(wk, host, B) {
    const C = CORE(), w = C && C.workflowOf(wk);
    if (!w) { host.appendChild(panel({ id: 'wf-none', wide: true, title: 'Screen not held', draw: b => b.appendChild(emptyBox('No such screen', `${wk} is not one of the six workflow screens.`)) })); return; }
    const page = pagesOf(wk).find(p => p.overview);
    (page ? page.panels : []).forEach(v => {
      if (v.build && !B[v.k]) B[v.k] = h => v.build(h, cxFor());
      /* no section header or anchor element: an extra grid item would break a row of side-by-side cards; the jump bar
         scrolls to the first element the view added (buildInto tags it data-gsc-view) */
      try { buildInto(v.k, host, B); }
      catch (e) {
        host.appendChild(panel({ id: 'wf-fail-' + v.k, wide: true, title: v.label,
          draw: b => b.appendChild(emptyBox('This view could not be drawn', `${(e && e.message) || e}. The rest of the screen is unaffected.`)) }));
      }
    });
  }
  /** the Hourly page's span control: the two hourly renderers are one view with two spans */
  function spanCtl() {
    const d = el('div', 'gsc-span gsc-wide'); d.setAttribute('data-gsc-span', ST.screen);
    d.appendChild(el('span', 'gsc-lab', 'Span'));
    const g = el('div', 'gsc-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', 'Hourly span');
    [['hourly', 'Any window · day to year', 'Any date and window, any component, against the hub'],
      ['timeline', '2020 → 2040 · history + forecast', 'Every settled hour and every solved run on one chronological axis']].forEach(([k, l, t]) => {
      const b = el('button', null, l); b.type = 'button'; b.dataset.gscScreen = k; b.title = t;
      b.setAttribute('aria-pressed', ST.screen === k ? 'true' : 'false');
      b.onclick = () => goPage(k);
      g.appendChild(b);
    });
    d.appendChild(g);
    return d;
  }
  /** the project's asset key (solar · wind · bess · hybrid · dc), or null */
  function assetFuel() { try { const c = A.ctx && A.ctx(); return (c && c.fuel) || null; } catch (e) { return null; } }
  /** "shown in <screen> › <page>": the link a page carries in place of a chart another home draws */
  function shownIn(k, what, why) {
    const C = CORE(); const v = C && C.view(k); const wk = v ? v.screen : (String(k).startsWith('wf:') ? String(k).slice(3) : null);
    const w = wk && C ? C.workflowOf(wk) : null;
    const page = wk ? pagesOf(wk).find(p => p.k === k || (p.also || []).includes(k)) : null;
    const d = el('div', 'gsc-shown gsc-wide'); d.setAttribute('data-gsc-shown-in', k);
    d.appendChild(el('span', null, `${what}: shown in ${w ? w.label : ''}${page && !page.overview ? ' › ' + page.label : ''}`));
    /* NAMING-GUIDE §2: Open goes to a view; the link names the page it opens */
    const a = el('button', 'gsc-link', `Open ${page && !page.overview ? page.label : (w ? w.label : 'page')}`); a.type = 'button';
    a.title = `Open ${w ? w.label : ''}${page ? ' › ' + page.label : ''}`;
    a.onclick = () => goPage(k);
    d.appendChild(a);
    if (why) d.appendChild(el('span', 'gsc-nh', why));
    return d;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     Paint
     ═══════════════════════════════════════════════════════════════════════ */
  function ensureRoot() {
    if (ROOT) return ROOT;
    ROOT = el('div'); ROOT.id = 'gsc-root'; ROOT.setAttribute('data-gsc', 'root');
    /* continuum fix 2026-10-06 (D4): the hand-off notice stands until the reader's first action here —
       a screen, a scope, the strip or any control — and is never re-inserted after it */
    const clearNotice = e => {
      if (!lastOpen) return;
      const t = e && e.target;
      if (!t || !t.closest || !t.closest('button, select, input, a, [role="button"]') || t.closest('[data-gsc-notice]')) return;
      lastOpen = null;
      ROOT.querySelectorAll('[data-gsc-notice]').forEach(n => n.remove());
    };
    ROOT.addEventListener('click', clearNotice, true);
    ROOT.addEventListener('change', clearNotice, true);
    return ROOT;
  }
  function mountPoint() {
    if (window.GSX_CONTINUUM_HOST) return window.GSX_CONTINUUM_HOST;   /* One Studio C1: the host's own stage */
    return document.getElementById('gsf-ws')
      || document.querySelector('#app > .sm > .body')
      || document.getElementById('app');
  }

  function paint() {
    if (!ON) return;
    const root = ensureRoot();
    const host = mountPoint();
    if (host && root.parentNode !== host) host.appendChild(root);
    const app = window.GSX_CONTINUUM_HOST || document.getElementById('app'); if (app) app.classList.add('gsc-on');
    root.innerHTML = '';
    PENDING = []; EXPORTS = {};

    if (!DATA()) {
      const m = el('div'); m.id = 'gsc-main';
      const b = el('div'); b.id = 'gsc-screen';
      b.appendChild(panel({ id: 'nodata', wide: true, title: `${NAME()} — the SCED analytics tab`,
        draw: body => body.appendChild(emptyBox('The cathy block is not in this build',
          'window.GS_DATA_EXT.cathy is absent. It is produced by the `cathy` section of tools/studio_export.py into studio/src/data-ext.js, to the shape in studio/CATHY-CONTRACT.md. Nothing is drawn in its place.')) }));
      m.appendChild(b); root.appendChild(m);
      PENDING.forEach(f => f()); PENDING = [];
      return;
    }

    root.appendChild(picker());
    const main = el('div'); main.id = 'gsc-main';
    if (SCN()) SCN().resetLog();

    const BUILD = {
      explorer: screenExplorer, surface: screenSurface, duration: screenDuration,
      makeup: screenMakeup, spreads: screenSpreads, negative: screenNegative,
      generation: screenGeneration, capacity: screenCapacity,
    };
    const C = CORE();
    /* S-nav 2026-10-07: a workflow screen with no registered panel (Outlook) shows its first page; a page this build
       does not carry falls back to the asset's screen, never to a silent blank */
    if (C && String(ST.screen).startsWith('wf:') && !pagesOf(String(ST.screen).slice(3)).some(p => p.overview)) ST.screen = landing(String(ST.screen).slice(3));
    /* the nav is built before the hooks run, from the registry, so every hooked view already has its button */
    const tabs = navRow();
    main.appendChild(tabs);
    main.appendChild(toolbar());
    if (window.GSHourly && GSHourly.hook) GSHourly.hook(SCREENS, BUILD, ST, store, paint); // hourly explorer hook
    if (window.GSNodeCC && GSNodeCC.hook) GSNodeCC.hook(SCREENS, BUILD, ST, store, paint); // node constraints hook
    (window.GSCathyScreens || []).forEach(x => { try { x.attach({ SCREENS, BUILD, tabs, ST, store, paint, panel, emptyBox, scope, busIds, preferredBus, NAME, shownIn, sig: CORE() ? CORE().sig : null, strip: main.querySelector('#gsc-strip') }); } catch (e) { console.warn('[cathy] screen hook ' + (x && x.k) + ': ' + ((e && e.message) || e)); } }); // hourly timeline hook
    if (C) C.workflow().forEach(w => { BUILD['wf:' + w.k] = host => buildWorkflow(w.k, host, BUILD); });
    /* continuum fix 2026-10-06 (D2): a screen a hand-off named but this build does not carry */
    if (ST.screen !== 'export' && !BUILD[ST.screen]) { ST.screen = C ? landing(C.leadScreen(assetFuel())) : 'explorer'; if (!BUILD[ST.screen]) ST.screen = 'explorer'; store(); }
    main.appendChild(subNav());

    const screen = el('div'); screen.id = 'gsc-screen';
    screen.setAttribute('data-gsc-current', ST.screen);
    screen.setAttribute('data-gsc-wf', currentWf() || '');
    main.appendChild(screen);
    root.appendChild(main);
    const run = BUILD[ST.screen];
    try {
      /* S-nav 2026-10-07: the Hourly page — one hourly view, two spans (any window · 2020 → 2040) */
      if (ST.screen === 'hourly' || ST.screen === 'timeline') screen.appendChild(spanCtl());
      if (run) { if (String(ST.screen).startsWith('wf:')) run(screen); else buildInto(ST.screen, screen, BUILD); }
      else {
        /* "CSV of the current view": Export lists the panels of the screen the
           reader came from. They are built into a detached host so their tables
           register in EXPORTS without being painted twice on the page. */
        const from = BUILD[ST.from] ? ST.from : 'explorer';
        const staging = el('div'); staging.id = 'gsc-staging';
        staging.style.cssText = 'position:absolute;left:-99999px;top:0;width:900px;height:1px;overflow:hidden';
        screen.appendChild(staging);
        if (String(from).startsWith('wf:')) BUILD[from](staging); else buildInto(from, staging, BUILD);
        const ex0 = new Set(screen.children);
        screenExport(screen);
        [...screen.children].forEach(c => { if (!ex0.has(c)) c.setAttribute('data-gsc-view', 'export'); });   // continuum S0 2026-10-06
        const head = el('div', 'gsc-note gsc-wide');
        head.innerHTML = `Listing the ${esc(screenLabel(from))} panels — the screen you came from.`;
        screen.insertBefore(head, screen.firstChild);
      }
    } catch (e) {
      screen.innerHTML = '';
      screen.appendChild(panel({ id: 'screenfail', wide: true, title: 'This screen could not be built',
        draw: body => body.appendChild(emptyBox('Nothing from the previous selection is left on screen',
          `${(e && e.message) || e}. Pick another screen or another scope; the rest of ${NAME()} is unaffected.`)) }));
      console.warn('[cathy] screen ' + ST.screen + ': ' + ((e && e.message) || e));
    }
    /* now the bodies, with real widths */
    const q = PENDING; PENDING = [];
    q.forEach(f => f());
    try { annotateScenario(screen); } catch (e) { console.warn('[cathy] scenario line: ' + ((e && e.message) || e)); }   // continuum S0 2026-10-06
    /* the staging host stays in the document, off-screen: its canvases are what
       the PNG buttons on the Export screen serialise. Removing it would leave
       the CSV working and the PNG silently saving nothing. */
    const noticeText = lastOpen && lastOpen.notice ? (typeof lastOpen.notice === 'function' ? lastOpen.notice() : lastOpen.notice) : '';
    if (noticeText) {
      const n = el('div', 'gsc-note'); n.setAttribute('data-gsc-notice', 'true');
      n.innerHTML = noticeText;
      screen.insertBefore(n, screen.firstChild);
      if (n.parentNode) n.classList.add('gsc-wide');
    }
  }

  /* redraw on a real resize, never on a hover */
  let rz = null;
  window.addEventListener('resize', () => { if (!ON) return; clearTimeout(rz); rz = setTimeout(paint, 140); });

  /* ═══════════════════════════════════════════════════════════════════════
     Open / close
     ═══════════════════════════════════════════════════════════════════════ */
  function open(why) {
    if (ON) { paint(); return; }
    ON = true;
    if (!ST.scopeKey) resetScope();
    /* continuum fix 2026-10-06 (D3): the scope follows the project's option — on the first open and
       whenever the option changed since the scope last followed it. A scope the reader picked after
       that is kept on reopen. */
    const fo = followOption();
    if (fo) lastOpen = { detail: null, notice: fo };
    /* S-nav 2026-10-07: open on the asset's screen (solar/wind/BESS/hybrid → Shape, data centre → Offtake) when the
       project or asset changed since the last open and nothing has chosen a screen since */
    const C0 = CORE(), fuel = assetFuel(), forKey = `${optionKey()}|${fuel || ''}`;
    if (C0 && !SCREEN_SET && ST.openedFor !== forKey) { SCREEN_V = landing(C0.leadScreen(fuel)); }
    ST.openedFor = forKey;
    /* full workspace: the map dock folds to its tab, and its previous state is
       remembered so leaving restores what the reader had, not a default */
    try {
      if (window.GSFrame && GSFrame.sizes && !window.GSX_CONTINUUM_HOST) {
        mapWasOff = !!GSFrame.sizes().mapOff;
        if (!mapWasOff) GSFrame.setDock('map', true);
      }
    } catch (e) { mapWasOff = null; }
    store();
    paint();
    markTabs();
    if (why) A.toast(why);
    /* continuum S0 2026-10-06: a scenario chosen in an earlier session comes back with its list — only in a
       browser that has read the list before, so a fresh session never sends a request it did not ask for */
    const S = SCN();
    if (S && (ST.scenario || 'base') !== 'base' && S.state === 'idle' && S.wasLoaded()) S.load();
    /* S-nav 2026-10-07: a browser that connected to the live server before reconnects on open (one status probe) */
    if (C0 && C0.live) C0.live.resume();
  }
  function close(silent) {
    if (!ON) return;
    ON = false;
    SCREEN_SET = false;   // S-nav 2026-10-07: the next open may follow the asset again
    const app = window.GSX_CONTINUUM_HOST || document.getElementById('app'); if (app) app.classList.remove('gsc-on');
    if (ROOT && ROOT.parentNode) ROOT.parentNode.removeChild(ROOT);
    try { if (window.GSFrame && mapWasOff === false) GSFrame.setDock('map', false); } catch (e) { /* dock gone */ }
    mapWasOff = null;
    if (!silent) A.render();
  }

  /** the module tab, and clearing the others' current state while Cathy is on */
  function markTabs() {
    const nav = document.querySelector('[data-gsf="tabs"]');
    if (!nav) return;
    nav.querySelectorAll('button[data-gsf-module]').forEach(b => {
      if (b.dataset.gsfModule === 'cathy') b.setAttribute('aria-current', ON ? 'page' : 'false');
      else if (ON) b.setAttribute('aria-current', 'false');
    });
  }
  function installTab() {
    if (window.GSX_CONTINUUM_HOST) return;   /* One Studio C1: the host owns the tab */
    const hdr = document.querySelector('#app > .hdr'); if (!hdr) return;
    const nav = hdr.querySelector('[data-gsf="tabs"]') || hdr.querySelector(':scope > .nav') || hdr;
    if (nav.querySelector('button[data-gsf-module="cathy"]')) { markTabs(); return; }
    const b = el('button'); b.type = 'button';
    b.dataset.gsfModule = 'cathy';
    b.title = `${NAME()} — ISO-NE price and generation analytics on one axis to 2050, hourly surfaces to 2040, by scenario`;
    b.innerHTML = icon('chart') + `<span class="gsf-lbl">${esc(NAME())}</span>`;
    b.setAttribute('aria-current', ON ? 'page' : 'false');
    b.onclick = () => { if (ON) close(); else open(); };
    nav.appendChild(b);
    markTabs();
  }

  /* ═══════════════════════════════════════════════════════════════════════
     cathy:open — from the Data Tree and from a card's "→ Cathy"
     ═══════════════════════════════════════════════════════════════════════ */
  const MATCH = [
    [/month.?hour|hourly|shape|surface|heat|8760/i, 'surface'],
    [/duration|percentile|\bp\d{1,2}\b|exceed/i, 'duration'],
    [/decomp|make.?up|congestion|loss|component/i, 'makeup'],
    [/\btb\d?\b|spread|arbitrage|top.?bottom|battery.?value/i, 'spreads'],
    [/negative|neg.?hour|below zero|zero.?price/i, 'negative'],
    [/generation|outlook|fuel|fleet|retire|queue|margin|capacity factor/i, 'generation'],
    [/capacity|fca|forward capacity|\bgas\b|mmbtu|fcm/i, 'capacity'],
    [/export|download|csv/i, 'export'],
    [/price|lmp|annual|basis|forecast|curve|scenario/i, 'explorer'],
  ];
  const STAGE_SCREEN = { prices: 'explorer', market: 'generation', economics: 'spreads', queue: 'generation' };
  /* continuum fix 2026-10-06 (D2): a card's "Open in LMP Continuum" lands on the screen that card's
     question is answered on. ext/50 sends cardId (and card/block); the screens of ext/61/85/86/67 are
     named here so the router and those modules agree. */
  const CARD_SCREEN = {
    '5.04': 'surface', '5.05': 'surface', '5.06': 'duration', '5.15': 'duration',
    '5.10': 'makeup', '5.30': 'makeup', '5.12': 'spreads', '5.11': 'negative',
    '5.40': 'hourly', '5.41': 'timeline', '5.43': 'year-analysis',
    '3.50': 'nodecc', '3.51': 'nodecc', '5.50': 'nodecc', '5.51': 'nodecc',
  };
  const CARD_RX = /^\d+\.\d{2}$/;
  const STAGE_WORD = { prices: 'Prices', market: 'Market', economics: 'Economics', queue: 'Queue', grid: 'Grid', land: 'Land', decision: 'Decision' };
  const screenLabel = k => {
    const x = SCREENS.find(s => s.k === k); if (x) return x.label;
    const w = String(k).startsWith('wf:') && CORE() ? CORE().workflowOf(String(k).slice(3)) : null;   // continuum S0 2026-10-06
    return w ? w.label : k;
  };

  const flat = o => (o && typeof o === 'object')
    ? Object.keys(o).concat(Object.values(o).map(v => typeof v === 'object' ? '' : String(v))).join(' ') : '';
  function screenFor(det) {
    /* continuum S0 2026-10-06: `screen` naming one of the six workflow screens lands on it (04 §Interfaces) */
    const wk = det.screen != null ? String(det.screen).replace(/^wf:/, '') : null;
    if (wk && CORE() && CORE().workflowOf(wk)) return { k: 'wf:' + wk, from: `screen ${wk}` };
    const cid = [det.cardId, det.card, det.block].map(v => v == null ? '' : String(v)).find(v => CARD_RX.test(v)) || null;
    if (cid && CARD_SCREEN[cid]) return { k: CARD_SCREEN[cid], from: `card ${cid}`, card: cid };
    const words = [det.template, det.dataset, det.column, det.block, det.id]
      .filter(Boolean).map(String).filter(v => !CARD_RX.test(v)).join(' ');
    if (words.trim()) for (const [re, k] of MATCH) if (re.test(words)) return { k, from: 'the words "' + words.slice(0, 80) + '"' };
    /* a card with no screen of its own: its question names a measure */
    if (det.question) for (const [re, k] of MATCH) if (re.test(String(det.question)))
      return { k, card: cid, fallback: `${cid ? `card ${cid} has no screen of its own here, and ` : ''}its question names this measure` };
    /* the card's controls and the tree's pin set, before the stage: they name a
       measure, and a stage only names a board */
    const cw = flat(det.controls) + ' ' + flat(det.pins);
    if (cw.trim()) for (const [re, k] of MATCH) if (re.test(cw)) return { k, card: cid, fallback: 'the controls that came with it name this measure' };
    if (det.stage && STAGE_SCREEN[det.stage]) return { k: STAGE_SCREEN[det.stage], card: cid,
      fallback: `${cid ? `card ${cid} has no screen of its own here, so it` : 'it'} opens at the ${STAGE_WORD[det.stage] || det.stage} stage's screen` };
    return null;
  }

  /** the project's asset, for the context line (D3) */
  function assetWord() {
    try { const c = A.ctx && A.ctx(); const F = c && c.fuel && GS.FUELS ? GS.FUELS[c.fuel] : null; return F ? `${F.label} project` : ''; }
    catch (e) { return ''; }
  }
  /** the option the scope follows: project and option ids */
  function optionKey() {
    const st = (A && A.state) || {};
    const o = A.option && A.option();
    return `${st.projectId || ''}|${o ? o.id : ''}`;
  }
  /** Adopt the current option's bus when the option changed since the scope last followed it — unless a
   *  scope was picked since (by the reader, a hand-off or a caller that set the state before open()). A
   *  change made while the Continuum is on screen always follows (force). Returns a notice (html) when the
   *  bus cannot be shown as itself, else ''. */
  function followOption(force) {
    const k = optionKey();
    if (ST.optKey === k) return '';
    ST.optKey = k;
    const f = ST.followed;
    const same = x => !!x && x.kind === ST.scopeKind && String(x.key) === String(ST.scopeKey);
    const picked = !force && ST.scopeKey != null && !same(f) && !(f == null && same(LOADED));
    if (picked) return '';
    const o = A.option && A.option();
    const id = o && o.busId != null ? Number(o.busId) : null;
    if (id == null || Number.isNaN(id)) return '';
    if (busIds().includes(id)) { ST.scopeKind = 'bus'; ST.scopeKey = id; ST.surfYear = null; ST.followed = { kind: 'bus', key: id }; return ''; }
    const n = GS.node(id);
    if (n && n.zone && zones().includes(n.zone)) {
      ST.scopeKind = 'zone'; ST.scopeKey = n.zone; ST.surfYear = null; ST.followed = { kind: 'zone', key: n.zone };
      return `The option's bus ${esc(n.name || '')} #${id} carries no series in this block, so its zone <b>${esc(n.zone)}</b> is shown.`;
    }
    return `The option's bus #${id} is not in this block and its zone is not known here, so the scope is unchanged.`;
  }

  function onOpen(ev) {
    const det = (ev && ev.detail) || {};
    /* claim it three ways, because ext/50 reads all three before it tells the
       reader nothing listened */
    try { det.handled = true; } catch (e) { /* frozen detail — the other two stand */ }
    try { if (ev && ev.cancelable) ev.preventDefault(); } catch (e) { /* not cancelable */ }
    followOption();   // record the option first, so open() does not override the bus this event names
    const hit = screenFor(det);
    const before = { kind: ST.scopeKind, key: ST.scopeKey };
    let scopeNote = '';

    /* the bus, if Cathy holds a series for it */
    if (det.bus != null) {
      const id = Number(det.bus);
      if (busIds().includes(id)) { ST.scopeKind = 'bus'; ST.scopeKey = id; }
      else {
        const n = GS.node(id);
        if (n && n.zone && zones().includes(n.zone)) {
          ST.scopeKind = 'zone'; ST.scopeKey = n.zone;
          scopeNote = `Bus ${id}${n.name ? ' (' + esc(n.name) + ')' : ''} carries no series in this block, so its zone <b>${esc(n.zone)}</b> is shown instead.`;
        } else scopeNote = `Bus ${id} is not in this block and its zone is not known here, so the scope is unchanged (${esc(before.kind)} ${esc(String(before.key))}).`;
      }
    } else if (Array.isArray(det.pins) && det.pins.length) {
      const id = Number(det.pins[0]);
      if (busIds().includes(id)) { ST.scopeKind = 'bus'; ST.scopeKey = id; }
    }

    if (hit) {
      ST.screen = hit.k;
      const why = hit.fallback || '';
      lastOpen = { detail: det, notice: !why && !scopeNote ? null
        : () => (why ? `Opened at <b>${esc(screenLabel(hit.k))}</b> because ${esc(why)}. ` : '') + scopeNote };
    } else {
      ST.screen = 'explorer';
      const keys = Object.keys(det).filter(k => k !== 'handled');
      const got = keys.length
        ? keys.map(k => `<b>${esc(k)}</b> ${esc(String(typeof det[k] === 'object' ? JSON.stringify(det[k]) : det[k])).slice(0, 60)}`).join(' · ')
        : '(an empty event)';
      /* the screen count is read when the notice is drawn: the hooked screens join SCREENS on the first paint */
      lastOpen = { detail: det, notice: () =>
        `Opened on the price explorer: nothing in what arrived names one of ${esc(NAME())}'s ${SCREENS.length} screens. Received ${got}. ` +
        (scopeNote ? scopeNote + ' ' : '') +
        `Pick a screen above, or send <code>template</code>, <code>dataset</code>, <code>column</code> or <code>stage</code> naming one of: ${SCREENS.map(s => s.label).join(', ')}.` };
    }
    store();
    open();
    paint();
  }
  document.addEventListener('cathy:open', onOpen);

  /* the frame's bus selection follows into Cathy, when Cathy holds that bus */
  document.addEventListener('gsframe:bus', ev => {
    if (!ON) return;
    const id = ev && ev.detail ? Number(ev.detail.busId) : null;
    if (id == null || Number.isNaN(id)) return;
    if (busIds().includes(id)) { lastOpen = null; ST.scopeKind = 'bus'; ST.scopeKey = id; store(); paint(); }
  });

  /* ═══════════════════════════════════════════════════════════════════════
     Wiring — Cathy leaves when the reader goes anywhere else
     ═══════════════════════════════════════════════════════════════════════ */
  ['setView', 'setStage'].forEach(k => {
    const orig = A[k]; if (typeof orig !== 'function') return;
    A[k] = function () { if (ON) close(true); return orig.apply(this, arguments); };
  });
  /* continuum fix 2026-10-06 (D3): the top bar's project, asset and option pickers no longer close the
     Continuum — it stays open and follows the new option's bus (and names the asset on its context line) */
  ['setProject', 'setOption'].forEach(k => {
    const orig = A[k]; if (typeof orig !== 'function') return;
    A[k] = function () {
      const fuel0 = assetFuel();
      const r = orig.apply(this, arguments);
      if (ON) {
        const fo = followOption(true);
        lastOpen = fo ? { detail: null, notice: fo } : null;
        /* S-nav 2026-10-07: a new asset moves to its own screen (a data centre to Offtake, the rest to Shape) */
        const fuel1 = assetFuel(), C1 = CORE();
        if (C1 && fuel1 !== fuel0 && C1.leadScreen(fuel1) !== C1.leadScreen(fuel0)) ST.screen = landing(C1.leadScreen(fuel1));
        ST.openedFor = `${optionKey()}|${fuel1 || ''}`;
        store(); paint(); markTabs();
      }
      return r;
    };
  });

  /* Installed after ext/30, so this `finally` runs after the frame is rebuilt:
     the topbar exists by then and #gsc-root can go back into the fresh #gsf-ws. */
  ['stage', 'portfolio', 'compare', 'mine', 'market', 'all', 'dashboard'].forEach(k => {
    const orig = Views[k]; if (typeof orig !== 'function') return;
    Views[k] = function (host, c) {
      try { return orig.call(this, host, c); }
      finally {
        try { installTab(); if (ON) paint(); }
        catch (e) { console.warn('[cathy] ' + ((e && e.message) || e)); }
      }
    };
  });

  /* continuum S0 2026-10-06: ST is THE state — bound to ext/59 as the same object, so GSContinuum.state() and
     every hooked module read one scope, one run set, one market and one scenario */
  if (CORE()) {
    CORE().bind({ ST, store, paint, scope, runs: () => selected().slice(), market: () => market(),
      asset: () => { try { const c = A.ctx && A.ctx(); const F = c && c.fuel && GS.FUELS ? GS.FUELS[c.fuel] : null; return c && c.fuel ? { fuel: c.fuel, label: F ? F.label : c.fuel } : null; } catch (e) { return null; } },
      on: () => ON });
    CORE().on('scenario', () => { if (ON) paint(); });
    CORE().on('live', () => { if (ON) paint(); });   // S-nav 2026-10-07: connected → every panel reads on this paint
  }

  window.GSCathy = {
    open, close, paint, shownIn,   // S-nav 2026-10-07: hooked modules link to the one home of a chart
    get on() { return ON; },
    state: ST,
    get continuum() { return CORE(); },   // continuum S0 2026-10-06
    screens: SCREENS.map(s => s.k),
    scenarios: SCENARIOS,
    exportCsv, exportPng,
    csvFor,
    get last() { return Object.assign({}, LAST); },
    get draws() { return COUNT.draws; },
    get hovers() { return COUNT.hovers; },
    get data() { return DATA(); },
  };
  /* ext/50's hand-off reads `window.Cathy` as one of its three "was it claimed"
     tests, so the alias is part of the contract, not a convenience. */
  window.Cathy = window.GSCathy;

  /* a module loaded after the host's first paint needs one tab installed by hand */
  if (document.querySelector('#app > .hdr')) installTab();
})();
