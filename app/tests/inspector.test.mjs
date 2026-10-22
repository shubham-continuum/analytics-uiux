// M4 Inspector: the pure model behind each tab (Bus · Card · Evidence · Notes · Export), from fixtures.
// Provenance: Claude Opus 5.5 (M4 build agent) · one-studio/design (T3, slice M4) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidateGates, candidateTally } from '../views/decision.js';
import { verdictLine } from '../v2copy.js';
import { CITED_PATHS } from '../rules/revenue.js';
import { citations as finCitations } from '../rules/finance.js';
import { cardKeys } from '../ui.js';
import {
  INSP_TABS, gateLine, busModel, RULE_USE, ruleAt, rulesFor, costToEnter, evidenceModel, cardModel,
  NOTES_KEY, NOTES_V, notesKey, readNotes, writeNotes, addNote, removeNote, notesHtml,
  exportRequest, exportErrorText, SITING_KEYS, STUDIO_VIEW_KEYS, SCED_KEYS, filenameFrom, parseMoney, planRequest, planView,
} from '../views/inspector.js';
import { chipList } from '../ui.js';
import * as RX from '../rules/isone.js';

const rd = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const RULES = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const D = { ...rd('snapshot.json'), queue: rd('queue.json'), land: rd('land.json'), flags: rd('flags.json') };
D.index = D.nodes.filter(n => n.id !== 'hub').map(n => ({ id: String(n.id), name: n.name, substation: n.substation || 'Sub', kv: n.kv ?? 115, zone: n.zone || 'SEMA', pnode: n.pnode || 'LD.X', tier: 'direct', proxyKm: null }));
const basisFor = id => ({ nodeId: id, mode: 'historical', market: 'RT', years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false });
const stateFor = (id, o = {}) => ({ nodeId: id, tech: 'solar', exportMW: 100, importMW: 0, basis: basisFor(id), handoffs: {}, ui: {}, caseKey: 'sp', hz: 2030, pins: [], walk: null, decisions: [], ...o });
const counts = g => { const pass = g.filter(x => x.verdict === 'Pass').length, fail = g.filter(x => x.verdict === 'Fail').length; return { pass, fail, hold: g.length - pass - fail }; };

test('five tabs in the brief\'s order', () => {
  assert.deepEqual(INSP_TABS.map(t => t.id), ['bus', 'card', 'evidence', 'notes', 'export']);
});

test('card selection keys (ui.js): the title, #n on a repeat, whitespace folded', () => {
  assert.deepEqual(cardKeys(['Entry cash  by size', 'Deposit tiers', 'Entry cash by size', '', null]), ['Entry cash by size', 'Deposit tiers', 'Entry cash by size#1', 'Card', 'Card#1']);
});

test('Bus gate line == candidateTally(D, S).label — the band\'s and Decision\'s exact words (3 buses; S2-GD #5)', () => {
  for (const id of ['111209', '111403', '100178']) {
    const S = stateFor(id), g = candidateGates(D, S), t = candidateTally(D, S);
    const gl = gateLine(g, t);
    assert.equal(gl.text, t.label, id);
    // in Node the ISO-NE fleet shape never loads, so the tally may carry " · as of this stage"; the counts are verdictLine's
    assert.equal(gl.text.replace(/ · as of this stage$/, ''), verdictLine(counts(g)), `${id}: the tally is verdictLine over the same gates`);
    assert.equal(gl.tone, t.tone);
    assert.equal(gl.total, g.length);
    assert.equal(gl.lines.length, g.length);
  }
  // 7 gates since the S5 tax gate joined (Open: no COD or construction start held); no tally passed → plain verdictLine
  assert.equal(gateLine(candidateGates(D, stateFor('100178'))).text, '1 Fail · 6 Open · 0 Pass (of 7)');
  // inputs still loading on a stage: the tally says so and the inspector prints the same words (never a different verdict)
  const noLand = { ...D, land: null };
  const S = stateFor('111403'), t = candidateTally(noLand, S);
  assert.match(t.label, /as of this stage$/);
  assert.equal(gateLine(candidateGates(noLand, S), t).text, t.label);
  assert.equal(gateLine(candidateGates(noLand, S), t).title, t.title);
  assert.equal(gateLine(null), null);
  assert.equal(gateLine(null, t), null, 'no gates: no line, whatever the tally says');
});

