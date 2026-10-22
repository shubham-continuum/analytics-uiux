// Calculation traces for Grid (v2 after the all-bus review). Independent checks, written here with their own
// code rather than calling gridrules:
//  · every facility row of the shown cases: stored transfer vs the linear recompute on the row's own basis
//    (base case: rate A with base flow; contingency: rate C with post-contingency flow). A stored limit ABOVE the
//    recompute (optimistic) fails; one below it (conservative, typically transformers screened on MVA) is counted.
//  · binding export and import limits re-derived from the raw rows and the raw headroom table;
//  · the upgrade-cost union re-derived from the raw rows.
import { trace } from '../trace.js';
import { CASE_LABEL, applicableCases, costCases, STUDY_VINTAGE, SET_LABEL, facilityKey, chargeMW } from '../gridrules.js';
import { fmt } from '../basis.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const n1 = v => (ok(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : 'not held');
const n3 = v => (ok(v) ? v.toFixed(3) : 'not held');
const musd = v => (ok(v) ? `$${v.toFixed(2)}M` : 'not held');
const mwCheck = v => (ok(v) ? `${v.toFixed(1)} MW` : 'not held');
const fac = r => (r.monitored_facility || '').trim();
// C11: one physical facility (reversed ends, 3-winding legs on one star point), the identity the cost engine unions on.
const fkey = r => facilityKey(r.monitored_facility, r.facility_type);
const rowsFor = (grid, bus, key) => { const [sc, dir] = key.split('|'); return grid.constraints.filter(r => String(r.bus_id) === String(bus) && r.scenario === sc && r.direction === dir); };
const isPre = r => (ok(r.pct_loading_no_transfer) && Math.abs(r.pct_loading_no_transfer) >= 100) || (ok(r.transfer_mw) && r.transfer_mw < 0);
// Own copy of the screening basis (independent of gridrules.loadingBasis).
const basisOf = r => (r.contingency_id === 0 || r.contingency_flow_mw == null ? { rate: 'A', flow: r.base_flow_mw, rating: r.rating_a_mva } : { rate: 'C', flow: r.contingency_flow_mw, rating: r.rating_c_mva });
const recompute = r => { const b = basisOf(r); return ok(b.rating) && ok(b.flow) && ok(r.dfax) && r.dfax > 0 ? (b.rating - b.flow) / r.dfax : null; };
const loadAt = (r, mw) => { const b = basisOf(r); return ok(b.rating) && b.rating > 0 && ok(b.flow) && ok(r.dfax) && ok(mw) ? (100 * Math.abs(b.flow + r.dfax * mw)) / b.rating : null; };
// Flows and ratings are stored to 0.1 MW, sensitivity to 5 decimals: rounding alone moves the recompute by up to this.
const bound = r => (0.1 + Math.abs(r.transfer_mw) * 5e-6) / Math.abs(r.dfax) + 0.05;
const ownCost = r => (!ok(r.fix_cost_musd) || (r.fix_cost_musd === 0 && !(ok(r.length_miles) && r.length_miles > 0)) ? null : r.fix_cost_musd);

/** Row-wide data audit over the given cases: optimistic rows (fail) and conservative rows (counted). */
function audit(grid, bus, keys) {
  let checked = 0, optimistic = 0, conservative = 0, notHeld = 0; const worst = [];
  for (const k of keys) for (const r of rowsFor(grid, bus, k)) {
    if (!ok(r.transfer_mw) || /no violations/i.test(fac(r))) continue;
    const t = recompute(r); if (t == null) { notHeld++; continue; }
    checked++; const d = r.transfer_mw - t;
    if (d > bound(r)) { optimistic++; worst.push(`${fac(r)} stored ${n1(r.transfer_mw)} vs ${n1(t)} MW`); } else if (d < -bound(r)) conservative++;
  }
  return { checked, optimistic, conservative, notHeld, worst };
}
function ownEnvelope(grid, bus, key) { const [sc, dir] = key.split('|'); const r = grid.headroom.find(h => String(h.bus_id) === String(bus) && h.scenario === sc && h.direction === dir); return r && ok(r.headroom_mw) ? r.headroom_mw : null; }
/** Own derivation of a case's governing value: element limit from raw rows, else the raw envelope; hold = Hold. */
function ownGoverning(grid, bus, key) {
  const rs = key === 'shoulder|discharge' ? [] : rowsFor(grid, bus, key);
  if (rs.some(r => /no violations/i.test(fac(r)))) return { v: null, hold: true };
  if (rs.length) { const c = rs.filter(r => !isPre(r) && ok(r.transfer_mw) && r.transfer_mw > 0); return c.length ? { v: Math.min(...c.map(r => r.transfer_mw)), el: true } : { v: null, hold: true }; }
  return { v: ownEnvelope(grid, bus, key) };
}
/** C03: with an element breach at mw, the binding value is the lowest element limit (the breaching row), never a lower
 *  envelope from another case; otherwise the lowest governing value. */
function ownBinding(grid, bus, keys, mw = null) {
  const g = keys.map(k => ownGoverning(grid, bus, k));
  if (g.some(x => x.hold)) return null;
  const breach = ok(mw) && mw > 0 ? g.filter(x => x.el && ok(x.v) && x.v < mw).map(x => x.v) : [];
  const held = (breach.length ? breach : g.map(x => x.v)).filter(ok);
  return held.length ? Math.min(...held) : null;
}

const csvFacilities = (grid, bus, keys, req) => ({
  name: `grid-facilities-${bus}.csv`,
  meta: [['bus', bus], ['source', `unified ISONE_GridSense_unified.duckdb · fact_limiting_element (study ${STUDY_VINTAGE})`], ['rule', 'base-case rows: rate A with base flow; contingency rows: rate C with post-contingency flow; transfer = (rating − flow) ÷ sensitivity; loading = |flow + sensitivity × MW| ÷ rating'], ['cost', 'a $0 cost on a zero-length facility is not held']],
  columns: ['case', 'facility', 'contingency', 'screened_on', 'rating_mva', 'flow_mw', 'sensitivity_mw_per_mw', 'transfer_mw_stored', 'transfer_mw_recomputed', 'loading_before_pct', 'loading_at_request_pct', 'pre_existing', 'upgrade_cost_musd', 'length_miles'],
  rows: keys.flatMap(k => rowsFor(grid, bus, k).map(r => {
    const b = basisOf(r), mw = k.endsWith('discharge') ? req.exportMW : req.importMW;
    return [CASE_LABEL[k], fac(r), r.binding_contingency, b.rate === 'A' ? 'base case (rate A)' : 'contingency (rate C)', b.rating, b.flow, r.dfax, r.transfer_mw, recompute(r), r.pct_loading_no_transfer, mw > 0 ? loadAt(r, mw) : null, isPre(r) ? 'yes' : 'no', ownCost(r), r.length_miles];
  })),
});

