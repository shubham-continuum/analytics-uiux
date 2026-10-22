// GridSense One Studio: ISO-NE markets and revenue rules (S4) over rules/isone-2026.json (capacity_pfp + recs domains).
// Provenance: Claude Opus 5.5 (S4 agent) · one-studio/design (T3, slice S4) · 2026-10-06 · sign-off pending · v1
//
// Pure functions, no DOM and no fetch (except loadRevenueRules). Every constant is read from the rules object R (the merged
// generated file); every result carries the regime, the source (`src`) and a status. Null = not held + a reason, never 0.
// Methods: R2 (v8-isone-complete/research/R2-markets-revenue-isone.md) §A2 capacity, §B4 PfP, §C2 ancillary, §D2 energy,
// §E2 RECs / Clean Peak; REGISTER.md §2-3. Decision D3: capacity after FCA 18 is a user-set path, prefilled from cleared
// history, labelled, flat (never extrapolated).
import { clearSky } from '../solar.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const MONTHS = 12;            // months per commitment period (unit conversion, not a market parameter)
const KW = 1000;              // kW per MW
const pct = v => `${+(v * 100).toFixed(1)}%`;
const money2 = v => `$${Number(v).toFixed(2)}`;

/** Every rules path this module reads (Inspector Evidence and citations()). */
export const CITED_PATHS = [
  'capacity.fca_results', 'capacity.auction_after_fca18', 'capacity.ccp_calendar', 'capacity.price_path_default', 'capacity.qc_solar_default',
  'capacity.qc_storage_default', 'capacity.qc_rule_intermittent', 'capacity.qc_seasons', 'capacity.mric_season_months', 'capacity.rmri_preliminary',
  'pfp.ppr', 'pfp.balancing_ratio_cap', 'pfp.csc_interval_min', 'pfp.stop_loss', 'pfp.events',
  'ancillary.da_as', 'ancillary.regulation_2025', 'ancillary.regulation_base_case',
  'energy_settlement.intervals', 'energy_settlement.da_premium_2025', 'energy_settlement.hub_hedge',
  'recs_ma.class1_acp', 'recs_ma.class1_price_default', 'recs_ma.class1_scope', 'recs_ma.clean_peak_acp', 'recs_ma.clean_peak_price_default',
  'recs_ma.clean_peak_multipliers', 'recs_ma.clean_peak_seasons', 'recs_ma.clean_peak_scope',
];
const at = (R, path) => String(path).split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), R);

/** [{path, src, status, effective}] for every rule the revenue engine reads. */
export function citations(R) {
  return CITED_PATHS.map(path => { const e = at(R, path) || {}; return { path, src: e.src || null, status: e.status || null, effective: e.effective || null }; });
}

let RULES_P = null;
/** Browser loader for the generated rules file (cached). Node tests read the file directly. */
export function loadRevenueRules(url = './rules/isone-2026.json') {
  RULES_P ??= fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(`rules HTTP ${r.status}`))));
  return RULES_P;
}

// ---------------------------------------------------------------- commitment periods
const cal = R => R.capacity.ccp_calendar;
const ccpStartMonth = R => Number(cal(R).ccp_start_mmdd.slice(0, 2));
const ccpLabel = y => `${y}/${String(y + 1).slice(2)}`;
const ccpYear = ccp => Number(String(ccp).slice(0, 4));
/** CCP containing a date (CCP = 1 Jun .. 31 May, MR1). */
export function ccpOf(date, R = null) {
  const y = Number(String(date).slice(0, 4)), m = Number(String(date).slice(5, 7)), sm = R ? ccpStartMonth(R) : 6;
  return ccpLabel(m >= sm ? y : y - 1);
}
const monthIdx = (y, m) => y * MONTHS + (m - 1);
function normCod(cod) {
  if (Number.isInteger(cod)) return { date: `${cod}-01-01`, assumed: true };
  if (typeof cod === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cod)) return { date: cod, assumed: false };
  return null;
}
/** First obligation month: the COD month when COD is the 1st, else the next month. */
function firstMonth(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  return d === 1 ? monthIdx(y, m) : monthIdx(y, m) + 1;
}
/** Calendar months (1..12) the unit holds an obligation in CCP starting year sy, from obligation month index f. */
function monthsOnList(R, sy, f) {
  const s = monthIdx(sy, ccpStartMonth(R)), out = [];
  for (let i = Math.max(s, f); i <= s + MONTHS - 1; i++) out.push((i % MONTHS) + 1);
  return out;
}

