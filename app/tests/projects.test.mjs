// L1 user-project store (projects.js): the samples' shape, live inspInputs validation, labelled defaults, markStale, live import.
// Provenance: Claude Opus 5.5 (P1-store builder) · one-studio/design/14-lift-projects-configurator-continuum.md §6/§6a · 2026-10-13 · sign-off pending · v1
// Live references (pinned app-tools/live-snapshot/2026-10-11/src/app.js): newProject/addOption L990-995, inspInputs RULES L1193
// (size > 0 and ≤ 10,000 MW; MWdc ≤ 20,000; duration 0.5-12 h; COD 2026-2050; name required), BASIS_FIELDS/markStale L1210-1211.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../projects.js';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = JSON.parse(readFileSync(path.join(APP, 'rules/isone-2026/defaults.json'), 'utf8'));
const SAMPLES = JSON.parse(readFileSync(path.join(APP, 'data/samples.json'), 'utf8')).projects;
const A = R.defaults_atb2025;
const NOW = Date.UTC(2026, 9, 13);
const mk = (o = {}) => P.newProject({ name: 'Test Solar', tech: 'solar', exportMW: 100, cod: 2029, bus: { busId: '111209', busName: 'Hatchville', lat: 41.6, lon: -70.5 }, ...o }, { rules: R, now: NOW });
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };

test('new project has the samples\' shape (top-level keys, option keys, assumptions.ui groups)', () => {
  const r = mk(); assert.equal(r.ok, true, JSON.stringify(r.errors));
  const p = r.project, s = SAMPLES[0];
  for (const k of ['id', 'name', 'client_type', 'tech', 'exportMW', 'importMW', 'options', 'assumptions']) assert.ok(k in p, `missing ${k}`);
  assert.equal(typeof p.notes, 'string'); assert.equal(p.user, true);
  for (const g of ['econ', 'fin', 'land']) assert.equal(typeof p.assumptions.ui[g], 'object');
  assert.ok('qCod' in p.assumptions.ui && 'qService' in p.assumptions.ui);
  assert.deepEqual(Object.keys(p.options[0]).sort(), ['busId', 'busLat', 'busLon', 'busName', 'id', 'label', 'note', 'status']);
  assert.equal(p.options[0].busLat, 41.6); assert.equal(p.options[0].busLon, -70.5);
  for (const k of Object.keys(s.options[0]).filter(k => k !== 'tier')) assert.ok(k in p.options[0], `option key ${k}`);
  assert.equal(p.options[0].busId, '111209'); assert.equal(p.options[0].status, 'Exploring');
  assert.equal(p.assumptions.ui.fin.cod, 2029); assert.equal(p.assumptions.ui.qCod, 2029);
  assert.equal(p.importMW, 0, 'solar requests no import: a true zero, as the samples');
});

test('validation = live inspInputs RULES, with the live reason text; rejected values are not applied', () => {
  const p = mk().project;
  assert.equal(P.validateField('exportMW', 0, p), 'Export size must be > 0 and ≤ 10,000 MW, not 0. The update was not applied.');
  assert.match(P.validateField('exportMW', 10001, p), /≤ 10,000 MW/);
  assert.equal(P.validateField('exportMW', 10000, p), null);
  assert.equal(P.validateField('importMW', 0, p), null, 'solar import 0 is allowed');
  assert.match(P.validateField('dcMW', 20001, p), /must be > 0 and ≤ 20,000 MWdc/);
  assert.equal(P.validateField('dcMW', 20000, p), null);
  assert.match(P.validateField('duration', 0.4, p), /must be between 0.5 and 12 hours/);
  assert.equal(P.validateField('duration', 12, p), null);
  assert.match(P.validateField('cod', 2025, p), /must be a year between 2026 and 2050/);
  assert.match(P.validateField('cod', 2051, p), /2050/); assert.equal(P.validateField('cod', 2050, p), null);
  assert.equal(P.validateField('name', '  ', p), 'A name is required.');
  assert.match(P.validateField('siteLat', 40, p), /New England/); assert.match(P.validateField('siteLon', -75, p), /New England/);
  assert.equal(P.validateField('siteLat', 44, p), null);
  assert.match(P.validateField('tech', 'coal', p), /solar/);
  assert.match(P.validateField('exportMW', NaN, p), /must be/);
  const r = P.setField(p, 'exportMW', -5, { rules: R });
  assert.equal(r.ok, false); assert.match(r.reason, /not applied/); assert.equal(r.project, p); assert.equal(p.exportMW, 100);
});

