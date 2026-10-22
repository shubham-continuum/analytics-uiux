"""Grid dashboard data endpoints (read-only). Served at GET /api/x/grid/<name>/<bus id>.

  context      — the bus's substation record, the elements at the connection point, the local network
                 (lines, substations with their envelopes), short-circuit strength against neighbours,
                 planned upgrades, retirements, generators and queue requests nearby, how often this
                 bus's limiting facilities bind in the PCR runs, and the older study copy for data notes.
  constraints  — binding constraints by period at this bus (settled DA/RT and the PCR runs): the bus's
                 own congestion component (MCC) in the hours a constraint bound against every other hour
                 (an association), and the run's exact share where the bus's PCR price node hosts a unit.
  curtailment  — the headroom study's injection test at 100 / 250 / 500 MW (older study copy), the PCR
                 runs' solar and wind units at the bus's price node, and hours priced at or below $0.

Sources: the unified DuckDB (busdata.connect(), read-only) is primary. The injection test and the older
envelope/limit copy come from ISONE_GridSense.duckdb, opened read-only and labelled as the older copy.
Every missing value is None (not held), never 0. Parameterised SQL only.
"""
import math
import re
from pathlib import Path

import duckdb

import busdata

OLD_DB = Path(busdata.SOURCE).parents[1] / 'ISONE_GridSense.duckdb'
OLD_LABEL = 'Vendor/Studio copy (older database ISONE_GridSense.duckdb, headroom vintage 2026-05)'
RADIUS_MAP_MI = 20.0
RADIUS_NEAR_MI = 50.0
PCR_RUNS = ('pcr2030', 'pcr2035', 'pcr2040')
RUN_YEAR = {'5yr': 2028, 'pcr2030': 2030, '10yr': 2035, 'pcr2035': 2035, 'pcr2040': 2040}
SETTLED = (('DA', 2024), ('RT', 2024), ('DA', 2025), ('RT', 2025))
FACILITY_FIXED = re.compile(r'^\s*(\d{4,7}) (.{12})\s*(\d+(?:\.\d+)?)\s+(\d{4,7}) (.{12})\s*(\d+(?:\.\d+)?)\s+(\S+)\s*$')
FACILITY_RX = re.compile(r'^\s*(\d{4,7})\s(.{1,12}?)\s*(\d+(?:\.\d+)?)\s+(\d{4,7})\s(.{1,12}?)\s*(\d+(?:\.\d+)?)\s+(\S+)\s*$')


# ---------- pure helpers (tests/grid-api.test.mjs exercises them through the route) ----------
def f(v):
    """Finite float or None."""
    if v is None:
        return None
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def miles(lat1, lon1, lat2, lon2):
    """Great-circle distance in statute miles; None when a coordinate is not held."""
    vals = [f(x) for x in (lat1, lon1, lat2, lon2)]
    if any(v is None for v in vals):
        return None
    la1, lo1, la2, lo2 = map(math.radians, vals)
    a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.7613 * 2 * math.asin(min(1.0, math.sqrt(a)))


def parse_facility(s):
    """PSS/E fixed-width facility 'AAAAAA NAME KV  BBBBBB NAME KV  CKT' → dict, or None."""
    m = FACILITY_FIXED.match(str(s or '')) or FACILITY_RX.match(str(s or ''))  # fixed 12-char names first
    if not m:
        return None
    a, b = int(m.group(1)), int(m.group(4))
    return {'a': a, 'a_name': m.group(2).strip(), 'kv': f(m.group(3)), 'b': b, 'b_name': m.group(5).strip(),
            'ckt': m.group(7).strip(), 'key': f'{min(a, b)}-{max(a, b)}-{m.group(7).strip()}'}


def association(hours, n, sum_on, sum_all):
    """The bus's MCC in a constraint's binding hours against every other hour (same rule as the live Studio).
    assoc = (mcc_on − mcc_off) × hours ÷ n, $/MWh on the annual mean MCC. Binding every hour → None."""
    hours, n = int(hours or 0), int(n or 0)
    if hours <= 0 or n <= 0 or f(sum_on) is None:
        return {'mcc_on': None, 'mcc_off': None, 'assoc': None}
    on = f(sum_on) / hours
    off = (f(sum_all) - f(sum_on)) / (n - hours) if n > hours and f(sum_all) is not None else None
    return {'mcc_on': on, 'mcc_off': off, 'assoc': (on - off) * hours / n if off is not None else None}


def _bus(c, key):
    if not re.fullmatch(r'\d{1,9}', str(key)):
        return None
    r = busdata.rows(c, 'SELECT * FROM dim_bus WHERE bus_id=? AND latitude IS NOT NULL', [int(key)])
    return r[0] if r else None


def _old():
    return duckdb.connect(str(OLD_DB), read_only=True) if OLD_DB.exists() else None


