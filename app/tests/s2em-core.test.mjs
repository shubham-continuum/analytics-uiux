// S2-EM correctness blockers (Economics, Market, Land, Prices): one test per acceptance item. Written before the code.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S2-EM) · 2026-10-06 · sign-off pending · v1
// Findings F002, F007, F008, F011, F014, F018 and FORMULAS §10 D4, D5, D8, D10, D11 (_ux/Findings.md, _ux/FORMULAS.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { revenueStack, connectionCap, seriesUsable, USABLE_RULE } from '../economics-stack.js';
import { contractInputs, contractSettlement, contractPath, CONTRACT_FIELDS } from '../economics-contract.js';
import { chargeLimits, isPeakHour, chargeCaps, peakWindowLabel } from '../economics-charge.js';
import { batteryDispatch } from '../economics.js';
import { screen, layerState, fit, landStatus, siteExclusionNote, landScreenCount } from '../landcore.js';
import { solarWindowLabel, MART_SOLAR_WINDOW } from '../solar.js';
import { analyzePrices, quantile, QUANTILE_METHOD } from '../prices.js';
import { MEASURES, MARKET_SOLAR_WINDOW, populationRule, POPULATION_RULE } from '../marketcore.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);

// ---------------- F002: one labelled revenue stack ----------------
test('F002: the stack says what the headline includes, and lists what it leaves out', () => {
  const s = revenueStack({ energy: 6.7e6, rec: 3.7e6, capacity: 0.3e6 }, ['energy', 'rec'], { conditional: { capacity: 'capacity case not studied' } });
  near(s.total, 10.4e6);
  assert.deepEqual(s.includes, ['energy', 'rec']);
  assert.deepEqual(s.excluded, ['capacity']);
  assert.equal(s.short, 'Energy + RECs');
  assert.equal(s.label, 'Energy $6.7M + RECs $3.7M = $10.4M/yr · Capacity $300k/yr excluded (capacity case not studied)');
});
test('F002: an included stream that is not held is named, never added as $0', () => {
  const s = revenueStack({ energy: 6.7e6, rec: null, capacity: 0.3e6 }, ['energy', 'rec'], { reasons: { rec: 'REC price not held for Connecticut Class I' } });
  near(s.total, 6.7e6);
  assert.deepEqual(s.includes, ['energy']); assert.deepEqual(s.missing, ['rec']);
  assert.equal(s.short, 'Energy only (RECs not held)');
  assert.match(s.label, /^Energy \$6\.7M = \$6\.7M\/yr · RECs not held \(REC price not held for Connecticut Class I\)/);
  assert.equal(s.rows.find(r => r.key === 'rec').status, 'missing');
});
test('F002 (W-B): a stream outside the headline that is not held is still named with its reason, never silently dropped', () => {
  const s = revenueStack({ energy: 6.7e6, rec: 3.7e6, capacity: null }, ['energy', 'rec'], { reasons: { capacity: 'COD not held: enter the first operating year' } });
  near(s.total, 10.4e6); assert.deepEqual(s.excluded, []); assert.deepEqual(s.outsideMissing, ['capacity']);
  assert.equal(s.label, 'Energy $6.7M + RECs $3.7M = $10.4M/yr · Capacity not held (COD not held: enter the first operating year)');
  assert.equal(s.short, 'Energy + RECs', 'the short form names only the headline streams');
});
test('F002: nothing held → total not held (null), never 0', () => {
  const s = revenueStack({ energy: null }, ['energy']);
  assert.equal(s.total, null); assert.equal(s.short, 'not held');
});
test('F002: a true zero stream is held and printed as $0', () => {
  const s = revenueStack({ energy: 5e6, rec: 0 }, ['energy', 'rec']);
  assert.deepEqual(s.includes, ['energy', 'rec']); assert.match(s.label, /RECs \$0 /);
});

// ---------------- D10: cap = min(nameplate, limit) ----------------
test('D10: the connection cap is min(nameplate, export limit) and the label says which binds', () => {
  const a = connectionCap(100, 197.8);
  assert.equal(a.value, 100); assert.equal(a.binds, 'nameplate');
  assert.equal(a.label, 'min(nameplate 100 MW, export limit 197.8 MW) = 100 MW');
  const b = connectionCap(250, 197.8);
  assert.equal(b.value, 197.8); assert.equal(b.binds, 'limit');
  const c = connectionCap(100, null);
  assert.equal(c.value, 100); assert.equal(c.binds, 'nameplate'); assert.equal(c.conditional, true);
  assert.match(c.label, /export limit not held/);
});

