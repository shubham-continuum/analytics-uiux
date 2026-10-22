"""One-off, read-only extraction of the live Studio's data copy for the Market dashboard.

Reads studio/src/data.js (GS_DATA, vendor build from ISONE_GridSense.duckdb + _agg) and studio/src/data-ext.js
(GS_DATA_EXT, GridSense_one.duckdb + derived marts). Writes preview/data/market-studio.json.
These are the "vendor/Studio copy (older database)". The unified DB stays primary: the dashboard uses this file
only for analyses the unified DB cannot back (the 1,751-record queue register, Henry Hub gas, planned additions)
and for data notes where the two sources disagree. Never writes to the Studio.
"""
import json
from pathlib import Path

STUDIO = Path(r'D:\Ganesh\02 Products\GridSense\analytics-portfolio-canvas-2026-09-11\studio\src')
OUT = Path(__file__).resolve().parents[1] / 'data' / 'market-studio.json'


def load(name, var):
    s = (STUDIO / name).read_text(encoding='utf-8')
    i = s.index(f'window.{var}') + len(f'window.{var}')
    return json.loads(s[i:].lstrip(' =').strip().rstrip(';'))


def main():
    d = load('data.js', 'GS_DATA')
    e = load('data-ext.js', 'GS_DATA_EXT')
    cols = d['nodes']['cols']
    keep = ['bus_id', 'zone', 'lmp_2025', 'lmp_2030', 'hneg_2025', 'basis_own_2025', 'std_2025', 'tb4_2030', 'solar_cap_2030', 'outlets']
    ix = [cols.index(k) for k in keep]
    fix = e.get('zone_fix', {})
    rows = []
    for r in d['nodes']['rows']:
        v = [r[i] for i in ix]
        v.insert(2, fix.get(str(v[0]), v[1]))  # zone after the Studio's own zone_fix
        rows.append(v)
    c = e.get('cathy', {})
    out = {
        'provenance': 'vendor/Studio copy (older database): studio/src/data.js + data-ext.js, read-only',
        'gsData': {'built_at': d['meta'].get('built_at'), 'source': d['meta'].get('source')},
        'gsDataExt': {'built_at': e['meta'].get('built_at'), 'source': e['meta'].get('source')},
        'nodes': {'cols': keep[:2] + ['zone_fixed'] + keep[2:], 'rows': rows},
        'queueTrends': {'rows': e.get('queue_trends', []), 'meta': e['meta'].get('queue_trends')},
        'additions': c.get('additions', []),
        'gas': c.get('gas', []),
        'outlook': c.get('outlook', []),
        'zonesVsHub': e.get('zones_vs_hub', []),
        'zoneNegHours': e.get('zone_neg_hours', []),
    }
    OUT.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
    print(OUT, OUT.stat().st_size, 'bytes;', len(rows), 'buses')


if __name__ == '__main__':
    main()
