"""Build the map/grid display-only data (04a §1/§2) from the unified DuckDB, as one atomically published generation.

Provenance: Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · 2026-10-06 · sign-off pending · v1

    python plan/build_mapgrid.py --db "<abs path to ISONE_GridSense_unified.duckdb>" [--out data/mapgrid]
    (--db may also come from GRIDSENSE_UNIFIED_DB; there is no built-in default path.)

Only DISPLAY-ONLY fields are built (branches, zones, zone_fix, stations, loading counts, sheet pre-existing issues,
short circuit, queue + top facilities, load_pays, forecast_delta, land_cost_proxy, cathy proxy distance/tier,
run_input_flags, coverage) plus the per-bus identity record. Engine-class quantities (headroom, cost, curtailment,
prices, basis, decomp, capture, TB, exclusions, score, gates) come from the preview engine and are never built here.

Output layout (04 §Storage, atomic publish):
    data/mapgrid/current.json            {"generation", "dir"}  -- replaced with os.replace, the only switch
    data/mapgrid/g-<generation>-<stamp>/ one <group>.json per field group + meta.json
A build writes into data/mapgrid/.tmp-*/ and renames it into place; a crash before the pointer swap leaves the
previous generation served. The current and the previous generation are kept; older ones are pruned.

Missing = JSON null, never 0; meta.fields[group].nullReason says why. The DB is opened read-only; SQL is parameterised.
"""
import argparse
import calendar
import datetime as dt
import hashlib
import json
import os
import re
import secrets
import shutil
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

import duckdb

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
import api_common  # noqa: E402
import busdata  # noqa: E402
from api_grid import miles  # noqa: E402  (great-circle statute miles, the preview's one helper)

BUILDER_VERSION = 'mapgrid-2 (2026-10-07, D-008 links via busdata.price_links)'
DEFAULT_OUT = APP / 'data' / 'mapgrid'

FIELD_GROUPS = ['identity', 'branches', 'zones', 'stations', 'loading', 'pre_issues', 'short_circuit', 'queue',
                'load_pays', 'forecast_delta', 'land_cost_proxy', 'cathy', 'run_input_flags']
SPEC_CELLS = ['unit', 'interval', 'tz', 'weighting', 'level', 'null_render', 'source']

# Every column the builder reads. schema_hash() hashes exactly these (name + type), so a dropped or retyped
# column makes the served generation stale.
TABLE_COLUMNS = {
    'dim_bus': ['bus_id', 'bus_name', 'substation_name', 'nominal_kv', 'latitude', 'longitude', 'county', 'state_code',
                'load_zone', 'load_zone_source', 'in_powerflow_model', 'short_circuit_mva'],
    'dim_substation': ['bus_id', 'total_outlets'],
    'bridge_bus_pnode': ['bus_id', 'pnode_name', 'tier', 'method', 'distance_km', 'link_rank', 'buses_at_substation'],
    'dim_pnode': ['pnode_name', 'zone_name', 'latitude', 'longitude'],
    'pn_year': ['pnode_name', 'market', 'y', 'avg_lmp', 'n_hours'],
    'dim_branch': ['from_bus_id', 'to_bus_id', 'voltage', 'status'],
    'dim_generator': ['bus_id', 'gen_mw'],
    'dim_load': ['bus_id', 'load_mw'],
    'mart_bus_profile': ['bus_id', 'first_limit_facility', 'first_limit_contingency', 'first_limit_dfax'],
    'fact_limiting_element': ['bus_id', 'scenario', 'direction', 'monitored_facility', 'binding_contingency', 'kv', 'zone',
                              'base_flow_mw', 'contingency_flow_mw', 'rating_a_mva', 'rating_c_mva', 'transfer_mw',
                              'pct_loading_no_transfer', 'fix_cost_musd', 'length_miles'],
    'fact_headroom': ['bus_id', 'scenario', 'direction', 'pre_existing_issues'],
    'dim_queue': ['queue_position', 'request_date', 'poi_name', 'max_mw', 'summer_mw_modelled', 'summer_pct_modelled',
                  'light_mw_modelled', 'light_pct_modelled', 'county', 'state', 'projected_is_date',
                  'interconnection_service_requested', 'resource_type', 'status', 'longitude', 'latitude', 'iso'],
    'fact_lmp_hourly': ['pnode_name', 'ts', 'market', 'lmp'],
    'mart_bus_fcst_year': ['scenario', 'bus_id', 'avg_lmp', 'min_lmp', 'max_lmp', 'avg_cong', 'avg_loss'],
    'dim_scenario': ['scenario', 'kind', 'target_year'],
}

# Operator load-zone ids (dim_pnode.zone_name) -> the eight zone codes the Studio uses.
ZONE_OF_OPERATOR = {'.Z.CONNECTICUT': 'CT', '.Z.MAINE': 'ME', '.Z.NEWHAMPSHIRE': 'NH', '.Z.VERMONT': 'VT',
                    '.Z.RHODEISLAND': 'RI', '.Z.SEMASS': 'SEMA', '.Z.WCMASS': 'WCMA', '.Z.NEMASSBOST': 'NEMA'}
HOURLY_CONF = {'direct': 'exact', 'same_substation': 'shared_substation'}  # geo_proxy: no own hourly series

# Store (scenario, direction) -> the key spellings the live loading map uses (DATA-EXT-CONTRACT §loading).
# The first spelling holds the entry; a second spelling is an alias string naming the first (31 follows it once).
LOADING_SPELLINGS = {('summer_peak', 'discharge'): ['injection', 'discharge'],
                     ('summer_peak', 'charge'): ['charge'],
                     ('large_load', 'charge'): ['charge']}
LOADING_NOT_PUBLISHED = {('shoulder', 'discharge'): 'the large-load injection screen under a wrong label (§D33); live excludes it too'}
NO_VIOLATIONS = 'No Violations found'

