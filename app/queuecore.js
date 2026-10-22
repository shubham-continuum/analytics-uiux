// Queue core: nearby requests, the public register, and the process profile's cash, clocks and penalties.
// Rules (merged plan): nearby queue MW is geographic context, never subtracted from headroom by
// default (the weighted subtraction is a labelled what-if); a withdrawal is never assumed to free
// capacity; deposits and security are cash posted, not capital cost.
// S3 (2026-10-06): the process profile is ISO-NE Schedule 22 by default, from rules/isone.js over
// rules/isone-2026.json (R1 + REGISTER §1); the FERC Order 2023 pro forma is a labelled fallback
// (S.ui.qProfile = 'proforma'). No tariff constant is typed in this file.
import * as RX from './rules/isone.js';
import { pendingBadge } from './rules/largeload.js';
const ok = v => typeof v === 'number' && Number.isFinite(v);
/** The large-load filing badge from the rules file (S6); never a typed date. Rules not loaded → said, not invented. */
export function largeLoadBadge() {
  try { return pendingBadge(RX.getRules()).text; } catch { return `large-load filing status not held (${RX.rulesError() || 'rules file not loaded'})`; }
}
/** The active process profile's badge (default ISO-NE). Read lazily: the rules file loads at import. */
export function profileOf(profile) {
  const p = RX.profileInfo(profile);
  return { id: p.id, label: p.label, effective: p.effective, source: `${p.src}${p.effective ? ` · effective ${p.effective}` : ''}`, labelled: p.labelled,
    note: p.labelled ? 'Labelled fallback: the federal pro forma is not the rule ISO-NE runs.' : `Rules: ${p.src}.`, cite: p.cite,
    clusterEraStart: RX.profileInfo('isone').effective, clusterEraSource: RX.profileInfo('isone').src };
}
/** Back-compatible default-profile badge (ISO-NE). */
export const PROFILE = new Proxy({}, { get: (_, k) => profileOf()[k] });

/** The queue engine's inputs from the store: one mapping for the cards, the traces and the grid columns. */
export function queueInputs(S) {
  const ui = S?.ui || {}, tech = S?.tech;
  const ctl = ui.land?.control;
  const fac = ui.qFac === 'waived' ? 'waived' : ui.qFac != null && ui.qFac !== '' ? Number(ui.qFac) : ui.qLongFac ? 180 : 90;
  return { mw: Number(tech === 'datacenter' ? S?.importMW : S?.exportMW), tech, profile: RX.normProfile(ui.qProfile),
    service: ui.qService === 'NRIS' || ui.qService === 'CNRIS' ? ui.qService : null, nrisHeld: !!ui.qNrisHeld, regulatoryLimitation: !!ui.qRegLimit,
    sitePct: typeof ctl === 'number' && Number.isFinite(ctl) ? ctl : null, windowClose: ui.qStart || undefined, restudy: !!ui.qRestudy, facilities: fac };
}

