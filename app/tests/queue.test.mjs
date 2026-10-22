import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { studyDeposit, commitments, pCod, nearby, scheduleBand, nameMatch, NAME_MATCH_MAX_MI, latestRequest } from '../queuecore.js';

const Q = JSON.parse(readFileSync(new URL('../data/queue.json', import.meta.url)));
const snap = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));

// S3 (2026-10-06): the default profile is ISO-NE Schedule 22 (rules/isone.js). The federal pro forma assertions below
// are kept, now under the explicit 'proforma' profile; the ISO-NE defaults are asserted beside them (R1 §2, §3, §5).
test('Order 2023 study deposit tiers (vault summary §3), under the labelled pro forma profile', () => {
  assert.equal(studyDeposit(50, 'proforma'), 85000);
  assert.equal(studyDeposit(100, 'proforma'), 150000);
  assert.equal(studyDeposit(200, 'proforma'), 250000);
  assert.equal(studyDeposit(10, 'proforma'), null);
});

test('ISO-NE default: the study deposit is flat $250k above 20 MW and $100k (Schedule 23) at or below', () => {
  assert.equal(studyDeposit(21), 250000); assert.equal(studyDeposit(100), 250000); assert.equal(studyDeposit(500), 250000);
  assert.equal(studyDeposit(20), 100000); assert.equal(studyDeposit(10), 100000);
});

test('pro forma: 20 MW and below is outside the large-generator pro forma; 21 MW is the first tier', () => {
  assert.equal(studyDeposit(20, 'proforma'), null);
  assert.equal(studyDeposit(21, 'proforma'), 56000);
  assert.match(commitments(20, 1e6, { profile: 'proforma' }).errors[0], /small-generator procedures/);
});

test('readiness deposits are cumulative top-ups and never fall; 5% only after the cluster study report (pro forma)', () => {
  const c = commitments(100, 10e6, { profile: 'proforma' });
  const r = c.phases.map(p => p.readiness);
  assert.deepEqual(r, [300000, 300000, 500000, 500000, 1000000, 2000000]);
  assert.ok(c.phases.every(p => p.topUp >= 0));
  assert.match(c.phases[2].phase, /cluster study report/);
});

test('ISO-NE readiness at 100 MW, NU $10M: $500k at entry, then totals of 5% / 10% / 20%', () => {
  assert.deepEqual(commitments(100, 10e6).phases.map(p => p.readiness), [500000, 500000, 500000, 500000, 1000000, 2000000]);
});

test('no withdrawal penalty before the cluster study begins', () => {
  assert.equal(commitments(100, 10e6).phases[0].penaltyIfWithdrawn, 0);
  assert.equal(commitments(100, 10e6, { profile: 'proforma' }).phases[0].penaltyIfWithdrawn, 0);
});

test('network-upgrade-based items are not held (never $0) when the allocated cost is unknown', () => {
  const c = commitments(100, null);
  assert.equal(c.phases[1].readiness, 500000);
  assert.equal(c.phases[2].readiness, null);
  assert.equal(c.phases[2].penaltyIfWithdrawn, 250000);
  assert.equal(c.phases[2].penaltyLowerBound, true);
  assert.equal(c.phases[3].penaltyIfWithdrawn, null);
});

test('a deposit in lieu decided by queueCash is carried in the cash posted of every phase', () => {
  const c = commitments(100, 10e6, { depositInLieu: 1e6 });
  assert.equal(c.depositInLieu, 1e6);
  assert.equal(c.phases[0].cashPosted, 500000 + 250000 + 1e6);
});

test('P(COD) uses mature vintages only', () => {
  const p = pCod(Q.trends, 2026);
  assert.ok(p.p > 0 && p.p < 1);
  assert.equal(p.completed + p.withdrawn > 0, true);
});

test('nearby requests are context: each carries its match method and in-model status', () => {
  const n = nearby(Q.queue, snap.nodes.find(x => x.id === '111403'), 10);
  assert.ok(n.every(x => x.match && x.inModel));
});

