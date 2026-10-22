// Grid rules (Claude pack §G1, §G2, §G4 as merged): which study case governs each service, the
// element-study limit per case, and the step-function upgrade cost at a requested size.
// Inputs: snapshot.grid.headroom (fact_headroom envelope) and snapshot.grid.constraints
// (fact_limiting_element rows with dfax, transfer_mw, fix_cost_musd).
// S3 #5 (W-C, 2026-10-07): the thermal loading and the PP5-6 proportional-impact allocation are the S3 engine's
// (rules/isone.js thermalScreen / allocateProportional over rules/isone-2026.json); this file maps the store's rows
// onto them. The pf bound is a labelled sensitivity, never a study result.
import * as RX from './rules/isone.js';
const ok = v => typeof v === 'number' && Number.isFinite(v);

export const CASE_LABEL = {
  'summer_peak|discharge': 'Summer peak · export', 'summer_peak|charge': 'Summer peak · charge',
  'shoulder|discharge': 'Shoulder · export', 'shoulder|charge': 'Shoulder · charge', 'large_load|charge': 'Large load · import',
};

/**
 * Which flow and rating a facility row is screened on (all-bus review H1). Base-case rows (contingency_id 0,
 * no contingency flow) use rate A with the base flow; contingency rows use rate C with the post-contingency flow.
 */
export function loadingBasis(r) {
  const base = r.contingency_id === 0 || r.contingency_flow_mw == null;
  return base ? { rate: 'A', flow: r.base_flow_mw, rating: r.rating_a_mva, kind: 'base case' } : { rate: 'C', flow: r.contingency_flow_mw, rating: r.rating_c_mva, kind: 'post-contingency' };
}
/** Linear transfer to 100%: (rating − flow) ÷ sensitivity on the row's own basis; null when an input is not held. */
export function recomputeTransfer(r) {
  const b = loadingBasis(r);
  return ok(b.rating) && ok(b.flow) && ok(r.dfax) && r.dfax > 0 ? (b.rating - b.flow) / r.dfax : null;
}
/**
 * The S3 thermal screen on one store row at MW of project (GAPS §4.4, rules/isone.js thermalScreen): MW loading
 * |flow + DFAX × MW| ÷ rating (Q is not in the store, so this is a bound), the pf-bound sensitivity (labelled,
 * assumption), the rating basis (Normal / LTE as the rules file maps rate A / C) and the citations. Status 'missing' +
 * reason when flow, DFAX or rating is not held; nothing is ever 0 for "not held".
 */
export function loadingScreen(r, mw) {
  const b = loadingBasis(r);
  return RX.thermalScreen({ p: b.flow, dfax: r.dfax, mw, rating: b.rating, contingency: b.kind === 'base case' ? 'base' : 'post' });
}
/** Loading magnitude (%) at MW of project (counter-flow shows as a positive magnitude, review L9): the screen's loading × 100. */
export function loadingAt(r, mw) {
  const s = loadingScreen(r, mw);
  return ok(s.loading) ? 100 * s.loading : null;
}
/** Facility upgrade cost ($M). A $0 on a zero-length facility is a per-mile artefact: not held (review H2). */
export function costOf(r) {
  if (!ok(r.fix_cost_musd)) return null;
  if (r.fix_cost_musd === 0 && !(ok(r.length_miles) && r.length_miles > 0)) return null;
  return r.fix_cost_musd;
}

/** Which cases apply to a service (§G1 table). */
export function applicableCases(tech) {
  const exportCases = ['summer_peak|discharge', 'shoulder|discharge'];
  if (tech === 'solar' || tech === 'wind') return { export: exportCases, import: [] };
  if (tech === 'storage' || tech === 'hybrid') return { export: exportCases, import: ['shoulder|charge'] }; // storage charging: shoulder only
  if (tech === 'datacenter') return { export: [], import: ['large_load|charge', 'summer_peak|charge'] };
  return { export: exportCases, import: [] };
}

export function envelope(grid, bus, key) {
  const [scenario, direction] = key.split('|');
  const r = grid.headroom.find(h => String(h.bus_id) === String(bus) && h.scenario === scenario && h.direction === direction);
  return r && ok(r.headroom_mw) ? r.headroom_mw : null;
}

/** Element-study limit for one case: lowest positive transfer over non-pre-existing facilities. */
export function elementLimit(grid, bus, key) {
  if (key === 'shoulder|discharge') return { status: 'mislabel', limit: null, rows: [], pre: [] }; // store trap: large-load injection rows under a shoulder label
  const [scenario, direction] = key.split('|');
  const rows = grid.constraints.filter(r => String(r.bus_id) === String(bus) && r.scenario === scenario && r.direction === direction);
  if (!rows.length) return { status: 'none', limit: null, rows: [], pre: [] };
  if (rows.some(r => /no violations/i.test(String(r.monitored_facility)))) return { status: 'noViolation', limit: null, rows: [], pre: [] };
  const isPre = r => (ok(r.pct_loading_no_transfer) && Math.abs(r.pct_loading_no_transfer) >= 100) || (ok(r.transfer_mw) && r.transfer_mw < 0); // |loading|: counter-flow too (R5)
  const pre = rows.filter(isPre), cand = rows.filter(r => !isPre(r) && ok(r.transfer_mw) && r.transfer_mw > 0);
  if (!cand.length) return { status: 'unpublished', limit: null, rows, pre };
  const best = cand.reduce((a, b) => (b.transfer_mw < a.transfer_mw ? b : a));
  return { status: 'held', limit: best.transfer_mw, facility: best.monitored_facility?.trim(), rows, pre };
}

/**
 * D6.1 (decided 2026-10-06, v8 06-decisions/DECISIONS-OPEN.md): the headroom source of record is the element study;
 * the vendor envelope is context only. A case whose only evidence is the envelope therefore reads "Envelope only"
 * (a Hold-class status): never "Fits", never "Does not fit", never counted as a pass (Findings F009). Its envelope
 * figure stays in `governing` as a labelled, conservative context number.
 */
export const ENVELOPE_ONLY = 'Envelope only';

/**
 * C04 (P2 grid fix, 2026-10-10): the two headroom datasets are two different SETS, named on every figure.
 * Element rows (fact_limiting_element) are the 2026-05 interconnection element study; the envelope (fact_headroom) is
 * the headline element set's first element to reach rating (grid_depth headroom_compare reproduces it exactly from the
 * headline element list), its vintage unconfirmed (decision D-007). Memory: gridsense-two-element-vintages.
 */
export const SET_LABEL = {
  element: 'Interconnection element study (2026-05 set)',
  envelope: 'ISO-NE GridSense data, headline set, vintage unconfirmed (D-007)',
};
export const ENVELOPE_METHOD = 'headline element set (first element to reach rating)';
/** The set a case-table row's figure comes from: 'element' | 'envelope' | null. */
export const setOf = r => (r?.evidence === 'element' ? 'element' : r?.evidence === 'envelope' ? 'envelope' : null);
/** The store's source string with both sets named (grid.source alone names tables, not sets). */
export function sourceLabel(grid) {
  return `${grid?.source || 'unified fact_headroom / fact_limiting_element'} · element rows: ${SET_LABEL.element}; envelope: ${SET_LABEL.envelope}`;
}

