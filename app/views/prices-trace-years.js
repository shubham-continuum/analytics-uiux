// Calculation traces for the Prices all-years cards. Each mart figure (unified SQL, via api_prices.py) is
// re-computed in the browser from the bus's hourly payload with the SAME definition, so the check is an
// independent path (SQL vs JS over the same facts). Where only one path exists the trace says so.
import { trace } from '../trace.js';
import { finite, matchedBasis, priceTierLabel } from '../prices.js';
import { solarWindowLabel } from '../solar.js';
const SW = solarWindowLabel(); // S2-EM D5
import { clearSky } from '../solar.js';
import { fmt } from '../basis.js';
import { monthStats, tbMart, daRt, zoneYears, captureOf, sheetRows } from './prices-calc.js';
import { csvMeta } from './prices-trace.js';

const RUN = { '5yr': 'PROBE 5-yr (2028)', '10yr': 'PROBE 10-yr (2035)', pcr2030: 'PCR 2030', pcr2035: 'PCR 2035', pcr2040: 'PCR 2040 (12% gas)' };
const n2 = v => (finite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : 'not held');
const n4 = v => (finite(v) ? v.toFixed(4) : 'not held');
const p = v => fmt.price(v);
const d6 = v => (finite(v) ? (Math.abs(v) < 1e-6 ? `${v.toExponential(1)}` : v.toFixed(6)) : 'not held');
const calHours = y => (y % 4 === 0 ? 8784 : 8760);
const maxAbs = pairs => { const d = pairs.filter(([a, b]) => finite(a) && finite(b)).map(([a, b]) => Math.abs(a - b)); return d.length ? Math.max(...d) : null; };
const allHeld = pairs => pairs.every(([a, b]) => (finite(a) && finite(b)) || (a == null && b == null));
const src = (node, link) => ({ name: 'Settled price series', value: link?.pnode_name || '—', source: 'measured',
  // S2-D (W-B): tier words from one home (prices.priceTierLabel), incl. "relinked · N mi from <node>" (D-008).
  note: link?.price_tier ? priceTierLabel({ tier: link.price_tier, km: link.price_proxy_km, relinkMi: link.relink_mi, relinkedFrom: link.relinked_from }) : '' });
const busIn = node => ({ name: 'Bus', value: `${node?.name ?? '?'} (${node?.id ?? '?'})`, source: 'measured' });
/** When a check cannot run, the trace says why (never a silent pass). */
const noCheck = reason => [`No check possible: ${reason}`];
const basisAll = { mode: 'all years', market: '—', years: [], weighting: 'duration' };
const meta = node => csvMeta(node, { ...basisAll, nodeId: node?.id }).filter(([k]) => k !== 'basis').concat([['scope', 'every settled year and solved run held for this bus']]);

