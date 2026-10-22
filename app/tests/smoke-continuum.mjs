// L4 smoke (lift plan 14 §3 L4): the LMP Continuum top-level tab. Against GS_BASE (whose --continuum-target is the suite's
// fixture replay, tests/fake-continuum.mjs): the tab opens from the header, scoped to the bus in view (and the hash keeps
// v=continuum with case/hz/hist); every core screen (the six workflow tabs) draws; console errors are only the expected 404 /
// 502 resource lines; a figure equals the fake's value (the High Gas proxy factor from /api/v2/scenarios); Analytics returns
// to the stages. Then a second server.py --port 0 with a dead Continuum target: the banner shows and #gsc-root is still drawn.
// Provenance: Claude Opus 5.5 (integrator, round 1) · one-studio/design/14-lift-projects-configurator-continuum.md §3 L4 · 2026-10-13 · sign-off pending · v1
// · v2 2026-10-14 (fixer devkit-cont, L5 finding): the five not-held buses (100095, 103029, 110762, 111348, 119759) visited,
//   every screen clicked: no console error beyond the resource lines, no NaN, Drivers labels each not-held period (patch C3)
import { BASE, pwRequire } from './env.mjs';
import { fixtureBody } from './fake-continuum.mjs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// fix-1: never the daily :8105 (its proxy reaches the real :5034): only against the suite's ephemeral server + fakes
if (!process.env.GS_BASE) { console.error('run via tests/run-suite.mjs (needs GS_BASE + the fake :5034)'); process.exit(2); }
const { chromium } = pwRequire('playwright');

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = process.env.GS_DB || path.join(APP, '..', '..', 'unified', 'ISONE_GridSense_unified.duckdb');
const failures = [];
const check = (yes, text) => { if (!yes) failures.push(text); console.log(`${yes ? 'ok' : 'FAIL'} ${text}`); };
const NULL_BUSES = ['100095', '103029', '110762', '111348', '119759']; // L5: settled congestion periods not held (null net_mcc)
const BUS = '111209', SCREENS = ['Outlook', 'Drivers', 'Shape', 'Value', 'Offtake', 'Assumptions'];
const browser = await chromium.launch({ channel: 'chrome' });
const allowed = t => /Failed to load resource: the server responded with a status of (404|502|504)/.test(t);

async function openPage(base, hash) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${base}/analytics-analyzer-studio.html#${hash}`);
  return { page, errors };
}

