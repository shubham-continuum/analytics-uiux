// GridSense One Studio: the persistent frame (map dock left, data-grid dock bottom, inspector right, splitters).
// Provenance: Claude Opus 5.5 · one-studio/design (T3, slice M1) · 2026-10-06 · sign-off pending · v1
//
// Ported from the live frame, read from the pinned snapshot
//   one-studio/app-tools/live-snapshot/2026-10-06/ext/30-app-frame.js (sha256 54a0090a022e9788…):
//   applySizes() L96-106 · syncWidth() NARROW 1000 / TIGHT 800 on the board L123-131 · setDock() L182-192 ·
//   dockShell()/edgeTab() L414-436 · docks() L441-487 · dragger() L490-528 · wireSplitters() clamps L530-540 ·
//   GSFrame.dockHost() L783.
// Differences from the live module, on purpose:
//   - State is S.ui.frame inside the app's one store (via the `state` getter), never `gs.frame.v1` (04a §4).
//     The live per-view-kind defaults (stage boards folded, L75) are not ported: One Studio opens every dock.
//   - Sizes left unset (null) are "auto": the 02-inputs-outputs targets (map 340, grid 220, inspector 320), which give
//     way (map first, then inspector, never below their clamps) so the board keeps 320 px on a small window.
//     A dragged size is explicit and is only ever clamped, as live.
//   - The frame never re-renders the board and never writes location.hash or history (only studiohash.js via save()).
//   - The live module has no dock keyboard shortcuts (no keydown handler for docks in 30-app-frame.js; its only keys
//     are ⌘K / Esc for the omnibox, L710-715), and the preview's `g` is the guided review (08-tests §Keyboard), so no
//     dock keys are bound here.
// The pure functions (DEFAULTS … dragValue) touch no DOM and are unit-tested in tests/frame.test.mjs.

export const LIMITS = Object.freeze({
  mapMin: 180, mapReserve: 420, mapFloor: 220,          // live L533
  bottomMin: 60, bottomReserve: 220, bottomFloor: 80,   // live L536
  inspMin: 220, inspMax: 560,                           // live L539
  NARROW: 1000, TIGHT: 800,                             // live L123
  autoMap: 340, autoMapFrac: 0.40, autoBottom: 220, autoInsp: 320,   // live 30-app-frame.css L25: --dock-map:40% (autoMap only when unmeasured)
  boardMin: 320, boardFloor: 280,                       // auto sizes give way below boardMin; docks fold below boardFloor
  split: 4, tab: 24,                                    // studio.css --split / --tab-w
});
/** Lift plan 14 (design/14-lift-projects-configurator-continuum.md §3, L0 2026-10-11): the lifted features ship dark;
 *  the slice that wires one (L1 projects, L3 configurator, L4 continuum) turns its flag on here. Also on GSFrame.features. */
export const features = Object.freeze({ projects: true, configurator: true, continuum: true }); // L1 + L3 + L4 wired by the round-1 integrator (2026-10-13), each behind its smoke
export const featureOn = k => Object.hasOwn(features, k) && features[k] === true;
/** Stored frame state: null size = auto; the *Off flags are the reader's choice. */
export const DEFAULTS = Object.freeze({ map: null, bottom: null, insp: null, mapOff: false, bottomOff: false, inspOff: false });

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const clampMap = (v, bodyW) => clamp(v, LIMITS.mapMin, Math.max(LIMITS.mapFloor, bodyW - LIMITS.mapReserve));
export const clampBottom = (v, smH) => clamp(v, LIMITS.bottomMin, Math.max(LIMITS.bottomFloor, smH - LIMITS.bottomReserve));
export const clampInsp = v => clamp(v, LIMITS.inspMin, LIMITS.inspMax);

const size = v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
/** The stored frame record, whatever was in storage: known keys only, bad sizes back to auto. */
export function normFrame(x) {
  const o = x && typeof x === 'object' ? x : {};
  return { map: size(o.map), bottom: size(o.bottom), insp: size(o.insp), mapOff: !!o.mapOff, bottomOff: !!o.bottomOff, inspOff: !!o.inspOff };
}

