// v8 copy layer (Workflow-v2 §1.1, §1.4, §10.2; Antman package 2026-10-05): the lean stage questions, tab names and
// one-line tab questions, and the single verdict vocabulary. Copy never carries a number: figures come from the data.

export const STAGE_Q = { market: 'Where to look?', land: 'Enough land?', grid: 'Can it connect?', queue: 'What could change?', prices: "What's power worth?", economics: 'Does it pay?', decision: 'Go or no-go?' };

export const TAB_NAME = {
  market: { map: 'Map', find: 'Find', rank: 'Rank', size: 'Sizes', regions: 'Zones' }, // map = the one view (2026-10-22); the others are its aliases
  land: { map: 'Map', area: 'Area', footprint: 'Cost', corridor: 'Route', permits: 'Permits' }, // map = the one view (2026-10-22); the others are its aliases
  grid: { map: 'Map', capacity: 'Limit', constraints: 'Bottlenecks', cost: 'Upgrades', mitigation: 'Phasing', direct: 'Direct facilities', affected: 'Affected systems' },
  queue: { cluster: 'Nearby', schedule: 'Timeline', cash: 'Cash', changes: 'Changes' },
  prices: { lmp: 'History', basis: 'Hub gap', shape: 'Solar value', tails: 'Spreads' },
  economics: { revenue: 'Revenue', bess: 'Battery', hybrid: 'Hybrid', finance: 'Return' },
  decision: { compare: 'Compare', stress: 'Stress test', readiness: 'Open items', record: 'Record' },
};

// One line under the stage question (the mockups' mk-tab-answer), phrased as the tab's question.
export const TAB_Q = {
  market: { map: 'Which buses pass, rank highest, hold at other sizes, and where?', find: 'Which buses pass at your size?', rank: 'Strongest buses under your weights.', size: 'Does the shortlist hold at other sizes?', regions: 'Cheaper, emptier or more congested zones?' },
  land: { map: 'Enough clear land, how far to connect, and which permits are open?', area: 'Clear land around the bus.', footprint: 'Land need and price.', corridor: 'How far is the line, and its cost?', permits: 'Which permits are open; do we control the site?' },
  grid: { map: 'What fits, what limits it, and at what cost?', capacity: 'Largest size that fits.', constraints: 'Which line limits, and when.', cost: 'What might we pay?', mitigation: 'Start smaller or accept cuts?', direct: 'The bay and gen-tie to reach the grid.', affected: 'Upgrades on neighbouring systems.' },
  queue: { cluster: 'Who else wants to connect here?', schedule: 'When could the studies finish?', cash: 'What goes in, what we could lose.', changes: 'What moved since the grid study.' },
  prices: { lmp: 'Actual prices and forecasts here.', basis: 'Does this bus beat the hub?', shape: 'What a solar MWh earns here.', tails: 'Price swings a battery could use.' },
  economics: { revenue: 'What the bus earns per year, stream by stream.', bess: 'Battery value: a ceiling, and its limits.', hybrid: 'Does adding storage to solar pay?', finance: 'Is the return good enough?' },
  decision: { compare: 'Which option is strongest?', stress: 'Does revenue hold across price paths?', readiness: "What's missing, and who closes it?", record: 'What we decided, and why.' },
};

// Technology-aware names (Workflow-v2 §7): e.g. a battery's revenue tab is its battery value.
const TECH_NAME = { 'economics.revenue.storage': 'Battery value', 'prices.shape.storage': 'Spread value', 'prices.shape.datacenter': 'Load cost', 'prices.shape.wind': 'Wind value' };

/** The tab's label: a fuel-specific label from the view wins; the view's default (long) label maps to the lean name. */
export function tabName(stage, tab, tech, viewLabel) {
  const lean = TECH_NAME[`${stage}.${tab}.${tech}`] || TAB_NAME[stage]?.[tab];
  if (viewLabel && lean && !DEFAULT_LONG.has(viewLabel)) return viewLabel;
  return lean || viewLabel || tab;
}
// The views' default labels (v7). Anything else a view returns is fuel-specific and kept.
const DEFAULT_LONG = new Set(['Market map', 'Find locations', 'Rank & compare', 'Size & robustness', 'Compare regions', 'Land map', 'Buildable area', 'Footprint & land cost', 'Connection corridor', 'Permits & site control',
  'Grid map', 'Connection capacity', 'Constraints & coverage', 'Upgrade cost allocator', 'Mitigation & phasing', 'Queue & cluster', 'Schedule & milestones', 'Cash & commitments', 'Changes & risk',
  'LMP & years', 'Basis & congestion', 'Shape & capture', 'Tails & spreads', 'Solar & wind revenue', 'BESS dispatch', 'Hybrid sizing', 'Project finance', 'Compare options', 'Stress test', 'Readiness & actions', 'Decision record']);

export const VERDICT = { Pass: 'met', Open: 'hold', Fail: 'fail' }; // label → status-pill class (shared.css .mk-status)

/** "1 Fail · 5 Open · 0 Pass (of 6)": all three counts, always, Fail first (Findings F001: a zero Fail count is printed,
 *  never folded away, so the strip, band, inspector and Decision read the same words; S2-GD #6, 2026-10-07). */
export function verdictLine({ pass = 0, hold = 0, fail = 0 } = {}) {
  const n = pass + hold + fail;
  return `${fail} Fail · ${hold} Open · ${pass} Pass (of ${n})`;
}
