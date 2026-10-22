// State-of-charge grid for the dispatch solver (economics.js dispatch, via its stepMWh option).
// A grid step that does not divide a power limit silently under-uses it: the solver can move only whole steps
// per hour (review 2026-09-29: −26% to −43% on a 40-step grid; $0 when one step exceeds the hourly limit).
// Rule: make the tightest per-hour limit an exact number of steps, keep ≥ MIN_STATES states, and pick the
// coarsest such grid on which the other limit (and, for hybrids, hourly solar charging) is ≥ TARGET usable.
// If no grid within MAX_STATES reaches FLOOR, the value is not assessed — never shown as $0.
export const SEC_PER_MOVE = 2.4e-8, BUDGET_SEC = 20; // measured solver speed; a longer solve is not run in the browser
export const MIN_STATES = 40, MAX_STATES = 1500, TARGET = 0.95, FLOOR = 0.95; // coarsest grid that reaches 95% (runtime grows with states × moves)

const usable = (x, step) => (x > 0 ? (Math.floor(x / step + 1e-9) * step) / x : 1);

/**
 * energyMWh; chargeMW, dischargeMW, exportMW (MW); etaC, etaD; solarMW (optional hourly array: charging source for hybrids).
 * Returns { stepMWh, states, usableChargeMW, usableDischargeMW, solarAbsorbed, feasible, reason }.
 */
export function dispatchGrid({ energyMWh, chargeMW, dischargeMW, exportMW = dischargeMW, etaC = 1, etaD = 1, solarMW = null, dtHours = 1, hours = 8760 }) {
  const cS = chargeMW * etaC * dtHours, dS = (Math.min(dischargeMW, exportMW) / etaD) * dtHours; // stored MWh movable per hour
  if (!(energyMWh > 0) || !(cS > 0) || !(dS > 0)) return { stepMWh: null, states: 0, feasible: false, reason: 'Battery energy and charge/discharge limits must be above zero.' };
  const bind = Math.min(cS, dS), other = Math.max(cS, dS);
  const solar = solarMW ? solarMW.map(g => Math.min(Math.max(g, 0), chargeMW) * etaC * dtHours).filter(x => x > 1e-9) : null;
  const solarTotal = solar ? solar.reduce((a, b) => a + b, 0) : 0;
  const solarUsable = step => (solar && solarTotal ? solar.reduce((a, x) => a + Math.floor(x / step + 1e-9) * step, 0) / solarTotal : 1);
  let best = null;
  for (let k = Math.max(1, Math.ceil((MIN_STATES * bind) / energyMWh - 1e-9)); ; k++) {
    const step = (bind / k) * (1 - 1e-9), states = Math.ceil(energyMWh / step - 1e-9);
    if (states > MAX_STATES) break;
    const score = Math.min(usable(other, step), solarUsable(step));
    const cand = { step, states, score };
    if (!best || score > best.score + 1e-12) best = cand;
    if (score >= TARGET) { best = cand; break; }
  }
  const lim = cS <= dS ? `charge limit of ${+chargeMW.toFixed(2)} MW` : `discharge/export limit of ${+Math.min(dischargeMW, exportMW).toFixed(2)} MW`;
  if (!best) return { stepMWh: null, states: 0, feasible: false, reason: `The ${lim} moves less than ${+(energyMWh / MAX_STATES).toFixed(2)} MWh an hour, below the finest grid the solver can run for a ${+energyMWh.toFixed(0)} MWh battery. Value not assessed: reduce the duration or use a finer model.` };
  const out = {
    stepMWh: best.step, states: best.states,
    usableChargeMW: (Math.floor(cS / best.step + 1e-9) * best.step) / etaC / dtHours,
    usableDischargeMW: Math.min(Math.floor(dS / best.step + 1e-9) * best.step * etaD / dtHours, Math.min(dischargeMW, exportMW)),
    solarAbsorbed: solar ? solarUsable(best.step) : null,
    feasible: best.score >= FLOOR, reason: '',
  };
  // Work ≈ hours × states × reachable moves per state (band width in steps).
  out.moves = Math.ceil((cS + dS) / best.step) + 1; out.estSeconds = hours * best.states * out.moves * SEC_PER_MOVE;
  if (out.feasible && out.estSeconds > BUDGET_SEC) { out.feasible = false; out.reason = `This battery needs a ${best.states}-step grid to represent its limits${solar ? ' and the hourly solar charging' : ''}; solving ${Math.round(hours).toLocaleString('en-US')} hours would take about ${Math.round(out.estSeconds)} s in the browser. Value not assessed: choose a single-year basis, a shorter duration or a larger battery-to-solar ratio.`; }
  if (!out.feasible && !out.reason) out.reason = `No affordable grid lets the solver use at least ${FLOOR * 100}% of the ${cS <= dS ? 'discharge' : 'charge'} limit${solar ? ' and of the hourly solar charging' : ''} (best ${(100 * best.score).toFixed(1)}%). Value not assessed.`;
  return out;
}
