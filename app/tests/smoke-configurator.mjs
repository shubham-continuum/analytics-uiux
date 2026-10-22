// L3 smoke (lift plan 14 §3 L3): "Add analysis" on every stage header → build a column chart (Average LMP by year) → save →
// it appears under My analyses on the stage with its chart and the catalogue vintage, and its 2025 value equals the pinned
// extract's own figure → edit (rename) → reload keeps it → remove; one window.GS / window.App; no console error.
// Provenance: Claude Opus 5.5 (integrator, round 1) · one-studio/design/14-lift-projects-configurator-continuum.md §3 L3 · 2026-10-13 · sign-off pending · v1
import { BASE, pwRequire } from './env.mjs';
// fix-1: never the daily :8105 (its proxy reaches the real :5034): only against the suite's ephemeral server + fakes
if (!process.env.GS_BASE) { console.error('run via tests/run-suite.mjs (needs GS_BASE + the fake :5034)'); process.exit(2); }
const { chromium } = pwRequire('playwright');

const failures = [];
const check = (yes, text) => { if (!yes) failures.push(text); console.log(`${yes ? 'ok' : 'FAIL'} ${text}`); };
const STAGES = ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision'];
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
const S = () => page.evaluate(async () => (await import('./app.js')).getState());
const drawerBtn = re => page.locator('#gsx-cfg-drawer button', { hasText: re }).first();
try {
  await page.goto(`${BASE}/analytics-analyzer-studio.html#v=stage&stage=prices&bus=111403`);
  await page.evaluate(() => { localStorage.removeItem('gspreview.analyzer.v1'); localStorage.removeItem('gsone.projects.v1'); });
  await page.reload();
  check(await page.waitForFunction(() => !!window.Configurator && window.GS?.liveRuntime?.model, null, { timeout: 150000 }).then(() => true, () => false), 'the Graph Configurator booted on the one GS (live runtime merged)');
  check(await page.waitForSelector('.gsx-cfg-mine[data-gsx-cfg-stage="prices"]', { timeout: 90000 }).then(() => true, () => false), 'Prices: My analyses section');
  for (const k of STAGES) {
    await page.click(`#gsf-stages button[data-act="stage"][data-v="${k}"]`);
    const ok = await page.waitForFunction(st => document.querySelector(`.mk-for [data-act="cfg-add"][data-stage="${st}"]`), k, { timeout: 30000 }).then(() => true, () => false);
    check(ok, `${k}: "Add analysis" on the stage header`);
  }
  await page.click('#gsf-stages button[data-act="stage"][data-v="prices"]');
  await page.waitForSelector('.gsx-cfg-mine[data-gsx-cfg-stage="prices"]', { timeout: 60000 });

  // build a column chart and save it
  await page.click('.mk-for [data-act="cfg-add"]');
  check(await page.waitForSelector('#gsx-cfg-drawer.on', { timeout: 20000 }).then(() => true, () => false), 'Add analysis opens the builder drawer');
  await drawerBtn(/^Average LMPAvg_LMP/).click();
  check(/Column/.test(await drawerBtn(/^\d?Chart/).textContent().catch(() => '')) || await drawerBtn(/Column/).count() > 0, 'chart type: Column');
  await page.waitForFunction(() => [...document.querySelectorAll('#gsx-cfg-drawer button')].some(b => /^Save to My analyses/.test(b.textContent.trim()) && !b.disabled), null, { timeout: 15000 });
  await drawerBtn(/^Save to My analyses/).click();
  await page.waitForFunction(() => !document.querySelector('#gsx-cfg-drawer.on'), null, { timeout: 15000 }).catch(() => {});
  const w = page.locator('.gsx-cfg-mine[data-gsx-cfg-stage="prices"] [data-gsx-cfg-w]');
  check(await w.first().waitFor({ timeout: 30000 }).then(() => true, () => false) && await w.count() === 1, 'saved: one analysis on Prices › My analyses');
  check(await page.locator('.gsx-cfg-mine .gsx-cfg-body svg').count() >= 1, 'its chart is drawn (SVG)');
  check(/Field catalogue: .+duckdb/.test(await page.textContent('.gsx-cfg-mine [data-gsx-cfg-w] [data-gsx-cfg-vintage]')), 'labelled with the catalogue vintage');
  let st = await S();
  check(st.userWidgets.length === 1 && st.userWidgets[0].chartType === 'column' && st.userWidgets[0].concern === 'prices', `S.userWidgets holds the column chart on prices (${st.userWidgets.length})`);
  const v = await page.evaluate(async () => {
    const A = await import('./app.js'), H = await import('./views/configurator-host.js'), S = A.getState(), u = S.userWidgets[0];
    const ans = window.App.safeAnswer(window.Configurator.asDef(u), H.cfgCtx(window.App.ctx(), S, window.GS));
    const vs = window.GS.liveRuntime.model.nodes.map(n => n.lmp_2025).filter(Number.isFinite);
    return { got: ans.table?.rows?.find(r => r.x === '2025')?.s0 ?? null, want: vs.reduce((a, b) => a + b, 0) / vs.length, n: vs.length, principal: ans.principal };
  });
  check(v.got != null && Math.abs(v.got - v.want) < 1e-9, `2025 value ${v.got} = the pinned extract's mean Avg LMP 2025 over ${v.n} buses (${v.want})`);
  check(!/NaN|undefined/.test(await page.textContent('.gsx-cfg-mine')), 'no NaN / undefined on the card');
  check(await page.evaluate(() => !!window.GS.liveRuntime && typeof window.GS.priceAt === 'function' && typeof window.GS.catalog === 'object' && typeof window.App.ctx === 'function' && typeof window.App.save === 'function'),
    'one window.GS (the bridge engine + the merged runtime) and one window.App (the shim + the Configurator members)');

  // edit: rename
  await page.click('.gsx-cfg-mine [data-act="cfg-edit"]');
  await page.waitForSelector('#gsx-cfg-drawer.on', { timeout: 20000 });
  await drawerBtn(/Style/).click().catch(() => {});
  const name = page.locator('#gsx-cfg-drawer input[placeholder="Average LMP by year"]').first();
  if (await name.count()) { await name.fill('Smoke LMP'); await name.press('Tab'); }
  await page.waitForFunction(() => [...document.querySelectorAll('#gsx-cfg-drawer button')].some(b => /^Save changes/.test(b.textContent.trim()) && !b.disabled), null, { timeout: 15000 }).catch(() => {});
  await drawerBtn(/^Save changes/).click();
  check(await page.waitForFunction(() => document.querySelector('.gsx-cfg-mine [data-gsx-cfg-w] h3')?.textContent === 'Smoke LMP', null, { timeout: 20000 }).then(() => true, () => false), 'edit: renamed to "Smoke LMP" on the stage');
  st = await S();
  check(st.userWidgets.length === 1 && st.userWidgets[0].name === 'Smoke LMP', 'edit: still one analysis, the same id');

  // reload keeps it
  await page.reload();
  check(await page.waitForFunction(() => document.querySelector('.gsx-cfg-mine [data-gsx-cfg-w] h3')?.textContent === 'Smoke LMP', null, { timeout: 150000 }).then(() => true, () => false), 'reload: the analysis is still on Prices');

  // remove
  await page.click('.gsx-cfg-mine [data-act="cfg-rm"]');
  check(await page.waitForFunction(() => !document.querySelector('.gsx-cfg-mine [data-gsx-cfg-w]'), null, { timeout: 20000 }).then(() => true, () => false), 'remove: gone from the stage');
  check((await S()).userWidgets.length === 0, 'remove: S.userWidgets empty');
} catch (e) { check(false, `smoke threw: ${e.message}`); }
const bad = errors.filter(t => !/Failed to load resource: the server responded with a status of (404|502)/.test(t));
check(!bad.length, `browser console: ${bad.join(' | ') || 'no errors'}`);
await browser.close();
console.log(failures.length ? `${failures.length} FAILED` : 'ALL PASS');
process.exit(failures.length ? 1 : 0);
