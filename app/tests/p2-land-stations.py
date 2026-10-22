"""P2 C40: Land's "stations within 15 miles" is the whole radius, not the nearest 60 rows.

Provenance: Claude Opus 5.5 (P2 land fix agent) · one-studio/design (T3, P2 land) · 2026-10-10 · sign-off pending · v1
Run: python -m pytest -q "tests/p2-land-stations.py"   (from one-studio/app; reads the unified DuckDB read-only)

The independent count is a Python haversine (R = 3,958.8 mi) over every dim_substation row with a coordinate, the bus
itself excluded: the same population api_land.site() filters in SQL. Three buses whose 15-mile lists the old LIMIT 60
cut short (Mashpee 111403: 108 rows; 110815: 245; 110762: 255). Also: the payload states the total, and the element
rows Land needs for the Grid verdict (D6.1, C07) come for exactly the station buses.
"""
import math
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
import busdata  # noqa: E402

BUSES = [111403, 110815, 110762]


def _hav(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin(math.radians(lat2 - lat1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def _independent(c, bid, radius):
    me = busdata.rows(c, 'SELECT latitude, longitude FROM dim_substation WHERE bus_id = ?', [bid]) or \
        busdata.rows(c, 'SELECT latitude, longitude FROM dim_bus WHERE bus_id = ?', [bid])
    lat, lon = float(me[0]['latitude']), float(me[0]['longitude'])
    n = 0
    for r in busdata.rows(c, 'SELECT bus_id, latitude, longitude FROM dim_substation WHERE latitude IS NOT NULL AND bus_id <> ?', [bid]):
        try: la, lo = float(r['latitude']), float(r['longitude'])
        except (TypeError, ValueError): continue
        if _hav(lat, lon, la, lo) <= radius + 1e-9: n += 1
    return n


def check(api, c, bid):
    out = api.site(c, str(bid))
    assert out is not None and out['stations'] is not None
    want = _independent(c, bid, api.R_STATION)
    st = out['stations']
    assert len(st) == want, f'{bid}: {len(st)} station rows returned, {want} within {api.R_STATION} mi'
    assert out.get('stationsTotal') == want, f'{bid}: stationsTotal {out.get("stationsTotal")} != {want}'
    assert max(r['mi'] for r in st) <= api.R_STATION + 1e-9
    el = out.get('stationElements')
    assert isinstance(el, list), f'{bid}: stationElements missing (C07 needs the element rows per station)'
    ids = {r['bus_id'] for r in st}
    assert all(r['bus_id'] in ids for r in el)
    assert el, f'{bid}: no element rows for any of {len(ids)} stations'
    return len(st), want


@pytest.fixture(scope='module')
def conn():
    if not busdata.SOURCE.exists(): pytest.skip('unified DuckDB not present')
    c = busdata.connect()
    c.execute("PRAGMA memory_limit='1GB'"); c.execute('PRAGMA threads=2')
    yield c
    c.close()


@pytest.mark.parametrize('bid', BUSES)
def test_station_rows_cover_the_whole_radius(conn, bid):
    import api_land
    n, want = check(api_land, conn, bid)
    assert n > 60, f'{bid}: the fixture bus should exceed the old 60-row cap ({n})'
