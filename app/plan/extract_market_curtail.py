"""One-off, read-only extraction: modelled solar and wind curtailment per resource from the PCR runs.

Source: the unified DuckDB (busdata.connect(), read-only), fact_pcr_unit_hourly joined to dim_pcr_resource.
In these runs max_bid_mw = dispatch_mw + avail_mw for every solar and wind row (checked below), so avail_mw is
the offered energy the run did not take: curtailment of a zero-cost resource. The vendor curtailment ramps stay
excluded (data_quality: curtailment_sweeps excluded, "Rebuild from PCR runs"); this is that rebuild, at the
resource level. Writes preview/data/market-curtail.json. Parameterised SQL only; never writes to the database.

Run: python plan/extract_market_curtail.py
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import busdata  # noqa: E402

OUT = ROOT / 'data' / 'market-curtail.json'
TYPES = ['Solar', 'Wind', 'OSW']
TOL = 0.01  # MW: below this an hour is not counted as curtailed


def main():
    c = busdata.connect()
    ph = ', '.join('?' for _ in TYPES)
    runs = [r[0] for r in c.execute('SELECT DISTINCT scenario FROM fact_pcr_unit_hourly ORDER BY 1').fetchall()]
    hours = dict(c.execute('SELECT scenario, count(DISTINCT (study_date, hour)) FROM fact_pcr_unit_hourly GROUP BY 1').fetchall())
    rows = c.execute(f'''
        SELECT u.scenario, u.bidder_index, r.resource_name, r.unit_type, r.zone, r.state, r.latitude, r.longitude, r.econ_max_mw,
               s.bus_id AS pnode_bus,
               count(*) AS n_hours, sum(u.max_bid_mw) AS mwh_offered, sum(u.dispatch_mw) AS mwh_dispatched,
               sum(greatest(u.avail_mw, 0)) AS mwh_curtailed,
               sum(CASE WHEN u.avail_mw > ? THEN 1 ELSE 0 END) AS h_curtailed,
               sum(CASE WHEN u.avail_mw > ? AND u.lmp <= 0 THEN 1 ELSE 0 END) AS h_curtailed_nonpos,
               max(abs(u.max_bid_mw - u.dispatch_mw - u.avail_mw)) AS max_identity_gap,
               sum(CASE WHEN u.avail_mw < -? THEN 1 ELSE 0 END) AS n_negative_avail
        FROM fact_pcr_unit_hourly u
        JOIN dim_pcr_resource r USING (bidder_index)
        LEFT JOIN (SELECT pcr_pnode_index, min(bus_id) AS bus_id FROM stg_pcr_bus_pnode GROUP BY 1) s ON s.pcr_pnode_index = r.pnode_index
        WHERE r.unit_type IN ({ph})
        GROUP BY ALL ORDER BY 1, 4, 3''', [TOL, TOL, TOL] + TYPES).fetchall()
    cols = ['run', 'bidder', 'name', 'type', 'zone', 'state', 'lat', 'lon', 'econ_max_mw', 'pnode_bus', 'hours', 'mwh_offered',
            'mwh_dispatched', 'mwh_curtailed', 'h_curtailed', 'h_curtailed_nonpos', 'max_identity_gap', 'n_negative_avail']
    out_rows = []
    for r in rows:
        d = dict(zip(cols, r))
        out_rows.append([d[k] if not isinstance(d[k], float) else round(d[k], 3) for k in cols])
    gap = max((r[cols.index('max_identity_gap')] or 0) for r in out_rows) if out_rows else None
    neg = sum(r[cols.index('n_negative_avail')] or 0 for r in out_rows)
    res = {
        'provenance': 'unified ISONE_GridSense_unified.duckdb (read-only): fact_pcr_unit_hourly x dim_pcr_resource; bus by stg_pcr_bus_pnode where the run node maps',
        'built_at': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'runs': runs, 'runHours': hours, 'types': TYPES,
        'rules': {
            'curtailed': 'sum over run hours of avail_mw (= max_bid_mw - dispatch_mw): offered energy the run did not dispatch',
            'share': 'mwh_curtailed / mwh_offered, energy-weighted; OSW listed but offshore (no onshore bus proxy)',
            'hourCount': f'an hour counts as curtailed when avail_mw > {TOL} MW; nonpos = the resource LMP <= $0 in that hour',
        },
        'identity': {'max_abs_gap_mw': gap, 'negative_avail_rows': neg,
                     'statement': 'max_bid_mw - dispatch_mw - avail_mw, largest absolute value over every row extracted'},
        'cols': cols, 'rows': out_rows,
    }
    OUT.write_text(json.dumps(res, separators=(',', ':')), encoding='utf-8')
    print(f'wrote {OUT} rows={len(out_rows)} identity_gap={gap} negative_avail={neg}')


if __name__ == '__main__':
    main()
