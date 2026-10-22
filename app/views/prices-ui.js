// Markup helpers shared by the Prices view files (layout contract: kpis + 12-column cards + depth tags).
// Every card carries data-depth = the MINIMUM depth at which it appears; the shell hides cards above the current depth.
import { finite } from '../prices.js';

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const DEPTHS = ['screen', 'review', 'study'];
/** Current depth from ctx (shell contract), else S.depth, else the default 'review'. */
export const depthOf = ctx => (DEPTHS.includes(ctx?.depth) ? ctx.depth : DEPTHS.includes(ctx?.S?.depth) ? ctx.S.depth : 'review');
/** True when the current depth is at or above d. */
export const atLeast = (ctx, d) => DEPTHS.indexOf(depthOf(ctx)) >= DEPTHS.indexOf(d);

export const kpi = (label, value, unit, note) => { const nh = /^(not held|loading|study depth)/i.test(String(value)); return `<div class="kpi${nh ? ' nh' : ''}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}${unit && !nh ? `<span class="unit">${esc(unit)}</span>` : ''}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`; };
/**
 * card(cls, title, sub, body, {id, tools, foot, depth, trace, chips}) — depth defaults to 'review'.
 * trace = the trace id behind the card's headline number (shell (i) icon); chips = space-separated provenance tags.
 */
export const card = (cls, title, sub, body, o = {}) => `<section class="card ${cls}" data-depth="${DEPTHS.includes(o.depth) ? o.depth : 'review'}"${o.id ? ` data-card="${esc(o.id)}"` : ''}${o.trace ? ` data-trace="${esc(o.trace)}"` : ''}${o.chips ? ` data-chips="${esc(o.chips)}"` : ''}><header class="card-h"><h3>${esc(title)}</h3>${sub ? `<span class="card-sub">${esc(sub)}</span>` : ''}${o.tools ? `<div class="card-tools">${o.tools}</div>` : ''}</header><div class="card-b">${answerP(o.answer)}${body}</div>${o.foot ? `<footer class="card-f">${o.foot}</footer>` : ''}</section>`;
/** The card's one computed answer sentence (V6 answer-first). Callers build it from escaped values; <b> marks key numbers. */
export const answerP = a => (a ? `<p class="card-answer">${a}</p>` : '');
/** The tab's single "Next:" step (V6): words naming where the result is used, and a goto button. */
export const nextStep = (text, stage, tab, btn = 'Open') => `<div class="next-step"><span>Next: <b>${esc(text)}</b></span><button class="tiny primary" data-act="goto" data-v="${esc(stage)}" data-tab="${esc(tab)}">${esc(btn)}</button></div>`;
/** Rarely changed controls behind "More options" (V6 compact forms). open = a hidden input needs attention. */
export const moreCtl = (inner, open = false) => (inner ? `<details class="more-ctl"${open ? ' open' : ''}><summary>More options</summary>${inner}</details>` : '');
/** Escaped text in bold, for answer sentences. */
export const B = v => `<b>${esc(v)}</b>`;
/** The trace card at the bottom of a tab (Study by default). */
export const traceCard = (inner, depth = 'study', sub = 'Formula, inputs, steps, a check and the working as CSV') => `<section class="card c-12 card-trace" data-depth="${depth}"><header class="card-h"><h3>Calculations</h3><span class="card-sub">${esc(sub)}</span></header><div class="card-b">${inner}</div></section>`;
export const tbl = (head, rows, o = {}) => `<div class="table-wrap"${o.max ? ` style="max-height:${o.max}px"` : ''}><table class="dense"><thead><tr>${head.map(h => (Array.isArray(h) ? `<th class="num">${esc(h[0])}</th>` : `<th>${esc(h)}</th>`)).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
export const tr = (cells, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}>${cells.join('')}</tr>`;
export const td = v => `<td>${v}</td>`;
export const tn = v => `<td class="num">${v}</td>`;
export const pending = (e, what) => (e.status === 'loading'
  ? `<div class="empty"><strong>Loading ${esc(what)}</strong>Read from the unified database: a few seconds the first time, cached after that.</div>`
  : e.status === 'none' ? `<div class="empty"><strong>Not held</strong>The unified database holds no ${esc(what)} for this bus.</div>`
    : `<div class="notice warn">Could not load ${esc(what)}: ${esc(e.error?.message || 'unknown error')}.</div>`);
export const seg = (k, cur, opts) => `<div class="segmented seg-sm" role="group">${opts.map(([v, l]) => `<button data-act="ui" data-k="${k}" data-v="${esc(v)}" class="${String(cur) === String(v) ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
export const sel = (k, cur, opts, label) => `<select data-act="ui" data-k="${k}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
/** A one-line "not applicable to <fuel>" card (never the wrong calculation). */
export const notApplicable = (cls, title, fuel, why, depth = 'screen') => card(cls, title, `Not applicable to ${fuel}`, `<div class="empty"><strong>Not applicable to ${esc(fuel)}</strong>${esc(why)}</div>`, { depth });

export const n2 = v => (finite(v) ? v.toFixed(2) : 'not held');
export const r3 = v => (finite(v) ? v.toFixed(3) : 'not held');
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const RUN = { '5yr': 'PROBE 5-yr (2028)', '10yr': 'PROBE 10-yr (2035)', pcr2030: 'PCR 2030', pcr2035: 'PCR 2035', pcr2040: 'PCR 2040 (12% gas)' };
export const RUN_ORDER = ['5yr', 'pcr2030', '10yr', 'pcr2035', 'pcr2040'];
export const calHours = y => (y % 4 === 0 ? 8784 : 8760);
/** HE label for clock hours: [16,17,18,19] → 'HE17–20'; non-contiguous → comma list. */
export function heRange(hs) {
  if (!hs?.length) return '—';
  const s = [...hs].sort((a, b) => a - b), parts = [];
  let a = s[0], b = s[0];
  for (const h of s.slice(1)) { if (h === b + 1) { b = h; continue; } parts.push(a === b ? `${a + 1}` : `${a + 1}–${b + 1}`); a = b = h; }
  parts.push(a === b ? `${a + 1}` : `${a + 1}–${b + 1}`);
  return `HE${parts.join(', ')}`;
}
export const FUEL_LABEL = { solar: 'solar', wind: 'wind', storage: 'storage', hybrid: 'solar + storage', datacenter: 'a data centre (load)' };
