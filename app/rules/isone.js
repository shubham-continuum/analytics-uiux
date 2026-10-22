// ISO-NE interconnection rules engine (S3): Schedule 22 / 23 entry cash, the deadline chain, site control, cash by
// phase and withdrawal penalties, proportional-impact allocation (PP5-6 Rev 15, GAPS §4.3) and the MVA thermal screen
// (GAPS §4.4), with a profile switch ('isone' default; 'proforma' = FERC Order 2023, labelled as not the ISO-NE rule).
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S3) · 2026-10-06 · sign-off pending · v1
//
// Every number comes from rules/isone-2026.json (generated from rules/isone-2026/interconnection.json; values and
// sources from v8-isone-complete/research/R1-interconnection-isone.md + REGISTER.md §1). No tariff constant is typed
// here. Every result carries the citation(s) it rests on ({path, src, status, effective, text}) for the Inspector
// Evidence tab, and follows the value contract (04-architecture): status ok | missing | not_applicable | blocked,
// a non-ok result has value null and a reason, never 0.
//
// Loading: in Node the rules file is read at import; in the browser it is fetched once at import (top-level await).
// A failed load leaves every result "not held: rules file not loaded". Tests may inject rules with setRules().

let RULES = null;
let LOAD_ERR = null;
const RULES_URL = new URL('./isone-2026.json', import.meta.url);
try {
  if (typeof window === 'undefined' && typeof process !== 'undefined' && process.versions?.node) {
    const fs = await import('node:fs');
    RULES = JSON.parse(fs.readFileSync(RULES_URL, 'utf8'));
  } else {
    const r = await fetch(RULES_URL);
    if (!r.ok) throw new Error(`rules/isone-2026.json ${r.status}`);
    RULES = await r.json();
  }
} catch (e) { LOAD_ERR = e?.message || String(e); RULES = null; }

/** Replace the rules object (tests; a reload). null = not loaded. */
export function setRules(R) { RULES = R || null; LOAD_ERR = R ? null : 'rules file not loaded'; MEMO.clear(); }
export const getRules = () => RULES;
export const rulesError = () => (RULES ? null : (LOAD_ERR || 'rules file not loaded'));

const ok = v => typeof v === 'number' && Number.isFinite(v);
// P2 grid-column memo: queueCash / clusterDeadline are project-scoped, so a grid sort reads the same answer thousands
// of times. Cached per function on the JSON of the inputs; setRules() (a rules reload) clears it. Results are frozen.
const MEMO = new Map();
const memo = (name, fn) => (opts = {}) => {
  let m = MEMO.get(name); if (!m) MEMO.set(name, (m = new Map()));
  const k = JSON.stringify(opts);
  if (!m.has(k)) { if (m.size > 500) m.clear(); m.set(k, Object.freeze(fn(opts))); }
  return m.get(k);
};
const num = v => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);
const NOT_LOADED = () => `not held: ${rulesError()}`;

// ---------- profiles ----------
export const PROFILE_IDS = ['isone', 'proforma'];
export const DEFAULT_PROFILE = 'isone';
export const normProfile = p => (PROFILE_IDS.includes(p) ? p : DEFAULT_PROFILE);
const S22 = 'interconnection.schedule22', S23 = 'interconnection.schedule23', PF = 'interconnection.proforma', TS = 'interconnection.thermal_screen';

/** The rule entry at a dotted path, or null. */
export function ruleAt(path) {
  let o = RULES;
  for (const k of String(path).split('.')) { if (!o || typeof o !== 'object') return null; o = o[k]; }
  return o && typeof o === 'object' && !Array.isArray(o) ? o : null;
}
/** Citation of one rule entry: {path, src, status, effective, text}. text = "<src> · <status>" (the Evidence line). */
export function cite(path) {
  const e = ruleAt(path);
  if (!e) return { path, src: 'not held', status: 'missing', effective: null, text: `${path} not in the rules file` };
  return { path, src: e.src || 'not held', status: e.status || 'missing', effective: e.effective || null, text: `${e.src || 'not held'} · ${e.status || 'missing'}` };
}
const val = path => ruleAt(path)?.value;

/** Profile badge: label, citation, and whether it is the labelled fallback. */
export function profileInfo(profile) {
  const id = normProfile(profile), path = id === 'isone' ? `${S22}.profile` : `${PF}.profile`, c = cite(path);
  const label = val(path) ?? (id === 'isone' ? 'ISO-NE profile (rules file not loaded)' : 'Pro forma profile (rules file not loaded)');
  return { id, label, isDefault: id === DEFAULT_PROFILE, labelled: id !== DEFAULT_PROFILE, src: c.src, status: c.status, effective: c.effective, cite: c,
    text: `${label} · ${c.src}${c.effective ? ` · effective ${c.effective}` : ''}` };
}

