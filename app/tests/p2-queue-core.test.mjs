// P2 queue fixes (C30–C33 + the grid-column memo): the queue engine's ratio method, register cross-checks,
// cash labels and the deadline chain. Tests first; each names the finding it pins.
// Provenance: Claude Opus 5.5 · one-studio/design P2 queue fix agent · 2026-10-10 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as RX from '../rules/isone.js';
import {
  nearby, registerRows, regIndex, nowOf, queueAhead, modelledMW, requestRatios, bindingRatio, eraOf, serviceCheck,
  placementCheck, busInPoi, maturityCutoff, pCod, scheduleBand, codDate, projectionState, nearestLive,
} from '../queuecore.js';
import { traceRatios } from '../views/queue-trace-v5.js';

const Q = JSON.parse(readFileSync(new URL('../data/queue.json', import.meta.url)));
const snap = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
// The whole ISO-NE bus list (market study, 2,678 buses with state / lat / lon): snapshot.json holds only 7 buses, none in CT.
const ALL_BUSES = JSON.parse(readFileSync(new URL('../data/study.json', import.meta.url))).nodes;
const REG = registerRows(JSON.parse(readFileSync(new URL('../data/queue-register.json', import.meta.url))));
const IDX = regIndex(REG);
const now = q => nowOf(q, IDX);
const MASHPEE = snap.nodes.find(x => String(x.id) === '111403');

// Synthetic positions at a bus at (42, -71): 0.01° ≈ 0.7 mi.
const BUS = { id: '999001', name: 'Testbus', latitude: 42, longitude: -71, county: 'Worcester', state_code: 'MA' };
const P = (qp, o) => ({ queue_position: qp, request_date: '2022-01-01', poi_name: 'X', latitude: 42.01, longitude: -71, state: 'MA', ...o });
const SYN = [
  P(1, { max_mw: 100, summer_mw_modelled: 100, resource_type: 'SUN' }), // in the solved case
  P(2, { max_mw: 50, summer_mw_modelled: 0, resource_type: 'SUN' }), // not modelled, active → ahead
  P(3, { max_mw: 170, summer_mw_modelled: -170, resource_type: 'BAT' }), // storage modelled charging
  P(4, { max_mw: 80, summer_mw_modelled: 0, resource_type: 'WND' }), // not modelled but withdrawn
  P(5, { max_mw: 30, summer_mw_modelled: null, resource_type: 'SUN' }), // study status not held
];
const NOW = { 1: 'A', 2: 'A', 3: 'A', 4: 'W', 5: 'A' };
const synNow = q => ({ now: NOW[q.queue_position], r: null });

// ---------- C30 ----------
test('C30: MW ahead = not modelled in the summer case AND not withdrawn; modelled, withdrawn and not-held MW are never added', () => {
  const a = queueAhead(nearby(SYN, BUS, 10), { nowOf: synNow });
  assert.equal(a.aheadMW, 50);
  assert.deepEqual(a.rows.filter(r => r.counted).map(r => r.q.queue_position), [2]);
  const why = Object.fromEntries(a.rows.map(r => [r.q.queue_position, r.why]));
  assert.match(why[1], /solved case/); assert.match(why[3], /charging/); assert.match(why[4], /withdrawn/); assert.match(why[5], /not held/);
  assert.equal(a.notHeldMW, 30, 'status not held is reported, not added');
});

test('C30: register status not given → not-modelled MW is counted but flagged (withdrawal not checked), never silently', () => {
  const a = queueAhead(nearby(SYN, BUS, 10));
  assert.equal(a.aheadMW, 130);
  assert.equal(a.statusChecked, false);
});

test('C30 real data: Mashpee 10 mi: Q1109 (487 MW, modelled, withdrawn 2026-01-23) is not counted ahead; ratio falls from 384% to project-only', () => {
  const list = nearby(Q.queue, MASHPEE, 10);
  assert.ok(list.some(x => x.q.queue_position === 1109));
  const a = queueAhead(list, { nowOf: now });
  assert.equal(a.rows.find(r => r.q.queue_position === 1109).counted, false);
  assert.equal(a.aheadMW, 0);
  const r = requestRatios('wind', { exportMW: 100, importMW: 0, aheadMW: a.aheadMW }, { export: { value: 200, status: 'Studied' } });
  assert.equal(r[0].value, 0.5);
  assert.equal(r[0].projectOnly, 0.5);
});

