// S5 tax: the OBBBA eligibility gate (R3 §2 rows G0–G12, M1), credit rates, adders, citations.
// Provenance: Claude Opus 5.5 (S5 agent) · one-studio/design (T3, P2 slice S5) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taxGate, creditRates, ptcRateFor, domesticContentThreshold, macrThreshold, resolveTaxInputs, citations, GATE_LABEL } from '../rules/tax.js';

const R = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const asOf = '2026-10-06';
const g = (x) => taxGate({ asOf, macr: 1, ...x }, R);

test('F-W2: new solar, BOC after 2026-07-04, PIS from the Queue COD after 2027-12-31 → not eligible (OBBBA); storage stays eligible', () => {
  const solar = g({ tech: 'solar', boc: '2026-08-01', bocMethod: 'physical_work', pis: '2028-06-30', pisSource: 'queue' });
  assert.equal(solar.state, 'ineligible'); assert.equal(solar.row, 'G7'); assert.equal(solar.label, 'Not eligible for 45Y/48E (OBBBA)'); assert.equal(solar.fraction, 0);
  const noBoc = g({ tech: 'solar', pis: '2028-06-30' });
  assert.equal(noBoc.state, 'ineligible', 'no BOC evidence and a 2028 COD falls to G7 by default');
  const storage = g({ tech: 'storage', boc: '2026-08-01', pis: '2028-06-30', macr: 0.9 });
  assert.equal(storage.state, 'eligible'); assert.equal(storage.fraction, 1); assert.equal(storage.row, 'G8');
});

test('the gate flips with BOC and PIS (G1 / G2 / G3 / G7)', () => {
  assert.equal(g({ tech: 'solar', pis: '2027-12-31' }).row, 'G1');
  assert.equal(g({ tech: 'solar', pis: '2027-12-31' }).state, 'eligible');
  assert.equal(g({ tech: 'solar', pis: '2028-01-01' }).state, 'ineligible');
  const g2 = g({ tech: 'wind', boc: '2026-07-04', bocMethod: 'physical_work', pis: '2030-12-31' });
  assert.equal(g2.row, 'G2'); assert.equal(g2.state, 'eligible');
  const g3 = g({ tech: 'wind', boc: '2026-07-04', bocMethod: 'physical_work', pis: '2031-01-01' });
  assert.equal(g3.row, 'G3'); assert.equal(g3.state, 'review'); assert.equal(g3.fraction, 0, 'review never passes');
  assert.equal(g({ tech: 'wind', boc: '2026-07-05', bocMethod: 'physical_work', pis: '2029-01-01' }).row, 'G7');
});

test('Notice 2025-42 vacated → 5%-only BOC is contingent (G5); pre-Notice BOC (G4) and ≤ 1.5 MW solar (G6) are safe', () => {
  const g5 = g({ tech: 'solar', mwAc: 100, boc: '2026-03-01', bocMethod: 'five_pct', pis: '2029-06-01' });
  assert.equal(g5.row, 'G5'); assert.equal(g5.state, 'contingent'); assert.equal(g5.fraction, 0); assert.equal(g5.fractionIfPass, 1);
  assert.ok(g5.src.some(s => /25-4400|R3 §0/.test(s)), 'Evidence cites the vacatur');
  assert.equal(g({ tech: 'solar', mwAc: 1.5, boc: '2026-03-01', bocMethod: 'five_pct', pis: '2029-06-01' }).row, 'G6');
  const g4 = g({ tech: 'wind', boc: '2025-08-01', bocMethod: 'five_pct', pis: '2029-06-01' });
  assert.equal(g4.row, 'G4'); assert.equal(g4.state, 'eligible');
});

test('unknown never passes: missing PIS, missing BOC method, missing MACR', () => {
  assert.equal(g({ tech: 'solar' }).state, 'open');
  assert.equal(g({ tech: 'solar', boc: '2026-05-01', pis: '2029-01-01' }).state, 'open', 'BOC before the cut-off needs its evidence method');
  const m = taxGate({ asOf, tech: 'storage', boc: '2026-08-01', pis: '2028-06-30' }, R);
  assert.equal(m.state, 'open'); assert.match(m.reason, /material-assistance/i); assert.equal(m.fraction, 0); assert.equal(m.fractionIfPass, 1);
  assert.equal(taxGate({ asOf, tech: 'nuclear' }, R).state, 'open');
});

