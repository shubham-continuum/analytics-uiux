// Calculation trace: under every calculator, the formula, each input with its value and source, each
// step with the numbers substituted, the result, a reconciliation check against the headline, and a CSV
// of the working. Views build the spec from the same arrays they compute from (no hand-typed figures).
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const REG = new Map();
const SOURCES = { measured: ['good', 'Measured'], assumption: ['warn', 'Assumption'], user: ['', 'Your input'], derived: ['', 'Derived'], rule: ['', 'Tariff / rule'] };

/** Escaped formula; `x_h` renders h as a subscript (applied after escaping, so it cannot inject markup). */
const formula = f => esc(f).replace(/_([A-Za-z0-9]+)/g, '<sub>$1</sub>');

export function resetTraces() { REG.clear(); }
/** Every trace registered on the current render: [{ id, title, name }] (Decision's evidence pack reads csvFor(id) for each). */
export function listTraces() { return [...REG].map(([id, s]) => ({ id, title: s.title || id, name: s.name })); }

/** CSV text (RFC 4180, CRLF). Null/undefined = empty cell (not held). Text starting = + - @ is prefixed with ' (formula injection). */
export function toCsv(columns, rows) {
  const cell = v => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v);
    if (/^\s*[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Two computations of the same number agree within a relative tolerance. */
export function reconcile(a, b, tol = 1e-6, atol = null) {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return { status: 'unknown', diff: null };
  // atol (absolute) when given, e.g. a derived rounding bound in MW; otherwise tol relative to the larger magnitude.
  const diff = a - b, ok = atol != null ? Math.abs(diff) <= atol : Math.abs(diff) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  return { status: ok ? 'pass' : 'fail', diff };
}

/** Provenance lines (# key: value) precede the header; pandas reads them with comment='#'. */
export function csvFor(id) {
  const s = REG.get(id); if (!s) return null;
  const meta = (s.meta || []).map(([k, v]) => `# ${String(k).replace(/[\r\n]/g, ' ')}: ${String(v ?? '').replace(/[\r\n]/g, ' ')}\r\n`).join('');
  return { name: s.name, text: meta + toCsv(s.columns, typeof s.rows === 'function' ? s.rows() : s.rows) };
}

/** Browser: download the registered CSV (local preview page; no network). */
export function downloadCsv(id) {
  const c = csvFor(id); if (!c) return false;
  const url = URL.createObjectURL(new Blob([c.text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = c.name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

/**
 * spec: { id, title, formula, inputs:[{name,value,unit?,source,note?}], steps:[{label,work,value}],
 *         result:{label,value}, check?:{label,a,b,tol?,fmt?}, checks?:[same], csv?:{name,columns,rows|()=>rows,note?}, notes?:[string], open? }
 */
export function trace(spec) {
  const src = s => { const [tone, label] = SOURCES[s] || ['', s || '—']; return `<span class="pill ${tone}">${esc(label)}</span>`; };
  const inputs = spec.inputs?.length ? `<table class="trace-t"><thead><tr><th>Input</th><th class="num">Value</th><th>Source</th><th>Note</th></tr></thead><tbody>${spec.inputs.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${esc(i.value)}${i.unit ? ` <span class="muted">${esc(i.unit)}</span>` : ''}</td><td>${src(i.source)}</td><td class="wrap">${esc(i.note || '')}</td></tr>`).join('')}</tbody></table>` : '';
  const steps = spec.steps?.length ? `<table class="trace-t"><thead><tr><th>#</th><th>Step</th><th>Working</th><th class="num">Value</th></tr></thead><tbody>${spec.steps.map((s, i) => `<tr><td>${i + 1}</td><td class="wrap">${esc(s.label)}</td><td class="wrap trace-work">${esc(s.work)}</td><td class="num">${esc(s.value)}</td></tr>`).join('')}</tbody></table>` : '';
  const check = [...(spec.check ? [spec.check] : []), ...(spec.checks || [])].map(k => {
    const r = reconcile(k.a, k.b, k.tol, k.atol), f = k.fmt || (v => (typeof v === 'number' ? v.toFixed(4) : 'not held'));
    const txt = { pass: ['good', 'Reconciles'], fail: ['warn', 'Does not reconcile'], unknown: ['', 'Cannot check (value not held)'] }[r.status];
    return `<div class="trace-check"><span class="pill ${txt[0]}">${txt[1]}</span> ${esc(k.label)}: ${esc(f(k.a))} vs ${esc(f(k.b))}${r.status === 'fail' ? ` (difference ${esc(f(r.diff))})` : ''}</div>`;
  }).join('');
  let csv = '';
  if (spec.csv) {
    REG.set(spec.id, { ...spec.csv, title: spec.title });
    const n = typeof spec.csv.rows === 'function' ? null : spec.csv.rows.length;
    csv = `<div class="trace-csv"><button type="button" class="tiny" data-act="trace-csv" data-v="${esc(spec.id)}">Download working (CSV${n != null ? `, ${n.toLocaleString('en-US')} rows` : ''})</button><span class="audit-note" style="margin:0">${esc(spec.csv.note || 'Empty cells are values not held, never zero.')}</span></div>`;
  }
  const notes = spec.notes?.length ? `<ul class="trace-notes">${spec.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
  return `<details class="trace" ${spec.open ? 'open' : ''} data-trace="${esc(spec.id)}"><summary><span>Calculation: ${esc(spec.title)}</span><span class="trace-result">${esc(spec.result?.label)} = <b>${esc(spec.result?.value)}</b></span></summary>
    <div class="trace-body"><div class="trace-formula">${formula(spec.formula)}</div>
    ${inputs ? `<h4>Inputs</h4>${inputs}` : ''}${steps ? `<h4>Steps</h4>${steps}` : ''}
    <div class="trace-final">${esc(spec.result?.label)} = <b>${esc(spec.result?.value)}</b></div>${check}${notes}${csv}</div></details>`;
}
