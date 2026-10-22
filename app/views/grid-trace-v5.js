// Grid v5 traces: weighted SCR indicator, surplus interconnection screen, affected-system tie adjacency,
// proportional-impact allocation and the Order 1920 screen. Each check is re-derived here with its own code
// (not by calling the gridrules function that produced the figure) or labelled a consistency / arithmetic re-check.
import { trace } from '../trace.js';
import { fmt } from '../basis.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const n1 = v => (ok(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : 'not held');
const n3 = v => (ok(v) ? v.toFixed(3) : 'not held');
const musd = v => (ok(v) ? `$${v.toFixed(2)}M` : 'not held');
const pct = v => (ok(v) ? `${(100 * v).toFixed(1)}%` : 'not held');

/** Weighted short-circuit ratio indicator. */
export function traceWscr(bus, sc, req, w, tech) {
  if (tech === 'datacenter') return trace({ id: 'g-wscr', title: 'Weighted short-circuit ratio (indicator)', formula: 'wSCR = SC_MVA ÷ (request + Σ w_i × MW_i)', inputs: [{ name: 'Service', value: 'data centre (load)', source: 'user' }], steps: [], result: { label: 'wSCR', value: 'not applicable' }, notes: ['No check possible: a short-circuit ratio screens inverter-based injection; a load is not screened on it here.'] });
  if (!ok(w.wscr)) return trace({ id: 'g-wscr', title: 'Weighted short-circuit ratio (indicator)', formula: 'wSCR = SC_MVA ÷ (request + Σ w_i × MW_i)', inputs: [{ name: 'Short-circuit MVA', value: n1(sc), source: 'measured' }, { name: 'Request', value: fmt.mw(req), source: 'user' }], steps: [], result: { label: 'wSCR', value: 'not held' }, notes: ['No check possible: the short-circuit MVA or the request is not held.'] });
  // Independent recompute of the weighted IBR MW from the rows (own weight code).
  const own = w.rows.reduce((a, u) => { const wt = u.atStation ? 1 : ok(u.mi) && u.mi <= w.radiusMi ? 1 - u.mi / w.radiusMi : 0; return a + (ok(u.mw) ? Math.max(0, wt) * u.mw : 0); }, 0);
  return trace({
    id: 'g-wscr', title: 'Weighted short-circuit ratio (indicator, not an ISO-NE criterion)',
    formula: `wSCR = SC_MVA ÷ (request_MW + Σ w_i × Pmax_i);  w_i = 1 at the station, else max(0, 1 − miles_i ÷ ${w.radiusMi});  SCR = SC_MVA ÷ request_MW`,
    inputs: [{ name: 'Short-circuit MVA', value: n1(sc), source: 'measured', note: 'unified dim_substation (corrected ×100 per data_quality)' },
      { name: 'Request', value: fmt.mw(req), source: 'user' },
      { name: 'Nearby inverter-based units', value: `${w.rows.length} within ${w.radiusMi} mi`, source: 'measured', note: 'dim_generator Pmax; classified by whole-word unit name (the table carries no fuel)' },
      { name: 'Distance weight', value: `linear to 0 at ${w.radiusMi} mi`, source: 'assumption', note: 'A distance proxy for electrical closeness; no impedances are held.' }],
    steps: [...w.rows.slice(0, 12).map(u => ({ label: `${u.name} (${u.atStation ? 'station' : `${n1(u.mi)} mi`})`, work: `${u.weight.toFixed(3)} × ${n1(u.mw)} MW`, value: ok(u.weighted) ? `${n1(u.weighted)} MW` : 'not held' })),
      { label: 'Weighted IBR MW', work: `Σ over ${w.counted} unit(s)${w.notHeld ? `; ${w.notHeld} without Pmax not counted` : ''}`, value: `${n1(w.ibrWeightedMW)} MW` },
      { label: 'SCR (project alone)', work: `${n1(sc)} ÷ ${n1(req)}`, value: n1(w.scr) },
      { label: 'Station-only SCR', work: `${n1(sc)} ÷ (${n1(req)} + ${n1(w.stationMW)})`, value: n1(w.stationOnly) },
      { label: 'wSCR', work: `${n1(sc)} ÷ (${n1(req)} + ${n1(w.ibrWeightedMW)})`, value: n1(w.wscr) }],
    result: { label: 'wSCR', value: `${w.bound === 'upper' ? '≤ ' : ''}${n1(w.wscr)}` },
    checks: [{ label: 'Independent recompute of the weighted IBR MW from the unit rows', a: own, b: w.ibrWeightedMW, atol: 1e-6, fmt: v => `${n1(v)} MW` },
      { label: 'Arithmetic re-check: wSCR × (request + weighted IBR) = SC MVA', a: w.wscr * (req + w.ibrWeightedMW), b: sc, tol: 1e-9, fmt: v => `${n1(v)} MVA` }],
    notes: ['Indicator only. The vault holds no ISO-NE short-circuit-ratio criterion; the thresholds used elsewhere (e.g. ERCOT\'s weighted SCR) are not ISO-NE rules.', w.notHeld ? 'Units without a Pmax are not counted, so the wSCR is an upper bound (≤).' : 'Every counted unit has a Pmax.'],
    csv: { name: `grid-wscr-${bus}.csv`, meta: [['bus', bus], ['radius_mi', w.radiusMi]], columns: ['unit', 'bus_id', 'status', 'at_station', 'miles', 'pmax_mw', 'weight', 'weighted_mw'], rows: w.rows.map(u => [u.name, u.bus_id, u.status, u.atStation, u.mi, u.mw, u.weight, u.weighted]) },
  });
}

