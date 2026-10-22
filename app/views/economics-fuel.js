// Economics v5 fuel routing: pure calculations (Node-tested in tests/economics-fuel.test.mjs).
//  - tab labels per fuel; a data centre's load cost stack (energy measured, capacity an assumption, transmission not
//    held), monthly cost, load flex (shift a share of load from the dearest to the cheapest hours);
//  - storage: the net bridge gross → RTE → schedule → cycling → degradation, and a run projection;
//  - hybrid: DC:AC clipping sweep; finance on cost: PV and levelised cost of an energy cost stream;
//  - presets: base / conservative / aggressive from the cited Studio assumption table (ext/75).
// Null = not held, never 0.
const ok = v => typeof v === 'number' && Number.isFinite(v);

const LABELS = {
  revenue: { solar: 'Solar revenue', wind: 'Wind revenue', storage: 'Storage revenue', hybrid: 'Hybrid PV revenue', datacenter: 'Load cost' },
  bess: { datacenter: 'Load flex' },
  hybrid: { hybrid: 'Hybrid as one asset', datacenter: 'Hybrid (n/a)' },
  finance: { datacenter: 'Cost finance' },
};
/** Fuel-specific tab label; null keeps the tab's own label. */
export const econTabLabel = (tab, tech) => LABELS[tab]?.[tech] ?? null;

/**
 * A flat load's annual cost stack. energy = measured on the applied basis ($/yr); capacity = MW × obligation% ×
 * $/kW-month × 12 (an assumption: FCA price and the load's peak contribution); transmission (RNS) is not held.
 */
export function loadCostStack({ energy, mw, capPrice, obligationPct }) {
  const cap = ok(mw) && ok(capPrice) && ok(obligationPct) ? mw * 1000 * (obligationPct / 100) * capPrice * 12 : null;
  const rows = [
    { key: 'energy', stream: 'Energy (wholesale, measured)', value: ok(energy) ? energy : null, status: 'measured' },
    { key: 'capacity', stream: 'Capacity obligation', value: cap, status: 'assumption' },
    { key: 'transmission', stream: 'Transmission (RNS / network service)', value: null, status: 'not held' },
  ];
  const measured = ok(energy) ? energy : null;
  return { rows, measured, withAssumptions: ok(measured) ? measured + (cap ?? 0) : null, complete: false };
}

/** Cost, MWh and mean price per calendar month for a flat load of mw. */
export function monthlyCost(rows, mw) {
  const m = new Map();
  for (const r of rows) {
    if (!ok(r.price)) continue;
    const k = String(r.timestamp).slice(0, 7), dt = r.dtHours ?? 1, a = m.get(k) || { key: k, cost: 0, mwh: 0, h: 0, pw: 0 };
    a.cost += r.price * dt * mw; a.mwh += dt * mw; a.h += dt; a.pw += r.price * dt; m.set(k, a);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key)).map(a => ({ key: a.key, cost: a.cost, mwh: a.mwh, mean: a.h ? a.pw / a.h : null }));
}

/**
 * Load flex: each day, move sharePct of the load (MW) out of its N dearest hours into its N cheapest.
 * saving/day = shiftMW × N × (mean dearest N − mean cheapest N); days with fewer than 2N priced hours are skipped.
 */
export function loadFlex(rows, { mw, sharePct, hours: N }) {
  const days = new Map();
  for (const r of rows) { if (!ok(r.price)) continue; const d = String(r.timestamp).slice(0, 10); if (!days.has(d)) days.set(d, []); days.get(d).push(r.price); }
  const spreads = [];
  for (const p of days.values()) { if (p.length < 2 * N) continue; const s = [...p].sort((a, b) => a - b); spreads.push(s.slice(-N).reduce((t, v) => t + v, 0) / N - s.slice(0, N).reduce((t, v) => t + v, 0) / N); }
  const shift = ok(mw) && mw > 0 && ok(sharePct) ? (mw * sharePct) / 100 : null;
  const total = spreads.reduce((t, v) => t + v, 0);
  const saving = ok(shift) && spreads.length ? shift * N * total : null;
  return { days: spreads.length, shiftMW: shift, N, meanSpread: spreads.length ? total / spreads.length : null, saving, savingYr: ok(saving) ? (saving * 365) / spreads.length : null, spreads };
}

