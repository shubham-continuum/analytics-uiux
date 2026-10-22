// Interactive, dependency-free charts (v3). Views call a builder (barChart, lineChart, groupedBar, heatmap,
// gantt, stackedBar, areaChart, scatter, histogram, durationCurve), which returns a host <div> and registers
// the spec; mountCharts(root) then draws each chart at its real pixel width (so 11 px labels stay 11 px),
// adds a hover crosshair + tooltip, a Chart/Table toggle whose table is built from the SAME array the chart
// draws, and redraws on resize. sparkline() is inline SVG with no toggle.
// Nulls are skipped, never drawn as zero. Colours are the Studio series tokens (--s1…--s7) and the Studio
// sequential ramp (--h1…--h7); axis and label colours come from CSS (app.css .chart text / .axis).
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)'];
// Categorical hues in fixed order s1–s6 (validated, dark surface); never cycled: a 7th+ series folds into the grey
// 'other' slot s7, which fails the chroma floor on purpose and is reserved for reference / other.
const color = i => (i < 6 ? COLORS[i] : 'var(--s7)');
// Studio sequential ramp, dark -> bright on the dark ground (studio/src/styles.css --h1…--h7). Read live from CSS
// at draw time so a theme change follows; these are the fallback values.
const RAMP = ['#627083', '#6F829E', '#7C95BA', '#89A8D7', '#96BCF4', '#B1D0FD', '#D1E3FF'];
const H = 220;           // default plot height (px)
const TOP = 26;          // top band reserved for the Chart/Table toggle (and legends)
const REG = new Map();
const VIEW = new Map();  // remembered Chart/Table choice per chart title
let seq = 0;

export function resetCharts() { REG.clear(); seq = 0; }

