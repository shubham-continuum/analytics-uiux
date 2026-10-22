"""All-bus data layer for the standalone dashboards. Upstream DuckDB is opened READ_ONLY.

Per-bus payloads have the same shape as data/snapshot.json ({metadata, nodes, series, grid}) and use the
same stamping and sign rules as extract_snapshot.py, so the reviewed cores run unchanged on any bus.
Results are cached under preview/cache/ (gzip); the cache is disposable.
"""
import calendar
import datetime as dt
import gzip
import json
import math
import re
import threading
from collections import defaultdict
from pathlib import Path

import duckdb

import api_common

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[1] / 'unified' / 'ISONE_GridSense_unified.duckdb'
CACHE = ROOT / 'cache'
HUB = {'id': 'hub', 'name': 'ISO-NE Internal Hub', 'priceMapping': {'pnode_name': '.H.INTERNAL_HUB', 'tier': 'hub'}}
HUB_FCST_BUS = 80000
SCREEN_YEAR = 2025
_LOCK = threading.Lock()  # one DuckDB connection shared by the threaded server

# ── D-008: the ONE bus → price-node link (S2-D, 2026-10-06) ───────────────────────────────────────────────
# Every surface that prices a bus (bus_payload, bus_list, screen, market, api_prices, api_pricesintra, api_market,
# plan/build_mapgrid) reads price_links(); nothing else reads bridge_bus_pnode / bus_link for a price node.
GEO_TIER = 'geo_proxy'
COLOCATED_TIERS = ('direct', 'same_substation')
RELINKED = 'relinked'
RELINK_METHOD = 'nearest_lat_lon'   # the geo-proxy rule: nearest dim_pnode with coordinates (reproduces all 1,460 geo links)
KM_PER_MI = 1.609344                # international mile, exact (unit definition)
RELINK_RULE = ("D-008: a rank-1 'direct'/'same_substation' price node farther from the bus than the farthest geo-proxy link "
               '(max bridge_bus_pnode.distance_km where tier = geo_proxy, read from the DB) is a same-name node in another town. '
               'The bus is re-linked to the nearest price node under the geo-proxy rule (dim_pnode with coordinates, great-circle '
               'miles; ties: a node with a settled series, then the bus\'s own link rank, then name) and is never priced through '
               'the far node. tier = relinked, distance disclosed.')
_LINKS = {}
_LINKS_LOCK = threading.Lock()


def connect():
    return duckdb.connect(str(SOURCE), read_only=True)


def clean(value):
    if isinstance(value, float) and not math.isfinite(value): return None
    if isinstance(value, (dt.date, dt.datetime)): return value.isoformat()
    if isinstance(value, dict): return {k: clean(v) for k, v in value.items()}
    if isinstance(value, (tuple, list)): return [clean(v) for v in value]
    return value


def rows(c, sql, params=()):
    r = c.execute(sql, list(params))
    names = [x[0] for x in r.description]
    return [dict(zip(names, row)) for row in r.fetchall()]


def _db_key(c):
    cur = c.cursor()
    try:
        path = cur.execute('SELECT path FROM duckdb_databases() WHERE database_name = current_database()').fetchone()[0]
    finally:
        cur.close()
    try:
        mt = Path(path).stat().st_mtime_ns
    except OSError:
        mt = None  # an in-memory or vanished file: keyed on the path alone
    return str(path), mt


