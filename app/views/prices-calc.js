// Pure calculations for the Prices dashboard's all-years cards (Node-tested in tests/prices-calc.test.mjs).
// Two families:
//  (1) mart readers: shape the api_prices.py aggregates (unified marts) into chart/table rows;
//  (2) hourly re-computations: the SAME definitions as the unified mart SQL, recomputed in the browser from the
//      bus's hourly payload, so each trace can check a mart figure by an independent path (SQL vs JS).
// Null = not held, never 0. Definitions mirror unified/build_unified_db.py (quantile_cont, peak hour 7–22,
// solar window hours 9–16, neg < 0, > $200, per-date top/bottom-N spreads).
import { inSolarWindow } from '../solar.js'; // S2-EM D5: one solar window (solar.js MART_SOLAR_WINDOW)
import { finite, quantile } from '../prices.js';

export const clockHour = stamp => Number(String(stamp).slice(11, 13));
export const clockDate = stamp => String(stamp).slice(0, 10);
export const clockMonth = stamp => Number(String(stamp).slice(5, 7));
const mean = a => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);
const sampleStd = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / (a.length - 1)); };

/** Records [stamp, price, gen, energy, congestion, loss] → held price rows (nulls dropped, fold readings kept as the mart does). */
export function heldRows(series) {
  return (series?.records || []).filter(r => finite(r[1])).map(r => ({ timestamp: r[0], price: r[1], energy: r[3], congestion: r[4], loss: r[5] }));
}

/** One year (or run) the way the unified mart computes it: every held hourly row, equal weight. */
export function yearStats(rows) {
  const p = rows.map(r => r.price);
  if (!p.length) return null;
  const peak = rows.filter(r => { const h = clockHour(r.timestamp); return h >= 7 && h <= 22; }).map(r => r.price);
  const off = rows.filter(r => { const h = clockHour(r.timestamp); return !(h >= 7 && h <= 22); }).map(r => r.price);
  const win = rows.filter(r => { const h = clockHour(r.timestamp); return inSolarWindow(h); }).map(r => r.price);
  const comp = k => { const v = rows.map(r => r[k]).filter(finite); return v.length ? mean(v) : null; };
  const avg = mean(p);
  return {
    n: p.length, mean: avg, min: Math.min(...p), max: Math.max(...p), std: sampleStd(p),
    p5: quantile(p, 0.05), p25: quantile(p, 0.25), p50: quantile(p, 0.5), p75: quantile(p, 0.75), p95: quantile(p, 0.95),
    neg: p.filter(v => v < 0).length, le0: p.filter(v => v <= 0).length, gt200: p.filter(v => v > 200).length,
    peak: mean(peak), offpeak: mean(off), window: mean(win), windowRatio: avg ? mean(win) / avg : null,
    energy: comp('energy'), congestion: comp('congestion'), loss: comp('loss'),
  };
}

/** Monthly figures the mart publishes (mean, solar-window mean, negative hours) from hourly rows. */
export function monthStats(rows) {
  return Array.from({ length: 12 }, (_, i) => {
    const rs = rows.filter(r => clockMonth(r.timestamp) === i + 1), p = rs.map(r => r.price);
    const win = rs.filter(r => { const h = clockHour(r.timestamp); return inSolarWindow(h); }).map(r => r.price);
    return { m: i + 1, n: p.length, mean: mean(p), window: mean(win), neg: p.length ? p.filter(v => v < 0).length : null, max: p.length ? Math.max(...p) : null };
  });
}

/** The mart's storage spread: per calendar date, mean of the N dearest − mean of the N cheapest held prices; mean over dates. */
export function tbMart(rows, N) {
  const days = new Map();
  for (const r of rows) { const d = clockDate(r.timestamp); if (!days.has(d)) days.set(d, []); days.get(d).push(r.price); }
  const daily = [...days].map(([day, p]) => { const s = [...p].sort((a, b) => a - b); const k = Math.min(N, s.length); return { day, spread: mean(s.slice(-k)) - mean(s.slice(0, k)) }; });
  return { days: daily.length, mean: daily.length ? mean(daily.map(d => d.spread)) : null, daily };
}