// ---------------------------------------------------------------- accreditation (C-C1)
/** Accreditation of `tech` under kind 'qc' (current rule, CAR-PD) or 'mric' (CAR-SA preliminary rMRI). Fractions of MCap. */
export function accreditation(R, { tech, kind = 'qc', durationH = 4, qc = null }) {
  const C = R.capacity, seasons = C.qc_seasons;
  if (kind === 'mric') {
    const key = tech === 'storage' ? (C.rmri_preliminary[`battery_${durationH}h`] ? `battery_${durationH}h` : 'storage_fleet') : tech;
    const r = C.rmri_preliminary[key];
    if (!r) return { kind, summer: null, winter: null, reason: `No CAR-SA preliminary rMRI is held for ${tech}.`, src: C.rmri_preliminary.src, status: C.rmri_preliminary.status };
    return { kind, key, summer: r.summer, winter: r.winter, src: `${C.rmri_preliminary.src}; season months: ${C.mric_season_months.src}`, status: C.rmri_preliminary.status,
      label: `CAR-SA preliminary rMRI (Mar 2026, ${key.replace('_', ' ')}): summer ${pct(r.summer)}, winter ${pct(r.winter)} of MCap, each season priced per kW of MRIC (season months: ${C.mric_season_months.status})` };
  }
  const intermittent = tech === 'solar' || tech === 'wind';
  if (qc && ok(qc.summer) && ok(qc.winter)) {
    const frac = intermittent ? qc.summer : Math.min(qc.summer, qc.winter);
    return { kind, summer: qc.summer, winter: qc.winter, frac, src: `site QC (user input); rule: ${seasons.src}`, status: 'assumption',
      label: `Site QC (user): summer ${pct(qc.summer)}, winter ${pct(qc.winter)}; CSO uses ${intermittent ? 'summer QC (intermittent)' : 'the lesser of summer and winter QC'}` };
  }
  if (tech === 'solar') {
    const q = C.qc_solar_default;
    return { kind, summer: q.summer, winter: q.winter, frac: q.summer, src: `${q.src}; ${seasons.src}`, status: q.status,
      label: `Current rule QC (CAR-PD): summer ${pct(q.summer)} of MCap (fleet); winter ${pct(q.winter)} does not enter an intermittent CSO (qualified capacity = summer QC)` };
  }
  if (tech === 'storage') {
    const q = C.qc_storage_default, f = q.qc_mw / q.mcap_mw;
    return { kind, summer: f, winter: f, frac: f, src: `${q.src}; ${seasons.src}`, status: q.status,
      label: `Current rule QC (CAR-PD): ${pct(f)} of MCap in summer and winter (fleet ${q.qc_mw.toLocaleString('en-US')} of ${q.mcap_mw.toLocaleString('en-US')} MW); CSO = lesser of summer and winter QC` };
  }
  const reason = tech === 'wind' ? 'No cited wind QC default: R2 gives the fleet wind QC in MW without its MCap. Enter a site QC (summer and winter).'
    : tech === 'hybrid' ? 'Whether a co-located PV + storage pair qualifies as one resource or as separate resources is unverifiable (R2 open question R10). Enter a site QC.'
      : `No capacity accreditation is modelled for ${tech}.`;
  return { kind, summer: null, winter: null, frac: null, reason, src: seasons.src, status: 'unverifiable', label: 'Accreditation not held' };
}

// ---------------------------------------------------------------- price path (C-W1, D3)
const BAND_WHY = {
  low: 'the last FCA clear (FCA 18, 2027/28 only)',
  mid: 'the 2025-26 reconfiguration-auction clears (AMR 2025 §7.2.2)',
  high: 'the peak monthly reconfiguration price, Sep 2025 (AMR 2025 §7.2.1)',
};
function prefillOf(R, band = 'low') {
  const pd = R.capacity.price_path_default, b = ['low', 'mid', 'high'].includes(band) ? band : 'low', price = pd[b];
  return { band: b, price, src: pd.src, status: pd.status,
    label: `User path, prefilled from cleared history: ${money2(price)}/kW-mo, ${BAND_WHY[b]}, held flat (escalation ${pd.escalation}). Not a forecast: set your own value per commitment period.` };
}

/**
 * Capacity revenue path by commitment period (R2 §A2). opts:
 *   tech 'solar'|'wind'|'storage'|'hybrid' · mw (MCap proxy) · cod 'YYYY-MM-DD' or a year (→ 1 Jan, flagged) · years (CCPs shown)
 *   regime 'qc' (current rule, CAR-PD) | 'mric' (CAR-SA, pending) · band 'low'|'mid'|'high' (prefill) · userPath {ccp: $/kW-mo}
 *   mricPrice number | {summer, winter} ($/kW-mo of MRIC; no default) · fca18Cso (on the FCA 18 results list) · durationH · qc {summer, winter}
 * Row: {ccp, start, end, regimeKey 'fca'|'monthly'|'aca_pd'|'aca_sa', regime, regimeSrc, monthsOn, accreditation, mwAccredited, price,
 *       priceTag, priceSrc, revenue|null, status 'ok'|'missing', conditional, reason, flags}
 */
