"""Economics data endpoints (read-only). GET /api/x/economics/<route>/<key>.

bench/<bus>    spread benchmarks and annual/monthly statistics for one bus, all from the unified DB:
               mart_bus_tb (settled TB2/4/8), forecast TB2/4/8 computed here from fact_fcst_lmp_hourly with the
               mart's definition (daily mean of the top-k minus the bottom-k hourly prices), mart_bus_year /
               mart_bus_fcst_year, mart_bus_month / mart_bus_fcst_month, the reserve zone and its annual reserve
               prices (fact_as_price_hourly), plus the Studio copy's per-bus fields (vendor, older database) from
               data/economics-studio.json, labelled as such.
reserves/<bus> hourly real-time reserve prices (TMSR, TMNSR, TMOR; mean of the 5-minute prices in each clock hour)
               for the bus's reserve zone. Clock hours are Eastern prevailing time as published.
profile/all    ISO-NE fleet solar and wind output by clock hour (fact_genfuel_hourly; mean of the samples in each hour).

Missing values are None (not held), never 0. Parameterised SQL only.
"""
import json
from pathlib import Path

import api_common
import busdata

ROOT = Path(__file__).resolve().parent
STUDIO = ROOT / 'data' / 'economics-studio.json'
# Reserve zones published in fact_as_price_hourly: CT (SWCT is a CT sub-zone that the bus table cannot place), NEMA/Boston, rest of system.
RESERVE_ZONE = {'CT': 'CT', 'NEMA': 'NEMABSTN'}
RESERVE_PRODUCTS = ['TMSR', 'TMNSR', 'TMOR']
_STUDIO = None


def _studio(bus):
    global _STUDIO
    if _STUDIO is None:
        _STUDIO = json.loads(STUDIO.read_text(encoding='utf-8')) if STUDIO.exists() else {'fields': [], 'buses': {}}
    row = _STUDIO['buses'].get(str(bus))
    if row is None: return None
    return {'source': _STUDIO.get('source'), 'builtAt': _STUDIO.get('built_at'), 'notes': _STUDIO.get('notes'),
            'values': dict(zip(_STUDIO['fields'], row))}


def _bus(c, key):
    if key in ('all', 'hub'): return None
    found = busdata.rows(c, 'SELECT bus_id, load_zone, state_code FROM dim_bus WHERE bus_id=? AND latitude IS NOT NULL', [int(key)])
    return found[0] if found else None


def _reserve_zone(bus):
    return RESERVE_ZONE.get(bus['load_zone'] or '', 'ROS')


