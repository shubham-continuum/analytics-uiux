"""HTTP contract for /api/x/mapgrid: served uncached with its generation; unknown bus 404.

Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
Stale -> 503 is unit-tested at the API level in test_mapgrid.py; here the server must pass `status` through.
"""
import gzip
import json
import re
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DB = APP.parents[1] / 'unified' / 'ISONE_GridSense_unified.duckdb'


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        raw = r.read()
        return r.status, json.loads(gzip.decompress(raw) if r.headers.get('Content-Encoding') == 'gzip' else raw)


class MapgridHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.p = subprocess.Popen([sys.executable, str(APP / 'server.py'), '--port', '0', '--db', str(DB)], cwd=str(APP),
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        t0, cls.base = time.time(), None
        while time.time() - t0 < 30 and not cls.base:
            m = re.search(r'http://127\.0\.0\.1:(\d+)/', cls.p.stdout.readline())
            if m:
                cls.base = f'http://127.0.0.1:{m.group(1)}'

    @classmethod
    def tearDownClass(cls):
        cls.p.terminate()
        cls.p.wait(10)

    def test_meta_has_generation(self):
        code, meta = get(self.base + '/api/x/mapgrid/meta/all')
        self.assertEqual(code, 200)
        self.assertRegex(meta['generation'], r'^[0-9a-f]{16}$')

    def test_bus_record_and_null_not_zero(self):
        code, rec = get(self.base + '/api/x/mapgrid/bus/111403')
        self.assertEqual(code, 200)
        self.assertEqual(str(rec['data']['bus_id']), '111403')
        self.assertRegex(rec['generation'], r'^[0-9a-f]{16}$')
        self.assertIsNone(rec['data']['gen_mw'])  # not held stays null, never 0

    def test_unknown_bus_is_404(self):
        with self.assertRaises(urllib.error.HTTPError) as e:
            get(self.base + '/api/x/mapgrid/bus/999999999')
        self.assertEqual(e.exception.code, 404)


if __name__ == '__main__':
    unittest.main()
