import { BASE, ENV, pwRequire } from './env.mjs';
// Frame visual parity (M5): One Studio vs the live Studio (:8103, read-only: GET only, every other method is aborted)
// on the reference link, docks open (map, grid, inspector), at 1280/1440/1920 in dark and light. Writes screenshots to
// tests/shots/m5/ and a structured dock-geometry diff to design/progress/M5-visual.md. This is the frame parity gate;
// chrome-parity.mjs stays as a style report. The live Studio is being restyled by another session (2026-10-06), so a
// diff can be live drift: the report says which side moved, it does not assume One Studio is wrong.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
//   node tests/visual-parity.mjs            exits 1 when a frame element differs beyond tolerance
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = pwRequire('playwright');

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(APP, 'tests', 'shots', 'm5');
const REPORT = path.resolve(APP, '..', 'design', 'progress', 'M5-visual.md');
const HASH = 'v=stage&stage=grid&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&cmp=o1,o2&pins=111403,100178,110807';
const SIDES = { one: `${BASE}/analytics-analyzer-studio.html`, live: `${ENV.liveStudio}/analytics-tab-studio.html` };
const SIZES = [[1280, 800], [1440, 900], [1920, 1080]];
const THEMES = ['dark', 'light'];
// The frame: bars, rail, docks and splitters. Tolerance: 4 px or 2% of the live size, whichever is larger.
const PARTS = { 'top bar': 'header.hdr', 'rail': 'aside.sb', 'scope strip': '.sm>.scope', 'stage strip': '#gsf-stages', 'map dock': '#gsf-dock-map',
  'map splitter': '#gsf-split-v', 'grid dock': '#gsf-dock-bottom', 'grid splitter': '#gsf-split-h', 'inspector': '#gsf-insp', 'inspector splitter': '#gsf-split-i',
  'board': '#board', 'footer': 'footer.sfoot' };
const tol = v => Math.max(4, 0.02 * Math.abs(v));
mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ channel: 'chrome' });
const geo = {}; // geo[side][theme][w] = {part: {x,y,w,h}|null}
const notes = [];
try {
  for (const side of Object.keys(SIDES)) for (const theme of THEMES) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    if (side === 'live') await ctx.route('**/*', r => (r.request().method() === 'GET' ? r.continue() : r.abort()));
    const p = await ctx.newPage();
    let loaded = false;
    for (let attempt = 1; attempt <= 2 && !loaded; attempt++) {
      try { await p.goto(`${SIDES[side]}#${HASH}`); await p.waitForSelector('#gsf-dock-map', { timeout: 180000 }); loaded = true; }
      catch { notes.push(`${side}/${theme}: frame did not load in 180 s (attempt ${attempt})`); }
    }
    if (!loaded) { await ctx.close(); continue; }
    await p.waitForTimeout(6000);
    const isLight = () => p.evaluate(() => document.documentElement.classList.contains('light') || document.documentElement.dataset.theme === 'light');
    if ((await isLight()) !== (theme === 'light')) { await p.locator('.themebtn').first().click(); await p.waitForTimeout(800); }
    if ((await isLight()) !== (theme === 'light')) notes.push(`${side}/${theme}: theme switch did not take`);
    // Live opens a stage with map and grid folded; both apps put the edge tab (data-gsf="tab") inside its dock.
    for (const [k, cls, dock] of [['map', 'gsf-map-off', '#gsf-dock-map'], ['bottom', 'gsf-bottom-off', '#gsf-dock-bottom'], ['insp', 'gsf-insp-off', '#gsf-insp']]) {
      if (await p.evaluate(c => document.getElementById('app')?.classList.contains(c), cls)) {
        await p.locator(`${dock} [data-gsf="tab"]`).first().click({ timeout: 10000 }).catch(() => {}); await p.waitForTimeout(800);
        if (await p.evaluate(c => document.getElementById('app')?.classList.contains(c), cls)) notes.push(`${side}/${theme}: could not open the ${k} dock`);
      }
    }
    for (const [w, h] of SIZES) {
      await p.setViewportSize({ width: w, height: h }); await p.waitForTimeout(2500);
      await p.screenshot({ path: path.join(SHOTS, `${side}-${w}-${theme}.png`) });
      (geo[side] ??= {})[theme] ??= {};
      geo[side][theme][w] = await p.evaluate(parts => Object.fromEntries(Object.entries(parts).map(([k, s]) => {
        const e = document.querySelector(s); if (!e) return [k, null];
        const r = e.getBoundingClientRect(); return [k, r.width || r.height ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : { x: 0, y: 0, w: 0, h: 0, hidden: true }];
      })), PARTS);
    }
    await ctx.close();
  }
} finally { await b.close(); }

// ---------- diff ----------
const rows = []; let diffs = 0, cmp = 0;
for (const theme of THEMES) for (const [w] of SIZES) {
  const L = geo.live?.[theme]?.[w], O = geo.one?.[theme]?.[w];
  if (!L || !O) { rows.push(`| ${theme} | ${w} | (all) | ${L ? '' : 'live not measured'} ${O ? '' : 'One Studio not measured'} | | ✗ |`); diffs++; continue; }
  for (const part of Object.keys(PARTS)) {
    const a = L[part], z = O[part]; cmp++;
    if (!a && !z) { rows.push(`| ${theme} | ${w} | ${part} | absent in both | | = |`); continue; }
    if (!a || !z) { diffs++; rows.push(`| ${theme} | ${w} | ${part} | ${a ? `${a.x},${a.y} ${a.w}×${a.h}` : 'absent'} | ${z ? `${z.x},${z.y} ${z.w}×${z.h}` : 'absent'} | ✗ |`); continue; }
    const out = ['x', 'y', 'w', 'h'].filter(k => Math.abs(a[k] - z[k]) > tol(a[k])).map(k => `${k} ${z[k] - a[k] > 0 ? '+' : ''}${z[k] - a[k]}`);
    if (out.length) diffs++;
    rows.push(`| ${theme} | ${w} | ${part} | ${a.x},${a.y} ${a.w}×${a.h} | ${z.x},${z.y} ${z.w}×${z.h} | ${out.length ? `✗ ${out.join(' · ')}` : '='} |`);
  }
}
const md = `# M5 · Frame visual parity: One Studio vs live :8103
_Generated by \`app/tests/visual-parity.mjs\` · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · reference link \`#${HASH}\` · docks opened (map, grid, inspector)_

**Result: ${cmp - diffs} of ${cmp} frame measurements within tolerance (4 px or 2%).** The live Studio is being restyled by another
session today, so a ✗ is either One Studio drift or live drift; read the screenshots before acting on it.

Screenshots: \`app/tests/shots/m5/{live,one}-{1280,1440,1920}-{dark,light}.png\`
${notes.length ? `\nNotes:\n${notes.map(n => `- ${n}`).join('\n')}\n` : ''}
| Theme | Width | Part | live x,y w×h | One Studio x,y w×h | Diff (One − live) |
|---|---|---|---|---|---|
${rows.join('\n')}
`;
writeFileSync(REPORT, md);
console.log(`${cmp - diffs}/${cmp} within tolerance · report ${REPORT} · shots ${SHOTS}${notes.length ? `\n${notes.join('\n')}` : ''}`);
process.exit(diffs ? 1 : 0);
