"""M2 map/grid data layer: sign boundary, builder rules, atomic publish, freshness, published schema, parity gate.

Provenance: Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
Run: python -m pytest -q tests/test_mapgrid.py   (from one-studio/app)

The freshness and publish tests use a temp dir and a fake DB file; they never touch the unified DuckDB.
The schema / engine-name / parity tests read the published generation under data/mapgrid and skip if none is built.
"""
import json
import math
import os
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
sys.path.insert(0, str(APP / 'plan'))
import api_common  # noqa: E402
import api_mapgrid  # noqa: E402
import build_mapgrid as bm  # noqa: E402

PUBLISHED = APP / 'data' / 'mapgrid'


# ── 1 · the one sign boundary ─────────────────────────────────────────────────────────────────────────────

def _eclose(row):
    return abs(row['lmp'] - (row['energy'] + row['congestion'] + row['loss'])) < 1e-9


@pytest.mark.parametrize('stored_c', [15.91, -11.72, 0.0])
def test_run_congestion_is_flipped_once_and_identity_holds(stored_c):
    # A PROBE run stores LMP = E - C + L: with E = 42.16, L = -0.15 the stored row is LMP = E - C_stored + L.
    e, loss = 42.16, -0.15
    stored = {'lmp': e - stored_c + loss, 'energy': 999.0, 'congestion': stored_c, 'loss': loss}
    out = api_common.to_isone_sign(stored, 'fact_fcst_lmp_hourly')
    assert out['congestion'] == -stored_c
    assert math.copysign(1, out['congestion']) == 1 or stored_c > 0  # zero comes out +0.0, never -0.0
    assert abs(out['energy'] - e) < 1e-9  # recomputed after the flip; the stored energy column is never read
    assert _eclose(out)
    assert stored['congestion'] == stored_c  # input not mutated


def test_positive_congestion_raises_the_node_price_after_conversion():
    # Hatchville 111209, 5yr: stored -15.91 is a premium on the ISO-NE sign.
    out = api_common.to_isone_sign({'avg_lmp': 57.92, 'avg_cong': -15.91, 'avg_loss': -0.16}, 'mart_bus_fcst_year')
    assert out['avg_cong'] == 15.91
    assert out['avg_lmp'] > out['avg_energy']
    assert abs(out['avg_lmp'] - (out['avg_energy'] + out['avg_cong'] + out['avg_loss'])) < 1e-9


def test_settled_rows_pass_through_unchanged():
    row = {'lmp': 66.745, 'energy': 65.613, 'congestion': 0.105, 'loss': 1.027}
    out = api_common.to_isone_sign(row, 'fact_lmp_hourly')
    assert {k: out[k] for k in row} == row


def test_no_double_conversion():
    once = api_common.to_isone_sign({'lmp': 10.0, 'congestion': 2.0, 'loss': 0.0}, 'fact_fcst_lmp_hourly')
    with pytest.raises(ValueError):
        api_common.to_isone_sign(once, 'fact_fcst_lmp_hourly')


def test_unknown_source_is_refused_not_guessed():
    with pytest.raises(ValueError):
        api_common.to_isone_sign({'lmp': 1.0, 'congestion': 1.0, 'loss': 0.0}, 'some_new_table')


def test_null_component_stays_null():
    out = api_common.to_isone_sign({'lmp': 10.0, 'congestion': None, 'loss': 0.1}, 'fact_fcst_lmp_hourly')
    assert out['congestion'] is None and out['energy'] is None


# ── 2 · builder rules (pure, fixtures only) ──────────────────────────────────────────────────────────────

def _le(cflow=None, base=50.0, ra=100.0, rc=120.0, transfer=10.0, sentinel=False):
    if sentinel:
        return {'base_flow_mw': None, 'contingency_flow_mw': None, 'rating_a_mva': None, 'rating_c_mva': None, 'transfer_mw': None}
    return {'base_flow_mw': base, 'contingency_flow_mw': cflow, 'rating_a_mva': ra, 'rating_c_mva': rc, 'transfer_mw': transfer}


