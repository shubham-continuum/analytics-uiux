// Land core: footprint need vs screened buildable area, land cost and connection corridor.
// Rules (merged plan, Claude pack §L1–§L3): the bus-centred disc is a SCREENING area, not a site;
// the largest block outside habitat/protected land is an UPPER BOUND on buildable land (water, developed land,
// wetlands and slope are not screened); a missing site location is never distance 0; the
// county land-cost proxy is an unmeasured assumption; routing factor and $/mile are user inputs.
import { applicableCases, CASE_LABEL, caseTable, binding, ENVELOPE_ONLY } from './gridrules.js';
import { fitExtent } from './geomap.js';
import * as RX from './rules/isone.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
export const FUEL_KEY = { solar: 'solar', wind: 'wind', storage: 'bess', hybrid: 'hybrid', datacenter: 'dc' };

/** Acres the project needs (low/base/high) from the intensity table. */
export function footprint(intensity, tech, mw) {
  const row = intensity?.by_fuel?.[FUEL_KEY[tech]];
  if (!row || !ok(mw) || mw <= 0) return null;
  const f = k => (ok(row[`${k}_acres_per_mw`]) ? row[`${k}_acres_per_mw`] * mw : null);
  return { low: f('low'), base: f('base'), high: f('high'), cited: !!row.cited, basis: row.area_basis, source: row.source, row };
}

// S2-EM F007 (2026-10-06): a layer's 0 acres is a clean result only where its dataset covers what the layer name
// promises. The screen's habitat layer is USFWS federal critical habitat only (preview docs/OVERLAY-ACQUISITION.md,
// acquired 2026-09-11); state rare-species habitat (e.g. MA NHESP Priority Habitat) is not held, so "0 ac" of habitat
// is "not screened here", never a clean result. The other three layers are ISO-wide datasets (coverage declared).
export const LAYER_SOURCE = {
  habitat: { dataset: 'USFWS Critical Habitat (final + proposed): federal designations only', gap: 'state rare-species habitat (e.g. MA NHESP Priority Habitat) is not held', covers: false },
  protected: { dataset: 'PAD-US (USGS Protected Areas Database), all New England states', covers: true },
  airport: { dataset: 'Airport advisory zones, all New England states', covers: true },
  'energy-community': { dataset: 'DOE NETL 2024 energy-community layers (coal closure; MSA/non-MSA), all six states', covers: true },
};
/**
 * One layer's acres under the null policy: {status 'ok'|'missing', value, reason}. A zero is held only when the
 * layer's coverage is declared (the screen entry's own `coverage`, else LAYER_SOURCE); otherwise "not screened here".
 */
export function layerState(l, coverage = {}) {
  const src = LAYER_SOURCE[l?.layer] || {};
  if (!ok(l?.acres)) return { status: 'missing', value: null, reason: 'acres not held' };
  const covered = coverage[l.layer] ?? src.covers ?? false;
  if (l.acres === 0 && !covered) return { status: 'missing', value: null, reason: `${l.layer} not screened here (layer coverage): ${src.dataset || 'dataset not named'}${src.gap ? `; ${src.gap}` : ''}` };
  return { status: 'ok', value: l.acres, reason: '' };
}

/** Screened area around the bus. Null when no exclusion screen is held for the bus. Each layer carries status/value/reason. */
export function screen(exclusions, bus) {
  const e = exclusions?.[String(bus)];
  if (!e) return null;
  const layers = (e.layers || []).map(l => ({ ...l, ...layerState(l, e.coverage || {}), source: LAYER_SOURCE[l.layer]?.dataset || null }));
  const subtracted = layers.filter(l => l.subtracted), advisory = layers.filter(l => !l.subtracted);
  const unscreened = subtracted.filter(l => l.status === 'missing').map(l => l.layer);
  return { radiusMi: e.radius_mi, gross: e.disc_acres, clear: e.clear_acres, blocks: e.clear_blocks, excludedShare: ok(e.disc_acres) && e.disc_acres > 0 && ok(e.clear_acres) ? 1 - e.clear_acres / e.disc_acres : null, subtracted, advisory, unscreened, water: e.water_excluded, method: e.method };
}

/** Disc area in acres for a radius in miles (π·r²·640): an independent check on the measured disc. */
export const discAcres = r => (ok(r) && r >= 0 ? Math.PI * r * r * 640 : null);

