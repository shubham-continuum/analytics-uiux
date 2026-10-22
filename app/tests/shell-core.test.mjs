// Shell v4 core logic: depth contract, sample-project walkthrough, presets, pins, tornado chart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPTHS, normDepth, depthAllows, elementDepth, hiddenSummary, normSamples, resolveStep, stepPatch, applyPreset, presetPatch, togglePin, pinsForCompare, tabLabel, basisFromSample } from '../ui.js';
import { tornado, tornadoRows, resetCharts } from '../charts.js';

test('depth: three levels, default review, cumulative', () => {
  assert.deepEqual(DEPTHS, ['screen', 'review', 'study']);
  assert.equal(normDepth('study'), 'study');
  assert.equal(normDepth('STUDY'), 'study');
  assert.equal(normDepth(undefined), 'review');
  assert.equal(normDepth('deep'), 'review');
  assert.ok(depthAllows('screen', 'screen'));
  assert.ok(!depthAllows('review', 'screen'));
  assert.ok(depthAllows('review', 'study'));
  assert.ok(depthAllows('screen', 'study'));
  assert.ok(!depthAllows('study', 'review'));
});

test('depth: element depth = its tag; an untagged trace card is study; an untagged card always shows', () => {
  assert.equal(elementDepth({ depth: 'review', trace: false }), 'review');
  assert.equal(elementDepth({ depth: null, trace: true }), 'study');
  assert.equal(elementDepth({ depth: 'review', trace: true }), 'review', 'a KPI trace tagged review stays review');
  assert.equal(elementDepth({ depth: null, trace: false }), 'screen');
  assert.equal(elementDepth({ depth: 'bogus', trace: false }), 'screen');
});

test('depth: hidden summary counts cards above the current depth by level', () => {
  const cards = ['screen', 'review', 'review', 'study', 'study', 'study'];
  assert.deepEqual(hiddenSummary(cards, 'screen'), { total: 5, review: 2, study: 3 });
  assert.deepEqual(hiddenSummary(cards, 'review'), { total: 3, review: 0, study: 3 });
  assert.deepEqual(hiddenSummary(cards, 'study'), { total: 0, review: 0, study: 0 });
});

test('tab label: labelFor(tech) when the view provides it, else label', () => {
  assert.equal(tabLabel({ label: 'Solar & wind revenue', labelFor: t => (t === 'datacenter' ? 'Load cost' : null) }, 'datacenter'), 'Load cost');
  assert.equal(tabLabel({ label: 'Solar & wind revenue', labelFor: () => null }, 'solar'), 'Solar & wind revenue');
  assert.equal(tabLabel({ label: 'LMP & years' }, 'wind'), 'LMP & years');
  assert.equal(tabLabel({ label: 'X', labelFor: () => { throw new Error('bad'); } }, 'wind'), 'X', 'a throwing labelFor falls back');
});

const STAGES = [
  { key: 'grid', name: 'Grid', view: { tabs: [{ id: 'capacity', label: 'Connection capacity' }, { id: 'cost', label: 'Upgrade cost allocator' }] } },
  { key: 'prices', name: 'Prices', view: { tabs: [{ id: 'lmp', label: 'LMP & years' }, { id: 'shape', label: 'Shape & capture', labelFor: t => (t === 'storage' ? 'Shape & spreads' : null) }] } },
];
const SAMPLE = {
  projects: [
    { id: 'p1', name: 'Solar 100', client_type: 'IPP', tech: 'solar', exportMW: 100, importMW: 0, narrative: 'n', basis: { mode: 'historical', market: 'rt', years: [2024, 2025] },
      options: [{ id: 'o1', label: 'Own node', busId: '111403', note: 'a' }, { id: 'o2', label: 'Same sub', busId: 222, note: 'b' }],
      steps: [{ stage: 'grid', tab: 'capacity', depth: 'screen', what_to_look_at: 'look' }, { stage: 'Prices', tab: 'Shape & capture', depth: 'study', what_to_look_at: 'shape', option: 'o2' }] },
    { id: 'bad', name: 'No options', tech: 'solar', options: [], steps: [] },
    { name: 'no id' },
  ],
};

test('samples: invalid projects are dropped with a reason; ids become strings', () => {
  const { projects, problems } = normSamples(SAMPLE);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].options[1].busId, '222');
  assert.equal(problems.length, 2);
  assert.deepEqual(normSamples(null), { projects: [], problems: ['samples file is not an object with a projects list'] });
});

test('samples: steps resolve stage by key or name and tab by id or label', () => {
  const p = normSamples(SAMPLE).projects[0];
  assert.deepEqual(resolveStep(p.steps[0], STAGES), { stage: 'grid', tab: 'capacity', depth: 'screen', text: 'look', option: null });
  assert.deepEqual(resolveStep(p.steps[1], STAGES), { stage: 'prices', tab: 'shape', depth: 'study', text: 'shape', option: 'o2' });
  assert.equal(resolveStep({ stage: 'nowhere', tab: 'x' }, STAGES), null);
  assert.equal(resolveStep({ stage: 'grid', tab: 'unknown' }, STAGES).tab, null, 'unknown tab: stage first tab');
});

