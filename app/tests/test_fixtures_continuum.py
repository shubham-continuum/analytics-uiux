"""Dev-kit fixtures for the LMP Continuum proxy (lift plan 14 L5): recorded and replayed by path + query.

Provenance: Claude Opus 5.5 (L5 handover) · one-studio/design/14-lift-projects-configurator-continuum.md §3 L5 · 2026-10-14 · sign-off pending · v1 · v2 2026-10-14 replay landed in server.py (devkit-cont): expectedFailure markers removed
1. plan/export_fixtures.py keeps an allowed Continuum proxy request with its query (the answer depends on it), names its
   file safely (short, unique per query) and drops anything outside the proxy allow-list.
2. server.py --fixtures replays /api/proxy/continuum/... from the set by exact path + query and never forwards: the
   server here gets a dead --continuum-target, so a forwarded request would be a 502, not the recorded answer.
Ephemeral ports only (--port 0); never :8103-:8106 or :5034. Server output goes to a file (test_fixtures_mode.Server).
"""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_fixtures_mode import Server, body_json, make_set  # noqa: E402

_spec = importlib.util.spec_from_file_location('export_fixtures', APP / 'plan' / 'export_fixtures.py')
EX = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(EX)

P = '/api/proxy/continuum'
SCEN = {'scenarios': [{'id': 'high_gas', 'factor': 1.1}], 'proxy_label': 'fixture'}
CAPTURE = {'bus': 111209, 'rows': [{'year': 2030, 'capture': None}]}


class ExportKeys(unittest.TestCase):
    def test_continuum_paths_keep_their_query(self):
        self.assertTrue(EX.keep_path(f'{P}/api/v2/scenarios'))
        self.assertTrue(EX.keep_path(f'{P}/api/v2/continuum/capture?bus=111209&fuel=solar'))
        self.assertTrue(EX.keep_path(f'{P}/api/v2/scenarios/annual?bus=111209&market=RT&measure=lmp'))

    def test_outside_the_allow_list_is_not_recorded(self):
        for p in (f'{P}/api/v2/prices/hours?bus=1', f'{P}/api/v2/../x', f'{P}/api/v2/continuum', f'{P}/api/v1/scenarios', '/api/proxy/export/sced-node', '/api/nope'):
            self.assertFalse(EX.keep_path(p), p)

    def test_existing_api_paths_still_kept(self):
        for p in ('/api/buses', '/api/screen', '/api/market', '/api/bus/111403', '/api/bus/hub', '/api/x/grid/context/111403'):
            self.assertTrue(EX.keep_path(p), p)

    def test_file_names_safe_short_and_unique_per_query(self):
        a = EX.fname(f'{P}/api/v2/continuum/capture?bus=111209&fuel=solar')
        b = EX.fname(f'{P}/api/v2/continuum/capture?bus=111209&fuel=wind')
        self.assertNotEqual(a, b)
        for f in (a, b, EX.fname(f'{P}/api/v2/continuum/price-vs-generation?' + '&'.join(f'k{i}=v{i}' for i in range(60)))):
            self.assertRegex(f, r'^[A-Za-z0-9_.-]+\.json\.gz$')
            self.assertLessEqual(len(f), 120)
        self.assertEqual(EX.fname('/api/bus/111403'), 'bus__111403.json.gz')  # the existing names do not move


_spec2 = importlib.util.spec_from_file_location('package_devkit', APP / 'plan' / 'package_devkit.py')
PK = importlib.util.module_from_spec(_spec2)
_spec2.loader.exec_module(PK)


class PackageSync(unittest.TestCase):
    """package_devkit syncs into the kit folder instead of deleting it (a dev-kit server may run from it)."""

    def test_sync_replaces_changed_removes_stale_keeps_own_logs(self):
        src, dest = (Path(tempfile.mkdtemp(prefix='gsone-pk-')) for _ in range(2))
        (src / 'fixtures').mkdir()
        (src / 'a.js').write_text('new')
        (src / 'same.js').write_text('same')
        (src / 'fixtures' / 'index.json').write_text('{}')
        (dest / 'fixtures').mkdir()
        (dest / 'cache').mkdir()
        (dest / 'a.js').write_text('old')
        (dest / 'same.js').write_text('same')
        (dest / 'fixtures' / 'gone.json.gz').write_text('x')
        (dest / 'server.log').write_text('running')
        (dest / 'cache' / 'c.json').write_text('{}')
        copied, removed = PK.sync(src, dest)
        self.assertEqual((copied, removed), (2, 1))
        self.assertEqual((dest / 'a.js').read_text(), 'new')
        self.assertFalse((dest / 'fixtures' / 'gone.json.gz').exists())
        self.assertTrue((dest / 'fixtures' / 'index.json').exists())
        self.assertTrue((dest / 'server.log').exists())
        self.assertTrue((dest / 'cache' / 'c.json').exists())


class ContinuumReplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix='gsone-fxcont-'))
        make_set(cls.tmp, {'/api/bus/111403': (200, {'nodeId': '111403'}),
                           f'{P}/api/v2/scenarios': (200, SCEN),
                           f'{P}/api/v2/continuum/capture?bus=111209': (200, CAPTURE),
                           f'{P}/api/v2/continuum/basis?bus=999': (404, {'error': 'bus not held'})}, set_id='test-set-cont')
        # a dead Continuum target: anything forwarded instead of replayed answers 502
        cls.srv = Server('--port', '0', '--fixtures', str(cls.tmp), '--continuum-target', '127.0.0.1:9', pre="import sys; sys.modules['duckdb'] = None")

    @classmethod
    def tearDownClass(cls):
        cls.srv.stop()

    def test_recorded_continuum_answer_is_replayed(self):
        code, h, b = self.srv.get(f'{P}/api/v2/scenarios')
        self.assertEqual(code, 200)
        self.assertEqual(h.get('Content-Encoding'), 'gzip')
        self.assertEqual(body_json(h, b), SCEN)

    def test_query_selects_the_recording(self):
        code, h, b = self.srv.get(f'{P}/api/v2/continuum/capture?bus=111209')
        self.assertEqual((code, body_json(h, b)), (200, CAPTURE))
        code, h, b = self.srv.get(f'{P}/api/v2/continuum/basis?bus=999')
        self.assertEqual((code, body_json(h, b)), (404, {'error': 'bus not held'}))

    def test_unrecorded_continuum_request_is_the_fixture_404_not_a_forward(self):
        for p in (f'{P}/api/v2/continuum/capture?bus=111403', f'{P}/api/v2/continuum/status'):
            code, h, b = self.srv.get(p)
            self.assertEqual(code, 404, p)
            self.assertEqual(body_json(h, b), {'error': 'not in the dev-kit fixture set', 'path': p})

    def test_proxy_guards_still_apply_in_fixtures_mode(self):
        code, _, _ = self.srv.get(f'{P}/api/v2/../scenarios')
        self.assertEqual(code, 400)
        code, h, b = self.srv.get(f'{P}/api/v2/prices/hours?bus=1')
        self.assertEqual(code, 404)
        self.assertEqual(body_json(h, b)['error'], 'not an allowed Continuum route')


if __name__ == '__main__':
    unittest.main()
