// User projects (L1): the live Studio's project store (pinned app-tools/live-snapshot/2026-10-11/src/app.js L976-995 newProject /
// addOption, L1189-1211 inspInputs RULES / BASIS_FIELDS / markStale) re-cut to One Studio's sample shape (data/samples.json projects:
// id, name, client_type, tech, exportMW, importMW, options[], assumptions.ui.{econ,fin,land,qCod,qService}), so the walkthrough,
// preset and hand-off code drive all 7 dashboards from a user project with no new calculation code. Every input carries
// stated|default in p.stated and, for a default, its source in p.sources. Defaults come only from rules/isone-2026/defaults.json
// (passed in as `rules`), a bus coordinate or a Dummy sample's illustrative inputs; anything else is null = not held, never 0.
// Pure (no DOM): every mutation returns a new project. Persistence: localStorage gsone.projects.v1 (versioned, try/catch).
// Provenance: Claude Opus 5.5 (P1-store builder) · one-studio/design/14-lift-projects-configurator-continuum.md §6/§6a · 2026-10-13 · sign-off pending · v1

export const STORE_KEY = 'gsone.projects.v1', STORE_VERSION = 1, FORMAT = 'gsone.projects';
export const TECHS = ['solar', 'wind', 'storage', 'hybrid', 'datacenter'];
export const STATUSES = ['Exploring', 'Shortlisted', 'Selected', 'On hold', 'Rejected']; // live STATUSES
export const LIVE_ASSET = { bess: 'storage', dc: 'datacenter', solar: 'solar', wind: 'wind', hybrid: 'hybrid' };
// Service as the developer states it (live: energy-only / ERIS / NRIS / firm load; §6 adds CNRIS). Only the ISO-NE queue services the
// queue engine reads (queuecore.queueInputs: NRIS | CNRIS) reach ui.qService; the rest are kept on p.service and read as not held there.
export const SERVICES = ['CNRIS', 'NRIS', 'ERIS', 'energy-only', 'firm load'];
const SERVICE_Q = { CNRIS: 'CNRIS', NRIS: 'NRIS' };
export const LAND_STATUSES = ['prospecting', 'under option', 'optioned', 'owned']; // live inspInputs 'land'
export const PROFILES = ['none', 'hourly 8760', 'flat 24x7']; // live inspInputs 'profile'
// New England extent: geomap.js fallback map extent (lon -73.8..-66.8, lat 41.0..47.5).
export const NE_BOX = Object.freeze({ lat0: 41.0, lat1: 47.5, lon0: -73.8, lon1: -66.8 });
const EXPORTS = ['solar', 'wind', 'storage', 'hybrid'], IMPORTS = ['storage', 'hybrid', 'datacenter'], NEEDS_IMPORT = ['storage', 'datacenter'];
const RULES_SRC = 'rules/isone-2026/defaults.json';

