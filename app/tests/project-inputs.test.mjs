// Project inputs panel (plan 14 §6a): pure render + change helper, lifted from pinned live src/app.js inspInputs (L1189 ff.), reading
// and writing the projects.js store (the samples' shape: tech/exportMW/importMW/assumptions.ui.*, p.stated/p.sources).
// Provenance: Claude Opus 5.5 (P2-inputs build agent; reworked onto the P1 store by X-fixups) · one-studio/design/14-lift-projects-configurator-continuum.md §6a · 2026-10-13 · sign-off pending · v2
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as P from '../projects.js';
import { render, fieldsFor, applyField, readEvent, savedText, BASIS_FIELDS, parseRaw } from '../views/project-inputs.js';

const R = JSON.parse(readFileSync(new URL('../rules/isone-2026/defaults.json', import.meta.url)));
const SAMPLE = JSON.parse(readFileSync(new URL('../data/samples.json', import.meta.url))).projects[0];
const SIZES = [100, 250, 500, 1000]; // live GS.SIZES, passed in by the integrator from the shim, never owned here
const NOW = Date.UTC(2026, 9, 13);
const mk = (o = {}) => P.newProject({ name: 'Husky <Solar>', tech: 'solar', exportMW: 100, cod: 2029, service: 'ERIS', landStatus: 'optioned', bus: { busId: '111209', busName: 'Hatchville', lat: 41.6, lon: -70.5 }, ...o }, { rules: R, now: NOW }).project;
const keys = p => fieldsFor(p).map(f => f.k);
const seg = (html, k) => html.slice(html.indexOf(`data-k="${k}"`)).slice(0, 900);

test('fields follow the tech, as live: DC nameplate for solar/hybrid, duration for storage/hybrid, import MW for storage/hybrid/DC', () => {
  const s = keys(mk());
  for (const k of ['name', 'tech', 'exportMW', 'dcMW', 'cod', 'service', 'landStatus', 'profile', 'notes', 'siteLat', 'siteLon', 'control', 'route', 'capex', 'annualOM', 'solarCF', 'discountRate', 'years']) assert.ok(s.includes(k), k);
  assert.ok(!s.includes('duration') && !s.includes('importMW') && !s.includes('rte') && !s.includes('windCF'));
  const b = keys(mk({ tech: 'storage', importMW: 100 }));
  assert.ok(b.includes('duration') && b.includes('importMW') && b.includes('rte') && !b.includes('dcMW') && !b.includes('solarCF'));
  const h = keys(mk({ tech: 'hybrid', importMW: 50 }));
  assert.ok(h.includes('dcMW') && h.includes('duration') && h.includes('importMW'));
  const d = keys(mk({ tech: 'datacenter', exportMW: undefined, importMW: 300 }));
  assert.ok(d.includes('importMW') && !d.includes('exportMW'));
  for (const k of keys(mk({ tech: 'storage', importMW: 100 }))) assert.ok(k in P.FIELDS, `${k} is a projects.js field`);
});

test('header shows "N of M stated" from projects.js statedCount, level badge PROJECT on every field, escaped, scoped root', () => {
  const p = mk(), html = render(p, { sizes: SIZES }), sc = P.statedCount(p);
  assert.equal(sc.total, 8, 'live stated set for solar: name, asset, size, COD, service, land, profile + DC nameplate');
  assert.ok(html.includes(`${sc.stated} of ${sc.total} stated`));
  assert.equal((html.match(/class="pi-lvl">PROJECT</g) || []).length, fieldsFor(p).length);
  assert.ok(html.includes('class="gsx-pi'));
  assert.ok(html.includes('Husky &lt;Solar&gt;') && !html.includes('<Solar>'));
});

