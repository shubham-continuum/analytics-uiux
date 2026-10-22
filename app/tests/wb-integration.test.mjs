// W-B integration slice: the lead-wiring items S2-EM, S4, S5, S6, S2-GD, S3, S2-D and M3 asked for in Economics,
// Market, Prices and Land files. One test per item; written before the code (TDD).
// Provenance: Claude Fable 5.1 (W-B agent) · one-studio/design (T3, P2 integration W-B) · 2026-10-07 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { windowFromRules, peakWindowLabel } from '../economics-charge.js';
import { storageHandoffExtras } from '../economics-stack.js';
import { serviceLimits, UNKNOWN_WORD, MEASURES, prepare, evaluate, shoulderRequired, SHOULDER_EXCLUDED_REASON } from '../marketcore.js';
import { req as marketReq } from '../views/market.js';
import { priceTierLabel } from '../prices.js';
import { siteControl } from '../landcore.js';
import { ENVELOPE_ONLY } from '../gridrules.js';

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const src = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// ---------------- S2-EM close-out, W1: the rules file's charge-screen window reaches the dispatch ----------------
test('W1: the summer-peak window is read from the rules file under its own key names (he_start/he_end), not silently dropped', () => {
  const R = JSON.parse(src('rules/isone-2026.json'));
  const w = windowFromRules(R.interconnection.storage_charge_screen.peak_window);
  assert.ok(w, 'the rules window must be recognised');
  assert.deepEqual(w.months, [6, 7, 8, 9]); assert.equal(w.heFrom, 14); assert.equal(w.heTo, 18);
  assert.equal(peakWindowLabel(w), 'Jun–Sep, HE14–HE18');
  // the older spelling is still accepted; an incomplete entry is null (the card then says the window is not in the rules file)
  assert.deepEqual(windowFromRules({ months: [7], he_from: 13, he_to: 17 }), { months: [7], heFrom: 13, heTo: 17 });
  assert.equal(windowFromRules({ months: [7] }), null); assert.equal(windowFromRules(null), null);
});

// ---------------- S5 #3: the storage handoff carries discharged MWh and the charging cost ----------------
test('S5 #3: storageHandoffExtras gives MWh discharged per year and the charging bill per year; nothing held → null, never 0', () => {
  const rows = [{ importMW: 10, dischargeMW: 0, price: 20, dtHours: 1 }, { importMW: 0, dischargeMW: 9, price: 100, dtHours: 1 }, { importMW: 5, dischargeMW: 0, price: -4, dtHours: 0.5 }];
  const x = storageHandoffExtras(rows, { energyDischargedMWh: 9 }, 2);
  near(x.dischargedMwh, 4.5); near(x.chargeCost, (10 * 20 * 1 + 5 * -4 * 0.5) / 2);
  const none = storageHandoffExtras([], {}, 1);
  assert.equal(none.dischargedMwh, null); assert.equal(none.chargeCost, null);
});

// ---------------- S2-GD #4: envelope-only limits are Unknown in Market ----------------
test('S2-GD #4: serviceLimits reports an envelope-only case as status "envelope" with no value, and the word is defined', () => {
  const grid = JSON.parse(src('data/snapshot.json')).grid;
  const study = prepare({ nodes: [{ bus_id: 111209, name: 'Hatchville 115', tier: 'direct' }], grid });
  const lims = serviceLimits(study, study.nodes[0], 'solar');
  const sh = lims.find(l => l.caseKey === 'shoulder|discharge'), sp = lims.find(l => l.caseKey === 'summer_peak|discharge');
  assert.equal(sh.status, 'envelope'); assert.equal(sh.value, null, 'the envelope number is context, never a limit');
  assert.equal(sp.status, 'held'); near(sp.value, 197.8);
  assert.equal(UNKNOWN_WORD.envelope, 'envelope only (vendor-asserted, unverified)');
  assert.equal(ENVELOPE_ONLY, 'Envelope only');
});

// ---------------- Lead option (b): the Market default does not require the envelope-only shoulder case ----------------
test('option (b): by default the shoulder export case is not required, the default screen keeps a solar population, and requiring it restores D6.1 (all Unknown)', () => {
  const grid = JSON.parse(src('data/snapshot.json')).grid, ids = [...new Set(grid.headroom.map(r => r.bus_id))];
  const study = prepare({ nodes: ids.map(b => ({ bus_id: b, tier: 'direct' })), grid });
  const S = (mkt = {}) => ({ tech: 'solar', exportMW: 100, importMW: 0, ui: { mkt } });
  assert.equal(shoulderRequired({}), false); assert.equal(shoulderRequired({ shoulder: true }), true); assert.equal(shoulderRequired({ shoulder: false }), false);
  assert.equal(marketReq(S()).useShoulder, false, 'views/market.js req() carries the default');
  const off = evaluate(study, marketReq(S()));
  assert.ok(off.filter(e => e.status === 'met').length > 0, 'the default screen qualifies element-study buses');
  const on = evaluate(study, marketReq(S({ shoulder: true })));
  assert.equal(on.filter(e => e.status === 'met').length, 0, 'with the envelope-only case required nothing meets (D6.1)');
  assert.ok(on.filter(e => e.status === 'unknown').every(e => e.unknown.some(u => /envelope only \(vendor-asserted, unverified\)/.test(u))));
  assert.match(SHOULDER_EXCLUDED_REASON, /^shoulder case: vendor envelope only, not studied — excluded from screening; Decision holds the gate$/);
  assert.match(src('views/market.js'), /SHOULDER_EXCLUDED_REASON/, 'the card prints the reason');
});