# ---------- context ----------
def context(c, key):
    bus = _bus(c, key)
    if bus is None:
        return None
    bid, lat, lon = int(bus['bus_id']), bus['latitude'], bus['longitude']
    sub = (busdata.rows(c, 'SELECT * FROM dim_substation WHERE bus_id=?', [bid]) or [None])[0]

    # Short-circuit strength: this bus against every geolocated substation and its nearest neighbours.
    subs = busdata.rows(c, 'SELECT bus_id, substation_name, nominal_kv, latitude, longitude, short_circuit_mva, max_injection_ccis_mw, total_outlets FROM dim_substation WHERE latitude IS NOT NULL')
    hr = {}
    for r in busdata.rows(c, "SELECT bus_id, scenario, direction, headroom_mw FROM fact_headroom"):
        hr.setdefault(int(r['bus_id']), {})[f"{r['scenario']}|{r['direction']}"] = f(r['headroom_mw'])
    for s in subs:
        s['mi'] = miles(lat, lon, s['latitude'], s['longitude'])
    sc_all = sorted(v for v in (f(s['short_circuit_mva']) for s in subs) if v is not None)
    sc_kv = sorted(v for v in (f(s['short_circuit_mva']) for s in subs if f(s['nominal_kv']) == f(bus['nominal_kv'])) if v is not None)
    own_sc = f(sub['short_circuit_mva']) if sub else f(bus['short_circuit_mva'])
    near = sorted((s for s in subs if s['bus_id'] != bid and s['mi'] is not None), key=lambda s: s['mi'])
    neighbours = [{'bus_id': s['bus_id'], 'name': s['substation_name'], 'kv': f(s['nominal_kv']), 'mi': s['mi'],
                   'sc_mva': f(s['short_circuit_mva']), 'env_sp_dis': hr.get(int(s['bus_id']), {}).get('summer_peak|discharge'),
                   'env_sp_chg': hr.get(int(s['bus_id']), {}).get('summer_peak|charge')} for s in near[:12]]
    sc = {'own': own_sc, 'all': {'n': len(sc_all), 'below': sum(v < own_sc for v in sc_all) if own_sc is not None else None,
                                 'p25': _pct(sc_all, .25), 'p50': _pct(sc_all, .5), 'p75': _pct(sc_all, .75)},
          'kv': {'kv': f(bus['nominal_kv']), 'n': len(sc_kv), 'below': sum(v < own_sc for v in sc_kv) if own_sc is not None else None,
                 'p25': _pct(sc_kv, .25), 'p50': _pct(sc_kv, .5), 'p75': _pct(sc_kv, .75)},
          'source': 'unified dim_substation.short_circuit_mva (corrected ×100 per data_quality)'}

    # Station set: this bus plus buses tied to it by a same-named branch (vendor spine buses tie to model buses at 0 MVA).
    br_all = busdata.rows(c, 'SELECT line_name, from_bus_id, from_bus_name, to_bus_id, to_bus_name, circuit_id, voltage, status, rated_base_mva, rated_base_mva_1, from_latitude, from_longitude, to_latitude, to_longitude FROM dim_branch')
    station = {bid}
    for b in br_all:
        if bid in (b['from_bus_id'], b['to_bus_id']) and (b['from_bus_name'] or '').strip().lower() == (b['to_bus_name'] or '').strip().lower():
            station.add(int(b['from_bus_id'])); station.add(int(b['to_bus_id']))
    ids = sorted(station)
    elements = {
        'station': ids,
        'branches': [_branch(b) for b in br_all if b['from_bus_id'] in station or b['to_bus_id'] in station],
        'transformers': busdata.rows(c, '''SELECT from_transformer_number AS f, from_transformer_name AS fname, to_transformer_number AS t, to_transformer_name AS tname,
                    transformer_voltage AS kv, circuit, status, rated_mva_limit_a AS rate_a, rated_mva_limit_b AS rate_b FROM dim_transformer
                    WHERE try_cast(from_transformer_number AS BIGINT) IN (SELECT unnest(?::BIGINT[])) OR try_cast(to_transformer_number AS BIGINT) IN (SELECT unnest(?::BIGINT[]))''', [ids, ids]),
        'generators': busdata.rows(c, 'SELECT bus_id, gen_name, id_code, status, gen_mw, max_capacity_mw FROM dim_generator WHERE bus_id IN (SELECT unnest(?::BIGINT[])) ORDER BY max_capacity_mw DESC NULLS LAST', [ids]),
        'loads': busdata.rows(c, 'SELECT bus_id, load_name, id_code, load_mw, load_mva, zone FROM dim_load WHERE bus_id IN (SELECT unnest(?::BIGINT[])) ORDER BY load_mw DESC NULLS LAST', [ids]),
    }
    for t in elements['transformers']:
        for k in ('rate_a', 'rate_b'):
            t[k] = f(t[k]) if f(t[k]) and f(t[k]) > 0 else None  # a 0 rating in the source is not held

    # Limiting facilities of this bus, located on the branch table, and how many other buses they limit.
    le = busdata.rows(c, 'SELECT scenario, direction, monitored_facility, transfer_mw, pct_loading_no_transfer FROM fact_limiting_element WHERE bus_id=? AND monitored_facility IS NOT NULL', [bid])
    keys = {}
    for r in le:
        p = parse_facility(r['monitored_facility'])
        if p:
            keys.setdefault(p['key'], p)
    by_key = {}
    for b in br_all:
        if b['from_bus_id'] is None or b['to_bus_id'] is None:
            continue
        k = f"{min(b['from_bus_id'], b['to_bus_id'])}-{max(b['from_bus_id'], b['to_bus_id'])}-{str(b['circuit_id'] or '').strip()}"
        by_key.setdefault(k, b)
    shared = {}
    if keys:
        for r in busdata.rows(c, '''SELECT monitored_facility, scenario, direction, count(DISTINCT bus_id) AS buses, min(transfer_mw) FILTER (WHERE transfer_mw > 0) AS min_transfer
                                    FROM fact_limiting_element WHERE monitored_facility IS NOT NULL GROUP BY 1, 2, 3'''):
            p = parse_facility(r['monitored_facility'])
            if p and p['key'] in keys:
                s = shared.setdefault(p['key'], {'buses': 0, 'cases': {}})
                s['cases'][f"{r['scenario']}|{r['direction']}"] = {'buses': r['buses'], 'min_transfer': f(r['min_transfer'])}
                s['buses'] = max(s['buses'], r['buses'])
    facilities = [{**p, 'located': k in by_key, 'line': _branch(by_key[k]) if k in by_key else None, 'shared': shared.get(k)} for k, p in keys.items()]

    # PCR runs: hours each of this bus's limiting facilities binds (same branch, any contingency), and interface flowgates.
    pcr = []
    if keys:
        for r in busdata.rows(c, '''SELECT scenario, monitored_facility, contingency, count(*) AS hours, avg(abs(shadow_price)) AS mean_abs, max(abs(shadow_price)) AS max_abs,
                                    sum(abs(shadow_price)) AS sum_abs FROM fact_pcr_binding_hourly WHERE monitored_facility IS NOT NULL GROUP BY 1, 2, 3'''):
            p = parse_facility(r['monitored_facility'])
            if p and p['key'] in keys:
                pcr.append({'run': r['scenario'], 'key': p['key'], 'facility': r['monitored_facility'].strip(), 'contingency': r['contingency'],
                            'hours': r['hours'], 'mean_abs_shadow': f(r['mean_abs']), 'max_abs_shadow': f(r['max_abs']), 'sum_abs_shadow': f(r['sum_abs'])})
    run_hours = {r['scenario']: r['n'] for r in busdata.rows(c, 'SELECT scenario, count(DISTINCT (study_date, hour)) AS n FROM fact_pcr_binding_hourly GROUP BY 1')}
    flowgates = busdata.rows(c, '''SELECT scenario AS run, flowgate_name AS name, count(*) AS hours, count(*) FILTER (WHERE abs(shadow_price) > 0) AS binding_hours,
                                   avg(abs(shadow_price)) FILTER (WHERE abs(shadow_price) > 0) AS mean_abs_shadow, max(abs(shadow_price)) AS max_abs_shadow,
                                   max(CASE WHEN max_flow > 0 AND max_flow < 9999 THEN abs(flow_mw) / max_flow END) AS max_util
                                   FROM fact_pcr_flowgate_hourly GROUP BY 1, 2 ORDER BY 1, 4 DESC''')
    for g in flowgates:
        p = parse_facility(g['name'])
        g['key'] = p['key'] if p else None
        g['this_bus'] = bool(p and p['key'] in keys)

    # The local network for the map: lines with an end within the radius, substations within it.
    lines = []
    for b in br_all:
        d1 = miles(lat, lon, b['from_latitude'], b['from_longitude']); d2 = miles(lat, lon, b['to_latitude'], b['to_longitude'])
        if d1 is not None and d2 is not None and min(d1, d2) <= RADIUS_MAP_MI:
            k = f"{min(b['from_bus_id'], b['to_bus_id'])}-{max(b['from_bus_id'], b['to_bus_id'])}-{str(b['circuit_id'] or '').strip()}"
            lines.append([f(b['from_latitude']), f(b['from_longitude']), f(b['to_latitude']), f(b['to_longitude']), b['voltage'], b['status'], k in keys, b['line_name']])
    map_subs = [[s['bus_id'], s['substation_name'], f(s['nominal_kv']), f(s['latitude']), f(s['longitude']), hr.get(int(s['bus_id']), {}).get('summer_peak|discharge'), f(s['short_circuit_mva'])]
                for s in subs if s['mi'] is not None and s['mi'] <= RADIUS_MAP_MI]

    # Planned upgrades, retirements, generators and queue requests nearby (context only; dates as published).
    tup = []
    for r in busdata.rows(c, 'SELECT transmission_upgrade, from_substation_name, to_substation_name, nominal_voltage_kv, expected_in_service_year, category, from_latitude, from_longitude, to_latitude, to_longitude FROM dim_transmission_upgrade'):
        d = [x for x in (miles(lat, lon, r['from_latitude'], r['from_longitude']), miles(lat, lon, r['to_latitude'], r['to_longitude'])) if x is not None]
        if d and min(d) <= RADIUS_NEAR_MI:
            tup.append({'kind': 'Transmission', 'name': r['transmission_upgrade'], 'where': f"{r['from_substation_name']} – {r['to_substation_name']}", 'kv': f(r['nominal_voltage_kv']),
                        'year': _int(r['expected_in_service_year']), 'category': r['category'], 'mi': min(d),
                        'geo': [f(r['from_latitude']), f(r['from_longitude']), f(r['to_latitude']), f(r['to_longitude'])]})
    for r in busdata.rows(c, 'SELECT substation_name, substation_upgrade, nominal_voltage_kv, expected_in_service_year, category, latitude, longitude FROM dim_substation_upgrade'):
        d = miles(lat, lon, r['latitude'], r['longitude'])
        if d is not None and d <= RADIUS_NEAR_MI:
            tup.append({'kind': 'Substation', 'name': r['substation_upgrade'], 'where': r['substation_name'], 'kv': f(r['nominal_voltage_kv']), 'year': _int(r['expected_in_service_year']),
                        'category': r['category'], 'mi': d, 'geo': [f(r['latitude']), f(r['longitude'])]})
    tup.sort(key=lambda x: x['mi'])
    ret = []
    for r in busdata.rows(c, 'SELECT year, month, plant_name, resource_id, load_zone, net_capacity_mw, plant_county, plant_state, latitude, longitude FROM dim_retirement'):
        d = miles(lat, lon, r['latitude'], r['longitude'])
        if d is not None and d <= RADIUS_NEAR_MI:
            ret.append({'name': r['plant_name'], 'resource_id': r['resource_id'], 'zone': r['load_zone'], 'mw': f(r['net_capacity_mw']), 'year': _int(r['year']), 'month': _int(r['month']),
                        'county': r['plant_county'], 'state': r['plant_state'], 'mi': d, 'geo': [f(r['latitude']), f(r['longitude'])]})
    ret.sort(key=lambda x: x['mi'])
    gens = []
    for r in busdata.rows(c, 'SELECT bus_id, gen_name, status, gen_mw, max_capacity_mw, latitude, longitude FROM dim_generator WHERE latitude IS NOT NULL'):
        d = miles(lat, lon, r['latitude'], r['longitude'])
        if d is not None and d <= 10.0:
            gens.append({'bus_id': r['bus_id'], 'name': r['gen_name'], 'status': r['status'], 'gen_mw': f(r['gen_mw']), 'max_mw': f(r['max_capacity_mw']), 'mi': d})
    gens.sort(key=lambda x: x['mi'])
    queue = []
    for r in busdata.rows(c, 'SELECT queue_position, poi_name, max_mw, resource_type, status, projected_is_date, interconnection_service_requested, latitude, longitude FROM dim_queue'):
        d = miles(lat, lon, r['latitude'], r['longitude'])
        if d is not None and d <= 25.0:
            queue.append({'qp': r['queue_position'], 'poi': r['poi_name'], 'mw': f(r['max_mw']), 'type': r['resource_type'], 'status': r['status'],
                          'is_date': r['projected_is_date'], 'service': r['interconnection_service_requested'], 'mi': d})
    queue.sort(key=lambda x: x['mi'])
    queue_unplaced = busdata.rows(c, 'SELECT count(*) AS n FROM dim_queue WHERE latitude IS NULL')[0]['n']

    return {'bus': {k: bus[k] for k in ('bus_id', 'bus_name', 'substation_name', 'nominal_kv', 'latitude', 'longitude', 'county', 'state_code', 'load_zone', 'pf_area')},
            'substation': sub, 'sc': sc, 'neighbours': neighbours, 'elements': elements, 'facilities': facilities,
            'pcr': pcr, 'pcr_run_hours': run_hours, 'flowgates': flowgates,
            'map': {'radius_mi': RADIUS_MAP_MI, 'lines': lines, 'subs': map_subs},
            'upgrades': tup, 'retirements': ret, 'generators': gens, 'queue': queue, 'queue_unplaced': queue_unplaced,
            'radius': {'upgrades_mi': RADIUS_NEAR_MI, 'retirements_mi': RADIUS_NEAR_MI, 'generators_mi': 10.0, 'queue_mi': 25.0},
            'older': _older(bid),
            'source': 'unified ISONE_GridSense_unified.duckdb (read-only): dim_bus, dim_substation, dim_branch, dim_transformer, dim_generator, dim_load, fact_headroom, fact_limiting_element, fact_pcr_binding_hourly, fact_pcr_flowgate_hourly, dim_transmission_upgrade, dim_substation_upgrade, dim_retirement, dim_queue'}


