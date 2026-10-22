// W-C integration (Decision + Queue side): the Tax credit gate in the Decision gate list (S5 #4), the site-control
// evidence row read from rules/isone.js siteControlGate (S3 #4), the queue's COD date for finance (S5 open item),
// the pending badge replacing the hand-typed large-load date (S2-GD #7) and the DC stage cards (S6 #2).
// Provenance: Claude Fable 5.1 (W-C integration agent) · one-studio/design (T3, P2 wave W-C) · 2026-10-07 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { optionMetrics, gates, openItems } from '../decisioncore.js';
import { candidateGates, candidateTally, siteControlEvidence } from '../views/decision.js';
import { cashApplies, codDate, queueInputs } from '../queuecore.js';
import { pendingBadge } from '../rules/largeload.js';
import * as RX from '../rules/isone.js';

const rd = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const D = { ...rd('snapshot.json'), queue: rd('queue.json'), land: rd('land.json'), flags: rd('flags.json') };
const RULES = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const basis = { mode: 'historical', market: 'RT', years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false };
const P = { tech: 'solar', exportMW: 100, importMW: 0, basis, cf: 0.15, lossPct: 3 };
const node = id => D.nodes.find(n => String(n.id) === String(id));
const S = (id, o = {}) => ({ nodeId: id, tech: 'solar', exportMW: 100, importMW: 0, basis: { ...basis, nodeId: id }, handoffs: {}, ui: {}, caseKey: 'sp', hz: 2030, pins: [], walk: null, ...o });

// ---------- S5 #4: Tax credit gate ----------
test('S5 #4: gates() adds "Tax credit (45Y/48E)" only when a tax context is passed; unknown inputs are Hold, never Pass', () => {
  const m = optionMetrics(D, node('111403'), P);
  const plain = gates(m, P);
  assert.ok(!plain.some(g => g.gate === 'Tax credit (45Y/48E)'), 'no tax context: the gate list is unchanged (older callers)');
  const withTax = gates(m, { ...P, tax: { fin: {}, tax: {}, queueCod: null, rules: RULES } });
  const g = withTax.find(x => x.gate === 'Tax credit (45Y/48E)');
  assert.ok(g, 'the tax gate is present');
  assert.equal(g.verdict, 'Hold');
  assert.match(g.why, /Not decided: an input is not held/);
  assert.equal(withTax.length, plain.length + 1);
  // the gate sits last and the open item names where to go
  assert.equal(withTax.at(-1).gate, 'Tax credit (45Y/48E)');
  const it = openItems([m], [withTax]).find(i => i.gate === 'Tax credit (45Y/48E)');
  assert.equal(it.where, 'Economics › Project finance');
  assert.match(it.what, /BOC|placed-in-service|PIS/i);
});

test('S5 #4: F-W2 through the gate list: solar, no BOC, Queue COD after 2027-12-31 → Fail; storage → not Fail', () => {
  const m = optionMetrics(D, node('111403'), P);
  const fail = gates(m, { ...P, tax: { fin: {}, tax: {}, queueCod: '2029-12-31', rules: RULES } }).find(x => x.gate === 'Tax credit (45Y/48E)');
  assert.equal(fail.verdict, 'Fail');
  assert.match(fail.why, /Not eligible for 45Y\/48E \(OBBBA\)/);
  const ms = optionMetrics(D, node('111403'), { ...P, tech: 'storage', importMW: 100 });
  const st = gates(ms, { ...P, tech: 'storage', tax: { fin: {}, tax: {}, queueCod: '2029-12-31', rules: RULES } }).find(x => x.gate === 'Tax credit (45Y/48E)');
  assert.notEqual(st.verdict, 'Fail');
  // rules not loaded: Hold with the reason, never Pass
  const nr = gates(m, { ...P, tax: { fin: {}, tax: {}, queueCod: null, rules: null } }).find(x => x.gate === 'Tax credit (45Y/48E)');
  assert.equal(nr.verdict, 'Hold'); assert.match(nr.why, /rules file not loaded/);
});

