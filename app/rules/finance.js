// S5 finance: labelled presets over rules/isone-2026/defaults.json (F004) and the after-tax project cash flow of
// R3-finance-tax-largeload.md §3: credits (ITC at year 0 or PTC years 1..term), the §50(c)(3) basis reduction, bonus /
// 5-year MACRS, tax at the blended rate, LCOE and LCOS from NPV = 0. Pure; the rules object R is passed in.
// Provenance: Claude Opus 5.5 (S5 agent) · one-studio/design (T3, P2 slice S5) · 2026-10-06 · sign-off pending · v1
//
// One home per quantity: NPV and IRR come from projectFinance (economics.js) run on the after-tax flows; the pre-tax
// LCOE cross-check is lcoe() from lcoe.js (the Economics LCOE). No finance input is ever filled silently: a value comes
// from the user, from a sent handoff (Economics revenue / MWh, Grid upgrades) or from a preset the user picked, and
// each carries that provenance. Without one of those the input is missing and nothing is computed.
import { projectFinance } from '../economics.js';
import { lcoe } from '../lcoe.js';
import { taxGate, creditRates, resolveTaxInputs, ptcRateFor, citations as taxCitations } from './tax.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const HOURS = 8760, KW_PER_MW = 1000, KWH_PER_MWH = 1000;
const at = (R, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), R);
const D = R => {
  if (!R || !R.defaults_atb2025 || !R.tax) throw new Error('rules/isone-2026.json not loaded (defaults_atb2025 / tax missing)');
  return R.defaults_atb2025;
};

// Presets: paths into the rules file only, never numbers. perKw = $/kW quantities scaled by the project MW.
const FIN = { discountRate: 'defaults_atb2025.finance.wacc_nominal', taxRate: 'defaults_atb2025.atb_finance.tax_rate', inflation: 'defaults_atb2025.atb_finance.inflation' };
const PRESETS = {
  'atb25-pv-c7': { tech: 'solar', label: 'NREL ATB 2025 Moderate · utility PV (tracking), resource class 7 · Lazard v19 WACC', block: 'pv_tracking',
    perKw: { capex: 'defaults_atb2025.pv_tracking.capex_per_kwac', annualOM: 'defaults_atb2025.pv_tracking.fom_per_kwac_yr' }, cf: 'defaults_atb2025.pv_tracking.cf_by_class.7', years: 'defaults_atb2025.atb_finance.crp_years' },
  'atb25-pv-c8': { tech: 'solar', label: 'NREL ATB 2025 Moderate · utility PV (tracking), resource class 8 · Lazard v19 WACC', block: 'pv_tracking',
    perKw: { capex: 'defaults_atb2025.pv_tracking.capex_per_kwac', annualOM: 'defaults_atb2025.pv_tracking.fom_per_kwac_yr' }, cf: 'defaults_atb2025.pv_tracking.cf_by_class.8', years: 'defaults_atb2025.atb_finance.crp_years' },
  'atb25-wind-c4': { tech: 'wind', label: 'NREL ATB 2025 Moderate · land-based wind, class 4 · Lazard v19 WACC', block: 'wind_onshore',
    perKw: { capex: 'defaults_atb2025.wind_onshore.capex_per_kw', annualOM: 'defaults_atb2025.wind_onshore.fom_per_kw_yr' }, cf: 'defaults_atb2025.wind_onshore.cf_class4', years: 'defaults_atb2025.atb_finance.crp_years' },
  'atb25-bess-4h': { tech: 'storage', label: 'NREL ATB 2025 Moderate · utility battery, 4-hour Li-ion · Lazard v19 WACC', block: 'battery_4h',
    perKw: { capex: 'defaults_atb2025.battery_4h.capex_per_kw', annualOM: 'defaults_atb2025.battery_4h.fom_per_kw_yr' }, cf: null, years: 'defaults_atb2025.battery_4h.life_years' },
};
const FIELDS = ['capex', 'annualOM', 'discountRate', 'years', 'taxRate', 'inflation'];
export const FIELD_LABEL = { capex: 'Capital cost (excl. grid upgrades)', annualOM: 'Fixed O&M, year 1', discountRate: 'Discount rate (nominal, after tax)', years: 'Operating years', taxRate: 'Tax rate (federal + state)', inflation: 'Escalation of O&M, revenue and PTC', energy: 'Energy per year', revenue: 'Revenue, year 1', transferPrice: 'Credit transfer price', bonus: 'Bonus depreciation' };