test('create: name, technology, size for the direction and COD required; bus optional (live parity)', () => {
  const r = P.newProject({ name: '', tech: 'storage', exportMW: 0, importMW: 0 }, { rules: R, now: NOW });
  assert.equal(r.ok, false); assert.deepEqual(Object.keys(r.errors).sort(), ['cod', 'exportMW', 'importMW', 'name']);
  const dc = P.newProject({ name: 'DC', tech: 'datacenter', importMW: 300, cod: 2030 }, { rules: R, now: NOW });
  assert.equal(dc.ok, true, JSON.stringify(dc.errors)); assert.equal(dc.project.exportMW, 0); assert.deepEqual(dc.project.options, []);
  assert.deepEqual(P.validateProject(dc.project).missing, ['bus']);
  const w = P.newProject({ name: 'W', tech: 'wind', importMW: 50, cod: 2030 }, { rules: R, now: NOW });
  assert.equal(w.ok, false); assert.ok(w.errors.exportMW);
});

test('defaults come from rules/isone-2026/defaults.json with their source; nothing invented', () => {
  const p = mk().project, ui = p.assumptions.ui;
  assert.equal(ui.fin.capex, A.pv_tracking.capex_per_kwac * 100 * 1000);
  assert.equal(ui.fin.annualOM, A.pv_tracking.fom_per_kwac_yr * 100 * 1000);
  assert.equal(ui.fin.discountRate, A.finance.wacc_nominal);
  assert.equal(ui.econ.solarCF, A.pv_tracking.cf_by_class['7'] * 100);
  for (const k of ['capex', 'annualOM', 'discountRate', 'solarCF', 'years']) { assert.equal(p.stated[k], 'default', k); assert.match(p.sources[k], /NREL ATB 2025|Lazard/, k); }
  assert.match(p.sources.discountRate, /Lazard LCOE\+ v19\.0/);
  assert.equal(ui.land.siteLat, 41.6); assert.equal(p.stated.siteLat, 'default'); assert.match(p.sources.siteLat, /bus/);
  for (const k of ['name', 'tech', 'exportMW', 'cod']) assert.equal(p.stated[k], 'stated', k);
  assert.equal(ui.land.control, null, 'no rule default: not held'); assert.equal(ui.land.route, null); assert.equal(p.stated.control, undefined);
  assert.equal(ui.qService, null);
  const s = P.newProject({ name: 'B', tech: 'storage', exportMW: 50, importMW: 50, cod: 2028 }, { rules: R, now: NOW }).project;
  assert.equal(s.assumptions.ui.econ.duration, 4); assert.match(s.sources.duration, /battery_4h/);
  assert.equal(s.assumptions.ui.econ.rte, A.battery_4h.rte * 100); assert.equal(s.assumptions.ui.fin.years, A.battery_4h.life_years);
  assert.equal(s.assumptions.ui.fin.capex, A.battery_4h.capex_per_kw * 50 * 1000);
  const d = P.newProject({ name: 'D', tech: 'datacenter', importMW: 300, cod: 2030 }, { rules: R, now: NOW }).project;
  assert.equal(d.assumptions.ui.fin.capex, null, 'no ATB entry for a data centre: not held, never 0');
  const nr = P.newProject({ name: 'N', tech: 'solar', exportMW: 10, cod: 2030 }, { now: NOW }).project;
  assert.equal(nr.assumptions.ui.fin.capex, null, 'rules not loaded: not held');
  const st = P.newProject({ name: 'S', tech: 'solar', exportMW: 10, cod: 2030, capex: 9e6 }, { rules: R, now: NOW }).project;
  assert.equal(st.assumptions.ui.fin.capex, 9e6); assert.equal(st.stated.capex, 'stated');
});

