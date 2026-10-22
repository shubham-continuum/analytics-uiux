// Revenue stack, connection cap and the usable-year rule: the one home for "what a revenue figure includes".
// Provenance: Claude Opus 5.5 · one-studio/design (T3, S2-EM) · 2026-10-06 · sign-off pending · v1
// Findings F002 (revenue shown as $10.4M / $10.8M / $6.7M without saying what each includes), FORMULAS §10 D8
// (Economics and the stress test used different year populations) and D10 (export limit listed, cap not stated).
// Rules: a stream that is not held is named and left out, never added as $0; a true zero is held and printed.
import { fmt } from './basis.js';

const ok = v => typeof v === 'number' && Number.isFinite(v);
export const STREAM_LABEL = { energy: 'Energy', rec: 'RECs', capacity: 'Capacity', battery: 'Battery arbitrage', contract: 'Contract (PPA)', reserves: 'Reserves' };
const nameOf = k => STREAM_LABEL[k] || k;
const listOf = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a.at(-1)}`);

/**
 * One labelled revenue stack.
 * streams: {key: $/yr | null}; include: the keys the headline is meant to carry (order kept).
 * opts.reasons: why an included stream is not held; opts.conditional: why a held stream is left out of the headline.
 * Returns {rows, total, includes, missing, excluded, short, label}. total = Σ included held streams, null when none is held.
 */
export function revenueStack(streams, include, opts = {}) {
  const keys = [...new Set([...include, ...Object.keys(streams)])];
  const rows = keys.map(k => {
    const v = streams[k], held = ok(v), inc = include.includes(k);
    return { key: k, label: nameOf(k), value: held ? v : null, status: held ? 'ok' : 'missing', included: inc && held, reason: held ? (inc ? '' : opts.conditional?.[k] || 'not in the headline') : opts.reasons?.[k] || 'not held' };
  });
  const includes = rows.filter(r => r.included).map(r => r.key);
  const missing = rows.filter(r => include.includes(r.key) && r.status === 'missing').map(r => r.key);
  const excluded = rows.filter(r => !include.includes(r.key) && r.status === 'ok').map(r => r.key);
  // W-B (2026-10-07): a stream outside the headline that is not held (e.g. capacity before a COD is entered) is still
  // named in the label with its reason; F002 asks the stack to say what it leaves out, and silence read as "none".
  const outsideMissing = rows.filter(r => !include.includes(r.key) && r.status === 'missing').map(r => r.key);
  const total = includes.length ? includes.reduce((t, k) => t + streams[k], 0) : null;
  const names = includes.map(nameOf);
  const short = !includes.length ? 'not held' : `${names.length === 1 ? `${names[0]} only` : names.join(' + ')}${missing.length ? ` (${listOf(missing.map(nameOf))} not held)` : ''}`;
  const parts = [];
  if (includes.length) parts.push(`${includes.map(k => `${nameOf(k)} ${fmt.money(streams[k])}`).join(' + ')} = ${fmt.money(total)}/yr`);
  for (const k of missing) parts.push(`${nameOf(k)} not held (${rows.find(r => r.key === k).reason})`);
  for (const k of excluded) parts.push(`${nameOf(k)} ${fmt.money(streams[k])}/yr excluded (${rows.find(r => r.key === k).reason})`);
  for (const k of outsideMissing) parts.push(`${nameOf(k)} not held (${rows.find(r => r.key === k).reason})`);
  return { rows, total, includes, missing, excluded, outsideMissing, short, label: parts.join(' · ') || 'not held' };
}

/** The hand-off composition for one stack: what Finance, Decision and the memo carry with the number. */
export function stackHandoff(stack) {
  return { annual: stack.total, includes: stack.includes, missing: stack.missing, excluded: stack.excluded, kind: stack.short, label: stack.label, streams: Object.fromEntries(stack.rows.map(r => [r.key, { value: r.value, included: r.included, status: r.status, reason: r.reason }])) };
}

/**
 * S5 Lead wiring 3 (W-B, 2026-10-07): what the storage handoff adds so after-tax finance can compute an LCOS.
 * rows = the dispatch rows ({importMW, price, dtHours}); summary.energyDischargedMWh over the basis; n = years observed.
 * dischargedMwh = MWh discharged per year; chargeCost = Σ import × price × Δt ÷ n (the charging bill, $/yr).
 * Nothing held → null (never 0).
 */
export function storageHandoffExtras(rows, summary, n) {
  const held = Array.isArray(rows) ? rows.filter(r => ok(r.importMW) && ok(r.price)) : [];
  const years = ok(n) && n > 0 ? n : null;
  const bill = held.length && years ? held.reduce((t, r) => t + r.importMW * r.price * (r.dtHours ?? 1), 0) / years : null;
  return { dischargedMwh: ok(summary?.energyDischargedMWh) && years ? summary.energyDischargedMWh / years : null, chargeCost: bill };
}

/** D10: output is capped at min(nameplate, export limit); a missing limit leaves nameplate and marks the result conditional. */
export function connectionCap(nameplate, limit) {
  if (!ok(limit)) return { value: nameplate, binds: 'nameplate', conditional: true, label: `nameplate ${fmt.mw(nameplate)} (export limit not held: conditional)` };
  const value = Math.min(nameplate, limit);
  return { value, binds: limit < nameplate ? 'limit' : 'nameplate', conditional: false, label: `min(nameplate ${fmt.mw(nameplate)}, export limit ${fmt.mw(limit)}) = ${fmt.mw(value)}` };
}

// D8: one usable-year rule for every revenue-by-year surface (Economics years and the Decision stress test).
// Settled years follow the Prices basis rule (strict: every hour held); solved runs are on a model calendar whose
// length differs from the civil year, so they need 95% of it (the rule Economics already applied to runs).
export const RUN_MIN_COVERAGE = 0.95;
export const USABLE_RULE = 'Settled years count only with every hour held (the Prices basis rule); solved runs need 95% of their model calendar.';
export function seriesUsable(s) {
  if (s.mode === 'forecast') {
    const usable = ok(s.coverage) && s.coverage >= RUN_MIN_COVERAGE;
    return { usable, why: usable ? '' : `${ok(s.coverage) ? (100 * s.coverage).toFixed(0) : 'not held'}% of the model calendar: excluded` };
  }
  if (s.complete) return { usable: true, why: '' };
  const exp = ok(s.expectedHours) ? s.expectedHours : null, got = exp != null && ok(s.coverage) ? Math.round(s.coverage * exp) : null;
  return { usable: false, why: got != null ? `${fmt.int(got)} of ${fmt.int(exp)} hours: incomplete, excluded` : 'incomplete year: excluded' };
}
