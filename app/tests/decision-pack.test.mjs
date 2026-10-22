// Decision evidence pack (D3): a pure-JS SpreadsheetML 2003 workbook. Sheet names sanitised for Excel, XML escaped,
// one sheet per registered trace from its CSV, numbers typed as numbers, not-held cells left empty (never 0).
import test from 'node:test';
import assert from 'node:assert/strict';
import { xmlEsc, sheetName, parseCsv, workbookXml, buildPack, MAX_ROWS, thresholdRows, userThresholds } from '../decisionpack.js';
import { toCsv } from '../trace.js';

/** Minimal tag-balance check (no DOMParser in node): every opened element is closed in order. */
function balanced(xml) {
  const body = xml.replace(/<\?[^>]*\?>/g, '');
  const st = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z:]+)([^>]*?)(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) { if (st.pop() !== name) return false; } else st.push(name);
  }
  return st.length === 0;
}

test('xmlEsc escapes markup and strips characters XML 1.0 cannot carry', () => {
  assert.equal(xmlEsc('a & b < c > d " e \' f'), 'a &amp; b &lt; c &gt; d &quot; e &apos; f');
  assert.equal(xmlEsc('x\u0001y\u0008z\u000Bw'), 'xyzw');
  assert.equal(xmlEsc('tab\tnew\nline'), 'tab\tnew\nline');
  assert.equal(xmlEsc(null), '');
});

test('sheetName: no []:*?/\\, at most 31 characters, never empty, unique (case-insensitive)', () => {
  const used = new Set();
  const a = sheetName('Price [RT]: a/b*c?d\\e', used);
  assert.doesNotMatch(a, /[[\]:*?/\\]/);
  const long = sheetName('A very long calculation trace title that goes on and on', used);
  assert.ok(long.length <= 31, long);
  assert.equal(sheetName('', used), 'Sheet');
  const d1 = sheetName('Same name', used), d2 = sheetName('same NAME', used), d3 = sheetName('Same name', used);
  assert.equal(d1, 'Same name');
  assert.notEqual(d2.toLowerCase(), d1.toLowerCase());
  assert.notEqual(d3.toLowerCase(), d2.toLowerCase());
  const l1 = sheetName('x'.repeat(40), used), l2 = sheetName('x'.repeat(40), used);
  assert.ok(l1.length <= 31 && l2.length <= 31 && l1 !== l2);
  assert.doesNotMatch(sheetName("'quoted'", used), /^'|'$/);
  assert.notEqual(sheetName('History', used).toLowerCase(), 'history'); // reserved by Excel
});

test('parseCsv reads trace.toCsv output back: quotes, commas, CRLF, provenance lines, typed numbers', () => {
  const text = `# source: unified DB\r\n# note: a, b\r\n${toCsv(['name', 'value', 'text'], [['a, b', 1.5, '-x'], ['say "hi"', null, 'line\nbreak'], ['neg', -3, '=SUM(A1)']])}`;
  const p = parseCsv(text);
  assert.deepEqual(p.meta, [['source', 'unified DB'], ['note', 'a, b']]);
  assert.deepEqual(p.rows[0], ['name', 'value', 'text']);
  assert.deepEqual(p.rows[1], ['a, b', 1.5, "'-x"]);
  assert.deepEqual(p.rows[2], ['say "hi"', null, 'line\nbreak']);
  assert.deepEqual(p.rows[3], ['neg', -3, "'=SUM(A1)"]);
  assert.equal(p.rows.length, 4);
});

