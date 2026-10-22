"""Read-only dump for tests/gate-grid-allbus.mjs: every geolocated, price-linked bus and the full grid tables.

Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
Same bus universe and the same SELECT * shape as busdata.bus_payload(), so the gate sees what a bus page sees.
    python plan/dump_grid_allbus.py --db <unified.duckdb> --out <scratch>/grid-allbus.json
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import busdata  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--db', required=True)
ap.add_argument('--out', required=True)
a = ap.parse_args()
busdata.SOURCE = Path(a.db).resolve()
c = busdata.connect()
buses = [str(r['bus_id']) for r in busdata.rows(c, '''SELECT b.bus_id FROM dim_bus b
    JOIN bridge_bus_pnode p ON p.bus_id=b.bus_id AND p.link_rank=1
    WHERE b.latitude IS NOT NULL ORDER BY b.bus_id''')]
grid = {'headroom': busdata.rows(c, 'SELECT * FROM fact_headroom'),
        'constraints': busdata.rows(c, 'SELECT * FROM fact_limiting_element')}
Path(a.out).write_text(json.dumps(busdata.clean({'buses': buses, 'grid': grid})), encoding='utf-8')
print(f'{len(buses)} buses, {len(grid["headroom"])} headroom rows, {len(grid["constraints"])} constraint rows -> {a.out}')
