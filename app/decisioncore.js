// Decision core (v2, after review): compare candidate options by reading every other dashboard's
// core (one number, one home). Unknown never passes; no min–max preference score (both plans rule
// it out) — options are compared on raw values; stress counts are not probabilities.
import { analyzePrices, dailySpreads } from './prices.js';
import { generationRevenue, stampHour } from './economics.js';
import { clearSky } from './solar.js';
import { caseTable, binding, stepCostService, ENVELOPE_ONLY, unstudiedCases, STUDY_VINTAGE, serviceTag } from './gridrules.js';
import { nearby } from './queuecore.js';
import { footprint, screen, fit } from './landcore.js';
import { coreBasis, availableYears, forecastRuns } from './basis.js';
import { userThresholds } from './decisionpack.js';
import { loadEnergyCost } from './economics-load.js';
import { verdictLine } from './v2copy.js';
import { decisionTaxGate } from './views/cards-finance.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);

// Copy of the Economics defaults (views/economics.js DEFAULTS, not exported there): keep in step with that file.
export const ECON_DEFAULTS = { solarCF: 15, windCF: 32.5, lossPct: 3 };
/** Losses at the Economics default are a placeholder there (tag 'P'); say so wherever they are shown. */
export const LOSS_PLACEHOLDER_NOTE = 'placeholder: inverter and collection losses';
// Queue linkage (queue review): only these register requests carry a bus link; the rest are not assessed.
export const QUEUE_REGISTER_APPROX = '~1,751';

/** Upgrade cost as text, the same rule wherever Decision shows it: no dollar figure for "no upgrades indicated". */
export function costText(cost) {
  const s = cost?.status, t = cost?.total;
  if (s === 'No upgrades indicated') return 'none indicated (unverified)';
  if (s === 'Not requested') return 'not requested';
  if (!ok(t) || !['Lower bound', 'Partly priced', 'Priced', 'True zero'].includes(s)) return 'not held';
  return `${['Lower bound', 'Partly priced'].includes(s) ? '≥ ' : ''}$${t.toFixed(2)}M`;
}

/** Requested cases whose governing value is the vendor envelope only (unreconciled with any element study). */
export function envelopeOnlyCases(table) {
  return table.filter(r => r.status !== 'Not requested' && /^Envelope only/.test(r.basis || '')).map(r => r.label);
}

/** Cape 5-yr exclusion: flagged bus priced on the 5-yr run → not used in comparisons. */
export function cape5Excluded(data, node, basis) {
  return !!data.flags?.buses?.[String(node.id)] && basis?.mode === 'forecast' && basis?.run === '5yr';
}
const CAPE5_REASON = '5-yr run input under review at this Cape bus: not used in comparisons';

/** The Economics revenue method, shared: clear-sky (solar) or flat (wind) shape scaled to CF and capped at nameplate, losses applied, then clipped at the export limit; annualised on observed hours. */
export function revenueFor(data, node, basis, tech, mw, { cf, lossPct = ECON_DEFAULTS.lossPct, exportLimit = null, fleet = null } = {}) {
  if (!['solar', 'wind', 'hybrid'].includes(tech)) return { value: null, reason: tech === 'datacenter' ? 'A load has no energy revenue; compare the load cost instead' : 'Energy revenue comparison covers solar, wind and hybrid PV; value storage in Economics › BESS dispatch' };
  const res = analyzePrices(data, coreBasis({ ...basis, nodeId: String(node.id) }));
  if (!res.summary) return { value: null, reason: res.errors.join(' ') || 'No prices on this basis' };
  const rows = res.rows, cap = ok(exportLimit) ? Math.min(mw, exportLimit) : mw;
  // Wind: the ISO-NE fleet shape when it is held on every hour (the Economics method), else a labelled flat proxy.
  const fs = tech === 'wind' && fleet ? fleetShapeFor(rows, fleet, 'wind') : null;
  const windFleet = !!fs && fs.unfilled === 0 && fs.shape.some(v => v > 0);
  const shape = tech === 'wind' ? (windFleet ? fs.shape : rows.map(() => 1)) : rows.map(r => clearSky(r.timestamp, node.latitude, node.longitude) ?? 0);
  const hours = rows.reduce((t, r) => t + r.dtHours, 0), mean = shape.reduce((t, v, i) => t + v * rows[i].dtHours, 0) / hours;
  // Same order as the Economics tab (all-bus review L1): nameplate cap → losses → export cap. Spill = what the export cap removes.
  let genMWh = 0, spillMWh = 0;
  const recs = rows.map((r, i) => {
    const pot = Math.min(mw, mean ? (mw * cf * shape[i]) / mean : 0) * (1 - lossPct / 100), out = Math.min(cap, pot);
    genMWh += pot * r.dtHours; spillMWh += (pot - out) * r.dtHours;
    return { timestamp: r.timestamp, price: r.price, dtHours: r.dtHours, generationMW: out };
  });
  const g = generationRevenue(recs, { lossPct: 0 });
  if (g.errors.length) return { value: null, reason: g.errors.join(' ') };
  const out = { value: g.summary.merchantRevenue / (hours / 8760), mean: res.summary.mean, capture: g.summary.capturePrice, clippedAt: cap < mw ? cap : null, genMWh, spillMWh };
  if (tech === 'wind') out.shape = windFleet ? 'fleet' : 'flat';
  if (tech === 'hybrid') { out.pvOnly = true; out.note = 'PV energy only (solar method at the export size); battery value in Economics › Hybrid sizing'; }
  return out;
}

/** One revenue cell (compare or stress) with the Cape 5-yr exclusion applied: every cell goes through here. */
export function stressValue(data, node, basis, p, exportLimit) {
  if (cape5Excluded(data, node, basis)) return { value: null, reason: CAPE5_REASON };
  return revenueFor(data, node, basis, p.tech, p.exportMW, { cf: p.cf, lossPct: p.lossPct, exportLimit });
}

