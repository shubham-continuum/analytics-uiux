// Economics revenue cards (S4): the revenue stack, the capacity price path by commitment period and Pay-for-Performance.
// Provenance: Claude Opus 5.5 (S4 agent) · one-studio/design (T3, slice S4) · 2026-10-06 · sign-off pending · v1
//
// Render-only: every number comes from rules/revenue.js (one home); this file formats it. Each stream shows its regime,
// its source and its value, or "not held" / "n/a" with the reason (never $0 for a missing value). The lead wires
// revenueCards() into Economics (see one-studio/design/progress/S4.md › Lead wiring); S4 does not edit economics views.
import { card } from './economics-charts.js';
import { fmt } from '../basis.js';
import { revenueStack } from '../rules/revenue.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const usd2 = v => `$${Number(v).toFixed(2)}`;
const BADGE = new Set(['pending', 'contingent', 'assumption', 'unverifiable']);
const badge = s => (BADGE.has(s) ? ` <span class="pill warn" title="rule status">${esc(s)}</span>` : '');
/** A value cell: a real number (a true zero prints $0.00), or the status words. */
function valueCell(s) {
  if (s.status === 'not_applicable') return '<span class="nh">n/a</span>';
  if (!ok(s.value)) return '<span class="nh">not held</span>';
  const v = s.value === 0 ? '$0.00' : esc(fmt.money(s.value));
  return `${v}/yr${s.status === 'conditional' ? ' <span class="pill warn">conditional</span>' : ''}`;
}
const tbl = (head, rows) => `<div class="table-wrap"><table class="dense"><thead><tr>${head.map(([l, num]) => `<th${num ? ' class="num"' : ''}>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

/** The revenue-stack card from revenueStack(R, inputs). */
export function revenueStackCard(stack, { span = 12 } = {}) {
  const rows = stack.streams.map(s => `<tr data-stream="${esc(s.id)}"><td><b>${esc(s.label)}</b></td><td class="wrap">${esc(s.regime)}${badge(s.ruleStatus)}</td><td class="num">${valueCell(s)}</td><td class="wrap">${esc(s.reason || '')}</td><td class="wrap src">${esc(s.src || 'not held')}</td></tr>`);
  const t = stack.total;
  const answer = `Held streams add to <b>${esc(fmt.money(t.firm))}/yr</b>${t.conditional ? `, plus <b>${esc(fmt.money(t.conditional))}/yr</b> conditional` : ''}. Not held: <b>${esc(t.notHeld.length ? t.notHeld.join(', ') : 'none')}</b>${t.notApplicable.length ? `; not applicable: ${esc(t.notApplicable.join(', '))}` : ''}.`;
  const body = tbl([['Stream'], ['Regime'], ['Value', true], ['Basis / why'], ['Source']], rows);
  return card(span, 'Revenue stack', 'each stream: regime, source, value or not held', body, { depth: 'review', trace: 'r-stack', chips: 'rules', answer,
    foot: 'ISO-NE rules from rules/isone-2026.json (R2, REGISTER). A missing input is shown as not held and is never counted as zero.' });
}

/** The capacity path card from capacityPath(R, opts). */
export function capacityPathCard(path, { span = 12, tools = '' } = {}) {
  if (!path.rows.length) return card(span, 'Capacity by commitment period', 'regime and price per CCP', `<div class="empty"><strong>Not held</strong>${esc(path.reason || '')}</div>`, { trace: 'r-capacity', tools });
  const price = r => (r.price == null ? 'not held' : typeof r.price === 'object' ? `${usd2(r.price.summer)} summer · ${usd2(r.price.winter)} winter (MRIC)` : usd2(r.price));
  const mwA = r => (r.mwAccredited == null ? 'not held' : typeof r.mwAccredited === 'object' ? `${r.mwAccredited.summer.toFixed(1)} / ${r.mwAccredited.winter.toFixed(1)} MW (S/W)` : `${r.mwAccredited.toFixed(1)} MW`);
  const rows = path.rows.map(r => `<tr data-ccp="${esc(r.ccp)}"><td>${esc(r.ccp)}</td><td class="wrap">${esc(r.regime)}${r.conditional ? ' <span class="pill warn">conditional</span>' : ''}</td><td class="wrap">${esc(r.accreditation.label)}${badge(r.accreditation.status)}</td><td class="num">${esc(mwA(r))}</td><td class="num">${esc(price(r))}<br><span class="audit-note">${esc(r.priceTag || '')}</span></td><td class="num">${r.monthsOn}</td><td class="num">${ok(r.revenue) ? esc(fmt.money(r.revenue)) : '<span class="nh">not held</span>'}</td><td class="wrap">${esc(r.reason || '')}</td></tr>`);
  const hist = path.history.map(h => `${esc(h.priceTag)}: ${h.price != null ? usd2(h.price) : Object.entries(h.zones).map(([z, v]) => `${esc(z.replace('_', '+'))} ${usd2(v)}`).join(', ')}`).join(' · ');
  const answer = `No forward capacity price exists after FCA 18. Each period below carries its own regime and price. ${esc(path.prefill.label)}${path.note ? ` ${esc(path.note)}` : ''}`;
  const body = `${tbl([['CCP'], ['Regime'], ['Accreditation'], ['Accredited', true], ['Price $/kW-mo', true], ['Months', true], ['Revenue', true], ['Note']], rows)}
    <p class="audit-note">Cleared history (history only, $/kW-mo): ${hist}.</p>`;
  return card(span, 'Capacity by commitment period', `regime: ${path.regime === 'mric' ? 'CAR-SA (MRIC, pending)' : 'current rule (QC)'} · price: user path (D3)`, body,
    { depth: 'review', trace: 'r-capacity', chips: 'rules assumption', tools, answer, foot: `Calendar: ${esc(path.rows[0].regimeSrc)}. Totals: ${esc(fmt.money(path.totals.firm))} firm, ${esc(fmt.money(path.totals.conditional))} conditional.` });
}

