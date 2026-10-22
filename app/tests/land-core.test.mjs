// Land core v2: disc composition, block cover, need matrix, cost grid, lease vs buy, station grouping,
// line-cost grid, permit summary and timeline. Blank is never 0; unknown never passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  screen, footprint, discSplit, blockCover, needMatrix, costGrid, leaseVsBuy, annuityFactor, stationGroups,
  clearsRequest, perMile, lineCostGrid, permitSummary, permitTimeline, excludedRange, requestSide, pctRank, requestHeadroom,
} from '../landcore.js';

const L = JSON.parse(readFileSync(new URL('../data/land.json', import.meta.url)));
const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test('discSplit: block + certain exclusion + remainder = disc; Mashpee', () => {
  const sc = screen(L.exclusions, 111403), s = discSplit(sc);
  near(s.block + s.excludedMin + s.rest, sc.gross);
  assert.equal(s.block, 11913.1);
  near(s.excludedMin, 6107.9); // protected is the largest subtracted layer (habitat 0)
  assert.equal(discSplit(null), null);
});

test('excludedRange: lower = largest layer, upper = min(sum, disc − block)', () => {
  const sc = screen(L.exclusions, 100095), r = excludedRange(sc);
  near(r.low, 52806.9);
  near(r.high, Math.min(52806.9 + 6545.6, sc.gross - sc.clear));
  assert.equal(excludedRange(null), null);
});

test('blockCover: ratio per band; no screen → null ratios, never a pass', () => {
  const fp = footprint(L.intensity, 'solar', 100), c = blockCover(fp, screen(L.exclusions, 111403));
  near(c.base, 11913.1 / 560);
  const u = blockCover(fp, null);
  assert.equal(u.base, null);
  assert.equal(u.status, 'unknown');
});

test('needMatrix: every tech × size, linear in MW, blanks stay null', () => {
  const m = needMatrix(L.intensity, ['solar', 'wind', 'storage'], [50, 100, 500]);
  assert.equal(m.length, 9);
  const s50 = m.find(r => r.tech === 'solar' && r.mw === 50), s500 = m.find(r => r.tech === 'solar' && r.mw === 500);
  near(s500.base, 10 * s50.base);
  assert.equal(needMatrix(L.intensity, ['nuclear'], [100])[0].base, null);
});

test('costGrid: acres × $/acre per band; a blank rate is not held', () => {
  const fp = footprint(L.intensity, 'solar', 100);
  const g = costGrid(fp, [{ label: 'A', rate: 10000 }, { label: 'B', rate: null }]);
  assert.equal(g.length, 3);
  near(g[1].costs[0], 560 * 10000);
  assert.equal(g[1].costs[1], null);
});

test('annuityFactor: closed form equals the loop sum (growing annuity, and g = r)', () => {
  const loop = (r, g, n) => { let s = 0; for (let t = 1; t <= n; t++) s += (1 + g) ** (t - 1) / (1 + r) ** t; return s; };
  near(annuityFactor(0.08, 0.02, 30), loop(0.08, 0.02, 30));
  near(annuityFactor(0.05, 0.05, 20), loop(0.05, 0.05, 20));
  near(annuityFactor(0.07, 0, 25), loop(0.07, 0, 25));
  assert.equal(annuityFactor(null, 0, 25), null);
});

test('leaseVsBuy: needs every input; blank resale gives a buy upper bound, never a silent 0', () => {
  const miss = leaseVsBuy({ acres: 560, buy: 10000, lease: 800 });
  assert.equal(miss.status, 'not held');
  assert.ok(miss.missing.includes('discount rate'));
  const r = leaseVsBuy({ acres: 560, buy: 10000, lease: 800, disc: 8, years: 30, esc: 2 });
  near(r.pvLease, 560 * 800 * annuityFactor(0.08, 0.02, 30));
  assert.equal(r.pvResale, null);
  assert.equal(r.buyBound, 'upper');
  near(r.breakevenLease, (560 * 10000) / (560 * annuityFactor(0.08, 0.02, 30)));
  const r2 = leaseVsBuy({ acres: 560, buy: 10000, lease: 800, disc: 8, years: 30, esc: 2, resale: 100 });
  near(r2.pvResale, 560 * 10000 / 1.08 ** 30);
  near(r2.netBuy, 560 * 10000 - r2.pvResale);
  assert.equal(r2.buyBound, null);
  assert.equal(leaseVsBuy({ acres: 560, buy: 1, lease: 1, disc: 8, years: 0, esc: 0 }).status, 'not held');
});

