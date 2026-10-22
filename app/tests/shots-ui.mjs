import { BASE, pwRequire } from './env.mjs';
// UI polish screenshots: every standalone page x every tab at 1440x900 (fullPage) and 390x844.
// Opens every details.trace before the desktop shot. Logs horizontal overflow + console errors per shot.
// Usage: node tests/shots-ui.mjs [page|all] [bus]   (page filter optional, bus default 111403)
//        node tests/shots-ui.mjs --studio             (reference shots of the live Studio on :8103, read-only)
//        node tests/shots-ui.mjs --pair               (Studio vs preview side-by-side PNGs for market/grid/prices)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = pwRequire;
const { chromium } = require('playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'shots'); mkdirSync(OUT, { recursive: true });
const BASE = `${BASE}`;
const PAGES = {
  market: ['find', 'rank', 'size', 'regions'],
  land: ['area', 'footprint', 'corridor', 'permits'],
  grid: ['capacity', 'constraints', 'cost', 'mitigation'],
  queue: ['cluster', 'schedule', 'cash', 'changes'],
  prices: ['lmp', 'basis', 'shape', 'tails'],
  economics: ['revenue', 'bess', 'hybrid', 'finance'],
  decision: ['compare', 'stress', 'readiness', 'record'],
};
const STUDIO = 'http://127.0.0.1:8103/analytics-tab-studio.html#v=stage&stage=%S&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&cmp=o1,o2&pins=111403,100178';
if (process.argv[2] === '--studio' || process.argv[2] === '--pair') {
  const b0 = await chromium.launch({ channel: 'chrome' });
  const stages = ['market', 'grid', 'prices'];
  if (process.argv[2] === '--studio') {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const pg = await b0.newPage({ viewport: { width: w, height: h } });
      for (const st of stages) {
        await pg.goto('about:blank'); await pg.goto(STUDIO.replace('%S', st)); await pg.waitForTimeout(6000);
        await pg.screenshot({ path: join(OUT, `studio-${st}-${w}.png`) }); console.log(`studio ${st} @${w}`);
      }
      await pg.close();
    }
  } else {
    // side-by-side: left = Studio viewport, right = preview viewport, both 1440x900, stitched in a canvas page
    const tabOf = { market: 'find', grid: 'capacity', prices: 'lmp' };
    const pg = await b0.newPage({ viewport: { width: 1440, height: 900 } });
    for (const st of stages) {
      await pg.goto(STUDIO.replace('%S', st)); await pg.waitForTimeout(6000);
      const a = (await pg.screenshot()).toString('base64');
      await pg.goto('about:blank'); await pg.goto(`${BASE}/${st}.html#tab=${tabOf[st]}&bus=111403`);
      await pg.waitForSelector('.kpis', { timeout: 90000 }); await pg.waitForTimeout(900);
      const c = (await pg.screenshot()).toString('base64');
      const cmp = await b0.newPage({ viewport: { width: 2900, height: 940 } });
      await cmp.setContent(`<body style="margin:0;background:#222;display:flex;gap:20px;font:14px sans-serif;color:#fff"><div><div style="padding:6px">Studio (live, :8103)</div><img src="data:image/png;base64,${a}"></div><div><div style="padding:6px">Preview (${st}.html)</div><img src="data:image/png;base64,${c}"></div></body>`);
      await cmp.screenshot({ path: join(OUT, `pair-${st}-1440.png`), fullPage: true }); await cmp.close(); console.log(`pair ${st}`);
    }
  }
  await b0.close(); process.exit(0);
}
// Card-layout audit, run on every shot: first KPI row above the fold, empty cards, card headers that
// overflow, cards narrower than 260 px (desktop), charts drawn at zero width.
const cardAudit = () => {
  const out = [], vh = window.innerHeight;
  const k = document.querySelector('.kpis'); const kpiTop = k ? Math.round(k.getBoundingClientRect().top + scrollY) : null;
  const kb = k ? Math.round(k.getBoundingClientRect().bottom + scrollY) : null;
  const cards = [...document.querySelectorAll('.card')];
  for (const c of cards) {
    const t = c.querySelector('.card-h h3')?.textContent.trim() || '(untitled)';
    const b = c.querySelector('.card-b');
    if (b && !b.textContent.trim() && !b.querySelector('svg,table,img,canvas,[data-chart]')) out.push(`empty card "${t}"`);
    const h = c.querySelector('.card-h'); if (h && h.scrollWidth > h.clientWidth + 2) out.push(`header overflow "${t}"`);
    if (innerWidth >= 1200 && c.getBoundingClientRect().width < 260) out.push(`narrow card "${t}" ${Math.round(c.getBoundingClientRect().width)}px`);
    if (c.scrollWidth > c.clientWidth + 2) out.push(`card content overflow "${t}"`);
  }
  document.querySelectorAll('.chart-canvas:not([hidden])').forEach(cv => { if (!cv.querySelector('svg')) out.push(`undrawn chart "${cv.closest('[data-chart]')?.dataset.title}"`); });
  return { kpiTop, kpiBottom: kb, fold: vh, cards: cards.length, issues: out.slice(0, 8) };
};
if (process.argv[2] === 'kit') {
  const b0 = await chromium.launch({ channel: 'chrome' }); const errs = [];
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const pg = await b0.newPage({ viewport: { width: w, height: h } });
    pg.on('pageerror', e => errs.push(String(e))); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await pg.goto(`${BASE}/ui-kit.html`); await pg.waitForSelector('.chart-canvas svg'); await pg.waitForTimeout(500);
    const a = await pg.evaluate(cardAudit);
    const ov = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await pg.screenshot({ path: join(OUT, `ui-kit-${w}.png`), fullPage: true });
    console.log(`kit @${w}: cards=${a.cards} overflow=${ov}px issues=${a.issues.join('; ') || 'none'}`);
    await pg.close();
  }
  console.log(`errors: ${errs.join(' | ') || 'none'}`); await b0.close(); process.exit(errs.length ? 1 : 0);
}
const only = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null;
const bus = process.argv[3] || '111403';
const SIZES = [{ w: 1440, h: 900, full: true }, { w: 390, h: 844, full: true }];

