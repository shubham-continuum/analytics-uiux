// S3: the ISO-NE interconnection rules engine (rules/isone.js) against the acceptance examples Q-C1, Q-C3, S-1
// (v8-isone-complete/design/02-inputs-outputs.md), F016 (Findings.md), GAPS §4.2–4.4 as corrected by R1.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S3) · 2026-10-06 · sign-off pending · v1
// Expected numbers are written from R1 / REGISTER (independent of the engine); the rules file is read raw for the
// citation strings only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as E from '../rules/isone.js';

const RAW = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url), 'utf8'));
E.setRules(RAW);
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

// ---------- profile switch ----------
test('profile switch: ISO-NE is the default; pro forma is labelled as not the ISO-NE rule', () => {
  assert.equal(E.DEFAULT_PROFILE, 'isone');
  assert.equal(E.normProfile(undefined), 'isone');
  assert.equal(E.normProfile('nonsense'), 'isone');
  assert.equal(E.normProfile('proforma'), 'proforma');
  const i = E.profileInfo('isone'), p = E.profileInfo('proforma');
  assert.match(i.label, /Schedule 22/);
  assert.equal(i.effective, '2024-08-12');
  assert.match(p.label, /pro forma/i);
  assert.match(p.label, /not the ISO-NE rule/);
  assert.equal(p.labelled, true);
  assert.equal(i.labelled, false);
});

// ---------- Q-C1: entry cash ----------
test('Q-C1: ISO-NE entry = $50k + $250k + $500k = $800k, of which $300k is cash, flat for every size above 20 MW', () => {
  for (const mw of [21, 100, 150, 500]) {
    const c = E.entryCost({ mw });
    assert.equal(c.status, 'ok');
    assert.equal(c.total, 800000, `${mw} MW`);
    assert.equal(c.cash, 300000);
    assert.equal(c.security, 500000);
    assert.equal(c.schedule, '22');
  }
  const c = E.entryCost({ mw: 150 });
  assert.equal(c.text, '$800k total, $300k cash');
  assert.equal(c.cite.text, 'Sched 22 §3.4.1.1 · corrected');
  assert.equal(c.cite.effective, '2024-08-12');
  assert.deepEqual(c.parts.map(p => p.value), [50000, 250000, 500000]);
  assert.deepEqual(c.parts.map(p => p.cash), [true, true, false]);
  for (const p of c.parts) assert.ok(p.cite.src && p.cite.status && p.cite.effective, p.key);
});

test('entry: NRIS already held (or NR→CNR) uses the $100k study deposit; readiness follows at 2×', () => {
  const c = E.entryCost({ mw: 100, nrisHeld: true });
  assert.equal(c.cash, 150000); assert.equal(c.total, 350000);
});

test('entry at 20 MW and below follows Schedule 23: $15k + $100k + $200k = $315k, $115k cash', () => {
  for (const mw of [5, 20]) {
    const c = E.entryCost({ mw });
    assert.equal(c.schedule, '23'); assert.equal(c.total, 315000); assert.equal(c.cash, 115000);
  }
});

test('entry under the pro forma profile: $5k + tiered deposit + 2× (100 MW → $455k; 21 MW → $173k); ≤ 20 MW not modelled', () => {
  const a = E.entryCost({ mw: 100, profile: 'proforma' });
  assert.equal(a.total, 455000); assert.equal(a.cash, 155000); assert.equal(a.schedule, 'proforma');
  assert.equal(E.entryCost({ mw: 21, profile: 'proforma' }).total, 173000);
  assert.equal(E.entryCost({ mw: 79, profile: 'proforma' }).parts[1].value, 114000);
  assert.equal(E.entryCost({ mw: 80, profile: 'proforma' }).parts[1].value, 150000);
  assert.equal(E.entryCost({ mw: 200, profile: 'proforma' }).parts[1].value, 250000);
  const s = E.entryCost({ mw: 20, profile: 'proforma' });
  assert.equal(s.status, 'not_applicable'); assert.equal(s.total, null); assert.equal(s.value, null);
});

test('entry with no size is not held (never $0)', () => {
  for (const mw of [null, undefined, 0, -5, NaN, 'x']) {
    const c = E.entryCost({ mw });
    assert.equal(c.status, 'missing'); assert.equal(c.value, null); assert.equal(c.cash, null);
  }
});

