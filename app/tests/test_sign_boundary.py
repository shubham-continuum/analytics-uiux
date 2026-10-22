"""One sign boundary: every PROBE-run congestion flip goes through api_common.to_isone_sign.

Provenance: Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · S2-D · 2026-10-06 · sign-off pending · v1

Run: python -m pytest tests/test_sign_boundary.py -q   (from app/)
"""
import re
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
import api_common  # noqa: E402
import busdata  # noqa: E402
import api_prices as A  # noqa: E402

DAY = __import__('datetime').date(2030, 1, 1)


# ── fixtures: + / − / 0 congestion, stored on the run sign (LMP = E − C + L) ──────────────────────────────
@pytest.mark.parametrize('stored_c', [7.5, -4.25, 0.0])
def test_fcst_record_flips_once_and_closes(stored_c):
    lmp, loss = 40.0, 1.5
    rec = busdata.fcst_record(DAY, 13, lmp, stored_c, loss)
    ts, price, gen, energy, cong, l2 = rec
    assert ts == '2030-01-01T13:00:00' and price == lmp and gen is None and l2 == loss
    assert cong == -stored_c and str(cong) != '-0.0'
    assert energy + cong + loss == pytest.approx(lmp, abs=1e-12)
    assert energy == pytest.approx(lmp + stored_c - loss, abs=1e-12)  # the run's own identity E = LMP + C_stored − L


def test_fcst_record_nulls_stay_null():
    rec = busdata.fcst_record(DAY, 0, 40.0, None, 1.0)
    assert rec[4] is None and rec[3] is None
    rec = busdata.fcst_record(DAY, 0, None, 2.0, 1.0)
    assert rec[4] == -2.0 and rec[3] is None


@pytest.mark.parametrize('stored_c', [3.0, -3.0, 0.0])
def test_api_prices_fcst_fix_uses_the_boundary(stored_c):
    r = A._fcst_fix({'scenario': '5yr', 'avg_lmp': 50.0, 'avg_cong': stored_c, 'avg_loss': 0.5})
    assert r['avg_cong'] == -stored_c and r['avg_cong_stored'] == stored_c
    assert r['avg_energy'] + r['avg_cong'] + r['avg_loss'] == pytest.approx(50.0, abs=1e-12)
    assert not any(k.startswith('_sign') for k in r)  # bookkeeping never published
    h = A._fcst_fix({'scenario': '5yr', 'h': 3, 'avg_lmp': 50.0, 'avg_cong': stored_c})  # hour mart: no loss column
    assert h['avg_cong'] == -stored_c and h.get('avg_energy') is None


@pytest.mark.parametrize('stored', [12.0, -12.0, 0.0, None])
def test_solved_congestion_sum_uses_the_boundary(stored):
    got = A._run_cong(stored)
    assert got == (None if stored is None else -stored)


def test_no_double_flip():
    once = api_common.to_isone_sign({'lmp': 1.0, 'congestion': 2.0, 'loss': 0.0}, 'fact_fcst_lmp_hourly')
    with pytest.raises(ValueError):
        api_common.to_isone_sign(once, 'fact_fcst_lmp_hourly')


def test_no_second_sign_boundary_in_the_data_layer():
    """No file but api_common negates a congestion figure (S2-D: the four old flips are gone)."""
    pat = re.compile(r'-\s*congestion\b|_neg\(|norm_c\s*=\s*-|-\s*r\[\s*[\'"]avg_cong')
    for f in ('busdata.py', 'extract_snapshot.py', 'api_prices.py', 'api_pricesintra.py', 'api_market.py', 'plan/build_mapgrid.py'):
        text = (APP / f).read_text(encoding='utf-8')
        code = '\n'.join(l for l in text.splitlines() if not l.lstrip().startswith('#'))
        code = re.sub(r'(\'\'\'|""")[\s\S]*?\1', lambda m: m.group(0) if 'SELECT' in m.group(0) else '', code)  # docstrings out, SQL kept
        assert not pat.search(code), f'{f}: a sign flip outside api_common.to_isone_sign'


# ── real rows: E + C + L == LMP on a real bus-hour of each table ──────────────────────────────────────────
@pytest.fixture(scope='module')
def c():
    conn = busdata.connect()
    conn.execute('SET enable_progress_bar=false')
    yield conn
    conn.close()


def test_settled_hourly_closes_and_passes_through(c):
    lmp, e, cg, l = c.execute('''SELECT lmp, energy, congestion, loss FROM fact_lmp_hourly
                                 WHERE pnode_name = ? AND market = ? AND abs(congestion) > 1 ORDER BY ts LIMIT 1''', ['LD.HATCHVLE115', 'RT']).fetchone() \
        or c.execute('SELECT lmp, energy, congestion, loss FROM fact_lmp_hourly WHERE abs(congestion) > 1 LIMIT 1').fetchone()
    row = api_common.to_isone_sign({'lmp': lmp, 'energy': e, 'congestion': cg, 'loss': l}, 'fact_lmp_hourly')
    assert row['congestion'] == cg and row['energy'] == e
    assert e + cg + l == pytest.approx(lmp, abs=0.006)


def test_settled_mart_closes(c):
    r = c.execute('SELECT avg_lmp, avg_energy, avg_cong, avg_loss FROM mart_bus_year WHERE bus_id = ? AND market = ? AND y = ?', [111209, 'RT', 2025]).fetchone()
    assert r[1] + r[2] + r[3] == pytest.approx(r[0], abs=1e-6)


def test_run_hourly_energy_is_one_system_price_after_conversion(c):
    """Two buses in one run hour with different non-zero congestion: after the one flip, E is the same system price."""
    rows = c.execute('''SELECT bus_id, study_date, hour, lmp, congestion, loss FROM fact_fcst_lmp_hourly
                        WHERE scenario = ? AND study_date = ? AND hour = ? AND lmp <> 0 AND abs(congestion) > 0.5
                        ORDER BY congestion LIMIT 3''', ['pcr2030', DAY, 12]).fetchall()
    assert len(rows) >= 2 and rows[0][4] != rows[-1][4]
    recs = [busdata.fcst_record(d, h, lmp, cg, l) for _b, d, h, lmp, cg, l in rows]
    for (_b, _d, _h, lmp, _cg, l), r in zip(rows, recs):
        assert r[3] + r[4] + r[5] == pytest.approx(lmp, abs=1e-9)
    assert max(r[3] for r in recs) - min(r[3] for r in recs) < 1e-3


def test_run_mart_year_energy_is_one_system_price_after_conversion(c):
    rows = c.execute('''SELECT * FROM mart_bus_fcst_year WHERE scenario = ? AND min_lmp <> 0 AND abs(avg_cong) > 1
                        AND n_hours = (SELECT max(n_hours) FROM mart_bus_fcst_year WHERE scenario = ?) ORDER BY avg_cong LIMIT 2''',
                     ['pcr2030', 'pcr2030']).fetchall()
    names = [d[0] for d in c.description]
    fixed = [A._fcst_fix(dict(zip(names, r))) for r in rows]
    for f in fixed:
        assert f['avg_energy'] + f['avg_cong'] + f['avg_loss'] == pytest.approx(f['avg_lmp'], abs=1e-9)
    assert abs(fixed[0]['avg_energy'] - fixed[1]['avg_energy']) < 0.05


def test_run_mart_hour_is_registered_on_the_run_sign():
    assert api_common.STORED_SIGN['mart_bus_fcst_hour'] == 'probe'