/** Yearly marts vs the hourly payload: mean, hours and p95 of every settled year and run. */
export function traceYears(node, sum, H) {
  const pairs = [];
  for (const h of H) {
    const m = h.kind === 'solved' ? (sum.fcstYear || []).find(r => r.scenario === h.run) : (sum.year || []).find(r => r.market === h.market && r.y === h.year);
    pairs.push({ h, m });
  }
  const steps = pairs.map(({ h, m }) => ({ label: `${h.kind === 'solved' ? RUN[h.run] || h.run : `${h.year} settled ${h.market}`}`, work: `mart ${n2(m?.avg_lmp)} over ${fmt.int(m?.n_hours)} rows · hourly Σ price ÷ n = ${n2(h.stats?.mean)} over ${fmt.int(h.s.records.length)} rows (${fmt.int(h.rows.length)} priced)`, value: p(m?.avg_lmp) }));
  const mean = pairs.map(({ h, m }) => [m?.avg_lmp ?? null, h.stats?.mean ?? null]);
  const p95 = pairs.map(({ h, m }) => [m?.p95 ?? null, h.stats?.p95 ?? null]);
  const hrs = pairs.map(({ h, m }) => [m?.n_hours ?? null, h.s.records.length]);
  const can = pairs.length && allHeld(mean);
  return trace({
    id: 'p-years', title: 'Every settled year and solved run',
    formula: 'mean_y = Σ_h price_h ÷ n_y (every hourly row, fold readings included);  p95_y = linear interpolation at (n − 1) × 0.95 of the sorted prices',
    inputs: [busIn(node), src(node, sum.link), { name: 'Mart rows', value: `${(sum.year || []).length} settled · ${(sum.fcstYear || []).length} solved`, source: 'measured', note: 'unified mart_bus_year / mart_bus_fcst_year' }, { name: 'Hourly series in the payload', value: fmt.int(H.length), source: 'measured', note: '/api/bus (fact_lmp_hourly, fact_fcst_lmp_hourly)' }],
    steps, result: { label: 'Years and runs', value: `${(sum.year || []).length + (sum.fcstYear || []).length}` },
    checks: can ? [
      { label: 'Independent path: every mean re-computed in the browser from the hourly rows = the SQL mart (largest difference, $/MWh)', a: maxAbs(mean), b: 0, atol: 1e-6, fmt: d6 },
      { label: 'Independent path: every p95 re-computed in the browser = the mart (largest difference)', a: maxAbs(p95), b: 0, atol: 1e-6, fmt: d6 },
      { label: 'Row counts: hourly records in the payload = mart n_hours (largest difference)', a: maxAbs(hrs), b: 0, atol: 0, fmt: v => fmt.int(v) },
    ] : [],
    notes: can ? [] : noCheck(pairs.length ? 'a year held in one source is missing from the other' : 'no hourly series is held for this bus'),
    csv: { name: `prices-years-${node?.id}.csv`, meta: meta(node), columns: ['year', 'series', 'mart_hours', 'mart_mean_usd_mwh', 'hourly_mean_usd_mwh', 'mart_p95', 'hourly_p95', 'mart_min', 'mart_max', 'mart_std', 'mart_peak', 'mart_offpeak', 'mart_neg_hours'],
      rows: pairs.map(({ h, m }) => [h.year, h.kind === 'solved' ? h.run : h.market, m?.n_hours, m?.avg_lmp, h.stats?.mean, m?.p95, h.stats?.p95, m?.min_lmp, m?.max_lmp, m?.std_lmp, m?.peak_lmp, m?.offpeak_lmp, m?.neg_hours]) },
  });
}

/** RT − DA: mart_bus_da_rt vs the same pairing done in the browser. */
export function traceDaRt(node, sum, H) {
  const years = (sum.daRt || []).map(r => r.y), rows = [];
  for (const y of years) {
    const rt = H.find(h => h.kind === 'settled' && h.market === 'RT' && h.year === y), da = H.find(h => h.kind === 'settled' && h.market === 'DA' && h.year === y);
    rows.push({ y, m: sum.daRt.find(r => r.y === y), j: rt && da ? daRt(rt.rows, da.rows) : null });
  }
  const can = rows.length && rows.every(r => r.j);
  return trace({
    id: 'p-dart', title: 'Real-time against day-ahead',
    formula: 'RT − DA = Σ_h (RT_h − DA_h) ÷ n over clock hours where both are held (fold hour: the larger reading per market);  share = hours RT > DA ÷ n',
    inputs: [busIn(node), src(node, sum.link), { name: 'Years with both markets', value: fmt.int(rows.length), source: 'measured', note: 'unified mart_bus_da_rt' }],
    steps: rows.map(r => ({ label: `${r.y}`, work: `${fmt.int(r.m.n_hours)} matched h · RT ${n2(r.m.avg_rt)} − DA ${n2(r.m.avg_da)} · browser: ${n2(r.j?.spread)} over ${fmt.int(r.j?.n)} h`, value: p(r.m.avg_rt_less_da) })),
    result: { label: `RT − DA ${rows.at(-1)?.y ?? ''}`, value: rows.length ? `${p(rows.at(-1).m.avg_rt_less_da)}/MWh` : 'not held' },
    checks: can ? [
      { label: 'Independent path: RT − DA paired in the browser from the hourly payload = the SQL mart (largest difference)', a: maxAbs(rows.map(r => [r.m.avg_rt_less_da, r.j.spread])), b: 0, atol: 1e-6, fmt: d6 },
      { label: 'Independent path: matched hours (largest difference)', a: maxAbs(rows.map(r => [r.m.n_hours, r.j.n])), b: 0, atol: 0, fmt: v => fmt.int(v) },
      { label: 'Independent path: share of hours RT above DA (largest difference)', a: maxAbs(rows.map(r => [r.m.share_rt_above_da, r.j.shareRtAbove])), b: 0, atol: 1e-9, fmt: d6 },
    ] : [],
    notes: can ? [] : noCheck(rows.length ? 'a year lacks one market in the hourly payload' : 'no year with both day-ahead and real-time prices is held for this series'),
    csv: { name: `prices-da-rt-${node?.id}.csv`, meta: meta(node), columns: ['year', 'hours_both', 'avg_da', 'avg_rt', 'rt_less_da', 'abs_spread', 'std_spread', 'p5_spread', 'p95_spread', 'share_rt_above_da', 'browser_rt_less_da'], rows: rows.map(r => [r.y, r.m.n_hours, r.m.avg_da, r.m.avg_rt, r.m.avg_rt_less_da, r.m.avg_abs_spread, r.m.std_spread, r.m.p5_spread, r.m.p95_spread, r.m.share_rt_above_da, r.j?.spread]) },
  });
}

