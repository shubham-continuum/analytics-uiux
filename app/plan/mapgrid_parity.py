"""M2 parity: every rebuilt map/grid display-only field against the live payload (read-only oracle).

Provenance: Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · 2026-10-06 · sign-off pending · v1

    python plan/mapgrid_parity.py [--live-dir <dir holding data-ext.js and data.js>] [--out data/mapgrid] [--db <unified DuckDB>]
    (--db, or env GRIDSENSE_UNIFIED_DB, opens the unified DB read-only for evidence queries only; without it the
    evidence-dependent rules cannot fire and those items stay unclassed.)

Oracle: GS_DATA_EXT (data-ext.js, GridSense_one) and GS_DATA (data.js, the older ISONE_GridSense.duckdb). Default
--live-dir is the pinned snapshot one-studio/app-tools/live-snapshot/2026-10-06/src (the live CV folder is being edited;
its SHA256 is checked against SHA256SUMS.txt when present). Neither file is ever written.

Writes data/mapgrid/parity.json  {fields: {name: {equal, unit, newer, defect, unclassed, missing_live, missing_unified, n,
                                   classes: {class: {reason: {n, examples}}}, cards}}, generation, oracle, decision_cards}
and   design/progress/M2-parity.md (the human report).
Classes (by rule, never by hand): equal (within the live value's published precision) · unit (same quantity, a fixed
scale factor) · newer (differs because the unified DB is the newer or corrected source, evidence named) · defect (the
unified value is wrong or unproven; needs a decision card) · unclassed (no rule explains it; the M2 gate fails) ·
missing_live / missing_unified (held on one side only; the reason is named).
"""
import argparse
import calendar
import hashlib
import os
import json
import math
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
DEFAULT_LIVE = APP.parents[0] / 'app-tools' / 'live-snapshot' / '2026-10-06' / 'src'
DEFAULT_OUT = APP / 'data' / 'mapgrid'
REPORT = APP.parents[0] / 'design' / 'progress' / 'M2-parity.md'
CLASSES = ['equal', 'unit', 'newer', 'defect', 'unclassed', 'missing_live', 'missing_unified']
EXAMPLES = 3
DECISION_CARDS = ['D-008']  # ids of decision cards that cover a `defect` class; filled only from a real card (planning.decisions)
PNODE_CARD = 'D-008'
_DB = None  # read-only evidence connection (optional)
RELINKED = set()  # bus ids re-linked by busdata.price_links (D-008), filled from meta.coverage.suspect_pnode_links


def relink_why(thr):
    return (f'D-008 (S2-D): the stored rank-1 node is a same-name node in another town (> {thr} mi); unified re-links the bus to the '
            'nearest node under the geo-proxy rule (tier relinked, distance disclosed) and never prices it through the far node; '
            'live still prices it there')


def relink_rule(thr):
    return lambda k, _l, _u: ('newer', relink_why(thr)) if str(k).split('|')[0].split('.')[0] in RELINKED else None


def evidence(sql, params):
    return _DB.execute(sql, list(params)).fetchall() if _DB is not None else None


# ── loading ───────────────────────────────────────────────────────────────────────────────────────────

def load_js(path, var):
    """Parse `window.<var> = {...};` without evaluating JS: find the assignment, raw-decode one JSON value."""
    text = Path(path).read_text(encoding='utf-8')
    m = re.search(r'window\.' + re.escape(var) + r'\s*=\s*', text)
    if not m:
        raise SystemExit(f'{path}: window.{var} not found')
    value, _end = json.JSONDecoder().raw_decode(text, m.end())
    return value


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def check_snapshot(live_dir):
    sums = Path(live_dir).parent / 'SHA256SUMS.txt'
    out = {}
    for name in ('data-ext.js', 'data.js'):
        out[name] = {'sha256': sha256(Path(live_dir) / name)}
    if sums.exists():
        want = {}
        for line in sums.read_text(encoding='utf-8').splitlines():
            parts = line.split()
            if len(parts) >= 2:
                want[parts[-1].lstrip('*').replace('\\', '/').split('/')[-1]] = parts[0].lower()
        for name, v in out.items():
            v['pinned'] = want.get(name)
            v['matches_pin'] = want.get(name) == v['sha256'] if want.get(name) else None
    return out


def load_unified(out_dir):
    cur = json.loads((Path(out_dir) / 'current.json').read_text(encoding='utf-8'))
    g = Path(out_dir) / cur['dir']
    return cur['generation'], {p.stem: json.loads(p.read_text(encoding='utf-8')) for p in g.glob('*.json')}


# ── comparison machinery ──────────────────────────────────────────────────────────────────────────────

