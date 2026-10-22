// P2 economics fixes (C14, C15, C28, C35, C61, data-centre RNS year): engine rules pinned on the figures the findings
// name. The DB is read once, read-only, with bound parameters (busdata.rows), exactly the columns the engine reads.
// Provenance: Claude Opus 5.5 (P2 economics fix agent) · one-studio/design (P2 wave, economics group) · 2026-10-10 · sign-off pending · v1
//   v2 2026-10-11: three pinned dollar figures were mis-multiplied in v1 (5,886,381.9 / 9,300,134.0 / 8,821,727.6); now the exact
//   products (75×4×62.528×365×0.86, 100×4×74.064×365×0.86, (0.86×97.434−23.37)×400×365) at a tighter 1e-9 tolerance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spreadBenchmark, storageBenchmark, benchBattery, topBottom, spillAssessment, deliverableSpread } from '../economics.js';
import { dailySpreads } from '../prices.js';
import { clearSky } from '../solar.js';
import { bessBridge } from '../views/economics-fuel.js';
import { EH } from '../views/economics.js';
import { dcFlowArgs } from '../views/economics-fueltabs.js';
import { llYear } from '../views/grid-dc.js';
import { withdrawalLimits } from '../rules/largeload.js';
import { ENVELOPE_ONLY } from '../gridrules.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES = JSON.parse(readFileSync(path.join(APP, 'rules', 'isone-2026.json'), 'utf8'));
const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

// ---------- C14: hybrid benchmark sized on the project battery ----------
test('C14: the storage benchmark is sized on the battery (hybrid = importMW, storage = exportMW), never a fixed 100 MW', () => {
  assert.deepEqual(benchBattery({ tech: 'hybrid', exportMW: 150, importMW: 75, dur: 4 }), { mw: 75, dur: 4, energyMWh: 300 });
  assert.deepEqual(benchBattery({ tech: 'storage', exportMW: 100, importMW: 100, dur: 4 }), { mw: 100, dur: 4, energyMWh: 400 });
  assert.equal(benchBattery({ tech: 'solar', exportMW: 100, importMW: 0, dur: 4 }), null);
  assert.equal(benchBattery({ tech: 'hybrid', exportMW: 150, importMW: null, dur: 4 }), null, 'battery MW not held: no benchmark, never a default');
  // 110815 (finding): 100 MW gave $7.85M; the 75 MW / 300 MWh battery on the same index gives $5.89M.
  const b = benchBattery({ tech: 'hybrid', exportMW: 150, importMW: 75, dur: 4 });
  near(spreadBenchmark({ mw: b.mw, dur: b.dur, spread: 62.528, cycles: 365, rte: 0.86 }), 5_888_261.76, 1e-9);
});

test('C14: samples.json records the benchmark battery MW = the project battery MW (lead wiring regenerates the samples)', t => {
  const S = JSON.parse(readFileSync(path.join(APP, 'data', 'samples.json'), 'utf8'));
  const hy = S.projects.find(p => p.tech === 'hybrid' || p.id === 'hybrid');
  const m = hy?.assumptions?.benchBatteryMW;
  if (m == null) { t.todo('samples.json not yet regenerated with benchBatteryMW (lead wiring C14)'); return; }
  assert.equal(m, Number(hy.importMW ?? hy.assumptions?.importMW ?? 75));
});

// ---------- C15: spill / clipping not assessed when the profile never reaches the cap ----------
test('C15: a profile that peaks below the POI is "not assessed (profile peak below POI)", never 0', () => {
  const a = spillAssessment([0, 30, 58.5, 20], 93.1, { nameplateMW: 100 });
  assert.equal(a.assessed, false);
  assert.equal(a.spillMWh, null);
  near(a.peakMW, 58.5);
  assert.match(a.reason, /^not assessed \(profile peak 58\.5 MW below the 93\.1 MW POI\)/);
  const b = spillAssessment([0, 60, 70, 20], 55.7, { nameplateMW: 100 });
  assert.equal(b.assessed, true);
  near(b.spillMWh, 4.3 + 14.3);
  assert.equal(b.bound, 'lower', 'peak below nameplate: spill is a lower bound');
  const c = spillAssessment([0, 100, 50], 80, { nameplateMW: 100 });
  assert.equal(c.bound, 'exact');
  near(c.spillMWh, 20);
  assert.equal(spillAssessment([1, 2], null).assessed, false, 'no POI cap: not assessed');
  assert.match(spillAssessment([1, 2], null).reason, /not assessed/);
});