/** Unified vs the live Studio's copy. */
export function traceSheet(node, sum, st, zs) {
  const rows = st ? sheetRows(sum, st, zs) : [];
  const both = rows.filter(r => finite(r.d));
  return trace({
    id: 'p-sheet', title: 'Studio figures beside the unified database',
    formula: 'difference = unified figure − Studio copy figure, quantity by quantity (the unified database is primary)',
    inputs: [busIn(node), { name: 'Unified database', value: 'ISONE_GridSense_unified.duckdb', source: 'measured', note: 'marts via api_prices.py' },
      { name: 'Studio copy', value: st?.meta?.sheet?.built_at || 'not held', source: 'measured', note: st ? `${st.meta?.sheet?.label || 'Studio copy'}: ${st.meta?.sheet?.file || 'file not held'}` : 'No Studio row for this bus' }],
    steps: rows.map(r => ({ label: r.q, work: `${n2(r.u)} − ${n2(r.s)}${r.note ? ` · ${r.note}` : ''}`, value: finite(r.d) ? n2(r.d) : 'not held' })),
    result: { label: 'Quantities differing by more than $0.50 or 0.5 h', value: `${both.filter(r => Math.abs(r.d) > 0.5).length} of ${both.length}` },
    checks: both.length ? [{ label: 'Arithmetic re-check of the differences (the two sources are separate builds: a difference is the finding, not an error)', a: both.reduce((t, r) => t + (r.u - r.s), 0), b: both.reduce((t, r) => t + r.d, 0), fmt: n4 }] : [],
    notes: both.length ? ['The Studio sheet (vendor, built 2026-09-20) is an older database; one bus, one price: every other card on this page uses the unified figure.'] : noCheck(st ? 'no quantity is held in both sources for this bus' : 'the live Studio holds no row for this bus'),
    csv: { name: `prices-studio-vs-unified-${node?.id}.csv`, meta: meta(node), columns: ['quantity', 'unified', 'studio_copy', 'unified_minus_studio', 'note'], rows: rows.map(r => [r.q, r.u, r.s, r.d, r.note]) },
  });
}

