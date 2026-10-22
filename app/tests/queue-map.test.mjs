// Queue map on geoMap (views/queue-map.js): rings and request points by status, not-held coordinates never drawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { queueMapSpec } from '../views/queue-map.js';

const node = { latitude: 42, longitude: -71, name: 'Bus' };
const study = [
  { queue_position: 1, latitude: 42.05, longitude: -71, status: 'IA executed', max_mw: 100, resource_type: 'SUN', poi_name: 'A' },
  { queue_position: 2, latitude: 42.5, longitude: -71, status: 'Under initial study', max_mw: 50, resource_type: 'BAT', poi_name: 'B' },
  { queue_position: 3, latitude: null, longitude: null, status: 'IA executed', max_mw: 20, resource_type: 'SUN', poi_name: 'C' },
];
const reg = [{ qp: 9, lat: 42.01, lon: -71.01, status: 'W', mwReq: 30, poi: 'R', fuel: 'SUN', requested: '2020-01-01', tier: 'exact' }, { qp: 10, lat: null, lon: null, status: 'A' }];
const gens = [[1, 'G', 'Operating', 80, 42.02, -71.02], [2, 'H', 'Retired', 10, 42.02, -71.02]];
const STATUS = ['Under initial study', 'SIS documet posted', 'FAC in progress', 'IA in progress', 'IA executed'];

test('rings at 5, 10, 25 and the chosen radius; the map fits the largest ring', () => {
  const m = queueMapSpec({ node, study, register: reg, generators: gens, R: 50, statuses: STATUS });
  const rings = m.layers.find(l => l.kind === 'rings');
  assert.deepEqual(rings.miles, [5, 10, 25, 50]);
  assert.deepEqual(rings.center, [-71, 42]);
  assert.equal(m.padMi, 50 * 1.08);
});

test('points carry status classes; a request without a coordinate is counted, never drawn at 0,0', () => {
  const m = queueMapSpec({ node, study, register: reg, generators: gens, R: 10, statuses: STATUS });
  const pts = m.layers.filter(l => l.kind === 'points').flatMap(l => l.points);
  assert.ok(pts.every(p => Number.isFinite(p.lon) && Number.isFinite(p.lat) && !(p.lon === 0 && p.lat === 0)));
  assert.equal(m.notPlaced.study, 1); assert.equal(m.notPlaced.register, 1);
  assert.equal(pts.filter(p => p.cls === 'q-gen').length, 1, 'operating units only');
  assert.ok(pts.some(p => p.cls === 'q-st-5'), 'IA executed in the fifth status colour');
  assert.ok(pts.some(p => p.cls === 'q-reg-W'));
});

test('legend: at most six coloured categories plus neutral greys; counts within the radius', () => {
  const m = queueMapSpec({ node, study, register: reg, generators: gens, R: 10, statuses: STATUS });
  const coloured = m.legend.items.filter(i => /var\(--s\d\)/.test(i.fill || ''));
  assert.ok(coloured.length <= 6);
  const ia = m.legend.items.find(i => /IA executed/.test(i.label));
  assert.match(ia.label, /\(1 within 10 mi\)/);
});

test('the candidate bus is drawn and labelled last', () => {
  const m = queueMapSpec({ node, study, register: reg, generators: gens, R: 10, statuses: STATUS });
  const last = m.layers.at(-1).points[0];
  assert.equal(last.label, 'Bus'); assert.equal(last.lon, -71);
});