const num = v => typeof v === 'number' && Number.isFinite(v);
const sizeRule = need => need ? [v => v > 0 && v <= 10000, 'must be > 0 and ≤ 10,000 MW'] : [v => v >= 0 && v <= 10000, 'must be ≥ 0 and ≤ 10,000 MW'];
/** Field table: path in the project, label, unit, which techs it applies to, and the live validation rule [test, reason]. */
export const FIELDS = {
  name: { label: 'Project name', path: ['name'], text: true }, client_type: { label: 'Client type', path: ['client_type'], text: true }, notes: { label: 'Notes', path: ['notes'], text: true },
  tech: { label: 'Technology', path: ['tech'], oneOf: TECHS },
  exportMW: { label: 'Export size', path: ['exportMW'], unit: 'MW', techs: EXPORTS }, importMW: { label: 'Import / charge size', path: ['importMW'], unit: 'MW', techs: IMPORTS },
  dcMW: { label: 'DC nameplate', path: ['dcMW'], unit: 'MWdc', techs: ['solar', 'hybrid'], rule: [v => v > 0 && v <= 20000, 'must be > 0 and ≤ 20,000 MWdc'] },
  duration: { label: 'Storage duration', path: ['assumptions', 'ui', 'econ', 'duration'], unit: 'h', techs: ['storage', 'hybrid'], rule: [v => v >= 0.5 && v <= 12, 'must be between 0.5 and 12 hours'] },
  cod: { label: 'Target COD', path: ['assumptions', 'ui', 'fin', 'cod'], unit: 'year', rule: [v => v >= 2026 && v <= 2050, 'must be a year between 2026 and 2050'] },
  service: { label: 'Service type', path: ['service'], oneOf: SERVICES }, landStatus: { label: 'Land status', path: ['landStatus'], oneOf: LAND_STATUSES }, profile: { label: 'Profile availability', path: ['profile'], oneOf: PROFILES },
  siteLat: { label: 'Site latitude', path: ['assumptions', 'ui', 'land', 'siteLat'], unit: '°', rule: [v => v >= NE_BOX.lat0 && v <= NE_BOX.lat1, `must be inside New England (latitude ${NE_BOX.lat0} to ${NE_BOX.lat1})`] },
  siteLon: { label: 'Site longitude', path: ['assumptions', 'ui', 'land', 'siteLon'], unit: '°', rule: [v => v >= NE_BOX.lon0 && v <= NE_BOX.lon1, `must be inside New England (longitude ${NE_BOX.lon0} to ${NE_BOX.lon1})`] },
  control: { label: 'Land control', path: ['assumptions', 'ui', 'land', 'control'], unit: '%', rule: [v => v >= 0 && v <= 100, 'must be between 0 and 100%'] },
  route: { label: 'Gen-tie distance', path: ['assumptions', 'ui', 'land', 'route'], unit: 'mi', rule: [v => v >= 0, 'must be ≥ 0 miles'] },
  capex: { label: 'Capex', path: ['assumptions', 'ui', 'fin', 'capex'], unit: '$', rule: [v => v >= 0, 'must be ≥ $0'] },
  annualOM: { label: 'Annual O&M', path: ['assumptions', 'ui', 'fin', 'annualOM'], unit: '$/yr', rule: [v => v >= 0, 'must be ≥ $0 a year'] },
  solarCF: { label: 'Solar capacity factor', path: ['assumptions', 'ui', 'econ', 'solarCF'], unit: '%', techs: ['solar', 'hybrid'], rule: [v => v > 0 && v <= 100, 'must be > 0 and ≤ 100%'] },
  windCF: { label: 'Wind capacity factor', path: ['assumptions', 'ui', 'econ', 'windCF'], unit: '%', techs: ['wind'], rule: [v => v > 0 && v <= 100, 'must be > 0 and ≤ 100%'] },
  rte: { label: 'Round-trip efficiency', path: ['assumptions', 'ui', 'econ', 'rte'], unit: '%', techs: ['storage', 'hybrid'], rule: [v => v > 0 && v <= 100, 'must be > 0 and ≤ 100%'] },
  discountRate: { label: 'Discount rate', path: ['assumptions', 'ui', 'fin', 'discountRate'], rule: [v => v >= 0 && v < 1, 'must be a fraction ≥ 0 and < 1'] },
  years: { label: 'Life', path: ['assumptions', 'ui', 'fin', 'years'], unit: 'years', rule: [v => v >= 1 && v <= 60, 'must be between 1 and 60 years'] },
};
const NUMERIC = k => !FIELDS[k].text && !FIELDS[k].oneOf;
const RULE_KEYS = ['capex', 'annualOM', 'discountRate', 'years', 'solarCF', 'windCF', 'rte', 'duration'];
/** Live BASIS_FIELDS (asset, sizeMW, dcMW, durationH, service, profile) plus the One Studio names of the same inputs. */
export const BASIS_FIELDS = { asset: 'Asset', sizeMW: 'Project size', dcMW: 'DC nameplate', durationH: 'Storage duration', service: 'Service type', profile: 'Profile availability', tech: 'Asset', exportMW: 'Export size', importMW: 'Import / charge size', duration: 'Storage duration' };

const get = (o, path) => path.reduce((a, k) => (a == null ? undefined : a[k]), o);
const put = (o, path, v) => { let a = o; for (const k of path.slice(0, -1)) a = a[k] ??= {}; a[path.at(-1)] = v; };
const coerce = (k, v) => (v === '' || v === undefined ? null : NUMERIC(k) && typeof v === 'string' ? (v.trim() === '' ? null : Number(v)) : v);
/** The stored value of one input (by its FIELDS path); null = not held. */
export const fieldValue = (p, k) => (FIELDS[k] ? get(p, FIELDS[k].path) ?? null : undefined);
export const applies = (k, tech) => !FIELDS[k]?.techs || FIELDS[k].techs.includes(tech);
const required = (k, tech) => k === 'name' || k === 'tech' || k === 'cod' || (k === 'exportMW' && EXPORTS.includes(tech)) || (k === 'importMW' && NEEDS_IMPORT.includes(tech));

