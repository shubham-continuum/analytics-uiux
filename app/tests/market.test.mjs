import { BASE, pwRequire } from './env.mjs';
// Market core v2: screening over the unified database with the SAME grid rules as the Grid page.
// Integration test: reads /api/market from the running preview (python server.py --port 8104); skips if it is down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepare, serviceLimits, evaluate, rank, sizeSweep, regions } from '../marketcore.js';
import { caseTable, binding, ENVELOPE_ONLY } from '../gridrules.js';

import { get } from 'node:http';
import { gunzipSync } from 'node:zlib';
// node:http rather than fetch: undici asserts when the HTTP/1.0 preview server closes during a large body.
const getJson = url => new Promise((res, rej) => get(url, r => { const b = []; r.on('data', c => b.push(c)); r.on('end', () => { try { const buf = Buffer.concat(b); res(r.statusCode === 200 ? JSON.parse((r.headers['content-encoding'] === 'gzip' ? gunzipSync(buf) : buf).toString('utf8')) : null); } catch (e) { rej(e); } }); }).on('error', rej));
let study = null;
try { const j = await getJson(`${BASE}/api/market`); if (j) study = prepare(j); } catch { /* server down */ }
const opt = { skip: study ? false : 'preview server not running on :8104' };
const req = { tech: 'solar', exportMW: 100, importMW: 0, zones: null, minKv: 0, useShoulder: true };

test('covers every geolocated bus', opt, () => { assert.equal(study.nodes.length, 2678); });

test('one number per bus: Market limits equal the Grid page rules for every bus and service', opt, () => {
  // W-B (S2-GD #4, D6.1 / F009): the old assertion equated the Market limit with `governing` for every case, which
  // counted a vendor-envelope-only case as a studied limit. Now an envelope-only case has no limit (status 'envelope';
  // the envelope stays as context), and every studied case still equals the Grid page rule.
  let checked = 0, envelopeOnly = 0;
  for (const node of study.nodes) for (const tech of ['solar', 'storage', 'datacenter']) {
    const g = study.gridOf(node.bus_id), t = caseTable(g, node.bus_id, tech, 100, 100);
    const lims = serviceLimits(study, node, tech);
    for (const l of lims) {
      const row = t.find(r => r.key === l.caseKey); assert.ok(row, `${node.bus_id} ${l.caseKey}`);
      if (row.status === ENVELOPE_ONLY) { assert.equal(l.value, null, `${node.bus_id} ${tech} ${l.caseKey}: envelope-only is context, not a limit`); assert.equal(l.status, 'envelope'); assert.equal(l.envelope, row.envelope); envelopeOnly++; }
      else assert.equal(l.value, row.governing, `${node.bus_id} ${tech} ${l.caseKey}`);
      checked++;
    }
  }
  assert.ok(checked > 10000); assert.ok(envelopeOnly > 0, 'the store holds envelope-only shoulder cases');
});

test('bus 104330: the study copy said 166.4 MW; the full element list binds at 130.7 MW', opt, () => {
  const l = serviceLimits(study, study.nodes.find(n => n.bus_id === 104330), 'solar').find(x => x.caseKey === 'summer_peak|discharge');
  assert.equal(l.value, 130.7);
});

test('every bus is met, unmet, unknown or excluded; unknown is never met and always says why', opt, () => {
  const ev = evaluate(study, req);
  assert.equal(ev.length, study.nodes.length);
  assert.ok(ev.every(e => ['met', 'unmet', 'unknown', 'excluded'].includes(e.status)));
  assert.ok(ev.filter(e => e.status === 'unknown').every(e => e.unknown.length > 0));
});

test('Hold and not-studied cases make a bus unknown, never met (same as Grid binding)', opt, () => {
  for (const e of evaluate(study, req)) {
    const b = binding(caseTable(study.gridOf(e.node.bus_id), e.node.bus_id, 'solar', 100, 0), 'export');
    if (b.status === 'Hold' || b.status === 'Not studied' || b.status === 'Partly studied') assert.notEqual(e.status, 'met', `${e.node.bus_id} ${b.status}`);
  }
});

test('own-price-node filter drops borrowed prices; price filters on a bus without history are unknown', opt, () => {
  const ev = evaluate(study, { ...req, ownPriceNode: true, maxPrice2025: 1000 });
  assert.ok(ev.filter(e => e.status === 'met').every(e => e.node.tier !== 'geo_proxy' || e.node.proxyKm < 0.05));
  assert.ok(ev.filter(e => e.node.lmp_2025 == null && e.status !== 'excluded').every(e => e.status !== 'met'));
});

test('an impossible requirement qualifies nobody and ranking stays empty', opt, () => {
  const ev = evaluate(study, { ...req, exportMW: 100000 });
  assert.equal(ev.filter(e => e.status === 'met').length, 0);
  assert.equal(rank(ev, ['margin', 'price']).scored.length, 0);
});

test('ranking uses qualifying buses only, ordered by score; new measures work', opt, () => {
  // W-B (D6.1): with the shoulder export case required, a bus whose shoulder case rests on the vendor envelope only is
  // Unknown and never ranked; the store holds no shoulder element study, so ranking is exercised on the element cases.
  const withShoulder = evaluate(study, req);
  assert.ok(withShoulder.filter(e => e.status === 'met').every(e => serviceLimits(study, e.node, 'solar').find(l => l.caseKey === 'shoulder|discharge').status === 'held'), 'no bus qualifies on an envelope-only shoulder case');
  const ev = evaluate(study, { ...req, useShoulder: false }), r = rank(ev, ['margin', 'spread4h', 'fcst2030']);
  assert.ok(r.scored.length > 0 && r.scored.every(x => x.status === 'met'));
  for (let i = 1; i < r.scored.length; i++) assert.ok(r.scored[i - 1].score >= r.scored[i].score);
});

test('size sweep: more MW never qualifies more buses', opt, () => {
  const s = sizeSweep(study, req, [50, 100, 250, 500]);
  for (let i = 1; i < s.length; i++) assert.ok(s[i].met <= s[i - 1].met);
});

test('regions report shares and medians, never summed headroom', opt, () => {
  const r = regions(evaluate(study, req));
  assert.ok(r.every(z => !('totalHeadroom' in z)));
  assert.ok(r.every(z => z.metShare === null || (z.metShare >= 0 && z.metShare <= 1)));
});

test('turning off the shoulder export case never drops the storage shoulder-charge check', opt, () => {
  const on = evaluate(study, { tech: 'storage', exportMW: 100, importMW: 100, useShoulder: true }).filter(e => e.status === 'met').length;
  const off = evaluate(study, { tech: 'storage', exportMW: 100, importMW: 100, useShoulder: false });
  assert.ok(off.filter(e => e.status === 'met').every(e => serviceLimits(study, e.node, 'storage').find(l => l.caseKey === 'shoulder|charge').value >= 100));
  assert.ok(off.filter(e => e.status === 'met').length >= on);
});
