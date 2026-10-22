# V6 brief: easier to use, every data source used, real maps and clean charts (2026-10-01)

Read these first:
- `plan/BUILD-BRIEF.md`: hard rules and file ownership. All of it still applies.
- `plan/V5-BRIEF.md`: the view contract (depth, fuel labels, `data-trace`/`data-chips`).
- the dataviz rules: `C:\Users\ADMIN\AppData\Local\Temp\claude\bundled-skills\2.1.284\6d33f30c46e74d8f874d85cadfa08a7b\dataviz\SKILL.md` and `references/anti-patterns.md`.

**Ganesh's ask:**
- improve the 7 dashboards' UI and functionality;
- make them easy for a user while providing all the data we hold;
- improve the map and graph design.

## Shared foundation (done by Claude; use it, don't fork it)
- **Shell:**
  - The chrome is now the live Studio's: `chrome.js` plus a read-only copy of the live CSS in `studio/studio.css`.
  - Your views render inside `.gsx-an`. `app.css` is scoped there; overrides go in `studio-bridge.css`.
  - **Never** add inline `<style>` blocks; ask the Shell for CSS.
- **Maps: `geomap.js`** (tests in `tests/geomap.test.mjs`).
  - It draws the live basemap (land, water, rivers, state/county lines and labels from public-domain Census/Natural Earth data in `data/basemap.json`), in the live projection.
  - API: `geoMap({ id, width, height, extent | fit:{points, padMi}, layers, legend, title })`. Layer kinds:
    - `points` `{lon, lat, r, cls, fill, tip, act, v, label}`;
    - `lines` `{a:[lon,lat], b:[lon,lat], cls: 'gm-net'|'gm-lim'|'gm-pre', w, tip}`;
    - `rings` `{center:[lon,lat], miles:[…]}`;
    - `labels`.
  - Legend: `{items:[{label, fill|cls, shape}]}` or `{ramp:{lo, hi, fmt, label}, nh:true}`.
  - Helpers: `rampColor(v, lo, hi)` (single-hue sequential; null renders as the not-held grey), `milesBetween`, `fitExtent`.
  - Zoom, pan and hover are automatic (`svg[data-map]`, `circle[data-r]`, `[data-tip]`).
  - Market's "Where the candidates are" is the reference implementation (`views/market.js` `map()`).
- **Charts (`charts.js`):**
  - Categorical colours are s1–s6 in fixed order; a 7th or later series folds into grey "other". Never put more than 6 series in one chart: facet or fold.
  - Grouped bars have a 2 px gap, stacked bars a surface gap, lines are 2 px.
  - **No dual axes** anywhere.
  - Text is never colour-only: a legend for 2 or more series, direct labels when there are 4 or fewer.
- **`percentileStrip(rows, {title})`** in charts.js (tests `tests/pstrip.test.mjs`): the live Studio's "Requirements at bus".
  - Rows: `{label, unit, value, pop:number[], ref, dir:'ge'|'le'}`.
  - Each row shows the value vs the ISO-NE population (P5–P95 band, median), the requirement tick, and Met / Not met / Unknown / Context.
  - Populations: `D.study.nodes` (after `/api/market`), or the decision population endpoint already used by Decision.
- **Answer-first cards.**
  - Put `<p class="card-answer">…</p>` as the first thing in a card body: one computed sentence answering the card's question (the live `.w-p`). Use `<b>` for the key numbers.
  - Never hand-type a number. If a value is not held, the sentence says so.
- **Compact:** KPI tiles and the guided-review bar are already compacted by the bridge CSS.

## What "easy for the user" means here (apply to every tab)
1. **Answer first.** Every card has a `card-answer` sentence. Every tab's first row is the KPI tiles plus the one key visual, so the answer is visible without scrolling at 1440×900 (Screen depth = that row only).
2. **Controls where they act.** Requirement and assumption forms collapse:
   - only the 2–4 controls a user changes most stay visible, in the card header tools or one compact row;
   - the rest go behind `<details class="more-ctl"><summary>More options</summary>…</details>`.