/** Connection capacity: every applicable case, how its governing limit was chosen, and the binding ones. */
export function traceCapacity(data, S, node, table, ex, im) {
  const tech = S.tech === 'datacenter' ? 'datacenter' : S.tech, cases = applicableCases(tech), keys = [...cases.export, ...cases.import];
  const steps = table.map(r => {
    const el = r.element, n = el.rows?.length || 0, pre = el.pre?.length || 0;
    const work = el.status === 'held' ? `${n} facility rows, ${pre} pre-existing excluded; lowest positive transfer: ${el.facility} at ${fmt.mw(el.limit)}`
      : el.status === 'noViolation' ? 'study reports no violations, but the tested maximum is not published → Hold'
      : el.status === 'unpublished' ? `${n} rows, all pre-existing overloads → limit not published → Hold`
      : el.status === 'mislabel' ? `store rows are the large-load table under a shoulder label → not used; envelope ${fmt.mw(r.envelope)} (vendor-asserted)`
      : `no facility rows; envelope ${fmt.mw(r.envelope)} (vendor-asserted)`;
    return { label: r.label, work: `${work}. ${ok(r.margin) ? `Margin ${fmt.mw(r.governing)} − ${fmt.mw(r.requested)} = ${r.margin >= 0 ? '+' : '−'}${fmt.mw(Math.abs(r.margin))}` : ''}`, value: `${ok(r.governing) ? fmt.mw(r.governing) : '—'} · ${r.status}` };
  });
  steps.push({ label: 'Binding export limit', work: 'lowest governing value among requested export cases; any Hold case → Hold; a case resting on the envelope only → "Envelope only" (D6.1: context, never Fits)', value: ok(ex.value) ? `${fmt.mw(ex.value)} · ${ex.status}` : ex.status });
  if (cases.import.length) steps.push({ label: 'Binding import / charge limit', work: 'lowest governing value among requested import cases', value: ok(im.value) ? `${fmt.mw(im.value)} · ${im.status}` : im.status });
  const a = audit(data.grid, S.nodeId, keys);
  const reqEx = Number(S.exportMW) > 0 && cases.export.length, reqIm = Number(S.importMW) > 0 && cases.import.length;
  return trace({
    id: 'g-capacity', title: 'Connection limits by study case',
    formula: 'Element limit_case = min over facilities not already overloaded of transfer_f,  transfer_f = (rating_f − flow_f) ÷ sensitivity_f  [base case: rate A, base flow; contingency: rate C, post-contingency flow];  governing = element limit (else envelope);  binding = min over requested cases',
    inputs: [
      { name: 'Bus', value: `${node?.name ?? '?'} (${S.nodeId})`, source: 'measured' },
      { name: 'Service', value: S.tech, source: 'user', note: `Cases: ${keys.map(k => CASE_LABEL[k]).join(', ')}` },
      { name: 'Export request', value: fmt.mw(Number(S.exportMW)), source: 'user' },
      { name: 'Import / charge request', value: fmt.mw(Number(S.importMW)), source: 'user' },
      { name: 'Storage charging', value: 'Shoulder case only, envelope only', source: 'rule', note: 'ISO-NE never studies storage charging at summer peak; the store holds no shoulder-charge facility rows, so this limit is the vendor envelope' },
      { name: 'Study data', value: `${a.checked} facility rows audited`, source: 'measured', note: `${SET_LABEL.element} + substation envelope (${SET_LABEL.envelope}); the element study is the source of record and the envelope is context only (D6.1, decided 2026-10-06)` }],
    steps,
    result: { label: 'Export limit', value: ok(ex.value) ? fmt.mw(ex.value) : ex.status },
    checks: [
      { label: `Data audit of all ${a.checked} rows: stored limits above the linear recompute beyond rounding (would be optimistic)${a.worst.length ? ` — ${a.worst.slice(0, 2).join('; ')}` : ''}`, a: a.optimistic, b: 0, atol: 0, fmt: v => `${v} rows` },
      ...(reqEx ? [{ label: 'Independent re-derivation of the binding export limit from the raw rows and raw headroom table', a: ownBinding(data.grid, S.nodeId, cases.export, Number(S.exportMW)), b: ex.value, atol: 1e-9, fmt: mwCheck }] : []),
      ...(reqIm ? [{ label: 'Independent re-derivation of the binding import / charge limit', a: ownBinding(data.grid, S.nodeId, cases.import, chargeMW(S.tech, S.exportMW, S.importMW)), b: im.value, atol: 1e-9, fmt: mwCheck }] : []),
    ],
    notes: [
      `${a.conservative} row(s) have a stored limit below the linear recompute (more conservative — typically transformers screened on MVA rather than MW); ${a.notHeld} row(s) lack a flow or rating to recompute.`,
      'Voltage, stability, protection and affected-system studies are not held; a thermal limit alone does not establish feasibility.'],
    csv: csvFacilities(data.grid, S.nodeId, keys, { exportMW: Number(S.exportMW), importMW: Number(S.importMW) }),
  });
}

