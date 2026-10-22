// Prices-only special graph: the ISO-wide price map on the shared basemap (geomap.js, V6). Every geolocated bus is
// coloured by its annual mean price on the single-hue ramp (P2–P98 of held buses, so one extreme node cannot flatten
// the scale); a bus without a price is the not-held grey; the candidate is ringed and labelled. Clicking a bus makes
// it the candidate (data-act="node"). Zoom, pan and hover come from the shell's map mounting.
import { geoMap, rampColor } from '../geomap.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** P2 and P98 of the held values (the colour range). */
export function mapRange(values) {
  const v = values.filter(ok).sort((a, b) => a - b);
  if (!v.length) return { lo: null, hi: null };
  const q = p => { const i = (v.length - 1) * p, l = Math.floor(i); return v[l] + (v[Math.ceil(i)] - v[l]) * (i - l); };
  return { lo: q(0.02), hi: q(0.98) };
}

/** points [{id, lat, lon, value, name}] → map; opts {highlight, fmt, height, title}. */
export function priceMap(points, opts = {}) {
  const P = points.filter(p => ok(p.lat) && ok(p.lon));
  if (!P.length) return '<div class="empty"><strong>Nothing to map</strong>No geolocated buses are held.</div>';
  const fmt = opts.fmt || (v => v.toFixed(2)), { lo, hi } = mapRange(P.map(p => p.value));
  const tip = p => `<b>${esc(p.name)}</b> · ${esc(p.id)}<br>${ok(p.value) ? `${esc(fmt(p.value))}/MWh` : 'not held'}`;
  const pt = (p, r, cls = '') => ({ lon: p.lon, lat: p.lat, r, cls, fill: cls ? null : ok(p.value) && ok(lo) ? rampColor(p.value, lo, hi) : 'var(--gm-nh)', tip: tip(p), act: 'node', v: p.id });
  const nh = P.filter(p => !ok(p.value)), held = P.filter(p => ok(p.value)).sort((a, b) => a.value - b.value);
  const me = P.filter(p => String(p.id) === String(opts.highlight));
  return geoMap({
    id: 'prices', width: 900, height: opts.height || 430, title: opts.title || 'Price map',
    fit: { points: P.map(p => ({ lon: p.lon, lat: p.lat })), padMi: 8 },
    layers: [{ kind: 'points', points: [...nh.map(p => pt(p, 2.4)), ...held.map(p => pt(p, 3))] },
      { kind: 'points', points: me.map(p => ({ ...pt(p, 8, 'm-hl'), label: `${p.name} (candidate)${ok(p.value) ? ` ${fmt(p.value)}` : ''}` })) }],
    legend: ok(lo) ? { ramp: { lo, hi, fmt, label: `${opts.title || 'Mean price'} ($/MWh, P2–P98)` }, nh: nh.length > 0 } : { items: [{ label: 'not held', fill: 'var(--gm-nh)' }] },
  });
}
