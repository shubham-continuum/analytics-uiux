// W-C integration (Grid side): the thermal screen and the PP5-6 proportional allocation read from rules/isone.js
// (S3 #5), and the data-centre stage cards + generator-only guard (S6 #2, #7) in views/grid-dc.js.
// Provenance: Claude Fable 5.1 (W-C integration agent) · one-studio/design (T3, P2 wave W-C) · 2026-10-07 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadingAt, loadingScreen, proportionalImpact, clusterAllocation, stepCostService } from '../gridrules.js';
import { dcStageCards, withDcCards, dropGeneratorOnly, llYear, DC_TABS } from '../views/grid-dc.js';
import { dcFlow } from '../rules/largeload.js';
import { dcCards, GENERATOR_ONLY } from '../views/cards-dc.js';
import { traceProp } from '../views/grid-trace-v5.js';
import { resetTraces } from '../trace.js';
import * as RX from '../rules/isone.js';

const snap = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url)));
const RULES = JSON.parse(readFileSync(new URL('../rules/isone-2026.json', import.meta.url)));
const grid = snap.grid;
const row = o => ({ bus_id: 9, scenario: 'summer_peak', direction: 'discharge', monitored_facility: 'F', dfax: 0.5, contingency_id: 3, contingency_flow_mw: 80, base_flow_mw: 60, rating_a_mva: 90, rating_c_mva: 100, transfer_mw: 40, fix_cost_musd: 2, length_miles: 4, ...o });
const ok = v => typeof v === 'number' && Number.isFinite(v);

// ---------- S3 #5: thermal screen ----------
test('S3 #5: loadingAt is the engine\'s thermalScreen loading (×100); loadingScreen exposes the pf bound as a labelled sensitivity', () => {
  const r = row();
  const t = RX.thermalScreen({ p: 80, dfax: 0.5, mw: 40, rating: 100, contingency: 'post' });
  assert.ok(Math.abs(loadingAt(r, 40) - 100 * t.loading) < 1e-9);
  assert.ok(Math.abs(loadingAt(r, 40) - 100) < 1e-9, 'transfer 40 MW brings the facility to its rating');
  const s = loadingScreen(r, 40);
  assert.equal(s.status, 'ok');
  assert.equal(s.bound, true, 'Q is not in the store, so the apparent-power loading is a bound');
  assert.equal(s.pf, RULES.interconnection.thermal_screen.pf_min_sensitivity.value);
  assert.ok(s.loadingPfBound > s.loading, 'the pf bound is the higher loading');
  assert.equal(s.ratingBasis, RULES.interconnection.schedule22.ratings.post_contingency);
  assert.equal(loadingScreen(row({ contingency_id: 0, contingency_flow_mw: null }), 0).ratingBasis, RULES.interconnection.schedule22.ratings.pre_contingency);
  assert.ok(s.cite.some(c => c.path === 'interconnection.thermal_screen.pf_min_sensitivity' && c.status === 'assumption'));
  // not held stays not held (never 0)
  assert.equal(loadingAt(row({ dfax: null }), 40), null);
  assert.equal(loadingScreen(row({ rating_c_mva: null }), 40).loading, null);
});

