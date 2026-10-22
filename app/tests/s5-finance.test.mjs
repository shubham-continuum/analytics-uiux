// S5 finance: labelled presets (F004), after-tax cash flow with ITC/PTC, basis reduction, bonus/MACRS, LCOE/LCOS (R3 §3).
// Provenance: Claude Opus 5.5 (S5 agent) · one-studio/design (T3, P2 slice S5) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presetList, applyPreset, resolveFinanceInputs, afterTaxCashFlow, financeWithTax, breakEvenCapex, citations } from '../rules/finance.js';
import { taxGate } from '../rules/tax.js';
import { lcoe as lcoePreTax } from '../lcoe.js';

const R = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
const pv = (xs, r) => xs.reduce((s, x, t) => s + x / (1 + r) ** t, 0);

test('F004: presets are named and sourced, and every value comes from defaults.json', () => {
  const list = presetList('solar');
  assert.ok(list.length >= 2); for (const p of list) { assert.match(p.label, /NREL ATB 2025/); assert.ok(p.src); }
  const d = R.defaults_atb2025;
  const p = applyPreset('atb25-pv-c7', { mw: 100 }, R);
  assert.equal(p.values.capex, d.pv_tracking.capex_per_kwac * 100 * 1000);
  assert.equal(p.values.annualOM, d.pv_tracking.fom_per_kwac_yr * 100 * 1000);
  assert.equal(p.values.cf, d.pv_tracking.cf_by_class['7']);
  assert.equal(p.values.discountRate, d.finance.wacc_nominal);
  assert.equal(p.values.taxRate, d.atb_finance.tax_rate);
  assert.equal(p.values.years, d.atb_finance.crp_years);
  for (const k of Object.keys(p.values)) { assert.equal(p.prov[k].kind, 'preset'); assert.ok(p.prov[k].src, k); assert.ok(p.prov[k].path, k); }
  assert.equal(applyPreset('atb25-bess-4h', { mw: 50 }, R).values.years, d.battery_4h.life_years);
  assert.equal(applyPreset('nope', { mw: 1 }, R), null);
  assert.deepEqual(presetList('datacenter'), []);
});

test('F004: no default ever fills a finance input — without a preset or entry the field is missing and nothing is computed', () => {
  const r = resolveFinanceInputs({}, { tech: 'solar', mw: 100 }, R);
  assert.deepEqual([...r.missing].sort(), ['annualOM', 'capex', 'discountRate', 'energy', 'inflation', 'taxRate', 'years'].sort());
  for (const k of ['capex', 'annualOM', 'discountRate', 'years', 'taxRate']) { assert.equal(r.input[k], null); assert.equal(r.prov[k].kind, 'not held'); }
  const f = financeWithTax({ fin: {}, tax: {} }, { tech: 'solar', mw: 100, queueCod: '2029-06-01', asOf: '2026-10-06' }, R);
  assert.equal(f.state, 'incomplete'); assert.equal(f.npv, null); assert.ok(f.missing.length >= 6);
});

test('F004: one click — the preset alone gives LCOE; with sent revenue it gives NPV and IRR', () => {
  const ctx = { tech: 'solar', mw: 100, queueCod: '2029-06-01', asOf: '2026-10-06', sent: { revenue: 9e6 } };
  const f = financeWithTax({ fin: { preset: 'atb25-pv-c7' }, tax: {} }, ctx, R);
  assert.equal(f.state, 'ok');
  assert.ok(Number.isFinite(f.npv) && Number.isFinite(f.irr) && Number.isFinite(f.lcoe));
  assert.equal(f.prov.capex.kind, 'preset'); assert.equal(f.prov.revenue.kind, 'sent'); assert.equal(f.prov.energy.kind, 'preset');
  const noRev = financeWithTax({ fin: { preset: 'atb25-pv-c7' }, tax: {} }, { ...ctx, sent: {} }, R);
  assert.equal(noRev.state, 'ok'); assert.equal(noRev.npv, null); assert.match(noRev.npvReason, /revenue/i); assert.ok(Number.isFinite(noRev.lcoe));
  const user = financeWithTax({ fin: { preset: 'atb25-pv-c7', capex: 150e6 }, tax: {} }, ctx, R);
  assert.equal(user.prov.capex.kind, 'user'); assert.equal(user.input.capex, 150e6);
});

