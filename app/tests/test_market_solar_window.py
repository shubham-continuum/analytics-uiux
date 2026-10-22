"""Market's solar window is the mart's (FORMULAS D5, hours 9-16): one label, one home.

Provenance: Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · S2-D · 2026-10-07 · sign-off pending · v1
Run: python -m pytest tests/test_market_solar_window.py -q   (from app/)
"""
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
import api_market  # noqa: E402
import busdata  # noqa: E402


def test_solar_hours_equal_the_mart_window():
    assert api_market.SOLAR_HOURS == (9, 16)


def test_market_nodes_carry_relink_fields():
    """D-008 (W-B): a re-linked bus's Market node names the re-link distance and the far node; others carry None."""
    c = busdata.connect()
    try:
        m = busdata.market(c)
        rel = set(m['relinked']['buses'])
        assert rel, 'the store holds re-linked buses (S2-D: 85)'
        by = {n['bus_id']: n for n in m['nodes']}
        for b in list(rel)[:5]:
            n = by[b]
            assert n['tier'] == busdata.RELINKED and n['relinkMi'] is not None and n['relinkedFrom']
        other = next(n for n in m['nodes'] if n['bus_id'] not in rel)
        assert other['relinkMi'] is None and other['relinkedFrom'] is None
    finally:
        c.close()


def test_solwin30_uses_hours_9_to_16():
    c = busdata.connect()
    try:
        b = 111209
        flat, sol = c.execute('''SELECT avg(lmp), avg(CASE WHEN hour BETWEEN 9 AND 16 THEN lmp END) FROM fact_fcst_lmp_hourly
                                 WHERE scenario = ? AND bus_id = ?''', ['pcr2030', b]).fetchone()
        got = api_market.measures(c, 'all')['buses'][str(b)]['solwin30']
        assert abs(got - round(sol / flat, 4)) < 1e-9
    finally:
        c.close()
