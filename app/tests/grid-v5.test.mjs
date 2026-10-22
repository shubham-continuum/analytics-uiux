// Gap brief v4/v5 (Grid): service type on headroom, affected-system tie adjacency, proportional-impact
// allocation, surplus interconnection screen, weighted SCR indicator, Order 1920 context, cluster parsing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  serviceTag, cnrBound, affectedSystemFlag, proportionalImpact, parseCluster, weightedScr, isIbrName, surplusScreen, order1920Screen,
  NOT_ASSESSED,
} from '../gridrules.js';

test('service tag: every export headroom figure is NR (NCIS, energy-only); charge is part of the NR request; a load has no service type', () => {
  assert.match(serviceTag('summer_peak|discharge').short, /^NR/);
  assert.match(serviceTag('shoulder|discharge').long, /energy-only/);
  assert.match(serviceTag('shoulder|charge').short, /NR/);
  assert.match(serviceTag('large_load|charge').short, /Load/);
  assert.equal(serviceTag('large_load|charge').code, 'LOAD');
  assert.equal(serviceTag('summer_peak|discharge').code, 'NR');
});

test('CNR is bounded by NR until a deliverability screen exists: never a value, only an upper bound', () => {
  assert.deepEqual(cnrBound(120), { value: null, upperBound: 120, text: 'CNR ≤ 120.0 MW (no deliverability screen held)' });
  assert.deepEqual(cnrBound(null), { value: null, upperBound: null, text: 'CNR not held (NR not held)' });
});

test('N-1-1, voltage and stability stay Not assessed with a reason', () => {
  for (const k of ['N-1-1', 'Voltage / reactive', 'Stability / inverter-based resource performance']) {
    const r = NOT_ASSESSED.find(x => x.area === k);
    assert.ok(r, k);
    assert.equal(r.status, 'Not assessed');
    assert.ok(r.why.length > 20);
  }
});

test('affected systems: bus area not held → Not held; facility end outside ISO-NE → strongest flag', () => {
  assert.equal(affectedSystemFlag({ busArea: null, ties: [], facilityEnds: [] }).flag, 'Not held');
  const f = affectedSystemFlag({ busArea: '101', homeArea: '101', ties: [{ mi: 80, label: 'NYISO' }], facilityEnds: [{ facility: 'X', areas: ['101', '102'], labels: ['ISO-NE', 'NYISO'] }] });
  assert.equal(f.flag, 'Limiting facility reaches a neighbouring system');
  assert.equal(f.level, 3);
});

test('affected systems: a tie within the radius → Tie-adjacent; far → Not indicated (never "none")', () => {
  const near = affectedSystemFlag({ busArea: '101', homeArea: '101', ties: [{ mi: 12.4, label: 'NYISO', name: 'A to B' }, { mi: 40, label: 'NB' }], facilityEnds: [] }, { nearMi: 25 });
  assert.equal(near.flag, 'Tie-adjacent');
  assert.equal(near.nearest.mi, 12.4);
  const far = affectedSystemFlag({ busArea: '101', homeArea: '101', ties: [{ mi: 80, label: 'NB' }], facilityEnds: [{ facility: 'Y', areas: ['101', '101'] }] }, { nearMi: 25 });
  assert.equal(far.flag, 'Not indicated');
  assert.equal(far.level, 0);
  assert.notEqual(far.flag, 'None');
  const out = affectedSystemFlag({ busArea: '102', homeArea: '101', ties: [], facilityEnds: [] });
  assert.equal(out.flag, 'Bus outside the ISO-NE area');
});

test('affected systems: a facility end in an unmapped area is not held for that end, never treated as ISO-NE', () => {
  const f = affectedSystemFlag({ busArea: '101', homeArea: '101', ties: [], facilityEnds: [{ facility: 'Z', areas: ['101', null] }] }, { nearMi: 25 });
  assert.equal(f.unmappedEnds, 1);
  assert.equal(f.flag, 'Not indicated');
});

