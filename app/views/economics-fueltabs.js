// Economics fuel-routed tabs (v5): data centre (Load cost, Load flex, Cost finance, hybrid not applicable) and storage
// (Storage revenue: arbitrage ceiling, 2–8 h sweep, cycles against a threshold, net bridge, projection by run, and the
// capacity / ancillary / Clean Peak rows only as cited or held). Shared helpers come from economics.js (EH).
import { EH } from './economics.js';
import { fmt, describe } from '../basis.js';
import { dailySpreads } from '../prices.js';
import { barChart, lineChart } from '../charts.js';
import { groupSum, dailyCycles, reserveValue, spreadBenchmark, topBottom } from '../economics.js';
import { llYear } from './grid-dc.js';
import { get as getData, waitText, rules as getRules } from './economics-data.js';
import { loadEnergyCost } from '../economics-load.js';
import { storageHandoffExtras } from '../economics-stack.js';
import { dcFlow } from '../rules/largeload.js';
import { dcCards } from './cards-dc.js';
import { stacked, histo, table, card, B, nextStep, moreCtl } from './economics-charts.js';
import { esrCards } from './economics-esr-card.js';
import { monthlyCost, loadFlex, bessBridge, projectRuns, pvCost } from './economics-fuel.js';
import { scarcity } from './prices-fuel.js';
import { traceLoadCost, traceFlex, traceCostFin, traceBridge, traceSweep } from './economics-fuel-trace.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const money = v => fmt.money(v);
const seg = (k, cur, opts) => `<div class="segmented seg-sm" role="group">${opts.map(([v, l]) => `<button data-act="ui" data-k="${k}" data-v="${esc(v)}" class="${String(cur) === String(v) ? 'active' : ''}">${esc(l)}</button>`).join('')}</div>`;
const notApplicable = (title, fuel, why) => card(12, title, `Not applicable to ${fuel}`, `<div class="empty"><strong>Not applicable to ${esc(fuel)}</strong>${esc(why)}</div>`, { depth: 'screen', answer: `${esc(title)} does not apply to ${esc(fuel)}.` });
/**
 * The dcFlow arguments for this project, the same rule Grid's stage cards use (views/grid-dc.js): RNS year = llYear(rules)
 * (this calendar year when held, else the latest held year), kv = nominal kV else the bus kV, the large-load service and
 * application date from S.ui. energy: the measured load-cost object when held.
 */
export function dcFlowArgs(S, node, rules, energy) {
  return { bus: S.nodeId, mw: Number(S.importMW), kv: node?.nominal_kv ?? node?.kv ?? null, service: S.ui?.llService || 'FCDS', year: llYear(rules),
    energy: energy && typeof energy.value === 'number' ? energy : undefined, applicationDate: S.ui?.llAppDate || undefined };
}
const needImport = S => (Number(S.importMW) > 0 ? '' : '<div class="empty"><strong>Enter the load size</strong>Set Import MW in the project strip: a data centre is sized by what it draws.</div>');

