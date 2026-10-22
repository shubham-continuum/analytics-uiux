// Calculation traces for Land. Independent checks: the measured disc against π·r²·640, single-block screens against the
// layer bounds, the footprint band ordering, and distance by a second formula (relative). The bound "largest block ≤
// disc − largest layer" is labelled a consistency check (it re-reads the same screen).
import { trace } from '../trace.js';
import { fmt } from '../basis.js';
import { discAcres, fitLabel, annuityFactor, miles as hav } from '../landcore.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const BLOCK = 'Largest block outside habitat/protected land';
const CAVEAT = 'Not buildable land: only habitat and protected land are subtracted. Water, urban land, wetlands and slope are not screened, so "fits" is an upper bound.';
/** UTM 19N scale note for the area method (screens west of 72°W carry about 0.2% area error). */
export const utmNote = node => `Screens are measured in UTM 19N (EPSG:26919); for buses west of 72°W that zone's scale error is about 0.2% of area${ok(node?.longitude) && node.longitude < -72 ? ' (this bus is west of 72°W)' : ''}.`;
/** The dataset's own verify-before-client warning on the intensity figures (null when absent). */
export const verifyNote = intensity => (intensity?.notes || []).find(n => /secondary extraction/i.test(n)) || null;
const ac = v => (ok(v) ? `${Math.round(v).toLocaleString('en-US')} ac` : 'not held');
const usd = v => (ok(v) ? fmt.money(v) : 'not held');
const eqMiles = (a, b) => { const R = 3958.8, r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos(((a.lat + b.lat) / 2) * r), y = (b.lat - a.lat) * r; return R * Math.hypot(x, y); };

/** Buildable area: layers, net exclusion bounds and the largest clear block. */
export function traceArea(node, sc) {
  if (!sc) return trace({ id: 'l-area', title: 'Area outside habitat/protected land', formula: `${BLOCK} = the largest contiguous part of the disc outside every subtracted layer (habitat, protected)`, inputs: [{ name: 'Bus', value: `${node?.name} (${node?.id})`, source: 'measured' }], steps: [{ label: 'Exclusion screen', work: 'not held for this bus (screens exist for 166 buses)', value: '—' }], result: { label: BLOCK, value: 'not held' }, notes: ['No check possible: no exclusion screen is held for this bus, so the area is unknown (never assumed clear).'] });
  const sub = sc.subtracted.map(l => l.value).filter(ok), maxL = sub.length ? Math.max(...sub) : 0, sumL = sub.reduce((a, b) => a + b, 0), disc = discAcres(sc.radiusMi), ex = sc.gross - sc.clear;
  const one = sc.blocks === 1 && ok(ex), outside = ex < maxL ? maxL - ex : ex > sumL ? ex - sumL : 0;
  return trace({
    id: 'l-area', title: 'Area outside habitat/protected land around the bus',
    formula: `Disc = π·r²·640 acres (r in miles);  excluded (net) lies between the largest subtracted layer and their sum (layers overlap);  ${BLOCK.toLowerCase()} ≤ disc − largest subtracted layer`,
    inputs: [{ name: 'Screening disc', value: `${sc.radiusMi} mi radius · ${ac(sc.gross)}`, source: 'measured', note: `${sc.method} ${utmNote(node)}` }, ...sc.subtracted.map(l => ({ name: `Subtracted: ${l.layer}`, value: l.status === 'missing' ? 'not held' : ac(l.value), source: l.status === 'missing' ? 'not held' : 'measured', note: l.status === 'missing' ? l.reason : (l.source || '') })), ...sc.advisory.map(l => ({ name: `Advisory: ${l.layer}`, value: l.status === 'missing' ? 'not held' : ac(l.value), source: 'measured', note: 'informs siting; not removed' }))],
    steps: [
      { label: 'Disc by formula', work: `π × ${sc.radiusMi}² × 640`, value: ac(disc) },
      { label: 'Net excluded, lower bound', work: 'largest single subtracted layer', value: `${ac(maxL)} (${fmt.pct((100 * maxL) / sc.gross)})` },
      { label: 'Net excluded, upper bound', work: 'sum of subtracted layers (if none overlap)', value: `${ac(Math.min(sumL, sc.gross))} (${fmt.pct((100 * Math.min(sumL, sc.gross)) / sc.gross)})` },
      { label: BLOCK, work: `${sc.blocks} blocks; the largest one counts`, value: ac(sc.clear) },
      { label: 'Outside the largest block', work: `1 − ${ac(sc.clear)} ÷ ${ac(sc.gross)} (exclusions + fragmentation)`, value: fmt.pct(100 * (1 - sc.clear / sc.gross)) },
    ],
    result: { label: BLOCK, value: ac(sc.clear) },
    checks: [
      { label: 'Independent: measured disc = π·r²·640 (within 0.1%)', a: sc.gross, b: disc, tol: 0.001, fmt: v => ac(v) },
      ...(one ? [{ label: `Independent (single block): disc − block = ${ac(ex)} lies within [largest layer ${ac(maxL)}, sum of layers ${ac(sumL)}]; distance outside the range`, a: outside, b: 0, atol: 1, fmt: v => ac(v) }] : []),
      { label: 'Consistency check: the largest block does not exceed the disc minus the largest subtracted layer', a: Math.max(0, sc.clear - (sc.gross - maxL)), b: 0, atol: 1, fmt: v => ac(v) },
    ],
    notes: [CAVEAT, ...(sc.water === false ? ['Water bodies are not excluded in this screen, so the block is overstated near coasts and lakes.'] : []), 'Airport zones and energy-community status are advisory: shown, not subtracted.', ...(one ? [] : [`The layer-range check applies only to single-block screens; this screen has ${sc.blocks} blocks, so fragmentation also removes area.`])],
  });
}

