// GridSense One Studio: the Project inputs panel (plan 14 §6a) — the live inspector Inputs tab, as a pure render + change helper.
// Provenance: Claude Opus 5.5 (P2-inputs build agent; reworked onto the P1 store by X-fixups) · one-studio/design/14-lift-projects-configurator-continuum.md §6a · 2026-10-13 · sign-off pending · v2
//
// Lifted (wording, field order, help lines, toast text) from the pinned live snapshot app-tools/live-snapshot/2026-10-11/src/app.js
// inspInputs L1189–1211; One Studio adds the §6 fields (import MW, site, land control, gen-tie, optional economics) and CNRIS.
// The project is the projects.js store (the samples' shape: tech/exportMW/importMW/assumptions.ui.*, p.stated/p.sources). This view
// owns no rule, no default and no field path: validation, writes, labelled defaults, BASIS_FIELDS and the stated count are projects.js.
//   render(project, {readOnly, errors, sizes, option, busCoord}) -> HTML string (root .gsx-pi). sizes = live GS.SIZES via the shim;
//   option (id) = the option in view, busCoord {lat, lon, name} = its bus: a default site shows that bus, as the dashboards read it.
//   applyField(project, k, raw, {readOnly, rules}) -> {ok:false, why} | {ok:true, project, k, old, value, basis}; never mutates.
//   readEvent(el) -> {act, k, raw} from data-act="proj-field|proj-dup" controls. savedText(k, old, v, n) = the live toast.
// Null = "not held", never 0: an empty optional field returns to its labelled default; no default reads "not held".
import { FIELDS as PF, BASIS_FIELDS, applies, fieldValue, setField, statedCount, incompleteOf, fmtVal, toState, SERVICES, LAND_STATUSES, PROFILES } from '../projects.js';
export { BASIS_FIELDS };

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const held = v => v != null && v !== '' && !(typeof v === 'number' && Number.isNaN(v));
const num = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d }) : 'not held');
// Live GS.FUELS labels (pinned src/app.js L203–208) on One Studio's tech keys.
export const TECH_LABELS = [['solar', 'Solar'], ['wind', 'Wind'], ['storage', 'BESS'], ['datacenter', 'Data centre'], ['hybrid', 'Solar + storage']];
const PV = t => t === 'solar' || t === 'hybrid';
const ro = (p, o = {}) => !!(o.readOnly ?? (p && p.user !== true)) || !!(p && p.readOnly);
// View table: live order then the §6 groups. Labels/units/paths are projects.js FIELDS; scale = shown ×scale, stored as a fraction.
const F = (k, type, o = {}) => ({ k, type, ...o });
const opts = list => () => [['', 'not stated'], ...list.map(v => [v, v])];
const FIELDS = [
  F('name', 'text', { g: 'Project' }),
  F('tech', 'select', { opts: () => TECH_LABELS, help: () => 'Changes which analyses are eligible on every dashboard.' }),
  F('exportMW', 'number', { unit: p => (PV(p.tech) ? 'MWac' : 'MW'), help: sizeHelp }),
  F('importMW', 'number', { unit: () => 'MW', help: (p, o) => (p.tech === 'datacenter' ? sizeHelp(p, o) : 'Withdrawal the connection must carry (charging or load).') }),
  F('dcMW', 'number', { help: p => `Implied DC:AC ${held(p.dcMW) && held(p.exportMW) && p.exportMW ? (p.dcMW / p.exportMW).toFixed(2) : 'not held'}` }),
  F('duration', 'number', { help: () => 'The arbitrage ceiling and the cycle counts read this.' }),
  F('cod', 'number'),
  F('service', 'select', { opts: opts(SERVICES), help: () => 'Changes which connection envelope is read.' }),
  F('landStatus', 'select', { opts: opts(LAND_STATUSES) }),
  F('profile', 'select', { opts: opts(PROFILES), help: () => 'Hourly profiles unlock the profile-weighted revenue and capture reads.' }),
  F('notes', 'textarea'),
  F('siteLat', 'number', { g: 'Connection and site', help: () => 'Defaults to the connection bus.' }),
  F('siteLon', 'number'),
  F('control', 'number', { help: () => 'Share of the site under control; the queue site-control gate reads it.' }),
  F('route', 'number', { help: () => 'Route from the site to the connection bus.' }),
  F('capex', 'number', { g: 'Known economics (optional)' }),
  F('annualOM', 'number'), F('solarCF', 'number'), F('windCF', 'number'), F('rte', 'number'),
  F('discountRate', 'number', { scale: 100, unit: () => '%' }),
  F('years', 'number'),
];
function sizeHelp(p, o = {}) {
  const S = Array.isArray(o.sizes) && o.sizes.length ? o.sizes : null, mw = p.tech === 'datacenter' ? p.importMW : p.exportMW, head = 'Every headroom margin and curtailment read is at this size.';
  if (!S || !held(mw)) return `${head} Published study sizes not held.`;
  return `${head} ${S.includes(mw) ? `Exact: ${mw} MW is a published study size.` : `Curtailment is read at the nearest published size (${S.reduce((a, b) => (Math.abs(b - mw) < Math.abs(a - mw) ? b : a), S[0])} MW); headroom margins are arithmetic against the solved envelope.`}`;
}
// exportMW/importMW are always held (a true 0 for the direction a tech lacks); show them only where they apply.
export const fieldsFor = p => FIELDS.filter(f => applies(f.k, p.tech) && !(f.k === 'exportMW' && p.tech === 'datacenter'));
const fieldOf = k => FIELDS.find(f => f.k === k);
const label = k => PF[k]?.label || k;
const unitOf = (f, p) => (f.unit ? f.unit(p) : PF[f.k]?.unit || '');

