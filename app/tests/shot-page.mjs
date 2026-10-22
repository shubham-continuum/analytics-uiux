import { BASE, pwRequire } from './env.mjs';
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const [hash, name, click] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome' }); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
await p.goto(`${BASE}/analytics-analyzer-studio.html#${hash}`); await p.waitForSelector('.kpis', { timeout: 60000 }); await p.waitForTimeout(600);
if (click) { await p.locator(click).first().dispatchEvent('click'); await p.waitForTimeout(400); }
await p.screenshot({ path: `tests/shots/${name}.png`, fullPage: false }); await b.close();
