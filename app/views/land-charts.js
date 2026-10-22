// Land-only SVG graphics (no toggle needed: each sits next to a table of the same numbers):
// the disc ring diagram, a semicircle gauge, and the local site map with nearby stations.
import { geoMap } from '../geomap.js';
import { siteMapFrame } from '../landcore.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const acres = v => `${Math.round(v).toLocaleString('en-US')} ac`;

/** Donut: segments [{label, value, color}] around a centre caption. Nulls are skipped, never drawn as zero. */
export function ringDiagram(segments, { centre = '', sub = '', size = 190 } = {}) {
  const seg = segments.filter(s => ok(s.value) && s.value > 0), tot = seg.reduce((a, s) => a + s.value, 0);
  if (!tot) return '';
  const R = size / 2 - 6, r = R - 26, cx = size / 2, cy = size / 2;
  let a0 = -Math.PI / 2;
  const arcs = seg.map(s => {
    const a1 = a0 + (2 * Math.PI * s.value) / tot, big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    const full = a1 - a0 >= 2 * Math.PI - 1e-9;
    const d = full ? `M ${p(R, a0)} A ${R} ${R} 0 1 1 ${p(R, a0 + Math.PI)} A ${R} ${R} 0 1 1 ${p(R, a0)} M ${p(r, a0)} A ${r} ${r} 0 1 0 ${p(r, a0 + Math.PI)} A ${r} ${r} 0 1 0 ${p(r, a0)} Z`
      : `M ${p(R, a0)} A ${R} ${R} 0 ${big} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${big} 0 ${p(r, a0)} Z`;
    a0 = a1;
    return `<path d="${d}" fill="${s.color}" fill-rule="evenodd"><title>${esc(s.label)}: ${acres(s.value)} (${((100 * s.value) / tot).toFixed(1)}%)</title></path>`;
  }).join('');
  const legend = seg.map(s => `<li><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${acres(s.value)}</b><em>${((100 * s.value) / tot).toFixed(1)}%</em></li>`).join('');
  return `<div class="land-ring"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(centre)}">${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="15" font-weight="650" fill="var(--ink)">${esc(centre)}</text>
    <text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="10.5" fill="var(--ink-3)">${esc(sub)}</text></svg>
    <ul class="land-legend">${legend}</ul></div>`;
}

