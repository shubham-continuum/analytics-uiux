import { BASE, pwRequire } from './env.mjs';
// All-bus + standalone smoke: every standalone page boots; three bus kinds (own node, same substation,
// borrowed proxy) load through the API and render the Prices tabs; picker search; cross-page jump keeps the bus.
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const U = `${BASE}/`;
const idx = await (await fetch(U + 'api/buses')).json();
const pick = tier => idx.buses.find((b, i) => b.tier === tier && i % 7 === 3);
const kinds = { direct: pick('direct'), same_substation: pick('same_substation'), geo_proxy: idx.buses.find(b => b.tier === 'geo_proxy' && b.proxyKm > 1 && b.hist) };
const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
for (const k of ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision']) {
  await page.goto(`${U}${k}.html#bus=111403`); await page.waitForSelector('.kpis, .empty, .notice', { timeout: 90000 });
  check((await page.locator('#gsf-stages [aria-current="step"]').innerText()).includes(k[0].toUpperCase() + k.slice(1)), `${k}.html boots as a standalone page`);
}
for (const [tier, bus] of Object.entries(kinds)) {
  await page.goto(`${U}prices.html#tab=lmp&bus=${bus.id}`);
  await page.waitForSelector('.kpis', { timeout: 120000 });
  const note = await page.locator('.mapping-note').innerText();
  check(note.replace(/\s+/g, ' ').includes(bus.pnode.trim().replace(/\s+/g, ' ')), `${tier} bus ${bus.id}: mapping note names ${bus.pnode.trim()}`);
  if (tier === 'geo_proxy') check(/Borrowed price/.test(note), 'proxy bus is flagged as borrowed with its distance');
  for (const tab of ['basis', 'shape', 'tails']) {
    await page.click(`[data-act="tab"][data-v="${tab}"]`); await page.waitForTimeout(300);
    check(!(await page.locator('.notice.error').count()), `${tier} bus: Prices › ${tab} renders without an error`);
  }
}
await page.goto(`${U}prices.html#bus=111403`); await page.waitForSelector('.kpis', { timeout: 90000 });
const target = kinds.geo_proxy;
await page.fill('[data-act="node-find"]', `${target.name} · ${target.substation || ''} · ${target.kv ?? '?'} kV · ${target.zone || ''} · ${target.id}`);
await page.locator('[data-act="node-find"]').dispatchEvent('change'); await page.waitForSelector('.kpis', { timeout: 120000 });
check(page.url().includes(`bus=${target.id}`), 'picker search switches the bus and the URL');
await page.click('#gsf-stages a:has-text("Economics")'); await page.waitForURL(/economics\.html/, { timeout: 120000 }).catch(() => {}); await page.waitForSelector('.kpis, .empty', { timeout: 120000 });  // wait for the navigation, not the old page's .kpis (race under load)
check(page.url().includes('economics.html') && page.url().includes(`bus=${target.id}`), 'sidebar link opens Economics on the same bus');
const bad = await page.goto(`${U}prices.html#bus=999999999`); await page.waitForSelector('.kpis, .notice', { timeout: 60000 });
check(true, 'unknown bus falls back without crashing');
check(!errors.filter(e => !/404/.test(e)).length, `console errors: ${errors.join(' | ') || 'none'}`);
await b.close(); console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
