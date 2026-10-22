// P3 calc spec 07 (decision + projects): run every Decision / project calculator on real buses and print the numbers
// quoted in ../07-decision.md. Nothing in the doc is hand-typed: each worked example is a key of out/07-decision.json.
// Inputs: one-studio/app/data/*.json (the DB snapshot the suite uses), the recorded fleet profile and Studio-copy
// fixtures (one-studio-devkit/app/fixtures), out/07-population.json (07-decision-population.py, unified DB read-only),
// rules/isone-2026.json + rules/isone-2026/defaults.json. No server, no port.
// Usage: node 07-decision.mjs  ->  out/07-decision.json (+ the same JSON on stdout)
// Provenance: Claude Opus 5.5 (P3 spec:decision agent) · one-studio-devkit/design/plan.md P3 · 2026-10-15 · v1
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const GS = path.resolve(here, '../../../..');
const APP = path.join(GS, 'one-studio', 'app');
const FIX = path.join(GS, 'one-studio-devkit', 'app', 'fixtures');
const imp = f => import(pathToFileURL(path.join(APP, f)).href);
const rd = f => JSON.parse(readFileSync(path.join(APP, 'data', f), 'utf8'));
const gz = f => JSON.parse(gunzipSync(readFileSync(path.join(FIX, f))).toString('utf8'));

const D = await imp('decisioncore.js');
const F = await imp('decisionfuel.js');
const PK = await imp('decisionpack.js');
const PJ = await imp('projects.js');
const { dailySpreads, analyzePrices } = await imp('prices.js');
const { coreBasis } = await imp('basis.js');
const { clearSky } = await imp('solar.js');
const { loadEnergyCost } = await imp('economics-load.js');

const data = { ...rd('snapshot.json'), queue: rd('queue.json'), queueRegister: rd('queue-register.json'), land: rd('land.json'), flags: rd('flags.json') };
const RULES = JSON.parse(readFileSync(path.join(APP, 'rules', 'isone-2026.json'), 'utf8'));
const DEFAULTS = JSON.parse(readFileSync(path.join(APP, 'rules', 'isone-2026', 'defaults.json'), 'utf8'));
const fleet = (() => { const p = gz('x__economics__profile__all.json.gz'); return { solar: p.solar, wind: p.wind }; })();
const popFile = path.join(here, 'out', '07-population.json');
if (!existsSync(popFile)) throw new Error('run 07-decision-population.py first');
const pop = JSON.parse(readFileSync(popFile, 'utf8'));
const popFixture = gz('x__decision__population__all.json.gz');
const studioRow = id => gz(`x__decision__studio__${id}.json.gz`).row;

const basis = { mode: 'historical', market: 'RT', years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false };
const node = id => data.nodes.find(n => String(n.id) === String(id));
const r = (v, dp = 4) => (typeof v === 'number' && Number.isFinite(v) ? +v.toFixed(dp) : v ?? null);
const out = { generatedAt: new Date().toISOString(), snapshot: data.metadata.createdAt, buses: data.nodes.map(n => `${n.id} ${n.name}`), basis };

// ---------- 1. optionMetrics + gates: solar 100 MW at Mashpee (111403) and Lincolnville (100178) ----------
const P = { tech: 'solar', exportMW: 100, importMW: 0, basis, cf: D.ECON_DEFAULTS.solarCF / 100, lossPct: D.ECON_DEFAULTS.lossPct };
const tax = { fin: {}, tax: {}, queueCod: null, rules: RULES };
const mSolar = id => D.optionMetrics(data, node(id), { ...P, fleet });
const summarise = m => ({ bus: `${m.node.id} ${m.node.name}`, exportLimit: r(m.exportLimit, 2), exportStatus: m.exportStatus, exportCase: m.exportCase, exportValueBasis: m.exportValueBasis,
  envelopeOnly: m.envelopeOnly, cost: { status: m.cost.status, total: r(m.cost.total, 4), text: D.costText(m.cost) }, queueMatched: m.queueMatched, queueLinkedMW: r(m.queueLinkedMW, 2),
  queueNotModelled: r(m.queueNotModelled, 2), queueStatusChecked: m.queueStatusChecked, queueLinkedTotal: m.queueLinkedTotal, queueRegisterTotal: m.queueRegisterTotal,
  land: { status: m.land.status, reason: m.land.reason || null }, tier: m.tier,
  revenue: { value: r(m.revenue.value, 0), capture: r(m.revenue.capture, 4), mean: r(m.revenue.mean, 4), clippedAt: m.revenue.clippedAt, genMWh: r(m.revenue.genMWh, 1), spillMWh: r(m.revenue.spillMWh, 1), spillReason: m.revenue.spillReason || null },
  captureClearSky: r(m.fuel.capture.clearSky?.ratio, 5), captureFleet: r(m.fuel.capture.fleet?.ratio, 5), fleetUsedRef: m.fuel.capture.fleet?.usedRef ?? null, fleetUnfilled: m.fuel.capture.fleet?.unfilled ?? null,
  clip: m.fuel.clip ? { share: r(m.fuel.clip.share, 6), reason: m.fuel.clip.reason || null, evidence: m.fuel.clip.evidence || null } : null });
