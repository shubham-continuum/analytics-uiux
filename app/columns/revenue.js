// Grid columns (S4): capacity $/kW-mo for the COD year and expected Pay-for-Performance $/kW-yr, from rules/revenue.js.
// Provenance: Claude Opus 5.5 (S4 agent) · one-studio/design (T3, slice S4) · 2026-10-06 · sign-off pending · v1
//
// Column defs in the vendored registry shape (31-map-grid.js C(): id, key, label, unit, family, source, type, dp, get, why,
// hint). The lead registers them through the bridge (S4.md › Lead wiring). Values are per kW of nameplate MW, engine-class:
// the same functions the Economics cards call. Null = not held, with a why.
import { capacityPath, pfpReplay, storageOutput, solarClearSky } from '../rules/revenue.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const KW = 1000, MONTHS = 12;
const TECH = { bess: 'storage', storage: 'storage', solar: 'solar', wind: 'wind', hybrid: 'hybrid', dc: 'datacenter', datacenter: 'datacenter' };
export const REVENUE_COLUMN_IDS = ['cap_cod', 'pfp_exp'];

// capacityPath reads the scope only (never the bus): one path per rules object and scope, not one per bus and column.
const PATHS = new WeakMap();
function pathOf(R, opts) {
  let m = PATHS.get(R);
  if (!m) PATHS.set(R, m = new Map());
  const k = JSON.stringify(opts);
  if (!m.has(k)) { if (m.size > 200) m.clear(); m.set(k, capacityPath(R, opts)); }
  return m.get(k);
}

/** {value, why} for one column at one bus. ctx {tech, mw, cod, regime, band, userPath, mricPrice, durationH, fca18Cso, qc}. */
export function columnValue(id, node, ctx, R) {
  if (!R) return { value: null, why: 'Not held: the rules file is still loading' };
  const tech = TECH[ctx?.tech] || ctx?.tech, mw = Number(ctx?.mw);
  if (tech === 'datacenter') return { value: null, why: 'n/a: a load earns no capacity or PfP revenue' };
  if (!ok(mw) || mw <= 0) return { value: null, why: 'Not held: no project size (MW)' };
  const path = pathOf(R, { ...ctx, tech, mw, years: ctx.years ?? 4 });
  if (!path.rows.length) return { value: null, why: `Not held: ${path.reason}` };
  const row = path.firstFull;
  if (id === 'cap_cod') {
    if (!row) { const r0 = path.rows.find(r => r.status !== 'ok') || path.rows[0]; return { value: null, why: `Not held: ${r0.reason || 'no full commitment period in range'}` }; }
    return { value: row.revenue / (mw * KW * MONTHS), why: '' };
  }
  if (id === 'pfp_exp') {
    const capRow = row || path.rows.find(r => r.status === 'ok');
    if (!capRow) return { value: null, why: `Not held: no capacity obligation (${path.rows[0].reason})` };
    const output = tech === 'storage' ? storageOutput(mw, ctx.durationH ?? 4) : tech === 'solar' ? solarClearSky(mw, Number(node?.lat ?? NaN), Number(node?.lon ?? NaN)) : null;
    if (!output) return { value: null, why: tech === 'solar' ? 'Not held: the bus location is not held, so no clear-sky output at the event times' : `Not held: no ${tech} output shape at the event times` };
    const pf = pfpReplay(R, { cso: capRow.mwAccredited, mw, output, capPrice: ok(capRow.price) ? capRow.price : null });
    return pf.status === 'ok' ? { value: pf.perKwYr, why: '' } : { value: null, why: `Not held: ${pf.reason}` };
  }
  return { value: null, why: `Unknown column ${id}` };
}

/** Column defs; getCtx() → the scope ({tech, mw, cod, …}); getRules() → the merged rules object (or null while loading). */
export function revenueColumns(getCtx, getRules) {
  const memo = new Map();
  const val = (id, n) => {
    const ctx = getCtx(), R = getRules(), k = JSON.stringify([id, n?.bus_id, n?.lat, n?.lon, ctx, !!R]);
    if (!memo.has(k)) { if (memo.size > 20000) memo.clear(); memo.set(k, columnValue(id, n, ctx, R)); }
    return memo.get(k);
  };
  const base = { type: 'num', dp: 2, sort: -1, fuels: 'all', hideFor: ['dc'], family: 'Economics' };
  return [
    { ...base, id: 'cap_cod', key: 'cap_cod', label: 'Capacity (COD yr)', unit: '$/kW-mo', source: 'engine: rules/revenue.js capacityPath (first full CCP after COD)',
      get: r => val('cap_cod', r.n).value, why: r => val('cap_cod', r.n).why,
      hint: 'Capacity revenue in the first full commitment period after COD, per kW of nameplate per month: accreditation (current QC, or CAR-SA rMRI) × the period\'s price. After FCA 18 the price is the user path (prefilled from cleared history, flat). Same value at every bus: ISO-NE clears one system price since FCA 17.' },
    { ...base, id: 'pfp_exp', key: 'pfp_exp', label: 'PfP expected', unit: '$/kW-yr', source: 'engine: rules/revenue.js pfpReplay (the CSC record in rules pfp.events at today\'s PPR, BR capped)',
      get: r => val('pfp_exp', r.n).value, why: r => val('pfp_exp', r.n).why,
      hint: 'Expected Pay-for-Performance per kW of nameplate per year: the seven Capacity Scarcity Conditions since 2018 replayed at today\'s rate against the obligation, with the stop-loss. Solar uses a clear-sky shape at the bus (assumption); storage is full power for its duration if charged.' },
  ];
}
