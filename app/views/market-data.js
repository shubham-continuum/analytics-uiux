// Market extras loader: the /api/x/market aggregates (unified database) and the Studio copy
// (data/market-studio.json, written by plan/extract_market.py from the live Studio's data files, read-only).
// Each source loads once; the page re-renders when it lands. A failed source says so on its cards.
import { attachMeasures, attachCurtailment } from '../marketcore.js';

const SOURCES = {
  measures: './api/x/market/measures/all',
  zones: './api/x/market/zones/all',
  system: './api/x/market/system/all',
  supply: './api/x/market/supply/all',
  studio: './data/market-studio.json',
  curtail: './data/market-curtail.json', // PCR-run curtailment by modelled resource (plan/extract_market_curtail.py, unified DB)
};
const X = {}, ERR = {}, LOADING = new Set();
let rerender = null;

function done() {
  if (rerender) { rerender(); return; }
  import('../app.js').then(m => { rerender = m.renderSoon || m.render; rerender(); }).catch(() => {});
}

// One request at a time, with retries: the preview server has a small listen backlog and refuses connections
// when many requests arrive together (seen as "Failed to fetch").
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); last = new Error(`HTTP ${r.status}`); if (r.status === 404) break; } catch (e) { last = e; }
    await sleep(800 * (i + 1));
  }
  throw last;
}
let chain = null;
/** Start any source not yet loaded (sequentially). */
export function ensureExtras() {
  if (chain) return;
  const todo = Object.keys(SOURCES).filter(k => !X[k] && !ERR[k]);
  if (!todo.length) return;
  todo.forEach(k => LOADING.add(k));
  chain = (async () => {
    for (const k of todo) {
      try { X[k] = await get(SOURCES[k]); } catch (e) { ERR[k] = e.message || 'failed'; }
      LOADING.delete(k); done();
    }
  })().finally(() => { chain = null; });
}

/** The measures overlay is applied once per loaded study (the study object is replaced on reload). */
export function withMeasures(study) {
  if (X.measures && study && study.measures !== X.measures) { const r = attachMeasures(study, X.measures); study.unpricedFixed = r.unpricedFixed; return true; }
  return false;
}

/** The curtailment extract is attached once per loaded study (node.curt[run][type] within 25 km). */
export function withCurtail(study) {
  if (X.curtail && study && study.curtail?.extract !== X.curtail) { attachCurtailment(study, X.curtail); return true; }
  return false;
}

export const extra = k => X[k] || null;
export const extraError = k => ERR[k] || null;
export const extraLoading = k => LOADING.has(k) || (!X[k] && !ERR[k]);
