#!/usr/bin/env python3
"""Locked pre-week NFL league-environment residual tournament."""

from __future__ import annotations

import json
import math
import pathlib
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd
from scipy.special import expit, logit
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error, mean_squared_error

from tournament_nfl_market_context_residual_r1 import (
    CONFIRMATION_SEASONS,
    FEATURE_RELEASE,
    SELECTION_SEASONS,
    action_report,
    add_market_context,
    sha256_file,
)


TOURNAMENT_RELEASE = "nfl_league_environment_tournament_2026_09_21_r1"
WARMUP_SEASONS = tuple(range(2016, 2022))
PRIOR_GAMES = (16, 32, 64)
CARRY = (0.0, 0.5, 1.0)
WEIGHTS = (0.25, 0.5, 0.75, 1.0)
SCALES = (0.04, 0.08, 0.12, 0.16)
POINT_CAP = 3.0


@dataclass(frozen=True)
class Recipe:
    prior_games: int
    carry: float
    weight: float
    scale: float


def point_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "bias": float(np.mean(predicted - actual)),
    }


def probability_metrics(probability: np.ndarray, outcome: np.ndarray) -> dict[str, float]:
    p = np.clip(probability, 0.001, 0.999)
    return {
        "rows": int(len(outcome)),
        "brier": float(brier_score_loss(outcome.astype(int), p)),
        "logLoss": float(log_loss(outcome.astype(int), p, labels=[0, 1])),
    }


def chronological_corrections(frame: pd.DataFrame, target: str, market: str, recipe: Recipe) -> np.ndarray:
    corrections = np.zeros(len(frame), dtype=float)
    previous_season_mean = 0.0
    for season in sorted(frame["season"].unique()):
        season_rows = frame["season"].eq(season)
        season_residuals: list[float] = []
        prior_mean = recipe.carry * previous_season_mean
        for week in sorted(frame.loc[season_rows, "week"].unique()):
            week_rows = (frame["season"].eq(season) & frame["week"].eq(week)).to_numpy()
            numerator = recipe.prior_games * prior_mean + sum(season_residuals)
            denominator = recipe.prior_games + len(season_residuals)
            signal = numerator / denominator
            corrections[week_rows] = np.clip(recipe.weight * signal, -POINT_CAP, POINT_CAP)
            actual = frame.loc[week_rows, target].to_numpy(float)
            anchor = frame.loc[week_rows, market].to_numpy(float)
            season_residuals.extend((actual - anchor).tolist())
        previous_season_mean = float(np.mean(season_residuals)) if season_residuals else 0.0
    return corrections


def evaluate(
    frame: pd.DataFrame, target: str, market: str, fair_column: str,
    first_price: str, second_price: str, recipe: Recipe, seasons: tuple[int, ...],
) -> dict[str, Any]:
    all_corrections = chronological_corrections(frame, target, market, recipe)
    rows = frame["season"].isin(seasons).to_numpy()
    sample = frame.loc[rows].reset_index(drop=True)
    correction = all_corrections[rows]
    actual = sample[target].to_numpy(float)
    anchor = sample[market].to_numpy(float)
    fair = sample[fair_column].to_numpy(float)
    probability = expit(logit(np.clip(fair, 0.001, 0.999)) + recipe.scale * correction)
    prediction = anchor + correction
    push = actual == anchor
    outcome = actual > anchor
    keep = ~push
    by_season: dict[str, Any] = {}
    for season in seasons:
        season_rows = sample["season"].eq(season).to_numpy()
        score_rows = season_rows & keep
        by_season[str(season)] = {
            "candidatePoint": point_metrics(actual[season_rows], prediction[season_rows]),
            "marketPoint": point_metrics(actual[season_rows], anchor[season_rows]),
            "candidateProbability": probability_metrics(probability[score_rows], outcome[score_rows]),
            "marketProbability": probability_metrics(fair[score_rows], outcome[score_rows]),
        }
    direction_rows = keep & ~np.isclose(correction, 0.0)
    direction_correct = np.sign(correction[direction_rows]) == np.sign((actual - anchor)[direction_rows])
    return {
        "candidatePoint": point_metrics(actual, prediction),
        "marketPoint": point_metrics(actual, anchor),
        "candidateProbability": probability_metrics(probability[keep], outcome[keep]),
        "marketProbability": probability_metrics(fair[keep], outcome[keep]),
        "bySeason": by_season,
        "meanAbsoluteCorrection": float(np.mean(np.abs(correction))),
        "directionAccuracy": float(direction_correct.mean()) if direction_rows.any() else 0.0,
        "forecastDirections": {
            "positive": int(np.sum(correction > 0)),
            "negative": int(np.sum(correction < 0)),
            "zero": int(np.sum(np.isclose(correction, 0.0))),
        },
        "actions": action_report(
            sample, probability, fair, outcome, push, first_price, second_price
        ),
    }


