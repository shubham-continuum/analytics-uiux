// Queue rule widgets (S3): the profile switch, rule citation lines, the Cost-to-enter table and the site-control /
// F016 block. Every figure comes from ../rules/isone.js (rules/isone-2026.json); nothing here computes a tariff value.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S3) · 2026-10-06 · sign-off pending · v1
import * as RX from '../rules/isone.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const usd = v => (ok(v) ? `$${Math.round(v).toLocaleString('en-US')}` : 'not held');

/** "<src> · <status> · effective <date>" for a citation object (the line the Evidence tab and the cards share). */
export function citeLine(c) {
  if (!c) return '';
  return `<small class="rule-cite" data-rule-path="${esc(c.path || '')}">${esc(c.src)} · ${esc(c.status)}${c.effective ? ` · effective ${esc(c.effective)}` : ''}</small>`;
}

/** The process-profile switch: ISO-NE Schedule 22 (default) or the labelled federal pro forma. */
export function profileSwitch(S) {
  const cur = RX.normProfile(S.ui?.qProfile), p = RX.profileInfo(cur);
  const btn = (id, label) => `<button data-act="ui" data-k="qProfile" data-v="${id}" class="${cur === id ? 'active' : ''}" aria-pressed="${cur === id}">${esc(label)}</button>`;
  return `<div class="profile-switch"><div class="segmented seg-sm" role="group" aria-label="Process profile">${btn('isone', 'ISO-NE Schedule 22')}${btn('proforma', 'Pro forma (not ISO-NE)')}</div>
    <span class="pill${p.labelled ? ' warn' : ''}">${esc(p.label)}</span> ${citeLine(p.cite)}
    ${p.labelled ? '<div class="notice warn">Labelled fallback: the federal pro forma is not the rule ISO-NE runs. Use it only to compare with a transmission provider outside an RTO.</div>' : ''}</div>`;
}

/** Cost to enter: the parts with their cash/security form and citation, the total, and the headline citation. */
export function costToEnterBody(entry) {
  if (!entry || entry.status !== 'ok') return `<div class="notice">${esc(entry?.reason || 'not held')}</div>${entry?.cite ? `<p class="audit-note">${citeLine(entry.cite)}</p>` : ''}`;
  const rows = entry.parts.map(p => `<tr><td class="wrap">${esc(p.label)}</td><td class="num">${usd(p.value)}</td><td>${p.cash ? 'cash' : 'cash, letter of credit or surety bond'}</td><td class="wrap">${citeLine(p.cite)}</td></tr>`);
  rows.push(`<tr class="hi"><td><b>Total at request</b></td><td class="num"><b>${usd(entry.total)}</b></td><td><b>${usd(entry.cash)} cash</b></td><td></td></tr>`);
  return `<div class="table-wrap"><table class="dense"><thead><tr><th>Part</th><th class="num">Amount</th><th>Form</th><th>Rule</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
    <p class="rule-headline"><b>${esc(entry.text)}</b> · ${citeLine(entry.cite)}</p>`;
}

/**
 * Site control at the request, read from Land (F016): the gate verdict, the service type and the regulatory-limitation
 * flag that open the deposit in lieu (NRIS only), and both cash cases side by side when site control is not held.
 */
