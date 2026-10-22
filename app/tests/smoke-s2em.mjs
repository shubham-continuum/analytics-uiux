import { BASE, pwRequire } from './env.mjs';
// S2-EM browser smoke: F002 stack label, F011 contract card, F008 charge cap, F007 habitat not held, F018 site note,
// F014 land column, D5 window label, D11 method stated, DC energy single definition + S6 delivered-cost swap.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S2-EM) · 2026-10-06 · sign-off pending · v1
// Hatchville 115 kV (111209) is the kit's example bus (Falmouth, MA): habitat layer 0 ac in the screen.
const { chromium } = pwRequire('playwright');
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };
const b = await chromium.launch({ channel: 'chrome' });
try {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e)));
  const go = async (stage, tab, bus = '111209') => { await page.goto(`${BASE}/analytics-analyzer-studio.html#stage=${stage}&tab=${tab}&bus=${bus}`); await page.waitForSelector('.kpis', { timeout: 120000 }); };
  const body = () => page.locator('[role="tabpanel"]').innerText();

  // Economics › revenue: one labelled stack; contract card not entered.
  await go('economics', 'revenue');
  let t = await body();
  check(/Energy \$[\d.]+[Mk] \+ RECs \$[\d.]+[Mk] = \$[\d.]+[Mk]\/yr/.test(t), 'F002: revenue headline carries its stack label (Energy + RECs = total)');
  // W-B: capacity is the S4 rules stream; with no COD entered it is "not held (COD not held…)", and the stack label still names it.
  check(/Capacity (\$[\d.]+[Mk]\/yr excluded|not held \()/.test(t), 'F002: capacity named in the stack label as excluded, or as not held with its reason');
  check(/Contract \(PPA\)/.test(t) && /not entered/i.test(t), 'F011: contract card present, terms not entered');
  check(/min\(nameplate 100 MW, export limit/.test(t) || /Connection cap/.test(await page.content()), 'D10: the cap rule is stated');
  // W-B (S4 Lead wiring 1): the S4 cards sit on the Revenue tab, reading the same rules load as the KPI streams.
  check(/Revenue stack/.test(t) && /Capacity by commitment period/.test(t) && /Pay-for-Performance/.test(t), 'S4: revenue stack, capacity-by-CCP and PfP cards on the Revenue tab');
  check(await page.locator('select[data-k="capBand"]').count() > 0, 'S4: capacity price-path prefill tools rendered (D3 user path)');
  // W-B (S5 Lead wiring 1): the OBBBA gate and after-tax finance cards on Project finance, on the incomplete branch too.
  await page.click('[data-act="tab"][data-v="finance"]'); await page.waitForTimeout(400);
  t = await body();
  check(/Tax credit eligibility \(OBBBA gate\)/.test(t) && /After-tax project finance/.test(t), 'S5: tax-gate and after-tax finance cards on Project finance (incomplete branch)');
  check(/Incomplete valuation/.test(t), 'S5: the pre-tax valuation still says incomplete with no inputs');
  await page.click('[data-act="tab"][data-v="revenue"]'); await page.waitForSelector('.kpis', { timeout: 120000 });
  await page.fill('input[data-k="ctrPpa"]', '55'); await page.locator('input[data-k="ctrPpa"]').dispatchEvent('change'); await page.waitForTimeout(300);
  check(/Not entered: Settlement point/.test(await body()), 'F011: partial terms stay not entered (no silent default)');

  // Economics › BESS for storage: the charge note names the governing case.
  await page.selectOption('select[data-act="tech"]', 'storage'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-v="bess"]'); await page.waitForSelector('[data-charge-cap]', { timeout: 180000 });
  t = await page.locator('[data-charge-cap]').first().innerText();
  check(/Shoulder charge governs/.test(t), `F008: charge note names the governing case: ${t.slice(0, 160)}`);
  const cap = Number(await page.locator('[data-charge-cap]').first().getAttribute('data-charge-cap'));
  check(Number.isFinite(cap) && cap <= 100.4 + 1e-6, `F008: dispatch charge cap ${cap} MW ≤ the governing limit`);
  // W-B close-out of W1: the rules window (he_start/he_end) is now read, so the screening cap must be APPLIED, not excused.
  check(/screening cap 20\.4 MW/.test(t), 'F008 / W1: summer-peak 20.4 MW screening cap applied from the rules-file window');
  t = await body();
  check(/Revenue stack/.test(t) && /Pay-for-Performance/.test(t), 'S4: revenue stack and PfP cards on the BESS tab (storage)');

  // Economics › Load cost for a data centre: one energy definition; S6 stack replaces the old capacity/RNS lines.
  await page.selectOption('select[data-act="tech"]', 'datacenter'); await page.waitForTimeout(300);
  await page.click('[data-act="tab"][data-v="revenue"]'); await page.waitForSelector('.kpis', { timeout: 120000 }); await page.waitForTimeout(800);
  t = await body();
  check(!/Capacity obligation/.test(t) && !/Transmission \(RNS\)/.test(t), 'DC: the 100% capacity obligation and "RNS not held" KPIs are gone');
  check(/Delivered cost stack/.test(t), 'DC: S6 delivered-cost stack shown');
  check(/observed-hour mean/.test(t), 'DC: energy KPI states the single definition');
  await page.selectOption('select[data-act="tech"]', 'solar'); await page.waitForTimeout(300);

  // Land: habitat not held, never 0 ac; site note.
  await go('land', 'permits');
  t = await body();
  check(/habitat/.test(t) && /not screened here/.test(t) && !/no habitat in the disc/.test(t), 'F007: habitat reads "not screened here", Wildlife row not cleared');
  await go('land', 'corridor');
  check(/shapes are not held|shapes not held/.test(await body()), 'F018: site map states exclusion shapes are not held');

  // Market: land column + KPI; D5 label.
  await go('market', 'find');
  t = await page.content(); // innerText applies the KPI labels' uppercase transform
  check(/Land screen held/.test(t), 'F014: Land screen held KPI');
  // W-B option (b): by default the envelope-only shoulder export case is not required; the card says why, and the shortlist has rows.
  check(/shoulder case: vendor envelope only, not studied — excluded from screening; Decision holds the gate/.test(t), 'option (b): the Requirements card prints why the shoulder case is excluded by default');
  check(await page.locator('td[data-land]').count() > 0 && /land not screened|fits\*/.test(t), 'F014: shortlist land column (unscreened = land not screened)');
  // Requiring it restores D6.1: every bus Unknown with the envelope reason. The switch sits in the collapsed "More" block, so drive it by state + change event.
  await page.evaluate(() => { const el = document.querySelector('input[data-act="mkt-shoulder"]'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(800); t = await page.content();
  check(/envelope only \(vendor-asserted, unverified\)/.test(t), 'S2-GD #4: with the shoulder case required, an envelope-only case reads as Unknown with the envelope reason');
  await page.evaluate(() => { const el = document.querySelector('input[data-act="mkt-shoulder"]'); el.checked = false; el.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(500); t = await page.content();
  check(/full 2025 settled year/.test(t), 'D4: population rule stated on Requirements at bus');

  // Prices: one solar-window label.
  await go('prices', 'shape');
  check(/HE10–HE17 \(hours beginning 9–16, 8 h\)/.test(await page.content()), 'D5: solar window labelled HE10–HE17 (hours beginning 9–16)');

  check(!errors.length, `console errors: ${errors.slice(0, 3).join(' | ') || 'none'}`);
  await page.screenshot({ path: 'tests/shots/s2em-market.png', fullPage: false });
} finally { await b.close(); }
console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
