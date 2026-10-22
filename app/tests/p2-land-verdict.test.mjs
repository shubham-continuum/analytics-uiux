// P2 land fixes: C07 (D6.1 on Land: Grid's caseTable verdict per station, envelope-only is Hold and never counts as
// clear), C41 (the candidate's own row = Grid's verdict), C40 (the station list says when it is truncated), C44 (permit
// timing reads every checklist item, sample index keys included). Cross-stage: Land, Grid and Economics agree.
// Provenance: Claude Opus 5.5 (P2 land fix agent) · one-studio/design (T3, P2 land) · 2026-10-10 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  landVerdict, stationVerdict, stationGrid, stationGroups, stationCoverage, countFits, permitTiming, permitList, permitTimeline,
  STATION_ROW_CAP, CASE_FIELD,
} from '../landcore.js';
import { caseTable, binding, ENVELOPE_ONLY } from '../gridrules.js';

// Real store rows: data/snapshot.json carries fact_headroom + fact_limiting_element for six buses (111403 Mashpee,
// 111209, 114417 ...). 111403 holds no shoulder|charge element rows, so its storage charge is envelope only (99.2 MW).
const snap = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
const G = snap.grid;
const BUSES = [...new Set(G.headroom.map(h => String(h.bus_id)))];
const TECHS = ['solar', 'wind', 'storage', 'hybrid', 'datacenter'];
const SIZES = [[50, 50], [100, 100], [150, 0], [300, 300], [0, 60], [600, 600]];

/** A Land API station row for a bus, from the same store rows (what api_land.py returns per station). */
const apiRow = bus => ({ bus_id: Number(bus), ...Object.fromEntries(Object.entries(CASE_FIELD).map(([k, f]) => { const [s, d] = k.split('|'); const h = G.headroom.find(r => String(r.bus_id) === String(bus) && r.scenario === s && r.direction === d); return [f, h ? h.headroom_mw : null]; })) });
const elementsOf = bus => G.constraints.filter(r => String(r.bus_id) === String(bus));

test('C07/C41 landVerdict = Grid binding() per direction for every snapshot bus, fuel and size (one rule)', () => {
  for (const bus of BUSES) for (const tech of TECHS) for (const [e, i] of SIZES) {
    const v = landVerdict(G, bus, tech, e, i), t = caseTable(G, bus, tech, e, i);
    assert.equal(v.export.status, binding(t, 'export').status, `${bus} ${tech} ${e}/${i} export`);
    assert.equal(v.import.status, binding(t, 'import').status, `${bus} ${tech} ${e}/${i} import`);
    assert.equal(v.clears, v.status === 'Fits', 'only Fits clears');
    if (v.status === 'Fits') assert.ok([v.export, v.import].every(b => ['Fits', 'Not requested'].includes(b.status)));
  }
});

test('C07 envelope-only evidence is "Envelope only (Hold)": never Fits, never Does not fit, never clears', () => {
  // 111403 storage 100/100: shoulder charge has no element rows -> envelope only (99.2 MW) even though 100 > 99.2.
  const v = landVerdict(G, 111403, 'storage', 100, 100);
  assert.equal(v.import.status, ENVELOPE_ONLY);
  assert.notEqual(v.status, 'Does not fit');
  assert.equal(v.clears, false);
  assert.match(v.label, /Envelope only \(Hold\)|Hold/);
  // A station with only envelopes (no element rows on the payload) is envelope only both ways.
  const hi = stationVerdict({ bus_id: 1, hr_sp_dis: 550, hr_sh_dis: 550 }, 'solar', 100, 0, []);
  assert.equal(hi.status, ENVELOPE_ONLY); assert.equal(hi.label, 'Envelope only (Hold)'); assert.equal(hi.clears, false);
  const lo = stationVerdict({ bus_id: 1, hr_sp_dis: 10, hr_sh_dis: 10 }, 'solar', 100, 0, []);
  assert.equal(lo.status, ENVELOPE_ONLY, 'a 10 MW envelope is not "does not clear": D6.1');
  assert.equal(lo.clears, false);
  const none = stationVerdict({ bus_id: 1 }, 'solar', 100, 0, []);
  assert.equal(none.status, 'Not studied'); assert.equal(none.clears, false);
});