def price_links(c):
    """{threshold_km, threshold_mi, rule, links: {bus_id: link}, relinked: [bus ids]} for every bus with a rank-1 link.

    A link carries the bridge_bus_pnode columns (pnode_name, tier, method, distance_km, buses_at_substation, link_rank)
    plus distance_mi (bus → node, None when the node has no coordinates), buses_sharing_series (recounted on the
    resolved links) and relinked_from (the far rank-1 node, or None). Cached per DB file + mtime."""
    key = _db_key(c)
    with _LINKS_LOCK:
        if key in _LINKS:
            return _LINKS[key]
    from api_grid import miles  # lazy: api_grid imports busdata
    cur = c.cursor()  # own cursor: the server shares one connection across threads
    try:
        thr_km = cur.execute('SELECT max(distance_km) FROM bridge_bus_pnode WHERE tier = ?', [GEO_TIER]).fetchone()[0]
        base = rows(cur, '''SELECT p.bus_id, p.pnode_name, p.tier, p.method, p.distance_km, p.buses_at_substation, p.link_rank,
                                   b.latitude AS blat, b.longitude AS blon, n.latitude AS plat, n.longitude AS plon
                            FROM bridge_bus_pnode p JOIN dim_bus b ON b.bus_id = p.bus_id
                            LEFT JOIN dim_pnode n ON n.pnode_name = p.pnode_name
                            WHERE p.link_rank = ? ORDER BY p.bus_id''', [1])
        cand = cur.execute('''SELECT pnode_name, latitude, longitude FROM dim_pnode
                              WHERE latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY pnode_name''').fetchall()
        held = {r[0] for r in cur.execute('SELECT DISTINCT pnode_name FROM pn_year').fetchall()}
        own = defaultdict(dict)
        for b, pn, rank in cur.execute('SELECT bus_id, pnode_name, link_rank FROM bridge_bus_pnode').fetchall():
            own[b][pn] = rank
    finally:
        cur.close()
    thr_mi = thr_km / KM_PER_MI
    links, relinked = {}, []
    for r in base:
        b = int(r['bus_id'])
        d = miles(r['blat'], r['blon'], r['plat'], r['plon'])
        rec = {k: r[k] for k in ('pnode_name', 'tier', 'method', 'distance_km', 'buses_at_substation', 'link_rank')}
        rec.update(bus_id=b, distance_mi=d, relinked_from=None)
        if r['tier'] in COLOCATED_TIERS and d is not None and d > thr_mi:
            far = {k: rec[k] for k in ('pnode_name', 'tier', 'method', 'link_rank', 'buses_at_substation', 'distance_mi')}
            best = None
            if r['blat'] is not None and r['blon'] is not None:
                best = min(((miles(r['blat'], r['blon'], la, lo), pn not in held, own[b].get(pn, math.inf), pn) for pn, la, lo in cand),
                           default=None)
            ok = best is not None and best[0] <= thr_mi
            rec.update(pnode_name=best[3] if ok else None, tier=RELINKED, method=RELINK_METHOD,
                       distance_km=round(best[0] * KM_PER_MI, 3) if ok else None, distance_mi=best[0] if ok else None,
                       buses_at_substation=None, relinked_from=far, decision='D-008')
            relinked.append(b)
        links[b] = rec
    n = defaultdict(int)
    for rec in links.values():
        if rec['pnode_name']:
            n[rec['pnode_name']] += 1
    for rec in links.values():
        rec['buses_sharing_series'] = n[rec['pnode_name']] if rec['pnode_name'] else None
    out = {'threshold_km': thr_km, 'threshold_mi': thr_mi, 'rule': RELINK_RULE, 'links': links, 'relinked': sorted(relinked)}
    with _LINKS_LOCK:
        _LINKS[key] = out
    return out


def link_of(c, bus_id):
    """The resolved link of one bus (a copy), or None."""
    rec = price_links(c)['links'].get(int(bus_id))
    return dict(rec) if rec else None


def bus_link_row(c, bus_id):
    """The resolved link in the unified `bus_link` view's shape (pnode_name, price_tier, price_proxy_km, buses_sharing_series),
    plus relink_mi / relinked_from for a D-008 re-linked bus. None when the bus has no priced link."""
    k = link_of(c, bus_id)
    if k is None or not k['pnode_name']:
        return None
    out = {'bus_id': int(bus_id), 'pnode_name': k['pnode_name'], 'price_tier': k['tier'], 'price_proxy_km': k['distance_km'],
           'buses_sharing_series': k['buses_sharing_series']}
    if k['tier'] == RELINKED:
        out.update(relink_mi=k['distance_mi'], relinked_from=k['relinked_from']['pnode_name'])
    return out


