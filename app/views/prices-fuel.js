// Fuel-specific price calculations for the Prices dashboard (Node-tested in tests/prices-fuel.test.mjs).
//  - Data centre / load: bill share by hour (Studio 5.18), scarcity-hour cost (5.21 exact + proxy), hours under $20
//    and the real-time cost to a flat load (5.31).
//  - Storage: charge/discharge blocks by hour of day and by month (5.16), daily spread duration curve (5.17).
//  - Wind: the overnight window floor P5/P25 (5.20) and a capture proxy with the ISO-NE fleet wind shape.
// Rows are {timestamp, price, dtHours?}; clock hour/date/month are read off the stamp (settled clock or model
// calendar), exactly as the other Prices calculations. Null = not held, never 0.
import { finite, quantile, isBorrowedPrice } from '../prices.js';

const hourOf = t => Number(String(t).slice(11, 13));
const dateOf = t => String(t).slice(0, 10);
const monthOf = t => Number(String(t).slice(5, 7));
const dt = r => r.dtHours ?? 1;
const mean = a => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);

export const FUELS = ['solar', 'wind', 'storage', 'hybrid', 'datacenter'];
/** The shell's S.tech → one of the five fuels (unknown → solar, the shell's default). */
export const fuelOf = tech => (FUELS.includes(tech) ? tech : 'solar');

/** Wind window of the live Studio's rollups (agg_build.py): HE 1–7 and HE 19–24 = clock hours 0–6 and 18–23. */
export const isWindHour = h => h <= 6 || h >= 18;

/** Share of a flat load's energy bill by clock hour: Σ price·h in hour h ÷ Σ price·h. Not held when the bill is not positive. */
export function billShare(rows) {
  const acc = Array.from({ length: 24 }, (_, h) => ({ h, n: 0, hrs: 0, cost: 0 }));
  let total = 0;
  for (const r of rows) { if (!finite(r.price)) continue; const a = acc[hourOf(r.timestamp)]; if (!a) continue; a.n++; a.hrs += dt(r); a.cost += r.price * dt(r); total += r.price * dt(r); }
  const ok = rows.length > 0 && total > 0;
  const hours = acc.map(a => ({ h: a.h, n: a.n, mean: a.hrs ? a.cost / a.hrs : null, cost: a.n ? a.cost : null, share: ok && a.n ? (100 * a.cost) / total : null }));
  const held = hours.filter(x => finite(x.share));
  const dearest = held.length ? held.reduce((b, x) => (x.share > b.share ? x : b)) : null;
  return { total: rows.length ? total : null, hours, dearest, block: hs => (ok ? hs.reduce((t, h) => t + (hours[h]?.share ?? 0), 0) : null) };
}

/** Studio 5.18 method from 24 hour-of-day means: mean_h ÷ Σ means × 100. Any missing hour → every share not held. */
export function billShareFromMeans(means) {
  if (means.length !== 24 || !means.every(finite)) return means.map(() => null);
  const s = means.reduce((t, v) => t + v, 0);
  return s > 0 ? means.map(v => (100 * v) / s) : means.map(() => null);
}

/** Hours strictly above $X: count, their cost per MW, their share of the bill and their excess over the period mean. */
export function scarcity(rows, X) {
  const held = rows.filter(r => finite(r.price));
  const hours = held.reduce((t, r) => t + dt(r), 0), total = held.reduce((t, r) => t + r.price * dt(r), 0);
  if (!hours) return { hours: 0, above: 0, total: null, costAbove: null, share: null, mean: null, excess: null };
  const m = total / hours, hi = held.filter(r => r.price > X);
  const costAbove = hi.reduce((t, r) => t + r.price * dt(r), 0);
  return { hours, above: hi.reduce((t, r) => t + dt(r), 0), total, costAbove, share: total > 0 ? (100 * costAbove) / total : null, mean: m, excess: hi.reduce((t, r) => t + (r.price - m) * dt(r), 0), max: hi.length ? Math.max(...hi.map(r => r.price)) : null };
}

