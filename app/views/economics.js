// Economics dashboard (v3, dense card layout, 2026-09-29). Four tabs on Codex's chronological cores (../economics.js).
// Prices = applied Prices basis (one bus, one price); every other year and run is shown beside it, never mixed into it.
// Connection limits = Grid element-study rules, or the values sent from Grid for this bus.
// Settled rules kept: unknown never passes (a missing limit makes every stream conditional); capacity is conditional
// on an unstudied capacity case; losses are applied before the connection cap; the SOC grid is sized to the limits
// (a battery that cannot be represented is "not assessed", never $0); LCOE uses the finance timeline; spreads are
// benchmarks; finance has no defaults. Studio-copy figures (older database) are labelled and shown as data notes.
import { generationRevenue, projectFinance, groupSum, negativePriceHours, spreadAt, spreadBenchmark, dailyCycles, reserveValue, tornado, financeGrid, payback, pathAlong, fillGaps, shapeProfile, stampHour } from '../economics.js';
import { analysis } from './prices.js';
import { rowsOf, dailySpreads } from '../prices.js';
import { clearSky } from '../solar.js';
import { caseTable, binding } from '../gridrules.js';
import { describe, basisHash, fmt } from '../basis.js';
import { lineChart, barChart, groupedBar } from '../charts.js';
import { lcoe as lcoeCalc } from '../lcoe.js';
import { dispatchGrid } from '../dispatchgrid.js';
import { solve } from '../dispatch-client.js';
import { traceRevenue, traceBess, traceHybrid, traceFinance } from './economics-trace.js';
import { traceRevYears, traceNegPrice, traceTornado, traceSpillSize, traceBessMonths, traceSpread, traceReserves, traceHybridCurve, traceFinGrid, tracePayback, traceRevPath } from './economics-trace-more.js';
import { get as getData, waitText } from './economics-data.js';
import { stacked, histo, tornadoChart, table, card, B, nextStep, moreCtl } from './economics-charts.js';
import { econTabLabel, ECON_PRESETS, dcacSweep } from './economics-fuel.js';
import { tabLoadCost, tabLoadFlex, tabHybridNA, tabCostFinance, tabStorageRevenue } from './economics-fueltabs.js';
import { traceRevFor, traceDcac } from './economics-fuel-trace.js';
import { revenueFor } from '../decisioncore.js';
// S2-EM (F002, F008, F011, D8, D10): one labelled revenue stack, the studied charge caps, the contract card, one
// usable-year rule and the stated connection cap. Cores: economics-stack/-charge/-contract.js.
import { revenueStack, stackHandoff, connectionCap, seriesUsable, USABLE_RULE, storageHandoffExtras } from '../economics-stack.js';
import { chargeLimits, chargeCaps, peakWindowLabel, windowFromRules } from '../economics-charge.js';
import { contractCard } from './economics-contract-card.js';
import { rules as getRules } from './economics-data.js';
import { revenueStack as s4RevenueStack } from '../rules/revenue.js';
// W-B (2026-10-07) lead wiring: S4 revenue cards (stack, capacity path per CCP, PfP) on the Revenue and BESS tabs; S5
// tax-gate + after-tax finance cards on Project finance. Both read the same rules load as the S4 streams (one fetch).
import { revenueCards, revenueUiOpts } from './cards-revenue.js';
import { financeCards } from './cards-finance.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const kpi = (label, value, unit, note, nh = false) => `<div class="kpi${nh ? ' nh' : ''}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
const perKw = (v, mw) => (ok(v) && mw > 0 ? `$${(v / (mw * 1000)).toFixed(Math.abs(v / (mw * 1000)) < 10 ? 2 : 0)}` : 'not held');
const kUsd = v => (ok(v) ? `${v < 0 ? '−' : ''}$${Math.abs(v / 1e3).toFixed(Math.abs(v) < 1e5 ? 1 : 0)}k` : 'not held');
const traceCard = (...t) => { const body = t.filter(Boolean).join(''); return body ? `<section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculation traces</h3><span class="card-sub">formula · inputs with sources · steps · checks · CSV of the working</span></header><div class="card-b">${body}</div></section>` : ''; };
const tagged = (o, span, title, sub, body, opt = {}) => card(span, title, sub, body, { ...opt, ...o });
const cards = (...c) => `<div class="cards">${c.filter(Boolean).join('')}</div>`;

// [value, tag, source]. A = cited assumption · P = placeholder (no source; change it) · U = your entry.
const DEFAULTS = {
  solarCF: [15, 'A', 'ISONE_REFERENCE §3.6 (NREL SAM), pack default'],
  windCF: [32.5, 'A', 'ISONE_REFERENCE §3.6 (NREL SAM), pack default'],
  lossPct: [3, 'P', 'Placeholder: inverter and collection losses'],
  rte: [86, 'A', 'CEA / Mott MacDonald ORTP battery (ext/75 bess_rte)'],
  duration: [4, 'P', 'Placeholder duration'],
  cycleCost: [0, 'P', 'Placeholder: 0 = cycling is free, so the result is a ceiling'],
  regShare: [11, 'A', 'ext/75 reg_share'], regPrice: [12.21, 'A', 'ext/75 reg_price, $/MW-h'],
  degradation: [0.5, 'P', 'Placeholder: %/yr output decline'],
  degStorage: [2, 'P', 'Placeholder: ext/75 deg_bess 2%/yr (storage degradation not covered by the vault)'],
  cycThr: [1, 'A', 'ext/75 bess_cycles: 1.0 cycle/day planning basis'],
  flexShare: [10, 'P', 'Placeholder: share of the load that can move (no site study held)'],
  loadObligation: [100, 'P', 'ext/75 acc_dc_load: a flat load carries its full MW at the peak (not covered by the vault)'],
};
// Low / high cases from the Studio's cited assumption table (ext/75 GSX_REVENUE_ASSUMPTIONS), used by the tornado only.
// S2-EM (lead, S4 Lead wiring 2): capacity and REC figures are no longer typed here; they come from the S4 streams
// (rules/revenue.js revenueStack over rules/isone-2026.json), each with its regime and source shown.
const RANGES = { solarCF: [14, 16, 'ext/75 cf_solar low/high (NREL SAM)'], windCF: [30, 35, 'ext/75 cf_wind low/high (NREL, EIA-923)'] };
const val = (S, k) => (ok(S.ui.econ?.[k]) ? S.ui.econ[k] : DEFAULTS[k][0]);
// fix-4: a user project's stated|default map (S.ui.inputProv {k: {state, src, v}}, from projects.toState; legacy S.ui.inputSrc
// {k: {src, v}} = defaults only). The value on screen carries the project's state only while it equals v; otherwise it is an edit here.
const projProv = (S, g, k) => { const d = S.ui?.inputProv?.[k] ?? (S.ui?.inputSrc?.[k] ? { state: 'default', ...S.ui.inputSrc[k] } : null); return d && ok(S.ui[g]?.[k]) && Object.is(S.ui[g][k], d.v) ? d : null; };
const projDef = (S, g, k) => { const d = projProv(S, g, k); return d?.state === 'default' ? d.src || 'project default (source not stated)' : null; };
const STATED_TITLE = 'Stated by the developer (Project inputs)';
const tag = (S, k) => { const d = projProv(S, 'econ', k); return d ? (d.state === 'default' ? 'A' : 'U') : ok(S.ui.econ?.[k]) && S.ui.econ[k] !== DEFAULTS[k][0] ? 'U' : DEFAULTS[k][1]; };
const tagTitle = (S, k) => { const d = projProv(S, 'econ', k); return d ? (d.state === 'default' ? `default · ${d.src || 'project default (source not stated)'}` : STATED_TITLE) : DEFAULTS[k][2]; };
/** A Finance input's label: A = the project's labelled default (src), U = stated or entered here, NH = not held (never a typed default). */
const finTag = (S, k) => { const d = projProv(S, 'fin', k); return d?.state === 'default' ? { tag: 'A', src: `default · ${d.src || 'project default (source not stated)'}` } : ok(S.ui.fin?.[k]) ? { tag: 'U', src: d ? STATED_TITLE : 'your entry' } : { tag: 'NH', src: 'not held' }; };
const input = (S, k, label, unit, step = 'any') => `<label class="field">${esc(label)} <span class="pill ${tag(S, k) === 'P' ? 'warn' : ''}" title="${esc(tagTitle(S, k))}">${tag(S, k)}</span><input type="number" step="${step}" data-act="econ" data-k="${k}" value="${val(S, k)}"><span class="audit-note">${esc(unit)} · ${esc(tagTitle(S, k))}</span></label>`;
const slider = (S, k, label, unit, min, max, step, live = true) => `<div class="range-field"><span>${esc(label)} <span class="pill ${tag(S, k) === 'P' ? 'warn' : ''}" title="${esc(tagTitle(S, k))}">${tag(S, k)}</span> <span class="audit-note">${esc(unit)}</span></span><div class="row"><input type="range" min="${min}" max="${max}" step="${step}" value="${val(S, k)}" data-act="econ" data-k="${k}" ${live ? 'data-live' : ''} aria-label="${esc(label)}"><output>${val(S, k)}</output></div></div>`;
/** Your REC price ($/MWh) when entered; null = the S4 rule's cited prefill (labelled on the card). Never a typed default. */
const userRec = S => (ok(S.ui.econ?.recUser) ? S.ui.econ.recUser : null);
/** The S4 revenueStack inputs for this project: bus, COD, user REC price and the capacity options from S.ui (one builder for KPIs and cards). */
function s4Inputs(ctx, { tech, mw, mwh = null, energy = null, energyLabel = null, durationH = 4, cpsRows = null }) {
  const S = ctx.S, node = ctx.node || {};
  return { tech, mw, durationH, state: node.state_code ?? node.state ?? null, lat: node.latitude, lon: node.longitude, cod: S.ui.fin?.cod ?? null, annualMWh: mwh,
    energy: { value: energy, label: energyLabel || undefined }, recPrice: userRec(S), cpsRows, ...revenueUiOpts(S.ui) };
}
/**
 * S4 capacity, REC and Clean Peak streams for this project (rules/revenue.js revenueStack). Returns {state, capacity,
 * recs, cps, stack}; each stream {value, status, regime, src, reason}. While the rules load, all are not held (never 0).
 */
function s4Streams(ctx, inp) {
  const R = getRules();
  const wait = why => ({ value: null, status: 'missing', regime: '', src: 'rules/isone-2026.json', reason: why });
  const all = why => ({ capacity: wait(why), recs: wait(why), cps: wait(why), stack: null });
  if (R.state !== 'ok') return { state: R.state, ...all(R.state === 'loading' ? 'Loading the rules file…' : `Rules file could not load: ${R.error}`) };
  try {
    const st = s4RevenueStack(R.data, s4Inputs(ctx, inp));
    const pick = id => st.streams.find(z => z.id === id) || wait('not in the S4 stack');
    return { state: 'ok', capacity: pick('capacity'), recs: pick('recs'), cps: pick('cps'), stack: st };
  } catch (e) { return { state: 'error', ...all(`S4 revenue stack failed: ${e.message}`) }; }
}
/** S4 Lead wiring 1: the three S4 cards (stack · capacity by CCP · PfP) for one input set; a loading or failed rules file is said, never blank. */
function s4Cards(ctx, inp) {
  const R = getRules(), title = 'Revenue stack (ISO-NE rules)', sub = 'capacity by commitment period · Pay-for-Performance · RECs · Clean Peak';
  if (R.state !== 'ok') return card(12, title, sub, `<div class="empty"><strong>${R.state === 'loading' ? 'Loading the rules file' : 'Not held'}</strong>${esc(R.state === 'error' ? `rules/isone-2026.json could not load: ${R.error}` : 'Reading rules/isone-2026.json…')}</div>`, { depth: 'review', chips: 'rules' });
  try { return revenueCards(R.data, s4Inputs(ctx, inp), ctx.S.ui); } catch (e) { console.error(e); return card(12, title, sub, `<div class="empty"><strong>Not held</strong>${esc(e.message)}</div>`, { depth: 'review', chips: 'rules' }); }
}
/** Storage discharge by hour → the S4 Clean Peak input ({timestamp 'YYYY-MM-DDTHH:mm' source clock, mwh}). */
const cpsRowsOf = rows => (rows || []).filter(r => r.dischargeMW > 1e-6).map(r => ({ timestamp: String(r.timestamp).slice(0, 16), mwh: r.dischargeMW * r.dtHours }));
const streamNote = z => [z.regime, z.status === 'ok' ? '' : z.status, z.reason].filter(Boolean).join(' · ');
const RUN_LABEL = { '5yr': '2028 · 5-yr run', '10yr': '2035 · 10-yr run', pcr2030: '2030 · PCR run', pcr2035: '2035 · PCR run', pcr2040: '2040 · PCR run (12% gas)' };
const PATH_RUNS = ['5yr', 'pcr2030', 'pcr2035', 'pcr2040']; // the Studio's anchor set (ext/75): 10-yr and PCR 2035 are both 2035; PCR is used
const STUDIO_TAG = 'Studio copy (older database)';

export const ECONOMICS = {
  key: 'economics',
  question: 'Does the configuration create sufficient value?',
  lede: 'Revenue from the Prices basis and the Grid limits, hour by hour; every held year and forecast run beside it. Storage is dispatched chronologically; finance needs your own cost inputs.',
  tabs: [
    { id: 'revenue', label: 'Solar & wind revenue', labelFor: t => econTabLabel('revenue', t) },
    { id: 'bess', label: 'BESS dispatch', labelFor: t => econTabLabel('bess', t) },
    { id: 'hybrid', label: 'Hybrid sizing', labelFor: t => econTabLabel('hybrid', t) },
    { id: 'finance', label: 'Project finance', labelFor: t => econTabLabel('finance', t) },
  ],
  // Presets (shell 'preset' action → S.ui): the Studio's cited ext/75 base / low / high cases.
  presets: ECON_PRESETS,
};

// ---------- Shared inputs ----------
function limitsFor(ctx, mw, importMW) {
  const { data, S } = ctx, svc = ['storage', 'hybrid'].includes(S.tech) ? 'storage' : S.tech === 'wind' ? 'wind' : 'solar';
  // C35: a data centre is screened on the large-load withdrawal cases (large_load|charge, summer_peak|charge) at its own
  // load, exactly as Grid (rules/largeload.js withdrawalLimits), never on the storage shoulder-charge envelope.
  if (S.tech === 'datacenter') return { ex: binding(caseTable(data.grid, S.nodeId, 'datacenter', 0, 0), 'export'), im: binding(caseTable(data.grid, S.nodeId, 'datacenter', 0, importMW || 0), 'import') };
  const t = caseTable(data.grid, S.nodeId, svc, mw, Math.max(importMW || 0, mw));
  return { ex: binding(t, 'export'), im: binding(caseTable(data.grid, S.nodeId, 'storage', mw, Math.max(importMW || 0, mw)), 'import') };
}
/**
 * C35: the data-centre connection gate. Passes only when the withdrawal binding is 'Fits' on element evidence and the
 * load is within it; Envelope only, Hold, Not studied and Partly studied never pass. A limit sent from Grid is gated as
 * a number (Grid already applied its own status rule before sending).
 */
