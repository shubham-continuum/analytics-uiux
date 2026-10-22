import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  registerRows, requestedMW, fuelGroup, outcomesBy, vintages, durationsObserved, quantile, summary,
  projectedDurations, registerNear, studyStatusNow, sizeBand, depositCurve, crossTab,
} from '../queuecore.js';

const REG = JSON.parse(readFileSync(new URL('../data/queue-register.json', import.meta.url), 'utf8'));
const Q = JSON.parse(readFileSync(new URL('../data/queue.json', import.meta.url), 'utf8'));
const rows = registerRows(REG);

test('register rows: 1,751 objects keyed by the published columns', () => {
  assert.equal(rows.length, 1751);
  assert.ok('qp' in rows[0] && 'status' in rows[0] && 'requested' in rows[0]);
});

test('requested MW = net, else summer where net is blank or zero; neither → not held (never 0)', () => {
  assert.deepEqual(requestedMW({ net_mw: 50, summer_mw: 40 }), { mw: 50, basis: 'net' });
  assert.deepEqual(requestedMW({ net_mw: 0, summer_mw: 838.2 }), { mw: 838.2, basis: 'summer' });
  assert.deepEqual(requestedMW({ net_mw: null, summer_mw: null }), { mw: null, basis: 'not held' });
  assert.deepEqual(requestedMW({ net_mw: 0, summer_mw: 0 }), { mw: null, basis: 'not held' });
});

test('fuel groups keep hybrids apart and never guess a blank', () => {
  assert.equal(fuelGroup('SUN'), 'Solar');
  assert.equal(fuelGroup('SUN BAT'), 'Solar + storage');
  assert.equal(fuelGroup('BAT'), 'Storage');
  assert.equal(fuelGroup('DFO NG'), 'Gas / oil');
  assert.equal(fuelGroup(null), 'Not stated');
  assert.equal(fuelGroup('N/A'), 'Not stated');
});

test('outcomes: completion = in service ÷ (in service + withdrawn); no resolved rows → not held', () => {
  const o = outcomesBy([{ status: 'C' }, { status: 'W' }, { status: 'W' }, { status: 'A' }], () => 'x')[0];
  assert.equal(o.n, 4); assert.equal(o.C, 1); assert.equal(o.W, 2); assert.equal(o.A, 1);
  assert.equal(o.completion, 1 / 3); assert.equal(o.withdrawnShare, 0.5);
  assert.equal(outcomesBy([{ status: 'A' }], () => 'y')[0].completion, null);
});

test('vintages from the register equal the Studio copy of queue_trends, year for year', () => {
  const v = vintages(rows);
  assert.equal(v.reduce((a, r) => a + r.n, 0), 1751);
  for (const t of Q.trends) {
    const r = v.find(x => x.year === t.entry_year);
    assert.deepEqual([r.n, r.W, r.A, r.C], [t.projects, t.withdrawn, t.active, t.in_service], `year ${t.entry_year}`);
  }
});

test('observed durations: in service uses op_date, withdrawn uses wd_date; impossible dates excluded and counted', () => {
  const d = durationsObserved([
    { status: 'C', requested: '2010-01-01', op_date: '2012-01-01' },
    { status: 'C', requested: '2010-01-01', op_date: '2009-01-01' },
    { status: 'W', requested: '2010-01-01', wd_date: '2011-01-01' },
    { status: 'W', requested: '2010-01-01', wd_date: null },
    { status: 'A', requested: '2020-01-01', op_date: '2030-01-01' },
  ]);
  assert.equal(d.service.length, 1); assert.ok(Math.abs(d.service[0].years - 2) < 0.01);
  assert.equal(d.withdraw.length, 1);
  assert.equal(d.excluded.serviceBeforeRequest, 1); assert.equal(d.excluded.withdrawUndated, 1);
  const real = durationsObserved(rows);
  assert.equal(real.excluded.serviceBeforeRequest, 5);
  assert.ok(real.service.length > 300 && real.withdraw.length > 1000);
});

test('quantile uses linear interpolation (type 7); summary carries n', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(quantile([5], 0.9), 5);
  assert.equal(quantile([], 0.5), null);
  const s = summary([4, 1, 3, 2]);
  assert.equal(s.n, 4); assert.equal(s.p50, 2.5); assert.equal(s.min, 1); assert.equal(s.max, 4);
});

test('projected durations are the register projections, not actuals; missing dates are counted not zeroed', () => {
  const p = projectedDurations([{ request_date: '2020-01-01', projected_is_date: '2023-01-01' }, { request_date: '2020-01-01', projected_is_date: null }]);
  assert.equal(p.values.length, 1); assert.ok(Math.abs(p.values[0].years - 3) < 0.01); assert.equal(p.undated, 1);
});

test('register rows near a bus: only located rows, within the radius, with their tier', () => {
  const bus = { latitude: 42, longitude: -71 };
  const rs = [{ lat: 42.05, lon: -71, tier: 'normalised' }, { lat: 43, lon: -71, tier: 'normalised' }, { lat: null, lon: null, tier: 'no_match' }];
  const n = registerNear(rs, bus, 10);
  assert.equal(n.rows.length, 1); assert.equal(n.rows[0].tier, 'normalised'); assert.equal(n.unplaced, 1);
});

test('the solved case\'s 110 positions, found in the register by QP + request date: 51 withdrawn, 34 in service, 25 active', () => {
  const s = studyStatusNow(Q.queue, rows);
  assert.deepEqual([s.counts.W, s.counts.C, s.counts.A, s.counts.missing], [51, 34, 25, 0]);
});

test('size band is half to twice the requested MW and reports its population', () => {
  const b = sizeBand(rows, 100);
  assert.equal(b.lo, 50); assert.equal(b.hi, 200);
  assert.ok(b.n > 50 && b.withdrawnShare > 0 && b.withdrawnShare < 1);
  assert.equal(sizeBand(rows, null), null);
});

// S3 (2026-10-06): corrected rule. The ISO-NE default is flat (Q-C1); the old pro forma assertions run under 'proforma'.
test('deposit curve (ISO-NE default): $315k at ≤ 20 MW (Schedule 23), flat $800k above, $300k of it cash', () => {
  const c = depositCurve([20, 21, 100, 500]);
  assert.deepEqual(c.map(p => p.cashAtRequest), [315000, 800000, 800000, 800000]);
  assert.deepEqual(c.map(p => p.cash), [115000, 300000, 300000, 300000]);
  assert.ok(c.every(p => !p.notModelled));
});

test('deposit curve (pro forma, labelled): 20 MW is not modelled; 100 MW needs $455k at request', () => {
  const c = depositCurve([20, 21, 100, 500], 'proforma');
  assert.equal(c[0].notModelled, true); assert.equal(c[0].cashAtRequest, null);
  assert.equal(c[1].studyDeposit, 56000);
  assert.equal(c[2].cashAtRequest, 455000);
  assert.equal(c[3].studyDeposit, 250000); assert.equal(c[3].cashAtRequest, 5000 + 3 * 250000);
});

test('crossTab sums a value by two keys and keeps missing cells null', () => {
  const t = crossTab([{ a: 'x', b: 'p', v: 1 }, { a: 'x', b: 'p', v: 2 }, { a: 'y', b: 'q', v: 5 }], r => r.a, r => r.b, r => r.v);
  assert.deepEqual(t.rows, ['x', 'y']); assert.deepEqual(t.cols, ['p', 'q']);
  assert.deepEqual(t.values, [[3, null], [null, 5]]);
});
