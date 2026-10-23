// Market's tabs as they were before the map view: the baseline file (commit 445b2e1, app/views/market.js), restored
// 2026-10-23 for the category tabs. views/market.js draws the Map tab and the stage bar, and hands find / rank / size / regions to
// renderMarket here. Everything below this header is the baseline file, unchanged.
// Market dashboard v3: where to investigate. ISO-wide screening over /api/market (unified database, Grid rules),
// plus the /api/x/market aggregates (measures, zones, system, supply) and the Studio copy for data notes.
// Every figure is computed from the unified database unless its card says "Studio copy (older database)".
import { geoMap, geoLegend, rampColor } from '../geomap.js';
import {
  evaluate, rank, regions, MEASURES, serviceLimits, funnel, requirementMatrix, defaultWeights, discrimination, sensitivity,
  sizeProfile, caseMatrix, marketPercentiles, quantile, median, genMixShares, contributions,
  WEIGHT_PRESETS, weightPreset, curtailFuel, zoneCurtailment, requirementStrip, POPULATION_RULE,
  // P2 market fixes: basis coverage gate, part years, curtailment sample, unstudied cases, cost sample, reconciliation
  basisZoneHeld, basisHubHeld, BASIS_NOT_HELD, FULL_YEAR_SHARE, persistence, sparkEnds, curtailSampleOk, curtailSampleText,
  CURTAIL_MIN_SAMPLE, unstudiedRequired, UNSTUDIED_EXCLUDED_REASON, marketServiceNote, zoneCostSummary, COST_STATUSES,
  reconcile, marketRankOf,
} from '../marketcore.js';
// S2-EM F014: land status beside every shortlist (unscreened = "land not screened", never clear).
import { landStatus, landScreenCount } from '../landcore.js';
import { stepCostService, perKw, applicableCases } from '../gridrules.js';
import * as TR from './market-trace.js';
import { fmt } from '../basis.js';
import { priceTierLabel } from '../prices.js';
import { shoulderRequired, SHOULDER_EXCLUDED_REASON } from '../marketcore.js';
import * as CH from '../charts.js';
import { pinButton } from '../ui.js';
import { ensureExtras, withMeasures, withCurtail, extra, extraError, extraLoading } from './market-data.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const kpi = (label, value, unit, note, nh = false) => `<div class="kpi${nh ? ' nh' : ''}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}${unit && !nh ? `<span class="unit">${esc(unit)}</span>` : ''}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`;
const kpiV = (label, v, f, unit, note) => (ok(v) ? kpi(label, f(v), unit, note) : kpi(label, 'not held', '', note, true));
// o.depth = the MINIMUM depth the card shows at (shell hides the rest); o.trace / o.chips feed the shell's card icons.
// Depth / trace / provenance per card title (one table rather than options scattered through long templates).
const CARD_META = {
  Ranking: { depth: 'screen', trace: 'm-rank' }, 'Headroom against price': { trace: 'm-rank' }, 'Score distribution': { trace: 'm-weights' },
  Sensitivity: { depth: 'study', trace: 'm-sens' }, 'Rank contributions': { depth: 'study', trace: 'm-rank' }, 'Basis persistence': {},
  'Buses that qualify, by project size': { depth: 'screen', trace: 'm-size' }, 'Margin distribution at your size': { trace: 'm-flips' },
  'Largest size each bus qualifies at': { trace: 'm-flips' }, 'Buses that flip between sizes': { depth: 'study', trace: 'm-flips' },
  'Case survival of the shortlist': { depth: 'study', chips: 'envelope-only' }, 'Zones by size': { trace: 'm-size' },
  'Zones side by side': { depth: 'screen', trace: 'm-regions' }, 'Zone basis against the hub, by year': { trace: 'm-basis' },
  'Negative real-time hours by zone and year': { trace: 'm-basis' }, 'Generation by fuel, by year': { trace: 'm-genmix' },
  'Forecast dispatch by fuel': { chips: 'studio-copy modelled' }, 'Henry Hub gas': { chips: 'studio-copy' }, 'System load': { trace: 'm-load' },
  'Supply by zone': { trace: 'm-supply' }, Retirements: { depth: 'study' }, 'Queue by zone and resource': { depth: 'study', trace: 'm-supply' },
  'Queue register by entry year': { chips: 'studio-copy' }, 'Zone crowding': { trace: 'm-regions' }, 'Network cost per kW by zone': { trace: 'm-cost' },
  'Data notes: unified database against the Studio copy': { depth: 'study', chips: 'studio-copy' },
  'Voltage classes': { trace: 'm-funnel' }, 'Qualifying buses by zone': { trace: 'm-funnel' },
};
// o.answer = the card's one computed sentence (HTML built here, data escaped): the first thing in the body (v6).
const card = (c, title, sub, body, o0 = {}) => { const o = { ...(CARD_META[title] || {}), ...o0 }; return `<section class="card ${c}" data-depth="${['screen', 'review', 'study'].includes(o.depth) ? o.depth : 'review'}"${o.trace ? ` data-trace="${o.trace}"` : ''}${o.chips ? ` data-chips="${o.chips}"` : ''}${o.id ? ` id="${o.id}"` : ''}><header class="card-h"><h3>${esc(title)}</h3>${sub ? `<span class="card-sub" title="${esc(sub)}">${esc(sub)}</span>` : ''}${o.tools ? `<div class="card-tools">${o.tools}</div>` : ''}</header><div class="card-b">${o.answer ? `<p class="card-answer">${o.answer}</p>` : ''}${body}</div>${o.foot ? `<footer class="card-f">${o.foot}</footer>` : ''}</section>`; };
const traceCard = parts => { const p = parts.filter(Boolean); return `<section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculations</h3><span class="card-sub">Formula, inputs, steps with numbers, a check and the working as CSV</span></header><div class="card-b"><p class="card-answer"><b>${p.length}</b> calculation${p.length === 1 ? '' : 's'} on this tab, each with its inputs, working and a check.</p>${p.join('')}</div></section>`; };
const B = v => `<b>${esc(v)}</b>`;
/** v6: every tab ends with one named next step (the shell's goto action). */
const nextStep = (stage, tab, words) => `<div class="next-step" style="display:flex;justify-content:flex-end;margin:6px 0 0"><button type="button" class="primary tiny" style="margin:0" data-act="goto" data-v="${stage}" data-tab="${tab}">Next: ${esc(words)} →</button></div>`;
const wait = (k, what) => (extraError(k) ? `<div class="notice error" role="alert">Could not load ${esc(what)} (${esc(extraError(k))}). The rest of the page still works.</div>` : `<div class="notice" role="status">Loading ${esc(what)} from the unified database…</div>`);
const n1 = v => (ok(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) : 'not held');
const n0 = v => (ok(v) ? Math.round(v).toLocaleString('en-US') : 'not held');
const pc = v => (ok(v) ? `${v.toFixed(0)}%` : 'not held');
const sgn = v => (ok(v) ? `${v < 0 ? '−' : v > 0 ? '+' : ''}$${Math.abs(v).toFixed(2)}` : 'not held');
const ZONES = ['ME', 'NH', 'VT', 'NEMA', 'WCMA', 'SEMA', 'RI', 'CT'];
const SETTLED = ['2020', '2021', '2022', '2023', '2024', '2025', '2026'];
const RUN_YEAR = { 2028: '5yr', 2030: 'pcr2030', 2035: 'pcr2035', 2040: 'pcr2040' };
const RAMP = ['var(--h1,#627083)', 'var(--h2,#6F829E)', 'var(--h3,#7C95BA)', 'var(--h4,#89A8D7)', 'var(--h5,#96BCF4)', 'var(--h6,#B1D0FD)', 'var(--h7,#D1E3FF)'];
const FUEL_GROUPS = [['Natural gas', ['Natural Gas']], ['Nuclear', ['Nuclear']], ['Hydro', ['Hydro']], ['Wind', ['Wind']], ['Solar', ['Solar']], ['Wood, refuse, landfill gas', ['Wood', 'Refuse', 'Landfill Gas']], ['Oil, coal, other, batteries', ['Oil', 'Coal', 'Other', 'Batteries']]];
const groupOf = f => (FUEL_GROUPS.find(g => g[1].includes(f)) || FUEL_GROUPS[6])[0];
const SHORT = { margin: 'Margin MW', preExist: 'Pre-existing', price: '2025 $', lowPrice: 'Low 2025 $', fcst2030: '2030 $', lowFcst2030: 'Low 2030 $', fcst2035: '2035 $', spread4h: 'TB4 2025', tb2: 'TB2 2025', tb8: 'TB8 2025', tb4_30: 'TB4 2030', solarRatio: 'Solar win. 25', solwin30: 'Solar win. 30', negHours: 'Neg. h 2025', h200: 'h >$200', volLow: 'Stability', volHigh: 'Volatility', basisZone: '|Basis| zone', congFree: '|Congestion|', strength: 'SC MVA', outlets: 'Outlets', voltage: 'kV', ownPrice: 'Own node' };
const CEIL = 1500; // the headroom study's ceiling: a 1,500 MW limit is a lower bound, not a measurement
// S2-D (W-B 2026-10-07): a D-008 `relinked` node is a borrowed price too; the words come from one home (prices.priceTierLabel).
const borrowedPrice = n => n.tier === 'relinked' || (n.tier === 'geo_proxy' && !(n.proxyKm < 0.05));
const tierText = n => priceTierLabel({ tier: n.tier, km: n.proxyKm, relinkMi: n.relinkMi, relinkedFrom: n.relinkedFrom });

export const MARKET = {
  key: 'market',
  question: 'Where should we investigate?',
  lede: 'Screen every ISO-NE bus against your requirements, rank the ones that qualify on your priorities, test how robust they are, and read the zones and the system behind them. Unknown stays unknown: a bus without evidence never passes and is never ranked.',
  tabs: [
    { id: 'find', label: 'Find locations' },
    { id: 'rank', label: 'Rank & compare' },
    { id: 'size', label: 'Size & robustness', labelFor: t => (t === 'datacenter' ? 'Import size & robustness' : 'Size & robustness') },
    { id: 'regions', label: 'Compare regions' },
  ],
  needsStudy: true,
};

/** The screening request from the shell state (M3: exported so live-bridge.js reads the same builder, not a copy). */
export function req(S) {
  const m = S.ui.mkt || {};
  // v5 screens: upgrade cost at the request size (all fuels); modelled curtailment (solar, wind, hybrid only).
  const cf = curtailFuel(S.tech);
  return { tech: S.tech, exportMW: Number(S.exportMW), importMW: Number(S.importMW), zones: m.zones?.length ? m.zones : null, minKv: Number(m.minKv || 0), useShoulder: shoulderRequired(m), maxPrice2025: ok(m.maxPrice) ? m.maxPrice : null, minPrice2025: ok(m.minPrice) ? m.minPrice : null, ownPriceNode: !!m.ownPrice,
    ...(ok(m.maxUpgrade) && m.maxUpgrade >= 0 ? { maxUpgradeMusd: m.maxUpgrade } : {}),
    ...(cf && ok(m.maxCurtail) && m.maxCurtail >= 0 ? { maxCurtailPct: m.maxCurtail, curtailRun: curtRun(S) } : {}),
    ...(unstudiedRequired(m) ? { requireUnstudied: true } : {}) };
}
const CURT_RUNS = ['pcr2030', 'pcr2035', 'pcr2040'];
const curtRun = S => (CURT_RUNS.includes(S.ui.mktCurtRun) ? S.ui.mktCurtRun : 'pcr2030');
const presetOf = S => (Object.keys(WEIGHT_PRESETS).includes(S.ui.mktPreset) ? S.ui.mktPreset : 'studio');
const reqSize = r => (r.tech === 'datacenter' ? r.importMW : r.exportMW);
const MEMO = new Map();
function memo(key, fn) { if (!MEMO.has(key)) { if (MEMO.size > 40) MEMO.clear(); MEMO.set(key, fn()); } return MEMO.get(key); }
const evals = (study, r) => memo(JSON.stringify(['ev', r]), () => evaluate(study, r));
const candidateNode = (study, S) => study.nodes.find(n => String(n.bus_id) === String(S.nodeId));

/** Weights: the user's per-technology slider values over the chosen preset (Studio profile, or Equal weights on the
 *  same criteria: plan decision #8); `wgen` resets them. Slider keys carry the preset, so switching never mixes them. */
const wKey = (S, k) => { const g = (S.ui.mkt || {}).wgen || 0, p = presetOf(S); return `w${g}${p === 'studio' ? '' : `_${p}`}_${S.tech}_${k}`; };
export function weights(S) {
  const m = S.ui.mkt || {}, d = weightPreset(S.tech, presetOf(S)), out = {};
  for (const k of Object.keys(MEASURES)) { const v = m[wKey(S, k)]; out[k] = ok(v) ? v : d[k] || 0; }
  return out;
}
const activeKeys = w => Object.keys(w).filter(k => w[k] > 0);
const evidence = study => `${fmt.int(study.nodes.length)} buses, unified database (read-only), the same source as Prices, Grid and Economics. Limits use the Grid page's rules. ${fmt.int(study.nodes.filter(borrowedPrice).length)} buses borrow a neighbouring node's price.`;

