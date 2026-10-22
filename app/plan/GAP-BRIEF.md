# Gap brief v4: perfect every calculation, fuel-specific tabs, depth levels, sample projects

Read `plan/BUILD-BRIEF.md` first. Every rule in it still applies: file ownership, the "use ALL the data" requirement, provenance, null means not held, traces, tests, and a read-only live Studio.

This brief assigns every gap found in the three audits of 2026-09-30 to one owner.

**Goal (Ganesh):**
- every calculation is perfected;
- every tab adapts to the fuel type (solar / wind / storage / hybrid / datacenter), with calculations specific to that fuel;
- Screen / Review / Study depth works;
- sample projects show the complete workflow.

## Shared contracts (the Shell agent implements them; everyone codes against them now)

**Depth**
- `S.depth` is one of 'screen' | 'review' | 'study'. The default is 'review'. It lives in the hash as `depth=`.
- ctx gets `depth`.
- Depth is cumulative, as in the Studio (`src/app.js:858-909`):
  - **Screen:** ISO-wide or summary data only (marts, envelopes, counts). The KPI row plus the key chart, with controls hidden unless essential.
  - **Review:** one bus with settled hourly data, plus the evidence cards.
  - **Study:** everything, including element-level rows, dispatch, finance and the calculation traces.
- **In markup,** add `data-depth="screen|review|study"` to each `<section class="card …">` for the MINIMUM depth at which the card appears. The shell hides cards above the current depth with CSS/JS and shows "Raise depth to see N more" at the bottom of the tab.
- **Where to tag:** views tag the cards; they don't filter them themselves. Heavy fetches for Study-only cards must be skipped below Study: check `ctx.depth`.
- **Traces:** trace cards default to `data-depth="study"`. A trace belonging to a KPI that is visible at Review may be tagged review.

**Fuel**
- `S.tech` is one of 'solar' | 'wind' | 'storage' | 'hybrid' | 'datacenter'.
- Every tab must render fuel-appropriate content. Nothing solar-only may show for a load. Where a tab has nothing meaningful for a fuel, render a fuel-specific alternative, or a one-line "not applicable to <fuel>: <why>" card. Never show the wrong calculation.

**Per-fuel verdict**
- `decisioncore.fuelVerdict(metrics, tech, thresholds)` returns a list of `{test, value, threshold, verdict, why}`.
- The Decision agent owns it. Other dashboards may display it by importing it, read-only.

**Sample projects**
- The Samples agent writes `data/samples.json`:
  ```
  {projects:[{id, name, client_type, tech, exportMW, importMW, narrative, options:[{id, label, busId, note}], basis:{...}, steps:[{stage, tab, depth, what_to_look_at}]}]}
  ```
- The Shell agent adds a project/option selector and a guided walkthrough that sets S (bus, tech, MW, basis, depth, stage/tab) from the steps and moves through them with Prev/Next.
- `pins` and `cmp` load the project's options into Decision (`S.ui.dOpts`).

## Assignments

### Shell (app.js, app.css, charts.js, ui.js, trace.js, html; smoke-allbus, smoke-interact)
1. The depth contract: a Screen / Review / Study segmented control in the top bar, the hash, ctx, card hiding and the "raise depth" footer.
2. Fuel-specific tab labels. `view.tabs[i].labelFor?.(tech)` is optional, and the views provide it.
3. The project/option selector and the guided walkthrough, reading `data/samples.json`, including the Prev/Next step bar and "what to look at" text.
4. Presets on inputs (Vault base / Conservative / Aggressive): expose a generic `preset` ACTION that applies `view.presets[name]` to `S.ui`. The views define their presets.
5. Pins (📌 on a bus → `S.pins`) and "Compare pinned" → Decision.
6. Add `tornado(rows:[{label, low, high, base}], {fmt, title, height})` to charts.js. Economics currently draws its own.
7. Tests: extend smoke-allbus and smoke-interact to cover depth switching, fuel switching on every page (no console errors, no "NaN"), and the walkthrough of one sample project end to end.

### Prices (fuel)
- **Data centre / load view:**
  - energy bill share by hour;
  - scarcity-hour cost (hours above $X and their share of the bill);
  - hours under $20;
  - real-time cost to a flat load;
  - the Studio's cards 5.18, 5.21 and 5.31.
- **Storage:**
  - charge/discharge block analysis (the cheapest and dearest N hours by month, card 5.16);
  - spread duration curve (5.17).
- **Wind:** the overnight price floor at P5/P25 (5.20), and a wind capture proxy using the ISO-NE fleet wind shape from fact_genfuel_hourly, which Economics already uses.
- **Shape tab:** stop showing solar capture as the headline for storage or DC.
- Tag every card's depth.

### Economics (fuel routing; the biggest gap)
- **Route tabs by fuel.**
  - Datacenter: tab 1 becomes a load cost stack (energy + capacity + transmission-proxy placeholders, labelled) with a wholesale exposure view; the BESS/hybrid tabs become "not applicable" or become load-flex (shiftable-load value) if data allows; Finance uses cost instead of revenue.
  - Storage: tab 1 becomes the storage revenue stack.
- **Storage:**
  - arbitrage ceiling;
  - duration sweep 2–8 h (worker);
  - cycles against a threshold;
  - net bridge (gross → RTE → cycling cost → degradation);
  - projection by year across the runs;
  - the capacity / ancillary / Clean Peak stack (6.07–6.09, 6.02s, 6.03s, 6.30s). Only cited or DB prices; anything else is labelled "assumption".
