"""Prices dashboard endpoints: per-bus aggregates over the unified DuckDB (read-only), never hourly rows.

    GET /api/x/prices/summary/<bus|hub>     yearly / monthly / hour-of-day / spread / DA-RT marts, settled and solved
    GET /api/x/prices/zones/<bus>           hour-matched node − zone and node − hub by market, year and month
    GET /api/x/prices/constraints/<bus>     binding constraints: settled association, solved association, exact DFAX share
    GET /api/x/prices/studio/<bus>          the live Studio's figures for this bus (vendor sheet + extension), labelled
    GET /api/x/prices/fleet/all             ISO-wide context: RT mean per bus per year, capture-ratio spread, zone series

Rules (settled in review, kept here):
- Missing = None (not held), never 0. A bus with no row returns empty lists, not zeros.
- Sign: LMP = energy + congestion + loss (ISO-NE settlement sign). Every forecast run stores LMP = energy − congestion
  + loss, so a run's congestion is negated ONCE, here, at read (the marts store it raw), and energy = LMP − C − L.
- Settled figures for a bus come from the price series its bridge_bus_pnode link names (tier + distance disclosed):
  a geo_proxy bus's history is a neighbour's. Forecasts are modelled per bus.
- Settled constraints carry no shift factor: a settled row is an ASSOCIATION (the bus's own MCC in the constraint's
  binding hours vs every other hour). The PCR runs publish DFAX at unit price nodes: there the share is EXACT.
"""
import json
from pathlib import Path

import api_common
import busdata

ROOT = Path(__file__).resolve().parent
STUDIO_FILE = ROOT / 'data' / 'prices-studio.json'
HUB_PNODE = '.H.INTERNAL_HUB'
HUB_FCST_BUS = 80000
NOT_NETWORK = '^(SYSTEM_|NODE_)'  # reserve requirements and external-node limits: not network constraints
TOP_N = 12
ZONE_LABEL = {'.Z.MAINE': 'ME', '.Z.NEWHAMPSHIRE': 'NH', '.Z.VERMONT': 'VT', '.Z.CONNECTICUT': 'CT', '.Z.RHODEISLAND': 'RI',
              '.Z.SEMASS': 'SEMA', '.Z.WCMASS': 'WCMA', '.Z.NEMASSBOST': 'NEMA', HUB_PNODE: 'Hub'}


def _rows(c, sql, params=()):
    return busdata.rows(c, sql, params)


def _link(c, bus_id):
    """The bus's resolved price link (busdata.price_links, D-008) with the node's zone and the bus's name/coordinates."""
    k = busdata.link_of(c, bus_id)
    b = _rows(c, 'SELECT bus_name, latitude, longitude FROM dim_bus WHERE bus_id = ?', [bus_id])
    if k is None or not b: return None
    z = _rows(c, 'SELECT zone_name FROM dim_pnode WHERE pnode_name = ?', [k['pnode_name']]) if k['pnode_name'] else []
    out = {'bus_id': bus_id, 'pnode_name': k['pnode_name'], 'price_tier': k['tier'], 'price_proxy_km': k['distance_km'],
           'buses_sharing_series': k['buses_sharing_series'], 'zone_name': z[0]['zone_name'] if z else None, **b[0]}
    if k['tier'] == busdata.RELINKED:  # D-008: show 'relinked · N mi' and the far node it is no longer priced through
        out.update(relink_mi=k['distance_mi'], relinked_from=k['relinked_from'], relink_rule=busdata.RELINK_RULE)
    return out


def _fcst_fix(r):
    """A run row onto the settled sign through the ONE boundary (api_common.to_isone_sign); the stored figure is kept
    as avg_cong_stored. Year rows recompute energy = LMP - C - L; hour rows hold no loss, so their energy is None (not held)."""
    src = 'mart_bus_fcst_hour' if 'h' in r else 'mart_bus_fcst_year'
    out = api_common.strip_marks(api_common.to_isone_sign(r, src))
    if 'avg_cong' in r: out['avg_cong_stored'] = r['avg_cong']
    return out