/**
 * Storage net bridge ($/yr). ceiling = TB_N × MWh × days (no losses, one cycle a day); rte = −(1 − RTE) × topGross, the
 * round-trip loss on the discharge side only (topGross = top-N-hour price × MWh × days), so ceiling + rte = the
 * energy-consistent benchmark (RTE × top − bottom) × MWh × days (C28: never RTE × the whole spread; topGross not held
 * → the RTE and schedule steps are not held). schedule = perfect-foresight dispatch with free cycling − that benchmark
 * (limits, SOC, more or fewer cycles); cycling = dispatch with cycling cost − free dispatch; degradation = −net × deg%.
 */
export function bessBridge({ ceiling, topGross = null, rte, dispatchFree, dispatchNet, degPct }) {
  const afterRte = ok(ceiling) && ok(rte) && ok(topGross) ? ceiling - (1 - rte) * topGross : null;
  const deg = ok(dispatchNet) && ok(degPct) ? -dispatchNet * (degPct / 100) : null;
  const net = ok(dispatchNet) ? dispatchNet + (deg ?? 0) : null;
  const steps = [
    { key: 'ceiling', short: 'Ceiling', label: 'Gross spread ceiling (TB × MWh × days)', value: ok(ceiling) ? ceiling : null },
    { key: 'rte', short: 'RTE', label: 'Round-trip losses', value: ok(afterRte) ? afterRte - ceiling : null },
    { key: 'schedule', short: 'Schedule', label: 'Dispatch vs one-cycle benchmark (limits, SOC, cycles)', value: ok(afterRte) && ok(dispatchFree) ? dispatchFree - afterRte : null },
    { key: 'cycling', short: 'Cycling', label: 'Cycling cost', value: ok(dispatchFree) && ok(dispatchNet) ? dispatchNet - dispatchFree : null },
    { key: 'degradation', short: 'Degradation', label: 'Degradation (year-1 fade)', value: deg },
    { key: 'net', short: 'Net', label: 'Net value', value: net, total: true },
  ];
  return { steps, net };
}

/** Run projection: each run's spread benchmark × the basis dispatch ÷ benchmark ratio (modelled, not a dispatch per run). */
export const projectRuns = (rows, ratio) => rows.map(r => ({ ...r, value: ok(r.bench) && ok(ratio) ? r.bench * ratio : null }));

/** DC:AC sweep: unclipped[i] is the AC-scaled profile at DC:AC 1 (MW); at ratio k the array gives k × unclipped, clipped at ac. */
export function dcacSweep(unclipped, dt, ac, ratios) {
  return ratios.map(k => {
    let raw = 0, clip = 0;
    unclipped.forEach((u, i) => { const g = k * (u || 0), h = dt[i] ?? 1; raw += g * h; clip += Math.max(0, g - ac) * h; });
    return { ratio: k, rawMWh: raw, clippedMWh: clip, deliveredMWh: raw - clip, share: raw ? (100 * clip) / raw : null };
  });
}

/** Present value and levelised $/MWh of an annual cost stream (year 1 = annual, escalating), discounted at rate. */
export function pvCost({ annual, mwh, rate, years, escalation = 0 }) {
  if (!ok(annual) || !ok(rate) || !Number.isInteger(years) || years < 1) return { pv: null, levelised: null, rows: [] };
  let pv = 0, pvE = 0; const rows = [];
  for (let t = 1; t <= years; t++) { const c = annual * (1 + escalation) ** (t - 1), d = (1 + rate) ** t; pv += c / d; if (ok(mwh)) pvE += mwh / d; rows.push({ year: t, cost: c, pv: c / d }); }
  return { pv, levelised: ok(mwh) && pvE ? pv / pvE : null, rows };
}

/** Presets for the Economics inputs (applied onto S.ui.econ by the shell's preset action). All from ext/75, cited there. */
export const ECON_PRESETS = {
  base: { label: 'Vault base', note: 'Cited base values: CF (NREL SAM), RTE 86% (ORTP); REC and capacity come from the rules file (S4 streams)', ui: { econ: { solarCF: 15, windCF: 32.5, rte: 86 } } },
  conservative: { label: 'Conservative', note: 'ext/75 low cases: CF 14% / 30%, RTE 86% (assumption kept); REC and capacity from the rules file', ui: { econ: { solarCF: 14, windCF: 30, rte: 86 } } },
  aggressive: { label: 'Aggressive', note: 'ext/75 high cases: CF 16% / 35%, RTE 86% (assumption kept); REC and capacity from the rules file', ui: { econ: { solarCF: 16, windCF: 35, rte: 86 } } },
};