/** Pricing tier for an option: own node / same substation / borrowed at a distance (forecasts are per bus). */
export function priceTier(data, node, basis) {
  if (basis?.mode === 'forecast') return 'own forecast (model bus)';
  const pm = node?.priceMapping || {}, ix = data.index?.find(b => String(b.id) === String(node?.id)) || {};
  const tier = pm.tier || ix.tier, km = ok(pm.distance_km) ? pm.distance_km : Number(ix.proxyKm);
  if (tier === 'direct') return 'own node';
  if (tier === 'same_substation') return 'same substation';
  if (tier === 'geo_proxy') return ok(km) && km >= 0.05 ? `borrowed: node ${km.toFixed(1)} km away` : 'co-located node (0.0 km)';
  return tier ? String(tier) : 'not held';
}

/** All metrics for one option, each read from its home core. */
export function optionMetrics(data, node, { tech, exportMW, importMW, basis, cf, lossPct, sentGrid = null, fleet = null, pop = null }) {
  // Same rule as Grid › Connection capacity: the tech's own cases, import as entered (review 8).
  const t = caseTable(data.grid, node.id, tech, exportMW, importMW);
  const ex = binding(t, 'export'), im = binding(t, 'import');
  // Same limit Economics uses: the value sent from Grid for this bus, when one exists; a sent null stays null.
  const sent = sentGrid && String(sentGrid.busId) === String(node.id) ? sentGrid : null;
  if (sent) { ex.value = ok(sent.exportMW) ? sent.exportMW : null; im.value = ok(sent.importMW) ? sent.importMW : null; }
  const sentStale = sent ? sent.tech !== tech || Number(sent.requestMW) !== Number(exportMW) : false;
  const cost = stepCostService(data.grid, node.id, tech, exportMW, importMW);
  const matched = data.queue ? nearby(data.queue.queue, node, 10) : null;
  const queueNotModelled = matched && matched.length ? matched.filter(x => x.inModel === 'not modelled').reduce((s, x) => s + (x.q.max_mw || 0), 0) : null;
  const queueLinkedMW = matched && matched.length ? matched.reduce((s, x) => s + (ok(x.q.max_mw) ? x.q.max_mw : 0), 0) : null;
  const land = data.land ? fit(footprint(data.land.intensity, tech, tech === 'datacenter' ? importMW : exportMW), screen(data.land.exclusions, node.id)) : { status: 'unknown', reason: 'Land data not loaded', pending: true };
  const cape5 = cape5Excluded(data, node, basis);
  const rev = cape5 ? { value: null, reason: CAPE5_REASON } : revenueFor(data, node, basis, tech, exportMW, { cf, lossPct, exportLimit: ex.value, fleet });
  // A data centre is judged on its load cost: flat import × the mean price on the applied basis × 8,760 h.
  let loadCost = null;
  if (tech === 'datacenter' && !(Number(importMW) > 0)) loadCost = { value: null, reason: 'No import size entered: set the import MW in the project strip' };
  else if (tech === 'datacenter') {
    const res = cape5 ? null : analyzePrices(data, coreBasis({ ...basis, nodeId: String(node.id) }));
    // One data-centre energy definition (S2-EM economics-load.js): the hourly bill, annualised on observed hours.
    loadCost = res?.summary ? loadEnergyCost(res.rows, Number(importMW))
      : { value: null, reason: cape5 ? CAPE5_REASON : res?.errors.join(' ') || 'No prices on this basis' };
  }
  const fuel = fuelMetrics(data, node, basis, { tech, exportMW, importMW, cf, lossPct }, { fleet, pop, m: { exportLimit: ex.value, importLimit: im.value, envelopeOnly: envelopeOnlyCases(t) } });
  return { node, fuel, loadCost, cases: t, envelopeOnly: envelopeOnlyCases(t), exportLimit: ex.value, exportStatus: ex.status, importLimit: im.value, importStatus: im.status,
    exportCase: ex.row?.label || null, exportKey: ex.row?.key || null, exportValueBasis: ex.valueBasis || null, importCase: im.row?.label || null, importValueBasis: im.valueBasis || null, tech,
    sent: !!sent, sentAt: sent?.at || null, sentStale, cost, queueMatched: matched ? matched.length : null, queueNotModelled, queueLinkedMW,
    queueLinkedTotal: data.queue ? data.queue.queue.length : null, land, revenue: rev, cape5, tier: priceTier(data, node, basis) };
}

export const TAX_GATE = 'Tax credit (45Y/48E)';
/**
 * S5 #4 (W-C): the OBBBA tax-credit gate row from rules/finance.js + rules/tax.js (cards-finance.decisionTaxGate), in the
 * gate shape. tax = { fin: S.ui.fin, tax: S.ui.tax, queueCod (YYYY-MM-DD | year | null), rules }. Rules not loaded or
 * any input not held → Hold with the reason (unknown never passes). A load has no generator credit: no row.
 */
export function taxGate(m, { tech, mw, tax }) {
  if (!tax || tech === 'datacenter') return null;
  if (!tax.rules || !tax.rules.tax) return { gate: TAX_GATE, verdict: 'Hold', why: 'Not decided: rules file not loaded (rules/isone-2026.json), so the 45Y/48E gate cannot be read' };
  try {
    const g = decisionTaxGate({ fin: tax.fin || {}, tax: tax.tax || {} }, { tech, mw: ok(mw) ? mw : Number(m?.tech === 'datacenter' ? m?.importMW : m?.exportMW) || null, queueCod: tax.queueCod ?? null, asOf: tax.asOf }, tax.rules);
    return { gate: TAX_GATE, verdict: ['Pass', 'Hold', 'Fail'].includes(g.verdict) ? g.verdict : 'Hold', why: g.why, src: g.src, row: g.row };
  } catch (e) { return { gate: TAX_GATE, verdict: 'Hold', why: `Not decided: the tax gate could not be evaluated (${e.message})` }; }
}

/** Gate verdicts: Fail on a known breach; Hold when anything required is unknown; Pass only when all known and none breaches.
 *  opts.tax (optional, S5 #4): the finance/tax context; when given, the "Tax credit (45Y/48E)" gate is appended for generators. */
