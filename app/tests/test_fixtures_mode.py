"""server.py --fixtures contract (dev kit P1): recorded JSON instead of DuckDB.

Provenance: Claude Opus 5.5 · one-studio-devkit/design/plan.md (T2, P1 Package) · 2026-10-09 · sign-off pending · v1
Builds a tiny fixture set in a temp folder and runs the server on an ephemeral port (--port 0); never touches
:8103/:8104/:8105/:8106 or :5034. Server output goes to a file, never a pipe.
"""
import gzip
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DB = APP.parents[1] / 'unified' / 'ISONE_GridSense_unified.duckdb'

BUS = {'nodeId': '111403', 'name': 'fixture bus', 'value': None, 'list': [1.5, 2, None]}
MAPGRID_STALE = {'status': 503, 'error': 'stale generation'}


def make_set(root, paths=None, set_id='test-set-1'):
    """Write a fixture set: <root>/index.json + gzip JSON files. paths: {api path: (status, obj)}."""
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    paths = paths or {'/api/bus/111403': (200, BUS), '/api/x/mapgrid/bus/111403': (503, MAPGRID_STALE)}
    index = {'id': set_id, 'generator': 'tests/test_fixtures_mode.py', 'source': {'db': 'test.duckdb', 'db_mtime': '2026-10-01T00:00:00+00:00'}, 'paths': {}}
    for i, (p, (status, obj)) in enumerate(paths.items()):
        raw = json.dumps(obj, separators=(',', ':')).encode()
        name = f'f{i}.json.gz'
        (root / name).write_bytes(gzip.compress(raw))
        index['paths'][p] = {'file': name, 'status': status, 'content_type': 'application/json', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
    (root / 'index.json').write_text(json.dumps(index), encoding='utf-8')
    return index


class Server:
    """server.py on --port 0 with output to a file; stopped by its own PID."""

    def __init__(self, *args, pre=None):
        self.log = Path(tempfile.mkdtemp(prefix='gsone-fx-')) / 'server.log'
        fd = open(self.log, 'w')
        if pre:  # run server.py as __main__ after a guard statement (e.g. block an import)
            code = f"{pre}\nimport runpy,sys\nsys.argv=['server.py',*{list(args)!r}]\nrunpy.run_path('server.py',run_name='__main__')"
            cmd = [sys.executable, '-u', '-c', code]
        else:
            cmd = [sys.executable, '-u', str(APP / 'server.py'), *args]
        self.proc = subprocess.Popen(cmd, cwd=str(APP), stdout=fd, stderr=subprocess.STDOUT)
        fd.close()
        self.port = None
        t0 = time.time()
        while time.time() - t0 < 30 and self.port is None:
            if self.proc.poll() is not None:
                raise AssertionError(f'server exited {self.proc.returncode}: {self.log.read_text()}')
            m = re.search(r'http://127\.0\.0\.1:(\d+)/', self.log.read_text())
            if m:
                self.port = int(m.group(1))
            else:
                time.sleep(0.1)
        if self.port is None:
            self.stop()
            raise AssertionError('server did not announce its port: ' + self.log.read_text())

    def get(self, path, host=None):
        req = urllib.request.Request(f'http://127.0.0.1:{self.port}{path}', headers={'Accept-Encoding': 'gzip', **({'Host': host} if host else {})})
        try:
            r = urllib.request.urlopen(req, timeout=10)
            return r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read()

    def stop(self):
        self.proc.terminate()
        try:
            self.proc.wait(10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def body_json(headers, body):
    if headers.get('Content-Encoding') == 'gzip':
        body = gzip.decompress(body)
    return json.loads(body)


def run_cli(*args):
    return subprocess.run([sys.executable, str(APP / 'server.py'), *args], cwd=str(APP), capture_output=True, text=True, timeout=30)


class FixturesCli(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='gsone-fxset-'))

    def test_db_and_fixtures_are_mutually_exclusive(self):
        make_set(self.tmp)
        p = run_cli('--port', '0', '--db', str(DB), '--fixtures', str(self.tmp))
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('not allowed with', p.stderr)

    def test_one_of_db_or_fixtures_is_required(self):
        p = run_cli('--port', '0')
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('--db', p.stderr)
        self.assertIn('--fixtures', p.stderr)

    def test_port_still_required_in_fixtures_mode(self):
        make_set(self.tmp)
        p = run_cli('--fixtures', str(self.tmp))
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('--port', p.stderr)

    def test_missing_fixture_folder_exits_loudly(self):
        p = run_cli('--port', '0', '--fixtures', str(self.tmp / 'nope'))
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('not found', (p.stdout + p.stderr).lower())

    def test_index_entry_outside_the_folder_is_refused(self):
        make_set(self.tmp)
        idx = json.loads((self.tmp / 'index.json').read_text())
        idx['paths']['/api/bus/1'] = {'file': '../secret.json.gz', 'status': 200}
        (self.tmp / 'index.json').write_text(json.dumps(idx))
        p = run_cli('--port', '0', '--fixtures', str(self.tmp))
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('invalid fixture index', (p.stdout + p.stderr).lower())

    def test_index_entry_with_missing_file_is_refused(self):
        make_set(self.tmp)
        (self.tmp / 'f0.json.gz').unlink()
        p = run_cli('--port', '0', '--fixtures', str(self.tmp))
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('invalid fixture index', (p.stdout + p.stderr).lower())


class FixturesServe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix='gsone-fxset-'))
        cls.index = make_set(cls.tmp, set_id='test-set-serve')
        # duckdb blocked: any import of it in fixtures mode would crash the server before it announces a port
        cls.srv = Server('--port', '0', '--fixtures', str(cls.tmp), pre="import sys; sys.modules['duckdb'] = None")

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()

    def test_health_reports_fixtures_mode_and_set(self):
        code, h, b = self.srv.get('/health')
        self.assertEqual(code, 200)
        j = json.loads(b)
        self.assertEqual(j['app'], 'gridsense-one-studio')
        self.assertEqual(j['mode'], 'fixtures')
        self.assertEqual(j['fixture_set'], 'test-set-serve')
        self.assertEqual(j['fixture_count'], 2)
        self.assertEqual(Path(j['fixtures']).resolve(), self.tmp.resolve())
        self.assertRegex(j['code'], r'^[0-9a-f]{12}$')
        self.assertEqual(j['bind'], '127.0.0.1')
        self.assertEqual(j['db_mtime'], '2026-10-01T00:00:00+00:00')  # the recorded source, so the inspector shows it

    def test_recorded_path_is_served_gzip_and_equal(self):
        code, h, b = self.srv.get('/api/bus/111403')
        self.assertEqual(code, 200)
        self.assertEqual(h.get('Content-Encoding'), 'gzip')
        self.assertEqual(h.get('Content-Type'), 'application/json')
        self.assertEqual(body_json(h, b), BUS)

    def test_query_string_is_ignored_like_the_db_mode(self):
        code, h, b = self.srv.get('/api/bus/111403?x=1')
        self.assertEqual(code, 200)
        self.assertEqual(body_json(h, b), BUS)

    def test_recorded_status_is_replayed(self):
        code, h, b = self.srv.get('/api/x/mapgrid/bus/111403')
        self.assertEqual(code, 503)
        self.assertEqual(body_json(h, b), MAPGRID_STALE)

    def test_unknown_path_is_404_json(self):
        for p in ('/api/bus/42', '/api/x/grid/context/42', '/api/buses', '/api/nope'):
            code, h, b = self.srv.get(p + '?q=1')
            self.assertEqual(code, 404, p)
            self.assertTrue(h.get('Content-Type', '').startswith('application/json'), p)
            self.assertEqual(body_json(h, b), {'error': 'not in the dev-kit fixture set', 'path': p})

    def test_static_pages_and_guards_unchanged(self):
        code, _, _ = self.srv.get('/analytics-analyzer-studio.html')
        self.assertEqual(code, 200)
        code, _, _ = self.srv.get('/cache/x.json')
        self.assertEqual(code, 404)
        code, _, _ = self.srv.get('/api/bus/111403', host='evil.example')
        self.assertEqual(code, 403)


if __name__ == '__main__':
    unittest.main()
