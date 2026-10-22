// Large-load (data-centre) rules for ISO-NE: the S6 flow. Pure functions over the loaded rules file
// (rules/isone-2026.json → large_load) and the Grid engine (gridrules.js). No DOM, no fetch, no typed constants.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, P2 slice S6) · 2026-10-06 · sign-off pending · v1
//
// Every rule here is the ISO-NE / PTO-AC PROPOSAL in FERC EL26-72, not tariff: each result carries the pending badge
// "pending §205 filing (due 2026-11-16, FERC EL26-72)" (decision D5: build now, labelled; re-verify 2026-11-17).
// Sources (REGISTER §5; R3 D1-D9 and §3.4):
//   threshold        ISO-NE RC/TC deck 2026-08-18/19 slides 6-9; 195 FERC ¶ 61,215 fn 2       (R3 D4)
//   FCDS/NFCDS/ICDS  ISO-NE RC/TC deck slides 10-31; PTO-AC deck 2026-09-15 slides 7, 14     (R3 D5)
//   BYONG / ICR      ISO-NE RC/TC deck slides 4, 16-17                                          (R3 D6)
//   CRA              PTO-AC deck 2026-09-15 slides 7-13                                         (R3 D7, §3.4)
//   RNS, Schedule 1  ISO-NE General Business Practices §2                                       (R3 D8)
//   Delivered cost   R3 §3.4 (replaces GAPS 4.12, which double counted RNS + FCDS)              (R3 D9)
// Null = not held + a reason, never 0. Unknown never passes a gate.
import { caseTable, binding, stepCostService, costCases, CASE_LABEL } from '../gridrules.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const DAY = 86400000;

/** The large_load block of the rules file (throws when the rules file has none: a wiring error, not a not-held). */
export function ll(rules) {
  const b = rules?.large_load;
  if (!b || typeof b !== 'object') throw new Error('rules.large_load missing: load rules/isone-2026.json');
  return b;
}

/** The one pending badge every S6 surface shows. */
export function pendingBadge(rules) {
  const f = ll(rules).filing;
  return { text: f.badge, status: 'pending', src: f.src, due: f.response_due, reverifyOn: f.reverify_on, docket: f.docket };
}

/** Is this a "Large Load" under the proposal? Gross peak ≥ threshold_mw AND POI ≥ threshold_kv (ISO-NE: inclusive). */
export function largeLoadScreen(rules, { grossPeakMW, poiKV } = {}) {
  const L = ll(rules), mwT = L.threshold_mw.value, kvT = L.threshold_kv.value, pending = pendingBadge(rules);
  const src = [L.threshold_mw.src, L.threshold_kv.note].join(' · ');
  const reasons = [];
  if (!ok(grossPeakMW)) reasons.push('Gross peak load not entered');
  if (!ok(poiKV)) reasons.push('Point-of-interconnection voltage not held for this bus');
  if (reasons.length) return { verdict: 'Large-load status not held', pass: null, reasons, thresholdMW: mwT, thresholdKV: kvT, src, pending };
  const mwOk = grossPeakMW >= mwT, kvOk = poiKV >= kvT;
  reasons.push(`Gross peak ${grossPeakMW} MW ${mwOk ? '≥' : '<'} ${mwT} MW`, `POI ${poiKV} kV ${kvOk ? '≥' : '<'} ${kvT} kV`);
  return mwOk && kvOk
    ? { verdict: 'Large load (proposed)', pass: true, reasons, thresholdMW: mwT, thresholdKV: kvT, src, pending }
    : { verdict: 'Below the proposed large-load threshold (served as ordinary network load)', pass: false, reasons, thresholdMW: mwT, thresholdKV: kvT, src, pending };
}

const serviceRow = (rules, code) => ll(rules).services.rows.find(r => r.code === code) || null;

/**
 * Withdrawal limit, firm and non-firm, from the existing withdrawal cases (gridrules: large-load and summer-peak charge).
 * Firm (FCDS): included in planning studies with every identified upgrade in service first, so it must hold in every
 * case: the binding (lowest) governing limit. Non-firm (NFCDS / ICDS): curtailable, studied with the load's flexibility;
 * the indication is the highest case limit (served above the firm limit only when the binding case's conditions do not
 * hold). It needs every case held; curtailment hours are not held.
 */
