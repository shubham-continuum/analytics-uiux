"""Grid re-check fixes: storage/hybrid cost covers charge cases; no-violation cases are gaps; handoff text/status."""
from pathlib import Path

P = Path(__file__).resolve().parent.parent


def patch(name, pairs):
    p = P / name
    t = p.read_text(encoding="utf-8")
    for old, new in pairs:
        assert old in t, f"{name}: MISSING {old[:70]}"
        t = t.replace(old, new, 1)
    p.write_text(t, encoding="utf-8")


patch("gridrules.js", [
    # A no-violation case has no published tested maximum: it is a gap, never a silent true zero.
    ("    if (c.status === 'Not held') {\n      const env = envelope(grid, bus, key);\n      if (!ok(env) || env < S) gaps.push({ key, label: CASE_LABEL[key], reason: c.reason, envelope: env });\n      continue;\n    }",
     "    if (c.status === 'Not held') {\n      const env = envelope(grid, bus, key), noViol = elementLimit(grid, bus, key).status === 'noViolation';\n      if (noViol || !ok(env) || env < S) gaps.push({ key, label: CASE_LABEL[key], reason: c.reason, envelope: env });\n      continue;\n    }"),
])
p = P / "gridrules.js"
p.write_text(p.read_text(encoding="utf-8") + '''
/**
 * Upgrade cost for the whole service. Storage and hybrids charge at their power rating, so the
 * charge cases are costed too (at max(import, export) MW); results are unioned and gaps merged.
 */
export function stepCostService(grid, bus, tech, exportMW, importMW) {
  if (tech === 'datacenter') return stepCostAll(grid, bus, tech, importMW, 'import');
  const ex = stepCostAll(grid, bus, tech, exportMW, 'export');
  if (!['storage', 'hybrid'].includes(tech)) return ex;
  const charge = Math.max(Number(importMW) || 0, Number(exportMW) || 0);
  const im = stepCostAll(grid, bus, tech, charge, 'import');
  if (ex.status === 'Not requested') return im;
  const byId = new Map([...ex.items, ...im.items].map(i => [i.label, i]));
  const items = [...byId.values()], priced = items.filter(i => i.cost != null), gaps = [...ex.gaps, ...im.gaps];
  const unpriced = items.length - priced.length;
  return { status: gaps.length ? 'Lower bound' : !items.length ? 'True zero' : unpriced ? 'Partly priced' : 'Priced', total: priced.reduce((t, i) => t + i.cost, 0), items, unpriced, gaps, contingent: (ex.contingent || 0) + (im.contingent || 0) };
}
''', encoding="utf-8")

patch("views/grid.js", [
    ("import { caseTable, binding, elementLimit, stepCost, stepCostAll, applicableCases, CASE_LABEL } from '../gridrules.js';",
     "import { caseTable, binding, elementLimit, stepCost, stepCostAll, stepCostService, applicableCases, CASE_LABEL } from '../gridrules.js';"),
    ("  const step = stepCostAll(data.grid, S.nodeId, tech, size, dir);\n  S.ui.allocKey",
     "  const step = stepCostService(data.grid, S.nodeId, tech, Number(S.exportMW), Number(S.importMW));\n  S.ui.allocKey"),
    ("  const alt = sizes.map(s => { const c = stepCostAll(data.grid, S.nodeId, tech, s, dir); return { s, fits: ok(lim) ? s <= lim : null, c }; });",
     "  const alt = sizes.map(s => { const c = dir === 'import' ? stepCostAll(data.grid, S.nodeId, tech, s, dir) : stepCostService(data.grid, S.nodeId, tech, s, ['storage', 'hybrid'].includes(S.tech) ? s : 0); return { s, fits: ok(lim) ? s <= lim : null, c }; });"),
    ("  const atReq = stepCostAll(data.grid, S.nodeId, tech, req, dir);",
     "  const atReq = stepCostService(data.grid, S.nodeId, tech, Number(S.exportMW), Number(S.importMW));"),
    ("Economics will cap export at ${fmt.mw(ex.value)} and charging at the shoulder limit, and record the case and basis.",
     "Economics will cap export at ${fmt.mw(ex.value)}${['storage', 'hybrid'].includes(S.tech) ? ` and charging at ${fmt.mw(im.value)} (shoulder)` : ''}, and record the case and basis."),
])
patch("app.js", [
    ("status: L.exportStatus, at: new Date().toISOString() };",
     "status: L.exportStatus, importStatus: L.importStatus, at: new Date().toISOString() };"),
])
patch("tests/gridrules.test.mjs", [
    ("import { applicableCases, elementLimit, caseTable, binding, stepCost, stepCostAll } from '../gridrules.js';",
     "import { applicableCases, elementLimit, caseTable, binding, stepCost, stepCostAll, stepCostService } from '../gridrules.js';"),
    ("test('data-centre cost uses only the large-load case', () => {",
     "test('storage cost includes the charge case: 111403 at 100/100 MW is a lower bound (shoulder charge 99.2 MW)', () => {\n"
     "  const c = stepCostService(grid, 111403, 'storage', 100, 100);\n"
     "  assert.equal(c.status, 'Lower bound');\n"
     "  assert.ok(c.gaps.some(g => g.key === 'shoulder|charge'));\n"
     "});\n\n"
     "test('a no-violation case without a tested maximum is never a silent true zero', () => {\n"
     "  const c = stepCostAll(grid, 114417, 'solar', 100, 'export');\n"
     "  assert.notEqual(c.status, 'True zero');\n"
     "});\n\n"
     "test('data-centre cost uses only the large-load case', () => {"),
])
print("patched OK")
