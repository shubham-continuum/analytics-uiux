"""Build data/samples.json: the guided sample projects for the Analyzer preview.

Run:  python plan/build_samples.py            (from the preview folder, or any folder)

Every bus is chosen by a rule in this file from the unified DuckDB (read-only via busdata.connect()).
Every number in a narrative, an option reason or a "what to look at" line is computed here, never typed:
  - price, spread and tail figures: the unified marts (mart_bus_year / _tb / _da_rt / _month / _fcst_year)
    and fact_lmp_hourly;
  - connection limits, upgrade-cost status, land fit and nearby-queue counts: the preview's own JS cores
    (gridrules.js, landcore.js, queuecore.js, prices.js, solar.js, economics.js), run under Node on the same
    rows the dashboards read, so a sample can never disagree with the dashboard it points at;
  - land exclusions and footprint intensities: data/land.json (Studio copy, older database; labelled).
The Cape Cod project mirrors the live Studio's demo project "kennebec" (studio/src/app.js GS_SEED, read-only):
its option buses are parsed from that file, not copied by hand.
"""
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import busdata  # noqa: E402  (preview data layer; opens the unified DB read-only)

OUT = ROOT / 'data' / 'samples.json'
STUDIO_SEED = ROOT.parents[1] / 'analytics-portfolio-canvas-2026-09-11' / 'studio' / 'src' / 'app.js'
YEAR = 2025
MARKET = 'RT'
QUEUE_RADIUS_MI = 10          # the Queue dashboard's default radius (views/queue.js: S.ui.qRadius || 10)
SOLAR_CF, LOSS_PCT, RTE = 0.15, 3.0, 0.86   # Economics defaults (views/economics.js DEFAULTS: cited / placeholder)
SCARCITY = 200                # $/MWh; the marts' hours_gt_200 threshold
CHEAP = 20                    # $/MWh; "hours under $20" (GAP-BRIEF data-centre view)
BASIS = {'mode': 'historical', 'market': MARKET, 'run': None, 'years': [YEAR], 'weighting': 'duration',
         'weights': {}, 'strict': True, 'includePartial': False}

# Size configurations evaluated on every bus: key -> (tech, exportMW, importMW).
CONFIGS = {'solar100': ('solar', 100, 0), 'storage100': ('storage', 100, 100), 'hybrid150': ('hybrid', 150, 75),
           'dc300': ('datacenter', 0, 300), 'wind200': ('wind', 200, 0)}

# Trace ids each step expects (observed in the preview on 2026-09-29 with tests/smoke-samples.mjs --discover).
# A step lists the trace that proves its headline; the smoke test requires it present, reconciling, NaN-free.
TRACE = {
    ('market', 'find'): None, ('market', 'rank'): None,
    ('land', 'area'): 'l-area', ('grid', 'capacity'): None, ('grid', 'constraints'): 'g-constraints',
    ('grid', 'cost'): None, ('queue', 'cluster'): None, ('prices', 'lmp'): None, ('prices', 'shape'): None,
    ('prices', 'tails'): None, ('economics', 'revenue'): None, ('economics', 'bess'): None,
    ('economics', 'hybrid'): None, ('economics', 'finance'): None, ('decision', 'compare'): None,
    ('decision', 'record'): None,
}
TRACE_FILE = ROOT / 'plan' / 'samples_traces.json'  # optional override written by --discover (see tests/smoke-samples.mjs)

# ---------------------------------------------------------------------------------------------------------
# Node bridge: the dashboards' own rules, evaluated on the rows this script passes in.
NODE_JS = r"""
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const root = process.env.SAMPLES_ROOT, U = f => pathToFileURL(root + '/' + f).href;
const G = await import(U('gridrules.js')), L = await import(U('landcore.js')), Q = await import(U('queuecore.js'));
const P = await import(U('prices.js')), SO = await import(U('solar.js')), E = await import(U('economics.js'));
const inp = JSON.parse(readFileSync(process.env.SAMPLES_IN, 'utf8'));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const out = {};
function gridEval(bus, g, tech, ex, im) {
  const grid = { headroom: g.h, constraints: g.c };
  const t = G.caseTable(grid, bus, tech, ex, im), be = G.binding(t, 'export'), bi = G.binding(t, 'import');
  const cost = G.stepCostService(grid, bus, tech, ex, im);
  const b = x => ({ value: x.value ?? null, status: x.status, case: x.row?.label ?? null, facility: x.row?.element?.facility ?? null });
  return { cases: t.map(r => ({ key: r.key, label: r.label, dir: r.dir, envelope: r.envelope, governing: r.governing, basis: r.basis, status: r.status, margin: r.margin, facility: r.element?.facility ?? null })),
    ex: b(be), im: b(bi),
    cost: { status: cost.status, total: cost.total ?? null, items: cost.items.length, unpriced: cost.unpriced ?? 0, gaps: (cost.gaps || []).map(x => x.label), unverified: (cost.unverified || []).map(x => x.label),
            top: cost.items.filter(i => ok(i.cost)).sort((a, z) => z.cost - a.cost).slice(0, 1).map(i => ({ label: i.label, cost: i.cost }))[0] ?? null } };
}
if (inp.mode === 'grid') {
  for (const [bus, g] of Object.entries(inp.grid)) {
    out[bus] = {};
    for (const [key, [tech, ex, im]] of Object.entries(inp.configs)) out[bus][key] = gridEval(bus, g, tech, ex, im);
  }
} else {
  for (const o of inp.options) {
    const r = { key: o.key };
    const s = o.series, data = { series: s ? [s] : [] };
    const basis = { ...inp.basis, nodeId: o.bus };
    const a = s ? P.analyzePrices(data, basis) : { errors: ['no series'] };
    const rows = a.errors?.length ? [] : a.rows;
    if (rows.length) {
      const sm = a.summary;
      r.prices = { mean: sm.mean, p05: sm.p05, p50: sm.p50, p95: sm.p95, negativePct: sm.negativePct, hours: sm.hours };
      const cap = SO.capture(rows, x => SO.clearSky(x.timestamp, o.lat, o.lon));
      r.capture = { price: cap.capture, ratio: cap.ratio };
      const days = P.dailySpreads(rows, 4);
      r.tb4 = { mean: days.length ? days.reduce((t, d) => t + d.spread, 0) / days.length : null, days: days.length };
      r.bench = E.spreadBenchmark({ mw: 100, dur: 4, spread: r.tb4.mean, cycles: 365, rte: inp.rte });
      const H = rows.reduce((t, x) => t + x.dtHours, 0);
      r.hoursUnder = rows.filter(x => x.price < inp.cheap).reduce((t, x) => t + x.dtHours, 0);
      r.hoursOver = rows.filter(x => x.price > inp.scarcity).reduce((t, x) => t + x.dtHours, 0);
      if (o.tech === 'datacenter') {
        const bill = rows.reduce((t, x) => t + o.im * x.price * x.dtHours, 0);
        const scar = rows.filter(x => x.price > inp.scarcity).reduce((t, x) => t + o.im * x.price * x.dtHours, 0);
        r.load = { mw: o.im, mwh: o.im * H, bill, scarcityCost: scar, scarcityShare: bill ? scar / bill : null };
      }
      if (o.tech === 'hybrid' || o.tech === 'solar') {
        // Economics tabHybrid, "Solar only" row: clear-sky shape scaled to the CF, clipped at nameplate, losses, then the POI cap.
        const shape = rows.map(x => SO.clearSky(x.timestamp, o.lat, o.lon) ?? 0);
        const mean = shape.reduce((t, v, i) => t + v * rows[i].dtHours, 0) / H;
        const pv = o.ex, poi = ok(o.exportLimit) ? Math.min(pv, o.exportLimit) : pv;
        const gen = shape.map(v => Math.min(pv, mean ? (pv * inp.cf * v) / mean : 0) * (1 - inp.loss / 100));
        let spill = 0, spillHours = 0, genMWh = 0;
        gen.forEach((gm, i) => { genMWh += gm * rows[i].dtHours; if (gm > poi) { spill += (gm - poi) * rows[i].dtHours; spillHours += rows[i].dtHours; } });
        r.spill = { pv, poi, genMWh, spillMWh: spill, spillHours, share: genMWh ? spill / genMWh : null };
      }
    }
    const mw = o.tech === 'datacenter' ? o.im : o.ex;
    const fp = L.footprint(inp.land.intensity, o.tech, mw), sc = L.screen(inp.land.exclusions, o.bus), f = L.fit(fp, sc);
    r.land = { held: !!sc, radiusMi: sc?.radiusMi ?? null, clear: sc?.clear ?? null, gross: sc?.gross ?? null, need: fp?.base ?? null, fit: f.status, low: f.low ?? null, high: f.high ?? null };
    const near = Q.nearby(inp.queue, { latitude: o.lat, longitude: o.lon, name: o.name }, inp.radius).filter(x => x.inRadius);
    r.queue = { n: near.length, mw: near.reduce((t, x) => t + (ok(x.q.max_mw) ? x.q.max_mw : 0), 0), mwHeld: near.filter(x => ok(x.q.max_mw)).length,
                nearest: near[0] ? { qp: near[0].q.queue_position, mi: near[0].distance, type: near[0].q.resource_type, mw: near[0].q.max_mw, status: near[0].q.status } : null };
    out[o.key] = r;
  }
}
writeFileSync(process.env.SAMPLES_OUT, JSON.stringify(out));
"""


