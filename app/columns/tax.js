// S5 grid column definitions: credit type and the OBBBA eligibility-gate state per bus/option, in the 04 column-spec
// shape (unit · interval · tz · weighting · level · null-render · source). The lead adapts them into the grid registry.
// Values come from rules/tax.js (one home for the verdict); unknown renders "not held" + reason and never passes.
// Provenance: Claude Opus 5.5 (S5 agent) · one-studio/design (T3, P2 slice S5) · 2026-10-06 · sign-off pending · v1
import { taxGate, taxGateHybrid, resolveTaxInputs, creditRates, citations as taxCitations } from '../rules/tax.js';

const SRC = 'rules/isone-2026.json → tax (R3 §2 gate); PIS from the Queue COD; BOC / MACR from the user (S.ui.tax)';
export const TAX_COLUMNS = [
  { id: 'tax_credit', label: 'Credit (45Y/48E)', family: 'Tax', unit: 'credit type · rate', interval: 'project', tz: 'n/a', weighting: 'n/a', level: 'project', nullRender: 'not held + reason', source: SRC, sort: 'text' },
  { id: 'tax_gate', label: 'Tax gate (OBBBA)', family: 'Tax', unit: 'state', interval: 'project', tz: 'n/a', weighting: 'n/a', level: 'project', nullRender: 'not held + reason (counted under not held; never a pass)', source: SRC, sort: 'rank' },
];
const RANK = { eligible: 0, contingent: 1, review: 2, open: 3, ineligible: 4 };

function cellsFor(g, rates) {
  const pass = g.state === 'eligible', decided = g.state === 'eligible' || g.state === 'ineligible';
  const credit = pass
    ? `${rates.choices.map(m => m.toUpperCase()).join(' or ')} ${Math.round(100 * rates.itc)}%${g.fraction < 1 ? ` × ${Math.round(100 * g.fraction)}%` : ''}`
    : g.state === 'ineligible' ? 'none (OBBBA)' : `${rates.choices.map(m => m.toUpperCase()).join(' or ')}: not held (${g.state})`;
  return {
    tax_credit: { value: pass ? rates.choices.join('|') : g.state === 'ineligible' ? 'none' : null, text: credit, state: g.state, reason: g.reason },
    tax_gate: { value: decided ? g.state : null, text: decided ? g.label : `not held: ${g.reason}`, state: g.state, rank: RANK[g.state], row: g.row, reason: g.reason, src: g.src },
  };
}

/**
 * Cell values for one row. row = {tech, mw, queueCod, tax: S.ui.tax (optional user BOC / MACR / PWA …)}.
 * A hybrid shows the stricter part (the later rank) and names both in the reason.
 */
export function taxCells(row, R, asOf) {
  const { input } = resolveTaxInputs(row.tax || {}, { tech: row.tech === 'hybrid' ? 'solar' : row.tech, mw: row.mw, queueCod: row.queueCod, asOf }, R);
  if (row.tech === 'hybrid') {
    const h = taxGateHybrid(input, R, 'solar'), a = cellsFor(h.generator, creditRates({ ...input, tech: 'solar' }, R)), b = cellsFor(h.storage, creditRates({ ...input, tech: 'storage' }, R));
    const worse = a.tax_gate.rank >= b.tax_gate.rank ? a : b;
    return { tax_credit: { ...worse.tax_credit, text: `solar: ${a.tax_credit.text} · storage: ${b.tax_credit.text}` }, tax_gate: { ...worse.tax_gate, reason: `Solar: ${a.tax_gate.reason} Storage: ${b.tax_gate.reason}` } };
  }
  const g = taxGate(input, R);
  if (!['solar', 'wind', 'storage'].includes(row.tech)) return { tax_credit: { value: null, text: 'not held: no credit rule for this technology', state: 'open' }, tax_gate: { value: null, text: `not held: ${g.reason}`, state: 'open', rank: RANK.open } };
  return cellsFor(g, creditRates(input, R));
}

/** Sources behind the two columns. */
export function citations(R) { return taxCitations(R); }