for (const id of ['111403', '100178']) {
  const m = mSolar(id), gs = D.gates(m, { ...P, tax });
  out[`solar100_${id}`] = { metrics: summarise(m), gates: gs.map(g => ({ gate: g.gate, verdict: g.verdict, why: g.why })), tally: D.gateTally(gs).label, ownExportLimit: r(D.ownExportLimit(data.grid, id), 2) };
  const gsUser = D.gates(m, { ...P, thresholds: F.thresholdsFor('solar', { user: { capture: 70 } }) });
  out[`solar100_${id}`].captureAtUser70 = gsUser.find(g => g.gate === 'Capture');
  out[`solar100_${id}`].openItems = D.openItems([m], [gs]).map(o => ({ gate: o.gate, verdict: o.verdict, what: o.what, where: o.where }));
  out[`solar100_${id}`].memo = D.memoQualifiers(m, 'solar', data.land);
}

// ---------- 2. revenueFor arithmetic on 111403, recomputed by hand from the same rows ----------
{
  const n = node('111403'), res = analyzePrices(data, coreBasis({ ...basis, nodeId: '111403' })), rows = res.rows;
  const lim = mSolar('111403').exportLimit, mw = 100, cf = P.cf, loss = P.lossPct;
  const shape = rows.map(x => clearSky(x.timestamp, n.latitude, n.longitude) ?? 0);
  const hours = rows.reduce((t, x) => t + x.dtHours, 0), mean = shape.reduce((t, v, i) => t + v * rows[i].dtHours, 0) / hours;
  let gen = 0, rev = 0, preCap = 0;
  rows.forEach((x, i) => { const raw = mean ? (mw * cf * shape[i]) / mean : 0; preCap += raw * x.dtHours; const pot = Math.min(mw, raw) * (1 - loss / 100), o = Math.min(lim ?? mw, pot); gen += o * x.dtHours; rev += o * x.price * x.dtHours; });
  const v = D.revenueFor(data, n, basis, 'solar', mw, { cf, lossPct: loss, exportLimit: lim });
  out.revenue_111403 = { hours, meanShape: r(mean, 6), cfInput: cf, lossPct: loss, exportLimit: lim, byHandAnnual: r(rev / (hours / 8760), 0), code: r(v.value, 0), capturePrice: r(v.capture, 4), meanPrice: r(v.mean, 4),
    potentialMWh: r(v.genMWh, 1), deliveredMWh: r(gen, 1), preNameplateMWh: r(preCap, 1), realisedCFdelivered: r(gen / (mw * hours), 5), realisedCFpreLoss: r(gen / (1 - loss / 100) / (mw * hours), 5),
    nameplateCapLossMWh: r(preCap - (v.genMWh / (1 - loss / 100)), 1) };
}

// ---------- 3. captureRatio + fleetShapeFor on 111403 ----------
{
  const n = node('111403'), rows = analyzePrices(data, coreBasis({ ...basis, nodeId: '111403' })).rows;
  const cs = F.captureRatio(rows, x => clearSky(x.timestamp, n.latitude, n.longitude));
  const fs = F.fleetShapeFor(rows, fleet, 'solar', x => clearSky(x.timestamp, n.latitude, n.longitude) === 0);
  const fc = F.captureRatio(rows, (x, i) => fs.shape[i]);
  out.capture_111403 = { clearSky: { capture: r(cs.capture, 4), avg: r(cs.avg, 4), ratio: r(cs.ratio, 5), missingHours: cs.missingHours },
    fleet: { capture: r(fc.capture, 4), avg: r(fc.avg, 4), ratio: r(fc.ratio, 5), missingHours: fc.missingHours, usedRef: fs.usedRef, nightZero: fs.nightZero, unfilled: fs.unfilled },
    capturePassCount70: F.capturePassCount(pop, 70) };
}

