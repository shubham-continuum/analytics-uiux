// Economics v5 fuel routing: pure calculations (views/economics-fuel.js). Written before the module (TDD).
// Null = not held, never 0; assumptions are labelled; the bridge and stacks sum to their totals.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { econTabLabel, loadCostStack, loadFlex, bessBridge, projectRuns, dcacSweep, pvCost, ECON_PRESETS, monthlyCost } from '../views/economics-fuel.js';
import { recRevenue, capacityPath } from '../rules/revenue.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const day = (date, prices) => prices.map((p, h) => ({ timestamp: `${date}T${String(h).padStart(2, '0')}:00:00-05:00`, price: p, dtHours: 1 }));

test('econTabLabel: tab 1 follows the fuel; BESS / hybrid tabs for a load become load flex / not applicable; Finance on cost', () => {
  assert.equal(econTabLabel('revenue', 'datacenter'), 'Load cost');
  assert.equal(econTabLabel('revenue', 'storage'), 'Storage revenue');
  assert.equal(econTabLabel('revenue', 'hybrid'), 'Hybrid PV revenue');
  assert.equal(econTabLabel('revenue', 'wind'), 'Wind revenue');
  assert.equal(econTabLabel('revenue', 'solar'), 'Solar revenue');
  assert.equal(econTabLabel('bess', 'datacenter'), 'Load flex');
  assert.equal(econTabLabel('hybrid', 'datacenter'), 'Hybrid (n/a)');
  assert.equal(econTabLabel('hybrid', 'hybrid'), 'Hybrid as one asset');
  assert.equal(econTabLabel('finance', 'datacenter'), 'Cost finance');
  assert.equal(econTabLabel('finance', 'solar'), null);
});

test('loadCostStack: energy measured; capacity an assumption; transmission not held (null, never 0); totals say what they include', () => {
  const s = loadCostStack({ energy: 5e6, mw: 50, capPrice: 3.58, obligationPct: 100 });
  assert.equal(s.rows.length, 3);
  assert.deepEqual(s.rows.map(r => r.status), ['measured', 'assumption', 'not held']);
  close(s.rows[1].value, 50 * 1000 * 3.58 * 12);
  assert.equal(s.rows[2].value, null);
  close(s.measured, 5e6); close(s.withAssumptions, 5e6 + 50 * 1000 * 3.58 * 12);
  assert.equal(s.complete, false);
  // No energy on the basis: nothing is held.
  const n = loadCostStack({ energy: null, mw: 50, capPrice: 3.58, obligationPct: 100 });
  assert.equal(n.measured, null); assert.equal(n.withAssumptions, null);
});

test('monthlyCost: cost, MWh and mean per calendar month of a flat load', () => {
  const m = monthlyCost([...day('2025-01-01', [10, 20]), ...day('2025-02-01', [30])], 2);
  assert.equal(m.length, 2);
  close(m[0].cost, 60); close(m[0].mwh, 4); close(m[0].mean, 15); close(m[1].cost, 60);
});

test('loadFlex: moving a share of the load from the N dearest to the N cheapest hours each day', () => {
  const p = [...day('2025-01-01', [1, 2, 3, 4, 10, 20, 30, 40]), ...day('2025-01-02', [5, 5, 5, 5, 5, 5, 5, 5])];
  const f = loadFlex(p, { mw: 100, sharePct: 10, hours: 2 });
  assert.equal(f.days, 2);
  // Day 1: dearest 2 mean 35, cheapest 2 mean 1.5 → 10 MW × 2 h × 33.5; day 2 zero.
  close(f.saving, 10 * 2 * 33.5);
  close(f.savingYr, (10 * 2 * 33.5) * 365 / 2);
  close(f.meanSpread, 33.5 / 2);
  assert.equal(loadFlex(p, { mw: 0, sharePct: 10, hours: 2 }).saving, null);
  assert.equal(loadFlex(day('2025-01-01', [1, 2, 3]), { mw: 10, sharePct: 10, hours: 2 }).days, 0);
});

