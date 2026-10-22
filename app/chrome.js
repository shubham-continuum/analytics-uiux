// Live Studio chrome, rendered with the live markup and classes so the read-only copy of the live stylesheet
// (studio/studio.css) styles it exactly: header.hdr, aside.sb, div.scope, nav#gsf-stages, main#board > .bhead /
// .gswf-kill / .summary / .gswf-sel, the docks and footer.sfoot (markup read from :8103, 2026-10-01).
// Pure: every function takes a view model built by app.js (chromeModel) and returns HTML. Controls carry data-act,
// so the shell's delegated handler drives them; nothing here touches state.
// M5: the app is GridSense One Studio. No link, tab or rail item points at the live Studio, no preview/port label; the
// footer shows the served code stamp from /health (`build <code>`), fetched once, and nothing when that fails.
// Provenance: forked from the analyzer preview · M5 chrome cleanup by Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v2

import { STAGE_Q } from './v2copy.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
// Icon paths copied from the live chrome.
export const ICO = {
  maps: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"></path><path d="M9 3v15M15 6v15"></path>',
  analytics: '<path d="M3 3v18h18"></path><path d="M7 14l4-4 4 3 5-6"></path>',
  import: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M17 8l-5-5-5 5M12 3v12"></path>',
  iso: '<circle cx="12" cy="12" r="9"></circle><path d="M12 3v18M3 12h18M6 6c3 2 9 2 12 0M6 18c3-2 9-2 12 0"></path>',
  portfolio: '<rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect>',
  stages: '<path d="M12 2l10 5-10 5L2 7z"></path><path d="M2 12l10 5 10-5M2 17l10 5 10-5"></path>',
  catalogue: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"></path>',
  search: '<circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"></path>',
  keys: '<rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"></path>',
  chev: '<path d="M6 9l6 6 6-6"></path>',
  check: '<path d="M20 6L9 17l-5-5"></path>',
  flag: '<path d="M4 22V4a1 1 0 0 1 1-1h11l-1 4 1 4H5"></path>',
  dots: '<circle cx="5" cy="12" r="1.5" fill="currentColor"></circle><circle cx="12" cy="12" r="1.5" fill="currentColor"></circle><circle cx="19" cy="12" r="1.5" fill="currentColor"></circle>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5M12 15V3"></path>',
  plus: '<path d="M12 5v14M5 12h14"></path>',
  pin: '<path d="M12 17v5M5 17h14l-1.5-5H6.5z"></path><path d="M9 3h6l-1 9H10z"></path>',
  expand: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>',
  link: '<circle cx="6" cy="19" r="3"></circle><circle cx="18" cy="5" r="3"></circle><path d="M9 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h3"></path>',
  x: '<path d="M18 6L6 18M6 6l12 12"></path>',
  // Stage icons (live rail)
  market: '<circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.3-4.3"></path>',
  land: '<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="5"></circle><circle cx="12" cy="12" r="1.5" fill="currentColor"></circle>',
  grid: '<path d="M13 2L3 14h9l-1 8 10-12h-9z"></path>',
  queue: '<circle cx="6" cy="19" r="3"></circle><circle cx="18" cy="5" r="3"></circle><path d="M9 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h3"></path>',
  prices: '<path d="M3 3v18h18"></path><path d="M7 14l4-4 4 3 5-6"></path>',
  economics: '<path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2"></path><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"></path><circle cx="16.5" cy="13.5" r="1.1" fill="currentColor"></circle>',
  decision: '<path d="M8 3v18M16 3v18M3 8h5M16 8h5M3 16h5M16 16h5"></path>',
};
export const icon = k => svg(ICO[k] || '');

/** #app classes the live frame sets (read from :8103): the layout switches the live stylesheet keys on. The dock fold
 *  classes (gsf-map-off, gsf-bottom-off, gsf-insp-off) and gsf-narrow / gsf-tight are toggled by frame.js (M1). */
export const APP_CLASS = 'app sapp gsf gsf-top gsf-rail gsf-scope gsf-stages-on gsf-docked gsf-dense gsq-quiet gsl-on gsl-fit gsl-pack gsl-fold';

