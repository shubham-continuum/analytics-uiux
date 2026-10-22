// Grid dashboard special graphics (static SVG strings, dark-theme tokens; every mark has a <title> tooltip).
//  (The geographic network map moved to geomap.js geoMap in v6: views/grid-netmap.js builds its layers.)
//  oneLine    — schematic of the connection point: the station's feeders, transformers, generators and loads.
//  scatterSvg — x/y scatter with groups (used when charts.js has no scatter yet).
//  stepSvg    — cumulative step chart (cost to unlock).
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
const r1 = v => Math.round(v * 10) / 10;
const KV_COLOR = kv => (kv >= 345 ? 'var(--s2)' : kv >= 230 ? 'var(--s4)' : kv >= 115 ? 'var(--s1)' : 'var(--s7)');
export const GROUP_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)'];

function ticks(min, max, n = 4) {
  if (!ok(min) || !ok(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / n, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const out = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}

/** Connection-point schematic: station bus bar, feeders to far-end buses, transformers, generators, loads. */
export function oneLine(ctx, limitingKeys = new Set(), opts = {}) {
  const st = new Set(ctx.elements.station.map(Number));
  const feeders = ctx.elements.branches.filter(b => !(st.has(Number(b.from)) && st.has(Number(b.to))));
  const ties = ctx.elements.branches.length - feeders.length;
  const xf = ctx.elements.transformers, gens = ctx.elements.generators, loads = ctx.elements.loads;
  const items = [...feeders.map(b => ({ kind: 'line', b })), ...xf.map(t => ({ kind: 'xf', t })), ...gens.map(g => ({ kind: 'gen', g })), ...loads.map(l => ({ kind: 'load', l }))];
  if (!items.length) return `<div class="notice">No line, transformer, generator or load row is held at this connection point (${ties} internal tie${ties === 1 ? '' : 's'}).</div>`;
  const W = 640, n = items.length, cols = Math.min(n, 6), rowsN = Math.ceil(n / cols), H = 70 + rowsN * 118, bx0 = 40, bx1 = W - 40, by = 46;
  const key = b => `${Math.min(b.from, b.to)}-${Math.max(b.from, b.to)}-${String(b.ckt ?? '').trim()}`;
  const out = [`<rect x="${bx0}" y="${by - 4}" width="${bx1 - bx0}" height="8" rx="2" style="fill:var(--ink-2)"><title>${esc(ctx.bus.bus_name)} ${esc(ctx.bus.nominal_kv)} kV station (${st.size} model bus${st.size === 1 ? '' : 'es'}: ${[...st].join(', ')})</title></rect>`,
    `<text x="${bx0}" y="${by - 12}" class="gx-t-title">${esc(ctx.bus.bus_name)} ${esc(ctx.bus.nominal_kv)} kV · ${ties} internal tie${ties === 1 ? '' : 's'} at 0 MVA (not drawn)</text>`];
  items.forEach((it, i) => {
    const c = i % cols, r = Math.floor(i / cols), x = bx0 + ((c + 0.5) * (bx1 - bx0)) / cols, y0 = by + 4, y1 = by + 60 + r * 118;
    const drop = `<line x1="${r1(x)}" y1="${y0}" x2="${r1(x)}" y2="${y1}" class="gx-branch"/>`;
    if (it.kind === 'line') {
      const b = it.b, far = st.has(Number(b.from)) ? { id: b.to, n: b.to_name } : { id: b.from, n: b.from_name }, hit = limitingKeys.has(key(b));
      out.push(`${drop}<line x1="${r1(x)}" y1="${y1}" x2="${r1(x)}" y2="${y1 + 34}" style="stroke:${hit ? 'var(--bad)' : KV_COLOR(b.kv)};stroke-width:${hit ? 4 : 2.4}${/open/i.test(b.status || '') ? ';stroke-dasharray:4 3' : ''}"><title>${esc(b.name)} · ${esc(b.kv)} kV · ckt ${esc(b.ckt)} · ${esc(b.status)} · Rate A ${ok(b.rate_a) ? b.rate_a + ' MVA' : 'not held'} / Rate B ${ok(b.rate_b) ? b.rate_b + ' MVA' : 'not held'}${hit ? ' · LIMITS THIS BUS' : ''}</title></line>`
        + `<circle cx="${r1(x)}" cy="${y1 + 38}" r="4" class="gx-node"/><text x="${r1(x)}" y="${y1 + 56}" text-anchor="middle" class="gx-t">${esc(String(far.n).slice(0, 16))}</text><text x="${r1(x)}" y="${y1 + 69}" text-anchor="middle" class="gx-t-sub">${esc(b.kv)} kV · ${ok(b.rate_a) ? `A ${b.rate_a}` : 'A n/h'}${ok(b.rate_b) ? ` / B ${b.rate_b}` : ''}</text>`
        + (hit ? `<text x="${r1(x)}" y="${y1 + 82}" text-anchor="middle" class="gx-t-bad">limits this bus</text>` : ''));
    } else if (it.kind === 'xf') {
      const t = it.t;
      out.push(`${drop}<circle cx="${r1(x)}" cy="${y1 + 8}" r="8" class="gx-trace"/><circle cx="${r1(x)}" cy="${y1 + 20}" r="8" class="gx-trace"><title>Transformer ${esc(t.fname)} → ${esc(t.tname)} · ${esc(t.kv)} kV · ckt ${esc(t.circuit)} · ${esc(t.status)} · Rate A ${ok(t.rate_a) ? t.rate_a + ' MVA' : 'not held'}</title></circle>`
        + `<text x="${r1(x)}" y="${y1 + 44}" text-anchor="middle" class="gx-t">Transformer</text><text x="${r1(x)}" y="${y1 + 57}" text-anchor="middle" class="gx-t-sub">${esc(String(t.kv).trim())} kV · ${ok(t.rate_a) ? `${t.rate_a} MVA` : 'rating n/h'}</text>`);
    } else if (it.kind === 'gen') {
      const g = it.g;
      out.push(`${drop}<circle cx="${r1(x)}" cy="${y1 + 12}" r="11" class="gx-node-ok"><title>Generator ${esc(g.gen_name)} (${esc(g.status)}) · ${ok(g.max_capacity_mw) ? g.max_capacity_mw + ' MW max' : 'max not held'}</title></circle><text x="${r1(x)}" y="${y1 + 16}" text-anchor="middle" class="gx-t-ok">G</text>`
        + `<text x="${r1(x)}" y="${y1 + 38}" text-anchor="middle" class="gx-t">${esc(String(g.gen_name).slice(0, 16))}</text><text x="${r1(x)}" y="${y1 + 51}" text-anchor="middle" class="gx-t-sub">${esc(g.status)} · ${ok(g.max_capacity_mw) ? `${g.max_capacity_mw} MW` : 'n/h'}</text>`);
    } else {
      const l = it.l;
      out.push(`${drop}<path d="M${r1(x - 7)} ${y1} L${r1(x + 7)} ${y1} L${r1(x)} ${y1 + 14} Z" style="fill:var(--warn)"><title>Load ${esc(l.load_name)} · ${ok(l.load_mw) ? l.load_mw + ' MW' : 'not held'}</title></path><text x="${r1(x)}" y="${y1 + 30}" text-anchor="middle" class="gx-t">Load</text><text x="${r1(x)}" y="${y1 + 43}" text-anchor="middle" class="gx-t-sub">${ok(l.load_mw) ? `${l.load_mw} MW` : 'n/h'}</text>`);
    }
  });
  return `<svg class="gx-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Connection-point schematic" height="${Math.min(H, opts.height || 340)}">${out.join('')}</svg>
    <p class="gx-cap">Schematic of connectivity from the store's element tables, not a protection one-line: no breakers, switches or impedances are held.</p>`;
}

/** Scatter points [{x, y, label, group}] with groups coloured; opts {xLabel, yLabel, fmt, xfmt, height, groups}. */
export function scatterSvg(points, opts = {}) {
  const pts = points.filter(p => ok(p.x) && ok(p.y));
  if (!pts.length) return `<div class="empty"><strong>Nothing to plot</strong>${esc(opts.emptyText || 'No points are held for this selection.')}</div>`;
  const W = 600, H = opts.height || 240, L = 54, Rm = 12, T = 10, B = 34;
  const xs = ticks(Math.min(0, ...pts.map(p => p.x)), Math.max(...pts.map(p => p.x))), ys = ticks(Math.min(0, ...pts.map(p => p.y)), Math.max(...pts.map(p => p.y)));
  const x0 = xs[0], x1 = xs[xs.length - 1], y0 = ys[0], y1 = ys[ys.length - 1];
  const X = v => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - Rm), Y = v => H - B - ((v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const groups = opts.groups || [...new Set(pts.map(p => p.group))];
  const fx = opts.xfmt || (v => String(v)), fy = opts.fmt || (v => String(v));
  const grid = ys.map(v => `<line x1="${L}" x2="${W - Rm}" y1="${r1(Y(v))}" y2="${r1(Y(v))}" class="gx-gridline"/><text x="${L - 6}" y="${r1(Y(v) + 3.5)}" text-anchor="end" class="gx-t-axis">${esc(fy(v))}</text>`).join('')
    + xs.map(v => `<text x="${r1(X(v))}" y="${H - B + 15}" text-anchor="middle" class="gx-t-axis">${esc(fx(v))}</text>`).join('');
  const dots = pts.map(p => `<circle cx="${r1(X(p.x))}" cy="${r1(Y(p.y))}" r="${p.r || 4.5}" style="fill:${GROUP_COLORS[Math.max(0, groups.indexOf(p.group)) % GROUP_COLORS.length]};opacity:.85;stroke:var(--bg);stroke-width:.8"><title>${esc(p.label)} · ${esc(opts.xLabel)} ${esc(fx(p.x))} · ${esc(opts.yLabel)} ${esc(fy(p.y))}${p.group ? ` · ${esc(p.group)}` : ''}</title></circle>`).join('');
  const refs = (opts.refX || []).map(r => `<line x1="${r1(X(r.x))}" x2="${r1(X(r.x))}" y1="${T}" y2="${H - B}" class="gx-warnline"/><text x="${r1(X(r.x) + 4)}" y="${T + 10}" class="gx-t-warn">${esc(r.label)}</text>`).join('');
  const legend = groups.length > 1 ? `<div class="gx-legend">${groups.map((g, i) => `<span class="gx-key"><i style="background:${GROUP_COLORS[i % GROUP_COLORS.length]};border-radius:50%;height:8px;width:8px"></i>${esc(g)}</span>`).join('')}</div>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.title || 'Scatter')}" width="100%" height="${H}">${grid}<line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" class="gx-axisline"/><line x1="${L}" x2="${W - Rm}" y1="${H - B}" y2="${H - B}" class="gx-axisline"/>${refs}${dots}
    <text x="${(L + W - Rm) / 2}" y="${H - 4}" text-anchor="middle" class="gx-t">${esc(opts.xLabel)}</text><text transform="translate(12 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle" class="gx-t">${esc(opts.yLabel)}</text></svg>${legend}`;
}