let down = null;
try {
  // ---------- 1. service up (the fixture replay) ----------
  const { page, errors } = await openPage(BASE, `v=stage&stage=prices&bus=${BUS}`);
  await page.waitForSelector('#gsf-stages', { timeout: 60000 });
  const tab = page.locator('.hdr [data-gsx="continuum-tab"]');
  check(await tab.count() === 1, 'header: the LMP Continuum top-level tab');
  await tab.click();
  check(await page.waitForSelector('#board .gsx-cont-stage .gsx-cont', { timeout: 30000 }).then(() => true, () => false), 'the Continuum stage mounts its host');
  check(await page.waitForSelector('#gsc-root', { timeout: 150000 }).then(() => true, () => false), 'the Continuum draws (#gsc-root)');
  const h = await page.evaluate(() => location.hash);
  check(/^#v=continuum&/.test(h) && /case=sp/.test(h) && /hz=2030/.test(h) && new RegExp(`bus=${BUS}`).test(h), `hash keeps v=continuum, case, hz and the bus (${h})`);
  check(await page.waitForFunction(() => /Hatchville/.test(document.querySelector('.gsx-cont')?.innerText || ''), null, { timeout: 30000 }).then(() => true, () => false), 'scoped to the bus in view (Hatchville)');
  check(await page.locator('#gsf-stages [aria-current="step"]').count() === 0, 'no stage is current while the Continuum is open');
  check(await page.evaluate(() => document.querySelector('.gsx-cont-banner')?.hidden === true), 'service up: no banner');
  // a figure equals the fake: the High Gas proxy factor (/api/v2/scenarios)
  const hg = fixtureBody('/api/v2/scenarios').scenarios.find(s => s.id === 'high_gas');
  const want = `× ${hg.factor.toFixed(2)}`;
  const note = await page.waitForSelector('#gsc-root [data-gsc-scen-note="ok"]', { timeout: 60000 }).then(x => x.textContent(), () => '');
  check(note.includes(want) && note.includes(fixtureBody('/api/v2/scenarios').proxy_label), `scenario note shows the fake's High Gas factor "${want}" and its proxy label (${note.slice(0, 200) || "no note"})`);
  // every core screen draws
  for (const s of SCREENS) {
    const before = errors.filter(t => !allowed(t)).length;
    const b = page.locator('#gsc-root .gsc-wftab', { hasText: new RegExp(`^${s}$`) }).first();
    if (!(await b.count())) { check(false, `${s}: workflow tab present`); continue; }
    await b.click(); await page.waitForTimeout(700);
    const r = await page.evaluate(() => { const root = document.querySelector('#gsc-root'); return { len: (root?.innerText || '').length, svg: root?.querySelectorAll('svg').length || 0, on: [...root.querySelectorAll('.gsc-wftab')].find(x => x.classList.contains('on') || x.getAttribute('aria-selected') === 'true' || x.getAttribute('aria-pressed') === 'true')?.textContent.trim() } });
    check(r.len > 200 && errors.filter(t => !allowed(t)).length === before, `${s}: draws (${r.len} chars, ${r.svg} svg${r.on ? `, current "${r.on}"` : ''}), no new console error`);
  }
  // Analytics returns to the seven stages; the Continuum host is hidden
  await page.click('.hdr .nav [data-act="analytics"]');
  check(await page.waitForFunction(() => document.querySelector('#board .gsx-an') && document.querySelector('#board .gsx-cont-stage')?.hidden && /v=stage/.test(location.hash), null, { timeout: 30000 }).then(() => true, () => false), 'Analytics: back to the stage board (v=stage), Continuum hidden');
  const bad = errors.filter(t => !allowed(t));
  check(!bad.length, `console: only expected 404/502 resource lines (${bad.join(' | ') || 'none other'})`);
  await page.close();

  // ---------- 1b. not-held periods (L5 note): buses whose settled congestion periods the server does not hold ----------
  // The fake replays their recorded congestion-by-constraint answers (net_mcc null, the reason in not_held). Every workflow
  // screen is clicked: no console error other than the expected 404/502 resource lines, no "NaN" in any drawn attribute or
  // text, and the Drivers chart labels each not-held period "not held" (a gap, never a 0 bar).
  for (const nb of NULL_BUSES) {
    const q = await openPage(BASE, `v=continuum&stage=prices&bus=${nb}`);
    const drew = await q.page.waitForSelector('#gsc-root', { timeout: 150000 }).then(() => true, () => false);
    if (!drew) { check(false, `bus ${nb}: #gsc-root drew`); await q.page.close(); continue; }
    await q.page.waitForTimeout(1500);
    const nTabs = await q.page.locator('#gsc-root .gsc-wftab').count();
    let nh = 0, nan = [];
    for (let k = 0; k < nTabs; k++) {
      await q.page.locator('#gsc-root .gsc-wftab').nth(k).click().catch(e => q.errors.push(`tab ${k}: ${e.message}`));
      await q.page.waitForTimeout(900);
      const r = await q.page.evaluate(() => {
        const root = document.querySelector('#gsc-root'), bad = [];
        root.querySelectorAll('svg *').forEach(e => { for (const a of e.attributes) if (/NaN/.test(a.value)) bad.push(`<${e.tagName} ${a.name}="${a.value.slice(0, 40)}">`); });
        if (/\bNaN\b/.test(root.innerText)) bad.push('text NaN');
        return { nh: root.querySelectorAll('[data-drv-not-held]').length, bad };
      });
      nh = Math.max(nh, r.nh); nan = nan.concat(r.bad);
    }
    const held = fixtureBody(`/api/v2/continuum/congestion-by-constraint?bus=${nb}`), want = (held?.periods || []).filter(p => p.net_mcc == null).length;
    const bad = q.errors.filter(t => !allowed(t));
    check(nTabs === SCREENS.length && !bad.length && !nan.length, `bus ${nb}: ${nTabs} screens clicked, console errors ${bad.length}${bad.length ? ` (${bad.slice(0, 3).join(' | ').slice(0, 300)})` : ''}, NaN ${nan.length}${nan.length ? ` (${nan.slice(0, 3).join(' ')})` : ''}`);
    check(want > 0 && nh === want, `bus ${nb}: Drivers labels ${nh} of the fake's ${want} not-held periods "not held"`);
    await q.page.close();
  }

  // ---------- 2. service down: a server whose Continuum target answers nothing ----------
  const dead = await new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  const py = process.env.PYTHON || 'python';
  down = spawn(py, ['-u', 'server.py', '--port', '0', '--db', DB, '--export-target', `127.0.0.1:${dead}`, '--continuum-target', `127.0.0.1:${dead}`], { cwd: APP, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; down.stdout.on('data', d => { out += d; }); down.stderr.on('data', d => { out += d; });
  const t0 = Date.now(); let url = null;
  while (!url && Date.now() - t0 < 60000) { const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out); if (m) url = `http://127.0.0.1:${m[1]}`; else await new Promise(r => setTimeout(r, 200)); }
  check(!!url, `second server (dead Continuum target :${dead}) started`);
  if (url) {
    const d = await openPage(url, `v=continuum&stage=prices&bus=${BUS}`);
    await d.page.waitForFunction(() => { const b = document.querySelector('.gsx-cont-banner'); return b && !b.hidden && b.dataset.kind !== 'loading'; }, null, { timeout: 150000 }).catch(() => {});
    const ban = await d.page.evaluate(() => document.querySelector('.gsx-cont-banner')?.textContent || '');
    check(/Continuum service not running/.test(ban), `service down: banner "${ban.slice(0, 90)}"`);
    check(await d.page.locator('#gsc-root').count() === 1, 'service down: #gsc-root still drawn (not blank)');
    const bad2 = d.errors.filter(t => !allowed(t));
    check(!bad2.length, `service down console: only expected resource lines (${bad2.join(' | ') || 'none other'})`);
    await d.page.close();
  }
} catch (e) { check(false, `smoke threw: ${e.message}`); }
finally { if (down) down.kill(); } // by PID: the child this smoke started
await browser.close();
console.log(failures.length ? `${failures.length} FAILED` : 'ALL PASS');
process.exit(failures.length ? 1 : 0);
