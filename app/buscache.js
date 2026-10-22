// Bounded per-bus payload cache: which loaded buses to drop so a long session does not keep every bus's hourly series.
// Provenance: Claude Opus 5.5 · one-studio/design (T3) · 2026-10-08 · sign-off pending · v1
// Found by smoke-desync seed 23 (500 random steps): every bus ever opened stayed in D (~2.8 MB of series each), until the
// browser refused requests (net::ERR_INSUFFICIENT_RESOURCES). Kept: every bus the page can show right now (current, hub,
// pins, compare set, project options) plus the most recently used up to `max`. Dropped buses reload on the next visit.

/** Ids to evict. `order` = loaded ids, oldest use first; `keep` = ids that must stay; `max` = recent ids kept beyond those. */
export function evictList(order, keep, max = 12) {
  const must = new Set([...keep].map(String));
  const rest = order.map(String).filter(id => !must.has(id));
  return rest.slice(0, Math.max(0, rest.length - max));
}

/** The ids the page can show now, read from the store. */
export function keepSet(S, projectBusIds = []) {
  const out = new Set(['hub', String(S.nodeId)]);
  for (const id of S.pins || []) out.add(String(id));
  for (const id of S.ui?.dOpts || []) out.add(String(id));
  for (const id of projectBusIds) if (id != null) out.add(String(id));
  return out;
}
