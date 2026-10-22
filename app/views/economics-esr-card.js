// Economics › Storage revenue: "How the market model runs storage" (V6). The batteries and pumped-storage units the
// PCR 2030 / 2035 / 2040 runs dispatch (unified fact_pcr_esr × dim_pcr_resource via api_economicsesr.py), near this bus
// or in its zone, set against our perfect-foresight dispatch on the basis prices. Pure maths in economics-esr.js (tested).
import { get as getData, waitText } from './economics-data.js';
import { esrNearby, zoneSaturation, ESR_RUNS, ESR_RUN_LABEL } from './economics-esr.js';
import { barChart, groupedBar } from '../charts.js';
import { geoMap } from '../geomap.js';
import { trace } from '../trace.js';
import { fmt } from '../basis.js';
import { table, card, B } from './economics-charts.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = v => (ok(v) ? `${(100 * v).toFixed(1)}%` : null);
const RADII = [10, 25, 50];
const sel = (k, cur, opts, label) => `<select data-act="ui" data-k="${k}" aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const median = a => { const v = a.filter(ok).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null; };

/** {cards:[…], trace} for the Storage revenue tab. ours = {share: our dispatch ÷ our ceiling, dispatch, ceiling, label}. */
export function esrCards(ctx, ours) {
  const { S, node } = ctx, e = getData('esr', S.nodeId, 'economicsesr');
  const run = ESR_RUNS.includes(S.ui.esrRun) ? S.ui.esrRun : 'pcr2030', radius = RADII.includes(Number(S.ui.esrMi)) ? Number(S.ui.esrMi) : 25;
  const tools = `${sel('esrRun', run, ESR_RUNS.map(r => [r, ESR_RUN_LABEL[r]]), 'PCR run')}${sel('esrMi', radius, RADII.map(r => [r, `within ${r} mi`]), 'Radius')}`;
  if (e.state !== 'ok') {
    return { cards: [card(12, 'How the market model runs storage', 'PCR 2030 / 2035 / 2040 modelled storage near this bus', `<div class="empty"><strong>${esc(waitText(e, 'the modelled storage dispatch'))}</strong>Read once from fact_pcr_esr; cached after that.</div>`, { depth: 'review', chips: 'modelled', tools })], trace: '' };
  }
  const d = e.data, zone = d.bus.zone, units = esrNearby(d, { run, radiusMi: radius });
  const disp = units.filter(u => u.dis > 0);
  const totDis = disp.reduce((t, u) => t + u.dis, 0), totNet = disp.reduce((t, u) => t + (u.net ?? 0), 0), totCeil = disp.reduce((t, u) => t + (u.ceiling ?? 0), 0);
  const share = totCeil > 0 ? totNet / totCeil : null, perMWh = totDis > 0 ? totNet / totDis : null, cyc = median(units.map(u => u.cyclesPerDay));
  const where = `within ${radius} mi of this bus${zone ? ` or in ${esc(zone)}` : ''}`;
  const a1 = units.length
    ? `The ${esc(ESR_RUN_LABEL[run])} run's ${B(fmt.int(units.length))} storage units ${where} cycle a median ${B(ok(cyc) ? cyc.toFixed(2) : 'not held')}/day and keep ${B(pct(share) ?? 'not held')} of their gross spread ceiling (${B(ok(perMWh) ? `$${perMWh.toFixed(2)}` : 'not held')} net per MWh discharged)${ok(ours?.share) ? `; our perfect-foresight dispatch here keeps ${B(pct(ours.share))}` : ''}.`
    : `The ${esc(ESR_RUN_LABEL[run])} run models no storage ${where}.`;
  const items = [...units.map(u => ({ label: u.name.length > 22 ? `${u.name.slice(0, 21)}…` : u.name, value: ok(u.ofCeiling) ? 100 * u.ofCeiling : null, note: `${u.zone} · ${ok(u.mi) ? `${u.mi.toFixed(0)} mi` : 'location not held'} · ${fmt.int(u.mw)} MW / ${fmt.int(u.mwh)} MWh · ${ok(u.cyclesPerDay) ? u.cyclesPerDay.toFixed(2) : '—'} cycles/day` })),
    ...(ok(ours?.share) ? [{ label: 'This project (our dispatch)', value: 100 * ours.share, note: `${ours.label} · perfect foresight on the basis prices` }] : [])];
  const chart = barChart(items, { fmt: v => `${v.toFixed(1)}%`, title: 'Share of the gross spread ceiling kept', height: 200, emptyText: 'No modelled storage unit here.' });
  const tbl = table([
    { k: 'name', l: 'Unit' }, { k: 'zone', l: 'Zone' }, { k: 'mi', l: 'Miles', num: true, f: v => (ok(v) ? v.toFixed(1) : null) },
    { k: 'mw', l: 'MW', num: true, f: v => (ok(v) ? fmt.int(v) : null) }, { k: 'mwh', l: 'MWh', num: true, f: v => (ok(v) ? fmt.int(v) : null) },
    { k: 'cyclesPerDay', l: 'Cycles/day', num: true, f: v => (ok(v) ? v.toFixed(3) : null) },
    { k: 'netPerMWh', l: 'Net $/MWh out', num: true, f: v => (ok(v) ? `$${v.toFixed(2)}` : null) },
    { k: 'socUse', l: 'Daily SOC swing', num: true, f: pct }, { k: 'fullShare', l: 'Hours full', num: true, f: pct }, { k: 'emptyShare', l: 'Hours empty', num: true, f: pct },
    { k: 'net', l: 'Net $/yr', num: true, f: v => (ok(v) ? fmt.money(v) : null) }, { k: 'ofCeiling', l: 'Of ceiling', num: true, f: pct }, { k: 'why', l: 'Included', wrap: true },
  ], units, { empty: 'No modelled storage unit near this bus or in its zone in this run.' });
  const c1 = card(8, 'How the market model runs storage', `${ESR_RUN_LABEL[run]} · modelled units ${where} · discharge positive, checked`, `${chart}${tbl}`,
    { depth: 'review', trace: 'e-esr', chips: 'modelled', tools, answer: a1, foot: `${esc(d.source)} · ceiling = Σ days (k dearest − k cheapest hourly LMP) × MWh at each unit's own k = MWh ÷ MW, the same gross definition as the arbitrage ceiling above · the run's dispatch also serves reserves and system balance, so a low share is how the model runs storage, not a forecast of merchant revenue` });

  // Map: the bus, rings and the located units.
  const here = ok(node?.longitude) && ok(node?.latitude) ? { lon: node.longitude, lat: node.latitude } : ok(d.bus.lon) ? { lon: d.bus.lon, lat: d.bus.lat } : null;
  const located = units.filter(u => ok(u.lon) && ok(u.lat)), noLoc = units.length - located.length;
  const map = here ? geoMap({ id: 'esr', width: 520, height: 300, title: 'Modelled storage near the bus', fit: { points: [here, ...located.map(u => ({ lon: u.lon, lat: u.lat }))], padMi: 6 },
    layers: [{ kind: 'rings', center: [here.lon, here.lat], miles: RADII.filter(r => r <= radius) },
      { kind: 'points', points: located.map(u => ({ lon: u.lon, lat: u.lat, r: Math.max(3, Math.min(9, Math.sqrt(u.mw || 1) / 2)), tip: `<b>${esc(u.name)}</b><br>${fmt.int(u.mw)} MW / ${fmt.int(u.mwh)} MWh · ${esc(u.zone)}<br>${ok(u.cyclesPerDay) ? u.cyclesPerDay.toFixed(2) : '—'} cycles/day · ${pct(u.ofCeiling) ?? 'not held'} of ceiling` })) },
      { kind: 'points', points: [{ ...here, r: 7, cls: 'm-hl', label: 'This bus' }] }],
    legend: { items: [{ label: 'Modelled storage unit (size = MW)', fill: 'var(--s1)' }, { label: 'This bus (ring)', fill: 'var(--s2)' }] } }) : '<div class="empty"><strong>Not held</strong>This bus has no location.</div>';
  const a2 = `${B(fmt.int(located.length))} of the ${fmt.int(units.length)} units have a location in the run's resource table${noLoc ? `; ${B(fmt.int(noLoc))} are counted by zone only` : ''}.`;
  const c2 = card(4, 'Where the modelled storage sits', `${ESR_RUN_LABEL[run]} · rings at ${RADII.filter(r => r <= radius).join(', ')} mi`, map, { depth: 'review', chips: 'modelled', answer: a2, foot: 'Latitude/longitude 0 in dim_pcr_resource = not held, so those units are not drawn.' });

  // Saturation: modelled storage MW per zone by run.
  const sat = zoneSaturation(d), zones = [...new Set(sat.map(r => r.zone))].sort((a, b) => (a === 'Multiple') - (b === 'Multiple') || a.localeCompare(b));
  const at = (z, r) => sat.find(x => x.zone === z && x.run === r)?.mw ?? null;
  const satChart = groupedBar(zones.map(z => ({ label: z === 'Multiple' ? 'ISO-wide' : z, values: ESR_RUNS.map(r => at(z, r)) })), { series: ESR_RUNS.map(r => ESR_RUN_LABEL[r]), fmt: v => fmt.int(v), title: 'Modelled storage MW by zone and run', height: 200 });
  const tot = r => sat.filter(x => x.run === r).reduce((t, x) => t + x.mw, 0);
  const a3 = zone && zones.includes(zone) ? `PCR models ${B(`${fmt.int(at(zone, 'pcr2030') ?? 0)} MW`)} of storage in ${esc(zone)} in 2030 and ${B(`${fmt.int(at(zone, 'pcr2040') ?? 0)} MW`)} in 2040; ISO-wide ${B(`${fmt.int(tot('pcr2030'))} MW`)} → ${B(`${fmt.int(tot('pcr2040'))} MW`)}.`
    : `PCR models ${zone ? `no storage in ${esc(zone)}` : 'storage in no zone named for this bus'}; ISO-wide ${B(`${fmt.int(tot('pcr2030'))} MW`)} in 2030 → ${B(`${fmt.int(tot('pcr2040'))} MW`)} in 2040.`;
  const c3 = card(12, 'Market saturation: modelled storage by zone', 'MW of batteries and pumped storage each PCR run dispatches · competition for the same spreads', satChart,
    { depth: 'review', chips: 'modelled', answer: a3, foot: `${esc(d.source)} · "ISO-wide" = the run's Future_Storage placeholders with zone "Multiple" · pumped storage (Northfield, Bear Swamp, Rocky River) is included because it competes for the same spreads` });

  // Trace.
  const t = trace({
    id: 'e-esr', title: `Modelled storage ${where} (${ESR_RUN_LABEL[run]})`,
    formula: 'share kept = Σ_units Σ_h dispatch_h × LMP_h ÷ Σ_units Σ_days (mean of k dearest − k cheapest LMP) × MWh · cycles/day = MWh discharged ÷ MWh capacity ÷ days',
    inputs: [
      { name: 'Run', value: ESR_RUN_LABEL[run], source: 'user' }, { name: 'Radius', value: radius, unit: 'mi', source: 'user', note: `plus every unit in ${zone || 'the bus zone (not held)'}` },
      { name: 'Units included', value: units.length, source: 'measured', note: 'fact_pcr_esr × dim_pcr_resource' },
      { name: 'Sign convention', value: 'discharge > 0', source: 'rule', note: 'checked: SOC falls 1:1 with discharge in every run' },
      ...(ok(ours?.share) ? [{ name: 'Our dispatch ÷ our ceiling', value: pct(ours.share), source: 'derived', note: ours.label }] : []),
    ],
    steps: [
      { label: 'MWh discharged (units that discharge)', work: disp.map(u => `${u.name} ${fmt.int(u.dis)}`).join(' + ') || '—', value: fmt.int(totDis) },
      { label: 'Net revenue Σ dispatch × LMP', work: disp.map(u => fmt.money(u.net)).join(' + ') || '—', value: fmt.money(totNet) },
      { label: 'Gross spread ceiling', work: disp.map(u => fmt.money(u.ceiling)).join(' + ') || '—', value: fmt.money(totCeil) },
      { label: 'Share kept', work: `${fmt.money(totNet)} ÷ ${fmt.money(totCeil)}`, value: pct(share) ?? 'not held' },
      { label: 'Net per MWh discharged', work: `${fmt.money(totNet)} ÷ ${fmt.int(totDis)} MWh`, value: ok(perMWh) ? `$${perMWh.toFixed(2)}` : 'not held' },
      { label: 'Median cycles per day', work: units.map(u => (ok(u.cyclesPerDay) ? u.cyclesPerDay.toFixed(3) : '—')).join(', ') || '—', value: ok(cyc) ? cyc.toFixed(3) : 'not held' },
    ],
    result: { label: 'Share of the ceiling kept', value: pct(share) ?? 'not held' },
    checks: [
      { label: 'Consistency check: net revenue summed by hour vs summed day by day (two SQL paths)', a: units.reduce((t, u) => t + (u.net ?? 0), 0), b: units.reduce((t, u) => t + (u.netDaySum ?? 0), 0), atol: 1, fmt: v => fmt.money(v) },
      { label: 'Consistency check: units whose SOC balance implies a charging efficiency in (0, 1] (energy is not created)', a: units.filter(u => ok(u.chargeEff) && u.chargeEff > 0 && u.chargeEff <= 1.001).length, b: units.filter(u => ok(u.chargeEff)).length, atol: 0, fmt: v => String(v) },
    ],
    notes: ['The PROBE congestion-sign trap does not apply: only the total LMP is used, and it equals fact_fcst_lmp_hourly at the mapped bus.', 'The run optimises the whole system (reserves, balance), not each unit\'s arbitrage, so its share kept is a reality check on a perfect-foresight ceiling, not a revenue forecast.'],
    csv: { name: `pcr-storage-${run}-${S.nodeId}.csv`, columns: ['unit', 'zone', 'miles', 'mw', 'mwh', 'k_hours', 'days', 'mwh_discharged', 'mwh_charged', 'net_usd', 'ceiling_usd', 'share_kept', 'cycles_per_day', 'soc_swing_share', 'implied_charge_eff'],
      rows: units.map(u => [u.name, u.zone, u.mi, u.mw, u.mwh, u.k, u.days, u.dis, u.ch, u.net, u.ceiling, u.ofCeiling, u.cyclesPerDay, u.socUse, u.chargeEff]) },
  });
  return { cards: [c1, c2, c3], trace: t };
}