/** Node − zone and node − hub, hour-matched in SQL; the hub row re-matched in the browser. */
export function traceZones(node, zs, data, id) {
  const zy = zoneYears(zs.settled);
  const ys = zy.filter(r => r.zone === 'Hub' && r.market === 'RT' && r.hours >= 0.95 * calHours(r.y)).map(r => r.y);
  const y = ys.length ? Math.max(...ys) : null;
  const rows = zy.filter(r => r.market === 'RT' && r.y === y).sort((a, b) => a.zone.localeCompare(b.zone));
  const hubRow = rows.find(r => r.zone === 'Hub'), own = rows.find(r => r.zone === zs.ownZone);
  const ns = data.series.find(s => String(s.nodeId) === String(id) && s.mode === 'historical' && s.market === 'RT' && s.year === y);
  const hs = data.series.find(s => s.nodeId === 'hub' && s.mode === 'historical' && s.market === 'RT' && s.year === y);
  const m = ns && hs ? matchedBasis(ns, hs) : [];
  const jsBasis = m.length ? m.reduce((t, r) => t + r.price * r.dtHours, 0) / m.reduce((t, r) => t + r.dtHours, 0) : null;
  const checks = [];
  if (hubRow && finite(jsBasis)) checks.push({ label: `Independent path: ${y} hub basis re-matched in the browser from the hourly payload (the repeated autumn hour counts once in SQL, twice here, so agreement is to $0.01)`, a: jsBasis, b: hubRow.basis, atol: 0.01, fmt: p });
  if (own) checks.push({ label: `Arithmetic re-check: mean node − mean ${own.zone} over the same hours = the basis`, a: own.node - own.ref, b: own.basis, fmt: p });
  return trace({
    id: 'p-zone', title: `Basis to every zone${y ? `, ${y} RT` : ''}`,
    formula: 'basis_z = Σ_t (node_t − zone_t) ÷ n_t over timestamps held in both series (repeated autumn hour averaged per series first)',
    inputs: [busIn(node), src(node, zs.link), { name: 'Own zone', value: zs.ownZone || 'not held', source: 'measured', note: "the price node's zone (dim_pnode.zone_name)" }, { name: 'Zone series', value: '.Z.* load zones + .H.INTERNAL_HUB', source: 'measured', note: 'unified fact_lmp_hourly' }],
    steps: rows.map(r => ({ label: `${r.zone}${r.zone === zs.ownZone ? ' (own)' : ''}`, work: `Σ(node − zone) ${n2(r.sb)} ÷ ${fmt.int(r.hours)} h · node above zone ${fmt.pct(r.abovePct)}`, value: p(r.basis) })),
    result: { label: `Basis to ${zs.ownZone || 'own zone'}`, value: own ? `${p(own.basis)}/MWh` : 'not held' },
    checks, notes: checks.length ? [] : noCheck('no full settled real-time year is held for this bus and the hub'),
    csv: { name: `prices-zone-basis-${node?.id}.csv`, meta: meta(node), columns: ['zone', 'market', 'year', 'month', 'hours', 'sum_node_minus_zone', 'sum_node', 'sum_zone', 'hours_node_above'], rows: (zs.settled || []).map(r => [r.zone, r.market, r.y, r.m, r.hours, r.sum_basis, r.sum_node, r.sum_ref, r.hours_above]) },
  });
}

