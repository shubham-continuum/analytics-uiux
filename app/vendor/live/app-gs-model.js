/* VENDORED from live Studio src/app.js L82-488 (snapshot 2026-10-11, sha256 b8df3283abd46150), cut by marker lines.
   DO NOT EDIT: regenerate with plan/vendor_live.py; patches in vendor/live/patches/. */
/* ═══════════════════════════════════════════════════════════════════════════
   GridSense Analytics — data model (GS).

   window.GS_DATA is the JSON extracted read-only from ISONE_GridSense.duckdb and
   ISONE_GridSense_agg.duckdb by build/extract_data.py + slim.py. Nothing in this
   file invents a number: every value shown on screen traces to a column of that
   extract, and every derivation is labelled `modelled` by the widget that does it.

   PUBLIC API (used by widgets, views and the configurator)
   ─────────────────────────────────────────────────────────
   GS.D                      raw extract (meta, columns, nodes, detail, iso, queue, coverage)
   GS.nodes                  Array<Node> — all 2,678 ISO-NE substation buses
   GS.node(id)               Node | undefined
   GS.detail(id)             per-bus hourly/constraint detail (16 featured buses) | null
   GS.hasHourly(node)        boolean (settled RT hourly attribution exists)
   GS.fuels / GS.FUELS       technology vocabulary (key, label, direction, columns…)
   GS.cases / GS.CASES       planning cases (sp, sh, ll) with headroom column keys
   GS.headroom(node, caseKey, direction) → MW | null   (direction 'injection'|'withdrawal')
   GS.preIssues(node, caseKey, direction) → count | null
   GS.curt(node, fuel, sizeMW, year)  → % | null      (nearest published size; year 2030 default)
   GS.capture(node, fuel, year)       → ratio | null
   GS.gates(fuel, node, sizeMW, caseKey) → {gates:[{label,value,state,detail}], verdict:'advance'|'review'|'hold', clear:n, total:n}
   GS.candidates(opts)       ranked candidate list over all buses
   GS.score(fuel, weights)   weighted percentile score over the market (m_rank percentiles)
   GS.catalog                field catalogue derived from the 453 columns (families → templates → dims)
   GS.resolve(template, pins)→ {col, key, embedded:boolean}   maps a template + pins to a node key
   GS.stat                   quantile/median/mean/pctRank helpers
   GS.fmt                    number formatting (never prints -0)
   GS.constraintTable(caseKey, direction) → 'sp_sub_dis' … (the eight-table truth)
   GS.queueNear(id) / GS.queueByState(st)
   GS.truths                 the data truths surfaced in "Data notes"
   ═══════════════════════════════════════════════════════════════════════════ */
