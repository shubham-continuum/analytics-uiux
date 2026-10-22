// S6 large-load rules (rules/largeload.js): thresholds, firm / non-firm withdrawal, RNS-rated FCDS/NFCDS charges,
// CRA, the F015 delivered cost stack, the F017 energisation timeline, citations and grid columns. Pure: no DB.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, P2 slice S6) · 2026-10-06 · sign-off pending · v1
// Numbers asserted here come from R3 (D4-D9, §3.4) and REGISTER §5; every rule is pending the EL26-72 §205 filing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../rules/largeload.js';
import { largeLoadColumns } from '../columns/largeload.js';

const RULES = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const BADGE = 'pending §205 filing (due 2026-11-16, FERC EL26-72)';
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

// Synthetic grid: one bus, two withdrawal cases, element limits 400 (large load) and 200 (summer-peak charge).
const row = (scenario, transfer, extra = {}) => ({ bus_id: 9, scenario, direction: 'charge', monitored_facility: `F-${scenario}-${transfer}`, binding_contingency: 'C1', contingency_id: 1,
  dfax: 0.2, transfer_mw: transfer, base_flow_mw: 50, contingency_flow_mw: 60, rating_a_mva: 100, rating_c_mva: 100, pct_loading_no_transfer: 60, fix_cost_musd: 12, length_miles: 3, ...extra });
const GRID = {
  headroom: [{ bus_id: 9, scenario: 'large_load', direction: 'charge', headroom_mw: 420 }, { bus_id: 9, scenario: 'summer_peak', direction: 'charge', headroom_mw: 210 }],
  constraints: [row('large_load', 400), row('summer_peak', 200)],
};

test('the pending badge is the one text from the rules file', () => {
  assert.equal(L.pendingBadge(RULES).text, BADGE);
  assert.equal(L.pendingBadge(RULES).status, 'pending');
});

test('large-load screen reads threshold_mw / threshold_kv (inclusive, ISO-NE proposal); unknown never passes', () => {
  assert.equal(RULES.large_load.threshold_mw.value, 50);
  assert.equal(RULES.large_load.threshold_kv.value, 69);
  const yes = L.largeLoadScreen(RULES, { grossPeakMW: 300, poiKV: 345 });
  assert.equal(yes.pass, true); assert.match(yes.verdict, /Large load \(proposed\)/); assert.equal(yes.pending.text, BADGE);
  assert.equal(L.largeLoadScreen(RULES, { grossPeakMW: 50, poiKV: 69 }).pass, true, '≥ on both');
  assert.equal(L.largeLoadScreen(RULES, { grossPeakMW: 49.9, poiKV: 345 }).pass, false);
  assert.equal(L.largeLoadScreen(RULES, { grossPeakMW: 300, poiKV: 34.5 }).pass, false);
  const nh = L.largeLoadScreen(RULES, { grossPeakMW: 300, poiKV: null });
  assert.equal(nh.pass, null); assert.match(nh.verdict, /not held/i);
});

test('withdrawal: firm = lowest case (FCDS needs every case), non-firm = highest case, MW above firm is curtailable', () => {
  const w = L.withdrawalLimits(GRID, 9, 300, RULES);
  assert.equal(w.firm.value, 200); assert.equal(w.firm.fits, false); assert.match(w.firm.caseLabel, /Summer peak/);
  assert.equal(w.nonFirm.value, 400); assert.match(w.nonFirm.caseLabel, /Large load/);
  assert.equal(w.aboveFirmMW, 100);
  assert.equal(w.status, 'Non-firm only');
  assert.equal(w.pending.text, BADGE);
  const small = L.withdrawalLimits(GRID, 9, 150, RULES);
  assert.equal(small.status, 'Fits firm'); assert.equal(small.aboveFirmMW, 0);
  assert.equal(L.withdrawalLimits(GRID, 9, 500, RULES).status, 'Exceeds both');
});

test('withdrawal: a case not studied leaves non-firm not held and firm unproven (never a pass)', () => {
  const g = { headroom: [], constraints: [row('large_load', 400)] };
  const w = L.withdrawalLimits(g, 9, 300, RULES);
  assert.equal(w.nonFirm.value, null); assert.ok(w.nonFirm.why.length > 0);
  assert.notEqual(w.firm.fits, true);
  assert.notEqual(w.status, 'Fits firm');
});