/** Semicircle gauge 0..max with marks [{v, label}]; value null → "not held" (no needle). */
export function gauge({ value, max, marks = [], fmt = v => String(v), label = '', tone = 'var(--accent)', note = '' }) {
  const W = 220, H = 128, cx = W / 2, cy = 112, R = 92, t = 16;
  const ang = v => Math.PI * (1 - Math.max(0, Math.min(1, v / max)));
  const pt = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy - rad * Math.sin(a)).toFixed(2)}`;
  const arc = (v0, v1, color) => { const a0 = ang(v0), a1 = ang(v1); return `<path d="M ${pt(R, a0)} A ${R} ${R} 0 0 1 ${pt(R, a1)} L ${pt(R - t, a1)} A ${R - t} ${R - t} 0 0 0 ${pt(R - t, a0)} Z" fill="${color}"/>`; };
  const has = ok(value) && ok(max) && max > 0;
  const m = marks.filter(k => ok(k.v)).map(k => { const a = ang(k.v); return `<line x1="${cx + (R + 3) * Math.cos(a)}" y1="${cy - (R + 3) * Math.sin(a)}" x2="${cx + (R - t - 3) * Math.cos(a)}" y2="${cy - (R - t - 3) * Math.sin(a)}" stroke="var(--ink-2)" stroke-width="2"/><text x="${cx + (R + 12) * Math.cos(a)}" y="${cy - (R + 12) * Math.sin(a)}" font-size="9.5" fill="var(--ink-3)" text-anchor="${Math.cos(a) > 0.3 ? 'start' : Math.cos(a) < -0.3 ? 'end' : 'middle'}">${esc(k.label)}</text>`; }).join('');
  const needle = has ? (() => { const a = ang(value); return `<line x1="${cx}" y1="${cy}" x2="${cx + (R - t / 2) * Math.cos(a)}" y2="${cy - (R - t / 2) * Math.sin(a)}" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="var(--ink)"/>`; })() : '';
  return `<div class="land-gauge"><svg viewBox="-44 -16 ${W + 88} ${H + 16}" role="img" aria-label="${esc(label)}">${arc(0, max, 'var(--surface-2)')}${has ? arc(0, Math.min(value, max), tone) : ''}${m}${needle}</svg>
    <div class="lg-v">${has ? esc(fmt(value)) : 'not held'}</div><div class="lg-l">${esc(label)}</div>${note ? `<div class="lg-n">${esc(note)}</div>` : ''}</div>`;
}

/**
 * v6: the site map on the shared basemap (geomap.geoMap): the bus, distance rings, the screening disc when one is
 * held, stations by whether they clear the request, and the placed site with its straight-line tie. The svg keeps
 * data-site-map + data-lon0/lat0/span/lspan for the app's click-to-place handler; on the geoMap projection the
 * linear mapping is exact for the unzoomed view (landcore.siteMapFrame, tests/land-v6.test.mjs).
 */
export function siteGeoMap(node, site, stations, { mw, fmtHr, discMi = null, W = 620, H = 400 }) {
  const f = siteMapFrame(node, site, { W, H, rings: [3, 6, 9] });
  if (!f) return '<div class="empty"><strong>No coordinate for this bus</strong>The map needs the bus latitude and longitude (dim_bus); none is held.</div>';
  const bus = [node.longitude, node.latitude], hasSite = ok(site?.lat) && ok(site?.lon);
  // P2 C07: s.clears carries the Grid verdict status (D6.1); only Fits is green, only an element-study breach is red.
  const col = { Fits: 'var(--ok)', 'Does not fit': 'var(--bad)' }, word = { Fits: 'fits (element study)', 'Does not fit': 'does not fit (element study)', 'Envelope only': 'envelope only (Hold)', Hold: 'Hold (element limit not published)', 'Not studied': 'not studied', 'Partly studied': 'partly studied (Hold)', 'Not requested': 'not requested' };
  col.unknown = 'var(--ink-4)';
  const seen = new Set();
  const pts = (stations || []).filter(s => ok(s.lat) && ok(s.lon)).map((s, i) => {
    const k = `${s.lat}|${s.lon}`, lab = i < 6 && !seen.has(k); seen.add(k); const d = ok(s.d) ? s.d : s.mi;
    return { lon: s.lon, lat: s.lat, r: s.kv >= 300 ? 5.5 : 4, fill: col[s.clears] || col.unknown, label: lab ? `${s.name} ${s.kv}` : '', tip: `<b>${esc(s.name)}</b> ${esc(s.kv)} kV<br>${ok(d) ? `${d.toFixed(1)} mi · ` : ''}${esc(fmtHr(s.hr))}<br>request ${esc(mw)} MW: ${esc(word[s.clears] || 'unknown')}` };
  });
  const layers = [{ kind: 'rings', center: bus, miles: [3, 6, 9] }];
  if (ok(discMi) && ![3, 6, 9].includes(discMi)) layers.push({ kind: 'rings', center: bus, miles: [discMi] });
  if (hasSite) layers.push({ kind: 'lines', lines: [{ a: bus, b: [site.lon, site.lat], cls: 'gm-tie', w: 2, tip: 'Straight-line tie from the site to the bus' }] });
  layers.push({ kind: 'points', points: pts });
  layers.push({ kind: 'points', points: [{ lon: bus[0], lat: bus[1], r: 7, fill: 'var(--accent)', label: `${node.name} (bus)`, tip: `<b>${esc(node.name)}</b> (this bus)` }, ...(hasSite ? [{ lon: site.lon, lat: site.lat, r: 7, fill: 'var(--s2)', label: 'Site', tip: `Placed site ${site.lat}, ${site.lon}` }] : [])] });
  const legend = { items: [{ label: `fits ${mw} MW (element study)`, fill: 'var(--ok)' }, { label: 'does not fit (element study)', fill: 'var(--bad)' }, { label: 'Hold: envelope only, not published or not studied', fill: 'var(--ink-4)' }, { label: 'this bus', fill: 'var(--accent)' }, ...(hasSite ? [{ label: 'placed site', fill: 'var(--s2)' }] : []), { label: `rings 3 / 6 / 9 mi${ok(discMi) ? ` · screening disc ${discMi} mi (exclusion acres held, shapes not held)` : ''}`, shape: 'line', fill: 'var(--border-3)' }] };
  const a = f.attrs;
  return geoMap({ id: 'land-site', width: W, height: H, extent: f.extent, layers, legend, title: 'Site map: click to place the site' })
    .replace('<svg data-map=', `<svg data-site-map data-lon0="${a.lon0}" data-lat0="${a.lat0}" data-span="${a.span}" data-lspan="${a.lspan}" data-map=`);
}

/** Scoped styles for the graphics above (only land-* classes; the shell owns app.css). */
// Land's styles moved to studio-bridge.css (v6 shell: no inline <style> blocks in views).
export const LAND_CSS = '';
