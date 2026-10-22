// Calculation traces for Queue. Independent checks: distances by a second formula (equirectangular vs the
// core's haversine), dates by day-stepping (vs millisecond arithmetic), deposits from the tariff table written
// out here, register vintages recounted against the Studio copy of queue_trends, and sums that must add up.
import { trace } from '../trace.js';
import { PROFILE, profileOf, NAME_MATCH_MAX_MI, REG_STATUS } from '../queuecore.js';
import * as RX from '../rules/isone.js';
import { fmt } from '../basis.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const usd = v => (ok(v) ? `$${Math.round(v).toLocaleString('en-US')}` : 'not held');
const n2 = v => (ok(v) ? v.toFixed(2) : 'not held');
const yrs = v => (ok(v) ? `${v.toFixed(2)} yr` : 'not held');
const pct = v => (ok(v) ? fmt.pct(100 * v) : 'not held');
// Equirectangular distance (a different formula from the core's haversine; agrees within ~0.1% below 50 mi).
const eqMiles = (a, b) => { const R = 3958.8, r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r; return R * Math.hypot(x, y); };
const worstRel = (bus, pts) => pts.reduce((m, p) => Math.max(m, Math.abs(eqMiles(bus, p) - p.d) / p.d), 0);

/** Queue & cluster: which study-set requests are nearby, how their MW splits, and the distance-based ratio. */
export function traceCluster(node, list, R, sums, ratio) {
  const bus = { lat: node?.latitude, lon: node?.longitude };
  const inR = list.filter(x => x.inRadius);
  const dists = list.filter(x => ok(x.distance) && x.distance > 0.01 && ok(x.q.latitude)).map(x => ({ lat: x.q.latitude, lon: x.q.longitude, d: x.distance }));
  const worst = worstRel(bus, dists);
  return trace({
    id: 'q-cluster', title: `Requests near ${node?.name ?? '?'}`,
    formula: `Counted = great-circle distance ≤ radius; also listed = every distinctive bus-name word in the POI name, within ${NAME_MATCH_MAX_MI} mi;  distance = 2R · asin(√(sin²(Δφ/2) + cos φ₁ cos φ₂ sin²(Δλ/2))), R = 3,958.8 mi;  ratio = (Σ requested within radius + this project) ÷ binding export limit`,
    inputs: [
      { name: 'Bus location', value: `${n2(bus.lat)}, ${n2(bus.lon)}`, source: 'measured', note: 'unified dim_bus' },
      { name: 'Radius', value: `${R} mi`, source: 'user' },
      { name: 'Queue rows', value: `${fmt.int(sums.setSize)} solved-case positions`, source: 'measured', note: `unified dim_queue; ${fmt.int(sums.unplaced)} of ${fmt.int(sums.registerTotal)} public-register records carry no coordinate and are in no radius count` },
      { name: 'Project size', value: fmt.mw(ratio?.mw), source: 'user' },
      { name: 'Binding export limit', value: ok(ratio?.limit) ? fmt.mw(ratio.limit) : 'not held', source: ok(ratio?.limit) ? 'derived' : 'measured', note: ratio?.basis || '' }],
    steps: [
      ...list.slice(0, 10).map(x => ({ label: `#${x.q.queue_position} ${x.q.poi_name}`, work: `${fmt.mw(x.q.max_mw)} · ${x.inRadius ? x.match : 'name match, outside radius (not counted)'} · ${x.inModel}`, value: ok(x.distance) ? `${x.distance.toFixed(2)} mi` : '—' })),
      { label: 'Requested MW within the radius', work: `Σ over ${inR.length} request(s)`, value: fmt.mw(sums.total) },
      { label: 'Modelled in the summer study case', work: 'summer_mw_modelled ≠ 0 (negative = storage charging)', value: fmt.mw(sums.modelled) },
      { label: 'Linked but not modelled', work: 'summer_mw_modelled = 0 (the only MW the what-if subtracts)', value: fmt.mw(sums.notModelled) },
      { label: 'Study status not held', work: 'summer_mw_modelled missing', value: fmt.mw(sums.notHeld) },
      { label: 'Name matches outside the radius', work: 'listed, not counted', value: fmt.int(sums.nameOnly) },
      { label: 'Requested near here + this project vs the binding export limit', work: ok(ratio?.limit) ? `(${fmt.mw(sums.total)} + ${fmt.mw(ratio.mw)}) ÷ ${fmt.mw(ratio.limit)}` : 'limit not held, so no ratio', value: ok(ratio?.value) ? pct(ratio.value) : 'not held' },
    ],
    result: { label: 'Nearby requests', value: `${inR.length} · ${fmt.mw(sums.total)}` },
    checks: [
      { label: 'Distances by a second formula (equirectangular): worst relative difference from the haversine distances', a: dists.length ? worst : null, b: 0, atol: 0.005, fmt: v => (ok(v) ? `${(100 * v).toFixed(3)}%` : 'not held') },
      { label: 'Consistency check: modelled + not modelled + not held = requested within the radius', a: sums.modelled + sums.notModelled + sums.notHeld, b: sums.total, atol: 1e-9, fmt: v => fmt.mw(v) },
      ...(ok(ratio?.value) ? [{ label: 'Arithmetic re-check of the ratio from the row MW', a: (inR.reduce((t, x) => t + (x.q.max_mw || 0), 0) + ratio.mw) / ratio.limit, b: ratio.value, atol: 1e-9, fmt: pct }] : []),
    ],
    notes: ['The ratio adds MW by distance, as if every request loaded the same limiting facility one-for-one. That is not established; it is context, not a headroom result.', ...(list.length > 10 ? [`First 10 of ${list.length} shown; the CSV has all.`] : []), ...(dists.length ? [] : ['No check possible for distances: no located request beyond 0.01 mi.'])],
    csv: { name: `queue-nearby-${node?.id}.csv`, meta: [['bus', `${node?.name} (${node?.id})`], ['radius_mi', R], ['source', 'unified dim_queue'], ['rule', `haversine distance ≤ radius counted; whole-word POI name match within ${NAME_MATCH_MAX_MI} mi listed only`]], columns: ['queue_position', 'poi', 'mw', 'type', 'service', 'status', 'request_date', 'distance_mi', 'match', 'in_radius', 'in_study'], rows: list.map(x => [x.q.queue_position, x.q.poi_name, x.q.max_mw, x.q.resource_type, x.q.interconnection_service_requested, x.q.status, x.q.request_date, x.distance, x.match, x.inRadius ? 'yes' : 'no', x.inModel]) },
  });
}