def link_params(c):
    """[bus ids, pnode names] of every resolved link, bound to `unnest(?::BIGINT[])`, `unnest(?::VARCHAR[])` in SQL."""
    L = price_links(c)['links']
    ids = [b for b in sorted(L) if L[b]['pnode_name']]
    return [ids, [L[b]['pnode_name'] for b in ids]]


# Settled per-bus marts are pn_* x the bus's price node (mart_bus_X == pn_X x bus_link, 33,469/33,469 rows, 2026-10-06).
# They are read at the RESOLVED node so a re-linked bus is never priced through its far node.
_PN_SQL = {'year': 'SELECT * FROM pn_year WHERE pnode_name = ? ORDER BY market, y',
           'month': 'SELECT * FROM pn_month WHERE pnode_name = ? ORDER BY market, y, m',
           'hour': 'SELECT * FROM pn_hour WHERE pnode_name = ? ORDER BY market, y, h',
           'tb': 'SELECT * FROM pn_tb WHERE pnode_name = ? ORDER BY market, y',
           'da_rt': 'SELECT * FROM pn_da_rt WHERE pnode_name = ? ORDER BY y'}


def bus_mart(c, bus_id, grain):
    """The mart_bus_<grain> rows of one bus, read at its resolved price node, in the mart's column shape."""
    link = link_of(c, bus_id)
    if link is None or not link['pnode_name']:
        return []
    out = []
    for r in rows(c, _PN_SQL[grain], [link['pnode_name']]):
        r.pop('pnode_name', None)
        head = {'bus_id': int(bus_id), 'price_tier': link['tier']}
        if grain == 'year':
            head['price_proxy_km'] = link['distance_km']
        head['buses_sharing_series'] = link['buses_sharing_series']
        out.append({**head, **r})
    return out


def fcst_record(day, hour, lmp, congestion, loss):
    """One forecast hourly record [timestamp, price, generation, energy, congestion, loss] on the ISO-NE sign.
    The run stores LMP = E - C + L: the flip happens once, in api_common.to_isone_sign."""
    x = api_common.to_isone_sign({'lmp': lmp, 'congestion': congestion, 'loss': loss}, 'fact_fcst_lmp_hourly')
    return [(dt.datetime.combine(day, dt.time()) + dt.timedelta(hours=hour)).isoformat(), lmp, None, x['energy'], x['congestion'], loss]


def historical_stamp(ts, occurrence):
    """Inferred Eastern clock (identical to extract_snapshot.py). Fold order unresolved by source."""
    march = dt.datetime(ts.year, 3, 1)
    spring = march + dt.timedelta(days=(6 - march.weekday()) % 7 + 7, hours=2)
    november = dt.datetime(ts.year, 11, 1)
    autumn = november + dt.timedelta(days=(6 - november.weekday()) % 7, hours=2)
    summer = spring <= ts < autumn
    if ts.date() == autumn.date() and ts.hour == 1 and occurrence: summer = False
    return ts.isoformat() + ('-04:00' if summer else '-05:00')


def _metadata():
    return {'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
            'sources': [{'file': str(SOURCE), 'mode': 'read_only', 'bytes': SOURCE.stat().st_size,
                         'modifiedAt': dt.datetime.fromtimestamp(SOURCE.stat().st_mtime, dt.timezone.utc).isoformat()}],
            'recordColumns': ['timestamp', 'price', 'generation (not supplied)', 'energy', 'congestion', 'loss'],
            'componentConvention': 'LMP = energy + congestion + loss; forecast stored congestion negated on export',
            'historicalTimeNote': 'Source lacks timezone/fold indicator. Eastern offsets inferred from calendar, repeated fall hour retained as two observations; order of the two fold prices is not verified.',
            'forecastNote': 'Individual model runs; not RT or DA and not interchangeable scenarios. Missing calendar hours are not filled.'}


