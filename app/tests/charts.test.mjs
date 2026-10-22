// charts.js v3: the six added chart builders return markup, their Table view is built from the same
// array the chart draws, nulls stay "not held" (never zero) and empty input gives an explained empty state.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetCharts, barChart, lineChart, groupedBar, heatmap, stackedBar, areaChart, scatter, histogram, sparkline, durationCurve, histogramBins, durationValues } from '../charts.js';

// Rows of the Table view: [[cell, cell, ...], ...] from the host markup (tbody only).
const rows = html => {
  const body = (html.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || '';
  return [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1]));
};
const heads = html => [...((html.match(/<thead>([\s\S]*?)<\/thead>/) || [])[1] || '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(c => c[1]);
const isHost = html => /data-chart="c\d+"/.test(html) && /data-chart-view="chart"/.test(html) && /data-chart-view="table"/.test(html);
const isEmpty = html => /class="empty"/.test(html) && /Nothing to chart/.test(html) && !/data-chart=/.test(html);

test('every chart defaults to 220 px and honours opts.height', () => {
  resetCharts();
  assert.match(barChart([{ label: 'a', value: 1 }]), /height:220px/);
  assert.match(lineChart([{ name: 's', points: [{ x: 1, y: 2 }] }]), /height:220px/);
  assert.match(groupedBar([{ label: 'g', values: [1] }], { series: ['s'] }), /height:220px/);
  assert.match(stackedBar([{ label: 'g', values: [1, 2] }], { series: ['a', 'b'] }), /height:220px/);
  assert.match(areaChart([{ name: 's', points: [{ x: 1, y: 2 }] }]), /height:220px/);
  assert.match(scatter([{ x: 1, y: 2 }]), /height:220px/);
  assert.match(histogram([1, 2, 3]), /height:220px/);
  assert.match(durationCurve([{ name: 's', values: [1, 2] }]), /height:220px/);
  assert.match(barChart([{ label: 'a', value: 1 }], { height: 150 }), /height:150px/);
  assert.match(sparkline([1, 2, 3], { height: 18 }), /height="18"/);
});

test('stackedBar: host markup; table = the groups, one column per series, total only when every part is held', () => {
  const h = stackedBar([{ label: '2024', values: [10, 5] }, { label: '2025', values: [8, null] }], { series: ['Energy', 'Congestion'], fmt: v => v.toFixed(1), title: 'Stack' });
  assert.ok(isHost(h));
  assert.deepEqual(heads(h), ['Group', 'Energy', 'Congestion', 'Total']);
  assert.deepEqual(rows(h), [['2024', '10.0', '5.0', '15.0'], ['2025', '8.0', 'not held', 'not held']]);
});

test('areaChart: host markup; table lists every x with each series value', () => {
  const h = areaChart([{ name: 'A', points: [{ x: 1, y: 3 }, { x: 2, y: 4 }] }, { name: 'B', points: [{ x: 1, y: 1 }, { x: 2, y: null }] }], { stacked: true, title: 'Area' });
  assert.ok(isHost(h));
  assert.deepEqual(rows(h), [['1', '3', '1'], ['2', '4', 'not held']]);
});

test('scatter: one table row per plotted point; points missing x or y are listed as not held', () => {
  const h = scatter([{ x: 1, y: 2, label: 'p1', group: 'g' }, { x: 3, y: null, label: 'p2', group: 'g' }], { xLabel: 'MW', yLabel: '$', fmt: v => String(v), xfmt: v => String(v), title: 'Scatter' });
  assert.ok(isHost(h));
  assert.deepEqual(heads(h), ['Point', 'Group', 'MW', '$']);
  assert.deepEqual(rows(h), [['p1', 'g', '1', '2'], ['p2', 'g', '3', 'not held']]);
});

test('histogram: counts sum to the finite values; nulls are not counted as zero', () => {
  const vals = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null, NaN];
  const b = histogramBins(vals, 5);
  assert.equal(b.length, 5);
  assert.equal(b.reduce((s, x) => s + x.count, 0), 10);
  assert.equal(b[0].lo, 0); assert.equal(b.at(-1).hi, 9);
  assert.equal(b.at(-1).count, 2, 'the top edge is inclusive');
  const h = histogram(vals, { bins: 5, title: 'Hist' });
  assert.ok(isHost(h));
  const r = rows(h);
  assert.equal(r.length, 5);
  assert.equal(r.reduce((s, x) => s + Number(x[1]), 0), 10);
  assert.match(h, /2 values not held/);
  // a single repeated value still gives one bin, never a divide-by-zero
  assert.deepEqual(histogramBins([4, 4, 4], 10).map(x => x.count), [3]);
});

test('durationCurve: values sorted high to low with exceedance share; table first row is the max', () => {
  assert.deepEqual(durationValues([3, null, 9, 1]), [9, 3, 1]);
  const h = durationCurve([{ name: 'RT', values: [3, 9, 1, 5] }], { fmt: v => String(v), title: 'Dur' });
  assert.ok(isHost(h));
  const r = rows(h);
  assert.equal(r[0][1], '9');
  assert.equal(r.at(-1)[1], '1');
  assert.equal(r.length, 4);
});

test('sparkline: inline svg, no toggle; empty gives a muted not-held marker', () => {
  const s = sparkline([1, 3, 2]);
  assert.match(s, /^<svg/); assert.doesNotMatch(s, /data-chart-view/); assert.match(s, /<path/);
  assert.match(sparkline([null, undefined]), /not held/);
});

test('empty input gives the explained empty state for every chart', () => {
  for (const h of [stackedBar([], { series: ['a'] }), stackedBar([{ label: 'x', values: [null] }], { series: ['a'] }), areaChart([]), areaChart([{ name: 'a', points: [{ x: 1, y: null }] }]), scatter([]), scatter([{ x: null, y: 1 }]), histogram([]), histogram([null, NaN]), durationCurve([]), durationCurve([{ name: 'a', values: [null] }])]) {
    assert.ok(isEmpty(h), h);
    assert.match(h, /No values are held/);
  }
  assert.match(histogram([], { emptyText: 'No hourly prices for 2019.' }), /No hourly prices for 2019\./);
});

test('existing charts keep working (bar, line, heatmap table views)', () => {
  const b = barChart([{ label: 'a', value: 2 }, { label: 'b', value: null }], { fmt: v => String(v) });
  assert.deepEqual(rows(b), [['a', '2'], ['b', 'not held']]);
  const hm = heatmap([{ label: 'Jan', cells: [{ label: '0', value: 1 }, { label: '1', value: null }] }], { fmt: v => String(v) });
  assert.deepEqual(rows(hm), [['Jan', '1', 'not held']]);
});