/** Register records placed within the radius (by POI-name → substation coordinate). */
export function traceRegisterNear(node, R, near, t, total) {
  const bus = { lat: node?.latitude, lon: node?.longitude };
  const pts = near.rows.filter(r => r.distance > 0.01).map(r => ({ lat: r.lat, lon: r.lon, d: r.distance }));
  const tiers = {}; near.rows.forEach(r => { tiers[r.tier] = (tiers[r.tier] || 0) + 1; });
  return trace({
    id: 'q-reg-near', title: `Public-register records within ${R} mi`,
    formula: 'Placed = register record whose POI name matched a held substation (fence held) → that substation\'s coordinate; counted when haversine distance ≤ radius',
    inputs: [{ name: 'Register', value: `${fmt.int(total)} records`, source: 'measured', note: 'GridSense store acquired.queue (ISO-NE public queue), read-only extract' },
      { name: 'Radius', value: `${R} mi`, source: 'user' },
      { name: 'Records with no coordinate', value: fmt.int(near.unplaced), source: 'measured', note: 'no substation match, or no county/state fence: in no radius count' }],
    steps: [
      ...near.rows.slice(0, 8).map(r => ({ label: `QP ${r.qp} ${r.poi || ''}`, work: `${REG_STATUS[r.status] || r.status} · ${r.fuel || 'fuel not stated'} · matched ${r.tier}`, value: `${r.distance.toFixed(2)} mi` })),
      ...Object.entries(tiers).map(([k, v]) => ({ label: `Placed by tier: ${k}`, work: 'count', value: fmt.int(v) })),
      { label: 'Withdrawn / in service / active', work: `${t.W} / ${t.C} / ${t.A}`, value: fmt.int(t.n) },
    ],
    result: { label: 'Register records within the radius', value: `${fmt.int(t.n)} (${t.W} withdrawn, ${t.C} in service, ${t.A} active)` },
    checks: [
      { label: 'Consistency check: withdrawn + in service + active + other = records', a: t.W + t.C + t.A + t.other, b: t.n, atol: 0, fmt: v => fmt.int(v) },
      { label: 'Distances by a second formula (equirectangular): worst relative difference', a: pts.length ? worstRel(bus, pts) : null, b: 0, atol: 0.005, fmt: v => (ok(v) ? `${(100 * v).toFixed(3)}%` : 'not held') },
    ],
    notes: ['A coordinate here is the matched substation\'s, copied; the proximity restates the name match rather than confirming it.', ...(pts.length ? [] : ['No check possible for distances: every placed record sits at the bus (0 mi) or none is placed.'])],
    csv: { name: `queue-register-near-${node?.id}-${R}mi.csv`, meta: [['source', 'acquired.queue + acquired.queue_poi_match (GridSense store, read-only)'], ['radius_mi', R]], columns: ['qp', 'poi', 'fuel', 'requested_mw', 'status', 'requested', 'op_date', 'wd_date', 'tier', 'matched_name', 'distance_mi'], rows: near.rows.map(r => [r.qp, r.poi, r.fuel, r.mwReq, r.status, r.requested, r.op_date, r.wd_date, r.tier, r.matched_name, r.distance]) },
  });
}