const toRad = d => (d * Math.PI) / 180;
export function miles(a, b) {
  if (![a?.lat, a?.lon, b?.lat, b?.lon].every(ok)) return null;
  const R = 3958.8, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const LATE = /IA executed|FAC|IA in progress/i;
export const NAME_MATCH_MAX_MI = 25;
const GENERIC = new Set('line tap taps jct junction north south east west station substation switching street road upper lower central plant river hill bank unit new old the and kv'.split(' '));
const words = s => String(s || '').toLowerCase().match(/[a-z]+|\d+/g) || [];
/** Every distinctive word of the bus name (≥ 4 chars, not numeric, not generic) appears as a whole word in the POI. */
export function nameMatch(busName, poi) {
  const need = words(busName).filter(w => w.length >= 4 && !/^\d+$/.test(w) && !GENERIC.has(w));
  if (!need.length) return false;
  const have = new Set(words(poi));
  return need.every(w => have.has(w));
}
/** Latest request_date in the register snapshot (ISO date string), or null. */
export const latestRequest = queue => queue.reduce((m, q) => (q.request_date && (!m || q.request_date > m) ? q.request_date : m), null);

/** The bus number appears in the POI text as a whole number (e.g. "(bus number 110926)"). Blank id → false. */
export function busInPoi(busId, poi) {
  const id = String(busId ?? '').trim();
  if (!/^\d+$/.test(id)) return false;
  return new RegExp(`(?<!\\d)${id}(?!\\d)`).test(String(poi || ''));
}

/**
 * Queue era of a request (C31). The register's own cluster flag wins: "TCS" = the transitional cluster study, whatever
 * the request date. Without a flag the date decides (cluster era from the ISO-NE profile's effective date).
 * r = the register row; null = looked up and not found / no flag; undefined = the register was not consulted, so the
 * label says the flag was not checked (nearby() alone cannot see it).
 */
export function eraOf(q, r) {
  if (r && r.cluster) return r.cluster === 'TCS' ? 'transitional cluster (TCS, register flag)' : `cluster ${r.cluster} (register flag)`;
  const start = PROFILE.clusterEraStart;
  const byDate = q?.request_date && start && q.request_date >= start ? 'cluster era' : 'serial era';
  return r === undefined ? `${byDate} by request date (register cluster flag not checked)` : byDate;
}

/**
 * Requests near a bus: within the radius, a POI name match within NAME_MATCH_MAX_MI, or a POI text that names this
 * bus number (any distance; listed, counted only if its coordinate is also in the radius). Geographic context only.
 */
export function nearby(queue, node, radiusMi = 10) {
  const bus = { lat: node.latitude, lon: node.longitude }, busId = node.id ?? node.bus_id;
  return queue.map(q => {
    const d = miles(bus, { lat: q.latitude, lon: q.longitude });
    const inRadius = ok(d) && d <= radiusMi;
    const byName = ok(d) && d <= NAME_MATCH_MAX_MI && nameMatch(node.name, q.poi_name);
    const byBus = busInPoi(busId, q.poi_name);
    // Negative summer MW = storage modelled charging: still modelled.
    const inModel = ok(q.summer_mw_modelled) ? (q.summer_mw_modelled !== 0 ? 'modelled in summer study' : 'not modelled') : 'not held';
    const match = inRadius ? `≤ ${radiusMi} mi` : byBus ? 'POI bus number' : byName ? 'POI name' : null;
    return { q, distance: d, inRadius, byBus, match, inModel, era: eraOf(q), late: LATE.test(q.status || '') };
  }).filter(x => x.match).sort((a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9));
}

// ---------- C30: the MW ahead of this project, by method ----------
/** Register index on QP + request date (QP alone is recycled by ISO-NE). */
export const regIndex = rows => new Map((rows || []).map(r => [`${r.qp}|${r.requested}`, r]));
/** A solved-case position's register status now: {now: 'A' | 'C' | 'W' | 'missing', r}. */
export function nowOf(q, idx) {
  const r = idx?.get(`${q.queue_position}|${q.request_date}`) || null;
  return { now: r ? r.status : 'missing', r };
}

/**
 * MW ahead of this project at the bus (C30). A request is counted only when it is within the radius, NOT already in
 * the solved case (summer MW modelled = 0: anything the case dispatches, including storage modelled charging, is
 * already in the limit the ratio divides by) and NOT withdrawn in the register. Study status not held → reported, never
 * added. opts.nowOf(q) → {now}: without it the withdrawal test cannot run and statusChecked is false (said, not hidden).
 * Counted MW = the requested MW (a not-modelled position has no modelled MW to sign).
 */
export function queueAhead(list, { nowOf: nowFn } = {}) {
  const rows = (list || []).map(x => {
    const q = x.q, s = q.summer_mw_modelled, n = nowFn ? nowFn(q) : null, now = n?.now ?? null;
    const base = { q, distance: x.distance, now, mw: ok(q.max_mw) ? q.max_mw : null, counted: false };
    if (!x.inRadius) return { ...base, why: 'outside the radius (listed by name or bus number, not counted)' };
    if (!ok(s)) return { ...base, why: 'summer study status not held: reported, not added' };
    if (s < 0) return { ...base, why: 'storage modelled charging in the solved case: already in the limit, not ahead' };
    if (s > 0) return { ...base, why: 'already in the solved case (summer): inside the limit, not ahead' };
    if (now === 'W') return { ...base, why: `withdrawn in the register${n?.r?.wd_date ? ` (${n.r.wd_date})` : ''}: not ahead` };
    const why = !nowFn ? 'not in the solved case; withdrawal not checked' : now === 'missing' ? 'not in the solved case; not found in the register' : now === 'C' ? 'not in the solved case; in service now' : 'not in the solved case; active';
    return { ...base, counted: ok(base.mw), why: ok(base.mw) ? why : `${why}; requested MW not held` };
  });
  const sum = f => rows.filter(f).reduce((a, r) => a + (ok(r.mw) ? r.mw : 0), 0);
  const inR = r => list.find(x => x.q === r.q)?.inRadius;
  return { rows, aheadMW: sum(r => r.counted), statusChecked: !!nowFn,
    notHeldMW: sum(r => inR(r) && !ok(r.q.summer_mw_modelled)),
    withdrawnNotCountedMW: sum(r => inR(r) && r.now === 'W' && !r.counted),
    modelledNotCountedMW: sum(r => inR(r) && ok(r.q.summer_mw_modelled) && r.q.summer_mw_modelled !== 0) };
}

/**
 * Solved-case MW within the radius, summed SIGNED (storage modelled charging is negative, never +|MW|).
 * charging = the negative part and its count; requested = the requested MW of the modelled positions.
 */
export function modelledMW(list) {
  const m = (list || []).filter(x => x.inRadius && ok(x.q.summer_mw_modelled) && x.q.summer_mw_modelled !== 0);
  const ch = m.filter(x => x.q.summer_mw_modelled < 0);
  return { signed: m.reduce((a, x) => a + x.q.summer_mw_modelled, 0), charging: ch.reduce((a, x) => a + x.q.summer_mw_modelled, 0), chargingN: ch.length,
    injecting: m.filter(x => x.q.summer_mw_modelled > 0).reduce((a, x) => a + x.q.summer_mw_modelled, 0), n: m.length,
    requested: m.reduce((a, x) => a + (ok(x.q.max_mw) ? x.q.max_mw : 0), 0) };
}

// ---------- C31: register cross-checks ----------
const svcCode = c => { const s = String(c ?? '').trim().toUpperCase(); return !s || s === 'NA' || s === 'N/A' ? null : s; };
/** Service type in the solved case vs the register. Either not stated, or no register row → agree null (not held). */
export function serviceCheck(q, r) {
  const a = svcCode(q?.interconnection_service_requested);
  if (!r) return { agree: null, study: a, register: null, text: 'no register row: service type not cross-checked' };
  const b = svcCode(r.serv);
  if (!a || !b) return { agree: null, study: a, register: b, text: `service not stated (${a ? `study ${a}` : 'study blank'}, ${b ? `register ${b}` : 'register blank'})` };
  return { agree: a === b, study: a, register: b, text: a === b ? `${a} in both` : `study ${a} vs register ${b}` };
}
/**
 * The projected in-service date read against the register status now: in service / withdrawn first (a projection
 * is moot), then undated, past due (projected before asOf while still active) or ahead.
 */
export function projectionState(q, n, asOf) {
  if (n?.now === 'C') return 'in service';
  if (n?.now === 'W') return 'withdrawn';
  if (!q?.projected_is_date) return 'undated';
  return asOf && q.projected_is_date < asOf ? 'past due' : 'ahead';
}
/** The nearest request that is not withdrawn (list sorted by distance); skipped = nearer withdrawn ones (F035). */
export function nearestLive(list, nowFn) {
  const skipped = [];
  for (const x of list || []) {
    if (nowFn && nowFn(x.q)?.now === 'W') { skipped.push(x); continue; }
    return { live: x, skipped };
  }
  return { live: null, skipped };
}
/**
 * A record's coordinate against its own state and county (C31): the nearest bus to the coordinate should sit in the
 * record's state (and county where both are named). No coordinate → null (not held), never "agrees". nodes: either bus
 * shape (snapshot latitude/longitude/state_code, or the market study's lat/lon/state); pass the whole bus list.
 */
export function placementCheck(q, nodes) {
  if (!ok(q?.latitude) || !ok(q?.longitude)) return { stateAgrees: null, countyAgrees: null, nearest: null, nearestState: null, nearestCounty: null, distance: null };
  let best = null, bd = Infinity;
  for (const n of nodes || []) {
    const lat = n.latitude ?? n.lat, lon = n.longitude ?? n.lon;
    if (!ok(lat) || !ok(lon)) continue;
    const d = miles({ lat: q.latitude, lon: q.longitude }, { lat, lon });
    if (d < bd) { bd = d; best = n; }
  }
  if (!best) return { stateAgrees: null, countyAgrees: null, nearest: null, nearestState: null, nearestCounty: null, distance: null };
  const up = s => String(s ?? '').trim().toUpperCase();
  const qc = up(q.county), nc = up(best.county), bs = best.state_code ?? best.state ?? null;
  return { nearest: best, distance: bd, nearestState: bs, nearestCounty: best.county ?? null,
    stateAgrees: q.state && bs ? up(q.state) === up(bs) : null,
    countyAgrees: qc && qc !== 'NA' && nc ? qc === nc : null };
}

/** One maturity rule for every surface (pCod, the register views): entries ≤ asOfYear − 6 are mature. */
export const maturityCutoff = asOfYear => Number(asOfYear) - 6;

/** P(COD) from mature vintages only (entry ≤ maturityCutoff(asOfYear)), completed ÷ (completed + withdrawn); also the last 6 mature vintages. */
export function pCod(trends, asOfYear = 2026) {
  const cutoff = maturityCutoff(asOfYear);
  const rate = rows => {
    const done = rows.reduce((a, t) => a + (t.in_service || 0), 0), wd = rows.reduce((a, t) => a + (t.withdrawn || 0), 0);
    return { p: done + wd ? done / (done + wd) : null, completed: done, withdrawn: wd, vintages: rows.length ? `${rows[0].entry_year}–${rows.at(-1).entry_year}` : '—' };
  };
  const mature = trends.filter(t => t.entry_year <= cutoff).sort((a, b) => a.entry_year - b.entry_year);
  return { ...rate(mature), cutoff, recent: rate(mature.slice(-6)) };
}

/** Study deposit at a size under the profile (ISO-NE: flat by schedule; pro forma: tiered). Null when not modelled. */
export function studyDeposit(mw, profile) {
  const e = RX.entryCost({ mw, profile });
  return e.status === 'ok' ? e.parts[1].value : null;
}

/**
 * Cash and commitments by phase (rules/isone.js commitments). Readiness balances are cumulative "top-up to" totals
 * that never fall below what is posted; forfeits are the greater of the study deposit or the stage multiple.
 * nuUSD = allocated network-upgrade cost ($), or null (later phases not held). opts: {profile, nrisHeld,
 * depositInLieu ($, from queueCash)}. errors[] carries the reason when the size is not modelled or not set.
 */
export function commitments(mw, nuUSD, { profile, nrisHeld = false, depositInLieu = 0 } = {}) {
  return RX.commitments({ mw, nu: nuUSD, nrisHeld, depositInLieu, profile });
}

/**
 * The schedule as a deadline chain from the request-window close (rules/isone.js schedule), in the shape the cards
 * draw: rows {step, used (days or 'n BD'), from (the date the clock counts from), date (deadline), note, cite}, in date
 * order; deadline = the Cluster Study Report deadline; end = the end of the chosen path (ISO-NE: the draft LGIA
 * tender). Every date is a tariff deadline, the LATEST the step may happen: deadlineDays is the span of those
 * deadlines, not a minimum duration. null when the date is not valid.
 */
export function scheduleBand(windowClose, { restudy = false, longFacilities = false, facilities, profile } = {}) {
  const s = RX.schedule({ windowClose, restudy, facilities: facilities ?? (longFacilities ? 180 : 90), profile });
  if (s.status !== 'ok') return null;
  let prev = null;
  const rows = s.rows.map(r => { const row = { key: r.key, step: r.step, used: r.days ?? null, from: r.from ?? prev ?? r.date, date: r.date, note: r.note || (r.kind === 'date' ? '' : 'deadline'), kind: r.kind, cite: r.cite }; if (r.kind === 'deadline') prev = r.date; return row; });
  const close = s.rows.find(r => r.key === 'window_close').t, end = s.end || s.rows.filter(r => r.kind === 'deadline').at(-1);
  const deadlineDays = Math.round((end.t - close) / 864e5);
  const band = { rows, profile: s.profile, deadline: s.clusterDeadline.value, deadlineCite: s.clusterDeadline.cite, end: end.date, endStep: end.step,
    deadlineDays, latest: end.date, note: `${s.note} The chain gives tariff deadlines (latest dates), not minimum durations.` };
  // Deprecated alias (C33): kept non-enumerable until the old caller (tests/queue.test.mjs) reads deadlineDays.
  Object.defineProperty(band, 'minDays', { value: deadlineDays, enumerable: false });
  return band;
}

// ---------- The public register (1,751 records; data/queue-register.json) ----------
// Status letters as published: A active, C commercial / in service, W withdrawn. QP is NOT a key (ISO-NE
// recycles positions), so the study set is joined on QP + request date.
export const REG_STATUS = { A: 'Active', C: 'In service', W: 'Withdrawn' };
const YEAR_MS = 365.25 * 864e5;

/** {columns, rows:[[...]]} → row objects. */
export function registerRows(reg) {
  const cols = reg?.columns || [];
  return (reg?.rows || []).map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
}

/** Requested MW = the published net MW, else the summer MW where net is blank or zero. Neither → not held. */
export function requestedMW(r) {
  if (ok(r.net_mw) && r.net_mw > 0) return { mw: r.net_mw, basis: 'net' };
  if (ok(r.summer_mw) && r.summer_mw > 0) return { mw: r.summer_mw, basis: 'summer' };
  return { mw: null, basis: 'not held' };
}

const FUEL_GROUPS = { SUN: 'Solar', 'SUN BAT': 'Solar + storage', BAT: 'Storage', WND: 'Wind', 'WND BAT': 'Wind + storage', WAT: 'Hydro', 'WAT BAT': 'Hydro + storage', NUC: 'Nuclear' };
/** EIA fuel code(s) → a display group. Hybrids stay apart; anything with gas or oil is Gas / oil; blank is Not stated. */
export function fuelGroup(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (!c || c === 'N/A') return 'Not stated';
  if (FUEL_GROUPS[c]) return FUEL_GROUPS[c];
  if (/\b(NG|DFO|KER|JF|BIT|RFO)\b/.test(c)) return 'Gas / oil';
  return 'Other';
}

const tally = rows => {
  const t = { n: rows.length, W: 0, C: 0, A: 0, other: 0, mw: 0, mwHeld: 0 };
  for (const r of rows) {
    if (r.status === 'W' || r.status === 'C' || r.status === 'A') t[r.status]++; else t.other++;
    const m = requestedMW(r).mw; if (ok(m)) { t.mw += m; t.mwHeld++; }
  }
  t.completion = t.C + t.W ? t.C / (t.C + t.W) : null;
  t.withdrawnShare = t.n ? t.W / t.n : null;
  return t;
};
/** Outcome counts per group: completion = in service ÷ resolved (in service + withdrawn); withdrawn share = W ÷ all. */
export function outcomesBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return [...m.entries()].map(([key, rs]) => ({ key, ...tally(rs) }));
}
/** Register by entry year (year of the request date). */
export function vintages(rows) {
  return outcomesBy(rows.filter(r => r.requested), r => Number(String(r.requested).slice(0, 4)))
    .map(({ key, ...t }) => ({ year: key, ...t })).sort((a, b) => a.year - b.year);
}

