"""Market dashboard aggregates over the unified DuckDB (read-only). GET /api/x/market/<name>/all.

Every figure is computed here from the unified database; None = not held (never 0). Parameterised SQL only.
Routes (key must be 'all'):
  measures  per-bus screening measures beyond /api/market (price history by year, 2025 risk/revenue stats,
            forecast runs, 2030 TB4 and solar-window ratio, hour-matched basis vs own zone and vs hub, outlets)
  zones     load-zone and hub price by year and market (hour-matched basis vs hub, negative hours), 2025 by month
  system    ISO generation by fuel (fact_genfuel_hourly), system load and day-ahead load forecast, interchange
  supply    generator capacity by zone, retirements, queue (unified dim_queue, zone by nearest bus)
"""
import math

import busdata

ZONE_PNODE = {'ME': '.Z.MAINE', 'NH': '.Z.NEWHAMPSHIRE', 'VT': '.Z.VERMONT', 'CT': '.Z.CONNECTICUT', 'RI': '.Z.RHODEISLAND',
              'SEMA': '.Z.SEMASS', 'WCMA': '.Z.WCMASS', 'NEMA': '.Z.NEMASSBOST'}
HUB = '.H.INTERNAL_HUB'
YEAR = busdata.SCREEN_YEAR  # 2025, the last complete settled year
RUNS = ['5yr', 'pcr2030', '10yr', 'pcr2035', 'pcr2040']
SOLAR_HOURS = (9, 16)  # hour-beginning 9..16 = HE 10-17: the mart window, one label everywhere (FORMULAS D5 "hours 9–16"; S2-D 2026-10-07)
SRC = 'unified ISONE_GridSense_unified.duckdb'


def _zone_values():
    return ', '.join('(?, ?)' for _ in ZONE_PNODE), [x for kv in ZONE_PNODE.items() for x in kv]