/** Studio 5.21 proxy per MW-year: hours above $200 × (P95 − mean). */
export const scarcityProxy = (h200, p95, avg) => (finite(h200) && finite(p95) && finite(avg) ? h200 * (p95 - avg) : null);

/** Hours strictly below $X and their share of the hours held. */
export function cheapHours(rows, X = 20) {
  const held = rows.filter(r => finite(r.price)), n = held.reduce((t, r) => t + dt(r), 0);
  const hours = held.filter(r => r.price < X).reduce((t, r) => t + dt(r), 0);
  return { n, hours, share: n ? (100 * hours) / n : null };
}

/** Real-time energy cost to a flat load: Σ price·h per MW, × MW when a size is given. Energy only. */
export function flatLoadCost(rows, mw) {
  const held = rows.filter(r => finite(r.price)), hours = held.reduce((t, r) => t + dt(r), 0), perMW = held.reduce((t, r) => t + r.price * dt(r), 0);
  return { hours, perMW: hours ? perMW : null, mean: hours ? perMW / hours : null, cost: hours && finite(mw) && mw > 0 ? perMW * mw : null };
}

/** Rows grouped by calendar date (priced rows only). */
function byDay(rows) {
  const m = new Map();
  for (const r of rows) { if (!finite(r.price)) continue; const d = dateOf(r.timestamp); if (!m.has(d)) m.set(d, []); m.get(d).push(r); }
  return m;
}
/** One day's cheapest and dearest N rows (ascending by price; ties: earlier stamp is the cheaper). */
function dayBlocks(rs, N) {
  const s = [...rs].sort((a, b) => a.price - b.price || String(a.timestamp).localeCompare(String(b.timestamp)));
  return { bot: s.slice(0, N), top: s.slice(-N) };
}
const topHoursBy = (counts, k) => counts.map((c, h) => ({ c, h })).sort((a, b) => b.c - a.c || a.h - b.h).slice(0, k).map(x => x.h).sort((a, b) => a - b);

/** Studio 5.16: on how many days each clock hour sits in the N dearest (discharge) and N cheapest (charge) hours. Days with < 2N rows are left out. */
export function blockHours(rows, N = 4) {
  const top = Array(24).fill(0), bot = Array(24).fill(0), sum = Array(24).fill(0), cnt = Array(24).fill(0);
  let days = 0;
  for (const rs of byDay(rows).values()) {
    if (rs.length < 2 * N) continue;
    days++;
    const b = dayBlocks(rs, N);
    for (const r of b.top) top[hourOf(r.timestamp)]++;
    for (const r of b.bot) bot[hourOf(r.timestamp)]++;
  }
  for (const r of rows) { if (!finite(r.price)) continue; const h = hourOf(r.timestamp); sum[h] += r.price; cnt[h]++; }
  const hours = top.map((t, h) => ({ h, top: t, bot: bot[h], topPct: days ? (100 * t) / days : null, botPct: days ? (100 * bot[h]) / days : null, mean: cnt[h] ? sum[h] / cnt[h] : null }));
  return { N, days, hours, discharge: days ? topHoursBy(top, N) : [], charge: days ? topHoursBy(bot, N) : [] };
}

/** Cheapest and dearest N hours by month: day-mean of the N cheapest and N dearest, their spread, and the usual block hours. */
export function blockByMonth(rows, N = 4) {
  const acc = Array.from({ length: 12 }, () => ({ days: 0, cheap: 0, dear: 0, top: Array(24).fill(0), bot: Array(24).fill(0) }));
  for (const rs of byDay(rows).values()) {
    if (rs.length < 2 * N) continue;
    const a = acc[monthOf(rs[0].timestamp) - 1]; if (!a) continue;
    const b = dayBlocks(rs, N);
    a.days++; a.cheap += mean(b.bot.map(r => r.price)); a.dear += mean(b.top.map(r => r.price));
    for (const r of b.top) a.top[hourOf(r.timestamp)]++;
    for (const r of b.bot) a.bot[hourOf(r.timestamp)]++;
  }
  return acc.map((a, i) => {
    const cheap = a.days ? a.cheap / a.days : null, dear = a.days ? a.dear / a.days : null;
    return { m: i + 1, days: a.days, cheap, dear, spread: a.days ? dear - cheap : null, chargeHours: a.days ? topHoursBy(a.bot, N) : [], dischargeHours: a.days ? topHoursBy(a.top, N) : [] };
  });
}