test('the gate drives the credit: a 2029 Queue COD solar project gets none; the "if the gate passes" scenario is labelled beside it', () => {
  const ctx = { tech: 'solar', mw: 100, queueCod: '2029-06-01', asOf: '2026-10-06', sent: { revenue: 9e6 } };
  const f = financeWithTax({ fin: { preset: 'atb25-pv-c7' }, tax: {} }, ctx, R);
  assert.equal(f.gate.state, 'ineligible'); assert.equal(f.credit.mode, 'none');
  assert.ok(f.ifPass && f.ifPass.npv > f.npv, 'the credit scenario is better and shown separately');
  const old = financeWithTax({ fin: { preset: 'atb25-pv-c7' }, tax: { boc: '2026-05-01', bocMethod: 'physical_work', macr: 0.8 } }, ctx, R);
  assert.equal(old.gate.state, 'eligible'); assert.ok(['itc', 'ptc'].includes(old.credit.mode)); close(old.npv, Math.max(old.byMode.itc.npv, old.byMode.ptc.npv));
});

test('ITC math: credit cash = p × rate × basis at year 0; depreciable basis = basis − 50% × ITC; 100% bonus in year 1', () => {
  const t = R.tax, inp = { capex: 100e6, annualOM: 0, rate: 0.08, years: 10, taxRate: 0.25, inflation: 0, mwh: 200000, revenue: 0, bonus: true,
    credit: { mode: 'itc', rate: t.itc_rate.pwa, fraction: 1, transferPrice: t.transfer_price.itc } };
  const r = afterTaxCashFlow(inp, R);
  close(r.rows[0].creditCash, 0.9 * 0.3 * 100e6);
  close(r.depBasis, 100e6 * (1 - 0.5 * 0.3));
  close(r.rows[1].dep, 85e6); assert.equal(r.rows[2].dep, 0);
  close(r.rows[0].cf, -100e6 + 27e6);
  close(r.rows[1].cf, 0.25 * 85e6, 1e-9);
  const noBonus = afterTaxCashFlow({ ...inp, bonus: false }, R);
  close(noBonus.rows.slice(1, 7).reduce((s, x) => s + x.dep, 0), 85e6);
  close(noBonus.rows[1].dep, 85e6 * t.macrs_5yr_half_year.value[0]);
  const ineligible = afterTaxCashFlow({ ...inp, credit: { mode: 'none' } }, R);
  close(ineligible.depBasis, 100e6); assert.equal(ineligible.rows[0].creditCash, 0);
  const nonElig = afterTaxCashFlow({ ...inp, extraCapex: 10e6 }, R);
  close(nonElig.rows[0].creditCash, 27e6, 1e-9); close(nonElig.rows[0].capex, 110e6);
});

test('PTC: years 1..10 only, p × rate × kWh, escalated from 2026 by calendar year', () => {
  const inp = { capex: 1e6, annualOM: 0, rate: 0.07, years: 12, taxRate: 0, inflation: 0, mwh: 1000, revenue: 0, bonus: true, firstYear: 2028,
    credit: { mode: 'ptc', rate: 0.031, fraction: 1, transferPrice: 0.92 } };
  const r = afterTaxCashFlow(inp, R);
  close(r.rows[1].creditCash, 0.92 * 0.031 * 1.025 ** 2 * 1000 * 1000);
  close(r.rows[10].creditCash, 0.92 * 0.031 * 1.025 ** 11 * 1e6);
  assert.equal(r.rows[11].creditCash, 0);
  assert.equal(afterTaxCashFlow({ ...inp, firstYear: null }, R).state, 'invalid', 'PTC needs the first operating year');
});

