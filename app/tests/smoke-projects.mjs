// L1 smoke (lift plan 14 §6/§6a): a map bus → "New project here" → name / tech / MW / COD → all 7 dashboards read the
// project's MW and tech → Project inputs: edit the size → Grid and Economics read it → an invalid value is rejected with
// its reason → reload → the link round-trips; Add option from the map pop and the header option switcher; Ctrl-K palette;
// the 5 Dummy samples listed read-only beside the user project; no console error.
// Provenance: Claude Opus 5.5 (integrator, round 1) · one-studio/design/14-lift-projects-configurator-continuum.md §6/§6a · 2026-10-13 · sign-off pending · v1
import { BASE, pwRequire } from './env.mjs';
// fix-1: never the daily :8105 (its proxy reaches the real :5034): only against the suite's ephemeral server + fakes
if (!process.env.GS_BASE) { console.error('run via tests/run-suite.mjs (needs GS_BASE + the fake :5034)'); process.exit(2); }
const { chromium } = pwRequire('playwright');

const failures = [];
const check = (yes, text) => { if (!yes) failures.push(text); console.log(`${yes ? 'ok' : 'FAIL'} ${text}`); };
const STAGES = ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision'];
const BUS = '111209', BUS2 = '111403';

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
const S = () => page.evaluate(async () => (await import('./app.js')).getState());
const toastHas = (re, t = 20000) => page.waitForFunction(r => new RegExp(r).test(document.getElementById('toast')?.textContent || ''), re.source, { timeout: t }).then(() => true, () => false);
try {
  await page.goto(`${BASE}/analytics-analyzer-studio.html#v=stage&stage=market&bus=${BUS2}`);
  await page.evaluate(() => { localStorage.removeItem('gsone.projects.v1'); localStorage.removeItem('gspreview.analyzer.v1'); localStorage.removeItem('gsone.insp.v1'); });
  await page.reload();
  await page.waitForSelector('#gsf-stages', { timeout: 60000 });
  check(await page.locator('.hdr [data-act="open-new-project"]').count() === 1, 'header: New project button');
  const ready = await page.waitForFunction(() => window.__gsBridgePerf?.ready && typeof window.GSFrame?.selectBus === 'function', null, { timeout: 150000 }).then(() => true, () => false);
  check(ready, 'map/grid bridge ready');
  await page.click('#gsf-stages [data-act="save-scenario"]'); // fix-1: a scenario saved with no project open never goes stale on a project edit

  // 1. a map bus → the pop → New project here (bus pre-filled)
  await page.dispatchEvent('#gsx-map-dock', 'pointerdown');
  await page.evaluate(b => window.GSFrame.selectBus(Number(b)), BUS);
  const pop = page.locator('#gsx-map-dock .gsx-bus-pop');
  check(await pop.waitFor({ timeout: 20000 }).then(() => true, () => false), 'map selection shows the bus pop');
  await pop.locator('[data-act="proj-new-here"]').click();
  await page.waitForSelector('.gsx-np', { timeout: 10000 });
  check((await page.inputValue('.gsx-np [data-np="bus"]')).endsWith(BUS), `New project here: bus pre-filled (${await page.inputValue('.gsx-np [data-np="bus"]')})`);
  // a rejected form keeps its values and says why
  await page.fill('.gsx-np [data-np="name"]', '');
  await page.click('.gsx-np [data-act="np-create"]');
  await page.waitForSelector('.gsx-np [data-np-err="name"]', { timeout: 10000 });
  check(/name is required/i.test(await page.textContent('.gsx-np [data-np-err="name"]')), 'missing name rejected with its reason');
  await page.fill('.gsx-np [data-np="name"]', 'Smoke Solar');
  await page.selectOption('.gsx-np [data-np="tech"]', 'solar');
  await page.fill('.gsx-np [data-np="exportMW"]', '150');
  await page.fill('.gsx-np [data-np="cod"]', '2029');
  await page.click('.gsx-np [data-act="np-create"]');
  check(await page.waitForSelector('.gsx-proj-bar', { timeout: 20000 }).then(() => true, () => false), 'project created and open (project bar)');
  check(await toastHas(/Created Smoke Solar/), 'toast: created');
  let st = await S();
  check(st.tech === 'solar' && st.exportMW === 150 && String(st.nodeId) === BUS, `state reads the project: ${st.tech} ${st.exportMW} MW at ${st.nodeId}`);
  const pid = st.walk?.project;
  check(/^u/.test(pid || '') && /project=u[^&]+&option=o1/.test(await page.evaluate(() => location.hash)), `hash carries project=${pid}&option=o1`);

  // 2. all 7 dashboards read the project's MW and tech
  for (const k of STAGES) {
    await page.click(`#gsf-stages button[data-act="stage"][data-v="${k}"]`);
    const ok = await page.waitForFunction(() => /150 MW solar/.test(document.querySelector('.summary .ctx em')?.textContent || '') && /Smoke Solar/.test(document.querySelector('.summary .ctx .kick')?.textContent || ''), null, { timeout: 30000 }).then(() => true, () => false);
    check(ok, `${k}: the band reads "150 MW solar" on Smoke Solar`);
  }
  // fix-3: a rules-file default reaches Economics labelled 'A' with its source, never 'U' (your entry)
  await page.click('#gsf-stages button[data-act="stage"][data-v="economics"]');
  const cfPill = await page.waitForSelector('.gsx-an :is(label.field, .range-field):has([data-act="econ"][data-k="solarCF"]) .pill', { timeout: 30000 }).then(x => x.evaluate(e => [e.textContent, e.title]), () => null);
  check(cfPill && cfPill[0] === 'A' && /defaults\.json|rules/.test(cfPill[1]), `Economics CF pill is a labelled default, not your entry (${cfPill})`);

  // 3. Project inputs is the first, current inspector tab; edit the size
  const tabs = await page.$$eval('#inspector [data-insp="tab"]', b => b.map(x => x.dataset.v));
  check(tabs[0] === 'inputs', `inspector tabs start with Project inputs (${tabs.join(',')})`);
  await page.click('#inspector [data-insp="tab"][data-v="inputs"]');
  await page.waitForSelector('#gsx-pi-exportMW', { timeout: 10000 });
  check(/stated/.test(await page.textContent('#inspector .pi-cnt')), `stated count shown (${await page.textContent('#inspector .pi-cnt')})`);
  await page.click('#gsf-stages [data-act="save-scenario"]'); // a saved finding on the old size goes stale with its reason
  await page.fill('#gsx-pi-exportMW', '200'); await page.press('#gsx-pi-exportMW', 'Enter');
  check(await toastHas(/Saved: Export size 150 → 200; 1 saved finding now stale/), 'toast: Saved: Export size 150 → 200; 1 saved finding now stale (only this project)');
  st = await S();
  check(st.scenarios.length === 2 && !st.scenarios[0].stale && st.scenarios[0].project == null, `the scenario saved before the project stays current (stale=${st.scenarios[0]?.stale})`);
  check(st.exportMW === 200, `state export MW = 200 (${st.exportMW})`);
  check(st.scenarios.at(-1)?.stale === true && st.scenarios.at(-1)?.staleReason === 'Export size 150 → 200', `saved scenario marked stale: "${st.scenarios.at(-1)?.staleReason}"`);
  // fix-2: re-entering the same value is not a change: a finding saved on 200 MW stays current
  await page.click('#gsf-stages [data-act="save-scenario"]');
  await page.fill('#gsx-pi-exportMW', '200'); await page.press('#gsx-pi-exportMW', 'Enter');
  await toastHas(/Saved: Export size 200 → 200/);
  st = await S();
  check(st.scenarios.length === 3 && !st.scenarios.at(-1).stale, `same value re-entered: the finding saved on 200 MW stays current (stale=${st.scenarios.at(-1)?.stale})`);
  check(!/now stale/.test(await page.textContent('#toast')), 'same value: the toast names no stale finding');
  await page.click('#gsf-stages button[data-act="stage"][data-v="grid"]');
  await page.click('.gsx-an [role="tab"][data-v="capacity"]').catch(() => {});
  const g = await page.waitForSelector('[data-act="grid-size"]', { timeout: 90000 }).then(() => page.inputValue('[data-act="grid-size"]'), () => null);
  check(g === '200', `Grid › Connection capacity reads 200 MW (slider ${g})`);
  await page.click('#gsf-stages button[data-act="stage"][data-v="economics"]');
  const e = await page.waitForFunction(() => document.querySelector('.scope select[data-act="export"]')?.value === '200' && /200 MW solar/.test(document.querySelector('.summary .ctx em')?.textContent || '') && document.querySelector('.gsx-an [role="tabpanel"]'), null, { timeout: 90000 }).then(() => true, () => false);
  check(e, 'Economics reads 200 MW (scope size and band)');
  // 4. an invalid value is rejected with its reason and not applied
  await page.fill('#gsx-pi-exportMW', '-5'); await page.press('#gsx-pi-exportMW', 'Enter');
  const why = await page.waitForSelector('#inspector .pi-f[data-k="exportMW"] .pi-err', { timeout: 10000 }).then(x => x.textContent(), () => '');
  check(/must be > 0/.test(why) && /not applied/.test(why), `invalid size rejected: "${why}"`);
  check((await S()).exportMW === 200, 'the rejected value was not applied');

  // 5. Add option from the map pop; switch with the header option switcher
  await page.dispatchEvent('#gsx-map-dock', 'pointerdown');
  await page.evaluate(b => window.GSFrame.selectBus(Number(b)), BUS2);
  const add = page.locator('#gsx-map-dock .gsx-bus-pop [data-act="proj-add-opt"]');
  check(await add.waitFor({ timeout: 20000 }).then(() => true, () => false), 'map pop offers Add option to Smoke Solar');
  const off = await page.waitForFunction(() => /bus in view: not an option/.test(document.querySelector('.hdr .gsx-opt-sw select')?.selectedOptions[0]?.textContent || ''), null, { timeout: 20000 }).then(() => true, () => false);
  check(off && (await S()).walk?.option === null && !/option=o1/.test(await page.evaluate(() => location.hash)), 'a bus that is not an option: the switcher and hash no longer claim o1');
  // fix-site: the site default follows the bus in view (toState busCoord contract), on a non-option bus and after Add option
  const coord2 = await page.evaluate(async b => { const n = (await import('./app.js')).getData().index.find(x => x.id === b); return { lat: n.lat, lon: n.lon, name: n.name }; }, BUS2);
  const siteIs = (s, where) => check(s.ui.land?.siteLat === coord2.lat && s.ui.land?.siteLon === coord2.lon && new RegExp(`${coord2.name} · ${BUS2}`).test(s.ui.inputSrc?.siteLat?.src || '') && s.ui.inputSrc?.siteLat?.v === coord2.lat && s.ui.inputProv?.siteLat?.v === coord2.lat,
    `fix-site ${where}: site ${s.ui.land?.siteLat}/${s.ui.land?.siteLon} labelled "${s.ui.inputSrc?.siteLat?.src}" is ${coord2.name} ${coord2.lat}/${coord2.lon}`);
  siteIs(await S(), 'non-option bus in view');
  await add.click();
  check(await toastHas(/added to Smoke Solar as option o2/), 'toast: added as option o2');
  check((await S()).walk?.option === 'o2', 'adding the bus in view makes it the current option (o2)');
  siteIs(await S(), 'after Add option (o2)');
  check(await page.locator('.hdr .gsx-opt-sw select option').count() === 2, 'header option switcher lists 2 options');
  st = await S();
  check((st.ui.dOpts || []).map(String).includes(BUS) && /cmp=[^&]*o1/.test(await page.evaluate(() => location.hash)), `fix-2: o1 stays in the Decision compare and in cmp= after adding o2 on the bus in view (dOpts=${JSON.stringify(st.ui.dOpts)})`);
  await page.selectOption('.hdr .gsx-opt-sw select', 'o2');
  check(await page.waitForFunction(b => location.hash.includes('option=o2') && location.hash.includes(`bus=${b}`), BUS2, { timeout: 20000 }).then(() => true, () => false), 'option o2 → bus 111403 in the URL');
  await page.selectOption('.hdr .gsx-opt-sw select', 'o1');
  await page.waitForFunction(b => location.hash.includes('option=o1') && location.hash.includes(`bus=${b}`), BUS, { timeout: 20000 }).catch(() => {});

  // 6. reload keeps it
  await page.reload();
  check(await page.waitForSelector('.gsx-proj-bar', { timeout: 60000 }).then(() => true, () => false), 'reload: the project is still open');
  st = await S();
  check(st.exportMW === 200 && st.walk?.project === pid && String(st.nodeId) === BUS, `reload: 200 MW at ${st.nodeId}, project ${st.walk?.project}`);

  // 7. link round-trip: open a Dummy sample, then the link opens the user project again
  const link = await page.evaluate(() => location.href);
  await page.click('.hdr [data-act="open-samples"]').catch(() => page.evaluate(() => document.querySelector('[data-act="open-samples"]').click()));
  await page.waitForSelector('.modal[aria-label="Projects"]', { timeout: 10000 });
  await page.waitForFunction(() => document.querySelectorAll('.modal[aria-label="Projects"] .proj-card').length >= 6, null, { timeout: 30000 }).catch(() => {});
  const dummy = await page.$$eval('.modal[aria-label="Projects"] .proj-card header b', b => b.map(x => x.textContent));
  check(dummy.filter(t => /^Dummy — /.test(t)).length === 5 && dummy.includes('Smoke Solar'), `Projects modal: Smoke Solar beside 5 "Dummy —" samples (${dummy.length} cards)`);
  const sample = await page.$eval('.modal [data-act="sample"]:not([data-v^="u"])', b => b.dataset.v);
  await page.click(`.modal [data-act="sample"][data-v="${sample}"]`);
  await page.waitForFunction(id => (location.hash.match(/project=([^&]+)/) || [])[1] === id, sample, { timeout: 20000 });
  await page.goto('about:blank'); await page.goto(link);
  check(await page.waitForFunction(id => document.querySelector('.gsx-proj-bar')?.dataset.gsxProj === id, pid, { timeout: 60000 }).then(() => true, () => false), 'link round-trip reopens Smoke Solar');
  st = await S();
  check(st.walk?.option === 'o1' && String(st.nodeId) === BUS && st.exportMW === 200, `link: option ${st.walk?.option}, bus ${st.nodeId}, ${st.exportMW} MW`);
  // an unknown project id in a link: a visible notice, never silent
  await page.evaluate(() => { location.hash = 'v=stage&stage=market&project=u-nowhere&option=o1'; });
  check(await toastHas(/not in this workspace/), 'unknown project link → visible notice');

  // 8. Ctrl-K palette: open a project by name
  await page.keyboard.press('Control+k');
  const pal = await page.waitForSelector('.gsx-pal', { timeout: 45000 }).then(() => true, () => false);
  if (!pal) console.log('DIAG', await page.evaluate(async () => ({ modal: (await import('./app.js')).getState().ui.modal, ae: document.activeElement?.tagName, hash: location.hash, r: JSON.stringify(document.querySelector('.gsx-pal')?.getBoundingClientRect()), rb: JSON.stringify(document.querySelector('.modal-backdrop')?.getBoundingClientRect()), cs: getComputedStyle(document.querySelector('.modal-backdrop')).display + '/' + getComputedStyle(document.querySelector('#app>.gsx-layer')).display + '/' + getComputedStyle(document.querySelector('.gsx-pal')).display })));
  if (!pal) await page.screenshot({ path: process.env.SUITE_SCRATCH ? `${process.env.SUITE_SCRATCH}/pal.png` : 'tests/_tmp_pal.png' });
  check(pal, 'Ctrl-K opens the command palette');
  await page.fill('.gsx-pal-q', 'Open project: Smoke');
  await page.press('.gsx-pal-q', 'Enter');
  check(await page.waitForFunction(id => document.querySelector('.gsx-proj-bar')?.dataset.gsxProj === id, pid, { timeout: 20000 }).then(() => true, () => false), 'palette: Open project: Smoke Solar');
  await page.keyboard.press('Control+k');
  check(await page.locator('.gsx-pal [data-act="proj-new-here"]').count() === 1 && await page.locator('.gsx-pal [data-act="open-new-project"]').count() === 1, 'palette offers New project and New project here');
  await page.keyboard.press('Escape');

  // 9. fix-1: null = not held, never 0: a hybrid with no charge size, then a tech change that leaves a required size missing
  await page.click('.hdr [data-act="open-new-project"]');
  await page.waitForSelector('.gsx-np', { timeout: 10000 });
  await page.fill('.gsx-np [data-np="name"]', 'Smoke Hybrid'); await page.selectOption('.gsx-np [data-np="tech"]', 'hybrid');
  await page.fill('.gsx-np [data-np="exportMW"]', '100'); await page.fill('.gsx-np [data-np="importMW"]', ''); await page.fill('.gsx-np [data-np="cod"]', '2030');
  await page.click('.gsx-np [data-act="np-create"]');
  check(await toastHas(/Created Smoke Hybrid/), 'hybrid created with no import size');
  st = await S();
  check(st.tech === 'hybrid' && st.importMW === null, `hybrid import MW is not held in state (${st.importMW}), never 0`);
  const imp = await page.waitForSelector('.scope select[data-act="import"]', { timeout: 20000 }).then(x => x.evaluate(e => e.selectedOptions[0]?.textContent), () => null);
  check(imp === 'not held', `scope import reads "not held" (${imp})`);
  await page.click('#inspector [data-insp="tab"][data-v="inputs"]');
  await page.waitForSelector('#gsx-pi-tech', { timeout: 10000 });
  await page.selectOption('#gsx-pi-tech', 'datacenter');
  check(await toastHas(/Technology hybrid → datacenter.*Import \/ charge size is not held for datacenter: set it now/), 'tech → data centre: saved, with the missing import size named');
  check(/incomplete/.test(await page.textContent('#inspector .pi-cnt')) && /not held/.test(await page.textContent('#inspector .pi-f[data-k="importMW"] .pi-err').catch(() => '')), 'Project inputs: "incomplete" and the reason under Import size');
  check((await S()).importMW === null, 'data centre import MW stays not held, never 0');
  await page.fill('#gsx-pi-importMW', '150'); await page.press('#gsx-pi-importMW', 'Enter');
  check(await page.waitForFunction(() => !/incomplete/.test(document.querySelector('#inspector .pi-cnt')?.textContent || 'incomplete'), null, { timeout: 10000 }).then(() => true, () => false) && (await S()).importMW === 150, 'import 150 MW set: complete, state reads 150');
  // fix-2: data centre → solar: export size is not held (null), never "0 MW solar"
  await page.selectOption('#gsx-pi-tech', 'solar');
  check(await toastHas(/Export size is not held for solar: set it now/) && !/not applied/.test(await page.textContent('#toast')), `tech → solar: toast names the missing export size, never "not applied" (${await page.textContent('#toast')})`);
  st = await S();
  check(st.tech === 'solar' && st.exportMW === null, `solar export MW is not held in state (${st.exportMW}), never 0`);
  // nullmw: on all 7 stages the band sub and the card source line say "size not held", never "0 MW" / "null MW";
  // Grid and Decision show "size not held — set it in Project inputs" and compute nothing from the missing size.
  for (const k of STAGES) {
    await page.click(`#gsf-stages button[data-act="stage"][data-v="${k}"]`);
    await page.waitForFunction(v => document.querySelector(`#gsf-stages button[data-act="stage"][data-v="${v}"]`)?.classList.contains('on') || new RegExp(`stage=${v}`).test(location.hash), k, { timeout: 30000 }).catch(() => {});
    const band = await page.textContent('.summary .ctx em').catch(() => '');
    const src = await page.textContent('.gswf-kill .gswf-src').catch(() => '');
    const kill = await page.textContent('.gswf-kill').catch(() => '');
    check(!/\b(0|null|undefined|NaN) MW\b/.test(`${band} ${src} ${kill}`) && /not held/.test(band) && /not held/.test(src), `${k}: band and card source read "size not held", never "0/null MW" (band "${band}" · src "${src}")`);
    if (k === 'grid' || k === 'decision') {
      const es = await page.waitForFunction(() => /size not held — set it in Project inputs/i.test(document.querySelector('.gsx-an')?.textContent || ''), null, { timeout: 30000 }).then(() => true, () => false);
      const t = await page.textContent('.gsx-an').catch(() => '');
      check(es && !/\b(0|null|undefined|NaN) MW\b|÷ 0\b|Request 0/.test(t), `${k}: "size not held — set it in Project inputs", nothing computed from the size (no 0 MW, no ÷ 0)`);
    }
  }
  // fix-3: solar → hybrid never carries solar's "does not apply" 0 as a stated charge size
  await page.fill('#gsx-pi-exportMW', '100'); await page.press('#gsx-pi-exportMW', 'Enter');
  await page.waitForFunction(async () => (await import('./app.js')).getState().exportMW === 100, null, { timeout: 10000 }).catch(() => {});
  await page.selectOption('#gsx-pi-tech', 'hybrid');
  await page.waitForFunction(async () => (await import('./app.js')).getState().tech === 'hybrid', null, { timeout: 10000 }).catch(() => {});
  st = await S();
  const imp2 = await page.$eval('.scope select[data-act="import"]', e => e.selectedOptions[0]?.textContent).catch(() => null);
  check(st.importMW === null && imp2 === 'not held', `solar → hybrid: charge size not held (state ${st.importMW}, scope ${imp2}), never 0 MW`);
} catch (e) { check(false, `smoke threw: ${e.message}`); }
const bad = errors.filter(t => !/Failed to load resource: the server responded with a status of (404|502)/.test(t));
check(!bad.length, `browser console: ${bad.join(' | ') || 'no errors'}`);
await browser.close();
console.log(failures.length ? `${failures.length} FAILED` : 'ALL PASS');
process.exit(failures.length ? 1 : 0);
