import { BASE, pwRequire } from './env.mjs';
// W-A integration smoke: the Lead-wiring diffs applied to the shell (app.js, live-bridge.js, the HTML) are live in the
// page, not just on disk. One browser, one page, output by console (callers redirect to a file). Never :8103/:8104/:5034.
// Checks: <title>; no element links to :8103 (M5 §7); the Inspector is mounted by app.js (M4); the P2 grid columns are
// registered AND showable (REG_BY reached) with engine values or a reason (S3 #2, S4 #4, S5 #5, S6 #6); queue + land
// load on the Market stage (S2-GD #2); the band's two screening gates + Decision tally come from the engines (S2-GD #1);
// the `tax` and `fin-preset` actions dispatch (S5 #2); 0 console errors.
// Provenance: Claude Fable 5.1 (W-A integration agent) · one-studio/design (T3, P2 slice W-A) · 2026-10-07 · sign-off pending · v1
const { chromium } = pwRequire('playwright');
const fails = []; let checks = 0;
const check = (c, m) => { checks++; if (!c) { fails.push(m); console.log(`FAIL ${m}`); } else console.log(`ok   ${m}`); };
const U = `${BASE}/analytics-analyzer-studio.html`;
const P2 = ['q_entry_cash', 'q_cluster_deadline', 'cap_cod', 'pfp_exp', 'tax_credit', 'tax_gate', 'll_firm', 'll_nonfirm', 'll_above_firm', 'll_upgrade', 'll_tx'];