test('Bus model: identity, title = bus name, gate line, pin / option state, D-008 suspect note', () => {
  const S = stateFor('111403', { pins: ['111403'] });
  const m = busModel({ S, D, id: '111403', gates: candidateGates(D, S), meta: { coverage: { suspect_pnode_links: { buses: [111403], threshold_mi: 12.3 } } }, project: null });
  assert.equal(m.title, 'Mashpee');
  assert.equal(m.id, '111403');
  assert.equal(m.gate.text, verdictLine(counts(candidateGates(D, S))));
  assert.equal(m.pinned, true);
  assert.equal(m.current, true);
  assert.match(m.suspect, /relinked|suspect/i);
  assert.ok(m.rows.some(([k]) => k === 'Price node'));
  // not a suspect bus: no note; a bus other than the current one: gates are not claimed
  const o = busModel({ S, D, id: '111209', gates: null, meta: { coverage: { suspect_pnode_links: { buses: [1] } } }, project: null });
  assert.equal(o.suspect, null);
  assert.equal(o.current, false);
  assert.equal(o.gate, null);
  assert.match(o.gateWhy, /current bus/i);
});

test('Bus model: with a sample project, an option bus offers "set as option"; a non-option bus does not', () => {
  const project = { id: 'p', name: 'Cape Solar', options: [{ id: 'o1', label: 'Option A', busId: '111403' }, { id: 'o2', label: 'Option B', busId: '111209' }] };
  const S = stateFor('111403', { walk: { project: 'p', option: 'o1', step: 0 } });
  const b = busModel({ S, D, id: '111209', gates: null, meta: null, project });
  assert.deepEqual(b.setOption, { act: 'sel-opt', v: 'o2', label: 'Set as option (Option B)' });
  const c = busModel({ S, D, id: '100178', gates: null, meta: null, project });
  assert.equal(c.setOption.act, null);
  assert.match(c.setOption.why, /not an option/i);
  const cur = busModel({ S, D, id: '111403', gates: null, meta: null, project });
  assert.equal(cur.setOption.act, null);
  assert.match(cur.setOption.why, /already the selected option/i);
});

test('every rule the Inspector cites resolves in rules/isone-2026.json with src and status', () => {
  for (const [k, paths] of Object.entries(RULE_USE)) for (const p of paths) {
    const r = ruleAt(RULES, p);
    assert.ok(r, `${k}: ${p} not in the rules file`);
    assert.ok(r.status, `${k}: ${p} lacks a status`);
    // the one source-less entry is the pending large-load block itself (rules-isone.test.mjs exempts it too)
    if (p !== 'large_load') assert.ok(r.src, `${k}: ${p} lacks a source`);
  }
  const ll = rulesFor('decision', 'compare', RULES, { tech: 'datacenter' })[0];
  assert.equal(ll.src, RULES.large_load.src || 'not held', 'the file\'s own source, or "not held" when it has none'); assert.equal(ll.badge, 'pending');
});