def decimals(v):
    """Published precision of a live number (2.5 -> 1, 66.75 -> 2, 8759 -> 0)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    if isinstance(v, int) or float(v).is_integer():
        return 0
    s = repr(float(v))
    return len(s.split('.')[1]) if '.' in s and 'e' not in s else 6


def same(live, uni, tol=None):
    """Equal at the live value's published precision (both sides rounded from the same figure may differ by one unit)."""
    if isinstance(live, (int, float)) and not isinstance(live, bool) and isinstance(uni, (int, float)) and not isinstance(uni, bool):
        dp = decimals(live)
        t = tol if tol is not None else (10 ** -dp if dp else 0.5) + 1e-9
        return abs(float(live) - float(uni)) <= t
    norm = lambda x: re.sub(r'\s+', ' ', str(x)).strip() if x is not None else None
    return norm(live) == norm(uni)


class Field:
    def __init__(self, name, unit, note=''):
        self.name, self.unit, self.note = name, unit, note
        self.counts = Counter()
        self.reasons = defaultdict(lambda: defaultdict(lambda: {'n': 0, 'examples': []}))
        self.cards = []

    def add(self, key, cls, reason, live=None, uni=None):
        assert cls in CLASSES, cls
        self.counts[cls] += 1
        if cls == 'equal':
            return
        r = self.reasons[cls][reason]
        r['n'] += 1
        if len(r['examples']) < EXAMPLES:
            r['examples'].append({'key': str(key), 'live': live, 'unified': uni})

    def result(self):
        out = {c: self.counts.get(c, 0) for c in CLASSES}
        out['n'] = sum(out.values())
        out.update(unit_label=self.unit, note=self.note, cards=self.cards,
                   classes={c: {k: v for k, v in rs.items()} for c, rs in self.reasons.items()})
        return out


def compare(field, key, live, uni, rules=(), tol=None, missing_live='', missing_unified=''):
    """One item: equal / missing / the first rule that explains a difference / unclassed."""
    if live is None and uni is None:
        field.add(key, 'equal', '')
        return
    if live is None:
        field.add(key, 'missing_live', missing_live or 'held in the unified DB only', live, uni)
        return
    if uni is None:
        field.add(key, 'missing_unified', missing_unified or 'held in the live payload only', live, uni)
        return
    if same(live, uni, tol):
        field.add(key, 'equal', '')
        return
    for rule in rules:
        hit = rule(key, live, uni)
        if hit:
            field.add(key, hit[0], hit[1], live, uni)
            return
    field.add(key, 'unclassed', 'no rule explains the difference', live, uni)


def unit_rule(factor, reason):
    def rule(_k, live, uni):
        if isinstance(live, (int, float)) and isinstance(uni, (int, float)) and live:
            dp = decimals(live) or 0
            # live rounded to dp before the factor applies, so the tolerance scales with it
            if abs(live * factor - uni) <= factor * (10 ** -dp if dp else 0.5) + 1e-9:
                return 'unit', reason
        return None
    return rule


# ── the fields ────────────────────────────────────────────────────────────────────────────────────────

