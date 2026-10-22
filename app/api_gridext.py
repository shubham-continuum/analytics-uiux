"""Grid dashboard v5 endpoints (read-only). Served at GET /api/x/gridext/<name>/<bus id>.

A new module rather than edits to api_grid.py, so the running server imports it on first request (no restart).

  v5       — affected-system tie adjacency (dim_bus.pf_area / pf_ba, dim_branch.from_area / to_area), inverter-based
             units near the bus for the weighted SCR indicator (dim_generator, classified by name: the table carries
             no fuel), existing units at the point of interconnection for the surplus screen, the Order 1920 context
             (dim_transmission_upgrade, dim_substation_upgrade, this bus's limiting facilities with kV and cost) and
             the short-circuit data note (published vs corrected ×100).
  cluster  — for each of this bus's limiting facilities, every other bus's DFAX on the same facility (same case),
             and candidate cluster members ranked by the facilities they share, for proportional-impact allocation.

Unified DuckDB via busdata.connect() (read-only). Missing values are None (not held), never 0. Parameterised SQL only.
"""
import re

import busdata
from api_grid import f, miles, parse_facility

HOME_AREA = '101'
IBR_RADIUS_MI = 15.0
IBR_RX = re.compile(r'\b(solar|wind|wtg|pv|batt|battery|bess|storage|ess)\b', re.I)
CASES = ('summer_peak|discharge', 'summer_peak|charge', 'large_load|charge', 'shoulder|charge')  # shoulder|discharge rows are the large-load table under a shoulder label: never used


def _bus(c, key):
    if not re.fullmatch(r'\d{1,9}', str(key)):
        return None
    r = busdata.rows(c, 'SELECT * FROM dim_bus WHERE bus_id=? AND latitude IS NOT NULL', [int(key)])
    return r[0] if r else None


def _station(c, bid):
    """This bus plus buses tied to it by a same-named branch (same rule as api_grid.context)."""
    st = {bid}
    for b in busdata.rows(c, 'SELECT from_bus_id, from_bus_name, to_bus_id, to_bus_name FROM dim_branch WHERE from_bus_id=? OR to_bus_id=?', [bid, bid]):
        if (b['from_bus_name'] or '').strip().lower() == (b['to_bus_name'] or '').strip().lower():
            st.add(int(b['from_bus_id'])); st.add(int(b['to_bus_id']))
    return sorted(st)


def _area_labels(c):
    """Power-flow area number → operator label, read off the tie branches themselves (from_area / to_area text)."""
    lab = {}
    for r in busdata.rows(c, '''SELECT b.from_area, b.to_area, fb.pf_area AS fa, tb.pf_area AS ta FROM dim_branch b
                                LEFT JOIN dim_bus fb ON fb.bus_id = b.from_bus_id LEFT JOIN dim_bus tb ON tb.bus_id = b.to_bus_id
                                WHERE b.from_area <> b.to_area'''):
        if r['fa']: lab.setdefault(str(r['fa']), r['from_area'])
        if r['ta']: lab.setdefault(str(r['ta']), r['to_area'])
    return lab