test('CRA upgrade cost is the existing union rule (stepCostService over large-load + summer-peak charge)', () => {
  const c = L.upgradeCost(GRID, 9, 450, RULES);
  assert.equal(c.status, 'Priced'); assert.equal(c.total, 24); assert.equal(c.items.length, 2);
  assert.deepEqual(c.cases.sort(), ['Large load · import', 'Summer peak · charge']);
  assert.equal(L.upgradeCost(GRID, 9, 150, RULES).status, 'True zero');
});

test('transmission: FCDS = contract MW × RNS; L-C1 corrected: 100 MW firm = $17.76M (2026), $18.36M (2027)', () => {
  const t26 = L.transmissionCharge(RULES, { service: 'FCDS', contractMW: 100, year: 2026 });
  assert.ok(near(t26.usd, 17762722)); assert.equal(t26.rnsAdded, false); assert.equal(t26.rate, 177.62722);
  const t27 = L.transmissionCharge(RULES, { service: 'FCDS', contractMW: 100, year: 2027 });
  assert.ok(near(t27.usd, 18359911));
  assert.ok(near(t26.schedule1.usd, 187420), 'Schedule 1 $1.8742/kW-yr × 100,000 kW');
});

test('transmission: NFCDS / ICDS = Σ monthly peak × RNS ÷ 12; a missing month or rate year is not held, never 0', () => {
  const flat = L.transmissionCharge(RULES, { service: 'NFCDS', monthlyPeaksMW: Array(12).fill(100), year: 2026 });
  assert.ok(near(flat.usd, 17762722));
  const ic = L.transmissionCharge(RULES, { service: 'ICDS', monthlyPeaksMW: [...Array(11).fill(100), 40], year: 2026 });
  assert.ok(near(ic.usd, (1100 + 40) * 1000 * 177.62722 / 12));
  const gap = L.transmissionCharge(RULES, { service: 'NFCDS', monthlyPeaksMW: [...Array(11).fill(100), null], year: 2026 });
  assert.equal(gap.usd, null); assert.match(gap.why, /month/i);
  const y = L.transmissionCharge(RULES, { service: 'FCDS', contractMW: 100, year: 2029 });
  assert.equal(y.usd, null); assert.match(y.why, /2029/);
});

test('CRA = max(0, carrying charge × upgrades − FCDS); PTO-AC worked example $56.6M; no carrying charge → not held', () => {
  // PTO-AC deck example (illustrative inputs supplied by the test, never by the rules): $500M × 15% − 100 MW × $184.21/kW-yr
  const ex = L.craCharge(RULES, { upgrade: { status: 'Priced', total: 500 }, carryingCharge: 0.15, fcdsUsd: 100000 * 184.21 });
  assert.ok(near(ex.usd, 56579000)); assert.equal(ex.bound, 'exact');
  assert.equal(L.craCharge(RULES, { upgrade: { status: 'Priced', total: 10 }, carryingCharge: 0.15, fcdsUsd: 18e6 }).usd, 0);
  const nh = L.craCharge(RULES, { upgrade: { status: 'Priced', total: 500 }, carryingCharge: null, fcdsUsd: 18e6 });
  assert.equal(nh.usd, null); assert.match(nh.why, /not published/);
  const lb = L.craCharge(RULES, { upgrade: { status: 'Lower bound', total: 100 }, carryingCharge: 0.15, fcdsUsd: 0 });
  assert.equal(lb.bound, 'lower');
  assert.equal(RULES.large_load.cra.carrying_charge, null, 'the rules file never holds the illustrative rate');
});

test('F015 delivered cost stack: one transmission line (never RNS + FCDS), not-held lines named, total is a lower bound', () => {
  const s = L.deliveredCostStack(RULES, { service: 'FCDS', contractMW: 100, year: 2026, energy: { value: 50e6, mean: 57.08, importMW: 100 },
    upgrade: { status: 'True zero', total: 0, items: [] } });
  const keys = s.lines.map(l => l.key);
  assert.deepEqual(keys, ['energy', 'capacity', 'transmission', 'schedule1', 'cra', 'llif', 'ancillary', 'local']);
  assert.equal(s.lines.filter(l => /RNS|FCDS|NFCDS/.test(l.label)).length, 1);
  const tx = s.lines.find(l => l.key === 'transmission'); assert.ok(near(tx.usd, 17762722));
  for (const k of ['capacity', 'llif', 'ancillary', 'local']) { const l = s.lines.find(x => x.key === k); assert.equal(l.usd, null, k); assert.ok(l.why, k); }
  assert.equal(s.lines.find(l => l.key === 'cra').usd, null, 'carrying charge not published');
  assert.equal(s.bound, 'lower');
  assert.ok(near(s.heldTotal, 50e6 + 17762722 + 187420));
  assert.ok(near(s.perMWh, s.heldTotal / (100 * 8760), 1e-6));
  for (const l of s.lines) { assert.ok(l.src, `${l.key} src`); assert.ok(l.ruleStatus, `${l.key} status`); }
  assert.equal(s.pending.text, BADGE);
});