/** Footprint & land cost. */
export function traceFootprint(S, mw, fp, sc, f, buy, lease, vn = null) {
  if (!fp) return '';
  const r = fp.row;
  const ordered = [fp.low, fp.base, fp.high].every(ok) ? (fp.low <= fp.base && fp.base <= fp.high ? 0 : 1) : null;
  return trace({
    id: 'l-footprint', title: 'Land need and cost',
    formula: 'Acres = MW × acres per MW (low / base / high);  fits (habitat/protected screen only) = largest block outside habitat/protected land ≥ acres;  purchase = acres × $/acre;  lease = acres × $/acre-yr',
    inputs: [{ name: 'Technology, size', value: `${S.tech}, ${fmt.mw(mw)}`, source: 'user' },
      { name: 'Acres per MW (low / base / high)', value: `${r.low_acres_per_mw} / ${r.base_acres_per_mw} / ${r.high_acres_per_mw}`, source: 'assumption', note: `${fp.cited ? 'literature value, cited' : 'rule of thumb, not a study'} · ${fp.basis || ''} · ${fp.source || ''}` },
      { name: BLOCK, value: ac(sc?.clear), source: sc ? 'measured' : 'not held', note: sc ? 'upper bound: water, urban land, wetlands and slope not screened' : 'no exclusion screen held for this bus' },
      { name: 'Purchase price', value: ok(buy) ? `$${buy.toLocaleString('en-US')}/acre` : 'not entered', source: 'user', note: 'No measured $/acre is held (county figures are one assumption applied everywhere)' },
      { name: 'Lease rate', value: ok(lease) ? `$${lease.toLocaleString('en-US')}/acre-yr` : 'not entered', source: 'user' }],
    steps: [
      ...['low', 'base', 'high'].map(k => ({ label: `${k[0].toUpperCase() + k.slice(1)} need`, work: `${fmt.mw(mw)} × ${r[`${k}_acres_per_mw`]} ac/MW`, value: ac(fp[k]) })),
      { label: 'Fit (base)', work: sc ? `${ac(sc.clear)} ≥ ${ac(fp.base)}?` : 'no screen held', value: fitLabel(f.status) },
      { label: 'Purchase at base need', work: ok(buy) ? `${ac(fp.base)} × $${buy.toLocaleString('en-US')}` : 'enter a $/acre price', value: usd(ok(buy) ? fp.base * buy : null) },
      { label: 'Lease at base need', work: ok(lease) ? `${ac(fp.base)} × $${lease.toLocaleString('en-US')}` : 'enter a lease rate', value: ok(lease) ? `${usd(fp.base * lease)}/yr` : 'not held' },
    ],
    result: { label: 'Base land need', value: ac(fp.base) },
    check: { label: 'Data check: the intensity table orders low ≤ base ≤ high', a: ordered, b: 0, atol: 0, fmt: v => (v === 0 ? 'ordered' : v === 1 ? 'out of order' : 'not held') },
    notes: [CAVEAT, ...(vn ? [`Dataset warning: ${vn}`] : [])],
  });
}

/** Connection corridor. */
export function traceCorridor(node, site, c, L) {
  if (!ok(c.distance)) return trace({ id: 'l-corridor', title: 'Connection corridor', formula: 'Cost = straight-line miles × routing factor × $/mile + terminal works + crossings', inputs: [{ name: 'Site', value: 'not placed', source: 'user' }], steps: [{ label: 'Distance', work: c.reason, value: 'not held' }], result: { label: 'Line cost', value: 'not held' }, notes: ['No check possible: place the site first (a missing site is never treated as zero distance).'] });
  const bus = { lat: node?.latitude, lon: node?.longitude }, d2 = eqMiles(site, bus);
  return trace({
    id: 'l-corridor', title: 'Connection line to the bus',
    formula: 'Distance = great-circle (haversine, R = 3,958.8 mi);  routed = distance × routing factor;  cost = routed × $/mile + terminal works + crossings',
    inputs: [{ name: 'Site', value: `${site.lat}, ${site.lon}`, source: 'user' }, { name: 'Bus', value: `${bus.lat?.toFixed(4)}, ${bus.lon?.toFixed(4)}`, source: 'measured' },
      { name: 'Routing factor', value: String(L.route ?? 1.2), source: ok(L.route) ? 'user' : 'assumption', note: c.routeError ? 'rejected (below 1)' : ok(L.route) ? '' : '1.2 placeholder (needs a source)' },
      { name: 'Line cost', value: ok(L.perMile) ? `$${L.perMile.toLocaleString('en-US')}/mi` : 'not entered', source: 'user', note: 'No $/mile benchmark is held' },
      { name: 'Terminal works, crossings', value: `${usd(L.terminal)}, ${usd(L.crossings)}`, source: 'user' }],
    steps: [
      { label: 'Straight-line distance', work: 'haversine', value: `${c.distance.toFixed(2)} mi` },
      { label: 'Routed length', work: c.routeError || `${c.distance.toFixed(2)} × ${L.route ?? 1.2}`, value: ok(c.route) ? `${c.route.toFixed(2)} mi` : 'not held' },
      { label: 'Line', work: ok(L.perMile) ? `${(c.route ?? c.distance).toFixed(2)} mi${ok(c.route) ? '' : ' (straight line, lower bound)'} × $${L.perMile.toLocaleString('en-US')}` : 'enter $/mile', value: usd(ok(L.perMile) ? (c.route ?? c.distance) * L.perMile : null) },
      { label: 'Total', work: `line + terminal + crossings${c.status === 'partly priced' ? ` (${c.reason})` : ''}`, value: `${c.status === 'partly priced' ? '≥ ' : ''}${usd(c.cost)}` },
    ],
    result: { label: 'Line cost', value: `${c.status === 'partly priced' ? '≥ ' : ''}${usd(c.cost)}` },
    check: { label: 'Distance by a second formula: equirectangular ÷ haversine = 100% (relative tolerance 0.5%)', a: c.distance > 0 ? d2 / c.distance : d2 === 0 ? 1 : null, b: 1, atol: 0.005, fmt: v => (ok(v) ? `${(100 * v).toFixed(3)}%` : 'not held') },
    notes: c.routeError ? [`${c.routeError}: the routed length is not held and the straight line is used as a lower bound.`] : [],
  });
}