test('C30: modelled MW is summed signed: −170 MW charging is −170, not +170', () => {
  const m = modelledMW(nearby(SYN, BUS, 10));
  assert.equal(m.signed, 100 - 170);
  assert.equal(m.charging, -170);
  assert.equal(m.chargingN, 1);
  assert.equal(m.requested, 270, 'requested MW of the modelled positions, for the consistency check');
});

test('C30: ratio rows carry project-only; storage headline is the binding (larger) ratio, not the export one', () => {
  const r = requestRatios('storage', { exportMW: 100, importMW: 100, aheadMW: 0 }, { export: { value: 145, status: 'Studied' }, import: { value: 57.3, status: 'Studied' } });
  assert.equal(r[0].projectOnly, 100 / 145);
  const b = bindingRatio(r);
  assert.equal(b.dir, 'import');
  assert.equal(b.value, 100 / 57.3);
  assert.equal(bindingRatio([{ value: null }, { value: null }]), null);
});

test('C30: labels say what the ratio is; a load reads "request ÷ element-study import limit", never "distance-based"', () => {
  const dc = requestRatios('datacenter', { exportMW: 0, importMW: 300, aheadMW: 500 }, { import: { value: 250, status: 'Studied' } })[0];
  assert.match(dc.label, /element-study import limit/);
  assert.equal(dc.nearby, null);
  const ex = requestRatios('solar', { exportMW: 100, importMW: 0, aheadMW: 50 }, { export: { value: 180, status: 'Studied' } })[0];
  assert.match(ex.label, /not in the solved case/);
  assert.equal(ex.value, 150 / 180);
});

test('C30: the ratio trace runs a method check (no summer-modelled or withdrawn MW counted), not a re-run of the same formula', () => {
  const a = queueAhead(nearby(SYN, BUS, 10), { nowOf: synNow });
  const r = requestRatios('solar', { exportMW: 100, importMW: 0, aheadMW: a.aheadMW }, { export: { value: 180, status: 'Studied' } });
  const html = traceRatios('solar', r, 10, a);
  assert.match(html, /Method check: summer-modelled MW counted ahead/);
  assert.match(html, /Method check: withdrawn MW counted ahead/);
  assert.doesNotMatch(html, /Does not reconcile/);
  // A defective ahead list (the old formula: every nearby MW) fails the method check.
  const bad = { ...a, rows: a.rows.map(x => ({ ...x, counted: true, mw: x.q.max_mw })), aheadMW: 430 };
  const r2 = requestRatios('solar', { exportMW: 100, importMW: 0, aheadMW: 430 }, { export: { value: 180, status: 'Studied' } });
  assert.match(traceRatios('solar', r2, 10, bad), /Does not reconcile/);
});

// ---------- C31 ----------
test('C31: era from the register cluster flag: TCS records are the transitional cluster, not "serial era"', () => {
  const r1148 = REG.find(r => r.qp === 1148);
  assert.equal(r1148.cluster, 'TCS');
  assert.match(eraOf({ request_date: '2021-07-13' }, r1148), /transitional cluster/i);
  assert.equal(eraOf({ request_date: '2019-01-01' }, null), 'serial era');
  assert.match(eraOf({ request_date: '2025-01-01' }, null), /cluster era/);
  const n = nearby([P(9, { request_date: '2021-07-13', max_mw: 1, summer_mw_modelled: 0 })], BUS, 10)[0];
  assert.doesNotMatch(n.era, /^serial era$/, 'nearby() alone cannot see the register flag, so it says so');
});

test('C31: service type cross-checked with the register: Q1109 CNR (study) vs NR (register)', () => {
  const q = Q.queue.find(x => x.queue_position === 1109), n = now(q);
  const s = serviceCheck(q, n.r);
  assert.equal(s.agree, false);
  assert.match(s.text, /NR/);
  assert.equal(serviceCheck({ interconnection_service_requested: 'CNR' }, null).agree, null, 'no register row → not held');
});

test('C31: register status drives "still open" and the projected-date class (Q622 in service, Q994 withdrawn)', () => {
  const q622 = Q.queue.find(x => x.queue_position === 622), q994 = Q.queue.find(x => x.queue_position === 994);
  assert.equal(now(q622).now, 'C'); assert.equal(now(q994).now, 'W');
  assert.equal(projectionState(q622, now(q622), '2026-09-09'), 'in service');
  assert.equal(projectionState(q994, now(q994), '2026-09-09'), 'withdrawn');
  assert.equal(projectionState({ projected_is_date: '2021-01-01' }, { now: 'A' }, '2026-09-09'), 'past due');
  assert.equal(projectionState({ projected_is_date: '2030-01-01' }, { now: 'A' }, '2026-09-09'), 'ahead');
  assert.equal(projectionState({ projected_is_date: null }, { now: 'A' }, '2026-09-09'), 'undated');
});