def audit_market(
    frame: pd.DataFrame, target: str, market: str, fair_column: str,
    first_price: str, second_price: str,
) -> dict[str, Any]:
    rankings: list[dict[str, Any]] = []
    for prior_games in PRIOR_GAMES:
        for carry in CARRY:
            for weight in WEIGHTS:
                for scale in SCALES:
                    recipe = Recipe(prior_games, carry, weight, scale)
                    result = evaluate(
                        frame, target, market, fair_column, first_price, second_price,
                        recipe, SELECTION_SEASONS,
                    )
                    rankings.append({"recipe": recipe, "result": result})
    rankings.sort(key=lambda row: (
        row["result"]["candidateProbability"]["brier"],
        row["result"]["candidatePoint"]["mae"],
        row["result"]["candidateProbability"]["logLoss"],
        row["recipe"].weight, -row["recipe"].prior_games, row["recipe"].scale,
    ))
    qualifying = [row for row in rankings if (
        row["result"]["candidateProbability"]["brier"] < row["result"]["marketProbability"]["brier"]
        and row["result"]["candidatePoint"]["mae"] < row["result"]["marketPoint"]["mae"]
        and all(not (
            season["candidatePoint"]["mae"] > season["marketPoint"]["mae"]
            and season["candidateProbability"]["brier"] > season["marketProbability"]["brier"]
        ) for season in row["result"]["bySeason"].values())
    )]
    selected = qualifying[0] if qualifying else rankings[0]
    confirmation = evaluate(
        frame, target, market, fair_column, first_price, second_price,
        selected["recipe"], CONFIRMATION_SEASONS,
    )
    gates = {
        "pooledMaeImproves": confirmation["candidatePoint"]["mae"] < confirmation["marketPoint"]["mae"],
        "pooledBrierImproves": confirmation["candidateProbability"]["brier"] < confirmation["marketProbability"]["brier"],
        "neitherSeasonWorseOnBoth": all(not (
            season["candidatePoint"]["mae"] > season["marketPoint"]["mae"]
            and season["candidateProbability"]["brier"] > season["marketProbability"]["brier"]
        ) for season in confirmation["bySeason"].values()),
        "directionAccuracyAtLeastHalf": confirmation["directionAccuracy"] >= 0.5,
        "bothForecastDirections": confirmation["forecastDirections"]["positive"] > 0 and confirmation["forecastDirections"]["negative"] > 0,
        "atLeastThirtyResolvedActions": confirmation["actions"]["pooled"]["resolved"] >= 30,
        "positivePooledActionRoi": (confirmation["actions"]["pooled"]["roiPerUnitRisked"] or -1.0) > 0,
        "neitherSeasonActionRoiBelowMinusFivePercent": all(
            value["roiPerUnitRisked"] is not None and value["roiPerUnitRisked"] >= -0.05
            for value in confirmation["actions"]["bySeason"].values()
        ),
        "bothActionDirections": confirmation["actions"]["directions"]["first"] > 0 and confirmation["actions"]["directions"]["second"] > 0,
    }
    gates["historicalConfirmationPassed"] = all(gates.values())
    confirmation["gates"] = gates

    def serialize(row: dict[str, Any]) -> dict[str, Any]:
        recipe: Recipe = row["recipe"]
        return {
            "recipe": {
                "priorGames": recipe.prior_games, "carry": recipe.carry,
                "weight": recipe.weight, "scale": recipe.scale,
            },
            "result": row["result"],
        }

    return {
        "selection": {
            "qualifyingRecipes": len(qualifying),
            "selected": serialize(selected),
            "topRecipes": [serialize(row) for row in rankings[:10]],
        },
        "confirmation": confirmation,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("feature artifact checksum mismatch")
    frame = add_market_context(pd.read_parquet(feature_path)).sort_values(
        ["season", "week", "game_id"]
    ).reset_index(drop=True)
    spread = audit_market(
        frame, "actual_margin", "market_home_margin", "market_spread_fair_home",
        "home_spread_odds", "away_spread_odds",
    )
    total = audit_market(
        frame, "actual_total", "market_total", "market_total_fair_over",
        "over_odds", "under_odds",
    )
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "actionable": False,
        "officialTrackingChanged": False,
        "warmupSeasons": WARMUP_SEASONS,
        "selectionSeasons": SELECTION_SEASONS,
        "confirmationSeasons": CONFIRMATION_SEASONS,
        "spread": spread,
        "total": total,
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "spread": spread["confirmation"],
        "total": total["confirmation"],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