const yearsBetween = (a, b) => { const t0 = Date.parse(a), t1 = Date.parse(b); return ok(t0) && ok(t1) ? (t1 - t0) / YEAR_MS : null; };
/** Observed durations: request → op_date for in-service records, request → wd_date for withdrawn ones (years). */
export function durationsObserved(rows) {
  const service = [], withdraw = [], excluded = { serviceBeforeRequest: 0, serviceUndated: 0, withdrawUndated: 0, withdrawBeforeRequest: 0 };
  for (const r of rows) {
    if (r.status === 'C') {
      const y = yearsBetween(r.requested, r.op_date);
      if (!ok(y)) excluded.serviceUndated++; else if (y < 0) excluded.serviceBeforeRequest++; else service.push({ years: y, r });
    } else if (r.status === 'W') {
      const y = yearsBetween(r.requested, r.wd_date);
      if (!ok(y)) excluded.withdrawUndated++; else if (y < 0) excluded.withdrawBeforeRequest++; else withdraw.push({ years: y, r });
    }
  }
  return { service, withdraw, excluded };
}
/** Quantile of an ascending-sorted array, linear interpolation between order statistics (R type 7). */
export function quantile(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}
export function summary(values) {
  const s = values.filter(ok).sort((a, b) => a - b);
  if (!s.length) return { n: 0, p10: null, p25: null, p50: null, p75: null, p90: null, min: null, max: null, mean: null };
  return { n: s.length, p10: quantile(s, 0.1), p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), p90: quantile(s, 0.9), min: s[0], max: s.at(-1), mean: s.reduce((a, b) => a + b, 0) / s.length };
}
/** Study-set projections: request_date → projected_is_date (years). These are applicants' projections, not actuals. */
export function projectedDurations(queue) {
  const values = []; let undated = 0;
  for (const q of queue) { const y = yearsBetween(q.request_date, q.projected_is_date); if (ok(y)) values.push({ years: y, q }); else undated++; }
  return { values, undated };
}
/** Register records placed within R miles of a bus by their matched-substation coordinate. */
export function registerNear(rows, node, R) {
  const bus = { lat: node?.latitude, lon: node?.longitude }; let unplaced = 0; const out = [];
  for (const r of rows) {
    if (!ok(r.lat) || !ok(r.lon)) { unplaced++; continue; }
    const d = miles(bus, { lat: r.lat, lon: r.lon });
    if (ok(d) && d <= R) out.push({ ...r, distance: d });
  }
  return { rows: out.sort((a, b) => a.distance - b.distance), unplaced };
}
/** Where the solved case's modelled positions stand in the register now (join on QP + request date). */
export function studyStatusNow(study, rows) {
  const idx = new Map(rows.map(r => [`${r.qp}|${r.requested}`, r]));
  const counts = { W: 0, C: 0, A: 0, missing: 0 }, out = [];
  for (const q of study) {
    const r = idx.get(`${q.queue_position}|${q.request_date}`) || null;
    const now = r ? r.status : 'missing'; counts[now] = (counts[now] || 0) + 1;
    out.push({ q, r, now });
  }
  return { rows: out, counts };
}
/** Register records whose requested MW is within half to twice the project size. */
export function sizeBand(rows, mw) {
  if (!ok(mw) || mw <= 0) return null;
  const lo = mw / 2, hi = mw * 2;
  const inside = rows.filter(r => { const m = requestedMW(r).mw; return ok(m) && m >= lo && m <= hi; });
  return { lo, hi, ...tally(inside) };
}
/**
 * Entry cost at each size under the profile (rules/isone.js depositCurve). cashAtRequest = the full entry
 * (fee + study deposit + readiness); cash = the part that must be cash. ISO-NE: Schedule 23 at ≤ 20 MW, flat
 * Schedule 22 above; pro forma: ≤ 20 MW not modelled.
 */