def _branch(b):
    ra, rb = f(b['rated_base_mva']), f(b['rated_base_mva_1'])
    return {'name': b['line_name'], 'from': b['from_bus_id'], 'from_name': b['from_bus_name'], 'to': b['to_bus_id'], 'to_name': b['to_bus_name'], 'ckt': b['circuit_id'],
            'kv': b['voltage'], 'status': b['status'], 'rate_a': ra if ra and ra > 0 else None, 'rate_b': rb if rb and rb > 0 else None}


def _int(v):
    v = f(v)
    return int(v) if v is not None else None


def _pct(sorted_vals, q):
    if not sorted_vals:
        return None
    i = q * (len(sorted_vals) - 1); lo = int(math.floor(i)); hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)


def _older(bid):
    """The older study copy for data notes: envelope per case and the summer-peak export element limit."""
    oc = _old()
    if oc is None:
        return None
    try:
        env = busdata.rows(oc, '''SELECT "Headroom Capacity (MW) Summer Peak NCIS Substation Discharging_gcd" AS sp_dis, "Headroom Capacity (MW) Summer Peak NCIS Substation Charging_gcd" AS sp_chg,
                                  "Headroom Capacity (MW) Shoulder NCIS Substation Discharging_gcd" AS sh_dis, "Headroom Capacity (MW) Shoulder NCIS Substation Charging_gcd" AS sh_chg,
                                  "Headroom Capacity (MW) Summer Peak Large Load Interconnection Substation Charging_gcd" AS ll_chg, "3 Phase Short Circuit (MVA)_gcd" AS sc_published
                                  FROM substations_corrected WHERE "Substation Bus Number_gcd" = ?''', [bid])
        lim = busdata.rows(oc, '''SELECT min("Power Injection (MW)") FILTER (WHERE "Power Injection (MW)" > 0 AND abs(coalesce("DC %Loading (No Transfer)", 0)) < 100) AS sp_dis_min, count(*) AS n
                                  FROM constraints_sp_sub_dis WHERE source_bus_id = ?''', [bid])
        e = env[0] if env else {}
        return {'label': OLD_LABEL, 'envelope': {'summer_peak|discharge': f(e.get('sp_dis')), 'summer_peak|charge': f(e.get('sp_chg')), 'shoulder|discharge': f(e.get('sh_dis')),
                                                 'shoulder|charge': f(e.get('sh_chg')), 'large_load|charge': f(e.get('ll_chg'))} if e else None,
                'sp_dis_element_min': f(lim[0]['sp_dis_min']) if lim else None, 'sp_dis_rows': lim[0]['n'] if lim else 0}
    finally:
        oc.close()


