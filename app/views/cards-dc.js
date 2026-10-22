// Data-centre (large-load) cards for the stages when fuel = datacenter. Markup only: every number comes from one
// dcFlow(...) result (rules/largeload.js), so a figure shown here and in the grid column is the same function's output.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, P2 slice S6) · 2026-10-06 · sign-off pending · v1
// Rules: every card carries the pending badge "pending §205 filing (due 2026-11-16, FERC EL26-72)" and the chip
// "pending"; no card shows generator-only content (export limit, energy revenue, capture, RECs, tax credits); a line
// that is not held says "not held" and why (null policy). The lead wires `stages` into Grid / Queue / Economics / Decision.
import { card, table, B } from './economics-charts.js';
import { fmt } from '../basis.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mw = v => fmt.mw(v), money = v => fmt.money(v);

/** Content a DC card must never show (generator-only screens). Exported for the test and for the lead's stage guard. */
export const GENERATOR_ONLY = [/export limit/i, /\binjection\b/i, /energy revenue/i, /capture (price|rate|ratio)/i, /\bPPA\b/, /\bRECs?\b/, /\bPfP\b/, /\bITC\b/, /\bPTC\b/, /cluster study completion/i];

const badgeHtml = p => `<p class="dc-pending"><span class="badge warn chip" data-pending="${esc(p.docket)}" title="${esc(`${p.src} · re-verify ${p.reverifyOn}`)}">${esc(p.text)}</span></p>`;
const chips = extra => ['pending', ...extra].join(' ');
const foot = (src, p) => `${esc(src)} · ${esc(p.text)}: the ISO-NE / PTO-AC proposal, not tariff; re-verify after ${esc(p.due)}.`;

/**
 * ctx: { rules, flow: dcFlow(...) result, node: {name, busId} }.
 * Returns { cards: {key: html}, list: [html...] (each once), stages: {grid, queue, economics, decision}: [html...] }.
 */
