// Fuel-specific Prices cards (v5), wired from views/prices-fuel.js (pure, tested) into the Shape & capture and
// Tails & spreads tabs. Each builder returns { kpis:[6 kpi strings], cards:[card strings], traces:[trace strings] };
// views/prices.js composes them with the cards every fuel shares. Null prints "not held", never 0.
//  - Data centre / load: bill share by hour (Studio 5.18), cost to a flat load and hours under $20 (5.31),
//    scarcity-hour cost with the 5.21 proxy beside the exact excess.
//  - Storage (and the battery side of a hybrid): charge/discharge blocks by hour and by month (5.16), the daily
//    spread duration curve (5.17), and the blocks for every held year and run.
//  - Wind: the overnight floor P5/P25 (5.20) and capture with the ISO-NE fleet wind shape (fleetProfile).
import { finite } from '../prices.js';
import { fmt, describe } from '../basis.js';
import * as C from '../charts.js';
import { billShare, billShareFromMeans, scarcity, cheapHours, flatLoadCost, blockHours, blockByMonth, spreadCurve, shareAtOrAbove, windowStats, fleetCapture, typicalShape, isWindHour, loadYears, windYears, blockYears } from './prices-fuel.js';
import { fleetProfile } from './prices-data.js';
import { kpi, card, tbl, tr, td, tn, seg, sel, notApplicable, pending, n2, r3, MONTHS, RUN, RUN_ORDER, heRange, esc, B } from './prices-ui.js';
import { traceBill, traceLoad, traceScarce, traceBlocks, traceSpreadCurve, traceFloor, traceWindCap } from './prices-fuel-trace.js';

const { lineChart, barChart, groupedBar } = C;
const usd0 = v => `$${Math.round(v)}`;
const pct1 = v => `${v.toFixed(1)}%`;
const sgn = v => (finite(v) ? `${v > 0 ? '+' : ''}${fmt.price(v)}` : 'not held');
const serName = r => (r.kind === 'solved' ? RUN[r.run] || r.run : `${r.year} ${r.market}`);
const serCell = r => (r.kind === 'solved' ? esc(RUN[r.run] || r.run) : `Settled ${esc(r.market)}${r.hours < 0.95 * (r.year % 4 === 0 ? 8784 : 8760) ? ' <span class="pill warn">part</span>' : ''}`);
const lastSettled = rows => [...rows].reverse().find(r => r.kind === 'settled' && r.market === 'RT' && r.hours >= 0.95 * (r.year % 4 === 0 ? 8784 : 8760)) || [...rows].reverse().find(r => r.kind === 'settled' && r.market === 'RT') || null;
const loading = 'loading…';

const memo = new Map();
function cached(key, fn) { if (!memo.has(key)) { if (memo.size > 24) memo.clear(); memo.set(key, fn()); } return memo.get(key); }
const hKey = (id, H) => `${id}|${H.map(h => `${h.key}:${h.rows.length}`).join(',')}`;