def _run_cong(v):
    """A sum (or mean) of a run's STORED congestion onto the settled sign. The flip is linear, so a sum of stored
    figures converts like one figure; it still goes through the one boundary."""
    return api_common.to_isone_sign({'congestion': v}, 'fact_fcst_lmp_hourly')['congestion']


def summary(c, key):
    """Every mart row for one bus (or the hub): the all-years view without shipping hourly rows."""
    runs = {r['scenario']: r for r in _rows(c, "SELECT scenario, target_year, description FROM dim_scenario WHERE kind='forecast'")}
    if key == 'hub':
        link = {'pnode_name': HUB_PNODE, 'price_tier': 'hub', 'price_proxy_km': None, 'buses_sharing_series': None, 'zone_name': None, 'bus_name': 'ISO-NE Internal Hub'}
        p = [HUB_PNODE]
        year = _rows(c, 'SELECT * FROM pn_year WHERE pnode_name = ? ORDER BY market, y', p)
        month = _rows(c, 'SELECT * FROM pn_month WHERE pnode_name = ? ORDER BY market, y, m', p)
        hour = _rows(c, 'SELECT * FROM pn_hour WHERE pnode_name = ? ORDER BY market, y, h', p)
        tb = _rows(c, 'SELECT * FROM pn_tb WHERE pnode_name = ? ORDER BY market, y', p)
        dart = _rows(c, 'SELECT * FROM pn_da_rt WHERE pnode_name = ? ORDER BY y', p)
        fb, src = HUB_FCST_BUS, 'pn_year / pn_month / pn_hour / pn_tb / pn_da_rt (pnode grain)'
    else:
        b = int(key)
        link = _link(c, b)
        if link is None: return None
        # pn_* at the RESOLVED node (busdata.bus_mart): == mart_bus_* for every bus not re-linked (D-008)
        year, month, hour, tb, dart = (busdata.bus_mart(c, b, g) for g in ('year', 'month', 'hour', 'tb', 'da_rt'))
        fb, src = b, 'pn_year / pn_month / pn_hour / pn_tb / pn_da_rt at the bus\'s resolved price node (busdata.price_links, D-008; = mart_bus_* unless re-linked)'
    fyear = [_fcst_fix(r) for r in _rows(c, 'SELECT * FROM mart_bus_fcst_year WHERE bus_id = ?', [fb])]
    fmonth = _rows(c, 'SELECT * FROM mart_bus_fcst_month WHERE bus_id = ? ORDER BY scenario, m', [fb])
    fhour = [_fcst_fix(r) for r in _rows(c, 'SELECT * FROM mart_bus_fcst_hour WHERE bus_id = ? ORDER BY scenario, h', [fb])]
    for r in fyear: r['target_year'] = runs.get(r['scenario'], {}).get('target_year')
    fyear.sort(key=lambda r: (r['target_year'] or 0, r['scenario']))
    return {'key': key, 'link': link, 'runs': runs, 'year': year, 'month': month, 'hour': hour, 'tb': tb, 'daRt': dart,
            'fcstYear': fyear, 'fcstMonth': fmonth, 'fcstHour': fhour,
            'source': f'unified ISONE_GridSense_unified.duckdb · {src} · mart_bus_fcst_year / _month / _hour',
            'definitions': {
                'quantiles': 'quantile_cont (linear interpolation) over every hourly row of the year, fold-hour duplicates included',
                'neg_hours': 'hours with LMP < $0 (strictly below)', 'hours_gt_200': 'hours with LMP > $200',
                'peak': 'hour 7–22 (HE08–HE23), every day (unified single definition); forecast peak = the run\'s is_peak flag',
                'solar_lmp': 'mean LMP over hours 9–16 (HE10–HE17, 8 hours) — the mart\'s solar window',
                'tb': 'per calendar day, mean of the N dearest − mean of the N cheapest hourly prices, every day held (partial days included), averaged over days',
                'da_rt': 'hours where both DA and RT are held (fold hour: the larger of the two readings per market)',
                'fcst_cong': 'stored congestion converted once by api_common.to_isone_sign (runs store LMP = E − C + L); energy = LMP − C − L',
                'link': busdata.RELINK_RULE}}


