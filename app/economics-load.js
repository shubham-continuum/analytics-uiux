// Data-centre energy cost: the ONE definition (one number, one home) for Economics › Load cost, Decision and the
// S6 delivered-cost stack (rules/largeload.js deliveredCostStack takes this object as its `energy` line).
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S2-EM) · 2026-10-06 · sign-off pending · v1
// Definition: a flat load of MW billed hour by hour on the applied basis, annualised on observed hours:
//   energy_yr = MW × Σ_h price_h × Δt_h ÷ (H ÷ 8,760),   mean = Σ price × Δt ÷ H (time-weighted, observed hours)
// (It equals MW × mean × 8,760 only when mean is the observed-hour mean; the Decision method used the year-weighted
// basis mean, which differs under equal or custom year weights. This replaces it.)
const ok = v => typeof v === 'number' && Number.isFinite(v);
export const HOURS_PER_YEAR = 8760;
export const LOAD_ENERGY_METHOD = 'MW × Σ hourly price × Δt ÷ (observed hours ÷ 8,760): a flat load billed hour by hour on the applied basis';

/** rows: [{price, dtHours}] (the applied basis). Returns {value, mean, hours, importMW, method} or {value:null, reason}. */
export function loadEnergyCost(rows, mw) {
  if (!(ok(mw) && mw > 0)) return { value: null, reason: 'No import size entered: set the import MW in the project strip' };
  const held = (rows || []).filter(r => ok(r.price) && ok(r.dtHours ?? 1));
  const hours = held.reduce((t, r) => t + (r.dtHours ?? 1), 0);
  if (!hours) return { value: null, reason: 'No price on the applied basis' };
  const bill = held.reduce((t, r) => t + r.price * (r.dtHours ?? 1), 0);
  return { value: (bill * mw) / (hours / HOURS_PER_YEAR), mean: bill / hours, hours, importMW: mw, billPerMW: bill, method: LOAD_ENERGY_METHOD };
}
