// Page-load hot paths (smoke-mapgrid budgets: map ready ≤ 6 s): the Grid's P2 revenue columns are measured on every bus at
// the first sync (31-map-grid measureCoverage), so pfp_exp runs the clear-sky shape at 2,678 buses × every CSC interval.
// Provenance: Claude Opus 5.5 (suite-fix agent) · one-studio/design (T3, plan 14 lift, suite red after the lift) · 2026-10-14 · sign-off pending · v1
//   node --test tests/load-perf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearSky } from '../solar.js';
import { columnValue } from '../columns/revenue.js';

const RAD = Math.PI / 180;
/** The clear-sky formula as it stood before the timestamp memo (solar.js 2026-10-06), kept here as the reference. */
function reference(timestamp, lat, lon) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(String(timestamp));
  if (!m || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [y, mo, d, h] = m.slice(1).map(Number);
  const doy = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const decl = 23.44 * Math.sin(RAD * (360 / 365) * (doy - 81));
  const off = /([+-])(\d\d):(\d\d)$/.exec(String(timestamp));
  const offsetH = off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) + Number(off[3]) / 60) : -5;
  const standardHour = h - (offsetH - -5);
  const solarHour = standardHour + 0.5 + (lon - -75) / 15;
  const ha = 15 * (solarHour - 12);
  const sinEl = Math.sin(RAD * lat) * Math.sin(RAD * decl) + Math.cos(RAD * lat) * Math.cos(RAD * decl) * Math.cos(RAD * ha);
  return Math.max(0, sinEl);
}

test('clearSky is bit-identical to the reference formula (offsets, offset-less, bad stamps, bad coordinates)', () => {
  const stamps = ['2025-01-01T00:00:00-05:00', '2025-06-21T12:00:00-04:00', '2024-02-29T17:00-05:00', '2030-03-09T07', '2025-11-02T01:00:00-04:00',
    '2025-11-02T01:00:00-05:00', '2025-07-04T14:00:00+00:00', 'not a stamp', '', null, undefined, 20250101];
  for (let i = 0; i < 400; i++) stamps.push(`2025-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:${i % 2 ? '30' : '00'}${i % 3 ? '-04:00' : '-05:00'}`);
  const coords = [[41.2, -73.1], [44.9, -67.0], [42.36, -71.06], [0, 0], [NaN, -71], [42, Infinity], [null, -71], ['42', -71]];
  for (let pass = 0; pass < 2; pass++) // the second pass reads the memo
    for (const s of stamps) for (const [la, lo] of coords) assert.ok(Object.is(clearSky(s, la, lo), reference(s, la, lo)), `${s} ${la} ${lo}`);
});

test('the Grid revenue columns for 2,678 buses (solar, COD 2029) stay inside the page-load budget', () => {
  const R = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url), 'utf8'));
  const ctx = { tech: 'solar', mw: 100, cod: 2029, durationH: null, regime: 'qc', band: 'low', mricPrice: null, fca18Cso: false };
  const t0 = performance.now();
  let held = 0;
  for (let i = 0; i < 2678; i++) {
    const n = { bus_id: 100000 + i, lat: 41 + (i % 300) / 100, lon: -73.5 + (i % 400) / 100 };
    for (const id of ['cap_cod', 'pfp_exp']) if (columnValue(id, n, ctx, R).value != null) held++;
  }
  const ms = performance.now() - t0;
  assert.equal(held, 2 * 2678, 'every bus holds both columns');
  assert.ok(ms < 1500, `2,678 buses × 2 revenue columns took ${ms.toFixed(0)} ms (budget 1,500 ms: map ready is ≤ 6 s in all)`);
});

test('marketcore.percentile (binary search) equals the linear mid-rank scan, ties and ±0 included', async () => {
  const { percentile } = await import('../marketcore.js');
  const linear = (sortedVals, v, dir) => {
    if (!(typeof v === 'number' && Number.isFinite(v)) || !sortedVals.length) return null;
    let lo = 0; while (lo < sortedVals.length && sortedVals[lo] < v) lo++;
    let hi = lo; while (hi < sortedVals.length && sortedVals[hi] === v) hi++;
    const p = ((lo + hi) / 2 / sortedVals.length) * 100;
    return dir > 0 ? p : 100 - p;
  };
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = 0; t < 60; t++) {
    const n = t < 5 ? t : 1 + Math.floor(rnd() * 400);
    const vals = Array.from({ length: n }, () => (rnd() < 0.3 ? Math.round(rnd() * 5) : rnd() < 0.05 ? -0 : Number((rnd() * 200 - 50).toFixed(2)))).sort((a, b) => a - b);
    const probes = [...vals, -1e9, 1e9, 0, -0, 2.5, NaN, null, Infinity, ...Array.from({ length: 20 }, () => rnd() * 200 - 50)];
    for (const v of probes) for (const dir of [1, -1]) assert.ok(Object.is(percentile(vals, v, dir), linear(vals, v, dir)), `n=${n} v=${v} dir=${dir}`);
  }
});