/** Surplus interconnection screen at the existing POI. */
export function traceSurplus(bus, s, req, lim) {
  if (!s.units?.length) return trace({ id: 'g-surplus', title: 'Surplus interconnection screen (G5)', formula: 'coverable = min(request, Σ Pmax of existing units at the POI)', inputs: [{ name: 'Existing units at the POI', value: '0', source: 'measured', note: 'dim_generator at the station buses' }], steps: [], result: { label: 'Screen', value: s.verdict }, notes: [`No check possible: ${s.why}`] });
  const own = s.units.reduce((a, u) => a + (ok(u.max_mw) ? u.max_mw : 0), 0);
  return trace({
    id: 'g-surplus', title: 'Surplus interconnection screen (G5)',
    formula: 'existing service ≈ Σ Pmax at the POI (assumption: the LGIA MW is not held);  needs surplus = request > connection limit;  coverable = min(request, existing service)',
    inputs: [...s.units.map(u => ({ name: `${u.name} (${u.status})`, value: `${n1(u.max_mw)} MW Pmax · ${n1(u.gen_mw)} MW in the case`, source: 'measured', note: 'dim_generator' })),
      { name: 'Request', value: fmt.mw(req), source: 'user' }, { name: 'Connection limit', value: ok(lim) ? fmt.mw(lim) : 'not held', source: 'derived', note: 'Grid rules: binding export limit (element study, else envelope)' },
      { name: 'Surplus rule', value: 'Order 845 / Order 2023 §3', source: 'rule', note: 'Unneeded part of an existing LGIA\'s service; total POI service unchanged; no new network upgrades; ERIS-original surplus stays ERIS.' }],
    steps: [{ label: 'Existing service (Pmax proxy)', work: s.units.map(u => n1(u.max_mw)).join(' + '), value: `${n1(s.pmax)} MW${s.pmaxBound === 'lower' ? ' (lower bound)' : ''}` },
      { label: 'Needs surplus?', work: ok(lim) ? `${n1(req)} > ${n1(lim)}` : 'limit not held', value: ok(lim) ? String(req > lim) : 'not established' },
      { label: 'Coverable by surplus', work: `min(${n1(req)}, ${n1(s.pmax)})`, value: `${n1(s.coverable)} MW` }],
    result: { label: 'Screen', value: s.verdict },
    checks: [{ label: 'Independent re-sum of Pmax at the POI', a: own, b: s.pmax, atol: 1e-9, fmt: v => `${n1(v)} MW` }],
    notes: [s.why, s.service, 'Never a pass: the original owner must offer the surplus, and a study must confirm no new network upgrades.'],
    csv: { name: `grid-surplus-${bus}.csv`, meta: [['bus', bus], ['request_mw', req], ['limit_mw', lim]], columns: ['unit', 'bus_id', 'status', 'dispatch_mw', 'pmax_mw', 'ibr_by_name'], rows: s.units.map(u => [u.name, u.bus_id, u.status, u.gen_mw, u.max_mw, u.ibr]) },
  });
}

