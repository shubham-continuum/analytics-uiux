"""Prices: five-minute real-time prices for the bus's load zone (read-only). GET /api/x/pricesintra/zone5/<bus|hub>.

Source: unified fact_lmp_5min (the ISO's .H.INTERNAL_HUB and eight .Z.* load-zone series, 2026 only). Checked
2026-10-01: ts is the interval START on the Eastern prevailing clock (2026-03-08 holds 276 intervals, the spring-forward
day), and the mean of an hour's twelve five-minute LMPs reproduces fact_lmp_hourly RT at the same ts to the cent.
Held months: Jan, Feb, Mar to the 26th, Jun and 1 Jul; April and May are NOT held. Zone-level, never nodal.

The bus's zone is its settled price node's zone (bridge_bus_pnode → dim_pnode.zone_name); where that is missing, the
bus's own dim_bus.load_zone when it names one of the eight zones. Otherwise not held (None → 404). 'hub' returns the hub.
Each clock hour is returned with its five-minute prices in time order and the published hourly RT LMP for the same
hour (fact_lmp_hourly), so the page can re-check the hourly averages independently. Parameterised SQL only.
"""
import busdata

HUB = '.H.INTERNAL_HUB'
ZONE_LABEL = {'.Z.MAINE': 'ME', '.Z.NEWHAMPSHIRE': 'NH', '.Z.VERMONT': 'VT', '.Z.CONNECTICUT': 'CT', '.Z.RHODEISLAND': 'RI',
              '.Z.SEMASS': 'SEMA', '.Z.WCMASS': 'WCMA', '.Z.NEMASSBOST': 'NEMA', HUB: 'Hub'}
BY_LABEL = {v: k for k, v in ZONE_LABEL.items()}


def _zone(c, key):
    if key == 'hub': return HUB, 'hub'
    if key == 'all': return None, None
    k = busdata.link_of(c, key)  # the resolved link (D-008): a re-linked bus takes its NEW node's zone
    r = busdata.rows(c, '''SELECT p.zone_name, b.load_zone FROM dim_bus b LEFT JOIN dim_pnode p ON p.pnode_name = ?
                           WHERE b.bus_id = ?''', [k['pnode_name'] if k else None, int(key)])
    if not r: return None, None
    z, lz = r[0]['zone_name'], (r[0]['load_zone'] or '').strip()
    if z in ZONE_LABEL and z != HUB: return z, 'settled price node zone (bridge_bus_pnode → dim_pnode.zone_name)'
    if lz in BY_LABEL and lz != 'Hub': return BY_LABEL[lz], 'dim_bus.load_zone'
    return None, None


def zone5(c, key):
    pnode, how = _zone(c, key)
    if pnode is None: return None
    hours = busdata.rows(c, '''
        WITH f AS (SELECT strftime(ts, '%Y-%m-%d %H') AS h, list(lmp ORDER BY ts) AS p FROM fact_lmp_5min
                   WHERE pnode_name = ? AND lmp IS NOT NULL GROUP BY 1),
             o AS (SELECT strftime(ts, '%Y-%m-%d %H') AS h, avg(lmp) AS pub FROM fact_lmp_hourly
                   WHERE pnode_name = ? AND market = 'RT' AND ts >= '2026-01-01' AND ts < '2026-07-02' GROUP BY 1)
        SELECT f.h, f.p, o.pub FROM f LEFT JOIN o USING (h) ORDER BY f.h''', [pnode, pnode])
    if not hours: return None
    span = busdata.rows(c, 'SELECT min(ts) AS t0, max(ts) AS t1, count(*) AS n FROM fact_lmp_5min WHERE pnode_name = ?', [pnode])[0]
    return {'key': key, 'pnode': pnode, 'zone': ZONE_LABEL[pnode], 'zoneFrom': how,
            'hours': [[r['h'], [round(v, 4) for v in r['p']], r['pub']] for r in hours],
            'first': span['t0'], 'last': span['t1'], 'intervals': span['n'],
            'source': 'unified fact_lmp_5min (src ISONE_2026.db) · published hourly RT from fact_lmp_hourly',
            'rules': {'clock': 'ts = interval start, Eastern prevailing clock; an hour key is YYYY-MM-DD HH of the interval start.',
                      'scope': 'Zone-level (.Z.* series), 2026 H1 only; April and May 2026 are not held.'}}


ROUTES = {'zone5': zone5}