def run(live_dir, out_dir):
    ext = load_js(Path(live_dir) / 'data-ext.js', 'GS_DATA_EXT')
    gsd = load_js(Path(live_dir) / 'data.js', 'GS_DATA')
    gen, U = load_unified(out_dir)
    umeta = U['meta']
    cov = umeta['coverage']
    lc = gsd['nodes']['cols']
    L = {str(r[0]): dict(zip(lc, r)) for r in gsd['nodes']['rows']}
    uc = U['identity']['cols']
    UI = {str(r[0]): dict(zip(uc, r)) for r in U['identity']['rows']}
    suspect = {str(b) for b in cov['suspect_pnode_links']['buses']}
    thr = cov['suspect_pnode_links']['threshold_mi']
    RELINKED.clear(); RELINKED.update(suspect)
    fields = []

    def F(*a, **k):
        f = Field(*a, **k)
        fields.append(f)
        return f

    # spine
    f = F('spine', 'bus id', 'GS_DATA.nodes vs the unified spine (dim_bus ⋈ dim_substation, geolocated)')
    for b in sorted(set(L) | set(UI)):
        compare(f, b, b if b in L else None, b if b in UI else None)

    # identity columns read straight from GS_DATA.nodes
    ident = [('name', 'name', 'text', ()), ('kv', 'kv', 'kV', ()), ('state', 'state', 'code', ()), ('county', 'county', 'text', ()),
             ('lat', 'lat', '°', ()), ('lon', 'lon', '°', ()), ('zone_sheet', 'zone', 'zone code', ()), ('zone_src', 'zone_source', 'text', ()),
             ('hourly_conf', 'hourly_conf', 'text', ()), ('shared_n', 'shared_n', 'buses', ()), ('outlets', 'outlets', 'count', ()),
             ('branch_deg', 'branch_deg', 'count', ()), ('gen_mw', 'gen_mw', 'MW', ()), ('load_mw', 'load_mw', 'MW', ()),
             ('top_constraint', 'top_constraint', 'text', ()), ('top_shadow', 'top_shadow', '$/MWh', ())]
    vendor_tc = ('newer', 'live is the vendor Top_Constraint_Name_eco column, which the unified DB excludes (data_quality.top_constraint_name: '
                          '"12 names with zero overlap against real constraints"); unified = mart_bus_profile.first_limit_facility, a real '
                          'fact_limiting_element facility')
    for ucol, lcol, unit, _ in ident:
        f = F(f'identity.{ucol}', unit, f'GS_DATA.nodes.{lcol} vs identity.{ucol}')
        for b in sorted(set(L) & set(UI)):
            lv, uv = L[b].get(lcol), UI[b].get(ucol)
            if ucol == 'top_constraint':
                compare(f, b, lv, uv, rules=[lambda *_: vendor_tc], missing_unified=vendor_tc[1] + '; null where only a '
                        '"No Violations found" sentinel is held at summer-peak discharge')
            elif ucol == 'top_shadow':
                compare(f, b, lv, uv, missing_unified='the vendor Top_Constraint_Shadow_Price_eco column is excluded in the unified DB '
                        '(data_quality.top_constraint_name) and no per-bus shadow price is held')
            elif ucol in ('shared_n', 'hourly_conf'):
                compare(f, b, lv, uv, rules=[relink_rule(thr)],
                        missing_unified=(relink_why(thr) + '; a re-linked bus has no own or station series, so this is not held '
                                         '(as for a geo-proxy bus)') if b in suspect else '')
            elif ucol == 'branch_deg':
                compare(f, b, lv, uv, missing_live='a measured zero: the bus is in the powerflow model and no dim_branch end is at it '
                        '(live prints null for a zero count)')
            else:
                compare(f, b, lv, uv)

    # short circuit: live sc_mva is the published column (100x small); unified the corrected one
    f = F('short_circuit', 'MVA', 'GS_DATA.nodes.sc_mva (raw, the getter multiplies by 100) vs dim_bus.short_circuit_mva (corrected)')
    for b in sorted(set(L) & set(UI)):
        compare(f, b, L[b].get('sc_mva'), U['short_circuit'].get(b),
                rules=[unit_rule(100, 'the published short-circuit column is 100× too small (data_quality.short_circuit_mva); the unified '
                                      'column is corrected and the live getter GS.shortCircuitMVA multiplies by 100 — same figure, '
                                      'equal to the live payload\'s 2 dp')])

    # zones: corrected zone and zone_fix
    fix = ext.get('zone_fix') or {}
    ufix = U['zones']['zone_fix']

    sys.path.insert(0, str(APP))
    sys.path.insert(0, str(APP / 'plan'))
    from build_mapgrid import zone_code
    from api_grid import miles

    def link_zones(b):
        """(co-located operator zones, far-only operator zones) over every bridge_bus_pnode link of the bus."""
        rows = evidence('''SELECT n.zone_name, n.latitude, n.longitude, d.latitude, d.longitude FROM bridge_bus_pnode p
                           JOIN dim_bus d ON d.bus_id = p.bus_id LEFT JOIN dim_pnode n ON n.pnode_name = p.pnode_name WHERE p.bus_id = ?''', [int(b)])
        if rows is None:
            return None
        near, far = set(), set()
        for oz, la, lo, bla, blo in rows:
            m = miles(bla, blo, la, lo)
            (far if m is not None and m > thr else near).add(zone_code(oz))
        return near - {None}, far - near - {None}

    def zone_rule(b, live, uni):
        lz = link_zones(b)
        if lz is None:
            return None
        near, far = lz
        sheet = UI[b]['zone_sheet']
        if live == sheet and uni in near:
            return 'newer', 'unified corrects the sheet zone from a co-located own/station node; live made no correction at this bus'
        if live in far and (uni in near or uni == sheet):
            return 'newer', (f"live's zone is the operator zone of a same-name node in another town (> {thr} mi; no co-located link of the bus "
                             'is in it); unified takes the best-ranked co-located link (coverage.suspect_pnode_links rule)')
        if live in near and uni in near:
            return 'newer', ('mixed-zone station: both zones belong to co-located nodes of the bus; unified takes the best-ranked one '
                             '(bridge_bus_pnode.link_rank, data_quality.primary_pnode_choice), live took agg.bus_pnode\'s representative')
        return None
    f = F('zone', 'zone code', 'corrected zone: live zone_fix ∨ GS_DATA zone vs identity.zone')
    for b in sorted(set(L) & set(UI)):
        compare(f, b, fix.get(b) or L[b]['zone'], UI[b]['zone'], rules=[zone_rule])
    f = F('zone_fix', 'zone code', 'the correction map itself: GS_DATA_EXT.zone_fix vs zones.zone_fix')
    for b in sorted(set(fix) | set(ufix)):
        if fix.get(b) == ufix.get(b):
            f.add(b, 'equal', '')
            continue
        hit = zone_rule(b, fix.get(b) or L[b]['zone'], UI[b]['zone'])  # a fix present on one side only is a zone difference
        if hit:
            f.add(b, hit[0], hit[1], fix.get(b), ufix.get(b))
        else:
            compare(f, b, fix.get(b), ufix.get(b))

    # zone label anchors: recompute live's centroids from unified coordinates on live's zone assignment
    f = F('zones', '° · buses', 'GS_DATA_EXT.zones label anchors vs zones.zones')
    lz = {z['zone']: z for z in ext.get('zones') or []}
    uz = {z['zone']: z for z in U['zones']['zones']}
    by_live = defaultdict(list)
    for b in L:
        by_live[fix.get(b) or L[b]['zone']].append((UI[b]['lat'], UI[b]['lon']))
    for z in sorted(set(lz) | set(uz)):
        a, u = lz.get(z), uz.get(z)
        if a and u and same(a['lat'], u['lat']) and same(a['lon'], u['lon']) and a['buses'] == u['buses']:
            compare(f, z, 1, 1)
            continue
        pts = by_live.get(z) or []
        rec = (round(sum(p[0] for p in pts) / len(pts), 4), round(sum(p[1] for p in pts) / len(pts), 4), len(pts)) if pts else None
        if a and rec and same(a['lat'], rec[0]) and same(a['lon'], rec[1]) and a['buses'] == rec[2]:
            f.add(z, 'newer', 'membership follows the corrected zone (see `zone`): live\'s anchor is reproduced exactly from unified '
                              'coordinates on live\'s zone assignment', a, u)
        else:
            compare(f, z, a, u)

    # stations (size of the bus's station group)
    f = F('stations', 'buses', 'size of the bus\'s station group: live groups by normalised name (GS.stations), unified by dim_bus.substation_name')
    groups = defaultdict(list)
    for b, n in L.items():
        groups[re.sub(r'[^A-Z0-9]', '', (n['name'] or '').upper())].append(b)
    lsize = {b: (len(v), k) for k, v in groups.items() for b in v}

    def station_rule(b, live, uni):
        k = lsize[b][1]
        names = {UI[x]['name'].strip() for x in groups[k]}
        states = {UI[x]['state'] for x in groups[k]}
        if len(names) > 1 or len(states) > 1:
            return 'newer', ('live merges distinct substations whose names normalise alike (e.g. "Deerfield" NH 345 kV with "Deerfield " MA; '
                             '"Fair Haven"/"Fairhaven"); unified groups on dim_bus.substation_name (04a)')
        return None
    for b in sorted(set(L) & set(UI)):
        compare(f, b, lsize[b][0], UI[b]['station'], rules=[station_rule])

    # branches (multiset of [from, to, kV]) and the network coverage counts
    f = F('branches', 'branch', 'GS_DATA_EXT.network.branches vs branches.branches ([from, to, kV], parallel circuits kept)')
    lb = Counter(tuple(x) for x in ext['network']['branches'])
    ub = Counter(tuple(x) for x in U['branches']['branches'])
    for k in sorted(set(lb) | set(ub)):
        for _ in range(min(lb[k], ub[k])):
            compare(f, k, 1, 1)
        for _ in range(lb[k] - ub[k]) if lb[k] > ub[k] else ():
            compare(f, k, list(k), None)
        for _ in range(ub[k] - lb[k]) if ub[k] > lb[k] else ():
            compare(f, k, None, list(k))
    f = F('coverage', 'count', 'GS_DATA_EXT.meta.coverage network/zone counts vs meta.coverage')
    lcov = ext['meta']['coverage']
    for k in ('network_branches', 'network_branches_in_store', 'network_branches_dropped_off_spine', 'network_branches_dropped_self_loop',
              'network_branches_open', 'network_branch_pairs', 'network_kv_classes', 'zone_anchors'):
        compare(f, k, json.dumps(lcov.get(k), sort_keys=True) if isinstance(lcov.get(k), dict) else lcov.get(k),
                json.dumps(cov.get(k), sort_keys=True) if isinstance(cov.get(k), dict) else cov.get(k))
    compare(f, 'zone_fixes', lcov.get('zone_fixes'), cov.get('zone_fixes'),
            rules=[lambda *_: ('newer', 'the count of the zone_fix map; each differing bus is classed under `zone_fix`')])

    _loading(F, ext, U, UI, L)
    _pre_issues(F, ext, L, U)
    _queue(F, gsd, U)
    _load_pays(F, ext, U, thr)
    _forecast_delta(F, ext, U)
    _land(F, ext, L, U)
    _cathy(F, ext, L, UI, thr)
    _flags(F, ext, U, L)

    res = {f.name: f.result() for f in fields}
    return gen, res