export function gates(m, { tech, thresholds = null, tax = null, exportMW = null }) {
  const out = [];
  const dirs = tech === 'datacenter' ? [m.importStatus] : ['storage', 'hybrid'].includes(tech) ? [m.exportStatus, m.importStatus] : [m.exportStatus];
  const requested = (m.cases || []).filter(r => r.status !== 'Not requested');
  // A breach is known only on element-study evidence; an envelope-only breach is vendor-asserted, so Hold.
  const elementBreach = requested.some(r => r.status === 'Does not fit' && !/^Envelope only/.test(r.basis || ''));
  const envOnly = m.envelopeOnly || envelopeOnlyCases(requested);
  const envBelow = requested.filter(r => (r.status === 'Does not fit' || r.envelopeFits === false) && /^Envelope only/.test(r.basis || '')).map(r => r.label);
  // F010: the light-load and minimum-load cases ISO-NE studies are not in the store: an injecting service cannot Pass.
  const unst = requested.some(r => r.dir === 'export') || (!m.cases && tech !== 'datacenter') ? unstudiedCases(tech) : [];
  const connect = elementBreach || (!m.cases && dirs.includes('Does not fit')) ? 'Fail' : dirs.every(s => s === 'Fits') && !envOnly.length && !unst.length ? 'Pass' : 'Hold';
  out.push({ gate: 'Connect', verdict: connect, why: `Grid: ${dirs.join(' / ')}${dirs.length > 1 ? ' (export / charge)' : ''}${envOnly.length ? `; envelope only (vendor-asserted) for ${envOnly.join(', ')}: unverified, D6.1 context, never a pass` : ''}${envBelow.length && !elementBreach ? ` (below the request on the envelope: ${envBelow.join(', ')})` : ''}${unst.length ? `; ${unst.map(u => u.label.replace(' · export', '').toLowerCase()).join(' and ')} not studied` : ''}` });

  const unverified = m.cost.unverified || [], gaps = m.cost.gaps || [];
  const costKnown = ['True zero', 'Priced'].includes(m.cost.status) && !unverified.length;
  const costWhy = [`Grid: ${m.cost.status} · ${costText(m.cost)}`];
  if (gaps.length) costWhy.push(`not held for ${gaps.map(g => g.label).join(', ')}`);
  if (unverified.length) costWhy.push(`unverified (envelope only) for ${unverified.map(g => g.label).join(', ')}`);
  if (m.cost.status === 'Partly priced' && m.cost.unpriced) costWhy.push(`${m.cost.unpriced} facility cost(s) not held`);
  out.push({ gate: 'Upgrade cost known', verdict: costKnown ? 'Pass' : 'Hold', why: costWhy.join('; ') });

  // Queue: never Pass. Only the linked subset of the register can be assessed; all linked requests are modelled.
  const linked = `${m.queueLinkedTotal ?? 110} of ${QUEUE_REGISTER_APPROX} requests linked; unlinked requests not assessed`;
  const info = m.queueLinkedMW == null ? 'no linked requests within 10 mi' : `${m.queueLinkedMW.toLocaleString('en-US')} MW linked nearby (${m.queueMatched} request(s))${m.queueNotModelled ? `, ${m.queueNotModelled} MW of it not in the study` : ', all in the study'}`;
  out.push({ gate: 'Queue exposure', verdict: 'Hold', why: `${linked}. ${info}` });

  // Land review: the screen removes only habitat/protected land (no water, urban, wetland or slope), so "fits" is an
  // upper bound → Hold; a shortfall even on that optimistic screen is a real Fail.
  const screenOnly = m.land.status === 'fits' && m.land.screenOnly !== false;
  out.push({ gate: 'Land fit', verdict: m.land.status === 'does not fit' ? 'Fail' : m.land.status === 'fits' && !screenOnly ? 'Pass' : 'Hold', why: `Land: ${m.land.status}${screenOnly ? ' on a habitat/protected-only screen (water, urban, wetland and slope not screened): an upper bound' : ''}${m.land.reason ? ` (${m.land.reason})` : ''}`,
    ...(m.land.pending ? { pending: true } : {}) });
  if (tech === 'datacenter') {
    const lc = m.loadCost || {};
    out.push({ gate: 'Load cost evidence', verdict: ok(lc.value) ? (connect === 'Pass' ? 'Pass' : 'Hold') : 'Hold',
      why: ok(lc.value) ? `Flat-load energy cost $${(lc.value / 1e6).toFixed(1)}M/yr at $${lc.mean.toFixed(2)}/MWh${connect === 'Pass' ? '' : ', conditional on the connection'}` : lc.reason || 'not held' });
  } else {
    out.push({ gate: 'Revenue evidence', verdict: ok(m.revenue.value) ? (connect === 'Pass' ? 'Pass' : 'Hold') : 'Hold',
      why: ok(m.revenue.value) ? (connect === 'Pass' ? 'Energy revenue computed on the applied basis' : 'Computed, but conditional on the connection') + (m.revenue.pvOnly ? ' (PV energy only)' : '') : m.revenue.reason });
  }
  // Gate 6 (Capture): solar, wind and hybrid, with the basis named; open decision #2 decides which basis governs.
  if (['solar', 'wind', 'hybrid'].includes(tech)) {
    const c = fuelVerdict(m.fuel || {}, tech, thresholds || thresholdsFor(tech)).find(x => x.test === 'capture');
    const names = ['clear-sky', 'fleet'].map(b => { const x = (c.bases || []).find(y => y.basis === b); return x ? `${b} ${ok(x.ratio) ? `${(100 * x.ratio).toFixed(1)}%` : 'not held'}` : `${b} not used for wind`; }).join(' · ');
    out.push({ gate: 'Capture', verdict: c.verdict, why: `${names} vs ${ok(c.threshold) ? `≥ ${c.threshold}%${c.qualifier ? ` (${c.qualifier})` : ''}` : 'threshold not set'}: ${c.why}`, ...(c.qualifier ? { qualifier: c.qualifier } : {}) });
  }
  const tg = taxGate(m, { tech, mw: ok(Number(exportMW)) && Number(exportMW) > 0 ? Number(exportMW) : null, tax });
  if (tg) out.push(tg);
  return out;
}