test('samples: stepPatch sets bus, tech, MW, depth, stage/tab, pins and Decision options', () => {
  const p = normSamples(SAMPLE).projects[0];
  const a = stepPatch(p, 'o1', 0, STAGES);
  assert.equal(a.nodeId, '111403'); assert.equal(a.tech, 'solar'); assert.equal(a.exportMW, 100); assert.equal(a.importMW, 0);
  assert.equal(a.depth, 'screen'); assert.equal(a.stage, 'grid'); assert.equal(a.tab, 'capacity');
  assert.deepEqual(a.pins, ['111403', '222']); assert.deepEqual(a.dOpts, ['222']);
  assert.equal(a.step, 0); assert.equal(a.of, 2);
  const b = stepPatch(p, 'o1', 1, STAGES);
  assert.equal(b.nodeId, '222', 'a step naming an option switches the bus');
  assert.deepEqual(b.dOpts, ['111403']);
  assert.equal(stepPatch(p, 'o1', 9, STAGES).step, 1, 'step index is clamped');
  assert.equal(stepPatch(p, 'zzz', 0, STAGES).option, 'o1', 'unknown option falls back to the first');
});

test('samples: basis merges onto the default and keeps only held years', () => {
  const def = { nodeId: '1', mode: 'historical', market: 'rt', years: [2025], weighting: 'equal' };
  const held = { rt: [2023, 2024, 2025], da: [2024] };
  const years = (m) => held[m] || [];
  assert.deepEqual(basisFromSample(def, { mode: 'historical', market: 'rt', years: [2019, 2024, 2025] }, years), { ...def, years: [2024, 2025] });
  assert.deepEqual(basisFromSample(def, { mode: 'historical', years: [2019] }, years), def, 'no held year: keep the default');
  assert.deepEqual(basisFromSample(def, null, years), def);
  assert.deepEqual(basisFromSample(def, { mode: 'forecast', run: '10yr' }, years), { ...def, mode: 'forecast', run: '10yr', years: [2025] }, 'forecast years are filled by the app from the run');
});

test('presets: plain objects merge one level deep; undefined deletes; functions return a patch', () => {
  const ui = { econ: { capex: 1000, rte: 0.85 }, week: 12 };
  const out = applyPreset(ui, { econ: { capex: 1200 }, week: undefined, mode: 'x' });
  assert.deepEqual(out, { econ: { capex: 1200, rte: 0.85 }, mode: 'x' });
  assert.deepEqual(ui, { econ: { capex: 1000, rte: 0.85 }, week: 12 }, 'input not mutated');
  assert.deepEqual(presetPatch({ label: 'Vault', ui: { a: 1 } }, {}), { a: 1 });
  assert.deepEqual(presetPatch(({ econ }) => ({ econ: { capex: econ.capex * 2 } }), ui), { econ: { capex: 2000 } });
  assert.deepEqual(presetPatch({ a: 2 }, {}), { a: 2 });
  assert.equal(presetPatch(null, {}), null);
});

test('pins: toggle adds/removes; compare = pins other than the current bus, up to 2', () => {
  assert.deepEqual(togglePin([], 5), ['5']);
  assert.deepEqual(togglePin(['5', '7'], '5'), ['7']);
  assert.deepEqual(pinsForCompare(['1', '2', '3', '4'], '2'), { dOpts: ['1', '3'], dropped: ['4'] });
  assert.deepEqual(pinsForCompare([], '2'), { dOpts: [], dropped: [] });
});

test('tornado: rows sorted by swing; table carries low/high/base/swing; nulls not held', () => {
  const rows = [{ label: 'Capex', low: -5, high: 8, base: 1 }, { label: 'Price', low: -20, high: 25, base: 1 }, { label: 'REC', low: null, high: 3, base: 1 }];
  const s = tornadoRows(rows);
  assert.deepEqual(s.map(r => r.label), ['Price', 'Capex', 'REC']);
  assert.equal(s[0].swing, 45);
  assert.equal(s[2].swing, null);
  resetCharts();
  const h = tornado(rows, { fmt: v => v.toFixed(0), title: 'T' });
  assert.match(h, /data-chart="c\d+"/);
  assert.match(h, /<th>Driver<\/th><th class="num">Low<\/th><th class="num">High<\/th><th class="num">Base<\/th><th class="num">Swing<\/th>/);
  assert.match(h, /<td>Price<\/td><td class="num">-20<\/td><td class="num">25<\/td><td class="num">1<\/td><td class="num">45<\/td>/);
  assert.match(h, /<td>REC<\/td><td class="num">not held<\/td>/);
  assert.match(tornado([{ label: 'x', low: null, high: null, base: 1 }]), /Nothing to chart/);
});
