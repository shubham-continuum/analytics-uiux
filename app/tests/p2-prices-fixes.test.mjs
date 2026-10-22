// P2 prices fixes (review items C19, C52, C58, C59): one tier label with the node type, the shared-series count and
// the substation rule; one percentile method; the FER/DASI footnote on day-ahead cards; the vendor 2030 figure is
// not a headline KPI and a vendor 0.00 placeholder is "not held". Written before the code (TDD).
// Provenance: Claude Opus 5.5 (P2 prices fix agent) · one-studio/design (P2 review fixes) · 2026-10-10 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  priceTierLabel, pnodeKind, sameSubstationName, resolvePriceTier, isBorrowedPrice, priceLinkFields, priceTierText,
  weightedQuantile, quantile, analyzePrices,
} from '../prices.js';
import { sheetRows, daFerNote } from '../views/prices-calc.js';
import { provenanceChips } from '../views/prices-fuel.js';
import { readFileSync } from 'node:fs';
const RULES = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url), 'utf8'));

// ---------- C19: one tier label ----------
test('C19 pnodeKind reads the ISO-NE pnode name: type, 8-char substation field, kV', () => {
  assert.deepEqual(pnodeKind('UN.CHEMICAL115 PERC'), { type: 'UN', word: 'unit', substation: 'CHEMICAL', kv: 115 });
  assert.deepEqual(pnodeKind('LD.TASKERFM34.5'), { type: 'LD', word: 'load', substation: 'TASKERFM', kv: 34.5 });
  assert.deepEqual(pnodeKind('LD.WSHNGTN 14.4'), { type: 'LD', word: 'load', substation: 'WSHNGTN', kv: 14.4 });
  assert.deepEqual(pnodeKind('LD.ELM     23'), { type: 'LD', word: 'load', substation: 'ELM', kv: 23 });
  assert.equal(pnodeKind('DR.CT_Norwalk-Stamford').kv, null);
  assert.equal(pnodeKind('.H.INTERNAL_HUB'), null);
  assert.equal(pnodeKind(null), null);
});

test('C19 sameSubstationName: abbreviation of the bus substation (prefix or ordered letters, same first letter)', () => {
  assert.equal(sameSubstationName('POWERSVL', 'Powersville'), true);
  assert.equal(sameSubstationName('TEWKSBRY', 'Tewksbury'), true);
  assert.equal(sameSubstationName('ASHLAND', 'Ashland Tap'), true);
  assert.equal(sameSubstationName('ALEWIFE', 'North Cambridge'), false);
  assert.equal(sameSubstationName('CHEMICAL', 'BHE 388 MPC'), false);
  assert.equal(sameSubstationName('MEDWAY', 'NG C129N NST'), false);
  assert.equal(sameSubstationName(null, 'X'), false);
});

test('C19 resolvePriceTier: a geo-proxy ≤ 0.1 km whose substation matches is the same substation; otherwise borrowed', () => {
  assert.equal(resolvePriceTier({ tier: 'geo_proxy', km: 0.004, pnodeName: 'UN.POWERSVL115 GNRT', busSubstation: 'Powersville' }), 'same_substation');
  assert.equal(resolvePriceTier({ tier: 'geo_proxy', km: 0.1, pnodeName: 'UN.POWERSVL115 GNRT', busSubstation: 'Powersville' }), 'same_substation');
  assert.equal(resolvePriceTier({ tier: 'geo_proxy', km: 0.11, pnodeName: 'UN.POWERSVL115 GNRT', busSubstation: 'Powersville' }), 'geo_proxy');
  assert.equal(resolvePriceTier({ tier: 'geo_proxy', km: 0.006, pnodeName: 'LD.ALEWIFE 13.8', busSubstation: 'North Cambridge' }), 'geo_proxy');
  assert.equal(resolvePriceTier({ tier: 'geo_proxy', km: 0.004 }), 'geo_proxy'); // no names: never promoted
  assert.equal(isBorrowedPrice({ tier: 'geo_proxy', km: 0.006, pnodeName: 'LD.ALEWIFE 13.8', busSubstation: 'North Cambridge' }), true);
  assert.equal(isBorrowedPrice({ tier: 'geo_proxy', km: 0.004, pnodeName: 'UN.POWERSVL115 GNRT', busSubstation: 'Powersville' }), false);
  assert.equal(isBorrowedPrice({ tier: 'relinked', km: 30 }), true);
  assert.equal(isBorrowedPrice({ tier: 'direct' }), false);
});

