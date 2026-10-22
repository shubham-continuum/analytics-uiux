# Merged plan: Claude spec pack × Codex plan (Jev-arbitrated)

**Sources**
- Claude: `../../../Studio Analyzer Plan 2026-09-29/` — gated spec pack; formulas in `10`; decisions in `15`.
- Codex: its plan text (2026-09-29, pasted by Ganesh) and the started build in this folder (cores `prices.js`, `grid.js`, `economics.js`; 25 passing tests; hourly snapshot).
- Arbitration: `jev_merge.py` → `jev_merge.json`. For each point Jev picked A (Claude), B (Codex) or C (merge). Picks below 0.8 confidence are reviewed by Claude below.

## Decisions

| Point | Jev | Conf | Final | Reason for final, where Claude reviewed |
|---|---|---|---|---|
| Delivery | C | 0.56 | **C: isolated preview first (`:8104`), then port proven modules to the live Studio** | Ganesh asked not to disturb the live app; porting reuses the tested cores |
| Tabs | C | 0.63 | **C: Codex's 4 task tabs per dashboard, plus Claude's 149-card map** so no legacy card is lost (each maps to a tab's evidence drawer or the legacy view) | — |
| Years | B | 0.58 | **C (override): Codex basis drawer + Claude's one-bus-one-price / no-mixed-basis rules** | Stage 1 found live defects from mixed bases (PR-1/2/3); the drawer alone does not stop them |
| Headroom | C | 0.93 | **C: show envelope and element limit by case; governing = element-study limit; flag disagreement** | Pending Ganesh G-1 |
| Queue subtraction | C | 0.90 | **C: no subtraction by default; weighted subtraction is a labelled what-if** | — |
| Upgrade cost | C | 0.50 | **C: Codex editable scope and subtotal model, pre-filled from study costs; DFAX share offered as one named scenario; no interpolation** | Both reviews agreed on no interpolation |
| BESS | C | 0.90 | **C: chronological SOC dispatch is the result; the spread ceiling is a screening benchmark only** | — |
| Hybrid | C | 0.61 | **C: shared energy balance plus no-double-count and charging-deliverability tests** | — |
| Finance | B | 0.60 | **B, with Claude's no-default-tax rule** (Codex already requires explicit tax assumptions) | Equivalent |
| Decision | B | 0.74 | **B: raw side-by-side, readiness actions, immutable record, plus "unknown never passes"** (in both plans) | — |
| Missing data | C | 0.65 | **C: not-held / true-zero display plus incomplete result and known subtotal** | — |
| Visual | B | 0.73 | **B: quiet light design** (white, pale neutral, slate, one teal action) | Preview only; the live dark theme is unchanged |
| Order | C | 0.76 | **C: Prices → Grid → Economics, then Market → Queue → Land → Decision** | — |
| Interconnection rules | B | 0.61 | **C (override): regional process profiles, seeded with the Order 2023 pro forma as a labelled "federal pro forma" profile** | ISO-NE Sch. 22 amounts are not held; with no seed the calculator would be empty |

## What each dashboard gets (4 tabs each)

| Dashboard | Tabs (Codex names) | Calculators and rules carried from Claude's pack |
|---|---|---|
| **Prices** | LMP & years · Basis & congestion · Shape & capture · Tails & spreads | §P1–§P5; settled sign E+C+L (the snapshot negates PROBE C); both < 0 and ≤ 0 counts; partial 2026 excluded unless opted in; forecast runs never mixed |
| **Grid** | Connection capacity · Constraints & coverage · Upgrade cost allocator · Mitigation & phasing | §G1 case rules (storage charge at shoulder only; CCIS ≤ NCIS; large load = min(LL, SP-chg)); element-limit flag; "No Violations found" handling; §G4 step at studied sizes only; §G5 surplus as a mitigation |
| **Economics** | Solar & wind revenue · BESS dispatch · Hybrid sizing · Project finance | §E1 revenue stack (capacity conditional on CCIS; REC by market); Codex SOC dispatch; §E2 spread shown as benchmark; charging gate |
| **Market** | Find locations · Rank & compare · Size & robustness · Compare regions | §M1/§M2 null ≠ 0; anomaly exclusion; "No locations meet these requirements" |
| **Queue** | Queue & cluster · Schedule & milestones · Cash & commitments · Changes & affected systems | §Q2 mature-vintage P(COD); §Q3 pro forma profile; no double-counting of deposits vs capital |
| **Land** | Buildable area · Footprint & land cost · Connection corridor · Permits & site control | §L1–§L3; site location NH until placed |
| **Decision** | Compare options · Stress test · Readiness & actions · Decision record | §D2 unknown ≠ pass; tie band; stale evidence |

## Build rules
1. Everything lives in `preview/`. The live Studio (`:8103`), its sources and data are never written; hashes are checked against `baseline/original-hashes.json`.
2. Pure cores (`prices.js`, `grid.js`, `economics.js`, …) are tested in Node first. Views are separate (`views/*.js`).
3. Numbers come from `data/snapshot.json` / `study.json` (local, read-only extracts). There is no network write, and CSP limits connections to self.
4. Dashboards not yet redesigned link to `legacy.html` (the copied Studio, isolated to `:5035` and `gspreview.*` storage).
5. Each dashboard ships only when its core tests pass, a Playwright smoke passes (0 console errors, tabs render, KPIs match core output), and a reviewer agent passes it.