/** Top bar: brand · workspace · view nav · module tabs (preview tools) · bus search · vintage · demo toggle · account. */
export function hdr(m) {
  reflowSetup();
  const tab = (act, ic, label, title, on) => `<button type="button" data-act="${act}" title="${esc(title)}" aria-current="${on ? 'page' : 'false'}">${icon(ic)}<span class="gsf-lbl">${esc(label)}</span></button>`;
  return `<header class="hdr${moreOpen ? ' gsx-more-open' : ''}">
    <div class="brand"><div class="brand-dot"><i></i><b></b></div><div><div class="brand-word">Grid<span>Sense</span></div><div class="brand-sub">One Studio</div></div></div>
    <div class="sb-ws gsx-ws" title="${esc(m.ws.title)}"><span class="ic">${esc(m.ws.ic)}</span><div><b>${esc(m.ws.name)}</b><span>${esc(m.ws.sub)}</span></div><select class="gsx-ws-sel" data-act="sample" aria-label="Project">${m.ws.options}</select></div>
    ${m.proj && m.projectsOn ? `<label class="gsx-opt-sw" title="Switch option: every dashboard reads that option's bus"><span>Option</span><select data-act="sel-opt" aria-label="Option">${m.proj.opts}</select></label>` : ''}
    ${m.projectsOn ? `<button type="button" class="btn sm gsx-np-btn" data-act="open-new-project" title="Start a project on the bus in view (or any bus) with the few inputs you know">${icon('plus')}<span class="lbl">New project</span></button>` : ''}
    <nav class="nav" aria-label="Primary">
      <a href="#" class="${m.top ? '' : 'on'}" aria-current="${m.top ? 'false' : 'page'}" data-act="${m.continuumOn ? 'analytics' : 'noop'}">${icon('analytics')}Analytics</a>
      ${m.continuumOn ? `<a href="#" class="${m.top === 'continuum' ? 'on' : ''}" aria-current="${m.top === 'continuum' ? 'page' : 'false'}" data-act="continuum" data-gsx="continuum-tab" title="LMP Continuum: settled history beside the solved forecast at the bus in view">${icon('prices')}LMP Continuum</a>` : ''}
      <a href="#" data-act="open-evidence">${icon('import')}Evidence</a>
    </nav>
    <button type="button" class="ibtn gsx-more-btn" data-gsx="more" aria-expanded="${moreOpen}" aria-controls="gsx-hdr-more" title="More: modules, bus search, data vintage, theme and account">${icon('dots')}<span class="sr">More top-bar controls</span></button>
    <div class="gsx-hdr-more" id="gsx-hdr-more">
    <nav class="gsf-tabs" data-gsf="tabs" aria-label="Modules">
      ${tab('open-samples', 'portfolio', 'Projects', 'Sample projects: each walks all seven dashboards', m.modal === 'samples')}
      ${tab('noop', 'stages', 'Stages', 'The seven concerns, in the order the work is done', !m.modal)}
      ${tab('open-pins', 'star', 'Pinned', 'Pinned buses: compare them in Decision', m.modal === 'pins')}
      ${tab('open-scenarios', 'catalogue', 'Scenarios', 'Saved scenarios', m.modal === true)}
      ${tab('open-evidence', 'sliders', 'Inputs & evidence', 'Every input, its source, and what is still open', m.modal === 'evidence')}
    </nav>
    <label class="gsf-search" title="Search ${esc(m.search.n)} buses: name, substation, zone or id">${icon('search')}<input class="gsf-lbl gsx-search" list="bus-list" data-act="node-find" value="${esc(m.search.value)}" placeholder="Search buses: name, substation, id" autocomplete="off" spellcheck="false" aria-label="Candidate bus"><span class="gsf-k">⌘K</span><datalist id="bus-list">${m.search.options}</datalist></label>
    <div class="gswf-vin" data-gswf="vintage" title="Read-only extract of the unified database · ${esc(m.nBuses)} buses"><span>Data as of <b>${esc(m.built)}</b></span><span> · model data <b>${esc(m.engine)}</b></span></div>
    <div class="hdr-right">
      <button type="button" class="gsx-demo-tg" aria-pressed="${m.sample ? 'true' : 'false'}" data-act="${m.sample ? 'open-samples' : 'open-samples'}" title="${esc(m.sample ? `Sample project on: ${m.sample}. Its revenue, capital, site and schedule inputs are illustrative assumptions.` : 'Choose a sample project')}"><i aria-hidden="true"></i><span>Demo data</span></button>
      <button type="button" class="pin-hdr ibtn ${m.pinned ? 'on' : ''}" data-act="pin" data-v="${esc(m.busId)}" aria-pressed="${m.pinned}" title="${m.pinned ? 'Unpin this bus' : 'Pin this bus to compare it in Decision'}">${icon('pin')}<span class="sr">${m.pinned ? 'Unpin' : 'Pin'} this bus</span></button>
      <button type="button" class="themebtn" data-act="toggle-theme" title="Switch dark / light (t)" aria-label="Switch dark or light theme"><svg viewBox="0 0 24 24" class="i-sun" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"></path></svg><svg viewBox="0 0 24 24" class="i-moon" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg></button>
      <button type="button" class="ibtn" data-act="noop" title="Shortcuts: d depth · g guided review · t theme · 1–7 dashboards · Esc closes">${icon('keys')}</button>
      <button type="button" class="acct" data-act="open-evidence" title="GridSense One Studio: reads the unified database read-only; the only write is an export through the export service"><span class="avatar">GS</span><span class="acct-name">One Studio</span><span class="tier-chip">read-only</span>${icon('chev')}</button>
    </div></div></header>`;
}

