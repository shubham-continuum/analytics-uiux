"""Export proxy (D-006): two POST routes forwarded to the export service; nothing else is a POST.
Continuum proxy (lift plan 14 L0): a fixed GET allow-list /api/proxy/continuum/api/v2/{scenarios*,continuum/*}.

Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1 · v2 2026-10-11 continuum GET (L0) · v3 2026-10-11 non-HTTP upstream + target validation (L0 fix r1) · v4 2026-10-14 css-leak never a daily instance (devkit-cont)
Uses a fake export / Continuum service on an ephemeral port (--export-target, --continuum-target). Never touches the real :5034.
"""
import http.client
import http.server
import json
import re
import socket
import subprocess
import sys
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DB = APP.parents[1] / 'unified' / 'ISONE_GridSense_unified.duckdb'
HITS = []


class Fake(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length') or 0))
        HITS.append((self.path, self.headers.get('Content-Type'), body))
        out = b'PK\x03\x04fake-xlsx'
        self.send_response(200)
        self.send_header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        self.send_header('Content-Disposition', 'attachment; filename="x.xlsx"')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_GET(self):
        HITS.append(('GET ' + self.path, None, b''))
        code = 404 if 'missing' in self.path else 200
        out = json.dumps({'upstream_path': self.path} if code == 200 else {'error': 'nothing held here'}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


def post(url, data=b'{}', ctype='application/json'):
    req = urllib.request.Request(url, data=data, method='POST', headers={'Content-Type': ctype})
    return urllib.request.urlopen(req, timeout=30)


class Proxy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fake = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fake)
        threading.Thread(target=cls.fake.serve_forever, daemon=True).start()
        cls.dead = free_port()  # nothing listens here: "export service not running"
        cls.srv = cls._start(f'127.0.0.1:{cls.fake.server_address[1]}')
        cls.srv_dead = cls._start(f'127.0.0.1:{cls.dead}')

    @staticmethod
    def _start(target):
        p = subprocess.Popen([sys.executable, '-u', str(APP / 'server.py'), '--port', '0', '--db', str(DB), '--export-target', target, '--continuum-target', target],
                             cwd=str(APP), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        t0 = time.time()
        while time.time() - t0 < 30:
            m = re.search(r'http://127\.0\.0\.1:(\d+)/', p.stdout.readline())
            if m:
                p.base = f'http://127.0.0.1:{m.group(1)}'
                return p
        raise RuntimeError('server did not start')

    @classmethod
    def tearDownClass(cls):
        for p in (cls.srv, cls.srv_dead):
            p.terminate()
            p.wait(10)
        cls.fake.shutdown()

    def test_siting_workbook_is_forwarded(self):
        HITS.clear()
        r = post(self.srv.base + '/api/proxy/export/siting-workbook', b'{"project":"kennebec","bus":"111209"}')
        self.assertEqual(r.status, 200)
        self.assertIn('spreadsheetml', r.headers['Content-Type'])
        self.assertIn('attachment', r.headers.get('Content-Disposition', ''))
        self.assertEqual(r.read()[:2], b'PK')
        self.assertEqual(HITS[-1][0], '/api/v2/export/siting-workbook')
        self.assertEqual(json.loads(HITS[-1][2])['bus'], '111209')

    def test_sced_node_is_forwarded(self):
        HITS.clear()
        r = post(self.srv.base + '/api/proxy/export/sced-node', b'{"bus":"111403"}')
        self.assertEqual(r.status, 200)
        self.assertEqual(HITS[-1][0], '/api/v2/export/sced-node')

    def test_plan_is_forwarded(self):
        HITS.clear()
        r = post(self.srv.base + '/api/proxy/export/siting-workbook/plan', b'{"bus":"111209"}')
        self.assertEqual(r.status, 200)
        self.assertEqual(HITS[-1][0], '/api/v2/export/siting-workbook/plan')

    def test_other_posts_are_405_and_not_forwarded(self):
        HITS.clear()
        for path in ('/api/proxy/export/other', '/api/proxy/export/siting-workbook/../x', '/api/buses', '/'):
            with self.assertRaises(urllib.error.HTTPError) as e:
                post(self.srv.base + path)
            self.assertIn(e.exception.code, (404, 405), path)
        self.assertEqual(HITS, [])

    def test_body_size_cap(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            post(self.srv.base + '/api/proxy/export/siting-workbook', b'{"x":"' + b'a' * (2 * 1024 * 1024) + b'"}')
        self.assertEqual(e.exception.code, 413)

    def test_json_only(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            post(self.srv.base + '/api/proxy/export/siting-workbook', b'a=1', 'application/x-www-form-urlencoded')
        self.assertEqual(e.exception.code, 415)

    def test_service_down_is_a_clear_502(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            post(self.srv_dead.base + '/api/proxy/export/siting-workbook', b'{}')
        self.assertEqual(e.exception.code, 502)
        msg = json.loads(e.exception.read())
        self.assertEqual(msg['error'], 'export service not running')



def get(url):
    return urllib.request.urlopen(url, timeout=30)


def raw_get(base, path, method='GET'):
    """http.client sends the path exactly as written (urllib could normalise `..`)."""
    host, port = base.rsplit('/', 1)[-1].split(':')
    c = http.client.HTTPConnection(host, int(port), timeout=30)
    c.request(method, path, body=b'{}' if method == 'POST' else None, headers={'Content-Type': 'application/json'})
    r = c.getresponse()
    return r.status, r.read()


CP = '/api/proxy/continuum'


class ContinuumProxy(unittest.TestCase):
    # the same fake (it answers GET too) and the same two servers (live target, dead target), without re-running Proxy's tests
    setUpClass = classmethod(Proxy.setUpClass.__func__)
    tearDownClass = classmethod(Proxy.tearDownClass.__func__)
    _start = staticmethod(Proxy._start)

    def test_scenarios_and_continuum_routes_are_forwarded_with_the_query(self):
        for path, upstream in (('/api/v2/scenarios', '/api/v2/scenarios'),
                               ('/api/v2/scenarios/annual?bus=111209&market=RT&measure=lmp', '/api/v2/scenarios/annual?bus=111209&market=RT&measure=lmp'),
                               ('/api/v2/continuum/status', '/api/v2/continuum/status'),
                               ('/api/v2/continuum/price-vs-generation?bus=HUB&source=settled%3A2025', '/api/v2/continuum/price-vs-generation?bus=HUB&source=settled%3A2025'),
                               ('/api/v2/continuum/congestion-by-constraint?bus=111209&top=10', '/api/v2/continuum/congestion-by-constraint?bus=111209&top=10')):
            HITS.clear()
            r = get(self.srv.base + CP + path)
            self.assertEqual(r.status, 200, path)
            self.assertIn('application/json', r.headers['Content-Type'])
            self.assertEqual(json.loads(r.read())['upstream_path'], upstream)
            self.assertEqual([h[0] for h in HITS], ['GET ' + upstream])

    def test_upstream_status_is_passed_through_not_masked(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            get(self.srv.base + CP + '/api/v2/continuum/missing-route')
        self.assertEqual(e.exception.code, 404)
        self.assertEqual(json.loads(e.exception.read())['error'], 'nothing held here')

    def test_routes_outside_the_allow_list_are_refused_and_not_forwarded(self):
        HITS.clear()
        for path in ('/api/v2/export/siting-workbook', '/api/v2/prices/hours', '/api/v2/continuum', '/api/v2/scenariosX',
                     '/api/v2/Continuum/status', '', '/', '/api/v2/continuum/status/', '/api/v1/scenarios', '/health'):
            with self.assertRaises(urllib.error.HTTPError) as e:
                get(self.srv.base + CP + path)
            self.assertEqual(e.exception.code, 404, path)
            self.assertIn('error', json.loads(e.exception.read()))
        self.assertEqual(HITS, [])

    def test_path_traversal_is_refused(self):
        HITS.clear()
        for path in ('/api/v2/continuum/../export/siting-workbook', '/api/v2/scenarios/..', '/api/v2/scenarios/%2e%2e/export',
                     '/api/v2/continuum/%2F..%2Fexport', '/api/v2/continuum//status', '/api/v2/continuum/.%2e/x',
                     '/api/v2/continuum/status\\..\\x', '/../../server.py', '/api/v2/continuum/status?x=1%0d%0aHost:%20evil'):
            code, body = raw_get(self.srv.base, CP + path)
            self.assertIn(code, (400, 404), path)
        self.assertEqual(HITS, [])

    def test_get_only(self):
        HITS.clear()
        code, _ = raw_get(self.srv.base, CP + '/api/v2/scenarios', 'POST')
        self.assertEqual(code, 405)
        self.assertEqual(HITS, [])

    def test_service_down_is_a_clear_502_and_health_says_so(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            get(self.srv_dead.base + CP + '/api/v2/scenarios')
        self.assertEqual(e.exception.code, 502)
        self.assertEqual(json.loads(e.exception.read())['error'], 'Continuum service not running')
        h = json.loads(get(self.srv_dead.base + '/health').read())
        self.assertEqual(h['continuum_target'], f'127.0.0.1:{self.dead}')
        self.assertEqual(h['continuum']['state'], 'down')

    def test_health_reports_the_target_without_calling_it(self):
        HITS.clear()
        h = json.loads(get(self.srv.base + '/health').read())
        self.assertEqual(h['continuum_target'], f'127.0.0.1:{self.fake.server_address[1]}')
        self.assertIn(h['continuum']['state'], ('unknown', 'up'))
        self.assertEqual(HITS, [], '/health never calls the Continuum service')
        get(self.srv.base + CP + '/api/v2/continuum/status')
        self.assertEqual(json.loads(get(self.srv.base + '/health').read())['continuum']['state'], 'up')


def junk_upstream():
    """Raw-socket fake that answers every connection with non-HTTP bytes (http.client raises BadStatusLine, not OSError)."""
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    s.listen(16)

    def loop():
        while True:
            try:
                c, _ = s.accept()
            except OSError:
                return
            try:
                c.settimeout(5)
                buf = b''  # read the whole request (headers + body) first: replying mid-send is a reset (OSError), not BadStatusLine
                while b'\r\n\r\n' not in buf:
                    b = c.recv(65536)
                    if not b:
                        break
                    buf += b
                head, _, body = buf.partition(b'\r\n\r\n')
                m = re.search(rb'(?i)content-length:\s*(\d+)', head)
                while m and len(body) < int(m.group(1)):
                    b = c.recv(65536)
                    if not b:
                        break
                    body += b
                c.sendall(b'NOT HTTP AT ALL\r\n\r\n')
            except OSError:
                pass
            finally:
                c.close()
    threading.Thread(target=loop, daemon=True).start()
    return s


class BadUpstream(unittest.TestCase):
    """An upstream that answers but not in HTTP is a JSON 502 with a reason (no dropped connection), for both proxies."""

    @classmethod
    def setUpClass(cls):
        cls.junk = junk_upstream()
        cls.srv = Proxy._start(f'127.0.0.1:{cls.junk.getsockname()[1]}')

    @classmethod
    def tearDownClass(cls):
        cls.srv.terminate()
        cls.srv.wait(10)
        cls.junk.close()

    def test_continuum_non_http_answer_is_a_json_502_and_health_down(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            get(self.srv.base + CP + '/api/v2/continuum/status')
        self.assertEqual(e.exception.code, 502)
        msg = json.loads(e.exception.read())
        self.assertEqual(msg['error'], 'Continuum service answered badly')
        self.assertEqual(msg['target'], f'127.0.0.1:{self.junk.getsockname()[1]}')
        c = json.loads(get(self.srv.base + '/health').read())['continuum']
        self.assertEqual(c['state'], 'down')
        self.assertEqual(c['why'], 'BadStatusLine')

    def test_export_non_http_answer_is_a_json_502(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            post(self.srv.base + '/api/proxy/export/siting-workbook', b'{}')
        self.assertEqual(e.exception.code, 502)
        self.assertEqual(json.loads(e.exception.read())['error'], 'export service answered badly')


class TargetValidation(unittest.TestCase):
    """A malformed --continuum-target / --export-target is refused at startup (exit 2), not a ValueError per request."""

    def test_bad_targets_exit_2(self):
        for flag, val in (('--continuum-target', '127.0.0.1:notaport'), ('--continuum-target', 'nohostport'),
                          ('--export-target', '127.0.0.1:99999'), ('--continuum-target', ':5034')):
            r = subprocess.run([sys.executable, '-u', str(APP / 'server.py'), '--port', '0', '--db', str(DB), flag, val],
                               cwd=str(APP), capture_output=True, text=True, timeout=30)
            self.assertEqual(r.returncode, 2, (flag, val, r.stdout))
            self.assertIn('host:port', r.stderr, (flag, val))


class CssLeakNeverDaily(unittest.TestCase):
    """css-leak drives the Continuum tab (proxy GETs): it must never run against a daily instance (:8103-:8106, whose
    proxy reaches the real :5034) nor fall back to tests/env.json defaultBase; unset GS_BASE -> it starts its own server."""

    def run_leak(self, base):
        env = {k: v for k, v in __import__('os').environ.items() if k != 'GS_BASE'}
        env['GS_BASE'] = base
        t0 = time.time()
        r = subprocess.run(['node', 'tests/css-leak.mjs', '--refuse-only'], cwd=APP, env=env, capture_output=True, text=True, timeout=60)
        return r, time.time() - t0

    def test_daily_ports_refused_before_any_request(self):
        for base in ('http://127.0.0.1:8105', 'http://localhost:8106/', 'http://127.0.0.1:8103', 'http://127.0.0.1:8104', 'http://127.0.0.1:5034'):
            r, s = self.run_leak(base)
            self.assertEqual(r.returncode, 2, f'{base}: {r.stdout}{r.stderr}')
            self.assertIn('never a daily instance', r.stderr, base)
            self.assertLess(s, 30, base)

    def test_no_fallback_to_env_default_base(self):
        src = (APP / 'tests' / 'css-leak.mjs').read_text(encoding='utf-8')
        self.assertNotRegex(src, r'\{\s*BASE\b[^}]*\}\s*=\s*await import\(|import\s*\{[^}]*\bBASE\b[^}]*\}\s*from')
        self.assertNotIn('defaultBase', src)
        self.assertIn("'--port', '0'", src)  # unset GS_BASE: its own ephemeral server


if __name__ == '__main__':
    unittest.main()