export function capacityPath(R, opts = {}) {
  const { tech = 'solar', mw, years = 10, regime = 'qc', band = 'low', userPath = {}, mricPrice = null, fca18Cso = false, durationH = 4, qc = null } = opts;
  const C = R.capacity, K = cal(R), cod = normCod(opts.cod);
  const prefill = prefillOf(R, band);
  const history = C.fca_results.rows.map(r => ({ ccp: r.ccp, auction: r.auction, price: ok(r.all_zones) ? r.all_zones : null,
    zones: Object.fromEntries(Object.entries(r).filter(([k, v]) => ok(v) && k !== 'all_zones')), priceTag: `${r.auction}, ${r.ccp} only`, src: C.fca_results.src, status: C.fca_results.status }));
  if (!cod || !ok(mw) || mw <= 0) {
    return { rows: [], history, prefill, regime, codDate: null, codAssumed: false, totals: { firm: null, conditional: null, notHeld: [] }, firstFull: null,
      reason: !cod ? 'COD not held: enter the first operating date (or year) to place the commitment periods.' : 'Size (MW) not held.' };
  }
  const f = firstMonth(cod.date), sy0 = ccpYear(ccpOf(cod.date, R));
  const lastFca = ccpYear(K.last_fca_ccp), firstAca = ccpYear(K.first_aca_ccp), [dm, dd] = K.aca_demo_deadline_mmdd.split('-');
  const rows = [];
  for (let sy = sy0; sy < sy0 + years; sy++) {
    const ccp = ccpLabel(sy), months = monthsOnList(R, sy, f), flags = [];
    let regimeKey, regimeTxt, regimeSrc, reason = '', conditional = false, fixed = null;
    const kind = sy >= firstAca ? regime : 'qc';
    if (sy <= lastFca) {
      const fr = history.find(h => h.ccp === ccp);
      if (ccp === K.last_fca_ccp && fca18Cso && fr && ok(fr.price)) {
        regimeKey = 'fca'; regimeTxt = `${fr.auction} (forward capacity auction) · CSO holder`; regimeSrc = C.fca_results.src; fixed = fr;
      } else {
        regimeKey = 'monthly'; conditional = true; regimeSrc = `${K.src}; AMR 2025 §7.2.1`;
        regimeTxt = 'Monthly qualification route (MRA / bilateral)';
        reason = `${fr ? `No ${fr.auction} CSO is held (mark the project as on the ${fr.auction} results list if it is). ` : ''}Sold through monthly reconfiguration auctions or bilaterally after monthly qualification; these markets are thin.`;
      }
    } else {
      const deadline = `${sy}-${dm}-${dd}`;
      regimeSrc = `${C.auction_after_fca18.src}; ${C.auction_after_fca18.accepted}`;
      if (cod.date > deadline) {
        regimeKey = 'monthly'; conditional = true; regimeTxt = 'Monthly qualification route (missed the ACA)';
        reason = `Commercial operation ${cod.date} is after the ACA demonstration deadline (${deadline}, illustrative ${K.aca_demo_deadline_mmdd}) for CCP ${ccp}: the whole ACA position for that period is lost, not a pro-rata share. Monthly reconfiguration auctions or bilateral sales only.`;
      } else if (kind === 'mric') {
        regimeKey = 'aca_sa'; regimeTxt = 'Seasonal CAR (CAR-SA prompt seasonal ACA, MRIC) · pending'; regimeSrc += `; ${C.auction_after_fca18.seasonal_mri}`;
      } else {
        regimeKey = 'aca_pd'; regimeTxt = 'Prompt Annual Capacity Auction (ACA; CAR-PD, sealed-bid, current QC)';
      }
      if (ccp === K.cone_reset_ccp) flags.push('cone_reset');
    }
    const acc = accreditation(R, { tech, kind, durationH, qc });
    const row = { ccp, start: `${sy}-${K.ccp_start_mmdd}`, end: new Date(Date.UTC(sy + 1, ccpStartMonth(R) - 1, 0)).toISOString().slice(0, 10), regimeKey, regime: regimeTxt, regimeSrc, monthsOn: months.length, accreditation: acc,
      mwAccredited: null, price: null, priceTag: null, priceSrc: null, revenue: null, status: 'missing', conditional, reason, flags };
    if (flags.includes('cone_reset')) row.reason = `${row.reason ? `${row.reason} ` : ''}First ACA after the CONE / Net CONE recalculation (CAR-PD §VI.C.2): the price cap resets.`.trim();
    // price
    if (fixed) { row.price = fixed.price; row.priceTag = fixed.priceTag; row.priceSrc = `${fixed.auction} clearing price (${fixed.src})`; }
    else if (kind === 'mric') {
      const mp = ok(mricPrice) ? { summer: mricPrice, winter: mricPrice } : mricPrice && ok(mricPrice.summer) && ok(mricPrice.winter) ? mricPrice : null;
      row.price = mp; row.priceTag = mp ? 'user-set MRIC price' : null;
      row.priceSrc = mp ? 'user path: user-set CAR-SA price per kW of MRIC' : 'user path: CAR-SA price not set';
    } else if (ok(userPath?.[ccp])) { row.price = userPath[ccp]; row.priceTag = 'user path · user-set'; row.priceSrc = `user path: user-set value for ${ccp}`; }
    else { row.price = prefill.price; row.priceTag = 'user path · flat'; row.priceSrc = prefill.label; }
    // accredited MW and revenue
    if (kind === 'mric') {
      if (ok(acc.summer)) row.mwAccredited = { summer: mw * acc.summer, winter: mw * acc.winter };
      if (!ok(acc.summer)) row.reason = acc.reason;
      else if (!row.price) row.reason = `${row.reason ? `${row.reason} ` : ''}Enter a CAR-SA price ($/kW-mo of MRIC): there is no default from FCA 18, and a QC-based price is never applied to MRIC (R2 §A1).`;
      else {
        const sm = new Set(C.qc_seasons.summer_months);
        row.revenue = months.reduce((t, m) => t + (sm.has(m) ? mw * acc.summer * row.price.summer : mw * acc.winter * row.price.winter) * KW, 0);
      }
    } else if (ok(acc.frac)) {
      row.mwAccredited = mw * acc.frac;
      if (ok(row.price)) row.revenue = row.mwAccredited * KW * row.price * months.length;
    } else row.reason = `${row.reason ? `${row.reason} ` : ''}${acc.reason}`;
    if (ok(row.revenue)) row.status = 'ok';
    rows.push(row);
  }
  const sum = a => (a.length ? a.reduce((t, r) => t + r.revenue, 0) : null);
  const firstFull = rows.find(r => r.status === 'ok' && !r.conditional && r.monthsOn === MONTHS) || null;
  return { rows, history, prefill, regime, codDate: cod.date, codAssumed: cod.assumed,
    totals: { firm: sum(rows.filter(r => r.status === 'ok' && !r.conditional)), conditional: sum(rows.filter(r => r.status === 'ok' && r.conditional)), notHeld: rows.filter(r => r.status !== 'ok').map(r => r.ccp) },
    firstFull, note: cod.assumed ? `COD month not set: 1 January ${cod.date.slice(0, 4)} assumed.` : '' };
}