/** Effective sizes for a body width and .sm height. Stored sizes are clamped (re-clamped after a resize); auto sizes
 *  also give way so the board keeps LIMITS.boardMin. When even the clamp floors leave the board under
 *  LIMITS.boardFloor (a phone-width window), the map folds, then the inspector: effective only, listed in
 *  `autoFolded`; the stored choice is untouched and returns when the window widens. An unmeasured geometry (0)
 *  returns the targets. */
export function fitSizes(st, { bodyW = 0, smH = 0 } = {}) {
  const L = LIMITS, s = normFrame(st);
  const measured = bodyW > 0, autoFolded = [];
  let map = s.map ?? (measured ? Math.round(bodyW * L.autoMapFrac) : L.autoMap), insp = s.insp ?? L.autoInsp, bottom = s.bottom ?? L.autoBottom;
  let mapOff = s.mapOff, inspOff = s.inspOff;
  if (measured) { map = clampMap(map, bodyW); insp = clampInsp(insp); }
  if (smH > 0) bottom = clampBottom(bottom, smH);
  const board = () => bodyW - (mapOff ? L.tab : map + L.split) - (inspOff ? L.tab : insp + L.split);
  // Folding depends on the window alone (do the docks fit at their clamp floors?), never on a size the reader dragged.
  const floorBoard = () => bodyW - (mapOff ? L.tab : L.mapMin + L.split) - (inspOff ? L.tab : L.inspMin + L.split);
  const giveInsp = () => { if (s.insp == null && !inspOff && board() < L.boardMin) insp = Math.max(L.inspMin, insp - (L.boardMin - board())); };
  if (measured) {
    if (!mapOff && floorBoard() < L.boardFloor) { mapOff = true; autoFolded.push('map'); }
    if (!inspOff && floorBoard() < L.boardFloor) { inspOff = true; autoFolded.push('insp'); }
    if (s.map == null && !mapOff && board() < L.boardMin) map = Math.max(L.mapMin, map - (L.boardMin - board()));
    giveInsp();
  }
  return { map, bottom, insp, mapOff, bottomOff: s.bottomOff, inspOff, board: measured ? board() : 0, autoFolded };
}

/** The live two-step board-width rule (L110-129): captions give way first, then the band's flag chips. */
export const widthClass = w => ({ narrow: w > 0 && w < LIMITS.NARROW, tight: w > 0 && w < LIMITS.TIGHT });

/** Public dock names (GSFrame.setDock / dockHost) to the state key. */
export const dockKey = name => ({ map: 'map', grid: 'bottom', bottom: 'bottom', inspector: 'insp', insp: 'insp' }[name] || null);

/** A splitter drag: the map grows with the pointer; the grid (dragged up) and the inspector (dragged left) against it. */
export function dragValue(key, v0, delta, { bodyW = 0, smH = 0 } = {}) {
  if (key === 'map') return clampMap(v0 + delta, bodyW);
  if (key === 'bottom') return clampBottom(v0 - delta, smH);
  if (key === 'insp') return clampInsp(v0 - delta);
  return v0;
}

const LABEL = { map: 'Network map', bottom: 'Data grid', insp: 'Inspector' };

/**
 * Wire the frame onto the persistent dock markup chrome.js renders once (renderFrame). Never rebuilds a node.
 * @param {HTMLElement} app  #app
 * @param {{state: () => object, persist: () => void, toast?: (msg: string) => void}} o
 *   state() returns S.ui.frame (the live object; the frame mutates it), persist() writes the one store (no hash).
 */