PRE_ISSUE_KEY = {('summer_peak', 'discharge'): 'sp_dis', ('summer_peak', 'charge'): 'sp_chg', ('shoulder', 'discharge'): 'sh_dis',
                 ('shoulder', 'charge'): 'sh_chg', ('large_load', 'charge'): 'll_chg'}

LOAD_PAYS_YEAR = busdata.SCREEN_YEAR       # the settled year the preview screens on
CHEAP_USD_MWH = 20                         # live contract definition: load_pays.cheap_hours_lt20 = hours priced < $20/MWh
FORECAST_DELTA_RUNS = ('10yr', 'pcr2035')  # the store's one study year solved by two runs (live contract §forecast_delta)
PARTIAL_SHARE = 0.95                       # DATA-EXT-CONTRACT partial rule: a year with hours < 0.95 x calendar hours is partial
TOP_FACILITIES_N = 20                      # live iso.top_facilities length
KM_PER_MI = 1.609344                       # international mile, exact

ENGINE_NAMES = re.compile(r'^(headroom|hr|hr_.*|sto_.*|storage_headroom|cost|cost\d+|kw\d+|curt.*|lmp(_\d+|\d+_pb)?|price.*|basis.*|'
                          r'decomp|energy|cong|cong_part|loss_part|cap_.*|capture|tb\d+(_\d+)?|exclusions|clear_.*|disc_.*|score|'
                          r'rank|gates?|p5|p95|std|hneg|rt_neg|h200)$')

FIELD_SPEC = {
    'identity': dict(unit='kV · ° · MW · mi per column', interval='static (model vintage)', tz='n/a (static)', weighting='n/a',
                     level='bus', null_render='not held + per-column reason',
                     source='dim_bus ⋈ dim_substation ⋈ busdata.price_links (bridge_bus_pnode rank 1, D-008 re-link) ⋈ dim_pnode; '
                            'shared_n = bridge_bus_pnode.buses_at_substation, series_n = buses on the resolved node; '
                            'sum(dim_generator.gen_mw), sum(dim_load.load_mw); count(dim_branch ends); mart_bus_profile.first_limit_*'),
    'branches': dict(unit='bus ids · kV', interval='static', tz='n/a (static)', weighting='n/a', level='branch',
                     null_render='branch absent (counted in coverage)', source='dim_branch, both ends on the dim_bus spine, kV ascending'),
    'zones': dict(unit='° (label position) · bus count · zone code', interval='static', tz='n/a (static)', weighting='simple mean of bus coordinates',
                  level='load zone', null_render='zone absent', source='dim_bus.load_zone; dim_pnode.zone_name of the link_rank-1 pnode where load_zone_source=pnode'),
    'stations': dict(unit='bus ids', interval='static', tz='n/a (static)', weighting='n/a', level='substation',
                     null_render='single-bus station', source='dim_bus.substation_name groups'),
    'loading': dict(unit='count of elements', interval='static (study vintage)', tz='n/a (static)', weighting='n/a', level='bus × case',
                    null_render='not held (no loading run for this bus/case)',
                    source='fact_limiting_element: N-0 base flow / Rate A, N-1 contingency flow / Rate C; violation = >100 %; pre-existing = transfer_mw < 0'),
    'pre_issues': dict(unit='count (sheet)', interval='static (study vintage)', tz='n/a (static)', weighting='n/a', level='bus × case',
                       null_render='not held', source='fact_headroom.pre_existing_issues (vendor sheet count, labelled "sheet")'),
    'short_circuit': dict(unit='MVA (corrected: √3·kV·kA)', interval='static', tz='n/a (static)', weighting='n/a', level='bus',
                          null_render='not held', source='dim_bus.short_circuit_mva (unified corrected column; the published one is 100× small)'),
    'queue': dict(unit='MW · count · % · $M · mi', interval='static (register snapshot)', tz='n/a (static)', weighting='n/a',
                  level='queue request / facility', null_render='not held',
                  source='dim_queue rows; top facilities = fact_limiting_element summer_peak grouped by facility + contingency'),
    'load_pays': dict(unit='$/MWh · h · %', interval=f'hourly, settled RT {LOAD_PAYS_YEAR}', tz='EPT hour-ending', weighting='simple (flat load)',
                      level="bus's resolved price node (busdata.price_links, D-008)", null_render='not held',
                      source=f'pn_year (RT, {LOAD_PAYS_YEAR}) avg_lmp/n_hours at the resolved node; fact_lmp_hourly hours < ${CHEAP_USD_MWH}/MWh there'),
    'forecast_delta': dict(unit='$/MWh · %', interval='annual mean of hourly solved runs', tz='flat model calendar (no DST)', weighting='simple',
                           level='bus (run node)', null_render='not held (run not priced at this bus)',
                           source=f'mart_bus_fcst_year avg_lmp, {FORECAST_DELTA_RUNS[0]} − {FORECAST_DELTA_RUNS[1]}'),
    'land_cost_proxy': dict(unit='$/acre (assumption)', interval='n/a', tz='n/a (static)', weighting='n/a', level='county',
                            null_render='not held', source='none in the unified DB (live: GridSense_one derived.mart_land_cost_proxy)'),
    'cathy': dict(unit='mi · tier · pnode', interval='static', tz='n/a (static)', weighting='n/a', level='bus',
                  null_render='not applicable (own/station node) or not held',
                  source='busdata.price_links (bridge_bus_pnode link_rank=1; D-008 relinked: nearest node, great-circle mi)'),
    'run_input_flags': dict(unit='$/MWh (ISO-NE sign)', interval='annual mean of the 5yr run', tz='flat model calendar (no DST)', weighting='simple',
                            level='bus (run node)', null_render='not held',
                            source='mart_bus_fcst_year 5yr avg_cong via api_common.to_isone_sign; Cape OSW regression not rebuildable (no 5yr binding rows)'),
}


