"""One-off, READ-ONLY extraction of the live Studio's land-stage inputs that are NOT in the unified DB.

Reads (never writes) the live Studio copy:
  studio/src/data.js      GS_DATA.nodes      -> per-bus lat/lon, short-circuit, outlets, 2026-05 headroom, gen/load MW
  studio/src/data-ext.js  GS_DATA_EXT.grid_visuals.to_by_bus -> transmission-owner evidence (queue to_report)
Writes preview/data/land-studio.json. Provenance: "vendor/Studio copy (older database)".
Run: python plan/extract_land.py
"""
import json
from pathlib import Path

PREVIEW = Path(__file__).resolve().parents[1]
STUDIO = PREVIEW.parents[1] / 'analytics-portfolio-canvas-2026-09-11' / 'studio' / 'src'
OUT = PREVIEW / 'data' / 'land-studio.json'
KEEP = ['lat', 'lon', 'county', 'state', 'kv', 'sc_mva', 'outlets', 'hr_sp_dis', 'hr_sp_chg', 'hr_sh_dis', 'hr_ll_chg', 'gen_mw', 'load_mw', 'branch_deg']


def load_js(path):
    s = path.read_text(encoding='utf-8')
    return json.loads(s[s.index('{'):s.rindex('}') + 1])


def main():
    d = load_js(STUDIO / 'data.js')
    cols = d['nodes']['cols']
    rows = d['nodes']['rows'] if 'rows' in d['nodes'] else d['nodes'][[k for k in d['nodes'] if k != 'cols'][0]]
    idx = {c: i for i, c in enumerate(cols)}
    buses = {str(r[idx['bus_id']]): [r[idx[k]] for k in KEEP] for r in rows}
    ext = load_js(STUDIO / 'data-ext.js')
    gv = ext.get('grid_visuals', {})
    out = {
        'source': 'vendor/Studio copy (older database): studio/src/data.js GS_DATA.nodes (built %s from ISONE_GridSense.duckdb, headroom vintage 2026-05) and data-ext.js grid_visuals.to_by_bus (%s)'
                  % (d['meta'].get('built_at'), (gv.get('meta', {}).get('sources', {}) or {}).get('to_by_bus', 'source not stated')),
        'cols': KEEP,
        'buses': buses,
        'to_by_bus': gv.get('to_by_bus', {}),
        'to_not_an_owner': (gv.get('meta', {}).get('to', {}) or {}).get('not_an_owner', []),
    }
    OUT.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
    print(f'wrote {OUT} · {len(buses)} buses · {len(out["to_by_bus"])} TO records')


if __name__ == '__main__':
    main()
