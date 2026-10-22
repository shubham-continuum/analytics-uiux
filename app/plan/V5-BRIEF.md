# V5 brief: finish v4 per dashboard, ready to drop into the live Studio chrome (2026-09-30)

Read `plan/BUILD-BRIEF.md` (the hard rules and file ownership) and `plan/GAP-BRIEF.md` (your v4 items) first. Everything there still applies. This brief adds what changed and the contracts the Shell (Claude) is building in parallel.

## Already done: don't redo
- **Codex (after the v4 agents hit the limit):**
  - `data/samples.json`: 5 projects (kennebec solar, storage, hybrid, campus DC, downeast wind), 28 steps each;
  - the walkthrough bar in `app.js`;
  - depth filtering (`[hidden]` on cards whose `data-depth` is above `S.depth`);
  - pins;
  - `smoke-samples.mjs` ALL PASS.
- **Claude (this session):**
  - `decisioncore.fuelVerdict` / `thresholdsFor` / `fuelMetrics` / `fleetShapeFor` / `captureRatio` in `decisionfuel.js`, re-exported by decisioncore;
  - gate 6 Capture;
  - Load cost evidence for the DC;
  - hybrid PV revenue;
  - wind fleet shape in `revenueFor`;
  - `marketcore` upgrade + curtailment screens in `evaluate`/`requirementChecks`;
  - `WEIGHT_PRESETS`/`weightPreset`;
  - queue material-mod wording;
  - `trace.listTraces()`.
- The unit suite is 305/305 green. Keep it green.
- `views/prices-fuel.js` (pure calculations, tested) exists but is NOT used by `views/prices.js` yet.
- `views/prices-ui.js` has the card/kpi/notApplicable helpers with depth.

## View contract (every view, every card)
1. **Depth.** Every `<section class="card …">` carries `data-depth="screen|review|study"`, the MINIMUM depth at which it shows.
   - Screen: the KPI row plus one key chart.
   - Review: evidence cards.
   - Study: element rows, dispatch, finance and traces.
   - Read `ctx.S.depth` and skip Study-only fetches below Study.
2. **Fuel.**
   - Tabs may provide `labelFor(tech)`, e.g. Economics tab 1: `'Load cost'` for a data centre and `'Storage revenue'` for storage.
   - Every tab renders fuel-appropriate content. For anything not meaningful, use `notApplicable(...)` (prices-ui.js pattern) with the reason. Never show a solar calculation for a load.
3. **Decorator hooks** (the Shell adds the header icons from these):
   - `data-trace="<trace id>"` on a card whose headline number has a trace; the (i) icon scrolls to and opens it;
   - `data-chips="studio-copy modelled assumption geo-proxy not-held envelope-only"` (space-separated provenance, any subset).
4. **Presets** (optional). The view object may export `presets: { base:{…}, conservative:{…}, aggressive:{…} }`, applied onto `S.ui.<yourKey>` by the shell's `preset` action. Values must be cited or labelled "assumption".
5. **Layout.** Keep the layout contract (`.cards` / `.card.c-N` / `.card-h/-b/-f`, `.kpi`, `table.dense`). No inline style blocks; use the app.css classes.

## Hard rules repeated
- **The live Studio is READ-ONLY.** Do not edit shell files (`app.js`, `app.css`, `ui.js`, `charts.js`, `trace.js`, `*.html`): Claude is editing them now. If you need a shell change, request it in your report.
- Tests first for new core logic. No invented numbers. Null is not held. Unknown never passes. Every new calculation gets a `trace()` with a check.
- Don't regress the settled rules:
  - True zero / No upgrades indicated / Lower bound;
  - base-case rate A;
  - shoulder-only storage charge;
  - DC unions large load + summer-peak charge;
  - Connect Holds on envelope-only;
  - Queue never Passes;
  - Land clear block = habitat/protected only.
- Edit with Write/Edit, never bash heredocs.
- **Verify** with:
  - `node --test tests/*.test.mjs`;
  - your `tests/smoke-<k>.mjs`;
  - `node tests/smoke-traces.mjs <page> <tab:id,...>`;
  - smoke-allbus.

  Take screenshots of your tabs at screen/review/study × the relevant fuels (`#stage=<k>&tab=<t>&bus=111403&depth=<d>`, tech via the top-bar select or `S.tech`) and LOOK at them.
- **Report** in under 300 words: what was done, what is not held and why, the gates, and requests for the Shell.
