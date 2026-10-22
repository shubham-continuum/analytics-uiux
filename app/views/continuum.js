// GridSense One Studio: the LMP Continuum as its own module (lift plan 14, slice L4).
// Provenance: Claude Opus 5.5 (builder C-continuum) · one-studio/design/14-lift-projects-configurator-continuum.md L4 · 2026-10-13 · sign-off pending · v1
//
// The live Studio's Continuum (ext/59 core + api client, ext/60 screen host, ext/61-64 and 68 panels) is vendored whole
// into vendor/live/continuum/ by plan/vendor_live.py (MANIFEST `continuum`; patches C1 host mount, C2 host CSS) and
// loaded here once, after the bridge (live-bridge.js) has put the one page App / GS / Views globals on the page —
// ext/60 idles if they are missing at load. Data goes through One Studio's GET proxy (server.py, CSP connect-src 'self'):
// window.GSX_CONTINUUM_API = '/api/proxy/continuum'. A proxy 502/504 or no answer is a banner above the painted
// Continuum (its own panels then show their written empty states), never a blank stage and never a silent fallback.
//
// mount(host, ctx[, deps]) -> handle. ctx = {bus | zone | hub, project, option, caseKey, hz, hist, onHash?}.
//   - one .gsx-cont box per host (window.GSX_CONTINUUM_HOST, read by patch C1); a second mount re-scopes and repaints;
//   - scope: bus, else zone, else the hub; hz -> the focus year (ST.year), hist -> the settled hourly year (ST.hourYear);
//   - no URL writes: handle.hash() returns {case, hz, hist} for studiohash.js, and ctx.onHash(h) fires when they change.
import { parseStudioHash, HZ_YEARS } from '../studiohash.js';

export const CONT_API = '/api/proxy/continuum';
export const CONT_HOURS_API = `${CONT_API}/api/v2/prices/hours`; // ext/61's route: outside the proxy allow-list today (L0 note)
const DIR = 'vendor/live/continuum/';
/** Load order (MANIFEST.continuum.order): the core first, the screen host second, then the modules that hook it. */
export const CONT_FILES = ['59-continuum-core.js', '60-cathy.js', '60-cathy.css', '61-hourly-timeline.js', '61-hourly-timeline.css',
  '62-continuum-shape.js', '62-continuum-shape.css', '63-continuum-drivers.js', '63-continuum-drivers.css',
  '64-continuum-value.js', '64-continuum-value.css', '68-continuum-emissions.js', '68-continuum-emissions.css'].map(f => DIR + f);

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const busNum = v => (v != null && /^\d+$/.test(String(v).trim()) ? Number(v) : null);
const hzOk = v => (HZ_YEARS.includes(Number(v)) ? Number(v) : null);
const histOk = v => (v == null ? null : parseStudioHash(`hist=${v}`).hist);

// ---------- pure: scope, hash, banner ----------
/** The Continuum scope for a One Studio context: a bus, else a load zone, else the hub (its rows are keyed HUB). */
export function scopeFor(ctx) {
  const c = ctx || {}, b = busNum(c.bus);
  if (b != null) return { kind: 'bus', key: b };
  if (c.zone) return { kind: 'zone', key: String(c.zone) };
  return { kind: 'hub', key: c.hub ? String(c.hub) : 'HUB' };
}
/** case/hz/hist from a hash string or a parseStudioHash result; an invalid value is null (studiohash's own rules). */
export function ctxFromHash(h) {
  const p = typeof h === 'string' ? parseStudioHash(h) : h || {};
  return { caseKey: p.caseKey ?? null, hz: p.hz ?? null, hist: p.hist ?? null };
}
/** ctx -> the fields of ext/60's state (GSCathy.state) this module sets. */
export function stateFor(ctx) {
  const s = scopeFor(ctx), c = ctx || {};
  return { scopeKind: s.kind, scopeKey: s.key, year: hzOk(c.hz), hourYear: histOk(c.hist) };
}
/** The Continuum state -> the hash keys to write. case is the grid case: the Continuum never changes it, so it passes through. */
export function hashFor(st, ctx) {
  const s = st || {}, c = ctx || {};
  return { case: c.caseKey ?? null, hz: hzOk(s.year) ?? hzOk(c.hz), hist: histOk(s.hourYear) ?? histOk(c.hist) };
}
/** An ext/59 api result -> the banner to show, or null when the service answered. */
export function bannerFor(res) {
  if (!res || res.ok) return null;
  const body = res.body && typeof res.body === 'object' ? res.body : {};
  const tail = 'The Continuum panels that read the service show their own empty states until it answers.';
  if (res.state === 'offline') return { kind: 'offline', title: 'Continuum service offline', detail: `${res.why || 'the One Studio proxy did not answer'}. ${tail}` };
  if (res.status === 502 || res.status === 504) {
    return { kind: 'down', title: body.error || `HTTP ${res.status} from the Continuum proxy`,
      detail: `One Studio's proxy could not read the LMP Continuum service${body.target ? ` at ${body.target}` : ''}${body.why ? ` (${body.why})` : ''}. ${tail}` };
  }
  return { kind: 'error', title: body.error || res.why || `HTTP ${res.status}`, detail: `${res.why && res.why !== body.error ? res.why + '. ' : ''}${tail}` };
}