export function parseRaw(k, raw) {
  const f = fieldOf(k); if (!f || f.type !== 'number') return raw == null ? raw : String(raw);
  const s = String(raw ?? '').trim(); if (s === '') return null;
  const v = Number(s); return Number.isFinite(v) ? (f.scale ? +(v / f.scale).toPrecision(12) : v) : NaN;
}
export function applyField(p, k, raw, o = {}) {
  if (!p) return { ok: false, why: 'Open a project first.' };
  if (ro(p, o)) return { ok: false, why: 'Dummy samples are read-only. Duplicate as my project to edit.' };
  if (!fieldOf(k)) return { ok: false, why: `Unknown input ${k}.` };
  const value = parseRaw(k, raw); if (Number.isNaN(value)) return { ok: false, why: `${label(k)} must be a number, not ${raw}. The update was not applied.` };
  const r = setField(p, k, value, { rules: o.rules ?? null });
  if (!r.ok) return { ok: false, why: /not applied/.test(r.reason || '') ? r.reason : `${r.reason || `${label(k)} rejected.`} The update was not applied.` };
  return { ok: true, project: r.project, k, old: r.old, value: r.value, basis: r.basis, changed: r.changed !== false, incomplete: r.incomplete || {} };
}
const shown = (k, v) => { const f = fieldOf(k); return fmtVal(f?.scale && typeof v === 'number' ? `${+(v * f.scale).toPrecision(12)}${unitOf(f, {})}` : v); };
export const savedText = (k, old, v, n) => `Saved: ${label(k)} ${shown(k, old)} → ${shown(k, v)}${n ? `; ${n} saved finding${n === 1 ? '' : 's'} now stale` : ''}.`;
export function readEvent(el) {
  const d = el && el.dataset, act = d && d.act; if (act !== 'proj-field' && act !== 'proj-dup') return null;
  return act === 'proj-dup' ? { act, k: null, raw: null } : { act, k: d.k, raw: el.value ?? null };
}

