// S5 render functions for Economics › Project finance and Decision: the OBBBA tax-credit gate card, the after-tax
// finance card with one-click labelled presets (F004), the Decision gate row, and the pure UI-state updaters the lead
// wires to data-act="tax" / data-act="fin-preset" / data-act="fin-s5". Numbers come from rules/finance.js + rules/tax.js
// (one home); this file only formats. A null renders "not held" with its reason, never $0.
// Provenance: Claude Opus 5.5 (S5 agent) · one-studio/design (T3, P2 slice S5) · 2026-10-06 · sign-off pending · v1
import { financeWithTax, presetList, citations as finCitations, FIELD_LABEL } from '../rules/finance.js';
import { taxGateHybrid, resolveTaxInputs, domesticContentThreshold, macrThreshold, GATE_LABEL } from '../rules/tax.js';
import { card, table, B } from './economics-charts.js';
import { fmt } from '../basis.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NH = 'not held';
const pctTxt = (v, dp = 1) => (ok(v) ? `${(100 * v).toFixed(dp)}%` : NH);
const usd = v => (ok(v) ? fmt.money(v) : NH);
const perMWh = v => (ok(v) ? `$${v.toFixed(2)}/MWh` : NH);
const STATE_CLS = { eligible: 'good', ineligible: 'bad', contingent: 'warn', review: 'warn', open: 'warn' };
const VERDICT = { eligible: 'Pass', ineligible: 'Fail', contingent: 'Hold', review: 'Hold', open: 'Hold' };
const KIND_PILL = { user: 'U', preset: 'Preset', sent: 'Sent', queue: 'Queue', assumption: 'Assumed', rule: 'Rule', off: 'Off', 'not held': 'NH' };
const pill = (kind, title = '') => `<span class="pill${kind === 'not held' ? ' nh' : kind === 'assumption' || kind === 'preset' ? ' warn' : ''}"${title ? ` title="${esc(title)}"` : ''}>${esc(KIND_PILL[kind] || kind)}</span>`;
const kpi = (label, value, note, nh = false) => `<div class="kpi${nh ? ' nh' : ''}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// ---------- UI state (pure; the lead's event handler calls these) ----------
/** S.ui.tax ← one form change. Dates YYYY-MM-DD, MACR entered in %, yes/no selects; an empty or invalid entry is removed (not held). */
export function taxUiUpdate(tax = {}, key, raw) {
  const next = { ...tax }, v = typeof raw === 'string' ? raw.trim() : raw;
  delete next[key];
  if (key === 'boc' || key === 'pis') { if (isDate(v)) next[key] = v; }
  else if (key === 'bocMethod') { if (v === 'physical_work' || v === 'five_pct') next[key] = v; }
  else if (key === 'pwa') { if (v === 'yes' || v === true) next.pwa = true; else if (v === 'no' || v === false) next.pwa = false; }
  else if (key === 'macr') { const n = Number(v); if (v !== '' && Number.isFinite(n) && n >= 0 && n <= 100) next.macr = n / 100; }
  else if (['ec', 'dc', 'taxpayerPFE'].includes(key)) { if (v === 'yes' || v === true) next[key] = true; }
  return next;
}
/** S.ui.fin ← preset pick or an S5 field change (capex, annualOM, discountRate, years, taxRate, inflation, tpItc, tpPtc, bonusElectOut). */
export function finUiUpdate(fin = {}, key, raw) {
  const next = { ...fin }, v = typeof raw === 'string' ? raw.trim() : raw, n = v === '' || v == null ? NaN : Number(v);
  if (key === 'preset') { if (presetList('solar').concat(presetList('wind'), presetList('storage')).some(p => p.id === v)) next.preset = v; else delete next.preset; return next; }
  if (key === 'bonusElectOut') { if (v === 'yes' || v === true) next.bonusElectOut = true; else delete next.bonusElectOut; return next; }
  if (key === 'tpItc' || key === 'tpPtc') { const m = key === 'tpItc' ? 'itc' : 'ptc', tp = { ...(next.transferPrice || {}) }; if (Number.isFinite(n) && n > 0 && n <= 1) tp[m] = n; else delete tp[m]; next.transferPrice = tp; return next; }
  if (Number.isFinite(n)) next[key] = n; else delete next[key];
  return next;
}

// ---------- the gate card ----------
function gateRows(model, ctx, R) {
  if (ctx.tech === 'hybrid') { const h = taxGateHybrid(resolveTaxInputs(model.uiTax, { ...ctx, tech: 'solar' }, R).input, R, 'solar'); return [['Solar part', h.generator], ['Storage part', h.storage]]; }
  return [[null, model.gate]];
}
function evidence(srcs, R) {
  const n = R.tax.notice_2025_42, items = [...new Set(srcs)].map(s => `<li>${esc(s)}</li>`);
  items.push(`<li>Notice 2025-42: ${esc(n.value)} · <span class="pill warn">${esc(n.status)}</span> (${esc(n.src)})</li>`);
  return `<details class="evidence"><summary>Evidence</summary><ul class="audit-note">${items.join('')}</ul></details>`;
}
function taxForm(model, R) {
  const tx = model.taxInput, pv = model.taxProv, t = R.tax;
  const field = (k, label, control, note) => `<label class="field">${esc(label)} ${pill(pv[k]?.kind || 'not held', pv[k]?.label)}${control}<span class="audit-note">${esc(note ?? pv[k]?.label ?? '')}</span></label>`;
  const date = k => `<input type="date" data-act="tax" data-k="${k}" value="${esc(tx[k] || '')}">`;
  const sel = (k, cur, opts) => `<select data-act="tax" data-k="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const yn = (k, cur) => sel(k, cur === true ? 'yes' : cur === false ? 'no' : '', [['', '—'], ['yes', 'Yes'], ['no', 'No']]);
  const dcPct = domesticContentThreshold(tx.boc, R);
  // The threshold shown even when the gate is decided before the MACR test (e.g. G7), from the BOC year or, with no start held, this year.
  const mYear = tx.boc ? Number(tx.boc.slice(0, 4)) : Number((tx.asOf || new Date().toISOString()).slice(0, 4));
  const mThr = model.gate.macr?.applies ? model.gate.macr.threshold : macrThreshold(tx.tech, mYear, R);
  const mNote = model.gate.macr?.applies ? `needs ≥ ${pctTxt(mThr, 0)} for construction beginning in ${model.gate.macr.year}${model.gate.macr.assumedYear ? ' (assumed this year: no start held)' : ''}`
    : ok(mThr) ? `needs ≥ ${pctTxt(mThr, 0)} for construction beginning in ${mYear}${tx.boc ? '' : ' (no start held)'}` : `not tested for construction before ${R.tax.material_assistance_thresholds.applies_from_boc}`;
  return `<div class="form-grid">
    ${field('boc', 'Construction start (BOC)', date('boc'), `cut-off for wind and solar: ${t.wind_solar_cutoffs.boc_by}`)}
    ${field('bocMethod', 'How construction began', sel('bocMethod', tx.bocMethod || '', [['', 'not entered'], ['physical_work', 'Physical work of a significant nature'], ['five_pct', '5% safe harbor']]))}
    ${field('pis', 'Placed in service (PIS)', date('pis'), pv.pis?.kind === 'queue' ? 'from the Queue COD; enter a date to override' : `PIS limb: on or before ${t.wind_solar_cutoffs.pis_by}`)}
    ${field('pwa', 'Prevailing wage and apprenticeship', yn('pwa', model.uiTax.pwa))}
    ${field('macr', 'Material-assistance cost ratio (%)', `<input type="number" min="0" max="100" step="any" data-act="tax" data-k="macr" value="${ok(tx.macr) ? +(100 * tx.macr).toFixed(4) : ''}" placeholder="enter">`, mNote)}
    ${field('ec', 'Energy community', yn('ec', model.uiTax.ec), `${pv.ec?.label}; ${t.credit_adders.energy_community.src}`)}
    ${field('dc', 'Domestic content', yn('dc', model.uiTax.dc), `${pv.dc?.label}${ok(dcPct) ? `; adjusted percentage ≥ ${pctTxt(dcPct, 0)} for this start` : ''}`)}
    ${field('taxpayerPFE', 'Taxpayer is a specified foreign entity', yn('taxpayerPFE', model.uiTax.taxpayerPFE))}
  </div>`;
}
function gateCard(model, ctx, R) {
  const rows = gateRows(model, ctx, R), r = model.rates;
  const one = ([part, g]) => `<p class="card-answer">${part ? `${esc(part)}: ` : ''}<span class="pill ${STATE_CLS[g.state]}">${esc(g.label)}</span>${g.row ? ` <span class="audit-note">row ${esc(g.row)}</span>` : ''}<br>${esc(g.reason)}</p>`;
  const rateLine = ok(r.itc) ? `Rate before the gate: ITC ${B(pctTxt(r.itc, 0))} of eligible basis${ok(r.ptc2026) ? `, or PTC ${B(`${(100 * r.ptc2026).toFixed(2)} ¢/kWh`)} (2026, ${R.tax.ptc_term_years.value} years)` : ' (storage: ITC only)'}${r.small ? '; under 1 MW ac takes the full rate' : r.full ? `; full rate on the ${model.taxProv.pwa.kind === 'assumption' ? 'assumed' : 'entered'} prevailing wage` : '; base rate (prevailing wage not met)'}.` : `Rate ${NH}: ${esc(r.reason)}.`;
  const srcs = rows.flatMap(([, g]) => g.src).concat([R.tax.itc_rate.src, R.tax.ptc_rate_2026.src]);
  return card(12, 'Tax credit eligibility (OBBBA gate)', 'IRC §45Y / §48E as amended by P.L. 119-21 · linked to the Queue COD', `${rows.map(one).join('')}<p class="audit-note">${rateLine}</p>${taxForm(model, R)}${evidence(srcs, R)}`,
    { depth: 'screen', trace: 's5-tax-gate', chips: 'rules · R3 §2', foot: 'Only an eligible gate counts the credit. Contingent, under review or not decided all count it at zero; the value it would add is shown beside the return.' });
}

