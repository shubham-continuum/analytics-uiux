"""Decision endpoints (read-only). GET /api/x/decision/<route>/<key>.

population/all   every geolocated bus's value on the deciding measures (unified DB), for market-position percentiles
outlook/<bus>    one bus's annual price record: settled years (RT and DA) with TB spreads, and every forecast run
studio/<bus>     the live Studio's copy of the same bus (GS_DATA in studio/src/data.js, an older database), labelled
provenance/all   data_quality rows and the scenario register from the unified DB

The unified DB is primary. The Studio copy is read only to show where it differs; it never feeds a comparison.
Missing = None (not held), never 0. Parameterised SQL only.
"""
import json
from pathlib import Path

import busdata

YEAR = 2025
STUDIO_DATA = Path(busdata.ROOT).parents[1] / 'analytics-portfolio-canvas-2026-09-11' / 'studio' / 'src' / 'data.js'

# key, label, unit, source table, higher-is-better by default (the view flips price for a data centre), note
MEASURES = [
    ('lmp_rt', f'Average RT LMP {YEAR}', '$/MWh', 'mart_bus_year (RT)', True, 'Settled real-time, all hours'),
    ('lmp_2030', 'Forecast LMP 2030', '$/MWh', 'mart_bus_fcst_year (pcr2030)', True, 'PCR study set, 12 monthly PROBE runs'),
    ('lmp_2035', 'Forecast LMP 2035', '$/MWh', 'mart_bus_fcst_year (pcr2035)', True, 'PCR study set, 12 monthly PROBE runs'),
    ('solar_ratio', f'Solar-weighted ÷ average price {YEAR}', 'ratio', 'mart_bus_month (RT)', True, "The mart's solar weighting, not the Prices clear-sky shape"),
    ('tb2', f'TB2 spread {YEAR}', '$/MWh', 'mart_bus_tb (RT)', True, 'Mean daily top-2 minus bottom-2 hours'),
    ('tb4', f'TB4 spread {YEAR}', '$/MWh', 'mart_bus_tb (RT)', True, 'Mean daily top-4 minus bottom-4 hours'),
    ('tb8', f'TB8 spread {YEAR}', '$/MWh', 'mart_bus_tb (RT)', True, 'Mean daily top-8 minus bottom-8 hours'),
    ('std', f'Price volatility {YEAR} (σ)', '$/MWh', 'mart_bus_year (RT)', False, 'Standard deviation of hourly RT LMP'),
    ('neg', f'Negative-price hours {YEAR}', 'hours', 'mart_bus_year (RT)', False, 'Hours with RT LMP < 0'),
    ('h200', f'Hours above $200 {YEAR}', 'hours', 'mart_bus_year (RT)', True, 'Hours with RT LMP > $200/MWh'),
    ('cong', f'Average congestion component {YEAR}', '$/MWh', 'mart_bus_year (RT)', True, 'Settlement sign: negative prices the node below the system energy price'),
    ('rt_da', f'RT less DA {YEAR}', '$/MWh', 'mart_bus_da_rt', True, 'Hour-matched average'),
    ('hr_sp_dis', 'Injection headroom · summer peak', 'MW', 'fact_headroom', True, 'Vendor-asserted envelope, not an element study'),
    ('hr_sh_chg', 'Charging headroom · shoulder', 'MW', 'fact_headroom', True, 'Vendor-asserted envelope, not an element study'),
    ('hr_ll_chg', 'Withdrawal headroom · large load', 'MW', 'fact_headroom', True, 'Vendor-asserted envelope, not an element study'),
    ('sc_mva', 'Short-circuit strength', 'MVA', 'dim_bus', True, 'Corrected ×100 in the unified DB (data_quality)'),
    ('outlets', 'Substation outlets', 'count', 'dim_bus', True, 'Circuits leaving the substation'),
]

