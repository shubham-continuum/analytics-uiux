import { BASE, pwRequire } from './env.mjs';
// Grid context endpoints (api_grid.py) against the running preview server; skipped when it is down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { parseFacility } from '../gridrules.js';

const getJson = url => new Promise((res, rej) => get(url, r => { const b = []; r.on('data', c => b.push(c)); r.on('end', () => { try { const buf = Buffer.concat(b); res(r.statusCode === 200 ? JSON.parse((r.headers['content-encoding'] === 'gzip' ? gunzipSync(buf) : buf).toString('utf8')) : { status: r.statusCode }); } catch (e) { rej(e); } }); }).on('error', rej));
const U = `${BASE}/api/x/grid`;
let up = true;
try { await getJson(`${BASE}/health`); } catch { up = false; }

test('context for Mashpee: substation, short circuit, limiting facilities located on the branch table', { skip: !up }, async () => {
  const c = await getJson(`${U}/context/111403`);
  assert.equal(c.bus.bus_id, 111403);
  assert.equal(c.sc.own, 2520.1);
  assert.ok(c.sc.all.n > 2000 && c.sc.all.below >= 0 && c.sc.all.below <= c.sc.all.n);
  assert.ok(c.facilities.length >= 3 && c.facilities.every(f => f.key && f.a && f.b));
  assert.ok(c.facilities.find(f => f.key === '111209-111212-1').located);
  // Python and JS parse the same facility key
  assert.equal(parseFacility('111212 MASHPEE_136   115  111209 HATCHVILLE    115  1  ').key, '111209-111212-1');
  assert.ok(c.map.lines.some(l => l[6] === true), 'a limiting facility is drawn on the map');
  assert.ok(c.upgrades.every(u => u.mi <= 50) && c.retirements.every(r => r.mi <= 50));
  assert.equal(c.older.envelope['summer_peak|discharge'], 260.4);
});

test('constraints: association rule and the exact identity where a unit is hosted', { skip: !up }, async () => {
  const k = await getJson(`${U}/constraints/111209`);
  const p = k.periods.find(x => x.key === 'pcr2040');
  assert.ok(p.held && p.rows.length);
  const r = p.rows.find(x => x.assoc != null);
  assert.ok(Math.abs((r.mcc_on - r.mcc_off) * r.hours / p.hours - r.assoc) < 1e-9);
  const e = await getJson(`${U}/constraints/116045`);
  const q = e.periods.find(x => x.key === 'pcr2040');
  assert.equal(q.exact, true);
  assert.ok(Math.abs(q.contrib_total - q.mcc) < 1e-3, `Σ contrib ${q.contrib_total} vs MCC ${q.mcc}`);
});

test('curtailment: study sizes, untested = null never 0; unknown bus → 404', { skip: !up }, async () => {
  const c = await getJson(`${U}/curtailment/111209`);
  assert.deepEqual(c.study.map(s => s.mw), [100, 250, 500]);
  const s500 = c.study.find(s => s.mw === 500);
  assert.ok(Math.abs(s500.pct - 43.3768707) < 1e-6);
  for (const s of c.study) if (!s.tested) assert.equal(s.pct, null);
  assert.equal((await getJson(`${U}/curtailment/999999999`)).status, 404);
});
