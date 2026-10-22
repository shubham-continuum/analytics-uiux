// S4 markets and revenue: rules/revenue.js over rules/isone-2026.json (capacity_pfp + recs). Acceptance C-W1, C-C1, P-W1.
// Provenance: Claude Opus 5.5 (S4 agent) · one-studio/design (T3, slice S4) · 2026-10-06 · sign-off pending · v1
// Expected values are R2 / REGISTER figures (v8-isone-complete/research), recomputed here by hand, never read from the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ccpOf, capacityPath, eventIntervals, pfpReplay, zeroOutput, storageOutput, solarClearSky, regulationBound, ancillaryStreams,
  daOptionValue, twoSettlement, captureSet, hubHedge, recRevenue, cpecCertificates, cpsRevenue, revenueStack, citations, CITED_PATHS,
} from '../rules/revenue.js';
import { ruleAt } from '../views/inspector.js';

const R = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const near = (a, b, tol = 0.5) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const HATCH = { lat: 41.62, lon: -70.52 }; // Hatchville 115 kV area (kit sample), only used for the clear-sky shape

// ---------- C-W1: a price path per commitment period, never one forward price ----------
test('C-W1: solar COD 2029 gets a path per CCP with its regime cited; $3.58 is tagged "FCA 18, 2027/28 only"', () => {
  const p = capacityPath(R, { tech: 'solar', mw: 100, cod: 2029, years: 5 });
  assert.deepEqual(p.rows.map(r => r.ccp), ['2028/29', '2029/30', '2030/31', '2031/32', '2032/33']);
  for (const r of p.rows) { assert.ok(r.regime && r.regimeSrc, `${r.ccp} regime cited`); assert.ok(r.priceSrc, `${r.ccp} price source`); }
  const fca18 = p.history.find(h => h.ccp === '2027/28');
  assert.equal(fca18.price, 3.58); assert.equal(fca18.priceTag, 'FCA 18, 2027/28 only');
  // after FCA 18 every price is the user path, labelled as prefilled from cleared history and flat (never extrapolated)
  for (const r of p.rows) { assert.match(r.priceSrc, /user path/i); assert.match(r.priceSrc, /prefilled/i); assert.notEqual(r.priceTag, 'FCA 18, 2027/28 only'); }
  assert.deepEqual([...new Set(p.rows.map(r => r.price))], [3.58]);
  assert.match(p.prefill.label, /FCA 18, 2027\/28 only/);
  assert.match(p.prefill.label, /not a forecast/i);
  // COD year only → 1 Jan 2029, inside CCP 2028/29 after its May 2028 auction: monthly route, Jan–May, conditional
  assert.equal(p.rows[0].regimeKey, 'monthly'); assert.equal(p.rows[0].monthsOn, 5); assert.equal(p.rows[0].conditional, true);
  assert.equal(p.rows[1].regimeKey, 'aca_pd'); assert.equal(p.rows[1].monthsOn, 12);
  assert.ok(p.rows[2].flags.includes('cone_reset'), '2030/31 is the first ACA after the CONE recalculation');
  assert.equal(p.codAssumed, true);
});

test('C-W1: a user-set path changes only its own CCP; the band presets come from the cited band', () => {
  const p = capacityPath(R, { tech: 'solar', mw: 100, cod: '2029-01-01', years: 3, userPath: { '2030/31': 6.25 } });
  assert.deepEqual(p.rows.map(r => r.price), [3.58, 3.58, 6.25]);
  assert.match(p.rows[2].priceSrc, /user-set/i);
  const hi = capacityPath(R, { tech: 'solar', mw: 100, cod: '2029-01-01', years: 2, band: 'high' });
  assert.deepEqual(hi.rows.map(r => r.price), [8, 8]);
  assert.match(hi.prefill.label, /8\.00/);
});

