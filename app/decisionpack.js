// Decision evidence pack (D3): one Excel-readable SpreadsheetML 2003 XML workbook, built in pure JS with no library.
// Sheets: Summary (options, gates, per-fuel verdict), Assumptions, Contents, then one sheet per registered trace, read
// from the trace's own CSV (trace.csvFor). Pure: no DOM, no fetch; the view supplies the rows and triggers the download.
// Rules: a not-held value is an empty cell, never 0; text is XML-escaped; sheet names obey Excel's limits.

const ok = v => typeof v === 'number' && Number.isFinite(v);
/** SpreadsheetML 2003 is safest below the legacy row limit; the full working stays in each trace's CSV. */
export const MAX_ROWS = 65000;

/** Escape for XML text and attributes; drop control characters XML 1.0 cannot carry (tab, LF and CR are kept). */
export const xmlEsc = s => String(s ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

/**
 * Excel sheet name: no [ ] : * ? / \, no leading or trailing apostrophe, 1–31 characters, not "History",
 * unique within the workbook (case-insensitive; `used` holds the lower-cased names already taken).
 */
export function sheetName(name, used = new Set()) {
  let base = String(name ?? '').replace(/[[\]:*?/\\]/g, ' ').replace(/[\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
  if (!base) base = 'Sheet';
  if (base.toLowerCase() === 'history') base = 'History (sheet)';
  base = base.slice(0, 31).trim();
  let out = base, i = 2;
  while (used.has(out.toLowerCase())) { const suf = ` (${i++})`; out = `${base.slice(0, 31 - suf.length).trim()}${suf}`; }
  used.add(out.toLowerCase());
  return out;
}

const NUM = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
/** Parse trace.csvFor text: leading "# key: value" provenance lines → meta; RFC 4180 body → rows. Empty cell → null;
 *  a plain numeric cell → Number (trace.toCsv prefixes text that starts with - = + @ with ', so it stays text). */
export function parseCsv(text) {
  const src = String(text ?? '');
  const meta = [];
  let i = 0;
  while (src.startsWith('#', i)) {
    const end = src.indexOf('\n', i), line = src.slice(i + 1, end < 0 ? src.length : end).replace(/\r$/, '').trim();
    const c = line.indexOf(':');
    meta.push(c < 0 ? [line, ''] : [line.slice(0, c).trim(), line.slice(c + 1).trim()]);
    i = end < 0 ? src.length : end + 1;
  }
  const rows = [];
  let row = [], cell = '', quoted = false, any = false;
  const push = () => { row.push(cell === '' ? null : NUM.test(cell) ? Number(cell) : cell); cell = ''; };
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; any = true; continue; }
    if (ch === ',') { push(); any = true; continue; }
    if (ch === '\r' && src[i + 1] === '\n') continue;
    if (ch === '\n') { push(); rows.push(row); row = []; any = false; continue; }
    cell += ch; any = true;
  }
  if (any || cell !== '' || row.length) { push(); rows.push(row); }
  return { meta, rows };
}

function cellXml(v, style) {
  const st = style ? ` ss:StyleID="${style}"` : '';
  if (v === null || v === undefined || v === '' || (typeof v === 'number' && !ok(v))) return `<Cell${st}/>`;
  if (typeof v === 'number') return `<Cell${st}><Data ss:Type="Number">${String(v)}</Data></Cell>`;
  return `<Cell${st}><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
}
/** sheets: [{ name, rows: [[cell]], header?: number of bold header rows }] → the workbook XML (names used as given). */
export function workbookXml(sheets) {
  const ws = sheets.map(s => `<Worksheet ss:Name="${xmlEsc(s.name)}"><Table>${(s.rows || []).map((r, i) => (r.length ? `<Row>${r.map(v => cellXml(v, i < (s.header || 0) ? 'h' : '')).join('')}</Row>` : '<Row/>')).join('')}</Table></Worksheet>`).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n'
    + '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">'
    + '<Styles><Style ss:ID="Default" ss:Name="Normal"><Font ss:FontName="Calibri" ss:Size="10"/></Style><Style ss:ID="h"><Font ss:FontName="Calibri" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#DCE3EC" ss:Pattern="Solid"/></Style></Styles>'
    + `${ws}</Workbook>`;
}

const cap = rows => (rows.length > MAX_ROWS ? [...rows.slice(0, MAX_ROWS - 1), [`Truncated: ${rows.length - (MAX_ROWS - 1)} more rows. The full working is in this calculation's CSV download.`]] : rows);

/**
 * The evidence pack. summary / assumptions: row arrays (first row = header). traces: [{ id, title, csv: {name, text} | null }].
 * Returns { xml, sheets: [names] }.
 */
export function buildPack({ summary = [], assumptions = [], traces = [], title = 'GridSense evidence pack' }) {
  const used = new Set(), sheets = [];
  const add = (name, rows, header = 1) => { const n = sheetName(name, used); sheets.push({ name: n, rows: cap(rows), header }); return n; };
  add('Summary', summary);
  add('Assumptions', assumptions);
  const contents = [['Sheet', 'Trace id', 'Calculation', 'CSV file', 'Rows']];
  const idx = sheets.length;
  sheets.push(null); used.add('contents');
  for (const t of traces) {
    const p = t.csv ? parseCsv(t.csv.text) : null;
    const rows = p ? [...p.meta.map(([k, v]) => [`# ${k}`, v]), ...(p.meta.length ? [[]] : []), ...p.rows] : [['No working registered for this calculation (it has no CSV).']];
    const header = p ? p.meta.length + (p.meta.length ? 2 : 1) : 0;
    const n = add(t.title || t.id, rows, header);
    contents.push([n, t.id, t.title || t.id, t.csv?.name ?? null, p ? p.rows.length - 1 : null]);
  }
  sheets[idx] = { name: 'Contents', rows: [[title], [], ...contents], header: 0 };
  return { xml: workbookXml(sheets), sheets: sheets.map(s => s.name) };
}

// ---------- per-fuel thresholds (Compare): where the user's entries live, and how each row is labelled ----------
const num = v => (v === '' || v == null ? null : Number(v));
/** User threshold entries: S.ui.decision.th (the contract) first, then the flat S.ui.dTh_<key> fields. Blank or
 *  non-numeric is not an entry. */
export function userThresholds(ui) {
  const out = {};
  for (const [k, v] of Object.entries(ui || {})) if (k.startsWith('dTh_')) { const n = num(v); if (ok(n)) out[k.slice(4)] = n; }
  for (const [k, v] of Object.entries(ui?.decision?.th || {})) { const n = num(v); if (ok(n)) out[k] = n; }
  return out;
}
const SOURCE_LABEL = { user: 'your input', assumption: 'assumption', derived: 'derived', 'not held': 'not held', 'not set': 'not set: open decision' };
/** Rows for the thresholds table and the Assumptions sheet: the value in force, its default and a source label. */
export function thresholdRows(th, keys) {
  return keys.map(k => { const t = th[k] || {}; return { key: k, label: t.label, unit: t.unit, value: ok(t.value) ? t.value : null, default: ok(t.default) ? t.default : null, source: t.source, sourceLabel: SOURCE_LABEL[t.source] || t.source || 'not held', note: t.note }; });
}
