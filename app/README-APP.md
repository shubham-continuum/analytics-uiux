# GridSense Analyzer Studio: isolated preview

A separate, runnable copy of the seven-dashboard siting workflow, redesigned into four analyzer tabs per dashboard. It combines Claude's gated spec pack with Codex's plan and cores, merged point by point by Jev (`plan/MERGED-PLAN.md`).

**Open:** http://127.0.0.1:8104/analytics-analyzer-studio.html
**Start / stop:** `Start-Preview.ps1` / `Stop-Preview.ps1` (they control only this preview's own server).

## Five guided demo projects

Choose **Sample** in the top strip, then use **Analyzer** to jump among the 28 stops or **Next** to follow all seven dashboards. Each project has two or three bus options for comparison. The demos cover Cape Cod solar, 100 MW storage, solar-plus-storage, a 300 MW data centre, and Maine wind. The selected project, option, and calculator inputs survive a reload in the preview browser-storage namespace.

`data/samples.json` contains the complete walkthroughs, source notes, project-specific editable planning inputs and an explicit list of evidence still open. Observed 2025 RT prices, directional grid cases, solved-case queue records, and held regional land screens come from the read-only source datasets. Revenue, capital and O&M estimates, the offset site point, site control, land terms, route and line costs, permit timing, network-upgrade allowances where no priced subtotal is held, and dates are **illustrative assumptions**. Permit statuses remain unknown. Open **Demo inputs and evidence** in the walkthrough bar to see the formulas and provenance. Switching options updates the demonstrated revenue and site inputs while preserving user-edited values. A demo estimate never establishes a parcel, a signed contract, a final upgrade allocation or an approved interconnection study.

To regenerate the five projects from the read-only unified database, run `python plan/build_samples.py` from this folder. `node tests/smoke-samples.mjs` checks all five project records, 28 analyzer stops per project, the browser’s calculator inputs and option switching. The data file is committed with the preview, so browsing it does not require rerunning the builder.

## Isolation
- Local static server on :8104. POST is refused, and the CSP limits connections to itself.
- Browser storage uses the `gspreview.*` namespace.
- All data is read-only extracts in `data/`:
  - `snapshot.json`: hourly prices for 6 buses + hub, plus Grid constraints.
  - `study.json`: 2,678 buses.
  - `queue.json`
  - `land.json`
  - `flags.json`
- The live Studio (:8103) and its sources are never written. `baseline/original-hashes.json` (7,418 files) is re-checked after each dashboard.

## Dashboards (4 analyzer tabs each)

| Dashboard | Tabs | Core | Tests |
|---|---|---|---|
| Market | Find locations · Rank & compare · Size & robustness · Compare regions | `marketcore.js` | `market.test.mjs`, `smoke-market.mjs` |
| Land | Buildable area · Footprint & land cost · Connection corridor · Permits & site control | `landcore.js` | `land.test.mjs`, `smoke-land.mjs` |
| Grid | Connection capacity · Constraints & coverage · Upgrade cost allocator · Mitigation & phasing | `gridrules.js`, `grid.js` | `gridrules.test.mjs`, `grid-prices.test.mjs`, `smoke-grid.mjs` |
| Queue | Queue & cluster · Schedule & milestones · Cash & commitments · Changes & affected systems | `queuecore.js` | `queue.test.mjs`, `smoke-queue.mjs` |
| Prices | LMP & years · Basis & congestion · Shape & capture · Tails & spreads | `prices.js`, `solar.js`, `basis.js` | `solar.test.mjs`, `tz.test.mjs`, `smoke-prices.mjs` |
| Economics | Solar & wind revenue · BESS dispatch · Hybrid sizing · Project finance | `economics.js` | `economics*.test.mjs`, `smoke-econ.mjs` |
| Decision | Compare options · Stress test · Readiness & actions · Decision record | `decisioncore.js` | `decision.test.mjs`, `smoke-decision.mjs` |

## Interactions (every dashboard)
Shared layer: `charts.js` (bar, grouped bar, line, heatmap, gantt; hover tooltips and a Chart/Table toggle built from the same array) and `ui.js` (sortable tables, detail drawer, zoom/pan maps, focus restore).

| Dashboard | Interactions |
|---|---|
| Market | Zoomable map: click a bus to select it; layer toggles; "Show on map" from the tables |
| Land | Click a local equal-distance map to place the site; distance and line cost follow |
| Grid | Export-size slider; constraint rows open a drawer with loading meters |
| Queue | Request rows open a detail drawer; study-schedule gantt; cash-by-phase chart |
| Prices | Month × hour heatmap; live price-threshold slider on Tails |
| Economics | Sliders for capacity factor and losses (live) and for battery duration, round-trip efficiency and cycling cost (on release); dispatch week scrubber |
| Decision | Grouped bars of options across scenarios; "Go" buttons from missing evidence to the owning tab |

Keyboard: ←/→ moves between tabs, and Escape closes a drawer. Changing the URL hash also closes a drawer. `tests/smoke-interact.mjs` covers all of the above (18 checks).

**Run the checks:**
- `node --test tests/*.test.mjs`
- `TZ=America/New_York node --test tests/tz.test.mjs`
- `node tests/smoke-<name>.mjs`: needs the preview running; uses installed Chrome.

## New project · Add option · Project inputs

_Lifted from the live Studio (plan `design/14-lift-projects-configurator-continuum.md` §6, §6a; slice L1)._

**What it does.** A developer creates a project on any bus with the few inputs they know; the project then drives all seven dashboards through the same walkthrough code as the samples. The five samples stay in the same list, read-only, named "Dummy —" in the dev kit; **Duplicate as my project** makes an editable copy.

- **New project:** the Projects modal and the Ctrl-K palette; **New project here** on a bus (map tooltip, grid row, inspector, palette) pre-fills the bus.
- **Add option:** adds another bus to the current project from the map, the grid, the Ctrl-K palette or the pins; a bus appears once per project. Switching project or option feeds every dashboard; the link (`#project=…&option=…&cmp=…&pins=…`) reopens the same state.
- **Project inputs** (first inspector tab when a project is open): every field shows its level badge and a stated/default marker; the header counts "N of M stated". A rejected value is not applied and the reason is shown under the field. A change is written to the project, pushed into the dashboard state, and marks saved scenarios, decision records and pins built on the old value as stale with the reason ("Saved: field old → new; n findings now stale").

| Inputs | Feeds |
|---|---|
| Name (required), client type, notes | header, Decision record, export |
| Bus (required; any study bus) and more option buses | `options[]` → the bus every dashboard reads, Decision compare |
| Technology: solar, wind, storage, hybrid, data centre | `S.tech` |
| Export MW, import/charge MW, storage duration, DC nameplate (solar/hybrid) | `S.exportMW`, `S.importMW`, `ui.econ` |
| Target COD (required), interconnection service | `ui.fin.cod`, `ui.qCod`, `ui.qService` |
| Site lat/lon (defaults to the bus), land control, gen-tie miles, land status, profile availability | `ui.land` |
| Optional economics: capex, O&M, capacity factor, round-trip efficiency, discount rate, life | `ui.fin`, `ui.econ` |

**Defaults.** Unstated economics come from `rules/isone-2026/defaults.json` (block `defaults_atb2025`: NREL ATB 2025, Moderate case, national averages, status *assumption*); each carries that source on its card, exactly like the samples' illustrative inputs. No ATB entry exists for a data centre, so its economics read **not held**. Validation ranges are the live Studio's (`projects.js` `FIELDS` / `validateField`).

**Storage and data vintage.** Projects live in this browser (`localStorage` key `gsone.projects.v1`) with JSON import/export (live-schema projects import too); the server stays GET-only. The dashboards' data is unchanged: the unified DuckDB, as for the samples.

**Service dependency:** none. **Code:** `projects.js`, `views/project-inputs.js`. **Tests:** `tests/projects.test.mjs`, `tests/project-inputs.test.mjs`, `tests/smoke-projects.mjs`.

## Graph Configurator

_Lifted as-is from the live Studio's `window.Configurator` (slice L3); vendored in `vendor/live/configurator/` with reviewed patches F1–F3._

**What it does.** **Add analysis** on every stage header opens a builder for charts, KPIs and tables (chart type, Flip/Transpose, filters, aggregations). A saved analysis appears on its stage under **My analyses**, with Edit, Duplicate and Remove.

**Inputs.** Any field of the live field catalogue, at the bus in view, the pins and the compare set, for the horizon chosen in the builder. Analyses are saved in One Studio's state (per project or for all), persisted with the page.

**Defaults:** none; an empty or unsupported answer says what is missing, and a missing value reads **not held**, never 0.

**Data vintage — read this before comparing numbers.** The catalogue and every value the Configurator reads come from the **pinned `data.js` extract** of the live Studio (`vendor/live/app-data.json`, snapshot 2026-10-11), not from the unified DuckDB the seven dashboards read. Its vintage, in the extract's own words (`meta.source` · `meta.built_at`), is printed on every widget. The same quantity can therefore differ from a dashboard figure; rebinding the Configurator to the unified DB is an open decision (plan §4, §5.3).

**Service dependency:** none (a static file loaded once by `live-runtime.js`). **Code:** `views/configurator-host.js`, `live-runtime.js`. **Tests:** `tests/configurator.test.mjs`, `tests/smoke-configurator.mjs`.

## LMP Continuum

_Lifted from the live Studio's ext/59 (API client), ext/60 (screen host), ext/61–64 and ext/68 (slice L4); vendored in `vendor/live/continuum/` with patches C1 (host mount) and C2 (host CSS)._

**What it does.** A top-level **LMP Continuum** tab beside Analytics: settled price history beside the solved forecast on one axis, for the bus in view (else the load zone, else the hub). Workflow screens: Outlook, Drivers, Shape, Value, Offtake, Assumptions. **Analytics** returns to the seven stages.

**Inputs.** The bus in view, plus `case`, `hz` (focus year) and `hist` (settled hourly year) from the URL hash; the tab writes no URL itself (`studiohash.js` stays the only hash writer). Panel settings (scenario, fuel, market) are the Continuum's own.

**Defaults.** The Base scenario. The proxy scenarios (High Gas, Low Gas, High Load) and their factors are read from the service's `/api/v2/scenarios`; nothing is typed in.

**Data vintage.** The Continuum service's own: `dataset_version` on `/api/v2/scenarios` and the `vintage` block on `/api/v2/continuum/status` (the service reads the live Studio's derived Continuum views). One Studio has no full `cathy` data block, so ext/60's static screens (Price explorer, Hourly surface, Duration, …) show their written empty states; the API-backed panels are complete.