// ---------------- D8: one usable-year rule ----------------
test('D8: a settled year missing any hour is excluded with its reason (the Prices basis rule); runs need 95% of the model calendar', () => {
  const y2020 = { mode: 'historical', market: 'RT', year: 2020, complete: false, coverage: 8783 / 8784, expectedHours: 8784 };
  const u = seriesUsable(y2020);
  assert.equal(u.usable, false); assert.match(u.why, /8,783 of 8,784 hours/);
  assert.equal(seriesUsable({ mode: 'historical', complete: true, coverage: 1 }).usable, true);
  assert.equal(seriesUsable({ mode: 'forecast', complete: false, coverage: 0.9945 }).usable, true);
  assert.equal(seriesUsable({ mode: 'forecast', complete: false, coverage: 0.9 }).usable, false);
  assert.match(USABLE_RULE, /every hour/);
});

// ---------------- F011: contract inputs ----------------
test('F011: contract fields are user inputs with no default value', () => {
  for (const f of CONTRACT_FIELDS) assert.ok(!('default' in f) || f.default == null, `${f.k} has a default`);
  const c = contractInputs({});
  assert.equal(c.complete, false);
  assert.deepEqual(c.missing, ['PPA price', 'Settlement point', 'Contracted share', 'Tenor', 'Escalator']);
});
test('F011: node-settled contract = share × MWh × PPA + (1 − share) × merchant', () => {
  const rows = [{ timestamp: '2025-06-01T12:00:00-04:00', price: 40, generationMW: 10, dtHours: 1 }, { timestamp: '2025-06-01T13:00:00-04:00', price: -5, generationMW: 20, dtHours: 1 }];
  const r = contractSettlement(rows, { ppaPrice: 50, settlement: 'node', sharePct: 60, tenorYears: 10, escalatorPct: 0 });
  assert.equal(r.status, 'ok');
  near(r.contractedMWh, 18); near(r.ppaRevenue, 900); near(r.merchantRevenue, 0.4 * (400 - 100)); near(r.basis, 0); near(r.total, 900 + 120);
});
test('F011: hub-settled contract adds share × Σ g × (node − hub); a missing hub hour is not held', () => {
  const rows = [{ timestamp: 'a', price: 40, generationMW: 10, dtHours: 1 }, { timestamp: 'b', price: 30, generationMW: 10, dtHours: 1 }];
  const hub = { a: 45, b: 32 };
  const r = contractSettlement(rows, { ppaPrice: 50, settlement: 'hub', sharePct: 100, tenorYears: 10, escalatorPct: 0 }, t => hub[t] ?? null);
  near(r.basis, 10 * (40 - 45) + 10 * (30 - 32)); near(r.total, 1000 - 70);
  const miss = contractSettlement(rows, { ppaPrice: 50, settlement: 'hub', sharePct: 100, tenorYears: 10, escalatorPct: 0 }, t => (t === 'a' ? 45 : null));
  assert.equal(miss.status, 'missing'); assert.equal(miss.total, null);
});
test('F011: incomplete inputs → not entered, no total (never a silent default)', () => {
  const r = contractSettlement([{ timestamp: 'a', price: 40, generationMW: 10, dtHours: 1 }], { ppaPrice: 50 });
  assert.equal(r.status, 'not entered'); assert.equal(r.total, null); assert.match(r.reason, /Settlement point/);
});
test('F011: contract path escalates the PPA price through the tenor, then a merchant tail', () => {
  const p = contractPath({ ppaPrice: 50, settlement: 'node', sharePct: 50, tenorYears: 2, escalatorPct: 2 }, 3, { merchant: 1000, mwh: 20, basis: 0 });
  near(p[0].value, 0.5 * 20 * 50 + 0.5 * 1000); near(p[1].value, 0.5 * 20 * 51 + 0.5 * 1000); near(p[2].value, 1000);
  assert.equal(p[2].kind, 'merchant tail');
});

