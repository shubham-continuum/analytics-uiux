"""D-008 guard: one price-link function; far same-name links are re-linked, never priced through.

Provenance: Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · S2-D · 2026-10-06 · sign-off pending · v1

Run: python -m pytest tests/test_pricelink.py -q   (from app/)
The snapshot fixture tests/fixtures/s2d_unaffected_snapshot.json was taken from the pre-S2-D code: every bus that is
NOT re-linked must price exactly as before.
"""
import hashlib
import json
import sys
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APP))
import busdata  # noqa: E402
import api_prices as A  # noqa: E402
import api_market  # noqa: E402
import api_pricesintra  # noqa: E402
from api_grid import miles  # noqa: E402

SNAP = json.loads((APP / 'tests' / 'fixtures' / 's2d_unaffected_snapshot.json').read_text(encoding='utf-8'))
MYSTIC_MA = [110759, 110762, 110818, 110820, 110821, 110823, 111802]
MYSTIC_CT = [119672, 119673, 119674, 119675]
D008_COUNT = 85  # decision card D-008 / M2 parity: buses tagged direct/same_substation at a same-name node in another town


@pytest.fixture(scope='module')
def c():
    conn = busdata.connect()
    conn.execute('SET enable_progress_bar=false')
    yield conn
    conn.close()


@pytest.fixture(scope='module')
def L(c):
    return busdata.price_links(c)


def _independent_suspects(c):
    """The D-008 rule restated by independent SQL + the preview's miles(): threshold read from the DB."""
    km = c.execute('SELECT max(distance_km) FROM bridge_bus_pnode WHERE tier = ?', ['geo_proxy']).fetchone()[0]
    thr = km / 1.609344
    rows = c.execute('''SELECT b.bus_id, b.latitude, b.longitude, n.latitude, n.longitude FROM dim_bus b
                        JOIN bridge_bus_pnode p ON p.bus_id = b.bus_id AND p.link_rank = 1
                        LEFT JOIN dim_pnode n ON n.pnode_name = p.pnode_name
                        WHERE b.latitude IS NOT NULL AND p.tier IN (?, ?)''', ['direct', 'same_substation']).fetchall()
    return thr, sorted(r[0] for r in rows if (m := miles(r[1], r[2], r[3], r[4])) is not None and m > thr)


def test_threshold_is_read_from_the_db(c, L):
    thr, _ = _independent_suspects(c)
    assert L['threshold_mi'] == pytest.approx(thr, abs=1e-9)
    assert round(L['threshold_mi'], 2) == 22.03


def test_relinked_count_equals_suspect_count(c, L):
    _, sus = _independent_suspects(c)
    assert L['relinked'] == sus
    assert len(L['relinked']) == D008_COUNT == len(SNAP['suspect'])
    assert sorted(L['relinked']) == SNAP['suspect']
    assert sum(1 for b in L['links'].values() if b['tier'] == busdata.RELINKED) == D008_COUNT


def test_relinked_node_is_the_nearest_under_the_geo_proxy_rule(c, L):
    cand = c.execute('SELECT pnode_name, latitude, longitude FROM dim_pnode WHERE latitude IS NOT NULL').fetchall()
    for b in L['relinked']:
        rec = L['links'][b]
        la, lo = c.execute('SELECT latitude, longitude FROM dim_bus WHERE bus_id = ?', [b]).fetchone()
        best = min(miles(la, lo, p[1], p[2]) for p in cand)
        assert rec['distance_mi'] == pytest.approx(best, abs=1e-9), b
        assert rec['distance_mi'] <= L['threshold_mi'], b
        assert rec['pnode_name'] != rec['relinked_from']['pnode_name'], b
        assert rec['relinked_from']['distance_mi'] > L['threshold_mi'], b
        assert rec['buses_at_substation'] is None  # no own / station series any more


