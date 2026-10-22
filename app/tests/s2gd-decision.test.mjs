// Provenance: Claude Opus 5.5 · one-studio P2 slice S2-GD (Grid + Decision correctness blockers) · 2026-10-06 · v1
// Decision side of S2-GD: one gate engine and one gate wording for the strip, band, inspector and Decision (F001 / D3),
// the capture threshold left unset until it is agreed (F003), memo figures carried with their qualifiers (F006),
// envelope-only Connect is Hold (F009) and unstudied cases are named (F010), signed congestion labelled (D9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { optionMetrics, gates, gateTally, gateLines, gateInputsPending, memoQualifiers, openItems, thresholdsFor, fuelVerdict, capturePassCount,
  positionTable } from '../decisioncore.js';
import { thresholdRows } from '../decisionpack.js';

const rd = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const data = { ...rd('snapshot.json'), queue: rd('queue.json'), land: rd('land.json'), flags: rd('flags.json') };
const basis = { mode: 'historical', market: 'RT', years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false };
const P = { tech: 'solar', exportMW: 100, importMW: 0, basis, cf: 0.15, lossPct: 3 };
const node = id => data.nodes.find(n => n.id === id);
const opt = (id, p = P, d = data) => optionMetrics(d, node(id), p);
const HATCH = '111209';

// ---------- F009 / F010 in Decision ----------
test('F009/F010: Connect at Hatchville is Hold: the shoulder case is envelope only and light load is not studied', () => {
  const g = gates(opt(HATCH), P).find(x => x.gate === 'Connect');
  assert.equal(g.verdict, 'Hold');
  assert.match(g.why, /Envelope only/); assert.match(g.why, /Shoulder · export/);
  assert.match(g.why, /light load/i);
  assert.equal(gates(opt('100178'), P).find(x => x.gate === 'Connect').verdict, 'Fail', 'an element-study breach is still a Fail');
});

// ---------- F001 / D3: one tally, one wording ----------
test('F001: the tally shows all three counts, Fail in red, and the lines are the gate engine\'s own words', () => {
  const gs = [{ gate: 'Connect', verdict: 'Hold', why: 'a' }, { gate: 'Capture', verdict: 'Fail', why: 'b' }, { gate: 'Land fit', verdict: 'Pass', why: 'c' }];
  const t = gateTally(gs);
  assert.equal(t.label, '1 Fail · 1 Open · 1 Pass (of 3)', 'the shared verdict line (v2copy.verdictLine), all three counts');
  assert.equal(t.tone, 'bad');
  assert.deepEqual([t.pass, t.hold, t.fail, t.total], [1, 1, 1, 3]);
  assert.equal(t.lines, 'Connect: Hold — a\nCapture: Fail — b\nLand fit: Pass — c');
  assert.equal(gateLines(gs), t.lines);
  assert.equal(gateTally([{ gate: 'x', verdict: 'Hold', why: '' }]).tone, 'warn');
  assert.equal(gateTally([{ gate: 'x', verdict: 'Pass', why: '' }]).tone, 'ok');
  assert.equal(gateTally(null).label, 'gates loading');
});

test('D3: a stage that has not loaded land or queue gets "pending", never a different verdict text', () => {
  const noLand = { ...data, land: null, queue: null };
  const m = opt(HATCH, P, noLand);
  const land = gates(m, P).find(x => x.gate === 'Land fit');
  assert.equal(land.verdict, 'Hold'); assert.equal(land.pending, true);
  assert.deepEqual(gateInputsPending(noLand, { tech: 'solar', fleetStatus: 'loading' }), ['queue register', 'land screen', 'ISO-NE fleet shape']);
  assert.deepEqual(gateInputsPending(data, { tech: 'solar', fleetStatus: 'ok' }), []);
  assert.deepEqual(gateInputsPending(data, { tech: 'storage', fleetStatus: 'loading' }), [], 'storage has no capture gate');
  const t = gateTally(gates(m, P), { pending: gateInputsPending(noLand, { tech: 'solar', fleetStatus: 'ok' }) });
  assert.match(t.label, /as of this stage/); assert.match(t.title, /queue register/);
});