/** Studio 5.17: each day's max − min price, days with fewer than minHours priced rows excluded (not filled), widest first. */
export function spreadCurve(rows, minHours = 20) {
  const out = [];
  for (const [day, rs] of byDay(rows)) {
    if (rs.length < minHours) continue;
    const p = rs.map(r => r.price), max = Math.max(...p), min = Math.min(...p);
    out.push({ day, spread: max - min, max, min });
  }
  return out.sort((a, b) => b.spread - a.spread || a.day.localeCompare(b.day));
}
/** % of values at or above T. */
export const shareAtOrAbove = (values, T) => (values.length ? (100 * values.filter(v => v >= T).length) / values.length : null);

/** Quantiles of a generation window's hours (quantile_cont, like the rollups): P5, P25, mean, min, hours < $0. */
export function windowStats(rows, pred) {
  const p = rows.filter(r => finite(r.price) && pred(hourOf(r.timestamp))).map(r => r.price);
  if (!p.length) return null;
  return { n: p.length, mean: mean(p), p5: quantile(p, 0.05), p25: quantile(p, 0.25), p50: quantile(p, 0.5), min: Math.min(...p), neg: p.filter(v => v < 0).length };
}

/** Month × clock-hour mean of a fleet profile {'YYYY-MM-DDTHH': MW} → Map('m|h' → MW). A typical shape for model calendars. */
export function typicalShape(profile) {
  const acc = new Map();
  for (const [k, v] of Object.entries(profile || {})) {
    if (!finite(v)) continue;
    const key = `${Number(k.slice(5, 7))}|${Number(k.slice(11, 13))}`, a = acc.get(key) || [0, 0];
    a[0] += v; a[1]++; acc.set(key, a);
  }
  return new Map([...acc].map(([k, [s, n]]) => [k, s / n]));
}

/**
 * Capture with a fleet generation shape: Σ MW·price·h ÷ Σ MW·h over the hours the shape is held.
 * shape = {'YYYY-MM-DDTHH': MW} matched on the stamp's clock hour; typical (optional Map 'm|h' → MW) fills model calendars.
 * avg = time-weighted mean over the SAME matched hours, so ratio compares like with like.
 */
export function fleetCapture(rows, shape, typical = null) {
  if (!shape) return { capture: null, avg: null, ratio: null, matched: 0, typical: 0, missing: rows.length, weight: null };
  let num = 0, den = 0, sum = 0, h = 0, matched = 0, typ = 0, missing = 0;
  for (const r of rows) {
    if (!finite(r.price)) continue;
    const k = String(r.timestamp).slice(0, 13);
    let w = shape[k];
    if (!finite(w) && typical) { w = typical.get(`${monthOf(r.timestamp)}|${hourOf(r.timestamp)}`); if (finite(w)) typ++; } else if (finite(w)) matched++;
    if (!finite(w)) { missing++; continue; }
    num += w * r.price * dt(r); den += w * dt(r); sum += r.price * dt(r); h += dt(r);
  }
  const capture = den ? num / den : null, avg = h ? sum / h : null;
  return { capture, avg, ratio: finite(capture) && avg ? capture / avg : null, matched, typical: typ, missing, weight: den || null, hours: h };
}