test('Evidence lists the rules the stage\'s cards reference first, then every other rule the engine uses; src + status on each; badges', () => {
  const rows = rulesFor('queue', 'cash', RULES, { mw: 150, tech: 'solar' });
  const paths = rows.filter(r => r.path).map(r => r.path);
  assert.deepEqual(paths.slice(0, RULE_USE['queue/cash'].length), RULE_USE['queue/cash'], 'the tab\'s own rules lead');
  // S3 #1: the rest of the interconnection rules the profile uses (RX.citations), de-duplicated, profile row first among them
  const extra = paths.slice(RULE_USE['queue/cash'].length);
  const cites = RX.citations('isone').map(c => c.path);
  assert.ok(extra.length > 0 && extra.every(p => cites.includes(p)), 'extras come from rules/isone.js citations');
  assert.equal(new Set(paths).size, paths.length, 'no path twice');
  assert.ok(paths.includes('interconnection.schedule22.withdrawal_penalty_exemptions') && paths.includes('interconnection.schedule22.readiness_floor'));
  assert.ok(!paths.includes('interconnection.proforma.initial_deposit'), 'the ISO-NE profile does not cite the pro forma');
  const pf = rulesFor('queue', 'cash', RULES, { mw: 150, tech: 'solar', profile: 'proforma' }).map(r => r.path);
  assert.ok(pf.includes('interconnection.proforma.profile'), 'the pro forma profile cites its own block');
  for (const r of rows) { assert.ok(r.src, r.label); assert.ok(r.status, r.label); }
  assert.deepEqual(rulesFor('market', 'find', RULES, { mw: 100, tech: 'solar' }), []);
  const econ = rulesFor('economics', 'finance', RULES, { mw: 100, tech: 'solar' });
  const contingent = econ.find(r => r.status === 'contingent');
  assert.ok(contingent && contingent.badge === 'contingent', 'a contingent rule is badged');
  const dc = rulesFor('queue', 'cash', RULES, { mw: 250, tech: 'datacenter' });
  assert.ok(dc.some(r => r.path === 'large_load' && r.badge === 'pending'));
  assert.ok(!dc.some(r => /^interconnection\.schedule22\./.test(r.path)), 'a data centre cites no generator deposit rule');
});

test('S4 #3 / S5 #6: Economics cites every revenue rule (CITED_PATHS) and every finance/tax rule (finance citations), once each', () => {
  for (const p of CITED_PATHS) assert.ok(RULE_USE.economics.includes(p), `RULE_USE.economics lacks ${p}`);
  assert.equal(new Set(RULE_USE.economics).size, RULE_USE.economics.length, 'de-duplicated');
  const econ = rulesFor('economics', 'finance', RULES, { mw: 100, tech: 'solar' }), paths = econ.map(r => r.path);
  for (const c of finCitations(RULES)) assert.ok(paths.includes(c.key), `finance citation ${c.key} missing`);
  for (const p of CITED_PATHS) assert.ok(paths.includes(p), `revenue citation ${p} missing`);
  assert.equal(new Set(paths).size, paths.length);
  for (const r of econ) { assert.ok(r.src, `${r.path} src`); assert.ok(r.status, `${r.path} status`); }
  assert.ok(econ.some(r => r.path === 'defaults_atb2025.atb_finance' || /^defaults_atb2025\./.test(r.path)), 'the ATB finance defaults are cited');
});

test('Queue › Cost to enter at 150 MW: $800k total, $300k cash · Sched 22 §3.4.1.1 · corrected (from the rules file)', () => {
  const c = costToEnter(RULES, 150);
  assert.equal(c.total, 800000); assert.equal(c.cash, 300000);
  assert.equal(c.text, '$800k total, $300k cash · Sched 22 §3.4.1.1 · corrected');
  const row = rulesFor('queue', 'cash', RULES, { mw: 150, tech: 'solar' }).find(r => r.derived);
  assert.equal(row.label, 'Cost to enter at 150 MW');
  assert.equal(row.value, '$800k total, $300k cash');
  assert.equal(row.src, 'Sched 22 §3.4.1.1'); assert.equal(row.status, 'corrected');
  // one home: S3's engine (rules/isone.js entryCost); small generators fall under Schedule 23
  for (const mw of [15, 150]) {
    const e = RX.entryCost({ mw }), c = costToEnter(RULES, mw);
    assert.deepEqual([c.total, c.cash, c.value, c.src, c.status], [e.total, e.cash, e.text, e.cite.src, e.cite.status], `${mw} MW`);
  }
  assert.equal(costToEnter(RULES, 15).cash, 115000);
  assert.equal(costToEnter(null, 150), null, 'rules not loaded: no figure');
  assert.equal(costToEnter(RULES, 0), null, 'no size: no figure, never $0');
});