/** Presets offered for a technology: [{id, label, src, status}]. */
export function presetList(tech) {
  return Object.entries(PRESETS).filter(([, p]) => p.tech === tech).map(([id, p]) => ({ id, label: p.label, src: `${p.block === 'battery_4h' ? 'NREL ATB 2025 (battery_4h)' : `NREL ATB 2025 (${p.block})`}; WACC Lazard LCOE+ v19.0; tax rate and escalation NREL ATB 2025`, status: 'assumption' }));
}

/** Values and provenance from one preset, for an MW size; null for an unknown id. */
export function applyPreset(id, { mw }, R) {
  const p = PRESETS[id], d = D(R);
  if (!p || !ok(mw) || mw <= 0) return null;
  const prov = {}, values = {};
  const put = (k, v, path, block) => { values[k] = v; prov[k] = { kind: 'preset', label: p.label, preset: id, path, src: block.src, status: block.status }; };
  for (const [k, path] of Object.entries(p.perKw)) put(k, at(R, path) * mw * KW_PER_MW, path, d[p.block]);
  if (p.cf) put('cf', at(R, p.cf), p.cf, d[p.block]);
  put('years', at(R, p.years), p.years, p.years.includes('atb_finance') ? d.atb_finance : d[p.block]);
  put('discountRate', at(R, FIN.discountRate), FIN.discountRate, d.finance);
  for (const k of ['taxRate', 'inflation']) put(k, at(R, FIN[k]), FIN[k], d.atb_finance);
  return { id, label: p.label, tech: p.tech, values, prov };
}

/**
 * Finance inputs with provenance. fin = user entries (S.ui.fin: preset, capex, annualOM, discountRate, years, taxRate,
 * inflation, mwh, revenue, transferPrice, bonusElectOut); ctx = {tech, mw, sent:{revenue, mwh, dischargedMwh, chargeCost}, upgradeCapex}.
 */
export function resolveFinanceInputs(fin = {}, ctx = {}, R) {
  const t = R.tax, pre = fin.preset ? applyPreset(fin.preset, { mw: ctx.mw }, R) : null;
  const usable = pre && pre.tech === ctx.tech ? pre : null;
  const input = {}, prov = {}, missing = [];
  const valid = { capex: v => v >= 0, annualOM: v => v >= 0, discountRate: v => v > -1 && v < 1, years: v => Number.isInteger(v) && v >= 1 && v <= 60, taxRate: v => v >= 0 && v < 1, inflation: v => v > -1 && v < 1 };
  for (const k of FIELDS) {
    if (ok(fin[k]) && valid[k](fin[k])) { input[k] = fin[k]; prov[k] = { kind: 'user', label: 'entered' }; }
    else if (usable && ok(usable.values[k])) { input[k] = usable.values[k]; prov[k] = usable.prov[k]; }
    else { input[k] = null; prov[k] = { kind: 'not held', label: ok(fin[k]) ? 'invalid entry' : 'not entered and no preset picked' }; missing.push(k); }
  }
  const sent = ctx.sent || {};
  if (ctx.tech === 'storage') {
    input.mwh = ok(sent.dischargedMwh) ? sent.dischargedMwh : null;
    prov.energy = input.mwh === null ? { kind: 'not held', label: 'send a dispatch from Economics › Storage for LCOS' } : { kind: 'sent', label: 'discharged MWh from the Economics dispatch' };
  } else if (ok(fin.mwh) && fin.mwh >= 0) { input.mwh = fin.mwh; prov.energy = { kind: 'user', label: 'entered' }; }
  else if (ok(sent.mwh)) { input.mwh = sent.mwh; prov.energy = { kind: 'sent', label: 'MWh/yr sent from Economics (site profile)' }; }
  else if (usable && ok(usable.values.cf) && ok(ctx.mw)) {
    input.mwh = usable.values.cf * ctx.mw * HOURS;
    prov.energy = { ...usable.prov.cf, label: `${usable.label}: CF ${(100 * usable.values.cf).toFixed(2)}% × ${ctx.mw} MW × ${HOURS} h (degradation embedded in the ATB CF)` };
  } else { input.mwh = null; prov.energy = { kind: 'not held', label: 'send revenue from Economics or pick a preset' }; missing.push('energy'); }
  if (ok(fin.revenue)) { input.revenue = fin.revenue; prov.revenue = { kind: 'user', label: 'entered' }; }
  else if (ok(sent.revenue)) { input.revenue = sent.revenue; prov.revenue = { kind: 'sent', label: 'sent from an Economics revenue tab' }; }
  else { input.revenue = null; prov.revenue = { kind: 'not held', label: 'send revenue from a revenue tab: NPV and IRR need it' }; }
  input.chargeCost = ok(sent.chargeCost) ? sent.chargeCost : null;
  input.transferPrice = {};
  for (const m of ['itc', 'ptc']) {
    const u = fin.transferPrice?.[m];
    input.transferPrice[m] = ok(u) && u > 0 && u <= 1 ? u : t.transfer_price[m];
  }
  prov.transferPrice = ok(fin.transferPrice?.itc) || ok(fin.transferPrice?.ptc) ? { kind: 'user', label: 'entered' } : { kind: 'assumption', label: `${t.transfer_price.src} (assumption): ITC ${t.transfer_price.itc}, PTC ${t.transfer_price.ptc} per $1 of credit`, src: t.transfer_price.src, status: t.transfer_price.status };
  input.bonus = fin.bonusElectOut !== true;
  prov.bonus = fin.bonusElectOut === true ? { kind: 'user', label: `elected out: ${t.macrs_class_years.solar}-year MACRS, half-year (${t.macrs_5yr_half_year.src})` } : { kind: 'rule', label: `${Math.round(t.bonus_depreciation.value * 100)}% bonus, ${t.bonus_depreciation.for} (${t.bonus_depreciation.src})`, src: t.bonus_depreciation.src, status: t.bonus_depreciation.status };
  input.extraCapex = ok(ctx.upgradeCapex) && ctx.upgradeCapex >= 0 ? ctx.upgradeCapex : 0;
  prov.extraCapex = ok(ctx.upgradeCapex) ? { kind: 'sent', label: 'grid upgrades sent from Grid: in capital, outside the ITC basis and not depreciated (tax class unverifiable, R3 open question 3)' } : { kind: 'not held', label: 'no grid-upgrade scenario sent: capital excludes upgrades (NPV is an upper bound)' };
  return { input, prov, missing, preset: usable ? { id: usable.id, label: usable.label } : null, presetMismatch: !!pre && !usable };
}

