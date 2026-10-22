# Build brief: corporate-grade analyzer dashboards (all agents read this first)

Goal (Ganesh, 2026-09-29):
- Every dashboard is fully connected to the dataset, and every calculation and function is fully built.
- The UI looks like an app, not a mockup: dense corporate layout with little empty space.
- Every tab has the relevant graphs AND tables.
- Include every important calculation, special graph and analysis that the live Studio has for that dashboard and that helps a client.
- These dashboards may later REPLACE the live Studio's.

## Hard rules
- **The live Studio is READ-ONLY.** It lives in `D:\Ganesh\02 Products\GridSense\analytics-portfolio-canvas-2026-09-11`. Read its code, screenshot http://127.0.0.1:8103/analytics-tab-studio.html#v=stage&stage=<stage>&project=kennebec&option=o2&depth=review&case=sp&hz=2030&hist=2025, and never edit anything there.
- **Preview:** `D:\Ganesh\02 Products\GridSense\analytics-analyzer-studio-preview\preview\`, served at http://127.0.0.1:8104. Never restart the server; if you add an `api_*.py` module it is imported on first request. If you CHANGE an existing api module, ask the coordinator in your report to restart the server.
- **Data:** the unified DuckDB `D:\Ganesh\02 Products\GridSense\unified\ISONE_GridSense_unified.duckdb`, read-only via `busdata.connect()`. Useful tables:
  - dim_bus, bridge_bus_pnode;
  - fact_lmp_hourly, fact_fcst_lmp_hourly;
  - mart_bus_year, mart_bus_month, mart_bus_hour, mart_bus_tb, mart_bus_da_rt, mart_bus_fcst_year, mart_bus_fcst_month, mart_bus_fcst_hour;
  - fact_headroom, fact_limiting_element;
  - fact_constraint_hourly, fact_pcr_binding_hourly, fact_pcr_cong_impact, fact_pcr_flowgate_hourly, fact_pcr_unit_hourly, fact_pcr_esr;
  - fact_genfuel_hourly, fact_load_hourly, fact_load_forecast, fact_interchange_hourly, fact_as_price_hourly;
  - dim_generator, dim_load, dim_branch, dim_transformer, dim_substation, dim_substation_upgrade, dim_transmission_upgrade, dim_retirement, dim_queue, dim_scenario, data_quality.

  Inspect the columns before using them.
- **New data endpoints:** create `api_<yourmodule>.py` with `ROUTES = {name: fn(conn, key)}`, where key is 'all', 'hub' or a bus id string. It is served at `GET /api/x/<yourmodule>/<name>/<key>` (gzip, cached). Use parameterised SQL only. Return None for "not held" → 404. See `api_demo.py`.
- **No invented numbers.** Every figure comes from the database or a computation over it. Null means "not held", never 0. Unknown never passes. Keep every rule already settled in review. The traps are recorded in the memory note `gridsense-analyzer-preview-build.md` and in PORTING.md §4.
- **Every new calculation gets a `trace()`** (trace.js):
  - a formula;
  - inputs with sources (measured / assumption / user / derived / rule);
  - steps with substituted numbers;
  - a check that is either independent or labelled "arithmetic re-check" / "consistency check";
  - a CSV of the working.

  If nothing can be checked, say "No check possible: <reason>".
- **Tests:** tests first for new core logic (`node --test`). Keep existing tests and gates green:
  - your dashboard's `tests/smoke-<k>.mjs`;
  - `node tests/smoke-traces.mjs <page> <tab:id,...>` (add your new trace ids);
  - plus smoke-allbus and smoke-interact.

  Playwright loads via `createRequire('D:/Ganesh/02 Products/GridSense/analytics-portfolio-canvas-2026-09-11/client/package.json')` and launches with `chromium.launch({channel:'chrome'})`. Node fetch fails on large bodies from this server, so use `node:http` + gunzip (see tests/market.test.mjs).
- Edit files with Write/Edit, never bash heredocs: heredocs with quotes and backslashes have corrupted files repeatedly.

## Use ALL the data (Ganesh, added mid-build)
Match or exceed the depth of the live Studio. Everything it shows for your dashboard should have a counterpart here, backed by real data.

The live Studio also reads data that is NOT in the unified DB:
- `analytics-portfolio-canvas-2026-09-11/studio/src/data.js` (GS_DATA);
- `studio/src/data-ext.js` (GS_DATA_EXT, e.g. per-bus `lmp_2030/2035/2050`, `p5/p95_2030`, `solar_cap_2030`, `wind_cap_2030`, `solar|wind|bess|dc_{100,250,500,1000}MW_2030`, `tb2/4/8_2030`, `basis_<zone>_2030`, `top_constraint`, `top_shadow`, `hneg_2025`, `h200_2025`, `cong_2025`, `rt_neg_2025`, loading tables, cost tables, queue_trends, exclusions);
- `D:\Ganesh\02 Products\GridSense\ISONE_GridSense.duckdb` (3.0 GB) and `ISONE_GridSense_agg.duckdb` (2.0 GB).

How to use them:
- You MAY read these READ-ONLY, e.g. `duckdb.connect(path, read_only=True)` inside your `api_<k>.py`, or a one-off extraction script under `preview/plan/extract_<k>.py` that writes `preview/data/<k>-*.json`.
- Never write to or edit those sources.
- Label every figure's provenance. Say "vendor/Studio copy (older database)" where it isn't the unified DB, and never mix two sources for the same number without saying so. One bus, one price: when the unified DB and the Studio copy disagree on the same quantity, the unified DB is primary, and you show the difference as a data note.
- Read `studio/DATA-EXT-CONTRACT.md` for field meanings.

## File ownership (never edit another agent's files)
| Agent | Owns |
|---|---|
| Shell/UI | `app.css`, `app.js`, `charts.js`, `ui.js`, `trace.js`, `fonts.css` (+ font files), `*.html` pages, `tests/shots-ui.mjs`, `tests/smoke-allbus.mjs`, `tests/smoke-interact.mjs` |
| Prices | `views/prices.js`, `views/prices-trace.js`, `prices.js`, `solar.js`, `basis.js`, `api_prices.py`, tests for these |
| Grid | `views/grid.js`, `views/grid-trace.js`, `gridrules.js`, `grid.js`, `api_grid.py`, `tests/gridrules.test.mjs`, `tests/grid-*.test.mjs`, `tests/gate-grid-allbus.mjs`, `tests/smoke-grid.mjs` |
| Economics | `views/economics.js`, `views/economics-trace.js`, `economics.js`, `dispatchgrid.js`, `dispatch-client.js`, `dispatch-worker.js`, `lcoe.js`, `api_economics.py`, tests for these |
| Market | `views/market.js`, `views/market-trace.js`, `marketcore.js`, `api_market.py`, tests for these |
| Queue | `views/queue.js`, `views/queue-trace.js`, `queuecore.js`, `api_queue.py`, tests for these |
| Land | `views/land.js`, `views/land-trace.js`, `landcore.js`, `api_land.py`, tests for these |
| Decision | `views/decision.js`, `views/decision-trace.js`, `decisioncore.js`, `api_decision.py`, tests for these |

- A dashboard agent may create NEW files named `views/<k>-*.js` (for example `views/grid-charts.js` for special SVG graphs), `api_<k>.py` and `tests/<k>-*.mjs`.
- If you need a change in someone else's file (a core you import, or a new chart type), don't make it. Implement it locally in your own new file, and list the request in your report.
- `busdata.py` and `server.py` belong to the coordinator: request changes, don't make them.

## Layout contract (the Shell agent implements the CSS; dashboard agents write markup to it NOW)
Dense app layout: 12-column card grid, compact cards, little whitespace, dark Studio theme (already tokenised in app.css).

- **Tab body:**
  ```html
  <div class="kpis">…</div>
  <div class="cards">
    <section class="card c-3|c-4|c-6|c-8|c-12"> … </section>
  </div>
  ```
  - `c-N` = spans N of 12 columns; below 900 px every card spans 12.
  - Optional `r-2` on a card = taller card (spans 2 rows).
- **Card:**
  ```html
  <section class="card c-6">
    <header class="card-h"><h3>Title</h3><span class="card-sub">one-line what/basis</span><div class="card-tools">…buttons…</div></header>
    <div class="card-b">…chart / table / content…</div>
    <footer class="card-f">source · caveat (optional)</footer>
  </section>
  ```
- **KPI:** keep the existing `kpi(label, value, unit, note)` markup. Add class `nh` on the `.kpi` when the value is "not held".
- **Tables:** inside `<div class="table-wrap">`. Use a compact class `table.dense` for data tables.
- **Traces:** keep them as `details.trace`, placed in a full-width card at the bottom of the tab: `<section class="card c-12 card-trace">`.
- **Notices:** `.notice`, `.notice.warn`, `.notice.error`, as now.
- **Charts:** existing `barChart`, `lineChart`, `groupedBar`, `heatmap`, `gantt` (charts.js; each gives a Chart/Table toggle and hover). The Shell agent ADDS these, with these exact signatures:
  - `stackedBar(groups:[{label, values:[..]}], {series:[names], fmt, title, height})`;
  - `areaChart(series:[{name, points:[{x,y}]}], {stacked:bool, fmt, xfmt, title, height})`;
  - `scatter(points:[{x, y, label, group}], {xLabel, yLabel, fmt, xfmt, title, height})`;
  - `histogram(values:[number], {bins, fmt, title, height})`;
  - `sparkline(values:[number], {height})` → inline SVG, no toggle;
  - `durationCurve(series:[{name, values:[number]}], {fmt, title, height})`.

  Until the Shell agent lands them (in about the first hour), guard with `typeof stackedBar === 'function'` or build on existing charts. Chart heights: default 220; use `height` so charts fill their card, not 260 px of blank space.

## What "done" means per dashboard
1. **Inventory:** read the live Studio's stage — its cards in `studio/src/app.js`, `ext/*.js` and `ext/2*-cards-*.js`, the card registry `W.register`, `ext/75-revenue.js`, `ext/86-lmp-years.js`, etc. — and screenshot it. List every calculation, chart and analysis it offers for your dashboard. Keep the ones that help a client decide, and note which data backs each.
2. **Build:** add those to your 4 tabs, backed by the unified database. Each tab needs:
   - a KPI row;
   - at least 2 relevant charts;
   - at least 1 relevant table;
   - a trace for each calculation.

   Dense card grid. No placeholder text or empty cards. Empty states explain what is missing.
3. **All-bus:** it must work for the candidate bus on direct, same_substation and geo_proxy tiers, and for buses without history (48) or without forecast runs (203).
4. **Verify:**
   - `node --test tests/*.test.mjs`;
   - your smoke and trace gates;
   - screenshots of all 4 tabs at 1440 and 390, which you look at yourself.

   Fix anything that looks mockup-grade.
5. **Report:** keep it under 350 words, covering:
   - what you added per tab, with the data behind it;
   - the Studio analyses you deliberately left out, and why;
   - test and gate results;
   - requests for other owners;
   - screenshot paths.
