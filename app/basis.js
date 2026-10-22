// Analysis basis: the single shared description of which prices an analysis uses.
// Rules (merged plan): historical and forecast are separate modes; forecast is one named run;
// strict coverage by default; the price source is always the bus's own series (one bus, one price).
import { finite } from './prices.js';

export const LABELS = {
  RT: 'Real-time', DA: 'Day-ahead', model: 'Model',
  '5yr': '2028 forecast (5-yr run)', '10yr': '2035 forecast (10-yr run)',
  pcr2030: '2030 forecast', pcr2035: '2035 forecast', pcr2040: '2040 forecast (12% gas case)',
  duration: 'Observed-hour weighted', equal: 'Equal-year weighted', custom: 'Custom weights',
};

export function defaultBasis(data, nodeId) {
  const years = availableYears(data, nodeId, 'historical', 'RT');
  const complete = years.filter(y => y.complete).map(y => y.year);
  return { nodeId, mode: 'historical', market: 'RT', run: null, years: complete.slice(-1), weighting: 'duration', weights: {}, strict: true, includePartial: false };
}

/** Years held for a node/mode/market (or run), with coverage. */
export function availableYears(data, nodeId, mode, marketOrRun) {
  return data.series
    .filter(s => String(s.nodeId) === String(nodeId) && s.mode === mode && (mode === 'forecast' ? s.run === marketOrRun : s.market === marketOrRun))
    .map(s => ({ year: s.year, complete: !!s.complete, coverage: s.coverage, run: s.run, market: s.market }))
    .sort((a, b) => a.year - b.year);
}

export function forecastRuns(data, nodeId) {
  const seen = new Map();
  for (const s of data.series) if (String(s.nodeId) === String(nodeId) && s.mode === 'forecast') seen.set(s.run, s.year);
  return [...seen].map(([run, year]) => ({ run, year })).sort((a, b) => a.year - b.year || a.run.localeCompare(b.run));
}

/** Core expects basis.market='model' for forecasts. */
export function coreBasis(b) {
  return b.mode === 'forecast' ? { ...b, market: 'model', strict: b.strict, includePartial: b.includePartial } : b;
}

export function describe(b) {
  if (!b) return '—';
  const src = b.mode === 'forecast' ? (LABELS[b.run] || b.run) : `Historical · ${LABELS[b.market] || b.market}`;
  const yrs = b.mode === 'forecast' ? '' : ` · ${b.years.join(', ')}`;
  return `${src}${yrs} · ${LABELS[b.weighting]}${b.strict ? '' : ' · available years only'}`;
}

export function basisHash(b) {
  return JSON.stringify([b.nodeId, b.mode, b.market, b.run, [...b.years].sort(), b.weighting, b.weighting === 'custom' ? b.weights : 0, b.strict, b.includePartial]);
}

export const fmt = {
  price: v => (finite(v) ? `${v < 0 && v.toFixed(2) !== '-0.00' ? '−' : ''}$${Math.abs(v).toFixed(2)}` : 'not held'),
  pct: v => (finite(v) ? `${v.toFixed(1)}%` : 'not held'),
  mw: v => (finite(v) ? `${Math.abs(v - Math.round(v)) < 1e-9 ? v.toFixed(0) : v.toFixed(1)} MW` : 'not held'),
  money: v => { if (!finite(v)) return 'not held'; const a = Math.abs(v), s = a >= 1e6 ? `$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(0)}k` : `$${a.toFixed(0)}`; return (v < 0 && s !== '$0' ? '−' : '') + s; },
  int: v => (finite(v) ? Math.round(v).toLocaleString('en-US') : 'not held'),
};