test('C31 / F035: the nearest-request KPI skips withdrawn positions and names the nearer withdrawn one', () => {
  const list = nearby(SYN.map((q, i) => ({ ...q, latitude: 42 + 0.01 * (5 - i) })), BUS, 1e5); // Q5 nearest … Q1 farthest
  const NOW2 = { 5: 'W', 4: 'W', 3: 'A' };
  const n = nearestLive(list, q => ({ now: NOW2[q.queue_position] || 'A' }));
  assert.equal(n.live.q.queue_position, 3);
  assert.equal(n.skipped.length, 2);
});

test('C31: a bus number named in the POI text is a match (Q1148 names 110926)', () => {
  assert.equal(busInPoi('110926', 'Electric Avenue 115 kV substation (bus number 110926), Zone MA_NST'), true);
  assert.equal(busInPoi('11092', 'bus number 110926'), false);
  assert.equal(busInPoi('', 'x'), false);
  const n = nearby([P(1148, { poi_name: 'Sub (bus number 999001)', latitude: 43, longitude: -71, max_mw: 300, summer_mw_modelled: 0 })], BUS, 10);
  assert.equal(n.length, 1);
  assert.equal(n[0].match, 'POI bus number');
  assert.equal(n[0].inRadius, false, 'listed, not counted: the coordinate disagrees with the bus number');
});

test('C31: coordinate vs record placement: QP935 (ME, Cumberland) sits nearest a CT bus → flagged', () => {
  const q = Q.queue.find(x => x.queue_position === 935) || { queue_position: 935, state: 'ME', county: 'Cumberland', latitude: 41.522572, longitude: -73.097003 };
  // v2 (L0 fix round, 2026-10-11): the fixture was snap.nodes (7 buses, none in CT), so no implementation could find the
  // CT bus the assertion names; the check now runs on the whole bus list, both node shapes. Assertions unchanged.
  const c = placementCheck(q, ALL_BUSES);
  assert.equal(c.stateAgrees, false);
  assert.equal(c.nearestState, 'CT');
  assert.equal(placementCheck(q, snap.nodes).stateAgrees, false, 'the 7-bus snapshot still flags the disagreement');
  const ok = placementCheck({ state: 'MA', county: 'Barnstable', latitude: MASHPEE.latitude, longitude: MASHPEE.longitude }, ALL_BUSES);
  assert.equal(ok.stateAgrees, true); assert.equal(ok.countyAgrees, true);
  assert.equal(placementCheck({ state: 'MA', latitude: null }, ALL_BUSES).stateAgrees, null);
});

test('C31: one maturity cutoff: pCod and the register view use the same rule (entry year ≤ year − 6)', () => {
  assert.equal(maturityCutoff(2026), 2020);
  assert.equal(pCod([{ entry_year: 2020, in_service: 1, withdrawn: 1 }, { entry_year: 2021, in_service: 5, withdrawn: 0 }], 2026).cutoff, maturityCutoff(2026));
});

// ---------- C32 ----------
test('C32: each phase splits security + deposits posted from the part that must be cash (readiness may be LC or bond)', () => {
  const c = RX.commitments({ mw: 150, nu: 10e6 });
  assert.equal(c.phases[0].cashPosted, 750000, 'security + deposits posted (unchanged field: readiness 500k + study deposit 250k)');
  assert.equal(c.phases[0].cashMin, 250000, 'only the study deposit must be cash; the fee is paid, not posted');
  assert.equal(c.fee + c.phases[0].cashMin, 300000, 'REGISTER row 16: $300k of the $800k entry is cash');
  assert.deepEqual(c.phases.map(p => p.preLgia), [true, true, true, true, true, false]);
});