export const FIT_CAVEAT = 'Water, urban land, wetlands and slope are not screened: only habitat and protected land are subtracted, so "fits" is an upper bound';
/** Fit: yes / no / unknown for each footprint case. 'fits' is against a habitat/protected-only screen (screenOnly). */
export function fit(fp, sc) {
  if (!fp) return { status: 'unknown', reason: 'No footprint for this technology' };
  if (!sc || !ok(sc.clear)) return { status: 'unknown', reason: 'No exclusion screen held for this bus' };
  const by = k => (ok(fp[k]) ? (sc.clear >= fp[k] ? 'fits' : 'does not fit') : 'unknown');
  const gap = sc.unscreened?.length ? `; ${sc.unscreened.join(', ')} not screened here (layer coverage), so nothing was subtracted for ${sc.unscreened.length === 1 ? 'it' : 'them'}` : '';
  return { status: by('base'), low: by('low'), base: by('base'), high: by('high'), screenOnly: true, unscreened: sc.unscreened || [], caveat: `${FIT_CAVEAT}${sc.water === false ? ' (water is not excluded in this screen)' : ''}${gap}.` };
}
export const fitLabel = s => (s === 'fits' ? 'fits (habitat/protected screen only)' : s);

/**
 * F014: land status of one bus for Market shortlists. Unscreened = "land not screened" (status missing), never clear.
 * land = {exclusions, intensity} (data/land.json) or null while loading.
 */
export function landStatus(land, bus, tech, mw) {
  if (!land) return { status: 'missing', label: 'land data not loaded', fit: null };
  const sc = screen(land.exclusions, bus);
  if (!sc) return { status: 'missing', label: 'land not screened', fit: null };
  const f = fit(footprint(land.intensity, tech, mw), sc);
  const gap = sc.unscreened.length ? ` (${sc.unscreened.join(', ')} not screened)` : '';
  const label = f.status === 'fits' ? `fits*${gap}` : f.status === 'does not fit' ? `does not fit${gap}` : `unknown: ${f.reason || 'no footprint'}`;
  return { status: f.status === 'unknown' ? 'missing' : f.status, label, fit: f, clear: sc.clear };
}
/** How many of the listed buses hold a land screen. */
export function landScreenCount(land, nodes) {
  const ex = land?.exclusions || {};
  return { held: nodes.filter(n => ex[String(n.bus_id ?? n.id)]).length, of: nodes.length };
}
/** F018: a placed site cannot be judged against exclusions: the screen holds acres per layer, not shapes. */
export function siteExclusionNote(sc, site) {
  if (!site || !ok(site.lat) || !ok(site.lon)) return null;
  if (!sc) return { status: 'missing', text: 'No exclusion screen for this bus: the position against exclusions is unknown.' };
  return { status: 'missing', text: 'Position against exclusions is unknown: shapes not held (the screen holds acres per layer, not the polygons or the largest block outline).' };
}

/**
 * Site control at the request (S-1). S3 Lead wiring 3 (W-B, 2026-10-07): the gate is rules/isone.js siteControlGate,
 * so Land, Queue and Decision share one rule: ISO-NE 100% at request (Sched 22 §3.4; NRIS may post the deposit in
 * lieu where a regulatory limitation applies), the FERC pro forma 90% only under its labelled profile. Unknown never passes.
 * opts = {service, regulatoryLimitation, profile} from S.ui (qService, qRegLimit, qProfile).
 */
export function siteControl(tech, pct, opts = {}) {
  const g = RX.siteControlGate({ pct, tech, service: opts.service, regulatoryLimitation: !!opts.regulatoryLimitation, profile: opts.profile });
  const prof = RX.profileInfo(opts.profile);
  if (tech === 'datacenter') return { applicable: false, verdict: 'n/a', status: 'not applicable (generator site-control rule)', note: `A data centre is a load: ISO-NE's compliance tariff governs its connection, not the generator site-control rule (${g.reason}).`, required: null, cite: g.cite, profile: prof };
  const status = g.verdict === 'Open' ? 'unknown' : `${g.verdict}: ${g.reason}`;
  return { applicable: true, verdict: g.verdict, status, reason: g.reason, via: g.via || null, required: g.required, cite: g.cite, citeLieu: g.citeLieu || null, profile: prof };
}

/** County land-cost proxy row ($/acre, assumption). */
export function landRate(landCost, node) {
  const key = x => `${String(x.state || '').toUpperCase()}|${String(x.county || '').toUpperCase()}`;
  const k = `${String(node?.state_code || '').toUpperCase()}|${String(node?.county || '').toUpperCase()}`;
  return (landCost?.rows || []).find(r => key(r) === k) || null;
}

const toRad = d => (d * Math.PI) / 180;
export function miles(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(ok)) return null;
  const R = 3958.8, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- v6: the site map on the shared geoMap projection ----------
