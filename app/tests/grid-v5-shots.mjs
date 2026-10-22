import { BASE, pwRequire } from './env.mjs';
// Grid v5: screenshots of every tab at screen / review / study × fuels (1440 wide), plus checks on the rendered page:
// every card carries data-depth, the v5 traces render at Study without "Does not reconcile" or NaN, no console errors.
// node tests/grid-v5-shots.mjs [bus=111403] [fuels=solar,wind,storage,hybrid,datacenter] [depths=screen,review,study]
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const bus = process.argv[2] || '111403';
const fuels = (process.argv[3] || 'solar,wind,storage,hybrid,datacenter').split(',');
const depths = (process.argv[4] || 'screen,review,study').split(',');
const TABS = ['capacity', 'constraints', 'cost', 'mitigation'];
const V5 = { capacity: ['g-capacity', 'g-wscr', 'g-surplus'], constraints: ['g-affected'], cost: ['g-prop', 'g-1920'], mitigation: ['g-mitigation'] };
const fails = []; const check = (c, m) => { if (!c) fails.push(m); if (!c) console.log(`FAIL ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); p.on('pageerror', e => errors.push(String(e)));
for (const fuel of fuels) for (const depth of depths) {
  await p.goto(`${BASE}/grid.html#tab=capacity&bus=${bus}&depth=${depth}`); await p.waitForSelector('.kpis', { timeout: 120000 });
  await p.selectOption('[data-act="tech"]', fuel); await p.waitForTimeout(300);
  for (const tab of TABS) {
    await p.click(`[data-act="tab"][data-v="${tab}"]`); await p.waitForSelector('.kpis');
    await p.waitForTimeout(depth === 'screen' ? 1500 : 4000);
    const noDepth = await p.locator('[role="tabpanel"] section.card:not([data-depth])').count();
    check(noDepth === 0, `${fuel}/${depth}/${tab}: ${noDepth} card(s) without data-depth`);
    const body = await p.locator('[role="tabpanel"]').innerText();
    check(!/\bNaN\b|undefined|Infinity/.test(body), `${fuel}/${depth}/${tab}: NaN/undefined in the page`);
    if (depth === 'study') for (const id of V5[tab]) {
      const t = p.locator(`details.trace[data-trace="${id}"]`);
      if (!(await t.count())) { check(false, `${fuel}/${tab}: trace ${id} present`); continue; }
      await t.evaluate(d => { d.open = true; });
      const tb = await t.innerText();
      check(!/Does not reconcile/.test(tb), `${fuel}/${tab}/${id}: reconciles`);
      check(/Reconciles|No check possible/.test(tb), `${fuel}/${tab}/${id}: carries a check`);
    }
    await p.screenshot({ path: `tests/shots/grid-v5-${fuel}-${depth}-${tab}.png`, fullPage: true });
  }
}
check(!errors.length, `console errors: ${errors.slice(0, 5).join(' | ') || 'none'}`);
await b.close();
console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