/** Years complete for every option; names an option that has no price history at all. */
export function commonYears(data, opts) {
  const sets = [];
  for (const n of opts) {
    const all = availableYears(data, n.id, 'historical', 'RT');
    if (!all.length) return { years: [], reason: `no historical years: ${n.name} has no price history` };
    sets.push(new Set(all.filter(y => y.complete).map(y => y.year)));
  }
  if (!sets.length) return { years: [], reason: 'no options' };
  const years = [...sets[0]].filter(y => sets.every(s => s.has(y))).sort((a, b) => a - b);
  return { years, reason: years.length ? '' : 'no historical year is complete for every option' };
}

/** Forecast runs held for every option (not only the candidate); the 5-yr run is left out. */
export function commonRuns(data, opts) {
  if (!opts.length) return [];
  const per = opts.map(n => forecastRuns(data, n.id).filter(r => r.run !== '5yr'));
  return per[0].filter(r => per.every(list => list.some(x => x.run === r.run && x.year === r.year)));
}

/** Leader per scenario, comparable rows only: a scenario missing any option is "not comparable" and not counted. */
export function stressLeaders(table, names, { lowerBetter = false } = {}) {
  const rows = table.map(r => {
    const missing = r.vals.map((v, i) => (ok(v) ? null : names[i])).filter(x => x != null);
    if (missing.length) return { comparable: false, leader: null, reason: `not comparable: ${missing.join(', ')} missing` };
    let b = 0; r.vals.forEach((v, i) => { if (lowerBetter ? v < r.vals[b] : v > r.vals[b]) b = i; });
    return { comparable: true, leader: b, reason: '' };
  });
  const base = rows[0]?.comparable ? rows[0].leader : null;
  const rest = rows.slice(1).filter(r => r.comparable);
  return { rows, base, comparable: rest.length, other: base == null ? 0 : rest.filter(r => r.leader !== base).length };
}

/**
 * Independent export limit from the raw grid rows (not via gridrules): per export case, the lowest positive
 * transfer over facilities not already overloaded; the envelope where no rows are held (and always for the
 * shoulder export, whose rows are mislabelled). null when any export case has rows but no usable transfer.
 */
export function ownExportLimit(grid, bus) {
  const vals = [];
  for (const scenario of ['summer_peak', 'shoulder']) {
    const env = grid.headroom.find(h => String(h.bus_id) === String(bus) && h.scenario === scenario && h.direction === 'discharge')?.headroom_mw;
    const rows = scenario === 'shoulder' ? [] : grid.constraints.filter(r => String(r.bus_id) === String(bus) && r.scenario === scenario && r.direction === 'discharge');
    if (!rows.length) { if (ok(env)) vals.push(env); continue; }
    if (rows.some(r => /no violations/i.test(String(r.monitored_facility)))) return null;
    const usable = rows.filter(r => !(ok(r.pct_loading_no_transfer) && Math.abs(r.pct_loading_no_transfer) >= 100) && ok(r.transfer_mw) && r.transfer_mw > 0).map(r => r.transfer_mw);
    if (!usable.length) return null;
    vals.push(Math.min(...usable));
  }
  return vals.length ? Math.min(...vals) : null;
}

/** Full input fingerprint for "has the analysis changed since this record?" Option order is kept (candidate first). */
export function inputHash(data, S, optionIds) {
  const h = S.handoffs || {}, e = S.ui?.econ || {};
  const q = data.queue?.queue || [];
  const vintages = {
    queue: data.queue ? [data.queue.source || null, q.reduce((mx, r) => (r.request_date && r.request_date > mx ? r.request_date : mx), ''), q.length] : null,
    land: data.land ? data.land.source || true : null,
    flags: data.flags ? [data.flags.source || true, Object.keys(data.flags.buses || {}).length] : null,
  };
  const econ = { solarCF: ok(e.solarCF) ? e.solarCF : null, windCF: ok(e.windCF) ? e.windCF : null, lossPct: ok(e.lossPct) ? e.lossPct : null };
  // v5: the user's per-fuel threshold overrides (null when none, so records made before v5 still compare equal).
  const th = userThresholds(S.ui), thKeys = Object.keys(th).sort();
  return JSON.stringify([data.metadata?.createdAt, S.tech, Number(S.exportMW), Number(S.importMW), S.basis, [...optionIds].map(String), econ, S.ui?.land?.control ?? null, vintages, Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v?.at || null])), thKeys.length ? Object.fromEntries(thKeys.map(k => [k, th[k]])) : null]);
}

// ---------------------------------------------------------------------------------------------------------------
// v3 analytics (2026-09-29 build): market position, shared limiting elements, scenario ranges, coverage, open items.
// All raw: no combined score anywhere. Null = not held.

/** Mid-rank percentile of v among the held values: 100 × (below + ½·equal) ÷ n. */
export function percentileOf(values, v) {
  if (!ok(v)) return null;
  let below = 0, equal = 0, n = 0;
  for (const x of values) { if (!ok(x)) continue; n++; if (x < v) below++; else if (x === v) equal++; }
  if (!n) return null;
  return { pct: (100 * (below + equal / 2)) / n, below, equal, n };
}

/** The deciding measures per technology (the live Studio's compareMeasures sets, on unified-DB measures). */
const SETS = {
  solar: ['lmp_2030', 'lmp_rt', 'solar_ratio', 'tb4', 'neg', 'cong', 'hr_sp_dis', 'sc_mva'],
  wind: ['lmp_2030', 'lmp_rt', 'neg', 'std', 'cong', 'hr_sp_dis', 'sc_mva'],
  storage: ['tb4', 'tb2', 'tb8', 'std', 'h200', 'hr_sp_dis', 'hr_sh_chg', 'sc_mva'],
  hybrid: ['lmp_2030', 'solar_ratio', 'tb4', 'neg', 'hr_sp_dis', 'hr_sh_chg', 'sc_mva'],
  datacenter: ['lmp_2030', 'lmp_rt', 'std', 'h200', 'hr_ll_chg', 'outlets', 'sc_mva'],
};
export const measureSet = tech => SETS[tech] || SETS.solar;
/** Reading direction for one measure and technology: a load prefers low and steady prices; storage prefers volatility. */
export function orientedHigher(m, tech) {
  if (tech === 'datacenter' && ['lmp_rt', 'lmp_2030', 'lmp_2035', 'std', 'h200'].includes(m.key)) return false;
  if ((tech === 'storage' || tech === 'hybrid') && m.key === 'std') return true;
  return !!m.higher;
}
const IDX = new WeakMap();
function popIndex(pop) { if (!IDX.has(pop)) IDX.set(pop, new Map(pop.ids.map((id, i) => [String(id), i]))); return IDX.get(pop); }
/** Value of one measure at one bus from the population payload (null when the bus or value is not held). */
export function popValue(pop, key, id) { const i = popIndex(pop).get(String(id)); const v = i == null ? null : pop.values[key]?.[i]; return ok(v) ? v : null; }