/**
 * Frame for the corridor site map: an extent (geomap.fitExtent) holding the bus, its outer ring and the placed site,
 * widened to the W×H canvas, plus the attributes the app's click handler reads (lon0, lat0, span, lspan). On the
 * equirectangular projection a click fraction maps linearly to lon/lat, so siteFromFraction inverts it exactly.
 */
export function siteMapFrame(node, site, { W = 640, H = 420, rings = [3, 6, 9], cos0 = 0.725374 } = {}) {
  const bl = node?.latitude, bo = node?.longitude;
  if (!ok(bl) || !ok(bo)) return null;
  const R = Math.max(...rings, 1), dLat = R / 69, dLon = R / (69 * cos0);
  const pts = [[bo - dLon, bl], [bo + dLon, bl], [bo, bl - dLat], [bo, bl + dLat]];
  if (ok(site?.lat) && ok(site?.lon)) pts.push([site.lon, site.lat]);
  const extent = fitExtent(pts, { padMi: 1 }, W, H, cos0);
  return { extent, cos0, attrs: { lon0: extent.lon0, lat0: extent.lat0, span: extent.lat1 - extent.lat0, lspan: extent.lon1 - extent.lon0 } };
}
/** The app handler's mapping (fx, fy = click fractions of the svg box, from the top-left). */
export const siteFromFraction = (a, fx, fy) => ({ lon: a.lon0 + fx * a.lspan, lat: a.lat0 + (1 - fy) * a.span });

// ---------- v2 (2026-09-29): disc composition, block cover, need matrix, cost grid, lease vs buy, stations, permits ----------

/** Net excluded share bounds: at least the largest subtracted layer, at most min(sum of layers, disc − largest block). */
export function excludedRange(sc) {
  if (!sc || !ok(sc.gross)) return null;
  const s = sc.subtracted.map(l => l.acres).filter(ok), low = s.length ? Math.max(...s) : 0, sum = s.reduce((a, b) => a + b, 0);
  const high = ok(sc.clear) ? Math.min(sum, sc.gross - sc.clear) : Math.min(sum, sc.gross);
  return { low, high, sum, gross: sc.gross };
}

/** Disc composition for the ring diagram: largest block + certainly excluded (largest layer) + the rest
 *  (excluded by other layers, or clear but fragmented outside the largest block: the screen does not split them). */
export function discSplit(sc) {
  if (!sc || !ok(sc.gross) || !ok(sc.clear)) return null;
  const r = excludedRange(sc), excludedMin = Math.min(r.low, sc.gross - sc.clear);
  return { gross: sc.gross, block: sc.clear, excludedMin, rest: sc.gross - sc.clear - excludedMin };
}

/** Largest block ÷ need per band (≥ 1 means the block is at least the need; habitat/protected screen only). */
export function blockCover(fp, sc) {
  const r = k => (fp && ok(fp[k]) && fp[k] > 0 && sc && ok(sc.clear) ? sc.clear / fp[k] : null);
  const out = { low: r('low'), base: r('base'), high: r('high') };
  out.status = out.base == null ? 'unknown' : out.base >= 1 ? 'fits' : 'does not fit';
  return out;
}

/** Need (acres) for every technology × size. Unknown technologies stay null. */
export function needMatrix(intensity, techs, sizes) {
  return techs.flatMap(tech => sizes.map(mw => { const f = footprint(intensity, tech, mw); return { tech, mw, low: f?.low ?? null, base: f?.base ?? null, high: f?.high ?? null }; }));
}

/** Cost per need band for each $/acre level: rows [{band, acres, costs:[per rate]}]; a blank rate is not held. */
export function costGrid(fp, rates) {
  return ['low', 'base', 'high'].map(band => ({ band, acres: fp?.[band] ?? null, costs: rates.map(r => (ok(r.rate) && fp && ok(fp[band]) ? fp[band] * r.rate : null)) }));
}

/** PV factor of a growing annuity: Σ_{t=1..n} (1+g)^(t−1) / (1+r)^t. */
export function annuityFactor(r, g, n) {
  if (![r, g, n].every(ok) || n < 1 || r <= -1) return null;
  if (Math.abs(r - g) < 1e-12) return n / (1 + r);
  return (1 - ((1 + g) / (1 + r)) ** n) / (r - g);
}

/** Lease vs buy (all inputs are the user's; % inputs in percent). Resale blank → the buy cost has no resale credit
 *  and is an UPPER bound (labelled), never a silent zero. */