// ---------------- F008: charging capped by the studied charge limits ----------------
const W = { months: [6, 7, 8, 9], heFrom: 14, heTo: 18 };
test('F008: the summer-peak hour set is hour-ending HE14–HE18, June–September', () => {
  assert.equal(isPeakHour('2025-07-01T13:00:00-04:00', W), true); // HE14
  assert.equal(isPeakHour('2025-07-01T17:00:00-04:00', W), true); // HE18
  assert.equal(isPeakHour('2025-07-01T18:00:00-04:00', W), false); // HE19
  assert.equal(isPeakHour('2025-05-31T14:00:00-04:00', W), false);
  assert.equal(peakWindowLabel(W), 'Jun–Sep, HE14–HE18');
});
test('F008: Hatchville acceptance: summer-peak charging never above 20.4 MW; shoulder governs the other hours', () => {
  const recs = ['2025-07-01T13:00:00-04:00', '2025-07-01T03:00:00-04:00', '2025-01-01T13:00:00-05:00'].map(t => ({ timestamp: t }));
  const c = chargeCaps(recs, { nameplate: 100, shoulder: { value: 100.4, envelopeOnly: true }, peak: { value: 20.4 }, window: W });
  assert.deepEqual(c.caps, [20.4, 100, 100]);
  assert.equal(c.peakHours, 1); assert.equal(c.applied, true);
  assert.match(c.governing, /Shoulder charge governs/); assert.match(c.governing, /20\.4 MW in summer-peak hours/);
  assert.equal(c.conditional, true, 'the shoulder limit is envelope only, so results are conditional');
});
test('F008: no window or no peak element limit → shoulder cap only, and the reason is stated', () => {
  const recs = [{ timestamp: '2025-07-01T13:00:00-04:00' }];
  const a = chargeCaps(recs, { nameplate: 100, shoulder: { value: 100.4 }, peak: { value: 20.4 }, window: null });
  assert.deepEqual(a.caps, [100]); assert.equal(a.applied, false); assert.match(a.note, /window is not in the rules file/);
  const b = chargeCaps(recs, { nameplate: 100, shoulder: { value: null }, peak: { value: null }, window: W });
  assert.deepEqual(b.caps, [100]); assert.equal(b.conditional, true); assert.match(b.governing, /not established/);
});
test('F008: chargeLimits reads the shoulder case (envelope only) and the summer-peak element limit', () => {
  const grid = {
    headroom: [{ bus_id: 1, scenario: 'shoulder', direction: 'charge', headroom_mw: 100.4 }, { bus_id: 1, scenario: 'summer_peak', direction: 'charge', headroom_mw: 43.9 }],
    constraints: [{ bus_id: 1, scenario: 'summer_peak', direction: 'charge', monitored_facility: 'X 115kV', transfer_mw: 20.4, pct_loading_no_transfer: 80 }],
  };
  const l = chargeLimits(grid, 1, 100);
  near(l.shoulder.value, 100.4); assert.equal(l.shoulder.envelopeOnly, true);
  near(l.peak.value, 20.4); assert.equal(l.peak.basis, 'Element study'); near(l.peak.envelope, 43.9); assert.equal(l.peak.facility, 'X 115kV');
});
test('F008: dispatch never charges above the per-hour cap', () => {
  const recs = Array.from({ length: 6 }, (_, i) => ({ timestamp: `2025-07-01T${String(10 + i).padStart(2, '0')}:00:00Z`, price: i < 3 ? 0 : 100, dtHours: 1, chargeCapMW: i === 1 ? 5 : 100 }));
  const r = batteryDispatch(recs, { capacityMW: 10, energyMWh: 20, chargeEfficiency: 1, dischargeEfficiency: 1, stepMWh: 1 });
  assert.deepEqual(r.errors, []);
  for (const [i, row] of r.rows.entries()) assert.ok(row.chargeMW <= recs[i].chargeCapMW + 1e-9, `hour ${i} charged ${row.chargeMW}`);
  near(r.rows[1].chargeMW, 5);
});

// ---------------- F007 / F014 / F018: land ----------------
const EX = { 7: { radius_mi: 3, disc_acres: 18093.8, clear_acres: 9591.8, clear_blocks: 31, water_excluded: false, layers: [
  { layer: 'habitat', acres: 0, share: 0, subtracted: true }, { layer: 'protected', acres: 8392.5, share: 0.464, subtracted: true }, { layer: 'airport', acres: 16190.2, share: 0.895, subtracted: false }] } };
test('F007: a 0-acre layer with no declared coverage is not held, never "0 ac"', () => {
  const sc = screen(EX, 7);
  const h = sc.subtracted.find(l => l.layer === 'habitat');
  assert.equal(h.status, 'missing'); assert.equal(h.value, null); assert.match(h.reason, /not screened here/);
  assert.deepEqual(sc.unscreened, ['habitat']);
  assert.equal(sc.subtracted.find(l => l.layer === 'protected').status, 'ok');
  const declared = layerState({ layer: 'habitat', acres: 0 }, { habitat: true });
  assert.equal(declared.status, 'ok'); assert.equal(declared.value, 0);
});
test('F007: fit names the unscreened layer in its caveat', () => {
  const f = fit({ low: 500, base: 560, high: 700 }, screen(EX, 7));
  assert.equal(f.status, 'fits'); assert.match(f.caveat, /habitat not screened here/);
});
test('F014: land status per bus: unscreened = not held, never "clear"', () => {
  const intensity = { by_fuel: { solar: { low_acres_per_mw: 5, base_acres_per_mw: 5.6, high_acres_per_mw: 7 } } };
  const a = landStatus({ exclusions: EX, intensity }, 7, 'solar', 100);
  assert.equal(a.status, 'fits'); assert.match(a.label, /habitat not screened/);
  const b = landStatus({ exclusions: EX, intensity }, 8, 'solar', 100);
  assert.equal(b.status, 'missing'); assert.equal(b.label, 'land not screened');
  const c = landStatus(null, 7, 'solar', 100);
  assert.equal(c.status, 'missing'); assert.match(c.label, /not loaded/);
  assert.deepEqual(landScreenCount({ exclusions: EX }, [{ bus_id: 7 }, { bus_id: 8 }]), { held: 1, of: 2 });
});
test('F018: a placed site says its position against exclusions is unknown (shapes not held)', () => {
  assert.equal(siteExclusionNote(screen(EX, 7), { lat: 41.6, lon: -70.5 }).status, 'missing');
  assert.match(siteExclusionNote(screen(EX, 7), { lat: 41.6, lon: -70.5 }).text, /Position against exclusions is unknown: shapes not held/);
  assert.equal(siteExclusionNote(screen(EX, 7), null), null);
  assert.match(siteExclusionNote(null, { lat: 1, lon: 1 }).text, /No exclusion screen/);
});

