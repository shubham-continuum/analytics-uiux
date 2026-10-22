import { BASE, pwRequire } from './env.mjs';
// Debug helper: open one Economics tab and print console errors, failed requests and the start of the tab text.
// node tests/economics-debug.mjs <tab> [bus] [tech]
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const [tab = 'revenue', bus = '111403', tech] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text()); });
page.on('pageerror', e => console.log('pageerror', String(e)));
page.on('requestfailed', r => console.log('requestfailed', r.url(), r.failure()?.errorText));
await page.goto(`${BASE}/economics.html#tab=${tab}&bus=${bus}`);
await page.waitForTimeout(8000);
if (tech) { await page.selectOption('[data-act="tech"]', tech); await page.waitForTimeout(3000); }
for (let i = 0; i < 90 && await page.locator('.loading-panel').count(); i++) await page.waitForTimeout(1000);
await page.waitForTimeout(1500);
const t = await page.locator('[role="tabpanel"]').innerText().catch(() => page.locator('#app').innerText());
console.log(t.slice(0, 1500));
await page.screenshot({ path: `tests/shots/econ-debug-${tab}.png`, fullPage: true });
await b.close();