// ---------- v5: per-series compositions the fuel cards read (tests/prices-fuel-v5.test.mjs) ----------
const seriesBase = h => ({ key: h.key, kind: h.kind, label: h.label, market: h.market, year: h.year, run: h.run });

/** Tab labels by fuel (the shell's tabLabel reads view.tabs[i].labelFor). null = keep the tab's own label. */
export const PRICE_TAB_LABELS = {
  shape: { solar: 'Shape & capture', wind: 'Shape & wind capture', storage: 'Shape & cycling', hybrid: 'Shape, capture & cycling', datacenter: 'Load cost & bill shape' },
  tails: { datacenter: 'Tails & scarcity' },
};
export const priceTabLabel = (tab, tech) => PRICE_TAB_LABELS[tab]?.[fuelOf(tech)] ?? null;

/**
 * Per held series (settled year or solved run): cost to a flat load (Studio 5.31), hours under $20, hours above $X with
 * their share of the bill and their excess over the series mean (5.21 exact), and the 5.21 proxy from the series stats.
 * Per-year figures annualise by the series mean (× 8,760 h), so a part year is compared by mean, never by sum.
 */
export function loadYears(H, X = 200, mw = null) {
  return (H || []).filter(h => h.rows?.length).map(h => {
    const f = flatLoadCost(h.rows, null), c = cheapHours(h.rows, 20), s = scarcity(h.rows, X), st = h.stats || {};
    const perYr = finite(f.mean) ? f.mean * 8760 : null;
    return {
      ...seriesBase(h), hours: f.hours, mean: f.mean, perMW: f.perMW, perMWyr: perYr, cost: finite(perYr) && finite(mw) && mw > 0 ? perYr * mw : null,
      cheapHours: c.hours, cheapShare: c.share, X, above: s.above, aboveShare: s.share, costAbove: s.costAbove, excess: s.excess,
      excessYr: finite(s.excess) && s.hours ? (s.excess * 8760) / s.hours : null, max: s.max ?? null, proxy: scarcityProxy(st.gt200, st.p95, st.mean),
    };
  });
}

/** Per held series: the overnight wind-window floor (Studio 5.20) and the fleet-shape capture (typical shape on model calendars). */
export function windYears(H, shape, typical = null) {
  return (H || []).filter(h => h.rows?.length).map(h => {
    const c = fleetCapture(h.rows, shape, typical);
    return { ...seriesBase(h), floor: windowStats(h.rows, isWindHour), capture: c.capture, avg: c.avg, ratio: c.ratio, matched: c.matched, typical: c.typical, missing: c.missing, hours: c.hours ?? null };
  });
}

/** Per held series: the usual discharge and charge blocks (Studio 5.16) and the mean share of days each block hour is in it. */
export function blockYears(H, N = 4) {
  return (H || []).filter(h => h.rows?.length).map(h => {
    const b = blockHours(h.rows, N), pct = (hs, k) => (b.days && hs.length ? hs.reduce((t, x) => t + b.hours[x][k], 0) / hs.length : null);
    return { ...seriesBase(h), N, days: b.days, discharge: b.discharge, charge: b.charge, dischargePct: pct(b.discharge, 'topPct'), chargePct: pct(b.charge, 'botPct') };
  });
}

/**
 * data-chips for a card: 'geo-proxy' when the settled series is borrowed (prices.isBorrowedPrice: a geo-proxy not at the
 * bus's own substation, or a D-008 relinked node; P2 C19 replaced the old ≥ 0.05 km rule), plus known tags.
 * link = prices.priceLinkFields(node, link) or {tier, km}.
 */
const CHIPS = ['studio-copy', 'modelled', 'assumption', 'geo-proxy', 'not-held', 'envelope-only'];
export function provenanceChips(link, tags = []) {
  const out = [...new Set(tags.filter(t => CHIPS.includes(t)))];
  if (link && isBorrowedPrice(link) && !out.includes('geo-proxy')) out.push('geo-proxy');
  return out.join(' ');
}
