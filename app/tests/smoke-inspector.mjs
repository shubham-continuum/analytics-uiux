// M4 Inspector smoke (Playwright). Self-contained: a fake export service and two `server.py --port 0` instances (one
// forwarding to the fake, one to a dead port), output to files, never a pipe; never :5034, :8103, :8104 or :8105.
// Checks: inspector mounts in #inspector; Bus title = bus name (map/grid selection through GSFrame.selectBus, the
// bridge's click path); gate line = summary band = Decision on 3 buses; card click → Card tab with the card's own
// numbers; (i) → Card tab trace; Evidence on Queue › Cash at 150 MW cites "Sched 22 §3.4.1.1" ($800k / $300k);
// notes round-trip (escaped, schema v1, in the export); export downloads a file and the fake sees the real :5034
// request schema; a dead target gives the "Export service not running (:5034)" toast; Esc closes; 0 console errors;
// dark + light screenshots at 1280 and 1440 under tests/shots/m4/.
// Until the lead wires it (design/progress/M4.md § Lead wiring) the smoke mounts the inspector itself.
// Provenance: Claude Opus 5.5 (M4 build agent) · one-studio/design (T3, slice M4) · 2026-10-06 · sign-off pending · v1
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, mkdtempSync, openSync, closeSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pwRequire } from './env.mjs';
const { chromium } = pwRequire('playwright');

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.resolve(process.env.GS_DB || path.join(APP, '..', '..', 'unified', 'ISONE_GridSense_unified.duckdb'));
const SCRATCH = mkdtempSync(path.join(process.env.SUITE_SCRATCH || tmpdir(), 'gsone-insp-'));
const SHOTS = path.join(APP, 'tests', 'shots', 'm4'); mkdirSync(SHOTS, { recursive: true });
const PY = process.env.PYTHON || 'python';
const fails = []; let checks = 0;
const check = (c, m) => { checks++; if (!c) { fails.push(m); console.log(`FAIL ${m}`); } else console.log(`ok   ${m}`); };

// ---- fake export service: records each request, answers with a small file and a Content-Disposition ----
const hits = [];
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', d => { b += d; }); req.on('end', () => {
    let body = null; try { body = JSON.parse(b); } catch { /* recorded raw */ }
    hits.push({ url: req.url, body });
    if (req.url.endsWith('/plan')) { // the real read-only answer shape (build_siting_workbook.resolve_option dry_run)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exists: false, option_id: null, adds: { project: { name: body?.project_name, new: true }, location: { name: 'Mashpee area (Barnstable)', new: true }, option: { name: 'Mashpee 115.0 kV', bus_id: body?.bus_id, requested_mw: body?.mw } },
        message: `Adds this option to your Canvas portfolio: project “${body?.project_name}”, location “Mashpee area (Barnstable)”, option “Mashpee 115.0 kV” (${body?.mw} MW at bus ${body?.bus_id}).` }));
      return;
    }
    const name = req.url.endsWith('sced-node') ? '2026-10-06_GridSense-SCED-Node-Study-ISONE-Fake-111403-v1.xlsx' : '2026-10-06_GridSense-Siting-Assessment-ISONE-Fake-111403-v1.xlsx';
    res.writeHead(200, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename=${name}` });
    res.end(Buffer.from('PK\u0003\u0004fake-workbook'));
  });
});
await new Promise(r => fake.listen(0, '127.0.0.1', r));
const fakePort = fake.address().port;
const dead = http.createServer(); await new Promise(r => dead.listen(0, '127.0.0.1', r)); const deadPort = dead.address().port; await new Promise(r => dead.close(r));

const procs = [];
async function startServer(target, tag) {
  const log = path.join(SCRATCH, `server-${tag}.log`), fd = openSync(log, 'w');
  const p = spawn(PY, ['-u', 'server.py', '--port', '0', '--db', DB, '--export-target', target], { cwd: APP, stdio: ['ignore', fd, fd] });
  closeSync(fd); procs.push(p);
  const t0 = Date.now();
  for (;;) {
    if (p.exitCode != null) throw new Error(`server exited ${p.exitCode}:\n${readFileSync(log, 'utf8')}`);
    if (Date.now() - t0 > 60000) throw new Error(`server did not start:\n${readFileSync(log, 'utf8')}`);
    const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(readFileSync(log, 'utf8'));
    if (m) return `http://127.0.0.1:${m[1]}`;
    await new Promise(r => setTimeout(r, 200));
  }
}
const kill = () => { for (const p of procs) try { p.kill(); } catch { /* gone */ } fake.close(); };

