"""Prices endpoints (api_prices.py): per-bus aggregates must reconcile with the hourly facts by independent SQL.

Run: python -m unittest tests/test_api_prices.py   (from preview/)
"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import busdata  # noqa: E402
import api_prices as A  # noqa: E402

DIRECT = '111209'      # Hatchville 115 kV: own price node, Cape 5yr flag
EXACT = '100086'       # a bus whose PCR price node hosts a unit (DFAX published)


class ApiPrices(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.c = busdata.connect()
        cls.c.execute('SET enable_progress_bar=false')

    def test_unknown_and_wrong_keys_are_not_held(self):
        self.assertIsNone(A.summary(self.c, '999999999'))
        self.assertIsNone(A.zones(self.c, 'hub'))
        self.assertIsNone(A.constraints(self.c, 'all'))
        self.assertIsNone(A.fleet(self.c, DIRECT))

    def test_summary_forecast_sign_normalised_once(self):
        s = A.summary(self.c, DIRECT)
        five = next(r for r in s['fcstYear'] if r['scenario'] == '5yr')
        raw = self.c.execute('SELECT avg(congestion), avg(lmp), avg(loss) FROM fact_fcst_lmp_hourly WHERE bus_id=? AND scenario=?', [int(DIRECT), '5yr']).fetchone()
        self.assertAlmostEqual(five['avg_cong'], -raw[0], 9)
        self.assertAlmostEqual(five['avg_energy'] + five['avg_cong'] + five['avg_loss'], raw[1], 9)
        self.assertGreater(five['avg_cong'], 0, 'Hatchville 5yr MCC is a premium (+15.91) on the settled sign')

    def test_summary_year_matches_hourly(self):
        s = A.summary(self.c, DIRECT)
        y = next(r for r in s['year'] if r['market'] == 'RT' and r['y'] == 2025)
        n, avg = self.c.execute("SELECT count(*), avg(lmp) FROM fact_lmp_hourly WHERE pnode_name=? AND market='RT' AND year(ts)=2025", [s['link']['pnode_name']]).fetchone()
        self.assertEqual(y['n_hours'], n)
        self.assertAlmostEqual(y['avg_lmp'], avg, 9)

    def test_hub_summary(self):
        s = A.summary(self.c, 'hub')
        self.assertTrue(any(r['market'] == 'RT' for r in s['year']))
        self.assertEqual({r['scenario'] for r in s['fcstYear']}, {'5yr', '10yr'})

    def test_zone_basis_is_node_minus_reference(self):
        z = A.zones(self.c, DIRECT)
        rows = [r for r in z['settled'] if r['zone'] == 'Hub' and r['market'] == 'RT' and r['y'] == 2025]
        h = sum(r['hours'] for r in rows)
        basis = sum(r['sum_basis'] for r in rows) / h
        # independent path: mean node − mean hub over the same hours
        self.assertAlmostEqual(basis, (sum(r['sum_node'] for r in rows) - sum(r['sum_ref'] for r in rows)) / h, 9)
        self.assertEqual(z['ownZone'], 'SEMA')
        self.assertEqual(len({r['zone'] for r in z['settled']}), 9)

    def test_constraint_association_rebuilds_annual_mcc(self):
        k = A.constraints(self.c, DIRECT)
        p = k['periods']['RT2025']
        # independent SQL: clock hours with the repeated autumn hour averaged (the association's hour grain)
        ind = self.c.execute("SELECT avg(c) FROM (SELECT ts, avg(congestion) c FROM fact_lmp_hourly WHERE pnode_name=? AND market='RT' AND year(ts)=2025 GROUP BY 1)", [k['link']['pnode_name']]).fetchone()[0]
        self.assertAlmostEqual(p['mcc'], ind, 9)
        # the mart counts both fold readings, so it differs by at most a few 1e-5 $/MWh
        mart = self.c.execute("SELECT avg_cong FROM mart_bus_year WHERE bus_id=? AND market='RT' AND y=2025", [int(DIRECT)]).fetchone()[0]
        self.assertAlmostEqual(p['mcc'], mart, 3)
        for r in p['rows']:
            # mcc_on × h + mcc_off × (n − h) = Σ MCC  (consistency)
            self.assertAlmostEqual(r['mcc_on'] * r['hours'] + r['mcc_off'] * (p['n'] - r['hours']), p['sum_all'], 6)

    def test_exact_shares_sum_to_run_mcc(self):
        k = A.constraints(self.c, EXACT)
        self.assertTrue(k['exact'], 'exact DFAX rows expected at a unit node')
        for period, rows in k['exact'].items():
            mcc = k['periods'][period]['mcc']
            self.assertAlmostEqual(sum(r['contrib'] for r in rows), mcc, 2, period)

    def test_studio_copy_is_labelled(self):
        s = A.studio(self.c, DIRECT)
        self.assertEqual(s['meta']['sheet']['label'], 'vendor/Studio copy (older database)')
        self.assertIn('lmp_2030', s['bus']['sheet'])

    def test_fleet(self):
        f = A.fleet(self.c, 'all')
        self.assertIn(2025, f['years'])
        self.assertGreater(len(f['rtMean']), 2500)
        c25 = next(r for r in f['capture'] if r['y'] == 2025)
        self.assertLess(c25['p10'], c25['p50'])
        self.assertLess(c25['p50'], c25['p90'])


if __name__ == '__main__':
    unittest.main()