test('proportional impact: DFAX × MW shares sum to 1 and the project pays its share of each priced facility', () => {
  const facilities = [
    { id: 'f1', label: 'F1', cost: 10, dfax: { P: 0.2, A: 0.1, B: 0.3 } },
    { id: 'f2', label: 'F2', cost: 4, dfax: { P: 0.5, A: -0.1, B: 0.5 } },
  ];
  const members = [{ bus: 'P', mw: 100, self: true }, { bus: 'A', mw: 200 }, { bus: 'B', mw: 100 }];
  const r = proportionalImpact(facilities, members);
  const f1 = r.facilities[0];
  // impacts 20, 20, 30 → project 20/70
  assert.ok(Math.abs(f1.share - 20 / 70) < 1e-12);
  assert.ok(Math.abs(f1.allocation - 10 * 20 / 70) < 1e-12);
  assert.ok(Math.abs(f1.members.reduce((a, m) => a + m.share, 0) - 1) < 1e-12);
  // counter-flow (negative DFAX) contributes nothing
  const f2 = r.facilities[1];
  assert.equal(f2.members.find(m => m.bus === 'A').impact, 0);
  assert.ok(Math.abs(f2.share - 50 / 100) < 1e-12);
  assert.equal(r.status, 'Allocated');
  assert.ok(Math.abs(r.projectTotal - (10 * 20 / 70 + 2)) < 1e-12);
});

test('proportional impact: a member without a DFAX makes the project share an upper bound (≤), never a lower one', () => {
  const r = proportionalImpact([{ id: 'f', label: 'F', cost: 6, dfax: { P: 0.2, A: null } }], [{ bus: 'P', mw: 100, self: true }, { bus: 'A', mw: 50 }]);
  assert.equal(r.facilities[0].bound, 'upper');
  assert.equal(r.facilities[0].share, 1);
  assert.equal(r.status, 'Upper bound');
  assert.equal(r.facilities[0].missing, 1);
});

test('proportional impact: an unpriced facility is counted, not $0; with no cluster the project pays 100%', () => {
  const r = proportionalImpact([{ id: 'f', label: 'F', cost: null, dfax: { P: 0.2 } }, { id: 'g', label: 'G', cost: 3, dfax: { P: 0.1 } }], [{ bus: 'P', mw: 100, self: true }]);
  assert.equal(r.facilities[0].allocation, null);
  assert.equal(r.unpriced, 1);
  assert.equal(r.facilities[1].share, 1);
  assert.equal(r.projectTotal, 3);
  assert.equal(r.status, 'Partly priced');
  const none = proportionalImpact([], [{ bus: 'P', mw: 100, self: true }]);
  assert.equal(none.status, 'No facilities');
  assert.equal(none.projectTotal, null);
});

test('proportional impact: project DFAX not held → share not held', () => {
  const r = proportionalImpact([{ id: 'f', label: 'F', cost: 5, dfax: { P: null, A: 0.2 } }], [{ bus: 'P', mw: 100, self: true }, { bus: 'A', mw: 50 }]);
  assert.equal(r.facilities[0].share, null);
  assert.equal(r.facilities[0].allocation, null);
});

test('cluster parsing: "bus:MW" pairs; invalid entries reported; the project bus and duplicates dropped', () => {
  const p = parseCluster('110772:150, 111455 : 80; bad, 99:-5, 111403:10, 110772:20', '111403');
  assert.deepEqual(p.members, [{ bus: '110772', mw: 150 }, { bus: '111455', mw: 80 }]);
  assert.equal(p.errors.length, 4);
  assert.deepEqual(parseCluster('', '1').members, []);
});

test('IBR by name: solar / wind / battery words; conventional names are not IBR', () => {
  for (const n of ['Kibby Wind', 'TOP MED PV', 'Casco Batt', 'Roxwind Wtg', 'Qp1165 Pv', 'Some Solar LLC', 'BESS 2']) assert.equal(isIbrName(n), true, n);
  for (const n of ['Wyman Hydro', 'Sabattus', 'North Windham', 'Pvt Gas', 'Seabrook']) assert.equal(isIbrName(n), false, n);
});

