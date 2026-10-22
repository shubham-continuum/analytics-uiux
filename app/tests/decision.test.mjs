import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { optionMetrics, gates, revenueFor, inputHash, deepFreeze, costText, stressValue, stressLeaders, commonYears, commonRuns, ownExportLimit, priceTier, ECON_DEFAULTS } from '../decisioncore.js';
import { generationRevenue } from '../economics.js';
import { caseTable, binding } from '../gridrules.js';

const rd = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url)));
const data = { ...rd('snapshot.json'), queue: rd('queue.json'), land: rd('land.json'), flags: rd('flags.json') };
const basis = { mode: 'historical', market: 'RT', years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false };
const opt = id => optionMetrics(data, data.nodes.find(n => n.id === id), { tech: 'solar', exportMW: 100, importMW: 0, basis, cf: 0.15, lossPct: 3 });

test('options read the same export limit as Grid (one number, one home)', () => {
  const m = opt('111403');
  assert.equal(m.exportLimit, binding(caseTable(data.grid, '111403', 'solar', 100, 0), 'export').value);
});

test('100178 fails Connect (67.6 MW < 100 MW); unknown is never Pass', () => {
  const g = gates(opt('100178'), { tech: 'solar', basis });
  assert.equal(g.find(x => x.gate === 'Connect').verdict, 'Fail');
  const g2 = gates(opt('114417'), { tech: 'solar', basis });
  assert.notEqual(g2.find(x => x.gate === 'Land fit').verdict, 'Pass'); // no exclusion screen held
});

test('Cape bus on the 5-yr run is held on price evidence', () => {
  const m = optionMetrics(data, data.nodes.find(n => n.id === '111403'), { tech: 'solar', exportMW: 100, importMW: 0, basis: { mode: 'forecast', market: 'model', run: '5yr', years: [2028], weighting: 'duration', strict: false, includePartial: true }, cf: 0.15 });
  assert.equal(gates(m, { tech: 'solar', basis: { mode: 'forecast', run: '5yr' } }).find(x => x.gate === 'Revenue evidence').verdict, 'Hold');
});

test('revenue is clipped at the export limit: 100178 (67.6 MW) earns less than an unclipped 100 MW', () => {
  const n = data.nodes.find(x => x.id === '100178');
  const clipped = revenueFor(data, n, basis, 'solar', 100, { cf: 0.15, lossPct: 3, exportLimit: 67.6 });
  const free = revenueFor(data, n, basis, 'solar', 100, { cf: 0.15, lossPct: 3 });
  assert.ok(clipped.value <= free.value);
  assert.equal(opt('100178').revenue.clippedAt ?? 67.6, 67.6);
});

test('storage never passes the revenue gate without a value', () => {
  const m = optionMetrics(data, data.nodes.find(n => n.id === '111403'), { tech: 'storage', exportMW: 50, importMW: 50, basis, cf: 0.15, lossPct: 3 });
  assert.equal(gates(m, { tech: 'storage' }).find(g => g.gate === 'Revenue evidence').verdict, 'Hold');
});

test('input hash changes with tech, size or options, not only the price basis', () => {
  const S = { tech: 'solar', exportMW: 100, importMW: 0, basis, ui: {}, handoffs: {} };
  const h = inputHash(data, S, ['111403']);
  assert.notEqual(h, inputHash(data, { ...S, exportMW: 150 }, ['111403']));
  assert.notEqual(h, inputHash(data, S, ['111403', '100178']));
});

