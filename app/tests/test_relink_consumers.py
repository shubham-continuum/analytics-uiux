"""D-008 in the remaining price readers: api_grid, api_decision, api_economics, api_economicsesr, api_land.

Provenance: Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · S2-D · 2026-10-07 · sign-off pending · v1

Run one file at a time (DuckDB runs out of memory on the shared PC): python -m pytest tests/test_relink_consumers.py -q
- A re-linked bus (Mystic MA, 110821) resolves to its new node in every module, never the far Mystic CT node.
- Unaffected buses: each module's settled figures equal the unified mart_bus_* / bus_link rows the module read before
  S2-D (the old query, run here independently), for the 20 snapshot buses of tests/fixtures/s2d_unaffected_snapshot.json.
"""
import json
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
import busdata  # noqa: E402
import api_grid  # noqa: E402
import api_decision  # noqa: E402
import api_economics  # noqa: E402
import api_economicsesr  # noqa: E402
import api_land  # noqa: E402

SNAP = json.loads((APP / 'tests' / 'fixtures' / 's2d_unaffected_snapshot.json').read_text(encoding='utf-8'))
UNAFFECTED = sorted(SNAP['buses'], key=int)
MYSTIC_MA = 110821
FAR = 'LD.MYSTC_NU13.8'


@pytest.fixture(scope='module')
def c():
    conn = busdata.connect()
    conn.execute('SET enable_progress_bar=false')
    yield conn
    conn.close()


@pytest.fixture(scope='module')
def new_node(c):
    k = busdata.link_of(c, MYSTIC_MA)
    assert k['tier'] == busdata.RELINKED and k['relinked_from']['pnode_name'] == FAR
    return k['pnode_name']


def _close(a, b):
    if a is None or b is None:
        return a is b
    if isinstance(a, float) or isinstance(b, float):
        return abs(float(a) - float(b)) <= 1e-9
    return a == b


def _old_link(c, b):
    r = busdata.rows(c, 'SELECT pnode_name, price_tier, price_proxy_km FROM bus_link WHERE bus_id = ?', [int(b)])
    return r[0] if r else None


# ── api_grid ──────────────────────────────────────────────────────────────────────────────────────────────
def test_grid_relinked_bus_resolves_to_new_node(c, new_node):
    k = api_grid.constraints(c, str(MYSTIC_MA))
    assert k['settled_series']['pnode_name'] == new_node and k['settled_series']['price_tier'] == busdata.RELINKED
    assert k['settled_series']['relinked_from'] == FAR
    cu = api_grid.curtailment(c, str(MYSTIC_MA))
    assert cu['settled_series']['pnode_name'] == new_node


@pytest.mark.parametrize('bus', UNAFFECTED[:6])
def test_grid_unaffected_link_unchanged(c, bus):
    old = _old_link(c, bus)
    k = api_grid.constraints(c, bus)
    if k is None:
        return
    for f in ('pnode_name', 'price_tier', 'price_proxy_km'):
        assert _close(k['settled_series'][f], old[f]), (bus, f)


# ── api_decision ──────────────────────────────────────────────────────────────────────────────────────────
def test_decision_relinked_bus_resolves_to_new_node(c, new_node):
    o = api_decision._outlook(c, str(MYSTIC_MA))
    rt25 = next(r for r in o['hist'] if r['market'] == 'RT' and r['year'] == 2025)
    want = c.execute("SELECT avg_lmp FROM pn_year WHERE pnode_name = ? AND market = 'RT' AND y = 2025", [new_node]).fetchone()[0]
    assert rt25['avg_lmp'] == pytest.approx(want, abs=1e-9) and rt25['price_tier'] == busdata.RELINKED
    far = c.execute("SELECT avg_lmp FROM pn_year WHERE pnode_name = ? AND market = 'RT' AND y = 2025", [FAR]).fetchone()[0]
    assert rt25['avg_lmp'] != pytest.approx(far, abs=1e-6)
    pop = api_decision._population(c)
    i = pop['ids'].index(str(MYSTIC_MA))
    assert pop['values']['lmp_rt'][i] == pytest.approx(want, abs=1e-9)


