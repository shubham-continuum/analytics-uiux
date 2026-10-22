// Decision › Compare: the per-fuel verdict (decisioncore.fuelVerdict) per option, and the thresholds it reads.
// Defaults are visible and labelled "assumption" (or "derived" for the data-centre price mean); a user entry overrides
// and is labelled "your input". Unknown never passes: a test whose input is not held Holds.
import { fuelVerdict, FUEL_TESTS } from '../decisioncore.js';
import { thresholdRows } from '../decisionpack.js';
import { OPT } from './decision-charts.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const SRC_PILL = { 'your input': '', assumption: 'warn', derived: '', 'not held': 'bad', 'not set: open decision': 'warn' };
const verdictBg = v => ({ Pass: 'background:var(--ok-bg)', Hold: 'background:var(--warn-bg)', Fail: 'background:var(--bad-bg)' }[v] || '');
export const FUEL_NAME = { solar: 'solar', wind: 'wind', storage: 'storage', hybrid: 'solar + storage', datacenter: 'data centre (load)' };

/** A value in its threshold's unit. */
export function fmtUnit(v, unit) {
  if (!ok(v)) return 'not held';
  if (unit === '%') return `${v.toFixed(1)}%`;
  if (unit === '$/MWh') return `$${v.toFixed(2)}`;
  if (unit === 'lines') return String(Math.round(v));
  return v.toFixed(2);
}

/** Verdict rows per option: [[{test, label, unit, value, threshold, verdict, why, bases?}]]; a metrics error Holds every test. */
export function verdictsFor(ms, tech, th) {
  return ms.map(m => {
    const v = fuelVerdict(m.fuel || {}, tech, th);
    return m.fuel?.reason ? v.map(r => ({ ...r, why: `${m.fuel.reason}. ${r.why}` })) : v;
  });
}

const baseText = r => (r.bases ? r.bases.map(b => `${b.basis} ${ok(b.ratio) ? `${(100 * b.ratio).toFixed(1)}%` : 'not held'}`).join(' · ') : null);

/** The verdict table: one row per test, one column per option. */
export function verdictTable(ms, vs, tech, th) {
  const keys = FUEL_TESTS[tech] || [];
  if (!keys.length) return '<div class="empty"><strong>No per-fuel test</strong>This technology has no per-fuel test defined.</div>';
  const rows = thresholdRows(th, keys);
  return `<div class="table-wrap"><table class="dense"><thead><tr><th>Test</th><th class="num">Threshold</th>${ms.map((m, i) => `<th><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${OPT[i]};margin-right:4px"></i>${esc(m.node.name)}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r, ti) => `<tr><td>${esc(r.label)}</td><td class="num">${esc(fmtUnit(r.value, r.unit))}<br><span class="pill ${SRC_PILL[r.sourceLabel] ?? ''}">${esc(r.sourceLabel)}</span></td>${vs.map(v => { const x = v[ti]; if (!x) return '<td>not held</td>'; const b = baseText(x); return `<td class="wrap" style="${verdictBg(x.verdict)}"><b>${esc(x.verdict)}${x.qualifier ? ` (${esc(x.qualifier)})` : ''}</b> ${esc(fmtUnit(x.value, x.unit))}${b ? `<br><span class="audit-note" style="margin:0">${esc(b)}</span>` : ''}<br><span class="audit-note" style="margin:0">${esc(x.why.length > 110 ? `${x.why.slice(0, 108)}…` : x.why)}</span></td>`; }).join('')}</tr>`).join('')}
    <tr><td><b>Tests passed</b></td><td></td>${vs.map(v => `<td><b>${v.filter(x => x.verdict === 'Pass').length} of ${v.length}</b> <span class="audit-note" style="margin:0">${v.filter(x => x.verdict === 'Hold').length} hold · ${v.filter(x => x.verdict === 'Fail').length} fail</span></td>`).join('')}</tr>
  </tbody></table></div>`;
}

/** Threshold editor: default, your value, the value in force and its label. Inputs write S.ui.dTh_<key> (shell 'ui'). */
export function thresholdEditor(th, tech, ui) {
  const keys = FUEL_TESTS[tech] || [];
  const rows = thresholdRows(th, keys);
  return `<div class="table-wrap"><table class="dense" data-nosort><thead><tr><th>Test</th><th class="num">Default</th><th class="num">Your value</th><th>In force</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td class="wrap" title="${esc(r.note)}">${esc(r.label)} <span class="audit-note" style="margin:0">${esc(r.unit)}</span></td><td class="num">${esc(fmtUnit(r.default, r.unit))}<br><span class="audit-note" style="margin:0">${r.key === 'dcPrice' ? (ok(r.default) ? 'derived' : 'not held') : r.source === 'not set' || (r.sourceLabel === 'your input' && !ok(r.default)) ? 'not set: open decision' : 'assumption'}</span></td><td class="num"><input type="number" step="any" style="width:76px" data-act="ui" data-k="dTh_${esc(r.key)}" value="${esc(ui?.[`dTh_${r.key}`] ?? '')}" placeholder="default" aria-label="Your threshold: ${esc(r.label)}"></td><td>${esc(fmtUnit(r.value, r.unit))} <span class="pill ${SRC_PILL[r.sourceLabel] ?? ''}">${esc(r.sourceLabel)}</span></td></tr>`).join('')}
  </tbody></table></div>`;
}

/** Thresholds as notes for the card footer (why each default is what it is). */
export const thresholdNotes = (th, tech) => thresholdRows(th, FUEL_TESTS[tech] || []).map(r => `${esc(r.label)} ${esc(fmtUnit(r.default, r.unit))}: ${esc(r.note)}`).join(' · ');