/** One row per applicable case: envelope, element limit, governing value, margin, and the evidence behind it. */
export function caseTable(grid, bus, tech, exportMW, importMW) {
  const cases = applicableCases(tech), out = [];
  for (const [dir, keys, mw] of [['export', cases.export, exportMW], ['import', cases.import, importMW]]) {
    for (const key of keys) {
      const env = envelope(grid, bus, key), el = elementLimit(grid, bus, key);
      let governing = null, basis, evidence;
      if (el.status === 'held') { governing = el.limit; basis = 'Element study'; evidence = 'element'; }
      else if (el.status === 'noViolation') { governing = null; basis = 'No violations found; tested maximum not published'; evidence = 'element-unpublished'; }
      else if (el.status === 'unpublished') { governing = null; basis = 'Element limit not published'; evidence = 'element-unpublished'; }
      else { governing = env; basis = env == null ? 'Not studied' : 'Envelope only (headline set, vintage unconfirmed; unreconciled with the element study)'; evidence = env == null ? 'none' : 'envelope'; }
      const disagree = el.status === 'held' && ok(env) && Math.abs(env - el.limit) / Math.max(env, el.limit) > 0.1;
      const asked = ok(mw) && mw > 0;
      let status;
      if (!asked) status = 'Not requested';
      else if (el.status === 'noViolation') status = 'Hold';
      else if (el.status === 'unpublished') status = 'Hold';
      else if (!ok(governing)) status = 'Not studied';
      else if (evidence === 'envelope') status = ENVELOPE_ONLY;
      else status = mw <= governing ? 'Fits' : 'Does not fit';
      out.push({ key, label: CASE_LABEL[key], dir, envelope: env, element: el, governing, basis, evidence, disagree, requested: mw,
        margin: ok(governing) && asked ? governing - mw : null, status, envelopeFits: evidence === 'envelope' && asked ? mw <= env : null });
    }
  }
  return out;
}

/**
 * Binding per direction. The status is the direction's verdict (D6.1): "Does not fit" only on element-study evidence,
 * "Envelope only" whenever a requested case rests on the envelope (Hold-class, never Fits).
 * C03 (2026-10-10): value, row, case and set always come from ONE row. With an element breach the binding row is the
 * lowest breaching element row, so "Does not fit" never carries an envelope number from another case (111348 used to
 * read 55.7 MW shoulder envelope + the summer-peak element verdict). Otherwise it is the lowest governing row.
 * rowStatus = that row's own status (equals status whenever status is Fits or Does not fit); cases = every requested
 * case's own status, shown apart from the binding status. capMW = the value only when it is element-study evidence:
 * an envelope-only figure is context, never a cap handed to Economics.
 */
export function binding(table, dir) {
  const rows = table.filter(r => r.dir === dir && r.status !== 'Not requested');
  const cases = rows.map(r => ({ key: r.key, label: r.label, status: r.status, value: ok(r.governing) ? r.governing : null, set: setOf(r) }));
  const none = (status, row = null) => ({ value: null, status, verdict: status, row, case: row?.label ?? null, key: row?.key ?? null, set: setOf(row), rowStatus: row?.status ?? null,
    valueBasis: row?.evidence ?? null, capMW: null, cases, envelopeCases: [], envelopeBelow: [] });
  if (!rows.length) return none('Not requested');
  if (rows.some(r => r.status === 'Hold')) return none('Hold', rows.find(r => r.status === 'Hold'));
  const held = rows.filter(r => ok(r.governing));
  if (!held.length) return none('Not studied');
  const lowest = rs => rs.reduce((a, b) => (b.governing < a.governing ? b : a));
  const breach = rows.filter(r => r.status === 'Does not fit'); // element evidence only (caseTable)
  const low = breach.length ? lowest(breach) : lowest(held);
  const env = rows.filter(r => r.status === ENVELOPE_ONLY);
  const status = breach.length ? 'Does not fit' : env.length ? ENVELOPE_ONLY : rows.some(r => r.status === 'Not studied') ? 'Partly studied' : 'Fits';
  return { value: low.governing, row: low, case: low.label, key: low.key, set: setOf(low), rowStatus: low.status, status, verdict: status, valueBasis: low.evidence,
    capMW: low.evidence === 'element' ? low.governing : null, cases,
    envelopeCases: env.map(r => r.label), envelopeBelow: env.filter(r => r.envelopeFits === false).map(r => r.label) };
}
/** One sentence for a binding: the value with its own case, set and status, then the other cases' statuses apart. */
export function bindingText(b, fmtMW = v => `${v.toFixed(1)} MW`) {
  if (!b || b.status === 'Not requested') return 'not requested';
  const head = ok(b.value) ? `${fmtMW(b.value)} (${b.case}, ${SET_LABEL[b.set] || 'set not held'}): ${String(b.rowStatus || b.status).toLowerCase()}` : `${b.status}${b.case ? ` (${b.case})` : ''}`;
  const others = (b.cases || []).filter(c => c.key !== b.key).map(c => `${c.label}: ${c.status === ENVELOPE_ONLY ? 'envelope only (unverified)' : c.status.toLowerCase()}`);
  return `${head}${others.length ? ` · other cases: ${others.join('; ')}` : ''}${b.verdict && b.rowStatus && b.verdict !== b.rowStatus ? ` · overall: ${b.verdict.toLowerCase()}` : ''}`;
}

/**
 * Cases ISO-NE studies that the store does not hold (Findings F010). NCIS runs peak, shoulder, light-load and
 * minimum-load scenarios (R1 row G-W1: PP5-6 Rev 15 §3.0, §3.5, verified); the store has summer peak, shoulder and
 * large load only. Light and minimum load can bind lower for daytime injection, so for every injecting service they
 * are a Hold row, never silently absent. A load is screened on withdrawal cases, so none are listed for it.
 */
const UNSTUDIED_SRC = 'R1-interconnection-isone.md row G-W1 · ISO-NE PP5-6 Rev 15 §3.0, §3.5 (verified)';
export function unstudiedCases(tech) {
  if (tech === 'datacenter') return [];
  return [
    { key: 'light_load|discharge', label: 'Light load · export', dir: 'export', status: 'Not studied', verdict: 'Hold', src: UNSTUDIED_SRC,
      why: 'ISO-NE studies light-load scenarios; the store holds no light-load case, and for daytime solar it is often the one that binds lower' },
    { key: 'minimum_load|discharge', label: 'Minimum load · export', dir: 'export', status: 'Not studied', verdict: 'Hold', src: UNSTUDIED_SRC,
      why: 'ISO-NE studies minimum-load scenarios; the store holds no minimum-load case, which may bind lower than the studied cases' },
  ];
}

/**
 * The project strip's two screening gates ("Stop here if"), one rule for the strip and Grid (moved from app.js).
 * G1 connection at the request on every case the fuel needs: met only when every requested case Fits on element-study
 * evidence and no needed case is unstudied; not met on an element breach; otherwise unknown (envelope only, Hold, not
 * studied). G2 no pre-existing overload on a limiting facility: unknown where the element study is not held.
 */
export function screeningGates(table, tech) {
  const req = table.filter(r => r.status !== 'Not requested');
  const unst = req.some(r => r.dir === 'export') ? unstudiedCases(tech) : [];
  const breach = req.filter(r => r.status === 'Does not fit');
  const open = req.filter(r => r.status !== 'Fits' && r.status !== 'Does not fit');
  const g1State = breach.length ? 'not met' : !req.length || open.length || unst.length ? 'unknown' : 'met';
  const g1Why = [
    ...breach.map(r => `${r.label}: does not fit (element study ${ok(r.governing) ? r.governing.toFixed(1) : '?'} MW)`),
    ...open.map(r => `${r.label}: ${r.status === ENVELOPE_ONLY ? 'envelope only (vendor-asserted, unverified)' : r.status.toLowerCase()}`),
    ...unst.map(u => `${u.label.replace(' · export', '')}: not studied`),
    ...req.filter(r => r.status === 'Fits').map(r => `${r.label}: fits (element study)`),
  ].join(' · ') || 'nothing requested';
  const known = req.filter(r => ['held', 'unpublished', 'noViolation'].includes(r.element?.status));
  const preN = known.reduce((t, r) => t + (r.element.pre?.length || 0), 0);
  const g2State = preN ? 'not met' : req.length && known.length === req.length ? 'met' : 'unknown';
  const g2Why = preN ? `${preN} facilit${preN === 1 ? 'y' : 'ies'} at or above 100% before any transfer` : known.length === req.length ? 'none in the element study' : `element study not held for ${req.length - known.length} case(s): ${req.filter(r => !known.includes(r)).map(r => r.label).join(', ')}`;
  const gates = [{ id: 'G1', label: 'Connection at the request on every case the fuel needs', state: g1State, why: g1Why },
    { id: 'G2', label: 'No pre-existing overload on a limiting facility', state: g2State, why: g2Why }];
  const met = gates.filter(g => g.state === 'met').length, notMet = gates.filter(g => g.state === 'not met').length, unknown = gates.length - met - notMet;
  return { gates, total: gates.length, met, notMet, unknown, state: notMet ? 'not-met' : met === gates.length ? 'met' : 'unknown',
    label: `${met} of ${gates.length} met${unknown ? ` · ${unknown} unknown` : ''}${notMet ? ` · ${notMet} not met` : ''}`,
    lines: gates.map(g => `${g.label}: ${g.state} (${g.why})`).join('\n') };
}