const b = await chromium.launch({ channel: 'chrome' });
const summary = [];
for (const size of SIZES) {
  const ctx = await b.newContext({ viewport: { width: size.w, height: size.h } });
  const page = await ctx.newPage();
  let errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  for (const [name, tabs] of Object.entries(PAGES)) {
    if (only && name !== only) continue;
    for (const tab of tabs) {
      const url = `${BASE}/${name}.html#tab=${tab}&bus=${bus}`;
      // The coordinator may restart the server mid-sweep: retry a refused connection (up to ~2 min)
      // rather than recording a false "not ready" or crashing the sweep.
      let ready = false;
      for (let attempt = 0; attempt < 8 && !ready; attempt++) {
        errors = [];
        try {
          await page.goto('about:blank'); await page.goto(url);
          await page.waitForSelector('.kpis, .empty, .notice.error, .form-grid', { timeout: 90000 });
          ready = !errors.some(e => /ERR_CONNECTION_REFUSED/.test(e));
        } catch { ready = false; }
        if (!ready) { if (!errors.some(e => /ERR_CONNECTION_REFUSED/.test(e)) && attempt > 0) break; await page.waitForTimeout(15000); }
      }
      await page.waitForTimeout(900);
      const traces = await page.evaluate(() => {
        const d = [...document.querySelectorAll('details.trace')]; d.forEach(x => { x.open = true; }); return d.length;
      });
      if (traces) await page.waitForTimeout(250);
      const ov = await page.evaluate(() => {
        const W = document.documentElement.clientWidth;
        const sw = document.documentElement.scrollWidth;
        const offenders = [];
        if (sw > W) {
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width && r.right > W + 1 && !el.closest('.table-wrap,.tabs,.sidebar,.trace-formula,.chart-canvas')) {
              const par = el.parentElement && el.parentElement.getBoundingClientRect();
              if (!par || par.right <= W + 1) offenders.push(`${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''} r=${Math.round(r.right)}`);
            }
          }
        }
        return { W, sw, offenders: offenders.slice(0, 6) };
      });
      const ca = await page.evaluate(cardAudit);
      const file = join(OUT, `ui-${name}-${tab}-${size.w}.png`);
      await page.screenshot({ path: file, fullPage: size.full });
      const fold = size.w >= 1200 && ca.kpiBottom != null && ca.kpiBottom > ca.fold ? ` KPI-BELOW-FOLD(${ca.kpiBottom}px)` : '';
      const line = `${name}/${tab} @${size.w}: ready=${ready} traces=${traces} cards=${ca.cards} kpiTop=${ca.kpiTop ?? '-'}${fold} overflow=${ov.sw > ov.W ? `${ov.sw - ov.W}px ${ov.offenders.join(', ')}` : 'none'}${ca.issues.length ? ` cardIssues=[${ca.issues.join('; ')}]` : ''} errors=${errors.length ? errors.join(' | ').slice(0, 300) : 'none'}`;
      console.log(line); summary.push({ name, tab, w: size.w, ready, overflow: ov.sw - ov.W, errors: errors.length, cardIssues: ca.issues.length, fold: !!fold });
    }
  }
  await ctx.close();
}
await b.close();
const bad = summary.filter(s => !s.ready || s.overflow > 0 || s.errors || s.cardIssues);
const folds = summary.filter(s => s.fold).map(s => `${s.name}/${s.tab}`);
if (folds.length) console.log(`first KPI row below the fold at 1440x900: ${folds.join(", ")}`);
console.log(`\n${summary.length} shots; ${bad.length} with issues${bad.length ? ': ' + bad.map(s => `${s.name}/${s.tab}@${s.w}`).join(', ') : ''}`);
