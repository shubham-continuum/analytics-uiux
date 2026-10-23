// Land dashboard: can a site here accommodate the project?
// Data: data/land.json (Studio copy: exclusion screens for 166 buses, county land-cost assumption band, land-use
// intensity); /api/x/land/site/<bus> (unified DB: substation, price link, headroom, stations/buses/generators/loads
// within a radius, branches, queue, planned upgrades, plus the Studio-copy comparison). Rules in ../landcore.js.
import {
  footprint, screen, fit, fitLabel, siteControl, landRate, corridor, miles, discSplit, blockCover, needMatrix, costGrid,
  leaseVsBuy, stationGroups, requestSide, requestCases, perMile, lineCostGrid, landVerdict, stationVerdict, countFits, stationCoverage, permitTiming,
  permitTimeline, excludedRange, pctRank, siteExclusionNote, LAYER_SOURCE, PERMIT_STATES, permitList, permitSummary, permitRows, permitCounts, PERMIT_DISCLAIMER, depthOf,
} from '../landcore.js';
import { ENVELOPE_ONLY } from '../gridrules.js';
import * as RX from '../rules/isone.js';
import { fmt } from '../basis.js';
import * as C from '../charts.js';
import { geoMap, geoMapSvg, geoLegend } from '../geomap.js';
import { ringDiagram, gauge, landMapSpec, LAND_CSS } from './land-charts.js';
import { boxOf, padExtent, padFor, mapGeom, frameMap, afterMapRender, categoryBar, tabEnter } from './mapview.js';
// The four analyses as they were before the map view (restored 2026-10-23): each is its own tab again.
import { renderLand as renderLandTab } from './land-tabs.js';
import {
  traceArea, traceFootprint, traceCorridor, utmNote, verifyNote, traceRing, traceCover, traceNeighbours, traceNeedCurve,
  traceCostGrid, traceLeaseBuy, traceAlts, traceLineGrid, traceStrength, tracePermits, traceSiteControl, traceTimeline,
} from './land-trace.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
// key = '<group>.<figure>' (data-kg / data-kpi): the figure's stable name wherever it sits (the KPI row or a float).
const kpi = (label, value, unit, note, key) => { const [g, k] = String(key || '').split('.'); return `<div class="kpi${value === 'not held' ? ' nh' : ''}"${k ? ` data-kg="${g}" data-kpi="${k}"` : ''}><div class="label">${esc(label)}</div><div class="value">${esc(value)}${unit ? `<span class="unit">${esc(unit)}</span>` : ''}</div>${note ? `<div class="note" title="${esc(note)}">${esc(note)}</div>` : ''}</div>`; };
// data-depth = the MINIMUM depth at which the card shows (the shell hides cards above the current depth).
// Depth / trace / provenance per card title where the call does not pass them (one table, not scattered options).
const LAND_META = {
  'Disc composition': { trace: 'l-ring', chips: 'studio-copy' }, 'Constraint layers': { trace: 'l-area', chips: 'studio-copy' }, 'Largest block vs need': { trace: 'l-cover', chips: 'studio-copy' },
  'Screened buses nearby': { trace: 'l-neighbours', chips: 'studio-copy' }, 'Block share comparison': { trace: 'l-neighbours', chips: 'studio-copy' },
  'Need across project sizes': { trace: 'l-needcurve', chips: 'assumption' }, 'Need by technology': { chips: 'assumption' }, 'Need matrix': { trace: 'l-needcurve', chips: 'assumption' },
  'Land cost sensitivity': { trace: 'l-costgrid', chips: 'assumption' }, 'Lease vs buy (NPV)': { trace: 'l-leasebuy' },
  'Site map': { depth: 'screen', trace: 'l-corridor' }, 'Site and line assumptions': { trace: 'l-corridor', chips: 'assumption' },
  'Alternative connection stations': { depth: 'screen', trace: 'l-alts', chips: 'envelope-only' }, 'Headroom per mile of tie': { trace: 'l-alts', chips: 'envelope-only' },
  'Line cost sensitivity': { depth: 'study', trace: 'l-linegrid', chips: 'assumption' }, 'Lines at the bus': { depth: 'study' }, 'Model buses within 10 miles': { depth: 'study' },
  'Queue within 25 miles': { depth: 'review' }, 'Planned upgrades within 15 miles': { depth: 'review' }, 'Data notes: unified DB vs the Studio copy': { depth: 'study', chips: 'studio-copy' },
  'Permit checklist': { depth: 'screen', trace: 'l-permits', chips: 'assumption' }, Status: { depth: 'screen', trace: 'l-permits' }, 'Site control': { trace: 'l-sitecontrol' },
  Timeline: { trace: 'l-timeline' }, 'Screen prompts': { chips: 'studio-copy' }, 'Ordinance and site-control evidence': { chips: 'not-held' },
};
const card = (span, title, sub, body, foot = '', depth, o0 = {}) => { const o = { ...(LAND_META[title] || {}), ...o0 }; depth = depth || o.depth || 'review'; return `<section class="card c-${span}" data-depth="${depth}"${o.trace ? ` data-trace="${esc(o.trace)}"` : ''}${o.chips ? ` data-chips="${esc(o.chips)}"` : ''}><header class="card-h"><h3>${esc(title)}</h3>${sub ? `<span class="card-sub">${esc(sub)}</span>` : ''}</header><div class="card-b">${o.answer ? `<p class="card-answer">${o.answer}</p>` : ''}${body}</div>${foot ? `<footer class="card-f">${foot}</footer>` : ''}</section>`; };
const traceCard = (...t) => { const p = t.filter(Boolean); return `<section class="card c-12 card-trace" data-depth="study"><header class="card-h"><h3>Calculations</h3><span class="card-sub">formula, inputs with sources, working, check and CSV for every figure in this group</span></header><div class="card-b"><p class="card-answer"><b>${p.length}</b> calculation${p.length === 1 ? '' : 's'} in this group, each with its inputs, working and a check.</p>${p.join('')}</div></section>`; };
const B = v => `<b>${esc(v)}</b>`;
/** v6: every view ends with one named next step (the shell's goto action). */
const nextStep = (stage, tab, words) => `<div class="next-step" style="display:flex;justify-content:flex-end;margin:6px 0 0"><button type="button" class="primary tiny" style="margin:0" data-act="goto" data-v="${stage}" data-tab="${tab}">Next: ${esc(words)} →</button></div>`;
const emptyBox = (title, why) => `<div class="empty"><strong>${esc(title)}</strong>${esc(why)}</div>`;
const ac = v => (ok(v) ? `${Math.round(v).toLocaleString('en-US')} ac` : 'not held');
const acN = v => (ok(v) ? Math.round(v).toLocaleString('en-US') : 'not held');
const pct = v => (ok(v) ? `${v.toFixed(1)}%` : 'not held');
const tbl = (head, rows, empty = 'No rows.') => `<div class="table-wrap"><table class="dense"><thead><tr>${head.map(h => `<th${h.startsWith('#') ? ' class="num"' : ''}>${esc(h.replace(/^#/, ''))}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : `<tr><td colspan="${head.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const td = v => `<td>${esc(v)}</td>`, tn = v => `<td class="num">${esc(v)}</td>`;
const num = (k, S, label, unit, ph = 'enter') => `<label class="field">${esc(label)} <span class="pill">${ok(S.ui.land?.[k]) ? 'U' : 'NH'}</span><input type="number" step="any" data-act="land" data-k="${k}" value="${ok(S.ui.land?.[k]) ? S.ui.land[k] : ''}" placeholder="${esc(ph)}"><span class="audit-note">${esc(unit)}</span></label>`;
/** A value that is set, as a chip in the strip: its × runs the same action as the field that set it, back to blank. */
// A chip clears one input through that input's own action (mk-chip forwards to data-a), so a selector for the input never
// also finds its chip.
const chip = (text, act, k, v, title) => `<button type="button" class="mk-chip" data-act="mk-chip" data-a="${act}"${k ? ` data-k="${k}"` : ''} data-v="${esc(v)}" title="${esc(title)}">${esc(text)}<span aria-hidden="true">×</span></button>`;
const stripTags = s => String(s ?? '').replace(/<[^>]+>/g, '');
const projectMW = S => Number(S.tech === 'datacenter' ? S.importMW : S.exportMW);
const BLOCK = 'Largest block outside habitat/protected land';
const SCREEN_NOTE = 'Screening area: a disc centred on the bus, not a parcel or a site boundary. Only habitat and protected land are subtracted (water, urban land, wetlands and slope are not screened), so the block is an upper bound and "fits" means fits on this screen only.';
const X_SRC = 'Studio copy (data-ext.js exclusions; not in the unified DB)';
const TECHS = ['solar', 'wind', 'storage', 'hybrid', 'datacenter'];
const TECH_LABEL = { solar: 'Solar', wind: 'Wind', storage: 'Storage', hybrid: 'Solar + storage', datacenter: 'Data centre' };
const SIZES = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const STUDIO_PER_MILE = [1e6, 2e6, 3e6, 4e6]; // the live Studio's tie-cost slider range (2.10): an assumption, not a quote
const FACTORS = [1, 1.15, 1.3, 1.5]; // the Studio's route allowances 0 / 15 / 30 / 50 %

// The four analyses: their own tabs again (2026-10-23), and the groups of inputs on the Map tab (the bar's lean v8 names).
const GROUPS = [
  { id: 'area', label: 'Buildable area', short: 'Area' },
  { id: 'footprint', label: 'Footprint & land cost', short: 'Cost' },
  { id: 'corridor', label: 'Connection corridor', short: 'Route', labelFor: t => (t === 'datacenter' ? 'Supply corridor' : 'Connection corridor') },
  { id: 'permits', label: 'Permits & site control', short: 'Permits', labelFor: t => ({ wind: 'Permits, aviation & site control', storage: 'Permits, fire code & site control', datacenter: 'Permits & utility service' }[t] || 'Permits & site control') },
];
const groupLabel = (id, tech) => { const g = GROUPS.find(x => x.id === id); return (g.labelFor && g.labelFor(tech)) || g.label; };
/** A step or link naming a tab by its lean name or label (any fuel) → the tab. */
const FOCUS = Object.fromEntries(GROUPS.flatMap(g => [g.id, g.short, g.label, ...(g.labelFor ? TECHS.map(t => g.labelFor(t)) : [])].map(k => [String(k).toLowerCase(), g.id])));

export const LAND = {
  key: 'land',
  question: 'Can this site accommodate the project?',
  lede: 'The map first: the clear land the screen finds around the bus and the project\'s need drawn to scale, the stations a tie could reach and whether they clear the request, and the placed site with its line, with the inputs and the stations beside it. Area, Cost, Route and Permits each keep their full analysis on their own tab, as before (the permit checklist starts at the top of its page).',
  // The map is one tab; the four analyses are their own tabs again (2026-10-23), so the permit checklist or a corridor
  // table starts at the top of its page instead of under the map. One bar (views/mapview.js) draws them as buttons.
  ownTabs: true,
  tabs: [
    { id: 'map', label: 'Land map' },
    { id: 'area', label: 'Buildable area' },
    { id: 'footprint', label: 'Footprint & land cost' },
    { id: 'corridor', label: 'Connection corridor', labelFor: t => (t === 'datacenter' ? 'Supply corridor' : 'Connection corridor') },
    { id: 'permits', label: 'Permits & site control', labelFor: t => ({ wind: 'Permits, aviation & site control', storage: 'Permits, fire code & site control', datacenter: 'Permits & utility service' }[t] || 'Permits & site control') },
  ],
  tabAlias: { ...Object.fromEntries(Object.entries(FOCUS).filter(([k, v]) => k !== v)), map: 'map' },
  needsLand: true,
};

// ---------- /api/x/land/site5/<bus> (unified DB; v4 added the shoulder-charge envelope, v5 the whole radius). Falls back to the pre-v4
// 'site' route (no hr_sh_chg: storage and hybrid stations then read as unknown, never as a pass) until the server reloads.
const SITE = new Map();
const getJson = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(Object.assign(new Error(`HTTP ${r.status}`), { status: r.status }))));
function siteData(bus) {
  const k = String(bus);
  if (!SITE.has(k)) {
    SITE.set(k, 'loading');
    // P2: site5 = the whole station radius + per-station element rows (D6.1 verdicts); older routes are read only until the
    // server carries it, and then every station reads Envelope only (Hold) and a capped list says it is truncated.
    const route = r => getJson(`./api/x/land/${r}/${encodeURIComponent(k)}`);
    const or404 = (p, next) => p.catch(e => (e.status === 404 ? next() : Promise.reject(e)));
    or404(route('site5'), () => or404(route('site4'), () => or404(route('site'), () => null)))
      .then(j => SITE.set(k, j), e => SITE.set(k, e))
      .finally(() => import('../app.js').then(m => (m.renderSoon || m.render)()));
  }
  return SITE.get(k);
}
/** The request in words: "100 MW export + 100 MW charge" etc. */
const CASE_LABEL_SHORT = k => ({ 'summer_peak|discharge': 'summer-peak injection binds', 'shoulder|discharge': 'shoulder injection binds', 'summer_peak|charge': 'summer-peak withdrawal binds', 'shoulder|charge': 'shoulder charge binds', 'large_load|charge': 'large-load withdrawal binds' }[k] || 'binding case not held');
// P2 C07: MW as entered, the Grid › Connection capacity request (caseTable(…, exportMW, importMW)).
const reqWords = (tech, S) => { const cs = requestCases(tech), dirs = [...new Set(cs.map(c => c.dir))]; return dirs.map(d => { const v = Number(d === 'export' ? S.exportMW : S.importMW), m = ok(v) && v > 0 ? v : null; return `${ok(m) ? fmt.mw(m) : 'no MW'} ${d === 'export' ? 'export' : tech === 'datacenter' ? 'import' : 'charge'}`; }).join(' + '); };
const pending = P => (P === 'loading' ? '<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Reading the area around the bus…</b><span>Stations, buses, generators, queue and upgrades from the unified database.</span></div>'
  : P instanceof Error ? `<div class="notice error" role="alert">Could not read the area around this bus: ${esc(P.message)}</div>`
    : !P ? emptyBox('This bus is not in the unified DB', 'Nothing around it can be measured.') : '');
const ready = P => P && P !== 'loading' && !(P instanceof Error);

/** Screened neighbours joined to their screens; this bus first when it has one. */
function neighbourRows(data, S, node, P, fp) {
  const rows = [];
  const add = (id, name, kv, mi, county, state) => { const s = screen(data.land.exclusions, id); if (!s) return; rows.push({ id: String(id), name, kv, mi, county, state, radius: s.radiusMi, gross: s.gross, clear: s.clear, share: ok(s.gross) && s.gross > 0 && ok(s.clear) ? (100 * s.clear) / s.gross : null, blocks: s.blocks, water: s.water === true ? 'excluded' : 'not excluded', fits: fp && ok(fp.base) && ok(s.clear) ? (s.clear >= fp.base ? 'fits*' : 'does not fit') : 'unknown', self: String(id) === String(S.nodeId) }); };
  add(S.nodeId, node?.name, node?.nominal_kv, 0, node?.county, node?.state_code);
  if (ready(P)) for (const r of P.screened || []) add(r.bus_id, r.substation_name, r.nominal_kv, r.mi, r.county, r.state_code);
  return rows;
}

// ---------- Group 1: buildable area ----------
function partArea({ data, S, node }) {
  const sc = screen(data.land.exclusions, S.nodeId), mw = projectMW(S), fp = footprint(data.land.intensity, S.tech, mw);
  const cov = blockCover(fp, sc), split = discSplit(sc), rng = excludedRange(sc), P = siteData(S.nodeId);
  const layers = sc ? [...sc.subtracted.map(l => ({ ...l, kind: 'Excluded' })), ...sc.advisory.map(l => ({ ...l, kind: 'Advisory (not subtracted)' }))] : [];
  const nb = neighbourRows(data, S, node, P, fp), others = nb.filter(r => !r.self);
  const x = v => (ok(v) ? `${v.toFixed(2)}×` : 'not held');
  const K = {
    disc: kpi('Screening area', ac(sc?.gross), '', sc ? `${sc.radiusMi}-mile disc around the bus · ${X_SRC}` : 'No exclusion screen for this bus (166 of 2,678 are screened); never assumed clear', 'area.disc'),
    block: kpi(BLOCK, ac(sc?.clear), '', sc ? `${sc.blocks} blocks in total · upper bound (water, urban land, wetlands, slope not screened)` : 'not screened here', 'area.block'),
    excluded: kpi('Excluded, habitat + protected only', rng ? (Math.abs(rng.high - rng.low) < 0.5 ? pct((100 * rng.low) / rng.gross) : `${pct((100 * rng.low) / rng.gross)} – ${pct((100 * rng.high) / rng.gross)}`) : 'not held', '', rng ? `Layers overlap, so the net share is a range; airport zones are advisory. ${pct(100 * sc.excludedShare)} lies outside the largest block.` : 'No screen', 'area.excluded'),
    ratio: kpi('Largest block ÷ base need', x(cov.base), '', cov.base == null ? (fp ? 'Unknown: no screen held; unknown never passes' : 'Enter a project size') : `${fitLabel(cov.status)} · ${fmt.mw(mw)} ${TECH_LABEL[S.tech] || S.tech} needs ${ac(fp.base)} (range ${ac(fp.low)}–${ac(fp.high)})`, 'area.ratio'),
  };
  const useB = fp && sc && ok(sc.clear) && sc.clear > 0 ? (100 * fp.base) / sc.clear : null, useH = fp && sc && ok(sc.clear) && sc.clear > 0 && ok(fp.high) ? (100 * fp.high) / sc.clear : null;
  // v6 answers
  const nm = node?.name || 'this bus', loadingA = 'Reading the area around the bus from the unified database…';
  const aDisc = sc ? `The ${esc(sc.radiusMi)}-mile disc holds ${B(ac(sc.gross))}; the largest block outside habitat and protected land is ${B(ac(sc.clear))} (an upper bound).` : `No exclusion screen is held for ${B(nm)}: buildable area is unknown, never assumed clear.`;
  const bigL = sc ? sc.subtracted.filter(l => ok(l.value) && l.value > 0).sort((a, b) => b.value - a.value)[0] : null;
  const unsc = sc?.unscreened?.length ? ` ${B(sc.unscreened.join(', '))} is not screened here (layer coverage): not a clean result.` : '';
  const aLayers = !sc ? 'Not held: no screen for this bus.' : bigL ? `${B(bigL.layer)} is the largest excluded layer at ${B(ac(bigL.acres))} (${B(pct(100 * bigL.share))} of the disc); advisory layers are shown, not removed.${unsc}` : `No screened layer has acres in the disc.${unsc}`;
  const aCover = ok(useB) ? `The base need of ${B(ac(fp.base))} uses ${B(`${useB.toFixed(1)}%`)} of the largest block: ${esc(fitLabel(cov.status))}.` : !fp ? 'Enter a project size to compare need with the block.' : `Unknown: no screen is held for ${B(nm)}, and unknown never passes.`;
  const fitsN = others.filter(r => r.fits === 'fits*').length;
  const aNb = !ready(P) ? loadingA : others.length ? `${B(fmt.int(others.length))} screened bus${others.length === 1 ? '' : 'es'} lie nearby; ${B(fmt.int(fitsN))} would fit ${esc(fmt.mw(mw))} on the screen (upper bound).` : 'No other screened bus lies within reach.';
  const topShare = nb.filter(r => ok(r.share)).sort((a, b) => b.share - a.share)[0];
  const aShare = topShare ? `${B(topShare.name)} has the largest clear share of its disc: ${B(pct(topShare.share))}.` : 'No block share is held for this bus or its neighbours.';
  const opMW = ready(P) && P.gens ? P.gens.filter(g => g.status === 'Operating').reduce((t, g) => t + (g.max_mw || 0), 0) : null;
  const aGen = !ready(P) ? loadingA : P.gens?.length ? `${B(`${opMW.toFixed(1)} MW`)} of operating generation sits within 10 miles (${B(fmt.int(P.gens.length))} unit records).` : 'No generator with a coordinate lies within 10 miles.';
  const aUse = !ready(P) ? loadingA : `Within reach: ${B(fmt.int(P.buses?.length ?? 0))} model buses (10 mi), ${B(fmt.int((P.queue || []).length))} queue requests (25 mi) and ${B(ok(P.loads?.n) ? fmt.int(P.loads.n) : 'not held')} load points (10 mi).`;
  const cards = () => {
    const noScreen = emptyBox(`No exclusion screen for ${node?.name || 'this bus'}`, 'Screens exist for 166 buses (the example projects, the Studio seed options and the top 50 by score per fuel). Buildable area here is unknown and never assumed clear; the nearest screened buses are listed below.');
    const ring = split ? ringDiagram([{ label: 'Largest block', value: split.block, color: 'var(--ok)' }, { label: 'Certainly excluded', value: split.excludedMin, color: 'var(--bad)' }, { label: 'Other excl. / fragments', value: split.rest, color: 'var(--ink-4)' }], { centre: ac(split.gross), sub: `${sc.radiusMi}-mi disc` }) : noScreen;
    const layerChart = sc ? C.barChart(layers.map(l => ({ label: `${l.layer === 'energy-community' ? 'energy comm.' : l.layer}${l.subtracted ? '' : ' (adv.)'}`, value: l.value, note: l.status === 'missing' ? `not held: ${l.reason}` : l.subtracted ? 'subtracted' : 'advisory, not subtracted' })), { fmt: v => `${Math.round(v).toLocaleString('en-US')} ac`, title: 'Acres by layer inside the disc', xLabel: 'Layer', yLabel: 'Acres', height: 200 }) : noScreen;
    const gaugeBox = ok(useB) ? gauge({ value: useB, max: Math.min(200, Math.max(100, (useH || 0) * 1.15)), marks: [{ v: 100, label: 'block' }, ...(ok(useH) && useH < 85 ? [{ v: useH, label: 'high' }] : [])], fmt: v => `${v.toFixed(1)}%`, label: 'Base need as % of the largest block', tone: useB <= 100 ? 'var(--ok)' : 'var(--bad)', note: `need ${ac(fp.low)} / ${ac(fp.base)} / ${ac(fp.high)} of a ${ac(sc.clear)} block · cover ${x(cov.low)} / ${x(cov.base)} / ${x(cov.high)}` })
      : emptyBox('Gauge not held', !fp ? 'Enter a project size in the project strip.' : 'No exclusion screen is held for this bus, so the block is unknown.');
    const nbTable = tbl(['Bus', '#kV', 'County', '#Miles', '#Radius', '#Disc (ac)', '#Largest block (ac)', '#Block share', '#Blocks', 'Water', `Fits ${fmt.mw(mw)}`],
      nb.map(r => `<tr${r.self ? ' class="hl"' : ''}>${td(`${r.name}${r.self ? ' (this bus)' : ''}`)}${tn(r.kv)}${td(`${r.county || '—'}, ${r.state || '—'}`)}${tn(r.self ? '0.0' : r.mi.toFixed(1))}${tn(`${r.radius} mi`)}${tn(acN(r.gross))}${tn(acN(r.clear))}${tn(pct(r.share))}${tn(r.blocks)}${td(r.water)}${td(r.fits)}</tr>`), ready(P) ? 'No screened bus found.' : 'Loading…');
    const nbChart = C.barChart(nb.slice(0, 8).map(r => ({ label: `${r.name.slice(0, 11)}${r.self ? ' ★' : ''}`, value: r.share, note: `${r.self ? 0 : r.mi.toFixed(1)} mi · ${r.radius}-mi disc` })), { fmt: v => `${v.toFixed(1)}%`, title: 'Largest-block share of disc: nearby screened buses', xLabel: 'Bus', yLabel: 'Block share', height: 220, emptyText: 'No screened bus nearby.' });
    // Land use around the bus (unified DB): existing generation and load within 10 mi.
    let use = pending(P), useTable = pending(P);
    if (ready(P) && P.gens) {
      const byPlant = new Map();
      for (const g of P.gens) { const k = `${g.gen_name}`; const e = byPlant.get(k) || { name: g.gen_name, mi: g.mi, op: 0, off: 0, units: 0, opMax: 0, offMax: 0 }; e.mi = Math.min(e.mi, g.mi); e.units += g.units; if (g.status === 'Operating') { e.op += g.units; e.opMax += g.max_mw || 0; } else { e.off += g.units; e.offMax += g.max_mw || 0; } byPlant.set(k, e); }
      const plants = [...byPlant.values()].sort((a, b) => (b.opMax + b.offMax) - (a.opMax + a.offMax));
      const sum = st => P.gens.filter(g => g.status === st).reduce((a, g) => ({ u: a.u + g.units, mw: a.mw + (g.max_mw || 0) }), { u: 0, mw: 0 });
      const op = sum('Operating'), off = sum('Offline'), q = P.queue || [];
      use = plants.length ? C.barChart(plants.slice(0, 8).map(p => ({ label: p.name.slice(0, 12), value: p.opMax + p.offMax, note: `${p.mi.toFixed(1)} mi · ` + `${p.op} operating / ${p.off} offline units` })), { fmt: v => `${v.toFixed(1)} MW`, title: 'Generation within 10 mi: max capacity by plant', xLabel: 'Plant', yLabel: 'Max MW', height: 220 }) : emptyBox('No generator within 10 miles', 'dim_generator holds no unit with a coordinate within 10 miles of this bus.');
      useTable = tbl(['Indicator', '#Count', '#MW', 'Basis'], [
        `<tr>${td('Generator units operating')}${tn(op.u)}${tn(op.mw.toFixed(1))}${td('dim_generator, max capacity, ≤ 10 mi')}</tr>`,
        `<tr>${td('Generator units offline')}${tn(off.u)}${tn(off.mw.toFixed(1))}${td('dim_generator, max capacity, ≤ 10 mi')}</tr>`,
        `<tr>${td('Load points')}${tn(P.loads?.n ?? 'not held')}${tn(ok(P.loads?.load_mw) ? P.loads.load_mw.toFixed(1) : 'not held')}${td('dim_load, model load MW, ≤ 10 mi')}</tr>`,
        `<tr>${td('Model buses')}${tn(P.buses.length)}${tn('—')}${td('dim_bus with a coordinate, ≤ 10 mi')}</tr>`,
        `<tr>${td('Spine stations (grouped)')}${tn(stationGroups(P.stations, null).length)}${tn('—')}${td(`dim_substation, ${stationCoverage(P)?.label || '≤ 15 mi'}`)}</tr>`,
        `<tr>${td('Queue requests')}${tn(q.length)}${tn(q.reduce((a, r) => a + (r.max_mw || 0), 0).toFixed(1))}${td('dim_queue with coordinates, ≤ 25 mi (by distance, not electrical)')}</tr>`,
      ]);
    }
    return [
      `<div class="notice c-12">${esc(SCREEN_NOTE)}</div>`,
      card(4, 'Disc composition', sc ? `${sc.radiusMi}-mile disc · ${sc.water === false ? 'water not excluded' : 'water excluded'}` : 'no screen held', ring, `${esc(X_SRC)} · ${esc(utmNote(node))}`, 'screen', { answer: aDisc }),
      card(4, 'Constraint layers', 'acres inside the disc; layers overlap', layerChart, `Habitat and protected are subtracted; airport zones and energy-community status are advisory (shown, not removed). Habitat layer: ${esc(LAYER_SOURCE.habitat.dataset)}; ${esc(LAYER_SOURCE.habitat.gap)}, so habitat reads "not screened here", never 0 ac.`, 'review', { answer: aLayers }),
      card(4, 'Largest block vs need', `${TECH_LABEL[S.tech] || S.tech} ${fmt.mw(mw)} · low / base / high need`, gaugeBox, '"Fits" is an upper bound on this screen only.', 'screen', { answer: aCover }),
      card(8, 'Screened buses nearby', 'the 166 buses with an exclusion screen, nearest first; would this project fit there?', nbTable, `${esc(X_SRC)} · distances from unified dim_substation · discs differ in radius, so compare shares · * fits on the habitat/protected screen only (upper bound)`, 'review', { answer: aNb }),
      card(4, 'Block share comparison', '★ = this bus', nbChart, '', 'review', { answer: aShare }),
      card(6, 'Existing generation around the bus', 'land already in energy use within 10 miles', use, 'Unified DB dim_generator (no fuel type is held, so none is shown).', 'study', { answer: aGen }),
      card(6, 'Land-use indicators', 'what the unified DB places around the bus', useTable, 'Counts by distance only: proximity is not an electrical relationship.', 'study', { answer: aUse }),
      traceCard(traceArea(node, sc), traceRing(sc, split), traceCover(fp, sc, cov, mw, S.tech), traceNeighbours(others.length ? others : [])),
    ];
  };
  return {
    key: 'area', label: groupLabel('area', S.tech), short: 'Area',
    top: [K.block, K.ratio], side: [K.disc, K.excluded],
    chips: [], none: sc ? `${sc.radiusMi}-mile screening disc · Studio copy` : 'No exclusion screen held',
    result: sc ? `${B(ac(sc.clear))} block${ok(cov.base) ? ` · ${B(x(cov.base))} the need` : ''}` : 'block not held',
    answer: aDisc, secAnswer: aCover,
    body: `${sc ? '' : `<div class="notice" role="status">${esc(`No exclusion screen for ${nm}: buildable area is unknown, never assumed clear.`)}</div>`}<p class="audit-note" style="margin:0">${esc(SCREEN_NOTE)}</p>`,
    foot: `${esc(X_SRC)} · ${esc(utmNote(node))}`,
    head: sc ? `${B(nm)}'s ${esc(sc.radiusMi)}-mile disc holds a ${B(ac(sc.clear))} clear block${fp && ok(cov.base) ? `, ${B(x(cov.base))} the ${B(ac(fp.base))} that ${esc(fmt.mw(mw))} of ${esc((TECH_LABEL[S.tech] || S.tech).toLowerCase())} needs (an upper bound: habitat and protected land only)` : ''}.` : `No exclusion screen is held for ${B(nm)}: buildable area is unknown, never assumed clear${fp ? `; ${esc(fmt.mw(mw))} of ${esc((TECH_LABEL[S.tech] || S.tech).toLowerCase())} needs ${B(ac(fp.base))}` : ''}.`,
    cards, map: { sc, fp, nb, P },
  };
}

// ---------- Group 2: footprint & land cost ----------
function partCost({ data, S, node }) {
  const mw = projectMW(S), L = S.ui.land || {};
  const fp = footprint(data.land.intensity, S.tech, mw), sc = screen(data.land.exclusions, S.nodeId), f = fit(fp, sc);
  const rate = landRate(data.land.landCost, node), { buy, lease } = L;
  const vn = verifyNote(data.land.intensity);
  const money0 = v => `$${Number(v).toLocaleString('en-US')}`;
  const chips = [
    ok(buy) ? chip(`buy ${money0(buy)}/ac`, 'land', 'buy', '', 'Clear the purchase price') : '', ok(lease) ? chip(`lease ${money0(lease)}/ac-yr`, 'land', 'lease', '', 'Clear the lease rate') : '',
    ok(L.disc) ? chip(`discount ${L.disc}%`, 'land', 'disc', '', 'Clear the discount rate') : '', ok(L.years) ? chip(`${L.years} yr`, 'land', 'years', '', 'Clear the lease term') : '',
    ok(L.esc) ? chip(`escalator ${L.esc}%`, 'land', 'esc', '', 'Clear the lease escalator') : '', ok(L.resale) ? chip(`resale ${L.resale}%`, 'land', 'resale', '', 'Clear the resale share') : '',
  ].filter(Boolean);
  // v6: the four terms a user changes most stay visible; the escalator and resale sit under More options, which opens
  // itself once either is set or the escalator is the only input still missing.
  const lb = fp ? leaseVsBuy({ acres: fp.base, buy, lease, disc: L.disc, years: L.years, esc: L.esc, resale: L.resale }) : { status: 'missing', missing: ['a project size'] };
  const moreOpen = ok(L.esc) || ok(L.resale) || (lb.status !== 'ok' && lb.missing.length === 1 && lb.missing[0] === 'lease escalator');
  const form = `<div class="land-form">${num('buy', S, 'Purchase price', '$ per acre')}${num('lease', S, 'Lease rate', '$ per acre-year')}${num('disc', S, 'Discount rate', '% per year')}${num('years', S, 'Lease term', 'whole years')}</div>
    <details class="more-ctl"${moreOpen ? ' open' : ''}><summary>More options${ok(L.esc) || ok(L.resale) ? ` (${[ok(L.esc), ok(L.resale)].filter(Boolean).length} set)` : ''}</summary><div class="land-form">${num('esc', S, 'Lease escalator', '% per year (0 allowed)')}${num('resale', S, 'Resale at term end', '% of purchase price (optional)')}</div></details>`;
  const base = { key: 'footprint', label: groupLabel('footprint', S.tech), short: 'Cost', chips, none: 'No land price or terms entered', vn };
  if (!fp) {
    const nh = 'Enter a project size in the project strip: the land need is MW × acres per MW.';
    const K = { need: kpi('Land needed', 'not held', '', nh, 'footprint.need'), fit: kpi('Footprint fit', 'not held', '', nh, 'footprint.fit'), buy: kpi('Land purchase cost', 'not held', '', nh, 'footprint.buy'), leasebuy: kpi('Lease vs buy (PV)', 'not held', '', nh, 'footprint.leasebuy') };
    return { ...base, top: [K.need, K.buy], side: [K.fit, K.leasebuy], result: 'enter a project size', answer: 'Enter a project size: the land need is MW × acres per MW.', secAnswer: 'Enter a project size in the project strip; the land need is MW × acres per MW.', body: form, foot: 'Your inputs; nothing here is a measured price. Blank fields are not held (never 0).', head: '', cards: () => [card(12, 'Footprint & land cost', '', emptyBox('Enter a project size', 'Set the MW in the project strip; the land need is MW × acres per MW.'), '', 'screen')] };
  }
  const bf = data.land.intensity?.by_fuel || {}, sb = bf.solar?.base_acres_per_mw, bb = bf.bess?.base_acres_per_mw;
  const hyb = S.tech === 'hybrid' && ok(sb) && ok(bb) ? ` · ${fp.row.base_acres_per_mw} = ${sb} solar + ${bb} storage ac/MW (storage MW = solar MW, outside the solar fence)` : '';
  const K = {
    need: kpi('Land needed', ac(fp.base), '', `Range ${ac(fp.low)} – ${ac(fp.high)} · ${fp.basis}${fp.cited ? ' · cited study' : ' · rule of thumb, not a study'}${ok(fp.row.direct_acres_per_mw) ? ` · directly disturbed ≈ ${ac(fp.row.direct_acres_per_mw * mw)}` : ''}${hyb}`, 'footprint.need'),
    fit: kpi('Footprint fit', f.status === 'fits' ? 'fits*' : f.status, '', f.reason || `${f.status === 'fits' ? '*fits (habitat/protected screen only): an upper bound · ' : ''}${S.tech === 'wind' ? 'Conservative for wind: turbines need not sit in one block · ' : ''}low ${f.low} · base ${f.base} · high ${f.high}`, 'footprint.fit'),
    buy: kpi('Land purchase cost', ok(buy) ? fmt.money(fp.base * buy) : 'not held', '', ok(buy) ? `Base need at your $${buy.toLocaleString('en-US')}/acre` : 'Enter a $/acre price (no measured price is held)', 'footprint.buy'),
    leasebuy: kpi('Lease vs buy (PV)', lb.status === 'ok' ? `${lb.cheaper === 'lease' ? 'Lease' : lb.cheaper === 'buy' ? 'Buy' : 'Equal'} ${fmt.money(Math.abs(lb.diff))}` : 'not held', '', lb.status === 'ok' ? `cheaper over ${L.years} yr at ${L.disc}%${lb.buyBound ? ' · no resale credit: buy cost is an upper bound' : ''} · break-even lease $${Math.round(lb.breakevenLease).toLocaleString('en-US')}/ac-yr` : `Enter ${lb.missing.join(', ')}`, 'footprint.leasebuy'),
  };
  const matrix = needMatrix(data.land.intensity, TECHS, SIZES);
  // $/acre sensitivity: county reference band (assumption) and your entry.
  const rates = [...(rate ? [{ label: 'County ref. low', rate: rate.low, source: 'assumption', note: 'one band applied to every county' }, { label: 'County ref. base', rate: rate.base, source: 'assumption', note: 'one band applied to every county' }, { label: 'County ref. high', rate: rate.high, source: 'assumption', note: 'one band applied to every county' }] : []), { label: 'Your $/acre', rate: ok(buy) ? buy : null, source: 'user' }];
  const grid = costGrid(fp, rates);
  // v6 answers
  const blockMax = sc && ok(sc.clear) ? SIZES.filter(s2 => ok(footprint(data.land.intensity, S.tech, s2)?.base) && footprint(data.land.intensity, S.tech, s2).base <= sc.clear).at(-1) : null;
  const aCurve = `${B(fmt.mw(mw))} of ${esc(TECH_LABEL[S.tech] || S.tech)} needs ${B(ac(fp.base))} (range ${esc(ac(fp.low))}–${esc(ac(fp.high))})${sc && ok(sc.clear) ? (blockMax ? `; the largest block holds the base need up to ${B(`${blockMax} MW`)}` : '; the largest block holds no size in the sweep') : '; no screen is held, so the fit is unknown'}.`;
  const byT = TECHS.map(t => ({ t, v: footprint(data.land.intensity, t, mw)?.base })).filter(x => ok(x.v)).sort((a, b) => a.v - b.v);
  const aByT = byT.length ? `At ${esc(fmt.mw(mw))}, ${B(TECH_LABEL[byT[0].t])} needs the least land (${B(ac(byT[0].v))}) and ${B(TECH_LABEL[byT.at(-1).t])} the most (${B(ac(byT.at(-1).v))}).` : 'No land intensity is held.';
  const aMatrix = fp.row ? `${esc(TECH_LABEL[S.tech] || S.tech)} uses ${B(`${fp.row.base_acres_per_mw} ac/MW`)} at base, ${fp.cited ? 'from a cited study' : 'a rule of thumb, not a study'}.` : 'No intensity row is held for this technology.';
  const aCost = rate ? `At the county reference band (assumption), the base need costs ${B(fmt.money(fp.base * rate.low))}–${B(fmt.money(fp.base * rate.high))}${ok(buy) ? `; at your $${esc(buy.toLocaleString('en-US'))}/acre, ${B(fmt.money(fp.base * buy))}` : ''}.` : ok(buy) ? `At your $${esc(buy.toLocaleString('en-US'))}/acre the base need costs ${B(fmt.money(fp.base * buy))}.` : 'No measured land price is held: enter a $/acre to price the need.';
  const aTerms = lb.status === 'ok' ? `${B(lb.cheaper === 'lease' ? 'Leasing' : lb.cheaper === 'buy' ? 'Buying' : 'Neither')} is cheaper by ${B(fmt.money(Math.abs(lb.diff)))} in present value over ${esc(L.years)} years.` : `Lease vs buy is not held: enter ${esc(lb.missing.join(', '))}.`;
  const aLb = lb.status === 'ok' ? `Leasing breaks even with buying at ${B(`$${Math.round(lb.breakevenLease).toLocaleString('en-US')}/ac-yr`)} against your ${esc(`$${lease.toLocaleString('en-US')}`)}.` : 'Not held until every land term is entered (a blank is never 0).';
  const inp = { acres: fp.base, buy, lease, disc: L.disc, years: L.years, esc: L.esc, resale: L.resale };
  const cards = () => {
    // Need across sizes for this technology (low/base/high) against the block.
    const series = ['low', 'base', 'high'].map(k => ({ name: `${k} need`, dashed: k !== 'base', points: SIZES.map(s => ({ x: s, y: footprint(data.land.intensity, S.tech, s)?.[k] ?? null })) }));
    if (sc && ok(sc.clear)) series.push({ name: 'largest block (upper bound)', points: SIZES.map(s => ({ x: s, y: sc.clear })) });
    const curve = C.lineChart(series, { fmt: v => `${Math.round(v).toLocaleString('en-US')} ac`, xfmt: v => `${v} MW`, title: `${TECH_LABEL[S.tech] || S.tech}: land need across 50–500 MW`, height: 230 });
    const byTech = C.barChart(TECHS.map(t => ({ label: TECH_LABEL[t], value: footprint(data.land.intensity, t, mw)?.base ?? null })), { fmt: v => `${Math.round(v).toLocaleString('en-US')} ac`, title: `Base need at ${fmt.mw(mw)} by technology`, xLabel: 'Technology', yLabel: 'Acres', height: 230 });
    const mSizes = [50, 100, 250, 500];
    const matrixTable = tbl(['Technology', ...mSizes.map(s => `#${s} MW (base)`), '#ac/MW low / base / high', 'Basis'], TECHS.map(t => {
      const k = { storage: 'bess', datacenter: 'dc' }[t] || t, r = bf[k];
      return `<tr${t === S.tech ? ' class="hl"' : ''}>${td(TECH_LABEL[t])}${mSizes.map(s => { const m = matrix.find(x => x.tech === t && x.mw === s); return tn(`${acN(m?.base)}${sc && ok(m?.base) && ok(sc.clear) ? (sc.clear >= m.base ? ' ✓' : ' ✗') : ''}`); }).join('')}${tn(r ? `${r.low_acres_per_mw} / ${r.base_acres_per_mw} / ${r.high_acres_per_mw}` : 'not held')}${td(r ? (r.cited ? 'cited study' : 'rule of thumb') : '—')}</tr>`;
    }));
    const gridTable = tbl(['Need band', '#Acres', ...rates.map(r => `#${r.label}${ok(r.rate) ? ` ($${r.rate.toLocaleString('en-US')})` : ''}`)], grid.map(g => `<tr${g.band === 'base' ? ' class="hl"' : ''}>${td(g.band)}${tn(acN(g.acres))}${g.costs.map(c => tn(ok(c) ? fmt.money(c) : 'not held')).join('')}</tr>`));
    let lbChart, lbTable;
    if (lb.status === 'ok') {
      let cum = 0; const pts = [], buyPts = [];
      for (let t = 1; t <= L.years; t++) { cum += (fp.base * lease * (1 + L.esc / 100) ** (t - 1)) / (1 + L.disc / 100) ** t; pts.push({ x: t, y: cum }); buyPts.push({ x: t, y: fp.base * buy - (ok(L.resale) ? (fp.base * buy * L.resale) / 100 / (1 + L.disc / 100) ** t : 0) }); }
      lbChart = C.lineChart([{ name: 'Cumulative PV of lease', points: pts }, { name: `Net buy${ok(L.resale) ? ' (resale at that year)' : ' (no resale credit)'}`, points: buyPts, dashed: true }], { fmt: v => fmt.money(v), xfmt: v => `yr ${v}`, title: 'Lease vs buy: present value by year', height: 210 });
      lbTable = tbl(['Figure', '#Value'], [[`PV of lease (${L.years} yr)`, fmt.money(lb.pvLease)], ['Purchase', fmt.money(lb.buyCost)], ['PV of resale', ok(lb.pvResale) ? fmt.money(lb.pvResale) : 'not entered'], ['Net buy', `${lb.buyBound ? '≤ ' : ''}${fmt.money(lb.netBuy)}`], ['Break-even lease', `$${Math.round(lb.breakevenLease).toLocaleString('en-US')}/ac-yr`]].map(([a, b]) => `<tr>${td(a)}${tn(b)}</tr>`));
    } else {
      lbChart = emptyBox('Lease vs buy not held', `Enter ${lb.missing.join(', ')} in the land terms on the map. A blank is never treated as 0; enter 0 for no escalator.`);
      lbTable = '';
    }
    return [
      card(8, 'Need across project sizes', `${TECH_LABEL[S.tech] || S.tech}, low / base / high acres per MW${sc ? ' vs the largest block' : ''}`, curve, `${esc(fp.source || '')}`, 'screen', { answer: aCurve }),
      card(4, 'Need by technology', `at ${fmt.mw(mw)}, base acres per MW`, byTech, 'Storage and data-centre rows are trade rules of thumb (no published study).', 'review', { answer: aByT }),
      card(7, 'Need matrix', `base acres by technology and size${sc ? ' · ✓/✗ = within the largest block (screen only)' : ''}`, matrixTable, `Intensity: ${esc(data.land.intensity?.vintage || '')} · ${esc(data.land.source)}`, 'review', { answer: aMatrix }),
      card(5, 'Land cost sensitivity', '$/acre level × need band (land only)', gridTable, `County reference (${esc(node?.county || '?')}, ${esc(node?.state_code || '?')}): ${rate ? '<span class="pill warn">assumption</span> the same three round figures on every county; a sensitivity, never the headline' : 'not held for this county'}.`, 'review', { answer: aCost }),
      card(6, 'Lease vs buy (NPV)', 'cumulative PV of lease payments against the net purchase', `${lbChart}${lbTable}`, 'The land terms are entered on the map (Cost).', 'study', { answer: aLb }),
      traceCard(traceFootprint(S, mw, fp, sc, f, buy, lease, vn), traceNeedCurve(matrix, data.land.intensity, SIZES), traceCostGrid(grid, rates, fp), traceLeaseBuy(lb, inp)),
    ];
  };
  return {
    ...base, top: [K.need, K.buy], side: [K.fit, K.leasebuy],
    result: `${B(ac(fp.base))} need${ok(buy) ? ` · ${B(fmt.money(fp.base * buy))} to buy` : ''}`,
    answer: aCurve, secAnswer: aTerms,
    body: `${form}<p class="audit-note" style="margin:0">${ok(lease) ? `Annual lease at base need: ${esc(fmt.money(fp.base * lease))}/yr.` : 'Blank fields are not held (never 0).'}</p>`,
    foot: 'Land terms: your inputs; nothing here is a measured price. The need curve, the matrix, the cost sensitivity and lease vs buy are on the Cost tab (Footprint & land cost).',
    head: '', cards, map: { fp },
  };
}

// ---------- Group 3: connection corridor ----------
function partRoute({ data, S, node }) {
  const L = S.ui.land || {}, mw = projectMW(S), P = siteData(S.nodeId);
  const site = { lat: L.siteLat, lon: L.siteLon }, hasSite = ok(site.lat) && ok(site.lon);
  const rf = ok(L.route) ? L.route : 1.2;
  const c = corridor(site, node, { routeFactor: rf, perMile: L.perMile, terminal: L.terminal, crossings: L.crossings });
  const origin = hasSite ? { ...site, label: 'the placed site', user: true } : { lat: node?.latitude, lon: node?.longitude, label: `the bus (${node?.name})` };
  // v4: the request rule is Grid's (gridrules.applicableCases): storage and hybrid charge in the shoulder case only.
  const side = requestSide(S.tech), cases = requestCases(S.tech), words = reqWords(S.tech, S);
  // P2 C07 (D6.1): every station's verdict is Grid's caseTable + binding on its own store rows, at the MW as entered.
  // Element rows for the nearby buses come with the payload as P.stationElements; until they do, a held case is the
  // vendor envelope only, which reads "Envelope only (Hold)": never clears, never "does not clear".
  const elemsHeld = ready(P) && Array.isArray(P.stationElements), elems = elemsHeld ? P.stationElements : [];
  const groups = ready(P) && P.stations ? stationGroups(P.stations, { name: node?.substation_name, kv: node?.nominal_kv }).map(g => { const d = miles(origin, { lat: g.lat, lon: g.lon }), v = stationVerdict(g, S.tech, S.exportMW, S.importMW, elems); return { ...g, d, v, hr: v.hr, clears: v.status, pm: perMile(v.hr, d) }; }).sort((a, b) => a.d - b.d).map((g, i) => ({ ...g, key: `st${i}` })) : [];
  const near = groups[0], cov = ready(P) ? stationCoverage(P) : null, tally = countFits(groups);
  // P2 C41: the candidate's own row, the same verdict Grid › Connection capacity prints for this bus (data.grid).
  const own = data.grid ? landVerdict(data.grid, S.nodeId, S.tech, S.exportMW, S.importMW) : null;
  const sub = ready(P) ? P.substation : null, rank = ready(P) ? P.scRank : null, pr = pctRank(rank);
  const studio = ready(P) ? P.studio : null;
  const K = {
    distance: kpi('Distance to the bus', ok(c.distance) ? `${c.distance.toFixed(1)} mi` : 'not held', '', ok(c.distance) ? (ok(c.route) ? `Straight line; about ${c.route.toFixed(1)} mi routed at ×${rf}` : `Straight line; routed length not held${c.routeError ? ` (${c.routeError})` : ''}`) : c.reason, 'corridor.distance'),
    line: kpi('Connection line cost', ok(c.cost) ? `${c.status === 'partly priced' ? '≥ ' : ''}${fmt.money(c.cost)}` : 'not held', '', c.reason || 'Line + terminal + crossings (your inputs)', 'corridor.line'),
    nearest: kpi('Nearest other station', near ? `${near.d.toFixed(1)} mi` : ready(P) ? 'not held' : 'loading…', '', near ? `${near.name} ${near.kv} kV from ${origin.label} · ${near.v.label} for ${words}${near.v.status === 'Does not fit' ? ` (${CASE_LABEL_SHORT(near.v.binding)})` : ''}` : ready(P) ? `No other spine station ${cov?.short || 'within 15 mi'}` : '', 'corridor.nearest'),
    sc: kpi('Station short-circuit', ok(sub?.short_circuit_mva) ? fmt.int(sub.short_circuit_mva) : ready(P) ? 'not held' : 'loading…', ok(sub?.short_circuit_mva) ? 'MVA' : '', ok(pr) ? `P${Math.round(pr)} of ${rank.of.toLocaleString('en-US')} buses · ${ok(node?.nominal_kv) ? `${node.nominal_kv} kV` : 'kV not held'} · ${sub?.total_outlets ?? '—'} outlets` : '', 'corridor.sc'),
  };
  // F018: exclusion shapes are not held; a placed site says its position against them is unknown.
  const xNote = siteExclusionNote(screen(data.land.exclusions, S.nodeId), site);
  const moreOpen = ok(L.route) || ok(L.terminal) || ok(L.crossings) || !!c.routeError;
  const inputs = `<div class="land-form">${num('siteLat', S, 'Site latitude', 'decimal degrees', 'e.g. 41.66')}${num('siteLon', S, 'Site longitude', 'decimal degrees', 'e.g. −70.47')}${num('perMile', S, 'Line cost', '$ per mile, voltage class')}</div>
    <details class="more-ctl"${moreOpen ? ' open' : ''}><summary>More options${moreOpen ? ' (set)' : ''}</summary><div class="land-form">
      <label class="field">Routing factor <span class="pill ${c.routeError ? 'warn' : ''}">${ok(L.route) ? 'U' : 'P'}</span><input type="number" step="0.05" min="1" data-act="land" data-k="route" value="${rf}"><span class="audit-note">${c.routeError ? `<b>${esc(c.routeError)}.</b>` : 'route ÷ straight line · 1.2 placeholder (needs a source)'}</span></label>
      ${num('terminal', S, 'Terminal works', '$ (POI bay, substation)')}${num('crossings', S, 'Crossings, easements', '$')}</div></details>`;
  // POI identity (Studio 2.01), transmission owner (Studio 2.30).
  const pm = node?.priceMapping || {};
  const to = studio?.to, owners = (to?.to || []).filter(o => !(studio?.notAnOwner || []).includes(o));
  const idBox = `<dl class="land-kv"><dt>Price link</dt><dd>${esc(pm.tier || 'not held')}${pm.pnode_name ? ` · ${esc(pm.pnode_name)}` : ''}${ok(pm.distance_km) && pm.distance_km > 0 ? ` · ${pm.distance_km.toFixed(1)} km away` : ''}</dd>
      <dt>Method</dt><dd>${esc(pm.method || '—')}${ok(pm.buses_at_substation) ? ` · ${pm.buses_at_substation} buses share the pnode's substation` : ''}</dd>
      <dt>Load zone</dt><dd>${esc(node?.load_zone || 'not held')} (${esc(node?.load_zone_source || 'source not held')})</dd>
      <dt>County</dt><dd>${esc(node?.county || 'not held')}, ${esc(node?.state_code || '')}</dd>
      <dt>Transmission owner</dt><dd>${owners.length ? `${esc(owners.join(', '))} <span class="pill">Studio copy · queue to_report</span>` : `not held${to?.z ? ` · model zone ${esc(to.z)} is not an owner` : ''}`}</dd>
      <dt>Queue records at this POI</dt><dd>${to?.q?.length ? esc(to.q.map(q => `Q${q[0]} (${q[1]}, ${q[2]})`).join(' · ')) : 'none named'}</dd>
      <dt>Max injection (CCIS)</dt><dd>${ok(sub?.max_injection_ccis_mw) ? `${sub.max_injection_ccis_mw.toFixed(1)} MW <span class="pill">vendor figure, dim_substation</span>` : 'not held'}</dd></dl>`;
  const tieCost = g => (ok(L.perMile) ? g.d * rf * L.perMile : null);
  // Line-cost sensitivity: site distance, else the tie from the bus to the nearest station.
  const gridMiles = hasSite ? c.distance : near?.d ?? null;
  const gridBasis = hasSite ? `site → bus, ${c.distance.toFixed(2)} mi straight` : near ? `no site placed: the tie from ${node?.name} to ${near.name} ${near.kv} kV, ${near.d.toFixed(2)} mi straight` : 'no distance held';
  const levels = [...(ok(L.perMile) ? [{ p: L.perMile, source: 'user', note: 'your entry' }] : []), ...STUDIO_PER_MILE.filter(p => p !== L.perMile).map(p => ({ p, source: 'assumption', note: 'Studio slider level, not a quote' }))];
  const facs = [...new Set([...FACTORS, ...(ok(L.route) && L.route >= 1 ? [L.route] : [])])].sort((a, b) => a - b);
  const lgrid = lineCostGrid(gridMiles, levels.map(l => l.p), facs).map((r, i) => ({ ...r, source: levels[i].source, note: levels[i].note }));
  // v6 answers
  const loadingA = 'Reading the area around the bus from the unified database…';
  const aMap = hasSite ? `The placed site is ${B(ok(c.distance) ? `${c.distance.toFixed(1)} mi` : 'not held')} in a straight line from ${B(node?.name || 'the bus')}${near ? `; the nearest other station is ${B(`${near.name} ${near.kv} kV`)} at ${B(`${near.d.toFixed(1)} mi`)}` : ''}.` : `No site is placed: click the map to place it.${near ? ` The nearest other station is ${B(`${near.name} ${near.kv} kV`)}, ${B(`${near.d.toFixed(1)} mi`)} from the bus.` : ''}`;
  const aLine = ok(c.cost) ? `The connection line costs ${B(`${c.status === 'partly priced' ? '≥ ' : ''}${fmt.money(c.cost)}`)} on your inputs (not a quote).` : `Line cost not held: ${esc(c.reason || 'enter the site and a $/mile')}.`;
  const ownA = own ? `This bus: ${B(own.label)} for ${esc(words)} (the Grid verdict). ` : '';
  const aAlt = !ready(P) ? loadingA : groups.length ? `${ownA}${B(fmt.int(tally.fits))} of ${B(fmt.int(groups.length))} stations ${esc(cov?.short || 'within 15 mi')} fit ${esc(words)} on element-study evidence; ${B(fmt.int(tally.hold))} are Hold (${esc(ENVELOPE_ONLY.toLowerCase())}, not published or not studied) and ${B(fmt.int(tally.doesNotFit))} ${tally.doesNotFit === 1 ? 'does' : 'do'} not fit. Envelope only never counts as clear.` : `${ownA}No other spine station lies ${esc(cov?.short || 'within 15 mi')}.`;
  const pmTop = groups.filter(g => ok(g.pm)).sort((a, b) => b.pm - a.pm)[0];
  const aPm = !ready(P) ? loadingA : pmTop ? `${B(`${pmTop.name} ${pmTop.kv} kV`)} offers the most headroom per mile: ${B(`${pmTop.pm.toFixed(0)} MW/mi`)}.` : 'No nearby station publishes a solved envelope.';
  const lvl = levels[0];
  const aLg = ok(gridMiles) && lvl ? `At ${B(`${(lvl.p / 1e6).toFixed(2)}M/mi`)} (${lvl.source === 'user' ? 'your entry' : 'assumption'}) and ×${esc(rf)} routing, ${esc(gridBasis.split(',')[0])} costs ${B(fmt.money(gridMiles * rf * lvl.p))}.` : 'No distance is held: place the site, or no station lies within 15 miles.';
  const aBr = !ready(P) ? loadingA : `${B(fmt.int(P.branches.length))} model branch${P.branches.length === 1 ? '' : 'es'} touch this bus.`;
  const aBuses = !ready(P) ? loadingA : `${B(fmt.int(P.buses?.length ?? 0))} model buses lie within 10 miles${P.buses?.length ? `, ${B(fmt.int(P.buses.filter(b => b.on_spine).length))} on the spine` : ''}.`;
  const qq = ready(P) ? P.queue || [] : [];
  const aQ = !ready(P) ? loadingA : qq.length ? `${B(fmt.int(qq.length))} queue requests (${B(`${qq.reduce((a, q) => a + (q.max_mw || 0), 0).toFixed(0)} MW`)}) sit within 25 miles by coordinate.` : 'No queue request with a coordinate lies within 25 miles.';
  const nUp = ready(P) && P.upgrades ? P.upgrades.substation.length + P.upgrades.transmission.length : null;
  const aUp = !ready(P) ? loadingA : ok(nUp) ? `${B(fmt.int(nUp))} planned upgrade${nUp === 1 ? '' : 's'} lie within 15 miles.` : 'Planned upgrades are not held.';
  const aNotes = studio ? (studio.notes.length ? `${B(fmt.int(studio.notes.length))} figure${studio.notes.length === 1 ? '' : 's'} differ from the Studio copy; the unified value is used.` : 'The Studio copy agrees with the unified database for this bus.') : ready(P) ? 'The Studio copy is not loaded.' : loadingA;
  // Columns = exactly the cases this request reads (Grid's applicableCases), from the bus that stands for the station.
  const COLS = { 'summer_peak|discharge': 'Inj. SP', 'shoulder|discharge': 'Inj. shoulder', 'shoulder|charge': 'Charge shoulder', 'summer_peak|charge': 'Wd. SP', 'large_load|charge': 'Wd. LL' };
  // Each case cell = the governing figure Grid uses (element study where held, else the envelope, marked "env").
  const caseCells = v => cases.map(cc => { const x = v?.table?.find(y => y.key === cc.key); return tn(ok(x?.governing) ? `${x.governing.toFixed(0)}${x.evidence === 'envelope' ? ' env' : ''}${x.key === v.binding ? ' ▾' : ''}` : x?.status === 'Hold' ? 'Hold' : 'not held'); }).join('');
  const cards = () => {
    // Alternatives table (Studio 2.03 + 2.04 + 2.10).
    const ownRow = own ? `<tr class="hl" data-own-verdict="${esc(own.status)}">${td(`${node?.name || 'This bus'} (this bus, Grid verdict)`)}${tn(node?.nominal_kv ?? '—')}${tn('0.0')}${caseCells(own)}${td(own.label)}${tn('—')}${tn('—')}${tn(ok(sub?.short_circuit_mva) ? fmt.int(sub.short_circuit_mva) : 'not held')}${td(screen(data.land.exclusions, S.nodeId) ? 'yes' : 'no')}</tr>` : '';
    const altRows = groups.slice(0, 25).map(g => `<tr data-verdict="${esc(g.v.status)}">${td(`${g.name}${g.buses > 1 ? ` (${g.buses} buses)` : ''}`)}${tn(g.kv)}${tn(g.d.toFixed(1))}${caseCells(g.v)}${td(g.v.label)}${tn(ok(g.pm) ? g.pm.toFixed(1) : 'not held')}${tn(ok(tieCost(g)) ? fmt.money(tieCost(g)) : 'not held')}${tn(ok(g.sc) ? fmt.int(g.sc) : 'not held')}${td(g.screened ? 'yes' : 'no')}</tr>`);
    const covNote = cov?.truncated ? `<div class="notice warn" role="status" data-stations-truncated="${esc(cov.effMi.toFixed(2))}">Station list: ${esc(cov.label)}.</div>` : '';
    const altTable = ready(P) ? `${covNote}${tbl(['Station', '#kV', `#Miles from ${hasSite ? 'site' : 'bus'}`, ...cases.map(cc => `#${COLS[cc.key] || cc.label} (MW)`), `Request ${words}`, '#MW per mile', '#Tie cost (line)', '#SC MVA', 'Screened'], [ownRow, ...altRows].filter(Boolean), `No other spine station ${cov?.short || 'within 15 mi'}.`)}` : pending(P);
    const pmChart = groups.length ? C.barChart([...groups].filter(g => ok(g.pm)).sort((a, b) => b.pm - a.pm).slice(0, 8).map(g => ({ label: `${g.name.slice(0, 10)} ${g.kv}`, value: g.pm, note: `${g.d.toFixed(1)} mi · ${ok(g.hr) ? g.hr.toFixed(0) : '—'} MW` })), { fmt: v => `${v.toFixed(0)} MW/mi`, title: `Headroom per mile (${side.label})`, xLabel: 'Station', yLabel: 'MW per mile', height: 230, emptyText: 'No nearby station publishes a solved envelope.' }) : pending(P) || emptyBox('No station within 15 miles', 'No spine station lies within 15 miles.');
    const lgTable = ok(gridMiles) ? tbl(['$/mile', 'Source', ...facs.map(f => `#×${f.toFixed(2)}${f === 1 ? ' (straight)' : ''}`)], lgrid.map(r => `<tr${r.source === 'user' ? ' class="hl"' : ''}>${tn(`$${(r.perMile / 1e6).toFixed(2)}M`)}${td(r.source === 'user' ? 'your entry' : 'assumption')}${r.cells.map(v => tn(ok(v) ? fmt.money(v) : 'not held')).join('')}</tr>`)) : emptyBox('No distance held', 'Place the site, or no station lies within 15 miles.');
    const lcChart = C.lineChart(levels.map(l => ({ name: `$${(l.p / 1e6).toFixed(2)}M/mi${l.source === 'user' ? ' (yours)' : ''}`, dashed: l.source !== 'user', points: Array.from({ length: 16 }, (_, d) => ({ x: d, y: d * rf * l.p })) })), { fmt: v => fmt.money(v), xfmt: v => `${v} mi`, title: `Line cost by straight-line distance (×${rf} routing)`, height: 220 });
    // Lines at the bus (Studio 2.05), buses within 10 mi, queue (2.07), planned upgrades.
    const br = ready(P) ? tbl(['Line', 'Far end', '#kV', 'Status', '#Rate A (MVA)', '#Inj. headroom', '#Wd. headroom'], P.branches.map(b => { const far = String(b.from_bus_id) === String(S.nodeId) ? b.to_bus_name : b.from_bus_name; return `<tr>${td(b.line_name)}${td(far)}${tn(b.voltage ?? '—')}${td(b.status || '—')}${tn(ok(b.rated_base_mva) ? b.rated_base_mva.toFixed(0) : 'not held')}${tn(ok(b.hr_dis) ? b.hr_dis.toFixed(1) : 'not held')}${tn(ok(b.hr_chg) ? b.hr_chg.toFixed(1) : 'not held')}</tr>`; }), 'No branch in dim_branch touches this bus.') : pending(P);
    let busesCard = pending(P);
    if (ready(P) && P.buses) {
      const byKv = new Map(); for (const b of P.buses) byKv.set(b.nominal_kv, (byKv.get(b.nominal_kv) || 0) + 1);
      const kvChart = C.barChart([...byKv.entries()].sort((a, b) => (b[0] ?? -1) - (a[0] ?? -1)).map(([k, n]) => ({ label: ok(k) ? `${k} kV` : 'kV not held', value: n })), { fmt: v => `${v.toFixed(0)} buses`, title: 'Model buses within 10 mi by voltage', xLabel: 'Voltage', yLabel: 'Buses', height: 160 });
      busesCard = `${kvChart}${tbl(['Bus', 'Substation', '#kV', '#Miles', 'Spine'], P.buses.slice(0, 15).map(b => `<tr>${td(b.bus_name)}${td(b.substation_name || '—')}${tn(b.nominal_kv ?? '—')}${tn(b.mi.toFixed(1))}${td(b.on_spine ? 'yes' : 'no')}</tr>`), 'No model bus within 10 miles.')}`;
    }
    const qt = ready(P) ? tbl(['Queue', 'POI', 'Type', '#MW', 'Status', 'Projected in service', '#Miles'], (P.queue || []).map(q => `<tr>${td(`Q${q.queue_position}`)}${td(q.poi_name)}${td(q.resource_type || '—')}${tn(ok(q.max_mw) ? q.max_mw.toFixed(1) : 'not held')}${td(q.status || '—')}${td(q.projected_is_date || 'not held')}${tn(q.mi.toFixed(1))}</tr>`), 'No queue request with a coordinate within 25 miles.') : pending(P);
    const up = ready(P) && P.upgrades ? tbl(['Upgrade', 'Where', '#kV', 'In service', '#Miles'], [...P.upgrades.substation.map(u => `<tr><td class="wrap">${esc(u.substation_upgrade)}</td>${td(u.substation_name)}${tn(u.nominal_voltage_kv ?? '—')}${td(u.expected_in_service_year || 'not held')}${tn(u.mi.toFixed(1))}</tr>`), ...P.upgrades.transmission.map(u => `<tr><td class="wrap">${esc(u.transmission_upgrade)}</td>${td(`${u.from_substation_name} – ${u.to_substation_name}`)}${tn(u.nominal_voltage_kv ?? '—')}${td(u.expected_in_service_year || 'not held')}${tn(u.mi.toFixed(1))}</tr>`)], 'No planned substation or transmission upgrade within 15 miles.') : pending(P);
    const notes = studio ? (studio.notes.length ? tbl(['Quantity', 'Unified DB (primary)', 'Studio copy', 'Difference'], studio.notes.map(n => `<tr>${td(n.field)}${tn(n.unified)}${tn(n.studio)}${tn(n.diff)}</tr>`)) : `<p class="audit-note" style="margin:0">The Studio copy (older database) agrees with the unified DB for this bus on the coordinate, short-circuit MVA (after the Studio's ×100 display correction), outlets and all four solved headroom figures (within 0.5 MW or 0.5%).</p>`) : ready(P) ? '<p class="audit-note">The Studio copy is not loaded (data/land-studio.json missing).</p>' : pending(P);
    return [
      card(12, `Alternative connection stations ${cov?.short || 'within 15 mi'}`, `this bus first, then stations grouped by name, kV and coordinate · distance from ${origin.label} · request reads ${side.label}`, altTable, `Verdict = Grid's rule (D6.1): element study where held; a case resting on the vendor envelope (fact_headroom, marked env) is Envelope only (Hold), never a pass or a fail.${elemsHeld ? '' : ' Element-study rows for the nearby stations are not on this payload, so every station reads Envelope only (Hold) or Not studied here; open the bus in Grid for its element study.'} SP = summer peak, LL = large load. Tie cost = miles × routing factor × your $/mile (line only).`, 'review', { ...LAND_META['Alternative connection stations'], answer: aAlt }),
      card(6, 'Headroom per mile of tie', 'solved envelope ÷ straight-line miles (0.5-mi floor): a ranking convenience, not a cost', pmChart, '', '', { answer: aPm }),
      card(6, 'Line cost sensitivity', gridBasis, `${lgTable}${lcChart}`, 'No $/mile benchmark is held: the $1M–$4M/mi rows are the live Studio slider range (assumption); only your entry prices the KPI.', '', { answer: aLg }),
      card(6, 'Lines at the bus', 'branches in the model whose from or to bus is this bus', br, 'Unified dim_branch. A 0-MVA rating is a zero-length record and is shown as not held.', '', { answer: aBr }),
      card(6, 'Model buses within 10 miles', `${ready(P) && P.buses ? P.buses.length : '—'} buses in dim_bus`, busesCard, '', '', { answer: aBuses }),
      card(6, 'Queue within 25 miles', 'requests placed by their own coordinates', qt, 'Unified dim_queue. A nearby request is not one this project depends on; see Queue.', '', { answer: aQ }),
      card(6, 'Planned upgrades within 15 miles', 'substation and transmission upgrades in the unified DB', up, 'Unified dim_substation_upgrade and dim_transmission_upgrade (nearest endpoint).', '', { answer: aUp }),
      card(12, 'Data notes: unified DB vs the Studio copy', 'one bus, one figure: the unified DB is primary', notes, esc(studio?.source || ''), '', { answer: aNotes }),
      traceCard(traceCorridor(node, site, c, L), traceAlts(groups, origin.lat != null ? origin : { lat: 0, lon: 0, label: 'bus' }, side, mw, cov), traceLineGrid(gridMiles, gridBasis, lgrid, facs), ready(P) ? traceStrength(sub, rank, pr, studio?.bus?.sc_mva) : ''),
    ];
  };
  // The strip: what is set (a placed site, the line terms) and what it gives.
  const chips = [
    hasSite ? chip(`site ${(+site.lat).toFixed(3)}, ${(+site.lon).toFixed(3)}`, 'land-site-clear', '', '', 'Remove the placed site') : '',
    ok(L.perMile) ? chip(`line $${(L.perMile / 1e6).toFixed(2)}M/mi`, 'land', 'perMile', '', 'Clear the line cost') : '',
    ok(L.route) ? chip(`routing ×${L.route}`, 'land', 'route', '', 'Back to the 1.2 placeholder') : '',
    ok(L.terminal) ? chip(`terminal ${fmt.money(L.terminal)}`, 'land', 'terminal', '', 'Clear the terminal works') : '',
    ok(L.crossings) ? chip(`crossings ${fmt.money(L.crossings)}`, 'land', 'crossings', '', 'Clear the crossings') : '',
  ].filter(Boolean);
  const tieLabel = hasSite && ok(c.distance) ? `${c.distance.toFixed(1)} mi straight${ok(c.route) ? ` · ≈ ${c.route.toFixed(1)} mi routed` : ''}${ok(c.cost) ? ` · ${c.status === 'partly priced' ? '≥ ' : ''}${fmt.money(c.cost)}` : ''}` : '';
  return {
    key: 'corridor', label: groupLabel('corridor', S.tech), short: 'Route',
    top: [K.distance, K.nearest], side: [K.line, K.sc],
    chips, none: 'No site placed: click the map',
    result: hasSite ? `site ${B(ok(c.distance) ? `${c.distance.toFixed(1)} mi` : '—')} from the bus${ok(c.cost) ? ` · line ${B(fmt.money(c.cost))}` : ''}` : near ? `nearest ${B(`${near.name} ${near.kv}`)} ${near.d.toFixed(1)} mi` : ready(P) ? 'no station within reach' : 'reading the area…',
    answer: aAlt, secAnswer: aLine,
    body: `<p class="audit-note" style="margin:0"><b>Click the map</b> to place the site, or type its coordinates.</p>${inputs}${xNote ? `<div class="notice warn" role="status" data-site-exclusions="missing">${esc(xNote.text)}</div>` : ''}`,
    foot: 'Your inputs price the line; nothing is a quote. Coordinates: unified dim_bus / dim_substation. The alternatives, the line-cost sensitivity, the lines, buses, queue and upgrades near the bus are on the Route tab.',
    head: hasSite ? `The placed site is ${B(ok(c.distance) ? `${c.distance.toFixed(1)} mi` : 'not held')} from the bus${ok(c.cost) ? `, a ${B(fmt.money(c.cost))} line on your inputs` : ''}.` : near ? `No site is placed yet; the nearest other station is ${B(`${near.name} ${near.kv} kV`)}, ${B(`${near.d.toFixed(1)} mi`)} away (${esc(near.v.label)}).` : '',
    cards, aMap, xNote, idBox, own, groups, near, cov, tally, words, tieCost, P, site, hasSite, c, rf, tieLabel, mw,
  };
}