test('setField: a stated value sticks; size change re-derives only defaulted fields; COD mirrors qCod', () => {
  let p = mk({ capex: 5e7 }).project;
  const r = P.setField(p, 'exportMW', 200, { rules: R });
  assert.equal(r.ok, true); assert.equal(r.old, 100); assert.notEqual(r.project, p); assert.equal(p.exportMW, 100, 'pure');
  p = r.project; assert.equal(p.exportMW, 200);
  assert.equal(p.assumptions.ui.fin.capex, 5e7, 'stated capex kept');
  assert.equal(p.assumptions.ui.fin.annualOM, A.pv_tracking.fom_per_kwac_yr * 200 * 1000, 'defaulted O&M follows the size');
  p = P.setField(p, 'cod', 2031).project; assert.equal(p.assumptions.ui.fin.cod, 2031); assert.equal(p.assumptions.ui.qCod, 2031);
  p = P.setField(p, 'discountRate', 0.09).project; assert.equal(p.stated.discountRate, 'stated');
  p = P.setField(p, 'discountRate', null, { rules: R }).project; assert.equal(p.stated.discountRate, 'default'); assert.equal(p.assumptions.ui.fin.discountRate, A.finance.wacc_nominal);
  assert.equal(P.setField(p, 'name', 'X').project.name, 'X');
  assert.equal(P.renameProject(p, 'Y').project.name, 'Y'); assert.equal(P.renameProject(p, '').ok, false);
});

test('tech change: switches defaults and the direction fields', () => {
  let p = mk().project; p = P.setField(p, 'tech', 'storage', { rules: R }).project;
  assert.equal(p.tech, 'storage'); assert.equal(p.assumptions.ui.econ.duration, 4); assert.equal(p.assumptions.ui.econ.solarCF, null);
  p = P.setField(p, 'tech', 'datacenter', { rules: R }).project; assert.equal(p.exportMW, 0);
});
test('tech change that leaves a required size missing: accepted, reported as incomplete, never 0 (fix-1)', () => {
  const r = P.setField(mk({ exportMW: 150 }).project, 'tech', 'datacenter', { rules: R });
  assert.equal(r.ok, true); assert.equal(r.project.importMW, null, 'not held, never 0');
  assert.match(r.incomplete.importMW, /^Import \/ charge size is not held for datacenter: set it now\.$/); assert.deepEqual(Object.keys(r.incomplete), Object.keys(P.validateProject(r.project).errors));
  assert.equal(P.importJSON(P.exportJSON([r.project]), { existing: [] }).added.length, 0, 'an incomplete project is not importable: the panel says so');
  const done = P.setField(r.project, 'importMW', 150, { rules: R });
  assert.equal(done.ok, true); assert.deepEqual(done.incomplete, {}); assert.equal(done.project.importMW, 150);
  const back = P.importJSON(P.exportJSON([done.project]), { existing: [] }); assert.deepEqual(back.errors, []); assert.equal(back.added.length, 1);
  assert.deepEqual(P.setField(mk().project, 'exportMW', 200, { rules: R }).incomplete, {});
});

test('tech data centre → solar: export size back to not held (null, never 0), incomplete with its own text (fix-2)', () => {
  let p = P.newProject({ name: 'B', tech: 'storage', exportMW: 100, importMW: 100, cod: 2029 }, { rules: R, now: NOW }).project;
  p = P.setField(p, 'tech', 'datacenter', { rules: R }).project; assert.equal(p.exportMW, 0);
  const r = P.setField(p, 'tech', 'solar', { rules: R });
  assert.equal(r.ok, true); assert.equal(r.project.exportMW, null, 'not held, never 0'); assert.equal(r.project.stated.exportMW, undefined);
  assert.equal(r.incomplete.exportMW, 'Export size is not held for solar: set it now.'); assert.doesNotMatch(r.incomplete.exportMW, /not applied/);
  assert.deepEqual(P.toState(r.project).exportMW, null);
});
test('fmtVal: null/blank read "not held"; markStale reasons never print "null" (fix-2)', () => {
  assert.equal(P.fmtVal(null), 'not held'); assert.equal(P.fmtVal(undefined), 'not held'); assert.equal(P.fmtVal(''), 'not held'); assert.equal(P.fmtVal(0), '0'); assert.equal(P.fmtVal(300), '300');
  assert.equal(P.markStale([{ id: 'a' }], 'dcMW', null, 300).records[0].staleReason, 'DC nameplate not held → 300');
  assert.equal(P.markStale([{ id: 'a' }], 'profile', null, 'hourly 8760').reason, 'Profile availability not held → hourly 8760');
  assert.equal(P.markStale([{ id: 'a' }], 'duration', 4, 4).n, 0, 'an equal value is not a change: nothing goes stale');
});

