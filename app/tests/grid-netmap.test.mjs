// Network-around-the-bus map model (views/grid-netmap.js): settled grid rules applied to the map layers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { facilityRows, netMapModel, netAnswer } from '../views/grid-netmap.js';

const row = (o = {}) => ({ scenario: 'summer_peak', direction: 'discharge', monitored_facility: 'F1', key: '1-2-1', a: 1, b: 2, a_name: 'A', b_name: 'B', ckt: '1',
  binding_contingency: 'LN_1', contingency_id: 5, kv: 115, dfax: 0.3, transfer_mw: 150, base_flow_mw: 80, contingency_flow_mw: 190, rating_a_mva: 200, rating_c_mva: 240,
  pct_loading_no_transfer: 79, facility_type: 'Transmission Line', ...o });
const payload = (rows, extra = {}) => ({
  bus: { bus_id: 9, bus_name: 'Bus', lon: -70, lat: 42 }, radius_mi: 15,
  branches: [{ key: '1-2-1', name: 'A to B', kv: 115, status: 'Closed', a: [-70, 42], b: [-70.1, 42.1], rate_a: 200, from_name: 'A', to_name: 'B' },
    { key: '3-4-1', name: 'C to D', kv: 345, status: 'Closed', a: [-70, 42], b: [-69.9, 42.05], from_name: 'C', to_name: 'D' }],
  substations: [], rows,
  facility_geo: { '1-2-1': { a: [-70, 42], b: [-70.1, 42.1], in_net: true }, '5-6-1': { a: [-70.2, 42], b: null, in_net: false }, '7-8-1': { a: [-70.3, 42], b: [-70.2, 41.9], in_net: false } },
  not_drawn: { branches_near: 2, branches_unplaceable: 6 }, ...extra,
});

test('rating basis: base case (contingency_id 0) uses rate A on the base flow; contingencies use rate C', () => {
  const [b] = facilityRows([row({ contingency_id: 0, contingency_flow_mw: null })], 'solar');
  assert.equal(b.rate, 'A'); assert.equal(b.rating, 200);
  const [c] = facilityRows([row()], 'solar');
  assert.equal(c.rate, 'C'); assert.equal(c.rating, 240);
});

test('pre-existing means |loading| >= 100, counter-flow included; 99.9 is not', () => {
  const r = facilityRows([row({ pct_loading_no_transfer: 100 }), row({ pct_loading_no_transfer: -104 }), row({ pct_loading_no_transfer: 99.9 }), row({ pct_loading_no_transfer: null })], 'solar');
  assert.deepEqual(r.map(x => x.pre), [true, true, false, false]);
});

test('cases by service: shoulder export never (store mislabel); storage charge only at shoulder; a data centre unions large load and summer-peak charge', () => {
  const rows = [row(), row({ scenario: 'shoulder', direction: 'discharge' }), row({ scenario: 'summer_peak', direction: 'charge' }), row({ scenario: 'large_load', direction: 'charge' }), row({ scenario: 'shoulder', direction: 'charge' })];
  assert.deepEqual(facilityRows(rows, 'solar').map(r => r.case), ['summer_peak|discharge']);
  assert.deepEqual(facilityRows(rows, 'storage').map(r => r.case), ['summer_peak|discharge', 'shoulder|charge']);
  assert.deepEqual(facilityRows(rows, 'datacenter').map(r => r.case).sort(), ['large_load|charge', 'summer_peak|charge']);
});

test('"no violations" rows and unparsed facilities are not drawn as facilities', () => {
  assert.equal(facilityRows([row({ monitored_facility: 'No violations found', key: null })], 'solar').length, 0);
});

test('layers: network lines, limiting facilities over them, pre-existing dashed; a facility end without a coordinate is counted, never placed at 0,0', () => {
  const m = netMapModel(payload([row(), row({ key: '5-6-1', a: 5, b: 6, monitored_facility: 'F2' }), row({ key: '7-8-1', a: 7, b: 8, monitored_facility: 'F3', pct_loading_no_transfer: 112, transfer_mw: -20 })]), { tech: 'solar' });
  assert.equal(m.net.length, 1, 'the limiting branch is not drawn twice');
  assert.ok(m.net.every(l => l.cls === 'gm-net'));
  assert.deepEqual(m.fac.map(l => l.cls), ['gm-lim', 'gm-pre']);
  assert.equal(m.counts.facNotDrawn, 1);
  assert.equal(m.counts.lim, 2, 'a limiting facility that cannot be drawn still counts'); assert.equal(m.counts.pre, 1);
  assert.equal(m.counts.branchNotDrawn, 2);
  for (const l of [...m.net, ...m.fac]) for (const p of [l.a, l.b]) assert.ok(p && !(p[0] === 0 && p[1] === 0));
  assert.match(m.fac[0].tip, /115 kV/); assert.match(m.fac[0].tip, /rate C 240 MVA/); assert.match(m.fac[0].tip, /DFAX 0\.300/); assert.match(m.fac[0].tip, /Summer peak · export/);
});

test('a facility limiting in one row and pre-existing in another is drawn as limiting (the table row governs)', () => {
  const m = netMapModel(payload([row(), row({ binding_contingency: 'LN_2', pct_loading_no_transfer: 101 })]), { tech: 'solar' });
  assert.equal(m.fac[0].cls, 'gm-lim');
  assert.equal(m.facilities[0].preRows, 1);
});

test('selecting a facility highlights its line', () => {
  const m = netMapModel(payload([row()]), { tech: 'solar', sel: '1-2-1' });
  assert.match(m.fac[0].cls, /gm-sel/);
  assert.equal(m.selected.key, '1-2-1');
  assert.equal(netMapModel(payload([row()]), { tech: 'solar', sel: 'x' }).selected, null);
});

test('answer sentence: computed counts; no facilities says so', () => {
  const m = netMapModel(payload([row()]), { tech: 'solar' });
  const s = netAnswer(m);
  assert.match(s, /<b>2<\/b> branches/); assert.match(s, /<b>1<\/b> limiting/); assert.match(s, /150\.0 MW/);
  const e = netAnswer(netMapModel(payload([]), { tech: 'solar' }));
  assert.match(e, /no limiting facility/i);
});
