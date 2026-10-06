#!/usr/bin/env python3
"""Read-only Week 3 NFL props market-marriage diagnostic.

The input is the immutable member snapshot plus settled official outcomes exported
by export-nfl-player-props-forward-replay.ts. This script never calls a provider
or writes production state. It evaluates one representative main line per
game/player/market so legacy locked alternate ladders cannot dominate results.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
from collections import defaultdict
from typing import Any


DEFAULT_INPUT = pathlib.Path(
    "football-research/cache/nfl-player-props-forward/"
    "nfl_player_props_forward_replay_r1.json"
)
DEFAULT_OUTPUT = pathlib.Path(
    "football-research/cache/nfl-player-props-forward/"
    "nfl_player_props_market_marriage_audit_r1.json"
)


def bounded(value: float) -> float:
    return min(1 - 1e-6, max(1e-6, value))


def logit(value: float) -> float:
    value = bounded(value)
    return math.log(value / (1 - value))


def sigmoid(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def implied(price: float) -> float:
    return -price / (-price + 100) if price < 0 else 100 / (price + 100)


def no_vig(over: float | None, under: float | None) -> float | None:
    if over is None or under is None:
        return None
    left, right = implied(float(over)), implied(float(under))
    return left / (left + right)


def metrics(rows: list[dict[str, Any]], field: str) -> dict[str, Any]:
    usable = [row for row in rows if isinstance(row.get(field), (int, float))]
    if not usable:
        return {"rows": 0, "brier": None, "logLoss": None, "directionAccuracy": None, "overRate": None}
    probabilities = [bounded(float(row[field])) for row in usable]
    outcomes = [int(row["actual"] > row["line"]) for row in usable]
    return {
        "rows": len(usable),
        "brier": sum((p - y) ** 2 for p, y in zip(probabilities, outcomes)) / len(usable),
        "logLoss": -sum(y * math.log(p) + (1 - y) * math.log(1 - p) for p, y in zip(probabilities, outcomes)) / len(usable),
        "directionAccuracy": sum((p >= 0.5) == bool(y) for p, y in zip(probabilities, outcomes)) / len(usable),
        "overRate": sum(outcomes) / len(outcomes),
    }


def representative_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("actual") is None or row.get("side") != "over" or row.get("push"):
            continue
        grouped[(str(row["gameId"]), str(row["playerName"]), str(row["market"]))].append(row)
    selected: list[dict[str, Any]] = []
    for candidates in grouped.values():
        # The main line is the balanced line; newest evidence breaks a tie.
        selected.append(min(candidates, key=lambda row: (
            abs(float(row.get("marketProbability") or 0.5) - 0.5),
            -int(__import__("datetime").datetime.fromisoformat(str(row["observedAt"]).replace("Z", "+00:00")).timestamp()),
            float(row["line"]),
        )))
    return selected


def add_evidence_probabilities(row: dict[str, Any]) -> None:
    evidence = row.get("evidence")
    if not evidence:
        row["sharpProbability"] = None
        row["retailProbability"] = None
        row["movementProbability"] = None
        return
    sharp: list[float] = []
    retail: list[float] = []
    movement_votes: list[float] = []
    for book in evidence.get("books", []):
        source_class = book[2]
        target_mask = int(book[14])
        probability = no_vig(book[8], book[9])
        if probability is not None and target_mask & 1 == 0:
            (sharp if source_class == "s" else retail).append(probability)
        opening_line, current_line = book[7], row["line"]
        opening_probability = no_vig(book[11], book[12])
        current_probability = no_vig(book[8], book[9])
        if opening_line is not None and current_line != opening_line:
            movement_votes.append(0.75 if current_line > opening_line else 0.25)
        elif opening_probability is not None and current_probability is not None:
            delta = current_probability - opening_probability
            if abs(delta) >= 0.025:
                movement_votes.append(0.75 if delta > 0 else 0.25)
    row["sharpProbability"] = sum(sharp) / len(sharp) if sharp else None
    row["retailProbability"] = sum(retail) / len(retail) if retail else None
    row["movementProbability"] = sum(movement_votes) / len(movement_votes) if movement_votes else None


def grid(rows: list[dict[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for weight in (0.0, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0):
        field = f"blend_{weight:g}"
        for row in rows:
            row[field] = sigmoid((1 - weight) * logit(float(row["marketProbability"])) + weight * logit(float(row["rawProbability"])))
        result[f"modelWeight{weight:g}"] = metrics(rows, field)
    return result


def disagreement(rows: list[dict[str, Any]], evidence_field: str) -> dict[str, Any]:
    usable = [row for row in rows if isinstance(row.get(evidence_field), (int, float))]
    disagreements = [row for row in usable if (float(row["rawProbability"]) >= 0.5) != (float(row[evidence_field]) >= 0.5)]
    model_wins = sum((float(row["rawProbability"]) >= 0.5) == (row["actual"] > row["line"]) for row in disagreements)
    evidence_wins = sum((float(row[evidence_field]) >= 0.5) == (row["actual"] > row["line"]) for row in disagreements)
    return {
        "available": len(usable), "disagreements": len(disagreements),
        "independentDirectionWins": model_wins,
        "evidenceDirectionWins": evidence_wins,
    }


def chronological_game_split(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    ordered_games = sorted(
        {str(row["gameId"]): str(row["lockAt"]) for row in rows}.items(),
        key=lambda item: (item[1], item[0]),
    )
    midpoint = max(1, len(ordered_games) // 2)
    selection_games = {game for game, _ in ordered_games[:midpoint]}
    confirmation_games = {game for game, _ in ordered_games[midpoint:]}
    return {
        "selection": [row for row in rows if str(row["gameId"]) in selection_games],
        "confirmation": [row for row in rows if str(row["gameId"]) in confirmation_games],
    }


def weight_tournament(rows: list[dict[str, Any]]) -> dict[str, Any]:
    candidates = (0.0, 0.1, 0.2, 0.35, 0.5, 0.75, 1.0)
    periods = chronological_game_split(rows)
    result: dict[str, Any] = {"games": {
        period: len({str(row["gameId"]) for row in period_rows})
        for period, period_rows in periods.items()
    }, "byMarket": {}}
    for market in sorted({str(row["market"]) for row in rows}):
        selection = [row for row in periods["selection"] if row["market"] == market]
        confirmation = [row for row in periods["confirmation"] if row["market"] == market]
        scored = []
        for weight in candidates:
            field = f"chronological_blend_{weight:g}"
            for row in rows:
                row[field] = sigmoid((1 - weight) * logit(float(row["marketProbability"])) + weight * logit(float(row["rawProbability"])))
            scored.append((weight, metrics(selection, field)))
        selected_weight, selected_metrics = min(
            scored,
            key=lambda item: (float(item[1]["brier"]), -float(item[1]["directionAccuracy"]), item[0]),
        )
        selected_field = f"chronological_blend_{selected_weight:g}"
        incumbent_selection = metrics(selection, "finalProbability")
        incumbent_confirmation = metrics(confirmation, "finalProbability")
        candidate_confirmation = metrics(confirmation, selected_field)
        result["byMarket"][market] = {
            "selectedModelWeight": selected_weight,
            "selection": {"incumbent": incumbent_selection, "candidate": selected_metrics},
            "confirmation": {"incumbent": incumbent_confirmation, "candidate": candidate_confirmation},
            "confirmationPass": (
                candidate_confirmation["brier"] <= incumbent_confirmation["brier"]
                and candidate_confirmation["directionAccuracy"] >= incumbent_confirmation["directionAccuracy"]
            ),
        }
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=pathlib.Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    rows = representative_rows(payload["rows"])
    for row in rows:
        add_evidence_probabilities(row)
    markets = sorted({str(row["market"]) for row in rows})
    report = {
        "release": "nfl_player_props_market_marriage_audit_2026_09_29_r1",
        "readOnly": True,
        "writes": 0,
        "providerCalls": 0,
        "sourceRelease": payload["release"],
        "selection": "one_balanced_main_line_per_game_player_market_over_outcome",
        "rows": len(rows),
        "overall": {
            "independent": metrics(rows, "rawProbability"),
            "market": metrics(rows, "marketProbability"),
            "incumbentFinal": metrics(rows, "finalProbability"),
            "weights": grid(rows),
            "sharpDisagreement": disagreement(rows, "sharpProbability"),
            "retailDisagreement": disagreement(rows, "retailProbability"),
            "movementDisagreement": disagreement(rows, "movementProbability"),
        },
        "chronologicalWeightTournament": weight_tournament(rows),
        "byMarket": {},
    }
    for market in markets:
        cohort = [row for row in rows if row["market"] == market]
        report["byMarket"][market] = {
            "independent": metrics(cohort, "rawProbability"),
            "market": metrics(cohort, "marketProbability"),
            "incumbentFinal": metrics(cohort, "finalProbability"),
            "weights": grid(cohort),
            "sharpDisagreement": disagreement(cohort, "sharpProbability"),
            "retailDisagreement": disagreement(cohort, "retailProbability"),
            "movementDisagreement": disagreement(cohort, "movementProbability"),
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "rows": len(rows),
        "overall": report["overall"],
        "byMarket": report["byMarket"],
    }, indent=2))


if __name__ == "__main__":
    main()
