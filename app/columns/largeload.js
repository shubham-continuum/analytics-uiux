// Grid (map-grid) column definitions for the data-centre scope: firm / non-firm withdrawal, MW above firm, the CRA
// upgrade cost and the FCDS/NFCDS service charge at the scope size. Registered by the bridge (09-maintain: columns/<domain>.js).
// Provenance: Claude Opus 5.5 · one-studio/design (T3, P2 slice S6) · 2026-10-06 · sign-off pending · v1
//   v2 2026-10-10 (P2 grid fix): a lower bound with nothing priced reads "not held", never "≥ $0.0M" (gridrules.costDisplay).
// Shape = the live registry's C() entries (vendor/live/31-map-grid.js): {id, key, label, unit, family, source, type, dp,
// sort, fuels, hideFor, get(r), why(r), hint}; plus badge (the pending text). Values come only from rules/largeload.js.
import { withdrawalLimits, upgradeCost, transmissionCharge, pendingBadge } from '../rules/largeload.js';
import { costDisplay } from '../gridrules.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);

/**
 * ctx: { rules, gridFor(busId) → {headroom, constraints}, sizeMW() → request MW, service() → 'FCDS'|'NFCDS'|'ICDS', year() }.
 * Results are memoised per bus × size × service × year (a grid render calls get/why per cell).
 */
export function largeLoadColumns(ctx) {
  const { rules } = ctx, badge = pendingBadge(rules).text;
  const memo = new Map();
  const at = r => {
    const bus = String(r.n.bus_id), mw = Number(ctx.sizeMW()), service = ctx.service?.() || 'FCDS', year = ctx.year?.();
    const k = `${bus}|${mw}|${service}|${year}`;
    if (!memo.has(k)) {
      if (memo.size > 20000) memo.clear();
      const grid = ctx.gridFor(bus) || { headroom: [], constraints: [] };
      const w = withdrawalLimits(grid, bus, mw, rules), c = upgradeCost(grid, bus, mw, rules);
      const peaks = ok(mw) ? Array(12).fill(mw) : null; // flat load at the scope size
      memo.set(k, { w, c, t: transmissionCharge(rules, { service, contractMW: mw, monthlyPeaksMW: peaks, year }), mw });
    }
    return memo.get(k);
  };
  const def = (id, label, unit, source, o) => ({ id, key: id, label, unit, family: 'Large load', source, type: 'num', dp: 1, sort: -1, fuels: ['dc'], hideFor: [], badge, ...o });
  return [
    def('ll_firm', 'Firm withdrawal', 'MW', 'engine: rules/largeload withdrawalLimits · firm = lowest withdrawal case (FCDS)', {
      get: r => at(r).w.firm.value, why: r => at(r).w.firm.why || 'Not held: no governing withdrawal limit',
      hint: `Firm (FCDS) service needs every withdrawal case: the lowest governing limit of the large-load and summer-peak charge cases. ${badge}.` }),
    def('ll_nonfirm', 'Non-firm withdrawal', 'MW', 'engine: rules/largeload withdrawalLimits · non-firm = highest case (NFCDS / ICDS)', {
      get: r => at(r).w.nonFirm.value, why: r => at(r).w.nonFirm.why,
      hint: `Indicative non-firm (NFCDS / ICDS) level: curtailable above the firm limit; curtailment hours not held. ${badge}.` }),
    def('ll_above_firm', 'MW above firm', 'MW', 'engine: rules/largeload withdrawalLimits · max(0, request − firm)', {
      get: r => at(r).w.aboveFirmMW, why: r => `Not held: firm limit ${at(r).w.firm.status.toLowerCase()}`,
      hint: `Request MW that would be curtailable (non-firm) at this bus. ${badge}.` }),
    def('ll_upgrade', 'CRA upgrade cost', '$M', 'engine: gridrules stepCostService (union of large-load and summer-peak charge cases)', {
      get: r => { const c = at(r).c; return ['Priced', 'True zero'].includes(c.status) ? c.total : null; },
      why: r => { const c = at(r).c; return c.status === 'Lower bound' ? (ok(c.total) ? `Not held exactly: ≥ $${c.total.toFixed(1)}M (a case without an element list may add)` : `Not held: ${costDisplay(c).replace(/^not held: /, '')}`) : `Not held: ${c.status}`; }, // a bound with nothing priced: never "≥ $0.0M"
      hint: `Large-load network upgrades the CRA would recover (PTO-AC proposal; Similar Upgrades not excluded). ${badge}.` }),
    def('ll_tx', 'Service charge', '$M/yr', 'engine: rules/largeload transmissionCharge (RNS-rated; never added to RNS)', { dp: 2,
      get: r => { const t = at(r).t; return ok(t.usd) ? t.usd / 1e6 : null; }, why: r => `Not held: ${at(r).t.why}`,
      hint: `FCDS = contract MW × RNS rate; NFCDS / ICDS = Σ monthly peak × RNS ÷ 12, flat load at the scope size. ${badge}.` }),
  ];
}