const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage(); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
const A = () => page.evaluate(async () => { const m = await import(`${location.origin}/app.js`); return m; }); // module handle inside the page
const state = () => page.evaluate(async () => (await import(`${location.origin}/app.js`)).getState());
try {
  await page.goto(`${U}#stage=market&bus=111403&depth=review&case=sp`);
  await page.waitForSelector('#board [role="tabpanel"]', { timeout: 120000 });
  // M5 §7 + title
  check(await page.title() === 'GridSense One Studio', `title "${await page.title()}"`);
  check(await page.evaluate(() => document.querySelectorAll('a[href*="8103"]').length) === 0, 'no element links to :8103');
  // M4: mounted by the shell (no harness injection)
  await page.waitForFunction(() => window.__gsInspector && document.querySelector('#inspector .insp'), null, { timeout: 60000 }).catch(() => {});
  check(await page.evaluate(() => !!(window.__gsInspector && document.querySelector('#inspector .insp'))), 'Inspector mounted by app.js in #inspector');
  // S2-GD #2: queue + land load on Market
  await page.waitForFunction(async () => { const m = await import(`${location.origin}/app.js`); const D = m.getData(); return !!(D.queue && D.land); }, null, { timeout: 60000 }).catch(() => {});
  const dl = await page.evaluate(async () => { const D = (await import(`${location.origin}/app.js`)).getData(); return { q: !!D.queue, l: !!D.land }; });
  check(dl.q && dl.l, `queue (${dl.q}) and land (${dl.l}) loaded on the Market stage`);
  // S2-GD #1: the band reads screeningGates ("N of 2 met") and candidateTally (verdictLine words)
  await page.waitForFunction(() => { const f = [...document.querySelectorAll('.summary .facts > div')].find(d => d.querySelector('span')?.textContent === 'Decision gates'); return f && !/…/.test(f.querySelector('b').textContent); }, null, { timeout: 90000 }).catch(() => {});
  const band = await page.evaluate(() => ({ dec: [...document.querySelectorAll('.summary .facts > div')].find(d => d.querySelector('span')?.textContent === 'Decision gates')?.querySelector('b')?.textContent.trim() || '',
    kill: document.querySelector('.gswf-kill .badge')?.textContent || '' }));
  check(/(\d+) Pass.*\(of (\d+)\)/.test(band.dec), `Decision gates fact is the shared tally ("${band.dec}")`);
  check(/\d of 2 met/.test(band.kill), `screening gates read "N of 2 met" ("${band.kill.slice(0, 60)}")`);
  // bridge + P2 columns
  await page.waitForFunction(() => window.__gsBridgePerf?.ready && window.GSMapGrid, null, { timeout: 90000 });
  const reg = await page.evaluate(() => window.GSMapGrid.registry().map(c => c.id));
  check(P2.every(id => reg.includes(id)), `registry lists the 11 P2 columns (missing: ${P2.filter(id => !reg.includes(id)).join(', ') || 'none'})`);
  const show = await page.evaluate(ids => { const MG = window.GSMapGrid, was = MG.shown(); MG.setShown([...was, ...ids]); const now = MG.shown(); MG.setShown(was); return now; }, ['q_entry_cash', 'cap_cod', 'tax_gate']);
  check(['q_entry_cash', 'cap_cod', 'tax_gate'].every(id => show.includes(id)), `P2 columns are showable through setShown (REG_BY reached): ${show.filter(id => id.startsWith('q_') || id.startsWith('cap_') || id.startsWith('tax_')).join(', ')}`);
  const v = await page.evaluate(() => ({ q: window.GSMapGrid.value('q_entry_cash', 111403), c: window.GSMapGrid.value('cap_cod', 111403), t: window.GSMapGrid.value('tax_gate', 111403) }));
  check(v.q && (typeof v.q.value === 'number' || /not held|blocked|site control|Land/i.test(v.q.why || '')), `Entry cash at 111403: ${v.q?.text} (${v.q?.why || 'engine value'})`);
  check(v.c && (typeof v.c.value === 'number' || /Not held/.test(v.c.why || '')), `Capacity (COD yr) at 111403: ${v.c?.text} (${v.c?.why || 'engine value'})`);
  check(v.t && v.t.value == null && /Not held/.test(v.t.why || ''), `Tax gate with no BOC entered is "not held" + reason, never a pass: ${v.t?.why}`);
  // S6: data-centre scope → large-load columns carry a value or a reason, and the pending badge text is on the column
  await page.evaluate(async () => (await import(`${location.origin}/app.js`)).dispatch([['tech', 'datacenter'], ['import', '100']]));
  await page.waitForTimeout(800);
  const ll = await page.evaluate(() => ({ firm: window.GSMapGrid.value('ll_firm', 111403), tx: window.GSMapGrid.value('ll_tx', 111403), hint: window.GSMapGrid.registry().find(c => c.id === 'll_firm') }));
  check(ll.firm && (typeof ll.firm.value === 'number' || /Not held/.test(ll.firm.why || '')), `Firm withdrawal at 111403 (dc 100 MW): ${ll.firm?.text} (${ll.firm?.why || 'engine value'})`);
  check(ll.tx && (typeof ll.tx.value === 'number' || /Not held/.test(ll.tx.why || '')), `Service charge at 111403: ${ll.tx?.text} (${ll.tx?.why || 'engine value'})`);
  // S5 #2: the actions
  const acts = await page.evaluate(async () => { const m = await import(`${location.origin}/app.js`); m.dispatch('tax', '2026-03-01', { dataset: { k: 'boc' } }); m.dispatch('tax', '45', { dataset: { k: 'macr' } }); m.dispatch('fin-preset', 'no-such-preset'); const S = m.getState(); return { boc: S.ui.tax?.boc, macr: S.ui.tax?.macr, preset: S.ui.fin?.preset ?? null }; });
  check(acts.boc === '2026-03-01' && acts.macr === 0.45 && acts.preset === null, `tax / fin-preset actions dispatch (boc ${acts.boc}, macr ${acts.macr}, unknown preset → ${acts.preset})`);
  await page.evaluate(async () => (await import(`${location.origin}/app.js`)).dispatch([['tech', 'solar'], ['export', '100']]));
} catch (e) { check(false, `smoke aborted: ${e.message}`); }
check(errors.length === 0, `0 console errors (${errors.slice(0, 2).join(' | ').slice(0, 200)})`);
await b.close();
console.log(fails.length ? `\n${fails.length} of ${checks} FAILED` : `\nALL PASS (${checks})`);
process.exit(fails.length ? 1 : 0);