# Studio copy fields shown against the unified value (same quantity) or on their own (Studio only, labelled).
STUDIO_FIELDS = ['lmp_2025', 'lmp_2030', 'lmp_2035', 'lmp_2050', 'p5_2030', 'p95_2030', 'solar_cap_2030', 'wind_cap_2030',
                 'solar_100MW_2030', 'solar_250MW_2030', 'solar_500MW_2030', 'solar_1000MW_2030',
                 'wind_100MW_2030', 'wind_250MW_2030', 'wind_500MW_2030', 'wind_1000MW_2030',
                 'bess_100MW_2030', 'bess_250MW_2030', 'bess_500MW_2030', 'bess_1000MW_2030',
                 'dc_100MW_2030', 'dc_250MW_2030', 'dc_500MW_2030', 'dc_1000MW_2030',
                 'tb2_2030', 'tb4_2030', 'tb8_2030', 'tb4_2035', 'tb4_2050', 'cong_2025', 'hneg_2025', 'h200_2025',
                 'basis_own_2025', 'std_2025', 'top_constraint', 'top_shadow', 'hr_sp_dis', 'hr_sp_chg', 'hr_sh_dis',
                 'hr_sh_chg', 'hr_ll_chg', 'sc_mva', 'outlets', 'hourly_conf', 'shared_n', 'zone']
_STUDIO = {}


def _population(c):
    vals = {}

    def put(rows, key):
        for bus, v in rows:
            if v is not None:
                vals.setdefault(str(bus), {})[key] = float(v)

    # Settled measures at each bus's RESOLVED price node (busdata.price_links, D-008; == mart_bus_* unless re-linked).
    lp = busdata.link_params(c)
    yr = c.execute('''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                      SELECT l.bus_id, p.avg_lmp, p.std_lmp, p.neg_hours, p.hours_gt_200, p.avg_cong
                      FROM l JOIN pn_year p USING (pnode_name) WHERE p.market=? AND p.y=?''', lp + ['RT', YEAR]).fetchall()
    for i, key in enumerate(('lmp_rt', 'std', 'neg', 'h200', 'cong'), start=1):
        put([(r[0], r[i]) for r in yr], key)
    for key, run in [('lmp_2030', 'pcr2030'), ('lmp_2035', 'pcr2035')]:
        put(c.execute('SELECT bus_id, avg_lmp FROM mart_bus_fcst_year WHERE scenario=?', [run]).fetchall(), key)
    put(c.execute('''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                     SELECT l.bus_id, sum(p.solar_lmp*p.n_hours)/nullif(sum(p.avg_lmp*p.n_hours),0) FROM l JOIN pn_month p USING (pnode_name)
                     WHERE p.market=? AND p.y=? GROUP BY 1''', lp + ['RT', YEAR]).fetchall(), 'solar_ratio')
    tb = c.execute('''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                      SELECT l.bus_id, p.tb2, p.tb4, p.tb8 FROM l JOIN pn_tb p USING (pnode_name) WHERE p.market=? AND p.y=?''', lp + ['RT', YEAR]).fetchall()
    for i, key in enumerate(('tb2', 'tb4', 'tb8'), start=1):
        put([(r[0], r[i]) for r in tb], key)
    put(c.execute('''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                     SELECT l.bus_id, p.avg_rt_less_da FROM l JOIN pn_da_rt p USING (pnode_name) WHERE p.y=?''', lp + [YEAR]).fetchall(), 'rt_da')
    for key, sc, d in [('hr_sp_dis', 'summer_peak', 'discharge'), ('hr_sh_chg', 'shoulder', 'charge'), ('hr_ll_chg', 'large_load', 'charge')]:
        put(c.execute('SELECT bus_id, headroom_mw FROM fact_headroom WHERE scenario=? AND direction=?', [sc, d]).fetchall(), key)
    put(c.execute('SELECT bus_id, short_circuit_mva FROM dim_bus WHERE latitude IS NOT NULL').fetchall(), 'sc_mva')
    put(c.execute('SELECT bus_id, total_outlets FROM dim_bus WHERE latitude IS NOT NULL').fetchall(), 'outlets')
    buses = {str(r[0]) for r in c.execute('SELECT bus_id FROM dim_bus WHERE latitude IS NOT NULL').fetchall()}
    held = {str(r[0]) for r in yr}  # sharing published where the bus holds the settled year (as the mart row did)
    sharing = {str(b): k['buses_sharing_series'] for b, k in busdata.price_links(c)['links'].items() if str(b) in held}
    ids = sorted(buses, key=int)
    return {
        'year': YEAR,
        'source': 'unified ISONE_GridSense_unified.duckdb (read-only)',
        'measures': [{'key': k, 'label': l, 'unit': u, 'source': s, 'higher': h, 'note': n} for k, l, u, s, h, n in MEASURES],
        'ids': ids,
        'values': {k: [vals.get(i, {}).get(k) for i in ids] for k, *_ in MEASURES},
        'sharing': [sharing.get(i) for i in ids],
        'note': 'One value per geolocated bus. Buses that share a price series share its price measures (buses_sharing_series).',
    }