export function leaseVsBuy({ acres, buy, lease, disc, years, esc, resale }) {
  const need = [['land need', acres], ['purchase price', buy], ['lease rate', lease], ['discount rate', disc], ['term', years], ['lease escalator', esc]];
  const missing = need.filter(([, v]) => !ok(v)).map(([k]) => k);
  if (ok(years) && (years < 1 || years > 99 || Math.round(years) !== years)) missing.push('term (whole years 1–99)');
  if (missing.length) return { status: 'not held', missing };
  const r = disc / 100, g = esc / 100, af = annuityFactor(r, g, years);
  const pvLease = acres * lease * af, buyCost = acres * buy;
  const pvResale = ok(resale) ? (buyCost * resale) / 100 / (1 + r) ** years : null;
  const netBuy = buyCost - (pvResale ?? 0);
  return { status: 'ok', missing: [], af, pvLease, buyCost, pvResale, netBuy, buyBound: pvResale == null ? 'upper' : null, diff: pvLease - netBuy, cheaper: pvLease < netBuy ? 'lease' : pvLease > netBuy ? 'buy' : 'equal', breakevenLease: netBuy / (acres * af) };
}

const HR_FIELDS = ['hr_sp_dis', 'hr_sp_chg', 'hr_sh_dis', 'hr_sh_chg', 'hr_ll_chg'];
/** Group spine buses that share a name, kV and coordinate into one station (group maxima kept for the table; the
 *  request test reads each bus in `rows` separately). `self` ({name, kv}) drops the candidate's own station. By distance. */
export function stationGroups(stations, self) {
  const G = new Map();
  for (const s of stations || []) {
    const k = `${s.substation_name}|${s.nominal_kv}|${s.latitude}|${s.longitude}`;
    const g = G.get(k) || { name: s.substation_name, kv: s.nominal_kv, lat: s.latitude, lon: s.longitude, mi: s.mi, buses: 0, ids: [], rows: [], county: s.county, state: s.state_code, screened: false, sc: null, outlets: null, hr_sp_dis: null, hr_sp_chg: null, hr_sh_dis: null, hr_sh_chg: null, hr_ll_chg: null };
    g.buses += 1; g.ids.push(s.bus_id); g.mi = Math.min(g.mi, s.mi); g.screened = g.screened || !!s.screened;
    g.rows.push(Object.fromEntries([['bus_id', s.bus_id], ...HR_FIELDS.map(f => [f, ok(s[f]) ? s[f] : null])]));
    for (const f of HR_FIELDS) if (ok(s[f])) g[f] = ok(g[f]) ? Math.max(g[f], s[f]) : s[f];
    if (ok(s.short_circuit_mva)) g.sc = ok(g.sc) ? Math.max(g.sc, s.short_circuit_mva) : s.short_circuit_mva;
    if (ok(s.total_outlets)) g.outlets = ok(g.outlets) ? Math.max(g.outlets, s.total_outlets) : s.total_outlets;
    G.set(k, g);
  }
  return [...G.values()].filter(g => !(self && g.name === self.name && g.kv === self.kv && g.mi < 0.05)).sort((a, b) => a.mi - b.mi);
}

// ---------- v4 (2026-09-30): the request rule is Grid's (gridrules.applicableCases), not a Land-local one ----------
/** fact_headroom case → the station field the Land API returns for it. */
export const CASE_FIELD = { 'summer_peak|discharge': 'hr_sp_dis', 'summer_peak|charge': 'hr_sp_chg', 'shoulder|discharge': 'hr_sh_dis', 'shoulder|charge': 'hr_sh_chg', 'large_load|charge': 'hr_ll_chg' };
/** The cases a request reads, in Grid's order: generation reads the export cases; storage and hybrid add the charge
 *  side (shoulder charge only: storage is never charged at summer peak); a data centre reads its import cases. */
export function requestCases(tech) {
  const a = applicableCases(tech), lab = k => CASE_LABEL[k] || k;
  const ex = a.export.map(key => ({ key, dir: 'export', field: CASE_FIELD[key], label: lab(key) })), im = a.import.map(key => ({ key, dir: 'import', field: CASE_FIELD[key], label: lab(key) }));
  return tech === 'datacenter' ? im : [...ex, ...im];
}
/** MW a case is tested at: export MW on the export side; import MW for a data centre; storage and hybrids charge at
 *  their power rating, max(import, export) (the Grid stepCostService convention). */