// ---------- money words (one home for "$800k total, $300k cash") ----------
const usd = v => `$${Math.round(v).toLocaleString('en-US')}`;
export const usdK = v => (!ok(v) ? 'not held' : Math.abs(v) >= 1e6 && v % 1e5 === 0 ? `$${v / 1e6}M` : Math.abs(v) >= 1000 && v % 1000 === 0 ? `$${v / 1000}k` : usd(v));

// ---------- entry cash (Q-C1) ----------
const smallMax = () => val(`${S22}.small_generator_max_mw`);
function block(mw, profile) {
  if (profile === 'proforma') return { id: 'proforma', base: PF };
  const lim = smallMax();
  return ok(lim) && mw <= lim ? { id: '23', base: S23 } : { id: '22', base: S22 };
}
function proformaStudyDeposit(mw) {
  const t = ruleAt(`${PF}.study_deposit_tiers`);
  if (!t || !(mw > t.min_mw_gt)) return null;
  for (const tier of t.tiers) {
    if (ok(tier.below_mw) && !(mw < tier.below_mw)) continue;
    return ok(tier.value) ? tier.value : tier.base + tier.per_mw * mw;
  }
  return null;
}
const missing = (reason, extra = {}) => ({ status: 'missing', value: null, reason, ...extra });

/**
 * Cost to enter the queue at the request: initial deposit (cash) + study deposit (cash) + initial readiness deposit
 * (2 × study deposit; cash, LC or surety under Sched 22). ISO-NE: Schedule 22 above 20 MW, Schedule 23 at or below.
 * nrisHeld: the request already holds NRIS (or converts NR → CNR): the reduced study deposit.
 */
export function entryCost({ mw, nrisHeld = false, profile } = {}) {
  const pid = normProfile(profile); mw = num(mw);
  const empty = { total: null, cash: null, security: null, parts: [], schedule: null, cite: null, text: 'not held' };
  if (!RULES) return missing(NOT_LOADED(), empty);
  if (!ok(mw) || mw <= 0) return missing('not held: project size not set', empty);
  const b = block(mw, pid);
  let fee, sd, sdCite, feeCite, mult, multCite;
  if (b.id === 'proforma') {
    sd = proformaStudyDeposit(mw);
    if (sd == null) return { ...empty, status: 'not_applicable', value: null, schedule: 'proforma', reason: `${mw} MW: small-generator procedures, not modelled under the pro forma profile`, cite: cite(`${PF}.study_deposit_tiers`) };
    fee = val(`${PF}.application_fee`); feeCite = cite(`${PF}.application_fee`); sdCite = cite(`${PF}.study_deposit_tiers`);
    mult = ruleAt(`${PF}.readiness_deposit_initial`)?.multiple_of_study_deposit; multCite = cite(`${PF}.readiness_deposit_initial`);
  } else {
    const e = ruleAt(`${b.base}.study_deposit`);
    fee = val(`${b.base}.initial_deposit`); feeCite = cite(`${b.base}.initial_deposit`);
    sd = nrisHeld && ok(e?.alt?.value) ? e.alt.value : e?.value; sdCite = cite(`${b.base}.study_deposit`);
    mult = ruleAt(`${b.base}.readiness_deposit_initial`)?.multiple_of_study_deposit; multCite = cite(`${b.base}.readiness_deposit_initial`);
  }
  if (![fee, sd, mult].every(ok)) return missing('not held: an entry rule is missing from the rules file', { ...empty, schedule: b.id });
  const crd = mult * sd, cash = fee + sd, total = cash + crd;
  const parts = [
    { key: 'initial_deposit', label: b.id === 'proforma' ? 'Application fee' : 'Initial deposit', value: fee, cash: true, cite: feeCite },
    { key: 'study_deposit', label: `Study deposit${nrisHeld && b.id !== 'proforma' ? ' (NRIS held / NR→CNR)' : ''}`, value: sd, cash: true, cite: sdCite },
    { key: 'readiness_deposit_initial', label: `Readiness deposit (${mult} × study deposit)`, value: crd, cash: false, cite: multCite },
  ];
  // Headline citation: the study deposit (the corrected item that moved the figure from the pro forma).
  return { status: 'ok', value: total, reason: null, total, cash, security: crd, schedule: b.id, parts, cite: sdCite,
    text: `${usdK(total)} total, ${usdK(cash)} cash` };
}

/** Entry cost across sizes (the "Entry cash by project size" chart). */
export function depositCurve(sizes, profile) {
  return sizes.map(mw => { const c = entryCost({ mw, profile }); return { mw, status: c.status, schedule: c.schedule, studyDeposit: c.parts[1]?.value ?? null, readiness: c.security, cash: c.cash, total: c.total }; });
}