test('S5 #4 / S6 #7: a data centre has no tax-credit gate (generator-only); candidateGates carries the tax gate for generators', () => {
  const dc = candidateGates(D, S('111403', { tech: 'datacenter', exportMW: 0, importMW: 150 }));
  assert.ok(!dc.some(g => g.gate === 'Tax credit (45Y/48E)'));
  const gen = candidateGates(D, S('111403'));
  assert.ok(gen.some(g => g.gate === 'Tax credit (45Y/48E)'));
  assert.equal(gen.find(g => g.gate === 'Tax credit (45Y/48E)').verdict, 'Hold', 'no COD, no BOC: Open');
  // a Queue COD year flows in: 2029 → Fail for solar
  const cod = candidateGates(D, S('111403', { ui: { qCod: 2029 } })).find(g => g.gate === 'Tax credit (45Y/48E)');
  assert.equal(cod.verdict, 'Fail');
  const t = candidateTally(D, S('111403'));
  assert.equal(t.total, gen.length);
  assert.match(t.label, /^\d+ Fail · \d+ Open · \d+ Pass \(of \d+\)( · as of this stage)?$/, 'all three counts, Fail first (in Node the fleet shape never loads, so the tally may say "as of this stage")');
});

// ---------- S3 #4: site-control evidence row from the engine ----------
test('S3 #4: the Decision site-control row reads siteControlGate: 100% required (ISO-NE), Pass→Current, Fail→Incomplete, Open→Missing', () => {
  const open = siteControlEvidence(S('111403'));
  assert.equal(open.name, 'Site control at request (100%)');
  assert.equal(open.status, 'Missing');
  assert.equal(open.where, 'Land › Permits & site control');
  const fail = siteControlEvidence(S('111403', { ui: { land: { control: 95 } } }));
  assert.equal(fail.status, 'Incomplete'); assert.match(fail.why, /ISO-NE requires 100%/);
  const pass = siteControlEvidence(S('111403', { ui: { land: { control: 100 } } }));
  assert.equal(pass.status, 'Current');
  // the pro forma profile: 90% at request, labelled by the engine
  const pf = siteControlEvidence(S('111403', { ui: { land: { control: 95 }, qProfile: 'proforma' } }));
  assert.equal(pf.name, 'Site control at request (90%)'); assert.equal(pf.status, 'Current');
  // the same engine call the Queue page makes (one home): same verdict for the same inputs
  const q = queueInputs(S('111403', { ui: { land: { control: 95 } } }));
  assert.equal(RX.siteControlGate({ pct: q.sitePct, service: q.service, regulatoryLimitation: q.regulatoryLimitation, tech: q.tech, profile: q.profile }).verdict, 'Fail');
  // a data centre has no site-control row (generator rule)
  assert.equal(siteControlEvidence(S('111403', { tech: 'datacenter', exportMW: 0, importMW: 150 })), null);
});

// ---------- S5 open item: the queue's COD date for finance ----------
test('S5 open item: codDate(S) = the Queue target COD year as 31 Dec, with the S3 deadline chain end as context; no year → not held', () => {
  const none = codDate(S('111403'));
  assert.equal(none.value, null); assert.match(none.reason, /no target COD year/i);
  assert.ok(none.pathEnd && /^\d{4}-\d{2}-\d{2}$/.test(none.pathEnd.date), 'the S3 schedule end is still reported as context');
  const c = codDate(S('111403', { ui: { qCod: 2029 } }));
  assert.equal(c.value, '2029-12-31'); assert.equal(c.basis, 'Queue target COD year 2029, taken as 31 Dec');
  assert.equal(c.conflict, false);
  const early = codDate(S('111403', { ui: { qCod: 2026 } }));
  assert.equal(early.value, '2026-12-31'); assert.equal(early.conflict, true, 'a COD before the end of the tariff deadline chain is flagged');
  assert.match(early.why, /before the .*deadline/i);
  assert.equal(codDate(S('111403', { ui: { qCod: 'abc' } })).value, null);
});

// ---------- S2-GD #7: no hand-typed large-load date ----------
test('S2-GD #7: cashApplies(datacenter) carries the rules-file badge, not a typed "16 Nov 2026"', () => {
  const ca = cashApplies('datacenter');
  assert.equal(ca.applies, false);
  assert.ok(!/16 Nov 2026/.test(ca.why));
  assert.ok(ca.why.includes(pendingBadge(RULES).text), ca.why);
  assert.equal(ca.badge, pendingBadge(RULES).text);
});