/** Affected-system tie adjacency. */
export function traceAffected(v, a, nearMi) {
  const ownNear = (v.ties || []).filter(t => ok(t.mi) && t.mi <= nearMi).length;
  const ownExt = (v.facilities || []).filter(f => (f.areas || []).some(x => x != null && String(x) !== String(v.home_area))).length;
  return trace({
    id: 'g-affected', title: 'Affected-system tie adjacency (indicator)',
    formula: `flag = facility end outside area ${v.home_area} › bus outside area ${v.home_area} › tie within ${nearMi} mi › not indicated;  tie = dim_branch row with from_area ≠ to_area`,
    inputs: [{ name: 'Bus power-flow area', value: `${v.bus.pf_area ?? 'not held'} (${v.bus.area_label || 'label not held'}) · BA ${v.bus.pf_ba ?? 'not held'}`, source: 'measured', note: v.notes?.pf_ba },
      { name: 'Tie branches', value: String((v.ties || []).length), source: 'measured', note: Object.entries(v.area_labels || {}).map(([k, l]) => `${k} = ${l}`).join(', ') },
      { name: 'Limiting facilities', value: String((v.facilities || []).length), source: 'measured', note: 'fact_limiting_element, ends looked up in dim_bus.pf_area' },
      { name: 'Adjacency radius', value: `${nearMi} mi`, source: 'assumption' }],
    steps: [...(v.ties || []).slice(0, 6).map(t => ({ label: `Tie ${t.name} (${t.label}, ${n1(t.kv)} kV)`, work: 'distance from the bus to the ISO-NE end', value: `${n1(t.mi)} mi` })),
      { label: 'Facilities with an end outside the home area', work: a.external.map(f => f.facility).slice(0, 4).join('; ') || 'none', value: String(a.external.length) }],
    result: { label: 'Flag', value: a.flag },
    checks: [{ label: `Independent recount of ties within ${nearMi} mi`, a: ownNear, b: (v.ties || []).filter(t => ok(t.mi) && t.mi <= nearMi).length, atol: 0, fmt: v2 => `${v2} ties` },
      { label: 'Independent recount of facilities leaving the home area', a: ownExt, b: a.external.length, atol: 0, fmt: v2 => `${v2} facilities` }],
    notes: ['An indicator from topology and distance, not an affected-system study: no neighbouring system\'s model or criteria are held. "Not indicated" never means no affected-system study is needed.', ...a.reasons],
    csv: { name: `grid-affected-${v.bus.bus_id}.csv`, meta: [['bus', v.bus.bus_id], ['home_area', v.home_area]], columns: ['kind', 'name', 'neighbour', 'kv', 'miles', 'areas'], rows: [...(v.ties || []).map(t => ['tie', t.name, t.label, t.kv, t.mi, `${t.from_area}→${t.label}`]), ...(v.facilities || []).map(f => ['limiting facility', f.facility, (f.labels || []).join('/'), f.kv, null, (f.areas || []).join('/')])] },
  });
}

