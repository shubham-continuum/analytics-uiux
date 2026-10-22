"""Grid v6 endpoint (read-only): the network around a bus, for the "Network around the bus" map.
Served at GET /api/x/gridnet/around/<bus id>.

  around — every dim_branch with an end within RADIUS_MI of the bus, its two ends placed from dim_bus latitude /
           longitude (the branch table's own coordinates are not used, so a line and its bus cannot disagree);
           substations within the radius (dim_substation); and every fact_limiting_element row of this bus with
           both facility ends placed from dim_bus. A branch or facility with an end that has no dim_bus coordinate
           is counted and reported as not drawn: never placed at 0,0.

The view (views/grid-netmap.js) applies the settled rules: which cases a service uses, rate A for base-case rows
and rate C for contingency rows, pre-existing = |loading before the project| >= 100 %.
Unified DuckDB via busdata.connect() (read-only). Missing values are None (not held), never 0. Parameterised SQL only.
"""
import re

import busdata
from api_grid import f, miles, parse_facility

RADIUS_MI = 15.0


def _bus(c, key):
    if not re.fullmatch(r'\d{1,9}', str(key)):
        return None
    r = busdata.rows(c, 'SELECT bus_id, bus_name, nominal_kv, latitude, longitude, load_zone FROM dim_bus WHERE bus_id=? AND latitude IS NOT NULL AND longitude IS NOT NULL', [int(key)])
    return r[0] if r else None


def _pt(r, p):
    lat, lon = f(r[f'{p}_lat']), f(r[f'{p}_lon'])
    return [lon, lat] if lat is not None and lon is not None else None


def around(c, key):
    bus = _bus(c, key)
    if bus is None:
        return None
    bid, lat, lon = int(bus['bus_id']), f(bus['latitude']), f(bus['longitude'])

    # Branches: both ends from dim_bus. Drawn when both ends are placed and either end lies within the radius.
    branches, near_missing, unplaceable = [], 0, 0
    for r in busdata.rows(c, '''SELECT b.branch_uid, b.line_name, b.from_bus_id, b.from_bus_name, b.to_bus_id, b.to_bus_name, b.circuit_id, b.voltage,
                                       b.status, b.rated_base_mva, b.rated_base_mva_1, b.from_area, b.to_area,
                                       fb.latitude AS a_lat, fb.longitude AS a_lon, tb.latitude AS b_lat, tb.longitude AS b_lon
                                FROM dim_branch b LEFT JOIN dim_bus fb ON fb.bus_id = b.from_bus_id LEFT JOIN dim_bus tb ON tb.bus_id = b.to_bus_id'''):
        a, b = _pt(r, 'a'), _pt(r, 'b')
        da = miles(lat, lon, a[1], a[0]) if a else None
        db = miles(lat, lon, b[1], b[0]) if b else None
        near = any(d is not None and d <= RADIUS_MI for d in (da, db))
        if a and b:
            if near:
                ra, rb = f(r['rated_base_mva']), f(r['rated_base_mva_1'])
                branches.append({'uid': r['branch_uid'], 'name': r['line_name'], 'from': r['from_bus_id'], 'from_name': r['from_bus_name'], 'to': r['to_bus_id'],
                                 'to_name': r['to_bus_name'], 'ckt': str(r['circuit_id'] or '').strip(), 'kv': f(r['voltage']), 'status': r['status'],
                                 'rate_a': ra if ra and ra > 0 else None, 'rate_b': rb if rb and rb > 0 else None,
                                 'key': f"{min(r['from_bus_id'], r['to_bus_id'])}-{max(r['from_bus_id'], r['to_bus_id'])}-{str(r['circuit_id'] or '').strip()}",
                                 'a': a, 'b': b, 'mi': min(d for d in (da, db) if d is not None)})
        elif near:
            near_missing += 1  # one end inside the radius, the other end has no dim_bus coordinate
        elif not a and not b:
            unplaceable += 1   # neither end placed: cannot be put in or out of any radius
    branches.sort(key=lambda x: x['mi'])

    # Substations within the radius (context points).
    subs = []
    for r in busdata.rows(c, 'SELECT bus_id, substation_name, nominal_kv, latitude, longitude, short_circuit_mva FROM dim_substation WHERE latitude IS NOT NULL AND longitude IS NOT NULL'):
        d = miles(lat, lon, r['latitude'], r['longitude'])
        if d is not None and d <= RADIUS_MI:
            subs.append({'bus_id': r['bus_id'], 'name': r['substation_name'], 'kv': f(r['nominal_kv']), 'lon': f(r['longitude']), 'lat': f(r['latitude']), 'sc_mva': f(r['short_circuit_mva']), 'mi': d})
    subs.sort(key=lambda x: x['mi'])

    # This bus's limiting-element rows, each facility end placed from dim_bus.
    rows = busdata.rows(c, '''SELECT scenario, direction, monitored_facility, binding_contingency, contingency_id, kv, dfax, transfer_mw, base_flow_mw,
                                     contingency_flow_mw, rating_a_mva, rating_c_mva, pct_loading_no_transfer, fix_cost_musd, length_miles, facility_type
                              FROM fact_limiting_element WHERE bus_id=? AND monitored_facility IS NOT NULL''', [bid])
    parsed = {}
    for r in rows:
        p = parse_facility(r['monitored_facility'])
        r['monitored_facility'] = r['monitored_facility'].strip()
        r['key'] = p['key'] if p else None
        if p:
            parsed[p['key']] = p
            r['a'], r['b'], r['a_name'], r['b_name'], r['ckt'] = p['a'], p['b'], p['a_name'], p['b_name'], p['ckt']
        for k in ('contingency_id', 'kv', 'dfax', 'transfer_mw', 'base_flow_mw', 'contingency_flow_mw', 'rating_a_mva', 'rating_c_mva', 'pct_loading_no_transfer', 'fix_cost_musd', 'length_miles'):
            r[k] = f(r[k])
    ends = sorted({e for p in parsed.values() for e in (p['a'], p['b'])})
    geo = {}
    if ends:
        for r in busdata.rows(c, 'SELECT bus_id, latitude, longitude FROM dim_bus WHERE bus_id IN (SELECT unnest(?::BIGINT[]))', [ends]):
            if f(r['latitude']) is not None and f(r['longitude']) is not None:
                geo[int(r['bus_id'])] = [f(r['longitude']), f(r['latitude'])]
    branch_keys = {b['key'] for b in branches}
    facilities = {k: {'a': geo.get(p['a']), 'b': geo.get(p['b']), 'in_net': k in branch_keys} for k, p in parsed.items()}

    return {'bus': {'bus_id': bid, 'bus_name': bus['bus_name'], 'kv': f(bus['nominal_kv']), 'lon': lon, 'lat': lat, 'load_zone': bus['load_zone']},
            'radius_mi': RADIUS_MI, 'branches': branches, 'substations': subs, 'rows': rows, 'facility_geo': facilities,
            'not_drawn': {'branches_near': near_missing, 'branches_unplaceable': unplaceable},
            'notes': {'coords': 'Line ends come from dim_bus latitude/longitude. dim_branch carries its own end coordinates; they are not used, so a line always meets its bus.',
                      'radius': f'A branch is drawn when either end lies within {RADIUS_MI:g} mi of the bus and both ends are placed.'},
            'source': 'unified ISONE_GridSense_unified.duckdb (read-only): dim_branch, dim_bus, dim_substation, fact_limiting_element'}


ROUTES = {'around': around}