/* ---- F012 reflow (WCAG 1.4.10 / 1.4.4): at 200-400% zoom (a 1280 px window is 640/427/320 CSS px wide) every
   top-bar and scope control stays reachable. At 1000 px and below the top bar's right-hand group (module tabs, bus
   search, data vintage, demo/pin/theme/account) folds behind a keyboard-reachable "More" button, and the scope strip
   wraps instead of clipping. The bus search keeps a usable input down to 1001 px (the live sheet hides the input below
   1330 px, leaving an icon that cannot take focus). Above 1000 px the wrapper is display:contents: the live grammar and
   geometry are unchanged. The sheet is injected once from here because the stylesheets belong to other slices. ---- */
let moreOpen = false;
const REFLOW_CSS = `
.gsx-hdr-more{display:contents}
.hdr .gsx-more-btn{display:none}
@media (max-width:1330px){#app .hdr .gsf-search{min-width:110px;max-width:150px;padding:0 8px 0 7px}#app .hdr .gsf-search .gsf-lbl{display:block}}
@media (max-width:1000px){
 #app.gsf-top>.hdr{overflow:visible;position:relative;z-index:50} /* the live rule clips at 1,2,0; backdrop-filter makes it the panel's containing block */
 #app.gsf-top .hdr>.sb-ws{display:flex;flex:0 1 auto;min-width:min(140px,38vw)} /* the live <=1050 px rail rule hides it */
 #app .hdr .brand{flex:0 1 auto;min-width:0;overflow:hidden}
 #app .hdr .gsx-more-btn{display:inline-flex;align-items:center;justify-content:center;margin-left:auto;margin-right:6px;flex:none}
 #app .hdr .gsx-hdr-more{display:none}
 #app .hdr.gsx-more-open .gsx-hdr-more{display:flex;flex-direction:column;align-items:stretch;gap:10px;position:absolute;z-index:1000;
  top:100%;right:0;width:min(340px,100vw);max-height:calc(100vh - var(--top-h,40px));overflow:auto;padding:10px;
  background:var(--surface-2,#14181f);border:1px solid var(--border,#333);box-shadow:0 8px 24px rgba(0,0,0,.35)}
 #app .hdr .gsx-hdr-more .gsf-tabs{flex-wrap:wrap;margin:0;padding:0}
 #app .hdr .gsx-hdr-more .gsf-tabs button .gsf-lbl{display:inline}
 #app .hdr .gsx-hdr-more .gsf-search{width:auto;min-width:0;max-width:none}
 #app .hdr .gsx-hdr-more .gsf-search .gsf-lbl{display:block}
 #app .hdr .gsx-hdr-more .gswf-vin{margin:0;white-space:normal}
 #app .hdr .gsx-hdr-more .gswf-vin span+span{display:inline}
 #app .hdr .gsx-hdr-more .hdr-right{margin:0;flex-wrap:wrap}
 #app .sm>.scope,#app.gsf-scope .sm>.scope{height:auto;flex-wrap:wrap;overflow:visible;padding:4px 8px;row-gap:4px}
 #app .sm>.scope .gsf-strip,#app .sm>.scope .gswf-scope,#app .sm>.scope .gswf-sweep,#app .sm>.scope>.scope-right{flex-wrap:wrap;overflow:visible;min-width:0;max-width:100%;margin-left:0}
 #app.gsf-scope .sm>.scope:not(.gsf-open)>.scope-right>.depth{display:flex}
 #app .sm>.scope .gsf-strip select{max-width:100%}
}`;
function reflowSetup() {
  if (typeof document === 'undefined' || document.getElementById('gsx-reflow-css')) return;
  const st = document.createElement('style'); st.id = 'gsx-reflow-css'; st.textContent = REFLOW_CSS; document.head.appendChild(st);
  const set = (open, focusBtn) => {
    moreOpen = open;
    const h = document.querySelector('header.hdr'); if (!h) return;
    h.classList.toggle('gsx-more-open', open);
    const b = h.querySelector('[data-gsx="more"]'); if (b) { b.setAttribute('aria-expanded', String(open)); if (focusBtn) b.focus(); }
    if (open) h.querySelector('#gsx-hdr-more button, #gsx-hdr-more input')?.focus();
  };
  // Capture phase: the shell's delegated data-act handler re-renders the header; this runs first and never re-renders.
  document.addEventListener('click', e => {
    const b = e.target.closest?.('[data-gsx="more"]');
    if (b) { set(!moreOpen); return; }
    if (moreOpen && !e.target.closest?.('#gsx-hdr-more')) set(false);
    else if (moreOpen && e.target.closest?.('#gsx-hdr-more [data-act]') && !e.target.closest?.('.gsf-search')) moreOpen = false; // an action closes it
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && moreOpen) set(false, true); }, true);
}

