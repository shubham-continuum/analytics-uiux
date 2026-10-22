// Frame geometry (M1): the pure size, clamp and narrow/tight functions of frame.js.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
// Clamps and thresholds are the live frame's (pinned snapshot app-tools/live-snapshot/2026-10-06/ext/30-app-frame.js,
// sha256 54a0090a…): map 180..max(220, body-420) (L533), grid 60..max(80, sm-220) (L536), inspector 220..560 (L539),
// NARROW 1000 / TIGHT 800 measured on the board (L123-129).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, LIMITS, clamp, clampMap, clampBottom, clampInsp, normFrame, fitSizes, widthClass, dockKey, dragValue } from '../frame.js';

test('defaults: docks open, sizes auto (02-inputs-outputs: map 340, grid 220, inspector 320)', () => {
  assert.deepEqual({ ...DEFAULTS }, { map: null, bottom: null, insp: null, mapOff: false, bottomOff: false, inspOff: false });
  assert.equal(LIMITS.autoMap, 340); assert.equal(LIMITS.autoBottom, 220); assert.equal(LIMITS.autoInsp, 320);
  assert.ok(Object.isFrozen(DEFAULTS));
});

test('clamp', () => {
  assert.equal(clamp(5, 0, 10), 5); assert.equal(clamp(-1, 0, 10), 0); assert.equal(clamp(11, 0, 10), 10);
});

test('map clamp: 180 px to max(220, body - 420)', () => {
  assert.equal(clampMap(100, 1872), 180);
  assert.equal(clampMap(5000, 1872), 1452);
  assert.equal(clampMap(500, 1872), 500);
  // a narrow body never lets the upper bound fall below 220 (live L533)
  assert.equal(clampMap(5000, 500), 220);
  assert.equal(clampMap(200, 500), 200);
});

test('grid clamp: 60 px to max(80, sm - 220)', () => {
  assert.equal(clampBottom(10, 860), 60);
  assert.equal(clampBottom(5000, 860), 640);
  assert.equal(clampBottom(5000, 250), 80);
  assert.equal(clampBottom(220, 860), 220);
});

test('inspector clamp: 220 to 560 px', () => {
  assert.equal(clampInsp(100), 220); assert.equal(clampInsp(900), 560); assert.equal(clampInsp(320), 320);
});

test('normFrame: unknown keys dropped, bad numbers become auto, flags become booleans', () => {
  assert.deepEqual(normFrame(undefined), { ...DEFAULTS });
  assert.deepEqual(normFrame(null), { ...DEFAULTS });
  assert.deepEqual(normFrame('x'), { ...DEFAULTS });
  assert.deepEqual(normFrame({ map: 400, bottom: 'a', insp: NaN, mapOff: 1, busId: 'x', views: {} }),
    { map: 400, bottom: null, insp: null, mapOff: true, bottomOff: false, inspOff: false });
  assert.deepEqual(normFrame({ map: -3, insp: Infinity }), { ...DEFAULTS });
  // the live gs.frame.v1 shape is not this store's: its inspOpen / views are ignored
  assert.deepEqual(normFrame({ inspOpen: false, views: { stage: { mapOff: true } } }), { ...DEFAULTS });
});

test('fitSizes: auto sizes at 1440 follow the live rule (map 40% of the body; M5 visual parity 2026-10-07)', () => {
  // 1440 viewport - 48 px rail = 1392 body; sm 860 high. Live 30-app-frame.css L25: --dock-map:40% -> 557 px.
  const f = fitSizes(DEFAULTS, { bodyW: 1392, smH: 860 });
  assert.equal(f.map, 557); assert.equal(f.insp, 320); assert.equal(f.bottom, 220);
  assert.equal(f.board, 1392 - 561 - 324);
  assert.equal(f.mapOff, false); assert.equal(f.inspOff, false); assert.equal(f.bottomOff, false);
});

test('fitSizes: auto sizes give way so the board keeps 320 px (map first, then the inspector)', () => {
  // 900 viewport: body 852 -> map shrinks to 852-324-4-320 = 204
  let f = fitSizes(DEFAULTS, { bodyW: 852, smH: 700 });
  assert.equal(f.insp, 320); assert.equal(f.map, 204); assert.equal(f.board, 320);
  // 760 viewport: body 712 -> map to its 180 floor, then the inspector gives way to 220 floor
  f = fitSizes(DEFAULTS, { bodyW: 712, smH: 700 });
  assert.equal(f.map, 180); assert.equal(f.insp, 220); assert.equal(f.board, 712 - 184 - 224);
});

test('fitSizes: an explicit (dragged) size is only clamped, never auto-shrunk', () => {
  const f = fitSizes({ ...DEFAULTS, map: 600, insp: 500 }, { bodyW: 1232, smH: 800 });
  assert.equal(f.map, 600); assert.equal(f.insp, 500); assert.equal(f.board, 1232 - 604 - 504);
  // a window made smaller re-clamps a stored size (08-tests: re-clamp after resize)
  const g = fitSizes({ ...DEFAULTS, map: 1400, bottom: 900 }, { bodyW: 1000, smH: 600 });
  assert.equal(g.map, 580); assert.equal(g.bottom, 380);
});

