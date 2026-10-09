#!/usr/bin/env python3
"""Read-only 2026 NFL player-props same-book movement audit by market."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import random
from collections import defaultdict
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_INPUT = ROOT / (
    "football-research/cache/nfl-player-props-external/tournament/"
    "nfl_player_props_2026_locked_replay_rows_r1.json"
)
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
    "anytime_td",
)
PRICE_FLOORS_PP = (1.0, 2.5, 5.0)
SEED = 20261009


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def american_implied(price: float) -> float:
    return -price / (-price + 100.0) if price < 0 else 100.0 / (price + 100.0)


def signal(row: dict[str, Any], floor_pp: float) -> str:
    opening_line = row.get("openingLine")
    current_line = row.get("line")
    side = row.get("side")
    if isinstance(opening_line, (int, float)) and isinstance(current_line, (int, float)):
        delta = float(current_line) - float(opening_line)
        if abs(delta) > 1e-12:
            supports = (side == "over" and delta < 0) or (side == "under" and delta > 0)
            return "support" if supports else "adverse"
    opening_price = row.get("openingPrice")
    locked_price = row.get("lockedPrice")
    if isinstance(opening_price, (int, float)) and isinstance(locked_price, (int, float)):
        delta_pp = 100.0 * (american_implied(float(locked_price)) - american_implied(float(opening_price)))
        if abs(delta_pp) + 1e-12 >= floor_pp:
            return "support" if delta_pp > 0 else "adverse"
    return "neutral"


def safe_rate(rows: list[dict[str, Any]]) -> float | None:
    return sum(int(row["outcome"]) for row in rows) / len(rows) if rows else None


def probability_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    usable = [row for row in rows if isinstance(row.get("final"), (int, float))]
    if not usable:
        return {"rows": 0, "brier": None, "logLoss": None, "meanProbability": None, "observedRate": None}
    probabilities = [min(1 - 1e-9, max(1e-9, float(row["final"]))) for row in usable]
    outcomes = [int(row["outcome"]) for row in usable]
    return {
        "rows": len(usable),
        "brier": sum((p - y) ** 2 for p, y in zip(probabilities, outcomes)) / len(usable),
        "logLoss": -sum(y * math.log(p) + (1 - y) * math.log(1 - p) for p, y in zip(probabilities, outcomes)) / len(usable),
        "meanProbability": sum(probabilities) / len(probabilities),
        "observedRate": sum(outcomes) / len(outcomes),
    }


def cohort_summary(rows: list[dict[str, Any]], floor_pp: float) -> dict[str, Any]:
    grouped = {name: [row for row in rows if signal(row, floor_pp) == name] for name in ("support", "adverse", "neutral")}
    support_rate = safe_rate(grouped["support"])
    adverse_rate = safe_rate(grouped["adverse"])
    base_wins = sum(int(row["outcome"]) for row in rows)
    flipped_wins = sum(1 - int(row["outcome"]) if signal(row, floor_pp) == "adverse" else int(row["outcome"]) for row in rows)
    return {
        "rows": len(rows),
        "games": len({str(row["gameId"]) for row in rows}),
        "baseWins": base_wins,
        "baseAccuracy": base_wins / len(rows) if rows else None,
        "fullyFlipAdverseWins": flipped_wins,
        "fullyFlipAdverseAccuracy": flipped_wins / len(rows) if rows else None,
        "supportMinusAdverseWinRate": support_rate - adverse_rate if support_rate is not None and adverse_rate is not None else None,
        "states": {
            name: {
                "rows": len(values),
                "games": len({str(row["gameId"]) for row in values}),
                "wins": sum(int(row["outcome"]) for row in values),
                "winRate": safe_rate(values),
                "lockedFinalProbability": probability_metrics(values),
            }
            for name, values in grouped.items()
        },
    }


def select_floor(rows: list[dict[str, Any]]) -> tuple[float, dict[str, Any]]:
    reports = {str(floor): cohort_summary(rows, floor) for floor in PRICE_FLOORS_PP}
    def key(floor: float) -> tuple[float, int, float]:
        report = reports[str(floor)]
        gap = report["supportMinusAdverseWinRate"]
        directional = report["states"]["support"]["rows"] + report["states"]["adverse"]["rows"]
        return (float(gap) if gap is not None else float("-inf"), directional, floor)
    selected = max(PRICE_FLOORS_PP, key=key)
    return selected, reports


def quantile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    index = (len(ordered) - 1) * probability
    lower = math.floor(index)
    fraction = index - lower
    return ordered[lower] * (1 - fraction) + ordered[min(lower + 1, len(ordered) - 1)] * fraction


def clustered_interval(rows: list[dict[str, Any]], floor_pp: float, iterations: int = 4000) -> dict[str, Any]:
    support_games = {str(row["gameId"]) for row in rows if signal(row, floor_pp) == "support"}
    adverse_games = {str(row["gameId"]) for row in rows if signal(row, floor_pp) == "adverse"}
    if len(support_games) < 5 or len(adverse_games) < 5:
        return {
            "available": False, "iterations": 0, "games": len({str(row["gameId"]) for row in rows}),
            "supportGames": len(support_games), "adverseGames": len(adverse_games),
            "reason": "fewer_than_five_games_in_each_directional_state",
        }
    games = sorted({str(row["gameId"]) for row in rows})
    by_game: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_game[str(row["gameId"])].append(row)
    rng = random.Random(SEED)
    values: list[float] = []
    for _ in range(iterations):
        sample = [row for _ in games for row in by_game[rng.choice(games)]]
        support = [row for row in sample if signal(row, floor_pp) == "support"]
        adverse = [row for row in sample if signal(row, floor_pp) == "adverse"]
        if support and adverse:
            values.append(float(safe_rate(support)) - float(safe_rate(adverse)))
    if not values:
        return {"available": False, "iterations": 0, "reason": "bootstrap_states_unavailable"}
    return {
        "available": True, "iterations": len(values), "games": len(games),
        "supportGames": len(support_games), "adverseGames": len(adverse_games),
        "lower95": quantile(values, 0.025), "median": quantile(values, 0.5), "upper95": quantile(values, 0.975),
    }


def validate(rows: list[dict[str, Any]]) -> None:
    required = {
        "week", "gameId", "playerName", "market", "line", "side", "sportsbook", "lockedAt",
        "actual", "outcome", "final", "openingLine", "openingPrice", "lockedPrice",
    }
    for index, row in enumerate(rows):
        missing = sorted(required - set(row))
        if missing:
            raise RuntimeError(f"row {index} missing required fields: {missing}")
        if int(row["week"]) not in (1, 2, 3, 4):
            raise RuntimeError(f"row {index} is outside Weeks 1-4")
        if row["market"] not in MARKETS:
            raise RuntimeError(f"row {index} has unsupported market {row['market']}")
        if int(row["outcome"]) not in (0, 1):
            raise RuntimeError(f"row {index} has invalid outcome")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=pathlib.Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=pathlib.Path)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    rows = payload["rows"]
    validate(rows)
    by_market: dict[str, Any] = {}
    for market in MARKETS:
        cohort = [row for row in rows if row["market"] == market]
        selection = [row for row in cohort if int(row["week"]) <= 2]
        confirmation = [row for row in cohort if int(row["week"]) >= 3]
        selected_floor, selection_grid = select_floor(selection)
        selection_report = cohort_summary(selection, selected_floor)
        confirmation_report = cohort_summary(confirmation, selected_floor)
        selection_gap = selection_report["supportMinusAdverseWinRate"]
        confirmation_gap = confirmation_report["supportMinusAdverseWinRate"]
        same_sign = selection_gap is not None and confirmation_gap is not None and selection_gap * confirmation_gap > 0
        confirmation_states = confirmation_report["states"]
        directionally_interesting = bool(
            same_sign
            and confirmation_report["rows"] >= 20
            and confirmation_states["support"]["games"] >= 5
            and confirmation_states["adverse"]["games"] >= 5
            and abs(float(confirmation_gap)) >= 0.05
        )
        by_market[market] = {
            "selectedPriceFloorPp": selected_floor,
            "selectionGrid": selection_grid,
            "selectionWeeks1To2": selection_report,
            "confirmationWeeks3To4": confirmation_report,
            "confirmationClusteredSupportMinusAdverse95": clustered_interval(confirmation, selected_floor),
            "directionallyInterestingAuditOnly": directionally_interesting,
            "sameGapSign": same_sign,
        }

    output = {
        "release": "nfl_player_props_2026_market_observer_by_prop_2026_10_09_r1",
        "predeclaration": "docs/model-audits/2026-10-09-nfl-player-props-market-observer-2026-predeclaration.md",
        "readOnly": True,
        "writes": 0,
        "providerCalls": 0,
        "input": {"release": payload.get("release"), "sha256": sha256_file(args.input)},
        "scope": {
            "rows": len(rows), "games": len({str(row["gameId"]) for row in rows}),
            "weeks": sorted({int(row["week"]) for row in rows}),
            "actionableSelectionSample": True,
            "completeBoard": False,
            "openingObservationTimestampsAvailable": False,
            "intermediateSnapshotsAvailable": False,
            "postT60CloseAvailable": False,
            "playerPositionAvailable": False,
            "sourceClassAvailable": False,
            "targetExcludedPairAvailable": False,
            "openingLineRows": sum(isinstance(row.get("openingLine"), (int, float)) for row in rows),
            "openingPriceRows": sum(isinstance(row.get("openingPrice"), (int, float)) for row in rows),
        },
        "byMarket": by_market,
        "productionAuthority": {
            "authorized": False,
            "reason": "Actionable-only archive lacks the complete board, paired promotions, full timestamps/sequences, positions, and source-separated target-excluded evidence.",
        },
    }
    encoded = json.dumps(output, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")


if __name__ == "__main__":
    main()
