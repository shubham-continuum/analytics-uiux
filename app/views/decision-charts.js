// Decision's special graphs (HTML/SVG, no dependency): parallel raw bars per metric, a scenario range bar per option,
// stacked gate-status bars, a status-count strip and a mini map of the options with their linked queue requests.
// Every graph draws only held values; "not held" is written, never drawn as zero. No combined score anywhere.
import { geoMap } from '../geomap.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ok = v => typeof v === 'number' && Number.isFinite(v);
/** Option colours: the same order as charts.js series (s1, s2, s5 after the Studio remap). */
export const OPT = ['var(--s1)', 'var(--s2)', 'var(--s5)'];
const TONE = { Pass: 'var(--ok)', Hold: 'var(--warn)', Fail: 'var(--bad)', held: 'var(--ok)', partial: 'var(--warn)', 'not held': 'var(--bad)' };
export const toneOf = s => TONE[s] || 'var(--ink-4)';

export const legend = names => `<div class="d-legend" style="display:flex;flex-wrap:wrap;gap:4px 14px;font-size:11.5px;color:var(--ink-3);margin:0 0 6px">${names.map((n, i) => `<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${OPT[i % OPT.length]};margin-right:5px;vertical-align:-1px"></i>${esc(n)}</span>`).join('')}</div>`;

/**
 * Parallel bars: one row per metric, one bar per option, each row scaled to its own largest |value| (units differ
 * across rows, so rows are never added). metrics: [{label, sub, values:[v|null], fmt, best?: index}]
 */
export function parallelBars(metrics, names) {
  const rows = metrics.map(m => {
    const hi = Math.max(0, ...m.values.filter(ok).map(Math.abs));
    const bars = m.values.map((v, i) => {
      if (!ok(v)) return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:6px;align-items:center;height:15px"><div style="height:7px;border-radius:2px;border:1px dashed var(--border-2)"></div><span style="font-size:11px;color:var(--ink-4);text-align:right">not held</span></div>`;
      const w = hi ? Math.max(1.5, (100 * Math.abs(v)) / hi) : 0;
      return `<div style="display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:6px;align-items:center;height:15px" title="${esc(names[i])}: ${esc(m.fmt(v))}"><div style="height:9px;background:var(--sunk);border-radius:2px;overflow:hidden"><div style="height:100%;width:${w.toFixed(1)}%;background:${OPT[i % OPT.length]};border-radius:2px;opacity:${v < 0 ? 0.55 : 1}"></div></div><span style="font-size:11px;font-variant-numeric:tabular-nums;text-align:right;color:var(--ink-2)">${esc(m.fmt(v))}</span></div>`;
    }).join('');
    return `<div style="display:grid;grid-template-columns:minmax(96px,34%) minmax(0,1fr);gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border)"><div style="font-size:11.5px;line-height:1.25;color:var(--ink-2)">${esc(m.label)}${m.sub ? `<br><span style="font-size:10.5px;color:var(--ink-4)">${esc(m.sub)}</span>` : ''}</div><div style="display:grid;gap:2px">${bars}</div></div>`;
  }).join('');
  return `${legend(names)}<div class="d-pbars" role="img" aria-label="Raw metrics per option, each row scaled to its own maximum">${rows}</div>`;
}