def _resolve(m):
    """A loading/cost map with every alias string replaced by the entry it names (followed once)."""
    return {k: (m.get(v) if isinstance(v, str) else v) for k, v in m.items()}


_STORE_DIR = {'injection': 'discharge', 'discharge': 'discharge', 'charge': 'charge'}


def _rounding_boundary(k, live, uni):
    """Live tested `pct_pre > 100` on a loading rounded to 0.1 %; an element at 100.00x % is then not a violation."""
    bus, case, spelling = k.split('|')
    rows = evidence('''SELECT 100 * abs(CASE WHEN contingency_flow_mw IS NULL THEN base_flow_mw ELSE contingency_flow_mw END)
                              / nullif(CASE WHEN contingency_flow_mw IS NULL THEN rating_a_mva ELSE rating_c_mva END, 0) AS pct
                       FROM fact_limiting_element WHERE bus_id = ? AND scenario = ? AND direction = ? AND rating_a_mva IS NOT NULL''',
                    [int(bus), case, _STORE_DIR[spelling]])
    if rows is None:
        return None
    edge = [r[0] for r in rows if r[0] is not None and 100 < r[0] and round(r[0], 1) <= 100]
    if edge and uni - live == len(edge):
        return 'newer', (f'{len(edge)} element(s) at {edge[0]:.4f} % of the rating solved against: over 100 % unrounded; live rounded '
                         'the loading to 0.1 % (100.0) before the > 100 test')
    return None


