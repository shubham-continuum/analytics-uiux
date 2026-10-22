import { BASE, pwRequire } from './env.mjs';
// Frame smoke (M1): persistent docks. Splitters drag to both clamps; each dock folds to its edge tab and back;
// 50 stage/tab changes keep the same dock DOM nodes (identity marker) and sizes; a stale live `gs.frame.v1` cannot
// change S.ui.frame; the frame never writes the hash; no console error; narrow/tight and no page overflow at
// 760, 900, 1000, 1280, 1440 and 1920.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, slice M1) · 2026-10-06 · sign-off pending · v1
const require = pwRequire;
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const U = `${BASE}/analytics-analyzer-studio.html`;
const STORE = 'gspreview.analyzer.v1';
const STALE = { map: 999, bottom: 777, insp: 555, mapOff: true, bottomOff: true, inspOpen: false, scopeOpen: true, busId: 1, views: { stage: { mapOff: true, bottomOff: true } } };
const DOCK_IDS = ['gsf-dock-map', 'gsx-map-dock', 'gsf-split-v', 'gsf-ws', 'board', 'gsf-split-i', 'gsf-insp', 'inspector', 'gsf-split-h', 'gsf-dock-bottom', 'gsx-grid-dock'];

const b = await chromium.launch({ channel: 'chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
// A stale live frame record on every navigation, and a spy on every way a page can write the URL.
await ctx.addInitScript(stale => {
  try { localStorage.setItem('gs.frame.v1', JSON.stringify(stale)); } catch { }
  window.__hw = 0; window.__hc = 0;
  const rs = history.replaceState.bind(history), ps = history.pushState.bind(history);
  history.replaceState = (...a) => { window.__hw++; return rs(...a); };
  history.pushState = (...a) => { window.__hw++; return ps(...a); };
  addEventListener('hashchange', () => { window.__hc++; });
}, STALE);
const page = await ctx.newPage(); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
const settle = async () => { await page.waitForSelector('[role="tabpanel"] .kpis, [role="tabpanel"] .empty, [role="tabpanel"] .notice, [role="tabpanel"] .card', { timeout: 90000 }); await page.waitForTimeout(300); };
const sizes = () => page.evaluate(() => window.GSFrame.sizes());
const stored = () => page.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}').ui?.frame || null, STORE);
const writes = () => page.evaluate(() => ({ hw: window.__hw, hc: window.__hc, hash: location.hash }));
const box = async sel => page.locator(sel).boundingBox();
async function drag(sel, dx, dy) {
  const r = await box(sel); const x = r.x + r.width / 2, y = r.y + r.height / 2;
  await page.mouse.move(x, y); await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + (dx * i) / 6, y + (dy * i) / 6);
  await page.mouse.up(); await page.waitForTimeout(80);
}
const geo = () => page.evaluate(() => ({ bodyW: document.querySelector('#app>.sm>.body').clientWidth, smH: document.querySelector('#app>.sm').clientHeight }));
const reset = async () => { await page.evaluate(k => { const S = JSON.parse(localStorage.getItem(k) || '{}'); S.ui = { ...(S.ui || {}), frame: undefined, modal: false }; localStorage.setItem(k, JSON.stringify(S)); }, STORE); await page.reload(); await settle(); };

// 0. clean store, first load
await page.goto(`${U}#stage=prices&bus=111403&depth=review`);
await page.evaluate(k => localStorage.removeItem(k), STORE);
await page.reload(); await settle();
{
  const s = await sizes(), cls = await page.evaluate(() => document.getElementById('app').className);
  check(!/gsf-(map|bottom|insp)-off/.test(cls), `docks open by default (#app has no -off class)`);
  check(s.map === 557 && s.bottom === 220 && s.insp === 320, `default sizes map ${s.map} · grid ${s.bottom} · inspector ${s.insp} (557 = 40% of the 1392 px body, live rule · 220 · 320)`);
  const st = s.stored;
  check(st.map === null && st.bottom === null && st.insp === null && !st.mapOff && !st.bottomOff && !st.inspOff, `a stale gs.frame.v1 (${JSON.stringify(STALE).slice(0, 40)}…) did not reach S.ui.frame`);
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('gs.frame.v1')).map) === 999, 'gs.frame.v1 itself is left untouched (never read, never written)');
  check(DOCK_IDS.every(Boolean) && (await page.evaluate(ids => ids.every(id => document.getElementById(id)), DOCK_IDS)), `all ${DOCK_IDS.length} frame nodes present`);
  check(await page.evaluate(() => window.GSFrame.dockHost('map') === document.getElementById('gsx-map-dock') && window.GSFrame.dockHost('grid') === document.getElementById('gsx-grid-dock')), 'GSFrame.dockHost(map|grid) returns #gsx-map-dock / #gsx-grid-dock');
  // Since M3 the bridge replaces the M1 empty state with "Loading network…" and then the mounted map and grid.
  const dockState = sel => page.evaluate(s => { const h = document.querySelector(s); return h.querySelector('.gsx-pane') ? 'mounted' : (h.innerText || '').trim().slice(0, 40); }, sel);
  check([await dockState('#gsx-map-dock'), await dockState('#gsx-grid-dock')].every(t => t === 'mounted' || /Loading network|loads here/.test(t)), 'map and grid docks show the module, its loading state or the empty state');
  check(/Select a bus or a card|Evidence/.test(await page.locator('#inspector').innerText()), 'inspector dock shows its empty state or the mounted Inspector (M4)');
}