// ---------- S3 #5: PP5-6 proportional allocation ----------
test('S3 #5: proportionalImpact carries the PP5-6 §10.4.4 cluster allocation (RX.allocateProportional): >3% DFAX threshold, sum over elements', () => {
  const facilities = [
    { id: 'f1', label: 'F1', cost: 10, dfax: { P: 0.2, A: 0.1, B: 0.3 } },
    { id: 'f2', label: 'F2', cost: 4, dfax: { P: 0.5, A: 0.02, B: 0.5 } },
  ];
  const members = [{ bus: 'P', mw: 100, self: true }, { bus: 'A', mw: 200 }, { bus: 'B', mw: 100 }];
  const r = proportionalImpact(facilities, members);
  // the per-facility Order 2023 view is unchanged
  assert.ok(Math.abs(r.facilities[0].share - 20 / 70) < 1e-12);
  // PP5-6: project impact = Σ_elements MW × DFAX (over 3%): P 20 + 50 = 70; A 20 + 0 (2% ≤ 3%) = 20; B 30 + 50 = 80 → P 70/170
  const pp = r.pp56;
  assert.equal(pp.status, 'ok');
  assert.equal(pp.threshold, RULES.interconnection.schedule22.cost_allocation.dfax_threshold);
  assert.ok(Math.abs(pp.share - 70 / 170) < 1e-12);
  assert.ok(Math.abs(pp.cost - 14 * 70 / 170) < 1e-12, 'share of the priced cluster cost (standalone total $14M)');
  assert.equal(pp.cite.path, 'interconnection.schedule22.cost_allocation');
  assert.equal(pp.cite.status, 'corrected');
  const direct = RX.allocateProportional(members.map(m => ({ id: m.bus, mw: m.mw, impacts: facilities.map(f => ({ element: f.id, dfaxNR: f.dfax[m.bus] })) })), 14);
  assert.ok(Math.abs(direct.rows.find(x => x.id === 'P').share - pp.share) < 1e-12, 'the same engine call, the same number');
  assert.deepEqual(clusterAllocation(facilities, members).share, pp.share);
});

test('S3 #5: PP5-6 allocation: a project-only cluster pays 100%; below the threshold nothing is allocated (never $0 as a pass); unpriced → cost not held', () => {
  const solo = proportionalImpact([{ id: 'f', label: 'F', cost: 3, dfax: { P: 0.1 } }], [{ bus: 'P', mw: 100, self: true }]);
  assert.equal(solo.pp56.share, 1); assert.equal(solo.pp56.cost, 3);
  const low = proportionalImpact([{ id: 'f', label: 'F', cost: 3, dfax: { P: 0.03 } }], [{ bus: 'P', mw: 100, self: true }]);
  assert.equal(low.pp56.status, 'not_applicable'); assert.match(low.pp56.reason, /above 3%/);
  const unpriced = proportionalImpact([{ id: 'f', label: 'F', cost: null, dfax: { P: 0.2 } }], [{ bus: 'P', mw: 100, self: true }]);
  assert.equal(unpriced.pp56.share, 1); assert.equal(unpriced.pp56.cost, null);
  const none = proportionalImpact([], [{ bus: 'P', mw: 100, self: true }]);
  assert.equal(none.pp56.status, 'not_applicable');
  // the trace reconciles with the PP5-6 figure in it
  resetTraces();
  const html = traceProp('P', proportionalImpact([{ id: 'f1', label: 'F1', cost: 10, dfax: { P: 0.2, A: 0.1 } }], [{ bus: 'P', mw: 100, self: true }, { bus: 'A', mw: 200 }]), [{ bus: 'P', mw: 100, self: true }, { bus: 'A', mw: 200 }], 'test');
  assert.ok(!/Does not reconcile/.test(html));
  assert.match(html, /PP5-6/);
});

// ---------- S6 #2 / #7: DC stage cards and the generator-only guard ----------
const dcS = { nodeId: '111403', tech: 'datacenter', exportMW: 0, importMW: 150, ui: {}, handoffs: {} };
const dcNode = snap.nodes.find(n => String(n.id) === '111403');
test('S6 #2: dcStageCards puts the S6 cards on the right stage/tab for a data centre, none for a generator; the energy line is Decision\'s load cost', () => {
  const flow = dcFlow(RULES, grid, { bus: '111403', mw: 150, kv: dcNode.nominal_kv, service: 'FCDS', year: llYear(RULES) });
  const ref = dcCards({ flow, node: { name: dcNode.name, busId: '111403' } });
  const g = dcStageCards('grid', 'capacity', { data: snap, S: dcS, node: dcNode, rules: RULES });
  assert.ok(g.includes(ref.cards.eligibility) && g.includes(ref.cards.withdrawal), 'Grid › capacity: eligibility + withdrawal');
  assert.ok(dcStageCards('grid', 'cost', { data: snap, S: dcS, node: dcNode, rules: RULES }).includes(ref.cards.upgrade), 'Grid › cost: upgrade');
  assert.ok(dcStageCards('queue', 'cluster', { data: snap, S: dcS, node: dcNode, rules: RULES }).includes(ref.cards.services));
  assert.ok(dcStageCards('queue', 'schedule', { data: snap, S: dcS, node: dcNode, rules: RULES }).includes(ref.cards.timeline));
  const d = dcStageCards('decision', 'compare', { data: snap, S: dcS, node: dcNode, rules: RULES, loadCost: { value: 1.2e7, mean: 91.3, importMW: 150 } });
  assert.ok(d.includes(ref.cards.eligibility) && d.includes(ref.cards.rules));
  assert.equal(dcStageCards('grid', 'mitigation', { data: snap, S: dcS, node: dcNode, rules: RULES }), '', 'a tab with no DC card gets nothing');
  assert.equal(dcStageCards('grid', 'capacity', { data: snap, S: { ...dcS, tech: 'solar' }, node: dcNode, rules: RULES }), '', 'a generator gets no DC card');
  assert.equal(dcStageCards('grid', 'capacity', { data: snap, S: dcS, node: dcNode, rules: null }), '', 'rules not loaded: nothing, never a half card');
  for (const html of [g, d]) for (const rx of GENERATOR_ONLY) assert.ok(!rx.test(html.replace(/<[^>]+>/g, ' ')), `generator-only text ${rx} on a DC card`);
  assert.deepEqual(Object.keys(DC_TABS), ['grid', 'queue', 'decision']);
});

