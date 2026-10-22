"""Queue dashboard endpoints over the unified DuckDB (read-only). GET /api/x/queue/<name>/<key>.

study/all: the 110 queue positions the solved case modelled (dim_queue), the retirements and approved
transmission / substation upgrades (dim_retirement, dim_transmission_upgrade, dim_substation_upgrade) and the
power-flow model's generating units (dim_generator), each with coordinates as held. Text coordinates in the
upgrade and retirement tables are cast; a value that does not parse is None (not placed), never 0.
"""
import busdata


def _f(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x else None


def _i(v):
    x = _f(v)
    return int(x) if x is not None else None


def study(c, key):
    if key != 'all':
        return None
    queue = [busdata.clean(r) for r in busdata.rows(c, 'SELECT * FROM dim_queue ORDER BY queue_position')]
    ret = [{'plant': r['plant_name'], 'year': _i(r['year']), 'month': _i(r['month']), 'mw': _f(r['net_capacity_mw']),
            'zone': r['load_zone'], 'county': r['plant_county'], 'state': r['plant_state'],
            'lat': _f(r['latitude']), 'lon': _f(r['longitude']), 'row': r['source_row_number']}
           for r in busdata.rows(c, 'SELECT * FROM dim_retirement ORDER BY source_row_number')]
    tx = [{'name': r['transmission_upgrade'], 'from': r['from_substation_name'], 'to': r['to_substation_name'],
           'kv': _f(r['nominal_voltage_kv']), 'year': _i(r['expected_in_service_year']), 'category': r['category'],
           'lat1': _f(r['from_latitude']), 'lon1': _f(r['from_longitude']), 'lat2': _f(r['to_latitude']), 'lon2': _f(r['to_longitude']),
           'row': r['source_row_number']}
          for r in busdata.rows(c, 'SELECT * FROM dim_transmission_upgrade ORDER BY source_row_number')]
    sub = [{'name': r['substation_upgrade'], 'substation': r['substation_name'], 'kv': _f(r['nominal_voltage_kv']),
            'year': _i(r['expected_in_service_year']), 'category': r['category'], 'lat': _f(r['latitude']), 'lon': _f(r['longitude']),
            'row': r['source_row_number']}
           for r in busdata.rows(c, 'SELECT * FROM dim_substation_upgrade ORDER BY source_row_number')]
    gen = [[r['bus_id'], r['gen_name'], r['status'], r['max_capacity_mw'], r['latitude'], r['longitude']]
           for r in busdata.rows(c, 'SELECT bus_id, gen_name, status, max_capacity_mw, latitude, longitude FROM dim_generator '
                                    'WHERE latitude IS NOT NULL ORDER BY bus_id, gen_uid')]
    return {'source': 'unified DuckDB (ISONE_GridSense_unified.duckdb), read-only',
            'tables': ['dim_queue', 'dim_retirement', 'dim_transmission_upgrade', 'dim_substation_upgrade', 'dim_generator'],
            'queue': queue, 'retirements': ret, 'txUpgrades': tx, 'subUpgrades': sub,
            'generatorColumns': ['bus_id', 'name', 'status', 'max_mw', 'lat', 'lon'], 'generators': gen}


ROUTES = {'study': study}
