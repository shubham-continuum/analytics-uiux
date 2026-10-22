import { BASE, pwRequire } from './env.mjs';
// Chrome parity: the same chrome element in the live Studio (:8103, read-only) and in the preview (:8104), on the same
// link, compared on geometry and computed style. Prints every difference beyond tolerance; exits 1 when any remain.
// Usage: node tests/chrome-parity.mjs [stage]
import { createRequire } from 'node:module';
const require = pwRequire;
const { chromium } = require('playwright');
const stage = process.argv[2] || 'grid';
const HASH = `v=stage&stage=${stage}&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&cmp=o1,o2&pins=111403,100178,110807`;
const SELS = ['header.hdr', '.hdr .brand', '.hdr .sb-ws', '.hdr .nav', '.hdr .gsf-tabs', '.hdr .gsf-search', '.hdr .gswf-vin', '.hdr .hdr-right', '.hdr .gsx-demo-tg', '.hdr .acct',
  'aside.sb', '.sb .sb-item', '.sb .sb-rail', '.sb .sb-step', '.sb .sb-step.on', 'div.scope', '.scope .gsf-chev', '.scope .gsf-strip', '.scope .gsf-strip label', '.scope .gsf-strip select', '.scope .gswf-sweep',
  '.scope .gswf-sweep button', '.scope .btn.sm', '.scope .btn.sm.pri', '.scope .depth .seg button', '#gsf-stages', '#gsf-stages button', '#gsf-stages [aria-current="step"]', '#gsf-stages .gsf-dot',
  '.gsf-tabs-end .gsf-chip', '#board', '.board-in', '.bhead', '.bhead .kick', '.bhead .q', '.gswf-kill', '.gswf-kill .badge', '.summary', '.summary .ctx b', '.summary .facts b', '.summary .flags .badge',
  '.gswf-sel', '.gswf-opt', '.gswf-opt.on', 'footer.sfoot', '.sfoot .grow', '#gsf-dock-map', '#gsf-dock-map .gsf-tab', '#gsf-insp', '#gsf-dock-bottom'];
const PROPS = ['fontSize', 'fontWeight', 'fontFamily', 'color', 'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderRadius', 'paddingTop', 'paddingLeft', 'lineHeight', 'display'];
const b = await chromium.launch({ channel: 'chrome' });
const grab = async url => {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${url}#${HASH}`); await p.waitForTimeout(10000);
  const r = await p.evaluate(([sels, props]) => Object.fromEntries(sels.map(s => {
    const e = document.querySelector(s); if (!e) return [s, null];
    const c = getComputedStyle(e), q = e.getBoundingClientRect();
    return [s, { x: q.x, y: q.y, w: q.width, h: q.height, ...Object.fromEntries(props.map(k => [k, c[k]])) }];
  })), [SELS, PROPS]);
  await p.close(); return r;
};
const live = await grab('http://127.0.0.1:8103/analytics-tab-studio.html');
const prev = await grab(`${BASE}/analytics-analyzer-studio.html`);
await b.close();
let diffs = 0, cmp = 0;
for (const s of SELS) {
  const a = live[s], z = prev[s];
  if (!a && !z) continue;
  if (!a || !z) { diffs++; console.log(`DIFF ${s}: ${!a ? 'not in live' : 'missing in preview'}`); continue; }
  const out = [];
  for (const k of ['x', 'y', 'h']) { cmp++; if (Math.abs(a[k] - z[k]) > 2) out.push(`${k} ${Math.round(a[k])}→${Math.round(z[k])}`); }
  cmp++; if (Math.abs(a.w - z.w) > Math.max(4, 0.03 * a.w) && !/^(#board|\.board-in|\.summary|\.gswf-sel|#gsf-stages|div\.scope|footer|header)/.test(s)) out.push(`w ${Math.round(a.w)}→${Math.round(z.w)}`);
  for (const k of PROPS) { cmp++; if (String(a[k]) !== String(z[k])) out.push(`${k} ${a[k]}→${z[k]}`); }
  if (out.length) { diffs += out.length; console.log(`DIFF ${s}: ${out.join(' · ')}`); }
}
console.log(`${cmp - diffs} of ${cmp} measurements match (${(100 * (cmp - diffs) / cmp).toFixed(1)}%)`);
process.exit(diffs ? 1 : 0);
