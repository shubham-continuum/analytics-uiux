// Queue v5 traces: request ÷ limit ratios on the fuel's own direction, the service-type (CNR / NR) mix, and the
// withdrawal-penalty exemptions. Checks re-derive the figure with this file's own code.
import { trace } from '../trace.js';
import { fmt } from '../basis.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const pct = v => (ok(v) ? `${(100 * v).toFixed(1)}%` : 'not held');
const n1 = v => (ok(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : 'not held');

/**
 * Ratios per direction: (MW ahead + request) ÷ limit for export; request ÷ limit for import (load or charge).
 * ahead = queuecore.queueAhead() (P2 C30). With it the trace runs METHOD checks, not a re-run of the same formula:
 * no summer-modelled MW (already inside the solved-case limit) and no withdrawn MW may be counted ahead, and the
 * counted rows must sum to the MW the ratio used.
 */
export function traceRatios(tech, ratios, R, ahead = null) {
  const own = ratios.map(r => (ok(r.limit) && ok(r.mw) ? ((r.nearby ?? 0) + r.mw) / r.limit : null));
  const held = ratios.filter((r, i) => ok(own[i]) && ok(r.value));
  const counted = (ahead?.rows || []).filter(x => x.counted), mwOf = xs => xs.reduce((t, x) => t + (ok(x.mw) ? x.mw : 0), 0);
  const ex = ratios.find(r => r.dir === 'export');
  const method = ahead ? [
    { label: 'Method check: summer-modelled MW counted ahead (must be 0: it is already in the solved-case limit)', a: mwOf(counted.filter(x => !(x.q?.summer_mw_modelled === 0))), b: 0, atol: 1e-9, fmt: v => `${n1(v)} MW` },
    { label: 'Method check: withdrawn MW counted ahead (must be 0)', a: mwOf(counted.filter(x => x.now === 'W')), b: 0, atol: 1e-9, fmt: v => `${n1(v)} MW` },
    ...(ex && ok(ex.nearby) ? [{ label: 'Consistency check: counted rows sum to the MW ahead the export ratio used', a: mwOf(counted), b: ex.nearby, atol: 1e-9, fmt: v => `${n1(v)} MW` }] : []),
  ] : [];
  const checks = [...method, ...held.map(r => ({ label: `Arithmetic re-check: ${r.dir} ratio`, a: own[ratios.indexOf(r)], b: r.value, tol: 1e-12, fmt: pct }))];
  return trace({
    id: 'q-ratio', title: tech === 'datacenter' ? 'Load ratio (import request ÷ import limit)' : 'Request ratios against the connection limits',
    formula: 'export: (MW ahead within the radius: not in the solved summer case and not withdrawn + this project) ÷ binding export limit;  import (load / charge): request ÷ binding import limit (nearby generators never added)',
    inputs: ratios.flatMap(r => [{ name: `${r.dir} request`, value: fmt.mw(r.mw), source: 'user' }, { name: `${r.dir} limit`, value: ok(r.limit) ? fmt.mw(r.limit) : 'not held', source: 'derived', note: `Grid rules on the fuel's own cases · ${r.status}${r.row ? ` · ${r.row.label}` : ''}` },
      ...(r.dir === 'export' ? [{ name: `MW ahead within ${R} mi`, value: fmt.mw(r.nearby), source: 'measured', note: ahead ? `unified dim_queue, not in the solved summer case${ahead.statusChecked ? ', not withdrawn in the register' : ' (withdrawal not checked)'}; distance only (not a study)` : 'unified dim_queue, distance only (not a study)' }] : [])]),
    steps: ratios.map(r => ({ label: r.label, work: ok(r.limit) && ok(r.mw) ? `(${n1(r.nearby ?? 0)} + ${n1(r.mw)}) ÷ ${n1(r.limit)}` : 'limit or request not held', value: pct(r.value) })),
    result: { label: ratios[0]?.label || 'Ratio', value: pct(ratios[0]?.value) },
    checks: checks.length ? checks : undefined,
    notes: held.length ? ['Distance arithmetic, not a study: nearby requests are not shown to load the same facilities.', ...(ahead && ok(ahead.notHeldMW) && ahead.notHeldMW > 0 ? [`${n1(ahead.notHeldMW)} MW within the radius has no summer study status: reported, not added.`] : [])] : ['No check possible: no direction has both a request and a held limit.'],
  });
}

/** Service-type mix: requested MW by CNR / NR / other / not stated, nearby study set and the register within the radius. */
export function traceServiceMix(groups, rows, R) {
  const recount = groups.map(g => rows.filter(r => r.group === g).reduce((a, r) => a + (ok(r.mw) ? r.mw : 0), 0));
  const total = rows.reduce((a, r) => a + (ok(r.mw) ? r.mw : 0), 0);
  return trace({
    id: 'q-service', title: `Interconnection service requested within ${R} mi`,
    formula: 'MW_g = Σ requested MW of records whose service code maps to group g (CNR = capacity, NR = energy-only; other codes as published; blank / NA = not stated)',
    inputs: [{ name: 'Records', value: String(rows.length), source: 'measured', note: 'unified dim_queue interconnection_service_requested + public register "serv"' }, { name: 'Radius', value: `${R} mi`, source: 'user' }],
    steps: groups.map((g, i) => ({ label: g, work: `${rows.filter(r => r.group === g).length} record(s)`, value: `${n1(recount[i])} MW` })),
    result: { label: 'CNR share of MW', value: total > 0 ? pct(recount[0] / total) : 'not held' },
    check: { label: 'Consistency check: group MW sum to the total', a: recount.reduce((a, v) => a + v, 0), b: total, atol: 1e-9, fmt: v => `${n1(v)} MW` },
    notes: ['A request\'s service type is what the applicant asked for; CNR requests can auto-downgrade to NR (workspace research note, not in the vault).'],
    csv: { name: 'queue-service-mix.csv', columns: ['source', 'id', 'service_code', 'group', 'mw'], rows: rows.map(r => [r.src, r.id, r.code, r.group, r.mw]) },
  });
}

/** Withdrawal-penalty exemptions (Sched 22 §3.7.1.1: > 25% on a Cluster Restudy Report only; > 100% facilities vs cluster study). */
export function traceExemptions(ex) {
  const own = ex.map(e => (ok(e.from) && e.from > 0 && ok(e.to) ? e.to / e.from - 1 : null));
  const held = ex.filter((e, i) => ok(own[i]));
  return trace({
    id: 'q-exempt', title: 'Withdrawal-penalty exemptions',
    formula: 'increase = cost_now ÷ cost_before − 1;  exempt if more than 25% on a Cluster Restudy Report vs the preceding report, or more than 100% at the facilities study vs the cluster study / restudy',
    inputs: ex.flatMap(e => [{ name: `${e.test}: before`, value: ok(e.from) ? `$${e.from}M` : 'not set', source: 'user' }, { name: `${e.test}: now`, value: ok(e.to) ? `$${e.to}M` : 'not set', source: 'user' }]).concat([{ name: 'Thresholds', value: ex.map(e => (e.threshold == null ? 'not held' : (100 * e.threshold).toFixed(0) + '%')).join(' · '), source: 'rule', note: ex[0]?.cite?.text || 'not held' }]),
    steps: ex.map((e, i) => ({ label: e.test, work: ok(own[i]) ? `${e.to} ÷ ${e.from} − 1 = ${pct(own[i])} (${e.op} ${pct(e.threshold)})` : 'a cost is not set', value: e.exempt == null ? 'not held' : e.exempt ? 'exempt' : 'not exempt' })),
    result: { label: 'Exempt', value: ex.some(e => e.exempt) ? 'yes' : ex.every(e => e.exempt === false) ? 'no' : 'not held' },
    checks: held.length ? held.map(e => ({ label: `Arithmetic re-check: ${e.test}`, a: own[ex.indexOf(e)], b: e.increase, tol: 1e-12, fmt: pct })) : undefined,
    notes: held.length ? ['The materiality screen (does the withdrawal affect equal- or lower-queued requests) applies first; its ISO-NE text is not held.'] : ['No check possible: enter the before and after network-upgrade costs to test an exemption.'],
  });
}