# ── small pure helpers (unit-tested) ──────────────────────────────────────────────────────────────────

def zone_code(operator_zone):
    return ZONE_OF_OPERATOR.get(operator_zone) if operator_zone else None


def corrected_zone(sheet_zone, zone_source, tier, links, colocated_max_mi):
    """(zone, suspect). links = [(link_rank, operator zone, miles from the bus)] of the bus's own/station price nodes.

    The operator zone of the best-ranked CO-LOCATED linked node replaces the sheet zone. A 'direct'/'same_substation'
    node farther than the farthest nearest-neighbour proxy link (colocated_max_mi, read from the DB) is a same-name
    node in another town: never used, and a rank-1 link like that flags the bus (suspect)."""
    if zone_source != 'pnode' or tier not in HOURLY_CONF:
        return sheet_zone, False
    links = sorted(links, key=lambda x: x[0])
    far = lambda mi: mi is not None and mi > colocated_max_mi
    suspect = bool(links) and far(links[0][2])
    for _rank, oz, mi in links:
        if not far(mi) and zone_code(oz):
            return zone_code(oz), suspect
    return sheet_zone, suspect


def calendar_hours(year):
    return (366 if calendar.isleap(year) else 365) * 24


def is_partial(hours, year):
    return hours is None or hours < PARTIAL_SHARE * calendar_hours(year)


def km_to_mi(km):
    return None if km is None else km / KM_PER_MI


def is_engine_name(name):
    return bool(ENGINE_NAMES.match(str(name)))


def loading_counts(rows):
    """PANEL §F counts over one bus×case's element rows. Sentinel rows (no rating) are not elements.
    Returns None when no element row is held."""
    els = [r for r in rows if r.get('rating_a_mva') is not None or r.get('rating_c_mva') is not None]
    if not els:
        return None
    viol = pre = 0
    for r in els:
        n0 = r.get('contingency_flow_mw') is None
        flow = r.get('base_flow_mw') if n0 else r.get('contingency_flow_mw')
        rating = r.get('rating_a_mva') if n0 else r.get('rating_c_mva')
        if flow is not None and rating:
            if 100 * abs(flow) / rating > 100:
                viol += 1
        if r.get('transfer_mw') is not None and r['transfer_mw'] < 0:
            pre += 1
    return {'n_rows': len(els), 'violations_before': viol, 'pre_existing_n': pre}


def _nulls(o):
    if o is None:
        return 1
    if isinstance(o, dict):
        return sum(_nulls(v) for v in o.values())
    if isinstance(o, list):
        return sum(_nulls(v) for v in o)
    return 0


def count_rows(group, data):
    if group == 'identity':
        return len(data['rows'])
    if group == 'branches':
        return len(data['branches'])
    if group == 'zones':
        return len(data['zones'])
    if group == 'stations':
        return len(data['stations'])
    if group == 'queue':
        return len(data['points'])
    if group == 'land_cost_proxy':
        return len(data['rows'] or [])
    if group == 'run_input_flags':
        return len(data['mcc_5yr'])
    return len(data)


def _is_num(v):
    return v is None or (isinstance(v, (int, float)) and not isinstance(v, bool))