// ---------- Data centre ----------
export function tabLoadCost(ctx) {
  const { S } = ctx, x = EH.inputs(ctx);
  if (!x.res.summary) return EH.noBasis(ctx);
  if (needImport(S)) return needImport(S);
  const mw = Number(S.importMW), n = x.yearsEq, gi = EH.loadGate(x, mw); // C35: withdrawal cases; Envelope only / Hold never pass
  // S2-EM: one energy definition (economics-load.js), shared with Decision and the S6 delivered-cost stack.
  const le = loadEnergyCost(x.records, mw), energy = le.value;
  // S6 Lead wiring 3: the large-load proposal replaces the old "100% capacity obligation" and "RNS not held" lines:
  // FCDS = bring-your-own new generation (ICR-excluded); transmission = the FCDS charge at the RNS rate (instead of RNS).
  const R = getRules();
  const flow = R.state === 'ok' && R.data.large_load ? dcFlow(R.data, ctx.data.grid, dcFlowArgs(S, x.node, R.data, le)) : null;
  const dc = flow ? dcCards({ flow, node: { name: x.node?.name, busId: S.nodeId } }) : null;
  const st = flow?.stack;
  const stack = { measured: ok(energy) ? energy : null };
  const months = monthlyCost(x.records, mw), dear = months.reduce((b, m) => (!b || m.cost > b.cost ? m : b), null);
  const p95 = (() => { const p = x.records.map(r => r.price).sort((a, b) => a - b); return p.length ? p[Math.floor(0.95 * (p.length - 1))] : null; })();
  const top = ok(p95) ? scarcity(x.records, p95) : null, s200 = scarcity(x.records, 200);
  // Wholesale exposure by year and run: mean × 8,760 × MW on every held series.
  const ys = EH.yearSeries(ctx).map(y => { const rs = (y.s.records || []).filter(r => ok(r[1])); const h = rs.reduce((t, r) => t + (r[6] ?? 1), 0); const mean = h ? rs.reduce((t, r) => t + r[1] * (r[6] ?? 1), 0) / h : null; return { label: y.label, short: y.short, kind: y.kind, usable: y.usable, why: y.why, hours: h, mean, cost: ok(mean) ? mean * 8760 * mw : null }; });
  const held = ys.filter(r => r.usable && ok(r.cost));
  const kpis = `<div class="kpis">
    ${EH.kpi(gi.ok ? 'Energy cost per year' : 'Energy cost per year (connection conditional)', money(stack.measured), '/yr', ok(le.mean) ? `${fmt.mw(mw)} flat × ${fmt.price(le.mean)}/MWh (observed-hour mean) × 8,760 h · hourly bill on the basis` : le.reason)}
    ${st ? EH.kpi(`${st.transmission?.code || 'Transmission'} service charge`, ok(st.transmission?.usd) ? money(st.transmission.usd) : 'not held', ok(st.transmission?.usd) ? '/yr' : '', ok(st.transmission?.usd) ? 'Billed at the RNS rate, instead of RNS (proposal, pending §205)' : (st.transmission?.why || ''), !ok(st.transmission?.usd)) : EH.kpi('Delivered cost stack', R.state === 'loading' ? 'loading' : 'not held', '', R.state === 'error' ? `Rules file could not load: ${R.error}` : R.state === 'loading' ? 'Reading rules/isone-2026.json' : 'large_load rules not in the rules file', true)}
    ${st ? EH.kpi('Delivered cost (held lines)', ok(st.heldTotal) ? `${st.bound === 'lower' ? '≥ ' : ''}${money(st.heldTotal)}` : 'not held', ok(st.heldTotal) ? '/yr' : '', `${st.notHeld} of ${st.lines.length} lines not held, so a lower bound · pending §205`, !ok(st.heldTotal)) : ''}
    ${EH.kpi('Costliest month', dear ? money(dear.cost) : 'not held', '', dear ? `${dear.key} · mean ${fmt.price(dear.mean)}/MWh` : '', !dear)}
    ${EH.kpi('Top 5% of hours', top ? fmt.pct(top.share) : 'not held', 'of the bill', top ? `hours above ${fmt.price(p95)} · above $200: ${fmt.int(s200.above)} h, ${fmt.pct(s200.share)}` : '', !top)}
  </div>`;
  const monthChart = barChart(months.map(m => ({ label: m.key.slice(2), value: m.cost, note: `${fmt.int(m.mwh)} MWh · ${fmt.price(m.mean)}/MWh` })), { fmt: money, title: 'Monthly energy cost', height: 200 });
  const yearChart = held.length ? barChart(held.map(r => ({ label: r.short, value: r.cost, note: `${fmt.price(r.mean)}/MWh · ${r.kind === 'run' ? 'solved run' : 'settled'}` })), { fmt: money, title: 'Energy cost by year and run', height: 200 }) : '<div class="empty"><strong>Not held</strong>No other year or run.</div>';
  const yearTbl = table([{ k: 'label', l: 'Year / run' }, { k: 'hours', l: 'Hours', num: true, f: v => fmt.int(v) }, { k: 'mean', l: 'Mean $/MWh', num: true, f: v => (ok(v) ? fmt.price(v) : null) }, { k: 'cost', l: `At ${fmt.mw(mw)} $/yr`, num: true, f: v => (ok(v) ? money(v) : null) }, { k: 'why', l: 'Note', wrap: true }], ys);
  const hHi = held.reduce((a, r) => (!a || r.cost > a.cost ? r : a), null), hLo = held.reduce((a, r) => (!a || r.cost < a.cost ? r : a), null);
  const aMonth = dear ? `${B(dear.key)} is the costliest month at ${B(money(dear.cost))} (mean ${B(fmt.price(dear.mean))}/MWh).` : 'No month on the basis.';
  const aYear = hHi ? `The same load would cost from ${B(money(hLo.cost))} (${esc(hLo.label)}) to ${B(money(hHi.cost))} (${esc(hHi.label)}) a year across ${B(fmt.int(held.length))} held years and runs.` : 'No other year or run is held.';
  return `${EH.basisStrip(ctx, x)}${gi.ok ? '' : `<div class="notice warn">${gi.status === 'Does not fit' && ok(x.importLimit) ? `<b>Import above the studied limit.</b> ${fmt.mw(mw)} exceeds the import limit of ${fmt.mw(x.importLimit)}; the costs below are for the full load, which needs network upgrades (Grid › Upgrade cost allocator).` : `${gi.msg} The costs below are for the full load.`}</div>`}${kpis}
    ${EH.cards(
      ...(dc ? dc.stages.economics : [card(12, 'Delivered cost stack (load)', 'large-load proposal (pending §205)', `<div class="empty"><strong>${R.state === 'loading' ? 'Loading the rules file' : 'Not held'}</strong>${esc(R.state === 'error' ? `rules/isone-2026.json could not load: ${R.error}` : R.state === 'loading' ? 'Reading rules/isone-2026.json…' : 'The large_load rules are not in the rules file.')}</div>`, { depth: 'screen', chips: 'pending not-held', answer: `Energy on the basis is ${B(money(stack.measured))}/yr; the other delivered-cost lines need the large-load rules.` })]),
      card(6, 'Wholesale exposure by month', describe(S.basis), monthChart, { depth: 'review', answer: aMonth, foot: 'Flat load × hourly node price; no hedge, no retail margin.' }),
      card(12, 'Wholesale exposure by year and run', 'the same load on every held settled year and forecast run', `${yearChart}`, { depth: 'review', chips: 'modelled', answer: aYear, foot: 'Settled years are real time; runs are modelled years. A part year is compared by mean.' }),
      card(12, 'Exposure detail', 'every held year and run', yearTbl, { depth: 'study', answer: `${B(fmt.int(ys.filter(r => r.usable).length))} of ${fmt.int(ys.length)} held series are usable for a full-year cost.` }),
    )}
    ${EH.cards(EH.traceCard(traceLoadCost(S, x.node, x, { mw, le })))}
    ${nextStep('see what shifting part of the load saves in Economics › Load flex', 'economics', 'bess')}`;
}