// 1. splitters to both clamps (frame-only operations: no URL write)
{
  const w0 = await writes();
  const g = await geo();
  await drag('#gsf-split-v', -2000, 0); let s = await sizes();
  check(s.stored.map === 180 && Math.abs((await box('#gsf-dock-map')).width - 180) <= 1, `map splitter to its floor: ${s.stored.map} (180)`);
  await drag('#gsf-split-v', 3000, 0); s = await sizes();
  const mapMax = Math.max(220, g.bodyW - 420);
  check(s.stored.map === mapMax && Math.abs((await box('#gsf-dock-map')).width - mapMax) <= 1, `map splitter to its ceiling: ${s.stored.map} (body ${g.bodyW} − 420 = ${mapMax})`);
  await drag('#gsf-split-h', 0, -3000); s = await sizes();
  const gMax = Math.max(80, g.smH - 220);
  check(s.stored.bottom === gMax && Math.abs((await box('#gsf-dock-bottom')).height - gMax) <= 1, `grid splitter to its ceiling: ${s.stored.bottom} (sm ${g.smH} − 220 = ${gMax})`);
  await drag('#gsf-split-h', 0, 3000); s = await sizes();
  check(s.stored.bottom === 60 && Math.abs((await box('#gsf-dock-bottom')).height - 60) <= 1, `grid splitter to its floor: ${s.stored.bottom} (60)`);
  await drag('#gsf-split-i', -3000, 0); s = await sizes();
  check(s.stored.insp === 560 && Math.abs((await box('#gsf-insp')).width - 560) <= 1, `inspector splitter to its ceiling: ${s.stored.insp} (560)`);
  await drag('#gsf-split-i', 3000, 0); s = await sizes();
  check(s.stored.insp === 220 && Math.abs((await box('#gsf-insp')).width - 220) <= 1, `inspector splitter to its floor: ${s.stored.insp} (220)`);
  const st = await stored();
  check(st && st.insp === 220 && st.bottom === 60 && st.map === mapMax, 'drags are persisted in the one store (S.ui.frame)');
  const w1 = await writes();
  check(w1.hw === w0.hw && w1.hc === w0.hc && w1.hash === w0.hash, `no URL write from the splitters (history writes ${w1.hw - w0.hw}, hashchanges ${w1.hc - w0.hc})`);
}

// 2. each dock folds to its edge tab and back
await reset();
{
  const w0 = await writes();
  for (const [k, cls, dockSel] of [['map', 'gsf-map-off', '#gsf-dock-map'], ['bottom', 'gsf-bottom-off', '#gsf-dock-bottom'], ['insp', 'gsf-insp-off', '#gsf-insp']]) {
    await page.click(`[data-gsf-dock="${k}"][data-gsf-open="0"]`); await page.waitForTimeout(80);
    const off = await page.evaluate(c => document.getElementById('app').classList.contains(c), cls);
    const tab = page.locator(`${dockSel} > .gsf-tab`);
    check(off && await tab.isVisible() && (await sizes()).stored[`${k}Off`] === true, `${k}: collapse button folds the dock to its edge tab`);
    await tab.click(); await page.waitForTimeout(80);
    const on = !(await page.evaluate(c => document.getElementById('app').classList.contains(c), cls));
    check(on && !(await tab.isVisible()) && (await sizes()).stored[`${k}Off`] === false, `${k}: edge tab restores the dock`);
  }
  await page.evaluate(() => window.GSFrame.setDock('grid', false)); await page.waitForTimeout(50);
  check(await page.evaluate(() => document.getElementById('app').classList.contains('gsf-bottom-off')), 'GSFrame.setDock("grid", false) folds the grid');
  await page.reload(); await settle();
  check(await page.evaluate(() => document.getElementById('app').classList.contains('gsf-bottom-off')), 'a folded dock stays folded after a reload');
  const w1 = await writes();
  await page.evaluate(() => window.GSFrame.setDock('grid', true)); await page.waitForTimeout(50);
  const w2 = await writes();
  check(w2.hw === w1.hw && w2.hc === w1.hc && w2.hash === w1.hash, `no URL write from dock toggles (history writes ${w2.hw - w1.hw}, hashchanges ${w2.hc - w1.hc})`);
  void w0;
}

