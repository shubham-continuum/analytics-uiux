// fix-4 (store): a user project's stated|default map reaches Economics, so a rules-file default (e.g. solarCF from defaults.json
// pv_tracking class 7) is labelled a default with its source, and 'U' (your entry) is kept for stated values and Economics edits.
// Provenance: Claude Opus 5.5 (fixer store) · one-studio/design/14-lift-projects-configurator-continuum.md §6/§6a · 2026-10-14 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../projects.js';
import { EH } from '../views/economics.js';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = JSON.parse(readFileSync(path.join(APP, 'rules/isone-2026/defaults.json'), 'utf8'));
const NOW = Date.UTC(2026, 9, 14);
const mk = (o = {}) => P.newProject({ name: 'T', tech: 'solar', exportMW: 100, cod: 2030, bus: { busId: '111209', busName: 'Hatchville', lat: 41.6, lon: -70.5 }, ...o }, { rules: R, now: NOW }).project;
// The state Economics reads after the app applies a user project (app.js applyProject; wiring in FINAL-store.md).
const stateOf = p => { const st = P.toState(p); return { tech: st.tech, ui: { econ: st.ui.econ, fin: st.ui.fin, land: st.ui.land, inputProv: st.inputProv } }; };
const RULE_CF = R.defaults_atb2025.pv_tracking.cf_by_class['7'] * 100;

test('toState emits inputProv: every stated or default input with its state, source and the value it holds', () => {
  const st = P.toState(mk());
  assert.equal(st.inputProv.solarCF.state, 'default'); assert.match(st.inputProv.solarCF.src, /defaults\.json/); assert.equal(st.inputProv.solarCF.v, RULE_CF);
  assert.equal(st.inputProv.cod.state, 'stated'); assert.equal(st.inputProv.cod.v, 2030); assert.equal(st.inputProv.cod.src, null);
  assert.equal(st.inputProv.importMW, undefined, 'a does-not-apply size is neither stated nor a default');
  assert.equal(st.inputProv.siteLat.state, 'default'); assert.match(st.inputProv.siteLat.src, /Hatchville/);
});

test('a rules default that differs from Economics\' own default is labelled a default with its source, never U', () => {
  const S = stateOf(mk());
  assert.notEqual(RULE_CF, EH.DEFAULTS.solarCF[0], 'the case the finding names');
  assert.equal(EH.tag(S, 'solarCF'), 'A');
  const h = EH.input(S, 'solarCF', 'Capacity factor', '%');
  assert.match(h, />A</); assert.match(h, /defaults\.json/); assert.doesNotMatch(h, />U</);
  assert.doesNotMatch(h, /ISONE_REFERENCE/, 'the audit note names the project default\'s source, not Economics\' own default');
});

test('U only for a stated value or an edit made in Economics', () => {
  const p = P.setField(mk(), 'solarCF', 21, { rules: R }).project, S = stateOf(p);
  assert.equal(EH.tag(S, 'solarCF'), 'U');
  const S2 = stateOf(mk()); S2.ui.econ = { ...S2.ui.econ, solarCF: 19 }; assert.equal(EH.tag(S2, 'solarCF'), 'U', 'edited in Economics');
});

test('no project in scope: Economics\' own defaults and U as before; legacy inputSrc still labels a default', () => {
  assert.equal(EH.tag({ ui: { econ: {} } }, 'solarCF'), EH.DEFAULTS.solarCF[1]);
  assert.equal(EH.tag({ ui: { econ: { solarCF: 19 } } }, 'solarCF'), 'U');
  assert.equal(EH.tag({ ui: { econ: { solarCF: RULE_CF }, inputSrc: { solarCF: { src: 'rules', v: RULE_CF } } } }, 'solarCF'), 'A');
});

test('Finance fields: a rules default (capex, discount rate, life) is a labelled default; a stated value is U; none is NH', () => {
  const p = mk(), S = stateOf(p);
  assert.ok(S.ui.fin.capex != null, 'solar capex default from defaults.json');
  assert.equal(EH.finTag(S, 'capex').tag, 'A'); assert.match(EH.finTag(S, 'capex').src, /defaults\.json/);
  assert.equal(EH.finTag(S, 'discountRate').tag, 'A'); assert.equal(EH.finTag(S, 'years').tag, 'A');
  assert.equal(EH.finTag(S, 'cod').tag, 'U', 'COD is stated');
  assert.equal(EH.finTag(S, 'constructionYears').tag, 'NH');
  const S2 = stateOf(P.setField(p, 'capex', 1.5e8, { rules: R }).project); assert.equal(EH.finTag(S2, 'capex').tag, 'U');
  const S3 = stateOf(p); S3.ui.fin = { ...S3.ui.fin, capex: 1 }; assert.equal(EH.finTag(S3, 'capex').tag, 'U', 'edited in Finance');
  assert.equal(EH.finTag({ ui: { fin: { capex: 5 } } }, 'capex').tag, 'U', 'no project: as before');
});