def test_loading_counts_follow_panel_f():
    rows = [
        _le(base=150.0, ra=100.0),                      # N-0 on Rate A: 150 % -> violation
        _le(cflow=-130.0, rc=120.0, transfer=-5.0),     # N-1 on Rate C: |-130|/120 = 108 % -> violation; pre-existing
        _le(cflow=110.0, rc=120.0, ra=100.0),           # N-1: 91.7 % of Rate C (110 % of Rate A must NOT count)
        _le(sentinel=True),                             # "No Violations found": not an element
    ]
    assert bm.loading_counts(rows) == {'n_rows': 3, 'violations_before': 2, 'pre_existing_n': 1}


def test_loading_counts_all_sentinel_is_none():
    assert bm.loading_counts([_le(sentinel=True)]) is None


def test_zone_code_from_operator_zone():
    assert bm.zone_code('.Z.WCMASS') == 'WCMA'
    assert bm.zone_code('.Z.NEMASSBOST') == 'NEMA'
    assert bm.zone_code(None) is None
    assert bm.zone_code('.Z.UNKNOWN') is None


def test_zone_correction_only_from_a_colocated_own_or_station_node():
    # links: [(link_rank, operator zone, miles from the bus)]
    # rank-1 node co-located, operator zone differs from the sheet -> corrected
    assert bm.corrected_zone('NEMA', 'pnode', 'same_substation', [(1, '.Z.CONNECTICUT', 0.0)], 22.0) == ('CT', False)
    # rank-1 is a same-name node in another town -> flagged; the best-ranked CO-LOCATED link gives the zone
    assert bm.corrected_zone('VT', 'pnode', 'same_substation', [(1, '.Z.NEMASSBOST', 130.4), (2, '.Z.VERMONT', 0.1)], 22.0) == ('VT', True)
    assert bm.corrected_zone('RI', 'pnode', 'same_substation', [(1, '.Z.CONNECTICUT', 241.6), (2, '.Z.SEMASS', 0.0)], 22.0) == ('SEMA', True)
    # no co-located link at all -> sheet zone kept, flagged
    assert bm.corrected_zone('NEMA', 'pnode', 'same_substation', [(1, '.Z.CONNECTICUT', 84.5)], 22.0) == ('NEMA', True)
    # zone from county/state, or a geo-proxy node -> sheet zone kept, not suspect
    assert bm.corrected_zone('SEMA', 'county', 'geo_proxy', [(1, '.Z.RHODEISLAND', 3.0)], 22.0) == ('SEMA', False)
    # node with no coordinates -> cannot be shown far: used, not suspect
    assert bm.corrected_zone('VT', 'pnode', 'direct', [(1, '.Z.NEWHAMPSHIRE', None)], 22.0) == ('NH', False)


def test_partial_year_rule_uses_the_calendar():
    assert bm.calendar_hours(2025) == 365 * 24 and bm.calendar_hours(2024) == 366 * 24
    assert bm.is_partial(3887, 2025) and bm.is_partial(1465, 2025)
    assert not bm.is_partial(8760, 2025) and not bm.is_partial(8759, 2025)


def test_km_to_miles_is_exact_unit_conversion():
    assert abs(bm.km_to_mi(1.609344) - 1.0) < 1e-12
    assert bm.km_to_mi(None) is None


# ── 3 · atomic publish ───────────────────────────────────────────────────────────────────────────────────

def _groups(v=1):
    return {'identity': {'cols': ['bus_id', 'name'], 'rows': [[1, 'A'], [2, None]]}, 'short_circuit': {'1': 100.0 * v, '2': None}}


def _meta():
    return {'db_path': 'fake', 'db_mtime_ns': 1, 'schema_hash': 'abc', 'builder_version': bm.BUILDER_VERSION, 'fields': {}}


def test_publish_writes_one_generation_and_pointer(tmp_path):
    gen = bm.publish(_groups(), _meta(), tmp_path)
    cur = json.loads((tmp_path / 'current.json').read_text())
    assert cur['generation'] == gen
    d = tmp_path / cur['dir']
    assert json.loads((d / 'meta.json').read_text())['generation'] == gen
    assert json.loads((d / 'short_circuit.json').read_text())['1'] == 100.0
    assert not [p for p in tmp_path.iterdir() if p.name.startswith('.tmp')]


def test_generation_is_a_content_hash(tmp_path):
    a = bm.publish(_groups(1), _meta(), tmp_path / 'a')
    b = bm.publish(_groups(1), _meta(), tmp_path / 'b')
    c = bm.publish(_groups(2), _meta(), tmp_path / 'c')
    assert a == b and a != c