# ---------- constraints (association / exact) ----------
SETTLED_SQL = '''
WITH b AS (SELECT constraint_name AS k, date_trunc('hour', ts) AS h, max(abs(shadow_price)) AS mu FROM fact_constraint_hourly
           WHERE market = ? AND year(ts) = ? AND NOT regexp_matches(constraint_name, '^(SYSTEM_|NODE_)', 'i') GROUP BY 1, 2),
s AS (SELECT ts AS h, avg(congestion) AS c FROM fact_lmp_hourly WHERE market = ? AND year(ts) = ? AND pnode_name = ? GROUP BY 1),
tot AS (SELECT count(*) AS n, sum(c) AS sc FROM s),
j AS (SELECT b.k, count(*) AS hrs, sum(s.c) AS sc_on, avg(b.mu) AS mean_abs, max(b.mu) AS max_abs FROM b JOIN s ON s.h = b.h GROUP BY 1)
SELECT j.k AS name, j.hrs AS hours, tot.n AS n, j.sc_on AS sum_on, tot.sc AS sum_all, j.mean_abs, j.max_abs FROM tot LEFT JOIN j ON TRUE'''
SOLVED_SQL = '''
WITH b AS (SELECT coalesce(trim(monitored_facility) || ' · ' || trim(contingency), 'unnamed constraint ' || CAST(constr_index AS VARCHAR)) AS k,
                  study_date AS d, hour AS h, max(abs(shadow_price)) AS mu
           FROM fact_pcr_binding_hourly WHERE scenario = ? AND NOT (monitored_facility IS NULL AND abs(constraint_limit + 0.0003) < 1e-6) GROUP BY 1, 2, 3),
s AS (SELECT study_date AS d, hour AS h, -avg(congestion) AS c FROM fact_fcst_lmp_hourly WHERE scenario = ? AND bus_id = ? GROUP BY 1, 2),
tot AS (SELECT count(*) AS n, sum(c) AS sc FROM s),
j AS (SELECT b.k, count(*) AS hrs, sum(s.c) AS sc_on, avg(b.mu) AS mean_abs, max(b.mu) AS max_abs FROM b JOIN s ON s.d = b.d AND s.h = b.h GROUP BY 1)
SELECT j.k AS name, j.hrs AS hours, tot.n AS n, j.sc_on AS sum_on, tot.sc AS sum_all, j.mean_abs, j.max_abs FROM tot LEFT JOIN j ON TRUE'''
EXACT_SQL = '''
WITH units AS (SELECT r.bidder_index FROM stg_pcr_bus_pnode s JOIN dim_pcr_resource r ON r.pnode_index = s.pcr_pnode_index WHERE s.bus_id = ?),
x AS (SELECT c.constr_index, c.study_date, c.hour, avg(c.shadow_price) AS mu, avg(c.dfax) AS sf FROM fact_pcr_cong_impact c
      WHERE c.scenario = ? AND c.bidder_index IN (SELECT bidder_index FROM units) GROUP BY 1, 2, 3),
lab AS (SELECT constr_index, any_value(coalesce(trim(monitored_facility) || ' · ' || trim(contingency), 'unnamed constraint ' || CAST(constr_index AS VARCHAR))) AS k
        FROM fact_pcr_binding_hourly WHERE scenario = ? GROUP BY 1)
SELECT lab.k AS name, avg(x.sf) AS dfax, sum(x.mu * x.sf) AS contrib_sum, count(*) AS hours FROM x JOIN lab USING (constr_index) GROUP BY 1'''
ENERGY_ROWS_SQL = 'SELECT count(*) AS n FROM fact_pcr_binding_hourly WHERE scenario = ? AND monitored_facility IS NULL AND abs(constraint_limit + 0.0003) < 1e-6'


