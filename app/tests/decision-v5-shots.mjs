import { BASE, pwRequire } from './env.mjs';
// Decision v5: every fuel × every depth on the four tabs (1440 px), with two added options. Screenshots to
// tests/shots/v5/decision-<tech>-<depth>-<tab>.png; reports console errors, NaN/undefined and horizontal scroll.
// node tests/decision-v5-shots.mjs [techs=solar,wind,storage,hybrid,datacenter] [depths=screen,review,study]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = pwRequire;
const { chromium } = require('playwright');
const [techs = 'solar,wind,storage,hybrid,datacenter', depths = 'screen,review,study', bus = '111403', adds = '100178,114417'] = process.argv.slice(2);
mkdirSync('tests/shots/v5', { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [], notes = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
const idle = () => page.waitForFunction(() => !/Loading/.test(document.querySelector('.main')?.innerText || ''), null, { timeout: 180000 }).catch(() => {});
await page.goto(`${BASE}/decision.html#tab=compare&bus=${bus}&depth=review`);
await page.waitForSelector('.kpis', { timeout: 180000 });
for (const id of adds.split(',').filter(Boolean)) {
  await page.fill('[data-act="d-add"]', id); await page.locator('[data-act="d-add"]').dispatchEvent('change');
  await page.waitForFunction(i => document.querySelector('.main')?.innerText.includes(i), id, { timeout: 180000 });
}
for (const tech of techs.split(',')) {
  await page.selectOption('[data-act="tech"]', tech); await idle();
  for (const depth of depths.split(',')) {
    await page.click(`[data-act="depth"][data-v="${depth}"]`); await idle();
    for (const tab of ['compare', 'stress', 'readiness', 'record']) {
      await page.click(`[data-act="tab"][data-v="${tab}"]`); await idle(); await page.waitForTimeout(500);
      const txt = await page.locator('[role="tabpanel"]').innerText();
      if (/\bNaN\b|undefined|Infinity/.test(txt)) notes.push(`${tech}/${depth}/${tab}: NaN/undefined in text`);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) notes.push(`${tech}/${depth}/${tab}: horizontal scroll`);
      const shown = await page.locator('[role="tabpanel"] section.card:not([hidden])').count();
      notes.push(`${tech}/${depth}/${tab}: ${shown} cards shown`);
      await page.screenshot({ path: `tests/shots/v5/decision-${tech}-${depth}-${tab}.png`, fullPage: true });
    }
  }
}
await b.close();
console.log(notes.join('\n'));
console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