// ---------- Data centre / load ----------
export function dcShape(env) {
  const { S, node, id, res, sum, sumE, H, chips, foot, rtFull } = env, s = res.summary, rows = res.rows || [];
  const mw = Number(S.importMW) > 0 ? Number(S.importMW) : null;
  const X = [100, 200, 500, 1000].includes(Number(S.ui.pScarX)) ? Number(S.ui.pScarX) : 200;
  const bill = s ? billShare(rows) : null, flat = s ? flatLoadCost(rows, mw) : null, cheap = s ? cheapHours(rows, 20) : null, sc = s ? scarcity(rows, X) : null;
  const eve = bill ? bill.block([16, 17, 18, 19, 20]) : null;
  const L = cached(`load|${hKey(id, H)}|${X}|${mw}`, () => loadYears(H, X, mw));
  const Ls = lastSettled(L);
  const perYr = flat && finite(flat.mean) ? flat.mean * 8760 : null;
  const kpis = [
    kpi(mw ? `Energy cost at ${fmt.int(mw)} MW flat` : 'Energy cost per MW flat', s ? fmt.money(mw ? perYr * mw : perYr) : 'not held', '/yr', s ? `Applied basis · mean ${fmt.price(flat.mean)} × 8,760 h${mw ? '' : ' · enter Import MW for the site figure'} · energy only` : 'No result on the applied basis'),
    kpi(bill?.dearest ? `Dearest hour's bill share (HE${bill.dearest.h + 1})` : 'Dearest hour\'s bill share', bill?.dearest ? fmt.pct(bill.dearest.share) : 'not held', '', bill?.dearest ? `Flat price = 4.2% · HE17–21 ${fmt.pct(eve)} of the bill` : 'No positive bill on the applied basis'),
    kpi('Hours under $20', cheap ? fmt.pct(cheap.share) : 'not held', 'of hours', cheap ? `${fmt.int(cheap.hours)} of ${fmt.int(cheap.n)} h on the applied basis` : ''),
    kpi(`Hours above $${X}: share of the bill`, sc && finite(sc.share) ? fmt.pct(sc.share) : 'not held', '', sc ? `${fmt.int(sc.above)} h · ${fmt.money(finite(sc.excess) && sc.hours ? (sc.excess * 8760) / sc.hours : null)}/MW-yr above the mean` : ''),
    kpi(`Scarcity proxy 5.21${Ls ? ` (${Ls.year} RT)` : ''}`, sumE.status === 'loading' ? loading : Ls && finite(Ls.proxy) ? fmt.money(Ls.proxy) : 'not held', '/MW-yr', Ls ? `hours > $200 × (P95 − mean) · exact excess ${fmt.money(X === 200 ? Ls.excessYr : null)}` : 'No settled RT year held'),
    kpi(`Mean RT price 5.31${Ls ? ` (${Ls.year})` : ''}`, Ls ? fmt.price(Ls.mean) : 'not held', '/MWh', Ls ? `${fmt.int(Ls.hours)} h · ${fmt.int(Ls.cheapHours)} under $20 (${fmt.pct(Ls.cheapShare)})` : 'No settled real-time series at this bus'),
  ];
  // 5.18 chart: applied basis shares + each solved run's shares from its hour-of-day means (mart) + the flat line.
  const runShares = RUN_ORDER.filter(r => (sum?.fcstHour || []).filter(x => x.scenario === r).length === 24).map(r => { const m = Array.from({ length: 24 }, (_, h) => sum.fcstHour.find(x => x.scenario === r && x.h === h)?.avg_lmp ?? null); return { run: r, shares: billShareFromMeans(m) }; });
  // Six series at most (dataviz rule): the applied basis and up to five runs; the flat-price share (4.17%) is stated in the answer.
  const billSeries = [{ name: 'Applied basis', points: bill ? bill.hours.map(h => ({ x: h.h + 1, y: h.share })) : [] }, ...runShares.map(r => ({ name: RUN[r.run], dashed: true, points: r.shares.map((v, h) => ({ x: h + 1, y: v })) }))];
  const aBill = bill?.dearest ? `${B(`HE${bill.dearest.h + 1}`)} carries ${B(fmt.pct(bill.dearest.share))} of a flat load's energy bill (a flat price would give every hour 4.17%); HE17–21 together carry ${B(fmt.pct(eve))}.` : 'No positive bill on the applied basis.';
  const aLoad = Ls ? `In ${Ls.year} settled real time a flat load paid ${B(fmt.price(Ls.mean))}/MWh on average, ${B(fmt.money(Ls.perMWyr))} per MW-year, with ${B(fmt.pct(Ls.cheapShare))} of hours under $20.` : L.length ? 'No settled real-time year is held; solved runs are listed.' : '';
  const aSc = Ls ? `In ${Ls.year} the ${B(fmt.int(Ls.above))} hours above $${X} made up ${B(fmt.pct(Ls.aboveShare))} of the bill, ${B(fmt.money(Ls.excessYr))} per MW-year above the mean.` : L.length ? 'No settled real-time year is held; solved runs are listed.' : '';
  const billTable = bill ? tbl(['HE', ['Basis share'], ['Basis $/MWh'], ...runShares.map(r => [`${RUN[r.run]} share`])], bill.hours.map(h => tr([td(h.h + 1), tn(finite(h.share) ? `${h.share.toFixed(2)}%` : 'not held'), tn(n2(h.mean)), ...runShares.map(r => tn(finite(r.shares[h.h]) ? `${r.shares[h.h].toFixed(2)}%` : 'not held'))], bill.dearest && h.h === bill.dearest.h ? 'hl' : '')), { max: 220 }) : '';
  const billCard = card(S.depth === 'screen' ? 'c-12' : 'c-8', 'Share of a flat load\'s energy bill by hour', `${describe(S.basis)} · each clock hour's share of the bill; solved runs from their hour-of-day means`, s ? `${lineChart(billSeries, { fmt: pct1, xfmt: v => `HE${v}`, xTicks: [1, 6, 12, 17, 21, 24], title: 'Share of the annual bill by hour', height: 220 })}${billTable}` : env.noBasis('bill share'), { answer: aBill, depth: 'screen', trace: 'p-bill', chips: chips(['modelled']), foot: `A constant load weights every hour equally; the gap above 4.17% in the evening is what flexibility would be worth. Energy only. ${foot('solved: mart_bus_fcst_hour')}` });
  // 5.31 table: every held series.
  const loadTable = L.length ? tbl(['Year', 'Series', ['Hours'], ['Mean'], ['< $20 h'], ['< $20 %'], ['$/MW-yr'], [mw ? `At ${fmt.int(mw)} MW` : 'At size']], L.map(r => tr([td(r.year), td(serCell(r)), tn(fmt.int(r.hours)), tn(n2(r.mean)), tn(fmt.int(r.cheapHours)), tn(fmt.pct(r.cheapShare)), tn(fmt.money(r.perMWyr)), tn(mw ? fmt.money(r.cost) : 'enter MW')], r === Ls ? 'hl' : '')), { max: 260 }) : '<div class="empty"><strong>No hourly prices held</strong>No settled year or solved run at this bus.</div>';
  const loadChart = L.length ? barChart(L.map(r => ({ label: r.kind === 'solved' ? `${r.year} ${r.run}` : String(r.year) + (r.market === 'DA' ? ' DA' : ''), value: r.cheapShare, note: `${fmt.int(r.cheapHours)} h under $20 · mean ${fmt.price(r.mean)}` })), { fmt: pct1, title: 'Hours under $20 by year', height: 150 }) : '';
  const loadCard = card('c-4', 'Cost to a flat load, every year and run', 'Studio 5.31 · mean price, cheap hours and the energy bill', `${loadChart}${loadTable}`, { answer: aLoad, depth: 'review', trace: 'p-load', chips: chips([]), foot: 'Energy only: no capacity, transmission, ancillary or retail charge. A part year is annualised by its mean.' });
  // 5.21: exact excess vs proxy by series.
  const scChart = L.length ? groupedBar(L.map(r => ({ label: r.kind === 'solved' ? `${r.year} ${r.run}` : `${r.year}${r.market === 'DA' ? ' DA' : ''}`, values: [r.excessYr, r.proxy] })), { series: [`Exact: Σ (price − mean) above $${X}`, 'Studio 5.21 proxy (> $200 × (P95 − mean))'], fmt: v => fmt.money(v), title: 'Scarcity-hour cost per MW-year', height: 200 }) : '';
  const scTable = L.length ? tbl(['Year', 'Series', [`> $${X} h`], ['Share of bill'], ['Excess $/MW-yr'], ['Proxy $/MW-yr'], ['Max']], L.map(r => tr([td(r.year), td(serCell(r)), tn(fmt.int(r.above)), tn(fmt.pct(r.aboveShare)), tn(fmt.money(r.excessYr)), tn(fmt.money(r.proxy)), tn(n2(r.max))])), { max: 220 }) : '';
  const scCard = card('c-6', 'Scarcity-hour cost to a flat load', `Hours above $${X}: their share of the bill and their cost above the mean`, L.length ? `${scChart}${scTable}` : '<div class="empty"><strong>No hourly prices held</strong>No settled year or solved run at this bus.</div>', { answer: aSc, depth: 'review', trace: 'p-scarce', chips: chips(['modelled']), tools: sel('pScarX', X, [100, 200, 500, 1000].map(v => [v, `> $${v}`]), 'Scarcity threshold'), foot: 'Exact = the hours themselves; the proxy (Studio 5.21) understates a fat tail. Neither is a demand or capacity charge.' });
  const na = notApplicable('c-12', 'Generation capture price', 'a data centre (load)', 'A load buys every hour, so its price is the time-weighted mean (the cost cards here), not a generation-weighted capture price. Capacity and transmission charges for the load are in Economics › Load cost, labelled as not held or assumptions.', 'review');
  const traces = [s && bill ? traceBill(node, S, bill, rows) : '', L.length ? traceLoad(node, sum, L, mw) : '', L.length ? traceScarce(node, sum, L, X) : ''];
  return { kpis, cards: [billCard, loadCard, scCard, na], traces, headline: 'bill' };
}

