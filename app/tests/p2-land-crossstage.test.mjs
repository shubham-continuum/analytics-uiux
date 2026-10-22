// P2 C07 cross-stage: Land, Grid and Economics give the same status for the same bus and case (D6.1). Envelope-only
// evidence is Hold-class everywhere: Land never prints clears / does not clear on it, Economics never treats it as an
// unconditional pass or prints "Does not fit without network upgrades" on it.
// Provenance: Claude Opus 5.5 (P2 land fix agent) · one-studio/design (T3, P2 land) · 2026-10-10 · sign-off pending · v1
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { landVerdict } from '../landcore.js';
import { caseTable, binding, ENVELOPE_ONLY } from '../gridrules.js';
import { EH } from '../views/economics.js';

const G = JSON.parse(readFileSync(new URL('../data/snapshot.json', import.meta.url))).grid;
const BUSES = [...new Set(G.headroom.map(h => String(h.bus_id)))];
const MWS = [50, 100, 150, 300];

// Economics' limits (views/economics.js limitsFor): the fuel's export binding; the storage shoulder-charge binding at
// max(import, export). Same calls here, so a change there that drifts from Grid shows up as a Land/Grid mismatch.
const econ = (bus, tech, mw, im) => {
  const svc = ['storage', 'hybrid'].includes(tech) ? 'storage' : tech === 'wind' ? 'wind' : 'solar';
  return { ex: binding(caseTable(G, bus, svc, mw, Math.max(im || 0, mw)), 'export'), im: binding(caseTable(G, bus, 'storage', mw, Math.max(im || 0, mw)), 'import') };
};

test('Land = Grid = Economics status per direction (storage and solar, import as entered = export)', () => {
  for (const bus of BUSES) for (const mw of MWS) {
    const st = landVerdict(G, bus, 'storage', mw, mw), grid = caseTable(G, bus, 'storage', mw, mw), e = econ(bus, 'storage', mw, mw);
    assert.equal(st.import.status, binding(grid, 'import').status, `${bus} ${mw} storage import: Land vs Grid`);
    assert.equal(st.import.status, e.im.status, `${bus} ${mw} storage import: Land vs Economics`);
    assert.equal(st.export.status, e.ex.status, `${bus} ${mw} storage export: Land vs Economics`);
    const so = landVerdict(G, bus, 'solar', mw, 0);
    assert.equal(so.export.status, binding(caseTable(G, bus, 'solar', mw, 0), 'export').status);
    assert.equal(so.export.status, econ(bus, 'solar', mw, 0).ex.status, `${bus} ${mw} solar export: Land vs Economics`);
  }
  // the reviewed case: 111403 storage charge rests on the envelope (99.2 MW): Envelope only on every stage
  assert.equal(landVerdict(G, 111403, 'storage', 100, 100).import.status, ENVELOPE_ONLY);
  assert.equal(econ(111403, 'storage', 100, 100).im.status, ENVELOPE_ONLY);
});

// Economics gate(limit, mw, what, status) reads Grid's binding status (lead wiring P2-C07-econ). Until it lands the
// gate takes three arguments and this test is skipped with that reason (it is not a pass).
const wired = EH.gate.length >= 4;
test('Economics gate follows the binding status: only Fits is unconditional; envelope-only is conditional, never "Does not fit"', { skip: wired ? false : 'pending lead wiring P2-C07-econ (views/economics.js gate(limit, mw, what, status))' }, () => {
  const g = EH.gate;
  for (const [lim, mw] of [[57.3, 100], [99.2, 100], [200, 100], [550, 100]]) {
    const r = g(lim, mw, 'Charging', ENVELOPE_ONLY);
    assert.equal(r.ok, false, `envelope ${lim} vs ${mw}: conditional`);
    assert.doesNotMatch(r.msg, /Does not fit/, 'envelope only never reads as does not fit');
    assert.match(r.msg, /conditional/);
  }
  assert.equal(g(110.9, 100, 'Export', 'Fits').ok, true);
  const dnf = g(50, 100, 'Export', 'Does not fit');
  assert.equal(dnf.ok, false); assert.match(dnf.msg, /Does not fit without network upgrades/);
  for (const s of ['Hold', 'Not studied', 'Partly studied', undefined, null]) assert.equal(g(200, 100, 'Export', s).ok, false, `status ${s} never passes`);
  assert.equal(g(null, 100, 'Export', 'Hold').ok, false);
  // per bus: Economics is unconditional exactly when Land (= Grid) says Fits
  for (const bus of BUSES) for (const mw of MWS) {
    const e = econ(bus, 'solar', mw, 0), land = landVerdict(G, bus, 'solar', mw, 0);
    assert.equal(g(e.ex.value, mw, 'Export', e.ex.status).ok, land.export.status === 'Fits', `${bus} ${mw} solar`);
  }
});
