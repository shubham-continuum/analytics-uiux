"""server.py command-line contract (M0): explicit --port and --db, loopback only, loud failure.

Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
Runs the server on an ephemeral port (--port 0); never touches :8103/:8104/:8105 or :5034.
"""
import json
import re
import subprocess
import sys
import time
import unittest
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DB = APP.parents[1] / 'unified' / 'ISONE_GridSense_unified.duckdb'


def start(*args):
    return subprocess.Popen([sys.executable, str(APP / 'server.py'), *args], cwd=str(APP),
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


class ServerCli(unittest.TestCase):
    def test_port_is_required(self):
        p = subprocess.run([sys.executable, str(APP / 'server.py'), '--db', str(DB)], cwd=str(APP),
                           capture_output=True, text=True, timeout=30)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('--port', p.stderr)

    def test_db_is_required(self):
        p = subprocess.run([sys.executable, str(APP / 'server.py'), '--port', '0'], cwd=str(APP),
                           capture_output=True, text=True, timeout=30)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('--db', p.stderr)

    def test_missing_db_exits_loudly(self):
        p = subprocess.run([sys.executable, str(APP / 'server.py'), '--port', '0', '--db', str(APP / 'nope.duckdb')],
                           cwd=str(APP), capture_output=True, text=True, timeout=30)
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('not found', (p.stdout + p.stderr).lower())

    def test_ephemeral_port_health_reports_db(self):
        proc = start('--port', '0', '--db', str(DB))
        try:
            port = None
            t0 = time.time()
            while time.time() - t0 < 30 and port is None:
                line = proc.stdout.readline()
                m = re.search(r'http://127\.0\.0\.1:(\d+)/', line)
                if m:
                    port = int(m.group(1))
            self.assertIsNotNone(port, 'server did not announce its port')
            self.assertNotEqual(port, 0)
            h = json.loads(urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=10).read())
            self.assertEqual(h['app'], 'gridsense-one-studio')
            self.assertEqual(Path(h['db']).resolve(), DB.resolve())
            self.assertIn('db_mtime', h)
            self.assertRegex(h['code'], r'^[0-9a-f]{12}$')
            self.assertEqual(h['bind'], '127.0.0.1')
        finally:
            proc.terminate()
            proc.wait(10)


if __name__ == '__main__':
    unittest.main()
