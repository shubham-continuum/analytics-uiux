"""Economics: how the PCR market model runs storage (read-only). GET /api/x/economicsesr/esr/<bus>.

Source: unified fact_pcr_esr (hourly dispatch_mw, lmp, soc and limits) × dim_pcr_resource (name, zone, lat/lon,
econ_max_mw, esr_max_storage_mwh) for the batteries and pumped-storage units modelled in PCR 2030 / 2035 / 2040.

Sign and price checks made on 2026-10-01 (not assumed):
- dispatch_mw > 0 is DISCHARGE: SOC falls by exactly the MW discharged (slope −1.000 in every run); when
  dispatch_mw < 0 SOC rises by about 0.78 × |MW| (the modelled charging efficiency). soc is the END-of-hour SOC.
- lmp equals fact_fcst_lmp_hourly.lmp at the resource's mapped bus to the cent (14 resources map; mean |Δ| = 0), so it is
  the run's total LMP. The PROBE trap is the CONGESTION component's sign (runs store LMP = E − C + L); the total LMP
  needs no normalisation and no component is used here.
- Latitude/longitude 0.0 means "not held" (returned as None). Zone 'Multiple' = an ISO-wide placeholder resource.

Per resource and run: hours, days, MWh discharged and charged, Σ dispatch × LMP (net, $), revenue from discharge,
cost of charging, the same net summed day by day (a second path, for the trace check), mean daily SOC swing,
hours at full and at empty, SOC at the start and end, and the gross daily spread ceiling at the unit's own duration
k = round(MWh ÷ MW) (1–12 h): Σ over days of (mean of the k dearest − the k cheapest hourly LMPs) × MWh, the same
definition as the Storage revenue tab's arbitrage ceiling. Parameterised SQL only; None = not held.
"""
import busdata

ZONE_LABEL = {'.Z.MAINE': 'ME', '.Z.NEWHAMPSHIRE': 'NH', '.Z.VERMONT': 'VT', '.Z.CONNECTICUT': 'CT', '.Z.RHODEISLAND': 'RI',
              '.Z.SEMASS': 'SEMA', '.Z.WCMASS': 'WCMA', '.Z.NEMASSBOST': 'NEMA'}
_CACHE = {}


def _units(c):
    if 'units' in _CACHE: return _CACHE['units']
    res = busdata.rows(c, '''SELECT r.bidder_index, r.resource_name, r.unit_type, r.fuel, trim(r.zone) AS zone,
                                    nullif(r.latitude, 0) AS lat, nullif(r.longitude, 0) AS lon, r.econ_min_mw, r.econ_max_mw, r.esr_max_storage_mwh
                             FROM dim_pcr_resource r WHERE r.bidder_index IN (SELECT DISTINCT bidder_index FROM fact_pcr_esr)''')
    runs = busdata.rows(c, '''
        WITH u AS (SELECT bidder_index, greatest(1, least(12, round(esr_max_storage_mwh / nullif(econ_max_mw, 0)))) AS k,
                          esr_max_storage_mwh AS mwh FROM dim_pcr_resource),
             e AS (SELECT e.*, u.k, u.mwh,
                          row_number() OVER (PARTITION BY scenario, e.bidder_index, study_date ORDER BY lmp DESC) AS rd,
                          row_number() OVER (PARTITION BY scenario, e.bidder_index, study_date ORDER BY lmp) AS ra
                   FROM fact_pcr_esr e JOIN u USING (bidder_index)),
             d AS (SELECT scenario, bidder_index, study_date, any_value(k) AS k, any_value(mwh) AS mwh,
                          sum(dispatch_mw * lmp) AS net, max(soc) - min(soc) AS swing,
                          avg(lmp) FILTER (WHERE rd <= k) - avg(lmp) FILTER (WHERE ra <= k) AS tb
                   FROM e GROUP BY 1, 2, 3)
        SELECT d.scenario, d.bidder_index, any_value(d.k) AS k, count(*) AS days, sum(d.net) AS net_daysum,
               avg(d.swing) AS swing_mean, sum(d.tb * d.mwh) AS ceiling, avg(d.tb) AS tb_mean
        FROM d GROUP BY 1, 2''')
    tot = busdata.rows(c, '''
        SELECT scenario, bidder_index, count(*) AS hours,
               sum(dispatch_mw) FILTER (WHERE dispatch_mw > 0) AS dis_mwh, -sum(dispatch_mw) FILTER (WHERE dispatch_mw < 0) AS ch_mwh,
               sum(dispatch_mw * lmp) AS net, sum(dispatch_mw * lmp) FILTER (WHERE dispatch_mw > 0) AS rev_dis,
               -sum(dispatch_mw * lmp) FILTER (WHERE dispatch_mw < 0) AS cost_ch,
               max(soc_max) AS soc_cap, avg(soc) AS soc_mean,
               count(*) FILTER (WHERE soc >= soc_max - 1e-3) AS h_full, count(*) FILTER (WHERE soc <= soc_min + 1e-3) AS h_empty,
               count(*) FILTER (WHERE dispatch_mw > 1e-6) AS h_dis, count(*) FILTER (WHERE dispatch_mw < -1e-6) AS h_ch,
               arg_min(soc, (study_date, hour)) AS soc_first, arg_max(soc, (study_date, hour)) AS soc_last,
               avg(lmp) AS lmp_mean
        FROM fact_pcr_esr GROUP BY 1, 2''')
    key = {(r['scenario'], r['bidder_index']): r for r in runs}
    out = [{**t, **{k: v for k, v in key.get((t['scenario'], t['bidder_index']), {}).items() if k not in ('scenario', 'bidder_index')}} for t in tot]
    _CACHE['units'] = (res, out)
    return _CACHE['units']


def esr(c, key):
    if key in ('all', 'hub'): return None
    k = busdata.link_of(c, key)  # the resolved price node (busdata.price_links, D-008)
    b = busdata.rows(c, '''SELECT b.bus_id, b.latitude AS lat, b.longitude AS lon, trim(b.load_zone) AS load_zone, p.zone_name
                           FROM dim_bus b LEFT JOIN dim_pnode p ON p.pnode_name = ?
                           WHERE b.bus_id = ?''', [k['pnode_name'] if k else None, int(key)])
    if not b: return None
    b = b[0]
    zone = ZONE_LABEL.get(b['zone_name']) or (b['load_zone'] if b['load_zone'] in ZONE_LABEL.values() else None)
    res, runs = _units(c)
    return {'key': key, 'bus': {'lat': b['lat'], 'lon': b['lon'], 'zone': zone}, 'resources': res, 'runs': runs,
            'source': 'unified fact_pcr_esr × dim_pcr_resource (PCR 2030 / 2035 / 2040 solved runs)',
            'rules': {'sign': 'dispatch_mw > 0 = discharge (checked: SOC falls 1:1 with discharge, rises ~0.78 × charge).',
                      'lmp': 'Total run LMP; equals fact_fcst_lmp_hourly at the mapped bus. No congestion component is used, so the run sign trap does not apply.',
                      'location': 'Latitude/longitude 0 in the source = not held. Zone "Multiple" = an ISO-wide placeholder resource.',
                      'ceiling': 'Σ days (mean of the k dearest − k cheapest hourly LMPs) × MWh, k = round(MWh ÷ MW): gross, perfect foresight, no efficiency.'}}


ROUTES = {'esr': esr}