/**
 * Schedule: the deadline chain, with an independent re-derivation of the Cluster Study Report deadline by stepping
 * one calendar day at a time over the raw rules file (window close + CEW + cluster study days).
 */
export function traceSchedule(start, band, q = {}) {
  if (!band) return '';
  const I = RX.getRules()?.interconnection, pf = band.profile === 'proforma';
  const cew = pf ? I?.proforma?.customer_engagement_window_days?.value : I?.schedule22?.customer_engagement_window_days?.value;
  const cs = pf ? I?.proforma?.cluster_study_days?.value : I?.schedule22?.cluster_study_days?.value;
  const own = cew + cs;
  const t = new Date(`${start}T00:00:00Z`); for (let i = 0; i < own; i++) t.setUTCDate(t.getUTCDate() + 1);
  const prof = profileOf(band.profile);
  const steps = band.rows.map(r => ({ label: r.step, work: r.kind === 'deadline' ? `${r.from} + ${r.used} → ${r.cite?.src || ''}` : (r.kind === 'date' ? 'date' : ''), value: r.date }));
  steps.push({ label: 'Own clock table (raw rules file)', work: `CEW ${cew} + cluster study ${cs}`, value: `${own} days` });
  return trace({
    id: 'q-schedule', title: 'Cluster Study Report deadline and the deadline chain',
    formula: 'Each deadline = the previous deadline + the tariff clock for the step (calendar days; business days Mon–Fri where the tariff says so). Cluster Study Report deadline = window close + customer engagement window + cluster study: a deadline, not an earliest date',
    inputs: [{ name: 'Window close', value: start, source: q.windowClose ? 'user' : 'rule', note: q.windowClose ? 'your anchor' : 'ISO-NE 2026 window (rules file)' }, { name: 'Restudy', value: q.restudy ? 'one' : 'none', source: 'user' }, { name: 'Facilities study', value: String(q.facilities ?? 90), source: 'user' }, { name: 'Process profile', value: prof.label, source: 'rule', note: prof.source }],
    steps,
    result: { label: 'Cluster Study Report deadline', value: `${band.deadline} (${band.deadlineCite.text})` },
    checks: [
      { label: 'Date by stepping the raw-rules CEW + cluster-study days one calendar day at a time = engine deadline', a: Date.parse(t.toISOString().slice(0, 10)), b: Date.parse(band.deadline), atol: 0, fmt: v => new Date(v).toISOString().slice(0, 10) },
      { label: 'Consistency check: each deadline is on or after the one before', a: band.rows.filter(r => r.kind === 'deadline').every((r, i, a) => i === 0 || r.date >= a[i - 1].date) ? 1 : 0, b: 1, atol: 0, fmt: v => (v ? 'holds' : 'fails') },
    ],
    notes: ['No holiday calendar is held: business days are Mon–Fri.', 'ISO-NE can finish a study before its deadline; history (Queue › Observed) shows how long requests have actually taken.'],
  });
}

