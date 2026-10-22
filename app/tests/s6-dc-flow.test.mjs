// S6 end to end: the campus data-centre sample (data/samples.json) runs through rules/largeload.js and
// views/cards-dc.js on the unified DB's own grid and price rows: pending badges on every card, no generator-only card,
// and the acceptance arithmetic. The DB is read once, read-only, with bound parameters (busdata.rows).
// Provenance: Claude Opus 5.5 · one-studio/design (T3, P2 slice S6) · 2026-10-06 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dcFlow } from '../rules/largeload.js';
import { stepCostService } from '../gridrules.js';
import { dcCards, GENERATOR_ONLY } from '../views/cards-dc.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RULES = JSON.parse(readFileSync(path.join(APP, 'rules', 'isone-2026.json'), 'utf8'));
const SAMPLES = JSON.parse(readFileSync(path.join(APP, 'data', 'samples.json'), 'utf8'));
const BADGE = 'pending §205 filing (due 2026-11-16, FERC EL26-72)';
const P = SAMPLES.projects.find(p => p.id === 'campus');
const IDS = P.options.map(o => Number(o.busId));

// Read-only, parameterised fetch of exactly the rows the engine reads (same columns as plan/build_samples.py).
const PY = `
import json, sys
sys.path.insert(0, ${JSON.stringify(APP)})
import busdata
ids = json.loads(sys.argv[1])
c = busdata.connect()
q = 'IN (SELECT unnest(?::BIGINT[]))'
out = {
 'headroom': busdata.rows(c, 'SELECT bus_id, scenario, direction, headroom_mw, pre_existing_issues FROM fact_headroom WHERE bus_id ' + q, [ids]),
 'constraints': busdata.rows(c, 'SELECT bus_id, scenario, direction, monitored_facility, binding_contingency, contingency_id, dfax, transfer_mw, base_flow_mw, contingency_flow_mw, rating_a_mva, rating_c_mva, pct_loading_no_transfer, fix_cost_musd, length_miles, facility_type, kv FROM fact_limiting_element WHERE bus_id ' + q, [ids]),
 'buses': busdata.rows(c, 'SELECT bus_id, bus_name, nominal_kv FROM dim_bus WHERE bus_id ' + q, [ids]),
 'prices': busdata.rows(c, 'SELECT bus_id, avg_lmp, n_hours FROM mart_bus_year WHERE market = ? AND y = ? AND bus_id ' + q, ['RT', 2025, ids]),
}
print(json.dumps(out, default=str))
`;
const r = spawnSync('python', ['-c', PY, JSON.stringify(IDS)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const DB = r.status === 0 ? JSON.parse(r.stdout) : null;
const skip = DB ? false : `unified DB not readable: ${(r.stderr || '').slice(-300)}`;
const GRID = DB && { headroom: DB.headroom, constraints: DB.constraints };
const bus = id => DB.buses.find(b => b.bus_id === Number(id));
// Energy comes in the decisioncore loadCost shape (its one home): mean × MW × 8,760 h on the settled 2025 RT basis.
const energyOf = id => { const p = DB.prices.find(x => x.bus_id === Number(id)); return p ? { value: p.avg_lmp * P.importMW * 8760, mean: p.avg_lmp, importMW: P.importMW } : null; };
const flowOf = o => dcFlow(RULES, GRID, { bus: o.busId, mw: P.importMW, kv: bus(o.busId)?.nominal_kv, service: 'FCDS', year: 2026, energy: energyOf(o.busId), applicationDate: P.assumptions.qStart });

test('the campus sample is the data-centre project the flow runs on', () => {
  assert.equal(P.tech, 'datacenter'); assert.equal(P.importMW, 300); assert.equal(P.exportMW, 0); assert.equal(IDS.length, 3);
});

test('every option runs end to end: screen, withdrawal, upgrade cost, charges, stack, timeline', { skip }, () => {
  for (const o of P.options) {
    const f = flowOf(o);
    for (const k of ['screen', 'withdrawal', 'upgrade', 'transmission', 'cra', 'stack', 'timeline', 'citations']) assert.ok(f[k], `${o.busId} ${k}`);
    assert.equal(f.screen.pass, true, `${o.busId}: 300 MW at ≥ 115 kV is a large load (proposed)`);
    for (const k of ['screen', 'withdrawal', 'upgrade', 'transmission', 'stack', 'timeline']) assert.equal(f[k].pending.text, BADGE, `${o.busId} ${k} badge`);
  }
});

test('withdrawal acceptance = the sample notes: BHE 388 MPC 459.8 fits, Baldwin 313 fits, Mystic 30.2 does not fit', { skip }, () => {
  const [a, b, m] = P.options.map(flowOf);
  assert.equal(a.withdrawal.firm.value, 459.8); assert.equal(a.withdrawal.firm.fits, true); assert.equal(a.withdrawal.status, 'Fits firm');
  assert.equal(b.withdrawal.firm.value, 313); assert.equal(b.withdrawal.firm.fits, true);
  assert.equal(m.withdrawal.firm.value, 30.2); assert.equal(m.withdrawal.firm.fits, false);
  assert.equal(m.withdrawal.nonFirm.value, 99.9); assert.equal(m.withdrawal.status, 'Exceeds both');
  assert.equal(a.withdrawal.nonFirm.value, 465);
});

test('CRA upgrade cost is the Grid engine number (one home): Mystic Priced $842.2M over 4 facilities', { skip }, () => {
  const m = flowOf(P.options[2]);
  const g = stepCostService(GRID, P.options[2].busId, 'datacenter', 0, 300);
  assert.equal(m.upgrade.total, g.total); assert.equal(m.upgrade.status, 'Priced'); assert.ok(Math.abs(m.upgrade.total - 842.2) < 0.05); assert.equal(m.upgrade.items.length, 4);
  assert.equal(m.cra.usd, null, 'carrying charge not published → CRA not held');
  assert.equal(flowOf(P.options[0]).upgrade.status, 'True zero');
});

test('stack acceptance: energy $158.9M at BHE 388 MPC; FCDS 300 MW × $177.62722 = $53.29M; total a lower bound', { skip }, () => {
  const a = flowOf(P.options[0]);
  const e = a.stack.lines.find(l => l.key === 'energy'), t = a.stack.lines.find(l => l.key === 'transmission');
  assert.ok(Math.abs(e.usd / 1e6 - 158.9) < 0.05);
  assert.ok(Math.abs(t.usd - 300000 * 177.62722) < 1);
  assert.equal(a.stack.bound, 'lower');
  assert.ok(a.stack.lines.filter(l => l.usd == null).length >= 4);
});

test('cards: DC flow only (never a generator-only card), every card badged pending, every not-held line says why', { skip }, () => {
  for (const o of P.options) {
    const f = flowOf(o), out = dcCards({ rules: RULES, flow: f, node: { name: bus(o.busId).bus_name, busId: o.busId } });
    assert.ok(out.list.length >= 6, `${o.busId}: ${out.list.length} cards`);
    for (const html of out.list) {
      assert.ok(html.includes(BADGE), `card without the pending badge: ${html.slice(0, 120)}`);
      assert.match(html, /data-chips="[^"]*pending/);
      for (const rx of GENERATOR_ONLY) assert.doesNotMatch(html, rx, `${o.busId}: generator-only content ${rx}`);
    }
    for (const stage of ['grid', 'queue', 'economics', 'decision']) assert.ok(out.stages[stage].length, `${stage} has DC cards`);
    assert.ok(out.list.some(h => h.includes('Large-load timeline not held: generator queue clocks do not apply to loads')));
    assert.ok(out.list.join('').includes('not held'));
  }
});

test('GENERATOR_ONLY catches a generator card (the guard is live)', () => {
  const gen = '<section class="card"><h3>Export limit</h3> energy revenue, capture price, PTC</section>';
  assert.ok(GENERATOR_ONLY.some(rx => rx.test(gen)));
});