/** Left rail: workspace items, the seven-stage workflow with read/stale marks, footer. */
export function sb(m) {
  const item = (act, ic, label, n, title) => `<button type="button" class="sb-item" data-act="${act}" title="${esc(title)}">${icon(ic)}<span>${esc(label)}</span>${n ? `<span class="sb-n">${esc(n)}</span>` : ''}</button>`;
  const steps = m.stages.map((s, i) => {
    const num = s.state === 'current' ? `<span class="sb-num done" title="${esc(s.why)}">${icon('check')}</span>` : `<span class="sb-num${s.state === 'stale' ? ' warn' : ''}" title="${esc(s.why)}">${String(i + 1).padStart(2, '0')}</span>`;
    return m.only ? `<a class="sb-step${s.active ? ' on' : ''}" href="${esc(s.href)}" title="${esc(s.title)}" aria-current="${s.active ? 'step' : 'false'}">${icon(s.key)}<span class="l">${esc(s.name)}</span>${num}</a>`
      : `<button type="button" class="sb-step${s.active ? ' on' : ''}" data-act="stage" data-v="${s.key}" title="${esc(s.title)}" aria-current="${s.active ? 'step' : 'false'}">${icon(s.key)}<span class="l">${esc(s.name)}</span>${num}</button>`;
  }).join('');
  return `<aside class="sb" aria-label="Workspace and analysis workflow" data-gsf="rail"><p class="sb-lab">Workspace</p>
    ${item('open-samples', 'portfolio', 'Projects', m.nSamples, 'Sample projects: pick one and follow the guided review')}
    ${item('open-pins', 'folder', 'Pinned buses', m.nPins, 'Pinned buses: compare them in Decision')}
    ${item('stage', 'iso', 'ISO-wide', 0, 'Market: every ISO-NE bus screened against your request').replace('data-act="stage"', 'data-act="stage" data-v="market"')}
    ${item('open-scenarios', 'star', 'Saved scenarios', m.nScen, 'Saved scenarios')}
    <div class="sb-head"><p class="sb-lab">Analysis workflow</p><span>${esc(m.readLine)}</span></div>
    <nav class="sb-rail" aria-label="Analysis workflow">${steps}</nav>
    ${item('open-evidence', 'stages', 'Inputs & evidence', 0, 'Every input, its source, the hand-offs and what is still open')}
    <div class="sb-foot"><div class="sb-live"><i></i>Saved in this browser</div><p>ISO-NE · every analyzer reads the active bus, request, price basis and depth.</p></div></aside>`;
}