/** Market position: per measure, each option's raw value and percentile among all buses holding it. */
export function positionTable(pop, ids, tech, keys = measureSet(tech)) {
  const rows = keys.map(k => pop.measures.find(m => m.key === k)).filter(Boolean).map(m => {
    const higher = orientedHigher(m, tech), all = pop.values[m.key] || [];
    const n = all.filter(ok).length;
    const cells = ids.map(id => {
      const value = popValue(pop, m.key, id), p = percentileOf(all, value);
      return { value, pct: p ? p.pct : null, below: p?.below ?? null, equal: p?.equal ?? null, oriented: p ? (higher ? p.pct : 100 - p.pct) : null };
    });
    // FORMULAS D9: the SIGNED congestion component (ISO-NE sign, LMP = E + C + L), read in the stated direction;
    // Market > Rank scores |MCC| lower-is-better as a risk measure. Different measures, both legitimate; say so.
    const cong = m.key === 'cong';
    return { key: m.key, label: cong && !/signed/.test(m.label) ? `${m.label} (signed)` : m.label, unit: m.unit, source: m.source,
      note: cong ? `${m.note ? `${m.note} ` : ''}Signed component: positive raises the price at the node. Market › Rank uses |MCC| (lower is better) as a congestion-risk measure, a different measure from this one.` : m.note, higher, n, cells };
  });
  return { rows };
}

/**
 * v6: one option's rows for charts.percentileStrip (context rows: no reference, so nothing reads as Met), plus the
 * placement summary for the card's answer: held, better (oriented percentile ≥ 50), notHeld, best/worst measure.
 */
export function positionStrip(pos, pop, i) {
  const rows = pos.rows.map(r => ({ key: r.key, label: `${r.label} (${r.higher ? 'higher' : 'lower'} is better)`, unit: r.unit === 'ratio' ? '' : r.unit, value: r.cells[i]?.value ?? null, pop: pop.values[r.key] || [], ref: null, dir: null }));
  const cells = pos.rows.map(r => ({ key: r.key, label: r.label, o: r.cells[i]?.oriented })).filter(c => ok(c.o));
  const sorted = cells.slice().sort((a, b) => b.o - a.o);
  return { rows, held: cells.length, better: cells.filter(c => c.o >= 50).length, notHeld: pos.rows.length - cells.length, best: sorted[0] || null, worst: sorted.at(-1) || null };
}

const normFacility = s => String(s || '').replace(/\s+/g, ' ').trim();
const isPreRow = r => (ok(r.pct_loading_no_transfer) && Math.abs(r.pct_loading_no_transfer) >= 100) || (ok(r.transfer_mw) && r.transfer_mw < 0);
/**
 * Limiting elements across options (live Studio 7.05): every facility in the element study of a requested case,
 * per option the lowest usable transfer (pre-existing overloads give none), the highest |loading| and the DFAX.
 * rows = facilities named at two or more options. minTransfer = each option's lowest usable transfer overall.
 */
export function sharedElements(ms) {
  const per = ms.map(m => {
    const map = new Map();
    for (const c of (m.cases || []).filter(x => x.status !== 'Not requested')) {
      for (const r of c.element?.rows || []) {
        if (/no violations/i.test(String(r.monitored_facility))) continue;
        const k = normFacility(r.monitored_facility);
        const e = map.get(k) || { facility: k, transfer: null, loading: null, dfax: null, pre: false, cases: [], rows: 0 };
        e.rows++; if (!e.cases.includes(c.label)) e.cases.push(c.label);
        if (isPreRow(r)) e.pre = true;
        else if (ok(r.transfer_mw) && r.transfer_mw > 0 && (e.transfer == null || r.transfer_mw < e.transfer)) { e.transfer = r.transfer_mw; e.dfax = ok(r.dfax) ? r.dfax : null; }
        if (ok(r.pct_loading_no_transfer) && (e.loading == null || Math.abs(r.pct_loading_no_transfer) > Math.abs(e.loading))) e.loading = r.pct_loading_no_transfer;
        map.set(k, e);
      }
    }
    return map;
  });
  const keys = [...new Set(per.flatMap(p => [...p.keys()]))];
  const all = keys.map(k => { const cells = per.map(p => p.get(k) || null); return { facility: k, cells, shared: cells.filter(Boolean).length }; });
  const rows = all.filter(r => r.shared >= 2).sort((a, b) => b.shared - a.shared || Math.min(...a.cells.map(c => c?.transfer ?? Infinity)) - Math.min(...b.cells.map(c => c?.transfer ?? Infinity)));
  const minTransfer = per.map(p => { const t = [...p.values()].map(e => e.transfer).filter(ok); return t.length ? Math.min(...t) : null; });
  return { rows, all, counts: per.map(p => p.size), minTransfer };
}

/** Per option: min, max, spread across scenarios, and the worst case against the applied basis (row 0). */
export function scenarioRanges(table, { lowerBetter = false } = {}) {
  const n = table[0]?.vals.length || 0;
  return Array.from({ length: n }, (_, j) => {
    const held = table.map(r => ({ v: r.vals[j], label: r.sc.label })).filter(x => ok(x.v));
    const applied = ok(table[0]?.vals[j]) ? table[0].vals[j] : null;
    if (!held.length) return { min: null, max: null, spread: null, applied, worst: null, downside: null, downsidePct: null, n: 0, missing: table.length };
    const lo = held.reduce((a, b) => (b.v < a.v ? b : a)), hi = held.reduce((a, b) => (b.v > a.v ? b : a));
    const worst = lowerBetter ? hi : lo, best = lowerBetter ? lo : hi;
    const downside = applied == null ? null : worst.v - applied;
    return { min: lo.v, max: hi.v, minLabel: lo.label, maxLabel: hi.label, spread: hi.v - lo.v, applied, worst: worst.v, worstLabel: worst.label, best: best.v, bestLabel: best.label,
      downside, downsidePct: applied ? (100 * downside) / Math.abs(applied) : null, n: held.length, missing: table.length - held.length };
  });
}

