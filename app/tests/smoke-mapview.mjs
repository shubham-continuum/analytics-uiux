import { BASE, pwRequire } from './env.mjs';
// Browser smoke for the Map tabs of Market, Land and Grid (2026-10-23): the stage bar (the map and the four analyses as
// buttons, data-act="tab"), each analysis on its own tab as before, and the map's panels and input groups folding in
// place (no board render: the board's DOM, the map's drawing and the scroll stay put).
const { chromium } = pwRequire('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const STAGES = [
  { key: 'market', map: 'market-map', tabs: ['find', 'rank', 'size', 'regions'], filter: 'mktFilters' },
  { key: 'land', map: 'land-map', tabs: ['area', 'footprint', 'corridor', 'permits'], filter: 'landFilters' },
  { key: 'grid', map: 'grid-map', tabs: ['capacity', 'constraints', 'cost', 'mitigation'], filter: 'gridFilters' },
];
const b = await chromium.launch({ channel: 'chrome' });
try {
  for (const vp of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
    const page = await b.newPage({ viewport: vp }); const errors = [];
    page.on('console', m => { if (m.type() === 'error' && !/Bus not held/.test(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
    for (const st of STAGES) {
      const tag = `[${vp.width}] ${st.key}`;
      await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=${st.key}&tab=map&bus=111403`);
      await page.waitForSelector(`.mk-bar .mk-tab.on[data-k="map"]`, { timeout: 90000 });
      await page.waitForSelector(`svg[data-map="${st.map}"]`, { timeout: 60000 });
      const ids = await page.locator('.mk-bar [data-act="tab"]').evaluateAll(bs => bs.map(x => x.dataset.v));
      check(JSON.stringify(ids) === JSON.stringify(['map', ...st.tabs]), `${tag}: the bar holds the map and the four analyses (${ids.join(', ')})`);
      check((await page.locator('.tabs[role="tablist"]').count()) === 0, `${tag}: no second tab bar`);
      const results = await page.locator('.mk-bar .mk-tab-r').allInnerTexts();
      check(results.length === 5 && results.every(t => t.trim() && !/NaN|undefined/.test(t)), `${tag}: every button shows its result`);
      // a panel folds in place: the board is not rebuilt, the map's drawing and frame stay
      if (vp.width >= 1100) {
        await page.waitForLoadState('networkidle').catch(() => {});
        // the panel starts folded on a board under 720 px (the docks narrow it): open it from its button first
        if (await page.evaluate(() => getComputedStyle(document.querySelector('.mk-wb .mk-ff')).display === 'none')) {
          await page.click(`.mk-ff-min[data-k="${st.filter}"]`);
          await page.waitForFunction(() => getComputedStyle(document.querySelector('.mk-wb .mk-ff')).display !== 'none');
        }
        await page.evaluate(() => { window.__mkProbe = { an: document.querySelector('.gsx-an'), svg: document.querySelector('.mk-map-wrap svg[data-map]') }; });
        const vb0 = await page.getAttribute(`svg[data-map="${st.map}"]`, 'viewBox');
        await page.click(`.mk-ff .mk-x[data-k="${st.filter}"]`);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.mk-wb .mk-ff')).display === 'none');
        const same = await page.evaluate(() => window.__mkProbe.an === document.querySelector('.gsx-an') && window.__mkProbe.svg === document.querySelector('.mk-map-wrap svg[data-map]'));
        check(same, `${tag}: folding the inputs panel rebuilds nothing (same board, same map drawing)`);
        check((await page.getAttribute(`svg[data-map="${st.map}"]`, 'viewBox')) === vb0, `${tag}: the map does not move when the panel folds`);
        await page.click(`.mk-ff-min[data-k="${st.filter}"]`);
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.mk-wb .mk-ff')).display !== 'none');
        const sec = page.locator('.mk-ff .mk-sec-h').first();
        await sec.click();
        check(await page.evaluate(() => !!document.querySelector('.mk-ff .mk-sec[data-shut]') && window.__mkProbe.an === document.querySelector('.gsx-an')), `${tag}: an input group folds in place`);
        await sec.click();
        check(await page.evaluate(() => !document.querySelector('.mk-ff .mk-sec[data-shut]')), `${tag}: and unfolds`);
      }
      // each analysis is its own tab again: a button opens it, the page starts at the top with its cards
      for (const t of st.tabs) {
        await page.click(`.mk-bar [data-act="tab"][data-v="${t}"]`);
        await page.waitForSelector(`.mk-bar .mk-tab.on[data-k="${t}"]`);
        await page.waitForSelector(`.mk-tabpage[data-tab="${t}"] section.card`, { timeout: 60000 });
        const top = await page.evaluate(() => document.querySelector('#board').scrollTop);
        const n = await page.locator(`.mk-tabpage[data-tab="${t}"] section.card:not([hidden])`).count();
        check(n >= 3 && top === 0, `${tag}/${t}: its own tab, ${n} cards, from the top`);
      }
      // the arrow keys move along the bar
      await page.focus(`.mk-bar [data-act="tab"][data-v="${st.tabs[3]}"]`);
      await page.keyboard.press('Home');
      await page.waitForSelector(`.mk-bar .mk-tab.on[data-k="map"]`);
      check(true, `${tag}: Home on the bar goes back to the map`);
      // a former link (a tab id in the URL) opens that tab
      await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=${st.key}&tab=${st.tabs[3]}&bus=111403`);
      await page.waitForSelector(`.mk-bar .mk-tab.on[data-k="${st.tabs[3]}"]`, { timeout: 60000 });
      check(true, `${tag}: tab=${st.tabs[3]} in the URL opens it`);
      check(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), `${tag}: no horizontal page scroll`);
    }
    // a chip clears its input through the input's own action (Market: the price cap)
    if (vp.width >= 1100) {
      await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=market&tab=map&bus=111403`);
      await page.waitForSelector('.mk-ff [data-act="mkt"][data-k="maxPrice"]', { timeout: 60000 });
      await page.fill('.mk-ff [data-act="mkt"][data-k="maxPrice"]', '60'); await page.locator('.mk-ff [data-act="mkt"][data-k="maxPrice"]').dispatchEvent('change');
      await page.waitForSelector('.mk-bar .mk-chip[data-a="mkt"][data-k="maxPrice"]');
      check((await page.locator('[data-act="mkt"][data-k="maxPrice"]').count()) === 1, '[market] the price-cap selector finds the input only (the chip has its own action)');
      await page.click('.mk-bar .mk-chip[data-a="mkt"][data-k="maxPrice"]');
      await page.waitForFunction(() => !document.querySelector('.mk-bar .mk-chip[data-k="maxPrice"]'));
      check((await page.inputValue('.mk-ff [data-act="mkt"][data-k="maxPrice"]')) === '', '[market] the chip × clears the price cap');
    }
    check(!errors.length, `[${vp.width}] console errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
    await page.evaluate(() => localStorage.clear()); await page.close();
  }
} finally { await b.close(); }
console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
