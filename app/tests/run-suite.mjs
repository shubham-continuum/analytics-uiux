// Full One Studio suite on an isolated test instance.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
// Starts a fake export service and `server.py --port 0` (ephemeral) with the unified DB read-only, points every
// test at it through GS_BASE, and runs: node unit tests, Python tests, the smokes, css-leak, chrome-parity
// (vs live :8103, read-only) and the grid all-bus gate. Never calls the real :5034.
//   node tests/run-suite.mjs [--only unit,py,smoke,gates] [--smokes smoke-a.mjs,smoke-b.mjs] [--db <path>]
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readdirSync, mkdtempSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { continuumAnswer } from './fake-continuum.mjs';
import { runStep } from './suite-step.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DB = path.resolve(arg('--db', path.join(APP, '..', '..', 'unified', 'ISONE_GridSense_unified.duckdb')));
const ONLY = new Set((arg('--only', 'unit,py,smoke,gates')).split(','));
const SMOKES = arg('--smokes', null) ? new Set(arg('--smokes').split(',')) : null; // a named subset of the smokes (a fix round's own run)
const SCRATCH = mkdtempSync(path.join(process.env.SUITE_SCRATCH || tmpdir(), 'gsone-suite-'));
const PY = process.env.PYTHON || 'python';

// Fake :5034: records requests. Continuum routes (/api/v2/…) replay tests/fixtures/continuum (tests/fake-continuum.mjs, unknown
// → 404 "nothing held here (fake)"); every other request (the export service) answers 200 with a tiny JSON body.
export const fakeHits = [];
const fake = http.createServer((req, res) => {
  fakeHits.push(`${req.method} ${req.url}`);
  const c = continuumAnswer(req.url);
  if (c) { res.writeHead(c.status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(c.body)); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"fake":true}');
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const fakePort = fake.address().port;

// The server logs every request. Its output goes to a FILE, never a pipe: a blocked event loop (the old spawnSync run)
// a pipe is then never drained, and once ~64 KB of request logs fill it the server blocks mid-response (the
// 2026-10-06 cascade where every smoke after smoke-allbus timed out).
let nServers = 0;
async function startServer() {
  const log = path.join(SCRATCH, `server-${++nServers}.log`);
  const fd = openSync(log, 'w');
  const p = spawn(PY, ['-u', 'server.py', '--port', '0', '--db', DB, '--export-target', `127.0.0.1:${fakePort}`, '--continuum-target', `127.0.0.1:${fakePort}`], { cwd: APP, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const t0 = Date.now();
  let url = null;
  while (!url) {
    if (p.exitCode != null) throw new Error(`server exited ${p.exitCode}:\n${readFileSync(log, 'utf8')}`);
    if (Date.now() - t0 > 60000) { p.kill(); throw new Error('server did not start:\n' + readFileSync(log, 'utf8')); }
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(readFileSync(log, 'utf8'));
    if (m) url = `http://127.0.0.1:${m[1]}`; else await new Promise(r => setTimeout(r, 200));
  }
  // Warm the shared endpoints so the smokes' 30 s page timeouts measure the app, not a cold DuckDB scan. The map/grid meta
  // opens the DB and hashes its schema on first use (2.6 s cold, 0.01 s warm, 2026-10-14): without it every smoke's first
  // page load (smoke-mapgrid's timed one) paid it inside "map ready".
  for (const q of ['/api/buses', '/api/screen', '/api/market', '/api/x/mapgrid/meta/all'])
    await new Promise((ok, no) => http.get(url + q, r => { r.resume(); r.on('end', ok); }).on('error', no));
  return { url, log, pid: p.pid, kill: () => p.kill() };
}
let srv = await startServer();
const base = srv.url;
console.log(`test server ${base} · fake export :${fakePort} · scratch ${SCRATCH}`);
// PIDs for a stop-BY-PID if this run is itself stopped (a killed parent leaves its children running on Windows):
// SCRATCH/suite-pids.json names this runner and the current test server; SCRATCH/current-step.json the running step.
const notePids = () => { try { writeFileSync(path.join(SCRATCH, 'suite-pids.json'), JSON.stringify({ suite: process.pid, server: srv.pid, serverUrl: srv.url })); } catch { /* progress only */ } };
notePids();
console.log(`suite pid ${process.pid} · server pid ${srv.pid} · pids ${path.join(SCRATCH, 'suite-pids.json')}`);
// Ctrl+C / a polite stop: stop the running step and the test server BY PID before exiting (a hard kill skips this; use the files above).
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, () => {
  try { process.kill(JSON.parse(readFileSync(path.join(SCRATCH, 'current-step.json'), 'utf8')).pid); } catch { /* no step running */ }
  try { process.kill(srv.pid); } catch { /* already gone */ }
  let n = 0; try { n = results.length; } catch { /* before the first step */ }
  console.log(`STOPPED by ${sig}: ${n} step(s) reported`); process.exit(130);
});
// GS_DB: smoke-continuum starts one more server.py --port 0 on this DB with a dead Continuum target (the "service down" banner).
const env = { ...process.env, GS_BASE: base, SUITE_SCRATCH: SCRATCH, GS_DB: DB };

const results = [];
// fix-2: async, never spawnSync. The fake :5034 above lives in THIS process: a spawnSync blocked its event loop for the
// whole test, so every Continuum proxy call hung until the client gave up ("service offline") and smoke-continuum
// could never read the fixture replay. On timeout the child is killed BY PID.
// fix-3 (2026-10-14): a report forced inside the first step read "no step results" (the 71 s unit step printed nothing
// until it ended). runStep (tests/suite-step.mjs) prints START (pid, timeout, step log) at once, a heartbeat with the last
// output line every 30 s, and TIMEOUT when it stops a step; each step's output streams to its own log in SCRATCH.
async function run(label, cmd, args, opts = {}) {
  const t0 = Date.now();
  const r = await runStep({ label, cmd, args, cwd: APP, env: { ...env, ...(opts.env || {}) }, timeout: opts.timeout || 420000, logDir: SCRATCH });
  const ok = r.status === 0;
  const L = r.text.trim().split('\n'), early = ok ? [] : L.slice(0, -25).filter(l => /\bFAIL\b|not ok|✖/.test(l)); // a failure above the last 25 lines is still printed
  const tail = [...early, ...L.slice(-(ok ? 2 : 25))].join('\n');
  results.push({ label, ok, s: ((Date.now() - t0) / 1000).toFixed(0) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} (${results.at(-1).s}s)\n${tail.replace(/^/gm, '   ')}`);
  return ok;
}

try {
  const T = path.join(APP, 'tests');
  if (ONLY.has('unit')) {
    const files = readdirSync(T).filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests', f));
    await run(`node unit (${files.length} files)`, process.execPath, ['--test', '--test-reporter=dot', ...files]);
    await run('node unit TZ=America/New_York (tz)', process.execPath, ['--test', 'tests/tz.test.mjs'], { env: { TZ: 'America/New_York' } });
  }
  // 176 DuckDB-backed tests over the full unified DB: 178 s on a quiet machine, 813 s with parallel agents loading it
  // (2026-10-14; test_pricelink's fleet snapshots are the slowest). Every test still runs; only the hang guard is longer.
  if (ONLY.has('py')) await run('python tests', PY, ['-m', 'pytest', '-q', 'tests'], { timeout: 1200000 });
  if (ONLY.has('smoke')) {
    // smoke-traces is a parameterised tool (`<page> <tab:id,...>`), run by each dashboard's own gate; it has no default run.
    // Smokes whose full run is longer than the 420 s default (every step still runs): desync is 3 seeds × 500 actions, measured
    // 208-588 s per seed (M3.md); econ-trace walks every Economics trace on every fuel; oneurl opens 25 links twice, each
    // waiting for its hash to settle (202 s quiet, past 420 s with parallel agents, 2026-10-14).
    const LONG_SMOKES = { 'smoke-desync.mjs': 2400000, 'smoke-econ-trace.mjs': 1200000, 'smoke-oneurl.mjs': 1200000 };
    // Lift plan 14 (round-1 integrator): smoke-projects (L1), smoke-configurator (L3) and smoke-continuum (L4) run here by name
    // like every smoke-*.mjs; smoke-continuum reads the fake's fixture replay above.
    const SKIP = { 'smoke-traces.mjs': 'parameterised tool, needs <page> <tab:id,...>; covered by smoke-prices-trace / smoke-econ-trace' };
    for (const f of readdirSync(T).filter(f => /^smoke-.*\.mjs$/.test(f)).sort()) {
      if (SKIP[f]) { console.log(`SKIP ${f}: ${SKIP[f]}`); continue; }
      if (SMOKES && !SMOKES.has(f)) continue;
      // a fresh server per smoke: one smoke's load (or a hang) cannot cascade into the next
      srv.kill(); srv = await startServer(); notePids();
      await run(f, process.execPath, [path.join('tests', f)], { env: { GS_BASE: srv.url }, timeout: LONG_SMOKES[f] });
    }
  }
  if (ONLY.has('gates')) {
    await run('css-leak', process.execPath, ['tests/css-leak.mjs'], { env: { GS_BASE: srv.url } });
    await run('chrome-parity (vs live :8103, read-only)', process.execPath, ['tests/chrome-parity.mjs'], { env: { GS_BASE: srv.url } });
    const dump = path.join(SCRATCH, 'grid-allbus.json');
    if (await run('grid all-bus dump', PY, ['plan/dump_grid_allbus.py', '--db', DB, '--out', dump]))
      await run('gate-grid-allbus', process.execPath, ['--max-old-space-size=8192', 'tests/gate-grid-allbus.mjs', dump]);
  }
} finally {
  srv.kill(); fake.close();
}
// Known red: failing for a reason outside One Studio, recorded with date and owner. Still run, still printed as
// FAIL; only kept out of the exit code. Every entry needs a closing slice. Never add a One Studio regression here.
const KNOWN_RED = {
  'chrome-parity (vs live :8103, read-only)': '2026-10-06: the live Studio is being restyled by another session; the untouched preview (:8104) also fails (585/752). Closed by the M5 visual parity pass.',
};
const bad = results.filter(r => !r.ok && !KNOWN_RED[r.label]);
const known = results.filter(r => !r.ok && KNOWN_RED[r.label]);
console.log(`\n${results.length - bad.length - known.length}/${results.length} passed${known.length ? ` · KNOWN RED ${known.length}: ` + known.map(r => `${r.label} (${KNOWN_RED[r.label]})`).join('; ') : ''}${bad.length ? ' · FAILED: ' + bad.map(r => r.label).join(', ') : ''}`);
console.log(`fake :5034 hits: ${fakeHits.length}`);
process.exit(bad.length ? 1 : 0);