/** RT − DA the mart's way: per clock stamp (offset dropped), the larger reading of each market; hours with both held. */
export function daRt(rtRows, daRows) {
  const pick = rows => { const m = new Map(); for (const r of rows) { const k = String(r.timestamp).slice(0, 19); m.set(k, m.has(k) ? Math.max(m.get(k), r.price) : r.price); } return m; };
  const rt = pick(rtRows), da = pick(daRows), d = [];
  for (const [k, v] of rt) if (da.has(k)) d.push({ stamp: k, rt: v, da: da.get(k), spread: v - da.get(k) });
  if (!d.length) return null;
  const s = d.map(x => x.spread);
  return { n: d.length, rt: mean(d.map(x => x.rt)), da: mean(d.map(x => x.da)), spread: mean(s), abs: mean(s.map(Math.abs)), std: sampleStd(s),
    p5: quantile(s, 0.05), p95: quantile(s, 0.95), shareRtAbove: d.filter(x => x.rt > x.da).length / d.length };
}

/** Hours above each threshold and at/below zero. */
export function thresholdCounts(prices, thresholds) {
  const out = { n: prices.length, le0: prices.filter(v => v <= 0).length, lt0: prices.filter(v => v < 0).length };
  for (const t of thresholds) out[`gt${t}`] = prices.filter(v => v > t).length;
  return out;
}

/** The k dearest hourly rows (ties by time). */
export function topHours(rows, k = 12) {
  return [...rows].sort((a, b) => b.price - a.price || String(a.timestamp).localeCompare(String(b.timestamp))).slice(0, k);
}

/** Zone endpoint rows (sums) → per (zone, market, year) {hours, basis, node, ref, above}. */
export function zoneYears(settled) {
  const m = new Map();
  for (const r of settled || []) {
    const k = `${r.zone}|${r.market}|${r.y}`, o = m.get(k) || { zone: r.zone, market: r.market, y: r.y, hours: 0, sb: 0, sn: 0, sr: 0, above: 0 };
    o.hours += r.hours; o.sb += r.sum_basis; o.sn += r.sum_node; o.sr += r.sum_ref; o.above += r.hours_above; m.set(k, o);
  }
  return [...m.values()].map(o => ({ ...o, basis: o.hours ? o.sb / o.hours : null, node: o.hours ? o.sn / o.hours : null, ref: o.hours ? o.sr / o.hours : null, abovePct: o.hours ? 100 * o.above / o.hours : null }));
}

/** Zone endpoint rows → basis by month for one zone and market, pooled over the given years. */
export function zoneMonths(settled, zone, market, years) {
  return Array.from({ length: 12 }, (_, i) => {
    const rs = (settled || []).filter(r => r.zone === zone && r.market === market && r.m === i + 1 && (!years || years.includes(r.y)));
    const h = rs.reduce((t, r) => t + r.hours, 0);
    return { m: i + 1, hours: h, basis: h ? rs.reduce((t, r) => t + r.sum_basis, 0) / h : null };
  });
}

/** Association row consistency: mcc_on × h + mcc_off × (n − h) must rebuild Σ MCC over the year. */
export function assocRebuild(row, n) {
  if (!finite(row?.mcc_on) || !finite(row?.mcc_off) || !n) return null;
  return row.mcc_on * row.hours + row.mcc_off * (n - row.hours);
}

/** Percentile grid (0..100 step) of a price list, high → low, for compact duration curves. */
export function durationGrid(prices, step = 1) {
  const s = prices.filter(finite).sort((a, b) => b - a);
  if (!s.length) return [];
  const out = [];
  for (let q = 0; q <= 100 + 1e-9; q += step) out.push({ x: q, y: s[Math.min(s.length - 1, Math.round((q / 100) * (s.length - 1)))] });
  return out;
}

/** Hour-weighted capture with shape g over rows (rows need dtHours); returns {capture, avg, ratio}. */
export function captureOf(rows, g) {
  let num = 0, den = 0, sum = 0, h = 0;
  for (const r of rows) { const w = g(r); if (w == null) continue; const dt = r.dtHours ?? 1; num += w * r.price * dt; den += w * dt; sum += r.price * dt; h += dt; }
  const avg = h ? sum / h : null, cap = den ? num / den : null;
  return { capture: cap, avg, ratio: finite(cap) && avg ? cap / avg : null, weight: den, hours: h };
}

