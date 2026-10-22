// Queue v6: "Requests around the bus" on the shared geoMap (live basemap). Pure: inputs in, geoMap layers + legend out.
// Solved-case requests are coloured by study status (s1–s5, rulebook order); the public register uses one more hue
// for active records and neutral greys for withdrawn / in service; operating model units are small grey dots.
// A record without a coordinate is counted as not placed, never drawn.
const ok = v => typeof v === 'number' && Number.isFinite(v);
const RAD = Math.PI / 180;
const mi = (lat1, lon1, lat2, lon2) => 69.0 * Math.hypot((lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * RAD), lat2 - lat1);

export const REG_FILL = { W: '#5a6b85', C: 'var(--ink-3)', A: 'var(--s6)' };
export const REG_LABEL = { W: 'withdrawn', C: 'in service', A: 'active' };
const GEN_FILL = 'var(--border-3)';

/**
 * opts: { node, study, register, generators, R, statuses, stLabel, tips:{study, register, gen} }.
 * generators rows are [bus_id, name, status, mw, lat, lon] (api_queue study payload).
 */
export function queueMapSpec({ node, study = [], register = [], generators = [], R = 10, statuses = [], stLabel = s => s, tips = {} }) {
  const lat0 = node?.latitude, lon0 = node?.longitude, held = ok(lat0) && ok(lon0);
  const within = (lat, lon) => held && ok(lat) && ok(lon) && mi(lat0, lon0, lat, lon) <= R;
  const placed = q => ok(q.latitude) && ok(q.longitude);
  const layers = [{ kind: 'rings', center: [lon0, lat0], miles: [...new Set([5, 10, 25, R])].sort((a, b) => a - b) }];
  const items = [];
  // Operating units first (underneath), then the register, then the solved-case set on top.
  const gens = generators.filter(g => g[2] === 'Operating' && ok(g[4]) && ok(g[5]));
  layers.push({ kind: 'points', points: gens.map(g => ({ lon: g[5], lat: g[4], r: 1.6, cls: 'q-gen', fill: GEN_FILL, tip: tips.gen ? tips.gen(g) : String(g[1]) })) });
  items.push({ label: `Operating model units (${gens.filter(g => within(g[4], g[5])).length} within ${R} mi)`, fill: GEN_FILL });
  for (const k of ['W', 'C', 'A']) {
    const rs = register.filter(r => r.status === k && ok(r.lat) && ok(r.lon));
    layers.push({ kind: 'points', points: rs.map(r => ({ lon: r.lon, lat: r.lat, r: 2.4, cls: `q-reg-${k}`, fill: REG_FILL[k], tip: tips.register ? tips.register(r) : `QP ${r.qp}` })) });
    items.push({ label: `Register: ${REG_LABEL[k]} (${rs.filter(r => within(r.lat, r.lon)).length} within ${R} mi)`, fill: REG_FILL[k] });
  }
  statuses.forEach((s, i) => {
    const qs = study.filter(q => q.status === s && placed(q));
    if (!study.some(q => q.status === s)) return;
    layers.push({ kind: 'points', points: qs.map(q => ({ lon: q.longitude, lat: q.latitude, r: Math.min(9, 3 + Math.sqrt(q.max_mw || 1) * 0.35), cls: `q-st-${i + 1}`, fill: `var(--s${i + 1})`, tip: tips.study ? tips.study(q) : `Q${q.queue_position}` })) });
    items.push({ label: `Solved case: ${stLabel(s)} (${qs.filter(q => within(q.latitude, q.longitude)).length} within ${R} mi)`, fill: `var(--s${i + 1})` });
  });
  items.push({ label: 'Candidate bus', fill: 'var(--ink)' });
  layers.push({ kind: 'points', points: held ? [{ lon: lon0, lat: lat0, r: 6.5, cls: 'gm-sel', fill: 'var(--ink)', label: node?.name || 'bus', tip: `${node?.name || 'bus'} · candidate bus` }] : [] });
  return { layers, legend: { items }, padMi: Math.max(27, R * 1.08), center: held ? { lon: lon0, lat: lat0 } : null,
    notPlaced: { study: study.filter(q => !placed(q)).length, register: register.filter(r => !(ok(r.lat) && ok(r.lon))).length } };
}