test('S6 #2: withDcCards inserts the DC cards before the tab\'s next-step link (or appends); S6 #7: dropGeneratorOnly removes generator-titled cards only', () => {
  const html = '<div class="cards"><section class="card c-6"><header class="card-h"><h3>Limit</h3></header></section></div><div class="next-step">Next</div>';
  const out = withDcCards(html, 'grid', 'capacity', { data: snap, S: dcS, node: dcNode, rules: RULES });
  assert.ok(out.indexOf('dc-cards') < out.indexOf('<div class="next-step">'), 'DC block before the next step');
  assert.ok(out.includes('<h3>Limit</h3>'));
  assert.equal(withDcCards(html, 'grid', 'capacity', { data: snap, S: { ...dcS, tech: 'solar' }, node: dcNode, rules: RULES }), html, 'generator: untouched');
  const noNext = withDcCards('<div class="cards"></div>', 'grid', 'capacity', { data: snap, S: dcS, node: dcNode, rules: RULES });
  assert.ok(noNext.endsWith('</div>') && noNext.includes('dc-cards'));
  const mixed = '<section class="card c-6" data-depth="review"><header class="card-h"><h3>Energy revenue by year</h3></header><div class="card-b">x</div></section>'
    + '<section class="card c-6"><header class="card-h"><h3>Curtailment</h3></header><div class="card-b">a data centre withdraws; it is not curtailed by an injection test</div></section>'
    + '<section class="card c-12 card-trace"><header class="card-h"><h3>Calculation traces</h3></header><div class="card-b">ITC in a trace</div></section>';
  const kept = dropGeneratorOnly(mixed);
  assert.ok(!kept.includes('Energy revenue by year'), 'a generator-titled card is dropped');
  assert.ok(kept.includes('<h3>Curtailment</h3>'), 'a card whose body explains n/a for a load is kept');
  assert.ok(kept.includes('Calculation traces'), 'the trace card is kept');
  assert.equal(dropGeneratorOnly(''), '');
});

test('S6 #2: llYear picks the RNS-rate year held for this year, else the latest held (never a typed year)', () => {
  const years = Object.keys(RULES.large_load.rns_rate).filter(k => /^\d{4}$/.test(k)).map(Number);
  const y = llYear(RULES);
  assert.ok(years.includes(y));
  const now = new Date().getFullYear();
  assert.equal(y, years.includes(now) ? now : Math.max(...years));
  assert.equal(llYear(null), null);
  // the step cost the DC upgrade card reads is Grid's own function (one home)
  const flow = dcFlow(RULES, grid, { bus: '111403', mw: 150, kv: 115, service: 'FCDS', year: y });
  assert.equal(flow.upgrade.total, stepCostService(grid, '111403', 'datacenter', 0, 150).total);
  assert.ok(ok(flow.transmission.usd), `FCDS at ${y} is priced`);
});