test('fitSizes: a closed dock is a 24 px edge tab and gives its width to the board', () => {
  const f = fitSizes({ ...DEFAULTS, mapOff: true, inspOff: true }, { bodyW: 1392, smH: 860 });
  assert.equal(f.board, 1392 - 24 - 24);
  assert.equal(f.mapOff, true); assert.equal(f.inspOff, true);
  // a closed map leaves room, so the auto inspector keeps its 320 even on a small body
  const g = fitSizes({ ...DEFAULTS, mapOff: true }, { bodyW: 712, smH: 700 });
  assert.equal(g.insp, 320); assert.equal(g.board, 712 - 24 - 324);
});

test('fitSizes: a phone-width window folds the map, then the inspector, to keep a 280 px board (stored choice untouched)', () => {
  // 390 viewport: body 342. Floors 180 + 220 leave no board, so the map folds; still short, so the inspector folds.
  const st = { ...DEFAULTS };
  const f = fitSizes(st, { bodyW: 342, smH: 780 });
  assert.equal(f.mapOff, true); assert.equal(f.inspOff, true);
  assert.deepEqual(f.autoFolded, ['map', 'insp']);
  assert.equal(f.board, 342 - 24 - 24);
  assert.equal(st.mapOff, false); assert.equal(st.inspOff, false);
  // 600 viewport (body 552): folding the map is enough; the inspector keeps its auto 320 -> board 552-24-324 = 204 < 280,
  // so it shrinks to its floor first: 552-24-224 = 304
  const g = fitSizes(DEFAULTS, { bodyW: 552, smH: 780 });
  assert.deepEqual(g.autoFolded, ['map']); assert.equal(g.inspOff, false); assert.equal(g.insp, 220); assert.equal(g.board, 304);
  // explicit sizes fold too when nothing else fits
  const h = fitSizes({ ...DEFAULTS, map: 400, insp: 500 }, { bodyW: 342, smH: 780 });
  assert.deepEqual(h.autoFolded, ['map', 'insp']);
  // 760 keeps both docks (board 304 >= 280)
  assert.deepEqual(fitSizes(DEFAULTS, { bodyW: 712, smH: 700 }).autoFolded, []);
});

test('fitSizes: an unmeasured body (0) returns the targets, never NaN', () => {
  const f = fitSizes(DEFAULTS, { bodyW: 0, smH: 0 });
  assert.equal(f.map, 340); assert.equal(f.insp, 320); assert.equal(f.bottom, 220);
  for (const [k, v] of Object.entries(f)) if (k !== 'autoFolded') assert.ok(typeof v === 'boolean' || Number.isFinite(v), k);
  assert.deepEqual(f.autoFolded, []);
});

test('widthClass: narrow under 1000 px of board, tight under 800, nothing when unmeasured', () => {
  assert.deepEqual(widthClass(0), { narrow: false, tight: false });
  assert.deepEqual(widthClass(1200), { narrow: false, tight: false });
  assert.deepEqual(widthClass(1000), { narrow: false, tight: false });
  assert.deepEqual(widthClass(999), { narrow: true, tight: false });
  assert.deepEqual(widthClass(800), { narrow: true, tight: false });
  assert.deepEqual(widthClass(799), { narrow: true, tight: true });
});

test('dockKey: every public dock name maps to one state key', () => {
  assert.equal(dockKey('map'), 'map');
  assert.equal(dockKey('grid'), 'bottom'); assert.equal(dockKey('bottom'), 'bottom');
  assert.equal(dockKey('inspector'), 'insp'); assert.equal(dockKey('insp'), 'insp');
  assert.equal(dockKey('nope'), null);
});

test('dragValue: a drag moves the size by the pointer delta, inside the clamps (grid and inspector grow against the pointer)', () => {
  const geo = { bodyW: 1392, smH: 860 };
  assert.equal(dragValue('map', 340, 100, geo), 440);
  assert.equal(dragValue('map', 340, -1000, geo), 180);
  assert.equal(dragValue('map', 340, 5000, geo), 972);
  assert.equal(dragValue('bottom', 220, -100, geo), 320);
  assert.equal(dragValue('bottom', 220, 1000, geo), 60);
  assert.equal(dragValue('bottom', 220, -5000, geo), 640);
  assert.equal(dragValue('insp', 320, -100, geo), 420);
  assert.equal(dragValue('insp', 320, -5000, geo), 560);
  assert.equal(dragValue('insp', 320, 5000, geo), 220);
});

// lift plan 14 L0: each lifted feature ships dark behind one flag (§3: "a slice can ship dark"); a slice turns its own on.
// Round-1 integration (2026-10-13): L1 projects, L3 configurator and L4 continuum are wired and turned on, each behind its smoke.
test('feature flags: projects, configurator, continuum on (wired), frozen; unknown names are off', async () => {
  const { features, featureOn } = await import('../frame.js');
  assert.deepEqual({ ...features }, { projects: true, configurator: true, continuum: true });
  assert.ok(Object.isFrozen(features));
  for (const k of ['projects', 'configurator', 'continuum']) assert.equal(featureOn(k), true, k);
  for (const k of ['nope', '__proto__', 'toString']) assert.equal(featureOn(k), false, k);
});
