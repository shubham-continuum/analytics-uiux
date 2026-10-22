import { BASE, pwRequire } from './env.mjs';
// V6 sweep for Prices and Economics at 1440×900, Review depth, five fuels: screenshots (above the fold and full page)
// plus the V6 contract — every visible card (not the trace card) opens with a .card-answer sentence, each tab ends with
// one .next-step, no NaN/undefined anywhere, no console error, and every map draws the basemap.
// Run: node tests/prices-v6-shots.mjs [prices|economics] [bus] [fuels,comma]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = pwRequire;
const { chromium } = require('playwright');
const [page0 = 'prices', bus = '111403', fuelArg] = process.argv.slice(2);
const FUELS = (fuelArg || 'solar,wind,storage,hybrid,datacenter').split(',');
const TABS = { prices: ['lmp', 'basis', 'shape', 'tails'], economics: ['revenue', 'bess', 'hybrid', 'finance'] }[page0];
mkdirSync('tests/shots/v6', { recursive: true });
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${BASE}/${page0}.html#tab=${TABS[0]}&bus=${bus}&depth=review`);
await page.waitForSelector('.kpis, .notice, .empty', { timeout: 120000 });
for (const fuel of FUELS) {
  await page.selectOption('[data-act="tech"]', fuel); await page.waitForTimeout(300);
  if (fuel === 'datacenter') { const opts = await page.locator('[data-act="import"] option').evaluateAll(o => o.map(x => x.value)); const v = opts.find(x => Number(x) >= 100) || opts.at(-1); await page.selectOption('[data-act="import"]', v); await page.waitForTimeout(300); }
  const dep = page.locator('[data-act="depth"][data-v="review"]').first();
  if (await dep.isVisible().catch(() => false)) { await dep.click(); await page.waitForTimeout(200); }
  for (const tab of TABS) {
    const n0 = errors.length;
    await page.click(`[data-act="tab"][data-v="${tab}"]`);
    await page.waitForSelector('.kpis, .notice, .empty', { timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('.loading-panel') && ![...document.querySelectorAll('.kpi .value, .card-b .empty strong')].some(v => /loading/i.test(v.innerText)), null, { timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const vis = el => el.offsetParent !== null && !el.hidden;
      const cards = [...document.querySelectorAll('main section.card')].filter(c => vis(c) && !c.classList.contains('card-trace'));
      const noAns = cards.filter(c => !c.querySelector(':scope > .card-b > .card-answer') && !c.querySelector('.card-b > .empty strong')?.innerText.startsWith('Not applicable')).map(c => c.querySelector('h3')?.innerText);
      const maps = [...document.querySelectorAll('main svg[data-map]')].map(s => ({ id: s.dataset.map, base: !!s.querySelector('.gm-base') }));
      const answers = cards.map(c => c.querySelector('.card-answer')?.innerText || '').filter(Boolean);
      const firstAnswerTop = document.querySelector('main .card-answer')?.getBoundingClientRect().top ?? null;
      return { n: cards.length, noAns, next: document.querySelectorAll('main .next-step').length, maps, answers, firstAnswerTop };
    });
    const body = await page.locator('main').innerText();
    const label = await page.locator(`[data-act="tab"][data-v="${tab}"]`).innerText();
    const L = `${page0} ${fuel} ${tab} (${label})`;
    check(!/\bNaN\b|undefined|Infinity/.test(body), `${L}: no NaN/undefined`);
    check(!r.noAns.length, `${L}: ${r.n} cards, every one answers first ${r.noAns.length ? JSON.stringify(r.noAns) : ''}`);
    check(r.next === 1, `${L}: one Next step (${r.next})`);
    check(r.maps.every(m => m.base), `${L}: maps draw the basemap ${JSON.stringify(r.maps)}`);
    check(r.firstAnswerTop != null && r.firstAnswerTop < 900, `${L}: an answer is above the fold (top ${Math.round(r.firstAnswerTop ?? -1)} px)`);
    check(errors.length === n0, `${L}: no console error ${errors.slice(n0).join(' | ').slice(0, 300)}`);
    await page.screenshot({ path: `tests/shots/v6/${page0}-${tab}-${fuel}.png` });
    await page.screenshot({ path: `tests/shots/v6/${page0}-${tab}-${fuel}-full.png`, fullPage: true });
  }
}
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