test('options: add (a bus once per project), remove, status; ids unique', () => {
  let p = mk().project;
  let r = P.addOption(p, { busId: 111403, busName: 'Mashpee' }); assert.equal(r.ok, true);
  p = r.project; assert.equal(p.options.length, 2); assert.equal(r.option.busId, '111403'); assert.notEqual(r.option.id, p.options[0].id);
  r = P.addOption(p, { busId: '111403', busName: 'Mashpee' }); assert.equal(r.ok, false); assert.match(r.reason, /already/);
  assert.equal(P.addOption(p, {}).ok, false);
  r = P.setOption(p, p.options[1].id, { status: 'Shortlisted', note: 'n' }); assert.equal(r.project.options[1].status, 'Shortlisted');
  assert.equal(P.setOption(p, p.options[1].id, { status: 'Nope' }).ok, false);
  p = P.removeOption(p, p.options[0].id).project; assert.equal(p.options.length, 1); assert.equal(p.options[0].busId, '111403');
  p = P.addOption(p, { busId: '111209' }).project; assert.equal(new Set(p.options.map(o => o.id)).size, 2);
});

test('list ops: add, replace, delete; duplicate a Dummy sample as my project', () => {
  const p = mk().project; let L = P.upsertProject([], p); assert.equal(L.length, 1);
  L = P.upsertProject(L, { ...p, name: 'Renamed' }); assert.equal(L.length, 1); assert.equal(L[0].name, 'Renamed');
  assert.equal(P.deleteProject(L, p.id).length, 0); assert.equal(L.length, 1, 'pure');
  const s = SAMPLES.find(x => x.id === 'storage');
  const d = P.duplicateProject(s, { now: NOW, taken: SAMPLES.map(x => x.id) });
  assert.notEqual(d.id, s.id); assert.ok(!SAMPLES.some(x => x.id === d.id)); assert.equal(d.user, true); assert.equal(d.fromSample, 'storage');
  assert.doesNotMatch(d.name, /\(sample\)/); assert.equal(d.tech, 'storage'); assert.equal(d.exportMW, s.exportMW);
  assert.deepEqual(d.options.map(o => o.busId), s.options.map(o => o.busId)); assert.ok(d.options.every(o => o.status === 'Exploring'));
  assert.equal(d.assumptions.ui.fin.capex, s.assumptions.ui.fin.capex); assert.equal(d.assumptions.ui.land.po3, s.assumptions.ui.land.po3);
  assert.equal(d.stated.capex, 'default'); assert.match(d.sources.capex, /sample/i); assert.equal(d.stated.name, 'stated');
  assert.equal(d.steps, undefined, 'walkthrough steps stay with the sample');
  d.assumptions.ui.fin.capex = 1; assert.notEqual(s.assumptions.ui.fin.capex, 1, 'deep copy');
  const d2 = P.duplicateProject(d, { now: NOW, taken: [d.id] }); assert.notEqual(d2.id, d.id); assert.equal(d2.stated.capex, 'default');
});

test('toState: the One Studio state patch for a project and option', () => {
  let p = mk().project; p = P.addOption(p, { busId: '111403' }).project; p = P.setField(p, 'service', 'CNRIS').project;
  const st = P.toState(p, p.options[1].id);
  assert.deepEqual(Object.keys(st).sort(), ['exportMW', 'importMW', 'inputProv', 'inputSrc', 'nodeId', 'siteSrc', 'tech', 'ui']);
  assert.equal(st.nodeId, '111403'); assert.equal(st.tech, 'solar'); assert.equal(st.exportMW, 100); assert.equal(st.importMW, 0);
  assert.equal(st.ui.qCod, 2029); assert.equal(st.ui.qService, 'CNRIS'); assert.equal(st.ui.fin.cod, 2029);
  assert.equal(st.ui.land.control, null); assert.equal(P.toState(p).nodeId, '111209', 'default = first option');
  assert.equal(P.toState(P.setField(p, 'service', 'energy-only').project).ui.qService, null, 'only NRIS/CNRIS reach the queue engine');
  const s = SAMPLES[0], d = P.duplicateProject(s, { now: NOW }); const st2 = P.toState(d, d.options[1]);
  assert.equal(st2.ui.fin.annualRevenue, s.assumptions.optionAnnualRevenue[s.options[1].busId]);
  assert.equal(st2.ui.econ.lossPct, s.assumptions.ui.econ.lossPct); assert.equal(st2.ui.qStart, s.assumptions.ui.qStart);
  st2.ui.fin.capex = 1; assert.notEqual(d.assumptions.ui.fin.capex, 1, 'patch is a copy');
  const np = P.newProject({ name: 'nb', tech: 'wind', exportMW: 10, cod: 2030 }, { rules: R, now: NOW }).project;
  assert.equal(P.toState(np).nodeId, null);
});