// ---- charts.mountCharts: layout thrash. Each chart read its canvas width right after the previous chart wrote its SVG,
// so a board with N charts forced N full-page layouts per render, and the ResizeObserver's first notice redrew every
// chart again 80 ms later (2026-10-14 profile: 10 s of forced layout in 15 desync-style actions).
function fakeBoard(widths) {
  const L = { dirty: true, layouts: 0, writes: 0 };
  const el = () => ({ hidden: false, style: {}, setAttribute() {}, addEventListener() {}, querySelector: () => el(), innerHTML: '' });
  const hosts = widths.map((w, i) => {
    let html = '', width = w;
    const canvas = {
      hidden: false,
      get clientWidth() { if (L.dirty) { L.layouts++; L.dirty = false; } return width; },
      set innerHTML(v) { html = v; L.dirty = true; L.writes++; }, get innerHTML() { return html; },
      querySelector: () => el(),
    };
    return { isConnected: true, dataset: { chart: `c${i + 1}` }, canvas, resize: v => { width = v; L.dirty = true; }, html: () => html,
      querySelector: s => (s === '.chart-canvas' ? canvas : el()) };
  });
  return { L, hosts, root: { querySelectorAll: () => hosts } };
}

test('mountCharts lays the page out once for all charts, and the observer only redraws a chart whose width moved', async () => {
  const charts = await import('../charts.js');
  let notify = null;
  globalThis.ResizeObserver = class { constructor(cb) { notify = cb; } observe() {} disconnect() {} };
  charts.resetCharts();
  for (let i = 0; i < 6; i++) charts.barChart([{ label: 'a', value: 1 + i }, { label: 'b', value: 2 }]);
  const { L, hosts, root } = fakeBoard([500, 500, 320, 320, 640, 640]);
  charts.mountCharts(root);
  assert.equal(L.writes, 6, 'every chart drawn');
  assert.ok(L.layouts <= 1, `one layout for six charts (forced ${L.layouts})`);
  assert.match(hosts[2].html(), /width="320"/);
  const before = hosts.map(h => h.html());
  // the observer's first notice for every chart, nothing resized: no redraw
  L.writes = 0; notify(hosts.map(h => ({ target: h }))); await new Promise(r => setTimeout(r, 200));
  assert.equal(L.writes, 0, 'no redraw at an unchanged width');
  // one chart's box narrows (a scrollbar, a dock): only that chart redraws, at its new width
  hosts[4].resize(610); notify([{ target: hosts[4] }]); await new Promise(r => setTimeout(r, 200));
  assert.equal(L.writes, 1); assert.match(hosts[4].html(), /width="610"/);
  assert.deepEqual(hosts.filter((h, i) => i !== 4).map(h => h.html()), before.filter((h, i) => i !== 4));
  delete globalThis.ResizeObserver;
});

test('prices.quantile: an ascending input skips the copy-and-sort and gives the same value; unsorted and NaN inputs unchanged', async () => {
  const { quantile } = await import('../prices.js');
  const ref = (a, p) => { if (!a.length) return null; const v = [...a].sort((x, y) => x - y), i = (v.length - 1) * p, l = Math.floor(i); return v[l] + (v[Math.ceil(i)] - v[l]) * (i - l); };
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = 0; t < 40; t++) {
    const a = Array.from({ length: 1 + Math.floor(rnd() * 300) }, () => (rnd() < 0.2 ? 0 : Number((rnd() * 300 - 80).toFixed(2))));
    const s = [...a].sort((x, y) => x - y), copy = [...a];
    for (const p of [0, 0.05, 0.5, 0.95, 1]) { assert.ok(Object.is(quantile(s, p), ref(s, p))); assert.ok(Object.is(quantile(a, p), ref(a, p))); }
    assert.deepEqual(a, copy, 'the input is never sorted in place');
  }
  assert.equal(quantile([], 0.5), null);
  assert.ok(Object.is(quantile([3, NaN, 1], 0.5), ref([3, NaN, 1], 0.5)));
});
