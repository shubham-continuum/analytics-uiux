// Grid all-bus gate (Node, no browser): for every geolocated bus and every service, the rules run,
// every Grid trace renders, and no trace reports "Does not reconcile". Data: a read-only dump of
// fact_headroom + fact_limiting_element (path in argv[2]).
import { readFileSync } from 'node:fs';
import { caseTable, binding, elementLimit, stepCostService, applicableCases, sizeSweep, unlockSteps, proportionalImpact } from '../gridrules.js';
import { traceProp } from '../views/grid-trace-v5.js';
import { allocateCosts } from '../grid.js';
import { traceCapacity, traceConstraints, traceCost, traceMitigation, traceSweep, traceUnlock, tracePerKw } from '../views/grid-trace.js';
import { resetTraces } from '../trace.js';
const D = JSON.parse(readFileSync(process.argv[2], 'utf8')), grid = { ...D.grid, source: 'dump' };
const byBus = new Map();
for (const r of grid.constraints) { const k = String(r.bus_id); if (!byBus.has(k)) byBus.set(k, []); byBus.get(k).push(r); }
const hrBy = new Map();
for (const r of grid.headroom) { const k = String(r.bus_id); if (!hrBy.has(k)) hrBy.set(k, []); hrBy.get(k).push(r); }
const fails = [], stats = { runs: 0, checks: 0, noCheck: 0, lowerBound: 0, hold: 0 };
const techs = [['solar', 100, 0], ['storage', 100, 100], ['datacenter', 0, 150]];
for (const bus of D.buses) {
  const g = { headroom: hrBy.get(bus) || [], constraints: byBus.get(bus) || [], source: 'dump' };
  for (const [tech, exportMW, importMW] of techs) {
    resetTraces();
    const S = { nodeId: bus, tech, exportMW, importMW, ui: {} };
    try {
      const t = caseTable(g, bus, tech, exportMW, importMW), ex = binding(t, 'export'), im = binding(t, 'import');
      const cases = applicableCases(tech), key = [...cases.export, ...cases.import][0], el = elementLimit(g, bus, key);
      const dir = tech === 'datacenter' ? 'import' : 'export', size = dir === 'export' ? exportMW : importMW;
      const step = stepCostService(g, bus, tech, exportMW, importMW);
      const res = allocateCosts(step.items.map(i => ({ id: i.id, label: i.label, category: 'Network upgrade', cost: i.cost, share: 100 })));
      const known = res.rows.filter(r => r.allocation != null).reduce((a, r) => a + r.allocation, 0);
      const lims = [dir === 'export' ? ex.value : im.value, ['storage'].includes(tech) ? im.value : null].filter(v => Number.isFinite(v));
      const html = traceCapacity({ grid: g }, S, { name: bus }, t, ex, im) + traceConstraints({ grid: g }, S, key, el, key.endsWith('discharge') ? exportMW : importMW)
        + traceCost({ grid: g }, S, tech, dir, size, step, res, known) + traceMitigation({ grid: g }, S, tech, dir, lims.length ? Math.min(...lims) : null);
      // v3 traces (size sweep, cost to unlock, $/kW by size) on the same bus and service.
      const sweep = sizeSweep(g, bus, tech, [50, 100, 150, 200, 250, 300, 400, 500]), u = unlockSteps(g, bus, tech);
      const html3 = traceSweep({ grid: g }, S, tech, sweep, size) + traceUnlock({ grid: g }, S, tech, u) + tracePerKw(S, sweep);
      stats.checks3 = (stats.checks3 || 0) + (html3.match(/Reconciles/g) || []).length;
      const bad3 = html3.match(/Does not reconcile<\/span>[^<]*/g);
      if (bad3) fails.push(`${bus} ${tech} v3: ${bad3.map(s => s.replace('Does not reconcile</span>', '').trim()).join(' | ')}`);
      if (/NaN|undefined/.test(html3.replace(/data-[a-z-]+="[^"]*"/g, ''))) fails.push(`${bus} ${tech}: NaN/undefined in v3 trace`);
      // Settled rules hold at every sweep size too: no true zero next to an envelope-only/gap case.
      for (const r of sweep) if (r.cost.status === 'True zero' && ((r.cost.unverified || []).length || (r.cost.gaps || []).length)) fails.push(`${bus} ${tech} @${r.size}: True zero with unverified/gap cases`);
      // v5: proportional impact with a project-only cluster is the standalone cost (share 100% on every facility with a DFAX).
      const pf = step.items.map(i => ({ id: i.id, label: i.label, cost: i.cost, dfax: { [bus]: i.dfax } }));
      const pi = proportionalImpact(pf, [{ bus, mw: size, self: true }]);
      const withD = pi.facilities.filter(f => f.share != null && f.cost != null).reduce((a, f) => a + f.cost, 0);
      if (pi.projectTotal != null && Math.abs(pi.projectTotal - withD) > 1e-9) fails.push(`${bus} ${tech}: project-only proportional total ${pi.projectTotal} ≠ standalone ${withD}`);
      if (pi.facilities.some(f => f.share != null && Math.abs(f.share - 1) > 1e-12)) fails.push(`${bus} ${tech}: project-only share ≠ 100%`);
      const htmlP = traceProp(bus, pi, [{ bus, mw: size, self: true }], 'gate');
      if (/Does not reconcile/.test(htmlP)) fails.push(`${bus} ${tech}: proportional trace does not reconcile`);
      if (/NaN|undefined/.test(htmlP.replace(/data-[a-z-]+="[^"]*"/g, ''))) fails.push(`${bus} ${tech}: NaN/undefined in proportional trace`);
      stats.prop = (stats.prop || 0) + 1;
      stats.runs++; stats.checks += (html.match(/Reconciles/g) || []).length;
      if (!/Reconciles/.test(html)) stats.noCheck++;
      // Review H3/H4: a true zero only with element evidence in every costed case; never next to a Hold.
      if (step.status === 'True zero' && ((step.unverified || []).length || step.gaps.length)) fails.push(`${bus} ${tech}: True zero with unverified/gap cases`);
      if (step.status === 'True zero' && (ex.status === 'Hold' || im.status === 'Hold')) fails.push(`${bus} ${tech}: capacity Hold but cost True zero`);
      if (step.status === 'True zero') stats.trueZero = (stats.trueZero || 0) + 1;
      if (step.status === 'No upgrades indicated') stats.indicated = (stats.indicated || 0) + 1;
      if (step.status === 'Lower bound') stats.lowerBound++; if (ex.status === 'Hold' || im.status === 'Hold') stats.hold++;
      const bad = html.match(/Does not reconcile<\/span>[^<]*/g);
      if (bad) fails.push(`${bus} ${tech}: ${bad.map(s => s.replace('Does not reconcile</span>', '').trim()).join(' | ')}`);
      if (/NaN|undefined/.test(html.replace(/data-[a-z-]+="[^"]*"/g, ''))) fails.push(`${bus} ${tech}: NaN/undefined in trace`);
    } catch (e) { fails.push(`${bus} ${tech}: threw ${e.message}`); }
  }
}
console.log(JSON.stringify(stats));
// No allow-list: optimistic stored limits fail; conservative ones (stored below the recompute) are counted, not failed.
console.log(fails.slice(0, 25).join('\n'));
console.log(fails.length ? `${fails.length} FAILED` : 'ALL PASS');
process.exit(fails.length ? 1 : 0);