/** Range bar per option: min–max across scenarios on one shared axis, the applied basis as a tick, the worst case ringed. */
export function rangeBars(items, { fmt, lowerBetter = false }) {
  const vals = items.flatMap(it => [it.min, it.max, it.applied]).filter(ok);
  if (!vals.length) return '<div class="empty"><strong>Nothing to chart</strong>No option has a value in any scenario.</div>';
  const lo = Math.min(0, ...vals), hi = Math.max(...vals), x = v => (100 * (v - lo)) / ((hi - lo) || 1);
  const rows = items.map((it, i) => {
    if (!ok(it.min)) return `<div style="display:grid;grid-template-columns:minmax(90px,26%) minmax(0,1fr);gap:8px;align-items:center;min-height:34px"><span style="font-size:11.5px">${esc(it.name)}</span><span style="font-size:11px;color:var(--ink-4)">not held in any scenario</span></div>`;
    const c = OPT[i % OPT.length];
    return `<div style="display:grid;grid-template-columns:minmax(90px,26%) minmax(0,1fr);gap:8px;align-items:center;min-height:38px">
      <span style="font-size:11.5px;line-height:1.25">${esc(it.name)}<br><span style="font-size:10.5px;color:var(--ink-4)">${it.n} scenario(s)${it.missing ? `, ${it.missing} not held` : ''}</span></span>
      <div style="position:relative;height:30px" title="${esc(it.name)}: ${esc(fmt(it.min))} to ${esc(fmt(it.max))}${ok(it.applied) ? `; applied ${esc(fmt(it.applied))}` : ''}">
        <div style="position:absolute;left:0;right:0;top:11px;height:1px;background:var(--border-2)"></div>
        <div style="position:absolute;top:7px;height:9px;left:${x(it.min).toFixed(2)}%;width:${Math.max(0.6, x(it.max) - x(it.min)).toFixed(2)}%;background:${c};opacity:.55;border-radius:3px"></div>
        ${ok(it.applied) ? `<div style="position:absolute;top:3px;height:17px;width:2px;left:calc(${x(it.applied).toFixed(2)}% - 1px);background:var(--ink)"></div>` : ''}
        ${ok(it.worst) ? `<div style="position:absolute;top:6px;width:11px;height:11px;border-radius:50%;left:calc(${x(it.worst).toFixed(2)}% - 5.5px);border:2px solid var(--bad);background:var(--surface)"></div>` : ''}
        <span style="position:absolute;left:0;top:19px;font-size:10.5px;color:var(--ink-3);white-space:nowrap">${esc(fmt(it.min))}</span>
        <span style="position:absolute;right:0;top:19px;font-size:10.5px;color:var(--ink-3);white-space:nowrap">${esc(fmt(it.max))}</span>
      </div></div>`;
  }).join('');
  return `<div role="img" aria-label="Range across scenarios per option">${rows}</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:10.5px;color:var(--ink-4);margin-top:4px"><span><i style="display:inline-block;width:2px;height:11px;background:var(--ink);vertical-align:-1px;margin-right:4px"></i>applied basis</span><span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;border:2px solid var(--bad);vertical-align:-1px;margin-right:4px"></i>worst scenario (${lowerBetter ? 'highest' : 'lowest'})</span><span>Axis from ${esc(fmt(lo))} to ${esc(fmt(hi))}, shared by all options</span></div>`;
}

/** Stacked status bars: one row per item, segments in the given order (e.g. Pass / Hold / Fail counts). */
export function stackBars(rows, order) {
  const body = rows.map(r => {
    const tot = order.reduce((t, k) => t + (r.counts[k] || 0), 0);
    const seg = order.filter(k => r.counts[k]).map(k => `<div title="${esc(k)}: ${r.counts[k]}" style="width:${(100 * r.counts[k]) / (tot || 1)}%;background:${toneOf(k)};color:#0c1220;font-size:10.5px;font-weight:650;display:flex;align-items:center;justify-content:center;min-width:18px">${r.counts[k]}</div>`).join('');
    return `<div style="display:grid;grid-template-columns:minmax(90px,30%) minmax(0,1fr);gap:8px;align-items:center;padding:4px 0"><span style="font-size:11.5px;line-height:1.2">${esc(r.label)}</span><div style="display:flex;height:18px;border-radius:3px;overflow:hidden;background:var(--sunk)">${seg || '<span style="font-size:11px;color:var(--ink-4);padding-left:6px">none</span>'}</div></div>`;
  }).join('');
  const key = order.map(k => `<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${toneOf(k)};margin-right:5px;vertical-align:-1px"></i>${esc(k)}</span>`).join('');
  return `<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--ink-3);margin-bottom:4px">${key}</div><div role="img" aria-label="Status counts">${body}</div>`;
}

/**
 * v6 map on the shared basemap (geomap.geoMap): each option labelled in its colour with a ring at the queue radius,
 * and the linked queue requests matched to it (small dots in the option's colour, with a tooltip).
 * pts: [{name, lat, lon, tip}] per option; queue: [{lat, lon, tip, i}] (i = the option it was matched to).
 */
export function optionMap(pts, queue, radiusMi) {
  const held = pts.map((p, i) => ({ ...p, i })).filter(p => ok(p.lat) && ok(p.lon));
  if (!held.length) return '<div class="empty"><strong>No coordinates</strong>None of the options carries coordinates.</div>';
  const q = queue.filter(x => ok(x.lat) && ok(x.lon));
  const layers = [
    ...held.map(p => ({ kind: 'rings', center: [p.lon, p.lat], miles: [radiusMi] })),
    { kind: 'points', points: q.map(x => ({ lon: x.lon, lat: x.lat, r: 3.5, fill: OPT[x.i % OPT.length], tip: x.tip })) },
    { kind: 'points', points: held.map(p => ({ lon: p.lon, lat: p.lat, r: 7, fill: OPT[p.i % OPT.length], label: p.name, tip: p.tip || esc(p.name) })) },
  ];
  const legend = { items: [...held.map(p => ({ label: p.i === 0 ? `${p.name} (candidate)` : p.name, fill: OPT[p.i % OPT.length] })), { label: `linked queue request (small dot, option colour) · rings ${radiusMi} mi`, fill: 'var(--ink-4)' }] };
  return geoMap({ id: 'decision-options', width: 620, height: 380, fit: { points: [...held, ...q].map(p => ({ lon: p.lon, lat: p.lat })), padMi: radiusMi + 2 }, layers, legend, title: 'Map of the options and linked queue requests' });
}
