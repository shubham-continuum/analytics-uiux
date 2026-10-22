"""Reproducible preview-only export. Upstream DuckDB is opened READ_ONLY.

S2-D (2026-10-06): the price link comes from busdata.price_links (D-008) and the forecast sign from
api_common.to_isone_sign via busdata.fcst_record; no flip and no link query of its own. SQL parameterised.
"""
import calendar
import datetime as dt
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
import duckdb

import busdata

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parents[1] / 'unified' / 'ISONE_GridSense_unified.duckdb'
BUSES = [111403, 100178, 100179, 114417, 111209, 111214]

def clean(value):
    if isinstance(value, float) and not math.isfinite(value): return None
    if isinstance(value, (dt.date, dt.datetime)): return value.isoformat()
    if isinstance(value, dict): return {k: clean(v) for k,v in value.items()}
    if isinstance(value, (tuple,list)): return [clean(v) for v in value]
    return value

def rows(c,sql,params=[]):
    result=c.execute(sql,params)
    names=[x[0] for x in result.description]
    return [dict(zip(names,row)) for row in result.fetchall()]

def historical_stamp(ts, occurrence):
    """Inferred Eastern clock. Fold order is unresolved by source; preserve row order."""
    march=dt.datetime(ts.year,3,1)
    spring=march+dt.timedelta(days=(6-march.weekday())%7+7,hours=2)
    november=dt.datetime(ts.year,11,1)
    autumn=november+dt.timedelta(days=(6-november.weekday())%7,hours=2)
    summer=spring <= ts < autumn
    if ts.date()==autumn.date() and ts.hour==1 and occurrence: summer=False
    return ts.isoformat()+('-04:00' if summer else '-05:00')

def main():
    c=duckdb.connect(str(SOURCE),read_only=True)
    nodes=rows(c,'SELECT * FROM dim_bus WHERE bus_id IN (SELECT unnest(?::BIGINT[])) ORDER BY bus_id',[BUSES])
    for n in nodes:
        n.update(id=str(n['bus_id']),name=n['bus_name'],priceMapping=busdata.link_of(c,n['bus_id']))
    nodes.append({'id':'hub','name':'ISO-NE Internal Hub','priceMapping':{'pnode_name':'.H.INTERNAL_HUB','tier':'hub'}})
    series=[]
    for node in nodes:
        raw=c.execute('SELECT ts,market,lmp,energy,congestion,loss FROM fact_lmp_hourly WHERE pnode_name=? ORDER BY ts', [node['priceMapping']['pnode_name']]).fetchall()
        groups=defaultdict(list)
        seen=defaultdict(int)
        for ts,market,price,energy,congestion,loss in raw:
            key=(ts,market)
            stamp=historical_stamp(ts,seen[key]); seen[key]+=1
            groups[(market,ts.year)].append([stamp,price,None,energy,congestion,loss])
        for (market,year),records in groups.items():
            expected=8784 if calendar.isleap(year) else 8760
            valid=sum(r[1] is not None and math.isfinite(r[1]) for r in records)
            series.append({'nodeId':node['id'],'mode':'historical','market':market,'year':year,'run':'settled','intervalHours':1,'records':records,'source':'fact_lmp_hourly','expectedHours':expected,'observedHours':valid,'complete':valid==expected,'coverage':valid/expected,'timezone':'America/New_York inferred; autumn fold order unresolved in source'})
    runs={r['scenario']:r for r in rows(c,"SELECT * FROM dim_scenario WHERE kind='forecast'")}
    for node in nodes:
        bid=80000 if node['id']=='hub' else int(node['id'])
        raw=c.execute('SELECT scenario,study_date,hour,lmp,congestion,loss FROM fact_fcst_lmp_hourly WHERE bus_id=? ORDER BY scenario,study_date,hour',[bid]).fetchall()
        groups=defaultdict(list)
        for run,day,hour,price,congestion,loss in raw:
            groups[run].append(busdata.fcst_record(day,hour,price,congestion,loss))
        for run,records in groups.items():
            year=runs[run]['target_year'];expected=8784 if calendar.isleap(year) else 8760
            valid=sum(r[1] is not None and math.isfinite(r[1]) for r in records)
            series.append({'nodeId':node['id'],'mode':'forecast','market':'model','year':year,'run':run,'runDescription':runs[run]['description'],'intervalHours':1,'records':records,'source':'fact_fcst_lmp_hourly','expectedHours':expected,'observedHours':valid,'complete':valid==expected,'coverage':valid/expected,'timezone':'Not recorded; flat modeled calendar, timestamps have no UTC offset'})
    grid={'headroom':rows(c,'SELECT * FROM fact_headroom WHERE bus_id IN (SELECT unnest(?::BIGINT[]))',[BUSES]),'constraints':rows(c,'SELECT * FROM fact_limiting_element WHERE bus_id IN (SELECT unnest(?::BIGINT[]))',[BUSES]),'source':'unified.fact_headroom / fact_limiting_element','coverageNote':'Stored thermal screening only; voltage, stability, protection, breaker duty and affected-system studies not provided.'}
    coverage=[{k:v for k,v in s.items() if k not in ['records']} for s in series]
    result={'metadata':{'createdAt':dt.datetime.now(dt.timezone.utc).isoformat(),'sources':[{'file':str(SOURCE),'mode':'read_only','bytes':SOURCE.stat().st_size,'modifiedAt':dt.datetime.fromtimestamp(SOURCE.stat().st_mtime,dt.timezone.utc).isoformat()}],'coverage':coverage,'recordColumns':['timestamp','price','generation (not supplied)','energy','congestion','loss'],'componentConvention':'LMP = energy + congestion + loss; forecast stored congestion negated on export','historicalTimeNote':'Source lacks timezone/fold indicator. Eastern offsets inferred from calendar, repeated fall hour retained as two observations; order of the two fold prices is not verified.','generationNote':'No project generation measurements supplied. Any generation profile must be labeled user assumption.','forecastNote':'Individual model runs; not RT or DA and not interchangeable scenarios. Missing calendar hours are not filled.','isolation':'Runtime uses this independent JSON only; no source store connection.'},'nodes':nodes,'series':series,'grid':grid}
    target=ROOT/'data'/'snapshot.json'
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(clean(result),separators=(',',':'),allow_nan=False),encoding='utf-8')
    (ROOT/'data'/'coverage.json').write_text(json.dumps(clean(result['metadata']),indent=2),encoding='utf-8')
    print(json.dumps({'file':str(target),'bytes':target.stat().st_size,'series':len(series),'records':sum(len(s['records']) for s in series),'headroom':len(grid['headroom']),'constraints':len(grid['constraints']),'sha256':hashlib.sha256(target.read_bytes()).hexdigest()}))

if __name__=='__main__':main()
