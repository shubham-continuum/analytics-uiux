// Dev-kit fixture parity: every recorded path served by `server.py --fixtures` equals the `--db` server's response.
// Provenance: Claude Opus 5.5 · one-studio-devkit/design/plan.md (T2, P1 Package) · 2026-10-09 · sign-off pending · v1
// · L5 (lift plan 14) 2026-10-14 v2: LMP Continuum proxy paths (/api/proxy/continuum/..., with query) are in the set. The
//   fixtures server gets a dead --continuum-target, so only a replayed answer can equal the --db server's (which proxies
//   to the Continuum service, GET only); an unrecorded Continuum request must be the fixture 404, not a forward.
// Starts two ephemeral servers (output to files, stopped by their own PIDs): this app on --db (unified DuckDB, read-only)
// and --fixtures <dir>. For every path in <dir>/index.json: same status, and the JSON bodies are deep-equal (text equal
// for a non-JSON body); the stored sha256 still matches. Also: an unknown path is the 404 JSON, /health says fixtures.
// · parity-5034 fix 2026-10-14 v3: never the real :5034. The --db server's --continuum-target is an in-process fake that
//   replays this set's recorded Continuum answers (gzip body + status, keyed by path + query; unrecorded = 404), so the
//   165 Continuum paths are a REPLAY-INTEGRITY check (the proxy passes the recorded answer through unchanged), reported
//   apart from the DB parity of every other path. Every spawned server gets explicit export and Continuum targets, and
//   any :5034 target is refused (exit 2) before a server starts.
//   node tests/fixture-parity.mjs [--fixtures <dir>] [--fx-app <app dir to run the fixtures server from>] [--db <path>]
//        [--continuum-fake <host:port> (an external fake instead of the in-process one)] [--dry-run (print the server args, start nothing)]
import { spawn } from 'node:child_process';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { openSync, closeSync, readFileSync, mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FIX = path.resolve(arg('--fixtures', path.join(APP, '..', '..', 'one-studio-devkit', 'app', 'fixtures')));
const FX_APP = path.resolve(arg('--fx-app', APP));
const DB = path.resolve(arg('--db', path.join(APP, '..', '..', 'unified', 'ISONE_GridSense_unified.duckdb')));
const PY = process.env.PYTHON || 'python';
const SCRATCH = mkdtempSync(path.join(process.env.SUITE_SCRATCH || tmpdir(), 'gsone-fxparity-'));
const index = JSON.parse(readFileSync(path.join(FIX, 'index.json'), 'utf8'));
const CONT = '/api/proxy/continuum';
const isCont = p => p.startsWith(CONT + '/');

// The --db server's Continuum target: replays this set's recorded answers byte for byte (the proxy forwards
// Content-Encoding, so the gzip file goes out as stored). Never forwards anywhere.
const fakeHits = [];
const fake = http.createServer((req, res) => {
  fakeHits.push(req.url);
  const e = req.method === 'GET' ? index.paths[CONT + req.url] : null;
  if (!e) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'nothing held here (fixture-parity fake)' })); return; }
  const b = readFileSync(path.join(FIX, e.file));
  res.writeHead(e.status ?? 200, { 'Content-Type': e.content_type || 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': b.length }); res.end(b);
});
const external = arg('--continuum-fake', null);
let fakeTarget = external;
if (!external) { await new Promise(r => fake.listen(0, '127.0.0.1', r)); fakeTarget = `127.0.0.1:${fake.address().port}`; }
const DEAD = '127.0.0.1:9';
// Every target explicit, none the real :5034 (server.py's default for both): refused before anything starts.
function guardTargets(name, args) {
  for (const k of ['--export-target', '--continuum-target']) {
    const i = args.indexOf(k), v = i >= 0 ? String(args[i + 1] ?? '') : '';
    if (!v || /:5034$/.test(v)) { console.error(`refused: ${name} server ${k} ${v || '(default 127.0.0.1:5034)'}: tests never touch the real :5034`); fake.close(); process.exit(2); }
  }
  return args;
}
const DB_ARGS = guardTargets('db', ['--db', DB, '--export-target', DEAD, '--continuum-target', fakeTarget]);
const FX_ARGS = guardTargets('fixtures', ['--fixtures', FIX, '--export-target', DEAD, '--continuum-target', DEAD]); // never forwards
if (process.argv.includes('--dry-run')) { console.log(JSON.stringify({ db: DB_ARGS, fixtures: FX_ARGS, fakePort: external ? null : fake.address().port })); fake.close(); process.exit(0); }

