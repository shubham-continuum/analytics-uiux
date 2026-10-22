// Prices dashboard: read-only loader for the per-bus aggregate endpoints in api_prices.py
// (GET /api/x/prices/<name>/<key>). Each request is made once per page; the view re-renders when it lands.
// A 404 is "not held" (status 'none'), never an empty result dressed up as zero.
const CACHE = new Map();
let timer = null;

function rerender() {
  clearTimeout(timer);
  // Dynamic import: the shell imports this view, so a static import back into app.js would be circular at load.
  timer = setTimeout(() => { import('../app.js').then(m => (m.renderSoon || m.render)()).catch(() => {}); }, 40);
}

/** { status: 'loading' | 'ok' | 'none' | 'error', data, error } for one endpoint module, name and key. */
export function xd(module, name, key) {
  const k = `${module}/${name}/${key}`;
  let e = CACHE.get(k);
  if (e) return e;
  e = { status: 'loading', data: null, error: null };
  CACHE.set(k, e);
  if (typeof fetch !== 'function') { e.status = 'error'; e.error = new Error('no fetch'); return e; }
  fetch(`./api/x/${module}/${name}/${encodeURIComponent(key)}`)
    .then(r => (r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(d => { e.status = d == null ? 'none' : 'ok'; e.data = d; rerender(); })
    .catch(err => { e.status = 'error'; e.error = err; rerender(); });
  return e;
}

/** Prices endpoints (api_prices.py). */
export const px = (name, key) => xd('prices', name, key);

/**
 * ISO-NE fleet wind/solar output by clock hour (unified fact_genfuel_hourly), read-only through the Economics
 * endpoint that already serves it (api_economics.py › profile/all), so both dashboards use one shape.
 */
export const fleetProfile = () => xd('economics', 'profile', 'all');

/** Data when loaded, else null (callers render a loading or not-held state from px().status). */
export const pxData = (name, key) => { const e = px(name, key); return e.status === 'ok' ? e.data : null; };
