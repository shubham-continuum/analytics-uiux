// Grid dashboard: lazy loader for the per-bus context endpoints (api_grid.py → /api/x/grid/<name>/<bus>).
// Each (name, bus) is fetched once; when it lands, the shell re-renders. A 404 means "not held" (stored as null).
const CACHE = new Map(); // `${name}|${bus}` -> {state:'loading'|'ok'|'error', value, error}

function rerender() {
  // The shell owns rendering; import lazily so this module never creates a load-time cycle with app.js.
  import('../app.js').then(m => (m.renderSoon || m.render)?.()).catch(() => {}); // one render per frame of arrivals
}

/** {state, value} for one endpoint; starts the fetch on first call. */
export function gridData(name, bus, module = 'grid') {
  const k = `${module}|${name}|${bus}`;
  const hit = CACHE.get(k);
  if (hit) return hit;
  const rec = { state: 'loading', value: null, error: null };
  CACHE.set(k, rec);
  fetch(`./api/x/${encodeURIComponent(module)}/${encodeURIComponent(name)}/${encodeURIComponent(bus)}`)
    .then(r => (r.status === 404 ? null : r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(v => { rec.state = 'ok'; rec.value = v; rerender(); })
    .catch(e => { rec.state = 'error'; rec.error = e; rerender(); });
  return rec;
}

/** Loading / error / not-held placeholder for a card body that needs an endpoint. */
export function pending(rec, what) {
  if (rec.state === 'loading') return `<div class="loading-inline" role="status"><span class="spinner" aria-hidden="true"></span> Reading ${what} from the local database…</div>`;
  if (rec.state === 'error') return `<div class="notice error" role="alert">Could not load ${what}: ${String(rec.error?.message || rec.error).replace(/[<>&]/g, '')}</div>`;
  if (rec.value == null) return `<div class="notice">Not held: the database has no ${what} for this bus.</div>`;
  return null;
}