test('C19 priceTierLabel: no "co-located" for a geo-proxy (old wording encoded the defect); near distances keep 3 decimals', () => {
  assert.equal(priceTierLabel({ tier: 'geo_proxy', km: 0.01 }), 'borrowed from a node 0.010 km away');
  assert.equal(priceTierLabel({ tier: 'geo_proxy', km: 3.25 }), 'borrowed from a node 3.3 km away');
  assert.ok(!/co-located/.test(priceTierLabel({ tier: 'geo_proxy', km: 0 })));
  // unchanged words for the other tiers
  assert.equal(priceTierLabel({ tier: 'direct' }), 'own price node');
  assert.equal(priceTierLabel({ tier: 'relinked', km: 35.458, relinkedFrom: 'FAR_NODE' }), 'relinked · 22.0 mi from FAR_NODE');
  assert.equal(priceTierLabel({ tier: 'hub' }), 'hub');
});

test('C19 priceTierLabel states the node type and kV when it differs from the POI, and the shared-series count', () => {
  // 103005: 345 kV bus priced at a 115 kV unit node 5.6 km away shared by 24 buses
  assert.equal(priceTierLabel({ tier: 'geo_proxy', km: 5.595, pnodeName: 'UN.CHEMICAL115 PERC', busSubstation: 'BHE 388 MPC', busKv: 345, sharedBy: 24 }),
    'borrowed from a node 5.6 km away · unit node at 115 kV, bus at 345 kV · shared by 24 buses');
  // 104059: Maine bus priced at an NH 34.5 kV load node → cross-zone disclosed
  assert.equal(priceTierLabel({ tier: 'geo_proxy', km: 3.731, pnodeName: 'LD.TASKERFM34.5', busSubstation: 'ES 385 CMP', busKv: 345, sharedBy: 1, nodeZone: '.Z.NEWHAMPSHIRE', busState: 'ME' }),
    'borrowed from a node 3.7 km away · load node at 34.5 kV, bus at 345 kV · node in the NH load zone, bus in ME');
  // 103029: 0.004 km, same substation name → same substation, shared by 9
  assert.equal(priceTierLabel({ tier: 'geo_proxy', km: 0.004, pnodeName: 'UN.POWERSVL115 GNRT', busSubstation: 'Powersville', busKv: 115, sharedBy: 9 }),
    'node at the same substation · shared by 9 buses');
  // 113951: same substation but a 13.8 kV load node for a 345 kV bus → type stated
  assert.equal(priceTierLabel({ tier: 'same_substation', km: 0, pnodeName: 'LD.TEWKSBRY13.8', busSubstation: 'Tewksbury', busKv: 345, sharedBy: 1 }),
    'node at the same substation · load node at 13.8 kV, bus at 345 kV');
  // a direct node at the bus voltage says nothing more
  assert.equal(priceTierLabel({ tier: 'direct', pnodeName: 'UN.POWERSVL115 GNRT', busKv: 115, sharedBy: 1 }), 'own price node');
  // a Massachusetts bus at a Massachusetts zone node is not cross-zone
  assert.ok(!/load zone/.test(priceTierLabel({ tier: 'geo_proxy', km: 2, nodeZone: '.Z.SEMASS', busState: 'MA' })));
});

test('C19 priceLinkFields reads every surface shape (api_prices link, bus payload priceMapping, market node) the same way', () => {
  const node = { id: '103005', substation_name: 'BHE 388 MPC', nominal_kv: 345, state_code: 'ME',
    priceMapping: { pnode_name: 'UN.CHEMICAL115 PERC', tier: 'geo_proxy', distance_km: 5.595, buses_sharing_series: 24 } };
  const link = { pnode_name: 'UN.CHEMICAL115 PERC', price_tier: 'geo_proxy', price_proxy_km: 5.595, buses_sharing_series: 24, zone_name: '.Z.MAINE' };
  const a = priceTierText(node, link), b = priceTierText(node, null);
  assert.equal(a, 'borrowed from a node 5.6 km away · unit node at 115 kV, bus at 345 kV · shared by 24 buses');
  assert.equal(b, a);
  const mk = { bus_id: 103005, substation: 'BHE 388 MPC', kv: 345, state: 'ME', tier: 'geo_proxy', proxyKm: 5.595, sharing: 24, pnode: 'UN.CHEMICAL115 PERC' };
  assert.equal(priceTierText(mk), a);
  assert.equal(priceLinkFields(node, link).sharedBy, 24);
});

