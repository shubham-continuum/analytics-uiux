// Land v6 unit tests: the site-map frame on the shared geoMap projection. The app's click handler reads
// data-lon0 / data-lat0 / data-span / data-lspan and maps a click fraction (fx, fy) linearly; on the geoMap
// projection (equirectangular, extent widened to the canvas aspect) that inversion must be exact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { siteMapFrame, siteFromFraction } from '../landcore.js';
import { makeProjection } from '../geomap.js';

const near = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, `${a} vs ${b}`);
const bus = { latitude: 41.6, longitude: -70.5 };

test('siteMapFrame: the extent holds the bus, the site and the outer ring, at the canvas aspect', () => {
  const f = siteMapFrame(bus, { lat: 41.7, lon: -70.3 }, { W: 640, H: 420, rings: [3, 6, 9] });
  const e = f.extent;
  assert.ok(e.lon0 < -70.5 && e.lon1 > -70.3 && e.lat0 < 41.6 && e.lat1 > 41.7);
  // the 9-mile ring fits: at least 9 mi of latitude either side of the bus
  assert.ok(41.6 - e.lat0 >= 9 / 69 - 1e-9 && e.lat1 - 41.6 >= 9 / 69 - 1e-9);
  const wU = (e.lon1 - e.lon0) * f.cos0, hU = e.lat1 - e.lat0;
  near(wU / hU, 640 / 420, 1e-9);
});

test('siteMapFrame attributes invert the projection exactly (click fraction → lon/lat)', () => {
  const f = siteMapFrame(bus, { lat: null, lon: null }, { W: 640, H: 420, rings: [3, 6, 9] });
  const P = makeProjection(f.extent, 640, 420, f.cos0);
  for (const [lon, lat] of [[-70.5, 41.6], [-70.42, 41.65], [-70.61, 41.52]]) {
    const [x, y] = P(lon, lat), s = siteFromFraction(f.attrs, x / 640, y / 420);
    near(s.lon, lon, 1e-5); near(s.lat, lat, 1e-5);
  }
  assert.deepEqual(Object.keys(f.attrs).sort(), ['lat0', 'lon0', 'lspan', 'span']);
});

test('siteMapFrame: no bus coordinate → null (the map says so; nothing is placed at 0,0)', () => {
  assert.equal(siteMapFrame({ latitude: null, longitude: -70 }, {}, { W: 640, H: 420 }), null);
});