test('G0 taxpayer bar, storage phase-out G8–G11, MACR thresholds M1/M2', () => {
  assert.equal(g({ tech: 'storage', boc: '2027-01-01', taxpayerPFE: true }).row, 'G0');
  assert.equal(g({ tech: 'storage', boc: '2033-05-01' }).fraction, 1);
  assert.equal(g({ tech: 'storage', boc: '2034-05-01' }).fraction, 0.75);
  assert.equal(g({ tech: 'storage', boc: '2035-05-01' }).fraction, 0.5);
  assert.equal(g({ tech: 'storage', boc: '2036-01-01' }).state, 'ineligible');
  assert.equal(macrThreshold('storage', 2026, R), 0.55); assert.equal(macrThreshold('solar', 2032, R), 0.6); assert.equal(macrThreshold('wind', 2025, R), null);
  const fail = g({ tech: 'storage', boc: '2027-02-01', macr: 0.59 });
  assert.equal(fail.state, 'ineligible'); assert.equal(fail.row, 'M1');
  assert.equal(g({ tech: 'storage', boc: '2027-02-01', macr: 0.6 }).state, 'eligible');
  const m2 = taxGate({ asOf, tech: 'storage', boc: '2025-11-01', pis: '2027-06-01' }, R);
  assert.equal(m2.state, 'eligible', 'MACR is not tested for BOC before 2026 (M2)');
});

test('credit rates: base vs PWA, < 1 MW, adders; PTC escalation and additive adders', () => {
  assert.equal(creditRates({ tech: 'solar', pwa: true }, R).itc, 0.3);
  assert.equal(creditRates({ tech: 'solar', pwa: false }, R).itc, 0.06);
  assert.equal(creditRates({ tech: 'solar', pwa: false, mwAc: 0.8 }, R).itc, 0.3);
  assert.ok(Math.abs(creditRates({ tech: 'solar', pwa: true, ec: true, dc: true }, R).itc - 0.5) < 1e-12, 'max ITC 50% (R3 A3)');
  assert.ok(Math.abs(creditRates({ tech: 'solar', pwa: false, ec: true }, R).itc - 0.08) < 1e-12);
  assert.equal(creditRates({ tech: 'solar', pwa: true }, R).ptc2026, 0.031);
  assert.ok(Math.abs(creditRates({ tech: 'wind', pwa: true, ec: true, dc: true }, R).ptc2026 - 0.031 * 1.2) < 1e-12);
  assert.equal(creditRates({ tech: 'storage', pwa: true }, R).ptc2026, null, 'storage has no PTC');
  assert.equal(creditRates({ tech: 'solar', pwa: null }, R).itc, null, 'PWA unknown → rate not held');
  assert.ok(Math.abs(ptcRateFor(2028, 0.031, R) - 0.031 * 1.025 ** 2) < 1e-12);
  assert.equal(domesticContentThreshold('2026-03-01', R), 0.5);
  assert.equal(domesticContentThreshold('2027-03-01', R), 0.55);
  assert.equal(domesticContentThreshold('2025-06-01', R), 0.4);
});

test('resolveTaxInputs: PWA defaults to met as a labelled assumption; PIS comes from Queue and is labelled; nothing else is filled', () => {
  const r = resolveTaxInputs({}, { tech: 'solar', mw: 100, queueCod: '2029-06-01' }, R);
  assert.equal(r.input.pwa, true); assert.equal(r.prov.pwa.kind, 'assumption'); assert.match(r.prov.pwa.label, /assum/i);
  assert.equal(r.input.pis, '2029-06-01'); assert.equal(r.prov.pis.kind, 'queue');
  assert.equal(r.input.boc, null); assert.equal(r.input.macr, null); assert.equal(r.prov.macr.kind, 'not held');
  assert.equal(r.input.ec, false); assert.equal(r.prov.ec.kind, 'off');
  const u = resolveTaxInputs({ pwa: false, pis: '2027-06-01', macr: 0.7 }, { tech: 'solar', queueCod: '2029-06-01' }, R);
  const y = resolveTaxInputs({}, { tech: 'solar', queueCod: 2027 }, R);
  assert.equal(y.input.pis, '2027-12-31'); assert.equal(y.prov.pis.kind, 'queue'); assert.equal(taxGate({ ...y.input, macr: 1, asOf }, R).row, 'G1');
  assert.equal(taxGate({ ...resolveTaxInputs({}, { tech: 'solar', queueCod: 2028 }, R).input, asOf }, R).row, 'G7');
  assert.equal(u.input.pwa, false); assert.equal(u.prov.pwa.kind, 'user'); assert.equal(u.input.pis, '2027-06-01'); assert.equal(u.prov.pis.kind, 'user');
});

test('citations(): every entry has a source and a known status; the contingent notice is listed', () => {
  const c = citations(R);
  assert.ok(c.length >= 10);
  for (const x of c) { assert.ok(x.src, x.key); assert.ok(['verified', 'corrected', 'assumption', 'pending', 'contingent', 'unverifiable'].includes(x.status), x.key); }
  assert.ok(c.some(x => x.key === 'tax.notice_2025_42' && x.status === 'contingent'));
  assert.equal(typeof GATE_LABEL.ineligible, 'string');
});

test('no hand-typed statutory constants in rules/tax.js', () => {
  const src = readFileSync(new URL('../rules/tax.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const lit of ['2026-07-04', '2027-12-31', '2025-09-02', '0.3', '0.06', '0.031', '0.75', '0.55', '1.5']) assert.ok(!src.includes(lit), `literal ${lit} in tax.js`);
});
