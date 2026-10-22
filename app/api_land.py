"""Land dashboard endpoints: GET /api/x/land/site/<bus_id>.

Everything around one candidate bus that the Land tabs need, read from the unified DuckDB (read-only, parameterised SQL):
the bus and its substation row, its price link, its solved headroom, spine stations within 15 mi (with headroom, strength
and whether an exclusion screen is held), every model bus within 10 mi, branches at the bus, generators and loads within
10 mi, queue requests within 25 mi, planned substation / transmission upgrades within 15 mi, and the nearest screened buses.
The Studio copy (data/land-studio.json, from plan/extract_land.py) is attached separately and labelled as such; where it and
the unified DB describe the same quantity the unified DB is primary and the difference is returned as a data note.
Null stays null (never 0). Distances are great-circle miles (haversine, R = 3,958.8 mi) between published coordinates.
"""
import json
from pathlib import Path

import busdata

ROOT = Path(__file__).resolve().parent
R_STATION, R_BUS, R_GEN, R_QUEUE, R_UPG = 15.0, 10.0, 10.0, 25.0, 15.0


def _hav(lat, lon):
    """SQL expression: great-circle miles from (?, ?) to columns lat/lon (three positional params per use; text columns cast)."""
    lat, lon = f'TRY_CAST({lat} AS DOUBLE)', f'TRY_CAST({lon} AS DOUBLE)'
    return (f"2*3958.8*asin(sqrt(pow(sin(radians({lat}-?)/2),2)+cos(radians(?))*cos(radians({lat}))"
            f"*pow(sin(radians({lon}-?)/2),2)))")


def _p(lat, lon):
    return [lat, lat, lon]


def _json(name):
    p = ROOT / 'data' / name
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None


_CACHE = {}


def _static(name):
    if name not in _CACHE: _CACHE[name] = _json(name)
    return _CACHE[name]


def _studio_notes(bus, sub, hr, st):
    """Differences between the unified DB (primary) and the Studio copy for the same quantity."""
    if not st: return []
    notes, U = [], {}
    if bus.get('latitude') is not None and st.get('lat') is not None:
        import math
        d = 2 * 3958.8 * math.asin(math.sqrt(math.sin(math.radians(st['lat'] - bus['latitude']) / 2) ** 2 + math.cos(math.radians(bus['latitude'])) * math.cos(math.radians(st['lat'])) * math.sin(math.radians(st['lon'] - bus['longitude']) / 2) ** 2))
        if d > 0.1: notes.append({'field': 'Bus coordinate', 'unified': f"{bus['latitude']:.5f}, {bus['longitude']:.5f}", 'studio': f"{st['lat']:.5f}, {st['lon']:.5f}", 'diff': f'{d:.2f} mi apart'})
    # The Studio copy stores the published short-circuit figure, which is 100x too small; the Studio multiplies by 100 at
    # display. Compare like with like: the Studio's corrected figure.
    sc_studio = st.get('sc_mva') * 100 if st.get('sc_mva') is not None else None
    pairs = [('Short-circuit MVA (Studio figure x100, as the Studio displays it)', (sub or {}).get('short_circuit_mva'), sc_studio),
             ('Outlets at the station', (sub or {}).get('total_outlets'), st.get('outlets'))]
    hmap = {(r['scenario'], r['direction']): r['headroom_mw'] for r in hr}
    pairs += [('Headroom summer peak, injection (MW)', hmap.get(('summer_peak', 'discharge')), st.get('hr_sp_dis')),
              ('Headroom summer peak, withdrawal (MW)', hmap.get(('summer_peak', 'charge')), st.get('hr_sp_chg')),
              ('Headroom shoulder, injection (MW)', hmap.get(('shoulder', 'discharge')), st.get('hr_sh_dis')),
              ('Headroom large load, withdrawal (MW)', hmap.get(('large_load', 'charge')), st.get('hr_ll_chg'))]
    for label, u, s in pairs:
        if u is None and s is None: continue
        if u is None or s is None:
            notes.append({'field': label, 'unified': 'not held' if u is None else u, 'studio': 'not held' if s is None else s, 'diff': 'held in one source only'})
        elif abs(float(u) - float(s)) > max(0.5, 0.005 * abs(float(u))):
            notes.append({'field': label, 'unified': u, 'studio': s, 'diff': round(float(s) - float(u), 2)})
    return notes


