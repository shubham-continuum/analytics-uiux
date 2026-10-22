// Gap brief v4 (Queue): the data-centre direction, the load ratio, service type, penalty exemptions,
// material modification and the fuel applicability of the generator pro forma.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ratioDirs, requestRatios, serviceGroup, SERVICE_GROUPS, penaltyExemptions, materialModChecklist, cashApplies,
  registerRows, outcomesBy, crossTab,
} from '../queuecore.js';
import { caseTable, binding } from '../gridrules.js';

const REG = JSON.parse(readFileSync(new URL('../data/queue-register.json', import.meta.url), 'utf8'));
const rows = registerRows(REG);

// A synthetic grid: one bus with an export and both import envelopes (no element rows → envelope governs).
const G = { headroom: [
  { bus_id: 'B', scenario: 'summer_peak', direction: 'discharge', headroom_mw: 200 },
  { bus_id: 'B', scenario: 'shoulder', direction: 'discharge', headroom_mw: 180 },
  { bus_id: 'B', scenario: 'large_load', direction: 'charge', headroom_mw: 400 },
  { bus_id: 'B', scenario: 'summer_peak', direction: 'charge', headroom_mw: 250 },
  { bus_id: 'B', scenario: 'shoulder', direction: 'charge', headroom_mw: 90 },
], constraints: [] };
const bind = (tech, ex, im) => { const t = caseTable(G, 'B', tech, ex, im); return { export: binding(t, 'export'), import: binding(t, 'import') }; };

test('the ratio direction follows the fuel: a load is import only; storage and hybrid add the charge side', () => {
  assert.deepEqual(ratioDirs('solar'), ['export']);
  assert.deepEqual(ratioDirs('wind'), ['export']);
  assert.deepEqual(ratioDirs('datacenter'), ['import']);
  assert.deepEqual(ratioDirs('storage'), ['export', 'import']);
  assert.deepEqual(ratioDirs('hybrid'), ['export', 'import']);
});

test('bug fix: a data centre reads its own import binding (large load / summer-peak charge), not a solar case', () => {
  const b = bind('datacenter', 0, 300);
  assert.equal(b.import.value, 250); // the lower of large load 400 and summer-peak charge 250
  const r = requestRatios('datacenter', { exportMW: 100, importMW: 300, nearbyMW: 500 }, b);
  assert.equal(r.length, 1);
  assert.equal(r[0].dir, 'import');
  assert.equal(r[0].limit, 250);
  assert.equal(r[0].nearby, null, 'nearby generator MW is never added to a load');
  assert.equal(r[0].value, 300 / 250);
});

test('generator ratio = (nearby + this project) ÷ binding export limit', () => {
  const r = requestRatios('solar', { exportMW: 100, importMW: 0, nearbyMW: 50 }, bind('solar', 100, 0));
  assert.equal(r[0].limit, 180);
  assert.equal(r[0].value, 150 / 180);
});

test('storage charge ratio uses the shoulder charge limit only; charge not requested → no ratio, never 0', () => {
  const r = requestRatios('storage', { exportMW: 100, importMW: 100, nearbyMW: 0 }, bind('storage', 100, 100));
  assert.equal(r[1].dir, 'import');
  assert.equal(r[1].limit, 90);
  assert.equal(r[1].value, 100 / 90);
  const r0 = requestRatios('storage', { exportMW: 100, importMW: 0, nearbyMW: 0 }, bind('storage', 100, 0));
  assert.equal(r0[1].value, null);
  assert.equal(r0[1].status, 'Not requested');
});

test('a limit that is not held gives a null ratio (not held), never a number', () => {
  const r = requestRatios('datacenter', { exportMW: 0, importMW: 300, nearbyMW: 0 }, { export: { value: null, status: 'Not requested' }, import: { value: null, status: 'Not studied' } });
  assert.equal(r[0].value, null);
  assert.equal(r[0].status, 'Not studied');
});

test('service groups: CNR capacity, NR energy-only; other codes as published; blank / NA not stated', () => {
  assert.equal(serviceGroup('CNR'), SERVICE_GROUPS[0]);
  assert.equal(serviceGroup('NR'), SERVICE_GROUPS[1]);
  assert.equal(serviceGroup('MIS'), SERVICE_GROUPS[2]);
  assert.equal(serviceGroup('CNI'), SERVICE_GROUPS[2]);
  assert.equal(serviceGroup('NA'), SERVICE_GROUPS[3]);
  assert.equal(serviceGroup('N/A'), SERVICE_GROUPS[3]);
  assert.equal(serviceGroup(null), SERVICE_GROUPS[3]);
});