/** Constraints: loading at request for the selected case's facilities. */
export function traceConstraints(data, S, key, el, req) {
  if (el.status !== 'held') return trace({ id: 'g-constraints', title: `Facility loading · ${CASE_LABEL[key]}`, formula: 'Loading_f(MW) = |flow_f + sensitivity_f × MW| ÷ rating_f × 100', inputs: [{ name: 'Case', value: CASE_LABEL[key], source: 'user' }], steps: [{ label: 'Facility list', work: { noViolation: 'study reports no violations; tested maximum not published', unpublished: 'every listed facility is already overloaded', mislabel: 'store rows are mislabelled (large-load table)', none: 'no facility rows held' }[el.status] || el.status, value: '—' }], result: { label: 'Lowest facility limit', value: 'not held' }, notes: ['No check possible: there is no usable facility list for this case, so nothing is computed.'] });
  const cand = el.rows.filter(r => !el.pre.includes(r)).sort((a, b) => (a.transfer_mw ?? Infinity) - (b.transfer_mw ?? Infinity)).slice(0, 6);
  const low = cand[0], lowRec = low ? recompute(low) : null;
  return trace({
    id: 'g-constraints', title: `Facility loading · ${CASE_LABEL[key]}`,
    formula: 'Loading_f(MW) = |flow_f + sensitivity_f × MW| ÷ rating_f × 100  [base case: rate A, base flow; contingency: rate C, post-contingency flow];  the facility limits the project where loading reaches 100%',
    inputs: [{ name: 'Case', value: CASE_LABEL[key], source: 'user' }, { name: 'Request', value: fmt.mw(req), source: 'user' },
      { name: 'Facilities', value: `${el.rows.length} rows, ${el.pre.length} pre-existing`, source: 'measured', note: 'Pre-existing: already ≥ 100% before the project, or negative transfer' }],
    steps: cand.map(r => { const b = basisOf(r); return { label: fac(r), work: `|${n1(b.flow)} + ${n3(r.dfax)} × ${n1(req)}| ÷ ${n1(b.rating)} (rate ${b.rate}) × 100; stored limit ${fmt.mw(r.transfer_mw)}`, value: ok(loadAt(r, req)) && req > 0 ? `${loadAt(r, req).toFixed(1)}%` : 'not held' }; }),
    result: { label: 'Lowest facility limit', value: fmt.mw(el.limit) },
    check: low ? { label: `Data check: ${fac(low)} stored limit is not above the linear recompute (${n1(lowRec)} MW + rounding bound ${bound(low).toFixed(2)} MW)`, a: ok(lowRec) ? Math.max(0, low.transfer_mw - lowRec - bound(low)) : null, b: 0, atol: 1e-9, fmt: mwCheck } : undefined,
    notes: ['Shows the six lowest-limit facilities; the CSV has every row with both loadings. Counter-flow shows as a positive loading magnitude. A stored limit below the recompute is more conservative and is not an error.'],
    csv: csvFacilities(data.grid, S.nodeId, [key], { exportMW: key.endsWith('discharge') ? req : 0, importMW: key.endsWith('charge') ? req : 0 }),
  });
}

/** Upgrade cost at the request: facility union across cases, gaps, unverified cases and the allocation. */
export function traceCost(data, S, tech, dir, size, step, res, known) {
  const exportMW = Number(S.exportMW), importMW = Number(S.importMW);
  const plan = tech === 'datacenter' ? [['import', importMW]] : ['storage', 'hybrid'].includes(tech) ? [['export', exportMW], ['import', chargeMW(tech, exportMW, importMW)]] : [['export', exportMW]];
  const own = new Map(), steps = [];
  for (const [d, mw] of plan) for (const k of costCases(tech, d)) {
    if (k === 'shoulder|discharge') { steps.push({ label: `${CASE_LABEL[k]} at ${fmt.mw(mw)}`, work: 'no usable facility list (mislabelled store rows); envelope only', value: '—' }); continue; }
    const hits = rowsFor(data.grid, S.nodeId, k).filter(r => !isPre(r) && ok(r.transfer_mw) && r.transfer_mw > 0 && r.transfer_mw < mw);
    for (const r of hits) { const p = own.get(fkey(r)); if (!p || (ownCost(r) ?? -1) > (ownCost(p) ?? -1)) own.set(fkey(r), r); }
    steps.push({ label: `${CASE_LABEL[k]} at ${fmt.mw(mw)}`, work: hits.length ? hits.map(r => `${fac(r)} (limit ${fmt.mw(r.transfer_mw)}, ${musd(ownCost(r))})`).join('; ') : 'no facility overloads below this size', value: `${hits.length} facilit${hits.length === 1 ? 'y' : 'ies'}` });
  }
  const ownTotal = [...own.values()].map(ownCost).filter(ok).reduce((t, v) => t + v, 0);
  for (const g of step.gaps || []) steps.push({ label: `Gap: ${g.label}`, work: `${g.reason} → total is a lower bound`, value: '≥' });
  for (const u of step.unverified || []) steps.push({ label: `Unverified: ${u.label}`, work: `${u.reason} → no upgrades indicated, not proven`, value: '?' });
  steps.push({ label: 'Network upgrades (union across cases)', work: `${own.size} distinct facilities; ${[...own.values()].filter(r => ownCost(r) == null).length} unpriced (incl. $0 zero-length rows)`, value: `${step.status === 'Lower bound' && ok(step.total) ? '≥ ' : ''}${musd(step.total)} · ${step.status}` });
  // FORMULAS D2: the KPI counts every allocator row; the trace lists them, so the two counts are the same rows.
  const unRows = (res.rows || []).filter(r => r.cost == null), gapN = unRows.filter(r => r.category === 'Network upgrade' && String(r.id || '').startsWith('gap|')).length;
  const netUn = unRows.filter(r => r.category === 'Network upgrade').length, otherUn = unRows.length - netUn;
  steps.push({ label: 'Other scope (outside the network union)', work: (res.rows || []).filter(r => r.category !== 'Network upgrade').map(r => `${r.label}: ${r.cost == null ? 'unpriced' : musd(r.cost)}`).join('; ') || 'none', value: `${otherUn} unpriced` });
  steps.push({ label: 'Unpriced scope (all rows)', work: `${netUn} network row(s)${gapN ? ` (incl. ${gapN} case gap row(s))` : ''} + ${otherUn} direct / affected-system row(s)`, value: `${unRows.length} unpriced` });
  for (const r of res.rows.filter(x => x.allocation != null)) steps.push({ label: `Allocated: ${r.label}`, work: `${musd(r.cost)} × ${r.share}%`, value: musd(r.allocation) });
  steps.push({ label: 'Known subtotal', work: 'Σ allocated (unpriced items counted, never $0)', value: musd(known) });
  return trace({
    id: 'g-cost', title: `Upgrade cost at ${fmt.mw(size)}`,
    formula: 'Cost(S) = Σ cost_f over facilities with transfer_f < S (not pre-existing), unioned across applicable cases;  case without facility evidence that may bind below S → "≥";  case confirmed only by an envelope → "no upgrades indicated" (never a true $0)',
    inputs: [{ name: 'Service, direction', value: `${tech}, ${dir}`, source: 'user' }, { name: 'Size costed', value: fmt.mw(size), source: 'user', note: tech === 'datacenter' ? 'Large-load and summer-peak charge cases' : ['storage', 'hybrid'].includes(tech) ? 'Storage also costed at its charge rating in the charge case' : '' },
      { name: 'Facility costs', value: 'Stored study estimates ($M)', source: 'measured', note: 'A $0 on a zero-length facility is a per-mile artefact: treated as not held' },
      { name: 'Project shares', value: Object.keys(S.ui.alloc?.[S.ui.allocKey] || {}).length ? 'Edited' : '100% (standalone)', source: 'user', note: 'ISO-NE cluster allocation method not held' }],
    steps,
    result: { label: 'Known subtotal', value: `${(step.gaps || []).length || res.unpriced ? '≥ ' : ''}${musd(known)}` },
    checks: [{ label: 'Independent re-derivation of the network-upgrade union from raw rows = cost engine', a: ownTotal, b: ok(step.known) ? step.known : step.total, atol: 1e-9, fmt: musd },
      ...(ok(res.unpriced) ? [{ label: 'Unpriced scope: rows counted here = the Unpriced scope KPI', a: unRows.length, b: res.unpriced, atol: 0, fmt: v => `${v} item(s)` }] : [])],
    csv: { name: `grid-cost-${S.nodeId}-${size}mw.csv`, meta: [['bus', S.nodeId], ['size_mw', size], ['status', step.status], ['rule', 'facilities with transfer < size, union across cases; $0 on zero-length = not held'], ['gaps', (step.gaps || []).map(g => `${g.label}: ${g.reason}`).join(' | ') || 'none'], ['unverified', (step.unverified || []).map(g => `${g.label}: ${g.reason}`).join(' | ') || 'none']], columns: ['scope', 'category', 'cost_musd', 'share_pct', 'allocated_musd', 'source'], rows: res.rows.map(r => [r.label, r.category, r.cost, r.share, r.allocation, r.source]) },
  });
}

