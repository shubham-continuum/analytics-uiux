import { BASE, pwRequire } from './env.mjs';
// Screenshots of the four Prices tabs at 1440 and 390 px (full page), after every endpoint has landed.
// Run: node tests/prices-shots.mjs [bus] [tabs]   → tests/shots/prices-<tab>-<width>[-<bus>].png
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = pwRequire;
const { chromium } = require('playwright');
const [bus = '111209', tabsArg = 'lmp,basis,shape,tails', widths = '1440,390'] = process.argv.slice(2);
mkdirSync('tests/shots', { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const errors = [];
for (const w of widths.split(',').map(Number)) {
  const page = await b.newPage({ viewport: { width: w, height: 900 } });
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${w}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${w}] ${e}`));
  for (const tab of tabsArg.split(',')) {
    await page.goto(`${BASE}/prices.html#tab=${tab}&bus=${bus}`);
    await page.waitForSelector('.kpis', { timeout: 180000 });
    await page.waitForFunction(() => !document.querySelector('.empty strong') || ![...document.querySelectorAll('.empty strong')].some(e => /^Loading/.test(e.textContent)), null, { timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: `tests/shots/prices-${tab}-${w}${bus === '111209' ? '' : `-${bus}`}.png`, fullPage: true });
    const bad = await page.evaluate(() => document.body.innerText.match(/NaN|undefined|Infinity/g)?.length || 0);
    const hs = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    console.log(`${tab} @${w}: ${bad ? `${bad} NaN/undefined` : 'clean'}${hs ? ' · HORIZONTAL SCROLL' : ''}`);
  }
  await page.close();
}
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');
await b.close();
