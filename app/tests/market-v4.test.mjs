// Market v4 unit tests (no server): upgrade-cost screen, curtailment screen (PCR runs), Equal-weights preset.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepare, evaluate, requirementChecks, funnel, rank, upgradeScreen, curtailFuel, nearbyCurtailment, attachCurtailment,
  zoneCurtailment, weightPreset, defaultWeights, WEIGHT_PRESETS, curtailRows,
} from '../marketcore.js';
import { stepCostService } from '../gridrules.js';

const el = (bus, scenario, direction, transfer, extra = {}) => ({ bus_id: bus, scenario, direction, monitored_facility: `F${bus}${scenario}${transfer}`, binding_contingency: 'C1', contingency_id: 7, dfax: 0.2, transfer_mw: transfer, base_flow_mw: 50, contingency_flow_mw: 60, rating_a_mva: 100, rating_c_mva: 120, pct_loading_no_transfer: 50, fix_cost_musd: 4, length_miles: 1, facility_type: 'line', ...extra });
const node = (id, o = {}) => ({ bus_id: id, name: `Bus ${id}`, zone: 'ME', kv: 115, lat: 44, lon: -70, tier: 'direct', proxyKm: null, lmp_2025: 60, lmp_2030: 45, sc_mva: 2000, ...o });
function study() {
  return prepare({
    nodes: [node(1), node(2, { zone: 'CT', lat: 41.5, lon: -72.5 }), node(3), node(4, { zone: 'CT' }), node(5)],
    grid: {
      headroom: [1, 2, 3, 4].map(b => ({ bus_id: b, scenario: 'shoulder', direction: 'discharge', headroom_mw: 1000 })),
      constraints: [
        el(1, 'summer_peak', 'discharge', 300),
        el(2, 'summer_peak', 'discharge', 120), el(2, 'summer_peak', 'discharge', 400, { fix_cost_musd: 9 }),
        el(3, 'summer_peak', 'discharge', 150, { fix_cost_musd: null }), el(3, 'summer_peak', 'discharge', 600),
        el(4, 'summer_peak', 'discharge', 130, { fix_cost_musd: 30 }), el(4, 'summer_peak', 'discharge', 900),
        // bus 5: nothing studied
      ],
    },
  });
}
const REQ = { tech: 'solar', exportMW: 200, importMW: 0, zones: null, minKv: 0, useShoulder: false };

// ---------- upgrade-cost screen ----------
test('upgradeScreen: each Grid cost status maps to pass / fail / unknown; unknown never passes', () => {
  assert.equal(upgradeScreen({ status: 'Not requested', total: null }, 5), null);
  assert.equal(upgradeScreen({ status: 'True zero', total: 0, items: [] }, 0).status, 'pass');
  assert.equal(upgradeScreen({ status: 'No upgrades indicated', total: 0, items: [], unverified: [{}] }, 0).status, 'pass');
  assert.equal(upgradeScreen({ status: 'No upgrades indicated', total: 0, items: [] }, 0).value, null); // never shown as $0
  assert.equal(upgradeScreen({ status: 'Priced', total: 4, items: [{}] }, 5).status, 'pass');
  assert.equal(upgradeScreen({ status: 'Priced', total: 4, items: [{}] }, 3).status, 'fail');
  assert.equal(upgradeScreen({ status: 'Partly priced', total: 4, unpriced: 1, items: [{}, {}] }, 5).status, 'unknown');
  assert.equal(upgradeScreen({ status: 'Partly priced', total: 6, unpriced: 1, items: [{}, {}] }, 5).status, 'fail'); // the priced part already exceeds
  assert.equal(upgradeScreen({ status: 'Lower bound', total: 0, items: [], gaps: [{ label: 'x' }] }, 5).status, 'unknown');
  assert.equal(upgradeScreen({ status: 'Lower bound', total: 12, items: [{}], gaps: [{ label: 'x' }] }, 5).status, 'fail');
});

test('evaluate applies the upgrade screen from gridrules.stepCostService at the request size', () => {
  const s = study(), ev = evaluate(s, { ...REQ, maxUpgradeMusd: 5 });
  const st = id => ev.find(e => e.node.bus_id === id);
  // Without the screen, bus 2 is short (limit 120 MW < 200 MW); with it, the $4M upgrade admits it.
  assert.equal(evaluate(s, REQ).find(e => e.node.bus_id === 2).status, 'unmet');
  assert.equal(evaluate(s, { ...REQ, maxUpgradeMusd: 0 }).find(e => e.node.bus_id === 2).status, 'unmet');
  assert.equal(st(1).status, 'met');     // no facility below 200 MW: no upgrades indicated
  assert.equal(st(1).upgrade.value, null); // envelope-only shoulder case: never shown as $0
  assert.equal(st(2).status, 'unknown'); // P2 C10: $4M ≤ $5M but the shoulder case is envelope-only, so $4M is a lower bound: never a pass (was 'met')
  assert.equal(st(2).upgrade.value, 4);
  assert.ok(st(2).margin < 0);           // the shortfall stays visible: it qualifies with upgrades
  assert.equal(st(3).status, 'unknown'); // facility at 150 MW is unpriced: partly priced, $0 priced so far
  assert.equal(st(4).status, 'unmet');   // $30M > $5M
  assert.ok(st(4).reasons.some(r => /Upgrade cost/.test(r)));
  assert.equal(st(5).status, 'unknown'); // not studied
  for (const e of ev) {
    const c = stepCostService(s.gridOf(e.node.bus_id), e.node.bus_id, 'solar', 200, 0);
    assert.equal(e.cost?.status, c.status, `bus ${e.node.bus_id}`);
  }
});

