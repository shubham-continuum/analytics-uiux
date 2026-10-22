import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { footprint, screen, fit, landRate, corridor, siteControl, discAcres } from '../landcore.js';

const L = JSON.parse(readFileSync(new URL('../data/land.json', import.meta.url)));
const snap = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
const node = id => snap.nodes.find(n => n.id === id);

test('solar 100 MW needs 560 acres (base 5.6 ac/MW) — matches pack worked example', () => {
  assert.equal(footprint(L.intensity, 'solar', 100).base, 560);
});

test('Mashpee screen: largest clear block 11,913.1 acres of a 3-mile disc', () => {
  const s = screen(L.exclusions, 111403);
  assert.equal(s.clear, 11913.1);
  assert.equal(s.radiusMi, 3);
});

test('no exclusion screen gives unknown fit, never a pass', () => {
  assert.equal(fit(footprint(L.intensity, 'solar', 100), screen(L.exclusions, 114417)).status, 'unknown');
});

test('county land cost is a flagged assumption', () => {
  const r = landRate(L.landCost, node('111403'));
  assert.equal(r.provenance, 'assumption');
});

test('no site location means distance not held, never zero', () => {
  const c = corridor({ lat: null, lon: null }, node('111403'), {});
  assert.equal(c.status, 'not held');
  assert.equal(c.distance, null);
});

test('missing terminal cost makes the corridor cost a lower bound', () => {
  const c = corridor({ lat: 41.66, lon: -70.47 }, node('111403'), { routeFactor: 1.2, perMile: 2e6 });
  assert.equal(c.status, 'partly priced');
  assert.ok(c.cost > 0);
});

test('blank crossings keep the corridor partly priced even with terminal works entered', () => {
  const site = { lat: 41.66, lon: -70.47 }, n = node('111403');
  const c = corridor(site, n, { routeFactor: 1.2, perMile: 2e6, terminal: 5e6 });
  assert.equal(c.status, 'partly priced');
  assert.match(c.reason, /[Cc]rossings/);
  const p = corridor(site, n, { routeFactor: 1.2, perMile: 2e6, terminal: 5e6, crossings: 0 });
  assert.equal(p.status, 'priced');
  assert.equal(p.reason, '');
});

test('routing factor below 1 is rejected: route not held, error stated, cost a lower bound', () => {
  const c = corridor({ lat: 41.66, lon: -70.47 }, node('111403'), { routeFactor: 0.8, perMile: 2e6, terminal: 5e6, crossings: 1e6 });
  assert.equal(c.route, null);
  assert.match(c.routeError, /below 1/);
  assert.equal(c.status, 'partly priced');
  assert.ok(c.distance > 0);
});

test('site control is not applicable to a data centre (load), a gated percentage elsewhere', () => {
  assert.equal(siteControl('datacenter', 50).applicable, false);
  assert.match(siteControl('datacenter', null).status, /not applicable \(generator site-control rule\)/);
  // W-B (S3 #3): the old assertion read 95% as "Meets the request threshold (90%)"; that is the FERC pro forma, not
  // ISO-NE (100% at request, Sched 22 §3.4; R1 S-1). The pro forma figure is still available under its labelled profile.
  assert.match(siteControl('solar', 95).status, /^Fail: 95% < 100%/);
  assert.match(siteControl('solar', 95, { profile: 'proforma' }).status, /^Pass: 95% meets 90%/);
  assert.equal(siteControl('solar', null).status, 'unknown');
});

test('fit carries the habitat/protected-only caveat when water is not screened', () => {
  const f = fit(footprint(L.intensity, 'solar', 100), screen(L.exclusions, 111403));
  assert.equal(f.status, 'fits');
  assert.equal(f.screenOnly, true);
  assert.match(f.caveat, /water/);
});

test('disc acres = π·r²·640 within 0.1% on every held screen', () => {
  assert.ok(Math.abs(discAcres(1) - Math.PI * 640) < 1e-9);
  assert.equal(discAcres(null), null);
  for (const [bus, e] of Object.entries(L.exclusions)) assert.ok(Math.abs(e.disc_acres / discAcres(e.radius_mi) - 1) <= 0.001, bus);
});