def test_mystic_ma_is_no_longer_priced_at_a_mystic_ct_node(c, L):
    for b in MYSTIC_MA:
        rec = L['links'][b]
        assert rec['tier'] == busdata.RELINKED
        assert rec['relinked_from']['pnode_name'] == 'LD.MYSTC_NU13.8'
        zone = c.execute('SELECT zone_name FROM dim_pnode WHERE pnode_name = ?', [rec['pnode_name']]).fetchone()[0]
        assert zone == '.Z.NEMASSBOST', (b, rec['pnode_name'])
        assert not rec['pnode_name'].startswith('LD.MYSTC_NU')
        # every surface reads the same function
        p = busdata.bus_payload(c, str(b))
        assert p['nodes'][0]['priceMapping']['pnode_name'] == rec['pnode_name']
        assert p['nodes'][0]['priceMapping']['tier'] == busdata.RELINKED
        s = A.summary(c, str(b))
        assert s['link']['pnode_name'] == rec['pnode_name'] and s['link']['price_tier'] == busdata.RELINKED
        rt25 = next(r for r in s['year'] if r['market'] == 'RT' and r['y'] == 2025)
        n, avg = c.execute("SELECT count(*), avg(lmp) FROM fact_lmp_hourly WHERE pnode_name = ? AND market = 'RT' AND year(ts) = 2025",
                           [rec['pnode_name']]).fetchone()
        assert rt25['n_hours'] == n and rt25['avg_lmp'] == pytest.approx(avg, abs=1e-9)
    lst = {int(b['id']): b for b in busdata.bus_list(c)}
    for b in MYSTIC_MA:
        assert lst[b]['pnode'] == L['links'][b]['pnode_name'] and lst[b]['tier'] == busdata.RELINKED
        assert lst[b]['relinkMi'] == pytest.approx(L['links'][b]['distance_mi'], abs=1e-9)
    for b in MYSTIC_CT:  # the CT buses keep their own node
        assert L['links'][b]['pnode_name'].startswith('LD.MYSTC_NU') and L['links'][b]['tier'] != busdata.RELINKED
    assert api_pricesintra._zone(c, str(MYSTIC_MA[0]))[0] == '.Z.NEMASSBOST'


def test_relinked_bus_price_fields_come_from_the_new_node(c, L):
    ms = api_market.measures(c, 'all')['buses']
    scr = busdata.screen(c)['buses']
    fl = A.fleet(c, 'all')
    for b in L['relinked']:
        pn = L['links'][b]['pnode_name']
        row = c.execute("SELECT avg_lmp FROM pn_year WHERE pnode_name = ? AND market = 'RT' AND y = 2025", [pn]).fetchone()
        want = row[0] if row else None
        got = (scr.get(str(b)) or {}).get('hist', {}).get('avgRT')
        assert (got is None and want is None) or got == pytest.approx(want, abs=1e-9), b
        assert ((ms.get(str(b)) or {}).get('y') or {}).get('2025') == (None if want is None else pytest.approx(want, abs=1e-4)), b
        yrs = fl['years']
        if want is not None:
            assert fl['rtMean'][str(b)][yrs.index(2025)] == pytest.approx(want, abs=1e-9)


def test_sharing_count_follows_the_resolved_links(L):
    from collections import Counter
    n = Counter(r['pnode_name'] for r in L['links'].values())
    for r in L['links'].values():
        assert r['buses_sharing_series'] == n[r['pnode_name']]


# ── snapshot: buses that are not re-linked price exactly as before ────────────────────────────────────────

def _rnd(v):
    if isinstance(v, float): return round(v, 9) + 0.0  # -0.0 == 0.0: the old flip printed -0.0 for a zero
    if isinstance(v, dict): return {k: _rnd(x) for k, x in v.items()}
    if isinstance(v, list): return [_rnd(x) for x in v]
    return v


def _fold_free(recs):
    """The autumn repeated hour has no source order (ORDER BY ts, market, lmp ties): compare as a set, offset label dropped."""
    return sorted(([r[0][:19]] + r[1:] for r in recs), key=lambda r: (r[0], [x if x is not None else -1e18 for x in r[1:]]))