// ---------- deposit in lieu of site control ----------
/** NRIS only (ISO-NE), and only with a recorded regulatory limitation; $/MW clamped to the schedule's min–max. */
export function depositInLieu({ mw, service, regulatoryLimitation = false, profile } = {}) {
  const pid = normProfile(profile); mw = num(mw);
  if (!RULES) return missing(NOT_LOADED());
  if (!ok(mw) || mw <= 0) return missing('not held: project size not set');
  const b = block(mw, pid), path = `${b.base}.deposit_in_lieu_site_control`, e = ruleAt(path), c = cite(path);
  if (!e) return missing('not held: no deposit-in-lieu rule', { cite: c });
  if (pid === 'isone') {
    const need = ruleAt(`${S22}.deposit_in_lieu_site_control`)?.service;
    if (service !== 'NRIS' && service !== 'CNRIS') return { status: 'not_applicable', value: null, reason: `service type not set: the deposit in lieu is for ${need} requests only`, cite: c };
    if (service !== need) return { status: 'not_applicable', value: null, reason: `${service} has no deposit-in-lieu path: ${need} only (${c.src})`, cite: c };
  }
  if (!regulatoryLimitation) return { status: 'not_applicable', value: null, reason: `only where a regulatory limitation applies (${c.src})`, cite: c };
  const v = Math.min(e.max, Math.max(e.min, e.per_mw * mw));
  return { status: 'ok', value: v, reason: null, cite: c, perMW: e.per_mw, min: e.min, max: e.max };
}

// ---------- site control at request (S-1) ----------
/**
 * Gate on the share of the site under control at the request. pct in percent (Land stores 0–100).
 * ISO-NE: 100% at request; NRIS may instead post the deposit in lieu where a regulatory limitation applies; CNRIS has
 * no exception. Pro forma: 90% at request. Not entered → Open (unknown never passes).
 */
export function siteControlGate({ pct, service, regulatoryLimitation = false, tech, profile } = {}) {
  const pid = normProfile(profile); pct = num(pct);
  const path = pid === 'isone' ? `${S22}.site_control_at_request` : `${PF}.site_control_at_request`, c = cite(path);
  if (tech === 'datacenter') return { verdict: 'n/a', status: 'not_applicable', reason: 'a data centre is a load: generator site-control rules do not apply', cite: c, required: null };
  if (!RULES) return { verdict: 'Open', status: 'missing', reason: NOT_LOADED(), cite: c, required: null };
  const req = 100 * val(path);
  if (!ok(pct)) return { verdict: 'Open', status: 'missing', reason: 'site control not entered: not held, so it cannot pass', cite: c, required: req };
  const who = pid === 'isone' ? 'ISO-NE requires' : 'the pro forma requires';
  if (pct >= req - 1e-9) return { verdict: 'Pass', status: 'ok', via: 'site control', reason: `${pct}% meets ${req}% at request`, cite: c, required: req };
  const dil = depositInLieu({ mw: 1e9, service, regulatoryLimitation, profile: pid }); // eligibility only (size-independent)
  if (dil.status === 'ok') return { verdict: 'Pass', status: 'ok', via: 'deposit in lieu', reason: `${pct}% < ${req}%: met by the deposit in lieu (regulatory limitation recorded)`, cite: c, citeLieu: dil.cite, required: req };
  return { verdict: 'Fail', status: 'ok', via: null, reason: `${pct}% < ${req}%: ${who} ${req}% at request${pid === 'isone' ? (service === 'CNRIS' ? ' (CNRIS has no exception)' : '') : ''}`, cite: c, required: req };
}

// ---------- F016: queue cash that honours Land's site-control entry ----------
/**
 * Cash at the request, given what Land holds. If site control is demonstrated: the entry cash. If it is not held
 * (or short) and the deposit in lieu is available: entry + deposit in lieu. Otherwise blocked: "site control not held".
 * The demonstrable figure is returned as ifDemonstrated (side by side, assumption named), never as the value.
 */
export const queueCash = memo('queueCash', function queueCash({ mw, service, nrisHeld = false, sitePct, regulatoryLimitation = false, tech, profile } = {}) {
  const pid = normProfile(profile);
  if (tech === 'datacenter') return { status: 'not_applicable', value: null, reason: 'a data centre is a load: generator interconnection deposits do not apply', cite: [] };
  const entry = entryCost({ mw, nrisHeld, profile: pid });
  if (entry.status !== 'ok') return { ...entry, entry, cite: entry.cite ? [entry.cite] : [] };
  const gate = siteControlGate({ pct: sitePct, service, regulatoryLimitation, profile: pid });
  const dil = depositInLieu({ mw, service, regulatoryLimitation, profile: pid });
  const ifDemonstrated = { cash: entry.cash, total: entry.total };
  const base = { entry, gate, ifDemonstrated, ifDepositInLieu: dil.status === 'ok' ? { cash: entry.cash + dil.value, total: entry.total + dil.value, dil: dil.value } : null };
  if (gate.verdict === 'Pass' && gate.via === 'site control')
    return { ...base, status: 'ok', value: entry.cash, cash: entry.cash, total: entry.total, dil: 0, path: 'site control', reason: null, cite: [entry.cite, gate.cite] };
  if (dil.status === 'ok')
    return { ...base, status: 'ok', value: entry.cash + dil.value, cash: entry.cash + dil.value, total: entry.total + dil.value, dil: dil.value, path: 'deposit in lieu', reason: `site control ${ok(num(sitePct)) ? `${num(sitePct)}%` : 'not held'}: deposit in lieu added`, cite: [entry.cite, gate.cite, dil.cite] };
  const reason = !ok(num(sitePct)) ? 'blocked: site control not held' : `blocked: site control ${num(sitePct)}% < ${gate.required}% required at request`;
  return { ...base, status: 'blocked', value: null, cash: null, total: null, dil: null, path: null, reason, why: dil.reason, cite: [entry.cite, gate.cite] };
});