/** Scope strip: asset · size · year · study case (+ import, history) · size sweep · weights · score · depth · actions. */
export function scope(m) {
  const sel = (label, act, opts, title, extra = '') => `<label${extra}><span class="gsf-e">${esc(label)}</span><select data-act="${act}" title="${esc(title)}" aria-label="${esc(label)}">${opts}</select></label>`;
  const sweep = m.sweep.map(s => `<button type="button" data-act="sweep" data-v="${s.size}" aria-pressed="${s.on}" title="${esc(s.title)}">${s.size}<em>${s.n == null ? '…' : esc(s.n.toLocaleString('en-US'))}</em></button>`).join('');
  return `<div class="scope${m.scopeOpen ? ' gsf-open' : ''}" aria-label="Current scope"><button type="button" class="gsf-chev" data-act="scope-open" aria-expanded="${!!m.scopeOpen}" title="${m.scopeOpen ? 'Hide' : 'Show'} the full scope block: size sweep, hand-offs, depth (Screen · Review · Study), tour and actions">${icon('chev')}</button>
    <div class="gsf-strip">
      ${sel('Asset', 'tech', m.techOpts, 'The technology in scope; switching sets that fuel\'s direction and size')}
      ${m.sizeIsImport ? sel('Size', 'import', m.importOpts, 'Import (withdrawal) MW: the load every limit and gate reads') : sel('Size', 'export', m.exportOpts, 'Export (injection) MW: the size every limit and gate reads')}
      ${m.showImport ? sel('Charge', 'import', m.importOpts, 'Charge (withdrawal) MW: the import side storage and hybrids are tested on, at shoulder') : ''}
      ${sel('Year', 'year', m.yearOpts, 'Settled years apply that real-time year as the price basis; 2030–2040 apply that horizon\'s solved run (PCR). 2045/2050 were a flat vendor escalation and are not held.')}
      ${sel('Study case', 'case', m.caseOpts, 'The study case Grid focuses on. Requirements still test every case the fuel needs.')}
    </div>
    <div class="gswf-scope"><div class="gswf-sweep" data-gswf="sweep"><span class="e">Size sweep</span><div class="seg sm">${sweep}</div></div>
      <button type="button" class="btn sm" data-act="goto" data-v="market" data-tab="rank" title="Set the ranking weights (Market › Rank & compare)">${icon('sliders')}<span class="lbl">Weights</span></button>
      <div class="gswf-score" data-gswf="ceiling-chip" title="${esc(m.score.title)}"><span class="e">Hand-offs</span><span class="v"><b>${esc(m.score.a)}</b> of <b>${esc(m.score.b)}</b> current<em>· ${esc(m.score.note)}</em></span></div></div>
    <div class="scope-right"><div class="depth"><span class="e">Depth</span><div class="seg sm">${['screen', 'review', 'study'].map(d => `<button type="button" data-act="depth" data-v="${d}" aria-pressed="${m.depth === d}" title="${esc({ screen: 'Screen: ISO-wide summaries and the key chart', review: 'Review: this bus with settled hourly data and the evidence cards', study: 'Study: everything, including element rows and calculation traces' }[d])}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('')}</div></div>
      <span class="vr"></span>
      <button type="button" class="btn sm" data-act="guided" aria-pressed="${m.guidedOn}" title="${esc(m.guidedTitle)}">${icon('flag')}<span class="lbl">Tour${esc(m.guidedStep)}</span></button>
      <button type="button" class="btn sm" data-act="open-evidence" title="Project inputs, study basis, hand-offs and what is still open">${icon('sliders')}<span class="lbl">Inputs</span></button>
      <button type="button" class="ibtn" data-act="open-scenarios" title="Saved scenarios">${icon('dots')}</button>
      <button type="button" class="btn sm pri" data-act="export-pack" title="The evidence pack: one Excel workbook with the summary, assumptions and every calculation's working (Decision)">${icon('download')}<span class="lbl">Export</span> <span class="k">xlsx</span></button></div></div>`;
}

/** Stage strip: 1–7 with read/stale dots, ISO-wide, and the board actions at the right. */
export function stages(m) {
  const b = (s, i) => {
    const inner = `<i>${i + 1} ·</i><span class="gsf-lbl">${esc(s.name)}</span>${s.active ? `<span class="gsx-sq">${esc(STAGE_Q[s.key] || '')}</span>` : ''}<span class="gsf-dot ${s.state === 'current' ? 'gsf-read' : s.state === 'stale' ? 'gsf-stale' : ''}"></span>`;
    return m.only ? `<a href="${esc(s.href)}" data-gsf-stage="${s.key}" title="${esc(s.title)}" aria-current="${s.active ? 'step' : 'false'}">${inner}</a>`
      : `<button type="button" data-act="stage" data-v="${s.key}" data-gsf-stage="${s.key}" title="${esc(s.title)}" aria-current="${s.active ? 'step' : 'false'}">${inner}</button>`;
  };
  return `<nav id="gsf-stages" aria-label="Stages">${m.stages.map(b).join('')}<span class="gsf-sep"></span>
    <button type="button" data-act="stage" data-v="market" data-gsf-stage="iso" title="Every ISO-NE bus, screened against your request">ISO-wide</button>
    <div class="gsf-tabs-end" data-gsf="stage-acts"><span class="gsf-chip gsf-quiet" title="Analyzer tabs on this board, and cards at the depth in scope">${esc(m.analyses)}</span>
      <button type="button" class="gsf-chip" data-act="save-scenario" title="Save this view as a scenario">Save scenario</button></div></nav>`;
}

/** Board head: kicker, stage name, question; the tag and actions at the right. */
/** Depth, in the heading's words. The URL and the live Studio keep screen / review / study. */
const DEPTHS = [['screen', 'Summary', 'Screen: ISO-wide summaries and the key chart'], ['review', 'Standard', 'Review: this bus with settled hourly data and the evidence cards'], ['study', 'Full', 'Study: everything, including element rows and calculation traces']];
export const bhead = m => `<header class="mk-question gsx-question"><div class="mk-eyebrow kick">Stage ${m.idx} of 7 · ${esc(m.name)}</div><h1>${esc(m.question)}</h1><p class="mk-tab-answer"><b>${esc(m.tabName)}:</b> ${esc(m.tabQ)}</p><div class="mk-for"><div class="mk-depth" role="group" aria-label="Detail level"><span class="e">Detail</span><div class="seg sm">${DEPTHS.map(([d, l, t]) => `<button type="button" data-act="depth" data-v="${d}" aria-pressed="${m.depth === d}" title="${esc(t)} (key d cycles)">${l}</button>`).join('')}</div></div><span class="tag">${esc(m.tag)}</span>${m.cfg ? `<button type="button" class="btn sm" data-act="cfg-add" data-stage="${esc(m.key)}" title="Build a chart, KPI tile or table of your own from the field catalogue; it is saved under My analyses on this stage">${icon('plus')}Add analysis</button>` : ''}<button type="button" class="btn sm" data-act="open-scenarios" title="Saved scenarios">${icon('catalogue')}Scenarios</button></div></header>`;

/** Gate row: "Out if" + gates met, then the summary band (active review · facts · flags). */
export function band(m) {
  const k = m.kill;
  const kill = `<div class="gswf-kill" data-gswf="kill" data-state="${k.state}"><button class="gsq-chip" type="button" data-act="open-evidence" title="${esc(k.text)}"><span>Stop if</span><i>▸</i></button><span class="gswf-k">Stop here if</span><div class="gswf-kbody"><p class="gswf-s">${esc(k.text)}</p></div><span class="badge ${k.tone}" title="${esc(k.title)}">${esc(k.label)}</span><span class="gswf-src">${esc(k.src)}</span></div>`;
  const facts = m.facts.map(f => `<div><span>${esc(f.k)}</span>${f.act ? `<b class="${f.tone || ''}" role="button" tabindex="0" data-act="${f.act}" ${f.v2 ? `data-v="${esc(f.v2)}"` : ''} ${f.tab ? `data-tab="${esc(f.tab)}"` : ''} title="${esc(f.title || '')}">${esc(f.v)}</b>` : `<b class="${f.tone || ''}${f.cls ? ` ${f.cls}` : ''}" title="${esc(f.title || '')}">${f.html || esc(f.v)}</b>`}</div>`).join('');
  const flags = m.flags.map(f => `<span class="badge ${f.tone}${f.cls ? ` ${f.cls}` : ''}" title="${esc(f.title || '')}">${esc(f.text)}</span>`).join('');
  return `${kill}<div class="summary"><div class="ctx" title="${esc(m.ctx.title)}"><span class="kick">${esc(m.ctx.kick)}</span><b>${esc(m.ctx.name)}</b><em>${esc(m.ctx.sub)}</em></div><div class="facts">${facts}</div><div class="flags">${flags}</div></div>`;
}

/** Selection strip: the project's options (or the bus + pins), current one pressed. */
export const selection = m => `<div class="gswf-sel" data-gswf="selection"><span class="gswf-k">${esc(m.label)}</span><div class="gswf-sel-w">${m.chips.map(c => `<button type="button" class="gswf-opt${c.current ? ' on' : ''}" data-act="${c.act}" data-v="${esc(c.id)}" aria-pressed="${c.current}" title="${esc(c.title)}"><i></i><b>${esc(c.label)}</b><span>${esc(c.sub)}</span></button>`).join('')}</div><button class="gsq-chip" type="button" data-act="open-pins" title="${esc(m.note)}"><span>Note</span><i>▸</i></button><span class="gswf-src">${esc(m.note)}</span></div>`;

/** The served code stamp (/health `code`, 12 hex): fetched once per page; on any failure nothing is shown, never a
 *  made-up build. The footer is re-rendered often, so the stamp is cached here and patched into a footer already drawn. */
let BUILD = null, buildAsked = false;
const CODE_RE = /^[0-9a-f]{12}$/;
function buildStamp() {
  if (!buildAsked && typeof fetch === 'function' && typeof document !== 'undefined') {
    buildAsked = true;
    fetch('/health', { cache: 'no-store' }).then(r => (r.ok ? r.json() : null)).then(j => {
      if (!j || !CODE_RE.test(String(j.code || ''))) return;
      BUILD = j.code;
      document.querySelectorAll('[data-gsf="build"]').forEach(el => { el.outerHTML = buildStamp(); });
    }).catch(() => { /* no stamp: the footer shows nothing rather than a build it cannot prove */ });
  }
  return BUILD ? `<span data-gsf="build" class="mono" title="Code stamp of the files this server is serving (/health)">build ${esc(BUILD)}</span>` : '<span data-gsf="build" hidden></span>';
}

/** Footer status bar. */
export const sfoot = m => `<footer class="sfoot"><span class="grow">Screening evidence — not an interconnection approval, not an allocated upgrade bill, not an investment recommendation.</span><button type="button" data-act="compare-pinned" ${m.others ? '' : 'disabled'}>Compare pinned buses (${m.others})</button><span class="mono">Unified DB ${esc(m.built)}</span><span title="d depth · g guided review · 1–7 dashboards · Esc closes">? shortcuts</span><div class="gsf-status" data-gsf="status"><span>ISO-NE</span><span>buses <b>${esc(m.nBuses)}</b></span>${buildStamp()}</div><button class="gsq-toggle" type="button" data-act="toggle-text" aria-pressed="${m.showText}" title="Put every caption and footnote back on the cards. They are in the page either way: the (i) on each card opens its calculation.">${m.showText ? 'Hide text' : 'Show text'}</button>${m.sample ? `<span class="gsx-demo-status" title="Sample project: revenue, capital, site and schedule inputs are illustrative assumptions, labelled wherever they appear.">Sample project — illustrative planning inputs</span>` : ''}</footer>`;

/* ---- The persistent frame (M1): the live dockShell()/edgeTab() markup (pinned snapshot ext/30-app-frame.js L414-436,
   L451-483). Rendered once by app.js renderFrame(); frame.js wires the splitters, collapse buttons and edge tabs
   (data-gsf-dock / data-gsf-open, never data-act, so a dock toggle never goes through the board's re-render). ---- */
const ph = (title, note, host, extra = '') => `<div class="gsf-ph" data-gsf="placeholder"><b>${esc(title)}</b><span>${esc(note)}</span>${extra}<code>#${esc(host)}</code></div>`;
const dockHead = (title, k) => `<div class="gsf-dock-h"><span class="gsf-ttl">${esc(title)}</span><span class="gsf-note"></span><button type="button" data-gsf="collapse-${k}" data-gsf-dock="${k}" data-gsf-open="0" title="Collapse dock" aria-label="Collapse the ${esc(title.toLowerCase())} dock">${icon('x')}</button></div>`;
const edgeTab = (title, k, vertical) => `<button type="button" class="gsf-tab${vertical ? ' gsf-vert' : ''}" data-gsf="tab" data-gsf-dock="${k}" data-gsf-open="1" title="Expand the ${esc(title.toLowerCase())} dock">${esc(title)}</button>`;
const split = (id, orient, what) => `<div class="gsf-split" id="${id}" role="separator" aria-orientation="${orient}" aria-label="Resize the ${what}" title="Drag to resize the ${what}"></div>`;
export const SPLIT_V = split('gsf-split-v', 'vertical', 'network map');
export const SPLIT_I = split('gsf-split-i', 'vertical', 'inspector');
export const SPLIT_H = split('gsf-split-h', 'horizontal', 'data grid');
/** Map dock (left). #gsx-map-dock is the host the vendored network map mounts into (M3, via GSFrame.dockHost). */
export const dockLeft = () => `<div class="gsf-dock" id="gsf-dock-map" data-gsf="dock">${dockHead('Network map', 'map')}<div class="gsf-host" id="gsx-map-dock">${ph('Network map loads here (M3)', 'Branches by kV class, the buses as points and the load zones, drawn from the unified database. Nothing is drawn in its place until then.', 'gsx-map-dock')}</div>${edgeTab('Network map', 'map', true)}</div>`;
/** Inspector dock (right). #inspector is the placeholder M4 builds on; the Inputs & evidence dialog stays one click away. */
export const dockRight = () => `<div id="gsf-insp" data-gsf="inspector">${dockHead('Inspector', 'insp')}<div class="gsf-host gsx-insp" id="inspector" aria-label="Inspector">${ph('Select a bus or a card', 'Bus, card, evidence, notes and export tabs arrive with the inspector (M4).', 'inspector', '<button type="button" class="btn sm" data-act="open-evidence" title="Every input, its source, the hand-offs and what is still open">Inputs &amp; evidence</button>')}</div>${edgeTab('Inspector', 'insp', true)}</div>`;
/** Data-grid dock (bottom). #gsx-grid-dock is the host the vendored grid mounts into (M3). */
export const dockBottom = () => `<div class="gsf-dock" id="gsf-dock-bottom" data-gsf="dock">${dockHead('Data grid', 'bottom')}<div class="gsf-host" id="gsx-grid-dock">${ph('Data grid loads here (M3)', 'Every row behind the board in view, with a sticky header and inline filters.', 'gsx-grid-dock')}</div>${edgeTab('Data grid', 'bottom', false)}</div>`;
