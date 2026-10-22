import { BASE, pwRequire } from './env.mjs';
// Grid + Queue v6: screenshots of every tab at 1440×900 for solar / storage / datacenter, plus page checks:
// a card-answer in every visible card, one Next step per tab, maps on the shared basemap, the selected facility
// highlighted, the g-netmap trace reconciles, no NaN/undefined, no console errors, no inline <style> in the panel.
// node tests/grid-queue-v6-shots.mjs [bus=111403] [depth=review]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = pwRequire;
const { chromium } = require('playwright');
const bus = process.argv[2] || '111403', depth = process.argv[3] || 'review';
const OUT = new URL('./shots/v6/', import.meta.url); mkdirSync(OUT, { recursive: true });
const PAGES = { grid: ['capacity', 'constraints', 'cost', 'mitigation'], queue: ['cluster', 'schedule', 'cash', 'changes'] };
const fails = []; const check = (c, m) => { if (!c) { fails.push(m); console.log(`FAIL ${m}`); } };
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e)));
for (const [page, tabs] of Object.entries(PAGES)) for (const fuel of ['solar', 'storage', 'datacenter']) {
  await p.goto(`${BASE}/${page}.html#tab=${tabs[0]}&bus=${bus}&depth=${depth}`); await p.waitForSelector('.kpis', { timeout: 120000 });
  await p.selectOption('[data-act="tech"]', fuel); await p.waitForTimeout(400);
  for (const tab of tabs) {
    console.log('tab', page, fuel, tab); await p.click(`[data-act="tab"][data-v="${tab}"]`); try { await p.waitForSelector('.kpis', { timeout: 20000 }); } catch { check(false, `${page}/${fuel}/${tab}: no KPIs rendered; errors: ${errors.slice(-2).join(' | ')}`); continue; } await p.waitForTimeout(4500);
    const tag = `${page}/${fuel}/${tab}`;
    const r = await p.evaluate(() => {
      const panel = document.querySelector('[role="tabpanel"]') || document.body;
      const cards = [...panel.querySelectorAll('section.card:not(.card-trace)')].filter(c => !c.hidden && c.offsetParent);
      return { cards: cards.length, noAnswer: cards.filter(c => !c.querySelector('.card-answer') && !c.querySelector('.loading-inline')).map(c => c.querySelector('h3')?.textContent),
        next: panel.querySelectorAll('.next-step').length, styles: panel.querySelectorAll('style').length, maps: [...panel.querySelectorAll('svg.gm')].map(s => s.querySelector('.gm-land')?.getAttribute('d')?.length || 0),
        text: panel.innerText, firstAnswerTop: (cards[0]?.querySelector('.card-answer')?.getBoundingClientRect().top) ?? null };
    });
    check(r.noAnswer.length === 0, `${tag}: cards without an answer: ${r.noAnswer.join(' | ')}`);
    check(r.next === 1, `${tag}: ${r.next} Next steps`);
    check(r.styles === 0, `${tag}: ${r.styles} inline <style> blocks`);
    check(!/\bNaN\b|undefined|Infinity/.test(r.text), `${tag}: NaN/undefined in the page`);
    check(r.firstAnswerTop != null && r.firstAnswerTop < 900, `${tag}: first answer above the fold (${r.firstAnswerTop})`);
    if ((page === 'grid' && tab === 'constraints') || (page === 'queue' && tab === 'cluster')) check(r.maps.length === 1 && r.maps[0] > 1000, `${tag}: one geoMap with basemap land (${r.maps})`);
    await p.screenshot({ path: fileURLToPath(new URL(`${page}-${fuel}-${tab}.png`, OUT)) });
  }
}
// Selection: a facility row highlights its line; the netmap trace reconciles at Study.
await p.goto(`${BASE}/grid.html#tab=constraints&bus=${bus}&depth=study`); await p.waitForSelector('.kpis'); await p.selectOption('[data-act="tech"]', 'solar'); await p.waitForTimeout(5000);
await p.locator('details.more-ctl summary', { hasText: 'Facility table' }).first().click();
await p.locator('tr[data-k="gfac"]').first().click(); await p.waitForTimeout(800);
check(await p.locator('svg.gm line.gm-sel').count() === 1, 'selected facility line carries gm-sel');
const tr = p.locator('details.trace[data-trace="g-netmap"]'); check(await tr.count() === 1, 'g-netmap trace present');
if (await tr.count()) { await tr.evaluate(d => { d.open = true; }); const t = await tr.innerText(); check(!/Does not reconcile|NaN/.test(t), 'g-netmap trace reconciles'); }
await p.screenshot({ path: fileURLToPath(new URL('grid-solar-constraints-selected.png', OUT)) });
// The Next step goes where it says: Grid › Connection capacity → Constraints & coverage.
await p.goto(`${BASE}/grid.html#tab=capacity&bus=${bus}&depth=review`); await p.waitForSelector('.kpis'); await p.waitForTimeout(1500);
await p.locator('.next-step [data-act="goto"]').click(); await p.waitForTimeout(1500);
check(/Lowest facility limit/i.test(await p.locator('.kpis').first().innerText()), 'Next step opens Constraints & coverage');
check(!errors.length, `console errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
