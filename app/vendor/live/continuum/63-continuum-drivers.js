/* VENDORED from live Studio ext/63-continuum-drivers.js (snapshot 2026-10-11, sha256 0dab3fffa213f41f).
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/continuum/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   ext: 63-continuum-drivers.js — the Drivers screen's two panels (continuum S4 2026-10-06).

   Dossier: design/10-build-slices.md S4 · 04-architecture §Congestion attribution · 05-ui wireframes (Drivers)
   and screen-states · 08-tests A8/A9/A10/F3 (rewritten for stacking) · D-008 "Recovered shift factors, gated,
   stacked" · build-logs/S4-gates.md (the API contract, and the 2026-10-06 orchestrator note on 'approximate').

   Registered through GSContinuum (ext/59) onto the Drivers workflow screen; owns nothing else on the page.

   1 · Congestion by constraint — one diverging stacked bar per period, settled DA/RT years → each solved run, in ONE
       unit ($/MWh of the period's mean congestion component) on ISO-NE's settled sign (+ premium over the system
       energy price, − discount: a generation pocket). Per period the chart form follows the API's method:
         exact / recovered   facility bars (premiums above zero, discounts below, largest nearest the axis), a
                             hatched signed Other = net − Σ bars, ◆ = net MCC; recovered bars carry a ± band whisker
         not_attributable    one total-only bar = the net, with the reason (no split is drawn)
       The method is printed under every column, so the divider never hides a change of method. "≈" marks an
       approximate settled ↔ run name match; BERLIN 1771 and the RI-IMP / NWVT_I / BSTN interface maps are shown
       approximate even where the API still says exact (orchestrator 2026-10-06, until a vendor branch export).
   2 · Basis by year — node − hub mean per period (settled DA and RT, then the runs), from /continuum/basis.

   Data: GET /api/v2/continuum/congestion-by-constraint and /basis through GSContinuum.api. A proxy scenario is
   passed to the server, which scales only the Base run per year; settled history is never scaled. A fresh browser
   reads nothing until the reader asks ("Load constraint data"); after one good read the panels load on open —
   the same rule as the scenario list (S0), because Chrome logs every refused fetch as a console error.
   Chart, table and CSV are built from one array per response.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const C = root.GSContinuum;
  if (!C || typeof C.register !== 'function') return;

  const MOD = 'ext/63';
  const FLAG = 'gs.continuum.drivers.ok';
  const NS = 'http://www.w3.org/2000/svg';
  const CONG = '/api/v2/continuum/congestion-by-constraint';
  const BASIS = '/api/v2/continuum/basis';
  /** shown as approximate whatever the API says (S4-gates.md, orchestrator note 2026-10-06) */
  const SHOW_APPROX = new Set(['ELBERLIN1771A', 'IFRIIMP', 'IFNWVTI', 'IFBSTN']);
  const APPROX_WHY = 'shown as ≈ until a vendor branch export confirms the line (orchestrator 2026-10-06)';
  const RUN_ORDER = ['5yr', 'pcr2030', '10yr', 'pcr2035', 'pcr2040'];
  const NCOL = 6;            // six series identities (--s1…--s6); past six, colour stops telling series apart
  const OUTLIER = 4;         // a period more than 4× the next-largest is drawn clipped (view option)

  /* ── small DOM helpers ─────────────────────────────────────────────────── */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function sv(tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(k => { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  const MINUS = '−';
  const sgn = (v, d) => v == null || !Number.isFinite(+v) ? '—' : (+v >= 0 ? '+' : MINUS) + Math.abs(+v).toFixed(d == null ? 2 : d);
  const abs2 = v => Math.abs(+v).toFixed(2);
  const intf = v => v == null ? '—' : Math.round(+v).toLocaleString('en-US');
  const normKey = k => String(k || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  /** "111135 W BARNSTABLE 115 111215 MASHPEE_137 115 1" -> "W BARNSTABLE 115 – MASHPEE_137 115" (PSS/E branch);
   *  ISO-NE names ("BERLIN1771ALN", "NE_WE (interface)") and flowgates ("DNEAST Export") are kept as published */
  function niceName(f) {
    const s = String(f || '').trim().replace(/\s+/g, ' ');
    const m = /^(\d+) (.+?) (\d+(?:\.\d+)?) (\d+) (.+?) (\d+(?:\.\d+)?) (\S+)$/.exec(s);
    if (!m) return s;
    return `${m[2]} ${m[3]} – ${m[5]} ${m[6]}${m[7] !== '1' ? ` ckt ${m[7]}` : ''}`;
  }
  function shownMatch(b) {
    const api = b.match || 'none';
    if (api === 'exact' && (SHOW_APPROX.has(normKey(b.legend_key)) || SHOW_APPROX.has(normKey(b.key)))) return 'approximate';
    return api;
  }
  const matchWord = m => m === 'approximate' ? '≈ approximate' : m === 'exact' ? '= exact' : 'none';

  /* ── where the panel reads ─────────────────────────────────────────────── */
  function locOf(cx) {
    const s = cx.scope ? cx.scope() : { kind: 'hub', key: 'HUB' };
    if (s.kind === 'hub') return { kind: 'hub', bus: 'HUB', word: 'the ISO-NE hub' };
    if (s.kind === 'zone') return { kind: 'zone', bus: String(s.key), word: `${s.key} zone` };
    return { kind: 'bus', bus: String(s.key), word: `bus ${s.key}` };
  }
  /** the scenario sent to the server: only one the published list holds (else Base, and the line says why) */
  function scenOf(cx) {
    const S = cx.scen, sid = (cx.ST && cx.ST.scenario) || 'base';
    if (!S || sid === 'base' || S.state !== 'ok' || !S.entry(sid)) return 'base';
    return sid;
  }

  /* ── the read: one answer per (route, location, scenario); failures kept until "Load again" ── */
  const RES = new Map();
  const PENDING = new Map();
  let LOADED = false;
  /* S-nav 2026-10-07: one live connection for the whole Continuum (GSContinuum.live) replaces "Load constraint data" */
  const allowed = () => { if (LOADED) return true; if (C.live && C.live.allowed()) return true; try { return !!root.localStorage.getItem(FLAG); } catch (e) { return false; } };
  function remember() { LOADED = true; try { root.localStorage.setItem(FLAG, String(Date.now())); } catch (e) { /* storage refused */ } }
  const keyOf = (route, loc, sid) => `${route}|${loc.bus}|${sid}`;
  const FAIL_TTL_MS = 30000;   // a failure is shown until "Load again" or for 30 s, then the server is asked again
  function cached(k) {
    const r = RES.get(k);
    if (r && !r.ok && Date.now() - (r.at || 0) > FAIL_TTL_MS) { RES.delete(k); return null; }
    return r || null;
  }
  function load(route, loc, sid, fresh) {
    const k = keyOf(route, loc, sid);
    if (PENDING.has(k)) return PENDING.get(k);
    const p = { bus: loc.bus, scenario: sid };
    const call = route === CONG ? C.api.congestion(p, { fresh: !!fresh }) : C.api.basis(p, { fresh: !!fresh });
    const pr = Promise.resolve(call).then(res => {
      res.at = Date.now(); RES.set(k, res); PENDING.delete(k);
      if (res && res.ok) remember();
      return res;
    }, e => {
      const res = { ok: false, state: 'server-error', at: Date.now(), why: `the request failed in the page: ${(e && e.message) || e}` };
      RES.set(k, res); PENDING.delete(k); return res;
    });
    PENDING.set(k, pr);
    return pr;
  }

  /* ── shared panel states (written, never blank) ────────────────────────── */
  function stateBox(body, state) {
    body.innerHTML = '';
    const w = el('div', 'drv-wrap'); w.setAttribute('data-drv-state', state);
    body.appendChild(w);
    return w;
  }
  function idle(body, cx, what) {
    const w = stateBox(body, 'idle');
    w.appendChild(cx.emptyBox('Live data not connected',
      `${what} is read from the live GridSense server. Connect live data (top bar) once; this browser then reads it on every open.`));
  }
  function loading(body, cx, what) {
    const w = stateBox(body, 'loading');
    w.appendChild(cx.emptyBox(`Reading ${what.toLowerCase()} from the live server…`, 'Every period in one request.'));
  }
  function failed(body, cx, res, what, retry) {
    const w = stateBox(body, 'error');
    const held = res.state === 'not-found' || res.state === 'bad-request';
    const title = held ? `Not held at this location` : `Could not read ${what.toLowerCase()}`;
    const why = held ? `${res.why || 'the server holds nothing here'}.` : `${res.why || 'the live server did not answer'}. Other panels are unaffected.`;
    const e = cx.emptyBox(title, why);
    if (!held) {
      const b = el('button', 'gsc-btn', 'Load again'); b.type = 'button'; b.setAttribute('data-drv-retry', 'true');
      b.title = 'Ask the live server again';
      b.onclick = retry;
      e.appendChild(b);
    }
    w.appendChild(e);
  }

  /* ── the one array: periods in drawing order, parts stacked, rows for table and CSV ── */
  function periodWord(p) {
    if (p.kind === 'settled') return `${p.market} ${p.year}${p.partial ? '*' : ''}`;
    return C.scen.runWord(p.run || p.period);
  }
  function sourceWord(p) {
    if (p.kind === 'settled') return `Settled ${p.market}`;
    if (/^pcr/i.test(p.run || p.period)) return 'Solved run PCR';
    return `Solved run ${C.scen.runWord(p.run || p.period)}`;
  }
  function order(periods) {
    const set = periods.filter(p => p.kind === 'settled').sort((a, b) => (a.year - b.year) || String(a.market).localeCompare(String(b.market)));
    const run = periods.filter(p => p.kind !== 'settled').sort((a, b) => {
      const ia = RUN_ORDER.indexOf(a.period), ib = RUN_ORDER.indexOf(b.period);
      if (ia >= 0 && ib >= 0) return ia - ib;
      return (a.year - b.year) || (ia - ib);
    });
    return { set, run, all: set.concat(run) };
  }
  function scenMark(body, p) {
    const sc = body.scenario;
    if (!sc) return { mark: '', word: 'Base' };
    if (p.kind === 'settled') return { mark: 'settled', word: 'settled — never scaled' };
    const bp = (sc.by_period || {})[p.period] || {};
    if (bp.applied) return { mark: 'applied', word: `${C.scen.short(sc.id)} ${C.scen.factorWord(bp.factor || sc.factor)} (proxy)`, note: bp.note };
    return { mark: 'solved', word: `drawn as solved — ${bp.note || 'not the Base run for this year'}`, note: bp.note };
  }
  function partsOf(p) {
    if (p.method === 'not_attributable') return [{ role: 'total', v: p.net_mcc, name: 'Total congestion (not split)' }];
    const bars = (p.bars || []).map(b => ({ role: 'bar', v: b.value_usd_mwh, band: b.band_usd_mwh, b, key: b.legend_key || b.key,
      name: niceName(b.facility), match: shownMatch(b), apiMatch: b.match || 'none', hours: b.binding_hours }));
    const other = { role: 'other', v: p.other == null ? 0 : p.other, name: 'Other (not attributed)', parts: p.other_parts, n: p.other_n };
    return bars.concat([other]);
  }
  function model(res) {
    const body = res.body;
    const o = order(body.periods || []);
    /* colour identities: three per side of the divider, ranked by Σ|bar| on that side, taken alternately (so the
       Cape 5yr bars cannot take every hue and leave history grey); a key matched across the divider is one colour */
    const big = new Map(), side = { set: new Map(), run: new Map() };
    o.all.forEach(p => (p.bars || []).forEach(b => {
      const k = b.legend_key || b.key, v = Math.abs(b.value_usd_mwh), sd = side[p.kind === 'settled' ? 'set' : 'run'];
      big.set(k, Math.max(big.get(k) || 0, v)); sd.set(k, (sd.get(k) || 0) + v);
    }));
    const rank = mp => [...mp.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
    const rs = rank(side.set), rr = rank(side.run), picked = [];
    for (let i = 0; picked.length < NCOL && (i < rs.length || i < rr.length); i++) {
      [rs[i], rr[i]].forEach(k => { if (k != null && picked.length < NCOL && !picked.includes(k)) picked.push(k); });
    }
    const colour = new Map(picked.map((k, i) => [k, i + 1]));
    const ranked = picked.concat(rank(big).filter(k => !colour.has(k)));
    const cols = o.all.map(p => {
      /* C3: a period the server does not hold (net_mcc null; its reason in p.not_held) keeps its column but has no
         parts and no net: a gap labelled "not held", never a 0 bar or a NaN coordinate */
      if (p.net_mcc == null) return { p, nh: true, parts: [], pos: 0, neg: 0, ext: null, scen: scenMark(body, p), cape: !!(p.cape && p.cape.flagged) };
      const parts = partsOf(p);
      /* stacking: premiums up, discounts down, largest nearest the axis, Other outermost on its side */
      const up = parts.filter(x => x.role === 'bar' && x.v >= 0).sort((a, b) => b.v - a.v);
      const dn = parts.filter(x => x.role === 'bar' && x.v < 0).sort((a, b) => a.v - b.v);
      const oth = parts.find(x => x.role === 'other');
      if (oth) (oth.v >= 0 ? up : dn).push(oth);
      let a = 0; up.forEach(x => { x.y0 = a; a += x.v; x.y1 = a; });
      let d = 0; dn.forEach(x => { x.y0 = d; d += x.v; x.y1 = d; });
      const tot = parts.find(x => x.role === 'total');
      if (tot) { tot.y0 = 0; tot.y1 = tot.v; }
      const pos = tot ? Math.max(0, tot.v) : a, neg = tot ? Math.min(0, tot.v) : d;
      return { p, parts: tot ? [tot] : up.concat(dn), pos, neg, ext: Math.max(pos, -neg, Math.abs(p.net_mcc || 0)),
        scen: scenMark(body, p), cape: !!(p.cape && p.cape.flagged) };
    });
    return { body, cols, colour, ranked, nSet: o.set.length };
  }
  /** the periods drawn clipped: a period more than OUTLIER× every other one (the Cape 5yr bar at Hatchville) */
  function outliers(exts) {
    const idx = exts.map((e, i) => [e, i]).filter(x => x[0] != null).sort((a, b) => b[0] - a[0]);  // C3: not held is no extent
    const out = new Set();
    for (let k = 0; k < Math.min(2, idx.length - 1); k++) {
      if (idx[k + 1][0] > 0 && idx[k][0] > OUTLIER * idx[k + 1][0]) { for (let j = 0; j <= k; j++) out.add(idx[j][1]); }
    }
    return out;
  }
  function niceAxis(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; }
    const raw = (hi - lo) / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    const ticks = []; for (let v = a; v <= b + step / 2; v += step) ticks.push(+v.toFixed(10));
    return { lo: a, hi: b, step, ticks, dp: Math.max(0, -Math.floor(Math.log10(step) + 1e-9)) };
  }

  /* ── 1 · congestion by constraint ──────────────────────────────────────── */
  let CLIP = true;
  let SEQ = 0;
  const TCOLS = ['Period', 'Year', 'Source', 'Method', 'Row', 'Constraint', 'Match', 'Value ($/MWh, settled sign)', 'Band ± ($/MWh)',
    'Binding hours', 'Contingencies', 'Net MCC ($/MWh)', 'Fit R²', 'Scenario', 'Flag', 'Reason'];
  function otherWhy(x) {
    const ps = x.parts || {};
    const W = { intercept: 'intercept', below_min_hours: 'under 50 h', vif_over_max: 'VIF over 10', below_floor: 'under 0.01 $/MWh',
      sf_over_1: '|SF| over 1', not_shown: 'beyond the top 5' };
    return Object.keys(W).filter(k => ps[k] && (ps[k].n || ps[k].usd_mwh)).map(k => `${W[k]} ${sgn(ps[k].usd_mwh, 4)} (${ps[k].n})`).join(' · ');
  }
  function congRows(m) {
    const rows = [];
    m.cols.forEach(c => {
      const p = c.p;
      const meth = p.method == null ? 'not held' : p.method.replace('_', ' ');  // C3
      const flag = [c.cape ? (p.cape.word || p.cape.badge) : '', p.partial ? `part year (${intf(p.hours)} h)` : ''].filter(Boolean).join('; ');
      const base = [p.period, p.year, sourceWord(p), meth];
      const r2 = p.gates && p.gates.r2 != null ? p.gates.r2 : null;
      if (c.nh) {  // C3: not held — the server's reason, never a 0
        rows.push(base.concat(['not held', '', '', 'not held', '', '', '', 'not held', r2, c.scen.word, flag, p.not_held || 'not held by the server']));
        return;
      }
      if (p.method === 'not_attributable') {
        rows.push(base.concat(['total only', 'Total congestion (not split)', '', p.net_mcc, '', '', '', p.net_mcc, r2, c.scen.word, flag, p.reason || '']));
        return;
      }
      c.parts.filter(x => x.role === 'bar').forEach(x => {
        const ctg = (x.b.contingencies || []).map(g => `${niceName(g.label)} (${g.hours} h)`).join('; ');
        rows.push(base.concat(['constraint', x.name, matchWord(x.match) + (x.match !== x.apiMatch ? ` (API ${x.apiMatch})` : ''), x.v, x.band,
          x.hours, ctg, p.net_mcc, r2, c.scen.word, flag, x.match !== x.apiMatch ? APPROX_WHY : (x.b.match_basis || '')]));
      });
      const o = c.parts.find(x => x.role === 'other');
      rows.push(base.concat(['other', 'Other (not attributed)', '', o.v, '', '', '', p.net_mcc, r2, c.scen.word, flag, otherWhy(o)]));
      rows.push(base.concat(['net', 'Net MCC ◆', '', p.net_mcc, '', '', '', p.net_mcc, r2, c.scen.word, flag, '']));
    });
    return rows;
  }
  function readoutText(c, x) {
    const p = c.p, pw = periodWord(p);
    if (!x && p.net_mcc == null) return `${pw} · not held${p.not_held ? ` — ${p.not_held}` : ''}`;  // C3
    if (!x) return `${pw} · net MCC ${sgn(p.net_mcc)} $/MWh · ${String(p.method || 'not held').replace('_', ' ')}${p.reason ? ` — ${p.reason}` : ''}`;
    if (x.role === 'total') return `${pw} · total only ${sgn(x.v)} $/MWh — ${p.reason || 'not attributable'}`;
    if (x.role === 'other') return `${pw} · Other (not attributed) ${sgn(x.v)} $/MWh · ${x.n != null ? `${x.n} constraints · ` : ''}${otherWhy(x)}`;
    const band = p.method === 'exact' ? ' $/MWh · exact (band 0)' : ` ± ${abs2(x.band)} $/MWh · recovered`;
    const ctg = (x.b.contingencies || []).slice(0, 3).map(g => `${niceName(g.label)} ${intf(g.hours)} h`).join('; ');
    const more = (x.b.contingencies || []).length > 3 ? ` +${x.b.contingencies.length - 3} more` : '';
    const sf = x.b.sf != null ? ` · SF ${sgn(x.b.sf, 3)}` : x.b.dfax_max_abs != null ? ` · |DFAX| ≤ ${(+x.b.dfax_max_abs).toFixed(3)}` : '';
    return `${pw} · ${x.match === 'approximate' ? '≈ ' : ''}${x.name} · ${sgn(x.v)}${band} · ${intf(x.hours)} h${sf}` +
      `${ctg ? ` · contingencies: ${ctg}${more}` : ''}${x.match === 'approximate' ? ` · ${x.match !== x.apiMatch ? APPROX_WHY : 'run definition may differ'}` : ''}`;
  }

  function drawCong(host, m, cx) {
    const W = Math.max(360, Math.floor(host.clientWidth || 900));
    const scenOn = !!m.body.scenario;
    const n = m.cols.length;
    const out = CLIP ? outliers(m.cols.map(c => c.ext)) : new Set();
    const negOut = [...out].some(i => m.cols[i].p.net_mcc < 0 || m.cols[i].neg < 0);
    const gap = negOut ? 26 : 0;   // room under the plot for a clipped discount's label
    const P = { l: 56, r: 10, t: 56, b: (scenOn ? 70 : 56) + gap };
    const Hp = 270, H = P.t + Hp + P.b;
    let lo = 0, hi = 0;
    m.cols.forEach((c, i) => { if (out.has(i) || c.nh) return; lo = Math.min(lo, c.neg, c.p.net_mcc); hi = Math.max(hi, c.pos, c.p.net_mcc); });
    if (out.size) { hi *= 1.12; lo *= 1.12; }
    const ax = niceAxis(lo, hi, 5);
    const sy = v => P.t + (ax.hi - Math.max(ax.lo, Math.min(ax.hi, v))) / ((ax.hi - ax.lo) || 1) * Hp;
    const bw = (W - P.l - P.r) / Math.max(1, n), barW = Math.max(10, Math.min(40, bw * 0.52));
    const id = 'drv-h' + (++SEQ);
    const svg = sv('svg', { class: 'gsc-svg drv-svg', viewBox: `0 0 ${W} ${H}`, height: H, role: 'img',
      'aria-label': `Congestion by constraint, $/MWh of mean MCC, settled sign, ${n} periods` });
    svg.setAttribute('data-gsc-chart', 'drv-cong');
    const defs = sv('defs');
    const pat = sv('pattern', { id, patternUnits: 'userSpaceOnUse', width: 5, height: 5, patternTransform: 'rotate(45)' });
    pat.appendChild(sv('rect', { width: 5, height: 5, class: 'drv-hatch-bg' }));
    pat.appendChild(sv('line', { x1: 0, y1: 0, x2: 0, y2: 5, class: 'drv-hatch-ln' }));
    defs.appendChild(pat); svg.appendChild(defs);
    /* axis */
    ax.ticks.forEach(v => {
      const y = sy(v);
      svg.appendChild(sv('line', { class: 'gsc-grid drv-grid', x1: P.l, x2: W - P.r, y1: y, y2: y }));
      svg.appendChild(sv('text', { class: 'drv-ax', x: P.l - 6, y: y + 3, 'text-anchor': 'end' }, sgn(v, ax.dp).replace(/^\+0(\.0+)?$/, '0').replace(/^−0(\.0+)?$/, '0')));
    });
    svg.appendChild(sv('text', { class: 'drv-lab', x: 2, y: 12 }, '$/MWh MCC · + premium, − discount'));
    const z = sy(0);
    svg.appendChild(sv('line', { class: 'drv-zero', x1: P.l, x2: W - P.r, y1: z, y2: z, 'data-drv-zero': 'true' }));
    /* the divider: last settled period | first solved run */
    if (m.nSet > 0 && m.nSet < n) {
      const x = P.l + m.nSet * bw;
      svg.appendChild(sv('line', { class: 'drv-div', x1: x, x2: x, y1: P.t - 14, y2: H - 4, 'data-drv-divider': 'true', 'data-after': m.cols[m.nSet - 1].p.period }));
      svg.appendChild(sv('text', { class: 'drv-lab', x: x - 6, y: 12, 'text-anchor': 'end' }, 'Settled ←'));
      svg.appendChild(sv('text', { class: 'drv-lab', x: x + 6, y: 12 }, '→ Solved runs · same unit and sign'));
    }
    const readout = el('div', 'drv-readout'); readout.setAttribute('data-drv-readout', 'true');
    readout.textContent = 'Hover a segment: constraint, contingencies, binding hours and band.';
    const hits = new Map();
    m.cols.forEach((c, i) => {
      const p = c.p, cxp = P.l + i * bw + bw / 2, bx = cxp - barW / 2;
      const g = sv('g', { 'data-drv-period': p.period, 'data-method': p.method, 'data-net': p.net_mcc, 'data-kind': p.kind === 'settled' ? 'settled' : 'run',
        'data-cape': c.cape ? '1' : '0', 'data-scen': c.scen.mark, 'data-clipped': out.has(i) ? '1' : '0' });
      c.parts.forEach(x => {
        const y0 = sy(Math.max(x.y0, x.y1)), y1 = sy(Math.min(x.y0, x.y1));
        let cls = 'drv-seg';
        if (x.role === 'bar') cls += m.colour.has(x.key) ? ` drv-c${m.colour.get(x.key)}` : ' drv-cn';
        else if (x.role === 'other') cls += ' drv-oth';
        else cls += ' drv-tot';
        const r = sv('rect', { class: cls, x: bx.toFixed(2), y: y0.toFixed(2), width: barW.toFixed(2), height: Math.max(0, y1 - y0).toFixed(2),
          'data-drv-seg': 'true', 'data-role': x.role, 'data-v': x.v, 'data-band': x.role === 'bar' ? x.band : null,
          'data-match': x.match || null, 'data-api-match': x.apiMatch || null, 'data-key': x.key || null, 'data-name': x.name,
          'data-hours': x.hours != null ? x.hours : null,
          'data-clipped': (Math.max(x.y0, x.y1) > ax.hi || Math.min(x.y0, x.y1) < ax.lo) ? '1' : null });
        if (x.role === 'other') r.setAttribute('fill', `url(#${id})`);
        const t = sv('title'); t.textContent = readoutText(c, x); r.appendChild(t);
        hits.set(r, readoutText(c, x));
        g.appendChild(r);
        /* the band, recovered bars only: a whisker at the bar's outer end, beside the stack */
        if (x.role === 'bar' && p.method === 'recovered' && x.band > 0) {
          const end = x.y1, wx = bx + barW + 3;
          const ya = sy(end + Math.sign(end || 1) * x.band), yb = sy(end - Math.sign(end || 1) * x.band);
          const wg = sv('g', { class: 'drv-band', 'data-drv-band': x.band });
          wg.appendChild(sv('line', { x1: wx, x2: wx, y1: ya, y2: yb }));
          wg.appendChild(sv('line', { x1: wx - 2, x2: wx + 2, y1: ya, y2: ya }));
          wg.appendChild(sv('line', { x1: wx - 2, x2: wx + 2, y1: yb, y2: yb }));
          g.appendChild(wg);
        }
      });
      /* a clipped column says so: a break mark and the net in words */
      if (out.has(i)) {
        const yt = c.pos > ax.hi ? sy(ax.hi) : null, yb = c.neg < ax.lo ? sy(ax.lo) : null;
        if (yt != null) g.appendChild(sv('path', { class: 'drv-break', d: `M${bx - 2},${yt + 9} l${barW / 2 + 2},-5 l${barW / 2 + 2},5` }));
        if (yb != null) g.appendChild(sv('path', { class: 'drv-break', d: `M${bx - 2},${yb - 9} l${barW / 2 + 2},5 l${barW / 2 + 2},-5` }));
      }
      /* ◆ net */
      if (c.nh) {  /* C3: not held — the words in the empty column, the server's reason on hover */
        const ym = (P.t + Hp / 2).toFixed(2);  // vertical, mid-plot: an empty column has room, neighbours never collide
        const nt = sv('text', { class: 'drv-lab drv-nh', x: cxp, y: ym, transform: `rotate(-90 ${cxp.toFixed(2)} ${ym})`, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'data-drv-not-held': p.period }, 'not held');
        const tt = sv('title'); tt.textContent = readoutText(c, null); nt.appendChild(tt);
        g.appendChild(nt);
      } else {
      const ny = sy(p.net_mcc), d = 5;
      const dm = sv('path', { class: 'drv-net', d: `M${cxp},${ny - d} L${cxp + d},${ny} L${cxp},${ny + d} L${cxp - d},${ny} Z`, 'data-drv-net': p.net_mcc });
      const dt = sv('title'); dt.textContent = readoutText(c, null); dm.appendChild(dt);
      hits.set(dm, readoutText(c, null));
      g.appendChild(dm);
      }
      if (out.has(i)) {
        /* the net in words, on the side the column leaves the scale: two short lines so neighbours never collide */
        const yy = p.net_mcc >= 0 ? [P.t - 19, P.t - 8] : [P.t + Hp + 11, P.t + Hp + 22];
        g.appendChild(sv('text', { class: 'drv-lab drv-off', x: cxp, y: yy[0], 'text-anchor': 'middle' }, `◆ ${sgn(p.net_mcc)}`));
        g.appendChild(sv('text', { class: 'drv-lab drv-off', x: cxp, y: yy[1], 'text-anchor': 'middle' }, 'off scale'));
      }
      if (c.cape) {
        const cb = sv('text', { class: 'drv-cape', x: cxp, y: out.has(i) && p.net_mcc >= 0 ? P.t - 31 : P.t - 8, 'text-anchor': 'middle', 'data-drv-cape': p.period }, '⚑ Cape');
        const ct = sv('title'); ct.textContent = p.cape.note || p.cape.badge || 'Cape-flagged run input'; cb.appendChild(ct);
        g.appendChild(cb);
      }
      /* the column's labels: year, source, method, and the scenario mark when one is chosen */
      const ly = H - P.b + gap + 14;
      const yr = p.kind === 'settled' ? `${p.year}${p.partial ? '*' : ''}` : String(p.year);
      const src = p.kind === 'settled' ? p.market : (/^pcr/i.test(p.period) ? 'PCR' : String(p.period).replace(/^(\d+)yr$/i, '$1-yr'));
      const meth = c.nh ? null : p.method === 'not_attributable' ? 'total only' : p.method;  // C3
      [[yr, 'drv-ax'], [src, 'drv-ax'], [meth, `drv-meth drv-m-${c.nh ? 'not-held' : p.method}`]].forEach(([t, cl], j) =>
        g.appendChild(sv('text', { class: cl, x: cxp, y: ly + j * 13, 'text-anchor': 'middle' }, t)));
      if (scenOn) {
        const sm = c.scen.mark === 'applied' ? (C.scen.factorWord(((m.body.scenario.by_period || {})[p.period] || {}).factor || m.body.scenario.factor))
          : c.scen.mark === 'solved' ? 'solved' : '';
        if (sm) g.appendChild(sv('text', { class: `drv-meth drv-s-${c.scen.mark}`, x: cxp, y: ly + 3 * 13, 'text-anchor': 'middle' }, sm));
      }
      svg.appendChild(g);
    });
    svg.addEventListener('mouseover', e => {
      const t = e.target && e.target.closest ? e.target.closest('[data-drv-seg],[data-drv-net]') : null;
      if (t && hits.has(t)) readout.textContent = hits.get(t);
    });
    host.appendChild(svg);
    host.appendChild(readout);
    return { out };
  }
  function legendCong(host, m) {
    const lg = el('div', 'drv-legend');
    const used = new Set(); m.cols.forEach(c => c.parts.forEach(x => { if (x.role === 'bar') used.add(x.key); }));
    const first = new Map();
    m.cols.forEach(c => c.parts.forEach(x => { if (x.role === 'bar' && !first.has(x.key)) first.set(x.key, x); }));
    const approxKeys = new Set(); m.cols.forEach(c => c.parts.forEach(x => { if (x.role === 'bar' && x.match === 'approximate') approxKeys.add(x.key); }));
    const item = (key, sw, text, title) => {
      const s = el('span', 'drv-li'); s.setAttribute('data-drv-legend', key);
      const k = el('i', 'drv-sw ' + sw); s.appendChild(k); s.appendChild(el('span', null, text));
      if (title) s.title = title; lg.appendChild(s);
    };
    m.ranked.filter(k => used.has(k) && m.colour.has(k)).forEach(k => {
      const x = first.get(k);
      item(k, `drv-c${m.colour.get(k)}`, `${approxKeys.has(k) ? '≈ ' : ''}${x.name}`,
        approxKeys.has(k) ? `≈ settled ↔ run name match, unconfirmed by physics (${x.match !== x.apiMatch ? APPROX_WHY : 'run interface definition may differ'})` : '');
    });
    const rest = [...used].filter(k => !m.colour.has(k));
    if (rest.length) item('more', 'drv-cn', `${rest.length} more named constraint${rest.length === 1 ? '' : 's'}`, rest.map(k => first.get(k).name).join(' · '));
    item('other', 'drv-oth-sw', 'Other — net minus named bars (signed)', 'Constraints under 50 binding hours, collinear sets, sub-floor bars and the intercept');
    item('net', 'drv-net-sw', 'net MCC', 'The period\'s mean congestion component; Σ parts may exceed it where premiums and discounts offset');
    item('band', 'drv-band-sw', '± band (recovered)', '±max(0.01 $/MWh, 20 %) on recovered bars; exact bars carry none');
    item('total', 'drv-tot-sw', 'Total only (not attributable)', 'The constant-shift-factor fit is below R² 0.95: only the total is drawn');
    host.appendChild(lg);
  }
  function answerLine(m, loc) {
    const s = m.cols.filter(c => c.p.kind === 'settled' && !c.nh).map(c => c.p.net_mcc);  // C3: not held is no range point
    const r = m.cols.filter(c => c.p.kind !== 'settled' && !c.nh).map(c => c.p.net_mcc);
    const rng = a => a.length ? `${sgn(Math.min(...a))} to ${sgn(Math.max(...a))}` : 'not held';
    let top = null;
    m.cols.forEach(c => c.parts.forEach(x => { if (x.role === 'bar' && (!top || Math.abs(x.v) > Math.abs(top.x.v))) top = { c, x }; }));
    const tw = top ? ` · largest bar ${top.x.name} ${sgn(top.x.v)}${top.c.p.method === 'recovered' ? ` ± ${abs2(top.x.band)}` : ''} (${periodWord(top.c.p)}${top.c.cape ? ', Cape-flagged' : ''})` : '';
    return `${loc} · net MCC settled ${rng(s)} · solved runs ${rng(r)} $/MWh${tw}`;
  }

  function buildCong(host, cx) {
    const loc = locOf(cx);
    const key = () => keyOf(CONG, locOf(cx), scenOf(cx));
    const table = () => {
      const res = RES.get(key());
      if (!res || !res.ok) return { cols: TCOLS.map(l => ({ l })), rows: [], why: res ? (res.why || 'Not held here.') : 'Not read yet — load the constraint data on the chart view.' };
      return { cols: TCOLS.map(l => ({ l })), rows: congRows(model(res)) };
    };
    let panelEl = null;
    const ctl = el('div', 'gsc-seg'); ctl.setAttribute('role', 'group'); ctl.setAttribute('aria-label', 'Scale · view');
    ctl.setAttribute('data-gsc-seg', 'drv-scale');
    [['clip', 'Clip outliers', 'A period more than 4× every other is drawn clipped, with its net in words'], ['full', 'All periods', 'One scale that fits every period']].forEach(([v, l, t]) => {
      const b = el('button', null, l); b.type = 'button'; b.dataset.gscVal = v; b.title = t;
      b.setAttribute('aria-pressed', (v === 'clip') === CLIP ? 'true' : 'false');
      b.onclick = () => { CLIP = v === 'clip'; cx.paint(); };
      ctl.appendChild(b);
    });
    const draw = body => {
      const sid = scenOf(cx), k = keyOf(CONG, loc, sid);
      const render = res => {
        if (!res.ok) { failed(body, cx, res, 'Congestion by constraint', () => { RES.delete(k); C.api.reset(); load(CONG, loc, sid, true); cx.paint(); }); return; }
        const m = model(res);
        const w = stateBox(body, m.cols.length ? 'ok' : 'empty');
        if (!m.cols.length) { w.appendChild(cx.emptyBox('No congestion period held here', `The server holds no settled or solved period at ${loc.word}.`)); return; }
        const L = res.body.location || {};
        const where = `${L.label || loc.word}${L.kind === 'bus' ? ` · bus ${L.id}` : ''}`;
        { const an = el('div', 'drv-answer', answerLine(m, where)); an.title = an.textContent; w.appendChild(an); }
        drawCong(w, m, cx);
        legendCong(w, m);
        const na = m.cols.filter(c => c.p.method === 'not_attributable');
        if (na.length) {
          const t = el('div', 'drv-note'); t.setAttribute('data-drv-na', 'true');
          t.textContent = `Total only (not attributable): ${na.map(c => `${periodWord(c.p)} ${sgn(c.p.net_mcc)} — ${c.p.reason || 'fails a location gate'}`).join(' · ')}`;
          w.appendChild(t);
        }
        const cape = m.cols.find(c => c.cape);
        if (cape) { const t = el('div', 'drv-note drv-capenote'); t.setAttribute('data-drv-capenote', cape.p.period); t.textContent = `⚑ ${periodWord(cape.p)}: ${cape.p.cape.note || cape.p.cape.badge}`; w.appendChild(t); }
        const part = m.cols.filter(c => c.p.partial);
        const bl = el('div', 'drv-note gsc-method'); bl.setAttribute('data-drv-basis-line', 'true');
        bl.hidden = !(panelEl && panelEl.querySelector('[data-gsc-info][aria-expanded="true"]'));   // S-nav: method behind (i)
        bl.textContent = `Read: ${res.body.basis || ''}${part.length ? ` * Part year: ${part.map(c => `${periodWord(c.p).replace('*', '')} ${intf(c.p.hours)} h`).join(', ')}.` : ''}` +
          ` Gates fixed by the server (D-008): R² ≥ 0.95, ≥ 50 binding hours, VIF ≤ 10, κ ≤ 30, bars ≥ 0.01 $/MWh. Built ${((res.body.vintage || {}).views_built_at || '').replace('T', ' ')}.`;
        w.appendChild(bl);
        fixScenLine(panelEl, res.body, m);
      };
      if (cached(k)) { render(cached(k)); return; }
      if (!allowed()) { idle(body, cx, 'Congestion by constraint'); return; }
      loading(body, cx, 'Congestion by constraint');
      load(CONG, loc, sid).then(res => { if (body.isConnected) render(res); });
    };
    panelEl = cx.panel({
      id: 'drv-cong', wide: true, title: 'Congestion by constraint', csv: true, table, controls: [ctl], draw,
      sig: cx.sig ? cx.sig('congestion-by-constraint', 'settled 2021–26 + solved runs', 'DA/RT + model') : null,
      faceText: `ISO-NE | ${loc.word} | congestion by constraint | $/MWh of mean MCC · settled sign (+ premium · − discount) | method per period (exact · recovered · total only)`,
      note: 'One unit on both sides of the divider: $/MWh of the period\'s mean congestion component (MCC), on ISO-NE\'s settled sign — ' +
        '+ a premium over the system energy price, − a discount (a generation pocket). The method is printed under every column: ' +
        '<b>recovered</b> (gated regression of hourly MCC on binding shadow prices, ± band), <b>exact</b> (μ·DFAX from the run, band 0), ' +
        '<b>total only</b> (the fit is below R² 0.95, so no split is drawn). Σ parts may exceed the net where premiums and discounts offset. ' +
        'Colours never join a settled and a solved constraint unless their names match (≈ = name match, unconfirmed by physics).',
    });
    host.appendChild(panelEl);
    /* S-nav 2026-10-07 (Ganesh: no duplicate graphs): node − hub basis has one home, the fan on Offtake */
    if (cx.shownIn) host.appendChild(cx.shownIn('wf:offtake', 'Node − hub basis by year (p5–p95 fan) and PPA settlement', ''));
  }
  /** the scenario line ext/60 writes is generic; once the server has answered, say which periods it scaled */
  function fixScenLine(panelEl, body, m) {
    if (!panelEl || !body.scenario) return;
    const apply = () => {
      const ln = panelEl.querySelector(':scope > [data-gsc-scen]'); if (!ln) return;
      const sc = body.scenario;
      const ap = m.cols.filter(c => c.scen.mark === 'applied').map(c => periodWord(c.p));
      const so = m.cols.filter(c => c.scen.mark === 'solved').map(c => `${periodWord(c.p)} (${c.p.period}) — ${String(c.scen.note || 'not Base for its year').replace(/\.\s*$/, '')}`);
      ln.setAttribute('data-gsc-scen', 'applied');
      ln.textContent = `Scenario ${sc.label}: ${ap.length ? `${ap.join(', ')} scaled ${C.scen.factorWord(sc.factor)} by the server` : 'no period scaled'}` +
        `${so.length ? `; drawn as solved: ${so.join('; ')}` : ''}. Settled history is never scaled.`;
    };
    apply(); setTimeout(apply, 0);
  }

  /* ── 2 · basis by year ─────────────────────────────────────────────────── */
  const BCOLS = ['Period', 'Year', 'Source', 'Mean node − hub ($/MWh)', 'P5 ($/MWh)', 'P50 ($/MWh)', 'P95 ($/MWh)', 'Solar-weighted ($/MWh)',
    'Δ congestion ($/MWh)', 'Δ loss ($/MWh)', 'Hours', 'Scenario', 'Flag'];
  function basisModel(res) {
    const o = order(res.body.periods || []);
    const years = [...new Set(o.set.map(p => p.year))].sort((a, b) => a - b);
    const cats = years.map(y => ({ k: `y${y}`, label: String(y), sub: 'settled', ps: o.set.filter(p => p.year === y) }))
      .concat(o.run.map(p => ({ k: p.period, label: String(p.year), sub: /^pcr/i.test(p.period) ? 'PCR' : String(p.period).replace(/^(\d+)yr$/i, '$1-yr'), ps: [p] })));
    return { body: res.body, o, cats, nSet: years.length };
  }
  function basisRows(bm) {
    return bm.o.all.map(p => {
      const s = scenMark(bm.body, p);
      return [p.period, p.year, sourceWord(p), p.mean, p.p5, p.p50, p.p95, p.solar_wtd_basis, p.d_congestion, p.d_loss, p.hours, s.word,
        [p.cape && p.cape.flagged ? (p.cape.word || p.cape.badge) : '', p.partial ? 'part year' : ''].filter(Boolean).join('; ')];
    });
  }
  /** S-nav 2026-10-07 · the basis FAN (Offtake, W5.1): every period's hours as a band — p5–p95 light, p25–p75 dark,
   *  the median a tick, the mean a point joined along its series (settled DA · settled RT · solved runs). One sign, one
   *  unit ($/MWh node − hub). A period more than 4× every other is drawn clipped (Clip outliers). */
  function drawBasis(host, bm) {
    const W = Math.max(320, Math.floor(host.clientWidth || 600));
    const P = { l: 50, r: 10, t: 22, b: 34 }, Hp = 200, H = P.t + Hp + P.b;
    const n = bm.cats.length;
    const pts = bm.o.all.map(p => p.mean).filter(v => v != null);
    if (!pts.length) { host.appendChild(el('div', 'drv-note', 'No basis period held here.')); return; }
    const out = CLIP ? outliers(bm.o.all.map(p => Math.max(Math.abs(p.mean || 0), Math.abs(p.p95 || 0) / 4))) : new Set();
    const outP = new Set([...out].map(i => bm.o.all[i].period));
    let lo = 0, hi = 0;
    bm.o.all.forEach(p => {
      if (outP.has(p.period) || p.mean == null) return;
      [p.mean, p.p5, p.p95].filter(v => v != null).forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    });
    const ax = niceAxis(lo, hi * (outP.size ? 1.08 : 1), 4);
    const sy = v => P.t + (ax.hi - Math.max(ax.lo, Math.min(ax.hi, v))) / ((ax.hi - ax.lo) || 1) * Hp;
    const bw = (W - P.l - P.r) / Math.max(1, n);
    const xOf = i => P.l + i * bw + bw / 2;
    const svg = sv('svg', { class: 'gsc-svg drv-svg', viewBox: `0 0 ${W} ${H}`, height: H, role: 'img',
      'aria-label': 'Node minus hub basis by period: p5–p95 and p25–p75 bands, median and mean, $/MWh' });
    svg.setAttribute('data-gsc-chart', 'drv-basis');
    ax.ticks.forEach(v => {
      const y = sy(v);
      svg.appendChild(sv('line', { class: 'gsc-grid drv-grid', x1: P.l, x2: W - P.r, y1: y, y2: y }));
      svg.appendChild(sv('text', { class: 'drv-ax', x: P.l - 6, y: y + 3, 'text-anchor': 'end' }, sgn(v, ax.dp).replace(/^[+−]0(\.0+)?$/, '0')));
    });
    svg.appendChild(sv('text', { class: 'drv-lab', x: 2, y: 12 }, '$/MWh node − hub'));
    svg.appendChild(sv('line', { class: 'drv-zero', x1: P.l, x2: W - P.r, y1: sy(0), y2: sy(0) }));
    if (bm.nSet > 0 && bm.nSet < n) {
      const x = P.l + bm.nSet * bw;
      svg.appendChild(sv('line', { class: 'drv-div', x1: x, x2: x, y1: P.t - 8, y2: H - 4 }));
    }
    const readout = el('div', 'drv-readout'); readout.setAttribute('data-drv-readout-basis', 'true');
    readout.textContent = 'Hover a period: mean, p5–p95, p25–p75, solar-weighted basis.';
    const series = [['DA', 'drv-l1', -1], ['RT', 'drv-l3', 1], ['run', 'drv-l6', 0]];
    const half = Math.max(3, Math.min(9, bw * 0.16));
    series.forEach(([mk, cl, off]) => {
      const seq = [];
      bm.cats.forEach((c, i) => c.ps.forEach(p => {
        if ((mk === 'run') !== (p.kind !== 'settled') || (mk !== 'run' && p.market !== mk) || p.mean == null) return;
        seq.push({ i, p });
      }));
      const dx = off * (half + 2);
      /* the bands first, so the line and the points sit on top */
      seq.forEach(s => {
        const p = s.p, x = xOf(s.i) + dx, clipped = outP.has(p.period);
        const g = sv('g', { class: `drv-fan ${cl}`, 'data-drv-fan': p.period });
        if (p.p5 != null && p.p95 != null) g.appendChild(sv('rect', { class: 'drv-fan-o', x: x - half, width: 2 * half, y: sy(p.p95),
          height: Math.max(1, sy(p.p5) - sy(p.p95)), 'data-clipped': clipped || p.p95 > ax.hi || p.p5 < ax.lo ? '1' : null }));
        if (p.p25 != null && p.p75 != null) g.appendChild(sv('rect', { class: 'drv-fan-i', x: x - half, width: 2 * half, y: sy(p.p75),
          height: Math.max(1, sy(p.p25) - sy(p.p75)) }));
        if (p.p50 != null) g.appendChild(sv('line', { class: 'drv-fan-m', x1: x - half, x2: x + half, y1: sy(p.p50), y2: sy(p.p50) }));
        svg.appendChild(g);
      });
      if (seq.length > 1) svg.appendChild(sv('polyline', { class: `drv-line ${cl}${mk === 'run' ? ' drv-dash' : ''}`,
        points: seq.map(s => `${(xOf(s.i) + dx).toFixed(1)},${sy(s.p.mean).toFixed(1)}`).join(' ') }));
      seq.forEach(s => {
        const p = s.p, clipped = outP.has(p.period), x = xOf(s.i) + dx;
        const c = sv(clipped ? 'path' : 'circle', clipped
          ? { class: `drv-pt ${cl}`, d: `M${x - 5},${sy(p.mean) + 4} L${x},${sy(p.mean) - 5} L${x + 5},${sy(p.mean) + 4} Z` }
          : { class: `drv-pt ${cl}`, cx: x, cy: sy(p.mean), r: 3.5 });
        c.setAttribute('data-drv-pt', 'true'); c.setAttribute('data-period', p.period); c.setAttribute('data-v', p.mean);
        const txt = `${periodWord(p)} · mean ${sgn(p.mean)} $/MWh · p5 ${sgn(p.p5)} · p25 ${sgn(p.p25)} · p50 ${sgn(p.p50)} · p75 ${sgn(p.p75)} · p95 ${sgn(p.p95)}` +
          ` · solar-weighted ${sgn(p.solar_wtd_basis)} · Δ congestion ${sgn(p.d_congestion)} · Δ loss ${sgn(p.d_loss)}` +
          `${p.cape && p.cape.flagged ? ` · ⚑ ${p.cape.word || 'Cape-flagged'}` : ''}${clipped ? ' · drawn at the top edge (off scale)' : ''}`;
        const tt = sv('title'); tt.textContent = txt; c.appendChild(tt);
        c.addEventListener('mouseover', () => { readout.textContent = txt; });
        svg.appendChild(c);
        if (clipped) svg.appendChild(sv('text', { class: 'drv-lab drv-off', x, y: P.t - 6, 'text-anchor': 'middle' }, `${sgn(p.mean)} off scale`));
      });
    });
    bm.cats.forEach((c, i) => {
      svg.appendChild(sv('text', { class: 'drv-ax', x: xOf(i), y: H - P.b + 14, 'text-anchor': 'middle' }, c.label + (c.ps.some(p => p.partial) ? '*' : '')));
      if (c.sub !== 'settled') svg.appendChild(sv('text', { class: 'drv-ax', x: xOf(i), y: H - P.b + 27, 'text-anchor': 'middle' }, c.sub));
      if (c.ps.some(p => p.cape && p.cape.flagged)) svg.appendChild(sv('text', { class: 'drv-cape', x: xOf(i),
        y: P.t - 6 - (c.ps.some(p => outP.has(p.period)) ? 12 : 0), 'text-anchor': 'middle' }, '⚑ Cape'));
    });
    if (bm.nSet) svg.appendChild(sv('text', { class: 'drv-ax', x: (xOf(0) + xOf(bm.nSet - 1)) / 2, y: H - P.b + 27, 'text-anchor': 'middle' }, 'settled DA · RT'));
    host.appendChild(svg);
    host.appendChild(readout);
    const lg = el('div', 'drv-legend');
    [['DA', 'drv-l1', 'Settled DA'], ['RT', 'drv-l3', 'Settled RT'], ['run', 'drv-l6 drv-dash', 'Solved run (dashed)'],
      ['band', 'drv-fan-sw', 'p5–p95 · p25–p75 of the hours · — median · ● mean']].forEach(([k, cl, tx]) => {
      const s = el('span', 'drv-li'); s.setAttribute('data-drv-legend', 'basis-' + k);
      s.appendChild(el('i', 'drv-sw drv-swl ' + cl)); s.appendChild(el('span', null, tx)); lg.appendChild(s);
    });
    host.appendChild(lg);
  }
  function buildBasis(host, cx) {
    const loc = locOf(cx);
    const key = () => keyOf(BASIS, locOf(cx), scenOf(cx));
    const table = () => {
      const res = RES.get(key());
      if (!res || !res.ok) return { cols: BCOLS.map(l => ({ l })), rows: [], why: res ? (res.why || 'Not held here.') : 'Not read yet — load the basis data on the chart view.' };
      return { cols: BCOLS.map(l => ({ l })), rows: basisRows(basisModel(res)) };
    };
    const draw = body => {
      if (loc.kind === 'hub') {
        const w = stateBox(body, 'scope');
        w.appendChild(cx.emptyBox('The hub has no basis against itself', 'Pick a bus or a load zone: basis is node − hub on the same hour.'));
        return;
      }
      const sid = scenOf(cx), k = keyOf(BASIS, loc, sid);
      const render = res => {
        if (!res.ok) { failed(body, cx, res, 'Basis by year', () => { RES.delete(k); C.api.reset(); load(BASIS, loc, sid, true); cx.paint(); }); return; }
        const bm = basisModel(res);
        const w = stateBox(body, bm.o.all.length ? 'ok' : 'empty');
        if (!bm.o.all.length) { w.appendChild(cx.emptyBox('No basis period held here', `The server holds no basis period at ${loc.word}.`)); return; }
        drawBasis(w, bm);
        const n = el('div', 'drv-note'); n.setAttribute('data-drv-basis-line', 'true');
        n.textContent = `Read: ${res.body.basis || ''}. Basis = Δ congestion + Δ loss on the same hour (one energy price per hour).`;
        n.classList.add('gsc-method'); n.hidden = !(pEl && pEl.querySelector('[data-gsc-info][aria-expanded="true"]'));
        w.appendChild(n);
      };
      if (cached(k)) { render(cached(k)); return; }
      if (!allowed()) { idle(body, cx, 'The basis fan'); return; }
      loading(body, cx, 'Basis by year');
      load(BASIS, loc, sid).then(res => { if (body.isConnected) render(res); });
    };
    const pEl = cx.panel({
      id: 'drv-basis', title: 'Basis fan · node − hub', csv: true, table, draw,
      sig: cx.sig ? cx.sig('basis', 'annual settled 2021–26 + solved runs', 'DA/RT + model') : null,
      faceText: `ISO-NE | ${loc.word} | basis node − hub | $/MWh | settled DA and RT, then solved runs | p5 p25 p50 p75 p95 of the hours`,
      note: 'Node − hub on the same hour, $/MWh: + the node prices above the hub. Each period is the distribution of its hours — the light band p5 to p95, ' +
        'the dark band p25 to p75, a tick at the median — with the annual mean as a point joined along its series. Settled solid, solved runs dashed; one sign both sides.',
    });
    host.appendChild(pEl);
  }

  /* ── 3 · PPA settlement (Offtake, W5.2) — S-nav 2026-10-07 ─────────────────────────────────────────────────────
     What a hub-settled solar PPA leaves the generator, per MW-yr, by period: the server's ppa_basis_usd_mw_yr
     (0.15 capacity factor × hours × the solar-weighted node − hub basis), settled at the toolbar's market and every
     solved run; × the project's MW for the $/yr column. Read from the same /continuum/basis answer as the fan. */
  const PCOLS = ['Period', 'Year', 'Source', 'Solar-weighted basis ($/MWh)', 'PPA basis ($/MW-yr)', 'Project MW', 'PPA basis ($/yr)', 'Hours with shape', 'Scenario', 'Flag'];
  function projectMw() {
    try { const o = root.App && root.App.option && root.App.option(); const v = o && +o.sizeMW; return Number.isFinite(v) && v > 0 ? v : null; } catch (e) { return null; }
  }
  function ppaModel(res, mk) {
    const o = order(res.body.periods || []);
    const set = o.set.filter(p => p.market === mk);
    const all = set.concat(o.run).filter(p => p.ppa_basis_usd_mw_yr != null);
    return { body: res.body, all, nSet: all.filter(p => p.kind === 'settled').length };
  }
  function ppaRows(pm, mw) {
    return pm.all.map(p => {
      const s = scenMark(pm.body, p);
      return [p.period, p.year, sourceWord(p), p.solar_wtd_basis, p.ppa_basis_usd_mw_yr, mw, mw == null ? null : Math.round(p.ppa_basis_usd_mw_yr * mw),
        p.hours_with_shape, s.word, [p.cape && p.cape.flagged ? (p.cape.word || p.cape.badge) : '', p.partial ? 'part year' : ''].filter(Boolean).join('; ')];
    });
  }
  const money0 = v => v == null || !Number.isFinite(+v) ? '—' : (+v < 0 ? MINUS : '') + '$' + Math.round(Math.abs(+v)).toLocaleString('en-US');
  function drawPpa(host, pm) {
    const W = Math.max(320, Math.floor(host.clientWidth || 600));
    const P = { l: 64, r: 10, t: 30, b: 34 }, Hp = 190, H = P.t + Hp + P.b;
    const n = pm.all.length;
    const out = CLIP ? outliers(pm.all.map(p => Math.abs(p.ppa_basis_usd_mw_yr))) : new Set();
    let lo = 0, hi = 0;
    pm.all.forEach((p, i) => { if (out.has(i)) return; lo = Math.min(lo, p.ppa_basis_usd_mw_yr); hi = Math.max(hi, p.ppa_basis_usd_mw_yr); });
    const ax = niceAxis(lo, hi * (out.size ? 1.1 : 1), 4);
    const sy = v => P.t + (ax.hi - Math.max(ax.lo, Math.min(ax.hi, v))) / ((ax.hi - ax.lo) || 1) * Hp;
    const bw = (W - P.l - P.r) / Math.max(1, n), barW = Math.max(8, Math.min(34, bw * 0.55));
    const svg = sv('svg', { class: 'gsc-svg drv-svg', viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': 'Hub-settled solar PPA basis by period, $ per MW-year' });
    svg.setAttribute('data-gsc-chart', 'ppa');
    ax.ticks.forEach(v => {
      const y = sy(v);
      svg.appendChild(sv('line', { class: 'gsc-grid drv-grid', x1: P.l, x2: W - P.r, y1: y, y2: y }));
      svg.appendChild(sv('text', { class: 'drv-ax', x: P.l - 6, y: y + 3, 'text-anchor': 'end' }, money0(v)));
    });
    svg.appendChild(sv('text', { class: 'drv-lab', x: 2, y: 12 }, '$/MW-yr · + the generator gains (node above hub)'));
    svg.appendChild(sv('line', { class: 'drv-zero', x1: P.l, x2: W - P.r, y1: sy(0), y2: sy(0) }));
    if (pm.nSet > 0 && pm.nSet < n) { const x = P.l + pm.nSet * bw; svg.appendChild(sv('line', { class: 'drv-div', x1: x, x2: x, y1: P.t - 8, y2: H - 4 })); }
    const readout = el('div', 'drv-readout'); readout.setAttribute('data-ppa-readout', 'true');
    readout.textContent = 'Hover a bar: the period, the solar-weighted basis and the PPA basis.';
    pm.all.forEach((p, i) => {
      const x = P.l + i * bw + bw / 2, v = p.ppa_basis_usd_mw_yr, y0 = sy(Math.max(0, v)), y1 = sy(Math.min(0, v));
      const r = sv('rect', { class: `drv-pt ${p.kind === 'settled' ? 'drv-l3' : 'drv-l6'} ppa-bar${p.kind === 'settled' ? '' : ' ppa-run'}`, x: (x - barW / 2).toFixed(1), y: y0.toFixed(1),
        width: barW.toFixed(1), height: Math.max(1, y1 - y0).toFixed(1), 'data-ppa-bar': p.period, 'data-v': v, 'data-clipped': out.has(i) ? '1' : null });
      const txt = `${periodWord(p)} · solar-weighted basis ${sgn(p.solar_wtd_basis)} $/MWh · PPA basis ${money0(v)} per MW-yr${p.cape && p.cape.flagged ? ` · ⚑ ${p.cape.word || 'Cape-flagged'}` : ''}${out.has(i) ? ' · clipped (off scale)' : ''}`;
      const tt = sv('title'); tt.textContent = txt; r.appendChild(tt);
      r.addEventListener('mouseover', () => { readout.textContent = txt; });
      svg.appendChild(r);
      if (out.has(i)) svg.appendChild(sv('text', { class: 'drv-lab drv-off', x, y: P.t - 6, 'text-anchor': 'middle' }, `${money0(v)} off scale`));
      svg.appendChild(sv('text', { class: 'drv-ax', x, y: H - P.b + 14, 'text-anchor': 'middle' }, String(p.year) + (p.partial ? '*' : '')));
      svg.appendChild(sv('text', { class: 'drv-ax', x, y: H - P.b + 27, 'text-anchor': 'middle' },
        p.kind === 'settled' ? p.market : (/^pcr/i.test(p.period) ? 'PCR' : String(p.period).replace(/^(\d+)yr$/i, '$1-yr'))));
      if (p.cape && p.cape.flagged && !out.has(i)) svg.appendChild(sv('text', { class: 'drv-cape', x, y: P.t - 6, 'text-anchor': 'middle' }, '⚑ Cape'));
    });
    host.appendChild(svg);
    host.appendChild(readout);
  }
  function buildPpa(host, cx) {
    const loc = locOf(cx);
    const mk = () => (cx.ST && cx.ST.market === 'DA') ? 'DA' : 'RT';
    const key = () => keyOf(BASIS, locOf(cx), scenOf(cx));
    const table = () => {
      const res = RES.get(key());
      if (!res || !res.ok) return { cols: PCOLS.map(l => ({ l })), rows: [], why: res ? (res.why || 'Not held here.') : 'Not read yet — live data is not connected.' };
      return { cols: PCOLS.map(l => ({ l })), rows: ppaRows(ppaModel(res, mk()), projectMw()) };
    };
    let pEl = null;
    const draw = body => {
      if (loc.kind === 'hub') {
        const w = stateBox(body, 'scope');
        w.appendChild(cx.emptyBox('A hub-settled PPA has no basis at the hub', 'Pick a bus or a load zone: the settlement is node − hub on the same hour.'));
        return;
      }
      const sid = scenOf(cx), k = keyOf(BASIS, loc, sid);
      const render = res => {
        if (!res.ok) { failed(body, cx, res, 'PPA settlement', () => { RES.delete(k); C.api.reset(); load(BASIS, loc, sid, true); cx.paint(); }); return; }
        const pm = ppaModel(res, mk());
        const w = stateBox(body, pm.all.length ? 'ok' : 'empty');
        if (!pm.all.length) { w.appendChild(cx.emptyBox('No PPA basis held here', `The server holds no solar-weighted basis at ${loc.word}.`)); return; }
        const mw = projectMw();
        const sv0 = pm.all.filter(p => p.kind === 'settled').map(p => p.ppa_basis_usd_mw_yr), rv = pm.all.filter(p => p.kind !== 'settled').map(p => p.ppa_basis_usd_mw_yr);
        const rng = a => a.length ? `${money0(Math.min(...a))} to ${money0(Math.max(...a))}` : 'not held';
        const yr = a => mw == null || !a.length ? '' : ` (${mw} MW: ${money0(Math.min(...a) * mw)} to ${money0(Math.max(...a) * mw)} a year)`;
        const ans = el('div', 'drv-answer'); ans.setAttribute('data-ppa-answer', 'true');
        ans.textContent = `Hub-settled solar PPA basis per MW-yr · settled ${mk()} ${rng(sv0)}${yr(sv0)} · solved runs ${rng(rv)}`;
        ans.title = ans.textContent; w.appendChild(ans);
        drawPpa(w, pm);
        const n = el('div', 'drv-note gsc-method'); n.setAttribute('data-ppa-method', 'true');
        n.textContent = `${res.body.ppa_note || ''} Unit: ${((res.body.unit || {}).ppa) || '$/MW-yr'}.`;
        n.hidden = !(pEl && pEl.querySelector('[data-gsc-info][aria-expanded="true"]'));
        w.appendChild(n);
      };
      if (cached(k)) { render(cached(k)); return; }
      if (!allowed()) { idle(body, cx, 'PPA settlement'); return; }
      loading(body, cx, 'PPA settlement');
      load(BASIS, loc, sid).then(res => { if (body.isConnected) render(res); });
    };
    pEl = cx.panel({
      id: 'ppa', title: 'PPA settlement · hub-settled solar', csv: true, table, draw,
      sig: cx.sig ? cx.sig('ppa-settlement', 'annual settled + solved runs', 'hub-settled · solar shape') : null,
      faceText: `ISO-NE | ${loc.word} | hub-settled solar PPA basis | $/MW-yr | CF 0.15 x hours x solar-weighted node − hub basis`,
      note: 'A hub-settled PPA pays the generator the hub price while the plant earns its node. Per MW-yr the server takes 0.15 (solar capacity factor) × the period\'s hours × the solar-weighted node − hub basis: + the generator gains, − it pays. The $/yr column multiplies by the project\'s MW. Settled periods follow the Market switch; solved runs are the model price.',
    });
    host.appendChild(pEl);
  }

  C.register({ k: 'drivers-congestion', label: 'Congestion by constraint', screen: 'drivers', module: MOD, scenario: 'applied', replaces: ['Congestion by constraint'],
    why: 'the server scales the Base run for each year by the proxy factor; settled history and non-Base runs are drawn as held', build: buildCong });
  /* S-nav 2026-10-07: the basis has ONE home — the fan on Offtake (W5.1); Drivers links to it (Ganesh: no duplicate graphs) */
  C.register({ k: 'drivers-basis', label: 'Basis fan', screen: 'offtake', module: MOD, scenario: 'applied', replaces: ['Basis by year', 'Basis fan'],
    why: 'the server scales the Base run for each year by the proxy factor; settled history is never scaled', build: buildBasis });
  C.register({ k: 'offtake-ppa', label: 'PPA settlement', screen: 'offtake', module: MOD, scenario: 'applied', replaces: ['PPA settlement'],
    why: 'the server scales the Base run for each year by the proxy factor; settled history is never scaled', build: buildPpa });

  root.GSContinuumDrivers = { niceName, shownMatch, outliers, model, congRows, basisRows, ppaRows, ppaModel, get clip() { return CLIP; },
    /** forget every answer and failure (the gate's mode switches; a reader uses "Load again") */
    reset() { RES.clear(); PENDING.clear(); } };
})(window);