test('deposit curve: flat $800k above 20 MW, $315k at and below (ISO-NE); tiered under the pro forma', () => {
  const c = E.depositCurve([10, 20, 21, 100, 500]);
  assert.deepEqual(c.map(p => p.total), [315000, 315000, 800000, 800000, 800000]);
  assert.deepEqual(c.map(p => p.cash), [115000, 115000, 300000, 300000, 300000]);
  const f = E.depositCurve([20, 100], 'proforma');
  assert.equal(f[0].total, null); assert.equal(f[1].total, 455000);
});

// ---------- deposit in lieu ----------
test('deposit in lieu: NRIS with a regulatory limitation only; $10k/MW within $0.5M–$2M (S22) or $50k–$200k (S23)', () => {
  const d = mw => E.depositInLieu({ mw, service: 'NRIS', regulatoryLimitation: true });
  assert.equal(d(30).value, 500000); assert.equal(d(100).value, 1000000); assert.equal(d(500).value, 2000000);
  assert.equal(d(10).value, 100000); assert.equal(d(3).value, 50000);
  assert.equal(d(100).cite.text, 'Sched 22 §3.4.2 · verified');
  const cn = E.depositInLieu({ mw: 100, service: 'CNRIS', regulatoryLimitation: true });
  assert.equal(cn.status, 'not_applicable'); assert.equal(cn.value, null); assert.match(cn.reason, /CNRIS/);
  const nl = E.depositInLieu({ mw: 100, service: 'NRIS', regulatoryLimitation: false });
  assert.equal(nl.status, 'not_applicable'); assert.match(nl.reason, /regulatory limitation/);
  const ns = E.depositInLieu({ mw: 100, service: null, regulatoryLimitation: true });
  assert.equal(ns.status, 'not_applicable'); assert.match(ns.reason, /service/i);
  // pro forma: any service, regulatory limitation required
  assert.equal(E.depositInLieu({ mw: 100, service: 'CNRIS', regulatoryLimitation: true, profile: 'proforma' }).value, 1000000);
});

// ---------- S-1: site control ----------
test('S-1: ISO-NE, 95% control → Fail "ISO-NE requires 100% at request"; the pro forma profile passes it', () => {
  const g = E.siteControlGate({ pct: 95, service: 'CNRIS' });
  assert.equal(g.verdict, 'Fail');
  assert.match(g.reason, /ISO-NE requires 100% at request/);
  assert.equal(g.cite.text, 'Sched 22 §3.4.2 · corrected');
  assert.equal(E.siteControlGate({ pct: 95, profile: 'proforma' }).verdict, 'Pass');
  assert.equal(E.siteControlGate({ pct: 89, profile: 'proforma' }).verdict, 'Fail');
  assert.equal(E.siteControlGate({ pct: 100 }).verdict, 'Pass');
});

test('site control not entered is Open (unknown never passes); NRIS + regulatory limitation passes via the deposit in lieu; CNRIS has no exception', () => {
  const o = E.siteControlGate({ pct: null });
  assert.equal(o.verdict, 'Open'); assert.equal(o.status, 'missing'); assert.match(o.reason, /not held/);
  const v = E.siteControlGate({ pct: 40, service: 'NRIS', regulatoryLimitation: true });
  assert.equal(v.verdict, 'Pass'); assert.equal(v.via, 'deposit in lieu');
  assert.equal(E.siteControlGate({ pct: 40, service: 'CNRIS', regulatoryLimitation: true }).verdict, 'Fail');
  assert.equal(E.siteControlGate({ pct: 100, tech: 'datacenter' }).verdict, 'n/a');
});

// ---------- F016: queue cash honours Land ----------
test('F016: site control not held in Land → "blocked: site control not held", never the demonstrable figure', () => {
  const b = E.queueCash({ mw: 100, sitePct: null, service: 'CNRIS' });
  assert.equal(b.status, 'blocked'); assert.equal(b.value, null);
  assert.equal(b.reason, 'blocked: site control not held');
  assert.equal(b.ifDemonstrated.cash, 300000);
  const b95 = E.queueCash({ mw: 100, sitePct: 95, service: 'CNRIS' });
  assert.equal(b95.status, 'blocked'); assert.match(b95.reason, /95%/);
});

test('F016: NRIS with a regulatory limitation takes the deposit-in-lieu path: cash $1.3M, total $1.8M at 100 MW', () => {
  const d = E.queueCash({ mw: 100, sitePct: null, service: 'NRIS', regulatoryLimitation: true });
  assert.equal(d.status, 'ok'); assert.equal(d.path, 'deposit in lieu');
  assert.equal(d.dil, 1000000); assert.equal(d.cash, 1300000); assert.equal(d.total, 1800000); assert.equal(d.value, 1300000);
  const ok = E.queueCash({ mw: 100, sitePct: 100, service: 'CNRIS' });
  assert.equal(ok.status, 'ok'); assert.equal(ok.path, 'site control'); assert.equal(ok.cash, 300000); assert.equal(ok.dil, 0);
  assert.equal(E.queueCash({ mw: 100, sitePct: 100, tech: 'datacenter' }).status, 'not_applicable');
});