def _rows_from(raw, top=10):
    if not raw:
        return None
    n, sum_all = int(raw[0]['n'] or 0), f(raw[0]['sum_all'])
    rows = []
    for r in raw:
        if r['name'] is None:
            continue
        rows.append({'name': r['name'], 'hours': int(r['hours']), **association(r['hours'], n, r['sum_on'], sum_all),
                     'mean_abs_shadow': f(r['mean_abs']), 'max_abs_shadow': f(r['max_abs'])})
    return {'n': n, 'mcc': (sum_all / n) if n and sum_all is not None else None, 'constraints': len(rows), 'rows': rows}


def _rank(rows, top):
    key = lambda r: (-(abs(r['contrib']) if r.get('contrib') is not None else abs(r['assoc']) if r.get('assoc') is not None else -1), -r['hours'], r['name'])
    return sorted(rows, key=key)[:top]


def constraints(c, key):
    bus = _bus(c, key)
    if bus is None:
        return None
    bid = int(bus['bus_id'])
    link = busdata.bus_link_row(c, bid)  # the resolved link (busdata.price_links, D-008)
    pcr_node = (busdata.rows(c, 'SELECT pcr_pnode_name, pcr_zone FROM stg_pcr_bus_pnode WHERE bus_id=?', [bid]) or [None])[0]
    units = busdata.rows(c, 'SELECT r.resource_name, r.fuel, r.econ_max_mw FROM stg_pcr_bus_pnode s JOIN dim_pcr_resource r ON r.pnode_index = s.pcr_pnode_index WHERE s.bus_id=?', [bid])
    lim_keys = {}
    for r in busdata.rows(c, 'SELECT scenario, direction, monitored_facility, pct_loading_no_transfer FROM fact_limiting_element WHERE bus_id=? AND monitored_facility IS NOT NULL', [bid]):
        p = parse_facility(r['monitored_facility'])
        if p:
            lim_keys.setdefault(p['key'], []).append([r['scenario'], r['direction'], f(r['pct_loading_no_transfer'])])
    periods = []
    for market, year in SETTLED:
        k = f'{market}{year}'
        if not link:
            periods.append({'key': k, 'kind': 'settled', 'held': False, 'reason': 'no settled price series is linked to this bus'}); continue
        a = _rows_from(busdata.rows(c, SETTLED_SQL, [market, year, market, year, link['pnode_name']]))
        if not a or not a['n']:
            periods.append({'key': k, 'kind': 'settled', 'held': False, 'reason': f"no {market} {year} prices held for {link['pnode_name']}"}); continue
        periods.append({'key': k, 'kind': 'settled', 'market': market, 'year': year, 'held': True, 'exact': False, 'hours': a['n'], 'mcc': a['mcc'],
                        'constraints': a['constraints'], 'rows': _rank(a['rows'], 10)})
    for run in PCR_RUNS:
        a = _rows_from(busdata.rows(c, SOLVED_SQL, [run, run, bid]))
        if not a or not a['n']:
            periods.append({'key': run, 'kind': 'solved', 'held': False, 'reason': f'this bus has no {run} prices'}); continue
        exact = busdata.rows(c, EXACT_SQL, [bid, run, run]) if units else []
        by = {r['name']: r for r in a['rows']}
        for e in exact:
            row = by.get(e['name'])
            if row is None:
                row = {'name': e['name'], 'hours': int(e['hours']), 'mcc_on': None, 'mcc_off': None, 'assoc': None, 'mean_abs_shadow': None, 'max_abs_shadow': None}
                a['rows'].append(row); by[e['name']] = row
            row['dfax'] = f(e['dfax'])
            row['contrib'] = f(e['contrib_sum']) / a['n'] if f(e['contrib_sum']) is not None and a['n'] else None
        contrib_total = sum(r['contrib'] for r in a['rows'] if r.get('contrib') is not None) if exact else None
        rows = _rank(a['rows'], 10)
        for r in rows:
            p = parse_facility(r['name'].split(' · ')[0])
            if p and p['key'] in lim_keys:
                r['limiting'] = lim_keys[p['key']]
        periods.append({'key': run, 'kind': 'solved', 'run': run, 'year': RUN_YEAR[run], 'held': True, 'exact': bool(exact), 'hours': a['n'], 'mcc': a['mcc'],
                        'contrib_total': contrib_total, 'constraints': a['constraints'], 'rows': rows,
                        'energy_rows_excluded': busdata.rows(c, ENERGY_ROWS_SQL, [run])[0]['n']})
    return {'bus_id': bid, 'settled_series': link, 'pcr_pnode': pcr_node, 'units': units, 'periods': periods,
            'not_held': ['5yr and 10yr runs: their binding-constraint tables (probe5/probe10) are not in the unified database'],
            'rules': {'association': 'Settled records carry no shift factor: a row is the bus\'s own MCC in the hours the constraint bound against every other hour of the year; assoc = (mcc_on − mcc_off) × hours ÷ year hours ($/MWh of the annual mean MCC). An association, not an attribution.',
                      'exact': 'Where the bus\'s PCR price node hosts a unit, the run\'s own DFAX gives the exact share: mean over the year of shadow × DFAX; the shares sum to the annual mean MCC (settled sign).',
                      'sign': 'LMP = energy + congestion + loss (settled sign); every run\'s stored congestion is negated at read.',
                      'excluded': 'Reserve requirements (SYSTEM_*), external-node limits (NODE_*) and the PCR energy-balance row are excluded.'},
            'source': 'unified fact_constraint_hourly, fact_lmp_hourly, fact_pcr_binding_hourly, fact_fcst_lmp_hourly, fact_pcr_cong_impact, stg_pcr_bus_pnode, dim_pcr_resource, busdata.price_links (D-008)'}