/** Binding constraints for one period: association arithmetic, the annual MCC against the mart, exact shares. */
export function traceConstraints(node, cs, per, sum) {
  const P = cs.periods[per], ex = cs.exact?.[per] || [], top = P.rows[0];
  const settled = /^(RT|DA)\d{4}$/.test(per);
  const mart = settled ? (sum?.year || []).find(r => r.market === per.slice(0, 2) && r.y === Number(per.slice(2)))?.avg_cong : (sum?.fcstYear || []).find(r => r.scenario === per)?.avg_cong;
  const steps = [{ label: 'Annual mean MCC', work: `Σ MCC ${n2(P.sum_all)} ÷ ${fmt.int(P.n)} h`, value: p(P.mcc) },
    ...P.rows.slice(0, 8).map(r => ({ label: r.name.split(' · ')[0].slice(0, 60), work: `(${n4(r.mcc_on)} − ${n4(r.mcc_off)}) × ${fmt.int(r.hours)} ÷ ${fmt.int(P.n)}`, value: finite(r.assoc) ? `$${r.assoc.toFixed(4)}` : 'not held' }))];
  if (ex.length) steps.push({ label: `Exact shares (${ex.length} constraints with a DFAX)`, work: `Σ shadow × DFAX ÷ ${fmt.int(P.n)} h, summed`, value: p(ex.reduce((t, r) => t + (r.contrib || 0), 0)) });
  const checks = [];
  if (top && finite(top.mcc_on) && finite(top.mcc_off)) checks.push({ label: 'Consistency check: MCC in the binding hours × h + MCC otherwise × (n − h) rebuilds Σ MCC', a: top.mcc_on * top.hours + top.mcc_off * (P.n - top.hours), b: P.sum_all, tol: 1e-6, fmt: n4 });
  if (finite(mart) && finite(P.mcc)) checks.push({ label: settled ? 'Independent path: annual MCC from the constraint query = mart_bus_year avg_cong (the mart counts both autumn fold readings, so to $0.001)' : 'Independent path: annual MCC from the constraint query = mart_bus_fcst_year congestion (sign normalised)', a: P.mcc, b: mart, atol: settled ? 0.001 : 1e-6, fmt: n4 });
  if (ex.length) checks.push({ label: 'Independent identity: the exact shares (shadow × DFAX) sum to the run\'s annual mean MCC', a: ex.reduce((t, r) => t + (r.contrib || 0), 0), b: P.mcc, atol: 0.01, fmt: n4 });
  return trace({
    id: 'p-cons', title: `Binding constraints · ${RUN[per] || per}`,
    formula: 'assoc_k = (MCC̄ in the hours k bound − MCC̄ in every other hour) × hours_k ÷ n;  exact_k = Σ_h shadow_h × DFAX_k ÷ n (PCR unit nodes only)',
    inputs: [busIn(node), src(node, cs.link), { name: 'Period', value: per, source: 'user' }, { name: 'Hours with a price', value: fmt.int(P.n), source: 'measured' }, { name: 'Constraints that bound in those hours', value: fmt.int(P.bound), source: 'measured', note: 'network constraints only (SYSTEM_*, NODE_* and the energy-balance row excluded)' }],
    steps, result: { label: top ? 'Leading association' : 'Annual MCC', value: top ? `$${(top.assoc ?? 0).toFixed(4)}/MWh` : `${p(P.mcc)}/MWh` },
    checks, notes: [cs.rules.association, ...(checks.length ? [] : noCheck('no binding hour and no mart figure for this period'))],
    csv: { name: `prices-constraints-${per}-${node?.id}.csv`, meta: meta(node), columns: ['constraint', 'hours_bound', 'mcc_on', 'mcc_off', 'assoc_usd_mwh', 'mean_abs_shadow', 'max_abs_shadow', 'dfax', 'exact_usd_mwh'],
      rows: [...P.rows.map(r => { const e = ex.find(x => x.name === r.name); return [r.name, r.hours, r.mcc_on, r.mcc_off, r.assoc, r.mean_abs_shadow, r.max_abs_shadow, e?.dfax, e?.contrib]; }), ...ex.filter(e => !P.rows.some(r => r.name === e.name)).map(e => [e.name, e.hours, null, null, null, null, null, e.dfax, e.contrib])] },
  });
}

/** Components by year: settled E + C + L against the mean LMP (data check); solved runs by construction. */
export function traceCompYears(node, sum) {
  const st = (sum.year || []).filter(r => r.market === 'RT'), fr = sum.fcstYear || [];
  const gap = st.map(r => [r.avg_energy + r.avg_cong + r.avg_loss, r.avg_lmp]).filter(([a, b]) => finite(a) && finite(b));
  return trace({
    id: 'p-compyears', title: 'Price components by year',
    formula: 'LMP = energy + congestion + loss (settlement sign);  solved: congestion = −stored, energy = LMP − congestion − loss',
    inputs: [busIn(node), src(node, sum.link), { name: 'Settled RT years', value: fmt.int(st.length), source: 'measured', note: 'mart_bus_year avg_energy / avg_cong / avg_loss' }, { name: 'Solved runs', value: fmt.int(fr.length), source: 'measured', note: 'mart_bus_fcst_year, congestion negated once at read' }],
    steps: [...st.map(r => ({ label: `${r.y} settled RT`, work: `${n2(r.avg_energy)} + ${n2(r.avg_cong)} + ${n2(r.avg_loss)}`, value: p(r.avg_energy + r.avg_cong + r.avg_loss) })),
      ...fr.map(r => ({ label: `${r.target_year} ${RUN[r.scenario] || r.scenario}`, work: `stored C ${n2(r.avg_cong_stored)} → ${n2(r.avg_cong)}; E = ${n2(r.avg_lmp)} − ${n2(r.avg_cong)} − ${n2(r.avg_loss)}`, value: p(r.avg_energy) }))],
    result: { label: 'Years and runs split', value: `${st.length + fr.length}` },
    checks: gap.length ? [{ label: 'Data check: settled energy + congestion + loss = mean LMP, every year (largest difference, $/MWh)', a: maxAbs(gap), b: 0, atol: 0.01, fmt: d6 }] : [],
    notes: [...(fr.length ? ['Solved energy is derived as LMP − congestion − loss, so a run\'s three components add to its price by construction; that is not a check.'] : []), ...(gap.length ? [] : noCheck('no settled year is held for this bus; solved components add up by construction'))],
    csv: { name: `prices-components-by-year-${node?.id}.csv`, meta: meta(node), columns: ['year', 'series', 'energy', 'congestion', 'loss', 'lmp', 'hours'], rows: [...st.map(r => [r.y, 'RT', r.avg_energy, r.avg_cong, r.avg_loss, r.avg_lmp, r.n_hours]), ...fr.map(r => [r.target_year, r.scenario, r.avg_energy, r.avg_cong, r.avg_loss, r.avg_lmp, r.n_hours])] },
  });
}