/** Mitigation: the cost step function's breakpoints and the largest size without upgrades. */
export function traceMitigation(data, S, tech, dir, lim) {
  const keys = costCases(tech, dir).filter(k => k !== 'shoulder|discharge');
  const pts = keys.flatMap(k => rowsFor(data.grid, S.nodeId, k).filter(r => !isPre(r) && ok(r.transfer_mw) && r.transfer_mw > 0).map(r => ({ k, r }))).sort((a, b) => a.r.transfer_mw - b.r.transfer_mw);
  const seen = new Set(); let cum = 0, open = false; const steps = [];
  for (const { k, r } of pts) { if (seen.has(fkey(r))) continue; seen.add(fkey(r)); const c = ownCost(r); if (c == null) open = true; else cum += c; steps.push({ label: `Above ${fmt.mw(r.transfer_mw)}`, work: `${fac(r)} (${CASE_LABEL[k]}) needs upgrading: + ${musd(c)}`, value: `${open ? '≥ ' : ''}${musd(cum)}` }); if (steps.length >= 12) break; }
  const lowest = pts.length ? pts[0].r.transfer_mw : null;
  return trace({
    id: 'g-mitigation', title: 'Upgrade cost step function',
    formula: 'Cost(S) steps up by cost_f each time S passes a facility transfer limit;  largest size without upgrades = lowest binding limit (facility, or envelope where no list exists)',
    inputs: [{ name: 'Direction', value: dir, source: 'user' }, { name: 'Cases', value: keys.map(k => CASE_LABEL[k]).join(', '), source: 'rule' }],
    steps: steps.length ? steps : [{ label: 'No facility limits', work: 'no element rows for these cases', value: '—' }],
    result: { label: 'Largest size without upgrades', value: ok(lim) ? fmt.mw(lim) : 'not held' }, // FORMULAS D7: the limit itself, never truncated
    check: ok(lim) ? { label: 'Independent re-derivation of the largest size without upgrades from the raw rows and headroom table', a: (() => { const a = applicableCases(tech), e = dir === 'export' ? ownBinding(data.grid, S.nodeId, a.export, Number(S.exportMW)) : ownBinding(data.grid, S.nodeId, a.import, Number(S.importMW)), c = ['storage', 'hybrid'].includes(tech) ? ownBinding(data.grid, S.nodeId, a.import, chargeMW(tech, S.exportMW, S.importMW)) : null; return [e, c].filter(ok).length ? Math.min(...[e, c].filter(ok)) : null; })(), b: lim, atol: 1e-9, fmt: mwCheck } : undefined,
    notes: !ok(lim) ? ['No check possible: the largest size without upgrades is not held (nothing requested in this direction, or the governing case is on hold or not studied).', 'First twelve breakpoints shown; "≥" once an unpriced facility is passed.']
      : ok(lowest) && lowest > lim + 1e-6 ? ['An envelope-only or charge case binds below every facility limit, so the no-upgrade size comes from that case, not from a facility.'] : ['First twelve breakpoints shown; "≥" once an unpriced facility is passed.'],
  });
}

// ---------- v3 traces (2026-09-29): size sweep, short-circuit strength, PCR binding, association, cost to unlock,
// $/kW by size, study curtailment, delivered value, nearby context. Checks use this file's own code. ----------
const ownServiceKeys = tech => { const a = applicableCases(tech); return (tech === 'datacenter' ? a.import : ['storage', 'hybrid'].includes(tech) ? [...a.export, ...a.import] : a.export).filter(k => k !== 'shoulder|discharge'); };
/** Own union: distinct facilities (not pre-existing) with 0 < transfer < S over the service's element cases; cost = max per facility. */
function ownUnion(grid, bus, tech, S) {
  const m = new Map();
  for (const k of ownServiceKeys(tech)) {
    const rs = rowsFor(grid, bus, k);
    if (rs.some(r => /no violations/i.test(fac(r)))) continue;
    for (const r of rs) if (!isPre(r) && ok(r.transfer_mw) && r.transfer_mw > 0 && r.transfer_mw < S) { const c = ownCost(r), p = m.get(fkey(r)); m.set(fkey(r), p === undefined ? c : c == null ? p : p == null ? c : Math.max(p, c)); }
  }
  return { n: m.size, total: [...m.values()].filter(ok).reduce((a, b) => a + b, 0), unpriced: [...m.values()].filter(v => v == null).length };
}
const statusCost = c => `${c.status}${ok(c.total) && c.status !== 'Not requested' ? ` · ${c.status === 'Lower bound' ? '≥ ' : ''}${musd(c.total)}` : ''}`;