def bench(c, key):
    bus = _bus(c, key)
    if not bus: return None
    bid = int(key)
    tb_sql = '''WITH r AS (SELECT study_date d, scenario, lmp,
                   row_number() OVER (PARTITION BY scenario, study_date ORDER BY lmp DESC) rd,
                   row_number() OVER (PARTITION BY scenario, study_date ORDER BY lmp) ra,
                   count(*) OVER (PARTITION BY scenario, study_date) n
                 FROM fact_fcst_lmp_hourly WHERE bus_id=? AND lmp IS NOT NULL),
               t AS (SELECT scenario, d,
                   avg(CASE WHEN rd<=2 THEN lmp END)-avg(CASE WHEN ra<=2 THEN lmp END) tb2,
                   avg(CASE WHEN rd<=4 THEN lmp END)-avg(CASE WHEN ra<=4 THEN lmp END) tb4,
                   avg(CASE WHEN rd<=8 THEN lmp END)-avg(CASE WHEN ra<=8 THEN lmp END) tb8
                 FROM r WHERE n>=16 GROUP BY scenario, d)
               SELECT t.scenario, s.target_year y, count(*) n_days, avg(tb2) tb2, avg(tb4) tb4, avg(tb8) tb8,
                      quantile_cont(tb4, 0.1) tb4_p10, quantile_cont(tb4, 0.9) tb4_p90
               FROM t JOIN dim_scenario s ON s.scenario=t.scenario GROUP BY t.scenario, s.target_year ORDER BY y, t.scenario'''
    zone = _reserve_zone(bus)
    res_sql = '''SELECT product, year(ts) y, count(DISTINCT date_trunc('hour', ts)) AS n_hours, avg(price) AS mean_price, max(price) AS max_price
                 FROM fact_as_price_hourly WHERE region=? GROUP BY product, year(ts) ORDER BY product, y'''
    return {
        'busId': key, 'loadZone': bus['load_zone'], 'state': bus['state_code'], 'reserveZone': zone,
        # settled rows at the bus's RESOLVED price node (busdata.bus_mart, D-008; == mart_bus_* unless re-linked)
        'tbHist': [{k: r[k] for k in ('market', 'y', 'n_days', 'tb2', 'tb4', 'tb8', 'tb4_p10', 'tb4_p90')} for r in busdata.bus_mart(c, bid, 'tb')],
        'tbFcst': busdata.rows(c, tb_sql, [bid]),
        'year': [{k: r[k] for k in ('market', 'y', 'n_hours', 'avg_lmp', 'p5', 'p95', 'neg_hours', 'hours_gt_200', 'avg_cong', 'peak_lmp', 'offpeak_lmp')}
                 for r in busdata.bus_mart(c, bid, 'year')],
        # run congestion onto the settled sign through the ONE boundary (it was published raw, on the run sign, before S2-D)
        'fcstYear': [{k: v for k, v in api_common.strip_marks(api_common.to_isone_sign(r, 'mart_bus_fcst_year')).items() if k != 'avg_energy'}
                     for r in busdata.rows(c, 'SELECT f.scenario, s.target_year y, n_hours, avg_lmp, p5, p95, neg_hours, avg_cong FROM mart_bus_fcst_year f JOIN dim_scenario s USING (scenario) WHERE bus_id=? ORDER BY y, f.scenario', [bid])],
        'month': [{k: r[k] for k in ('market', 'y', 'm', 'n_hours', 'avg_lmp', 'solar_lmp', 'neg_hours')} for r in busdata.bus_mart(c, bid, 'month')],
        'priceLink': busdata.bus_link_row(c, bid),
        'fcstMonth': busdata.rows(c, 'SELECT scenario, m, n_hours, avg_lmp, solar_lmp, neg_hours FROM mart_bus_fcst_month WHERE bus_id=? ORDER BY scenario, m', [bid]),
        'reserves': busdata.rows(c, res_sql, [zone]),
        'studio': _studio(key),
        'sources': {'tbHist': 'unified pn_tb at the resolved price node (busdata.price_links, D-008; = mart_bus_tb unless re-linked)', 'tbFcst': 'unified fact_fcst_lmp_hourly (daily top-k minus bottom-k, the mart_bus_tb definition)',
                    'year': 'unified pn_year at the resolved node (D-008) / mart_bus_fcst_year', 'month': 'unified pn_month at the resolved node (D-008) / mart_bus_fcst_month',
                    'reserves': f'unified fact_as_price_hourly, region {zone} (real-time 5-minute reserve prices)',
                    'studio': 'vendor/Studio copy (older database), data/economics-studio.json'},
    }


def reserves(c, key):
    bus = _bus(c, key)
    if not bus: return None
    zone = _reserve_zone(bus)
    q = '''SELECT strftime(date_trunc('hour', ts), '%Y-%m-%dT%H') h, product, avg(price) p
           FROM fact_as_price_hourly WHERE region=? GROUP BY 1, 2 ORDER BY 1'''
    hours = {}
    for r in busdata.rows(c, q, [zone]):
        hours.setdefault(r['h'], [None, None, None])[RESERVE_PRODUCTS.index(r['product'])] = r['p']
    return {'zone': zone, 'products': RESERVE_PRODUCTS, 'hours': hours,
            'source': f'unified fact_as_price_hourly, region {zone}; hourly mean of 5-minute real-time reserve prices ($/MW-h)',
            'note': 'Clock hours in Eastern prevailing time as published; the autumn repeated hour is merged into one hour.'}


def profile(c, key):
    if key != 'all': return None
    q = '''SELECT strftime(date_trunc('hour', ts), '%Y-%m-%dT%H') h, avg(generation_mw) mw
           FROM fact_genfuel_hourly WHERE fuel_type=? GROUP BY 1 ORDER BY 1'''
    out = {}
    for fuel in ('Solar', 'Wind'):
        out[fuel.lower()] = {r['h']: r['mw'] for r in busdata.rows(c, q, [fuel])}
    return {**out, 'source': 'unified fact_genfuel_hourly, ISO-NE fleet output (grid-connected; behind-the-meter solar not included); hourly mean of the published samples',
            'note': 'A fleet-wide shape, not a site profile. Clock hours in Eastern prevailing time.'}


ROUTES = {'bench': bench, 'reserves': reserves, 'profile': profile}