function loadGate(x, mw) {
  const st = x.sentGrid ? (ok(x.importLimit) ? (mw <= x.importLimit ? 'Fits' : 'Does not fit') : 'Not studied') : x.im?.status || 'Not studied';
  if (st === 'Fits' && ok(x.importLimit) && mw <= x.importLimit) return { ok: true, status: st, msg: '' };
  if (st === 'Does not fit' || (st === 'Fits' && ok(x.importLimit) && mw > x.importLimit)) return { ok: false, status: 'Does not fit', msg: `<b>Does not fit without network upgrades.</b> ${fmt.mw(mw)} exceeds the withdrawal limit of ${fmt.mw(x.importLimit)} (element study).` };
  return { ok: false, status: st, msg: `Withdrawal limit is ${esc(String(st).toLowerCase())} (no element-study fit for the large-load cases), so the connection is <b>conditional</b> on a study.` };
}
function inputs({ data, S, node }) {
  const res = analysis(data, S.basis);
  const mw = Number(S.exportMW) || 1;
  const { ex, im } = limitsFor({ data, S }, mw, Number(S.importMW) || 0);
  const gh = S.handoffs.grid, sent = gh && String(gh.busId) === String(S.nodeId) ? gh : null;
  const exportLimit = sent ? (ok(sent.exportMW) ? sent.exportMW : null) : ex.value;
  const importLimit = sent ? (ok(sent.importMW) ? sent.importMW : null) : im.value;
  // Review M4: the shoulder-charge case has no element rows in the store, so its limit is the vendor envelope.
  const chargeBasis = sent ? `sent from Grid (${sent.importCase || 'case not recorded'})` : im.row?.basis || null;
  const chargeEnvelopeOnly = !sent && /^Envelope/.test(im.row?.basis || '');
  const gridSource = sent ? `sent from Grid ${String(sent.at).slice(0, 16).replace('T', ' ')}${sent.tech !== S.tech || Number(sent.requestMW) !== Number(S.exportMW) ? ' (project changed since: resend from Grid)' : ''}` : 'computed from Grid study rules (not yet sent)';
  const records = res.rows.map(r => ({ timestamp: r.timestamp, price: r.price, dtHours: r.dtHours }));
  const stalePrices = S.handoffs.prices && S.handoffs.prices.hash !== basisHash(S.basis);
  // Annualise on observed hours so excluded or partial years never understate "per year" (review H1).
  const yearsEq = res.summary ? res.summary.hours / 8760 : null;
  return { res, records, exportLimit, importLimit, ex, im, gridSource, stalePrices, node, yearsEq, chargeBasis, chargeEnvelopeOnly, sentGrid: !!sent };
}

function basisStrip(ctx, x) {
  return `<div class="notice">Prices: <b>${esc(describe(ctx.S.basis))}</b> · ${fmt.int(x.res.summary?.hours)} observed hours; "per year" = total ÷ ${ok(x.yearsEq) ? x.yearsEq.toFixed(2) : '—'} (hours ÷ 8,760).
    · ${ctx.S.tech === 'datacenter' ? `Withdrawal limit ${fmt.mw(x.importLimit)} (large-load cases, ${esc(String(x.im?.status || 'not studied').toLowerCase())})` : `Export limit ${fmt.mw(x.exportLimit)} · Storage charge limit ${fmt.mw(x.importLimit)} (shoulder)`} · limits ${esc(x.gridSource)}.
    ${x.stalePrices ? '<br><span class="pill warn">Prices changed since they were sent here: results use the current basis.</span>' : ''}
    ${ctx.S.basis?.weighting && ctx.S.basis.weighting !== 'duration' ? '<br><span class="pill warn">Year weights</span> Economics weights the selected years by their observed hours; your equal or custom year weights apply only to the Prices headline.' : ''}
    ${x.chargeEnvelopeOnly && ['storage', 'hybrid'].includes(ctx.S.tech) ? '<br><span class="pill warn">Charge limit is the substation envelope</span> vendor-asserted and not reconciled with a facility study, so storage results are conditional on it.' : ''}</div>`;
}

/** Connection gate (review H3): unknown or exceeded limits make results conditional. */
function gate(limit, mw, what) {
  if (!ok(limit)) return { ok: false, msg: `${what} limit is not established (on hold or not studied), so every result here is <b>conditional</b> on a connection study.` };
  if (mw > limit) return { ok: false, msg: `<b>Does not fit without network upgrades.</b> ${fmt.mw(mw)} exceeds the ${what.toLowerCase()} limit of ${fmt.mw(limit)}. Values below are for output capped at the limit (no upgrades); the full size needs upgrades (Grid › Upgrade cost allocator).` };
  return { ok: true, msg: '' };
}

/** F002: the hybrid tab values energy only; the stack says so and names what is left out. */
const hyStack = v => revenueStack({ energy: v, rec: null }, ['energy', 'rec'], { reasons: { rec: 'not computed on Hybrid sizing; PV RECs are on Solar & wind revenue' } });
/** Hub series on the applied basis (hour-matched), for a hub-settled contract. */
function hubSeriesFor(ctx) {
  const { data, S } = ctx, b = S.basis, out = new Map();
  if (!b) return out;
  for (const s of data.series.filter(z => z.nodeId === 'hub' && z.mode === b.mode && b.years.some(y => Number(y) === Number(z.year)) && (b.mode === 'forecast' ? z.run === b.run : z.market === b.market))) for (const r of rowsOf(s)) out.set(r.timestamp, r.price);
  return out;
}
const MEMO = new Map();
function memo(key, fn) { if (!MEMO.has(key)) { if (MEMO.size > 60) MEMO.clear(); MEMO.set(key, fn()); } return MEMO.get(key); }

const noBasis = ctx => (ctx.data.series.some(s => String(s.nodeId) === String(ctx.S.nodeId) && s.mode === 'historical')
  ? '<div class="notice error">Apply a valid price basis in Prices first.</div>'
  : '<div class="notice error">No price history is held for this bus\'s node. Every Economics figure needs one price basis: choose one of this bus\'s forecast runs in Prices › LMP &amp; years (Forecast), then return here. <button class="tiny" data-act="goto" data-v="prices" data-tab="lmp">Choose a forecast run</button></div>');
const needSize = S => (Number(S.exportMW) > 0 ? '' : `<div class="empty"><strong>Enter a project size</strong>Set Export MW in the project strip.</div>`);

// ---------- Generation profiles ----------
const FLEET_REF = 2025; // latest complete year of ISO-NE fleet output; laid on calendars without same-year data
/** Wind shape per record from the ISO-NE fleet (same clock hour; else the reference year's same month-day-hour). */
function fleetShape(records, prof, fuel) {
  const byHour = prof?.[fuel]; if (!byHour) return null;
  let usedRef = 0;
  const raw = records.map(r => {
    const k = stampHour(r.timestamp);
    if (byHour[k] != null) return byHour[k];
    let md = k.slice(4); if (md.startsWith('-02-29')) md = `-02-28${md.slice(6)}`;
    const v = byHour[`${FLEET_REF}${md}`]; if (v != null) usedRef++; return v ?? null;
  });
  const f = fillGaps(raw, 6);
  return { shape: f.values, filled: f.filled, unfilled: f.unfilled, usedRef };
}
/**
 * Hourly profile before losses. Solar: clear-sky at the bus (reviewed shape). Wind: ISO-NE fleet wind shape when held,
 * else a flat proxy. Returns {raw, unclipped, kind, label, note} or {pending:true}.
 */
function genProfile(ctx, records, tech, mw, cf) {
  if (tech === 'solar') {
    const shape = records.map(r => clearSky(r.timestamp, ctx.node?.latitude, ctx.node?.longitude) ?? 0);
    const hours = records.reduce((t, r) => t + r.dtHours, 0), mean = shape.reduce((t, v, i) => t + v * records[i].dtHours, 0) / hours;
    const unclipped = shape.map(v => (mean ? (mw * cf * v) / mean : 0));
    return { raw: unclipped.map(v => Math.min(mw, v)), unclipped, kind: 'clear-sky', label: 'Clear-sky shape at the bus, scaled to CF', note: 'clear-sky assumption (peak below nameplate, so clipping is understated)' };
  }
  const flat = note => ({ raw: records.map(() => mw * cf), unclipped: records.map(() => mw * cf), kind: 'flat', label: 'Flat output at the CF (proxy)', note });
  const p = getData('profile', 'all');
  if (p.state === 'loading') return { pending: true };
  if (p.state !== 'ok') return flat(`ISO-NE fleet wind shape ${waitText(p, 'fleet wind profile').toLowerCase()} Flat proxy used.`);
  const f = fleetShape(records, p.data, 'wind');
  if (!f || f.unfilled > 0) return flat(`Fleet wind shape has ${fmt.int(f?.unfilled)} unfilled hours on this calendar; flat proxy used.`);
  const g = shapeProfile(records, f.shape, mw, cf);
  if (!g.values) return flat('Fleet wind shape has no output on this calendar; flat proxy used.');
  const unclipped = f.shape.map(s => (mw * cf * s) / g.mean);
  return { raw: g.values, unclipped, kind: 'fleet', label: `ISO-NE fleet wind shape${f.usedRef ? ` (${FLEET_REF} shape on this calendar for ${fmt.int(f.usedRef)} h)` : ''}, scaled to CF`, note: `measured fleet shape (fact_genfuel_hourly), not a site profile${f.filled ? `; ${f.filled} short gaps interpolated` : ''}`, filled: f.filled, usedRef: f.usedRef };
}

/** Energy settlement of one profile: losses first, then the connection cap (review L1). */
function settle(records, raw, loss, cap) {
  const afterLoss = records.map((r, i) => ({ ...r, generationMW: raw[i] * (1 - loss / 100) }));
  const clipped = afterLoss.map(r => ({ ...r, generationMW: Math.min(r.generationMW, cap) }));
  const g = generationRevenue(clipped, { lossPct: 0 });
  const spill = afterLoss.reduce((t, r, i) => t + (r.generationMW - clipped[i].generationMW) * r.dtHours, 0);
  return { afterLoss, clipped, g, spill, neg: negativePriceHours(clipped) };
}

/** Every held settled year (basis market) and forecast run for this bus, with its hourly rows. */
function yearSeries(ctx) {
  const { data, S } = ctx, market = S.basis?.mode === 'historical' ? S.basis.market : 'RT';
  const own = data.series.filter(s => String(s.nodeId) === String(S.nodeId));
  const out = [];
  for (const s of own.filter(s => s.mode === 'historical' && s.market === market).sort((a, b) => a.year - b.year)) { const u = seriesUsable(s); out.push({ s, key: `h${s.year}`, label: `${s.year} ${market}`, short: String(s.year), kind: 'settled', year: s.year, usable: u.usable, why: u.why }); }
  for (const s of own.filter(s => s.mode === 'forecast').sort((a, b) => a.year - b.year || a.run.localeCompare(b.run))) { const u = seriesUsable(s); out.push({ s, key: s.run, label: RUN_LABEL[s.run] || s.run, short: RUN_LABEL[s.run] || s.run, kind: 'run', run: s.run, year: s.year, usable: u.usable, why: u.why }); }
  return out;
}

// ---------- Tab 1: Solar & wind revenue ----------
function revenueSetup(ctx) {
  const { S } = ctx, x = inputs(ctx);
  const tech = S.tech === 'wind' ? 'wind' : 'solar', mw = Number(S.exportMW);
  const cf = (tech === 'wind' ? val(S, 'windCF') : val(S, 'solarCF')) / 100, loss = val(S, 'lossPct');
  const capRule = connectionCap(mw, x.exportLimit), cap = capRule.value; // D10: min(nameplate, export limit), stated
  // S4 streams at the connection-capped size (review L2). REC $/MWh = the S4 REC stream on 1 MWh (ACP-capped).
  const s4 = s4Streams(ctx, { tech, mw: Math.min(mw, cap) });
  const recStream = s4Streams(ctx, { tech, mw: Math.min(mw, cap), mwh: 1 }).recs;
  const recPrice = recStream.status === 'ok' ? recStream.value : null;
  const market = [null, recStream.regime || 'REC market', recPrice];
  const capStream = s4.capacity, capacity = capStream.value;
  return { x, tech, mw, cf, loss, cap, capRule, market, recPrice, recStream, capStream, capacity, capMW: Math.min(mw, cap) };
}

/** Revenue for every held year and run on the same project inputs. */
function revenueYears(ctx, p) {
  const { S } = ctx;
  const key = JSON.stringify(['ry', S.nodeId, basisHash(S.basis), p.tech, p.mw, p.cf, p.loss, p.cap, p.recPrice, p.capacity, getData('profile', 'all').state]);
  return memo(key, () => {
    const out = [];
    for (const ys of yearSeries(ctx)) {
      const rows = rowsOf(ys.s);
      const base = { key: ys.key, label: ys.label, short: ys.short, kind: ys.kind, year: ys.year, run: ys.run, why: ys.why };
      if (!ys.usable || !rows.length) { out.push({ ...base, status: ys.why || 'no usable hours' }); continue; }
      const recs = rows.map(r => ({ timestamp: r.timestamp, price: r.price, dtHours: r.dtHours }));
      const prof = genProfile(ctx, recs, p.tech, p.mw, p.cf);
      if (prof.pending) return { pending: true };
      const st = settle(recs, prof.raw, p.loss, p.cap);
      if (st.g.errors.length) { out.push({ ...base, status: st.g.errors[0] }); continue; }
      const s = st.g.summary, n = s.hours / 8760, mwh = s.energyMWh / n;
      out.push({ ...base, status: 'included', hours: s.hours, n, capture: s.capturePrice, ratio: s.captureRatio,
        meanPrice: recs.reduce((t, r) => t + r.price * r.dtHours, 0) / s.hours, mwh, energy: s.merchantRevenue / n, rec: ok(p.recPrice) ? mwh * p.recPrice : null, capacity: p.capacity,
        negHours: st.neg.hours / n, negMWh: st.neg.mwh / n, negRev: st.neg.revenue / n, spill: st.spill / n, profile: prof.kind, profileNote: prof.note, totalRaw: s.merchantRevenue, mwhRaw: s.energyMWh });
    }
    return { rows: out };
  });
}