test('pro forma schedule from the window close: CEW 60 d + cluster study 150 d + facilities study 90 d', () => {
  const s = scheduleBand('2026-11-19', { profile: 'proforma' });
  assert.equal(s.deadline, '2027-06-17');
  assert.equal(s.minDays, 60 + 150 + 90);
});

test('ISO-NE schedule: Cluster Study Report deadline 2027-10-15 from a 2026-11-19 close (Q-C3)', () => {
  const s = scheduleBand('2026-11-19');
  assert.equal(s.deadline, '2027-10-15');
  assert.equal(scheduleBand('not a date'), null);
});

test('withdrawal forfeits follow the stages (NU $10M, 100 MW): pro forma floor $150k, ISO-NE floor $250k', () => {
  assert.deepEqual(commitments(100, 10e6, { profile: 'proforma' }).phases.map(x => x.penaltyIfWithdrawn), [0, 150000, 150000, 500000, 1000000, 2000000]);
  assert.deepEqual(commitments(100, 10e6).phases.map(x => x.penaltyIfWithdrawn), [0, 250000, 250000, 500000, 1000000, 2000000]);
});

// Synthetic rows for name matching: bus at (42, -71); 0.1° latitude ≈ 6.9 mi.
const BUS = { name: 'Medway', latitude: 42, longitude: -71 };
const row = (id, poi, dLat) => ({ queue_position: id, poi_name: poi, max_mw: 10, summer_mw_modelled: 10, request_date: '2020-01-01', latitude: 42 + dLat, longitude: -71 });

test('nameMatch uses whole distinctive words; generic words never match', () => {
  assert.equal(nameMatch('Line 88', 'Eversource 115 kV Line 88 tap'), false);
  assert.equal(nameMatch('North', 'North Medway'), false);
  assert.equal(nameMatch('Medway', 'Medway 115 kV'), true);
  assert.equal(nameMatch('Medway', 'West Medway 345 kV'), true);
  assert.equal(nameMatch('Medway', 'Medwayville 115 kV'), false);
  assert.equal(nameMatch('Bear Swamp', 'GRID 230 kV Bear Swamp substation'), true);
  assert.equal(nameMatch('Bear Swamp', 'Swamp Road'), false);
});

test('a name match counts only within 25 mi; radius rows carry inRadius', () => {
  assert.equal(NAME_MATCH_MAX_MI, 25);
  const rows = [row(1, 'Medway 115 kV', 0.2), row(2, 'West Medway 345 kV', 0.3), row(3, 'Medwayville 115 kV', 0.3), row(4, 'West Medway 345 kV', 4), row(5, 'Other 115 kV', 0.05)];
  const n = nearby(rows, BUS, 5);
  assert.deepEqual(n.map(x => x.q.queue_position), [5, 1, 2]);
  assert.deepEqual(n.map(x => x.inRadius), [true, false, false]);
  assert.deepEqual(n.map(x => x.match), ['≤ 5 mi', 'POI name', 'POI name']);
  const wide = nearby(rows, BUS, 25);
  assert.ok(wide.every(x => x.inRadius && x.match === '≤ 25 mi'));
  assert.equal(wide.some(x => x.q.queue_position === 4), false);
  assert.equal(nearby([row(9, 'Line 88', 3)], { name: 'Line 88', latitude: 42, longitude: -71 }, 5).length, 0);
});

test('storage modelled as charging (negative summer MW) is modelled, not "not in study"', () => {
  const n = nearby([{ ...row(7, 'X', 0), summer_mw_modelled: -150 }, { ...row(8, 'Y', 0), summer_mw_modelled: 0 }], BUS, 5);
  assert.deepEqual(n.map(x => x.inModel), ['modelled in summer study', 'not modelled']);
});

test('pCod cut-off follows the data vintage and reports a recent-vintage rate', () => {
  assert.equal(latestRequest(Q.queue), '2024-07-29');
  const p = pCod(Q.trends, 2024);
  assert.equal(p.cutoff, 2018);
  assert.equal(p.recent.vintages, '2013–2018');
  assert.ok(p.recent.p > 0 && p.recent.p < 1);
});