def test_interrupted_build_leaves_previous_generation_served(tmp_path, monkeypatch):
    old = bm.publish(_groups(1), _meta(), tmp_path)
    before = (tmp_path / 'current.json').read_bytes()
    real = bm._write_json
    calls = {'n': 0}

    def crash(path, value):
        calls['n'] += 1
        if calls['n'] == 2:
            raise OSError('disk full (simulated)')
        real(path, value)

    monkeypatch.setattr(bm, '_write_json', crash)
    with pytest.raises(OSError):
        bm.publish(_groups(2), _meta(), tmp_path)
    assert (tmp_path / 'current.json').read_bytes() == before
    cur = json.loads(before)
    assert cur['generation'] == old
    assert json.loads((tmp_path / cur['dir'] / 'short_circuit.json').read_text())['1'] == 100.0
    assert [p.name for p in tmp_path.iterdir() if p.name.startswith('g-')] == [cur['dir']]
    assert not [p for p in tmp_path.iterdir() if p.name.startswith('.tmp')]


def test_prune_keeps_current_and_previous(tmp_path):
    for v in (1, 2, 3, 4):
        bm.publish(_groups(v), _meta(), tmp_path)
    assert len([p for p in tmp_path.iterdir() if p.name.startswith('g-')]) == 2


# ── 4 · freshness (fake DB file + fake schema; the real DB is never touched) ─────────────────────────────

class FakeConn:
    """Answers the one information_schema query schema_hash() makes, from a dict {table: [(col, type)]}."""

    def __init__(self, cols):
        self.cols = cols

    def cursor(self):  # api_mapgrid._schema_hash takes its own cursor (shared-connection race fix); the fake is its own cursor
        return self

    def close(self):
        pass

    def execute(self, sql, params=()):
        assert 'information_schema.columns' in sql and '?' in sql
        table = params[0]
        rows = self.cols.get(table, [])
        return type('R', (), {'fetchall': lambda _s: list(rows)})()


def _fake_schema():
    return {t: [(c, 'VARCHAR') for c in cols] for t, cols in bm.TABLE_COLUMNS.items()}


@pytest.fixture
def served(tmp_path, monkeypatch):
    db = tmp_path / 'fake.duckdb'
    db.write_bytes(b'not a database')
    conn = FakeConn(_fake_schema())
    meta = _meta()
    meta.update(db_path=str(db), db_mtime_ns=db.stat().st_mtime_ns, schema_hash=bm.schema_hash(conn))
    groups = _groups()
    out = tmp_path / 'mapgrid'
    gen = bm.publish(groups, meta, out)
    monkeypatch.setattr(api_mapgrid, 'DATA_DIR', out)
    monkeypatch.setattr(api_mapgrid, 'db_path', lambda: db)
    api_mapgrid.reset_cache()
    return {'db': db, 'conn': conn, 'gen': gen, 'out': out, 'meta': meta}


def test_fresh_generation_is_served_with_its_id(served):
    r = api_mapgrid.ROUTES['short_circuit'](served['conn'], 'all')
    assert r['generation'] == served['gen'] and r['data']['1'] == 100.0
    m = api_mapgrid.ROUTES['meta'](served['conn'], 'all')
    assert m['generation'] == served['gen'] and 'status' not in m


def test_db_mtime_change_is_stale_503(served):
    os.utime(served['db'], ns=(served['meta']['db_mtime_ns'] + 10**9, served['meta']['db_mtime_ns'] + 10**9))
    r = api_mapgrid.ROUTES['short_circuit'](served['conn'], 'all')
    assert r['status'] == 503 and r['error'] == 'mapgrid stale' and r['reason'] == 'db_mtime'


def test_schema_change_is_stale_503(served):
    cols = _fake_schema()
    cols['dim_bus'] = cols['dim_bus'][:-1]  # a column the builder reads has gone
    r = api_mapgrid.ROUTES['short_circuit'](FakeConn(cols), 'all')
    assert r['status'] == 503 and r['reason'] == 'schema_hash'


def test_not_built_is_503(tmp_path, monkeypatch):
    monkeypatch.setattr(api_mapgrid, 'DATA_DIR', tmp_path / 'empty')
    api_mapgrid.reset_cache()
    r = api_mapgrid.ROUTES['meta'](FakeConn(_fake_schema()), 'all')
    assert r['status'] == 503 and r['reason'] == 'not built'