test('Evidence model: basis, PCR run, sign convention, DB mtime, mapgrid generation, rules version', () => {
  const S = stateFor('111403');
  const e = evidenceModel({ S, D, rules: RULES, health: { db: 'C:/x/ISONE_GridSense_unified.duckdb', db_mtime: '2026-10-05T10:00:00+00:00' }, meta: { generation: 'g-abc' }, stage: 'queue', tab: 'cash' });
  const get = k => e.basis.find(r => r[0] === k)?.[1];
  assert.match(get('Price basis'), /2025/);
  assert.equal(get('History year'), '2025');
  assert.equal(get('PCR run (horizon 2030)'), 'pcr2030');
  assert.equal(get('Sign convention'), 'ISO-NE: LMP = E + C + L');
  assert.ok(e.sources.some(r => r[0] === 'DB modified' && r[1] === '2026-10-05T10:00:00+00:00'));
  assert.ok(e.sources.some(r => r[0] === 'Map/grid generation' && r[1] === 'g-abc'));
  assert.ok(e.sources.some(r => r[0] === 'Rules version' && r[1] === RULES.version));
  assert.ok(e.sources.some(r => r[0] === 'Unified DB tables' && /fact_headroom/.test(r[1])));
  // not loaded: said, never blank or zero
  const n = evidenceModel({ S, D, rules: null, health: null, meta: null, stage: 'queue', tab: 'cash' });
  assert.equal(n.sources.find(r => r[0] === 'DB modified')[1], 'not held');
  assert.equal(n.sources.find(r => r[0] === 'Map/grid generation')[1], 'not held');
  assert.equal(n.rulesState, 'loading');
});

test('Card model: the card\'s own numbers verbatim; empty state "Select a card"', () => {
  assert.equal(cardModel(null).empty, 'Select a card');
  const m = cardModel({ title: 'Entry cash by project size', sub: 'fee + deposit', answer: 'At 150 MW the cash out at request is $455,000.', stage: 'Queue', tab: 'Cash & commitments',
    kpis: [{ label: 'Cash out at request', value: '$455,000', unit: '' }, { label: 'Export limit', value: 'not held', unit: 'MW' }], traceId: 'q-deposit', traceHtml: '<details class="trace"></details>', checks: { pass: 2, fail: 0, unknown: 1 } });
  assert.equal(m.title, 'Entry cash by project size');
  assert.equal(m.where, 'Queue › Cash & commitments');
  assert.deepEqual(m.kpis.map(k => k.value), ['$455,000', 'not held']);
  assert.equal(m.kpis[1].unit, '', 'no unit on a value not held');
  assert.equal(m.checkLine, '2 reconcile · 1 cannot be checked (value not held)');
  assert.equal(cardModel({ title: 'x', kpis: [] }).traceWhy, 'No calculation trace on this card.');
  const t = cardModel({ title: 'x', tables: [{ head: ['Size', 'Deposit'], rows: [['150 MW', '$150,000']], more: 3 }, { head: [], rows: [] }] });
  assert.deepEqual(t.tables, [{ head: ['Size', 'Deposit'], rows: [['150 MW', '$150,000']], more: 3 }], 'tables verbatim; empty tables dropped');
});

test('money figures read back for the card-vs-rule check', () => {
  assert.equal(parseMoney('$455k'), 455000); assert.equal(parseMoney('≥ $1.2M'), 1200000); assert.equal(parseMoney('$455,000'), 455000);
  assert.equal(parseMoney('not held'), null); assert.equal(parseMoney(''), null);
});

function fakeStorage(init = {}) { const m = new Map(Object.entries(init)); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; }

