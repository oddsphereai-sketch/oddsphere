#!/usr/bin/env python3
"""Read-only exact-offer replay for player-prop residual-distribution challengers.

The challenger artifact must be frozen without using the exact replay outcomes. This audit then
applies it to the immutable board projections, lines, outcomes, and exact offered prices. It does
not recreate the production grade policy, so it reports independent probability quality, side
changes, and exact-price units without claiming whole-board promotions or demotions.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import re
from typing import Any

import numpy as np
import pandas as pd


DEFAULT_MARKETS = (
    "passing_attempts",
    "passing_completions",
    "passing_yards",
    "rushing_attempts",
    "rushing_yards",
    "receptions",
    "receiving_yards",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--distribution-result", type=pathlib.Path, required=True)
    parser.add_argument("--board", type=pathlib.Path, required=True)
    parser.add_argument("--position-history", type=pathlib.Path)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--markets", nargs="*", default=list(DEFAULT_MARKETS))
    return parser.parse_args()


def normalize_name(value: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value).lower())


def over_probability(distribution: dict[str, Any], projection: float, line: float) -> float:
    if distribution["family"] != "empirical_residual_mean_bucket":
        raise RuntimeError(f"unsupported distribution family: {distribution['family']}")
    selected = next(
        (
            item
            for item in distribution["buckets"]
            if float(item["lower"]) <= projection <= float(item["upper"])
        ),
        None,
    )
    residuals = (selected["distribution"] if selected else distribution["fallback"])[
        "residualQuantiles"
    ]
    values = np.asarray(residuals, dtype=float)
    target = line - max(projection, 1e-6)
    probability = 1 - np.searchsorted(values, target, side="right") / len(values)
    return float(np.clip(probability, 1e-9, 1 - 1e-9))


def profit_multiple(price: int) -> float:
    return price / 100 if price > 0 else 100 / abs(price)


def expected_value(probability: float, price: int) -> float:
    return probability * profit_multiple(price) - (1 - probability)


def realized_units(won: bool, price: int) -> float:
    return profit_multiple(price) if won else -1.0


def best_prices(offers: list[dict[str, Any]], markets: set[str]) -> dict[tuple[str, str, str, float, str], int]:
    values: dict[tuple[str, str, str, float, str], int] = {}
    for row in offers:
        if row.get("market") not in markets or row.get("americanPrice") is None:
            continue
        key = (
            str(row["gameId"]),
            normalize_name(row["playerName"]),
            str(row["market"]),
            float(row["line"]),
            str(row["side"]).lower(),
        )
        price = int(row["americanPrice"])
        values[key] = max(values.get(key, -100000), price)
    return values


def position_map(path: pathlib.Path | None) -> dict[str, str]:
    if path is None:
        return {}
    values = pd.read_parquet(path, columns=["season", "week", "player_name", "position"])
    values = values.dropna(subset=["player_name", "position"]).sort_values(["season", "week"])
    return {
        normalize_name(row.player_name): str(row.position).upper()
        for row in values.itertuples(index=False)
    }


def metrics(rows: list[dict[str, Any]], prefix: str) -> dict[str, Any]:
    if not rows:
        return {"rows": 0}
    over_probability_values = np.asarray([row[f"{prefix}OverProbability"] for row in rows], dtype=float)
    actual_over = np.asarray([row["actualOver"] for row in rows], dtype=float)
    side_probability = np.maximum(over_probability_values, 1 - over_probability_values)
    direction_correct = np.asarray([row[f"{prefix}DirectionCorrect"] for row in rows], dtype=float)
    prices = [row[f"{prefix}Price"] for row in rows]
    priced_mask = np.asarray([price is not None for price in prices], dtype=bool)
    units = [
        realized_units(bool(row[f"{prefix}DirectionCorrect"]), int(row[f"{prefix}Price"]))
        for row in rows
        if row[f"{prefix}Price"] is not None
    ]
    positive_ev = [
        row
        for row in rows
        if row[f"{prefix}Price"] is not None
        and expected_value(float(row[f"{prefix}SideProbability"]), int(row[f"{prefix}Price"])) > 0
    ]
    positive_ev_units = [
        realized_units(bool(row[f"{prefix}DirectionCorrect"]), int(row[f"{prefix}Price"]))
        for row in positive_ev
    ]
    clipped = np.clip(over_probability_values, 1e-9, 1 - 1e-9)
    return {
        "rows": len(rows),
        "overRate": float(actual_over.mean()),
        "meanOverProbability": float(over_probability_values.mean()),
        "brier": float(np.mean(np.square(over_probability_values - actual_over))),
        "logLoss": float(np.mean(-(actual_over * np.log(clipped) + (1 - actual_over) * np.log(1 - clipped)))),
        "overCalibrationGap": float(abs(over_probability_values.mean() - actual_over.mean())),
        "directionWins": int(direction_correct.sum()),
        "directionLosses": int(len(rows) - direction_correct.sum()),
        "directionAccuracy": float(direction_correct.mean()),
        "confidenceCalibrationGap": float(abs(side_probability.mean() - direction_correct.mean())),
        "pricedRows": int(priced_mask.sum()),
        "exactPriceUnits": float(sum(units)),
        "positiveEvRows": len(positive_ev),
        "positiveEvWins": int(sum(row[f"{prefix}DirectionCorrect"] for row in positive_ev)),
        "positiveEvUnits": float(sum(positive_ev_units)),
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    if not rows:
        return {
            "reference": {"rows": 0},
            "candidate": {"rows": 0},
            "comparison": {
                "sideChanges": 0,
                "candidateMinusReferenceBrier": None,
                "candidateMinusReferenceLogLoss": None,
                "candidateMinusReferenceDirectionWins": 0,
                "candidateMinusReferenceExactPriceUnits": 0.0,
            },
        }
    reference = metrics(rows, "reference")
    candidate = metrics(rows, "candidate")
    return {
        "reference": reference,
        "candidate": candidate,
        "comparison": {
            "sideChanges": int(sum(row["referenceSide"] != row["candidateSide"] for row in rows)),
            "candidateMinusReferenceBrier": (
                candidate.get("brier", math.nan) - reference.get("brier", math.nan)
            ),
            "candidateMinusReferenceLogLoss": (
                candidate.get("logLoss", math.nan) - reference.get("logLoss", math.nan)
            ),
            "candidateMinusReferenceDirectionWins": (
                candidate.get("directionWins", 0) - reference.get("directionWins", 0)
            ),
            "candidateMinusReferenceExactPriceUnits": (
                candidate.get("exactPriceUnits", 0.0) - reference.get("exactPriceUnits", 0.0)
            ),
        },
    }


def main() -> None:
    args = parse_args()
    tournament = json.loads(args.distribution_result.read_text(encoding="utf-8"))
    board = json.loads(args.board.read_text(encoding="utf-8"))
    markets = set(args.markets)
    prices = best_prices(board["exactOfferRows"], markets)
    positions = position_map(args.position_history)
    rows: list[dict[str, Any]] = []

    for source in board["forecasts"]:
        market = str(source.get("market"))
        if market not in markets or not source.get("canonicalMainLine"):
            continue
        if source.get("result") not in {"win", "loss"}:
            continue
        projection = source.get("independentProjection")
        if projection is None or source.get("rawProbability") is None:
            continue
        line = float(source["line"])
        actual = float(source["actual"])
        if actual == line:
            continue
        reference_side = str(source["prediction"]).lower()
        reference_selected_probability = float(source["rawProbability"])
        reference_over = (
            reference_selected_probability if reference_side == "over" else 1 - reference_selected_probability
        )
        candidate_over = over_probability(
            tournament["productionDistributions"][market], float(projection), line
        )
        candidate_side = "over" if candidate_over >= 0.5 else "under"
        candidate_selected_probability = max(candidate_over, 1 - candidate_over)
        actual_side = "over" if actual > line else "under"
        key_prefix = (
            str(source["gameId"]),
            normalize_name(source["playerName"]),
            market,
            line,
        )
        reference_price = source.get("bestAvailableAmericanPrice")
        candidate_price = prices.get((*key_prefix, candidate_side))
        rows.append({
            "gameId": str(source["gameId"]),
            "playerName": str(source["playerName"]),
            "position": positions.get(normalize_name(source["playerName"]), "UNKNOWN"),
            "market": market,
            "line": line,
            "actual": actual,
            "actualOver": int(actual > line),
            "independentProjection": float(projection),
            "referenceOverProbability": reference_over,
            "referenceSideProbability": reference_selected_probability,
            "referenceSide": reference_side,
            "referenceDirectionCorrect": reference_side == actual_side,
            "referencePrice": int(reference_price) if reference_price is not None else None,
            "candidateOverProbability": candidate_over,
            "candidateSideProbability": candidate_selected_probability,
            "candidateSide": candidate_side,
            "candidateDirectionCorrect": candidate_side == actual_side,
            "candidatePrice": candidate_price,
        })

    market_reports = {
        market: summarize([row for row in rows if row["market"] == market])
        for market in sorted(markets)
    }
    rb_rows = [row for row in rows if row["position"] == "RB"]
    qb_rows = [row for row in rows if row["position"] == "QB"]
    output = {
        "release": "nfl_player_props_distribution_exact_replay_2026_10_16_r1",
        "readOnly": True,
        "writes": 0,
        "chronology": {
            "candidateSelectedOn": "2024",
            "candidateConfirmedOn": "2025",
            "exactReplayUsedForSelection": False,
        },
        "scope": {
            "rows": len(rows),
            "markets": sorted(markets),
            "positionHistoryProvided": args.position_history is not None,
            "unknownPositionRows": int(sum(row["position"] == "UNKNOWN" for row in rows)),
        },
        "all": summarize(rows),
        "byMarket": market_reports,
        "runningBackOnly": {
            "all": summarize(rb_rows),
            "byMarket": {
                market: summarize([row for row in rb_rows if row["market"] == market])
                for market in sorted(markets)
            },
        },
        "quarterbackOnly": {
            "all": summarize(qb_rows),
            "byMarket": {
                market: summarize([row for row in qb_rows if row["market"] == market])
                for market in sorted(markets)
            },
        },
        "rowEvidence": rows,
        "limitations": {
            "wholeBoardPromotionsAndDemotionsAvailable": False,
            "reason": "The immutable exact replay does not contain the complete unlocked same-input board.",
            "productionPromotionAuthorized": False,
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
