// Shared map module: polyline decoding, projection, extent fitting, level of detail, scale bar, legend ramps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePolyline, makeProjection, fitExtent, pickLod, scaleBar, rampColor, geoMapSvg, setBasemap, milesBetween } from '../geomap.js';

const BM = JSON.parse(readFileSync(new URL('../data/basemap.json', import.meta.url)));

test('decodePolyline reproduces the Google polyline algorithm at 1/q degree', () => {
  // "_p~iF~ps|U_ulLnnqC_mqNvxq`@" is the canonical example at 1e5: (38.5,-120.2),(40.7,-120.95),(43.252,-126.453) as lat,lng.
  const d = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 1e5);
  assert.deepEqual(d.map(v => Math.round(v * 1000) / 1000), [38.5, -120.2, 40.7, -120.95, 43.252, -126.453]);
});

test('the basemap decodes to ISO-NE longitudes and latitudes (first value lon, second lat)', () => {
  const pts = decodePolyline(BM.lod[0].states[0], BM.q);
  for (let i = 0; i < pts.length; i += 2) { assert.ok(pts[i] > -85 && pts[i] < -59, `lon ${pts[i]}`); assert.ok(pts[i + 1] > 37 && pts[i + 1] < 51, `lat ${pts[i + 1]}`); }
});

test('projection is the live map\'s equirectangular one: x ∝ lon·cos(lat0), y ∝ −lat; distances are true at lat0', () => {
  const P = makeProjection({ lon0: -71, lat0: 42, lon1: -69, lat1: 44 }, 400, 400, 0.725374);
  const a = P(-71, 42), b = P(-70, 42), c = P(-71, 43);
  assert.ok(Math.abs((b[0] - a[0]) / (a[1] - c[1]) - 0.725374) < 1e-9, 'one degree of longitude is cos0 of a degree of latitude');
  assert.ok(c[1] < a[1], 'north is up');
});

test('fitExtent pads the points, never collapses to zero size, and keeps the aspect of the canvas', () => {
  const e = fitExtent([[-71, 42], [-71, 42]], { padMi: 10 }, 800, 400, 0.725374);
  assert.ok(e.lon1 > e.lon0 && e.lat1 > e.lat0);
  const wMi = milesBetween([e.lon0, e.lat0], [e.lon1, e.lat0]), hMi = milesBetween([e.lon0, e.lat0], [e.lon0, e.lat1]);
  assert.ok(Math.abs(wMi / hMi - 2) < 0.08, `aspect ${wMi / hMi}`);
});

test('pickLod: the ISO-wide view uses the coarse level; a local view (< 2° span) the fine level with counties', () => {
  assert.equal(pickLod(BM, { lon0: -74, lat0: 41, lon1: -67, lat1: 47.5 }), 0);
  assert.equal(pickLod(BM, { lon0: -71.2, lat0: 41.5, lon1: -70.2, lat1: 42.2 }), 1);
});

test('scaleBar picks a round distance near a fifth of the width', () => {
  const s = scaleBar({ lon0: -71, lat0: 42, lon1: -70, lat1: 43 }, 500, 0.725374);
  assert.ok([1, 2, 5, 10, 20, 25, 50, 100].includes(s.miles));
  assert.ok(s.px > 40 && s.px < 220);
});

test('rampColor is one hue light→dark; null stays the not-held colour', () => {
  assert.equal(rampColor(null, 0, 10), 'var(--gm-nh)');
  assert.notEqual(rampColor(0, 0, 10), rampColor(10, 0, 10));
  assert.equal(rampColor(-5, 0, 10), rampColor(0, 0, 10), 'clamped');
});

test('geoMapSvg draws the basemap under the layers, culls to the extent, and carries hover and actions', () => {
  setBasemap(BM);
  const svg = geoMapSvg({ id: 't', width: 600, height: 400, extent: { lon0: -71.4, lat0: 41.4, lon1: -69.8, lat1: 42.3 },
    layers: [{ kind: 'points', points: [{ lon: -70.5, lat: 41.65, r: 5, tip: 'Hatchville', act: 'map-bus', v: '111209', cls: 'm-met' }, { lon: -60, lat: 30, tip: 'far away' }] },
      { kind: 'lines', lines: [{ a: [-70.6, 41.6], b: [-70.4, 41.7], tip: 'line', cls: 'gm-lim' }] }] });
  assert.match(svg, /<svg[^>]*data-map="t"/);
  assert.match(svg, /class="gm-land"/); assert.match(svg, /class="gm-state"/);
  assert.ok(svg.indexOf('gm-land') < svg.indexOf('data-tip="Hatchville"'), 'basemap first');
  assert.match(svg, /data-act="map-bus" data-v="111209"/);
  assert.ok(!svg.includes('far away'), 'points outside the extent are culled');
  assert.match(svg, /class="gm-lim"/);
  assert.match(svg, /data-r="5"/);
});
