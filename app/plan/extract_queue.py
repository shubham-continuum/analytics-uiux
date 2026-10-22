"""One-off, read-only extraction of the ISO-NE public queue register for the Queue dashboard.

Source: the GridSense store C:/GridSense/GridSense_one.duckdb, tables acquired.queue (1,751 records scraped
from irtt.iso-ne.com/reports/external, all 31 published columns) and acquired.queue_poi_match (the POI-name
join to held substations; coordinates copied from the matched substation only when a county or state fence
held). Opened READ_ONLY; nothing is written back. Output: preview/data/queue-register.json.

Run:  python plan/extract_queue.py
"""
import datetime as dt
import hashlib
import json
from pathlib import Path

import duckdb

STORE = Path('C:/GridSense/GridSense_one.duckdb')
OUT = Path(__file__).resolve().parent.parent / 'data' / 'queue-register.json'
COLUMNS = ['row', 'qp', 'cluster', 'type', 'requested', 'fuel', 'net_mw', 'summer_mw', 'winter_mw', 'county', 'state',
           'op_date', 'sync_date', 'wd_date', 'poi', 'serv', 'i39', 'to_report', 'zone', 'sis_status', 'fac_status',
           'ia_status', 'project_status', 'status', 'jurisdiction', 'updated', 'tier', 'lat', 'lon', 'matched_name',
           'coordinate_source']
SQL = """
SELECT q.source_row, q.qp, q.cluster, q.type, q.requested, q.fuel_type, q.net_mw, q.summer_mw, q.winter_mw, q.county, q.state,
       q.op_date, q.sync_date, q.wd_date, q.poi, q.serv, q.i39, q.to_report, q.zone, q.sis_status, q.fac_status,
       q.ia_status, q.project_status, q.status, q.jurisdiction, q.updated,
       m.tier, m.matched_latitude, m.matched_longitude, m.matched_name, m.coordinate_source
FROM acquired.queue q LEFT JOIN acquired.queue_poi_match m ON m.source_row = q.source_row
ORDER BY q.source_row
"""


def val(v):
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()[:10]
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def main():
    con = duckdb.connect(str(STORE), read_only=True)
    try:
        rows = [[val(v) for v in r] for r in con.execute(SQL).fetchall()]
        n_match = con.execute('SELECT count(*) FROM acquired.queue_poi_match').fetchone()[0]
    finally:
        con.close()
    assert len(rows) == 1751, f'expected the 1,751-record register, got {len(rows)}'
    assert n_match == len(rows), 'every register record must have exactly one POI-match row'
    body = json.dumps(rows, separators=(',', ':'), ensure_ascii=False)
    st = STORE.stat()
    out = {
        'meta': {
            'source': 'GridSense store register (acquired.queue + acquired.queue_poi_match), read-only',
            'file': str(STORE), 'fileModifiedAt': dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).isoformat(),
            'publisher': 'ISO-NE public interconnection queue, irtt.iso-ne.com/reports/external (all 31 published columns)',
            'latestUpdated': max(r[COLUMNS.index('updated')] or '' for r in rows),
            'extractedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'records': len(rows),
            'sha256': hashlib.sha256(body.encode('utf-8')).hexdigest(),
            'statusKey': {'A': 'Active', 'C': 'Commercial / in service', 'W': 'Withdrawn'},
            'tierNote': 'POI name matched to a held substation. exact/normalised = the name itself; contained_county = '
                        'held name inside the POI text with county and state agreeing; contained_state = state agrees only; '
                        'fuzzy_state = spelling variant in the same state. Coordinates are the matched substation\'s, copied, '
                        'and only where a fence held; no_match / contained_only / no_poi_text carry none.',
        },
        'columns': COLUMNS,
        'rows': rows,
    }
    OUT.write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False), encoding='utf-8')
    print(f'wrote {OUT} · {len(rows)} records · {OUT.stat().st_size:,} bytes')


if __name__ == '__main__':
    main()
