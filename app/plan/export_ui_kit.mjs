// UI kit export: the 7 dashboards rendered in the browser and saved as self-contained, offline HTML files for design
// work on another machine (graphs, colours, tables). Every page inlines the live stylesheet copy, the scoped preview CSS,
// the bridge CSS and the fonts, then ends with ONE editable <style id="design-tokens"> block holding every colour token
// in force, so a token edit restyles every chart, table and map. Chart SVGs are captured as drawn; a tiny inline script
// keeps tab switching and the Chart/Table toggles. No data endpoint, server or network is needed to open the files.
//
// Usage (preview server running on :8104):  node plan/export_ui_kit.mjs [--quick]
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire('D:/Ganesh/02 Products/GridSense/analytics-portfolio-canvas-2026-09-11/client/package.json');
const { chromium } = require('playwright');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist', 'ui-kit');
const U = 'http://127.0.0.1:8104/analytics-analyzer-studio.html';
const QUICK = process.argv.includes('--quick');
const STAGES = [['market', 'Market'], ['land', 'Land'], ['grid', 'Grid'], ['queue', 'Queue'], ['prices', 'Prices'], ['economics', 'Economics'], ['decision', 'Decision']];
// Fuel variants where the views differ by fuel: every stage for solar; storage and data centre where the content changes.
const FUELS = { solar: [100, 0], storage: [100, 100], datacenter: [0, 250] };
const VARIANTS = st => (QUICK ? ['solar'] : ['prices', 'economics', 'grid', 'decision'].includes(st) ? ['solar', 'storage', 'datacenter'] : ['solar']);
const BUS = '111209'; // Hatchville 115 kV (own price node; the live Studio's kennebec option o2)