// ---------------- S2-D #1: the relinked tier has a label, and it counts as a borrowed price ----------------
test('S2-D #1: priceTierLabel is the one home for the tier words, including "relinked · N mi from <node>"', () => {
  assert.equal(priceTierLabel({ tier: 'direct' }), 'own price node');
  assert.equal(priceTierLabel({ tier: 'same_substation' }), 'node at the same substation');
  // P2 C19: 'co-located node (0.0 km)' encoded the defect (a borrowed series called own-node); a geo-proxy is borrowed unless
  // its node carries the bus's substation within 0.1 km.
  assert.equal(priceTierLabel({ tier: 'geo_proxy', km: 0.01 }), 'borrowed from a node 0.010 km away');
  assert.equal(priceTierLabel({ tier: 'geo_proxy', km: 3.25 }), 'borrowed from a node 3.3 km away');
  assert.equal(priceTierLabel({ tier: 'relinked', km: 35.458, relinkedFrom: 'FAR_NODE' }), 'relinked · 22.0 mi from FAR_NODE');
  assert.equal(priceTierLabel({ tier: 'relinked', relinkMi: 4.5, relinkedFrom: 'X' }), 'relinked · 4.5 mi from X');
  assert.equal(priceTierLabel({ tier: 'relinked', km: 1.609344 }), 'relinked · 1.0 mi from a far rank-1 node (D-008)');
  assert.equal(priceTierLabel({ tier: 'hub' }), 'hub'); assert.equal(priceTierLabel({}), '—');
});
test('S2-D #1: Market scores a relinked node like a borrowed one (own-node attribution 0), never null', () => {
  assert.equal(MEASURES.ownPrice.get({ node: { tier: 'relinked', proxyKm: 30 } }), 0);
  assert.equal(MEASURES.ownPrice.get({ node: { tier: 'direct' } }), 2);
});

// ---------------- S3 #3: Land site control delegates to the ISO-NE rules engine ----------------
test('S3 #3: landcore.siteControl uses rules/isone.js: ISO-NE needs 100% at request; the pro forma 90% only under its labelled profile', () => {
  const dc = siteControl('datacenter', 50);
  assert.equal(dc.applicable, false); assert.match(dc.status, /not applicable/);
  const iso = siteControl('solar', 95);
  assert.equal(iso.applicable, true); assert.equal(iso.verdict, 'Fail'); assert.equal(iso.required, 100); assert.match(iso.status, /95% < 100%/);
  const pf = siteControl('solar', 95, { profile: 'proforma' });
  assert.equal(pf.verdict, 'Pass'); assert.equal(pf.required, 90); assert.match(pf.status, /meets 90%/);
  const open = siteControl('solar', null);
  assert.equal(open.status, 'unknown'); assert.equal(open.verdict, 'Open');
  assert.ok(iso.cite?.src, 'the gate carries its citation');
});

// ---------------- M3: Market exports its requirement and weight builders ----------------
test('M3: views/market.js exports req(S) and weights(S) so the bridge stops replicating them', () => {
  const s = src('views/market.js');
  assert.match(s, /^export function req\(S\)/m); assert.match(s, /^export function weights\(S\)/m);
});

// ---------------- S4 #1 / S5 #1 / S6 #2: the cards are wired into the Economics views ----------------
test('S4/S5/S6 wiring: Economics imports and calls revenueCards, financeCards and dcCards', () => {
  const e = src('views/economics.js'), f = src('views/economics-fueltabs.js');
  assert.match(e, /import \{ revenueCards[^}]*\} from '\.\/cards-revenue\.js'/); assert.match(e, /revenueCards\(R\.data, s4Inputs\(ctx, inp\), ctx\.S\.ui\)/, 'one builder feeds the S4 cards and the KPI streams');
  assert.ok((e.match(/s4Cards\(ctx, /g) || []).length >= 2, 'the S4 cards are on the Revenue tab and the BESS tab');
  assert.match(e, /import \{ financeCards \} from '\.\/cards-finance\.js'/); assert.ok((e.match(/financeCards\(/g) || []).length >= 1);
  assert.ok((e.match(/\$\{s5Cards\}/g) || []).length >= 2, 'the S5 cards are on both the incomplete and the computed finance branches');
  assert.match(f, /dcFlow\(/); assert.match(f, /dc\.stages\.economics/); assert.match(f, /loadEnergyCost\(x\.records, mw\)/, 'the one hourly bill is what dcFlow receives');
  // no hand-typed market price remains in the storage stack (S4 #2): Clean Peak comes from the S4 stream
  assert.ok(!/5\.38/.test(f), 'Clean Peak $/kW-mo must come from the rules file');
});
