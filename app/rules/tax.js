// S5 tax rules over rules/isone-2026.json → tax (the domain file rules/isone-2026/tax.json). Pure, no DOM, no fetch:
// every function takes the loaded rules object R as its last argument, so the browser and node tests read one file.
// Provenance: Claude Opus 5.5 (S5 agent) · one-studio/design (T3, P2 slice S5) · 2026-10-06 · sign-off pending · v1
//
// The eligibility gate is R3-finance-tax-largeload.md §2 (rows G0–G12, M1–M2, P1), evaluated per technology; a hybrid
// is evaluated twice (wind/solar part and storage part). States: eligible | contingent | review | ineligible | open.
// Only "eligible" passes: contingent (the Notice 2025-42 vacatur, R3 A10), review (continuity on facts and
// circumstances, G3) and open (an input not held) all count the credit at 0 and carry fractionIfPass for a labelled
// "if the gate passes" scenario. Unknown never passes.

const ok = v => typeof v === 'number' && Number.isFinite(v);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = s => typeof s === 'string' && DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const yearOf = s => Number(s.slice(0, 4));
const T = R => {
  if (!R || !R.tax) throw new Error('rules/isone-2026.json not loaded (tax block missing)');
  return R.tax;
};
const SOLARWIND = new Set(['solar', 'wind']);
export const TECHS = ['solar', 'wind', 'storage'];

export const GATE_LABEL = {
  eligible: 'Eligible for 45Y/48E',
  contingent: 'Eligible only if the Notice 2025-42 vacatur holds',
  review: 'Eligible only if continuity is evidenced',
  ineligible: 'Not eligible for 45Y/48E (OBBBA)',
  open: 'Not decided: an input is not held',
};

/** Material-assistance cost-ratio threshold for a BOC year (R3 A8): null before the rule applies. */
export function macrThreshold(tech, bocYear, R) {
  const m = T(R).material_assistance_thresholds;
  if (!ok(bocYear) || bocYear < yearOf(m.applies_from_boc)) return null;
  const table = tech === 'storage' ? m.storage : m.qualified_facility;
  const years = Object.keys(table).map(Number).sort((a, b) => a - b);
  const y = Math.min(Math.max(bocYear, years[0]), years.at(-1));
  return table[String(y)];
}

/** Storage credit fraction by BOC year (R3 G8–G11). */
function storageFraction(bocYear, R) {
  const p = T(R).storage_phaseout;
  if (bocYear <= p.boc_year_full) return 1;
  if (bocYear === p.boc_year_full + 1) return p.boc_2034;
  if (bocYear === p.boc_year_full + 2) return p.boc_2035;
  return p.boc_2036_on;
}

/**
 * The OBBBA eligibility gate for one technology.
 * input: {tech, boc (YYYY-MM-DD|null), bocMethod ('physical_work'|'five_pct'|null), pis (YYYY-MM-DD|null),
 *         pisSource ('queue'|'user'), mwAc, macr (0–1|null), taxpayerPFE (bool), asOf (YYYY-MM-DD)}
 * → {tech, state, row, label, reason, fraction (credit applied, 0 unless eligible), fractionIfPass, macr:{…}, src:[…]}
 */