/** Observed register durations and the study set's projections. */
export function traceDurations(obs, sObs, sWd, proj, sProj, totals) {
  // Independent median: whole days from UTC calendar parts (not Date.parse differences), then the middle order statistic(s).
  const days = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
  const med = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  const reMed = med(obs.service.map(x => (days(x.r.op_date) - days(x.r.requested)) / 365.25));
  const q = s => `p10 ${yrs(s.p10)} · p25 ${yrs(s.p25)} · p50 ${yrs(s.p50)} · p75 ${yrs(s.p75)} · p90 ${yrs(s.p90)}`;
  return trace({
    id: 'q-durations', title: 'Request to in service, observed and projected',
    formula: 'Observed = (op_date − request date) ÷ 365.25 d for register records in service (C); (withdrawal date − request date) for withdrawn (W). Projected = (projected in-service date − request date) for the solved-case set: applicants\' projections, not actuals',
    inputs: [
      { name: 'Register records in service', value: fmt.int(totals.C), source: 'measured', note: 'public register (GridSense store)' },
      { name: 'Register records withdrawn', value: fmt.int(totals.W), source: 'measured' },
      { name: 'Solved-case positions', value: fmt.int(totals.study), source: 'measured', note: 'unified dim_queue' }],
    steps: [
      { label: 'In service: records used', work: `${fmt.int(totals.C)} − ${obs.excluded.serviceBeforeRequest} with op_date before the request − ${obs.excluded.serviceUndated} undated`, value: fmt.int(sObs.n) },
      { label: 'In service: quantiles', work: q(sObs), value: yrs(sObs.p50) },
      { label: 'Withdrawn: records used', work: `${fmt.int(totals.W)} − ${obs.excluded.withdrawUndated} without a withdrawal date`, value: fmt.int(sWd.n) },
      { label: 'Withdrawn: quantiles', work: q(sWd), value: yrs(sWd.p50) },
      { label: 'Projected (solved-case set): records used', work: `${fmt.int(totals.study)} − ${proj.undated} undated`, value: fmt.int(sProj.n) },
      { label: 'Projected: quantiles', work: q(sProj), value: yrs(sProj.p50) },
    ],
    result: { label: 'Median observed request → in service', value: yrs(sObs.p50) },
    checks: [
      { label: 'Independent median from calendar-day counts (UTC parts), vs the core quantile', a: reMed, b: sObs.p50, atol: 0.01, fmt: yrs },
      { label: 'Consistency check: used + excluded = in-service records', a: sObs.n + obs.excluded.serviceBeforeRequest + obs.excluded.serviceUndated, b: totals.C, atol: 0, fmt: v => fmt.int(v) },
    ],
    notes: ['Request → in service includes construction as well as studies, so it is not comparable one-for-one with the tariff study clocks.', 'Five in-service records carry an op_date before their request date (register defects); they are excluded and counted, not zeroed.'],
    csv: { name: 'queue-durations.csv', meta: [['source_observed', 'acquired.queue (GridSense store)'], ['source_projected', 'unified dim_queue']], columns: ['population', 'qp', 'requested', 'end_date', 'years'], rows: [...obs.service.map(x => ['in service (observed)', x.r.qp, x.r.requested, x.r.op_date, x.years]), ...obs.withdraw.map(x => ['withdrawn (observed)', x.r.qp, x.r.requested, x.r.wd_date, x.years]), ...proj.values.map(x => ['solved-case projection', x.q.queue_position, x.q.request_date, x.q.projected_is_date, x.years])] },
  });
}

// Own deposit table from the raw rules file (independent of rules/isone.js).
function ownEntry(mw, profile) {
  const I = RX.getRules()?.interconnection; if (!I) return null;
  if (profile === 'proforma') {
    const t = I.proforma.study_deposit_tiers; if (!(mw > t.min_mw_gt)) return null;
    const sd = mw < t.tiers[0].below_mw ? t.tiers[0].base + t.tiers[0].per_mw * mw : mw < t.tiers[1].below_mw ? t.tiers[1].value : t.tiers[2].value;
    return { fee: I.proforma.application_fee.value, sd, mult: I.proforma.readiness_deposit_initial.multiple_of_study_deposit, st: [I.proforma.readiness_stages.restudy, I.proforma.readiness_stages.facilities_study, I.proforma.readiness_stages.lgia] };
  }
  const b = mw <= I.schedule22.small_generator_max_mw.value ? I.schedule23 : I.schedule22;
  return { fee: b.initial_deposit.value, sd: b.study_deposit.value, mult: b.readiness_deposit_initial.multiple_of_study_deposit,
    st: [I.schedule22.readiness_deposit_restudy.pct_of_network_upgrades, I.schedule22.readiness_deposit_facilities_study.pct_of_network_upgrades, I.schedule22.lgia_deposit.pct_of_network_upgrades] };
}