/**
 * After-tax unlevered cash flow, years 0..N (R3 §3.1–3.2): capex and any ITC at year 0, operations 1..N.
 * inp: {capex, extraCapex, annualOM, rate, years, taxRate, inflation, mwh (number|array), revenue (number|array|null),
 *       chargeCost (number|null), bonus (bool), firstYear (calendar year of operating year 1, for the PTC),
 *       credit: {mode 'itc'|'ptc'|'none', rate (ITC fraction or PTC $/kWh in 2026), fraction (gate), transferPrice}}
 */
export function afterTaxCashFlow(inp, R) {
  const t = R.tax, { capex, annualOM, rate, years, taxRate, inflation = 0 } = inp, extra = ok(inp.extraCapex) ? inp.extraCapex : 0;
  const bad = reason => ({ state: 'invalid', reason, rows: [], npv: null, irr: null, lcoe: null, lcos: null, lcoePreTax: null });
  if (![capex, annualOM, rate, taxRate, inflation].every(ok) || !Number.isInteger(years) || years < 1 || capex < 0 || annualOM < 0 || rate <= -1) return bad('Capital, O&M, rate, tax rate, escalation and whole operating years are required.');
  const cr = inp.credit || { mode: 'none' }, mode = cr.mode === 'itc' || cr.mode === 'ptc' ? cr.mode : 'none';
  if (mode !== 'none' && ![cr.rate, cr.fraction, cr.transferPrice].every(ok)) return bad('Credit rate, gate fraction and transfer price are required for a credit.');
  const series = (v, grow) => (Array.isArray(v) ? (v.length >= years && v.slice(0, years).every(ok) ? v.slice(0, years) : null) : ok(v) ? Array.from({ length: years }, (_, k) => v * (grow ? (1 + inflation) ** k : 1)) : null);
  const mwh = series(inp.mwh, false), rev = series(inp.revenue, true), om = series(annualOM, true), chg = ok(inp.chargeCost) ? series(inp.chargeCost, true) : null;
  if (mode === 'ptc' && (!mwh || !Number.isInteger(inp.firstYear))) return bad('The PTC needs MWh per year and the first operating year (from the PIS date).');
  const itc = mode === 'itc' ? cr.rate * cr.fraction * capex : 0;
  const depBasis = capex - t.itc_basis_reduction.value * itc;
  const macrs = t.macrs_5yr_half_year.value, bonus = inp.bonus === false ? 0 : t.bonus_depreciation.value;
  const dep = k => (k === 0 ? bonus * depBasis : 0) + (k < macrs.length ? (1 - bonus) * depBasis * macrs[k] : 0);
  const rows = [{ year: 0, revenue: 0, om: 0, ebitda: 0, dep: 0, tax: 0, creditCash: mode === 'itc' ? cr.transferPrice * itc : 0, capex: capex + extra }];
  rows[0].cf = rows[0].creditCash - rows[0].capex;
  for (let k = 0; k < years; k++) {
    const revenue = rev ? rev[k] : 0, ebitda = revenue - om[k], d = dep(k), tax = taxRate * (ebitda - d);
    const ptc = mode === 'ptc' && k < t.ptc_term_years.value ? cr.transferPrice * cr.fraction * ptcRateFor(inp.firstYear + k, cr.rate, R) * mwh[k] * KWH_PER_MWH : 0;
    rows.push({ year: k + 1, revenue, om: om[k], ebitda, dep: d, tax, creditCash: ptc, capex: 0, mwh: mwh ? mwh[k] : null, cf: ebitda - tax + ptc });
  }
  const df = y => 1 / (1 + rate) ** y, PV = f => rows.reduce((s, r) => s + f(r) * df(r.year), 0);
  // Break-even price from NPV = 0 (R3 §3.4): [capex − PV(credit cash) − T·PV(D) + (1 − T)·PV(costs)] ÷ [(1 − T)·PV(E)]
  const levelised = (energy, extraCost) => {
    if (!energy) return null;
    const pvE = rows.reduce((s, r) => s + (r.year ? energy[r.year - 1] * df(r.year) : 0), 0);
    if (!(pvE > 0) || taxRate >= 1) return null;
    const pvCost = rows.reduce((s, r) => s + (r.year ? (r.om + (extraCost ? extraCost[r.year - 1] : 0)) * df(r.year) : 0), 0);
    return (capex + extra - PV(r => r.creditCash) - taxRate * PV(r => r.dep) + (1 - taxRate) * pvCost) / ((1 - taxRate) * pvE);
  };
  let npv = null, irr = null;
  if (rev) {
    const pf = projectFinance({ capex: -rows[0].cf, annualOM: 0, discountRate: rate, years, constructionYears: 0, annualRevenue: rows.slice(1).map(r => r.cf) });
    if (!pf.errors.length) { npv = pf.summary.npv; irr = pf.summary.irr; }
  }
  const pre = mwh ? lcoe({ capex: capex + extra, annualOM, rate, years, constructionYears: 0, mwh }) : { value: null };
  return { state: 'ok', rows, depBasis, itc, npv, irr, lcoe: levelised(mwh, null), lcos: chg ? levelised(mwh, chg) : null, lcoePreTax: pre.value };
}