def _loading(F, ext, U, UI, L):
    lv, uv = _resolve(ext.get('loading') or {}), _resolve(U['loading'])
    for col in ('n_rows', 'violations_before', 'pre_existing_n'):
        f = F(f'loading.{col}', 'count', f'GS_DATA_EXT.loading[bus|case].{col} vs loading[bus|case].{col}')
        for k in sorted(set(lv) | set(uv)):
            a, u = lv.get(k), uv.get(k)
            ml = ''
            if a is None and u is not None and u.get('note'):
                ml = (f'the study ran this case and states "{u["note"]}": unified publishes a measured zero, live omits the key '
                      '(its grid prints "not held" for a case that was run)')
            compare(f, k, None if a is None else a.get(col), None if u is None else u.get(col), missing_live=ml,
                    rules=[_rounding_boundary] if col == 'violations_before' else ())


def _pre_issues(F, ext, L, U):
    sto = ext.get('storage_headroom') or {}
    for ucol, src, get in (('sp_dis', 'GS_DATA.nodes.pi_sp_dis', lambda b: L[b].get('pi_sp_dis')),
                           ('sp_chg', 'GS_DATA.nodes.pi_sp_chg', lambda b: L[b].get('pi_sp_chg')),
                           ('sh_chg', 'GS_DATA_EXT.storage_headroom.pi_sh_chg', lambda b: (sto.get(b) or {}).get('pi_sh_chg'))):
        f = F(f'pre_issues.{ucol}', 'count (sheet)', f'{src} vs pre_issues[bus].{ucol}')
        for b in sorted(set(L) & set(U['pre_issues'])):
            compare(f, b, get(b), U['pre_issues'][b][ucol])