export function tabLoadFlex(ctx) {
  const { S } = ctx, x = EH.inputs(ctx);
  if (!x.res.summary) return EH.noBasis(ctx);
  if (needImport(S)) return needImport(S);
  const mw = Number(S.importMW), share = EH.val(S, 'flexShare'), N = [2, 4, 8].includes(Number(S.ui.flexN)) ? Number(S.ui.flexN) : 4;
  const f = loadFlex(x.records, { mw, sharePct: share, hours: N });
  const energy = (x.records.reduce((t, r) => t + r.price * r.dtHours, 0) * mw) / x.yearsEq;
  const bm = groupSum(x.records, r => String(r.timestamp).slice(0, 7), { p: r => r.price * r.dtHours, h: r => r.dtHours });
  const kpis = `<div class="kpis">
    ${EH.kpi('Load-flex saving', money(f.savingYr), '/yr', `${share}% of ${fmt.mw(mw)} moved from the ${N} dearest to the ${N} cheapest hours daily`)}
    ${EH.kpi('Share of the energy bill', ok(f.savingYr) && energy ? fmt.pct((100 * f.savingYr) / energy) : 'not held', '', `of ${money(energy)}/yr`)}
    ${EH.kpi('Mean daily spread', fmt.price(f.meanSpread), '/MWh', `${fmt.int(f.days)} days · dearest ${N} − cheapest ${N}`)}
    ${EH.kpi('Shifted power', fmt.mw(f.shiftMW), '', 'placeholder share: no site flexibility study is held')}
    ${EH.kpi('Battery for the same shift', `${fmt.mw(f.shiftMW)} × ${N} h`, '', 'a battery could do it without moving the load, at its RTE and cost')}
    ${EH.kpi('Hybrid (solar + storage)', 'n/a', '', 'not applicable to a load', true)}
  </div>`;
  const hist = histo(f.spreads, { bins: 20, fmt: v => `$${v.toFixed(0)}`, title: 'Daily spread (dearest N − cheapest N)', height: 210 });
  const bmv = bm.filter(m => m.h).map(m => ({ k: m.key, v: m.p / m.h })), bmHi = bmv.reduce((a, m) => (!a || m.v > a.v ? m : a), null);
  return `${EH.basisStrip(ctx, x)}${kpis}
    ${EH.cards(
      card(4, 'Flexibility', 'what share of the load can move, and for how long', `<div class="form-grid">${EH.slider(S, 'flexShare', 'Share of load that can move', '%', 0, 50, 1)}</div><div class="field">Block length ${seg('flexN', N, [[2, '2 h'], [4, '4 h'], [8, '8 h']])}</div>`, { depth: 'screen', chips: 'assumption', answer: `Moving ${B(`${share}%`)} of the load (${B(fmt.mw(f.shiftMW))}) for ${B(`${N} hours`)} a day saves ${B(money(f.savingYr))}/yr.`, foot: 'Energy only. Rebound, process limits and SLAs are not modelled.' }),
      card(8, 'Daily spread a shiftable load could capture', `${fmt.int(f.days)} days · ${describe(S.basis)}`, hist, { depth: 'screen', trace: 'e-flex', answer: `The ${N} dearest hours of a day average ${B(fmt.price(f.meanSpread))}/MWh above the ${N} cheapest, over ${B(fmt.int(f.days))} days.`, foot: 'Perfect foresight of each day\'s prices: a ceiling.' }),
      card(12, 'Monthly mean price', 'where the flexible hours are worth most', barChart(bm.map(m => ({ label: m.key.slice(2), value: m.h ? m.p / m.h : null })), { fmt: v => `$${v.toFixed(0)}`, title: 'Monthly mean price', height: 180 }), { depth: 'review', answer: bmHi ? `${B(bmHi.k)} is the dearest month at ${B(fmt.price(bmHi.v))}/MWh.` : 'No month on the basis.' }),
    )}
    ${EH.cards(EH.traceCard(traceFlex(S, x.node, x, { mw, share, f })))}
    ${nextStep('put the load\'s cost into Economics › Cost finance', 'economics', 'finance')}`;
}