def _outlook(c, key):
    if key in ('all', 'hub'):
        return None
    bus = int(key)
    if not c.execute('SELECT 1 FROM dim_bus WHERE bus_id=? AND latitude IS NOT NULL', [bus]).fetchall():
        return None
    # at the bus's RESOLVED price node (busdata.bus_mart, D-008; == mart_bus_year ⟕ mart_bus_tb unless re-linked)
    tbs = {(t['market'], t['y']): t for t in busdata.bus_mart(c, bus, 'tb')}
    hist = []
    for y in busdata.bus_mart(c, bus, 'year'):
        t = tbs.get((y['market'], y['y'])) or {}
        hist.append({'market': y['market'], 'year': y['y'], **{k: y[k] for k in ('n_hours', 'avg_lmp', 'p5', 'p95', 'std_lmp', 'neg_hours', 'hours_gt_200',
                                                                              'avg_cong', 'price_tier', 'buses_sharing_series')},
                     **{k: t.get(k) for k in ('tb2', 'tb4', 'tb8', 'n_days')}})
    fcst = busdata.rows(c, '''SELECT f.scenario AS run, s.target_year AS year, s.description, f.n_hours, f.avg_lmp, f.p5, f.p95, f.std_lmp, f.neg_hours
                              FROM mart_bus_fcst_year f JOIN dim_scenario s ON s.scenario=f.scenario WHERE f.bus_id=? ORDER BY s.target_year, f.scenario''', [bus])
    return {'bus': key, 'hist': hist, 'fcst': fcst,
            'source': 'unified pn_year + pn_tb at the resolved price node (busdata.price_links, D-008; = mart_bus_* unless re-linked) · mart_bus_fcst_year + dim_scenario (forecast runs)'}


def _studio_table():
    if 'rows' not in _STUDIO:
        if not STUDIO_DATA.exists():
            _STUDIO['rows'] = None
            return None
        text = STUDIO_DATA.read_text(encoding='utf-8')
        d = json.loads(text[text.index('{'):text.rindex('}') + 1])
        cols = d['nodes']['cols']
        ix = {name: i for i, name in enumerate(cols)}
        _STUDIO['meta'] = {'built_at': d['meta'].get('built_at'), 'source': d['meta'].get('source')}
        _STUDIO['rows'] = {str(r[ix['bus_id']]): {f: r[ix[f]] for f in STUDIO_FIELDS if f in ix} for r in d['nodes']['rows']}
    return _STUDIO['rows']


def _studio(c, key):
    if key in ('all', 'hub'):
        return None
    rows = _studio_table()
    if rows is None or key not in rows:
        return None
    return {'bus': key, 'row': rows[key], 'meta': _STUDIO['meta'], 'file': str(STUDIO_DATA),
            'label': 'Studio copy (older database): window.GS_DATA in the live Studio, read-only'}


def _provenance(c, key):
    if key != 'all':
        return None
    return {'dataQuality': busdata.rows(c, 'SELECT field_group, status, basis FROM data_quality'),
            'scenarios': busdata.rows(c, 'SELECT scenario, kind, target_year, description FROM dim_scenario ORDER BY scenario'),
            'source': str(busdata.SOURCE)}


ROUTES = {
    'population': lambda c, key: _population(c) if key == 'all' else None,
    'outlook': _outlook,
    'studio': _studio,
    'provenance': _provenance,
}
