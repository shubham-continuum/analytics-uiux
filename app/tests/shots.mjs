import { BASE, pwRequire } from './env.mjs';
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const [stage, tabs, prefix] = [process.argv[2], process.argv[3].split(','), process.argv[4] || process.argv[2]];
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
for (const t of tabs) { await p.goto(`${BASE}/analytics-analyzer-studio.html#stage=${stage}&tab=${t}&bus=111403`); await p.waitForSelector('.tabs'); await p.waitForTimeout(400); await p.screenshot({ path: `tests/shots/${prefix}-${t}.png`, fullPage: true }); }
await b.close();