def node_eval(payload):
    with tempfile.TemporaryDirectory() as d:
        src, dst = Path(d) / 'in.json', Path(d) / 'out.json'
        src.write_text(json.dumps(busdata.clean(payload), allow_nan=False), encoding='utf-8')
        env = {**os.environ, 'SAMPLES_ROOT': ROOT.as_posix(), 'SAMPLES_IN': str(src), 'SAMPLES_OUT': str(dst)}
        run = subprocess.run(['node', '--input-type=module'], input=NODE_JS, text=True, capture_output=True, env=env, cwd=str(ROOT))
        if run.returncode:
            raise RuntimeError(f'node bridge failed: {run.stderr[-2000:]}')
        return json.loads(dst.read_text(encoding='utf-8'))


# ---------------------------------------------------------------------------------------------------------
# Formatting (matches the dashboards' fmt: $x.xx prices, MW to one decimal, $M money).
def ok(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def price(v):
    return 'not held' if not ok(v) else ('−' if v < 0 else '') + f'${abs(v):,.2f}'


def mw(v):
    return 'not held' if not ok(v) else (f'{v:,.0f} MW' if abs(v - round(v)) < 1e-9 else f'{v:,.1f} MW')


def money(v):
    if not ok(v): return 'not held'
    a = abs(v)
    s = f'${a / 1e6:,.1f}M' if a >= 1e6 else f'${a / 1e3:,.0f}k' if a >= 1e3 else f'${a:,.0f}'
    return ('−' if v < 0 else '') + s


def musd(v):
    return 'not held' if not ok(v) else f'${v:,.1f}M'


def pct(v, d=1):
    return 'not held' if not ok(v) else f'{v:.{d}f}%'


def num(v, d=0):
    return 'not held' if not ok(v) else f'{v:,.{d}f}'


def km_mi(km):
    return km / 1.609344


def haversine_mi(a, b):
    p = math.pi / 180
    x = math.sin((b[0] - a[0]) * p / 2) ** 2 + math.cos(a[0] * p) * math.cos(b[0] * p) * math.sin((b[1] - a[1]) * p / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(x))


# ---------------------------------------------------------------------------------------------------------
def studio_seed():
    """Studio demo projects {id: {name, asset, sizeMW, options:[{id, busId, note}]}} parsed read-only from GS_SEED."""
    text = STUDIO_SEED.read_text(encoding='utf-8')
    seed = text[text.index('window.GS_SEED'):text.index('userWidgets:')]
    out = {}
    for m in re.finditer(r"id: '([a-z]+)', name: '([^']+)', asset: '([a-z]+)', sizeMW: (\d+)", seed):
        end = seed.find("decision: null", m.end())
        block = seed[m.end():end]
        opts = [{'id': o.group(1), 'busId': int(o.group(2)), 'note': o.group(3)}
                for o in re.finditer(r"\{ id: '(o\d+)', busId: (\d+), sizeMW: \d+, direction: '[a-z]+', status: '[^']+', note: '((?:[^'\\]|\\.)*)'", block)]
        out[m.group(1)] = {'name': m.group(2), 'asset': m.group(3), 'sizeMW': int(m.group(4)), 'options': opts}
    return out


def load(c):
    buses = {b['id']: b for b in busdata.bus_list(c)}
    for r in busdata.rows(c, 'SELECT bus_id, short_circuit_mva, nominal_kv FROM dim_bus WHERE latitude IS NOT NULL'):
        buses[str(r['bus_id'])]['sc'] = r['short_circuit_mva']
    m = defaultdict(dict)
    for r in busdata.rows(c, 'SELECT * FROM mart_bus_year WHERE market=? AND y=?', [MARKET, YEAR]):
        m[str(r['bus_id'])]['year'] = r
    for r in busdata.rows(c, 'SELECT bus_id, tb2, tb4, tb8, n_days FROM mart_bus_tb WHERE market=? AND y=?', [MARKET, YEAR]):
        m[str(r['bus_id'])]['tb'] = r
    for r in busdata.rows(c, 'SELECT bus_id, avg_rt_less_da, share_rt_above_da FROM mart_bus_da_rt WHERE y=?', [YEAR]):
        m[str(r['bus_id'])]['dart'] = r
    for r in busdata.rows(c, 'SELECT bus_id, sum(solar_lmp*n_hours)/nullif(sum(avg_lmp*n_hours),0) AS ratio FROM mart_bus_month WHERE market=? AND y=? GROUP BY 1', [MARKET, YEAR]):
        m[str(r['bus_id'])]['solarRatio'] = r['ratio']
    for r in busdata.rows(c, "SELECT bus_id, avg_lmp, min_lmp, max_lmp FROM mart_bus_fcst_year WHERE scenario='pcr2030'"):
        m[str(r['bus_id'])]['f2030'] = None if (r['min_lmp'] == 0 and r['max_lmp'] == 0) else r['avg_lmp']
    hub = busdata.rows(c, "SELECT avg(lmp) AS avg, count(*) AS n FROM fact_lmp_hourly WHERE pnode_name=? AND market=? AND year(ts)=?",
                       [busdata.HUB['priceMapping']['pnode_name'], MARKET, YEAR])[0]
    grid = defaultdict(lambda: {'h': [], 'c': []})
    for r in busdata.rows(c, 'SELECT bus_id, scenario, direction, headroom_mw, pre_existing_issues FROM fact_headroom'):
        grid[str(r['bus_id'])]['h'].append(r)
    cols = ('bus_id, scenario, direction, monitored_facility, binding_contingency, contingency_id, dfax, transfer_mw, base_flow_mw, '
            'contingency_flow_mw, rating_a_mva, rating_c_mva, pct_loading_no_transfer, fix_cost_musd, length_miles, facility_type')
    for r in busdata.rows(c, f'SELECT {cols} FROM fact_limiting_element'):
        grid[str(r['bus_id'])]['c'].append(r)
    queue = busdata.rows(c, 'SELECT * FROM dim_queue')
    return buses, m, hub, {k: v for k, v in grid.items() if k in buses}, queue


def overnight_floor(c, pnode):
    """P5 / P25 of 2025 RT prices in hours 00-05 on the source clock (Prices 5.20 overnight floor)."""
    r = busdata.rows(c, '''SELECT quantile_cont(lmp, 0.05) AS p5, quantile_cont(lmp, 0.25) AS p25, count(*) AS n
                           FROM fact_lmp_hourly WHERE pnode_name=? AND market=? AND year(ts)=? AND hour(ts) BETWEEN 0 AND 5''',
                     [pnode, MARKET, YEAR])[0]
    return r


def complete(m, bid):
    y = m.get(bid, {}).get('year')
    return bool(y) and y['n_hours'] >= 8760


def fits(g, key, dirs=('ex',)):
    return all(g[key][d]['status'] == 'Fits' for d in dirs)


# ---------------------------------------------------------------------------------------------------------
def choose(buses, m, grid, gridres, land_ids, seed):
    """Every option, with the rule that picked it. Returns {project_key: [(bus_id, rule_text)]}."""
    picks = {}
    by_tier = lambda t: [b for b in buses.values() if b['tier'] == t and b['hist'] and complete(m, b['id'])]

    # 1 · Solar 100 MW: mirror the Studio's "kennebec" (Cape Cod Solar) same-substation + own-node options,
    #     then add the nearest borrowed-price bus whose solar upgrade cost at 100 MW is a Lower bound.
    k = seed.get('kennebec', {'options': []})
    kopts = [str(o['busId']) for o in k['options'] if str(o['busId']) in buses]
    same = next((b for b in kopts if buses[b]['tier'] == 'same_substation'), None)
    own = next((b for b in kopts if buses[b]['tier'] == 'direct'), None)
    anchor = buses[same or own]
    cand = [b for b in by_tier('geo_proxy') if (b['proxyKm'] or 0) >= 1 and gridres[b['id']]['solar100']['cost']['status'] == 'Lower bound']
    cand.sort(key=lambda b: (haversine_mi((anchor['lat'], anchor['lon']), (b['lat'], b['lon'])), int(b['id'])))
    borrowed = cand[0]['id']
    picks['solar'] = [(same, 'same_substation'), (own, 'direct'), (borrowed, 'geo_proxy')]

    # 2 · Storage 100 MW / 400 MWh: a tight shoulder-charge limit (export fits, charge does not) and an
    #     unconstrained option (both directions fit, no priced upgrade), both ranked by settled 2025 TB4.
    tb4 = lambda b: (m[b].get('tb') or {}).get('tb4') or -1e9
    tight = [b for b in grid if b in buses and buses[b]['hist'] and complete(m, b) and fits(gridres[b], 'storage100', ('ex',))
             and gridres[b]['storage100']['im']['status'] == 'Does not fit' and gridres[b]['storage100']['im']['case'] == 'Shoulder · charge']
    tight.sort(key=lambda b: (-tb4(b), int(b)))
    t0 = tight[0]
    free = [b for b in grid if b in buses and buses[b]['hist'] and complete(m, b) and fits(gridres[b], 'storage100', ('ex', 'im'))
            and gridres[b]['storage100']['cost']['status'] in ('True zero', 'No upgrades indicated') and buses[b]['zone'] == buses[t0]['zone']]
    free.sort(key=lambda b: (-tb4(b), int(b)))
    picks['storage'] = [(t0, 'tight'), (free[0], 'free')]

    # 3 · Hybrid PV 150 + BESS 75: a POI whose export limit sits below the 150 MW array (clipping and spill at
    #     the POI) with a shoulder-charge limit that takes the 75 MW battery; a land screen held; then a same-zone
    #     contrast bus that exports all 150 MW.
    sr = lambda b: m[b].get('solarRatio') or -1e9
    spill = [b for b in grid if b in buses and buses[b]['hist'] and complete(m, b) and b in land_ids
             and ok(gridres[b]['hybrid150']['ex']['value']) and 90 <= gridres[b]['hybrid150']['ex']['value'] <= 130
             and gridres[b]['hybrid150']['im']['status'] == 'Fits']
    spill.sort(key=lambda b: (-sr(b), int(b)))
    h0 = spill[0]
    roomy = [b for b in grid if b in buses and buses[b]['hist'] and complete(m, b) and buses[b]['zone'] == buses[h0]['zone']
             and fits(gridres[b], 'hybrid150', ('ex', 'im'))]
    roomy.sort(key=lambda b: (-sr(b), int(b)))
    picks['hybrid'] = [(h0, 'spill'), (roomy[0], 'roomy')]

    # 4 · Data centre 300 MW import: the lowest-priced 2025 bus that fits 300 MW on both import cases,
    #     a second fit in another load zone, and the Studio campus's first option as the constrained contrast.
    avg = lambda b: m[b]['year']['avg_lmp']
    dc = [b for b in grid if b in buses and buses[b]['hist'] and complete(m, b) and (buses[b]['kv'] or 0) >= 115 and fits(gridres[b], 'dc300', ('im',))]
    dc.sort(key=lambda b: (avg(b), int(b)))
    d0 = dc[0]
    d1 = next(b for b in dc if buses[b]['zone'] != buses[d0]['zone'])
    campus = [str(o['busId']) for o in seed.get('campus', {'options': []})['options'] if str(o['busId']) in buses and buses[str(o['busId'])]['hist']]
    picks['datacenter'] = [(d0, 'cheapest'), (d1, 'second-zone')] + ([(campus[0], 'studio')] if campus else [])

    # 5 · Wind 200 MW: Maine buses (the Studio's Downeast Wind zone) that fit 200 MW on every export case,
    #     ranked by the 2025 overnight P25 floor (computed later) → candidates here, ranked in build().
    wind = [b for b in grid if b in buses and buses[b]['hist'] and complete(m, b) and buses[b]['zone'] == 'ME' and fits(gridres[b], 'wind200', ('ex',))]
    down = [str(o['busId']) for o in seed.get('downeast', {'options': []})['options'] if str(o['busId']) in buses and buses[str(o['busId'])]['hist'] and complete(m, str(o['busId']))]
    picks['wind'] = (wind, down)
    return picks


# ---------------------------------------------------------------------------------------------------------
def build():
    c = busdata.connect()
    seed = studio_seed()
    buses, m, hub, grid, queue = load(c)
    land = json.loads((ROOT / 'data' / 'land.json').read_text(encoding='utf-8'))
    gridres = node_eval({'mode': 'grid', 'grid': grid, 'configs': CONFIGS})
    # ISO-wide fit counts per configuration (the Screen-depth figure on the Market step).
    fitcount = {k: sum(1 for b in gridres if all(gridres[b][k][d]['status'] in ('Fits', 'Not requested') for d in ('ex', 'im'))) for k in CONFIGS}
    picks = choose(buses, m, grid, gridres, set(land['exclusions']), seed)

    # Wind ranking needs the overnight floor from the hourly fact table.
    wind_cands, down = picks['wind']
    floors = {b: overnight_floor(c, buses[b]['pnode']) for b in wind_cands + down}
    wind_cands.sort(key=lambda b: (-(floors[b]['p25'] if ok(floors[b]['p25']) else -1e9), int(b)))
    w0 = wind_cands[0]
    picks['wind'] = [(w0, 'floor')] + [(down[0], 'studio')] if down else [(w0, 'floor'), (wind_cands[1], 'floor2')]

    # Hourly detail on every chosen option through the dashboards' own cores.
    opts = []
    tech_of = {'solar': 'solar100', 'storage': 'storage100', 'hybrid': 'hybrid150', 'datacenter': 'dc300', 'wind': 'wind200'}
    for tech, lst in picks.items():
        tt, ex, im = CONFIGS[tech_of[tech]]
        for bid, _ in lst:
            p = busdata.bus_payload(c, bid)
            s = next((x for x in p['series'] if x['mode'] == 'historical' and x['market'] == MARKET and x['year'] == YEAR), None)
            b = buses[bid]
            opts.append({'key': f'{tech}:{bid}', 'bus': bid, 'tech': tt, 'ex': ex, 'im': im, 'lat': b['lat'], 'lon': b['lon'], 'name': b['name'],
                         'exportLimit': gridres[bid][tech_of[tech]]['ex']['value'], 'series': s})
    det = node_eval({'mode': 'detail', 'options': opts, 'basis': BASIS, 'land': land, 'queue': queue, 'radius': QUEUE_RADIUS_MI,
                     'cf': SOLAR_CF, 'loss': LOSS_PCT, 'rte': RTE, 'cheap': CHEAP, 'scarcity': SCARCITY})

    ctx = {'buses': buses, 'm': m, 'hub': hub, 'grid': gridres, 'det': det, 'fit': fitcount, 'land': land, 'floors': floors, 'n': len(gridres), 'seed': seed}
    projects = []
    for tech, builder, selection in [
        ('solar', solar_project, picks['solar']),
        ('storage', storage_project, picks['storage']),
        ('hybrid', hybrid_project, picks['hybrid']),
        ('datacenter', dc_project, picks['datacenter']),
        ('wind', wind_project, picks['wind']),
    ]:
        ctx['det_of'] = lambda bus, kind=tech: det[f'{kind}:{bus}']
        projects.append(builder(ctx, selection))
    for p in projects:
        complete_workflow(p, ctx)
    traces = TRACE
    if TRACE_FILE.exists():
        traces = {**TRACE, **{tuple(k.split('|')): v for k, v in json.loads(TRACE_FILE.read_text(encoding='utf-8')).items()}}
    for p in projects:
        for s in p['steps']:
            s['trace'] = traces.get((s['stage'], s['tab']), None) if s['depth'] == 'study' else None
            s.setdefault('expect', [])
    out = {'generatedAt': dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds'),
           'generator': 'plan/build_samples.py',
           'source': f'unified ISONE_GridSense_unified.duckdb (read-only): dim_bus, bridge_bus_pnode, mart_bus_year/_tb/_da_rt/_month/_fcst_year, '
                     f'fact_lmp_hourly, fact_headroom, fact_limiting_element, dim_queue · data/land.json (Studio copy, older database) · '
                     f'Studio demo projects parsed from studio/src/app.js GS_SEED (read-only)',
           'rules': 'Observed Grid limits, cost status, land fit and queue counts come from the preview cores (gridrules.js, landcore.js, queuecore.js); '
                    'observed price figures from prices.js analyzePrices on the settled 2025 RT basis. Finance and planning presets are explicitly illustrative assumptions.',
           'basisNote': f'Every sample uses the settled {YEAR} {MARKET} basis at the option bus (one bus, one price). The Studio demo used case sp, horizon 2030, history {YEAR}; the 2030 forecast figure is quoted beside it, never mixed in.',
           'hub': {'avg': hub['avg'], 'hours': hub['n']},
           'fitCounts': fitcount,
           'projects': projects}
    OUT.write_text(json.dumps(busdata.clean(out), indent=1, ensure_ascii=False, allow_nan=False), encoding='utf-8')
    print(f'wrote {OUT} · {len(projects)} projects · {sum(len(p["steps"]) for p in projects)} steps')
    for p in projects:
        print(f'  {p["id"]}: ' + ', '.join(f'{o["id"]}={o["busId"]} {o["label"]}' for o in p['options']))


# ---------------------------------------------------------------------------------------------------------
# Project builders. Each option's `note` is its computed reason; each step's text quotes computed numbers.
def bus_label(ctx, bid):
    b = ctx['buses'][bid]
    return f"{b['name']} {num(b['kv'])} kV ({b['zone']}, bus {bid})"


def tier_text(ctx, bid):
    b = ctx['buses'][bid]
    if b['tier'] == 'direct': return f"own settlement node {b['pnode'].strip()}"
    if b['tier'] == 'same_substation': return f"price node at the same substation ({b['pnode'].strip()})"
    return f"borrowed price: nearest node {b['pnode'].strip()} is {num(b['proxyKm'], 1)} km away"


def lim(g, d):
    x = g[d]
    return f"{mw(x['value'])} ({x['case']}, {x['status'].lower()})" if ok(x['value']) else x['status'].lower()


def cost_text(g):
    c = g['cost']
    if c['status'] == 'Lower bound':
        return f"Lower bound: at least {musd(c['total'])} priced, and {', '.join(c['gaps'])} binds with no facility costs held"
    if c['status'] in ('Priced', 'Partly priced'):
        top = c['top']
        return f"{c['status']}: {musd(c['total'])} over {c['items']} facilit{'y' if c['items'] == 1 else 'ies'}" + (f", largest {top['label']} at {musd(top['cost'])}" if top else '')
    if c['status'] == 'No upgrades indicated':
        return f"no upgrades indicated ({', '.join(c['unverified'])} confirmed by the envelope only)"
    return c['status'].lower()


def prices_line(ctx, bid):
    d = ctx['det_of'](bid)['prices']
    return (f"2025 RT mean {price(d['mean'])}/MWh (P5 {price(d['p05'])}, P95 {price(d['p95'])}, {pct(d['negativePct'], 2)} of hours negative) "
            f"against the ISO-NE Internal Hub's {price(ctx['hub']['avg'])}")


def land_line(ctx, bid, what):
    L = ctx['det_of'](bid)['land']
    if not L['held']:
        return f"No exclusion screen is held for {ctx['buses'][bid]['name']}, so Land shows the fit as unknown, not as a pass."
    return (f"{num(L['clear'])} clear acres in the {num(L['radiusMi'])}-mile screen against {num(L['need'])} acres base footprint for {what}: "
            f"{L['fit']} on the habitat/protected screen only (Studio copy of the exclusions, older database).")


def queue_line(ctx, bid):
    q = ctx['det_of'](bid)['queue']
    if not q['n']:
        return f"No solved-case queue request lies within {QUEUE_RADIUS_MI} mi of {ctx['buses'][bid]['name']}; that does not mean the area is empty, only that the solved-case set holds none."
    n = q['nearest']
    return (f"{q['n']} solved-case request{'s' if q['n'] != 1 else ''} within {QUEUE_RADIUS_MI} mi ({mw(q['mw'])} requested); the nearest is Q{n['qp']}, "
            f"{n['type'] or 'type not held'}, {mw(n['mw'])}, {num(n['mi'], 1)} mi away, status \"{n['status']}\". Nearby MW is context, never subtracted from headroom.")


def market_line(ctx, key, what):
    return f"By the Grid element-study rule, {num(ctx['fit'][key])} of {num(ctx['n'])} buses fit {what} on every applicable case. Screen depth shows only these ISO-wide figures."


def opt(ctx, oid, bid, label, note):
    return {'id': oid, 'label': label, 'busId': bid, 'busName': ctx['buses'][bid]['name'], 'tier': ctx['buses'][bid]['tier'], 'note': note}


def solar_project(ctx, picks):
    (o1, _), (o2, _), (o3, _) = picks
    g = lambda b: ctx['grid'][b]['solar100']
    d = ctx['det_of']
    k = ctx['seed'].get('kennebec', {})
    ranked = sorted([o1, o2, o3], key=lambda b: -(d(b)['capture']['price'] or -1e9))
    lb = next(b for b in (o1, o2, o3) if g(b)['cost']['status'] == 'Lower bound')
    anchor = ctx['buses'][o1]
    dist = haversine_mi((anchor['lat'], anchor['lon']), (ctx['buses'][o3]['lat'], ctx['buses'][o3]['lon']))
    options = [
        opt(ctx, 'o1', o1, 'Same-substation price', f"Studio demo option o1 ({k.get('name', 'Cape Cod Solar')}). Priced at the {tier_text(ctx, o1)}. Export limit {lim(g(o1), 'ex')}; upgrade cost {cost_text(g(o1))}."),
        opt(ctx, 'o2', o2, 'Own price node', f"Studio demo option o2. Priced at its {tier_text(ctx, o2)}. Export limit {lim(g(o2), 'ex')}; upgrade cost {cost_text(g(o2))}."),
        opt(ctx, 'o3', o3, 'Borrowed price', f"Nearest borrowed-price bus to {anchor['name']} ({num(dist, 1)} mi) whose 100 MW solar upgrade cost is a Lower bound. {tier_text(ctx, o3).capitalize()}. Export limit {lim(g(o3), 'ex')}."),
    ]
    cap = d(o2)['capture']
    narrative = (f"A developer weighs a 100 MW solar project on Cape Cod, mirroring the Studio's {k.get('name', 'Cape Cod Solar')} demo. "
                 f"{ctx['buses'][o2]['name']} has its own price node and a clear-sky capture of {price(cap['price'])}/MWh ({num(cap['ratio'], 3)} of its 2025 mean); "
                 f"{ctx['buses'][o3]['name']} borrows a neighbour's price and its upgrade cost is only a lower bound, so the choice turns on evidence quality as much as price.")
    steps = [
        step('market', 'find', 'screen', 'o2', market_line(ctx, 'solar100', '100 MW of solar export') + f" {ctx['buses'][o2]['name']} is one; its 2025 RT mean is {price(ctx['m'][o2]['year']['avg_lmp'])}."),
        step('prices', 'lmp', 'screen', 'o2', f"{ctx['buses'][o2]['name']}: {prices_line(ctx, o2)}. The 2030 forecast run averages {price(ctx['m'][o2].get('f2030'))} (quoted beside the basis, not mixed in)."),
        step('land', 'area', 'review', 'o2', land_line(ctx, o2, '100 MW solar')),
        step('grid', 'capacity', 'review', 'o1', f"{ctx['buses'][o1]['name']}: export limit {lim(g(o1), 'ex')}. For pure solar only the export cases apply; the {mw(ctx['grid'][o1]['storage100']['im']['value'])} shoulder-charge limit is irrelevant here."),
        step('grid', 'cost', 'study', lb, f"{ctx['buses'][lb]['name']}: {cost_text(g(lb))}. A Lower bound is never shown as a total."),
        step('queue', 'cluster', 'review', 'o2', queue_line(ctx, o2)),
        step('prices', 'shape', 'review', 'o2', f"Clear-sky capture at {ctx['buses'][o2]['name']} is {price(cap['price'])}/MWh, ratio {num(cap['ratio'], 3)}; the mart's own solar weighting gives {num(ctx['m'][o2].get('solarRatio'), 3)}. The two bases differ; neither is a site profile."),
        step('prices', 'basis', 'review', 'o3', f"{ctx['buses'][o3]['name']} borrows {ctx['buses'][o3]['pnode'].strip()} ({num(ctx['buses'][o3]['proxyKm'], 1)} km): its 2025 average congestion {price(ctx['m'][o3]['year']['avg_cong'])}/MWh is the neighbour's, not its own."),
        step('economics', 'revenue', 'study', 'o2', f"Energy revenue uses the {num(SOLAR_CF * 100)}% capacity factor (cited assumption) and {num(LOSS_PCT)}% losses at {ctx['buses'][o2]['name']}'s clear-sky capture of {price(cap['price'])}/MWh, capped at the export limit {mw(g(o2)['ex']['value'])}."),
        step('decision', 'compare', 'review', 'o2', 'Clear-sky capture by option: ' + '; '.join(f"{ctx['buses'][b]['name']} {price(d(b)['capture']['price'])}" for b in ranked) + f". Cost status: " + '; '.join(f"{ctx['buses'][b]['name']} {g(b)['cost']['status']}" for b in (o1, o2, o3)) + '.'),
        step('decision', 'record', 'study', 'o2', f"Record the choice with its basis (settled {YEAR} RT) and the open item: {ctx['buses'][lb]['name']}'s cost is a lower bound until {', '.join(g(lb)['cost']['gaps'])} is studied."),
    ]
    return project('kennebec', f"{k.get('name', 'Cape Cod Solar')} (sample)", 'Solar developer', 'solar', 100, 0, narrative, options, steps)


def storage_project(ctx, picks):
    (t0, _), (f0, _) = picks
    g = lambda b: ctx['grid'][b]['storage100']
    d = ctx['det_of']; m = ctx['m']
    tb = lambda b: (m[b].get('tb') or {}).get('tb4')
    options = [
        opt(ctx, 'o1', t0, 'Tight shoulder charge', f"Highest settled 2025 TB4 ({price(tb(t0))}/MWh) among buses where 100 MW export fits but the shoulder-charge limit does not: charge {lim(g(t0), 'im')}, export {lim(g(t0), 'ex')}."),
        opt(ctx, 'o2', f0, 'Unconstrained', f"Highest settled 2025 TB4 ({price(tb(f0))}/MWh) in {ctx['buses'][f0]['zone']} among buses that fit 100 MW both ways with no priced upgrade: charge {lim(g(f0), 'im')}, export {lim(g(f0), 'ex')}."),
    ]
    narrative = (f"A storage developer compares two 100 MW / 400 MWh sites in {ctx['buses'][t0]['zone']}. "
                 f"{ctx['buses'][t0]['name']} has the richer spread (TB4 {price(tb(t0))}/MWh) but can only charge {mw(g(t0)['im']['value'])} on the shoulder case; "
                 f"{ctx['buses'][f0]['name']} takes the full 100 MW both ways at a TB4 of {price(tb(f0))}/MWh.")
    b0, b1 = d(t0), d(f0)
    steps = [
        step('market', 'find', 'screen', 'o1', market_line(ctx, 'storage100', '100 MW of storage, both directions (shoulder charge only)') + f" {ctx['buses'][t0]['name']} is not one: its charge side does not fit."),
        step('prices', 'lmp', 'screen', 'o1', f"{ctx['buses'][t0]['name']}: {prices_line(ctx, t0)}."),
        step('grid', 'capacity', 'review', 'o1', f"Charge {lim(g(t0), 'im')} against the 100 MW request: margin {mw(g(t0)['im']['value'] - 100)}. Storage charging is screened on the shoulder case only, never at summer peak."),
        step('grid', 'cost', 'study', 'o1', f"{ctx['buses'][t0]['name']}: {cost_text(g(t0))}."),
        step('grid', 'capacity', 'review', 'o2', f"{ctx['buses'][f0]['name']}: charge {lim(g(f0), 'im')}, export {lim(g(f0), 'ex')}; upgrade cost {cost_text(g(f0))}."),
        step('land', 'area', 'review', 'o2', land_line(ctx, f0, '100 MW storage')),
        step('queue', 'cluster', 'review', 'o1', queue_line(ctx, t0)),
        step('prices', 'tails', 'review', 'o1', f"Daily 4-hour spread averages {price(b0['tb4']['mean'])}/MWh over {num(b0['tb4']['days'])} complete days at {ctx['buses'][t0]['name']} (the mart holds {price(tb(t0))}); {num(ctx['m'][t0]['year']['hours_gt_200'])} hours above ${SCARCITY} and {num(ctx['m'][t0]['year']['neg_hours'])} negative hours."),
        step('economics', 'bess', 'study', 'o1', f"Spread benchmark (100 MW × 4 h × TB4 × 365 × {num(RTE * 100)}% RTE): {money(b0['bench'])}/yr at {ctx['buses'][t0]['name']} vs {money(b1['bench'])}/yr at {ctx['buses'][f0]['name']}. The dispatch then caps charging at {mw(g(t0)['im']['value'])}."),
        step('decision', 'compare', 'review', 'o1', f"Trade-off: {ctx['buses'][t0]['name']} spread {price(b0['tb4']['mean'])} with charge limited to {mw(g(t0)['im']['value'])}; {ctx['buses'][f0]['name']} {price(b1['tb4']['mean'])} with the full 100 MW."),
        step('decision', 'record', 'study', 'o2', f"Record the decision, with the shoulder-charge limit at {ctx['buses'][t0]['name']} ({mw(g(t0)['im']['value'])}) as the stated reason."),
    ]
    return project('storage', f"{ctx['buses'][t0]['zone']} Storage 100 MW / 400 MWh (sample)", 'Storage developer', 'storage', 100, 100, narrative, options, steps)


def hybrid_project(ctx, picks):
    (h0, _), (r0, _) = picks
    g = lambda b: ctx['grid'][b]['hybrid150']
    d = ctx['det_of']; sp = d(h0)['spill']; sp1 = d(r0)['spill']
    options = [
        opt(ctx, 'o1', h0, 'POI below the array', f"Best 2025 mart solar ratio ({num(ctx['m'][h0].get('solarRatio'), 3)}) among buses with a land screen held whose export limit is 90–130 MW, below the 150 MW array: export {lim(g(h0), 'ex')}, shoulder charge {lim(g(h0), 'im')}."),
        opt(ctx, 'o2', r0, 'POI takes the array', f"Best 2025 mart solar ratio ({num(ctx['m'][r0].get('solarRatio'), 3)}) in {ctx['buses'][r0]['zone']} among buses that export 150 MW and charge 75 MW: export {lim(g(r0), 'ex')}."),
    ]
    narrative = (f"An IPP sizes a 150 MW solar array with a 75 MW / 300 MWh battery behind one point of interconnection. "
                 f"At {ctx['buses'][h0]['name']} the POI takes only {mw(sp['poi'])}, so solar alone would spill {num(sp['spillMWh'])} MWh a year "
                 f"({pct(100 * sp['share'])} of output, clear-sky assumption); the battery's job is to recover it.")
    steps = [
        step('market', 'find', 'screen', 'o1', market_line(ctx, 'hybrid150', '150 MW export with 75 MW shoulder charging') + f" {ctx['buses'][h0]['name']} is not one, by design: its POI is the constraint this sample studies."),
        step('prices', 'lmp', 'screen', 'o1', f"{ctx['buses'][h0]['name']}: {prices_line(ctx, h0)}."),
        step('land', 'area', 'review', 'o1', land_line(ctx, h0, 'a 150 MW solar + storage hybrid')),
        step('grid', 'capacity', 'review', 'o1', f"Export {lim(g(h0), 'ex')} against the 150 MW array; charge {lim(g(h0), 'im')} against 75 MW. The export limit is the POI cap Economics applies."),
        step('grid', 'cost', 'study', 'o1', f"{ctx['buses'][h0]['name']}: {cost_text(g(h0))}."),
        step('queue', 'cluster', 'review', 'o1', queue_line(ctx, h0)),
        step('prices', 'shape', 'review', 'o1', f"Clear-sky capture {price(d(h0)['capture']['price'])}/MWh, ratio {num(d(h0)['capture']['ratio'], 3)}; {num(ctx['m'][h0]['year']['neg_hours'])} negative hours in 2025 are the hours the battery should absorb."),
        step('economics', 'hybrid', 'study', 'o1', f"Solar-only row: {num(sp['spillMWh'])} MWh/yr spilled above the {mw(sp['poi'])} POI over {num(sp['spillHours'])} hours ({num(SOLAR_CF * 100)}% CF, {num(LOSS_PCT)}% losses). Read the 50% row (75 MW) for the energy the battery recovers."),
        step('economics', 'hybrid', 'study', 'o2', f"At {ctx['buses'][r0]['name']} the POI is {mw(sp1['poi'])}, so solar-only spill is {num(sp1['spillMWh'])} MWh/yr: the battery earns on arbitrage alone."),
        step('decision', 'compare', 'review', 'o1', f"Spill with no battery: {ctx['buses'][h0]['name']} {num(sp['spillMWh'])} MWh vs {ctx['buses'][r0]['name']} {num(sp1['spillMWh'])} MWh; export limits {mw(g(h0)['ex']['value'])} vs {mw(g(r0)['ex']['value'])}."),
        step('decision', 'record', 'study', 'o1', f"Record whether the {mw(150 - sp['poi'])} gap between array and POI is worth a battery, or a smaller array."),
    ]
    return project('hybrid', f"{ctx['buses'][h0]['name']} Solar + Storage 150 + 75 MW (sample)", 'IPP (hybrid)', 'hybrid', 150, 75, narrative, options, steps)


def dc_project(ctx, picks):
    ids = [b for b, _ in picks]
    g = lambda b: ctx['grid'][b]['dc300']
    d = ctx['det_of']; m = ctx['m']
    d0, d1 = ids[0], ids[1]
    L0 = d(d0)['load']
    options = [
        opt(ctx, 'o1', d0, 'Lowest-price fit', f"Lowest 2025 RT mean ({price(m[d0]['year']['avg_lmp'])}) of the ≥115 kV buses that import 300 MW on both the large-load and summer-peak charge cases: import {lim(g(d0), 'im')}."),
        opt(ctx, 'o2', d1, 'Second zone', f"Lowest-priced fit outside {ctx['buses'][d0]['zone']} ({price(m[d1]['year']['avg_lmp'])}): import {lim(g(d1), 'im')}."),
    ]
    if len(ids) > 2:
        s = ids[2]
        options.append(opt(ctx, 'o3', s, 'Studio campus bus', f"The Studio demo campus's first option (Merrimack Compute Campus). At 300 MW the import is {lim(g(s), 'im')}; upgrade cost {cost_text(g(s))}."))
    narrative = (f"A hyperscaler screens 300 MW of firm, flat load. {ctx['buses'][d0]['name']} fits the import on both study cases and a flat 300 MW load there would have cost "
                 f"{money(L0['bill'])} in 2025 energy, {pct(100 * L0['scarcityShare'])} of it in the {num(m[d0]['year']['hours_gt_200'])} hours above ${SCARCITY}/MWh"
                 + (f"; the Studio's campus bus {ctx['buses'][ids[2]]['name']} cannot take 300 MW." if len(ids) > 2 and g(ids[2])['im']['status'] != 'Fits' else '.'))
    steps = [
        step('market', 'find', 'screen', 'o1', market_line(ctx, 'dc300', '300 MW of load (large-load and summer-peak charge cases)')),
        step('prices', 'lmp', 'screen', 'o1', f"{ctx['buses'][d0]['name']}: {prices_line(ctx, d0)}."),
        step('grid', 'capacity', 'review', 'o1', f"Import {lim(g(d0), 'im')}; margin {mw(g(d0)['im']['margin'] if 'margin' in g(d0)['im'] else (g(d0)['im']['value'] - 300 if ok(g(d0)['im']['value']) else None))}. Only the import cases apply to a load."),
        step('grid', 'capacity', 'review', 'o3' if len(ids) > 2 else 'o2', f"{ctx['buses'][ids[-1]]['name']}: import {lim(g(ids[-1]), 'im')} against 300 MW." + (f" Large-load envelope {mw(next((c['envelope'] for c in g(ids[-1])['cases'] if c['key'] == 'large_load|charge'), None))}." if len(ids) > 2 else '')),
        step('grid', 'cost', 'study', 'o3' if len(ids) > 2 else 'o2', f"{ctx['buses'][ids[-1]]['name']}: {cost_text(g(ids[-1]))}."),
        step('land', 'area', 'review', 'o1', land_line(ctx, d0, 'a 300 MW data centre')),
        step('queue', 'cluster', 'review', 'o1', queue_line(ctx, d0)),
        step('prices', 'tails', 'study', 'o1', f"A flat 300 MW load at {ctx['buses'][d0]['name']}: {money(L0['bill'])} energy bill in 2025, {money(L0['scarcityCost'])} ({pct(100 * L0['scarcityShare'])}) from hours above ${SCARCITY}; {num(d(d0)['hoursUnder'])} hours were under ${CHEAP}."),
        step('economics', 'revenue', 'study', 'o1', f"For a load, Economics reads cost, not revenue: {num(L0['mwh'])} MWh at a mean {price(d(d0)['prices']['mean'])}/MWh = {money(L0['bill'])}. Capacity and transmission charges are placeholders until tariffs are held."),
        step('decision', 'compare', 'review', 'o1', 'Flat-load energy cost by option: ' + '; '.join(f"{ctx['buses'][b]['name']} {money(d(b)['load']['bill'])} ({lim(g(b), 'im')})" for b in ids) + '.'),
        step('decision', 'record', 'study', 'o1', f"Record the site with the import margin and the scarcity share ({pct(100 * L0['scarcityShare'])}) as the load-cost risk."),
    ]
    return project('campus', f"{ctx['buses'][d0]['zone']} Data Centre 300 MW (sample)", 'Large load / hyperscaler', 'datacenter', 0, 300, narrative, options, steps)


def wind_project(ctx, picks):
    ids = [b for b, _ in picks]
    g = lambda b: ctx['grid'][b]['wind200']
    f = ctx['floors']; m = ctx['m']; d = ctx['det_of']
    w0 = ids[0]
    options = [opt(ctx, 'o1', w0, 'Highest overnight floor', f"Highest 2025 overnight P25 ({price(f[w0]['p25'])}/MWh, hours 00–05) among Maine buses that export 200 MW on every case: export {lim(g(w0), 'ex')}.")]
    if len(ids) > 1:
        s = ids[1]
        options.append(opt(ctx, 'o2', s, 'Studio Downeast bus', f"The Studio demo Downeast Wind's first option. At 200 MW: export {lim(g(s), 'ex')}; overnight P25 {price(f[s]['p25'])}/MWh."))
    narrative = (f"A wind developer screens 200 MW in Maine, the Studio's Downeast Wind zone. Wind earns overnight, so the question is the price floor: "
                 f"{ctx['buses'][w0]['name']} held a 2025 overnight P25 of {price(f[w0]['p25'])}/MWh (P5 {price(f[w0]['p5'])}) and fits 200 MW"
                 + (f", while {ctx['buses'][ids[1]]['name']} exports only {mw(g(ids[1])['ex']['value'])}." if len(ids) > 1 and ok(g(ids[1])['ex']['value']) and g(ids[1])['ex']['status'] != 'Fits' else '.'))
    other = ids[1] if len(ids) > 1 else w0
    steps = [
        step('market', 'find', 'screen', 'o1', market_line(ctx, 'wind200', '200 MW of wind export')),
        step('prices', 'lmp', 'screen', 'o1', f"{ctx['buses'][w0]['name']}: {prices_line(ctx, w0)}."),
        step('land', 'area', 'review', 'o1', land_line(ctx, w0, '200 MW wind')),
        step('grid', 'capacity', 'review', 'o1', f"Export {lim(g(w0), 'ex')} against 200 MW."),
        step('grid', 'capacity', 'review', 'o2' if len(ids) > 1 else 'o1', f"{ctx['buses'][other]['name']}: export {lim(g(other), 'ex')}; upgrade cost {cost_text(g(other))}."),
        step('grid', 'cost', 'study', 'o2' if len(ids) > 1 else 'o1', f"{ctx['buses'][other]['name']}: {cost_text(g(other))}."),
        step('queue', 'cluster', 'review', 'o1', queue_line(ctx, w0)),
        step('prices', 'tails', 'review', 'o1', f"Overnight floor (hours 00–05, {num(f[w0]['n'])} hours): P5 {price(f[w0]['p5'])}, P25 {price(f[w0]['p25'])}/MWh; {num(m[w0]['year']['neg_hours'])} negative hours across the whole year."),
        step('economics', 'revenue', 'study', 'o1', f"Wind revenue uses the ISO-NE fleet wind shape (measured, not a site profile) at the 32.5% CF assumption, priced on {ctx['buses'][w0]['name']}'s 2025 RT mean of {price(d(w0)['prices']['mean'])}/MWh."),
        step('decision', 'compare', 'review', 'o1', 'Overnight P25 by option: ' + '; '.join(f"{ctx['buses'][b]['name']} {price(f[b]['p25'])} (export {lim(g(b), 'ex')})" for b in ids) + '.'),
        step('decision', 'record', 'study', 'o1', f"Record the site and the overnight floor ({price(f[w0]['p25'])} P25) as the price risk to watch."),
    ]
    return project('downeast', 'Maine Wind 200 MW (sample)', 'Wind developer', 'wind', 200, 0, narrative, options, steps)


WORKFLOW_TABS = {
    'market': ('find', 'rank', 'size', 'regions'),
    'land': ('area', 'footprint', 'corridor', 'permits'),
    'grid': ('capacity', 'constraints', 'cost', 'mitigation'),
    'queue': ('cluster', 'schedule', 'cash', 'changes'),
    'prices': ('lmp', 'basis', 'shape', 'tails'),
    'economics': ('revenue', 'bess', 'hybrid', 'finance'),
    'decision': ('compare', 'stress', 'readiness', 'record'),
}


def complete_workflow(p, ctx):
    """Give every analyzer a guided stop and an explicitly assumed planning input set.

    A demonstration can be numerically complete without pretending that an unheld
    parcel, engineering study, signed contract or queue position has been verified.
    """
    first = p['options'][0]['busId']
    tech, ex, im = p['tech'], p['exportMW'], p['importMW']
    d = ctx['det'][f'{tech}:{first}']
    g = ctx['grid'][first][{'solar': 'solar100', 'storage': 'storage100', 'hybrid': 'hybrid150',
                            'datacenter': 'dc300', 'wind': 'wind200'}[tech]]
    name = ctx['buses'][first]['name']
    p['assumptions'] = {
        'label': 'Illustrative planning inputs, not observed site facts or a quote',
        'ui': {
            'econ': {'solarCF': 15, 'windCF': 32.5, 'lossPct': 3, 'rte': 86,
                     'duration': 4, 'cycleCost': 3, 'degradation': 0.5},
            'fin': {'capex': {'solar': 130e6, 'storage': 120e6, 'hybrid': 260e6,
                             'datacenter': 1200e6, 'wind': 380e6}[tech],
                    'annualOM': {'solar': 2.6e6, 'storage': 3.0e6, 'hybrid': 5.2e6,
                                 'datacenter': 36e6, 'wind': 11.4e6}[tech],
                    'discountRate': 0.08, 'years': 25, 'constructionYears': 2, 'cod': 2029},
            'land': {'control': 60, 'route': 1.2, 'siteLat': round(ctx['buses'][first]['lat'] + 0.008, 5),
                     'siteLon': round(ctx['buses'][first]['lon'] - 0.008, 5),
                     'perMile': 2_000_000, 'terminal': 5_000_000, 'crossings': 500_000,
                     'buy': 25_000, 'lease': 1_500, 'disc': 8, 'years': 30, 'esc': 2, 'resale': 50,
                     'permits': {'start': '2027-01'},
                     **{f'po{i}': i * 2 for i in range(18)},
                     **{f'pd{i}': 6 + (i % 4) * 2 for i in range(18)}},
            'qStart': '2026-11-19', 'qCod': 2029, 'qRadius': 10,
        },
        'provenance': {
            'prices': 'Settled 2025 RT at the selected bus or explicitly labelled same-substation/proxy price node',
            'grid': 'Stored solved-case directional envelopes; no new engineering study',
            'land': 'Studio-copy regional screen where held. The offset site point, 60% site control, route, land terms, line works and permit timing are demo inputs, not a parcel, easement, permit or quote',
            'queue': 'Solved-case queue records; planning dates and upgrade cost are what-if inputs',
            'finance': 'Illustrative CAPEX, O&M, 8% discount, 25 operating years and 2029 COD; replace with a project estimate',
        },
    }
    # Revenue is a transparent demonstration value, not a contract or forward price.
    if tech in ('solar', 'wind'):
        cf = 0.15 if tech == 'solar' else 0.325
        px = d['capture']['price'] if tech == 'solar' else d['prices']['mean']
        annual = ex * 8760 * cf * 0.97 * px
        rev_note = f'{ex} MW × 8,760 h × {pct(100*cf)} assumed CF × 97% net output × {price(px)}/MWh observed 2025 price = {money(annual)}/yr. No PPA or REC proceeds assumed.'
    elif tech == 'hybrid':
        px = d['capture']['price']
        solar = ex * 8760 * 0.15 * 0.97 * px
        storage = (d.get('bench') or 0) * 0.3
        annual = solar + storage
        rev_note = f'Solar screen {money(solar)}/yr at observed clear-sky capture {price(px)}/MWh plus 30% of the {money(d.get("bench"))} four-hour spread benchmark = {money(annual)}/yr. This is an illustrative combined revenue ceiling, not metered dispatch.'
    elif tech == 'storage':
        annual = (d.get('bench') or 0) * 0.6
        rev_note = f'60% of the {money(d.get("bench"))} observed four-hour spread benchmark = {money(annual)}/yr. The 60% haircut is illustrative; use BESS dispatch for the chronological operating result.'
    else:
        annual = im * 500_000
        rev_note = f'Illustrative campus lease receipts: {im} MW × $500,000/MW-year = {money(annual)}/yr. This is an assumed customer contract, not revenue in the source data; electricity procurement is assessed separately.'
    p['assumptions']['ui']['fin']['annualRevenue'] = round(annual)
    p['assumptions']['revenueMethod'] = rev_note
    option_revenue = {}
    for option in p['options']:
        od = ctx['det'][f'{tech}:{option["busId"]}']
        if tech in ('solar', 'wind'):
            cf = 0.15 if tech == 'solar' else 0.325
            px = od['capture']['price'] if tech == 'solar' else od['prices']['mean']
            value = ex * 8760 * cf * 0.97 * px
        elif tech == 'hybrid':
            value = ex * 8760 * 0.15 * 0.97 * od['capture']['price'] + (od.get('bench') or 0) * 0.3
        elif tech == 'storage':
            value = (od.get('bench') or 0) * 0.6
        else:
            value = im * 500_000
        option_revenue[option['busId']] = round(value)
    p['assumptions']['optionAnnualRevenue'] = option_revenue
    p['assumptions']['optionSite'] = {
        o['busId']: {'siteLat': round(ctx['buses'][o['busId']]['lat'] + 0.008, 5),
                     'siteLon': round(ctx['buses'][o['busId']]['lon'] - 0.008, 5)} for o in p['options']
    }
    # The Queue calculator accepts an explicitly entered network-upgrade what-if.
    # A priced cost is used if held; otherwise the amount is a clearly disclosed placeholder.
    known = g['cost']['total'] if ok(g['cost']['total']) else None
    qnu = round(known, 2) if known is not None and known > 0 else round(max(ex, im) * 0.15, 2)
    p['assumptions']['ui']['qNuUser'] = qnu
    p['assumptions']['networkUpgradeMethod'] = (f'{musd(qnu)} is the priced study subtotal, not a final allocated cost; unpriced facilities remain open.' if known is not None and known > 0
                                                   else f'{musd(qnu)} = {max(ex, im)} MW × $0.15M/MW illustrative network-upgrade allowance; not a study estimate.')

    extras = {
        ('market', 'rank'): f'Rank candidate buses under this project’s {ex} MW export / {im} MW import request. Compare {name} with the pinned options; a score is a screen, not a permit or interconnection approval.',
        ('market', 'size'): f'Sweep request size around {ex or im} MW. Directional grid cases can change the ranking; use the same request on Grid before carrying a limit into Economics.',
        ('market', 'regions'): f'Compare ISO-NE regions at the selected technology and request size, then drill to {name}; an ISO-wide aggregate is not a site price.',
        ('land', 'footprint'): f'Use the {ex or im} MW technology footprint model and test clear-acreage sensitivity. The 60% site-control input is illustrative; parcel boundaries and title are not held.',
        ('land', 'corridor'): f'The 1.2-mile route is an illustrative input. Move the route and crossing assumptions to see cost sensitivity; no surveyed corridor or right-of-way is represented.',
        ('land', 'permits'): f'Review permit sequence and site-control threshold for {tech}. Dates and statuses remain unverified until entered; a regional exclusion screen cannot establish a permit.',
        ('grid', 'constraints'): f'Inspect limiting facilities and study vintage behind {name}’s export {lim(g, "ex")} and import {lim(g, "im")}. A missing facility list remains unassessed.',
        ('grid', 'mitigation'): f'Compare smaller requests or import caps with {name}’s stored directional envelope. Alternative POIs and unstudied mitigation stay conditional.',
        ('queue', 'schedule'): 'The 19 Nov 2026 window-close and 2029 target COD are illustrative. Compare tariff-clock minimums with observed completion durations; restudies can extend the path.',
        ('queue', 'cash'): f'Use {p["assumptions"]["networkUpgradeMethod"]} The cash ladder is a what-if until Grid sends a priced allocation.',
        ('queue', 'changes'): f'Inspect withdrawals, changed requests and study status near {name}. Nearby MW is context, not a one-for-one subtraction from grid headroom.',
        ('prices', 'basis'): f'Compare {name} with the internal hub only on matching 2025 RT intervals. Its price-node tier is {tier_text(ctx, first)}; basis and congestion inherit that evidence quality.',
        ('prices', 'shape'): f'Inspect hourly and seasonal shape at {name}; the default generation shape is a declared profile assumption, not measured output at this site.',
        ('prices', 'tails'): f'Inspect negative hours, P5/P95 and spread durations on the same 2025 RT observations. A tail metric is not a bankable revenue forecast.',
        ('economics', 'revenue'): f'Use 2025 RT and the declared profile assumptions for interval energy revenue. Finance’s illustrative input is: {rev_note}',
        ('economics', 'bess'): ('Run chronological 100 MW / 400 MWh dispatch with the actual directional import/export envelope and assumed 86% round-trip efficiency; perfect foresight is a benchmark.' if tech == 'storage' else 'Optional technology comparison: this project is not a stand-alone BESS. Change technology and request limits to size one; no battery earnings are automatically added to the project.'),
        ('economics', 'hybrid'): ('Compare PV-only and storage sizes behind the stored POI export limit; solar energy shifted into the battery is counted once.' if tech == 'hybrid' else 'Optional hybrid alternative: this project is not a solar-plus-storage plant. This tab can test a new configuration, but its value is not part of the base project.'),
        ('economics', 'finance'): f'All finance fields are populated with declared planning assumptions. Year-one revenue: {rev_note} CAPEX and O&M are illustrative; grid upgrades are incomplete until priced and sent from Grid.',
        ('decision', 'stress'): 'Stress the recommendation against price, connection, site and queue uncertainties. An unheld study or parcel stays an open risk, not a passed screen.',
        ('decision', 'readiness'): 'Review which evidence is held, which planning inputs were assumed and which approvals or costs remain open before advancing this option.',
    }
    existing = {(s['stage'], s['tab']): s for s in p['steps']}
    complete = []
    for stage, tabs in WORKFLOW_TABS.items():
        for tab in tabs:
            s = existing.get((stage, tab))
            if s is None:
                s = step(stage, tab, 'study' if stage in ('economics', 'decision') else 'review', p['options'][0]['id'], extras[(stage, tab)])
            elif stage == 'economics' and tab == 'finance':
                s['what_to_look_at'] = extras[(stage, tab)]
            elif stage == 'prices' and tab == 'lmp':
                s['what_to_look_at'] += ' In LMP & years, add 2024 to 2025 and Apply analysis to compare a two-year result and its contribution audit; return to 2025 for the single-year figures quoted here. Historical and forecast runs stay separate.'
            complete.append(s)
    p['steps'] = complete
    p['coverage'] = {'analyzers': len(complete), 'observedSources': ['2025 RT prices', 'stored grid envelopes', 'solved-case queue records'],
                     'assumedInputs': ['site point and control', 'route and line costs', 'land terms and permit timing', 'network-upgrade allowance when no priced subtotal', 'CAPEX', 'O&M', 'annual revenue', 'COD'],
                     'openEvidence': ['parcel/site control proof', 'final interconnection study', 'unpriced upgrade scope', 'executed revenue contract']}


def step(stage, tab, depth, option, text):
    return {'stage': stage, 'tab': tab, 'depth': depth, 'option': option, 'what_to_look_at': text}


def project(pid, name, client, tech, ex, im, narrative, options, steps):
    return {'id': pid, 'name': name, 'client_type': client, 'tech': tech, 'exportMW': ex, 'importMW': im, 'narrative': narrative,
            'options': options, 'basis': dict(BASIS), 'steps': steps}


if __name__ == '__main__':
    _orig_build = build

    def build_with_det():
        # det_of is attached after node_eval; resolve lazily through a closure on ctx.
        return _orig_build()
    build()
