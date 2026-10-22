// Economics › Solar & wind revenue: the Contract card (Finding F011). Markup only; numbers from economics-contract.js.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S2-EM) · 2026-10-06 · sign-off pending · v1
// Every term is a labelled USER INPUT ("not entered" until typed; no default ever fills one). Until all are entered
// the revenue stays merchant and the card says so. Hub settlement prices the basis on the contracted MWh from the
// hour-matched hub series (Prices › Basis & congestion); forward hub prices are not held.
import { contractSettlement, contractPath, CONTRACT_FIELDS, CONTRACT_SHAPE } from '../economics-contract.js';
import { card, table, B } from './economics-charts.js';
import { fmt } from '../basis.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
// S.ui.econ keys for the numeric terms (the shell's 'econ' action stores numbers, '' → not entered).
const KEY = { ppaPrice: 'ctrPpa', sharePct: 'ctrShare', tenorYears: 'ctrTenor', escalatorPct: 'ctrEsc' };

/** The contract terms as entered (null = not entered). */
export function contractTerms(S) {
  const e = S.ui?.econ || {};
  const num = k => (ok(e[KEY[k]]) ? e[KEY[k]] : null);
  return { ppaPrice: num('ppaPrice'), settlement: ['node', 'hub'].includes(S.ui?.ctrSettle) ? S.ui.ctrSettle : null, sharePct: num('sharePct'), tenorYears: num('tenorYears'), escalatorPct: num('escalatorPct') };
}

function field(f, c) {
  const v = c[f.k], entered = v != null;
  const tag = `<span class="pill ${entered ? '' : 'warn'}" title="Your input, from the ${esc(f.who)}">${entered ? 'your entry' : 'not entered'}</span>`;
  if (f.k === 'settlement') return `<label class="field">${esc(f.label)} ${tag}<select data-act="ui" data-k="ctrSettle" aria-label="${esc(f.label)}"><option value="" ${entered ? '' : 'selected'}>Choose…</option>${f.options.map(([o, l]) => `<option value="${o}" ${v === o ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  return `<label class="field">${esc(f.label)} ${tag}<input type="number" step="any" data-act="econ" data-k="${KEY[f.k]}" value="${entered ? v : ''}" placeholder="not entered" aria-label="${esc(f.label)} (${esc(f.unit)})"><span class="audit-note">${esc(f.unit)} · from the ${esc(f.who)}</span></label>`;
}

/**
 * ctx = {S, node}; a = {rows: delivered hourly rows on the basis, n: year-equivalents, merchant: merchant energy $/yr,
 * mwh: MWh/yr, stackLabel, basisHub: Map(timestamp → hub $/MWh)}.
 */
export function contractCard(ctx, a) {
  const S = ctx.S, c = contractTerms(S);
  const r = contractSettlement(a.rows, c, t => (a.basisHub?.has(t) ? a.basisHub.get(t) : null));
  const per = v => (ok(v) ? v / a.n : null);
  const path = r.status === 'ok' ? contractPath(c, Math.max(c.tenorYears + 5, 10), { merchant: a.merchant, mwh: a.mwh, basis: per(r.basis) }) : [];
  const body = `<div class="form-grid">${CONTRACT_FIELDS.map(f => field(f, c)).join('')}</div>
    <p class="audit-note">Shape: ${esc(CONTRACT_SHAPE)}. Forward hub prices are not held; the hub basis comes from the applied price basis.</p>
    ${r.status === 'ok' ? table([{ k: 'l', l: 'Per year on the basis' }, { k: 'v', l: '$/yr', num: true, f: v => (ok(v) ? fmt.money(v) : null) }, { k: 'w', l: 'Working', wrap: true }], [
      { l: 'Contracted energy', v: per(r.ppaRevenue), w: `${fmt.int(per(r.contractedMWh))} MWh × $${c.ppaPrice}/MWh (year 1)` },
      { l: 'Merchant energy (uncontracted share)', v: per(r.merchantRevenue), w: `${100 - c.sharePct}% of delivered MWh at the node price` },
      ...(c.settlement === 'hub' ? [{ l: 'Hub basis on the contracted MWh', v: per(r.basis), w: 'share × Σ MWh × (node − hub), hour-matched' }] : []),
      { l: 'Contract case, energy', v: per(r.total), w: `vs merchant energy ${fmt.money(a.merchant)}/yr` },
    ]) : `<div class="empty"><strong>${r.status === 'not entered' ? 'Contract not entered' : 'Contract not held'}</strong>${esc(r.reason)}</div>`}
    ${path.length ? table([{ k: 'year', l: 'Operating year', num: true }, { k: 'value', l: 'Energy $/yr', num: true, f: v => (ok(v) ? fmt.money(v) : null) }, { k: 'kind', l: 'Basis' }], path) : ''}`;
  const answer = r.status === 'ok'
    ? `With ${B(`${c.sharePct}%`)} contracted at ${B(`$${c.ppaPrice}/MWh`)} (${esc(c.settlement === 'hub' ? 'hub-settled' : 'node-settled')}) for ${B(`${c.tenorYears} years`)}, energy is ${B(fmt.money(per(r.total)))}/yr against ${B(fmt.money(a.merchant))}/yr merchant; a merchant tail follows year ${esc(c.tenorYears)}.`
    : `No contract is entered: the revenue headline (${esc(a.stackLabel)}) is merchant. ${esc(r.reason)}`;
  return card(4, 'Contract (PPA)', 'your contract terms · no defaults · merchant until entered', body, { depth: 'screen', answer, foot: 'Contract terms are your inputs, never assumed. The headline above stays merchant; this card shows the contracted case beside it.' });
}