export function withdrawalLimits(grid, bus, mw, rules) {
  const pending = pendingBadge(rules), svc = ll(rules).services;
  const table = caseTable(grid, bus, 'datacenter', 0, mw), b = binding(table, 'import');
  const fits = b.status === 'Fits' ? true : b.status === 'Does not fit' ? false : null;
  const firm = { value: ok(b.value) ? b.value : null, status: b.status, fits, caseLabel: b.row?.label ?? null, basis: b.row?.basis ?? null,
    bound: b.status === 'Partly studied' ? 'upper' : 'exact',
    why: fits === null ? `${b.status}: firm service needs a governing limit in every withdrawal case` : '', service: 'FCDS', src: svc.src };
  const allHeld = table.length > 0 && table.every(r => ok(r.governing));
  const top = allHeld ? table.reduce((a, r) => (r.governing > a.governing ? r : a)) : null;
  const nonFirm = top
    ? { value: top.governing, caseLabel: top.label, service: 'NFCDS / ICDS', src: svc.src,
      why: 'Indicative: above the firm limit the load runs only when the binding case does not apply (curtailable); curtailment hours are not held' }
    : { value: null, caseLabel: null, service: 'NFCDS / ICDS', src: svc.src, why: 'Not held: every withdrawal case needs a governing limit before a non-firm indication is shown' };
  const aboveFirmMW = fits !== null && ok(firm.value) && ok(mw) ? Math.max(0, mw - firm.value) : null;
  let status;
  if (fits === true) status = 'Fits firm';
  else if (fits === false) status = ok(nonFirm.value) ? (mw <= nonFirm.value ? 'Non-firm only' : 'Exceeds both') : 'Does not fit firm';
  else status = 'Not established';
  return { requested: mw, firm, nonFirm, aboveFirmMW, status, table, pending };
}

/** CRA upgrade cost: the existing Grid rule (union over the large-load and summer-peak charge cases), never re-derived. */
export function upgradeCost(grid, bus, mw, rules) {
  const c = stepCostService(grid, bus, 'datacenter', 0, mw);
  return { ...c, cases: costCases('datacenter', 'import').map(k => CASE_LABEL[k]), src: 'gridrules.stepCostService (Grid › Upgrade cost: union of large-load and summer-peak charge cases)', pending: pendingBadge(rules) };
}

/**
 * Transmission service charge (R3 §3.4): FCDS = contract MW × 1000 × RNS_y; NFCDS / ICDS = Σ_m monthly peak MW × 1000 ×
 * RNS_y ÷ 12. A large load pays this INSTEAD of RNS (never both: rnsAdded is always false). Schedule 1 on the same kW.
 */
export function transmissionCharge(rules, { service, contractMW, monthlyPeaksMW, year } = {}) {
  const L = ll(rules), pending = pendingBadge(rules), svc = serviceRow(rules, service);
  const base = { service: svc?.name ?? null, code: service ?? null, rate: null, rateYear: year ?? null, billingKW: null, usd: null, rnsAdded: false, pending, src: `${L.rns_rate.src}; ${L.services.src}` };
  const s1 = L.schedule1_rate;
  if (!svc) return { ...base, why: 'Service type not chosen (FCDS, NFCDS or ICDS)', schedule1: { rate: s1.value, usd: null, why: 'Service type not chosen' } };
  const rate = L.rns_rate[String(year)];
  let billingKW = null, why = '', basis;
  if (svc.billing === 'contract_mw') {
    basis = 'contract MW × RNS rate';
    if (ok(contractMW) && contractMW > 0) billingKW = contractMW * 1000; else why = 'Contract MW not entered';
  } else {
    basis = 'Σ monthly peak MW × RNS rate ÷ 12';
    const m = Array.isArray(monthlyPeaksMW) ? monthlyPeaksMW : [];
    const held = m.filter(ok).length;
    if (m.length === 12 && held === 12) billingKW = (m.reduce((a, v) => a + v, 0) * 1000) / 12; else why = `Monthly peak MW not held for every month (${held} of 12)`;
  }
  const s1usd = ok(billingKW) ? billingKW * s1.value : null;
  const schedule1 = { rate: s1.value, usd: s1usd, effective: s1.effective, src: s1.src, status: s1.status, why: ok(s1usd) ? `$${s1.value}/kW-yr from ${s1.effective}, held flat` : why };
  if (!ok(rate)) return { ...base, basis, billingKW, why: `RNS rate for ${year} not held (the rules hold ${Object.keys(L.rns_rate).filter(k => /^\d{4}$/.test(k)).join(', ')})`, schedule1 };
  return { ...base, basis, rate, billingKW, usd: ok(billingKW) ? billingKW * rate : null, why, schedule1 };
}

