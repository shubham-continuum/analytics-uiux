"""Convert the older GridSense store (ISONE_GridSense.duckdb) into the unified schema One Studio reads.

Provenance: 2026-10-22 · one-studio-devkit/tools · v1

    python3.13 tools/convert_legacy_db.py --src ~/Downloads/ISONE_GridSense.duckdb \
        --out ~/Downloads/unified/ISONE_GridSense_converted.duckdb [--no-fold-fill]

The source is attached READ_ONLY and never written. The output is built in <out>.tmp and renamed into place.

What is converted (old table -> unified relation):
  substations_corrected            -> dim_substation, fact_headroom (5 cases), the 2,678-bus geolocated spine of dim_bus
  bus_master (+ bus, node_xref, pnode_ref, branches) -> dim_bus
  node_xref (exact | shared_substation) + nearest pnode_ref -> bridge_bus_pnode (direct | same_substation | geo_proxy)
  pnode_ref (+ node_xref names)    -> dim_pnode (zone_id 4001..4008 -> .Z.* zone names)
  branches / generators / loads    -> dim_branch / dim_generator / dim_load
  constraints_{sp,sll}_sub_{dis,chg} -> fact_limiting_element (sll_sub_dis keeps the unified store's 'shoulder|discharge' label)
  queue_projects                   -> dim_queue
  lmp_hourly_hist (RT 2020-01-01 .. 2026-04-28) -> fact_lmp_hourly (+ pn_* marts computed here); location ids 4000-4008
                                   (no name in pnode_ref) are the ISO-NE hub and eight load zones and are named here
  lmp_hourly_fcst (5yr, 10yr)      -> fact_fcst_lmp_hourly (+ mart_bus_fcst_* computed here), stored PROBE sign kept
Not in the old store (created EMPTY with the unified columns, so endpoints answer "not held" instead of failing):
  DA prices, the PCR runs (pcr2030/35/40) and every PCR table, settled constraints, reserve prices, fuel mix, load,
  interchange, 5-minute prices, transformers, retirements, planned upgrades.
One documented fill (switch off with --no-fold-fill):
  fold fill  : the old store keeps ONE reading for the repeated autumn 01:00 hour; ISO-NE publishes two. The single
               reading is repeated so a full year counts 8,760 / 8,784 intervals, as the app's completeness rule expects.
"""
import argparse
import datetime as dt
import gzip
import json
import math
import os
import time
from pathlib import Path

import duckdb

VERSION = 'convert_legacy_db v1 (2026-10-22)'
ZONE_OF_ZID = {4001: ('ME', '.Z.MAINE'), 4002: ('NH', '.Z.NEWHAMPSHIRE'), 4003: ('VT', '.Z.VERMONT'), 4004: ('CT', '.Z.CONNECTICUT'),
               4005: ('RI', '.Z.RHODEISLAND'), 4006: ('SEMA', '.Z.SEMASS'), 4007: ('WCMA', '.Z.WCMASS'), 4008: ('NEMA', '.Z.NEMASSBOST')}
HUB = '.H.INTERNAL_HUB'
# ISO-NE standard location ids of the hub and the eight load zones. The old store holds their RT series under these ids
# with no name in pnode_ref; checked against the recorded unified hub series (hour for hour) and zone means (to the cent).
ISO_LOCATIONS = {4000: HUB, **{k: v[1] for k, v in ZONE_OF_ZID.items()}}
STATE_CODE = {'Massachusetts': 'MA', 'Maine': 'ME', 'New Hampshire': 'NH', 'Vermont': 'VT', 'Connecticut': 'CT', 'Rhode Island': 'RI',
              'New York': 'NY'}
SINGLE_ZONE_STATE = {'Maine': 'ME', 'New Hampshire': 'NH', 'Vermont': 'VT', 'Connecticut': 'CT', 'Rhode Island': 'RI', 'New York': 'ME'}
# The pipeline's zone for a node: its RSP subarea's load zone (not the node's operator zone_id; RI's subarea reaches into MA).
RSP_ZONE = {'ME': 'ME', 'SME': 'ME', 'BHE': 'ME', 'NH': 'NH', 'VT': 'VT', 'CT': 'CT', 'SWCT': 'CT', 'NOR': 'CT', 'RI': 'RI', 'SEMA': 'SEMA',
            'BOSTON': 'NEMA', 'CMA/NEMA': 'NEMA', 'WMA': 'WCMA'}
# The pipeline's county lookup (matched on the county name alone, any state).
COUNTY_ZONE = {'Barnstable': 'SEMA', 'Bristol': 'SEMA', 'Dukes': 'SEMA', 'Nantucket': 'SEMA', 'Plymouth': 'SEMA', 'Berkshire': 'WCMA', 'Franklin': 'WCMA',
               'Hampden': 'WCMA', 'Hampshire': 'WCMA', 'Worcester': 'WCMA', 'Essex': 'NEMA', 'Middlesex': 'NEMA', 'Norfolk': 'NEMA', 'Suffolk': 'NEMA'}