/** Cash: deposits, readiness top-ups, cash posted and forfeits, re-derived from the raw rules file. */
export function traceCash(mw, c, nu, lieu, nuSource, profile) {
  if (!c || c.errors?.length) return '';
  const o = ownEntry(mw, profile), prof = profileOf(profile);
  const lieuUSD = ok(lieu) ? lieu : 0;
  const ds = c.studyDeposit;
  const ownCash = o ? o.fee + o.sd + o.mult * o.sd + lieuUSD : null;
  const steps = [
    { label: 'Initial deposit / fee', work: c.phases[0].cite?.[0]?.src || '', value: usd(c.fee) },
    { label: 'Study deposit', work: profile === 'proforma' ? 'pro forma tier' : `Schedule ${c.schedule}`, value: usd(ds) },
    ...(lieuUSD ? [{ label: 'Deposit in lieu of site control', work: 'NRIS + regulatory limitation (queueCash)', value: usd(lieuUSD) }] : []),
    ...c.phases.map(p => ({ label: p.phase, work: `readiness ${usd(p.readiness)} (top-up ${usd(p.topUp)})${p.studyDepositHeld ? ' + study deposit' : ''}; forfeit ${p.penaltyIfWithdrawn === 0 ? '$0' : `${p.penaltyLowerBound ? '≥ ' : ''}${usd(p.penaltyIfWithdrawn)}`}`, value: usd(p.cashPosted) })),
  ];
  const topUps = c.phases.map(p => p.topUp).filter(ok), last = [...c.phases].reverse().find(p => ok(p.readiness));
  const stage = k => (ok(nu) && o ? Math.max(o.sd, k * nu) : null);
  const ownForfeit = o ? [0, o.sd, o.sd, stage(o.st[0]), stage(o.st[1]), stage(o.st[2])] : [];
  return trace({
    id: 'q-cash', title: 'Cash and commitments by phase',
    formula: 'Readiness = multiple × study deposit at entry, then totals of the stage % of allocated network-upgrade cost, never below what is posted;  cash posted = readiness + study deposit while studies run (+ deposit in lieu);  forfeit = max(study deposit, stage multiple)',
    inputs: [{ name: 'Size', value: fmt.mw(mw), source: 'user' }, { name: 'Allocated network-upgrade cost', value: nu == null ? 'not held' : usd(nu), source: nu == null ? 'measured' : nuSource === 'user' ? 'user' : 'derived', note: nu == null ? 'Send a fully priced scenario from Grid, or enter a what-if' : nuSource === 'user' ? 'your what-if assumption, not an allocation' : 'sent from Grid' }, { name: 'Process profile', value: prof.label, source: 'rule', note: prof.source }],
    steps,
    result: { label: 'Posted at request (fee + deposits + readiness)', value: usd(c.fee + c.phases[0].cashPosted) },
    checks: [
      ...(o ? [{ label: 'Raw rules file written out independently: fee + deposit + multiple × deposit (+ lieu) = posted at request', a: ownCash, b: c.fee + c.phases[0].cashPosted, atol: 0.5, fmt: usd }] : []),
      ...c.phases.map((p, i) => ({ label: `Own forfeit table: ${p.phase}`, a: ownForfeit[i] ?? null, b: p.penaltyIfWithdrawn, atol: 0.5, fmt: usd })),
      ...(last ? [{ label: 'Consistency check: Σ top-ups = final readiness balance', a: topUps.reduce((a, b) => a + b, 0), b: last.readiness, atol: 0.5, fmt: usd }] : []),
    ],
    csv: { name: `queue-cash-${mw}mw.csv`, meta: [['profile', prof.label], ['network_upgrade_usd', nu ?? 'not held'], ['network_upgrade_source', nu == null ? 'not held' : nuSource]], columns: ['phase', 'readiness_usd', 'top_up_usd', 'cash_posted_usd', 'forfeit_usd', 'forfeit_is_lower_bound', 'rule'], rows: c.phases.map(p => [p.phase, p.readiness, p.topUp, p.cashPosted, p.penaltyIfWithdrawn, p.penaltyLowerBound ? 'yes' : 'no', p.penaltyNote]) },
  });
}