test('stated/default marker from the store: a rules default shows its source and value as the placeholder; no default reads not held, never 0', () => {
  const p = mk(), html = render(p, { sizes: SIZES });
  assert.match(seg(html, 'exportMW'), /pi-src stated/);
  assert.match(seg(html, 'capex'), /pi-src default/);
  assert.match(seg(html, 'capex'), /NREL ATB 2025/);
  assert.match(seg(html, 'capex'), /value="" placeholder="default 140,524,000"/, 'ATB $/kWac × export kW, as projects.js derived it');
  assert.match(seg(html, 'siteLat'), /bus coordinate \(Hatchville · 111209\)/); // fix-4: the option's bus, named with its id
  const dc = render(mk({ tech: 'datacenter', exportMW: undefined, importMW: 300 }), {});
  assert.match(seg(dc, 'capex'), /pi-src nh"[^>]*>not held/);
  assert.match(seg(dc, 'capex'), /placeholder="not held"/);
  assert.match(seg(html, 'dcMW'), /pi-src nh"[^>]*>not held/);
});

test('size help line: exact published size vs nearest published size; per-tech unit', () => {
  assert.match(render(mk(), { sizes: SIZES }), /Exact: 100 MW is a published study size\./);
  assert.match(render(mk({ exportMW: 180 }), { sizes: SIZES }), /Curtailment is read at the nearest published size \(250 MW\)/);
  assert.match(render(mk(), {}), /Published study sizes not held\./);
  assert.match(seg(render(mk(), {}), 'exportMW'), /class="pi-u">MWac</);
  assert.match(seg(render(mk({ tech: 'wind' }), {}), 'exportMW'), /class="pi-u">MW</);
});

test('implied DC:AC from dcMW / exportMW, "not held" when no DC nameplate', () => {
  assert.match(render(mk({ dcMW: 130 }), {}), /Implied DC:AC 1\.30/);
  assert.match(render(mk(), {}), /Implied DC:AC not held/);
});

test('selects: tech labels as live, service ERIS / NRIS / CNRIS / energy-only / firm load, land and profile as live; unstated select reads not stated', () => {
  const html = render(mk(), {});
  for (const v of ['energy-only', 'ERIS', 'NRIS', 'CNRIS', 'firm load', 'prospecting', 'under option', 'optioned', 'owned', 'hourly 8760', 'flat 24x7']) assert.ok(html.includes(`value="${v}"`), v);
  assert.match(html, /<option value="ERIS" selected>/);
  assert.match(html, /<option value="storage">BESS</);
  assert.match(seg(html, 'profile'), /<option value="" selected>not stated</);
});

test('rejected value: applyField returns the projects.js reason and applies nothing; render shows the reason under the field', () => {
  const p = mk(), before = JSON.stringify(p);
  for (const [k, raw] of [['exportMW', '20000'], ['exportMW', '0'], ['cod', '2020'], ['name', '  '], ['exportMW', 'abc'], ['siteLat', '30']]) {
    const r = applyField(p, k, raw, { rules: R });
    assert.equal(r.ok, false, `${k}=${raw}`); assert.ok(r.why && r.why.length > 5, r.why);
  }
  assert.match(applyField(p, 'cod', '2020').why, /The update was not applied\./);
  assert.equal(JSON.stringify(p), before, 'project untouched');
  const html = render(p, { errors: { exportMW: 'Export size must be > 0 and ≤ 10,000 MW, not 20000. The update was not applied.' } });
  assert.match(seg(html, 'exportMW'), /class="pi-err" role="alert">Export size must be &gt; 0/);
  assert.match(seg(html, 'exportMW'), /value="100"/, 'shows the held value, not the rejected one');
});

test('accepted value: the new project from projects.js setField, old/new, basis flag; % shown, fraction stored; cleared = back to the default', () => {
  const p = mk(), r = applyField(p, 'exportMW', '250', { rules: R });
  assert.deepEqual([r.ok, r.k, r.old, r.value, r.basis], [true, 'exportMW', 100, 250, true]);
  assert.equal(r.project.exportMW, 250); assert.equal(p.exportMW, 100, 'input never mutated');
  assert.equal(r.project.assumptions.ui.fin.capex, R.defaults_atb2025.pv_tracking.capex_per_kwac * (250 * 1000), 'rules default follows the size');
  assert.equal(applyField(p, 'notes', 'hi').basis, false);
  assert.equal(parseRaw('discountRate', '7.5'), 0.075);
  assert.equal(parseRaw('capex', ''), null);
  assert.ok(Number.isNaN(parseRaw('exportMW', 'abc')));
  const d = applyField(p, 'discountRate', '9', { rules: R });
  assert.equal(d.project.assumptions.ui.fin.discountRate, 0.09); assert.equal(d.project.stated.discountRate, 'stated');
  assert.match(seg(render(d.project, {}), 'discountRate'), /value="9"/);
  const back = applyField(d.project, 'discountRate', '', { rules: R });
  assert.equal(back.project.assumptions.ui.fin.discountRate, R.defaults_atb2025.finance.wacc_nominal); assert.equal(back.project.stated.discountRate, 'default');
  const st = applyField(p, 'service', 'CNRIS', { rules: R });
  assert.equal(st.project.assumptions.ui.qService, 'CNRIS');
  assert.equal(savedText('exportMW', 100, 250, 3), 'Saved: Export size 100 → 250; 3 saved findings now stale.');
  assert.equal(savedText('notes', '', 'x', 0), 'Saved: Notes not held → x.');
  assert.equal(savedText('dcMW', null, 300, 1), 'Saved: DC nameplate not held → 300; 1 saved finding now stale.', 'null reads not held (fix-2)');
  assert.equal(savedText('discountRate', 0.08, 0.1, 0), 'Saved: Discount rate 8% → 10%.', 'shown at the panel scale (fix-2)');
  assert.equal(BASIS_FIELDS, P.BASIS_FIELDS, 'one BASIS_FIELDS (projects.js)');
});

test('tech change to data centre with no import size: applied, the panel shows the reason and "incomplete" until it is set (fix-1)', () => {
  const r = applyField(mk({ exportMW: 150 }), 'tech', 'datacenter', { rules: R });
  assert.equal(r.ok, true); assert.match(r.incomplete.importMW, /Import \/ charge size is not held for datacenter: set it now/);
  const html = render(r.project, {});
  assert.match(html, /class="pi-cnt[^"]*"[^>]*>[^<]*incomplete/); assert.match(seg(html, 'importMW'), /pi-err[^>]*>Import \/ charge size is not held for datacenter: set it now/);
  const ok = applyField(r.project, 'importMW', '150', { rules: R });
  assert.deepEqual(ok.incomplete, {}); assert.doesNotMatch(render(ok.project, {}), /incomplete/);
});

test('an edit to the same value is not a change: basis false-free, nothing goes stale (fix-2)', () => {
  const p = P.newProject({ name: 'Bess A', tech: 'storage', exportMW: 100, importMW: 100, cod: 2029 }, { rules: R, now: NOW }).project;
  const r = applyField(p, 'duration', '4', { rules: R }); assert.equal(r.ok, true); assert.equal(r.old, 4); assert.equal(r.value, 4);
  assert.equal(r.changed, false); assert.equal(P.markStale([{ id: 's1' }], r.k, r.old, r.value).n, 0);
  assert.equal(applyField(p, 'duration', '6', { rules: R }).changed, true);
});

test('stale marking runs through projects.js markStale with the panel result', () => {
  const r = applyField(mk(), 'exportMW', '250', { rules: R }), m = P.markStale([{ id: 'f1' }, { id: 'f2', stale: true }], r.k, r.old, r.value);
  assert.equal(m.n, 1); assert.equal(m.records[0].staleReason, 'Export size 100 → 250');
});

test('read-only: a Dummy sample (not p.user) disables every control, offers Duplicate, applyField refuses', () => {
  const html = render(SAMPLE, {});
  assert.match(html, /data-act="proj-dup"/); assert.match(html, /Duplicate as my project/);
  assert.ok(!/<(input|select|textarea)(?![^>]*disabled)[^>]*data-act="proj-field"/.test(html), 'all controls disabled');
  assert.match(html, /Dummy sample/);
  assert.equal(applyField(SAMPLE, 'exportMW', '250').ok, false);
  assert.equal(applyField(mk(), 'exportMW', '250', { readOnly: true }).ok, false);
  assert.ok(!render(mk(), {}).includes('data-act="proj-dup"'));
});

test('readEvent reads data-act / data-k / value from a control', () => {
  assert.deepEqual(readEvent({ dataset: { act: 'proj-field', k: 'cod' }, value: '2031' }), { act: 'proj-field', k: 'cod', raw: '2031' });
  assert.deepEqual(readEvent({ dataset: { act: 'proj-dup' } }), { act: 'proj-dup', k: null, raw: null });
  assert.equal(readEvent({ dataset: {} }), null);
});

test('no project → empty state, as live', () => {
  assert.match(render(null), /Open a project/);
});

// fix-4 (store): the panel shows the site the dashboards read — the CURRENT option's bus while the site is a default.
test('site lat/lon default shows the current option\'s bus coordinate (option passed in); a stated site shows as stated', () => {
  let p = mk(); p = P.addOption(p, { busId: '111403', busName: 'Other', lat: 41.62, lon: -70.47 }).project;
  const h2 = render(p, { option: 'o2' }); assert.match(seg(h2, 'siteLat'), /default 41\.62/); assert.match(seg(h2, 'siteLat'), /bus coordinate \(Other/);
  const h1 = render(p, { option: 'o1' }); assert.match(seg(h1, 'siteLat'), /default 41\.6"/); assert.match(seg(h1, 'siteLat'), /Hatchville/);
  p = P.addOption(p, { busId: '111500', busName: 'Third' }).project;
  const h3 = render(p, { option: 'o3' }); assert.match(seg(h3, 'siteLat'), /not held/); assert.doesNotMatch(seg(h3, 'siteLat'), /41\.6/);
  p = P.setField(p, 'siteLat', 42, { rules: R }).project; p = P.setField(p, 'siteLon', -71, { rules: R }).project;
  const hs = render(p, { option: 'o2' }); assert.match(seg(hs, 'siteLat'), /pi-src stated/); assert.match(seg(hs, 'siteLat'), /value="42"/);
});
test('a size marked does-not-apply never shows as stated, and a tech change to hybrid shows the charge size not held', () => {
  const p = applyField(mk(), 'tech', 'hybrid', { rules: R }).project, s = seg(render(p), 'importMW');
  assert.match(s, /not held/); assert.doesNotMatch(s, /pi-src stated/); assert.doesNotMatch(s, /value="0"/);
});