// ---------- 4. Thresholds ----------
out.thresholds = { solar: F.thresholdsFor('solar'), datacenterPop: F.thresholdsFor('datacenter', { pop }).dcPrice, datacenterFixturePop: F.thresholdsFor('datacenter', { pop: popFixture }).dcPrice,
  datacenterNoPop: F.thresholdsFor('datacenter').dcPrice, userOverride: F.thresholdsFor('storage', { user: { tb4: '12.5' } }).tb4,
  lmp2030: { heldCurrent: pop.values.lmp_2030.filter(v => typeof v === 'number').length, zerosCurrent: pop.values.lmp_2030.filter(v => v === 0).length,
    heldFixture: popFixture.values.lmp_2030.filter(v => typeof v === 'number').length, zerosFixture: popFixture.values.lmp_2030.filter(v => v === 0).length } };
out.thresholdRows_storage = PK.thresholdRows(F.thresholdsFor('storage', { user: PK.userThresholds({ dTh_tb4: '12.5', decision: { th: { oppLoss: 4 } } }) }), F.FUEL_TESTS.storage);

// ---------- 5. Storage 50/50 at 111403 ----------
{
  const PS = { tech: 'storage', exportMW: 50, importMW: 50, basis, cf: P.cf, lossPct: P.lossPct };
  const m = D.optionMetrics(data, node('111403'), PS), gs = D.gates(m, { ...PS, tax });
  const rows = analyzePrices(data, coreBasis({ ...basis, nodeId: '111403' })).rows, sp = dailySpreads(rows, 4);
  out.storage50_111403 = { exportLimit: r(m.exportLimit, 2), importLimit: r(m.importLimit, 2), exportStatus: m.exportStatus, importStatus: m.importStatus, envelopeOnly: m.envelopeOnly,
    tb4: r(m.fuel.tb4?.value, 4), tb4Days: m.fuel.tb4?.days, tb4ByHand: r(sp.reduce((t, d) => t + d.spread, 0) / sp.length, 4), tb4Pop2025: r(D.popValue(pop, 'tb4', '111403'), 4),
    oppLoss: m.fuel.oppLoss, verdict: F.fuelVerdict(m.fuel, 'storage').map(x => ({ test: x.test, value: r(x.value, 4), threshold: x.threshold, verdict: x.verdict, why: x.why })),
    gates: gs.map(g => ({ gate: g.gate, verdict: g.verdict, why: g.why })) };
}

// ---------- 6. Data centre 300 MW at 111209 Hatchville ----------
{
  const PD = { tech: 'datacenter', exportMW: 0, importMW: 300, basis, cf: P.cf, lossPct: P.lossPct };
  const m = D.optionMetrics(data, node('111209'), { ...PD, pop }), gs = D.gates(m, { ...PD, tax });
  const rows = analyzePrices(data, coreBasis({ ...basis, nodeId: '111209' })).rows, lc = loadEnergyCost(rows, 300);
  const th = F.thresholdsFor('datacenter', { pop });
  out.dc300_111209 = { importLimit: r(m.importLimit, 2), importStatus: m.importStatus, loadCost: { value: r(m.loadCost.value, 0), mean: r(m.loadCost.mean, 4), hours: m.loadCost.hours },
    byHand: { value: r(lc.value, 0), meanTimes8760: r(lc.mean * 300 * 8760, 0) }, dc: { lmp2030: r(m.fuel.dc.lmp2030, 4), std: r(m.fuel.dc.std, 4), outlets: m.fuel.dc.outlets },
    hourlySdOnBasis: (() => { const h = rows.reduce((t, x) => t + x.dtHours, 0), mu = rows.reduce((t, x) => t + x.price * x.dtHours, 0) / h; return r(Math.sqrt(rows.reduce((t, x) => t + (x.price - mu) ** 2 * x.dtHours, 0) / h), 4); })(),
    verdict: F.fuelVerdict(m.fuel, 'datacenter', th).map(x => ({ test: x.test, value: r(x.value, 4), threshold: r(x.threshold, 4), verdict: x.verdict, why: x.why })),
    gates: gs.map(g => ({ gate: g.gate, verdict: g.verdict, why: g.why })) };
}