test('Notes: schema v1 round-trip, keyed project|bus, plain text escaped on render, failed storage reported', () => {
  assert.equal(NOTES_KEY, 'gsone.notes.v1'); assert.equal(NOTES_V, 1);
  assert.equal(notesKey(null, '111403'), '-|111403');
  assert.equal(notesKey('cape', '111403'), 'cape|111403');
  const st = fakeStorage();
  let s = readNotes(st);
  assert.deepEqual(s, { v: 1, notes: {} });
  s = addNote(s, 'cape|111403', '  <script>alert(1)</script> & "quoted"  ', '2026-10-06T10:00:00Z');
  assert.equal(writeNotes(st, s), true);
  const back = readNotes(st);
  assert.deepEqual(back, { v: 1, notes: { 'cape|111403': [{ t: '2026-10-06T10:00:00Z', text: '<script>alert(1)</script> & "quoted"' }] } });
  const html = notesHtml(back.notes['cape|111403']);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;quoted&quot;/);
  assert.deepEqual(removeNote(back, 'cape|111403', 0).notes, {});
  assert.equal(addNote(back, 'k', '   ', 't'), back, 'an empty note is not added');
  // another schema version or corrupt JSON: read as empty with the reason, never thrown
  assert.deepEqual(readNotes(fakeStorage({ 'gsone.notes.v1': '{"v":2,"notes":{"a":[]}}' })), { v: 1, notes: {}, skipped: 'schema v2 is not v1' });
  assert.deepEqual(readNotes(fakeStorage({ 'gsone.notes.v1': '{oops' })), { v: 1, notes: {}, skipped: 'unreadable' });
  assert.deepEqual(readNotes({ getItem() { throw new Error('denied'); } }), { v: 1, notes: {}, skipped: 'storage unavailable' });
  assert.equal(writeNotes({ setItem() { throw new Error('quota'); } }, s), false);
  // malformed entries are dropped on read
  assert.deepEqual(readNotes(fakeStorage({ 'gsone.notes.v1': JSON.stringify({ v: 1, notes: { a: [{ t: 1, text: 'ok' }, 'bad', { text: 5 }] } }) })).notes, { a: [{ t: '1', text: 'ok' }] });
});

const CTX = (o = {}) => ({ S: stateFor('111403', { hz: 2030 }), project: null, busName: 'Mashpee', rules: RULES, health: { db: 'C:/x/u.duckdb', db_mtime: '2026-10-05T10:00:00+00:00' }, meta: { generation: 'g-abc' }, notes: [{ t: 'a', text: 'n1' }], ...o });

test('Export: siting-workbook payload maps onto the real :5034 scope; the export contract rides in oneStudio', () => {
  const r = exportRequest('siting', CTX());
  assert.equal(r.url, './api/proxy/export/siting-workbook');
  for (const k of Object.keys(r.body)) assert.ok(SITING_KEYS.includes(k) || k === 'oneStudio', `unknown top-level key ${k}`);
  for (const k of Object.keys(r.body.studio)) assert.ok(STUDIO_VIEW_KEYS.includes(k), `unknown studio key ${k}`);
  assert.equal(r.body.bus_id, 111403); assert.equal(r.body.asset, 'solar'); assert.equal(r.body.mw, 100);
  assert.ok(r.body.project_name.length >= 1 && r.body.project_name.length <= 120);
  assert.deepEqual(r.body.studio, { case: 'sp', horizon: 2030, hist_year: 2025 });
  assert.deepEqual(r.body.oneStudio.selection, { project: null, option: null, bus: '111403', case: 'sp', hz: 2030, hist: 2025, fuel: 'solar', size: 100 });
  assert.equal(r.body.oneStudio.generation, 'g-abc');
  assert.equal(r.body.oneStudio.rulesVersion, RULES.version);
  assert.equal(r.body.oneStudio.pcrRun, 'pcr2030');
  assert.deepEqual(r.body.oneStudio.db, { path: 'C:/x/u.duckdb', mtime: '2026-10-05T10:00:00+00:00' });
  assert.deepEqual(r.body.oneStudio.notes, [{ t: 'a', text: 'n1' }]);
  assert.equal(r.block, null);
  // not loaded: null, never invented
  const n = exportRequest('siting', CTX({ health: null, meta: null, rules: null }));
  assert.equal(n.body.oneStudio.generation, null); assert.equal(n.body.oneStudio.rulesVersion, null); assert.deepEqual(n.body.oneStudio.db, { path: null, mtime: null });
});