test('markStale: pure port of live markStale (basis fields only, reason "<label> old → new", already-stale untouched)', () => {
  const recs = [{ id: 1 }, { id: 2, stale: true, staleReason: 'earlier' }, { id: 3, stale: false }];
  const r = P.markStale(recs, 'exportMW', 100, 200);
  assert.equal(r.n, 2); assert.equal(r.reason, 'Export size 100 → 200');
  assert.deepEqual(r.records.map(x => [x.stale, x.staleReason]), [[true, 'Export size 100 → 200'], [true, 'earlier'], [true, 'Export size 100 → 200']]);
  assert.equal(recs[0].stale, undefined, 'input not mutated');
  assert.equal(P.markStale(recs, 'name', 'a', 'b').n, 0); assert.equal(P.markStale(recs, 'notes', 'a', 'b').records[0].stale, undefined);
  assert.equal(P.markStale(recs, 'sizeMW', 1, 2).reason, 'Project size 1 → 2', 'live keys kept');
  for (const k of ['tech', 'importMW', 'dcMW', 'duration', 'service', 'profile']) assert.ok(k in P.BASIS_FIELDS, k);
  assert.equal(P.markStale(null, 'tech', 'a', 'b').n, 0);
});
test('markStale(keep): only the records built on this project go stale (fix-1: a Dummy-sample scenario is never touched)', () => {
  const recs = [{ id: 1, project: 'kennebec' }, { id: 2, project: 'u1' }, { id: 3 }];
  const r = P.markStale(recs, 'exportMW', 150, 200, x => x.project === 'u1');
  assert.equal(r.n, 1); assert.deepEqual(r.records.map(x => !!x.stale), [false, true, false]); assert.equal(r.records[0].staleReason, undefined);
});

test('statedCount: live inspInputs field set per asset, N of M stated', () => {
  const p = mk().project; const c = P.statedCount(p);
  assert.ok(c.fields.includes('dcMW') && !c.fields.includes('duration') && !c.fields.includes('notes'));
  assert.equal(c.stated, c.fields.filter(k => p.stated[k] === 'stated').length); assert.equal(c.total, c.fields.length);
  assert.ok(c.stated >= 4);
  const s = P.newProject({ name: 'B', tech: 'storage', exportMW: 50, importMW: 50, cod: 2028 }, { rules: R, now: NOW }).project;
  assert.ok(P.statedCount(s).fields.includes('duration') && !P.statedCount(s).fields.includes('dcMW'));
  assert.equal(P.statedCount(P.setField(p, 'dcMW', 130).project).stated, c.stated + 1);
});

test('localStorage under gsone.projects.v1: versioned, try/catch, bad data → empty', () => {
  const m = memStore(), p = mk().project;
  assert.equal(P.STORE_KEY, 'gsone.projects.v1');
  assert.equal(P.saveProjects([p], m), true);
  const j = JSON.parse(m.getItem('gsone.projects.v1')); assert.equal(j.v, 1); assert.equal(j.projects.length, 1);
  assert.deepEqual(P.loadProjects(m), [p]);
  m.setItem('gsone.projects.v1', '{bad'); assert.deepEqual(P.loadProjects(m), []);
  m.setItem('gsone.projects.v1', JSON.stringify({ v: 99, projects: [p] })); assert.deepEqual(P.loadProjects(m), []);
  const boom = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(P.loadProjects(boom), []); assert.equal(P.saveProjects([p], boom), false);
  assert.deepEqual(P.loadProjects(undefined), []);
});

