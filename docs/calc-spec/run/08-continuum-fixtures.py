"""P3 calc spec (continuum + configurator): record the two real-bus inputs the worked examples need.

Provenance: Claude Opus 5.5 · one-studio-devkit P3 calc-spec (continuum) · 2026-10-15 · sign-off pending · v1

1. Hatchville (bus 111209, pnode LD.HATCHVIL23) settled RT 2025, hour by hour, from the unified DB (read-only,
   parameterised SQL). The autumn-fold duplicate label is collapsed to its mean, the Continuum's own settled
   convention ("the autumn fold is collapsed to one label, so a whole year reads 8,759 hours").
2. The recorded :5034 profitability answer for bus 111209 solar 100 MW COD 2029 (fill interpolate), copied as is
   from the live Studio's own test fixtures (analytics-portfolio-canvas-2026-09-11/tests/fixtures/continuum-nav,
   read only). No live :5034 call is made.

Writes one-studio/app/tests/fixtures/calcspec/{hatchville_rt2025.json, profitability_111209_solar_100.json}.
Run: python docs/calc-spec/run/08-continuum-fixtures.py
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import duckdb

GS = Path(__file__).resolve().parents[4]          # .../02 Products/GridSense
DB = GS / 'unified' / 'ISONE_GridSense_unified.duckdb'
OUT = GS / 'one-studio' / 'app' / 'tests' / 'fixtures' / 'calcspec'
PROF = (GS / 'analytics-portfolio-canvas-2026-09-11' / 'tests' / 'fixtures' / 'continuum-nav'
        / 'continuum_profitability_bus_111209_cod_2029_fill_interpolate_fuel_solar_mw_100_1586ff54.json')

SQL = ('SELECT ts, avg(lmp) AS lmp, count(*) AS n FROM fact_lmp_hourly '
       'WHERE pnode_name = ? AND market = ? AND ts >= ? AND ts < ? GROUP BY ts ORDER BY ts')


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(DB), read_only=True)
    rows = con.execute(SQL, ['LD.HATCHVIL23', 'RT', '2025-01-01', '2026-01-01']).fetchall()
    raw = con.execute('SELECT count(*) FROM fact_lmp_hourly WHERE pnode_name = ? AND market = ? AND ts >= ? AND ts < ?',
                      ['LD.HATCHVIL23', 'RT', '2025-01-01', '2026-01-01']).fetchone()[0]
    con.close()
    body = {
        'source': f'{DB.name} fact_lmp_hourly · pnode LD.HATCHVIL23 · RT · 2025 (read-only)',
        'bus': 111209, 'pnode': 'LD.HATCHVIL23', 'market': 'RT', 'year': 2025,
        'rows_stored': raw, 'labels': len(rows), 'fold_labels': sum(1 for r in rows if r[2] > 1),
        'unit': '$/MWh', 'lmp': [None if r[1] is None else round(float(r[1]), 4) for r in rows],
    }
    (OUT / 'hatchville_rt2025.json').write_text(json.dumps(body, separators=(',', ':')) + '\n', encoding='utf-8', newline='\n')
    shutil.copyfile(PROF, OUT / 'profitability_111209_solar_100.json')
    print(json.dumps({k: v for k, v in body.items() if k != 'lmp'}))


if __name__ == '__main__':
    main()