test('C19 provenance chip follows the resolved tier: relinked and borrowed get geo-proxy; a same-substation 0.004 km link does not', () => {
  assert.equal(provenanceChips({ tier: 'relinked', km: 30 }), 'geo-proxy');
  assert.equal(provenanceChips({ tier: 'geo_proxy', km: 0.006, pnodeName: 'LD.ALEWIFE 13.8', busSubstation: 'North Cambridge' }), 'geo-proxy');
  assert.equal(provenanceChips({ tier: 'geo_proxy', km: 0.004, pnodeName: 'UN.POWERSVL115 GNRT', busSubstation: 'Powersville' }), '');
});

// ---------- C52: one percentile method ----------
test('C52 weightedQuantile on equal intervals is the linear-interpolation quantile (the mart quantile_cont)', () => {
  const prices = [-27.9, -27.83, -27.811, -27.8, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const rows = prices.map((p, i) => ({ timestamp: `2025-01-01T${String(i).padStart(2, '0')}:00:00-05:00`, price: p, dtHours: 1 }));
  for (const q of [0.01, 0.05, 0.25, 0.5, 0.95, 0.99]) assert.equal(weightedQuantile(rows, q), quantile(prices, q));
  // mixed intervals keep the stated duration-weighted nearest rank
  const mixed = [{ price: 1, dtHours: 1 }, { price: 2, dtHours: 3 }];
  assert.equal(weightedQuantile(mixed, 0.5), 2);
});

test('C52 analyzePrices p5 equals weightedQuantile on the same rows (KPI and Tails table agree)', () => {
  const recs = Array.from({ length: 48 }, (_, i) => [`2025-01-${String(1 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00-05:00`, Math.sin(i) * 40, null, null, null, null, 1]);
  const data = { series: [{ nodeId: '1', mode: 'historical', market: 'RT', year: 2025, complete: true, expectedHours: 48, records: recs }] };
  const a = analyzePrices(data, { nodeId: '1', mode: 'historical', market: 'RT', years: [2025], weighting: 'duration', strict: true });
  assert.equal(a.summary.p05, weightedQuantile(a.rows, 0.05));
  assert.equal(a.summary.p95, weightedQuantile(a.rows, 0.95));
});

// ---------- C58: FER/DASI footnote ----------
test('C58 daFerNote: day-ahead figures are LMP only; the FER/DASI price comes from the rules file with its source', () => {
  // The figures come from the generated rules file (no hand-typed numbers); without it the note still states the exclusion.
  const n = daFerNote(RULES.energy_settlement.da_premium_2025);
  assert.match(n, /excludes the FER\/DASI price/);
  assert.match(n, /\$3\.95/);           // rules energy_settlement.da_premium_2025.fer
  assert.match(n, /\$71\.81/);          // FER-inclusive hub DA, same entry
  assert.match(n, /AMR 2025 §4\.1/);    // its src
  assert.match(n, /REGISTER row 71/);
  const bare = daFerNote(null);
  assert.match(bare, /excludes the FER\/DASI price/);
  assert.match(bare, /REGISTER row 71/);
  assert.ok(!/\$\d/.test(bare), 'no figure without the rules file');
});

// ---------- C59: vendor figures ----------
test('C59 sheetRows: a vendor 0.00 on a price quantity is not held (placeholder), counts keep a true zero; 2030 note says not used', () => {
  const sum = { year: [{ market: 'RT', y: 2025, avg_lmp: 50, avg_cong: 0.0976, neg_hours: 0, hours_gt_200: 3, std_lmp: 20 }], fcstYear: [{ scenario: 'pcr2030', avg_lmp: 45 }] };
  const st = { bus: { sheet: { lmp_2025: 50.1, lmp_2030: 0.0, cong_2025: 0.0, hneg_2025: 0, h200_2025: 3 }, sheet2030vs5yr: 1.0123 } };
  const rows = sheetRows(sum, st, null), by = q => rows.find(r => r.q.startsWith(q));
  assert.equal(by('Congestion 2025').s, null);
  assert.equal(by('Congestion 2025').d, null);
  assert.match(by('Congestion 2025').note, /vendor 0\.00 = not held/);
  assert.equal(by('Mean price 2030').s, null);
  assert.equal(by('Hours < $0').s, 0);
  assert.equal(by('Hours < $0').d, 0);
  const st2 = { bus: { sheet: { lmp_2030: 70.68 }, sheet2030vs5yr: 1.0123 } };
  const r30 = sheetRows(sum, st2, null).find(r => r.q === 'Mean price 2030');
  assert.equal(r30.s, 70.68);
  assert.match(r30.note, /5-yr \(2028\) run relabelled × 1\.0123; not used/);
});

// ---------- C58 + C59 + C19 on the rendered LMP tab ----------
async function renderLmp() {
  const sum = {
    link: { pnode_name: 'LD.TASKERFM34.5', price_tier: 'geo_proxy', price_proxy_km: 3.731, buses_sharing_series: 1, zone_name: '.Z.NEWHAMPSHIRE' },
    year: [{ market: 'RT', y: 2025, n_hours: 8760, avg_lmp: 50, p5: 1, p95: 99, neg_hours: 10, hours_gt_200: 2 }, { market: 'DA', y: 2025, n_hours: 8760, avg_lmp: 51 }],
    daRt: [{ y: 2025, n_hours: 8760, avg_da: 51, avg_rt: 50, avg_rt_less_da: -1, avg_abs_spread: 5, std_spread: 8, p5_spread: -10, p95_spread: 10, share_rt_above_da: 0.4 }],
    fcstYear: [{ scenario: 'pcr2030', target_year: 2030, n_hours: 8760, avg_lmp: 45, p5: 1, p50: 40, p95: 90 }], month: [], fcstMonth: [],
  };
  const studio = { bus: { sheet: { lmp_2030: 70.68, cong_2025: 0 }, sheet2030vs5yr: 1.0123 }, meta: {} };
  const routes = { 'prices/summary/104059': sum, 'prices/studio/104059': studio };
  globalThis.fetch = async url => { const k = Object.keys(routes).find(r => String(url).includes(r)); return k ? { ok: true, status: 200, json: async () => routes[k] } : { ok: false, status: 404, json: async () => null }; };
  const { renderPrices } = await import('../views/prices.js');
  const recs = Array.from({ length: 24 }, (_, h) => [`2025-01-01T${String(h).padStart(2, '0')}:00:00-05:00`, 40 + h, null, null, null, null, 1]);
  const data = { series: [{ nodeId: '104059', mode: 'historical', market: 'RT', year: 2025, complete: true, expectedHours: 24, records: recs }], metadata: {} };
  const basis = { nodeId: '104059', mode: 'historical', market: 'RT', run: null, years: [2025], weighting: 'duration', weights: {}, strict: true, includePartial: false };
  const node = { id: '104059', substation_name: 'ES 385 CMP', nominal_kv: 345, state_code: 'ME', priceMapping: { pnode_name: 'LD.TASKERFM34.5', tier: 'geo_proxy', distance_km: 3.731, buses_sharing_series: 1 } };
  const ctx = { data, node, S: { nodeId: '104059', basis, draft: basis, ui: {}, depth: 'study', tech: 'solar' } };
  renderPrices('lmp', ctx);
  await new Promise(r => setTimeout(r, 20));
  return renderPrices('lmp', ctx);
}

test('C58/C59/C19 rendered LMP tab: no vendor 2030 KPI, PCR run legend, FER footnote on the DA cards, one tier label', async () => {
  const html = await renderLmp();
  assert.ok(!/Studio sheet 2030 \(vendor\)/.test(html), 'vendor 2030 is no headline KPI');
  assert.match(html, /PCR 2030 = the 2030 solved run/);
  const dartCard = html.split('<section').find(s => /<h3>Real-time against day-ahead<\/h3>/.test(s));
  assert.ok(dartCard && /excludes the FER\/DASI price/.test(dartCard), 'RT-DA card carries the FER footnote');
  const yearTable = html.split('<section').find(s => /<h3>Every settled year and solved run at this bus<\/h3>/.test(s));
  assert.ok(yearTable && /excludes the FER\/DASI price/.test(yearTable), 'year table (Settled DA rows) carries the FER footnote');
  assert.match(html, /borrowed from a node 3\.7 km away · load node at 34\.5 kV, bus at 345 kV · node in the NH load zone, bus in ME/);
  assert.ok(!/co-located/.test(html));
});
