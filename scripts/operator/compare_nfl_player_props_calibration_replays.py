#!/usr/bin/env python3
"""Compare two SELECT-only NFL props board decision dumps."""

from __future__ import annotations

import argparse
import json
import math
import pathlib
from collections import Counter
from typing import Any


def normalize(value: str) -> str:
    return "".join(character for character in value.lower() if character.isalnum())


def key(row: dict[str, Any]) -> str:
    return "|".join(map(str, (
        row["gameId"], normalize(row["playerName"]), row["market"], row["line"],
        row["side"], normalize(row["sportsbook"]), row["provider"],
    )))


def scope_key(row: dict[str, Any]) -> str:
    return "|".join(map(str, (row["gameId"], normalize(row["playerName"]), row["market"], row["line"])))


def actionable(row: dict[str, Any]) -> bool:
    return row["grade"] in {"Best Angle", "Lean"}


def forecast_side(row: dict[str, Any]) -> str:
    if row["side"] == "yes":
        return "yes"
    if float(row["finalProbability"]) >= 0.5:
        return str(row["side"])
    return "under" if row["side"] == "over" else "over"


def grade_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(str(row["grade"]) for row in rows)
    return {grade: counts.get(grade, 0) for grade in ("Best Angle", "Lean", "Watchlist", "No Play", "Held")}


