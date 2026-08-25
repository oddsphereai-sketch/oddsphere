#!/usr/bin/env python3
"""Frozen 2023-selection / 2024-25-confirmation NFL Total provisional-Lean pass."""

from __future__ import annotations

import itertools
import json
import pathlib
import time
from dataclasses import asdict, dataclass
from typing import Any

import joblib

import tournament_nfl_spread_total_grading_r1 as r1
import tournament_nfl_spread_total_pragmatic_v2 as pragmatic
import tournament_nfl_spread_total_residual_blend_r3 as residual


TOURNAMENT_RELEASE = "nfl_total_provisional_lean_tournament_2026_08_24_v1"
SELECTION_SEASON = (2023,)
CONFIRMATION_SEASONS = (2024, 2025)
PROBABILITY_FLOORS = (0.60, 0.625, 0.65)
EV_FLOORS = (0.00, 0.02, 0.04)
EDGE_FLOORS = (3.0, 4.0, 5.0)
CUSHION_FLOORS = (1.0, 1.5, 2.0)
DIRECTIONS = ("both", "over", "under")


@dataclass(frozen=True)
class TotalRule:
    minimum_probability: float
    minimum_ev: float
    minimum_edge_pp: float
    minimum_cushion: float
    direction: str


def select(rows, rule: TotalRule):
    direction = rows["side"].isin(("over", "under")) if rule.direction == "both" else rows["side"].eq(rule.direction)
    selected = rows[
        rows["market"].eq("total")
        & rows["baseHealth"]
        & rows["directionCoherent"]
        & rows["looOtherBookCount"].ge(2)
        & rows["price"].between(-200, 200, inclusive="both")
        & rows["probability"].ge(rule.minimum_probability)
        & rows["expectedValue"].ge(rule.minimum_ev)
        & rows["edgePp"].ge(rule.minimum_edge_pp)
        & rows["cushion"].ge(rule.minimum_cushion + rows["cushionPenalty"])
        & direction
    ].copy()
    return r1.reduce_best_offer(selected)


def selection_passes(summary: dict[str, Any]) -> bool:
    gap = summary["calibration"]["absoluteGap"]
    return bool(
        summary["actions"] >= 12
        and summary["units"] > 0
        and summary["roi"] is not None and summary["roi"] > 0
        and summary["unitsWithoutLargestWin"] > 0
        and summary["meanClv"] is not None and summary["meanClv"] >= 0
        and gap is not None and gap <= 0.10
    )


def confirmation_gates(summary: dict[str, Any], bootstrap: dict[str, Any]) -> dict[str, bool]:
    by_season = summary["bySeason"]
    pooled_gap = summary["calibration"]["absoluteGap"]
    return {
        "minimumCounts": all(by_season[str(season)]["actions"] >= 8 for season in CONFIRMATION_SEASONS),
        "positiveEachSeason": all(by_season[str(season)]["units"] > 0 for season in CONFIRMATION_SEASONS),
        "largestWinIndependentPooled": summary["unitsWithoutLargestWin"] > 0,
        "nonnegativeMeanClv": summary["meanClv"] is not None and summary["meanClv"] >= 0,
        "calibration": pooled_gap is not None and pooled_gap <= 0.10,
        "bootstrapPositive": (
            bootstrap["probabilityPositiveUnits"] is not None
            and bootstrap["probabilityPositiveUnits"] >= 0.65
        ),
    }


def rank_key(candidate: dict[str, Any]) -> tuple[Any, ...]:
    summary = candidate["selectionSummary"]
    rule = candidate["rule"]
    direction_rank = {"under": 2, "over": 1, "both": 0}[rule["direction"]]
    return (
        summary["unitsWithoutLargestWin"],
        summary["meanClv"],
        -summary["calibration"]["absoluteGap"],
        summary["actions"],
        rule["minimum_probability"],
        rule["minimum_ev"],
        rule["minimum_edge_pp"],
        rule["minimum_cushion"],
        direction_rank,
    )


def main() -> None:
    root = pathlib.Path.cwd()
    cached = joblib.load(root / "football-research/cache/nfl-model/nfl_spread_total_offer_rows_2021_2025.joblib")
    rows = cached["rows"]
    total_universe = rows[rows["market"].eq("total")]
    candidates = []
    for values in itertools.product(PROBABILITY_FLOORS, EV_FLOORS, EDGE_FLOORS, CUSHION_FLOORS, DIRECTIONS):
        rule = TotalRule(*values)
        chosen = select(rows, rule)
        selection_summary = pragmatic.summarize(chosen, SELECTION_SEASON, total_universe)
        candidates.append({
            "rule": asdict(rule),
            "selectionPassed": selection_passes(selection_summary),
            "selectionSummary": selection_summary,
        })

    eligible = [candidate for candidate in candidates if candidate["selectionPassed"]]
    selected = max(eligible, key=rank_key) if eligible else None
    confirmation_summary = None
    bootstrap = None
    gates = None
    qualified = False
    if selected is not None:
        frozen_rule = TotalRule(**selected["rule"])
        selected_rows = select(rows, frozen_rule)
        confirmation_summary = pragmatic.summarize(selected_rows, CONFIRMATION_SEASONS, total_universe)
        bootstrap = r1.weekly_bootstrap(selected_rows[selected_rows["season"].isin(CONFIRMATION_SEASONS)])
        gates = confirmation_gates(confirmation_summary, bootstrap)
        qualified = all(gates.values())

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "predeclaration": "docs/model-audits/2026-08-24-nfl-total-provisional-lean-predeclaration.md",
        "selectionSeason": list(SELECTION_SEASON),
        "confirmationSeasons": list(CONFIRMATION_SEASONS),
        "sourceEvidence": cached["evidence"],
        "candidateCount": len(candidates),
        "selectionEligibleCount": len(eligible),
        "selected": selected,
        "confirmationSummary": confirmation_summary,
        "weeklyBootstrap": bootstrap,
        "confirmationGates": gates,
        "provisionalLeanQualified": qualified,
        "bestAngleAuthorized": False,
        "spreadBehaviorChanged": False,
        "trackingOrStakeChanged": False,
    }
    path = root / "football-research/reports" / f"{TOURNAMENT_RELEASE}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(residual.json_safe(report), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(residual.compact({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "candidateCount": len(candidates),
        "selectionEligibleCount": len(eligible),
        "selectedRule": selected["rule"] if selected else None,
        "selectionSummary": selected["selectionSummary"] if selected else None,
        "confirmationSummary": confirmation_summary,
        "weeklyBootstrap": bootstrap,
        "confirmationGates": gates,
        "provisionalLeanQualified": qualified,
        "report": str(path),
    }), indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