test('F015: no energy input → energy not held; a user capacity figure is labelled an assumption', () => {
  const s = L.deliveredCostStack(RULES, { service: 'NFCDS', monthlyPeaksMW: Array(12).fill(100), year: 2026, capacityUsd: 1e6 });
  assert.equal(s.lines.find(l => l.key === 'energy').usd, null);
  const cap = s.lines.find(l => l.key === 'capacity'); assert.equal(cap.usd, 1e6); assert.equal(cap.ruleStatus, 'assumption');
  assert.equal(s.perMWh, null, 'no MWh without energy');
});

test('F017 energisation timeline: 90-day large-load study (pending), the rest not held, no generator clock', () => {
  const t = L.energisationTimeline(RULES, { service: 'FCDS', applicationDate: '2026-12-01' });
  assert.equal(t.studyDays, 90); assert.equal(t.studyDone, '2027-03-01');
  assert.equal(t.energisation.date, null); assert.ok(t.energisation.why);
  assert.equal(t.generatorClockApplies, false);
  assert.equal(t.message, 'Large-load timeline not held: generator queue clocks do not apply to loads');
  assert.ok(t.steps.some(s => /upgrades in service/i.test(s.step) && s.date === null));
  const ic = L.energisationTimeline(RULES, { service: 'ICDS', applicationDate: null });
  assert.equal(ic.studyDone, null); assert.match(ic.steps[0].why, /application/i);
  const up = L.energisationTimeline(RULES, { service: 'FCDS', applicationDate: '2026-12-01', upgradeInServiceDates: ['2029-06-01', null] });
  assert.match(up.steps.find(s => /upgrades in service/i.test(s.step)).why, /1 of 2/);
});

test('citations(): every cited rule carries src + status, pending ones carry the badge; thresholds are cited', () => {
  const c = L.citations(RULES);
  const paths = c.map(x => x.path);
  for (const p of ['large_load.threshold_mw', 'large_load.threshold_kv', 'large_load.services', 'large_load.study_days', 'large_load.cra', 'large_load.rns_rate', 'large_load.schedule1_rate'])
    assert.ok(paths.includes(p), p);
  for (const x of c) { assert.ok(x.src, x.path); assert.ok(x.status, x.path); if (x.status === 'pending') assert.equal(x.badge, BADGE, x.path); }
});

test('columns: DC-only defs with ids, units, pending badge; not held → null + why, never 0', () => {
  const cols = largeLoadColumns({ rules: RULES, gridFor: () => GRID, sizeMW: () => 300, service: () => 'FCDS', year: () => 2026 });
  const ids = cols.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ['ll_firm', 'll_nonfirm', 'll_above_firm', 'll_upgrade', 'll_tx']);
  for (const c of cols) { assert.deepEqual(c.fuels, ['dc']); assert.equal(c.badge, BADGE); assert.ok(c.source); assert.equal(typeof c.get, 'function'); assert.equal(typeof c.why, 'function'); }
  const r = { n: { bus_id: 9 } }, by = Object.fromEntries(cols.map(c => [c.id, c]));
  assert.equal(by.ll_firm.get(r), 200); assert.equal(by.ll_nonfirm.get(r), 400); assert.equal(by.ll_above_firm.get(r), 100);
  assert.equal(by.ll_upgrade.get(r), 12); assert.ok(near(by.ll_tx.get(r), 300000 * 177.62722 / 1e6, 1e-6));
  const empty = largeLoadColumns({ rules: RULES, gridFor: () => ({ headroom: [], constraints: [] }), sizeMW: () => 300, service: () => 'FCDS', year: () => 2026 });
  const e = Object.fromEntries(empty.map(c => [c.id, c]));
  assert.equal(e.ll_firm.get(r), null); assert.match(e.ll_firm.why(r), /not/i);
  assert.equal(e.ll_upgrade.get(r), null);
});