/** Live inspInputs check of one value → null (ok) or the reason shown under the field ("… The update was not applied."). */
export function validateField(key, value, p = {}) {
  const F = FIELDS[key]; if (!F) return `Unknown input ${key}.`; const v = coerce(key, value), tech = key === 'tech' ? v : p.tech;
  if (F.text) return key === 'name' && !String(v ?? '').trim() ? 'A name is required.' : null;
  if (v == null) return required(key, tech) ? `${F.label} is required.` : null;
  if (F.oneOf) return F.oneOf.includes(v) ? null : `${F.label} must be one of ${F.oneOf.join(', ')}, not ${v}.`;
  const rule = key === 'exportMW' || key === 'importMW' ? (applies(key, tech) ? sizeRule(required(key, tech)) : [x => x === 0, `does not apply to ${tech}`]) : F.rule;
  return num(v) && (!rule || rule[0](v)) ? null : `${F.label} ${rule ? rule[1] : 'must be a number'}, not ${value}. The update was not applied.`;
}

/** Whole-project check → {errors: {field: reason}, missing: ['bus'] when no connection option yet}. */
export function validateProject(p) {
  const errors = {}; if (!p || typeof p !== 'object') return { errors: { name: 'Not a project.' }, missing: [] };
  for (const k of Object.keys(FIELDS)) { if (!applies(k, p.tech) && !['exportMW', 'importMW'].includes(k)) continue; const e = validateField(k, get(p, FIELDS[k].path), p); if (e) errors[k] = e; }
  return { errors, missing: (p.options || []).length ? [] : ['bus'] };
}

const ruleSrc = (e, what) => `${RULES_SRC} · ${e.src}${e.status ? ` (${e.status})` : ''} · ${what}`;
/** Defaults for a tech/size from defaults.json (the parsed file): {field: {value, src}}; value null when the file holds none. */
export function defaultsFor(tech, exportMW, importMW, rules) {
  const A = rules?.defaults_atb2025, out = {}; if (!A) return out; const set = (k, v, src) => { if (num(v)) out[k] = { value: v, src }; };
  const pv = A.pv_tracking, wd = A.wind_onshore, bt = A.battery_4h, f = A.finance, af = A.atb_finance, ex = num(exportMW) ? exportMW * 1000 : null, im = num(importMW) ? importMW * 1000 : null;
  const sum = parts => (parts.every(([r, kw]) => num(r) && kw != null) ? parts.reduce((a, [r, kw]) => a + r * kw, 0) : null);
  if (tech === 'solar') { set('capex', sum([[pv?.capex_per_kwac, ex]]), ruleSrc(pv, 'pv_tracking.capex_per_kwac × export kW')); set('annualOM', sum([[pv?.fom_per_kwac_yr, ex]]), ruleSrc(pv, 'pv_tracking.fom_per_kwac_yr × export kW')); }
  if (tech === 'wind') { set('capex', sum([[wd?.capex_per_kw, ex]]), ruleSrc(wd, 'wind_onshore.capex_per_kw × export kW')); set('annualOM', sum([[wd?.fom_per_kw_yr, ex]]), ruleSrc(wd, 'wind_onshore.fom_per_kw_yr × export kW')); set('windCF', num(wd?.cf_class4) ? wd.cf_class4 * 100 : null, ruleSrc(wd, 'wind_onshore.cf_class4')); }
  if (tech === 'storage') { set('capex', sum([[bt?.capex_per_kw, ex]]), ruleSrc(bt, 'battery_4h.capex_per_kw × discharge kW')); set('annualOM', sum([[bt?.fom_per_kw_yr, ex]]), ruleSrc(bt, 'battery_4h.fom_per_kw_yr × discharge kW')); }
  if (tech === 'hybrid') { set('capex', sum([[pv?.capex_per_kwac, ex], [bt?.capex_per_kw, im]]), ruleSrc(pv, 'pv_tracking.capex_per_kwac × export kW + battery_4h.capex_per_kw × charge kW')); set('annualOM', sum([[pv?.fom_per_kwac_yr, ex], [bt?.fom_per_kw_yr, im]]), ruleSrc(pv, 'pv_tracking.fom_per_kwac_yr × export kW + battery_4h.fom_per_kw_yr × charge kW')); }
  if (tech === 'solar' || tech === 'hybrid') set('solarCF', num(pv?.cf_by_class?.['7']) ? pv.cf_by_class['7'] * 100 : null, ruleSrc(pv, 'pv_tracking.cf_by_class 7 (New England is likely class 7-8)'));
  if (tech === 'storage' || tech === 'hybrid') { const h = Number(/_(\d+(?:\.\d+)?)h$/.exec(Object.keys(A).find(k => A[k] === bt) || '')?.[1]); set('duration', h, ruleSrc(bt, 'battery_4h (the ATB 4-hour battery)')); set('rte', num(bt?.rte) ? bt.rte * 100 : null, ruleSrc(bt, 'battery_4h.rte')); }
  if (tech !== 'datacenter') { set('discountRate', f?.wacc_nominal, ruleSrc(f, 'finance.wacc_nominal')); set('years', tech === 'storage' ? bt?.life_years : af?.crp_years, tech === 'storage' ? ruleSrc(bt, 'battery_4h.life_years') : ruleSrc(af, 'atb_finance.crp_years')); }
  return out;
}

