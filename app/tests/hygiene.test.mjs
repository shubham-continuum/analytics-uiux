// Hygiene gates (M0): parameterised SQL only; provenance header on every One Studio file; REGISTER.md == rules JSON.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ls = (dir, re) => existsSync(path.join(APP, dir)) ? readdirSync(path.join(APP, dir)).filter(f => re.test(f)).map(f => path.join(dir, f)) : [];

// --- 1. SQL: no f-string / %-format / concatenation building SQL text in the data layer -------------------
const SQL_FILES = [...ls('.', /^(api_.*|busdata)\.py$/), ...ls('plan', /\.py$/)];
const SQL_WORD = /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|JOIN)\b/;
// A known-safe pattern: column lists interpolated from a fixed in-code tuple (no user input). Each must be listed.
const ALLOW = new Set(readFileSync(path.join(APP, 'tests', 'sql-allow.txt'), 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#')));

test('SQL is parameterised: no f-string, %-format or + concatenation into SQL text', () => {
  const hits = [];
  for (const f of SQL_FILES) {
    readFileSync(path.join(APP, f), 'utf8').split('\n').forEach((line, i) => {
      // the f-literal itself must hold SQL words and an interpolation (an f-string in the params list is fine)
      const fstr = [...line.matchAll(/\bf('''|"""|'|")(.*?)(?:\1|$)/g)].some(m => SQL_WORD.test(m[2]) && /\{[^}]+\}/.test(m[2]));
      // Python %-format: a closing quote, whitespace, then % (strftime '%Y' inside SQL text is not formatting)
      const pct = SQL_WORD.test(line) && /["']\s+%\s*[(\w]/.test(line);
      const fmt = SQL_WORD.test(line) && /\.format\(/.test(line);
      if ((fstr || pct || fmt) && !ALLOW.has(`${f.replace(/\\/g, '/')}:${line.trim()}`)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, [], 'SQL built from strings; bind parameters, or add a reviewed line to tests/sql-allow.txt');
});

// --- 2. Provenance header on every file One Studio adds (the forked preview files predate the rule) -------------
const PROV = JSON.parse(readFileSync(path.join(APP, 'tests', 'provenance-files.json'), 'utf8'));
test('every One Studio file carries a provenance header', () => {
  const missing = PROV.files.filter(f => existsSync(path.join(APP, f)) && !/Provenance:/.test(readFileSync(path.join(APP, f), 'utf8').slice(0, 1500)));
  assert.deepEqual(missing, []);
});
test('provenance list covers every new top-level module (frame, bridge, inspector, mapgrid)', () => {
  const required = ['server.py', 'tests/run-suite.mjs', 'tests/env.mjs', 'plan/dump_grid_allbus.py'];
  for (const r of required) assert.ok(PROV.files.includes(r), r);
  for (const f of [...ls('.', /^(frame|live-bridge|api_mapgrid)\.(js|py)$/), ...ls('views', /^inspector\.js$/), ...ls('plan', /^(build_mapgrid|mapgrid_parity|vendor_live)\.py$/)])
    assert.ok(PROV.files.includes(f.replace(/\\/g, '/')), `${f} missing from tests/provenance-files.json`);
});

// --- 3. REGISTER.md equals rules/isone-2026.json (M0 layout: one file; S2b moves this to the generated folder) ---
const REG = path.resolve(APP, '..', '..', 'v8-isone-complete', 'research', 'REGISTER.md');
const RULES = JSON.parse(readFileSync(path.join(APP, 'rules', 'isone-2026.json'), 'utf8'));
function leaves(o, out = []) {
  if (Array.isArray(o)) o.forEach(v => leaves(v, out));
  else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => { if (!k.startsWith('_')) leaves(v, out); });
  else if (typeof o === 'number') out.push(o);
  return out;
}
const NUMS = leaves(RULES);
// equal at the REGISTER's displayed precision (177.63 shown for 177.62722 stored)
const has = (x, dp = 0) => NUMS.some(n => Math.abs(n - x) <= 0.5 * 10 ** -dp + 1e-9 * Math.max(1, Math.abs(x)));
const EXC = JSON.parse(readFileSync(path.join(APP, 'tests', 'register-exceptions.json'), 'utf8')).exceptions;
function registerNumbers(cell) {
  // "$50k", "$2M", "$3,500", "5%", "0.9", "2027-10-15" (dates and section refs are skipped)
  const out = [];
  const clean = cell.replace(/\*\*/g, '').replace(/\d{4}-\d{2}-\d{2}/g, ' ').replace(/§\s*[\d.()a-z]+/gi, ' ')
    .replace(/\b(?:S|Sched|Schedule|Order|FERC|EL|ER)\s*\d+[\w-]*/gi, ' ').replace(/\b(19|20)\d{2}\b/g, ' ');
  for (const m of clean.matchAll(/\$?\s?(\d[\d,]*(?:\.(\d+))?)\s*(k(?![VWm])|M(?![WV])|bn)?\s*(%|¢)?/g)) {
    let v = Number(m[1].replace(/,/g, '')); if (!Number.isFinite(v)) continue;
    let dp = (m[2] || '').length;
    if (m[3] === 'k') { v *= 1e3; dp = Math.max(0, dp - 3); } else if (m[3] === 'M') { v *= 1e6; dp = 0; } else if (m[3] === 'bn') { v *= 1e9; dp = 0; }
    out.push({ raw: m[0].trim(), v, dp, pct: m[4] === '%', cent: m[4] === '¢' });
  }
  return out;
}
test('REGISTER.md: every adopted number exists in rules/isone-2026.json, and every row has a status', { skip: existsSync(REG) ? false : 'REGISTER.md not found' }, () => {
  const rows = readFileSync(REG, 'utf8').split('\n').filter(l => /^\|/.test(l) && !/^\|\s*-/.test(l) && !/^\|\s*Item\s*\|/.test(l));
  const STATUS = /\b(verified|corrected|assumption|pending|contingent|unverifiable|decided)\b/i;
  const drift = [], nostatus = [];
  for (const r of rows) {
    const cells = r.split('|').map(s => s.trim());
    const [item, adopted, status] = [cells[1], cells[2], cells[3]];
    if (!item || !adopted) continue;
    if (!STATUS.test(status || '')) nostatus.push(item);
    // "(the review said $68.63)" is a rejected counter-value, not an adopted one
    for (const n of registerNumbers(adopted.replace(/\(the review said[^)]*\)/gi, ' '))) {
      const ok = has(n.v, n.dp) || (n.pct && has(n.v / 100, n.dp + 2)) || (n.cent && has(n.v / 100, n.dp + 2));
      if (!ok && n.v > 1 && !EXC[`${item}: ${n.raw}`]) drift.push(`${item}: ${n.raw}`);
    }
  }
  assert.deepEqual(nostatus, [], 'REGISTER rows without a status');
  assert.deepEqual(drift, [], 'REGISTER numbers with no equal value in rules/isone-2026.json (two homes drifted)');
});

// --- 4. S2b: the merged rules file is generated from the domain files (one writer per domain) -------------------
import { spawnSync as _spawn } from 'node:child_process';
test('rules/isone-2026.json is exactly what rules/build.mjs produces from rules/isone-2026/*.json', () => {
  const r = _spawn(process.execPath, ['rules/build.mjs', '--check'], { cwd: APP, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
