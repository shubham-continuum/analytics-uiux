// Grid v6: the "Network around the bus" map model. Pure: payload from /api/x/gridnet/around/<bus> in, geoMap layers out.
// Settled rules applied here (gridrules.js is the source of each):
//   - the cases a service uses (applicableCases): storage charge at shoulder only; a data centre unions large load
//     and summer-peak charge; shoulder export rows are never used (store mislabel);
//   - rating basis (loadingBasis): base-case rows rate A on the base flow, contingency rows rate C on the post-contingency flow;
//   - pre-existing = |loading before the project| >= 100 %.
import { applicableCases, loadingBasis, CASE_LABEL } from '../gridrules.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RAD = Math.PI / 180;
const mi = (p, q) => (p && q ? 69.0 * Math.hypot((q[0] - p[0]) * Math.cos(((p[1] + q[1]) / 2) * RAD), q[1] - p[1]) : null);
const n1 = v => (ok(v) ? v.toFixed(1) : 'not held');

/** This bus's facility rows in the cases the service uses, each with its rating basis and the pre-existing flag. */
export function facilityRows(rows, tech) {
  const app = applicableCases(tech), use = new Set([...app.export, ...app.import].filter(k => k !== 'shoulder|discharge'));
  return (rows || []).filter(r => r.key && !/no violations/i.test(String(r.monitored_facility)) && use.has(`${r.scenario}|${r.direction}`)).map(r => {
    const b = loadingBasis(r), key = `${r.scenario}|${r.direction}`;
    return { ...r, case: key, caseLabel: CASE_LABEL[key] || key, rate: b.rate, rating: ok(b.rating) ? b.rating : null, flow: ok(b.flow) ? b.flow : null,
      pre: ok(r.pct_loading_no_transfer) && Math.abs(r.pct_loading_no_transfer) >= 100 };
  });
}

const facLabel = r => `${r.a_name || r.a} – ${r.b_name || r.b}${r.ckt && r.ckt !== '1' ? ` ckt ${r.ckt}` : ''}`;
/** The row that represents a facility in one case: lowest positive transfer among non-pre rows, else the most loaded row. */
function caseRow(rows) {
  const lim = rows.filter(r => !r.pre && ok(r.transfer_mw) && r.transfer_mw > 0);
  if (lim.length) return lim.reduce((a, b) => (b.transfer_mw < a.transfer_mw ? b : a));
  return rows.reduce((a, b) => (Math.abs(b.pct_loading_no_transfer ?? -1) > Math.abs(a.pct_loading_no_transfer ?? -1) ? b : a));
}
// data-tip is HTML by contract (ui.js sets innerHTML): every DB-sourced field is escaped here.
const rowTip = r => `${esc(r.caseLabel)}: rate ${esc(r.rate)} ${ok(r.rating) ? `${Math.round(r.rating)} MVA` : 'not held'} · loading ${ok(r.pct_loading_no_transfer) ? `${r.pct_loading_no_transfer.toFixed(1)}%` : 'not held'}${r.pre ? ' (pre-existing)' : ''} · DFAX ${ok(r.dfax) ? r.dfax.toFixed(3) : 'not held'} · transfer ${ok(r.transfer_mw) ? `${r.transfer_mw.toFixed(1)} MW` : 'not held'} · for loss of ${esc(r.binding_contingency || 'not held')}`;
/** Substation point tip (HTML-safe). */
export const substationTip = s => `${esc(s.name)} · ${ok(s.kv) ? `${esc(s.kv)} kV` : 'kV not held'} · short circuit ${ok(s.sc_mva) ? `${Math.round(s.sc_mva).toLocaleString('en-US')} MVA` : 'not held'} · ${n1(s.mi)} mi`;
/** Candidate-bus point tip (HTML-safe). */
export const busTip = b => `${esc(b.bus_name)} · bus ${esc(b.bus_id)} · ${ok(b.kv) ? `${esc(b.kv)} kV` : ''} · candidate bus`;

/**
 * Map model. opts: { tech, sel (facility key) }.
 * Returns { net, fac, facilities, selected, counts, bus, radius }; lines carry {a, b, cls, tip, act, v}.
 */