function niceTicks(min, max, n = 4) {
  if (!ok(min) || !ok(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  // Ticks always bracket the data: first tick at or below min, last at or above max.
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
const scale = (d0, d1, r0, r1) => v => r0 + ((v - d0) / ((d1 - d0) || 1)) * (r1 - r0);
const empty = (msg = 'No values are held for this selection.') => `<div class="empty"><strong>Nothing to chart</strong>${esc(msg)}</div>`;
const minOf = a => a.reduce((m, v) => (v < m ? v : m), Infinity);
const maxOf = a => a.reduce((m, v) => (v > m ? v : m), -Infinity);

function host(id, spec) {
  const title = spec.opts.title || id, view = VIEW.get(title) || 'chart';
  return `<div class="chart-host" data-chart="${id}" data-type="${spec.type}" data-title="${esc(title)}">
    <div class="chart-tools"><div class="segmented seg-sm" role="group" aria-label="View"><button type="button" data-chart-view="chart" class="${view === 'chart' ? 'active' : ''}">Chart</button><button type="button" data-chart-view="table" class="${view === 'table' ? 'active' : ''}">Table</button></div></div>
    <div class="chart-canvas" style="min-height:${spec.opts.height}px" ${view === 'table' ? 'hidden' : ''} role="img" aria-label="${esc(title)}"></div>
    <div class="chart-table table-wrap" ${view === 'chart' ? 'hidden' : ''}>${table(spec)}</div>
    <div class="chart-tip" hidden></div></div>`;
}
function reg(type, data, opts, defaults) {
  const id = `c${++seq}`, spec = { type, ...data, opts: { fmt: v => v.toFixed(0), xfmt: v => String(v), ...defaults, ...opts } };
  if (!ok(spec.opts.height)) spec.opts.height = defaults.height ?? H;
  REG.set(id, spec); return host(id, spec);
}

// ---------- Builders ----------
/** Bars: items [{label, value, tone?, note?}]. */
export function barChart(items, opts = {}) {
  if (!items.some(i => ok(i.value))) return empty(opts.emptyText);
  return reg('bar', { items }, opts, {});
}
/** Lines: series [{name, points:[{x,y}], dashed?, color?}]. */
export function lineChart(series, opts = {}) {
  if (!series.some(s => s.points.some(p => ok(p.x) && ok(p.y)))) return empty(opts.emptyText);
  return reg('line', { series }, opts, {});
}
/** Grouped bars: groups [{label, values:[v per series]}], series names in opts.series. */
export function groupedBar(groups, opts = {}) {
  if (!groups.some(g => g.values.some(ok))) return empty(opts.emptyText);
  return reg('gbar', { groups }, opts, { series: [] });
}
/** Heatmap: rows [{label, cells:[{label, value}]}] (e.g. month × hour). */
export function heatmap(rows, opts = {}) {
  if (!rows.some(r => r.cells.some(c => ok(c.value)))) return empty(opts.emptyText);
  return reg('heat', { rows }, opts, { height: TOP + 28 + rows.length * 20 });
}
/** Gantt: tasks [{label, start (ms), end (ms)|null, note}] — null end = open-ended (drawn as a stub). */
export function gantt(tasks, opts = {}) {
  if (!tasks.length) return empty(opts.emptyText);
  return reg('gantt', { tasks }, opts, { height: TOP + 30 + tasks.length * 28 });
}
/** Stacked bars: groups [{label, values:[v per series]}], opts.series names. Negative parts stack below zero. */
export function stackedBar(groups, opts = {}) {
  if (!groups.some(g => g.values.some(ok))) return empty(opts.emptyText);
  return reg('stack', { groups }, opts, { series: [] });
}
/** Area: series [{name, points:[{x,y}]}]; opts.stacked stacks the series in order (a gap wherever a lower series is not held). */
export function areaChart(series, opts = {}) {
  if (!series.some(s => s.points.some(p => ok(p.x) && ok(p.y)))) return empty(opts.emptyText);
  return reg('area', { series }, opts, { stacked: false });
}
/** Scatter: points [{x, y, label, group}]; one colour per group. */
export function scatter(points, opts = {}) {
  if (!points.some(p => ok(p.x) && ok(p.y))) return empty(opts.emptyText);
  return reg('scatter', { points }, opts, {});
}
/** Histogram of raw values; opts.bins (default √n, 5…30). Non-finite values are counted as not held, never binned. */
export function histogram(values, opts = {}) {
  const held = values.filter(ok);
  if (!held.length) return empty(opts.emptyText);
  const bins = histogramBins(values, opts.bins || Math.min(30, Math.max(5, Math.ceil(Math.sqrt(held.length)))));
  return reg('hist', { bins, missing: values.length - held.length, n: held.length }, opts, {});
}
/** Duration curve: series [{name, values}] each sorted high → low against % of its held values. */
export function durationCurve(series, opts = {}) {
  const S = series.map(s => ({ name: s.name, values: durationValues(s.values) })).filter(s => s.values.length);
  if (!S.length) return empty(opts.emptyText);
  return reg('dur', { series: S }, opts, {});
}
/** Sparkline: inline SVG trend, no toggle, no axes. Gaps where a value is not held. */
export function sparkline(values, opts = {}) {
  const h = opts.height || 22, w = opts.width || 80, pts = values.map((v, i) => [i, v]).filter(([, v]) => ok(v));
  if (!pts.length) return '<span class="spark-nh muted">not held</span>';
  const lo = minOf(pts.map(p => p[1])), hi = maxOf(pts.map(p => p[1])), n = Math.max(1, values.length - 1);
  const x = i => (i / n) * 100, y = v => (hi === lo ? h / 2 : h - 2 - ((v - lo) / (hi - lo)) * (h - 4));
  let d = '', pen = false;
  values.forEach((v, i) => { if (!ok(v)) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`; pen = true; });
  if (pts.length === 1) d += `h0.01`;
  return `<svg class="spark" viewBox="0 0 100 ${h}" preserveAspectRatio="none" width="${w}" height="${h}" role="img" aria-label="trend ${esc(opts.fmt ? opts.fmt(pts[0][1]) : pts[0][1])} to ${esc(opts.fmt ? opts.fmt(pts.at(-1)[1]) : pts.at(-1)[1])}"><path d="${d}" style="stroke:${opts.color || 'var(--s1)'}" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Tornado: rows [{label, low, high, base, lowLabel?, highLabel?}] (result values at each driver's low / high case),
 *  drawn as horizontal bars from base, sorted by swing |high − low|. A row missing low or high is listed, not drawn. */
export function tornado(rows, opts = {}) {
  const R = tornadoRows(rows);
  if (!R.some(r => ok(r.low) || ok(r.high))) return empty(opts.emptyText);
  return reg('tornado', { rows: R }, opts, { height: TOP + 26 + R.length * 24 });
}

// ---------- Pure helpers (exported for tests and traces) ----------
/** Tornado rows with swing, sorted by swing high → low; rows with a swing not held go last. */
export function tornadoRows(rows) {
  return (rows || []).map(r => ({ ...r, swing: ok(r.low) && ok(r.high) ? Math.abs(r.high - r.low) : null }))
    .sort((a, b) => (ok(b.swing) ? b.swing : -1) - (ok(a.swing) ? a.swing : -1));
}
/** Equal-width bins from min to max of the finite values; the top edge is inclusive. */
export function histogramBins(values, bins = 10) {
  const v = values.filter(ok);
  if (!v.length) return [];
  const lo = minOf(v), hi = maxOf(v);
  if (lo === hi) return [{ lo, hi, count: v.length }];
  const k = Math.max(1, Math.floor(bins)), w = (hi - lo) / k;
  const out = Array.from({ length: k }, (_, i) => ({ lo: lo + i * w, hi: i === k - 1 ? hi : lo + (i + 1) * w, count: 0 }));
  for (const x of v) out[Math.min(k - 1, Math.floor((x - lo) / w))].count++;
  return out;
}
/** The finite values sorted high → low (a duration curve's y). */
export const durationValues = values => values.filter(ok).sort((a, b) => b - a);
const exceed = (i, n) => (n > 1 ? (i / (n - 1)) * 100 : 0);

// ---------- Tables built from the same arrays ----------
function sample(n, cap = 400) { const step = Math.ceil(n / cap); const idx = []; for (let i = 0; i < n; i += step) idx.push(i); if (idx.at(-1) !== n - 1) idx.push(n - 1); return idx; }
function table(spec) {
  const o = spec.opts, cell = v => (ok(v) ? esc(o.fmt(v)) : 'not held');
  const T = (hd, body, note = '') => `<table class="sortable dense"><thead><tr>${hd}</tr></thead><tbody>${body}</tbody></table>${note}`;
  if (spec.type === 'bar') return T(`<th>${esc(o.xLabel || 'Item')}</th><th class="num">${esc(o.yLabel || 'Value')}</th>`, spec.items.map(i => `<tr><td>${esc(i.label)}</td><td class="num">${cell(i.value)}</td></tr>`).join(''));
  if (spec.type === 'line' || spec.type === 'area') {
    const xs = [...new Set(spec.series.flatMap(s => s.points.filter(p => ok(p.x)).map(p => p.x)))].sort((a, b) => a - b);
    const cap = xs.length > 400 ? sample(xs.length).map(i => xs[i]) : xs;
    const at = (s, x) => s.points.find(p => p.x === x)?.y;
    return T(`<th>${esc(o.xLabel || 'X')}</th>${spec.series.map(s => `<th class="num">${esc(s.name)}</th>`).join('')}`, cap.map(x => `<tr><td>${esc(o.xfmt(x))}</td>${spec.series.map(s => `<td class="num">${cell(at(s, x))}</td>`).join('')}</tr>`).join(''), cap.length < xs.length ? `<p class="audit-note">Showing ${cap.length} of ${xs.length} points.</p>` : '');
  }
  if (spec.type === 'heat') return T(`<th></th>${spec.rows[0].cells.map(c => `<th class="num">${esc(c.label)}</th>`).join('')}`, spec.rows.map(r => `<tr><td>${esc(r.label)}</td>${r.cells.map(c => `<td class="num">${cell(c.value)}</td>`).join('')}</tr>`).join(''));
  if (spec.type === 'gbar') return T(`<th>${esc(o.xLabel || 'Group')}</th>${o.series.map(s => `<th class="num">${esc(s)}</th>`).join('')}`, spec.groups.map(g => `<tr><td>${esc(g.label)}</td>${g.values.map(v => `<td class="num">${cell(v)}</td>`).join('')}</tr>`).join(''));
  if (spec.type === 'stack') return T(`<th>${esc(o.xLabel || 'Group')}</th>${o.series.map(s => `<th class="num">${esc(s)}</th>`).join('')}<th class="num">Total</th>`, spec.groups.map(g => `<tr><td>${esc(g.label)}</td>${o.series.map((_, i) => `<td class="num">${cell(g.values[i])}</td>`).join('')}<td class="num">${cell(stackTotal(g.values, o.series.length))}</td></tr>`).join(''));
  if (spec.type === 'scatter') return T(`<th>Point</th><th>Group</th><th class="num">${esc(o.xLabel || 'X')}</th><th class="num">${esc(o.yLabel || 'Y')}</th>`, spec.points.map((p, i) => `<tr><td>${esc(p.label ?? i + 1)}</td><td>${esc(p.group ?? '')}</td><td class="num">${ok(p.x) ? esc(o.xfmt(p.x)) : 'not held'}</td><td class="num">${cell(p.y)}</td></tr>`).join(''));
  if (spec.type === 'hist') return T(`<th>${esc(o.xLabel || 'Range')}</th><th class="num">Count</th><th class="num">Share</th>`, spec.bins.map((b, i) => `<tr><td>${esc(o.fmt(b.lo))} to ${i === spec.bins.length - 1 ? '≤ ' : '< '}${esc(o.fmt(b.hi))}</td><td class="num">${b.count}</td><td class="num">${((b.count / spec.n) * 100).toFixed(1)}%</td></tr>`).join(''), `<p class="audit-note">${spec.n.toLocaleString('en-US')} values binned${spec.missing ? `; ${spec.missing} values not held (not counted)` : ''}.</p>`);
  if (spec.type === 'dur') {
    const n = maxOf(spec.series.map(s => s.values.length)), one = spec.series.length === 1, idx = n > 400 ? sample(n) : [...Array(n).keys()];
    return T(`<th class="num">Rank</th>${spec.series.map(s => `<th class="num">${esc(s.name)}</th>`).join('')}${one ? '<th class="num">% of values at or above</th>' : ''}`, idx.map(i => `<tr><td class="num">${i + 1}</td>${spec.series.map(s => `<td class="num">${cell(s.values[i])}</td>`).join('')}${one ? `<td class="num">${(((i + 1) / n) * 100).toFixed(1)}%</td>` : ''}</tr>`).join(''), idx.length < n ? `<p class="audit-note">Showing ${idx.length} of ${n} ranks.</p>` : '');
  }
  if (spec.type === 'tornado') return T(`<th>${esc(o.xLabel || 'Driver')}</th><th class="num">Low</th><th class="num">High</th><th class="num">Base</th><th class="num">Swing</th>`, spec.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${cell(r.low)}</td><td class="num">${cell(r.high)}</td><td class="num">${cell(r.base)}</td><td class="num">${cell(r.swing)}</td></tr>`).join(''));
  if (spec.type === 'gantt') return T('<th>Step</th><th>From</th><th>To</th><th>Note</th>', spec.tasks.map(t => `<tr><td>${esc(t.label)}</td><td>${new Date(t.start).toISOString().slice(0, 10)}</td><td>${t.end ? new Date(t.end).toISOString().slice(0, 10) : 'open'}</td><td class="wrap">${esc(t.note || '')}</td></tr>`).join(''));
  return '';
}
/** A stack's total is only printed when every part is held; a partial sum would read as the whole. */
function stackTotal(values, n) { const v = Array.from({ length: n }, (_, i) => values[i]); return v.every(ok) ? v.reduce((s, x) => s + x, 0) : null; }

// ---------- Shared drawing pieces ----------
/** Legend chips laid out left to right, wrapping before the Chart/Table toggle; returns svg + its height. */
function legend(names, W, colors = color) {
  let x = 58, y = 4, svg = '';
  const lim = W - 130;
  names.forEach((s, i) => {
    const w = 18 + String(s).length * 6.3 + 14;
    if (x + w > lim && x > 58) { x = 58; y += 16; }
    svg += `<rect x="${x}" y="${y}" width="10" height="10" rx="2" style="fill:${colors(i)}"/><text x="${x + 15}" y="${y + 9}">${esc(s)}</text>`;
    x += w;
  });
  return { svg: `<g class="glegend">${svg}</g>`, h: names.length ? y + 16 : 0 };
}
function yAxis(ticks, y, W, M, fmt) { return ticks.map(t => `<line class="axis" x1="${M.l}" x2="${W - M.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${M.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmt(t))}</text>`).join(''); }
const dot = c => `<span style="color:${c}">●</span>`;

// ---------- Drawing at real width ----------
function drawBar(spec, W, Hh) {
  const M = { l: 58, r: 12, t: TOP, b: 30 }, it = spec.items, o = spec.opts;
  const vals = it.map(i => i.value).filter(ok), lo = Math.min(0, minOf(vals)), hi = Math.max(0, maxOf(vals)), ticks = niceTicks(lo, hi);
  const y = scale(Math.min(lo, ticks[0] ?? lo), Math.max(hi, ticks.at(-1) ?? hi), Hh - M.b, M.t), zero = y(0);
  const bw = (W - M.l - M.r) / it.length, hits = [];
  let svg = yAxis(ticks, y, W, M, o.fmt) + `<line class="axis zero" x1="${M.l}" x2="${W - M.r}" y1="${zero}" y2="${zero}"/>`;
  const every = Math.max(1, Math.ceil(it.length / Math.max(1, Math.floor((W - M.l) / 64))));
  it.forEach((d, i) => {
    const x = M.l + i * bw + bw * 0.16, w = Math.max(2, bw * 0.68);
    if (i % every === 0) svg += `<text x="${x + w / 2}" y="${Hh - 10}" text-anchor="middle">${esc(d.label)}</text>`;
    if (!ok(d.value)) { svg += `<text x="${x + w / 2}" y="${zero - 6}" text-anchor="middle" class="muted-t">not held</text>`; return; }
    const top = Math.min(y(d.value), zero), h = Math.max(1, Math.abs(y(d.value) - zero));
    svg += `<rect class="bar ${d.value < 0 || d.tone === 'negative' ? 'negative' : ''}" data-i="${i}" x="${x}" y="${top}" width="${w}" height="${h}" rx="2"/>`;
    hits.push({ x0: M.l + i * bw, x1: M.l + (i + 1) * bw, i });
  });
  return { svg, hover: px => { const h = hits.find(z => px >= z.x0 && px < z.x1); if (!h) return null; const d = it[h.i]; return { x: (h.x0 + h.x1) / 2, html: `<b>${esc(d.label)}</b><br>${esc(o.fmt(d.value))}${d.note ? `<br><span>${esc(d.note)}</span>` : ''}` }; } };
}

function drawLine(spec, W, Hh) {
  const M = { l: 58, r: 16, t: TOP, b: 28 }, o = spec.opts;
  let series = spec.series;
  if (ok(o.yMax)) series = series.map(s => ({ ...s, points: s.points.map(p => (ok(p.y) && p.y > o.yMax ? { ...p, y: o.yMax } : p)) }));
  const pts = series.flatMap(s => s.points).filter(p => ok(p.x) && ok(p.y));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y), yt = niceTicks(minOf(ys), maxOf(ys));
  const x = scale(minOf(xs), maxOf(xs), M.l, W - M.r), y = scale(yt[0], yt.at(-1), Hh - M.b, M.t);
  const xt = o.xTicks ?? niceTicks(minOf(xs), maxOf(xs), Math.max(3, Math.floor(W / 120)));
  let svg = yAxis(yt, y, W, M, o.fmt);
  svg += xt.map(t => `<text x="${x(t)}" y="${Hh - 8}" text-anchor="middle">${esc(o.xfmt(t))}</text>`).join('');
  series.forEach((s, i) => {
    let d = '', pen = false;
    for (const p of s.points) { if (!ok(p.x) || !ok(p.y)) { pen = false; continue; } d += `${pen ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`; pen = true; }
    const c = s.color || color(i);
    svg += `<path class="line ${s.dashed ? 'dashed' : ''}" d="${d}" style="stroke:${c}"/>`;
  });
  // Direct labels (dataviz: 2–4 series only; text in ink, the swatch carries the identity), spaced so they never overlap.
  if (series.length > 1 && series.length <= 4) {
    const ends = series.map((s, i) => { const last = s.points.filter(p => ok(p.x) && ok(p.y)).at(-1); return last ? { y: y(last.y) - 6, name: s.name, c: s.color || color(i) } : null; }).filter(Boolean);
    for (const l of placeLabels(ends, M.t + 8, Hh - M.b - 2, 12)) svg += `<rect x="${W - M.r - 4 - Math.min(140, l.name.length * 6.2) - 12}" y="${(l.ly - 6).toFixed(1)}" width="9" height="3" rx="1.5" style="fill:${l.c}"/><text class="dlabel" x="${W - M.r - 4}" y="${l.ly.toFixed(1)}" text-anchor="end">${esc(l.name)}</text>`;
  }
  const xsU = [...new Set(xs)].sort((a, b) => a - b);
  return { svg, hover: px => {
    let best = null, bd = Infinity; for (const v of xsU) { const dd = Math.abs(x(v) - px); if (dd < bd) { bd = dd; best = v; } }
    if (best == null) return null;
    const rows = series.map((s, i) => { const p = s.points.find(q => q.x === best); return `${dot(s.color || color(i))} ${esc(s.name)}: ${ok(p?.y) ? esc(o.fmt(p.y)) : 'not held'}`; }).join('<br>');
    return { x: x(best), html: `<b>${esc(o.xfmt(best))}</b><br>${rows}`, dots: series.map((s, i) => { const p = s.points.find(q => q.x === best); return ok(p?.y) ? { cy: y(p.y), c: s.color || color(i) } : null; }).filter(Boolean) };
  } };
}

function rampColors() {
  try { const cs = getComputedStyle(document.documentElement); const r = RAMP.map((f, i) => cs.getPropertyValue(`--h${i + 1}`).trim() || f); return r; } catch { return RAMP; }
}
const hex = h => { const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(h); return m ? m.slice(1).map(x => parseInt(x, 16)) : null; };
function rampAt(ramp, t) {
  const c = ramp.map(hex); if (c.some(x => !x)) return ramp[Math.round(t * (ramp.length - 1))];
  const f = Math.max(0, Math.min(1, t)) * (c.length - 1), i = Math.min(c.length - 2, Math.floor(f)), k = f - i;
  return `rgb(${c[i].map((v, j) => Math.round(v + (c[i + 1][j] - v) * k)).join(',')})`;
}
function drawHeat(spec, W, Hh) {
  const o = spec.opts, rows = spec.rows, M = { l: 44, r: 8, t: TOP, b: 22 };
  const vals = rows.flatMap(r => r.cells.map(c => c.value)).filter(ok), lo = minOf(vals), hi = maxOf(vals), ramp = rampColors();
  const cw = (W - M.l - M.r) / rows[0].cells.length, ch = (Hh - M.t - M.b) / rows.length;
  const col = v => rampAt(ramp, (v - lo) / ((hi - lo) || 1));
  let svg = '';
  rows.forEach((r, ri) => {
    svg += `<text x="${M.l - 6}" y="${M.t + ri * ch + ch / 2 + 4}" text-anchor="end">${esc(r.label)}</text>`;
    r.cells.forEach((c, ci) => { svg += ok(c.value) ? `<rect x="${M.l + ci * cw}" y="${M.t + ri * ch}" width="${Math.max(0.5, cw - 1)}" height="${Math.max(0.5, ch - 1)}" style="fill:${col(c.value)}"/>` : `<rect x="${M.l + ci * cw}" y="${M.t + ri * ch}" width="${Math.max(0.5, cw - 1)}" height="${Math.max(0.5, ch - 1)}" class="nh-cell"/>`; });
  });
  const every = Math.max(1, Math.ceil(rows[0].cells.length / Math.max(1, Math.floor((W - M.l) / 34))));
  rows[0].cells.forEach((c, ci) => { if (ci % every === 0) svg += `<text x="${M.l + ci * cw + cw / 2}" y="${Hh - 7}" text-anchor="middle">${esc(c.label)}</text>`; });
  return { svg, legend: `<div class="heat-legend"><span>${esc(o.fmt(lo))}</span><i style="background:linear-gradient(90deg,${ramp.join(',')})"></i><span>${esc(o.fmt(hi))}</span><span class="nh-key"><b></b>not held</span></div>`, hover: (px, py) => {
    const ci = Math.floor((px - M.l) / cw), ri = Math.floor((py - M.t) / ch);
    const r = rows[ri], c = r?.cells[ci]; if (!c) return null;
    return { x: M.l + ci * cw + cw / 2, y: M.t + ri * ch, html: `<b>${esc(r.label)} · ${esc(c.label)}</b><br>${ok(c.value) ? esc(o.fmt(c.value)) : 'not held'}` };
  } };
}

function wrapLabel(s, gw) { const w = String(s).split(' '), a = [], lim = Math.max(6, Math.floor(gw / 6.2)); let cur = ''; for (const x of w) { if ((cur + ' ' + x).trim().length > lim && cur) { a.push(cur); cur = x; } else cur = (cur + ' ' + x).trim(); } if (cur) a.push(cur); return a.slice(0, 2); }

function drawGBar(spec, W, Hh) {
  const o = spec.opts, G = spec.groups, n = Math.max(1, o.series.length), lg = legend(o.series, W), M = { l: 58, r: 12, t: Math.max(TOP, lg.h + 8), b: 36 };
  const vals = G.flatMap(g => g.values).filter(ok), ticks = niceTicks(Math.min(0, minOf(vals)), Math.max(0, maxOf(vals)));
  const y = scale(ticks[0], ticks.at(-1), Hh - M.b, M.t), zero = y(0), gw = (W - M.l - M.r) / G.length, bw = Math.max(2, (gw * 0.76) / n);
  let svg = yAxis(ticks, y, W, M, o.fmt) + lg.svg;
  G.forEach((g, gi) => {
    const x0 = M.l + gi * gw + gw * 0.12;
    wrapLabel(g.label, gw).forEach((ln, li) => { svg += `<text x="${M.l + gi * gw + gw / 2}" y="${Hh - 22 + li * 12}" text-anchor="middle" ${g.highlight ? 'style="font-weight:700;fill:var(--ink)"' : ''}>${esc(ln)}</text>`; });
    g.values.forEach((v, si) => { if (!ok(v)) return; const top = Math.min(y(v), zero), h = Math.max(1, Math.abs(y(v) - zero)); svg += `<rect x="${x0 + si * bw}" y="${top}" width="${Math.max(1, bw - 2)}" height="${h}" rx="2" style="fill:${color(si)}"/>`; });
  });
  return { svg, hover: px => { const gi = Math.floor((px - M.l) / gw), g = G[gi]; if (!g) return null; return { x: M.l + gi * gw + gw / 2, html: `<b>${esc(g.label)}</b><br>${o.series.map((s, i) => `${dot(color(i))} ${esc(s)}: ${ok(g.values[i]) ? esc(o.fmt(g.values[i])) : 'not held'}`).join('<br>')}` }; } };
}

function drawStack(spec, W, Hh) {
  const o = spec.opts, G = spec.groups, S = o.series, lg = legend(S, W), M = { l: 58, r: 12, t: Math.max(TOP, lg.h + 8), b: 36 };
  const pos = G.map(g => g.values.reduce((s, v) => s + (ok(v) && v > 0 ? v : 0), 0)), neg = G.map(g => g.values.reduce((s, v) => s + (ok(v) && v < 0 ? v : 0), 0));
  const ticks = niceTicks(Math.min(0, minOf(neg)), Math.max(0, maxOf(pos)));
  const y = scale(ticks[0], ticks.at(-1), Hh - M.b, M.t), zero = y(0), gw = (W - M.l - M.r) / G.length, bw = Math.max(2, gw * 0.62);
  let svg = yAxis(ticks, y, W, M, o.fmt) + `<line class="axis zero" x1="${M.l}" x2="${W - M.r}" y1="${zero}" y2="${zero}"/>` + lg.svg;
  const every = Math.max(1, Math.ceil(G.length / Math.max(1, Math.floor((W - M.l) / 56))));
  G.forEach((g, gi) => {
    const x0 = M.l + gi * gw + (gw - bw) / 2; let up = 0, dn = 0;
    if (gi % every === 0) wrapLabel(g.label, gw * every).forEach((ln, li) => { svg += `<text x="${M.l + gi * gw + gw / 2}" y="${Hh - 22 + li * 12}" text-anchor="middle">${esc(ln)}</text>`; });
    if (!g.values.some(ok)) { svg += `<text x="${x0 + bw / 2}" y="${zero - 6}" text-anchor="middle" class="muted-t">not held</text>`; return; }
    g.values.forEach((v, si) => {
      if (!ok(v) || v === 0) return;
      const a = v > 0 ? up : dn, b = a + v; if (v > 0) up = b; else dn = b;
      const top = Math.min(y(a), y(b)), h = Math.max(1, Math.abs(y(b) - y(a)));
      svg += `<rect x="${x0}" y="${top}" width="${bw}" height="${h}" style="fill:${color(si)};stroke:var(--surface);stroke-width:1"/>`; // 2px surface gap between stacked segments
    });
  });
  return { svg, hover: px => { const gi = Math.floor((px - M.l) / gw), g = G[gi]; if (!g) return null; const t = stackTotal(g.values, S.length); return { x: M.l + gi * gw + gw / 2, html: `<b>${esc(g.label)}</b><br>${S.map((s, i) => `${dot(color(i))} ${esc(s)}: ${ok(g.values[i]) ? esc(o.fmt(g.values[i])) : 'not held'}`).join('<br>')}<br><span>Total: ${ok(t) ? esc(o.fmt(t)) : 'not held (a part is missing)'}</span>` }; } };
}

function drawArea(spec, W, Hh) {
  const o = spec.opts, S = spec.series, lg = S.length > 1 ? legend(S.map(s => s.name), W) : { svg: '', h: 0 }, M = { l: 58, r: 16, t: Math.max(TOP, lg.h + 8), b: 28 };
  const xs = [...new Set(S.flatMap(s => s.points.filter(p => ok(p.x)).map(p => p.x)))].sort((a, b) => a - b);
  const at = (s, xv) => s.points.find(p => p.x === xv)?.y;
  // bands[i][k] = [lower, upper] at xs[k], or null (a gap)
  const bands = S.map(() => []);
  xs.forEach((xv, k) => {
    let cum = 0, broken = false;
    S.forEach((s, i) => {
      const v = at(s, xv);
      if (!o.stacked) { bands[i][k] = ok(v) ? [0, v] : null; return; }
      if (broken || !ok(v)) { broken = true; bands[i][k] = null; return; }
      bands[i][k] = [cum, cum + v]; cum += v;
    });
  });
  const all = bands.flat().filter(Boolean).flat(), yt = niceTicks(Math.min(0, minOf(all)), Math.max(0, maxOf(all)));
  const x = scale(xs[0], xs.at(-1), M.l, W - M.r), y = scale(yt[0], yt.at(-1), Hh - M.b, M.t);
  const xt = o.xTicks ?? niceTicks(xs[0], xs.at(-1), Math.max(3, Math.floor(W / 120)));
  let svg = yAxis(yt, y, W, M, o.fmt) + xt.map(t => `<text x="${x(t)}" y="${Hh - 8}" text-anchor="middle">${esc(o.xfmt(t))}</text>`).join('') + lg.svg;
  S.forEach((s, i) => {
    const c = s.color || color(i);
    let run = [];
    const flush = () => {
      if (!run.length) return;
      const upper = run.map(k => `${x(xs[k]).toFixed(1)},${y(bands[i][k][1]).toFixed(1)}`), lower = run.slice().reverse().map(k => `${x(xs[k]).toFixed(1)},${y(bands[i][k][0]).toFixed(1)}`);
      svg += `<path d="M${upper.join('L')}L${lower.join('L')}Z" style="fill:${c};fill-opacity:${o.stacked ? 0.55 : 0.16}"/><path class="line" d="M${upper.join('L')}" style="stroke:${c};stroke-width:2"/>`;
      run = [];
    };
    xs.forEach((_, k) => { if (bands[i][k]) run.push(k); else flush(); });
    flush();
  });
  return { svg, hover: px => {
    let best = null, bd = Infinity; xs.forEach((v, k) => { const dd = Math.abs(x(v) - px); if (dd < bd) { bd = dd; best = k; } });
    if (best == null) return null;
    const rows = S.map((s, i) => { const v = at(s, xs[best]); return `${dot(s.color || color(i))} ${esc(s.name)}: ${ok(v) ? esc(o.fmt(v)) : 'not held'}`; }).join('<br>');
    const tot = o.stacked && S.length > 1 ? stackTotal(S.map(s => at(s, xs[best])), S.length) : null;
    return { x: x(xs[best]), html: `<b>${esc(o.xfmt(xs[best]))}</b><br>${rows}${o.stacked && S.length > 1 ? `<br><span>Total: ${ok(tot) ? esc(o.fmt(tot)) : 'not held'}</span>` : ''}`, dots: S.map((s, i) => (bands[i][best] ? { cy: y(bands[i][best][1]), c: s.color || color(i) } : null)).filter(Boolean) };
  } };
}

function drawScatter(spec, W, Hh) {
  const o = spec.opts, P = spec.points.filter(p => ok(p.x) && ok(p.y));
  const groups = [...new Set(P.map(p => p.group ?? ''))], named = groups.filter(g => g !== '');
  const lg = named.length > 1 ? legend(groups.map(g => g || 'other'), W) : { svg: '', h: 0 };
  const M = { l: 64, r: 16, t: Math.max(TOP, lg.h + 8), b: o.xLabel ? 42 : 28 };
  const xt = niceTicks(minOf(P.map(p => p.x)), maxOf(P.map(p => p.x)), Math.max(3, Math.floor(W / 120))), yt = niceTicks(minOf(P.map(p => p.y)), maxOf(P.map(p => p.y)));
  const x = scale(xt[0], xt.at(-1), M.l, W - M.r), y = scale(yt[0], yt.at(-1), Hh - M.b, M.t);
  let svg = yAxis(yt, y, W, M, o.fmt) + xt.map(t => `<line class="axis" x1="${x(t)}" x2="${x(t)}" y1="${M.t}" y2="${Hh - M.b}"/><text x="${x(t)}" y="${Hh - M.b + 16}" text-anchor="middle">${esc(o.xfmt(t))}</text>`).join('') + lg.svg;
  if (o.xLabel) svg += `<text x="${(M.l + W - M.r) / 2}" y="${Hh - 6}" text-anchor="middle" class="muted-t">${esc(o.xLabel)}</text>`;
  if (o.yLabel) svg += `<text transform="translate(12 ${(M.t + Hh - M.b) / 2}) rotate(-90)" text-anchor="middle" class="muted-t">${esc(o.yLabel)}</text>`;
  const cOf = p => color(groups.indexOf(p.group ?? ''));
  svg += P.map(p => `<circle cx="${x(p.x).toFixed(1)}" cy="${y(p.y).toFixed(1)}" r="3.5" style="fill:${cOf(p)};fill-opacity:.8"/>`).join('');
  return { svg, hover: (px, py) => {
    let best = null, bd = 400; for (const p of P) { const d = (x(p.x) - px) ** 2 + (y(p.y) - py) ** 2; if (d < bd) { bd = d; best = p; } }
    if (!best) return null;
    return { x: x(best.x), y: y(best.y), html: `<b>${esc(best.label ?? '')}</b>${best.group ? ` <span>${esc(best.group)}</span>` : ''}<br>${esc(o.xLabel || 'x')}: ${esc(o.xfmt(best.x))}<br>${esc(o.yLabel || 'y')}: ${esc(o.fmt(best.y))}`, dots: [{ cx: x(best.x), cy: y(best.y), c: cOf(best) }] };
  } };
}

function drawHist(spec, W, Hh) {
  const o = spec.opts, B = spec.bins, M = { l: 50, r: 12, t: TOP, b: 28 };
  const yt = niceTicks(0, maxOf(B.map(b => b.count)));
  const y = scale(0, yt.at(-1), Hh - M.b, M.t), bw = (W - M.l - M.r) / B.length;
  let svg = yAxis(yt, y, W, M, v => String(Math.round(v)));
  const every = Math.max(1, Math.ceil((B.length + 1) / Math.max(2, Math.floor((W - M.l) / 60))));
  B.forEach((b, i) => {
    if (b.count) svg += `<rect class="bar" x="${M.l + i * bw + 0.5}" y="${y(b.count)}" width="${Math.max(1, bw - 1)}" height="${Math.max(1, y(0) - y(b.count))}"/>`;
    if (i % every === 0) svg += `<text x="${M.l + i * bw}" y="${Hh - 8}" text-anchor="middle">${esc(o.fmt(b.lo))}</text>`;
  });
  if (B.length % every === 0) svg += `<text x="${W - M.r}" y="${Hh - 8}" text-anchor="end">${esc(o.fmt(B.at(-1).hi))}</text>`;
  if (spec.missing) svg += `<text x="${W - M.r}" y="${M.t + 10}" text-anchor="end" class="muted-t">${spec.missing} not held</text>`;
  return { svg, hover: px => { const i = Math.floor((px - M.l) / bw), b = B[i]; if (!b) return null; return { x: M.l + (i + 0.5) * bw, html: `<b>${esc(o.fmt(b.lo))} to ${esc(o.fmt(b.hi))}</b><br>${b.count.toLocaleString('en-US')} values · ${((b.count / spec.n) * 100).toFixed(1)}%` }; } };
}

function drawDur(spec, W, Hh) {
  const o = spec.opts, S = spec.series, lg = S.length > 1 ? legend(S.map(s => s.name), W) : { svg: '', h: 0 }, M = { l: 58, r: 16, t: Math.max(TOP, lg.h + 8), b: 28 };
  const all = S.flatMap(s => s.values), yt = niceTicks(minOf(all), maxOf(all));
  const x = scale(0, 100, M.l, W - M.r), y = scale(yt[0], yt.at(-1), Hh - M.b, M.t);
  let svg = yAxis(yt, y, W, M, o.fmt) + [0, 25, 50, 75, 100].map(t => `<text x="${x(t)}" y="${Hh - 8}" text-anchor="middle">${t}%</text>`).join('') + lg.svg;
  if (yt[0] < 0 && yt.at(-1) > 0) svg += `<line class="axis zero" x1="${M.l}" x2="${W - M.r}" y1="${y(0)}" y2="${y(0)}"/>`;
  S.forEach((s, i) => {
    const n = s.values.length, step = Math.max(1, Math.floor(n / (W * 2)));
    let d = '';
    for (let k = 0; k < n; k += step) d += `${k ? 'L' : 'M'}${x(exceed(k, n)).toFixed(1)},${y(s.values[k]).toFixed(1)}`;
    d += `L${x(exceed(n - 1, n)).toFixed(1)},${y(s.values[n - 1]).toFixed(1)}`;
    svg += `<path class="line" d="${d}" style="stroke:${color(i)}"/>`;
  });
  return { svg, hover: px => {
    const pct = Math.max(0, Math.min(100, ((px - M.l) / ((W - M.r - M.l) || 1)) * 100));
    const hits = S.map(s => { const n = s.values.length, k = n > 1 ? Math.round((pct / 100) * (n - 1)) : 0; return { v: s.values[k], k, n }; });
    return { x: x(pct), html: `<b>${pct.toFixed(0)}% of values at or above</b><br>${S.map((s, i) => `${dot(color(i))} ${esc(s.name)}: ${esc(o.fmt(hits[i].v))} <span>(rank ${hits[i].k + 1} of ${hits[i].n})</span>`).join('<br>')}`, dots: hits.map((h, i) => ({ cy: y(h.v), c: color(i) })) };
  } };
}

function drawGantt(spec, W, Hh) {
  const t = spec.tasks, M = { l: Math.min(190, Math.max(110, W * 0.3)), r: 16, t: TOP, b: 24 };
  const starts = t.map(k => k.start), ends = t.map(k => k.end ?? k.start);
  const lo = minOf(starts), hi0 = Math.max(maxOf(ends), lo + 30 * 864e5), hi = t.some(k => !k.end) ? hi0 + (hi0 - lo) * 0.16 : hi0;
  const x = scale(lo, hi, M.l, W - M.r), rh = (Hh - M.t - M.b) / t.length;
  let svg = '';
  const months = []; { const d = new Date(lo); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1); for (; d.getTime() <= hi; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.getTime()); }
  const step = Math.max(1, Math.ceil(months.length / Math.max(3, Math.floor((W - M.l) / 90))));
  svg += months.filter((_, i) => i % step === 0).map(v => `<line class="axis" x1="${x(v)}" x2="${x(v)}" y1="${M.t}" y2="${Hh - M.b}"/><text x="${x(v)}" y="${Hh - 7}" text-anchor="middle">${new Date(v).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}</text>`).join('');
  t.forEach((k, i) => {
    const yy = M.t + i * rh;
    svg += `<text x="${M.l - 8}" y="${yy + rh / 2 + 4}" text-anchor="end">${esc(k.label)}</text>`;
    svg += k.end ? `<rect class="bar" x="${x(k.start)}" y="${yy + rh * 0.2}" width="${Math.max(3, x(k.end) - x(k.start))}" height="${rh * 0.6}" rx="3"/>` : `<rect class="bar open" x="${x(k.start)}" y="${yy + rh * 0.2}" width="14" height="${rh * 0.6}" rx="3"/><text x="${x(k.start) + 20}" y="${yy + rh / 2 + 4}" class="muted-t">length not held</text>`;
  });
  return { svg, hover: (px, py) => { const i = Math.floor((py - M.t) / rh), k = t[i]; if (!k) return null; return { x: px, y: M.t + i * rh, html: `<b>${esc(k.label)}</b><br>${new Date(k.start).toISOString().slice(0, 10)} → ${k.end ? new Date(k.end).toISOString().slice(0, 10) : 'open'}${k.note ? `<br>${esc(k.note)}` : ''}` }; } };
}

function drawTornado(spec, W, Hh) {
  const o = spec.opts, R = spec.rows, lab = Math.min(200, Math.max(90, W * 0.26)), M = { l: lab, r: 16, t: TOP, b: 22 };
  const vals = R.flatMap(r => [r.low, r.high, r.base]).filter(ok), xt = niceTicks(minOf(vals), maxOf(vals), Math.max(3, Math.floor((W - lab) / 110)));
  const x = scale(xt[0], xt.at(-1), M.l, W - M.r), rh = (Hh - M.t - M.b) / R.length;
  let svg = xt.map(t => `<line class="axis" x1="${x(t)}" x2="${x(t)}" y1="${M.t}" y2="${Hh - M.b}"/><text x="${x(t)}" y="${Hh - 7}" text-anchor="middle">${esc(o.fmt(t))}</text>`).join('');
  R.forEach((r, i) => {
    const yy = M.t + i * rh, bh = Math.max(4, rh * 0.62), by = yy + (rh - bh) / 2, b = ok(r.base) ? r.base : null;
    svg += `<text x="${M.l - 8}" y="${yy + rh / 2 + 4}" text-anchor="end">${esc(r.label)}</text>`;
    if (!ok(r.low) && !ok(r.high)) { svg += `<text x="${M.l + 4}" y="${yy + rh / 2 + 4}" class="muted-t">not held</text>`; return; }
    const seg = (v, cls) => { if (!ok(v)) return ''; const a = b ?? v, x0 = Math.min(x(a), x(v)), w = Math.max(1, Math.abs(x(v) - x(a))); return `<rect class="bar ${cls}" x="${x0}" y="${by}" width="${w}" height="${bh}" rx="1.5"/>`; };
    svg += seg(r.low, 'negative') + seg(r.high, '');
    if (!ok(r.low) || !ok(r.high)) svg += `<text x="${W - M.r}" y="${yy + rh / 2 + 4}" text-anchor="end" class="muted-t">${ok(r.low) ? 'high' : 'low'} not held</text>`;
  });
  const bases = [...new Set(R.map(r => r.base).filter(ok))];
  if (bases.length === 1) svg += `<line class="axis zero" x1="${x(bases[0])}" x2="${x(bases[0])}" y1="${M.t - 4}" y2="${Hh - M.b}"/>`;
  return { svg, hover: (px, py) => { const i = Math.floor((py - M.t) / rh), r = R[i]; if (!r) return null; const f = v => (ok(v) ? esc(o.fmt(v)) : 'not held'); return { x: px, y: M.t + i * rh, html: `<b>${esc(r.label)}</b><br>Low${r.lowLabel ? ` (${esc(r.lowLabel)})` : ''}: ${f(r.low)}<br>High${r.highLabel ? ` (${esc(r.highLabel)})` : ''}: ${f(r.high)}<br>Base: ${f(r.base)} · swing ${f(r.swing)}` }; } };
}

const DRAW = { tornado: drawTornado, bar: drawBar, gbar: drawGBar, line: drawLine, heat: drawHeat, gantt: drawGantt, stack: drawStack, area: drawArea, scatter: drawScatter, hist: drawHist, dur: drawDur };
const CROSS = new Set(['line', 'bar', 'gbar', 'stack', 'area', 'hist', 'dur']);

/** cw: the canvas width already read (mountCharts reads every chart's width before it writes any SVG). */
function draw(hostEl, cw) {
  const spec = REG.get(hostEl.dataset.chart); if (!spec) return;
  const canvas = hostEl.querySelector('.chart-canvas'); if (canvas.hidden) return;
  const raw = cw ?? Math.floor(canvas.clientWidth);
  hostEl._gsxCw = raw;
  const W = Math.max(260, raw), Hh = spec.opts.height || H;
  const r = DRAW[spec.type](spec, W, Hh);
  canvas.innerHTML = `<svg class="chart" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}">${r.svg}<line class="cross" x1="0" x2="0" y1="${TOP - 4}" y2="${Hh - 24}" visibility="hidden"/><g class="dots"></g></svg>${r.legend || ''}`;
  const svg = canvas.querySelector('svg'), tip = hostEl.querySelector('.chart-tip'), cross = svg.querySelector('.cross'), dots = svg.querySelector('.dots');
  const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; };
  const move = e => {
    const b = svg.getBoundingClientRect(), px = e.clientX - b.left, py = e.clientY - b.top, h = r.hover(px, py);
    if (!h) { hide(); return; }
    if (CROSS.has(spec.type)) { cross.setAttribute('x1', h.x); cross.setAttribute('x2', h.x); cross.setAttribute('visibility', 'visible'); }
    dots.innerHTML = (h.dots || []).map(d => `<circle cx="${d.cx ?? h.x}" cy="${d.cy}" r="4" style="fill:${d.c}"/>`).join('');
    tip.innerHTML = h.html; tip.hidden = false;
    const tw = tip.offsetWidth, left = Math.min(Math.max(0, h.x + 12), W - tw - 4);
    tip.style.left = `${left}px`; tip.style.top = `${Math.max(0, (h.y ?? py) - 10)}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', hide);
}

// Reads before writes: every chart's width is read in one pass (one layout), then every SVG is written. Reading each
// width right after the previous chart's write forced one full-page layout per chart, and the observer's first notice
// redrew every chart again (2026-10-14: ~10 s of forced layout over 15 actions). A resize redraws only the charts whose
// canvas width moved, again reading all widths before drawing any.
let RO = null, PENDING = new Set(), PEND_T = null;
const widthOf = h => { const c = h.querySelector('.chart-canvas'); return c && !c.hidden ? Math.floor(c.clientWidth) : null; };
function redrawMoved() {
  PEND_T = null;
  const hs = [...PENDING].filter(h => h.isConnected !== false); PENDING = new Set();
  const ws = hs.map(widthOf);
  hs.forEach((h, i) => { if (ws[i] != null && ws[i] !== h._gsxCw) draw(h, ws[i]); });
}
export function mountCharts(root) {
  RO?.disconnect(); clearTimeout(PEND_T); PEND_T = null; PENDING = new Set();
  RO = new ResizeObserver(entries => { for (const en of entries) PENDING.add(en.target); clearTimeout(PEND_T); PEND_T = setTimeout(redrawMoved, 80); });
  const hs = [...root.querySelectorAll('[data-chart]')], ws = hs.map(widthOf);
  hs.forEach((h, i) => { if (ws[i] != null) draw(h, ws[i]); RO.observe(h); });
}

/** Chart/Table toggle (delegated from the app root). Returns true when handled. */
export function handleChartToggle(el) {
  const btn = el.closest('[data-chart-view]'); if (!btn) return false;
  const h = btn.closest('[data-chart]'), view = btn.dataset.chartView;
  VIEW.set(h.dataset.title, view);
  h.querySelectorAll('[data-chart-view]').forEach(b => b.classList.toggle('active', b === btn));
  h.querySelector('.chart-canvas').hidden = view !== 'chart';
  h.querySelector('.chart-table').hidden = view !== 'table';
  if (view === 'chart') draw(h);
  return true;
}

// ---------- Percentile strip (the live Studio's "Requirements at bus") ----------
/** One requirement against the ISO population: mid-rank percentile, P5/P50/P95 of the held values, verdict. */
export function percentileRow(value, pop, ref, dir) {
  const held = (pop || []).filter(ok).sort((a, b) => a - b), n = held.length;
  const q = p => (n ? held[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))] : null);
  let pct = null;
  if (ok(value) && n) { let below = 0, eq = 0; for (const v of held) { if (v < value) below++; else if (v === value) eq++; } pct = (100 * (below + eq / 2)) / n; }
  const status = !ok(value) ? 'unknown' : !ok(ref) || !dir ? 'context' : (dir === 'ge' ? value >= ref : value <= ref) ? 'met' : 'not met';
  return { n, pct, p5: q(0.05), p50: q(0.5), p95: q(0.95), lo: n ? held[0] : null, hi: n ? held[n - 1] : null, status };
}
/**
 * rows: [{ label, unit, value, pop:number[], ref?, dir?:'ge'|'le', fmt? }] → one track per row: the population's P5–P95
 * band and median, the reference tick, the value's dot; the text names value, percentile, reference and verdict (never
 * colour alone). Scale per row = the population's 1st–99th range widened to include value and reference.
 */
export function percentileStrip(rows, opts = {}) {
  const W = 300;
  const body = rows.map(r => {
    const s = percentileRow(r.value, r.pop, r.ref, r.dir), f = r.fmt || (v => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : (+v).toFixed(Math.abs(v) < 10 ? 2 : 1)));
    const vals = [s.p5, s.p95, r.value, r.ref].filter(ok);
    const lo = vals.length ? Math.min(...vals) : 0, hi = vals.length ? Math.max(...vals) : 1, span = hi - lo || 1;
    const x = v => 8 + ((v - lo) / span) * (W - 16);
    const word = { met: 'Met', 'not met': 'Not met', unknown: 'Unknown', context: 'Context' }[s.status];
    const svg = `<svg class="ps-svg" viewBox="0 0 ${W} 22" preserveAspectRatio="none" role="img" aria-label="${esc(`${r.label}: ${ok(r.value) ? f(r.value) : 'not held'}`)}">
      <line class="ps-track" x1="8" y1="11" x2="${W - 8}" y2="11"/>
      ${ok(s.p5) && ok(s.p95) ? `<rect class="ps-band" x="${x(s.p5).toFixed(1)}" y="7" width="${Math.max(2, x(s.p95) - x(s.p5)).toFixed(1)}" height="8" rx="4"/>` : ''}
      ${ok(s.p50) ? `<line class="ps-med" x1="${x(s.p50).toFixed(1)}" y1="5" x2="${x(s.p50).toFixed(1)}" y2="17"/>` : ''}
      ${ok(r.ref) ? `<line class="ps-ref" x1="${x(r.ref).toFixed(1)}" y1="2" x2="${x(r.ref).toFixed(1)}" y2="20"/>` : ''}
      </svg>`;
    // The dot is HTML over the stretched track (a circle inside a preserveAspectRatio=none SVG becomes an ellipse).
    const dot = ok(r.value) ? `<i class="ps-dot ps-${s.status.replace(' ', '-')}" style="left:${((x(r.value) / W) * 100).toFixed(2)}%"></i>` : '';
    return `<div class="ps-row" data-status="${esc(s.status)}"><div class="ps-h"><span class="ps-l">${esc(r.label)}</span><b class="ps-v">${ok(r.value) ? `${esc(f(r.value))}${r.unit ? ` <small>${esc(r.unit)}</small>` : ''}` : 'not held'}</b><span class="ps-s ps-${s.status.replace(' ', '-')}">${word}</span></div><div class="ps-tw">${svg}${dot}</div>
      <div class="ps-f">${ok(s.pct) ? `P${Math.round(s.pct)} of ${s.n.toLocaleString('en-US')}` : s.n ? `${s.n.toLocaleString('en-US')} buses hold it` : 'population not held'}${ok(s.p5) ? ` · P5–P95 ${esc(f(s.p5))}–${esc(f(s.p95))}` : ''}${ok(r.ref) ? ` · ref ${r.dir === 'le' ? '≤' : '≥'} ${esc(f(r.ref))}` : ''}</div></div>`;
  }).join('');
  const met = rows.map(r => percentileRow(r.value, r.pop, r.ref, r.dir).status);
  const head = opts.title ? `<div class="ps-title">${esc(opts.title)} · ${met.filter(x => x === 'met').length} of ${met.filter(x => x !== 'context').length} met${met.includes('unknown') ? ` · ${met.filter(x => x === 'unknown').length} unknown` : ''}</div>` : '';
  return `<div class="pstrip">${head}${body}<div class="ps-key"><span><i class="ps-k-band"></i>P5–P95 of ISO-NE buses</span><span><i class="ps-k-med"></i>median</span><span><i class="ps-k-ref"></i>your requirement</span><span><i class="ps-k-dot"></i>this bus</span></div></div>`;
}

/** Direct-label y positions: keep each label at its line end when it fits; otherwise push neighbours apart by `gap`
 *  (top-down then bottom-up), clamped to [top, bottom]. items [{y,…}] → same items with `ly`, in input order. */
export function placeLabels(items, top, bottom, gap = 12) {
  const idx = items.map((it, i) => ({ i, ly: Math.min(bottom, Math.max(top, it.y)) })).sort((a, b) => a.ly - b.ly);
  for (let k = 1; k < idx.length; k++) if (idx[k].ly - idx[k - 1].ly < gap) idx[k].ly = idx[k - 1].ly + gap;
  if (idx.length && idx.at(-1).ly > bottom) { idx.at(-1).ly = bottom; for (let k = idx.length - 2; k >= 0; k--) if (idx[k + 1].ly - idx[k].ly < gap) idx[k].ly = idx[k + 1].ly - gap; }
  const out = items.map(it => ({ ...it })); for (const o of idx) out[o.i].ly = o.ly; return out;
}