// ---------- Group 4: permits & site control ----------
function partPermits({ data, S, node }) {
  // v5: the checklist is the fuel's own (landcore.permitList), keyed by permit id; a common item also reads its pre-v4
  // index key, so earlier entries survive a fuel switch. Timing keys are po_<id> / pd_<id>.
  // S3 Lead wiring 3 (W-B): the site-control gate is the ISO-NE rules engine's (one rule with Queue and Decision).
  const L = S.ui.land || {}, st = L.permits || {}, pctv = L.control, scn = siteControl(S.tech, pctv, { service: S.ui.qService, regulatoryLimitation: S.ui.qRegLimit, profile: S.ui.qProfile });
  const prof = RX.profileInfo(S.ui.qProfile);
  const permitDefs = permitRows(st, S.tech), PERMITS = permitDefs.map(p => p.label), STATUS = permitDefs.map(p => p.status);
  const sum = permitCounts(permitDefs), sc = screen(data.land.exclusions, S.nodeId);
  // P2 C44: timing reads every item (id keys, then index keys in checklist order), so technology items are dated too.
  const timing = permitTiming(L, S.tech), rows = permitDefs.map(p => { const t = timing.find(x => x.id === p.id); return { label: p.label, offset: t?.offset ?? null, dur: t?.dur ?? null }; });
  const tasks = permitTimeline(st.start, rows);
  const placed = tasks ? tasks.filter(t => t.end != null) : [];
  const span = placed.length ? (() => { const s = Math.min(...placed.map(t => t.start)), e = Math.max(...placed.map(t => t.end)), a = new Date(s), b = new Date(e); return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth(); })() : null;
  const K = {
    control: kpi('Site control', !scn.applicable ? 'not applicable' : ok(pctv) ? `${pctv}%` : 'not held', '', scn.applicable ? scn.status : `${scn.status}: a data centre is a load`, 'permits.control'),
    confirmed: kpi('Permits confirmed', `${sum.done} of ${sum.total}`, '', `${sum['in progress']} in progress · ${sum['not needed']} not needed · ${sum.unknown} unknown (your entries)`, 'permits.confirmed'),
    window: kpi('Permit window', ok(span) ? `${span}` : 'not held', ok(span) ? 'months' : '', ok(span) ? `first start to last dated end · ${placed.length} of ${permitDefs.length} items dated${placed.length < permitDefs.length ? ' (undated items not in the window: a lower bound)' : ''}` : `Enter a start month and permit offsets/durations · ${placed.length} of ${permitDefs.length} items dated`, 'permits.window'),
    ordinance: kpi('Local ordinance data', 'not held', '', 'No ordinance register is in the workspace; missing stays unknown', 'permits.ordinance'),
  };
  // v6 answers
  const aCheck = `${B(`${sum.done} of ${sum.total}`)} permits are confirmed done; ${B(sum.unknown)} stay unknown and are never counted as done.`;
  const aStatus = `${B(sum['in progress'])} in progress, ${B(sum['not needed'])} not needed, ${B(sum.unknown)} unknown (your entries).`;
  const aSc = !scn.applicable ? 'Site control does not apply the generator thresholds: a data centre is a load.' : ok(pctv) ? `${B(`${pctv}%`)} of the site is documented under control: ${esc(scn.status)}.` : 'Site control is not entered: not held, so it cannot pass.';
  const aTl = ok(span) ? `${B(`${placed.length} of ${permitDefs.length}`)} permits are dated and span ${B(`${span} months`)} from the first start to the last end.` : 'The permit window is not held: enter a start month, then offsets and durations.';
  const nPrompt = sc ? [...sc.subtracted, ...sc.advisory].filter(l => ok(l.acres) && l.acres > 0).length : 0;
  const aPr = sc ? `${B(nPrompt)} screen layer${nPrompt === 1 ? '' : 's'} present in the disc prompt a permit check; wetlands and water are not screened.` : 'No exclusion screen is held here, so nothing is prompted.';
  const aEv = `No ordinance register or parcel record is held for this location; site-control documents: ${!scn.applicable ? 'not applicable (load)' : ok(pctv) ? B(`${pctv}% entered`) : 'none entered'}.`;
  const cards = () => {
    const layer = name => sc?.subtracted.concat(sc.advisory).find(l => l.layer === name);
    const prompt = i => { if (!sc) return 'no screen held';
      const id = permitDefs[i]?.id;
      if (id === 'birds' || id === 'wildlife') { const h = layer('habitat'); return h?.status === 'missing' ? 'Not cleared by this screen: habitat not screened here (state rare-species habitat not held)' : ok(h?.value) && h.value > 0 ? `habitat covers ${pct(100 * h.share)} of the disc` : 'no federal critical habitat in the disc; state habitat not screened'; }
      if (id === 'wetlands') return 'wetlands not screened';
      if (id === 'zoning') return 'local ordinance not held';
      if (id === 'faa' || id === 'glare') { const a = layer('airport'); return ok(a?.acres) && a.acres > 0 ? `airport zone covers ${pct(100 * a.share)} of the disc` : 'no airport zone in the disc'; }
      if (id === 'water') return 'water supply not held';
      return 'verify locally'; };
    const opts = v => PERMIT_STATES.map(s => `<option ${((v || 'unknown') === s) ? 'selected' : ''}>${s}</option>`).join('');
    const nIn = (k, v, ph, label) => `<input type="number" step="1" min="0" data-act="land" data-k="${k}" value="${ok(v) ? v : ''}" placeholder="${ph}" aria-label="${esc(label)}">`;
    const GROUP = { common: 'Every project', solar: 'Solar', wind: 'Wind', storage: 'Storage', datacenter: 'Data centre' };
    const checklist = `<div class="notice warn" role="note"><b>Starting checklist from general knowledge, not a legal determination.</b> ${esc(PERMIT_DISCLAIMER)}</div>
      <div class="table-wrap land-status"><table class="dense" data-nosort><thead><tr><th>Permit</th><th>Applies to</th><th>Status</th><th class="num">Start (months after project start)</th><th class="num">Duration (months)</th><th>Prompted by the screen</th></tr></thead><tbody>${permitDefs.map((p, i) => `<tr${p.group !== 'common' ? ' class="hl"' : ''}><td class="wrap" title="${esc(p.why)}">${esc(p.label)}<br><span class="audit-note" style="margin:0">${esc(p.why)}</span></td><td>${esc(GROUP[p.group] || p.group)}</td><td><select data-act="land-permit" data-k="${esc(p.id)}" aria-label="${esc(p.label)} status">${opts(p.status)}</select></td><td class="num">${nIn(`po_${p.id}`, rows[i].offset, 'offset', `${p.label} start`)}</td><td class="num">${nIn(`pd_${p.id}`, rows[i].dur, 'months', `${p.label} duration`)}</td><td>${esc(prompt(i))}</td></tr>`).join('')}</tbody></table></div>`;
    const statusChart = C.barChart(['done', 'in progress', 'not needed', 'unknown'].map(k => ({ label: k, value: sum[k] })), { fmt: v => `${v.toFixed(0)}`, title: 'Permits by status', xLabel: 'Status', yLabel: 'Permits', height: 180 });
    const scGauge = scn.applicable ? gauge({ value: ok(pctv) ? Math.min(pctv, 100) : null, max: 100, marks: ok(scn.required) ? [{ v: scn.required, label: `${scn.required}%` }] : [], fmt: v => `${v}%`, label: 'Site control documented', tone: scn.verdict === 'Pass' ? 'var(--ok)' : 'var(--warn)', note: scn.status }) : `<div class="notice warn">${esc(scn.note)}</div>`;
    const tl = tasks && tasks.length ? C.gantt(tasks.map(t => ({ ...t, note: t.end == null ? 'duration not entered (open-ended)' : '' })), { title: 'Permit timeline (your estimates)' }) : emptyBox('Timeline not held', tasks ? 'Enter a start offset (months) for at least one permit.' : 'Enter the project start month, then offsets and durations in the checklist.');
    const startIn = `<label class="field" style="max-width:220px">Project start month <span class="pill">${st.start ? 'U' : 'NH'}</span><input type="month" data-act="land-permit" data-k="start" value="${esc(st.start || '')}"></label>`;
    const promptsRows = sc ? [...sc.subtracted, ...sc.advisory].map(l => {
      const what = { habitat: 'Wildlife consultation (state and federal) likely relevant', protected: 'Protected land: state review and conversion limits likely relevant', airport: 'Check whether FAA notice under 14 CFR Part 77 (Form 7460-1) applies; glare review near airports', 'energy-community': 'Not a permit: federal energy-community bonus eligibility (advisory)' }[l.layer] || 'Check with the permitting authority';
      return l.status === 'missing' ? `<tr>${td(l.layer)}${tn('not held')}${tn('not held')}<td class="wrap">${esc(`Not cleared by this screen: ${l.reason}. ${what}`)}</td></tr>` : `<tr>${td(l.layer)}${tn(ac(l.value))}${tn(pct(100 * l.share))}<td class="wrap">${esc(l.value > 0 ? what : 'none in the disc (layer coverage declared)')}</td></tr>`; }) : [];
    const prompts = sc ? tbl(['Layer', '#Acres in disc', '#Share', 'What it prompts (not a determination)'], promptsRows) : emptyBox('No screen held for this bus', 'Screen prompts need an exclusion screen (166 buses). Nothing is inferred without one.');
    const evidence = `<dl class="land-kv"><dt>Location on record</dt><dd>${ok(L.siteLat) && ok(L.siteLon) ? `site ${L.siteLat}, ${L.siteLon} (your placement)` : `bus coordinate ${node?.latitude?.toFixed?.(4) ?? '—'}, ${node?.longitude?.toFixed?.(4) ?? '—'} (no site placed)`}</dd>
        <dt>County, state</dt><dd>${esc(node?.county || 'not held')}, ${esc(node?.state_name || node?.state_code || '')} (unified dim_bus)</dd><dt>Town</dt><dd>not resolved (no municipal boundary data)</dd>
        <dt>Ordinance register</dt><dd>not held: the Studio's reference screen (state-preempted / restriction on record / not surveyed) is not in this workspace</dd>
        <dt>Parcel, title, boundary</dt><dd>not held: a coordinate is a point, not a parcel; this is not a title search</dd>
        <dt>Site-control documents</dt><dd>${!scn.applicable ? 'not applicable (load)' : ok(pctv) ? `${pctv}% entered by you` : 'none entered'}</dd></dl>`;
    return [
      card(8, 'Permit checklist', `${S.tech === 'hybrid' ? 'solar + storage' : S.tech} items highlighted · a starting checklist from general knowledge, not a legal determination`, checklist, 'Applicable permits depend on the state and town. Blank entries stay unknown and are never counted as done.', '', { answer: aCheck }),
      card(4, 'Status', `${sum.done} of ${sum.total} confirmed`, statusChart, '', '', { answer: aStatus }),
      card(4, 'Site control', prof.label, `${scGauge}<div class="land-form" style="margin-top:8px">${num('control', S, 'Site control documented', '% under lease, option or ownership')}</div>`, `${scn.cite ? `${scn.cite.text}. ` : ''}The deposit in lieu (NRIS only, where a regulatory limitation applies) is set in Queue › Cash & commitments; the same gate feeds the Decision site-control row.`, '', { answer: aSc }),
      card(8, 'Timeline', 'your start month + per-permit offsets and durations', `${startIn}${tl}`, '', '', { answer: aTl }),
      card(8, 'Screen prompts', sc ? `${sc.radiusMi}-mile disc · ${X_SRC}` : 'no screen', prompts, 'Water, wetlands, slope and urban land are not screened, so wetland and stormwater permits cannot be prompted from this screen.', '', { answer: aPr }),
      card(4, 'Ordinance and site-control evidence', 'what is on record for this location', evidence, '', '', { answer: aEv }),
      traceCard(tracePermits(sum, PERMITS, STATUS, permitDefs), traceSiteControl(S.tech, pctv, scn), traceTimeline(tasks, rows, st.start)),
    ];
  };
  const chips = [
    scn.applicable && ok(pctv) ? chip(`site control ${pctv}%`, 'land', 'control', '', 'Clear the site-control share') : '',
    st.start ? chip(`start ${st.start}`, 'land-permit', 'start', '', 'Clear the project start month') : '',
  ].filter(Boolean);
  return {
    key: 'permits', label: groupLabel('permits', S.tech), short: 'Permits',
    top: [K.control, K.confirmed], side: [K.window, K.ordinance],
    chips, none: sum.done + sum['in progress'] + sum['not needed'] ? `${sum.done} done · ${sum['in progress']} in progress` : 'Nothing entered yet',
    result: `${B(`${sum.done} of ${sum.total}`)} done · site control ${!scn.applicable ? 'n/a' : ok(pctv) ? B(`${pctv}%`) : 'not held'}`,
    answer: aCheck, secAnswer: aSc,
    body: `<p class="audit-note" style="margin:0">${esc(`${sum.done} done, ${sum['in progress']} in progress, ${sum['not needed']} not needed, ${sum.unknown} unknown. The checklist (status, start, duration), site control, the timeline and the screen prompts are entered on the Permits tab (${groupLabel('permits', S.tech)}).`)}</p><button type="button" class="tiny" data-act="tab" data-v="permits">Open the permit checklist ›</button>`,
    foot: 'A starting checklist from general knowledge, not a legal determination. Blank entries stay unknown and are never counted as done.',
    head: `${B(`${sum.done} of ${sum.total}`)} permits are confirmed; site control is ${!scn.applicable ? 'not applicable (a load)' : ok(pctv) ? B(`${pctv}%`) : 'not entered'}.`,
    cards,
  };
}