/** Size sweep: status and upgrade scope at each size (Connection capacity). */
export function traceSweep(data, S, tech, sweep, req) {
  const at = sweep.find(r => r.size === req), own = ok(req) && req > 0 ? ownUnion(data.grid, S.nodeId, tech, req) : null;
  return trace({
    id: 'g-sweep', title: 'Size sweep of the connection limit',
    formula: 'At size S: fits = every requested case has governing ≥ S;  facilities to upgrade(S) = distinct facilities with 0 < transfer_f < S, not pre-existing, over the service\'s element cases;  cost(S) = the upgrade-cost engine at S',
    inputs: [{ name: 'Service', value: tech, source: 'user', note: tech === 'datacenter' ? 'Import cases at S' : ['storage', 'hybrid'].includes(tech) ? 'Export at S and charge at S (shoulder)' : 'Export cases at S' },
      { name: 'Sizes', value: sweep.map(r => r.size).join(', '), unit: 'MW', source: 'assumption', note: 'Sweep points; the request is included' },
      { name: 'Facility limits', value: 'fact_limiting_element', source: 'measured' }],
    steps: sweep.map(r => ({ label: `${fmt.mw(r.size)}${r.size === req ? ' (request)' : ''}`, work: `${r.statuses.join(' / ') || '—'}; ${r.overloaded ?? 0} facilit${r.overloaded === 1 ? 'y' : 'ies'} below this size`, value: statusCost(r.cost) })),
    result: { label: 'At the request', value: at ? `${at.fits === true ? 'Fits' : at.fits === false ? 'Does not fit' : 'Not established'} · ${at.overloaded ?? 0} to upgrade` : 'not requested' },
    check: at && own ? { label: `Independent recount of facilities below ${fmt.mw(req)} from the raw rows`, a: own.n, b: at.overloaded, atol: 0, fmt: v => (ok(v) ? `${v} facilities` : 'not held') } : undefined,
    notes: at ? ['Envelope-only cases confirm a size but never prove a $0; a size above an envelope-only case is a lower bound.'] : ['No check possible: nothing is requested in this direction.'],
    csv: { name: `grid-size-sweep-${S.nodeId}.csv`, meta: [['bus', S.nodeId], ['service', tech], ['source', 'unified fact_headroom / fact_limiting_element']], columns: ['size_mw', 'fits', 'statuses', 'binding_limit_mw', 'facilities_to_upgrade', 'cost_status', 'cost_known_musd', 'unpriced', 'usd_per_kw'], rows: sweep.map(r => [r.size, r.fits, r.statuses.join(' / '), r.limit, r.overloaded, r.cost.status, r.cost.total, r.cost.unpriced, r.perKw]) },
  });
}

/** Short-circuit strength: ratio at the request, size at a ratio of 3, fault current, position among buses. */
export function traceScr(ctx, m, req) {
  const sc = ctx?.sc, kv = ctx?.bus?.nominal_kv;
  if (!sc || !ok(m.sc)) return trace({ id: 'g-scr', title: 'Short-circuit strength', formula: 'ratio = short-circuit MVA ÷ request MW', inputs: [{ name: 'Short-circuit MVA', value: 'not held', source: 'measured' }], steps: [], result: { label: 'Ratio at request', value: 'not held' }, notes: ['No check possible: the substation record holds no short-circuit value for this bus.'] });
  return trace({
    id: 'g-scr', title: 'Short-circuit strength at the connection point',
    formula: 'ratio = SC_MVA ÷ request_MW;  size at a ratio of 3 = SC_MVA ÷ 3;  fault current kA = SC_MVA ÷ (√3 × kV)  (above 63 kA suppressed as suspect)',
    inputs: [{ name: 'Short-circuit MVA', value: fmt.int(m.sc), source: 'measured', note: sc.source },
      { name: 'Nominal voltage', value: `${kv} kV`, source: 'measured' }, { name: 'Request', value: fmt.mw(req), source: 'user' },
      { name: 'Ratio of 3', value: '3', source: 'rule', note: 'The live Studio\'s convention for reporting a size; not an ISO-NE criterion (the vault holds no SCR threshold).' }],
    steps: [
      { label: 'Ratio at request', work: ok(m.scr) ? `${fmt.int(m.sc)} ÷ ${n1(req)}` : 'no request', value: ok(m.scr) ? m.scr.toFixed(1) : 'not held' },
      { label: 'Size at a ratio of 3', work: `${fmt.int(m.sc)} ÷ 3`, value: fmt.mw(m.mwAtRatio3) },
      { label: 'Fault current', work: `${fmt.int(m.sc)} ÷ (1.732 × ${kv})`, value: ok(m.kA) ? `${m.kA.toFixed(1)} kA` : m.kASuspect ? `${m.kAraw.toFixed(1)} kA suppressed` : 'not held' },
      { label: 'Position, all substations', work: `${fmt.int(sc.all.below)} of ${fmt.int(sc.all.n)} have a lower value`, value: ok(sc.all.below) ? `P${Math.round((100 * sc.all.below) / sc.all.n)}` : 'not held' },
      { label: `Position, ${kv} kV substations`, work: `${fmt.int(sc.kv.below)} of ${fmt.int(sc.kv.n)} have a lower value`, value: ok(sc.kv.below) && sc.kv.n ? `P${Math.round((100 * sc.kv.below) / sc.kv.n)}` : 'not held' }],
    result: { label: 'Ratio at request', value: ok(m.scr) ? m.scr.toFixed(1) : 'not held' },
    checks: [{ label: 'Arithmetic re-check: ratio × request = short-circuit MVA', a: ok(m.scr) ? m.scr * req : null, b: m.sc, tol: 1e-9, fmt: v => (ok(v) ? `${v.toFixed(1)} MVA` : 'not held') },
      { label: 'Arithmetic re-check: size at ratio 3 × 3 = short-circuit MVA', a: m.mwAtRatio3 * 3, b: m.sc, tol: 1e-9, fmt: v => `${v.toFixed(1)} MVA` }],
    csv: { name: `grid-short-circuit-${ctx.bus.bus_id}.csv`, meta: [['bus', ctx.bus.bus_id], ['source', sc.source]], columns: ['bus_id', 'name', 'kv', 'miles', 'short_circuit_mva', 'envelope_sp_export_mw'], rows: [[ctx.bus.bus_id, ctx.bus.bus_name, kv, 0, m.sc, null], ...ctx.neighbours.map(x => [x.bus_id, x.name, x.kv, x.mi, x.sc_mva, x.env_sp_dis])] },
  });
}