test('JSON export/import round-trip; id collisions renamed; invalid projects reported, not added', () => {
  const p = mk().project; const txt = P.exportJSON([p], { now: NOW });
  const j = JSON.parse(txt); assert.equal(j.format, 'gsone.projects'); assert.equal(j.v, 1);
  const r = P.importJSON(txt, { existing: [] }); assert.deepEqual(r.projects, [p]); assert.deepEqual(r.added, [p.id]); assert.deepEqual(r.errors, []);
  const r2 = P.importJSON(txt, { existing: [p], now: NOW + 1 }); assert.equal(r2.projects.length, 2); assert.notEqual(r2.added[0], p.id);
  const bad = { ...p, id: 'zz', name: '' }; const r3 = P.importJSON(JSON.stringify({ format: 'gsone.projects', v: 1, projects: [bad] }), { existing: [] });
  assert.equal(r3.projects.length, 0); assert.equal(r3.errors.length, 1); assert.match(r3.errors[0], /name/i);
  assert.equal(P.importJSON('not json', { existing: [p] }).projects.length, 1); assert.equal(P.importJSON('not json', {}).errors.length, 1);
  assert.equal(P.importJSON(txt, { existing: [], reserved: [p.id], now: NOW }).added[0] !== p.id, true, 'sample ids reserved');
});

test('import a live-Studio project (projects[].locations[].options[], bess → storage)', () => {
  const live = { projects: [{ id: 'kennebec', name: 'Kennebec BESS', asset: 'bess', sizeMW: 80, durationH: 2, cod: 2030, service: 'NRIS', land: 'optioned', profile: 'none',
    locations: [{ id: 'l1', name: 'Mashpee area (Barnstable)', lat: 41.6, lon: -70.5, options: [{ id: 'o1', busId: 111403, sizeMW: 80, direction: 'both', status: 'Shortlisted', note: 'n1' }, { id: 'o2', busId: 111209, sizeMW: 80, direction: 'both', status: 'Exploring', note: '' }] },
      { id: 'l2', name: 'Dup', lat: 41.7, lon: -70.4, options: [{ id: 'o3', busId: 111403, sizeMW: 80 }] }],
    evidence: [{ blockId: 'x' }], findings: [], decision: null }] };
  const r = P.importJSON(JSON.stringify(live), { existing: [], rules: R, busName: id => ({ 111403: 'Mashpee' }[id] || null), reserved: ['kennebec'], now: NOW });
  assert.deepEqual(r.errors, []); const p = r.projects[0];
  assert.notEqual(p.id, 'kennebec'); assert.equal(p.tech, 'storage'); assert.equal(p.exportMW, 80); assert.equal(p.importMW, 80);
  assert.equal(p.assumptions.ui.econ.duration, 2); assert.equal(p.assumptions.ui.fin.cod, 2030); assert.equal(p.service, 'NRIS'); assert.equal(p.landStatus, 'optioned');
  assert.deepEqual(p.options.map(o => [o.busId, o.busName, o.status, o.note]), [['111403', 'Mashpee', 'Shortlisted', 'n1'], ['111209', null, 'Exploring', '']], 'bus once per project');
  assert.equal(p.stated.duration, 'stated'); assert.equal(p.stated.profile, undefined, 'live "none" = not stated');
  assert.equal(p.imported.from, 'live-studio'); assert.equal(p.imported.evidence.length, 1);
  assert.equal(P.toState(p).ui.qService, 'NRIS');
  const one = P.fromLive({ name: 'DC', asset: 'dc', sizeMW: 300, cod: 2031, dcMW: null, locations: [] }, { rules: R, now: NOW });
  assert.equal(one.tech, 'datacenter'); assert.equal(one.importMW, 300); assert.equal(one.exportMW, 0);
  const hy = P.fromLive({ name: 'H', asset: 'hybrid', sizeMW: 150, dcMW: 195, cod: 2031, locations: [] }, { rules: R, now: NOW });
  assert.equal(hy.importMW, null, 'live hybrid has no charge size: not held'); assert.equal(hy.dcMW, 195);
});

test('fieldValue reads an input by its FIELDS path; null = not held; unknown key undefined', () => {
  const p = mk().project;
  assert.equal(P.fieldValue(p, 'cod'), 2029); assert.equal(P.fieldValue(p, 'exportMW'), 100);
  assert.equal(P.fieldValue(p, 'dcMW'), null); assert.equal(P.fieldValue(p, 'nope'), undefined);
});