/** Proportional-impact allocation over the user-defined cluster. */
export function traceProp(bus, p, members, rule) {
  if (!p.facilities.length) return trace({ id: 'g-prop', title: 'Proportional-impact allocation', formula: 'share_i,f = max(0, DFAX_i,f) × MW_i ÷ Σ_j max(0, DFAX_j,f) × MW_j', inputs: [], steps: [], result: { label: 'Project allocation', value: 'not held' }, notes: ['No check possible: no facility overloads below the request, so there is nothing to allocate.'] });
  const sums = p.facilities.filter(f => !f.missing && f.members.every(m => m.share != null)).map(f => f.members.reduce((a, m) => a + m.share, 0));
  const ownTotal = p.facilities.reduce((a, f) => { const me = f.members.find(m => m.self); const den = f.members.reduce((x, m) => x + (ok(m.dfax) && ok(m.mw) ? Math.max(0, m.dfax) * m.mw : 0), 0); return ok(f.cost) && me && ok(me.dfax) && den > 0 ? a + (f.cost * Math.max(0, me.dfax) * me.mw) / den : a; }, 0);
  // S3 #5: the PP5-6 §10.4.4 allocation (one share of the cluster cost), re-derived here with its own code: impact_i =
  // Σ_f MW_i × DFAX_i,f counted only where DFAX_i,f > threshold; share = impact_project ÷ Σ_j impact_j.
  const pp = p.pp56, thr = ok(pp?.threshold) ? pp.threshold : null;
  const ppImpact = m => p.facilities.reduce((a, f) => { const d = f.dfax?.[m.bus] ?? f.members.find(x => x.bus === m.bus)?.dfax; return a + (ok(d) && ok(m.mw) && thr != null && d > thr + 1e-12 ? d * m.mw : 0); }, 0);
  const ppDen = members.reduce((a, m) => a + ppImpact(m), 0), me = members.find(m => m.self);
  const ppOwnShare = me && ppDen > 0 ? ppImpact(me) / ppDen : null;
  const ppStep = pp ? { label: `ISO-NE PP5-6 §10.4.4 cluster share (DFAX > ${thr != null ? `${(100 * thr).toFixed(0)}%` : 'threshold not held'})`, work: pp.status === 'ok' ? `${members.map(m => `${m.self ? 'P' : m.bus}: Σ_f MW × DFAX(>thr) = ${n1(ppImpact(m))}`).join('; ')}; Σ = ${n1(pp.totalImpact)}` : pp.reason || 'not held',
    value: pp.status === 'ok' ? `${pct(pp.share)} of ${musd(pp.standaloneTotal)} = ${musd(pp.cost)}` : pp.status === 'not_applicable' ? 'nothing allocated (no DFAX above the threshold)' : 'not held' } : null;
  return trace({
    id: 'g-prop', title: 'Proportional-impact allocation over the cluster',
    formula: 'impact_i,f = max(0, DFAX_i,f) × MW_i;  share_i,f = impact_i,f ÷ Σ_j impact_j,f;  project cost = Σ_f cost_f × share_project,f;  PP5-6: share_i = Σ_f [DFAX_i,f > 3%] × MW_i × DFAX_i,f ÷ Σ_j (same)',
    inputs: [...members.map(m => ({ name: m.self ? `This project (bus ${m.bus})` : `Member bus ${m.bus}`, value: fmt.mw(m.mw), source: m.self ? 'user' : 'assumption', note: m.self ? 'request' : 'your cluster entry' })),
      { name: 'DFAX', value: 'per facility, same case', source: 'measured', note: rule },
      { name: 'Method (per facility)', value: 'Order 2023 proportional impact', source: 'rule', note: 'Vault: ferc-order-2023-summary.md line 58 (network upgrade costs within clusters assigned by the proportional impact method); illustrative per-facility view' },
      ...(pp ? [{ name: 'Method (ISO-NE)', value: 'PP5-6 Rev 15 §10.4.4 proportional impact', source: 'rule', note: `${pp.cite?.src || 'not held'} · ${pp.cite?.status || 'missing'}; DFAX threshold ${thr != null ? `${(100 * thr).toFixed(0)}%` : 'not held'}; the store holds one DFAX per bus and facility (no NR/CNR split)` }] : [])],
    steps: [...p.facilities.map(f => ({ label: f.label, work: f.members.map(m => `${m.self ? 'P' : m.bus}: ${n3(m.dfax)} × ${n1(m.mw)} = ${n1(m.impact)}`).join('; '), value: `${f.bound === 'upper' ? '≤ ' : ''}${pct(f.share)} of ${musd(f.cost)} = ${musd(f.allocation)}` })), ...(ppStep ? [ppStep] : [])],
    result: { label: 'Project allocation', value: `${p.status === 'Upper bound' ? '≤ ' : ''}${musd(p.projectTotal)}` },
    checks: [...(sums.length ? [{ label: 'Consistency check: shares of every fully held facility sum to 100%', a: sums.reduce((a, v) => a + v, 0), b: sums.length, atol: 1e-9, fmt: v => `${v.toFixed(6)}` }] : []),
      { label: 'Independent recompute of the project total from DFAX × MW', a: ownTotal, b: p.projectTotal ?? 0, atol: 1e-9, fmt: v => musd(v) },
      ...(pp && pp.status === 'ok' && ppOwnShare != null ? [{ label: 'Independent recompute of the PP5-6 project share (threshold applied per element)', a: ppOwnShare, b: pp.share, atol: 1e-9, fmt: v => pct(v) }] : [])],
    notes: ['Counter-flow (DFAX ≤ 0) contributes no impact and pays nothing (expert judgement; the ISO-NE Schedule 11 text is not held).', 'A member without a DFAX for a facility leaves the denominator short, so the project share is an upper bound (≤).', 'Illustrative: ISO-NE\'s cluster allocation is issued by the study; member MW are your entries.',
      'PP5-6 (ISO-NE): one share of the cluster\'s priced upgrade cost, impacts summed over elements and counted only above the DFAX threshold; the per-facility rows above are the Order 2023 pro forma view for comparison.'],
    csv: { name: `grid-proportional-${bus}.csv`, meta: [['bus', bus]], columns: ['facility', 'cost_musd', 'member_bus', 'is_project', 'mw', 'dfax', 'impact_mw', 'share', 'allocation_musd'], rows: p.facilities.flatMap(f => f.members.map(m => [f.label, f.cost, m.bus, m.self, m.mw, m.dfax, m.impact, m.share, m.allocation])) },
  });
}