// ---------- v2 traces (2026-09-29) ----------
const SRC_X = 'Studio copy (data-ext.js exclusions, not in the unified DB)';
const pc = v => (ok(v) ? `${v.toFixed(1)}%` : 'not held');

/** Disc composition (ring diagram). */
export function traceRing(sc, split) {
  if (!split) return trace({ id: 'l-ring', title: 'Disc composition', formula: 'Disc = largest block + certainly excluded (largest subtracted layer) + remainder (other exclusions or fragments)', inputs: [], steps: [{ label: 'Exclusion screen', work: 'not held for this bus', value: '—' }], result: { label: 'Composition', value: 'not held' }, notes: ['No check possible: no exclusion screen is held for this bus (screens exist for 166 buses).'] });
  return trace({
    id: 'l-ring', title: 'Disc composition (ring diagram)',
    formula: 'Disc = largest block + certainly excluded + remainder;  certainly excluded = min(largest subtracted layer, disc − block);  remainder = excluded by other layers or clear but outside the largest block (the screen does not split the two)',
    inputs: [{ name: 'Disc', value: ac(split.gross), source: 'measured', note: SRC_X }, { name: BLOCK, value: ac(split.block), source: 'measured', note: `${sc.blocks} blocks; only the largest is reported` }, { name: 'Largest subtracted layer', value: ac(Math.max(0, ...sc.subtracted.map(l => l.acres).filter(ok))), source: 'measured' }],
    steps: [{ label: 'Largest block', work: 'as measured', value: `${ac(split.block)} (${pc((100 * split.block) / split.gross)})` },
      { label: 'Certainly excluded', work: `min(largest layer, ${ac(split.gross)} − ${ac(split.block)})`, value: `${ac(split.excludedMin)} (${pc((100 * split.excludedMin) / split.gross)})` },
      { label: 'Remainder', work: `${ac(split.gross)} − ${ac(split.block)} − ${ac(split.excludedMin)}`, value: `${ac(split.rest)} (${pc((100 * split.rest) / split.gross)})` }],
    result: { label: 'Largest block share of the disc', value: pc((100 * split.block) / split.gross) },
    checks: [{ label: 'Arithmetic re-check: the three segments sum to the disc', a: split.block + split.excludedMin + split.rest, b: split.gross, tol: 1e-9, fmt: v => ac(v) },
      { label: 'Independent: measured disc = π·r²·640 (within 0.1%)', a: split.gross, b: discAcres(sc.radiusMi), tol: 0.001, fmt: v => ac(v) }],
    notes: [CAVEAT],
    csv: { name: 'land-disc-composition.csv', columns: ['segment', 'acres', 'share_of_disc_pct'], rows: [['largest block', split.block, (100 * split.block) / split.gross], ['certainly excluded', split.excludedMin, (100 * split.excludedMin) / split.gross], ['remainder', split.rest, (100 * split.rest) / split.gross], ['disc', split.gross, 100]] },
  });
}