// fix-3: the import-side twin of F1 — a solar/wind → hybrid change must not carry solar's "does not apply" 0 as a stated charge size.
test('solar or wind → hybrid: import not held, not stated, same count as a direct hybrid, capex not held', () => {
  for (const from of ['solar', 'wind']) {
    let p = P.newProject({ name: 'x', tech: from, exportMW: 100, cod: 2030 }, { rules: R, now: NOW }).project;
    p = P.setField(p, 'tech', 'hybrid', { rules: R }).project;
    const q = P.newProject({ name: 'x', tech: 'hybrid', exportMW: 100, cod: 2030 }, { rules: R, now: NOW }).project;
    assert.equal(p.importMW, null, from); assert.equal(p.stated.importMW, undefined, from);
    assert.equal(P.statedCount(p).stated, P.statedCount(q).stated, from);
    assert.equal(p.assumptions.ui.fin.capex, q.assumptions.ui.fin.capex, from); assert.equal(p.assumptions.ui.fin.capex, null, from);
  }
});

// fix-3: the site default follows the option in view (plan §6 "Site lat/lon (defaults to the bus)").
test('site lat/lon default follows the option in view: addOption records the bus coordinate, toState applies it', () => {
  let p = mk().project; // o1 = Hatchville 41.6 / -70.5
  const r = P.addOption(p, { busId: '111403', busName: 'Other', lat: 41.62, lon: -70.47 }); assert.ok(r.ok); p = r.project;
  const s2 = P.toState(p, 'o2'); assert.equal(s2.ui.land.siteLat, 41.62); assert.equal(s2.ui.land.siteLon, -70.47); assert.match(s2.siteSrc, /Other/);
  const s1 = P.toState(p, 'o1'); assert.equal(s1.ui.land.siteLat, 41.6); assert.equal(s1.ui.land.siteLon, -70.5);
});
test('site default from busCoord when the option holds none; a stated site is never replaced', () => {
  let p = mk().project; p = P.addOption(p, { busId: '111403', busName: 'Other' }).project;
  const s = P.toState(p, 'o2', { busCoord: { lat: 41.7, lon: -70.4, name: 'Other' } }); assert.equal(s.ui.land.siteLat, 41.7); assert.equal(s.ui.land.siteLon, -70.4); assert.match(s.siteSrc, /bus coordinate \(Other\)/);
  p = P.setField(p, 'siteLat', 42.0, { rules: R }).project; p = P.setField(p, 'siteLon', -71.0, { rules: R }).project;
  const t = P.toState(p, 'o2', { busCoord: { lat: 41.7, lon: -70.4, name: 'Other' } }); assert.equal(t.ui.land.siteLat, 42.0); assert.equal(t.ui.land.siteLon, -71.0);
});
test('toState reports default-labelled inputs with their source (inputSrc), stated ones as absent', () => {
  const p = mk().project, s = P.toState(p);
  assert.ok(s.inputSrc.solarCF && /defaults\.json|rules/.test(s.inputSrc.solarCF), s.inputSrc.solarCF);
  assert.equal(s.inputSrc.cod, undefined);
});

