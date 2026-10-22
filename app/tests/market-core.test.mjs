// Market core v3 unit tests (no server): requirement checks, funnel, weights, discrimination, sensitivity,
// size profile, histogram, case matrix, measures overlay. Synthetic buses built to the /api/market shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepare, evaluate, rank, sizeSweep, requirementChecks, funnel, requirementMatrix, attachMeasures, MEASURES,
  defaultWeights, discrimination, sensitivity, sizeProfile, histogram, caseMatrix, marketPercentiles, quantile, median,
  genMixShares, contributions,
} from '../marketcore.js';

const el = (bus, scenario, direction, transfer, extra = {}) => ({ bus_id: bus, scenario, direction, monitored_facility: `F${bus}${scenario}${transfer}`, binding_contingency: 'C1', contingency_id: 7, dfax: 0.2, transfer_mw: transfer, base_flow_mw: 50, contingency_flow_mw: 60, rating_a_mva: 100, rating_c_mva: 120, pct_loading_no_transfer: 50, fix_cost_musd: 1, length_miles: 1, facility_type: 'line', ...extra });
const node = (id, o = {}) => ({ bus_id: id, name: `Bus ${id}`, zone: 'ME', kv: 115, lat: 44, lon: -70, tier: 'direct', proxyKm: null, lmp_2025: 60, lmp_2030: 45, hneg_2025: 50, tb4_2025: 60, solar_ratio_2025: 0.97, sc_mva: 2000, ...o });
function study() {
  return prepare({
    nodes: [node(1), node(2, { zone: 'CT', lmp_2025: 70, kv: 345 }), node(3, { lmp_2025: null }), node(4, { zone: 'CT', lmp_2030: 0 }), node(5, { kv: null })],
    grid: {
      headroom: [1, 2, 3, 4].map(b => ({ bus_id: b, scenario: 'shoulder', direction: 'discharge', headroom_mw: 1000 })),
      constraints: [
        el(1, 'summer_peak', 'discharge', 300), el(1, 'shoulder', 'charge', 400),
        el(2, 'summer_peak', 'discharge', 120), el(2, 'shoulder', 'charge', 90),
        el(3, 'summer_peak', 'discharge', 500),
        el(4, 'summer_peak', 'discharge', 80, { pct_loading_no_transfer: 130 }), el(4, 'summer_peak', 'discharge', 150),
        // bus 5: no rows at all -> not studied
      ],
    },
  });
}
const REQ = { tech: 'solar', exportMW: 100, importMW: 0, zones: null, minKv: 0, useShoulder: true };

test('requirementChecks agree with evaluate() on every bus and request', () => {
  const s = study();
  for (const r of [REQ, { ...REQ, minKv: 230 }, { ...REQ, zones: ['CT'] }, { ...REQ, maxPrice2025: 65 }, { ...REQ, tech: 'storage', importMW: 100 }, { ...REQ, exportMW: 200, ownPriceNode: true }]) {
    const ev = evaluate(s, r);
    for (const e of ev) {
      const c = requirementChecks(s, e.node, r);
      const st = c.some(x => x.status === 'excluded') ? 'excluded' : c.some(x => x.status === 'fail') ? 'unmet' : c.some(x => x.status === 'unknown') ? 'unknown' : 'met';
      assert.equal(st, e.status, `${e.node.bus_id} ${JSON.stringify(r)}`);
    }
  }
});

test('funnel is monotone, ends at the met count and accounts for every bus', () => {
  const s = study(), r = { ...REQ, minKv: 115, maxPrice2025: 65 };
  const f = funnel(s, r), met = evaluate(s, r).filter(e => e.status === 'met').length;
  assert.equal(f.steps[0].remain, s.nodes.length);
  for (let i = 1; i < f.steps.length; i++) {
    assert.ok(f.steps[i].remain <= f.steps[i - 1].remain);
    assert.equal(f.steps[i - 1].remain - f.steps[i].remain, f.steps[i].fail + f.steps[i].unknown + f.steps[i].excluded);
  }
  assert.equal(f.steps.at(-1).remain, met);
});

test('requirement matrix counts each requirement independently; unknown never counted as pass', () => {
  const s = study(), m = requirementMatrix(s, { ...REQ, maxPrice2025: 65 });
  const price = m.find(x => x.key === 'maxPrice');
  assert.equal(price.pass + price.fail + price.unknown, price.applies);
  assert.equal(price.unknown, 1); // bus 3 has no 2025 price
  const exp = m.find(x => x.key === 'summer_peak|discharge');
  assert.equal(exp.unknown, 1); // bus 5 not studied
});

test('attachMeasures overlays measures and nulls an unpriced run instead of a $0 price', () => {
  const s = study();
  const n = attachMeasures(s, { buses: { 4: { unpriced: ['pcr2030'], f: {} }, 1: { tb4_30: 12, f: { pcr2030: 45 } } } });
  assert.equal(n.unpricedFixed, 1);
  assert.equal(s.nodes.find(x => x.bus_id === 4).lmp_2030, null);
  assert.equal(MEASURES.tb4_30.get({ node: s.nodes[0] }), 12);
  assert.equal(MEASURES.tb4_30.get({ node: s.nodes[1] }), null);
});

test('a partial settled year is not ranked as a 2025 measure', () => {
  const s = study();
  attachMeasures(s, { buses: { 2: { n: { 2025: 1465 } } } });
  assert.equal(MEASURES.price.get({ node: s.nodes[1] }), null);
  assert.equal(MEASURES.price.get({ node: s.nodes[0] }), 60);
});