export function depositCurve(sizes, profile) {
  return RX.depositCurve(sizes, profile).map(p => ({ mw: p.mw, notModelled: p.status !== 'ok', schedule: p.schedule,
    studyDeposit: p.studyDeposit, readiness: p.readiness, cash: p.cash, cashAtRequest: p.total }));
}
// ---------- Gap brief v4: fuel direction, service type, exemptions, material modification ----------

/** Which request directions a fuel is screened on: a load imports only; storage and hybrid add the charge side. */
export function ratioDirs(tech) {
  if (tech === 'datacenter') return ['import'];
  if (tech === 'storage' || tech === 'hybrid') return ['export', 'import'];
  return ['export'];
}

/**
 * Request ÷ binding limit per direction (C30). bindings = { export, import } from gridrules.binding() on the fuel's
 * OWN case table: the element-study limit of the solved case. Export adds aheadMW = queueAhead().aheadMW, the MW NOT
 * already in the solved case and not withdrawn (MW the case dispatches, including storage modelled charging, is
 * already inside the limit, so adding it again double-counts). Import (a load, or a storage charge) never adds queued
 * MW: the queued requests are generators and do not share that direction. projectOnly = request ÷ limit, shown beside.
 * A limit that is not held, or a direction not requested, gives value null (not held), never 0.
 * nearbyMW is accepted as the old name of aheadMW (callers must pass the queueAhead figure, not the raw nearby sum).
 */
