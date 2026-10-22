"""One-off extraction (read-only) of the live Studio's Grid figures for data notes in the preview Grid dashboard.

Reads studio/src/data-ext.js (GS_DATA_EXT, built from GridSense_one.duckdb) and writes
preview/data/grid-studio.json: per bus, the Studio copy's lowest positive element transfer per case (from its
capped loading rows) and its network cost at 100 / 250 MW. The unified DB stays primary; the dashboard shows
a difference as a data note, labelled "vendor/Studio copy (older database)". Never writes to the source.

Run: python plan/extract_grid.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
SRC = HERE.parents[1] / 'analytics-portfolio-canvas-2026-09-11' / 'studio' / 'src' / 'data-ext.js'
OUT = HERE / 'data' / 'grid-studio.json'
# Studio spelling → unified case key
CASE = {'summer_peak|injection': 'summer_peak|discharge', 'summer_peak|discharge': 'summer_peak|discharge',
        'summer_peak|charge': 'summer_peak|charge', 'large_load|charge': 'large_load|charge'}


def main():
    text = SRC.read_text(encoding='utf-8')
    start = text.index('window.GS_DATA_EXT = ') + len('window.GS_DATA_EXT = ')
    d = json.loads(text[start:text.index('};', start) + 1])
    resolve = lambda m, k: m.get(m[k]) if isinstance(m.get(k), str) else m.get(k)
    out = {}
    for k in d['loading']:
        bus, sc, di = k.split('|')
        v = resolve(d['loading'], k)
        if not isinstance(v, dict):
            continue
        cand = [r['transfer_mw'] for r in v.get('rows', []) if not r.get('pre_existing') and isinstance(r.get('transfer_mw'), (int, float)) and r['transfer_mw'] > 0]
        out.setdefault(bus, {}).setdefault('lim', {})[CASE[f'{sc}|{di}']] = {'min_transfer': min(cand) if cand else None, 'rows_published': len(v.get('rows', [])), 'rows_measured': v.get('n_rows')}
    for k in d['cost']:
        bus, sc, di, mw = k.split('|')
        v = resolve(d['cost'], k)
        if not isinstance(v, dict):
            continue
        out.setdefault(bus, {}).setdefault('cost', {})[f"{CASE[f'{sc}|{di}']}|{mw}"] = {'total_musd': v.get('total_musd'), 'elements': v.get('elements_charged')}
    meta = {'source': str(SRC), 'built_at': d['meta'].get('built_at'), 'dataset_version': d['meta'].get('dataset_version'),
            'label': 'Vendor/Studio copy (older database GridSense_one.duckdb via studio/src/data-ext.js)',
            'cap_rule': d['meta']['coverage'].get('loading_cap_rule'), 'cost_rule': 'elements with transfer_mw <= requested, excluding pre-existing (transfer_mw < 0), deduped by facility (Grid 3.17 rule)'}
    OUT.write_text(json.dumps({'meta': meta, 'buses': out}, separators=(',', ':')), encoding='utf-8')
    print(f'{len(out)} buses -> {OUT} ({OUT.stat().st_size:,} B)')


if __name__ == '__main__':
    main()