/** The stress metric for a technology: energy revenue (solar, wind), TB4 spread (storage, hybrid), average price (data centre). */
export const stressMetric = tech => (['solar', 'wind', 'hybrid'].includes(tech) ? 'revenue' : tech === 'datacenter' ? 'price' : 'tb4');
function tb4Of(rows) { const sp = dailySpreads(rows, 4); return sp.length ? { value: sp.reduce((t, d) => t + d.spread, 0) / sp.length, days: sp.length } : null; }
/** One stress cell for any technology, with the Cape 5-yr exclusion applied first. */
export function stressCell(data, node, basis, p, exportLimit) {
  const metric = stressMetric(p.tech);
  if (cape5Excluded(data, node, basis)) return { metric, value: null, reason: CAPE5_REASON };
  if (metric === 'revenue') {
    const r = { metric, ...revenueFor(data, node, basis, p.tech, p.exportMW, { cf: p.cf, lossPct: p.lossPct, exportLimit, fleet: p.fleet }) };
    if (p.tech === 'hybrid') { const res = analyzePrices(data, coreBasis({ ...basis, nodeId: String(node.id) })); r.tb4 = res.summary ? tb4Of(res.rows)?.value ?? null : null; }
    return r;
  }
  const res = analyzePrices(data, coreBasis({ ...basis, nodeId: String(node.id) }));
  if (!res.summary) return { metric, value: null, reason: res.errors.join(' ') || 'No prices on this basis' };
  if (metric === 'price') return { metric, value: res.summary.mean, mean: res.summary.mean };
  const sp = dailySpreads(res.rows, 4);
  if (!sp.length) return { metric, value: null, mean: res.summary.mean, reason: 'No complete day on this basis' };
  return { metric, value: sp.reduce((t, d) => t + d.spread, 0) / sp.length, days: sp.length, mean: res.summary.mean };
}

/** Evidence coverage per option (live Studio 7.07): what the database holds behind each concern. */
export function coverageGrid(data, ms) {
  const row = (concern, f) => ({ concern, cells: ms.map(m => f(m)) });
  const c = (status, detail) => ({ status, detail });
  return [
    row('Coordinates', m => (ok(m.node.latitude) && ok(m.node.longitude) ? c('held', `${m.node.latitude.toFixed(3)}, ${m.node.longitude.toFixed(3)}`) : c('not held', 'no coordinates'))),
    row('Price node', m => (/^own|^same|^co-located|^own forecast/.test(m.tier) ? c('held', m.tier) : /^borrowed/.test(m.tier) ? c('partial', m.tier) : c('not held', m.tier || 'no price node'))),
    row('Settled price history', m => { const y = availableYears(data, m.node.id, 'historical', 'RT'), full = y.filter(x => x.complete).length; return full ? c('held', `${full} complete RT year(s) of ${y.length}`) : y.length ? c('partial', `${y.length} partial RT year(s), none complete`) : c('not held', 'no settled series'); }),
    row('Forecast runs', m => { const r = forecastRuns(data, m.node.id); return r.length ? c(r.length >= 4 ? 'held' : 'partial', `${r.length} run(s): ${r.map(x => x.run).join(', ')}`) : c('not held', 'no forecast run for this bus'); }),
    row('Element study (requested cases)', m => { const req = (m.cases || []).filter(x => x.status !== 'Not requested'), held = req.filter(x => x.element?.status === 'held'); return !req.length ? c('not held', 'nothing requested') : held.length === req.length ? c('held', `${held.length} of ${req.length} cases`) : held.length ? c('partial', `${held.length} of ${req.length} cases (${req.filter(x => x.element?.status !== 'held').map(x => x.label).join(', ')} not held)`) : c('not held', `0 of ${req.length} cases: ${req.map(x => `${x.label} ${x.basis}`).join('; ')}`); }),
    row('Upgrade cost', m => (['Priced', 'True zero'].includes(m.cost.status) && !(m.cost.unverified || []).length ? c('held', m.cost.status) : ['Priced', 'True zero', 'Lower bound', 'Partly priced', 'No upgrades indicated'].includes(m.cost.status) ? c('partial', `${m.cost.status} · ${costText(m.cost)}`) : c('not held', m.cost.status || 'not held'))),
    row('Land exclusion screen', m => (m.land.status === 'unknown' ? c('not held', m.land.reason || 'no screen') : c('partial', `${m.land.status}: habitat/protected-only screen`))),
    row('Queue linkage', m => (m.queueLinkedTotal == null ? c('not held', 'queue not loaded') : c('partial', `${m.queueMatched ?? 0} linked request(s) nearby; only ${m.queueLinkedTotal} of ${QUEUE_REGISTER_APPROX} requests carry a bus link`))),
  ];
}