/** Re-derive every input that is not stated and whose value came from the rules (or is unset); sample/bus defaults are left alone. */
function applyRuleDefaults(p, rules) {
  if (!rules) return p; const D = defaultsFor(p.tech, p.exportMW, p.importMW, rules);
  for (const k of RULE_KEYS) {
    if (p.stated[k] === 'stated' || (p.stated[k] === 'default' && !String(p.sources[k] || '').startsWith(RULES_SRC))) continue;
    if (D[k] && applies(k, p.tech)) { put(p, FIELDS[k].path, D[k].value); p.stated[k] = 'default'; p.sources[k] = D[k].src; } else { put(p, FIELDS[k].path, null); delete p.stated[k]; delete p.sources[k]; }
  }
  return p;
}

/** Fill the sample shape's containers without touching what is there (load/import of older or hand-made files). */
export function normalize(x) {
  const p = structuredClone(x); p.options = Array.isArray(p.options) ? p.options : []; p.notes ??= ''; p.client_type ??= ''; p.user = true;
  for (const k of ['service', 'landStatus', 'profile', 'dcMW']) if (p[k] === undefined) p[k] = null;
  p.assumptions ??= {}; p.assumptions.label ??= 'User project: inputs stated by the developer or labelled defaults'; const ui = p.assumptions.ui ??= {};
  for (const g of ['econ', 'fin', 'land']) ui[g] ??= {}; for (const k of ['qCod', 'qService']) if (ui[k] === undefined) ui[k] = null;
  for (const k of Object.keys(FIELDS)) if (FIELDS[k].path.length > 1 && get(p, FIELDS[k].path) === undefined) put(p, FIELDS[k].path, null);
  p.stated ??= {}; p.sources ??= {}; return p;
}

/** A fresh id not in `taken` (prefix + base-36 time, '-n' suffix on a clash). */
export function makeId(prefix, now = Date.now(), taken = []) { const T = new Set(taken), b = prefix + Number(now).toString(36); let id = b, i = 2; while (T.has(id)) id = `${b}-${i++}`; return id; }
const nextOptionId = p => 'o' + (1 + Math.max(0, ...p.options.map(o => +(/^o(\d+)$/.exec(o.id)?.[1] || 0))));
/** p.stated marker for a size the tech lacks: a true 0, held, but never "stated" by the developer. */
export const NOT_APPLICABLE = 'n/a';
const SIZE_TECHS = { exportMW: EXPORTS, importMW: IMPORTS };
/** Force the direction a tech lacks to a true 0 ("does not apply"). With prevTech (a tech CHANGE), a size that becomes applicable
 *  and was held only as "does not apply" (marked n/a, or a 0 the old tech could not have held otherwise) returns to null = not held. */