- **Hybrid** as one asset: clipping recovered by storage, incremental battery value, battery size vs curtailment, DC:AC ratio and clipping (6.13–6.15, 6.06). Fix Finance so the hybrid handoff doesn't collapse to storage (economics.js:522).
- **Wind:** use the fleet shape and label it.
- **Revenue stack:** hold REC prices for other states if any source in the workspace has them. Search the vault and data files read-only, and never invent. Otherwise say "not held".

### Grid
- **N-1-1, voltage, stability:** keep them as "Not assessed" with the reason.
- **Affected systems:** add a tie-adjacency flag from `dim_branch.from_area/to_area` and `dim_bus.pf_area/pf_ba`.
- **Cost allocation:** implement proportional-impact allocation over a user-defined cluster (DFAX-weighted MW share per facility, per the Order 2023 summary line 58), next to the editable allocator.
- **Surplus interconnection screen (G5):** at existing generator POIs, compare `dim_generator` installed MW with max capacity and headroom. ERIS stays ERIS.
- **SCR:** a weighted SCR indicator that accounts for nearby IBR from `dim_generator`, labelled as an indicator, not an ISO-NE criterion.
- **ERIS/NRIS:** carry the service type onto every headroom figure; CNR ≤ NR until a deliverability screen exists.
- **Order 1920 context card** from `dim_transmission_upgrade` and `dim_substation_upgrade`.
- **Clean-up:** delete the `STYLE` block now that app.css has the gx rules, and switch SVG `style=` to the `gx-t*` / `gx-*line` classes.
- Tag the depth of every card.

### Queue
- **Bug:** Changes for a data centre reads the import binding after running the solar cases (queue.js:359). Fix it.
- **Load ratio:** Cluster for a DC must show a load ratio (import request ÷ import limit) instead of null.
- **Material modification:** a checklist card. The ISO-NE §4.4 text is not held, so say so, and list the triggers the vault documents (Order 845 technological change).
- **Penalty exemptions:** add the 25% / 100% cost-increase exemptions (Order 2023 summary line 56) to Cash.
- **ERIS/NRIS:** show the service type per request, and a CNR/NR mix chart.
- Tag the depth of every card.

### Land
- **Bug:** the storage corridor test uses a summer-peak charge (landcore.js:137). Use the Grid rule instead: shoulder charge only (`gridrules.applicableCases`). Hybrid must include the charge side.
- **Permits:** add fuel-specific items (wind: aviation/FAA obstruction, noise and setback; storage: fire code NFPA 855 and setbacks; solar: glare, decommissioning; DC: water, noise and utility service). Label the list a starting checklist from general knowledge, not a legal determination.
- Tag the depth of every card.

### Market
- **Screener:** add an upgrade-cost screen: the "no upgrades indicated / priced ≤ $X" filter at the request size, using gridrules `stepCostService` on the market grid rows. Add a curtailment screen only if backed by the unified DB (the vendor ramps are excluded, so otherwise not held).
- **Ranker:** add an "Equal weights" preset (plan decision #8), and keep the Studio profiles as a second preset.
- Tag the depth of every card.

### Decision
- **Per-fuel verdict** (`fuelVerdict`) and gate thresholds, surfaced in Compare. Thresholds are user-editable with visible defaults labelled as assumptions:
  - curtailment ≤ 2% (solar/wind, only where curtailment data is held);
  - capture ≥ 90% (solar/wind; the capture basis follows open decision #2, so show both clear-sky and fleet shape);
  - TB4 > $10 (storage);
  - price and volatility below thresholds (DC);
  - opportunity loss (BESS).
- **Capture gate (gate 6):** implement it, with the basis labelled.
- **Hybrid:** revenue must include PV, not "n/a" (decisioncore.js:43).
- **Evidence pack export (D3):** a single "Download evidence pack" that builds an Excel-readable SpreadsheetML 2003 XML workbook in pure JS, with no library. Sheets: Summary (options, gates, verdict), Assumptions, and one sheet per trace currently registered (trace.js exposes `csvFor(id)`; ask the Shell agent for a `listTraces()` export if needed). Also a printable memo.
- **pins / cmp:** consume `S.pins` from the shell for Compare.

### Samples (a new agent). Owns data/samples.json, plan/build_samples.py, tests/smoke-samples.mjs, docs/SAMPLES.md
- Build 4–5 sample projects from REAL buses, chosen by a script from the unified DB. Choose buses that exercise the workflow well, and read the live Studio's demo projects read-only (`studio/src/data-demo.js`, `ext/70-demo-data.js`, `71-demo-state.js`; e.g. "kennebec" o1/o2) so one sample mirrors it:
  1. **Solar 100 MW:** 3 options (own node, same substation, borrowed price), one with a Lower-bound cost.
  2. **Storage 100 MW / 400 MWh:** a tight shoulder-charge limit (like 100172), plus an unconstrained option.
  3. **Hybrid PV 150 + BESS 75:** clipping and spill at the POI.
  4. **Data centre 300 MW import:** large-load case, load cost.
  5. **Wind 200 MW** (if a sensible bus exists), using the overnight floor.
- Each project has:
  - a narrative written for a client (2–3 sentences);
  - options with a reason for each choice, computed by the script, not hand-typed;
  - a basis;
  - 8–12 walkthrough steps across all 7 dashboards and all 3 depths, each with "what to look at" text that refers to real, script-computed numbers from the DB. Regenerate them with `python plan/build_samples.py`.
- `tests/smoke-samples.mjs` walks every step of every project: no console errors, no NaN, the expected trace present and reconciling.

## Done
- `node --test tests/*.test.mjs` is green, along with your smokes and trace gates. The Grid agent also keeps `gate-grid-allbus` green.
- Screenshots at all 3 depths × the relevant fuels for your tabs, which you look at yourself.
- A report of under 350 words: what was fixed or added, what is still not held and why, the gates, and requests for other owners.