test('Export: a sample project exports its option\'s bus and names; a data centre exports its import MW', () => {
  const project = { id: 'cape', name: 'Cape Solar', options: [{ id: 'o1', label: 'Option A', busId: '111209' }] };
  const r = exportRequest('siting', CTX({ project, S: stateFor('111403', { walk: { project: 'cape', option: 'o1' } }) }));
  assert.equal(r.body.bus_id, 111209); assert.equal(r.body.project_name, 'Cape Solar'); assert.equal(r.body.option_name, 'Option A');
  assert.equal(r.body.oneStudio.selection.option, 'o1'); assert.equal(r.body.oneStudio.selection.project, 'cape');
  const dc = exportRequest('siting', CTX({ S: stateFor('111403', { tech: 'datacenter', exportMW: 0, importMW: 250 }) }));
  assert.equal(dc.body.asset, 'data center'); assert.equal(dc.body.mw, 250);
  const zero = exportRequest('sced', CTX({ S: stateFor('111403', { exportMW: 0 }) }));
  assert.match(zero.block, /size/i);
});

test('Export: SCED node payload carries only the fields :5034 accepts (it rejects unknown keys)', () => {
  const r = exportRequest('sced', CTX({ S: stateFor('111403', { tech: 'storage', exportMW: 100, importMW: 100 }) }));
  assert.equal(r.url, './api/proxy/export/sced-node');
  for (const k of Object.keys(r.body)) assert.ok(SCED_KEYS.includes(k), `unknown key ${k}`);
  assert.deepEqual(r.body, { bus_id: 111403, asset: 'bess', mw: 100, settled_year: 2025, runs: ['pcr2030'] });
  // 2026 is part-year (outside 2020–2025) and 2045 has no run here: both omitted, not invented
  const s = exportRequest('sced', CTX({ S: stateFor('111403', { hz: 2045, basis: { ...basisFor('111403'), years: [2026] } }) }));
  assert.deepEqual(s.body, { bus_id: 111403, asset: 'solar', mw: 100 });
});

test('Siting export plan: the same body POSTed to the read-only /plan route; its answer read as words', () => {
  const r = exportRequest('siting', CTX()), p = planRequest(r);
  assert.equal(p.url, './api/proxy/export/siting-workbook/plan');
  assert.equal(p.body, r.body, 'the very same body the export sends');
  assert.equal(planRequest(exportRequest('sced', CTX())), null, 'the SCED export has no plan step (it writes nothing)');
  const adds = planView({ exists: false, option_id: null, adds: { project: { name: 'One Studio screening', new: true }, location: { name: 'Mashpee area', new: true }, option: { name: 'Mashpee 115.0 kV', bus_id: 111403, requested_mw: 150 } },
    message: 'Adds this option to your Canvas portfolio: project “One Studio screening”, location “Mashpee area”, option “Mashpee 115.0 kV” (150 MW at bus 111403).' });
  assert.equal(adds.writes, true);
  assert.match(adds.headline, /adds a new option to the Canvas portfolio on :5034/);
  assert.deepEqual(adds.items, ['New project: One Studio screening', 'New location: Mashpee area', 'New option: Mashpee 115.0 kV (150 MW at bus 111403)']);
  assert.match(adds.message, /^Adds this option/);
  const uses = planView({ exists: true, option_id: 7, adds: null, message: 'Uses option 7 already in your Canvas portfolio (P · O); nothing is added.' });
  assert.equal(uses.writes, false); assert.match(uses.headline, /reuses option 7/); assert.deepEqual(uses.items, []);
  const odd = planView(null);
  assert.equal(odd.writes, null); assert.match(odd.headline, /did not say/);
});