/** How often this bus's limiting facilities bind in the PCR runs. */
export function tracePcr(ctx) {
  const rows = ctx?.pcr || [], nf = ctx?.facilities?.length || 0;
  const byRun = {}; rows.forEach(r => { byRun[r.run] = (byRun[r.run] || 0) + r.hours; });
  const top = [...rows].sort((a, b) => b.hours - a.hours)[0];
  return trace({
    id: 'g-pcr', title: 'Limiting facilities binding in the PCR runs',
    formula: 'hours_f,run = count of hours the facility (same branch, either end first, any contingency) binds in the run;  mean |μ| = Σ|shadow price| ÷ hours',
    inputs: [{ name: 'Limiting facilities of this bus', value: String(nf), source: 'measured', note: 'fact_limiting_element, all cases, matched by branch (bus numbers + circuit)' },
      { name: 'Solved binding records', value: Object.entries(ctx?.pcr_run_hours || {}).map(([k, v]) => `${k} ${fmt.int(v)} h`).join(' · ') || 'not held', source: 'measured', note: 'fact_pcr_binding_hourly' }],
    steps: rows.length ? [...rows].sort((a, b) => a.run.localeCompare(b.run) || b.hours - a.hours).slice(0, 12).map(r => ({ label: `${r.run} · ${r.facility.replace(/\s+/g, ' ')}`, work: `for loss of ${r.contingency}: ${fmt.int(r.hours)} h; Σ|μ| ${n1(r.sum_abs_shadow)} ÷ ${r.hours}`, value: `${n1(r.mean_abs_shadow)} $/MWh mean` })) : [{ label: 'Match', work: `none of the ${nf} limiting facilities binds in any PCR run`, value: '0 facilities' }],
    result: { label: 'Facilities that bind', value: `${new Set(rows.map(r => r.key)).size} of ${nf}` },
    checks: top ? [{ label: `Arithmetic re-check: mean |μ| × hours = Σ|μ| (${top.run}, ${top.facility.replace(/\s+/g, ' ')})`, a: top.mean_abs_shadow * top.hours, b: top.sum_abs_shadow, tol: 1e-6, fmt: v => n1(v) },
      ...Object.keys(byRun).map(run => ({ label: `Consistency check: no facility binds in more hours than ${run} solved (${fmt.int(ctx.pcr_run_hours[run])} h)`, a: Math.max(0, ...rows.filter(r => r.run === run).map(r => r.hours - (ctx.pcr_run_hours[run] ?? 0))), b: 0, atol: 0, fmt: v => `${v} h over` }))] : undefined,
    notes: rows.length ? ['A binding hour is a solved-run constraint at its limit; its shadow price is the cost of one more MW of transfer. It is evidence the facility is congested in the modelled year, not a curtailment count.'] : [`No check possible: none of this bus's ${nf} limiting facilities binds in any PCR run, so there is nothing to recompute.`],
    csv: { name: `grid-pcr-binding-${ctx?.bus?.bus_id}.csv`, meta: [['source', 'unified fact_pcr_binding_hourly']], columns: ['run', 'facility', 'contingency', 'hours', 'mean_abs_shadow', 'max_abs_shadow', 'sum_abs_shadow'], rows: rows.map(r => [r.run, r.facility, r.contingency, r.hours, r.mean_abs_shadow, r.max_abs_shadow, r.sum_abs_shadow]) },
  });
}

/** Binding constraints by period: association (settled and solved) and the exact share at unit nodes. */
export function traceAssoc(k, p) {
  if (!p || !p.held) return trace({ id: 'g-assoc', title: 'Binding constraints at this bus', formula: 'assoc = (MCC_on − MCC_off) × hours ÷ year hours', inputs: [{ name: 'Period', value: p?.key || '—', source: 'user' }], steps: [], result: { label: 'Constraints', value: 'not held' }, notes: [`No check possible: ${p?.reason || 'no period selected'}.`] });
  const top = p.rows.find(r => ok(r.assoc)) || null;
  return trace({
    id: 'g-assoc', title: `Binding constraints at this bus · ${p.key}`,
    formula: 'MCC_on = mean congestion component at this bus in the hours the constraint bound;  MCC_off = mean in every other hour;  assoc = (MCC_on − MCC_off) × hours ÷ N  ($/MWh of the annual mean MCC; association, not attribution);  exact share (unit nodes, PCR) = Σ(μ × DFAX) ÷ N',
    inputs: [{ name: 'Period', value: p.key, source: 'user' }, { name: 'Hours priced at this bus (N)', value: fmt.int(p.hours), source: 'measured' },
      { name: 'Annual mean MCC', value: `${n3(p.mcc)} $/MWh`, source: 'measured', note: p.kind === 'solved' ? 'Run congestion negated to the settled sign' : `Settled series ${k.settled_series?.pnode_name || ''}` },
      { name: 'Constraints that bound', value: fmt.int(p.constraints), source: 'measured', note: k.rules?.excluded }],
    steps: p.rows.slice(0, 8).map(r => ({ label: r.name.replace(/\s+/g, ' '), work: ok(r.assoc) ? `(${n3(r.mcc_on)} − ${n3(r.mcc_off)}) × ${r.hours} ÷ ${p.hours}` : ok(r.contrib) ? `exact: DFAX ${n3(r.dfax)}` : 'binds every hour: no "other hours"', value: ok(r.contrib) ? `${n3(r.contrib)} exact` : ok(r.assoc) ? `${n3(r.assoc)} assoc` : 'not held' })),
    result: { label: 'Leading constraint', value: p.rows[0] ? p.rows[0].name.replace(/\s+/g, ' ').slice(0, 60) : 'none bound' },
    checks: [...(top ? [{ label: `Arithmetic re-check of the association for ${top.name.replace(/\s+/g, ' ').slice(0, 50)}`, a: (top.mcc_on - top.mcc_off) * top.hours / p.hours, b: top.assoc, tol: 1e-9, fmt: n3 }] : []),
      ...(p.exact && ok(p.contrib_total) ? [{ label: 'Identity check: exact shares sum to the annual mean MCC (MCC = Σ μ × DFAX in the solve)', a: p.contrib_total, b: p.mcc, atol: 1e-3, fmt: n3 }] : [])],
    notes: [...(top ? [] : ['No check possible: no row carries an association (every constraint bound in every hour, or none bound).']), k.rules?.association, p.exact ? k.rules?.exact : 'No exact share: the bus\'s PCR price node hosts no unit with a published DFAX in this run.'].filter(Boolean),
    csv: { name: `grid-constraints-${k.bus_id}-${p.key}.csv`, meta: [['bus', k.bus_id], ['period', p.key], ['hours', p.hours], ['mcc_annual', p.mcc], ['rule', k.rules?.association]], columns: ['constraint', 'hours', 'mcc_on', 'mcc_off', 'assoc', 'dfax', 'contrib', 'mean_abs_shadow', 'max_abs_shadow', 'limiting_case'], rows: p.rows.map(r => [r.name, r.hours, r.mcc_on, r.mcc_off, r.assoc, r.dfax, r.contrib, r.mean_abs_shadow, r.max_abs_shadow, (r.limiting || []).map(x => x.join(' ')).join(' | ')]) },
  });
}