test('workbookXml: SpreadsheetML 2003, numbers as Number, text as String, blanks empty, names and text escaped', () => {
  const xml = workbookXml([{ name: 'A & B', rows: [['h1', 'h2'], [1, 'x<y'], [null, '']] }, { name: 'Second', rows: [] }]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<\?mso-application progid="Excel.Sheet"\?>/);
  assert.match(xml, /xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"/);
  assert.equal((xml.match(/<Worksheet /g) || []).length, 2);
  assert.match(xml, /ss:Name="A &amp; B"/);
  assert.match(xml, /<Data ss:Type="Number">1<\/Data>/);
  assert.match(xml, /<Data ss:Type="String">x&lt;y<\/Data>/);
  assert.doesNotMatch(xml, /<Data ss:Type="Number">0<\/Data>/, 'a blank is never written as 0');
  assert.match(xml, /<Row><Cell\/><Cell\/><\/Row>/);
  assert.ok(balanced(xml), 'tags balance');
});

test('workbookXml: non-finite numbers are left empty (not held), booleans become text', () => {
  const xml = workbookXml([{ name: 'S', rows: [[NaN, Infinity, true]] }]);
  assert.match(xml, /<Row><Cell\/><Cell\/><Cell><Data ss:Type="String">true<\/Data><\/Cell><\/Row>/);
});

test('buildPack: Summary, Assumptions, Contents, then one sheet per trace; a trace without working says so', () => {
  const traces = [
    { id: 'd-compare', title: 'Compare: revenue / limits', csv: { name: 'd.csv', text: `# basis: RT 2025\r\n${toCsv(['option', 'revenue'], [['A', 1e6], ['B', null]])}` } },
    { id: 'd-empty', title: 'Compare: revenue / limits', csv: null },
  ];
  const p = buildPack({ summary: [['Option', 'Verdict'], ['A', 'Hold']], assumptions: [['Input', 'Value', 'Source'], ['Capture ≥', 90, 'assumption']], traces });
  assert.deepEqual(p.sheets.slice(0, 3), ['Summary', 'Assumptions', 'Contents']);
  assert.equal(p.sheets.length, 5);
  assert.ok(p.sheets.every(n => n.length <= 31 && !/[[\]:*?/\\]/.test(n)), p.sheets.join('|'));
  assert.notEqual(p.sheets[3].toLowerCase(), p.sheets[4].toLowerCase());
  assert.match(p.xml, /<Data ss:Type="String"># basis<\/Data>/);
  assert.match(p.xml, /<Data ss:Type="Number">1000000<\/Data>/);
  assert.match(p.xml, /No working registered for this calculation/);
  assert.match(p.xml, /d-compare/); // Contents lists the trace id
  assert.ok(balanced(p.xml));
});

test('buildPack truncates a sheet at MAX_ROWS and says so (the full working stays in the trace CSV)', () => {
  const rows = Array.from({ length: MAX_ROWS + 10 }, (_, i) => [i]);
  const p = buildPack({ summary: [['x']], assumptions: [['y']], traces: [{ id: 't', title: 'Big', csv: { name: 'b.csv', text: toCsv(['i'], rows) } }] });
  const sheet = p.xml.split('<Worksheet ').at(-1);
  assert.equal((sheet.match(/<Row>/g) || []).length, MAX_ROWS);
  assert.match(sheet, /Truncated/);
});

test('userThresholds reads S.ui.decision.th first, then the flat dTh_<key> fields; blanks are not an entry', () => {
  assert.deepEqual(userThresholds({ decision: { th: { capture: 85 } }, dTh_capture: '70', dTh_tb4: '12', dTh_curtail: '' }), { capture: 85, tb4: 12 });
  assert.deepEqual(userThresholds({}), {});
  assert.deepEqual(userThresholds({ dTh_tb4: 'abc' }), {});
});

test('thresholdRows label a default "assumption" (or derived / not held) and an override "your input"', () => {
  const rows = thresholdRows({ capture: { label: 'Capture ratio ≥', unit: '%', value: 85, default: 90, source: 'user', note: 'n' }, tb4: { label: 'TB4 spread >', unit: '$/MWh', value: 10, default: 10, source: 'assumption', note: 'm' }, dcPrice: { label: 'LMP 2030 ≤', unit: '$/MWh', value: null, default: null, source: 'not held', note: 'x' } }, ['capture', 'tb4', 'dcPrice']);
  assert.deepEqual(rows.map(r => r.sourceLabel), ['your input', 'assumption', 'not held']);
  assert.equal(rows[0].value, 85);
  assert.equal(rows[0].default, 90);
  assert.equal(rows[2].value, null);
});