// ---------- Map (Studio 1.05 + price map 87): status, price by year, margin or basis ----------
function yearValue(n, y) {
  if (SETTLED.includes(String(y))) return n.m?.y?.[String(y)] ?? (String(y) === '2025' ? n.lmp_2025 : null);
  const run = RUN_YEAR[y];
  return run === 'pcr2030' ? (ok(n.lmp_2030) ? n.lmp_2030 : null) : n.m?.f?.[run] ?? null;
}
function colourSpec(S, ev) {
  const mode = S.ui.mktColor || 'status', y = S.ui.mktYear || '2025';
  if (mode === 'status') return { mode };
  const get = mode === 'price' ? e => yearValue(e.node, y) : mode === 'margin' ? e => e.margin : mode === 'tb4' ? e => MEASURES.spread4h.get(e) : mode === 'strength' ? e => (ok(e.node.sc_mva) ? e.node.sc_mva : null) : e => basisZoneHeld(e.node.m);
  const vals = ev.map(get).filter(ok), lo = quantile(vals, 0.02), hi = quantile(vals, 0.98);
  const unit = mode === 'margin' ? 'MW' : mode === 'strength' ? 'MVA' : '$/MWh';
  const label = mode === 'price' ? `${y} ${SETTLED.includes(y) ? 'settled RT' : `${RUN_YEAR[y]} run`} mean price` : mode === 'margin' ? 'Headroom margin at your size' : mode === 'tb4' ? 'TB4 spread 2025 (RT)' : mode === 'strength' ? 'Short-circuit strength' : 'Basis vs own zone (RT 2025, hour-matched)';
  return { mode, get, lo, hi, unit, label, held: vals.length };
}
function map(ev, S) {
  // Shared map (geomap.js): the live basemap under the screened buses, ISO-NE extent, zoom/pan and hover from ui.mountMaps.
  const L = { met: true, unknown: true, unmet: true, ...(S.ui.mapLayers || {}) }, sel = String(S.ui.mapBus || ''), cs = colourSpec(S, ev);
  const fill = e => { if (cs.mode === 'status') return null; const v = cs.get(e); return ok(v) && ok(cs.lo) && ok(cs.hi) ? rampColor(v, cs.lo, cs.hi) : 'var(--gm-nh)'; };
  const tip = e => `<b>${esc(e.node.name)}</b> · ${e.node.bus_id}<br>${esc(e.node.zone)} · ${ok(e.node.kv) ? e.node.kv + ' kV' : 'kV not held'}<br>${{ met: 'Meets', unknown: 'Unknown', unmet: 'Does not meet', excluded: 'Outside zones' }[e.status]}${ok(e.margin) ? ` · margin ${e.margin.toFixed(0)} MW` : ''}${cs.mode !== 'status' ? `<br>${esc(cs.label)}: ${ok(cs.get(e)) ? cs.get(e).toFixed(cs.unit === '$/MWh' ? 2 : 0) + ' ' + cs.unit : cs.mode === 'basis' ? BASIS_NOT_HELD : 'not held'}` : ''}`;
  const pt = (e, r, cls) => ({ lon: e.node.lon, lat: e.node.lat, r, cls, fill: cls.startsWith('m-') && !['m-hl', 'm-sel'].includes(cls) ? fill(e) : null, tip: tip(e), act: 'map-bus', v: e.node.bus_id });
  const order = ['excluded', 'unmet', 'unknown', 'met'].filter(k => k === 'excluded' || L[k]);
  const points = order.flatMap(k => ev.filter(e => e.status === k).map(e => pt(e, k === 'met' ? 3.4 : 2.6, `m-${k}`)));
  const marks = [...ev.filter(e => String(e.node.bus_id) === String(S.nodeId)).map(e => ({ ...pt(e, 7, 'm-hl'), label: `${e.node.name} (candidate)` })), ...ev.filter(e => String(e.node.bus_id) === sel && sel !== String(S.nodeId)).map(e => ({ ...pt(e, 9, 'm-sel'), label: `${e.node.name} (selected)` }))];
  const toggles = [['met', 'Meets', 'var(--s1)'], ['unknown', 'Unknown', 'transparent'], ['unmet', 'Does not meet', 'var(--border-3)']].map(([k, l, c]) => `<label class="inline-check" style="margin:0 10px 0 0"><input type="checkbox" data-act="map-layer" data-k="${k}" ${L[k] ? 'checked' : ''}><span class="gm-sw" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c};border:1px solid var(--ink-4)"></span> ${l} (${fmt.int(ev.filter(e => e.status === k).length)})</label>`).join('');
  const fmtR = v => (cs.unit === '$/MWh' ? sgn(v) : `${n0(v)} ${cs.unit}`);
  const legend = cs.mode === 'status'
    ? { items: [{ label: 'Meets', fill: 'var(--s1)' }, { label: 'Unknown (evidence missing)', fill: 'var(--surface-2)' }, { label: 'Does not meet', fill: '#5a6b85' }, { label: 'Outside zones', fill: 'var(--border)' }] }
    : { ramp: { lo: cs.lo, hi: cs.hi, fmt: fmtR, label: `${cs.label} · P2–P98 · ${fmt.int(cs.held)} held` }, nh: true };
  const markLegend = geoLegend({ items: [{ label: 'Candidate bus (ring)', fill: 'var(--s2)' }, { label: 'Selected bus (white ring, labelled)', fill: 'var(--ink)' }] });
  return `<div class="chip-row" style="display:flex;flex-wrap:wrap;align-items:center">${toggles}</div>
    ${geoMap({ id: 'market', width: 900, height: 520, fit: { points: ev.map(e => ({ lon: e.node.lon, lat: e.node.lat })), padMi: 12 }, title: 'Map of screened buses', layers: [{ kind: 'points', points }, { kind: 'points', points: marks }], legend })}${markLegend}`;
}
function mapTools(S) {
  const mode = S.ui.mktColor || 'status', y = S.ui.mktYear || '2025';
  const years = [...SETTLED, ...Object.keys(RUN_YEAR)];
  return `<select data-act="ui" data-k="mktColor" aria-label="Colour the buses by">${[['status', 'Colour: status'], ['price', 'Colour: price'], ['margin', 'Colour: margin'], ['basis', 'Colour: basis vs zone'], ['tb4', 'Colour: TB4 spread 2025'], ['strength', 'Colour: short-circuit MVA']].map(([v, l]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${l}</option>`).join('')}</select>${mode === 'price' ? `<select data-act="ui" data-k="mktYear" aria-label="Price year">${years.map(v => `<option value="${v}" ${y === v ? 'selected' : ''}>${v}${SETTLED.includes(v) ? (v === '2026' ? ' RT (part year)' : ' RT') : ` ${RUN_YEAR[v]}`}</option>`).join('')}</select>` : ''}`;
}

/** v6 "Requirements at bus" (live Studio): every requirement and the context measures against all ISO-NE buses. */
function requirementsAtBus(ev, S, study, r) {
  const e = ev.find(z => String(z.node.bus_id) === String(S.ui.mapBus || S.nodeId));
  if (!e) return { answer: 'No bus is selected: click a bus on the map, or "Show" in a table.', body: '<div class="empty"><strong>No bus selected</strong>Click a bus on the map, or "Show" in a table.</div>' };
  const n = e.node, st = memo(JSON.stringify(['strip', n.bus_id, r]), () => requirementStrip(study, ev, e, r));
  const ys = SETTLED.map(y => n.m?.y?.[y] ?? null);
  const word = { pass: 'met', fail: 'not met', unknown: 'unknown', excluded: 'outside the zones' };
  const answer = st.excluded ? `${B(n.name)} is outside the selected zones, so it is not screened.`
    : `${B(n.name)} meets ${B(`${st.met} of ${st.n}`)} requirement${st.n === 1 ? '' : 's'}${st.unknown ? `; ${B(st.unknown)} unknown (never counted as met)` : ''}${st.fail ? `; ${B(st.fail)} not met` : ''}.${st.checks.some(c => c.withUpgrade) ? ' A headroom shortfall is admitted on the upgrade-cost ceiling.' : ''}`;
  const others = st.others.filter(c => c.key !== 'zone').map(c => `<tr><td class="wrap">${esc(c.label)}</td><td><span class="pill ${c.status === 'pass' ? 'good' : c.status === 'fail' ? 'warn' : ''}">${esc(word[c.status] || c.status)}</span> <span class="audit-note">${esc(c.note || (c.value ?? ''))}</span></td></tr>`).join('');
  const body = `<div class="audit-note" style="margin:0 0 6px">${n.bus_id} · ${esc(n.zone)} · ${esc(n.county || '')} ${esc(n.state || '')} · price ${esc(tierText(n))}${String(n.bus_id) === String(S.nodeId) ? ' · candidate' : ''} · RT 2020–26 ${CH.sparkline(ys, { width: 90, height: 16 })}${(() => { const se = sparkEnds(n, SETTLED); return se.part.length ? ` <span title="${esc(se.text)}">* part year ${esc(se.part.join(', '))}</span>` : ''; })()}</div>
    ${st.rows.length ? CH.percentileStrip(st.rows) : ''}
    ${others ? `<div class="table-wrap"><table class="dense"><tbody>${others}</tbody></table></div>` : ''}
    ${e.unknown.length ? `<p class="audit-note" style="margin:4px 0 0">Unknown: ${e.unknown.map(esc).join(' · ')}</p>` : ''}
    ${e.unscreened?.length ? `<p class="audit-note" style="margin:4px 0 0">Not screened: ${e.unscreened.map(esc).join(' · ')} (not studied; Grid and Decision hold them)</p>` : ''}
    <div class="actions">${pinButton(n.bus_id, S)} <button class="primary tiny" data-act="pick-bus" data-v="${n.bus_id}">Analyse in Grid, Prices and Economics</button></div>`;
  return { answer, body };
}

function selectedCard(ev, S, study) {
  const e = ev.find(z => String(z.node.bus_id) === String(S.ui.mapBus || S.nodeId));
  if (!e) return '<div class="empty"><strong>No bus selected</strong>Click a bus on the map, or "Show" in a table.</div>';
  const n = e.node, lims = serviceLimits(study, n, S.tech), m = n.m || {};
  const ys = SETTLED.map(y => m.y?.[y] ?? null);
  return `<h4 style="margin:0;font-size:13px">${esc(n.name)} <span class="audit-note">${n.bus_id} · ${esc(n.zone)} · ${esc(n.county || '')} ${esc(n.state || '')}${String(n.bus_id) === String(S.nodeId) ? ' · candidate' : ''}</span></h4>
    <div class="table-wrap"><table class="dense"><tbody>
      <tr><td>Status</td><td class="wrap">${esc({ met: 'Meets requirements', unknown: 'Unknown (evidence missing)', unmet: 'Does not meet', excluded: 'Outside selected zones' }[e.status])}</td></tr>
      ${lims.map(l => `<tr><td>${esc(l.label)}</td><td class="wrap">${ok(l.value) ? fmt.mw(l.value) : 'not held'} <span class="audit-note">${esc(l.basis)}</span></td></tr>`).join('')}
      <tr><td>RT price 2020–26</td><td>${CH.sparkline(ys, { width: 110, height: 20 })} <span class="audit-note">${esc(sparkEnds(n, SETTLED).text)}</span></td></tr>
      <tr><td>2025 average (RT)</td><td>${fmt.price(n.lmp_2025)}/MWh <span class="audit-note">${esc(n.pnode || '')} · ${esc(tierText(n))}${m.n?.['2025'] ? ` · ${n0(m.n['2025'])} h only` : ''}</span></td></tr>
      <tr><td>2030 (pcr2030)</td><td>${ok(n.lmp_2030) ? fmt.price(n.lmp_2030) + '/MWh' : `not held${n.lmp2030Reported === 0 ? ' (run node unpriced: LMP 0 every hour)' : ''}`}</td></tr>
      <tr><td>Basis vs zone / hub</td><td>${ok(basisZoneHeld(n.m)) ? `${sgn(basisZoneHeld(n.m))} / ${sgn(basisHubHeld(n.m))} <span class="audit-note">RT 2025, hour-matched</span>` : `<span class="audit-note">${esc(BASIS_NOT_HELD)}</span>`}</td></tr>
      <tr><td>Short-circuit · outlets</td><td>${ok(n.sc_mva) ? fmt.int(n.sc_mva) + ' MVA' : 'not held'} · ${ok(m.outlets) ? n0(m.outlets) : 'not held'}</td></tr>
      ${e.reasons.length ? `<tr><td>Fails on</td><td class="wrap">${e.reasons.map(esc).join('<br>')}</td></tr>` : ''}
      ${e.unknown.length ? `<tr><td>Unknown</td><td class="wrap">${e.unknown.map(esc).join('<br>')}</td></tr>` : ''}
      ${e.unscreened?.length ? `<tr><td>Not screened</td><td class="wrap">${e.unscreened.map(esc).join('<br>')} <span class="audit-note">not studied (Grid and Decision hold them)</span></td></tr>` : ''}
    </tbody></table></div>
    <div class="actions">${pinButton(n.bus_id, S)} <button class="primary tiny" data-act="pick-bus" data-v="${n.bus_id}">Analyse in Grid, Prices and Economics</button></div>`;
}

function requirementsCard(S, ev) {
  const m = S.ui.mkt || {}, zones = m.zones || [];
  // Rarely changed screens sit under "More options"; the panel opens itself while any of them is set (the shell
  // does not keep a details element's open state across re-renders).
  const injects = S.tech !== 'datacenter';
  const moreSet = [shoulderRequired(m), !!m.ownPrice, ok(m.maxUpgrade), ok(m.maxCurtail) && !!curtailFuel(S.tech), injects && unstudiedRequired(m)].filter(Boolean).length;
  const inScope = ev.filter(e => e.status !== 'excluded').length, met = ev.filter(e => e.status === 'met').length;
  const answer = `${B(fmt.int(met))} of ${B(fmt.int(inScope))} buses in scope meet the request (${zones.length ? `${esc(zones.join(', '))}, ` : 'all zones, '}${Number(m.minKv) ? `${esc(m.minKv)} kV and above` : 'any voltage'}${ok(m.minPrice) || ok(m.maxPrice) ? `, 2025 price ${ok(m.minPrice) ? `≥ $${esc(m.minPrice)}` : ''}${ok(m.minPrice) && ok(m.maxPrice) ? ' and ' : ''}${ok(m.maxPrice) ? `≤ $${esc(m.maxPrice)}` : ''}` : ''}, ${esc(fmt.mw(reqSize(req(S))))})${moreSet ? ` (plus ${moreSet} more screen${moreSet === 1 ? '' : 's'})` : ''}${injects && !unstudiedRequired(m) ? '; light-load and minimum-load cases are not screened (not studied)' : ''}.`;
  return card('c-12', 'Requirements', `${S.tech} · export ${fmt.mw(Number(S.exportMW))}${Number(S.importMW) ? ` · import ${fmt.mw(Number(S.importMW))}` : ''} (from the project strip)`,
    `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center">
      <div class="checks" role="group" aria-label="Zones" style="padding:0">${ZONES.map(z => `<label class="year" style="padding:4px 8px;font-size:12px"><input type="checkbox" data-act="mkt-zone" value="${z}" ${zones.includes(z) ? 'checked' : ''}>${z}</label>`).join('')}<span class="audit-note" style="align-self:center">${zones.length ? '' : 'All zones'}</span></div>
      <label class="field" style="grid-template-columns:auto 130px;align-items:center;display:grid">Min. voltage<select data-act="mkt" data-k="minKv">${[0, 69, 115, 230, 345].map(v => `<option value="${v}" ${Number(m.minKv || 0) === v ? 'selected' : ''}>${v ? `${v} kV and above` : 'Any'}</option>`).join('')}</select></label>
      <label class="field" style="grid-template-columns:auto 90px;align-items:center;display:grid">2025 price ≥<input type="number" step="1" data-act="mkt" data-k="minPrice" value="${ok(m.minPrice) ? m.minPrice : ''}" placeholder="none"></label>
      <label class="field" style="grid-template-columns:auto 90px;align-items:center;display:grid">2025 price ≤<input type="number" step="1" data-act="mkt" data-k="maxPrice" value="${ok(m.maxPrice) ? m.maxPrice : ''}" placeholder="none"></label></div>
    <details class="more-ctl"${moreSet ? ' open' : ''}><summary>More options${moreSet ? ` (${moreSet} set)` : ''}</summary>
    <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:6px">
      <label class="inline-check" title="${esc(SHOULDER_EXCLUDED_REASON)}"><input type="checkbox" data-act="mkt-shoulder" ${shoulderRequired(m) ? 'checked' : ''}> Require the shoulder export case (vendor envelope only: with it required, every bus is Unknown under D6.1)</label>
      <label class="inline-check"><input type="checkbox" data-act="mkt-own" ${m.ownPrice ? 'checked' : ''}> Require own price node</label>
      ${injects ? `<label class="field" style="grid-template-columns:auto 260px;align-items:center;display:grid" title="${esc(UNSTUDIED_EXCLUDED_REASON)}">Light-load and minimum-load cases<select data-act="mkt" data-k="unstudied" aria-label="Light-load and minimum-load cases"><option value="0" ${unstudiedRequired(m) ? '' : 'selected'}>Not screened (default)</option><option value="1" ${unstudiedRequired(m) ? 'selected' : ''}>Required: every bus Unknown (D6.1)</option></select></label>` : ''}</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:6px">
      <label class="field" style="grid-template-columns:auto 90px auto;align-items:center;display:grid" title="Grid upgrade cost at your request size (the Grid page's engine). Pass: no upgrades indicated (envelope only, not a verified $0), true $0, or priced ≤ X. A partly priced or lower-bound cost stays unknown unless its priced part already exceeds X.">No upgrades indicated, or priced ≤ $<input type="number" step="1" min="0" data-act="mkt" data-k="maxUpgrade" value="${ok(m.maxUpgrade) ? m.maxUpgrade : ''}" placeholder="off"><span>M</span></label>
      ${curtailFuel(S.tech) ? `<label class="field" style="grid-template-columns:auto 70px auto;align-items:center;display:grid" title="Energy-weighted curtailed share of the PCR run's modelled ${curtailFuel(S.tech).toLowerCase()} resources within 25 km (unified DB). No resource nearby = unknown, never a pass.">Modelled ${curtailFuel(S.tech).toLowerCase()} curtailment nearby ≤<input type="number" step="0.5" min="0" data-act="mkt" data-k="maxCurtail" value="${ok(m.maxCurtail) ? m.maxCurtail : ''}" placeholder="off"><span>%</span></label>
      <select data-act="ui" data-k="mktCurtRun" aria-label="Curtailment run">${CURT_RUNS.map(r => `<option value="${r}" ${curtRun(S) === r ? 'selected' : ''}>${r}</option>`).join('')}</select>` : `<span class="audit-note" style="margin:0">Curtailment screen: not applicable to ${S.tech === 'datacenter' ? 'a data centre (a load is not curtailed)' : 'storage (a battery chooses when to charge and discharge)'}.</span>`}</div></details>`,
    { depth: 'screen', answer, chips: ok(m.maxCurtail) && curtailFuel(S.tech) ? 'modelled' : '', foot: `${shoulderRequired(m) ? 'Shoulder export case required: it rests on the vendor envelope only (D6.1), so every bus is Unknown on it.' : `Default: ${SHOULDER_EXCLUDED_REASON}.`} Storage charging at shoulder is always required. ${injects ? (unstudiedRequired(m) ? 'Light-load and minimum-load cases required: not studied, so every bus is Unknown on them (D6.1). ' : `Not screened: ${esc(UNSTUDIED_EXCLUDED_REASON)}. `) : ''}Prices are $/MWh, settled real-time 2025 at the bus's price node. With a cost ceiling set, a bus short of headroom is judged on its upgrade cost instead. ${esc(marketServiceNote(S.tech))}` });
}

