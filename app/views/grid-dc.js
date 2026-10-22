// Data-centre (large-load) stage wiring for Grid, Queue and Decision (S6 #2, #7; applied by W-C 2026-10-07).
// One dcFlow(...) per render (rules/largeload.js) feeds views/cards-dc.js; this file only decides which S6 card goes on
// which stage/tab, inserts the block before the tab's next-step link, and drops generator-titled cards for a load.
// Provenance: Claude Fable 5.1 (W-C integration agent) · one-studio/design (T3, P2 wave W-C) · 2026-10-07 · sign-off pending · v1
//   v2 2026-10-10 Claude Opus 5.5 (P2 grid fix C34): data-gen-only drop; large-load application date apart from Schedule 22.
// No number is typed here: the RNS-rate year, the service list and every figure come from the rules file or the DB.
import { dcFlow, ll } from '../rules/largeload.js';
import { dcCards, GENERATOR_ONLY } from './cards-dc.js';
import { getRules } from '../rules/isone.js';

/** Which S6 card sits on which tab (every card once per stage). */
export const DC_TABS = {
  grid: { capacity: ['eligibility', 'withdrawal'], cost: ['upgrade'] },
  queue: { cluster: ['services'], schedule: ['timeline'] },
  decision: { compare: ['eligibility', 'rules'] },
};

/** The RNS-rate year the rules hold for this calendar year, else the latest held year; null when the rules are not loaded. */
export function llYear(rules) {
  let L; try { L = ll(rules); } catch { return null; }
  const years = Object.keys(L.rns_rate || {}).filter(k => /^\d{4}$/.test(k)).map(Number);
  if (!years.length) return null;
  const now = new Date().getFullYear();
  return years.includes(now) ? now : Math.max(...years);
}

/** The DC cards for one stage/tab as HTML ('' for a generator, a tab with no DC card, or rules not loaded). */
export function dcStageCards(stage, tab, { data, S, node, rules = getRules(), loadCost = null } = {}) {
  if (!S || S.tech !== 'datacenter' || !data?.grid) return '';
  const keys = DC_TABS[stage]?.[tab]; if (!keys || !keys.length) return '';
  let flow;
  try {
    flow = dcFlow(rules, data.grid, { bus: S.nodeId, mw: Number(S.importMW), kv: node?.nominal_kv ?? node?.kv ?? null, service: S.ui?.llService || 'FCDS', year: llYear(rules),
      energy: loadCost && typeof loadCost.value === 'number' ? loadCost : undefined, applicationDate: S.ui?.llAppDate || undefined }); // C34: the large-load application date, never the Schedule 22 window close (not held when unset)
  } catch { return ''; } // rules not loaded: no card rather than a half card (the Evidence tab says why)
  const dc = dcCards({ flow, node: { name: node?.name || node?.bus_name || `bus ${S.nodeId}`, busId: S.nodeId } });
  return keys.map(k => dc.cards[k]).filter(Boolean).join('');
}

/** Insert the DC block before the tab's next-step link (else append). Generator fuels: the HTML is returned untouched. */
export function withDcCards(html, stage, tab, ctx) {
  const cards = dcStageCards(stage, tab, ctx);
  if (!cards) return html;
  const block = `<div class="cards dc-cards" data-dc-stage="${stage}">${cards}</div>`;
  const i = html.lastIndexOf('<div class="next-step"');
  return i >= 0 ? `${html.slice(0, i)}${block}${html.slice(i)}` : `${html}${block}`;
}

/** S6 #7: drop a card whose TITLE is generator-only (export limit, energy revenue, capture, RECs, PfP, ITC/PTC…).
 *  Title only: a card whose body explains why a screen does not apply to a load is kept, and so is the trace card. */
// C34 (2026-10-10): a producer can also mark content generator-only by data attribute, data-gen-only="1", on a card
// section or a table row; marked sections and rows are dropped whatever their title (e.g. decision.js export rows).
const GEN_ATTR = /\sdata-gen-only="1"/;
export function dropGeneratorOnly(html) {
  if (!html) return html || '';
  return html.replace(/<section class="card\b[^>]*>[\s\S]*?<\/section>/g, sec => {
    if (GEN_ATTR.test(/^<section\b[^>]*>/.exec(sec)[0])) return '';
    const title = (/<h3>([\s\S]*?)<\/h3>/.exec(sec) || [])[1] || '';
    return GENERATOR_ONLY.some(rx => rx.test(title.replace(/<[^>]+>/g, ' '))) ? '' : sec;
  }).replace(/<tr\b[^>]*\sdata-gen-only="1"[^>]*>[\s\S]*?<\/tr>/g, '');
}
