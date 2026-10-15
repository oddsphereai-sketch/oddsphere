#!/usr/bin/env python3
"""Chronologically audit NBA consensus open-to-close movement.

This is a research sensitivity study, not a runtime-reader backtest. The input
contains consensus opening and game-start closing values without the exact
same-book T-60 sequence used by Daily Edge.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np


RELEASE = "nba_consensus_movement_audit_2026_10_15_r1_regular_season"
THRESHOLDS = {
    "spread": (0.5, 1.0, 1.5, 2.0, 3.0, 4.0),
    "total": (0.5, 1.0, 1.5, 2.0, 3.0, 4.0),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selection-csv", required=True, type=Path)
    parser.add_argument("--confirmation-csv", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--minimum-games", type=int, default=1_200)
    return parser.parse_args()


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def number(value: Any) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise ValueError(f"non-finite NBA consensus value {value}")
    return parsed


def read_regular(path: Path, minimum_games: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(newline="") as handle:
        for raw in csv.DictReader(handle):
            if str(raw.get("season_type", "")).lower() != "regular":
                continue
            if str(raw.get("stage", "")).lower() != "regular season":
                continue
            home_score = number(raw["home_score"])
            away_score = number(raw["away_score"])
            home_win = float(home_score > away_score)
            rows.append({
                "gameId": str(raw["game_id"]),
                "homeWin": home_win,
                "margin": home_score - away_score,
                "total": home_score + away_score,
                "openHomeProbability": number(raw["open_home_win_prob"]),
                "closeHomeProbability": number(raw["close_home_win_prob"]),
                "openSpread": number(raw["open_spread_home"]),
                "closeSpread": number(raw["close_spread_home"]),
                "openTotal": number(raw["open_total"]),
                "closeTotal": number(raw["close_total"]),
            })
    if len(rows) < minimum_games:
        raise ValueError(f"regular-season consensus file is partial: {len(rows)} < {minimum_games}")
    if len({row["gameId"] for row in rows}) != len(rows):
        raise ValueError("regular-season consensus file contains duplicate games")
    return rows


def probability_metrics(rows: list[dict[str, Any]], field: str) -> dict[str, float]:
    probability = np.clip(np.array([row[field] for row in rows], dtype=float), 0.001, 0.999)
    outcome = np.array([row["homeWin"] for row in rows], dtype=float)
    return {
        "brier": float(np.square(probability - outcome).mean()),
        "logLoss": float(-(outcome * np.log(probability) + (1 - outcome) * np.log(1 - probability)).mean()),
    }


def point_error(rows: list[dict[str, Any]], market: str, moment: str) -> dict[str, float]:
    if market == "spread":
        errors = np.array([
            abs(row["margin"] + row[f"{moment}Spread"])
            for row in rows
        ], dtype=float)
    elif market == "total":
        errors = np.array([
            abs(row["total"] - row[f"{moment}Total"])
            for row in rows
        ], dtype=float)
    else:
        raise ValueError(f"unsupported market {market}")
    return {"mae": float(errors.mean()), "medianAbsoluteError": float(np.median(errors))}


def wilson_lower(wins: int, bets: int, z: float = 1.96) -> float | None:
    if bets == 0:
        return None
    rate = wins / bets
    denominator = 1 + z * z / bets
    center = rate + z * z / (2 * bets)
    margin = z * math.sqrt(rate * (1 - rate) / bets + z * z / (4 * bets * bets))
    return float((center - margin) / denominator)


def movement_candidate(
    rows: list[dict[str, Any]], market: str, threshold: float, direction: str,
) -> dict[str, Any]:
    if market == "spread":
        # More-negative home spread is movement toward the home team.
        movement = np.array([row["openSpread"] - row["closeSpread"] for row in rows], dtype=float)
        result = np.array([row["margin"] + row["closeSpread"] for row in rows], dtype=float)
    elif market == "total":
        movement = np.array([row["closeTotal"] - row["openTotal"] for row in rows], dtype=float)
        result = np.array([row["total"] - row["closeTotal"] for row in rows], dtype=float)
    else:
        raise ValueError(f"unsupported market {market}")
    eligible = (np.abs(movement) >= threshold) & ~np.isclose(result, 0.0)
    predicted_first = movement > 0
    if direction == "fade":
        predicted_first = ~predicted_first
    elif direction != "follow":
        raise ValueError(f"unsupported movement direction {direction}")
    wins = predicted_first[eligible] == (result[eligible] > 0)
    bets = int(eligible.sum())
    win_count = int(wins.sum())
    return {
        "market": market,
        "direction": direction,
        "threshold": threshold,
        "bets": bets,
        "wins": win_count,
        "losses": bets - win_count,
        "accuracy": float(wins.mean()) if bets else None,
        "wilson95Lower": wilson_lower(win_count, bets),
        "gradingLine": "consensus_close",
    }


def choose_rule(rows: list[dict[str, Any]], market: str) -> dict[str, Any]:
    minimum_bets = min(150, max(50, len(rows) // 10))
    candidates = [
        movement_candidate(rows, market, threshold, direction)
        for threshold in THRESHOLDS[market]
        for direction in ("follow", "fade")
    ]
    eligible = [candidate for candidate in candidates if candidate["bets"] >= minimum_bets]
    eligible.sort(key=lambda item: (
        -(item["wilson95Lower"] if item["wilson95Lower"] is not None else -math.inf),
        -(item["accuracy"] if item["accuracy"] is not None else -math.inf),
        -item["bets"],
    ))
    return {
        "minimumSelectionBets": minimum_bets,
        "selected": eligible[0] if eligible else None,
        "candidates": candidates,
    }


def main() -> None:
    args = parse_args()
    if args.minimum_games < 1:
        raise ValueError("minimum games must be positive")
    selection = read_regular(args.selection_csv, args.minimum_games)
    confirmation = read_regular(args.confirmation_csv, args.minimum_games)
    selected_rules = {market: choose_rule(selection, market) for market in ("spread", "total")}
    confirmation_rules = {
        market: None if details["selected"] is None else movement_candidate(
            confirmation,
            market,
            float(details["selected"]["threshold"]),
            str(details["selected"]["direction"]),
        )
        for market, details in selected_rules.items()
    }
    selection_probability = {
        "open": probability_metrics(selection, "openHomeProbability"),
        "close": probability_metrics(selection, "closeHomeProbability"),
    }
    confirmation_probability = {
        "open": probability_metrics(confirmation, "openHomeProbability"),
        "close": probability_metrics(confirmation, "closeHomeProbability"),
    }
    report = {
        "release": RELEASE,
        "sampleBoundary": {
            "competition": "NBA",
            "seasonType": "regular_season_only",
            "preseasonEligible": False,
            "postseasonEligible": False,
            "selectionGames": len(selection),
            "confirmationGames": len(confirmation),
        },
        "inputs": {
            "selection": {"path": str(args.selection_csv), "sha256": sha256(args.selection_csv)},
            "confirmation": {"path": str(args.confirmation_csv), "sha256": sha256(args.confirmation_csv)},
        },
        "moneylineProbability": {
            "selection": selection_probability,
            "confirmation": confirmation_probability,
            "confirmationCloseImprovesBrier": (
                confirmation_probability["close"]["brier"] < confirmation_probability["open"]["brier"]
            ),
            "confirmationCloseImprovesLogLoss": (
                confirmation_probability["close"]["logLoss"] < confirmation_probability["open"]["logLoss"]
            ),
        },
        "pointBenchmarks": {
            market: {
                "selection": {
                    "open": point_error(selection, market, "open"),
                    "close": point_error(selection, market, "close"),
                },
                "confirmation": {
                    "open": point_error(confirmation, market, "open"),
                    "close": point_error(confirmation, market, "close"),
                },
            }
            for market in ("spread", "total")
        },
        "movementRules": {
            market: {
                "selection": selected_rules[market],
                "confirmation": confirmation_rules[market],
                "confirmationDirectionalGate": bool(
                    confirmation_rules[market] is not None
                    and confirmation_rules[market]["accuracy"] is not None
                    and confirmation_rules[market]["accuracy"] >= 0.524
                    and confirmation_rules[market]["wilson95Lower"] is not None
                    and confirmation_rules[market]["wilson95Lower"] > 0.5
                ),
            }
            for market in ("spread", "total")
        },
        "authority": {
            "sensitivityOnly": True,
            "runtimeReaderRuleAuthorized": False,
            "reason": "consensus open/close lacks the exact same-book T-60 sequence and price used by the live reader",
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "output": str(args.output),
        "moneylineProbability": report["moneylineProbability"],
        "movementConfirmation": {
            market: report["movementRules"][market]["confirmation"]
            for market in ("spread", "total")
        },
    }, indent=2))


if __name__ == "__main__":
    main()
