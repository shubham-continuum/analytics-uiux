// Market core v3 (2026-09-29): ISO-wide screening over /api/market — the same unified database as Prices,
// Grid and Economics, and the SAME grid rules (gridrules.caseTable) as the Grid page, so a bus shows one
// number everywhere. (v1 read an older study copy whose truncated facility lists overstated 22 limits and
// whose 2025 prices differed by > $1 at 102 buses.)
// Rules: a requirement is met / unmet / unknown — unknown is never met and never ranked as zero; no location
// is re-admitted when nothing qualifies; regions are never summed into capacity.
// v3 adds: per-requirement checks and the qualifying funnel, the Studio's weighted-percentile ranking with its
// discrimination statement, sensitivity, per-bus size profile, the five-case matrix, market-wide percentiles,
// and the /api/x/market/measures overlay (unpriced run nodes → not held; partial settled years are not ranked).
// v4 adds: the upgrade-cost screen (gridrules.stepCostService at the request size), the curtailment screen rebuilt
// from the PCR runs (unified fact_pcr_unit_hourly, not the excluded vendor ramps), and the Equal-weights preset.
import { caseTable, applicableCases, CASE_LABEL, elementLimit, stepCostService, ENVELOPE_ONLY, unstudiedCases, serviceTag, studyStaleness, costDisplay } from './gridrules.js';
import { MART_SOLAR_WINDOW, solarWindowLabel } from './solar.js';
import { priceTierLabel } from './prices.js';
export { priceTierLabel };

const ok = v => typeof v === 'number' && Number.isFinite(v);

// S2-EM D5: Market's 2030 solar-window ratio uses the mart's window (one home: solar.js). api_market.SOLAR_HOURS
// must equal it (tests/s2em-core.test.mjs; Lead wiring W5 moves the server's SQL window from 8–14 to 9–16).
export const MARKET_SOLAR_WINDOW = MART_SOLAR_WINDOW;
// S2-EM D4: one population rule for every 2025 settled measure (strip rows, ranking, Decision's position table):
// a bus counts only when it holds a full 2025 settled year (fewer than 95% of 2025's hours held = not held).
export const POPULATION_RULE = 'Population = every bus holding a full 2025 settled year (a part year is not held), for every 2025 measure.';
// P2 (basis-held): ONE home for the full-year coverage share. A settled year, and an hour-matched 2025 basis, is held
// only with at least this share of the year's hours (bridge column and Market measure read the same constant).
export const FULL_YEAR_SHARE = 0.95;
export const BASIS_MIN_HOURS = FULL_YEAR_SHARE * 8760;
export const BASIS_NOT_HELD = `not held (under ${Math.round(100 * FULL_YEAR_SHARE)}% of 2025 hours matched)`;
const okNum = v => typeof v === 'number' && Number.isFinite(v);
const basisHeld = (m, k) => (m && okNum(m.bHours) && m.bHours >= BASIS_MIN_HOURS && okNum(m[k]) ? m[k] : null);
/** Hour-matched RT 2025 basis vs own load zone, held only with >= FULL_YEAR_SHARE of 2025's hours matched; else null. */
export const basisZoneHeld = m => basisHeld(m, 'bZone');
/** Hour-matched RT 2025 basis vs the hub, under the same coverage rule; else null. */
export const basisHubHeld = m => basisHeld(m, 'bHub');

// P2 C26: the three ratio names, one home (window words from solar.js). Never call an unweighted window mean a
// "weighting" or a capture ratio: capture ratios weight prices by a generation shape; the window ratio does not.
export const RATIO_NAMES = Object.freeze({
  captureClearSky: 'Capture ratio (clear-sky shape)',
  captureFleet: 'Capture ratio (ISO-NE fleet shape)',
  solarWindow: `Solar-window price ratio (${solarWindowLabel(MART_SOLAR_WINDOW).split(' (')[0]}, unweighted)`,
});

// P2 C55: ISO-NE studies light-load and minimum-load cases the store does not hold (gridrules.unstudiedCases). Market
// does not screen them by default (as with the shoulder export case); requiring them makes every injecting bus Unknown.
export const UNSTUDIED_EXCLUDED_REASON = 'light load and minimum load: ISO-NE studies them, the store holds neither, so Market does not screen them (Grid and Decision hold them as Hold rows); "Meets" is on the studied cases only';
export const unstudiedRequired = mkt => Number(mkt?.unstudied) === 1;
/** Service type of the cases a technology reads (gridrules.serviceTag) and the study-staleness note (gridrules.studyStaleness). */
export function marketServiceNote(tech, staleness = {}) {
  const c = applicableCases(tech), tags = [...new Set([...c.export, ...c.import].map(k => serviceTag(k).short))];
  return `Service: ${tags.join('; ')}. ${studyStaleness(staleness).text}`;
}

// ---------- v4: upgrade-cost screen ----------
/**
 * Upgrade-cost screen over one gridrules cost result at the request size, against a ceiling of maxMusd ($M).
 * pass: "No upgrades indicated" (envelope only — value null, never $0), "True zero", or priced total ≤ X.
 * fail: the priced part alone already exceeds X (Priced, Partly priced or Lower bound).
 * unknown: Partly priced or Lower bound with the priced part ≤ X — the full bill is not held. Unknown never passes.
 */
export function upgradeScreen(cost, maxMusd) {
  if (!cost || cost.status === 'Not requested' || !ok(maxMusd)) return null;
  const t = ok(cost.total) ? cost.total : 0, n = cost.items?.length || 0;
  switch (cost.status) {
    case 'True zero': return { status: 'pass', value: 0, label: 'true $0: element evidence in every case', kind: cost.status };
    case 'No upgrades indicated': return { status: 'pass', value: null, label: 'no upgrades indicated (envelope only, not a verified $0)', kind: cost.status };
    case 'Priced': return { status: t <= maxMusd ? 'pass' : 'fail', value: t, label: `$${t.toFixed(1)}M for ${n} facilit${n === 1 ? 'y' : 'ies'}`, kind: cost.status };
    // P2 C10 (grid lead wiring 17): a bound with nothing priced has total null: value null and Grid's own words, never '≥ $0.0M'.
    case 'Partly priced': return { status: t > maxMusd ? 'fail' : 'unknown', value: ok(cost.total) ? t : null, label: ok(cost.total) ? `≥ $${t.toFixed(1)}M: ${cost.unpriced} of ${n} facilities unpriced` : costDisplay(cost, v => `$${v.toFixed(1)}M`), kind: cost.status };
    case 'Lower bound': return { status: t > maxMusd ? 'fail' : 'unknown', value: ok(cost.total) ? t : null, label: ok(cost.total) ? `≥ $${t.toFixed(1)}M: ${(cost.gaps || []).map(g => g.label).join(', ') || 'a case'} upgrades not held` : costDisplay(cost, v => `$${v.toFixed(1)}M`), kind: cost.status };
    default: return { status: 'unknown', value: null, label: `cost status ${cost.status}`, kind: cost.status };
  }
}
const serviceMW = req => (req.tech === 'datacenter' ? [0, Number(req.importMW) || 0] : [Number(req.exportMW) || 0, Number(req.importMW) || 0]);
/** The Grid page's upgrade cost for this request at this bus (same call as Grid: stepCostService). */
export function upgradeCost(study, node, req) {
  const [e, i] = serviceMW(req);
  return stepCostService(study.gridOf(node.bus_id), node.bus_id, req.tech, e, i);
}