export function requestRatios(tech, { exportMW, importMW, aheadMW, nearbyMW }, bindings) {
  const ahead = ok(aheadMW) ? aheadMW : ok(nearbyMW) ? nearbyMW : null;
  return ratioDirs(tech).map(dir => {
    const b = bindings?.[dir] || { value: null, status: 'Not studied' };
    const mw = Number(dir === 'export' ? exportMW : importMW);
    const nearby = dir === 'export' && tech !== 'datacenter' && ahead != null ? ahead : null;
    const limit = ok(b.value) && b.value > 0 ? b.value : null;
    const requested = ok(mw) && mw > 0;
    const value = requested && limit != null ? ((nearby ?? 0) + mw) / limit : null;
    const projectOnly = requested && limit != null ? mw / limit : null;
    const label = tech === 'datacenter' ? 'Load ratio (request ÷ element-study import limit)'
      : dir === 'import' ? 'Charge ratio (charge request ÷ element-study import limit)' : 'Export ratio (MW ahead not in the solved case + this project ÷ export limit)';
    return { dir, label, mw: requested ? mw : null, nearby, limit, value, projectOnly, status: requested ? b.status : 'Not requested', row: b.row || null };
  });
}

/** The binding ratio: the largest held one across directions (storage: the charge side can bind, not the export one). */
export function bindingRatio(ratios) {
  const held = (ratios || []).filter(r => ok(r.value));
  return held.length ? held.reduce((a, r) => (r.value > a.value ? r : a)) : null;
}

