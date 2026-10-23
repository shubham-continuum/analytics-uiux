// Shared map for every dashboard: the live Studio's offline basemap (public-domain Census TIGER + Natural Earth,
// copied read-only to data/basemap.json by plan/extract_basemap.py) under point, line, ring and label layers, in the
// live map's projection (equirectangular: x = lon·cos lat0, y = −lat), so a bus and a coastline cannot disagree.
// Pure SVG string out; zoom, pan and hover come from ui.mountMaps (svg[data-map], circle[data-r], [data-tip]).

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const RAD = Math.PI / 180, MI_PER_DEG = 69.0;

/** Google polyline decoding at 1/q degree; values come back in encoded order (the basemap stores lon, lat). */
export function decodePolyline(s, q) {
  const out = []; let i = 0, a = 0, b = 0, even = true;
  while (i < s.length) {
    let shift = 0, res = 0, c;
    do { c = s.charCodeAt(i++) - 63; res |= (c & 31) << shift; shift += 5; } while (c >= 32);
    const v = res & 1 ? ~(res >> 1) : res >> 1;
    if (even) { a += v; out.push(a / q); } else { b += v; out.push(b / q); }
    even = !even;
  }
  return out;
}

/** Great-circle-free small-distance miles between [lon, lat] points (equirectangular at their mean latitude). */
export function milesBetween(p, q) { const k = Math.cos(((p[1] + q[1]) / 2) * RAD); return MI_PER_DEG * Math.hypot((q[0] - p[0]) * k, q[1] - p[1]); }

/** Projection for an extent {lon0, lat0, lon1, lat1} onto W×H pixels; cos0 = the basemap's reference cosine. */
export function makeProjection(e, W, H, cos0) {
  const sx = W / ((e.lon1 - e.lon0) * cos0), sy = H / (e.lat1 - e.lat0), s = Math.min(sx, sy);
  const ox = (W - (e.lon1 - e.lon0) * cos0 * s) / 2, oy = (H - (e.lat1 - e.lat0) * s) / 2;
  const f = (lon, lat) => [ox + (lon - e.lon0) * cos0 * s, oy + (e.lat1 - lat) * s];
  f.scale = s; return f;
}

/** Extent around points (padded by padMi), widened to the canvas aspect so the map fills it. */
export function fitExtent(pts, { padMi = 10, min = 0.05 } = {}, W = 800, H = 400, cos0 = 0.725374) {
  const held = pts.filter(p => ok(p[0]) && ok(p[1]));
  if (!held.length) return { lon0: -73.8, lat0: 41.0, lon1: -66.8, lat1: 47.5 };
  let lon0 = Math.min(...held.map(p => p[0])), lon1 = Math.max(...held.map(p => p[0])), lat0 = Math.min(...held.map(p => p[1])), lat1 = Math.max(...held.map(p => p[1]));
  const padLat = padMi / MI_PER_DEG, padLon = padMi / (MI_PER_DEG * cos0);
  lon0 -= padLon; lon1 += padLon; lat0 -= padLat; lat1 += padLat;
  if (lat1 - lat0 < min) { const m = (lat0 + lat1) / 2; lat0 = m - min / 2; lat1 = m + min / 2; }
  // widen the short side to the canvas aspect (in projected units)
  const wU = (lon1 - lon0) * cos0, hU = lat1 - lat0, want = W / H;
  if (wU / hU < want) { const add = (hU * want / cos0 - (lon1 - lon0)) / 2; lon0 -= add; lon1 += add; }
  else { const add = ((wU / want) - hU) / 2; lat0 -= add; lat1 += add; }
  return { lon0, lat0, lon1, lat1 };
}

/** Level of detail: coarse for ISO-wide views, fine (with counties) once the view spans under ~2°. */
export function pickLod(bm, e) { return Math.max(e.lon1 - e.lon0, (e.lat1 - e.lat0) / 0.73) < 2.2 && bm.lod.length > 1 ? 1 : 0; }

/** A round scale-bar length near a fifth of the map width. */
export function scaleBar(e, W, cos0 = 0.725374) {
  const widthMi = (e.lon1 - e.lon0) * cos0 * MI_PER_DEG, target = widthMi / 5;
  const miles = [1, 2, 5, 10, 20, 25, 50, 100, 200].reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  return { miles, px: (miles / widthMi) * W };
}

/** Sequential ramp (one hue, light→dark on the dark surface: dark = low, bright = high); null = not held. */
const RAMP = ['#24395c', '#2f4f80', '#3d66a3', '#5180c2', '#6b9be0', '#8fb7f5', '#bcd5ff'];
export function rampColor(v, lo, hi) {
  if (!ok(v)) return 'var(--gm-nh)';
  const t = hi > lo ? Math.min(1, Math.max(0, (v - lo) / (hi - lo))) : 0.5;
  return RAMP[Math.min(RAMP.length - 1, Math.floor(t * RAMP.length))];
}
export const RAMP_COLORS = RAMP;