def validate_group(group, data):
    """Shape check of one published group. Returns a list of error strings (empty = valid)."""
    e = []
    bus = re.compile(r'^\d{1,9}$')
    if group == 'identity':
        cols = data.get('cols') or []
        need = ['bus_id', 'name', 'kv', 'zone', 'zone_sheet', 'zone_src', 'state', 'county', 'lat', 'lon', 'station', 'hourly_conf',
                'shared_n', 'outlets', 'branch_deg', 'gen_mw', 'load_mw', 'top_constraint', 'top_shadow', 'tier', 'proxy_mi']
        e += [f'identity: column {c} missing' for c in need if c not in cols]
        num = [cols.index(c) for c in ('kv', 'lat', 'lon', 'station', 'shared_n', 'series_n', 'outlets', 'branch_deg', 'gen_mw', 'load_mw', 'top_shadow', 'proxy_mi', 'pnode_mi') if c in cols]
        for r in data.get('rows') or []:
            if len(r) != len(cols):
                e.append(f'identity: row width {len(r)}')
            if not isinstance(r[0], int):
                e.append(f'identity: bus_id {r[0]!r}')
            e += [f'identity {r[0]}: {cols[i]} not numeric' for i in num if not _is_num(r[i])]
    elif group == 'branches':
        for b in data.get('branches') or []:
            if not (isinstance(b, list) and len(b) == 3 and all(isinstance(x, int) for x in b[:2]) and _is_num(b[2])):
                e.append(f'branches: bad row {b!r}')
    elif group == 'zones':
        for z in data.get('zones') or []:
            if set(z) != {'zone', 'lat', 'lon', 'buses'} or not all(_is_num(z[k]) for k in ('lat', 'lon', 'buses')):
                e.append(f'zones: bad row {z!r}')
        for k, v in (data.get('zone_fix') or {}).items():
            if not bus.match(k) or v not in ZONE_OF_OPERATOR.values():
                e.append(f'zone_fix: {k} -> {v!r}')
    elif group == 'stations':
        for s in data.get('stations') or []:
            if not (isinstance(s, list) and s and all(isinstance(x, int) for x in s)):
                e.append(f'stations: bad group {s!r}')
    elif group == 'loading':
        for k, v in data.items():
            p = k.split('|')
            if len(p) != 3 or not bus.match(p[0]):
                e.append(f'loading: key {k}')
            elif isinstance(v, str):
                if v not in data:
                    e.append(f'loading: alias {k} -> missing {v}')
            elif not (set(v) <= {'n_rows', 'violations_before', 'pre_existing_n', 'note'} and all(_is_num(v.get(x)) for x in ('n_rows', 'violations_before', 'pre_existing_n'))):
                e.append(f'loading: entry {k} {v!r}')
    elif group == 'pre_issues':
        for k, v in data.items():
            if not bus.match(k) or set(v) != set(PRE_ISSUE_KEY.values()) or not all(_is_num(x) for x in v.values()):
                e.append(f'pre_issues: {k} {v!r}')
    elif group == 'short_circuit':
        e += [f'short_circuit: {k} {v!r}' for k, v in data.items() if not bus.match(k) or not _is_num(v)]
    elif group == 'queue':
        if not isinstance(data.get('points'), list) or not isinstance(data.get('top_facilities'), list):
            e.append('queue: points/top_facilities missing')
        for q in data.get('points') or []:
            if not (_is_num(q.get('max_mw')) and _is_num(q.get('latitude')) and _is_num(q.get('longitude'))):
                e.append(f'queue point {q.get("queue_position")}')
        for t in data.get('top_facilities') or []:
            if not (t.get('facility') and isinstance(t.get('n'), int) and all(_is_num(t.get(k)) for k in ('loading', 'cost_musd', 'miles', 'kv'))):
                e.append(f'top_facility {t!r}')
    elif group == 'load_pays':
        for k, v in data.items():
            if not bus.match(k) or set(v) != {'year', 'mean_rt', 'cheap_hours_lt20', 'cheap_share', 'hours'} or not all(_is_num(x) for x in v.values()):
                e.append(f'load_pays: {k} {v!r}')
    elif group == 'forecast_delta':
        for k, v in data.items():
            if not bus.match(k) or set(v) != {'year', 'run_a', 'run_b', 'a', 'b', 'delta', 'delta_pct'}:
                e.append(f'forecast_delta: {k} {v!r}')
    elif group == 'land_cost_proxy':
        if 'rows' not in data:
            e.append('land_cost_proxy: rows key missing')
    elif group == 'cathy':
        for k, v in data.items():
            if not bus.match(k) or set(v) != {'tier', 'pnode', 'distance_mi'} or not _is_num(v['distance_mi']):
                e.append(f'cathy: {k} {v!r}')
    elif group == 'run_input_flags':
        if set(data) != {'mcc_5yr', 'cape_5yr'}:
            e.append(f'run_input_flags: keys {sorted(data)}')
        e += [f'mcc_5yr: {k} {v!r}' for k, v in (data.get('mcc_5yr') or {}).items() if not bus.match(k) or not _is_num(v)]
    else:
        e.append(f'unknown group {group}')
    return e


# ── schema hash and generation id ─────────────────────────────────────────────────────────────────────

def schema_hash(conn):
    """Hash of (table, column, type) for exactly the columns read. A missing column hashes as MISSING."""
    h = hashlib.sha256()
    for table in sorted(TABLE_COLUMNS):
        have = dict(conn.execute('SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? ORDER BY column_name', [table]).fetchall())
        for col in sorted(TABLE_COLUMNS[table]):
            h.update(f'{table}.{col}:{have.get(col, "MISSING")}\n'.encode())
    return h.hexdigest()[:16]


def _canon(o):
    return json.dumps(busdata.clean(o), sort_keys=True, separators=(',', ':'), allow_nan=False, ensure_ascii=False)


def generation_id(groups, meta):
    h = hashlib.sha256()
    h.update(f'{meta.get("builder_version")}|{meta.get("schema_hash")}\n'.encode())
    for name in sorted(groups):
        h.update(name.encode())
        h.update(_canon(groups[name]).encode())
    return h.hexdigest()[:16]


# ── atomic publish ────────────────────────────────────────────────────────────────────────────────────

def _write_json(path, value):
    Path(path).write_text(json.dumps(busdata.clean(value), separators=(',', ':'), allow_nan=False, ensure_ascii=False), encoding='utf-8')