def _h(o):
    return hashlib.sha256(json.dumps(_rnd(busdata.clean(o)), sort_keys=True, separators=(',', ':')).encode()).hexdigest()


PRICE_Y = ['market', 'y', 'n_hours', 'avg_lmp', 'min_lmp', 'max_lmp', 'std_lmp', 'p5', 'p25', 'p50', 'p75', 'p95', 'neg_hours',
           'hours_gt_200', 'avg_energy', 'avg_cong', 'avg_loss', 'peak_lmp', 'offpeak_lmp']


@pytest.mark.parametrize('bus', sorted(SNAP['buses']))
def test_unaffected_bus_prices_unchanged(c, bus):
    want = SNAP['buses'][bus]
    s = A.summary(c, bus)
    got = _rnd(busdata.clean({
        'pnode': s['link']['pnode_name'], 'tier': s['link']['price_tier'],
        'year': [{k: r[k] for k in PRICE_Y} for r in s['year']],
        'month': [{k: r[k] for k in ('market', 'y', 'm', 'n_hours', 'avg_lmp', 'solar_lmp', 'neg_hours', 'avg_cong')} for r in s['month']],
        'tb': [{k: r[k] for k in ('market', 'y', 'n_days', 'tb2', 'tb4', 'tb8')} for r in s['tb']],
        'daRt': [{k: r[k] for k in ('y', 'n_hours', 'avg_da', 'avg_rt', 'avg_rt_less_da')} for r in s['daRt']],
        'fcstYear': [{k: r.get(k) for k in ('scenario', 'avg_lmp', 'avg_cong', 'avg_energy', 'avg_loss')} for r in s['fcstYear']],
        'fcstHour': [{k: r.get(k) for k in ('scenario', 'h', 'avg_lmp', 'avg_cong')} for r in s['fcstHour']],
    }))
    for k in got:
        assert got[k] == want[k], (bus, k)
    series = sorted(busdata.bus_payload(c, bus)['series'], key=lambda x: (x['mode'], x['market'], x['run'], x['year']))
    assert _h([[x['mode'], x['market'], x['run'], x['year'], _fold_free(x['records'])] for x in series]) == want['series_sha']


def test_unaffected_fleet_surfaces_unchanged(c):
    sus = set(SNAP['suspect'])
    scr = busdata.screen(c)['buses']
    assert _h({k: {'hist': v['hist'], 'fcst': v['fcst'], 'priceTier': v.get('priceTier')} for k, v in scr.items() if int(k) not in sus}) == SNAP['screen_unaffected_sha']
    fl = A.fleet(c, 'all')
    assert _h({k: v for k, v in fl['rtMean'].items() if int(k) not in sus}) == SNAP['fleet_rt_unaffected_sha']
    bl = {b['id']: {k: b[k] for k in ('pnode', 'tier', 'proxyKm', 'hist', 'runs')} for b in busdata.bus_list(c) if int(b['id']) not in sus}
    assert _h(bl) == SNAP['bus_list_unaffected_sha']
    mk = busdata.market(c)
    assert _h([{k: n[k] for k in ('bus_id', 'lmp_2025', 'hneg_2025', 'tb4_2025', 'solar_ratio_2025', 'rt_less_da_2025', 'lmp_2030', 'pnode', 'tier', 'proxyKm', 'hist')}
               for n in mk['nodes'] if n['bus_id'] not in sus]) == SNAP['market_nodes_unaffected_sha']
    ms = api_market.measures(c, 'all')['buses']
    # solwin30 is excluded: its window moved 8-14 -> 9-16 on purpose (FORMULAS D5); tested in test_market_solar_window.py
    assert _h({k: {a: b for a, b in v.items() if a != 'solwin30'} for k, v in ms.items() if int(k) not in sus}) == SNAP['market_measures_unaffected_sha']