// ---------- v4: curtailment screen (PCR runs, unified database) ----------
/** Which modelled resource type backs a service's curtailment screen; null = not applicable. */
export function curtailFuel(tech) { return tech === 'solar' || tech === 'hybrid' ? 'Solar' : tech === 'wind' ? 'Wind' : null; }
/** Column-packed extract (data/market-curtail.json) → row objects. */
export function curtailRows(x) {
  if (!x?.cols || !x.rows) return [];
  return x.rows.map(r => Object.fromEntries(x.cols.map((c, i) => [c, r[i]])));
}
export function kmBetween(lat1, lon1, lat2, lon2) {
  const p = Math.PI / 180, a = Math.sin((lat2 - lat1) * p / 2) ** 2 + Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin((lon2 - lon1) * p / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
/** Energy-weighted curtailed share of the run's modelled resources of one type within radiusKm of the bus; null = none held. */
export function nearbyCurtailment(node, rows, run, type, radiusKm = 25) {
  if (!ok(node.lat) || !ok(node.lon)) return null;
  let off = 0, cur = 0, n = 0, nearest = null; const ids = [];
  for (const r of rows) {
    if (r.run !== run || r.type !== type || !ok(r.lat) || !ok(r.lon) || !ok(r.mwh_offered)) continue;
    const d = kmBetween(node.lat, node.lon, r.lat, r.lon);
    if (d > radiusKm) continue;
    off += r.mwh_offered; cur += r.mwh_curtailed || 0; n++; ids.push(r.bidder);
    if (nearest == null || d < nearest) nearest = d;
  }
  if (!n || !(off > 0)) return null;
  return { run, type, n, mwhOffered: off, mwhCurtailed: cur, share: cur / off, nearestKm: nearest, radiusKm, ids };
}
/** Attach node.curt[run][type] for every bus (Solar and onshore Wind). */
export function attachCurtailment(study, extract, { radiusKm = 25 } = {}) {
  const rows = curtailRows(extract), runs = extract?.runs || [...new Set(rows.map(r => r.run))];
  let held = 0;
  for (const n of study.nodes) {
    const c = {};
    for (const run of runs) for (const t of ['Solar', 'Wind']) { const v = nearbyCurtailment(n, rows, run, t, radiusKm); if (v) { (c[run] ||= {})[t] = v; held++; } }
    n.curt = c;
  }
  study.curtail = { rows, runs, radiusKm, extract };
  return { held };
}
/** Curtailed share by zone and resource type for one run, plus an ISO row per type (sums, never averages of shares). */
export function zoneCurtailment(rows, run) {
  const by = new Map(), add = (zone, type, r) => { const k = `${zone}|${type}`; if (!by.has(k)) by.set(k, { zone, type, n: 0, mwhOffered: 0, mwhCurtailed: 0, hCurtailed: 0, hNonpos: 0 }); const x = by.get(k); x.n++; x.mwhOffered += r.mwh_offered || 0; x.mwhCurtailed += r.mwh_curtailed || 0; x.hCurtailed += r.h_curtailed || 0; x.hNonpos += r.h_curtailed_nonpos || 0; };
  for (const r of rows) { if (r.run !== run) continue; add(r.zone || 'not held', r.type, r); add('ISO', r.type, r); }
  return [...by.values()].map(x => ({ ...x, share: x.mwhOffered > 0 ? x.mwhCurtailed / x.mwhOffered : null }));
}
/**
 * P2 C54: minimum sample for the curtailment screen. A share from fewer modelled resources than this inside the
 * radius moves with one unit's dispatch (a bus 7 km away flips from unknown to a %), so it is shown, never screened on.
 */
export const CURTAIL_MIN_SAMPLE = Object.freeze({ resources: 3, src: 'P2 market fix C54 (kennebec O020, downeast O254): screening rule, not a DB value', status: 'assumption' });
export const curtailSampleOk = v => !!v && v.n >= CURTAIL_MIN_SAMPLE.resources;
/** "n resource(s), x.x GWh offered within R km": the sample behind a nearby curtailment share. */
export const curtailSampleText = v => (v ? `${v.n} resource${v.n === 1 ? '' : 's'}, ${(v.mwhOffered / 1e3).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GWh offered within ${v.radiusKm} km` : 'no modelled resource nearby');
function curtailCheck(node, req) {
  const type = curtailFuel(req.tech);
  if (!ok(req.maxCurtailPct) || !type) return null;
  const run = req.curtailRun || 'pcr2030', v = node.curt?.[run]?.[type];
  const label = `Modelled ${type.toLowerCase()} curtailment nearby ≤ ${req.maxCurtailPct}% (${run})`;
  if (!v) return { key: 'curtail', label, status: 'unknown', value: null, need: req.maxCurtailPct, note: `no modelled ${type.toLowerCase()} resource within ${node.curt ? 'the radius' : 'reach (curtailment not loaded)'} in ${run}` };
  const pct = 100 * v.share;
  if (!curtailSampleOk(v)) return { key: 'curtail', label, status: 'unknown', value: pct, need: req.maxCurtailPct, sample: v.n, note: `${curtailSampleText(v)}: below the ${CURTAIL_MIN_SAMPLE.resources}-resource minimum sample (${pct.toFixed(1)}% shown, not screened)` };
  return { key: 'curtail', label, status: pct <= req.maxCurtailPct ? 'pass' : 'fail', value: pct, need: req.maxCurtailPct, sample: v.n, note: curtailSampleText(v) };
}

/** Index the grid rows by bus once (gridrules filters by bus on every call). */
export function prepare(raw) {
  const by = new Map(), get = b => { const k = String(b); if (!by.has(k)) by.set(k, { headroom: [], constraints: [] }); return by.get(k); };
  for (const r of raw.grid.headroom) get(r.bus_id).headroom.push(r);
  for (const r of raw.grid.constraints) get(r.bus_id).constraints.push(r);
  const empty = { headroom: [], constraints: [] };
  const gridOf = b => by.get(String(b)) || empty;
  // Pre-existing overloads at the summer-peak export case (the Studio's "clean starting point"), Grid rules.
  for (const n of raw.nodes) {
    const el = elementLimit(gridOf(n.bus_id), n.bus_id, 'summer_peak|discharge');
    n._pre = el.status === 'none' ? null : el.status === 'noViolation' ? 0 : el.pre.length;
  }
  return { ...raw, gridOf };
}

/** Overlay /api/x/market/measures onto the nodes. A run whose LMP is 0 in every hour is unpriced: not a $0 price. */
export function attachMeasures(study, measures) {
  let unpricedFixed = 0;
  const B = measures?.buses || {};
  for (const n of study.nodes) {
    const m = B[String(n.bus_id)] || null;
    n.m = m;
    if (m?.unpriced?.includes('pcr2030') && n.lmp_2030 === 0) { n.lmp2030Reported = 0; n.lmp_2030 = null; unpricedFixed++; }
  }
  study.measures = measures;
  return { unpricedFixed };
}

const STATUS = { held: 'held', noViolation: 'noViolation', unpublished: 'unpublished', mislabel: 'held', none: 'none' };

/**
 * Service limits for one bus, straight from the Grid rules: [{ key, caseKey, label, value, status, basis }].
 * S2-GD #4 (D6.1 / F009, W-B 2026-10-07): a case held by the vendor envelope only has status 'envelope' and no value,
 * so Market counts it Unknown (as Decision does); the envelope number stays in `envelope` as context.
 */
export function serviceLimits(study, node, tech) {
  const t = caseTable(study.gridOf(node.bus_id), node.bus_id, tech, 1, 1);
  return t.map(r => ({
    key: r.key === 'summer_peak|discharge' ? 'export-sp' : r.key === 'shoulder|discharge' ? 'export-sh' : r.key === 'shoulder|charge' ? 'charge-sh' : r.key,
    caseKey: r.key, label: CASE_LABEL[r.key], dir: r.dir, value: r.status === ENVELOPE_ONLY ? null : r.governing, envelope: r.envelope,
    status: r.status === ENVELOPE_ONLY ? 'envelope' : r.governing == null ? (r.element.status === 'mislabel' ? 'none' : STATUS[r.element.status] || 'none') : 'held', basis: r.basis,
  }));
}

/** All five study cases for one bus (storage cases + data-centre cases), for the survival matrix. */
export function caseMatrix(study, node) {
  const seen = new Set(), out = [];
  for (const t of ['storage', 'datacenter']) for (const l of serviceLimits(study, node, t)) if (!seen.has(l.caseKey)) { seen.add(l.caseKey); out.push(l); }
  return out;
}

// Lead decision (W-B, 2026-10-07, option b): the store holds no shoulder element study, so under D6.1 a required shoulder
// export case makes every generator bus Unknown. The Market default therefore does not require it; the card says why;
// the user can require it (D6.1 then applies). Storage's shoulder charge check is unaffected (always required).
export const SHOULDER_EXCLUDED_REASON = 'shoulder case: vendor envelope only, not studied — excluded from screening; Decision holds the gate';
export const shoulderRequired = mkt => mkt?.shoulder === true;
export const UNKNOWN_WORD = { noViolation: 'no violations, tested maximum not published', unpublished: 'limit not published', none: 'not studied', envelope: 'envelope only (vendor-asserted, unverified)' };
const requestFor = (req, l) => (req.tech === 'datacenter' ? Number(req.importMW) : l.dir === 'export' ? Number(req.exportMW) : Math.max(Number(req.importMW) || 0, Number(req.exportMW) || 0));
// A borrowed price: a geo-proxy node away from the bus, or a D-008 re-linked node (S2-D: always a far substitution).
const borrowed = node => node.tier === 'relinked' || (node.tier === 'geo_proxy' && !(node.proxyKm < 0.05));
/** C55: the unstudied cases an injecting request would need (none for a load or a zero export). */
const unstudiedFor = req => (Number(req.exportMW) > 0 ? unstudiedCases(req.tech) : []);

/**
 * Evaluate requirements for every bus.
 * req: { tech, exportMW, importMW, zones | null, minKv, useShoulder, maxPrice2025 | null, minPrice2025 | null, ownPriceNode }
 */
export function evaluate(study, req) {
  const cases = applicableCases(req.tech);
  return study.nodes.map(node => {
    const reasons = [], unknown = [];
    if (req.zones?.length && !req.zones.includes(node.zone)) return { node, status: 'excluded', reasons: ['Outside selected zones'], unknown, margin: null };
    if (ok(req.minKv) && req.minKv > 0) { if (!ok(node.kv)) unknown.push('Voltage not held'); else if (node.kv < req.minKv) reasons.push(`Below ${req.minKv} kV`); }
    // The switch drops only the optional shoulder EXPORT case; storage charging (shoulder|charge) is always required.
    const lims = serviceLimits(study, node, req.tech).filter(l => req.useShoulder !== false || l.caseKey !== 'shoulder|discharge');
    const margins = [];
    // v4 upgrade screen: with a ceiling set, a capacity shortfall is admitted when the Grid upgrade cost at the request size clears it.
    const cost = ok(req.maxUpgradeMusd) ? upgradeCost(study, node, req) : undefined, up = cost ? upgradeScreen(cost, req.maxUpgradeMusd) : null;
    for (const l of lims) {
      const mw = requestFor(req, l);
      if (!(mw > 0) || (l.dir === 'export' && !cases.export.includes(l.caseKey)) || (l.dir === 'import' && !cases.import.includes(l.caseKey))) continue;
      if (!ok(l.value)) { unknown.push(`${l.label}: ${UNKNOWN_WORD[l.status] || 'not held'}`); continue; }
      const m = l.value - mw; margins.push(m);
      if (m < 0 && !up) reasons.push(`${l.label} limit ${l.value.toFixed(1)} MW < ${mw} MW`);
    }
    if (up) { if (up.status === 'fail') reasons.push(`Upgrade cost ${up.label} > $${req.maxUpgradeMusd}M`); else if (up.status === 'unknown') unknown.push(`Upgrade cost ${up.label}`); }
    const unst = unstudiedFor(req);
    if (req.requireUnstudied) for (const u of unst) unknown.push(`${u.label}: not studied`);
    const cu = curtailCheck(node, req);
    if (cu) { if (cu.status === 'fail') reasons.push(`${cu.label}: ${cu.value.toFixed(1)}%`); else if (cu.status === 'unknown') unknown.push(`${cu.label}: ${cu.note}`); }
    if (req.ownPriceNode) { if (borrowed(node)) reasons.push(`Borrowed price (${priceTierLabel({ tier: node.tier, km: node.proxyKm, relinkMi: node.relinkMi, relinkedFrom: node.relinkedFrom })})`); }
    const p25 = populationRule({ node }, 'lmp_2025'); // C53: the same population rule as requirementChecks (a part year is not held)
    if (ok(req.maxPrice2025)) { if (!ok(p25)) unknown.push('2025 price not held'); else if (p25 > req.maxPrice2025) reasons.push(`2025 price above $${req.maxPrice2025}`); }
    if (ok(req.minPrice2025)) { if (!ok(p25)) unknown.push('2025 price not held'); else if (p25 < req.minPrice2025) reasons.push(`2025 price below $${req.minPrice2025}`); }
    const status = reasons.length ? 'unmet' : unknown.length ? 'unknown' : 'met';
    const out = { node, status, reasons, unknown: [...new Set(unknown)], margin: margins.length ? Math.min(...margins) : null, unscreened: req.requireUnstudied ? [] : unst.map(u => u.label) };
    if (cost !== undefined) { out.cost = cost; out.upgrade = up; }
    if (cu) out.curtail = cu;
    return out;
  });
}

/**
 * The same requirements as evaluate(), one row per requirement for one bus (pinned equal to evaluate by test):
 * [{ key, label, status: 'pass'|'fail'|'unknown'|'excluded', value, need }].
 */
export function requirementChecks(study, node, req) {
  const out = [], cases = applicableCases(req.tech);
  const up = ok(req.maxUpgradeMusd) ? upgradeScreen(upgradeCost(study, node, req), req.maxUpgradeMusd) : null;
  if (req.zones?.length) { out.push({ key: 'zone', label: 'Load zone', status: req.zones.includes(node.zone) ? 'pass' : 'excluded', value: node.zone, need: req.zones.join(', ') }); if (!req.zones.includes(node.zone)) return out; }
  if (ok(req.minKv) && req.minKv > 0) out.push({ key: 'kv', label: `Voltage ≥ ${req.minKv} kV`, status: !ok(node.kv) ? 'unknown' : node.kv < req.minKv ? 'fail' : 'pass', value: node.kv, need: req.minKv });
  for (const l of serviceLimits(study, node, req.tech).filter(x => req.useShoulder !== false || x.caseKey !== 'shoulder|discharge')) {
    const mw = requestFor(req, l);
    if (!(mw > 0) || (l.dir === 'export' && !cases.export.includes(l.caseKey)) || (l.dir === 'import' && !cases.import.includes(l.caseKey))) continue;
    const short = ok(l.value) && l.value < mw;
    out.push({ key: l.caseKey, label: `${l.label} limit ≥ ${mw} MW`, status: !ok(l.value) ? 'unknown' : short ? (up ? 'pass' : 'fail') : 'pass', value: l.value, need: mw,
      note: !ok(l.value) ? UNKNOWN_WORD[l.status] || 'not held' : short && up ? `${l.basis}; short by ${(mw - l.value).toFixed(1)} MW, judged on the upgrade cost` : l.basis, withUpgrade: short && !!up });
  }
  if (req.requireUnstudied) for (const u of unstudiedFor(req)) out.push({ key: u.key, label: `${u.label} limit ≥ ${Number(req.exportMW)} MW`, status: 'unknown', value: null, need: Number(req.exportMW), note: `not studied: ${u.why} (${u.src})` });
  if (up) out.push({ key: 'upgrade', label: `Upgrade cost ≤ $${req.maxUpgradeMusd}M`, status: up.status, value: up.value, need: req.maxUpgradeMusd, note: up.label });
  const cu = curtailCheck(node, req);
  if (cu) out.push(cu);
  if (req.ownPriceNode) out.push({ key: 'ownPrice', label: 'Own price node', status: borrowed(node) ? 'fail' : 'pass', value: node.tier, need: 'direct or same substation' });
  const p25 = populationRule({ node }, 'lmp_2025'); // D4: a part-year 2025 price is not held (unknown never passes)
  if (ok(req.maxPrice2025)) out.push({ key: 'maxPrice', label: `2025 price ≤ $${req.maxPrice2025}`, status: !ok(p25) ? 'unknown' : p25 > req.maxPrice2025 ? 'fail' : 'pass', value: p25, need: req.maxPrice2025 });
  if (ok(req.minPrice2025)) out.push({ key: 'minPrice', label: `2025 price ≥ $${req.minPrice2025}`, status: !ok(p25) ? 'unknown' : p25 < req.minPrice2025 ? 'fail' : 'pass', value: p25, need: req.minPrice2025 });
  return out;
}

// ---------- v6: "Requirements at bus" (rows for charts.percentileStrip) ----------
const LIMIT_POP = new WeakMap();
/** Every bus's governing limit per case for one technology (the strip's population); null stays null. */
function limitPopulation(study, tech) {
  if (!LIMIT_POP.has(study)) LIMIT_POP.set(study, new Map());
  const byTech = LIMIT_POP.get(study);
  if (!byTech.has(tech)) {
    const out = new Map();
    for (const n of study.nodes) for (const l of serviceLimits(study, n, tech)) { if (!out.has(l.caseKey)) out.set(l.caseKey, []); out.get(l.caseKey).push(ok(l.value) ? l.value : null); }
    byTech.set(tech, out);
  }
  return byTech.get(tech);
}
const FUEL_ROWS = {
  solar: [['solarRatio', `${RATIO_NAMES.solarWindow}, 2025`, ''], ['solwin30', `${RATIO_NAMES.solarWindow}, 2030 (pcr2030)`, ''], ['negHours', 'Negative-price hours 2025', 'h']],
  wind: [['negHours', 'Negative-price hours 2025', 'h'], ['h200', 'Hours above $200, 2025', 'h']],
  storage: [['spread4h', 'TB4 spread 2025', '$/MWh'], ['tb4_30', 'TB4 spread 2030 (pcr2030)', '$/MWh'], ['volHigh', 'Price volatility 2025 (σ)', '$/MWh']],
  hybrid: [['solarRatio', `${RATIO_NAMES.solarWindow}, 2025`, ''], ['spread4h', 'TB4 spread 2025', '$/MWh'], ['tb4_30', 'TB4 spread 2030 (pcr2030)', '$/MWh']],
  datacenter: [['volLow', 'Price volatility 2025 (σ)', '$/MWh'], ['h200', 'Hours above $200, 2025', 'h'], ['outlets', 'Substation outlets', '']],
};
/**
 * One bus against every bus: requirement rows (reference + direction, the same verdict as requirementChecks) and
 * context rows (no reference: never counted). met / unknown / n come from requirementChecks, so the strip's answer
 * ("k of n met") is the screen's own verdict; upgrade, curtailment, own-node and zone checks are returned in
 * `others` (not numeric against the population).
 */
export function requirementStrip(study, ev, e, req) {
  const node = e.node, checks = requirementChecks(study, node, req), rows = [];
  const all = (f) => study.nodes.map(n => { const v = f(n); return ok(v) ? v : null; });
  const lp = limitPopulation(study, req.tech), lims = serviceLimits(study, node, req.tech);
  const excluded = checks.some(c => c.status === 'excluded');
  if (!excluded) {
    const kv = checks.find(c => c.key === 'kv');
    rows.push({ req: kv ? 'kv' : null, label: kv ? kv.label : 'Nominal voltage', unit: 'kV', value: ok(node.kv) ? node.kv : null, pop: all(n => n.kv), ref: kv ? kv.need : null, dir: kv ? 'ge' : null, fmt: v => Math.round(v).toLocaleString('en-US') });
    for (const l of lims) {
      const c = checks.find(x => x.key === l.caseKey);
      rows.push({ req: c ? l.caseKey : null, label: c ? `${l.label} headroom${c.withUpgrade ? ' (short; judged on upgrade cost)' : ''}` : `${l.label} headroom (not required)`, unit: 'MW', value: ok(l.value) ? l.value : null, pop: lp.get(l.caseKey) || [], ref: c ? c.need : null, dir: c ? 'ge' : null });
    }
    const mx = checks.find(c => c.key === 'maxPrice'), mn = checks.find(c => c.key === 'minPrice');
    const p25 = populationRule(e, 'lmp_2025'), pp = all(n => populationRule({ node: n }, 'lmp_2025')); // D4: one population rule
    if (mx) rows.push({ req: 'maxPrice', label: mx.label, unit: '$/MWh', value: p25, pop: pp, ref: mx.need, dir: 'le' });
    if (mn) rows.push({ req: 'minPrice', label: mn.label, unit: '$/MWh', value: p25, pop: pp, ref: mn.need, dir: 'ge' });
    if (!mx && !mn) rows.push({ req: null, label: '2025 RT price', unit: '$/MWh', value: p25, pop: pp, ref: null, dir: null });
    rows.push({ req: null, label: '2030 price (pcr2030)', unit: '$/MWh', value: ok(node.lmp_2030) ? node.lmp_2030 : null, pop: all(n => n.lmp_2030), ref: null, dir: null });
    for (const [k, label, unit] of FUEL_ROWS[req.tech] || FUEL_ROWS.solar) rows.push({ req: null, label, unit, value: MEASURES[k].get(e), pop: ev.map(x => { const v = MEASURES[k].get(x); return ok(v) ? v : null; }), ref: null, dir: null });
    rows.push({ req: null, label: 'Short-circuit strength', unit: 'MVA', value: ok(node.sc_mva) ? node.sc_mva : null, pop: all(n => n.sc_mva), ref: null, dir: null });
    rows.push({ req: null, label: 'Pre-existing overloads (summer-peak export)', unit: '', value: ok(node._pre) ? node._pre : null, pop: all(n => n._pre), ref: null, dir: null, fmt: v => Math.round(v).toLocaleString('en-US') });
  }
  const others = checks.filter(c => ['upgrade', 'ownPrice', 'zone'].includes(c.key) || /curtail/i.test(String(c.key)));
  return { rows, checks, others, excluded, n: checks.length, met: checks.filter(c => c.status === 'pass').length, unknown: checks.filter(c => c.status === 'unknown').length, fail: checks.filter(c => c.status === 'fail' || c.status === 'excluded').length };
}

/** Qualifying funnel: requirements applied in order; each step drops buses that fail, lack evidence, or fall outside the zones. */
export function funnel(study, req) {
  const checks = study.nodes.map(n => ({ n, c: new Map(requirementChecks(study, n, req).map(x => [x.key, x])) }));
  const order = [];
  for (const { c } of checks) for (const [k, x] of c) if (!order.some(o => o.key === k)) order.push({ key: k, label: x.label });
  const rank = k => (k === 'zone' ? 0 : k === 'kv' ? 1 : k.includes('|') ? 2 : 3);
  order.sort((a, b) => rank(a.key) - rank(b.key));
  let live = checks;
  const steps = [{ key: 'all', label: 'Every geolocated bus', remain: live.length, fail: 0, unknown: 0, excluded: 0 }];
  for (const o of order) {
    const st = x => x.c.get(o.key)?.status;
    const fail = live.filter(x => st(x) === 'fail').length, unknown = live.filter(x => st(x) === 'unknown').length, excluded = live.filter(x => st(x) === 'excluded').length;
    live = live.filter(x => !['fail', 'unknown', 'excluded'].includes(st(x)));
    steps.push({ key: o.key, label: o.label, remain: live.length, fail, unknown, excluded });
  }
  return { steps, met: live.map(x => x.n) };
}

/** Each requirement on its own (not sequential): how many in-scope buses pass, fail or lack the evidence. */
export function requirementMatrix(study, req) {
  const rows = new Map();
  for (const n of study.nodes) for (const c of requirementChecks(study, n, req)) {
    if (!rows.has(c.key)) rows.set(c.key, { key: c.key, label: c.label, applies: 0, pass: 0, fail: 0, unknown: 0 });
    const r = rows.get(c.key); r.applies++;
    if (c.status === 'pass') r.pass++; else if (c.status === 'unknown') r.unknown++; else r.fail++;
  }
  return [...rows.values()];
}

// ---------- Measures (the Studio's criteria catalogue, rebuilt on the unified database) ----------
const M = e => e.node.m || {};
const partial25 = e => M(e).n?.['2025'] != null; // fewer than 95% of 2025's hours held
const settled = (e, v) => (partial25(e) || !ok(v) ? null : v);
/** D4: a 2025 settled field of one evaluated bus under POPULATION_RULE (null = not held). */
export const populationRule = (e, field) => settled(e, e.node?.[field]);
const abs = v => (ok(v) ? Math.abs(v) : null);
const TIER_SCORE = { direct: 2, same_substation: 1, relinked: 0 }; // relinked (D-008) = a far node substituted: borrowed

export const MEASURES = {
  margin: { label: 'Headroom margin', group: 'Interconnection', unit: 'MW', dir: 1, get: e => e.margin, src: 'Grid rules at your size' },
  preExist: { label: 'Clean starting point', group: 'Interconnection', unit: 'overloads', dir: -1, get: e => (ok(e.node._pre) ? e.node._pre : null), src: 'pre-existing overloads at summer peak export (fact_limiting_element)' },
  price: { label: '2025 average price', group: 'Revenue', unit: '$/MWh', dir: 1, get: e => settled(e, e.node.lmp_2025), src: 'mart_bus_year RT 2025' },
  lowPrice: { label: 'Low 2025 price (loads)', group: 'Revenue', unit: '$/MWh', dir: -1, get: e => settled(e, e.node.lmp_2025), src: 'mart_bus_year RT 2025' },
  fcst2030: { label: '2030 forecast price (pcr2030 run only)', group: 'Revenue', unit: '$/MWh', dir: 1, get: e => (ok(e.node.lmp_2030) ? e.node.lmp_2030 : null), src: 'mart_bus_fcst_year pcr2030' },
  lowFcst2030: { label: 'Cheap energy 2030 (loads)', group: 'Revenue', unit: '$/MWh', dir: -1, get: e => (ok(e.node.lmp_2030) ? e.node.lmp_2030 : null), src: 'mart_bus_fcst_year pcr2030' },
  fcst2035: { label: '2035 forecast price (pcr2035 run)', group: 'Revenue', unit: '$/MWh', dir: 1, get: e => (ok(M(e).f?.pcr2035) ? M(e).f.pcr2035 : null), src: 'mart_bus_fcst_year pcr2035' },
  spread4h: { label: 'Daily 4-hour spread (2025)', group: 'Revenue', unit: '$/MWh', dir: 1, get: e => settled(e, e.node.tb4_2025), src: 'mart_bus_tb RT 2025' },
  tb2: { label: 'Daily 2-hour spread (2025)', group: 'Revenue', unit: '$/MWh', dir: 1, get: e => settled(e, M(e).tb2), src: 'mart_bus_tb RT 2025' },
  tb8: { label: 'Daily 8-hour spread (2025)', group: 'Revenue', unit: '$/MWh', dir: 1, get: e => settled(e, M(e).tb8), src: 'mart_bus_tb RT 2025' },
  tb4_30: { label: 'Daily 4-hour spread (2030, pcr2030)', group: 'Revenue', unit: '$/MWh', dir: 1, get: e => (ok(M(e).tb4_30) ? M(e).tb4_30 : null), src: 'fact_fcst_lmp_hourly pcr2030' },
  solarRatio: { label: `${RATIO_NAMES.solarWindow}, 2025`, group: 'Revenue', unit: '', dir: 1, prec: 3, get: e => settled(e, e.node.solar_ratio_2025), src: `mart_bus_month RT 2025: unweighted mean LMP over ${solarWindowLabel(MARKET_SOLAR_WINDOW)} ÷ mean LMP (no generation shape; not a capture ratio)` },
  solwin30: { label: `${RATIO_NAMES.solarWindow}, 2030 (pcr2030)`, group: 'Revenue', unit: '', dir: 1, prec: 3, get: e => (ok(M(e).solwin30) ? M(e).solwin30 : null), src: `fact_fcst_lmp_hourly pcr2030: unweighted mean LMP over ${solarWindowLabel(MARKET_SOLAR_WINDOW)} ÷ mean LMP` },
  negHours: { label: 'Few hours below $0 (2025)', group: 'Risk', unit: 'h', dir: -1, get: e => settled(e, e.node.hneg_2025), src: 'mart_bus_month RT 2025' },
  h200: { label: 'Scarcity hours above $200 (2025)', group: 'Revenue', unit: 'h', dir: 1, get: e => settled(e, M(e).h200), src: 'mart_bus_year RT 2025' },
  volLow: { label: 'Price stability (2025 std. dev.)', group: 'Risk', unit: '$/MWh', dir: -1, get: e => settled(e, M(e).std), src: 'mart_bus_year RT 2025' },
  volHigh: { label: 'Price volatility (2025 std. dev.)', group: 'Revenue', unit: '$/MWh', dir: 1, get: e => settled(e, M(e).std), src: 'mart_bus_year RT 2025' },
  basisZone: { label: 'Basis tightness vs own zone (2025)', group: 'Risk', unit: '$/MWh', dir: -1, get: e => abs(basisZoneHeld(M(e))), src: `fact_lmp_hourly RT 2025, hour-matched; held only with ≥ ${Math.round(100 * FULL_YEAR_SHARE)}% of 2025 hours matched` },
  congFree: { label: 'Low congestion component (2025)', group: 'Risk', unit: '$/MWh', dir: -1, get: e => abs(settled(e, M(e).cong)), src: 'mart_bus_year RT 2025' },
  strength: { label: 'Grid strength (short-circuit)', group: 'Connection strength', unit: 'MVA', dir: 1, get: e => (ok(e.node.sc_mva) ? e.node.sc_mva : null), src: 'dim_bus.short_circuit_mva (corrected)' },
  outlets: { label: 'Substation outlets', group: 'Connection strength', unit: '', dir: 1, get: e => (ok(M(e).outlets) ? M(e).outlets : null), src: 'dim_bus.total_outlets' },
  voltage: { label: 'Nominal voltage', group: 'Connection strength', unit: 'kV', dir: 1, get: e => (ok(e.node.kv) ? e.node.kv : null), src: 'dim_bus.nominal_kv' },
  ownPrice: { label: 'Price attribution (own node)', group: 'Data confidence', unit: '', dir: 1, get: e => (e.node.tier === 'geo_proxy' ? (e.node.proxyKm < 0.05 ? 1 : 0) : TIER_SCORE[e.node.tier] ?? null), src: 'bridge_bus_pnode tier: direct 2, same substation 1, borrowed or relinked 0' },
};

/** The live Studio's certified default profiles, mapped to the measures the unified database can back. */
const PROFILES = {
  solar: { margin: 10, fcst2030: 9, solwin30: 8, negHours: 6, basisZone: 5, preExist: 4, tb4_30: 4, congFree: 3, strength: 3, outlets: 2, ownPrice: 3 },
  wind: { margin: 10, fcst2030: 8, h200: 5, basisZone: 5, preExist: 4, congFree: 3, strength: 3, outlets: 2, ownPrice: 3 },
  storage: { tb4_30: 10, margin: 10, tb2: 6, tb8: 4, volHigh: 6, h200: 6, basisZone: 4, preExist: 3, strength: 3, ownPrice: 3 },
  hybrid: { margin: 9, fcst2030: 8, solwin30: 7, tb4_30: 8, negHours: 4, basisZone: 4, preExist: 3, ownPrice: 3 },
  datacenter: { lowFcst2030: 10, margin: 10, volLow: 8, outlets: 6, strength: 6, voltage: 4, basisZone: 4, congFree: 3, ownPrice: 3 },
};
export function defaultWeights(tech) { return { ...(PROFILES[tech] || PROFILES.solar) }; }
/** Ranker presets (plan decision #8): the Studio profile, or the same criteria at one equal weight. */
export const WEIGHT_PRESETS = { studio: 'Studio profile', equal: 'Equal weights' };
export function weightPreset(tech, name) {
  const w = defaultWeights(tech);
  return name === 'equal' ? Object.fromEntries(Object.keys(w).map(k => [k, 1])) : w;
}

/** Percentile of v among sorted values (mid-rank for ties), direction-adjusted; null when not held. */
export function percentile(sortedVals, v, dir) {
  if (!ok(v) || !sortedVals.length) return null;
  // binary search (the linear scan made rank() O(n²) per measure: ~0.5 s of every Grid rebuild at 2,678 buses);
  // lo = first index not < v, hi = first index > v: the same mid-rank as the scan on an ascending array
  let lo = 0, a = sortedVals.length; while (lo < a) { const m = (lo + a) >> 1; if (sortedVals[m] < v) lo = m + 1; else a = m; }
  let hi = lo; a = sortedVals.length; while (hi < a) { const m = (hi + a) >> 1; if (sortedVals[m] <= v) hi = m + 1; else a = m; }
  const p = ((lo + hi) / 2 / sortedVals.length) * 100;
  return dir > 0 ? p : 100 - p;
}

/** Percentile rank among the qualifying set; missing measures shrink coverage, never score as 0. */
/** C26: the value a measure is ranked on: rounded to its display precision where it has one (no ranking on noise). */
export function rankValue(k, e) {
  const v = MEASURES[k].get(e);
  if (!ok(v)) return null;
  const p = MEASURES[k].prec;
  return Number.isInteger(p) ? Number(v.toFixed(p)) : v;
}
export function rank(evals, priorities, weights = {}) {
  const pool = evals.filter(e => e.status === 'met'), sorted = {};
  for (const k of priorities) sorted[k] = pool.map(e => rankValue(k, e)).filter(ok).sort((a, b) => a - b);
  const ranked = pool.map(e => {
    let s = 0, w = 0, wAll = 0; const parts = {};
    for (const k of priorities) { const wt = ok(weights[k]) ? weights[k] : 1; wAll += wt; const p = percentile(sorted[k], rankValue(k, e), MEASURES[k].dir); parts[k] = p; if (p != null) { s += wt * p; w += wt; } }
    return { ...e, score: w ? s / w : null, coverage: wAll ? w / wAll : 0, parts };
  });
  const scored = ranked.filter(r => r.score != null && r.coverage >= 0.6).sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.node.bus_id - b.node.bus_id);
  return { scored, incomplete: ranked.filter(r => r.score == null || r.coverage < 0.6), poolSize: pool.length, sorted };
}

/** C75: a bus's 1-based Market rank among the scored buses ({ rank, of, score }), or null when it is not ranked. */
export function marketRankOf(rk, busId) {
  const i = rk?.scored ? rk.scored.findIndex(x => String(x.node.bus_id) === String(busId)) : -1;
  return i < 0 ? null : { rank: i + 1, of: rk.scored.length, score: rk.scored[i].score };
}

/** C67: one reconciliation of Find and Rank: in scope -> met · unknown · unmet; Rank scores of met (incomplete lack 60%). */
export function reconcile(evals, rk) {
  const cnt = s => evals.filter(e => e.status === s).length;
  const met = cnt('met'), unknown = cnt('unknown'), unmet = cnt('unmet'), inScope = met + unknown + unmet;
  const scored = rk ? rk.scored.length : null, incomplete = rk ? rk.incomplete.length : null;
  const text = `${inScope} in scope → ${met} meet · ${unknown} unknown · ${unmet} do not${rk ? `; Rank scores ${scored} of ${met} (${incomplete} lack 60% of weight)` : ''}`;
  return { inScope, met, unknown, unmet, scored, incomplete, text };
}

/** Points each criterion adds to one bus's score: weight × percentile ÷ weight used (they sum to the score). */
export function contributions(x, keys, weights) {
  const w = k => (ok(weights[k]) ? weights[k] : 1);
  const used = keys.filter(k => x.parts[k] != null).reduce((t, k) => t + w(k), 0);
  return keys.map(k => ({ key: k, weight: w(k), pct: x.parts[k], points: x.parts[k] != null && used ? (w(k) * x.parts[k]) / used : null }));
}

export function quantile(values, q) {
  const v = values.filter(ok).sort((a, b) => a - b); if (!v.length) return null;
  const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
export const median = values => quantile(values, 0.5);

/** The Studio's discrimination statement: does this weighting separate the candidates? */
export function discrimination(r, keys, weights) {
  const sc = r.scored.map(x => x.score), top = sc.length ? Math.max(...sc) : null;
  const p5 = quantile(sc, 0.05), p95 = quantile(sc, 0.95), spread = ok(p5) && ok(p95) ? p95 - p5 : null;
  const w = k => (ok(weights[k]) ? weights[k] : 1);
  const active = keys.filter(k => w(k) > 0);
  const flat = active.filter(k => { const v = r.sorted[k] || []; if (!v.length) return false; const a = quantile(v, 0.1), b = quantile(v, 0.9); return Math.abs(b - a) < 1e-9; });
  const verdict = !ok(spread) ? 'Nothing is scored.' : spread >= 20 ? 'This weighting separates the candidates clearly.' : spread >= 6 ? 'This weighting separates the candidates, though not sharply.' : 'This weighting does not separate the candidates. Weight fewer things more heavily, or rank on one explicit measure.';
  return { top, p5, p95, spread, within2: ok(top) ? sc.filter(v => v >= top - 2).length : 0, flat, flatWeight: flat.reduce((t, k) => t + w(k), 0), totalWeight: active.reduce((t, k) => t + w(k), 0), verdict, discriminates: ok(spread) && spread >= 6 };
}

/** How many of today's top N stay in the top N when one criterion is dropped, halved or doubled. */
export function sensitivity(evals, keys, weights, N = 10) {
  const w = k => (ok(weights[k]) ? weights[k] : 1);
  const topOf = (ks, ws) => new Set(rank(evals, ks, ws).scored.slice(0, N).map(x => String(x.node.bus_id)));
  const base = topOf(keys, weights);
  const overlap = s => [...base].filter(id => s.has(id)).length;
  return keys.filter(k => w(k) > 0).map(k => {
    const rest = keys.filter(x => x !== k && w(x) > 0);
    return { key: k, dropped: rest.length ? overlap(topOf(rest, weights)) : null, halved: overlap(topOf(keys, { ...weights, [k]: w(k) / 2 })), doubled: overlap(topOf(keys, { ...weights, [k]: w(k) * 2 })), base: base.size };
  });
}

/** Where a bus sits market-wide on each measure: percentile among every in-scope bus that holds a value. */
export function marketPercentiles(evals, e, keys) {
  const pop = evals.filter(x => x.status !== 'excluded');
  return keys.map(k => {
    const vals = pop.map(x => MEASURES[k].get(x)).filter(ok).sort((a, b) => a - b), v = MEASURES[k].get(e);
    return { key: k, label: MEASURES[k].label, value: v, pct: percentile(vals, v, MEASURES[k].dir), n: vals.length };
  });
}

const atSize = (req, s) => ({ ...req, exportMW: req.tech === 'datacenter' ? 0 : s, importMW: req.tech === 'datacenter' || ['storage', 'hybrid'].includes(req.tech) ? s : 0 });

/** Qualifying counts by size (no summing of headroom). */
export function sizeSweep(study, req, sizes) {
  return sizes.map(s => {
    const ev = evaluate(study, atSize(req, s));
    return { size: s, met: ev.filter(e => e.status === 'met').length, unknown: ev.filter(e => e.status === 'unknown').length, unmet: ev.filter(e => e.status === 'unmet').length };
  });
}

/** Per-bus status at every size, the largest size each bus qualifies at, and the same sweep counts as sizeSweep. */
export function sizeProfile(study, req, sizes) {
  const buses = new Map(), sweep = [];
  sizes.forEach((s, i) => {
    const ev = evaluate(study, atSize(req, s));
    sweep.push({ size: s, met: ev.filter(e => e.status === 'met').length, unknown: ev.filter(e => e.status === 'unknown').length, unmet: ev.filter(e => e.status === 'unmet').length });
    for (const e of ev) {
      const id = String(e.node.bus_id);
      if (!buses.has(id)) buses.set(id, { node: e.node, statuses: [], margins: [], maxMet: null });
      const b = buses.get(id); b.statuses[i] = e.status; b.margins[i] = e.margin;
      if (e.status === 'met' && (b.maxMet == null || s > b.maxMet)) b.maxMet = s;
    }
  });
  return { sizes, sweep, buses };
}

/** Counts per bin [lo, hi); the last bin includes its top edge. Values not held or outside the edges are not binned. */
export function histogram(values, edges) {
  const bins = edges.slice(0, -1).map((lo, i) => ({ lo, hi: edges[i + 1], n: 0 }));
  let outside = 0;
  for (const v of values) {
    if (!ok(v)) continue;
    const i = bins.findIndex((b, j) => v >= b.lo && (v < b.hi || (j === bins.length - 1 && v === b.hi)));
    if (i < 0) outside++; else bins[i].n++;
  }
  bins.outside = outside;
  return bins;
}

/** Region comparison: shares and medians of an explicit population, never a summed capacity. */
export function regions(evals) {
  const zones = [...new Set(evals.map(e => e.node.zone))].sort();
  return zones.map(z => {
    const pop = evals.filter(e => e.node.zone === z && e.status !== 'excluded');
    const met = pop.filter(e => e.status === 'met');
    const prices = pop.map(e => populationRule(e, 'lmp_2025')).filter(ok); // C53: part-year 2025 prices are not held
    return { zone: z, buses: pop.length, met: met.length, metShare: pop.length ? met.length / pop.length : null, unknownShare: pop.length ? pop.filter(e => e.status === 'unknown').length / pop.length : null, medianMargin: median(met.map(e => e.margin)), medianPrice: median(prices), priceHeld: prices.length };
  });
}

/** Generation shares by year (percent of the year's summed MWh). */
export function genMixShares(rows) {
  const by = new Map();
  for (const r of rows) { if (!ok(r.mwh)) continue; if (!by.has(r.y)) by.set(r.y, { y: r.y, total: 0, mwh: {}, share: {} }); const g = by.get(r.y); g.total += r.mwh; g.mwh[r.fuel] = (g.mwh[r.fuel] || 0) + r.mwh; }
  for (const g of by.values()) for (const [f, v] of Object.entries(g.mwh)) g.share[f] = g.total ? (100 * v) / g.total : null;
  return [...by.values()].sort((a, b) => a.y - b.y);
}

// ---------- P2 C53: settled years with part years flagged ----------
/** One row per settled year: { y, v, part, hours } (part = fewer than FULL_YEAR_SHARE of its hours held; m.n carries them). */
export function settledYears(node, years, field = 'y') {
  const m = node?.m || {};
  return years.map(y => { const h = m.n?.[y]; const v = m[field]?.[y]; return { y: String(y), v: ok(v) ? v : null, part: h != null, hours: h != null ? h : null }; });
}
/** Basis persistence over FULL settled years only: { pos, of, partYears, points } (part years drawn but never counted). */
export function persistence(node, years) {
  const rows = settledYears(node, years, 'cl'), full = rows.filter(r => !r.part && ok(r.v));
  return { pos: full.filter(r => r.v > 0).length, of: full.length, partYears: rows.filter(r => r.part).map(r => r.y), points: rows.map(r => ({ x: Number(r.y), y: r.v, part: r.part })) };
}
/** Endpoint words for a settled-price sparkline, a part year starred with its hours: "$50.00 (2023*) → $80.00 (2026*)". */
export function sparkEnds(node, years) {
  const rows = settledYears(node, years).filter(r => ok(r.v));
  if (!rows.length) return { text: 'no settled history', part: [] };
  const w = r => `$${r.v.toFixed(2)} (${r.y}${r.part ? '*' : ''})`, a = rows[0], b = rows.at(-1);
  const part = rows.filter(r => r.part);
  return { text: `${w(a)} → ${w(b)}${part.length ? ` · * part year: ${part.map(r => `${r.y} ${Math.round(r.hours).toLocaleString('en-US')} h`).join(', ')}` : ''}`, part: part.map(r => r.y) };
}

// ---------- P2 C57: network cost per kW by zone, with its sample ----------
export const COST_STATUSES = ['Priced', 'True zero', 'No upgrades indicated', 'Partly priced', 'Lower bound'];
/** Median $/kW over priced or true-zero buses in a zone, with n and the count of every cost status beside it. */
export function zoneCostSummary(cost, zone, size) {
  const cs = cost.filter(c => c.zone === zone), byStatus = {};
  for (const c of cs) { const st = c[`st${size}`] || 'not held'; byStatus[st] = (byStatus[st] || 0) + 1; }
  const vals = cs.map(c => c[size]).filter(ok);
  return { zone, size, median: median(vals), n: vals.length, buses: cs.length, byStatus, envelopeOnly: byStatus['No upgrades indicated'] || 0, excluded: cs.length - vals.length };
}