test('stationGroups: buses sharing name, kV and coordinate are one station; own station dropped', () => {
  const st = [
    { bus_id: 1, substation_name: 'A', nominal_kv: 115, latitude: 1, longitude: 1, mi: 0, hr_sp_dis: 10, hr_ll_chg: null },
    { bus_id: 2, substation_name: 'A', nominal_kv: 115, latitude: 1, longitude: 1, mi: 0, hr_sp_dis: 12, hr_ll_chg: 5 },
    { bus_id: 3, substation_name: 'B', nominal_kv: 345, latitude: 2, longitude: 2, mi: 4, hr_sp_dis: null, hr_ll_chg: null },
    { bus_id: 4, substation_name: 'C', nominal_kv: 115, latitude: 3, longitude: 3, mi: 6, hr_sp_dis: 50, hr_ll_chg: 40 },
  ];
  const g = stationGroups(st, { name: 'A', kv: 115 });
  assert.deepEqual(g.map(x => x.name), ['B', 'C']);
  assert.equal(g[0].hr_sp_dis, null);
  const all = stationGroups(st, null);
  assert.equal(all[0].buses, 2);
  assert.equal(all[0].hr_sp_dis, 12);
  assert.equal(all[0].hr_ll_chg, 5);
});

test('clearsRequest / requestSide: unknown never passes; data centre reads withdrawal', () => {
  assert.equal(clearsRequest(null, 100), 'unknown');
  assert.equal(clearsRequest(120, 100), 'met');
  assert.equal(clearsRequest(80, 100), 'not met');
  assert.deepEqual(requestSide('datacenter').keys, ['hr_ll_chg', 'hr_sp_chg']);
  assert.deepEqual(requestSide('solar').keys, ['hr_sp_dis', 'hr_sh_dis']);
});

// v4 (2026-09-30): the Grid rule (gridrules.applicableCases) replaces the summer-peak charge for storage.
test('requestHeadroom: the lowest applicable case, unknown when any applicable case is missing', () => {
  assert.equal(requestHeadroom({ hr_sp_dis: 90, hr_sh_dis: 95, hr_sp_chg: 40, hr_sh_chg: 60 }, 'storage'), 60);
  assert.equal(requestHeadroom({ hr_sp_dis: 90, hr_sh_dis: 95, hr_sh_chg: null }, 'storage'), null);
  assert.equal(requestHeadroom({ hr_ll_chg: 7, hr_sp_chg: 30 }, 'datacenter'), 7);
  assert.equal(requestHeadroom({ hr_sp_dis: 90, hr_sh_dis: 120 }, 'solar'), 90);
});

test('perMile: headroom ÷ max(miles, 0.5); null headroom is null', () => {
  near(perMile(100, 4), 25);
  near(perMile(100, 0), 200);
  assert.equal(perMile(null, 3), null);
});

test('lineCostGrid: miles × factor × $/mile; a factor below 1 is rejected', () => {
  const g = lineCostGrid(10, [1e6, null], [1, 1.3, 0.8]);
  near(g[0].cells[1], 13e6);
  assert.equal(g[1].cells[0], null);
  assert.equal(g[0].cells[2], null);
  assert.equal(lineCostGrid(null, [1e6], [1])[0].cells[0], null);
});

test('permitSummary: counts every permit, blank is unknown', () => {
  const s = permitSummary({ 0: 'done', 2: 'in progress', 3: 'not needed' }, 7);
  assert.deepEqual(s, { unknown: 4, 'not needed': 1, 'in progress': 1, done: 1, total: 7 });
});

test('permitTimeline: start + offset months; blank duration is open-ended, no start is null', () => {
  const t = permitTimeline('2027-01', [{ label: 'A', offset: 0, dur: 6 }, { label: 'B', offset: 3, dur: null }, { label: 'C', offset: null, dur: 4 }]);
  assert.equal(new Date(t[0].start).getUTCMonth(), 0);
  assert.equal(new Date(t[0].end).getUTCMonth(), 6);
  assert.equal(t[1].end, null);
  assert.equal(t.length, 2); // C has no start offset: not placed
  assert.equal(permitTimeline('', [{ label: 'A', offset: 0, dur: 6 }]), null);
});

test('pctRank: share of held values at or below', () => {
  near(pctRank({ below_or_equal: 50, of: 200 }), 25);
  assert.equal(pctRank(null), null);
});