/** Entry cost across project sizes, re-derived from the raw rules file at every size. */
export function traceDepositCurve(curve, mw, profile) {
  const held = curve.filter(c => !c.notModelled), prof = profileOf(profile);
  const worst = held.reduce((m, c) => { const o = ownEntry(c.mw, profile); return Math.max(m, o ? Math.abs(o.fee + o.sd + o.mult * o.sd - c.cashAtRequest) : Infinity); }, 0);
  const mono = held.every((c, i) => i === 0 || c.studyDeposit >= held[i - 1].studyDeposit);
  const pick = [10, 20, 21, 50, 79, 80, 100, 199, 200, 500].map(s => curve.find(c => c.mw === s)).filter(Boolean);
  return trace({
    id: 'q-deposit', title: 'Entry cash by project size',
    formula: profile === 'proforma' ? 'Total at request = fee + study deposit (pro forma tier) + readiness (multiple × study deposit); ≤ 20 MW not modelled' : 'Total at request = initial deposit + study deposit + readiness (multiple × study deposit): Schedule 22 above 20 MW (flat), Schedule 23 at or below; cash part = initial + study deposit',
    inputs: [{ name: 'Sizes', value: `${curve[0].mw}–${curve.at(-1).mw} MW`, source: 'user', note: 'every whole MW' }, { name: 'Current size', value: fmt.mw(mw), source: 'user' }, { name: 'Process profile', value: prof.label, source: 'rule', note: prof.source }],
    steps: pick.map(c => ({ label: `${c.mw} MW`, work: c.notModelled ? 'not modelled' : `${c.schedule === 'proforma' ? 'pro forma' : `Schedule ${c.schedule}`}: deposit ${usd(c.studyDeposit)}, readiness ${usd(c.readiness)}, cash ${usd(c.cash)}`, value: usd(c.cashAtRequest) })),
    result: { label: 'Range over the sizes modelled', value: `${usd(Math.min(...held.map(c => c.cashAtRequest)))} – ${usd(Math.max(...held.map(c => c.cashAtRequest)))}` },
    checks: [
      { label: 'Raw rules file written out independently: worst absolute difference over every size', a: worst, b: 0, atol: 0.5, fmt: usd },
      { label: 'Consistency check: the study deposit never falls as size rises', a: mono ? 1 : 0, b: 1, atol: 0, fmt: v => (v ? 'holds' : 'fails') },
    ],
    notes: [profile === 'proforma' ? '20 MW and below: small-generator procedures, not modelled under the pro forma.' : 'Only the initial and study deposits must be cash; the readiness deposit may be a letter of credit or surety bond.'],
    csv: { name: 'queue-deposit-by-size.csv', meta: [['profile', prof.label]], columns: ['mw', 'schedule', 'study_deposit_usd', 'readiness_usd', 'cash_usd', 'total_at_request_usd', 'modelled'], rows: curve.map(c => [c.mw, c.schedule, c.studyDeposit, c.readiness, c.cash, c.cashAtRequest, c.notModelled ? 'no' : 'yes']) },
  });
}

/** Withdrawn share by requested size, and the project's own band (half to twice its size). */
export function traceSizeBand(bands, band, mw, heldTotal) {
  const sumN = bands.reduce((a, b) => a + b.n, 0);
  return trace({
    id: 'q-size-band', title: 'How often requests of this size withdrew',
    formula: 'Withdrawn share = withdrawn ÷ all register records in the size band (requested MW = net MW, else summer MW; records with neither are left out, counted)',
    inputs: [{ name: 'Project size', value: fmt.mw(mw), source: 'user' }, { name: 'Register records with a requested MW', value: fmt.int(heldTotal), source: 'measured', note: 'public register (GridSense store)' }],
    steps: [...bands.map(b => ({ label: b.key, work: `${b.W} withdrawn of ${b.n} (${b.C} in service, ${b.A} active)`, value: pct(b.withdrawnShare) })),
      ...(band ? [{ label: `This project's band: ${fmt.mw(band.lo)}–${fmt.mw(band.hi)}`, work: `${band.W} of ${band.n}`, value: pct(band.withdrawnShare) }] : [])],
    result: { label: 'Withdrawn share, half-to-twice band', value: band ? `${pct(band.withdrawnShare)} of ${fmt.int(band.n)}` : 'not held' },
    checks: [
      { label: 'Consistency check: records over the size bands = register records with a requested MW', a: sumN, b: heldTotal, atol: 0, fmt: v => fmt.int(v) },
      ...(band ? [{ label: 'Arithmetic re-check: withdrawn ÷ records in the project band', a: band.W / band.n, b: band.withdrawnShare, atol: 1e-12, fmt: pct }] : []),
    ],
    notes: ['An observed share of named records, all years together; not a probability for this project. Recent entries have had less time to withdraw.'],
    csv: { name: 'queue-withdrawn-by-size.csv', meta: [['source', 'acquired.queue (GridSense store)']], columns: ['band', 'records', 'withdrawn', 'in_service', 'active', 'withdrawn_share'], rows: bands.map(b => [b.key, b.n, b.W, b.C, b.A, b.withdrawnShare]) },
  });
}