**Service dependency: the LMP Continuum service on 127.0.0.1:5034** (`--continuum-target`). The page's CSP is `connect-src 'self'`, so every request goes through One Studio's GET-only proxy `/api/proxy/continuum/…`, allow-listed to `/api/v2/scenarios*` and `/api/v2/continuum/*` (traversal 400, any other route 404). Service down → 502 and the banner "Continuum service not running" above the drawn Continuum, never a blank tab and never a silent fallback; `/health` shows the last proxy outcome. The Hourly timeline's `/api/v2/prices/hours` is outside the allow-list and answers the proxy's 404 reason. In the dev kit (`--fixtures`) the proxy replays the recorded answers by path + query and never forwards (`plan/export_fixtures.py` records them).

**Code:** `views/continuum.js`. **Tests:** `tests/continuum.test.mjs`, `tests/smoke-continuum.mjs` (against `tests/fake-continuum.mjs`, never the real :5034), `tests/test_proxy.py`, `tests/test_fixtures_continuum.py`.

## Rules the numbers follow (details in `plan/MERGED-PLAN.md`)
- **One bus, one price.** No mixed price bases. Forecast runs are never averaged. The Cape 5-yr offshore-wind run is flagged and held.
- **Missing values** read "not held", never $0. A true zero is shown only with evidence. A lower bound is written "≥".
- **Unknown never passes.** "No locations meet these requirements" never falls back to excluded buses.
- **Grid headroom** uses the element study, pending the source-of-record decision. Storage charging is checked at shoulder only. Upgrade cost is a step function with no interpolation.
- **Storage** value comes from chronological dispatch, which is a perfect-foresight ceiling. Spreads are benchmarks only.
- **Finance** has no defaults and stays incomplete until every input is entered.
- **Queue**: nearby requests are context and are never subtracted. Order 2023 pro forma is the only process profile, because ISO-NE Schedule 22 amounts are not held.

## Review record
Each dashboard was reviewed by an independent agent. Every High finding was fixed and re-checked before sign-off. The fix scripts are kept in `plan/fix_*.py`.

## Decisions still open (from the spec pack, `15-decisions-for-ganesh.md`)
1. Headroom source of record: element study vs substation envelope.
2. Gate-6 capture basis.
3. Proxy-bus prices in the exporter.
4. Data-centre binding rule.
5. Wiring the remaining gates.
6. Structural cuts.
7. Approval of exporter backlog item #15.