test('COD timing: missing the ACA demonstration deadline moves that CCP to the monthly route; FCA 18 counts only for a CSO holder', () => {
  const late = capacityPath(R, { tech: 'solar', mw: 100, cod: '2029-06-01', years: 2 });
  assert.equal(late.rows[0].ccp, '2029/30'); assert.equal(late.rows[0].regimeKey, 'monthly'); assert.match(late.rows[0].reason, /04-05|5 April|deadline/i);
  assert.equal(late.rows[1].regimeKey, 'aca_pd');
  const holder = capacityPath(R, { tech: 'solar', mw: 100, cod: '2027-03-01', years: 2, fca18Cso: true });
  assert.equal(holder.rows[0].ccp, '2026/27'); assert.equal(holder.rows[0].regimeKey, 'monthly');
  assert.equal(holder.rows[1].ccp, '2027/28'); assert.equal(holder.rows[1].regimeKey, 'fca'); assert.equal(holder.rows[1].price, 3.58);
  assert.equal(holder.rows[1].priceTag, 'FCA 18, 2027/28 only'); assert.equal(holder.rows[1].conditional, false);
  const nonHolder = capacityPath(R, { tech: 'solar', mw: 100, cod: '2027-03-01', years: 2 });
  assert.equal(nonHolder.rows[1].regimeKey, 'monthly'); assert.equal(nonHolder.rows[1].conditional, true);
  assert.equal(ccpOf('2028-05-31'), '2027/28'); assert.equal(ccpOf('2028-06-01'), '2028/29');
});

// ---------- C-C1: accreditation by regime and season, cited ----------
test('C-C1 current rule (QC): solar CSO = summer QC 0.398 × MCap; winter QC does not enter; revenue = CSO × 1000 × P × months', () => {
  const p = capacityPath(R, { tech: 'solar', mw: 100, cod: 2029, years: 2 });
  const r = p.rows[1];
  near(r.mwAccredited, 39.8, 1e-9);
  near(r.revenue, 39.8 * 1000 * 3.58 * 12, 1e-6);
  assert.match(r.accreditation.label, /summer/i); assert.match(r.accreditation.label, /winter/i);
  assert.equal(r.accreditation.status, 'verified'); assert.match(r.accreditation.src, /slide 64/);
  const st = capacityPath(R, { tech: 'storage', mw: 100, cod: 2029, years: 2, durationH: 4 }).rows[1];
  near(st.mwAccredited, 100 * 3862 / 3877, 1e-9);
});

test('C-C1 CAR-SA (MRIC): season-aware, preliminary rMRI, price per kW of MRIC with no default from FCA 18', () => {
  const none = capacityPath(R, { tech: 'solar', mw: 100, cod: 2029, years: 2, regime: 'mric' }).rows[1];
  assert.equal(none.regimeKey, 'aca_sa'); assert.equal(none.revenue, null); assert.equal(none.status, 'missing');
  assert.match(none.reason, /no default from FCA 18/i);
  assert.equal(none.accreditation.status, 'pending');
  const sa = capacityPath(R, { tech: 'solar', mw: 100, cod: 2029, years: 2, regime: 'mric', mricPrice: { summer: 5, winter: 5 } }).rows[1];
  near(sa.revenue, 100 * 1000 * (0.241 * 5 * 4 + 0.071 * 5 * 8), 1e-6);
  near(sa.mwAccredited.summer, 24.1, 1e-9); near(sa.mwAccredited.winter, 7.1, 1e-9);
  const b4 = capacityPath(R, { tech: 'storage', mw: 100, cod: 2029, years: 2, regime: 'mric', durationH: 4, mricPrice: 4 }).rows[1];
  near(b4.mwAccredited.summer, 50.3, 1e-9); near(b4.mwAccredited.winter, 18.7, 1e-9);
  const b2 = capacityPath(R, { tech: 'storage', mw: 100, cod: 2029, years: 2, regime: 'mric', durationH: 2, mricPrice: 4 }).rows[1];
  near(b2.mwAccredited.summer, 24.3, 1e-9);
});

test('C-C1: no cited default is not a zero: wind and hybrid under the current rule are not held, with the reason', () => {
  for (const tech of ['wind', 'hybrid']) {
    const r = capacityPath(R, { tech, mw: 100, cod: 2029, years: 2 }).rows[1];
    assert.equal(r.revenue, null, tech); assert.equal(r.status, 'missing'); assert.ok(r.reason.length > 10);
  }
  const ov = capacityPath(R, { tech: 'wind', mw: 100, cod: 2029, years: 2, qc: { summer: 0.2, winter: 0.4 } }).rows[1];
  near(ov.revenue, 20 * 1000 * 3.58 * 12, 1e-6);
  assert.match(ov.accreditation.label, /site/i);
});