def _pointer(out):
    try:
        return json.loads((out / 'current.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def publish(groups, meta, out_dir):
    """Write a complete generation into a temp dir, rename it into place, then swap the pointer. Returns the id."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    gen = generation_id(groups, meta)
    tmp = out / f'.tmp-{os.getpid()}-{secrets.token_hex(4)}'
    tmp.mkdir()
    try:
        for name, data in groups.items():
            _write_json(tmp / f'{name}.json', data)
        m = dict(meta, generation=gen)
        m.setdefault('built_at', dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'))
        _write_json(tmp / 'meta.json', m)
        final = out / f'g-{gen}-{time.time_ns():x}'
        os.rename(tmp, final)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    prev = _pointer(out)
    ptr_tmp = out / f'.tmp-current-{secrets.token_hex(4)}.json'
    ptr_tmp.write_text(json.dumps({'generation': gen, 'dir': final.name}), encoding='utf-8')
    os.replace(ptr_tmp, out / 'current.json')  # the only switch a reader sees
    keep = {final.name} | ({prev['dir']} if prev and prev.get('dir') else set())
    for p in out.iterdir():
        if p.is_dir() and p.name.startswith('g-') and p.name not in keep:
            shutil.rmtree(p, ignore_errors=True)
    return gen


# ── collect from the DB ───────────────────────────────────────────────────────────────────────────────

def _rows(c, sql, params=()):
    return busdata.rows(c, sql, params)


def collect(c):
    """Every display-only group from the unified DB. Returns (groups, fields, coverage, validation)."""
    fields, coverage, validation = {}, {}, {}
    r1, r2, r4 = (lambda v: api_common.r(v, 1)), (lambda v: api_common.r(v, 2)), (lambda v: api_common.r(v, 4))

    # spine: every geolocated bus with a vendor substation row
    spine = _rows(c, '''SELECT b.bus_id, b.bus_name, b.substation_name, b.nominal_kv, b.latitude, b.longitude, b.county, b.state_code,
                               b.load_zone, b.load_zone_source, b.in_powerflow_model, b.short_circuit_mva, s.total_outlets
                        FROM dim_bus b JOIN dim_substation s ON s.bus_id = b.bus_id
                        WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL ORDER BY b.bus_id''')
    # The ONE price link (busdata.price_links, D-008): a far same-name rank-1 node is replaced by the nearest node.
    PL = busdata.price_links(c)
    pcoord = {r['pnode_name']: r for r in _rows(c, 'SELECT pnode_name, zone_name, latitude, longitude FROM dim_pnode')}
    for b in spine:
        k = PL['links'].get(int(b['bus_id'])) or {}
        n = pcoord.get(k.get('pnode_name')) or {}
        far = k.get('relinked_from') or {}
        b.update(pnode_name=k.get('pnode_name'), tier=k.get('tier'), distance_km=k.get('distance_km'),
                 distance_mi=k.get('distance_mi'), buses_at_substation=k.get('buses_at_substation'),
                 buses_sharing_series=k.get('buses_sharing_series'), pnode_zone=n.get('zone_name'),
                 pnode_lat=n.get('latitude'), pnode_lon=n.get('longitude'),
                 link_tier=far.get('tier') or k.get('tier'))  # the stored rank-1 tier: the zone rule reads it
    ids = [int(b['bus_id']) for b in spine]
    on_spine = set(ids)
    coverage['spine_buses'] = len(ids)

    # branches
    allb = _rows(c, 'SELECT from_bus_id, to_bus_id, voltage, status FROM dim_branch')
    deg = Counter()
    kept, off, loops = [], 0, 0
    for b in allb:
        a, z = b['from_bus_id'], b['to_bus_id']
        if a is not None and z is not None and a == z:
            loops += 1
            continue
        for x in (a, z):
            if x is not None:
                deg[int(x)] += 1
        if a in on_spine and z in on_spine:
            kept.append([int(a), int(z), b['voltage']])
        else:
            off += 1
    kept.sort(key=lambda r: (r[2] if r[2] is not None else -1, r[0], r[1]))
    kvc = Counter('345 kV and above' if (k or 0) >= 345 else '200–344 kV' if (k or 0) >= 200 else '100–199 kV' if (k or 0) >= 100 else 'under 100 kV' for _, _, k in kept)
    coverage.update(network_branches=len(kept), network_branches_in_store=len(allb), network_branches_dropped_off_spine=off,
                    network_branches_dropped_self_loop=loops,
                    network_branches_open=sum(1 for b in allb if b['from_bus_id'] in on_spine and b['to_bus_id'] in on_spine and (b['status'] or '').lower() == 'open'),
                    network_branch_pairs=len({(min(a, z), max(a, z)) for a, z, _ in kept}), network_kv_classes=dict(kvc),
                    network_source='unified dim_branch (the powerflow model element list; endpoints are bus numbers)')
    branches = {'branches': kept}

    # zones: sheet zone, corrected zone (operator zone of the bus's own / station pnode), centroids on the corrected zone
    geo_max_mi = km_to_mi(_rows(c, 'SELECT max(distance_km) AS km FROM bridge_bus_pnode WHERE tier = ?', ['geo_proxy'])[0]['km'])
    links = defaultdict(list)
    for r in _rows(c, '''SELECT p.bus_id, p.link_rank, n.zone_name, n.latitude, n.longitude, b.latitude AS blat, b.longitude AS blon
                         FROM bridge_bus_pnode p JOIN dim_bus b ON b.bus_id = p.bus_id LEFT JOIN dim_pnode n ON n.pnode_name = p.pnode_name
                         WHERE b.latitude IS NOT NULL'''):
        links[int(r['bus_id'])].append((r['link_rank'], r['zone_name'], miles(r['blat'], r['blon'], r['latitude'], r['longitude'])))
    zone_fix, corrected, suspect, pnode_mi = {}, {}, [], {}
    for b in spine:
        i = int(b['bus_id'])
        pnode_mi[i] = miles(b['latitude'], b['longitude'], b['pnode_lat'], b['pnode_lon'])
        z, sus = corrected_zone(b['load_zone'], b['load_zone_source'], b['link_tier'], links.get(i, []), geo_max_mi)
        corrected[i] = z
        if sus:
            suspect.append(i)
        if z and z != b['load_zone']:
            zone_fix[str(i)] = z
    spine_rel = sorted(i for i in PL['relinked'] if i in on_spine)
    assert sorted(suspect) == spine_rel, 'zone-rule suspects and busdata.price_links re-links must be one list'
    coverage['suspect_pnode_links'] = {
        'rule': PL['rule'] + ' zone_fix takes the operator zone of the best-ranked co-located linked node (sheet zone if none).',
        'threshold_mi': round(geo_max_mi, 2), 'n': len(spine_rel), 'buses': spine_rel, 'decision': 'D-008',
        'relinked': {str(i): {'pnode': PL['links'][i]['pnode_name'], 'mi': r2(PL['links'][i]['distance_mi']),
                              'from': PL['links'][i]['relinked_from']['pnode_name'],
                              'from_mi': r2(PL['links'][i]['relinked_from']['distance_mi'])} for i in spine_rel}}
    acc = defaultdict(list)
    for b in spine:
        z = corrected[int(b['bus_id'])]
        if z:
            acc[z].append((b['latitude'], b['longitude']))
    zones = {'zones': [{'zone': z, 'lat': r4(sum(p[0] for p in v) / len(v)), 'lon': r4(sum(p[1] for p in v) / len(v)), 'buses': len(v)} for z, v in sorted(acc.items())],
             'zone_fix': zone_fix}
    coverage.update(zone_fixes=len(zone_fix), zone_anchors=len(zones['zones']))

    # stations
    st = defaultdict(list)
    for b in spine:
        if b['substation_name']:
            st[b['substation_name']].append(int(b['bus_id']))
    stations = {'stations': [sorted(v) for _, v in sorted(st.items())]}
    station_n = {i: len(v) for v in st.values() for i in v}

    # system: generation, load, first limiting element
    gen = {int(r['bus_id']): r['mw'] for r in _rows(c, 'SELECT bus_id, sum(gen_mw) AS mw FROM dim_generator WHERE bus_id IS NOT NULL GROUP BY bus_id')}
    load = {int(r['bus_id']): r['mw'] for r in _rows(c, 'SELECT bus_id, sum(load_mw) AS mw FROM dim_load WHERE bus_id IS NOT NULL GROUP BY bus_id')}
    first = {int(r['bus_id']): r for r in _rows(c, 'SELECT bus_id, first_limit_facility, first_limit_contingency, first_limit_dfax FROM mart_bus_profile')}

    # identity
    cols = ['bus_id', 'name', 'kv', 'zone', 'zone_sheet', 'zone_src', 'state', 'county', 'lat', 'lon', 'station', 'hourly_conf', 'shared_n',
            'series_n', 'outlets', 'branch_deg', 'gen_mw', 'load_mw', 'top_constraint', 'top_constraint_contingency', 'top_shadow', 'tier', 'proxy_mi', 'pnode',
            'pnode_mi']
    rows = []
    for b in spine:
        i = int(b['bus_id'])
        geo = b['tier'] in ('geo_proxy', busdata.RELINKED)  # no own or station series
        fl = first.get(i) or {}
        real_limit = fl.get('first_limit_dfax') is not None  # a sentinel row ("No Violations found") has no DFAX
        rows.append([i, b['bus_name'], b['nominal_kv'], corrected[i], b['load_zone'], b['load_zone_source'], b['state_code'], b['county'],
                     r4(b['latitude']), r4(b['longitude']), station_n.get(i), HOURLY_CONF.get(b['tier']),
                     None if geo or b['tier'] is None else b['buses_at_substation'],
                     None if geo or b['tier'] is None else b['buses_sharing_series'], b['total_outlets'],
                     deg[i] if deg.get(i) or b['in_powerflow_model'] else None, r1(gen.get(i)), r2(load.get(i)),
                     ((fl.get('first_limit_facility') or '').strip() or None) if real_limit else None,
                     ((fl.get('first_limit_contingency') or '').strip() or None) if real_limit else None,
                     None, b['tier'], (r2(b['distance_mi']) if b['tier'] == busdata.RELINKED else r2(km_to_mi(b['distance_km']))) if geo else None,
                     b['pnode_name'], r2(pnode_mi[i])])
    identity = {'cols': cols, 'rows': rows}
    fields['identity'] = {'nullReason': {
        'kv': 'dim_bus.nominal_kv not held', 'shared_n': 'geo-proxy bus: no own or station series, so nothing is shared',
        'series_n': 'geo-proxy bus: it reads another node series (counted on that series, not here)',
        'hourly_conf': 'geo-proxy or re-linked (D-008) bus: no settled hourly series at its own or its station node',
        'outlets': 'dim_substation.total_outlets not held',
        'branch_deg': 'bus not in the powerflow model and no dim_branch end at it',
        'gen_mw': 'no generator modelled at this bus (dim_generator)', 'load_mw': 'no load modelled at this bus (dim_load)',
        'top_constraint': 'no limiting element at summer-peak discharge (only a "No Violations found" sentinel, or no run)',
        'top_shadow': 'not held: the vendor Top_Constraint fields are excluded in the unified DB (data_quality.top_constraint_name: '
                      '12 names with zero overlap against real constraints) and no per-bus shadow price is held',
        'proxy_mi': 'not applicable: the bus reads its own or its station node', 'station': 'no substation name',
        'pnode_mi': 'price node has no coordinates in dim_pnode'}}

    # loading counts
    by = defaultdict(list)
    for r in _rows(c, '''SELECT bus_id, scenario, direction, monitored_facility, base_flow_mw, contingency_flow_mw, rating_a_mva, rating_c_mva, transfer_mw
                         FROM fact_limiting_element'''):
        by[(int(r['bus_id']), r['scenario'], r['direction'])].append(r)
    loading, not_pub = {}, Counter()
    for (bid, sc, di), grp in sorted(by.items()):
        if bid not in on_spine:
            continue
        if (sc, di) not in LOADING_SPELLINGS:
            not_pub[f'{sc}|{di}'] += 1
            continue
        entry = loading_counts(grp)
        if entry is None:
            notes = sorted({(g['monitored_facility'] or '').strip() for g in grp})
            entry = ({'n_rows': 0, 'violations_before': 0, 'pre_existing_n': 0, 'note': NO_VIOLATIONS} if notes == [NO_VIOLATIONS]
                     else {'n_rows': 0, 'violations_before': None, 'pre_existing_n': None, 'note': '; '.join(notes)})
        sp = LOADING_SPELLINGS[(sc, di)]
        loading[f'{bid}|{sc}|{sp[0]}'] = entry
        for s in sp[1:]:
            loading[f'{bid}|{sc}|{s}'] = f'{bid}|{sc}|{sp[0]}'
    coverage.update(loading_buses=len({k.split('|')[0] for k in loading}), loading_keys=len(loading),
                    loading_not_published={k: {'buses': v, 'why': LOADING_NOT_PUBLISHED.get(tuple(k.split('|')), 'not a published case')} for k, v in not_pub.items()},
                    loading_aliases={'summer_peak|discharge': 'summer_peak|injection (one store case, two spellings)'})
    fields['loading'] = {'nullReason': 'no loading run for the bus/case (key absent); violations/pre-existing null where the study states '
                                       '"Existing overloads are affected but no new violations found" without listing the elements'}

    # sheet pre-existing issues
    pre = {str(i): {k: None for k in PRE_ISSUE_KEY.values()} for i in ids}
    for r in _rows(c, 'SELECT bus_id, scenario, direction, pre_existing_issues FROM fact_headroom'):
        k = PRE_ISSUE_KEY.get((r['scenario'], r['direction']))
        if k and str(r['bus_id']) in pre:
            v = r['pre_existing_issues']
            pre[str(r['bus_id'])][k] = None if v is None else int(round(v))
    fields['pre_issues'] = {'nullReason': 'fact_headroom.pre_existing_issues is null: the study sheet publishes no count for this bus'}

    # short circuit (corrected column)
    sc = {str(b['bus_id']): r1(b['short_circuit_mva']) for b in spine}
    fields['short_circuit'] = {'nullReason': 'dim_bus.short_circuit_mva null: the sheet publishes no fault current for this substation'}

    # queue
    qcols = TABLE_COLUMNS['dim_queue']
    points = _rows(c, 'SELECT queue_position, request_date, poi_name, max_mw, summer_mw_modelled, summer_pct_modelled, light_mw_modelled, '
                      'light_pct_modelled, county, state, projected_is_date, interconnection_service_requested, resource_type, status, '
                      'longitude, latitude, iso FROM dim_queue ORDER BY request_date, queue_position')
    assert all(list(p) == qcols for p in points[:1])
    tops = _rows(c, '''SELECT monitored_facility AS facility, binding_contingency AS contingency, any_value(zone) AS fzone, max(kv) AS kv,
                              count(*) AS n, max(pct_loading_no_transfer) AS loading, max(fix_cost_musd) AS cost_musd,
                              max(length_miles) AS miles, count(DISTINCT bus_id) AS sources
                       FROM fact_limiting_element
                       WHERE scenario = ? AND rating_a_mva IS NOT NULL
                       GROUP BY monitored_facility, binding_contingency
                       ORDER BY n DESC, facility, contingency LIMIT ?''', ['summer_peak', TOP_FACILITIES_N])
    for t in tops:
        t['n'], t['sources'] = int(t['n']), int(t['sources'])
        t['loading'], t['cost_musd'], t['miles'] = r2(t['loading']), r2(t['cost_musd']), r2(t['miles'])
    queue = {'points': points, 'top_facilities': tops}
    coverage['top_facilities_rule'] = ('fact_limiting_element at summer_peak (discharge + charge), grouped by facility + contingency; n = rows, '
                                       'sources = distinct buses, loading = max pct_loading_no_transfer; sentinel rows ("No Violations found") excluded')
    fields['queue'] = {'nullReason': 'dim_queue field not stated in the register for this request'}

    # load_pays: settled RT year at the bus's price node
    hourly = {r['pnode_name']: r for r in _rows(c, '''SELECT pnode_name, avg(lmp) AS mean, count(lmp) AS n, sum(CASE WHEN lmp < ? THEN 1 ELSE 0 END) AS cheap
                                                      FROM fact_lmp_hourly WHERE market = ? AND ts >= ? AND ts < ? GROUP BY pnode_name''',
                                                  [CHEAP_USD_MWH, 'RT', dt.datetime(LOAD_PAYS_YEAR, 1, 1), dt.datetime(LOAD_PAYS_YEAR + 1, 1, 1)])}
    node = {int(b['bus_id']): b['pnode_name'] for b in spine}
    load_pays, worst, partial = {}, 0.0, {}
    for r in _rows(c, '''WITH l AS (SELECT unnest(?::BIGINT[]) AS bus_id, unnest(?::VARCHAR[]) AS pnode_name)
                         SELECT l.bus_id, p.avg_lmp, p.n_hours FROM l JOIN pn_year p USING (pnode_name) WHERE p.market = ? AND p.y = ?''',
                   busdata.link_params(c) + ['RT', LOAD_PAYS_YEAR]):
        i = int(r['bus_id'])
        h = hourly.get(node.get(i))
        if i not in on_spine or h is None or not r['n_hours']:
            continue
        if is_partial(r['n_hours'], LOAD_PAYS_YEAR):  # a part-year mean is not a year's flat-load cost; never mix in another year
            partial[str(i)] = int(r['n_hours'])
            continue
        worst = max(worst, abs(h['mean'] - r['avg_lmp']))
        cheap = int(h['cheap'])
        load_pays[str(i)] = {'year': LOAD_PAYS_YEAR, 'mean_rt': r2(r['avg_lmp']), 'cheap_hours_lt20': cheap,
                             'cheap_share': r1(100 * cheap / h['n']), 'hours': int(r['n_hours'])}
    validation['load_pays_hourly_mean_vs_mart_max_abs'] = round(worst, 6)
    coverage['load_pays_partial'] = {'rule': f'hours < {PARTIAL_SHARE} x calendar hours of {LOAD_PAYS_YEAR} ({calendar_hours(LOAD_PAYS_YEAR)}): '
                                             'not published (a part-year mean is not a flat-load cost; no fallback to another year)',
                                     'n': len(partial), 'hours_by_bus': partial}
    fields['load_pays'] = {'nullReason': f'bus absent: no settled RT {LOAD_PAYS_YEAR} series at its resolved price node (pn_year), or a partial '
                                         f'year (coverage.load_pays_partial)'}

    # forecast_delta: two runs of one study year
    ra, rb = FORECAST_DELTA_RUNS
    years = {r['scenario']: r['target_year'] for r in _rows(c, 'SELECT scenario, target_year FROM dim_scenario WHERE kind = ?', ['forecast'])}
    assert years[ra] == years[rb], 'forecast_delta runs must solve one study year'
    fc = defaultdict(dict)
    for r in _rows(c, 'SELECT scenario, bus_id, avg_lmp, min_lmp, max_lmp, avg_cong, avg_loss FROM mart_bus_fcst_year WHERE scenario IN (?, ?, ?)', [ra, rb, '5yr']):
        unpriced = r['min_lmp'] == 0 and r['max_lmp'] == 0  # a run node at $0 every hour is unpriced, not a $0 market
        fc[int(r['bus_id'])][r['scenario']] = None if unpriced else r
    fdelta = {}
    for i in ids:
        a, b = fc.get(i, {}).get(ra), fc.get(i, {}).get(rb)
        if not a or not b or not b['avg_lmp']:
            continue
        d = a['avg_lmp'] - b['avg_lmp']
        fdelta[str(i)] = {'year': years[ra], 'run_a': ra, 'run_b': rb, 'a': r2(a['avg_lmp']), 'b': r2(b['avg_lmp']), 'delta': r2(d),
                          'delta_pct': r1(100 * d / b['avg_lmp'])}
    fields['forecast_delta'] = {'nullReason': f'bus absent: {ra} or {rb} not priced at this bus (no run row, or $0 in every hour)'}

    # land cost proxy: not in the unified DB
    land = {'rows': None, 'why': 'no land-cost table in the unified DB; the live figure is an assumption band from GridSense_one '
                                 'derived.mart_land_cost_proxy (provenance "assumption", source NULL)'}
    fields['land_cost_proxy'] = {'nullReason': land['why']}

    # cathy (display-only part): price tier, node and proxy distance
    cathy = {str(b['bus_id']): {'tier': b['tier'], 'pnode': b['pnode_name'],
                                'distance_mi': r2(b['distance_mi']) if b['tier'] == busdata.RELINKED
                                else r2(km_to_mi(b['distance_km'])) if b['tier'] == 'geo_proxy' else None} for b in spine}
    fields['cathy'] = {'nullReason': 'distance_mi: not applicable, the bus reads its own or its station node (tier direct / same_substation)'}

    # run input flags: 5yr congestion on the ISO-NE sign; the Cape regression is not rebuildable from the unified DB
    mcc = {}
    for i in ids:
        r = fc.get(i, {}).get('5yr')
        if r:
            mcc[str(i)] = r2(api_common.to_isone_sign(r, 'mart_bus_fcst_year')['avg_cong'])
    flags = {'mcc_5yr': mcc, 'cape_5yr': None}
    fields['run_input_flags'] = {'nullReason': 'cape_5yr: the flag is a regression of the bus 5yr MCC on the run binding shadow prices; the unified DB '
                                               'holds no 5yr binding rows (fact_pcr_binding_hourly has pcr2030/2035/2040 only) and not the 5yr OSW '
                                               'input list, so it is not rebuilt. mcc_5yr absent: 5yr run not priced at the bus'}

    groups = {'identity': identity, 'branches': branches, 'zones': zones, 'stations': stations, 'loading': loading, 'pre_issues': pre,
              'short_circuit': sc, 'queue': queue, 'load_pays': load_pays, 'forecast_delta': fdelta, 'land_cost_proxy': land,
              'cathy': cathy, 'run_input_flags': flags}
    for g in FIELD_GROUPS:
        f = fields.setdefault(g, {})
        f.update(rows=count_rows(g, groups[g]), nulls=_nulls(groups[g]), spec=FIELD_SPEC[g])
        if not f['nulls']:
            f.pop('nullReason', None)
    return groups, fields, coverage, validation


def build(db, out=DEFAULT_OUT):
    db = Path(db).resolve()
    if not db.is_file():
        raise SystemExit(f'ERROR: database not found: {db}')
    t0 = time.time()
    conn = duckdb.connect(str(db), read_only=True)
    try:
        st = db.stat()
        groups, fields, coverage, validation = collect(conn)
        meta = {'db_path': str(db), 'db_mtime_ns': st.st_mtime_ns,
                'db_mtime': dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).isoformat(), 'db_bytes': st.st_size,
                'schema_hash': schema_hash(conn), 'schema_tables': {t: sorted(c) for t, c in TABLE_COLUMNS.items()},
                'builder_version': BUILDER_VERSION, 'fields': fields, 'coverage': coverage, 'validation': validation,
                'sign': 'ISO-NE, LMP = E + C + L. Run congestion (mart_bus_fcst_year) converted once by api_common.to_isone_sign; '
                        'settled tables are stored on the ISO-NE sign.',
                'class': 'display-only (04a). Engine-class fields are served by the preview engine, never here.'}
        if db.stat().st_mtime_ns != st.st_mtime_ns:
            raise SystemExit('ERROR: the database changed during the build; nothing published')
    finally:
        conn.close()
    gen = publish(groups, meta, out)
    return gen, time.time() - t0


def main(argv=None):
    ap = argparse.ArgumentParser(description='Build the One Studio map/grid generation from the unified DuckDB (read-only).')
    ap.add_argument('--db', default=os.environ.get('GRIDSENSE_UNIFIED_DB'), help='unified DuckDB path (or env GRIDSENSE_UNIFIED_DB)')
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    a = ap.parse_args(argv)
    if not a.db:
        ap.error('--db is required (or set GRIDSENSE_UNIFIED_DB)')
    gen, secs = build(a.db, a.out)
    out = Path(a.out)
    d = out / json.loads((out / 'current.json').read_text())['dir']
    meta = json.loads((d / 'meta.json').read_text(encoding='utf-8'))
    print(f'generation {gen} in {secs:.1f} s -> {d}')
    for g in FIELD_GROUPS:
        f = meta['fields'][g]
        print(f'  {g:16s} rows {f["rows"]:>6}  nulls {f["nulls"]:>6}  {(d / (g + ".json")).stat().st_size:>10,} B')
    print('  validation', meta['validation'])


if __name__ == '__main__':
    main()