/** Register vintages: completion from mature entry years; the recount must match the Studio copy of queue_trends. */
export function traceChanges(vint, copyTrends, cutoff, p) {
  const mature = vint.filter(v => v.year <= cutoff);
  const byYear = new Map(copyTrends.map(t => [t.entry_year, t]));
  const differ = vint.filter(v => { const t = byYear.get(v.year); return !t || t.projects !== v.n || t.withdrawn !== v.W || t.in_service !== v.C || t.active !== v.A; }).length;
  return trace({
    id: 'q-changes', title: 'Share of mature requests reaching operation',
    formula: `Share = in service ÷ (in service + withdrawn) over entry years ≤ ${cutoff} (latest register request year − 6; later vintages excluded because withdrawals resolve years before completions)`,
    inputs: [{ name: 'Register', value: `${fmt.int(vint.reduce((a, v) => a + v.n, 0))} records, ${vint.length} entry years`, source: 'measured', note: 'public register (GridSense store)' }, { name: 'Mature cut-off', value: `entry ≤ ${cutoff}`, source: 'derived' }],
    steps: [...mature.slice(-8).map(v => ({ label: String(v.year), work: `${v.C} in service, ${v.W} withdrawn, ${v.A} active`, value: `${v.n} requests` })),
      { label: 'In service (mature)', work: `Σ over ${mature.length} vintages`, value: fmt.int(p.C) },
      { label: 'Withdrawn (mature)', work: `Σ over ${mature.length} vintages`, value: fmt.int(p.W) },
      { label: 'Share reaching operation', work: `${p.C} ÷ (${p.C} + ${p.W})`, value: pct(p.completion) }],
    result: { label: 'Reached operation', value: pct(p.completion) },
    checks: [
      { label: 'Independent source: entry years where the register recount differs from the Studio copy of queue_trends (derived.mart_queue_trends)', a: differ, b: 0, atol: 0, fmt: v => `${v}` },
      { label: 'Arithmetic re-run: in service + withdrawn over the mature vintages', a: mature.reduce((a, v) => a + v.C + v.W, 0), b: p.C + p.W, atol: 0, fmt: v => fmt.int(v) },
    ],
    notes: ['Count-based and mostly serial-era: context, not a probability for your project.'],
    csv: { name: 'queue-register-vintages.csv', meta: [['source', 'acquired.queue (GridSense store)'], ['mature_cutoff', cutoff]], columns: ['entry_year', 'records', 'withdrawn', 'in_service', 'active', 'requested_mw_held', 'completion_resolved', 'withdrawn_share'], rows: vint.map(v => [v.year, v.n, v.W, v.C, v.A, v.mw, v.completion, v.withdrawnShare]) },
  });
}

/** The solved case's modelled positions, looked up in the register now. */
export function traceStudyNow(now, copyNow) {
  const c = now.counts, tot = c.W + c.C + c.A + c.missing;
  return trace({
    id: 'q-study-now', title: 'Solved-case positions in the register now',
    formula: 'Join each solved-case position to the register on QP + request date (QP alone is not a key: ISO-NE recycles positions); read the register status',
    inputs: [{ name: 'Solved-case positions', value: fmt.int(now.rows.length), source: 'measured', note: 'unified dim_queue' }, { name: 'Register', value: 'public register (GridSense store)', source: 'measured' }],
    steps: [{ label: 'Withdrawn since the study', work: 'register status W', value: fmt.int(c.W) }, { label: 'In service', work: 'register status C', value: fmt.int(c.C) }, { label: 'Still active', work: 'register status A', value: fmt.int(c.A) }, { label: 'Not found in the register', work: 'no QP + date match', value: fmt.int(c.missing) }],
    result: { label: 'Withdrawn since the study', value: `${fmt.int(c.W)} of ${fmt.int(now.rows.length)}` },
    checks: [
      { label: 'Consistency check: withdrawn + in service + active + not found = positions', a: tot, b: now.rows.length, atol: 0, fmt: v => fmt.int(v) },
      { label: 'Independent source: the same join run on the Studio copy of the study set gives the same withdrawn count', a: copyNow.counts.W, b: c.W, atol: 0, fmt: v => fmt.int(v) },
    ],
    notes: ['The solved envelope was not re-run after these withdrawals; nothing here re-runs it. A withdrawal is never assumed to free capacity.'],
    csv: { name: 'queue-study-set-now.csv', meta: [['join', 'qp + request date']], columns: ['queue_position', 'poi', 'mw', 'status_in_study', 'register_status', 'withdrawn_on', 'op_date'], rows: now.rows.map(x => [x.q.queue_position, x.q.poi_name, x.q.max_mw, x.q.status, x.now, x.r?.wd_date, x.r?.op_date]) },
  });
}