// ---------- 7. Wind 200 MW at 100178 and hybrid 150/75 at 111403 ----------
{
  const PW = { tech: 'wind', exportMW: 200, importMW: 0, basis, cf: D.ECON_DEFAULTS.windCF / 100, lossPct: P.lossPct };
  const m = D.optionMetrics(data, node('100178'), { ...PW, fleet });
  out.wind200_100178 = { exportLimit: r(m.exportLimit, 2), revenue: r(m.revenue.value, 0), shape: m.revenue.shape, captureFleet: r(m.fuel.capture.fleet?.ratio, 5), clip: m.fuel.clip ? { share: r(m.fuel.clip.share, 6), evidence: m.fuel.clip.evidence } : null,
    capture: D.gates(m, PW).find(g => g.gate === 'Capture') };
  const PH = { tech: 'hybrid', exportMW: 150, importMW: 75, basis, cf: P.cf, lossPct: P.lossPct };
  const h = D.optionMetrics(data, node('111403'), { ...PH, fleet });
  out.hybrid150_111403 = { exportLimit: r(h.exportLimit, 2), importLimit: r(h.importLimit, 2), revenue: r(h.revenue.value, 0), pvOnly: h.revenue.pvOnly, tb4: r(h.fuel.tb4?.value, 4),
    verdict: F.fuelVerdict(h.fuel, 'hybrid').map(x => ({ test: x.test, value: r(x.value, 4), verdict: x.verdict })) };
}

// ---------- 8. Price components, separation, stress, ranges ----------
{
  const ids = ['111403', '100178', '111209'], opts = ids.map(node), names = opts.map(n => n.name);
  const comps = opts.map(n => D.priceComponents(data, n, basis));
  out.components = comps.map((c, i) => ({ bus: `${ids[i]} ${names[i]}`, mean: r(c.mean, 4), energy: r(c.energy, 4), congestion: r(c.congestion, 4), loss: r(c.loss, 4), ePlusCPlusL: r(c.energy + c.congestion + c.loss, 4), hubMean: r(c.hubMean, 4), hubBasis: r(c.hubBasis, 4) }));
  out.componentTies = D.componentTies(comps);
  const cy = D.commonYears(data, opts), runs = D.commonRuns(data, opts);
  const scen = [{ label: 'Applied basis', basis }, ...cy.years.map(y => ({ label: `${y} actual`, year: y, basis: { ...basis, years: [y] } })),
    ...runs.map(x => ({ label: x.run, run: x.run, basis: { mode: 'forecast', market: 'model', run: x.run, years: [x.year], weighting: 'duration', weights: {}, strict: true, includePartial: true } }))];
  const ms = opts.map(n => D.optionMetrics(data, n, { ...P, fleet }));
  const pS = { ...P, fleet };
  const table = scen.map(sc => ({ sc, vals: opts.map((n, j) => D.stressCell(data, n, sc.basis, pS, ms[j].exportLimit).value ?? null) }));
  out.stress = { years: cy.years, runs, rows: table.map(t => ({ label: t.sc.label, vals: t.vals.map(v => r(v, 0)) })), leaders: D.stressLeaders(table, names),
    ranges: D.scenarioRanges(table).map(x => ({ min: r(x.min, 0), max: r(x.max, 0), spread: r(x.spread, 0), applied: r(x.applied, 0), worst: r(x.worst, 0), worstLabel: x.worstLabel, downside: r(x.downside, 0), downsidePct: r(x.downsidePct, 3), n: x.n, missing: x.missing })),
    separation: D.priceSeparation(table, names, { tiers: ms.map(m => m.tier) }).text, tiers: ms.map(m => m.tier) };
  const dcTable = scen.map(sc => ({ sc, vals: opts.map(n => D.stressCell(data, n, sc.basis, { tech: 'datacenter', exportMW: 0, importMW: 300 }, null).value ?? null) }));
  out.stressDC = { rows: dcTable.map(t => ({ label: t.sc.label, vals: t.vals.map(v => r(v, 4)) })), ranges: D.scenarioRanges(dcTable, { lowerBetter: true }).map(x => ({ worst: r(x.worst, 4), worstLabel: x.worstLabel, downside: r(x.downside, 4), downsidePct: r(x.downsidePct, 3) })) };
  out.coverage = D.coverageGrid(data, ms).map(x => ({ concern: x.concern, cells: x.cells.map(c => `${c.status}: ${c.detail}`) }));
  const sh = D.sharedElements(ms);
  out.sharedElements = { counts: sh.counts, minTransfer: sh.minTransfer.map(v => r(v, 2)), exportLimits: ms.map(m => r(m.exportLimit, 2)), rows: sh.rows.slice(0, 3).map(x => ({ facility: x.facility, shared: x.shared, transfer: x.cells.map(c => r(c?.transfer, 2)) })) };
  // market position
  const pos = D.positionTable(pop, ids, 'solar');
  out.position = pos.rows.map(x => ({ key: x.key, label: x.label, higher: x.higher, n: x.n, cells: x.cells.map(c => ({ value: r(c.value, 4), pct: r(c.pct, 2), oriented: r(c.oriented, 2) })) }));
  out.positionStrip0 = (() => { const s = D.positionStrip(pos, pop, 0); return { held: s.held, better: s.better, notHeld: s.notHeld, best: s.best, worst: s.worst }; })();
  const v = pop.values.solar_ratio, x = D.popValue(pop, 'solar_ratio', '111403');
  out.percentile_solar_ratio_111403 = { value: x, ...D.percentileOf(v, x) };
}