let browser;
try {
  const [A, B] = await Promise.all([startServer(`127.0.0.1:${fakePort}`, 'fake'), startServer(`127.0.0.1:${deadPort}`, 'dead')]);
  console.log(`servers ${A} (fake export :${fakePort}) · ${B} (dead export :${deadPort})`);
  browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  async function open(base, hash, { width = 1440, theme = 'dark', fresh = true } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
    if (fresh) await ctx.addInitScript(t => { if (!sessionStorage.getItem('m4-init')) { localStorage.clear(); localStorage.setItem('gspreview.theme', t); sessionStorage.setItem('m4-init', '1'); } }, theme);
    const page = await ctx.newPage();
    // The dead-target page's one expected line: the browser logs the proxy's 502 that the toast reports.
    page.on('console', m => { if (m.type() === 'error' && !(base === B && /status of 502 \(Bad Gateway\)/.test(m.text()))) errors.push(`${base}: ${m.text()}`); });
    page.on('pageerror', e => errors.push(`${base}: ${e}`));
    await page.goto(`${base}/analytics-analyzer-studio.html#${hash}`);
    await page.waitForFunction(() => document.querySelector('#board [role="tabpanel"] section.card') && document.getElementById('inspector'), null, { timeout: 90000 });
    await page.evaluate(() => {
      if (window.__gsInspector) return;
      const s = document.createElement('script'); s.type = 'module';
      // The harness plays the lead's wiring: app.js's four exports + toast, and the map/grid meta as the host's getMeta
      // (a views/ module never reads that route itself: bridge.test ownership rule).
      s.textContent = "import { mountInspector } from './views/inspector.js'; import * as A from './app.js'; const meta = fetch('./api/x/mapgrid/meta/all').then(r => r.ok ? r.json() : null); mountInspector(document.querySelector('#inspector'), { getState: A.getState, dispatch: A.dispatch, onRender: A.onRender, getData: A.getData, toast: A.toast, getMeta: () => meta });";
      document.head.appendChild(s);
    });
    await page.waitForFunction(() => window.__gsInspector && document.querySelector('#inspector .insp'), null, { timeout: 30000 });
    return page;
  }
  const inspTab = (page, t) => page.click(`#inspector [data-insp="tab"][data-v="${t}"]`);
  const settle = page => page.waitForTimeout(400);

  // ---------- 1. Bus tab, gate line = band = Decision on 3 buses ----------
  const page = await open(A, 'stage=decision&tab=compare&bus=111403&depth=review&case=sp');
  check(!(await page.$('#inspector > .gsf-ph[data-gsf="placeholder"]')), 'the M1 placeholder is replaced by the inspector');
  await inspTab(page, 'bus');
  for (const [bus, name] of [['111403', 'Mashpee'], ['111209', 'Hatchville'], ['100178', 'Lincolnville']]) {
    await page.evaluate(b => { location.hash = `stage=decision&tab=compare&bus=${b}&depth=review&case=sp`; }, bus);
    await page.waitForFunction(b => {
      const f = [...document.querySelectorAll('.summary .facts > div')].find(d => d.querySelector('span')?.textContent === 'Decision gates');
      const ins = document.querySelector('#inspector [data-insp-gate]'), tt = document.querySelector('#inspector [data-insp-title]');
      return f && !/…/.test(f.querySelector('b').textContent) && ins && tt && document.querySelector('#inspector .insp-kick')?.textContent.includes(b);
    }, bus, { timeout: 90000 });
    await settle(page);
    // Decision's own verdict: its engine (candidateGates) on the page's live state. Decision draws the counts as a chart
    // since its 2026-10-07 rewrite, so there is no text row to read.
    const r = await page.evaluate(async () => {
      const f = [...document.querySelectorAll('.summary .facts > div')].find(d => d.querySelector('span')?.textContent === 'Decision gates').querySelector('b').textContent.trim();
      const ins = document.querySelector('#inspector [data-insp-gate]').textContent.trim();
      const [A, Dm] = await Promise.all([import('./app.js'), import('./views/decision.js')]);
      const g = Dm.candidateGates(A.getData(), A.getState()) || [];
      const pass = g.filter(x => x.verdict === 'Pass').length, fail = g.filter(x => x.verdict === 'Fail').length;
      return { band: f, ins, dec: `${pass} of ${g.length} ${g.length - pass - fail} hold · ${fail} fail`, title: document.querySelector('#inspector [data-insp-title]').textContent.trim() };
    });
    check(r.title === name, `${bus}: Bus tab title "${r.title}" = "${name}"`);
    check(r.ins === r.band, `${bus}: inspector gate line "${r.ins}" = summary band "${r.band}"`);
    const m = /(\d+) of (\d+) (\d+) hold · (\d+) fail/.exec(r.dec), v = /(?:(\d+) Fail)?(?: · )?(?:(\d+) Open)?(?: · )?(\d+) Pass(?: · (\d+) Open)? \(of (\d+)\)/.exec(r.ins);
    const ic = v && { fail: Number(v[1] || 0), hold: Number(v[2] || v[4] || 0), pass: Number(v[3]), n: Number(v[5]) };
    check(m && ic && Number(m[1]) === ic.pass && Number(m[2]) === ic.n && Number(m[3]) === ic.hold && Number(m[4]) === ic.fail, `${bus}: inspector "${r.ins}" = Decision candidateGates "${r.dec}"`);
  }

  // ---------- 2. map / grid selection → Bus tab title = bus name ----------
  await page.evaluate(() => { location.hash = 'stage=grid&bus=111403&depth=review&case=sp'; });
  const bridge = await page.waitForFunction(() => window.__gsBridgePerf?.ready && typeof window.GSFrame?.selectBus === 'function', null, { timeout: 120000 }).then(() => true, () => false);
  check(bridge, 'the map/grid bridge is ready (GSFrame.selectBus, the map and grid click path)');
  if (bridge) {
    await inspTab(page, 'evidence');
    await page.evaluate(() => window.GSFrame.selectBus(111209));
    await page.waitForFunction(() => document.querySelector('#inspector [data-insp-title]')?.textContent.trim() === 'Hatchville', null, { timeout: 60000 }).catch(() => {});
    const t = await page.evaluate(() => ({ tab: document.querySelector('#inspector .insp')?.dataset.inspTab, title: document.querySelector('#inspector [data-insp-title]')?.textContent.trim(), bus: new URLSearchParams(location.hash.slice(1)).get('bus') }));
    check(t.tab === 'bus' && t.title === 'Hatchville' && t.bus === '111209', `map/grid select 111209 → Bus tab "${t.title}" (tab ${t.tab}, url bus ${t.bus})`);
    await page.evaluate(() => window.GSFrame.selectBus(111403));
    await page.waitForFunction(() => document.querySelector('#inspector [data-insp-title]')?.textContent.trim() === 'Mashpee', null, { timeout: 60000 }).catch(() => {});
    check(await page.evaluate(() => document.querySelector('#inspector [data-insp-title]')?.textContent.trim()) === 'Mashpee', 'map/grid select 111403 → Bus tab "Mashpee"');
  }

  // ---------- 2b. D-008: a bus in meta.coverage.suspect_pnode_links carries the relinked note ----------
  const sus = await page.evaluate(async () => {
    const [m, b] = await Promise.all([fetch('./api/x/mapgrid/meta/all').then(r => r.json()), fetch('./api/buses').then(r => r.json())]);
    const ids = new Set(b.buses.map(x => x.id));
    return (m.coverage?.suspect_pnode_links?.buses || []).map(String).find(id => ids.has(id)) ?? null; // a suspect bus the picker holds
  });
  if (sus != null) {
    await inspTab(page, 'bus');
    await page.evaluate(b => { location.hash = `stage=grid&bus=${b}&depth=review&case=sp`; }, sus);
    await page.waitForFunction(b => document.querySelector('#inspector .insp-kick')?.textContent.includes(`#${b}`), sus, { timeout: 60000 }).catch(() => {});
    const note = await page.evaluate(() => document.querySelector('#inspector .insp-note.warn')?.textContent || '');
    check(/relinked \(suspect link\)/.test(note) && /D-008/.test(note), `D-008: suspect bus ${sus} shows the relinked note`);
  } else check(true, 'D-008: no suspect buses in this generation (nothing to show)');

  // ---------- 3. Queue › Cash at 150 MW: card click, (i), Evidence citation ----------
  await page.evaluate(() => { location.hash = 'stage=queue&tab=cash&bus=111403&depth=review&case=sp'; });
  await page.waitForFunction(() => document.querySelector('#board .tabs [role="tab"][aria-selected="true"]')?.dataset.v === 'cash' && document.querySelector('#board [role="tabpanel"] .kpi'), null, { timeout: 90000 });
  await page.selectOption('select[data-act="export"]', '150');
  await page.waitForFunction(() => [...document.querySelectorAll('#board [role="tabpanel"] .kpi .label')].some(l => /^(Cost to enter|Cash out at request)/.test(l.textContent.trim())), null, { timeout: 60000 });
  await settle(page);
  // the first visible card with a table: click one of its cells (a plain click on the card, not a control)
  const cell = await page.evaluateHandle(() => [...document.querySelectorAll('#board [role="tabpanel"] section.card[data-insp-key]:not([hidden]) .card-b table tbody td')].find(td => !td.closest('details.trace') && td.getClientRects().length && !td.querySelector('button, a, input, select')));
  const key = await cell.evaluate(td => td.closest('section.card').dataset.inspKey);
  await cell.asElement().scrollIntoViewIfNeeded(); await cell.asElement().click();
  await page.waitForFunction(k => document.querySelector('#inspector .insp')?.dataset.inspTab === 'card' && document.querySelector('#inspector [data-insp-card-title]'), key, { timeout: 30000 });
  await settle(page);
  const cmp = await page.evaluate(k => {
    const t = el => el.textContent.replace(/\s+/g, ' ').trim();
    const s = [...document.querySelectorAll('#board section.card[data-insp-key]')].find(x => x.dataset.inspKey === k);
    const tb = [...s.querySelectorAll('.card-b table')].filter(x => !x.closest('details.trace'))[0];
    const card = [...tb.tBodies[0].rows].slice(0, 12).map(r => [...r.cells].map(t));
    const ins = [...document.querySelectorAll('#inspector [data-insp-table="0"] tbody tr')].map(r => [...r.cells].map(t));
    const ans = s.querySelector('.card-answer'), insAns = [...document.querySelectorAll('#inspector .pv')].find(p => p.querySelector('.k')?.textContent === 'The answer');
    return { card, ins, ans: ans ? t(ans) : null, insAns: insAns ? t(insAns.querySelector('.v')) : null, title: t(document.querySelector('#inspector [data-insp-card-title]')), h3: t(s.querySelector('.card-h h3')), sel: s.classList.contains('insp-sel') };
  }, key);
  check(cmp.title === cmp.h3, `card click → Card tab title "${cmp.title}"`);
  check(cmp.sel, 'the selected card is ringed on the board');
  check(cmp.card.length > 0 && JSON.stringify(cmp.card) === JSON.stringify(cmp.ins), `Card tab shows the card's table cells (${cmp.ins.length} rows; first ${JSON.stringify(cmp.ins[0])})`);
  check(cmp.ans === cmp.insAns, `Card tab answer = the card's answer ("${(cmp.insAns || '').slice(0, 80)}")`);
  const ui = await page.evaluate(() => import('./app.js').then(A => A.getState().ui.inspect));
  check(ui?.kind === 'card' && ui.id === key && ui.stage === 'queue' && ui.tab === 'cash', `S.ui.inspect = ${JSON.stringify(ui)}`);
  // (i) → the Card tab's trace
  await inspTab(page, 'bus');
  const info = await page.$('#board [role="tabpanel"] section.card:not([hidden]) [data-act="card-trace"]');
  check(!!info, 'a card on Queue › Cash has an (i)');
  if (info) {
    const traceId = await info.getAttribute('data-v');
    await info.click();
    await page.waitForFunction(id => document.querySelector('#inspector .insp')?.dataset.inspTab === 'card' && document.querySelector(`#inspector details[data-insp-trace="${id}"]`), traceId, { timeout: 30000 }).catch(() => {});
    const tr = await page.evaluate(id => {
      const a = document.querySelector(`#inspector details[data-insp-trace="${id}"]`), b = [...document.querySelectorAll('#board details.trace[data-trace]')].find(d => d.dataset.trace === id);
      return { open: !!a?.open, same: !!a && !!b && a.querySelector('summary').textContent === b.querySelector('summary').textContent, n: a ? a.querySelectorAll('.trace-check').length : -1 };
    }, traceId);
    check(tr.open && tr.same, `(i) → Card tab shows trace ${traceId} open, same result line as the board (${tr.n} checks)`);
  }
  // Evidence
  await inspTab(page, 'evidence');
  const ev = await page.evaluate(() => {
    const d = document.querySelector('#inspector .insp-rules li.insp-derived');
    return { derived: d?.textContent.replace(/\s+/g, ' ').trim() || '', all: document.querySelector('#inspector .insp-b').textContent.replace(/\s+/g, ' '), n: document.querySelectorAll('#inspector .insp-rules li').length };
  });
  check(/Cost to enter at 150 MW/.test(ev.derived) && /\$800k total, \$300k cash/.test(ev.derived) && /Sched 22 §3\.4\.1\.1/.test(ev.derived) && /corrected/.test(ev.derived), `Evidence: "${ev.derived}"`);
  check(/ISO-NE: LMP = E \+ C \+ L/.test(ev.all) && /pcr2030/.test(ev.all), 'Evidence: sign convention and PCR run');
  check(/DB modified\s*\d{4}-\d\d-\d\d/.test(ev.all), 'Evidence: DB mtime from /health');
  check(/Map\/grid generation\s*(?!not held)\S/.test(ev.all), 'Evidence: mapgrid generation held');
  check(ev.n >= 11, `Evidence lists ${ev.n} rule rows (10 cited + cost to enter)`);

  // ---------- 4. Notes ----------
  await inspTab(page, 'notes');
  await page.fill('#inspector [data-insp="note-text"]', '<b>bold?</b> check "deposit" & tiers');
  await page.click('#inspector [data-insp="note-add"]');
  await page.waitForFunction(() => document.querySelector('#inspector .insp-notes li'), null, { timeout: 10000 });
  const nt = await page.evaluate(() => ({ text: document.querySelector('#inspector .insp-notes li p').textContent, html: document.querySelector('#inspector .insp-notes li p').innerHTML, ls: JSON.parse(localStorage.getItem('gsone.notes.v1')) }));
  check(nt.text === '<b>bold?</b> check "deposit" & tiers' && !/<b>/.test(nt.html), 'note rendered as plain text (escaped)');
  check(nt.ls?.v === 1 && nt.ls.notes['-|111403']?.[0]?.text === '<b>bold?</b> check "deposit" & tiers', 'note stored in gsone.notes.v1, schema v1, key -|111403');

  // ---------- 5. Export (fake target) ----------
  await inspTab(page, 'export');
  // Siting: /plan first, shown in the panel; Cancel sends nothing more; Confirm builds with the same body.
  {
    const n0 = hits.length;
    await page.click('#inspector [data-insp="export"][data-v="siting"]');
    await page.waitForSelector('#inspector [data-insp-plan]', { timeout: 30000 }).catch(() => {});
    const pl = await page.evaluate(() => ({ kind: document.querySelector('#inspector [data-insp-plan]')?.dataset.inspPlan, text: document.querySelector('#inspector [data-insp-plan]')?.textContent.replace(/\s+/g, ' ') || '' }));
    check(hits.length === n0 + 1 && hits[n0].url === '/api/v2/export/siting-workbook/plan', `siting: the read-only /plan is asked first (${hits.slice(n0).map(h => h.url).join(', ')})`);
    check(pl.kind === 'writes' && /adds a new option to the Canvas portfolio on :5034/.test(pl.text) && /New option: Mashpee 115\.0 kV \(150 MW at bus 111403\)/.test(pl.text), `siting plan shown in the panel: "${pl.text.slice(0, 120)}…"`);
    await page.click('#inspector [data-insp="export-cancel"]');
    await page.waitForTimeout(1500);
    check(hits.length === n0 + 1 && !(await page.$('#inspector [data-insp-plan]')), `Cancel sends nothing (fake hits ${hits.length - n0})`);
    await page.click('#inspector [data-insp="export"][data-v="siting"]');
    await page.waitForSelector('#inspector [data-insp="export-confirm"]:not([disabled])', { timeout: 30000 });
  }
  for (const kind of ['siting', 'sced']) {
    const n0 = hits.length;
    const sel = kind === 'siting' ? '#inspector [data-insp="export-confirm"]' : `#inspector [data-insp="export"][data-v="${kind}"]`;
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }).catch(() => null), page.click(sel)]);
    const name = dl?.suggestedFilename() || '';
    check(/GridSense-.*-Fake-111403-v1\.xlsx$/.test(name), `${kind}: export downloads "${name}"`);
    if (kind === 'siting') check(hits[n0 - 1]?.url === '/api/v2/export/siting-workbook/plan' && JSON.stringify(hits[n0 - 1].body) === JSON.stringify(hits[n0]?.body), 'siting: confirmed after /plan, with the same body');
    const h = hits[n0];
    check(!!h && h.url === (kind === 'sced' ? '/api/v2/export/sced-node' : '/api/v2/export/siting-workbook'), `${kind}: the proxy forwarded to ${h?.url}`);
    if (kind === 'siting' && h?.body) {
      const b = h.body;
      check(b.bus_id === 111403 && b.asset === 'solar' && b.mw === 150 && b.studio?.case === 'sp', `siting body: bus ${b.bus_id}, ${b.asset}, ${b.mw} MW, studio ${JSON.stringify(b.studio)}`);
      check(!!b.oneStudio?.generation && b.oneStudio.rulesVersion === '2026-10-06' && !!b.oneStudio.db?.mtime && b.oneStudio.notes?.[0]?.text?.includes('deposit'), `siting oneStudio: generation ${b.oneStudio?.generation}, rules ${b.oneStudio?.rulesVersion}, notes ${b.oneStudio?.notes?.length}`);
    }
    if (kind === 'sced' && h?.body) {
      const extra = Object.keys(h.body).filter(k => !['bus_id', 'asset', 'mw', 'settled_year', 'runs', 'duration_h', 'client'].includes(k));
      check(!extra.length && h.body.asset === 'solar' && h.body.mw === 150, `sced body has only :5034's keys ${JSON.stringify(h.body)}`);
    }
  }
  // ---------- 6. Esc closes ----------
  await page.focus('#inspector [data-insp="tab"][data-v="export"]');
  await page.keyboard.press('Escape');
  check(await page.evaluate(() => document.getElementById('app').classList.contains('gsf-insp-off')), 'Esc (focus in the inspector) closes the inspector dock');
  await page.evaluate(() => window.GSFrame.setDock('inspector', true));
  check(!(await page.evaluate(() => document.getElementById('app').classList.contains('gsf-insp-off'))), 'the edge tab path reopens it');

  // ---------- 7. Dead export target → toast ----------
  const pb = await open(B, 'stage=queue&tab=cash&bus=111403&depth=review&case=sp');
  await inspTab(pb, 'export');
  await pb.click('#inspector [data-insp="export"][data-v="siting"]');
  await pb.waitForFunction(() => /Export service not running/.test(document.getElementById('toast')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  const toast = await pb.evaluate(() => document.getElementById('toast').textContent);
  check(toast === 'Export service not running (:5034)', `dead target → toast "${toast}"`);
  await pb.context().close();

  // ---------- 8. Screenshots: dark + light at 1280 and 1440 ----------
  for (const theme of ['dark', 'light']) for (const width of [1280, 1440]) {
    const p = await open(A, 'stage=queue&tab=cash&bus=111403&depth=review&case=sp', { width, theme });
    await p.selectOption('select[data-act="export"]', '150'); await p.waitForTimeout(1200);
    const s = await p.evaluateHandle(() => [...document.querySelectorAll('#board [role="tabpanel"] section.card[data-insp-key]:not([hidden]) .card-b table tbody td')].find(td => !td.closest('details.trace') && td.getClientRects().length && !td.querySelector('button, a, input, select')));
    if (s.asElement()) await s.asElement().click();
    await p.waitForTimeout(800);
    await p.screenshot({ path: path.join(SHOTS, `inspector-card-${theme}-${width}.png`) });
    await inspTab(p, 'evidence'); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(SHOTS, `inspector-evidence-${theme}-${width}.png`) });
    if (width === 1440) {
      await inspTab(p, 'bus'); await p.waitForTimeout(400); await p.screenshot({ path: path.join(SHOTS, `inspector-bus-${theme}-${width}.png`) });
      await inspTab(p, 'export'); await p.waitForTimeout(400); await p.screenshot({ path: path.join(SHOTS, `inspector-export-${theme}-${width}.png`) });
      await p.click('#inspector [data-insp="export"][data-v="siting"]'); await p.waitForSelector('#inspector [data-insp-plan]', { timeout: 30000 }).catch(() => {});
      await p.screenshot({ path: path.join(SHOTS, `inspector-export-plan-${theme}-${width}.png`) });
      await p.click('#inspector [data-insp="export-cancel"]').catch(() => {});
    }
    await p.context().close();
  }
  check(!errors.length, `console errors: ${errors.slice(0, 4).join(' | ') || 'none'}`);
} catch (e) {
  fails.push(`smoke crashed: ${e.stack || e}`); console.log(e.stack || e);
} finally {
  await browser?.close(); kill();
}
console.log(`${checks} checks · fake export hits ${hits.length} · shots ${SHOTS}`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL PASS');
process.exit(fails.length ? 1 : 0);