# ---------- curtailment ----------
STUDY_COLS = [(100, 'curtailment_with_100_mw', 'total_curtailment_at_100mw', 'hours_curtailed_at_100mw', 'max_curtailment_out_of_100mw', 'avg_lmp_100mw', 'capacity_factor_at_100mw'),
              (250, 'curtailment_with_250_mw', 'total_curtailment_250mw', 'hours_curtailed_at_250mw', 'max_curtailment_out_of_250mw', 'avg_lmp_250mw', 'capacity_factor_250'),
              (500, 'curtailment_with_500_mw', 'total_curtailment_at_500_mw', 'hours_curtailed_at_500_mw', 'max_curtailment_out_of_500_mw', 'avg_lmp_500mw', 'capacity_factor_at_500')]


def study_sizes(row):
    """Injection test per size. A size whose share is null was not tested: every figure of it is None."""
    out = []
    for size, pct, mwh, hrs, mx, lmp, cf in STUDY_COLS:
        p = f(row.get(pct)) if row else None
        if p is None:
            out.append({'mw': size, 'tested': False, 'pct': None, 'mwh': None, 'hours': None, 'max_mw': None, 'avg_lmp': None, 'cf_pct': None})
        else:
            out.append({'mw': size, 'tested': True, 'pct': 100.0 * p, 'mwh': f(row.get(mwh)), 'hours': f(row.get(hrs)), 'max_mw': f(row.get(mx)),
                        'avg_lmp': f(row.get(lmp)), 'cf_pct': f(row.get(cf))})
    return out