/** Order 1920 interconnection-need screen (criterion 2 only). */
export function trace1920(bus, s, ups) {
  const own = s.checkedRows.filter(f => ok(f.kv) && f.kv >= 200 && ok(f.cost) && f.cost >= 30).length;
  return trace({
    id: 'g-1920', title: 'Order 1920 interconnection-need screen',
    formula: 'criterion 2 = kV ≥ 200 AND study cost ≥ $30M (both);  criteria 1, 3, 4 not held',
    inputs: [{ name: 'This bus\'s limiting facilities', value: String(s.checked), source: 'measured', note: 'fact_limiting_element: kV and the largest study cost per facility' },
      { name: 'Thresholds', value: '200 kV · $30M', source: 'rule', note: 'Vault: ferc-order-1920-summary.md §3' },
      { name: 'Approved upgrades ISO-wide', value: `${ups.length}`, source: 'measured', note: 'dim_transmission_upgrade, dim_substation_upgrade (no cost is published)' }],
    steps: s.checkedRows.map(f => ({ label: f.label, work: `${n1(f.kv)} kV · ${musd(f.cost)}`, value: ok(f.cost) ? (f.kv >= 200 && f.cost >= 30 ? 'meets' : 'below') : f.kv >= 200 ? 'cost not held' : 'below 200 kV' })),
    result: { label: 'Meets criterion 2', value: `${s.meets.length} of ${s.checked}` },
    check: { label: 'Independent recount of facilities meeting both thresholds', a: own, b: s.meets.length, atol: 0, fmt: v => `${v}` },
    notes: ['Context only: meeting criterion 2 is necessary, not sufficient. The other three criteria need cluster-study history, withdrawal links and agreement status, none of which is in the store.'],
    csv: { name: `grid-order1920-${bus}.csv`, meta: [['bus', bus]], columns: ['facility', 'kv', 'cost_musd', 'meets_criterion_2'], rows: s.checkedRows.map(f => [f.label, f.kv, f.cost, ok(f.cost) ? f.kv >= 200 && f.cost >= 30 : null]) },
  });
}