// ---------- schedule: the deadline chain (Q-C3) ----------
const DAY = 864e5;
const parseDay = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); if (!m) return null; const t = Date.UTC(+m[1], +m[2] - 1, +m[3]); return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? t : null; };
const iso = t => new Date(t).toISOString().slice(0, 10);
export const addDays = (t, n) => t + n * DAY;
/** Business days Mon–Fri, no holiday calendar (none is held). */
export function addBusinessDays(t, n) { let d = t, k = 0; while (k < n) { d += DAY; const w = new Date(d).getUTCDay(); if (w !== 0 && w !== 6) k++; } return d; }

/**
 * Every date is a tariff deadline (the latest date the step may happen), chained from the window close.
 * restudy: include one Cluster Restudy (more can follow). facilities: 'waived' | 90 | 180 (default 90).
 * Each row carries `from` (the date its clock counts from); rows are returned in date order (P2 C33: the "next window"
 * date used to sit between the Facilities Study rows). ISO-NE: every path ends at the draft LGIA tender (§11.1), `end`.
 */
export function schedule({ windowClose, restudy = false, facilities = 90, profile } = {}) {
  const pid = normProfile(profile);
  const fail = reason => ({ status: 'missing', reason, rows: [], clusterDeadline: { value: null, status: 'missing', reason, cite: cite(`${pid === 'isone' ? S22 : PF}.cluster_study_days`) }, profile: pid });
  if (!RULES) return fail(NOT_LOADED());
  const W = ruleAt(`${S22}.request_window`);
  const close = parseDay(windowClose || W?.window_2026?.[1]);
  if (close == null) return fail('not held: the request-window close date is not a valid date');
  const rows = [];
  const add = (key, step, t, path, extra = {}) => { const c = cite(path); rows.push({ key, step, date: iso(t), t, kind: 'deadline', cite: c, ...extra, from: extra.from == null ? null : iso(extra.from) }); return t; };
  const ordered = () => rows.map((r, i) => [r, i]).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(x => x[0]); // stable
  const open = parseDay(W?.window_2026?.[0]);
  if (open != null && iso(close) === W.window_2026[1]) add('window_open', 'Cluster request window opens', open, `${S22}.request_window`, { kind: 'date' });
  add('window_close', 'Cluster request window closes', close, `${S22}.request_window`, { kind: 'date', basis: windowClose ? 'your anchor' : 'ISO-NE 2026 window' });
  if (pid === 'proforma') {
    const cew = add('cew_close', 'Customer engagement window closes', addDays(close, val(`${PF}.customer_engagement_window_days`)), `${PF}.customer_engagement_window_days`, { days: val(`${PF}.customer_engagement_window_days`), from: close });
    let t = add('cluster_report', 'Cluster Study Report', addDays(cew, val(`${PF}.cluster_study_days`)), `${PF}.cluster_study_days`, { days: val(`${PF}.cluster_study_days`), from: cew });
    const clusterDeadline = { value: iso(t), status: 'ok', cite: cite(`${PF}.cluster_study_days`), text: `${iso(t)} · pro forma` };
    if (restudy) t = add('restudy_report', 'Cluster Restudy Report', addDays(t, val(`${PF}.restudy_days`)), `${PF}.restudy_days`, { days: val(`${PF}.restudy_days`), from: t });
    if (facilities !== 'waived') { const d = Number(facilities) === 180 ? 180 : 90; t = add('fs_report', `Facilities Study (${d} d)`, addDays(t, d), `${PF}.facilities_study_days`, { days: d, from: t }); }
    const sorted = ordered();
    return { status: 'ok', reason: null, rows: sorted, clusterDeadline, end: sorted.at(-1), profile: pid, note: 'Pro forma: main clocks summed; sub-step clocks are not held for this profile.' };
  }
  const n = k => val(`${S22}.${k}`);
  const cewDays = n('customer_engagement_window_days'), csDays = n('cluster_study_days');
  const cew = add('cew_close', 'Customer engagement window closes', addDays(close, cewDays), `${S22}.customer_engagement_window_days`, { days: cewDays, from: close });
  const report = add('cluster_report', 'Cluster Study Report deadline', addDays(cew, csDays), `${S22}.cluster_study_days`, { days: csDays, note: 'a deadline, not an earliest date', from: cew });
  const clusterDeadline = { value: iso(report), status: 'ok', cite: cite(`${S22}.cluster_study_days`), text: `${iso(report)} · ${cite(`${S22}.cluster_study_days`).text}` };
  let meeting = add('report_meeting', 'Cluster Study Report meeting', addBusinessDays(report, n('report_meeting_business_days')), `${S22}.report_meeting_business_days`, { days: `${n('report_meeting_business_days')} BD`, from: report });
  let decision = addDays(meeting, n('restudy_decision_days'));
  if (restudy) {
    decision = add('restudy_decision', 'Restudy decision', decision, `${S22}.restudy_decision_days`, { days: n('restudy_decision_days'), from: meeting });
    const rr = add('restudy_report', 'Cluster Restudy Report', addDays(decision, n('restudy_days')), `${S22}.restudy_days`, { days: n('restudy_days'), note: 'more restudies can follow', from: decision });
    meeting = add('restudy_meeting', 'Restudy Report meeting', addBusinessDays(rr, n('report_meeting_business_days')), `${S22}.report_meeting_business_days`, { days: `${n('report_meeting_business_days')} BD`, from: rr });
    decision = addDays(meeting, n('restudy_decision_days'));
  }
  add('next_window', 'Next cluster request window opens', addDays(meeting, W.next_window_after_meeting_days), `${S22}.request_window`, { days: W.next_window_after_meeting_days, kind: 'date', from: meeting });
  if (facilities === 'waived') {
    const wv = add('fs_waiver', 'Facilities Study waiver elected', addDays(meeting, n('facilities_study_waiver_days')), `${S22}.facilities_study_waiver_days`, { days: n('facilities_study_waiver_days'), note: 'only if no shared network upgrade, or every sharer agrees', from: meeting });
    add('lgia_tender', 'Draft LGIA tendered', addDays(wv, n('lgia_tender_days')), `${S22}.lgia_tender_days`, { days: n('lgia_tender_days'), from: wv });
  } else {
    const fa = ruleAt(`${S22}.facilities_study_agreement`), d = Number(facilities) === 180 ? 180 : 90;
    const ten = add('fs_tender', 'Facilities Study agreement tendered', addBusinessDays(decision, fa.tender_business_days), `${S22}.facilities_study_agreement`, { days: `${fa.tender_business_days} BD after the no-restudy notice (≤ ${n('restudy_decision_days')} d after the meeting)`, from: decision });
    const ex = add('fs_execute', 'Facilities Study agreement executed', addDays(ten, fa.execute_days), `${S22}.facilities_study_agreement`, { days: fa.execute_days, from: ten });
    const fs = add('fs_report', `Draft Facilities Study report (${d} d)`, addDays(ex, d), `${S22}.facilities_study_days`, { days: d, from: ex });
    // §11.1 counts the tender from the FS comments; the comment period is not held, so this counts from the draft report.
    add('lgia_tender', 'Draft LGIA tendered', addDays(fs, n('lgia_tender_days')), `${S22}.lgia_tender_days`, { days: n('lgia_tender_days'), from: fs,
      note: 'counted from the draft Facilities Study report: the FS comment period is not held, so the tariff deadline (15 d after the comments) is later' });
  }
  const sorted = ordered();
  return { status: 'ok', reason: null, rows: sorted, clusterDeadline, end: sorted.find(r => r.key === 'lgia_tender'), profile: pid, note: 'Each date is the latest the tariff allows; actual dates can be earlier (or later where ISO-NE misses a deadline).' };
}
/** The Cluster Study Report deadline alone (the grid column and the Schedule KPI share this). */
export const clusterDeadline = memo('clusterDeadline', (opts = {}) => schedule(opts).clusterDeadline);

