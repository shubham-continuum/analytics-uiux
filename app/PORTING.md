# GridSense Analyzer → live Studio: porting guide

_Status: plan only; nothing has been ported (2026-09-29).
- `P` = `D:\Ganesh\02 Products\GridSense\analytics-analyzer-studio-preview\preview` (preview root).
- `C` = `D:\Ganesh\02 Products\GridSense\analytics-portfolio-canvas-2026-09-11` (canvas root).
- The live Studio is `C\studio`, built to `dist/analytics-tab-studio.html` and served at :8103. Its API runs at :5034 from `C\run_pro.py`._

## 1. Per dashboard

Each dashboard is one `views/<k>.js`, plus `views/<k>-trace.js`, plus its cores. All of them share `basis.js`, `charts.js`, `ui.js` and `trace.js`.

| Dashboard | Port unit | Data | Hand-offs (`S.handoffs.*`) | Trace ids | Tests that must pass |
|---|---|---|---|---|---|
| Prices | `views/prices.js`, `prices-trace.js`, `prices.js`, `solar.js`, `basis.js` | `/api/bus/<id>` + `/api/bus/hub`; `data/flags.json` | writes `prices` | p-mean p-dist p-basis p-comp p-capture p-tails | `solar`, `tz` (TZ=America/New_York), `trace` tests; `smoke-prices`, `smoke-prices-trace` |
| Grid | `views/grid.js`, `grid-trace.js`, `gridrules.js`, `grid.js` | bus grid.headroom + grid.constraints | writes `grid`, `cost` | g-capacity g-constraints g-cost g-mitigation | `gridrules`, `grid-prices` tests; `smoke-grid`; **`gate-grid-allbus.mjs <dump>`** (2,678 buses × 3 services) |
| Economics | `views/economics.js`, `economics-trace.js`, `economics.js`, `dispatchgrid.js`, `dispatch-client.js`, `dispatch-worker.js`, `lcoe.js` | bus series + grid; `S.basis` | reads `grid`, `prices`, `cost`, `revenue`; writes `revenue` | e-revenue e-bess e-hybrid e-finance | `economics`, `economics-review`, `lcoe`, `dispatchgrid` tests; `smoke-econ`, `smoke-econ-trace` |
| Market | `views/market.js`, `market-trace.js`, `marketcore.js` (+ gridrules) | `/api/market` → `prepare()` | `pick-bus` → Grid | m-find m-rank m-size m-regions | `market.test.mjs` (needs the server), `smoke-market` |
| Queue | `views/queue.js`, `queue-trace.js`, `queuecore.js` | `data/queue.json`, bus grid | reads `cost` | q-cluster q-schedule q-cash q-changes | `queue.test.mjs`, `smoke-queue` |
| Land | `views/land.js`, `land-trace.js`, `landcore.js` | `data/land.json`, bus lat/lon | none | l-area l-footprint l-corridor | `land.test.mjs`, `smoke-land` |
| Decision | `views/decision.js`, `decision-trace.js`, `decisioncore.js` | up to 3 bus payloads (`ctx.ensureBus`), queue + land | reads `grid`, `cost`, `revenue` | d-compare d-stress d-readiness | `decision.test.mjs`, `smoke-decision`, `smoke-decision-allbus` |

Cross-cutting tests: `tests/test_busdata.py`, `smoke-allbus`, `smoke-interact`, `smoke-traces.mjs <page> <tab:id,…>`.

## 2. Mount contract

**Hook into the live Studio.**
- `Views.stage(host, c)` is defined at `C\studio\src\app.js:1280`. Wrap it the way `ext/77-decision.js:259-267` does: `origStage.call(this, host, c)`, then append the analyzer.
- Map the Studio context to preview state:
  - `c.node.bus_id` → `S.nodeId`;
  - `c.fuel` (solar | wind | bess | hybrid | dc) → tech, via the inverse of `landcore.FUEL_KEY`;
  - `c.size` + `c.direction` → `exportMW` / `importMW`.
- Do **not** use `W.register`: the analyzer is a tab panel, not a card.

**Render call.** `render(tab, { data: D, S, node, ensureBus, busReady })`.

The shell must do the following, in this order:
1. `resetCharts(); resetTraces();`
2. `ensureBus('hub'); ensureBus(S.nodeId)`.
3. Reset the price basis when it belongs to another bus.
4. Load the `ensureStudy`, `ensureQueue` and `ensureLand` data according to the view's `needs*` flags.
5. Insert the HTML.
6. `mountCharts / mountTables / mountMaps / restoreFocus`.
7. Re-open the traces the user had expanded.
8. Wire `setOnReady(render)`; without it, battery results never appear.

