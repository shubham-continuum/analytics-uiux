"""Record the dev-kit fixture set: every API response the app requests for the sample projects, as gzip JSON.

Provenance: Claude Opus 5.5 · one-studio-devkit/design/plan.md (T2, P1 Package) · 2026-10-09 · sign-off pending · v1
· LMP Continuum proxy answers (/api/proxy/continuum/..., kept with their query): lift plan 14 L5 · 2026-10-14 · v2
    python plan/export_fixtures.py --out <dir>                      (starts its own server: --port 0 --db <unified>)
    python plan/export_fixtures.py --db <unified.duckdb> --out <dir>
    python plan/export_fixtures.py --base http://127.0.0.1:8105 --out <dir>   (an already-running --db server, GET only)
1. Discover: a headless Chrome (Playwright pinned in one-studio/testenv) walks all 28 analyzers of every sample
   project x every option bus, every stage at every depth, the stage pages for the buses the tests pin, and the hub;
   every /api/* request is captured.
2. Complete: each bus-keyed endpoint seen in step 1 is also fetched for every option bus, test pin and the hub (kept
   only when the server answers 200), so a tab or depth the walk did not open still has its data; so are the literal
   API paths the browser tests GET themselves (e.g. /api/screen).
   The LMP Continuum tab is opened at every option bus and test pin and each of its workflow screens clicked; its
   /api/proxy/continuum/... requests (to the :5034 service, GET only) are kept by path AND query, inside the proxy's
   allow-list only, and are not completed (the answer depends on the query the panel sent).
3. Fetch each path from the --db server and store the body exactly as served (gzip JSON), with status, content type
   and sha256 of the JSON text in <out>/index.json. server.py --fixtures <out> replays it; tests/fixture-parity.mjs
   proves every recorded path equals the --db server.
Read-only throughout: the server opens the unified DuckDB read_only; this script only GETs.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DEFAULT_DB = APP.parents[1] / 'unified' / 'ISONE_GridSense_unified.duckdb'
TESTENV = APP.parents[0] / 'testenv' / 'package.json'
STAGES = ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision']
DEPTHS = ['screen', 'review', 'study']
API_X = re.compile(r'^/api/x/([a-z]{2,20})/([a-z0-9_]{2,40})/(all|hub|\d{1,9})$')
API_BUS = re.compile(r'^/api/bus/(hub|\d{1,9})$')
CONT_PREFIX = '/api/proxy/continuum'
CONT_ROUTE = re.compile(r'/api/v2/(?:scenarios(?:/[a-z0-9][a-z0-9_-]{0,63})*|continuum(?:/[a-z0-9][a-z0-9_-]{0,63})+)')  # = server.py
CONT_QUERY = re.compile(r'[A-Za-z0-9_.~%+,:=&*-]{0,4000}')


def is_continuum(p):
    return p.startswith(CONT_PREFIX + '/')


def keep_path(p):
    """A path the fixture set records: the DB-backed API (no query), or an allowed Continuum proxy request with its query."""
    if is_continuum(p):
        up, _, q = p[len(CONT_PREFIX):].partition('?')
        return not any(x in up for x in ('..', '%', '\\', '//')) and bool(CONT_ROUTE.fullmatch(up)) and bool(CONT_QUERY.fullmatch(q))
    return bool(API_X.match(p) or API_BUS.match(p)) or p in ('/api/buses', '/api/screen', '/api/market')


# The headless walk. Written to a temp file and run with node; Playwright is loaded from one-studio/testenv.
DISCOVER_JS = r"""
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
const [base, cfgPath, outPath] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
const { chromium } = createRequire(cfg.testenv)('playwright');
const seen = new Map(), errors = [];
let inflight = 0, last = Date.now(), loads = 0;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const isApi = u => { try { return new URL(u).pathname.startsWith('/api/'); } catch { return false; } };
const key = u => { const x = new URL(u); return x.pathname.startsWith('/api/proxy/continuum/') ? x.pathname + x.search : x.pathname; };  // Continuum: + query
page.on('request', r => { if (isApi(r.url())) { inflight++; last = Date.now(); const p = key(r.url()); if (!seen.has(p)) seen.set(p, null); } });
const done = r => { if (isApi(r.url())) { inflight = Math.max(0, inflight - 1); last = Date.now(); } };
page.on('requestfinished', done); page.on('requestfailed', done);
page.on('response', r => { if (isApi(r.url())) seen.set(key(r.url()), r.status()); });
page.on('console', m => { if (m.type() === 'error') errors.push(`${page.url()} :: ${m.text()}`); });
page.on('pageerror', e => errors.push(`${page.url()} :: ${e}`));
async function settle(quiet = 700, max = 45000) {
  const t0 = Date.now();
  await page.waitForTimeout(150);
  while (Date.now() - t0 < max) { if (inflight === 0 && Date.now() - last > quiet) return; await page.waitForTimeout(100); }
}
async function go(url) { loads++; await page.goto(url, { waitUntil: 'load', timeout: 90000 }); await settle(); }
const shell = `${base}/analytics-analyzer-studio.html`;
// 1. the guided walk: every project x every option x all analyzers, through the app's own controls
await go(shell);
await page.waitForSelector('[data-act="sample"]', { timeout: 90000 });
for (const p of cfg.projects) {
  await page.selectOption('[data-act="sample"]', p.id);
  await page.waitForFunction(n => document.querySelector('.walk-name')?.textContent?.includes(n), p.name, { timeout: 90000 });
  await settle();
  for (const o of p.options) {
    if ((await page.locator('[data-act="sample-opt"]').inputValue()) !== o.id) {
      await page.selectOption('[data-act="sample-opt"]', o.id);
      await page.waitForFunction(id => document.querySelector('[data-act="sample-opt"]')?.value === id, o.id, { timeout: 90000 });
    }
    await settle();
    for (let k = 0; k < p.steps.length; k++) { await page.selectOption('select[data-act="walk"]', String(k)); loads++; await settle(); }
  }
}
// 2. every stage at every depth for every project option (Studio-parity hash, fresh page load each)
for (const p of cfg.projects) for (const o of p.options) for (const s of cfg.stages) for (const d of cfg.depths)
  if (o === p.options[0] || d === 'review') await go(`${shell}#v=stage&stage=${s}&project=${p.id}&option=${o.id}&depth=${d}`);