const KV_CLASSES = [['< 69 kV', v => v < 69], ['69–114 kV', v => v >= 69 && v < 115], ['115–229 kV', v => v >= 115 && v < 230], ['230–344 kV', v => v >= 230 && v < 345], ['≥ 345 kV', v => v >= 345]];

// ---------- Tab 1: Find locations ----------
/** F014: a shortlist cell for land: fits* / does not fit / land not screened (not held). */
const landCell = (data, S, r, id) => { const l = landStatus(data.land, id, S.tech, reqSize(r)); return `<td class="${l.status === 'missing' ? 'nh' : ''}" data-land="${esc(l.status)}" title="${esc(l.fit?.caveat || 'No exclusion screen for this bus: buildable area unknown, never assumed clear')}">${esc(l.label)}</td>`; };
function tabFind({ S, data }) {
  const study = data.study, r = req(S), ev = evals(study, r);
  const met = ev.filter(e => e.status === 'met'), unk = ev.filter(e => e.status === 'unknown'), unmet = ev.filter(e => e.status === 'unmet'), excl = ev.filter(e => e.status === 'excluded');
  const f = memo(JSON.stringify(['funnel', r]), () => funnel(study, r)), mx = memo(JSON.stringify(['matrix', r]), () => requirementMatrix(study, r));
  const top = met.slice().sort((a, b) => (b.margin ?? -1) - (a.margin ?? -1)).slice(0, 20);
  const own = met.filter(e => !borrowedPrice(e.node)).length;
  const cand = candidateNode(study, S);
  const upOn = ok(r.maxUpgradeMusd), cuOn = ok(r.maxCurtailPct), cf = curtailFuel(S.tech);
  const rows = top.map(e => { const n = e.node, m = n.m || {}; return `<tr><td>${esc(n.name)} <span class="audit-note">${n.bus_id}</span></td><td>${esc(n.zone)}</td><td class="num">${fmt.int(n.kv)}</td><td class="num">${ok(e.margin) && e.margin + reqSize(r) >= CEIL ? `≥ ${fmt.mw(e.margin)} <span class="audit-note" title="Limit at the study ceiling (1,500 MW): a lower bound">ceiling</span>` : fmt.mw(e.margin)}</td><td class="num">${fmt.price(n.lmp_2025)}</td><td>${CH.sparkline(SETTLED.map(y => m.y?.[y] ?? null), { width: 70, height: 16 })}</td><td class="num">${fmt.price(n.lmp_2030)}</td><td class="num"${ok(basisZoneHeld(m)) ? '' : ` title="${esc(BASIS_NOT_HELD)}"`}>${ok(basisZoneHeld(m)) ? sgn(basisZoneHeld(m)) : 'not held'}</td><td>${esc(tierText(n))}</td>${landCell(data, S, r, n.bus_id)}${upOn ? `<td class="num" title="${esc(e.upgrade?.label || '')}">${esc(!e.upgrade ? 'not held' : e.upgrade.kind === 'No upgrades indicated' ? 'none indicated (envelope)' : e.upgrade.kind === 'True zero' ? 'true $0' : `${e.upgrade.kind === 'Priced' ? '' : '≥ '}$${(e.upgrade.value ?? 0).toFixed(1)}M`)}</td>` : ''}${cuOn ? `<td class="num" title="${esc(e.curtail?.note || '')}">${ok(e.curtail?.value) ? `${e.curtail.value.toFixed(1)}% <span class="audit-note">n ${fmt.int(e.curtail.sample)}${e.curtail.status === 'unknown' ? ', thin' : ''}</span>` : 'not held'}</td>` : ''}<td>${pinButton(n.bus_id, S)} <button class="tiny" data-act="map-bus" data-v="${n.bus_id}">Show</button> <button class="tiny" data-act="pick-bus" data-v="${n.bus_id}">Analyse</button></td></tr>`; }).join('');
  const kvInScope = KV_CLASSES.map(([l, t]) => ({ label: l, values: [ev.filter(e => e.status !== 'excluded' && ok(e.node.kv) && t(e.node.kv)).length, met.filter(e => ok(e.node.kv) && t(e.node.kv)).length] }));
  const byZone = ZONES.map(z => ({ label: z, values: [met.filter(e => e.node.zone === z).length, unk.filter(e => e.node.zone === z).length] }));
  // v6 answers (computed sentences)
  const rab = requirementsAtBus(ev, S, study, r), cs = colourSpec(S, ev);
  const wF = weights(S), kF = activeKeys(wF), rkF = memo(JSON.stringify(['rank', r, wF]), () => rank(ev, kF, wF)), recF = reconcile(ev, rkF);
  const drop = f.steps.slice(1).map(s => ({ ...s, lost: s.fail + s.unknown + s.excluded })).sort((a, b) => b.lost - a.lost)[0];
  const worstReq = mx.filter(x => x.key !== 'zone').sort((a, b) => (b.fail + b.unknown) - (a.fail + a.unknown))[0];
  const kvBest = kvInScope.filter(k => k.values[1] > 0).sort((a, b) => b.values[1] - a.values[1])[0];
  const zBest = byZone.slice().sort((a, b) => b.values[0] - a.values[0])[0];
  const aMap = `${B(fmt.int(met.length))} buses meet your requirements and ${B(fmt.int(unk.length))} are unknown${cs.mode === 'status' ? '' : `; colour shows ${esc(cs.label.toLowerCase())} (${fmt.int(cs.held)} buses hold it)`}.`;
  const aFunnel = drop ? `Most buses drop out at ${B(drop.label.replace(/ limit ≥.*$/, ''))} (${B(fmt.int(drop.lost))} fail or lack evidence); ${B(fmt.int(f.steps.at(-1).remain))} remain.` : 'No requirement is set beyond the bus list.';
  const aMatrix = worstReq ? `${B(worstReq.label.replace(/ limit ≥.*$/, ''))} is the hardest requirement: ${B(fmt.int(worstReq.fail))} fail and ${B(fmt.int(worstReq.unknown))} unknown of ${fmt.int(worstReq.applies)}.` : 'No requirement applies.';
  const aKv = kvBest ? `Most qualifying buses are at ${B(kvBest.label)} (${B(fmt.int(kvBest.values[1]))} of ${fmt.int(met.length)}).` : 'No bus qualifies in any voltage class.';
  const aZone = zBest && zBest.values[0] ? `${B(zBest.label)} has the most qualifying buses (${B(fmt.int(zBest.values[0]))}).` : 'No zone has a qualifying bus.';
  const aTop = top[0] ? `${B(top[0].node.name)} has the most headroom: ${B(fmt.mw(top[0].margin))} above ${esc(fmt.mw(reqSize(r)))}${top[0].margin + reqSize(r) >= CEIL ? ' (a lower bound at the study ceiling)' : ''}.` : 'No bus qualifies, so nothing is listed.';
  return `${requirementsCard(S, ev)}
    <div class="kpis">
      ${kpi('Meet requirements', fmt.int(met.length), 'buses', `of ${fmt.int(ev.length - excl.length)} in scope`)}
      ${kpi('Unknown', fmt.int(unk.length), 'buses', 'Evidence missing: never counted as passing')}
      ${kpi('Do not meet', fmt.int(unmet.length), 'buses', f.steps.slice(1).sort((a, b) => b.fail - a.fail)[0]?.label || '')}
      ${kpi('Outside zones', fmt.int(excl.length), 'buses', r.zones ? r.zones.join(', ') : 'No zone filter')}
      ${kpiV('Median margin', median(met.map(e => e.margin)), v => n0(v), 'MW', 'Qualifying buses, at your size')}
      ${kpi('Own price node', fmt.int(own), 'buses', `of ${fmt.int(met.length)} qualifying; the rest borrow a price`)}
      ${(() => { const lc = landScreenCount(data.land, met.map(e => e.node)); return data.land ? kpi('Land screen held', `${fmt.int(lc.held)} of ${fmt.int(lc.of)}`, '', 'Qualifying buses with an exclusion screen; the rest are "land not screened" (not held, never clear). Land is not a requirement in this count.') : kpi('Land screen held', 'loading', '', 'Reading data/land.json', true); })()}
    </div>
    <p class="audit-note m-recon" data-recon="find" style="margin:2px 0 6px">${esc(recF.text)}. Funnel steps are sequential, so a bus is counted at the first requirement it fails or lacks.</p>
    ${met.length ? '' : '<div class="empty"><strong>No locations meet these requirements.</strong>Relax a requirement; excluded buses are never ranked instead.</div>'}
    <div class="cards">
      ${card('c-8 r-2', 'Where the candidates are', 'Every geolocated ISO-NE bus; click a bus to inspect it', map(ev, S), { depth: 'screen', trace: 'm-find', tools: mapTools(S), answer: aMap, foot: 'Scroll to zoom, drag to pan. Ring = the candidate bus; white ring = the selected bus. Price colours: settled RT means (mart_bus_year) or the named forecast run (mart_bus_fcst_year).' })}
      ${card('c-4 r-2', 'Requirements at bus', 'This bus against every ISO-NE bus: P5–P95 band, median, your requirement', rab.body, { depth: 'screen', trace: 'm-find', answer: rab.answer, chips: cand && borrowedPrice(cand) ? 'geo-proxy' : '', foot: `${POPULATION_RULE} Other rows: every bus holding the measure (unified DB). Rows without a requirement are context and never count as met. Fuel rows follow the technology.` })}
      ${card('c-4', 'Qualifying funnel', 'Requirements applied in order; each bar is what remains', CH.barChart(f.steps.map(s => ({ label: s.label.replace(/ limit ≥.*$/, '').slice(0, 22), value: s.remain })), { fmt: v => fmt.int(v), title: 'Qualifying funnel', height: 170, xLabel: 'Step', yLabel: 'Buses remaining' }) + `<div class="table-wrap"><table class="dense"><thead><tr><th>Step</th><th class="num">Fail</th><th class="num">Unknown</th><th class="num">Left</th></tr></thead><tbody>${f.steps.slice(1).map(s => `<tr><td class="wrap">${esc(s.label)}</td><td class="num">${fmt.int(s.fail + s.excluded)}</td><td class="num">${fmt.int(s.unknown)}</td><td class="num">${fmt.int(s.remain)}</td></tr>`).join('')}</tbody></table></div>`, { trace: 'm-funnel', answer: aFunnel })}
      ${card('c-4', 'Requirements met, not met, unknown', 'Each requirement on its own, over the buses in scope', CH.stackedBar(mx.filter(x => x.key !== 'zone').map(x => ({ label: x.label.replace(/ limit ≥.*$/, '').slice(0, 20), values: [x.pass, x.fail, x.unknown] })), { series: ['Pass', 'Fail', 'Unknown'], fmt: v => fmt.int(v), title: 'Requirement matrix', height: 180, xLabel: 'Requirement' }), { trace: 'm-funnel', answer: aMatrix, foot: 'A bus meets only when every row passes. Unknown = the evidence is not published (no violations list, limit not published, not studied, price not held).' })}
      ${card('c-4', 'Voltage classes', 'Buses in scope and those that meet, by nominal kV (Studio 1.07)', CH.groupedBar(kvInScope, { series: ['In scope', 'Meet'], fmt: v => fmt.int(v), title: 'Voltage classes', height: 170, xLabel: 'Voltage' }), { answer: aKv, foot: `${fmt.int(ev.filter(e => e.status !== 'excluded' && !ok(e.node.kv)).length)} buses in scope have no nominal voltage.` })}
      ${card('c-4', 'Qualifying buses by zone', 'Meet and unknown counts per load zone', CH.groupedBar(byZone, { series: ['Meet', 'Unknown'], fmt: v => fmt.int(v), title: 'Qualifying by zone', height: 170, xLabel: 'Zone' }), { answer: aZone, foot: 'Counts only: headroom is never summed across buses (they share limiting facilities).' })}
      ${card('c-8', 'Top candidates by margin', `The 20 qualifying buses with the most headroom above ${fmt.mw(reqSize(r))}`, `<div class="table-wrap"><table class="dense sortable"><thead><tr><th>Bus</th><th>Zone</th><th class="num">kV</th><th class="num">Margin</th><th class="num">2025 RT</th><th>RT 2020–26</th><th class="num">2030 pcr2030</th><th class="num">Basis vs zone</th><th>Price source</th><th title="Habitat/protected screen at your size; * = upper bound">Land</th>${upOn ? `<th class="num">Upgrade cost ≤ ${r.maxUpgradeMusd}M</th>` : ''}${cuOn ? `<th class="num">${cf} curtailed ${r.curtailRun}</th>` : ''}<th></th></tr></thead><tbody>${rows || '<tr><td colspan="12">No qualifying bus.</td></tr>'}</tbody></table></div>`, { depth: 'review', trace: 'm-find', answer: aTop, foot: `Prices $/MWh. Basis vs zone = RT 2025 hour-matched mean of (bus node − own load-zone node). ${evidence(study)}` })}
      ${card('c-4', 'Selected bus: details', 'Limits, prices and why it passes or fails (the strip as a table)', selectedCard(ev, S, study), { depth: 'review', trace: 'm-find', answer: rab.answer, chips: cand && borrowedPrice(cand) ? 'geo-proxy' : '' })}
      ${screenCards(study, S, r, ev, cand)}
      ${traceCard([TR.traceFind(data, S, ev, cand ? serviceLimits(study, cand, S.tech) : [], r), TR.traceFunnel(f, ev, r), upOn ? TR.traceUpgrade(ev, r, S) : '', cf && study.curtail ? TR.traceCurtail(study, S, curtRun(S), cf, zoneCurtailment(study.curtail.rows, curtRun(S)), r.maxCurtailPct) : ''])}
    </div>
    ${nextStep('market', 'rank', 'rank the qualifying buses in Market › Rank & compare')}`;
}