**Shape of `D`:** `{metadata, nodes[], series[], grid:{headroom[], constraints[], source}, index[], flags, study?, queue?, land?}`.

**ACTIONS** are delegated on `[data-act]`:
- **Shared:** `tab goto goto-where node node-find tech export import ui ui-text trace-csv pick-bus`, plus the scenario actions.
- **Prices:** `basis-* apply-basis include-partial handoff-prices`.
- **Grid:** `grid-size alloc alloc-reset handoff-grid handoff-cost`.
- **Economics:** `econ fin handoff-revenue handoff-bess`.
- **Market:** `mkt mkt-zone mkt-shoulder mkt-own mkt-pri map-*`.
- **Queue:** `q-whatif q-flag`.
- **Land:** `land land-permit`, plus the site-map click.
- **Decision:** `d-add d-remove d-opt d-form add-action toggle-action record-decision`.

**CSS.** The preview uses a light theme; the live page is `html.dark`. Scope every analyzer rule under one root class (`.gsx-analyzer`), or it will re-skin the Studio.

## 2b. Studio-parity surface (v5, 2026-09-30)

The preview chrome now mirrors the live Studio, so a port replaces only the stage body.

- **URL.** `studiohash.js` (unit-tested) reads and writes the live vocabulary in the live order:
  - `v, stage, project, option, depth, case (sp|sh|ll), hz, hist, cmp (option ids), pins (bus ids)`;
  - the preview keys `tab, bus, step` follow them.

  The exact live URL round-trips. `liveStudioUrl()` builds the :8103 link. Fuel keys: `storage ↔ bess`, `datacenter ↔ dc`.
- **Study basis.**
  - `case` is the Grid focus case (`ctx.caseKey` / `ctx.caseScenario`); requirements still test every case the fuel needs.
  - `hz` applies that year's PCR run as the price basis (2045/2050 are not held).
  - `hist` applies that RT year.
  - One basis at a time, so the one-bus-one-price rule holds.
- **Projects.** The live `project`/`option` map to `data/samples.json` (kennebec o1/o2 mirror the live demo).
- **Chrome** is in the same place as the live Studio's:
  - top bar;
  - scope strip (fuel · size · case · horizon · history · depth · Guided review);
  - numbered stage strip, where the dot = the hand-off state from `ui.handoffStates`;
  - project strip plus SELECTION chips (`ui.selectionChips`);
  - tool rail;
  - status bar.

  The shortcuts are the live ones: `d`, `g`, `1–7`.
- **Card grammar.** `ui.decorateCards(root)` adds (i) → trace (raising depth to Study when needed), expand, and provenance chips, all from `data-trace` / `data-chips` on each card. At port time the live Studio's own card header can call the same hooks.
- **Inputs & evidence** (modal) lists the basis, the hand-offs with their state, the sample's inputs and provenance, and the open decisions.

## 2c. Live chrome and stylesheet (v6, 2026-10-01)

The preview now **is** the live chrome: it draws the same markup and loads the live stylesheet.

- **Stylesheet.**
  - `studio/studio.css` is a read-only copy of the live `src/styles.css` + `ext/*.css`, in build order (`python plan/extract_studio_css.py`; source hashes in `studio/studio-css-manifest.json`).
  - `app.css` is scoped under `.gsx-an` (analyzer body) and `.gsx-layer` (modals, drawers, toast) with `plan/scope_app_css.py`. It keeps only the `:root` tokens the live stylesheet does not define, so the live values win.
  - `studio-bridge.css` puts analyzer cards into the live card grammar and repairs the live rules that leak.
- **Markup.** `chrome.js` renders the live `header.hdr`, `aside.sb`, `div.scope`, `nav#gsf-stages`, `.bhead`, `.gswf-kill`, `.summary`, `.gswf-sel`, docks and `footer.sfoot`, including the live `data-gswf` / `data-gsf` hooks the live CSS keys on.
  - Analyzer cards get `section.w > .w-h > h3.w-q + .w-tools` and `.w-badges` from `ui.decorateCards`.
- **Gates.**
  - `tests/chrome-parity.mjs <stage>` compares about 50 chrome elements' geometry and computed style, live against preview, on the same link. 95–96% of measurements are identical on every stage; the rest are content widths and data states.
  - `tests/css-leak.mjs` measures every analyzer element with the live sheet on and off, keeping its tokens and type, and reports NO LEAKS.