/**
 * Vintage of the ELEMENT rows only (the interconnection element study, 2026-05 set). C04: never printed against an
 * envelope figure; every surface prints SET_LABEL[set] instead. The unified build_manifest records the load date only.
 */
export const STUDY_VINTAGE = '2026-05';
/**
 * Study basis of every Grid figure (Findings F013): what the store records about the screen, field by field. What it
 * does not record is "not held" with the reason, never blank. opts.queueModelled = dim_queue rows in the solved case.
 */
export function studyBasis(grid, bus, { queueModelled = null } = {}) {
  const rows = (grid?.constraints || []).filter(r => String(r.bus_id) === String(bus));
  const nA = rows.filter(r => loadingBasis(r).rate === 'A').length, nC = rows.length - nA;
  const scen = [...new Set((grid?.headroom || []).filter(h => String(h.bus_id) === String(bus)).map(h => h.scenario))];
  const SCEN = { summer_peak: 'summer peak', shoulder: 'shoulder', large_load: 'large load' };
  const nh = (label, why, src) => ({ label, value: `not held: ${why}`, status: 'not held', src });
  return [
    nh('Performed by', 'the store does not record who ran the screen; the envelope is vendor output (data_quality: headroom_mw vendor-asserted)', 'unified data_quality · fact_headroom'),
    nh('Base-case model and year', 'no base-case model or model year is recorded; build_manifest gives the load date only', 'unified build_manifest'),
    { label: 'Season and load level', value: `${scen.length ? scen.map(s => SCEN[s] || s).join(', ') : 'none held'} (store cases); light load and minimum load not studied`, status: scen.length ? 'held' : 'not held', src: `fact_headroom scenarios · ${UNSTUDIED_SRC}` },
    nh('Generation dispatch', 'the dispatch behind the base flows is not recorded', 'fact_limiting_element (base_flow_mw only)'),
    ok(queueModelled) ? { label: 'Queue positions included', value: `${queueModelled} queue positions modelled in the solved case (dim_queue); see Queue › Changes & risk for what has withdrawn since`, status: 'held', src: 'unified dim_queue' }
      : nh('Queue positions included', 'the queue set is not loaded on this page', 'unified dim_queue'),
    nh('Transfer sink', 'the DFAX sink (where the transfer is absorbed) is not recorded', 'fact_limiting_element.dfax'),
    { label: 'Method', value: 'linear (DC) transfer: (rating − flow) ÷ DFAX; thermal N-1 only, no AC voltage, stability or N-1-1', status: 'derived', src: 'gridrules.recomputeTransfer over fact_limiting_element' },
    { label: 'Ratings used', value: `rate A with the base flow on ${nA} base-case row(s); rate C with the post-contingency flow on ${nC} contingency row(s)`, status: rows.length ? 'derived' : 'not held', src: 'gridrules.loadingBasis' },
    { label: 'Vintage', value: `element rows: ${SET_LABEL.element}; envelope: ${SET_LABEL.envelope}`, status: 'held', src: 'fact_limiting_element (2026-05 element study) · fact_headroom (headline set; grid_depth headroom_compare reproduces it from the headline element list; D-007 open)' },
  ];
}

/**
 * Staleness of the solved case behind every Grid limit (Findings F005). counts = queuecore.studyStatusNow().counts
 * (the same join Queue › Changes & risk shows), total = modelled positions, nearby = withdrawn modelled requests near
 * the bus [{qp, mw, mi, poi}]. Nothing here re-runs the case: a withdrawal is never assumed to free capacity.
 */
export function studyStaleness({ counts = null, total = null, nearby = [], radiusMi = null } = {}) {
  if (!counts || !ok(total)) return { withdrawn: null, total: null, largest: null, text: `Study case ${STUDY_VINTAGE}: withdrawals since the study not held (queue register not loaded); limits not re-run.` };
  const W = counts.W || 0;
  const big = [...nearby].filter(x => ok(x.mw)).sort((a, b) => b.mw - a.mw)[0] || null;
  const where = big ? `; largest within ${ok(radiusMi) ? `${radiusMi} mi` : 'reach'} Q${big.qp} ${big.mw.toLocaleString('en-US', { maximumFractionDigits: 1 })} MW, ${ok(big.mi) ? `${big.mi.toFixed(1)} mi` : 'distance not held'}` : '';
  return { withdrawn: W, total, largest: big, text: `Study case ${STUDY_VINTAGE}: ${W} of ${total} modelled requests since withdrawn${where}; limits not re-run.` };
}

/** C39: one label for the count on every surface (Grid KPIs, Market columns). */
export const PRE_EXISTING_LABEL = 'Pre-existing overloads';
/** Pre-existing overloads from both sources, labelled apart (FORMULAS D6), over the cases the technology uses only
 *  (C39: a solar plant is never charged with the shoulder-charge envelope's count). Envelope: the most in any applicable
 *  case, with that case named. Element: rows at or above 100% before the project over the applicable element cases;
 *  null (not held) unless an applicable case has an element status held / unpublished / no violations. */
export function preExistingCounts(grid, bus, tech) {
  const c = applicableCases(tech), all = [...c.export, ...c.import];
  const env = (grid?.headroom || []).filter(h => String(h.bus_id) === String(bus) && all.includes(`${h.scenario}|${h.direction}`) && ok(h.pre_existing_issues));
  const top = env.length ? env.reduce((a, b) => (b.pre_existing_issues > a.pre_existing_issues ? b : a)) : null;
  const keys = all.filter(k => k !== 'shoulder|discharge');
  let element = 0, held = 0; const elementCases = [];
  for (const k of keys) { const el = elementLimit(grid, bus, k); if (['held', 'unpublished', 'noViolation'].includes(el.status)) { held++; element += el.pre.length; elementCases.push(CASE_LABEL[k]); } }
  return { envelope: top ? top.pre_existing_issues : null, envelopeCase: top ? CASE_LABEL[`${top.scenario}|${top.direction}`] : null,
    element: held ? element : null, elementCases,
    note: 'Envelope: fact_headroom pre_existing_issues, most in any case this technology uses (vendor, headline set). Element: rows in the element list at or above 100% loading before the project, over this service\'s element cases (2026-05 set). Different sources; both are shown.' };
}
/** "envelope N (vendor, case) · element M (cases)"; each side "not held" with its reason. */
export function preExistingText(p) {
  const e = p.envelope == null ? 'envelope not held' : `envelope ${p.envelope} (vendor, ${p.envelopeCase})`;
  const m = p.element == null ? 'element not held (no element list in this technology\'s cases)' : `element ${p.element} (${p.elementCases.join(', ')})`;
  return `${e} · ${m}`;
}
/** The largest size without upgrades IS the governing limit (FORMULAS D7: never truncated); null when not held. */
export const largestWithoutUpgrades = lim => (ok(lim) ? lim : null);
/** Unpriced scope over every allocator row (FORMULAS D2): network facilities, gap rows, direct and affected-system scope. */
export function unpricedScope(rows) {
  const un = (rows || []).filter(r => r.cost == null), network = un.filter(r => r.category === 'Network upgrade').length;
  return { total: un.length, network, other: un.length - network, labels: un.map(r => r.label) };
}
/** Queue requests near the bus (FORMULAS D1): the total is the sum of exactly the requests listed, all of them. */
export function queueNearbySummary(q) {
  const listed = (q || []).filter(x => x);
  return { n: listed.length, mw: listed.map(x => x.mw).filter(ok).reduce((a, b) => a + b, 0), notHeld: listed.filter(x => !ok(x.mw)).length, listed };
}

