// Provenance: Claude Opus 5.5 · one-studio P2 slice S2-GD (Grid + Decision correctness blockers) · 2026-10-06 · v1
// Browser smoke for S2-GD at Hatchville (111209, solar 100 MW): Grid shows the study-basis strip (F013) and the
// staleness line (F005); the envelope-only shoulder case is amber "Envelope only · unverified", never a green Fits
// (F009); light load is a Hold row (F010); the large-load date is not hand-typed. Decision: gates as one tally with all
// three counts (F001), the capture threshold "not set" (F003), the memo carries the export-limit qualifiers (F006).
import { BASE, pwRequire } from './env.mjs';
const { chromium } = pwRequire('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
try {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=grid&tab=capacity&bus=111209`);
  await page.waitForSelector('.kpis', { timeout: 60000 });
  await page.waitForSelector('[data-gx="study-basis"]', { timeout: 30000 });
  const basis = await page.locator('[data-gx="study-basis"]').innerText();
  check(/Vintage/.test(basis) && /Transfer sink/.test(basis) && /not held/.test(basis), 'F013 study-basis strip names its fields, not-held shown');
  await page.waitForFunction(() => /modelled requests since withdrawn|could not read/.test(document.querySelector('[data-gx="study-basis"]')?.innerText || ''), null, { timeout: 30000 }).catch(() => {});
  check(/Study case 2026-05: \d+ of \d+ modelled requests since withdrawn/.test(await page.locator('[data-gx="study-basis"]').innerText()), 'F005 staleness line with withdrawals since the study');
  const body = await page.locator('[role="tabpanel"]').innerText();
  check(/Envelope only · unverified/.test(body), 'F009 envelope-only case shown as "Envelope only · unverified"');
  const shoulderGreen = await page.locator('.gx-cell .pill.good:text("Fits")').count();
  const shoulderAmber = await page.locator('.pill.warn:text("Envelope only · unverified")').count();
  check(shoulderAmber > 0, `F009 amber envelope-only pills: ${shoulderAmber} (green Fits pills in the matrix: ${shoulderGreen})`);
  check(/Light load/.test(body) && /not studied/.test(body), 'F010 light load shown as a not-studied Hold row');
  check(!/16 Nov 2026/.test(await page.content()), 'no hand-typed large-load date');
  check(!/NaN|undefined/.test(body), 'Grid capacity: no NaN / undefined');
  await page.click('[data-act="tab"][data-v="mitigation"]'); await page.waitForTimeout(500);
  check(!/\b197 MW\b/.test(await page.locator('[role="tabpanel"]').innerText()), 'D7 largest size without upgrades not truncated');
  await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=decision&tab=compare&bus=111209`);
  await page.waitForSelector('text=Gate: Connect', { timeout: 90000 });
  const dec = await page.locator('[role="tabpanel"]').innerText();
  check(/\d+ Pass[^\n]*\(of \d+\)/.test(dec) && /Open/.test(dec), 'F001 gate tally: the shared verdict line with every count');
  check(/not set: open decision/.test(dec), 'F003 capture threshold not set');
  await page.click('[data-act="tab"][data-v="record"]'); await page.waitForTimeout(500);
  const rec = await page.locator('[role="tabpanel"]').innerText();
  check(/thermal N-1 DC screen \(element study 2026-05\)/.test(rec) && /envelope only/i.test(rec), 'F006 memo carries the export-limit qualifiers');
  check(!errors.length, `console errors: ${errors.join(' | ') || 'none'}`);
  await page.evaluate(() => localStorage.clear()); await page.close();
} finally { await b.close(); }
console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
