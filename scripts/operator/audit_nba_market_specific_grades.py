#!/usr/bin/env python3
"""Read-only chronological audit of NBA r4 market-specific grades.

The score and categorical reader are frozen. This operator reconstructs their
historical proxy, tests only presentation/actionability grade policies on
2024-25, and carries one selected recipe per market unchanged into 2025-26.
It never writes production state.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import math
import sys
from pathlib import Path
from typing import Any, Callable

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from scripts.operator import audit_nba_unified_final_projection as unified
from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_market_specific_grade_audit_2026_10_16_r1"
R4_RECIPE = {
    "marginIndependentWeight": 1.0,
    "totalIndependentWeight": 1.0,
    "movementThreshold": 2.0,
}
MARGIN_SIGMA = 12.964104634449086
TOTAL_SIGMA = 18.251616651383458
TOTAL_READER_MOVEMENT = 5.0
TOTAL_READER_EDGE = 5.0

LEAN_PROBABILITIES = (0.55, 0.575, 0.60)
ML_LEAN_EDGES = (0.00, 0.02, 0.04)
ML_BEST_PROBABILITIES = (0.62, 0.65, 0.68, 0.70)
ML_BEST_EDGES = (0.02, 0.04, 0.06, 0.08)
SPREAD_INACTIVE_BEST = (0.60, 0.62, 0.65)
SPREAD_ACTIVE_LEAN = (0.50, 0.525, 0.55)
SPREAD_ACTIVE_BEST = (0.575, 0.60, 0.62)
TOTAL_CORRECTED_BEST = (0.55, 0.575, 0.60)
TOTAL_ALIGNED_BEST = (0.575, 0.60, 0.62)
TOTAL_INACTIVE_BEST = (0.62, 0.65, 0.68)
TOTAL_LARGE_EDGE_CAPS = (4.0, 5.0, 6.0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--selection-market", type=Path, required=True)
    parser.add_argument("--confirmation-market", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def normal_cdf(values: np.ndarray) -> np.ndarray:
    return np.array([
        0.5 * (1.0 + math.erf(float(value) / math.sqrt(2.0)))
        for value in values
    ])


def build_market_frame(frame: pd.DataFrame) -> pd.DataFrame:
    final = unified.reconcile(frame, R4_RECIPE)
    output = frame.copy().reset_index(drop=True)
    output["final_margin"] = final["margin"]
    output["spread_edge"] = final["spreadResidual"]
    output["spread_reader_active"] = final["movementActive"]

    raw_total_edge = output["independent_total"].to_numpy(float) - output["close_total"].to_numpy(float)
    total_movement = output["close_total"].to_numpy(float) - output["open_total"].to_numpy(float)
    total_corrected = (
        ~np.isclose(total_movement, 0.0)
        & (np.sign(total_movement) != np.sign(raw_total_edge))
        & (np.abs(total_movement) >= TOTAL_READER_MOVEMENT)
        & (np.abs(raw_total_edge) >= TOTAL_READER_EDGE)
    )
    total_aligned = (
        ~np.isclose(total_movement, 0.0)
        & (np.sign(total_movement) == np.sign(raw_total_edge))
        & (np.abs(total_movement) >= TOTAL_READER_MOVEMENT)
        & (np.abs(raw_total_edge) >= TOTAL_READER_EDGE)
    )
    output["raw_total_edge"] = raw_total_edge
    output["total_movement"] = total_movement
    output["total_reader_corrected"] = total_corrected
    output["total_reader_aligned"] = total_aligned
    output["total_edge"] = np.where(total_corrected, -raw_total_edge, raw_total_edge)
    output["final_total"] = output["close_total"].to_numpy(float) + output["total_edge"].to_numpy(float)

    home_win_probability = normal_cdf(output["final_margin"].to_numpy(float) / MARGIN_SIGMA)
    spread_home_probability = normal_cdf(output["spread_edge"].to_numpy(float) / MARGIN_SIGMA)
    total_over_probability = normal_cdf(output["total_edge"].to_numpy(float) / TOTAL_SIGMA)

    output["ml_pick"] = np.where(home_win_probability >= 0.5, "home", "away")
    output["ml_probability"] = np.maximum(home_win_probability, 1 - home_win_probability)
    output["ml_market_probability"] = np.where(
        output["ml_pick"].eq("home"),
        output["close_home_win_prob"].to_numpy(float),
        1 - output["close_home_win_prob"].to_numpy(float),
    )
    output["ml_edge"] = output["ml_probability"] - output["ml_market_probability"]
    output["ml_win"] = output["ml_pick"].eq(output["moneyline_winner"])
    output["ml_decimal_fair_price"] = np.where(
        output["ml_pick"].eq("home"),
        output["close_fair_home_odds"].to_numpy(float),
        output["close_fair_away_odds"].to_numpy(float),
    )

    output["spread_pick"] = np.where(spread_home_probability >= 0.5, "home", "away")
    output["spread_probability"] = np.maximum(spread_home_probability, 1 - spread_home_probability)
    spread_result = output["target_home_margin"].to_numpy(float) + output["close_spread_home"].to_numpy(float)
    output["spread_push"] = np.isclose(spread_result, 0.0)
    output["spread_win"] = np.where(
        output["spread_pick"].eq("home"), spread_result > 0, spread_result < 0,
    )

    output["total_pick"] = np.where(total_over_probability >= 0.5, "over", "under")
    output["total_probability"] = np.maximum(total_over_probability, 1 - total_over_probability)
    total_result = output["target_total"].to_numpy(float) - output["close_total"].to_numpy(float)
    output["total_push"] = np.isclose(total_result, 0.0)
    output["total_win"] = np.where(
        output["total_pick"].eq("over"), total_result > 0, total_result < 0,
    )
    output["chronological_half"] = np.where(np.arange(len(output)) < len(output) / 2, "first", "second")
    return output


def incumbent_grades(frame: pd.DataFrame, market: str) -> np.ndarray:
    prefix = "ml" if market == "moneyline" else market
    probability = frame[f"{prefix}_probability"].to_numpy(float)
    grade = np.full(len(frame), "watch", dtype=object)
    if market == "moneyline":
        edge = frame["ml_edge"].to_numpy(float)
        actionable = (probability >= 0.55) & (edge >= -0.02)
        best = actionable & (probability >= 0.62) & (edge >= 0.04)
    else:
        actionable = probability >= 0.55
        best = actionable & (probability >= 0.62)
    grade[actionable] = "lean"
    grade[best] = "best_angle"
    return grade


def ml_policy(frame: pd.DataFrame, recipe: dict[str, float]) -> np.ndarray:
    probability = frame["ml_probability"].to_numpy(float)
    edge = frame["ml_edge"].to_numpy(float)
    actionable = (probability >= recipe["leanProbability"]) & (edge >= recipe["leanEdge"])
    best = (
        actionable
        & (probability >= recipe["bestProbability"])
        & (edge >= recipe["bestEdge"])
    )
    grade = np.full(len(frame), "watch", dtype=object)
    grade[actionable] = "lean"
    grade[best] = "best_angle"
    return grade


def spread_policy(frame: pd.DataFrame, recipe: dict[str, float]) -> np.ndarray:
    probability = frame["spread_probability"].to_numpy(float)
    active = frame["spread_reader_active"].to_numpy(bool)
    lean_floor = np.where(active, recipe["activeLeanProbability"], recipe["inactiveLeanProbability"])
    best_floor = np.where(active, recipe["activeBestProbability"], recipe["inactiveBestProbability"])
    actionable = probability >= lean_floor
    best = actionable & (probability >= best_floor)
    grade = np.full(len(frame), "watch", dtype=object)
    grade[actionable] = "lean"
    grade[best] = "best_angle"
    return grade


def total_policy(frame: pd.DataFrame, recipe: dict[str, float]) -> np.ndarray:
    probability = frame["total_probability"].to_numpy(float)
    corrected = frame["total_reader_corrected"].to_numpy(bool)
    aligned = frame["total_reader_aligned"].to_numpy(bool)
    inactive = ~(corrected | aligned)
    actionable = probability >= recipe["leanProbability"]
    best = actionable & (
        (corrected & (probability >= recipe["correctedBestProbability"]))
        | (aligned & (probability >= recipe["alignedBestProbability"]))
        | (
            inactive
            & (probability >= recipe["inactiveBestProbability"])
            & (np.abs(frame["raw_total_edge"].to_numpy(float)) < recipe["inactiveLargeEdgeCap"])
        )
    )
    grade = np.full(len(frame), "watch", dtype=object)
    grade[actionable] = "lean"
    grade[best] = "best_angle"
    return grade


def recipes(market: str) -> list[dict[str, float]]:
    if market == "moneyline":
        return [
            {
                "leanProbability": lean_probability,
                "leanEdge": lean_edge,
                "bestProbability": best_probability,
                "bestEdge": best_edge,
            }
            for lean_probability, lean_edge, best_probability, best_edge in itertools.product(
                LEAN_PROBABILITIES, ML_LEAN_EDGES, ML_BEST_PROBABILITIES, ML_BEST_EDGES
            )
            if best_probability >= lean_probability and best_edge >= lean_edge
        ]
    if market == "spread":
        return [
            {
                "inactiveLeanProbability": inactive_lean,
                "activeLeanProbability": active_lean,
                "inactiveBestProbability": inactive_best,
                "activeBestProbability": active_best,
            }
            for inactive_lean, active_lean, inactive_best, active_best in itertools.product(
                LEAN_PROBABILITIES,
                SPREAD_ACTIVE_LEAN,
                SPREAD_INACTIVE_BEST,
                SPREAD_ACTIVE_BEST,
            )
            if inactive_best >= inactive_lean and active_best >= active_lean
        ]
    if market == "total":
        return [
            {
                "leanProbability": lean_probability,
                "correctedBestProbability": corrected_best,
                "alignedBestProbability": aligned_best,
                "inactiveBestProbability": inactive_best,
                "inactiveLargeEdgeCap": cap,
            }
            for lean_probability, corrected_best, aligned_best, inactive_best, cap in itertools.product(
                LEAN_PROBABILITIES,
                TOTAL_CORRECTED_BEST,
                TOTAL_ALIGNED_BEST,
                TOTAL_INACTIVE_BEST,
                TOTAL_LARGE_EDGE_CAPS,
            )
            if corrected_best >= lean_probability
            and aligned_best >= lean_probability
            and inactive_best >= lean_probability
        ]
    raise ValueError(f"unsupported market {market}")


def grade_counts(grades: np.ndarray) -> dict[str, int]:
    return {
        tier: int((grades == tier).sum())
        for tier in ("best_angle", "lean", "watch")
    }


def tier_metrics(frame: pd.DataFrame, market: str, grades: np.ndarray, tier: str) -> dict[str, Any]:
    prefix = "ml" if market == "moneyline" else market
    if tier == "actionable":
        mask = np.isin(grades, ["best_angle", "lean"])
    else:
        mask = grades == tier
    if market != "moneyline":
        mask &= ~frame[f"{market}_push"].to_numpy(bool)
    wins = frame[f"{prefix}_win"].to_numpy(bool)[mask]
    decisions = int(mask.sum())
    win_count = int(wins.sum())
    if market == "moneyline":
        prices = frame["ml_decimal_fair_price"].to_numpy(float)[mask]
        units = np.where(wins, prices - 1.0, -1.0)
        economics_label = "consensusFairPrice"
    else:
        units = np.where(wins, 100 / 110, -1.0)
        economics_label = "flatMinus110"
    return {
        "decisions": decisions,
        "wins": win_count,
        "losses": decisions - win_count,
        "accuracy": float(win_count / decisions) if decisions else None,
        "units": float(units.sum()) if decisions else None,
        "roi": float(units.mean()) if decisions else None,
        "economicsLabel": economics_label,
    }


def half_metrics(frame: pd.DataFrame, market: str, grades: np.ndarray) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for half in ("first", "second"):
        subset = frame["chronological_half"].eq(half).to_numpy(bool)
        output[half] = tier_metrics(frame.loc[subset].reset_index(drop=True), market, grades[subset], "actionable")
    return output


def board_impact(incumbent: np.ndarray, candidate: np.ndarray) -> dict[str, Any]:
    incumbent_actionable = np.isin(incumbent, ["best_angle", "lean"])
    candidate_actionable = np.isin(candidate, ["best_angle", "lean"])
    return {
        "incumbentCounts": grade_counts(incumbent),
        "candidateCounts": grade_counts(candidate),
        "actionablePromotions": int((~incumbent_actionable & candidate_actionable).sum()),
        "actionableDemotions": int((incumbent_actionable & ~candidate_actionable).sum()),
        "bestAnglePromotions": int(((incumbent != "best_angle") & (candidate == "best_angle")).sum()),
        "bestAngleDemotions": int(((incumbent == "best_angle") & (candidate != "best_angle")).sum()),
        "netActionables": int(candidate_actionable.sum() - incumbent_actionable.sum()),
    }


def evaluate(frame: pd.DataFrame, market: str, grades: np.ndarray, incumbent: np.ndarray) -> dict[str, Any]:
    return {
        "counts": grade_counts(grades),
        "actionable": tier_metrics(frame, market, grades, "actionable"),
        "bestAngle": tier_metrics(frame, market, grades, "best_angle"),
        "lean": tier_metrics(frame, market, grades, "lean"),
        "watch": tier_metrics(frame, market, grades, "watch"),
        "actionableChronologicalHalves": half_metrics(frame, market, grades),
        "boardImpact": board_impact(incumbent, grades),
    }


def selection_gates(result: dict[str, Any], market: str) -> dict[str, bool]:
    actionable = result["actionable"]
    best = result["bestAngle"]
    lean = result["lean"]
    halves = result["actionableChronologicalHalves"]
    impact = result["boardImpact"]
    return {
        "minimumActionables": actionable["decisions"] >= 200,
        "minimumHalfSamples": all(value["decisions"] >= 60 for value in halves.values()),
        "actionableEconomicsPositive": actionable["units"] is not None and actionable["units"] > 0,
        "spreadTotalBreakEvenAccuracy": (
            True if market == "moneyline" else actionable["accuracy"] > 100 / 210
        ),
        "minimumBestAngles": best["decisions"] >= 75,
        "bestAngleAccuracy": best["accuracy"] is not None and best["accuracy"] >= 0.55,
        "bestAngleExceedsLean": (
            best["accuracy"] is not None
            and lean["accuracy"] is not None
            and best["accuracy"] >= lean["accuracy"] + 0.01
        ),
        "halvesNotBelowHalf": all(
            value["accuracy"] is not None and value["accuracy"] >= 0.50
            for value in halves.values()
        ),
        "pairedActionablePath": (
            impact["actionableDemotions"] == 0 or impact["actionablePromotions"] > 0
        ),
    }


def confirmation_gates(result: dict[str, Any], market: str) -> dict[str, bool]:
    actionable = result["actionable"]
    best = result["bestAngle"]
    lean = result["lean"]
    halves = result["actionableChronologicalHalves"]
    impact = result["boardImpact"]
    return {
        "minimumActionables": actionable["decisions"] >= 150,
        "minimumHalfSamples": all(value["decisions"] >= 45 for value in halves.values()),
        "actionableEconomicsPositive": actionable["units"] is not None and actionable["units"] > 0,
        "spreadTotalBreakEvenAccuracy": (
            True if market == "moneyline" else actionable["accuracy"] > 100 / 210
        ),
        "minimumBestAngles": best["decisions"] >= 50,
        "bestAngleAccuracy": best["accuracy"] is not None and best["accuracy"] >= 0.55,
        "bestAngleExceedsLean": (
            best["accuracy"] is not None
            and lean["accuracy"] is not None
            and best["accuracy"] >= lean["accuracy"] + 0.01
        ),
        "halvesNotBelowHalf": all(
            value["accuracy"] is not None and value["accuracy"] >= 0.50
            for value in halves.values()
        ),
        "pairedActionablePath": (
            impact["actionableDemotions"] == 0 or impact["actionablePromotions"] > 0
        ),
    }


def loss_breakdown(frame: pd.DataFrame, market: str, grades: np.ndarray) -> dict[str, Any]:
    prefix = "ml" if market == "moneyline" else market
    actionable = np.isin(grades, ["best_angle", "lean"])
    if market != "moneyline":
        actionable &= ~frame[f"{market}_push"].to_numpy(bool)
    losses = actionable & ~frame[f"{prefix}_win"].to_numpy(bool)
    probability = frame[f"{prefix}_probability"].to_numpy(float)
    buckets = pd.cut(
        probability,
        bins=[0.5, 0.55, 0.60, 0.65, 0.70, 1.0],
        labels=["50-55", "55-60", "60-65", "65-70", "70+"],
        include_lowest=True,
        right=False,
    )
    reader_lane = np.full(len(frame), "inactive", dtype=object)
    if market == "spread":
        reader_lane[frame["spread_reader_active"].to_numpy(bool)] = "qualified_proxy"
    elif market == "total":
        reader_lane[frame["total_reader_aligned"].to_numpy(bool)] = "aligned_proxy"
        reader_lane[frame["total_reader_corrected"].to_numpy(bool)] = "corrected_proxy"
    else:
        reader_lane = np.where(frame["ml_edge"].to_numpy(float) >= 0, "positive_no_vig_edge", "negative_no_vig_edge")

    def grouped(values: np.ndarray) -> dict[str, dict[str, int]]:
        result: dict[str, dict[str, int]] = {}
        for value in sorted({str(item) for item in values}):
            cohort = values.astype(str) == value
            result[value] = {
                "actionables": int((actionable & cohort).sum()),
                "losses": int((losses & cohort).sum()),
            }
        return result

    return {
        "probabilityBuckets": grouped(np.asarray(buckets.astype(str))),
        "readerLanes": grouped(np.asarray(reader_lane)),
        "pickedSides": grouped(frame[f"{prefix}_pick"].astype(str).to_numpy()),
        "gradeTiers": grouped(np.asarray(grades)),
    }


def policy_function(market: str) -> Callable[[pd.DataFrame, dict[str, float]], np.ndarray]:
    return {
        "moneyline": ml_policy,
        "spread": spread_policy,
        "total": total_policy,
    }[market]


def rank_key(candidate: dict[str, Any]) -> tuple[Any, ...]:
    result = candidate["selection"]
    return (
        -result["bestAngle"]["accuracy"],
        -result["actionable"]["accuracy"],
        -result["actionable"]["roi"],
        -result["bestAngle"]["decisions"],
        -result["actionable"]["decisions"],
        json.dumps(candidate["recipe"], sort_keys=True),
    )


def audit_market(selection: pd.DataFrame, confirmation: pd.DataFrame, market: str) -> dict[str, Any]:
    function = policy_function(market)
    incumbent_selection_grades = incumbent_grades(selection, market)
    incumbent_confirmation_grades = incumbent_grades(confirmation, market)
    incumbent = {
        "selection": evaluate(selection, market, incumbent_selection_grades, incumbent_selection_grades),
        "confirmation": evaluate(confirmation, market, incumbent_confirmation_grades, incumbent_confirmation_grades),
    }
    candidates = []
    for recipe in recipes(market):
        selection_grades = function(selection, recipe)
        result = evaluate(selection, market, selection_grades, incumbent_selection_grades)
        gates = selection_gates(result, market)
        candidates.append({
            "recipe": recipe,
            "selection": result,
            "selectionGates": gates,
            "selectionPassed": all(gates.values()),
        })
    eligible = [candidate for candidate in candidates if candidate["selectionPassed"]]
    eligible.sort(key=rank_key)
    selected = eligible[0] if eligible else None
    if selected is None:
        return {
            "market": market,
            "incumbent": incumbent,
            "evaluatedCandidates": len(candidates),
            "selectionEligibleCandidates": 0,
            "selected": None,
            "confirmationPassed": False,
            "closestCandidates": sorted(
                candidates,
                key=lambda candidate: (
                    -sum(candidate["selectionGates"].values()),
                    -candidate["selection"]["actionable"]["decisions"],
                    json.dumps(candidate["recipe"], sort_keys=True),
                ),
            )[:10],
        }
    confirmation_grades = function(confirmation, selected["recipe"])
    confirmation_result = evaluate(
        confirmation, market, confirmation_grades, incumbent_confirmation_grades
    )
    gates = confirmation_gates(confirmation_result, market)
    selected = {
        **selected,
        "confirmation": confirmation_result,
        "confirmationGates": gates,
        "confirmationPassed": all(gates.values()),
        "lossAnalysis": {
            "selection": loss_breakdown(selection, market, function(selection, selected["recipe"])),
            "confirmation": loss_breakdown(confirmation, market, confirmation_grades),
        },
    }
    return {
        "market": market,
        "incumbent": incumbent,
        "evaluatedCandidates": len(candidates),
        "selectionEligibleCandidates": len(eligible),
        "selected": selected,
        "confirmationPassed": selected["confirmationPassed"],
    }


def main() -> None:
    args = parse_args()
    features = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(features)
    selection = build_market_frame(unified.joined(features, groups, 2024, args.selection_market))
    confirmation = build_market_frame(unified.joined(features, groups, 2025, args.confirmation_market))
    markets = {
        market: audit_market(selection, confirmation, market)
        for market in ("moneyline", "spread", "total")
    }
    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "chronology": {
            "selection": "2024-25 regular season",
            "confirmation": "2025-26 regular season",
            "warning": "The confirmation outcomes were examined by earlier broad NBA audits.",
        },
        "inputs": {
            "features": {"path": str(args.features), "sha256": sha256(args.features)},
            "selectionMarket": {"path": str(args.selection_market), "sha256": sha256(args.selection_market)},
            "confirmationMarket": {"path": str(args.confirmation_market), "sha256": sha256(args.confirmation_market)},
        },
        "fixedForecast": {
            "recipe": R4_RECIPE,
            "marginSigma": MARGIN_SIGMA,
            "totalSigma": TOTAL_SIGMA,
            "totalReaderMovement": TOTAL_READER_MOVEMENT,
            "totalReaderEdge": TOTAL_READER_EDGE,
        },
        "markets": markets,
        "historicalProxyGatePassed": all(value["confirmationPassed"] for value in markets.values()),
        "productionAuthority": False,
        "limitations": [
            "Consensus open-to-close movement is not authentic target-book-excluded same-book chronology.",
            "Historical source-qualified split flow and injury snapshots are unavailable.",
            "Moneyline fair-price units are non-executable; exact selected-book price ROI is unavailable.",
            "Spread and Total flat -110 economics are a comparable benchmark, not exact historical ROI.",
            "A candidate cannot become production authority without same-input board impact and prospective locked evaluation.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "historicalProxyGatePassed": report["historicalProxyGatePassed"],
        "markets": {
            market: {
                "selectionEligibleCandidates": value["selectionEligibleCandidates"],
                "recipe": None if value["selected"] is None else value["selected"]["recipe"],
                "selection": None if value["selected"] is None else {
                    "actionable": value["selected"]["selection"]["actionable"],
                    "bestAngle": value["selected"]["selection"]["bestAngle"],
                    "lean": value["selected"]["selection"]["lean"],
                    "boardImpact": value["selected"]["selection"]["boardImpact"],
                },
                "confirmation": None if value["selected"] is None else {
                    "passed": value["selected"]["confirmationPassed"],
                    "gates": value["selected"]["confirmationGates"],
                    "actionable": value["selected"]["confirmation"]["actionable"],
                    "bestAngle": value["selected"]["confirmation"]["bestAngle"],
                    "lean": value["selected"]["confirmation"]["lean"],
                    "boardImpact": value["selected"]["confirmation"]["boardImpact"],
                },
            }
            for market, value in markets.items()
        },
    }, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