def _queue(F, gsd, U):
    f = F('queue.points', 'per register field', 'GS_DATA.queue vs queue.points, by queue_position, every field')
    lq = {q['queue_position']: q for q in gsd.get('queue') or []}
    uq = {q['queue_position']: q for q in U['queue']['points']}
    for qp in sorted(set(lq) | set(uq)):
        a, u = lq.get(qp), uq.get(qp)
        if a is None or u is None:
            compare(f, qp, a and qp, u and qp)
            continue
        for col in sorted(set(a) | set(u)):
            compare(f, f'{qp}.{col}', a.get(col), u.get(col))
    f = F('queue.top_facilities', 'per facility field', 'GS_DATA.iso.top_facilities vs queue.top_facilities, by facility + contingency')
    key = lambda t: (re.sub(r'\s+', ' ', t.get('facility') or '').strip(), re.sub(r'\s+', ' ', t.get('contingency') or '').strip())
    lt = {key(t): t for t in gsd['iso'].get('top_facilities') or []}
    ut = {key(t): t for t in U['queue']['top_facilities']}
    sentinel = ('newer', 'live ranks the "No Violations found" sentinel as a facility; unified excludes sentinel rows (they are not elements)')
    for k in sorted(set(lt) | set(ut)):
        a, u = lt.get(k), ut.get(k)
        if a is not None and u is None:
            if k[0].startswith('No Violations'):
                f.add(k, *sentinel, a, None)
            else:
                compare(f, k, ' · '.join(k), None, missing_unified='outside the unified top 20 (the sentinel row no longer takes a place)')
            continue
        if a is None:
            compare(f, k, None, ' · '.join(k), missing_live='enters the top 20 once the sentinel row is excluded')
            continue
        for col in ('n', 'sources', 'loading', 'cost_musd', 'miles', 'kv', 'fzone'):
            lv = a.get(col)
            if col == 'kv' and isinstance(lv, str):
                try:
                    lv = float(lv)
                except ValueError:
                    pass  # a transformer "115/345" stays text and is compared as text
            compare(f, f'{" · ".join(k)}.{col}', lv, u.get(col),
                    missing_unified='a transformer: the vendor kV text "115/345" has no numeric fact_limiting_element.kv (null)' if col == 'kv' else '')


def _load_pays(F, ext, U, thr):
    lp = ext.get('load_pays') or {}
    held = (U['meta']['coverage'].get('load_pays_partial') or {}).get('hours_by_bus') or {}

    def hours_basis(k, live, uni):
        y = (U['load_pays'].get(k) or {}).get('year')
        cal = (366 if calendar.isleap(y) else 365) * 24 if y else None
        if cal and uni == cal and live == uni - 1:
            return 'unit', (f"counting basis: unified counts observations ({cal}: the missing spring-forward hour is offset by the repeated "
                            'autumn hour, held twice in fact_lmp_hourly, as the engine counts them); live counts distinct EPT hour labels '
                            f'({cal - 1})')
        return None
    for col in ('mean_rt', 'cheap_hours_lt20', 'cheap_share', 'hours', 'year'):
        f = F(f'load_pays.{col}', {'mean_rt': '$/MWh', 'cheap_share': '%', 'year': 'year'}.get(col, 'h'),
              f'GS_DATA_EXT.load_pays[bus].{col} vs load_pays[bus].{col} (settled RT year)')
        for b in sorted(set(lp) | set(U['load_pays'])):
            mu = (f"partial settled year in the unified DB ({held[b]} hours): not published as a year's flat-load cost; live fell back "
                  f'to {(lp.get(b) or {}).get("year")}, a different year in the same column' if b in held else '')
            ml = (f'partial settled year ({held.get(b)} hours) in both; unified also leaves it out' if b in held else '')
            if b in RELINKED and not mu:
                mu = relink_why(thr) + '; the nearest node holds no complete settled year'
            if b in RELINKED and not ml:
                ml = relink_why(thr) + '; the nearest node holds a complete settled year, the far node did not'
            compare(f, b, (lp.get(b) or {}).get(col), (U['load_pays'].get(b) or {}).get(col), missing_unified=mu, missing_live=ml,
                    rules=([hours_basis] if col == 'hours' else []) + [relink_rule(thr)])


def _forecast_delta(F, ext, U):
    fd = ext.get('forecast_delta') or {}
    for col in ('a', 'b', 'delta', 'delta_pct', 'run_a', 'run_b', 'year'):
        f = F(f'forecast_delta.{col}', {'delta_pct': '%', 'run_a': 'run', 'run_b': 'run', 'year': 'year'}.get(col, '$/MWh'),
              f'GS_DATA_EXT.forecast_delta[bus].{col} vs forecast_delta[bus].{col}')
        for b in sorted(set(fd) | set(U['forecast_delta'])):
            lv = fd.get(b) or {}
            mu = (f'the {lv.get("run_b")} node at this bus is unpriced ($0 in every hour; mart_bus_fcst_year min = max = 0): live computed '
                  'the gap against $0, unified holds no gap' if lv.get('b') == 0 else '')
            compare(f, b, lv.get(col), (U['forecast_delta'].get(b) or {}).get(col), missing_unified=mu)