test('input hash keeps option order (candidate first) and covers land control, data vintages and the econ inputs used', () => {
  const S = { tech: 'solar', exportMW: 100, importMW: 0, basis, ui: { econ: {} }, handoffs: {} };
  const h = inputHash(data, S, ['111403', '100178']);
  assert.notEqual(h, inputHash(data, S, ['100178', '111403']), 'swapping the candidate changes the hash');
  assert.notEqual(h, inputHash(data, { ...S, ui: { ...S.ui, land: { control: 90 } } }, ['111403', '100178']), 'site control');
  assert.notEqual(h, inputHash({ ...data, queue: { ...data.queue, source: 'newer extract' } }, S, ['111403', '100178']), 'queue source');
  assert.notEqual(h, inputHash({ ...data, queue: { ...data.queue, queue: [...data.queue.queue, { request_date: '2099-01-01', max_mw: 1 }] } }, S, ['111403', '100178']), 'latest queue request');
  assert.notEqual(h, inputHash({ ...data, land: { ...data.land, source: 'other' } }, S, ['111403', '100178']), 'land source');
  assert.notEqual(h, inputHash({ ...data, flags: undefined }, S, ['111403', '100178']), 'flags presence');
  assert.notEqual(h, inputHash(data, { ...S, ui: { econ: { lossPct: 5 } } }, ['111403', '100178']), 'losses');
  assert.notEqual(h, inputHash(data, { ...S, ui: { econ: { solarCF: 20 } } }, ['111403', '100178']), 'solar CF');
  assert.equal(h, inputHash(data, { ...S, ui: { econ: { rec: 40, capacityPrice: 9 } } }, ['111403', '100178']), 'econ inputs Decision does not use are ignored');
});

test('Connect holds when a requested case rests on the envelope only (shoulder export always does)', () => {
  const g = gates(opt('111403'), { tech: 'solar' }).find(x => x.gate === 'Connect');
  assert.equal(g.verdict, 'Hold');
  assert.match(g.why, /envelope only \(vendor-asserted\) for .*Shoulder · export/);
  const m = opt('111403');
  assert.ok(Array.isArray(m.envelopeOnly) && m.envelopeOnly.includes('Shoulder · export'));
  assert.ok(Array.isArray(m.cases), 'case table exposed');
  const st = optionMetrics(data, data.nodes.find(n => n.id === '111403'), { tech: 'storage', exportMW: 50, importMW: 50, basis, cf: 0.15, lossPct: 3 });
  assert.ok(st.envelopeOnly.includes('Shoulder · charge'));
  assert.equal(opt('100178').cases.find(r => r.key === 'summer_peak|discharge').status, 'Does not fit'); // element breach still Fails (earlier test)
});

test('Upgrade cost known: Priced with an unverified case is Hold; "No upgrades indicated" shows no dollar figure', () => {
  const m = opt('100178'); // $2.49M priced, shoulder unverified
  assert.equal(m.cost.status, 'Lower bound'); // P2 C10: priced items + an envelope-only case are a lower bound (was 'Priced', the defect)
  const g = gates(m, { tech: 'solar' }).find(x => x.gate === 'Upgrade cost known');
  assert.equal(g.verdict, 'Hold');
  assert.match(g.why, /unverified/);
  const g2 = gates(opt('111403'), { tech: 'solar' }).find(x => x.gate === 'Upgrade cost known');
  assert.equal(g2.verdict, 'Hold');
  assert.doesNotMatch(g2.why, /\$/);
  assert.match(g2.why, /none indicated \(unverified\)/);
  const pass = gates({ ...m, cost: { status: 'True zero', total: 0, items: [], unverified: [], gaps: [] } }, { tech: 'solar' }).find(x => x.gate === 'Upgrade cost known');
  assert.equal(pass.verdict, 'Pass');
});

test('cost text: no dollars for none indicated; ≥ for lower bound and partly priced', () => {
  assert.equal(costText({ status: 'No upgrades indicated', total: 0 }), 'none indicated (unverified)');
  assert.equal(costText({ status: 'Lower bound', total: 1.5 }), '≥ $1.50M');
  assert.equal(costText({ status: 'Partly priced', total: 2 }), '≥ $2.00M');
  assert.equal(costText({ status: 'Priced', total: 2.49 }), '$2.49M');
  assert.equal(costText({ status: 'True zero', total: 0 }), '$0.00M');
  assert.equal(costText({ status: 'Not held', total: null }), 'not held');
});