def v5(c, key):
    bus = _bus(c, key)
    if bus is None:
        return None
    bid, lat, lon = int(bus['bus_id']), bus['latitude'], bus['longitude']
    labels = _area_labels(c)

    # Ties: branches whose two ends sit in different operator areas; distance to the ISO-NE (from) end.
    ties = []
    for r in busdata.rows(c, '''SELECT line_name, from_bus_id, from_bus_name, to_bus_id, to_bus_name, from_area, to_area, voltage, status,
                                from_latitude, from_longitude FROM dim_branch WHERE from_area <> to_area'''):
        ties.append({'name': r['line_name'], 'from': r['from_bus_id'], 'from_name': r['from_bus_name'], 'to': r['to_bus_id'], 'to_name': r['to_bus_name'],
                     'label': r['to_area'], 'from_area': r['from_area'], 'kv': f(r['voltage']), 'status': r['status'],
                     'mi': miles(lat, lon, r['from_latitude'], r['from_longitude'])})
    ties.sort(key=lambda t: (t['mi'] is None, t['mi'] or 0))

    # This bus's limiting facilities: both ends' power-flow areas, kV and the largest study cost.
    fac = {}
    for r in busdata.rows(c, '''SELECT monitored_facility, scenario, direction, kv, fix_cost_musd, length_miles, facility_type FROM fact_limiting_element
                                WHERE bus_id=? AND monitored_facility IS NOT NULL AND NOT (scenario='shoulder' AND direction='discharge')''', [bid]):
        p = parse_facility(r['monitored_facility'])
        if not p:
            continue
        cost = f(r['fix_cost_musd'])
        if cost == 0 and not (f(r['length_miles']) or 0) > 0:
            cost = None  # $0 on a zero-length facility is not held
        x = fac.setdefault(p['key'], {'facility': r['monitored_facility'].strip(), 'a': p['a'], 'b': p['b'], 'kv': f(r['kv']) or p['kv'], 'cost': None, 'type': r['facility_type'], 'cases': set()})
        x['cases'].add(f"{r['scenario']}|{r['direction']}")
        if cost is not None and (x['cost'] is None or cost > x['cost']):
            x['cost'] = cost
    ends = sorted({e for x in fac.values() for e in (x['a'], x['b'])})
    area_of = {r['bus_id']: r['pf_area'] for r in busdata.rows(c, 'SELECT bus_id, pf_area FROM dim_bus WHERE bus_id IN (SELECT unnest(?::BIGINT[]))', [ends])} if ends else {}
    tie_keys = {f"{min(t['from'], t['to'])}-{max(t['from'], t['to'])}" for t in ties}
    facilities = []
    for k, x in fac.items():
        areas = [area_of.get(x['a']), area_of.get(x['b'])]
        facilities.append({'key': k, 'facility': x['facility'], 'kv': x['kv'], 'cost': x['cost'], 'type': x['type'], 'cases': sorted(x['cases']),
                           'areas': areas, 'labels': [labels.get(str(a)) if a else None for a in areas],
                           'is_tie': f"{min(x['a'], x['b'])}-{max(x['a'], x['b'])}" in tie_keys})

    # Inverter-based units near the bus (name-classified) and every unit at the point of interconnection.
    station = _station(c, bid)
    ibr, poi = [], []
    for r in busdata.rows(c, 'SELECT bus_id, gen_uid, gen_name, id_code, status, gen_mw, max_capacity_mw, latitude, longitude FROM dim_generator'):
        at = int(r['bus_id']) in station
        if at:
            poi.append({'bus_id': r['bus_id'], 'name': r['gen_name'], 'uid': r['gen_uid'], 'id': r['id_code'], 'status': r['status'],
                        'gen_mw': f(r['gen_mw']), 'max_mw': f(r['max_capacity_mw']), 'ibr': bool(IBR_RX.search(f"{r['gen_name']} {r['gen_uid']}"))})
        if not IBR_RX.search(f"{r['gen_name'] or ''} {r['gen_uid'] or ''}"):
            continue
        d = 0.0 if at else miles(lat, lon, r['latitude'], r['longitude'])
        if d is not None and d <= IBR_RADIUS_MI:
            ibr.append({'bus_id': r['bus_id'], 'name': r['gen_name'], 'uid': r['gen_uid'], 'status': r['status'], 'mw': f(r['max_capacity_mw']), 'mi': d, 'atStation': at})
    ibr.sort(key=lambda u: u['mi'])

    # Order 1920 context: the approved upgrade lists ISO-wide (kV and year as published; no cost is published).
    ups = [{'kind': 'Transmission', 'kv': f(r['nominal_voltage_kv']), 'year': _int(r['expected_in_service_year']), 'category': r['category']}
           for r in busdata.rows(c, 'SELECT nominal_voltage_kv, expected_in_service_year, category FROM dim_transmission_upgrade')]
    ups += [{'kind': 'Substation', 'kv': f(r['nominal_voltage_kv']), 'year': _int(r['expected_in_service_year']), 'category': r['category']}
            for r in busdata.rows(c, 'SELECT nominal_voltage_kv, expected_in_service_year, category FROM dim_substation_upgrade')]

    sub = (busdata.rows(c, 'SELECT short_circuit_mva, short_circuit_mva_published FROM dim_substation WHERE bus_id=?', [bid]) or [None])[0]
    return {'bus': {'bus_id': bid, 'bus_name': bus['bus_name'], 'pf_area': bus['pf_area'], 'pf_ba': bus['pf_ba'], 'area_label': labels.get(str(bus['pf_area'])) if bus['pf_area'] else None},
            'home_area': HOME_AREA, 'area_labels': labels, 'ties': ties, 'facilities': facilities, 'station': station,
            'ibr': ibr, 'ibr_radius_mi': IBR_RADIUS_MI, 'poi_units': poi, 'upgrades': ups,
            'sc': {'corrected': f(sub['short_circuit_mva']) if sub else None, 'published': f(sub['short_circuit_mva_published']) if sub else None},
            'notes': {'pf_ba': 'dim_bus.pf_ba is 0 on every bus: no balancing-authority split is held, so areas come from pf_area and the tie branches.',
                      'ibr': 'dim_generator carries no fuel; inverter-based units are classified by whole-word name (solar, wind, WTG, PV, battery, BESS, storage, ESS).',
                      'surplus': 'The existing units\' interconnection service level (LGIA MW) is not held; installed Pmax stands in for it.'},
            'source': 'unified ISONE_GridSense_unified.duckdb (read-only): dim_bus, dim_branch, dim_generator, fact_limiting_element, dim_transmission_upgrade, dim_substation_upgrade, dim_substation'}