AREA_CODE = {'ISO-NE': '101', 'NYISO': '102', 'TE': '104', 'NB': '105'}
RUN_YEAR = {'5yr': 2028, '10yr': 2035}
R_KM = 6371.0088  # IUGG mean Earth radius; reproduces the unified geo-proxy distances
CASES = [('summer_peak', 'discharge', 'Summer Peak NCIS Substation Discharging'), ('summer_peak', 'charge', 'Summer Peak NCIS Substation Charging'),
         ('shoulder', 'discharge', 'Shoulder NCIS Substation Discharging'), ('shoulder', 'charge', 'Shoulder NCIS Substation Charging'),
         ('large_load', 'charge', 'Summer Peak Large Load Interconnection Substation Charging')]
LE_TABLES = [('constraints_sp_sub_dis', 'summer_peak', 'discharge', 'Power Injection (MW)'),
             ('constraints_sp_sub_chg', 'summer_peak', 'charge', 'Power Withdrawal (MW)'),
             ('constraints_sll_sub_dis', 'shoulder', 'discharge', 'Power Injection (MW)'),
             ('constraints_sll_sub_chg', 'large_load', 'charge', 'Power Withdrawal (MW)')]

EMPTY = {
    'dim_transformer': 'from_transformer_number VARCHAR, from_transformer_name VARCHAR, to_transformer_number VARCHAR, to_transformer_name VARCHAR, '
                       'transformer_voltage VARCHAR, circuit VARCHAR, status VARCHAR, rated_mva_limit_a DOUBLE, rated_mva_limit_b DOUBLE',
    'dim_retirement': 'year VARCHAR, month VARCHAR, plant_name VARCHAR, resource_id VARCHAR, load_zone VARCHAR, net_capacity_mw VARCHAR, '
                      'plant_county VARCHAR, plant_state VARCHAR, latitude VARCHAR, longitude VARCHAR, source_row_number BIGINT',
    'dim_transmission_upgrade': 'transmission_upgrade VARCHAR, from_substation_name VARCHAR, to_substation_name VARCHAR, nominal_voltage_kv VARCHAR, '
                                'expected_in_service_year VARCHAR, category VARCHAR, from_latitude VARCHAR, from_longitude VARCHAR, '
                                'to_latitude VARCHAR, to_longitude VARCHAR, source_row_number BIGINT',
    'dim_substation_upgrade': 'substation_name VARCHAR, substation_upgrade VARCHAR, nominal_voltage_kv VARCHAR, expected_in_service_year VARCHAR, '
                              'category VARCHAR, latitude VARCHAR, longitude VARCHAR, source_row_number BIGINT',
    'fact_lmp_5min': 'pnode_name VARCHAR, ts TIMESTAMP, lmp DOUBLE',
    'fact_constraint_hourly': 'constraint_name VARCHAR, market VARCHAR, ts TIMESTAMP, shadow_price DOUBLE',
    'fact_as_price_hourly': 'ts TIMESTAMP, region VARCHAR, product VARCHAR, price DOUBLE',
    'fact_genfuel_hourly': 'ts TIMESTAMP, fuel_type VARCHAR, generation_mw DOUBLE',
    'fact_load_hourly': 'ts TIMESTAMP, zone VARCHAR, load_mw DOUBLE',
    'fact_load_forecast': 'ts TIMESTAMP, zone VARCHAR, forecast_mw DOUBLE',
    'fact_interchange_hourly': 'interface VARCHAR, ts TIMESTAMP, flow_mw DOUBLE',
    'dim_pcr_resource': 'bidder_index BIGINT, pnode_index BIGINT, resource_name VARCHAR, unit_type VARCHAR, fuel VARCHAR, zone VARCHAR, state VARCHAR, '
                        'latitude FLOAT, longitude FLOAT, econ_min_mw DOUBLE, econ_max_mw DOUBLE, esr_max_storage_mwh DOUBLE',
    'stg_pcr_bus_pnode': 'bus_id BIGINT, pcr_pnode_index BIGINT, pcr_pnode_name VARCHAR, pcr_zone VARCHAR',
    'fact_pcr_binding_hourly': 'scenario VARCHAR, study_date DATE, hour INTEGER, constr_index BIGINT, monitored_facility VARCHAR, contingency VARCHAR, '
                               'shadow_price DOUBLE, constraint_limit DOUBLE',
    'fact_pcr_cong_impact': 'scenario VARCHAR, constr_index BIGINT, study_date DATE, hour INTEGER, bidder_index BIGINT, shadow_price DOUBLE, dfax DOUBLE',
    'fact_pcr_flowgate_hourly': 'scenario VARCHAR, flowgate_name VARCHAR, study_date DATE, hour INTEGER, shadow_price DOUBLE, flow_mw DOUBLE, max_flow DOUBLE',
    'fact_pcr_unit_hourly': 'scenario VARCHAR, bidder_index BIGINT, study_date DATE, hour INTEGER, max_bid_mw DOUBLE, dispatch_mw DOUBLE, avail_mw DOUBLE, '
                            'uc_status VARCHAR, lmp DOUBLE',
    'fact_pcr_esr': 'scenario VARCHAR, bidder_index BIGINT, study_date DATE, hour INTEGER, dispatch_mw DOUBLE, lmp DOUBLE, soc DOUBLE, soc_max DOUBLE, soc_min DOUBLE',
}


