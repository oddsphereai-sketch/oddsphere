#!/usr/bin/env python3
"""Release-pure NBA Spread/Total accuracy-ceiling audit.

This research-only operator starts from the released independent-first r3
historical proxy. It asks two deliberately separate questions:

1. Does stronger categorical Spread evidence identify a stable actionable tier?
2. Is the independent Total residual systematically miscalibrated enough to
   justify a new shadow correction candidate?

Candidate selection uses 2024-25 only. The selected recipes are then reported
unchanged on 2025-26. The script never writes production data or artifacts.
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


RELEASE = "nba_accuracy_ceiling_audit_2026_10_16_r1"
R3_RECIPE = {
    "marginIndependentWeight": 1.0,
    "totalIndependentWeight": 1.0,
    "movementThreshold": 2.0,
}
SPREAD_STRENGTH_THRESHOLDS = (2.0, 3.0, 4.0, 5.0, 6.0)
TOTAL_EDGE_FLIP_THRESHOLDS = (2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0)
TOTAL_MOVE_FOLLOW_THRESHOLDS = (None, 2.0, 3.0, 4.0, 5.0)
TOTAL_TIER_BANDS = ((3.0, 6.0), (4.0, 6.0), (4.0, 8.0), (5.0, 6.0), (5.0, 8.0), (5.0, math.inf))
MINIMUM_SELECTION_DECISIONS = 100


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


def direction_metrics(prediction: np.ndarray, result: np.ndarray, mask: np.ndarray | None = None) -> dict[str, Any]:
    eligible = ~np.isclose(result, 0.0)
    if mask is not None:
        eligible &= mask
    wins = prediction[eligible] == (result[eligible] > 0)
    win_count = int(wins.sum())
    decisions = int(eligible.sum())
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


def r3_state(frame: pd.DataFrame) -> dict[str, np.ndarray]:
    final = unified.reconcile(frame, R3_RECIPE)
    market_margin = -frame["close_spread_home"].to_numpy(float)
    independent_spread_residual = frame["independent_margin"].to_numpy(float) - market_margin
    spread_support = frame["spread_home_support"].to_numpy(float)
    spread_result = frame["target_home_margin"].to_numpy(float) - market_margin
    total_edge = frame["independent_total"].to_numpy(float) - frame["close_total"].to_numpy(float)
    total_result = frame["target_total"].to_numpy(float) - frame["close_total"].to_numpy(float)
    return {
        **final,
        "independentSpreadResidual": independent_spread_residual,
        "spreadSupport": spread_support,
        "spreadResult": spread_result,
        "totalEdge": total_edge,
        "totalResult": total_result,
    }


def spread_strength_candidates(frame: pd.DataFrame, state: dict[str, np.ndarray]) -> list[dict[str, Any]]:
    applied = state["movementActive"] & (
        np.sign(state["independentSpreadResidual"]) != np.sign(state["spreadSupport"])
    )
    final_pick = state["spreadResidual"] >= 0
    output = []
    for threshold in SPREAD_STRENGTH_THRESHOLDS:
        mask = applied & (np.abs(state["spreadSupport"]) >= threshold)
        output.append({
            "minimumMovementPoints": threshold,
            "requiresAppliedCategoricalCorrection": True,
            "result": direction_metrics(final_pick, state["spreadResult"], mask),
        })
    return output


def select_spread_strength(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    eligible = [
        candidate for candidate in candidates
        if candidate["result"]["decisions"] >= MINIMUM_SELECTION_DECISIONS
        and candidate["result"]["accuracy"] >= 0.55
    ]
    if not eligible:
        return None
    eligible.sort(key=lambda candidate: (
        -candidate["result"]["accuracy"],
        -candidate["result"]["decisions"],
        candidate["minimumMovementPoints"],
    ))
    return eligible[0]


def total_candidate_edge(
    frame: pd.DataFrame,
    state: dict[str, np.ndarray],
    flip_threshold: float,
    movement_threshold: float | None,
) -> np.ndarray:
    independent_edge = state["totalEdge"]
    candidate_edge = np.where(
        np.abs(independent_edge) >= flip_threshold,
        -independent_edge,
        independent_edge,
    )
    if movement_threshold is not None:
        movement = frame["close_total"].to_numpy(float) - frame["open_total"].to_numpy(float)
        active = np.abs(movement) >= movement_threshold
        movement_edge = np.sign(movement) * np.maximum(np.abs(candidate_edge), 0.25)
        candidate_edge = np.where(active, movement_edge, candidate_edge)
    return candidate_edge


def total_candidate_metrics(
    frame: pd.DataFrame,
    state: dict[str, np.ndarray],
    candidate_edge: np.ndarray,
) -> dict[str, Any]:
    market_total = frame["close_total"].to_numpy(float)
    candidate_total = market_total + candidate_edge
    actual_total = frame["target_total"].to_numpy(float)
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    home = (candidate_total + state["margin"]) / 2
    away = (candidate_total - state["margin"]) / 2
    baseline_pick = state["totalEdge"] >= 0
    candidate_pick = candidate_edge >= 0
    valid = ~np.isclose(state["totalResult"], 0.0)
    changed = valid & (baseline_pick != candidate_pick)
    actual_over = state["totalResult"] > 0
    corrections = int((changed & (candidate_pick == actual_over)).sum())
    harms = int((changed & (baseline_pick == actual_over)).sum())
    return {
        "direction": direction_metrics(candidate_pick, state["totalResult"]),
        "totalMae": float(np.abs(candidate_total - actual_total).mean()),
        "teamScoreMae": float(np.mean(np.concatenate([
            np.abs(home - actual_home),
            np.abs(away - actual_away),
        ]))),
        "sideChanges": int(changed.sum()),
        "corrections": corrections,
        "harms": harms,
    }


def total_candidates(frame: pd.DataFrame, state: dict[str, np.ndarray]) -> list[dict[str, Any]]:
    output = []
    for flip_threshold in TOTAL_EDGE_FLIP_THRESHOLDS:
        for movement_threshold in TOTAL_MOVE_FOLLOW_THRESHOLDS:
            edge = total_candidate_edge(frame, state, flip_threshold, movement_threshold)
            output.append({
                "recipe": {
                    "categoricalFlipAtAbsoluteIndependentEdge": flip_threshold,
                    "followOpeningToCloseMoveAtPoints": movement_threshold,
                    "preserveIndependentResidualMagnitude": True,
                },
                "result": total_candidate_metrics(frame, state, edge),
            })
    return output


def select_total_candidate(
    candidates: list[dict[str, Any]],
    baseline: dict[str, Any],
) -> dict[str, Any] | None:
    eligible = [
        candidate for candidate in candidates
        if candidate["result"]["sideChanges"] >= MINIMUM_SELECTION_DECISIONS
        and candidate["result"]["direction"]["accuracy"] > baseline["direction"]["accuracy"]
        and candidate["result"]["totalMae"] < baseline["totalMae"]
        and candidate["result"]["corrections"] > candidate["result"]["harms"]
    ]
    if not eligible:
        return None
    eligible.sort(key=lambda candidate: (
        -candidate["result"]["direction"]["accuracy"],
        candidate["result"]["totalMae"],
        json.dumps(candidate["recipe"], sort_keys=True),
    ))
    return eligible[0]


def total_tier_candidates(
    frame: pd.DataFrame,
    state: dict[str, np.ndarray],
    recipe: dict[str, Any],
) -> list[dict[str, Any]]:
    edge = total_candidate_edge(
        frame,
        state,
        float(recipe["categoricalFlipAtAbsoluteIndependentEdge"]),
        recipe["followOpeningToCloseMoveAtPoints"],
    )
    output = []
    for lower, upper in TOTAL_TIER_BANDS:
        for side in ("all", "over", "under"):
            mask = (np.abs(state["totalEdge"]) >= lower) & (np.abs(state["totalEdge"]) < upper)
            if side == "over":
                mask &= edge >= 0
            elif side == "under":
                mask &= edge < 0
            output.append({
                "absoluteIndependentEdgeBand": [lower, None if math.isinf(upper) else upper],
                "candidateSide": side,
                "result": direction_metrics(edge >= 0, state["totalResult"], mask),
            })
    return output


def select_total_tier(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    eligible = [
        candidate for candidate in candidates
        if candidate["result"]["decisions"] >= MINIMUM_SELECTION_DECISIONS
        and candidate["result"]["accuracy"] >= 0.55
    ]
    if not eligible:
        return None
    eligible.sort(key=lambda candidate: (
        -candidate["result"]["accuracy"],
        -candidate["result"]["decisions"],
        json.dumps(candidate, sort_keys=True),
    ))
    return eligible[0]


def cohort_metrics(frame: pd.DataFrame, state: dict[str, np.ndarray]) -> dict[str, Any]:
    spread_pick = state["spreadResidual"] >= 0
    total_pick = state["totalEdge"] >= 0
    output: dict[str, Any] = {}
    definitions = {
        "spread_reader_applied": state["movementActive"] & (
            np.sign(state["independentSpreadResidual"]) != np.sign(state["spreadSupport"])
        ),
        "spread_reader_confirmed": state["movementActive"] & (
            np.sign(state["independentSpreadResidual"]) == np.sign(state["spreadSupport"])
        ),
        "spread_reader_inactive": ~state["movementActive"],
        "total_edge_under_3": np.abs(state["totalEdge"]) < 3,
        "total_edge_3_to_5": (np.abs(state["totalEdge"]) >= 3) & (np.abs(state["totalEdge"]) < 5),
        "total_edge_5_to_8": (np.abs(state["totalEdge"]) >= 5) & (np.abs(state["totalEdge"]) < 8),
        "total_edge_8_plus": np.abs(state["totalEdge"]) >= 8,
    }
    for name, mask in definitions.items():
        prediction = spread_pick if name.startswith("spread") else total_pick
        result = state["spreadResult"] if name.startswith("spread") else state["totalResult"]
        output[name] = direction_metrics(prediction, result, mask)
    return output


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection = unified.joined(features, groups, 2024, args.selection_market)
    confirmation = unified.joined(features, groups, 2025, args.confirmation_market)
    selection_state = r3_state(selection)
    confirmation_state = r3_state(confirmation)

    selection_baseline = {
        "spread": direction_metrics(selection_state["spreadResidual"] >= 0, selection_state["spreadResult"]),
        "total": total_candidate_metrics(selection, selection_state, selection_state["totalEdge"]),
    }
    confirmation_baseline = {
        "spread": direction_metrics(confirmation_state["spreadResidual"] >= 0, confirmation_state["spreadResult"]),
        "total": total_candidate_metrics(confirmation, confirmation_state, confirmation_state["totalEdge"]),
    }

    spread_selection_candidates = spread_strength_candidates(selection, selection_state)
    selected_spread = select_spread_strength(spread_selection_candidates)
    spread_confirmation_candidates = spread_strength_candidates(confirmation, confirmation_state)
    confirmed_spread = None if selected_spread is None else next(
        candidate for candidate in spread_confirmation_candidates
        if candidate["minimumMovementPoints"] == selected_spread["minimumMovementPoints"]
    )

    total_selection_candidates = total_candidates(selection, selection_state)
    selected_total = select_total_candidate(total_selection_candidates, selection_baseline["total"])
    confirmed_total = None
    selected_total_tier = None
    confirmed_total_tier = None
    total_selection_tiers: list[dict[str, Any]] = []
    if selected_total is not None:
        recipe = selected_total["recipe"]
        confirmation_edge = total_candidate_edge(
            confirmation,
            confirmation_state,
            float(recipe["categoricalFlipAtAbsoluteIndependentEdge"]),
            recipe["followOpeningToCloseMoveAtPoints"],
        )
        confirmed_total = {
            "recipe": recipe,
            "result": total_candidate_metrics(confirmation, confirmation_state, confirmation_edge),
        }
        total_selection_tiers = total_tier_candidates(selection, selection_state, recipe)
        selected_total_tier = select_total_tier(total_selection_tiers)
        if selected_total_tier is not None:
            confirmation_tiers = total_tier_candidates(confirmation, confirmation_state, recipe)
            confirmed_total_tier = next(
                candidate for candidate in confirmation_tiers
                if candidate["absoluteIndependentEdgeBand"] == selected_total_tier["absoluteIndependentEdgeBand"]
                and candidate["candidateSide"] == selected_total_tier["candidateSide"]
            )

    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "chronology": {
            "selection": "2024-25 regular season",
            "confirmation": "2025-26 regular season",
            "selectionPolicy": "recipes and tiers ranked only by 2024-25 metrics, then carried unchanged",
        },
        "inputs": {
            "features": {"path": str(args.features), "sha256": unified.sha256(args.features)},
            "selectionMarket": {"path": str(args.selection_market), "sha256": unified.sha256(args.selection_market)},
            "confirmationMarket": {"path": str(args.confirmation_market), "sha256": unified.sha256(args.confirmation_market)},
        },
        "baseline": {
            "selection": selection_baseline,
            "confirmation": confirmation_baseline,
        },
        "spreadStrength": {
            "selectionCandidates": spread_selection_candidates,
            "confirmationCandidates": spread_confirmation_candidates,
            "selected": selected_spread,
            "confirmation": confirmed_spread,
            "interpretation": "actionable-strength tier only; the released r3 side is unchanged",
        },
        "totalChallenger": {
            "selectionCandidates": total_selection_candidates,
            "selected": selected_total,
            "confirmation": confirmed_total,
            "tierSelectionCandidates": total_selection_tiers,
            "selectedTier": selected_total_tier,
            "confirmationTier": confirmed_total_tier,
            "interpretation": "historical shadow candidate; no production authority without authentic point-in-time evidence",
        },
        "lossLedger": {
            "selection": cohort_metrics(selection, selection_state),
            "confirmation": cohort_metrics(confirmation, confirmation_state),
        },
        "decision": {
            "spreadForecastChangeAuthorized": False,
            "spreadReason": "The r3 categorical side is already correct; the new result identifies strength, not a different pick.",
            "spreadProspectiveTierEligible": bool(
                selected_spread is not None
                and confirmed_spread is not None
                and confirmed_spread["result"]["accuracy"] >= 0.58
            ),
            "totalForecastChangeAuthorized": False,
            "totalReason": "Consensus open/close can expose the candidate but cannot replay the live same-book, target-excluded reader or source-specific splits.",
            "totalProspectiveShadowEligible": bool(
                selected_total is not None
                and confirmed_total is not None
                and confirmed_total["result"]["direction"]["accuracy"]
                    > confirmation_baseline["total"]["direction"]["accuracy"]
                and confirmed_total["result"]["totalMae"] < confirmation_baseline["total"]["totalMae"]
            ),
        },
        "limitations": [
            "Historical market files are consensus opening/closing snapshots rather than authentic same-book decision-time trails.",
            "Historical source-specific ticket/handle splits and exact selected closing prices are unavailable.",
            "Flat -110 units are a direction benchmark, not exact-price ROI.",
            "The 2025-26 season is a fixed historical confirmation set, but it is not epistemically pristine after prior project audits.",
            "A 58-60% tier is not evidence that every published NBA side can sustain that accuracy.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "spreadStrength": report["spreadStrength"],
        "totalChallenger": {
            "selected": selected_total,
            "confirmation": confirmed_total,
            "selectedTier": selected_total_tier,
            "confirmationTier": confirmed_total_tier,
        },
        "decision": report["decision"],
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