def test_generation_pinning_new_publish_changes_id(served):
    first = api_mapgrid.ROUTES['short_circuit'](served['conn'], 'all')['generation']
    bm.publish(_groups(5), served['meta'], served['out'])
    second = api_mapgrid.ROUTES['short_circuit'](served['conn'], 'all')
    assert second['generation'] != first and second['data']['1'] == 500.0


def test_field_routes_take_all_only_and_bus_route_takes_an_id(served):
    assert api_mapgrid.ROUTES['short_circuit'](served['conn'], '123') is None
    b = api_mapgrid.ROUTES['bus'](served['conn'], '1')
    assert b['generation'] == served['gen'] and b['data']['bus_id'] == 1 and b['data']['name'] == 'A'
    assert api_mapgrid.ROUTES['bus'](served['conn'], '999') is None
    assert api_mapgrid.ROUTES['bus'](served['conn'], 'all') is None


def test_every_field_group_has_a_route():
    for g in bm.FIELD_GROUPS:
        assert g in api_mapgrid.ROUTES, g


# ── 5 · the published generation (skips until built) ────────────────────────────────────────────────────

def _published():
    cur = PUBLISHED / 'current.json'
    if not cur.exists():
        pytest.skip('no published mapgrid generation (run plan/build_mapgrid.py)')
    d = PUBLISHED / json.loads(cur.read_text())['dir']
    meta = json.loads((d / 'meta.json').read_text(encoding='utf-8'))
    return d, meta


def _keys(o, out):
    if isinstance(o, dict):
        for k, v in o.items():
            out.add(k)
            _keys(v, out)
    elif isinstance(o, list):
        for v in o:
            _keys(v, out)
    return out


def test_published_meta_is_complete():
    d, meta = _published()
    for k in ('generation', 'db_path', 'db_mtime_ns', 'db_mtime', 'schema_hash', 'builder_version', 'built_at', 'fields', 'coverage'):
        assert meta.get(k) not in (None, ''), k
    assert set(meta['fields']) == set(bm.FIELD_GROUPS)


@pytest.mark.parametrize('group', bm.FIELD_GROUPS)
def test_published_group_matches_schema_and_counts(group):
    d, meta = _published()
    data = json.loads((d / f'{group}.json').read_text(encoding='utf-8'))
    errors = bm.validate_group(group, data)
    assert errors == [], errors[:10]
    f = meta['fields'][group]
    assert f['rows'] == bm.count_rows(group, data)
    for cell in bm.SPEC_CELLS:
        assert str(f['spec'].get(cell) or '').strip(), f'{group}: blank column-spec cell {cell}'
    if f.get('nulls'):
        assert f.get('nullReason'), f'{group}: nulls without a reason'


def test_no_engine_class_field_in_the_mapgrid_output():
    d, meta = _published()
    keys = set()
    for g in bm.FIELD_GROUPS:
        _keys(json.loads((d / f'{g}.json').read_text(encoding='utf-8')), keys)
    ident = json.loads((d / 'identity.json').read_text(encoding='utf-8'))
    keys |= set(ident['cols'])
    hit = sorted(k for k in keys if bm.is_engine_name(k))
    assert hit == [], hit


def test_identity_spine_is_whole_and_unique():
    d, meta = _published()
    ident = json.loads((d / 'identity.json').read_text(encoding='utf-8'))
    ids = [r[ident['cols'].index('bus_id')] for r in ident['rows']]
    assert len(ids) == len(set(ids)) == meta['coverage']['spine_buses']


# ── 6 · the M2 gate: parity classified (skips until the parity run) ──────────────────────────────────────

def test_parity_has_no_unclassed_and_no_uncarded_defect():
    p = PUBLISHED / 'parity.json'
    if not p.exists():
        pytest.skip('parity not run (plan/mapgrid_parity.py)')
    par = json.loads(p.read_text(encoding='utf-8'))
    cards = set(par.get('decision_cards') or [])
    bad = []
    for field, r in par['fields'].items():
        if r['unclassed']:
            bad.append(f'{field}: unclassed {r["unclassed"]}')
        if r['defect'] and not (set(r.get('cards') or []) & cards):
            bad.append(f'{field}: defect {r["defect"]} without a decision card')
    assert bad == []
