"""Map/grid display-only data (04a), served from the published generation built by plan/build_mapgrid.py.

Provenance: Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · 2026-10-06 · sign-off pending · v1

GET /api/x/mapgrid/<route>/<key>
  meta/all           the generation's meta.json (generation id, DB stamp, schema hash, per-field counts + nullReason, coverage)
  <group>/all        one field group (identity, branches, zones, stations, loading, pre_issues, short_circuit, queue,
                     load_pays, forecast_delta, land_cost_proxy, cathy, run_input_flags)
  bus/<bus id>       that bus's display-only record across the groups
Every response carries `generation` so the UI can pin its lazy loads to one generation.

Stale (04 §Storage): meta.db_mtime_ns != the served DB's mtime, or meta.schema_hash != the hash of the columns the
builder reads, or nothing published. Since ROUTES return dict|None, a stale answer is
{"error": "mapgrid stale", "status": 503, "reason": ...}; server.py turns `status` into the HTTP code (lead-owned change).
Files are read, never written; the DB is only asked for its information_schema (read-only connection, parameterised).
"""
import json
import re
import sys
import threading
from pathlib import Path

import busdata

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'plan'))
import build_mapgrid as _bm  # noqa: E402

DATA_DIR = ROOT / 'data' / 'mapgrid'
FIELD_GROUPS = list(_bm.FIELD_GROUPS)
_LOCK = threading.Lock()
_FILES = {}    # (generation dir, name) -> parsed JSON
_SCHEMA = {}   # (db path, mtime_ns) -> schema hash
_BUS = {}      # generation dir -> {bus id: record}


def db_path():
    """The DB the server reads (server.py sets busdata.SOURCE from --db)."""
    return Path(busdata.SOURCE)


def reset_cache():
    with _LOCK:
        _FILES.clear(); _SCHEMA.clear(); _BUS.clear()


def _pointer():
    try:
        p = json.loads((Path(DATA_DIR) / 'current.json').read_text(encoding='utf-8'))
        return p if (Path(DATA_DIR) / p['dir']).is_dir() else None
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _load(gdir, name):
    k = (str(gdir), name)
    with _LOCK:
        if k in _FILES:
            return _FILES[k]
    f = Path(gdir) / f'{name}.json'
    v = json.loads(f.read_text(encoding='utf-8')) if f.exists() else None
    with _LOCK:
        _FILES[k] = v
    return v


def _stale(reason, gen=None, expected=None, found=None):
    return {'error': 'mapgrid stale', 'status': 503, 'reason': reason, 'generation': gen, 'expected': expected, 'found': found,
            'fix': 'python plan/build_mapgrid.py --db "<the served unified DuckDB>"'}


def _schema_hash(conn, path, mtime_ns):
    k = (str(path), mtime_ns)
    with _LOCK:
        if k in _SCHEMA:
            return _SCHEMA[k]
    # A cursor of its own: the server shares ONE connection across threads, and mapgrid routes run outside
    # busdata's lock (they are never cached). On the shared connection a parallel request's query interleaved
    # with this one and produced a wrong hash, so every map load answered 503 "stale" (2026-10-06).
    cur = conn.cursor()
    try:
        h = _bm.schema_hash(cur)
    finally:
        cur.close()
    with _LOCK:
        _SCHEMA[k] = h
    return h


def fresh(conn):
    """(generation, dir, meta) when the published generation matches the served DB, else a stale dict."""
    ptr = _pointer()
    if not ptr:
        return _stale('not built')
    gdir = Path(DATA_DIR) / ptr['dir']
    meta = _load(gdir, 'meta')
    if not meta:
        return _stale('not built', ptr.get('generation'))
    try:
        mt = db_path().stat().st_mtime_ns
    except OSError:
        return _stale('db missing', meta['generation'], meta.get('db_path'), str(db_path()))
    if mt != meta.get('db_mtime_ns'):
        return _stale('db_mtime', meta['generation'], meta.get('db_mtime_ns'), mt)
    sh = _schema_hash(conn, db_path(), mt)
    if sh != meta.get('schema_hash'):
        return _stale('schema_hash', meta['generation'], meta.get('schema_hash'), sh)
    return meta['generation'], gdir, meta


def _meta_route(conn, key):
    if key != 'all':
        return None
    f = fresh(conn)
    if isinstance(f, dict):
        return f
    return dict(f[2])


def _group_route(name):
    def route(conn, key):
        if key != 'all':
            return None
        f = fresh(conn)
        if isinstance(f, dict):
            return f
        gen, gdir, meta = f
        return {'generation': gen, 'built_at': meta.get('built_at'), 'field': name, 'data': _load(gdir, name),
                'nullReason': (meta.get('fields') or {}).get(name, {}).get('nullReason')}
    route.__name__ = f'mapgrid_{name}'
    return route


def _bus_index(gdir):
    with _LOCK:
        if str(gdir) in _BUS:
            return _BUS[str(gdir)]
    ident = _load(gdir, 'identity') or {'cols': [], 'rows': []}
    cols = ident['cols']
    idx = {str(r[0]): dict(zip(cols, r)) for r in ident['rows']}
    loading = _load(gdir, 'loading') or {}
    for k, v in loading.items():
        bus, case, spelling = k.split('|')
        rec = idx.get(bus)
        if rec is None:
            continue
        entry = loading.get(v) if isinstance(v, str) else v  # an alias names the key holding the same measurement
        rec.setdefault('loading', {})[f'{case}|{spelling}'] = entry
    for name, field in (('pre_issues', 'pre_issues'), ('short_circuit', 'short_circuit_mva'), ('load_pays', 'load_pays'),
                        ('forecast_delta', 'forecast_delta'), ('cathy', 'price_mapping')):
        g = _load(gdir, name) or {}
        for bus, rec in idx.items():
            rec[field] = g.get(bus)
    zones = _load(gdir, 'zones') or {}
    flags = _load(gdir, 'run_input_flags') or {}
    for bus, rec in idx.items():
        rec['zone_fixed'] = bus in (zones.get('zone_fix') or {})
        rec['mcc_5yr'] = (flags.get('mcc_5yr') or {}).get(bus)
        rec.setdefault('loading', {})
    with _LOCK:
        _BUS[str(gdir)] = idx
    return idx


def bus(conn, key):
    if not re.fullmatch(r'\d{1,9}', str(key)):
        return None
    f = fresh(conn)
    if isinstance(f, dict):
        return f
    gen, gdir, meta = f
    rec = _bus_index(gdir).get(str(int(key)))
    if rec is None:
        return None
    return {'generation': gen, 'built_at': meta.get('built_at'), 'field': 'bus', 'data': rec}


ROUTES = {'meta': _meta_route, 'bus': bus, **{g: _group_route(g) for g in FIELD_GROUPS}}