// ---------- cash by phase and withdrawal penalties ----------
const PHASES = ['Cluster request', 'Cluster study', 'After the cluster study report', 'Cluster restudy (if triggered)', 'Facilities study / draft LGIA', 'After LGIA execution'];
/**
 * Readiness balance, cash posted and the forfeit on withdrawal by phase. nu = allocated network-upgrade cost ($) or
 * null (later phases not held, never $0). depositInLieu = $ already decided by queueCash (0 if none).
 */
export function commitments({ mw, nu, nrisHeld = false, depositInLieu: dil = 0, profile } = {}) {
  const pid = normProfile(profile);
  const e = entryCost({ mw, nrisHeld, profile: pid });
  if (e.status !== 'ok') return { status: e.status, reason: e.reason, errors: [e.reason], phases: [], studyDeposit: null, fee: null, depositInLieu: null, lgiaDeposit: null, nuHeld: false };
  const sd = e.parts[1].value, fee = e.parts[0].value, crd0 = e.security;
  nu = ok(num(nu)) && num(nu) >= 0 ? num(nu) : null;
  const P = pid === 'proforma'
    ? { r: ruleAt(`${PF}.readiness_stages`).restudy, f: ruleAt(`${PF}.readiness_stages`).facilities_study, l: ruleAt(`${PF}.readiness_stages`).lgia, cR: cite(`${PF}.readiness_stages`), cF: cite(`${PF}.readiness_stages`), cL: cite(`${PF}.readiness_stages`) }
    : { r: ruleAt(`${S22}.readiness_deposit_restudy`).pct_of_network_upgrades, f: ruleAt(`${S22}.readiness_deposit_facilities_study`).pct_of_network_upgrades, l: ruleAt(`${S22}.lgia_deposit`).pct_of_network_upgrades,
      cR: cite(`${S22}.readiness_deposit_restudy`), cF: cite(`${S22}.readiness_deposit_facilities_study`), cL: cite(`${S22}.lgia_deposit`) };
  const mult = ruleAt(`${S22}.withdrawal_penalty`).study_cost_multiple, cPen = cite(`${S22}.withdrawal_penalty`), cFloor = cite(`${S22}.readiness_floor`);
  const target = (x, prev) => (nu == null || prev == null ? null : Math.max(prev, x * nu)); // floor: never below what is posted
  const forfeit = x => (nu == null ? null : Math.max(sd, x * nu));
  const r1 = crd0, r2 = target(P.r, r1), r3 = r2, r4 = target(P.f, r3), r5 = target(P.l, r4);
  const phases = [
    { readiness: r1, penaltyIfWithdrawn: 0, penaltyLowerBound: false, penaltyNote: `No penalty before ${ruleAt(`${S22}.withdrawal_penalty`).none_before}`, studyDepositHeld: true, cite: [e.parts[2].cite, cPen] },
    { readiness: r1, penaltyIfWithdrawn: sd, penaltyLowerBound: true, penaltyNote: `Greater of the study deposit or ${mult} × allocated study cost (study cost not held, so this is a lower bound)`, studyDepositHeld: true, cite: [e.parts[2].cite, cPen] },
    { readiness: r2, penaltyIfWithdrawn: sd, penaltyLowerBound: true, penaltyNote: `Until a restudy begins: greater of the study deposit or ${mult} × allocated study cost (a lower bound). Readiness tops up to ${100 * P.r}% of network upgrades within ${ruleAt(`${S22}.readiness_deposit_restudy`).due_days} days of the report meeting`, studyDepositHeld: true, cite: [P.cR, cFloor, cPen] },
    { readiness: r3, penaltyIfWithdrawn: forfeit(P.r), penaltyLowerBound: false, penaltyNote: `Greater of the study deposit or ${100 * P.r}% of network-upgrade cost`, studyDepositHeld: true, cite: [P.cR, cPen] },
    { readiness: r4, penaltyIfWithdrawn: forfeit(P.f), penaltyLowerBound: false, penaltyNote: `Greater of the study deposit or ${100 * P.f}%`, studyDepositHeld: true, cite: [P.cF, cFloor, cPen] },
    { readiness: r5, penaltyIfWithdrawn: forfeit(P.l), penaltyLowerBound: false, penaltyNote: `Greater of the study deposit or ${100 * P.l}%. The LGIA deposit = ${100 * P.l}% of network upgrades less readiness already paid`, studyDepositHeld: false, cite: [P.cL, cPen] },
  ].map((p, i) => ({ phase: PHASES[i], ...p }));
  let prev = 0;
  for (const p of phases) {
    p.topUp = p.readiness == null ? null : Math.max(0, p.readiness - prev);
    if (p.readiness != null) prev = p.readiness;
    p.cashPosted = p.readiness == null ? null : p.readiness + (p.studyDepositHeld ? sd : 0) + (ok(dil) ? dil : 0);
    // P2 C32: cashPosted = security + deposits posted (readiness may be an LC or surety bond); cashMin = the part that
    // must be cash: the study deposit while held + the deposit in lieu (cash). The initial deposit is a fee, paid not posted.
    p.cashMin = (p.studyDepositHeld ? sd : 0) + (ok(dil) ? dil : 0);
    p.preLgia = p.phase !== PHASES[PHASES.length - 1];
  }
  return { status: 'ok', reason: null, errors: [], studyDeposit: sd, fee, depositInLieu: ok(dil) ? dil : 0, phases, nuHeld: nu != null, schedule: e.schedule, entry: e,
    lgiaDeposit: nu == null || r4 == null ? null : Math.max(0, P.l * nu - r4) };
}

