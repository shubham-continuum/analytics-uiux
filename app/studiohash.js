// Studio-parity URL contract. The live Studio (:8103) writes
//   v=stage&stage=<k>&project=<id>&option=<id>&depth=<d>&case=<sp|sh|ll>&hz=<year>&hist=<year>&cmp=<ids>&pins=<bus ids>
// (studio/src/app.js hashState/readHash). One Studio reads and writes the same keys, in the same order, and appends
// its own (tab, bus, step) after them, so one link opens the same context in both. resolveStudioHash applies a parsed
// hash the way the live readHash does; tests/hash-corpus.test.mjs holds it to 200 URLs whose expected state comes from
// the live reader itself (plan/gen_hash_corpus.mjs). Pure: no DOM.
// Provenance: forked from the analyzer preview · M5 resolver by Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v2

const LIVE_ORIGIN = 'http://127.0.0.1:8103/analytics-tab-studio.html';
const DEPTHS = ['screen', 'review', 'study'];
export const CASE_KEYS = ['sp', 'sh', 'll'];
const CASE_SCENARIO = { sp: 'summer_peak', sh: 'shoulder', ll: 'large_load' };
export const HZ_YEARS = [2030, 2035, 2040, 2045, 2050];
// The unified DB holds solved runs for 2030, 2035 and 2040. The live Studio's 2045/2050 were 2040 × 1.0816 per step
// (a flat vendor escalation, excluded from the unified DB), so those horizons have no run here.
const HZ_RUN = { 2030: 'pcr2030', 2035: 'pcr2035', 2040: 'pcr2040' };
const HIST_MIN = 2020, HIST_MAX = 2026;
const FUEL_LIVE = { solar: 'solar', wind: 'wind', storage: 'bess', hybrid: 'hybrid', datacenter: 'dc' };
const LIVE_EXTRA = new Set(['list', 'block']);
const KNOWN = new Set(['v', 'stage', 'project', 'option', 'depth', 'case', 'hz', 'hist', 'cmp', 'pins', 'tab', 'bus', 'step']);

export const fuelToStudio = tech => FUEL_LIVE[tech] || null;
export const fuelFromStudio = f => Object.keys(FUEL_LIVE).find(k => FUEL_LIVE[k] === f) || null;
export const caseScenario = k => CASE_SCENARIO[k] || null;
export const hzRun = y => HZ_RUN[Number(y)] || null;

const dec = s => { try { return decodeURIComponent(s); } catch { return s; } };
const list = s => (s ? s.split(',').map(x => x.trim()).filter(Boolean) : []);
const year = (s, ok) => { const n = Number(s); return Number.isInteger(n) && ok(n) ? n : null; };