/** Capture by year: clear-sky capture per series; the window mean re-checked against mart_bus_month. */
export function traceCapYears(node, cs, sum, lat, lon, H) {
  const pairs = [];
  for (const h of H || []) {
    if (!h.rows.length) continue;
    const ms = monthStats(h.rows);
    const mrows = h.kind === 'solved' ? (sum?.fcstMonth || []).filter(r => r.scenario === h.run) : (sum?.month || []).filter(r => r.market === h.market && r.y === h.year);
    for (const m of mrows) pairs.push([m.solar_lmp ?? null, ms[m.m - 1].window ?? null]);
  }
  const last = [...cs].reverse().find(r => r.kind === 'settled' && r.market === 'RT') || cs.at(-1);
  const lh = (H || []).find(h => h.key === last?.key);
  const rerun = lh ? captureOf(lh.rows, r => clearSky(r.timestamp, lat, lon)) : null;
  const checks = [];
  if (pairs.length && allHeld(pairs)) checks.push({ label: `Independent path: every monthly solar-window mean (${SW}) re-computed from the hourly payload = mart_bus_month solar_lmp (${pairs.length} months, largest difference)`, a: maxAbs(pairs), b: 0, atol: 1e-6, fmt: d6 });
  if (rerun && finite(last?.capture)) checks.push({ label: `Arithmetic re-run of the ${last.year} ${last.market || last.run} clear-sky capture loop`, a: rerun.capture, b: last.capture, fmt: p });
  return trace({
    id: 'p-capyears', title: 'Capture ratio by year',
    formula: `clear-sky capture_y = Σ g_h × price_h ÷ Σ g_h;  ratio = capture ÷ mean;  window ratio = mean(price, ${SW}) ÷ mean(price)`,
    inputs: [busIn(node), src(node, sum?.link), { name: 'Latitude, longitude', value: `${n4(lat)}, ${n4(lon)}`, source: 'measured' }, { name: 'Shape g', value: 'Clear-sky sun elevation', source: 'assumption', note: 'no clouds, clipping or losses' }, { name: 'Window', value: SW, source: 'rule', note: "the unified mart's solar window" }],
    steps: cs.map(r => ({ label: `${r.year} ${r.kind === 'solved' ? RUN[r.run] || r.run : `settled ${r.market}`}`, work: `capture ${n2(r.capture)} ÷ mean ${n2(r.avg)} · window ${n2(r.window)} ÷ ${n2(r.avg)}`, value: `${finite(r.ratio) ? r.ratio.toFixed(3) : 'not held'} · ${finite(r.windowRatio) ? r.windowRatio.toFixed(3) : 'not held'}` })),
    result: { label: `Clear-sky ratio ${last?.year ?? ''}`, value: finite(last?.ratio) ? last.ratio.toFixed(3) : 'not held' },
    checks, notes: checks.length ? [] : noCheck('no hourly series is held for this bus'),
    csv: { name: `prices-capture-by-year-${node?.id}.csv`, meta: meta(node), columns: ['year', 'series', 'hours', 'mean', 'clear_sky_capture', 'clear_sky_ratio', 'window_mean', 'window_ratio'], rows: cs.map(r => [r.year, r.kind === 'solved' ? r.run : r.market, r.n, r.avg, r.capture, r.ratio, r.window, r.windowRatio]) },
  });
}