/** Step-function upgrade cost at size S for one case: facilities that overload below S. */
export function stepCost(grid, bus, key, S) {
  const el = elementLimit(grid, bus, key);
  if (!ok(S) || S <= 0) return { status: 'Not requested', total: null, items: [] };
  if (el.status === 'noViolation') return { status: 'Not held', total: null, items: [], reason: 'No violations found, but the tested maximum is not published' };
  if (el.status !== 'held') return { status: 'Not held', total: null, items: [], reason: el.status === 'mislabel' ? 'No usable element list for this case' : 'No element list for this case' };
  const items = el.rows.filter(r => !el.pre.includes(r) && ok(r.transfer_mw) && r.transfer_mw > 0 && r.transfer_mw < S)
    .map(r => ({ id: `${r.monitored_facility?.trim()}|${r.binding_contingency}`, key: facilityKey(r.monitored_facility, r.facility_type), label: r.monitored_facility?.trim(), contingency: r.binding_contingency, transfer: r.transfer_mw, cost: costOf(r), dfax: r.dfax, type: r.facility_type }));
  const priced = items.filter(i => i.cost != null);
  const contingent = el.pre.filter(r => ok(r.dfax) && r.dfax > 0).length;
  return { status: items.length ? (priced.length === items.length ? 'Priced' : 'Partly priced') : 'True zero', total: priced.reduce((t, i) => t + i.cost, 0), unpriced: items.length - priced.length, items, contingent, reason: items.length ? '' : `No facility overloads below ${S} MW` };
}

/** Cost cases: every applicable case of the direction. Data centres now include summer-peak charge, which binds
 *  below large load on 1,225 buses (all-bus review H5; supersedes the §G4 large-load-only rule). */
export function costCases(tech, dir) {
  return applicableCases(tech)[dir];
}

/** How a case without element costs affects the total: 'binds' → lower bound; 'unverified' → no upgrades indicated. */
function caseGap(grid, bus, key, S) {
  const el = elementLimit(grid, bus, key), env = envelope(grid, bus, key);
  if (el.status === 'unpublished') return { kind: 'binds', reason: 'Every listed facility is already overloaded, so the limit is not published', envelope: env };
  // Re-review R1: with the tested maximum unknown, an envelope below the request (or none) means it may bind.
  if (el.status === 'noViolation') return !ok(env) || env < S ? { kind: 'binds', reason: `No violations found, but the tested maximum is not published and the envelope${ok(env) ? ` (${Math.round(env)} MW)` : ''} is below the request`, envelope: env } : { kind: 'unverified', reason: 'No violations found, but the tested maximum is not published', envelope: env };
  const list = el.status === 'mislabel' ? 'No usable element list' : 'No element list';
  // C10: say "no envelope" only when none is held (103029 shoulder charge holds 57.3 MW).
  if (!ok(env)) return { kind: 'binds', reason: `${list} and no envelope`, envelope: env };
  if (env < S) return { kind: 'binds', reason: `${list}; the envelope (${Math.round(env)} MW) is below the request`, envelope: env };
  return { kind: 'unverified', reason: `Envelope only (${Math.round(env)} MW, headline set, vendor-asserted); no facility list to confirm`, envelope: env };
}
/** C10: a case resting on the envelope only leaves the bill unverified, so priced facilities plus such a case are a
 *  lower bound (never "Priced", never a complete $/kW). */
function costStatus(items, unpriced, gaps, unverified) {
  if (gaps.length) return 'Lower bound';
  if (items.length) return unverified.length ? 'Lower bound' : unpriced ? 'Partly priced' : 'Priced';
  return unverified.length ? 'No upgrades indicated' : 'True zero';
}
/** The cost result's total and known part. A bound with nothing priced has total null ("not held"), never a $0
 *  figure; known = the priced sum (0 when none), for the allocator. */
function costTotals(status, priced) {
  const known = priced.reduce((t, i) => t + i.cost, 0);
  return { total: !priced.length && ['Lower bound', 'Partly priced'].includes(status) ? null : known, known };
}
function boundWhy(gaps, unverified, items) {
  return [...gaps.map(g => `${g.label} may bind (${g.reason})`), ...(items.length ? unverified.map(u => `${u.label}: envelope only, unverified`) : [])];
}
/**
 * One display rule for an upgrade-cost result, every surface ("≥ $0.0M" finding): a bound with nothing priced reads
 * "not held: <cases> may bind"; envelope-only reads "none indicated (unverified)"; a bound with priced items "≥ $X".
 */
export function costDisplay(c, money = v => `$${v.toFixed(2)}M`) {
  if (!c || c.status === 'Not requested') return '—';
  if (c.status === 'Not held') return 'not held';
  if (c.status === 'No upgrades indicated') return 'none indicated (unverified)';
  const cases = [...(c.gaps || []).map(g => g.label), ...((c.items || []).length ? (c.unverified || []).map(u => u.label) : [])];
  if (!ok(c.total)) return `not held: ${cases.length ? `${cases.join(', ')} may bind` : 'no facility priced'}`;
  if (c.status === 'Lower bound') return `≥ ${money(c.total)}${cases.length ? `: ${cases.join(', ')} not verified` : ''}`;
  if (c.status === 'Partly priced') return `≥ ${money(c.total)}: ${c.unpriced} unpriced`;
  return money(c.total);
}

/**
 * Upgrade cost at size S across all applicable cases of a direction (Stage 1 N1).
 * Facilities are unioned across cases (deduplicated). A true $0 is reported only when every case
 * has element evidence below S. A case without element data that binds below S makes the answer a
 * lower bound ("≥ $X: <case> upgrades not held"); one confirmed only by an envelope is 'unverified' (no true zero).
 */
export function stepCostAll(grid, bus, tech, S, dir) {
  if (!ok(S) || S <= 0) return { status: 'Not requested', total: null, known: null, items: [], gaps: [], unverified: [], boundWhy: [] };
  const byId = new Map(), gaps = [], unverified = [];
  let contingent = 0;
  for (const key of costCases(tech, dir)) {
    const c = stepCost(grid, bus, key, S);
    if (c.status === 'Not held') {
      const g = caseGap(grid, bus, key, S);
      (g.kind === 'binds' ? gaps : unverified).push({ key, label: CASE_LABEL[key], reason: g.reason, envelope: g.envelope });
      continue;
    }
    contingent += c.contingent || 0;
    for (const i of c.items) mergeItem(byId, { ...i, case: CASE_LABEL[key] });
  }
  return costResult([...byId.values()], gaps, unverified, contingent);
}
/** C11: one physical facility once (keyed by facilityKey: reversed ends and 3-winding legs collapse), at its highest cost. */
function mergeItem(byKey, i) {
  const k = i.key ?? i.label, prev = byKey.get(k);
  if (!prev || (i.cost ?? -1) > (prev.cost ?? -1)) byKey.set(k, i);
}
function costResult(items, gaps, unverified, contingent) {
  const priced = items.filter(i => i.cost != null), unpriced = items.length - priced.length;
  const status = costStatus(items, unpriced, gaps, unverified), { total, known } = costTotals(status, priced);
  return { status, total, known, items, unpriced, gaps, unverified, contingent, boundWhy: boundWhy(gaps, unverified, items) };
}

