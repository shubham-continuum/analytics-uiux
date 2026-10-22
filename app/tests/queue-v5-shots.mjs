import { BASE, pwRequire } from './env.mjs';
// Queue v5: every tab × fuels × depths at 1440; checks data-depth on every card, no NaN, v5 traces reconcile at Study.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const fuels = (process.argv[2] || 'solar,storage,datacenter').split(','), depths = ['screen', 'review', 'study'];
const V5 = { cluster: ['q-ratio', 'q-service'], cash: ['q-exempt'] };
const fails = []; const check = (c, m) => { if (!c) { fails.push(m); console.log(`FAIL ${m}`); } };
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
p.on('pageerror', e => errors.push(String(e))); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
for (const fuel of fuels) for (const depth of depths) {
  await p.goto(`${BASE}/queue.html#tab=cluster&bus=111403&depth=${depth}`); await p.waitForSelector('.kpis', { timeout: 120000 });
  await p.selectOption('[data-act="tech"]', fuel); await p.waitForTimeout(300);
  for (const tab of ['cluster', 'schedule', 'cash', 'changes']) {
    await p.click(`[data-act="tab"][data-v="${tab}"]`); await p.waitForSelector('.kpis'); await p.waitForTimeout(1200);
    check(!(await p.locator('[role="tabpanel"] section.card:not([data-depth])').count()), `${fuel}/${depth}/${tab}: card without data-depth`);
    check(!/\bNaN\b|undefined|Infinity/.test(await p.locator('[role="tabpanel"]').innerText()), `${fuel}/${depth}/${tab}: NaN`);
    if (depth === 'study') for (const id of V5[tab] || []) { if (fuel === 'datacenter' && id === 'q-exempt') continue; const t = p.locator(`details.trace[data-trace="${id}"]`); if (!(await t.count())) { check(false, `${fuel}/${tab}: ${id} present`); continue; } await t.evaluate(d => { d.open = true; }); const tb = await t.innerText(); check(!/Does not reconcile/.test(tb) && /Reconciles|No check possible/.test(tb), `${fuel}/${tab}/${id}: check`); }
    await p.screenshot({ path: `tests/shots/queue-v5-${fuel}-${depth}-${tab}.png`, fullPage: true });
  }
}
check(!errors.length, `console errors: ${errors.slice(0, 3).join(' | ')}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
