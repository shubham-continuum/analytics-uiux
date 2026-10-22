// Economics data loader: the /api/x/economics endpoints (api_economics.py), fetched once per key and cached.
// get() returns {state:'loading'|'ok'|'missing'|'error', data?, error?}; the page re-renders when a fetch settles.
import { notifyReady } from '../dispatch-client.js';

const CACHE = new Map();

export function get(route, key, module = 'economics') {
  const k = `${module}/${route}/${key}`;
  if (CACHE.has(k)) return CACHE.get(k);
  const entry = { state: 'loading' };
  CACHE.set(k, entry);
  fetch(`./api/x/${module}/${route}/${encodeURIComponent(key)}`)
    .then(r => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(d => { if (d == null) entry.state = 'missing'; else { entry.state = 'ok'; entry.data = d; } })
    .catch(e => { entry.state = 'error'; entry.error = e.message; })
    .finally(() => notifyReady());
  return entry;
}

// S2-EM: the merged rules file (rules/isone-2026.json), read once for Economics (charge-screen window, large-load
// delivered cost). {state, data}; a missing key is reported by the card that needs it, never filled in.
let RULES = null;
export function rules() {
  if (RULES) return RULES;
  RULES = { state: 'loading' };
  const entry = RULES;
  fetch('./rules/isone-2026.json').then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(d => { entry.state = 'ok'; entry.data = d; })
    .catch(e => { entry.state = 'error'; entry.error = e.message; })
    .finally(() => notifyReady());
  return entry;
}

/** Plain-language status for a card whose data has not arrived. */
export function waitText(entry, what) {
  if (entry.state === 'loading') return `Loading ${what}…`;
  if (entry.state === 'missing') return `${what[0].toUpperCase()}${what.slice(1)} not held for this bus.`;
  if (entry.state === 'error') return `Could not load ${what}: ${entry.error}.`;
  return '';
}