test('LCOE (after tax, R3 §3.4) is the flat price at which after-tax NPV = 0; pre-tax cross-check is lcoe.js', () => {
  const inp = { capex: 140e6, annualOM: 2.3e6, rate: 0.077, years: 30, taxRate: 0.2574, inflation: 0.025, mwh: 206000, bonus: true,
    credit: { mode: 'itc', rate: 0.3, fraction: 1, transferPrice: 0.9 } };
  const r = afterTaxCashFlow({ ...inp, revenue: null }, R);
  assert.ok(r.lcoe > 0);
  const atLcoe = afterTaxCashFlow({ ...inp, revenue: Array(30).fill(r.lcoe * 206000) }, R);
  assert.ok(Math.abs(atLcoe.npv) < 1, `NPV at LCOE = ${atLcoe.npv}`);
  const flat = lcoePreTax({ capex: 140e6, annualOM: 2.3e6, rate: 0.077, years: 30, constructionYears: 0, mwh: Array(30).fill(206000) });
  close(r.lcoePreTax, flat.value);
  // NPV and IRR are projectFinance's (one home): IRR is the rate where NPV of the after-tax flows is zero
  const rr = afterTaxCashFlow({ ...inp, revenue: 12e6 }, R);
  close(pv(rr.rows.map(x => x.cf), rr.irr), 0, 1e-4);
  close(pv(rr.rows.map(x => x.cf), 0.077), rr.npv, 1e-6);
});

test('LCOS: charging cost and discharged MWh; not held without them', () => {
  const inp = { capex: 67e6, annualOM: 2.4e6, rate: 0.077, years: 15, taxRate: 0.2574, inflation: 0.025, mwh: 60000, revenue: null, bonus: true, credit: { mode: 'itc', rate: 0.3, fraction: 1, transferPrice: 0.9 } };
  const a = afterTaxCashFlow({ ...inp, chargeCost: 1.5e6 }, R), b = afterTaxCashFlow(inp, R);
  assert.ok(a.lcos > 0 && b.lcos === null);
  const s = financeWithTax({ fin: { preset: 'atb25-bess-4h' }, tax: { boc: '2027-03-01', macr: 0.7 } }, { tech: 'storage', mw: 50, asOf: '2026-10-06', sent: {} }, R);
  assert.equal(s.lcos, null); assert.match(s.lcosReason, /dispatch|discharg/i);
  assert.equal(s.lcoe, null, 'storage has no energy-only LCOE');
});

test('break-even capital ($/kW at NPV = 0) at the sensitivity rates; needs revenue', () => {
  const inp = { capex: 140e6, annualOM: 2.3e6, rate: 0.077, years: 30, taxRate: 0.2574, inflation: 0.025, mwh: 206000, revenue: 12e6, bonus: true, credit: { mode: 'none' } };
  const be = breakEvenCapex(inp, 100, R);
  assert.deepEqual(be.map(x => x.rate), [0.06, 0.077, 0.1]);
  const at = be[1].capexPerKw * 100 * 1000;
  assert.ok(Math.abs(afterTaxCashFlow({ ...inp, capex: at }, R).npv) < 1);
  assert.ok(be[0].capexPerKw > be[2].capexPerKw);
  assert.deepEqual(breakEvenCapex({ ...inp, revenue: null }, 100, R), []);
});

test('citations(): finance defaults are sourced, and presets name their source', () => {
  const c = citations(R);
  assert.ok(c.some(x => x.key === 'defaults_atb2025.pv_tracking' && x.status === 'assumption'));
  assert.ok(c.some(x => x.key === 'defaults_atb2025.finance' && /Lazard/.test(x.src)));
  for (const x of c) assert.ok(x.src && x.status, x.key);
});

test('no hand-typed finance constants in rules/finance.js', () => {
  const src = readFileSync(new URL('../rules/finance.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const lit of ['1405', '0.077', '0.2574', '0.025', '0.9', '0.92', '0.5 *', '23.18', '1344']) assert.ok(!src.includes(lit), `literal ${lit} in finance.js`);
});

test('gate from tax.js and financeWithTax agree (one home for the verdict)', () => {
  const ctx = { tech: 'solar', mw: 100, queueCod: '2029-06-01', asOf: '2026-10-06', sent: { revenue: 9e6 } };
  const f = financeWithTax({ fin: { preset: 'atb25-pv-c7' }, tax: {} }, ctx, R);
  const g = taxGate({ ...f.taxInput }, R);
  assert.equal(f.gate.state, g.state); assert.equal(f.gate.row, g.row);
});