// ---------- P-W1: Pay-for-Performance replay ----------
test('P-W1: the 2022-12-24 CSC reproduces the event window 16:40–18:05 (17 five-minute intervals)', () => {
  const e = R.pfp.events.rows.find(x => x.date === '2022-12-24');
  const iv = eventIntervals(R, e);
  assert.equal(iv.intervals.length, 17); assert.equal(iv.intervals[0].label, '16:40'); assert.equal(iv.intervals.at(-1).label, '18:00');
  assert.equal(iv.window, '16:40–18:05'); near(iv.intervals.reduce((t, x) => t + x.weight, 0), 17, 1e-12);
  const aug = eventIntervals(R, R.pfp.events.rows.find(x => x.date === '2024-08-01'));
  assert.equal(aug.intervals.length, 20); near(aug.intervals.reduce((t, x) => t + x.weight, 0), 22, 1e-12); assert.ok(aug.mismatch);
});

test('P-W1: zero output replays the R2 §B4 benchmark: $30.7 per kW of CSO over 8.33 yr = $3.68/kW-yr at $3,500 and capped BR', () => {
  const r = pfpReplay(R, { cso: 1, mw: 1, output: zeroOutput });
  const per = Object.fromEntries(r.events.map(e => [e.date, -e.payment / 1000]));
  near(per['2018-09-03'], 6.72, 0.005); near(per['2022-12-24'], 3.32, 0.005); near(per['2023-07-05'], 1.38, 0.005);
  near(per['2024-06-18'], 1.51, 0.005); near(per['2024-08-01'], 5.75, 0.005); near(per['2025-06-24'], 10.79, 0.005); near(per['2025-11-23'], 1.22, 0.006);
  near(-r.total / 1000, 30.7, 0.05); near(-r.perKwYr, 3.68, 0.01) /* R2 prints 3.686 truncated */; assert.equal(r.years, 8.33);
  assert.equal(r.events.find(e => e.date === '2025-06-24').brUsed, 1); // BR 1.031 capped
  assert.equal(r.ppr, 3500); assert.match(r.pprSrc, /III\.13\.7\.2\.5/);
  assert.equal(r.recent.n, 5); near(r.recent.years, 3.75, 0.01);
});

test('P-W1 stop-loss: an event never takes more than FCA Starting Price × CSO in its month; annual floor when a capacity price is given', () => {
  const r = pfpReplay(R, { cso: 1, mw: 1, output: zeroOutput, ppr: 9337 });
  const jun = r.events.find(e => e.date === '2025-06-24');
  near(jun.uncapped, -9337 * 37 / 12, 1e-6); near(jun.payment, -14.525 * 1000, 1e-6); assert.equal(jun.capped, true);
  const a = pfpReplay(R, { cso: 1, mw: 1, output: zeroOutput, capPrice: 3.58 });
  near(a.annualFloor, 1000 * (3 * (3.58 - 14.525) - 12 * 3.58), 1e-6);
  assert.equal(pfpReplay(R, { cso: 1, mw: 1, output: zeroOutput }).annualFloor, null);
});

test('P-W1 technology: storage pays nothing while charged and is short after its duration; solar at winter dusk takes the full penalty', () => {
  const s2 = pfpReplay(R, { cso: 1, mw: 1, output: storageOutput(1, 2) });
  const jun = s2.events.find(e => e.date === '2025-06-24');
  near(jun.payment, -3500 * 1 * 13 / 12, 1e-6); // 24 intervals at A = CSO × min(BR,1) = 1; 13 at zero
  const s4 = pfpReplay(R, { cso: 1, mw: 1, output: storageOutput(1, 4) });
  assert.ok(s4.events.every(e => e.payment >= 0), 'a charged 4-h battery is never short in these events');
  const pv = pfpReplay(R, { cso: 39.8, mw: 100, output: solarClearSky(100, HATCH.lat, HATCH.lon) });
  const dec = pv.events.find(e => e.date === '2022-12-24');
  near(dec.payment, -3500 * 39.8 * 0.67 * 17 / 12, 1e-6);
  assert.match(pv.outputLabel, /clear-sky/i);
  assert.ok(pv.events.find(e => e.date === '2018-09-03').meanOutput > 0, 'a September afternoon has some clear-sky output');
  const nh = pfpReplay(R, { cso: 1, mw: 1, output: null });
  assert.equal(nh.total, null); assert.equal(nh.status, 'missing'); assert.match(nh.reason, /output/i);
});