/** Interconnection service as requested (register "serv", dim_queue interconnection_service_requested). */
export const SERVICE_GROUPS = ['CNR · capacity', 'NR · energy only', 'Other code (as published)', 'Not stated'];
export function serviceGroup(code) {
  const c = String(code ?? '').trim().toUpperCase();
  if (c === 'CNR') return SERVICE_GROUPS[0];
  if (c === 'NR') return SERVICE_GROUPS[1];
  if (!c || c === 'NA' || c === 'N/A') return SERVICE_GROUPS[3];
  return SERVICE_GROUPS[2];
}

/**
 * Withdrawal-penalty exemptions (rules/isone.js; Sched 22 §3.7.1, §3.7.1.1, adopted from the pro forma unchanged):
 * exempt when the network-upgrade cost on a Cluster Restudy Report is more than 25% above the preceding report
 * (reportType 'restudy'; the first Cluster Study Report gives no exemption), or the Facilities Study Report more than
 * 100% above the cluster study / restudy. A missing or zero base cost → null (not held), never "not exempt".
 */
export function penaltyExemptions(args = {}) { return RX.penaltyExemptions(args); }

/** The generator interconnection deposits, readiness and penalties apply to generating facilities only. */
export function cashApplies(tech) {
  if (tech === 'datacenter') { const badge = largeLoadBadge(); return { applies: false, badge, why: `A data centre is a load. The Schedule 22 / 23 deposits, readiness and withdrawal penalties are for generating facilities; the ISO-NE large-load procedure is ${badge}.` }; }
  return { applies: true, why: '', badge: null };
}

