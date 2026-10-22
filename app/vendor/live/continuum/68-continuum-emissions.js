/* VENDORED from live Studio ext/68-continuum-emissions.js (snapshot 2026-10-11, sha256 f87c30cbbba313b8).
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/continuum/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   ext: 68-continuum-emissions.js — Carbon and 24×7 match, on the Offtake screen (continuum S9 2026-10-06).

   Dossier: design/10-build-slices.md S9 · build-logs/S9-data.md (the API) · D-005 (decided 2026-10-06: EPA fuel
   CO₂ factors × hourly generation, checked against the ISO-NE annual emissions report; refuse counted, wood and
   landfill gas at zero). UI rules: build-logs/UI-SLICES-RULES.md (this file and its .css are S9's own).

   One view, registered with GSContinuum (ext/59) on the Offtake workflow screen. Every number is read from
   GET /api/v2/continuum/emissions through the S0 client; nothing is embedded, nothing is typed here.

     em-annual   average and marginal-proxy CO₂ (kg/MWh) by year, settled → solved runs on one axis, with the
                 ISO-NE report's own annual figures as check markers
     em-heat     month × hour for one chosen period, average or marginal proxy
     em-cfe      24×7 matching of a solar / wind / load-shape / flat profile against a flat 24×7 load
     em-factors  the factor table the numbers are built from (EPA Table C-1 × heat rate, biogenic at zero)
     em-check    ours vs the operator's report, 2021–2024

   Scope: the store holds generation by fuel and the marginal-fuel flag for the ISO-NE system only, so every panel
   says "ISO-NE system-wide", and a bus / zone / hub scope is answered system-wide with the server's reason.
   The marginal figure is a proxy built from the marginal-fuel flag — never called the operator's marginal rate.

   Nothing is requested until the reader asks (Load emissions) — the S0 rule: a fetch nobody asked for is a
   console error in every suite that opens Offtake without this route. A browser that has read emissions once
   reads them on open (localStorage gs.continuum.em.ok).
   ═══════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  const C = root.GSContinuum;
  if (!C || typeof C.register !== 'function') return;

  const ROUTE = '/api/v2/continuum/emissions';
  const FLAG = 'gs.continuum.em.ok';
  const PREF = 'gs.continuum.em.v1';
  const VIEW = 'emissions';
  const SCREEN = 'wf:offtake';
  const PROFILES = [{ v: 'solar', l: 'Solar' }, { v: 'wind', l: 'Wind' }, { v: 'load', l: 'Load shape' }, { v: 'flat', l: 'Flat' }];
  const MEASURES = [{ v: 'avg', l: 'Average' }, { v: 'marginal', l: 'Marginal proxy' }];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const UNIT = 'kg CO₂/MWh';
  const SYS = 'ISO-NE system-wide';

  /* ── small helpers (ext/60 keeps its own private) ─────────────────────── */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
  }
  function svgEl(tag, attrs) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(k => { if (attrs[k] != null) e.setAttribute(k, String(attrs[k])); });
    return e;
  }
  const titled = (node, text) => { const t = svgEl('title'); t.textContent = text; node.appendChild(t); return node; };
  const tok = (name, node) => { try { return getComputedStyle(node || document.body).getPropertyValue(name).trim(); } catch (e) { return ''; } };
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  /** one decimal, as text; null stays null (a value not held is never 0) */
  const d1 = v => isNum(v) ? (Math.round(v * 10) / 10).toFixed(1) : null;
  const d2 = v => isNum(v) ? v.toFixed(2) : null;
  const r1 = v => isNum(v) ? Math.round(v * 10) / 10 : null;
  const signed = v => isNum(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(Math.round(v * 10) / 10).toFixed(1)}` : '—';
  /** relative luminance of a resolved token (hex or rgb()) — picks the ink a heat cell's number wears */
  function lum(c) {
    let r, g, b, m;
    const s = String(c || '').trim();
    if ((m = /^#([0-9a-f]{6})$/i.exec(s))) { const n = parseInt(m[1], 16); r = n >> 16; g = (n >> 8) & 255; b = n & 255; }
    else if ((m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s))) { r = +m[1]; g = +m[2]; b = +m[3]; }
    else return 0.5;
    const f = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  /** ext/60's segmented control, the same markup, so the Studio's styles and tests read it */
  function seg(name, opts, current, onPick, title) {
    const g = el('div', 'gsc-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', name);
    g.setAttribute('data-gsc-seg', name.toLowerCase().replace(/\s+/g, '-'));
    opts.forEach(o => {
      const b = el('button', null, o.l); b.type = 'button';
      b.dataset.gscVal = String(o.v);
      b.setAttribute('aria-pressed', String(o.v) === String(current) ? 'true' : 'false');
      if (title) b.title = title;
      b.onclick = () => onPick(o.v);
      g.appendChild(b);
    });
    return g;
  }
  function niceAxis(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; }
    const raw = (hi - lo) / (n || 5), mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw) || 10 * mag;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step;
    const ticks = []; for (let v = a; v <= b + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return { lo: a, hi: b, ticks };
  }

  /* ── reader state: what is chosen here (stored), and what has been read (this page only) ─────────── */
  /** the route's own default period (S9-data.md: "Default 2025", the latest whole settled year) */
  const DEFAULT_YEAR = '2025';
  const S = { asked: false, year: DEFAULT_YEAR, measure: 'avg', profile: null, info: {} };
  try {
    const p = JSON.parse(root.localStorage.getItem(PREF) || 'null');
    if (p && typeof p === 'object') {
      if (typeof p.year === 'string' && /^[a-z0-9]+$/i.test(p.year)) S.year = p.year;
      if (MEASURES.some(m => m.v === p.measure)) S.measure = p.measure;
      if (PROFILES.some(x => x.v === p.profile)) S.profile = p.profile;
      if (p.info && typeof p.info === 'object') S.info = Object.assign({}, p.info);
    }
  } catch (e) { /* storage refused or unreadable — defaults stand */ }
  function savePref() {
    try { root.localStorage.setItem(PREF, JSON.stringify({ year: S.year, measure: S.measure, profile: S.profile, info: S.info })); }
    catch (e) { /* storage refused */ }
  }
  const readBefore = () => { try { return !!root.localStorage.getItem(FLAG); } catch (e) { return false; } };

  /** answers by request: key -> {state: 'loading'|'done', res, at}. A failure stays until Load emissions. */
  const RES = new Map();
  const keyOf = q => `years=${q.years}&measure=${q.measure}&profile=${q.profile}`;
  let RT = null;
  function repaintSoon() {
    if (RT) return;
    RT = setTimeout(() => {
      RT = null;
      const st = C.st, b = C.bound;
      if (!st || !b || typeof b.paint !== 'function' || !C.active()) return;
      const here = String(st.screen) === SCREEN || (st.screen === 'export' && String(st.from) === SCREEN);
      if (here) b.paint();
    }, 30);
  }
  function want(q) {
    const k = keyOf(q);
    if (RES.has(k)) return RES.get(k);
    if (!S.asked) return null;
    const ent = { state: 'loading', res: null, at: 0 };
    RES.set(k, ent);
    C.api.get(ROUTE, q).then(res => {
      ent.state = 'done'; ent.res = res; ent.at = Date.now();
      if (res && res.ok) { try { root.localStorage.setItem(FLAG, String(Date.now())); } catch (e) { /* storage refused */ } }
      repaintSoon();
    });
    return ent;
  }
  function loadNow(paint) {
    S.asked = true;
    [...RES.entries()].forEach(([k, v]) => { if (v.state === 'done' && !(v.res && v.res.ok)) RES.delete(k); });
    paint();
  }

  /* ── words ──────────────────────────────────────────────────────────────── */
  function periodWord(a) {
    if (!a) return '';
    if (a.kind === 'settled') return `${a.year}${a.partial ? ' (part)' : ''}`;
    const w = C.scen && C.scen.runWord ? C.scen.runWord(a.period) : a.period;
    return /^PROBE/.test(w) ? `${w} ${a.year}` : w;
  }
  const profileWord = v => (PROFILES.find(p => p.v === v) || { l: v }).l;
  const measureWord = v => (MEASURES.find(m => m.v === v) || { l: v }).l;
  function assetProfile(cx) {
    let a = null; try { a = cx.state() && cx.state().asset; } catch (e) { a = null; }
    const f = a && a.fuel;
    return f === 'wind' ? 'wind' : 'solar';
  }
  function scopeWord(sc) {
    if (!sc) return 'this scope';
    if (sc.kind === 'bus') {
      let n = null; try { n = root.GS && typeof root.GS.node === 'function' ? root.GS.node(sc.key) : null; } catch (e) { n = null; }
      return `bus ${n && n.name ? n.name + ' ' : ''}${sc.key}`;
    }
    if (sc.kind === 'zone') return `zone ${sc.key}`;
    return 'the hub';
  }

  /* ── charts ─────────────────────────────────────────────────────────────── */
  /** history → forecast on one axis: settled points joined, each solved run a hollow point of its own (two
   *  run families share 2035, so a line between runs would draw a trend nobody solved) */
  function annualChart(body, rows) {
    const W = Math.max(320, body.clientWidth || 640), H = 252;
    const P = { l: 46, r: 92, t: 36, b: 42 };   // S-nav 2026-10-07: the unit caption and the divider labels on two rows (no overlap at half width)
    const n = rows.length, ns = rows.filter(r => r.kind === 'settled').length;
    const slot = (W - P.l - P.r) / (n + (ns && ns < n ? 0.6 : 0));
    const pos = i => i + (i >= ns && ns ? 0.6 : 0);
    const sx = i => P.l + slot * (pos(i) + 0.5);
    const vals = [];
    rows.forEach(r => {
      [r.avg_kg_mwh, r.marginal_kg_mwh].forEach(v => { if (isNum(v)) vals.push(v); });
      if (r.iso_report) [r.iso_report.avg_kg_mwh, r.iso_report.marginal_all_tw_kg_mwh].forEach(v => { if (isNum(v)) vals.push(v); });
    });
    if (!vals.length) { body.appendChild(el('div', 'gsc-empty', 'No annual figure is held.')); return; }
    const mn = Math.min(...vals), mx = Math.max(...vals), pad = (mx - mn) * 0.06 || 10;
    const ax = niceAxis(mn - pad, mx + pad, 5);
    const sy = v => H - P.b - (v - ax.lo) / ((ax.hi - ax.lo) || 1) * (H - P.t - P.b);
    const svg = svgEl('svg', { class: 'gsc-svg', viewBox: `0 0 ${W} ${H}`, height: H, role: 'img',
      'aria-label': `CO₂ intensity by year, ${SYS}: average and marginal proxy, settled and solved runs, with the ISO-NE report's figures` });
    svg.setAttribute('data-gsc-chart', 'em-annual');
    ax.ticks.forEach(v => {
      svg.appendChild(svgEl('line', { class: 'gsc-grid', x1: P.l, x2: W - P.r + 4, y1: sy(v), y2: sy(v) }));
      const t = svgEl('text', { class: 'gsc-ax', x: P.l - 6, y: sy(v) + 3, 'text-anchor': 'end' }); t.textContent = String(Math.round(v)); svg.appendChild(t);
    });
    const yl = svgEl('text', { class: 'gsc-axl', x: 4, y: 11 }); yl.textContent = `${UNIT} · ${SYS}`; svg.appendChild(yl);
    /* the divider between the last settled year and the first solved run */
    if (ns && ns < n) {
      const x = (sx(ns - 1) + sx(ns)) / 2, last = rows[ns - 1];
      const g = svgEl('g', { 'data-em-divider': '' });
      const ln = svgEl('line', { x1: x, x2: x, y1: P.t - 4, y2: H - P.b, 'stroke-dasharray': '3 3', 'stroke-width': 1 });
      ln.style.stroke = 'var(--border-3)'; g.appendChild(ln);
      const a = svgEl('text', { class: 'gsc-axl', x: x - 5, y: P.t - 8, 'text-anchor': 'end' });
      a.textContent = `last settled ${last.year}${last.partial ? ' (part)' : ''}`; g.appendChild(a);
      const b = svgEl('text', { class: 'gsc-axl', x: x + 5, y: P.t - 8 }); b.textContent = 'forecast · solved runs →'; g.appendChild(b);
      svg.appendChild(g);
    }
    /* x labels */
    rows.forEach((r, i) => {
      const t = svgEl('text', { class: 'gsc-axl', x: sx(i), y: H - P.b + 14, 'text-anchor': 'middle' });
      if (r.kind === 'settled') t.textContent = `${r.year}${r.partial ? '*' : ''}`;
      else {
        const w = C.scen && C.scen.runWord ? C.scen.runWord(r.period) : r.period;
        t.textContent = w;
        if (/^PROBE/.test(w)) { const t2 = svgEl('text', { class: 'gsc-axl', x: sx(i), y: H - P.b + 27, 'text-anchor': 'middle' }); t2.textContent = String(r.year); svg.appendChild(t2); }
      }
      svg.appendChild(t);
    });
    const SER = [
      { k: 'avg', label: 'Average', col: 'var(--s1)', get: r => r.avg_kg_mwh, rep: r => r.iso_report && r.iso_report.avg_kg_mwh,
        repWord: 'ISO-NE report average', gap: r => r.iso_report && r.iso_report.gap_pct },
      { k: 'marginal', label: 'Marginal proxy', col: 'var(--s2)', get: r => r.marginal_kg_mwh, rep: r => r.iso_report && r.iso_report.marginal_all_tw_kg_mwh,
        repWord: 'ISO-NE report marginal, all units time-weighted', gap: r => r.iso_report && r.iso_report.marginal_gap_pct },
    ];
    const ends = [];
    SER.forEach(s => {
      const g = svgEl('g', { 'data-em-series': s.k });
      const settled = rows.map((r, i) => ({ r, i, v: s.get(r) })).filter(p => p.r.kind === 'settled' && isNum(p.v));
      if (settled.length > 1) {
        const pl = svgEl('polyline', { points: settled.map(p => `${sx(p.i)},${sy(p.v)}`).join(' '), fill: 'none', 'stroke-width': 1.8 });
        pl.style.stroke = s.col; g.appendChild(pl);
      }
      rows.forEach((r, i) => {
        const v = s.get(r);
        if (isNum(v)) {
          const run = r.kind !== 'settled';
          const c = svgEl('circle', { cx: sx(i), cy: sy(v), r: run ? 4 : 3.5, 'stroke-width': run ? 1.6 : 0,
            'data-em-pt': s.k, 'data-period': r.period, 'data-v': r1(v) });
          c.style.fill = run ? 'var(--surface)' : s.col; c.style.stroke = s.col;
          titled(c, `${periodWord(r)} · ${s.label.toLowerCase()} ${d1(v)} ${UNIT} · ${SYS}${run ? ' · solved run' : ' · settled'}`);
          g.appendChild(c);
        }
        const rv = s.rep(r);
        if (isNum(rv)) {
          const x = sx(i), y = sy(rv), k = 5;
          const d = svgEl('path', { d: `M${x} ${y - k}L${x + k} ${y}L${x} ${y + k}L${x - k} ${y}Z`, 'stroke-width': 1.5,
            'data-em-pt': 'check-' + s.k, 'data-period': r.period, 'data-v': r1(rv) });
          d.style.fill = 'var(--surface)'; d.style.stroke = s.col;
          titled(d, `${r.year} · ${s.repWord} ${d1(rv)} ${UNIT} · ours ${d1(v)} (${signed(s.gap(r))} %)`);
          g.appendChild(d);
        }
      });
      svg.appendChild(g);
      const last = rows.map(r => s.get(r)).filter(isNum).pop();
      if (isNum(last)) ends.push({ s, y: sy(last) });
    });
    /* series names at the right edge, pushed apart to a legible pitch */
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    ends.forEach(e => {
      const t = svgEl('text', { class: 'gsc-axl', x: W - P.r + 10, y: e.y + 3, 'data-em-endlabel': e.s.k });
      t.style.fill = e.s.col; t.textContent = e.s.label; svg.appendChild(t);
    });
    body.appendChild(svg);
    const lg = el('div', 'gsc-lg');
    [['dot', 'var(--s1)', 'Average (ours)'], ['dia', 'var(--s1)', 'ISO-NE report average'],
      ['dot', 'var(--s2)', 'Marginal proxy (ours)'], ['dia', 'var(--s2)', 'ISO-NE report marginal (all units, time-weighted)'],
      ['ring', 'var(--ink-3)', 'Solved run (hollow)']].forEach(([shape, col, label]) => {
      const sp = el('span'); const i = el('i', 'em-sw em-sw-' + shape); i.style.color = col; sp.appendChild(i); sp.appendChild(document.createTextNode(label)); lg.appendChild(sp);
    });
    body.appendChild(lg);
  }

  /** a 12 × 24 heat, SVG: one rect per cell carrying its value, hour beginning 0 at the top (HE 1) */
  function heatSvg(body, grid, o) {
    const W = Math.max(300, body.clientWidth || 600);
    const P = { l: 40, r: 4, t: 4, b: 16 };
    const cw = (W - P.l - P.r) / 12, ch = o.cellH || 12, H = P.t + P.b + 24 * ch;
    const vals = []; grid.forEach(row => (row || []).forEach(v => { if (isNum(v)) vals.push(v); }));
    const lo = o.range ? o.range[0] : Math.min(...vals), hi = o.range ? o.range[1] : Math.max(...vals);
    const ramp = [1, 2, 3, 4, 5, 6, 7].map(i => tok(`--gsc-heat-${i}`, body) || tok(`--h${i}`, body));
    const inkD = tok('--gsc-cell-ink-dark', body), inkL = tok('--gsc-cell-ink-light', body);
    const inks = ramp.map(c => lum(c) > 0.3 ? inkD : inkL);
    const stop = v => Math.max(0, Math.min(ramp.length - 1, Math.floor((v - lo) / ((hi - lo) || 1) * ramp.length)));
    const svg = svgEl('svg', { class: 'gsc-svg', viewBox: `0 0 ${W} ${H}`, height: H, role: 'img', 'aria-label': o.aria });
    svg.setAttribute('data-gsc-chart', o.id);
    const nums = cw >= 34 && ch >= 11;
    for (let m = 0; m < 12; m++) for (let h = 0; h < 24; h++) {
      const v = grid[m] ? grid[m][h] : null;
      const x = P.l + m * cw, y = P.t + h * ch;
      const r = svgEl('rect', { x: x, y: y, width: Math.max(1, cw - 1), height: Math.max(1, ch - 1), 'data-em-cell': `${m}:${h}`, 'data-v': isNum(v) ? r1(v) : '' });
      if (isNum(v)) { r.setAttribute('fill', ramp[stop(v)]); }
      else r.style.fill = 'var(--border)';
      titled(r, o.title(m, h, v));
      svg.appendChild(r);
      if (nums && isNum(v)) {
        const t = svgEl('text', { class: 'em-cell-t', x: x + cw / 2, y: y + ch / 2 + 3.5, 'text-anchor': 'middle', fill: inks[stop(v)] });
        t.textContent = String(Math.round(v)); svg.appendChild(t);
      }
    }
    for (let h = 0; h < 24; h += 2) {
      const t = svgEl('text', { class: 'gsc-ax', x: P.l - 5, y: P.t + h * ch + ch / 2 + 3.5, 'text-anchor': 'end' }); t.textContent = `HE ${h + 1}`; svg.appendChild(t);
    }
    MON.forEach((mm, m) => { const t = svgEl('text', { class: 'gsc-ax', x: P.l + m * cw + cw / 2, y: H - 4, 'text-anchor': 'middle' }); t.textContent = mm; svg.appendChild(t); });
    body.appendChild(svg);
    const key = el('div', 'gsc-key');
    key.appendChild(el('span', null, o.fmt(lo)));
    const rp = el('div', 'gsc-ramp'); ramp.forEach(c => { const i = el('i'); i.style.background = c; rp.appendChild(i); }); key.appendChild(rp);
    key.appendChild(el('span', null, `${o.fmt(hi)} ${o.unit}`));
    body.appendChild(key);
  }

  /** the four profiles against a flat load: one 100 % bar each — matched · grid carbon-free · the rest */
  function cfeBars(body, list, sel) {
    const W = Math.max(300, body.clientWidth || 600), rowH = 20, gap = 7;
    const P = { l: 84, r: 104, t: 2, b: 2 }, bw = W - P.l - P.r;
    const H = P.t + P.b + list.length * (rowH + gap) - gap;
    const svg = svgEl('svg', { class: 'gsc-svg', viewBox: `0 0 ${W} ${H}`, height: H, role: 'img',
      'aria-label': `24×7 carbon-free match of four supply profiles against a flat load, ${SYS}` });
    svg.setAttribute('data-gsc-chart', 'em-cfe');
    list.forEach((it, i) => {
      const y = P.t + i * (rowH + gap);
      const g = svgEl('g', { 'data-em-bar': it.v });
      const lab = svgEl('text', { class: 'gsc-axl em-bar-l' + (it.v === sel ? ' on' : ''), x: P.l - 8, y: y + rowH / 2 + 3.5, 'text-anchor': 'end' });
      lab.textContent = it.l; g.appendChild(lab);
      const c = it.data;
      if (c && isNum(c.matched_pct) && isNum(c.cfe_pct)) {
        g.setAttribute('data-matched', String(r1(c.matched_pct)));
        g.setAttribute('data-cfe', String(r1(c.cfe_pct)));
        const m = Math.max(0, Math.min(100, c.matched_pct)), f = Math.max(m, Math.min(100, c.cfe_pct));
        [[0, m, 'var(--s3)', `hourly matched ${d1(c.matched_pct)} %`],
          [m, f, 'var(--s6)', `grid carbon-free in unmatched hours ${d1(f - m)} %`],
          [f, 100, 'var(--border-3)', `not carbon-free ${d1(100 - f)} %`]].forEach(([a, b, col, word]) => {
          if (b - a <= 0) return;
          const r = svgEl('rect', { x: P.l + a / 100 * bw, y, width: Math.max(0.8, (b - a) / 100 * bw), height: rowH });
          r.style.fill = col;
          titled(r, `${it.l} · ${word}`); g.appendChild(r);
        });
        if (it.v === sel) { const o = svgEl('rect', { x: P.l - 0.5, y: y - 0.5, width: bw + 1, height: rowH + 1, fill: 'none', 'stroke-width': 1.2 }); o.style.stroke = 'var(--ink-2)'; g.appendChild(o); }
        const t = svgEl('text', { class: 'gsc-ax', x: W - P.r + 6, y: y + rowH / 2 + 3.5 });
        t.textContent = `${d1(c.matched_pct)} % · ${d1(c.cfe_pct)} %`; g.appendChild(t);
      } else {
        const t = svgEl('text', { class: 'gsc-axl', x: P.l, y: y + rowH / 2 + 3.5 });
        t.textContent = it.why || 'reading…'; g.appendChild(t);
      }
      svg.appendChild(g);
    });
    const lg = el('div', 'gsc-lg');
    [['var(--s3)', 'Hourly matched'], ['var(--s6)', 'Grid carbon-free in unmatched hours'], ['var(--border-3)', 'Not carbon-free']].forEach(([col, label]) => {
      const sp = el('span'); const i = el('i'); i.style.background = col; sp.appendChild(i); sp.appendChild(document.createTextNode(label)); lg.appendChild(sp);
    });
    lg.appendChild(el('span', 'em-lg-note', 'right: matched % · incl. grid %'));
    body.appendChild(lg);
    body.appendChild(svg);
  }

  /* ── the view ───────────────────────────────────────────────────────────── */
  function build(host, cx) {
    /* S-nav 2026-10-07: one live connection for the whole Continuum (GSContinuum.live) — no "Load emissions" gate */
    if (!S.asked && (readBefore() || (C.live && C.live.allowed()))) S.asked = true;
    const P = S.profile || assetProfile(cx);
    const MAIN = want({ years: S.year, measure: S.measure, profile: P });
    const CMP = PROFILES.map(p => ({ p: p.v, ent: want({ years: S.year, measure: 'avg', profile: p.v }) }));
    const mainOk = !!(MAIN && MAIN.state === 'done' && MAIN.res && MAIN.res.ok && MAIN.res.body);
    /* a stored period the server no longer serves (400, field years): back to the default once, then read again */
    if (MAIN && MAIN.state === 'done' && MAIN.res && MAIN.res.state === 'bad-request' && MAIN.res.field === 'years' && S.year !== DEFAULT_YEAR) {
      S.year = DEFAULT_YEAR; savePref(); repaintSoon();
    }
    let state = 'idle';
    if (S.asked) {
      if (!MAIN || MAIN.state === 'loading') state = 'loading';
      else if (mainOk) state = CMP.some(c => c.ent && c.ent.state === 'loading') ? 'loading' : 'ok';
      else state = MAIN.res.state === 'server-error' && MAIN.res.status === 500 ? 'error-500' : MAIN.res.state;
    }
    const base = C.api.base().replace(/^https?:\/\//, '');
    const status = el('div', 'gsc-note gsc-wide em-status');
    status.setAttribute('data-em-state', state);
    /* S-nav 2026-10-07 (SKL-091): no route or host in reader text — the state in words */
    status.textContent = `Emissions · ${SYS} · ` + (state === 'idle' ? 'live data not connected'
      : state === 'loading' ? 'reading…' : mainOk ? `read ${new Date(MAIN.at).toTimeString().slice(0, 5)}` : (MAIN.res.why || state));
    status.hidden = mainOk;
    host.appendChild(status);

    if (!mainOk) { host.appendChild(loadPanel(cx, state, MAIN, base)); return; }

    const B = MAIN.res.body;
    const annual = Array.isArray(B.annual) ? B.annual : [];
    const rowOf = p => annual.find(a => String(a.period) === String(p)) || null;
    const yr = rowOf(S.year);
    const yrWord = yr ? periodWord(yr) : S.year;
    const fac = Array.isArray(B.factors) ? B.factors : [];
    const vin = B.vintage || {};
    const meth = B.method || {};
    const chk = B.check || { years: [] };
    const repSrc = (annual.find(a => a.iso_report && a.iso_report.source) || {}).iso_report;
    const repTitle = repSrc ? String(repSrc.source).split(' (')[0] : 'ISO New England Electric Generator Air Emissions Report';
    const tables = (/\(([^)]*)\)/.exec(String(chk.against || '')) || [])[1] || '';
    const epaVintage = String((fac[0] && fac[0].vintage) || 'vintage not stated').split(';')[0];
    const basisText = `Basis: EPA 40 CFR 98 Table C-1 kg CO₂/MMBtu (${epaVintage}) × heat rate · ` +
      `checked against the ISO-NE report: ${repTitle}${tables ? ', ' + tables : ''} · ` +
      `marts built ${String(vin.marts_built_at || '—').replace('T', ' ')} · factors ${vin.factors_sha || '—'} · report extract ${vin.report_sha || '—'} · store ${String(vin.store_mtime || '—').replace('T', ' ')}` +
      (vin.stale ? ` · STALE: ${vin.stale_reason || 'an input changed since the marts were built'}` : '');
    /* The 5-year run's offshore-wind input case (ext/05's flag) — stated system-wide here. ext/60 appends its bus
       congestion sentence to any panel whose text names the 5-year run; these panels are system-wide, so they carry
       their own [data-gsc-input] (ext/60 then adds nothing), visible where the 5-year run is drawn. */
    const capeWord = (() => { try { const m = root.GS_DATA_EXT.run_input_flags.meta.cape_5yr; return m && m.note ? String(m.note) : ''; } catch (e) { return ''; } })();
    const r5 = rowOf('5yr');
    const inputNote = shown => {
      if (!shown || !capeWord || !r5) { const s = el('span'); s.hidden = true; s.setAttribute('data-gsc-input', 'n/a'); return s; }
      const n = el('div', 'gsc-note em-input');
      n.setAttribute('data-gsc-input', '5yr');
      n.textContent = `${capeWord}. ${periodWord(r5)} here is ${SYS}: carbon-free share ${d1(r5.carbon_free_share_pct)} %, average ${d1(r5.avg_kg_mwh)} ${UNIT}, with that input in its fleet.`;
      n.title = n.textContent;   // S-nav 2026-10-07: one line on the card, the whole sentence on hover
      return n;
    };

    const infoBtn = id => {
      const b = el('button', 'gsc-btn em-i', 'i'); b.type = 'button';
      b.setAttribute('data-em-info', id); b.setAttribute('aria-label', 'Show method'); b.title = 'Show method';
      b.setAttribute('aria-pressed', S.info[id] ? 'true' : 'false');
      b.onclick = () => { S.info[id] = !S.info[id]; savePref(); cx.paint(); };
      return b;
    };
    /** the lines every panel carries under its body: answer, notes, the method behind (i), the basis */
    const finish = (p, id, parts) => {
      p.setAttribute('data-em-panel', id);
      (parts.answer ? [parts.answer] : []).forEach(t => { const a = el('div', 'em-answer', t); a.setAttribute('data-em-answer', id.replace(/^em-/, '')); p.appendChild(a); });
      (parts.notes || []).forEach(n => p.appendChild(n));
      if (S.info[id]) { const m = el('div', 'em-method'); m.setAttribute('data-em-method', id); (Array.isArray(parts.method) ? parts.method : [parts.method]).forEach(t => m.appendChild(el('p', null, t))); p.appendChild(m); }
      /* S-nav 2026-10-07 (SKL-091): the basis line carries vintages and file hashes — it sits behind (i) with the method */
      const bl = el('div', 'gsc-note em-basis', basisText); bl.setAttribute('data-em-basis', ''); bl.hidden = !S.info[id]; p.appendChild(bl);
      host.appendChild(p);
    };

    /* 1 · by year */
    {
      const settled = annual.filter(a => a.kind === 'settled'), runs = annual.filter(a => a.kind !== 'settled');
      const lastS = settled[settled.length - 1];
      const checked = annual.filter(a => a.iso_report);
      const latest = checked[checked.length - 1];
      const noMarg = runs.filter(a => !isNum(a.marginal_kg_mwh));
      const cols = ['Period', 'Kind', 'Year', `Average (${UNIT})`, `Marginal proxy (${UNIT})`, `Marginal proxy · emitting fuels (${UNIT})`,
        `Run unit emissions (${UNIT})`, 'Carbon-free share (%)', `ISO-NE report average (${UNIT})`, 'Gap vs report (%)', 'Mass gap vs report (%)',
        `ISO-NE report marginal · all units (${UNIT})`, 'Marginal proxy gap (%)', 'Hours', 'Note'].map(l => ({ l }));
      const rows = annual.map(a => {
        const ir = a.iso_report || null;
        const note = [a.partial && a.last ? `part year to ${String(a.last).slice(0, 10)}` : '',
          !isNum(a.marginal_kg_mwh) && a.marginal_reason ? 'marginal proxy ' + String(a.marginal_reason).split(' (')[0] : ''].filter(Boolean).join('; ');
        return [a.period, a.kind, a.year, d1(a.avg_kg_mwh), d1(a.marginal_kg_mwh), d1(a.marginal_emitting_kg_mwh), d1(a.avg_unit_kg_mwh),
          d1(a.carbon_free_share_pct), ir ? d1(ir.avg_kg_mwh) : null, ir ? d1(ir.gap_pct) : null, ir ? d1(ir.mass_gap_pct) : null,
          ir ? d1(ir.marginal_all_tw_kg_mwh) : null, ir ? d1(ir.marginal_gap_pct) : null, a.hours, note || null];
      });
      let ans = yr ? `${yrWord}: average ${d1(yr.avg_kg_mwh) || 'not held'} · marginal proxy ${d1(yr.marginal_kg_mwh) || 'not held'} ${UNIT} (${SYS}).` : `${S.year} is not in the annual series.`;
      if (latest) ans += ` Latest operator check, ${latest.year}: ours ${d1(latest.avg_kg_mwh)} vs ISO-NE report ${d1(latest.iso_report.avg_kg_mwh)} (${signed(latest.iso_report.gap_pct)} %).`;
      if (noMarg.length) ans += ` Marginal proxy not held for ${noMarg.map(periodWord).join(', ')}: the PCR unit table carries no dispatch state.`;
      const notes = [];
      const sc = cx.scope();
      if (sc && (sc.kind === 'bus' || sc.kind === 'zone' || sc.kind === 'hub')) {
        const nh = (B.not_held || []).find(x => /^zonal/i.test(String(x.measure || '')));
        const n = el('div', 'gsc-note em-scope');
        n.setAttribute('data-em-scope-note', sc.kind);
        n.textContent = `Scope ${scopeWord(sc)}: emissions are shown ${SYS} — ${(nh && nh.reason) || 'the store holds generation by fuel and the marginal-fuel flag for the ISO-NE system only'}.`;
        notes.push(n);
      }
      notes.push(inputNote(true));
      const p = cx.panel({
        id: 'em-annual', title: 'CO₂ intensity by year', sig: cx.sig ? cx.sig('co2-intensity', 'annual settled + solved', 'system-wide') : null,
        face: cx.faceLine([['scope', SYS], ['unit', UNIT],
          ['settled', `${settled.length ? settled[0].year : '—'}–${lastS ? lastS.year : '—'}${lastS && lastS.partial ? ` (${lastS.year} to ${String(lastS.last).slice(0, 10)})` : ''}`],
          ['solved runs', runs.map(periodWord).join(' · ')], ['check', `ISO-NE report ${checked.map(a => a.year).join(', ')}`]]),
        faceText: `${SYS} | ${UNIT} | average and marginal proxy by year | settled + solved runs | check: ISO-NE report ${checked.map(a => a.year).join(' ')}`,
        controls: [infoBtn('em-annual')], csv: true,
        table: () => ({ cols, rows }),
        draw: body => annualChart(body, annual),
      });
      finish(p, 'em-annual', { answer: ans, notes, method: [meth.avg || '', meth.marginal || '', `Sources: ${B.basis || ''}.`] });
    }

    /* 2 · month × hour */
    {
      const hp = ((B.heat || {}).periods || {})[S.year] || null;
      const grid = hp && Array.isArray(hp.values) ? hp.values : null;
      const ns = hp && Array.isArray(hp.n) ? hp.n : null;
      const mw = measureWord(S.measure);
      const sel = el('select', 'gsc-yr'); sel.setAttribute('data-em-year', ''); sel.setAttribute('aria-label', 'Year');
      sel.title = 'Year · the period the month × hour and the 24×7 match read';
      annual.forEach(a => { const o = el('option', null, periodWord(a)); o.value = a.period; if (String(a.period) === S.year) o.selected = true; sel.appendChild(o); });
      sel.onchange = () => { S.year = sel.value; savePref(); cx.paint(); };
      const cells = [];
      if (grid) for (let m = 0; m < 12; m++) for (let h = 0; h < 24; h++) cells.push({ m, h, v: grid[m] ? grid[m][h] : null, n: ns && ns[m] ? ns[m][h] : null });
      const held = cells.filter(c => isNum(c.v));
      const hiC = held.reduce((a, c) => (!a || c.v > a.v ? c : a), null), loC = held.reduce((a, c) => (!a || c.v < a.v ? c : a), null);
      const mean = held.length ? held.reduce((s, c) => s + c.v, 0) / held.length : null;
      const reason = hp && hp.reason ? hp.reason : `${yrWord}: no month × hour block is held for this measure`;
      const p = cx.panel({
        id: 'em-heat', title: 'CO₂ by month and hour', sig: cx.sig ? cx.sig('co2-intensity', `month×hour ${S.year}`, S.measure) : null,
        face: cx.faceLine([['scope', SYS], ['year', yrWord],
          ['measure', S.measure === 'marginal' ? 'marginal proxy (from the marginal-fuel flag; not the operator\'s marginal rate)' : 'average of generation'],
          ['unit', UNIT], ['clock', yr && yr.kind !== 'settled' ? 'run calendar, standard time, hour beginning' : 'local prevailing time, hour beginning']]),
        faceText: `${SYS} | ${yrWord} | ${mw} | ${UNIT} | month x hour`,
        controls: [sel, seg('Measure', MEASURES, S.measure, v => { S.measure = v; savePref(); cx.paint(); }, 'Measure · average intensity or the marginal proxy'), infoBtn('em-heat')],
        csv: !!grid,
        table: () => ({ cols: [{ l: 'Month' }, { l: 'HE' }, { l: `${mw} (${UNIT})` }, { l: 'Hours' }],
          rows: cells.map(c => [MON[c.m], c.h + 1, d1(c.v), c.n]), why: reason }),
        draw: body => {
          if (!grid) { body.appendChild(cx.emptyBox(`${mw} not held for ${yrWord}`, reason.replace(/^not held: /, 'Not held: ') + '.')); return; }
          heatSvg(body, grid, { id: 'em-heat', cellH: 12, unit: UNIT, fmt: v => String(Math.round(v)),
            aria: `${mw} CO₂ intensity by month and hour, ${yrWord}, ${SYS}`,
            title: (m, h, v) => `${MON[m]} · HE ${h + 1} · ${isNum(v) ? d1(v) + ' ' + UNIT : 'no value'}${ns && ns[m] && isNum(ns[m][h]) ? ' · ' + ns[m][h] + ' hours' : ''} · ${mw.toLowerCase()}` });
        },
      });
      finish(p, 'em-heat', {
        answer: grid && hiC ? `${yrWord}, ${mw.toLowerCase()}: highest ${MON[hiC.m]} HE ${hiC.h + 1} ${d1(hiC.v)} · lowest ${MON[loC.m]} HE ${loC.h + 1} ${d1(loC.v)} · mean of cells ${d1(mean)} ${UNIT} (${SYS}).`
          : `${yrWord}, ${mw.toLowerCase()}: not held — ${reason.replace(/^not held: /, '')}.`,
        notes: [inputNote(S.year === '5yr')],
        method: [(S.measure === 'marginal' ? meth.marginal : meth.avg) || '',
          `Clock — settled: ${(B.hour_convention || {}).settled || '—'} Runs: ${(B.hour_convention || {}).runs || '—'}`],
      });
    }

    /* 3 · 24×7 match */
    {
      const cfeOf = ent => (ent && ent.state === 'done' && ent.res && ent.res.ok && ent.res.body && ent.res.body.cfe && ent.res.body.cfe.periods)
        ? ent.res.body.cfe.periods[S.year] || null : null;
      const list = PROFILES.map(pr => {
        const c = CMP.find(x => x.p === pr.v);
        let data = cfeOf(c && c.ent);
        if (!data && pr.v === P) data = cfeOf(MAIN);
        const why = data ? null : !c || !c.ent || c.ent.state === 'loading' ? 'reading…' : (c.ent.res && c.ent.res.why) || 'not served';
        return { v: pr.v, l: pr.l, data, why };
      });
      const cur = list.find(x => x.v === P), cd = cur && cur.data;
      let asset = null; try { asset = cx.state() && cx.state().asset; } catch (e) { asset = null; }
      const assetLine = asset && P === assetProfile(cx) && !S.profile ? ` (follows the ${asset.label || asset.fuel} asset)` : '';
      const kpi = (k, label, v, sub) => {
        const d = el('div', 'gsc-kpi'); d.setAttribute('data-em-kpi', k);
        d.appendChild(el('div', 'k', label)); d.appendChild(el('div', 'v', v)); d.appendChild(el('div', 's', sub)); return d;
      };
      const pw = profileWord(P);
      const p = cx.panel({
        id: 'em-cfe', wide: true, title: '24×7 carbon-free match', sig: cx.sig ? cx.sig('cfe-match', `${S.year} · four profiles`, 'system-wide') : null,
        face: cx.faceLine([['scope', SYS], ['load', 'flat 24×7, 1 MW'], ['profile', pw + assetLine],
          ['energy', '100 % of annual load'], ['year', yrWord]]),
        faceText: `${SYS} | flat 24x7 load | profiles solar wind load-shape flat | ${yrWord} | selected ${pw}`,
        controls: [seg('Profile', PROFILES, P, v => { S.profile = v; savePref(); cx.paint(); }, 'Profile · the supply shape matched against a flat 24×7 load'), infoBtn('em-cfe')],
        csv: true,
        table: () => ({ cols: [{ l: 'Profile' }, { l: 'Hourly matched (%)' }, { l: 'Carbon-free incl. grid (%)' }, { l: 'Grid carbon-free share (%)' },
          { l: 'Excess energy (%)' }, { l: 'Residual (kg CO₂/MWh-load)' }, { l: 'Hours' }],
          rows: list.map(x => [x.l, x.data ? d1(x.data.matched_pct) : null, x.data ? d1(x.data.cfe_pct) : null, x.data ? d1(x.data.grid_cfe_pct) : null,
            x.data ? d1(x.data.excess_pct) : null, x.data ? d1(x.data.residual_kg_per_mwh_load) : null, x.data ? x.data.hours : null]) }),
        draw: body => {
          if (!cd) { body.appendChild(cx.emptyBox(`${pw} match not held for ${yrWord}`, cur && cur.why ? cur.why : 'The server returned no 24×7 block for this period.')); return; }
          const ks = el('div', 'gsc-kpis');
          ks.appendChild(kpi('matched', 'Hourly matched', `${d1(cd.matched_pct)} %`, `${pw} vs flat load`));
          ks.appendChild(kpi('cfe', 'Carbon-free incl. grid', `${d1(cd.cfe_pct)} %`, 'matched + grid carbon-free'));
          ks.appendChild(kpi('grid', 'Grid carbon-free', `${d1(cd.grid_cfe_pct)} %`, 'share of generation'));
          ks.appendChild(kpi('excess', 'Excess energy', `${d1(cd.excess_pct)} %`, 'of load, not carried over'));
          ks.appendChild(kpi('residual', 'Residual', d1(cd.residual_kg_per_mwh_load), 'kg CO₂ per MWh of load'));
          body.appendChild(ks);
          const bars = el('div', 'em-block'); body.appendChild(bars); cfeBars(bars, list, P);
          const hm = cd.heat && Array.isArray(cd.heat.matched_pct) ? cd.heat.matched_pct : null;
          if (hm) {
            body.appendChild(el('div', 'em-sub', `Hourly matched by month and hour (%) · ${pw} · ${yrWord}`));
            heatSvg(body, hm, { id: 'em-cfe-heat', cellH: 8, range: [0, 100], unit: '%', fmt: v => String(Math.round(v)),
              aria: `Hourly matched percent by month and hour, ${pw}, ${yrWord}, ${SYS}`,
              title: (m, h, v) => `${MON[m]} · HE ${h + 1} · matched ${isNum(v) ? d1(v) + ' %' : 'no value'} · ${pw}` });
          }
        },
      });
      finish(p, 'em-cfe', {
        answer: cd ? `${pw} serving a flat 24×7 load, ${yrWord}: ${d1(cd.matched_pct)} % hourly matched, ${d1(cd.cfe_pct)} % carbon-free incl. grid (grid ${d1(cd.grid_cfe_pct)} % carbon-free on average); residual ${d1(cd.residual_kg_per_mwh_load)} kg CO₂ per MWh of load (${SYS}).`
          : `${pw}, ${yrWord}: ${cur && cur.why ? cur.why : 'not held'}.`,
        notes: [inputNote(S.year === '5yr')],
        method: [
          `How to read this. The load is flat: 1 MW in every hour of the year. The ${pw.toLowerCase()} profile is scaled so that over the year it produces exactly as much energy as the load uses. ` +
          `In each hour it covers the load up to 1 MW — that share, averaged over every hour, is the hourly matched figure (${cd ? d1(cd.matched_pct) : '—'} % for ${pw.toLowerCase()}, ${yrWord}). ` +
          'A surplus in one hour cannot be carried to another, so 100 % of annual energy does not mean 100 % matched. ' +
          'In the hours it falls short, the rest comes from the grid, which was carbon-free in proportion to its own mix that hour (nuclear, hydro, wind and solar); adding that gives carbon-free incl. grid. ' +
          'Wood, landfill gas, refuse and batteries are not counted carbon-free. Settled profiles are ISO-NE system metered output; a run\'s profile is that run\'s own fleet dispatch.',
          `Formula: ${meth.cfe || '—'}`,
        ],
      });
    }

    /* 4 · factors */
    {
      const treat = f => f.carbon_free ? 'carbon-free' : f.biogenic ? 'biogenic — counted at zero'
        : f.fuel_type === 'Batteries' ? 'excluded from generation' : 'counted at the stack';
      const sorted = fac.slice().sort((a, b) => ((b.kg_co2_per_mwh || 0) - (a.kg_co2_per_mwh || 0)) || String(a.fuel_type).localeCompare(String(b.fuel_type)));
      const rows = sorted.map(f => [f.fuel_type, d1(f.kg_co2_per_mmbtu), d2(f.heat_rate_mmbtu_per_mwh), d1(f.kg_co2_per_mwh_stack), d1(f.kg_co2_per_mwh), treat(f)]);
      const hr = [...new Set(fac.map(f => f.heat_rate_source).filter(Boolean))];
      const p = cx.panel({
        id: 'em-factors', title: 'Emission factors', tableOnly: true, csv: true,
        face: cx.faceLine([['scope', SYS], ['source', 'EPA 40 CFR 98 Table C-1 × heat rate'], ['accounting', 'refuse counted · wood and landfill gas at zero (biogenic)']]),
        faceText: `${SYS} | EPA 40 CFR 98 Table C-1 x heat rate | refuse counted; wood and landfill gas at zero`,
        controls: [infoBtn('em-factors')],
        table: () => ({ cols: [{ l: 'Fuel' }, { l: 'kg CO₂/MMBtu' }, { l: 'Heat rate (MMBtu/MWh)' }, { l: `At the stack (${UNIT})` }, { l: `Applied (${UNIT})` }, { l: 'Treatment' }],
          rows, why: 'The server returned no factor table.' }),
        draw: () => {},
      });
      finish(p, 'em-factors', { method: [`Coefficients: ${[...new Set(fac.map(f => String(f.coefficient_source || '').split(':')[0]).filter(Boolean))].join('; ')}.`,
        `Heat rates: ${hr.join(' · ')}.`, `Vintage: ${(fac[0] && fac[0].vintage) || '—'}.`] });
    }

    /* 5 · check */
    {
      const yrs = Array.isArray(chk.years) ? chk.years : [];
      const rows = yrs.map(y => {
        const a = annual.find(x => x.kind === 'settled' && +x.year === +y.year) || {};
        return [String(y.year), d1(a.avg_kg_mwh), d1(y.avg_kg_mwh), d1(y.gap_pct), d1(y.mass_gap_pct), d1(a.marginal_kg_mwh), d1(y.marginal_all_tw_kg_mwh),
          d1(y.marginal_gap_pct), d1(a.marginal_emitting_kg_mwh), d1(y.marginal_emitting_tw_kg_mwh), d1(y.marginal_emitting_gap_pct)];
      });
      const p = cx.panel({
        id: 'em-check', title: 'Check vs ISO-NE report', tableOnly: true, csv: true,
        face: cx.faceLine([['scope', SYS], ['against', chk.against || '—'], ['years', yrs.length ? `${yrs[0].year}–${yrs[yrs.length - 1].year}` : 'none']]),
        faceText: `${SYS} | ours vs ${chk.against || 'the ISO-NE report'}`,
        controls: [infoBtn('em-check')],
        table: () => ({ cols: [{ l: 'Year' }, { l: `Ours average (${UNIT})` }, { l: `ISO-NE report average (${UNIT})` }, { l: 'Gap (%)' }, { l: 'Mass gap (%)' },
          { l: `Ours marginal proxy (${UNIT})` }, { l: `ISO-NE report marginal · all units (${UNIT})` }, { l: 'Marginal proxy gap (%)' },
          { l: `Ours marginal proxy · emitting fuels (${UNIT})` }, { l: `ISO-NE report marginal · emitting units (${UNIT})` }, { l: 'Emitting gap (%)' }],
          rows, why: 'The server returned no operator check.' }),
        draw: () => {},
      });
      finish(p, 'em-check', { method: ['Ours = EPA factors × the store\'s hourly generation by fuel; the report = the operator\'s own annual figures. A gap is ours ÷ report − 1. ' +
        'The store\'s fuel-mix generation is 3–4 % below the report\'s, so the rate gap runs above the mass gap. ' +
        'The marginal proxy weighs each flagged fuel equally and never sees imports; the operator weighs each marginal unit and counts imports.',
      `Report source: ${repSrc ? repSrc.source : '—'}`] });
    }
  }

  /** idle, reading, or not served: one panel, written, with the one action that changes it */
  function loadPanel(cx, state, MAIN, base) {
    /* S-nav 2026-10-07: the first read comes from "Connect live data"; after a failure this button asks again */
    const btn = el('button', 'gsc-btn pri', 'Load again'); btn.type = 'button';   // the same label and action as Drivers' retry
    btn.setAttribute('data-em-load', '');
    btn.title = 'Ask the live server for the emissions again';
    if (state === 'loading') btn.disabled = true;
    btn.onclick = () => loadNow(cx.paint);
    const showBtn = state !== 'idle' && state !== 'loading';
    const res = MAIN && MAIN.res;
    const p = cx.panel({
      id: 'em-load', wide: true, title: 'Carbon and 24×7 match',
      face: cx.faceLine([['scope', SYS], ['held', '2021 onward · five solved runs']]),
      faceText: `${SYS} | ${ROUTE}`,
      controls: [showBtn ? btn : null],
      draw: body => {
        if (state === 'idle') body.appendChild(cx.emptyBox('Live data not connected',
          `${SYS} CO₂ intensity (average and marginal proxy), month × hour and 24×7 matching are read from the live GridSense server: settled 2021 onward and the five solved runs. Connect live data (top bar) once; this browser then reads them on every open.`));
        else if (state === 'loading') body.appendChild(cx.emptyBox('Reading emissions', `${SYS} · ${measureWord(S.measure).toLowerCase()} · ${S.year}.`));
        else body.appendChild(cx.emptyBox('Emissions not served',
          `${(res && res.why) || state}${res && res.field ? ` (field ${res.field})` : ''}. Nothing from a previous read is shown. Load again asks the server again.`));
      },
    });
    p.setAttribute('data-em-panel', 'em-load');
    return p;
  }

  C.register({
    k: VIEW, label: 'Carbon and 24×7 match', screen: 'offtake', module: 'ext/68', scenario: 'not-applied',
    replaces: ['Carbon and 24×7 match'],   // ext/59 (slice S5 hook): the built panel retires its planned entry
    why: 'a price scenario does not change emissions — they are read from ISO-NE generation by fuel and the solved runs\' dispatch',
    build,
  });
  root.GSContinuumEmissions = { get state() { return Object.assign({}, S, { info: Object.assign({}, S.info) }); }, reset() { RES.clear(); } };
})(window);
