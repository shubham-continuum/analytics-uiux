import test from 'node:test';
import assert from 'node:assert/strict';
import { toCsv, trace, resetTraces, csvFor, reconcile } from '../trace.js';

test('toCsv quotes commas, quotes and newlines; null is an empty cell', () => {
  const s = toCsv(['a', 'b', 'c'], [[1, 'x,y', null], ['say "hi"', 'l1\nl2', 2.5]]);
  assert.equal(s, 'a,b,c\r\n1,"x,y",\r\n"say ""hi""","l1\nl2",2.5\r\n');
});

test('toCsv neutralises spreadsheet formula injection in text cells', () => {
  assert.equal(toCsv(['n'], [['=HYPERLINK("x")'], ['-5'], [-5]]), 'n\r\n"\'=HYPERLINK(""x"")"\r\n\'-5\r\n-5\r\n');
});

test('reconcile: pass within tolerance, fail outside, unknown when a side is missing', () => {
  assert.equal(reconcile(10, 10.0000001).status, 'pass');
  assert.equal(reconcile(10, 10.5).status, 'fail');
  assert.equal(reconcile(null, 10).status, 'unknown');
  assert.equal(reconcile(1e6, 1e6 + 0.5, 1e-6).status, 'pass'); // relative tolerance
});

test('trace renders inputs, steps, result, check and registers its CSV', () => {
  resetTraces();
  const html = trace({
    id: 'mean', title: 'Mean price', formula: 'Mean = Σ w·m',
    inputs: [{ name: 'Years', value: '2024, 2025', source: 'measured' }, { name: 'Weighting', value: 'Observed hours', source: 'user' }],
    steps: [{ label: '2024 mean', work: '1,000 ÷ 10', value: '$100.00' }],
    result: { label: 'Mean', value: '$100.00/MWh' },
    check: { label: 'Σ contributions = headline', a: 100, b: 100 },
    csv: { name: 'hourly.csv', columns: ['t', 'p'], rows: [['2024-01-01T00:00', 12.5]] },
  });
  for (const s of ['Mean = Σ w·m', 'Years', 'Measured', 'Your input', '2024 mean', '1,000 ÷ 10', '$100.00/MWh', 'Reconciles']) assert.ok(html.includes(s), s);
  assert.ok(html.includes('data-act="trace-csv"') && html.includes('data-v="mean"'));
  assert.equal(csvFor('mean').text, 't,p\r\n2024-01-01T00:00,12.5\r\n');
  assert.equal(csvFor('mean').name, 'hourly.csv');
});

test('trace escapes HTML in every field', () => {
  resetTraces();
  const html = trace({ id: 'x', title: '<b>', formula: '<i>', inputs: [{ name: '<s>', value: '<u>', source: 'user' }], steps: [], result: { label: 'r', value: '<v>' } });
  for (const raw of ['<i>', '<s>', '<u>', '<v>']) assert.ok(!html.includes(raw), raw);
  for (const e of ['&lt;b&gt;', '&lt;i&gt;', '&lt;s&gt;', '&lt;u&gt;', '&lt;v&gt;']) assert.ok(html.includes(e), e);
});

test('a failed check is shown as a failure, not hidden', () => {
  resetTraces();
  const html = trace({ id: 'y', title: 't', formula: 'f', inputs: [], steps: [], result: { label: 'r', value: '1' }, check: { label: 'E+C+L = price', a: 50, b: 49 } });
  assert.ok(html.includes('Does not reconcile'));
});

test('several checks are all shown; one failure among passes is visible', () => {
  resetTraces();
  const html = trace({ id: 'z', title: 't', formula: 'f', inputs: [], steps: [], result: { label: 'r', value: '1' }, checks: [{ label: 'net', a: 1, b: 1 }, { label: 'energy balance', a: 2, b: 3 }] });
  assert.ok(html.includes('net') && html.includes('Reconciles') && html.includes('energy balance') && html.includes('Does not reconcile'));
});

test('absolute tolerance: a rounding bound in MW does not grow with the size of the numbers', () => {
  assert.equal(reconcile(1000, 1003, 1e-6, 5).status, 'pass');
  assert.equal(reconcile(1000, 1006, 1e-6, 5).status, 'fail');
});
