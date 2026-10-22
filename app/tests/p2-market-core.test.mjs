// Provenance: Claude Opus 5.5 (P2 market fix agent) · one-studio/design (T3, P2 market fixes C26 C53 C54 C55 C57 C67 C75 + basis-held) · 2026-10-10 · sign-off pending · v1
// P2 market fixes (no server): ratio names, part-year population rule everywhere, curtailment minimum sample,
// unstudied light/minimum-load cases, network-cost status counts, the Find→Rank reconciliation line, the
// basis coverage gate and Market rank exposure. Synthetic buses built to the /api/market shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepare, evaluate, requirementChecks, regions, rank, MEASURES, attachMeasures, attachCurtailment, nearbyCurtailment,
  RATIO_NAMES, rankValue, FULL_YEAR_SHARE, BASIS_MIN_HOURS, basisZoneHeld, basisHubHeld, BASIS_NOT_HELD,
  settledYears, persistence, CURTAIL_MIN_SAMPLE, curtailSampleOk, unstudiedRequired, UNSTUDIED_EXCLUDED_REASON,
  marketServiceNote, zoneCostSummary, reconcile, marketRankOf, populationRule, funnel,
} from '../marketcore.js';
import { unstudiedCases, serviceTag, studyStaleness, STUDY_VINTAGE } from '../gridrules.js';
import { solarWindowLabel, MART_SOLAR_WINDOW } from '../solar.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const el = (bus, scenario, direction, transfer, extra = {}) => ({ bus_id: bus, scenario, direction, monitored_facility: `F${bus}${scenario}${transfer}`, binding_contingency: 'C1', contingency_id: 7, dfax: 0.2, transfer_mw: transfer, base_flow_mw: 50, contingency_flow_mw: 60, rating_a_mva: 100, rating_c_mva: 120, pct_loading_no_transfer: 50, fix_cost_musd: 1, length_miles: 1, facility_type: 'line', ...extra });
const node = (id, o = {}) => ({ bus_id: id, name: `Bus ${id}`, zone: 'ME', kv: 115, lat: 44, lon: -70, tier: 'direct', proxyKm: null, lmp_2025: 60, lmp_2030: 45, hneg_2025: 50, tb4_2025: 60, solar_ratio_2025: 0.97, sc_mva: 2000, ...o });
function study() {
  return prepare({
    nodes: [node(1), node(2, { zone: 'CT', lmp_2025: 95 }), node(3, { lmp_2025: 50 }), node(4, { zone: 'CT', lmp_2025: 40 })],
    grid: {
      headroom: [1, 2, 3, 4].map(b => ({ bus_id: b, scenario: 'shoulder', direction: 'discharge', headroom_mw: 1000 })),
      constraints: [1, 2, 3, 4].flatMap(b => [el(b, 'summer_peak', 'discharge', 300), el(b, 'shoulder', 'charge', 400)]),
    },
  });
}
const REQ = { tech: 'solar', exportMW: 100, importMW: 0, zones: null, minKv: 0, useShoulder: false };
const at = (ev, id) => ev.find(e => e.node.bus_id === id);

// ---------- C26: three ratio names, one home; no ranking below display precision ----------
test('C26: the three ratio names are defined once and the window comes from solar.js', () => {
  const win = solarWindowLabel(MART_SOLAR_WINDOW).split(' (')[0];
  assert.equal(RATIO_NAMES.captureClearSky, 'Capture ratio (clear-sky shape)');
  assert.equal(RATIO_NAMES.captureFleet, 'Capture ratio (ISO-NE fleet shape)');
  assert.equal(RATIO_NAMES.solarWindow, `Solar-window price ratio (${win}, unweighted)`);
  assert.ok(MEASURES.solarRatio.label.startsWith(RATIO_NAMES.solarWindow));
  assert.ok(MEASURES.solwin30.label.startsWith(RATIO_NAMES.solarWindow));
  assert.doesNotMatch(MEASURES.solarRatio.src, /weighting/i, 'an unweighted window mean is never called a weighting');
  assert.match(MEASURES.solarRatio.src, /unweighted/);
  for (const k of Object.keys(MEASURES)) assert.doesNotMatch(MEASURES[k].label, /Solar-hour/, `${k}: the retired name`);
});

