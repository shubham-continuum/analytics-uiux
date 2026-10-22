// Grid columns for the Queue rules (S3): "Entry cash" and "Cluster deadline", in the vendored live grid's registry
// shape (vendor/live/31-map-grid.js §6.1: id · key · label · unit · family · source · type · dp · sort · fuels ·
// hideFor · get · why · hint). The bridge registers them (Lead wiring, design/progress/S3.md); nothing here edits the
// vendored module.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S3) · 2026-10-06 · sign-off pending · v1
//
// One home: each cell is the same engine call the Queue cards make (rules/isone.js queueCash / clusterDeadline) on
// the same inputs (queuecore.queueInputs(S)). The value is project-scoped (size, service, Land's site control), so it
// is the same on every row; a blocked or not-held result is an empty cell with its reason, never 0.
import { queueCash, clusterDeadline, cite } from '../rules/isone.js';
import { queueInputs } from '../queuecore.js';

/** getState() → the One Studio store S (the bridge passes its own accessor). */
export function queueColumns(getState) {
  const inputs = () => queueInputs(getState() || {});
  const cash = () => queueCash(inputs());
  const deadline = () => clusterDeadline(inputs());
  const sd = cite('interconnection.schedule22.study_deposit'), cs = cite('interconnection.schedule22.cluster_study_days');
  return [
    { id: 'q_entry_cash', key: 'q_entry_cash', label: 'Entry cash', unit: '$', family: 'Queue & system',
      source: 'engine: rules/isone.js queueCash (entry deposits + deposit in lieu, gated on Land site control)',
      type: 'num', dp: 0, sort: -1, fuels: ['solar', 'wind', 'bess', 'hybrid'], hideFor: ['dc'],
      get: () => { const c = cash(); return c.status === 'ok' ? c.value : null; },
      why: () => cash().reason || 'not held',
      hint: `Cash posted at the queue request for this project (size, service type and Land's site control): initial deposit + study deposit, plus the deposit in lieu where it applies. The readiness deposit may be a letter of credit or surety bond and is not counted as cash. ${sd.text}; effective ${sd.effective}.` },
    { id: 'q_cluster_deadline', key: 'q_cluster_deadline', label: 'Cluster deadline', unit: '', family: 'Queue & system',
      source: 'engine: rules/isone.js clusterDeadline (window close + CEW + cluster study)',
      type: 'text', dp: 0, sort: 1, fuels: ['solar', 'wind', 'bess', 'hybrid'], hideFor: ['dc'],
      get: () => { const d = deadline(); return d.status === 'ok' ? d.value : null; },
      why: () => deadline().reason || 'not held',
      hint: `Cluster Study Report deadline: request-window close + customer engagement window + cluster study. A deadline, not an earliest date. ${cs.text}; effective ${cs.effective}.` },
  ];
}