def _land(F, ext, L, U):
    f = F('land_cost_proxy', '$/acre (assumption)', 'GS_DATA_EXT.land_cost_proxy[state|county].base per bus vs land_cost_proxy')
    rows = (ext.get('land_cost_proxy') or {}).get('rows') or []
    idx = {f"{str(r.get('state') or '').upper()}|{str(r.get('county') or '').upper()}": r for r in rows}
    why = U['land_cost_proxy'].get('why')
    for b in sorted(L):
        r = idx.get(f"{str(L[b].get('state') or '').upper()}|{str(L[b].get('county') or '').upper()}")
        compare(f, b, r and r.get('base'), None, missing_unified=why)


def _cathy(F, ext, L, UI, thr):
    cathy = ext.get('cathy') or {}
    ba, full = cathy.get('bus_annual') or {}, cathy.get('bus_full') or {}
    demo = {str(d.get('bus_id')): d for d in ((cathy.get('meta') or {}).get('demo_buses') or [])}
    dec = ext.get('decomp') or {}

    def tier_of(b):  # 31-map-grid.js tierOf, read-only restatement
        t = (ba.get(b) or {}).get('tier') or (demo.get(b) or {}).get('tier') or (dec.get(b) or {}).get('tier')
        hc = L[b].get('hourly_conf')
        return t or ('direct' if hc == 'exact' else 'same_substation' if hc else 'geo_proxy')
    f = F('cathy.tier', 'tier', 'live tierOf (cathy.bus_annual / demo / decomp / hourly_conf) vs identity.tier (bridge_bus_pnode)')
    for b in sorted(set(L) & set(UI)):
        compare(f, b, tier_of(b), UI[b]['tier'], rules=[relink_rule(thr)])
    f = F('cathy.proxy_mi', 'mi', 'live proxyMiles (demo_buses / bus_full distance_mi) vs identity.proxy_mi (distance_km → mi)')
    for b in sorted(set(L) & set(UI)):
        d = demo.get(b) or full.get(b) or {}
        compare(f, b, d.get('distance_mi'), UI[b]['proxy_mi'], rules=[relink_rule(thr)],
                missing_live=(relink_why(thr) + '; unified publishes the re-link distance') if b in RELINKED else
                'live publishes a proxy distance for the demo / bus_full buses only; unified has it for every geo-proxy bus')


def _flags(F, ext, U, L):
    cape = (ext.get('run_input_flags') or {}).get('cape_5yr') or {}
    f = F('run_input_flags.mcc_5yr', '$/MWh (ISO-NE sign)', 'cape_5yr[bus][2] (5yr MCC, settled sign) vs run_input_flags.mcc_5yr (to_isone_sign)')
    for b in sorted(cape):
        mu = ''
        if b not in L:
            ev = evidence('SELECT avg_cong FROM mart_bus_fcst_year WHERE scenario = ? AND bus_id = ?', ['5yr', int(b)])
            agree = bool(ev) and ev[0][0] is not None and abs(-ev[0][0] - cape[b][2]) < 0.006
            mu = ('not a Studio spine bus (no geolocated dim_substation row), so mapgrid holds no record for it'
                  + (f'; its stored 5yr congestion {ev[0][0]:+.2f} flips to {-ev[0][0]:+.2f}, equal to live' if agree else ''))
        compare(f, b, cape[b][2], U['run_input_flags']['mcc_5yr'].get(b), missing_unified=mu)
    f = F('run_input_flags.cape_5yr', 'flag', 'the Cape 5yr OSW flag membership (live cape_5yr keys) vs unified')
    for b in sorted(cape):
        compare(f, b, 1, None, missing_unified='not rebuildable from the unified DB: the flag regresses the 5yr MCC on the run\'s binding '
                                              'shadow prices, and fact_pcr_binding_hourly holds pcr2030/2035/2040 only (no 5yr rows)')