const WHERE = { Capture: 'Prices › Shape & capture', 'Load cost evidence': 'Prices › Tails & spreads', Connect: 'Grid › Connection capacity', 'Upgrade cost known': 'Grid › Upgrade cost allocator', 'Queue exposure': 'Queue › Queue & cluster', 'Land fit': 'Land › Buildable area', 'Revenue evidence': 'Economics › Solar & wind revenue', [TAX_GATE]: 'Economics › Project finance' };
/** Open items derived from the gates (live Studio 7.09): one per gate not passed, with what to do and where. */
export function openItems(ms, gs) {
  const out = [];
  ms.forEach((m, i) => gs[i].forEach(g => {
    if (g.verdict === 'Pass') return;
    let what;
    if (g.gate === 'Connect') what = g.verdict === 'Fail' ? 'Resize below the binding element limit, or price the upgrade that removes it' : m.envelopeOnly?.length ? `Obtain an element study for ${m.envelopeOnly.join(', ')} (envelope only, vendor-asserted)` : 'Resolve the connection status (limit not held or not published)';
    else if (g.gate === 'Upgrade cost known') what = (m.cost.unverified || []).length ? `Confirm the cost for ${m.cost.unverified.map(u => u.label).join(', ')} (envelope only)` : (m.cost.gaps || []).length ? `Obtain costs for ${m.cost.gaps.map(x => x.label).join(', ')}` : `Price the upgrade (${m.cost.status})`;
    else if (g.gate === 'Queue exposure') what = 'Check nearby unlinked queue requests by hand (only the linked subset is assessed)';
    else if (g.gate === 'Land fit') what = m.land.status === 'unknown' ? 'Obtain an exclusion screen for this bus' : m.land.status === 'does not fit' ? 'Find a larger site or reduce the footprint' : 'Screen water, urban, wetland and slope before relying on the fit';
    else if (g.gate === 'Capture') what = g.verdict === 'Fail' ? `Capture is below the threshold${g.qualifier ? ` (${g.qualifier})` : ''} on every held basis: test storage pairing or another bus` : /threshold not set/.test(g.why) ? 'Agree the capture threshold and which basis governs (open decision #2, owner: Ganesh); until then this gate holds' : 'Hold both capture bases (clear-sky and fleet shape) and settle the governing basis (open decision #2, owner: Ganesh)';
    else if (g.gate === 'Load cost evidence') what = 'Price the load on a held basis (Prices) before comparing sites';
    else if (g.gate === 'Revenue evidence') what = ok(m.revenue.value) ? 'Revenue is conditional on the connection: clear the Connect gate first' : `Value this technology in Economics (${m.revenue.reason || 'not held'})`;
    else if (g.gate === TAX_GATE) what = g.verdict === 'Fail' ? `No 45Y/48E credit on these dates: ${g.why.replace(/^[^:]*:\s*/, '')} Test an earlier construction start (BOC) or placed-in-service (PIS) date, or finance without the credit` : `Enter the construction-start (BOC) method and date, the placed-in-service (PIS) date or a Queue COD, and the material-assistance ratio in Economics › Project finance: ${g.why.replace(/^[^:]*:\s*/, '')}`;
    else what = g.why;
    out.push({ option: m.node.name, busId: m.node.id, gate: g.gate, verdict: g.verdict, what, why: g.why, where: WHERE[g.gate] || 'Grid › Connection capacity' });
  }));
  return out;
}
/**
 * The Economics revenue stack sent for this bus and technology (S.ui.revenueOut / S.handoffs.revenue, Economics'
 * stackHandoff): Decision prints its label beside its own energy-only figure so both read as one labelled stack (F002/F006).
 * null when Economics has not produced one for this bus and technology.
 */
export function econRevenueStack(S, busId, tech) {
  const want = tech === 'hybrid' ? 'hybrid' : tech;
  for (const r of [S?.handoffs?.revenue, S?.ui?.revenueOut]) if (r && String(r.busId) === String(busId) && r.tech === want && r.label) return { label: r.label, annual: ok(r.annual) ? r.annual : null, kind: r.kind || null, sent: r === S?.handoffs?.revenue };
  return null;
}
/** The gate lines, one wording for the strip, the band, the inspector and Decision (F001 / D3). */
export const gateLines = gs => (gs || []).map(x => `${x.gate}: ${x.verdict} — ${x.why}`).join('\n');
/**
 * The one tally of the Decision gates every surface shows (F001): all three counts, Fail red. opts.pending = inputs this
 * page has not loaded yet; the label then says "as of this stage" so a loading input never reads as a different verdict.
 */
export function gateTally(gs, { pending = [] } = {}) {
  if (!gs || !gs.length) return { pass: 0, hold: 0, fail: 0, total: 0, tone: 'warn', label: 'gates loading', lines: '', title: 'The Decision gates load with the bus.', pending };
  const c = gateCounts(gs), lines = gateLines(gs);
  // The shared verdict vocabulary (v2copy.verdictLine: Fail first, Hold reads "Open"): the band and the inspector use it too.
  const label = `${verdictLine({ pass: c.Pass, hold: c.Hold, fail: c.Fail })}${pending.length ? ' · as of this stage' : ''}`;
  return { pass: c.Pass, hold: c.Hold, fail: c.Fail, total: gs.length, tone: c.Fail ? 'bad' : c.Hold ? 'warn' : 'ok', label, lines, pending,
    title: `${lines}${pending.length ? `\nStill loading on this page: ${pending.join(', ')}. The verdicts settle once they arrive.` : ''}` };
}
/** Inputs the gates need that this page has not loaded: the queue register, the land screen, the fleet shape (capture). */
export function gateInputsPending(data, { tech, fleetStatus } = {}) {
  const out = [];
  if (!data?.queue) out.push('queue register');
  if (!data?.land) out.push('land screen');
  if (['solar', 'wind', 'hybrid'].includes(tech) && fleetStatus === 'loading') out.push('ISO-NE fleet shape');
  return out;
}

/**
 * Memo qualifiers (Findings F006): each memo figure printed with what it rests on, so a frozen memo is never read as a
 * study result. One home for the memo text, the printable memo and the evidence pack. land = data.land (for its
 * "secondary extraction" caveat); null = not loaded.
 */