window.GS = (function () {
  const D = window.GS_DATA;
  if (!D) throw new Error('GS_DATA missing');

  /* orchestrator 2026-10-07 cost basis — Ganesh's decision: grid loading and network cost read the HEADLINE element
     set (the screens behind the headroom envelope and the gates; one board, one basis). The 16 detail buses' constraint
     tables were the 2026-05 study set: they are re-read from GS_DATA_EXT.grid_detail (headline rows, the same shape) and
     the study rows stay on constraints_study, a comparison only — never a range. A row on a table the headline set does
     not hold (the large-load injection list) and iso.top_facilities are re-priced by bus pair + circuit through
     grid_detail.facility_cost; the study figure rides beside it as cost_study_musd. A cost the vendor does not price is
     null (cost not held), never 0. No GS_DATA_EXT (the --check round trip) leaves GS_DATA as shipped. */
  const COST_BASIS = (function () {
    const E = window.GS_DATA_EXT, X = E && E.grid_detail, M = (E && E.meta && E.meta.cost_basis) || null;
    if (!X || X.set !== 'headline') return null;
    const dflt = X.row_defaults || {}, FC = X.facility_cost || {};
    const key = raw => { const m = /^\s*(\d+)\s+.+?\s+[\d.]+\s+(\d+)\s+.+?\s+[\d.]+\s+(\d+)\s*$/.exec(raw || ''); if (!m) return null; const a = +m[1], b = +m[2]; return `${Math.min(a, b)}-${Math.max(a, b)}-${+m[3]}`; };
    const reprice = r => { if (!r || !('cost_musd' in r) || r.cost_basis) return r; const k = key(r.facility), f = k ? FC[k] : null;
      return Object.assign(r, { cost_study_musd: r.cost_musd, cost_musd: f ? f[0] : null, cost_basis: f ? 'headline' : 'not in the headline set' }); };
    let tables = 0;
    Object.keys(D.detail || {}).forEach(b => { const d = D.detail[b]; if (!d || !d.constraints || d.constraints_study) return;
      const hd = (X.constraints || {})[b]; const out = {};
      Object.keys(d.constraints).forEach(t => {
        if (hd && hd[t]) { out[t] = hd[t].map(r => Object.assign({}, dflt, r, { cost_basis: 'headline' })); tables++; }
        else out[t] = (d.constraints[t] || []).map(r => reprice(Object.assign({}, r)));
      });
      d.constraints_study = d.constraints; d.constraints = out; });
    ((D.iso || {}).top_facilities || []).forEach(reprice);
    const line = (M && M.label_line) || 'per-mile rate card, no base year · upper bound per facility · not an allocation · excludes POI/gen-tie · thermal screen · vintage unconfirmed';
    return { set: 'headline', set_name: (M && M.set_name) || 'ISO-NE GRIDSENSE DATA', line, notes: ((M && M.labels) || []).map(x => x.detail), tables_reread: tables,
      badge: { kind: 'warn', text: 'upper bound · rate card', title: line } };
  })();

  /* ── nodes (columnar → objects) ─────────────────────────────────────── */
  const cols = D.nodes.cols;
  const nodes = D.nodes.rows.map(r => { const o = {}; for (let i = 0; i < cols.length; i++) o[cols[i]] = r[i]; return o; });
  const byId = new Map(nodes.map(n => [n.bus_id, n]));
  const STATE_NAME = { MA: 'Massachusetts', ME: 'Maine', NH: 'New Hampshire', VT: 'Vermont', CT: 'Connecticut', RI: 'Rhode Island', NY: 'New York' };
  nodes.forEach(n => {
    n.stateName = STATE_NAME[n.state] || n.state;
    n.label = `${n.name} ${n.kv ? n.kv + ' kV' : ''}`.trim();
    n.hasHourly = !!n.hourly_conf;
    n.exact = n.hourly_conf === 'exact';
  });
  // substation grouping (buses at one station share a name; the 345 kV "top 20" is a top 11 without it)
  const stations = new Map();
  nodes.forEach(n => { const k = (n.name || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); n.stationKey = k; if (!stations.has(k)) stations.set(k, []); stations.get(k).push(n); });

  /* ── stats ──────────────────────────────────────────────────────────── */
  const stat = {
    clean: a => a.filter(v => v != null && !Number.isNaN(v)),
    quantile(a, p) { const s = stat.clean(a).slice().sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); },
    median: a => stat.quantile(a, .5),
    mean(a) { const s = stat.clean(a); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; },
    sum(a) { return stat.clean(a).reduce((x, y) => x + y, 0); },
    min: a => { const s = stat.clean(a); return s.length ? Math.min(...s) : null; },
    max: a => { const s = stat.clean(a); return s.length ? Math.max(...s) : null; },
    /** percentile rank of v within a (0..1), share strictly below + half ties */
    pctRank(a, v) { const s = stat.clean(a); if (!s.length || v == null) return null; let below = 0, eq = 0; for (const x of s) { if (x < v) below++; else if (x === v) eq++; } return (below + eq / 2) / s.length; },
    column: key => nodes.map(n => n[key]),
    bins(a, n, lo, hi) { const s = stat.clean(a); lo = lo ?? Math.min(...s); hi = hi ?? Math.max(...s); const w = (hi - lo) / n || 1; const out = Array.from({ length: n }, (_, i) => ({ lo: lo + i * w, hi: lo + (i + 1) * w, n: 0 })); s.forEach(v => { let i = Math.min(n - 1, Math.max(0, Math.floor((v - lo) / w))); out[i].n++; }); return out; },
  };

  /* ── formatting ─────────────────────────────────────────────────────── */
  const fmt = {
    num(v, dp) { if (v == null || Number.isNaN(v)) return '—'; if (dp == null) dp = Math.abs(v) >= 10000 ? 0 : Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 1 ? 2 : 3; let s = Number(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }); if (s === '-0' || /^-0(\.0+)?$/.test(s)) s = s.slice(1); return s; },
    int: v => v == null ? '—' : Math.round(v).toLocaleString('en-US'),
    money(v, dp = 2) { return v == null ? '—' : (v < 0 ? '−$' : '$') + fmt.num(Math.abs(v), dp); },
    lmp: v => v == null ? '—' : fmt.money(v, 2) + '/MWh',
    mw: (v, dp) => v == null ? '—' : fmt.num(v, dp ?? (Math.abs(v) >= 100 ? 1 : 1)) + ' MW',
    pct: (v, dp = 1) => v == null ? '—' : fmt.num(v, dp) + '%',
    ratio: v => v == null ? '—' : fmt.num(v, 3),
    signed(v, dp = 1, unit = '') { if (v == null) return '—'; const s = fmt.num(Math.abs(v), dp); return (v > 0 ? '+' : v < 0 ? '−' : '') + s + unit; },
    compact(v) { if (v == null) return '—'; const a = Math.abs(v); if (a >= 1e9) return fmt.num(v / 1e9, 2) + 'B'; if (a >= 1e6) return fmt.num(v / 1e6, 2) + 'M'; if (a >= 1e3) return fmt.num(v / 1e3, 1) + 'k'; return fmt.num(v); },
    musd: v => v == null ? '—' : '$' + fmt.num(v, v >= 100 ? 0 : 1) + 'M',
    k: v => v == null ? '—' : '$' + fmt.num(v / 1000, 0) + 'k',
    hour: h => 'HE ' + (h + 1),
    date: s => s ? String(s).slice(0, 10) : '—',
    plural: (n, s, p) => `${fmt.int(n)} ${n === 1 ? s : (p || s + 's')}`,
  };

  /* ── vocabulary ─────────────────────────────────────────────────────── */
  const CASES = [
    { key: 'sp', label: 'Summer peak', full: 'Summer Peak NCIS', dis: 'hr_sp_dis', chg: 'hr_sp_chg', pi_dis: 'pi_sp_dis', pi_chg: 'pi_sp_chg', tables: { injection: 'sp_sub_dis', withdrawal: 'sp_sub_chg' } },
    { key: 'sh', label: 'Shoulder', full: 'Shoulder NCIS', dis: 'hr_sh_dis', chg: 'hr_sh_chg', pi_dis: null, pi_chg: null, tables: { injection: null, withdrawal: null } }, /* orchestrator 2026-10-06 wave1 */ /* no Shoulder element list is embedded: the sll_* tables are the Summer-peak Large-Load screen (§D33), so Shoulder has an envelope only */
    { key: 'll', label: 'Large load', full: 'Summer Peak Large Load Interconnection', dis: null, chg: 'hr_ll_chg', pi_dis: null, pi_chg: null, tables: { injection: 'sll_sub_dis', withdrawal: 'sll_sub_chg' }, note: 'Publishes a withdrawal envelope only — the study written for data centres.' }, /* orchestrator 2026-10-06 wave1 */ /* sll_sub_dis is the large-load screen's injection list: read by name, never as Shoulder */
  ];
  const caseOf = k => CASES.find(c => c.key === k) || CASES[0];
  const DIRECTION = { injection: { label: 'Injection', gs: 'Discharging', help: 'Generation into the grid (GridSense: Discharging)' }, withdrawal: { label: 'Withdrawal', gs: 'Charging', help: 'Load out of the grid (GridSense: Charging)' } };

  const FUELS = {
    solar: { key: 'solar', label: 'Solar', plural: 'Solar', direction: 'injection', curt: 'solar', curtLabel: 'Curtailment', cap: 'solar_cap', window: 'solar', windowLabel: 'HE 10–16', unitSize: 'MWac', defaultSize: 100, defaultSort: 'lmp30', color: 'var(--s4)', icon: 'sun', question: 'Capture erosion and curtailment at size' },
    wind: { key: 'wind', label: 'Wind', plural: 'Wind', direction: 'injection', curt: 'wind', curtLabel: 'Curtailment', cap: 'wind_cap', window: 'wind', windowLabel: 'HE 1–7 and 19–24', unitSize: 'MW', defaultSize: 150, defaultSort: 'lmp30', color: 'var(--s3)', icon: 'wind', question: 'Overnight capture and winter delivery' },
    bess: { key: 'bess', label: 'BESS', plural: 'Storage', direction: 'both', curt: 'bess', curtLabel: 'Opportunity loss', cap: null, window: 'flat', windowLabel: 'all hours', unitSize: 'MW', defaultSize: 100, defaultSort: 'tb4', color: 'var(--s7)', icon: 'battery', question: 'Energy-arbitrage ceiling, cycles and both-direction headroom' },
    dc: { key: 'dc', label: 'Data centre', plural: 'Data centres', direction: 'withdrawal', curt: 'dc', curtLabel: 'Reliability risk', cap: null, window: 'flat', windowLabel: 'all hours', unitSize: 'MW', defaultSize: 250, defaultSort: 'lmp30asc', color: 'var(--s5)', icon: 'server', question: 'Wholesale energy exposure, price stability and grid access' },
    hybrid: { key: 'hybrid', label: 'Solar + storage', plural: 'Hybrids', direction: 'both', curt: 'solar', curtLabel: 'Curtailment', cap: 'solar_cap', window: 'solar', windowLabel: 'HE 10–16', unitSize: 'MWac', defaultSize: 100, defaultSort: 'lmp30', color: 'var(--s2)', icon: 'hybrid', modelled: true, question: 'What storage recovers from clipping' },
  };
  const SIZES = [100, 250, 500, 1000];
  const YEARS_F = [2030, 2035, 2040, 2045, 2050];
  const ZONES = ['ME', 'NH', 'VT', 'CT', 'RI', 'SEMA', 'WCMA', 'NEMA'];

  /* ── readers ────────────────────────────────────────────────────────── */
  const headroom = (n, ck, dir) => { const c = caseOf(ck); const k = dir === 'withdrawal' ? c.chg : c.dis; return k && n ? n[k] : null; };
  const preIssues = (n, ck, dir) => { const c = caseOf(ck); const k = dir === 'withdrawal' ? c.pi_chg : c.pi_dis; return k && n ? n[k] : null; };
  const nearestSize = mw => SIZES.reduce((a, b) => Math.abs(b - mw) < Math.abs(a - mw) ? b : a, SIZES[0]);
  const curt = (n, fuel, mw, year = 2030) => { const f = FUELS[fuel] || FUELS.solar; const s = nearestSize(mw || 100); let k = `${f.curt}_${s}MW_${year}`; if (!(k in n) && year !== 2030) k = `${f.curt}_250MW_${year}`; return n[k] ?? null; };
  const capture = (n, fuel, year = 2030) => { const f = FUELS[fuel]; if (!f || !f.cap) return null; return n[`${f.cap}_${year}`] ?? null; };
  /* orchestrator 2026-10-06 wave1 — ONE resolver for the study case a fuel is read on (fuel audit F1/F2; ext/20
     CASES_BY_FUEL; memory isone-study-conditions-by-asset: PP5-6 Rev 14 §9, OATT Sch 22 §3.1 — not in the vault):
       data centre             → Large load · withdrawal, whatever case the scope names (the study written for large loads)
       storage / hybrid charge → Shoulder · withdrawal (ISO-NE never studies storage charging at summer peak)
       injection / discharge   → the scope's case where it publishes an injection envelope (Summer peak, Shoulder), else Summer peak
     governingCase(fuel, direction, ck) returns the case key; caseWords(fuel, ck) the words a card states it in. */
  const governingCase = (fuel, direction, ck) => { const f = FUELS[fuel] || FUELS.solar; if (f.direction === 'withdrawal') return 'll'; const d = direction || 'injection'; if (d === 'withdrawal') return 'sh'; return ck === 'sh' ? 'sh' : 'sp'; };
  const caseWords = (fuel, ck) => { const f = FUELS[fuel] || FUELS.solar; if (f.direction === 'withdrawal') return caseOf('ll').label; const g = caseOf(governingCase(fuel, 'injection', ck)); return f.direction === 'both' ? (g.key === 'sh' ? 'Shoulder (both directions)' : `${g.label} discharge · Shoulder charge`) : g.label; };
  const primaryHeadroom = (n, fuel, ck) => { const f = FUELS[fuel] || FUELS.solar; if (f.direction === 'withdrawal') return headroom(n, governingCase(fuel, 'withdrawal', ck), 'withdrawal'); if (f.direction === 'both') { const a = headroom(n, governingCase(fuel, 'injection', ck), 'injection'), b = headroom(n, governingCase(fuel, 'withdrawal', ck), 'withdrawal'); return a == null ? b : b == null ? a : Math.min(a, b); } return headroom(n, governingCase(fuel, 'injection', ck), 'injection'); }; /* orchestrator 2026-10-06 wave1: fuel-aware — DC reads Large load, storage charges at Shoulder */
  const constraintTable = (ck, dir) => caseOf(ck).tables[dir] || null;
  const MARKET_MEAN_2030 = stat.mean(stat.column('lmp_2030')); /* orchestrator 2026-09-27 one price basis app-wide: the corrected sheet (vendor) mean — the fallback; ext/76 redefines GS.MARKET_MEAN_2030 on the one basis */
  /* orchestrator 2026-09-27 one price basis app-wide — every forecast price in the app reads GS.priceAt
     (ext/76: the solved PROBE run at the bus; the sheet only where no run is held, labelled). Without
     ext/76 each helper falls back to the corrected sheet (vendor) column, so this file alone still runs.
       px(n, y)      the number, untraced (rankings, distributions, tooltips)
       pxAt(n, y)    the resolved object, traced — a card reading its own bus is flagged by ext/76
       pxText(n, y)  "$47.21/MWh · data anomaly (corrected sheet $63.63, +34.8%)" for a tooltip or list line
       pxColumn(y)   every bus, in GS.nodes order;  pxStamp() a cache key;  marketMean() the 2030 mean */
  const G_ = () => window.GS || {};
  const sheetPx = (n, y) => { const v = n ? n[`lmp_${y}`] : null; return v == null ? null : +v; };   // corrected sheet (vendor) fallback
  const px = (n, y = 2030) => typeof G_().priceValue === 'function' ? G_().priceValue(n, y) : sheetPx(n, y);
  const pxAt = (n, y = 2030) => { if (typeof G_().priceAt === 'function') return G_().priceAt(n, y); const v = sheetPx(n, y); return v == null ? null : { value: v, year: y, source: 'sheet', anomaly: null, kind: 'corrected sheet (vendor)', short: 'sheet' }; };
  const pxQuiet = (n, y = 2030) => typeof G_().priceQuiet === 'function' ? G_().priceQuiet(n, y) : pxAt(n, y);
  const pxText = (n, y = 2030) => typeof G_().priceText === 'function' ? G_().priceText(n, y) : fmt.lmp(sheetPx(n, y));
  const pxColumn = (y = 2030) => typeof G_().priceColumn === 'function' ? G_().priceColumn(y) : nodes.map(n => sheetPx(n, y));
  const pxStamp = () => typeof G_().priceStamp === 'function' ? G_().priceStamp() : 'sheet';
  const marketMean = () => { const v = G_().MARKET_MEAN_2030; return v == null ? MARKET_MEAN_2030 : v; }; /* orchestrator 2026-09-27 one price basis app-wide: GS.MARKET_MEAN_2030 is the one-basis getter (ext/76); the local const is the corrected sheet (vendor) fallback */

  /* ── gates (one verdict object for every surface) ───────────────────── */
  function gates(fuel, n, mw, ck = 'sp') {
    const f = FUELS[fuel] || FUELS.solar; const g = [];
    const st = (ok, warn) => ok ? 'ok' : warn ? 'warn' : 'bad';
    if (f.direction === 'both') {
      // orchestrator 2026-09-24 (item 34): storage is never studied charging at summer peak. The
      // discharge leg reads the selected case; the charge leg always reads the shoulder case.
      const cck = governingCase(fuel, 'withdrawal', ck), ack = governingCase(fuel, 'injection', ck); /* orchestrator 2026-10-06 wave1: the one resolver */
      const a = headroom(n, ack, 'injection'), b = headroom(n, cck, 'withdrawal');
      g.push({ label: 'Discharge headroom clears', value: a == null ? '—' : `${fmt.num(a, 1)} MW vs ${fmt.num(mw, 0)} MW`, state: a == null ? 'unknown' : a >= mw ? 'ok' : 'bad', detail: 'Injection side · ' + caseOf(ack).label });
      g.push({ label: 'Charge headroom clears', value: b == null ? '—' : `${fmt.num(b, 1)} MW vs ${fmt.num(mw, 0)} MW`, state: b == null ? 'unknown' : b >= mw ? 'ok' : 'bad', detail: 'Withdrawal side · ' + caseOf(cck).label + (ck === 'sp' ? ' — summer-peak charging is not a storage study condition' : '') });
    } else {
      const h = primaryHeadroom(n, fuel, ck);
      g.push({ label: `${f.direction === 'withdrawal' ? 'Withdrawal' : 'Injection'} headroom clears request`, value: h == null ? '—' : `${fmt.num(h, 1)} MW vs ${fmt.num(mw, 0)} MW`, state: h == null ? 'unknown' : h >= mw ? 'ok' : 'bad', detail: caseWords(fuel, ck) /* orchestrator 2026-10-06 wave1 */ + (h === 1500 ? ' · at the 1,500 MW study cap' : '') });
    }
    if (fuel === 'solar' || fuel === 'hybrid') {
      const c = curt(n, 'solar', mw); g.push({ label: 'Curtailment within 2 %', value: c == null ? '—' : fmt.pct(c, 2) + ` at ${nearestSize(mw)} MW`, state: c == null ? 'unknown' : st(c <= 2, c <= 5), detail: n.curt_validated ? 'Screened against a study run' : 'Vendor ramp — not screened at this bus' });
      const cp = capture(n, 'solar'); g.push({ label: 'Capture at or above 90 %', value: cp == null ? '—' : fmt.pct(cp * 100, 1), state: cp == null ? 'unknown' : cp >= .9 ? 'ok' : 'bad', detail: 'Solar_Capture_Ratio_2030 · sheet value' });
    }
    if (fuel === 'wind') {
      const c = curt(n, 'wind', mw); g.push({ label: 'Curtailment within 2 %', value: c == null ? '—' : fmt.pct(c, 2) + ` at ${nearestSize(mw)} MW`, state: c == null ? 'unknown' : st(c <= 2, c <= 5), detail: 'Vendor ramp — wind was never screened at any bus' });
      const cp = capture(n, 'wind'); g.push({ label: 'Capture at or above 100 %', value: cp == null ? '—' : fmt.pct(cp * 100, 1), state: cp == null ? 'unknown' : cp >= 1 ? 'ok' : 'warn', detail: 'Above 100 % means wind earns better than a flat megawatt' });
    }
    if (fuel === 'bess' || fuel === 'hybrid') {
      const t = n.tb4_2030; g.push({ label: 'TB4 spread above $10', value: t == null ? '—' : fmt.money(t) + '/MWh', state: t == null ? 'unknown' : t > 10 ? 'ok' : 'warn', detail: 'TB4_2030 · published annual spread' });
      if (fuel === 'bess') { const o = curt(n, 'bess', mw); g.push({ label: 'Opportunity loss within 5 %', value: o == null ? '—' : fmt.pct(o, 2), state: o == null ? 'unknown' : o <= 5 ? 'ok' : 'warn', detail: `Bess_Curt_Opp_Loss_Pct_${nearestSize(mw)}MW_2030 · vendor ramp` }); }
    }
    if (fuel === 'dc') {
      { const P = pxAt(n, 2030), v = P ? P.value : null, mm = marketMean(); /* orchestrator 2026-09-27 one price basis app-wide */
        g.push({ label: 'LMP 2030 below market mean' /* orchestrator 2026-09-27 naming */, value: v == null ? '—' : fmt.lmp(v) + (P.anomaly ? ` · data anomaly (sheet ${fmt.money(P.anomaly.sheet)})` : P.source === 'sheet' ? ' · sheet' : ''), state: v == null ? 'unknown' : v <= mm ? 'ok' : 'warn', detail: `Market mean at 2030 is ${fmt.lmp(mm)} across ${fmt.int(pxColumn(2030).filter(x => x != null).length)} buses · ${P && P.source !== 'sheet' ? 'solved run at this bus' : 'corrected sheet — no solved run at this bus'}` }); }
      g.push({ label: 'Volatility below $25', value: n.std_2025 == null ? '—' : fmt.money(n.std_2025) + '/MWh σ', state: n.std_2025 == null ? 'unknown' : n.std_2025 < 25 ? 'ok' : 'warn', detail: 'Std_LMP_2025 · settled' });
      g.push({ label: 'Three or more outlets', value: n.outlets == null ? '—' : fmt.int(n.outlets) + ' outlets', state: n.outlets == null ? 'unknown' : n.outlets >= 3 ? 'ok' : 'warn', detail: 'Lines + transformers at the station' });
    }
    if (fuel !== 'dc' && fuel !== 'bess') {
      const PE = typeof G_().preIssuesGoverning === 'function' ? G_().preIssuesGoverning(n, fuel) : null; /* orchestrator 2026-09-28 integration: one pre-existing count — the engine (§F, transfer_mw < 0) at the fuel's governing case, as 3.20 and the Market requirement read it; the sheet pi_* stays on the bus grid as "(sheet)" */
      const pi = PE ? PE.value : preIssues(n, ck, 'injection'); g.push({ label: PE ? 'No pre-existing issue · engine · §F' : 'No pre-existing issue', value: pi == null ? '—' : pi === 0 ? 'none' : `${fmt.int(pi)} recorded`, state: pi == null ? 'unknown' : pi === 0 ? 'ok' : 'warn', detail: PE ? `engine · §F — ${PE.words || 'the governing case'} (the governing case) · GS_DATA_EXT.loading["${PE.key}"].pre_existing_n, elements with transfer_mw < 0 before any transfer here` : 'Pre-existing overloads before any transfer here' });
    }
    const bad = g.some(x => x.state === 'bad'), warn = g.some(x => x.state === 'warn' || x.state === 'unknown');
    const verdict = bad ? 'hold' : warn ? 'review' : 'advance';
    return { gates: g, verdict: fuel === 'hybrid' && verdict === 'advance' ? 'review' : verdict, clear: g.filter(x => x.state === 'ok').length, total: g.length };
  }

  /* ── candidates (the market-wide screen) ────────────────────────────── */
  const SORTS = {
    lmp30: { label: 'LMP 2030 ↓' /* orchestrator 2026-09-27 naming */, key: 'lmp_2030', price: 2030, dir: -1, unit: '$/MWh' }, /* orchestrator 2026-09-27 one price basis app-wide: `price` sorts on px() */
    lmp30asc: { label: 'LMP 2030 ↑' /* orchestrator 2026-09-27 naming */, key: 'lmp_2030', price: 2030, dir: 1, unit: '$/MWh' }, /* orchestrator 2026-09-27 one price basis app-wide */
    lmp35: { label: 'LMP 2035 ↓' /* orchestrator 2026-09-27 naming */, key: 'lmp_2035', price: 2035, dir: -1, unit: '$/MWh' }, /* orchestrator 2026-09-27 one price basis app-wide */
    tb4: { label: 'TB4 spread 2030 ↓', key: 'tb4_2030', dir: -1, unit: '$/MWh' },
    headroom: { label: 'Headroom ↓', key: '__hr', dir: -1, unit: 'MW' },
    curt: { label: 'Curtailment ↑', key: '__curt', dir: 1, unit: '%' },
    capture: { label: 'Capture ↓', key: '__cap', dir: -1, unit: 'ratio' },
    name: { label: 'Name A–Z', key: 'name', dir: 1, unit: '' },
  };
  function candidates(o = {}) {
    const fuel = o.fuel || 'solar', mw = o.size || 100, ck = o.case || 'sp', gate = o.gate !== false, sort = SORTS[o.sort] || SORTS[FUELS[fuel].defaultSort];
    const P30 = pxColumn(2030), PI = new Map(nodes.map((n, i) => [n, i])); /* orchestrator 2026-09-27 one price basis app-wide */
    let list = nodes.filter((n, i) => P30[i] != null);
    const universe = list.length;
    list = list.map(n => ({ n, hr: primaryHeadroom(n, fuel, ck), curt: curt(n, fuel, mw), cap: capture(n, fuel), px: sort.price === 2030 ? P30[PI.get(n)] : sort.price ? px(n, sort.price) : null }));
    if (gate) list = list.filter(r => r.hr != null && r.hr >= mw);
    if (o.state) list = list.filter(r => r.n.state === o.state);
    if (o.zone) list = list.filter(r => r.n.zone === o.zone);
    if (o.kvMin) list = list.filter(r => (r.n.kv || 0) >= o.kvMin);
    if (o.hourlyOnly) list = list.filter(r => r.n.hasHourly);
    if (o.q) { const q = o.q.toLowerCase(); list = list.filter(r => (r.n.name || '').toLowerCase().includes(q) || String(r.n.bus_id).includes(q) || (r.n.county || '').toLowerCase().includes(q)); }
    const val = r => sort.price ? r.px : sort.key === '__hr' ? r.hr : sort.key === '__curt' ? r.curt : sort.key === '__cap' ? r.cap : r.n[sort.key];
    list.sort((a, b) => { const x = val(a), y = val(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return typeof x === 'string' ? x.localeCompare(y) * sort.dir : (x - y) * sort.dir; });
    const hrs = list.map(r => r.hr).filter(v => v != null);
    const degenerate = hrs.length > 1 && hrs.every(v => v === hrs[0]);
    // substation collapse
    const groups = []; const seen = new Map();
    list.forEach(r => { const k = r.n.stationKey; if (!seen.has(k)) { seen.set(k, { key: k, name: r.n.name, rows: [] }); groups.push(seen.get(k)); } seen.get(k).rows.push(r); });
    groups.forEach(g => { g.identical = g.rows.length > 1 && new Set(g.rows.map(r => `${P30[PI.get(r.n)]}|${r.n.tb4_2030}`)).size === 1; }); /* orchestrator 2026-09-27 one price basis app-wide */
    return { rows: list, groups, count: list.length, universe, stations: groups.length, degenerate, metric: sort, sortKey: o.sort || FUELS[fuel].defaultSort };
  }

  /* ── weighted percentile score (Priorities) ─────────────────────────── */
  const CRITERIA = {
    energy_price: { label: 'LMP 2030' /* orchestrator 2026-09-27 naming */, group: 'Revenue', key: 'lmp_2030', price: 2030, higher: true }, /* orchestrator 2026-09-27 one price basis app-wide: scored on px() */
    energy_price_low: { label: 'Cheap energy', group: 'Revenue', key: 'lmp_2030', price: 2030, higher: false }, /* orchestrator 2026-09-27 one price basis app-wide */
    tb4: { label: 'TB4 spread', group: 'Revenue', key: 'tb4_2030', higher: true },
    tb2: { label: 'TB2 spread', group: 'Revenue', key: 'tb2_2030', higher: true },
    tb8: { label: 'TB8 spread', group: 'Revenue', key: 'tb8_2030', higher: true },
    solar_capture: { label: 'Solar capture', group: 'Revenue', key: 'solar_cap_2030', higher: true },
    wind_capture: { label: 'Wind capture', group: 'Revenue', key: 'wind_cap_2030', higher: true },
    basis: { label: 'Basis tightness', group: 'Risk', key: 'basis_own_2025', higher: false, abs: true },
    volatility_low: { label: 'Price stability', group: 'Risk', key: 'std_2025', higher: false },
    volatility_high: { label: 'Price volatility', group: 'Revenue', key: 'std_2025', higher: true },
    neg_hours: { label: 'Freedom from negative prices', group: 'Risk', key: 'hneg_2025', higher: false },
    scarcity_hours: { label: 'Scarcity hours', group: 'Revenue', key: 'h200_2025', higher: true },
    congestion_free: { label: 'Low congestion share', group: 'Risk', key: 'cong_2025', higher: false, abs: true },
    solar_curt: { label: 'Solar curtailment headroom', group: 'Interconnection', key: '__curt_solar', higher: false, barred: 'vendor ramp · never orders a shortlist' },
    wind_curt: { label: 'Wind curtailment headroom', group: 'Interconnection', key: '__curt_wind', higher: false, barred: 'vendor ramp · never orders a shortlist' },
    bess_opp: { label: 'Storage opportunity loss', group: 'Interconnection', key: '__curt_bess', higher: false, barred: 'vendor ramp · never orders a shortlist' },
    dc_risk: { label: 'Reliability of supply', group: 'Interconnection', key: '__curt_dc', higher: false, barred: 'vendor ramp · never orders a shortlist' },
    headroom_inject: { label: 'Injection headroom', group: 'Interconnection', key: 'hr_sp_dis', higher: true },
    headroom_withdraw: { label: 'Withdrawal headroom', group: 'Interconnection', key: 'hr_sp_chg', higher: true },
    headroom_both: { label: 'Both-direction headroom · discharge at summer peak, charge at shoulder', group: 'Interconnection', key: '__hr_both', higher: true },
    no_issues: { label: 'Clean starting point', group: 'Interconnection', key: 'pi_sp_dis', higher: false },
    short_circuit: { label: 'Short-circuit strength', group: 'Connection strength', key: 'sc_mva', higher: true },
    outlets: { label: 'Substation outlets', group: 'Connection strength', key: 'outlets', higher: true },
    voltage: { label: 'Nominal voltage', group: 'Connection strength', key: 'kv', higher: true },
    data_confidence: { label: 'Hourly attribution', group: 'Data confidence', key: '__conf', higher: true },
  };
  const PROFILES = {
    solar: { headroom_inject: 10, energy_price: 9, solar_capture: 8, neg_hours: 6, basis: 5, no_issues: 4, tb4: 4, congestion_free: 3, short_circuit: 3, outlets: 2, data_confidence: 3 },
    wind: { headroom_inject: 10, energy_price: 8, wind_capture: 8, scarcity_hours: 5, basis: 5, no_issues: 4, congestion_free: 3, short_circuit: 3, outlets: 2, data_confidence: 3 },
    bess: { tb4: 10, headroom_both: 10, tb2: 6, tb8: 4, volatility_high: 6, scarcity_hours: 6, basis: 4, no_issues: 3, short_circuit: 3, data_confidence: 3 },
    hybrid: { headroom_inject: 9, headroom_withdraw: 6, energy_price: 8, solar_capture: 7, tb4: 8, neg_hours: 4, basis: 4, no_issues: 3, data_confidence: 3 },
    dc: { energy_price_low: 10, headroom_withdraw: 10, volatility_low: 8, outlets: 6, short_circuit: 6, voltage: 4, basis: 4, congestion_free: 3, data_confidence: 3 },
    market: { energy_price: 8, tb4: 6, volatility_high: 4, congestion_free: 4, basis: 4, neg_hours: 4, headroom_inject: 4, data_confidence: 2 },
  };
  const critValue = (n, c) => {
    if (c.key === '__curt_solar') return n.solar_250MW_2030; if (c.key === '__curt_wind') return n.wind_250MW_2030; if (c.key === '__curt_bess') return n.bess_250MW_2030; if (c.key === '__curt_dc') return n.dc_250MW_2030;
    if (c.key === '__hr_both') return (n.hr_sp_dis == null || n.hr_sh_chg == null) ? null : Math.min(n.hr_sp_dis, n.hr_sh_chg); /* orchestrator 2026-09-24: ISO-NE studies storage charging at the shoulder, never at summer peak (item 34) */
    if (c.key === '__conf') return n.hourly_conf === 'exact' ? 2 : n.hourly_conf ? 1 : 0;
    if (c.price) return px(n, c.price); /* orchestrator 2026-09-27 one price basis app-wide */
    let v = n[c.key]; if (v != null && c.abs) v = Math.abs(v); return v;
  };
  const pctCache = new Map();
  function critPct(ck0) {
    const ck = CRITERIA[ck0] && CRITERIA[ck0].price ? `${ck0}|${pxStamp()}` : ck0; /* orchestrator 2026-09-27 one price basis app-wide: a price criterion is cached per price basis */
    if (pctCache.has(ck)) return pctCache.get(ck);
    const c = CRITERIA[ck0]; const vals = c.price ? pxColumn(c.price).slice() : nodes.map(n => critValue(n, c)); const sorted = stat.clean(vals).sort((a, b) => a - b); const m = new Map();
    nodes.forEach((n, i) => { const v = vals[i]; if (v == null) { m.set(n.bus_id, null); return; } let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; } let lo2 = lo, hi2 = sorted.length; while (lo2 < hi2) { const mid = (lo2 + hi2) >> 1; if (sorted[mid] <= v) lo2 = mid + 1; else hi2 = mid; } let p = ((lo + lo2) / 2) / sorted.length; if (!c.higher) p = 1 - p; m.set(n.bus_id, p); });
    const dist = [...m.values()].filter(v => v != null); const p10 = stat.quantile(dist, .1), p90 = stat.quantile(dist, .9);
    const r = { map: m, flat: p10 != null && Math.abs(p90 - p10) < 1e-9 }; pctCache.set(ck, r); return r;
  }
  function score(fuel, weights, o = {}) {
    const w = weights || PROFILES[fuel] || PROFILES.solar; const active = Object.entries(w).filter(([k, v]) => v > 0 && CRITERIA[k] && !CRITERIA[k].barred);
    const pcts = active.map(([k]) => [k, critPct(k)]);
    const flatWeight = active.filter(([k]) => critPct(k).flat).reduce((s, [, v]) => s + v, 0); const totalWeight = active.reduce((s, [, v]) => s + v, 0);
    let pool = nodes; if (o.gate && o.size) pool = pool.filter(n => (primaryHeadroom(n, fuel, o.case || 'sp') ?? -1) >= o.size);
    const out = pool.map(n => { let num = 0, den = 0; const parts = []; for (const [k, p] of pcts) { const v = p.map.get(n.bus_id); const wt = w[k]; if (v == null) { parts.push({ k, pct: null, w: wt }); continue; } num += v * wt; den += wt; parts.push({ k, pct: v, w: wt, contribution: v * wt }); } return { n, score: den ? 100 * num / den : null, used: den, possible: totalWeight, parts }; }).filter(r => r.score != null).sort((a, b) => b.score - a.score);
    const sc = out.map(r => r.score); const p5 = stat.quantile(sc, .05), p95 = stat.quantile(sc, .95), top = sc[0];
    const spread = p95 - p5; const discriminates = spread >= 6;
    const advice = spread >= 20 ? 'This weighting separates the candidates clearly.' : spread >= 6 ? 'This weighting separates the candidates, though not sharply.' : 'This weighting does not separate the candidates. Weight fewer things more heavily, or rank on a single explicit measure instead.';
    return { rows: out, p5, p95, top, spread, within2: sc.filter(v => v >= top - 2).length, discriminates, advice, flatWeight, totalWeight, criteria: active.map(([k, v]) => ({ ...CRITERIA[k], id: k, key: k, column: CRITERIA[k].key, w: v, flat: critPct(k).flat })) };
  }

  /* ── field catalogue: 453 columns → families → templates ────────────── */
  const YEAR_RE = /^(20[2-5]\d|2026YTD)$/;
  const SIZE_RE = /^(100|250|500|1000)MW$/;
  const ZONE_RE = /^(ME|NH|VT|CT|RI|SEMA|WCMA|NEMA|Own_Zone)$/;
  const TECH_RE = /^(Solar|Wind|Bess|DC)$/;
  const SCEN = ['Summer Peak NCIS', 'Shoulder NCIS', 'Summer Peak Large Load Interconnection'];
  function templateOf(col) {
    let base = col.replace(/_(eco|gcd)$/, ''); const tag = /_eco$/.test(col) ? 'econ' : /_gcd$/.test(col) ? 'grid' : null;
    let unit = null; const um = base.match(/\s*\(([^)]*)\)\s*$/); if (um) { unit = um[1]; base = base.replace(/\s*\([^)]*\)\s*$/, ''); }
    const dims = {}; let scen = null, dir = null;
    for (const s of SCEN) if (base.includes(s)) { scen = s; base = base.replace(s, '{scenario}'); }
    if (/Discharging|Charging/.test(base)) { dir = /Discharging/.test(base) ? 'Discharging' : 'Charging'; base = base.replace(/Discharging|Charging/, '{direction}'); }
    if (scen) dims.scenario = scen; if (dir) dims.direction = dir;
    const parts = base.split('_'); let tech = null;
    const tpl = parts.map((p, i) => { if (YEAR_RE.test(p)) { dims.year = p; return '{year}'; } if (SIZE_RE.test(p)) { dims.size = p; return '{size}'; } if (ZONE_RE.test(p) && parts[i - 1] === 'Vs') { dims.zone = p; return '{zone}'; } if (i === 0 && TECH_RE.test(p)) { tech = p; return p; } return p; }).join('_');
    if (/^TB[248]_/.test(tpl)) { dims.duration = tpl.slice(0, 3); return finish(tpl.replace(/^TB[248]/, 'TB{duration}')); }
    return finish(tpl);
    function finish(t) { return { col, template: t, unit, tag, dims, tech: tech ? tech.toLowerCase() : null }; }
  }
  const ECON_FAMILY = /^(Avg_LMP|LMP|Median_LMP|P5_LMP|P25_LMP|P75_LMP|P95_LMP|Peak_LMP|Off_Peak_LMP|Peak_Off_Peak_Ratio|Std_LMP|Min_LMP|Max_LMP|Cong_Share|Loss_Factor|Hours_Above|Hours_Below|N_Hours|Solar_|Wind_|Bess_|DC_|Basis_|Mean_Abs_Basis|TB|Top_Constraint|Analyst_Comments)/;
  const LABELS = [
    [/^Avg_LMP/, 'Average LMP', '$/MWh', 'Price'], [/^LMP_\{year\}/, 'Forecast LMP', '$/MWh', 'Price'], [/^Median_LMP/, 'Median LMP', '$/MWh', 'Price'], [/^P5_LMP/, 'P5 LMP', '$/MWh', 'Price'], [/^P25_LMP/, 'P25 LMP', '$/MWh', 'Price'], [/^P75_LMP/, 'P75 LMP', '$/MWh', 'Price'], [/^P95_LMP/, 'P95 LMP', '$/MWh', 'Price'],
    [/^Peak_LMP/, 'Peak LMP', '$/MWh', 'Price'], [/^Off_Peak_LMP/, 'Off-peak LMP', '$/MWh', 'Price'], [/^Peak_Off_Peak_Ratio/, 'Peak / off-peak ratio', 'ratio', 'Price'], [/^Std_LMP/, 'LMP volatility (σ)', '$/MWh', 'Price'], [/^Min_LMP/, 'Minimum LMP', '$/MWh', 'Price'], [/^Max_LMP/, 'Maximum LMP', '$/MWh', 'Price'],
    [/^Cong_Share/, 'Congestion share', '%', 'Basis & congestion'], [/^Loss_Factor/, 'Loss factor', '%', 'Basis & congestion'], [/^Basis_Vs_\{zone\}/, 'Basis vs zone', '$/MWh', 'Basis & congestion'], [/^Basis_Vs_Own_Zone/, 'Basis vs own zone', '$/MWh', 'Basis & congestion'], [/^Mean_Abs_Basis/, 'Mean absolute basis', '$/MWh', 'Basis & congestion'],
    [/^Hours_Above_200/, 'Hours above $200', 'hours', 'Hours'], [/^Hours_Below_0/, 'Negative-price hours', 'hours', 'Hours'], [/^N_Hours/, 'Settled hours', 'hours', 'Hours'],
    [/^Solar_Capture_Ratio/, 'Solar capture ratio', 'ratio', 'Solar'], [/^Solar_Curt_Pct/, 'Solar curtailment', '%', 'Solar'], [/^Wind_Capture_Ratio/, 'Wind capture ratio', 'ratio', 'Wind'], [/^Wind_Curt_Pct/, 'Wind curtailment', '%', 'Wind'],
    [/^Bess_Curt_Opp_Loss_Pct|^Bess_Opp_Loss_Pct/, 'Storage opportunity loss', '%', 'BESS'], [/^DC_Curt_Reliability_Risk_Pct|^DC_Reliability_Risk_Pct/, 'Reliability risk', '%', 'Data centre'],
    [/^TB\{duration\}/, 'Top-bottom spread (TB)', '$/MWh', 'Storage spread'], [/^Top_Constraint_Name/, 'Top constraint', 'text', 'Constraints'], [/^Top_Constraint_Contingency/, 'Top contingency', 'text', 'Constraints'], [/^Top_Constraint_Binding_Hrs/, 'Binding hours', 'hours', 'Constraints'], [/^Top_Constraint_Shadow_Price/, 'Shadow price', '$/MWh', 'Constraints'],
    [/^Headroom Capacity/, 'Headroom capacity', 'MW', 'Grid capacity'], [/^# Pre-existing Issues/, 'Pre-existing issues', 'count', 'Grid capacity'], [/^Maximum MW Injection/, 'CCIS study injection limit', 'MW', 'Grid capacity'], [/^3 Phase Short Circuit \(MVA\)|^3 Phase Short Circuit$/, 'Short-circuit strength', 'MVA', 'Grid capacity'], [/^3 Phase Short Circuit Current/, 'Short-circuit current', 'A', 'Grid capacity'],
    [/^No of Transformer 3/, 'Three-winding transformers', 'count', 'Station'], [/^No of Transformer/, 'Transformers', 'count', 'Station'], [/^No of Transmission Line/, 'Transmission lines', 'count', 'Station'], [/^Total no of Outlets/, 'Outlets', 'count', 'Station'], [/^Nominal Voltage/, 'Nominal voltage', 'kV', 'Station'],
    [/^Analyst_Comments/, 'Analyst commentary', 'text', 'Commentary'],
  ];
  function buildCatalog() {
    const tmap = new Map();
    D.columns.forEach(c => { if (/^(Substation |FIPS|County|State|Longitude|Latitude|bus_id|Confidence level)/.test(c)) return; const t = templateOf(c); const key = t.template; if (!tmap.has(key)) tmap.set(key, { key, cols: [], unit: t.unit, tag: t.tag, tech: t.tech, dims: {} }); const e = tmap.get(key); e.cols.push(c); if (t.unit && !e.unit) e.unit = t.unit; if (t.tag && !e.tag) e.tag = t.tag; for (const [d, v] of Object.entries(t.dims)) { (e.dims[d] = e.dims[d] || new Set()).add(v); } });
    const fams = new Map();
    for (const e of tmap.values()) {
      let label = e.key.replace(/_/g, ' '), fam = 'Other', unit = e.unit;
      for (const [re, l, u, f] of LABELS) if (re.test(e.key)) { label = l; unit = unit || u; fam = f; break; }
      const section = e.tag === 'econ' ? 'econ' : e.tag === 'grid' ? 'grid' : ECON_FAMILY.test(e.key) ? 'econ' : 'grid';
      const dims = {}; for (const [d, s] of Object.entries(e.dims)) dims[d] = [...s].sort((a, b) => d === 'size' ? parseInt(a) - parseInt(b) : String(a).localeCompare(String(b)));
      const tpl = { key: e.key, label, unit: unit || '', section, fam, tech: e.tech, dims, n: e.cols.length, cols: e.cols };
      if (!fams.has(fam)) fams.set(fam, { fam, section, tech: e.tech, templates: [], cols: 0 });
      const F = fams.get(fam); F.templates.push(tpl); F.cols += e.cols.length; if (!e.tech) F.tech = F.tech || null;
    }
    const order = ['Price', 'Basis & congestion', 'Hours', 'Storage spread', 'Solar', 'Wind', 'BESS', 'Data centre', 'Constraints', 'Grid capacity', 'Station', 'Commentary', 'Other'];
    return [...fams.values()].sort((a, b) => order.indexOf(a.fam) - order.indexOf(b.fam)).map(F => { F.templates.sort((a, b) => b.n - a.n); F.fuel = F.fam === 'Solar' ? 'solar' : F.fam === 'Wind' ? 'wind' : F.fam === 'BESS' ? 'bess' : F.fam === 'Data centre' ? 'dc' : null; return F; });
  }
  const catalog = buildCatalog();
  /** Map a template + pins to the slim node key that holds it (embedded) or null. */
  function resolve(tpl, pins = {}) {
    const col = tpl.key.replace(/\{(\w+)\}/g, (_, d) => pins[d] ?? (tpl.dims[d] ? tpl.dims[d][0] : ''));
    const y = pins.year || (tpl.dims.year ? tpl.dims.year[0] : null); const sz = pins.size || (tpl.dims.size ? tpl.dims.size[0] : null); const yr = y ? y.replace('YTD', 'YTD') : null;
    let key = null;
    if (/^Avg_LMP/.test(tpl.key)) key = `lmp_${yr}`; else if (/^P5_LMP/.test(tpl.key)) key = `p5_${yr}`; else if (/^P95_LMP/.test(tpl.key)) key = `p95_${yr}`; /* orchestrator 2026-09-27 one price basis app-wide: the key only — the configurator reads a forecast-year price through cfgVal (GS.px / GS.priceStat) */
    else if (/^Solar_Capture/.test(tpl.key)) key = `solar_cap_${yr}`; else if (/^Wind_Capture/.test(tpl.key)) key = `wind_cap_${yr}`;
    else if (/^Solar_Curt_Pct_\{size\}/.test(tpl.key)) key = `solar_${sz}_${yr}`; else if (/^Wind_Curt_Pct_\{size\}/.test(tpl.key)) key = `wind_${sz}_${yr}`; else if (/^Bess_Curt_Opp/.test(tpl.key)) key = `bess_${sz}_${yr}`; else if (/^DC_Curt/.test(tpl.key)) key = `dc_${sz}_${yr}`;
    else if (/^TB\{duration\}/.test(tpl.key)) key = `${(pins.duration || 'TB4').toLowerCase()}_${yr}`;
    else if (/^Cong_Share/.test(tpl.key)) key = `cong_${yr}`; else if (/^Hours_Below_0/.test(tpl.key)) key = `hneg_${yr}`; else if (/^Hours_Above_200/.test(tpl.key)) key = `h200_${yr}`; else if (/^Std_LMP/.test(tpl.key)) key = `std_${yr}`; else if (/^Basis_Vs_Own/.test(tpl.key)) key = `basis_own_${yr}`; else if (/^Mean_Abs_Basis/.test(tpl.key)) key = `basis_abs_${yr}`;
    else if (/^Headroom Capacity/.test(tpl.key)) { const s = pins.scenario || 'Summer Peak NCIS', d = pins.direction || 'Discharging'; const c = s.startsWith('Shoulder') ? 'sh' : s.includes('Large') ? 'll' : 'sp'; key = `hr_${c}_${d === 'Charging' ? 'chg' : 'dis'}`; }
    else if (/^# Pre-existing/.test(tpl.key)) { const s = pins.scenario || 'Summer Peak NCIS', d = pins.direction || 'Discharging'; const c = s.startsWith('Shoulder') ? 'sh' : s.includes('Large') ? 'll' : 'sp'; key = `pi_${c}_${d === 'Charging' ? 'chg' : 'dis'}`; }
    else if (/^3 Phase Short Circuit$/.test(tpl.key) || /^3 Phase Short Circuit \(MVA\)/.test(tpl.key)) key = 'sc_mva'; else if (/^Total no of Outlets/.test(tpl.key)) key = 'outlets'; else if (/^Nominal Voltage/.test(tpl.key)) key = 'kv';
    else if (/^Top_Constraint_Shadow/.test(tpl.key)) key = 'top_shadow'; else if (/^Top_Constraint_Name/.test(tpl.key)) key = 'top_constraint';
    const embedded = !!key && key in nodes[0];
    return { col, key: embedded ? key : null, embedded };
  }

  /* ── queue ──────────────────────────────────────────────────────────── */
  const queueByState = st => D.queue.filter(q => q.state === st);
  const queueNear = id => { const d = D.detail[String(id)]; return d ? d.queue_nearby : null; };

  /* ── data truths (Data notes) ───────────────────────────────────────── */
  const c = D.meta.counts;
  const truths = [
    { k: 'History is RT, forecast is DA', t: `Settled history (${fmt.int(c.lmp_hourly_hist)} rows, 2020-01-01 → 2026-04-28) is real-time settlement; the hourly forecast runs (${fmt.int(c.lmp_hourly_fcst)} rows) are day-ahead. They are badged on every hourly widget and never differenced.` },
    { k: 'One pnode per bus', t: `1,218 buses carry settled hourly prices through a market pnode; 501 of them carry more than one. The rollups keep one representative pnode per bus (exact match first, then the pnode shared by fewest buses) and name the alternates.` },
    { k: 'Shared attribution', t: `Only ${fmt.int(c.buses_exact_hourly)} of ${fmt.int(c.bus_master)} buses map one-to-one to a pnode. 921 share a substation's pnode and are badged; ${fmt.int(c.substations - c.buses_with_hourly)} of the ${fmt.int(c.substations)} annual-KPI buses have no hourly history at all.` },
    { k: 'Hourly forecast covers two vintages', t: 'Hourly forecast exists for the 5-year run (2028 basis, read for 2030) and the 10-year run (2035 basis). At 2040, 2045 and 2050 only annual figures exist, so hourly widgets return an explained empty state rather than an interpolation.' },
    { k: 'The 1,500 MW study cap', t: '51 buses return exactly 1,500 MW of Summer-peak injection headroom — a study ceiling, not a measurement. The list flags it only when the visible set is actually degenerate.' },
    { k: 'The 8,784 sentinel', t: 'Annual hour counters carry an 8,784 sentinel on 151 bus-years (exactly 8,784, never above). It is filtered as missing (≥ 8,784) and every widget that can count from the hourly data does.' },
    { k: 'Curtailment screened on two buses only', t: 'Only 100 MW at 2030 and 2035 was screened against a study run, and only at buses 100179 and 114417. Every other curtailment figure — including the whole 250 / 500 / 1000 MW ramp — is the vendor ramp and is badged "not screened".' },
    { k: 'Queue has no bus key', t: `The ${fmt.int(c.queue_projects)} interconnection-queue records carry a point-of-interconnection name, county and coordinates but no bus. Queue widgets are state-level or distance-based and say so.` },
    { k: 'Zoning', t: 'Basis is published per load zone. 1,218 buses are zoned from their own pnode, 640 by county, 820 by state; 291 Massachusetts buses would read against the wrong zone under a state default (Cape Cod settles in SEMA, not NEMA).' },
    { k: 'Two capture ratios disagree', t: 'The annual sheet\'s solar capture (p50 97.9 % for 2025) and the capture computed from settled hourly rollups (p50 89.8 %) differ by eight points. Both are shown, side by side, wherever capture appears.' },
    { k: 'History has a hole', t: '14–28 August 2023 is missing for every node (2023 carries 8,399 hours); DST spring-forward hours are absent; 2026 is year-to-date to 28 April (2,831 hours). Partial years are compared by mean, never by sum.' },
    { k: 'Two headroom vintages', t: 'The May-2026 headroom study and the later corrected sheet carry different headroom for the same bus (only 381 of 2,470 buses agree on Summer-peak discharging). Every figure here reads the corrected sheet and says so; the two are never mixed in one chart.' },
    { k: 'Analyst commentary is text, not numbers', t: 'The forecast commentary quotes pre-correction prices (a 2050 figure of $139 where the corrected column reads $65). Commentary is shown as analyst text with its vintage, never read as a figure.' },
  ];

  /** The published short-circuit column is exactly 100× too small at every bus that carries one (data-contract 3.07); the corrected value is used and stated. */
  const shortCircuitMVA = n => n && n.sc_mva != null ? n.sc_mva * 100 : null;
  return { D, nodes, byId, node: id => byId.get(Number(id)), detail: id => D.detail[String(id)] || null, stations, hasHourly: n => !!(n && n.hasHourly), shortCircuitMVA,
    FUELS, CASES, caseOf, DIRECTION, SIZES, YEARS_F, ZONES, SORTS, CRITERIA, PROFILES, MARKET_MEAN_2030, /* orchestrator 2026-09-27 one price basis app-wide: GS.MARKET_MEAN_2030 is the one-basis getter (ext/76); the local const is the corrected sheet (vendor) fallback */
    px, pxAt, pxQuiet, pxText, pxColumn, pxStamp, marketMean, /* orchestrator 2026-09-27 one price basis app-wide */
    headroom, preIssues, curt, capture, primaryHeadroom, nearestSize, constraintTable, gates, candidates, score, critPct,
    governingCase, caseWords, /* orchestrator 2026-10-06 wave1: the one fuel → study-case resolver */
    costBasis: COST_BASIS, /* orchestrator 2026-10-07 cost basis: the headline element set, its compact line and six (i) sentences */
    catalog, resolve, templateOf, queueByState, queueNear, truths, stat, fmt, iso: D.iso, meta: D.meta, coverage: D.coverage };
})();

;