/** v5: the upgrade-cost screen and the modelled-curtailment screen, each with its evidence. */
function screenCards(study, S, r, ev, cand) {
  const inScope = ev.filter(e => e.status !== 'excluded');
  let up;
  if (!ok(r.maxUpgradeMusd)) up = card('c-6', 'Upgrade-cost screen', 'off: set "No upgrades indicated, or priced ≤ $X M" in Requirements', '<div class="empty"><strong>Screen off</strong>With a ceiling set, each bus is judged on the Grid page\'s upgrade cost at your request size: no upgrades indicated (envelope only, never shown as $0), true $0 or priced ≤ X pass; a partly priced or lower-bound cost stays unknown.</div>', { answer: 'The upgrade-cost screen is off; set a ceiling under More options in Requirements to judge buses on their upgrade cost.' });
  else {
    const kinds = ['True zero', 'No upgrades indicated', 'Priced', 'Partly priced', 'Lower bound'];
    const cnt = (k, st) => inScope.filter(e => e.upgrade?.kind === k && e.upgrade.status === st).length;
    const groups = kinds.map(k => ({ label: k, values: ['pass', 'unknown', 'fail'].map(st => cnt(k, st)) })).filter(g => g.values.some(v => v));
    const c = cand ? ev.find(e => e.node === cand) : null;
    up = card('c-6', `Upgrade-cost screen: ≤ $${r.maxUpgradeMusd}M`, `${fmt.int(inScope.filter(e => e.upgrade?.status === 'pass').length)} of ${fmt.int(inScope.length)} buses in scope pass · Grid cost at ${fmt.mw(reqSize(r))}`,
      `${CH.stackedBar(groups, { series: ['Pass', 'Unknown', 'Fail'], fmt: v => fmt.int(v), title: 'Upgrade-cost screen by cost status', height: 180, xLabel: 'Cost status' })}<p class="audit-note" style="margin:4px 0 0">Candidate ${esc(cand?.name || 'not in the screen')}: ${esc(c?.upgrade ? `${c.upgrade.label} → ${c.upgrade.status}` : 'not held')}</p>`,
      { trace: 'm-upgrade', answer: `${B(fmt.int(inScope.filter(e => e.upgrade?.status === 'pass').length))} of ${B(fmt.int(inScope.length))} buses pass at ≤ $${esc(r.maxUpgradeMusd)}M; ${B(fmt.int(inScope.filter(e => e.upgrade?.status === 'unknown').length))} stay unknown (partly priced or a lower bound).`, chips: inScope.some(e => e.upgrade?.kind === 'No upgrades indicated') ? 'envelope-only' : '', foot: '"No upgrades indicated" rests on the vendor envelope only and is never a verified $0. A screening cost, not an allocated upgrade bill.' });
  }
  const cf = curtailFuel(S.tech);
  if (!cf) return up + card('c-6', 'Curtailment screen', `Not applicable to ${S.tech === 'datacenter' ? 'a data centre' : 'storage'}`, `<div class="empty"><strong>Not applicable to ${S.tech === 'datacenter' ? 'a data centre' : 'storage'}</strong>${S.tech === 'datacenter' ? 'A load is not curtailed; its exposure is the price it pays (Prices, Economics).' : 'A battery chooses when to charge and discharge; its limit is the shoulder charge case (Grid).'}</div>`, { depth: 'review', answer: `Curtailment does not apply to ${S.tech === 'datacenter' ? 'a data centre' : 'storage'}.` });
  if (!study.curtail) return up + card('c-6', 'Curtailment screen', 'PCR runs, unified database', wait('curtail', 'the curtailment extract'), { answer: 'The modelled curtailment extract is still loading.' });
  const run = curtRun(S), zr = zoneCurtailment(study.curtail.rows, run).filter(z => z.type === cf), iso = zr.find(z => z.zone === 'ISO');
  const v = cand?.curt?.[run]?.[cf];
  const zones = ZONES.map(z => zr.find(x => x.zone === z) || { zone: z, share: null, n: 0 });
  const body = `${CH.barChart(zones.map(z => ({ label: z.zone, value: ok(z.share) ? 100 * z.share : null, note: `${z.n} resources` })), { fmt: x => `${x.toFixed(1)}%`, title: `Modelled ${cf.toLowerCase()} curtailment by zone, ${run}`, height: 160, xLabel: 'Zone', yLabel: 'Curtailed share' })}
    <div class="table-wrap"><table class="dense"><thead><tr><th>Where</th><th class="num">Resources</th><th class="num">Offered GWh</th><th class="num">Curtailed</th><th class="num">Hours curtailed</th></tr></thead><tbody>
      <tr class="hl"><td>Within 25 km of ${esc(cand?.name || 'the candidate')}</td><td class="num">${v ? fmt.int(v.n) : '0'}</td><td class="num">${v ? n1(v.mwhOffered / 1e3) : 'not held'}</td><td class="num">${v ? `${(100 * v.share).toFixed(2)}%${curtailSampleOk(v) ? '' : ` <span class="audit-note">below the ${CURTAIL_MIN_SAMPLE.resources}-resource minimum: not screened</span>`}` : 'not held'}</td><td class="num">—</td></tr>
      ${iso ? `<tr><td>ISO-NE (all ${cf.toLowerCase()})</td><td class="num">${fmt.int(iso.n)}</td><td class="num">${n1(iso.mwhOffered / 1e3)}</td><td class="num">${ok(iso.share) ? `${(100 * iso.share).toFixed(2)}%` : 'not held'}</td><td class="num">${fmt.int(iso.hCurtailed)}</td></tr>` : ''}
    </tbody></table></div>`;
  const held = inScope.filter(e => e.node.curt?.[run]?.[cf]).length;
  return up + card('c-6', `Curtailment screen: modelled ${cf.toLowerCase()}, ${run}`, `${fmt.int(held)} of ${fmt.int(inScope.length)} buses have a modelled ${cf.toLowerCase()} resource within 25 km${ok(r.maxCurtailPct) ? ` · screen ≤ ${r.maxCurtailPct}%` : ' · screen off'}`, body,
    { trace: 'm-curtail', chips: 'modelled', answer: v ? `Modelled ${esc(cf.toLowerCase())} within 25 km of ${B(cand?.name || 'the candidate')} is curtailed ${B(`${(100 * v.share).toFixed(2)}%`)} in ${esc(run)} (${esc(curtailSampleText(v))}${curtailSampleOk(v) ? '' : `; below the ${CURTAIL_MIN_SAMPLE.resources}-resource minimum sample, so the screen reads unknown`})${iso && ok(iso.share) ? `, against ${B(`${(100 * iso.share).toFixed(2)}%`)} ISO-wide` : ''}.` : `No modelled ${esc(cf.toLowerCase())} resource lies within 25 km of ${B(cand?.name || 'the candidate')} in ${esc(run)}: not held, so the screen reads unknown there.`, tools: `<select data-act="ui" data-k="mktCurtRun" aria-label="Run">${CURT_RUNS.map(x => `<option value="${x}" ${run === x ? 'selected' : ''}>${x}</option>`).join('')}</select>`, foot: `Unified fact_pcr_unit_hourly: offered energy the run did not dispatch, energy-weighted. A modelled run outcome near the bus, not a forecast for this project; no resource nearby, or fewer than ${CURTAIL_MIN_SAMPLE.resources} resources (minimum sample, ${esc(CURTAIL_MIN_SAMPLE.status)}), = unknown. The vendor curtailment ramps stay excluded.${cf === 'Wind' ? ' Offshore wind is excluded (no onshore bus proxy).' : ''}` });
}