def site(c, key):
    if key in ('all', 'hub'): return None
    bid = int(key)
    b = busdata.rows(c, 'SELECT * FROM dim_bus WHERE bus_id = ?', [bid])
    if not b: return None
    bus = b[0]
    sub = (busdata.rows(c, 'SELECT * FROM dim_substation WHERE bus_id = ?', [bid]) or [None])[0]
    lat, lon = (sub or bus).get('latitude'), (sub or bus).get('longitude')
    link = busdata.rows(c, 'SELECT pnode_name, tier, method, distance_km, buses_at_substation, link_rank FROM bridge_bus_pnode WHERE bus_id = ? ORDER BY link_rank', [bid])
    price_link = busdata.link_of(c, bid)  # the node the bus is PRICED at (busdata.price_links, D-008); `link` lists the stored candidates
    hr = busdata.rows(c, 'SELECT scenario, direction, headroom_mw, pre_existing_issues FROM fact_headroom WHERE bus_id = ? ORDER BY scenario, direction', [bid])
    sc_all = [r['v'] for r in busdata.rows(c, 'SELECT short_circuit_mva AS v FROM dim_substation WHERE short_circuit_mva IS NOT NULL')]
    sc = (sub or {}).get('short_circuit_mva')
    sc_rank = None if sc is None or not sc_all else {'below_or_equal': sum(1 for v in sc_all if v <= sc), 'of': len(sc_all)}
    branches = busdata.rows(c, '''SELECT line_name, from_bus_id, from_bus_name, to_bus_id, to_bus_name, circuit_id, voltage, status, rated_base_mva,
        headroom_capacity_branch_discharging AS hr_dis, headroom_capacity_branch_charging AS hr_chg,
        pre_existing_issues_branch_discharging AS pre_dis, pre_existing_issues_branch_charging AS pre_chg
        FROM dim_branch WHERE from_bus_id = ? OR to_bus_id = ? ORDER BY voltage DESC NULLS LAST, line_name''', [bid, bid])
    for r in branches:  # text columns: '-' and blanks are not held, never 0; a 0-MVA rating is a zero-length/unrated record
        for k in ('hr_dis', 'hr_chg', 'pre_dis', 'pre_chg'):
            try: r[k] = float(r[k]) if r[k] not in (None, '', '-') else None
            except (TypeError, ValueError): r[k] = None
        if not r.get('rated_base_mva'): r['rated_base_mva'] = None
    out = {'bus': bus, 'substation': sub, 'link': link, 'priceLink': price_link, 'headroom': hr, 'scRank': sc_rank, 'branches': branches,
           'radii': {'stations': R_STATION, 'buses': R_BUS, 'gens': R_GEN, 'queue': R_QUEUE, 'upgrades': R_UPG},
           'source': 'unified ISONE_GridSense_unified.duckdb: dim_bus, dim_substation, bridge_bus_pnode, fact_headroom, dim_branch, dim_generator, dim_load, dim_queue, dim_substation_upgrade, dim_transmission_upgrade'}
    land = _static('land.json') or {}
    screened = set((land.get('exclusions') or {}).keys())
    if lat is None or lon is None:
        out.update({'stations': None, 'stationsTotal': None, 'stationElements': None, 'buses': None, 'gens': None, 'loads': None, 'queue': None, 'upgrades': None, 'screened': None,
                    'noCoord': 'This bus carries no coordinate in the unified DB, so nothing can be measured around it.'})
    else:
        h = _hav('latitude', 'longitude')
        st = busdata.rows(c, f'''WITH s AS (SELECT bus_id, substation_name, nominal_kv, county, state_code, latitude, longitude, short_circuit_mva, total_outlets, {h} AS mi
              FROM dim_substation WHERE latitude IS NOT NULL AND bus_id <> ?)
            SELECT s.*, (SELECT headroom_mw FROM fact_headroom f WHERE f.bus_id = s.bus_id AND scenario = 'summer_peak' AND direction = 'discharge') AS hr_sp_dis,
                   (SELECT headroom_mw FROM fact_headroom f WHERE f.bus_id = s.bus_id AND scenario = 'summer_peak' AND direction = 'charge') AS hr_sp_chg,
                   (SELECT headroom_mw FROM fact_headroom f WHERE f.bus_id = s.bus_id AND scenario = 'shoulder' AND direction = 'discharge') AS hr_sh_dis,
                   (SELECT headroom_mw FROM fact_headroom f WHERE f.bus_id = s.bus_id AND scenario = 'shoulder' AND direction = 'charge') AS hr_sh_chg,
                   (SELECT headroom_mw FROM fact_headroom f WHERE f.bus_id = s.bus_id AND scenario = 'large_load' AND direction = 'charge') AS hr_ll_chg
            FROM s WHERE mi <= ? ORDER BY mi''', _p(lat, lon) + [bid, R_STATION])  # P2 C40: no row cap; the whole radius
        for r in st: r['screened'] = str(r['bus_id']) in screened
        # P2 C07: the element rows Grid reads (bus_payload: every fact_limiting_element row of the bus), for each station
        # bus, so Land's verdict per station is Grid's caseTable + binding (D6.1), not the vendor envelope alone.
        sids = sorted({int(r['bus_id']) for r in st})
        st_el = busdata.rows(c, '''SELECT bus_id, scenario, direction, monitored_facility, transfer_mw, pct_loading_no_transfer
            FROM fact_limiting_element WHERE bus_id IN (SELECT unnest(?::BIGINT[]))''', [sids]) if sids else []
        buses = busdata.rows(c, f'''SELECT bus_id, bus_name, substation_name, nominal_kv, in_powerflow_model, {h} AS mi,
              EXISTS (SELECT 1 FROM dim_substation s WHERE s.bus_id = b.bus_id) AS on_spine
            FROM dim_bus b WHERE latitude IS NOT NULL AND bus_id <> ? AND {h} <= ? ORDER BY mi''', _p(lat, lon) + [bid] + _p(lat, lon) + [R_BUS])
        gens = busdata.rows(c, f'''SELECT gen_name, bus_id, status, count(*) AS units, sum(gen_mw) AS gen_mw, sum(max_capacity_mw) AS max_mw, min({h}) AS mi
            FROM dim_generator WHERE latitude IS NOT NULL AND {h} <= ? GROUP BY gen_name, bus_id, status ORDER BY mi, max_mw DESC''', _p(lat, lon) + _p(lat, lon) + [R_GEN])
        loads = busdata.rows(c, f'''SELECT count(*) AS n, sum(load_mw) AS load_mw, count(load_mw) AS n_mw FROM dim_load WHERE latitude IS NOT NULL AND {h} <= ?''', _p(lat, lon) + [R_GEN])[0]
        queue = busdata.rows(c, f'''SELECT queue_position, request_date, poi_name, max_mw, resource_type, status, projected_is_date, county, state, {h} AS mi
            FROM dim_queue WHERE latitude IS NOT NULL AND {h} <= ? ORDER BY mi''', _p(lat, lon) + _p(lat, lon) + [R_QUEUE])
        su = busdata.rows(c, f'''SELECT substation_name, substation_upgrade, nominal_voltage_kv, expected_in_service_year, category, {h} AS mi
            FROM dim_substation_upgrade WHERE latitude IS NOT NULL AND {h} <= ? ORDER BY mi''', _p(lat, lon) + _p(lat, lon) + [R_UPG])
        hf, ht = _hav('from_latitude', 'from_longitude'), _hav('to_latitude', 'to_longitude')
        tu = busdata.rows(c, f'''SELECT transmission_upgrade, from_substation_name, to_substation_name, nominal_voltage_kv, expected_in_service_year, category,
              least(coalesce({hf}, 1e9), coalesce({ht}, 1e9)) AS mi
            FROM dim_transmission_upgrade WHERE least(coalesce({hf}, 1e9), coalesce({ht}, 1e9)) <= ? ORDER BY mi''', (_p(lat, lon) * 2) + (_p(lat, lon) * 2) + [R_UPG])
        scr = []
        if screened:
            ids = [int(k) for k in screened if k.isdigit() and int(k) != bid]
            scr = busdata.rows(c, f'''SELECT bus_id, substation_name, nominal_kv, county, state_code, {h} AS mi FROM dim_substation
                WHERE latitude IS NOT NULL AND bus_id IN (SELECT unnest(?::INTEGER[])) ORDER BY mi LIMIT 15''', _p(lat, lon) + [ids])
        out.update({'stations': st, 'stationsTotal': len(st), 'stationElements': st_el, 'buses': buses, 'gens': gens, 'loads': loads, 'queue': queue,
                    'upgrades': {'substation': su, 'transmission': tu}, 'screened': scr})
    studio = _static('land-studio.json')
    srow = None
    if studio:
        raw = studio['buses'].get(str(bid))
        srow = dict(zip(studio['cols'], raw)) if raw else None
        out['studio'] = {'source': studio['source'], 'bus': srow, 'to': studio['to_by_bus'].get(str(bid)), 'notAnOwner': studio.get('to_not_an_owner', []),
                         'notes': _studio_notes(bus, sub, hr, srow)}
    else:
        out['studio'] = None
    return busdata.clean(out)


def site4(c, key):
    """v4 payload (2026-09-30): stations carry the shoulder-charge envelope (hr_sh_chg), which the Grid rule reads for
    storage and hybrid charging. A new route name, so payloads cached under 'site' before v4 are never served for it."""
    out = site(c, key)
    if out is not None: out['v'] = 4
    return out


def site5(c, key):
    """P2 (2026-10-10): the whole station radius (no row cap; stationsTotal) and each station bus's element rows
    (stationElements), so Land's verdict is Grid's (D6.1). A new route name, so payloads cached under 'site4' are never
    served for it."""
    out = site(c, key)
    if out is not None: out['v'] = 5
    return out


ROUTES = {'site': site, 'site4': site4, 'site5': site5}
