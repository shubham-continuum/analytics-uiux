// Economics chart helpers. Uses the shell's stackedBar / histogram (charts.js) when they exist, otherwise falls back
// to groupedBar / barChart so nothing is lost. The tornado has no shared chart type: it is drawn here as inline SVG
// with a table beneath (values from the same array). Null = not held, never drawn as zero.
import * as CH from '../charts.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);

/** Stacked bars: groups [{label, values:[per series]}], opts.series names. */
export function stacked(groups, opts) {
  if (typeof CH.stackedBar === 'function') return CH.stackedBar(groups, opts);
  return CH.groupedBar(groups, opts);
}

/** Histogram of values; falls back to a bar chart of equal-width bins. */
export function histo(values, opts = {}) {
  if (typeof CH.histogram === 'function') return CH.histogram(values, opts);
  const v = values.filter(ok); if (!v.length) return CH.barChart([], opts);
  const bins = opts.bins || 12, lo = Math.min(...v), hi = Math.max(...v), w = (hi - lo) / bins || 1;
  const counts = Array(bins).fill(0); for (const x of v) counts[Math.min(bins - 1, Math.floor((x - lo) / w))]++;
  const f = opts.fmt || (x => x.toFixed(2));
  return CH.barChart(counts.map((c, i) => ({ label: `${f(lo + i * w)}`, value: c, note: `${f(lo + i * w)} to ${f(lo + (i + 1) * w)}` })), { ...opts, fmt: n => String(Math.round(n)), xLabel: 'Bin from', yLabel: 'Count' });
}

/**
 * Tornado: rows [{label, lowLabel, highLabel, lowValue, highValue}] already sorted, around `base`.
 * fmt formats a value. Bars run from the base to each side's value; a not-held side is drawn as text.
 */
export function tornadoChart(rows, base, { fmt = v => String(v), title = 'Sensitivity', unit = '' } = {}) {
  if (!rows.length || !ok(base)) return `<div class="empty"><strong>Nothing to chart</strong>No sensitivities are held for this selection.</div>`;
  const vals = rows.flatMap(r => [r.lowValue, r.highValue]).filter(ok).concat(base);
  const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.04 || 1;
  const W = 440, L = 172, R = 12, rowH = 24, H = 26 + rows.length * rowH, x = v => L + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (W - L - R);
  let svg = `<line x1="${x(base)}" x2="${x(base)}" y1="4" y2="${H - 18}" style="stroke:var(--ink-3,#7a8a94);stroke-width:1.2"/><text x="${x(base)}" y="${H - 5}" text-anchor="middle" style="font-size:10.5px;fill:var(--ink-3,#7a8a94)">base ${esc(fmt(base))}</text>`;
  rows.forEach((r, i) => {
    const y = 4 + i * rowH;
    svg += `<text x="${L - 8}" y="${y + 15}" text-anchor="end" style="font-size:11px;fill:var(--ink-2,#44525c)">${esc(r.label)}</text>`;
    for (const [v, lab, cls] of [[r.lowValue, r.lowLabel, 'lo'], [r.highValue, r.highLabel, 'hi']]) {
      if (!ok(v)) { svg += `<text x="${cls === 'lo' ? x(base) - 6 : x(base) + 6}" y="${y + 15}" text-anchor="${cls === 'lo' ? 'end' : 'start'}" style="font-size:10px;fill:var(--ink-4,#99a5ad)">${esc(lab)}: not held</text>`; continue; }
      const a = Math.min(x(v), x(base)), w = Math.max(1, Math.abs(x(v) - x(base))), down = v < base;
      svg += `<rect x="${a}" y="${y + 3}" width="${w}" height="${rowH - 9}" rx="2" style="fill:${down ? 'var(--gs-amber,#b76d44)' : 'var(--gs-cyan,#38868a)'}"><title>${esc(r.label)} · ${esc(lab)}: ${esc(fmt(v))}</title></rect>`;
    }
  });
  const cellv = (lab, v) => `${esc(lab)}: ${ok(v) ? esc(fmt(v)) : 'not held'}`;
  const table = `<div class="table-wrap"><table class="dense"><thead><tr><th>Assumption</th><th class="num">Low case</th><th class="num">High case</th><th class="num">Swing${unit ? ` (${esc(unit)})` : ''}</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${cellv(r.lowLabel, r.lowValue)}</td><td class="num">${cellv(r.highLabel, r.highValue)}</td><td class="num">${esc(fmt(r.swing))}</td></tr>`).join('')}</tbody></table></div>`;
  return `<figure class="tornado" style="margin:0"><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}" style="max-height:${H * 1.25}px;display:block">${svg}</svg>${table}</figure>`;
}

/** Compact data table. cols [{k, l, num?, f?}], rows objects; a null cell prints "not held". */
export function table(cols, rows, { cls = 'dense', empty = 'No rows are held.' } = {}) {
  if (!rows.length) return `<div class="empty"><strong>Nothing to list</strong>${esc(empty)}</div>`;
  const cell = (c, r) => { const v = r[c.k]; const s = c.f ? c.f(v, r) : v; return s == null || (typeof s === 'number' && !Number.isFinite(s)) ? 'not held' : esc(s); };
  return `<div class="table-wrap"><table class="${cls}"><thead><tr>${cols.map(c => `<th${c.num ? ' class="num"' : ''}>${esc(c.l)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr${r._cls ? ` class="${esc(r._cls)}"` : ''}>${cols.map(c => `<td class="${c.num ? 'num' : ''}${c.wrap ? ' wrap' : ''}">${cell(c, r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

/** Card markup per the layout contract. */
const DEPTHS = ['screen', 'review', 'study'];
/** depth = the minimum depth the card shows at (default review); trace = the trace id behind its headline; chips = provenance tags. */
export function card(span, title, sub, body, { foot = '', tools = '', tall = false, cls = '', depth = 'review', trace = '', chips = '', answer = '' } = {}) {
  return `<section class="card c-${span}${tall ? ' r-2' : ''}${cls ? ` ${cls}` : ''}" data-depth="${DEPTHS.includes(depth) ? depth : 'review'}"${trace ? ` data-trace="${esc(trace)}"` : ''}${chips ? ` data-chips="${esc(chips)}"` : ''}><header class="card-h"><h3>${esc(title)}</h3>${sub ? `<span class="card-sub">${esc(sub)}</span>` : ''}${tools ? `<div class="card-tools">${tools}</div>` : ''}</header><div class="card-b">${answer ? `<p class="card-answer">${answer}</p>` : ''}${body}</div>${foot ? `<footer class="card-f">${foot}</footer>` : ''}</section>`;
}
/** Escaped text in bold, for answer sentences. */
export const B = v => `<b>${esc(v)}</b>`;
/** The tab's single "Next:" step (V6). */
export const nextStep = (text, stage, tab, btn = 'Open') => `<div class="next-step"><span>Next: <b>${esc(text)}</b></span><button class="tiny primary" data-act="goto" data-v="${esc(stage)}" data-tab="${esc(tab)}">${esc(btn)}</button></div>`;
/** Rarely changed controls behind "More options" (V6 compact forms). */
export const moreCtl = (inner, open = false) => (inner ? `<details class="more-ctl"${open ? ' open' : ''}><summary>More options</summary>${inner}</details>` : '');