export function caseMW(tech, dir, exportMW, importMW) {
  const e = Number(exportMW), i = Number(importMW);
  if (dir === 'export') return ok(e) && e > 0 ? e : null;
  if (tech === 'datacenter') return ok(i) && i > 0 ? i : null;
  const m = Math.max(ok(i) ? i : 0, ok(e) ? e : 0);
  return m > 0 ? m : null;
}
const verdict = cs => (cs.some(c => c.clears === 'not met') ? 'not met' : cs.length && cs.every(c => c.clears === 'met') ? 'met' : 'unknown');
function testOne(row, tech, exportMW, importMW) {
  const cases = requestCases(tech).map(c => { const hr = ok(row?.[c.field]) ? row[c.field] : null, mw = caseMW(tech, c.dir, exportMW, importMW); return { ...c, hr, mw, margin: ok(hr) && ok(mw) ? hr - mw : null, clears: clearsRequest(hr, mw) }; });
  const all = cases.length && cases.every(c => ok(c.hr));
  const low = all ? cases.reduce((a, b) => (b.hr < a.hr ? b : a)) : null;
  const tight = cases.filter(c => ok(c.margin)).reduce((a, b) => (!a || b.margin < a.margin ? b : a), null);
  return { cases, hr: low ? low.hr : null, binding: (tight || low)?.key ?? null, clears: verdict(cases), bus: row?.bus_id ?? null };
}
/** Request test at a bus or station: every applicable case at its own MW; clears only when every case is met; a known
 *  fail fails; otherwise unknown. `hr` = the lowest applicable envelope (null if any is missing). A grouped station is
 *  tested bus by bus and its best single bus stands for it (cases are never mixed across buses). */
export function requestTest(g, tech, exportMW, importMW) {
  if (!g?.rows?.length) return testOne(g, tech, exportMW, importMW);
  const rank = t => (t.clears === 'met' ? 2 : t.clears === 'unknown' ? 1 : 0);
  return g.rows.map(r => testOne(r, tech, exportMW, importMW)).reduce((a, b) => (rank(b) > rank(a) || (rank(b) === rank(a) && (b.hr ?? -Infinity) > (a.hr ?? -Infinity)) ? b : a));
}
/** Which solved envelopes a request reads (fields and a label naming every case). */
export function requestSide(tech) {
  const cs = requestCases(tech);
  const label = tech === 'datacenter' ? 'lower of large-load and summer-peak withdrawal'
    : tech === 'storage' || tech === 'hybrid' ? 'lower of summer-peak and shoulder injection and shoulder charge'
      : 'lower of summer-peak and shoulder injection';
  return { keys: cs.map(c => c.field), key: cs[0].field, label };
}
/** The lowest applicable envelope at a bus or station; null when any applicable case is missing. */
export const requestHeadroom = (g, tech) => testOne(g, tech, null, null).hr;
export const clearsRequest = (hr, mw) => (!ok(hr) || !ok(mw) ? 'unknown' : hr >= mw ? 'met' : 'not met');

// ---------- P2 C07/C41 (2026-10-10): Land's verdict IS Grid's (D6.1) ----------
// requestTest above compares the vendor envelope with the request; under D6.1 an envelope-only case is "Envelope only"
// (Hold-class), never a pass or a fail, so Land's statements of clears / does not clear now come from here: the Grid
// caseTable + binding on the same store rows, at the MW as entered (Grid › Connection capacity and Decision).
const VERDICT_LABEL = { Fits: 'Fits (element study)', 'Does not fit': 'Does not fit (element study)', [ENVELOPE_ONLY]: 'Envelope only (Hold)', Hold: 'Hold (element limit not published)', 'Partly studied': 'Partly studied (Hold)', 'Not studied': 'Not studied', 'Not requested': 'Not requested' };
const HOLD_ORDER = ['Hold', ENVELOPE_ONLY, 'Partly studied', 'Not studied'];
/** One bus's connection verdict on a grid payload ({headroom, constraints}): Grid's binding status per direction, and
 *  one overall status (Does not fit on any element breach; Fits only when every requested direction Fits; otherwise
 *  the Hold-class status). `clears` is true only for Fits. `hr` = the lowest governing value over the applicable cases. */
