import { BASE, pwRequire } from './env.mjs';
// /api/x/gridnet/around/<bus> against the running preview server; skipped when it is down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { netMapModel } from '../views/grid-netmap.js';

const getJson = url => new Promise((res, rej) => get(url, r => { const b = []; r.on('data', c => b.push(c)); r.on('end', () => { try { const buf = Buffer.concat(b); res(r.statusCode === 200 ? JSON.parse((r.headers['content-encoding'] === 'gzip' ? gunzipSync(buf) : buf).toString('utf8')) : { status: r.statusCode }); } catch (e) { rej(e); } }); }).on('error', rej));
let up = true;
try { await getJson(`${BASE}/health`); } catch { up = false; }

test('around Mashpee: branches within 15 mi placed from dim_bus, none at 0,0; facilities placed; not-drawn counted', { skip: !up }, async () => {
  const p = await getJson(`${BASE}/api/x/gridnet/around/111403`);
  assert.equal(p.bus.bus_id, 111403);
  assert.equal(p.radius_mi, 15);
  assert.ok(p.branches.length > 20 && p.branches.every(b => b.mi <= 15 + 1e-9));
  for (const b of p.branches) for (const q of [b.a, b.b]) assert.ok(Number.isFinite(q[0]) && Number.isFinite(q[1]) && q[0] < -60 && q[1] > 40);
  assert.ok(Number.isInteger(p.not_drawn.branches_near) && Number.isInteger(p.not_drawn.branches_unplaceable));
  const m = netMapModel(p, { tech: 'solar' });
  assert.ok(m.counts.lim >= 1, 'Mashpee has a limiting facility in summer-peak export');
  const f = m.facilities.find(x => x.key === '111209-111212-1');
  assert.ok(f && f.drawn && f.cls === 'gm-lim');
  // the summer-peak export row of this facility is a contingency row: rate C 243 MVA
  assert.equal(f.cases[0].rate, 'C'); assert.equal(f.cases[0].rating, 243);
});

test('unknown bus → 404', { skip: !up }, async () => {
  assert.equal((await getJson(`${BASE}/api/x/gridnet/around/999999999`)).status, 404);
});
