// Contract (PPA) revenue on the delivered hourly profile: the one home for a contracted case.
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S2-EM) · 2026-10-06 · sign-off pending · v1
// Finding F011: no PPA price, tenor, contracted share or settlement point anywhere. Every contract term is a USER
// INPUT with no default: until all are entered the card says "not entered" and the revenue stays merchant.
// Settlement (as-generated shape, financial settlement against the chosen point):
//   node:  R = s · Σ g·Δt · PPA + (1 − s) · Σ g·Δt · p_node
//   hub:   R = s · Σ g·Δt · PPA + (1 − s) · Σ g·Δt · p_node + s · Σ g·Δt · (p_node − p_hub)     (basis on the contracted MWh)
// The hub series is ISO-NE .H.INTERNAL_HUB (settled) or model bus 80000 (5-yr / 10-yr runs), hour-matched; a hub
// hour missing where the plant generates makes the basis, and so the total, not held. Fixed-block shapes are not modelled.
const ok = v => typeof v === 'number' && Number.isFinite(v);

export const CONTRACT_FIELDS = Object.freeze([
  { k: 'ppaPrice', label: 'PPA price', unit: '$/MWh', who: 'offtake term sheet' },
  { k: 'settlement', label: 'Settlement point', unit: '', options: [['node', 'This bus (node)'], ['hub', 'ISO-NE Internal Hub']], who: 'offtake term sheet' },
  { k: 'sharePct', label: 'Contracted share', unit: '% of delivered MWh', who: 'offtake term sheet' },
  { k: 'tenorYears', label: 'Tenor', unit: 'years', who: 'offtake term sheet' },
  { k: 'escalatorPct', label: 'Escalator', unit: '%/yr on the PPA price (enter 0 for flat)', who: 'offtake term sheet' },
]);
export const CONTRACT_SHAPE = 'as-generated (fixed-block shapes are not modelled)';

/** Which contract terms are entered and valid. Nothing is ever filled in. */
export function contractInputs(c = {}) {
  const missing = [], invalid = [];
  for (const f of CONTRACT_FIELDS) {
    const v = c[f.k];
    if (v == null || v === '') { missing.push(f.label); continue; }
    if (f.k === 'settlement') { if (!['node', 'hub'].includes(v)) invalid.push('Settlement point must be the node or the hub'); continue; }
    if (!ok(v)) { invalid.push(`${f.label} must be a number`); continue; }
    if (f.k === 'sharePct' && (v < 0 || v > 100)) invalid.push('Contracted share must be 0–100%');
    if (f.k === 'tenorYears' && (!Number.isInteger(v) || v < 1)) invalid.push('Tenor must be a whole number of years ≥ 1');
    if (f.k === 'escalatorPct' && v <= -100) invalid.push('Escalator must be above −100%');
  }
  return { complete: !missing.length && !invalid.length, missing, invalid };
}

/**
 * Year-1 settlement over delivered rows [{timestamp, price, generationMW, dtHours}] (before annualising).
 * hubPriceAt(timestamp) → $/MWh | null, used only when settlement = 'hub'.
 */
export function contractSettlement(rows, c = {}, hubPriceAt = () => null) {
  const inp = contractInputs(c);
  const none = (status, reason) => ({ status, reason, contractedMWh: null, ppaRevenue: null, merchantRevenue: null, basis: null, total: null });
  if (inp.missing.length) return none('not entered', `Not entered: ${inp.missing.join(', ')}. No contract term is assumed; revenue stays merchant.`);
  if (inp.invalid.length) return none('invalid', inp.invalid.join('; '));
  const s = c.sharePct / 100;
  let mwh = 0, merchant = 0, basis = 0, unmatched = 0;
  for (const r of rows) {
    const e = r.generationMW * (r.dtHours ?? 1);
    mwh += e; merchant += e * r.price;
    if (c.settlement === 'hub' && e > 0) { const h = hubPriceAt(r.timestamp); if (!ok(h)) unmatched++; else basis += e * (r.price - h); }
  }
  if (unmatched) return { ...none('missing', `Hub price not held for ${unmatched} generating hour(s): the hub basis, and so the contracted total, is not held.`), contractedMWh: s * mwh };
  const ppaRevenue = s * mwh * c.ppaPrice, merchantRevenue = (1 - s) * merchant, b = c.settlement === 'hub' ? s * basis : 0;
  return { status: 'ok', reason: '', contractedMWh: s * mwh, mwh, ppaRevenue, merchantRevenue, basis: b, total: ppaRevenue + merchantRevenue + b, merchantAll: merchant };
}

/**
 * Operating-year path: years 1..tenor contracted (PPA escalated), then the merchant tail.
 * a = {merchant: all-merchant $/yr, mwh: delivered MWh/yr, basis: s-weighted hub basis $/yr (0 for node)}.
 */
export function contractPath(c, years, a) {
  if (!contractInputs(c).complete || ![a?.merchant, a?.mwh, a?.basis].every(ok)) return Array.from({ length: years }, (_, i) => ({ year: i + 1, value: null, kind: 'not held' }));
  const s = c.sharePct / 100;
  return Array.from({ length: years }, (_, i) => {
    const y = i + 1;
    if (y > c.tenorYears) return { year: y, value: a.merchant, kind: 'merchant tail' };
    const price = c.ppaPrice * (1 + c.escalatorPct / 100) ** i;
    return { year: y, value: s * a.mwh * price + (1 - s) * a.merchant + a.basis, price, kind: 'contracted' };
  });
}