/** Year-level components from the mart rows: settled RT/DA and runs, E + C + L with the check value. */
export function componentYears(summary, market = 'RT') {
  const hist = (summary?.year || []).filter(r => r.market === market).map(r => ({ label: String(r.y), kind: 'settled', y: r.y, n: r.n_hours, energy: r.avg_energy, congestion: r.avg_cong, loss: r.avg_loss, lmp: r.avg_lmp }));
  const runs = (summary?.fcstYear || []).map(r => ({ label: `${r.target_year} ${r.scenario}`, kind: 'solved', y: r.target_year, run: r.scenario, n: r.n_hours, energy: r.avg_energy, congestion: r.avg_cong, loss: r.avg_loss, lmp: r.avg_lmp }));
  return [...hist, ...runs];
}

/**
 * P2 C58: the footnote every day-ahead figure carries. The marts hold the DA LMP only; ISO-NE's settled day-ahead credit
 * adds the FER/DASI price. Figures come from the rules file entry energy_settlement.da_premium_2025 (src + status);
 * without the entry the note still states the exclusion and prints no figure.
 */
export function daFerNote(entry) {
  const e = entry && typeof entry === 'object' ? entry : null;
  const fig = e && finite(e.fer) ? ` (${`$${e.fer.toFixed(2)}`}/MWh at the hub in 2025${finite(e.da_hub) ? `; FER-inclusive hub day-ahead $${e.da_hub.toFixed(2)}` : ''} · ${e.src || 'source not held'} · ${e.status || 'status not held'})` : '';
  return `Day-ahead figures are the DA LMP only: excludes the FER/DASI price${fig} · REGISTER row 71`;
}

/** Unified vs Studio copy, quantity by quantity. */
export function sheetRows(sum, st, zs) {
  const sh = st?.bus?.sheet || {}, y25 = (sum?.year || []).find(r => r.market === 'RT' && r.y === 2025), f = run => (sum?.fcstYear || []).find(r => r.scenario === run) || null;
  const own = zs ? zoneYears(zs.settled).find(r => r.zone === zs.ownZone && r.market === 'RT' && r.y === 2025) : null;
  const ratio = st?.bus?.sheet2030vs5yr;
  return [
    { q: 'Mean price 2025 (settled RT)', u: y25?.avg_lmp, s: sh.lmp_2025, note: 'same settled year' },
    { q: 'Mean price 2030', u: f('pcr2030')?.avg_lmp, s: sh.lmp_2030, note: `unified = PCR 2030 run; the vendor sheet's 2030 is the 5-yr (2028) run relabelled × ${finite(ratio) ? ratio.toFixed(4) : 'a ratio not held at this bus'}; not used` },
    { q: 'Mean price 2035', u: f('pcr2035')?.avg_lmp, s: sh.lmp_2035, note: `unified = PCR 2035 run (10-yr run: ${(finite(f('10yr')?.avg_lmp) ? `$${f('10yr').avg_lmp.toFixed(2)}` : 'not held')})` },
    { q: 'Mean price 2050', u: null, s: sh.lmp_2050, note: 'not loaded in the unified database: the vendor 2045/2050 were 2040 × 1.0816 per step, a flat escalation, not a simulation' },
    { q: 'p5 2030', u: f('pcr2030')?.p5, s: sh.p5_2030, note: 'unified = PCR 2030' },
    { q: 'p95 2030', u: f('pcr2030')?.p95, s: sh.p95_2030, note: 'unified = PCR 2030' },
    { q: 'Std 2025 (RT)', u: y25?.std_lmp, s: sh.std_2025, note: 'sample standard deviation' },
    { q: 'Hours < $0, 2025 (RT)', u: y25?.neg_hours, s: sh.hneg_2025 ?? sh.rt_neg_2025, note: 'count', int: true },
    { q: 'Hours > $200, 2025 (RT)', u: y25?.hours_gt_200, s: sh.h200_2025, note: 'count', int: true },
    { q: 'Congestion 2025 (RT)', u: y25?.avg_cong, s: sh.cong_2025, note: 'annual mean MCC, settlement sign' },
    { q: 'Basis to own zone 2025 (RT)', u: own?.basis, s: sh.basis_own_2025, note: `unified: hour-matched against ${own?.zone || 'the zone'} series` },
  ].map(r => {
    // P2 C59: the vendor sheet writes 0.00 where it holds no figure (cong_2025 = 0.0 at buses whose settled MCC is
    // 0.0976); on a $/MWh quantity that is a placeholder, so it is not held. Counts keep a true zero.
    const placeholder = !r.int && r.s === 0;
    const row = placeholder ? { ...r, s: null, note: `${r.note}; vendor 0.00 = not held (placeholder)` } : r;
    return { ...row, d: finite(row.u) && finite(row.s) ? row.u - row.s : null };
  });
}