// fix-4 (store): the site default follows the CURRENT option's bus; every option records its bus coordinate.
test('every option records busLat/busLon from the bus the caller passes; no coordinate = null, never 0', () => {
  let p = mk().project; p = P.addOption(p, { busId: '111403', busName: 'Other', lat: 41.62, lon: -70.47 }).project;
  assert.equal(p.options[1].busLat, 41.62); assert.equal(p.options[1].busLon, -70.47);
  p = P.addOption(p, { busId: '111500', busName: 'Third' }).project;
  assert.equal(p.options[2].busLat, null); assert.equal(p.options[2].busLon, null);
  assert.equal(p.assumptions.optionSite, undefined, 'the coordinate lives on the option');
});
test("a default site never shows another option's bus: an option without a coordinate reads not held", () => {
  let p = mk().project; p = P.addOption(p, { busId: '111500', busName: 'Third' }).project;
  const s = P.toState(p, 'o2'); assert.equal(s.ui.land.siteLat, null); assert.equal(s.ui.land.siteLon, null); assert.equal(s.inputSrc.siteLat, undefined);
  const s1 = P.toState(p, 'o1'); assert.equal(s1.ui.land.siteLat, 41.6); assert.match(s1.inputSrc.siteLat, /Hatchville/);
});
test('returning site lat/lon to default (null) follows the current option again; a stated site stays on every option', () => {
  let p = mk().project; p = P.addOption(p, { busId: '111403', busName: 'Other', lat: 41.62, lon: -70.47 }).project;
  p = P.setField(p, 'siteLat', 42.0, { rules: R }).project; p = P.setField(p, 'siteLon', -71.0, { rules: R }).project;
  for (const o of ['o1', 'o2']) { const s = P.toState(p, o); assert.equal(s.ui.land.siteLat, 42.0, o); assert.equal(s.ui.land.siteLon, -71.0, o); assert.equal(s.inputSrc.siteLat, undefined, o); }
  p = P.setField(p, 'siteLat', null, { rules: R }).project; p = P.setField(p, 'siteLon', null, { rules: R }).project;
  const s2 = P.toState(p, 'o2'); assert.equal(s2.ui.land.siteLat, 41.62); assert.equal(s2.ui.land.siteLon, -70.47); assert.match(s2.siteSrc, /Other/);
});
test('a site default from a non-bus source (a live Studio location) is kept on every option', () => {
  const lp = { name: 'L', asset: 'solar', sizeMW: 50, cod: 2030, locations: [{ id: 'L1', name: 'Field', lat: 42.5, lon: -72.1, options: [{ id: 'o1', busId: '111209' }, { id: 'o2', busId: '111403' }] }] };
  const p = P.fromLive(lp, { rules: R, now: NOW, busName: () => null });
  for (const o of ['o1', 'o2']) { const s = P.toState(p, o, { busCoord: { lat: 41.0, lon: -70.0, name: 'X' } }); assert.equal(s.ui.land.siteLat, 42.5, o); assert.match(s.siteSrc, /live Studio location/, o); }
});
test("legacy stored project (options without busLat, site default from o1's bus) follows the option via busCoord", () => {
  let p = mk().project; p = P.addOption(p, { busId: '111403', busName: 'Other' }).project;
  for (const o of p.options) { delete o.busLat; delete o.busLon; }
  const s = P.toState(p, 'o2', { busCoord: { lat: 41.7, lon: -70.4, name: 'Other' } }); assert.equal(s.ui.land.siteLat, 41.7);
  const t = P.toState(p, 'o2'); assert.equal(t.ui.land.siteLat, null, "no coordinate for o2: not held, not o1's");
});

// fix-4 (store): on a tech change, a size that becomes applicable and was only held as "does not apply" is null + not held.
test('every tech → tech change: a newly applicable size is never a 0, stated or default; a does-not-apply 0 is not "stated"', () => {
  const base = { solar: { exportMW: 100 }, wind: { exportMW: 100 }, storage: { exportMW: 100, importMW: 100 }, hybrid: { exportMW: 100, importMW: 50 }, datacenter: { importMW: 300 } };
  for (const from of P.TECHS) for (const to of P.TECHS) {
    if (from === to) continue;
    const p0 = P.newProject({ name: 'x', tech: from, cod: 2030, ...base[from] }, { rules: R, now: NOW }).project;
    for (const k of ['exportMW', 'importMW']) if (!P.applies(k, from) || (k === 'exportMW' && from === 'datacenter')) assert.notEqual(p0.stated[k], 'stated', `${from} ${k}`);
    const p = P.setField(p0, 'tech', to, { rules: R }).project;
    for (const k of ['exportMW', 'importMW']) {
      const was = p0[k] === 0 && p0.stated[k] !== 'stated', now = P.applies(k, to) && !(k === 'exportMW' && to === 'datacenter');
      if (was && now) { assert.equal(p[k], null, `${from}→${to} ${k}`); assert.equal(p.stated[k], undefined, `${from}→${to} ${k}`); }
    }
  }
});
test("a sample copy's does-not-apply 0 (labelled default) also becomes not held when it applies", () => {
  const dc = SAMPLES.find(s => s.tech === 'datacenter'); if (!dc) return;
  const c = P.duplicateProject(dc, { now: NOW }); assert.equal(c.exportMW, 0);
  const p = P.setField(c, 'tech', 'solar', { rules: R }).project; assert.equal(p.exportMW, null); assert.equal(p.stated.exportMW, undefined);
});
test('a stated hybrid charge size of 0 is kept when the technology is re-set to hybrid', () => {
  let p = P.newProject({ name: 'x', tech: 'hybrid', exportMW: 100, importMW: 0, cod: 2030 }, { rules: R, now: NOW }).project;
  assert.equal(p.stated.importMW, 'stated');
  p = P.setField(p, 'tech', 'hybrid', { rules: R }).project; assert.equal(p.importMW, 0); assert.equal(p.stated.importMW, 'stated');
});