test('bessBridge: gross ceiling → round-trip loss → dispatch vs benchmark → cycling cost → degradation, steps sum to the net', () => {
  // P2 C28: the loss is (1 − RTE) × the top-hour revenue (1300), not × the whole spread (the old −140 encoded that defect).
  const b = bessBridge({ ceiling: 1000, topGross: 1300, rte: 0.86, dispatchFree: 700, dispatchNet: 650, degPct: 2 });
  assert.deepEqual(b.steps.map(s => s.key), ['ceiling', 'rte', 'schedule', 'cycling', 'degradation', 'net']);
  close(b.steps[1].value, -182); close(b.steps[2].value, 700 - 818); close(b.steps[3].value, -50); close(b.steps[4].value, -13);
  close(b.net, 637);
  close(b.steps.slice(0, 5).reduce((t, s) => t + s.value, 0), b.net);
  assert.equal(bessBridge({ ceiling: null, topGross: 1300, rte: 0.86, dispatchFree: 700, dispatchNet: 650, degPct: 2 }).steps[1].value, null);
});

test('projectRuns: each held run benchmark scaled by the basis dispatch ÷ benchmark ratio; not held stays null', () => {
  const r = projectRuns([{ label: 'a', y: 2030, bench: 100 }, { label: 'b', y: 2035, bench: null }], 0.7);
  close(r[0].value, 70); assert.equal(r[1].value, null);
  assert.equal(projectRuns([{ label: 'a', y: 2030, bench: 100 }], null)[0].value, null);
});

test('dcacSweep: clipped energy share at each DC:AC ratio from an unclipped AC-scaled profile', () => {
  const u = [0, 50, 80, 50, 0];
  const s = dcacSweep(u, [1, 1, 1, 1, 1], 100, [1, 1.25, 1.5]);
  close(s[0].clippedMWh, 0); close(s[1].clippedMWh, 0);
  close(s[2].clippedMWh, 20); close(s[2].share, 100 * 20 / 270);
  close(s[2].deliveredMWh, 250);
});

test('pvCost: present value and levelised cost of an energy cost stream with escalation', () => {
  const c = pvCost({ annual: 100, mwh: 10, rate: 0.1, years: 2, escalation: 0 });
  close(c.pv, 100 / 1.1 + 100 / 1.21); close(c.levelised, (100 / 1.1 + 100 / 1.21) / (10 / 1.1 + 10 / 1.21));
  const e = pvCost({ annual: 100, mwh: 10, rate: 0, years: 2, escalation: 0.05 });
  close(e.pv, 205); assert.equal(e.rows.length, 2);
  assert.equal(pvCost({ annual: null, mwh: 10, rate: 0.1, years: 2 }).pv, null);
});

test('ECON_PRESETS: base = the cited defaults; conservative and aggressive are the ext/75 low/high CF cases; REC and capacity come from the rules file', () => {
  for (const k of ['base', 'conservative', 'aggressive']) { assert.ok(ECON_PRESETS[k].note); assert.ok(ECON_PRESETS[k].ui.econ); }
  assert.equal(ECON_PRESETS.base.ui.econ.solarCF, 15); assert.equal(ECON_PRESETS.conservative.ui.econ.solarCF, 14); assert.equal(ECON_PRESETS.aggressive.ui.econ.solarCF, 16);
  // S2-EM (W-B close-out): the old assertion pinned REC $21.79 / capacity $3.98 typed from ext/75 into the presets; that
  // encoded the defect (two homes for a market price). No preset types a REC or capacity price; both come from
  // rules/revenue.js over rules/isone-2026.json, so the value the view shows is the rules file's value.
  for (const p of Object.values(ECON_PRESETS)) { assert.ok(!('rec' in p.ui.econ), `${p.label} types a REC price`); assert.ok(!('capacityPrice' in p.ui.econ), `${p.label} types a capacity price`); }
  const R = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url), 'utf8'));
  const rec = recRevenue(R, { state: 'MA', tech: 'solar', mwh: 1 });
  assert.equal(rec.status, 'ok'); assert.equal(rec.value, Math.min(R.recs_ma.class1_price_default.low, R.recs_ma.class1_acp.value));
  const cap = capacityPath(R, { tech: 'solar', mw: 100, cod: 2029, years: 3 }).rows[0];
  assert.equal(cap.price, R.capacity.price_path_default.low); assert.match(cap.priceTag, /user path/);
  assert.ok(!/\b(21\.79|3\.98|29\.32|3\.58)\b/.test(readFileSync(new URL('../views/economics-fuel.js', import.meta.url), 'utf8')), 'a hand-typed REC or capacity price remains in economics-fuel.js');
});
