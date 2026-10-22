// Dispatch results by key: returned when solved, otherwise queued to a background worker (null = still solving).
// The page re-renders when a result arrives. Without Worker support (tests, old browsers) it solves inline.
import { batteryDispatch, hybridDispatch } from './economics.js';

const DONE = new Map(), PENDING = new Set();
let worker = null, onReady = () => {}, seq = 0;
const waiting = new Map();

export function setOnReady(fn) { onReady = fn; }
/** Re-render when other background work for the page finishes (views/economics-data.js fetches). */
export function notifyReady() { onReady(); }

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('./dispatch-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const key = waiting.get(e.data.id); waiting.delete(e.data.id); PENDING.delete(key); remember(key, e.data.result); onReady(); };
    worker.onerror = () => { worker = false; for (const k of PENDING) DONE.delete(k); PENDING.clear(); waiting.clear(); onReady(); }; // next render solves inline
  } catch { worker = false; }
  return worker;
}
function remember(key, value) { if (DONE.size > 60) DONE.delete(DONE.keys().next().value); DONE.set(key, value); }

/** kind 'battery' | 'hybrid'. Returns the result, or null while it is being solved in the background. */
export function solve(kind, key, records, config) {
  if (DONE.has(key)) return DONE.get(key);
  const w = typeof Worker === 'function' ? getWorker() : false;
  if (!w) { const r = (kind === 'hybrid' ? hybridDispatch : batteryDispatch)(records, config); remember(key, r); return r; }
  if (!PENDING.has(key)) { const id = ++seq; PENDING.add(key); waiting.set(id, key); w.postMessage({ id, kind, records, config }); }
  return null;
}
export const solving = () => PENDING.size;