test('C32: the pre-construction peak excludes the post-LGIA phase', () => {
  const c = RX.commitments({ mw: 150, nu: 556.22e6 });
  const peakAll = Math.max(...c.phases.map(p => p.cashPosted));
  // v2 (L0 fix round): peakPreLgia returns one shape, {value, lowerBound, phase, reason}; v1 compared the object itself
  // here but read .value / .lowerBound below. Same assertions on the value.
  const peakPre = RX.peakPreLgia(c);
  assert.ok(peakPre.value < peakAll);
  assert.equal(peakPre.value, c.phases[4].cashPosted);
  assert.equal(peakPre.lowerBound, false);
  assert.equal(RX.peakPreLgia(RX.commitments({ mw: 150, nu: null })).value, 750000);
  assert.equal(RX.peakPreLgia(RX.commitments({ mw: 150, nu: null })).lowerBound, true);
});

// ---------- C33 ----------
test('C33: the 90/180-day path runs on to the LGIA tender (§11.1) and every row is in date order', () => {
  for (const facilities of [90, 180, 'waived']) for (const restudy of [false, true]) {
    const s = RX.schedule({ windowClose: '2026-11-19', facilities, restudy });
    const dates = s.rows.map(r => r.date);
    assert.deepEqual(dates, [...dates].sort(), `${facilities}/${restudy}: rows sorted by date`);
    assert.equal(s.end.key, 'lgia_tender', `${facilities}/${restudy}: the chain ends at the LGIA tender`);
  }
  const f = RX.schedule({ windowClose: '2026-11-19', facilities: 90 });
  const fs = f.rows.find(r => r.key === 'fs_report'), lg = f.rows.find(r => r.key === 'lgia_tender');
  assert.equal(Date.parse(lg.date) - Date.parse(fs.date), 15 * 864e5);
  assert.equal(lg.from, fs.date, 'the bar starts at the step it counts from');
  assert.match(lg.note, /comment period.*not held/i);
});

test('C33: the band reports tariff deadlines (latest dates), not minimums; deadlineDays / latest replace minDays / earliest', () => {
  const b = scheduleBand('2026-11-19');
  assert.equal(b.endStep, 'Draft LGIA tendered');
  assert.ok(Number.isInteger(b.deadlineDays));
  assert.equal(b.latest, b.end);
  assert.equal('earliest' in b, false);
  assert.match(b.note, /latest/);
});

test('C33: codDate flags a COD before the LGIA tender deadline and cautions when priced upgrades exist', () => {
  const S = { tech: 'solar', exportMW: 150, nodeId: '110815', ui: { qCod: 2028 }, handoffs: { cost: { busId: '110815', size: 150, tech: 'solar', knownNetwork: 556.22, status: 'Priced' } } };
  const c = codDate(S);
  assert.equal(c.pathEnd.step, 'Draft LGIA tendered');
  assert.equal(c.conflict, true);
  assert.match(c.upgradeCaution, /network upgrades/);
  assert.match(c.upgradeCaution, /lead time.*not held/);
  assert.equal(codDate({ ...S, handoffs: {} }).upgradeCaution, null);
  assert.equal(codDate({ ...S, ui: { qCod: 2035 } }).conflict, false);
});

// ---------- grid-column memo ----------
test('memo: queueCash and clusterDeadline return the cached result for the same inputs and recompute on a change', () => {
  const a = { mw: 150, tech: 'solar', sitePct: 100, profile: 'isone' };
  assert.equal(RX.queueCash({ ...a }), RX.queueCash({ ...a }));
  assert.notEqual(RX.queueCash({ ...a, mw: 151 }), RX.queueCash({ ...a }));
  const d = { windowClose: '2026-11-19' };
  assert.equal(RX.clusterDeadline({ ...d }), RX.clusterDeadline({ ...d }));
  assert.equal(RX.clusterDeadline({ windowClose: '2026-11-20' }).value > RX.clusterDeadline(d).value, true);
  // A rules reload invalidates the cache.
  const R = RX.getRules(), before = RX.queueCash(a);
  RX.setRules(R); assert.notEqual(RX.queueCash(a), before); assert.deepEqual(RX.queueCash(a).value, before.value);
});

test('memo: 30,000 grid-cell reads (a sort over 2,678 rows) stay well under the old per-cell cost', () => {
  const S = { tech: 'solar', exportMW: 150, importMW: 0, ui: { land: { control: 100 } } };
  const t0 = performance.now();
  for (let i = 0; i < 30000; i++) { RX.queueCash({ mw: 150, tech: 'solar', sitePct: 100, profile: 'isone', service: null, nrisHeld: false, regulatoryLimitation: false }); RX.clusterDeadline({ windowClose: undefined, restudy: false, facilities: 90, profile: 'isone' }); }
  const ms = performance.now() - t0;
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms for 30k cached reads`);
  void S;
});