/** Largest block vs need (gauge). */
export function traceCover(fp, sc, cov, mw, tech) {
  if (!fp || !sc || cov.base == null) return trace({ id: 'l-cover', title: 'Largest block vs land need', formula: 'Cover = largest block outside habitat/protected land ÷ land need (≥ 1 = the block is at least the need; an upper bound)', inputs: [{ name: 'Land need', value: fp ? ac(fp.base) : 'not held', source: fp ? 'derived' : 'user' }, { name: BLOCK, value: ac(sc?.clear), source: sc ? 'measured' : 'not held' }], steps: [], result: { label: 'Cover (base)', value: 'not held' }, notes: [`No check possible: ${!fp ? 'enter a project size' : 'no exclusion screen is held for this bus'}; unknown never passes.`] });
  const x = v => (ok(v) ? `${v.toFixed(2)}×` : 'not held');
  return trace({
    id: 'l-cover', title: 'Largest block vs land need',
    formula: 'Cover_band = largest block ÷ need_band;  fits (habitat/protected screen only) when cover ≥ 1',
    inputs: [{ name: 'Project', value: `${tech}, ${fmt.mw(mw)}`, source: 'user' }, { name: BLOCK, value: ac(sc.clear), source: 'measured', note: SRC_X }, ...['low', 'base', 'high'].map(k => ({ name: `Need (${k})`, value: ac(fp[k]), source: 'derived', note: 'MW × acres per MW' }))],
    steps: ['low', 'base', 'high'].map(k => ({ label: `Cover (${k} need)`, work: `${ac(sc.clear)} ÷ ${ac(fp[k])}`, value: x(cov[k]) })),
    result: { label: 'Cover at base need', value: x(cov.base) },
    check: { label: 'Arithmetic re-check: cover × base need = largest block', a: cov.base * fp.base, b: sc.clear, tol: 1e-9, fmt: v => ac(v) },
    notes: [CAVEAT, 'A cover above 1 does not make the site buildable: water, urban land, wetlands, slope and parcel ownership are not screened.'],
    csv: { name: 'land-block-cover.csv', columns: ['band', 'need_acres', 'largest_block_acres', 'cover_ratio'], rows: ['low', 'base', 'high'].map(k => [k, fp[k], sc.clear, cov[k]]) },
  });
}

/** Screened neighbours: block share per screened bus. */
export function traceNeighbours(rows) {
  if (!rows.length) return trace({ id: 'l-neighbours', title: 'Screened buses nearby', formula: 'Block share = largest block ÷ disc, per screened bus', inputs: [], steps: [], result: { label: 'Screened buses listed', value: '0' }, notes: ['No check possible: no screened bus carries a coordinate near this one.'] });
  const errs = rows.map(r => (ok(r.gross) && ok(r.radius) ? Math.abs(r.gross / discAcres(r.radius) - 1) : null)).filter(ok);
  return trace({
    id: 'l-neighbours', title: 'Screened buses nearby (the 166 with an exclusion screen)',
    formula: 'Block share = largest block ÷ disc;  distance = great-circle miles between bus coordinates (dim_substation)',
    inputs: [{ name: 'Screens', value: `${rows.length} nearest of 166`, source: 'measured', note: SRC_X }, { name: 'Coordinates', value: 'dim_substation', source: 'measured', note: 'unified DB' }],
    steps: rows.slice(0, 8).map(r => ({ label: `${r.name} ${r.kv} kV (${r.mi.toFixed(1)} mi)`, work: `${ac(r.clear)} ÷ ${ac(r.gross)}`, value: pc(r.share) })),
    result: { label: 'Nearest screened bus', value: `${rows[0].name} · ${rows[0].mi.toFixed(1)} mi` },
    check: { label: 'Independent: every listed disc = π·r²·640 (largest relative error ≤ 0.1%)', a: errs.length ? Math.max(...errs) : null, b: 0, atol: 0.001, fmt: v => (ok(v) ? `${(100 * v).toFixed(3)}%` : 'not held') },
    notes: [CAVEAT, 'Screens are drawn on each bus with that bus\'s own radius (3 or 8 mi), so discs of different size are compared by share, not acres.'],
    csv: { name: 'land-screened-neighbours.csv', columns: ['bus_id', 'name', 'kv', 'miles', 'radius_mi', 'disc_acres', 'largest_block_acres', 'block_share_pct', 'blocks', 'water_excluded'], rows: rows.map(r => [r.id, r.name, r.kv, r.mi, r.radius, r.gross, r.clear, r.share, r.blocks, r.water]) },
  });
}

/** Need by technology and size. */
export function traceNeedCurve(matrix, intensity, sizes) {
  const s = t => matrix.find(r => r.tech === 'solar' && r.mw === t)?.base;
  const lo = sizes[0], hi = sizes[sizes.length - 1];
  const techs = [...new Set(matrix.map(r => r.tech))];
  return trace({
    id: 'l-needcurve', title: 'Land need by technology and size',
    formula: 'Need = MW × acres per MW (low / base / high), per technology',
    inputs: techs.map(t => { const k = { storage: 'bess', datacenter: 'dc' }[t] || t, r = intensity?.by_fuel?.[k]; return { name: `${t} ac/MW (low / base / high)`, value: r ? `${r.low_acres_per_mw} / ${r.base_acres_per_mw} / ${r.high_acres_per_mw}` : 'not held', source: 'assumption', note: r ? `${r.cited ? 'cited study' : 'rule of thumb'} · ${r.area_basis || ''}` : '' }; }),
    steps: techs.map(t => { const a = matrix.find(r => r.tech === t && r.mw === lo), b = matrix.find(r => r.tech === t && r.mw === hi); return { label: t, work: `${lo} MW → ${hi} MW (base)`, value: `${ac(a?.base)} → ${ac(b?.base)}` }; }),
    result: { label: `Solar base need at ${hi} MW`, value: ac(s(hi)) },
    check: { label: `Consistency check: need is linear in MW (solar base ${hi} MW ÷ ${lo} MW = ${hi / lo})`, a: ok(s(hi)) && ok(s(lo)) ? s(hi) / s(lo) : null, b: hi / lo, tol: 1e-9, fmt: v => (ok(v) ? v.toFixed(4) : 'not held') },
    notes: ['Hybrid assumes storage MW equals solar MW with storage outside the solar fence; data-centre and storage rows are trade rules of thumb (no published study).'],
    csv: { name: 'land-need-matrix.csv', columns: ['technology', 'mw', 'low_acres', 'base_acres', 'high_acres'], rows: matrix.map(r => [r.tech, r.mw, r.low, r.base, r.high]) },
  });
}