test('register service mix: 726 CNR and 197 NR records; groups sum to all 1,751 records', () => {
  const by = new Map(outcomesBy(rows, r => serviceGroup(r.serv)).map(o => [o.key, o]));
  assert.equal(by.get(SERVICE_GROUPS[0]).n, 726);
  assert.equal(by.get(SERVICE_GROUPS[1]).n, 197);
  assert.equal([...by.values()].reduce((a, o) => a + o.n, 0), 1751);
  const ct = crossTab(rows, r => serviceGroup(r.serv), r => r.status, () => 1, { rows: SERVICE_GROUPS, cols: ['W', 'C', 'A'] });
  assert.equal(ct.values.flat().reduce((a, v) => a + (v || 0), 0), 1751);
});

// S3 (2026-10-06): corrected rule (R1 §5, Sched 22 §3.7.1.1): "more than 25%", measured on a Cluster Restudy Report
// only. The old assertion "exactly 25% is exempt (≥)" encoded the vault summary's looser wording.
test('penalty exemptions (Sched 22 §3.7.1.1): >25% on a restudy report only; >100% facilities vs cluster study', () => {
  const e = penaltyExemptions({ priorReport: 10e6, current: 12.5e6, reportType: 'restudy', clusterStudy: 10e6, facilitiesStudy: 20e6 });
  assert.equal(e[0].increase, 0.25);
  assert.equal(e[0].exempt, false, 'exactly 25% is not more than 25%');
  assert.equal(e[1].increase, 1);
  assert.equal(e[1].exempt, false, 'exactly 100% is not exempt (>)');
  const e2 = penaltyExemptions({ priorReport: 10e6, current: 12.6e6, reportType: 'restudy', clusterStudy: 10e6, facilitiesStudy: 20.1e6 });
  assert.equal(e2[0].exempt, true);
  assert.equal(e2[1].exempt, true);
  assert.equal(penaltyExemptions({ priorReport: 10e6, current: 14e6, reportType: 'cluster' })[0].exempt, false, 'no exemption off the first Cluster Study Report');
});

test('penalty exemptions are not held (null), never "not exempt", when a cost is missing or zero', () => {
  const e = penaltyExemptions({ priorReport: null, current: 5e6, clusterStudy: 0, facilitiesStudy: 5e6 });
  assert.equal(e[0].increase, null);
  assert.equal(e[0].exempt, null);
  assert.equal(e[1].exempt, null, 'a $0 base has no percentage increase');
});

test('the generator pro forma does not apply to a load; every generator fuel keeps it', () => {
  assert.equal(cashApplies('datacenter').applies, false);
  assert.match(cashApplies('datacenter').why, /load/i);
  assert.ok(!/16 Nov 2026/.test(cashApplies('datacenter').why), 'the large-load date comes from the rules badge, never typed (S2-GD #7)');
  for (const t of ['solar', 'wind', 'storage', 'hybrid']) assert.equal(cashApplies(t).applies, true);
});

test('material modification checklist: ISO-NE text not held; vault triggers cited; never a pass', () => {
  const s = materialModChecklist('solar');
  assert.ok(s.rows.length >= 5);
  assert.match(s.isoNe, /not held/i);
  assert.ok(s.rows.some(r => /technological/i.test(r.change) && /845/.test(r.source)));
  assert.ok(s.rows.some(r => /same point of interconnection|same POI/i.test(r.change) && /2023/.test(r.source)));
  assert.ok(s.rows.every(r => !/pass/i.test(r.status)));
  assert.ok(s.rows.some(r => r.status === 'Not held'), 'changes the vault does not document are Not held');
  const d = materialModChecklist('datacenter');
  assert.equal(d.applies, false);
  assert.equal(d.rows.length, 0);
  // storage gets the operating-assumption item; wind does not
  assert.ok(materialModChecklist('storage').rows.some(r => /operating assumption/i.test(r.change)));
  assert.ok(!materialModChecklist('wind').rows.some(r => /operating assumption/i.test(r.change)));
});
