"""Data layer for all buses: must reproduce the reviewed snapshot exactly for the demo buses.

Run: python -m unittest tests/test_busdata.py   (from preview/)
"""
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import busdata  # noqa: E402

SNAP = json.loads((ROOT / 'data' / 'snapshot.json').read_text(encoding='utf-8'))


def fold_insensitive(records):
    """The autumn repeated hour has no source order: compare the two rows of each clock hour as a set."""
    # The offset label follows row order, so it is dropped for the comparison; every other field must match.
    return sorted(([r[0][:19]] + r[1:] for r in records), key=lambda r: (r[0], [x if x is not None else -1e18 for x in r[1:]]))


def series_of(payload_or_snap, node_id):
    key = lambda s: (s['mode'], s['market'], s['run'], s['year'])
    return sorted((s for s in payload_or_snap['series'] if s['nodeId'] == node_id), key=key)


class BusData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = busdata.connect()

    def test_demo_bus_matches_snapshot(self):
        for bid in ('111403', '100178'):
            p = busdata.clean(busdata.bus_payload(self.c, bid))
            a, b = series_of(p, bid), series_of(SNAP, bid)
            self.assertEqual(len(a), len(b), bid)
            for x, y in zip(a, b):
                self.assertEqual(fold_insensitive(x['records']), fold_insensitive(y['records']), f"{bid} {x['mode']} {x['run']} {x['year']}")
                self.assertEqual(x['observedHours'], y['observedHours'])
            node = p['nodes'][0]
            snap_node = next(n for n in SNAP['nodes'] if n['id'] == bid)
            self.assertEqual(node['priceMapping']['pnode_name'], snap_node['priceMapping']['pnode_name'])

    def test_hub_matches_snapshot(self):
        p = busdata.clean(busdata.bus_payload(self.c, 'hub'))
        a, b = series_of(p, 'hub'), series_of(SNAP, 'hub')
        self.assertEqual([len(s['records']) for s in a], [len(s['records']) for s in b])
        self.assertEqual(a[0]['records'][:50], b[0]['records'][:50])

    def test_grid_rows_match_snapshot(self):
        p = busdata.clean(busdata.bus_payload(self.c, '111403'))
        want = [r for r in SNAP['grid']['headroom'] if str(r['bus_id']) == '111403']
        self.assertEqual(len(p['grid']['headroom']), len(want))

    def test_bus_list_covers_all_geolocated_buses(self):
        lst = busdata.bus_list(self.c)
        self.assertEqual(len(lst), 2678)
        tiers = {}
        for b in lst:
            tiers[b['tier']] = tiers.get(b['tier'], 0) + 1
            self.assertIsNotNone(b['lat'])
        # D-008 (S2-D): 5 direct + 80 same_substation rank-1 links to a same-name node in another town are re-linked
        self.assertEqual(tiers, {'direct': 292, 'same_substation': 841, 'geo_proxy': 1460, 'relinked': 85})
        proxy = next(b for b in lst if b['tier'] == 'geo_proxy')
        self.assertIsNotNone(proxy['proxyKm'])

    def test_unknown_bus_is_none_not_empty(self):
        self.assertIsNone(busdata.bus_payload(self.c, '999999999'))
        self.assertIsNone(busdata.bus_payload(self.c, 'x; drop table'))

    def test_screen_summary(self):
        s = busdata.screen(self.c)
        self.assertGreaterEqual(len(s['buses']), 2600)
        row = s['buses']['111403']
        self.assertIn('hist', row)
        self.assertIn('fcst', row)
        # null means not held, never 0
        for b in s['buses'].values():
            for v in b['hist'].values():
                self.assertTrue(v is None or isinstance(v, (int, float)))


if __name__ == '__main__':
    unittest.main()
