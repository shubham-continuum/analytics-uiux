// Live-hash corpus generator (M5, 08-tests "Live-hash corpus"): the LIVE Studio's own readHash is the oracle.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1
//
// Reads the PINNED read-only snapshot app-tools/live-snapshot/2026-10-06/src/{app.js,data.js} (never edited), extracts
// readHash() plus the state it touches (defaults(), DEPTHS, project/options/optionById, GS.node over GS_DATA.nodes) and
// runs it in a node:vm sandbox on a fresh state per URL (a fresh open: no localStorage). Writes
// tests/fixtures/hash-corpus.json with the source hashes in its header. Regenerate, never edit:
//   node plan/gen_hash_corpus.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = path.resolve(APP, '..', 'app-tools', 'live-snapshot', '2026-10-06', 'src');
const OUT = path.join(APP, 'tests', 'fixtures', 'hash-corpus.json');
const sha = s => createHash('sha256').update(s).digest('hex');
const appSrc = readFileSync(path.join(SNAP, 'app.js'), 'utf8');
const dataSrc = readFileSync(path.join(SNAP, 'data.js'), 'utf8');

/** Text from `start` to the bracket that closes the first `open` after `start` (quote-aware, regex-literal-naive, which is
 *  enough for these one-line functions; the extracted text is printed into the header so a reviewer can read it). */
function extract(src, start, open = '{') {
  const i = src.indexOf(start); if (i < 0) throw new Error(`not in live source: ${start}`);
  const close = { '{': '}', '(': ')' }[open];
  let j = src.indexOf(open, i + start.length), depth = 0, q = null;
  for (; j < src.length; j++) {
    const c = src[j];
    if (q) { if (c === '\\') j++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) depth++; else if (c === close && --depth === 0) break;
  }
  return src.slice(i, j + 1);
}
const line = re => { const m = appSrc.match(re); if (!m) throw new Error(`not in live source: ${re}`); return m[0].trim(); };

const parts = {
  seed: appSrc.slice(0, appSrc.indexOf('window.GS = (function')),
  depths: line(/^\s*const DEPTHS = \[.*?\];/m),
  defaults: extract(appSrc, 'const defaults = () =>', '(') + ';',
  project: line(/^\s*const project = .*;$/m),
  options: line(/^\s*const options = .*;$/m),
  optionById: line(/^\s*const optionById = .*;$/m),
  readHash: extract(appSrc, 'function readHash()'),
  node: line(/node: id => byId\.get\(Number\(id\)\)/),
};

// The live node set: GS.node(id) = byId.get(Number(id)) over GS_DATA.nodes keyed by bus_id (app.js L118-121, L451).
const dctx = { window: {} }; vm.createContext(dctx); vm.runInContext(dataSrc, dctx);
const D = dctx.window.GS_DATA, bi = D.nodes.cols.indexOf('bus_id');
const liveIds = new Set(D.nodes.rows.map(r => r[bi]));

const sandbox = { window: {}, location: { hash: '' }, localStorage: { getItem: () => null, setItem() { } }, LIVE_IDS: liveIds };
vm.createContext(sandbox);
vm.runInContext(`${parts.seed}
const seed = window.GS_SEED;
${parts.depths}
${parts.defaults}
let S = defaults();
${parts.project}
${parts.options}
${parts.optionById}
const byId = { get: id => (LIVE_IDS.has(id) ? { bus_id: id } : undefined) };
const GS = { ${parts.node} };
${parts.readHash}
globalThis.__run = hash => { S = defaults(); location.hash = hash; readHash();
  return { view: S.view, stage: S.stage, project: S.projectId, option: S.optionId, depth: S.depth, caseKey: S.basis.case,
    hz: S.basis.horizon, hist: S.basis.histYear, cmp: S.compare.slice(), pins: S.pins.slice(), list: S.listView, block: S.selectedBlock }; };
globalThis.__defaults = () => { const d = defaults(); return { view: d.view, stage: d.stage, project: d.projectId, option: d.optionId, depth: d.depth,
  caseKey: d.basis.case, hz: d.basis.horizon, hist: d.basis.histYear, cmp: d.compare, pins: d.pins, list: d.listView, block: d.selectedBlock }; };
globalThis.__seed = () => defaults().projects.map(p => ({ id: p.id, options: options(p).map(o => ({ id: o.id, busId: String(o.busId), status: o.status })) }));`, sandbox);