// ---------------- D5: one solar-window label ----------------
test('D5: one solar-window label format, and Market uses the mart window', () => {
  assert.equal(solarWindowLabel(MART_SOLAR_WINDOW), 'HE10–HE17 (hours beginning 9–16, 8 h)');
  assert.deepEqual(MARKET_SOLAR_WINDOW, MART_SOLAR_WINDOW, 'Market and Prices use the same window');
  assert.match(MEASURES.solwin30.label, /HE10–HE17/);
});
// Lead wiring W5 landed (S2-D, 2026-10-07): the server's SQL window is the same one, so this is a real check now.
test('D5: api_market.SOLAR_HOURS equals the mart window (one home)', () => {
  const py = readFileSync(new URL('../api_market.py', import.meta.url), 'utf8');
  const m = /SOLAR_HOURS\s*=\s*\((\d+),\s*(\d+)\)/.exec(py);
  assert.ok(m, 'api_market.SOLAR_HOURS not found');
  assert.deepEqual([Number(m[1]), Number(m[2])], [MART_SOLAR_WINDOW.hbFrom, MART_SOLAR_WINDOW.hbTo], 'api_market.SOLAR_HOURS differs from the mart window (Lead wiring W5)');
});

// ---------------- D11: one quantile method, stated ----------------
test('D11: hourly distribution quantiles use linear interpolation at (n − 1)q, the method the mart and Market use', () => {
  const recs = [10, 20, 30, 40, 50].map((p, i) => [`2023-01-01T0${i}:00:00Z`, p, null, null, null, null, 1]);
  const s = { nodeId: '1', mode: 'historical', market: 'RT', year: 2023, complete: true, expectedHours: 5, records: recs };
  const r = analyzePrices({ series: [s] }, { nodeId: '1', mode: 'historical', market: 'RT', years: [2023], weighting: 'duration', strict: true });
  near(r.summary.p05, quantile([10, 20, 30, 40, 50], 0.05)); near(r.summary.p05, 12);
  near(r.summary.p95, 48);
  assert.match(r.summary.quantileMethod, /linear interpolation/);
  assert.match(QUANTILE_METHOD, /\(n − 1\)q/);
});

// ---------------- Lead item: one DC energy definition ----------------
test('DC energy cost: one hourly-bill definition, annualised on observed hours; equal weights never change it', async () => {
  const { loadEnergyCost } = await import('../economics-load.js');
  const rows = [{ price: 10, dtHours: 1 }, { price: 30, dtHours: 1 }, { price: 50, dtHours: 2 }];
  const e = loadEnergyCost(rows, 100);
  near(e.mean, 35); near(e.value, 100 * 140 / (4 / 8760)); near(e.value, 100 * 35 * 8760);
  assert.equal(loadEnergyCost(rows, 0).value, null); assert.equal(loadEnergyCost([], 100).value, null);
  assert.equal(loadEnergyCost([{ price: null, dtHours: 1 }], 100).value, null, 'no held price → not held, never $0');
});

// ---------------- D4: one population rule ----------------
test('D4: 2025 settled measures share one population: buses holding a full 2025 year', () => {
  const full = { node: { lmp_2025: 50, solar_ratio_2025: 0.9, hneg_2025: 70, m: {} } };
  const part = { node: { lmp_2025: 52, solar_ratio_2025: 0.91, hneg_2025: 10, m: { n: { 2025: 4000 } } } };
  assert.equal(populationRule(full, 'lmp_2025'), 50);
  assert.equal(populationRule(part, 'lmp_2025'), null);
  assert.equal(MEASURES.solarRatio.get(part), null); assert.equal(MEASURES.negHours.get(part), null);
  assert.match(POPULATION_RULE, /full 2025 settled year/);
});