def zones(c, key):
    """Hour-matched node − zone and node − hub by market, year and month (sums, so years aggregate exactly)."""
    if key in ('all', 'hub'): return None
    b = int(key)
    link = _link(c, b)
    if link is None: return None
    settled = _rows(c, '''
        WITH n AS (SELECT ts, market, avg(lmp) AS v FROM fact_lmp_hourly WHERE pnode_name = ? GROUP BY 1, 2),
             z AS (SELECT pnode_name AS ref, ts, market, avg(lmp) AS v FROM fact_lmp_hourly
                   WHERE pnode_name LIKE '.Z.%' OR pnode_name = ? GROUP BY 1, 2, 3)
        SELECT z.ref, n.market, year(n.ts) AS y, month(n.ts) AS m, count(*) AS hours,
               sum(n.v - z.v) AS sum_basis, sum(n.v) AS sum_node, sum(z.v) AS sum_ref,
               count(*) FILTER (WHERE n.v > z.v) AS hours_above
        FROM n JOIN z USING (ts, market) GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4''', [link['pnode_name'], HUB_PNODE])
    for r in settled: r['zone'] = ZONE_LABEL.get(r['ref'], r['ref'])
    # Forecast "zone" = the mean of the zone's buses in that run (runs publish bus prices, not zone prices).
    fz = _rows(c, '''
        WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
        SELECT f.scenario, p.zone_name AS ref, count(*) AS buses, avg(f.avg_lmp) AS zone_mean
        FROM mart_bus_fcst_year f JOIN l USING (bus_id) JOIN dim_pnode p USING (pnode_name)
        WHERE p.zone_name IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2''', busdata.link_params(c))
    for r in fz: r['zone'] = ZONE_LABEL.get(r['ref'], r['ref'])
    node_f = {r['scenario']: r['avg_lmp'] for r in _rows(c, 'SELECT scenario, avg_lmp FROM mart_bus_fcst_year WHERE bus_id = ?', [b])}
    hub_f = {r['scenario']: r['avg_lmp'] for r in _rows(c, 'SELECT scenario, avg_lmp FROM mart_bus_fcst_year WHERE bus_id = ?', [HUB_FCST_BUS])}
    return {'key': key, 'link': link, 'ownZone': ZONE_LABEL.get(link.get('zone_name'), link.get('zone_name')),
            'settled': settled, 'forecastZones': fz, 'forecastNode': node_f, 'forecastHub': hub_f,
            'source': 'unified fact_lmp_hourly (node series per bridge_bus_pnode; .Z.* load-zone and .H.INTERNAL_HUB series); mart_bus_fcst_year',
            'rules': {'match': 'Each ISO timestamp and market present in both series; the repeated autumn hour is averaged per series before matching.',
                      'forecast_zone': 'Runs publish bus prices, not zone prices: a run\'s zone figure is the unweighted mean of the annual means of buses whose price node lies in that zone (dim_pnode.zone_name).',
                      'forecast_hub': 'The hub is model bus 80000, held in the 5yr and 10yr runs only.'}}


def _assoc(rows):
    """Association rows → per period {n, mcc, rows[top]} with assoc = (mcc_on − mcc_off) × hours ÷ n."""
    out = {}
    for r in rows:
        p = out.setdefault(r['period'], {'n': int(r['n']), 'sum_all': r['sc'], 'rows': [], 'bound': 0})
        if r['k'] is None: continue
        p['bound'] += 1
        n, h, s_on, s_all = int(r['n']), int(r['hrs']), r['sc_on'], r['sc']
        on = s_on / h if h else None
        off = (s_all - s_on) / (n - h) if n > h and s_all is not None and s_on is not None else None
        assoc = (on - off) * h / n if on is not None and off is not None and n else None
        p['rows'].append({'name': r['k'], 'hours': h, 'sum_on': s_on, 'mcc_on': on, 'mcc_off': off, 'assoc': assoc,
                          'mean_abs_shadow': r.get('sp'), 'max_abs_shadow': r.get('sp_max')})
    for p in out.values():
        p['mcc'] = p['sum_all'] / p['n'] if p['n'] and p['sum_all'] is not None else None
        p['rows'].sort(key=lambda x: -abs(x['assoc'] or 0))
        p['rows'] = p['rows'][:TOP_N]
    return out