export function taxGate(input, R) {
  const t = T(R), cut = t.wind_solar_cutoffs, meth = t.boc_methods, cont = t.boc_continuity;
  const { tech } = input || {};
  const boc = isDate(input?.boc) ? input.boc : null, pis = isDate(input?.pis) ? input.pis : null;
  const asOf = isDate(input?.asOf) ? input.asOf : new Date().toISOString().slice(0, 10);
  const src = [];
  const out = (state, row, reason, fractionIfPass, extra = {}) => ({
    tech, state, row, label: GATE_LABEL[state], reason, fraction: state === 'eligible' ? fractionIfPass : 0, fractionIfPass, src, ...extra,
  });
  if (!TECHS.includes(tech)) return out('open', null, `Technology "${tech ?? 'not set'}" has no credit rule here (solar, wind or storage).`, null);
  if (input.taxpayerPFE === true) { src.push('IRC §45Y(g)(13), §48E(d)(6) (R3 G0)'); return out('ineligible', 'G0', 'The taxpayer is a specified foreign or foreign-influenced entity: no credit.', 0); }

  // --- 1. Technology limb: storage phase-out, or the wind/solar termination -------------------------------
  let row, fractionIfPass = 1, reason, pending = null; // pending = a non-pass state decided before the MACR overlay
  if (tech === 'storage') {
    src.push(t.storage_phaseout.src);
    // No BOC: BOC is no later than PIS, so a PIS year inside the full-credit window settles it (R3 §2 default behaviour).
    const bocYear = boc ? yearOf(boc) : pis && yearOf(pis) <= t.storage_phaseout.boc_year_full ? yearOf(pis) : null;
    if (bocYear === null) return out('open', null, 'Storage credit depends on the construction-start year: enter the BOC date (or a PIS date).', null);
    fractionIfPass = storageFraction(bocYear, R);
    row = { 1: 'G8', [t.storage_phaseout.boc_2034]: 'G9', [t.storage_phaseout.boc_2035]: 'G10' }[fractionIfPass] || 'G11';
    if (fractionIfPass === 0) return out('ineligible', 'G11', `Storage that begins construction in ${bocYear} is past the phase-out.`, 0);
    reason = `Storage keeps its credit (carved out of the wind/solar termination); ${Math.round(fractionIfPass * 100)}% for construction beginning ${boc ? 'in' : 'by'} ${bocYear}${boc ? '' : ' (no start held; bounded by the PIS year)'}.`;
  } else {
    src.push(cut.src);
    const latestPis = boc ? `${yearOf(boc) + cont.years_after_boc_year}-12-31` : null;
    if (pis && pis <= cut.pis_by) {
      row = 'G1'; reason = `Placed in service ${pis}${input.pisSource === 'queue' ? ' (Queue COD)' : ''}, on or before ${cut.pis_by}: the statutory PIS limb is met.`;
    } else if (boc && boc <= cut.boc_by) {
      src.push(cont.src);
      const before = boc < meth.pre_notice_boc_before, small = tech === 'solar' && ok(input.mwAc) && input.mwAc <= meth.low_output_solar_mw_ac;
      if (input.bocMethod === 'physical_work' || (before && input.bocMethod === 'five_pct')) row = before && input.bocMethod === 'five_pct' ? 'G4' : 'G2';
      else if (input.bocMethod === 'five_pct' && small) { row = 'G6'; src.push(meth.src); }
      else if (input.bocMethod === 'five_pct') { row = 'G5'; src.push(`${t.notice_2025_42.src}: ${t.notice_2025_42.value}`); }
      else return out('open', null, `Construction began ${boc}, on or before ${cut.boc_by}: enter how it began (physical work or the 5% safe harbor).`, 1);
      if (!pis) return out('open', row, `Construction began ${boc}; enter the PIS date to test continuity (safe harbor: in service by ${latestPis}).`, 1);
      if (row === 'G4') src.push(meth.src);
      reason = `Construction began ${boc} (${input.bocMethod === 'physical_work' ? 'physical work' : '5% safe harbor'}), on or before ${cut.boc_by}`;
      if (pis > latestPis) { pending = 'review'; row = 'G3'; reason += `; in service ${pis} is after the continuity safe harbor (${latestPis}), so continuity rests on facts and circumstances.`; }
      else if (row === 'G5') { pending = 'contingent'; reason += `, on the 5% test only: valid while the 2026-06-06 vacatur of Notice 2025-42 holds (appeal or stay status unverified).`; }
      else reason += `; in service ${pis} is within the continuity safe harbor (${latestPis}).`;
    } else {
      if (!pis) return out('open', null, `Neither limb can be tested: enter the PIS date (Queue COD) or a construction start on or before ${cut.boc_by}.`, 1);
      return out('ineligible', 'G7', `${boc ? `Construction began ${boc}, after ${cut.boc_by}` : 'No construction start on or before the cut-off is held'}, and the project is placed in service ${pis}${input.pisSource === 'queue' ? ' (Queue COD)' : ''}, after ${cut.pis_by}.`, 0);
    }
  }

  // --- 2. Material-assistance overlay (M1 / M2): applies to construction beginning on or after applies_from_boc ----
  const m = t.material_assistance_thresholds;
  // No BOC held: construction has not begun, so it begins this year at the earliest (a later start raises the bar).
  const bocYearForMacr = boc ? yearOf(boc) : Math.max(yearOf(asOf), yearOf(m.applies_from_boc));
  const threshold = (boc && boc < m.applies_from_boc) ? null : macrThreshold(tech, bocYearForMacr, R);
  const macr = { threshold, year: bocYearForMacr, value: ok(input.macr) ? input.macr : null, applies: threshold !== null, assumedYear: !boc };
  if (macr.applies) {
    src.push(m.src);
    if (macr.value === null) return out('open', row, `${reason} The material-assistance cost ratio is not entered (needs ≥ ${Math.round(threshold * 100)}% for construction beginning in ${bocYearForMacr}); unknown never passes.`, fractionIfPass, { macr });
    if (macr.value < threshold) return out('ineligible', 'M1', `Material-assistance cost ratio ${Math.round(macr.value * 100)}% is below the ${Math.round(threshold * 100)}% required for construction beginning in ${bocYearForMacr}.`, 0, { macr });
    reason += ` Material assistance ${Math.round(macr.value * 100)}% meets ${Math.round(threshold * 100)}%.`;
  }
  return out(pending || 'eligible', row, reason, fractionIfPass, { macr });
}

/** Hybrid: evaluate the wind/solar part and the storage part separately (R3 §2, G12). */
export function taxGateHybrid(input, R, gen = 'solar') {
  return { generator: taxGate({ ...input, tech: gen }, R), storage: taxGate({ ...input, tech: 'storage' }, R) };
}

/** Domestic-content adjusted percentage required for a BOC date (R3 A3). */
export function domesticContentThreshold(boc, R) {
  if (!isDate(boc)) return null;
  for (const r of T(R).credit_adders.domestic_content.adjusted_pct_by_boc) if (r.boc_before === null || boc < r.boc_before) return r.pct;
  return null;
}

