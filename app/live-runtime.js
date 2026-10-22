// GridSense One Studio: the live GS model + Charts runtime (lift plan 14, slice L2). Loads the vendored live data model
// (vendor/live/app-gs-model.js), chart renderers (app-charts.js) and the pinned 453-column data.js extract
// (app-data.json) ONCE, and merges them into the ONE window.GS / window.App the live-bridge shim made.
// Provenance: Claude Opus 5.5 (builder R-runtime) · one-studio/design 14-lift (slice L2) · 2026-10-13 · sign-off pending · v1
//
// Contract (design/14-lift-projects-configurator-continuum.md §2.3, §3 L2; tests/live-runtime.test.mjs):
//   - merge-only: a member the shim already has (nodes, node, fmt, FUELS, gates, priceAt, …: the engine's values) is
//     NEVER replaced; the vendored model's version of it is listed in GS.liveRuntime.conflicts and stays reachable on
//     GS.liveRuntime.model. Only what the shim lacks (catalog, resolve, templateOf, stat, truths, px*, …) is added.
//   - CSP allows no eval, so the two vendored files run as classic <script src>. Each assigns `window.GS = …` /
//     `window.Charts = …`; for the span of that execution the global is a trap (get = the shim, set = capture), restored
//     in `finally`. The model's price helpers read window.GS lazily (G_()), so after the merge they read the shim's
//     priceAt / priceColumn: one price basis.
//   - The extract is handed to the model inside the trap only (no window.GS_DATA global). GS.catalog carries the
//     extract's own vintage words (meta.source · meta.built_at) as a non-enumerable `vintage`; GS.liveRuntime.catalogMeta
//     adds the column / family counts and the pin.
//   - window.App: the two vendored sections define no App members; the runtime does not touch it (one App, unchanged).
//   - Never writes the URL. Ships dark: loaded only once frame.js features.configurator is on (Lead wiring, live-bridge).
export const RUNTIME_FILES = Object.freeze({ data: 'vendor/live/app-data.json', model: 'vendor/live/app-gs-model.js', charts: 'vendor/live/app-charts.js', manifest: 'vendor/live/MANIFEST.json' });

/** Copy into `target` every own member of `source` that `target` does not have (own or inherited); never reads or
 *  replaces an existing member. → { added, conflicts } (sorted names). */
export function mergeInto(target, source) {
  const added = [], conflicts = [];
  for (const k of Object.keys(source)) {
    if (k in target) { conflicts.push(k); continue; }
    Object.defineProperty(target, k, { ...Object.getOwnPropertyDescriptor(source, k), configurable: true });
    added.push(k);
  }
  return { added: added.sort(), conflicts: conflicts.sort() };
}

/** The extract's vintage in its own words (data.js meta), e.g. "ISONE_GridSense.duckdb (3.0 GB) + … · extract built 2026-09-20 05:47". */
export const vintageOf = meta => `${meta?.source ?? 'source not stated'} · extract built ${meta?.built_at ?? 'date not stated'}`;

/** Run `run()` with window[name] trapped: reads give `current`, an assignment is captured. Restores the property after. */
async function capture(win, name, current, run, extra = {}) {
  const had = Object.getOwnPropertyDescriptor(win, name), saved = Object.keys(extra).map(k => [k, Object.getOwnPropertyDescriptor(win, k)]);
  let got;
  Object.defineProperty(win, name, { configurable: true, enumerable: true, get: () => current, set: v => { got = v; } });
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(win, k, { configurable: true, enumerable: false, writable: true, value: v });
  try { await run(); } finally {
    if (had) Object.defineProperty(win, name, had); else delete win[name];
    for (const [k, d] of saved) { if (d) Object.defineProperty(win, k, d); else delete win[k]; }
  }
  return got;
}

function browserIO(win) {
  const doc = win.document;
  return {
    loadScript: src => new Promise((res, rej) => {
      const el = doc.createElement('script'); el.src = `./${src}`; el.async = false; el.setAttribute('data-gsx-vendor', `./${src}`);
      el.onload = () => res(); el.onerror = () => rej(new Error(`could not load ${src}`));
      doc.head.appendChild(el);
    }),
    fetchJson: async src => { const r = await win.fetch(`./${src}`); if (!r.ok) throw new Error(`HTTP ${r.status} for ${src}`); return r.json(); },
  };
}

const ONCE = new WeakMap();
/** Load the vendored GS model + Charts once per window and merge them into window.GS (and window.Charts). → the
 *  status object also set on GS.liveRuntime. A failed load rejects (naming the file), adds nothing, and may be retried. */
export function bootLiveRuntime(win = globalThis.window, io = browserIO(win)) {
  if (ONCE.has(win)) return ONCE.get(win);
  const p = load(win, io);
  ONCE.set(win, p);
  p.catch(() => ONCE.delete(win));
  return p;
}

async function load(win, { loadScript, fetchJson }) {
  const GS = win.GS;
  if (!GS || typeof GS !== 'object') throw new Error('live-runtime: window.GS (the live-bridge shim) is not there yet');
  const [D, man] = await Promise.all([fetchJson(RUNTIME_FILES.data), fetchJson(RUNTIME_FILES.manifest).catch(() => null)]);
  if (!D || !Array.isArray(D.columns)) throw new Error(`live-runtime: ${RUNTIME_FILES.data} holds no column list`);
  const model = await capture(win, 'GS', GS, () => loadScript(RUNTIME_FILES.model), { GS_DATA: D });
  if (!model || typeof model !== 'object') throw new Error(`live-runtime: ${RUNTIME_FILES.model} did not define window.GS`);
  const prevCharts = win.Charts;
  const charts = await capture(win, 'Charts', prevCharts, () => loadScript(RUNTIME_FILES.charts));
  if (!charts || typeof charts !== 'object') throw new Error(`live-runtime: ${RUNTIME_FILES.charts} did not define window.Charts`);
  const vintage = vintageOf(D.meta), pinRec = man?.files?.['app-data.json'] || {};
  Object.defineProperty(model.catalog, 'vintage', { value: vintage, enumerable: false });
  const gs = mergeInto(GS, model);
  let ch = { added: Object.keys(charts).sort(), conflicts: [] };
  if (prevCharts && typeof prevCharts === 'object') ch = mergeInto(prevCharts, charts); else win.Charts = charts;
  const status = {
    model, vintage,
    catalogMeta: { columns: D.columns.length, families: model.catalog.length, vintage, pin: pinRec.snapshot ?? null, source: pinRec.source ?? null, sha256: pinRec.source_sha256 ?? null },
    added: { GS: gs.added, Charts: ch.added }, conflicts: { GS: gs.conflicts, Charts: ch.conflicts },
  };
  mergeInto(GS, { liveRuntime: status });
  return status;
}