const techSizes = (p, prevTech) => {
  for (const [k, T] of Object.entries(SIZE_TECHS)) {
    if (!T.includes(p.tech)) { p[k] = 0; p.stated[k] = NOT_APPLICABLE; delete p.sources[k]; continue; }
    const wasNA = p.stated[k] === NOT_APPLICABLE || (prevTech !== undefined && prevTech !== p.tech && !T.includes(prevTech) && p[k] === 0);
    if (wasNA) { p[k] = null; delete p.stated[k]; delete p.sources[k]; }
  }
};
const sideEffects = (p, key, prevTech) => {
  if (key === 'cod') p.assumptions.ui.qCod = p.assumptions.ui.fin.cod;
  if (key === 'service') p.assumptions.ui.qService = SERVICE_Q[p.service] ?? null;
  if (key === 'tech' && p.tech) techSizes(p, prevTech);
};
/** A site default that follows the option's bus (not stated, and not taken from a live location or a sample). */
const siteFollowsBus = p => { const src = p.sources?.siteLat; return p.stated?.siteLat !== 'stated' && p.stated?.siteLon !== 'stated' && (!src || p.siteFrom === 'bus' || /^bus coordinate/.test(src)); };
const busLL = bus => ({ busLat: num(bus?.lat) ? bus.lat : null, busLon: num(bus?.lon) ? bus.lon : null });

/** New user project (live newProject + §6 inputs). input: field values + optional bus {busId, busName, lat, lon}. → {ok, project, errors}. */
export function newProject(input = {}, { rules = null, now = Date.now(), id = null, taken = [], bus = input.bus } = {}) {
  const p = normalize({ id: id || makeId('u', now, taken), name: '', client_type: '', tech: null, exportMW: null, importMW: null, notes: '', options: [], created: new Date(now).toISOString().slice(0, 10) }), errors = {};
  if (input.tech !== undefined) p.tech = input.tech;
  for (const [k, raw] of Object.entries(input)) {
    if (!FIELDS[k] || raw === undefined) continue; const v = coerce(k, raw), e = validateField(k, v, p);
    if (e) { errors[k] = e; continue; } if (v == null) continue; put(p, FIELDS[k].path, v); if (!FIELDS[k].text || k === 'name') p.stated[k] = 'stated'; sideEffects(p, k);
  }
  if (p.tech) techSizes(p);
  for (const k of ['name', 'tech', 'exportMW', 'importMW', 'cod']) if (!errors[k]) { const e = validateField(k, get(p, FIELDS[k].path), p); if (e) errors[k] = e; }
  applyRuleDefaults(p, rules);
  if (bus && bus.busId != null) p.options.push({ id: 'o1', busId: String(bus.busId), busName: bus.busName ?? null, ...busLL(bus), label: '', note: '', status: 'Exploring' });
  if (bus) for (const [k, c] of [['siteLat', bus.lat], ['siteLon', bus.lon]]) if (p.stated[k] !== 'stated' && num(c) && !validateField(k, c, p)) { put(p, FIELDS[k].path, c); p.stated[k] = 'default'; p.sources[k] = bus.src || `bus coordinate (${bus.busName || bus.busId})`; p.siteFrom = bus.busId != null ? 'bus' : 'site'; }
  return { ok: !Object.keys(errors).length, project: p, errors };
}

/** Change one input (the live inspInputs onchange): validate, write, mark stated, re-derive defaults. null on a defaultable input
 *  returns it to its default. → {ok, project, reason, old, value, basis} — a rejected value leaves the project untouched. */
export function setField(p0, key, raw, { rules = null } = {}) {
  const F = FIELDS[key]; if (!F) return { ok: false, project: p0, reason: `Unknown input ${key}.` };
  const v = coerce(key, raw), reason = validateField(key, v, p0), old = get(p0, F.path) ?? null;
  if (reason) return { ok: false, project: p0, reason, old };
  const p = normalize(p0); put(p, F.path, F.text ? (v ?? '') : v);
  if (v == null && !F.text) { delete p.stated[key]; delete p.sources[key]; } else if (!F.text || key === 'name') { p.stated[key] = 'stated'; delete p.sources[key]; }
  sideEffects(p, key, p0.tech); applyRuleDefaults(p, rules);
  // a tech change can leave a required size not held (solar → data centre): accepted, never 0, and reported as incomplete
  const value = get(p, F.path) ?? null;
  return { ok: true, project: p, old, value, basis: key in BASIS_FIELDS, changed: !Object.is(old, value), incomplete: incompleteOf(p) };
}
/** Required sizes a project does not hold after a tech change → {exportMW|importMW: "<label> is not held for <tech>: set it now."}. */
export function incompleteOf(p) {
  const errs = validateProject(p).errors, out = {};
  for (const k of ['exportMW', 'importMW']) if (errs[k]) { const v = get(p, FIELDS[k].path); out[k] = v == null ? `${FIELDS[k].label} is not held for ${p.tech}: set it now.` : `${FIELDS[k].label} ${sizeRule(required(k, p.tech))[1]} for ${p.tech}, not ${v}: set it now.`; }
  return out;
}
/** A value as the user reads it in a toast or a stale reason: null/blank = "not held", never "null" or blank. */
export const fmtVal = v => (v == null || v === '' ? 'not held' : String(v));
export const renameProject = (p, name) => setField(p, 'name', name);