def test_decision_unaffected_unchanged(c):
    pop = api_decision._population(c)
    sus = set(SNAP['suspect'])
    old = {str(b): v for b, v in c.execute("SELECT bus_id, avg_lmp FROM mart_bus_year WHERE market='RT' AND y=2025").fetchall()}
    old_tb = {str(b): v for b, v in c.execute("SELECT bus_id, tb4 FROM mart_bus_tb WHERE market='RT' AND y=2025").fetchall()}
    for i, b in enumerate(pop['ids']):
        if int(b) in sus:
            continue
        assert _close(pop['values']['lmp_rt'][i], old.get(b)), b
        assert _close(pop['values']['tb4'][i], old_tb.get(b)), b
    for b in UNAFFECTED[:6]:
        hist = api_decision._outlook(c, b)['hist']
        rows = busdata.rows(c, 'SELECT market, y, avg_lmp, p95, avg_cong FROM mart_bus_year WHERE bus_id = ? ORDER BY market, y', [int(b)])
        assert [(h['market'], h['year']) for h in hist] == [(r['market'], r['y']) for r in rows]
        for h, r in zip(hist, rows):
            assert all(_close(h[k], r[k]) for k in ('avg_lmp', 'p95', 'avg_cong')), b


# ── api_economics ─────────────────────────────────────────────────────────────────────────────────────────
def test_economics_relinked_bus_resolves_to_new_node(c, new_node):
    e = api_economics.bench(c, str(MYSTIC_MA))
    assert e['priceLink']['pnode_name'] == new_node
    want = c.execute("SELECT avg_lmp FROM pn_year WHERE pnode_name = ? AND market = 'RT' AND y = 2025", [new_node]).fetchone()[0]
    assert next(r for r in e['year'] if r['market'] == 'RT' and r['y'] == 2025)['avg_lmp'] == pytest.approx(want, abs=1e-9)


@pytest.mark.parametrize('bus', UNAFFECTED[:6])
def test_economics_unaffected_unchanged(c, bus):
    e = api_economics.bench(c, bus)
    if e is None:
        return
    old = busdata.rows(c, 'SELECT market, y, n_hours, avg_lmp, p5, p95, neg_hours, hours_gt_200, avg_cong, peak_lmp, offpeak_lmp FROM mart_bus_year WHERE bus_id=? ORDER BY market, y', [int(bus)])
    assert len(e['year']) == len(old)
    for a, b in zip(e['year'], old):
        assert all(_close(a[k], b[k]) for k in b), bus
    old_tb = busdata.rows(c, 'SELECT market, y, n_days, tb2, tb4, tb8, tb4_p10, tb4_p90 FROM mart_bus_tb WHERE bus_id=? ORDER BY market, y', [int(bus)])
    assert len(e['tbHist']) == len(old_tb) and all(all(_close(a[k], b[k]) for k in b) for a, b in zip(e['tbHist'], old_tb))


def test_economics_forecast_congestion_on_the_settled_sign(c):
    e = api_economics.bench(c, '111209')
    five = next(r for r in e['fcstYear'] if r['scenario'] == '5yr')
    stored = c.execute('SELECT avg_cong FROM mart_bus_fcst_year WHERE bus_id = ? AND scenario = ?', [111209, '5yr']).fetchone()[0]
    assert five['avg_cong'] == pytest.approx(-stored, abs=1e-12)
    assert not any(k.startswith('_sign') for k in five)


# ── api_economicsesr ──────────────────────────────────────────────────────────────────────────────────────
def test_esr_relinked_bus_takes_the_new_nodes_zone(c):
    assert api_economicsesr.esr(c, str(MYSTIC_MA))['bus']['zone'] == 'NEMA'  # the far Mystic CT node would say CT


@pytest.mark.parametrize('bus', UNAFFECTED[:6])
def test_esr_unaffected_zone_unchanged(c, bus):
    r = busdata.rows(c, '''SELECT p.zone_name, trim(b.load_zone) AS lz FROM dim_bus b LEFT JOIN bus_link l USING (bus_id)
                           LEFT JOIN dim_pnode p ON p.pnode_name = l.pnode_name WHERE b.bus_id = ?''', [int(bus)])[0]
    zl = api_economicsesr.ZONE_LABEL
    want = zl.get(r['zone_name']) or (r['lz'] if r['lz'] in zl.values() else None)
    assert api_economicsesr.esr(c, bus)['bus']['zone'] == want


# ── api_land ──────────────────────────────────────────────────────────────────────────────────────────────
def test_land_relinked_bus_resolves_to_new_node(c, new_node):
    s = api_land.site(c, str(MYSTIC_MA))
    assert s['priceLink']['pnode_name'] == new_node and s['priceLink']['tier'] == busdata.RELINKED


@pytest.mark.parametrize('bus', UNAFFECTED[:6])
def test_land_unaffected_price_link_unchanged(c, bus):
    s = api_land.site(c, bus)
    assert s['priceLink']['pnode_name'] == s['link'][0]['pnode_name'] == _old_link(c, bus)['pnode_name']