/**
 * C13: the MW a service charges (withdraws) at, one convention on every surface. Storage charges at its power rating
 * (max of import and export); a hybrid's battery is its own rating, importMW (0 = no battery, no charge test); a data
 * centre withdraws importMW; solar and wind do not charge.
 */
export function chargeMW(tech, exportMW, importMW) {
  const e = Number(exportMW) || 0, i = Number(importMW) || 0;
  if (tech === 'storage') return Math.max(i, e);
  if (tech === 'hybrid' || tech === 'datacenter') return i;
  return 0;
}
/**
 * Upgrade cost for the whole service: the export cases at exportMW and, for storage and hybrids, the charge cases at
 * chargeMW (C13); results are unioned by facility and gaps merged.
 */
export function stepCostService(grid, bus, tech, exportMW, importMW) {
  if (tech === 'datacenter') return stepCostAll(grid, bus, tech, importMW, 'import');
  const ex = stepCostAll(grid, bus, tech, exportMW, 'export');
  if (!['storage', 'hybrid'].includes(tech)) return ex;
  const im = stepCostAll(grid, bus, tech, chargeMW(tech, exportMW, importMW), 'import');
  if (ex.status === 'Not requested') return im;
  if (im.status === 'Not requested') return ex;
  const byKey = new Map();
  for (const i of [...ex.items, ...im.items]) mergeItem(byKey, i);
  return costResult([...byKey.values()], [...ex.gaps, ...im.gaps], [...ex.unverified, ...im.unverified], (ex.contingent || 0) + (im.contingent || 0));
}

// ---------- v3 analytics (Grid dashboard, 2026-09-29). Additions only; the API above is unchanged. ----------
const FACILITY_FIXED = /^\s*(\d{4,7}) (.{12})\s*(\d+(?:\.\d+)?)\s+(\d{4,7}) (.{12})\s*(\d+(?:\.\d+)?)\s+(\S+)\s*$/;
const FACILITY_RX = /^\s*(\d{4,7})\s(.{1,12}?)\s*(\d+(?:\.\d+)?)\s+(\d{4,7})\s(.{1,12}?)\s*(\d+(?:\.\d+)?)\s+(\S+)\s*$/;
/** PSS/E fixed-width facility label → {a, aName, kv, b, bName, ckt, key}; key = lo-hi-ckt whichever end is first. */
export function parseFacility(s) {
  const m = FACILITY_FIXED.exec(String(s ?? '')) || FACILITY_RX.exec(String(s ?? '')); // fixed 12-char names first (a name may end in digits)
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[4]);
  return { a, aName: m[2].trim(), kv: Number(m[3]), b, bName: m[5].trim(), ckt: m[7].trim(), key: `${Math.min(a, b)}-${Math.max(a, b)}-${m[7].trim()}` };
}
/** Star points of 3-winding transformers in the store's PSS/E model: dim_bus numbers 999278–999997 (720 fictitious
 *  buses, e.g. 999997 ORRINGTON T1; dim_transformer names the same T1 by star bus 100003). */
export const STAR_BUS_MIN = 999000;
/**
 * C11: identity of one physical facility. Reversed ends are one facility (parseFacility key lo-hi-ckt); the legs of a
 * 3-winding transformer (facility_type "Transformer 3-Windings") are one transformer, keyed by their shared star point,
 * so Powersville's ORRINGTON T1 legs 999997–100002 and 103027–999997 cost once. Unparsable labels key on the label.
 */
export function facilityKey(label, type) {
  const p = parseFacility(label);
  if (!p) return String(label ?? '').trim();
  if (/3-wind/i.test(String(type ?? ''))) { const s = [p.a, p.b].filter(x => x >= STAR_BUS_MIN); if (s.length === 1) return `3w-${s[0]}`; }
  return p.key;
}
/** Tolerance for a stored transfer_mw against its recomputation, (rating − flow) ÷ DFAX (C11: 103005's stored 1396.6 vs 1737.1). */
export const TRANSFER_TOL = 0.05;
/** Stored vs recomputed transfer on the row's own basis; differs = more than TRANSFER_TOL apart (the stored figure is shown, flagged). */
export function transferCheck(r) {
  const stored = ok(r?.transfer_mw) ? r.transfer_mw : null, recomputed = r ? recomputeTransfer(r) : null;
  const differs = stored != null && recomputed != null && Math.abs(stored - recomputed) > TRANSFER_TOL * Math.abs(recomputed);
  return { stored, recomputed, differs, diffPct: stored != null && recomputed ? (100 * (stored - recomputed)) / Math.abs(recomputed) : null };
}
/** $M over MW → $/kW; null when either side is not held. */
export function perKw(totalMusd, mw) { return ok(totalMusd) && ok(mw) && mw > 0 ? (totalMusd * 1000) / mw : null; }
/** Short-circuit metrics (the live Studio's convention): ratio at the request, the size at a ratio of 3, fault current (suspect above 63 kA). */
export function scMetrics(scMVA, kv, mw) {
  const sc = ok(scMVA) && scMVA > 0 ? scMVA : null;
  const kAraw = sc != null && ok(kv) && kv > 0 ? sc / (Math.sqrt(3) * kv) : null;
  return { sc, scr: sc != null && ok(mw) && mw > 0 ? sc / mw : null, mwAtRatio3: sc != null ? sc / 3 : null, kA: kAraw != null && kAraw <= 63 ? kAraw : null, kAraw, kASuspect: kAraw != null && kAraw > 63 };
}
/** Service MW at sweep size S. C13: a hybrid's battery stays at its own rating (opts.importMW) when given. */
const serviceArgs = (tech, S, opts = {}) => (tech === 'datacenter' ? [0, S] : tech === 'hybrid' && ok(opts.importMW) ? [S, opts.importMW] : ['storage', 'hybrid'].includes(tech) ? [S, S] : [S, 0]);
/** Connection status and upgrade cost at each size, from the same engine as the rest of the dashboard. */
export function sizeSweep(grid, bus, tech, sizes, opts = {}) {
  return sizes.filter(s => ok(s) && s > 0).map(size => {
    const [e, i] = serviceArgs(tech, size, opts), t = caseTable(grid, bus, tech, e, i);
    const bs = [binding(t, 'export'), binding(t, 'import')].filter(b => b.status !== 'Not requested');
    const fits = bs.length && bs.every(b => b.status === 'Fits') ? true : bs.some(b => b.status === 'Does not fit') ? false : null;
    const cost = stepCostService(grid, bus, tech, e, i);
    return { size, fits, statuses: bs.map(b => b.status), limit: bs.map(b => b.value).filter(ok).reduce((a, b) => Math.min(a, b), Infinity), cost,
      overloaded: cost.items ? cost.items.length : null, perKw: ['Priced', 'True zero'].includes(cost.status) ? perKw(cost.total, size) : null };
  }).map(r => ({ ...r, limit: Number.isFinite(r.limit) ? r.limit : null }));
}
/**
 * Cost to unlock: one step per distinct facility limit; the cumulative total is the cost engine just above that limit.
 * C11: a step's cost counts only facilities not already counted at a lower step (keyed by facilityKey), at the engine's
 * own item cost, so the step column sums to the running total; an already-counted facility steps 0 (counted: true).
 * C13: a hybrid with opts.importMW keeps its battery at that rating, so only its export cases step.
 */