export function addOption(p0, bus = {}, { label = '', note = '', status = 'Exploring' } = {}) {
  if (bus.busId == null || bus.busId === '') return { ok: false, project: p0, reason: 'Pick a bus.' };
  const busId = String(bus.busId); if ((p0.options || []).some(o => String(o.busId) === busId)) return { ok: false, project: p0, reason: `Bus ${bus.busName || busId} is already an option of ${p0.name}.` };
  if (!STATUSES.includes(status)) return { ok: false, project: p0, reason: `Status must be one of ${STATUSES.join(', ')}.` };
  const p = normalize(p0), option = { id: nextOptionId(p), busId, busName: bus.busName ?? null, ...busLL(bus), label, note, status }; p.options.push(option); // fix-4: the option carries its bus coordinate
  return { ok: true, project: p, option };
}
export function removeOption(p0, optionId) { const p = normalize(p0), n = p.options.length; p.options = p.options.filter(o => o.id !== optionId); return { ok: p.options.length < n, project: p.options.length < n ? p : p0 }; }
export function setOption(p0, optionId, patch = {}) {
  if (patch.status != null && !STATUSES.includes(patch.status)) return { ok: false, project: p0, reason: `Status must be one of ${STATUSES.join(', ')}.` };
  const p = normalize(p0), o = p.options.find(x => x.id === optionId); if (!o) return { ok: false, project: p0, reason: 'No such option.' };
  for (const k of ['label', 'note', 'status', 'busName']) if (patch[k] !== undefined) o[k] = patch[k]; return { ok: true, project: p, option: o };
}

export const upsertProject = (list, p) => (list.some(x => x.id === p.id) ? list.map(x => (x.id === p.id ? p : x)) : [p, ...list]);
export const deleteProject = (list, id) => list.filter(x => x.id !== id);

/** Copy a Dummy sample (or a user project) as a new user project. Sample values stay, labelled default with the sample as source. */
export function duplicateProject(src, { name = null, now = Date.now(), id = null, taken = [] } = {}) {
  const c = structuredClone(src); for (const k of ['steps', 'coverage', 'basis', 'narrative']) delete c[k];
  c.id = id || makeId('u', now, [...taken, src.id]); c.name = name || `${String(src.name || 'Project').replace(/\s*\(sample\)\s*$/i, '')} (my copy)`;
  c.created = new Date(now).toISOString().slice(0, 10); c.fromSample = src.user ? (src.fromSample ?? null) : src.id;
  c.options = (c.options || []).map(o => ({ ...o, busId: String(o.busId), busName: o.busName ?? null, label: o.label ?? '', note: o.note ?? '', status: o.status || 'Exploring' }));
  const p = normalize(c);
  if (!src.user) { const why = `Dummy sample “${src.name}”: ${src.assumptions?.label || 'illustrative inputs'}`; p.stated = {}; p.sources = {}; for (const k of Object.keys(FIELDS)) if (!FIELDS[k].text && get(p, FIELDS[k].path) != null) { p.stated[k] = 'default'; p.sources[k] = why; } }
  p.stated.name = 'stated'; return p;
}

