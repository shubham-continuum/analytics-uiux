// Provenance: Claude Opus 5.5 · one-studio P2 slice S2-GD (Findings F005) · 2026-10-06 · v1
// Grid › Connection capacity: how stale the solved case behind every Grid limit is. Reads the same two sources as
// Queue › Changes & risk (/api/x/queue/study/all = unified dim_queue, and data/queue-register.json = the public
// register) and joins them with the same core function (queuecore.studyStatusNow), so the two pages print one count.
// Loaded once per page; the shell re-renders when it lands. Nothing here re-runs the case.
import { studyStatusNow, registerRows, miles } from '../queuecore.js';
import { studyStaleness } from '../gridrules.js';
import { gridData } from './grid-data.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const X = { study: null, reg: null, rows: null, err: null, loading: false, now: null };
const getJson = url => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(`${url} ${r.status}`))));
function ensure() {
  if (X.loading || X.err || X.now || typeof fetch !== 'function') return;
  X.loading = true;
  Promise.all([getJson('./api/x/queue/study/all'), getJson('./data/queue-register.json')])
    .then(([s, r]) => { X.study = s; X.rows = registerRows(r); X.now = studyStatusNow(s.queue || [], X.rows); })
    .catch(e => { X.err = e.message; })
    .finally(() => { X.loading = false; import('../app.js').then(m => (m.renderSoon || m.render)?.()).catch(() => {}); });
}

/** Withdrawn modelled requests within radiusMi of the node: [{qp, mw, mi, poi}]. */
export function withdrawnNear(now, node, radiusMi) {
  if (!now || !node || !ok(radiusMi)) return [];
  const bus = { lat: node.latitude, lon: node.longitude };
  return now.rows.filter(x => x.now === 'W').map(x => ({ qp: x.q.queue_position, mw: ok(x.q.max_mw) ? x.q.max_mw : null, mi: miles(bus, { lat: x.q.latitude, lon: x.q.longitude }), poi: x.q.poi_name }))
    .filter(x => ok(x.mi) && x.mi <= radiusMi);
}

/** The staleness line for the current bus (gridrules.studyStaleness), or a not-held line while the sources load. */
export function stalenessFor(data, S, node) {
  ensure();
  if (!X.now) {
    const s = studyStaleness({});
    return { ...s, text: X.err ? `${s.text.replace(/ \(queue register not loaded\)/, '')} (could not read the queue sources: ${X.err})` : X.loading ? s.text.replace('not loaded', 'loading') : s.text };
  }
  const ctx = gridData('context', S.nodeId);
  const radiusMi = ctx.state === 'ok' ? ctx.value?.radius?.queue_mi ?? null : null; // the Grid context's own queue radius (api_grid.py)
  return studyStaleness({ counts: X.now.counts, total: X.now.rows.length, nearby: withdrawnNear(X.now, node, radiusMi), radiusMi });
}