// NaN / Infinity survive JSON as strings (live stores +q.hz unchecked: hz=abc is NaN in the live state).
const fin = v => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
const oracle = hash => { const s = sandbox.__run(hash); return { ...s, hz: fin(s.hz), hist: fin(s.hist), pins: s.pins.map(fin) }; };

// ---------- the corpus: hand-written edge cases first, then seeded combinations to 200 ----------
let seedN = 20261006;
const rnd = () => ((seedN = (seedN * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = a => a[Math.floor(rnd() * a.length)];
const seedP = sandbox.__seed();
const STAGES = ['market', 'land', 'grid', 'queue', 'prices', 'economics', 'decision'];
const seedBuses = [...new Set(seedP.flatMap(p => p.options.map(o => o.busId)))];
const extraLive = [...liveIds].sort((a, b) => a - b).filter((_, i) => i % 97 === 0).slice(0, 12).map(String);
const PIN_POOL = [...new Set(['111403', '100178', '110807', ...seedBuses, ...extraLive])];
const NOT_LIVE = ['999999999', '1'].filter(x => !liveIds.has(Number(x)));
const live = (o, order) => {
  const keys = order || ['v', 'stage', 'project', 'option', 'depth', 'case', 'hz', 'hist', 'cmp', 'pins'];
  return keys.filter(k => o[k] !== undefined).map(k => `${k}=${o[k]}`).join('&');
};
const ACCEPT = 'v=stage&stage=grid&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025&cmp=o1,o2&pins=111403,100178,110807';
const cases = [];
const add = (hash, tags) => { if (!cases.some(c => c.hash === hash)) cases.push({ id: `h${String(cases.length + 1).padStart(3, '0')}`, hash, tags }); };

add(ACCEPT, ['acceptance-1']);
add('', ['empty']);
add('grid', ['no-equals']);
add('v=stage', ['only-v']);
add('stage=decision', ['missing-keys']);
add('project=campus', ['missing-keys', 'project-switch']);
add('project=campus&option=o8', ['project-switch']);
add('project=merrimack&option=o6&stage=queue', ['project-switch', 'odd-order']);
add('project=downeast&cmp=', ['project-switch', 'empty-cmp']);
add('project=nope&option=o2&stage=grid', ['unknown-project']);
add('project=kennebec&option=o99&stage=land', ['unknown-option']);
add('project=kennebec&option=o4&stage=land', ['cross-project-option']);
add('project=campus&option=o1', ['cross-project-option']);
add(`${ACCEPT.replace('pins=111403,100178,110807', `pins=${PIN_POOL.slice(0, 6).join(',')}`)}`, ['six-pins']);
add(`stage=grid&pins=${PIN_POOL.slice(0, 7).join(',')}`, ['seven-pins']);
add(`stage=grid&pins=111403,111403,100178`, ['dup-pins']);
add(`stage=grid&pins=${NOT_LIVE.join(',')},111403`, ['unknown-pins']);
add('stage=grid&pins=', ['empty-pins']);
add('stage=grid&pins=,,111403,', ['sparse-pins']);
add('stage=grid&pins=111403%2C100178', ['encoded-comma']);
add('stage=grid&pins=0111403', ['leading-zero-pin']);
add('stage=grid&pins=111403.0', ['decimal-pin']);
add('stage=foo', ['unknown-stage']);
add('stage=iso', ['extra-concern-stage']);
add('v=portfolio&stage=market', ['other-view']);
add('v=compare', ['other-view']);
add('depth=deep', ['bad-depth']);
add('case=xx', ['bad-case']);
add('case=', ['empty-case']);
add('hz=2031', ['bad-hz']);
add('hz=abc', ['bad-hz']);
add('hz=2045&case=ll', ['vendor-hz']);
add('hz=2050', ['vendor-hz']);
add('hist=2019', ['bad-hist']);
add('hist=2026', ['hist-edge']);
add('cmp=o1,o99', ['cmp-unknown']);
add('cmp=o4,o5', ['cmp-other-project']);
add('cmp=o1,o1,o2', ['cmp-dup']);
add('cmp=o3', ['cmp-single']);
add(`${ACCEPT}&list=1&block=g-3`, ['live-extra']);
add(`${ACCEPT}&block=a=b`, ['equals-in-value']);
add(`${ACCEPT}&stage=prices`, ['duplicate-key']);
add('pins=110807&hist=2024&hz=2035&case=sh&depth=study&option=o1&project=kennebec&stage=economics&v=stage', ['odd-order']);
add('cmp=o2,o1&depth=screen&v=stage&stage=prices&project=kennebec', ['odd-order', 'missing-keys']);
add(`${ACCEPT}&bus=111403`, ['bus-conflict']);
add(`${ACCEPT}&bus=111209`, ['bus-agrees']);
add('v=stage&stage=grid&project=campus&option=o7&bus=104095&depth=study', ['bus-conflict', 'project-switch']);
add(`${ACCEPT}&tab=capacity&step=3`, ['preview-keys']);
add('stage=grid&project=kennebec&option=o2&case=sh&hz=2040&hist=2020&pins=111403', ['missing-keys']);

const PROJ = [...seedP.map(p => p.id), 'nope'];
const optFor = p => { const sp = seedP.find(x => x.id === p); return sp ? [...sp.options.map(o => o.id), pick(['o99', 'o1'])] : ['o1', 'o2', 'o99']; };
while (cases.length < 200) {
  const p = pick(PROJ), o = {};
  o.v = rnd() < 0.9 ? 'stage' : pick(['portfolio', 'market', 'compare', undefined]);
  o.stage = rnd() < 0.95 ? pick(STAGES) : pick(['iso', 'mine', undefined]);
  o.project = rnd() < 0.92 ? p : undefined;
  o.option = rnd() < 0.9 ? pick(optFor(p)) : undefined;
  o.depth = rnd() < 0.93 ? pick(['screen', 'review', 'study']) : pick(['deep', undefined]);
  o.case = rnd() < 0.93 ? pick(['sp', 'sh', 'll']) : pick(['xx', undefined]);
  o.hz = rnd() < 0.93 ? pick([2030, 2035, 2040, 2045, 2050]) : pick([2031, undefined]);
  o.hist = rnd() < 0.93 ? pick([2020, 2021, 2022, 2023, 2024, 2025]) : pick([2019, undefined]);
  const sp = seedP.find(x => x.id === p);
  o.cmp = rnd() < 0.85 ? (sp ? sp.options.filter(() => rnd() < 0.6).map(x => x.id).join(',') : 'o1,o2') : undefined;
  const nPins = Math.floor(rnd() * 7); // 0..6
  const pins = []; while (pins.length < nPins) { const id = rnd() < 0.08 ? pick(NOT_LIVE) : pick(PIN_POOL); if (!pins.includes(id)) pins.push(id); }
  o.pins = rnd() < 0.9 ? pins.join(',') : undefined;
  const order = rnd() < 0.12 ? ['v', 'stage', 'project', 'option', 'depth', 'case', 'hz', 'hist', 'cmp', 'pins'].sort(() => rnd() - 0.5) : null;
  const tags = ['generated', ...(order ? ['odd-order'] : []), ...(nPins === 6 ? ['six-pins'] : []), ...(p === 'nope' ? ['unknown-project'] : [])];
  add(live(o, order), tags);
}

for (const c of cases) {
  c.expected = oracle(c.hash);
  // A percent-encoded hash: the live reader never decodes; the decoded form's live state is recorded as well.
  if (/%[0-9A-Fa-f]{2}/.test(c.hash)) c.expectedDecoded = oracle(c.hash.split('&').map(kv => kv.split('=').map(decodeURIComponent).join('=')).join('&'));
}
const corpusIds = [...new Set(cases.flatMap(c => (/(?:^|&)pins=([^&]*)/.exec(c.hash)?.[1] || '').split(/,|%2C/i).filter(Boolean)))];
const out = {
  _about: 'GENERATED by plan/gen_hash_corpus.mjs from the pinned live snapshot. Never edit by hand; regenerate. expected = the live Studio readHash() state on a fresh open (no localStorage).',
  provenance: 'Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-06 · sign-off pending · v1',
  source: {
    app_js: 'app-tools/live-snapshot/2026-10-06/src/app.js', app_js_sha256: sha(appSrc),
    data_js: 'app-tools/live-snapshot/2026-10-06/src/data.js', data_js_sha256: sha(dataSrc),
    readHash_sha256: sha(parts.readHash), readHash: parts.readHash, defaults_sha256: sha(parts.defaults),
  },
  liveDefaults: sandbox.__defaults(),
  catalogue: { projects: seedP, busIds: corpusIds.filter(id => liveIds.has(Number(id))).sort(), liveNodeCount: liveIds.size },
  cases,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`${cases.length} cases → ${path.relative(APP, OUT)} · app.js ${out.source.app_js_sha256.slice(0, 12)} · readHash ${out.source.readHash_sha256.slice(0, 12)} · live nodes ${liveIds.size}`);