def _series(c, node, runs):
    out = []
    raw = c.execute('SELECT ts,market,lmp,energy,congestion,loss FROM fact_lmp_hourly WHERE pnode_name=? ORDER BY ts, market, lmp',  # fold hour: source has no order, so make it stable

                    [node['priceMapping']['pnode_name']]).fetchall()
    groups, seen = defaultdict(list), defaultdict(int)
    for ts, market, price, energy, congestion, loss in raw:
        stamp = historical_stamp(ts, seen[(ts, market)]); seen[(ts, market)] += 1
        groups[(market, ts.year)].append([stamp, price, None, energy, congestion, loss])
    for (market, year), records in groups.items():
        expected = 8784 if calendar.isleap(year) else 8760
        valid = sum(r[1] is not None and math.isfinite(r[1]) for r in records)
        out.append({'nodeId': node['id'], 'mode': 'historical', 'market': market, 'year': year, 'run': 'settled', 'intervalHours': 1,
                    'records': records, 'source': 'fact_lmp_hourly', 'expectedHours': expected, 'observedHours': valid,
                    'complete': valid == expected, 'coverage': valid / expected,
                    'timezone': 'America/New_York inferred; autumn fold order unresolved in source'})
    bid = HUB_FCST_BUS if node['id'] == 'hub' else int(node['id'])
    raw = c.execute('SELECT scenario,study_date,hour,lmp,congestion,loss FROM fact_fcst_lmp_hourly WHERE bus_id=? ORDER BY scenario,study_date,hour', [bid]).fetchall()
    groups = defaultdict(list)
    for run, day, hour, price, congestion, loss in raw:
        groups[run].append(fcst_record(day, hour, price, congestion, loss))
    for run, records in groups.items():
        year = runs[run]['target_year']; expected = 8784 if calendar.isleap(year) else 8760
        valid = sum(r[1] is not None and math.isfinite(r[1]) for r in records)
        out.append({'nodeId': node['id'], 'mode': 'forecast', 'market': 'model', 'year': year, 'run': run, 'runDescription': runs[run]['description'],
                    'intervalHours': 1, 'records': records, 'source': 'fact_fcst_lmp_hourly', 'expectedHours': expected, 'observedHours': valid,
                    'complete': valid == expected, 'coverage': valid / expected,
                    'timezone': 'Not recorded; flat modeled calendar, timestamps have no UTC offset'})
    return out


def bus_payload(c, bus_id):
    """{metadata, nodes:[node], series, grid} for one bus or 'hub'; None when the id is not a geolocated bus."""
    bus_id = str(bus_id)
    if bus_id != 'hub' and not re.fullmatch(r'\d{1,9}', bus_id): return None
    runs = {r['scenario']: r for r in rows(c, "SELECT * FROM dim_scenario WHERE kind='forecast'")}
    if bus_id == 'hub':
        node, grid = dict(HUB), {'headroom': [], 'constraints': []}
    else:
        found = rows(c, 'SELECT * FROM dim_bus WHERE bus_id=? AND latitude IS NOT NULL', [int(bus_id)])
        link = link_of(c, bus_id)  # D-008: the resolved link, never the far same-name node
        if not found or not link: return None
        node = found[0]; node.update(id=bus_id, name=node['bus_name'], priceMapping=link)
        grid = {'headroom': rows(c, 'SELECT * FROM fact_headroom WHERE bus_id=?', [int(bus_id)]),
                'constraints': rows(c, 'SELECT * FROM fact_limiting_element WHERE bus_id=?', [int(bus_id)])}  # type: dict
    series = _series(c, node, runs)
    meta = _metadata(); meta['coverage'] = [{k: v for k, v in s.items() if k != 'records'} for s in series]
    grid = {**grid, 'source': 'unified.fact_headroom / fact_limiting_element',
            'coverageNote': 'Stored thermal screening only; voltage, stability, protection, breaker duty and affected-system studies not provided.'}
    return {'metadata': meta, 'nodes': [node], 'series': series, 'grid': grid}