export function siteControlBody(S, q, qc) {
  const gate = qc.gate || RX.siteControlGate({ pct: q.sitePct, service: q.service, regulatoryLimitation: q.regulatoryLimitation, tech: q.tech, profile: q.profile });
  const svc = (v, label) => `<button data-act="ui" data-k="qService" data-v="${v}" class="${q.service === v ? 'active' : ''}" aria-pressed="${q.service === v}">${esc(label)}</button>`;
  const pill = gate.verdict === 'Pass' ? 'good' : gate.verdict === 'Fail' ? 'bad' : 'warn';
  const dil = RX.depositInLieu({ mw: q.mw, service: q.service, regulatoryLimitation: true, profile: q.profile });
  const lieuOk = q.profile === 'proforma' || q.service === 'NRIS';
  const cases = qc.ifDemonstrated ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Case</th><th class="num">Cash at request</th><th class="num">Total at request</th><th>Status</th></tr></thead><tbody>
      <tr${qc.path === 'site control' ? ' class="hi"' : ''}><td class="wrap">Site control demonstrated (${esc(gate.required)}%)</td><td class="num">${usd(qc.ifDemonstrated.cash)}</td><td class="num">${usd(qc.ifDemonstrated.total)}</td><td>${qc.path === 'site control' ? '<span class="pill good">in use</span>' : '<span class="pill">assumption, not Land\'s entry</span>'}</td></tr>
      <tr${qc.path === 'deposit in lieu' ? ' class="hi"' : ''}><td class="wrap">Deposit in lieu (${lieuOk ? 'regulatory limitation recorded' : 'NRIS only'})</td><td class="num">${qc.ifDepositInLieu ? usd(qc.ifDepositInLieu.cash) : dil.status === 'ok' ? usd(qc.ifDemonstrated.cash + dil.value) : 'n/a'}</td><td class="num">${qc.ifDepositInLieu ? usd(qc.ifDepositInLieu.total) : dil.status === 'ok' ? usd(qc.ifDemonstrated.total + dil.value) : 'n/a'}</td><td>${qc.path === 'deposit in lieu' ? '<span class="pill good">in use</span>' : `<span class="pill">${esc(dil.status === 'ok' ? 'needs a recorded regulatory limitation' : dil.reason)}</span>`}</td></tr>
    </tbody></table></div>` : '';
  return `<dl class="kv"><dt>Site control (Land)</dt><dd>${ok(q.sitePct) ? `${q.sitePct}% documented` : 'not held'} <span role="link" tabindex="0" class="clickable" data-act="goto" data-v="land" data-tab="permits">edit in Land ›</span></dd>
      <dt>Required at request</dt><dd>${ok(gate.required) ? `${gate.required}%` : 'not held'} ${citeLine(gate.cite)}</dd>
      <dt>Verdict</dt><dd><span class="pill ${pill}">${esc(gate.verdict)}</span> ${esc(gate.reason)}</dd></dl>
    ${q.profile === 'isone' ? `<div class="segmented seg-sm" role="group" aria-label="Interconnection service">${svc('CNRIS', 'CNRIS · capacity')}${svc('NRIS', 'NRIS · energy only')}</div>` : ''}
    <label class="inline-check"><input type="checkbox" data-act="q-flag" data-k="qRegLimit" ${q.regulatoryLimitation ? 'checked' : ''} ${lieuOk ? '' : 'disabled'}> A regulatory limitation prevents site control (deposit in lieu${dil.perMW ? `: ${usd(dil.perMW)}/MW, ${usd(dil.min)}–${usd(dil.max)}` : ''})</label>
    ${q.profile === 'isone' ? `<label class="inline-check"><input type="checkbox" data-act="q-flag" data-k="qNrisHeld" ${q.nrisHeld ? 'checked' : ''}> Request already holds NRIS (or converts NR → CNR): reduced study deposit</label>` : ''}
    ${cases}
    ${qc.status === 'blocked' ? `<div class="notice warn" role="status"><b>${esc(qc.reason)}.</b> Cash at request is not shown as a single figure until Land holds the site-control entry${q.profile === 'isone' ? ', or an NRIS request records a regulatory limitation' : ''}. The demonstrated case above is an assumption, named as such.</div>` : ''}
    <p class="audit-note">${citeLine(RX.cite(q.profile === 'proforma' ? 'interconnection.proforma.deposit_in_lieu_site_control' : 'interconnection.schedule22.deposit_in_lieu_site_control'))}. ${q.profile === 'isone' ? 'Permitting or siting issues are not regulatory limitations (ISO-NE technical notice 2025-06-02).' : ''}</p>`;
}

/** The "Assumptions" paragraph for the cash tab, written from the rules file. */
export function depositNarrative(profile) {
  const R = RX.getRules()?.interconnection;
  if (!R) return '<p>Rules file not loaded: no deposit rule is shown.</p>';
  if (RX.normProfile(profile) === 'proforma') {
    const t = R.proforma.study_deposit_tiers.tiers, st = R.proforma.readiness_stages;
    return `<p>Pro forma (labelled, not ISO-NE): fee ${usd(R.proforma.application_fee.value)}; study deposit ${usd(t[0].base)} + ${usd(t[0].per_mw)}/MW below ${t[0].below_mw} MW, ${usd(t[1].value)} below ${t[1].below_mw} MW, ${usd(t[2].value)} above; readiness ${R.proforma.readiness_deposit_initial.multiple_of_study_deposit} × study deposit, then totals of ${100 * st.restudy}% / ${100 * st.facilities_study}% / ${100 * st.lgia}% of network upgrades. Forfeit: the greater of the study deposit or the stage multiple.</p>`;
  }
  const s = R.schedule22, s3 = R.schedule23;
  return `<p>ISO-NE Schedule 22 (above ${s.small_generator_max_mw.value} MW): initial deposit ${usd(s.initial_deposit.value)} + study deposit ${usd(s.study_deposit.value)} (${usd(s.study_deposit.alt.value)} when the ${esc(s.study_deposit.alt.when)}), both cash; readiness deposit ${s.readiness_deposit_initial.multiple_of_study_deposit} × study deposit (cash, letter of credit or surety bond). Schedule 23 at or below: ${usd(s3.initial_deposit.value)} + ${usd(s3.study_deposit.value)} + ${s3.readiness_deposit_initial.multiple_of_study_deposit} × study deposit. Readiness then tops up to a total of ${100 * s.readiness_deposit_restudy.pct_of_network_upgrades}% of network upgrades within ${s.readiness_deposit_restudy.due_days} days of the cluster report meeting, ${100 * s.readiness_deposit_facilities_study.pct_of_network_upgrades}% at the facilities study, and ${100 * s.lgia_deposit.pct_of_network_upgrades}% at the LGIA (less what is already posted); it is never taken below what is posted (wording; release in practice unverifiable). Forfeit: the greater of the study deposit or ${s.withdrawal_penalty.study_cost_multiple} × allocated study cost / the stage multiple; none before the cluster study starts.</p>`;
}
