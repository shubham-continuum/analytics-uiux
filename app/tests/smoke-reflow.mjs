import { BASE, pwRequire } from './env.mjs';
// F012 reflow (WCAG 2.2 1.4.10 / 1.4.4): at 200/300/400% zoom every top-bar and scope control stays reachable.
// Zoom is emulated as a 1280x800 window at that zoom: 640x400, 427x267, 320x200 CSS px (plus 1280 and 1000 as controls).
// A control is reachable when it is rendered, lies inside the viewport horizontally, and is the hit target at its
// centre, either directly or after opening the keyboard-reachable "More" button (Enter) and scrolling it into view.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
const { chromium } = pwRequire('playwright');
const U = `${BASE}/analytics-analyzer-studio.html#v=stage&stage=grid&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&cmp=o1,o2&pins=111403,100178,110807`;
const SIZES = [[1280, 800, '100%'], [1000, 800, '128%'], [640, 400, '200%'], [427, 267, '300%'], [320, 200, '400%']];
const SEL = 'header.hdr button, header.hdr a[href], header.hdr select, header.hdr input, .sm>.scope button, .sm>.scope select, .sm>.scope input';
const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); };

const b = await chromium.launch({ channel: 'chrome' });
try {
  for (const [w, h, zoom] of SIZES) {
    // The control set is what a 1280x800 window shows at 100%, keyed by data-act/data-v/aria-label (the header is
    // re-rendered on resize, so element identity cannot be kept); then the window is zoomed (resized).
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); const p = await ctx.newPage();
    await p.goto(U); await p.waitForSelector('#gsf-stages', { timeout: 150000 }); await p.waitForTimeout(4000);
    const KEYS = () => p.evaluate(sel => { const seen = {}; return [...document.querySelectorAll(sel)].filter(e => !e.closest('[data-gsx="more"]')).map(e => {
      const k = [e.tagName, e.dataset.act || '', e.dataset.v || '', e.getAttribute('aria-label') || '', e.dataset.act ? '' : (e.getAttribute('title') || e.textContent || '').trim().slice(0, 30)].join('|');
      seen[k] = (seen[k] || 0) + 1; return { k: `${k}#${seen[k]}`, vis: !!e.getClientRects().length }; }); }, SEL);
    const base = (await KEYS()).filter(x => x.vis).map(x => x.k);
    const n = base.length;
    await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(1500);
    const probe = () => p.evaluate(([sel, keys]) => { const seen = {}, map = {};
      for (const e of document.querySelectorAll(sel)) { if (e.closest('[data-gsx="more"]')) continue;
        const k = [e.tagName, e.dataset.act || '', e.dataset.v || '', e.getAttribute('aria-label') || '', e.dataset.act ? '' : (e.getAttribute('title') || e.textContent || '').trim().slice(0, 30)].join('|');
        seen[k] = (seen[k] || 0) + 1; map[`${k}#${seen[k]}`] = e; }
      return keys.map(id => { const e = map[id]; if (!e) return { id, ok: false, why: 'gone' };
        const r = e.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
        if (!r.width || !r.height) return { id, ok: false, why: 'not rendered' };
        if (r.left < -1 || r.right > vw + 1 || r.bottom < 0 || r.top > vh) return { id, ok: false, why: `off-screen ${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}` };
        const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const hit = t && (t === e || e.contains(t) || t.contains(e) || (t.closest('label') && t.closest('label').contains(e)));
        return { id, ok: !!hit, why: hit ? '' : `covered by ${t ? t.tagName + '.' + t.className : 'nothing'}` }; }); }, [SEL, base]);
    const scrollTo = id => p.evaluate(([sel, id]) => { const seen = {}; for (const e of document.querySelectorAll(sel)) { if (e.closest('[data-gsx="more"]')) continue;
      const k = [e.tagName, e.dataset.act || '', e.dataset.v || '', e.getAttribute('aria-label') || '', e.dataset.act ? '' : (e.getAttribute('title') || e.textContent || '').trim().slice(0, 30)].join('|');
      seen[k] = (seen[k] || 0) + 1; if (`${k}#${seen[k]}` === id) { e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return; } } }, [SEL, id]);
    const res = await probe(); const direct = res.filter(x => x.ok).length;
    const more = p.locator('[data-gsx="more"]');
    const viaMore = [];
    if (await more.isVisible()) {
      check(await more.getAttribute('aria-expanded') === 'false', `${zoom} (${w}px): More button present, collapsed`);
      await more.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
      check(await more.getAttribute('aria-expanded') === 'true', `${zoom}: More opens from the keyboard (Enter)`);
      for (const x of res.filter(r => !r.ok)) { await scrollTo(x.id); const a = (await probe()).find(r => r.id === x.id); if (a.ok) { x.ok = true; viaMore.push(x.id); } else x.why = a.why; }
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      check(await more.getAttribute('aria-expanded') === 'false', `${zoom}: Escape closes More`);
    }
    for (const x of res.filter(r => !r.ok)) { await scrollTo(x.id); const a = (await probe()).find(r => r.id === x.id); if (a.ok) x.ok = true; }
    const bad = res.filter(x => !x.ok);
    check(!bad.length, `${zoom} (${w}x${h}): ${n - bad.length}/${n} controls reachable (${direct} direct, ${viaMore.length} via More)${bad.length ? ` · unreachable: ${bad.slice(0, 8).map(x => `${x.id} (${x.why})`).join('; ')}` : ''}`);
    // depth lives in the board heading (Detail) as well as the scope strip: any one reachable depth control counts
    const depthOk = await p.evaluate(() => [...document.querySelectorAll('[data-act="depth"]')].some(e => { e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect();
      if (!r.width || r.left < -1 || r.right > innerWidth + 1) return false; const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return t && (t === e || e.contains(t)); }));
    check(depthOk, `${zoom}: Depth reachable`);
    for (const [label, act] of [['Export', 'export-pack'], ['Bus search', 'node-find'], ['Study case', 'case']]) {
      const xs = res.filter(x => x.id.split('|')[1] === act);
      check(xs.length && xs.some(x => x.ok), `${zoom}: ${label} reachable`);
    }
    await ctx.close();
  }
} finally { await b.close(); }
console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
