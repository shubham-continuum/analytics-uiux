import { BASE, pwRequire } from './env.mjs';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = pwRequire;
const { chromium } = require('playwright');
const projects = JSON.parse(readFileSync(new URL('../data/samples.json', import.meta.url), 'utf8')).projects;
const tabs = {
  market: ['find', 'rank', 'size', 'regions'], land: ['area', 'footprint', 'corridor', 'permits'],
  grid: ['capacity', 'constraints', 'cost', 'mitigation'], queue: ['cluster', 'schedule', 'cash', 'changes'],
  prices: ['lmp', 'basis', 'shape', 'tails'], economics: ['revenue', 'bess', 'hybrid', 'finance'],
  decision: ['compare', 'stress', 'readiness', 'record'],
};
const expected = Object.entries(tabs).flatMap(([stage, names]) => names.map(tab => `${stage}/${tab}`));
const failures = [];
const check = (yes, text) => { if (!yes) failures.push(text); console.log(`${yes ? 'ok' : 'FAIL'} ${text}`); };
check(projects.length === 5, 'five sample projects');
for (const p of projects) {
  const actual = p.steps.map(s => `${s.stage}/${s.tab}`);
  check(JSON.stringify(actual) === JSON.stringify(expected), `${p.id}: all 28 analyzers in workflow order`);
  check(p.options.length >= 2 && p.options.every(o => /^\d+$/.test(o.busId)), `${p.id}: comparable bus options`);
  check(p.steps.every(s => s.what_to_look_at && !/\b(?:undefined|NaN)\b/.test(s.what_to_look_at)), `${p.id}: complete numeric guidance`);
  check(p.assumptions?.label && p.assumptions?.provenance && p.coverage?.openEvidence?.length,
    `${p.id}: assumptions and open evidence disclosed`);
  check(Object.keys(p.assumptions?.optionAnnualRevenue || {}).length === p.options.length &&
    Object.values(p.assumptions.optionAnnualRevenue).every(Number.isFinite), `${p.id}: option-level revenue inputs`);
}
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${BASE}/analytics-analyzer-studio.html`);
await page.waitForSelector('[data-act="sample"]', { timeout: 60000 });
for (const p of projects) {
  await page.selectOption('[data-act="sample"]', p.id);
  await page.waitForFunction(id => document.querySelector('.walk-name')?.textContent?.includes(id), p.name, { timeout: 60000 });
  check((await page.locator('[data-act="walk"] option').count()) === 28, `${p.id}: 28 guided stops available`);
  check(await page.locator('.walk-assumptions summary').innerText() === 'Demo inputs and evidence', `${p.id}: assumption disclosure visible`);
  const finance = p.steps.findIndex(s => s.stage === 'economics' && s.tab === 'finance');
  await page.selectOption('[data-act="walk"]', String(finance));
  await page.waitForSelector('[data-act="fin"][data-k="capex"]', { timeout: 60000 });
  const amount = Number(await page.locator('[data-act="fin"][data-k="capex"]').inputValue());
  const revenue = Number(await page.locator('[data-act="fin"][data-k="annualRevenue"]').inputValue());
  check(amount === p.assumptions.ui.fin.capex && revenue === p.assumptions.optionAnnualRevenue[p.options[0].busId],
    `${p.id}: finance uses this project's stated planning values`);
  check(!(await page.locator('.kpi .value').allInnerTexts()).some(v => /NaN|undefined/.test(v)), `${p.id}: finance results are finite`);
  await page.selectOption('[data-act="sample-opt"]', p.options[1].id);
  await page.waitForFunction(bus => location.hash.includes(`bus=${bus}`), p.options[1].busId, { timeout: 60000 });
  check(Number(await page.locator('[data-act="fin"][data-k="annualRevenue"]').inputValue()) ===
    p.assumptions.optionAnnualRevenue[p.options[1].busId], `${p.id}: option choice changes bus and finance input`);
  const corridor = p.steps.findIndex(s => s.stage === 'land' && s.tab === 'corridor');
  await page.selectOption('select[data-act="walk"]', String(corridor));
  await page.waitForSelector('[data-act="land"][data-k="siteLat"]', { timeout: 60000 });
  check(Number(await page.locator('[data-act="land"][data-k="siteLat"]').inputValue()) ===
    p.assumptions.optionSite[p.options[1].busId].siteLat, `${p.id}: option choice updates illustrative site point`);
  if (p === projects[0]) {
    for (let k = 0; k < 28; k++) {
      await page.selectOption('[data-act="walk"]', String(k));
      check((await page.locator('select[data-act="walk"]').inputValue()) === String(k) &&
        await page.locator('.walk-what').isVisible(), `${p.id}: analyzer ${k + 1} renders`);
    }
  }
}
await page.reload();
await page.waitForSelector('.walk-name', { timeout: 60000 });
check((await page.locator('.walk-name').innerText()).includes(projects.at(-1).name), 'selected project survives reload');
await page.setViewportSize({ width: 390, height: 844 });
check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'mobile: no horizontal overflow');
check(!errors.length, `browser console: ${errors.join(' | ') || 'no errors'}`);
await browser.close();
console.log(failures.length ? `${failures.length} FAILED` : 'ALL PASS');
process.exit(failures.length ? 1 : 0);
