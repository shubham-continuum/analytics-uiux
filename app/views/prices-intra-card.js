// Prices › Tails & spreads: "Within the hour" (V6). Five-minute real-time prices for the bus's LOAD ZONE (zone-level,
// 2026 H1 only) from api_pricesintra.py, analysed by views/prices-intra.js (pure, tested). Three cards and one trace.
import { xd } from './prices-data.js';
import { intraHours, intraSummary, heldMonths } from './prices-intra.js';
import { trace } from '../trace.js';
import * as C from '../charts.js';
import { fmt } from '../basis.js';
import { card, tbl, tr, td, tn, sel, pending, n2, esc, B } from './prices-ui.js';
import { durationGrid } from './prices-calc.js';
import { quantile } from '../prices.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const usd0 = v => `$${Math.round(v)}`;
const usd2 = v => (ok(v) ? `$${v.toFixed(2)}` : 'not held');
const THR = [50, 100, 200, 300, 500, 1000];
const memo = new Map();

/** {cards:[3 card strings], trace:string, summary|null}. */
export function intraCards(ctx, { dur = 4 } = {}) {
  const { S } = ctx, id = String(S.nodeId);
  const e = xd('pricesintra', 'zone5', id), z = e.data;
  const thr = THR.includes(Number(S.ui.p5thr)) ? Number(S.ui.p5thr) : 200;
  const label = z ? `${z.zone === 'Hub' ? 'ISO-NE hub' : `${esc(z.zone)} load zone`}` : 'load zone';
  const scope = 'zone-level, 2026 H1 only';
  const chips = ''; // zone-level scope is in each title (no provenance chip fits)
  if (!z) {
    const body = e.status === 'none' ? '<div class="empty"><strong>Not held</strong>No load zone can be named for this bus, so no five-minute series applies.</div>' : pending(e, 'the five-minute zone prices');
    return { cards: [card('c-12', 'Within the hour (zone-level, 2026 H1 only)', scope, body, { depth: 'review', chips, answer: e.status === 'none' ? 'Five-minute prices are not held for this bus: no load zone can be named for it.' : e.status === 'loading' ? 'Reading the five-minute zone prices.' : 'The five-minute zone prices could not be loaded.' })], trace: '', summary: null };
  }
  const key = `${id}|${z.zone}|${thr}|${dur}|${z.hours.length}`;
  if (!memo.has(key)) { if (memo.size > 8) memo.clear(); const H = intraHours(z.hours); memo.set(key, { H, s: intraSummary(H, { thr, dur }), m: heldMonths(H) }); }
  const { H, s, m } = memo.get(key);
  const span = `${m.held.join(', ')} 2026 held${m.missing.length ? ` · ${m.missing.join(', ')} not held` : ''}`;
  const foot = `${esc(z.pnode)} · ${esc(z.source)} · zone from ${esc(z.zoneFrom)} · ${esc(span)} · interval start, Eastern clock`;

  // Card 1: 5-minute vs hourly + battery uplift.
  // The two full curves overlap almost everywhere; the battery's extra value lives in the dearest tail, so draw the top 10%.
  const all = H.flatMap(h => h.prices), hm = H.map(h => h.mean), cap = all.length ? quantile(all, 0.999) : null;
  const top10 = v => durationGrid(v, 0.05).filter(p => p.x <= 10 + 1e-9);
  const curve = C.lineChart([
    { name: '5-minute intervals', points: top10(all) },
    { name: 'Hourly averages', dashed: true, points: top10(hm) },
  ], { fmt: usd0, xfmt: v => `${v.toFixed(0)}%`, xTicks: [0, 2, 4, 6, 8, 10], title: 'Dearest 10% of prices: 5-minute against hourly', height: 200, yMax: cap });
  const stats = tbl(['Measure', ['5-minute'], ['Hourly average']], [
    tr([td('Prices held'), tn(fmt.int(s.intervals)), tn(fmt.int(s.hours))]),
    tr([td('Standard deviation $/MWh'), tn(n2(s.sd5)), tn(n2(s.sdH))]),
    tr([td('Highest $/MWh'), tn(n2(s.max5)), tn(n2(s.maxH))]),
    tr([td(`Above $${thr}`), tn(`${fmt.int(s.above5)} intervals`), tn(`${fmt.int(s.aboveH)} hours`)]),
    tr([td(`TB${dur}: ${dur} dearest − ${dur} cheapest hours, daily mean`), tn(usd2(s.tb5)), tn(usd2(s.tbH))]),
  ]);
  const a1 = ok(s.uplift)
    ? `A 5-minute-responsive ${dur}-hour battery in the ${label} would have seen ${B(`${s.uplift >= 0 ? '+' : '−'}$${Math.abs(s.uplift).toFixed(2)}/MWh`)} (${B(`${s.upliftPct >= 0 ? '+' : ''}${s.upliftPct.toFixed(1)}%`)}) above the hourly TB${dur} of ${B(usd2(s.tbH))}, over ${B(fmt.int(s.days))} full days of 2026 H1 (zone-level, not this node).`
    : `No full day of five-minute prices is held for the ${label}, so the battery uplift is not held.`;
  const c1 = card('c-6', 'Within the hour: 5-min vs hourly (zone, 2026 H1)', `${label} · ${scope} · ${span}`, `${curve}${stats}`,
    { depth: 'review', trace: 'p-intra', chips, answer: a1, foot: `${foot} · dearest 10% of each series drawn, axis capped at p99.9 (${usd2(cap)}) · the uplift is a gross perfect-foresight spread (no efficiency, no SOC limit), the same basis as the hourly TB, not revenue` });

  // Card 2: intra-hour range distribution.
  const rs = H.map(h => h.range), rcap = rs.length ? quantile(rs, 0.99) : null, inside = rs.filter(v => v <= rcap);
  const hist = typeof C.histogram === 'function' ? C.histogram(inside, { bins: 24, fmt: v => fmt.int(v), xfmt: usd0, title: 'Intra-hour price range', height: 180 }) : C.barChart([], { emptyText: 'Histogram chart not available.' });
  const rtab = tbl(['Percentile', ['p50'], ['p90'], ['p99'], ['Max']], [tr([td('Max − min within the hour'), tn(usd2(s.range.p50)), tn(usd2(s.range.p90)), tn(usd2(s.range.p99)), tn(usd2(s.range.max))])]);
  const a2 = ok(s.range.p50) ? `Inside a typical hour the ${label} price moves ${B(usd2(s.range.p50))} between its cheapest and dearest 5 minutes; one hour in ten moves more than ${B(usd2(s.range.p90))}.` : 'No hour of five-minute prices is held.';
  const c2 = card('c-6', 'Intra-hour price range (zone-level, 2026 H1)', `Max − min of each hour's 5-minute prices · ${scope}`, `${hist}${rtab}`,
    { depth: 'review', trace: 'p-intra', chips, answer: a2, foot: `${fmt.int(rs.length - inside.length)} hours above p99 (${usd2(rcap)}) are left out of the bins, not the table · ${esc(z.pnode)}` });

  // Card 3: intervals above $X by month.
  const bars = C.barChart(s.byMonth.map(r => ({ label: r.label, value: r.above5, note: r.above5 == null ? 'not held' : `${fmt.int(r.intervals)} intervals held` })), { fmt: v => fmt.int(v), title: `5-minute intervals above $${thr} by month`, height: 180, emptyText: 'No month held.' });
  const a3 = `${B(fmt.int(s.above5))} five-minute intervals cleared above $${thr}, spread over ${B(fmt.int(s.hoursWithSpike))} hours; only ${B(fmt.int(s.aboveH))} hourly averages did.`;
  const c3 = card('c-6', `5-minute intervals above $${thr} (zone-level, 2026 H1)`, `${scope} · by month (April and May not held)`, bars,
    { depth: 'review', trace: 'p-intra', chips, answer: a3, tools: sel('p5thr', thr, THR.map(v => [v, `> $${v}`]), 'Five-minute price threshold'), foot: 'A month with no five-minute data is shown as not held, never zero.' });

  // Trace: independent check against the published hourly series.
  const pubDev = H.filter(h => h.complete && ok(h.pub)).map(h => Math.abs(h.mean - h.pub));
  const t = trace({
    id: 'p-intra', title: `Within the hour (${z.zone}, 2026 H1)`,
    formula: `uplift = mean_d [ (mean of the ${12 * dur} dearest 5-min prices − mean of the ${12 * dur} cheapest) − (mean of the ${dur} dearest hourly averages − mean of the ${dur} cheapest) ]`,
    inputs: [
      { name: 'Five-minute prices', value: fmt.int(s.intervals), unit: 'intervals', source: 'measured', note: `${z.pnode}, fact_lmp_5min, ${span}` },
      { name: 'Clock hours held', value: fmt.int(s.hours), source: 'measured', note: `${fmt.int(H.filter(h => h.complete).length)} with all twelve intervals` },
      { name: 'Battery duration', value: dur, unit: 'h', source: 'user', note: 'the Tails & spreads duration toggle' },
      { name: 'Threshold', value: `$${thr}`, source: 'user' },
      { name: 'Zone', value: z.zone, source: 'rule', note: `from ${z.zoneFrom}` },
    ],
    steps: [
      { label: 'Hourly average = mean of the hour\'s 5-minute prices', work: `${fmt.int(s.intervals)} intervals → ${fmt.int(s.hours)} hours`, value: `sd ${n2(s.sd5)} → ${n2(s.sdH)}` },
      { label: 'Full days: ≥ 23 hours, each with 12 intervals', work: `${fmt.int(s.days)} days`, value: fmt.int(s.days) },
      { label: `Hourly TB${dur}, mean over full days`, work: `mean of daily (top ${dur} − bottom ${dur}) hourly averages`, value: usd2(s.tbH) },
      { label: `5-minute TB${dur}, mean over full days`, work: `mean of daily (top ${12 * dur} − bottom ${12 * dur}) intervals`, value: usd2(s.tb5) },
      { label: 'Uplift', work: `${usd2(s.tb5)} − ${usd2(s.tbH)}`, value: usd2(s.uplift) },
      { label: 'Intra-hour range p50 / p90', work: 'max − min of each hour, percentiles over hours', value: `${usd2(s.range.p50)} / ${usd2(s.range.p90)}` },
      { label: `Above $${thr}`, work: 'count of intervals; count of hourly averages', value: `${fmt.int(s.above5)} / ${fmt.int(s.aboveH)}` },
    ],
    result: { label: `5-minute uplift over hourly TB${dur}`, value: usd2(s.uplift) },
    checks: [
      { label: `Independent: hourly TB${dur} from the PUBLISHED hourly RT series (fact_lmp_hourly) vs from the 5-minute averages, same ${fmt.int(s.pubDays)} days`, a: s.tbPub, b: s.tbPubCalc, atol: 0.05, fmt: usd2 },
      { label: `Independent: largest |hourly average − published hourly| over ${fmt.int(pubDev.length)} complete hours (published to the cent)`, a: pubDev.length ? Math.max(...pubDev) : null, b: 0, atol: 0.02, fmt: v => (ok(v) ? v.toFixed(4) : 'not held') },
    ],
    notes: ['Zone-level, not this node: a node with its own congestion can swing more or less inside the hour.', 'April and May 2026 are not held in fact_lmp_5min; every figure covers the months named above only.', 'Both TBs are gross perfect-foresight spreads with no efficiency or SOC limit; Economics dispatches a battery on hourly prices.'],
    csv: { name: `intra-hour-${z.zone}-${id}.csv`, columns: ['date', 'tb_hourly', 'tb_5min', 'uplift', 'tb_published_hourly'], rows: () => s.daily.map(d => [d.date, d.tbH, d.tb5, d.uplift, d.tbPub]) },
  });
  return { cards: [c1, c2, c3], trace: t, summary: s, zone: z.zone };
}