export function landVerdict(grid, bus, tech, exportMW, importMW) {
  const table = caseTable(grid, bus, tech, Number(exportMW), Number(importMW));
  const ex = binding(table, 'export'), im = binding(table, 'import');
  const req = [ex, im].filter(b => b.status !== 'Not requested');
  const status = !req.length ? 'Not requested' : req.some(b => b.status === 'Does not fit') ? 'Does not fit' : req.every(b => b.status === 'Fits') ? 'Fits'
    : HOLD_ORDER.find(s => req.some(b => b.status === s)) || 'Not studied';
  const gov = table.filter(r => ok(r.governing));
  const low = gov.length ? gov.reduce((a, b) => (b.governing < a.governing ? b : a)) : null;
  const bind = (req.find(b => b.status === 'Does not fit') || req.filter(b => ok(b.value)).sort((a, b) => a.value - b.value)[0])?.row?.key ?? low?.key ?? null;
  return { status, label: VERDICT_LABEL[status] || status, clears: status === 'Fits', export: ex, import: im, table, hr: low ? low.governing : null, binding: bind, bus: bus ?? null };
}
/** A Land API station row (hr_* fields from fact_headroom) + that bus's element rows as a Grid-shaped payload. */
export function stationGrid(row, elements) {
  const headroom = Object.entries(CASE_FIELD).filter(([, f]) => ok(row?.[f])).map(([k, f]) => { const [scenario, direction] = k.split('|'); return { bus_id: row.bus_id, scenario, direction, headroom_mw: row[f] }; });
  const constraints = (elements || []).filter(e => String(e.bus_id) === String(row?.bus_id));
  return { headroom, constraints };
}
/** Verdict for a station (a single API row, or a stationGroups group tested bus by bus: the best single bus stands for
 *  it, Fits over Hold-class over Does not fit, then the higher governing value; cases are never mixed across buses).
 *  `elements` = fact_limiting_element rows for the station buses; without them every held case is envelope only. */
export function stationVerdict(g, tech, exportMW, importMW, elements) {
  const one = r => landVerdict(stationGrid(r, elements), r?.bus_id, tech, exportMW, importMW);
  if (!g?.rows?.length) return one(g);
  const rank = v => (v.status === 'Fits' ? 2 : v.status === 'Does not fit' ? 0 : 1);
  return g.rows.map(one).reduce((a, b) => (rank(b) > rank(a) || (rank(b) === rank(a) && (b.hr ?? -Infinity) > (a.hr ?? -Infinity)) ? b : a));
}
/** Counts over stations carrying `v` (a verdict): only Fits counts as clear. */
export function countFits(groups) {
  const out = { fits: 0, hold: 0, doesNotFit: 0, total: (groups || []).length };
  for (const g of groups || []) { const s = g?.v?.status; if (s === 'Fits') out.fits += 1; else if (s === 'Does not fit') out.doesNotFit += 1; else out.hold += 1; }
  return out;
}

// ---------- P2 C40: the station list says when it is not the whole radius ----------
/** The row cap api_land.py applied before 2026-10-10 (LIMIT 60 before grouping). */
export const STATION_ROW_CAP = 60;
/** Coverage of the station rows: complete within the radius, or truncated (with the effective radius = the farthest row
 *  returned). `stationsTotal` (rows within the radius, from the API) decides when present; otherwise a list at the old
 *  cap is treated as truncated, never as the whole radius. */
export function stationCoverage(P) {
  const rows = P?.stations;
  if (!Array.isArray(rows)) return null;
  const radius = ok(P?.radii?.stations) ? P.radii.stations : 15, total = ok(P?.stationsTotal) ? P.stationsTotal : null;
  const far = rows.reduce((m, r) => (ok(r?.mi) && r.mi > m ? r.mi : m), 0);
  const truncated = total != null ? rows.length < total : rows.length >= STATION_ROW_CAP;
  const label = truncated ? `nearest ${rows.length}${total != null ? ` of ${total}` : ''} station buses only, to ${far.toFixed(1)} mi: the list is truncated, so every count covers ${far.toFixed(1)} mi, not ${radius} mi` : `within ${radius} mi`;
  return { rows: rows.length, total, radius, truncated, effMi: truncated ? far : radius, label, short: truncated ? `to ${far.toFixed(1)} mi (truncated)` : `within ${radius} mi` };
}

/** Depth levels (cumulative, the Studio's Screen / Review / Study). */
export const DEPTHS = ['screen', 'review', 'study'];
export const depthOf = ctx => (DEPTHS.includes(ctx?.depth) ? ctx.depth : 'review');

/** Studio 2.04: headroom per mile of tie, the distance floored at 0.5 mi (a ranking convenience, not a cost). */
export const perMile = (hr, mi, floor = 0.5) => (ok(hr) && ok(mi) ? hr / Math.max(mi, floor) : null);

/** Line-cost sensitivity: rows per $/mile, cells per routing factor; a factor < 1 or a blank is not held. */
export function lineCostGrid(miles, perMiles, factors) {
  return perMiles.map(p => ({ perMile: p, cells: factors.map(f => (ok(miles) && ok(p) && ok(f) && f >= 1 ? miles * f * p : null)) }));
}