/** Land cost sensitivity ($/acre × need band). */
export function traceCostGrid(grid, rates, fp) {
  const bi = rates.findIndex(r => ok(r.rate)), base = grid.find(g => g.band === 'base');
  if (!fp || bi < 0) return trace({ id: 'l-costgrid', title: 'Land cost sensitivity', formula: 'Cost = need (acres) × $/acre, for each need band and $/acre level', inputs: rates.map(r => ({ name: r.label, value: ok(r.rate) ? `$${r.rate.toLocaleString('en-US')}/ac` : 'not held', source: r.source })), steps: [], result: { label: 'Base cost', value: 'not held' }, notes: [`No check possible: ${!fp ? 'enter a project size' : 'no $/acre level is held (the county reference is absent and none was entered)'}.`] });
  return trace({
    id: 'l-costgrid', title: 'Land cost sensitivity ($/acre × need band)',
    formula: 'Cost_band,level = need_band (acres) × $/acre_level',
    inputs: [...rates.map(r => ({ name: r.label, value: ok(r.rate) ? `$${r.rate.toLocaleString('en-US')}/ac` : 'not entered', source: r.source, note: r.note || '' })), ...['low', 'base', 'high'].map(k => ({ name: `Need (${k})`, value: ac(fp[k]), source: 'derived' }))],
    steps: grid.map(g => ({ label: `${g.band} need, ${rates[bi].label}`, work: `${ac(g.acres)} × $${rates[bi].rate.toLocaleString('en-US')}`, value: usd(g.costs[bi]) })),
    result: { label: `Base need at ${rates[bi].label}`, value: usd(base.costs[bi]) },
    check: { label: 'Arithmetic re-check: base cost ÷ base acres = the $/acre level', a: base.costs[bi] / base.acres, b: rates[bi].rate, tol: 1e-9, fmt: v => (ok(v) ? `$${v.toFixed(2)}` : 'not held') },
    notes: ['The county reference is one assumption band applied to every county (no measured price per acre is held anywhere in the workspace); it is a sensitivity, never a headline.', 'Land only: no easement, option premium, closing cost or site preparation.'],
    csv: { name: 'land-cost-grid.csv', columns: ['band', 'acres', ...rates.map(r => `${r.label} ($)`)], rows: grid.map(g => [g.band, g.acres, ...g.costs]) },
  });
}

/** Lease vs buy NPV. */
export function traceLeaseBuy(lb, inp) {
  if (lb.status !== 'ok') return trace({ id: 'l-leasebuy', title: 'Lease vs buy (NPV)', formula: 'PV lease = acres × lease × Σ_{t=1..N} (1+g)^(t−1)/(1+r)^t;  net buy = acres × price − PV(resale)', inputs: [], steps: [{ label: 'Inputs', work: `missing: ${lb.missing.join(', ')}`, value: 'not held' }], result: { label: 'PV difference', value: 'not held' }, notes: [`No check possible: ${lb.missing.join(', ')} not entered (a blank is never 0).`] });
  let loop = 0; for (let t = 1; t <= inp.years; t++) loop += (1 + inp.esc / 100) ** (t - 1) / (1 + inp.disc / 100) ** t;
  return trace({
    id: 'l-leasebuy', title: 'Lease vs buy (NPV)',
    formula: 'AF = Σ_{t=1..N} (1+g)^(t−1)/(1+r)^t = (1 − ((1+g)/(1+r))^N)/(r − g);  PV lease = acres × lease × AF;  net buy = acres × price − acres × price × resale% /(1+r)^N;  break-even lease = net buy ÷ (acres × AF)',
    inputs: [{ name: 'Land (base need)', value: ac(inp.acres), source: 'derived' }, { name: 'Purchase price', value: `$${inp.buy.toLocaleString('en-US')}/ac`, source: 'user' }, { name: 'Lease rate', value: `$${inp.lease.toLocaleString('en-US')}/ac-yr`, source: 'user' }, { name: 'Discount rate r', value: `${inp.disc}%`, source: 'user' }, { name: 'Term N', value: `${inp.years} yr`, source: 'user' }, { name: 'Lease escalator g', value: `${inp.esc}%/yr`, source: 'user' }, { name: 'Resale at end', value: ok(inp.resale) ? `${inp.resale}% of price` : 'not entered', source: 'user', note: ok(inp.resale) ? '' : 'no resale credit: the buy cost is an upper bound' }],
    steps: [{ label: 'Annuity factor', work: `(1 − (${(1 + inp.esc / 100).toFixed(4)}/${(1 + inp.disc / 100).toFixed(4)})^${inp.years}) / (${inp.disc / 100} − ${inp.esc / 100})`, value: lb.af.toFixed(4) },
      { label: 'PV of lease payments', work: `${ac(inp.acres)} × $${inp.lease.toLocaleString('en-US')} × ${lb.af.toFixed(4)}`, value: usd(lb.pvLease) },
      { label: 'Purchase', work: `${ac(inp.acres)} × $${inp.buy.toLocaleString('en-US')}`, value: usd(lb.buyCost) },
      { label: 'PV of resale', work: ok(inp.resale) ? `${usd(lb.buyCost)} × ${inp.resale}% ÷ ${(1 + inp.disc / 100).toFixed(4)}^${inp.years}` : 'not entered', value: usd(lb.pvResale) },
      { label: 'Net buy', work: 'purchase − PV resale', value: `${lb.buyBound ? '≤ ' : ''}${usd(lb.netBuy)}` },
      { label: 'Break-even lease', work: `${usd(lb.netBuy)} ÷ (${ac(inp.acres)} × ${lb.af.toFixed(4)})`, value: `$${lb.breakevenLease.toFixed(0)}/ac-yr` }],
    result: { label: 'PV lease − net buy', value: usd(lb.diff) },
    check: { label: 'Independent: closed-form annuity factor = year-by-year sum', a: lb.af, b: loop, tol: 1e-9, fmt: v => (ok(v) ? v.toFixed(6) : 'not held') },
    notes: ['Every input is yours; nothing here is a measured land price. Taxes, option payments and decommissioning obligations are not included.'],
    csv: { name: 'land-lease-vs-buy.csv', columns: ['year', 'lease_payment', 'discount_factor', 'pv_lease_payment', 'cumulative_pv_lease'], rows: (() => { let c = 0; return Array.from({ length: inp.years }, (_, i) => { const t = i + 1, p = inp.acres * inp.lease * (1 + inp.esc / 100) ** (t - 1), d = 1 / (1 + inp.disc / 100) ** t; c += p * d; return [t, p, d, p * d, c]; }); })() },
  });
}