def log(msg, t0=[time.time()]):
    print(f'[{time.time() - t0[0]:7.1f}s] {msg}', flush=True)


def hav_km(la1, lo1, la2, lo2):
    la1, lo1, la2, lo2 = map(math.radians, (la1, lo1, la2, lo2))
    a = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_KM * math.asin(min(1.0, math.sqrt(a)))


def fall_back(year):
    """Repeated 01:00 hour: first Sunday of November (US rule since 2007)."""
    nov = dt.date(year, 11, 1)
    return dt.datetime.combine(nov + dt.timedelta(days=(6 - nov.weekday()) % 7), dt.time(1))


def build_links(c):
    """bridge_bus_pnode rows: node_xref links (exact -> direct, shared_substation -> same_substation), ranked exact first,
    LD before UN, then name (the unified data_quality rule); spine buses with no xref get the nearest pnode_ref node
    (geo_proxy), ties broken by the node table's stored order. D-008 re-linking stays a runtime rule (busdata.price_links)."""
    spine = c.execute('SELECT bus_id, latitude, longitude FROM spine').fetchall()
    xref = {}
    for b, p, m, cf, n in c.execute('SELECT bus_id, pnode_name, match_method, confidence, buses_at_substation FROM src.node_xref').fetchall():
        xref.setdefault(int(b), []).append((p, m, cf, n))
    nodes = c.execute('SELECT pnode_name, lat, lon FROM src.pnode_ref WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY rowid').fetchall()
    cls = lambda p: 0 if p.startswith('LD.') else 1 if p.startswith('UN.') else 2
    out = []
    for b, la, lo in spine:
        b = int(b)
        if b in xref:
            ranked = sorted(xref[b], key=lambda x: (x[2] != 'exact', cls(x[0]), x[0]))
            for i, (p, m, cf, n) in enumerate(ranked, 1):
                out.append((b, p, 'direct' if cf == 'exact' else 'same_substation', m, 0.0, n, i))
        else:
            best = min(range(len(nodes)), key=lambda i: (round(hav_km(la, lo, nodes[i][1], nodes[i][2]), 9), i))
            out.append((b, nodes[best][0], 'geo_proxy', 'nearest_lat_lon', round(hav_km(la, lo, nodes[best][1], nodes[best][2]), 3), None, 1))
    return out