/** Cost to unlock: cumulative network cost at each facility limit. */
export function traceUnlock(data, S, tech, u) {
  const last = u.steps.at(-1), own = last ? ownUnion(data.grid, S.nodeId, tech, last.mw + 1e-6 * Math.max(1, last.mw)) : null;
  return trace({
    id: 'g-unlock', title: 'Cost to unlock each megawatt',
    formula: 'Steps at each distinct facility limit t_f (0 < t_f, not pre-existing, over the service\'s element cases);  cumulative(t) = upgrade-cost engine just above t;  a case without facility evidence that binds below t makes it "≥"',
    inputs: [{ name: 'Service', value: tech, source: 'user' }, { name: 'Cases', value: u.cases.map(k => CASE_LABEL[k]).join(', '), source: 'rule' }, { name: 'Facility costs', value: 'Stored study estimates', source: 'measured', note: '$0 on a zero-length facility = not held' }],
    steps: [{ label: 'Below the first limit', work: statusCost(u.start), value: u.start.status }, ...u.steps.slice(0, 14).map(s => ({ label: `Above ${fmt.mw(s.mw)}`, work: `${s.facility.replace(/\s+/g, ' ')} (${s.cases.join(', ')}): + ${musd(s.cost)}`, value: `${s.status === 'Lower bound' || s.unpriced ? '≥ ' : ''}${musd(s.cum)}` }))],
    result: { label: 'All listed facilities', value: last ? `${last.status === 'Lower bound' || last.unpriced ? '≥ ' : ''}${musd(last.cum)}` : 'no facility limits' },
    check: last && ok(last.cum) ? { label: 'Independent re-derivation of the cumulative cost above the last limit from the raw rows', a: own.total, b: last.cum, tol: 1e-9, fmt: musd } : undefined,
    notes: last && !ok(last.cum) ? ['No check possible: nothing is priced above the last limit, so the total is not held (never a $0 bound).'] : last ? [] : ['No check possible: no facility limit is held in the service\'s element cases (envelope-only or no-violation cases).'],
    csv: { name: `grid-cost-to-unlock-${S.nodeId}.csv`, meta: [['bus', S.nodeId], ['service', tech]], columns: ['limit_mw', 'facility', 'cases', 'step_cost_musd', 'cumulative_musd', 'status', 'unpriced'], rows: u.steps.map(s => [s.mw, s.facility, s.cases.join(' | '), s.cost, s.cum, s.status, s.unpriced]) },
  });
}

/** $/kW by size (complete totals only). */
export function tracePerKw(S, sweep) {
  const pts = sweep.filter(r => ok(r.perKw));
  const top = pts[pts.length - 1];
  return trace({
    id: 'g-perkw', title: 'Network cost per kW by size',
    formula: '$/kW(S) = cost(S) [$M] × 10^6 ÷ (S [MW] × 1,000);  only complete totals (Priced or True zero)',
    inputs: [{ name: 'Sizes', value: sweep.map(r => r.size).join(', '), unit: 'MW', source: 'assumption' }],
    steps: sweep.map(r => ({ label: fmt.mw(r.size), work: ok(r.perKw) ? `${musd(r.cost.total)} × 1,000 ÷ ${r.size}` : `${r.cost.status}: not a complete total`, value: ok(r.perKw) ? `$${r.perKw.toFixed(0)}/kW` : '—' })),
    result: { label: 'Sizes with a complete total', value: `${pts.length} of ${sweep.length}` },
    check: top ? { label: `Arithmetic re-check at ${fmt.mw(top.size)}: $/kW × kW = cost`, a: top.perKw * top.size * 1000, b: top.cost.total * 1e6, tol: 1e-9, fmt: v => `$${(v / 1e6).toFixed(3)}M` } : undefined,
    notes: top ? [] : ['No check possible: no size has a complete (priced or proven-zero) total at this bus.'],
    csv: { name: `grid-per-kw-${S.nodeId}.csv`, meta: [['bus', S.nodeId]], columns: ['size_mw', 'cost_status', 'cost_musd', 'usd_per_kw'], rows: sweep.map(r => [r.size, r.cost.status, r.cost.total, r.perKw]) },
  });
}

