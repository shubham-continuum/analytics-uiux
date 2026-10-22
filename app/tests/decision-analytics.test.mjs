// Decision v3 analytics: market position, shared limiting elements, scenario ranges, coverage, open items, record diff.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { percentileOf, measureSet, orientedHigher, positionTable, sharedElements, scenarioRanges, stressLeaders, coverageGrid,
  openItems, gateCounts, recordDiff, studioNotes, optionMetrics, gates, stressCell, inputHash, ownExportLimit } from '../decisioncore.js';

const rd = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const data = { ...rd('snapshot.json'), queue: rd('queue.json'), land: rd('land.json'), flags: rd('flags.json') };
const basis = { mode: 'historical', market: 'RT', years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false };
const P = { tech: 'solar', exportMW: 100, importMW: 0, basis, cf: 0.15, lossPct: 3 };
const opt = (id, p = P) => optionMetrics(data, data.nodes.find(n => n.id === id), p);

test('percentile is mid-rank over held values; null is not held, never 0', () => {
  const r = percentileOf([1, 2, 2, 3, null, 4], 2);
  assert.deepEqual({ below: r.below, equal: r.equal, n: r.n }, { below: 1, equal: 2, n: 5 });
  assert.equal(r.pct, 40); // 100 × (1 + 2/2) / 5
  assert.equal(percentileOf([1, 2], null), null);
  assert.equal(percentileOf([null, null], 1), null);
  assert.equal(percentileOf([5], 5).pct, 50);
});

test('measure sets follow the Studio per technology; price is lower-is-better for a data centre only', () => {
  assert.ok(measureSet('solar').includes('solar_ratio') && measureSet('solar').includes('lmp_2030'));
  assert.ok(measureSet('storage').includes('tb4') && !measureSet('storage').includes('solar_ratio'));
  assert.ok(measureSet('datacenter').includes('hr_ll_chg'));
  const m = { key: 'lmp_2030', higher: true };
  assert.equal(orientedHigher(m, 'solar'), true);
  assert.equal(orientedHigher(m, 'datacenter'), false);
  assert.equal(orientedHigher({ key: 'std', higher: false }, 'storage'), true);
  assert.equal(orientedHigher({ key: 'std', higher: false }, 'solar'), false);
});

test('position table: raw values and percentiles per option, no combined score', () => {
  const pop = { measures: [{ key: 'lmp_2030', label: 'L', unit: '$/MWh', higher: true }, { key: 'neg', label: 'N', unit: 'h', higher: false }],
    ids: ['1', '2', '3', '4'], values: { lmp_2030: [10, 20, 30, null], neg: [5, 5, 1, 9] } };
  const t = positionTable(pop, ['3', '4', '99'], 'solar', ['lmp_2030', 'neg']);
  assert.equal(t.rows.length, 2);
  const [price, neg] = t.rows;
  assert.equal(price.cells[0].value, 30); assert.equal(price.cells[0].pct, 100 * (2 + 0.5) / 3);
  assert.equal(price.cells[1].value, null); assert.equal(price.cells[1].pct, null);
  assert.equal(price.cells[2].value, null, 'unknown bus is not held');
  assert.equal(neg.cells[0].value, 1);
  assert.equal(neg.cells[0].oriented, 100 - neg.cells[0].pct, 'lower is better: oriented = 100 − percentile');
  assert.equal(price.n, 3);
  assert.equal(t.score, undefined);
});

test('shared limiting elements: facilities named in two or more options, pre-existing flagged, limit consistent', () => {
  const row = (f, t, l, d = 0.1) => ({ monitored_facility: f, transfer_mw: t, pct_loading_no_transfer: l, dfax: d });
  const ms = [
    { cases: [{ status: 'Fits', label: 'Summer peak · export', element: { rows: [row('A  115 B', 150, 80), row('C', 300, 50), row('D', -20, 104)] } }] },
    { cases: [{ status: 'Fits', label: 'Summer peak · export', element: { rows: [row('A 115 B', 90, 85), row('D', 400, 40)] } }, { status: 'Not requested', label: 'x', element: { rows: [row('C', 10, 10)] } }] },
  ];
  const s = sharedElements(ms);
  assert.deepEqual(s.rows.map(r => r.facility).sort(), ['A 115 B', 'D']);
  const a = s.rows.find(r => r.facility === 'A 115 B');
  assert.equal(a.cells[0].transfer, 150); assert.equal(a.cells[1].transfer, 90);
  const d = s.rows.find(r => r.facility === 'D');
  assert.equal(d.cells[0].pre, true); assert.equal(d.cells[0].transfer, null, 'a pre-existing overload gives no limit');
  assert.deepEqual(s.counts, [3, 2]);
  assert.deepEqual(s.minTransfer, [150, 90]);
});

