// How the market model runs storage (pure, tested in tests/economics-esr.test.mjs). Input = api_economicsesr esr/<bus>:
// per resource and PCR run, the dispatch aggregates (discharge positive, checked at extraction). Null = not held.
import { milesBetween } from '../geomap.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
export const ESR_RUNS = ['pcr2030', 'pcr2035', 'pcr2040'];
export const ESR_RUN_LABEL = { pcr2030: 'PCR 2030', pcr2035: 'PCR 2035', pcr2040: 'PCR 2040 (12% gas)' };

/** Derived figures for one resource-run: cycles/day, net $/MWh discharged, SOC use, share of the gross spread ceiling. */
export function esrMetrics(r, u) {
  const mwh = ok(u?.esr_max_storage_mwh) && u.esr_max_storage_mwh > 0 ? u.esr_max_storage_mwh : ok(r.soc_cap) && r.soc_cap > 0 ? r.soc_cap : null;
  const dis = ok(r.dis_mwh) ? r.dis_mwh : 0, ch = ok(r.ch_mwh) ? r.ch_mwh : 0;
  const cap = ok(r.soc_cap) && r.soc_cap > 0 ? r.soc_cap : mwh;
  return {
    mw: u?.econ_max_mw ?? null, mwh, k: r.k ?? null, days: r.days ?? null, hours: r.hours ?? null,
    dis, ch, net: ok(r.net) ? r.net : null, revDis: r.rev_dis ?? null, costCh: r.cost_ch ?? null,
    cyclesPerDay: mwh && ok(r.days) && r.days > 0 ? dis / mwh / r.days : null,
    netPerMWh: dis > 0 && ok(r.net) ? r.net / dis : null,
    socUse: cap && ok(r.swing_mean) ? r.swing_mean / cap : null,
    fullShare: ok(r.hours) && r.hours ? r.h_full / r.hours : null, emptyShare: ok(r.hours) && r.hours ? r.h_empty / r.hours : null,
    ceiling: ok(r.ceiling) && r.ceiling > 0 ? r.ceiling : null,
    ofCeiling: ok(r.ceiling) && r.ceiling > 0 && dis > 0 && ok(r.net) ? r.net / r.ceiling : null,
    chargeEff: ch > 0 && ok(r.soc_first) && ok(r.soc_last) ? (dis + (r.soc_last - r.soc_first)) / ch : null,
    netDaySum: r.net_daysum ?? null, tbMean: r.tb_mean ?? null,
  };
}

/** Resources modelled in `run` within radiusMi of the bus, or in the bus's zone; nearest first (no location → last). */
export function esrNearby(data, { run, radiusMi }) {
  const bus = data?.bus || {}, byId = new Map((data?.resources || []).map(u => [String(u.bidder_index), u]));
  const here = ok(bus.lat) && ok(bus.lon) ? [bus.lon, bus.lat] : null;
  const out = [];
  for (const r of (data?.runs || []).filter(x => x.scenario === run)) {
    const u = byId.get(String(r.bidder_index)); if (!u) continue;
    const mi = here && ok(u.lat) && ok(u.lon) ? milesBetween(here, [u.lon, u.lat]) : null;
    const near = ok(mi) && mi <= radiusMi, same = bus.zone && u.zone === bus.zone;
    if (!near && !same) continue;
    out.push({ id: String(u.bidder_index), name: u.resource_name, zone: u.zone, kind: u.unit_type, lat: u.lat, lon: u.lon, mi,
      why: near ? `within ${radiusMi} mi` : ok(mi) ? `same zone (${mi.toFixed(0)} mi)` : 'same zone (location not held)', ...esrMetrics(r, u) });
  }
  return out.sort((a, b) => (ok(a.mi) ? a.mi : 1e9) - (ok(b.mi) ? b.mi : 1e9) || a.name.localeCompare(b.name));
}

/** Modelled storage per zone and run: {zone, run, mw, mwh, n}. */
export function zoneSaturation(data) {
  const byId = new Map((data?.resources || []).map(u => [String(u.bidder_index), u])), acc = new Map();
  for (const r of data?.runs || []) {
    const u = byId.get(String(r.bidder_index)); if (!u) continue;
    const k = `${u.zone}|${r.scenario}`;
    if (!acc.has(k)) acc.set(k, { zone: u.zone, run: r.scenario, mw: 0, mwh: 0, n: 0 });
    const a = acc.get(k); a.mw += ok(u.econ_max_mw) ? u.econ_max_mw : 0; a.mwh += ok(u.esr_max_storage_mwh) ? u.esr_max_storage_mwh : 0; a.n++;
  }
  return [...acc.values()].sort((a, b) => a.zone.localeCompare(b.zone) || a.run.localeCompare(b.run));
}