// ---------- loading (once per window) ----------
const LOADS = new WeakMap();
function domLoad(win, doc) {
  const base = String(win.GSX_CONTINUUM_BASE || './');
  const one = f => new Promise((ok, bad) => {
    const css = f.endsWith('.css'), n = doc.createElement(css ? 'link' : 'script');
    n.setAttribute('data-gsx-cont', f.split('/').pop());
    if (css) { n.rel = 'stylesheet'; n.href = base + f; } else { n.src = base + f; n.async = false; }
    n.onload = () => ok(); n.onerror = () => bad(new Error(`${f.split('/').pop()} failed to load`));
    doc.head.appendChild(n);
  });
  return CONT_FILES.reduce((p, f) => p.then(() => one(f)), Promise.resolve());
}
function loadOnce(win, doc, load) {
  if (!LOADS.has(win)) {
    const p = (load ? load(CONT_FILES) : domLoad(win, doc)).then(() => {
      if (!win.GSCathy || !win.GSContinuum) throw new Error('the Continuum module did not start (window.App/GS/Views missing at load, see the console)');
    });
    p.catch(() => LOADS.delete(win)); // a failed load may be retried
    LOADS.set(win, p);
  }
  return LOADS.get(win);
}
function bridgeReady(win, ms) {
  if (win.App && win.GS) return Promise.resolve();
  return new Promise((ok, bad) => {
    const t = setTimeout(() => { win.removeEventListener('gsbridge:ready', f); bad(new Error(`the Studio data did not load within ${Math.round(ms / 1000)} s`)); }, ms);
    function f() { if (!(win.App && win.GS)) return; clearTimeout(t); win.removeEventListener('gsbridge:ready', f); ok(); }
    win.addEventListener('gsbridge:ready', f);
  });
}

// ---------- mount ----------
const BOXES = new WeakMap(); // host -> {box, ban, ctx, last, h}
function showBanner(ban, b, retry) {
  if (!b) { ban.hidden = true; ban.innerHTML = ''; return; }
  ban.hidden = false;
  ban.setAttribute('data-kind', b.kind);
  ban.innerHTML = `<b>${esc(b.title)}</b> <span>${esc(b.detail)}</span>${retry ? ' <button type="button" class="btn sm" data-gsx-cont-retry>Retry</button>' : ''}`;
}

export async function mount(host, ctx, deps = {}) {
  const win = deps.win || window, doc = deps.doc || document;
  win.GSX_CONTINUUM_API = CONT_API;
  win.GSX_HOURS_API = CONT_HOURS_API;
  let rec = BOXES.get(host);
  if (!rec) {
    const box = doc.createElement('div'); box.className = 'gsx-cont'; box.setAttribute('data-gsx', 'continuum');
    box.style.cssText = 'display:flex;flex-direction:column;min-height:0;height:100%';
    const ban = doc.createElement('div'); ban.className = 'gsx-cont-banner notice'; ban.setAttribute('role', 'status'); ban.hidden = true;
    box.appendChild(ban); host.appendChild(box);
    rec = { box, ban, ctx: null, last: null, h: null };
    BOXES.set(host, rec);
    ban.addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('[data-gsx-cont-retry]') && rec.h) rec.h.retry(); });
    const changed = () => setTimeout(() => {
      const C = win.GSCathy; if (!C || !rec.ctx) return;
      const h = hashFor(C.state, rec.ctx), k = JSON.stringify(h);
      if (k !== rec.last) { rec.last = k; if (typeof rec.ctx.onHash === 'function') rec.ctx.onHash(h); }
    }, 0);
    box.addEventListener('click', changed); box.addEventListener('change', changed);
  } else if (rec.box.parentNode !== host) host.appendChild(rec.box);
  rec.ctx = ctx || {};
  const { box, ban } = rec;
  win.GSX_CONTINUUM_HOST = box;
  const h = rec.h || (rec.h = {
    box, banner: null, scope: null,
    hash: () => hashFor(win.GSCathy ? win.GSCathy.state : stateFor(rec.ctx), rec.ctx),
    async retry() {
      const C = win.GSContinuum; if (!C) return mount(host, rec.ctx, deps);
      const res = await C.api.status({ fresh: true });
      h.banner = bannerFor(res); showBanner(ban, h.banner, !!h.banner);
      if (res.ok) await C.live.connect(true);
      return h;
    },
    unmount() { try { if (win.GSCathy) win.GSCathy.close(true); } catch (e) { console.warn('[continuum] close: ' + e.message); } box.remove(); BOXES.delete(host); },
  });
  h.scope = scopeFor(rec.ctx);
  try {
    if (!(win.App && win.GS)) {
      showBanner(ban, { kind: 'loading', title: 'Waiting for the Studio data', detail: 'The LMP Continuum opens once the map and grid data have loaded.' }, false);
      await bridgeReady(win, deps.bridgeMs || 120000);
    }
    await loadOnce(win, doc, deps.load);
  } catch (e) {
    h.banner = { kind: 'error', title: 'The LMP Continuum could not start', detail: (e && e.message) || String(e) };
    showBanner(ban, h.banner, true);
    return h;
  }
  const C = win.GSCathy, ST = C.state, want = stateFor(rec.ctx);
  Object.assign(ST, want, { followed: { kind: want.scopeKind, key: want.scopeKey } });
  try {
    if (C.on) C.paint(); else C.open();
    if (ST.scopeKind !== want.scopeKind || ST.scopeKey !== want.scopeKey) { // open() follows the project's option: the stage's scope wins
      Object.assign(ST, { scopeKind: want.scopeKind, scopeKey: want.scopeKey, followed: { kind: want.scopeKind, key: want.scopeKey } });
      C.paint();
    }
  } catch (e) {
    h.banner = { kind: 'error', title: 'The LMP Continuum could not draw', detail: (e && e.message) || String(e) };
    showBanner(ban, h.banner, true);
    return h;
  }
  rec.last = JSON.stringify(hashFor(ST, rec.ctx));
  const res = await win.GSContinuum.api.status({ fresh: true });
  h.banner = bannerFor(res);
  showBanner(ban, h.banner, !!h.banner);
  if (res.ok) await win.GSContinuum.live.connect();
  return h;
}