/** The One Studio state patch for a project at an option (object or id; default the first): {tech, exportMW, importMW, nodeId, ui}. */
export function toState(p, opt, { busCoord = null } = {}) { // busCoord {lat, lon, name}: the option's bus, when the project holds no per-option site (fix-3)
  const o = typeof opt === 'string' ? p.options.find(x => x.id === opt) : opt || p.options?.[0], nodeId = o ? String(o.busId) : null, A = p.assumptions || {};
  const ui = structuredClone(A.ui || {}); for (const g of ['econ', 'fin', 'land']) ui[g] ??= {};
  ui.qCod = ui.fin.cod ?? ui.qCod ?? null; ui.qService = p.service != null ? (SERVICE_Q[p.service] ?? null) : (SERVICE_Q[ui.qService] ?? null);
  if (nodeId && num(A.optionAnnualRevenue?.[nodeId])) ui.fin.annualRevenue = A.optionAnnualRevenue[nodeId];
  // fix-4: a default site follows the CURRENT option: its recorded bus coordinate, else the caller's busCoord, else not held
  // (never another option's bus). A stated site stays; a sample's per-option site (optionSite) and a live-location default are kept.
  const siteDef = p.stated?.siteLat !== 'stated' && p.stated?.siteLon !== 'stated', os = nodeId ? A.optionSite?.[nodeId] : null;
  let siteSrc = p.sources?.siteLat ?? null;
  if (siteDef && os) { const { src, ...ll } = os; Object.assign(ui.land, ll); siteSrc = src || (!p.user ? siteSrc : `bus coordinate (${o?.busName || nodeId})`); }
  else if (siteFollowsBus(p)) {
    const c = o && num(o.busLat) && num(o.busLon) ? { lat: o.busLat, lon: o.busLon, name: o.busName ? `${o.busName} · ${nodeId}` : nodeId } : busCoord && num(busCoord.lat) && num(busCoord.lon) ? { ...busCoord, name: busCoord.name || nodeId } : null;
    ui.land.siteLat = c ? c.lat : null; ui.land.siteLon = c ? c.lon : null; siteSrc = c ? `bus coordinate (${c.name})` : null;
  }
  const inputSrc = {}; for (const k of Object.keys(FIELDS)) if (p.stated?.[k] === 'default' && p.sources?.[k]) inputSrc[k] = p.sources[k];
  delete inputSrc.siteLat; delete inputSrc.siteLon; if (siteDef && siteSrc && ui.land.siteLat != null) inputSrc.siteLat = inputSrc.siteLon = siteSrc;
  // fix-4: the full stated|default map for the dashboards: {k: {state, src (null when stated), v = the value this state holds}}.
  // A value on screen equal to v carries that state; any other value is an edit made on the dashboard.
  const inputProv = {}, at = k => { const P = FIELDS[k].path; return P[0] === 'assumptions' && P[1] === 'ui' ? get(ui, P.slice(2)) ?? null : fieldValue(p, k); };
  for (const k of Object.keys(FIELDS)) {
    if (FIELDS[k].text || k === 'tech') continue; const v = at(k);
    if (k in inputSrc && v != null) inputProv[k] = { state: 'default', src: inputSrc[k], v };
    else if (p.stated?.[k] === 'stated' && v != null) inputProv[k] = { state: 'stated', src: null, v };
  }
  return { tech: p.tech, exportMW: p.exportMW, importMW: p.importMW, nodeId, ui, siteSrc, inputSrc, inputProv };
}

/** Port of live markStale, pure: every record not yet stale becomes stale with "<label> old → new" when the field is a basis input. */
export function markStale(records, field, oldV, newV, keep = () => true) { // keep(r): only records built on this project (fix-1)
  const list = Array.isArray(records) ? records : []; if (!(field in BASIS_FIELDS)) return { records: list.map(r => ({ ...r })), n: 0, reason: null };
  if (Object.is(oldV ?? null, newV ?? null)) return { records: list.map(r => ({ ...r })), n: 0, reason: null }; // an equal value is not a change (fix-2)
  const reason = `${BASIS_FIELDS[field]} ${fmtVal(oldV)} → ${fmtVal(newV)}`; let n = 0;
  return { records: list.map(r => (r.stale || !keep(r) ? { ...r } : (n++, { ...r, stale: true, staleReason: reason }))), n, reason };
}

/** "N of M stated" over the live inspInputs field set (name, asset, size, COD, service, land, profile; DC MW solar/hybrid; duration storage/hybrid). */
export function statedCount(p) {
  const t = p.tech, fields = ['name', 'tech', ...(EXPORTS.includes(t) ? ['exportMW'] : []), ...(IMPORTS.includes(t) ? ['importMW'] : []), 'cod', 'service', 'landStatus', 'profile', ...(applies('dcMW', t) ? ['dcMW'] : []), ...(applies('duration', t) ? ['duration'] : [])];
  return { stated: fields.filter(k => p.stated?.[k] === 'stated').length, total: fields.length, fields };
}