/**
 * P2 C32: the pre-construction peak of cash + security posted, the post-LGIA phase excluded. A later phase not held
 * (network-upgrade cost unknown) makes the peak a lower bound. {value, lowerBound, phase, reason}.
 */
export function peakPreLgia(c) {
  const pre = (c?.phases || []).filter(p => p.preLgia), held = pre.filter(p => ok(p.cashPosted));
  if (!held.length) return { value: null, lowerBound: false, phase: null, reason: c?.reason || 'not held: no phase held' };
  const top = held.reduce((a, p) => (p.cashPosted > a.cashPosted ? p : a)), partial = held.length < pre.length;
  return { value: top.cashPosted, lowerBound: partial, phase: top.phase, reason: partial ? 'later phases not held (network-upgrade cost unknown): a lower bound' : null };
}

/**
 * Withdrawal-penalty exemptions. Both profiles use the Sched 22 text (ISO-NE adopted the pro forma §3.7.1 unchanged):
 * strictly more than 25% on a Cluster Restudy Report (reportType 'restudy'), strictly more than 100% at the FS report.
 * A missing or zero base → increase and exemption null (not held), never "not exempt".
 */
export function penaltyExemptions({ priorReport, current, reportType = 'restudy', clusterStudy, facilitiesStudy } = {}) {
  const path = `${S22}.withdrawal_penalty_exemptions`, e = ruleAt(path) || {}, c = cite(path);
  const inc = (a, b) => (ok(a) && a > 0 && ok(b) ? b / a - 1 : null);
  const t1 = inc(priorReport, current), t2 = inc(clusterStudy, facilitiesStudy);
  const onRestudy = reportType === 'restudy';
  return [
    { id: 'vs-prior', test: 'Restudy report cost vs the preceding report', from: ok(priorReport) ? priorReport : null, to: ok(current) ? current : null, increase: t1, threshold: e.restudy_increase_gt ?? null, op: '>',
      exempt: t1 == null || !ok(e.restudy_increase_gt) ? null : onRestudy ? t1 > e.restudy_increase_gt + 1e-12 : false,
      note: onRestudy ? null : 'Measured on a Cluster Restudy Report only: no exemption off the first Cluster Study Report', cite: c },
    { id: 'fac-vs-cluster', test: 'Facilities study vs the cluster study (or restudy)', from: ok(clusterStudy) ? clusterStudy : null, to: ok(facilitiesStudy) ? facilitiesStudy : null, increase: t2, threshold: e.facilities_increase_gt ?? null, op: '>',
      exempt: t2 == null || !ok(e.facilities_increase_gt) ? null : t2 > e.facilities_increase_gt + 1e-12, note: null, cite: c },
  ];
}