// ---------- Q-C3: schedule ----------
test('Q-C3: from a 2026-11-19 close, CEW 60 d ends 2027-01-18 and the Cluster Study Report deadline is 2027-10-15 (a deadline, not an earliest date)', () => {
  const s = E.schedule({ windowClose: '2026-11-19' });
  assert.equal(s.status, 'ok');
  const at = k => s.rows.find(r => r.key === k);
  assert.equal(at('window_open').date, '2026-10-05');
  assert.equal(at('cew_close').date, '2027-01-18');
  assert.equal(at('cluster_report').date, '2027-10-15');
  assert.equal(at('cluster_report').kind, 'deadline');
  assert.equal(s.clusterDeadline.value, '2027-10-15');
  assert.equal(s.clusterDeadline.cite.text, 'Sched 22 §7.4 · corrected');
  assert.equal(at('cew_close').cite.status, 'verified');
  assert.equal(at('report_meeting').date, '2027-10-29');
  assert.equal(at('next_window').date, '2027-12-28');
});

test('schedule paths: FS waived → waiver by 2027-11-18, LGIA tender by 2027-12-03; one restudy → decision by 2027-11-28, report by 2028-02-26', () => {
  const w = E.schedule({ windowClose: '2026-11-19', facilities: 'waived' });
  assert.equal(w.rows.find(r => r.key === 'fs_waiver').date, '2027-11-18');
  assert.equal(w.rows.find(r => r.key === 'lgia_tender').date, '2027-12-03');
  const r = E.schedule({ windowClose: '2026-11-19', restudy: true });
  assert.equal(r.rows.find(x => x.key === 'restudy_decision').date, '2027-11-28');
  assert.equal(r.rows.find(x => x.key === 'restudy_report').date, '2028-02-26');
  const f = E.schedule({ windowClose: '2026-11-19', facilities: 180 });
  assert.ok(f.rows.find(x => x.key === 'fs_report').date > f.rows.find(x => x.key === 'cluster_report').date);
});

test('schedule defaults to the 2026 window close from the rules file; pro forma runs CEW 60 + 150 d; a bad date is not held', () => {
  assert.equal(E.schedule({}).rows.find(r => r.key === 'window_close').date, '2026-11-19');
  assert.equal(E.schedule({ windowClose: '2026-11-19', profile: 'proforma' }).clusterDeadline.value, '2027-06-17');
  const bad = E.schedule({ windowClose: 'soon' });
  assert.equal(bad.status, 'missing'); assert.equal(bad.clusterDeadline.value, null);
  assert.equal(E.clusterDeadline({ windowClose: '2026-11-19' }).value, '2027-10-15');
});

// ---------- cash by phase and penalties ----------
test('ISO-NE commitments at 100 MW, NU $10M: readiness 500k → 5% / 10% / 20% totals; penalties floored at the $250k study deposit', () => {
  const c = E.commitments({ mw: 100, nu: 10e6 });
  assert.deepEqual(c.phases.map(p => p.readiness), [500000, 500000, 500000, 500000, 1000000, 2000000]);
  assert.deepEqual(c.phases.map(p => p.penaltyIfWithdrawn), [0, 250000, 250000, 500000, 1000000, 2000000]);
  assert.equal(c.lgiaDeposit, 1000000, '20% × NU − readiness already posted');
  assert.equal(c.fee, 50000); assert.equal(c.studyDeposit, 250000);
  assert.ok(c.phases.every(p => p.topUp >= 0));
});

test('readiness never falls below what is posted (floor cited as unverifiable); unknown NU leaves later phases not held', () => {
  const small = E.commitments({ mw: 100, nu: 1e6 });
  assert.equal(small.phases[2].readiness, 500000);
  assert.equal(small.phases[2].cite.find(x => /readiness_floor/.test(x.path)).status, 'unverifiable');
  const u = E.commitments({ mw: 100, nu: null });
  assert.equal(u.phases[1].readiness, 500000);
  assert.equal(u.phases[2].readiness, null);
  assert.equal(u.phases[2].penaltyIfWithdrawn, 250000); assert.equal(u.phases[2].penaltyLowerBound, true);
  assert.equal(u.phases[3].penaltyIfWithdrawn, null);
  assert.equal(u.lgiaDeposit, null);
});