// 3. identity: 50 stage/tab changes keep the same dock nodes and sizes
{
  await drag('#gsf-split-i', -40, 0); // an explicit size, so "same sizes" is not just the defaults
  await page.evaluate(ids => ids.forEach((id, i) => { document.getElementById(id).__gsxMark = `m${i}`; }), DOCK_IDS);
  const s0 = await sizes();
  const STAGES = ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision'];
  let changes = 0;
  for (let i = 0; changes < 50; i++) {
    if (i % 2 === 0) await page.click(`#gsf-stages button[data-act="stage"][data-v="${STAGES[(i / 2) % 7]}"]`);
    else {
      try { await page.waitForSelector('[role="tab"]', { timeout: 30000 }); } catch { }
      const tabs = page.locator('.gsx-an [role="tab"]'), n = await tabs.count();
      if (n) await tabs.nth(i % n).click(); else await page.click(`#gsf-stages button[data-act="stage"][data-v="${STAGES[(i + 3) % 7]}"]`);
    }
    changes++;
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  const same = await page.evaluate(ids => ids.map((id, i) => document.getElementById(id)?.__gsxMark === `m${i}`), DOCK_IDS);
  check(same.every(Boolean), `identity: ${same.filter(Boolean).length} of ${DOCK_IDS.length} frame nodes are the same objects after ${changes} stage/tab changes${same.every(Boolean) ? '' : ` (changed: ${DOCK_IDS.filter((_, i) => !same[i]).join(', ')})`}`);
  const s1 = await sizes();
  check(s1.map === s0.map && s1.bottom === s0.bottom && s1.insp === s0.insp && s1.stored.insp === s0.stored.insp, `sizes kept: map ${s1.map} · grid ${s1.bottom} · inspector ${s1.insp}`);
  check(await page.locator('#board .board-in .gsx-an').count() === 1, 'the board re-rendered inside the same #board');
}

// 4. viewports: narrow/tight from the board width, no page overflow, docks in view
await reset();
for (const w of [760, 900, 1000, 1280, 1440, 1920]) {
  await page.setViewportSize({ width: w, height: w >= 1920 ? 1080 : 900 }); await page.waitForTimeout(250);
  const r = await page.evaluate(() => {
    const app = document.getElementById('app'), board = document.querySelector('#gsf-ws>.board');
    const ins = document.getElementById('gsf-insp').getBoundingClientRect();
    return { bw: board.clientWidth, narrow: app.classList.contains('gsf-narrow'), tight: app.classList.contains('gsf-tight'),
      over: document.documentElement.scrollWidth - innerWidth, insRight: ins.right, vw: innerWidth };
  });
  const s = await sizes();
  check(r.narrow === (r.bw > 0 && r.bw < 1000) && r.tight === (r.bw > 0 && r.bw < 800), `${w}: board ${r.bw}px → narrow ${r.narrow} · tight ${r.tight}`);
  check(r.over <= 0 && r.insRight <= r.vw + 1, `${w}: no page overflow (${r.over}px), inspector inside the window`);
  check(r.bw >= (w <= 760 ? 280 : 320), `${w}: the board keeps ${r.bw}px (map ${s.map} · inspector ${s.insp})`);
}
// 5. a phone-width window: the map and the inspector fold (effective only), the board stays clickable
{
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(250);
  const s = await sizes();
  check(s.mapOff && s.inspOff && s.autoFolded.join() === 'map,insp' && !s.stored.mapOff && !s.stored.inspOff, `390: map and inspector auto-fold (${s.autoFolded.join(', ')}); the stored choice stays open`);
  const tab = page.locator('.gsx-an [role="tab"]').nth(1);
  let clicked = true; try { await tab.click({ timeout: 5000 }); } catch { clicked = false; }
  check(clicked, '390: a board tab is clickable (no dock or splitter over the board)');
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(250);
  const s2 = await sizes();
  check(!s2.mapOff && !s2.inspOff && !s2.autoFolded.length, '1440 again: both docks are back');
}

check(!errors.length, `console errors: ${errors.slice(0, 5).join(' | ') || 'none'}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