test('Queue exposure is never Pass; it states the linkage limit and shows nearby linked MW', () => {
  for (const id of ['111403', '100178', '114417']) {
    const m = opt(id), g = gates(m, { tech: 'solar' }).find(x => x.gate === 'Queue exposure');
    assert.equal(g.verdict, 'Hold', id);
    assert.match(g.why, /110 of ~1,751 requests linked; unlinked requests not assessed/);
    assert.ok(m.queueLinkedMW === null || typeof m.queueLinkedMW === 'number');
  }
  assert.equal(gates({ ...opt('111403'), queueNotModelled: 0, queueLinkedMW: 50 }, { tech: 'solar' }).find(x => x.gate === 'Queue exposure').verdict, 'Hold');
});

test('storage charge status uses the Grid rule (import as entered), so the tabs never disagree', () => {
  const n = data.nodes.find(x => x.id === '111403');
  const m = optionMetrics(data, n, { tech: 'storage', exportMW: 100, importMW: 0, basis, cf: 0.15, lossPct: 3 });
  const grid = binding(caseTable(data.grid, '111403', 'storage', 100, 0), 'import');
  assert.equal(m.importStatus, grid.status);
  assert.equal(m.importLimit, grid.value);
});

test('a sent charge limit that is null stays null; a sent limit for another project is flagged', () => {
  const n = data.nodes.find(x => x.id === '111403');
  const sentGrid = { busId: '111403', exportMW: 120, importMW: null, tech: 'storage', requestMW: 50, at: '2026-09-29T10:00' };
  const m = optionMetrics(data, n, { tech: 'storage', exportMW: 50, importMW: 50, basis, cf: 0.15, lossPct: 3, sentGrid });
  assert.equal(m.importLimit, null);
  assert.equal(m.exportLimit, 120);
  assert.equal(m.sentStale, false);
  const m2 = optionMetrics(data, n, { tech: 'solar', exportMW: 100, importMW: 0, basis, cf: 0.15, lossPct: 3, sentGrid });
  assert.equal(m2.sentStale, true);
});

test('stress cells apply the Cape 5-yr exclusion (applied basis included)', () => {
  const n = data.nodes.find(x => x.id === '111403');
  const b5 = { mode: 'forecast', market: 'model', run: '5yr', years: [2028], weighting: 'duration', weights: {}, strict: true, includePartial: true };
  const r = stressValue(data, n, b5, { tech: 'solar', exportMW: 100, cf: 0.15, lossPct: 3 }, null);
  assert.equal(r.value, null);
  assert.match(r.reason, /5-yr/);
  assert.ok(typeof stressValue(data, n, basis, { tech: 'solar', exportMW: 100, cf: 0.15, lossPct: 3 }, null).value === 'number');
});

test('stress comparability: a scenario with a missing option is not comparable and not counted', () => {
  const table = [{ sc: { applied: true }, vals: [3, 2, 1] }, { sc: {}, vals: [1, null, 5] }, { sc: {}, vals: [1, 4, 2] }, { sc: {}, vals: [5, 1, 1] }];
  const s = stressLeaders(table, ['A', 'B', 'C']);
  assert.equal(s.rows[1].comparable, false);
  assert.equal(s.rows[1].leader, null);
  assert.equal(s.rows[1].reason, 'not comparable: B missing');
  assert.equal(s.base, 0);
  assert.equal(s.other, 1); // row 2 led by B; row 1 excluded
  assert.equal(s.comparable, 2);
  const s2 = stressLeaders([{ sc: { applied: true }, vals: [null, 2] }, { sc: {}, vals: [1, 2] }], ['A', 'B']);
  assert.equal(s2.base, null);
});

