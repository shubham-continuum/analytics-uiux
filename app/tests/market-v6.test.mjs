// Market v6 unit tests (no server): "Requirements at bus" rows for the percentile strip and the k-of-n answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, evaluate, requirementChecks, requirementStrip } from '../marketcore.js';
import { percentileRow } from '../charts.js';

const el = (bus, scenario, direction, transfer, extra = {}) => ({ bus_id: bus, scenario, direction, monitored_facility: `F${bus}${scenario}${transfer}`, binding_contingency: 'C1', contingency_id: 7, dfax: 0.2, transfer_mw: transfer, base_flow_mw: 50, contingency_flow_mw: 60, rating_a_mva: 100, rating_c_mva: 120, pct_loading_no_transfer: 50, fix_cost_musd: 4, length_miles: 1, facility_type: 'line', ...extra });
const node = (id, o = {}) => ({ bus_id: id, name: `Bus ${id}`, zone: 'ME', kv: 115, lat: 44, lon: -70, tier: 'direct', proxyKm: null, lmp_2025: 60, lmp_2030: 45, sc_mva: 2000, ...o });
function study() {
  return prepare({
    nodes: [node(1), node(2, { zone: 'CT', kv: 345, lmp_2025: 40 }), node(3, { kv: null, sc_mva: null, lmp_2025: null }), node(4, { zone: 'CT', kv: 69 }), node(5)],
    grid: {
      headroom: [1, 2, 3, 4].map(b => ({ bus_id: b, scenario: 'shoulder', direction: 'discharge', headroom_mw: 1000 })),
      constraints: [el(1, 'summer_peak', 'discharge', 300), el(2, 'summer_peak', 'discharge', 120), el(3, 'summer_peak', 'discharge', 600), el(4, 'summer_peak', 'discharge', 900)],
    },
  });
}
const REQ = { tech: 'solar', exportMW: 200, importMW: 0, zones: null, minKv: 115, useShoulder: true, maxPrice2025: 55, minPrice2025: null };
const at = (ev, id) => ev.find(e => e.node.bus_id === id);

test('requirementStrip: one row per numeric requirement with its reference and direction; the k-of-n count equals requirementChecks', () => {
  const s = study(), ev = evaluate(s, REQ);
  for (const id of [1, 2, 3, 4, 5]) {
    const e = at(ev, id), st = requirementStrip(s, ev, e, REQ), ch = requirementChecks(s, e.node, REQ);
    assert.equal(st.n, ch.length, `bus ${id}: n = requirement count`);
    assert.equal(st.met, ch.filter(c => c.status === 'pass').length, `bus ${id}: met = passing requirements`);
    assert.equal(st.unknown, ch.filter(c => c.status === 'unknown').length, `bus ${id}: unknown counted, never met`);
    // every requirement row on the strip reads the same verdict as the check (no upgrade ceiling here)
    for (const r of st.rows.filter(x => x.req)) {
      const c = ch.find(x => x.key === r.req), v = percentileRow(r.value, r.pop, r.ref, r.dir).status;
      assert.equal(v, { pass: 'met', fail: 'not met', unknown: 'unknown' }[c.status], `bus ${id} ${r.label}`);
    }
  }
});

test('requirementStrip: headroom rows by case carry the request as the reference; kV and 2025 price use the form values', () => {
  const s = study(), ev = evaluate(s, REQ), st = requirementStrip(s, ev, at(ev, 1), REQ);
  const sp = st.rows.find(r => r.req === 'summer_peak|discharge');
  assert.equal(sp.value, 300); assert.equal(sp.ref, 200); assert.equal(sp.dir, 'ge'); assert.equal(sp.unit, 'MW');
  const kv = st.rows.find(r => r.req === 'kv'); assert.equal(kv.ref, 115); assert.equal(kv.dir, 'ge');
  const pr = st.rows.find(r => r.req === 'maxPrice'); assert.equal(pr.ref, 55); assert.equal(pr.dir, 'le'); assert.equal(pr.value, 60);
  // population = every bus, nulls kept out by the strip (not drawn as zero)
  assert.equal(kv.pop.length, 5); assert.ok(kv.pop.includes(null));
});

test('requirementStrip: context rows (2030 price, SC MVA, pre-existing, fuel measures) have no reference and never count', () => {
  const s = study(), ev = evaluate(s, REQ), st = requirementStrip(s, ev, at(ev, 1), REQ);
  const ctx = st.rows.filter(r => !r.req);
  assert.ok(ctx.length >= 3);
  for (const r of ctx) { assert.equal(r.ref, null); assert.equal(percentileRow(r.value, r.pop, r.ref, r.dir).status === 'met', false); }
  assert.ok(ctx.some(r => /2030/.test(r.label)) && ctx.some(r => /short-circuit/i.test(r.label)) && ctx.some(r => /pre-existing/i.test(r.label)));
});

test('requirementStrip: storage shows TB4, a data centre shows volatility, solar shows the solar-window price ratio', () => {
  const s = study();
  const lab = tech => { const r = { ...REQ, tech, importMW: tech === 'datacenter' ? 100 : 0 }; const ev = evaluate(s, r); return requirementStrip(s, ev, at(ev, 1), r).rows.map(x => x.label).join(' | '); };
  assert.match(lab('storage'), /TB4/); assert.doesNotMatch(lab('storage'), /Solar-window price ratio/);
  assert.match(lab('datacenter'), /volatility/i); assert.doesNotMatch(lab('datacenter'), /TB4/);
  assert.match(lab('solar'), /Solar-window price ratio/); assert.doesNotMatch(lab('solar'), /Solar-hour/); // P2 C26: the retired name
});

test('requirementStrip: a missing value is unknown, never met; a bus outside the zones is excluded', () => {
  const s = study(), ev = evaluate(s, REQ), st = requirementStrip(s, ev, at(ev, 3), REQ);
  assert.equal(st.rows.find(r => r.req === 'kv').value, null);
  assert.ok(st.unknown >= 1); assert.ok(st.met < st.n);
  const r2 = { ...REQ, zones: ['CT'] }, ev2 = evaluate(s, r2), x = requirementStrip(s, ev2, at(ev2, 1), r2);
  assert.equal(x.excluded, true); assert.equal(x.met, 0);
});