/** Completion by resource type (mature vintages). */
export function traceType(types, cutoff, total) {
  const n = types.reduce((a, t) => a + t.n, 0);
  return trace({
    id: 'q-type', title: 'Completion by resource type',
    formula: `Completion = in service ÷ (in service + withdrawn), register records entered ≤ ${cutoff}, grouped by EIA fuel code (hybrids kept apart)`,
    inputs: [{ name: 'Mature register records', value: fmt.int(n), source: 'measured', note: `of ${fmt.int(total)} in the register` }, { name: 'Mature cut-off', value: `entry ≤ ${cutoff}`, source: 'derived' }],
    steps: types.map(t => ({ label: t.key, work: `${t.C} ÷ (${t.C} + ${t.W})`, value: pct(t.completion) })),
    result: { label: 'Types with a resolved record', value: fmt.int(types.filter(t => ok(t.completion)).length) },
    checks: [
      { label: 'Consistency check: Σ records over types = mature register records', a: n, b: types.reduce((a, t) => a + t.W + t.C + t.A + t.other, 0), atol: 0, fmt: v => fmt.int(v) },
      ...types.filter(t => ok(t.completion)).slice(0, 1).map(t => ({ label: `Arithmetic re-check (${t.key})`, a: t.C / (t.C + t.W), b: t.completion, atol: 1e-12, fmt: pct })),
    ],
    notes: ['Few records behind a share (see n) make it fragile. A type that is mostly recent (storage) has had little time to complete.'],
    csv: { name: 'queue-completion-by-type.csv', meta: [['mature_cutoff', cutoff]], columns: ['type', 'records', 'in_service', 'withdrawn', 'active', 'completion'], rows: types.map(t => [t.key, t.n, t.C, t.W, t.A, t.completion]) },
  });
}

/** Retirements, active register requests and approved upgrades within a radius, by year. */
export function traceTimeline(R, years, items) {
  const sumYears = years.reduce((a, y) => a + (y.req || 0) - (y.ret || 0), 0);
  const sumItems = items.req.reduce((a, r) => a + r.mw, 0) - items.ret.reduce((a, r) => a + r.mw, 0);
  return trace({
    id: 'q-timeline', title: `Retirements, active requests and upgrades within ${R} mi`,
    formula: 'Per year: Σ requested MW of active register records placed within the radius (by projected op date year) and Σ retiring MW (below zero); upgrades are counted, no MW is published for them',
    inputs: [{ name: 'Radius', value: `${R} mi`, source: 'user' }, { name: 'Retirements and upgrades', value: `${items.ret.length} retirements · ${items.up.length} upgrades within the radius`, source: 'measured', note: 'unified dim_retirement, dim_transmission_upgrade (either end), dim_substation_upgrade' }, { name: 'Active requests', value: `${items.req.length} placed`, source: 'measured', note: 'public register, status A' }],
    steps: years.map(y => ({ label: String(y.year), work: `+${fmt.mw(y.req || 0)} requested, −${fmt.mw(y.ret || 0)} retiring, ${y.up || 0} upgrade(s)`, value: fmt.mw((y.req || 0) - (y.ret || 0)) })),
    result: { label: 'Net requested − retiring', value: fmt.mw(sumItems) },
    checks: [{ label: 'Consistency check: Σ by year = Σ over the records', a: sumYears, b: sumItems, atol: 1e-6, fmt: v => fmt.mw(v) }],
    notes: ['A request is not a build. Upgrade in-service years are as published.'],
    csv: { name: `queue-timeline-${R}mi.csv`, meta: [['radius_mi', R]], columns: ['kind', 'name', 'year', 'mw', 'distance_mi'], rows: [...items.req.map(r => ['active request', `QP ${r.qp} ${r.poi || ''}`, r.year, r.mw, r.d]), ...items.ret.map(r => ['retirement', r.plant, r.year, r.mw, r.d]), ...items.up.map(u => ['upgrade', u.name, u.year, null, u.d])] },
  });
}
