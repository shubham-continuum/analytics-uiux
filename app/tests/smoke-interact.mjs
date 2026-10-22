import { BASE, pwRequire } from './env.mjs';
// Interaction smoke: map click → selected card; zoom; facility drawer; grid slider; chart table toggle; sortable table.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
const U = `${BASE}/analytics-analyzer-studio.html`;
await page.goto(`${U}#stage=market&tab=find&bus=111403`); await page.waitForSelector('svg[data-map]', { timeout: 60000 });
const vb0 = await page.getAttribute('svg[data-map]', 'viewBox');
await page.click('.map-ctl [data-z="in"]');
check((await page.getAttribute('svg[data-map]', 'viewBox')) !== vb0, 'map zooms in');
await page.click('.map-ctl [data-z="reset"]');
// Market v3: the selected bus is a card titled "Selected bus"; its heading carries the bus id.
const selCard = page.locator('section.card', { has: page.locator('.card-h h3', { hasText: /^Requirements at bus$/ }) });
const pickId = await page.locator('circle.m-met').first().getAttribute('data-v');
await page.locator('circle.m-met').first().dispatchEvent('click');
await page.waitForTimeout(400);
check(await selCard.locator('.card-b').first().innerText().then(t => t.includes(pickId)), `clicking a bus fills the Requirements at bus card (bus ${pickId})`);
await page.locator('[data-act="map-layer"][data-k="unmet"]').uncheck();
check((await page.locator('circle.m-unmet').count()) === 0, 'layer toggle hides "does not meet"');
await page.goto(`${U}#stage=grid&tab=capacity&bus=111403`); await page.waitForSelector('.kpis');
await page.locator('[data-act="grid-size"]').fill('250'); await page.waitForTimeout(400);
check((await page.locator('.kpi .value').nth(2).innerText()).includes('97.2'), 'slider to 250 MW → margin −97.2 MW');
await page.goto(`${U}#stage=grid&tab=constraints&bus=111403&depth=study`); // v6: a facility row click highlights its line on the network map; its Details button opens the drawer.
await page.waitForSelector('tr.clickable [data-open-drawer]:visible');
await page.locator('tr.clickable [data-open-drawer]:visible').first().click();
check(await page.locator('.drawer .meter').first().isVisible(), 'facility row opens a drawer with loading meters');
await page.keyboard.press('Escape');
check((await page.locator('.drawer').count()) === 0, 'Escape closes the drawer');
await page.goto(`${U}#stage=prices&tab=lmp&bus=111403`); await page.waitForSelector('.chart-host');
await page.locator('[data-chart-view="table"]').first().click();
check(await page.locator('.chart-table:not([hidden]) table').first().isVisible(), 'Chart/Table toggle shows the table from the same array');
const th = page.locator('.table-wrap th.sortable-th:visible', { hasText: 'Hours' }).first();
if (await th.count()) { await th.click(); check((await th.getAttribute('aria-sort')) === 'ascending', 'table header sorts'); }
// Phase B: Prices, Queue, Land, Economics, Decision
await page.goto(`${U}#stage=prices&tab=shape&bus=111403`); await page.waitForSelector('.chart-host[data-title="Price by month and hour"] svg', { timeout: 60000 });
check((await page.locator('.chart-host[data-title="Price by month and hour"] svg rect').count()) >= 12 * 24, 'month × hour heatmap draws 288 cells');
await page.goto(`${U}#stage=prices&tab=tails&bus=111403`); await page.waitForSelector('[data-act="ui"][data-k="thr"]');
const hrs = async () => page.locator('.range-field:has-text("Hours above") b').innerText();
const h100 = await hrs(); await page.locator('[data-act="ui"][data-k="thr"]').fill('300'); await page.waitForTimeout(400);
check((await hrs()) !== h100, 'price threshold slider changes hours above');
await page.goto(`${U}#stage=queue&tab=schedule&bus=111403`);
await page.waitForSelector('.chart-host[data-title="Deadline chain"] svg', { timeout: 30000 }).catch(async e => {
  // diagnostics for an intermittent failure: what the page showed instead
  await page.screenshot({ path: 'tests/shots/interact-schedule-fail.png' });
  console.log('DIAG', await page.evaluate(() => ({ hash: location.hash, tab: document.querySelector('.gsx-an [role=tab][aria-selected=true]')?.textContent, stage: document.querySelector('#gsf-stages [aria-current=step]')?.textContent, text: document.querySelector('.gsx-an')?.innerText.slice(0, 300) })));
  throw e;
});
check((await page.locator('.chart-host[data-title="Deadline chain"] svg text', { hasText: 'Cluster Study Report deadline' }).count()) === 1, 'deadline chain draws the cluster study report deadline (S3: a deadline, not a schedule)');
await page.goto(`${U}#stage=queue&tab=cluster&bus=111403`); await page.waitForSelector('.kpis');
const qr = page.locator('tr.clickable[data-open-drawer^="q-"]').first();
if (await qr.count()) { await qr.click(); check(await page.locator('.drawer dl').isVisible(), 'queue request opens a detail drawer'); }
await page.goto(`${U}#stage=land&tab=corridor&bus=111403`); await page.waitForSelector('.kpis');
check((await page.locator('.drawer').count()) === 0, 'hash navigation closes an open drawer');
// The site map is redrawn when the async land/station data lands, which can detach the node between locate and scroll: retry on a fresh locator.
const sm = page.locator('svg[data-site-map]'); let bb = null;
for (let i = 0; i < 5 && !bb; i++) { try { await sm.waitFor({ state: 'attached' }); await sm.scrollIntoViewIfNeeded(); bb = await sm.boundingBox(); } catch (e) { if (!/not attached|detached/i.test(e.message) || i === 4) throw e; await page.waitForTimeout(300); } }
await page.mouse.click(bb.x + bb.width * 0.75, bb.y + bb.height * 0.5); await page.waitForTimeout(400);
check(/mi$/.test((await page.locator('.kpi .value').first().innerText()).trim()), 'clicking the land map places the site and sets a distance');
await page.goto(`${U}#stage=economics&tab=bess&bus=111403`); await page.waitForSelector('[data-act="ui"][data-k="week"]', { timeout: 90000 });
await page.locator('[data-act="ui"][data-k="week"]').fill('27'); await page.waitForTimeout(500);
check((await page.locator('.card-h h3', { hasText: 'Dispatch week' }).first().innerText()).includes('week 27'), 'dispatch week scrubber moves the window');
await page.goto(`${U}#stage=decision&tab=stress&bus=111403`); await page.waitForSelector('.kpis');
await page.waitForSelector('.chart-host[data-title="Capture price by scenario"], .gsx-an .empty', { timeout: 60000 }).catch(() => {});
check((await page.locator('.chart-host[data-title="Capture price by scenario"]').count()) === 1 || (await page.locator('.empty').count()) > 0, 'decision stress chart (or its empty state) renders');
await page.goto(`${U}#stage=decision&tab=readiness&bus=111403`); await page.waitForSelector('.kpis');
const go = page.locator('[data-act="goto-where"]').first();
if (await go.count()) { const v = await go.getAttribute('data-v'); await go.click(); await page.waitForTimeout(400); check(!(await page.locator('#gsf-stages [aria-current="step"]').innerText()).includes('Decision'), `Go link leaves Decision (${v})`); }
check(!errors.length, `console errors: ${errors.join(' | ') || 'none'}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
