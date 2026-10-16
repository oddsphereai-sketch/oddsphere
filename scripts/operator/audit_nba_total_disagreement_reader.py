#!/usr/bin/env python3
"""Chronological NBA Total disagreement-reader audit.

The independent model remains the starting Total. A candidate may re-orient
its residual across the current Total only when a large opening-to-current
move opposes a still-large independent edge. Candidate thresholds are selected
on 2024-25 and carried unchanged into 2025-26 confirmation.

This operator is research-only and never writes production state.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import audit_nba_unified_final_projection as unified
from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_total_disagreement_reader_audit_2026_10_16_r1"
R3_RECIPE = {
    "marginIndependentWeight": 1.0,
    "totalIndependentWeight": 1.0,
    "movementThreshold": 2.0,
}
MOVEMENT_THRESHOLDS = (2.0, 3.0, 4.0, 5.0)
INDEPENDENT_EDGE_THRESHOLDS = (3.0, 4.0, 5.0, 6.0)
MINIMUM_SELECTION_CORRECTIONS = 100
MINIMUM_CONFIRMATION_CORRECTIONS = 75
MINIMUM_SELECTION_HALF_CORRECTIONS = 40


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--selection-market", type=Path, required=True)
    parser.add_argument("--confirmation-market", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def wilson_lower(wins: int, decisions: int, z: float = 1.96) -> float | None:
    if decisions <= 0:
        return None
    rate = wins / decisions
    denominator = 1 + z * z / decisions
    center = rate + z * z / (2 * decisions)
    radius = z * math.sqrt(rate * (1 - rate) / decisions + z * z / (4 * decisions * decisions))
    return float((center - radius) / denominator)


def direction_metrics(pick_over: np.ndarray, result: np.ndarray, mask: np.ndarray | None = None) -> dict[str, Any]:
    eligible = ~np.isclose(result, 0.0)
    if mask is not None:
        eligible &= mask
    wins = pick_over[eligible] == (result[eligible] > 0)
    decisions = int(eligible.sum())
    win_count = int(wins.sum())
    units = win_count * 100 / 110 - (decisions - win_count)
    return {
        "decisions": decisions,
        "wins": win_count,
        "losses": decisions - win_count,
        "accuracy": float(win_count / decisions) if decisions else None,
        "wilson95Lower": wilson_lower(win_count, decisions),
        "flatMinus110Units": float(units),
        "flatMinus110Roi": float(units / decisions) if decisions else None,
    }


def evaluate(frame: pd.DataFrame, movement_threshold: float | None, edge_threshold: float | None) -> dict[str, Any]:
    r3_final = unified.reconcile(frame, R3_RECIPE)
    independent_total = frame["independent_total"].to_numpy(float)
    current_total = frame["close_total"].to_numpy(float)
    opening_total = frame["open_total"].to_numpy(float)
    actual_total = frame["target_total"].to_numpy(float)
    independent_edge = independent_total - current_total
    movement = current_total - opening_total
    result = actual_total - current_total
    independent_pick = independent_edge >= 0
    if movement_threshold is None or edge_threshold is None:
        applied = np.zeros(len(frame), dtype=bool)
    else:
        applied = (
            ~np.isclose(movement, 0.0)
            & (np.sign(movement) != np.sign(independent_edge))
            & (np.abs(movement) >= movement_threshold)
            & (np.abs(independent_edge) >= edge_threshold)
        )
    candidate_edge = np.where(applied, -independent_edge, independent_edge)
    candidate_total = current_total + candidate_edge
    candidate_pick = candidate_edge >= 0
    valid = ~np.isclose(result, 0.0)
    changed = valid & (candidate_pick != independent_pick)
    actual_over = result > 0
    corrections = int((changed & (candidate_pick == actual_over)).sum())
    harms = int((changed & (independent_pick == actual_over)).sum())
    ordered_dates = pd.to_datetime(frame["date_et"], errors="raise")
    midpoint = ordered_dates.sort_values().iloc[len(ordered_dates) // 2]
    chronological_halves = {
        "first": direction_metrics(candidate_pick, result, applied & (ordered_dates <= midpoint).to_numpy(bool)),
        "second": direction_metrics(candidate_pick, result, applied & (ordered_dates > midpoint).to_numpy(bool)),
    }
    final_home = (candidate_total + r3_final["margin"]) / 2
    final_away = (candidate_total - r3_final["margin"]) / 2
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    return {
        "recipe": None if movement_threshold is None else {
            "minimumOpposingMovementPoints": movement_threshold,
            "minimumIndependentEdgePoints": edge_threshold,
            "action": "categorically_reorient_independent_total_residual",
            "preserveResidualMagnitude": True,
        },
        "allBoard": direction_metrics(candidate_pick, result),
        "appliedCohort": direction_metrics(candidate_pick, result, applied),
        "appliedChronologicalHalves": chronological_halves,
        "sideChanges": int(changed.sum()),
        "corrections": corrections,
        "harms": harms,
        "totalMae": float(np.abs(candidate_total - actual_total).mean()),
        "teamScoreMae": float(np.mean(np.concatenate([
            np.abs(final_home - actual_home),
            np.abs(final_away - actual_away),
        ]))),
        "totalBias": float((candidate_total - actual_total).mean()),
    }


def selection_gate(candidate: dict[str, Any], baseline: dict[str, Any]) -> bool:
    stable_halves = all(
        half["decisions"] >= MINIMUM_SELECTION_HALF_CORRECTIONS
        and half["accuracy"] >= 0.55
        for half in candidate["appliedChronologicalHalves"].values()
    )
    return bool(
        candidate["appliedCohort"]["decisions"] >= MINIMUM_SELECTION_CORRECTIONS
        and candidate["appliedCohort"]["accuracy"] >= 0.55
        and candidate["allBoard"]["accuracy"] > baseline["allBoard"]["accuracy"]
        and candidate["totalMae"] < baseline["totalMae"]
        and candidate["teamScoreMae"] <= baseline["teamScoreMae"]
        and candidate["corrections"] > candidate["harms"]
        and stable_halves
    )


def confirmation_gates(candidate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, bool]:
    return {
        "minimumAppliedDecisions": candidate["appliedCohort"]["decisions"] >= MINIMUM_CONFIRMATION_CORRECTIONS,
        "appliedAccuracyAtLeast55": candidate["appliedCohort"]["accuracy"] >= 0.55,
        "allBoardAccuracyImproves": candidate["allBoard"]["accuracy"] > baseline["allBoard"]["accuracy"],
        "totalMaeImproves": candidate["totalMae"] < baseline["totalMae"],
        "teamScoreMaeImproves": candidate["teamScoreMae"] < baseline["teamScoreMae"],
        "correctionsExceedHarms": candidate["corrections"] > candidate["harms"],
    }


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection = unified.joined(features, groups, 2024, args.selection_market)
    confirmation = unified.joined(features, groups, 2025, args.confirmation_market)
    selection_baseline = evaluate(selection, None, None)
    confirmation_baseline = evaluate(confirmation, None, None)
    candidates = [
        evaluate(selection, movement_threshold, edge_threshold)
        for movement_threshold in MOVEMENT_THRESHOLDS
        for edge_threshold in INDEPENDENT_EDGE_THRESHOLDS
    ]
    for candidate in candidates:
        candidate["selectionGatePassed"] = selection_gate(candidate, selection_baseline)
    eligible = [candidate for candidate in candidates if candidate["selectionGatePassed"]]
    eligible.sort(key=lambda candidate: (
        -candidate["appliedCohort"]["accuracy"],
        -candidate["appliedCohort"]["decisions"],
        -candidate["allBoard"]["accuracy"],
        candidate["totalMae"],
        json.dumps(candidate["recipe"], sort_keys=True),
    ))
    if not eligible:
        raise ValueError("No Total disagreement-reader candidate cleared selection gates")
    selected = eligible[0]
    recipe = selected["recipe"]
    confirmed = evaluate(
        confirmation,
        float(recipe["minimumOpposingMovementPoints"]),
        float(recipe["minimumIndependentEdgePoints"]),
    )
    gates = confirmation_gates(confirmed, confirmation_baseline)
    report = {
        "release": RELEASE,
        "status": "research_only_historical_proxy",
        "chronology": {
            "selection": "2024-25 regular season",
            "confirmation": "2025-26 regular season",
            "selectionRule": "highest applied-cohort accuracy among candidates clearing all selection gates",
            "stabilityRule": "each chronological selection half needs at least 40 corrections and 55% accuracy",
        },
        "inputs": {
            "features": {"path": str(args.features), "sha256": unified.sha256(args.features)},
            "selectionMarket": {"path": str(args.selection_market), "sha256": unified.sha256(args.selection_market)},
            "confirmationMarket": {"path": str(args.confirmation_market), "sha256": unified.sha256(args.confirmation_market)},
        },
        "selection": {
            "baseline": selection_baseline,
            "selected": selected,
            "eligibleCandidates": len(eligible),
            "evaluatedCandidates": len(candidates),
            "candidates": candidates,
        },
        "confirmation": {
            "baseline": confirmation_baseline,
            "candidate": confirmed,
            "gates": gates,
        },
        "historicalProxyGatePassed": all(gates.values()),
        "productionAuthority": False,
        "productionRequirement": (
            "The same categorical rule must be supplied by complete target-book-excluded, "
            "same-book Total trails. Historical consensus movement cannot itself authorize a live flip."
        ),
        "limitations": [
            "Historical movement is consensus opening-to-closing movement, not authentic same-book chronology.",
            "Historical source-specific split flow and exact selected closing prices are unavailable.",
            "Flat -110 units are a direction benchmark rather than exact-price ROI.",
            "The confirmation season is fixed and release-pure but has been examined by earlier project audits.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "selected": selected,
        "confirmation": report["confirmation"],
        "historicalProxyGatePassed": report["historicalProxyGatePassed"],
        "productionAuthority": report["productionAuthority"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