export const tabHybridNA = () => `${EH.cards(notApplicable('Hybrid sizing', 'a data centre (load)', 'A load does not generate, so there is no solar to clip or store. Load flexibility (the previous tab) and a behind-the-meter battery are the load-side equivalents.'))}
    ${nextStep('put the load\'s cost into Economics › Cost finance', 'economics', 'finance')}`;

export function tabCostFinance(ctx) {
  // Finance on cost: the PV of what the load pays for energy leads; the project valuation (your own capital, O&M and
  // site revenue, never an energy revenue for a load) follows on the same inputs, so the discount rate and years are shared.
  const { S } = ctx, x = EH.inputs(ctx), f = S.ui.fin || {};
  if (!x.res.summary) return EH.noBasis(ctx);
  if (needImport(S)) return needImport(S);
  const mw = Number(S.importMW), annual = (x.records.reduce((t, r) => t + r.price * r.dtHours, 0) * mw) / x.yearsEq, mwh = mw * 8760;
  const g = ok(f.escalation) ? f.escalation : 0;
  const valid = ok(f.discountRate) && f.discountRate > -1 && f.discountRate <= 1 && Number.isInteger(f.years) && f.years >= 1 && f.years <= 60;
  const escInput = `<label class="field">Price escalation <span class="pill">${ok(f.escalation) ? 'U' : 'A'}</span><input type="number" step="any" data-act="fin" data-k="escalation" value="${ok(f.escalation) ? f.escalation : ''}" placeholder="0"><span class="audit-note">fraction per year; blank = 0 (flat real prices, assumption)</span></label>`;
  const c = valid ? pvCost({ annual, mwh, rate: f.discountRate, years: f.years, escalation: g }) : null;
  const costCards = c ? EH.cards(
    card(8, 'Energy cost of the load, by year', `PV ${money(c.pv)} · levelised ${ok(c.levelised) ? `$${c.levelised.toFixed(2)}/MWh` : 'not held'} · ${f.years} years at ${(100 * f.discountRate).toFixed(1)}%`, lineChart([{ name: 'Cost', points: c.rows.map(r => ({ x: r.year, y: r.cost })) }, { name: 'Present value', dashed: true, points: c.rows.map(r => ({ x: r.year, y: r.pv })) }], { fmt: money, xfmt: v => `Y${v}`, title: 'Energy cost by year', height: 220 }), { depth: 'screen', trace: 'e-costfin', answer: `Over ${B(`${f.years} years`)} at ${B(`${(100 * f.discountRate).toFixed(1)}%`)} the load's energy costs ${B(money(c.pv))} in present value${ok(c.levelised) ? `, ${B(`$${c.levelised.toFixed(2)}/MWh`)} levelised` : ''}.`, foot: `Year 1 ${money(annual)} (${fmt.mw(mw)} flat, measured on the basis). Energy only: capacity is an assumption and transmission is not held (Load cost).` }),
    card(4, 'Cost inputs', 'escalation of the energy price', `<div class="form-grid">${escInput}</div>${table([{ k: 'year', l: 'Year', num: true }, { k: 'cost', l: 'Cost', num: true, f: money }, { k: 'pv', l: 'PV', num: true, f: money }], c.rows.slice(0, 10))}`, { depth: 'review', chips: 'assumption', answer: `Year 1 energy is ${B(money(annual))}, escalating ${B(`${(100 * g).toFixed(1)}%`)} a year${ok(f.escalation) ? '' : ' (blank = flat real prices)'}.` }),
  ) : EH.cards(card(12, 'Energy cost of the load', 'finance on cost', '<div class="empty"><strong>Enter a discount rate and operating years</strong>The present value of the energy cost of the load uses the same rate and years as the valuation below.</div>', { depth: 'screen', answer: `Year 1 energy for this load is ${B(money(annual))}; its present value needs a discount rate and operating years.` }));
  return `<div class="notice">A data centre is valued on its <b>cost</b>: the energy it buys at this node, discounted. A load earns no energy revenue; the valuation below uses only your own capital, O&amp;M and site revenue.</div>
    ${costCards}${c ? EH.cards(EH.traceCard(traceCostFin(S, x.node, { annual, mwh, rate: f.discountRate, years: f.years, escalation: g, c }))) : ''}
    ${EH.tabFinance(ctx)}`;
}