// ---------- Tab 2: Rank & compare ----------
function weightsCard(S, w, d, aW) {
  const groups = {};
  for (const [k, v] of Object.entries(MEASURES)) (groups[v.group] ||= []).push(k);
  const g = (S.ui.mkt || {}).wgen || 0;
  const rows = Object.entries(groups).map(([gr, ks]) => `<tr><th colspan="3" style="position:static">${esc(gr)}</th></tr>${ks.map(k => `<tr><td class="wrap" title="${esc(MEASURES[k].src)}">${esc(MEASURES[k].label)}<div class="audit-note" style="margin:0">${MEASURES[k].dir > 0 ? 'higher is better' : 'lower is better'}${d.flat.includes(k) ? ' · <b style="color:var(--warn)">does not separate the pool</b>' : ''}</div></td><td><input type="range" min="0" max="10" step="1" value="${w[k]}" data-live data-act="mkt" data-k="${wKey(S, k)}" aria-label="Weight for ${esc(MEASURES[k].label)}" style="width:96px"></td><td class="num"><output>${w[k]}</output></td></tr>`).join('')}`).join('');
  const pr = presetOf(S);
  const presetSeg = `<div class="segmented seg-sm" role="group" aria-label="Weight preset">${Object.entries(WEIGHT_PRESETS).map(([k, l]) => `<button type="button" data-act="ui" data-k="mktPreset" data-v="${k}" class="${pr === k ? 'active' : ''}" aria-pressed="${pr === k}">${esc(l)}</button>`).join('')}</div>`;
  return card('c-4', 'Set weights', `${S.tech} · ${WEIGHT_PRESETS[pr]}${pr === 'equal' ? ' (1 on each Studio criterion: assumption)' : ' (the live Studio\'s certified profile)'} · 0 removes a criterion`, `<div class="table-wrap" style="max-height:640px"><table class="dense"><tbody>${rows}</tbody></table></div>`,
    { depth: 'review', trace: 'm-weights', chips: 'assumption', answer: aW, tools: `${presetSeg}<button type="button" data-act="mkt" data-k="wgen" data-v="${g + 1}">Reset</button>`, foot: 'Score = Σ(weight × percentile among qualifying buses) ÷ Σ(weight of criteria held at the bus). Curtailment ramps stay barred (vendor ramp, never orders a shortlist).' });
}
function tabRank({ S, data }) {
  const study = data.study, r = req(S), ev = evals(study, r), w = weights(S), keys = activeKeys(w);
  const rk = memo(JSON.stringify(['rank', r, w]), () => rank(ev, keys, w)), d = discrimination(rk, keys, w);
  const sens = memo(JSON.stringify(['sens', r, w]), () => (rk.scored.length ? sensitivity(ev, keys, w, 10) : []));
  const cand = ev.find(e => String(e.node.bus_id) === String(S.nodeId)), candMR = marketRankOf(rk, S.nodeId), candRank = candMR ? candMR.rank - 1 : -1, rec = reconcile(ev, rk);
  const top10 = new Set(rk.scored.slice(0, 10).map(x => String(x.node.bus_id)));
  const yKey = S.ui.mktScatterY === 'fcst2030' ? 'fcst2030' : 'price';
  const pts = rk.scored.map(x => ({ x: x.margin, y: MEASURES[yKey].get(x), label: `${x.node.name} (${x.node.bus_id})`, group: top10.has(String(x.node.bus_id)) ? 'Top 10 by score' : 'Other qualifying' }));
  const showCols = keys.slice().sort((a, b) => w[b] - w[a]).slice(0, 4);
  const rows = rk.scored.slice(0, 25).map((x, i) => `<tr${String(x.node.bus_id) === String(S.nodeId) ? ' class="hl"' : ''}><td class="num">${i + 1}</td><td>${esc(x.node.name)} <span class="audit-note">${x.node.bus_id} · ${esc(x.node.zone)}</span></td><td class="num"><b>${x.score.toFixed(1)}</b></td><td class="num">${(100 * x.coverage).toFixed(0)}%</td>${showCols.map(k => { const v = MEASURES[k].get(x); return `<td class="num">${ok(v) ? (Math.abs(v) >= 100 || ['h', 'overloads', 'kV'].includes(MEASURES[k].unit) ? n0(v) : v.toFixed(Number.isInteger(MEASURES[k].prec) ? MEASURES[k].prec : MEASURES[k].unit === '' ? 3 : 1)) : 'not held'} <span class="audit-note">P${x.parts[k] == null ? '–' : x.parts[k].toFixed(0)}</span></td>`; }).join('')}<td>${CH.sparkline(SETTLED.map(y => x.node.m?.y?.[y] ?? null), { width: 60, height: 16 })}</td>${landCell(data, S, r, x.node.bus_id)}<td>${pinButton(x.node.bus_id, S)} <button class="tiny" data-act="map-bus-find" data-v="${x.node.bus_id}">Map</button> <button class="tiny" data-act="pick-bus" data-v="${x.node.bus_id}">Analyse</button></td></tr>`).join('');
  const prof = cand ? marketPercentiles(ev, cand, keys) : [];
  const candScored = candRank >= 0 ? rk.scored[candRank] : null, topX = rk.scored[0];
  const contrib = [topX, candScored].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i);
  const per = persistence(cand?.node, SETTLED); // C53: part years drawn, never counted as settled years
  const clPts = per.points.map(p => ({ x: p.x, y: p.y }));
  // v6 answers
  const heavy = keys.slice().sort((a, b) => w[b] - w[a])[0];
  const aW = heavy ? `${B(keys.length)} criteria carry weight; the heaviest is ${B(MEASURES[heavy].label)} (${B(w[heavy])}).` : 'No criterion carries weight: the ranking is empty.';
  const aRank = rk.scored[0] ? `${B(rk.scored[0].node.name)} ranks first at ${B(rk.scored[0].score.toFixed(1))}; ${B(fmt.int(d.within2))} bus${d.within2 === 1 ? '' : 'es'} sit within 2 points of it.` : 'No qualifying bus to rank.';
  const held = pts.filter(q => ok(q.x) && ok(q.y)), hiM = held.slice().sort((a, b) => b.x - a.x)[0], hiP = held.slice().sort((a, b) => b.y - a.y)[0];
  const aSc = held.length ? `Most headroom: ${B(hiM.label)} (${B(`${n0(hiM.x)} MW`)}); highest price: ${B(hiP.label)} (${B(`$${hiP.y.toFixed(2)}`)}).` : 'No qualifying bus holds both a margin and this price.';
  const aDist = rk.scored.length ? `Scores run from ${B(n1(d.p5))} (P5) to ${B(n1(d.p95))} (P95): ${esc(d.verdict)}` : 'No scores to distribute.';
  const fragileW = sens.filter(s => s.dropped != null).sort((a, b) => a.dropped - b.dropped)[0];
  const aSens = fragileW ? `Dropping ${B(MEASURES[fragileW.key].label)} keeps only ${B(`${fragileW.dropped} of ${fragileW.base}`)} of today's top 10: the shortlist leans on it most.` : 'No ranking to test.';
  const profHeld = prof.filter(p => ok(p.pct)), above = profHeld.filter(p => p.pct >= 50).length;
  const aProf = cand && profHeld.length ? `${B(cand.node.name)} is at or above the market median on ${B(`${above} of ${profHeld.length}`)} weighted criteria held.` : 'The candidate holds none of the weighted measures: not held.';
  const top1 = contrib[0] ? contributions(contrib[0], keys, w).filter(c => c.points != null).sort((a, b) => b.points - a.points)[0] : null;
  const aContrib = top1 ? `For ${B(contrib[0].node.name)}, ${B(MEASURES[top1.key].label)} adds the most points (${B(top1.points.toFixed(1))} of ${B(contrib[0].score.toFixed(1))}).` : 'Nothing ranked to decompose.';
  const aBasis = per.of ? `${B(cand ? cand.node.name : 'The candidate')} had a positive congestion + loss component in ${B(`${per.pos} of ${per.of}`)} full settled years${per.partYears.length ? ` (part years ${esc(per.partYears.join(', '))} not counted)` : ''}.` : 'No full settled year at this bus: basis persistence is not held.';
  return `<div class="kpis">
      ${kpi('Ranked', fmt.int(rk.scored.length), 'buses', rec.text)}
      ${rk.scored[0] ? kpi('Top score', rk.scored[0].score.toFixed(1), '/100', `${rk.scored[0].node.name} (${rk.scored[0].node.zone})`) : kpi('Top score', 'not held', '', 'No qualifying buses', true)}
      ${kpiV('P5–P95 spread', d.spread, v => v.toFixed(1), 'points', d.verdict)}
      ${kpi('Within 2 of the top', fmt.int(d.within2), 'buses', 'Near-ties: the order among them is not meaningful')}
      ${kpi('Weight on flat criteria', `${fmt.int(d.flatWeight)} of ${fmt.int(d.totalWeight)}`, '', d.flat.length ? d.flat.map(k => MEASURES[k].label).join(', ') : 'Every weighted criterion separates the pool')}
      ${candRank >= 0 ? kpi('Candidate bus rank', `#${candRank + 1}`, `of ${fmt.int(rk.scored.length)}`, cand.node.name) : kpi('Candidate bus rank', 'not ranked', '', cand ? { met: 'Incomplete evidence', unknown: 'Unknown: evidence missing', unmet: 'Does not meet the requirements', excluded: 'Outside the selected zones' }[cand.status] : 'Not in the screen', true)}
    </div>
    ${rk.scored.length ? '' : '<div class="empty"><strong>No locations meet these requirements.</strong>Nothing to rank. Relax a requirement on Find locations.</div>'}
    <div class="cards">
      ${weightsCard(S, w, d, aW)}
      ${card('c-8', 'Ranking', `${d.verdict} Top 25 of ${fmt.int(rk.scored.length)} qualifying buses`, `<div class="table-wrap" style="max-height:640px"><table class="dense sortable"><thead><tr><th class="num">#</th><th>Bus</th><th class="num">Score</th><th class="num">Coverage</th>${showCols.map(k => `<th class="num" title="${esc(MEASURES[k].label)} · ${esc(MEASURES[k].src)}">${esc(SHORT[k] || k)} <span class="audit-note">w${w[k]}</span></th>`).join('')}<th>RT 2020–26</th><th title="Habitat/protected screen at your size">Land</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="10">None</td></tr>'}</tbody></table></div>`, { answer: `${aRank} ${(() => { const lc = landScreenCount(data.land, rk.scored.slice(0, 25).map(x => x.node)); return data.land ? `${B(`${lc.held} of ${lc.of}`)} listed buses hold a land screen; the rest are land not screened.` : ''; })()}`, foot: 'P = percentile among qualifying buses (goodness-oriented). Columns show the four heaviest criteria; the CSV in Calculations carries all of them. Land = habitat/protected screen only (an upper bound); land is not in the score.' })}
      ${card('c-6', 'Headroom against price', 'Qualifying buses; the top 10 by score highlighted (Studio 1.03)', CH.scatter(pts, { xLabel: 'Headroom margin (MW)', yLabel: MEASURES[yKey].label, fmt: v => `$${v.toFixed(2)}`, xfmt: v => `${v.toFixed(0)} MW`, title: 'Headroom vs price', height: 230 }), { answer: aSc, tools: `<select data-act="ui" data-k="mktScatterY" aria-label="Price axis"><option value="price" ${yKey === 'price' ? 'selected' : ''}>2025 RT price</option><option value="fcst2030" ${yKey === 'fcst2030' ? 'selected' : ''}>2030 pcr2030 price</option></select>`, foot: 'A bus with no price on this axis is left off the chart (not drawn at zero).' })}
      ${card('c-6', 'Score distribution', 'How the weighting spreads the qualifying buses (Studio 1.04)', CH.histogram(rk.scored.map(x => x.score), { bins: 20, fmt: v => v.toFixed(0), title: 'Score distribution', height: 230 }), { answer: aDist, foot: `P5 ${n1(d.p5)} · P95 ${n1(d.p95)} · ${d.verdict}` })}
      ${card('c-6', 'Sensitivity', 'How many of today\'s top 10 stay in the top 10 when one weight changes', sens.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Criterion</th><th class="num">Weight</th><th class="num">Dropped</th><th class="num">Halved</th><th class="num">Doubled</th></tr></thead><tbody>${sens.map(s => `<tr><td>${esc(MEASURES[s.key].label)}</td><td class="num">${w[s.key]}</td><td class="num">${s.dropped == null ? 'nothing left' : `${s.dropped} of ${s.base}`}</td><td class="num">${s.halved} of ${s.base}</td><td class="num">${s.doubled} of ${s.base}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><strong>No ranking to test</strong>Sensitivity needs at least one qualifying bus.</div>', { answer: aSens, foot: 'Low counts mean the shortlist depends on that weight: state it when you present the ranking.' })}
      ${card('c-6', `Candidate bus against the market: ${cand ? cand.node.name : 'not in the screen'}`, 'Percentile among every in-scope bus holding the measure (Studio 1.11)', prof.some(p => ok(p.pct)) ? CH.barChart(prof.map(p => ({ label: SHORT[p.key] || p.key, value: p.pct })), { fmt: v => `P${v.toFixed(0)}`, title: 'Candidate percentile profile', height: 200, xLabel: 'Criterion', yLabel: 'Percentile (goodness)' }) : '<div class="empty"><strong>Not held</strong>The candidate bus holds none of the weighted measures.</div>', { answer: aProf, foot: 'Market-wide, not only qualifying buses; higher = better on that criterion.' })}
      ${card('c-6', 'Rank contributions', 'Points each criterion adds to the score (Studio 1.12)', contrib.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Criterion</th><th class="num">Weight</th>${contrib.map(x => `<th class="num">${esc(x.node.name)} pct</th><th class="num">points</th>`).join('')}</tr></thead><tbody>${keys.map(k => `<tr><td>${esc(MEASURES[k].label)}</td><td class="num">${w[k]}</td>${contrib.map(x => { const c = contributions(x, keys, w).find(z => z.key === k); return `<td class="num">${c.pct == null ? 'not held' : 'P' + c.pct.toFixed(0)}</td><td class="num">${c.points == null ? '—' : c.points.toFixed(1)}</td>`; }).join('')}</tr>`).join('')}<tr><td><b>Score</b></td><td></td>${contrib.map(x => `<td></td><td class="num"><b>${x.score.toFixed(1)}</b></td>`).join('')}</tr></tbody></table></div>` : '<div class="empty"><strong>Nothing ranked</strong>No qualifying bus to decompose.</div>', { answer: aContrib, foot: 'A criterion not held at a bus drops out of its numerator and denominator; it is never scored as zero.' })}
      ${card('c-6', 'Basis persistence', `${cand ? cand.node.name : 'Candidate'}: congestion + loss component by settled year (Studio 1.10)`, CH.lineChart([{ name: 'Congestion + loss', points: clPts }], { fmt: v => `$${v.toFixed(2)}`, xfmt: v => String(v), title: 'Basis persistence', height: 190, xLabel: 'Year', yLabel: '$/MWh' }), { answer: aBasis, chips: cand && borrowedPrice(cand.node) ? 'geo-proxy' : '', foot: `${per.of ? `Positive in ${per.pos} of ${per.of} full settled years.` : 'No full settled year at this bus.'} ${per.partYears.length ? `Part years (fewer than ${Math.round(100 * FULL_YEAR_SHARE)}% of hours held: ${esc(per.partYears.join(', '))}) are drawn but not counted. ` : ''}Basis against the system energy component (mart_bus_year avg_cong + avg_loss, RT, settled).${cand && borrowedPrice(cand.node) ? ` Borrowed price: ${esc(tierText(cand.node))}.` : ''}` })}
      ${traceCard([TR.traceRank(rk, keys, w), TR.traceWeights(rk, d, keys, w), TR.traceSens(sens, rk, keys, w)])}
    </div>
    ${nextStep('market', 'size', 'test how robust the shortlist is in Market › Size & robustness')}`;
}

// ---------- Tab 3: Size & robustness ----------
const SIZES = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500];
function tabSize({ S, data }) {
  const study = data.study, r = req(S), R = reqSize(r), sizes = [...new Set([...SIZES, ...(R > 0 ? [R] : [])])].sort((a, b) => a - b);
  const p = memo(JSON.stringify(['profile', r, sizes]), () => sizeProfile(study, r, sizes));
  const iR = sizes.indexOf(R), ev = evals(study, r), metAtReq = ev.filter(e => e.status === 'met').length;
  const at = s => p.sweep.find(x => x.size === s);
  const B = [...p.buses.values()];
  const fragile = iR >= 0 && iR < sizes.length - 1 ? B.filter(b => b.statuses[iR] === 'met' && b.statuses[iR + 1] !== 'met') : [];
  const near = iR > 0 ? B.filter(b => b.statuses[iR] === 'unmet' && b.statuses[iR - 1] === 'met') : [];
  const noSh = evals(study, { ...r, useShoulder: false }), shOnly = noSh.filter((e, i) => e.status === 'met' && ev[i].status !== 'met').length;
  const margins = ev.filter(e => e.status !== 'excluded' && ok(e.margin)).map(e => e.margin);
  const maxBars = sizes.map(s => ({ label: `${s} MW`, value: B.filter(b => b.maxMet === s).length }));
  const cand = candidateNode(study, S);
  const shortlist = ev.filter(e => e.status === 'met').sort((a, b) => b.margin - a.margin).slice(0, 12).map(e => e.node);
  if (cand && !shortlist.includes(cand)) shortlist.push(cand);
  const cases = applicableCases(r.tech), reads = k => [...cases.export, ...cases.import].includes(k);
  const cm = shortlist.map(n => ({ n, cells: caseMatrix(study, n) }));
  const colKeys = cm[0]?.cells.map(c => c.caseKey) || [];
  const survive = cm.filter(x => { const rd = x.cells.filter(c => reads(c.caseKey) && (r.useShoulder !== false || c.caseKey !== 'shoulder|discharge')); return rd.length && rd.every(c => ok(c.value) && c.value >= (c.dir === 'export' ? r.exportMW : r.tech === 'datacenter' ? r.importMW : Math.max(r.importMW || 0, r.exportMW || 0))); }).length;
  const lims = cand ? serviceLimits(study, cand, S.tech).filter(l => r.useShoulder !== false || l.key !== 'export-sh') : [];
  // v6 answers (B is the bus list in this tab, so the bold helper is `bo` here)
  const bo = v => `<b>${esc(v)}</b>`, big = p.sweep.at(-1);
  const aSweep = `${bo(fmt.int(metAtReq))} buses qualify at your ${esc(fmt.mw(R))}${big && big.size !== R ? `, against ${bo(fmt.int(big.met))} at ${esc(fmt.mw(big.size))}` : ''}; unknown buses are never counted.`;
  const aMargin = margins.length ? `${bo(fmt.int(margins.filter(v => v >= 0).length))} buses have room at ${esc(fmt.mw(R))} and ${bo(fmt.int(margins.filter(v => v < 0).length))} are short, ${bo(fmt.int(margins.filter(v => v < 0 && v >= -50).length))} of them by 50 MW or less.` : 'No bus in scope holds every case: no margin is known.';
  const modal = maxBars.slice().sort((a, b) => b.value - a.value)[0];
  const aMax = modal && modal.value ? `The largest qualifying size is most often ${bo(modal.label)} (${bo(fmt.int(modal.value))} buses).` : 'No bus qualifies at any size in the sweep.';
  const aFlip = `${bo(fmt.int(fragile.length))} bus${fragile.length === 1 ? '' : 'es'} meet at ${esc(fmt.mw(R))} but not one step up; ${bo(fmt.int(near.length))} miss by one step down.`;
  const candWorst = lims.filter(l => ok(l.value)).map(l => l.value - R).sort((a, b) => a - b)[0];
  const aCand = cand ? (ok(candWorst) ? `${bo(cand.name)}'s tightest case leaves ${bo(`${candWorst >= 0 ? '+' : '−'}${n0(Math.abs(candWorst))} MW`)} at ${esc(fmt.mw(R))}${lims.some(l => !ok(l.value)) ? '; at least one case is unknown' : ''}.` : `No case limit is held at ${bo(cand.name)}: unknown.`) : 'The candidate bus is not in the screen.';
  const i250 = sizes.indexOf(250), zTop = i250 < 0 ? null : ZONES.map(z => ({ z, n: B.filter(b => b.node.zone === z && b.statuses[i250] === 'met').length })).sort((a, b) => b.n - a.n)[0];
  const aZones = zTop && zTop.n ? `At 250 MW, ${bo(zTop.z)} keeps the most qualifying buses (${bo(fmt.int(zTop.n))}).` : 'No zone has a bus that qualifies at 250 MW.';
  const aSurv = cm.length ? `${bo(`${fmt.int(survive)} of ${fmt.int(cm.length)}`)} shortlisted buses clear every case your service reads.` : 'No shortlist: no bus qualifies at this size.';
  const flipRow = (b, kind) => `<tr><td>${kind}</td><td>${esc(b.node.name)} <span class="audit-note">${b.node.bus_id} · ${esc(b.node.zone)}</span></td><td class="num">${fmt.mw(b.margins[iR])}</td><td class="num">${b.maxMet ? fmt.mw(b.maxMet) : '—'}</td><td class="num">${fmt.price(b.node.lmp_2025)}</td><td>${pinButton(b.node.bus_id, S)} <button class="tiny" data-act="map-bus-find" data-v="${b.node.bus_id}">Map</button></td></tr>`;
  return `<div class="kpis">
      ${kpi(`Qualify at ${fmt.mw(R)}`, fmt.int(metAtReq), 'buses', 'Your request (Find locations)')}
      ${[50, 100, 250, 500].filter(s => s !== R).slice(-3).map(s => kpi(`Qualify at ${s} MW`, fmt.int(at(s)?.met), 'buses', s < R ? 'Smaller project' : 'Larger project')).join('')}
      ${kpi('Fragile at your size', fmt.int(fragile.length), 'buses', iR >= 0 && iR < sizes.length - 1 ? `Meet at ${R} MW, not at ${sizes[iR + 1]} MW` : 'No larger step to test')}
      ${kpi('Depend on the shoulder switch', fmt.int(shOnly), 'buses', 'Qualify only if the shoulder export case is dropped')}
    </div>
    <div class="cards">
      ${card('c-6', 'Buses that qualify, by project size', 'Counts only; headroom is never added up across buses (Studio 1.06)', CH.lineChart([{ name: 'Meet', points: p.sweep.map(s => ({ x: s.size, y: s.met })) }, { name: 'Unknown', points: p.sweep.map(s => ({ x: s.size, y: s.unknown })), dashed: true }, { name: 'Do not meet', points: p.sweep.map(s => ({ x: s.size, y: s.unmet })), dashed: true }], { fmt: v => v.toFixed(0), xfmt: v => `${v} MW`, title: 'Qualifying buses by size', height: 220, xLabel: 'Size', yLabel: 'Buses' }), { answer: aSweep, foot: `Meets = on the studied cases${r.requireUnstudied ? ' plus the unstudied light-load and minimum-load cases (Unknown)' : '; light load and minimum load are not screened'}. ${esc(marketServiceNote(r.tech))}` })}
      ${card('c-6', 'Margin distribution at your size', `Worst-case margin (limit − ${fmt.mw(R)}) over the buses in scope with every case held`, CH.histogram(margins, { bins: 24, fmt: v => `${v.toFixed(0)} MW`, title: 'Margin distribution', height: 220 }), { answer: aMargin, foot: `${fmt.int(margins.filter(v => v < 0).length)} short, ${fmt.int(margins.filter(v => v >= 0).length)} with room; ${fmt.int(margins.filter(v => v < 0 && v >= -50).length)} are within 50 MW of qualifying. A bus with a missing case has no margin (unknown).` })}
      ${card('c-6', 'Largest size each bus qualifies at', 'Breakpoints across the sweep: where the qualifying set thins out', CH.barChart(maxBars, { fmt: v => fmt.int(v), title: 'Largest qualifying size', height: 200, xLabel: 'Largest size met', yLabel: 'Buses' }), { answer: aMax, foot: `${fmt.int(B.filter(b => b.maxMet == null && b.statuses.some(s => s === 'unknown')).length)} buses are unknown at every size; ${fmt.int(B.filter(b => b.maxMet == null && b.statuses.every(s => s === 'unmet')).length)} fail even at ${sizes[0]} MW.` })}
      ${card('c-6', 'Buses that flip between sizes', iR >= 0 ? `Fragile: meet at ${R} MW, not at the next step · Near miss: fail at ${R} MW, meet one step down` : 'Set an export (or import) size to test flips', `<div class="table-wrap"><table class="dense sortable"><thead><tr><th>Kind</th><th>Bus</th><th class="num">Margin at ${R} MW</th><th class="num">Largest met</th><th class="num">2025 RT</th><th></th></tr></thead><tbody>${[...fragile.sort((a, b) => a.margins[iR] - b.margins[iR]).slice(0, 15).map(b => flipRow(b, 'Fragile')), ...near.sort((a, b) => b.margins[iR] - a.margins[iR]).slice(0, 15).map(b => flipRow(b, 'Near miss'))].join('') || '<tr><td colspan="6">No bus flips at this step.</td></tr>'}</tbody></table></div>`, { answer: aFlip, foot: `${fmt.int(fragile.length)} fragile, ${fmt.int(near.length)} near misses (15 of each shown, closest first).` })}
      ${card('c-12', 'Case survival of the shortlist', `The 12 largest-margin qualifying buses${cand ? ' and the candidate' : ''} across all five study cases (Studio 1.09)`, cm.length ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Bus</th>${colKeys.map(k => `<th class="num">${esc(cm[0].cells.find(c => c.caseKey === k).label)}${reads(k) ? '' : ' <span class="audit-note">(not read)</span>'}</th>`).join('')}</tr></thead><tbody>${cm.map(x => `<tr${x.n === cand ? ' class="hl"' : ''}><td>${esc(x.n.name)} <span class="audit-note">${x.n.bus_id}${x.n === cand ? ' · candidate' : ''}</span></td>${x.cells.map(c => { const need = c.dir === 'export' ? r.exportMW : r.tech === 'datacenter' ? r.importMW : Math.max(r.importMW || 0, r.exportMW || 0); return `<td class="num">${ok(c.value) ? `${c.value >= CEIL ? '≥ ' : ''}${n1(c.value)} MW ${reads(c.caseKey) && need > 0 ? `<span class="pill ${c.value >= need ? 'good' : 'warn'}">${c.value >= need ? 'met' : `${n0(need - c.value)} short`}</span>` : ''}` : `<span class="audit-note">${esc({ noViolation: 'no violations · max not published', unpublished: 'not published', none: 'not studied' }[c.status] || 'not held')}</span>`}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="empty"><strong>No shortlist</strong>No bus qualifies at this size.</div>', { answer: aSurv, foot: `${fmt.int(survive)} of ${fmt.int(cm.length)} clear every case your service reads. Grid rules: element study governs, envelope only where no element list exists (vendor-asserted). Large load publishes a charge case only.` })}
      ${card('c-6', `${cand ? cand.name : 'Candidate bus'}: margin by case`, 'Limit − size at each sweep size; unknown where the case is not held', `<div class="table-wrap"><table class="dense"><thead><tr><th>Case</th>${sizes.slice(0, 8).map(s => `<th class="num">${s}</th>`).join('')}</tr></thead><tbody>${lims.map(l => `<tr><td title="${esc(l.basis)}">${esc(l.label)}</td>${sizes.slice(0, 8).map(s => `<td class="num">${ok(l.value) ? `<span class="pill ${l.value >= s ? 'good' : 'warn'}">${l.value - s >= 0 ? '+' : '−'}${Math.abs(l.value - s).toFixed(0)}</span>` : 'unknown'}</td>`).join('')}</tr>`).join('') || '<tr><td>No case applies.</td></tr>'}</tbody></table></div>`, { answer: aCand, foot: 'MW. Directional margin = case limit − size; the worst margin across required cases decides.' })}
      ${card('c-6', 'Zones by size', 'Qualifying buses per zone at 100, 250 and 500 MW', CH.groupedBar(ZONES.map(z => ({ label: z, values: [100, 250, 500].map(s => { const i = sizes.indexOf(s); return i < 0 ? null : B.filter(b => b.node.zone === z && b.statuses[i] === 'met').length; }) })), { series: ['100 MW', '250 MW', '500 MW'], fmt: v => fmt.int(v), title: 'Zones by size', height: 200, xLabel: 'Zone' }), { answer: aZones })}
      ${traceCard([TR.traceSize(p.sweep, R, metAtReq), TR.traceFlips(p, sizes, iR, fragile, near, margins, ev)])}
    </div>
    ${nextStep('market', 'regions', 'read the zones behind the shortlist in Market › Compare regions')}`;
}

// ---------- Tab 4: Compare regions ----------
const partialYear = (hours, y) => hours < FULL_YEAR_SHARE * (y % 4 === 0 ? 8784 : 8760);
function networkCost(study, tech) {
  return memo(JSON.stringify(['cost', tech]), () => study.nodes.map(n => {
    const g = study.gridOf(n.bus_id), out = { zone: n.zone, bus: n.bus_id };
    for (const s of [100, 250]) { const [e, i] = tech === 'datacenter' ? [0, s] : ['storage', 'hybrid'].includes(tech) ? [s, s] : [s, 0]; const c = stepCostService(g, n.bus_id, tech, e, i); out[s] = ['Priced', 'True zero'].includes(c.status) ? perKw(c.total, s) : null; out[`st${s}`] = c.status; }
    return out;
  }));
}
function tabRegions({ S, data }) {
  const study = data.study, r = req(S), evAll = evals(study, { ...r, zones: null }), rg = regions(evAll);
  const Z = extra('zones'), SY = extra('system'), SU = extra('supply'), ST = extra('studio');
  const zy = (zone, market, y) => Z?.years.find(x => x.zone === zone && x.market === market && x.y === y) || null;
  const mkt = S.ui.mktMarket === 'DA' ? 'DA' : 'RT';
  const years = Z ? [...new Set(Z.years.map(x => x.y))].sort() : [];
  const hub25 = zy('HUB', 'RT', 2025), hub24 = zy('HUB', 'RT', 2024);
  const cost = networkCost(study, S.tech);
  const opCap = z => SU ? SU.generators.filter(g => g.zone === z && g.status === 'Operating').reduce((t, g) => t + (g.cap_mw || 0), 0) : null;
  const retMW = z => SU ? SU.retirements.filter(x => x.zone === z && ok(x.mw)).reduce((t, x) => t + x.mw, 0) : null;
  const qMW = z => SU ? SU.queue.filter(x => x.zone === z && ok(x.max_mw)).reduce((t, x) => t + x.max_mw, 0) : null;
  const zrows = rg.map(z => { const zz = zy(z.zone, 'RT', 2025); const cs = cost.filter(c => c.zone === z.zone); return { ...z, zp: zz?.lmp, bhub: zz?.bhub, neg: zz?.neg, cap: opCap(z.zone), ret: retMW(z.zone), q: qMW(z.zone), c100: median(cs.map(c => c[100])), n100: cs.filter(c => ok(c[100])).length, c250: median(cs.map(c => c[250])) }; });
  const widest = Z ? ZONES.map(z => zy(z, 'RT', 2025)).filter(Boolean).sort((a, b) => a.bhub - b.bhub)[0] : null;
  const best = rg.filter(z => ok(z.metShare)).sort((a, b) => b.metShare - a.metShare)[0];
  const mix = SY ? genMixShares(SY.gen.map(g => ({ y: g.y, fuel: groupOf(g.fuel), mwh: g.mwh }))) : [];
  const mix25 = mix.find(g => g.y === 2025);
  const ld = SY ? SY.load.map(l => ({ ...l, fc: SY.forecast.find(f => f.y === l.y) })) : [];
  const ld25 = ld.find(l => l.y === 2025);
  const genHours = y => SY?.genHours.find(h => h.y === y)?.hours;
  // Dispersion across distinct settled price series (a series shared by several buses counts once).
  const series = new Map(); for (const n of study.nodes) if (n.pnode && n.m?.y && !series.has(n.pnode)) series.set(n.pnode, n.m.y);
  const disp = SETTLED.map(y => { const v = [...series.values()].map(s => s[y]).filter(ok); return { y: Number(y), p5: quantile(v, 0.05), p50: quantile(v, 0.5), p95: quantile(v, 0.95), n: v.length }; });
  const fuelNames = FUEL_GROUPS.map(g => g[0]);
  // v6 answers (each says "loading" or "not held" when its source is not in yet)
  const ld0 = w => `${esc(w)} is loading from the unified database.`;
  const aZones = best ? `${B(best.zone)} has the highest share of buses clearing ${esc(fmt.mw(reqSize(r)))} (${B(`${(100 * best.metShare).toFixed(0)}%`)}).` : 'No zone has a qualifying bus at this request.';
  const aBasis = !Z ? ld0('Zone pricing') : widest ? `${B(widest.zone)} trades furthest below the hub: ${B(sgn(widest.bhub))}/MWh in RT 2025.` : 'Zone basis for 2025 is not held.';
  const negTop = Z ? ZONES.map(z => ({ z, v: zy(z, 'RT', 2025)?.neg })).filter(x => ok(x.v)).sort((a, b) => b.v - a.v)[0] : null;
  const aNeg = !Z ? ld0('Zone pricing') : negTop ? `${B(negTop.z)} had the most negative RT hours in 2025 (${B(fmt.int(negTop.v))}).` : 'Negative hours for 2025 are not held.';
  const pTop = Z ? ZONES.map(z => ({ z, v: zy(z, mkt, 2025)?.lmp })).filter(x => ok(x.v)).sort((a, b) => b.v - a.v) : [];
  const aTrend = !Z ? ld0('Zone pricing') : pTop.length ? `In 2025 (${esc(mkt)}) ${B(pTop[0].z)} was the dearest zone at ${B(fmt.price(pTop[0].v))} and ${B(pTop.at(-1).z)} the cheapest at ${B(fmt.price(pTop.at(-1).v))}.` : `${esc(mkt)} zone prices for 2025 are not held.`;
  const d25 = disp.find(x => x.y === 2025);
  const aDisp = d25 && ok(d25.p5) ? `In 2025 the middle 90% of bus prices ran from ${B(fmt.price(d25.p5))} to ${B(fmt.price(d25.p95))} (${fmt.int(d25.n)} distinct series).` : 'Settled 2025 bus prices are not held.';
  const aMix = !SY ? ld0('System data') : mix25 ? `Natural gas supplied ${B(pc(mix25.share['Natural gas']))} of 2025 metered generation; nuclear ${B(pc(mix25.share.Nuclear))}.` : 'The 2025 generation mix is not held.';
  const solarHod = SY ? Array.from({ length: 24 }, (_, h) => ({ h, mw: SY.genHod.rows.filter(x => x.hod === h && groupOf(x.fuel) === 'Solar').reduce((t, x) => t + x.mw, 0) })).sort((a, b) => b.mw - a.mw)[0] : null;
  const aHod = !SY ? ld0('System data') : solarHod && solarHod.mw > 0 ? `Metered solar peaks at ${B(`${solarHod.h}:00`)} with ${B(`${(solarHod.mw / 1000).toFixed(1)} GW`)} on average in 2025.` : 'Metered solar by hour is not held.';
  const gasOf = sc => ST ? ST.outlook.filter(o => o.scenario === sc && (sc !== 'hist' || o.year === 2025) && groupOf(o.fuel) === 'Natural gas').reduce((t, o) => t + (o.mwh || 0), 0) : null;
  const aFc = !ST ? ld0('The Studio copy') : `In the Studio copy, gas dispatch goes from ${B(`${n1(gasOf('hist') / 1e6)} TWh`)} (2025 settled) to ${B(`${n1(gasOf('pcr2040') / 1e6)} TWh`)} in pcr2040.`;
  const gLast = ST ? ST.gas.filter(g => ok(g.price)).at(-1) : null;
  const aGas = !ST ? ld0('The Studio copy') : gLast ? `Henry Hub averaged ${B(`$${gLast.price.toFixed(2)}`)}/MMBtu in ${B(gLast.month)}, the latest month held.` : 'No Henry Hub month is held.';
  const aLoad = !SY ? ld0('System data') : ld25 ? `System load peaked at ${B(`${fmt.int(ld25.peak_mw)} MW`)} in 2025 on ${esc(String(ld25.peak_ts).slice(0, 10))}.` : '2025 system load is not held.';
  const ic25 = SY ? SY.interchange.filter(x => x.y === 2025 && ok(x.mean_mw)).sort((a, b) => a.mean_mw - b.mean_mw)[0] : null;
  const aIc = !SY ? ld0('System data') : ic25 ? `${B(ic25.interface)} had the most negative mean flow in 2025 (${B(`${n0(ic25.mean_mw)} MW`)}, sign as published by ISO-NE).` : '2025 interchange is not held.';
  const qTop = SU ? ZONES.map(z => ({ z, v: qMW(z) })).sort((a, b) => b.v - a.v)[0] : null;
  const aSup = !SU ? ld0('Supply data') : qTop ? `${B(qTop.z)} holds the most queued MW in the solved case (${B(`${n0(qTop.v)} MW`)}).` : 'No queued MW is attributed to a zone.';
  const aRet = !SU ? ld0('Supply data') : `${B(fmt.int(SU.retirements.length))} announced retirements total ${B(`${n0(SU.retirements.filter(x => ok(x.mw)).reduce((t, x) => t + x.mw, 0))} MW`)}.`;
  const aQz = !SU ? ld0('Supply data') : `The solved case holds ${B(fmt.int(SU.queue.length))} requests, ${B(`${n0(SU.queue.reduce((t, q) => t + (q.max_mw || 0), 0))} MW`)} in total.`;
  const dec = ST?.queueTrends?.meta?.decades?.at(-1);
  const aQr = !ST ? ld0('The Studio copy') : dec ? `${B(`${(100 * dec.withdrawn_share).toFixed(1)}%`)} of requests entered in the ${esc(dec.decade)}s have withdrawn (Studio copy).` : 'Withdrawal shares are not held.';
  const tight = rg.filter(z => ok(z.metShare)).sort((a, b) => a.metShare - b.metShare)[0];
  const aCrowd = tight ? `${B(tight.zone)} is the tightest zone: ${B(`${(100 * tight.metShare).toFixed(0)}%`)} of its buses clear ${esc(fmt.mw(reqSize(r)))}.` : 'No zone share is held.';
  const zc = ZONES.map(z => ({ z, c100: zoneCostSummary(cost, z, 100), c250: zoneCostSummary(cost, z, 250) }));
  const cheap = zc.map(x => ({ z: x.z, v: x.c100.median, n: x.c100.n, of: x.c100.buses })).filter(x => ok(x.v)).sort((a, b) => a.v - b.v)[0];
  const env100 = zc.reduce((t, x) => t + x.c100.envelopeOnly, 0), nP100 = zc.reduce((t, x) => t + x.c100.n, 0), nB100 = zc.reduce((t, x) => t + x.c100.buses, 0);
  const aCost = cheap ? `${B(cheap.z)} has the lowest median network cost at 100 MW: ${B(`$${n0(cheap.v)}/kW`)}, from ${B(`${fmt.int(cheap.n)} of ${fmt.int(cheap.of)}`)} buses priced or true zero. Across zones only ${B(`${fmt.int(nP100)} of ${fmt.int(nB100)}`)} buses carry a $/kW, so these medians are a selected sample.` : 'No zone has a priced network cost at 100 MW.';
  const aNotes = !ST ? ld0('The Studio copy') : 'Where the unified database and the Studio copy disagree, the unified value is used; each row shows how far apart they are.';
  return `<div class="kpis">
      ${hub25 ? kpi('Hub RT 2025', fmt.price(hub25.lmp), '/MWh', hub24 ? `${hub25.lmp >= hub24.lmp ? '+' : '−'}${Math.abs(100 * (hub25.lmp / hub24.lmp - 1)).toFixed(1)}% vs 2024 (${fmt.price(hub24.lmp)})` : '') : kpi('Hub RT 2025', Z ? 'not held' : 'loading', '', '.H.INTERNAL_HUB', true)}
      ${hub25 ? kpi('Hub negative hours 2025', fmt.int(hub25.neg), 'h', `of ${fmt.int(hub25.hours)} settled RT hours`) : kpi('Hub negative hours 2025', Z ? 'not held' : 'loading', '', '', true)}
      ${widest ? kpi('Widest zone discount', sgn(widest.bhub), '/MWh', `${widest.zone} vs hub, RT 2025 hour-matched`) : kpi('Widest zone discount', Z ? 'not held' : 'loading', '', '', true)}
      ${ld25 ? kpi('System peak 2025', fmt.int(ld25.peak_mw), 'MW', String(ld25.peak_ts).slice(0, 16).replace('T', ' ')) : kpi('System peak 2025', SY ? 'not held' : 'loading', '', '', true)}
      ${mix25 ? kpi('Gas share of generation 2025', pc(mix25.share['Natural gas']), '', `${n1(mix25.total / 1e6)} TWh metered by fuel`) : kpi('Gas share 2025', SY ? 'not held' : 'loading', '', '', true)}
      ${best ? kpi('Highest qualifying share', `${(100 * best.metShare).toFixed(0)}%`, '', `${best.zone} · ${best.buses} buses at ${fmt.mw(reqSize(r))}`) : kpi('Highest qualifying share', 'not held', '', '', true)}
    </div>
    <div class="cards">
      ${card('c-12', 'Zones side by side', 'Screen results at your request, zone prices, supply and network cost', `<div class="table-wrap"><table class="dense sortable"><thead><tr><th>Zone</th><th class="num">Buses</th><th class="num">Meet</th><th class="num">Unknown</th><th class="num">Median margin</th><th class="num">Median bus 2025</th><th class="num">Zone node RT 2025</th><th class="num">Basis vs hub</th><th class="num">Neg. hours</th><th class="num">Operating MW</th><th class="num">Retiring MW</th><th class="num">Queue MW</th><th class="num">Network $/kW 100 MW</th><th class="num">250 MW</th></tr></thead><tbody>${zrows.map(z => `<tr${z.zone === candidateNode(study, S)?.zone ? ' class="hl"' : ''}><td>${esc(z.zone)}</td><td class="num">${fmt.int(z.buses)}</td><td class="num">${ok(z.metShare) ? pc(100 * z.metShare) : 'not held'}</td><td class="num">${ok(z.unknownShare) ? pc(100 * z.unknownShare) : 'not held'}</td><td class="num">${fmt.mw(z.medianMargin)}</td><td class="num" title="${fmt.int(z.priceHeld)} buses with a full 2025 settled year">${fmt.price(z.medianPrice)}</td><td class="num">${Z ? fmt.price(z.zp) : '…'}</td><td class="num">${Z ? sgn(z.bhub) : '…'}</td><td class="num">${Z ? n0(z.neg) : '…'}</td><td class="num">${SU ? n0(z.cap) : '…'}</td><td class="num">${SU ? n0(z.ret) : '…'}</td><td class="num">${SU ? n0(z.q) : '…'}</td><td class="num" title="${z.n100} buses priced">${ok(z.c100) ? '$' + n0(z.c100) : 'not held'}</td><td class="num">${ok(z.c250) ? '$' + n0(z.c250) : 'not held'}</td></tr>`).join('')}</tbody></table></div>`, { answer: aZones, foot: `Zone filters from Find locations are ignored so every zone is compared on the same request. Regional headroom is never the sum of bus headrooms. Retiring = dim_retirement 2024–2028 (rows naming only "MA" unattributed). Queue = unified dim_queue (${SU ? fmt.int(SU.queue.length) : '…'} requests), zone of the nearest bus within 25 km. Network $/kW = Grid rules step cost at the size, median over buses priced or true zero (hover for n; Network cost card shows the status mix). Median bus 2025 = full 2025 settled years only (${esc(POPULATION_RULE)}). ${esc(marketServiceNote(S.tech))}` })}
      ${card('c-6', 'Zone basis against the hub, by year', `${mkt} · hour-matched mean of (zone node − .H.INTERNAL_HUB) (Studio 1.20)`, Z ? CH.lineChart(ZONES.map(z => ({ name: z, points: years.map(y => ({ x: y, y: zy(z, mkt, y)?.bhub ?? null })) })), { fmt: v => `$${v.toFixed(2)}`, xfmt: v => String(v), title: `Zone basis vs hub ${mkt}`, height: 230, xLabel: 'Year', yLabel: '$/MWh' }) : wait('zones', 'zone prices'), { answer: aBasis, tools: `<div class="segmented seg-sm">${['RT', 'DA'].map(m => `<button type="button" data-act="ui" data-k="mktMarket" data-v="${m}" class="${mkt === m ? 'active' : ''}">${m}</button>`).join('')}</div>`, foot: Z ? `2026 is a part year (${fmt.int(zy('HUB', mkt, 2026)?.hours)} h), compared by mean, never by sum. DA begins 2021.` : '' })}
      ${card('c-6', 'Negative real-time hours by zone and year', 'Hours with LMP < $0 at each load-zone node (Studio 8.20)', Z ? CH.heatmap(ZONES.map(z => ({ label: z, cells: years.map(y => ({ label: String(y) + (partialYear(zy(z, 'RT', y)?.hours ?? 0, y) ? '*' : ''), value: zy(z, 'RT', y)?.neg ?? null })) })), { fmt: v => fmt.int(v), title: 'Negative hours heatmap', height: 230 }) : wait('zones', 'zone prices'), { answer: aNeg, foot: '* part year: hours held, not annualised. Maine carries the most negative hours.' })}
      ${card('c-6', 'Zone price trend', `${mkt} annual mean at each load-zone node and the hub`, Z ? CH.lineChart([...ZONES, 'HUB'].map(z => ({ name: z, dashed: z === 'HUB', points: years.map(y => ({ x: y, y: zy(z, mkt, y)?.lmp ?? null })) })), { fmt: v => `$${v.toFixed(2)}`, xfmt: v => String(v), title: `Zone price trend ${mkt}`, height: 230, xLabel: 'Year', yLabel: '$/MWh' }) : wait('zones', 'zone prices'), { answer: aTrend })}
      ${card('c-6', 'Price dispersion across the market', 'Spread of bus annual RT means (distinct price series)', CH.lineChart([{ name: 'P95', points: disp.map(d => ({ x: d.y, y: d.p95 })), dashed: true }, { name: 'Median', points: disp.map(d => ({ x: d.y, y: d.p50 })) }, { name: 'P5', points: disp.map(d => ({ x: d.y, y: d.p5 })), dashed: true }], { fmt: v => `$${v.toFixed(2)}`, xfmt: v => String(v), title: 'Price dispersion', height: 230, xLabel: 'Year', yLabel: '$/MWh' }), { answer: aDisp, foot: `${fmt.int(series.size)} distinct settled series behind ${fmt.int(study.nodes.length)} buses (a shared series counts once). 2026 part year.` })}
      ${card('c-6', 'Generation by fuel, by year', 'ISO-NE metered generation, TWh (fact_genfuel_hourly)', SY ? CH.stackedBar(mix.map(g => ({ label: `${g.y}${partialYear(genHours(g.y) || 0, g.y) ? '*' : ''}`, values: fuelNames.map(f => ok(g.mwh[f]) ? g.mwh[f] / 1e6 : null) })), { series: fuelNames, fmt: v => v.toFixed(v >= 10 ? 0 : 1), title: 'Generation mix by year', height: 240, xLabel: 'Year' }) : wait('system', 'system data'), { answer: aMix, foot: SY ? `* 2026 part year (${fmt.int(genHours(2026))} h). Each fuel averaged within the hour, then summed. ISO-wide only: the feed carries no zonal fuel split.` : '' })}
      ${card('c-6', '2025 generation by hour of day', 'Average MW by fuel across 2025 hours', SY ? CH.areaChart(fuelNames.map(f => ({ name: f, points: Array.from({ length: 24 }, (_, h) => ({ x: h, y: SY.genHod.rows.filter(x => x.hod === h && groupOf(x.fuel) === f).reduce((t, x) => t + x.mw, 0) })) })), { stacked: true, fmt: v => `${(v / 1000).toFixed(1)} GW`, xfmt: v => (Number.isInteger(v) ? `${v}:00` : ''), title: 'Generation by hour of day 2025', height: 240 }) : wait('system', 'system data'), { answer: aHod, foot: 'Hour-beginning clock hours as stamped in the feed. A fuel absent from an hour (e.g. solar at night) adds nothing.' })}
      ${card('c-6', 'Forecast dispatch by fuel', 'PCR runs against 2025 settled, TWh — Studio copy (older database)', ST ? CH.stackedBar(['hist', 'pcr2030', 'pcr2035', 'pcr2040'].map(sc => { const rows = ST.outlook.filter(o => o.scenario === sc && (sc !== 'hist' || o.year === 2025)); return { label: sc === 'hist' ? '2025 settled' : sc, values: fuelNames.map(f => { const v = rows.filter(o => groupOf(o.fuel) === f).reduce((t, o) => t + (o.mwh || 0), 0); return rows.length ? v / 1e6 : null; }) }; }), { series: fuelNames, fmt: v => v.toFixed(v >= 10 ? 0 : 1), title: 'Forecast dispatch by fuel', height: 240, xLabel: 'Case' }) : wait('studio', 'the Studio copy'), { answer: aFc, foot: ST ? `GS_DATA_EXT.cathy.outlook, built ${esc(ST.gsDataExt.built_at)} from GridSense_one.duckdb. The unified database holds no dispatch-by-fuel for the runs.` : '' })}
      ${card('c-6', 'Henry Hub gas', 'Monthly mean of daily settles, $/MMBtu — Studio copy (older database)', ST ? CH.lineChart([{ name: 'Henry Hub', points: ST.gas.filter(g => g.month >= '2019').map(g => ({ x: Number(g.month.slice(0, 4)) + (Number(g.month.slice(5, 7)) - 1) / 12, y: g.price })) }], { fmt: v => `$${v.toFixed(2)}`, xfmt: v => `${Math.floor(v)}-${String(Math.round((v % 1) * 12) + 1).padStart(2, '0')}`, title: 'Henry Hub gas', height: 220, xLabel: 'Month', yLabel: '$/MMBtu' }) : wait('studio', 'the Studio copy'), { answer: aGas, foot: 'No New England city-gate series is held in either database; gas sets the marginal price in most hours (gas share above).' })}
      ${card('c-6', 'System load', 'Annual energy, mean and peak; the day-ahead load forecast against actual', SY ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Year</th><th class="num">Hours</th><th class="num">Energy TWh</th><th class="num">vs prior</th><th class="num">Mean MW</th><th class="num">Peak MW</th><th>Peak hour</th><th class="num">Forecast MAPE</th><th class="num">Forecast bias MW</th></tr></thead><tbody>${ld.map((l, i) => { const prev = ld[i - 1], part = partialYear(l.hours, l.y), pp = prev && !partialYear(prev.hours, prev.y); return `<tr><td>${l.y}${part ? '*' : ''}</td><td class="num">${fmt.int(l.hours)}</td><td class="num">${n1(l.mwh / 1e6)}</td><td class="num">${!part && pp ? `${l.mwh >= prev.mwh ? '+' : '−'}${Math.abs(100 * (l.mwh / prev.mwh - 1)).toFixed(1)}%` : '—'}</td><td class="num">${n0(l.mean_mw)}</td><td class="num">${n0(l.peak_mw)}</td><td>${esc(String(l.peak_ts).slice(0, 13).replace('T', ' '))}</td><td class="num">${ok(l.fc?.mape) ? l.fc.mape.toFixed(2) + '%' : 'not held'}</td><td class="num">${ok(l.fc?.bias_mw) ? n0(l.fc.bias_mw) : 'not held'}</td></tr>`; }).join('')}</tbody></table></div>` + CH.lineChart([2023, 2024, 2025, 2026].map(y => ({ name: String(y), dashed: y === 2026, points: SY.loadMonth.filter(m => m.y === y).map(m => ({ x: m.m, y: m.peak_mw })) })), { fmt: v => `${(v / 1000).toFixed(1)} GW`, xfmt: v => (Number.isInteger(v) ? ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][v] || '' : ''), title: 'Monthly system peak', height: 170, xLabel: 'Month' }) : wait('system', 'system data'), { answer: aLoad, foot: '* part year, not annualised. Zone SYSTEM only: the database holds no zonal load or long-term load forecast; the forecast is the day-ahead posting, so it measures forecast accuracy, not growth.' })}
      ${card('c-6', 'Interchange by interface', 'Mean hourly flow by year, MW (sign as published by ISO-NE)', SY ? (() => { const ifs = [...new Set(SY.interchange.map(x => x.interface))]; const ys = [...new Set(SY.interchange.map(x => x.y))].sort(); const at = (i, y) => SY.interchange.find(x => x.interface === i && x.y === y); return `<div class="table-wrap"><table class="dense"><thead><tr><th>Interface</th>${ys.map(y => `<th class="num">${y}${y === 2026 ? '*' : ''}</th>`).join('')}</tr></thead><tbody>${ifs.map(i => `<tr><td>${esc(i)}</td>${ys.map(y => `<td class="num">${at(i, y) ? n0(at(i, y).mean_mw) : 'not held'}</td>`).join('')}</tr>`).join('')}<tr><td><b>Sum of means</b></td>${ys.map(y => { const v = ifs.map(i => at(i, y)?.mean_mw); return `<td class="num"><b>${v.every(ok) ? n0(v.reduce((a, b) => a + b, 0)) : 'partial'}</b></td>`; }).join('')}</tr></tbody></table></div>`; })() : wait('system', 'system data'), { answer: aIc, foot: 'The HQ and New Brunswick ties carry negative means (import paths). A sum is printed only where every interface is held that year. * part year.' })}
      ${card('c-6', 'Supply by zone', 'Operating capacity, retirements 2024–28 and queue MW', SU ? CH.groupedBar(ZONES.map(z => ({ label: z, values: [opCap(z), retMW(z), qMW(z)] })), { series: ['Operating capacity', 'Retiring 2024–28', 'Queue (unified)'], fmt: v => `${(v / 1000).toFixed(1)} GW`, title: 'Supply by zone', height: 220, xLabel: 'Zone' }) : wait('supply', 'supply data'), { answer: aSup, foot: SU ? `Operating = dim_generator status Operating, max capacity, zone from its bus (${n0(SU.generators.filter(g => !g.zone && g.status === 'Operating').reduce((t, g) => t + (g.cap_mw || 0), 0))} MW without a zoned bus). No fuel type is held for generators.` : '' })}
      ${card('c-6', 'Retirements', 'dim_retirement: announced plant retirements', SU ? `<div class="table-wrap"><table class="dense sortable"><thead><tr><th>Date</th><th>Plant</th><th>Zone</th><th class="num">MW</th><th>County</th></tr></thead><tbody>${SU.retirements.map(x => `<tr><td>${esc(x.year)}-${String(x.month).padStart(2, '0')}</td><td>${esc(x.plant_name)}</td><td>${esc(x.zone || `${x.load_zone} (unattributed)`)}</td><td class="num">${n1(x.mw)}</td><td>${esc(x.plant_county)}, ${esc(x.plant_state)}</td></tr>`).join('')}</tbody></table></div>` : wait('supply', 'supply data'), { answer: aRet })}
      ${card('c-6', 'Queue by zone and resource', 'Unified dim_queue: requests in the solved case, MW', SU ? (() => { const types = [...new Set(SU.queue.map(q => q.resource_type))].sort(); const zs = [...ZONES, null]; return `<div class="table-wrap"><table class="dense"><thead><tr><th>Zone</th>${types.map(t => `<th class="num">${esc(t)}</th>`).join('')}<th class="num">Total</th><th class="num">Requests</th></tr></thead><tbody>${zs.map(z => { const qs = SU.queue.filter(q => (q.zone || null) === z); return `<tr><td>${z || 'not attributed'}</td>${types.map(t => `<td class="num">${n0(qs.filter(q => q.resource_type === t).reduce((a, q) => a + (q.max_mw || 0), 0)) || '—'}</td>`).join('')}<td class="num"><b>${n0(qs.reduce((a, q) => a + (q.max_mw || 0), 0))}</b></td><td class="num">${qs.length}</td></tr>`; }).join('')}</tbody></table></div>`; })() : wait('supply', 'supply data'), { answer: aQz, foot: 'Zone from the nearest geolocated bus within 25 km of the request coordinates (an attribution, not a bus key).' })}
      ${card('c-6', 'Queue register by entry year', 'Every public ISO-NE request: withdrawn, active, in service — Studio copy (older database)', ST ? CH.stackedBar(ST.queueTrends.rows.filter(q => q.entry_year >= 2005).map(q => ({ label: String(q.entry_year), values: [q.withdrawn, q.active, q.in_service] })), { series: ['Withdrawn', 'Active', 'In service'], fmt: v => fmt.int(v), title: 'Queue register by entry year', height: 220, xLabel: 'Entry year' }) : wait('studio', 'the Studio copy'), { answer: aQr, foot: ST ? `${fmt.int(ST.queueTrends.meta?.projects)} records (derived.mart_queue_trends). Withdrawn share by decade: ${(ST.queueTrends.meta?.decades || []).map(d => `${d.decade}s ${(100 * d.withdrawn_share).toFixed(1)}%`).join(' · ')}. The unified database holds only the ${SU ? SU.queue.length : '…'} requests in the solved case.` : '' })}
      ${card('c-6', 'Zone crowding', `Share of each zone's buses that clear ${fmt.mw(reqSize(r))} (Studio 1.08), tightest first`, CH.barChart(rg.slice().sort((a, b) => (a.metShare ?? 1) - (b.metShare ?? 1)).map(z => ({ label: z.zone, value: ok(z.metShare) ? 100 * z.metShare : null })), { fmt: v => `${v.toFixed(0)}%`, title: 'Zone crowding', height: 200, xLabel: 'Zone', yLabel: 'Share meeting' }), { answer: aCrowd, foot: 'Buses against the limits they publish; queued MW is shown separately above, never netted off headroom.' })}
      ${card('c-6', 'Network cost per kW by zone', `Median $/kW at 100 and 250 MW, ${S.tech}, Grid rules (Studio 8.42)`, CH.groupedBar(zc.map(x => ({ label: x.z, values: [x.c100.median, x.c250.median] })), { series: ['100 MW', '250 MW'], fmt: v => `$${n0(v)}`, title: 'Network cost per kW', height: 200, xLabel: 'Zone' }) + `<div class="table-wrap"><table class="dense" data-cost-sample><thead><tr><th>Zone</th><th class="num">n at 100 MW</th>${COST_STATUSES.map(st => `<th class="num">${esc(st)}</th>`).join('')}<th class="num">n at 250 MW</th></tr></thead><tbody>${zc.map(x => `<tr><td>${esc(x.z)}</td><td class="num"><b>${fmt.int(x.c100.n)}</b> of ${fmt.int(x.c100.buses)}</td>${COST_STATUSES.map(st => `<td class="num">${fmt.int(x.c100.byStatus[st] || 0)}</td>`).join('')}<td class="num">${fmt.int(x.c250.n)} of ${fmt.int(x.c250.buses)}</td></tr>`).join('')}</tbody></table></div>`, { answer: aCost, chips: env100 ? 'envelope-only' : '', foot: `Screening cost from the facilities a request overloads (stepCostService). The median is over priced or true-zero buses only (n above); lower bounds, partly priced and "No upgrades indicated" are left out${env100 ? `, and ${fmt.int(env100)} envelope-only buses ("No upgrades indicated", not a verified $0) are excluded from every median, which skews it toward costly buses` : ''}. Not an allocated upgrade bill.` })}
      ${card('c-12', 'Data notes: unified database against the Studio copy', 'Where the two sources disagree, the unified database is used and the difference is stated', dataNotes(study, Z, SY, ST), { answer: aNotes })}
      ${traceCard([TR.traceRegions(rg, evAll.filter(e => e.status !== 'excluded').length), Z ? TR.traceBasis(Z, zy) : '', SY ? TR.traceGenmix(SY, ST) : '', SY ? TR.traceLoad(SY) : '', SU ? TR.traceSupply(SU) : '', TR.traceCost(cost, study, S)])}
    </div>
    ${nextStep('land', 'area', 'check the land around the candidate in Land › Buildable area')}`;
}

function dataNotes(study, Z, SY, ST) {
  if (!ST) return wait('studio', 'the Studio copy');
  const cols = ST.nodes.cols, ix = k => cols.indexOf(k), by = new Map(ST.nodes.rows.map(r => [String(r[0]), r]));
  const cmp = (label, getU, key, tol, unit) => {
    let n = 0, diff = 0, maxd = 0, maxBus = null;
    for (const node of study.nodes) { const s = by.get(String(node.bus_id)); if (!s) continue; const a = getU(node), b = s[ix(key)]; if (!ok(a) || !ok(b)) continue; n++; const d = Math.abs(a - b); if (d > tol) diff++; if (d > maxd) { maxd = d; maxBus = node; } }
    return `<tr><td>${esc(label)}</td><td class="num">${fmt.int(n)}</td><td class="num">${fmt.int(diff)}</td><td class="num">${unit === '$' ? '$' + maxd.toFixed(2) : n0(maxd)}</td><td>${maxBus ? `${esc(maxBus.name)} ${maxBus.bus_id}` : '—'}</td><td class="wrap">Tolerance ${unit === '$' ? '$' + tol.toFixed(2) : tol}. Unified used.</td></tr>`;
  };
  const zoneDiff = study.nodes.filter(n => { const s = by.get(String(n.bus_id)); return s && s[ix('zone_fixed')] && s[ix('zone_fixed')] !== n.zone; }).length;
  const zoneRows = Z ? ZONES.map(z => { const u = Z.years.find(x => x.zone === z && x.market === 'RT' && x.y === 2025), s = ST.zonesVsHub.find(x => x.zone === z && x.market === 'RT' && x.year === 2025); return u && s ? Math.abs(u.bhub - s.basis_mean) : null; }).filter(ok) : [];
  const negRows = Z ? ZONES.map(z => { const u = Z.years.find(x => x.zone === z && x.market === 'RT' && x.y === 2025), s = ST.zoneNegHours.find(x => x.zone === z && x.year === 2025); return u && s ? u.neg - s.neg_hours : null; }).filter(ok) : [];
  const genD = SY ? (() => { const u = SY.gen.filter(g => g.y === 2025), s = ST.outlook.filter(o => o.scenario === 'hist' && o.year === 2025); const d = u.map(g => { const o = s.find(x => x.fuel === g.fuel); return o ? Math.abs(g.mwh - o.mwh) / Math.max(1, o.mwh) : null; }).filter(ok); return d.length ? Math.max(...d) : null; })() : null;
  return `<div class="table-wrap"><table class="dense"><thead><tr><th>Quantity</th><th class="num">Compared</th><th class="num">Differ</th><th class="num">Largest difference</th><th>At</th><th>Note</th></tr></thead><tbody>
    ${cmp('2025 RT average price per bus', n => n.lmp_2025, 'lmp_2025', 0.5, '$')}
    ${cmp('2030 forecast price per bus (pcr2030)', n => n.lmp_2030, 'lmp_2030', 0.5, '$')}
    ${cmp('2025 negative RT hours per bus', n => n.hneg_2025, 'hneg_2025', 0, 'h')}
    ${cmp('2030 daily 4-hour spread per bus', n => n.m?.tb4_30, 'tb4_2030', 0.5, '$')}
    <tr><td>Load-zone attribution per bus</td><td class="num">${fmt.int(study.nodes.length)}</td><td class="num">${fmt.int(zoneDiff)}</td><td class="num">—</td><td>—</td><td class="wrap">Studio zone after its zone_fix vs unified dim_bus.load_zone (${(Z?.zoneSource || []).map(s => `${s.source} ${fmt.int(s.n)}`).join(', ') || 'source mix loading'}).</td></tr>
    <tr><td>Zone basis vs hub, RT 2025</td><td class="num">${zoneRows.length}</td><td class="num">${zoneRows.filter(d => d > 0.01).length}</td><td class="num">${zoneRows.length ? '$' + Math.max(...zoneRows).toFixed(3) : '—'}</td><td>8 zones</td><td class="wrap">Both hour-matched against .H.INTERNAL_HUB.</td></tr>
    <tr><td>Zone negative hours, RT 2025</td><td class="num">${negRows.length}</td><td class="num">${negRows.filter(d => d !== 0).length}</td><td class="num">${negRows.length ? n0(Math.max(...negRows.map(Math.abs))) + ' h' : '—'}</td><td>8 zones</td><td class="wrap">Count of hours below $0.</td></tr>
    <tr><td>2025 generation by fuel</td><td class="num">${SY ? SY.gen.filter(g => g.y === 2025).length : '—'}</td><td class="num">${ok(genD) ? (genD > 1e-4 ? 'some' : '0') : '—'}</td><td class="num">${ok(genD) ? (100 * genD).toFixed(4) + '%' : '—'}</td><td>fuels</td><td class="wrap">Same hourly-mean method; the Studio figure comes from GridSense_one.duckdb.</td></tr>
    <tr><td>2030 price at unpriced run nodes</td><td class="num">${fmt.int(study.nodes.filter(n => n.m?.unpriced).length)}</td><td class="num">${fmt.int(study.unpricedFixed || 0)}</td><td class="num">—</td><td>—</td><td class="wrap">/api/market reports $0.00 where the pcr2030 run holds LMP = 0 in every hour; shown here as not held.</td></tr>
  </tbody></table></div><p class="audit-note">Studio copy: data.js built ${esc(ST.gsData.built_at)} (${esc(ST.gsData.source)}); data-ext.js built ${esc(ST.gsDataExt.built_at)}. The Studio's curtailment ramps (vendor, 2,676 of 2,678 unvalidated) and its top-constraint names (no overlap with real constraints) are excluded, as in the unified database.</p>`;
}

export function renderMarket(tab, ctx) {
  if (!ctx.data.study) return '<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Loading every ISO-NE bus</b><span>Limits, prices and facility rows for 2,678 buses from the local database (about 2 MB, loaded once).</span></div>';
  ensureExtras();
  if (withMeasures(ctx.data.study)) MEMO.clear();
  if (withCurtail(ctx.data.study)) MEMO.clear();
  const measuresNote = extra('measures') ? '' : `<div class="notice${extraError('measures') ? ' error' : ''}" role="status">${extraError('measures') ? `Could not load the extra screening measures (${esc(extraError('measures'))}); rankings use the measures in the screen only.` : 'Loading the extra screening measures (price history, spreads, basis, forecast runs)…'}</div>`;
  return measuresNote + ({ find: tabFind, rank: tabRank, size: tabSize, regions: tabRegions }[tab] || tabFind)(ctx);
}