// ---------------------------------------------------------------- Pay-for-Performance (P-W1)
const hm = s => { const [h, m] = String(s).split(':').map(Number); return h * 60 + m; };
const fmtHm = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const INTERVALS = new WeakMap(); // event row → {step, iv}: pure in the row and the step, read by every bus's pfpReplay
/** The 5-minute interval labels of a CSC (interval-beginning), the event window and the weight that reconciles to ISO's count. */
export function eventIntervals(R, e) {
  const step = R.pfp.csc_interval_min.value, hit = e && typeof e === 'object' ? INTERVALS.get(e) : null;
  if (hit && hit.step === step && hit.start === e.start && hit.end === e.end && hit.n === e.intervals) return hit.iv;
  const iv = intervalsOf(step, e);
  if (e && typeof e === 'object') INTERVALS.set(e, { step, start: e.start, end: e.end, n: e.intervals, iv });
  return iv;
}
function intervalsOf(step, e) {
  const a = hm(e.start), b = hm(e.end), labels = [];
  for (let t = a; t <= b; t += step) labels.push(t);
  const w = ok(e.intervals) && e.intervals > 0 ? e.intervals / labels.length : 1;
  return { intervals: labels.map(t => ({ label: fmtHm(t), minutesIn: t - a, weight: w })), window: `${fmtHm(a)}–${fmtHm(b + step)}`, step, mismatch: labels.length !== e.intervals };
}
/** US Eastern clock offset for a local date (second Sunday of March to first Sunday of November = EDT). */
const EASTERN = new Map(); // date → offset: pure in the date, read at every CSC interval of every bus (page-load hot path)
export function easternOffset(date) {
  let v = EASTERN.get(date);
  if (v === undefined) { v = easternOffsetOf(String(date)); if (EASTERN.size >= 50000) EASTERN.clear(); EASTERN.set(date, v); }
  return v;
}
function easternOffsetOf(date) {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7)), d = Number(date.slice(8, 10));
  const nthSunday = (mm, n) => { const first = new Date(Date.UTC(y, mm - 1, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + 7 * (n - 1); };
  const edt = (m > 3 && m < 11) || (m === 3 && d >= nthSunday(3, 2)) || (m === 11 && d < nthSunday(11, 1));
  return edt ? '-04:00' : '-05:00';
}
/** Output functions: (date, label, {minutesIn}) → MW. Each carries a .label for the card. */
export const zeroOutput = Object.assign(() => 0, { label: 'zero output in every interval (worst case)' });
export function storageOutput(mw, hours) {
  return Object.assign((date, label, { minutesIn }) => (minutesIn < hours * 60 ? mw : 0),
    { label: `storage at ${mw} MW for the first ${hours} h of each event if charged at its start, then 0 (R2 §B4)` });
}
// One stamp string per (event date, interval label), shared by every bus: clearSky memoises on the stamp.
const STAMPS = new Map();
function stampOf(date, label) {
  let byLabel = STAMPS.get(date);
  if (!byLabel) { if (STAMPS.size >= 5000) STAMPS.clear(); STAMPS.set(date, byLabel = new Map()); }
  let s = byLabel.get(label);
  if (s === undefined) byLabel.set(label, s = `${date}T${label}${easternOffset(date)}`);
  return s;
}
export function solarClearSky(mw, lat, lon) {
  if (!ok(lat) || !ok(lon) || !ok(mw)) return null;
  return Object.assign((date, label) => { const s = clearSky(stampOf(date, label), lat, lon); return s == null ? null : mw * s; },
    { label: 'clear-sky solar shape at the bus (assumption: hourly sun position, not a measured profile)' });
}

/**
 * PfP replay with today's rules (R2 §B4): Σ_e Σ_t PPR × (A_t − CSO × min(BR_e, cap)) × Δt, then ÷ years observed.
 * cso MW (or {summer, winter} under CAR-SA, picked by the event month) · mw nameplate for $/kW-yr · output fn · ppr override (sensitivity)
 * capPrice $/kW-mo enables the annual stop-loss floor. Monthly stop-loss = FCA Starting Price × CSO per month.
 */
export function pfpReplay(R, { cso, mw, output, ppr = null, capPrice = null, brCap = true } = {}) {
  const P = R.pfp, sl = P.stop_loss, ev = P.events;
  const rate = ok(ppr) ? ppr : P.ppr.value, cap = P.balancing_ratio_cap.value;
  const base = { ppr: rate, pprSrc: P.ppr.src, brCapSrc: `${P.balancing_ratio_cap.src} (${P.balancing_ratio_cap.status})`, years: ev.years_observed, src: ev.src };
  const sm = new Set(R.capacity.qc_seasons.summer_months);
  const csoAt = date => (ok(cso) ? cso : cso && ok(cso.summer) ? (sm.has(Number(date.slice(5, 7))) ? cso.summer : cso.winter) : null);
  if (typeof output !== 'function') return { ...base, status: 'missing', total: null, annual: null, perKwYr: null, events: [], annualFloor: null, reason: 'Expected output at the event times is not held: no generation profile for this resource (enter one, or read the zero-output worst case).' };
  if (csoAt(ev.rows[0].date) == null) return { ...base, status: 'missing', total: null, annual: null, perKwYr: null, events: [], annualFloor: null, reason: 'No capacity supply obligation: capacity accreditation is not held.' };
  const events = ev.rows.map(e => {
    const iv = eventIntervals(R, e), c = csoAt(e.date), brUsed = brCap ? Math.min(e.br, cap) : e.br, dt = iv.step / 60;
    let pay = 0, aw = 0, w = 0, missing = false;
    for (const x of iv.intervals) {
      const A = output(e.date, x.label, { minutesIn: x.minutesIn });
      if (!ok(A)) { missing = true; break; }
      pay += rate * (A - c * brUsed) * x.weight * dt; aw += A * x.weight; w += x.weight;
    }
    return { date: e.date, window: iv.window, intervals: iv.intervals.length, weightTotal: w, mismatch: iv.mismatch, note: e.note || '', br: e.br, brUsed, cso: c,
      meanOutput: missing ? null : aw / w, uncapped: missing ? null : pay, payment: missing ? null : pay, capped: false, month: e.date.slice(0, 7), ccp: ccpOf(e.date, R) };
  });
  if (events.some(e => e.payment == null)) return { ...base, status: 'missing', total: null, annual: null, perKwYr: null, events, annualFloor: null, reason: 'The output profile has no value for at least one event interval.' };
  // monthly stop-loss: the month's net loss is limited to Starting Price × CSO (losses only)
  for (const mo of new Set(events.map(e => e.month))) {
    const es = events.filter(e => e.month === mo), net = es.reduce((t, e) => t + e.payment, 0), floor = -sl.monthly_starting_price * Math.max(...es.map(e => e.cso)) * KW;
    if (net < floor) { const neg = es.filter(e => e.payment < 0), negSum = neg.reduce((t, e) => t + e.payment, 0), pos = net - negSum;
      for (const e of neg) { e.payment = (floor - pos) * (e.payment / negSum); e.capped = true; } }
  }
  // annual stop-loss (tariff form): MaxCSO × [k × (FCAcp − FCAsp) − 12 × FCAcp], per CCP
  let annualFloor = null;
  if (ok(capPrice)) {
    const maxCso = Math.max(...events.map(e => e.cso));
    annualFloor = maxCso * KW * (sl.annual_months_of_net_loss * (capPrice - sl.monthly_starting_price) - MONTHS * capPrice);
    for (const c of new Set(events.map(e => e.ccp))) {
      const es = events.filter(e => e.ccp === c), net = es.reduce((t, e) => t + e.payment, 0);
      if (net < annualFloor) { const neg = es.filter(e => e.payment < 0), negSum = neg.reduce((t, e) => t + e.payment, 0), pos = net - negSum;
        for (const e of neg) { e.payment = (annualFloor - pos) * (e.payment / negSum); e.capped = true; } }
    }
  }
  const total = events.reduce((t, e) => t + e.payment, 0), annual = total / ev.years_observed;
  const days = (a, b) => (Date.parse(`${b}T00:00Z`) - Date.parse(`${a}T00:00Z`)) / 864e5;
  const rec = events.filter(e => e.date >= ev.recent_from), recYears = days(ev.recent_from, ev.observed_to) / 365.25;
  const recTotal = rec.reduce((t, e) => t + e.payment, 0);
  return { ...base, status: 'ok', total, annual, perKwYr: ok(mw) && mw > 0 ? annual / (mw * KW) : null, events, annualFloor, outputLabel: output.label || 'user-supplied output',
    recent: { n: rec.length, years: recYears, annual: recTotal / recYears, perKwYr: ok(mw) && mw > 0 ? recTotal / recYears / (mw * KW) : null, from: ev.recent_from },
    stopLossSrc: sl.src, stopLossNote: sl.note, reason: '' };
}

// ---------------------------------------------------------------- ancillary (GAPS 4.7 → R2 §C)
/** Σ q × (credit − max(0, RT Hub − strike)) over DA A/S awards (hourly RT Hub, MR1 §III.3.2.1(q)); null if any input is missing. */
export function daOptionValue(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let v = 0;
  for (const r of rows) { if (![r.q, r.credit, r.rtHub, r.strike].every(ok)) return null; v += r.q * (r.credit - Math.max(0, r.rtHub - r.strike)); }
  return v;
}
/** Pro-rata regulation bound: MW ÷ (ATRR + MW) × the 2025 pool (R2 §C2). */
export function regulationBound(R, mw) {
  const g = R.ancillary.regulation_2025;
  return ok(mw) && mw > 0 ? (mw / (g.atrr_available_mw + mw)) * g.pool_usd : null;
}
export function ancillaryStreams(R, { tech, mw, daAs = null }) {
  const A = R.ancillary, da = A.da_as, rg = A.regulation_2025, applies = tech === 'storage' || tech === 'hybrid';
  const na = `R2 §C2 values DA ancillary options and regulation for storage; a ${tech} plant is not modelled for them.`;
  if (!applies) return { daAs: { value: null, status: 'not_applicable', reason: na, src: da.src }, regulation: { value: null, upper: null, status: 'not_applicable', reason: na, src: rg.src } };
  const v = daOptionValue(daAs);
  const kept = 1 - da.closeout_2025_usd / da.credits_2025_usd;
  const daStream = ok(v) ? { value: v, status: 'ok', reason: 'Awards valued at the DA credit less the close-out at the hourly RT Hub price.', src: da.src }
    : { value: null, status: 'missing', src: da.src,
      reason: `Not held: DA ancillary clearing prices and strikes are not in the unified DB (it holds real-time reserve prices only). Method when held: credit − max(0, hourly RT Hub − strike) per MWh of DA obligation; fleet-wide 2025 the close-out returned ${pct(1 - kept)} of credits.` };
  const up = regulationBound(R, mw);
  return { daAs: daStream,
    regulation: { value: 0, upper: up, status: 'ok', src: `${rg.src}; ${A.regulation_base_case.src}`, ruleStatus: A.regulation_base_case.status,
      reason: `Base case 0: a saturated market (${rg.atrr_available_mw} MW of ATRR for about ${rg.req_mw_avg} MW of requirement, 2025). Sensitivity bound $${Math.round(up).toLocaleString('en-US')}/yr = the pro-rata share of the $${(rg.pool_usd / 1e6).toFixed(1)}M 2025 pool.` } };
}

// ---------------------------------------------------------------- energy hooks (GAPS 4.8 → R2 §D2), on existing price data
/** DA hourly (+ FER) on the DA schedule plus RT deviations at RT prices. da [{h, q, price, fer}], rt [{h, g, price, dtHours}]. */
export function twoSettlement({ da = [], rt = [] } = {}) {
  const q = new Map();
  let v = 0;
  for (const r of da) { if (![r.q, r.price].every(ok) || (r.fer != null && !ok(r.fer))) return { value: null, status: 'missing', reason: 'A DA price or schedule is missing.' }; q.set(r.h, r.q); v += r.q * (r.price + (r.fer ?? 0)); }
  for (const r of rt) { if (![r.g, r.price, r.dtHours].every(ok)) return { value: null, status: 'missing', reason: 'An RT price or output is missing.' }; v += (r.g - (q.get(r.h) ?? 0)) * r.price * r.dtHours; }
  return { value: v, status: 'ok', label: 'two-settlement: DA hourly schedule (+ FER) and RT deviations at 5-minute prices', reason: '' };
}
function cp(rows, label) {
  if (!Array.isArray(rows) || !rows.length) return { value: null, status: 'missing', label, reason: 'Price series not held.' };
  let n = 0, d = 0;
  for (const r of rows) { if (![r.g, r.price, r.dtHours].every(ok)) return { value: null, status: 'missing', label, reason: 'Incomplete series.' }; n += r.g * (r.price + (r.fer ?? 0)) * r.dtHours; d += r.g * r.dtHours; }
  return d > 0 ? { value: n / d, status: 'ok', label, reason: '' } : { value: null, status: 'missing', label, reason: 'No output in the series.' };
}
/** The three capture prices R2 §D2 asks for: 5-minute RT nodal, DA nodal + FER, hourly RT (labelled an approximation). */
export function captureSet({ rt5 = null, da = null, rtHourly = null } = {}) {
  return { rt5: cp(rt5, '5-minute RT nodal (the settlement interval)'), da: cp(da, 'DA hourly nodal + FER'), rtHourly: cp(rtHourly, 'hourly RT (hourly approximation)') };
}
/** Hub-settled financial PPA at strike K: R_PPA = Σ q × (K − hub) × Δt; basis Σ g × (node − hub) × Δt stays with the seller. */
export function hubHedge(rows, K) {
  if (!ok(K) || !Array.isArray(rows) || !rows.length) return { ppa: null, basis: null, status: 'missing', reason: 'Strike or hub series not held.' };
  let ppa = 0, basis = 0;
  for (const r of rows) { const dt = r.dtHours ?? 1; if (![r.g, r.q, r.lmpNode, r.lmpHub, dt].every(ok)) return { ppa: null, basis: null, status: 'missing', reason: 'Incomplete node or hub series.' }; ppa += r.q * (K - r.lmpHub) * dt; basis += r.g * (r.lmpNode - r.lmpHub) * dt; }
  return { ppa, basis, status: 'ok', reason: '' };
}

// ---------------------------------------------------------------- RECs and Clean Peak (GAPS 4.13 → R2 §E)
export function recRevenue(R, { state, tech, mwh, price = null }) {
  const M = R.recs_ma, sc = M.class1_scope, acp = M.class1_acp.value, regime = `MA RPS Class I (ACP ${money2(acp)}/MWh cap)`, src = `${M.class1_acp.src}; ${M.class1_price_default.src}`;
  if (!sc.states.includes(state)) return { value: null, status: 'missing', regime, src, reason: `Not held: the REC model covers Massachusetts only (bus state ${state || 'not held'}).` };
  if (!sc.techs.includes(tech)) return { value: null, status: 'not_applicable', regime, src, reason: 'Stand-alone storage earns no Class I RECs (225 CMR 14.07).' };
  if (!ok(mwh)) return { value: null, status: 'missing', regime, src, reason: 'Not held: annual MWh delivered is needed (Economics › Revenue).' };
  const user = ok(price), p = user ? price : M.class1_price_default.low, eff = Math.min(p, acp);
  return { value: mwh * eff, status: 'ok', regime, src, price: eff, priceCapped: p > acp,
    priceSrc: user ? `user-set ${money2(p)}/MWh${p > acp ? `, capped at the ACP ${money2(acp)}` : ''}` : `prefilled at the cited low end ${money2(p)}/MWh (range ${money2(M.class1_price_default.low)}–${money2(M.class1_price_default.high)}, ${M.class1_price_default.src}); user-set`,
    reason: '' };
}
function seasonOf(R, mmdd) {
  for (const s of R.recs_ma.clean_peak_seasons.rows) {
    if (s.from <= s.to ? mmdd >= s.from && mmdd <= s.to : mmdd >= s.from || mmdd <= s.to) return s;
  }
  return mmdd === '02-29' ? R.recs_ma.clean_peak_seasons.rows.find(s => s.from > s.to) : null; // leap day sits in winter
}
/** Clean Peak certificates from hourly rows [{timestamp 'YYYY-MM-DDTHH:mm' local, mwh}]; peakHours: Set of 'YYYY-MM-DDTHH' (optional). */
export function cpecCertificates(R, rows, { peakHours = null } = {}) {
  const pm = R.recs_ma.clean_peak_multipliers.monthly_system_peak_hour;
  let certs = 0, mwhIn = 0;
  for (const r of rows || []) {
    if (!ok(r.mwh) || r.mwh <= 0) continue;
    const date = r.timestamp.slice(0, 10), h = Number(r.timestamp.slice(11, 13)), dow = new Date(`${date}T00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const s = seasonOf(R, date.slice(5, 10));
    if (!s || h < s.start_hour || h >= s.end_hour) continue;
    const peak = peakHours?.has(r.timestamp.slice(0, 13)) ? pm : 1;
    certs += r.mwh * s.multiplier * peak; mwhIn += r.mwh;
  }
  return { certificates: certs, mwhInWindows: mwhIn,
    note: `Business days are Monday to Friday (holidays not excluded). ${peakHours ? '' : `The ×${pm} monthly system-peak hour is not applied: actual monthly peak hours are not held.`}`.trim() };
}
export function cpsRevenue(R, { state, tech, rows, price = null, eligible = null, peakHours = null }) {
  const M = R.recs_ma, sc = M.clean_peak_scope, acp = M.clean_peak_acp.value, regime = `MA Clean Peak Standard (ACP ${money2(acp)} cap)`, src = `${M.clean_peak_seasons.src}; ${M.clean_peak_price_default.src}`;
  if (!sc.states.includes(state)) return { value: null, status: 'missing', regime, src, reason: `Not held: Clean Peak is modelled for Massachusetts only (bus state ${state || 'not held'}).` };
  if (!sc.techs.includes(tech)) return { value: null, status: 'not_applicable', regime, src, reason: 'Clean Peak is valued for storage and paired solar (R2 §E2); stand-alone solar or wind is not modelled.' };
  if (!Array.isArray(rows)) return { value: null, status: 'missing', regime, src, reason: 'Not held: needs the storage discharge by hour (Economics › Storage dispatch).' };
  const c = cpecCertificates(R, rows, { peakHours }), user = ok(price), p = user ? price : M.clean_peak_price_default.value_fraction_of_acp * acp, eff = Math.min(p, acp);
  const elig = eligible === true;
  return { value: c.certificates * eff, status: elig ? 'ok' : 'conditional', regime, src, certificates: c.certificates, price: eff,
    priceSrc: user ? `user-set ${money2(p)}${p > acp ? `, capped at the ACP ${money2(acp)}` : ''}` : `${M.clean_peak_price_default.value_fraction_of_acp} × ACP = ${money2(eff)} (secondary source, no public price series)`,
    reason: `${elig ? '' : `Storage eligibility under 225 CMR 21.05(1)(a)2 is not tested (${sc.rule.split(';')[0]}). `}${c.note}` };
}

// ---------------------------------------------------------------- the stack
/**
 * One revenue stack: energy · capacity · PfP · DA A/S · regulation · RECs · Clean Peak. Each stream {id, label, regime, src, status, value, reason}.
 * Energy is never computed here (one home: Economics › Revenue); pass {value, label}. Capacity = the first full CCP after COD.
 */
export function revenueStack(R, inp = {}) {
  const { tech = 'solar', mw, durationH = 4, state = null } = inp, streams = [];
  const st = (id, label, o) => streams.push({ id, label, ruleStatus: null, ...o, value: o.status === 'ok' || o.status === 'conditional' ? o.value : null });
  const E = R.energy_settlement.intervals;
  if (ok(inp.energy?.value)) st('energy', 'Energy', { regime: inp.energy.label || 'measured on held prices', src: E.src, status: 'ok', value: inp.energy.value, reason: '' });
  else st('energy', 'Energy', { regime: 'two-settlement: DA hourly, RT 5-minute nodal', src: E.src, status: 'missing', reason: 'Not held here: energy is computed on Economics › Revenue and passed in.' });
  const path = capacityPath(R, { tech, mw, cod: inp.cod, years: inp.years ?? 10, regime: inp.regime, band: inp.band, userPath: inp.userPath, mricPrice: inp.mricPrice, fca18Cso: inp.fca18Cso, durationH, qc: inp.qc });
  const ff = path.firstFull, cond = !ff ? path.rows.find(r => r.status === 'ok') : null, row = ff || cond, r0 = path.rows[0];
  if (row) st('capacity', 'Capacity', { regime: `${row.regime} · CCP ${row.ccp}`, src: `${row.regimeSrc}; ${row.accreditation.src}`, ruleStatus: row.accreditation.status, status: ff ? 'ok' : 'conditional', value: row.revenue,
    reason: `${row.accreditation.label}. Price ${row.priceSrc}${row.reason ? ` ${row.reason}` : ''}`, ccp: row.ccp, path });
  else st('capacity', 'Capacity', { regime: r0 ? `${r0.regime} · CCP ${r0.ccp}` : 'not placed', src: r0 ? r0.regimeSrc : R.capacity.ccp_calendar.src, status: 'missing', reason: (r0 && r0.reason) || path.reason || 'Not held.', path });
  const capRow = row || r0;
  const cso = capRow && capRow.mwAccredited != null ? capRow.mwAccredited : null;
  const output = inp.output !== undefined ? inp.output : tech === 'storage' ? storageOutput(mw, durationH) : tech === 'solar' ? solarClearSky(mw, inp.lat, inp.lon) : null;
  const pf = cso == null ? { status: 'missing', reason: 'No capacity supply obligation: capacity accreditation is not held.' } : pfpReplay(R, { cso, mw, output, capPrice: ok(capRow.price) ? capRow.price : null });
  st('pfp', 'Pay-for-Performance', { regime: `Replay of the ${R.pfp.events.rows.length} CSCs since ${R.pfp.events.observed_from} at PPR $${R.pfp.ppr.value.toLocaleString('en-US')}/MWh, BR capped at ${R.pfp.balancing_ratio_cap.value}`,
    src: `${R.pfp.ppr.src}; ${R.pfp.events.src}; ${R.pfp.stop_loss.src}`, ruleStatus: R.pfp.balancing_ratio_cap.status, status: pf.status, value: pf.annual,
    reason: pf.status === 'ok' ? `Expected value per year over ${pf.years} years; output: ${pf.outputLabel}.` : pf.reason, pfp: pf });
  const an = ancillaryStreams(R, { tech, mw, daAs: inp.daAs });
  st('da_as', 'DA ancillary options', { regime: 'DA A/S call options (TMSR, TMNSR, TMOR, EIR), close-out at the hourly RT Hub', ...an.daAs });
  st('regulation', 'Regulation', { regime: 'Regulation market (capacity + mileage), pro-rata share', ...an.regulation });
  const rec = recRevenue(R, { state, tech, mwh: inp.annualMWh, price: inp.recPrice });
  st('recs', 'RECs (Class I)', { ...rec, reason: rec.status === 'ok' ? `Price ${rec.priceSrc}.` : rec.reason });
  const cps = cpsRevenue(R, { state, tech, rows: inp.cpsRows ?? null, price: inp.cpsPrice, eligible: inp.cpsEligible, peakHours: inp.peakHours });
  st('cps', 'Clean Peak (CPECs)', cps);
  const sumOf = s => s.reduce((t, x) => t + x.value, 0);
  const okS = streams.filter(s => s.status === 'ok'), cdS = streams.filter(s => s.status === 'conditional');
  return { streams, path, total: { firm: sumOf(okS), conditional: sumOf(cdS), notHeld: streams.filter(s => s.status === 'missing').map(s => s.id), notApplicable: streams.filter(s => s.status === 'not_applicable').map(s => s.id) } };
}
