// Decision's own read-only data (api_decision.py): market-position population, per-bus annual outlook, the live
// Studio's copy of a bus (older database, labelled) and the unified DB's data-quality register.
// Each request is made once; when it lands the page re-renders. A 404 means "not held", never an error.
const CACHE = new Map();
let timer = null;

function rerender() {
  clearTimeout(timer);
  timer = setTimeout(() => { import('../app.js').then(m => (m.renderSoon || m.render)?.()).catch(() => { /* page is unloading */ }); }, 40);
}

/** { state: 'loading' | 'ok' | 'nh' | 'error', data?, error? } for /api/x/decision/<route>/<key>. */
export function dx(route, key) {
  const k = `${route}/${key}`;
  if (CACHE.has(k)) return CACHE.get(k);
  CACHE.set(k, { state: 'loading' });
  fetch(`./api/x/decision/${k}`)
    .then(r => (r.status === 404 ? { state: 'nh' } : r.ok ? r.json().then(data => ({ state: 'ok', data })) : { state: 'error', error: `HTTP ${r.status}` }))
    .catch(e => ({ state: 'error', error: e.message || String(e) }))
    .then(v => { CACHE.set(k, v); rerender(); });
  return CACHE.get(k);
}
export const dxData = (route, key) => { const v = dx(route, key); return v.state === 'ok' ? v.data : null; };