test('weighted SCR: station IBR at full weight, nearby by linear distance decay; indicator only', () => {
  const r = weightedScr({ scMVA: 3000, requestMW: 100, ibr: [{ mw: 50, mi: 0, atStation: true }, { mw: 100, mi: 7.5 }, { mw: 200, mi: 20 }] }, { radiusMi: 15 });
  assert.equal(r.scr, 30);
  assert.equal(r.ibrWeightedMW, 50 + 50);
  assert.equal(r.wscr, 3000 / 200);
  assert.equal(r.stationOnly, 3000 / 150);
  assert.equal(r.counted, 2);
  assert.match(r.label, /indicator/i);
  assert.equal(weightedScr({ scMVA: null, requestMW: 100, ibr: [] }).wscr, null);
  assert.equal(weightedScr({ scMVA: 3000, requestMW: 0, ibr: [] }).wscr, null);
});

test('weighted SCR: an IBR with MW not held is counted apart, never as 0 MW', () => {
  const r = weightedScr({ scMVA: 1000, requestMW: 100, ibr: [{ mw: null, mi: 1 }] }, { radiusMi: 15 });
  assert.equal(r.notHeld, 1);
  assert.equal(r.bound, 'upper');
});

test('surplus screen: no existing unit at the POI → not applicable; a load → not applicable', () => {
  assert.equal(surplusScreen({ units: [], requestMW: 100, limitMW: 50, tech: 'solar' }).verdict, 'Not applicable');
  assert.equal(surplusScreen({ units: [{ max_mw: 50 }], requestMW: 100, limitMW: 50, tech: 'datacenter' }).verdict, 'Not applicable');
});

test('surplus screen: request above the limit with an existing unit → candidate up to min(request, Pmax); ERIS stays ERIS', () => {
  const s = surplusScreen({ units: [{ name: 'A', status: 'Operating', gen_mw: 20, max_mw: 60 }, { name: 'B', status: 'Offline', gen_mw: 0, max_mw: 30 }], requestMW: 120, limitMW: 70, tech: 'storage' });
  assert.equal(s.pmax, 90);
  assert.equal(s.dispatched, 20);
  assert.equal(s.coverable, 90);
  assert.equal(s.verdict, 'Candidate: needs a study');
  assert.match(s.service, /ERIS-original surplus stays ERIS/);
  assert.notEqual(s.verdict, 'Pass');
});

test('surplus screen: fits without upgrades → surplus not needed; limit not held → Not established; Pmax not held → lower bound', () => {
  assert.equal(surplusScreen({ units: [{ max_mw: 60 }], requestMW: 50, limitMW: 70, tech: 'solar' }).verdict, 'Not needed: fits the limit');
  assert.equal(surplusScreen({ units: [{ max_mw: 60 }], requestMW: 50, limitMW: null, tech: 'solar' }).verdict, 'Not established');
  const lb = surplusScreen({ units: [{ max_mw: 60 }, { max_mw: null }], requestMW: 120, limitMW: 70, tech: 'solar' });
  assert.equal(lb.pmaxBound, 'lower');
  assert.equal(lb.pmaxNotHeld, 1);
});

test('Order 1920 screen: ≥200 kV and ≥$30M both required; unpriced facilities are not held; other criteria not held', () => {
  const r = order1920Screen([{ label: 'A', kv: 345, cost: 45 }, { label: 'B', kv: 345, cost: 10 }, { label: 'C', kv: 115, cost: 80 }, { label: 'D', kv: 230, cost: null }]);
  assert.deepEqual(r.meets.map(x => x.label), ['A']);
  assert.deepEqual(r.costNotHeld.map(x => x.label), ['D']);
  assert.equal(r.criteria.length, 4);
  assert.equal(r.criteria.filter(c => c.status === 'Not held').length, 3);
});
