// Within the hour (pure, tested in tests/prices-intra.test.mjs): five-minute real-time prices for the bus's load zone
// against their hourly averages. Input = api_pricesintra hours: [[ 'YYYY-MM-DD HH', [five-minute LMPs], publishedHourly ]].
// Null is not held, never zero. A "full day" has at least 23 clock hours (the spring-forward day has 23), each with all
// twelve intervals, so the hourly and five-minute spreads are taken over exactly the same intervals.
const ok = v => typeof v === 'number' && Number.isFinite(v);
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mean = a => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);
const std = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((t, v) => t + (v - m) ** 2, 0) / a.length) : null; };
const q = (sorted, p) => { if (!sorted.length) return null; const i = p * (sorted.length - 1), lo = Math.floor(i), hi = Math.ceil(i); return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo); };

/** Hour rows: {key, date, hour, month, prices, n, mean, min, max, range, complete, pub}. */
export function intraHours(raw) {
  const out = [];
  for (const [key, ps, pub] of raw || []) {
    const prices = (ps || []).filter(ok);
    if (!prices.length) continue;
    const mn = Math.min(...prices), mx = Math.max(...prices);
    out.push({ key, date: key.slice(0, 10), hour: Number(key.slice(11, 13)), month: Number(key.slice(5, 7)), prices, n: prices.length,
      mean: mean(prices), min: mn, max: mx, range: mx - mn, complete: prices.length === 12, pub: ok(pub) ? pub : null });
  }
  return out;
}

/** One day's TB: k dearest − k cheapest hourly means, and the same over 12k five-minute intervals. Null unless a full day. */
export function dayTb(hours, k) {
  if (hours.length < 23 || hours.some(h => !h.complete) || hours.length < k) return null;
  const hm = hours.map(h => h.mean).sort((a, b) => b - a);
  const p5 = hours.flatMap(h => h.prices).sort((a, b) => b - a), m = 12 * k;
  const tbH = mean(hm.slice(0, k)) - mean(hm.slice(-k)), tb5 = mean(p5.slice(0, m)) - mean(p5.slice(-m));
  const pub = hours.every(h => ok(h.pub)) ? hours.map(h => h.pub).sort((a, b) => b - a) : null;
  return { date: hours[0].date, tbH, tb5, uplift: tb5 - tbH, tbPub: pub ? mean(pub.slice(0, k)) - mean(pub.slice(-k)) : null };
}

/** Months held inside the span Jan → the last month held, and the months missing in it. */
export function heldMonths(H) {
  const ms = [...new Set(H.map(h => h.month))].sort((a, b) => a - b);
  if (!ms.length) return { held: [], missing: [] };
  const last = ms.at(-1), held = ms.map(m => MON[m - 1]), missing = [];
  for (let m = 1; m <= last; m++) if (!ms.includes(m)) missing.push(MON[m - 1]);
  return { held, missing };
}

/**
 * Summary over every hour held: {hours, intervals, sd5, sdH, meanAbsDev, range{p50,p90,p99,max}, above5, aboveH,
 * hoursWithSpike, byMonth[1..last month]{m, label, above5|null, intervals|null}, days, tbH, tb5, tbPub, uplift, upliftPct, daily[]}.
 */
export function intraSummary(raw, { thr = 200, dur = 4 } = {}) {
  const H = Array.isArray(raw) && raw.length && Array.isArray(raw[0]) ? intraHours(raw) : (raw || []);
  const all = H.flatMap(h => h.prices), hm = H.map(h => h.mean);
  const ranges = H.map(h => h.range).sort((a, b) => a - b);
  const dev = H.reduce((t, h) => t + h.prices.reduce((s, p) => s + Math.abs(p - h.mean), 0), 0);
  const byDate = new Map(); for (const h of H) { if (!byDate.has(h.date)) byDate.set(h.date, []); byDate.get(h.date).push(h); }
  const daily = [...byDate.values()].map(d => dayTb(d, dur)).filter(Boolean);
  const tbH = daily.length ? mean(daily.map(d => d.tbH)) : null, tb5 = daily.length ? mean(daily.map(d => d.tb5)) : null;
  const pubDays = daily.filter(d => ok(d.tbPub));
  const lastM = H.length ? Math.max(...H.map(h => h.month)) : 0;
  const byMonth = Array.from({ length: lastM }, (_, i) => {
    const hs = H.filter(h => h.month === i + 1);
    return { m: i + 1, label: MON[i], above5: hs.length ? hs.reduce((t, h) => t + h.prices.filter(p => p > thr).length, 0) : null, intervals: hs.length ? hs.reduce((t, h) => t + h.n, 0) : null };
  });
  return {
    hours: H.length, intervals: all.length, thr, dur,
    sd5: all.length > 1 ? std(all) : null, sdH: hm.length > 1 ? std(hm) : null,
    max5: all.length ? Math.max(...all) : null, maxH: hm.length ? Math.max(...hm) : null,
    meanAbsDev: all.length ? dev / all.length : null,
    range: { p50: q(ranges, 0.5), p90: q(ranges, 0.9), p99: q(ranges, 0.99), max: ranges.length ? ranges.at(-1) : null },
    above5: all.filter(p => p > thr).length, aboveH: hm.filter(p => p > thr).length, hoursWithSpike: H.filter(h => h.max > thr).length,
    byMonth, days: daily.length, tbH, tb5, uplift: ok(tb5) && ok(tbH) ? tb5 - tbH : null,
    upliftPct: ok(tb5) && ok(tbH) && tbH ? (100 * (tb5 - tbH)) / tbH : null,
    tbPub: pubDays.length ? mean(pubDays.map(d => d.tbPub)) : null, tbPubCalc: pubDays.length ? mean(pubDays.map(d => d.tbH)) : null, pubDays: pubDays.length,
    daily,
  };
}
