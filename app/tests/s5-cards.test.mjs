// S5 render functions (views/cards-finance.js) and grid columns (columns/tax.js): F-W2 on screen, F004 one click,
// Evidence carries the contingent Notice, nulls render "not held", never $0.
// Provenance: Claude Opus 5.5 (S5 agent) · one-studio/design (T3, P2 slice S5) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { financeCards, taxUiUpdate, finUiUpdate, decisionTaxGate } from '../views/cards-finance.js';
import { TAX_COLUMNS, taxCells, citations as colCitations } from '../columns/tax.js';

const R = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const ctx = { tech: 'solar', mw: 100, queueCod: '2029-06-01', asOf: '2026-10-06', sent: { revenue: 9e6 } };
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

test('F-W2 on screen: the gate card says "Not eligible for 45Y/48E (OBBBA)", cites the Queue COD, and Evidence shows the vacatur as contingent', () => {
  const out = financeCards({ fin: {}, tax: {} }, ctx, R);
  const html = out.cards.join('');
  assert.match(text(html), /Not eligible for 45Y\/48E \(OBBBA\)/);
  assert.match(text(html), /2029-06-01/); assert.match(text(html), /from the Queue COD/);
  assert.match(text(html), /Notice 2025-42/); assert.match(text(html), /contingent/);
  assert.match(html, /data-act="tax"/, 'BOC / PIS inputs present');
  const storage = financeCards({ fin: {}, tax: { boc: '2026-08-01', macr: 0.8 } }, { ...ctx, tech: 'storage' }, R);
  assert.match(text(storage.cards.join('')), /Eligible for 45Y\/48E/);
});

test('F004: before a preset the finance card offers named presets and computes nothing; one click later it shows NPV, IRR and LCOE with each input labelled', () => {
  const before = financeCards({ fin: {}, tax: {} }, ctx, R).cards.join('');
  assert.match(before, /data-act="fin-preset" data-v="atb25-pv-c7"/);
  assert.match(text(before), /NREL ATB 2025 Moderate/);
  assert.doesNotMatch(text(before), /\$0\b/);
  assert.match(text(before), /not held/);
  const ui = finUiUpdate({}, 'preset', 'atb25-pv-c7');
  const after = financeCards({ fin: ui, tax: {} }, ctx, R).cards.join('');
  const t = text(after);
  assert.match(t, /After-tax NPV/); assert.match(t, /IRR/); assert.match(t, /LCOE/);
  assert.match(t, /preset: NREL ATB 2025 Moderate/); assert.match(t, /Lazard LCOE\+ v19\.0/);
  assert.match(t, /sent from an Economics revenue tab/);
  assert.match(t, /forgone/i, 'the lost credit is shown beside the as-gated return');
});

test('the gate flips with BOC: entering a physical-work start before the cut-off makes the credit count', () => {
  let tax = taxUiUpdate({}, 'boc', '2026-05-01'); tax = taxUiUpdate(tax, 'bocMethod', 'physical_work'); tax = taxUiUpdate(tax, 'macr', '80');
  assert.equal(tax.macr, 0.8);
  const out = financeCards({ fin: { preset: 'atb25-pv-c7' }, tax }, ctx, R);
  assert.match(text(out.cards.join('')), /Eligible for 45Y\/48E/);
  assert.equal(out.model.gate.row, 'G2');
  assert.equal(taxUiUpdate(tax, 'boc', '').boc, undefined, 'clearing an entry removes it (back to not held)');
  assert.equal(taxUiUpdate({}, 'pwa', 'no').pwa, false);
  assert.equal(taxUiUpdate({}, 'macr', '140').macr, undefined, 'out-of-range MACR is rejected, not clamped');
});

test('decision gate row (decisioncore shape {gate, verdict Pass|Hold|Fail, why}): one verdict from the same gate', () => {
  const d = decisionTaxGate({ fin: {}, tax: {} }, ctx, R);
  assert.equal(d.gate, 'Tax credit (45Y/48E)'); assert.equal(d.verdict, 'Fail'); assert.match(d.why, /OBBBA/); assert.ok(d.src.length);
  assert.equal(decisionTaxGate({ fin: {}, tax: {} }, { ...ctx, queueCod: null }, R).verdict, 'Hold', 'unknown never passes: Hold, as in decisioncore');
});

test('grid columns: credit type and gate state, with the column-spec fields and "not held" for unknowns', () => {
  assert.deepEqual(TAX_COLUMNS.map(c => c.id), ['tax_credit', 'tax_gate']);
  for (const c of TAX_COLUMNS) for (const k of ['label', 'unit', 'interval', 'tz', 'weighting', 'level', 'nullRender', 'source']) assert.ok(c[k], `${c.id}.${k}`);
  const cells = taxCells({ tech: 'solar', mw: 100, queueCod: '2029-06-01' }, R, '2026-10-06');
  assert.equal(cells.tax_gate.state, 'ineligible'); assert.match(cells.tax_gate.text, /Not eligible/);
  assert.equal(cells.tax_credit.text, 'none (OBBBA)');
  const st = taxCells({ tech: 'storage', mw: 100, queueCod: '2029-06-01' }, R, '2026-10-06');
  assert.equal(st.tax_gate.state, 'open'); assert.equal(st.tax_gate.value, null); assert.match(st.tax_gate.text, /not held/);
  assert.match(st.tax_credit.text, /ITC/);
  const none = taxCells({ tech: 'solar', mw: 100 }, R, '2026-10-06');
  assert.equal(none.tax_gate.value, null); assert.match(none.tax_gate.text, /not held/);
  assert.ok(colCitations(R).length > 5);
});

test('cards-finance.js has no hand-typed numbers from the rules', () => {
  const src = readFileSync(new URL('../views/cards-finance.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const lit of ['2026-07-04', '2027-12-31', '0.077', '1405', '0.2574', '0.9']) assert.ok(!src.includes(lit), lit);
});