// ---------- F003: capture threshold unset until agreed ----------
test('F003: the capture threshold has no default; the gate Holds and says who decides', () => {
  const t = thresholdsFor('solar');
  assert.equal(t.capture.value, null); assert.equal(t.capture.default, null); assert.equal(t.capture.source, 'not set');
  assert.match(t.capture.note, /open decision #2/); assert.match(t.capture.note, /Ganesh/);
  const v = fuelVerdict({ capture: { clearSky: { ratio: 0.785 }, fleet: { ratio: 0.723 } } }, 'solar', t).find(x => x.test === 'capture');
  assert.equal(v.verdict, 'Hold'); assert.match(v.why, /threshold not set/i);
  const row = thresholdRows(t, ['capture'])[0];
  assert.equal(row.sourceLabel, 'not set: open decision');
});

test('F003: a Fail on a user threshold says so; the market pass count is shown beside it', () => {
  const t = thresholdsFor('solar', { user: { capture: 90 } });
  const v = fuelVerdict({ capture: { clearSky: { ratio: 0.785 }, fleet: { ratio: 0.723 } } }, 'solar', t).find(x => x.test === 'capture');
  assert.equal(v.verdict, 'Fail'); assert.equal(v.qualifier, 'your threshold');
  const pop = { ids: ['a', 'b', 'c', 'd'], values: { solar_ratio: [0.95, 0.91, 0.85, null] }, measures: [] };
  const c = capturePassCount(pop, 90);
  assert.deepEqual([c.pass, c.of], [2, 3]);
  assert.match(c.text, /2 of 3 ISO-NE buses/);
  assert.equal(capturePassCount(pop, null), null);
  assert.equal(capturePassCount(null, 90), null);
});

test('F003: the Capture open item names the decision and its owner when no threshold is set', () => {
  const m = opt(HATCH), gs = gates(m, P);
  const it = openItems([m], [gs]).find(i => i.gate === 'Capture');
  assert.ok(it); assert.equal(it.verdict, 'Hold'); assert.match(it.what, /threshold/i); assert.match(it.what, /Ganesh/);
});

// ---------- F006: memo qualifiers ----------
test('F006: memo figures carry their qualifiers: case, study, service, envelope-only and unstudied cases', () => {
  const m = opt(HATCH);
  const q = memoQualifiers(m, 'solar', data.land);
  assert.match(q.exportLimit, /^197\.8 MW/);
  for (const s of [/Summer peak · export/, /thermal N-1 DC screen/, /element study 2026-05/, /NR energy-only/, /Shoulder · export envelope only/, /light load/i, /Envelope only/])
    assert.match(q.exportLimit, s);
  assert.match(q.cost, /none indicated \(unverified\)/); assert.match(q.cost, /envelope only/);
  assert.match(q.land, /habitat\/protected-only/); assert.match(q.land, /verify before client use/i);
  assert.ok(q.footnotes.length >= 2 && q.footnotes.every(f => typeof f === 'string' && f.length > 10));
  const none = memoQualifiers({ ...m, exportLimit: null, exportStatus: 'Not studied', cases: [] }, 'solar', null);
  assert.match(none.exportLimit, /^not held/);
});

// ---------- D9: signed congestion vs |MCC| ----------
test('D9: the signed congestion measure says it is signed and differs from Rank\'s |MCC| risk measure', () => {
  const pop = { ids: ['a', 'b'], values: { cong: [1.2, -0.4] }, measures: [{ key: 'cong', label: 'Average congestion 2025', unit: '$/MWh', higher: true, source: 'mart_bus_year' }] };
  const r = positionTable(pop, ['a'], 'solar', ['cong']).rows[0];
  assert.match(r.label, /signed/); assert.match(r.note, /\|MCC\|/); assert.match(r.note, /Rank/);
});

// ---------- lead addendum: one load-energy definition, one revenue stack label ----------
test('data-centre load cost is the hourly bill (economics-load.loadEnergyCost), not mean × MW × 8,760', async () => {
  const { loadEnergyCost } = await import('../economics-load.js');
  const { analyzePrices } = await import('../prices.js'); const { coreBasis } = await import('../basis.js');
  const m = opt('111403', { tech: 'datacenter', exportMW: 0, importMW: 100, basis, cf: 0.15, lossPct: 3 });
  const rows = analyzePrices(data, coreBasis({ ...basis, nodeId: '111403' })).rows;
  assert.equal(m.loadCost.value, loadEnergyCost(rows, 100).value); assert.match(m.loadCost.method, /hour by hour/);
});
test('Decision reads the Economics revenue stack label for the same bus and technology only', async () => {
  const { econRevenueStack } = await import('../decisioncore.js');
  const S = { ui: { revenueOut: { busId: HATCH, tech: 'solar', label: 'Energy $6.7M + RECs $3.7M = $10.4M', annual: 10.4e6 } }, handoffs: {} };
  assert.match(econRevenueStack(S, HATCH, 'solar').label, /RECs/);
  assert.equal(econRevenueStack(S, '111403', 'solar'), null);
  assert.equal(econRevenueStack(S, HATCH, 'wind'), null);
});