const read = f => readFileSync(join(ROOT, f), 'utf8');
const fonts = read('fonts.css');
const css = [
  ['live Studio stylesheet (read-only copy)', read('studio/studio.css')],
  ['preview analyzer CSS (scoped to .gsx-an / .gsx-layer)', read('app.css').replace(/@import url\(['"]?\.\/fonts\.css['"]?\);?/, '')],
  ['preview bridge CSS', read('studio-bridge.css')],
];

// Token groups for the editable block (names from the live stylesheet and the preview).
const GROUPS = [
  ['Series colours (categorical, fixed order; s7 = grey "other")', /^--s\d$/],
  ['Sequential ramp (dark → bright)', /^--h\d$/],
  ['Surfaces and background', /^--(bg|surface|surface-2|raised|sunk|chrome|chrome-2|tint)$/],
  ['Ink (text)', /^--(ink|ink-2|ink-3|ink-4|chrome-ink|chrome-ink-2|chrome-hi)$/],
  ['Borders and grid lines', /^--(border|border-2|border-3|axis|grid-line)$/],
  ['Accent', /^--accent/],
  ['Status (reserved: good / warning / bad)', /^--(ok|warn|bad)(-bg|-line)?$/],
  ['Evidence kinds', /^--(model|observed|forecast|econ|grid-cap|over)/],
  ['Map (geomap.js)', /^--gm-/],
  ['Type and shape', /^--(sans|mono|r-card|r-ctl|r-pill)$/],
];

const b = await chromium.launch({ channel: 'chrome' });
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = []; page.on('pageerror', e => errors.push(String(e)));
await page.goto(`${U}#stage=market&bus=${BUS}&depth=study`); await page.waitForTimeout(4000);

// The token values in force, read once from the rendered page.
const tokens = await page.evaluate(groups => {
  const names = new Set();
  for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch { continue; } const walk = r => { for (const x of r) { if (x.style) for (const n of x.style) if (n.startsWith('--')) names.add(n); if (x.cssRules) walk(x.cssRules); } }; walk(rs); }
  const cs = getComputedStyle(document.documentElement), out = {};
  for (const n of names) { const v = cs.getPropertyValue(n).trim(); if (v) out[n] = v; }
  return out;
}, GROUPS.map(g => g[1].source));
const tokenBlock = () => {
  const used = new Set(), lines = [];
  for (const [label, re] of GROUPS) {
    const ks = Object.keys(tokens).filter(k => re.test(k) && !used.has(k)).sort((a, z) => a.localeCompare(z, 'en', { numeric: true }));
    if (!ks.length) continue; ks.forEach(k => used.add(k));
    lines.push(`  /* ${label} */`, ...ks.map(k => `  ${k}: ${tokens[k]};`));
  }
  return `<style id="design-tokens">\n/* ═══ DESIGN TOKENS: edit here. This block loads last, so every value below overrides the stylesheets above. ═══\n   Charts, tables, maps, badges and the chrome all read these variables. Keep s1–s6 colour-blind-safe\n   (run the dataviz validator), status colours (ok/warn/bad) only for status, never for a series. */\nhtml, html.dark, :root {\n${lines.join('\n')}\n}\n</style>`;
};

const captures = [], samples = new Map();
const SAMPLE_SELECTORS = [
  ['KPI tiles', '.kpis'], ['Card with answer sentence', 'section.card:has(.card-answer)'], ['Dense table', 'section.card:has(table.dense)'],
  ['Bar chart', 'section.card:has(.chart-host[data-type="bar"])'], ['Line chart', 'section.card:has(.chart-host[data-type="line"])'],
  ['Grouped bars', 'section.card:has(.chart-host[data-type="gbar"])'], ['Stacked bars', 'section.card:has(.chart-host[data-type="stack"])'],
  ['Area chart', 'section.card:has(.chart-host[data-type="area"])'], ['Heatmap', 'section.card:has(.chart-host[data-type="heat"])'],
  ['Scatter', 'section.card:has(.chart-host[data-type="scatter"])'], ['Histogram', 'section.card:has(.chart-host[data-type="hist"])'],
  ['Duration curve', 'section.card:has(.chart-host[data-type="dur"])'], ['Gantt', 'section.card:has(.chart-host[data-type="gantt"])'],
  ['Tornado', 'section.card:has(.chart-host[data-type="tornado"])'], ['Any chart', 'section.card:has(.chart-host)'],
  ['Map', 'section.card:has(svg.gm)'], ['Percentile strip', 'section.card:has(.pstrip)'], ['Badges and chips', 'section.card:has(.w-badges)'],
  ['Notice', '.notice'], ['Calculation trace', 'section.card-trace'], ['Form controls', 'section.card:has(.form-grid), section.card:has(.range-field)'],
];

for (const [st, name] of STAGES) {
  for (const fuel of VARIANTS(st)) {
    const [ex, im] = FUELS[fuel];
    await page.evaluate(([fuel, ex, im]) => { try { const S = JSON.parse(localStorage.getItem('gspreview.analyzer.v1') || '{}'); Object.assign(S, { tech: fuel, exportMW: ex, importMW: im, walk: null, depth: 'study', showText: true, ui: { ...(S.ui || {}), modal: false } }); localStorage.setItem('gspreview.analyzer.v1', JSON.stringify(S)); } catch {} }, [fuel, ex, im]);
    await page.goto(`${U}#stage=${st}&bus=${BUS}&depth=study`); await page.reload(); await page.waitForTimeout(6000);
    const tabs = await page.$$eval('.gsx-an [role="tab"]', bs => bs.map(x => ({ id: x.dataset.v, label: x.textContent.trim() })));
    for (const t of (QUICK ? tabs.slice(0, 1) : tabs)) {
      await page.click(`.gsx-an [role="tab"][data-v="${t.id}"]`);
      await page.waitForTimeout(2500);
      await page.waitForFunction(() => !document.querySelector('.loading-panel, .spinner'), null, { timeout: 120000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const html = await page.evaluate(() => {
        const app = document.getElementById('app').cloneNode(true);
        app.querySelectorAll('script, iframe, .gsx-layer').forEach(n => n.remove());
        app.querySelectorAll('datalist').forEach(n => { n.innerHTML = ''; });
        // links back to the live app or the server would be dead offline
        app.querySelectorAll('a[href^="http"], a[href^="./"]').forEach(a => a.setAttribute('href', '#'));
        return { html: app.outerHTML, cls: document.documentElement.className, body: document.body.className };
      });
      const id = `${st}-${t.id}-${fuel}`;
      captures.push({ id, st, name, tab: t.label, fuel, ...html });
      for (const [label, sel] of SAMPLE_SELECTORS) {
        if (samples.has(label)) continue;
        const h = await page.evaluate(sel => { try { const e = document.querySelector(`.gsx-an ${sel}`); return e ? { html: e.outerHTML, w: Math.round(e.getBoundingClientRect().width) } : null; } catch { return null; } }, sel);
        if (h) samples.set(label, { ...h, from: `${name} › ${t.label} (${fuel})` });
      }
      process.stdout.write(`${id} `);
    }
  }
}
await b.close();

// ---- assemble ----
const head = (title, extraCss = '') => `<!doctype html><html lang="en" class="gtb-on gtb-chrome dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>/* fonts (DM Sans, JetBrains Mono; OFL) */\n${fonts}</style>
${css.map(([l, c]) => `<style data-src="${l}">\n${c}\n</style>`).join('\n')}
<style>/* UI kit page chrome (not part of the product) */
.kit-nav{position:fixed;top:0;bottom:0;left:0;width:230px;overflow:auto;z-index:100;background:#070b14;border-right:1px solid rgba(160,181,212,.2);padding:10px 8px;font:12px var(--sans,'DM Sans',sans-serif);color:#cbd6e6}
.kit-nav h1{font-size:13px;margin:4px 6px 10px;color:#edf3fc}.kit-nav h2{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#95a6be;margin:12px 6px 4px}
.kit-nav a{display:block;padding:3px 8px;border-radius:5px;color:#cbd6e6;text-decoration:none}.kit-nav a:hover,.kit-nav a.on{background:rgba(79,140,245,.18);color:#fff}
.kit-main{margin-left:230px}.kit-page{display:none}.kit-page.on{display:block}
.kit-page #app{position:relative;min-height:900px}
.kit-sample{margin:14px;max-width:1180px}.kit-sample>h3{font:600 12px var(--mono);color:#95a6be;margin:18px 0 6px}${extraCss}</style></head>`;
const script = `<script>
// tab switching between captured pages, and the Chart/Table toggles (the only interactivity kept offline)
document.addEventListener('click', e => {
  const a = e.target.closest('.kit-nav a'); if (a) { e.preventDefault(); show(a.dataset.page); return; }
  const v = e.target.closest('[data-chart-view]'); if (v) { const h = v.closest('.chart-host'); if (h) { h.querySelectorAll('[data-chart-view]').forEach(x => x.classList.toggle('active', x === v)); const c = h.querySelector('.chart-canvas'), t = h.querySelector('.chart-table'); if (c) c.hidden = v.dataset.chartView !== 'chart'; if (t) t.hidden = v.dataset.chartView !== 'table'; } }
});
function show(id) { document.querySelectorAll('.kit-page').forEach(p => p.classList.toggle('on', p.id === id)); document.querySelectorAll('.kit-nav a').forEach(a => a.classList.toggle('on', a.dataset.page === id)); history.replaceState(null, '', '#' + id); scrollTo(0, 0); }
show((location.hash || '').slice(1) || document.querySelector('.kit-page')?.id);
</script>`;
const nav = (list, title) => `<nav class="kit-nav"><h1>${title}</h1>${STAGES.map(([st, name]) => { const cs = list.filter(c => c.st === st); return cs.length ? `<h2>${name}</h2>${cs.map(c => `<a href="#${c.id}" data-page="${c.id}">${c.tab}${c.fuel !== 'solar' ? ` · ${c.fuel}` : ''}</a>`).join('')}` : ''; }).join('')}${list === captures ? '<h2>Kit</h2><a href="components.html" onclick="location.href=this.getAttribute(\'href\');return false">Components page</a>' : ''}</nav>`;
const pageOf = c => `<section class="kit-page" id="${c.id}"><div class="${c.body}">${c.html}</div></section>`;

rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
const all = `${head('GridSense Analyzer · UI kit (all dashboards)')}<body class="gsf-on">${nav(captures, `GridSense UI kit · ${stamp}`)}<main class="kit-main">${captures.map(pageOf).join('\n')}</main>${tokenBlock()}${script}</body></html>`;
writeFileSync(join(OUT, 'GridSense-UI-kit-all.html'), all);
for (const [st, name] of STAGES) {
  const cs = captures.filter(c => c.st === st); if (!cs.length) continue;
  writeFileSync(join(OUT, `${st}.html`), `${head(`GridSense ${name} · UI kit`)}<body class="gsf-on">${nav(cs, `${name} · UI kit`)}<main class="kit-main">${cs.map(pageOf).join('\n')}</main>${tokenBlock()}${script}</body></html>`);
}
// Each sample at the width it was captured at: charts are SVG viewBoxes drawn for that width (wider inflates the text).
const comp = [...samples].map(([label, s]) => `<div class="kit-sample" style="width:${s.w}px;max-width:100%"><h3>${label} <span style="opacity:.6">· from ${s.from} · ${s.w}px</span></h3><div class="gsx-an kit-comp"><section role="tabpanel">${s.html.startsWith('<section') ? s.html : `<section class="card c-12 w"><div class="card-b">${s.html}</div></section>`}</section></div></div>`).join('\n');
writeFileSync(join(OUT, 'components.html'), `${head('GridSense · UI components', '.kit-comp{display:block!important}.kit-comp section.card{display:flex}.kit-wrap{padding:10px 14px;background:var(--bg);min-height:100vh}')}<body class="gsf-on"><div class="kit-wrap"><h2 style="font:700 16px var(--sans);color:var(--ink);margin:6px 14px">GridSense · UI components (${samples.size}) · ${stamp}</h2>${comp}</div>${tokenBlock()}${script}</body></html>`);
writeFileSync(join(OUT, 'tokens.json'), JSON.stringify(tokens, null, 1));
console.log(`\n${captures.length} pages, ${samples.size} component samples → ${OUT}${errors.length ? `\npage errors: ${errors.slice(0, 3).join(' | ')}` : ''}`);

// ---- README for the person editing the kit on another machine ----
writeFileSync(join(OUT, 'README.md'), `# GridSense Analyzer · UI kit (${stamp})

Self-contained snapshots of the 7 dashboards for design work: graphs and their colours, tables, cards, maps.
Open any .html file by double-click in Chrome or Edge: no server, database or network is needed.

| File | What it is |
|---|---|
| GridSense-UI-kit-all.html | Every dashboard tab (left menu). Solar for all tabs; storage and data-centre variants where the views change by fuel. |
| market.html … decision.html | One file per dashboard, same content as above. |
| components.html | One example of each building block: KPI tiles, cards, tables, every chart type, map, percentile strip, badges, notices, forms, a calculation trace. Shown at their real width. |
| tokens.json | Every colour/size token in force when the kit was built (for reference). |

## How to change the look

1. **Colours, everywhere at once: edit the \`<style id="design-tokens">\` block at the END of a file.** It loads last, so a value there overrides everything.
   - \`--s1 … --s6\`: chart series colours, used in fixed order. \`--s7\` is the grey "other" slot. Keep them colour-blind-safe.
   - \`--h1 … --h7\`: sequential ramp (heatmaps, map colouring).
   - \`--surface\`, \`--surface-2\`, \`--bg\`, \`--sunk\`: card and page backgrounds. \`--ink … --ink-4\`: text. \`--border*\`: lines.
   - \`--ok\`, \`--warn\`, \`--bad\` (and their \`-bg\`/\`-line\`): status only (Met / Hold / Fail). Never use them for a data series.
   - \`--gm-*\`: the map (water, land, rivers, state and county lines).
2. **Shapes and type: add rules at the end of the last \`<style>\` before the tokens block** (or in a new \`<style>\` just above it). Useful selectors:
   - Cards: \`.gsx-an section.card\`, header \`.w-h\`, title \`.w-q\`, answer line \`.card-answer\`, tiles \`.kpi\`, \`.kpi .value\`, \`.kpi .label\`.
   - Tables: \`table.dense\`, \`table.dense th\`, \`table.dense td\`, \`td.num\`.
   - Charts (SVG): \`.chart rect.bar\`, \`.chart .line\`, \`.chart .axis\`, \`.chart text\`, \`.chart .glegend\`, the host \`.chart-host[data-type="bar|line|gbar|stack|area|heat|scatter|hist|dur|gantt|tornado"]\`.
   - Maps: \`svg.gm\`, \`.gm .gm-land\`, \`.gm .gm-state\`, \`.gm .gm-pts circle\`, \`.gm .gm-lines line.gm-lim\`.
   - Percentile strip: \`.pstrip\`, \`.ps-band\`, \`.ps-ref\`, \`.ps-dot\`.
3. **What will NOT change here:** the numbers and the chart geometry (bar widths, axis positions) are baked into the snapshot. The live app draws them from the database. Chart hover tooltips are not active offline; the Chart/Table toggle and the left menu work.

## Bringing your changes back
Send back the edited \`design-tokens\` block and any CSS rules you added (or the whole .html file). They go into \`preview/studio-bridge.css\` (rules) and the token block (colours). Nothing else needs to change.
Regenerate the kit with \`node plan/export_ui_kit.mjs\` (preview running on :8104).
`);