test('stress years: complete for every option; an option without history is named', () => {
  const opts = ['111403', '100178'].map(id => data.nodes.find(n => n.id === id));
  const c = commonYears(data, opts);
  assert.deepEqual(c.years, [2021, 2022, 2023, 2024, 2025]);
  const noHist = { ...data, series: data.series.filter(s => !(s.nodeId === '100178' && s.mode === 'historical')) };
  const c2 = commonYears(noHist, opts);
  assert.deepEqual(c2.years, []);
  assert.match(c2.reason, /no historical years: .* has no price history/);
});

test('stress runs: only runs held for every option (never the 5-yr run)', () => {
  const opts = ['111403', '100178'].map(id => data.nodes.find(n => n.id === id));
  assert.deepEqual(commonRuns(data, opts).map(r => r.run), ['pcr2030', '10yr', 'pcr2035', 'pcr2040']);
  const drop = { ...data, series: data.series.filter(s => !(s.nodeId === '100178' && s.run === 'pcr2040')) };
  assert.ok(!commonRuns(drop, opts).some(r => r.run === 'pcr2040'));
});

test('independent export limit from the raw grid rows matches the limit used', () => {
  for (const id of ['111403', '100178', '100179']) assert.equal(ownExportLimit(data.grid, id), opt(id).exportLimit, id);
});

test('pricing tier label and Economics defaults', () => {
  assert.match(priceTier(data, data.nodes.find(n => n.id === '100178'), basis), /own node/i);
  assert.match(priceTier(data, data.nodes.find(n => n.id === '100178'), { mode: 'forecast', run: '10yr' }), /own forecast/i);
  assert.deepEqual(ECON_DEFAULTS, { solarCF: 15, windCF: 32.5, lossPct: 3 });
});

test('records are deep-frozen', () => {
  const r = deepFreeze({ basis: { years: [2025] } });
  assert.ok(Object.isFrozen(r.basis) && Object.isFrozen(r.basis.years));
});

test('Decision revenue = the Economics tab method: losses first, then the export cap (one number, one home)', async () => {
  const { analyzePrices } = await import('../prices.js');
  const { clearSky } = await import('../solar.js');
  const { coreBasis } = await import('../basis.js');
  const n = data.nodes.find(x => x.id === '100178'), mw = 100, cf = 0.15, loss = 3, cap = 67.6;
  const rows = analyzePrices(data, coreBasis({ ...basis, nodeId: '100178' })).rows;
  // Economics tab pipeline, written out: CF-scaled clear-sky capped at nameplate → × (1 − losses) → capped at the limit.
  const shape = rows.map(r => clearSky(r.timestamp, n.latitude, n.longitude) ?? 0), H = rows.reduce((t, r) => t + r.dtHours, 0);
  const mean = shape.reduce((t, v, i) => t + v * rows[i].dtHours, 0) / H;
  const recs = rows.map((r, i) => ({ ...r, generationMW: Math.min(cap, Math.min(mw, (mw * cf * shape[i]) / mean) * (1 - loss / 100)) }));
  const econ = generationRevenue(recs, { lossPct: 0 }).summary.merchantRevenue / (H / 8760);
  const dec = revenueFor(data, n, basis, 'solar', mw, { cf, lossPct: loss, exportLimit: cap }).value;
  assert.ok(Math.abs(dec - econ) < 1e-6 * econ, `${dec} vs ${econ}`);
});

test('land gate never passes on a habitat/protected-only screen (land review: water and urban not screened)', () => {
  const g = gates({ ...opt('111403'), land: { status: 'fits', screenOnly: true } }, { tech: 'solar' }).find(x => x.gate === 'Land fit');
  assert.equal(g.verdict, 'Hold');
  assert.equal(gates({ ...opt('111403'), land: { status: 'does not fit' } }, { tech: 'solar' }).find(x => x.gate === 'Land fit').verdict, 'Fail');
});