// ---------- The Map tab (2026-10-22; tabs back 2026-10-23): the map in the middle, every input and figure on screen ----------
// One bar names the map and the four analyses (Area · Cost · Route · Permits) as buttons, each with what is set in it (a ×
// clears it) and what it gives, and stays at the top while the page scrolls. On the Map tab: the answer and the KPIs
// (two per group, the other two beside its inputs on the map), then the map: the screening disc, the land need to
// scale, the stations by verdict, screened buses, generation and model buses near the bus, the placed site and its
// tie; the inputs float on its left (each group folds, and the panel folds to a button, in place) and the stations with
// this bus's identity on its right, so a change is read on the map without scrolling. The four analyses keep their full
// evidence on their own tabs, as before (views/land-tabs.js), so the permit checklist never sits under the map.
function landFloat(S, parts) {
  const shut = S.ui.landSec || {}, nSet = parts.reduce((t, p) => t + p.chips.length, 0);
  return `<aside class="mk-float mk-ff" aria-label="Land inputs"><header class="mk-float-h"><h3>Land inputs</h3><span class="mk-float-sub">${nSet ? `${nSet} set` : 'none entered'} · a change redraws the map</span><button type="button" class="mk-x" data-act="mk-float" data-k="landFilters" data-v="0" aria-label="Fold the land inputs" title="Fold">–</button></header>${parts.map(p => `<section class="mk-sec" data-sec="${p.key}"${shut[p.key] ? ' data-shut' : ''}><button type="button" class="mk-sec-h" data-act="land-sec" data-k="${p.key}" aria-expanded="${!shut[p.key]}"><span class="mk-sec-t">${esc(p.short)}</span><span class="mk-sec-r">${p.result}</span></button>${`<div class="mk-sec-b"><div class="kpis mk-sec-k">${p.side.join('')}</div>${p.secAnswer ? `<p class="mk-sec-a">${p.secAnswer}</p>` : ''}${p.body}${p.foot ? `<details class="more-ctl"><summary>Notes on ${esc(p.short)}</summary><p class="audit-note" style="margin:0">${p.foot}</p></details>` : ''}</div>`}</section>`).join('')}</aside>
    <button type="button" class="mk-float-min mk-ff-min" data-act="mk-float" data-k="landFilters" data-v="1" title="Show the land inputs">Land inputs${nSet ? ` · ${nSet} set` : ''} ▸</button>`;
}
/** Right of the map: the stations a tie could reach (this bus first, Grid's verdict), and this bus's identity. */
function stationsFloat(R) {
  const { groups, own, cov, tally, words, tieCost, P, aMap, idBox } = R;
  const pill = st => `<span class="pill ${st === 'Fits' ? 'good' : st === 'Does not fit' ? 'warn' : ''}">${esc(st === 'Fits' ? 'fits' : st === 'Does not fit' ? 'does not fit' : 'Hold')}</span>`;
  const row = g => `<tr data-st="${g.key}"><td><b>${esc(g.name)}</b> <span class="audit-note" style="margin:0">${esc(g.kv)} kV${g.buses > 1 ? ` · ${g.buses} buses` : ''}</span><div class="audit-note" style="margin:0">${ok(g.pm) ? `${g.pm.toFixed(0)} MW/mi` : 'no envelope'}${ok(tieCost(g)) ? ` · tie ${esc(fmt.money(tieCost(g)))}` : ''}${g.screened ? ' · screened' : ''}</div></td><td class="num">${g.d.toFixed(1)}</td><td>${pill(g.v.status)}</td></tr>`;
  const ownRow = own ? `<tr class="hl"><td><b>This bus</b><div class="audit-note" style="margin:0">Grid verdict for ${esc(words)}</div></td><td class="num">0.0</td><td>${pill(own.status)}</td></tr>` : '';
  const list = ready(P) ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Station</th><th class="num">mi</th><th>Verdict</th></tr></thead><tbody>${ownRow}${groups.slice(0, 25).map(row).join('') || `<tr><td colspan="3">No other spine station ${esc(cov?.short || 'within 15 mi')}.</td></tr>`}</tbody></table></div>` : pending(P);
  return `<aside class="mk-float mk-fl" aria-label="Stations near the bus and this bus" data-trace="l-alts"><header class="mk-float-h"><h3>Stations</h3><span class="mk-float-sub" title="${esc(cov?.label || '')}">${esc(cov?.short || 'within 15 mi')} · request ${esc(words)}</span><button type="button" class="mk-x" data-act="mk-float" data-k="landList" data-v="0" aria-label="Fold the stations" title="Fold">–</button></header>
    <p class="mk-float-a">${aMap}</p>
    ${list}
    <p class="card-f">${ready(P) ? `${esc(fmt.int(tally.fits))} fit, ${esc(fmt.int(tally.hold))} Hold, ${esc(fmt.int(tally.doesNotFit))} do not fit. ` : ''}Verdict = Grid's rule (D6.1): element study where held; envelope only is Hold, never clear. The full table, with each case, is on the Route tab (${esc(R.label)}).</p>
    <section class="mk-selb" aria-label="This bus"><h4>This bus <span class="audit-note">price link, owner and POI records</span></h4>${idBox}</section></aside>
    <button type="button" class="mk-float-min mk-fl-min" data-act="mk-float" data-k="landList" data-v="1" title="Show the stations">Stations${ready(P) ? ` · ${tally.fits} fit · ${tally.hold} Hold` : ''} ▸</button>`;
}
const LAYERS0 = { lSt: true, lRing: true, lDisc: true, lFoot: true, lScr: true, lGen: false, lBus: false };

export function renderLand(tab, ctx) {
  const { S, data, node } = ctx;
  if (!data.land) return '<div class="loading-panel" role="status"><span class="spinner" aria-hidden="true"></span><b>Loading land data…</b></div>';
  const A = partArea(ctx), F = partCost(ctx), R = partRoute(ctx), P = partPermits(ctx), parts = [A, F, R, P];
  const ICON = { area: 'area', footprint: 'cost', corridor: 'route', permits: 'permits' };
  const bar = categoryBar({ label: 'Land: the map and the four analyses', tab, items: [
    { id: 'map', icon: 'map', label: 'Map', title: 'The site map, with the land inputs and the stations beside it', result: A.result },
    ...parts.map(p => ({ id: p.key, icon: ICON[p.key], label: p.short, title: p.label, result: p.result, chips: p.chips, none: p.none })),
  ] });
  const enter = tabEnter('land', tab);
  if (tab !== 'map') {
    afterMapRender();
    return `<div class="mk-wb mk-tabwrap lnd-wb">${bar}<div class="mk-tabpage${enter}" data-tab="${esc(tab)}">${renderLandTab(tab, ctx)}</div></div>`;
  }
  const answer = [A.head, R.head, P.head].filter(Boolean).join(' ');
  // The map: drawn at its own size, framed by the floats (views/mapview.js); click places the site (app.js).
  const Lf = { ...LAYERS0, ...(S.ui.mapLayers || {}) }, idx = new Map((data.index || []).map(b => [String(b.id), b]));
  const at = id => { const b = idx.get(String(id)); return b && ok(b.lat) && ok(b.lon) ? b : null; };
  const near10 = rows => (rows || []).map(r => ({ r, b: at(r.bus_id) })).filter(x => x.b);
  const screened = A.map.nb.filter(r => !r.self).map(r => ({ r, b: at(r.id) })).filter(x => x.b).map(({ r, b }) => ({ lat: b.lat, lon: b.lon, name: r.name, kv: r.kv, share: r.share, clear: r.clear, radius: r.radius, fits: r.fits }));
  const gensAt = new Map();
  for (const { r, b } of near10(ready(R.P) ? R.P.gens : [])) { const e = gensAt.get(b.id) || { lat: b.lat, lon: b.lon, bus: b.name, mw: 0, plants: [] }; e.mw += r.max_mw || 0; e.plants.push({ name: r.gen_name, mw: r.max_mw || 0, status: r.status || '' }); gensAt.set(b.id, e); }
  const mbuses = near10(ready(R.P) ? R.P.buses : []).map(({ r, b }) => ({ lat: b.lat, lon: b.lon, name: r.bus_name, kv: r.nominal_kv, mi: r.mi, spine: r.on_spine }));
  const spec = landMapSpec(node, R.site, R.groups, { mw: R.mw, fmtHr: v => (ok(v) ? `${v.toFixed(0)} MW` : 'no envelope'), sc: A.map.sc, fp: A.map.fp, L: { st: Lf.lSt, rings: Lf.lRing, disc: Lf.lDisc, foot: Lf.lFoot, scr: Lf.lScr, gen: Lf.lGen, mbus: Lf.lBus }, screened, gens: [...gensAt.values()], mbuses, tieLabel: R.tieLabel });
  const g = mapGeom(S.ui.landFilters, S.ui.landList);
  const drawn = spec ? frameMap('land-map', g, (gg, whole) => {
    const e = padExtent(boxOf(spec.box, 1), gg.W, gg.H, gg.pad), html = (whole ? geoMap : geoMapSvg)({ id: 'land-map', width: gg.W, height: gg.H, extent: e, layers: spec.layers, title: spec.title });
    return html.replace('<svg data-map=', `<svg data-site-map data-lon0="${e.lon0}" data-lat0="${e.lat0}" data-span="${e.lat1 - e.lat0}" data-lspan="${e.lon1 - e.lon0}" data-map=`);
  }) : '<div class="empty"><strong>No coordinate for this bus</strong>The map needs the bus latitude and longitude (dim_bus); none is held.</div>';
  const n = arr => (arr || []).length;
  const toggles = [['lSt', 'Stations', ready(R.P) ? n(R.groups) : null], ['lRing', 'Rings 3 / 6 / 9 mi'], ['lDisc', 'Screening disc'], ['lFoot', 'Land need to scale'], ['lScr', 'Screened buses', screened.length], ['lGen', 'Generation (10 mi)', gensAt.size], ['lBus', 'Model buses (10 mi)', mbuses.length]]
    .filter(([k, , c]) => !(['lGen', 'lBus', 'lScr'].includes(k) && c === 0)) // nothing to place (no bus-index coordinate): no toggle
    .map(([k, l, c]) => `<label class="inline-check" style="margin:0 10px 0 0"><input type="checkbox" data-act="map-layer" data-k="${k}" ${Lf[k] ? 'checked' : ''}> ${esc(l)}${ok(c) ? ` (${fmt.int(c)})` : ''}</label>`).join('');
  const mapBody = `${R.xNote ? '' : '<p class="audit-note" style="margin:0">Exclusion shapes are not held: the screen holds acres per layer, so the map cannot show where protected land or habitat lies; the disc and the need are drawn to scale only.</p>'}
    <div class="chip-row" style="display:flex;flex-wrap:wrap;align-items:center">${toggles}</div>
    <div class="mk-map-wrap">${drawn}${landFloat(S, parts)}${stationsFloat(R)}</div>${spec ? geoLegend(spec.legend) : ''}`;
  const mapCard = card('12 mk-map', 'Site map', 'click to place the site · stations coloured by whether they clear the request · the land need drawn to scale', mapBody, 'Coordinates: unified dim_bus / dim_substation; neighbours, generation and model buses from the bus index (a generator at its connection bus). Geographic proximity is not an electrical relationship. Scroll to zoom, drag to pan.', 'screen', { answer: R.aMap });
  const fold = v => (v === '0' ? '0' : v === '1' ? '1' : 'auto');
  afterMapRender('land-map');
  return `${LAND_CSS}<div class="mk-wb lnd-wb" data-ff="${fold(S.ui.landFilters)}" data-fl="${fold(S.ui.landList)}">
    ${bar}
    <div class="mk-mappage${enter}">
    ${answer ? `<p class="card-answer mk-wb-answer">${answer}</p>` : ''}
    <div class="kpis">${parts.flatMap(p => p.top).join('')}</div>
    ${F.vn ? `<div class="notice warn" role="note"><b>Verify before client use.</b> ${esc(F.vn)}</div>` : ''}
    ${mapCard}
    ${nextStep('grid', 'capacity', 'test the connection in Grid › Connection capacity')}
    </div>
  </div>`;
}

// Document-level and registered once (the board is rebuilt on every render): hovering a station row lights it on the
// Map tab's map.
if (typeof document !== 'undefined') {
  const lit = k => { for (const c of document.querySelectorAll('svg[data-map="land-map"] circle.m-hov')) c.classList.remove('m-hov'); if (k) for (const c of document.querySelectorAll(`svg[data-map="land-map"] circle[data-v="${CSS.escape(k)}"]`)) c.classList.add('m-hov'); };
  document.addEventListener('pointerover', e => { const tr = e.target.closest?.('.lnd-wb .mk-fl tr[data-st]'); if (tr) lit(tr.dataset.st); });
  document.addEventListener('pointerout', e => { const tr = e.target.closest?.('.lnd-wb .mk-fl tr[data-st]'); if (tr && !tr.contains(e.relatedTarget)) lit(null); });
}