/** Peak / off-peak: mart vs the same split in the browser (settled); solved runs use the run's own flag. */
export function tracePeak(node, sum, H) {
  const rows = (sum.year || []).map(m => ({ m, h: H.find(x => x.kind === 'settled' && x.market === m.market && x.year === m.y) }));
  const pk = rows.map(r => [r.m.peak_lmp, r.h?.stats?.peak ?? null]), op = rows.map(r => [r.m.offpeak_lmp, r.h?.stats?.offpeak ?? null]);
  const can = rows.length && allHeld(pk) && allHeld(op);
  return trace({
    id: 'p-peak', title: 'Peak and off-peak by year',
    formula: 'peak_y = mean price over clock hours 7–22 (HE08–HE23), every day;  off-peak = the other hours;  spread = peak − off-peak',
    inputs: [busIn(node), src(node, sum.link), { name: 'Peak definition', value: 'hour 7–22, all days', source: 'rule', note: 'unified single definition (data_quality: peak_offpeak normalised)' }],
    steps: [...rows.map(r => ({ label: `${r.m.y} settled ${r.m.market}`, work: `peak ${n2(r.m.peak_lmp)} − off-peak ${n2(r.m.offpeak_lmp)}`, value: p(r.m.peak_lmp - r.m.offpeak_lmp) })),
      ...(sum.fcstYear || []).map(r => ({ label: `${r.target_year} ${RUN[r.scenario] || r.scenario}`, work: `peak ${n2(r.peak_lmp)} − off-peak ${n2(r.offpeak_lmp)} (run's is_peak flag)`, value: finite(r.peak_lmp) ? p(r.peak_lmp - r.offpeak_lmp) : 'not held' }))],
    result: { label: 'Years and runs', value: `${rows.length + (sum.fcstYear || []).length}` },
    checks: can ? [{ label: 'Independent path: settled peak means re-computed from the hourly payload = the mart (largest difference)', a: maxAbs(pk), b: 0, atol: 1e-6, fmt: d6 }, { label: 'Independent path: settled off-peak means (largest difference)', a: maxAbs(op), b: 0, atol: 1e-6, fmt: d6 }] : [],
    notes: [...((sum.fcstYear || []).length ? ["A solved run's peak uses the run's own is_peak flag, which is not in the hourly payload: those rows are read, not re-computed."] : []), ...(can ? [] : noCheck('no settled year is held for this bus'))],
    csv: { name: `prices-peak-${node?.id}.csv`, meta: meta(node), columns: ['year', 'series', 'peak', 'offpeak', 'browser_peak', 'browser_offpeak'], rows: [...rows.map(r => [r.m.y, r.m.market, r.m.peak_lmp, r.m.offpeak_lmp, r.h?.stats?.peak, r.h?.stats?.offpeak]), ...(sum.fcstYear || []).map(r => [r.target_year, r.scenario, r.peak_lmp, r.offpeak_lmp, null, null])] },
  });
}

/** TB2/4/8: mart_bus_tb vs the per-date method in the browser. */
export function traceTb(node, sum, H) {
  const rows = (sum.tb || []).map(m => ({ m, h: H.find(x => x.kind === 'settled' && x.market === m.market && x.year === m.y) })).map(r => ({ ...r, j: r.h ? [2, 4, 8].map(N => tbMart(r.h.rows, N)) : null }));
  const pairs = rows.flatMap(r => (r.j ? [[r.m.tb2, r.j[0].mean], [r.m.tb4, r.j[1].mean], [r.m.tb8, r.j[2].mean]] : []));
  const can = rows.length && rows.every(r => r.j) && allHeld(pairs);
  const w = rows.find(r => r.m.market === 'RT' && r.j) || rows.find(r => r.j);
  const wd = w?.j[1].daily.reduce((b, d) => (!b || d.spread > b.spread ? d : b), null);
  const wp = wd ? w.h.rows.filter(r => String(r.timestamp).slice(0, 10) === wd.day).map(r => r.price).sort((a, b) => a - b) : [];
  return trace({
    id: 'p-tb', title: 'Storage spreads by year (TB2 / TB4 / TB8)',
    formula: 'TB_N,y = mean over calendar dates of [ mean(N dearest hourly prices) − mean(N cheapest) ]  (every date held; a short date uses what it has)',
    inputs: [busIn(node), src(node, sum.link), { name: 'Durations', value: '2, 4, 8 h', source: 'rule' }],
    steps: [...rows.map(r => ({ label: `${r.m.y} settled ${r.m.market}`, work: `${fmt.int(r.m.n_days)} days · TB2 ${n2(r.m.tb2)} · TB8 ${n2(r.m.tb8)} · browser TB4 ${n2(r.j?.[1].mean)}`, value: p(r.m.tb4) })),
      ...(wd ? [{ label: `Worked day ${wd.day} (TB4, ${w.m.y} ${w.m.market})`, work: `(${wp.slice(-4).map(n2).join(' + ')}) ÷ 4 − (${wp.slice(0, 4).map(n2).join(' + ')}) ÷ 4`, value: p(wd.spread) }] : [])],
    result: { label: 'Settled years', value: fmt.int(rows.length) },
    checks: can ? [{ label: 'Independent path: every TB2/TB4/TB8 re-computed in the browser from the hourly payload = mart_bus_tb (largest difference)', a: maxAbs(pairs), b: 0, atol: 1e-6, fmt: d6 }, { label: 'Independent path: days counted (largest difference)', a: maxAbs(rows.map(r => [r.m.n_days, r.j[1].days])), b: 0, atol: 0, fmt: v => fmt.int(v) }] : [],
    notes: ['Solved-run spreads have no mart: they are computed here only, with the same per-date method.', ...(can ? [] : noCheck('no settled year is held for this bus'))],
    csv: { name: `prices-tb-${node?.id}.csv`, meta: meta(node), columns: ['year', 'market', 'days', 'tb2', 'tb4', 'tb8', 'tb4_p10', 'tb4_p90', 'browser_tb4'], rows: rows.map(r => [r.m.y, r.m.market, r.m.n_days, r.m.tb2, r.m.tb4, r.m.tb8, r.m.tb4_p10, r.m.tb4_p90, r.j?.[1].mean]) },
  });
}