export function dcCards({ flow, node }) {
  const p = flow.pending, name = node?.name || `bus ${flow.bus}`;
  const s = flow.screen, w = flow.withdrawal, u = flow.upgrade, t = flow.transmission, st = flow.stack, tl = flow.timeline;

  const eligibility = card(6, 'Is this a large load?', `Proposed definition: ≥ ${s.thresholdMW} MW gross peak at ≥ ${s.thresholdKV} kV`,
    `${badgeHtml(p)}<ul class="dc-reasons">${s.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul><p class="audit-note">Co-located or electrically proximate load (same POI or substation as a generator) may qualify under ISO-NE's proposal; the terms come with the filing.</p>`,
    { depth: 'screen', chips: chips(s.pass === null ? ['not-held'] : []), answer: `${B(name)} at ${B(mw(flow.mw))}: ${B(s.verdict)}.`, foot: foot(s.src, p) });

  const wRows = w.table.map(r => ({ case: r.label, governing: r.governing, basis: r.basis, status: r.status }));
  const wAns = w.status === 'Fits firm' ? `${B(mw(w.firm.value))} firm (${esc(w.firm.caseLabel)}) covers the ${B(mw(flow.mw))} request.`
    : w.status === 'Non-firm only' ? `Firm withdrawal is ${B(mw(w.firm.value))}; the remaining ${B(mw(w.aboveFirmMW))} could only be served non-firm (curtailable) up to ${B(mw(w.nonFirm.value))}.`
      : w.status === 'Exceeds both' ? `The ${B(mw(flow.mw))} request exceeds both the firm (${B(mw(w.firm.value))}) and the non-firm indication (${B(mw(w.nonFirm.value))}).`
        : `Not established: ${esc(w.firm.why || w.nonFirm.why)}.`;
  const withdrawal = card(6, 'Withdrawal limit: firm and non-firm', 'Large-load and summer-peak charge cases · element study governs',
    `${badgeHtml(p)}${table([{ k: 'case', l: 'Withdrawal case' }, { k: 'governing', l: 'Governing MW', num: true, f: v => (ok(v) ? v.toFixed(1) : null) }, { k: 'basis', l: 'Basis', wrap: true }, { k: 'status', l: 'At the request' }], wRows)}
    ${table([{ k: 'l', l: 'Service' }, { k: 'v', l: 'MW', num: true, f: v => (ok(v) ? v.toFixed(1) : null) }, { k: 'why', l: 'Why', wrap: true }], [
      { l: 'Firm (FCDS): lowest case', v: w.firm.value, why: w.firm.why || `${w.firm.caseLabel}; every identified upgrade in service first` },
      { l: 'Non-firm (NFCDS / ICDS): highest case', v: w.nonFirm.value, why: w.nonFirm.why },
      { l: 'Above firm (curtailable)', v: w.aboveFirmMW, why: ok(w.aboveFirmMW) ? 'max(0, request − firm)' : 'Firm limit not established' }])}`,
    { depth: 'screen', chips: chips(ok(w.nonFirm.value) ? [] : ['not-held']), answer: wAns, foot: foot(w.firm.src, p) });

  const uAns = u.status === 'True zero' ? `No facility overloads below ${B(mw(flow.mw))} in either withdrawal case: no large-load upgrade for a CRA to recover.`
    : ok(u.total) ? `${B(`${u.status === 'Lower bound' ? '≥ ' : ''}${money(u.total * 1e6)}`)} of large-load network upgrades at ${B(mw(flow.mw))} (${esc(u.status)}).` : `Upgrade cost ${B('not held')}.`;
  const uRows = (u.items || []).map(i => ({ facility: i.label, case: i.case, limit: i.transfer, cost: i.cost }));
  const upgrade = card(6, 'Large-load upgrade cost (CRA basis)', `Union of ${u.cases.join(' + ')} · Grid › Upgrade cost rule`,
    `${badgeHtml(p)}${table([{ k: 'facility', l: 'Facility', wrap: true }, { k: 'case', l: 'Case' }, { k: 'limit', l: 'Overloads above MW', num: true, f: v => (ok(v) ? v.toFixed(1) : null) }, { k: 'cost', l: 'Cost', num: true, f: v => (ok(v) ? money(v * 1e6) : null) }], uRows, { empty: u.status === 'True zero' ? 'No facility overloads at this size.' : 'No priced facility list for this size.' })}
    <p class="audit-note">${[`CRA = ${flow.cra.formula}`, flow.cra.usd == null ? flow.cra.why : `${money(flow.cra.usd)}/yr`, flow.cra.notes[0]].map(x => esc(String(x).replace(/\.\s*$/, ''))).join('. ')}.</p>`,
    { depth: 'review', chips: chips(flow.cra.usd == null ? ['not-held'] : []), answer: uAns, foot: foot(u.src, p) });

  const tAns = ok(t.usd) ? `${B(t.service)}: ${B(`${money(t.usd)}/yr`)} (${esc(t.basis)} at ${fmt.price(t.rate)}/kW-yr, ${esc(t.rateYear)}). This replaces RNS; it is never added on top.` : `${B(t.code || 'Service')} charge ${B('not held')}: ${esc(t.why)}.`;
  const transmission = card(6, 'Transmission service charge', 'FCDS on contract MW · NFCDS / ICDS on monthly peaks · RNS-rated',
    `${badgeHtml(p)}${table([{ k: 'l', l: 'Charge' }, { k: 'v', l: '$/yr', num: true, f: v => (ok(v) ? money(v) : null) }, { k: 'why', l: 'Basis', wrap: true }], [
      { l: `${t.code || 'Service'} charge`, v: t.usd, why: t.why || t.basis },
      { l: 'Schedule 1', v: t.schedule1.usd, why: t.schedule1.why }])}`,
    { depth: 'review', chips: chips(ok(t.usd) ? [] : ['not-held']), answer: tAns, foot: foot(t.src, p) });

  const sRows = st.lines.map(l => ({ label: l.label, usd: l.usd, status: ok(l.usd) ? l.ruleStatus : 'not held', why: l.why }));
  const sAns = ok(st.heldTotal) ? `Held lines total ${B(`${st.bound === 'lower' ? '≥ ' : ''}${money(st.heldTotal)}/yr`)}${ok(st.perMWh) ? ` (${B(`${st.bound === 'lower' ? '≥ ' : ''}${fmt.price(st.perMWh)}/MWh`)})` : ''}; ${B(String(st.notHeld))} of ${st.lines.length} lines are not held, so this is a lower bound.${w.status === 'Fits firm' ? '' : ` Conditional: the ${mw(flow.mw)} request does not fit the firm withdrawal limit (${esc(w.status)}).`}` : 'No line of the cost stack is held.';
  const stack = card(12, 'Delivered cost stack (load)', 'Energy + capacity + transmission service + Schedule 1 + CRA + facilities + ancillary + local adders',
    `${badgeHtml(p)}${table([{ k: 'label', l: 'Line', wrap: true }, { k: 'usd', l: '$/yr', num: true, f: v => (ok(v) ? money(v) : null) }, { k: 'status', l: 'Status' }, { k: 'why', l: 'Basis / why not held', wrap: true }], sRows)}`,
    { depth: 'screen', chips: chips(st.bound === 'lower' ? ['not-held'] : []), answer: sAns, foot: foot('R3 §3.4 (replaces GAPS 4.12, which double counted RNS and FCDS)', p) });

  const tlRows = tl.steps.map(x => ({ step: x.step, days: x.days, date: x.date, why: x.why }));
  const timeline = card(6, 'Load energisation timeline', `${tl.service} · large-load study ${tl.studyDays} days (proposal)`,
    `${badgeHtml(p)}<div class="notice">${esc(tl.message)}</div>${table([{ k: 'step', l: 'Step', wrap: true }, { k: 'days', l: 'Days', num: true, f: v => (ok(v) ? String(v) : null) }, { k: 'date', l: 'Date', f: v => v || null }, { k: 'why', l: 'Basis / why not held', wrap: true }], tlRows)}`,
    { depth: 'screen', chips: chips(['not-held']), answer: `Study done ${B(tl.studyDone || 'not held')}; energisation ${B('not held')}: ${esc(tl.energisation.why)}.`, foot: foot(tl.steps[0].src, p) });

  const svcRows = (flow.services || []).map(r => ({ ...r, _cls: r.code === flow.service ? 'hl' : '' }));
  const services = card(6, 'Service options: FCDS, NFCDS, ICDS', 'Proposed large-load transmission services',
    `${badgeHtml(p)}${table([{ k: 'code', l: 'Service' }, { k: 'firm', l: 'Firm', f: v => (v ? 'yes' : 'no') }, { k: 'text', l: 'Terms', wrap: true }], svcRows)}`,
    { depth: 'review', chips: chips([]), answer: `Chosen: ${B(flow.service)}. A point of delivery cannot be split across services.`, foot: foot(flow.citations.find(c => c.path === 'large_load.services')?.src, p) });

  const cRows = flow.citations.map(c => ({ label: c.label, status: c.status, src: c.src }));
  const rules = card(12, 'Large-load rules behind these cards', `FERC ${p.docket} · response due ${p.due} · re-verify ${p.reverifyOn}`,
    `${badgeHtml(p)}${table([{ k: 'label', l: 'Rule' }, { k: 'status', l: 'Status' }, { k: 'src', l: 'Source', wrap: true }], cRows)}`,
    { depth: 'review', chips: chips([]), answer: `${B(String(cRows.filter(c => c.status === 'pending').length))} of ${cRows.length} rules are pending the §205 filing; nothing was filed as of the research date.`, foot: foot('REGISTER §5; R3 D1-D9', p) });

  const cards = { eligibility, withdrawal, upgrade, transmission, stack, timeline, services, rules };
  return { cards, list: Object.values(cards),
    stages: { grid: [eligibility, withdrawal, upgrade], queue: [services, timeline], economics: [stack, transmission], decision: [eligibility, rules] } };
}