function tabRevenue(ctx) {
  const { S, data } = ctx, x = inputs(ctx);
  if (!x.res.summary) return noBasis(ctx);
  if (needSize(S)) return needSize(S);
  const p = revenueSetup(ctx), { tech, mw, cf, loss, cap, capRule, market, recPrice, recStream, capStream, capacity, capMW } = p;
  const g0 = gate(x.exportLimit, mw, 'Export');
  const prof = genProfile(ctx, x.records, tech, mw, cf);
  if (prof.pending) return `${basisStrip(ctx, x)}<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Loading the ISO-NE fleet wind shape</b><span>One read of fact_genfuel_hourly; cached after that.</span></div>`;
  const recs = x.records.map((r, i) => ({ ...r, generationMW: prof.raw[i] }));
  const st = settle(x.records, prof.raw, loss, cap), g = st.g;
  if (g.errors.length) return `<div class="notice error">${g.errors.map(esc).join(' ')}</div>`;
  const s = g.summary, n = x.yearsEq;
  const energy = s.merchantRevenue / n, mwh = s.energyMWh / n;
  const rec = ok(recPrice) ? mwh * recPrice : null;
  // F002: one labelled stack; the headline is its total and every surface prints its label (never an unlabelled sum).
  const stack = revenueStack({ energy, rec, capacity }, ['energy', 'rec'], { reasons: { rec: recStream.reason || 'REC price not held', capacity: capStream.reason || 'not held' }, conditional: { capacity: `conditional: capacity case not studied; ${capStream.regime || 'regime not held'}` } });
  const headline = stack.total;
  const spill = st.spill / n, neg = st.neg;
  const ry = revenueYears(ctx, p);
  const years = ry.pending ? [] : ry.rows, inc = years.filter(r => r.status === 'included');
  const path = inc.filter(r => r.kind === 'run' && PATH_RUNS.includes(r.run)).map(r => ({ y: r.year, v: r.energy + (r.rec ?? 0), kind: r.label, run: r.run }));
  S.ui.revenueOut = { busId: S.nodeId, tech: S.tech === 'hybrid' ? 'hybrid' : tech, ...stackHandoff(stack), kind: S.tech === 'hybrid' ? `PV ${stack.short} (no battery)` : `${tech} ${stack.short}`, mw, annual: headline, mwh, basis: describe(S.basis), hash: basisHash(S.basis), conditional: !g0.ok, proxy: tech === 'wind' && prof.kind === 'flat', path, capture: s.capturePrice, at: new Date().toISOString() };

  // Monthly (chronological months of the basis): revenue, MWh, capture vs average.
  const months = groupSum(st.clipped, r => String(r.timestamp).slice(0, 7), { rev: r => r.generationMW * r.dtHours * r.price, mwh: r => r.generationMW * r.dtHours, pw: r => r.price * r.dtHours, h: r => r.dtHours });
  const mLabel = k => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(k.slice(5, 7)) - 1]}${months.length > 12 ? ` ${k.slice(2, 4)}` : ''}`;

  // Sensitivity tornado on the basis (energy + RECs per year).
  const tor = memo(JSON.stringify(['tor', S.nodeId, basisHash(S.basis), tech, mw, cf, loss, cap, recPrice, prof.kind]), () => {
    const at = (cfv, lossv) => { const pr = genProfile(ctx, x.records, tech, mw, cfv); const t = settle(x.records, pr.raw, lossv, cap); return t.g.errors.length ? null : t.g.summary.merchantRevenue / n + (ok(recPrice) ? (t.g.summary.energyMWh / n) * recPrice : 0); };
    const cfR = RANGES[tech === 'wind' ? 'windCF' : 'solarCF'], lossHi = Math.min(15, loss + 3), lossLo = Math.max(0, loss - 3);
    const items = [
      { label: 'Capacity factor', low: { label: `${cfR[0]}%`, value: at(cfR[0] / 100, loss) }, high: { label: `${cfR[1]}%`, value: at(cfR[1] / 100, loss) }, src: cfR[2] },
      { label: 'Losses', low: { label: `${lossHi}%`, value: at(cf, lossHi) }, high: { label: `${lossLo}%`, value: at(cf, lossLo) }, src: 'base ± 3 points (placeholder has no cited range)' },
      ...(() => { const M = getRules().data?.recs_ma, d = M?.class1_price_default, acp = M?.class1_acp?.value; const lo = d?.low, hi = ok(d?.high) && ok(acp) ? Math.min(d.high, acp) : null; return ok(recPrice) && ok(lo) && ok(hi) ? [{ label: 'REC price', low: { label: `$${lo}`, value: energy + mwh * lo }, high: { label: `$${hi}${hi < d.high ? ' (ACP cap)' : ''}`, value: energy + mwh * hi }, src: `${d.src}; capped at the ACP (${M.class1_acp.src})` }] : [{ label: 'REC price', low: { label: 'not held', value: null }, high: { label: 'not held', value: null }, src: recStream.reason || 'not held' }]; })(),
      { label: 'Capacity (conditional)', low: { label: 'excluded', value: headline }, high: { label: ok(capacity) ? 'with capacity' : 'not held', value: ok(capacity) ? headline + capacity : null }, src: streamNote(capStream) },
    ];
    const pb = inc.filter(r => ok(r.energy));
    if (pb.length >= 2) { const lo = pb.reduce((a, b) => (b.energy + (b.rec ?? 0) < a.energy + (a.rec ?? 0) ? b : a)), hi = pb.reduce((a, b) => (b.energy + (b.rec ?? 0) > a.energy + (a.rec ?? 0) ? b : a)); items.push({ label: 'Price year / run', low: { label: lo.label, value: lo.energy + (lo.rec ?? 0) }, high: { label: hi.label, value: hi.energy + (hi.rec ?? 0) }, src: 'held settled years and forecast runs (same inputs)' }); }
    return { rows: tornado(headline, items), baseRerun: at(cf, loss) };
  });

  // Spill against size (counterpart of the Studio's "Curtailment against nameplate").
  const studio = getData('bench', S.nodeId);
  const sizes = [...new Set([25, 50, 100, 150, 250, 500, mw])].sort((a, b) => a - b);
  const spillSize = memo(JSON.stringify(['sp', S.nodeId, basisHash(S.basis), tech, mw, cf, loss, x.sentGrid, prof.kind]), () => sizes.map(sz => {
    const lim = sz === mw ? x.exportLimit : limitsFor(ctx, sz, 0).ex.value, cp = ok(lim) ? Math.min(sz, lim) : null;
    const after = st.afterLoss.reduce((t, r) => t + r.generationMW * (sz / mw) * r.dtHours, 0);
    const sp = cp == null ? null : st.afterLoss.reduce((t, r) => t + Math.max(0, r.generationMW * (sz / mw) - cp) * r.dtHours, 0);
    return { size: sz, limit: lim, cap: cp, after: after / n, spill: sp == null ? null : sp / n, pct: sp == null ? null : (100 * sp) / after };
  }));
  const sv = studio.state === 'ok' ? studio.data.studio?.values : null;
  const vendorRamp = sv ? [100, 250, 500, 1000].map(sz => ({ x: sz, y: sv[`${tech}_${sz}MW_2030`] })) : [];

  // KPIs
  const minY = inc.length ? inc.reduce((a, b) => (b.energy + (b.rec ?? 0) < a.energy + (a.rec ?? 0) ? b : a)) : null, maxY = inc.length ? inc.reduce((a, b) => (b.energy + (b.rec ?? 0) > a.energy + (a.rec ?? 0) ? b : a)) : null;
  const kpis = `<div class="kpis">
      ${kpi(g0.ok ? 'Revenue per year' : 'Revenue per year at the limit', fmt.money(headline), g0.ok ? '' : ' conditional', `${stack.short} · ${perKw(headline, mw)}/kW-yr · ${stack.label}`)}
      ${kpi(tech === 'solar' || prof.kind === 'fleet' ? `${tech === 'solar' ? 'Solar' : 'Wind'} capture price` : 'Average price (wind proxy)', fmt.price(s.capturePrice), '/MWh', prof.kind === 'flat' ? 'Not a capture price: flat proxy' : `Capture ratio ${ok(s.captureRatio) ? s.captureRatio.toFixed(3) : '—'} · ${prof.kind === 'fleet' ? 'fleet wind shape' : 'clear-sky shape'}`)}
      ${kpi('Energy delivered', `${fmt.int(mwh)} MWh`, '/yr', spill > 0.5 ? `${fmt.int(spill)} MWh/yr spilled at ${fmt.mw(cap)}` : tech === 'solar' ? 'Clipping not assessed: CF-scaled clear-sky shape peaks below nameplate' : `No spill at ${fmt.mw(cap)}`)}
      ${kpi('Sold below $0', `${fmt.int(neg.mwh / n)} MWh`, '/yr', `${fmt.int(neg.hours / n)} h/yr · ${fmt.money(neg.revenue / n)}/yr; self-curtailing avoids ${fmt.money(neg.uplift / n)}`)}
      ${kpi('Range across years & runs', minY ? `${fmt.money(minY.energy + (minY.rec ?? 0))} – ${fmt.money(maxY.energy + (maxY.rec ?? 0))}` : ry.pending ? 'loading' : 'not held', '', minY ? `${minY.label} → ${maxY.label} · ${inc.length} held` : 'No other held year or run', !minY)}
      ${kpi('Capacity (conditional)', fmt.money(capacity), ok(capacity) ? '/yr' : '', `${streamNote(capStream)} · ${capStream.src || ''} · not in the headline`, !ok(capacity))}
    </div>`;

  const bars = [{ label: 'Energy', value: energy }, { label: 'RECs', value: rec }, { label: 'Capacity (conditional)', value: capacity }];
  const yLabel = r => r.short;
  const yearChart = inc.length ? stacked(inc.map(r => ({ label: yLabel(r), values: [r.energy, r.rec, r.capacity] })), { series: ['Energy', 'RECs', 'Capacity (conditional)'], fmt: v => fmt.money(v), title: 'Revenue by stream, by year and run', height: 240 }) : `<div class="empty"><strong>${ry.pending ? 'Loading' : 'No other year or run held'}</strong>${ry.pending ? 'Waiting for the fleet profile.' : 'Only the basis is held for this bus.'}</div>`;
  const capChart = inc.length ? groupedBar(inc.map(r => ({ label: yLabel(r), values: [r.meanPrice, r.capture] })), { series: ['Time-average price', prof.kind === 'flat' ? 'Flat-proxy price' : 'Capture price'], fmt: v => `$${v.toFixed(0)}`, title: 'Capture price vs average price', height: 220 }) : '';
  const yearTable = table([
    { k: 'label', l: 'Year / run' }, { k: 'status', l: 'Status', f: v => (v === 'included' ? 'included' : v), wrap: true }, { k: 'hours', l: 'Hours', num: true, f: v => fmt.int(v) },
    { k: 'meanPrice', l: 'Avg $/MWh', num: true, f: v => (ok(v) ? fmt.price(v) : null) }, { k: 'capture', l: 'Capture $/MWh', num: true, f: v => (ok(v) ? fmt.price(v) : null) },
    { k: 'ratio', l: 'Ratio', num: true, f: v => (ok(v) ? v.toFixed(3) : null) }, { k: 'mwh', l: 'MWh/yr', num: true, f: v => (ok(v) ? fmt.int(v) : null) },
    { k: 'energy', l: 'Energy $/yr', num: true, f: v => (ok(v) ? fmt.money(v) : null) }, { k: 'rec', l: 'RECs $/yr', num: true, f: v => (ok(v) ? fmt.money(v) : null) },
    { k: 'negMWh', l: 'MWh < $0', num: true, f: v => (ok(v) ? fmt.int(v) : null) }, { k: 'negRev', l: '$ < $0', num: true, f: v => (ok(v) ? fmt.money(v) : null) },
    { k: 'spill', l: 'Spill MWh', num: true, f: v => (ok(v) ? fmt.int(v) : null) }, { k: 'profile', l: 'Shape' },
  ], years, { empty: 'No settled year or forecast run is held for this bus.' });
  const negChart = inc.length ? barChart(inc.map(r => ({ label: yLabel(r), value: r.negMWh, note: `${fmt.int(r.negHours)} h · ${fmt.money(r.negRev)} paid to deliver` })), { fmt: v => fmt.int(v), yLabel: 'MWh', title: 'Negative-price exposure by year (MWh)', height: 200 }) : '';
  const spillChart = lineChart([{ name: 'Spill at the connection limit (%)', points: spillSize.filter(r => ok(r.pct)).map(r => ({ x: r.size, y: r.pct })) }, ...(vendorRamp.some(p => ok(p.y)) ? [{ name: `Vendor ramp 2030 (%) · ${STUDIO_TAG}`, points: vendorRamp, dashed: true }] : [])], { fmt: v => `${v.toFixed(1)}%`, xfmt: v => `${v} MW`, title: 'Spill against project size', height: 200, emptyText: 'No connection limit is established at any size, so spill is not assessed.' });
  const monthChart = barChart(months.map(m => ({ label: mLabel(m.key), value: m.rev, note: `${fmt.int(m.mwh)} MWh · capture ${fmt.price(m.mwh ? m.rev / m.mwh : null)} vs ${fmt.price(m.h ? m.pw / m.h : null)}` })), { fmt: v => fmt.money(v), title: 'Monthly revenue (basis)', height: 200 });
  const monthCap = lineChart([{ name: 'Capture price', points: months.map((m, i) => ({ x: i, y: m.mwh ? m.rev / m.mwh : null })) }, { name: 'Average price', points: months.map((m, i) => ({ x: i, y: m.h ? m.pw / m.h : null })), dashed: true }], { fmt: v => `$${v.toFixed(0)}`, xfmt: i => (months[i] ? mLabel(months[i].key) : ''), title: 'Monthly capture vs average (basis)', height: 200 });
  const monthMwh = barChart(months.map(m => ({ label: mLabel(m.key), value: m.mwh })), { fmt: v => fmt.int(v), title: 'Monthly generation delivered (MWh)', height: 200 });

  // Data notes: unified DB vs Studio copy.
  const notes = dataNotesRevenue(ctx, tech, inc, studio);
  // Answer sentences (V6).
  const big = tor.rows[0];
  const ans = {
    asm: `Revenue rests on a ${B(`${val(S, tech === 'wind' ? 'windCF' : 'solarCF')}%`)} capacity factor and ${B(`${loss}%`)} losses; the REC price is ${ok(recPrice) ? B(`$${recPrice.toFixed(2)}/MWh`) : B('not held')} (${esc(market[1])}).`,
    stream: `This ${fmt.mw(mw)} ${tech} plant earns ${B(fmt.money(headline))}/yr: ${esc(stack.label)} (${B(`${perKw(headline, mw)}/kW-yr`)}).`,
    tor: big ? `${B(big.label)} moves revenue most: ${B(ok(big.lowValue) ? fmt.money(big.lowValue) : 'not held')} to ${B(ok(big.highValue) ? fmt.money(big.highValue) : 'not held')} a year.` : 'No sensitivity is held.',
    years: minY ? `The same plant earns ${B(fmt.money(minY.energy + (minY.rec ?? 0)))} (${esc(minY.label)}) to ${B(fmt.money(maxY.energy + (maxY.rec ?? 0)))} (${esc(maxY.label)}) across ${B(fmt.int(inc.length))} held years and runs.` : 'Only the basis is held for this bus.',
    cap: `On the basis the ${prof.kind === 'flat' ? 'flat proxy' : `${tech} shape`} captures ${B(fmt.price(s.capturePrice))}/MWh${ok(s.captureRatio) ? `, ${B(s.captureRatio.toFixed(3))} of the time-average price` : ''}.`,
    month: (() => { const h = months.filter(m => ok(m.rev)), hi = h.reduce((a, m) => (!a || m.rev > a.rev ? m : a), null), lo = h.reduce((a, m) => (!a || m.rev < a.rev ? m : a), null); return hi ? `${B(mLabel(hi.key))} earns most (${B(fmt.money(hi.rev))}) and ${B(mLabel(lo.key))} least (${B(fmt.money(lo.rev))}).` : 'No month on the basis.'; })(),
    gen: (() => { const hi = months.reduce((a, m) => (!a || m.mwh > a.mwh ? m : a), null); return hi ? `Output peaks in ${B(mLabel(hi.key))} at ${B(`${fmt.int(hi.mwh)} MWh`)}; ${B(`${fmt.int(mwh)} MWh`)} a year in total.` : 'No month on the basis.'; })(),
    mcap: (() => { const below = months.filter(m => m.mwh && m.h && m.rev / m.mwh < m.pw / m.h).length; return `Capture falls below the average price in ${B(`${below} of ${months.length}`)} months on the basis.`; })(),
    neg: `On the basis the plant delivers ${B(`${fmt.int(neg.mwh / n)} MWh`)} a year into prices below $0 (${B(`${fmt.int(neg.hours / n)} h`)}).`,
    spill: (() => { const r = spillSize.find(z => z.size === mw); return r && ok(r.pct) ? `At ${fmt.mw(mw)} ${B(`${r.pct.toFixed(1)}%`)} of output spills at the ${fmt.mw(r.cap)} connection limit.` : 'No connection limit is established at this size, so spill is not assessed.'; })(),
    detail: `${B(`${inc.length} of ${years.length}`)} held series are valued; the rest are listed with the reason.`,
  };

  const traces = traceCard(
    traceRevenue(S, x.node, x, { tech, mw, cf, loss, cap, capRule, stackLabel: stack.label, raw: recs, afterLoss: st.afterLoss, clipped: st.clipped, unclipped: prof.unclipped, profileLabel: prof.label, energy, mwh, rec, recPrice, recMarket: [recStream.regime, recStream.priceSrc || recStream.reason].filter(Boolean).join(' · '), capNote: streamNote(capStream), capSrc: capStream.src, capMW, capacity, headline, tags: { cf: tag(S, tech === 'wind' ? 'windCF' : 'solarCF'), loss: tag(S, 'lossPct'), rec: userRec(S) != null ? 'U' : 'A' }, srcs: { cf: tagTitle(S, tech === 'wind' ? 'windCF' : 'solarCF'), loss: tagTitle(S, 'lossPct') } }),
    inc.length ? traceRevYears(S, x.node, { years, tech, mw, cf, loss, cap, recPrice, basisEnergy: energy, basisHash: basisHash(S.basis) }) : '',
    traceNegPrice(S, x.node, x, { rows: st.clipped, neg, n, tech }),
    traceTornado(S, x.node, { rows: tor.rows, baseRerun: tor.baseRerun, base: headline, tech }),
    traceSpillSize(S, x.node, { rows: spillSize, mw, tech, headSpill: spill, afterLoss: st.afterLoss, n, vendor: vendorRamp, studioSrc: sv ? studio.data.sources.studio : null }),
    (() => { const fp = getData('profile', 'all'), rf = revenueFor(data, x.node, S.basis, tech, mw, { cf, lossPct: loss, exportLimit: x.exportLimit, fleet: fp.state === 'ok' ? fp.data : null }); const gaps = prof.kind === 'fleet' && (prof.filled || 0) > 0; const flatMismatch = tech === 'wind' && (rf.shape || 'flat') !== (prof.kind === 'fleet' ? 'fleet' : 'flat'); return traceRevFor(S, x.node, { tech, shape: prof.kind, cap, energy, other: rf.value, checkable: ok(rf.value) && !gaps && !flatMismatch, why: gaps ? `${prof.filled} short gaps in the fleet shape are interpolated here and not in revenueFor` : flatMismatch ? 'the two methods fell back to different wind shapes' : rf.reason || 'revenueFor returned no value' }); })());

  return `${basisStrip(ctx, x)}${g0.ok ? '' : `<div class="notice error" role="alert">${g0.msg}</div>`}
    ${tech === 'wind' && prof.kind === 'flat' ? `<div class="notice warn">No wind generation shape is held here (${esc(prof.note)}). Wind is shown as flat output at the entered capacity factor, so its "capture" is only the average price: a price proxy, not a wind capture price.</div>` : ''}
    ${tech === 'wind' && prof.kind === 'fleet' ? `<div class="notice">Wind uses the <b>ISO-NE fleet wind output shape</b> for each hour (${esc(prof.note)}), scaled to the entered capacity factor. It is a system-wide shape, not this site's wind.</div>` : ''}
    ${kpis}
    ${cards(
      tagged({ depth: 'review', chips: 'assumption' }, 4, 'Assumptions', 'A cited · P placeholder · U yours', `<div class="form-grid">
        ${slider(S, tech === 'wind' ? 'windCF' : 'solarCF', 'Capacity factor', '%', 5, 50, 0.5)}${slider(S, 'lossPct', 'Losses', '%', 0, 15, 0.5)}</div>
        ${moreCtl(`<div class="form-grid"><label class="field">REC price <span class="pill ${userRec(S) == null ? 'warn' : ''}">${userRec(S) == null ? 'not entered' : 'your entry'}</span><input type="number" step="any" data-act="econ" data-k="recUser" value="${userRec(S) ?? ''}" placeholder="not entered"><span class="audit-note">$/MWh · ${esc(recStream.regime || '')}; until entered: ${esc(recStream.priceSrc || recStream.reason || 'not held')}</span></label>
        <p class="audit-note">Capacity: ${esc(streamNote(capStream))}. Set the commercial operation year in Project finance; the price path is on the Capacity card.</p></div>`, userRec(S) != null)}`,
        { answer: ans.asm, foot: 'Hover a tag for its source. Capacity accreditation from the Studio assumption table (ext/75).' }),
      tagged({ depth: 'screen', trace: 'e-revenue', chips: 'assumption' }, 4, 'Revenue by stream', `${stack.short} in the headline · ${fmt.int(mwh)} MWh`, barChart(bars, { fmt: v => fmt.money(v), title: 'Revenue by stream', height: 200 }),
        { answer: ans.stream, foot: `<b>Headline = ${esc(stack.label)}.</b> <span class="pill warn">Accreditation method changing</span> Capacity is conditional: the capacity case is not studied.` }),
      contractCard(ctx, { rows: st.clipped, n, merchant: energy, mwh, stackLabel: stack.label, basisHub: hubSeriesFor(ctx) }),
      tagged({ answer: ans.tor, depth: 'review', trace: 'e-tornado', chips: 'assumption' }, 4, 'Sensitivity tornado', 'revenue per year · energy + RECs', tornadoChart(tor.rows.map(r => ({ ...r, lowLabel: r.low.label, highLabel: r.high.label })), headline, { fmt: v => fmt.money(v), title: 'Revenue sensitivity', unit: '$/yr' }), { foot: 'Low/high cases: Studio assumption table (ext/75); price years from the unified DB.' }),
      tagged({ answer: ans.years, depth: 'review', trace: 'e-rev-years', chips: 'modelled assumption' }, 8, 'Revenue by year and forecast run', 'same size, CF, losses and limit on every held year and run', yearChart, { foot: `Energy measured on each series' hourly prices (unified DB); RECs and capacity are assumptions. ${ry.pending ? '' : `${inc.length} of ${years.length} held series included.`}` }),
      tagged({ answer: ans.cap, depth: 'review', trace: 'e-rev-years', chips: 'modelled' }, 4, 'Capture vs average price', 'shape-weighted vs time-weighted', capChart || '<div class="empty"><strong>Not held</strong>No other year or run.</div>', { foot: prof.kind === 'flat' ? 'Flat proxy: the "capture" equals the average.' : 'Capture = Σ MWh × price ÷ Σ MWh.' }),
      card(4, 'Monthly revenue', esc(describe(S.basis)), monthChart, { answer: ans.month }),
      card(4, 'Monthly generation', 'delivered MWh after losses and the cap', monthMwh, { answer: ans.gen }),
      card(4, 'Monthly capture vs average', 'same months', monthCap, { answer: ans.mcap }),
      tagged({ answer: ans.neg, depth: 'review', trace: 'e-negprice' }, 6, 'Negative-price exposure', 'MWh delivered while the price is below $0', negChart || '<div class="empty"><strong>Not held</strong>No other year or run.</div>', { foot: 'Self-curtailing in those hours would avoid the loss (a merchant option; a PPA or REC contract may forbid it).' }),
      tagged({ answer: ans.spill, depth: 'review', trace: 'e-spill-size', chips: 'studio-copy' }, 6, 'Spill against project size', 'counterpart of the Studio\'s curtailment against nameplate', spillChart, { foot: `Spill = energy above the Grid export limit at each size (unified limits). Vendor ramp: ${STUDIO_TAG}, 2030, not screened; the unified DB excludes it.` }),
      tagged({ answer: ans.detail, depth: 'study' }, 12, 'Revenue by year: detail', 'every held settled year and forecast run', yearTable),
      s4Cards(ctx, { tech, mw: capMW, mwh, energy, energyLabel: `energy on ${describe(S.basis)} (Economics › Revenue)` }),
      notes,
    )}
    <div class="handoff"><div><strong>Use this revenue in Project finance</strong><p>Sends ${fmt.money(headline)}/yr (${esc(stack.label)}) and ${fmt.int(mwh)} MWh/yr for this bus, size and price basis${g0.ok ? '' : ' (marked conditional)'}${path.length ? `, plus the forecast-run path (${path.map(p => p.y).join(', ')})` : ''}.</p></div><button class="primary" data-act="handoff-revenue">Use this revenue in Finance</button></div>
    ${cards(traces)}
    ${nextStep('send this revenue and test the cash flows in Economics › Project finance', 'economics', 'finance')}`;
}

function dataNotesRevenue(ctx, tech, inc, studio) {
  if (studio.state !== 'ok') return tagged({ depth: 'study', chips: 'studio-copy' }, 12, 'Data notes', 'unified DB vs Studio copy', `<p class="audit-note">${esc(waitText(studio, 'the comparison data'))}</p>`);
  const b = studio.data, sv = b.studio?.values || {};
  const y25 = b.year.find(r => r.market === 'RT' && r.y === 2025), f30 = b.fcstYear.find(r => r.scenario === 'pcr2030'), r30 = inc.find(r => r.run === 'pcr2030');
  const rows = [
    { q: 'Average price 2025 RT ($/MWh)', u: y25?.avg_lmp, s: sv.lmp_2025, us: 'mart_bus_year', ss: 'lmp_2025' },
    { q: 'Average price 2030 ($/MWh)', u: f30?.avg_lmp, s: sv.lmp_2030, us: 'mart_bus_fcst_year pcr2030', ss: 'lmp_2030' },
    { q: `${tech === 'wind' ? 'Wind' : 'Solar'} capture ratio 2030`, u: r30?.profile === 'flat' ? null : r30?.ratio, s: sv[`${tech}_cap_2030`], us: `this page, pcr2030 run, ${r30?.profile || '—'} shape`, ss: `${tech}_cap_2030 (vendor ratio)` },
    { q: 'Hours below $0, 2025 RT', u: y25?.neg_hours, s: sv.hneg_2025, us: 'mart_bus_year', ss: 'hneg_2025' },
    { q: 'Hours above $200, 2025 RT', u: y25?.hours_gt_200, s: sv.h200_2025, us: 'mart_bus_year', ss: 'h200_2025' },
    { q: 'Average price 2050 ($/MWh)', u: null, s: sv.lmp_2050, us: 'not loaded: vendor 2040 × 1.0816 escalation (data_quality)', ss: 'lmp_2050' },
  ].map(r => ({ ...r, d: ok(r.u) && ok(r.s) ? r.u - r.s : null }));
  const f = v => (ok(v) ? (Number.isInteger(v) ? fmt.int(v) : Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(2)) : null);
  const nd = rows.filter(r => ok(r.d)), big = nd.reduce((a, r) => (!a || Math.abs(r.d) > Math.abs(a.d) ? r : a), null);
  const answer = big ? `${B(`${nd.length}`)} quantities can be compared; the largest gap is ${B(big.q)} (unified ${B(f(big.u))} vs Studio ${B(f(big.s))}).` : 'No quantity is held in both the unified database and the Studio copy.';
  return tagged({ depth: 'study', chips: 'studio-copy', answer }, 12, 'Data notes: unified DB vs Studio copy', 'the unified DB is primary; differences shown, never blended', table([
    { k: 'q', l: 'Quantity' }, { k: 'u', l: 'Unified DB', num: true, f }, { k: 'us', l: 'Unified source', wrap: true }, { k: 's', l: STUDIO_TAG, num: true, f }, { k: 'ss', l: 'Studio field' }, { k: 'd', l: 'Difference', num: true, f },
  ], rows), { foot: `${esc(b.studio?.source || '')} · built ${esc(b.studio?.builtAt || '')}. Curtailment by size in the Studio copy is a vendor ramp (not screened) and is not used here.` });
}

// ---------- Tab 2: BESS dispatch ----------
/** Battery dispatch on a grid sized to the limits (dispatchgrid.js), solved in the background. {pending} while solving. */
/** The rules file's summer-peak hour set for the charge screen (Lead wiring W1), as {months, heFrom, heTo}, or null. */
const peakWindow = () => windowFromRules(getRules().data?.interconnection?.storage_charge_screen?.peak_window);
/** F008: per-hour charge caps for this bus and size (economics-charge.js), memoised. */
function chargePlan(ctx, mw, x) {
  const { S, data } = ctx, win = peakWindow();
  return memo(JSON.stringify(['cplan', basisHash(S.basis), S.nodeId, mw, x.importLimit, x.chargeEnvelopeOnly, win]), () => {
    const lim = chargeLimits(data.grid, S.nodeId, mw);
    return { ...chargeCaps(x.records, { nameplate: mw, shoulder: { value: x.importLimit, envelopeOnly: x.chargeEnvelopeOnly }, peak: lim.peak, window: win }), limits: lim, window: win };
  });
}
/** mode 'governing' (default: shoulder cap + the summer-peak screening cap) or 'shoulder' (shoulder cap only, for comparison). */
function battery(ctx, mw, hours, x, rte = val(ctx.S, 'rte'), cycleCost = val(ctx.S, 'cycleCost'), mode = 'governing') {
  const S = ctx.S, eta = Math.sqrt(rte / 100);
  const plan = chargePlan(ctx, mw, x), useCaps = mode === 'governing' && plan.applied;
  const chargeCap = plan.capOther, exportCap = ok(x.exportLimit) ? Math.min(mw, x.exportLimit) : mw;
  const tight = useCaps ? plan.capPeak : chargeCap; // the SOC grid makes the tightest per-hour charge limit exact
  const dt = Math.min(...x.records.map(r => r.dtHours)); // F4: size to the finest interval
  const grid = dispatchGrid({ energyMWh: mw * hours, chargeMW: tight, dischargeMW: mw, exportMW: exportCap, etaC: eta, etaD: eta, dtHours: dt, hours: x.res.summary.hours });
  if (!grid.feasible) return { errors: [grid.reason], summary: {}, rows: [], notAssessed: true, grid, plan };
  const k = JSON.stringify(['bess', basisHash(S.basis), S.nodeId, mw, hours, chargeCap, useCaps ? plan.capPeak : null, useCaps ? plan.window : null, exportCap, rte, cycleCost, grid.stepMWh]);
  const recs = useCaps ? x.records.map((r, i) => ({ ...r, chargeCapMW: plan.caps[i] })) : x.records;
  const r = solve('battery', k, recs, { capacityMW: mw, energyMWh: mw * hours, chargeMW: chargeCap, importMW: chargeCap, exportMW: exportCap, chargeEfficiency: eta, dischargeEfficiency: eta, cycleCostPerMWh: cycleCost, stepMWh: grid.stepMWh });
  return r ? { ...r, grid, plan } : { pending: true, grid, errors: [], plan };
}
const solvingPanel = (x, what, grid) => `<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Optimising ${what} over ${fmt.int(x.res.summary?.hours)} hours</b><span>Runs in the background on ${fmt.int(grid?.states)} state-of-charge steps (about ${Math.max(1, Math.round(grid?.estSeconds || 1))} s); the page stays usable and updates when it finishes.</span></div>`;

/** Spread benchmark rows: settled TB (mart), forecast TB (computed from the runs), Studio copy, at the chosen duration. */
function spreadRows(b, dur, mw, rte) {
  const out = [], cyc = 365, ben = sp => spreadBenchmark({ mw, dur, spread: sp, cycles: cyc, rte: rte / 100 });
  for (const r of b.tbHist) { const sp = spreadAt({ 2: r.tb2, 4: r.tb4, 8: r.tb8 }, dur); out.push({ src: `Settled ${r.market}`, label: `${r.y} ${r.market}`, y: r.y, days: r.n_days, tb2: r.tb2, tb4: r.tb4, tb8: r.tb8, p10: r.tb4_p10, p90: r.tb4_p90, sp, bench: ben(sp), kind: 'settled', market: r.market, _cls: r.n_days < 300 ? 'muted' : '' }); }
  for (const r of b.tbFcst) { const sp = spreadAt({ 2: r.tb2, 4: r.tb4, 8: r.tb8 }, dur); out.push({ src: 'Forecast run', label: RUN_LABEL[r.scenario] || r.scenario, y: r.y, run: r.scenario, days: r.n_days, tb2: r.tb2, tb4: r.tb4, tb8: r.tb8, p10: r.tb4_p10, p90: r.tb4_p90, sp, bench: ben(sp), kind: 'run' }); }
  const v = b.studio?.values;
  if (v) {
    const s30 = spreadAt({ 2: v.tb2_2030, 4: v.tb4_2030, 8: v.tb8_2030 }, dur);
    out.push({ src: STUDIO_TAG, label: '2030 published', y: 2030, tb2: v.tb2_2030, tb4: v.tb4_2030, tb8: v.tb8_2030, sp: s30, bench: ben(s30), kind: 'studio' });
    for (const y of [2035, 2050]) { const t4 = v[`tb4_${y}`], sp = ok(t4) && ok(v.tb4_2030) && ok(s30) ? (t4 * s30) / v.tb4_2030 : ok(t4) && dur === 4 ? t4 : null; out.push({ src: STUDIO_TAG, label: `${y} published${y === 2050 ? ' (escalated)' : ''}`, y, tb4: t4, sp, bench: ben(sp), kind: 'studio' }); }
  }
  const rank = r => (r.kind === 'settled' && r.market === 'RT' ? 0 : r.kind === 'run' ? 1 : r.kind === 'studio' ? 2 : 3);
  return out.map((r, i) => ({ r, i })).sort((a, b) => rank(a.r) - rank(b.r) || a.i - b.i).map(z => z.r);
}

function tabBess(ctx) {
  const { S } = ctx, x = inputs(ctx);
  if (!x.res.summary) return noBasis(ctx);
  if (needSize(S)) return needSize(S);
  const mw = Number(S.exportMW), dur = val(S, 'duration'), rte = val(S, 'rte');
  const gc = gate(x.importLimit, mw, 'Charging'), ge = gate(x.exportLimit, mw, 'Export');
  const b = battery(ctx, mw, dur, x);
  if (b.pending) return `${basisStrip(ctx, x)}${solvingPanel(x, `a ${fmt.mw(mw)} / ${fmt.int(mw * dur)} MWh battery`, b.grid)}`;
  if (b.errors.length) return `${basisStrip(ctx, x)}<div class="notice error" role="alert">${b.errors.map(esc).join(' ')}</div>`;
  const plan = b.plan, bSh = plan.applied ? battery(ctx, mw, dur, x, rte, val(S, 'cycleCost'), 'shoulder') : null;
  const shVal = bSh && !bSh.pending && !bSh.errors.length ? bSh.summary.netValue / x.yearsEq : null;
  const n = x.yearsEq, s = b.summary, cond = !gc.ok || !ge.ok || x.chargeEnvelopeOnly || plan.conditional, eta = Math.sqrt(rte / 100), E = mw * dur;
  const idleHours = b.rows.filter(r => !(r.chargeMW > 1e-6) && !(r.dischargeMW > 1e-6)).reduce((t, r) => t + r.dtHours, 0) / n;
  const reg = mw * (val(S, 'regShare') / 100) * val(S, 'regPrice') * idleHours;
  const s4In = { tech: 'storage', mw: Math.min(mw, ok(x.exportLimit) ? x.exportLimit : mw), durationH: dur, energy: s.netValue / n, energyLabel: 'perfect-foresight dispatch on the basis (Economics › BESS dispatch)', cpsRows: cpsRowsOf(b.rows) };
  const capStream = s4Streams(ctx, s4In).capacity, capacity = capStream.value;
  const days = s.hours / 24;
  const weeks = Math.max(1, Math.floor(b.rows.length / 168)), wk = Math.min(weeks, Math.max(1, Number(S.ui.week) || 1)), w0 = (wk - 1) * 168;
  const wkRows = b.rows.slice(w0, w0 + 168);
  const soc = wkRows.map((r, i) => ({ x: i, y: r.socEndMWh })), price = wkRows.map((r, i) => ({ x: i, y: r.price })), flow = wkRows.map((r, i) => ({ x: i, y: r.dischargeMW - r.chargeMW }));
  const wkStart = String(b.rows[w0]?.timestamp || '').slice(0, 10);
  const xf = v => { const ts = String(b.rows[w0 + v]?.timestamp || ''); return ts ? new Date(ts.slice(0, 10) + 'T12:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) + (v % 24 ? ' ' + ts.slice(11, 16) : '') : ''; };
  const durations = [2, 4, 8].map(d => { const r = battery(ctx, mw, d, x); return { label: `${d}-hour`, value: r.pending || r.errors.length ? null : r.summary.netValue / n / (mw * 1000), note: r.pending ? 'solving…' : r.errors[0] || '' }; });
  const rtes = [80, 86, 92].map(e => { const r = battery(ctx, mw, dur, x, e); return { label: `${e}%`, value: r.pending || r.errors.length ? null : r.summary.netValue / n / (mw * 1000), note: r.pending ? 'solving…' : r.errors[0] || '' }; });
  // S5 Lead wiring 3: the handoff carries MWh discharged and the charging bill so after-tax finance can compute an LCOS.
  S.ui.revenueOutBess = { busId: S.nodeId, tech: 'storage', mw, annual: s.netValue / n, ...storageHandoffExtras(b.rows, s, n), basis: describe(S.basis), hash: basisHash(S.basis), conditional: cond, at: new Date().toISOString() };
  const chargeNote = `<div class="notice ${gc.ok ? '' : ok(x.importLimit) ? 'warn' : 'error'}" data-charge-cap="${esc(plan.applied ? plan.capPeak : plan.capOther)}">${gc.ok ? '' : `${gc.msg} `}<b>Charge cap.</b> ${esc(plan.governing)}${plan.note ? ` ${esc(plan.note)}` : ''}${plan.applied ? ` ${fmt.int(plan.peakHours)} basis hours are summer-peak hours; the summer-peak withdrawal limit is not an ISO-NE storage study condition (PP5-6 §9), so it is a screening cap: value at the governing caps ${esc(fmt.money(s.netValue / n))}/yr vs ${esc(ok(shVal) ? fmt.money(shVal) : bSh?.pending ? 'solving…' : 'not held')}/yr on the shoulder cap alone.` : ''}</div>`;

  // Monthly value and cycles.
  const months = groupSum(b.rows, r => String(r.timestamp).slice(0, 7), { value: r => r.netValue, dis: r => r.dischargeMW * r.dtHours, buy: r => r.importMW * r.price * r.dtHours, sell: r => r.exportMW * r.price * r.dtHours });
  const cyc = dailyCycles(b.rows, E, eta);
  const cycVals = cyc.map(d => d.cycles), over1 = cycVals.filter(c => c > 1 + 1e-9).length;

  // Spread benchmarks and reserves (unified DB via api_economics).
  const bench = getData('bench', S.nodeId), resv = getData('reserves', S.nodeId);
  const sRows = bench.state === 'ok' ? spreadRows(bench.data, dur, mw, rte) : [];
  // Browser recompute of the basis TB at the battery's duration (Prices › dailySpreads), to set against the database figure.
  const basisDays = Number.isInteger(dur) ? dailySpreads(x.res.rows, dur) : [];
  const basisTb = basisDays.length ? basisDays.reduce((t, d) => t + d.spread, 0) / basisDays.length : null;
  const benchBasis = spreadBenchmark({ mw, dur, spread: basisTb, cycles: 365, rte: rte / 100 });
  const reserve = resv.state === 'ok' ? [0, 1, 2].map(i => ({ product: resv.data.products[i], ...reserveValue(b.rows, k => resv.data.hours[k]?.[i] ?? null, mw) })) : null;
  const matched = reserve?.[0]?.matched || 0;

  const kpis = `<div class="kpis">
      ${kpi(ge.ok ? 'Arbitrage value' : 'Arbitrage value at the limit', fmt.money(s.netValue / n), cond ? '/yr conditional' : '/yr', `${perKw(s.netValue / n, mw)}/kW-yr · perfect-foresight ceiling${val(S, 'cycleCost') === 0 ? ', free cycling' : ''}`)}
      ${kpi('Equivalent cycles', (s.equivalentCycles / n).toFixed(0), '/yr', `${(s.equivalentCycles / days).toFixed(2)} per day (cited planning basis: 1.0/day) · ${over1} days above 1`)}
      ${kpi('Energy discharged', `${fmt.int(s.energyDischargedMWh / n)} MWh`, '/yr', `Charged ${fmt.int(s.energyChargedMWh / n)} MWh · round trip ${rte}%`)}
      ${kpi('Dispatch ÷ spread benchmark', ok(benchBasis) && benchBasis > 0 ? `${(100 * (s.netValue / n) / benchBasis).toFixed(0)}%` : 'not held', '', ok(benchBasis) ? `TB${dur} benchmark ${fmt.money(benchBasis)}/yr (1 cycle/day × RTE) on the basis` : 'TB needs a whole-hour duration and full days', !ok(benchBasis))}
      ${kpi('Reserve opportunity (idle hours)', reserve && matched ? fmt.money((reserve[0].idleValue * 8760) / matched) : 'not held', reserve && matched ? '/yr' : '', reserve && matched ? `TMSR, ${fmt.int(matched)} basis hours priced · not additive` : resv.state === 'ok' ? 'Reserve prices held 2023-07 to 2026-07: no basis hour overlaps' : waitText(resv, 'reserve prices'), !(reserve && matched))}
      ${kpi('Capacity (conditional)', fmt.money(capacity), ok(capacity) ? '/yr' : '', `${streamNote(capStream)} · not in the headline`, !ok(capacity))}
    </div>`;

  const sChart = sRows.length ? barChart(sRows.filter(r => ok(r.bench) && (r.kind !== 'settled' || r.market === 'RT')).map(r => ({ label: r.kind === 'run' ? r.label.split(' · ')[0] + (r.run === '10yr' ? ' 10y' : r.run === '5yr' ? ' 5y' : '') : r.kind === 'studio' ? `${r.y} St` : String(r.y), value: r.bench / (mw * 1000), note: `${r.src} · TB${dur} ${fmt.price(r.sp)}` })), { fmt: v => `$${v.toFixed(0)}`, title: 'Spread benchmark by year ($/kW-yr)', height: 220 }) : `<div class="empty"><strong>${esc(waitText(bench, 'spread benchmarks'))}</strong></div>`;
  const sTable = sRows.length ? table([
    { k: 'src', l: 'Source' }, { k: 'label', l: 'Year / run' }, { k: 'days', l: 'Days', num: true, f: v => (ok(v) ? fmt.int(v) : null) },
    { k: 'tb2', l: 'TB2', num: true, f: v => (ok(v) ? fmt.price(v) : null) }, { k: 'tb4', l: 'TB4', num: true, f: v => (ok(v) ? fmt.price(v) : null) }, { k: 'tb8', l: 'TB8', num: true, f: v => (ok(v) ? fmt.price(v) : null) },
    { k: 'p10', l: 'TB4 P10–P90', num: true, f: (v, r) => (ok(v) && ok(r.p90) ? `${fmt.price(v)} – ${fmt.price(r.p90)}` : null) },
    { k: 'sp', l: `TB at ${dur} h`, num: true, f: v => (ok(v) ? fmt.price(v) : null) }, { k: 'bench', l: 'Benchmark $/kW-yr', num: true, f: v => (ok(v) ? `$${(v / (mw * 1000)).toFixed(1)}` : null) },
  ], sRows) : '';
  const resTable = reserve ? table([
    { k: 'product', l: 'Product' }, { k: 'matched', l: 'Basis hours priced', num: true, f: v => fmt.int(v) }, { k: 'idleMatched', l: 'Idle hours priced', num: true, f: v => fmt.int(v) },
    { k: 'idleValue', l: 'Idle-hour value / yr', num: true, f: (v, r) => (r.matched ? fmt.money((v * 8760) / r.matched) : null) }, { k: 'allValue', l: 'All-hour ceiling / yr', num: true, f: (v, r) => (r.matched ? fmt.money((v * 8760) / r.matched) : null) },
  ], reserve) : `<p class="audit-note">${esc(waitText(resv, 'reserve prices'))}</p>`;
  const resAnnual = bench.state === 'ok' && bench.data.reserves.length ? groupedBar([...new Set(bench.data.reserves.map(r => r.y))].map(y => ({ label: String(y), values: ['TMSR', 'TMNSR', 'TMOR'].map(p => bench.data.reserves.find(r => r.y === y && r.product === p)?.mean_price ?? null) })), { series: ['TMSR (10-min spin)', 'TMNSR (10-min non-spin)', 'TMOR (30-min)'], fmt: v => `$${v.toFixed(2)}`, title: `Reserve prices, zone ${bench.data.reserveZone} ($/MW-h)`, height: 200 }) : '';
  const traces = traceCard(
    traceBess(S, x.node, x, { b, mw, dur, chargeBasis: `${x.chargeBasis || ''} · ${b.plan.governing}`, rte, cycleCost: val(S, 'cycleCost'), chargeCap: ok(x.importLimit) ? Math.min(mw, x.importLimit) : mw, exportCap: ok(x.exportLimit) ? Math.min(mw, x.exportLimit) : mw, tags: { dur: tag(S, 'duration'), rte: tag(S, 'rte'), cyc: tag(S, 'cycleCost') }, srcs: { dur: tagTitle(S, 'duration'), rte: tagTitle(S, 'rte'), cyc: tagTitle(S, 'cycleCost') } }),
    traceBessMonths(S, x.node, { months, total: s.netValue, n, cyc, E, eta }),
    bench.state === 'ok' ? traceSpread(S, x.node, { rows: sRows, dur, mw, rte, basisTb, basisDays, basis: S.basis, bench: bench.data, dispatch: s.netValue / n, benchBasis }) : '',
    reserve ? traceReserves(S, x.node, { reserve, mw, zone: resv.data.zone, src: resv.data.source, rows: b.rows, hoursMap: resv.data.hours }) : '');

  // Answer sentences (V6).
  const best = arr => arr.filter(d => ok(d.value)).reduce((a, d) => (!a || d.value > a.value ? d : a), null);
  const dBest = best(durations), rBest = best(rtes), mHi = months.filter(m => ok(m.value)).reduce((a, m) => (!a || m.value > a.value ? m : a), null);
  const sR = sRows.filter(r => ok(r.bench) && r.kind === 'settled' && r.market === 'RT').at(-1);
  const wkDis = wkRows.reduce((t, r) => t + r.dischargeMW * r.dtHours, 0);
  const ans = {
    batt: `A ${B(`${fmt.mw(mw)} × ${dur} h`)} battery at ${B(`${rte}%`)} round trip earns ${B(fmt.money(s.netValue / n))}/yr of arbitrage on the basis (perfect foresight).`,
    dur: dBest ? `${B(dBest.label)} earns most per kW of power, ${B(`$${dBest.value.toFixed(0)}/kW-yr`)}.` : 'Other durations are still solving.',
    rte: rBest && rtes.every(r => ok(r.value)) ? `Raising round trip from 80% to 92% moves value from ${B(`$${rtes[0].value.toFixed(0)}`)} to ${B(`$${rtes[2].value.toFixed(0)}/kW-yr`)}.` : 'Other efficiencies are still solving.',
    week: `In week ${wk} the battery discharges ${B(`${fmt.int(wkDis)} MWh`)}; prices ran ${B(fmt.price(Math.min(...price.map(p => p.y))))} to ${B(fmt.price(Math.max(...price.map(p => p.y))))}/MWh.`,
    cyc: `The optimal schedule averages ${B((cycVals.reduce((a, c) => a + c, 0) / (cycVals.length || 1)).toFixed(2))} cycles a day; ${B(fmt.int(over1))} days exceed one.`,
    month: mHi ? `${B(mHi.key)} is the best month at ${B(fmt.money(mHi.value))}.` : 'No month on the basis.',
    spread: sR ? `In ${sR.y} settled real time the TB${dur} benchmark was ${B(`$${(sR.bench / (mw * 1000)).toFixed(0)}/kW-yr`)}; this dispatch keeps ${B(ok(benchBasis) && benchBasis > 0 ? `${(100 * (s.netValue / n) / benchBasis).toFixed(0)}%` : 'not held')} of the basis benchmark.` : bench.state === 'ok' ? 'No settled real-time benchmark is held.' : '',
    resv: reserve && matched ? `Offering the idle hours as TMSR would be worth about ${B(fmt.money((reserve[0].idleValue * 8760) / matched))}/yr, not added to arbitrage.` : 'No basis hour has a held reserve price.',
    resy: bench.state === 'ok' && bench.data.reserves.length ? `Reserve prices are held for ${B(fmt.int(new Set(bench.data.reserves.map(r => r.y)).size))} years in zone ${esc(bench.data.reserveZone)}.` : '',
  };
  const wkChart = (name, pts, fmtv, title) => lineChart([{ name, points: pts }], { fmt: fmtv, xfmt: xf, xTicks: [0, 24, 48, 72, 96, 120, 144], title, height: 110 });
  return `${basisStrip(ctx, x)}${chargeNote}${ge.ok ? '' : `<div class="notice error">${ge.msg}</div>`}
    ${kpis}
    ${cards(
      tagged({ depth: 'review', chips: 'assumption' }, 4, 'Battery', `${fmt.mw(mw)} × ${dur} h = ${fmt.int(E)} MWh`, `<div class="form-grid">${slider(S, 'duration', 'Duration', 'hours', 1, 8, 1, false)}${slider(S, 'rte', 'Round-trip efficiency', '%', 70, 95, 1, false)}</div>${moreCtl(`<div class="form-grid">${slider(S, 'cycleCost', 'Cycling cost', '$/MWh discharged', 0, 50, 1, false)}</div>`, tag(S, 'cycleCost') === 'U')}`,
        { answer: ans.batt, foot: `Charge ≤ ${fmt.mw(ok(x.importLimit) ? Math.min(mw, x.importLimit) : mw)}, export ≤ ${fmt.mw(ok(x.exportLimit) ? Math.min(mw, x.exportLimit) : mw)}. Solved on ${fmt.int(b.grid.states)} SOC steps of ${b.grid.stepMWh.toFixed(2)} MWh: usable ${fmt.mw(b.grid.usableChargeMW)} charging and ${fmt.mw(b.grid.usableDischargeMW)} discharging, so value can be understated by up to ${Math.max(0, 100 - 100 * Math.min(b.grid.usableChargeMW / (ok(x.importLimit) ? Math.min(mw, x.importLimit) : mw), b.grid.usableDischargeMW / Math.min(mw, ok(x.exportLimit) ? x.exportLimit : mw))).toFixed(1)}%.` }),
      tagged({ depth: 'review' }, 4, 'Value by duration', 'same prices and limits; energy changes', barChart(durations, { fmt: v => `$${v.toFixed(0)}`, yLabel: '$/kW-yr', title: 'Arbitrage value by duration', height: 200 }), { answer: ans.dur, foot: durations.some(d => d.note === 'solving…') ? 'Other durations are still solving.' : 'Perfect-foresight dispatch at each duration.' }),
      tagged({ depth: 'study', chips: 'assumption' }, 4, 'Value by round-trip efficiency', `${dur}-hour battery`, barChart(rtes, { fmt: v => `$${v.toFixed(0)}`, yLabel: '$/kW-yr', title: 'Arbitrage value by RTE', height: 200 }), { answer: ans.rte, foot: rtes.some(d => d.note === 'solving…') ? 'Other efficiencies are still solving.' : '86% is the cited ORTP battery value.' }),
      tagged({ depth: 'study' }, 8, `Dispatch week ${wk} of ${weeks}`, `from ${wkStart} · price, state of charge and net discharge, one unit per panel`, `<div class="week-bar"><span>Week</span><input type="range" min="1" max="${weeks}" step="1" value="${wk}" data-act="ui" data-k="week" data-live aria-label="Dispatch week"><output>${wk}</output></div>
        ${wkChart('Price ($/MWh)', price, v => `$${v.toFixed(0)}`, 'Price, $/MWh')}${wkChart('State of charge (MWh)', soc, v => `${v.toFixed(0)} MWh`, 'State of charge, MWh')}${wkChart('Net discharge (MW)', flow, v => `${v.toFixed(0)} MW`, 'Net discharge, MW (− = charging)')}`, { tall: false, answer: ans.week }),
      card(4, 'Cycles per day', `${cyc.length} days · mean ${(cycVals.reduce((a, c) => a + c, 0) / (cycVals.length || 1)).toFixed(2)}`, histo(cycVals, { bins: 10, fmt: v => v.toFixed(2), title: 'Equivalent cycles per day', height: 240 }), { answer: ans.cyc, foot: `${over1} days exceed one full cycle (typical warranty basis 1/day).` }),
      tagged({ answer: ans.month, depth: 'screen', trace: 'e-bess-months' }, 6, 'Monthly arbitrage value', 'net value of the optimal schedule by month', barChart(months.map(m => ({ label: m.key.slice(2), value: m.value, note: `sold ${fmt.money(m.sell)} · bought ${fmt.money(m.buy)} · ${fmt.int(m.dis)} MWh out` })), { fmt: v => fmt.money(v), title: 'Monthly arbitrage value', height: 210 })),
      tagged({ depth: 'review', trace: 'e-spread', chips: 'studio-copy' }, 6, 'Spread benchmark by year', `TB${dur} × ${fmt.int(E)} MWh × 365 × ${rte}% ÷ kW · history, runs, Studio copy`, sChart, { answer: ans.spread, foot: 'Benchmarks, not dispatch. "St" = Studio copy (older database), published annual spreads.' }),
      tagged({ depth: 'study', chips: 'studio-copy', answer: `${B(fmt.int(sRows.length))} benchmark rows: ${B(fmt.int(sRows.filter(r => r.kind === 'settled').length))} settled, ${B(fmt.int(sRows.filter(r => r.kind === 'run').length))} solved runs and ${B(fmt.int(sRows.filter(r => r.kind === 'studio').length))} Studio copy.` }, 12, 'Spread benchmarks', 'settled (mart_bus_tb) · forecast (computed from each run) · Studio copy (vendor)', sTable || `<p class="audit-note">${esc(waitText(bench, 'spread benchmarks'))}</p>`,
        { foot: 'TBk = daily mean of the top-k hourly prices minus the bottom-k, averaged over days. Greyed rows are partial years (< 300 days).' }),
      tagged({ depth: 'review', trace: 'e-reserves', chips: 'assumption' }, 6, 'Ancillary opportunity: reserves', `real-time reserve prices, zone ${esc(resv.data?.zone || '…')}`, resTable, { answer: ans.resv, foot: `Offered MW = full power in idle hours; SOC sufficiency and eligibility not checked. Not added to arbitrage (same battery). Regulation not held in the DB: at ${val(S, 'regShare')}% × $${val(S, 'regPrice')}/MW-h (ext/75 assumption) about ${esc(fmt.money(reg))}/yr in ${fmt.int(idleHours)} idle hours.` }),
      tagged({ answer: ans.resy, depth: 'study' }, 6, 'Reserve prices by year', 'mean of hourly prices (unified fact_as_price_hourly)', resAnnual || `<p class="audit-note">${esc(waitText(bench, 'reserve prices'))}</p>`),
      s4Cards(ctx, s4In),
    )}
    <div class="handoff"><div><strong>Use this storage value in Project finance</strong><p>Sends ${fmt.money(s.netValue / n)}/yr, ${fmt.int(s.energyDischargedMWh / n)} MWh discharged and the charging bill for this bus and size${cond ? ' (marked conditional)' : ''}.</p></div><button class="primary" data-act="handoff-bess">Use this value in Finance</button></div>
    ${cards(traces)}
    ${nextStep('send this value and test the cash flows in Economics › Project finance', 'economics', 'finance')}`;
}

// ---------- Tab 3: Hybrid sizing ----------
const FRACTIONS = [0, 0.25, 0.5, 0.75, 1];
function tabHybrid(ctx) {
  const { S } = ctx, x = inputs(ctx);
  if (!x.res.summary) return noBasis(ctx);
  if (needSize(S)) return needSize(S);
  const pv = Number(S.exportMW), n = x.yearsEq, g0 = gate(x.exportLimit, pv, 'Export');
  const poi = ok(x.exportLimit) ? Math.min(pv, x.exportLimit) : pv;
  const cf = val(S, 'solarCF') / 100, eta = Math.sqrt(val(S, 'rte') / 100), loss = val(S, 'lossPct'), dur = val(S, 'duration');
  const prof = genProfile(ctx, x.records, 'solar', pv, cf);
  const recs = x.records.map((r, i) => ({ ...r, generationMW: prof.raw[i] * (1 - loss / 100) }));
  const solarMW = recs.map(r => r.generationMW), genTotal = recs.reduce((t, r) => t + r.generationMW * r.dtHours, 0) / n;
  const configs = FRACTIONS.map(f => {
    if (f === 0) return memo(JSON.stringify(['hyb0', basisHash(S.basis), S.nodeId, pv, poi, cf, loss]), () => { const g = generationRevenue(recs.map(r => ({ ...r, generationMW: Math.min(r.generationMW, poi) })), { lossPct: 0 }); const sp = recs.reduce((t, r) => t + Math.max(0, r.generationMW - poi) * r.dtHours, 0) / n; return { f, mw: 0, value: g.summary.merchantRevenue / n, spill: sp, direct: genTotal - sp, toBattery: 0, discharged: 0, errors: g.errors }; });
    // Review H2: the old fixed 30-step grid could not absorb small solar hours ($0); size it to the battery and the solar.
    const bm = pv * f, grid = dispatchGrid({ energyMWh: bm * dur, chargeMW: bm, dischargeMW: bm, exportMW: poi, etaC: eta, etaD: eta, solarMW, dtHours: Math.min(...recs.map(r => r.dtHours)), hours: x.res.summary.hours });
    if (!grid.feasible) return { f, mw: bm, value: null, spill: null, errors: [grid.reason], grid };
    const h = solve('hybrid', JSON.stringify(['hyb', basisHash(S.basis), S.nodeId, pv, poi, cf, loss, f, dur, val(S, 'rte'), val(S, 'cycleCost'), grid.stepMWh]), recs, { renewableCapacityMW: pv, capacityMW: bm, energyMWh: bm * dur, exportMW: poi, importMW: 0, gridCharging: false, chargeEfficiency: eta, dischargeEfficiency: eta, cycleCostPerMWh: val(S, 'cycleCost'), stepMWh: grid.stepMWh });
    if (!h) return { f, mw: bm, pending: true, grid, errors: [] };
    if (h.errors.length) return { f, mw: bm, value: null, spill: null, errors: h.errors, grid };
    const sum = k => h.rows.reduce((t, r) => t + r[k] * r.dtHours, 0) / n;
    return { f, mw: bm, value: h.summary.netValue / n, spill: h.summary.curtailedMWh / n, direct: sum('renewableExportMW'), toBattery: sum('renewableToBatteryMW'), discharged: sum('dischargeMW'), cycles: h.summary.equivalentCycles / n, errors: [], rows: h.rows, grid };
  });
  if (configs.some(c => c.pending)) return `${basisStrip(ctx, x)}${solvingPanel(x, `${configs.filter(c => c.pending).length} storage configurations`, configs.find(c => c.pending).grid)}`;
  const base = configs[0].value, best = configs.slice(1).filter(c => ok(c.value)).sort((a, z) => z.value - a.value)[0];
  const label = c => (c.mw ? `${fmt.mw(c.mw)} / ${fmt.int(c.mw * dur)} MWh` : 'Solar only');
  const cfgTable = table([
    { k: 'lab', l: 'Storage added' }, { k: 'value', l: 'Energy value / yr', num: true, f: v => (ok(v) ? fmt.money(v) : null) }, { k: 'inc', l: 'Incremental', num: true, f: v => (ok(v) ? fmt.money(v) : null) },
    { k: 'perKw', l: 'Incr. $/kW-yr storage', num: true, f: v => (ok(v) ? `$${v.toFixed(1)}` : null) }, { k: 'direct', l: 'Solar exported MWh', num: true, f: v => (ok(v) ? fmt.int(v) : null) },
    { k: 'toBattery', l: 'Into battery MWh', num: true, f: v => (ok(v) ? fmt.int(v) : null) }, { k: 'discharged', l: 'Discharged MWh', num: true, f: v => (ok(v) ? fmt.int(v) : null) },
    { k: 'spill', l: 'Spilled MWh', num: true, f: v => (ok(v) ? fmt.int(v) : null) }, { k: 'cycles', l: 'Cycles / yr', num: true, f: v => (ok(v) ? v.toFixed(0) : null) }, { k: 'note', l: 'Note', wrap: true },
  ], configs.map(c => ({ lab: label(c), value: c.value, inc: c.mw && ok(c.value) ? c.value - base : null, perKw: c.mw && ok(c.value) ? (c.value - base) / (c.mw * 1000) : null, direct: c.direct, toBattery: c.toBattery, discharged: c.discharged, spill: c.spill, cycles: c.cycles, note: c.errors?.length ? c.errors[0] : '', _cls: c === best ? 'hl' : '' })));
  const flowChart = stacked(configs.filter(c => ok(c.spill)).map(c => ({ label: c.mw ? fmt.mw(c.mw) : 'Solar only', values: [c.direct, c.discharged, c.spill] })), { series: ['Solar exported directly', 'Exported via the battery', 'Spilled at the POI'], fmt: v => fmt.int(v), title: 'Energy flow by configuration (MWh/yr)', height: 230 });
  const curve = lineChart([{ name: 'Incremental value ($/yr)', points: configs.filter(c => ok(c.value)).map(c => ({ x: c.mw, y: c.value - base })) }], { fmt: v => fmt.money(v), xfmt: v => `${Math.round(v)} MW`, title: 'Incremental value by storage size', height: 230 });
  const bm = best?.rows ? groupSum(best.rows, r => String(r.timestamp).slice(0, 7), { direct: r => r.renewableExportMW * r.dtHours, dis: r => r.dischargeMW * r.dtHours, spill: r => r.renewableCurtailmentMW * r.dtHours }) : [];
  const monthFlow = bm.length ? stacked(bm.map(m => ({ label: m.key.slice(2), values: [m.direct, m.dis, m.spill] })), { series: ['Direct', 'Via battery', 'Spilled'], fmt: v => fmt.int(v), title: 'Monthly energy flow, best configuration (MWh)', height: 210 }) : '';
  const recovered = best && ok(best.spill) ? configs[0].spill - best.spill : null;
  // Hybrid as one asset → Finance (review: the handoff used to collapse to storage).
  const pick = best || configs[0];
  const pickStack = hyStack(pick.value);
  if (ok(pick.value)) S.ui.revenueOut = { busId: S.nodeId, tech: 'hybrid', ...stackHandoff(pickStack), kind: `hybrid ${pickStack.short}: ${label(pick)} (solar + battery, one POI)`, mw: pv, annual: pick.value, mwh: ok(pick.direct) ? pick.direct + (pick.discharged || 0) : null, basis: describe(S.basis), hash: basisHash(S.basis), conditional: !g0.ok, at: new Date().toISOString() };
  // DC:AC sweep on the same CF-scaled clear-sky shape after losses (clipping at the AC nameplate).
  const dcac = dcacSweep(prof.unclipped.map(u => u * (1 - loss / 100)), recs.map(r => r.dtHours), pv, [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2]);
  const dcacTarget = pv * cf * recs.reduce((t, r) => t + r.dtHours, 0) * (1 - loss / 100);
  const studio = getData('bench', S.nodeId), sv = studio.state === 'ok' ? studio.data.studio?.values : null;
  const d13 = dcac.find(r => Math.abs(r.ratio - 1.3) < 1e-9);
  const ah = {
    cfg: best ? `Adding ${B(label(best))} of storage adds the most energy value: ${B(fmt.money(best.value - base))}/yr over solar alone (${B(fmt.money(base))}), before storage cost.` : 'No storage configuration was assessed.',
    flow: `Solar alone spills ${B(`${fmt.int(configs[0].spill)} MWh`)} a year at the ${fmt.mw(poi)} connection${ok(recovered) ? `; the best configuration recovers ${B(`${fmt.int(recovered)} MWh`)}` : ''}.`,
    curve: best ? `Value rises to ${B(fmt.money(best.value - base))}/yr at ${B(fmt.mw(best.mw))} of storage; ${B(`$${((best.value - base) / (best.mw * 1000)).toFixed(1)}/kW-yr`)} of storage at that size.` : 'No configuration was assessed.',
    month: bm.length ? `With the best configuration ${B(`${fmt.int(bm.reduce((t, m) => t + m.dis, 0) / n)} MWh`)} a year leaves via the battery.` : 'No storage configuration was assessed.',
    dcac: d13 ? `At a DC:AC ratio of 1.3 the clear-sky array clips ${B(`${d13.share.toFixed(2)}%`)} of its energy at the AC nameplate.` : 'No DC:AC case is held.',
    spill: `Spill at the POI falls from ${B(`${fmt.int(configs[0].spill)} MWh`)} with no storage${ok(configs.at(-1).spill) ? ` to ${B(`${fmt.int(configs.at(-1).spill)} MWh`)} with ${fmt.mw(configs.at(-1).mw)}` : ''}.`,
  };
  return `${basisStrip(ctx, x)}${g0.ok ? '' : `<div class="notice error">${g0.msg}</div>`}<div class="notice">The battery charges only from the solar plant (no grid charging), so it never needs the charging connection. Exports share one connection limit of ${fmt.mw(poi)}. Solar: ${esc(prof.label)}.</div>
    <div class="kpis">
      ${kpi('Solar-only value', fmt.money(base), g0.ok ? '/yr' : '/yr conditional', `${fmt.mw(pv)} solar, after ${loss}% losses · ${hyStack(base).short}: not comparable with the Solar & wind revenue headline (energy + RECs)`)}
      ${kpi('Best added storage', best ? fmt.mw(best.mw) : '—', '', best ? `${fmt.int(best.mw * dur)} MWh · largest incremental energy value, before storage cost` : 'No configuration assessed', !best)}
      ${kpi('Incremental value (best)', best ? fmt.money(best.value - base) : '—', g0.ok ? '/yr' : '/yr conditional', best ? `$${((best.value - base) / (best.mw * 1000)).toFixed(1)}/kW-yr of storage · compare with its capital cost` : '', !best)}
      ${kpi('Solar spilled, solar only', `${fmt.int(configs[0].spill)} MWh`, '/yr', `${ok(genTotal) && genTotal > 0 ? ((100 * configs[0].spill) / genTotal).toFixed(1) : '—'}% of solar after losses, at ${fmt.mw(poi)}`)}
      ${kpi('Spill recovered (best)', ok(recovered) ? `${fmt.int(recovered)} MWh` : 'not held', ok(recovered) ? '/yr' : '', !ok(recovered) ? '' : recovered >= 0 ? 'Solar that would spill, stored and sold later' : 'Negative: the optimiser spills a little solar in hours it prefers to discharge', !ok(recovered))}
      ${kpi('Battery cycles (best)', best && ok(best.cycles) ? best.cycles.toFixed(0) : 'not held', best ? '/yr' : '', 'From solar only; no grid charging', !(best && ok(best.cycles)))}
    </div>
    ${cards(
      tagged({ answer: ah.cfg, depth: 'review', trace: 'e-hybrid' }, 8, 'Configurations', `storage at ${FRACTIONS.slice(1).map(f => `${f * 100}%`).join(', ')} of solar MW · ${dur} h · perfect foresight`, cfgTable),
      card(4, 'Energy flow by configuration', 'where each solar MWh goes', flowChart, { answer: ah.flow }),
      tagged({ depth: 'screen', trace: 'e-hybrid-curve' }, 6, 'Incremental value curve', 'value added over solar-only, by storage MW', curve, { answer: ah.curve, foot: 'Diminishing returns show where more storage stops paying for itself (before capital cost).' }),
      card(6, 'Monthly energy flow (best)', best ? label(best) : 'no configuration', monthFlow || '<div class="empty"><strong>Not held</strong>No storage configuration was assessed.</div>', { answer: ah.month }),
      card(6, 'DC:AC ratio and clipping', 'share of the array energy clipped at the AC nameplate', `${lineChart([{ name: 'Clipped share (%)', points: dcac.map(r => ({ x: r.ratio, y: r.share })) }], { fmt: v => `${v.toFixed(1)}%`, xfmt: v => v.toFixed(2), title: 'Clipping by DC:AC ratio', height: 190 })}${table([{ k: 'ratio', l: 'DC:AC', num: true, f: v => v.toFixed(2) }, { k: 'rawMWh', l: 'Produced MWh', num: true, f: v => fmt.int(v / n) }, { k: 'clippedMWh', l: 'Clipped MWh/yr', num: true, f: v => fmt.int(v / n) }, { k: 'share', l: 'Clipped %', num: true, f: v => (ok(v) ? v.toFixed(2) : null) }], dcac)}`, { answer: ah.dcac, depth: 'review', trace: 'e-dcac', chips: 'assumption', foot: 'Clear-sky shape (assumption): its peak sits below nameplate at DC:AC 1, so clipping only appears at higher ratios; a battery on the DC bus could store the clipped energy.' }),
      card(6, 'Battery size against spill at the POI', 'spill (curtailment at the export limit) by storage MW', lineChart([{ name: 'Spilled MWh/yr', points: configs.filter(c => ok(c.spill)).map(c => ({ x: c.mw, y: c.spill })) }], { fmt: v => fmt.int(v), xfmt: v => `${Math.round(v)} MW`, title: 'Spill by storage size', height: 190 }), { answer: ah.spill, depth: 'review', foot: 'Spill = solar above the Grid export limit that the battery could not absorb.' }),
      tagged({ depth: 'study', chips: 'studio-copy', answer: 'The Studio estimates hybrid recovery with fixed heuristics; this page dispatches every configuration hour by hour instead.' }, 12, 'Studio counterpart', 'the Studio\'s hybrid figures are heuristics; here each is dispatched hour by hour', `<p class="audit-note">Studio E-13/E-14/E-15 estimate clipping recovery as min(1, battery MWh ÷ (solar MW × 5 h)) on a vendor curtailment ramp${sv ? ` (${STUDIO_TAG}: solar ${fmt.pct(sv.solar_100MW_2030)} at 100 MW, ${fmt.pct(sv.solar_250MW_2030)} at 250 MW, 2030, not screened)` : ''}, and add a flat 4% "shift" uplift. This page replaces all three with the chronological dispatch above: spill comes from the Grid export limit, recovery and shift are what the optimiser actually does.</p>`),
    )}
    <div class="handoff"><div><strong>Use this hybrid in Project finance</strong><p>Sends ${fmt.money(pick.value)}/yr (${esc(pickStack.label)}) for ${esc(label(pick))} as one asset${g0.ok ? '' : ' (marked conditional)'}.</p></div><button class="primary" data-act="handoff-revenue">Use this hybrid in Finance</button></div>
    ${cards(traceCard(traceHybrid(S, x.node, x, { best, pv, poi, dur, base }), traceHybridCurve(S, x.node, { configs, base, dur, genTotal, label }), traceDcac(S, x.node, { rows: dcac, ac: pv, target: dcacTarget })))}
    ${nextStep('send the hybrid and test the cash flows in Economics › Project finance', 'economics', 'finance')}`;
}

// ---------- Tab 4: Project finance ----------
function tabFinance(ctx) {
  const { S } = ctx, f = S.ui.fin || {};
  const rev = S.handoffs.revenue, cost = S.handoffs.cost;
  // Each fuel keeps its own handoff: a hybrid is one asset (never collapsed to storage), sent from Hybrid as one asset.
  const techNow = ['storage', 'hybrid', 'wind'].includes(S.tech) ? S.tech : 'solar';
  const revMatch = rev && String(rev.busId) === String(S.nodeId) && Number(rev.mw) === Number(S.exportMW) && rev.tech === techNow && rev.hash === basisHash(S.basis);
  const costMatch = cost && String(cost.busId) === String(S.nodeId) && Number(cost.size) === Number(cost.dir === 'import' ? S.importMW : S.exportMW) && (!cost.tech || cost.tech === (S.tech === 'datacenter' ? 'datacenter' : S.tech));
  const annualRevenue = ok(f.annualRevenue) ? f.annualRevenue : revMatch ? rev.annual : null;
  const pathHeld = revMatch && !ok(f.annualRevenue) && Array.isArray(rev.path) && rev.path.length > 0;
  const usePath = pathHeld && S.ui.finPath === 'runs';
  const fields = [['capex', 'Capital cost (excluding grid upgrades)', '$'], ['annualOM', 'O&M per year', '$'], ['discountRate', 'Discount rate', 'fraction, e.g. 0.08'], ['years', 'Operating years', 'whole years'], ['constructionYears', 'Construction years', 'whole years']];
  const fieldHtml = ([k, l, u]) => { const t = finTag(S, k); return `<label class="field">${esc(l)} <span class="pill" title="${esc(t.src)}">${t.tag}</span><input type="number" step="any" data-act="fin" data-k="${k}" value="${ok(f[k]) ? f[k] : ''}" placeholder="enter"><span class="audit-note">${esc(u)} · ${t.tag === 'A' ? esc(t.src) : 'no default'}</span></label>`; };
  // V6 compact form: capital, rate, years and revenue stay visible; O&M, construction, decline and the path go under More.
  const VISIBLE = ['capex', 'discountRate', 'years'];
  const form = fields.filter(([k]) => VISIBLE.includes(k)).map(fieldHtml).join('')
    + `<label class="field">${S.tech === 'datacenter' ? 'Site revenue per year (yours, not energy)' : 'Revenue per year (year 1)'} <span class="pill">${ok(f.annualRevenue) ? 'U' : revMatch ? 'Sent' : 'NH'}</span><input type="number" step="any" data-act="fin" data-k="annualRevenue" value="${ok(f.annualRevenue) ? f.annualRevenue : ''}" placeholder="${revMatch ? `sent: ${Math.round(rev.annual)}` : 'enter, or send from a revenue tab'}"><span class="audit-note">$ · declines ${val(S, 'degradation')}%/yr${revMatch && rev.kind ? ` · sent: ${esc(rev.kind)}` : ''}${revMatch && rev.conditional ? ' · sent value is conditional' : ''}</span></label>`;
  const formMore = fields.filter(([k]) => !VISIBLE.includes(k)).map(fieldHtml).join('')
    + input(S, 'degradation', 'Output decline', '%/yr')
    + (pathHeld ? `<label class="field">Revenue path<select data-act="ui" data-k="finPath"><option value="flat" ${usePath ? '' : 'selected'}>Flat: the basis revenue, declining</option><option value="runs" ${usePath ? 'selected' : ''}>Forecast runs: ${rev.path.map(p => p.y).join(' → ')}</option></select><span class="audit-note">runs interpolated, held flat past ${Math.max(...rev.path.map(p => p.y))}</span></label>
       <label class="field">First operating year (COD) <span class="pill" title="${esc(finTag(S, 'cod').src)}">${finTag(S, 'cod').tag}</span><input type="number" step="1" data-act="fin" data-k="cod" value="${ok(f.cod) ? f.cod : ''}" placeholder="e.g. 2029"><span class="audit-note">needed for the forecast-run path</span></label>` : '');
  const problems = [];
  for (const [k, l] of fields) if (!ok(f[k])) problems.push(l.toLowerCase());
  if (!ok(annualRevenue)) problems.push('revenue');
  if (usePath && !(ok(f.cod) && Number.isInteger(f.cod) && f.cod >= 2020 && f.cod <= 2060)) problems.push('first operating year (a whole year from 2020 to 2060) for the forecast-run path');
  if (ok(f.years) && (!Number.isInteger(f.years) || f.years < 1 || f.years > 60)) problems.push('operating years must be a whole number from 1 to 60');
  if (ok(f.constructionYears) && (!Number.isInteger(f.constructionYears) || f.constructionYears < 0 || f.constructionYears > 10)) problems.push('construction years must be a whole number from 0 to 10');
  if (ok(f.discountRate) && (f.discountRate <= -1 || f.discountRate > 1)) problems.push('discount rate must be a fraction between −1 and 1');
  const notes = [];
  if (cost && !costMatch) notes.push('The Grid upgrade scenario is for a different bus or size, so it is <b>not</b> included. Resend it from Grid.');
  if (rev && !revMatch) notes.push('The revenue sent from Economics is for a different bus, size, technology or price basis, so it is not used. Resend it.');
  const revCond = revMatch && !ok(f.annualRevenue) && rev.conditional;
  const upgrade = costMatch && ok(cost.known) ? cost.known * 1e6 : 0;
  const incompleteCost = costMatch ? (cost.unpriced || 0) > 0 || (cost.unverified || 0) > 0 || cost.status === 'Lower bound' : true;
  const moreOpen = !ok(f.annualOM) || !ok(f.constructionYears) || (usePath && !ok(f.cod)) || tag(S, 'degradation') === 'U';
  const aInputs = problems.length ? `${B(fmt.int(problems.length))} input${problems.length > 1 ? 's are' : ' is'} still missing or invalid (named in the notice below), so the valuation is not computed yet.` : `Every input is entered: ${B(fmt.money(f.capex))} capital${costMatch && ok(cost.known) ? ` plus ${B(`$${cost.known.toFixed(2)}M`)} grid upgrades` : ''} at ${B(`${(100 * f.discountRate).toFixed(1)}%`)} over ${B(`${f.years} years`)}.`;
  const inputsCard = tagged({ depth: 'screen', answer: aInputs }, 12, 'Inputs', 'NH = not held · the valuation stays incomplete until every input is entered', `<div class="form-grid">${form}</div>${moreCtl(`<div class="form-grid">${formMore}</div>`, moreOpen)}${notes.map(n => `<div class="notice warn">${n}</div>`).join('')}
    ${costMatch ? `<p class="audit-note">Grid upgrade scenario (${esc(String(cost.at).slice(0, 16).replace('T', ' '))}): known subtotal ${ok(cost.known) ? `$${cost.known.toFixed(2)}M` : 'not held'} added to capital; ${cost.unpriced || 0} unpriced item(s).</p>` : ''}`);
  // S5 Lead wiring 1: the OBBBA tax-credit gate and after-tax finance (rules/finance.js + rules/tax.js) on both branches.
  // A data centre is a load: §45Y/§48E generation credits do not apply, so the S5 cards are not shown for it (S6 guard).
  const s5Cards = s5FinanceCards(ctx, { revMatch, rev, costMatch, cost });
  if (problems.length) return `${cards(inputsCard)}${s5Cards}<div class="notice warn"><b>Incomplete valuation.</b> Missing or invalid: ${esc(problems.join(', '))}. No value is ever assumed for capital, O&M, financing or tax credits.</div>
    ${cards(tagged({ depth: 'screen', answer: 'Once every input is entered this tab returns NPV, IRR, LCOE and payback on one timeline; until then no value is shown.' }, 12, 'Method', 'what this tab computes once the inputs are entered', '<p class="audit-note">NPV = Σ cash flow<sub>t</sub> ÷ (1 + r)<sup>t</sup>; IRR only when the cash flows change sign once; LCOE = PV(capital + O&M) ÷ PV(MWh) on the same timeline; payback (simple and discounted); an NPV grid over discount rate × capital; LCOE against the captured price. Revenue: the basis revenue declining by the output decline, or the forecast-run path sent from Solar &amp; wind revenue.</p>'))}
    ${nextStep('enter the missing inputs, then check the decision gates in Decision › Readiness & actions', 'decision', 'readiness')}`;

  const d = val(S, 'degradation') / 100, rr = f.discountRate;
  const pathRows = usePath ? pathAlong(rev.path, Array.from({ length: f.years }, (_, t) => f.cod + t)) : null;
  const revenues = Array.from({ length: f.years }, (_, t) => (usePath ? pathRows[t].v : annualRevenue) * (1 - d) ** t);
  const cfg = { capex: f.capex + upgrade, annualOM: f.annualOM, discountRate: rr, years: f.years, constructionYears: f.constructionYears, annualRevenue: revenues };
  const r = projectFinance(cfg);
  if (r.errors.length) return `${cards(inputsCard)}<div class="notice error">${r.errors.map(esc).join(' ')}</div>`;
  const s = r.summary, mwh = revMatch && ok(rev.mwh) ? rev.mwh : null;
  const mwhPath = ok(mwh) ? Array.from({ length: f.years }, (_, t) => mwh * (1 - d) ** t) : null;
  // Same timeline as projectFinance: capital at year 0, output from year constructionYears + 1 (review: the old CRF form ignored the delay).
  const lc = lcoeCalc({ capex: f.capex + upgrade, annualOM: f.annualOM, rate: rr, years: f.years, constructionYears: f.constructionYears, mwh: mwhPath });
  const lcoe = lc.value, pb = payback(r.rows, rr);
  const rates = [-0.02, -0.01, 0, 0.01, 0.02].map(x => (x === 0 ? rr : +(rr + x).toFixed(4))).filter(x => x > -1), capMul = [0.8, 0.9, 1, 1.1, 1.2];
  const grid = financeGrid(cfg, rates, capMul.map(m => (f.capex + upgrade) * m));
  const gridTbl = (m, fmtv, rs = rates) => `<div class="table-wrap"><table class="dense"><thead><tr><th>Rate \\ capital</th>${capMul.map(c => `<th class="num">${c === 1 ? '<b>' : ''}${(c * 100).toFixed(0)}% · ${esc(fmt.money((f.capex + upgrade) * c))}${c === 1 ? '</b>' : ''}</th>`).join('')}</tr></thead><tbody>${rs.map((rt, i) => `<tr${rt === rr ? ' class="hl"' : ''}><td>${(100 * rt).toFixed(1)}%</td>${m[i].map(v => `<td class="num">${ok(v) ? esc(fmtv(v)) : 'not defined'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  let cum = 0, dcum = 0;
  const cumPts = r.rows.map(row => { cum += row.projectCashFlow; dcum += row.projectCashFlow / (1 + rr) ** row.year; return { x: row.year, cum, dcum }; });
  const capture = revMatch && ok(rev.capture) ? rev.capture : null;
  const realized = ok(mwh) && mwh > 0 && ok(annualRevenue) ? annualRevenue / mwh : null;
  const cmp = [{ label: 'LCOE', value: lcoe }, { label: 'Capture price (energy)', value: capture }, { label: 'Revenue per MWh (energy + RECs)', value: realized }];
  const npvCells = grid.npv.flat().filter(ok), irrRow = (grid.irr[rates.indexOf(rr)] || []).filter(ok);
  const af = {
    cash: `At ${B(`${(100 * rr).toFixed(1)}%`)} the project's NPV is ${B(fmt.money(s.npv))}${incompleteCost ? ' (an upper bound: grid upgrades not fully priced)' : ''}; IRR ${B(ok(s.irr) ? fmt.pct(100 * s.irr) : 'not defined')}.`,
    cum: ok(pb.simple) ? `Cumulative cash breaks even after ${B(`${pb.simple.toFixed(1)} years`)}, ${ok(pb.discounted) ? B(`${pb.discounted.toFixed(1)} years`) : B('never')} discounted.` : `Cumulative cash ${B('never')} breaks even within ${f.years} operating years.`,
    npv: `NPV is positive in ${B(`${npvCells.filter(v => v > 0).length} of ${npvCells.length}`)} rate × capital cases.`,
    irr: irrRow.length ? `IRR runs from ${B(fmt.pct(100 * Math.min(...irrRow)))} to ${B(fmt.pct(100 * Math.max(...irrRow)))} across capital at 80–120%.` : 'IRR is not defined at any capital case.',
    lcoe: ok(lcoe) ? `LCOE is ${B(`$${lcoe.toFixed(2)}/MWh`)}${ok(realized) ? ` against ${B(`$${realized.toFixed(2)}`)} of revenue per MWh: ${lcoe <= realized ? 'costs are recovered' : 'costs are not recovered'} on energy and RECs` : ''}.` : 'LCOE needs MWh: send revenue from a revenue tab.',
    path: `Revenue starts at ${B(fmt.money(revenues[0]))} and ends at ${B(fmt.money(revenues.at(-1)))} in operating year ${f.years}.`,
  };
  return `${cards(inputsCard)}${s5Cards}
    ${incompleteCost ? `<div class="notice warn"><b>Incomplete: grid upgrade scope is not fully priced.</b> ${costMatch ? [cost.unpriced ? `${cost.unpriced} unpriced item(s)` : '', cost.status === 'Lower bound' ? 'a study case without facility costs may bind below the request (lower bound)' : '', cost.unverified ? `${cost.unverified} case(s) rest on the vendor envelope only (no facility list)` : ''].filter(Boolean).join('; ') + ': NPV is an upper bound.' : 'Send an upgrade-cost scenario from Grid for this bus, size and technology.'}</div>` : ''}
    ${usePath ? '<div class="notice">Revenue follows the forecast runs (energy + RECs per run on this project), interpolated between run years and held flat past the last run; the unified DB holds no 2045/2050 simulation.</div>' : ''}
    <div class="kpis">${kpi('Net present value', fmt.money(s.npv), `${incompleteCost ? ' upper bound' : ''}${revCond ? ' conditional' : ''}`, `At ${(100 * rr).toFixed(1)}% · pre-tax, unlevered`)}${kpi('Internal rate of return', ok(s.irr) ? fmt.pct(100 * s.irr) : 'not defined', revCond ? ' conditional' : '', ok(s.irr) ? 'Project, pre-tax' : 'No single rate: cash flows have no sign change, or more than one', !ok(s.irr))}${kpi('Levelised cost', ok(lcoe) ? `$${lcoe.toFixed(2)}` : 'not held', ok(lcoe) ? '/MWh' : '', ok(lcoe) ? 'PV(capital + O&M) ÷ PV(MWh), same timeline as NPV' : 'Needs MWh: send revenue from Solar & wind', !ok(lcoe))}
      ${kpi('Simple payback', ok(pb.simple) ? pb.simple.toFixed(1) : 'never', ok(pb.simple) ? 'years' : '', 'From year 0 (capital), incl. construction', !ok(pb.simple))}${kpi('Discounted payback', ok(pb.discounted) ? pb.discounted.toFixed(1) : 'never', ok(pb.discounted) ? 'years' : '', `At ${(100 * rr).toFixed(1)}%`, !ok(pb.discounted))}${kpi('Total revenue', fmt.money(s.totalRevenue), '', `${f.years} operating years · ${usePath ? 'forecast-run path' : 'flat basis, declining'}`)}</div>
    ${cards(
      tagged({ answer: af.cash, depth: 'screen', trace: 'e-finance' }, 8, 'Annual cash flow', 'project cash flow by year (capital at year 0)', barChart(r.rows.map(x => ({ label: String(x.year), value: x.projectCashFlow, note: `revenue ${fmt.money(x.revenue)} · O&M ${fmt.money(x.om)}` })), { fmt: v => fmt.money(v), title: 'Annual project cash flow', height: 230 })),
      card(4, 'Cumulative cash flow', 'undiscounted and discounted', lineChart([{ name: 'Cumulative', points: cumPts.map(p => ({ x: p.x, y: p.cum })) }, { name: 'Discounted', points: cumPts.map(p => ({ x: p.x, y: p.dcum })), dashed: true }], { fmt: v => fmt.money(v), xfmt: v => `Y${v}`, title: 'Cumulative cash flow', height: 230 }), { answer: af.cum }),
      tagged({ depth: 'review', trace: 'e-fin-grid' }, 6, 'NPV sensitivity', 'discount rate × capital cost (incl. Grid upgrades)', gridTbl(grid.npv, v => fmt.money(v)), { answer: af.npv, foot: 'Every cell is a full cash-flow run; the highlighted row is your rate, the bold column your capital.' }),
      tagged({ depth: 'study' }, 6, 'IRR sensitivity', 'capital cost; IRR does not depend on the rate', gridTbl([grid.irr[rates.indexOf(rr)]], v => `${Math.abs(v) < 5e-4 ? '0.0' : (100 * v).toFixed(1)}%`, [rr]) + `<p class="audit-note">Discount rate needed for NPV = 0 at each capital cost. IRR does not depend on the discount rate, so one row is shown.</p>`, { answer: af.irr, foot: 'Each cell is the IRR of a full cash-flow run at that capital.' }),
      card(6, 'LCOE vs captured price', '$/MWh', barChart(cmp, { fmt: v => `$${v.toFixed(2)}`, title: 'LCOE vs captured price', height: 200, emptyText: 'Send revenue from Solar & wind to compare LCOE with the captured price.' }), { answer: af.lcoe, foot: 'If LCOE is above the revenue per MWh, the project does not recover its costs at this rate on energy and RECs alone.' }),
      tagged({ answer: af.path, depth: 'review' }, 6, 'Revenue path', usePath ? 'forecast runs, interpolated' : 'flat basis revenue with output decline', table([{ k: 'year', l: 'Operating year', num: true }, { k: 'cal', l: 'Calendar' }, { k: 'rev', l: 'Revenue', num: true, f: v => fmt.money(v) }, { k: 'kind', l: 'Basis', wrap: true }], revenues.map((v, t) => ({ year: t + 1, cal: usePath ? String(f.cod + t) : '—', rev: v, kind: usePath ? pathRows[t].kind : t ? `year 1 × (1 − ${val(S, 'degradation')}%)^${t}` : 'year 1 (sent or entered)' })))),
    )}
    ${cards(traceCard(
      traceFinance(S, { r, rate: rr, capex: f.capex + upgrade, upgrade, om: f.annualOM, construction: f.constructionYears, years: f.years, revenue1: annualRevenue, revSource: ok(f.annualRevenue) ? 'U' : 'Sent', proxy: !ok(f.annualRevenue) && revMatch && rev.proxy, mwh: mwhPath, decline: val(S, 'degradation'), tags: { deg: tag(S, 'degradation') }, srcs: { deg: tagTitle(S, 'degradation') }, lc }),
      tracePayback(S, { r, rate: rr, pb }),
      traceFinGrid(S, { grid, rates, capMul, capex: f.capex + upgrade, npv: s.npv, rate: rr, cfg }),
      usePath ? traceRevPath(S, { path: rev.path, rows: pathRows, cod: f.cod, decline: val(S, 'degradation'), revenues }) : ''))}
    ${nextStep('check every decision gate for this bus in Decision › Readiness & actions', 'decision', 'readiness')}`;
}

/**
 * S5 cards for Project finance: {fin: S.ui.fin, tax: S.ui.tax} over the sent revenue (incl. the storage handoff's
 * discharged MWh and charging cost) and the Grid upgrade capital. The Queue COD year stands in until S3's computed COD
 * date is exposed (S5 open item). Returns the cards block, '' for a load, or a stated loading / not-held card.
 */
function s5FinanceCards(ctx, { revMatch, rev, costMatch, cost }) {
  const { S } = ctx;
  if (S.tech === 'datacenter') return '';
  const R = getRules(), title = 'Tax credit eligibility and after-tax finance', sub = 'IRC §45Y / §48E (OBBBA) · R3 §2–3';
  if (R.state !== 'ok') return cards(card(12, title, sub, `<div class="empty"><strong>${R.state === 'loading' ? 'Loading the rules file' : 'Not held'}</strong>${esc(R.state === 'error' ? `rules/isone-2026.json could not load: ${R.error}` : 'Reading rules/isone-2026.json…')}</div>`, { depth: 'screen', chips: 'rules' }));
  try {
    const s5 = financeCards({ fin: S.ui.fin || {}, tax: S.ui.tax || {} }, {
      tech: S.tech, mw: Number(S.exportMW), queueCod: Number(S.ui.qCod) || null,
      sent: revMatch ? { revenue: rev.annual, mwh: rev.mwh, dischargedMwh: rev.dischargedMwh, chargeCost: rev.chargeCost } : {},
      upgradeCapex: costMatch && ok(cost.known) ? cost.known * 1e6 : undefined,
    }, R.data);
    return cards(...s5.cards);
  } catch (e) { console.error(e); return cards(card(12, title, sub, `<div class="empty"><strong>Not held</strong>${esc(e.message)}</div>`, { depth: 'screen', chips: 'rules' })); }
}

export function renderEconomics(tab, ctx) {
  const t = ctx.S.tech;
  const route = t === 'datacenter' ? { revenue: tabLoadCost, bess: tabLoadFlex, hybrid: tabHybridNA, finance: tabCostFinance }
    : t === 'storage' ? { revenue: tabStorageRevenue, bess: tabBess, hybrid: tabHybrid, finance: tabFinance }
      : { revenue: tabRevenue, bess: tabBess, hybrid: tabHybrid, finance: tabFinance };
  return (route[tab] || route.revenue)(ctx);
}

/** Helpers shared with the fuel-routed tabs (views/economics-fueltabs.js). */
export const EH = { limitsFor, loadGate, s4Streams, s4Cards, cpsRowsOf, streamNote, tabFinance, inputs, battery, gate, basisStrip, noBasis, needSize, val, tag, tagTitle, finTag, slider, input, kpi, perKw, traceCard, cards, yearSeries, spreadRows, solvingPanel, basisHash, DEFAULTS };