test('C15: the CF-scaled clear-sky shape at 15% CF peaks below nameplate, so its spill at a POI = nameplate is not assessed', () => {
  const recs = [];
  for (let d = 0; d < 365; d++) for (let h = 0; h < 24; h++) { const t = new Date(Date.UTC(2025, 0, 1 + d, h)); recs.push({ timestamp: t.toISOString().slice(0, 13) + ':00:00-05:00', dtHours: 1 }); }
  const shape = recs.map(r => clearSky(r.timestamp, 42.5, -71.5) ?? 0), mean = shape.reduce((t, v) => t + v, 0) / shape.length;
  const prof = shape.map(v => Math.min(100, (100 * 0.15 * v) / mean));
  const a = spillAssessment(prof, 100, { nameplateMW: 100 });
  assert.ok(a.peakMW < 100, `peak ${a.peakMW}`);
  assert.equal(a.assessed, false);
  assert.match(a.reason, /not assessed \(profile peak/);
});

// ---------- C28: energy-consistent, cap-limited storage benchmark ----------
test('C28: benchmark = MW × h × (RTE × top − bottom) × cycles, an upper bound; Powersville $8.82M vs $9.30M spread × RTE', () => {
  const top = 74.064 + 23.37, bottom = 23.37;
  const old = spreadBenchmark({ mw: 100, dur: 4, spread: 74.064, cycles: 365, rte: 0.86 });
  near(old, 9_299_475.84, 1e-9);
  const b = storageBenchmark({ mw: 100, dur: 4, top, bottom, cycles: 365, rte: 0.86 });
  near(b.value, (0.86 * top - bottom) * 400 * 365);
  near(b.value, 8_821_793.04, 1e-9);
  assert.equal(b.bound, 'upper');
  assert.equal(b.capMW, 100);
  assert.ok(old / b.value - 1 > 0.05, 'the old figure was about 5% high');
  // Capped at the tightest of the charge and discharge limits (Powersville charges at 57.3 MW).
  const c = storageBenchmark({ mw: 100, dur: 4, top, bottom, cycles: 365, rte: 0.86, chargeLimitMW: 57.3, dischargeLimitMW: 100 });
  assert.equal(c.capMW, 57.3);
  near(c.value, b.value * 0.573);
  assert.match(c.label, /upper bound/);
  assert.match(c.label, /57\.3 MW/);
  // A limit not held is not applied, and said.
  const d = storageBenchmark({ mw: 100, dur: 4, top, bottom, cycles: 365, rte: 0.86, chargeLimitMW: null });
  assert.equal(d.capMW, 100); assert.match(d.label, /charge limit not held/);
  assert.equal(storageBenchmark({ mw: 100, dur: 4, top: null, bottom, cycles: 365, rte: 0.86 }).value, null);
});

test('C28: daily form skips loss-making days (one optional cycle a day) and uses dailySpreads\' own day rule', () => {
  const day = (d, p) => p.map((price, h) => ({ timestamp: `2025-01-0${d}T${String(h).padStart(2, '0')}:00:00-05:00`, price, dtHours: 1 }));
  const flatish = Array(24).fill(50).map((v, i) => (i < 4 ? 49 : i >= 20 ? 51 : v)); // 0.86 × 51 − 49 < 0
  const spiky = Array(24).fill(30).map((v, i) => (i < 4 ? 10 : i >= 20 ? 110 : v));
  const rows = [...day(1, flatish), ...day(2, spiky), ...day(3, spiky.slice(0, 23))]; // day 3 incomplete: dropped by dailySpreads
  const days = dailySpreads(rows, 4), tb = topBottom(rows, days, 4);
  assert.equal(tb.days, 2);
  near(tb.top - tb.bottom, days.reduce((t, d) => t + d.spread, 0) / days.length);
  const b = storageBenchmark({ mw: 10, dur: 4, daily: tb.daily, cycles: 365, rte: 0.86 });
  near(b.value, 10 * 4 * ((0 + (0.86 * 110 - 10)) / 2) * 365);
});

test('C28: bessBridge takes the round-trip loss on the discharge side only (top-hour revenue), and the steps still sum to the net', () => {
  // ceiling = TB × E × days = 1000; top-hour gross = 1300 → RTE loss = −(1 − 0.86) × 1300 = −182.
  const b = bessBridge({ ceiling: 1000, topGross: 1300, rte: 0.86, dispatchFree: 700, dispatchNet: 650, degPct: 2 });
  near(b.steps[1].value, -182);
  near(b.steps[2].value, 700 - 818);
  near(b.steps.slice(0, 5).reduce((t, s) => t + s.value, 0), b.net);
  const n = bessBridge({ ceiling: 1000, rte: 0.86, dispatchFree: 700, dispatchNet: 650, degPct: 2 });
  assert.equal(n.steps[1].value, null, 'top-hour revenue not held: the RTE step is not held, never RTE × the whole spread');
  assert.equal(n.steps[2].value, null);
  near(n.net, 637);
});

test('C28: deliverable spread for the Decision storage ranking = (RTE × top − bottom) × capMW ÷ MW beside the raw TB4', () => {
  const d = deliverableSpread({ top: 97.434, bottom: 23.37, rte: 0.86, mw: 100, chargeLimitMW: 57.3, dischargeLimitMW: 100 });
  near(d.raw, 74.064);
  near(d.energy, 0.86 * 97.434 - 23.37);
  near(d.adjusted, (0.86 * 97.434 - 23.37) * 0.573);
  assert.equal(deliverableSpread({ top: 97.4, bottom: 23.4, rte: 0.86, mw: 100, chargeLimitMW: null }).capShare, 1);
  assert.equal(deliverableSpread({ top: null, bottom: 23.4, rte: 0.86, mw: 100 }).adjusted, null);
});

// ---------- C35: the data-centre connection gate uses the withdrawal cases ----------
const IDS = [103005, 121046, 110762];
const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(APP)})
import busdata
ids = json.loads(sys.argv[1])
c = busdata.connect()
q = 'IN (SELECT unnest(?::BIGINT[]))'
print(json.dumps({
 'headroom': busdata.rows(c, 'SELECT bus_id, scenario, direction, headroom_mw, pre_existing_issues FROM fact_headroom WHERE bus_id ' + q, [ids]),
 'constraints': busdata.rows(c, 'SELECT bus_id, scenario, direction, monitored_facility, binding_contingency, contingency_id, dfax, transfer_mw, base_flow_mw, contingency_flow_mw, rating_a_mva, rating_c_mva, pct_loading_no_transfer, fix_cost_musd, length_miles, facility_type, kv FROM fact_limiting_element WHERE bus_id ' + q, [ids]),
}, default=str))
`;
const r = spawnSync('python', ['-c', PY, JSON.stringify(IDS)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const grid = r.status === 0 ? JSON.parse(r.stdout) : null;
const skip = grid ? false : `unified DB not readable: ${(r.stderr || '').slice(-300)}`;

test('C35: Economics and Grid give a data centre the same withdrawal limit and status (103005, 121046, 110762)', { skip }, () => {
  for (const bus of IDS) for (const mw of [100, 300]) {
    const S = { nodeId: String(bus), tech: 'datacenter', exportMW: 0, importMW: mw, ui: {}, handoffs: {} };
    const e = EH.limitsFor({ data: { grid }, S }, 0, mw), w = withdrawalLimits(grid, bus, mw, RULES);
    assert.equal(e.im.value, w.firm.value, `${bus} ${mw}: limit`);
    assert.equal(e.im.status, w.firm.status, `${bus} ${mw}: status`);
    assert.ok(!['shoulder|charge'].includes(e.im.key), `${bus}: never the storage shoulder-charge case`);
    assert.ok(e.im.cases.every(c => ['large_load|charge', 'summer_peak|charge'].includes(c.key)), `${bus}: withdrawal cases only`);
  }
});

test('C35: the load gate passes only on element evidence that fits; Envelope only, Hold, Not studied never pass', () => {
  const x = (status, value) => ({ importLimit: value, im: { status, value }, sentGrid: false });
  assert.equal(EH.loadGate(x('Fits', 400), 300).ok, true);
  for (const st of [ENVELOPE_ONLY, 'Hold', 'Not studied', 'Partly studied']) {
    const g = EH.loadGate(x(st, 400), 300);
    assert.equal(g.ok, false, st);
    assert.match(g.msg, /conditional/);
  }
  const over = EH.loadGate(x('Does not fit', 250), 300);
  assert.equal(over.ok, false); assert.equal(over.status, 'Does not fit');
});

test('C35: on the DB rows, an envelope-only withdrawal case never passes the Economics gate', { skip }, () => {
  for (const bus of IDS) {
    const S = { nodeId: String(bus), tech: 'datacenter', exportMW: 0, importMW: 300, ui: {}, handoffs: {} };
    const im = EH.limitsFor({ data: { grid }, S }, 0, 300).im;
    const g = EH.loadGate({ importLimit: im.value, im, sentGrid: false }, 300);
    assert.equal(g.ok, im.status === 'Fits', `${bus}: ${im.status}`);
  }
});

// ---------- RNS year: one rule (llYear) on Economics and Grid ----------
test('DC RNS year: Economics passes llYear(rules), the year the Grid cards and the ll_tx column use, not the calendar year', () => {
  const S = { nodeId: '111403', importMW: 150, ui: { llService: 'NFCDS', llAppDate: '2027-03-01' } };
  const node = { nominal_kv: 345, kv: 115 };
  const a = dcFlowArgs(S, node, RULES, { value: 1 });
  assert.equal(a.year, llYear(RULES));
  assert.equal(a.kv, 345); assert.equal(a.service, 'NFCDS'); assert.equal(a.applicationDate, '2027-03-01'); assert.equal(a.mw, 150);
  // Rules that hold only an older year: the latest held year, never a calendar year with no rate.
  const old = { ...RULES, large_load: { ...RULES.large_load, rns_rate: { 2025: 170, unit: '$/kW-yr', src: 'test' } } };
  assert.equal(dcFlowArgs(S, node, old, { value: 1 }).year, 2025);
  assert.equal(dcFlowArgs(S, { kv: 115 }, RULES, { value: 1 }).kv, 115, 'kv falls back to the bus kV, as on Grid');
});

// ---------- C61: rules citations against the register ----------
test('C61: Class I ACP cites 225 CMR 14.08(4)(a)2, not 310 CMR; Clean Peak windows match R2 §E1 / 225 CMR 21.05', () => {
  const recs = JSON.parse(readFileSync(path.join(APP, 'rules', 'isone-2026', 'recs.json'), 'utf8')).recs_ma;
  assert.match(recs.class1_acp.src, /225 CMR 14\.08\(4\)\(a\)2/);
  assert.doesNotMatch(recs.class1_acp.src, /310 CMR/);
  assert.equal(recs.class1_acp.value, 40);
  const w = Object.fromEntries(recs.clean_peak_seasons.rows.map(s => [s.season, [s.from, s.to, s.start_hour, s.end_hour, s.multiplier]]));
  assert.deepEqual(w, { Spring: ['03-01', '05-14', 17, 21, 1], Summer: ['05-15', '09-14', 16, 20, 4], Fall: ['09-15', '11-30', 16, 20, 1], Winter: ['12-01', '02-28', 16, 20, 4] });
  assert.match(recs.clean_peak_seasons.hour_rule, /hour-beginning/);
  const reg = readFileSync(path.join(APP, '..', '..', 'v8-isone-complete', 'research', 'REGISTER.md'), 'utf8');
  assert.match(reg, /Clean Peak seasons \| Spring ×1 \(17–21 h\); summer and winter ×4, fall ×1 \(16–20 h\)/, 'the register row exists');
});

test('C61: the merged rules file carries the corrected citation (after node rules/build.mjs)', t => {
  if (/310 CMR/.test(RULES.recs_ma.class1_acp.src)) { t.todo('rules/isone-2026.json not rebuilt yet (lead wiring: node rules/build.mjs)'); return; }
  assert.match(RULES.recs_ma.class1_acp.src, /225 CMR 14\.08\(4\)\(a\)2/);
});
