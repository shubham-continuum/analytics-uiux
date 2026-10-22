// Grid v6 trace: the "Network around the bus" map classification (limiting vs pre-existing, rating basis, what is drawn).
import { trace } from '../trace.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);

export function traceNetMap(busId, m) {
  if (!m) return '';
  // Independent recount from the raw rows (own code, not the model's grouping).
  const pre = new Set(), lim = new Set();
  for (const r of m.rows) {
    const isPre = ok(r.pct_loading_no_transfer) && Math.abs(r.pct_loading_no_transfer) >= 100;
    if (!isPre && ok(r.transfer_mw) && r.transfer_mw > 0) lim.add(r.key); else if (isPre) pre.add(r.key);
  }
  const preOnly = [...pre].filter(k => !lim.has(k)).length;
  const drawn = m.facilities.filter(f => f.drawn).length;
  return trace({
    id: 'g-netmap', title: 'Network around the bus: what is drawn and how each facility is classed',
    formula: 'limiting = has a row not pre-existing with transfer > 0;  pre-existing = |loading before the project| ≥ 100 % in every row;  rating = rate A (base-case row) or rate C (contingency row)',
    inputs: [{ name: 'Branches within the radius', value: `${m.counts.branches} within ${m.radius} mi`, source: 'measured', note: 'dim_branch, ends placed from dim_bus latitude/longitude' },
      { name: 'Facility rows of this bus', value: `${m.rows.length} in the cases this service uses`, source: 'measured', note: 'fact_limiting_element; shoulder export rows excluded (store mislabel)' },
      { name: 'Pre-existing threshold', value: '|loading| ≥ 100 %', source: 'rule', note: 'settled grid rule; counter-flow counts' },
      { name: 'Rating basis', value: 'rate A base case · rate C contingency', source: 'rule', note: 'gridrules.loadingBasis' }],
    steps: [...m.facilities.slice(0, 14).map(f => ({ label: f.label, work: `${f.rows} row(s), ${f.preRows} pre-existing · ${f.cases.map(r => `${r.caseLabel} rate ${r.rate} ${ok(r.rating) ? Math.round(r.rating) : 'n/h'} MVA`).join('; ')}`, value: `${f.limiting ? 'limiting' : 'pre-existing'}${f.drawn ? '' : ' · not drawn'}` })),
      { label: 'Drawn', work: `${drawn} of ${m.facilities.length} facilities have both ends placed`, value: `${m.facilities.length - drawn} not drawn` },
      { label: 'Branches not drawn', work: 'one end inside the radius, the other end without a dim_bus coordinate', value: String(m.counts.branchNotDrawn ?? 'not held') }],
    result: { label: 'Limiting · pre-existing', value: `${m.counts.lim} · ${m.counts.pre}` },
    checks: [{ label: 'Independent recount of limiting facilities from the raw rows', a: lim.size, b: m.counts.lim, atol: 0, fmt: v => String(v) },
      { label: 'Independent recount of pre-existing-only facilities from the raw rows', a: preOnly, b: m.counts.pre, atol: 0, fmt: v => String(v) },
      { label: 'Consistency check: drawn + not drawn = facilities', a: drawn + m.counts.facNotDrawn, b: m.facilities.length, atol: 0, fmt: v => String(v) }],
    notes: ['A facility end without a coordinate is counted and not drawn; nothing is placed at 0,0.', 'Facilities beyond the radius are still drawn; the map widens to include them.'],
    csv: { name: `grid-netmap-${busId}.csv`, meta: [['bus', busId], ['radius_mi', m.radius]], columns: ['facility', 'key', 'kv', 'class', 'rows', 'pre_rows', 'min_transfer_mw', 'drawn', 'miles'], rows: m.facilities.map(f => [f.label, f.key, f.kv, f.limiting ? 'limiting' : 'pre-existing', f.rows, f.preRows, f.minTransfer, f.drawn, f.mi]) },
  });
}