def convert(src, out, fold_fill=True):
    src, out = Path(src).resolve(), Path(out).resolve()
    if not src.is_file():
        raise SystemExit(f'ERROR: source not found: {src}')
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix('.duckdb.tmp')
    if tmp.exists():
        tmp.unlink()
    c = duckdb.connect(str(tmp))
    c.execute("SET preserve_insertion_order = true")
    c.execute(f"ATTACH '{str(src).replace(chr(39), chr(39) * 2)}' AS src (READ_ONLY)")
    log(f'attached {src} read-only')

    # ── spine and substations ──────────────────────────────────────────────────────────────────────────
    hc = lambda case: f'"Headroom Capacity (MW) {case}_gcd"'
    pc = lambda case: f'"# Pre-existing Issues {case}_gcd"'
    c.execute('''CREATE TEMP TABLE spine AS
        SELECT CAST("Substation Bus Number_gcd" AS BIGINT) AS bus_id, try_cast(Latitude AS DOUBLE) AS latitude, try_cast(Longitude AS DOUBLE) AS longitude
        FROM src.substations_corrected''')
    state_case = ' '.join(f"WHEN '{k}' THEN '{v}'" for k, v in STATE_CODE.items())
    c.execute(f'''CREATE TABLE dim_substation AS
        SELECT CAST("Substation Bus Number_gcd" AS BIGINT) AS bus_id, "Substation Name_gcd" AS substation_name, "Substation Model Identifier_gcd" AS model_id,
               "Substation Area_gcd" AS area, try_cast("Nominal Voltage (KV)_gcd" AS DOUBLE) AS nominal_kv, "County_gcd" AS county, "State_gcd" AS state_name,
               CAST(try_cast("FIPS Code_gcd" AS BIGINT) AS VARCHAR) AS fips, try_cast(Latitude AS DOUBLE) AS latitude, try_cast(Longitude AS DOUBLE) AS longitude,
               "Confidence level_gcd" AS vendor_confidence, try_cast("No of Transformer" AS DOUBLE) AS transformers,
               try_cast("No of Transformer 3-Windings" AS DOUBLE) AS transformers_3w, try_cast("No of Transmission Line" AS DOUBLE) AS transmission_lines,
               try_cast("Total no of Outlets" AS DOUBLE) AS total_outlets,
               try_cast("3 Phase Short Circuit (MVA)_gcd" AS DOUBLE) AS short_circuit_mva_published,
               try_cast("3 Phase Short Circuit Current (AMPS)_gcd" AS DOUBLE) AS short_circuit_amps,
               round(sqrt(3) * try_cast("Nominal Voltage (KV)_gcd" AS DOUBLE) * try_cast("3 Phase Short Circuit Current (AMPS)_gcd" AS DOUBLE) / 1000, 1) AS short_circuit_mva,
               try_cast("Maximum MW Injection_CCIS _gcd" AS DOUBLE) AS max_injection_ccis_mw,
               CASE "State_gcd" {state_case} END AS state_code
        FROM src.substations_corrected''')
    c.execute('CREATE TABLE fact_headroom AS ' + ' UNION ALL '.join(
        f'''SELECT CAST("Substation Bus Number_gcd" AS BIGINT) AS bus_id, '{s}' AS scenario, '{d}' AS direction,
                   try_cast({hc(case)} AS DOUBLE) AS headroom_mw, try_cast({pc(case)} AS DOUBLE) AS pre_existing_issues FROM src.substations_corrected'''
        for s, d, case in CASES) + ' ORDER BY bus_id, scenario, direction')
    log('dim_substation, fact_headroom')

    # ── price nodes and links ─────────────────────────────────────────────────────────────────────────
    zcase = ' '.join(f"WHEN {k} THEN '{v[1]}'" for k, v in ZONE_OF_ZID.items())
    c.execute(f'''CREATE TABLE dim_pnode AS
        SELECT pnode_name, CASE zone_id {zcase} END AS zone_name, lat AS latitude, lon AS longitude FROM src.pnode_ref
        UNION ALL SELECT DISTINCT x.pnode_name, NULL, NULL, NULL FROM src.node_xref x WHERE x.pnode_name NOT IN (SELECT pnode_name FROM src.pnode_ref)
        UNION ALL SELECT * FROM (VALUES ('{HUB}', NULL::VARCHAR, NULL::DOUBLE, NULL::DOUBLE)) h(a,b,c,d)
        UNION ALL SELECT z, z, NULL, NULL FROM (VALUES {', '.join(f"('{v[1]}')" for v in ZONE_OF_ZID.values())}) t(z)''')
    links = build_links(c)
    c.execute('CREATE TABLE bridge_bus_pnode (bus_id BIGINT, pnode_name VARCHAR, tier VARCHAR, method VARCHAR, distance_km DOUBLE, buses_at_substation INTEGER, link_rank INTEGER)')
    c.executemany('INSERT INTO bridge_bus_pnode VALUES (?, ?, ?, ?, ?, ?, ?)', links)
    c.execute('''CREATE VIEW bus_link AS
        WITH r AS (SELECT * FROM bridge_bus_pnode WHERE link_rank = 1)
        SELECT r.bus_id, r.pnode_name, r.tier AS price_tier, r.distance_km AS price_proxy_km,
               count(*) OVER (PARTITION BY r.pnode_name) AS buses_sharing_series FROM r''')
    log(f'dim_pnode, bridge_bus_pnode ({len(links):,} links)')

    # ── buses ─────────────────────────────────────────────────────────────────────────────────────────
    # Load zone, reproducing the GridSense pipeline rule the unified store carries (its dim_bus.load_zone equals the pipeline's
    # bus_zone on all 2,678 buses): the RSP-subarea zone of ONE representative node per bus (node_xref: exact first, then fewest buses at the
    # substation, then lowest location id) -> source pnode; else a county-name lookup -> county; else the state -> state.
    # Known quirks kept for parity and listed in data_quality: the county lookup ignores the state (Franklin ME/VT -> WCMA), the
    # representative node can be a far same-name node (D-008 buses), and the four New York buses carry ME.
    c.execute(f'''CREATE TEMP TABLE zone_pn AS
        WITH x AS (SELECT bus_id, location_id, row_number() OVER (PARTITION BY bus_id ORDER BY confidence <> 'exact', buses_at_substation, location_id) AS k
                   FROM src.node_xref)
        SELECT x.bus_id, CASE r.rsp_area {' '.join(f"WHEN '{k}' THEN '{v}'" for k, v in RSP_ZONE.items())} END AS zone, r.rsp_area, r.dispatch_zone
        FROM x JOIN src.pnode_ref r USING (location_id) WHERE x.k = 1''')
    c.execute('CREATE TEMP TABLE county_zone (county VARCHAR, zone VARCHAR)')
    c.executemany('INSERT INTO county_zone VALUES (?, ?)', list(COUNTY_ZONE.items()))
    single = ' '.join(f"WHEN '{k}' THEN '{v}'" for k, v in SINGLE_ZONE_STATE.items())
    area_case = ' '.join(f"WHEN '{k}' THEN '{v}'" for k, v in AREA_CODE.items())
    c.execute(f'''CREATE TEMP TABLE bus_area AS
        SELECT bus_id, min(code) AS pf_area FROM (
          SELECT from_bus_id AS bus_id, CASE from_area {area_case} END AS code FROM src.branches
          UNION ALL SELECT to_bus_id, CASE to_area {area_case} END FROM src.branches) WHERE bus_id IS NOT NULL GROUP BY 1''')
    c.execute(f'''CREATE TABLE dim_bus AS
        SELECT m.bus_id, m.bus_name, coalesce(s.substation_name, b.substation_name) AS substation_name, coalesce(s.model_id, b.substation_model) AS model_id,
               coalesce(s.nominal_kv, m.nominal_kv) AS nominal_kv, s.latitude, s.longitude, s.county, s.state_name, s.state_code,
               CASE WHEN s.bus_id IS NULL THEN NULL ELSE coalesce(z.zone, cz.zone, CASE s.state_name {single} END) END AS load_zone,
               CASE WHEN s.bus_id IS NULL THEN NULL WHEN z.zone IS NOT NULL THEN 'pnode' WHEN cz.zone IS NOT NULL THEN 'county'
                    WHEN (CASE s.state_name {single} END) IS NOT NULL THEN 'state' END AS load_zone_source,
               z.rsp_area, z.dispatch_zone, coalesce(a.pf_area, '101') AS pf_area, '0' AS pf_ba,
               coalesce(m.in_substations, false) AS is_vendor_substation, coalesce(m.in_bus, false) AS in_powerflow_model,
               NULL::BOOLEAN AS has_pcr_pnode, s.total_outlets, s.short_circuit_mva
        FROM src.bus_master m LEFT JOIN dim_substation s USING (bus_id) LEFT JOIN src.bus b USING (bus_id)
        LEFT JOIN zone_pn z USING (bus_id) LEFT JOIN county_zone cz ON cz.county = s.county
        LEFT JOIN bus_area a USING (bus_id) ORDER BY m.bus_id''')
    log('dim_bus')

    # ── network, queue, element study ─────────────────────────────────────────────────────────────────
    c.execute('''CREATE TABLE dim_branch AS SELECT branch_uid, line_name, from_bus_id, from_bus_name, to_bus_id, to_bus_name, circuit_id, voltage, status,
        rated_base_mva, rated_base_mva_1, from_area, to_area, from_latitude, from_longitude, to_latitude, to_longitude,
        headroom_capacity_branch_discharging, headroom_capacity_branch_charging, pre_existing_issues_branch_discharging, pre_existing_issues_branch_charging
        FROM src.branches''')
    c.execute('CREATE TABLE dim_generator AS SELECT bus_id, gen_uid, gen_name, id_code, status, gen_mw, max_capacity_mw, latitude, longitude FROM src.generators')
    c.execute('CREATE TABLE dim_load AS SELECT bus_id, load_name, id_code, load_mw, load_mva, zone, latitude, longitude FROM src.loads')
    c.execute('CREATE TABLE dim_queue AS SELECT * FROM src.queue_projects')
    c.execute('CREATE TABLE fact_limiting_element AS ' + ' UNION ALL '.join(
        f'''SELECT source_bus_id AS bus_id, '{s}' AS scenario, '{d}' AS direction, "Monitored Facility" AS monitored_facility,
                   "Binding Contingency" AS binding_contingency, "Contingency ID" AS contingency_id, try_cast("Voltage (KV) Monitored Facility" AS DOUBLE) AS kv,
                   "Zone Monitored Facility" AS zone, "Distribution Factor (Dfax)" AS dfax, "{xfer}" AS transfer_mw,
                   "Base Flow MW (No Transfer)" AS base_flow_mw, try_cast("Contingency Flow MW (No Transfer)" AS DOUBLE) AS contingency_flow_mw,
                   "Rated Base MVA Monitored Facility" AS rating_a_mva, "Rated Contingency MVA Monitored Facility" AS rating_c_mva,
                   "DC %Loading (No Transfer)" AS pct_loading_no_transfer, "Monitored Facility Length in Miles" AS length_miles,
                   "Total Refurbishment Cost ($ Million) to fix the Monitored Facility" AS fix_cost_musd, "Monitored Facility Type" AS facility_type
            FROM src.{t}''' for t, s, d, xfer in LE_TABLES))
    c.execute('''CREATE TABLE mart_bus_profile AS
        SELECT bus_id, arg_min(monitored_facility, transfer_mw) AS first_limit_facility, arg_min(binding_contingency, transfer_mw) AS first_limit_contingency,
               arg_min(dfax, transfer_mw) AS first_limit_dfax
        FROM fact_limiting_element WHERE scenario = 'summer_peak' AND direction = 'discharge' AND transfer_mw > 0
              AND abs(coalesce(pct_loading_no_transfer, 0)) < 100 GROUP BY 1''')
    log('dim_branch, dim_generator, dim_load, dim_queue, fact_limiting_element, mart_bus_profile')

    # ── settled prices ────────────────────────────────────────────────────────────────────────────────
    iso_locs = ', '.join(f"({k}, '{v}')" for k, v in ISO_LOCATIONS.items())
    c.execute(f'''CREATE TABLE fact_lmp_hourly AS
        WITH names AS (SELECT location_id, pnode_name FROM src.pnode_ref
                       UNION SELECT location_id, any_value(pnode_name) FROM src.node_xref WHERE location_id NOT IN (SELECT location_id FROM src.pnode_ref) GROUP BY 1
                       UNION SELECT * FROM (VALUES {iso_locs}) t(location_id, pnode_name))
        SELECT n.pnode_name, h.market, h.ts, h.lmp, h.energy, h.congestion, h.loss
        FROM src.lmp_hourly_hist h JOIN names n USING (location_id) ORDER BY n.pnode_name, h.ts''')
    log(f"fact_lmp_hourly {c.execute('SELECT count(*) FROM fact_lmp_hourly').fetchone()[0]:,} rows")
    fold_rows = 0
    if fold_fill:
        folds = [fall_back(y) for y in range(2020, 2027)]
        fold_rows = c.execute('INSERT INTO fact_lmp_hourly SELECT * FROM fact_lmp_hourly WHERE market = ? AND ts IN (SELECT unnest(?::TIMESTAMP[]))',
                              ['RT', folds]).fetchone()[0]
        log(f'fold fill: repeated {fold_rows:,} autumn 01:00 readings')
    # ── settled marts (definitions from api_prices.summary 'definitions') ────────────────────────────
    c.execute('''CREATE TABLE pn_year AS SELECT pnode_name, market, CAST(year(ts) AS BIGINT) AS y, count(*) AS n_hours, avg(lmp) AS avg_lmp, min(lmp) AS min_lmp,
        max(lmp) AS max_lmp, stddev_samp(lmp) AS std_lmp, quantile_cont(lmp, 0.05) AS p5, quantile_cont(lmp, 0.25) AS p25, quantile_cont(lmp, 0.5) AS p50,
        quantile_cont(lmp, 0.75) AS p75, quantile_cont(lmp, 0.95) AS p95, count(*) FILTER (WHERE lmp < 0) AS neg_hours,
        count(*) FILTER (WHERE lmp > 200) AS hours_gt_200, avg(energy) AS avg_energy, avg(congestion) AS avg_cong, avg(loss) AS avg_loss,
        avg(lmp) FILTER (WHERE hour(ts) BETWEEN 7 AND 22) AS peak_lmp, avg(lmp) FILTER (WHERE hour(ts) NOT BETWEEN 7 AND 22) AS offpeak_lmp
        FROM fact_lmp_hourly GROUP BY 1, 2, 3 ORDER BY 1, 2, 3''')
    c.execute('''CREATE TABLE pn_month AS SELECT pnode_name, market, CAST(year(ts) AS BIGINT) AS y, CAST(month(ts) AS BIGINT) AS m, count(*) AS n_hours,
        avg(lmp) AS avg_lmp, max(lmp) AS max_lmp, avg(lmp) FILTER (WHERE hour(ts) BETWEEN 9 AND 16) AS solar_lmp,
        count(*) FILTER (WHERE lmp < 0) AS neg_hours, avg(congestion) AS avg_cong FROM fact_lmp_hourly GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4''')
    c.execute('''CREATE TABLE pn_hour AS SELECT pnode_name, market, CAST(year(ts) AS BIGINT) AS y, CAST(hour(ts) AS BIGINT) AS h, count(*) AS n_hours,
        avg(lmp) AS avg_lmp, quantile_cont(lmp, 0.05) AS p5, quantile_cont(lmp, 0.5) AS p50, quantile_cont(lmp, 0.95) AS p95, avg(congestion) AS avg_cong
        FROM fact_lmp_hourly GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4''')
    c.execute('''CREATE TABLE pn_tb AS
        WITH r AS (SELECT pnode_name, market, CAST(ts AS DATE) AS d, lmp,
                          row_number() OVER (PARTITION BY pnode_name, market, CAST(ts AS DATE) ORDER BY lmp DESC) AS rd,
                          row_number() OVER (PARTITION BY pnode_name, market, CAST(ts AS DATE) ORDER BY lmp) AS ra FROM fact_lmp_hourly),
             t AS (SELECT pnode_name, market, d, avg(lmp) FILTER (WHERE rd <= 2) - avg(lmp) FILTER (WHERE ra <= 2) AS tb2,
                          avg(lmp) FILTER (WHERE rd <= 4) - avg(lmp) FILTER (WHERE ra <= 4) AS tb4,
                          avg(lmp) FILTER (WHERE rd <= 8) - avg(lmp) FILTER (WHERE ra <= 8) AS tb8 FROM r GROUP BY 1, 2, 3)
        SELECT pnode_name, market, CAST(year(d) AS BIGINT) AS y, count(*) AS n_days, avg(tb2) AS tb2, avg(tb4) AS tb4, avg(tb8) AS tb8,
               quantile_cont(tb4, 0.1) AS tb4_p10, quantile_cont(tb4, 0.9) AS tb4_p90 FROM t GROUP BY 1, 2, 3 ORDER BY 1, 2, 3''')
    c.execute('''CREATE TABLE pn_da_rt AS
        WITH x AS (SELECT pnode_name, ts, max(lmp) FILTER (WHERE market = 'DA') AS da, max(lmp) FILTER (WHERE market = 'RT') AS rt FROM fact_lmp_hourly
                   WHERE pnode_name IN (SELECT DISTINCT pnode_name FROM fact_lmp_hourly WHERE market = 'DA') GROUP BY 1, 2)
        SELECT pnode_name, CAST(year(ts) AS BIGINT) AS y, count(*) AS n_hours, avg(da) AS avg_da, avg(rt) AS avg_rt, avg(rt - da) AS avg_rt_less_da,
               avg(abs(rt - da)) AS avg_abs_spread, stddev_samp(rt - da) AS std_spread, quantile_cont(rt - da, 0.05) AS p5_spread,
               quantile_cont(rt - da, 0.95) AS p95_spread, avg(CASE WHEN rt > da THEN 1.0 ELSE 0.0 END) AS share_rt_above_da
        FROM x WHERE da IS NOT NULL AND rt IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2''')
    for g, extra in (('year', ', l.price_proxy_km'), ('month', ''), ('hour', ''), ('tb', ''), ('da_rt', '')):
        c.execute(f'''CREATE VIEW mart_bus_{g} AS SELECT l.bus_id, l.price_tier{extra}, l.buses_sharing_series, p.* EXCLUDE (pnode_name)
                      FROM pn_{g} p JOIN bus_link l USING (pnode_name)''')
    log('pn_year, pn_month, pn_hour, pn_tb, pn_da_rt (+ mart_bus_* views)')

    # ── forecast runs ─────────────────────────────────────────────────────────────────────────────────
    c.execute(f'''CREATE TABLE fact_fcst_lmp_hourly AS
        WITH d0 AS (SELECT run, min(study_day) AS d0 FROM src.lmp_hourly_fcst GROUP BY 1)
        SELECT f.run AS scenario, f.bus_id, CAST(make_date(y.yr, 1, 1) + (f.study_day - d0.d0) AS DATE) AS study_date, f.hour,
               f.lmp, f.cong AS congestion, f.loss, f.peak_flag = 1 AS is_peak
        FROM src.lmp_hourly_fcst f JOIN d0 USING (run) JOIN (VALUES {', '.join(f"('{k}', {v})" for k, v in RUN_YEAR.items())}) y(run, yr) USING (run)
        ORDER BY 1, 2, 3, 4''')
    c.execute('''CREATE TABLE mart_bus_fcst_year AS SELECT scenario, bus_id, count(*) AS n_hours, avg(lmp) AS avg_lmp, min(lmp) AS min_lmp, max(lmp) AS max_lmp,
        stddev_samp(lmp) AS std_lmp, quantile_cont(lmp, 0.05) AS p5, quantile_cont(lmp, 0.5) AS p50, quantile_cont(lmp, 0.95) AS p95,
        count(*) FILTER (WHERE lmp < 0) AS neg_hours, avg(congestion) AS avg_cong, avg(loss) AS avg_loss,
        avg(lmp) FILTER (WHERE is_peak) AS peak_lmp, avg(lmp) FILTER (WHERE NOT is_peak) AS offpeak_lmp
        FROM fact_fcst_lmp_hourly GROUP BY 1, 2 ORDER BY 1, 2''')
    c.execute('''CREATE TABLE mart_bus_fcst_month AS SELECT scenario, bus_id, CAST(month(study_date) AS BIGINT) AS m, count(*) AS n_hours, avg(lmp) AS avg_lmp,
        max(lmp) AS max_lmp, avg(lmp) FILTER (WHERE hour BETWEEN 9 AND 16) AS solar_lmp, count(*) FILTER (WHERE lmp < 0) AS neg_hours
        FROM fact_fcst_lmp_hourly GROUP BY 1, 2, 3 ORDER BY 1, 2, 3''')
    c.execute('''CREATE TABLE mart_bus_fcst_hour AS SELECT scenario, bus_id, CAST(hour AS BIGINT) AS h, count(*) AS n_hours, avg(lmp) AS avg_lmp,
        quantile_cont(lmp, 0.05) AS p5, quantile_cont(lmp, 0.5) AS p50, quantile_cont(lmp, 0.95) AS p95, avg(congestion) AS avg_cong
        FROM fact_fcst_lmp_hourly GROUP BY 1, 2, 3 ORDER BY 1, 2, 3''')
    c.execute('''CREATE TABLE dim_scenario AS SELECT * FROM (VALUES
        ('hist', 'historical', NULL::INTEGER, 'ISO-published settled prices'),
        ('5yr', 'forecast', 2028, 'PROBE Price Curve 5 Year run'),
        ('10yr', 'forecast', 2035, 'PROBE Price Curve 10 Year run'),
        ('pcr2030', 'forecast', 2030, 'PCR study set, 12 monthly PROBE runs'),
        ('pcr2035', 'forecast', 2035, 'PCR study set, 12 monthly PROBE runs'),
        ('pcr2040', 'forecast', 2040, 'PCR study set, 12 monthly runs, 12% gas case')) t(scenario, kind, target_year, description)''')
    # The register lists every run the app knows (as the unified store does); the PCR runs hold no rows here, so every
    # surface that reads them answers "not held" (data_quality.forecast_runs).
    log('fact_fcst_lmp_hourly, mart_bus_fcst_year/_month/_hour, dim_scenario')

    # ── not held in the old store: empty, correctly typed ────────────────────────────────────────────
    for name, cols in EMPTY.items():
        c.execute(f'CREATE TABLE {name} ({cols})')
    log(f'{len(EMPTY)} empty tables (not held in the old store)')

    # ── provenance ────────────────────────────────────────────────────────────────────────────────────
    st = src.stat()
    dq = [('source_store', 'converted', f'built by {VERSION} from {src.name} (read-only, {st.st_size:,} bytes, modified '
                                        f'{dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc).isoformat()}); not the unified store'),
          ('limiting_elements', 'auditable', 'constraints_{sp,sll}_sub_{dis,chg}: the same 67,860 rows as the unified store (sll_sub_dis keeps its shoulder|discharge label)'),
          ('headroom_mw', 'vendor-asserted', 'substations_corrected envelope, 5 cases x 2,678 buses; cite as vendor output'),
          ('short_circuit_mva', 'corrected', 'sqrt(3) x kV x kA from the published amps; the published MVA column is 100x too small'),
          ('price_history', 'converted', 'RT only, 2020-01-01 to 2026-04-28, from lmp_hourly_hist via pnode_ref; 2023 holds 8,400 of 8,760 hours'),
          ('fold_hour', 'filled' if fold_fill else 'not filled', f'the old store keeps one reading for the repeated autumn 01:00 hour; repeated once ({fold_rows:,} rows)'
                                                                  if fold_fill else 'one reading per autumn 01:00 hour, as stored'),
          ('hub_zone_series', 'converted', '.H.INTERNAL_HUB and the eight .Z.* load zones are the old store\'s location ids 4000-4008 (RT), '
                                          'named here by the ISO-NE standard ids; checked against the unified recordings'),
          ('unnamed_series', 'not loaded', 'settled series whose location id has no name in pnode_ref or node_xref cannot be linked to a bus'),
          ('day_ahead_prices', 'not held', 'the old store holds RT only'),
          ('forecast_runs', 'converted', '5yr (2028) and 10yr (2035) PROBE runs; pcr2030/2035/2040 are not in the old store'),
          ('pcr_detail', 'not held', 'binding constraints, unit dispatch, flowgates, storage and congestion impact exist only for PCR runs'),
          ('system_series', 'not held', 'fuel mix, system load, load forecast, interchange, reserve prices, 5-minute prices, settled constraints'),
          ('planning_registers', 'not held', 'retirements, transmission and substation upgrades, transformers'),
          ('load_zone', 'mixed', 'GridSense pipeline rule (equals the unified store): RSP-subarea zone of one representative node per bus (exact first, fewest buses '
                                 'at the substation, lowest location id); else a county-name lookup; else the state. Quirks kept for parity: the county '
                                 'lookup ignores the state (Franklin ME/VT -> WCMA), a far same-name node can set the zone, New York buses carry ME'),
          ('primary_pnode_choice', 'deterministic', 'node_xref ranked exact first, LD before UN, then name; geo-proxy = nearest pnode_ref node, ties by table order')]
    c.execute('CREATE TABLE data_quality (field_group VARCHAR, status VARCHAR, basis VARCHAR)')
    c.executemany('INSERT INTO data_quality VALUES (?, ?, ?)', dq)
    c.execute('CREATE TABLE conversion_meta (key VARCHAR, value VARCHAR)')
    c.executemany('INSERT INTO conversion_meta VALUES (?, ?)', [('converter', VERSION), ('source', str(src)), ('source_bytes', str(st.st_size)),
                                                                ('built_at', dt.datetime.now(dt.timezone.utc).isoformat()),
                                                                ('fold_fill', str(fold_fill))])
    c.execute('DETACH src')
    c.execute('CHECKPOINT')
    c.close()
    os.replace(tmp, out)
    log(f'wrote {out} ({out.stat().st_size:,} bytes)')
    return out


def main():
    ap = argparse.ArgumentParser(description='Convert ISONE_GridSense.duckdb (older store) into the unified schema One Studio reads.')
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--no-fold-fill', action='store_true', help='keep one reading for the repeated autumn hour')
    a = ap.parse_args()
    convert(a.src, a.out, not a.no_fold_fill)


if __name__ == '__main__':
    main()