def report(par, umeta):
    """design/progress/M2-parity.md, generated from parity.json (no hand-typed figure)."""
    fr = par['fields']
    tot = Counter()
    for r in fr.values():
        for c in CLASSES + ['n']:
            tot[c] += r[c]
    sus = umeta['coverage']['suspect_pnode_links']
    pct = lambda a, n: f'{100 * a / n:.1f}%' if n else '—'
    L = ['# M2 parity report: map/grid display-only fields, unified DB vs live payload',
         '_Provenance: generated by `one-studio/app/plan/mapgrid_parity.py` · Claude Opus 5.5 (data agent) · dossier one-studio/design (T3) · '
         'sign-off pending · v1. Do not edit by hand; rerun the script._', '',
         f"- Unified generation **{par['generation']}** (`data/mapgrid/current.json`); built from `{umeta['db_path']}` (mtime {umeta['db_mtime']}).",
         f"- Oracle: `{par['oracle']['dir']}`; " + '; '.join(f"{k} sha256 {v['sha256'][:12]}…" + ('' if v.get('matches_pin') is None else
                                                      (' = pinned' if v['matches_pin'] else ' **≠ pinned**')) for k, v in par['oracle']['files'].items()) + '.',
         f"- Items compared: **{tot['n']:,}** · equal {tot['equal']:,} ({pct(tot['equal'], tot['n'])}) · unit {tot['unit']:,} · newer {tot['newer']:,} · "
         f"defect **{tot['defect']:,}** · unclassed **{tot['unclassed']:,}** · missing_live {tot['missing_live']:,} · missing_unified {tot['missing_unified']:,}.",
         f"- Gate (08): unclassed = {tot['unclassed']}; defects without a decision card = "
         f"{sum(r['defect'] for r in fr.values() if not (set(r['cards']) & set(par['decision_cards'])))}.", '',
         '## Summary per field', '', '| Field | n | equal | differing (unit · newer · defect · unclassed) | missing live · unified | classes |', '|---|---:|---:|---|---|---|']
    for k, r in fr.items():
        diff = r['unit'] + r['newer'] + r['defect'] + r['unclassed']
        cls = ', '.join(c for c in CLASSES[1:] if r[c])
        L.append(f"| `{k}` | {r['n']:,} | {pct(r['equal'], r['n'])} | {pct(diff, r['n'])} ({r['unit']} · {r['newer']} · {r['defect']} · {r['unclassed']}) | "
                 f"{r['missing_live']} · {r['missing_unified']} | {cls or 'all equal'} |")
    L += ['', '## Every difference class, with examples and the reason', '']
    for k, r in fr.items():
        if not r['classes']:
            continue
        L.append(f"### `{k}` ({r['unit_label']})")
        L.append(f"_{r['note']}_")
        for c in CLASSES[1:]:
            for reason, v in (r['classes'].get(c) or {}).items():
                ex = '; '.join(f"`{e['key']}` live {json.dumps(e['live'], ensure_ascii=False)} → unified {json.dumps(e['unified'], ensure_ascii=False)}"
                               for e in v['examples'])
                L.append(f"- **{c}** × {v['n']:,}: {reason}. e.g. {ex}")
        if r['cards']:
            L.append(f"- decision card: {'; '.join(r['cards'])}")
        L.append('')
    L += ['## Same-name price-node mis-links (D-008, guarded in S2-D)', '',
          f"{sus['n']} buses with tier `direct`/`same_substation` have a rank-1 price node farther than {sus['threshold_mi']} mi from the bus (the "
          'farthest geo-proxy link, read from the DB), i.e. a same-name node in another town. Since S2-D the engine re-links each to the nearest '
          'node under the geo-proxy rule (`busdata.price_links`, tier `relinked`, distance disclosed) and never prices through the far node; '
          'busdata, api_prices, api_market, api_pricesintra and this generation all read that one function. Live still prices them at the far '
          'node, so parity classes those differences `newer` (D-008). Bus ids: `meta.coverage.suspect_pnode_links.buses`; the new node and both '
          'distances per bus: `.relinked`. The upstream `bridge_bus_pnode` fix is raised with the DB owner.', '']
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text('\n'.join(L) + '\n', encoding='utf-8')


def main(argv=None):
    ap = argparse.ArgumentParser(description='M2 mapgrid parity vs the live payload (read-only).')
    ap.add_argument('--live-dir', default=str(DEFAULT_LIVE))
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    ap.add_argument('--db', required=True, help='unified DuckDB, read-only, evidence queries only (required: without it the zone rules cannot classify and report unclassed)')
    a = ap.parse_args(argv)
    global _DB
    if a.db:
        import duckdb
        _DB = duckdb.connect(str(Path(a.db).resolve()), read_only=True)
    oracle = check_snapshot(a.live_dir)
    gen, res = run(a.live_dir, a.out)
    par = {'generation': gen, 'oracle': {'dir': str(Path(a.live_dir).resolve()), 'files': oracle}, 'decision_cards': DECISION_CARDS,
           'classes': CLASSES, 'fields': res}
    Path(a.out, 'parity.json').write_text(json.dumps(par, indent=1, ensure_ascii=False, default=str), encoding='utf-8')
    cur = json.loads((Path(a.out) / 'current.json').read_text(encoding='utf-8'))
    report(par, json.loads((Path(a.out) / cur['dir'] / 'meta.json').read_text(encoding='utf-8')))
    print(f'wrote {Path(a.out, "parity.json")} and {REPORT}')
    for k, r in res.items():
        print(f'{k:28s} n {r["n"]:>6}  ' + '  '.join(f'{c} {r[c]}' for c in CLASSES if r[c]))


if __name__ == '__main__':
    main()