test('shared elements on real buses: the lowest usable transfer equals the element limit where one is held', () => {
  const m = opt('100178');
  const s = sharedElements([m, opt('100179')]);
  assert.equal(s.minTransfer[0], m.cases.find(c => c.key === 'summer_peak|discharge').element.limit);
  assert.equal(s.minTransfer[0], ownExportLimit(data.grid, '100178'));
});

test('scenario ranges: min, max, spread and downside against the applied basis; missing cells are not held', () => {
  const table = [{ sc: { label: 'Applied', applied: true }, vals: [100, 80] }, { sc: { label: 'Y1' }, vals: [60, null] }, { sc: { label: 'Y2' }, vals: [140, 90] }];
  const r = scenarioRanges(table);
  assert.deepEqual([r[0].min, r[0].max, r[0].minLabel, r[0].maxLabel, r[0].n], [60, 140, 'Y1', 'Y2', 3]);
  assert.equal(r[0].downside, -40); assert.equal(r[0].downsidePct, -40);
  assert.equal(r[1].missing, 1); assert.equal(r[1].min, 80);
  const lo = scenarioRanges(table, { lowerBetter: true });
  assert.equal(lo[0].worst, 140); assert.equal(lo[0].worstLabel, 'Y2'); assert.equal(lo[0].downside, 40);
  assert.equal(scenarioRanges([{ sc: { label: 'A', applied: true }, vals: [null] }])[0].min, null);
});

test('stress leaders: lower-is-better picks the cheapest option', () => {
  const s = stressLeaders([{ sc: { applied: true }, vals: [30, 20] }, { sc: {}, vals: [10, 20] }], ['A', 'B'], { lowerBetter: true });
  assert.equal(s.base, 1); assert.equal(s.rows[1].leader, 0); assert.equal(s.other, 1);
});

test('stress cell per technology: revenue (solar), TB4 spread (storage), average price (data centre)', () => {
  const n = data.nodes.find(x => x.id === '111403');
  const sol = stressCell(data, n, basis, P, null);
  assert.equal(sol.metric, 'revenue'); assert.ok(sol.value > 0 && sol.mean > 0 && sol.capture > 0);
  const st = stressCell(data, n, basis, { ...P, tech: 'storage' }, null);
  assert.equal(st.metric, 'tb4'); assert.ok(Math.abs(st.value - 62.708232876712344) < 1e-6, `${st.value} = mart_bus_tb 2025 RT tb4`);
  const dc = stressCell(data, n, basis, { ...P, tech: 'datacenter' }, null);
  assert.equal(dc.metric, 'price'); assert.ok(Math.abs(dc.value - 66.70873401826483) < 1e-6, 'mart_bus_year 2025 RT avg');
  const b5 = { mode: 'forecast', market: 'model', run: '5yr', years: [2028], weighting: 'duration', weights: {}, strict: true, includePartial: true };
  assert.equal(stressCell(data, n, b5, { ...P, tech: 'storage' }, null).value, null, 'Cape 5-yr exclusion applies to every metric');
});

test('coverage grid: every concern per option is held / partial / not held with a reason', () => {
  const ms = ['111403', '114417'].map(id => opt(id));
  const g = coverageGrid(data, ms);
  const concerns = g.map(r => r.concern);
  for (const c of ['Price node', 'Settled price history', 'Forecast runs', 'Element study (requested cases)', 'Upgrade cost', 'Land exclusion screen', 'Queue linkage', 'Coordinates']) assert.ok(concerns.includes(c), c);
  const el = g.find(r => r.concern === 'Element study (requested cases)');
  assert.equal(el.cells[1].status, 'not held', '114417 has no element limit (no violations, tested max not published; shoulder mislabelled)');
  assert.equal(g.find(r => r.concern === 'Queue linkage').cells.every(c => c.status !== 'held'), true, 'queue linkage is never complete');
  assert.equal(g.find(r => r.concern === 'Land exclusion screen').cells[1].status, 'not held');
  assert.ok(g.every(r => r.cells.every(c => ['held', 'partial', 'not held'].includes(c.status) && c.detail)));
});