test('C26: the Market source text never names the retired ratio labels', () => {
  const src = ['marketcore.js', 'views/market.js', 'views/market-trace.js'].map(f => readFileSync(path.join(APP, f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /Solar-hour price ratio|solar weighting|Solar ratio 25/);
});

test('C26: ratios rank on their display precision (0.92706 and 0.92741 tie)', () => {
  assert.equal(MEASURES.solarRatio.prec, 3);
  const e = v => ({ node: { solar_ratio_2025: v, m: {} } });
  assert.equal(rankValue('solarRatio', e(0.92706)), rankValue('solarRatio', e(0.92741)));
  assert.equal(rankValue('solarRatio', e(null)), null);
  const s = study();
  s.nodes[0].solar_ratio_2025 = 0.92706; s.nodes[1].solar_ratio_2025 = 0.92741;
  const ev = evaluate(s, REQ).filter(x => [1, 2].includes(x.node.bus_id));
  const rk = rank(ev, ['solarRatio'], { solarRatio: 1 });
  assert.equal(rk.scored.length, 2);
  assert.equal(rk.scored[0].score, rk.scored[1].score, 'a 4th-decimal difference does not separate options');
});

// ---------- C53: population rule in evaluate() and regions(); part years flagged and not counted ----------
test('C53: evaluate() applies the population rule to the 2025 price filter and agrees with requirementChecks', () => {
  const s = study();
  attachMeasures(s, { buses: { 2: { n: { 2025: 4000 } } } });
  const r = { ...REQ, maxPrice2025: 80 };
  const ev = evaluate(s, r);
  assert.equal(at(ev, 2).status, 'unknown', 'a part-year 2025 price is not held, never failed on its winter-skewed mean');
  assert.ok(at(ev, 2).unknown.some(u => /2025 price not held/.test(u)));
  for (const e of ev) {
    const c = requirementChecks(s, e.node, r);
    const st = c.some(x => x.status === 'fail') ? 'unmet' : c.some(x => x.status === 'unknown') ? 'unknown' : 'met';
    assert.equal(st, e.status, `bus ${e.node.bus_id}`);
  }
});

test('C53: regions() median price uses the population rule (part-year buses dropped)', () => {
  const s = study();
  attachMeasures(s, { buses: { 2: { n: { 2025: 4000 } } } });
  const rg = regions(evaluate(s, REQ)), ct = rg.find(z => z.zone === 'CT');
  assert.equal(ct.medianPrice, 40, 'bus 2 ($95, part year) is not held');
  assert.equal(ct.priceHeld, 1);
  assert.equal(rg.find(z => z.zone === 'ME').medianPrice, 55);
});

test('C53: settledYears flags part years; persistence counts full settled years only', () => {
  const n = { m: { y: { 2023: 50, 2024: 45, 2025: 60, 2026: 80 }, n: { 2023: 4969, 2026: 4655 }, cl: { 2022: -1, 2023: 2, 2024: 1, 2025: -0.5, 2026: 3 } } };
  const sy = settledYears(n, ['2022', '2023', '2024', '2025', '2026']);
  assert.deepEqual(sy.map(x => [x.y, x.v, x.part]), [['2022', null, false], ['2023', 50, true], ['2024', 45, false], ['2025', 60, false], ['2026', 80, true]]);
  assert.equal(sy.find(x => x.y === '2026').hours, 4655);
  const p = persistence(n, ['2022', '2023', '2024', '2025', '2026']);
  assert.equal(p.of, 3, '2022, 2024, 2025: full years held');
  assert.equal(p.pos, 1, 'only 2024 is positive among full years');
  assert.deepEqual(p.partYears, ['2023', '2026']);
  assert.deepEqual(persistence({}, ['2025']), { pos: 0, of: 0, partYears: [], points: [{ x: 2025, y: null, part: false }] });
});

// ---------- C54: curtailment minimum sample ----------
test('C54: a curtailment share from fewer resources than the minimum sample is unknown, with n and GWh in the note', () => {
  assert.ok(Number.isInteger(CURTAIL_MIN_SAMPLE.resources) && CURTAIL_MIN_SAMPLE.resources >= 2);
  assert.ok(CURTAIL_MIN_SAMPLE.src && CURTAIL_MIN_SAMPLE.status);
  const s = study();
  const rows = (k, lat) => Array.from({ length: k }, (_, i) => [`B${lat}${i}`, 'pcr2030', 'Solar', 'ME', lat, -70, 10000, 100, 5, 1]);
  const x = { cols: ['bidder', 'run', 'type', 'zone', 'lat', 'lon', 'mwh_offered', 'mwh_curtailed', 'h_curtailed', 'h_curtailed_nonpos'], runs: ['pcr2030'], rows: [...rows(1, 44), ...rows(CURTAIL_MIN_SAMPLE.resources, 41)] };
  s.nodes[2].lat = 41; // bus 3 sits on the larger sample
  attachCurtailment(s, x);
  const one = s.nodes[0].curt.pcr2030.Solar;
  assert.equal(one.n, 1);
  assert.equal(curtailSampleOk(one), false);
  assert.equal(curtailSampleOk(s.nodes[2].curt.pcr2030.Solar), true);
  const r = { ...REQ, maxCurtailPct: 5, curtailRun: 'pcr2030' };
  const c1 = requirementChecks(s, s.nodes[0], r).find(c => c.key === 'curtail');
  assert.equal(c1.status, 'unknown');
  assert.match(c1.note, /1 resource/); assert.match(c1.note, /GWh/);
  const c3 = requirementChecks(s, s.nodes[2], r).find(c => c.key === 'curtail');
  assert.equal(c3.status, 'pass');
  assert.match(c3.note, /GWh offered/);
  const ev = evaluate(s, r);
  assert.equal(at(ev, 1).status, 'unknown'); assert.equal(at(ev, 3).status, 'met');
  assert.equal(nearbyCurtailment({ lat: 0, lon: 0 }, [], 'pcr2030', 'Solar'), null);
});

// ---------- C55: unstudied light-load / minimum-load cases ----------
test('C55: unstudied cases are not screened by default and are named on every evaluated injecting bus', () => {
  const s = study(), ev = evaluate(s, REQ);
  assert.equal(at(ev, 1).status, 'met');
  assert.deepEqual(at(ev, 1).unscreened, unstudiedCases('solar').map(u => u.label));
  assert.match(UNSTUDIED_EXCLUDED_REASON, /light load/i); assert.match(UNSTUDIED_EXCLUDED_REASON, /minimum load/i);
  const dc = evaluate(s, { tech: 'datacenter', exportMW: 0, importMW: 100 });
  assert.deepEqual(at(dc, 1).unscreened, [], 'a load is screened on withdrawal cases');
});

test('C55: with the unstudied cases required, every injecting bus is Unknown (D6.1), and checks agree', () => {
  assert.equal(unstudiedRequired({ unstudied: 1 }), true);
  assert.equal(unstudiedRequired({}), false);
  const s = study(), r = { ...REQ, requireUnstudied: true }, ev = evaluate(s, r);
  for (const e of ev) {
    assert.equal(e.status, 'unknown');
    assert.ok(e.unknown.some(u => /Light load/.test(u)) && e.unknown.some(u => /Minimum load/.test(u)));
    const c = requirementChecks(s, e.node, r);
    assert.ok(c.some(x => x.key === 'light_load|discharge' && x.status === 'unknown'));
  }
  const f = funnel(s, r);
  assert.equal(f.steps.at(-1).remain, 0);
});

test('C55: the service and staleness note comes from gridrules (one home)', () => {
  const t = marketServiceNote('solar');
  assert.ok(t.includes(serviceTag('summer_peak|discharge').short));
  assert.ok(t.includes(studyStaleness().text));
  assert.ok(t.includes(STUDY_VINTAGE));
  assert.ok(marketServiceNote('datacenter').includes(serviceTag('large_load|charge').short));
  assert.ok(marketServiceNote('storage').includes(serviceTag('shoulder|charge').short));
});

// ---------- C57: network cost per kW by zone: n and the status mix beside the median ----------
test('C57: zoneCostSummary returns n, the median, and the count by cost status; envelope-only flagged', () => {
  const cost = [
    { zone: 'ME', 100: 50, st100: 'Priced' }, { zone: 'ME', 100: 0, st100: 'True zero' }, { zone: 'ME', 100: null, st100: 'No upgrades indicated' },
    { zone: 'ME', 100: null, st100: 'Lower bound' }, { zone: 'ME', 100: null, st100: 'Partly priced' }, { zone: 'CT', 100: null, st100: 'No upgrades indicated' },
  ];
  const me = zoneCostSummary(cost, 'ME', 100);
  assert.equal(me.median, 25); assert.equal(me.n, 2); assert.equal(me.buses, 5);
  assert.deepEqual(me.byStatus, { Priced: 1, 'True zero': 1, 'No upgrades indicated': 1, 'Lower bound': 1, 'Partly priced': 1 });
  assert.equal(me.envelopeOnly, 1); assert.equal(me.excluded, 3);
  const ct = zoneCostSummary(cost, 'CT', 100);
  assert.equal(ct.median, null); assert.equal(ct.n, 0); assert.equal(ct.envelopeOnly, 1);
});

// ---------- C67: one reconciliation line ----------
test('C67: reconcile ties Find counts to Rank (in scope = met + unknown + unmet; scored + incomplete = met)', () => {
  const s = study();
  attachMeasures(s, { buses: { 2: { n: { 2025: 4000 } } } });
  const r = { ...REQ, maxPrice2025: 58 }, ev = evaluate(s, r), rk = rank(ev, ['price', 'margin'], { price: 1, margin: 1 });
  const x = reconcile(ev, rk);
  assert.equal(x.inScope, x.met + x.unknown + x.unmet);
  assert.equal(x.scored + x.incomplete, x.met);
  assert.equal(x.met, ev.filter(e => e.status === 'met').length);
  assert.match(x.text, new RegExp(`${x.inScope} in scope → ${x.met} meet · ${x.unknown} unknown · ${x.unmet} do not; Rank scores ${x.scored} of ${x.met} \\(${x.incomplete} lack 60% of weight\\)`));
  const y = reconcile(ev, null);
  assert.equal(y.scored, null); assert.doesNotMatch(y.text, /Rank/);
});

// ---------- C75: Market rank exposed for Decision Compare ----------
test('C75: marketRankOf gives the 1-based Market rank of a bus or null', () => {
  const s = study(), ev = evaluate(s, REQ), rk = rank(ev, ['price'], { price: 1 });
  const top = rk.scored[0].node.bus_id;
  assert.deepEqual(marketRankOf(rk, top), { rank: 1, of: rk.scored.length, score: rk.scored[0].score });
  assert.equal(marketRankOf(rk, 99999), null);
  assert.equal(marketRankOf(null, top), null);
});

// ---------- basis held only with ≥ 95% of 2025 hours matched ----------
test('basis: one coverage constant; basisZoneHeld / basisHubHeld null under it, MEASURES.basisZone agrees', () => {
  assert.equal(FULL_YEAR_SHARE, 0.95);
  assert.equal(BASIS_MIN_HOURS, FULL_YEAR_SHARE * 8760);
  assert.match(BASIS_NOT_HELD, /under 95% of 2025 hours matched/);
  assert.equal(basisZoneHeld({ bZone: -1.2, bHub: 0.4, bHours: 8759 }), -1.2);
  assert.equal(basisHubHeld({ bZone: -1.2, bHub: 0.4, bHours: 8759 }), 0.4);
  assert.equal(basisZoneHeld({ bZone: -1.2, bHub: 0.4, bHours: 8000 }), null);
  assert.equal(basisHubHeld({ bZone: -1.2, bHub: 0.4, bHours: 8000 }), null);
  assert.equal(basisZoneHeld({ bZone: -1.2 }), null, 'hours not held = not held');
  assert.equal(basisZoneHeld(null), null);
  assert.equal(MEASURES.basisZone.get({ node: { m: { bZone: -1.2, bHours: 8000 } } }), null);
  assert.equal(MEASURES.basisZone.get({ node: { m: { bZone: -1.2, bHours: 8760 } } }), 1.2);
});

test('basis: the Market view prints basis only through the held gate, and the 0.95 × 8760 rule is not retyped', () => {
  const v = readFileSync(path.join(APP, 'views/market.js'), 'utf8'), core = readFileSync(path.join(APP, 'marketcore.js'), 'utf8');
  assert.doesNotMatch(v, /m\.bZone|m\.bHub|m\?\.bZone|\.m\?\.bZone/, 'no raw basis read in the view');
  // (a P95 quantile, quantile(v, 0.95), is a different quantity and is allowed)
  const cover = /0\.95\s*\*|\*\s*0\.95|FULL_YEAR_SHARE = 0\.95/g;
  assert.doesNotMatch(v, cover, 'the coverage share comes from marketcore');
  assert.equal((core.match(cover) || []).length, 1, 'one home for the 95% coverage rule');
  assert.match(core, /export const FULL_YEAR_SHARE = 0\.95;/);
});

test('population rule is the same function as the 2025 price measure', () => {
  const e = { node: { lmp_2025: 70, m: { n: { 2025: 100 } } } };
  assert.equal(populationRule(e, 'lmp_2025'), null); assert.equal(MEASURES.price.get(e), null);
});