// ---------- Storage (and the battery side of a hybrid) ----------
export function storageCards(env, { withKpis = true, key = 'storage' } = {}) {
  const { S, node, id, res, sum, sumE, H, chips, rtFull } = env, s = res.summary, rows = res.rows || [];
  const N = [2, 4, 8].includes(Number(S.ui.duration)) ? Number(S.ui.duration) : 4;
  const T = [10, 20, 30, 50, 75, 100].includes(Number(S.ui.pCycT)) ? Number(S.ui.pCycT) : 20;
  const b = s ? blockHours(rows, N) : null, bm = s ? blockByMonth(rows, N) : [];
  const curve = s ? spreadCurve(rows, 20) : [], sp = curve.map(d => d.spread), clear = shareAtOrAbove(sp, T);
  const med = curve.length ? curve[Math.floor((curve.length - 1) / 2)].spread : null;
  const tb = (sum?.tb || []).find(r => r.market === 'RT' && r.y === rtFull);
  const pk = (sum?.year || []).find(r => r.market === 'RT' && r.y === rtFull);
  const pct = (hs, k) => (b?.days && hs.length ? hs.reduce((t, h) => t + b.hours[h][k], 0) / hs.length : null);
  const kpis = withKpis ? [
    kpi(`Discharge block (${N} h)`, b?.days ? heRange(b.discharge) : 'not held', '', b?.days ? `In the dearest ${N} on ${fmt.pct(pct(b.discharge, 'topPct'))} of ${fmt.int(b.days)} days · applied basis` : 'No full day on the applied basis'),
    kpi(`Charge block (${N} h)`, b?.days ? heRange(b.charge) : 'not held', '', b?.days ? `In the cheapest ${N} on ${fmt.pct(pct(b.charge, 'botPct'))} of days · shoulder charging only in Grid` : ''),
    kpi('Median daily spread (max − min)', finite(med) ? fmt.price(med) : 'not held', '/MWh', curve.length ? `${fmt.int(curve.length)} days · widest ${fmt.price(curve[0].spread)}` : 'No day with 20 priced hours'),
    kpi(`Days clearing $${T}`, finite(clear) ? fmt.pct(clear) : 'not held', 'of days', finite(clear) ? `${fmt.int(sp.filter(v => v >= T).length)} of ${fmt.int(sp.length)} days · gross, before RTE and degradation` : ''),
    kpi(`TB4${rtFull ? ` (${rtFull} RT)` : ''}`, sumE.status === 'loading' ? loading : tb ? fmt.price(tb.tb4) : 'not held', '/MWh', tb ? `P10 ${fmt.price(tb.tb4_p10)} · P90 ${fmt.price(tb.tb4_p90)} · mart_bus_tb` : 'No settled RT year held'),
    kpi(`Peak − off-peak${rtFull ? ` (${rtFull} RT)` : ''}`, sumE.status === 'loading' ? loading : pk ? sgn(pk.peak_lmp - pk.offpeak_lmp) : 'not held', '/MWh', pk ? `Peak ${fmt.price(pk.peak_lmp)} · off-peak ${fmt.price(pk.offpeak_lmp)}` : ''),
  ] : [];
  const segN = seg('duration', N, [[2, '2 h'], [4, '4 h'], [8, '8 h']]);
  const aBlock = b?.days ? `A ${N}-hour battery here would usually discharge in ${B(heRange(b.discharge))} and charge in ${B(heRange(b.charge))}, on ${B(fmt.int(b.days))} full days of the applied basis.` : 'No full day on the applied basis.';
  const bmH = bm.filter(m => m.days && finite(m.spread)), bmHi = bmH.reduce((a, m) => (!a || m.spread > a.spread ? m : a), null), bmLo = bmH.reduce((a, m) => (!a || m.spread < a.spread ? m : a), null);
  const aMonthB = bmHi ? `The ${N}-hour spread is widest in ${B(MONTHS[bmHi.m - 1])} (${B(fmt.price(bmHi.spread))}) and narrowest in ${B(MONTHS[bmLo.m - 1])} (${B(fmt.price(bmLo.spread))}).` : 'No monthly block on the applied basis.';
  const aCurve = curve.length ? `${B(fmt.pct(clear))} of ${B(fmt.int(curve.length))} days clear a $${T} max − min spread; the median day spreads ${B(fmt.price(med))}.` : 'No day with 20 priced hours on the applied basis.';
  const blockChart = b?.days ? groupedBar(b.hours.map(h => ({ label: `HE${h.h + 1}`, values: [h.topPct, h.botPct] })), { series: [`In the dearest ${N} (discharge)`, `In the cheapest ${N} (charge)`], fmt: pct1, title: 'Charge and discharge blocks by hour', height: 220 }) : env.noBasis('block hours');
  const blockTable = b?.days ? tbl(['HE', ['Days dearest'], ['%'], ['Days cheapest'], ['%'], ['Mean $/MWh']], b.hours.map(h => tr([td(h.h + 1), tn(fmt.int(h.top)), tn(fmt.pct(h.topPct)), tn(fmt.int(h.bot)), tn(fmt.pct(h.botPct)), tn(n2(h.mean))], b.discharge.includes(h.h) || b.charge.includes(h.h) ? 'hl' : '')), { max: 200 }) : '';
  const blockCard = card(key === 'storage' ? (S.depth === 'screen' ? 'c-12' : 'c-8') : 'c-6', 'When would a battery cycle?', `Studio 5.16 · share of days each clock hour is among the ${N} dearest and ${N} cheapest · ${describe(S.basis)}`, `${blockChart}${blockTable}`, { answer: aBlock, depth: key === 'storage' ? 'screen' : 'review', trace: 'p-blocks', chips: chips([]), tools: segN, foot: `Usual discharge ${heRange(b?.discharge)} · charge ${heRange(b?.charge)}. A price pattern, not a dispatch; Economics dispatches the battery within the Grid limits.` });
  const monthChart = bm.some(m => m.days) ? groupedBar(bm.map(m => ({ label: MONTHS[m.m - 1], values: [m.cheap, m.dear] })), { series: [`Cheapest ${N} h mean`, `Dearest ${N} h mean`], fmt: usd0, title: 'Charge and discharge prices by month', height: 170 }) : '';
  const monthTable = bm.some(m => m.days) ? tbl(['Month', ['Days'], ['Charge $/MWh'], ['Discharge $/MWh'], ['Spread'], 'Charge', 'Discharge'], bm.map(m => tr([td(MONTHS[m.m - 1]), tn(fmt.int(m.days)), tn(n2(m.cheap)), tn(n2(m.dear)), tn(n2(m.spread)), td(heRange(m.chargeHours)), td(heRange(m.dischargeHours))])), { max: 220 }) : '';
  const monthCard = card(key === 'storage' ? 'c-4' : 'c-6', 'Blocks by month', `Mean of each day's ${N} cheapest and ${N} dearest hours`, bm.some(m => m.days) ? `${monthChart}${monthTable}` : env.noBasis('monthly blocks'), { answer: aMonthB, depth: 'review', chips: chips([]), foot: 'Day-weighted means; the spread is dearest − cheapest, gross.' });
  const curveBody = curve.length ? `${typeof C.durationCurve === 'function' ? C.durationCurve([{ name: 'Daily max − min', values: sp }], { fmt: usd0, title: 'Daily spread duration curve', height: 200 }) : lineChart([{ name: 'Daily max − min', points: curve.map((d, i) => ({ x: (100 * i) / Math.max(1, curve.length - 1), y: d.spread })) }], { fmt: usd0, xfmt: v => `${Math.round(v)}%`, title: 'Daily spread duration curve', height: 200 })}
    ${tbl(['Percent of days', ...[1, 10, 25, 50, 75, 90, 99].map(q => [`${q}%`])], [tr([td('Spread $/MWh'), ...[1, 10, 25, 50, 75, 90, 99].map(q => tn(n2(curve[Math.min(curve.length - 1, Math.round((q / 100) * (curve.length - 1)))].spread)))])])}` : env.noBasis('daily spreads');
  const curveCard = card('c-6', 'How many days are worth cycling?', `Studio 5.17 · each day's max − min, widest first · ${fmt.pct(clear)} of days clear $${T}`, curveBody, { answer: aCurve, depth: 'review', trace: 'p-spreadcurve', chips: chips([]), tools: sel('pCycT', T, [10, 20, 30, 50, 75, 100].map(v => [v, `$${v} threshold`]), 'Cycle threshold'), foot: 'Days with fewer than 20 priced hours are left out, not filled. Gross: before round-trip efficiency and degradation.' });
  const BY = cached(`blocks|${hKey(id, H)}|${N}`, () => blockYears(H, N));
  const moved = BY.filter(r => BY[0] && heRange(r.discharge) !== heRange(BY[0].discharge)).length;
  const aYears = BY.length ? `The ${N}-hour discharge block is ${B(heRange(BY.at(-1).discharge))} in ${esc(BY.at(-1).kind === 'solved' ? RUN[BY.at(-1).run] || BY.at(-1).run : `${BY.at(-1).year} ${BY.at(-1).market}`)}; it differs from the first series' block in ${B(`${moved} of ${BY.length}`)} series.` : 'No settled year or solved run is held.';
  const yearCard = card('c-6', 'Blocks in every year and run', `${N}-hour discharge and charge blocks per settled year and solved run`, BY.length ? tbl(['Year', 'Series', ['Days'], 'Discharge', ['% days'], 'Charge', ['% days']], BY.map(r => tr([td(r.year), td(r.kind === 'solved' ? esc(RUN[r.run] || r.run) : `Settled ${esc(r.market)}`), tn(fmt.int(r.days)), td(heRange(r.discharge)), tn(fmt.pct(r.dischargePct)), td(heRange(r.charge)), tn(fmt.pct(r.chargePct))])), { max: 240 }) : '<div class="empty"><strong>No hourly prices held</strong>No settled year or solved run at this bus.</div>', { answer: aYears, depth: 'study', chips: chips([]), foot: 'A block that moves between history and the runs is a timing risk for a fixed schedule.' });
  const traces = [b?.days ? traceBlocks(node, S, b, bm) : '', curve.length ? traceSpreadCurve(node, S, rows, curve, T, clear) : ''];
  return { kpis, cards: [blockCard, monthCard, curveCard, yearCard], traces };
}

