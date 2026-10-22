"""Jev arbitration: for each design point where the Claude spec pack and the Codex plan differ,
pick A (Claude), B (Codex) or C (merge). Generic product text only (sensitive=False).
Writes plan/jev_merge.json. Claude reconciles low-confidence picks in MERGED-PLAN.md."""
import json
import sys
from pathlib import Path

sys.path.insert(0, r"d:\Ganesh\90 System")
sys.path.insert(0, r"d:\Ganesh\90 System\agents")
from agents.decision_lane import decide, DecisionUnavailable  # noqa: E402

CTX = ("Product: a US power-grid siting analytics web app for renewable, storage and data-centre developers "
       "(ISO New England first, other regions later). Two plans exist for adding focused analyzer tabs with "
       "calculators to seven dashboards (Market, Land, Grid, Queue, Prices, Economics, Decision). Pick the option "
       "that gives the most correct, least misleading and most usable result for a developer making a siting decision.")

POINTS = [
    ("delivery", "Where should the new analyzers be built first?",
     {"A": "Inside the live app as add-on modules behind a tab layer",
      "B": "In a separate isolated preview app on its own address, leaving the live app untouched",
      "C": "Isolated preview first, then port proven modules into the live app"}),
    ("tabs", "How should each dashboard's analyzer tabs be organised?",
     {"A": "3-4 tabs grouped from existing cards, every existing card mapped to a tab, merged or hidden",
      "B": "Exactly 4 task-focused tabs per dashboard, each with inputs, 3 KPIs, one main chart and expandable calculation, assumptions and evidence",
      "C": "Codex's 4 task-focused tab layout, plus Claude's card map so no existing card is lost"}),
    ("years", "How should price year selection work?",
     {"A": "Price basis inherited from the scope bar; one year per scenario",
      "B": "An explicit analysis-basis drawer: historical or forecast mode, one or many years, duration/equal/custom weighting, strict coverage, audit of included years",
      "C": "Codex's analysis-basis drawer, plus Claude's one-bus-one-price and no-mixed-basis rules"}),
    ("headroom", "Which connection-capacity value should the Grid analyzer treat as governing?",
     {"A": "The element-study limit (lowest facility transfer), with the substation envelope shown as an unreconciled vendor alternative",
      "B": "Published envelope minus requested MW per case, with study coverage shown",
      "C": "Show both by case; the governing value is the element-study limit, flagged when the two disagree"}),
    ("queue_subtract", "Should nearby queued projects be subtracted from connection headroom?",
     {"A": "Yes, subtract not-in-model queued MW weighted by survival and distribution-factor ratio",
      "B": "Never subtract geographically nearby queue MW; show it as context only unless study participation is documented",
      "C": "Do not subtract by default; offer the weighted subtraction as a labelled what-if scenario"}),
    ("upgrade_cost", "How should the upgrade cost allocator work?",
     {"A": "Step function from study facility transfers and costs, share by distribution-factor proportional impact, labelled proxy",
      "B": "User-editable scope rows (direct, network, affected-system), named allocation scenario, known subtotal plus unpriced scope, no interpolation",
      "C": "Codex's editable scope and subtotal model, pre-filled from study facility costs, with the distribution-factor share offered as one named scenario"}),
    ("bess", "How should battery storage value be calculated?",
     {"A": "Daily top-n minus bottom-n price spread with round-trip efficiency, labelled perfect-foresight ceiling",
      "B": "Chronological state-of-charge dispatch with power, energy, efficiency and POI limits, labelled perfect-foresight benchmark",
      "C": "Chronological dispatch as the main result, with the spread ceiling shown only as a quick screening benchmark"}),
    ("hybrid", "How should hybrid solar-plus-storage be valued?",
     {"A": "Clipping recapture replaces grid charging; battery value counted once",
      "B": "One shared chronological energy balance with shared inverter and POI limits, no overlapping revenues",
      "C": "Codex's shared energy balance, with Claude's no-double-count and charging-deliverability checks as tests"}),
    ("finance", "How should project finance be handled?",
     {"A": "LCOE/NPV/IRR only when the user enters O&M, financing and tax inputs; otherwise not shown",
      "B": "Chronological annual cash flows from a named forecast path, NPV/IRR where defined, incomplete valuation when inputs are missing",
      "C": "Codex's chronological cash flows, with Claude's rule that no tax-credit or financing default is ever assumed"}),
    ("decision", "How should the Decision dashboard compare options?",
     {"A": "Weighted scorecard on ISO-wide percentiles plus gate verdicts where unknown is never a pass",
      "B": "Side-by-side raw metrics and requirements, optional preference score after compatibility checks, readiness actions and an immutable decision record",
      "C": "Codex's side-by-side comparison and decision record, with Claude's gate verdicts and tie band"}),
    ("missing", "How should missing or unstudied data be displayed?",
     {"A": "Not held / unknown with the reason; never zero; true zeros printed in units",
      "B": "Unknown stays unknown; material omissions produce incomplete results or known subtotals",
      "C": "Both: Claude's not-held/true-zero display rules plus Codex's incomplete-result and known-subtotal behaviour"}),
    ("visual", "Which visual design should the analyzers use?",
     {"A": "The existing dark-first app frame and tokens",
      "B": "A quieter light design: white surfaces, pale neutral background, dark slate text, one teal action colour, status colours always labelled",
      "C": "Codex's quiet light design with a dark theme option using the same tokens"}),
    ("order", "Which dashboards should be implemented first?",
     {"A": "By calculator priority: Market screening and Grid headroom first",
      "B": "Prices, then Grid, then Economics, because price years feed revenue and connection limits",
      "C": "Prices, Grid and Economics first (connected flow), then Market, Queue, Land and Decision"}),
    ("interconnection_rules", "How should interconnection rules (deposits, clocks, allocation) be encoded?",
     {"A": "Federal Order 2023 pro forma constants, labelled pro forma, ISO-specific amounts marked not held",
      "B": "A regional process profile per provider with effective rule version and source references; no single national formula",
      "C": "Codex's regional process profiles, seeded with the Order 2023 pro forma as the first labelled profile"}),
]


def main() -> int:
    out = []
    for key, q, opts in POINTS:
        try:
            d = decide(q, opts, context=CTX, kind="choice", sensitive=False, backend="jev")
        except DecisionUnavailable as e:
            print(f"{key}: Jev unavailable: {e}", file=sys.stderr)
            return 2
        pick = d.answer if d.answer is not None else d.best_guess
        out.append({"id": key, "question": q, "options": opts, "pick": pick,
                    "confidence": round(d.confidence, 3), "abstained": d.abstained,
                    "distribution": {k: round(v, 3) for k, v in d.distribution.items()}})
        print(f"{key:22} {pick}  conf={d.confidence:.2f}  {out[-1]['distribution']}")
    Path(__file__).with_name("jev_merge.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
