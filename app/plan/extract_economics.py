"""One-off, read-only extraction of the live Studio's per-bus economics fields (vendor/Studio copy, older database)
into preview/data/economics-studio.json. Never writes to the Studio folder. Re-run when the Studio data is rebuilt.

Fields (studio/src/data.js GS_DATA.nodes; meanings in studio/DATA-EXT-CONTRACT.md and app.js economics pack):
  lmp_2025/2030/2035/2050   annual mean price ($/MWh; 2050 = vendor escalation of 2040, excluded from the unified DB)
  p5_2030, p95_2030         2030 hourly quantiles
  solar_cap_2030, wind_cap_2030   capture ratios (vendor)
  {solar,wind,bess,dc}_{100,250,500,1000}MW_2030   curtailment / opportunity-loss / reliability % (vendor ramp, not screened)
  tb2_2030, tb4_2030, tb8_2030, tb4_2035, tb4_2050   published annual top-bottom spreads ($/MWh)
  hneg_2025, h200_2025, std_2025, cong_2025         2025 settled statistics
"""
import json
import re
from pathlib import Path

PREVIEW = Path(__file__).resolve().parents[1]
STUDIO = PREVIEW.parents[1] / 'analytics-portfolio-canvas-2026-09-11' / 'studio' / 'src' / 'data.js'
OUT = PREVIEW / 'data' / 'economics-studio.json'
FIELDS = ['lmp_2025', 'lmp_2030', 'lmp_2035', 'lmp_2050', 'p5_2030', 'p95_2030', 'solar_cap_2030', 'wind_cap_2030',
          *[f'{f}_{s}MW_2030' for f in ('solar', 'wind', 'bess', 'dc') for s in (100, 250, 500, 1000)],
          'tb2_2030', 'tb4_2030', 'tb8_2030', 'tb4_2035', 'tb4_2050', 'hneg_2025', 'h200_2025', 'std_2025', 'cong_2025', 'state', 'zone']


def main():
    text = STUDIO.read_text(encoding='utf-8')
    m = re.match(r'\s*window\.GS_DATA\s*=\s*', text)
    if not m: raise SystemExit('data.js does not start with window.GS_DATA =')
    data, _ = json.JSONDecoder().raw_decode(text[m.end():])
    cols = data['nodes']['cols']
    ix = {c: i for i, c in enumerate(cols)}
    missing = [f for f in FIELDS if f not in ix]
    if missing: raise SystemExit(f'fields not in GS_DATA.nodes: {missing}')
    rows = {str(r[ix['bus_id']]): [r[ix[f]] for f in FIELDS] for r in data['nodes']['rows']}
    out = {'source': 'vendor/Studio copy (older database): analytics-portfolio-canvas-2026-09-11/studio/src/data.js GS_DATA.nodes',
           'built_at': data['meta'].get('built_at'), 'upstream': data['meta'].get('source'),
           'notes': {'curtailment': 'vendor ramp, a constant multiplier with size; 2,676 of 2,678 not screened (unified data_quality: curtailment_sweeps excluded)',
                     'lmp_2050': 'vendor 2040 x 1.0816 per 5-year step, not a simulation (unified data_quality: forecast_2045_2050 excluded)',
                     'tb': 'published annual top-bottom spreads from the vendor sheet (DA annual basis)'},
           'fields': FIELDS, 'buses': rows}
    OUT.write_text(json.dumps(out, separators=(',', ':')), encoding='utf-8')
    print(f'{len(rows)} buses -> {OUT} ({OUT.stat().st_size:,} bytes)')


if __name__ == '__main__':
    main()