- **Port consequence.** In the live app, step 1 is to drop `chrome.js` and the live-CSS copy, and mount `.gsx-an` inside the live `#board` after `.gswf-sel`. The scoped `app.css` + `studio-bridge.css` come along unchanged.

## 3. Data layer

Move the endpoints to :5034 as a Flask blueprint, `C\concern_analyzer_api.py`, registered in `run_pro.py`: `GET /api/v2/analyzer/{buses, bus/<id|hub>, market, screen}`.

- Port `busdata.py` unchanged apart from `SOURCE` (the unified DuckDB) and `CACHE` (`C\outputs\analyzer-cache`).
- Keep the database read-only, with one connection under a lock.
- Keep the gzip cache keyed by the database's modification time.
- Add CORS using the `STUDIO_ORIGINS` pattern, because :8103 → :5034 is cross-origin.
- Port `test_busdata.py` along with the data layer.

## 4. Known differences from the live Studio

- **Data source.**
  - The live Studio reads `data.js` + `data-ext.js` (GridSense_one.duckdb). It caps element lists at the top 12 per case and flips the run congestion sign in `ext/05-run-sign.js`.
  - The preview reads the unified DB with full `fact_limiting_element` rows and normalises the sign once, at extraction.
  - The same bus can therefore differ: 104330 binds at 130.7 MW vs 166.4 MW in the study copy.
- **Grid rules after review:**
  - element-study limits govern;
  - base-case rows are screened on rate A with the base flow;
  - pre-existing = |loading| ≥ 100%;
  - a $0 cost on a zero-length facility counts as not held;
  - cost statuses: True zero (element evidence in every case) · No upgrades indicated (envelope-only) · Lower bound · Priced · Partly priced;
  - data-centre cost unions the large-load and summer-peak charge cases.
- **LCOE** comes from `lcoe.js` and includes construction years.
- **Battery SOC grid** is sized by `dispatchgrid.js`, solved with a band-limited DP in a Worker, with a 20 s budget.
- **Market v2** reads `/api/market` and must equal Grid `caseTable` for every bus.
- **Decision.** The live `ext/77` has its own record model. Do not merge it with the preview's `buildRecord`.

## 5. Ordered checklist

- **Gate 0: data layer.** The blueprint is up; `test_busdata.py` passes; `/bus/111403` returns gzip; `/bus/999999999` returns 404.
- **Gate 1: shell.** `ext/90-analyzer-shell.js/.css` wraps `Views.stage` and owns `S`, ACTIONS, the render loop and the worker.
- **Per dashboard**, in `ext/91…97-analyzer-<k>.js`, in the order Prices → Grid → Economics → Market → Queue → Land → Decision:
  1. Hash `C\studio` before and after. Only the new ext file and `dist/` may differ.
  2. Unit tests pass.
  3. The trace gate passes on own-node, same-substation and borrowed-price buses.
  4. Grid only: `gate-grid-allbus.mjs` passes.
  5. The Playwright smoke passes against :8103 with 0 console errors, and the screenshots are reviewed.
  6. `tools/studio_build.py --check` still round-trips.

## 6. Risks

- **CSP and the Worker.** The live dist is one HTML file of inline classic scripts. The preview uses ES modules, and `new URL('./dispatch-worker.js', import.meta.url)` does not work inline. Either bundle the cores to an IIFE and build the worker from a Blob URL, or ship them as real modules. If a CSP is added, it needs `worker-src 'self' blob:` and `connect-src http://127.0.0.1:5034`.
- **Payload size.** Each bus is about 2.8 MB, and `busLoad` never evicts. Decision can hold 3 buses + the hub, on top of the ~28 MB `data-ext.js`. Evict or cap.
- **Tests and undici.** Node's `fetch` asserts on large HTTP/1.0 bodies, so keep the `node:http` helper while tests hit :8104. Waitress (:5034) speaks HTTP/1.1.
- **localStorage.** Use `gs.analyzer.v1`. Never write into the live `gs.analytics.studio.v1`: both have `S.basis` and `S.stage`, with different meanings.
- **Routing.** The preview rewrites `location.hash`. The live app owns the URL, so keep tab state in `S.tabs`.
- **Render scope.** Render into, and delegate events on, the analyzer host only, not `#app`.
- **Open decisions.** The headroom source of record and the treatment of proxy-bus prices are unresolved. The port must not silently pick one.
