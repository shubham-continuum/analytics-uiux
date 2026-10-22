import { BASE, pwRequire } from './env.mjs';
// Studio-parity smoke: the live Studio link opens the same context here; the chrome matches the live grammar;
// every stage × depth × fuel renders with no console error and no "NaN"; the (i) icon reaches a calculation.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const U = `${BASE}/analytics-analyzer-studio.html`;
const LIVE = 'v=stage&stage=market&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&cmp=o1,o2&pins=111403,100178';
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
const settle = async () => { await page.waitForSelector('[role="tabpanel"] .kpis, [role="tabpanel"] .empty, [role="tabpanel"] .notice, [role="tabpanel"] .card', { timeout: 90000 }); await page.waitForTimeout(600); };

// 1. the live link
await page.goto(`${U}#${LIVE}`); await page.waitForSelector('.walk-name', { timeout: 60000 }); await settle();
const h = await page.evaluate(() => location.hash);
check(/stage=market/.test(h) && /project=kennebec/.test(h) && /option=o2/.test(h) && /depth=review/.test(h), `live link lands on Market · kennebec o2 · Review (${h.slice(0, 90)}…)`);
check(/pins=111403,100178/.test(h), 'the link’s pins are kept (not replaced by the sample’s)');
check(/bus=111209/.test(h), 'option o2 opens its bus (Hatchville 111209)');
check(/case=sp/.test(h) && /hz=2030/.test(h) && /hist=2025/.test(h), 'case, horizon and history year survive');
check(/cmp=(o2,o1|o1,o2)/.test(h), 'cmp carries both options');
check((await page.locator('#gsf-stages [data-gsf-stage]:not([data-gsf-stage="iso"])').count()) === 7 && /1\s*·?\s*Market/.test(await page.locator('#gsf-stages [aria-current="step"]').innerText()), 'stage strip: 7 numbered stages, Market active');
check((await page.locator('.gswf-sel .gswf-opt').count()) === 3 && /Hatchville/.test(await page.locator('.gswf-opt.on').innerText()), 'option chips: 3 kennebec options, o2 current');
check(/Stage 1 of 7/i.test(await page.locator('.mk-question .kick').innerText()), 'eyebrow reads STAGE 1 OF 7');
check((await page.locator('.w-tools [data-act="card-expand"]').count()) > 3, 'cards carry the expand icon');
const liveLinks = await page.locator('a[href*="127.0.0.1:8103"]').count();
check(liveLinks === 0, 'no link to the live Studio (:8103) remains (M5 §3: One Studio is the one URL)');
await page.locator('.gswf-opt', { hasText: 'Mashpee' }).click(); await page.waitForTimeout(800);
check(/option=o1/.test(await page.evaluate(() => location.hash)) && /bus=111403/.test(await page.evaluate(() => location.hash)), 'clicking an option chip switches option and bus');
await page.click('[data-act="open-evidence"]'); await page.waitForSelector('.modal[aria-label="Inputs and evidence"]');
check((await page.locator('.modal[aria-label="Inputs and evidence"] table').count()) >= 2, 'Inputs & evidence lists basis and hand-offs');
await page.click('.modal-head [data-act="close-modal"]');
// 1b. a live link to another stage opens the project's first stop on that stage
await page.goto(`${U}#${LIVE.replace('stage=market', 'stage=economics')}`); await page.waitForTimeout(500); await page.reload(); await page.waitForSelector('.walk-name', { timeout: 60000 }); await settle();
check(/stage=economics/.test(await page.evaluate(() => location.hash)) && /Economics/.test(await page.locator('#gsf-stages [aria-current="step"]').innerText()), 'a live link to Economics opens Economics, not the walkthrough start');
// 1c. one gate engine (Findings F001): the band's Decision-gate verdicts are identical on every stage and in Decision
{
  const band = async st => { await page.goto(`${U}#stage=${st}&bus=111209&depth=review${st === 'decision' ? '&tab=compare' : ''}`); await page.waitForTimeout(400); await page.reload(); await page.waitForTimeout(8000);
    return page.evaluate(() => [...document.querySelectorAll('.summary .facts > div')].find(d => /Decision gates/.test(d.textContent))?.querySelector('b')?.textContent || ''); };
  const g = await band('grid'), d = await band('decision');
  check(g && g === d && /Pass/.test(g), `one verdict everywhere: Grid "${g}" = Decision "${d}"`);
}
// 2. (i) reaches a calculation (raising depth when needed)
await page.goto(`${U}#stage=prices&tab=lmp&bus=111403&depth=review`); await settle();
const info = page.locator('.card-icons [data-act="card-trace"]').first();
if (await info.count()) { await info.click(); await page.waitForTimeout(1200); check(await page.locator('details.trace[open]').count() > 0, '(i) opens a calculation trace'); }
else check(false, 'Prices LMP has a (i) icon');
// 3. shortcuts
await page.locator('body').press('3'); await page.waitForTimeout(600);
check(/stage=grid/.test(await page.evaluate(() => location.hash)), 'key 3 opens Grid');
// 4. matrix: every stage × depth × fuel, no console error, no NaN
const stages = ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision'];
const fuels = [['solar', 100, 0], ['wind', 100, 0], ['storage', 100, 100], ['hybrid', 100, 50], ['datacenter', 0, 250]];
let cells = 0, nan = [];
await page.evaluate(() => { try { localStorage.removeItem('gspreview.analyzer.v1'); } catch { } });
for (const [tech, ex, im] of fuels) {
  await page.goto(`${U}#stage=market&bus=111403&depth=review`); await settle();
  await page.selectOption('[data-act="tech"]', tech); await page.waitForTimeout(300);
  if (await page.locator('[data-act="export"]').isVisible()) { await page.selectOption('[data-act="export"]', String(ex)); await page.waitForTimeout(200); }
  if (await page.locator('[data-act="import"]').isVisible()) { await page.selectOption('[data-act="import"]', String(im)); await page.waitForTimeout(200); }
  for (const st of stages) for (const d of ['screen', 'review', 'study']) {
    await page.evaluate(([st, d]) => { location.hash = `stage=${st}&bus=111403&depth=${d}`; }, [st, d]);
    try { await settle(); } catch { nan.push(`${tech}/${st}/${d}: no panel`); continue; }
    const txt = await page.locator('[role="tabpanel"]').innerText();
    if (/\bNaN\b|undefined\b/.test(txt)) nan.push(`${tech}/${st}/${d}`);
    cells++;
  }
}
check(cells === 105, `rendered ${cells} of 105 stage × depth × fuel cells`);
check(!nan.length, `no NaN/undefined in any panel${nan.length ? `: ${nan.slice(0, 8).join(', ')}` : ''}`);
check(!errors.length, `console errors: ${errors.slice(0, 5).join(' | ') || 'none'}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