// ---- basemap cache: decoded once per level, projected path strings cached per extent ----
let BM = null, LOADING = null;
const DECODED = new Map(), PATHS = new Map();
export function setBasemap(bm) { BM = bm; DECODED.clear(); PATHS.clear(); }
export const basemapReady = () => !!BM;
/** Browser: fetch the basemap once; onReady re-renders the page when it lands. */
export function loadBasemap(onReady) {
  if (BM || LOADING) return LOADING;
  LOADING = fetch('./data/basemap.json').then(r => (r.ok ? r.json() : null)).then(j => { if (j) { setBasemap(j); onReady?.(); } }).catch(() => {});
  return LOADING;
}
function layerFeatures(lod, kind) {
  const key = `${lod}|${kind}`;
  if (!DECODED.has(key)) {
    // Rivers are [rank, polyline] (rank 0 = major); every other layer is a bare polyline string.
    DECODED.set(key, (BM.lod[lod][kind] || []).map(f => {
      const d = decodePolyline(typeof f === 'string' ? f : f[1], BM.q); let x0 = 180, x1 = -180, y0 = 90, y1 = -90;
      for (let i = 0; i < d.length; i += 2) { if (d[i] < x0) x0 = d[i]; if (d[i] > x1) x1 = d[i]; if (d[i + 1] < y0) y0 = d[i + 1]; if (d[i + 1] > y1) y1 = d[i + 1]; }
      return { d, bb: [x0, y0, x1, y1] };
    }));
  }
  return DECODED.get(key);
}
function pathFor(lod, kind, e, P, closed) {
  const key = `${lod}|${kind}|${e.lon0.toFixed(4)},${e.lat0.toFixed(4)},${e.lon1.toFixed(4)},${e.lat1.toFixed(4)}|${P.scale.toFixed(4)}`;
  if (PATHS.has(key)) return PATHS.get(key);
  const mx = (e.lon1 - e.lon0) * 0.2, my = (e.lat1 - e.lat0) * 0.2;
  let out = '';
  for (const f of layerFeatures(lod, kind)) {
    const [x0, y0, x1, y1] = f.bb;
    if (x1 < e.lon0 - mx || x0 > e.lon1 + mx || y1 < e.lat0 - my || y0 > e.lat1 + my) continue;
    for (let i = 0; i < f.d.length; i += 2) { const [x, y] = P(f.d[i], f.d[i + 1]); out += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`; }
    if (closed) out += 'Z';
  }
  PATHS.set(key, out); return out;
}

/**
 * The map as SVG. opts: { id, width, height, extent | fit:{points, padMi}, basemap = true, layers, legend, title, note }.
 * layers (drawn in order over the basemap):
 *   { kind:'rings', center:[lon,lat], miles:[5,10,25] }
 *   { kind:'lines', lines:[{ a:[lon,lat], b:[lon,lat], cls, w, tip, act, v }] }
 *   { kind:'points', points:[{ lon, lat, r, cls, fill, tip, act, v, label }] }
 *   { kind:'labels', labels:[{ lon, lat, text, cls }] }
 * legend: { items:[{ label, cls|fill, shape:'dot'|'line' }] } or { ramp:{ lo, hi, fmt, label } }.
 */
export function geoMapSvg(o) {
  const W = o.width || 760, H = o.height || 420, cos0 = BM?.cos0 || 0.725374;
  const e = o.extent || fitExtent((o.fit?.points || []).map(p => [p.lon ?? p[0], p.lat ?? p[1]]), { padMi: o.fit?.padMi ?? 10 }, W, H, cos0);
  const P = makeProjection(e, W, H, cos0), inside = (lon, lat) => lon >= e.lon0 && lon <= e.lon1 && lat >= e.lat0 && lat <= e.lat1;
  let base = '';
  if (BM && o.basemap !== false) {
    const lod = pickLod(BM, e);
    base = `<g class="gm-base" aria-hidden="true"><rect class="gm-water" x="-2000" y="-2000" width="${W + 4000}" height="${H + 4000}"/>`
      + `<path class="gm-land" d="${pathFor(lod, 'land', e, P, true)}"/><path class="gm-lake" d="${pathFor(lod, 'lakes', e, P, true)}"/>`
      + `<path class="gm-river" d="${pathFor(lod, 'rivers', e, P, false)}"/>`
      + (lod ? `<path class="gm-county" d="${pathFor(lod, 'counties', e, P, false)}"/>` : '')
      + `<path class="gm-state" d="${pathFor(lod, 'states', e, P, false)}"/><path class="gm-border" d="${pathFor(lod, 'borders', e, P, false)}"/>`;
    // Labels are [name, abbreviation, lon, lat, size]: state names on the ISO-wide view, county names on a local one.
    const labs = (lod ? BM.labels?.counties || [] : BM.labels?.states || []).map(l => ({ text: lod ? l[0] : l[1], lon: l[2], lat: l[3] })).filter(l => l.text && ok(l.lon) && inside(l.lon, l.lat));
    base += labs.map(l => { const [x, y] = P(l.lon, l.lat); return `<text class="${lod ? 'gm-clabel' : 'gm-slabel'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}">${esc(l.text)}</text>`; }).join('') + '</g>';
  }
  const attrs = it => `${it.tip ? ` data-tip="${esc(it.tip)}"` : ''}${it.act ? ` data-act="${esc(it.act)}"` : ''}${it.v != null ? ` data-v="${esc(it.v)}"` : ''}`;
  const body = (o.layers || []).map(L => {
    // rings: optional cls (styles the group) and labels (one per ring; '' draws none, absent = "N mi"), 2026-10-22
    if (L.kind === 'rings') { const [cx, cy] = P(L.center[0], L.center[1]); return `<g class="gm-rings${L.cls ? ` ${esc(L.cls)}` : ''}">${L.miles.map((mi, i) => { const r = (mi / MI_PER_DEG) * P.scale, t = L.labels?.[i] ?? `${mi} mi`; return `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"${L.tip ? ` data-tip="${esc(L.tip)}"` : ''}/>${t ? `<text x="${(cx + r * 0.71 + 3).toFixed(1)}" y="${(cy - r * 0.71 - 3).toFixed(1)}">${esc(t)}</text>` : ''}`; }).join('')}</g>`; }
    if (L.kind === 'lines') return `<g class="gm-lines">${L.lines.filter(l => ok(l.a?.[0]) && ok(l.b?.[0]) && (inside(...l.a) || inside(...l.b))).map(l => { const [x1, y1] = P(l.a[0], l.a[1]), [x2, y2] = P(l.b[0], l.b[1]); return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="${esc(l.cls || '')}"${l.w ? ` stroke-width="${l.w}"` : ''}${attrs(l)}/>`; }).join('')}</g>`;
    if (L.kind === 'points') return `<g class="gm-pts ${esc(L.cls || '')}">${L.points.filter(p => ok(p.lon) && ok(p.lat) && inside(p.lon, p.lat)).map(p => { const [x, y] = P(p.lon, p.lat), r = p.r || 4; return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" data-r="${r}" class="${esc(p.cls || '')}"${p.fill ? ` style="fill:${esc(p.fill)}"` : ''}${attrs(p)}/>${p.label ? `<text class="gm-plabel" x="${(x + r + 4).toFixed(1)}" y="${(y + 3.5).toFixed(1)}">${esc(p.label)}</text>` : ''}`; }).join('')}</g>`;
    if (L.kind === 'labels') return `<g class="gm-labels">${L.labels.filter(l => inside(l.lon, l.lat)).map(l => { const [x, y] = P(l.lon, l.lat); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="${esc(l.cls || '')}">${esc(l.text)}</text>`; }).join('')}</g>`;
    return '';
  }).join('');
  const sb = scaleBar(e, W, cos0);
  const scale = `<g class="gm-scale" transform="translate(12 ${H - 16})"><line x1="0" y1="0" x2="${sb.px.toFixed(1)}" y2="0"/><line x1="0" y1="-4" x2="0" y2="4"/><line x1="${sb.px.toFixed(1)}" y1="-4" x2="${sb.px.toFixed(1)}" y2="4"/><text x="${(sb.px / 2).toFixed(1)}" y="-6">${sb.miles} mi</text></g>`;
  return `<svg data-map="${esc(o.id)}" class="gm" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.title || 'Map')}" preserveAspectRatio="xMidYMid meet">${base}${body}${scale}</svg>`;
}

/** Legend row under a map: categorical items or a sequential ramp with its range. */
export function geoLegend(lg) {
  if (!lg) return '';
  if (lg.ramp) {
    const { lo, hi, fmt = v => String(v), label = '' } = lg.ramp;
    return `<div class="gm-legend"><span class="gm-lk">${esc(label)}</span><span>${esc(fmt(lo))}</span><i class="gm-ramp" style="background:linear-gradient(90deg,${RAMP.join(',')})"></i><span>${esc(fmt(hi))}</span>${lg.nh ? '<span class="gm-li"><i class="gm-sw" style="background:var(--gm-nh)"></i>not held</span>' : ''}</div>`;
  }
  return `<div class="gm-legend">${(lg.items || []).map(it => `<span class="gm-li"><i class="gm-sw ${esc(it.shape === 'line' ? 'gm-sw-line' : '')} ${esc(it.cls || '')}"${it.fill ? ` style="background:${esc(it.fill)}"` : ''}></i>${esc(it.label)}</span>`).join('')}</div>`;
}

/** Map card body: the map, zoom controls and the hover tip host (ui.mountMaps wires them). */
export function geoMap(o) {
  return `<div class="map-wrap gm-wrap" style="--gm-h:${o.height || 420}px">${geoMapSvg(o)}<div class="map-ctl"><button type="button" class="tiny" data-z="in" aria-label="Zoom in">+</button><button type="button" class="tiny" data-z="out" aria-label="Zoom out">−</button><button type="button" class="tiny" data-z="reset" aria-label="Reset view">⟲</button></div><div class="chart-tip" hidden></div></div>${geoLegend(o.legend)}`;
}
