// Pure logic for the Economics "How the market model runs storage" card (views/economics-esr.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { esrMetrics, esrNearby, zoneSaturation } from '../views/economics-esr.js';

const res = [
  { bidder_index: 1, resource_name: 'Near A', zone: 'SEMA', lat: 41.7, lon: -70.5, econ_max_mw: 100, esr_max_storage_mwh: 400 },
  { bidder_index: 2, resource_name: 'Far same zone', zone: 'SEMA', lat: null, lon: null, econ_max_mw: 50, esr_max_storage_mwh: 100 },
  { bidder_index: 3, resource_name: 'Far other zone', zone: 'ME', lat: 44.5, lon: -69.5, econ_max_mw: 200, esr_max_storage_mwh: 800 },
  { bidder_index: 4, resource_name: 'ISO-wide', zone: 'Multiple', lat: null, lon: null, econ_max_mw: 277, esr_max_storage_mwh: 1108 },
];
const run = (b, sc, o = {}) => ({ scenario: sc, bidder_index: b, hours: 8712, days: 363, dis_mwh: 36300, ch_mwh: 46000, net: 726000, rev_dis: 2000000, cost_ch: 1274000, soc_cap: 400, swing_mean: 200, h_full: 100, h_empty: 200, h_dis: 1000, h_ch: 1200, soc_first: 200, soc_last: 200, ceiling: 1452000, k: 4, tb_mean: 10, net_daysum: 726000, ...o });
const data = { bus: { lat: 41.6, lon: -70.5, zone: 'SEMA' }, resources: res, runs: [run(1, 'pcr2030'), run(2, 'pcr2030'), run(3, 'pcr2030'), run(4, 'pcr2030'), run(1, 'pcr2040'), run(3, 'pcr2040', { dis_mwh: 0, net: 0, ceiling: 0 })] };

test('esrMetrics: cycles/day, $ per MWh discharged, SOC use, share of the ceiling, implied charging efficiency', () => {
  const m = esrMetrics(run(1, 'pcr2030'), res[0]);
  assert.ok(Math.abs(m.cyclesPerDay - 36300 / 400 / 363) < 1e-12);   // 0.25
  assert.ok(Math.abs(m.netPerMWh - 726000 / 36300) < 1e-12);          // $20
  assert.ok(Math.abs(m.socUse - 0.5) < 1e-12);                        // swing 200 of 400
  assert.ok(Math.abs(m.ofCeiling - 0.5) < 1e-12);
  assert.ok(Math.abs(m.chargeEff - (36300 + 0) / 46000) < 1e-12);
  assert.equal(m.mw, 100); assert.equal(m.mwh, 400);
});

test('esrMetrics: no discharge → per-MWh and share are not held, never zero; zero ceiling is not held', () => {
  const m = esrMetrics(run(3, 'pcr2040', { dis_mwh: 0, net: 0, ceiling: 0 }), res[2]);
  assert.equal(m.netPerMWh, null); assert.equal(m.ofCeiling, null); assert.equal(m.cyclesPerDay, 0);
});

test('esrNearby: within the radius OR in the bus zone; distance null when location not held; sorted by distance', () => {
  const n = esrNearby(data, { run: 'pcr2030', radiusMi: 25 });
  assert.deepEqual(n.map(r => r.name), ['Near A', 'Far same zone']);
  assert.ok(n[0].mi < 10); assert.equal(n[1].mi, null); assert.equal(n[1].why, 'same zone (location not held)');
  const wide = esrNearby(data, { run: 'pcr2030', radiusMi: 500 });
  assert.ok(wide.some(r => r.name === 'Far other zone'));
  assert.ok(!wide.some(r => r.name === 'ISO-wide'));
  assert.deepEqual(esrNearby(data, { run: 'pcr2035', radiusMi: 25 }), []);
});

test('zoneSaturation: modelled storage MW and MWh per zone by run', () => {
  const z = zoneSaturation(data);
  const sema30 = z.find(r => r.zone === 'SEMA' && r.run === 'pcr2030');
  assert.equal(sema30.mw, 150); assert.equal(sema30.mwh, 500); assert.equal(sema30.n, 2);
  assert.equal(z.find(r => r.zone === 'SEMA' && r.run === 'pcr2040').mw, 100);
  assert.equal(z.find(r => r.zone === 'Multiple' && r.run === 'pcr2030').mw, 277);
});