export function memoQualifiers(m, tech, land) {
  const foot = [];
  const req = (m.cases || []).filter(r => r.status !== 'Not requested');
  const env = req.filter(r => r.status === ENVELOPE_ONLY).map(r => r.label);
  const unst = req.some(r => r.dir === 'export') ? unstudiedCases(tech) : [];
  const key = m.exportKey || req.find(r => r.label === m.exportCase)?.key || null;
  let exportLimit;
  if (!ok(m.exportLimit)) exportLimit = `not held (${m.exportStatus || 'not studied'})`;
  else {
    const parts = [`${m.exportLimit.toFixed(1)} MW`, m.exportCase || 'case not held',
      m.exportValueBasis === 'envelope' ? 'vendor substation envelope (not reproducible from a facility list)' : `thermal N-1 DC screen (element study ${STUDY_VINTAGE})`,
      key ? serviceTag(key).short.replace(' · ', ' ') : 'NR energy-only', m.exportStatus];
    if (env.length) parts.push(`${env.join(', ')} envelope only (vendor-asserted, unverified)`);
    if (unst.length) parts.push(`${unst.map(u => u.label.replace(' · export', '').toLowerCase()).join(' and ')} not studied`);
    if (m.sent) parts.push('sent from Grid');
    exportLimit = parts.join(' · ');
    foot.push(`Export limit: a screening figure from the stored thermal screen (vintage ${STUDY_VINTAGE}), not an interconnection study result; capacity (CNR) service is at most this figure.`);
  }
  const unv = (m.cost?.unverified || []).map(u => u.label), gaps = (m.cost?.gaps || []).map(g => g.label);
  const cost = `${costText(m.cost)}${unv.length ? ` · envelope only for ${unv.join(', ')}: no facility list, so not a proven $0` : ''}${gaps.length ? ` · not held for ${gaps.join(', ')}: a lower bound` : ''}`;
  if (unv.length || gaps.length) foot.push('Upgrade cost: from stored facility costs at the request size; cases without a facility list are unverified or a lower bound, never $0.');
  const vn = (land?.intensity?.notes || []).find(n => /secondary extraction/i.test(n)) || null;
  const landTxt = `${m.land?.status || 'not held'}${m.land?.status === 'fits' || m.land?.status === 'does not fit' ? ' on a habitat/protected-only screen (water, urban, wetland and slope not screened): an upper bound' : m.land?.reason ? ` (${m.land.reason})` : ''}${vn ? ' · land-need figures read from a secondary extraction: verify before client use' : ''}`;
  if (vn) foot.push(`Land: ${vn}`);
  foot.push('Every figure is screening evidence on the unified ISO-NE database; unknown is never Pass.');
  return { exportLimit, cost, land: landTxt, footnotes: foot };
}
export const gateCounts = g => ({ Pass: g.filter(x => x.verdict === 'Pass').length, Hold: g.filter(x => x.verdict === 'Hold').length, Fail: g.filter(x => x.verdict === 'Fail').length });

const HASH_PARTS = ['Data snapshot', 'Technology', 'Export MW', 'Import MW', 'Price basis', 'Options', 'Economics inputs', 'Site control', 'Data vintages', 'Hand-offs', 'Fuel thresholds'];
/** What differs between a recorded input hash and the current one (by component); null when either cannot be read. */
export function recordDiff(recorded, current) {
  let a, b;
  try { a = JSON.parse(recorded); b = JSON.parse(current); } catch { return null; }
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  return HASH_PARTS.filter((_, i) => JSON.stringify(a[i] ?? null) !== JSON.stringify(b[i] ?? null));
}

// Studio copy (older database) against the unified value of the same quantity; fields the unified DB excluded say why.
const PAIRS = [['lmp_2025', 'lmp_rt', 'Average RT LMP 2025'], ['lmp_2030', 'lmp_2030', 'LMP 2030'], ['lmp_2035', 'lmp_2035', 'LMP 2035'],
  ['hneg_2025', 'neg', 'Negative-price hours 2025'], ['h200_2025', 'h200', 'Hours above $200 2025'], ['std_2025', 'std', 'Price volatility 2025'],
  ['hr_sp_dis', 'hr_sp_dis', 'Injection headroom · summer peak'], ['hr_sh_chg', 'hr_sh_chg', 'Charging headroom · shoulder'], ['hr_ll_chg', 'hr_ll_chg', 'Withdrawal headroom · large load'],
  ['sc_mva', 'sc_mva', 'Short-circuit strength'], ['outlets', 'outlets', 'Substation outlets']];
const EXCLUDED = { lmp_2050: 'Not in the unified DB: vendor 2045/2050 were 2040 × 1.0816 per step, a flat escalation, not a simulation',
  top_constraint: 'Not in the unified DB: the vendor names had zero overlap with real constraints (see limiting elements)',
  top_shadow: 'Not in the unified DB (same vendor field as the top constraint)',
  solar_100MW_2030: 'Not in the unified DB: vendor curtailment ramp, 2,676 of 2,678 flagged unvalidated' };
const EXLABEL = { lmp_2050: 'LMP 2050 (vendor)', top_constraint: 'Top constraint (vendor)', top_shadow: 'Top shadow price (vendor)', solar_100MW_2030: 'Solar curtailment 100 MW 2030 (vendor)' };
const NOTE = { sc_mva: 'Studio copy holds the source column, 100× too small (the Studio multiplies on read); the unified DB stores it corrected',
  lmp_2030: 'Studio sheet column; the unified value is the pcr2030 run mean',
  lmp_2035: 'Studio sheet column; the unified value is the pcr2035 run mean' };
export function studioNotes(unified, studio) {
  if (!studio) return null;
  const out = [];
  for (const [s, u, label] of PAIRS) {
    const sv = ok(studio[s]) ? studio[s] : null, uv = ok(unified?.[u]) ? unified[u] : null;
    if (sv == null && uv == null) continue;
    const diff = sv != null && uv != null ? sv - uv : null;
    const same = diff != null && Math.abs(diff) <= Math.max(0.01, 0.005 * Math.abs(uv));
    out.push({ key: s, label, studio: sv, unified: uv, diff, state: diff == null ? 'one source only' : same ? 'same' : 'differs', note: same || diff == null ? '' : NOTE[s] || 'The two databases disagree; the unified value is used' });
  }
  for (const [k, why] of Object.entries(EXCLUDED)) if (studio[k] != null) out.push({ key: k, label: EXLABEL[k] || k, studio: studio[k], unified: null, diff: null, state: 'excluded', note: why });
  return out;
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

export { THRESHOLDS, FUEL_TESTS, thresholdsFor, captureRatio, fleetShapeFor, fuelMetrics, fuelVerdict, capturePassCount } from './decisionfuel.js';
import { thresholdsFor, fleetShapeFor, fuelMetrics, fuelVerdict } from './decisionfuel.js';