async function start(cwd, args, name) {
  const log = path.join(SCRATCH, `${name}.log`);
  const fd = openSync(log, 'w');
  const p = spawn(PY, ['-u', 'server.py', '--port', '0', ...args], { cwd, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const t0 = Date.now();
  for (;;) {
    if (p.exitCode != null) throw new Error(`${name} exited ${p.exitCode}:\n${readFileSync(log, 'utf8')}`);
    if (Date.now() - t0 > 90000) { p.kill(); throw new Error(`${name} did not start`); }
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(readFileSync(log, 'utf8'));
    if (m) return { url: `http://127.0.0.1:${m[1]}`, pid: p.pid, kill: () => p.kill() };
    await new Promise(r => setTimeout(r, 200));
  }
}
// node:http, not fetch: undici asserts (`!this.paused`) when an HTTP/1.0 server closes the socket mid-way through a
// multi-MB body. Bodies are gunzipped here.
const get = (base, p) => new Promise((ok, no) => {
  const req = http.get(base + p, { headers: { 'Accept-Encoding': 'gzip' }, timeout: 600000 }, r => {
    const parts = [];
    r.on('data', c => parts.push(c));
    r.on('end', () => {
      try {
        const raw = Buffer.concat(parts), enc = r.headers['content-encoding'] || null;
        const text = (enc === 'gzip' ? gunzipSync(raw) : raw).toString('utf8');
        const json = /json/.test(r.headers['content-type'] || '') ? (() => { try { return JSON.parse(text); } catch { return undefined; } })() : undefined;
        ok({ status: r.statusCode, text, json, enc });
      } catch (e) { no(e); }
    });
    r.on('error', no);
  });
  req.on('timeout', () => req.destroy(new Error(`timeout ${p}`)));
  req.on('error', no);
});

// The one volatile field: the Continuum service's own in-process cache counters on /status (hits/misses move with every
// request, they are not data). Dropped from both sides before the deep-equal; the stored sha256 is still checked exactly.
const VOLATILE = { '/api/proxy/continuum/api/v2/continuum/status': ['cache'] };
const steady = (p, j) => { const ks = VOLATILE[p.split('?')[0]]; if (!ks || !j || typeof j !== 'object') return j; const o = { ...j }; ks.forEach(k => delete o[k]); return o; };
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); return ok; };
const kids = [];
process.on('exit', () => kids.forEach(k => { try { k.kill(); } catch {} }));  // even on a crash, stop our own servers (by PID)
const dbs = await start(APP, DB_ARGS, 'db'); kids.push(dbs);
const fxs = await start(FX_APP, FX_ARGS, 'fixtures'); kids.push(fxs);
console.log(`db server ${dbs.url} (pid ${dbs.pid}, Continuum → replay fake ${fakeTarget}) · fixtures server ${fxs.url} (pid ${fxs.pid}) · set ${index.id} · ${Object.keys(index.paths).length} paths`);
try {
  const h = await get(fxs.url, '/health');
  check(h.json?.mode === 'fixtures' && h.json?.fixture_set === index.id, `health: ${h.text}`);
  const miss = await get(fxs.url, '/api/bus/999999998');
  check(miss.status === 404 && isDeepStrictEqual(miss.json, { error: 'not in the dev-kit fixture set', path: '/api/bus/999999998' }), `unknown path: ${miss.status} ${miss.text}`);
  const contMiss = '/api/proxy/continuum/api/v2/continuum/status?l5=not-recorded';
  const cm = await get(fxs.url, contMiss);
  check(cm.status === 404 && isDeepStrictEqual(cm.json, { error: 'not in the dev-kit fixture set', path: contMiss }), `unrecorded Continuum request: ${cm.status} ${cm.text.slice(0, 200)}`);
  const paths = Object.keys(index.paths);
  console.log(`  ${paths.filter(p => p.startsWith('/api/proxy/continuum/')).length} of them Continuum proxy answers`);
  let n = 0, equal = 0, contEqual = 0;
  const work = paths.slice();
  async function worker() {
    for (let p = work.shift(); p; p = work.shift()) {
      const e = index.paths[p];
      const [a, b] = await Promise.all([get(dbs.url, p), get(fxs.url, p)]);
      const sha = createHash('sha256').update(Buffer.from(b.text, 'utf8')).digest('hex');
      let ok = check(a.status === b.status && b.status === e.status, `${p}: status db ${a.status} fixtures ${b.status} recorded ${e.status}`);
      ok = check(b.enc === 'gzip', `${p}: fixtures response not gzip`) && ok;
      ok = check(sha === e.sha256, `${p}: stored file no longer matches its sha256`) && ok;
      ok = check(a.json !== undefined || b.json !== undefined ? isDeepStrictEqual(steady(p, a.json), steady(p, b.json)) : a.text === b.text, `${p}: body differs from the --db server`) && ok;
      if (ok) { equal++; if (isCont(p)) contEqual++; }
      if (++n % 100 === 0) console.log(`  ${n}/${paths.length}`);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const nCont = paths.filter(isCont).length;
  console.log(`DB parity: ${equal - contEqual}/${paths.length - nCont} recorded paths equal to the --db server`);
  console.log(`Continuum replay integrity: ${contEqual}/${nCont} proxied through the --db server to the replay fake unchanged (not a live check: :5034 is never called)`);
  if (!external) check(fakeHits.length >= nCont, `the replay fake saw ${fakeHits.length} requests, expected >= ${nCont}`);
} finally {
  dbs.kill(); fxs.kill(); fake.close();
}
for (const f of failures.slice(0, 40)) console.log(`FAIL ${f}`);
console.log(failures.length ? `${failures.length} FAILED` : 'ALL PASS');
process.exit(failures.length ? 1 : 0);
