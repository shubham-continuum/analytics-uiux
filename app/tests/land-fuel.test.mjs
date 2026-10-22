// Land v4: the request rule follows Grid's applicableCases (storage and hybrid charge in the shoulder case only, and
// hybrid includes the charge side), per-bus evaluation inside a grouped station, and fuel-specific permit checklists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requestCases, requestTest, requestHeadroom, requestSide, stationGroups, CASE_FIELD, permitList, permitRows, permitCounts,
  PERMIT_DISCLAIMER, depthOf, DEPTHS,
} from '../landcore.js';
import { applicableCases } from '../gridrules.js';

// Bus 100172 in the unified DB: shoulder charge 6.7 MW, summer-peak charge 55.3 MW (the tight shoulder-charge case).
const B100172 = { hr_sp_dis: 56.2, hr_sp_chg: 55.3, hr_sh_dis: 101.0, hr_sh_chg: 6.7, hr_ll_chg: 60.1 };

test('requestCases mirrors gridrules.applicableCases for every fuel', () => {
  for (const tech of ['solar', 'wind', 'storage', 'hybrid', 'datacenter']) {
    const a = applicableCases(tech), want = tech === 'datacenter' ? a.import : [...a.export, ...a.import];
    assert.deepEqual(requestCases(tech).map(c => c.key), want, tech);
  }
  assert.ok(!requestCases('storage').some(c => c.key === 'summer_peak|charge'), 'storage never reads the summer-peak charge');
  assert.ok(requestCases('hybrid').some(c => c.key === 'shoulder|charge'), 'hybrid includes the charge side');
  for (const c of requestCases('hybrid')) assert.ok(CASE_FIELD[c.key], c.key);
});

test('storage at 100172 is bound by the shoulder charge (6.7 MW), not the summer-peak charge (55.3 MW)', () => {
  const t = requestTest(B100172, 'storage', 50, 50);
  assert.equal(t.hr, 6.7);
  assert.equal(t.binding, 'shoulder|charge');
  assert.equal(t.clears, 'not met');
  assert.equal(requestHeadroom(B100172, 'storage'), 6.7);
});

test('hybrid charges at max(import, export) MW (Grid stepCostService convention) and reads the charge side', () => {
  const t = requestTest(B100172, 'hybrid', 150, 0);
  const ch = t.cases.find(c => c.key === 'shoulder|charge');
  assert.equal(ch.mw, 150);
  assert.equal(ch.clears, 'not met');
  assert.equal(t.clears, 'not met');
  assert.equal(requestTest(B100172, 'hybrid', 5, 5).clears, 'met');
});

test('data centre reads large-load AND summer-peak withdrawal at the import MW', () => {
  const t = requestTest(B100172, 'datacenter', 0, 58);
  assert.deepEqual(t.cases.map(c => c.key), ['large_load|charge', 'summer_peak|charge']);
  assert.equal(t.hr, 55.3);
  assert.equal(t.clears, 'not met'); // 58 > 55.3 on summer-peak charge
  assert.equal(requestTest(B100172, 'datacenter', 0, 50).clears, 'met');
});

test('solar reads summer-peak and shoulder injection; unknown never passes, a known fail still fails', () => {
  assert.equal(requestTest(B100172, 'solar', 50, 0).clears, 'met');
  const part = requestTest({ hr_sp_dis: 90 }, 'solar', 50, 0);
  assert.equal(part.hr, null);
  assert.equal(part.clears, 'unknown');
  assert.equal(requestTest({ hr_sp_dis: 10 }, 'solar', 50, 0).clears, 'not met');
  assert.equal(requestTest({}, 'solar', null, 0).clears, 'unknown');
});

test('requestSide labels name every case the rule reads', () => {
  assert.match(requestSide('storage').label, /shoulder charge/);
  assert.doesNotMatch(requestSide('storage').label, /summer-peak (charge|withdrawal)/);
  assert.match(requestSide('datacenter').label, /large-load/);
});

test('a grouped station is evaluated per bus: the best single bus stands for it (no mixing of cases across buses)', () => {
  const st = [
    { bus_id: 1, substation_name: 'A', nominal_kv: 115, latitude: 1, longitude: 1, mi: 1, hr_sp_dis: 200, hr_sp_chg: 0, hr_sh_dis: 200, hr_sh_chg: 5 },
    { bus_id: 2, substation_name: 'A', nominal_kv: 115, latitude: 1, longitude: 1, mi: 1, hr_sp_dis: 10, hr_sp_chg: 0, hr_sh_dis: 10, hr_sh_chg: 300 },
  ];
  const [g] = stationGroups(st, null);
  // Mixing would give min(200, 200, 300) = 200; no single bus has that.
  const t = requestTest(g, 'storage', 50, 50);
  assert.equal(t.hr, 10);
  assert.equal(t.bus, 2);
  assert.equal(t.clears, 'not met');
  assert.equal(g.hr_sh_chg, 300); // group maxima kept for the table
});

test('permitList: common items plus fuel-specific ones; nothing generator-only on a load', () => {
  const ids = t => permitList(t).map(p => p.id);
  assert.ok(ids('wind').includes('faa') && ids('wind').includes('noise') && ids('wind').includes('setback'));
  assert.ok(ids('storage').includes('nfpa855') && ids('storage').includes('bsetback'));
  assert.ok(ids('solar').includes('glare') && ids('solar').includes('decom'));
  assert.ok(['water', 'dnoise', 'service'].every(k => ids('datacenter').includes(k)));
  assert.ok(!ids('datacenter').includes('glare') && !ids('datacenter').includes('decom'));
  assert.ok(!ids('solar').includes('nfpa855') && !ids('solar').includes('faa'));
  const h = ids('hybrid');
  assert.ok(h.includes('glare') && h.includes('nfpa855'));
  assert.equal(new Set(h).size, h.length, 'hybrid has no duplicate ids');
  for (const t of ['solar', 'wind', 'storage', 'hybrid', 'datacenter']) for (const p of permitList(t)) assert.ok(p.label && p.why && p.group, `${t}/${p.id}`);
  assert.match(PERMIT_DISCLAIMER, /not a legal determination/);
});

test('permitRows: status by id, legacy index keys still read for the common items, blank is unknown', () => {
  const rows = permitRows({ zoning: 'done', 3: 'in progress', faa: 'not needed', bogus: 'x' }, 'wind');
  assert.equal(rows.find(r => r.id === 'zoning').status, 'done');
  assert.equal(rows.find(r => r.id === 'stormwater').status, 'in progress'); // legacy index 3
  assert.equal(rows.find(r => r.id === 'faa').status, 'not needed');
  assert.equal(rows.find(r => r.id === 'noise').status, 'unknown');
  const c = permitCounts(rows);
  assert.equal(c.total, rows.length);
  assert.equal(c.done + c['in progress'] + c['not needed'] + c.unknown, c.total);
});

test('depthOf: screen < review < study; unknown depth defaults to review', () => {
  assert.deepEqual(DEPTHS, ['screen', 'review', 'study']);
  assert.equal(depthOf({ depth: 'study' }), 'study');
  assert.equal(depthOf({}), 'review');
  assert.equal(depthOf({ depth: 'bogus' }), 'review');
});
