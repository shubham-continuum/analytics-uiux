import { BASE, pwRequire } from './env.mjs';
// Screenshots of the four Decision tabs at 1440 and 390 px, with two added options (node tests/decision-shots.mjs [bus] [add1,add2] [tech]).
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const [bus = '111403', adds = '100178,114417', tech = 'solar'] = process.argv.slice(2);
const b = await chromium.launch({ channel: 'chrome' });
const errors = [];
for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await b.newPage({ viewport: vp });
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${vp.width}] ${m.text()}`); }); page.on('pageerror', e => errors.push(`[${vp.width}] ${e}`));
  await page.goto(`${BASE}/decision.html#tab=compare&bus=${bus}`);
  await page.waitForSelector('.kpis', { timeout: 180000 }).catch(async e => { console.log('TIMEOUT', (await page.locator('body').innerText()).slice(0, 800), errors.join(' | ')); throw e; });
  await page.selectOption('[data-act="tech"]', tech);
  for (const id of (adds ? adds.split(',') : [])) {
    if (await page.locator(`[data-act="d-remove"][data-v="${id}"]`).count()) continue;
    await page.fill('[data-act="d-add"]', id); await page.locator('[data-act="d-add"]').dispatchEvent('change');
    await page.waitForFunction(i => document.querySelector('.main')?.innerText.includes(i), id, { timeout: 180000 });
  }
  await page.waitForFunction(() => !/Loading/.test(document.querySelector('.main')?.innerText || ''), null, { timeout: 180000 }).catch(() => {});
  for (const tab of ['compare', 'stress', 'readiness', 'record']) {
    await page.click(`[data-act="tab"][data-v="${tab}"]`);
    await page.waitForFunction(() => !/Loading/.test(document.querySelector('.main')?.innerText || ''), null, { timeout: 180000 }).catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: `tests/shots/decision-${tab}-${vp.width}.png`, fullPage: true });
    const hs = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (hs) errors.push(`[${vp.width}] ${tab}: horizontal scroll`);
  }
  await page.close();
}
await b.close();
console.log(errors.length ? errors.join('\n') : 'no console errors, no horizontal scroll');