def bus_list(c):
    """Every geolocated bus with its price mapping (tier, proxy distance) for the picker."""
    L = price_links(c)['links']
    hist = {r[0] for r in c.execute('SELECT DISTINCT pnode_name FROM fact_lmp_hourly').fetchall()}
    q = '''SELECT b.bus_id, b.bus_name, b.substation_name, b.nominal_kv, b.latitude, b.longitude, b.county, b.state_code, b.load_zone,
                  (SELECT count(DISTINCT scenario) FROM fact_fcst_lmp_hourly f WHERE f.bus_id=b.bus_id) AS n_runs
           FROM dim_bus b WHERE b.latitude IS NOT NULL ORDER BY b.bus_name, b.bus_id'''
    out = []
    for r in rows(c, q):
        k = L.get(int(r['bus_id']))
        if k is None: continue  # no rank-1 link: not on the picker (as before)
        rel = k['tier'] == RELINKED
        e = {'id': str(r['bus_id']), 'name': r['bus_name'], 'substation': r['substation_name'], 'kv': r['nominal_kv'],
             'lat': r['latitude'], 'lon': r['longitude'], 'county': r['county'], 'state': r['state_code'], 'zone': r['load_zone'],
             'pnode': k['pnode_name'], 'tier': k['tier'],
             'proxyKm': k['distance_km'] if k['tier'] in (GEO_TIER, RELINKED) else None,
             'hist': k['pnode_name'] in hist, 'runs': r['n_runs']}
        if rel:  # D-008: disclose the far node it is no longer priced through
            e.update(relinkMi=k['distance_mi'], relinkedFrom=k['relinked_from']['pnode_name'], relinkedFromMi=k['relinked_from']['distance_mi'])
        out.append(e)
    return out


def screen(c):
    """Per-bus summary for ranking all buses without hourly data. Missing = None (not held), never 0."""
    out = defaultdict(lambda: {'hist': {}, 'fcst': {}})
    L, lp = price_links(c)['links'], link_params(c)
    # Settled measures at each bus's RESOLVED price node (pn_* x price_links; == mart_bus_* for every bus not re-linked).
    for r in rows(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                        SELECT l.bus_id, p.avg_lmp, p.std_lmp, p.p5, p.p95, p.n_hours FROM l JOIN pn_year p USING (pnode_name)
                        WHERE p.market=? AND p.y=?''', lp + ['RT', SCREEN_YEAR]):
        out[str(r['bus_id'])]['hist'].update(avgRT=r['avg_lmp'], stdRT=r['std_lmp'], p5RT=r['p5'], p95RT=r['p95'], hoursRT=r['n_hours'])
        k = L[int(r['bus_id'])]
        out[str(r['bus_id'])]['priceTier'] = k['tier']; out[str(r['bus_id'])]['sharing'] = k['buses_sharing_series']
    for r in rows(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                        SELECT l.bus_id, p.tb4 FROM l JOIN pn_tb p USING (pnode_name) WHERE p.market=? AND p.y=?''', lp + ['RT', SCREEN_YEAR]):
        out[str(r['bus_id'])]['hist']['tb4RT'] = r['tb4']
    for r in rows(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                        SELECT l.bus_id, p.avg_rt_less_da FROM l JOIN pn_da_rt p USING (pnode_name) WHERE p.y=?''', lp + [SCREEN_YEAR]):
        out[str(r['bus_id'])]['hist']['rtLessDa'] = r['avg_rt_less_da']
    for r in rows(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                        SELECT l.bus_id, sum(p.solar_lmp*p.n_hours)/nullif(sum(p.avg_lmp*p.n_hours),0) AS ratio
                        FROM l JOIN pn_month p USING (pnode_name) WHERE p.market=? AND p.y=? GROUP BY 1''', lp + ['RT', SCREEN_YEAR]):
        out[str(r['bus_id'])]['hist']['solarRatioRT'] = r['ratio']
    for r in rows(c, 'SELECT scenario, bus_id, avg_lmp, min_lmp, max_lmp, neg_hours FROM mart_bus_fcst_year'):
        # A run node priced $0 in every hour is unpriced, not a $0 market (Market build 2026-09-29: 3 buses in pcr2030).
        unpriced = r['min_lmp'] == 0 and r['max_lmp'] == 0
        out[str(r['bus_id'])]['fcst'][r['scenario']] = {'avg': None if unpriced else r['avg_lmp'], 'negHours': None if unpriced else r['neg_hours']}
    return {'year': SCREEN_YEAR, 'market': 'RT',
            'source': 'unified pn_year / pn_tb / pn_da_rt / pn_month at each bus\'s resolved price node (busdata.price_links, D-008; '
                      '= mart_bus_* for every bus not re-linked) / mart_bus_fcst_year',
            'note': 'Screening summary only. Solar ratio = month-weighted solar_lmp ÷ avg_lmp from the mart (its solar weighting is the mart\'s, not the Prices calculator\'s clear-sky shape).',
            'buses': clean(dict(out))}