// stated | default (with its source) | not held. A Dummy sample's values are its illustrative inputs, labelled as duplicateProject does.
// ov {k: {v, src}}: the value the dashboards read for a default that follows the option (the site), from projects.toState.
const valueOf = (p, k, ov) => (ov && k in ov ? ov[k].v : fieldValue(p, k));
function mark(f, p, ov) {
  const s = p.stated?.[f.k], v = valueOf(p, f.k, ov);
  if (s === 'stated') return { cls: 'stated', text: 'stated' };
  if (ov && f.k in ov) return held(v) ? { cls: 'default', text: `default · ${ov[f.k].src || 'source not stated'}` } : { cls: 'nh', text: 'not held' };
  if (s === 'default' && held(v)) return { cls: 'default', text: `default · ${p.sources?.[f.k] || 'source not stated'}` };
  if (held(v) && p.user !== true) return { cls: 'default', text: `default · Dummy sample “${p.name}”: ${p.assumptions?.label || 'illustrative inputs'}` };
  return held(v) ? { cls: 'stated', text: 'stated' } : { cls: 'nh', text: 'not held' };
}
function control(f, p, m, dis, ov) {
  const v = valueOf(p, f.k, ov), a = `data-act="proj-field" data-k="${f.k}" id="gsx-pi-${f.k}" aria-describedby="gsx-pi-${f.k}-h"${dis}`;
  if (f.type === 'select') return `<select class="pi-sel" ${a}>${f.opts(p).map(([ov, ol]) => `<option value="${esc(ov)}"${(v ?? '') === ov ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
  if (f.type === 'textarea') return `<textarea class="pi-ta" ${a} placeholder="Notes…">${esc(v)}</textarea>`;
  const sc = x => (f.scale && held(x) ? +(x * f.scale).toPrecision(12) : x), u = unitOf(f, p);
  const shown = m.cls === 'default' ? '' : held(v) ? sc(v) : '', ph = f.type === 'number' ? (m.cls === 'default' ? `default ${num(sc(v))}` : 'not held') : '';
  return `<span class="pi-w"><input class="pi-in" type="${f.type}"${f.type === 'number' ? ' step="any"' : ''} ${a} value="${esc(shown)}" placeholder="${esc(ph)}">${u ? `<span class="pi-u">${esc(u)}</span>` : ''}</span>`;
}
export function render(p, o = {}) {
  if (!p) return '<div class="gsx-pi"><div class="pi-empty"><b>Open a project</b><p>Project inputs are what the developer states. Every dashboard reads them.</p></div></div>';
  // a required size not held (a tech change to data centre / storage) stays flagged until it is set: never read as 0
  const r = ro(p, o), inc = r ? {} : incompleteOf(p);
  const r2 = Object.keys(inc).length, dis = r ? ' disabled' : '', err = { ...inc, ...(o.errors || {}) }, sc = statedCount(p);
  let g = null, body = '', ov = null;
  if (!r && p.user === true && p.stated?.siteLat !== 'stated' && p.stated?.siteLon !== 'stated') { // the site default follows the option in view (fix-4)
    const st = toState(p, o.option ?? undefined, { busCoord: o.busCoord ?? null }); ov = {};
    for (const k of ['siteLat', 'siteLon']) ov[k] = { v: st.ui.land?.[k] ?? null, src: st.inputSrc?.[k] ?? null };
  }
  for (const f of fieldsFor(p)) {
    if (f.g && f.g !== g) { body += `${g ? '</div>' : ''}<div class="pi-grp"><h3 class="pi-gh">${esc(f.g)}</h3>`; g = f.g; }
    const m = mark(f, p, ov), help = f.help ? f.help(p, o) : '';
    body += `<div class="pi-f${err[f.k] ? ' bad' : ''}" data-k="${f.k}"><label class="pi-e" for="gsx-pi-${f.k}">${esc(label(f.k))}<span class="pi-lvl">PROJECT</span><span class="pi-src ${m.cls}" title="${esc(m.text)}">${esc(m.text)}</span></label>${control(f, p, m, dis, ov)}<div class="pi-help" id="gsx-pi-${f.k}-h">${esc(help)}</div>${err[f.k] ? `<div class="pi-err" role="alert">${esc(err[f.k])}</div>` : ''}</div>`;
  }
  const ban = r ? `<div class="pi-ro"><span>Dummy sample: read-only.</span><button type="button" class="pi-dup" data-act="proj-dup">Duplicate as my project</button></div>` : '';
  return `<div class="gsx-pi${r ? ' ro' : ''}"><div class="pi-hd"><span class="pi-cnt${r2 ? ' bad' : ''}"${r2 ? ' title="A required size is not held: the dashboards read it as not held."' : ''}>${sc.stated} of ${sc.total} stated${r2 ? ' · incomplete' : ''}</span><h2>Project inputs</h2><p class="lede">What the developer states about ${esc(p.name)}. Every dashboard reads these; changing a basis input marks earlier findings stale with the reason.</p></div>${ban}${body}${g ? '</div>' : ''}</div>`;
}