// ---------- 4.7 ancillary, 4.8 energy hooks ----------
test('Regulation: 0 in the base case, pro-rata bound MW ÷ (468 + MW) × $18.0M; DA A/S not held without DA prices', () => {
  near(regulationBound(R, 100), 100 / 568 * 18e6, 1e-6);
  const a = ancillaryStreams(R, { tech: 'storage', mw: 100 });
  assert.equal(a.regulation.value, 0); assert.equal(a.regulation.status, 'ok'); near(a.regulation.upper, 100 / 568 * 18e6, 1e-6);
  assert.equal(a.daAs.value, null); assert.equal(a.daAs.status, 'missing'); assert.match(a.daAs.reason, /not held|not in the unified DB/i);
  const pv = ancillaryStreams(R, { tech: 'solar', mw: 100 });
  assert.equal(pv.daAs.status, 'not_applicable'); assert.equal(pv.regulation.status, 'not_applicable');
  // close-out uses the hourly RT Hub minus the strike
  near(daOptionValue([{ q: 10, credit: 5, rtHub: 120, strike: 100 }, { q: 10, credit: 5, rtHub: 50, strike: 100 }]), 10 * (5 - 20) + 10 * 5, 1e-9);
  assert.equal(daOptionValue([{ q: 10, credit: null, rtHub: 1, strike: 1 }]), null);
  near(ancillaryStreams(R, { tech: 'storage', mw: 100, daAs: [{ q: 1, credit: 3, rtHub: 0, strike: 10 }] }).daAs.value, 3, 1e-9);
});

test('Energy hooks: two-settlement, three capture prices, hub hedge with the basis left with the seller', () => {
  // one hour: DA 10 MW at $40 + FER $4; RT 12 five-minute intervals at 12 MW and $30 → deviation 2 MW × $30 × 1 h
  const rt = Array.from({ length: 12 }, () => ({ h: 0, g: 12, price: 30, dtHours: 1 / 12 }));
  const e = twoSettlement({ da: [{ h: 0, q: 10, price: 40, fer: 4 }], rt });
  near(e.value, 10 * 44 + 2 * 30, 1e-9); assert.equal(e.status, 'ok');
  assert.equal(twoSettlement({ da: [{ h: 0, q: 10, price: null, fer: 0 }], rt }).value, null);
  const c = captureSet({ rt5: [{ g: 1, price: 10, dtHours: 0.5 }, { g: 3, price: 30, dtHours: 0.5 }], da: null, rtHourly: [{ g: 2, price: 20, dtHours: 1 }] });
  near(c.rt5.value, (10 * 0.5 + 90 * 0.5) / 2, 1e-9); assert.equal(c.da.status, 'missing'); assert.match(c.rtHourly.label, /hourly approximation/i);
  const h = hubHedge([{ g: 10, q: 10, lmpNode: 28, lmpHub: 30, dtHours: 1 }], 35);
  near(h.ppa, 10 * (35 - 30), 1e-9); near(h.basis, 10 * (28 - 30), 1e-9);
});

// ---------- 4.13 RECs and Clean Peak ----------
test('RECs: MA Class I only, priced within the $40 ACP; storage earns none; other states not held', () => {
  const r = recRevenue(R, { state: 'MA', tech: 'solar', mwh: 100000 });
  near(r.value, 100000 * 30, 1e-9); assert.match(r.priceSrc, /prefilled/i);
  near(recRevenue(R, { state: 'MA', tech: 'solar', mwh: 1000, price: 45 }).value, 1000 * 40, 1e-9);
  assert.equal(recRevenue(R, { state: 'CT', tech: 'solar', mwh: 1000 }).status, 'missing');
  assert.equal(recRevenue(R, { state: 'MA', tech: 'storage', mwh: 1000 }).status, 'not_applicable');
  assert.equal(recRevenue(R, { state: 'MA', tech: 'solar', mwh: null }).status, 'missing');
});

