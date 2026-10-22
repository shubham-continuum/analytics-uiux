import { BASE, pwRequire } from './env.mjs';
// Screenshots for the Economics dashboard (all 4 tabs at 1440 and 390) and, with --studio, the live Studio's
// Economics stage (read-only: only navigates and screenshots). node tests/economics-shots.mjs [--studio] [bus] [tech]
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const args = process.argv.slice(2), studio = args.includes('--studio'), rest = args.filter(a => a !== '--studio');
const bus = rest[0] || '111403', tech = rest[1] || null;
const b = await chromium.launch({ channel: 'chrome' });
const errors = [];
if (studio) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  for (const fuel of ['solar', 'bess', 'hybrid']) {
    await page.goto(`http://127.0.0.1:8103/analytics-tab-studio.html#v=stage&stage=economics&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&fuel=${fuel}`);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `tests/shots/studio-econ-${fuel}.png`, fullPage: true });
  }
  await page.close();
} else {
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await b.newPage({ viewport: vp });
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${BASE}/economics.html#tab=revenue&bus=${bus}`);
    await page.waitForSelector('.kpis, .notice.error, .empty', { timeout: 120000 });
    if (tech) { await page.selectOption('[data-act="tech"]', tech); await page.waitForTimeout(400); }
    for (const tab of ['revenue', 'bess', 'hybrid', 'finance']) {
      await page.click(`[data-act="tab"][data-v="${tab}"]`);
      await page.waitForSelector('.kpis, .notice.error, .empty, .notice.warn', { timeout: 180000 });
      for (let i = 0; i < 240 && await page.locator('.loading-panel').count(); i++) await page.waitForTimeout(1000);
      await page.waitForTimeout(800);
      await page.screenshot({ path: `tests/shots/econ-${tab}-${bus}-${vp.width}.png`, fullPage: true });
    }
    await page.close();
  }
}
await b.close();
console.log(errors.length ? `console errors: ${errors.join(' | ')}` : 'no console errors');