export function netMapModel(p, { tech = 'solar', sel = null } = {}) {
  const rows = facilityRows(p?.rows, tech), geo = p?.facility_geo || {}, bus = p?.bus || null, here = bus && ok(bus.lon) ? [bus.lon, bus.lat] : null;
  const by = new Map();
  for (const r of rows) { if (!by.has(r.key)) by.set(r.key, []); by.get(r.key).push(r); }
  const facilities = [...by].map(([key, rs]) => {
    const cases = [...new Set(rs.map(r => r.case))].map(k => caseRow(rs.filter(r => r.case === k)));
    const limiting = rs.some(r => !r.pre && ok(r.transfer_mw) && r.transfer_mw > 0);
    const tight = rs.filter(r => !r.pre && ok(r.transfer_mw) && r.transfer_mw > 0).map(r => r.transfer_mw);
    const g = geo[key] || {}, drawn = !!(g.a && g.b);
    const d = drawn && here ? Math.min(mi(here, g.a), mi(here, g.b)) : null;
    return { key, label: facLabel(rs[0]), kv: ok(rs[0].kv) ? rs[0].kv : null, type: rs[0].facility_type, rows: rs.length, preRows: rs.filter(r => r.pre).length,
      cls: limiting ? 'gm-lim' : 'gm-pre', limiting, minTransfer: tight.length ? Math.min(...tight) : null, cases, a: g.a || null, b: g.b || null, drawn, inNet: !!g.in_net, mi: d,
      worst: Math.max(...rs.map(r => (ok(r.pct_loading_no_transfer) ? Math.abs(r.pct_loading_no_transfer) : -Infinity))) };
  });
  const selected = facilities.find(f => f.key === sel) || null;
  const tipOf = f => `${esc(f.label)} · ${ok(f.kv) ? `${esc(f.kv)} kV` : 'kV not held'} · ${f.limiting ? 'limits this bus' : 'pre-existing overload'}${f.preRows && f.limiting ? ` (pre-existing in ${f.preRows} row${f.preRows > 1 ? 's' : ''})` : ''} | ${f.cases.map(rowTip).join(' | ')}`;
  const fac = facilities.filter(f => f.drawn).map(f => ({ a: f.a, b: f.b, cls: `${f.cls}${selected && f.key === selected.key ? ' gm-sel' : ''}`, tip: tipOf(f), act: 'grid-fac', v: f.key, key: f.key }));
  const facKeys = new Set(fac.map(l => l.key));
  const net = (p?.branches || []).filter(b => !facKeys.has(b.key) && b.a && b.b).map(b => ({ a: b.a, b: b.b, cls: 'gm-net', key: b.key,
    tip: `${esc(b.name || `${b.from_name} – ${b.to_name}`)} · ${ok(b.kv) ? `${esc(b.kv)} kV` : 'kV not held'} · ${esc(b.status || 'status not held')} · rate A ${ok(b.rate_a) ? `${Math.round(b.rate_a)} MVA` : 'not held'} · not a limiting facility of this bus` }));
  const radius = ok(p?.radius_mi) ? p.radius_mi : null;
  const counts = { branches: (p?.branches || []).length, lim: facilities.filter(f => f.limiting).length, pre: facilities.filter(f => !f.limiting).length,
    facNotDrawn: facilities.filter(f => !f.drawn).length, beyond: facilities.filter(f => f.drawn && ok(f.mi) && ok(radius) && f.mi > radius).length,
    branchNotDrawn: p?.not_drawn?.branches_near ?? null, branchUnplaceable: p?.not_drawn?.branches_unplaceable ?? null };
  const tight = facilities.filter(f => ok(f.minTransfer)).sort((a, b) => a.minTransfer - b.minTransfer)[0] || null;
  return { bus, radius, net, fac, facilities, selected, counts, tight, rows };
}

/** One computed sentence answering "what network is around the bus, and which parts limit it?" */
export function netAnswer(m) {
  const c = m.counts, r = ok(m.radius) ? `${m.radius} mi` : 'the radius';
  if (!m.facilities.length) return `<b>${c.branches}</b> branches lie within ${r}; no limiting facility is listed for this bus in the cases this service uses.`;
  const t = m.tight ? `; the tightest is <b>${esc(m.tight.label)}</b> at <b>${n1(m.tight.minTransfer)} MW</b> of transfer` : '; none has a positive transfer limit (all pre-existing)';
  return `<b>${c.branches}</b> branches within ${r}; <b>${c.lim}</b> limiting facilit${c.lim === 1 ? 'y' : 'ies'} of this bus and <b>${c.pre}</b> pre-existing overload${c.pre === 1 ? '' : 's'}${t}${c.facNotDrawn ? ` (${c.facNotDrawn} not drawn: an end has no coordinate)` : ''}.`;
}