/** Alternative stations: distance and headroom per mile. */
export function traceAlts(groups, origin, side, mw, cov = null) {
  const within = cov?.short || 'within 15 mi';
  const first = groups[0];
  if (!first) return trace({ id: 'l-alts', title: 'Alternative connection stations', formula: 'Distance = haversine;  MW per mile = headroom ÷ max(miles, 0.5)', inputs: [], steps: [], result: { label: `Stations ${within}`, value: '0' }, notes: ['No check possible: no other spine station lies within 15 miles of this bus.'] });
  const d1 = hav(origin, { lat: first.lat, lon: first.lon }), d2 = eqMiles(origin, { lat: first.lat, lon: first.lon });
  return trace({
    id: 'l-alts', title: 'Alternative connection stations',
    formula: `Distance = great-circle miles from ${origin.label};  verdict = Grid caseTable + binding (D6.1): Fits / Does not fit on element-study evidence only, envelope only = Hold;  MW per mile = lowest governing figure (${side.label}) ÷ max(miles, 0.5) (Studio ranking convenience, not a cost)`,
    inputs: [{ name: 'Origin', value: `${origin.label} (${origin.lat.toFixed(4)}, ${origin.lon.toFixed(4)})`, source: origin.user ? 'user' : 'measured' }, { name: 'Request', value: fmt.mw(mw), source: 'user' }, { name: 'Stations', value: `${groups.length} ${within} (buses sharing name, kV and coordinate grouped)${cov?.truncated ? `; ${cov.label}` : ''}`, source: 'measured', note: 'unified dim_substation + fact_headroom' }],
    steps: groups.slice(0, 8).map(g => ({ label: `${g.name} ${g.kv} kV`, work: `${g.d.toFixed(2)} mi · ${ok(g.hr) ? `${g.hr.toFixed(1)} MW ÷ ${Math.max(g.d, 0.5).toFixed(2)} mi` : 'no solved envelope'}`, value: `${ok(g.pm) ? `${g.pm.toFixed(1)} MW/mi` : 'not held'} · ${g.v?.label ?? g.clears}` })),
    result: { label: 'Nearest alternative', value: `${first.name} ${first.kv} kV · ${first.d.toFixed(1)} mi` },
    check: { label: 'Independent: distance to the nearest station by a second formula (equirectangular ÷ haversine = 100%, tolerance 0.5%)', a: d1 > 0 ? d2 / d1 : d2 === 0 ? 1 : null, b: 1, atol: 0.005, fmt: v => (ok(v) ? `${(100 * v).toFixed(3)}%` : 'not held') },
    notes: ['Geographic proximity is not an electrical relationship; a station that clears the request is not a connection (see Grid).', 'The governing figure is the element study (fact_limiting_element) where held, else the vendor envelope (fact_headroom); an envelope-only case is Envelope only (Hold) and never counts as clear or as a fail (D6.1).', 'Storage and hybrid charge in the shoulder case only (Grid applicableCases); summer-peak withdrawal is read for a data centre only.'],
    csv: { name: 'land-alternative-stations.csv', columns: ['station', 'kv', 'buses', 'miles', 'hr_inj_summer_peak_mw', 'hr_inj_shoulder_mw', 'hr_charge_shoulder_mw', 'hr_wd_summer_peak_mw', 'hr_wd_large_load_mw', 'request_mw', 'governing_mw', 'binding_case', 'verdict', 'mw_per_mile', 'screened'], rows: groups.map(g => [g.name, g.kv, g.buses, g.d, g.hr_sp_dis, g.hr_sh_dis, g.hr_sh_chg, g.hr_sp_chg, g.hr_ll_chg, mw, g.hr, g.v?.binding ?? g.t?.binding ?? null, g.v?.status ?? g.clears, g.pm, g.screened ? 'yes' : 'no']) },
  });
}