test('Clean Peak: season windows on business days, ×4 summer/winter, ×1 spring; priced at 0.87 × $65 and capped at $65', () => {
  const rows = [
    { timestamp: '2027-07-07T17:00', mwh: 1 }, // Wed, summer window → 4
    { timestamp: '2027-07-10T17:00', mwh: 1 }, // Saturday → 0
    { timestamp: '2027-04-07T16:00', mwh: 1 }, // spring window starts 17:00 → 0
    { timestamp: '2027-04-07T17:00', mwh: 1 }, // spring → 1
    { timestamp: '2027-02-03T19:00', mwh: 2 }, // winter → 8
    { timestamp: '2027-02-03T20:00', mwh: 2 }, // window ends 20:00 → 0
  ];
  const c = cpecCertificates(R, rows);
  near(c.certificates, 4 + 1 + 8, 1e-9); assert.match(c.note, /system.peak/i);
  const v = cpsRevenue(R, { state: 'MA', tech: 'storage', rows });
  near(v.value, 13 * 0.87 * 65, 1e-9); assert.match(v.reason, /eligib/i);
  near(cpsRevenue(R, { state: 'MA', tech: 'storage', rows, price: 80 }).value, 13 * 65, 1e-9);
  assert.equal(cpsRevenue(R, { state: 'NH', tech: 'storage', rows }).status, 'missing');
  assert.equal(cpsRevenue(R, { state: 'MA', tech: 'storage', rows: null }).status, 'missing');
  assert.equal(cpsRevenue(R, { state: 'MA', tech: 'solar', rows }).status, 'not_applicable');
});

// ---------- the stack: every stream shows regime + source; not held is explicit ----------
test('Revenue stack: each stream carries regime, source and status; missing values are null with a reason, never 0', () => {
  const st = revenueStack(R, { tech: 'storage', mw: 100, durationH: 4, state: 'MA', cod: 2029, energy: { value: 1.2e6, label: 'perfect-foresight DA nodal (Economics)' } });
  const ids = st.streams.map(s => s.id);
  assert.deepEqual(ids, ['energy', 'capacity', 'pfp', 'da_as', 'regulation', 'recs', 'cps']);
  for (const s of st.streams) {
    assert.ok(s.label && s.regime && s.src, `${s.id}: label/regime/src`);
    assert.ok(['ok', 'missing', 'not_applicable', 'conditional'].includes(s.status), `${s.id}: ${s.status}`);
    if (s.status === 'missing' || s.status === 'not_applicable') { assert.equal(s.value, null, s.id); assert.ok(s.reason, `${s.id} reason`); }
  }
  assert.equal(st.streams.find(s => s.id === 'cps').status, 'missing'); // no dispatch rows passed
  assert.equal(st.streams.find(s => s.id === 'recs').status, 'not_applicable');
  assert.equal(st.streams.find(s => s.id === 'energy').value, 1.2e6);
  const cap = st.streams.find(s => s.id === 'capacity');
  assert.match(cap.regime, /ACA|FCA|monthly/i); assert.ok(cap.value > 0);
  const noE = revenueStack(R, { tech: 'solar', mw: 100, state: 'MA', cod: 2029 });
  assert.equal(noE.streams[0].status, 'missing'); assert.equal(noE.streams[0].value, null);
  assert.ok(noE.total.notHeld.includes('energy'));
});

test('citations(): every rule path the revenue engine reads resolves with src and status', () => {
  const c = citations(R);
  assert.equal(c.length, CITED_PATHS.length);
  for (const x of c) { assert.ok(ruleAt(R, x.path), x.path); assert.ok(x.src && x.status, x.path); }
  for (const p of ['capacity.price_path_default', 'capacity.qc_solar_default', 'capacity.rmri_preliminary', 'pfp.ppr', 'pfp.balancing_ratio_cap', 'pfp.stop_loss', 'recs_ma.class1_acp'])
    assert.ok(CITED_PATHS.includes(p), p);
});