// ---------- the finance card ----------
const VALUE_FMT = { capex: usd, annualOM: usd, discountRate: v => pctTxt(v, 2), years: v => (ok(v) ? `${v} years` : NH), taxRate: v => pctTxt(v, 2), inflation: v => pctTxt(v, 1) };
function provRows(model) {
  const i = model.input, p = model.prov, src = x => (x.kind === 'preset' ? `preset: ${x.label} · ${x.src} (${x.status})` : x.label);
  const rows = Object.keys(VALUE_FMT).map(k => ({ k: FIELD_LABEL[k], v: VALUE_FMT[k](i[k]), s: src(p[k]), _kind: p[k].kind }));
  rows.push({ k: FIELD_LABEL.energy, v: ok(i.mwh) ? `${fmt.int(i.mwh)} MWh` : NH, s: p.energy.kind === 'preset' ? `preset: ${p.energy.label}` : p.energy.label, _kind: p.energy.kind });
  rows.push({ k: FIELD_LABEL.revenue, v: usd(i.revenue), s: p.revenue.label, _kind: p.revenue.kind });
  rows.push({ k: FIELD_LABEL.transferPrice, v: `ITC ${i.transferPrice?.itc} · PTC ${i.transferPrice?.ptc}`, s: p.transferPrice.label, _kind: p.transferPrice.kind });
  rows.push({ k: FIELD_LABEL.bonus, v: i.bonus ? 'taken' : 'elected out', s: p.bonus.label, _kind: p.bonus.kind });
  rows.push({ k: 'Grid upgrades in capital', v: p.extraCapex.kind === 'not held' ? NH : usd(i.extraCapex), s: p.extraCapex.label, _kind: p.extraCapex.kind });
  return table([{ k: 'k', l: 'Input' }, { k: '_kind', l: 'Source kind', f: v => KIND_PILL[v] || v }, { k: 'v', l: 'Value', num: true }, { k: 's', l: 'Where it comes from', wrap: true }], rows);
}
function presetBar(model, ctx) {
  const list = presetList(ctx.tech);
  if (!list.length) return `<p class="audit-note">No labelled preset for ${esc(ctx.tech || 'this technology')}: enter the inputs.</p>`;
  return `<div class="preset-bar">${list.map(p => `<button class="tiny${model.preset?.id === p.id ? ' primary' : ''}" data-act="fin-preset" data-v="${esc(p.id)}" title="${esc(p.src)}">Use ${esc(p.label)}</button>`).join(' ')}</div>
    <p class="audit-note">Presets are references (NREL ATB 2025 national averages in 2023 $, no New England multiplier), not quotes. Every value they fill is labelled; an entry of your own replaces it.</p>`;
}
function financeCard(model, ctx, R) {
  const bar = presetBar(model, ctx);
  if (model.state === 'unsupported') return card(12, 'After-tax project finance', 'unlevered, after tax', `<div class="empty"><strong>${esc(model.reason)}</strong></div>`, { depth: 'screen' });
  if (model.state !== 'ok') {
    const miss = model.missing.map(k => FIELD_LABEL[k] || k);
    const answer = model.state === 'incomplete' ? `${B(String(miss.length))} input${miss.length > 1 ? 's are' : ' is'} ${NH} (${esc(miss.join(', '))}), so no return is computed. Pick a labelled preset for one-click values, or enter your own.` : `Not computed: ${esc(model.reason)}`;
    return card(12, 'After-tax project finance', 'unlevered, after tax · R3 §3', `${bar}${model.presetMismatch ? '<div class="notice warn">The picked preset is for another technology, so it is not used.</div>' : ''}${provRows(model)}`, { depth: 'screen', answer, trace: 's5-finance' });
  }
  const isSt = ctx.tech === 'storage', c = model.credit, rate = model.input.discountRate;
  const creditTxt = c.mode === 'none' ? GATE_LABEL[model.gate.state] : `${c.mode.toUpperCase()} at ${c.mode === 'itc' ? pctTxt(c.rate, 0) : `${(100 * c.rate).toFixed(2)} ¢/kWh (2026)`} × ${pctTxt(c.fraction, 0)} gate, sold at ${c.transferPrice}`;
  const kpis = `<div class="kpis">${kpi('After-tax NPV', usd(model.npv), ok(model.npv) ? `at ${pctTxt(rate, 2)}, unlevered` : model.npvReason, !ok(model.npv))}${kpi('IRR (after tax)', ok(model.irr) ? pctTxt(model.irr, 1) : ok(model.npv) ? 'not defined' : NH, ok(model.irr) ? 'project, unlevered' : 'needs revenue and one sign change', !ok(model.irr))}${isSt
    ? kpi('LCOS (after tax)', perMWh(model.lcos), ok(model.lcos) ? 'per MWh discharged, flat nominal' : model.lcosReason, !ok(model.lcos))
    : `${kpi('LCOE (after tax)', perMWh(model.lcoe), 'break-even flat price, NPV = 0 (R3 §3.4)', !ok(model.lcoe))}${kpi('LCOE (pre-tax, no credits)', perMWh(model.lcoePreTax), 'the Economics LCOE (lcoe.js), cross-check', !ok(model.lcoePreTax))}`}${kpi('Credit', c.mode === 'none' ? 'none' : `${usd(c.cash)}`, creditTxt)}</div>`;
  const alt = model.ifPass, altTxt = alt ? `${alt.kind === 'forgone' ? 'Credit forgone' : 'If the gate passes'}: with the ${alt.mode.toUpperCase()} at ${pctTxt(alt.fraction, 0)}, NPV would be ${B(usd(alt.npv))}${ok(alt.irr) ? `, IRR ${B(pctTxt(alt.irr, 1))}` : ''}${!isSt && ok(alt.lcoe) ? `, LCOE ${B(perMWh(alt.lcoe))}` : ''}${isSt && ok(alt.lcos) ? `, LCOS ${B(perMWh(alt.lcos))}` : ''}. Not counted in the return above.` : '';
  const modes = Object.entries(model.byMode), modeTxt = modes.length > 1 ? `Credit choice by higher NPV (R3 §3.2): ${modes.map(([m, x]) => `${m.toUpperCase()} ${usd(x.npv)}`).join(' vs ')}.` : '';
  const be = model.breakEven.length ? table([{ k: 'rate', l: 'Discount rate', f: v => pctTxt(v, 1) }, { k: 'capexPerKw', l: 'Max capital at NPV = 0', num: true, f: v => (ok(v) ? `$${fmt.int(v)}/kW` : null) }], model.breakEven) : `<p class="audit-note">Break-even capital needs revenue: ${NH}.</p>`;
  const notes = [
    'Taxes at the blended rate each year; a negative tax is a benefit used against other income (tax capacity assumed).',
    `O&M${ok(model.input.revenue) ? ' and revenue' : ''} escalate at ${pctTxt(model.input.inflation, 1)}/yr; the PTC escalates at ${pctTxt(R.tax.ptc_escalation.value, 1)}/yr (${R.tax.ptc_escalation.status}).`,
    `Depreciable basis = capital − ${R.tax.itc_basis_reduction.value} × ITC (${R.tax.itc_basis_reduction.src}).`,
  ];
  const answer = `${ok(model.npv) ? `After tax at ${B(pctTxt(rate, 2))} the project's NPV is ${B(usd(model.npv))}${ok(model.irr) ? `, IRR ${B(pctTxt(model.irr, 1))}` : ''}` : `NPV ${NH}: ${esc(model.npvReason)}`}${!isSt && ok(model.lcoe) ? `; break-even price ${B(perMWh(model.lcoe))}` : ''}. ${altTxt}`;
  const body = `${bar}${kpis}${modeTxt ? `<p class="audit-note">${esc(modeTxt)}</p>` : ''}<h4>Break-even capital</h4>${be}<h4>Inputs and where each comes from</h4>${provRows(model)}<ul class="audit-note">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>${evidence(finCitations(R).filter(x => x.key.startsWith('defaults')).map(x => `${x.key.replace('defaults_atb2025.', '')}: ${x.src} (${x.status})`), R)}`;
  return card(12, 'After-tax project finance', 'unlevered, after tax · credits, basis reduction, bonus / MACRS · R3 §3', body, { depth: 'screen', answer, trace: 's5-finance', chips: model.preset ? 'preset' : 'entered' });
}

/** {cards:[gate, finance], model}. ui = {fin: S.ui.fin, tax: S.ui.tax}; ctx = {tech, mw, queueCod, asOf, sent, upgradeCapex}. */
export function financeCards(ui = {}, ctx = {}, R) {
  const model = { ...financeWithTax(ui, ctx, R), uiTax: ui.tax || {} };
  return { cards: [gateCard(model, ctx, R), financeCard(model, ctx, R)], model };
}

/** Decision gate-matrix row in decisioncore's shape: {gate, verdict Pass|Hold|Fail, why, src, row}. */
export function decisionTaxGate(ui = {}, ctx = {}, R) {
  const g = financeWithTax(ui, ctx, R).gate;
  return { gate: 'Tax credit (45Y/48E)', verdict: VERDICT[g.state] || 'Hold', why: `${g.label}: ${g.reason}`, src: g.src, row: g.row };
}