// ---------- GAPS §4.3: proportional-impact allocation (PP5-6 Rev 15 §10.4.4) ----------
/**
 * participants: [{id, mw, impacts:[{element, dfaxNR, dfaxCNR}]}] (one row per element × contingency; DFAX on the
 * project's highest violation, pre-upgrade). impact(i,e) = MW × max(DFAX_NR, DFAX_CNR), charged only if that DFAX
 * exceeds the threshold; a project's impact = Σ over elements of its highest impact on each. share = impact ÷ Σ.
 * A participant with no MW → the whole allocation is not held (the denominator is unknown).
 */
export function allocateProportional(participants, upgradeCost, { threshold } = {}) {
  const path = `${S22}.cost_allocation`, c = cite(path);
  if (!RULES) return { status: 'missing', reason: NOT_LOADED(), rows: [], cite: c };
  const thr = ok(threshold) ? threshold : ruleAt(path).dfax_threshold;
  const cost = ok(num(upgradeCost)) ? num(upgradeCost) : null;
  const rows = (participants || []).map(p => {
    const mw = num(p.mw), byEl = new Map();
    for (const im of p.impacts || []) {
      const d = Math.max(...[im.dfaxNR, im.dfaxCNR].map(num).filter(ok));
      if (!Number.isFinite(d)) continue;
      const charged = d > thr + 1e-12, impact = ok(mw) && charged ? mw * d : 0;
      const cur = byEl.get(im.element);
      if (!cur || impact > cur.impact || (impact === cur.impact && d > cur.dfax)) byEl.set(im.element, { element: im.element, dfax: d, charged, impact });
    }
    const els = [...byEl.values()];
    return { id: p.id, mw: ok(mw) ? mw : null, elements: els, impact: ok(mw) ? els.reduce((a, x) => a + x.impact, 0) : null };
  });
  const unknown = rows.filter(r => r.mw == null);
  if (unknown.length) return { status: 'missing', reason: `not held: MW not set for ${unknown.map(r => r.id).join(', ')}`, rows: rows.map(r => ({ ...r, share: null, cost: null })), total: null, cite: c, threshold: thr };
  const total = rows.reduce((a, r) => a + r.impact, 0);
  if (!(total > 0)) return { status: 'not_applicable', reason: `no participant has a DFAX above ${100 * thr}% on any element`, rows: rows.map(r => ({ ...r, share: 0, cost: cost == null ? null : 0 })), total, cite: c, threshold: thr };
  return { status: 'ok', reason: null, total, threshold: thr, cite: c, standaloneUpperBound: cost,
    rows: rows.map(r => ({ ...r, share: r.impact / total, cost: cost == null ? null : (r.impact / total) * cost })) };
}