/** CRA_y = max(0, carrying charge × upgrade cost − FCDS charge) (PTO-AC proposal). The carrying charge is not published. */
export function craCharge(rules, { upgrade, carryingCharge, fcdsUsd } = {}) {
  const C = ll(rules).cra, pending = pendingBadge(rules);
  const base = { usd: null, bound: null, formula: C.formula, src: C.src, pending, notes: [C.similar_upgrades, C.llif] };
  if (!ok(carryingCharge)) return { ...base, why: `Carrying charge ${C.carrying_charge_note.replace(/^Not published\.\s*/, 'not published (PTO-AC proposal). ')}` };
  if (!upgrade || !ok(upgrade.total) || ['Not requested'].includes(upgrade.status)) return { ...base, why: 'Large-load network upgrade cost not held' };
  if (!ok(fcdsUsd)) return { ...base, why: 'Transmission service charge not held, so the CRA offset cannot be taken' };
  const usd = Math.max(0, carryingCharge * upgrade.total * 1e6 - fcdsUsd);
  return { ...base, usd, bound: ['Lower bound', 'Partly priced'].includes(upgrade.status) ? 'lower' : 'exact', why: '' };
}

/**
 * F015: delivered cost stack for a load (R3 §3.4). Lines in a fixed order; each carries src and status; a line not held
 * is null + why, and the total of held lines is then a lower bound. energy = decisioncore loadCost {value, mean, importMW}.
 */
export function deliveredCostStack(rules, { service, contractMW, monthlyPeaksMW, year, energy, upgrade, carryingCharge, capacityUsd, llifUsd } = {}) {
  const L = ll(rules), pending = pendingBadge(rules);
  const tx = transmissionCharge(rules, { service, contractMW, monthlyPeaksMW, year });
  const capRow = L.capacity.rows.find(r => r.service === service);
  const eHeld = ok(energy?.value);
  const lines = [
    { key: 'energy', label: 'Energy at the load zone', usd: eHeld ? energy.value : null, why: eHeld ? `${energy.importMW} MW flat × $${energy.mean.toFixed(2)}/MWh × 8,760 h` : 'No energy cost on the applied basis', src: 'Settled RT prices at the bus (Decision › load cost, Market Rule 1)', ruleStatus: 'observed' },
    ok(capacityUsd)
      ? { key: 'capacity', label: 'Capacity (self-supply / BYONG)', usd: capacityUsd, why: 'User-entered self-supply cost', src: L.capacity.src, ruleStatus: 'assumption' }
      : { key: 'capacity', label: 'Capacity (self-supply / BYONG)', usd: null, why: `Not held: ${capRow?.text ?? 'service type not chosen'}`, src: L.capacity.src, ruleStatus: 'pending' },
    { key: 'transmission', label: `${tx.code ?? 'Transmission'} service charge (billed at the RNS rate, instead of RNS)`, usd: tx.usd, why: tx.why || tx.basis, src: tx.src, ruleStatus: 'pending' },
    { key: 'schedule1', label: 'Schedule 1 (scheduling and dispatch)', usd: tx.schedule1.usd, why: tx.schedule1.why, src: tx.schedule1.src, ruleStatus: tx.schedule1.status },
  ];
  const cra = craCharge(rules, { upgrade, carryingCharge, fcdsUsd: tx.usd });
  lines.push({ key: 'cra', label: 'Cost recovery agreement (CRA)', usd: cra.usd, why: cra.why || (cra.bound === 'lower' ? 'Lower bound: upgrade cost is a lower bound' : cra.formula), src: cra.src, ruleStatus: 'pending' });
  lines.push(ok(llifUsd)
    ? { key: 'llif', label: 'Sole-use interconnection facilities (annualised)', usd: llifUsd, why: 'User-entered', src: L.cra.src, ruleStatus: 'assumption' }
    : { key: 'llif', label: 'Sole-use interconnection facilities (annualised)', usd: null, why: `Not held: ${L.cra.llif}`, src: L.cra.src, ruleStatus: 'pending' });
  lines.push({ key: 'ancillary', label: 'Ancillary services and uplift', usd: null, why: 'Not held: load-side ancillary and uplift allocations are not in the workspace', src: 'R3 §3.4', ruleStatus: 'unverifiable' });
  lines.push({ key: 'local', label: 'Local / retail adders (utility delivery tariff)', usd: null, why: `Not held: ${L.local_adders.note}`, src: L.local_adders.src, ruleStatus: L.local_adders.status });
  const held = lines.filter(l => ok(l.usd)), heldTotal = held.length ? held.reduce((a, l) => a + l.usd, 0) : null;
  const mwh = eHeld && ok(energy.importMW) ? energy.importMW * 8760 : null;
  return { service, year, lines, heldTotal, notHeld: lines.length - held.length, bound: held.length === lines.length ? 'exact' : 'lower',
    perMWh: ok(heldTotal) && ok(mwh) && mwh > 0 ? heldTotal / mwh : null, transmission: tx, cra, pending };
}

const addDays = (iso, d) => { const t = Date.parse(`${iso}T00:00:00Z`); return Number.isFinite(t) ? new Date(t + d * DAY).toISOString().slice(0, 10) : null; };
export const TIMELINE_NOT_HELD = 'Large-load timeline not held: generator queue clocks do not apply to loads';