export function unlockSteps(grid, bus, tech, opts = {}) {
  const c = applicableCases(tech), fixedBatt = tech === 'hybrid' && ok(opts.importMW);
  const keys = tech === 'datacenter' ? c.import : ['storage', 'hybrid'].includes(tech) && !fixedBatt ? [...c.export, ...c.import] : c.export;
  const rows = [];
  for (const k of keys) { const el = elementLimit(grid, bus, k); if (el.status === 'held') for (const r of el.rows) if (!el.pre.includes(r) && ok(r.transfer_mw) && r.transfer_mw > 0) rows.push({ r, k }); }
  const cost = S => stepCostService(grid, bus, tech, ...serviceArgs(tech, S, opts));
  const ts = [...new Set(rows.map(x => x.r.transfer_mw))].sort((a, b) => a - b);
  const counted = new Set();
  const steps = ts.map(t => {
    const at = rows.filter(x => x.r.transfer_mw === t), s = cost(t + 1e-6 * Math.max(1, t));
    const here = [...new Set(at.map(x => facilityKey(x.r.monitored_facility, x.r.facility_type)))], fresh = here.filter(k => !counted.has(k));
    fresh.forEach(k => counted.add(k));
    const byKey = new Map((s.items || []).map(i => [i.key, i])), costs = fresh.map(k => byKey.get(k)?.cost ?? null);
    const stepCost = !fresh.length ? 0 : costs.some(v => v != null) ? costs.reduce((a, v) => a + (v ?? 0), 0) : null;
    return { mw: t, facility: [...new Set(at.map(x => x.r.monitored_facility?.trim()))].join('; '), cases: [...new Set(at.map(x => CASE_LABEL[x.k]))], cost: stepCost, counted: !fresh.length,
      unpricedHere: costs.filter(v => v == null).length, cum: s.total, status: s.status, unpriced: s.unpriced || 0 };
  });
  return { start: cost(1), steps, cases: keys };
}
/** C72: the size sweep's answer: the largest swept step that fits, and the exact limit (never the step) beside it. */
export function sweepSummary(sweep, exactMW, limitLabel = 'limit', fmtMW = v => `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 })} MW`) {
  const last = (sweep || []).filter(r => r.fits === true).at(-1) || null;
  const exact = ok(exactMW) ? exactMW : null;
  const text = last ? `largest swept step that fits is ${fmtMW(last.size)}; exact limit ${exact == null ? 'not held' : fmtMW(exact)} (${limitLabel})` : `no swept step fits on element-study evidence in every case; exact limit ${exact == null ? 'not held' : fmtMW(exact)} (${limitLabel})`;
  return { largestStep: last ? last.size : null, exact, text };
}
/** Loading before (MW = 0) and at the request, on each row's own screening basis. */
export function loadingBars(el, req) {
  return (el.rows || []).map(r => ({ facility: r.monitored_facility?.trim(), contingency: r.binding_contingency, before: loadingAt(r, 0), after: ok(req) && req > 0 ? loadingAt(r, req) : null,
    pre: el.pre.includes(r), transfer: r.transfer_mw, dfax: r.dfax, rate: loadingBasis(r).rate, type: r.facility_type, kv: r.kv }));
}
const isPreRow = r => (ok(r.pct_loading_no_transfer) && Math.abs(r.pct_loading_no_transfer) >= 100) || (ok(r.transfer_mw) && r.transfer_mw < 0);
/** Facility rows grouped by type and kV: count, pre-existing, lowest positive limit, priced facilities and their cost (distinct facilities). */
export function typeVoltageSummary(rows) {
  const g = new Map();
  rows.forEach((r, i) => {
    const k = `${r.facility_type || 'not held'}|${ok(r.kv) ? r.kv : 'not held'}`;
    if (!g.has(k)) g.set(k, { type: r.facility_type || 'not held', kv: ok(r.kv) ? r.kv : null, n: 0, pre: 0, minTransfer: null, costs: new Map(), ids: new Set() });
    const x = g.get(k); x.n++;
    if (isPreRow(r)) x.pre++; else if (ok(r.transfer_mw) && r.transfer_mw > 0) x.minTransfer = x.minTransfer == null ? r.transfer_mw : Math.min(x.minTransfer, r.transfer_mw);
    const c = costOf(r), id = r.monitored_facility?.trim() ? facilityKey(r.monitored_facility, r.facility_type) : `row${i}`; // C11: reversed ends / 3-winding legs once
    x.ids.add(id);
    if (c != null) x.costs.set(id, Math.max(x.costs.get(id) ?? -1, c));
  });
  return [...g.values()].map(({ costs, ids, ...x }) => ({ ...x, facilities: ids.size, priced: costs.size, costTotal: costs.size ? [...costs.values()].reduce((a, b) => a + b, 0) : null }))
    .sort((a, b) => (b.kv ?? 0) - (a.kv ?? 0) || a.type.localeCompare(b.type));
}
export const SEVERITY_BANDS = [[0, 50, '< 50%'], [50, 70, '50–70%'], [70, 80, '70–80%'], [80, 90, '80–90%'], [90, 100, '90–100%'], [100, Infinity, '≥ 100%']];
/** Count |loading before| per band; values not held are counted apart (out.notHeld). */
export function severityBins(values) {
  const out = SEVERITY_BANDS.map(([lo, hi, label]) => ({ label, lo, hi, n: 0 }));
  out.notHeld = 0;
  for (const v of values) { if (!ok(v)) { out.notHeld++; continue; } const a = Math.abs(v); out.find(b => a >= b.lo && a < b.hi).n++; }
  return out;
}
/** The study's injection test at a size: the exact tested size, or the tested sizes either side. Never interpolated. */
export function studyAtSize(study, mw) {
  if (!Array.isArray(study)) return null;
  const t = study.filter(r => r.tested);
  return { exact: t.find(r => r.mw === mw) || null, below: t.filter(r => r.mw <= mw).sort((a, b) => b.mw - a.mw)[0] || null, above: t.filter(r => r.mw >= mw).sort((a, b) => a.mw - b.mw)[0] || null };
}
/** Offered energy of the test profile = curtailed MWh ÷ curtailed share (only where the share is above 0). */
export function offeredMwh(r) { return r?.tested && ok(r.pct) && r.pct > 0 && ok(r.mwh) ? r.mwh / (r.pct / 100) : null; }
/** Delivered value per offered MWh = (1 − curtailed share) × the study's average LMP after the injection. */
export function deliveredValue(r) { return r?.tested && ok(r.pct) && ok(r.avg_lmp) ? (1 - r.pct / 100) * r.avg_lmp : null; }
// ---------- v5 (gap brief v4, Grid): service type, affected systems, proportional impact, surplus, SCR, Order 1920 ----------
/**
 * Interconnection service behind a headroom figure. The store's envelopes are ISO-NE NCIS results (column names
 * "… NCIS Substation …"): Network Resource (NR) service, energy-only, the ERIS-type service. Storage charging is
 * part of the same NR request (studied at shoulder only). A large load has no interconnection service type.
 */
/** The proposed large-load service codes from the rules file (large_load.services.rows); null when not loaded. */
function llServiceCodes() {
  try { const rows = RX.getRules()?.large_load?.services?.rows; return Array.isArray(rows) && rows.length ? rows.map(r => r.code) : null; } catch { return null; }
}
/**
 * C34: a data centre's withdrawal cases (summer-peak charge as well as large load) carry the load's own tag, never the
 * generator NR / ERIS-type tag; pass tech so the same case key reads right for storage charging and for a load.
 */
export function serviceTag(key, tech = null) {
  const [sc, dir] = String(key).split('|');
  if (sc === 'large_load' || tech === 'datacenter') {
    const codes = llServiceCodes(), list = codes ? codes.join(' / ') : 'service list not held (rules file not loaded)';
    return { code: 'LOAD', short: `Load · ${codes ? codes.join(' / ') : 'withdrawal'}`, long: `Large-load withdrawal, firm or non-firm contract demand (${list}; rules/isone-2026.json large_load.services), proposed: no ISO-NE large-load interconnection procedure yet: the FERC EL26-72 response is pending (filing date and badge: rules/isone-2026.json large_load.filing)` };
  }
  if (dir === 'charge') return { code: 'NR', short: 'NR · charging', long: 'NR (NCIS) request, charging side: energy-only, ERIS-type' };
  return { code: 'NR', short: 'NR · energy-only', long: 'NR (NCIS) interconnection service: energy-only, ERIS-type' };
}
/** C42: dim_substation.max_injection_ccis_mw equals the summer-peak NCIS envelope on most buses; what it is has not been
 *  confirmed with the vendor (REGISTER row 33 defines CCIS as a separate criterion), so no surface uses it as CCIS. */
