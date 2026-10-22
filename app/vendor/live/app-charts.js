/* VENDORED from live Studio src/app.js L489-818 (snapshot 2026-10-11, sha256 b8df3283abd46150), cut by marker lines.
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   GridSense Analytics — chart renderers (Charts).

   One drawing path. Widgets AND the Graph Configurator preview call these, so
   what an author sees while building is what ships. Rules (dataviz method):
   thin marks (bars ≤ 24px, 2px lines, ≥8px markers), solid hairline grid,
   one y-axis per panel (never a dual axis — use Charts.panels), series colours
   in fixed order from --s1…--s8 (never cycled), status colours only for
   status, text in ink tokens never in series colours, a tooltip on every mark,
   forecast drawn dashed after the seam and never joined to settled.

   Every renderer: Charts.<kind>(spec) → HTMLElement. spec.w / spec.h are pixels
   (the host measures its card and passes the width). All numbers are read from
   spec — renderers never compute business values.
   ═══════════════════════════════════════════════════════════════════════════ */
window.Charts = (function () {
  const NS = 'http://www.w3.org/2000/svg';
  const cv = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const S = i => cv('--s' + ((i % 8) + 1));
  const E = (t, a, txt) => { const n = document.createElementNS(NS, t); for (const k in a || {}) if (a[k] != null) n.setAttribute(k, a[k]); if (txt != null) n.textContent = txt; return n; };
  const H = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
  const fmt = () => window.GS ? GS.fmt : { num: v => String(v) };
  const num = (v, dp) => fmt().num(v, dp);

  /* ── tooltip (one element for the page) ─────────────────────────────── */
  const Tip = {
    el() { let t = document.getElementById('tip'); if (!t) { t = H('div'); t.id = 'tip'; document.body.appendChild(t); } return t; },
    show(ev, d) { const t = Tip.el(); let html = d.h ? `<div class="h">${esc(d.h)}</div>` : ''; (d.rows || []).forEach(r => { html += `<div class="r"><span class="k">${r[2] ? `<i style="background:${r[2]}"></i>` : ''}${esc(r[0])}</span><span class="v">${esc(r[1])}</span></div>`; }); if (d.note) html += `<span class="n">${esc(d.note)}</span>`; t.innerHTML = html; t.style.opacity = '1'; const r = t.getBoundingClientRect(); let x = ev.clientX + 14, y = ev.clientY + 14; if (x + r.width > innerWidth - 10) x = ev.clientX - r.width - 14; if (y + r.height > innerHeight - 10) y = ev.clientY - r.height - 14; t.style.left = Math.max(8, x) + 'px'; t.style.top = Math.max(8, y) + 'px'; },
    hide() { const t = document.getElementById('tip'); if (t) t.style.opacity = '0'; },
    bind(node, fn) { node.style.cursor = 'crosshair'; node.addEventListener('mousemove', ev => { const d = fn(ev); if (d) Tip.show(ev, d); else Tip.hide(); }); node.addEventListener('mouseleave', Tip.hide); },
  };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ── axis helpers ───────────────────────────────────────────────────── */
  function niceTicks(lo, hi, want = 4) {
    if (!(hi > lo)) { hi = lo + 1; }
    const span = hi - lo, raw = span / want, mag = Math.pow(10, Math.floor(Math.log10(raw))); const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const t = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(+v.toFixed(10)); return { ticks: t, step };
  }
  function domain(vals, o = {}) { const c = vals.filter(v => v != null && !Number.isNaN(v)); let lo = o.min ?? Math.min(...c, o.zero !== false ? 0 : Infinity), hi = o.max ?? Math.max(...c, o.zero !== false ? 0 : -Infinity); if (!Number.isFinite(lo)) lo = 0; if (!Number.isFinite(hi)) hi = 1; if (hi === lo) { hi = lo + (Math.abs(lo) || 1); } if (o.pad !== false) { const p = (hi - lo) * (o.pad ?? .08); if (o.max == null) hi += p; if (o.min == null && lo < 0) lo -= p; } return [lo, hi]; }
  const textW = (s, size = 10) => String(s).length * size * .6 + 4;
  function fmtTick(v, unit, step) { const dp = step != null ? (step >= 1 ? 0 : step >= .1 ? 1 : step >= .01 ? 2 : 3) : null; if (unit === '$/MWh' || unit === '$') return (v < 0 ? '−$' : '$') + num(Math.abs(v), dp ?? (Math.abs(v) >= 10 ? 0 : 1)); if (unit === '%') return num(v, dp ?? 0) + '%'; if (unit === '$k') return '$' + num(v, dp ?? 0) + 'k'; if (unit === '$M') return '$' + num(v, dp ?? 0) + 'M'; if (Math.abs(v) >= 1000) return num(v, 0); return num(v, dp ?? (Math.abs(v) < 1 && v !== 0 ? 2 : Math.abs(v) < 10 ? 1 : 0)); }
  const fmtVal = (v, unit, dp) => { if (v == null) return '—'; if (unit === '$/MWh') return fmt().money(v, dp ?? 2) + '/MWh'; if (unit === '$') return fmt().money(v, dp ?? 0); if (unit === '$k') return '$' + num(v, dp ?? 0) + 'k'; if (unit === '$M') return '$' + num(v, dp ?? 1) + 'M'; if (unit === '%') return num(v, dp ?? 1) + '%'; if (unit === 'MW') return num(v, dp ?? 1) + ' MW'; if (unit === 'ratio') return num(v, dp ?? 3); if (unit === 'hours') return num(v, 0) + ' h'; return num(v, dp) + (unit ? ' ' + unit : ''); };

  /** frame: builds svg + plot area, y axis (left), returns helpers */
  function frame(spec, o = {}) {
    const w = spec.w || 600, h = spec.h || 200; const pad = { l: o.l ?? 46, r: o.r ?? 14, t: o.t ?? 12, b: o.b ?? (spec.xLabel ? 34 : 24) };
    const svg = E('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'plot', role: 'img' }); if (spec.aria) svg.setAttribute('aria-label', spec.aria);
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    return { svg, w, h, pad, iw, ih, X: f => pad.l + f * iw, Y: f => pad.t + ih - f * ih };
  }
  function yAxis(F, lo, hi, unit, want, label, integer) {
    let { ticks, step } = niceTicks(lo, hi, want || Math.max(2, Math.round(F.ih / 44)));
    if (integer && step < 1) { step = 1; ticks = []; for (let v = Math.ceil(lo); v <= hi + 1e-9; v += 1) ticks.push(v); }
    const y = v => F.Y((v - lo) / (hi - lo));
    ticks.forEach(t => { const yy = y(t); F.svg.appendChild(E('line', { x1: F.pad.l, y1: yy, x2: F.pad.l + F.iw, y2: yy, stroke: cv('--grid-line'), 'stroke-width': 1 })); F.svg.appendChild(E('text', { x: F.pad.l - 6, y: yy + 3, 'text-anchor': 'end', class: 'ax', fill: cv('--ink-3'), 'font-size': 9.5, 'font-family': cv('--mono') }, fmtTick(t, unit, step))); });
    if (label) F.svg.appendChild(E('text', { x: F.pad.l, y: F.pad.t - 3, class: 'ax', fill: cv('--ink-4'), 'font-size': 9, 'font-family': cv('--mono') }, label));
    return y;
  }
  function xCat(F, labels, o = {}) { const n = labels.length, bw = F.iw / n; const step = Math.max(1, Math.ceil(textW(labels.reduce((a, b) => String(b).length > String(a).length ? b : a, ''), 9.5) / bw)); labels.forEach((l, i) => { if (i % step && i !== n - 1) return; if (i === n - 1 && i % step && (n - 1) % step && bw * (i - Math.floor((n - 1) / step) * step) < textW(l, 9.5)) return; const x = F.pad.l + bw * (i + .5); const t = E('text', { x, y: F.h - F.pad.b + 14, 'text-anchor': 'middle', fill: o.hi === i ? cv('--ink') : cv('--ink-3'), 'font-size': 9.5, 'font-family': cv('--mono'), 'font-weight': o.hi === i ? 600 : 400 }, l); F.svg.appendChild(t); }); if (o.label) F.svg.appendChild(E('text', { x: F.pad.l + F.iw / 2, y: F.h - 4, 'text-anchor': 'middle', fill: cv('--ink-4'), 'font-size': 9, 'font-family': cv('--mono') }, o.label)); return i => F.pad.l + bw * (i + .5); }
  function xNum(F, lo, hi, unit, label, want) { const { ticks, step } = niceTicks(lo, hi, want || Math.max(2, Math.round(F.iw / 90))); const x = v => F.X((v - lo) / (hi - lo)); ticks.forEach(t => { F.svg.appendChild(E('text', { x: x(t), y: F.h - F.pad.b + 14, 'text-anchor': 'middle', fill: cv('--ink-3'), 'font-size': 9.5, 'font-family': cv('--mono') }, fmtTick(t, unit, step))); }); if (label) F.svg.appendChild(E('text', { x: F.pad.l + F.iw / 2, y: F.h - 4, 'text-anchor': 'middle', fill: cv('--ink-4'), 'font-size': 9, 'font-family': cv('--mono') }, label)); return x; }
  function rule(F, y, color, label, dash = '4 3', anchor = 'end') { F.svg.appendChild(E('line', { x1: F.pad.l, y1: y, x2: F.pad.l + F.iw, y2: y, stroke: color, 'stroke-width': 1, 'stroke-dasharray': dash })); if (label) F.svg.appendChild(E('text', { x: anchor === 'end' ? F.pad.l + F.iw - 2 : F.pad.l + 4, y: y - 4, 'text-anchor': anchor, fill: color, 'font-size': 9.5, 'font-family': cv('--mono') }, label)); }
  function vrule(F, x, color, label, dash = '3 4') { F.svg.appendChild(E('line', { x1: x, y1: F.pad.t, x2: x, y2: F.pad.t + F.ih, stroke: color, 'stroke-width': 1, 'stroke-dasharray': dash })); if (label) F.svg.appendChild(E('text', { x: x + 5, y: F.pad.t + 10, fill: color, 'font-size': 9.5, 'font-family': cv('--mono') }, label)); }
  /** A shade of one colour down (or across) a mark.
   *  Same hue throughout — only the weight changes, so the mark keeps its
   *  identity in the legend while its body stops competing with the type. */
  let gradN = 0;
  function shade(svg, color, o = {}) {
    if (!color || String(color).startsWith('url(')) return color;
    const id = 'gs-g' + (++gradN);
    let defs = svg.querySelector('defs');
    if (!defs) { defs = E('defs'); svg.insertBefore(defs, svg.firstChild); }
    const lg = E('linearGradient', { id, x1: 0, y1: 0, x2: o.across ? 1 : 0, y2: o.across ? 0 : 1 });
    lg.appendChild(E('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': o.from ?? .95 }));
    if (o.mid != null) lg.appendChild(E('stop', { offset: '55%', 'stop-color': color, 'stop-opacity': o.mid }));
    lg.appendChild(E('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': o.to ?? .5 }));
    defs.appendChild(lg); return `url(#${id})`;
  }
  function hatch(svg, id, color) { const d = E('defs'); const p = E('pattern', { id, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }); p.appendChild(E('rect', { width: 6, height: 6, fill: cv('--tint') })); p.appendChild(E('line', { x1: 0, y1: 0, x2: 0, y2: 6, stroke: color, 'stroke-width': 2, opacity: .55 })); d.appendChild(p); svg.appendChild(d); return `url(#${id})`; }
  function legend(items) { const k = H('div', 'w-key'); items.forEach(it => { const s = H('span'); const i = H('i'); if (it.kind === 'line') i.className = 'line'; if (it.kind === 'dash') { i.className = 'dash'; i.style.color = it.color; } if (it.kind === 'hatch') i.className = 'hatch'; if (it.kind === 'dot') i.className = 'dot'; if (it.color && it.kind !== 'dash') i.style.background = it.color; if (it.kind === 'band') { i.style.background = it.color; i.style.opacity = .35; } s.appendChild(i); s.appendChild(document.createTextNode(it.label)); k.appendChild(s); }); return k; }
  function wrap(svg, key) { const d = H('div'); d.appendChild(svg); if (key && key.length) d.appendChild(legend(key)); return d; }
  const STATE_COLOR = { ok: '--ok', warn: '--warn', bad: '--bad', over: '--over', na: '--ink-4', unknown: '--ink-4', neutral: '--s1' };
  const sc = st => cv(STATE_COLOR[st] || '--s1');

  /* ═══ BARS ═══ vertical, grouped (default) / stacked / mirror (negatives) */
  function bars(spec) {
    // spec: {w,h, cats:[], series:[{name, values:[], color?, states?:[], faint?, dash?}], unit, yLabel, rule:{v,label}, mode:'group'|'stack', mark:index|indices, labels:boolean, marks:[{i,label}], zero, capValue}
    const F = frame(spec, { l: spec.l ?? 46 });
    const series = spec.series || []; const n = spec.cats.length; const stack = spec.mode === 'stack';
    let all = []; if (stack) { for (let i = 0; i < n; i++) { let pos = 0, neg = 0; series.forEach(s => { const v = s.values[i]; if (v == null) return; if (v >= 0) pos += v; else neg += v; }); all.push(pos, neg); } } else series.forEach(s => all.push(...s.values));
    if (spec.rule) all.push(spec.rule.v); if (spec.rules) spec.rules.forEach(r => all.push(r.v));
    const [lo, hi] = domain(all, { min: spec.yMin, max: spec.yMax, pad: .12 });
    const y = yAxis(F, lo, hi, spec.unit, null, spec.yLabel);
    const xc = xCat(F, spec.cats, { hi: typeof spec.mark === 'number' ? spec.mark : undefined, label: spec.xLabel });
    const slot = F.iw / n; const groupW = Math.min(slot * .78, stack ? 26 : series.length * 26); const bw = stack ? groupW : Math.min(24, groupW / series.length); const zero = y(0);
    // mark frames
    const marks = Array.isArray(spec.mark) ? spec.mark : spec.mark != null ? [spec.mark] : [];
    marks.forEach(mi => F.svg.appendChild(E('rect', { x: xc(mi) - slot / 2 + 3, y: F.pad.t, width: slot - 6, height: F.ih, fill: cv('--accent-soft'), rx: 4 })));
    for (let i = 0; i < n; i++) {
      let posTop = zero, negTop = zero;
      series.forEach((s, j) => {
        const v = s.values[i]; if (v == null) return;
        const color = s.states && s.states[i] ? sc(s.states[i]) : (s.color || S(j));
        let y0, y1; if (stack) { if (v >= 0) { y1 = y(v + (hi - lo) * 0) ; const hgt = zero - y(v); y0 = posTop - hgt; y1 = posTop; posTop = y0; } else { const hgt = y(v) - zero; y0 = negTop; y1 = negTop + hgt; negTop = y1; } } else { y0 = Math.min(zero, y(v)); y1 = Math.max(zero, y(v)); }
        const x = stack ? xc(i) - bw / 2 : xc(i) - groupW / 2 + j * (groupW / series.length) + (groupW / series.length - bw) / 2;
        const hgt = Math.max(1, Math.abs(y1 - y0) - (stack ? 2 : 0));
        const r = E('rect', { x, y: v >= 0 ? y1 - hgt : y0, width: bw, height: hgt, fill: s.hatch && s.hatch[i] ? hatch(F.svg, 'h' + i + j + Math.random().toString(36).slice(2, 6), color) : shade(F.svg, color, { from: .97, to: .62 }), rx: 3, opacity: s.faint ? .45 : 1 });
        if (s.hatch && s.hatch[i]) r.setAttribute('stroke', color), r.setAttribute('stroke-width', 1);
        Tip.bind(r, () => ({ h: spec.cats[i] + (spec.tipCat ? ' · ' + spec.tipCat[i] : ''), rows: [[s.name || spec.yLabel || 'Value', fmtVal(v, spec.unit, spec.dp), color], ...(s.tip ? s.tip(i) : [])], note: spec.note }));
        F.svg.appendChild(r);
        // value label on cap when few bars
        if (spec.labels !== false && n * series.length <= 8) { const t = E('text', { x: x + bw / 2, y: v >= 0 ? (y1 - hgt) - 4 : y1 + 11, 'text-anchor': 'middle', fill: cv('--ink-2'), 'font-size': 9.5, 'font-family': cv('--mono') }, s.labelText && s.labelText[i] != null ? s.labelText[i] : fmtVal(v, spec.unit === 'MW' ? 'MW' : spec.unit, spec.dp)); F.svg.appendChild(t); }
      });
    }
    if (lo < 0) F.svg.appendChild(E('line', { x1: F.pad.l, y1: zero, x2: F.pad.l + F.iw, y2: zero, stroke: cv('--axis'), 'stroke-width': 1 }));
    if (spec.rule) rule(F, y(spec.rule.v), cv('--accent'), spec.rule.label); (spec.rules || []).forEach(r => rule(F, y(r.v), r.color || cv('--ink-3'), r.label));
    (spec.annot || []).forEach(a => F.svg.appendChild(E('text', { x: xc(a.i), y: y(a.v) - 6, 'text-anchor': 'middle', fill: cv('--ink-2'), 'font-size': 9.5, 'font-family': cv('--mono') }, a.label)));
    const key = spec.key || (series.length > 1 ? series.map((s, j) => ({ label: s.name, color: s.color || S(j) })) : []);
    return wrap(F.svg, key);
  }

  /* ═══ HBARS ═══ horizontal ranked bars with full labels */
  function hbars(spec) {
    // spec: {w, rows:[{label, sub, value, state, color, meta}], unit, max, rule:{v,label}, hi:index}
    const rows = spec.rows || []; const rowH = spec.rowH || 28; let labelW = Math.min(260, Math.max(120, ...rows.map(r => Math.max(textW(r.label, 11.5), r.sub ? textW(r.sub, 9.5) : 0)))); const valW = 78;
    const w = spec.w || 600, h = rows.length * rowH + 22; const svg = E('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'plot' });
    const vals = rows.map(r => r.value).filter(v => v != null); const max = spec.max ?? Math.max(...vals, spec.rule ? spec.rule.v : 0, 0.0001); const min = Math.min(0, ...vals);
    /* orchestrator 2026-09-25: a card under ~372 px produced <rect width="-45.7"> — clamp the label column so the bars keep at least 40 px */ labelW = Math.min(labelW, Math.max(40, w - valW - 46)); const x0 = labelW + 8, iw = w - x0 - valW - 6; const x = v => x0 + ((v - min) / (max - min)) * iw; const zero = x(0);
    rows.forEach((r, i) => {
      const yy = i * rowH + 4; const color = r.state ? sc(r.state) : (r.color || S(0));
      const g = E('g'); if (spec.hi === i) g.appendChild(E('rect', { x: 0, y: yy - 3, width: w, height: rowH - 2, fill: cv('--accent-soft'), rx: 4 }));
      const lab = E('text', { x: labelW, y: yy + (r.sub ? 9 : 13), 'text-anchor': 'end', fill: cv('--ink-2'), 'font-size': 11.5 }, r.label); g.appendChild(lab);
      if (r.sub) g.appendChild(E('text', { x: labelW, y: yy + 20, 'text-anchor': 'end', fill: cv('--ink-4'), 'font-size': 9.5, 'font-family': cv('--mono') }, r.sub));
      g.appendChild(E('rect', { x: x0, y: yy + 5, width: iw, height: 10, fill: cv('--sunk'), rx: 3 }));
      if (r.value != null) { const bx = Math.min(zero, x(r.value)), bwid = Math.max(2, Math.abs(x(r.value) - zero)); const b = E('rect', { x: bx, y: yy + 5, width: bwid, height: 10, fill: shade(svg, color, { across: true, from: .95, to: .66 }), rx: 3 }); Tip.bind(b, () => ({ h: r.label, rows: [[spec.unitLabel || 'Value', fmtVal(r.value, spec.unit, spec.dp), color], ...(r.tip || [])], note: r.meta })); g.appendChild(b); }
      g.appendChild(E('text', { x: w - 4, y: yy + 14, 'text-anchor': 'end', fill: cv('--ink'), 'font-size': 11, 'font-family': cv('--mono') }, r.text ?? fmtVal(r.value, spec.unit, spec.dp)));
      svg.appendChild(g);
    });
    if (spec.rule) { const rx = x(spec.rule.v); svg.appendChild(E('line', { x1: rx, y1: 2, x2: rx, y2: h - 18, stroke: cv('--accent'), 'stroke-dasharray': '4 3' })); svg.appendChild(E('text', { x: rx + 4, y: h - 8, fill: cv('--accent'), 'font-size': 9.5, 'font-family': cv('--mono') }, spec.rule.label)); }
    return wrap(svg, spec.key);
  }

  /* ═══ LINE ═══ multi-series; forecast dashed after seam; band; rules; shades */
  function line(spec) {
    // spec: {w,h, x:[] labels or numbers, xNumeric, series:[{name, values:[], color, dash, lo:[], hi:[], forecastFrom:index, markers}], unit, yLabel, xLabel, rules:[{v,label,color}], vrules:[{i|x,label}], shade:[{from,to,label}], yMin,yMax, zero:false, endLabels, seamLabel}
    const F = frame(spec, { l: spec.l ?? 46, r: spec.endLabels ? 70 : 14 });
    const series = spec.series || []; const xs = spec.x || []; const n = xs.length; const numeric = spec.xNumeric;
    const all = []; series.forEach(s => { all.push(...s.values); if (s.lo) all.push(...s.lo); if (s.hi) all.push(...s.hi); }); (spec.rules || []).forEach(r => all.push(r.v));
    const [lo, hi] = domain(all, { min: spec.yMin, max: spec.yMax, zero: spec.zero, pad: .1 });
    const y = yAxis(F, lo, hi, spec.unit, null, spec.yLabel);
    let x; if (numeric) { const xl = spec.xMin ?? Math.min(...xs), xh = spec.xMax ?? Math.max(...xs); x = xNum(F, xl, xh, spec.xUnit, spec.xLabel); } else { const xc = xCat(F, xs.map(String), { label: spec.xLabel }); x = i => xc(i); }
    const px = (i) => numeric ? x(xs[i]) : x(i);
    (spec.shade || []).forEach(sh => { const a = numeric ? x(sh.from) : x(sh.from) - F.iw / n / 2, b = numeric ? x(sh.to) : x(sh.to) + F.iw / n / 2; F.svg.appendChild(E('rect', { x: a, y: F.pad.t, width: Math.max(0, b - a), height: F.ih, fill: cv('--accent-soft'), rx: 3 })); if (sh.label) F.svg.appendChild(E('text', { x: a + 4, y: F.pad.t + 10, fill: cv('--accent'), 'font-size': 9.5, 'font-family': cv('--mono') }, sh.label)); });
    if (lo < 0 && hi > 0) F.svg.appendChild(E('line', { x1: F.pad.l, y1: y(0), x2: F.pad.l + F.iw, y2: y(0), stroke: cv('--axis') }));
    series.forEach((s, j) => {
      const color = s.color || S(j);
      if (s.lo && s.hi) { const up = [], dn = []; for (let i = 0; i < n; i++) { if (s.hi[i] == null || s.lo[i] == null) continue; up.push(`${px(i)},${y(s.hi[i])}`); dn.push(`${px(i)},${y(s.lo[i])}`); } if (up.length) F.svg.appendChild(E('polygon', { points: up.concat(dn.reverse()).join(' '), fill: shade(F.svg, color, { from: .22, mid: .14, to: .06 }), opacity: 1 })); }
      const seam = s.forecastFrom ?? (s.dash ? 0 : n);
      const seg = (from, to, dash) => { /* orchestrator 2026-09-24: a null breaks the polyline — no line is ever drawn across a gap in the record */ let pts = []; const flush = () => { if (pts.length > 1) F.svg.appendChild(E('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': s.width || 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': dash ? '5 4' : null, opacity: s.faint ? .5 : 1 })); pts = []; }; for (let i = from; i < to; i++) { if (s.values[i] == null) flush(); else pts.push(`${px(i)},${y(s.values[i])}`); } flush(); };
      seg(0, Math.min(seam, n), false); if (seam < n) seg(Math.max(0, seam - 1), n, true);
      if (s.markers !== false && n <= 40) for (let i = 0; i < n; i++) { if (s.values[i] == null) continue; const c = E('circle', { cx: px(i), cy: y(s.values[i]), r: s.r || 3.2, fill: color, stroke: cv('--surface'), 'stroke-width': 2 }); F.svg.appendChild(c); }
      if (spec.endLabels && series.length <= 4) { let li = n - 1; while (li >= 0 && s.values[li] == null) li--; if (li >= 0) F.svg.appendChild(E('text', { x: px(li) + 7, y: y(s.values[li]) + 3, fill: cv('--ink-2'), 'font-size': 10, 'font-family': cv('--mono') }, s.endText || fmtVal(s.values[li], spec.unit, spec.dp))); }
    });
    const seamIdx = series.map(s => s.forecastFrom).filter(v => v != null); if (seamIdx.length && spec.seam !== false) { const si = Math.min(...seamIdx); if (si > 0 && si < n) vrule(F, px(si - 1), cv('--ink-4'), spec.seamLabel || 'forecast →'); }
    (spec.rules || []).forEach(r => rule(F, y(r.v), r.color || cv('--ink-3'), r.label, r.dash));
    (spec.vrules || []).forEach(r => vrule(F, r.x != null ? x(r.x) : px(r.i), r.color || cv('--accent'), r.label));
    (spec.points || []).forEach(p => { const cx = p.x != null ? x(p.x) : px(p.i), cy = y(p.v); F.svg.appendChild(p.diamond ? E('rect', { x: cx - 5, y: cy - 5, width: 10, height: 10, fill: p.color || cv('--warn'), transform: `rotate(45 ${cx} ${cy})`, stroke: cv('--surface'), 'stroke-width': 2 }) : E('circle', { cx, cy, r: 5.5, fill: p.fill || 'none', stroke: p.color || cv('--accent'), 'stroke-width': 2 })); if (p.label) F.svg.appendChild(E('text', { x: cx + (p.dx ?? 8), y: cy + (p.dy ?? -8), fill: cv('--ink-2'), 'font-size': 9.5, 'font-family': cv('--mono') }, p.label)); });
    // crosshair hover
    const hit = E('rect', { x: F.pad.l, y: F.pad.t, width: F.iw, height: F.ih, fill: 'transparent' }); const cross = E('line', { x1: 0, y1: F.pad.t, x2: 0, y2: F.pad.t + F.ih, stroke: cv('--ink-4'), 'stroke-width': 1, opacity: 0 }); F.svg.appendChild(cross);
    Tip.bind(hit, ev => { const box = F.svg.getBoundingClientRect(); const mx = (ev.clientX - box.left) / box.width * F.w; let bi = 0, bd = Infinity; for (let i = 0; i < n; i++) { const d = Math.abs(px(i) - mx); if (d < bd) { bd = d; bi = i; } } cross.setAttribute('x1', px(bi)); cross.setAttribute('x2', px(bi)); cross.setAttribute('opacity', 1); return { h: (spec.xFormat ? spec.xFormat(xs[bi]) : String(xs[bi])) + (series.some(s => s.forecastFrom != null && bi >= s.forecastFrom) ? ' · forecast' : ''), rows: series.filter(s => s.values[bi] != null).map((s, j) => [s.name || 'Value', fmtVal(s.values[bi], spec.unit, spec.dp) + (s.lo && s.lo[bi] != null ? ` (${fmtVal(s.lo[bi], spec.unit, spec.dp)} – ${fmtVal(s.hi[bi], spec.unit, spec.dp)})` : ''), s.color || S(series.indexOf(s))]), note: spec.note }; });
    hit.addEventListener('mouseleave', () => cross.setAttribute('opacity', 0)); F.svg.appendChild(hit);
    const key = spec.key || (series.length > 1 ? series.map((s, j) => ({ label: s.name, color: s.color || S(j), kind: s.dash ? 'dash' : 'line' })) : []);
    return wrap(F.svg, key);
  }

  /* ═══ PANELS ═══ stacked single-axis panels sharing x (never a dual axis) */
  function panels(spec) { const d = H('div'); d.style.display = 'flex'; d.style.flexDirection = 'column'; d.style.gap = '2px'; spec.panels.forEach((p, i) => { const el = (p.kind === 'bars' ? bars : line)(Object.assign({ w: spec.w, x: spec.x, cats: spec.x, h: p.h || (i === 0 ? 120 : 96), xLabel: i === spec.panels.length - 1 ? spec.xLabel : undefined }, p)); d.appendChild(el); }); return d; }

  /* ═══ SCATTER ═══ population scatter with highlighted/labelled points and gate box */
  function scatter(spec) {
    // spec: {w,h, pts:[{x,y,id,label,hi,color,r,state}], xLabel, yLabel, xUnit, yUnit, box:{x0,x1,y0,y1,label}, rules, vrules, labelMax}
    const F = frame(spec, { l: 50, b: 34 });
    const pts = (spec.pts || []).filter(p => p.x != null && p.y != null);
    const [xl, xh] = domain(pts.map(p => p.x), { zero: false, min: spec.xMin, max: spec.xMax }); const [yl, yh] = domain(pts.map(p => p.y), { zero: false, min: spec.yMin, max: spec.yMax });
    const y = yAxis(F, yl, yh, spec.yUnit, null, spec.yLabel); const x = xNum(F, xl, xh, spec.xUnit, spec.xLabel);
    if (spec.box) { const b = spec.box; const x0 = x(Math.max(xl, b.x0 ?? xl)), x1 = x(Math.min(xh, b.x1 ?? xh)), y0 = y(Math.min(yh, b.y1 ?? yh)), y1 = y(Math.max(yl, b.y0 ?? yl)); F.svg.appendChild(E('rect', { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0), fill: cv('--accent'), opacity: .08 })); F.svg.appendChild(E('rect', { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0), fill: 'none', stroke: cv('--accent-line'), 'stroke-dasharray': '3 3' })); if (b.label) F.svg.appendChild(E('text', { x: Math.min(x1 + 6, F.pad.l + F.iw - textW(b.label, 9.5)), y: y0 + 12, fill: cv('--accent'), 'font-size': 9.5, 'font-family': cv('--mono') }, b.label)); }
    (spec.rules || []).forEach(r => rule(F, y(r.v), r.color || cv('--ink-3'), r.label)); (spec.vrules || []).forEach(r => vrule(F, x(r.v), r.color || cv('--ink-3'), r.label));
    const g = E('g'); pts.filter(p => !p.hi).forEach(p => g.appendChild(E('circle', { cx: x(p.x), cy: y(p.y), r: p.r || 2.2, fill: p.color || (p.state ? sc(p.state) : cv('--ink-4')), opacity: p.opacity ?? .45 }))); F.svg.appendChild(g);
    pts.filter(p => p.hi).forEach((p, i) => { const c = E('circle', { cx: x(p.x), cy: y(p.y), r: p.r || 5.5, fill: p.color || S(i), stroke: cv('--surface'), 'stroke-width': 2 }); F.svg.appendChild(c); if (p.label && (spec.labelMax == null || i < spec.labelMax)) F.svg.appendChild(E('text', { x: x(p.x) + 8, y: y(p.y) + 3, fill: cv('--ink'), 'font-size': 10, 'font-weight': 600 }, p.label)); });
    // nearest-point hover over whole plot
    const hit = E('rect', { x: F.pad.l, y: F.pad.t, width: F.iw, height: F.ih, fill: 'transparent' });
    Tip.bind(hit, ev => { const box = F.svg.getBoundingClientRect(); const mx = (ev.clientX - box.left) / box.width * F.w, my = (ev.clientY - box.top) / box.height * F.h; let best = null, bd = 400; pts.forEach(p => { const d = (x(p.x) - mx) ** 2 + (y(p.y) - my) ** 2; if (d < bd) { bd = d; best = p; } }); if (!best) return null; return { h: best.label || best.id || 'Point', rows: [[spec.xLabel || 'x', fmtVal(best.x, spec.xUnit, spec.xDp)], [spec.yLabel || 'y', fmtVal(best.y, spec.yUnit, spec.yDp)], ...(best.tip || [])], note: best.note || spec.note }; });
    F.svg.appendChild(hit);
    return wrap(F.svg, spec.key);
  }

  /* ═══ HEAT ═══ rows × cols grid, one hue light→dark */
  function heat(spec) {
    // spec: {w, rows:[label], cols:[label], values:[[]], unit, rowH, markCols:[idx], colLabel, min,max, labels:boolean, tip(r,c)}
    const rows = spec.rows, cols = spec.cols; const gut = Math.max(28, ...rows.map(r => textW(r, 9.5))); const rowH = spec.rowH || 13; const w = spec.w || 600; const cw = (w - gut - 4) / cols.length; const h = rows.length * rowH + 30 + (spec.colLabel ? 10 : 0);
    const svg = E('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'plot' });
    const flat = spec.values.flat().filter(v => v != null); const lo = spec.min ?? Math.min(...flat), hi = spec.max ?? Math.max(...flat);
    const ramp = ['--h1', '--h2', '--h3', '--h4', '--h5', '--h6', '--h7'].map(cv);
    const col = t => { t = Math.max(0, Math.min(1, t)); const i = t * (ramp.length - 1), a = Math.floor(i), b = Math.min(ramp.length - 1, a + 1), f = i - a; return mix(ramp[a], ramp[b], f); };
    rows.forEach((r, ri) => { svg.appendChild(E('text', { x: gut - 5, y: ri * rowH + rowH / 2 + 3.5, 'text-anchor': 'end', fill: cv('--ink-3'), 'font-size': 9.5, 'font-family': cv('--mono') }, r)); cols.forEach((c, ci) => { const v = spec.values[ri][ci]; const t = v == null ? null : hi > lo ? (v - lo) / (hi - lo) : .5; const rect = E('rect', { x: gut + ci * cw, y: ri * rowH, width: Math.max(0, cw - 1), height: rowH - 1, rx: 1.5, fill: v == null ? 'transparent' : col(t), stroke: v == null ? cv('--border') : null, 'stroke-dasharray': v == null ? '2 2' : null }); Tip.bind(rect, () => ({ h: `${r} · ${c}`, rows: [[spec.unitLabel || 'Value', fmtVal(v, spec.unit, spec.dp)], ...(spec.tip ? spec.tip(ri, ci) : [])], note: spec.note })); svg.appendChild(rect); if (spec.labels && v != null && cw > 30) svg.appendChild(E('text', { x: gut + ci * cw + cw / 2, y: ri * rowH + rowH / 2 + 3.5, 'text-anchor': 'middle', fill: t > .55 ? '#fff' : cv('--ink'), 'font-size': 9, 'font-family': cv('--mono') }, fmtVal(v, spec.unit, spec.dp ?? 0))); }); });
    (spec.markCols || []).forEach(ci => svg.appendChild(E('rect', { x: gut + ci * cw - .5, y: -.5, width: cw, height: rows.length * rowH, fill: 'none', stroke: cv('--warn'), 'stroke-width': 1.2 })));
    const step = Math.max(1, Math.ceil(textW(cols[cols.length - 1], 9) / cw)); cols.forEach((c, ci) => { if (ci % step) return; svg.appendChild(E('text', { x: gut + ci * cw + cw / 2, y: rows.length * rowH + 11, 'text-anchor': 'middle', fill: cv('--ink-3'), 'font-size': 9, 'font-family': cv('--mono') }, c)); });
    if (spec.colLabel) svg.appendChild(E('text', { x: gut + (cols.length * cw) / 2, y: rows.length * rowH + 22, 'text-anchor': 'middle', fill: cv('--ink-4'), 'font-size': 9, 'font-family': cv('--mono') }, spec.colLabel));
    // scale bar
    const sy = h - 8; svg.appendChild(E('text', { x: gut, y: sy, fill: cv('--ink-4'), 'font-size': 9, 'font-family': cv('--mono') }, fmtVal(lo, spec.unit, spec.dp ?? 0))); for (let i = 0; i < 9; i++) svg.appendChild(E('rect', { x: gut + 46 + i * 12, y: sy - 8, width: 11, height: 8, fill: col(i / 8), rx: 1 })); svg.appendChild(E('text', { x: gut + 46 + 9 * 12 + 4, y: sy, fill: cv('--ink-4'), 'font-size': 9, 'font-family': cv('--mono') }, fmtVal(hi, spec.unit, spec.dp ?? 0)));
    return wrap(svg, spec.key);
  }
  function mix(a, b, f) { const pa = hex(a), pb = hex(b); if (!pa || !pb) return a; return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * f)).join(',')})`; }
  function hex(c) { const m = c.match(/^#([0-9a-f]{6})$/i); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)); const r = c.match(/rgba?\(([^)]+)\)/); if (r) return r[1].split(',').slice(0, 3).map(Number); return null; }

  /* ═══ HIST ═══ histogram with quantile rules */
  function hist(spec) {
    // spec: {w,h, bins:[{lo,hi,n}], unit, xLabel, yLabel, rules:[{v,label,color}], threshold:{v,label}}
    const F = frame(spec, { l: 40, b: 34 }); const bins = spec.bins; const xl = bins[0].lo, xh = bins[bins.length - 1].hi; const [yl, yh] = domain(bins.map(b => b.n), { pad: .12 });
    const y = yAxis(F, yl, yh, null, null, spec.yLabel || 'count', true); const x = xNum(F, xl, xh, spec.unit, spec.xLabel);
    bins.forEach(b => { const x0 = x(b.lo) + 1, x1 = x(b.hi) - 1; const r = E('rect', { x: x0, y: y(b.n), width: Math.max(1, x1 - x0), height: F.pad.t + F.ih - y(b.n), fill: b.color || S(0), rx: 2 }); Tip.bind(r, () => ({ h: `${fmtVal(b.lo, spec.unit, spec.dp)} – ${fmtVal(b.hi, spec.unit, spec.dp)}`, rows: [[spec.yLabel || 'Count', num(b.n, 0)]], note: spec.note })); F.svg.appendChild(r); });
    (spec.rules || []).forEach(r => vrule(F, x(r.v), r.color || cv('--ink-3'), r.label)); if (spec.threshold) vrule(F, x(spec.threshold.v), cv('--warn'), spec.threshold.label, '5 3');
    return wrap(F.svg, spec.key);
  }

  /* ═══ WATERFALL ═══ horizontal HTML rows */
  function waterfall(spec) {
    // spec: {rows:[{label, meta, value, kind:'base'|'step'|'total'|'neg'}], unit, cumulative:boolean, header:[a,b,c]}
    const d = H('div', 'wf-t'); const hd = H('div', 'wf-h'); hd.innerHTML = `<span class="wf-l">${esc(spec.header?.[0] || 'Step')}</span><span style="flex:1"></span><span class="wf-v">${esc(spec.unit || '')}</span><span class="wf-c">${esc(spec.header?.[2] || 'Cumulative')}</span>`; d.appendChild(hd);
    let cum = 0; const total = spec.rows.filter(r => r.kind !== 'total').reduce((s, r) => s + Math.abs(r.value || 0), 0) || 1;
    spec.rows.forEach(r => { const row = H('div', 'wf-r' + (r.kind === 'total' ? ' total' : '')); const l = H('div', 'wf-l'); l.appendChild(document.createTextNode(r.label)); if (r.meta) l.appendChild(H('em', null, r.meta)); row.appendChild(l); const tr = H('div', 'wf-tr'); const bar = H('i', r.kind || 'step'); const start = r.kind === 'total' ? 0 : cum; if (r.kind !== 'total') cum += r.value || 0; const left = Math.max(0, Math.min(start, start + (r.value || 0))) / total * 100; const wid = Math.abs(r.value || 0) / total * 100; bar.style.left = (r.kind === 'total' ? 0 : left) + '%'; bar.style.width = (r.kind === 'total' ? Math.min(100, Math.abs(r.value) / total * 100) : wid) + '%'; if ((r.value || 0) < 0) bar.className = 'neg'; tr.appendChild(bar); row.appendChild(tr); row.appendChild(H('div', 'wf-v', fmtVal(r.value, spec.unit, spec.dp))); row.appendChild(H('div', 'wf-c', spec.cumulative === false ? '' : fmtVal(r.kind === 'total' ? r.value : cum, spec.unit, spec.dp))); row.addEventListener('mousemove', ev => Tip.show(ev, { h: r.label, rows: [[spec.unit || 'Value', fmtVal(r.value, spec.unit, spec.dp)], ...(r.tip || [])], note: r.meta })); row.addEventListener('mouseleave', Tip.hide); d.appendChild(row); });
    return d;
  }

  /* ═══ MATRIX ═══ HTML grid of cells with basis */
  function matrix(spec) {
    // spec: {corner, cols:[], rows:[{label, cells:[{text, note, tone, hi}]}]}
    const d = H('div', 'mx'); d.style.gridTemplateColumns = `minmax(120px,1.2fr) repeat(${spec.cols.length},minmax(90px,1fr))`; d.appendChild(H('div', 'c h', spec.corner || '')); spec.cols.forEach(c => d.appendChild(H('div', 'c h', c)));
    spec.rows.forEach(r => { d.appendChild(H('div', 'c rh', r.label)); r.cells.forEach(cell => { const c = H('div', 'c' + (cell.tone ? ' ' + cell.tone : '') + (cell.hi ? ' hi' : '')); c.appendChild(H('b', null, cell.text ?? '—')); if (cell.note) c.appendChild(H('span', null, cell.note)); if (cell.tip) { c.addEventListener('mousemove', ev => Tip.show(ev, cell.tip)); c.addEventListener('mouseleave', Tip.hide); } d.appendChild(c); }); });
    return d;
  }

  /* ═══ TABLE ═══ */
  function table(spec) {
    // spec: {cols:[{k,l,num,tag,fmt}], rows:[{}], limit, hi:(row)=>bool, foot}
    const wrapEl = H('div', 'tw'); if (spec.maxH) wrapEl.style.maxHeight = spec.maxH + 'px'; const t = H('table', 't'); const th = H('thead'); const trh = H('tr'); spec.cols.forEach(c => { const e = H('th', c.num ? 'n' : '', c.l); trh.appendChild(e); }); th.appendChild(trh); t.appendChild(th);
    const tb = H('tbody'); const rows = spec.limit ? spec.rows.slice(0, spec.limit) : spec.rows;
    rows.forEach(r => { const tr = H('tr', spec.hi && spec.hi(r) ? 'hi' : ''); spec.cols.forEach(c => { const td = H('td', c.num ? 'n' : ''); const v = r[c.k]; if (c.tag) { const tg = H('span', 'tag ' + (typeof c.tag === 'function' ? c.tag(v, r) : v), typeof c.tagText === 'function' ? c.tagText(v, r) : v); td.appendChild(tg); } else td.textContent = c.fmt ? c.fmt(v, r) : (v == null ? '—' : v); tr.appendChild(td); }); if (spec.onClick) { tr.style.cursor = 'pointer'; tr.addEventListener('click', () => spec.onClick(r)); } tb.appendChild(tr); });
    if (!rows.length) { const tr = H('tr'); const td = H('td', 'muted', spec.emptyText || 'No rows.'); td.colSpan = spec.cols.length; tr.appendChild(td); tb.appendChild(tr); }
    t.appendChild(tb); if (spec.limit && spec.rows.length > spec.limit) { const tf = H('tfoot'); const tr = H('tr'); const td = H('td', null, `${spec.rows.length - spec.limit} more rows — the table twin and the download hold every one.`); td.colSpan = spec.cols.length; tr.appendChild(td); tf.appendChild(tr); t.appendChild(tf); } else if (spec.foot) { const tf = H('tfoot'); const tr = H('tr'); const td = H('td', null, spec.foot); td.colSpan = spec.cols.length; tr.appendChild(td); tf.appendChild(tr); t.appendChild(tf); }
    wrapEl.appendChild(t); return wrapEl;
  }

  /* ═══ STATS ═══ KPI tiles (label / value / sub / state / source on hover) */
  function stats(list) { const d = H('div', 'stats'); list.forEach(s => { const t = H('div', 'st' + (s.big ? ' big' : '') + (s.state ? ' ' + s.state : '')); t.appendChild(H('div', 'l', s.label)); const v = H('div', 'v'); v.appendChild(document.createTextNode(s.value ?? '—')); if (s.unit) v.appendChild(H('small', null, s.unit)); t.appendChild(v); if (s.sub) t.appendChild(H('div', 's', s.sub)); if (s.big) t.appendChild(H('i', 'dot')); if (s.src) t.appendChild(H('div', 'src', s.src)); d.appendChild(t); }); return d; }
  /* ═══ GATES ═══ */
  function gatesView(list) { const d = H('div', 'gates'); list.forEach(g => { const c = H('div', 'gate ' + (g.state || 'unknown')); c.appendChild(H('i')); const body = H('div'); body.style.flex = '1'; body.appendChild(H('b', null, g.label)); body.appendChild(H('span', null, g.value + (g.detail ? ' · ' + g.detail : ''))); c.appendChild(body); c.appendChild(H('span', 'word', { ok: 'clears', warn: 'review', bad: 'binds', unknown: 'unknown' }[g.state || 'unknown'])); d.appendChild(c); }); return d; }

  /* ═══ RAILS ═══ percentile rails */
  function rails(spec) { const d = H('div', 'rails'); spec.rows.forEach(r => { const row = H('div', 'rail-r'); row.appendChild(H('div', 'l', r.label)); const tr = H('div', 'tr'); const fill = H('i'); const p = r.pct == null ? 0 : Math.round(r.pct * 100); fill.style.width = p + '%'; fill.style.background = cv('--s1'); fill.style.backgroundImage = 'linear-gradient(90deg,rgba(255,255,255,.12),rgba(0,0,0,.10))'; tr.appendChild(fill); if (r.pct != null) { const b = H('b'); b.style.left = p + '%'; tr.appendChild(b); } row.appendChild(tr); row.appendChild(H('div', 'v', r.pct == null ? '—' : 'P' + p)); row.title = `${r.label} · P${p} of ${spec.n || '2,678'} buses${r.raw != null ? ' · ' + r.raw : ''}`; d.appendChild(row); }); const ax = H('div', 'rails-axis'); ['P0', 'P50', 'P100'].forEach(t => ax.appendChild(H('span', null, t))); d.appendChild(ax); return d; }

  /* ═══ REQ ═══ requirement bars met / not met / unknown */
  function req(spec) { const d = H('div', 'req'); spec.rows.forEach(r => { const row = H('div', 'req-r'); const b = H('b'); b.appendChild(document.createTextNode(r.label)); b.appendChild(H('em', null, r.threshold || '')); row.appendChild(b); const bar = H('div', 'bar'); const tot = (r.met || 0) + (r.unmet || 0) + (r.unknown || 0) || 1; [['met', r.met], ['unmet', r.unmet], ['unk', r.unknown]].forEach(([k, v]) => { if (!v) return; const i = H('i', k); i.style.width = (v / tot * 100) + '%'; bar.appendChild(i); }); row.appendChild(bar); row.appendChild(H('div', 'lg', `${num(r.met, 0)} met · ${num(r.unmet, 0)} not met · ${num(r.unknown || 0, 0)} unknown`)); row.addEventListener('mousemove', ev => Tip.show(ev, { h: r.label, rows: [['Met', num(r.met, 0), cv('--s1')], ['Not met', num(r.unmet, 0), cv('--over')], ['Unknown', num(r.unknown || 0, 0)]] })); row.addEventListener('mouseleave', Tip.hide); d.appendChild(row); }); return d; }

  /* ═══ TIMELINE ═══ stage rows */
  function timeline(spec) { const d = H('div', 'tl'); const max = Math.max(...spec.rows.map(r => r.value || 0), 1); spec.rows.forEach(r => { const row = H('div', 'tl-r'); row.appendChild(H('div', 'tl-n', r.label)); const b = H('div', 'tl-b'); const i = H('i'); i.style.width = ((r.value || 0) / max * 100) + '%'; if (r.color) i.style.background = r.color; b.appendChild(i); row.appendChild(b); row.appendChild(H('div', 'tl-v', r.text ?? fmtVal(r.value, spec.unit, spec.dp))); row.appendChild(H('div', 'tl-d', r.date || '')); row.title = r.title || ''; d.appendChild(row); }); if (spec.total) d.appendChild(H('div', 'w-cap', spec.total)); return d; }

  /* ═══ PILLS ═══ */
  function pills(spec) { const d = H('div', 'pills'); spec.rows.forEach(r => { const p = H('div', 'pill ' + (r.state || '')); p.appendChild(H('i')); p.appendChild(H('b', null, r.label)); p.appendChild(H('span', null, r.value ?? 'not published')); if (r.detail) p.title = r.detail; d.appendChild(p); }); return d; }

  /* ═══ BOX ═══ box plots */
  function box(spec) {
    // spec: {w,h, cats:[], boxes:[{p5,p25,p50,p75,p95,color}], unit, yLabel}
    const F = frame(spec, { l: 46 }); const all = []; spec.boxes.forEach(b => all.push(b.p5, b.p95)); const [lo, hi] = domain(all, { zero: false, pad: .1 }); const y = yAxis(F, lo, hi, spec.unit, null, spec.yLabel); const xc = xCat(F, spec.cats, { label: spec.xLabel }); const bw = Math.min(28, F.iw / spec.cats.length * .5);
    spec.boxes.forEach((b, i) => { const cx = xc(i), color = b.color || S(0); F.svg.appendChild(E('line', { x1: cx, y1: y(b.p5), x2: cx, y2: y(b.p95), stroke: color, 'stroke-width': 1.5 })); [b.p5, b.p95].forEach(v => F.svg.appendChild(E('line', { x1: cx - bw / 3, y1: y(v), x2: cx + bw / 3, y2: y(v), stroke: color, 'stroke-width': 1.5 }))); const r = E('rect', { x: cx - bw / 2, y: y(b.p75), width: bw, height: Math.max(1, y(b.p25) - y(b.p75)), fill: shade(F.svg, color, { from: .68, to: .44 }), rx: 3 }); F.svg.appendChild(r); F.svg.appendChild(E('line', { x1: cx - bw / 2, y1: y(b.p50), x2: cx + bw / 2, y2: y(b.p50), stroke: cv('--ink'), 'stroke-width': 2 })); if (spec.cats.length <= 6) F.svg.appendChild(E('text', { x: cx + bw / 2 + 4, y: y(b.p50) + 3, fill: cv('--ink-2'), 'font-size': 9.5, 'font-family': cv('--mono') }, fmtVal(b.p50, spec.unit, spec.dp))); const hit = E('rect', { x: cx - F.iw / spec.cats.length / 2, y: F.pad.t, width: F.iw / spec.cats.length, height: F.ih, fill: 'transparent' }); Tip.bind(hit, () => ({ h: spec.cats[i], rows: [['P95', fmtVal(b.p95, spec.unit, spec.dp)], ['P75', fmtVal(b.p75, spec.unit, spec.dp)], ['Median', fmtVal(b.p50, spec.unit, spec.dp)], ['P25', fmtVal(b.p25, spec.unit, spec.dp)], ['P5', fmtVal(b.p5, spec.unit, spec.dp)], ...(b.tip || [])], note: spec.note })); F.svg.appendChild(hit); });
    return wrap(F.svg, spec.key);
  }

  /* ═══ MAP ═══ nodes by lat/lon (no basemap; 2,678 dots draw New England themselves) */
  function map(spec) {
    // spec: {w,h, pts:[{lat,lon,id,label,hi,color,r,v}], bounds:{lat0,lat1,lon0,lon1}, legend}
    const w = spec.w || 600, h = spec.h || 320; const svg = E('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'plot' });
    const pts = (spec.pts || []).filter(p => p.lat != null && p.lon != null);
    const b = spec.bounds || { lat0: Math.min(...pts.map(p => p.lat)), lat1: Math.max(...pts.map(p => p.lat)), lon0: Math.min(...pts.map(p => p.lon)), lon1: Math.max(...pts.map(p => p.lon)) };
    const mid = (b.lat0 + b.lat1) / 2; const kx = Math.cos(mid * Math.PI / 180); const spanX = (b.lon1 - b.lon0) * kx, spanY = b.lat1 - b.lat0; const sc = Math.min((w - 24) / spanX, (h - 24) / spanY);
    const X = lon => 12 + ((lon - b.lon0) * kx) * sc + ((w - 24) - spanX * sc) / 2, Y = lat => h - 12 - (lat - b.lat0) * sc - ((h - 24) - spanY * sc) / 2;
    svg.appendChild(E('rect', { x: 0, y: 0, width: w, height: h, rx: 8, fill: cv('--sunk') }));
    const g = E('g'); pts.filter(p => !p.hi).forEach(p => g.appendChild(E('circle', { cx: X(p.lon), cy: Y(p.lat), r: p.r || 1.6, fill: p.color || cv('--ink-4'), opacity: p.opacity ?? .38 }))); svg.appendChild(g);
    pts.filter(p => p.hi).forEach((p, i) => { const c = E('circle', { cx: X(p.lon), cy: Y(p.lat), r: p.r || 6, fill: p.color || S(i), stroke: cv('--surface'), 'stroke-width': 2 }); svg.appendChild(c); if (p.label) svg.appendChild(E('text', { x: X(p.lon) + 9, y: Y(p.lat) + 3, fill: cv('--ink'), 'font-size': 10, 'font-weight': 600 }, p.label)); });
    if (spec.rings) spec.rings.forEach(r => { svg.appendChild(E('circle', { cx: X(r.lon), cy: Y(r.lat), r: (r.miles / 69) * sc, fill: 'none', stroke: cv('--accent'), 'stroke-dasharray': '3 3' })); });
    const hit = E('rect', { x: 0, y: 0, width: w, height: h, fill: 'transparent' }); Tip.bind(hit, ev => { const box = svg.getBoundingClientRect(); const mx = (ev.clientX - box.left) / box.width * w, my = (ev.clientY - box.top) / box.height * h; let best = null, bd = 144; pts.forEach(p => { const d = (X(p.lon) - mx) ** 2 + (Y(p.lat) - my) ** 2; if (d < bd) { bd = d; best = p; } }); if (!best) return null; return { h: best.label || String(best.id), rows: best.rows || [], note: best.note }; }); svg.appendChild(hit);
    if (spec.legend) svg.appendChild(E('text', { x: 10, y: h - 8, fill: cv('--ink-4'), 'font-size': 9, 'font-family': cv('--mono') }, spec.legend));
    return wrap(svg, spec.key);
  }

  /* ═══ DURATION ═══ convenience wrapper over line with % x axis */
  function duration(spec) { const n = spec.series[0].values.length; return line(Object.assign({ x: Array.from({ length: n }, (_, i) => i / (n - 1) * 100), xNumeric: true, xUnit: '%', xLabel: spec.xLabel || '% of hours, richest first', zero: false, seam: false }, spec, { series: spec.series.map(s => Object.assign({ markers: false }, s)) })); }


  /* ═══ BUSBAR ═══ the Band-0 site signature: one conductor, a tap per requirement */
  function busbar(spec) {
    // spec: {w, taps:[{label, value (text), unit, pos (0..1 position in the market, null=unknown), lo, hi, ref, refPos, met:true|false|null, basis}]}
    const taps = spec.taps || []; const w = spec.w || 900; const n = Math.max(1, taps.length); const colW = Math.min(230, (w - 24) / n); const totalW = colW * n; const x0 = (w - totalW) / 2; const h = 168;
    const svg = E('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, class: 'plot' });
    svg.appendChild(E('line', { x1: x0, y1: 22, x2: x0 + totalW, y2: 22, stroke: cv('--ink'), 'stroke-width': 3, 'stroke-linecap': 'round' }));
    taps.forEach((t, i) => { const cx = x0 + colW * i + colW / 2; const unknown = t.met == null; const color = unknown ? cv('--ink-4') : cv('--s1');
      svg.appendChild(E('line', { x1: cx, y1: 22, x2: cx, y2: 44, stroke: color, 'stroke-width': 2, 'stroke-dasharray': unknown ? '3 3' : null }));
      svg.appendChild(E('circle', { cx, cy: 22, r: 5, fill: unknown ? cv('--surface') : color, stroke: color, 'stroke-width': 2 }));
      svg.appendChild(E('text', { x: cx, y: 60, 'text-anchor': 'middle', fill: cv('--ink-3'), 'font-size': 10.5, 'font-weight': 600 }, t.label));
      svg.appendChild(E('text', { x: cx, y: 82, 'text-anchor': 'middle', fill: cv('--ink'), 'font-size': 17, 'font-weight': 700, 'font-family': cv('--mono') }, t.value == null ? '—' : String(t.value)));
      if (t.unit) svg.appendChild(E('text', { x: cx, y: 96, 'text-anchor': 'middle', fill: cv('--ink-3'), 'font-size': 10 }, t.unit));
      // position rail
      const rx = cx - colW / 2 + 14, rw = colW - 28, ry = 112;
      svg.appendChild(E('rect', { x: rx, y: ry, width: rw, height: 6, rx: 3, fill: cv('--sunk') }));
      if (t.refPos != null) svg.appendChild(E('line', { x1: rx + rw * Math.max(0, Math.min(1, t.refPos)), y1: ry - 4, x2: rx + rw * Math.max(0, Math.min(1, t.refPos)), y2: ry + 10, stroke: cv('--ink-3'), 'stroke-width': 1, 'stroke-dasharray': '2 2' }));
      if (t.pos != null) svg.appendChild(E('rect', { x: rx + rw * Math.max(0, Math.min(1, t.pos)) - 2, y: ry - 3, width: 4, height: 12, rx: 1.5, fill: cv('--ink') }));
      svg.appendChild(E('text', { x: cx, y: ry + 24, 'text-anchor': 'middle', fill: cv('--ink-3'), 'font-size': 9.5, 'font-family': cv('--mono') }, t.pos == null ? 'no value recorded' : `P${Math.round(t.pos * 100)} of ${t.n || '2,678'} · ${t.lo ?? ''}${t.lo != null ? ' – ' : ''}${t.hi ?? ''}`));
      svg.appendChild(E('text', { x: cx, y: ry + 38, 'text-anchor': 'middle', fill: cv('--ink-4'), 'font-size': 9.5 }, t.met == null ? 'unknown' : (t.met ? 'requirement met' : 'requirement not met') + (t.ref != null ? ` · ref ${t.ref}` : '')));
      const hit = E('rect', { x: cx - colW / 2, y: 10, width: colW, height: h - 10, fill: 'transparent' }); Tip.bind(hit, () => ({ h: t.label, rows: [['Value', String(t.value ?? '—') + (t.unit ? ' ' + t.unit : '')], ['Reference', t.ref != null ? String(t.ref) : '—'], ['Market position', t.pos == null ? 'no value' : 'P' + Math.round(t.pos * 100)], ['Requirement', t.met == null ? 'unknown' : t.met ? 'met' : 'not met']], note: t.basis })); svg.appendChild(hit); });
    return wrap(svg, spec.key);
  }

  /* ═══ EMPTY ═══ explained empty state */
  function empty(title, detail, why) { const d = H('div', 'w-empty'); d.appendChild(H('b', null, title)); if (detail) d.appendChild(H('p', null, detail)); if (why) d.appendChild(H('div', 'why', why)); return d; }

  return { Tip, E, H, esc, cv, S, niceTicks, fmtVal, fmtTick, bars, hbars, line, panels, scatter, heat, hist, waterfall, matrix, table, stats, gates: gatesView, rails, req, timeline, pills, box, map, duration, busbar, empty, legend };
})();

;