def market(c):
    """ISO-wide screening set from the SAME database and rules as Grid/Prices (one number per bus):
    bus facts + 2025 RT price summary + raw headroom/limiting-element rows (evaluated in JS by gridrules.js)."""
    buses = bus_list(c)
    sc = {str(r['bus_id']): r['short_circuit_mva'] for r in rows(c, 'SELECT bus_id, short_circuit_mva FROM dim_bus WHERE latitude IS NOT NULL')}
    neg = {str(r['bus_id']): r['neg'] for r in rows(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                                                          SELECT l.bus_id, sum(p.neg_hours) AS neg FROM l JOIN pn_month p USING (pnode_name)
                                                          WHERE p.market=? AND p.y=? GROUP BY 1''', link_params(c) + ['RT', SCREEN_YEAR])}
    scr = screen(c)['buses']
    nodes = []
    for b in buses:
        s = scr.get(b['id'], {}); h = s.get('hist', {}); f = s.get('fcst', {})
        nodes.append({'bus_id': int(b['id']), 'name': b['name'], 'state': b['state'], 'county': b['county'], 'kv': b['kv'], 'zone': b['zone'],
                      'lat': b['lat'], 'lon': b['lon'], 'sc_mva': sc.get(b['id']), 'tier': b['tier'], 'proxyKm': b['proxyKm'], 'pnode': b['pnode'], 'hist': b['hist'],
                      # D-008 (W-B, lead request 2026-10-07): the re-linked distance and the far node, so Market's tier label can say "relinked · N mi from <node>"
                      'relinkMi': b.get('relinkMi'), 'relinkedFrom': b.get('relinkedFrom'),
                      'lmp_2025': h.get('avgRT'), 'hneg_2025': neg.get(b['id']), 'tb4_2025': h.get('tb4RT'), 'solar_ratio_2025': h.get('solarRatioRT'),
                      'rt_less_da_2025': h.get('rtLessDa'), 'lmp_2030': (f.get('pcr2030') or {}).get('avg')})
    cols = 'bus_id, scenario, direction, monitored_facility, binding_contingency, contingency_id, dfax, transfer_mw, base_flow_mw, contingency_flow_mw, rating_a_mva, rating_c_mva, pct_loading_no_transfer, fix_cost_musd, length_miles, facility_type'
    return {'source': 'unified ISONE_GridSense_unified.duckdb: dim_bus, bridge_bus_pnode (resolved by busdata.price_links, D-008), '
                      'pn_year/month/tb/da_rt at the resolved node, mart_bus_fcst_year, fact_headroom, fact_limiting_element',
            'relinked': {'rule': RELINK_RULE, 'buses': price_links(c)['relinked']},
            'year': SCREEN_YEAR, 'nodes': nodes,
            'grid': {'headroom': rows(c, 'SELECT bus_id, scenario, direction, headroom_mw FROM fact_headroom'), 'constraints': rows(c, f'SELECT {cols} FROM fact_limiting_element')}}


def cached(name, build):
    """Return gzip JSON bytes for `name`, building once under the lock."""
    CACHE.mkdir(exist_ok=True)
    stamp = int(SOURCE.stat().st_mtime)  # a rebuilt database invalidates every cached payload
    f = CACHE / f'{name}-{stamp}.json.gz'
    if f.exists(): return f.read_bytes()
    with _LOCK:
        if f.exists(): return f.read_bytes()
        value = build()
        if value is None: return None
        body = gzip.compress(json.dumps(clean(value), separators=(',', ':'), allow_nan=False).encode('utf-8'), 6)
        tmp = f.with_suffix('.tmp'); tmp.write_bytes(body); tmp.replace(f)
        return body