/** The Pay-for-Performance card from pfpReplay(R, opts). */
export function pfpCard(pf, { span = 12 } = {}) {
  if (pf.status !== 'ok') {
    return card(span, 'Pay-for-Performance', 'historical CSCs × expected output', `<div class="empty"><strong>Expected PfP not held</strong>${esc(pf.reason)}</div>`, { depth: 'review', trace: 'r-pfp', chips: 'rules' });
  }
  const rows = pf.events.map(e => `<tr><td>${esc(e.date)} ${esc(e.window)}</td><td class="num">${e.intervals}${e.mismatch ? ` (weighted to ${e.weightTotal})` : ''}</td><td class="num">${e.br}${e.brUsed !== e.br ? ` → ${e.brUsed}` : ''}</td><td class="num">${ok(e.meanOutput) ? `${e.meanOutput.toFixed(1)} MW` : 'not held'}</td><td class="num">${esc(fmt.money(e.payment))}</td><td>${e.capped ? '<span class="pill warn">stop-loss</span>' : ''}</td></tr>`);
  const perKw = v => (ok(v) ? `${usd2(v)}/kW-yr` : 'not held');
  const answer = `Expected PfP <b>${esc(fmt.money(pf.annual))}/yr</b> (${esc(perKw(pf.perKwYr))}) over ${pf.years} years of record; ${esc(pf.recent.n)} events since ${esc(pf.recent.from)} give ${esc(fmt.money(pf.recent.annual))}/yr (${esc(perKw(pf.recent.perKwYr))}). Replayed at today's PPR $${pf.ppr.toLocaleString('en-US')}/MWh, not the rate in force at each event.`;
  const body = `${tbl([['CSC (5-min labels)'], ['Intervals', true], ['BR', true], ['Mean output', true], ['PfP', true], ['']], rows)}
    <p class="audit-note">Output: ${esc(pf.outputLabel)}. Stop-loss: ${esc(pf.stopLossSrc)}${pf.annualFloor != null ? `; annual floor ${esc(fmt.money(pf.annualFloor))}` : '; annual floor needs a capacity price'}. ${esc(pf.stopLossNote || '')}</p>`;
  return card(span, 'Pay-for-Performance', 'historical CSCs × expected output, with stop-loss', body,
    { depth: 'review', trace: 'r-pfp', chips: 'rules', answer, foot: `PPR: ${esc(pf.pprSrc)}. BR cap: ${esc(pf.brCapSrc)}. Events: ${esc(pf.src)}.` });
}

// ---- controls: S.ui keys capRegime ('qc'|'mric'), capBand ('low'|'mid'|'high'), capMric ($/kW-mo of MRIC), fca18Cso (bool) ----
/** The capacity options from S.ui (strings from the 'ui' action) → capacityPath / revenueStack options. */
export function revenueUiOpts(ui = {}) {
  const m = ui.capMric === '' || ui.capMric == null ? null : Number(ui.capMric);
  return { regime: ui.capRegime === 'mric' ? 'mric' : 'qc', band: ['low', 'mid', 'high'].includes(ui.capBand) ? ui.capBand : 'low', mricPrice: ok(m) && m >= 0 ? m : null, fca18Cso: ui.fca18Cso === true };
}
const sel = (k, cur, opts, label) => `<select data-act="ui" data-k="${k}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(cur) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
/** Card tools for the capacity path (wired through the existing 'ui' and 'q-flag' actions in app.js). */
export function revenueTools(ui = {}) {
  const o = revenueUiOpts(ui);
  return `${sel('capRegime', o.regime, [['qc', 'Current rule (QC)'], ['mric', 'CAR-SA (MRIC, pending)']], 'Accreditation regime')}${sel('capBand', o.band, [['low', 'Prefill: last FCA clear'], ['mid', 'Prefill: reconfiguration clears'], ['high', 'Prefill: peak MRA']], 'Price-path prefill')}${o.regime === 'mric' ? `<input type="number" step="0.01" min="0" data-act="ui" data-k="capMric" value="${o.mricPrice ?? ''}" placeholder="$/kW-mo MRIC" aria-label="CAR-SA price, $/kW-month of MRIC">` : ''}<label class="inline-check"><input type="checkbox" data-act="q-flag" data-k="fca18Cso"${o.fca18Cso ? ' checked' : ''}> On the FCA 18 results list</label>`;
}

/** All three cards for one input set (revenueStack inputs); ui = S.ui adds the capacity tools and options. */
export function revenueCards(R, inputs, ui = null) {
  const st = revenueStack(R, ui ? { ...inputs, ...revenueUiOpts(ui) } : inputs), cap = st.streams.find(s => s.id === 'capacity'), pf = st.streams.find(s => s.id === 'pfp');
  return revenueStackCard(st) + capacityPathCard(cap.path, { tools: ui ? revenueTools(ui) : '' }) + pfpCard(pf.pfp || { status: 'missing', reason: pf.reason });
}