// ---------- 9. Studio notes, input hash, record diff, queue linkage ----------
out.studioNotes_111403 = D.studioNotes({ lmp_rt: D.popValue(pop, 'lmp_rt', '111403'), lmp_2030: D.popValue(pop, 'lmp_2030', '111403'), lmp_2035: D.popValue(pop, 'lmp_2035', '111403'),
  neg: D.popValue(pop, 'neg', '111403'), h200: D.popValue(pop, 'h200', '111403'), std: D.popValue(pop, 'std', '111403'), hr_sp_dis: D.popValue(pop, 'hr_sp_dis', '111403'),
  hr_sh_chg: D.popValue(pop, 'hr_sh_chg', '111403'), hr_ll_chg: D.popValue(pop, 'hr_ll_chg', '111403'), sc_mva: D.popValue(pop, 'sc_mva', '111403'), outlets: D.popValue(pop, 'outlets', '111403') }, studioRow('111403'));
{
  const S = { tech: 'solar', exportMW: 100, importMW: 0, basis, handoffs: {}, ui: {} };
  const h1 = D.inputHash(data, S, ['111403', '100178']), h2 = D.inputHash(data, { ...S, exportMW: 150, ui: { dTh_capture: '70' } }, ['111403', '100178']);
  out.recordDiff = D.recordDiff(h1, h2);
  out.queue = { total: D.queueRegisterTotal(data), text: D.queueLinkageText(mSolar('111403')) };
}
out.costText = ['Priced', 'Lower bound', 'Partly priced', 'True zero', 'No upgrades indicated', 'Not requested', 'Envelope only'].map(s => ({ status: s, text: D.costText({ status: s, total: 12.345 }) }));

// ---------- 10. Projects: defaults, new project, state, stated count, stale ----------
out.defaultsFor = Object.fromEntries([['solar', 100, 0], ['wind', 200, 0], ['storage', 100, 100], ['hybrid', 150, 75], ['datacenter', 0, 300]].map(([t, e, i]) => [`${t} ${e}/${i}`, PJ.defaultsFor(t, e, i, DEFAULTS)]));
{
  const np = PJ.newProject({ name: 'Spec example', tech: 'solar', exportMW: 100, cod: 2029 }, { rules: DEFAULTS, now: Date.UTC(2026, 9, 15), bus: { busId: '111403', busName: 'Mashpee', lat: node('111403').latitude, lon: node('111403').longitude } });
  const st = PJ.toState(np.project, 'o1');
  const s2 = PJ.setField(np.project, 'exportMW', 150, { rules: DEFAULTS });
  out.project = { ok: np.ok, errors: np.errors, stated: np.project.stated, sources: np.project.sources, econ: np.project.assumptions.ui.econ, fin: np.project.assumptions.ui.fin,
    toState: { tech: st.tech, exportMW: st.exportMW, importMW: st.importMW, nodeId: st.nodeId, qCod: st.ui.qCod, qService: st.ui.qService, siteLat: st.ui.land.siteLat, siteLon: st.ui.land.siteLon, siteSrc: st.siteSrc, inputProv: st.inputProv },
    statedCount: PJ.statedCount(np.project), after150: { capex: s2.project.assumptions.ui.fin.capex, annualOM: s2.project.assumptions.ui.fin.annualOM },
    stale: PJ.markStale([{ id: 'r1' }, { id: 'r2', stale: true, staleReason: 'x' }], 'exportMW', 100, 150), invalid: PJ.validateField('exportMW', 0, { tech: 'solar' }) };
}
out.econDefaults = D.ECON_DEFAULTS;

const json = JSON.stringify(out, null, 1);
writeFileSync(path.join(here, 'out', '07-decision.json'), json.replace(/\r\n/g, '\n') + '\n');
console.log(json);