test('pro forma commitments keep the federal table (100 MW, NU $10M)', () => {
  const c = E.commitments({ mw: 100, nu: 10e6, profile: 'proforma' });
  assert.deepEqual(c.phases.map(p => p.readiness), [300000, 300000, 500000, 500000, 1000000, 2000000]);
  assert.deepEqual(c.phases.map(p => p.penaltyIfWithdrawn), [0, 150000, 150000, 500000, 1000000, 2000000]);
});

test('withdrawal exemptions (ISO-NE): strictly more than 25% on a Restudy Report only; strictly more than 100% at the FS', () => {
  const e = E.penaltyExemptions({ priorReport: 10e6, current: 12.5e6, reportType: 'restudy', clusterStudy: 10e6, facilitiesStudy: 20e6 });
  assert.equal(e[0].exempt, false, 'exactly 25% is not more than 25%');
  assert.equal(e[1].exempt, false, 'exactly 100% is not more than 100%');
  assert.equal(E.penaltyExemptions({ priorReport: 10e6, current: 12.6e6, reportType: 'restudy' })[0].exempt, true);
  const c = E.penaltyExemptions({ priorReport: 10e6, current: 13e6, reportType: 'cluster' })[0];
  assert.equal(c.exempt, false); assert.match(c.note, /Restudy Report only/);
  assert.equal(E.penaltyExemptions({ clusterStudy: 10e6, facilitiesStudy: 20.1e6 })[1].exempt, true);
  const n = E.penaltyExemptions({ priorReport: null, current: 5e6, clusterStudy: 0, facilitiesStudy: 5e6 });
  assert.equal(n[0].exempt, null); assert.equal(n[1].exempt, null);
  assert.equal(e[0].cite.text, 'Sched 22 §3.7.1, §3.7.1.1 · corrected');
});

// ---------- GAPS 4.3: proportional impact (PP5-6 Rev 15) ----------
test('PP5-6 Example 4: 20% × 100 MW = 20, 10% × 400 MW = 40; a $30 upgrade splits $10 / $20', () => {
  const a = E.allocateProportional([{ id: 'G1', mw: 100, impacts: [{ element: 'L1', dfaxNR: 0.2 }] }, { id: 'G2', mw: 400, impacts: [{ element: 'L1', dfaxNR: 0.1 }] }], 30);
  assert.equal(a.status, 'ok');
  near(a.rows[0].impact, 20); near(a.rows[1].impact, 40);
  near(a.rows[0].cost, 10); near(a.rows[1].cost, 20);
  assert.match(a.cite.text, /PP5-6 Rev 15/);
  assert.equal(a.cite.effective, '2026-10-02');
});

test('PP5-6 Example 7: impacts summed over elements (30 vs 60 → 1/3, 2/3); highest impact per element; higher of NR/CNR', () => {
  const a = E.allocateProportional([
    { id: 'Gen 1', mw: 100, impacts: [{ element: 'A', dfaxNR: 0.2 }, { element: 'A', dfaxNR: 0.15 }, { element: 'B', dfaxNR: 0.05, dfaxCNR: 0.1 }] },
    { id: 'Gen 2', mw: 200, impacts: [{ element: 'A', dfaxNR: 0.1 }, { element: 'B', dfaxNR: 0.2 }] }], 90);
  near(a.rows[0].impact, 30); near(a.rows[1].impact, 60);
  near(a.rows[0].share, 1 / 3); near(a.rows[1].share, 2 / 3); near(a.rows[0].cost, 30);
});

test('allocation threshold: DFAX exactly 3% is not charged; nobody above 3% → not applicable; a missing MW → not held', () => {
  const a = E.allocateProportional([{ id: 'X', mw: 100, impacts: [{ element: 'L', dfaxNR: 0.03 }] }, { id: 'Y', mw: 100, impacts: [{ element: 'L', dfaxNR: 0.031 }] }], 10);
  assert.equal(a.rows[0].share, 0); near(a.rows[1].share, 1);
  const none = E.allocateProportional([{ id: 'X', mw: 100, impacts: [{ element: 'L', dfaxNR: 0.01 }] }], 10);
  assert.equal(none.status, 'not_applicable');
  const m = E.allocateProportional([{ id: 'X', mw: null, impacts: [{ element: 'L', dfaxNR: 0.2 }] }, { id: 'Y', mw: 100, impacts: [{ element: 'L', dfaxNR: 0.2 }] }], 10);
  assert.equal(m.status, 'missing'); assert.ok(m.rows.every(r => r.cost === null));
});

