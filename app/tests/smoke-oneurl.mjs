import { BASE, pwRequire } from './env.mjs';
// One URL (M5, acceptance 1): 25 live-hash corpus URLs opened in One Studio. The rendered stage, depth, bus, pins, cmp,
// case and horizon must equal the live context: resolveStudioHash over the LIVE seed catalogue, which
// tests/hash-corpus.test.mjs holds equal to the live readHash oracle on all 200 URLs. Then the URL round-trips: the hash
// One Studio writes, opened fresh, renders the same context again.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
//   node tests/smoke-oneurl.mjs            the app as served
//   node tests/smoke-oneurl.mjs --wiring   verify the M5 "Lead wiring" patch: once it is applied on disk (W-A,
//                                          2026-10-07) every anchor must be gone and every replacement present exactly
//                                          once, then the run is the app as served; before that, the patch is applied
//                                          in the browser only (request interception; the file on disk is never touched)
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseStudioHash, resolveStudioHash } from '../studiohash.js';
const { chromium } = pwRequire('playwright');

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const C = JSON.parse(readFileSync(path.join(APP, 'tests', 'fixtures', 'hash-corpus.json'), 'utf8'));
const SAMPLES = JSON.parse(readFileSync(path.join(APP, 'data', 'samples.json'), 'utf8'));
const U = `${BASE}/analytics-analyzer-studio.html`;
const WIRING = process.argv.includes('--wiring');
const ids = new Set(C.catalogue.busIds);
const LIVE_CAT = { projects: C.catalogue.projects, hasBus: id => ids.has(String(id)) };
const ONE_CAT = { projects: SAMPLES.projects.map(p => ({ id: p.id, options: p.options.map(o => ({ id: String(o.id), busId: String(o.busId), status: o.status })) })), hasBus: LIVE_CAT.hasBus };

