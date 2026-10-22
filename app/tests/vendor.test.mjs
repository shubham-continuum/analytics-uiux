// vendor/live is exactly what plan/vendor_live.py produces from the pinned snapshot + reviewed patches (D-007).
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
// · v2 2026-10-13 lift plan 14 L2 (builder R-runtime): app-data.json (unwrapped data.js) + `loader` (dark files named only by their loader)
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const PY = process.env.PYTHON || 'python';
const APP = new URL('..', import.meta.url);
test('vendor/live matches the generator (never hand-edited)', () => {
  const r = spawnSync(PY, ['plan/vendor_live.py', '--check'], { cwd: APP, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
test('manifest records source, patches and result hashes; only P1/P2 patch 31-map-grid.js', () => {
  const m = JSON.parse(readFileSync(new URL('vendor/live/MANIFEST.json', APP), 'utf8'));
  assert.equal(m.decision, 'D-007 A');
  for (const f of Object.values(m.files)) { assert.match(f.source_sha256, /^[0-9a-f]{64}$/); assert.match(f.result_sha256, /^[0-9a-f]{64}$/); }
  assert.deepEqual(m.files['31-map-grid.js'].patches, ['P1-grid-not-held', 'P2-map-not-held']);
  for (const k of ['31-map-grid.css', '32-basemap.js', '32-basemap.css']) assert.deepEqual(m.files[k].patches, []);
});
test('missing grid/tooltip values read "not held" in the vendored module', () => {
  const s = readFileSync(new URL('vendor/live/31-map-grid.js', APP), 'utf8');
  assert.match(s, /if \(v == null \|\| v === ''\) return 'not held';/);
  assert.match(s, /hr == null \? 'not held' : fmt\.mw\(hr\)/);
  assert.match(s, /if \(t === 'not held'\) \{ c\.classList\.add\('nil'\)/);
});

// ---- lift plan 14 · L0 (2026-10-11): app.js sections cut by marker lines + the Continuum ext files, from the 2026-10-11 pin ----
import { readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
const PIN11 = new URL('../app-tools/live-snapshot/2026-10-11/', APP);
const sha256 = b => createHash('sha256').update(b).digest('hex');
const M = () => JSON.parse(readFileSync(new URL('vendor/live/MANIFEST.json', APP), 'utf8'));
const SECTIONS = { 'app-gs-model.js': /window\.GS\s*=/, 'app-charts.js': /window\.Charts\s*=/, 'app-project-store.ref.js': /function newProject\(\)/, 'app-configurator.js': /window\.Configurator = \{ open, asDef/ };
const EXT = ['59-continuum-core.js', '60-cathy.js', '60-cathy.css', ...['61-hourly-timeline', '62-continuum-shape', '63-continuum-drivers', '64-continuum-value', '68-continuum-emissions'].flatMap(n => [`${n}.js`, `${n}.css`])];
test('L0: manifest names both pins (relative paths) and keeps 31/32 on the 2026-10-06 pin', () => {
  const m = M();
  assert.deepEqual(m.snapshots, { '2026-10-06': 'app-tools/live-snapshot/2026-10-06', '2026-10-11': 'app-tools/live-snapshot/2026-10-11' });
  for (const k of ['31-map-grid.js', '31-map-grid.css', '32-basemap.js', '32-basemap.css']) { assert.equal(m.files[k].snapshot, '2026-10-06'); assert.equal(m.files[k].loaded, true, k); }
});
test('L0: app.js sections are cut by marker lines from the pinned src/app.js, contiguous and in source order', () => {
  const m = M(), src = readFileSync(new URL('src/app.js', PIN11)), lines = src.toString('utf8').split('\n');
  const spans = [];
  for (const [k, re] of Object.entries(SECTIONS)) {
    const f = m.files[k]; assert.ok(f, k);
    assert.equal(f.snapshot, '2026-10-11'); assert.equal(f.source, 'src/app.js'); assert.equal(f.source_sha256, sha256(src)); assert.equal(f.loaded, false, `${k} must not be loaded yet`);
    const [a, b] = f.lines; assert.ok(a >= 1 && b > a && b <= lines.length, k);
    const cut = lines.slice(a - 1, b).join('\n') + '\n';
    assert.equal(f.section_sha256, sha256(Buffer.from(cut, 'utf8')), `${k} section hash`);
    assert.ok(lines[a - 1].startsWith(f.markers.start) || lines[a].startsWith(f.markers.start), `${k} starts at its marker`);
    const body = readFileSync(new URL(`vendor/live/${k}`, APP), 'utf8');
    assert.match(body, /^\/\* VENDORED from live Studio src\/app\.js L\d+-\d+ /); assert.match(body, re, k);
    if (!f.patches.length) assert.ok(body.endsWith(cut), `${k} is the verbatim section`);
    spans.push([a, b, k]);
  }
  const byName = Object.fromEntries(spans.map(s => [s[2], s]));
  assert.equal(byName['app-gs-model.js'][1] + 1, byName['app-charts.js'][0], 'GS model runs up to the Charts header');
  assert.equal(byName['app-configurator.js'][1], lines.length - (lines.at(-1) === '' ? 1 : 0), 'Configurator runs to the end of app.js');
  assert.ok(byName['app-project-store.ref.js'][0] > byName['app-charts.js'][1] && byName['app-project-store.ref.js'][1] < byName['app-configurator.js'][0]);
});
test('L0: Continuum ext files are copied whole from the pin (header + verbatim body), not loaded yet', () => {
  const m = M();
  for (const k of EXT) {
    const f = m.files[k]; assert.ok(f, k);
    const src = readFileSync(new URL(`ext/${k}`, PIN11));
    assert.equal(f.snapshot, '2026-10-11'); assert.equal(f.source, `ext/${k}`); assert.equal(f.source_sha256, sha256(src)); assert.equal(f.loaded, false);
    const body = readFileSync(new URL(`vendor/live/${k}`, APP));
    assert.equal(f.result_sha256, sha256(body));
    if (!f.patches.length) assert.ok(body.toString('utf8').endsWith(src.toString('utf8')), `${k} verbatim`);
  }
});
test('L0: no page or module loads the not-yet-wired vendored files (they ship dark; only their named loader may name them)', () => {
  const m = M(), darkFiles = Object.entries(m.files).filter(([, f]) => !f.loaded), dark = darkFiles.map(([k]) => k.replace(/\.(ref\.)?(js|css)$/, ''));
  const loaderOf = Object.fromEntries(darkFiles.map(([k, f]) => [k.replace(/\.(ref\.)?(js|css)$/, ''), f.loader ? `./${f.loader}` : null]));
  assert.ok(dark.length >= 17);
  const roots = ['.', 'views', 'columns', 'rules', 'studio'];
  const hits = [];
  for (const r of roots) {
    let names; try { names = readdirSync(new URL(`${r}/`, APP)); } catch { continue; }
    for (const n of names) {
      if (!/\.(html|js|mjs|css)$/.test(n)) continue;
      const p = new URL(`${r}/${n}`, APP); if (!statSync(p).isFile()) continue;
      const s = readFileSync(p, 'utf8');
      for (const d of dark) if (s.includes(`vendor/live/${d}`) && loaderOf[d] !== `${r}/${n}`) hits.push(`${r}/${n} -> ${d}`);
    }
  }
  assert.deepEqual(hits, []);
});

// ---- lift plan 14 · L2 (2026-10-13): the GS model + Charts runtime (live-runtime.js) and the pinned data.js extract ----
test('L2: app-data.json is the pinned src/data.js unwrapped verbatim (prefix and `;` only), 453 columns, vintage recorded', () => {
  const f = M().files['app-data.json'], src = readFileSync(new URL('src/data.js', PIN11));
  assert.ok(f, 'app-data.json in the manifest');
  assert.equal(f.snapshot, '2026-10-11'); assert.equal(f.source, 'src/data.js'); assert.equal(f.source_sha256, sha256(src));
  assert.equal(f.unwrap, 'window.GS_DATA='); assert.deepEqual(f.patches, []);
  const s = src.toString('utf8').trimEnd(), body = readFileSync(new URL('vendor/live/app-data.json', APP));
  assert.ok(s.startsWith('window.GS_DATA=') && s.endsWith(';'));
  assert.equal(body.toString('utf8'), s.slice('window.GS_DATA='.length, -1) + '\n', 'body bytes unchanged');
  assert.equal(f.result_sha256, sha256(body));
  const D = JSON.parse(body.toString('utf8'));
  assert.equal(D.columns.length, 453); assert.equal(f.columns, 453);
  assert.equal(f.vintage, `${D.meta.source} · extract built ${D.meta.built_at}`, 'vintage is the source\'s own words');
});
test('L2: live-runtime.js is the loader of the GS model, Charts and the data; they stay dark (loaded:false) until wired', () => {
  const m = M();
  for (const k of ['app-gs-model.js', 'app-charts.js', 'app-data.json']) { assert.equal(m.files[k].loader, 'live-runtime.js', k); assert.equal(m.files[k].loaded, false, k); }
  for (const [k, f] of Object.entries(m.files)) if (!['app-gs-model.js', 'app-charts.js', 'app-data.json'].includes(k)) assert.equal(f.loader, undefined, k);
  const rt = readFileSync(new URL('live-runtime.js', APP), 'utf8');
  for (const k of ['app-gs-model.js', 'app-charts.js', 'app-data.json']) assert.ok(rt.includes(`vendor/live/${k}`), `live-runtime.js loads ${k}`);
});