test('Large-load rules (S6): grid, queue and economics cite the proposal entries for a data centre, each pending/badged', () => {
  const paths = (st, tab) => rulesFor(st, tab, RULES, { mw: 300, tech: 'datacenter' }).map(r => r.path);
  assert.deepEqual(paths('grid', 'capacity'), ['large_load.threshold_mw', 'large_load.threshold_kv', 'large_load.services']);
  for (const p of ['large_load.study_days', 'large_load.services', 'large_load.filing']) assert.ok(paths('queue', 'cash').includes(p), `queue: ${p}`);
  for (const p of ['large_load.cra', 'large_load.capacity', 'large_load.local_adders']) assert.ok(paths('economics', 'finance').includes(p), `economics: ${p}`);
  const rows = ['grid', 'queue', 'economics'].flatMap(s => rulesFor(s, 'x', RULES, { mw: 300, tech: 'datacenter' }));
  for (const r of rows.filter(x => /^large_load\./.test(x.path) && !/rns_rate|schedule1_rate/.test(x.path))) {
    assert.ok(r.badge, `${r.path} badged`);
    assert.ok(r.value && (r.value !== 'not held' || r.path === 'large_load.local_adders'), `${r.path}: value "${r.value}"`);
  }
  const by = Object.fromEntries(rows.map(r => [r.path, r.value]));
  assert.equal(by['large_load.threshold_mw'], '≥ 50 MW');
  assert.equal(by['large_load.services'], 'FCDS Firm Contract Demand Service · NFCDS Non-Firm Contract Demand Service · ICDS Interim Contract Demand Service');
  assert.equal(by['large_load.filing'], RULES.large_load.filing.badge);
  assert.equal(by['large_load.local_adders'], 'not held');
  // a generator's grid tab still cites the generator rules
  assert.ok(paths('grid', 'capacity').length && !rulesFor('grid', 'capacity', RULES, { mw: 100, tech: 'solar' }).some(r => /^large_load/.test(r.path)));
});

test('the "pending" provenance chip (S6 lead wiring item 1)', () => {
  assert.deepEqual(chipList('pending assumption'), [{ key: 'pending', tone: 'warn', label: 'pending §205 filing' }, { key: 'assumption', tone: 'warn', label: 'assumption' }]);
});

test('Export errors: 502 / 413 / 415 / 400 read as toasts; filename from Content-Disposition', () => {
  assert.equal(exportErrorText(502, { error: 'export service not running' }), 'Export service not running (:5034)');
  assert.equal(exportErrorText(413, { error: 'request too large', max_bytes: 1048576 }), 'Export request too large (limit 1,048,576 bytes)');
  assert.equal(exportErrorText(415, { error: 'JSON only' }), 'Export refused: JSON only');
  assert.equal(exportErrorText(400, { error: 'bus 1 is not in the corrected study universe' }), 'Export refused: bus 1 is not in the corrected study universe');
  assert.equal(exportErrorText(500, null), 'Export failed (HTTP 500)');
  assert.equal(filenameFrom('attachment; filename=2026-10-06_GridSense-X-111403-v1.xlsx', 'f.xlsx'), '2026-10-06_GridSense-X-111403-v1.xlsx');
  assert.equal(filenameFrom('attachment; filename="a b.xlsx"', 'f.xlsx'), 'a b.xlsx');
  assert.equal(filenameFrom("attachment; filename*=UTF-8''a%20c.xlsx", 'f.xlsx'), 'a c.xlsx');
  assert.equal(filenameFrom(null, 'f.xlsx'), 'f.xlsx');
  assert.equal(filenameFrom('attachment; filename="../../evil.xlsx"', 'f.xlsx'), 'evil.xlsx');
});