def _int(v):
    v = f(v)
    return int(v) if v is not None else None


def cluster(c, key):
    """Other buses' DFAX on this bus's limiting facilities, by case, for proportional-impact allocation."""
    bus = _bus(c, key)
    if bus is None:
        return None
    bid, lat, lon = int(bus['bus_id']), bus['latitude'], bus['longitude']
    mine = {}
    for r in busdata.rows(c, 'SELECT scenario, direction, monitored_facility FROM fact_limiting_element WHERE bus_id=? AND monitored_facility IS NOT NULL', [bid]):
        case = f"{r['scenario']}|{r['direction']}"
        p = parse_facility(r['monitored_facility'])
        if p and case in CASES:
            mine.setdefault(p['key'], set()).add(case)
    if not mine:
        return {'bus_id': bid, 'facilities': {}, 'candidates': [], 'rule': 'No parsable limiting facility at this bus.'}
    dfax, share_count = {}, {}
    for r in busdata.rows(c, 'SELECT bus_id, scenario, direction, monitored_facility, binding_contingency, dfax FROM fact_limiting_element WHERE monitored_facility IS NOT NULL AND dfax IS NOT NULL'):
        case = f"{r['scenario']}|{r['direction']}"
        if case not in CASES:
            continue
        p = parse_facility(r['monitored_facility'])
        if not p or p['key'] not in mine or case not in mine[p['key']]:
            continue
        b = str(r['bus_id'])
        d = f(r['dfax'])
        slot = dfax.setdefault(p['key'], {}).setdefault(case, {})
        prev = slot.get(b)
        if prev is None or (d is not None and d > prev['dfax']):
            slot[b] = {'dfax': d, 'contingency': r['binding_contingency']}
        if b != str(bid):
            share_count.setdefault(b, set()).add(p['key'])
    ids = [int(b) for b in share_count]
    info = {r['bus_id']: r for r in busdata.rows(c, 'SELECT bus_id, bus_name, nominal_kv, latitude, longitude FROM dim_bus WHERE bus_id IN (SELECT unnest(?::BIGINT[]))', [ids])} if ids else {}
    cand = []
    for b, keys in share_count.items():
        i = info.get(int(b))
        cand.append({'bus': b, 'name': i['bus_name'] if i else None, 'kv': f(i['nominal_kv']) if i else None, 'shared': len(keys),
                     'mi': miles(lat, lon, i['latitude'], i['longitude']) if i else None})
    cand.sort(key=lambda x: (-x['shared'], x['mi'] if x['mi'] is not None else 1e9))
    return {'bus_id': bid, 'facilities': dfax, 'candidates': cand[:40], 'candidates_total': len(cand),
            'rule': 'DFAX per bus = the largest sensitivity the element study lists for the same facility (same branch, either end first) in the same case, any contingency. A bus the study does not list for a facility has no DFAX held: its impact is not held, never 0.',
            'source': 'unified fact_limiting_element (read-only)'}


ROUTES = {'v5': v5, 'cluster': cluster}
