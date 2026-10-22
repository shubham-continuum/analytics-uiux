import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchGrid } from '../dispatchgrid.js';
import { batteryDispatch, hybridDispatch } from '../economics.js';
import { batteryDispatch as batteryV1 } from './fixtures/economics-v1.mjs';

// Deterministic synthetic prices: daily sinusoid + noise (the review's method). Two weeks.
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const HOURS = 24 * 14;
const records = Array.from({ length: HOURS }, (_, i) => ({ timestamp: new Date(Date.UTC(2025, 5, 1, i)).toISOString().slice(0, 19), price: 45 + 30 * Math.sin((2 * Math.PI * (i % 24 - 9)) / 24) + 25 * (rnd() - 0.5), dtHours: 1 }));
const eta = Math.sqrt(0.86);
const cfg = (mw, mwh, charge, exp) => ({ capacityMW: mw, energyMWh: mwh, chargeMW: charge, importMW: charge, exportMW: exp, chargeEfficiency: eta, dischargeEfficiency: eta, cycleCostPerMWh: 0 });
const reference = c => batteryDispatch(records, { ...c, stepMWh: c.energyMWh / 1600 }).summary.netValue; // fine grid, short series

test('band-limited solver gives exactly the old full-search answer on the old grid', () => {
  for (const [mw, mwh, ch, ex, st] of [[100, 400, 6.7, 29.9, 65], [10, 20, 8, 10, 40], [50, 100, 50, 50, 37]]) {
    const a = batteryDispatch(records, { ...cfg(mw, mwh, ch, ex), socSteps: st }), b = batteryV1(records, { ...cfg(mw, mwh, ch, ex), socSteps: st });
    assert.equal(a.summary.netValue, b.summary.netValue, `${mw}/${mwh} ${ch}/${ex}`);
    assert.deepEqual(a.rows.map(r => r.socEndMWh), b.rows.map(r => r.socEndMWh));
  }
});

test('the tightest limit is exactly representable; the other is ≥ 95% usable', () => {
  const g = dispatchGrid({ energyMWh: 400, chargeMW: 6.7, dischargeMW: 100, exportMW: 29.9, etaC: eta, etaD: eta });
  assert.equal(g.feasible, true);
  assert.ok(Math.abs(g.usableChargeMW - 6.7) < 1e-6, `usable charge ${g.usableChargeMW}`);
  assert.ok(g.usableDischargeMW >= 0.95 * 29.9, `usable discharge ${g.usableDischargeMW}`);
  assert.ok(g.states >= 40 && g.states <= 1500);
});

for (const [name, mw, mwh, ch, ex] of [['20 MW charge (review: −43%)', 100, 400, 20, 100], ['15 MW charge (review: −26%)', 100, 400, 15, 100], ['9 MW charge, 200 MWh (review: −38%)', 100, 200, 9, 100], ['bus 100172 case', 100, 400, 6.7, 29.9]]) {
  test(`${name}: within 5% of a fine-grid reference`, () => {
    const c = cfg(mw, mwh, ch, ex), g = dispatchGrid({ energyMWh: mwh, chargeMW: ch, dischargeMW: mw, exportMW: ex, etaC: eta, etaD: eta });
    const v = batteryDispatch(records, { ...c, stepMWh: g.stepMWh }).summary.netValue, ref = reference(c);
    // The reference grid does not divide the limits exactly either, so it is not an upper bound: require ≥ 95% of it.
    assert.ok(v > 0.95 * ref, `${v.toFixed(0)} vs reference ${ref.toFixed(0)}`);
  });
}

test('hybrid at CF 5%, 8 h storage (review: $0 on 30 steps) is within 7% of reference and never $0', () => {
  const pv = 100, bm = 100, dur = 8, cf = 0.05;
  const shape = records.map(r => Math.max(0, Math.sin(((Number(r.timestamp.slice(11, 13)) - 6) * Math.PI) / 12)));
  const mean = shape.reduce((a, b) => a + b, 0) / shape.length;
  const recs = records.map((r, i) => ({ ...r, generationMW: Math.min(pv, (pv * cf * shape[i]) / mean) }));
  const hc = { renewableCapacityMW: pv, capacityMW: bm, energyMWh: bm * dur, exportMW: 60, importMW: 0, gridCharging: false, chargeEfficiency: eta, dischargeEfficiency: eta, cycleCostPerMWh: 0 };
  const g = dispatchGrid({ energyMWh: bm * dur, chargeMW: bm, dischargeMW: bm, exportMW: 60, etaC: eta, etaD: eta, solarMW: recs.map(r => r.generationMW) });
  const base = recs.reduce((t, r) => t + Math.min(r.generationMW, 60) * r.price, 0);
  const v = hybridDispatch(recs, { ...hc, stepMWh: g.stepMWh }).summary.netValue - base;
  const ref = hybridDispatch(recs, { ...hc, stepMWh: (bm * dur) / 2000 }).summary.netValue - base;
  assert.ok(g.feasible, g.reason);
  assert.ok(v > 0 && v > 0.93 * ref, `incremental ${v.toFixed(0)} vs reference ${ref.toFixed(0)}`);
});

test('a limit too small for the finest affordable grid is not assessed (never $0)', () => {
  const g = dispatchGrid({ energyMWh: 400, chargeMW: 0.1, dischargeMW: 100, exportMW: 100, etaC: eta, etaD: eta });
  assert.equal(g.feasible, false);
  assert.match(g.reason, /0\.1 MW/);
  assert.equal(dispatchGrid({ energyMWh: 0, chargeMW: 5, dischargeMW: 5, exportMW: 5, etaC: 1, etaD: 1 }).feasible, false);
});