/**
 * The COD date finance reads (S5 open item, W-C). The Queue holds a target COD *year* (S.ui.qCod, the user's input):
 * it is taken as 31 December of that year (exact for the 45Y/48E date tests). S3's deadline chain (rules/isone.js
 * schedule) gives no COD, only the latest tariff dates, so it is reported as context (pathEnd) and a COD that falls
 * before the end of that chain is flagged (conflict). No year → value null with the reason, never an invented date.
 */
export function codDate(S) {
  const q = queueInputs(S);
  const sch = RX.schedule({ windowClose: q.windowClose, restudy: q.restudy, facilities: q.facilities, profile: q.profile });
  const pathEnd = sch.status === 'ok' && sch.end ? { date: sch.end.date, step: sch.end.step, cite: sch.end.cite } : null;
  // P2 C33: priced network upgrades sent from Grid for this bus and fuel: their build lead time is not held, so the
  // tariff chain alone can understate the COD. Said beside the date, never added to it.
  const h = S?.handoffs?.cost, mine = h && String(h.busId) === String(S?.nodeId) && (!h.tech || h.tech === S?.tech);
  const upgradeCaution = mine && ok(h.knownNetwork) && h.knownNetwork > 0
    ? `$${h.knownNetwork.toFixed(1)}M of priced network upgrades are allocated to this request (Grid › Upgrade cost allocator${h.status ? `, ${h.status}` : ''}): their construction lead time is not held, so the COD can fall after the end of the tariff chain.`
    : null;
  const y = Number(S?.ui?.qCod);
  if (!Number.isInteger(y) || y < 1900 || y > 2200) return { value: null, basis: null, reason: 'no target COD year set (Queue › Schedule & milestones › Timing inputs)', pathEnd, conflict: null, why: null, upgradeCaution };
  const value = `${y}-12-31`;
  const chain = `${sch.profile === 'isone' ? 'ISO-NE Sched 22' : 'pro forma'} chain`;
  // Tariff conflict: the COD falls before the end of the chain. Upgrade-dependent conflict: priced network upgrades are
  // built after the LGIA (lead time not held), so a COD in the same year as the draft LGIA tender is flagged too.
  const tariff = pathEnd ? value < pathEnd.date : null;
  const upgrade = !tariff && pathEnd && upgradeCaution ? y <= Number(pathEnd.date.slice(0, 4)) : false;
  const conflict = tariff == null ? null : tariff || upgrade;
  return { value, basis: `Queue target COD year ${y}, taken as 31 Dec`, reason: null, pathEnd, conflict, upgradeCaution,
    why: tariff ? `target COD ${value} is before the ${pathEnd.step.toLowerCase()} deadline ${pathEnd.date} (${chain}): the COD year cannot be met on the tariff clocks`
      : upgrade ? `target COD year ${y} is the year of the ${pathEnd.step.toLowerCase()} deadline ${pathEnd.date} (${chain}), and priced network upgrades must be built after the LGIA (lead time not held): upgrade-dependent, flagged` : null };
}