/** Parse a live or preview hash (leading '#' optional). Invalid values become null; unknown keys are kept in `extra`. */
export function parseStudioHash(hash) {
  // seen: the known keys that carried an '=' (live: `pins=` clears the pins, a bare `pins` is absent).
  const out = { view: null, stage: null, project: null, option: null, depth: null, caseKey: null, hz: null, hist: null, cmp: [], pins: [], tab: null, bus: null, step: null, extra: [], seen: [], raw: {}, hasEq: false };
  const s = String(hash || '').replace(/^#/, '');
  if (!s) return out;
  out.hasEq = s.includes('=');
  for (const part of s.split('&')) {
    if (!part) continue;
    const i = part.indexOf('='), k = dec(i < 0 ? part : part.slice(0, i)), v = i < 0 ? '' : dec(part.slice(i + 1));
    if (!KNOWN.has(k)) { out.extra.push([k, v]); continue; }
    if (i >= 0 && !out.seen.includes(k)) out.seen.push(k);
    if (i >= 0) out.raw[k] = v;
    if (k === 'v') out.view = v || null;
    else if (k === 'stage') out.stage = v || null;
    else if (k === 'project') out.project = v || null;
    else if (k === 'option') out.option = v || null;
    else if (k === 'depth') out.depth = DEPTHS.includes(v) ? v : null;
    else if (k === 'case') out.caseKey = CASE_KEYS.includes(v) ? v : null;
    else if (k === 'hz') out.hz = year(v, n => HZ_YEARS.includes(n));
    else if (k === 'hist') out.hist = year(v, n => n >= HIST_MIN && n <= HIST_MAX);
    else if (k === 'cmp') out.cmp = list(v);
    else if (k === 'pins') out.pins = list(v);
    else if (k === 'tab') out.tab = v || null;
    else if (k === 'bus') out.bus = v || null;
    else if (k === 'step') out.step = year(v, n => n >= 1);
  }
  return out;
}

/** The seven stages One Studio renders (the live CONCERNS keys, in workflow order). */
export const ONE_STAGES = ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision'];
const STAGE_ALIAS = { iso: 'market' }; // the live ISO-wide concern is One Studio's Market board (stage strip "ISO-wide")
export const MAX_PINS = 5;
/** The live Studio's fresh-open state (snapshot app.js defaults(); pinned by tests/hash-corpus.test.mjs). */
export const LIVE_DEFAULTS = Object.freeze({ view: 'stage', stage: 'market', project: 'kennebec', option: 'o2', depth: 'review', caseKey: 'sp', hz: 2030, hist: 2025,
  cmp: Object.freeze(['o1', 'o2']), pins: Object.freeze([]), list: false, block: null });

/**
 * Apply a parsed hash to a state, in the live readHash order (project → option → depth → basis → cmp → pins), over a
 * catalogue { projects: [{ id, options: [{ id, busId, status }] }], hasBus(id) }. `prev` is the state before the link
 * (a fresh open = LIVE_DEFAULTS). Returns the context plus optionBus, bus (the preview's own key) and notices for every
 * value the live app would have taken silently or dropped silently. Intentional differences from live are listed in
 * design/progress/M5.md and pinned by tests/hash-corpus.test.mjs (stage/case/hz/hist validated, pins and cmp de-duplicated,
 * values URI-decoded). Pure.
 */
export function resolveStudioHash(h, cat, prev = LIVE_DEFAULTS) {
  const st = { ...prev, cmp: [...(prev.cmp || [])], pins: [...(prev.pins || [])] };
  const notices = [];
  const seen = new Set(h.seen || []);
  const projects = cat?.projects || [];
  const hasBus = cat?.hasBus || (() => true);
  const proj = id => projects.find(p => p.id === id) || null;
  if (!h.hasEq) return finish(); // live: a hash with no '=' changes nothing
  if (h.view) st.view = h.view;
  if (seen.has('stage') && h.stage) {
    const s = STAGE_ALIAS[h.stage] || h.stage;
    if (ONE_STAGES.includes(s)) st.stage = s; else notices.push('unknown-stage');
  }
  if (h.project) {
    const p = proj(h.project);
    if (!p) notices.push('unknown-project');
    else if (p.id !== st.project) {
      st.project = p.id;
      st.cmp = p.options.filter(o => o.status !== 'Rejected').slice(0, 2).map(o => o.id);
      st.option = p.options[0] ? p.options[0].id : null;
    }
  }
  if (h.option) { if ((proj(st.project)?.options || []).some(o => o.id === h.option)) st.option = h.option; else notices.push('unknown-option'); }
  if (h.depth) st.depth = h.depth; else if (seen.has('depth') && rawSeen(h, 'depth')) notices.push('bad-depth');
  if (h.caseKey) st.caseKey = h.caseKey; else if (seen.has('case') && rawSeen(h, 'case')) notices.push('bad-case');
  if (h.hz) st.hz = h.hz; else if (seen.has('hz') && rawSeen(h, 'hz')) notices.push('bad-hz');
  if (h.hist) st.hist = h.hist; else if (seen.has('hist') && rawSeen(h, 'hist')) notices.push('bad-hist');
  if (seen.has('cmp') && h.cmp.length) {
    const known = id => projects.some(p => p.options.some(o => o.id === id));
    st.cmp = [...new Set(h.cmp)].filter(known);
    if (st.cmp.length < new Set(h.cmp).size) notices.push('unknown-cmp');
  }
  if (seen.has('pins')) {
    const ids = [...new Set(h.pins.filter(t => /^\d+$/.test(t)).map(t => String(Number(t))))].filter(id => hasBus(id));
    if (ids.length > MAX_PINS) notices.push('pins-capped');
    if (ids.length < h.pins.length && new Set(h.pins).size === h.pins.length) notices.push('unknown-pins');
    st.pins = ids.slice(0, MAX_PINS);
  }
  const last = k => { let v; for (const [kk, vv] of h.extra || []) if (kk === k) v = vv; return v; };
  st.list = last('list') === '1';
  st.block = last('block') || null;
  if (h.bus && hasBus(h.bus)) st.bus = String(h.bus);
  return finish();
  function finish() {
    const o = (proj(st.project)?.options || []).find(x => x.id === st.option);
    st.optionBus = o ? String(o.busId) : null;
    if (st.bus && st.optionBus && st.bus !== st.optionBus) notices.push('bus-preview');
    st.extra = (h.extra || []).slice();
    st.notices = notices;
    return st;
  }
}
// A known key whose raw value was non-empty but rejected by the parser (parse keeps null for both '' and invalid).
const rawSeen = (h, k) => (h.raw ? !!h.raw[k] : true);

const enc = v => encodeURIComponent(String(v)).replace(/%2C/g, ',');
/** Write the hash: live keys in the live order, then the preview's own, then preserved unknown keys. Empty values are omitted. */
export function toStudioHash(h = {}, { live = false } = {}) {
  const kv = [];
  const put = (k, v) => { if (v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) kv.push(`${k}=${Array.isArray(v) ? v.map(enc).join(',') : enc(v)}`); };
  // A hash carrying any live-only key is a live Studio view: it gets the live 'v=stage' lead so the live app reads it.
  const liveKey = h.project || h.caseKey || h.hz || h.hist || h.cmp?.length || h.pins?.length || (h.extra || []).some(([k]) => LIVE_EXTRA.has(k));
  const view = h.view || (h.stage && (live || liveKey) ? 'stage' : null);
  put('v', view); put('stage', h.stage); put('project', h.project); put('option', h.option); put('depth', h.depth);
  put('case', h.caseKey); put('hz', h.hz); put('hist', h.hist); put('cmp', h.cmp); put('pins', live ? (h.pins || []).filter(p => /^\d+$/.test(String(p))) : h.pins);
  if (!live) { put('tab', h.tab); put('bus', h.bus); put('step', h.step); for (const [k, v] of h.extra || []) put(k, v); }
  return kv.join('&');
}

/** The equivalent live Studio link (navigation only; the preview never writes to the live app). */
export function liveStudioUrl(h) { return `${LIVE_ORIGIN}#${toStudioHash({ ...h, view: h.view || 'stage' }, { live: true })}`; }