// ---------- Storage revenue ----------
const SWEEP = [2, 3, 4, 6, 8];
export function tabStorageRevenue(ctx) {
  const { S } = ctx, x = EH.inputs(ctx);
  if (!x.res.summary) return EH.noBasis(ctx);
  if (EH.needSize(S)) return EH.needSize(S);
  const mw = Number(S.exportMW), dur = EH.val(S, 'duration'), rte = EH.val(S, 'rte'), cycleCost = EH.val(S, 'cycleCost'), deg = EH.val(S, 'degStorage'), E = mw * dur, n = x.yearsEq;
  const b = EH.battery(ctx, mw, dur, x);
  if (b.pending) return `${EH.basisStrip(ctx, x)}${EH.solvingPanel(x, `a ${fmt.mw(mw)} / ${fmt.int(E)} MWh battery`, b.grid)}`;
  if (b.errors.length) return `${EH.basisStrip(ctx, x)}<div class="notice error" role="alert">${b.errors.map(esc).join(' ')}</div>`;
  const free = cycleCost === 0 ? b : EH.battery(ctx, mw, dur, x, rte, 0);
  if (free.pending) return `${EH.basisStrip(ctx, x)}${EH.solvingPanel(x, 'the free-cycling reference dispatch', free.grid)}`;
  const dispatchNet = b.summary.netValue / n, dispatchFree = free.pending || free.errors?.length ? null : free.summary.netValue / n;
  const intDur = Number.isInteger(dur) ? dur : Math.round(dur);
  const days = dailySpreads(x.res.rows, intDur), tb = days.length ? days.reduce((t, d) => t + d.spread, 0) / days.length : null;
  const ceiling = ok(tb) ? (tb * E * days.length) / n : null;
  // P2 C28: the round-trip loss falls on the top-hour revenue only (topBottom on dailySpreads' own days), never RTE × the spread.
  const tbx = topBottom(x.res.rows, days, intDur), topGross = ok(tbx.top) ? (tbx.top * E * tbx.days) / n : null;
  const bridge = bessBridge({ ceiling, topGross, rte: rte / 100, dispatchFree, dispatchNet, degPct: deg });
  const eta = Math.sqrt(rte / 100), cyc = dailyCycles(b.rows, E, eta), thr = EH.val(S, 'cycThr'), over = cyc.filter(d => d.cycles > thr + 1e-9).length;
  const study = ctx.depth !== 'screen';
  const sweep = SWEEP.map(d => { if (!study) return { dur: d, value: null, note: 'Review depth runs the sweep' }; const r = d === dur ? b : EH.battery(ctx, mw, d, x); return { dur: d, value: r.pending || r.errors?.length ? null : r.summary.netValue / n, note: r.pending ? 'solving…' : r.errors?.[0] || '' }; });
  // The run projection scales each run's Studio spreadBenchmark (EH.spreadRows), so the basis ratio uses that same benchmark.
  const bench = getData('bench', S.nodeId), benchBasis = spreadBenchmark({ mw, dur, spread: tb, cycles: 365, rte: rte / 100 });
  const ratio = ok(benchBasis) && benchBasis > 0 ? dispatchNet / benchBasis : null;
  const runRows = bench.state === 'ok' ? EH.spreadRows(bench.data, dur, mw, rte).filter(r => r.kind === 'run' || (r.kind === 'settled' && r.market === 'RT' && r.days >= 300)).map(r => ({ label: r.label, y: r.y, bench: r.bench, kind: r.kind })) : [];
  const proj = projectRuns(runRows, ratio);
  // Revenue stack rows: only cited or held; everything else labelled. Capacity and Clean Peak are the S4 rules streams
  // (S4 Lead wiring 2, W-B): the Clean Peak certificates are counted from this dispatch's discharge by hour within the
  // rules file's seasonal windows, at the rules file's price (never a typed $/kW-mo).
  const capMW = Math.min(mw, ok(x.exportLimit) ? x.exportLimit : mw);
  const s4 = EH.s4Streams(ctx, { tech: 'storage', mw: capMW, durationH: dur, energy: bridge.net, energyLabel: 'net arbitrage after degradation (Economics › Storage revenue)', cpsRows: EH.cpsRowsOf(b.rows) });
  const capStream = s4.capacity, capacity = capStream.value, cps = s4.cps, cpec = ok(cps.value) ? cps.value / n : null;
  const resv = getData('reserves', S.nodeId), reserve = resv.state === 'ok' ? reserveValue(b.rows, k => resv.data.hours[k]?.[0] ?? null, mw) : null;
  const tmsr = reserve && reserve.matched ? (reserve.idleValue * 8760) / reserve.matched : null;
  const idleHours = b.rows.filter(r => !(r.chargeMW > 1e-6) && !(r.dischargeMW > 1e-6)).reduce((t, r) => t + r.dtHours, 0) / n;
  const reg = mw * (EH.val(S, 'regShare') / 100) * EH.val(S, 'regPrice') * idleHours;
  const cpsNote = ok(cpec) ? `${cps.status === 'conditional' ? 'conditional' : cps.status}: ${cps.regime}; price ${cps.priceSrc || 'not held'}; ${cps.reason || ''}`.trim() : `${cps.regime ? `${cps.regime}: ` : ''}${cps.reason || 'not held'}`;
  const stack = [
    { stream: 'Energy arbitrage (net, after degradation)', value: bridge.net, status: 'modelled on measured prices', add: 'headline' },
    { stream: 'Capacity (S4 rules stream)', value: capacity, status: `conditional: capacity case not studied · ${EH.streamNote(capStream)}`, add: 'not added' },
    { stream: 'Reserves (TMSR, idle hours)', value: tmsr, status: resv.state === 'ok' ? (tmsr != null ? 'held: unified fact_as_price_hourly' : 'held 2023-07 to 2026-07: no basis hour overlaps') : waitText(resv, 'reserve prices'), add: 'not additive' },
    { stream: 'Regulation', value: reg, status: `assumption: ext/75 ${EH.val(S, 'regShare')}% × $${EH.val(S, 'regPrice')}/MW-h in idle hours; not held in the DB`, add: 'not additive' },
    { stream: 'Clean Peak certificates (MA, S4 rules stream)', value: cpec, status: cpsNote, add: 'not additive' },
    { stream: 'RECs', value: null, status: 'not applicable: storage creates no RECs', add: '' },
  ];
  // S5 Lead wiring 3: the handoff carries MWh discharged and the charging bill so after-tax finance can compute an LCOS.
  S.ui.revenueOutBess = { busId: S.nodeId, tech: 'storage', mw, annual: bridge.net, ...storageHandoffExtras(b.rows, b.summary, n), basis: describe(S.basis), hash: EH.basisHash(S.basis), conditional: !EH.gate(x.exportLimit, mw, 'Export').ok || !EH.gate(x.importLimit, mw, 'Charging').ok || x.chargeEnvelopeOnly, at: new Date().toISOString() };
  const kpis = `<div class="kpis">
    ${EH.kpi('Net storage value', money(bridge.net), '/yr', `${EH.perKw(bridge.net, mw)}/kW-yr · after RTE, cycling and ${deg}%/yr degradation · perfect foresight`)}
    ${EH.kpi('Arbitrage ceiling', money(ceiling), '/yr', `TB${intDur} ${fmt.price(tb)} × ${fmt.int(E)} MWh × ${fmt.int(days.length)} days · gross`, !ok(ceiling))}
    ${EH.kpi('Dispatch ÷ ceiling', ok(ceiling) && ceiling > 0 ? fmt.pct((100 * dispatchNet) / ceiling) : 'not held', '', 'how much of the gross spread the battery keeps', !(ok(ceiling) && ceiling > 0))}
    ${EH.kpi('Cycles per year', (b.summary.equivalentCycles / n).toFixed(0), '/yr', `${fmt.int(over)} of ${fmt.int(cyc.length)} days above ${thr}/day (ext/75 planning basis)`)}
    ${EH.kpi('Capacity (conditional)', money(capacity), ok(capacity) ? '/yr' : '', `${EH.streamNote(capStream)} · not in the headline`, !ok(capacity))}
    ${EH.kpi('Clean Peak (MA)', ok(cpec) ? money(cpec) : 'not held', ok(cpec) ? '/yr' : '', ok(cpec) ? `${cps.status === 'conditional' ? 'conditional (eligibility not tested) · ' : ''}certificates from this dispatch's discharge in the rules-file windows; not stacked` : cps.reason || 'not held', !ok(cpec))}
  </div>`;
  const bridgeChart = barChart(bridge.steps.map(s => ({ label: s.short, value: s.value, note: s.label })), { fmt: money, title: 'Net bridge', height: 220, emptyText: 'No full day on the basis, so no ceiling.' });
  const bridgeTbl = table([{ k: 'label', l: 'Step' }, { k: 'value', l: '$/yr', num: true, f: v => (ok(v) ? money(v) : null) }], bridge.steps);
  const sweepChart = barChart(sweep.map(r => ({ label: `${r.dur} h`, value: ok(r.value) ? r.value / (mw * 1000) : null, note: r.note })), { fmt: v => `$${v.toFixed(0)}`, yLabel: '$/kW-yr', title: 'Value by duration', height: 200, emptyText: study ? 'Durations are solving.' : 'Raise depth to Review to run the sweep.' });
  const projChart = proj.some(r => ok(r.value)) ? barChart(proj.map(r => ({ label: r.kind === 'run' ? r.label.split(' · ')[0] + (r.label.includes('5-yr') ? ' 5y' : r.label.includes('10-yr') ? ' 10y' : '') : String(r.y), value: r.value })), { fmt: money, title: 'Projected value by year and run', height: 200 }) : `<div class="empty"><strong>${esc(waitText(bench, 'spread benchmarks') || 'Not held')}</strong>${ok(ratio) ? '' : 'No basis benchmark to scale by.'}</div>`;
  const stackTbl = table([{ k: 'stream', l: 'Stream' }, { k: 'value', l: '$/yr', num: true, f: v => (ok(v) ? money(v) : null) }, { k: 'add', l: 'In headline' }, { k: 'status', l: 'Basis', wrap: true }], stack);
  const ours = ok(ceiling) && ceiling > 0 ? { share: dispatchNet / ceiling, label: `${fmt.mw(mw)} × ${dur} h on ${describe(S.basis)}` } : null;
  const esr = ctx.depth === 'screen' || S.depth === 'screen' ? { cards: [], trace: '' } : esrCards(ctx, ours);
  // Answer sentences (V6).
  const aBridge = ok(bridge.net) ? `After efficiency, cycling cost and degradation this ${fmt.mw(mw)} battery nets ${B(money(bridge.net))}/yr (${B(`${EH.perKw(bridge.net, mw)}/kW-yr`)}), ${ok(ceiling) && ceiling > 0 ? `${B(fmt.pct((100 * bridge.net) / ceiling))} of the gross ${B(money(ceiling))} ceiling` : 'no gross ceiling held'}.` : 'No net value on the basis.';
  const aStack = `Only arbitrage (${B(money(bridge.net))}/yr) is in the headline; capacity would add ${B(money(capacity))}/yr if accredited, and is conditional.`;
  const aInputs = `The value rests on a ${B(`${dur}-hour`)} battery at ${B(`$${cycleCost}/MWh`)} cycling cost and ${B(`${deg}%/yr`)} degradation (placeholders marked P).`;
  const swH = sweep.filter(r => ok(r.value)), swBest = swH.reduce((a, r) => (!a || r.value > a.value ? r : a), null);
  const aSweep = swBest ? `Per kW of power, ${B(`${swBest.dur} hours`)} earns most at ${B(`$${(swBest.value / (mw * 1000)).toFixed(0)}/kW-yr`)} on these prices.` : study ? 'The duration sweep is still solving.' : 'Raise depth to Review to run the sweep.';
  const aCyc = `The optimal schedule runs ${B(((b.summary.equivalentCycles / n) / 365).toFixed(2))} cycles a day on average; ${B(`${fmt.int(over)} of ${fmt.int(cyc.length)}`)} days exceed ${thr}.`;
  const prH = proj.filter(r => ok(r.value)), prHi = prH.reduce((a, r) => (!a || r.value > a.value ? r : a), null), prLo = prH.reduce((a, r) => (!a || r.value < a.value ? r : a), null);
  const aProj = prHi ? `Scaled by this dispatch's ${B(ratio.toFixed(3))} share of the spread benchmark, value runs from ${B(money(prLo.value))} (${esc(prLo.label)}) to ${B(money(prHi.value))} (${esc(prHi.label)}).` : 'No benchmark to project from.';
  return `${EH.basisStrip(ctx, x)}${kpis}
    ${EH.cards(
      card(6, 'Net bridge: gross spread to net value', `${fmt.mw(mw)} × ${dur} h · ${rte}% RTE · $${cycleCost}/MWh cycling · ${deg}%/yr degradation`, `${bridgeChart}${bridgeTbl}`, { depth: 'screen', trace: 'e-bridge', chips: 'modelled assumption', answer: aBridge, foot: 'Perfect-foresight dispatch on the basis prices within the Grid limits (shoulder charge).' }),
      card(6, 'Storage revenue stack', 'only cited or held prices; the rest labelled', stackTbl, { depth: 'review', chips: 'assumption not-held', answer: aStack, foot: 'One battery cannot sell the same MW twice: only arbitrage is in the headline.' }),
      card(4, 'Battery inputs', 'A cited · P placeholder · U yours', `<div class="form-grid">${EH.slider(S, 'duration', 'Duration', 'hours', 1, 8, 1, false)}${EH.slider(S, 'cycleCost', 'Cycling cost', '$/MWh', 0, 50, 1, false)}</div>${moreCtl(`<div class="form-grid">${EH.slider(S, 'degStorage', 'Degradation', '%/yr', 0, 5, 0.5, false)}${EH.slider(S, 'cycThr', 'Cycle threshold', 'cycles/day', 0.5, 2, 0.1, false)}</div>`)}`, { depth: 'review', chips: 'assumption', answer: aInputs }),
      card(4, 'Duration sweep 2–8 h', 'same prices, power and limits; energy changes', sweepChart, { depth: 'review', trace: 'e-sweep', answer: aSweep }),
      card(4, 'Cycles per day', `${fmt.int(over)} days above ${thr}`, histo(cyc.map(d => d.cycles), { bins: 10, fmt: v => v.toFixed(2), title: 'Equivalent cycles per day', height: 200 }), { depth: 'review', answer: aCyc }),
      card(12, 'Projection by year and run', `each run's TB${dur} benchmark × the basis dispatch ÷ benchmark (${ok(ratio) ? ratio.toFixed(3) : 'not held'})`, projChart, { depth: 'review', chips: 'modelled', answer: aProj, foot: 'Projected, not dispatched per run. Runs are modelled years; never averaged.' }),
      ...esr.cards,
    )}
    <div class="handoff"><div><strong>Use this storage value in Project finance</strong><p>Sends ${money(bridge.net)}/yr (net, after degradation) for this bus and size.</p></div><button class="primary" data-act="handoff-bess">Use this value in Finance</button></div>
    ${EH.cards(EH.traceCard(ceiling != null ? traceBridge(S, x.node, x, { bridge, dur: intDur, tb, top: tbx.top, days: days.length, E, rte, deg, cycleCost, dispatchNet }) : '', study ? traceSweep(S, x.node, x, { sweep, proj, ratio, mw, dur }) : '', esr.trace))}
    ${nextStep('test the battery\'s cash flows in Economics › Project finance', 'economics', 'finance')}`;
}