test('C07 cross-stage: a bus read as a Land station (API row + element rows) gets the same status as Grid gives it as the candidate', () => {
  for (const bus of BUSES) for (const tech of TECHS) for (const [e, i] of SIZES) {
    const asStation = stationVerdict(apiRow(bus), tech, e, i, G.constraints);
    const asGrid = landVerdict(G, bus, tech, e, i);
    assert.equal(asStation.status, asGrid.status, `${bus} ${tech} ${e}/${i}`);
    assert.equal(asStation.export.status, asGrid.export.status); assert.equal(asStation.import.status, asGrid.import.status);
  }
  // stationGrid keeps the bus's own element rows only
  const g = stationGrid(apiRow(111403), G.constraints);
  assert.ok(g.constraints.length && g.constraints.every(r => String(r.bus_id) === '111403'));
  assert.equal(g.constraints.length, elementsOf(111403).length);
  assert.ok(g.headroom.every(h => typeof h.headroom_mw === 'number'));
});

test('C07 grouped station: the best single bus stands for it (Fits over Hold over Does not fit); cases never mixed', () => {
  const st = [
    { bus_id: 111403, substation_name: 'X', nominal_kv: 115, latitude: 41.6, longitude: -70.5, mi: 2, ...apiRow(111403) },
    { bus_id: 111209, substation_name: 'X', nominal_kv: 115, latitude: 41.6, longitude: -70.5, mi: 2, ...apiRow(111209) },
  ];
  const [grp] = stationGroups(st, null);
  const v = stationVerdict(grp, 'solar', 100, 0, G.constraints);
  const a = landVerdict(G, 111403, 'solar', 100, 0), b = landVerdict(G, 111209, 'solar', 100, 0);
  const rank = s => (s === 'Fits' ? 2 : s === 'Does not fit' ? 0 : 1);
  assert.equal(rank(v.status), Math.max(rank(a.status), rank(b.status)));
  assert.ok(['111403', '111209'].includes(String(v.bus)));
});

test('C07 countFits counts Fits only; envelope-only and Hold stations never count as clear', () => {
  const gs = [{ v: { status: 'Fits', clears: true } }, { v: { status: ENVELOPE_ONLY, clears: false } }, { v: { status: 'Hold', clears: false } }, { v: { status: 'Does not fit', clears: false } }];
  assert.deepEqual(countFits(gs), { fits: 1, hold: 2, doesNotFit: 1, total: 4 });
});

test('C40 stationCoverage: a capped list is flagged with its effective radius; a full list is not', () => {
  const rows = n => Array.from({ length: n }, (_, k) => ({ mi: (k + 1) * 0.0742 }));
  const cap = stationCoverage({ stations: rows(STATION_ROW_CAP), radii: { stations: 15 } });
  assert.equal(cap.truncated, true);
  assert.ok(Math.abs(cap.effMi - STATION_ROW_CAP * 0.0742) < 1e-9);
  assert.match(cap.label, /truncated/); assert.doesNotMatch(cap.label, /within 15 mi$/);
  const full = stationCoverage({ stations: rows(245), stationsTotal: 245, radii: { stations: 15 } });
  assert.equal(full.truncated, false); assert.equal(full.effMi, 15); assert.equal(full.label, 'within 15 mi');
  const short = stationCoverage({ stations: rows(12), radii: { stations: 15 } });
  assert.equal(short.truncated, false);
  const partial = stationCoverage({ stations: rows(60), stationsTotal: 108, radii: { stations: 15 } });
  assert.equal(partial.truncated, true); assert.match(partial.label, /60 of 108/);
  assert.equal(stationCoverage(null), null);
});

test('C44 permitTiming dates every checklist item: id keys first, then the sample generator index keys (po0..po17)', () => {
  const L = { ...Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`po${i}`, i * 2])), ...Object.fromEntries(Array.from({ length: 18 }, (_, i) => [`pd${i}`, 6 + (i % 4) * 2])) };
  for (const tech of TECHS) {
    const rows = permitTiming(L, tech), list = permitList(tech);
    assert.equal(rows.length, list.length, tech);
    assert.ok(rows.every(r => typeof r.offset === 'number' && typeof r.dur === 'number'), `${tech}: every item dated`);
    const tasks = permitTimeline('2027-01', rows);
    assert.equal(tasks.length, list.length, `${tech}: no technology item dropped from the timeline`);
  }
  // storage NFPA 855 (index 7) is dated from po7
  const st = permitTiming(L, 'storage');
  assert.equal(st.find(r => r.id === 'nfpa855').offset, 14);
  // an id key wins over the index key; a blank stays not held (never 0)
  const own = permitTiming({ po_nfpa855: 3, po7: 14 }, 'storage');
  assert.equal(own.find(r => r.id === 'nfpa855').offset, 3);
  assert.equal(own.find(r => r.id === 'nfpa855').dur, null);
  assert.equal(permitTiming({}, 'wind').every(r => r.offset === null && r.dur === null), true);
});