def measures(c, key):
    if key != 'all': return None
    R = busdata.rows
    out = {}
    L = busdata.price_links(c)['links']  # the ONE resolved link (D-008): a re-linked bus is priced at its new node
    lp = busdata.link_params(c)
    buses = R(c, '''SELECT b.bus_id, b.total_outlets, b.rsp_area, b.load_zone, b.load_zone_source
                    FROM dim_bus b WHERE b.latitude IS NOT NULL''')
    buses = [dict(b, pnode_name=L[b['bus_id']]['pnode_name']) for b in buses if b['bus_id'] in L]
    for b in buses:
        out[str(b['bus_id'])] = {'outlets': b['total_outlets'], 'rsp': b['rsp_area'], 'zsrc': b['load_zone_source'], 'y': {}, 'n': {}, 'cl': {}, 'f': {}}
    get = lambda bid: out.get(str(bid))
    for r in R(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                     SELECT l.bus_id, p.y, p.n_hours, p.avg_lmp, p.std_lmp, p.p5, p.p95, p.neg_hours, p.hours_gt_200, p.avg_cong, p.avg_loss,
                            p.peak_lmp, p.offpeak_lmp
                     FROM l JOIN pn_year p USING (pnode_name) WHERE p.market=? ORDER BY l.bus_id, p.y''', lp + ['RT']):
        o = get(r['bus_id'])
        if o is None: continue
        y = str(r['y']); o['y'][y] = r['avg_lmp']
        if r['n_hours'] < 0.95 * (8784 if r['y'] % 4 == 0 else 8760): o['n'][y] = r['n_hours']  # partial year: hours held
        o['cl'][y] = None if r['avg_cong'] is None or r['avg_loss'] is None else r['avg_cong'] + r['avg_loss']
        if r['y'] == YEAR:
            o.update(std=r['std_lmp'], p5=r['p5'], p95=r['p95'], neg=_int(r['neg_hours']), h200=_int(r['hours_gt_200']),
                     cong=r['avg_cong'], loss=r['avg_loss'], peak=r['peak_lmp'], offpeak=r['offpeak_lmp'])
    for r in R(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                     SELECT l.bus_id, p.avg_lmp FROM l JOIN pn_year p USING (pnode_name) WHERE p.market=? AND p.y=?''', lp + ['DA', YEAR]):
        o = get(r['bus_id'])
        if o is not None: o['da'] = r['avg_lmp']
    for r in R(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                     SELECT l.bus_id, p.tb2, p.tb4, p.tb8, p.n_days FROM l JOIN pn_tb p USING (pnode_name) WHERE p.market=? AND p.y=?''', lp + ['RT', YEAR]):
        o = get(r['bus_id'])
        if o is not None: o.update(tb2=r['tb2'], tb4=r['tb4'], tb8=r['tb8'], tbDays=r['n_days'])
    unpriced = set()
    for r in R(c, 'SELECT scenario, bus_id, avg_lmp, min_lmp, max_lmp, p5, p95, neg_hours, n_hours FROM mart_bus_fcst_year'):
        o = get(r['bus_id'])
        if o is None: continue
        if r['min_lmp'] == 0 and r['max_lmp'] == 0:  # run node with LMP = 0 in every hour: unpriced, not a $0 price
            o.setdefault('unpriced', []).append(r['scenario'])
            if r['scenario'] == 'pcr2030': unpriced.add(r['bus_id'])
            continue
        o['f'][r['scenario']] = r['avg_lmp']
        if r['scenario'] == 'pcr2030': o.update(p5_30=r['p5'], p95_30=r['p95'], neg30=_int(r['neg_hours']), hours30=r['n_hours'])
    # 2030 (pcr2030 run): mean daily top-4 less bottom-4 hours, and the solar-window mean over the flat mean.
    for r in R(c, '''WITH d AS (SELECT bus_id, study_date, lmp,
                        row_number() OVER (PARTITION BY bus_id, study_date ORDER BY lmp DESC) rd,
                        row_number() OVER (PARTITION BY bus_id, study_date ORDER BY lmp ASC) ra,
                        count(*) OVER (PARTITION BY bus_id, study_date) n
                      FROM fact_fcst_lmp_hourly WHERE scenario=?)
                     SELECT bus_id, count(*) AS n_days, avg(t4) AS tb4 FROM (
                       SELECT bus_id, study_date, avg(CASE WHEN rd<=4 THEN lmp END) - avg(CASE WHEN ra<=4 THEN lmp END) AS t4
                       FROM d WHERE n>=8 GROUP BY 1,2) GROUP BY 1''', ['pcr2030']):
        o = get(r['bus_id'])
        if o is not None and r['bus_id'] not in unpriced: o.update(tb4_30=r['tb4'], tbDays30=r['n_days'])
    for r in R(c, '''SELECT bus_id, avg(lmp) AS flat, avg(CASE WHEN hour BETWEEN ? AND ? THEN lmp END) AS sol
                     FROM fact_fcst_lmp_hourly WHERE scenario=? GROUP BY 1''', [SOLAR_HOURS[0], SOLAR_HOURS[1], 'pcr2030']):
        o = get(r['bus_id'])
        if o is not None and r['bus_id'] not in unpriced and r['flat'] and r['sol'] is not None: o['solwin30'] = r['sol'] / r['flat']
    # Hour-matched 2025 RT basis of each bus's price node vs its own load-zone node and vs the hub.
    vals, params = _zone_values()
    basis = {}
    for r in R(c, f'''WITH zmap(zone, zp) AS (VALUES {vals}),
        l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name),
        bp AS (SELECT DISTINCT l.pnode_name, b.load_zone FROM l JOIN dim_bus b USING(bus_id) WHERE b.latitude IS NOT NULL),
        pairs AS (SELECT bp.pnode_name, bp.load_zone, zmap.zp FROM bp JOIN zmap ON zmap.zone=bp.load_zone),
        x AS (SELECT pnode_name, ts, avg(lmp) AS lmp FROM fact_lmp_hourly
              WHERE market=? AND ts >= ? AND ts < ? AND pnode_name IN (SELECT pnode_name FROM pairs UNION SELECT zp FROM pairs UNION SELECT ?)
              GROUP BY 1,2)
        SELECT pr.pnode_name, pr.load_zone, count(*) AS n, avg(a.lmp - z.lmp) AS bz, avg(a.lmp - h.lmp) AS bh
        FROM pairs pr JOIN x a ON a.pnode_name=pr.pnode_name JOIN x z ON z.pnode_name=pr.zp AND z.ts=a.ts
        JOIN x h ON h.pnode_name=? AND h.ts=a.ts GROUP BY 1,2''',
                   params + lp + ['RT', f'{YEAR}-01-01', f'{YEAR + 1}-01-01', HUB, HUB]):
        basis[(r['pnode_name'], r['load_zone'])] = r
    for b in buses:
        r = basis.get((b['pnode_name'], b['load_zone']))
        if r: out[str(b['bus_id'])].update(bZone=r['bz'], bHub=r['bh'], bHours=r['n'])
    for o in out.values():
        for k in ('n', 'cl', 'f'):
            if not o[k]: del o[k]
    return {'source': f'{SRC}: pn_year / pn_tb at each bus resolved price node (busdata.price_links, D-008; = mart_bus_* unless re-linked), mart_bus_fcst_year, fact_fcst_lmp_hourly (pcr2030), fact_lmp_hourly (RT {YEAR}), dim_bus',
            'year': YEAR, 'runs': RUNS, 'solarWindow': 'hour-beginning 9-16 (HE 10-17), the mart solar window (FORMULAS D5)',
            'rules': {'tb4_30': 'pcr2030 run: mean over days of (mean of the 4 dearest hours - mean of the 4 cheapest); days with < 8 hours skipped',
                      'solwin30': 'pcr2030 run: mean LMP in hours 9-16 (HE 10-17) / mean LMP of all hours (a window ratio, not an output-weighted capture)',
                      'bZone': f'RT {YEAR}: mean over matched hours of (bus price node - own load-zone node); each node averaged per timestamp first',
                      'bHub': f'RT {YEAR}: mean over matched hours of (bus price node - {HUB})',
                      'cl': 'RT settled: mean congestion + mean loss component per year (basis against the system energy component)'},
            'unpriced': 'a run whose LMP is 0 in every hour at the bus is listed in unpriced[] and carries no value',
            'buses': _round(out)}


def zones(c, key):
    if key != 'all': return None
    R = busdata.rows
    names = list(ZONE_PNODE.values()) + [HUB]
    inv = {v: k for k, v in ZONE_PNODE.items()}; inv[HUB] = 'HUB'
    ph = ', '.join('?' for _ in names)
    yearly = R(c, f'''WITH x AS (SELECT pnode_name, market, ts, avg(lmp) lmp, avg(energy) energy, avg(congestion) cong, avg(loss) loss
                                FROM fact_lmp_hourly WHERE pnode_name IN ({ph}) GROUP BY 1,2,3),
                       h AS (SELECT market, ts, lmp FROM x WHERE pnode_name=?)
                  SELECT x.pnode_name, x.market, year(x.ts) AS y, count(*) AS hours, avg(x.lmp) AS lmp, avg(x.energy) AS energy,
                         avg(x.cong) AS cong, avg(x.loss) AS loss, sum(CASE WHEN x.lmp < 0 THEN 1 ELSE 0 END) AS neg,
                         sum(CASE WHEN x.lmp > 200 THEN 1 ELSE 0 END) AS h200, quantile_cont(x.lmp, 0.05) AS p5, quantile_cont(x.lmp, 0.95) AS p95,
                         stddev_samp(x.lmp) AS std, avg(x.lmp - h.lmp) AS bhub, count(h.lmp) AS matched
                  FROM x LEFT JOIN h ON h.market=x.market AND h.ts=x.ts
                  GROUP BY 1,2,3 ORDER BY 1,2,3''', names + [HUB])
    monthly = R(c, f'''WITH x AS (SELECT pnode_name, ts, avg(lmp) lmp FROM fact_lmp_hourly
                                 WHERE market=? AND ts >= ? AND ts < ? AND pnode_name IN ({ph}) GROUP BY 1,2)
                   SELECT pnode_name, month(ts) AS m, count(*) AS hours, avg(lmp) AS lmp, sum(CASE WHEN lmp < 0 THEN 1 ELSE 0 END) AS neg
                   FROM x GROUP BY 1,2 ORDER BY 1,2''', ['RT', f'{YEAR}-01-01', f'{YEAR + 1}-01-01'] + names)
    buses = R(c, '''SELECT load_zone AS zone, count(*) AS n, sum(CASE WHEN load_zone_source='pnode' THEN 1 ELSE 0 END) AS by_pnode
                    FROM dim_bus WHERE latitude IS NOT NULL GROUP BY 1 ORDER BY 1''')
    src = R(c, 'SELECT load_zone_source AS source, count(*) AS n FROM dim_bus WHERE latitude IS NOT NULL GROUP BY 1 ORDER BY 2 DESC')
    return {'source': f'{SRC}: fact_lmp_hourly at the eight .Z load-zone nodes and {HUB} (each node averaged per timestamp first), dim_bus',
            'hub': HUB, 'zonePnode': ZONE_PNODE,
            'years': [dict(r, zone=inv[r['pnode_name']], neg=_int(r['neg']), h200=_int(r['h200'])) for r in yearly],
            'months': {'year': YEAR, 'market': 'RT', 'rows': [dict(r, zone=inv[r['pnode_name']], neg=_int(r['neg'])) for r in monthly]},
            'buses': buses, 'zoneSource': src}


def system(c, key):
    if key != 'all': return None
    R = busdata.rows
    # Generation by fuel: snapshots are sub-hourly and irregular, so each fuel is averaged within the clock hour
    # (MW ~ MWh for that hour) and the hours are summed. The feed lists a fuel only when it reports output, so an
    # hour with no row for a fuel contributes nothing; hours covered are stated per year.
    gen = R(c, '''WITH h AS (SELECT date_trunc('hour', ts) AS hr, fuel_type, avg(generation_mw) AS mw FROM fact_genfuel_hourly GROUP BY 1,2)
                  SELECT year(hr) AS y, fuel_type AS fuel, sum(mw) AS mwh, count(*) AS hours FROM h GROUP BY 1,2 ORDER BY 1,2''')
    gen_hours = R(c, "SELECT year(date_trunc('hour', ts)) AS y, count(DISTINCT date_trunc('hour', ts)) AS hours FROM fact_genfuel_hourly GROUP BY 1 ORDER BY 1")
    gen_month = R(c, '''WITH h AS (SELECT date_trunc('hour', ts) AS hr, fuel_type, avg(generation_mw) AS mw FROM fact_genfuel_hourly
                                   WHERE ts >= ? AND ts < ? GROUP BY 1,2)
                        SELECT month(hr) AS m, fuel_type AS fuel, sum(mw) AS mwh FROM h GROUP BY 1,2 ORDER BY 1,2''', [f'{YEAR}-01-01', f'{YEAR + 1}-01-01'])
    gen_hod = R(c, '''WITH h AS (SELECT date_trunc('hour', ts) AS hr, fuel_type, avg(generation_mw) AS mw FROM fact_genfuel_hourly
                                 WHERE ts >= ? AND ts < ? GROUP BY 1,2),
                           hrs AS (SELECT hour(hr) AS hod, count(DISTINCT hr) AS n FROM h GROUP BY 1)
                      SELECT hour(h.hr) AS hod, h.fuel_type AS fuel, sum(h.mw) / max(hrs.n) AS mw
                      FROM h JOIN hrs ON hrs.hod=hour(h.hr) GROUP BY 1,2 ORDER BY 1,2''', [f'{YEAR}-01-01', f'{YEAR + 1}-01-01'])
    load = R(c, '''WITH x AS (SELECT ts, avg(load_mw) AS mw FROM fact_load_hourly WHERE zone=? GROUP BY 1)
                   SELECT year(ts) AS y, count(*) AS hours, sum(mw) AS mwh, avg(mw) AS mean_mw, max(mw) AS peak_mw, min(mw) AS min_mw,
                          arg_max(ts, mw) AS peak_ts, quantile_cont(mw, 0.95) AS p95_mw FROM x GROUP BY 1 ORDER BY 1''', ['SYSTEM'])
    load_month = R(c, '''WITH x AS (SELECT ts, avg(load_mw) AS mw FROM fact_load_hourly WHERE zone=? GROUP BY 1)
                         SELECT year(ts) AS y, month(ts) AS m, count(*) AS hours, avg(mw) AS mean_mw, max(mw) AS peak_mw FROM x GROUP BY 1,2 ORDER BY 1,2''', ['SYSTEM'])
    fc = R(c, '''WITH a AS (SELECT ts, avg(load_mw) AS mw FROM fact_load_hourly WHERE zone=? GROUP BY 1),
                      f AS (SELECT ts, avg(forecast_mw) AS mw FROM fact_load_forecast WHERE zone=? GROUP BY 1)
                 SELECT year(f.ts) AS y, count(f.mw) AS fc_hours, count(a.mw) AS matched, avg(f.mw) AS fc_mean, max(f.mw) AS fc_peak,
                        avg(abs(f.mw - a.mw) / a.mw) * 100 AS mape, avg(f.mw - a.mw) AS bias_mw
                 FROM f LEFT JOIN a ON a.ts=f.ts GROUP BY 1 ORDER BY 1''', ['SYSTEM', 'SYSTEM'])
    ic = R(c, '''WITH x AS (SELECT interface, ts, avg(flow_mw) AS mw FROM fact_interchange_hourly GROUP BY 1,2)
                 SELECT interface, year(ts) AS y, count(*) AS hours, avg(mw) AS mean_mw, sum(mw) AS mwh, min(mw) AS min_mw, max(mw) AS max_mw
                 FROM x GROUP BY 1,2 ORDER BY 1,2''')
    return {'source': f'{SRC}: fact_genfuel_hourly (region ISONE), fact_load_hourly + fact_load_forecast (zone SYSTEM), fact_interchange_hourly',
            'rules': {'gen': 'each fuel averaged within the clock hour, then summed over hours (MWh); a fuel absent from an hour adds nothing',
                      'load': 'SYSTEM hourly load; energy = sum of hourly MW; a partial year is never annualised',
                      'forecast': 'the day-ahead posted system load forecast against actual load in the same hour; MAPE = mean |F-A|/A',
                      'interchange': 'hourly flow per external interface, sign as published by ISO-NE'},
            'gen': gen, 'genHours': gen_hours, 'genMonth': {'year': YEAR, 'rows': gen_month}, 'genHod': {'year': YEAR, 'rows': gen_hod},
            'load': load, 'loadMonth': load_month, 'forecast': fc, 'interchange': ic}


def _hav(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


RETIRE_ZONE = {'NEMA/BOSTON': 'NEMA', 'WMA/CMA': 'WCMA', 'CT': 'CT', 'SEMA': 'SEMA', 'VT': 'VT', 'NH': 'NH', 'ME': 'ME', 'RI': 'RI'}


def supply(c, key):
    if key != 'all': return None
    R = busdata.rows
    gen = R(c, '''SELECT b.load_zone AS zone, g.status, count(*) AS units, sum(g.max_capacity_mw) AS cap_mw, sum(g.gen_mw) AS gen_mw
                  FROM dim_generator g LEFT JOIN dim_bus b ON b.bus_id=g.bus_id GROUP BY 1,2 ORDER BY 1,2''')
    ret = R(c, '''SELECT year, month, plant_name, resource_id, load_zone, try_cast(net_capacity_mw AS DOUBLE) AS mw, plant_county, plant_state
                  FROM dim_retirement ORDER BY try_cast(year AS INTEGER), try_cast(month AS INTEGER), plant_name''')
    for r in ret: r['zone'] = RETIRE_ZONE.get(r['load_zone'])  # 'MA' names a state, not a zone: left unattributed
    q = R(c, '''SELECT queue_position, request_date, poi_name, max_mw, summer_mw_modelled, county, state, projected_is_date,
                       resource_type, status, latitude, longitude FROM dim_queue ORDER BY queue_position''')
    bus = R(c, 'SELECT bus_id, load_zone, latitude, longitude FROM dim_bus WHERE latitude IS NOT NULL')
    for r in q:
        r['zone'] = None; r['nearKm'] = None; r['nearBus'] = None
        if r['latitude'] is None or r['longitude'] is None: continue
        best = min(bus, key=lambda b: _hav(r['latitude'], r['longitude'], b['latitude'], b['longitude']))
        d = _hav(r['latitude'], r['longitude'], best['latitude'], best['longitude'])
        r['nearKm'] = d; r['nearBus'] = best['bus_id']
        if d <= 25: r['zone'] = best['load_zone']
    return {'source': f'{SRC}: dim_generator (+ dim_bus zone), dim_retirement, dim_queue (+ nearest geolocated dim_bus)',
            'rules': {'queueZone': 'load zone of the nearest geolocated bus within 25 km of the queue coordinates (an attribution, not a bus key)',
                      'retireZone': 'NEMA/BOSTON -> NEMA, WMA/CMA -> WCMA; a row naming only MA is left unattributed'},
            'generators': gen, 'retirements': ret, 'queue': q}


def _round(v):
    if isinstance(v, float): return round(v, 4)
    if isinstance(v, dict): return {k: _round(x) for k, x in v.items()}
    if isinstance(v, list): return [_round(x) for x in v]
    return v


def _int(v):
    return None if v is None else int(v)


ROUTES = {'measures': measures, 'zones': zones, 'system': system, 'supply': supply}