test('open items: one per gate not passed, with where to act; Pass gates give none', () => {
  const ms = ['111403', '100178'].map(id => opt(id)), gs = ms.map(m => gates(m, P));
  const items = openItems(ms, gs);
  const notPassed = gs.flat().filter(g => g.verdict !== 'Pass').length;
  assert.equal(items.length, notPassed);
  assert.ok(items.every(i => /›/.test(i.where) && i.what && i.option));
  assert.ok(items.some(i => i.gate === 'Queue exposure'));
  assert.ok(items.filter(i => i.gate === 'Connect' && i.option === ms[1].node.name).every(i => i.verdict === 'Fail'));
  assert.deepEqual(gateCounts(gs[1]), { Pass: gs[1].filter(g => g.verdict === 'Pass').length, Hold: gs[1].filter(g => g.verdict === 'Hold').length, Fail: gs[1].filter(g => g.verdict === 'Fail').length });
});

test('record diff names what changed since a record; equal hashes give no difference', () => {
  const S = { tech: 'solar', exportMW: 100, importMW: 0, basis, ui: { econ: {} }, handoffs: {} };
  const h = inputHash(data, S, ['111403']);
  assert.deepEqual(recordDiff(h, h), []);
  assert.deepEqual(recordDiff(h, inputHash(data, { ...S, exportMW: 150 }, ['111403'])), ['Export MW']);
  assert.deepEqual(recordDiff(h, inputHash(data, S, ['111403', '100178'])), ['Options']);
  assert.equal(recordDiff('not json', h), null);
});

test('record diff names the per-fuel thresholds when the user overrides one; a record made before v5 is unchanged without one', () => {
  const S = { tech: 'solar', exportMW: 100, importMW: 0, basis, ui: { econ: {} }, handoffs: {} };
  const h = inputHash(data, S, ['111403']);
  assert.deepEqual(recordDiff(h, inputHash(data, { ...S, ui: { econ: {}, dTh_capture: '85' } }, ['111403'])), ['Fuel thresholds']);
  assert.deepEqual(recordDiff(h, inputHash(data, { ...S, ui: { econ: {}, decision: { th: { tb4: 12 } } } }, ['111403'])), ['Fuel thresholds']);
  const pre = JSON.stringify(JSON.parse(h).slice(0, 10)); // a 10-part fingerprint recorded before thresholds existed
  assert.deepEqual(recordDiff(pre, h), []);
});

test('Studio copy notes: unified is primary; a difference is a data note; excluded vendor fields say so', () => {
  const unified = { lmp_rt: 66.70873, lmp_2030: 47.166, neg: 74, hr_sp_dis: 260.4, sc_mva: 2520.1 };
  const studio = { lmp_2025: 66.71, lmp_2030: 70.68, hneg_2025: 74, hr_sp_dis: 260.4, sc_mva: 25.2, lmp_2050: 66.94, top_constraint: 'Maine-NH Tie 345kV', solar_100MW_2030: 1.2 };
  const n = studioNotes(unified, studio);
  const by = k => n.find(x => x.key === k);
  assert.equal(by('lmp_2025').state, 'same');
  assert.equal(by('lmp_2030').state, 'differs'); assert.ok(Math.abs(by('lmp_2030').diff - (70.68 - 47.166)) < 1e-9);
  assert.equal(by('sc_mva').state, 'differs'); assert.match(by('sc_mva').note, /100/);
  assert.equal(by('lmp_2050').state, 'excluded');
  assert.equal(by('top_constraint').state, 'excluded');
  assert.equal(by('solar_100MW_2030').state, 'excluded');
  assert.equal(studioNotes(unified, null), null);
});
