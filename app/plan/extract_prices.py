"""One-off, read-only extraction of the live Studio's price figures (vendor sheet + Canvas extension)
into preview/data/prices-studio.json, so the Prices dashboard can show them BESIDE the unified database
as a labelled second source and state the difference. The Studio files are opened for reading only.

Sources (never written):
  studio/src/data.js      window.GS_DATA      (vendor/Studio copy: ISONE_GridSense.duckdb + _agg, built 2026-09-20)
  studio/src/data-ext.js  window.GS_DATA_EXT  (Canvas extension: GridSense_one.duckdb + derived marts)
Run: python plan/extract_prices.py
"""
import json
from pathlib import Path

PREVIEW = Path(__file__).resolve().parents[1]
STUDIO = PREVIEW.parents[1] / 'analytics-portfolio-canvas-2026-09-11' / 'studio' / 'src'
OUT = PREVIEW / 'data' / 'prices-studio.json'

SHEET_FIELDS = ['zone', 'hourly_conf', 'shared_n', 'lmp_2025', 'lmp_2030', 'lmp_2035', 'lmp_2050', 'p5_2030', 'p95_2030',
                'solar_cap_2030', 'wind_cap_2030', 'tb2_2030', 'tb4_2030', 'tb8_2030', 'tb4_2035', 'tb4_2050',
                'cong_2025', 'hneg_2025', 'h200_2025', 'basis_own_2025', 'std_2025', 'zone_source',
                'basis_ME_2030', 'basis_NH_2030', 'basis_VT_2030', 'basis_CT_2030', 'basis_RI_2030', 'basis_SEMA_2030',
                'basis_WCMA_2030', 'basis_NEMA_2030', 'top_constraint', 'top_shadow', 'rt_neg_2025',
                'solar_100MW_2030', 'solar_250MW_2030', 'solar_500MW_2030', 'solar_1000MW_2030',
                'wind_100MW_2030', 'wind_250MW_2030', 'wind_500MW_2030', 'wind_1000MW_2030']


def load_js(path, marker):
    text = path.read_text(encoding='utf-8')
    start = text.index('{', text.index(marker))
    end = text.rstrip().rstrip(';').rindex('}') + 1
    return json.loads(text[start:end])


def main():
    gs = load_js(STUDIO / 'data.js', 'GS_DATA')
    ext = load_js(STUDIO / 'data-ext.js', 'GS_DATA_EXT')
    cols = gs['nodes']['cols']
    idx = {c: i for i, c in enumerate(cols)}
    buses = {}
    for row in gs['nodes']['rows']:
        bid = str(row[idx['bus_id']])
        buses[bid] = {'sheet': {f: row[idx[f]] for f in SHEET_FIELDS if f in idx}}
    nc = ext.get('node_constraints', {})
    names, headline = nc.get('names', []), nc.get('meta', {}).get('headline', [])
    for bid, top in (nc.get('top') or {}).items():
        buses.setdefault(bid, {})['top'] = [{'period': headline[h], 'name': names[n], 'value': v, 'exact': bool(e)} for h, n, v, e in top]
    for bid, v in (ext.get('forecast_delta') or {}).items():
        buses.setdefault(bid, {})['fdelta'] = v
    for bid, v in (ext.get('load_pays') or {}).items():
        buses.setdefault(bid, {})['loadPays'] = v
    flags = ext.get('run_input_flags') or {}
    for bid, v in (flags.get('cape_5yr') or {}).items():
        buses.setdefault(bid, {})['cape5yr'] = {'cape_usd': v[0], 'share': v[1], 'mcc_5yr': v[2]}
    for bid, v in (flags.get('sheet_2030_vs_5yr') or {}).items():
        buses.setdefault(bid, {})['sheet2030vs5yr'] = v
    cur = ext.get('curtailment') or {}
    keys = cur.get('meta', {}).get('study_keys', [])
    for bid, v in (cur.get('study') or {}).items():
        buses.setdefault(bid, {})['study'] = dict(zip(keys, v))
    run_keys = cur.get('meta', {}).get('blocks', {}).get('units', {}).get('run_keys', [])
    for bid, v in (cur.get('units') or {}).items():
        buses.setdefault(bid, {})['units'] = {'units': [{'name': u[0], 'fuel': u[1], 'econ_max_mw': u[2]} for u in v.get('units', [])],
                                              'runs': [dict(zip(run_keys, r)) for r in v.get('runs', [])]}
    out = {
        'meta': {
            'sheet': {'file': 'studio/src/data.js (window.GS_DATA)', 'built_at': gs['meta'].get('built_at'), 'source': gs['meta'].get('source'),
                      'label': 'vendor/Studio copy (older database)',
                      'agg_meta': gs['meta'].get('agg_meta', {})},
            'ext': {'file': 'studio/src/data-ext.js (window.GS_DATA_EXT)', 'built_at': ext['meta'].get('built_at'), 'source': ext['meta'].get('source'),
                    'label': 'Studio extension copy (GridSense_one.duckdb)'},
            'constraints_rules': nc.get('meta', {}).get('units', {}),
            'curtailment_blocks': cur.get('meta', {}).get('blocks', {}),
            'cape_note': (flags.get('meta') or {}).get('cape_5yr', {}).get('note'),
            'sheet_2030_rule': (flags.get('meta') or {}).get('sheet_2030', {}).get('statement') or (flags.get('meta') or {}).get('sheet_2030', {}).get('rule'),
        },
        'zonesVsHub': ext.get('zones_vs_hub', []),
        'zoneNegHours': ext.get('zone_neg_hours', []),
        'buses': buses,
    }
    OUT.write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    print(f'{OUT} · {len(buses)} buses · {OUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