/** Study injection test: curtailment at 100 / 250 / 500 MW and the offered energy behind each share. */
export function traceCurtail(cur, req, deliveredValue, offeredMwh) {
  const st = cur?.study || [];
  const tested = st.filter(r => r.tested), off = tested.map(r => ({ r, o: offeredMwh(r) })).filter(x => ok(x.o));
  return trace({
    id: 'g-curtail', title: 'Curtailment at size (study injection test)',
    formula: 'share_S = curtailed MWh_S ÷ offered MWh_S (as stored);  offered MWh_S = curtailed MWh_S ÷ share_S;  delivered value per offered MWh = (1 − share_S) × average LMP after the injection',
    inputs: [{ name: 'Study', value: cur?.study_label || 'not held', source: 'measured', note: 'Vendor/Studio copy (older database); the unified DB excludes the vendor ramp' },
      { name: 'Request', value: fmt.mw(req), source: 'user', note: 'Tested sizes only; never interpolated' }],
    steps: st.map(r => ({ label: `${r.mw} MW`, work: r.tested ? `${n1(r.mwh)} MWh curtailed over ${fmt.int(r.hours)} h (max ${n1(r.max_mw)} MW); offered ${n1(offeredMwh(r))} MWh; value (1 − ${n3(r.pct / 100)}) × ${n1(r.avg_lmp)}` : 'not tested (a smaller size is tested only where the larger one curtails)', value: r.tested ? `${r.pct.toFixed(2)}% · ${ok(deliveredValue(r)) ? `$${deliveredValue(r).toFixed(2)}/MWh` : 'value not held'}` : 'not tested' })),
    result: { label: 'Tested sizes', value: `${tested.length} of 3` },
    checks: off.length >= 2 ? [{ label: `Consistency check: the test profile's offered energy scales with size (${off[0].r.mw} vs ${off.at(-1).r.mw} MW, per MW)`, a: off[0].o / off[0].r.mw, b: off.at(-1).o / off.at(-1).r.mw, tol: 0.01, fmt: v => `${v.toFixed(1)} MWh/MW` }] : undefined,
    notes: off.length >= 2 ? [cur.rules?.study] : [`No check possible: fewer than two tested sizes curtail at this bus, so the offered-energy consistency cannot be tested.`, cur?.rules?.study].filter(Boolean),
    csv: { name: `grid-curtailment-${cur?.bus_id}.csv`, meta: [['source', cur?.study_label], ['rule', cur?.rules?.study]], columns: ['size_mw', 'tested', 'curtailed_pct', 'curtailed_mwh', 'hours', 'max_mw', 'offered_mwh', 'avg_lmp_after', 'delivered_value_per_offered_mwh'], rows: st.map(r => [r.mw, r.tested, r.pct, r.mwh, r.hours, r.max_mw, offeredMwh(r), r.avg_lmp, deliveredValue(r)]) },
  });
}

const hav = (a, b, c, d) => { const R = 3958.7613, t = x => (x * Math.PI) / 180, s = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2; return R * 2 * Math.asin(Math.min(1, Math.sqrt(s))); };
/** Nearby context: upgrades, retirements, generators and queue requests within their radii. */
export function traceNearby(ctx) {
  const up = ctx.upgrades || [], ret = ctx.retirements || [], q = ctx.queue || [], g = ctx.generators || [];
  const sum = a => a.filter(ok).reduce((x, y) => x + y, 0);
  const near = up.find(u => u.geo.length === 2) || ret[0];
  const own = near ? hav(ctx.bus.latitude, ctx.bus.longitude, near.geo[0], near.geo[1]) : null;
  return trace({
    id: 'g-nearby', title: 'Planned changes near the connection point',
    formula: 'distance = great-circle miles from the bus to the record\'s coordinate (a transmission upgrade: its nearer end);  MW totals = Σ of records inside the radius',
    inputs: [{ name: 'Radii', value: `upgrades ${ctx.radius.upgrades_mi} mi · retirements ${ctx.radius.retirements_mi} mi · generators ${ctx.radius.generators_mi} mi · queue ${ctx.radius.queue_mi} mi`, source: 'assumption' },
      { name: 'Records', value: 'dim_transmission_upgrade, dim_substation_upgrade, dim_retirement, dim_generator, dim_queue', source: 'measured', note: `${ctx.queue_unplaced} queue requests carry no coordinate and cannot be placed` }],
    steps: [{ label: 'Planned upgrades', work: `${up.filter(u => u.kind === 'Transmission').length} transmission + ${up.filter(u => u.kind === 'Substation').length} substation`, value: String(up.length) },
      { label: 'Retirements', work: ret.map(r => `${r.name} ${n1(r.mw)} MW (${r.year})`).slice(0, 6).join('; ') || 'none', value: `${n1(sum(ret.map(r => r.mw)))} MW` },
      { label: 'Generators within the radius', work: `${g.filter(x => x.status === 'Operating').length} operating, ${g.filter(x => x.status !== 'Operating').length} other`, value: `${n1(sum(g.filter(x => x.status === 'Operating').map(x => x.max_mw)))} MW operating` },
      // FORMULAS D1: the total is the sum of exactly the requests listed, and every request is listed.
      { label: 'Queue requests', work: q.length ? `${q.length} request${q.length === 1 ? '' : 's'}: ${q.map(x => `#${x.qp} ${x.type} ${n1(x.mw)} MW`).join('; ')}` : 'none', value: `${n1(sum(q.map(x => x.mw)))} MW${q.some(x => !ok(x.mw)) ? ` (${q.filter(x => !ok(x.mw)).length} MW not held)` : ''}` }],
    result: { label: 'Upgrades within radius', value: String(up.length) },
    check: near ? { label: `Independent distance re-computation for ${String(near.name).slice(0, 50)}`, a: own, b: near.mi, atol: 0.01, fmt: v => `${v.toFixed(2)} mi` } : undefined,
    notes: near ? ['Context only: none of these records is part of the connection screening. In-service years are as published; retirement and queue MW are not netted against the connection limit.'] : ['No check possible: no located upgrade or retirement falls inside the radius.'],
    csv: { name: `grid-nearby-${ctx.bus.bus_id}.csv`, meta: [['bus', ctx.bus.bus_id]], columns: ['kind', 'name', 'where', 'kv', 'year', 'mw', 'miles'], rows: [...up.map(u => [`${u.kind} upgrade`, u.name, u.where, u.kv, u.year, null, u.mi]), ...ret.map(r => ['Retirement', r.name, `${r.county}, ${r.state}`, null, r.year, r.mw, r.mi]), ...q.map(x => [`Queue ${x.type}`, `#${x.qp}`, x.poi, null, x.is_date, x.mw, x.mi])] },
  });
}