/** Line cost sensitivity. */
export function traceLineGrid(miles, basisLabel, grid, factors) {
  const row = grid.find(r => ok(r.perMile));
  if (!ok(miles) || !row) return trace({ id: 'l-linegrid', title: 'Line cost sensitivity', formula: 'Line cost = straight-line miles × routing factor × $/mile', inputs: [], steps: [], result: { label: 'Line cost', value: 'not held' }, notes: [`No check possible: ${!ok(miles) ? 'no distance is held (place the site, or no alternative station is within 15 mi)' : 'no $/mile level'}.`] });
  const i1 = factors.indexOf(1), iL = factors.length - 1;
  return trace({
    id: 'l-linegrid', title: 'Line cost sensitivity ($/mile × routing factor)',
    formula: 'Line cost = straight-line miles × routing factor × $/mile  (line only: terminal works and crossings excluded)',
    inputs: [{ name: 'Distance', value: `${miles.toFixed(2)} mi`, source: 'derived', note: basisLabel }, ...grid.map(r => ({ name: `$/mile level`, value: ok(r.perMile) ? `$${(r.perMile / 1e6).toFixed(2)}M/mi` : 'not entered', source: r.source || 'assumption', note: r.note || '' }))],
    steps: factors.map((f, j) => ({ label: `Factor ${f.toFixed(2)} at $${(row.perMile / 1e6).toFixed(2)}M/mi`, work: `${miles.toFixed(2)} × ${f.toFixed(2)} × $${(row.perMile / 1e6).toFixed(2)}M`, value: usd(row.cells[j]) })),
    result: { label: `Factor ${factors[iL].toFixed(2)}, $${(row.perMile / 1e6).toFixed(2)}M/mi`, value: usd(row.cells[iL]) },
    check: miles > 0 ? { label: `Arithmetic re-check: the factor-${factors[iL]} cell ÷ the straight-line cell = ${factors[iL]}`, a: i1 >= 0 ? row.cells[iL] / row.cells[i1] : null, b: factors[iL], tol: 1e-9, fmt: v => (ok(v) ? v.toFixed(4) : 'not held') } : undefined,
    notes: [...(miles > 0 ? [] : ['No check possible: the distance is 0 mi (a differently named station shares this coordinate), so every line cell is $0 of line; terminal works still apply.']), 'No $/mile benchmark is held in the vault or the database: the Studio slider range ($1M–$4M per mile) is shown as an assumption, and only your entry prices the KPI.', 'A routing factor below 1 would make the route shorter than the straight line and is not held.'],
    csv: { name: 'land-line-cost-grid.csv', columns: ['per_mile_usd', ...factors.map(f => `factor_${f}`)], rows: grid.map(r => [r.perMile, ...r.cells]) },
  });
}

/** Station strength: short-circuit percentile, Studio copy comparison. */
export function traceStrength(sub, rank, pct, studioSc) {
  if (!sub || !ok(sub.short_circuit_mva)) return trace({ id: 'l-strength', title: 'Station strength', formula: 'Percentile = buses at or below this short-circuit MVA ÷ buses that publish one', inputs: [], steps: [], result: { label: 'Short-circuit MVA', value: 'not held' }, notes: ['No check possible: the unified DB holds no short-circuit figure for this bus.'] });
  return trace({
    id: 'l-strength', title: 'Station strength (short-circuit MVA)',
    formula: 'Percentile = 100 × buses with short-circuit MVA ≤ this bus ÷ buses publishing one;  unified short_circuit_mva = published × 100 (the published column is 100× too small)',
    inputs: [{ name: 'Short-circuit MVA', value: fmt.int(sub.short_circuit_mva), source: 'measured', note: `unified dim_substation (published ${sub.short_circuit_mva_published ?? 'not held'})` }, { name: 'Rank', value: `${rank.below_or_equal} of ${rank.of}`, source: 'derived' }, { name: 'Studio copy figure ×100', value: ok(studioSc) ? fmt.int(studioSc * 100) : 'not held', source: 'measured', note: 'vendor/Studio copy (older database), data.js sc_mva' }],
    steps: [{ label: 'Percentile', work: `100 × ${rank.below_or_equal} ÷ ${rank.of}`, value: pc(pct) }, { label: 'Published × 100', work: `${sub.short_circuit_mva_published} × 100`, value: ok(sub.short_circuit_mva_published) ? fmt.int(sub.short_circuit_mva_published * 100) : 'not held' }],
    result: { label: 'Percentile among 2,648 publishing buses', value: pc(pct) },
    checks: [{ label: 'Independent: Studio copy (older DB) × 100 = unified figure (within 0.5%)', a: ok(studioSc) ? studioSc * 100 : null, b: sub.short_circuit_mva, tol: 0.005, fmt: v => (ok(v) ? fmt.int(v) : 'not held') },
      { label: 'Arithmetic re-check: published × 100 = unified figure (within 0.1%)', a: ok(sub.short_circuit_mva_published) ? sub.short_circuit_mva_published * 100 : null, b: sub.short_circuit_mva, tol: 0.001, fmt: v => (ok(v) ? fmt.int(v) : 'not held') }],
    notes: ['A higher short-circuit MVA is a stiffer point of connection for inverter-based plant; it is not a hosting limit.'],
    csv: { name: 'land-station-strength.csv', columns: ['short_circuit_mva', 'published', 'rank', 'of', 'percentile', 'studio_x100'], rows: [[sub.short_circuit_mva, sub.short_circuit_mva_published, rank.below_or_equal, rank.of, pct, ok(studioSc) ? studioSc * 100 : null]] },
  });
}