def curtailment(c, key):
    bus = _bus(c, key)
    if bus is None:
        return None
    bid = int(bus['bus_id'])
    study, base_lmp = None, None
    oc = _old()
    if oc is not None:
        try:
            cols = ', '.join(sorted({x for t in STUDY_COLS for x in t[1:]}))
            r = busdata.rows(oc, f'SELECT {cols}, "5_year_forecast_avg_lmp_base_case" AS base_lmp FROM headroom_2026_05 WHERE bus_id = ?', [bid])
            if r:
                study = study_sizes(r[0]); base_lmp = f(r[0]['base_lmp'])
        finally:
            oc.close()
    units = busdata.rows(c, '''SELECT r.bidder_index, trim(r.resource_name) AS name, r.fuel, r.econ_max_mw FROM stg_pcr_bus_pnode s JOIN dim_pcr_resource r ON r.pnode_index = s.pcr_pnode_index
                               WHERE s.bus_id = ? AND r.fuel IN ('Solar', 'Wind') ORDER BY r.econ_max_mw DESC NULLS LAST''', [bid])
    unit_runs = []
    if units:
        unit_runs = busdata.rows(c, '''SELECT u.scenario AS run, sum(u.max_bid_mw) FILTER (WHERE u.uc_status <> 'U') AS avail_mwh, sum(u.dispatch_mw) AS dispatch_mwh,
                   sum(greatest(u.max_bid_mw - u.dispatch_mw, 0)) FILTER (WHERE u.uc_status <> 'U') AS curt_mwh,
                   count(DISTINCT (u.study_date, u.hour)) FILTER (WHERE u.uc_status <> 'U' AND u.max_bid_mw - u.dispatch_mw > 0.01) AS curt_hours,
                   sum(u.max_bid_mw) FILTER (WHERE u.uc_status = 'U') AS uncommitted_mwh, count(DISTINCT (u.study_date, u.hour)) AS hours
                   FROM fact_pcr_unit_hourly u WHERE u.bidder_index IN (SELECT unnest(?::BIGINT[])) GROUP BY 1 ORDER BY 1''', [[u['bidder_index'] for u in units]])
        for r in unit_runs:
            for k in ('avail_mwh', 'dispatch_mwh', 'curt_mwh', 'uncommitted_mwh'):
                r[k] = f(r[k])
            r['pct'] = 100.0 * r['curt_mwh'] / r['avail_mwh'] if r['avail_mwh'] and r['curt_mwh'] is not None else None
    link = busdata.bus_link_row(c, bid)  # the resolved link (busdata.price_links, D-008)
    if link: link = {k: v for k, v in link.items() if k not in ('bus_id', 'buses_sharing_series')}
    price = []
    if link:
        price += busdata.rows(c, '''SELECT market || CAST(y AS VARCHAR) AS key, 'settled' AS kind, y AS year, count(*) AS hours, count(*) FILTER (WHERE v <= 0) AS le0
                                    FROM (SELECT market, year(ts) AS y, ts, avg(lmp) AS v FROM fact_lmp_hourly WHERE pnode_name = ? GROUP BY 1, 2, 3) GROUP BY 1, 2, 3 ORDER BY 3, 1''', [link['pnode_name']])
    price += busdata.rows(c, '''SELECT scenario AS key, 'solved' AS kind, count(*) AS hours, count(*) FILTER (WHERE lmp <= 0) AS le0 FROM fact_fcst_lmp_hourly WHERE bus_id = ? GROUP BY 1''', [bid])
    for p in price:
        if p['kind'] == 'solved':
            p['year'] = RUN_YEAR.get(p['key'])
    return {'bus_id': bid, 'study': study, 'study_base_lmp': base_lmp, 'study_label': OLD_LABEL + ' · headroom_2026_05 injection test on the PROBE 5-year run',
            'units': [{k: u[k] for k in ('name', 'fuel', 'econ_max_mw')} for u in units], 'unit_runs': unit_runs, 'settled_series': link, 'price': price,
            'rules': {'study': 'Fixed injection on the PROBE 5-year run at 100 / 250 / 500 MW; share = curtailed MWh ÷ the test profile\'s offered energy. A smaller size is tested only where the larger one curtails: null = not tested, never 0.',
                      'units': 'PCR solar/wind units at the bus\'s price node: curtailed = max_bid − dispatch on committed hours; output offered while uncommitted is counted apart. Existing/planned units in the run, not the plant being sited.',
                      'price': 'Hours priced at or below $0/MWh: a market signal of economic curtailment, not a count of curtailed energy.',
                      'excluded': 'The vendor curtailment ramp (solar_/wind_ *MW_2030) is not used: 2,676 of 2,678 buses are flagged validated=false (unified data_quality).'},
            'source': 'ISONE_GridSense.duckdb headroom_2026_05 (older copy); unified fact_pcr_unit_hourly, dim_pcr_resource, stg_pcr_bus_pnode, fact_lmp_hourly, fact_fcst_lmp_hourly, busdata.price_links (D-008)'}


STUDIO_COPY = Path(__file__).resolve().parent / 'data' / 'grid-studio.json'


def studio(c, key):
    """The live Studio's own Grid figures for this bus (plan/extract_grid.py from data-ext.js), for data notes only."""
    import json
    if not re.fullmatch(r'\d{1,9}', str(key)) or not STUDIO_COPY.exists():
        return None
    d = json.loads(STUDIO_COPY.read_text(encoding='utf-8'))
    return {'meta': d['meta'], 'bus': d['buses'].get(str(int(key)))}


ROUTES = {'context': context, 'constraints': constraints, 'curtailment': curtailment, 'studio': studio}
