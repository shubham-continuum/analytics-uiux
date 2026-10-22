// L4 LMP Continuum module (views/continuum.js + vendor/live/continuum/): no browser, no :5034. The vendored ext/59 api
// client runs in a vm against recorded responses (tests/fixtures/continuum/, copied from the live Studio's own recorded
// fixtures) served at the One Studio proxy path; ext/60 is a stub here (its DOM paint is the smoke's job).
// Provenance: Claude Opus 5.5 (builder C-continuum) · one-studio/design/14 lift plan, slice L4 · 2026-10-13 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONT_API, CONT_HOURS_API, CONT_FILES, scopeFor, ctxFromHash, stateFor, hashFor, bannerFor, mount } from '../views/continuum.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FX = path.join(APP, 'tests', 'fixtures', 'continuum');
const PIN = path.join(APP, '..', 'app-tools', 'live-snapshot', '2026-10-11', 'ext');
const read = p => readFileSync(p, 'utf8');
const sha = b => createHash('sha256').update(b).digest('hex');
const fx = f => JSON.parse(read(path.join(FX, f)));
const INDEX = fx('index.json').routes;

// ---------- vendored set ----------
test('vendored: MANIFEST.continuum lists ext/59-64, 68 in load order, each file present, hashes match', () => {
  const m = JSON.parse(read(path.join(APP, 'vendor', 'live', 'MANIFEST.json'))).continuum;
  assert.ok(m, 'MANIFEST.json has a continuum section');
  assert.equal(m.snapshot, '2026-10-11');
  assert.deepEqual(m.order, CONT_FILES.map(f => f.split('/').pop()));
  assert.equal(m.order[0], '59-continuum-core.js'); assert.equal(m.order[1], '60-cathy.js');
  for (const n of m.order) {
    const body = readFileSync(path.join(APP, 'vendor', 'live', 'continuum', n)), src = readFileSync(path.join(PIN, n));
    assert.equal(m.files[n].source_sha256, sha(src), n); assert.equal(m.files[n].result_sha256, sha(body), n);
    if (!m.files[n].patches.length) assert.ok(body.toString('utf8').endsWith(src.toString('utf8')), `${n} verbatim`);
  }
  assert.deepEqual(m.files['60-cathy.js'].patches, ['C1-host-mount']);
  assert.deepEqual(m.files['60-cathy.css'].patches, ['C2-host-css']);
  for (const p of Object.values(m.patches)) assert.match(p.why, /Reviewed by Claude/);
});
test('vendored: CONT_FILES are served paths under vendor/live/continuum/ (never the dark top-level copies)', () => {
  for (const f of CONT_FILES) { assert.match(f, /^vendor\/live\/continuum\/[0-9]{2}-[a-z-]+\.(js|css)$/); assert.ok(existsSync(path.join(APP, f)), f); }
});
test('C1: with a host set, ext/60 paints into it, marks it (not #app), installs no tab and leaves the map dock', () => {
  const s = read(path.join(APP, 'vendor', 'live', 'continuum', '60-cathy.js'));
  assert.match(s, /function mountPoint\(\) \{\n {4}if \(window\.GSX_CONTINUUM_HOST\) return window\.GSX_CONTINUUM_HOST;/);
  assert.equal((s.match(/const app = window\.GSX_CONTINUUM_HOST \|\| document\.getElementById\('app'\); if \(app\) app\.classList\.(add|remove)\('gsc-on'\)/g) || []).length, 2);
  assert.doesNotMatch(s, /const app = document\.getElementById\('app'\); if \(app\) app\.classList/);
  assert.match(s, /function installTab\(\) \{\n {4}if \(window\.GSX_CONTINUUM_HOST\) return;/);
  assert.match(s, /GSFrame\.sizes && !window\.GSX_CONTINUUM_HOST\)/);
});
test('CSS: every vendored Continuum rule is Continuum-owned, or an #app rule that needs gsc-on / a gsf-* class or sets only tokens', () => {
  const own = /^(#gsc-|\.gsc|\.htl-|\.csh-|\.gscv-|\.em-|\[data-em-panel\]|\[data-gsc|\[data-gscv|\.gsx-cont\.gsc-on|#gsc-root|svg\.csh|\.gsf-tabs button\[data-gsf-module="cathy"\])/;
  const bad = [];
  for (const f of CONT_FILES.filter(x => x.endsWith('.css'))) {
    const css = read(path.join(APP, f)).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      for (let sel of m[1].split(',')) {
        sel = sel.trim(); if (!sel || /^(from|to|\d+%)$/.test(sel)) continue;
        if (own.test(sel)) continue;
        if (/^#app(\.gsc-on|\.gsf-[a-z-]+(\.gsc-on)?|:not\(\.gsf-docked\)\.gsc-on)\b/.test(sel)) continue;  // never true in One Studio's stage mode (C1)
        if (sel === '#app' && body.split(';').map(x => x.trim()).filter(Boolean).every(d => d.startsWith('--'))) continue;  // tokens only
        bad.push(`${f}: ${sel}`);
      }
    }
  }
  assert.deepEqual(bad, []);
  assert.match(read(path.join(APP, 'vendor', 'live', 'continuum', '60-cathy.css')), /\.gsx-cont\.gsc-on > #gsc-root \{ display: grid;/);
});

// ---------- scope and hash ----------
test('scopeFor: bus wins, then zone, then the hub (key HUB unless named)', () => {
  assert.deepEqual(scopeFor({ bus: '111209', zone: 'SEMA' }), { kind: 'bus', key: 111209 });
  assert.deepEqual(scopeFor({ bus: 111403 }), { kind: 'bus', key: 111403 });
  assert.deepEqual(scopeFor({ bus: 'abc', zone: 'SEMA' }), { kind: 'zone', key: 'SEMA' });
  assert.deepEqual(scopeFor({}), { kind: 'hub', key: 'HUB' });
  assert.deepEqual(scopeFor({ hub: 'HUB' }), { kind: 'hub', key: 'HUB' });
  assert.deepEqual(scopeFor(null), { kind: 'hub', key: 'HUB' });
});
test('ctxFromHash reads case/hz/hist through studiohash (invalid values are null, never a default)', () => {
  assert.deepEqual(ctxFromHash('#v=stage&case=sh&hz=2035&hist=2024&bus=111209'), { caseKey: 'sh', hz: 2035, hist: 2024 });
  assert.deepEqual(ctxFromHash('case=zz&hz=2031&hist=1999'), { caseKey: null, hz: null, hist: null });
  assert.deepEqual(ctxFromHash(''), { caseKey: null, hz: null, hist: null });
  assert.deepEqual(ctxFromHash({ caseKey: 'll', hz: 2050, hist: 2025 }), { caseKey: 'll', hz: 2050, hist: 2025 });
});
test('stateFor: ctx -> the Continuum state (scope, focus year = hz, settled hourly year = hist)', () => {
  assert.deepEqual(stateFor({ bus: 111209, hz: 2040, hist: 2024 }), { scopeKind: 'bus', scopeKey: 111209, year: 2040, hourYear: 2024 });
  assert.deepEqual(stateFor({ zone: 'CT', hz: 2031, hist: 2030 }), { scopeKind: 'zone', scopeKey: 'CT', year: null, hourYear: null });
});
test('hashFor: the Continuum state -> case/hz/hist to write (returned, never written); case passes through', () => {
  assert.deepEqual(hashFor({ year: 2045, hourYear: 2023 }, { caseKey: 'sp', hz: 2030, hist: 2025 }), { case: 'sp', hz: 2045, hist: 2023 });
  assert.deepEqual(hashFor({ year: null, hourYear: null }, { caseKey: null, hz: 2035, hist: 2025 }), { case: null, hz: 2035, hist: 2025 });
  assert.deepEqual(hashFor({ year: 2031, hourYear: 2099 }, {}), { case: null, hz: null, hist: null });
  const ctx = { bus: 1, caseKey: 'sh', hz: 2040, hist: 2022 };
  const st = stateFor(ctx); assert.deepEqual(hashFor(st, ctx), { case: 'sh', hz: 2040, hist: 2022 });   // round trip
});
test('views/continuum.js never writes the URL hash (studiohash.js is the only writer)', () => {
  const s = read(path.join(APP, 'views', 'continuum.js'));
  assert.doesNotMatch(s, /location\.hash\s*=|history\.(replaceState|pushState)|location\.replace/);
});

// ---------- the pinned ext/59 api client against recorded responses at the proxy path ----------
function fakeFetch(calls, mode) {
  return async url => {
    calls.push(url);
    if (mode === 'offline') throw new TypeError('Failed to fetch');
    assert.ok(url.startsWith(CONT_API + '/api/v2/'), `request goes through the proxy: ${url}`);
    const key = url.slice(CONT_API.length);
    const f = mode === 'down' ? fx('proxy_502_down.json') : INDEX[key] ? fx(INDEX[key].file) : null;
    const status = f ? f.status : 404, body = f ? JSON.stringify(f.body) : '';
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
}
function sandbox(mode, calls = []) {
  const store = new Map(), L = {};
  const win = {
    GSX_CONTINUUM_API: CONT_API, fetch: fakeFetch(calls, mode), console, setTimeout, clearTimeout, URLSearchParams, AbortController,
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener: (n, f) => (L[n] = L[n] || []).push(f), removeEventListener: (n, f) => { L[n] = (L[n] || []).filter(x => x !== f); },
    dispatchEvent: ev => { (L[ev.type] || []).slice().forEach(f => f(ev)); return true; },
  };
  win.window = win;
  vm.createContext(win);
  return { win, calls, run: f => vm.runInContext(read(path.join(APP, 'vendor', 'live', 'continuum', f)), win, { filename: f }) };
}
test('ext/59 api client at the proxy: registry, status and a bus series come back ok from the recorded shapes', async () => {
  const { win, calls, run } = sandbox('ok'); run('59-continuum-core.js');
  const api = win.GSContinuum.api;
  assert.equal(api.base(), CONT_API);
  const reg = await api.scenarios();
  assert.equal(reg.state, 'ok'); assert.ok(reg.body.scenarios.length >= 1); assert.ok(reg.body.base_plan['2030']);
  const st = await api.status(); assert.equal(st.state, 'ok'); assert.ok(Array.isArray(st.body.constraint_periods));
  const an = await api.scenariosAnnual({ bus: 111209 });
  assert.equal(an.state, 'ok'); assert.equal(an.url, `${CONT_API}/api/v2/scenarios/annual?bus=111209&market=RT&measure=lmp`);
  assert.equal(String(an.body.bus), '111209');
  const bad = await api.capture({ bus: 'nowhere' }); assert.equal(bad.state, 'bad-request'); assert.equal(bad.field, 'bus');
  assert.ok(calls.every(u => u.startsWith(CONT_API + '/api/v2/')));
});
test('bannerFor: ok -> none; proxy 502 -> "Continuum service not running" with the target; offline; not an allowed route', async () => {
  assert.equal(bannerFor({ ok: true, state: 'ok' }), null);
  const down = sandbox('down'); down.run('59-continuum-core.js');
  const r = await down.win.GSContinuum.api.status({ fresh: true });
  assert.equal(r.state, 'server-error'); assert.equal(r.status, 502);
  const b = bannerFor(r);
  assert.equal(b.kind, 'down'); assert.equal(b.title, 'Continuum service not running'); assert.match(b.detail, /127\.0\.0\.1:5034/);
  const off = sandbox('offline'); off.run('59-continuum-core.js');
  const o = await off.win.GSContinuum.api.status({ fresh: true });
  assert.equal(o.state, 'offline'); assert.equal(bannerFor(o).kind, 'offline'); assert.equal(off.calls.length, 3);
  const nr = fx('proxy_404_route.json');
  assert.equal(bannerFor({ ok: false, state: 'not-found', status: 404, body: nr.body, why: nr.body.error }).kind, 'error');
  assert.equal(bannerFor({ ok: false, state: 'server-error', status: 504, body: { error: 'Continuum service timed out' } }).title, 'Continuum service timed out');
});

// ---------- mount (fake DOM; real ext/59, stub ext/60) ----------
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.L = {}; this._html = ''; this.hidden = false; this.className = ''; this.style = {};
    const cl = new Set(); this.classList = { add: (...c) => c.forEach(x => cl.add(x)), remove: (...c) => c.forEach(x => cl.delete(x)), contains: c => cl.has(c) || this.className.split(/\s+/).includes(c) }; }
  appendChild(c) { if (c.parentNode) c.remove(); this.children.push(c); c.parentNode = this; return c; }
  insertBefore(c, ref) { if (c.parentNode) c.remove(); const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); c.parentNode = this; return c; }
  remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter(x => x !== this); this.parentNode = null; } }
  get firstChild() { return this.children[0] || null; }
  setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k] ?? null; }
  set innerHTML(v) { this._html = String(v); this.children = []; } get innerHTML() { return this._html; }
  set textContent(v) { this._html = String(v); this.children = []; } get textContent() { return this._html; }
  addEventListener(n, f) { (this.L[n] = this.L[n] || []).push(f); }
  fire(n, target) { (this.L[n] || []).forEach(f => f({ type: n, target: target || this })); }
}
function stage(mode) {
  const sb = sandbox(mode); sb.run('59-continuum-core.js');
  const doc = { createElement: t => new El(t) };
  sb.win.App = { H() {} }; sb.win.GS = { fmt: {} }; sb.win.Views = {};
  const ST = { scopeKind: 'hub', scopeKey: 'HUB', year: null, hourYear: null };
  const log = [];
  let loads = 0;
  const load = async () => {
    loads++;
    sb.win.GSCathy = { state: ST, get on() { return log.includes('open'); },
      open() { log.push('open'); const h = sb.win.GSX_CONTINUUM_HOST; const r = new El('div'); r.id = 'gsc-root'; h.appendChild(r); ST.scopeKind = 'bus'; ST.scopeKey = 999; /* followOption moved it */ },
      paint() { log.push('paint'); }, close() { log.push('close'); } };
  };
  return { ...sb, doc, ST, log, load, get loads() { return loads; } };
}
test('mount: sets the proxy API, paints into its own .gsx-cont box scoped to ctx, connects live, no banner when :5034 answers', async () => {
  const s = stage('ok'), host = new El('div');
  const h = await mount(host, { bus: 111209, hz: 2035, hist: 2024, caseKey: 'sh' }, { win: s.win, doc: s.doc, load: s.load });
  assert.equal(s.win.GSX_CONTINUUM_API, CONT_API); assert.equal(s.win.GSX_HOURS_API, CONT_HOURS_API);
  const box = host.children[0];
  assert.ok(box.classList.contains('gsx-cont')); assert.equal(s.win.GSX_CONTINUUM_HOST, box);
  assert.ok(box.children.some(c => c.id === 'gsc-root'), 'ext/60 painted into the box');
  assert.equal(s.ST.scopeKind, 'bus'); assert.equal(s.ST.scopeKey, 111209, 'ctx scope wins over the option follow');
  assert.equal(s.ST.year, 2035); assert.equal(s.ST.hourYear, 2024);
  assert.ok(s.log.includes('open')); assert.equal(h.banner, null);
  assert.equal(s.win.GSContinuum.live.state, 'on');
  assert.deepEqual(h.hash(), { case: 'sh', hz: 2035, hist: 2024 });
  assert.deepEqual(h.scope, { kind: 'bus', key: 111209 });
});
test('mount: proxy 502 -> a banner above the painted Continuum (never a blank screen); Retry re-probes', async () => {
  const s = stage('down'), host = new El('div');
  const h = await mount(host, { zone: 'SEMA' }, { win: s.win, doc: s.doc, load: s.load });
  const box = host.children[0], ban = box.children.find(c => c.classList.contains('gsx-cont-banner'));
  assert.ok(ban && !ban.hidden, 'banner shown');
  assert.match(ban.innerHTML, /Continuum service not running/); assert.match(ban.innerHTML, /data-gsx-cont-retry/);
  assert.ok(box.children.some(c => c.id === 'gsc-root'), 'the Continuum still painted under the banner');
  assert.equal(h.banner.kind, 'down');
  assert.notEqual(s.win.GSContinuum.live.state, 'on');
  const n = s.calls.length;
  await h.retry();
  assert.ok(s.calls.length > n, 'retry asked the proxy again');
});
test('mount: loads the vendored files once; a second mount re-scopes and repaints; hash changes reach ctx.onHash', async () => {
  const s = stage('ok'), host = new El('div'), seen = [];
  const ctx = { bus: 111209, hz: 2030, hist: 2025, caseKey: 'sp', onHash: x => seen.push(x) };
  const h1 = await mount(host, ctx, { win: s.win, doc: s.doc, load: s.load });
  const h2 = await mount(host, { ...ctx, bus: 111403 }, { win: s.win, doc: s.doc, load: s.load });
  assert.equal(s.loads, 1); assert.equal(host.children.length, 1, 'one box per host');
  assert.equal(s.ST.scopeKey, 111403); assert.ok(s.log.filter(x => x === 'paint').length >= 1);
  s.ST.year = 2045; host.children[0].fire('change'); await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(seen.at(-1), { case: 'sp', hz: 2045, hist: 2025 });
  h2.unmount(); assert.ok(s.log.includes('close')); assert.equal(host.children.length, 0);
  assert.equal(h1.box, h2.box);
});
test('mount: waits for the bridge (App/GS) with a loading banner, then mounts on gsbridge:ready', async () => {
  const s = stage('ok'), host = new El('div');
  delete s.win.App; delete s.win.GS;
  const p = mount(host, { bus: 111209 }, { win: s.win, doc: s.doc, load: s.load });
  await new Promise(r => setTimeout(r, 5));
  const box = host.children[0], ban = box.children.find(c => c.classList.contains('gsx-cont-banner'));
  assert.match(ban.innerHTML, /Waiting for the Studio data/); assert.equal(s.loads, 0);
  s.win.App = { H() {} }; s.win.GS = { fmt: {} }; s.win.dispatchEvent({ type: 'gsbridge:ready' });
  const h = await p; assert.equal(s.loads, 1); assert.equal(h.banner, null); assert.ok(ban.hidden);
});
test('mount: the module failing to start is a banner, not a throw', async () => {
  const s = stage('ok'), host = new El('div');
  const h = await mount(host, { bus: 1 }, { win: s.win, doc: s.doc, load: async () => { throw new Error('script 60-cathy.js failed to load'); } });
  assert.equal(h.banner.kind, 'error'); assert.match(h.box.children[0].innerHTML, /60-cathy\.js failed to load/);
});