def constraints(c, key):
    if key in ('all', 'hub'): return None
    b = int(key)
    link = _link(c, b)
    if link is None: return None
    settled = _rows(c, f'''
        WITH b AS (SELECT constraint_name AS k, market, date_trunc('hour', ts) AS h, max(abs(shadow_price)) AS sp
                   FROM fact_constraint_hourly WHERE NOT regexp_matches(constraint_name, '{NOT_NETWORK}', 'i') GROUP BY 1, 2, 3),
             s AS (SELECT market, ts AS h, avg(congestion) AS c FROM fact_lmp_hourly WHERE pnode_name = ? GROUP BY 1, 2),
             tot AS (SELECT market, year(h) AS y, count(*) AS n, sum(c) AS sc FROM s GROUP BY 1, 2),
             j AS (SELECT s.market, year(s.h) AS y, b.k, count(*) AS hrs, sum(s.c) AS sc_on, avg(b.sp) AS sp, max(b.sp) AS sp_max
                   FROM b JOIN s ON s.h = b.h AND s.market = b.market GROUP BY 1, 2, 3)
        SELECT tot.market || CAST(tot.y AS VARCHAR) AS period, tot.n, tot.sc, j.k, j.hrs, j.sc_on, j.sp, j.sp_max
        FROM tot LEFT JOIN j USING (market, y)
        WHERE (tot.market = 'DA' AND tot.y >= 2021) OR (tot.market = 'RT' AND tot.y >= 2023)''', [link['pnode_name']])
    solved = _rows(c, '''
        WITH b AS (SELECT scenario, coalesce(trim(monitored_facility) || ' · ' || trim(contingency),
                                             'unnamed constraint ' || CAST(constr_index AS VARCHAR)) AS k,
                          study_date AS d, hour AS h, avg(abs(shadow_price)) AS sp
                   FROM fact_pcr_binding_hourly
                   WHERE NOT (monitored_facility IS NULL AND abs(constraint_limit + 0.0003) < 1e-6) GROUP BY 1, 2, 3, 4),
             s AS (SELECT scenario, study_date AS d, hour AS h, congestion AS c FROM fact_fcst_lmp_hourly
                   WHERE bus_id = ? AND scenario IN ('pcr2030', 'pcr2035', 'pcr2040')),  -- STORED run sign; converted below
             tot AS (SELECT scenario, count(*) AS n, sum(c) AS sc FROM s GROUP BY 1),
             j AS (SELECT s.scenario, b.k, count(*) AS hrs, sum(s.c) AS sc_on, avg(b.sp) AS sp, max(b.sp) AS sp_max
                   FROM b JOIN s USING (scenario, d, h) GROUP BY 1, 2)
        SELECT tot.scenario AS period, tot.n, tot.sc, j.k, j.hrs, j.sc_on, j.sp, j.sp_max FROM tot LEFT JOIN j USING (scenario)''', [b])
    for r in solved:  # the ONE sign boundary (api_common.to_isone_sign) on the stored sums
        r['sc'], r['sc_on'] = _run_cong(r['sc']), _run_cong(r['sc_on'])
    exact = _rows(c, '''
        WITH x AS (SELECT c.scenario, c.constr_index, c.study_date, c.hour, avg(c.shadow_price) AS mu, avg(c.dfax) AS sf
                   FROM fact_pcr_cong_impact c JOIN dim_pcr_resource r USING (bidder_index)
                   JOIN stg_pcr_bus_pnode s ON s.pcr_pnode_index = r.pnode_index
                   WHERE s.bus_id = ? GROUP BY 1, 2, 3, 4),
             lab AS (SELECT scenario, constr_index, any_value(coalesce(trim(monitored_facility) || ' · ' || trim(contingency),
                            'unnamed constraint ' || CAST(constr_index AS VARCHAR))) AS k
                     FROM fact_pcr_binding_hourly GROUP BY 1, 2)
        SELECT x.scenario AS period, lab.k AS name, avg(x.sf) AS dfax, sum(x.mu * x.sf) AS contrib_sum, count(*) AS hours
        FROM x JOIN lab USING (scenario, constr_index) GROUP BY 1, 2''', [b])
    system = _rows(c, f'''SELECT market || CAST(year(ts) AS VARCHAR) AS period, count(DISTINCT constraint_name) AS constraints,
                                 count(DISTINCT date_trunc('hour', ts)) AS hours_any_binding
                          FROM fact_constraint_hourly WHERE NOT regexp_matches(constraint_name, '{NOT_NETWORK}', 'i') GROUP BY 1''')
    system += _rows(c, '''SELECT scenario AS period, count(DISTINCT constr_index) AS constraints, count(DISTINCT (study_date, hour)) AS hours_any_binding
                          FROM fact_pcr_binding_hourly WHERE NOT (monitored_facility IS NULL AND abs(constraint_limit + 0.0003) < 1e-6) GROUP BY 1''')
    periods = _assoc(settled)
    periods.update(_assoc(solved))
    ex = {}
    for r in exact:
        n = (periods.get(r['period']) or {}).get('n')
        ex.setdefault(r['period'], []).append({'name': r['name'], 'dfax': r['dfax'], 'hours': int(r['hours']), 'contrib_sum': r['contrib_sum'],
                                               'contrib': r['contrib_sum'] / n if n and r['contrib_sum'] is not None else None})
    for rows in ex.values(): rows.sort(key=lambda x: -abs(x['contrib'] or 0))
    return {'key': key, 'link': link, 'periods': periods, 'exact': ex, 'system': {r['period']: r for r in system},
            'source': 'unified fact_constraint_hourly × fact_lmp_hourly (settled); fact_pcr_binding_hourly × fact_fcst_lmp_hourly (solved); fact_pcr_cong_impact × dim_pcr_resource × stg_pcr_bus_pnode (exact DFAX)',
            'rules': {
                'association': 'Settled records carry no shift factor. assoc = (mean MCC in the hours the constraint bound − mean MCC in every other hour) × binding hours ÷ year hours, $/MWh on the annual mean MCC. Two constraints binding in the same hours share it: an association, not an attribution.',
                'exact': 'Where the bus\'s PCR price node hosts a unit, the run publishes its DFAX. contrib = Σ shadow × DFAX ÷ run hours, the constraint\'s own share of the annual mean MCC; the shares sum to it (settled sign).',
                'excluded': 'Reserve requirements (SYSTEM_*) and external-node limits (NODE_*) are not network constraints; the PCR energy-balance row (unnamed, limit −0.0003 MW) is excluded.',
                'real_time_hours': 'A real-time hour counts once however many five-minute intervals bound; shadow = the largest |shadow| in that hour.',
                'sign': 'MCC on the settlement sign: − = priced below the system energy price (a pocket), + = a premium. Run congestion negated once at read.',
                'not_held': 'PROBE 5yr and 10yr binding records are not in the unified database; the Studio copy\'s headline row is shown for those runs, labelled.'}}