/**
 * Credit rates before the gate: ITC fraction of eligible basis and the 2026 PTC in $/kWh (R3 A1–A3, P1).
 * pwa null → rates not held (never guessed). Storage has no PTC.
 */
export function creditRates({ tech, pwa, mwAc, ec = false, dc = false }, R) {
  const t = T(R), a = t.credit_adders, small = ok(mwAc) && mwAc < t.small_facility_full_rate.mw_ac_below;
  const full = pwa === true || small;
  if (pwa !== true && pwa !== false && !small) return { itc: null, ptc2026: null, full: null, reason: 'Prevailing wage and apprenticeship not set' };
  const pts = k => (full ? a[k].itc_points_pwa : a[k].itc_points_no_pwa);
  const itc = (full ? t.itc_rate.pwa : t.itc_rate.no_pwa) + (ec ? pts('energy_community') : 0) + (dc ? pts('domestic_content') : 0);
  const ptcBase = full ? t.ptc_rate_2026.pwa : t.ptc_rate_2026.no_pwa;
  const ptc2026 = t.credit_choice[tech]?.includes('ptc') ? ptcBase * (1 + (ec ? a.energy_community.ptc_increase : 0) + (dc ? a.domestic_content.ptc_increase : 0)) : null;
  return { itc, ptc2026, full, small, choices: t.credit_choice[tech] || [] };
}

/** PTC $/kWh in a calendar year, escalated from the 2026 amount at the escalation rate (assumption, R3 A2). */
export function ptcRateFor(year, rate2026, R, escalation = T(R).ptc_escalation.value) {
  if (!ok(year) || !ok(rate2026) || !ok(escalation)) return null;
  return rate2026 * (1 + escalation) ** (year - T(R).ptc_rate_2026.year);
}

/**
 * Tax inputs from the UI state plus the project context, with the provenance of each field.
 * ui: user entries (S.ui.tax); ctx: {tech, mw, queueCod}. Only PWA has a default (met, labelled an assumption, per the
 * REGISTER "decided here" row); the PIS date comes from the Queue COD and says so; everything else is not held until entered.
 */
export function resolveTaxInputs(ui = {}, ctx = {}, R) {
  T(R);
  const prov = {}, input = { tech: ctx.tech, mwAc: ok(ctx.mw) ? ctx.mw : null, asOf: ctx.asOf };
  const user = (k, v) => { input[k] = v; prov[k] = { kind: 'user', label: 'entered' }; };
  if (ui.pwa === true || ui.pwa === false) user('pwa', ui.pwa);
  else { input.pwa = true; prov.pwa = { kind: 'assumption', label: 'Prevailing wage and apprenticeship met: assumed, change if not' }; }
  if (isDate(ui.pis)) user('pis', ui.pis);
  else if (isDate(ctx.queueCod)) { input.pis = ctx.queueCod; input.pisSource = 'queue'; prov.pis = { kind: 'queue', label: 'from the Queue COD' }; }
  // Queue's target COD is a whole year (S.ui.qCod): 31 Dec of that year decides both date tests exactly (PIS limb, continuity).
  else if (Number.isInteger(ctx.queueCod)) { input.pis = `${ctx.queueCod}-12-31`; input.pisSource = 'queue'; prov.pis = { kind: 'queue', label: `from the Queue COD year ${ctx.queueCod} (taken as 31 Dec)` }; }
  else { input.pis = null; prov.pis = { kind: 'not held', label: 'no COD from Queue; enter the PIS date' }; }
  if (isDate(ui.boc)) user('boc', ui.boc); else { input.boc = null; prov.boc = { kind: 'not held', label: 'no construction start held' }; }
  if (['physical_work', 'five_pct'].includes(ui.bocMethod)) user('bocMethod', ui.bocMethod); else { input.bocMethod = null; prov.bocMethod = { kind: 'not held', label: 'not entered' }; }
  if (ok(ui.macr) && ui.macr >= 0 && ui.macr <= 1) user('macr', ui.macr); else { input.macr = null; prov.macr = { kind: 'not held', label: 'not entered: unknown never passes' }; }
  for (const k of ['ec', 'dc']) { if (ui[k] === true) user(k, true); else { input[k] = false; prov[k] = { kind: 'off', label: 'off until you say it is met' }; } }
  if (ui.taxpayerPFE === true) user('taxpayerPFE', true); else { input.taxpayerPFE = false; prov.taxpayerPFE = { kind: 'assumption', label: 'taxpayer is not a specified foreign entity: assumed' }; }
  return { input, prov };
}

/** Every tax rule this module reads, with source, status and effective date, for the Evidence panel. */
export function citations(R) {
  const t = T(R), out = [];
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('_') || !v || typeof v !== 'object' || Array.isArray(v)) continue;
      if ('status' in v) out.push({ key: `${path}.${k}`, src: v.src, status: v.status, effective: v.effective || v.for || null, note: v.note || null });
      else walk(v, `${path}.${k}`);
    }
  };
  walk(t, 'tax');
  return out;
}