export const PERMIT_STATES = ['unknown', 'not needed', 'in progress', 'done'];

// ---------- v4: fuel-specific permit checklist (general knowledge, not a legal determination) ----------
export const PERMIT_DISCLAIMER = 'A starting checklist from general knowledge of US siting practice, not a legal determination: which permits apply depends on the state, the town and the site, and must be confirmed with counsel and the permitting authorities.';
/** Common items. Their order is the pre-v4 index order, so statuses saved by index still read. */
export const PERMITS_COMMON = [
  { id: 'zoning', label: 'Local zoning / special permit', why: 'Town zoning bylaw, special permit or site-plan approval' },
  { id: 'state', label: 'State siting or environmental review', why: 'State siting board or environmental policy act review, where thresholds are met' },
  { id: 'wetlands', label: 'Wetlands', why: 'State wetlands protection and, for fill, a federal Clean Water Act §404 permit' },
  { id: 'stormwater', label: 'Stormwater', why: 'Construction stormwater permit (NPDES construction general permit) above the disturbance threshold' },
  { id: 'historic', label: 'Historic / cultural resources', why: 'State historic preservation office review (NHPA §106 where there is a federal nexus)' },
  { id: 'wildlife', label: 'Wildlife (state and federal)', why: 'State rare-species review and federal Endangered Species Act consultation where listed species occur' },
  { id: 'building', label: 'Building and electrical', why: 'Local building and electrical permits and inspections' },
].map(p => ({ ...p, group: 'common' }));
const DECOM = { id: 'decom', label: 'Decommissioning plan and financial assurance', why: 'Removal and restoration plan, often with a bond, required by many towns and states' };
export const PERMITS_FUEL = {
  solar: [
    { id: 'glare', label: 'Glare / glint analysis', why: 'Reflection onto airports, roads and homes; FAA reviews on-airport solar' },
    DECOM,
  ],
  wind: [
    { id: 'faa', label: 'Aviation: FAA obstruction evaluation and lighting', why: 'Notice under 14 CFR Part 77 (Form 7460-1) for structures over 200 ft or near airports; a determination of no hazard and obstruction lighting' },
    { id: 'radar', label: 'Military radar and airspace review', why: 'DoD Siting Clearinghouse review of radar and training-route impacts' },
    { id: 'noise', label: 'Noise study', why: 'Turbine sound against state and local limits at the nearest receptors' },
    { id: 'setback', label: 'Setbacks and shadow flicker', why: 'Distances to property lines, roads and homes set by the local ordinance; shadow-flicker hours at homes' },
    { id: 'birds', label: 'Birds and bats', why: 'Pre-construction surveys; a USFWS eagle take permit where eagle risk is found' },
    DECOM,
  ],
  storage: [
    { id: 'nfpa855', label: 'Fire code: NFPA 855', why: 'Installation standard for stationary energy storage: hazard mitigation analysis, unit spacing, large-scale fire test data (UL 9540A), as adopted by the state fire code' },
    { id: 'fireplan', label: 'Fire department review and emergency response plan', why: 'Local fire marshal review, site access and a response plan for thermal runaway' },
    { id: 'bsetback', label: 'Setbacks from property lines and occupied buildings', why: 'Set by the fire code and the local ordinance' },
    { id: 'noiseb', label: 'Noise (inverters, HVAC)', why: 'Cooling and power-conversion sound against local limits' },
    { ...DECOM, why: 'Battery removal and end-of-life recycling plan, often with a bond' },
  ],
  datacenter: [
    { id: 'service', label: 'Utility service and large-load interconnection', why: 'Service agreement with the local utility and the large-load study; transmission service arrangements' },
    { id: 'water', label: 'Water supply, withdrawal and discharge', why: 'Cooling water: supply agreement or withdrawal permit, and a wastewater / discharge permit' },
    { id: 'dnoise', label: 'Noise (cooling plant and backup generators)', why: 'Continuous cooling sound and generator testing against local limits' },
    { id: 'air', label: 'Air permit for backup generators', why: 'State air permit for diesel or gas standby generators (Clean Air Act)' },
  ],
};
/** Checklist for a fuel: the common items, then the fuel's own (hybrid = solar + storage, deduplicated by id). */
export function permitList(tech) {
  const own = tech === 'hybrid' ? [...PERMITS_FUEL.solar, ...PERMITS_FUEL.storage] : PERMITS_FUEL[tech] || [];
  const seen = new Set(), out = [];
  for (const p of [...PERMITS_COMMON, ...own.map(x => ({ ...x, group: tech === 'hybrid' ? (PERMITS_FUEL.solar.includes(x) ? 'solar' : 'storage') : tech }))]) {
    if (seen.has(p.id)) { if (p.id === 'decom') out.find(x => x.id === 'decom').why = 'Removal and restoration of the array and the batteries (end-of-life recycling), often with a bond'; continue; }
    seen.add(p.id); out.push({ ...p });
  }
  return out;
}
/** Status per item: keyed by id; a common item also reads its pre-v4 index key. Anything else is unknown. */
export function permitRows(st, tech) {
  return permitList(tech).map(p => {
    const i = PERMITS_COMMON.findIndex(c => c.id === p.id), v = st?.[p.id] ?? (i >= 0 ? st?.[i] : undefined);
    return { ...p, status: PERMIT_STATES.includes(v) ? v : 'unknown' };
  });
}
export function permitCounts(rows) {
  const out = { unknown: 0, 'not needed': 0, 'in progress': 0, done: 0, total: rows.length };
  for (const r of rows) out[r.status] += 1;
  return out;
}
/** Counts by status over n permits; anything not entered is unknown. */
export function permitSummary(st, n) {
  const out = { unknown: 0, 'not needed': 0, 'in progress': 0, done: 0, total: n };
  for (let i = 0; i < n; i++) { const v = st?.[i]; out[PERMIT_STATES.includes(v) ? v : 'unknown'] += 1; }
  return out;
}

