import test from 'node:test';
import assert from 'node:assert/strict';
import { lcoe } from '../lcoe.js';

const pv = (flows, r) => flows.reduce((s, x, t) => s + x / (1 + r) ** t, 0);

test('no construction delay: classic CRF × capex + O&M over MWh', () => {
  const r = lcoe({ capex: 1000, annualOM: 10, rate: 0.08, years: 20, constructionYears: 0, mwh: Array(20).fill(100) });
  const crf = (0.08 * 1.08 ** 20) / (1.08 ** 20 - 1);
  assert.ok(Math.abs(r.value - (crf * 1000 + 10) / 100) < 1e-9);
});

test('construction delay: capital annuity from first operating year has PV = capex (not understated)', () => {
  const c = { capex: 1000, annualOM: 0, rate: 0.08, years: 20, constructionYears: 2, mwh: Array(20).fill(1) };
  const r = lcoe(c);
  const flows = [0, 0, 0, ...Array(20).fill(r.value)]; // price × 1 MWh in years 3..22
  assert.ok(Math.abs(pv(flows, 0.08) - 1000) < 1e-6, `PV ${pv(flows, 0.08)}`);
  assert.ok(r.value > lcoe({ ...c, constructionYears: 0 }).value);
});

test('declining output: PV(LCOE × MWh_t) = PV(costs)', () => {
  const mwh = Array.from({ length: 25 }, (_, t) => 100 * 0.995 ** t);
  const c = { capex: 5000, annualOM: 40, rate: 0.07, years: 25, constructionYears: 1, mwh };
  const r = lcoe(c);
  const rev = [0, 0, ...mwh.map(m => m * r.value)], cost = [5000, 0, ...Array(25).fill(40)];
  assert.ok(Math.abs(pv(rev, 0.07) - pv(cost, 0.07)) < 1e-6);
});

test('zero rate and missing MWh', () => {
  assert.ok(Math.abs(lcoe({ capex: 100, annualOM: 1, rate: 0, years: 10, constructionYears: 3, mwh: Array(10).fill(10) }).value - 1.1) < 1e-12); // (100 + 1×10) ÷ (10×10)
  assert.equal(lcoe({ capex: 100, annualOM: 1, rate: 0.05, years: 10, constructionYears: 0, mwh: null }).value, null);
});