export const CCIS_NOTE = 'a column named max_injection_ccis_mw exists in dim_substation, but it is vendor data of unconfirmed meaning (it equals the summer-peak NCIS envelope on most buses) and is not used here';
/** Capacity (CNR, CCIS) service can never exceed the NR figure; with no deliverability screen it is only a bound. */
export function cnrBound(nr) {
  return ok(nr) ? { value: null, upperBound: nr, text: `CNR ≤ ${nr.toFixed(1)} MW (no deliverability screen held)` } : { value: null, upperBound: null, text: 'CNR not held (NR not held)' };
}
/** Study areas this screen does not establish, each with its reason (kept "Not assessed"). */
export const NOT_ASSESSED = [
  { area: 'N-1-1', status: 'Not assessed', why: 'The store holds single-contingency (N-1) facility rows only; no second-contingency (N-1-1) cases were run or published.' },
  { area: 'Voltage / reactive', status: 'Not assessed', why: 'No AC voltage or reactive-power study is in the snapshot; the thermal screen is a linear (DC) transfer calculation.' },
  { area: 'Stability / inverter-based resource performance', status: 'Not assessed', why: 'No dynamic (transient or small-signal) study is held; the short-circuit figures below are an indicator, not a stability result.' },
  { area: 'Protection, breaker duty', status: 'Not assessed', why: 'No breaker ratings or protection settings are held; fault duty is shown only as system strength.' },
];

/**
 * Affected-system tie adjacency (indicator). input: busArea (dim_bus.pf_area), homeArea (ISO-NE's power-flow area),
 * ties [{mi, label, name}] (dim_branch rows whose from_area ≠ to_area, distance from the bus to the ISO-NE end),
 * facilityEnds [{facility, areas:[pf_area of each end], labels}]. Levels: 3 facility reaches a neighbour, 2 bus outside
 * the home area, 1 tie within nearMi, 0 not indicated. "Not indicated" is never "no affected system".
 */
export function affectedSystemFlag({ busArea, homeArea = '101', ties = [], facilityEnds = [] } = {}, { nearMi = 25 } = {}) {
  const tl = [...ties].filter(t => ok(t.mi)).sort((a, b) => a.mi - b.mi), nearest = tl[0] || null;
  const unmappedEnds = facilityEnds.reduce((n, f) => n + (f.areas || []).filter(a => a == null).length, 0);
  if (busArea == null) return { flag: 'Not held', level: null, reasons: ['The bus carries no power-flow area.'], nearest, unmappedEnds, external: [] };
  const external = facilityEnds.filter(f => (f.areas || []).some(a => a != null && String(a) !== String(homeArea)));
  const reasons = [];
  if (external.length) reasons.push(`${external.length} limiting facilit${external.length === 1 ? 'y has' : 'ies have'} an end outside the ISO-NE area`);
  if (String(busArea) !== String(homeArea)) reasons.push(`the bus is in power-flow area ${busArea}, not ${homeArea}`);
  if (nearest && nearest.mi <= nearMi) reasons.push(`nearest tie (${nearest.label}) is ${nearest.mi.toFixed(1)} mi away, within ${nearMi} mi`);
  const level = external.length ? 3 : String(busArea) !== String(homeArea) ? 2 : nearest && nearest.mi <= nearMi ? 1 : 0;
  const flag = ['Not indicated', 'Tie-adjacent', 'Bus outside the ISO-NE area', 'Limiting facility reaches a neighbouring system'][level];
  if (!level) reasons.push(nearest ? `nearest tie is ${nearest.mi.toFixed(1)} mi away (beyond ${nearMi} mi) and no limiting facility leaves the ISO-NE area` : 'no tie is located');
  return { flag, level, reasons, nearest, unmappedEnds, external };
}

/**
 * Proportional-impact allocation over a user-defined cluster (Order 2023: network-upgrade costs assigned by the
 * proportional impact method, each request paying by its contribution to the need). Impact_i,f = max(0, DFAX_i,f) ×
 * MW_i; share = impact ÷ Σ impacts. A member whose DFAX is not held leaves the denominator short, so the project's
 * share is an UPPER bound. Unpriced facilities are counted, never $0.
 * facilities [{id, label, cost|null, dfax:{bus: number|null}}], members [{bus, mw, self?}].
 */
export function proportionalImpact(facilities, members) {
  const self = members.find(m => m.self);
  const out = facilities.map(f => {
    const ms = members.map(m => { const d = f.dfax?.[m.bus]; const held = ok(d) && ok(m.mw); return { bus: m.bus, self: !!m.self, mw: m.mw, dfax: ok(d) ? d : null, impact: held ? Math.max(0, d) * m.mw : null }; });
    const denom = ms.reduce((a, m) => a + (m.impact ?? 0), 0), missing = ms.filter(m => m.impact == null && !m.self).length;
    const mine = ms.find(m => m.self);
    for (const m of ms) m.share = m.impact != null && denom > 0 ? m.impact / denom : null;
    const share = mine?.impact == null ? null : denom > 0 ? mine.impact / denom : null;
    for (const m of ms) m.allocation = ok(f.cost) && m.share != null ? f.cost * m.share : null;
    return { id: f.id, label: f.label, cost: ok(f.cost) ? f.cost : null, members: ms, share, missing, bound: missing ? 'upper' : 'exact', allocation: ok(f.cost) && share != null ? f.cost * share : null };
  });
  const unpriced = out.filter(f => f.cost == null).length, notHeld = out.filter(f => f.cost != null && f.share == null).length;
  const held = out.filter(f => f.allocation != null);
  const status = !out.length ? 'No facilities' : out.some(f => f.missing) ? 'Upper bound' : unpriced || notHeld ? 'Partly priced' : 'Allocated';
  const standaloneTotal = out.some(f => f.cost != null) ? out.reduce((a, f) => a + (f.cost ?? 0), 0) : null;
  return { facilities: out, members, self: self?.bus ?? null, unpriced, notHeld, status, projectTotal: held.length ? held.reduce((a, f) => a + f.allocation, 0) : null,
    standaloneTotal, pp56: clusterAllocation(facilities, members, standaloneTotal) };
}
/**
 * S3 #5: ISO-NE's own allocation (PP5-6 Rev 15 §10.4.4 / Sched 11 §5, rules/isone.js allocateProportional): one share
 * of the cluster's upgrade cost per participant = Σ over elements of MW × max(DFAX_NR, DFAX_CNR), counted only where
 * that DFAX exceeds the rules-file threshold (3%), ÷ Σ over participants. The store holds one DFAX per bus and
 * facility (no NR/CNR split), so dfaxNR = that value. cost = the priced facilities' total ($M); null → share held,
 * cost not held. Returns the project's row with the engine's status, threshold and citation.
 */