/** Permit checklist summary. */
export function tracePermits(sum, permits, st, defs = []) {
  const tot = sum.unknown + sum['not needed'] + sum['in progress'] + sum.done;
  const own = st.filter(v => v === 'done').length;
  return trace({
    id: 'l-permits', title: 'Permit checklist status',
    formula: 'Checklist = the common items + the fuel\'s own items (landcore.permitList);  count by your status entry;  anything not entered is unknown (never done)',
    inputs: permits.map((p, i) => ({ name: p, value: st?.[i] || 'unknown', source: 'user', note: defs[i] ? `${defs[i].group === 'common' ? 'every project' : defs[i].group} · general knowledge, not a legal determination` : '' })),
    steps: ['done', 'in progress', 'not needed', 'unknown'].map(k => ({ label: k, work: 'count', value: String(sum[k]) })),
    result: { label: 'Confirmed', value: `${sum.done} of ${sum.total}` },
    checks: [{ label: 'Consistency check: status counts sum to the number of permits', a: tot, b: sum.total, atol: 0, fmt: v => String(v) },
      { label: 'Arithmetic re-check: "done" recounted from the entries', a: own, b: sum.done, atol: 0, fmt: v => String(v) }],
    notes: ['A starting checklist from general knowledge of US siting practice, not a legal determination: applicable permits depend on the state, the town and the site.'],
    csv: { name: 'land-permits.csv', columns: ['permit', 'applies_to', 'status', 'why'], rows: permits.map((p, i) => [p, defs[i]?.group ?? null, st?.[i] || 'unknown', defs[i]?.why ?? null]) },
  });
}

/** Site control against the interconnection rule in force (rules/isone.js siteControlGate; S3 Lead wiring 3, W-B). */
export function traceSiteControl(tech, pct, scn) {
  const req = ok(scn?.required) ? `${scn.required}%` : 'not held', prof = scn?.profile?.label || 'profile not held';
  return trace({
    id: 'l-sitecontrol', title: `Site control vs the ${prof} threshold`,
    formula: `${prof}: ≥ ${req} of the site documented under control at the interconnection request; NRIS may post the deposit in lieu where a regulatory limitation applies. A data centre is a load: not applicable. Not entered → Open (unknown never passes).`,
    inputs: [{ name: 'Technology', value: tech, source: 'user' }, { name: 'Site control documented', value: ok(pct) ? `${pct}%` : 'not entered', source: 'user' }, { name: 'Threshold at request', value: req, source: 'rule', note: scn?.cite?.text || 'rules file not loaded' }],
    steps: [{ label: 'Verdict', work: !scn.applicable ? 'load: generator site-control rule does not apply' : ok(pct) ? `${pct}% vs ${req}${scn.via === 'deposit in lieu' ? ' (deposit in lieu available)' : ''}` : 'not entered', value: scn.status }],
    result: { label: 'Site control', value: !scn.applicable ? 'not applicable' : ok(pct) ? `${pct}%` : 'not held' },
    notes: ['No check possible: the percentage is your entry and the threshold is a tariff rule; nothing independent is held (no parcel or title data).'],
  });
}

/** Permit timeline. */
export function traceTimeline(tasks, rows, start) {
  if (!tasks) return trace({ id: 'l-timeline', title: 'Permit timeline', formula: 'Start = project start + offset months;  end = start + duration months', inputs: [{ name: 'Project start', value: 'not entered', source: 'user' }], steps: [], result: { label: 'Timeline', value: 'not held' }, notes: ['No check possible: enter a start month and at least one permit offset.'] });
  const monthsBetween = (a, b) => { const x = new Date(a), y = new Date(b); return (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + y.getUTCMonth() - x.getUTCMonth(); };
  const placed = tasks.filter(t => t.end != null), dev = placed.map(t => Math.abs(monthsBetween(t.start, t.end) - rows.find(r => r.label === t.label).dur));
  const last = placed.length ? Math.max(...placed.map(t => t.end)) : null;
  const ym = ms => new Date(ms).toISOString().slice(0, 7);
  return trace({
    id: 'l-timeline', title: 'Permit timeline',
    formula: 'Start_i = project start + offset_i months;  end_i = start_i + duration_i months;  a blank duration is open-ended',
    inputs: [{ name: 'Project start', value: start, source: 'user' }, ...rows.map(r => ({ name: r.label, value: `offset ${ok(r.offset) ? r.offset : '—'} mo · duration ${ok(r.dur) ? r.dur : '—'} mo`, source: 'user' }))],
    steps: tasks.map(t => ({ label: t.label, work: `${ym(t.start)} + ${rows.find(r => r.label === t.label).dur ?? '—'} mo`, value: t.end != null ? ym(t.end) : 'open-ended' })),
    result: { label: 'Last dated permit ends', value: last != null ? ym(last) : 'not held' },
    check: placed.length ? { label: 'Arithmetic re-check: every bar spans exactly its duration in months', a: Math.max(...dev), b: 0, atol: 0, fmt: v => `${v} mo` } : undefined,
    notes: placed.length ? ['Durations are your estimates; nothing here is an agency schedule.'] : ['No check possible: no permit has both an offset and a duration.'],
    csv: { name: 'land-permit-timeline.csv', columns: ['permit', 'start', 'end'], rows: tasks.map(t => [t.label, ym(t.start), t.end != null ? ym(t.end) : null]) },
  });
}
