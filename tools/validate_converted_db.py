"""Check a converted DuckDB (tools/convert_legacy_db.py) against the dev kit's recordings of the unified store.

Provenance: 2026-10-22 · one-studio-devkit/tools · v1

    python3.13 tools/validate_converted_db.py --db ~/Downloads/unified/ISONE_GridSense_converted.duckdb [--fixtures app/fixtures]

Read-only. Each check prints matched / compared and a few differing examples. The recordings are an oracle only where both
stores describe the same quantity; differences that come from the older store's vintage are reported, not hidden.
"""
import argparse
import gzip
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import duckdb

APP = Path(__file__).resolve().parents[1] / 'app'


def close(a, b, rel=1e-9, ab=1e-9):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, str) or isinstance(b, str):
        return str(a).strip() == str(b).strip()
    if isinstance(a, bool) or isinstance(b, bool):
        return bool(a) == bool(b)
    return math.isclose(float(a), float(b), rel_tol=rel, abs_tol=ab)


class Report:
    def __init__(self):
        self.lines = []

    def check(self, name, ok, total, examples=()):
        pct = 100.0 * ok / total if total else 100.0
        self.lines.append((name, ok, total, pct))
        print(f'{"PASS" if ok == total else "DIFF"}  {name}: {ok:,} / {total:,} ({pct:.2f}%)')
        for e in list(examples)[:4]:
            print(f'        e.g. {e}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--fixtures', default=str(APP / 'fixtures'))
    a = ap.parse_args()
    fx = Path(a.fixtures)
    idx = json.loads((fx / 'index.json').read_text(encoding='utf-8'))['paths']
    rec = lambda p: json.loads(gzip.open(fx / idx[p]['file']).read())
    c = duckdb.connect(a.db, read_only=True)
    R = Report()

    market = rec('/api/market')
    # 1. envelope rows
    got = {(r[0], r[1], r[2]): r[3] for r in c.execute('SELECT bus_id, scenario, direction, headroom_mw FROM fact_headroom').fetchall()}
    want = market['grid']['headroom']
    bad = [(w['bus_id'], w['scenario'], w['direction'], w['headroom_mw'], got.get((w['bus_id'], w['scenario'], w['direction']), 'absent'))
           for w in want if not close(got.get((w['bus_id'], w['scenario'], w['direction'])), w['headroom_mw'])]
    R.check('fact_headroom vs recorded /api/market', len(want) - len(bad), len(want), bad)

    # 2. element study rows (multiset per bus/case on the 16 recorded columns)
    cols = list(market['grid']['constraints'][0].keys())
    gotle = Counter()
    for r in c.execute(f'SELECT {", ".join(cols)} FROM fact_limiting_element').fetchall():
        gotle[tuple(round(v, 6) if isinstance(v, float) else (v.strip() if isinstance(v, str) else v) for v in r)] += 1
    miss = []
    for w in market['grid']['constraints']:
        k = tuple(round(w[col], 6) if isinstance(w[col], float) else (w[col].strip() if isinstance(w[col], str) else w[col]) for col in cols)
        if gotle[k] > 0:
            gotle[k] -= 1
        else:
            miss.append(k[:6])
    R.check('fact_limiting_element vs recorded /api/market (16 columns, row multiset)', len(market['grid']['constraints']) - len(miss),
            len(market['grid']['constraints']), miss)

    # 3. bus facts on the 2,678-bus spine
    db = {r[0]: r for r in c.execute('SELECT bus_id, nominal_kv, load_zone, latitude, longitude, short_circuit_mva, state_code, county FROM dim_bus WHERE latitude IS NOT NULL').fetchall()}
    for field, i in (('kv', 1), ('zone', 2), ('lat', 3), ('lon', 4), ('sc_mva', 5), ('state', 6), ('county', 7)):
        bad = [(n['bus_id'], n[field], db.get(n['bus_id'], [None] * 8)[i]) for n in market['nodes'] if not close(db.get(n['bus_id'], [None] * 8)[i], n[field], 1e-6, 0.051 if field == 'sc_mva' else 1e-9)]
        R.check(f'dim_bus.{field} vs recorded /api/market nodes', len(market['nodes']) - len(bad), len(market['nodes']), bad)
    R.check('geolocated bus count', len(db), len(market['nodes']))

    # 4. resolved price links (busdata.price_links, D-008, on the converted store) vs recorded /api/buses
    sys.path.insert(0, str(APP))
    import busdata
    busdata.SOURCE = Path(a.db)
    L = busdata.price_links(c)['links']
    buses = rec('/api/buses')['buses']
    tier_ok = sum(1 for b in buses if L.get(int(b['id']), {}).get('tier') == b['tier'])
    pn_bad = [(b['id'], b['tier'], b['pnode'], L.get(int(b['id']), {}).get('pnode_name')) for b in buses if L.get(int(b['id']), {}).get('pnode_name') != b['pnode']]
    R.check('resolved price tier vs recorded /api/buses', tier_ok, len(buses))
    R.check('resolved price node vs recorded /api/buses', len(buses) - len(pn_bad), len(buses), pn_bad)
    print(f'        tiers: {dict(Counter(v["tier"] for v in L.values()))}; relinked {len(busdata.price_links(c)["relinked"])}')

    # 5. settled marts: hub (recorded DA/RT series) and Mashpee's node, every column of every recorded row
    def mart_check(label, recorded, query, params, keys, rel):
        got = {tuple(r[k] for k in keys): r for r in busdata.rows(c, query, params)}
        n = ok = 0
        bad = []
        for w in recorded:
            g = got.get(tuple(w[k] for k in keys))
            for col, v in w.items():
                if col in ('bus_id', 'price_tier', 'price_proxy_km', 'buses_sharing_series', 'pnode_name') or col in keys:
                    continue
                n += 1
                if g is not None and close(g.get(col), v, rel, 1e-6):
                    ok += 1
                elif len(bad) < 6:
                    bad.append((tuple(w[k] for k in keys), col, v, None if g is None else g.get(col)))
        R.check(label, ok, n, bad)

    hub = rec('/api/x/prices/summary/hub')
    for g, keys in (('year', ('market', 'y')), ('month', ('market', 'y', 'm')), ('hour', ('market', 'y', 'h')), ('tb', ('market', 'y'))):
        mart_check(f'pn_{g} hub vs recorded summary/hub', hub[g], f'SELECT * FROM pn_{g} WHERE pnode_name = ?', ['.H.INTERNAL_HUB'], keys, 1e-9)
    mart_check('pn_da_rt hub vs recorded summary/hub', hub['daRt'], 'SELECT * FROM pn_da_rt WHERE pnode_name = ?', ['.H.INTERNAL_HUB'], ('y',), 1e-9)
    s = rec('/api/x/prices/summary/111403')
    full = [r for r in s['year'] if r['market'] == 'RT' and r['y'] in (2021, 2022, 2024, 2025)]
    mart_check('pn_year RT full years at LD.MASHPEE 23 (fold reading repeated, so ~1e-4 rel)', full, 'SELECT * FROM pn_year WHERE pnode_name = ?',
               ['LD.MASHPEE 23'], ('market', 'y'), 2e-3)
    # 6. forecast marts at Mashpee (5yr, 10yr) and the hub model bus
    for g, keys, rows in (('year', ('scenario',), [r for r in s['fcstYear'] if r['scenario'] in ('5yr', '10yr')]),
                          ('month', ('scenario', 'm'), [r for r in s['fcstMonth'] if r['scenario'] in ('5yr', '10yr')]),
                          ('hour', ('scenario', 'h'), [r for r in s['fcstHour'] if r['scenario'] in ('5yr', '10yr')])):
        rows = [{k: v for k, v in r.items() if k not in ('avg_energy', 'avg_cong_stored', 'target_year', '_sign')} for r in rows]
        for r in rows:  # recorded figures are on the ISO sign; the mart stores the run sign
            if 'avg_cong' in r and r['avg_cong'] is not None:
                r['avg_cong'] = -r['avg_cong']
        mart_check(f'mart_bus_fcst_{g} 111403 vs recorded summary', rows, f'SELECT * FROM mart_bus_fcst_{g} WHERE bus_id = ?', [111403], keys, 1e-9)

    # 7. forecast hourly records for all recorded buses (every 5yr/10yr record)
    n = ok = 0
    bad = []
    for p in [p for p in idx if p.startswith('/api/bus/')]:
        body = rec(p)
        bid = 80000 if p.endswith('/hub') else int(p.rsplit('/', 1)[1])
        got = {(r[0], r[1].isoformat(), r[2]): r[3:] for r in c.execute('SELECT scenario, study_date, hour, lmp, congestion, loss FROM fact_fcst_lmp_hourly WHERE bus_id = ?', [bid]).fetchall()}
        for sr in body['series']:
            if sr['mode'] != 'forecast' or sr['run'] not in ('5yr', '10yr'):
                continue
            for ts, price, _g, _e, cong, loss in sr['records']:
                n += 1
                g = got.get((sr['run'], ts[:10], int(ts[11:13])))
                if g and close(g[0], price) and close(-g[1], cong) and close(g[2], loss):
                    ok += 1
                elif len(bad) < 4:
                    bad.append((bid, sr['run'], ts, price, g))
    R.check('fact_fcst_lmp_hourly records vs every recorded bus (5yr, 10yr; sign flipped once)', ok, n, bad)

    # 8. substations and queue
    n = ok = 0
    bad = []
    for p in [p for p in idx if p.startswith('/api/x/land/site5/')]:
        w = rec(p)['substation']
        g = busdata.rows(c, 'SELECT * FROM dim_substation WHERE bus_id = ?', [w['bus_id']])
        g = g[0] if g else {}
        for col, v in w.items():
            n += 1
            if close(g.get(col), v, 1e-9, 0.051 if col == 'short_circuit_mva' else 1e-9):
                ok += 1
            elif len(bad) < 6:
                bad.append((w['bus_id'], col, v, g.get(col)))
    R.check('dim_substation vs recorded land/site5 (every column, 17 buses)', ok, n, bad)
    q = rec('/api/x/queue/study/all')['queue']
    gq = {r['queue_position']: r for r in busdata.rows(c, 'SELECT * FROM dim_queue')}
    n = ok = 0
    for w in q:
        for col, v in w.items():
            n += 1
            gv = gq.get(w['queue_position'], {}).get(col)
            ok += close(gv.isoformat() if hasattr(gv, 'isoformat') else gv, v)
    R.check('dim_queue vs recorded queue/study (every column)', ok, n)

    print('\nsummary')
    for name, ok, total, pct in R.lines:
        print(f'  {pct:7.2f}%  {name}')


if __name__ == '__main__':
    main()