test('requirementChecks, evaluate and the funnel agree with the upgrade and curtailment screens on', () => {
  const s = study();
  attachCurtailment(s, CURT, { radiusKm: 25 });
  for (const r of [{ ...REQ, maxUpgradeMusd: 0 }, { ...REQ, maxUpgradeMusd: 5 }, { ...REQ, tech: 'storage', importMW: 200, maxUpgradeMusd: 50 },
    { ...REQ, maxCurtailPct: 5, curtailRun: 'pcr2030' }, { ...REQ, tech: 'wind', maxCurtailPct: 5, curtailRun: 'pcr2030' }, { ...REQ, tech: 'datacenter', importMW: 100, maxCurtailPct: 1 }]) {
    const ev = evaluate(s, r);
    for (const e of ev) {
      const c = requirementChecks(s, e.node, r);
      const st = c.some(x => x.status === 'excluded') ? 'excluded' : c.some(x => x.status === 'fail') ? 'unmet' : c.some(x => x.status === 'unknown') ? 'unknown' : 'met';
      assert.equal(st, e.status, `${e.node.bus_id} ${JSON.stringify(r)}`);
    }
    assert.equal(funnel(s, r).steps.at(-1).remain, ev.filter(e => e.status === 'met').length);
  }
});

test('no upgrade filter set: evaluate carries no cost and behaves as before', () => {
  const s = study(), ev = evaluate(s, REQ);
  assert.ok(ev.every(e => e.cost === undefined));
});

// ---------- curtailment screen (PCR runs) ----------
const cols = ['run', 'bidder', 'name', 'type', 'zone', 'state', 'lat', 'lon', 'econ_max_mw', 'pnode_bus', 'hours', 'mwh_offered', 'mwh_dispatched', 'mwh_curtailed', 'h_curtailed', 'h_curtailed_nonpos', 'max_identity_gap', 'n_negative_avail'];
const R = (run, id, type, zone, lat, lon, off, cur) => [run, id, `R${id}`, type, zone, 'ME', lat, lon, 50, null, 8712, off, off - cur, cur, 10, 5, 0, 0];
const CURT = { cols, runs: ['pcr2030', 'pcr2035'], rows: [
  R('pcr2030', 1, 'Solar', 'ME', 44.05, -70, 1000, 100),   // ~5.6 km from buses at (44,-70)
  R('pcr2030', 2, 'Solar', 'ME', 44.1, -70.05, 3000, 60),  // ~11.8 km
  R('pcr2030', 3, 'Solar', 'CT', 41.5, -72.5, 500, 0),     // at bus 2
  R('pcr2030', 4, 'Wind', 'ME', 45.5, -69, 2000, 200),     // far from everyone
  R('pcr2030', 5, 'OSW', 'SEMA', 41, -70.6, 9000, 0),
  R('pcr2035', 1, 'Solar', 'ME', 44.05, -70, 1000, 300),
] };

test('curtailFuel: solar and hybrid read solar, wind reads onshore wind, storage and data centres are not applicable', () => {
  assert.equal(curtailFuel('solar'), 'Solar'); assert.equal(curtailFuel('hybrid'), 'Solar'); assert.equal(curtailFuel('wind'), 'Wind');
  assert.equal(curtailFuel('storage'), null); assert.equal(curtailFuel('datacenter'), null);
});

test('nearbyCurtailment is energy-weighted over resources of the fuel within the radius; none within → not held', () => {
  const rows = curtailRows(CURT);
  const a = nearbyCurtailment(node(1), rows, 'pcr2030', 'Solar', 25);
  assert.equal(a.n, 2); assert.equal(a.mwhOffered, 4000); assert.equal(a.mwhCurtailed, 160);
  assert.ok(Math.abs(a.share - 0.04) < 1e-12);
  assert.ok(a.nearestKm > 5 && a.nearestKm < 6);
  assert.equal(nearbyCurtailment(node(1), rows, 'pcr2030', 'Wind', 25), null);
  assert.equal(nearbyCurtailment(node(1, { lat: null }), rows, 'pcr2030', 'Solar', 25), null);
  assert.equal(nearbyCurtailment(node(1), rows, 'pcr2030', 'Solar', 8).n, 1);
});