test('default weights exist for every service and name only known measures', () => {
  for (const t of ['solar', 'wind', 'storage', 'hybrid', 'datacenter']) {
    const w = defaultWeights(t); assert.ok(Object.keys(w).length >= 5);
    for (const k of Object.keys(w)) assert.ok(MEASURES[k], `${t}: ${k}`);
  }
});

test('weighted rank: weights change the order; zero weight removes a criterion', () => {
  const pool = [1, 2, 3, 4].map(i => ({ status: 'met', margin: i * 10, node: node(i, { lmp_2025: 100 - i * 10 }) }));
  const a = rank(pool, ['margin', 'price'], { margin: 10, price: 1 }), b = rank(pool, ['margin', 'price'], { margin: 1, price: 10 });
  assert.equal(a.scored[0].node.bus_id, 4); assert.equal(b.scored[0].node.bus_id, 1);
  const c = rank(pool, ['margin', 'price'], { margin: 5, price: 0 });
  assert.equal(c.scored[0].node.bus_id, 4); assert.equal(c.scored[0].score, 87.5);
});

test('discrimination: P5-P95 spread, within-2 count and flat criteria', () => {
  const pool = [1, 2, 3, 4, 5].map(i => ({ status: 'met', margin: i * 10, node: node(i, { sc_mva: 1000 }) }));
  const r = rank(pool, ['margin', 'strength'], { margin: 1, strength: 1 });
  const d = discrimination(r, ['margin', 'strength'], { margin: 1, strength: 1 });
  assert.deepEqual(d.flat, ['strength']);
  assert.equal(d.flatWeight, 1); assert.equal(d.totalWeight, 2);
  assert.ok(d.spread > 0 && d.within2 >= 1);
});

test('contributions sum to the score', () => {
  const pool = [1, 2, 3, 4].map(i => ({ status: 'met', margin: i * 10, node: node(i, { lmp_2025: 40 + i }) }));
  const w = { margin: 3, price: 1 }, r = rank(pool, ['margin', 'price'], w);
  for (const x of r.scored) { const c = contributions(x, ['margin', 'price'], w); assert.ok(Math.abs(c.reduce((t, k) => t + (k.points ?? 0), 0) - x.score) < 1e-9); }
});

test('sensitivity reports top-N overlap per criterion dropped, halved and doubled', () => {
  const pool = Array.from({ length: 30 }, (_, i) => ({ status: 'met', margin: (i * 7) % 30, node: node(i + 1, { lmp_2025: i, sc_mva: 1000 + ((i * 13) % 30) }) }));
  const s = sensitivity(pool, ['margin', 'price', 'strength'], { margin: 5, price: 3, strength: 1 }, 10);
  assert.equal(s.length, 3);
  for (const x of s) for (const k of ['dropped', 'halved', 'doubled']) assert.ok(x[k] >= 0 && x[k] <= 10);
  const one = sensitivity(pool, ['margin'], { margin: 5 }, 10);
  assert.equal(one[0].dropped, null); // nothing left to rank on
});

test('size profile: per-bus largest qualifying size, and its sweep equals sizeSweep', () => {
  // W-B (S2-GD #4, D6.1): the fixture's shoulder export case is a vendor envelope only (headroom row, no element rows),
  // so with it required no size qualifies (the old assertion counted the envelope as a limit); on the element cases
  // the largest qualifying size is the summer-peak element limit.
  const s = study(), sizes = [50, 100, 150, 300, 500];
  const env = sizeProfile(s, REQ, sizes);
  assert.equal(env.buses.get('1').maxMet, null, 'envelope-only shoulder case: unknown at every size');
  const R = { ...REQ, useShoulder: false }, p = sizeProfile(s, R, sizes), sw = sizeSweep(s, R, sizes);
  assert.deepEqual(p.sweep, sw);
  assert.equal(p.buses.get('1').maxMet, 300);
  assert.equal(p.buses.get('2').maxMet, 100);
  assert.equal(p.buses.get('5').maxMet, null); // unknown at every size
});

test('histogram bins every finite value once and skips nulls', () => {
  const h = histogram([1, 2, 2.5, 9, null, NaN, 10], [0, 5, 10]);
  assert.deepEqual(h.map(b => b.n), [3, 2]);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5); assert.equal(median([3, null, 1]), 2);
});

test('case matrix reads all five cases from the Grid rules', () => {
  const s = study(), m = caseMatrix(s, s.nodes[0]);
  assert.equal(m.length, 5);
  assert.equal(m.find(x => x.caseKey === 'summer_peak|discharge').value, 300);
  assert.equal(m.find(x => x.caseKey === 'large_load|charge').value, null);
});

test('market-wide percentiles place a bus among every bus holding the measure', () => {
  const pool = [1, 2, 3, 4].map(i => ({ status: i === 4 ? 'unknown' : 'met', margin: i === 4 ? null : i, node: node(i, { lmp_2025: i }) }));
  const p = marketPercentiles(pool, pool[2], ['price', 'margin']);
  assert.equal(p.find(x => x.key === 'price').pct, 62.5);
  assert.equal(p.find(x => x.key === 'margin').pct, 83.33333333333334);
});

test('generation mix shares add to 100% per year', () => {
  const g = genMixShares([{ y: 2025, fuel: 'Gas', mwh: 60 }, { y: 2025, fuel: 'Nuclear', mwh: 30 }, { y: 2025, fuel: 'Solar', mwh: 10 }, { y: 2024, fuel: 'Gas', mwh: 5 }]);
  const y25 = g.find(x => x.y === 2025);
  assert.equal(y25.total, 100); assert.equal(y25.share.Gas, 60);
  assert.ok(Math.abs(Object.values(y25.share).reduce((a, b) => a + b, 0) - 100) < 1e-9);
});