// ---------- GAPS §4.4: MVA thermal screen ----------
/**
 * Loading = √((P + DFAX·MW)² + Q²) ÷ R. Where Q is not held: the MW loading |P + DFAX·MW| ÷ R plus the labelled
 * pf bound |P + DFAX·MW| ÷ (R·pf_min). R basis: Normal pre-contingency ('base'), LTE post-contingency ('post');
 * the DB's rating column is "as stored" (mapping unverifiable). Screening: overload recorded at ≥ 2% above the
 * rating (NCIS); the project participates if its DFAX exceeds 3%.
 */
export function thermalScreen({ p, q, dfax, mw = 0, rating, contingency = 'post' } = {}) {
  const ratings = ruleAt(`${S22}.ratings`), thr = ruleAt(`${S22}.screening_thresholds`), pfE = ruleAt(`${TS}.pf_min_sensitivity`);
  const cites = [cite(`${S22}.ratings`), cite(`${S22}.screening_thresholds`), cite(`${S22}.cost_allocation`), cite(`${TS}.pf_min_sensitivity`)];
  const ratingBasis = ratings ? (contingency === 'base' ? ratings.pre_contingency : ratings.post_contingency) : null;
  [p, q, dfax, mw, rating] = [p, q, dfax, mw, rating].map(num);
  const none = { loading: null, loadingPfBound: null, transferLimitMW: null, transferLimitPfMW: null, overload: null, recorded: null, participates: null };
  if (!RULES) return { status: 'missing', reason: NOT_LOADED(), ...none, ratingBasis, cite: cites };
  if (![p, dfax, rating].every(ok) || !(rating > 0) || !ok(mw)) return { status: 'missing', reason: 'not held: flow, DFAX or rating missing', ...none, ratingBasis, cite: cites, ratingNote: ratings?.note };
  const pf = pfE.value, P = p + dfax * mw, qHeld = ok(q);
  const loading = qHeld ? Math.hypot(P, q) / rating : Math.abs(P) / rating;
  const loadingPfBound = qHeld ? null : Math.abs(P) / (rating * pf);
  const lim = r => (dfax > 0 ? (r - p) / dfax : null);
  const worst = qHeld ? loading : loadingPfBound;
  return { status: 'ok', reason: null, loading, loadingPfBound, bound: !qHeld, pf: qHeld ? null : pf,
    transferLimitMW: qHeld ? (dfax > 0 && rating > Math.abs(q) ? (Math.sqrt(rating ** 2 - q ** 2) - p) / dfax : null) : lim(rating),
    transferLimitPfMW: qHeld ? null : lim(rating * pf),
    overload: worst > 1 + 1e-12, recorded: worst >= 1 + thr.ncis_overload_pct - 1e-12, participates: dfax > ruleAt(`${S22}.cost_allocation`).dfax_threshold + 1e-12,
    ratingBasis, ratingNote: ratings.note, cite: cites };
}

// ---------- citations for the Inspector Evidence tab ----------
const human = k => k.replace(/_/g, ' ').replace(/^./, ch => ch.toUpperCase());
/** Every interconnection rule the profile uses: [{path, label, src, status, effective, text, note}], profile first. */
export function citations(profile) {
  if (!RULES) return [];
  const pid = normProfile(profile);
  const blocks = pid === 'isone' ? [[S22, 'Sched 22'], [S23, 'Sched 23'], [TS, 'Thermal screen'], ['interconnection.storage_charge_screen', 'Storage charge screen']] : [[PF, 'Pro forma'], [TS, 'Thermal screen'], [`${S22}.withdrawal_penalty`, null], [`${S22}.withdrawal_penalty_exemptions`, null]];
  const out = [];
  for (const [base, prefix] of blocks) {
    const b = ruleAt(base); if (!b) continue;
    if ('status' in b) { const c = cite(base); out.push({ ...c, label: `Withdrawal · ${human(base.split('.').pop())}`, note: b.note || null }); continue; }
    for (const [k, v] of Object.entries(b)) {
      if (k.startsWith('_') || !v || typeof v !== 'object' || Array.isArray(v) || !('status' in v)) continue;
      const c = cite(`${base}.${k}`);
      out.push({ ...c, label: `${prefix} · ${human(k)}`, note: v.note || null });
    }
  }
  const first = pid === 'isone' ? `${S22}.profile` : `${PF}.profile`;
  return [...out.filter(r => r.path === first), ...out.filter(r => r.path !== first)];
}