test('evaluate: curtailment screen passes, fails or is unknown; never applied to storage or data centres', () => {
  // P2 C54: a share from fewer than CURTAIL_MIN_SAMPLE.resources (3) is unknown. The old fixture screened bus 1 on 2
  // resources and bus 2 on 1 (the defect); bus 1 now has a third nearby resource in each run, bus 2 keeps its single one.
  const CURT3 = { ...CURT, rows: [...CURT.rows, R('pcr2030', 6, 'Solar', 'ME', 44.0, -70.1, 1000, 40), R('pcr2035', 7, 'Solar', 'ME', 44.1, -70.05, 1000, 300), R('pcr2035', 8, 'Solar', 'ME', 44.0, -70.1, 1000, 300)] };
  const s = study(); attachCurtailment(s, CURT3, { radiusKm: 25 });
  const ev = evaluate(s, { ...REQ, exportMW: 50, maxCurtailPct: 5, curtailRun: 'pcr2030' });
  assert.equal(ev.find(e => e.node.bus_id === 1).status, 'met');      // 3 resources, 200 / 5000 = 4.0% ≤ 5%
  assert.equal(ev.find(e => e.node.bus_id === 2).status, 'unknown');  // 0.0% from 1 resource: below the minimum sample
  const ev2 = evaluate(s, { ...REQ, exportMW: 50, maxCurtailPct: 3, curtailRun: 'pcr2030' });
  assert.equal(ev2.find(e => e.node.bus_id === 1).status, 'unmet');
  const ev35 = evaluate(s, { ...REQ, exportMW: 50, maxCurtailPct: 5, curtailRun: 'pcr2035' });
  assert.equal(ev35.find(e => e.node.bus_id === 1).status, 'unmet'); // 30% in pcr2035 (3 resources)
  assert.equal(ev35.find(e => e.node.bus_id === 2).status, 'unknown'); // no solar within 25 km in pcr2035
  const w = evaluate(s, { ...REQ, tech: 'wind', exportMW: 50, maxCurtailPct: 5, curtailRun: 'pcr2030' });
  assert.ok(w.filter(e => e.node.lat != null).every(e => e.status !== 'met')); // no wind within 25 km of any bus
  const st = evaluate(s, { tech: 'storage', exportMW: 0, importMW: 0, maxCurtailPct: 0.1, curtailRun: 'pcr2030' });
  assert.ok(st.every(e => !e.reasons.concat(e.unknown).some(x => /urtail/.test(x))));
});

test('zoneCurtailment: shares by zone and fuel sum back to the ISO total; offshore wind is kept apart', () => {
  const z = zoneCurtailment(curtailRows(CURT), 'pcr2030');
  const iso = z.find(x => x.zone === 'ISO' && x.type === 'Solar');
  assert.equal(iso.mwhOffered, 4500); assert.equal(iso.mwhCurtailed, 160);
  const parts = z.filter(x => x.zone !== 'ISO' && x.type === 'Solar');
  assert.equal(parts.reduce((t, x) => t + x.mwhCurtailed, 0), iso.mwhCurtailed);
  assert.ok(z.some(x => x.type === 'OSW'));
});

// ---------- Equal-weights preset ----------
test('weight presets: Studio profile = defaultWeights; Equal = the same criteria at one equal weight', () => {
  assert.deepEqual(Object.keys(WEIGHT_PRESETS), ['studio', 'equal']);
  for (const t of ['solar', 'wind', 'storage', 'hybrid', 'datacenter']) {
    assert.deepEqual(weightPreset(t, 'studio'), defaultWeights(t));
    const e = weightPreset(t, 'equal'), keys = Object.keys(defaultWeights(t));
    assert.deepEqual(Object.keys(e), keys);
    assert.equal(new Set(Object.values(e)).size, 1);
  }
  assert.deepEqual(weightPreset('solar', 'nonsense'), defaultWeights('solar'));
});

test('Equal preset ranks exactly as unit weights do (score is scale-free)', () => {
  const pool = [1, 2, 3, 4, 5].map(i => ({ status: 'met', margin: i * 10, node: node(i, { lmp_2025: 90 - i * 7, sc_mva: 1000 + ((i * 37) % 5) * 100 }) }));
  const keys = ['margin', 'price', 'strength'], eq = weightPreset('solar', 'equal');
  const w = Object.fromEntries(keys.map(k => [k, eq.margin]));
  const a = rank(pool, keys, w).scored, b = rank(pool, keys, { margin: 1, price: 1, strength: 1 }).scored;
  assert.deepEqual(a.map(x => x.node.bus_id), b.map(x => x.node.bus_id));
  a.forEach((x, i) => assert.ok(Math.abs(x.score - b[i].score) < 1e-9));
});