// The M5 Lead-wiring patch for app.js (also written out in design/progress/M5.md). Each pair must match exactly once.
// Pairs 1–9 are items 1–6 of M5.md § Lead wiring; pairs 10–13 are item 7 (the live link and the dead `open-live`
// action go, so `liveStudioUrl` is no longer imported). An empty replacement removes the anchor.
export const LEAD_WIRING = [
  // the live fresh-open stage is Market (live defaults()); a link with no stage, or one this app does not render, opens it
  ["  stage: 'prices', tabs: {}, nodeId: '111403',", "  stage: 'market', tabs: {}, nodeId: '111403',"],
  ["  if (h.stage && STAGES.some(s => s.key === h.stage)) S.stage = h.stage;", "  const hStage = h.stage === 'iso' ? 'market' : h.stage; // the live ISO-wide concern is the Market board here\n  if (hStage && STAGES.some(s => s.key === hStage)) S.stage = hStage;"],
  ["import { parseStudioHash, toStudioHash, liveStudioUrl, CASE_KEYS, HZ_YEARS, hzRun, caseScenario } from './studiohash.js';",
   "import { parseStudioHash, toStudioHash, CASE_KEYS, HZ_YEARS, hzRun, caseScenario, resolveStudioHash, LIVE_DEFAULTS } from './studiohash.js';"],
  ["  if (h.pins.length) S.pins = [...new Set(h.pins.map(String))].filter(id => D.index.some(n => n.id === id)).slice(0, 5);",
   "  // live: `pins=` (even empty) replaces the pins; ids are canonical digits, de-duplicated, held, first five (studiohash)\n  const pinsSeen = (h.seen || []).includes('pins');\n  const hashPins = resolveStudioHash(h, { projects: [], hasBus: id => D.index.some(n => n.id === id) }, { ...LIVE_DEFAULTS, pins: S.pins }).pins;\n  if (pinsSeen) S.pins = hashPins;"],
  ["    if (same && !h.bus) pendingHashWalk = { project: h.project, option: S.walk.option, step: S.walk.step || 0, keep: true, depth: h.depth, pins: h.pins.map(String), stage: h.step ? null : h.stage, tab: h.tab };",
   "    if (same && !h.bus) pendingHashWalk = { project: h.project, option: S.walk.option, step: S.walk.step || 0, keep: true, depth: h.depth, pins: pinsSeen ? hashPins : null, stage: h.step ? null : (h.stage === 'iso' ? 'market' : h.stage), tab: h.tab };"],
  ["    if (!same) pendingHashWalk = { project: h.project, option: h.option, step: Math.max(0, (h.step || 1) - 1), depth: h.depth, pins: h.pins.map(String), stage: h.step ? null : h.stage, tab: h.tab };",
   "    // a live link keeps what it does not name (live readHash): no depth → the current depth, not the first stop's\n    if (!same) pendingHashWalk = { project: h.project, option: h.option, step: Math.max(0, (h.step || 1) - 1), depth: h.depth || (h.step ? null : S.depth), pins: pinsSeen ? hashPins : null, stage: h.step ? null : (h.stage === 'iso' ? 'market' : h.stage), tab: h.tab, bus: h.bus };"],
  ["  if (hw.pins?.length) S.pins = hw.pins.filter(id => D.index.some(n => n.id === id)).slice(0, 5);\n}",
   "  if (hw.pins) S.pins = hw.pins.filter(id => D.index.some(n => n.id === id)).slice(0, 5);\n  // 02 hash restore: a bus that conflicts with the option opens as a preview of that bus, and says so\n  if (hw.bus && String(hw.bus) !== String(S.nodeId) && D.index.some(n => n.id === String(hw.bus))) {\n    const was = S.nodeId; S.nodeId = String(hw.bus); S.basis = null; if (busReady(S.nodeId)) resetBasisForNode();\n    toast(`Bus ${hw.bus} is not this option's bus (${was}): opened as a preview. Pick the option chip to return to it.`);\n  }\n}\n/** 02 hash restore: a project or option this workspace does not hold opens the default sample (the live fresh-open\n *  project) with the live readHash's option choice, and says so. Never silent. */\nfunction fallbackProject(hw) {\n  const has = (p, id) => p.options.some(o => o.id === id);\n  let p = SAMPLES.projects.find(x => x.id === hw.project);\n  if (!p) {\n    p = SAMPLES.projects.find(x => x.id === LIVE_DEFAULTS.project); if (!p) return;\n    toast(`Project “${hw.project}” is not in this workspace: opened ${p.name}.`); hw.project = p.id;\n    if (!has(p, hw.option)) hw.option = has(p, LIVE_DEFAULTS.option) ? LIVE_DEFAULTS.option : p.options[0].id;\n  } else if (hw.option && !has(p, hw.option)) {\n    toast(`Option “${hw.option}” is not in ${p.name}: opened its ${p.id === LIVE_DEFAULTS.project && has(p, LIVE_DEFAULTS.option) ? 'default' : 'first'} option.`);\n    hw.option = p.id === LIVE_DEFAULTS.project && has(p, LIVE_DEFAULTS.option) ? LIVE_DEFAULTS.option : p.options[0].id;\n  }\n}"],
  ["      const hw = pendingHashWalk; pendingHashWalk = null;\n",
   "      const hw = pendingHashWalk; pendingHashWalk = null;\n      if (hw) fallbackProject(hw);\n"],
  ["    const hw = pendingHashWalk;\n    if (hw && samplesState === 'ok'",
   "    const hw = pendingHashWalk;\n    if (hw && samplesState === 'ok') fallbackProject(hw);\n    if (hw && samplesState === 'ok'"],
  // item 7: no element links to :8103 (chrome.js dropped its links in M5 §3; these are app.js's)
  ["  const liveUrl = liveStudioUrl(hashNow());\n", ""],
  ["    only: !!ONLY, modal: S.ui.modal, liveUrl, busId: String(S.nodeId),", "    only: !!ONLY, modal: S.ui.modal, busId: String(S.nodeId),"],
  ['<span class="walk-where">${esc(where)}</span>${r ? `<a class="tiny-link" href="${esc(liveStudioUrl({ ...hashNow(), stage: r.stage, depth: r.depth }))}" target="_blank" rel="noopener" title="The same step in the live Studio (:8103) for a side-by-side check">live ↗</a>` : ""}${off ?',
   '<span class="walk-where">${esc(where)}</span>${off ?'],
  ["  'open-live': () => { window.open(liveStudioUrl(hashNow()), '_blank', 'noopener'); return 'no-render'; },\n", ""],
];
const count = (src, s) => src.split(s).length - 1;
export function patchApp(src) {
  src = src.replace(/\r\n/g, '\n'); // app.js is CRLF on disk; anchors are LF
  for (const [a, b] of LEAD_WIRING) {
    const n = count(src, a);
    if (n !== 1) throw new Error(`Lead-wiring anchor matched ${n}× (app.js changed?): ${a.slice(0, 90)}`);
    src = src.replace(a, () => b);
  }
  return src;
}
/** Is the patch on disk? Every anchor gone and every (non-empty) replacement present exactly once; else the list of misses. */
export function wiringApplied(src) {
  src = src.replace(/\r\n/g, '\n');
  const miss = [];
  LEAD_WIRING.forEach(([a, b], i) => {
    const inB = b ? count(b, a) : 0; // a replacement may contain its own anchor (pairs 8 and 9 add a line after it)
    if (count(src, a) !== inB) miss.push(`pair ${i + 1}: anchor present ${count(src, a)}× (want ${inB})`);
    if (b && count(src, b) !== 1) miss.push(`pair ${i + 1}: replacement present ${count(src, b)}× (want 1)`);
  });
  return { applied: !miss.length, miss };
}