/**
 * Material-modification checklist. ISO-NE's own text (Schedule 22 §4.4) is not held; each row cites the federal
 * rule the vault documents, or says "Not held". Statuses are evidence labels, never a pass.
 */
const MM = [
  { change: 'Technological change: equipment swap (inverter, module, turbine or battery model)', rule: 'Technological change procedure: a "permissible technological advancement" keeps queue position', standard: 'Electrical performance equal or better and no material reliability impact', source: 'Vault: ferc-order-845-summary.md', status: 'Vault rule', techs: ['solar', 'wind', 'storage', 'hybrid'] },
  { change: 'Add a facility at the same point of interconnection (e.g. storage beside solar)', rule: 'Evaluated before it is deemed a material modification when the requested service level is unchanged; queue position preserved', standard: 'Requested interconnection service unchanged', source: 'Vault: ferc-order-2023-summary.md §3 (co-located and hybrid)', status: 'Vault rule', techs: ['solar', 'wind', 'storage', 'hybrid'] },
  { change: 'Request less service than the facility can produce', rule: 'Studied at the requested level; injection limited by customer-funded control technology (LGIA art. 9.7.4.1)', standard: 'Provider may still study at full capacity with written justification (e.g. short circuit)', source: 'Vault: ferc-order-845-summary.md', status: 'Vault rule', techs: ['solar', 'wind', 'storage', 'hybrid'] },
  { change: 'Change the storage operating assumptions (charging behaviour)', rule: 'Studies must honour the proposed operating assumptions', standard: 'Whether a change is material is not documented', source: 'Vault: ferc-order-2023-summary.md §3', status: 'Vault rule (partial)', techs: ['storage', 'hybrid'] },
  { change: 'Use surplus interconnection service at an existing POI', rule: 'Expedited, outside the queue, no new network upgrades; ERIS-original surplus stays ERIS', standard: 'Total service at the POI unchanged; original customer holds an executed (or filed) LGIA', source: 'Vault: ferc-order-845-summary.md; ferc-order-2023-summary.md §3', status: 'Vault rule', techs: ['solar', 'wind', 'storage', 'hybrid'] },
  { change: 'Capacity (CNR) request downgraded to energy only (NR)', rule: 'CNR requests can auto-downgrade to NR', standard: '191 FERC ¶ 61,018 ¶175 (Apr 2025)', source: 'Workspace research note (not in the vault)', status: 'Research note', techs: ['solar', 'wind', 'storage', 'hybrid'] },
  { change: 'Increase the requested MW', rule: 'Not documented in the vault', standard: 'ISO-NE §4.4 text not held: ask ISO-NE before assuming position is kept', source: '—', status: 'Not held', techs: ['solar', 'wind', 'storage', 'hybrid'] },
  { change: 'Move the point of interconnection', rule: 'Not documented in the vault', standard: 'ISO-NE §4.4 text not held', source: '—', status: 'Not held', techs: ['solar', 'wind', 'storage', 'hybrid'] },
  { change: 'Extend the commercial operation date', rule: 'Not documented in the vault', standard: 'ISO-NE §4.4 text not held', source: '—', status: 'Not held', techs: ['solar', 'wind', 'storage', 'hybrid'] },
];
export function materialModChecklist(tech) {
  const isoNe = 'ISO-NE Schedule 22 §4.4 (material modification) text is not held in the vault; rows cite the federal rules the vault documents.';
  if (tech === 'datacenter') return { applies: false, isoNe, why: 'Material modification is a generator-interconnection concept; a load is not in the generator queue.', rows: [] };
  return { applies: true, isoNe, why: '', rows: MM.filter(r => r.techs.includes(tech)).map(({ techs, ...r }) => r) };
}

/** Sum a value by two keys; keys in first-seen order (or opts order); empty cells are null, not 0. */
export function crossTab(items, rowKey, colKey, val, { rows: rOrder, cols: cOrder } = {}) {
  const rows = rOrder || [...new Set(items.map(rowKey))], cols = cOrder || [...new Set(items.map(colKey))];
  const values = rows.map(() => cols.map(() => null));
  for (const it of items) {
    const i = rows.indexOf(rowKey(it)), j = cols.indexOf(colKey(it)), v = val(it);
    if (i < 0 || j < 0 || !ok(v)) continue;
    values[i][j] = (values[i][j] ?? 0) + v;
  }
  return { rows, cols, values };
}