/** Scarcity and negative hours: hourly counts vs the mart's < $0 and > $200 columns. */
export function traceScarcity(node, sum, H) {
  const pairs = [], steps = [];
  for (const h of H) {
    const m = h.kind === 'solved' ? (sum.fcstYear || []).find(r => r.scenario === h.run) : (sum.year || []).find(r => r.market === h.market && r.y === h.year);
    const neg = h.rows.filter(r => r.price < 0).length, g200 = h.rows.filter(r => r.price > 200).length;
    pairs.push([m?.neg_hours ?? null, neg]);
    if (h.kind === 'settled') pairs.push([m?.hours_gt_200 ?? null, g200]);
    steps.push({ label: h.kind === 'solved' ? RUN[h.run] || h.run : `${h.year} settled ${h.market}`, work: `< $0: ${fmt.int(neg)} (mart ${fmt.int(m?.neg_hours)}) · > $200: ${fmt.int(g200)}${h.kind === 'settled' ? ` (mart ${fmt.int(m?.hours_gt_200)})` : ''} of ${fmt.int(h.rows.length)} h`, value: fmt.int(neg) });
  }
  const can = pairs.length && allHeld(pairs);
  return trace({
    id: 'p-scar', title: 'Scarcity and negative hours',
    formula: 'count_y(t) = number of hourly prices beyond t: < $0, ≤ $0, > $100, > $200, > $500, > $1,000',
    inputs: [busIn(node), src(node, sum.link), { name: 'Thresholds', value: '$0, $100, $200, $500, $1,000', source: 'rule' }],
    steps, result: { label: 'Series counted', value: fmt.int(H.length) },
    checks: can ? [{ label: 'Independent path: < $0 and > $200 counts from the hourly payload = the SQL marts (largest difference, hours)', a: maxAbs(pairs), b: 0, atol: 0, fmt: v => fmt.int(v) }] : [],
    notes: ['> $100, > $500 and > $1,000 have no mart column: those are counted here only.', ...(can ? [] : noCheck('a series held in the payload has no mart row'))],
    csv: { name: `prices-scarcity-${node?.id}.csv`, meta: meta(node), columns: ['year', 'series', 'hours', 'lt0', 'le0', 'gt100', 'gt200', 'gt500', 'gt1000'], rows: H.map(h => { const v = h.rows.map(r => r.price); return [h.year, h.kind === 'solved' ? h.run : h.market, v.length, v.filter(x => x < 0).length, v.filter(x => x <= 0).length, v.filter(x => x > 100).length, v.filter(x => x > 200).length, v.filter(x => x > 500).length, v.filter(x => x > 1000).length]; }) },
  });
}