_STUDIO = None


def studio(c, key):
    global _STUDIO
    if key in ('all', 'hub'): return None
    if _STUDIO is None:
        if not STUDIO_FILE.exists(): return None
        _STUDIO = json.loads(STUDIO_FILE.read_text(encoding='utf-8'))
    entry = _STUDIO['buses'].get(str(int(key)))
    if entry is None: return None
    return {'key': key, 'meta': _STUDIO['meta'], 'bus': entry, 'zonesVsHub': _STUDIO['zonesVsHub'], 'zoneNegHours': _STUDIO['zoneNegHours'],
            'extracted_by': 'plan/extract_prices.py (read-only copy of studio/src/data.js + data-ext.js)'}


def fleet(c, key):
    if key != 'all': return None
    lp = busdata.link_params(c)  # every bus at its RESOLVED price node (D-008); == mart_bus_year unless re-linked
    bus_rt = _rows(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                          SELECT l.bus_id, p.y, p.avg_lmp, p.n_hours FROM l JOIN pn_year p USING (pnode_name) WHERE p.market = ?''', lp + ['RT'])
    years = sorted({r['y'] for r in bus_rt})
    pos = {y: i for i, y in enumerate(years)}
    rt, hours = {}, {}
    for r in bus_rt:
        rt.setdefault(str(r['bus_id']), [None] * len(years))[pos[r['y']]] = r['avg_lmp']
        hours[r['y']] = max(hours.get(r['y']) or 0, r['n_hours'] or 0)
    # Solar-window capture ratio (mart window hours 9–16) per bus-year, then the spread across buses (bus-weighted).
    cap = _rows(c, '''
        WITH p AS (SELECT pnode_name, market, year(ts) AS y, avg(lmp) FILTER (WHERE hour(ts) BETWEEN 9 AND 16) AS s, avg(lmp) AS a
                   FROM fact_lmp_hourly WHERE market = 'RT' GROUP BY 1, 2, 3),
             l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name),
             b AS (SELECT l.bus_id, p.y, p.s / nullif(p.a, 0) AS ratio FROM l JOIN p USING (pnode_name))
        SELECT y, count(*) AS buses, quantile_cont(ratio, 0.1) AS p10, quantile_cont(ratio, 0.5) AS p50, quantile_cont(ratio, 0.9) AS p90
        FROM b WHERE ratio IS NOT NULL GROUP BY 1 ORDER BY 1''', lp)
    fcap = _rows(c, '''
        WITH b AS (SELECT scenario, bus_id, avg(lmp) FILTER (WHERE hour BETWEEN 9 AND 16) / nullif(avg(lmp), 0) AS ratio
                   FROM fact_fcst_lmp_hourly GROUP BY 1, 2)
        SELECT scenario, count(*) AS buses, quantile_cont(ratio, 0.1) AS p10, quantile_cont(ratio, 0.5) AS p50, quantile_cont(ratio, 0.9) AS p90
        FROM b WHERE ratio IS NOT NULL GROUP BY 1''')
    fmean = _rows(c, '''SELECT scenario, count(*) AS buses, quantile_cont(avg_lmp, 0.1) AS p10, quantile_cont(avg_lmp, 0.5) AS p50,
                               quantile_cont(avg_lmp, 0.9) AS p90 FROM mart_bus_fcst_year GROUP BY 1''')
    zone = _rows(c, '''SELECT pnode_name AS ref, market, y, n_hours, avg_lmp, p95, neg_hours, hours_gt_200, avg_cong
                       FROM pn_year WHERE pnode_name LIKE '.Z.%' OR pnode_name = ? ORDER BY 1, 2, 3''', [HUB_PNODE])
    for r in zone: r['zone'] = ZONE_LABEL.get(r['ref'], r['ref'])
    return {'years': years, 'calendarHoursHeld': hours, 'rtMean': rt, 'capture': cap, 'fcstCapture': fcap, 'fcstMean': fmean, 'zones': zone,
            'source': 'unified pn_year × busdata.price_links (RT mean per bus-year at the resolved node, D-008); fact_lmp_hourly × price_links (solar-window ratio, hours 9–16); fact_fcst_lmp_hourly; pn_year (.Z.* zones, hub)',
            'note': 'Fleet spreads are across the 2,678 geolocated buses, so one price series shared by several buses counts once per bus (bus-weighted, as the Studio ranks).'}


ROUTES = {'summary': summary, 'zones': zones, 'constraints': constraints, 'studio': studio, 'fleet': fleet}