export function mountFrame(app, { state, persist, toast = () => {} }) {
  let last = null;
  const sm = () => app.querySelector(':scope>.sm');
  const body = () => sm()?.querySelector(':scope>.body');
  const geo = () => ({ bodyW: body()?.clientWidth || 0, smH: sm()?.clientHeight || 0 });

  /** Sizes and fold states are custom properties and classes on #app (live L94-106), so a board render never loses one. */
  function applySizes() {
    const f = fitSizes(state(), geo());
    app.style.setProperty('--dock-map', `${Math.round(f.map)}px`);
    app.style.setProperty('--dock-bottom', `${Math.round(f.bottom)}px`);
    app.style.setProperty('--inspector-w', `${Math.round(f.insp)}px`);
    app.classList.toggle('gsf-map-off', f.mapOff);
    app.classList.toggle('gsf-bottom-off', f.bottomOff);
    app.classList.toggle('gsf-insp-off', f.inspOff);
    for (const [k, off] of [['map', f.mapOff], ['bottom', f.bottomOff], ['insp', f.inspOff]])
      app.querySelectorAll(`[data-gsf-dock="${k}"][data-gsf-open]`).forEach(b => b.setAttribute('aria-expanded', String(!off)));
    syncWidth();
    last = f;
    return f;
  }
  /** Measured on the board, not #gsf-ws (live L118-131): the inspector shares #gsf-ws. */
  function syncWidth() {
    const ws = app.querySelector('#gsf-ws'), board = ws?.querySelector(':scope>.board');
    const w = board?.clientWidth || ws?.clientWidth || 0;
    const c = widthClass(w);
    app.classList.toggle('gsf-narrow', c.narrow);
    app.classList.toggle('gsf-tight', c.tight);
  }

  function setDock(name, open) {
    const k = dockKey(name); if (!k) return false;
    const st = state(), off = !open;
    if (st[`${k}Off`] === off) {
      if (!off && last?.autoFolded.includes(k)) toast(`No room for the ${LABEL[k].toLowerCase()} dock at this window width: widen the window${k === 'map' ? ' or fold the inspector' : ''}.`);
      return true;
    }
    st[`${k}Off`] = off;
    persist(); applySizes();
    toast(`${LABEL[k]} dock ${off ? 'collapsed to its edge tab' : 'restored'}. Remembered in this browser.`);
    return true;
  }

  /** Live dragger (L490-528): pointer capture, and the release heard four ways so a refused capture still ends the drag. */
  function dragger(el, key, axis, read) {
    if (!el || el._gsfDrag) return;
    el._gsfDrag = true;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* no capture: the document listeners still track */ }
      el.classList.add('gsf-drag');
      document.body.classList.add('gsf-dragging', `gsf-${axis}`);
      const p0 = axis === 'x' ? e.clientX : e.clientY, v0 = read(), g = geo();
      const move = ev => { state()[key] = dragValue(key, v0, (axis === 'x' ? ev.clientX : ev.clientY) - p0, g); applySizes(); };
      let done = false;
      const up = () => {
        if (done) return; done = true;
        el.classList.remove('gsf-drag');
        document.body.classList.remove('gsf-dragging', 'gsf-x', 'gsf-y');
        el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
        document.removeEventListener('pointermove', move, true);
        document.removeEventListener('pointerup', up, true);
        document.removeEventListener('mouseup', up, true);
        persist();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', up, true);
      document.addEventListener('mouseup', up, true);
    });
  }

  const rect = sel => app.querySelector(sel)?.getBoundingClientRect();
  dragger(app.querySelector('#gsf-split-v'), 'map', 'x', () => rect('#gsf-dock-map')?.width || last?.map || LIMITS.autoMap);
  dragger(app.querySelector('#gsf-split-h'), 'bottom', 'y', () => rect('#gsf-dock-bottom')?.height || last?.bottom || LIMITS.autoBottom);
  dragger(app.querySelector('#gsf-split-i'), 'insp', 'x', () => rect('#gsf-insp')?.width || last?.insp || LIMITS.autoInsp);
  // Edge tabs (expand) and collapse buttons: direct listeners on persistent nodes, no data-act, so the shell's
  // delegated handler never sees them and never re-renders for a dock toggle.
  app.querySelectorAll('[data-gsf-dock]').forEach(b => {
    if (b._gsfDock) return; b._gsfDock = true;
    b.addEventListener('click', e => { e.preventDefault(); setDock(b.dataset.gsfDock, b.dataset.gsfOpen === '1'); });
  });

  let raf = 0;
  addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(applySizes); });

  const api = {
    /** The host element ext/31 mounts into (live L783): stable across board renders. */
    dockHost: name => document.getElementById(name === 'map' ? 'gsx-map-dock' : name === 'grid' || name === 'bottom' ? 'gsx-grid-dock' : name === 'inspector' ? 'inspector' : '') || null,
    sizes: () => ({ ...(last || applySizes()), stored: { ...normFrame(state()) } }),
    setDock: (name, open) => setDock(name, open !== false),
    applySizes,
    features, featureOn,
  };
  window.GSFrame = api;
  applySizes();
  return api;
}
