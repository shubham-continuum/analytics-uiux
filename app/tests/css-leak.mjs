// fix-3: the Continuum visit issues proxy GETs; never a daily instance (:8103-:8106, whose proxy reaches the real :5034) and
// never the env.json default base. GS_BASE set -> that server (a daily port is refused before any request); unset -> this
// script starts its own `server.py --port 0` with a fake Continuum/export service (tests/fake-continuum.mjs), stopped by PID.
import { pwRequire } from './env.mjs';
import { startFakeContinuum } from './fake-continuum.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DAILY = new Set([8103, 8104, 8105, 8106, 5034]);
const portOf = u => { try { const x = new URL(u); return Number(x.port || (x.protocol === 'https:' ? 443 : 80)); } catch { return null; } };
let BASE = (process.env.GS_BASE || '').replace(/\/$/, ''), own = null, fakeSvc = null;
if (BASE && (portOf(BASE) == null || DAILY.has(portOf(BASE)))) { console.error(`css-leak: GS_BASE ${BASE} refused: never a daily instance (:8103-:8106) or :5034; unset GS_BASE to start an own --port 0 server`); process.exit(2); }
if (process.argv.includes('--refuse-only')) { console.log(`css-leak: GS_BASE ${BASE || '(own server)'} accepted (--refuse-only: nothing run)`); process.exit(0); }
if (!BASE) {
  const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const DB = process.env.GS_DB || path.join(APP, '..', '..', 'unified', 'ISONE_GridSense_unified.duckdb');
  fakeSvc = await startFakeContinuum();
  own = spawn(process.env.PYTHON || 'python', ['-u', 'server.py', '--port', '0', '--db', DB, '--export-target', `127.0.0.1:${fakeSvc.port}`, '--continuum-target', `127.0.0.1:${fakeSvc.port}`], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; own.stdout.on('data', d => { log += d; }); own.stderr.on('data', d => { log += d; });
  process.on('exit', () => { try { own.kill(); } catch { /* gone */ } });  // by PID: the child this script started
  for (const t0 = Date.now(); !BASE; await new Promise(r => setTimeout(r, 200))) {
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(log); if (m) BASE = `http://127.0.0.1:${m[1]}`;
    if (!BASE && (own.exitCode != null || Date.now() - t0 > 90000)) { console.error(`css-leak: own server did not start\n${log}`); process.exit(2); }
  }
  console.log(`css-leak: own server ${BASE} (pid ${own.pid}) · fake Continuum :${fakeSvc.port}`);
}
// Leak detector: does the live Studio stylesheet (studio/studio.css) change the LAYOUT of preview content?
// For each stage, every element inside .gsx-an (analyzer body) is measured with the live sheet on and off; any
// difference in layout properties is a leak (colours are excluded: the live tokens are meant to apply).
// fix-2 (plan 14 §2 item 6): every LIFTED sheet (vendor/live/**, views/configurator-host.css, views/project-inputs.css and the
// Continuum <link data-gsx-cont> sheets) gets its own baseline: that sheet off vs on, measured over .gsx-an and the chrome,
// skipping only the sheet's own scope (.gsx-cfg / .gsx-pi / [data-gsx=continuum]). The Continuum tab is visited first so its
// sheets (never unmounted) are live while the 7 stages are measured. A built-in self-test injects a known leaking lifted rule
// and fails the run if it is not reported. --inject-leak keeps that rule in for every stage (the run must then exit 1).
// Usage: node tests/css-leak.mjs [--inject-leak] [stage ...]   (own --port 0 server + fake; or GS_BASE=<a --port 0 test server>)
const require = pwRequire;
const { chromium } = require('playwright');
const argv = process.argv.slice(2).filter(a => a !== '--refuse-only'), INJECT = argv.includes('--inject-leak'), args = argv.filter(a => a !== '--inject-leak');
const stages = args.length ? args : ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision'];
const LEAK_RULE = '.gsx-an section{padding-left:40px !important}';
// One lifted sheet off vs on → {sheets, leaks:[{file, tag, cls, d}]}. A sheet's own scope is where it is meant to apply.
const liftedPass = ([props, inject]) => {
  const SCOPE = { 'configurator-host.css': '.gsx-cfg', 'project-inputs.css': '.gsx-pi' }, CONT = '[data-gsx="continuum"]';
  if (inject) { const st = document.createElement('style'); st.setAttribute('data-gsx-cont', 'selftest-leak.css'); st.setAttribute('data-gsx-selftest', '1'); st.textContent = inject; document.head.appendChild(st); }
  const file = s => s.ownerNode?.getAttribute?.('data-gsx-cont') || (s.href || '').split('?')[0].split('/').pop();
  const lifted = [...document.styleSheets].filter(s => /\/vendor\/live\/|\/views\/configurator-host\.css|\/views\/project-inputs\.css/.test(s.href || '') || s.ownerNode?.hasAttribute?.('data-gsx-cont'));
  const els = [...document.querySelectorAll('.gsx-an *, .hdr *, #gsf-stages *')].filter(e => (!e.closest('svg') || e.tagName === 'svg') && !['STYLE', 'TEMPLATE', 'OPTION', 'SCRIPT', 'LINK'].includes(e.tagName)).slice(0, 6000);
  const snap = () => els.map(e => { const c = getComputedStyle(e); return props.map(k => c[k]); });
  const out = [];
  for (const sh of lifted) {
    const f = file(sh), own = SCOPE[f] || (sh.ownerNode?.hasAttribute?.('data-gsx-cont') && !sh.ownerNode.hasAttribute('data-gsx-selftest') ? CONT : null);
    const on = snap(); sh.disabled = true; const off = snap(); sh.disabled = false;
    els.forEach((e, i) => {
      if (own && e.closest(own)) return;
      const d = props.filter((k, j) => on[i][j] !== off[i][j]);
      if (d.length) out.push({ file: f, tag: e.tagName.toLowerCase(), cls: (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).slice(0, 3).join('.') || e.tagName.toLowerCase(), d: d.map(k => `${k}:${off[i][props.indexOf(k)]}→${on[i][props.indexOf(k)]}`).join(' ') });
    });
  }
  document.querySelectorAll('style[data-gsx-selftest]').forEach(x => x.remove());
  return { sheets: lifted.map(file), leaks: out };
};
// Structural properties only: the live board's type scale (font size, line height) and card radius are meant to apply.
const PROPS = ['display', 'position', 'flexDirection', 'gap', 'paddingTop', 'paddingLeft', 'marginTop', 'marginLeft', 'borderTopWidth', 'borderLeftWidth', 'textTransform', 'whiteSpace', 'textAlign', 'float', 'listStyleType', 'visibility'];
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
let total = 0, selfTest = null, contOk = false;
const byClass = new Map(), byLifted = new Map(), liftedSeen = new Set();
// the Continuum tab once, so its lifted sheets are loaded (they are never unmounted) while the stages are measured
await p.goto(`${BASE}/analytics-analyzer-studio.html#v=continuum&bus=111403`);
contOk = await p.waitForSelector('[data-gsx="continuum"]', { timeout: 60000 }).then(() => p.waitForFunction(() => { const L = [...document.querySelectorAll('link[data-gsx-cont]')]; return L.length >= 6 && L.every(l => l.sheet); }, null, { timeout: 60000 })).then(() => true, () => false);
for (const st of stages) {
  await p.goto(`${BASE}/analytics-analyzer-studio.html#stage=${st}&bus=111403&depth=study`); await p.waitForTimeout(9000);
  if (selfTest === null) { const t = await p.evaluate(liftedPass, [PROPS, LEAK_RULE]); selfTest = t.leaks.some(l => l.file === 'selftest-leak.css' && /paddingLeft/.test(l.d)); }
  const lp = await p.evaluate(liftedPass, [PROPS, INJECT ? LEAK_RULE : null]);
  for (const f of lp.sheets) if (f) liftedSeen.add(f);
  total += lp.leaks.length;
  for (const l of lp.leaks) { const k = `${l.file} ${l.tag}.${l.cls}`; if (!byLifted.has(k)) byLifted.set(k, { n: 0, d: l.d, stages: new Set() }); const x = byLifted.get(k); x.n++; x.stages.add(st); }
  const leaks = await p.evaluate(props => {
    const els = [...document.querySelectorAll('.gsx-an *')].filter(e => !e.closest('svg') || e.tagName === 'svg').slice(0, 4000);
    const snap = () => els.map(e => { const c = getComputedStyle(e); return props.map(k => c[k]); });
    const on = snap();
    const sheet = [...document.styleSheets].find(s => (s.href || '').includes('studio/studio.css'));
    // Baseline = the live sheet off, but its tokens and body type kept: inherited sizes and var()-based values are meant to apply.
    const names = new Set(); for (const r of sheet.cssRules) { if (r.style) for (const n of r.style) if (n.startsWith('--')) names.add(n); }
    const rootCs = getComputedStyle(document.documentElement), bodyCs = getComputedStyle(document.body);
    const vars = [...names].map(n => `${n}:${rootCs.getPropertyValue(n)}`).join(';');
    const base = document.createElement('style'); base.textContent = `html{${vars}} body{font-family:${bodyCs.fontFamily};font-size:${bodyCs.fontSize};line-height:${bodyCs.lineHeight};color:${bodyCs.color}}`;
    // Measured at the same width (2026-10-23): with the live sheet off the frame's docks fall away and the board widens
    // (~500 → ~1,400 px at 1440), which flips any layout that follows the board's width (the map views' container
    // queries): a different width, not the live sheet's rules. The analyzer body is held at its width while it is off.
    const an = document.querySelector('.gsx-an'), anW = an ? an.getBoundingClientRect().width : 0, anPin = an ? an.style.width : '';
    sheet.disabled = true; document.head.appendChild(base); if (an) an.style.width = `${anW}px`; const off = snap(); if (an) an.style.width = anPin; base.remove(); sheet.disabled = false;
    const out = [];
    els.forEach((e, i) => {
      let d = props.filter((k, j) => on[i][j] !== off[i][j] && !(k === 'width' || k === 'height'));
      if (e.tagName === 'STYLE' || e.tagName === 'TEMPLATE' || e.tagName === 'OPTION') return;
      // Elements the shell deliberately gives live classes (card tools, provenance badges) are meant to take live styling.
      if (e.closest('.w-tools, .w-badges') || e.parentElement?.matches('.w-h')) return;
      // The first block of a tab panel sits flush (live board spacing); an svg directly in a div lays out the same as block.
      if (e.parentElement?.matches('[role="tabpanel"]') && ![...e.parentElement.children].slice(0, [...e.parentElement.children].indexOf(e)).some(x => !['STYLE', 'TEMPLATE'].includes(x.tagName))) { const q = d.indexOf('marginTop'); if (q >= 0) d.splice(q, 1); }
      if (e.tagName === 'svg' && e.parentElement?.tagName === 'DIV') { const q = d.indexOf('display'); if (q >= 0) d.splice(q, 1); }
      // Children of a live-classed card follow the live card spacing (margins), by design.
      if (e.parentElement?.closest('section.w')) { for (const k of ['marginTop']) { const q = d.indexOf(k); if (q >= 0) d.splice(q, 1); } }
      // gap / flex-direction only matter on flex or grid boxes.
      const disp = on[i][props.indexOf('display')];
      for (const k of ['gap', 'flexDirection']) { const j = d.indexOf(k); if (j >= 0 && !/flex|grid/.test(disp) || (k === 'flexDirection' && j >= 0 && /grid/.test(disp))) d.splice(d.indexOf(k), 1); }
      // Sub-pixel type-scale margins (13px body → 12.5px board) are the live scale, not a leak.
      for (const k of ['marginTop', 'marginLeft']) { const j = props.indexOf(k), q = d.indexOf(k); if (q >= 0 && Math.abs(parseFloat(on[i][j]) - parseFloat(off[i][j])) <= 1) d.splice(q, 1); }
      if (d.length) out.push({ cls: (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).slice(0, 3).join('.') || e.tagName.toLowerCase(), tag: e.tagName.toLowerCase(), d: d.map(k => `${k}:${off[i][props.indexOf(k)]}→${on[i][props.indexOf(k)]}`).join(' ') });
    });
    return out;
  }, PROPS);
  total += leaks.length;
  for (const l of leaks) { const k = `${l.tag}.${l.cls}`; if (!byClass.has(k)) byClass.set(k, { n: 0, d: l.d, stages: new Set() }); const x = byClass.get(k); x.n++; x.stages.add(st); }
}
await b.close();
if (fakeSvc) await fakeSvc.close();
for (const [k, v] of [...byClass].sort((a, z) => z[1].n - a[1].n)) console.log(`LEAK ${k} ×${v.n} [${[...v.stages].join(',')}] ${v.d}`);
for (const [k, v] of [...byLifted].sort((a, z) => z[1].n - a[1].n)) { const [f, ...el] = k.split(' '); console.log(`LEAK(vendored ${f}) ${el.join(' ')} ×${v.n} [${[...v.stages].join(',')}] ${v.d}`); }
console.log(`lifted sheets measured: ${[...liftedSeen].sort().join(', ') || 'none'}`);
const need = ['configurator-host.css', '60-cathy.css', '61-hourly-timeline.css', '62-continuum-shape.css', '63-continuum-drivers.css', '64-continuum-value.css', '68-continuum-emissions.css'].filter(f => !liftedSeen.has(f));
if (!contOk) console.log('FAIL the Continuum tab did not mount with its 6 sheets: they could not be measured');
if (need.length) console.log(`FAIL lifted sheets never measured: ${need.join(', ')}`);
console.log(selfTest ? 'self-test: an injected lifted leak was reported' : 'FAIL self-test: an injected lifted leak was NOT reported');
const bad = total || !selfTest || !contOk || need.length;
console.log(total ? `${total} leaked element(s) in ${byClass.size + byLifted.size} kinds` : bad ? 'LEAK CHECK INCOMPLETE' : 'NO LEAKS');
process.exit(bad ? 1 : 0);