/** P2 C44: timing per checklist item. The id keys (po_<id>, pd_<id>) win; otherwise the index key (po<i>, pd<i>) in
 *  permitList(tech) order, for every item (the sample generator writes po0..po17; the first seven are the common items
 *  in their pre-v4 order, so earlier saves still read). A blank is null, never 0. */
export function permitTiming(L, tech) {
  return permitList(tech).map((p, i) => {
    const pick = pre => { const v = L?.[`${pre}_${p.id}`]; if (ok(v)) return v; const w = L?.[`${pre}${i}`]; return ok(w) ? w : null; };
    return { id: p.id, label: p.label, offset: pick('po'), dur: pick('pd') };
  });
}

/** Gantt tasks from a 'YYYY-MM' start and per-permit offset/duration in months. No start → null; a blank offset is
 *  not placed; a blank duration is open-ended (end null). */
export function permitTimeline(start, rows) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(start || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, at = k => Date.UTC(y, mo + k, 1);
  return rows.filter(r => ok(r.offset) && r.offset >= 0).map(r => ({ label: r.label, start: at(r.offset), end: ok(r.dur) && r.dur > 0 ? at(r.offset + r.dur) : null, note: r.note || '' }));
}

/** Percentile position (share of held values at or below this one). */
export const pctRank = r => (r && ok(r.below_or_equal) && ok(r.of) && r.of > 0 ? (100 * r.below_or_equal) / r.of : null);

/** Gen-tie estimate: needs a site, $/mile, terminal works and crossings; otherwise not held (never 0 miles).
 *  'priced' only when the route, terminal AND crossings are all held; a blank is never 0, so otherwise the cost is a
 *  lower bound ('partly priced', shown with ≥). A routing factor < 1 is rejected: the route is not held. */
export function corridor(site, node, { routeFactor, perMile, terminal, crossings }) {
  const d = miles(site, { lat: node?.latitude, lon: node?.longitude });
  if (d == null) return { status: 'not held', reason: 'Place the site (latitude and longitude) to measure distance', distance: null, route: null, cost: null };
  const routeError = ok(routeFactor) && routeFactor < 1 ? `Routing factor ${routeFactor} rejected: below 1 would make the route shorter than the straight line` : '';
  const route = ok(routeFactor) && routeFactor >= 1 ? d * routeFactor : null;
  if (!ok(perMile)) return { status: 'partial', distance: d, route, routeError, cost: null, reason: 'Enter a $/mile line cost for the voltage class' };
  const cost = (route ?? d) * perMile + (ok(terminal) ? terminal : 0) + (ok(crossings) ? crossings : 0);
  const miss = [!ok(route) && 'routed length (straight line used)', !ok(terminal) && 'terminal works', !ok(crossings) && 'crossings and easements'].filter(Boolean).join(', ');
  return { status: miss ? 'partly priced' : 'priced', distance: d, route, routeError, cost, reason: miss ? `${miss[0].toUpperCase()}${miss.slice(1)} not entered: cost is a lower bound` : '' };
}
