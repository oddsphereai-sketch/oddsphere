#!/usr/bin/env python3
"""Summarize a detailed CFB complete-product replay from immutable pregame rows."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


MARKETS = ("moneyline", "spread", "total")
ACTIONABLE = {"Best Angle", "Lean"}


def finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def block(starts_at: str) -> str:
    date = starts_at[:10]
    if date <= "2026-09-27":
        return "development"
    if date <= "2026-10-04":
        return "confirmation"
    return "later_opened"


def result_for(game: dict[str, Any], market: str, cushion: float = 0) -> str | None:
    decision = game["markets"].get(market)
    actual = game.get("actualScore") or {}
    away = finite(actual.get("away"))
    home = finite(actual.get("home"))
    if not decision or away is None or home is None:
        return None
    side = decision.get("candidateSide")
    if market == "moneyline":
        if away == home:
            return "push"
        winner = "first" if away > home else "second"
        return "win" if side == winner else "loss"
    line = finite(decision.get("line"))
    if line is None:
        return None
    if market == "spread":
        selected_margin = (away - home - line) if side == "first" else (home - away + line)
    else:
        selected_margin = (away + home - line) if side == "first" else (line - away - home)
    selected_margin += cushion
    if abs(selected_margin) < 1e-9:
        return "push"
    return "win" if selected_margin > 0 else "loss"


def directional_summary(games: list[dict[str, Any]], market: str, cushion: float = 0) -> dict[str, Any]:
    results = [result for game in games if (result := result_for(game, market, cushion)) is not None]
    wins = results.count("win")
    losses = results.count("loss")
    pushes = results.count("push")
    decided = wins + losses
    return {
        "games": len(results),
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "accuracy": wins / decided if decided else None,
    }


def probability_summary(games: list[dict[str, Any]], market: str) -> dict[str, Any]:
    observations = []
    for game in games:
        decision = game["markets"].get(market)
        probability = finite((decision or {}).get("candidateProbability"))
        result = result_for(game, market)
        if probability is None or result == "push" or result is None:
            continue
        probability = min(1 - 1e-12, max(1e-12, probability))
        outcome = 1 if result == "win" else 0
        observations.append((probability, outcome))
    if not observations:
        return {"observations": 0, "brier": None, "logLoss": None, "calibration": []}
    bins = []
    for lower in (0.5, 0.6, 0.7, 0.8, 0.9):
        upper = lower + 0.1
        selected = [
            (probability, outcome)
            for probability, outcome in observations
            if lower <= probability < upper or (upper >= 1 and lower <= probability <= 1)
        ]
        if selected:
            bins.append({
                "minimum": lower,
                "maximum": min(1, upper),
                "observations": len(selected),
                "meanProbability": sum(row[0] for row in selected) / len(selected),
                "observedRate": sum(row[1] for row in selected) / len(selected),
            })
    return {
        "observations": len(observations),
        "brier": sum((probability - outcome) ** 2 for probability, outcome in observations) / len(observations),
        "logLoss": -sum(outcome * math.log(probability) + (1 - outcome) * math.log(1 - probability) for probability, outcome in observations) / len(observations),
        "calibration": bins,
    }


def score_summary(games: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    for game in games:
        actual = game.get("actualScore") or {}
        predicted = game.get("candidateScore") or {}
        away_actual = finite(actual.get("away"))
        home_actual = finite(actual.get("home"))
        away_predicted = finite(predicted.get("away"))
        home_predicted = finite(predicted.get("home"))
        if None in (away_actual, home_actual, away_predicted, home_predicted):
            continue
        rows.append((away_actual, home_actual, away_predicted, home_predicted))
    if not rows:
        return {"games": 0, "teamScoreMae": None, "marginMae": None, "totalMae": None}
    return {
        "games": len(rows),
        "teamScoreMae": sum(abs(row[0] - row[2]) + abs(row[1] - row[3]) for row in rows) / (2 * len(rows)),
        "marginMae": sum(abs((row[1] - row[0]) - (row[3] - row[2])) for row in rows) / len(rows),
        "totalMae": sum(abs((row[0] + row[1]) - (row[2] + row[3])) for row in rows) / len(rows),
    }


def market_summary(games: list[dict[str, Any]], market: str) -> dict[str, Any]:
    rows = [game for game in games if game["markets"].get(market)]
    actionable = [
        game for game in rows
        if game["markets"][market].get("runtimeCandidateGrade", game["markets"][market].get("candidateGrade")) in ACTIONABLE
    ]
    output = {
        "direction": directional_summary(rows, market),
        "actionableDirection": directional_summary(actionable, market),
        "probability": probability_summary(rows, market),
        "grades": dict(Counter(
            game["markets"][market].get("runtimeCandidateGrade", game["markets"][market].get("candidateGrade"))
            for game in rows
        )),
        "byBlock": {
            name: directional_summary([game for game in rows if block(game["startsAt"]) == name], market)
            for name in ("development", "confirmation", "later_opened")
        },
    }
    if market != "moneyline":
        output["plus3"] = directional_summary(rows, market, 3)
        output["plus6"] = directional_summary(rows, market, 6)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--replay", type=Path, required=True)
    parser.add_argument("--actual-replay", type=Path)
    args = parser.parse_args()
    replay = json.loads(args.replay.read_text())
    games = replay["games"]
    if args.actual_replay:
        actual_games = json.loads(args.actual_replay.read_text())["games"]
        actual_by_game = {str(game["gameId"]): game.get("actualScore") for game in actual_games}
        games = [
            {**game, "actualScore": actual_by_game.get(str(game["gameId"]))}
            if game.get("actualScore") is None else game
            for game in games
        ]
    coordinator = [game.get("coordinator") for game in games if game.get("coordinator")]
    output = {
        "release": "cfb_complete_product_replay_summary_2026_10_15_r1",
        "sourceReplay": str(args.replay),
        "games": len(games),
        "score": score_summary(games),
        "markets": {market: market_summary(games, market) for market in MARKETS},
        "coordinator": {
            "evaluated": len(coordinator),
            "rawBoundaryCrosses": sum(row.get("rawApplied", row.get("applied")) is True for row in coordinator),
            "applied": sum(row.get("applied") is True for row in coordinator),
            "suppressed": sum(row.get("suppressedByMinimumSelectedProbability") is True for row in coordinator),
        },
        "completeProduct": {
            "directionWins": sum(directional_summary(games, market)["wins"] for market in MARKETS),
            "directionLosses": sum(directional_summary(games, market)["losses"] for market in MARKETS),
            "directionPushes": sum(directional_summary(games, market)["pushes"] for market in MARKETS),
        },
    }
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