// ---------- Wind ----------
export function windShape(env) {
  const { S, node, id, res, sum, sumE, H, chips, rtFull, st } = env, s = res.summary, rows = res.rows || [];
  const fp = fleetProfile(), prof = fp.status === 'ok' ? fp.data : null, shape = prof?.wind || null;
  const typical = shape ? cached('typ|wind', () => typicalShape(shape)) : null;
  const weightOf = r => { const w = shape?.[String(r.timestamp).slice(0, 13)]; if (finite(w)) return w; const t = typical?.get(`${Number(String(r.timestamp).slice(5, 7))}|${Number(String(r.timestamp).slice(11, 13))}`); return finite(t) ? t : null; };
  const c = s && shape ? fleetCapture(rows, shape, typical) : null;
  const floor = s ? windowStats(rows, isWindHour) : null;
  const W = cached(`wind|${hKey(id, H)}|${fp.status}`, () => windYears(H, shape, typical));
  const pk = (sum?.year || []).find(r => r.market === 'RT' && r.y === rtFull);
  const capNote = c ? `${fmt.int(c.matched)} h matched · ${fmt.int(c.typical)} h typical shape${c.missing ? ` · ${fmt.int(c.missing)} h without a shape` : ''}` : '';
  const kpis = [
    kpi('Wind capture price (fleet shape)', fp.status === 'loading' ? loading : c && finite(c.capture) ? fmt.price(c.capture) : 'not held', '/MWh', c ? `Applied basis · ISO-NE fleet wind output · ${capNote}` : fp.status === 'loading' ? 'Reading fact_genfuel_hourly' : 'No fleet wind shape held'),
    kpi('Wind capture ratio', fp.status === 'loading' ? loading : c && finite(c.ratio) ? c.ratio.toFixed(3) : 'not held', '', 'Capture ÷ time-weighted mean of the same hours'),
    kpi('Overnight floor P5', floor ? fmt.price(floor.p5) : 'not held', '/MWh', floor ? `Applied basis · ${fmt.int(floor.n)} window hours (HE 1–7, 19–24)` : 'No result on the applied basis'),
    kpi('Overnight P25', floor ? fmt.price(floor.p25) : 'not held', '/MWh', floor ? `Median ${fmt.price(floor.p50)} · min ${fmt.price(floor.min)}` : ''),
    kpi('Overnight hours below $0', floor ? fmt.pct((100 * floor.neg) / floor.n) : 'not held', 'of window', floor ? `${fmt.int(floor.neg)} h · when a price-taking plant curtails` : ''),
    kpi(`Peak − off-peak${rtFull ? ` (${rtFull} RT)` : ''}`, sumE.status === 'loading' ? loading : pk ? sgn(pk.peak_lmp - pk.offpeak_lmp) : 'not held', '/MWh', pk ? `Peak ${fmt.price(pk.peak_lmp)} · off-peak ${fmt.price(pk.offpeak_lmp)}` : ''),
  ];
  const fl = W.filter(w => w.floor && w.kind === 'settled' && w.market === 'RT'), f0 = fl[0], f1 = fl.at(-1);
  const aFloor = f1 ? `The overnight P25 was ${B(fmt.price(f1.floor.p25))} in ${f1.year}${f0 && f0 !== f1 ? ` against ${B(fmt.price(f0.floor.p25))} in ${f0.year}` : ''}; P5 ${B(fmt.price(f1.floor.p5))}.` : W.some(w => w.floor) ? 'No settled real-time year is held; solved runs are drawn.' : '';
  const set = (k, kind) => W.filter(w => w.floor && (kind === 'solved' ? w.kind === 'solved' : w.kind === 'settled' && w.market === 'RT')).map(w => ({ x: w.year, y: w.floor[k] }));
  const floorSeries = [{ name: 'P25 · settled RT', points: set('p25') }, { name: 'P5 · settled RT', points: set('p5') }, { name: 'Cheapest window hour · settled', dashed: true, points: set('min') }, { name: 'P25 · solved runs', dashed: true, points: set('p25', 'solved').sort((a, b) => a.x - b.x) }, { name: 'P5 · solved runs', dashed: true, points: set('p5', 'solved').sort((a, b) => a.x - b.x) }];
  const floorTable = W.some(w => w.floor) ? tbl(['Year', 'Series', ['Window h'], ['P5'], ['P25'], ['Median'], ['Mean'], ['Min'], ['< $0 h']], W.filter(w => w.floor).map(w => tr([td(w.year), td(w.kind === 'solved' ? esc(RUN[w.run] || w.run) : `Settled ${esc(w.market)}`), tn(fmt.int(w.floor.n)), tn(n2(w.floor.p5)), tn(n2(w.floor.p25)), tn(n2(w.floor.p50)), tn(n2(w.floor.mean)), tn(n2(w.floor.min)), tn(fmt.int(w.floor.neg))])), { max: 220 }) : '';
  const floorCard = card(S.depth === 'screen' ? 'c-12' : 'c-8', 'Is the overnight floor getting worse?', 'Studio 5.20 · P5 and P25 of the wind-window hours (HE 1–7 and 19–24) by year; solved runs at their study years', W.some(w => w.floor) ? `${env.cape}${lineChart(floorSeries, { fmt: usd0, xfmt: v => String(Math.round(v)), title: 'Overnight floor by year', height: 220 })}${floorTable}` : '<div class="empty"><strong>No hourly prices held</strong>No settled year or solved run at this bus.</div>', { answer: aFloor, depth: 'screen', trace: 'p-floor', chips: chips([]), foot: `Read straight from the hours; nothing modelled. Settled = real time; runs = modelled years. ${env.foot('')}` });
  const wc = W.filter(w => w.kind === 'settled' && w.market === 'RT' && finite(w.ratio)).at(-1);
  const aWcap = wc ? `With the fleet wind shape a wind plant here captured ${B(r3(wc.ratio))} of the mean price in ${wc.year} (${B(fmt.price(wc.capture))}/MWh).` : shape ? 'No settled real-time capture year is held.' : 'The fleet wind shape is not loaded, so no capture is computed.';
  const sheetW = st?.bus?.sheet?.wind_cap_2030;
  const capSeries = [{ name: 'Fleet wind shape · settled RT', points: W.filter(w => w.kind === 'settled' && w.market === 'RT' && finite(w.ratio)).map(w => ({ x: w.year, y: w.ratio })) }, { name: 'Fleet wind shape · solved (typical shape)', dashed: true, points: W.filter(w => w.kind === 'solved' && finite(w.ratio)).map(w => ({ x: w.year, y: w.ratio })).sort((a, b) => a.x - b.x) }, { name: 'Studio sheet 2030 (vendor)', points: finite(sheetW) ? [{ x: 2030, y: sheetW }] : [] }];
  const capBody = fp.status === 'loading' ? pending({ status: 'loading' }, 'the ISO-NE fleet wind shape') : !shape ? '<div class="empty"><strong>Not held</strong>The fleet wind output (fact_genfuel_hourly) did not load, so no wind capture is computed.</div>'
    : `${lineChart(capSeries, { fmt: v => v.toFixed(3), xfmt: v => String(Math.round(v)), title: 'Wind capture ratio by year', height: 170 })}${tbl(['Year', 'Series', ['Mean'], ['Capture'], ['Ratio'], ['Matched h'], ['Typical h']], W.map(w => tr([td(w.year), td(w.kind === 'solved' ? esc(RUN[w.run] || w.run) : `Settled ${esc(w.market)}`), tn(n2(w.avg)), tn(n2(w.capture)), tn(r3(w.ratio)), tn(fmt.int(w.matched)), tn(fmt.int(w.typical))])), { max: 200 })}`;
  const capCard = card('c-4', 'Wind capture by year', 'Generation-weighted with the ISO-NE fleet wind shape (measured, system-wide)', capBody, { answer: aWcap, depth: 'review', trace: 'p-windcap', chips: chips(['modelled']), foot: `A fleet shape, not this site's wind. Model calendars use the typical month × hour fleet shape. Studio sheet 2030 wind ${finite(sheetW) ? sheetW : 'not held'} (vendor copy, older database, a different construction).` });
  const monthRows = c ? MONTHS.map((m, i) => { const rs = rows.filter(r => Number(String(r.timestamp).slice(5, 7)) === i + 1); return { m, ...fleetCapture(rs, shape, typical) }; }) : [];
  const wmH = monthRows.filter(r => finite(r.ratio)), wmLo = wmH.reduce((a, r) => (!a || r.ratio < a.ratio ? r : a), null), wmHi = wmH.reduce((a, r) => (!a || r.ratio > a.ratio ? r : a), null);
  const aWmon = wmLo ? `On the applied basis wind capture is weakest in ${B(wmLo.m)} (${B(wmLo.ratio.toFixed(3))}) and strongest in ${B(wmHi.m)} (${B(wmHi.ratio.toFixed(3))}).` : 'No wind capture on the applied basis.';
  const monthCard = card('c-6', 'Wind capture by month on the applied basis', describe(S.basis), c ? tbl(['Month', ['Average $/MWh'], ['Capture $/MWh'], ['Ratio'], ['Hours']], monthRows.map(r => tr([td(r.m), tn(fmt.price(r.avg)), tn(fmt.price(r.capture)), tn(finite(r.ratio) ? r.ratio.toFixed(3) : 'not held'), tn(fmt.int(r.hours))]))) : fp.status === 'loading' ? pending({ status: 'loading' }, 'the fleet wind shape') : env.noBasis('wind capture'), { answer: aWmon, depth: 'review', chips: chips(['modelled']), foot: 'Capture = Σ fleet MW × price × h ÷ Σ fleet MW × h · Economics applies the capacity factor, losses and the connection cap.' });
  const traces = [W.some(w => w.floor) ? traceFloor(node, W, H) : '', c ? traceWindCap(node, S, rows, c, weightOf, W, prof?.source) : ''];
  return { kpis, cards: [floorCard, capCard, monthCard], traces };
}