def market_counts(rows: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    output: dict[str, dict[str, int]] = {}
    for market in sorted({str(row["market"]) for row in rows}):
        values = [row for row in rows if row["market"] == market]
        output[market] = {
            "rows": len(values),
            "actionable": sum(actionable(row) for row in values),
            "actionableOver": sum(actionable(row) and forecast_side(row) == "over" for row in values),
            "actionableUnder": sum(actionable(row) and forecast_side(row) == "under" for row in values),
            "actionableYes": sum(actionable(row) and forecast_side(row) == "yes" for row in values),
        }
    return output


def over_row(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((row for row in rows if row["side"] == "over"), rows[0] if rows else None)


def over_probability(row: dict[str, Any]) -> float:
    value = float(row["finalProbability"])
    return value if row["side"] == "over" else 1.0 - value


def independent_projection(row: dict[str, Any]) -> float | None:
    evidence = row.get("projectionEvidence")
    return evidence.get("independentProjection") if isinstance(evidence, dict) else None


def binary_log_loss(probability: float, outcome: int) -> float:
    bounded = min(0.999999, max(0.000001, probability))
    return -(outcome * math.log(bounded) + (1 - outcome) * math.log(1 - bounded))


def settled_result(row: dict[str, Any], outcomes: dict[str, tuple[float, bool]]) -> dict[str, Any]:
    actual_push = outcomes.get(scope_key(row))
    if not actual_push:
        return {"settled": False}
    actual, push = actual_push
    if push:
        return {"settled": True, "push": True, "actual": actual, "won": None, "units": 0.0}
    forecast = forecast_side(row)
    won = (forecast == "over") == (actual > float(row["line"]))
    price = int(row["americanPrice"])
    units = (100 / abs(price) if price < 0 else price / 100) if won else -1.0
    return {"settled": True, "push": False, "actual": actual, "won": won, "units": units}


def resolved_metrics(
    rows: list[dict[str, Any]],
    outcomes: dict[str, tuple[float, bool]],
) -> dict[str, Any]:
    scopes: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if row["market"] == "anytime_td":
            continue
        scopes.setdefault(scope_key(row), []).append(row)
    resolved: list[tuple[dict[str, Any], int]] = []
    for identity, values in scopes.items():
        actual_push = outcomes.get(identity)
        selected = over_row(values)
        if not actual_push or not selected or actual_push[1]:
            continue
        resolved.append((selected, int(actual_push[0] > float(selected["line"]))))
    if not resolved:
        return {"rows": 0}
    probabilities = [over_probability(row) for row, _ in resolved]
    actuals = [actual for _, actual in resolved]
    predicted = [int(probability >= 0.5) for probability in probabilities]
    actionable_results = [
        (row, settled_result(row, outcomes))
        for row in rows
        if row["market"] != "anytime_td" and actionable(row)
    ]
    actionable_results = [(row, result) for row, result in actionable_results if result.get("settled") and not result.get("push")]
    return {
        "rows": len(resolved),
        "wins": sum(prediction == actual for prediction, actual in zip(predicted, actuals)),
        "brier": sum((probability - actual) ** 2 for probability, actual in zip(probabilities, actuals)) / len(resolved),
        "logLoss": sum(binary_log_loss(probability, actual) for probability, actual in zip(probabilities, actuals)) / len(resolved),
        "calibrationGap": abs(sum(probabilities) / len(resolved) - sum(actuals) / len(resolved)),
        "actionableRows": len(actionable_results),
        "actionableWins": sum(bool(result["won"]) for _, result in actionable_results),
        "actionableUnits": sum(float(result["units"]) for _, result in actionable_results),
    }


def resolved_metrics_by_market(
    rows: list[dict[str, Any]],
    outcomes: dict[str, tuple[float, bool]],
) -> dict[str, dict[str, Any]]:
    return {
        market: resolved_metrics([row for row in rows if row["market"] == market], outcomes)
        for market in sorted({str(row["market"]) for row in rows if row["market"] != "anytime_td"})
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--incumbent", type=pathlib.Path, required=True)
    parser.add_argument("--candidate", type=pathlib.Path, required=True)
    parser.add_argument("--outcomes", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    incumbent = json.loads(args.incumbent.read_text(encoding="utf-8"))["rows"]
    candidate = json.loads(args.candidate.read_text(encoding="utf-8"))["rows"]
    source = json.loads(args.outcomes.read_text(encoding="utf-8"))["rows"]
    outcomes: dict[str, tuple[float, bool]] = {}
    for row in source:
        if row.get("actual") is None:
            continue
        outcomes[scope_key(row)] = (float(row["actual"]), bool(row.get("push")))
    incumbent_map = {key(row): row for row in incumbent}
    candidate_map = {key(row): row for row in candidate}
    shared = sorted(set(incumbent_map).intersection(candidate_map))
    changes = [(incumbent_map[value], candidate_map[value]) for value in shared]
    promotions = [(before, after) for before, after in changes if not actionable(before) and actionable(after)]
    demotions = [(before, after) for before, after in changes if actionable(before) and not actionable(after)]
    point_changes = [(before, after) for before, after in changes if (
        independent_projection(before) != independent_projection(after)
    )]
    transition = lambda before, after: {
        "gameId": before["gameId"], "playerName": before["playerName"],
        "market": before["market"], "line": before["line"], "side": before["side"],
        "sportsbook": before["sportsbook"],
        "beforeProbability": before["finalProbability"], "afterProbability": after["finalProbability"],
        "beforeProjection": before.get("projection"), "afterProjection": after.get("projection"),
        "beforeForecast": forecast_side(before), "afterForecast": forecast_side(after),
        "beforeGrade": before["grade"], "afterGrade": after["grade"],
        "settledResult": settled_result(after, outcomes),
    }
    result = {
        "release": "nfl_player_props_mean_quintile_same_board_comparison_2026_10_07_r1",
        "readOnly": True,
        "writes": 0,
        "providerCalls": 0,
        "incumbentRows": len(incumbent),
        "candidateRows": len(candidate),
        "matchedRows": len(shared),
        "missingCandidateRows": len(set(incumbent_map) - set(candidate_map)),
        "addedCandidateRows": len(set(candidate_map) - set(incumbent_map)),
        "independentPointProjectionChanges": len(point_changes),
        "posteriorProjectionChanges": sum(before.get("projection") != after.get("projection") for before, after in changes),
        "probabilityChanges": sum(before["finalProbability"] != after["finalProbability"] for before, after in changes),
        "forecastSideChanges": sum(forecast_side(before) != forecast_side(after) for before, after in changes),
        "gradeChanges": sum(before["grade"] != after["grade"] for before, after in changes),
        "promotions": len(promotions),
        "demotions": len(demotions),
        "promotionDetails": [transition(before, after) for before, after in promotions],
        "demotionDetails": [transition(before, after) for before, after in demotions],
        "promotionMarkets": dict(sorted(Counter(after["market"] for _, after in promotions).items())),
        "demotionMarkets": dict(sorted(Counter(before["market"] for before, _ in demotions).items())),
        "nonpositiveEvActionables": sum(actionable(row) and float(row["expectedValue"]) <= 0 for row in candidate),
        "incumbent": {
            "grades": grade_counts(incumbent),
            "actionable": sum(actionable(row) for row in incumbent),
            "markets": market_counts(incumbent),
            "resolved": resolved_metrics(incumbent, outcomes),
            "resolvedByMarket": resolved_metrics_by_market(incumbent, outcomes),
        },
        "candidate": {
            "grades": grade_counts(candidate),
            "actionable": sum(actionable(row) for row in candidate),
            "markets": market_counts(candidate),
            "resolved": resolved_metrics(candidate, outcomes),
            "resolvedByMarket": resolved_metrics_by_market(candidate, outcomes),
        },
        "changeExamples": [transition(before, after) for before, after in changes if (
            before["finalProbability"] != after["finalProbability"]
            or before.get("projection") != after.get("projection")
            or before["grade"] != after["grade"]
        )][:80],
    }
    serialized = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(serialized, encoding="utf-8")
    print(serialized, end="")


if __name__ == "__main__":
    main()