// ---------- the 25 URLs: the edge cases that matter for a link, then generated ones ----------
const WANT = ['acceptance-1', 'missing-keys', 'project-switch', 'unknown-project', 'unknown-option', 'cross-project-option', 'six-pins', 'dup-pins',
  'unknown-pins', 'empty-pins', 'encoded-comma', 'leading-zero-pin', 'unknown-stage', 'extra-concern-stage', 'bad-case', 'bad-hz', 'vendor-hz', 'bad-hist',
  'cmp-single', 'odd-order', 'bus-conflict', 'bus-agrees', 'preview-keys'];
const pickCases = [];
for (const t of WANT) { const c = C.cases.find(x => x.tags.includes(t) && !pickCases.includes(x)); if (c) pickCases.push(c); }
for (const c of C.cases) { if (pickCases.length >= 25) break; if (c.tags.includes('generated') && /project=kennebec/.test(c.hash) && !pickCases.includes(c)) pickCases.push(c); }

const optBus = (cat, project, option) => cat.projects.find(p => p.id === project)?.options.find(o => o.id === option)?.busId ?? null;
const cmpSet = (cat, project, cmp, cur) => [...new Set([...cmp.map(id => optBus(cat, project, id) ?? cat.projects.flatMap(p => p.options).find(o => o.id === id)?.busId), cur].filter(Boolean))].sort();
function expectOf(c) {
  const h = parseStudioHash(`#${c.hash}`), r = resolveStudioHash(h, LIVE_CAT), one = resolveStudioHash(h, ONE_CAT);
  const bus = r.bus || r.optionBus;
  // D9: One Studio's Decision compares the current option plus at most two others; the live compare set may omit it.
  const cmp = cmpSet(LIVE_CAT, r.project, r.cmp, r.optionBus);
  const known = [];
  if (one.project !== r.project || one.optionBus !== r.optionBus || JSON.stringify(cmpSet(ONE_CAT, one.project, one.cmp, one.optionBus)) !== JSON.stringify(cmpSet(LIVE_CAT, r.project, r.cmp, r.optionBus))) known.push('catalogue');
  if (!h.project && !h.bus) known.push('D10');
  return { stage: r.stage, depth: r.depth, bus, pins: r.pins, cmp, caseKey: r.caseKey, hz: r.hz, project: r.project, known };
}
async function render(ctx, hash) {
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(`${U}#${hash}`);
  try { await p.waitForSelector('#gsf-stages', { timeout: 150000 }); } catch {
    const body = (await p.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').slice(0, 160); await p.close();
    return { hash: '', stage: null, depth: null, bus: null, pins: [], cmp: [], caseKey: null, hz: null, toast: '', errs: [`no frame after 60 s: ${errs[0] || body}`], notices: [] };
  }
  let last = '', since = Date.now(); const t0 = Date.now();
  while (Date.now() - t0 < 45000) { const h = await p.evaluate(() => location.hash); if (h !== last) { last = h; since = Date.now(); } else if (Date.now() - since > 2500 && /bus=/.test(h)) break; await p.waitForTimeout(250); }
  const got = await p.evaluate(() => ({ hash: location.hash, stage: document.querySelector('#gsf-stages [aria-current="step"]')?.dataset.gsfStage || null,
    depth: document.querySelector('.scope .depth [aria-pressed="true"]')?.dataset.v || null, toast: document.querySelector('#toast')?.textContent || '' }));
  await p.close();
  const w = parseStudioHash(got.hash), one = resolveStudioHash(w, ONE_CAT);
  const cur = w.bus;
  // cmp in the written hash: the walk's options (current first); map them through the One Studio catalogue.
  const cmp = w.project ? cmpSet(ONE_CAT, w.project, w.cmp, cur).filter(Boolean) : [cur];
  return { hash: got.hash, stage: got.stage, depth: got.depth, bus: cur, pins: w.pins, cmp, caseKey: w.caseKey, hz: w.hz, toast: got.toast, errs, notices: one.notices };
}

// The runner below only runs when this file is the entry point: `import { LEAD_WIRING, patchApp, wiringApplied }`
// from a tool (the W-A apply script) must not launch a browser.
const isMain = !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
// --wiring: on disk already? Then verify it and run the app as served; otherwise patch it in the browser.
let INTERCEPT = false;
if (WIRING) {
  const w = wiringApplied(readFileSync(path.join(APP, 'app.js'), 'utf8'));
  if (w.applied) console.log(`[wiring] the M5 Lead-wiring patch is applied on disk (${LEAD_WIRING.length} pairs verified); running the app as served`);
  else { console.log(`[wiring] not applied on disk (${w.miss.join('; ')}); applying it in the browser only`); INTERCEPT = true; }
}

let b = await chromium.launch({ channel: 'chrome' });
// The PC is shared with many agents: a crashed browser is relaunched and the case retried once (logged, never hidden).
const relaunch = async () => { await b.close().catch(() => {}); b = await chromium.launch({ channel: 'chrome' }); };
const retries = [];
const mkCtx = async () => {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  if (INTERCEPT) await ctx.route(/\/app\.js(\?.*)?$/, async route => { const r = await route.fetch(); route.fulfill({ response: r, body: patchApp(await r.text()) }); });
  return ctx;
};
const FIELDS = ['stage', 'depth', 'bus', 'pins', 'cmp', 'caseKey', 'hz'];
const rows = []; let fails = 0, knownN = 0, pass = 0, rtFails = 0; const T0 = Date.now();
const queue = pickCases.slice();
async function worker() {
  for (let c; (c = queue.shift());) {
    const exp = expectOf(c);
    // Watchdog: a renderer that dies mid-evaluate can hang a call forever (2026-10-07: 35 min); 240 s, then relaunch + retry.
    const once = async h => { const ctx = await mkCtx(); let t; try { return await Promise.race([render(ctx, h), new Promise((_, no) => { t = setTimeout(() => no(new Error('watchdog: no result in 240 s')), 240000); })]); } finally { clearTimeout(t); await ctx.close().catch(() => {}); } };
    const safe = async h => { try { return await once(h); } catch (e) { retries.push(`${c.id}: ${String(e.message || e).split(String.fromCharCode(10))[0]}`); await relaunch(); return once(h); } };
    const got = await safe(c.hash); const back = await safe(got.hash.replace(/^#/, ''));
    const bad = [], known = [];
    for (const k of FIELDS) {
      const e = JSON.stringify(exp[k]), g = JSON.stringify(got[k]);
      if (e === g) continue;
      const kn = (k === 'bus' || k === 'cmp') && exp.known.length ? exp.known.join('+') : null;
      (kn ? known : bad).push(`${k}: live ${e} · one ${g}${kn ? ` [${kn}]` : ''}`);
    }
    const rt = FIELDS.filter(k => JSON.stringify(got[k]) !== JSON.stringify(back[k])).map(k => `${k} ${JSON.stringify(got[k])}→${JSON.stringify(back[k])}`);
    if (got.errs.length) bad.push(`console: ${got.errs[0].slice(0, 120)}`);
    if (rt.length) { rtFails++; bad.push(`round trip: ${rt.join(', ')}`); }
    if (bad.length) fails++; else if (known.length) knownN++; else pass++;
    rows.push({ id: c.id, tags: c.tags.join(','), hash: c.hash, bad, known, toast: got.toast });
    // progress as each case lands: the verdicts print sorted at the end, so a run killed by a time limit showed nothing
    console.log(`.. ${c.id} ${bad.length ? 'FAIL' : known.length ? 'KNWN' : 'ok'} (${rows.length}/${pickCases.length}, ${((Date.now() - T0) / 1000).toFixed(0)} s)`);
  }
}
// One worker by default: each page loads the full bus index; parallel pages ran the machine out of memory (2026-10-06).
await Promise.all(Array.from({ length: Number(process.env.SMOKE_WORKERS || 1) }, worker));
await b.close();
rows.sort((x, y) => x.id.localeCompare(y.id));
for (const r of rows) {
  console.log(`${r.bad.length ? 'FAIL' : r.known.length ? 'KNWN' : 'ok  '} ${r.id} ${r.tags} #${r.hash.slice(0, 70)}`);
  for (const x of [...r.bad, ...r.known]) console.log(`       ${x}`);
  if (r.toast && (r.bad.length || r.known.length || /not in|preview/.test(r.toast))) console.log(`       toast: ${r.toast}`);
}
if (retries.length) console.log(`browser relaunched ${retries.length}x: ${retries.join(' | ')}`);
console.log(`${WIRING ? `[with Lead wiring${INTERCEPT ? ' (browser patch)' : ' (on disk)'}] ` : ''}${pass}/${rows.length} same context · ${knownN} differ only by the documented catalogue/D10 issue · ${fails} FAIL · round-trip failures ${rtFails}`);
process.exit(fails ? 1 : 0);
}