/**
 * The whole S5 answer for one project: inputs with provenance, the tax gate, credit choice and the after-tax result.
 * ui = {fin: S.ui.fin, tax: S.ui.tax}; ctx = {tech, mw, queueCod, asOf, sent, upgradeCapex}.
 */
export function financeWithTax(ui = {}, ctx = {}, R) {
  const f = resolveFinanceInputs(ui.fin || {}, ctx, R);
  const tx = resolveTaxInputs(ui.tax || {}, { tech: ctx.tech, mw: ctx.mw, queueCod: ctx.queueCod, asOf: ctx.asOf }, R);
  const gate = taxGate(tx.input, R), rates = creditRates(tx.input, R);
  const base = { gate, taxInput: tx.input, taxProv: tx.prov, rates, input: f.input, prov: f.prov, preset: f.preset, presetMismatch: f.presetMismatch, missing: f.missing };
  const none = { npv: null, irr: null, lcoe: null, lcos: null, lcoePreTax: null, ifPass: null, byMode: {}, rows: [], breakEven: [] };
  if (!['solar', 'wind', 'storage'].includes(ctx.tech)) return { ...base, ...none, state: 'unsupported', reason: 'After-tax finance covers solar, wind and storage; for a hybrid, value the solar and storage parts separately.' };
  if (f.missing.length) return { ...base, ...none, state: 'incomplete' };
  const i = f.input, pisYear = tx.input.pis ? Number(tx.input.pis.slice(0, 4)) : null;
  const common = { capex: i.capex, extraCapex: i.extraCapex, annualOM: i.annualOM, rate: i.discountRate, years: i.years, taxRate: i.taxRate, inflation: i.inflation, mwh: i.mwh, revenue: i.revenue, chargeCost: i.chargeCost, bonus: i.bonus, firstYear: pisYear };
  const run = (mode, fraction) => afterTaxCashFlow({ ...common, credit: mode === 'none' ? { mode } : { mode, rate: mode === 'itc' ? rates.itc : rates.ptc2026, fraction, transferPrice: i.transferPrice[mode] } }, R);
  const pick = fraction => {
    const runs = Object.fromEntries((rates.choices || []).map(m => [m, run(m, fraction)]).filter(([, r]) => r.state === 'ok'));
    const key = r => (ok(r.npv) ? r.npv : ok(r.lcoe) ? -r.lcoe : ok(r.lcos) ? -r.lcos : -Infinity);
    const best = Object.entries(runs).sort((a, b) => key(b[1]) - key(a[1]))[0];
    return { runs, mode: best ? best[0] : 'none', r: best ? best[1] : run('none') };
  };
  const passes = gate.state === 'eligible' && gate.fraction > 0;
  const now = passes ? pick(gate.fraction) : { runs: {}, mode: 'none', r: run('none') };
  // Not passing: show the credit beside the as-gated answer, labelled. "if-pass" when the gate is open, contingent or under
  // review; "forgone" when the statute (G7) or material assistance (M1) removes a credit the technology would otherwise get.
  const altFraction = passes ? null : ok(gate.fractionIfPass) && gate.fractionIfPass > 0 ? gate.fractionIfPass : gate.state === 'ineligible' && ['G7', 'M1'].includes(gate.row) ? 1 : null;
  const alt = altFraction ? pick(altFraction) : null;
  const r = now.r, summary = x => ({ mode: x.mode, npv: x.r.npv, irr: x.r.irr, lcoe: x.r.lcoe, lcos: x.r.lcos });
  const isStorage = ctx.tech === 'storage';
  return {
    ...base, state: r.state === 'ok' ? 'ok' : 'invalid', reason: r.reason,
    credit: { mode: now.mode, rate: now.mode === 'itc' ? rates.itc : now.mode === 'ptc' ? rates.ptc2026 : null, fraction: passes ? gate.fraction : 0, transferPrice: now.mode === 'none' ? null : i.transferPrice[now.mode], cash: r.rows.reduce((s, x) => s + x.creditCash, 0) },
    byMode: Object.fromEntries(Object.entries(now.runs).map(([m, x]) => [m, { npv: x.npv, irr: x.irr, lcoe: x.lcoe, lcos: x.lcos }])),
    npv: r.npv, irr: r.irr, npvReason: ok(r.npv) ? null : 'Revenue not held: send it from an Economics revenue tab (or enter it).',
    lcoe: isStorage ? null : r.lcoe, lcoePreTax: isStorage ? null : r.lcoePreTax,
    lcos: isStorage ? r.lcos : null, lcosReason: isStorage && !ok(r.lcos) ? 'LCOS needs the discharged MWh and charging cost from an Economics storage dispatch.' : null,
    rows: r.rows, depBasis: r.depBasis, ifPass: alt ? { ...summary(alt), fraction: altFraction, kind: gate.state === 'ineligible' ? 'forgone' : 'if-pass' } : null,
    breakEven: breakEvenCapex({ ...common, credit: now.mode === 'none' ? { mode: 'none' } : { mode: now.mode, rate: now.mode === 'itc' ? rates.itc : rates.ptc2026, fraction: gate.fraction, transferPrice: i.transferPrice[now.mode] } }, ctx.mw, R),
  };
}

/** Maximum capital ($/kW) at NPV = 0 for the sensitivity rates (low, base, high). NPV is linear in capex, so two runs solve it. */
export function breakEvenCapex(inp, mw, R) {
  const s = D(R).discount_sensitivity, rates = [s.low, inp.rate, s.high];
  if (!ok(mw) || mw <= 0 || inp.revenue == null) return [];
  return rates.map(rate => {
    const a = afterTaxCashFlow({ ...inp, rate, capex: 0 }, R).npv, b = afterTaxCashFlow({ ...inp, rate, capex: KW_PER_MW * mw }, R).npv;
    const slope = ok(a) && ok(b) ? b - a : null; // NPV change per $/kW of capital
    return { rate, capexPerKw: ok(slope) && slope < 0 ? -a / slope : null };
  });
}

/** Sources behind every finance figure: the ATB / Lazard defaults plus the tax rules. */
export function citations(R) {
  const d = D(R), out = [];
  for (const [k, v] of Object.entries(d)) if (!k.startsWith('_') && v && typeof v === 'object' && 'status' in v) out.push({ key: `defaults_atb2025.${k}`, src: v.src, status: v.status, effective: null, note: v.note || null });
  return [...out, ...taxCitations(R)];
}