3. **Next step.** Every tab ends with one "Next:" action pointing to the dashboard or tab that uses this result (`data-act="goto" data-v=<stage> data-tab=<tab>`), named in words ("Next: test the connection in Grid › Connection capacity").
4. **Consistent visuals.**
   - A map for anything geographic, using `geoMap`: remove your own projection code.
   - A percentile strip for "this bus vs the market".
   - A bar or line for magnitude over a category or time.
   - A table twin for every chart (the existing Chart/Table toggle).
5. **All the data we hold.** Use the unused sources assigned below, and keep the provenance chips (`data-chips`). Null means not held; unknown never passes.

## Assignments

### Agent 1: Market + Land + Decision
- **Market:**
  - "Selected bus" becomes "Requirements at bus": a `percentileStrip` of every requirement at the request against all buses (headroom by case, kV, price 2025 and 2030, capture/TB4 by fuel, SC MVA, pre-existing issues), and it answers "k of n met".
  - Map polish: a colour-by-metric legend; the selected bus labelled.
  - Collapse the requirements form: zones, kV and price go in one row, everything else under More.
- **Land:**
  - Replace `siteMap` (`views/land-charts.js`) with `geoMap`: the bus, the site point (click-to-place must keep working), distance rings, stations by status, and the exclusion area if held.
  - The site click handler in app.js reads `svg[data-site-map]` attributes; keep those on the new svg, or ask the Shell to adapt the handler.
- **Decision:**
  - `optionMap` → `geoMap`, with options labelled and linked queue requests.
  - Compare tab: a per-option `percentileStrip` on the deciding measures (`positionTable` already computes the percentiles).
  - Answer sentences on every card.

### Agent 2: Grid + Queue
- **Grid:**
  - NEW "Network around the bus" map (`geoMap`): every `dim_branch` within ~15 mi as `gm-net` lines, with endpoints from the `dim_bus` latitude/longitude; your gridext API can serve it.
  - Highlight this bus's limiting facilities from `fact_limiting_element` (`gm-lim`), and pre-existing overloads (`gm-pre`).
  - Tooltips: facility, kV, rating, loading, DFAX, case.
  - Selecting a constraint row highlights its line.
- **Queue:** `queueMap` → `geoMap`, keeping rings and request points by status/fuel.
- **Both:** answer sentences, compact controls, Next links.

### Agent 3: Prices + Economics
- **Prices: `fact_lmp_5min`** (unused). 5-minute LMP for the hub and 8 load zones, 2026-01-01 → 2026-07-01.
  - Add a "Within the hour" card to Tails & spreads (storage/hybrid/DC especially):
    - the bus's load zone, 5-min vs hourly-average price;
    - intra-hour range distribution;
    - 5-min intervals above $X;
    - the value a 5-minute-responsive battery sees above the hourly TB4.
  - Label it "zone-level, 2026 H1 only".
- **Economics: `fact_pcr_esr` + `dim_pcr_resource`** (unused). Hourly dispatch and SOC for the 26–34 batteries modelled in PCR 2030/2035/2040.
  - Add a "How the market model runs storage" card to Storage revenue: modelled batteries within X mi (or the zone):
    - cycles per day;
    - the realised spread per MWh (dispatch × LMP);
    - SOC use;
    - compared with our perfect-foresight ceiling.
  - Market saturation context: modelled storage MW per zone, by run.
- **Both:** answer sentences, compact assumption forms (More options), Next links, and a chart review against the dataviz rules.

## Gates (each agent)
- `node --test tests/*.test.mjs` green (tests first for new pure logic).
- Your smokes + `smoke-allbus`, `smoke-parity`, `smoke-samples` ALL PASS.
- `node tests/css-leak.mjs <your stages>` → NO LEAKS.
- Screenshots of every tab at 1440×900, Review depth, for the relevant fuels. Look at them and check:
  - the answer is visible above the fold;
  - no overlapping labels;
  - maps show the basemap.
- Report in under 300 words: what changed, what data was added, anything not held, and requests for the Shell.