// 3. the buses the tests pin: every stage in the shell, and the standalone stage pages
for (const b of cfg.pins) for (const s of cfg.stages) await go(`${shell}#stage=${s}&bus=${b}`);
for (const s of cfg.stages) for (const t of cfg.tabs[s] || []) await go(`${base}/${s}.html#tab=${t}&bus=${cfg.pins[0]}`);
// 4. the LMP Continuum tab at every option bus and test pin: each workflow screen clicked (fresh page each: the client caches)
let contScreens = 0;
for (const b of cfg.contBuses) {
  await go(`${shell}#v=continuum&stage=prices&bus=${b}`);
  if (!(await page.waitForSelector('#gsc-root', { timeout: 150000 }).then(() => true, () => false))) { errors.push(`continuum ${b} :: #gsc-root never drew`); continue; }
  await settle(1500);
  const n = await page.locator('#gsc-root .gsc-wftab').count();
  for (let k = 0; k < n; k++) { await page.locator('#gsc-root .gsc-wftab').nth(k).click().catch(e => errors.push(`continuum ${b} tab ${k} :: ${e.message}`)); loads++; contScreens++; await settle(1500); }
}
await browser.close();
writeFileSync(outPath, JSON.stringify({ loads, contScreens, paths: [...seen].map(([path, status]) => ({ path, status })), consoleErrors: errors }, null, 1));
console.log(`discovered ${seen.size} api paths over ${loads} page states; ${errors.length} console errors`);
"""


def log(*a):
    print(*a, flush=True)


def test_pins():
    """Bus ids the browser tests pin (bus=, pins=, /api/... in tests/*.mjs that load pages; pure *.test.mjs unit tests
    and the Python tests use made-up ids), minus the deliberately missing 999999999."""
    out = set()
    for f in sorted((APP / 'tests').glob('*.mjs')):
        if f.name.endswith('.test.mjs') or f.name == 'fixture-parity.mjs':
            continue
        txt = f.read_text(encoding='utf-8', errors='replace')
        for m in re.finditer(r'(?:[?#&]bus=|pins=)(\d+(?:,\d+)*)', txt):
            out.update(m.group(1).split(','))
        for m in re.finditer(r'/api/(?:bus|x/[a-z]+/[a-z0-9_]+)/(\d+)', txt):
            out.add(m.group(1))
    out.discard('999999999')
    return sorted(out, key=int)


def test_paths():
    """Literal API paths the browser tests GET themselves (e.g. /api/screen), so the kit's smokes find them too."""
    out = set()
    for f in sorted((APP / 'tests').glob('*.mjs')):
        if f.name.endswith('.test.mjs') or f.name == 'fixture-parity.mjs':
            continue
        for m in re.finditer(r'/api/(?:buses|screen|market|bus/(?:hub|\d+)|x/[a-z]+/[a-z0-9_]+/(?:all|hub|\d+))\b', f.read_text(encoding='utf-8', errors='replace')):
            if '999999999' not in m.group(0):
                out.add(m.group(0))
    return out


def start_server(db, scratch):
    """server.py --port 0 --db, output to a FILE (a pipe fills and blocks the server). Returns (url, proc)."""
    logf = scratch / 'export-server.log'
    fd = open(logf, 'w')
    proc = subprocess.Popen([sys.executable, '-u', 'server.py', '--port', '0', '--db', str(db), '--export-target', '127.0.0.1:9'],
                            cwd=str(APP), stdout=fd, stderr=subprocess.STDOUT)
    fd.close()
    t0 = time.time()
    while time.time() - t0 < 90:
        if proc.poll() is not None:
            raise SystemExit(f'server exited {proc.returncode}: {logf.read_text()}')
        m = re.search(r'http://127\.0\.0\.1:(\d+)/', logf.read_text())
        if m:
            log(f'server pid {proc.pid} on :{m.group(1)} (log {logf})')
            return f'http://127.0.0.1:{m.group(1)}', proc
        time.sleep(0.2)
    proc.kill()
    raise SystemExit('server did not start: ' + logf.read_text())


def fetch(base, path, tries=3):
    """GET path; returns (status, content_type, gzip body, json text bytes)."""
    for k in range(tries):
        req = urllib.request.Request(base + path, headers={'Accept-Encoding': 'gzip'})
        try:
            try:
                r = urllib.request.urlopen(req, timeout=600)
                status, headers, raw = r.status, r.headers, r.read()
            except urllib.error.HTTPError as e:
                status, headers, raw = e.code, e.headers, e.read()
            gz = raw if headers.get('Content-Encoding') == 'gzip' else gzip.compress(raw, 6)
            text = gzip.decompress(gz)
            return status, (headers.get('Content-Type') or 'application/json').split(';')[0].strip(), gz, text
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            if k == tries - 1:
                raise
            log(f'  retry {path}: {type(e).__name__}')
            time.sleep(2)


def fname(path):
    if is_continuum(path):  # path + query: short, safe and unique per query (the sha of the full request)
        up = path[len(CONT_PREFIX) + len('/api/v2/'):].split('?')[0]
        return 'cont__' + re.sub(r'[^A-Za-z0-9_.-]', '_', up.replace('/', '__'))[:60] + '__' + hashlib.sha256(path.encode()).hexdigest()[:16] + '.json.gz'
    return re.sub(r'[^A-Za-z0-9_.-]', '_', path[len('/api/'):].replace('/', '__')) + '.json.gz'


def main():
    ap = argparse.ArgumentParser(description='Record the dev-kit fixture set (read-only).')
    src = ap.add_mutually_exclusive_group()
    src.add_argument('--base', help='an already-running --db server, e.g. http://127.0.0.1:8105 (GET only)')
    src.add_argument('--db', help=f'unified DuckDB for a server this script starts (default {DEFAULT_DB})')
    ap.add_argument('--out', required=True, help='fixture folder to (re)write')
    ap.add_argument('--samples', default=str(APP / 'data' / 'samples.json'))
    ap.add_argument('--node', default='node')
    ap.add_argument('--workers', type=int, default=3)
    a = ap.parse_args()
    out = Path(a.out).resolve()
    scratch = Path(tempfile.mkdtemp(prefix='gsone-export-'))
    samples = json.loads(Path(a.samples).read_text(encoding='utf-8'))
    projects = [{'id': p['id'], 'name': p['name'], 'options': [{'id': o['id'], 'busId': str(o['busId'])} for o in p['options']],
                 'steps': [{'stage': s['stage'], 'tab': s['tab']} for s in p['steps']]} for p in samples['projects']]
    tabs = {}
    for p in projects:
        for s in p['steps']:
            tabs.setdefault(s['stage'], [])
            if s['tab'] not in tabs[s['stage']]:
                tabs[s['stage']].append(s['tab'])
    option_buses = sorted({o['busId'] for p in projects for o in p['options']}, key=int)
    pins = test_pins()
    proc = None
    try:
        if a.base:
            base = a.base.rstrip('/')
        else:
            base, proc = start_server(Path(a.db or DEFAULT_DB).resolve(), scratch)
        health = json.loads(urllib.request.urlopen(base + '/health', timeout=30).read())
        if health.get('mode') == 'fixtures':
            raise SystemExit('refusing to record from a --fixtures server: record from a --db server')
        # 1. discover
        cfg = scratch / 'discover.json'
        cont_buses = option_buses + [b for b in pins if b not in option_buses]
        cfg.write_text(json.dumps({'testenv': str(TESTENV), 'projects': projects, 'stages': STAGES, 'depths': DEPTHS, 'tabs': tabs, 'pins': pins, 'contBuses': cont_buses}), encoding='utf-8')
        js = scratch / 'discover.mjs'
        js.write_text(DISCOVER_JS, encoding='utf-8')
        found = scratch / 'discovered.json'
        t0 = time.time()
        r = subprocess.run([a.node, str(js), base, str(cfg), str(found)], cwd=str(scratch), timeout=7200)
        if r.returncode != 0:
            raise SystemExit(f'discovery failed ({r.returncode})')
        disc = json.loads(found.read_text(encoding='utf-8'))
        log(f'discovery: {len(disc["paths"])} paths, {disc["loads"]} page states, {time.time() - t0:.0f}s')
        browser_paths = {d['path'] for d in disc['paths'] if keep_path(d['path'])}
        ignored = sorted({d['path'] for d in disc['paths']} - browser_paths)
        # 2. complete: bus-keyed endpoints x (option buses + test pins + hub)
        keys = option_buses + [b for b in pins if b not in option_buses] + ['hub']
        templates = set()
        for p in browser_paths:
            m = API_X.match(p)
            if m and m.group(3) != 'all':
                templates.add(f'/api/x/{m.group(1)}/{m.group(2)}/')
            elif API_BUS.match(p):
                templates.add('/api/bus/')
        extra = sorted(({t + k for t in templates for k in keys} | test_paths()) - browser_paths)
        # 3. fetch + store
        if out.exists():
            for f in out.glob('*.json.gz'):
                f.unlink()
        out.mkdir(parents=True, exist_ok=True)
        todo = [(p, 'browser') for p in sorted(browser_paths)] + [(p, 'completion') for p in extra]
        index_paths, skipped = {}, []
        t0 = time.time()

        def one(item):
            p, via = item
            return p, via, fetch(base, p)
        with cf.ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
            for n, (p, via, (status, ctype, gz, text)) in enumerate(ex.map(one, todo), 1):
                if via == 'completion' and status != 200:
                    skipped.append({'path': p, 'status': status})
                    continue
                f = fname(p)
                (out / f).write_bytes(gz)
                index_paths[p] = {'file': f, 'status': status, 'content_type': ctype, 'sha256': hashlib.sha256(text).hexdigest(),
                                  'bytes': len(text), 'gz_bytes': len(gz), 'via': via}
                if n % 50 == 0:
                    log(f'  {n}/{len(todo)} fetched ({time.time() - t0:.0f}s)')
        digest = hashlib.sha256(json.dumps(sorted((p, e['sha256'], e['status']) for p, e in index_paths.items())).encode()).hexdigest()
        now = dt.datetime.now(dt.timezone.utc)
        index = {
            'id': f'devkit-{now:%Y%m%d}-{digest[:12]}',
            'generatedAt': now.isoformat(timespec='seconds'),
            'generator': 'one-studio/app/plan/export_fixtures.py',
            'source': {'base': base, 'db': Path(health['db']).name if health.get('db') else None, 'db_mtime': health.get('db_mtime'), 'code': health.get('code')},
            'note': 'Each file is the gzip JSON body exactly as the --db server served it; sha256/bytes are of the decompressed JSON text. '
                    'Real ISO-NE public data for the sample projects\' option buses, the buses the tests pin and the hub; '
                    'any other path answers 404 {"error":"not in the dev-kit fixture set"}.',
            'discovery': {'projects': [p['id'] for p in projects], 'optionBuses': option_buses, 'testPins': pins, 'stages': STAGES, 'depths': DEPTHS,
                          'pageStates': disc['loads'], 'browserPaths': len(browser_paths), 'continuumBuses': cont_buses, 'continuumScreens': disc.get('contScreens', 0), 'completionKept': sum(1 for e in index_paths.values() if e['via'] == 'completion'),
                          'completionSkipped': skipped, 'ignoredRequests': ignored, 'consoleErrorsDuringDiscovery': disc['consoleErrors'][:50]},
            'continuum': {'target': health.get('continuum_target'), 'prefix': CONT_PREFIX, 'paths': sum(1 for p in index_paths if is_continuum(p)),
                          'ok': sum(1 for p, e in index_paths.items() if is_continuum(p) and e['status'] == 200),
                          'note': 'GET answers of the LMP Continuum service recorded through the One Studio proxy, keyed by path + query; '
                                  'server.py --fixtures replays them and never forwards.'},
            'count': len(index_paths),
            'totalBytes': sum(e['bytes'] for e in index_paths.values()),
            'totalGzBytes': sum(e['gz_bytes'] for e in index_paths.values()),
            'paths': dict(sorted(index_paths.items())),
        }
        (out / 'index.json').write_text(json.dumps(index, indent=1), encoding='utf-8')
        log(f'{index["count"]} fixtures ({index["totalGzBytes"] / 1e6:.1f} MB gzip, {index["totalBytes"] / 1e6:.1f} MB JSON) -> {out}  set {index["id"]}')
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(15)
            except subprocess.TimeoutExpired:
                proc.kill()
        shutil.rmtree(scratch, ignore_errors=True) if os.environ.get('GS_KEEP_SCRATCH') != '1' else log(f'scratch kept: {scratch}')


if __name__ == '__main__':
    main()