export function clusterAllocation(facilities, members, cost) {
  const self = members.find(m => m.self);
  const total = cost === undefined ? (facilities.some(f => ok(f.cost)) ? facilities.reduce((a, f) => a + (ok(f.cost) ? f.cost : 0), 0) : null) : cost;
  const participants = members.map(m => ({ id: m.bus, mw: m.mw, impacts: facilities.map(f => ({ element: f.id, dfaxNR: f.dfax?.[m.bus] })) }));
  const a = RX.allocateProportional(participants, total);
  const mine = (a.rows || []).find(r => r.id === self?.bus) || null;
  const chargedElements = mine ? mine.elements.filter(e => e.charged).map(e => e.element) : [];
  if (!facilities.length) return { status: 'not_applicable', reason: 'no facility overloads below the request, so there is nothing to allocate', share: null, cost: null, impact: null, totalImpact: null, threshold: a.threshold ?? null, cite: a.cite, rows: [], chargedElements, standaloneTotal: total };
  return { status: a.status, reason: a.reason, share: mine ? mine.share : null, cost: mine ? mine.cost : null, impact: mine ? mine.impact : null,
    totalImpact: a.total ?? null, threshold: a.threshold ?? null, cite: a.cite, rows: a.rows || [], chargedElements, standaloneTotal: total };
}
/** "bus:MW, bus:MW" → members; the project's own bus, duplicates, and non-positive or unparsable entries are reported. */
export function parseCluster(text, selfBus) {
  const members = [], errors = [], seen = new Set();
  for (const raw of String(text ?? '').split(/[,;\n]+/).map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d{1,9})\s*:\s*(-?\d+(?:\.\d+)?)$/.exec(raw);
    if (!m) { errors.push(`"${raw}" is not bus:MW`); continue; }
    const bus = m[1], mw = Number(m[2]);
    if (bus === String(selfBus)) { errors.push(`${bus} is the project's own bus`); continue; }
    if (!(mw > 0)) { errors.push(`${bus}: MW must be above 0`); continue; }
    if (seen.has(bus)) { errors.push(`${bus} listed twice`); continue; }
    seen.add(bus); members.push({ bus, mw });
  }
  return { members, errors };
}

/** Inverter-based resource by unit name (dim_generator carries no fuel): whole words solar / wind / WTG / PV / battery / BESS / storage. */
export const IBR_NAME = /\b(solar|wind|wtg|pv|batt|battery|bess|storage|ess)\b/i;
export const isIbrName = name => IBR_NAME.test(String(name ?? ''));
/**
 * Weighted short-circuit ratio INDICATOR (not an ISO-NE criterion; the vault holds no ISO-NE SCR threshold).
 * wSCR = SC_MVA ÷ (request + Σ w_i × MW_i) over nearby inverter-based units; w = 1 at the station, else
 * max(0, 1 − miles ÷ radius) (a distance proxy for electrical closeness: an assumption, no impedances are held).
 */
export function weightedScr({ scMVA, requestMW, ibr = [] } = {}, { radiusMi = 15 } = {}) {
  const label = 'Indicator only, not an ISO-NE criterion';
  const w = u => (u.atStation ? 1 : ok(u.mi) && u.mi <= radiusMi ? Math.max(0, 1 - u.mi / radiusMi) : 0);
  const rows = ibr.map(u => ({ ...u, weight: w(u), weighted: ok(u.mw) ? w(u) * u.mw : null }));
  const notHeld = rows.filter(u => u.weight > 0 && u.weighted == null).length;
  const counted = rows.filter(u => u.weight > 0 && u.weighted != null).length;
  const ibrWeightedMW = rows.reduce((a, u) => a + (u.weighted ?? 0), 0);
  const stationMW = rows.filter(u => u.atStation && ok(u.mw)).reduce((a, u) => a + u.mw, 0);
  const valid = ok(scMVA) && scMVA > 0 && ok(requestMW) && requestMW > 0;
  return { label, radiusMi, rows, counted, notHeld, bound: notHeld ? 'upper' : 'exact', ibrWeightedMW, stationMW,
    scr: valid ? scMVA / requestMW : null, wscr: valid ? scMVA / (requestMW + ibrWeightedMW) : null, stationOnly: valid ? scMVA / (requestMW + stationMW) : null };
}

/**
 * Surplus interconnection screen (G5) at an existing generator POI (Order 845; Order 2023 §3). The existing LGIA's
 * service level is not held: installed Pmax (dim_generator.max_capacity_mw) stands in for it (assumption). Surplus is
 * the unneeded part of that service, total POI injection unchanged, no new network upgrades; ERIS stays ERIS.
 */
export function surplusScreen({ units = [], requestMW, limitMW, tech } = {}) {
  const service = 'Inherits the original customer\'s service (not held); ERIS-original surplus stays ERIS (Order 845)';
  if (tech === 'datacenter') return { verdict: 'Not applicable', why: 'Surplus interconnection service is for generating (and storage) facilities; a load does not inject.', service, units: [], pmax: null, coverable: null };
  if (!units.length) return { verdict: 'Not applicable', why: 'No existing generating unit is held at this point of interconnection, so there is no existing service to share.', service, units, pmax: null, coverable: null };
  const pm = units.map(u => u.max_mw ?? u.max_capacity_mw), pmaxNotHeld = pm.filter(v => !ok(v)).length;
  const pmax = pm.filter(ok).reduce((a, v) => a + v, 0), dispatched = units.map(u => u.gen_mw).filter(ok).reduce((a, v) => a + v, 0);
  const coverable = ok(requestMW) && requestMW > 0 ? Math.min(requestMW, pmax) : null;
  let verdict, why;
  if (!ok(limitMW)) { verdict = 'Not established'; why = 'The connection limit is not held (Hold or not studied), so whether surplus service is needed cannot be shown.'; }
  else if (!(requestMW > limitMW)) { verdict = 'Not needed: fits the limit'; why = `The request fits the ${limitMW.toFixed(1)} MW limit without upgrades.`; }
  else { verdict = 'Candidate: needs a study'; why = `The request exceeds the ${limitMW.toFixed(1)} MW limit; up to ${coverable.toFixed(1)} MW could share the existing ${pmax.toFixed(1)} MW service in hours it is unused, with no new network upgrades, if the owner offers it and the study confirms.`; }
  return { verdict, why, service, units, pmax, pmaxNotHeld, pmaxBound: pmaxNotHeld ? 'lower' : 'exact', dispatched, coverable, operating: units.filter(u => u.status === 'Operating').length };
}

/**
 * Order 1920 §3: a regional facility for an interconnection-related need is evaluated when (1) the same upgrade was
 * identified in two queue cycles within five years, (2) it is ≥ 200 kV AND ≥ $30M, (3) it went unbuilt because the
 * driving request withdrew, (4) it is in no executed or filed interconnection agreement. Only (2) is testable here.
 */
export function order1920Screen(facilities) {
  const priced = facilities.filter(f => ok(f.cost));
  const meets = priced.filter(f => ok(f.kv) && f.kv >= 200 && f.cost >= 30);
  const costNotHeld = facilities.filter(f => !ok(f.cost) && ok(f.kv) && f.kv >= 200);
  return { meets, costNotHeld, checked: facilities.length, criteria: [
    { id: 1, text: 'Same upgrade identified in ≥ 2 queue cycles within 5 years', status: 'Not held', why: 'No cluster-study history is in the store' },
    { id: 2, text: '≥ 200 kV and ≥ $30M (both)', status: 'Screened', why: `${meets.length} of ${facilities.length} facilities meet both on the study cost${costNotHeld.length ? `; ${costNotHeld.length} at ≥ 200 kV have no cost held` : ''}` },
    { id: 3, text: 'Unbuilt because the driving request withdrew', status: 'Not held', why: 'Upgrade-to-request links are not in the store' },
    { id: 4, text: 'Not in an executed or filed interconnection agreement', status: 'Not held', why: 'Interconnection agreements are not in the store' },
  ] };
}

/** Unified value against the older copy: same within tol, else the difference (unified − older). */
export function copyNote(unified, older, tol = 0.05) {
  if (!ok(unified)) return { kind: 'unified not held', diff: null };
  if (!ok(older)) return { kind: 'older not held', diff: null };
  const diff = unified - older;
  return { kind: Math.abs(diff) <= tol ? 'same' : 'differs', diff };
}