// ---------- GAPS 4.4: MVA thermal screen ----------
test('MVA screen on HATCHVILLE–FAL TAP (flow 169.7, DFAX 0.442, rating 257): MW limit ≈ 197.5; pf 0.95 bound ≈ 168 (a sensitivity)', () => {
  const t = E.thermalScreen({ p: 169.7, dfax: 0.442, rating: 257, contingency: 'post' });
  assert.equal(t.status, 'ok');
  near(t.transferLimitMW, (257 - 169.7) / 0.442, 1e-9);
  near(t.transferLimitPfMW, (257 * 0.95 - 169.7) / 0.442, 1e-9);
  assert.ok(Math.round(t.transferLimitPfMW) === 168);
  assert.equal(t.ratingBasis, 'LTE (STE limited)');
  assert.equal(t.bound, true);
  assert.equal(t.cite.find(c => /pf_min/.test(c.path)).status, 'assumption');
  assert.equal(E.thermalScreen({ p: 100, dfax: 0.1, rating: 200, contingency: 'base' }).ratingBasis, 'Normal');
});

test('MVA screen with Q held uses apparent power; overload recorded at ≥ 2% above rating; DFAX > 3% participates; unknown inputs not held', () => {
  const t = E.thermalScreen({ p: 120, q: 50, dfax: 0.2, mw: 100, rating: 140, contingency: 'post' });
  near(t.loading, Math.hypot(140, 50) / 140);
  assert.equal(t.bound, false);
  assert.equal(t.overload, true); assert.equal(t.recorded, true); assert.equal(t.participates, true);
  const r = E.thermalScreen({ p: 100, dfax: 0.03, mw: 10, rating: 120, contingency: 'post' });
  assert.equal(r.participates, false);
  const edge = E.thermalScreen({ p: 102, dfax: 0.05, mw: 0, rating: 100, q: 0, contingency: 'post' });
  assert.equal(edge.recorded, true);
  assert.equal(E.thermalScreen({ p: 101.9, dfax: 0.05, mw: 0, rating: 100, q: 0, contingency: 'post' }).recorded, false);
  const m = E.thermalScreen({ p: null, dfax: 0.2, rating: 100 });
  assert.equal(m.status, 'missing'); assert.equal(m.loading, null);
});

// ---------- citations for the Inspector Evidence tab ----------
test('citations(): every interconnection rule with src + status + effective date; the profile entry first', () => {
  const c = E.citations();
  assert.ok(c.length >= 25, `${c.length}`);
  assert.equal(c[0].path, 'interconnection.schedule22.profile');
  for (const r of c) { assert.ok(r.src, r.path); assert.ok(r.status, r.path); assert.ok(r.effective, `${r.path} effective`); assert.ok(r.label, r.path); }
  assert.ok(c.some(r => r.path === 'interconnection.schedule22.study_deposit' && r.text === 'Sched 22 §3.4.1.1 · corrected'));
  const p = E.citations('proforma');
  assert.equal(p[0].path, 'interconnection.proforma.profile');
  assert.ok(p.every(r => !r.path.includes('schedule22') || /withdrawal_penalty/.test(r.path)), 'pro forma cites only the shared withdrawal rule (adopted unchanged) from Sched 22');
});

test('every rule entry in rules/isone-2026/interconnection.json carries an effective date', () => {
  const src = JSON.parse(readFileSync(new URL('../rules/isone-2026/interconnection.json', import.meta.url), 'utf8'));
  const miss = [];
  const walk = (o, p) => { for (const [k, v] of Object.entries(o)) { if (k.startsWith('_') || !v || typeof v !== 'object' || Array.isArray(v)) continue; if ('status' in v) { if (!v.effective) miss.push(`${p}.${k}`); } else walk(v, `${p}.${k}`); } };
  walk(src, '');
  assert.deepEqual(miss, []);
});

test('rules not loaded: every result is not held with a reason, never a number', () => {
  E.setRules(null);
  try {
    const c = E.entryCost({ mw: 100 });
    assert.equal(c.status, 'missing'); assert.equal(c.value, null); assert.match(c.reason, /rules/i);
    assert.equal(E.schedule({ windowClose: '2026-11-19' }).status, 'missing');
    assert.equal(E.siteControlGate({ pct: 100 }).verdict, 'Open');
    assert.deepEqual(E.citations(), []);
  } finally { E.setRules(RAW); }
});