/** F017: load energisation timeline. Only the 90-day study is published (pending); the rest is not held, never filled. */
export function energisationTimeline(rules, { service = 'FCDS', applicationDate, upgradeInServiceDates } = {}) {
  const L = ll(rules), pending = pendingBadge(rules), days = L.study_days.value, svc = serviceRow(rules, service);
  const studyDone = applicationDate ? addDays(applicationDate, days) : null;
  const ups = Array.isArray(upgradeInServiceDates) ? upgradeInServiceDates : [];
  const upHeld = ups.filter(d => typeof d === 'string' && d), gate = svc?.upgrades_first !== false;
  const upDate = ups.length && upHeld.length === ups.length ? upHeld.slice().sort().at(-1) : null;
  const steps = [
    { step: 'Large-load study (ISO-NE / TO), from a complete application', days, date: studyDone, status: 'pending', src: L.study_days.src, why: applicationDate ? `${days} days (proposal), rolling, outside cluster studies` : 'No application date entered' },
    { step: 'Facilities study', days: null, date: null, status: 'not held', src: L.study_days.src, why: 'Duration not published in the proposal' },
    { step: 'Sole-use interconnection facilities: design and construction', days: null, date: null, status: 'not held', src: L.cra.src, why: 'Not held: PTO-specific, no duration published' },
    { step: gate ? 'Network upgrades in service (FCDS gate)' : 'Network upgrades in service (not a gate for this service)', days: null, date: upDate, status: upDate ? 'held' : 'not held', src: L.services.src,
      why: !ups.length ? 'Upgrade in-service dates the load depends on are not held' : upDate ? `Latest of ${ups.length} upgrade in-service dates` : `${upHeld.length} of ${ups.length} upgrade in-service dates held` },
  ];
  const energisation = { date: null, why: gate
    ? 'Firm service needs the facilities study, the sole-use facilities and every upgrade in service: those durations are not held'
    : 'Interim / non-firm service can start after the study and the sole-use facilities: construction duration not held' };
  return { service, studyDays: days, studyDone, steps, energisation, generatorClockApplies: false, message: TIMELINE_NOT_HELD, pending };
}

/** Rule citations for the Inspector's Evidence tab and the cards' footers. */
const CITE = [['filing', 'EL26-72 filing schedule'], ['threshold_mw', 'Large-load threshold (MW)'], ['threshold_kv', 'Large-load threshold (kV)'], ['services', 'FCDS / NFCDS / ICDS'],
  ['study_days', 'Large-load study duration'], ['cra', 'Cost recovery agreement'], ['capacity', 'Capacity (BYONG / ICR exclusion)'], ['local_adders', 'Local / retail adders'],
  ['rns_rate', 'RNS rate (billing rate for FCDS / NFCDS)'], ['schedule1_rate', 'Schedule 1 rate']];
export function citations(rules) {
  const L = ll(rules), badge = pendingBadge(rules).text;
  return CITE.filter(([k]) => L[k]).map(([k, label]) => ({ path: `large_load.${k}`, label, status: L[k].status, src: L[k].src, effective: L[k].effective ?? null, badge: L[k].status === 'pending' ? badge : null }));
}

/** One option through the whole DC flow. mw = the request (gross peak, flat load); kv = the POI bus voltage. */
export function dcFlow(rules, grid, { bus, mw, kv, service = 'FCDS', year, energy, applicationDate, carryingCharge = null, capacityUsd, llifUsd, monthlyPeaksMW, upgradeInServiceDates } = {}) {
  const peaks = Array.isArray(monthlyPeaksMW) ? monthlyPeaksMW : ok(mw) ? Array(12).fill(mw) : null; // flat load: every monthly peak = the request
  const screen = largeLoadScreen(rules, { grossPeakMW: mw, poiKV: kv });
  const withdrawal = withdrawalLimits(grid, bus, mw, rules);
  const upgrade = upgradeCost(grid, bus, mw, rules);
  const args = { service, contractMW: mw, monthlyPeaksMW: peaks, year };
  const transmission = transmissionCharge(rules, args);
  const cra = craCharge(rules, { upgrade, carryingCharge, fcdsUsd: transmission.usd });
  const stack = deliveredCostStack(rules, { ...args, energy, upgrade, carryingCharge, capacityUsd, llifUsd });
  const timeline = energisationTimeline(rules, { service, applicationDate, upgradeInServiceDates });
  return { bus: String(bus), mw, kv, service, year, services: ll(rules).services.rows, screen, withdrawal, upgrade, transmission, cra, stack, timeline, citations: citations(rules), pending: pendingBadge(rules) };
}