export function loadProjects(storage) {
  try { const st = storage === undefined ? globalThis.localStorage : storage, s = st?.getItem(STORE_KEY); if (!s) return []; const j = JSON.parse(s); return j && j.v === STORE_VERSION && Array.isArray(j.projects) ? j.projects.filter(x => x && typeof x === 'object' && x.id) : []; } catch { return []; }
}
export function saveProjects(list, storage) {
  try { const st = storage === undefined ? globalThis.localStorage : storage; st.setItem(STORE_KEY, JSON.stringify({ v: STORE_VERSION, projects: list })); return true; } catch { return false; }
}

export const exportJSON = (list, { now = Date.now() } = {}) => JSON.stringify({ format: FORMAT, v: STORE_VERSION, exportedAt: new Date(now).toISOString(), projects: list }, null, 1);

/** A live-Studio project (asset, sizeMW, dcMW, durationH, cod, service, land, profile, locations[].options[]) → a user project. */
export function fromLive(lp, { rules = null, busName = () => null, now = Date.now() } = {}) {
  const tech = LIVE_ASSET[lp.asset] || lp.asset, s = lp.sizeMW, locs = Array.isArray(lp.locations) ? lp.locations : [];
  const io = tech === 'datacenter' ? [0, s] : tech === 'storage' ? [s, s] : tech === 'hybrid' ? [s, undefined] : [s, 0];
  const input = { name: lp.name, tech, exportMW: io[0], importMW: io[1], cod: lp.cod, dcMW: lp.dcMW ?? undefined, duration: lp.durationH ?? undefined, service: SERVICES.includes(lp.service) ? lp.service : undefined, landStatus: LAND_STATUSES.includes(lp.land) ? lp.land : undefined, profile: lp.profile && lp.profile !== 'none' ? lp.profile : undefined };
  const l0 = locs.find(l => num(l.lat) && num(l.lon)), { project: p } = newProject(input, { rules, now, id: lp.id || null, bus: l0 ? { lat: l0.lat, lon: l0.lon, src: `live Studio location “${l0.name || l0.id}”` } : null });
  for (const l of locs) for (const o of l.options || []) { const r = addOption(p, { busId: o.busId, busName: busName(o.busId) }, { note: o.note || '', status: STATUSES.includes(o.status) ? o.status : 'Exploring' }); if (r.ok) { const q = r.project.options.at(-1); q.id = o.id && !p.options.some(x => x.id === o.id) ? o.id : q.id; p.options = r.project.options; } }
  p.imported = { from: 'live-studio', id: lp.id ?? null, evidence: lp.evidence || [], findings: lp.findings || [], requirements: lp.requirements ?? null, decision: lp.decision ?? null };
  return p;
}

/** Import a file: own export, a bare array, a single project, or a live-Studio store ({projects:[{locations…}]}). Invalid projects are
 *  reported, not added; an id already taken (existing or reserved, e.g. the samples) gets a fresh one. → {projects, added, errors}. */
export function importJSON(text, { existing = [], reserved = [], rules = null, busName, now = Date.now() } = {}) {
  const out = existing.slice(), added = [], errors = []; let j;
  try { j = JSON.parse(text); } catch (e) { return { projects: out, added, errors: [`Not a JSON file: ${e.message}`] }; }
  if (j?.format === FORMAT && j.v !== STORE_VERSION) return { projects: out, added, errors: [`Unsupported projects file version ${j.v}.`] };
  const items = Array.isArray(j) ? j : Array.isArray(j?.projects) ? j.projects : j && typeof j === 'object' && (j.tech || j.asset) ? [j] : null;
  if (!items) return { projects: out, added, errors: ['No projects in this file.'] };
  const taken = new Set([...existing.map(x => x.id), ...reserved]);
  for (const x of items) {
    if (!x || typeof x !== 'object') { errors.push('Skipped an entry that is not a project.'); continue; }
    const q = Array.isArray(x.locations) ? fromLive(x, { rules, busName, now }) : normalize(x), errs = validateProject(q).errors;
    if (Object.keys(errs).length) { errors.push(`${q.name || x.id || '(unnamed)'}: ${Object.values(errs).join(' ')}`); continue; }
    if (!q.id || taken.has(q.id)) q.id = makeId('u', now, taken); taken.add(q.id); out.push(q); added.push(q.id);
  }
  return { projects: out, added, errors };
}
