#!/usr/bin/env python3
"""Locked NFL direct side classifier with coherent point reconstruction."""

from __future__ import annotations

import json
import math
import pathlib
import time
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy.special import expit, logit
from scipy.stats import norm
from sklearn.base import ClassifierMixin
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from tournament_nfl_market_context_residual_r1 import (
    ACTION_EDGE,
    CONFIRMATION_SEASONS,
    FEATURE_RELEASE,
    SELECTION_SEASONS,
    TRAIN_SEASONS,
    action_report,
    add_market_context,
    model_feature_columns,
    sha256_file,
)


TOURNAMENT_RELEASE = "nfl_direct_side_classifier_tournament_2026_09_21_r1"
RANDOM_STATE = 21092028
BLEND_WEIGHTS = (0.10, 0.20, 0.33, 0.50, 1.00)
LOGIT_CAPS = (0.25, 0.50, 0.75)
POINT_CAP = 4.0


@dataclass(frozen=True)
class Recipe:
    estimator: str
    weight: float
    logit_cap: float


def factories() -> dict[str, Callable[[], ClassifierMixin]]:
    def logistic(c: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", LogisticRegression(C=c, max_iter=3000, random_state=RANDOM_STATE)),
        ])

    def hist(leaf: int, l2: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=False)),
            ("model", HistGradientBoostingClassifier(
                learning_rate=0.03, max_iter=240, max_leaf_nodes=15,
                min_samples_leaf=leaf, l2_regularization=l2, random_state=RANDOM_STATE,
            )),
        ])

    return {
        "logistic_c0001": lambda: logistic(0.001),
        "logistic_c001": lambda: logistic(0.01),
        "logistic_c01": lambda: logistic(0.1),
        "hist_leaf30": lambda: hist(30, 20.0),
        "hist_leaf60": lambda: hist(60, 30.0),
    }


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


def candidate_probability(fair: np.ndarray, model_probability: np.ndarray, recipe: Recipe) -> np.ndarray:
    displacement = recipe.weight * (
        logit(np.clip(model_probability, 0.001, 0.999)) - logit(np.clip(fair, 0.001, 0.999))
    )
    displacement = np.clip(displacement, -recipe.logit_cap, recipe.logit_cap)
    return expit(logit(np.clip(fair, 0.001, 0.999)) + displacement)


def coherent_point(
    market: np.ndarray, fair: np.ndarray, probability: np.ndarray, residual_sigma: float
) -> tuple[np.ndarray, np.ndarray]:
    correction = residual_sigma * (
        norm.ppf(np.clip(probability, 0.01, 0.99)) - norm.ppf(np.clip(fair, 0.01, 0.99))
    )
    correction = np.clip(correction, -POINT_CAP, POINT_CAP)
    return market + correction, correction


def season_metrics(
    frame: pd.DataFrame, target: str, market_column: str, prediction: np.ndarray,
    probability: np.ndarray, fair: np.ndarray,
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    actual = frame[target].to_numpy(float)
    market = frame[market_column].to_numpy(float)
    push = actual == market
    outcome = actual > market
    for season in sorted(frame["season"].unique()):
        rows = frame["season"].eq(season).to_numpy()
        keep = rows & ~push
        result[str(int(season))] = {
            "candidatePoint": point_metrics(actual[rows], prediction[rows]),
            "marketPoint": point_metrics(actual[rows], market[rows]),
            "candidateProbability": probability_metrics(probability[keep], outcome[keep]),
            "marketProbability": probability_metrics(fair[keep], outcome[keep]),
        }
    return result


def audit_market(
    frame: pd.DataFrame, features: list[str], target: str, market_column: str,
    fair_column: str, first_price: str, second_price: str,
) -> dict[str, Any]:
    training = frame[frame["season"].isin(TRAIN_SEASONS)].copy()
    selection = frame[frame["season"].isin(SELECTION_SEASONS)].copy()
    train_actual = training[target].to_numpy(float)
    train_market = training[market_column].to_numpy(float)
    train_push = train_actual == train_market
    train_outcome = train_actual > train_market
    selection_actual = selection[target].to_numpy(float)
    selection_market = selection[market_column].to_numpy(float)
    selection_push = selection_actual == selection_market
    selection_outcome = selection_actual > selection_market
    selection_fair = selection[fair_column].to_numpy(float)
    residual_sigma = float(np.std(train_actual - train_market, ddof=1))

    rankings: list[dict[str, Any]] = []
    for estimator_name, factory in factories().items():
        model = factory()
        model.fit(training.loc[~train_push, features], train_outcome[~train_push].astype(int))
        raw = np.asarray(model.predict_proba(selection[features])[:, 1], dtype=float)
        for weight in BLEND_WEIGHTS:
            for cap in LOGIT_CAPS:
                recipe = Recipe(estimator_name, weight, cap)
                probability = candidate_probability(selection_fair, raw, recipe)
                point_prediction, correction = coherent_point(
                    selection_market, selection_fair, probability, residual_sigma
                )
                keep = ~selection_push
                rankings.append({
                    "recipe": recipe,
                    "probability": probability_metrics(probability[keep], selection_outcome[keep]),
                    "point": point_metrics(selection_actual, point_prediction),
                    "bySeason": season_metrics(
                        selection, target, market_column, point_prediction, probability, selection_fair
                    ),
                    "meanAbsoluteCorrection": float(np.mean(np.abs(correction))),
                })
    complexity = {name: index for index, name in enumerate(factories())}
    rankings.sort(key=lambda row: (
        row["probability"]["brier"], row["probability"]["logLoss"], row["point"]["mae"],
        row["recipe"].weight, row["recipe"].logit_cap, complexity[row["recipe"].estimator],
    ))
    baseline_point = point_metrics(selection_actual, selection_market)
    baseline_probability = probability_metrics(
        selection_fair[~selection_push], selection_outcome[~selection_push]
    )
    qualifying = [
        row for row in rankings
        if row["probability"]["brier"] < baseline_probability["brier"]
        and row["point"]["mae"] <= baseline_point["mae"] + 0.02
        and all(not (
            season["candidatePoint"]["mae"] > season["marketPoint"]["mae"]
            and season["candidateProbability"]["brier"] > season["marketProbability"]["brier"]
        ) for season in row["bySeason"].values())
    ]
    selected = qualifying[0] if qualifying else rankings[0]
    recipe: Recipe = selected["recipe"]

    final_train = frame[frame["season"].between(2018, 2023)].copy()
    confirmation = frame[frame["season"].isin(CONFIRMATION_SEASONS)].copy()
    final_actual = final_train[target].to_numpy(float)
    final_market = final_train[market_column].to_numpy(float)
    final_push = final_actual == final_market
    final_model = factories()[recipe.estimator]()
    final_model.fit(
        final_train.loc[~final_push, features],
        (final_actual > final_market)[~final_push].astype(int),
    )
    confirmation_actual = confirmation[target].to_numpy(float)
    confirmation_market = confirmation[market_column].to_numpy(float)
    confirmation_push = confirmation_actual == confirmation_market
    confirmation_outcome = confirmation_actual > confirmation_market
    confirmation_fair = confirmation[fair_column].to_numpy(float)
    raw = np.asarray(final_model.predict_proba(confirmation[features])[:, 1], dtype=float)
    probability = candidate_probability(confirmation_fair, raw, recipe)
    final_sigma = float(np.std(final_actual - final_market, ddof=1))
    prediction, correction = coherent_point(
        confirmation_market, confirmation_fair, probability, final_sigma
    )
    keep = ~confirmation_push
    by_season = season_metrics(
        confirmation, target, market_column, prediction, probability, confirmation_fair
    )
    candidate_point_result = point_metrics(confirmation_actual, prediction)
    market_point_result = point_metrics(confirmation_actual, confirmation_market)
    candidate_probability_result = probability_metrics(probability[keep], confirmation_outcome[keep])
    market_probability_result = probability_metrics(confirmation_fair[keep], confirmation_outcome[keep])
    direction_keep = keep & ~np.isclose(correction, 0.0)
    direction_correct = np.sign(correction[direction_keep]) == np.sign(
        (confirmation_actual - confirmation_market)[direction_keep]
    )
    actions = action_report(
        confirmation.reset_index(drop=True), probability, confirmation_fair,
        confirmation_outcome, confirmation_push, first_price, second_price,
    )
    gates = {
        "pooledMaeImproves": candidate_point_result["mae"] < market_point_result["mae"],
        "pooledBrierImproves": candidate_probability_result["brier"] < market_probability_result["brier"],
        "neitherSeasonWorseOnBoth": all(not (
            season["candidatePoint"]["mae"] > season["marketPoint"]["mae"]
            and season["candidateProbability"]["brier"] > season["marketProbability"]["brier"]
        ) for season in by_season.values()),
        "directionAccuracyAtLeastHalf": bool(direction_correct.mean() >= 0.5),
        "bothForecastDirections": bool(np.any(correction > 0) and np.any(correction < 0)),
        "atLeastThirtyResolvedActions": actions["pooled"]["resolved"] >= 30,
        "positivePooledActionRoi": bool((actions["pooled"]["roiPerUnitRisked"] or -1.0) > 0),
        "neitherSeasonActionRoiBelowMinusFivePercent": all(
            row["roiPerUnitRisked"] is not None and row["roiPerUnitRisked"] >= -0.05
            for row in actions["bySeason"].values()
        ),
        "bothActionDirections": actions["directions"]["first"] > 0 and actions["directions"]["second"] > 0,
    }
    gates["historicalConfirmationPassed"] = all(gates.values())

    def serialize(row: dict[str, Any]) -> dict[str, Any]:
        item: Recipe = row["recipe"]
        return {
            **{key: value for key, value in row.items() if key != "recipe"},
            "recipe": {"estimator": item.estimator, "weight": item.weight, "logitCap": item.logit_cap},
        }

    return {
        "selection": {
            "qualifyingRecipes": len(qualifying),
            "baselinePoint": baseline_point,
            "baselineProbability": baseline_probability,
            "selected": serialize(selected),
            "topRecipes": [serialize(row) for row in rankings[:10]],
        },
        "confirmation": {
            "candidatePoint": candidate_point_result,
            "marketPoint": market_point_result,
            "candidateProbability": candidate_probability_result,
            "marketProbability": market_probability_result,
            "bySeason": by_season,
            "meanAbsoluteCorrection": float(np.mean(np.abs(correction))),
            "directionAccuracy": float(direction_correct.mean()),
            "forecastDirections": {
                "positive": int(np.sum(correction > 0)),
                "negative": int(np.sum(correction < 0)),
                "zero": int(np.sum(np.isclose(correction, 0.0))),
            },
            "actions": actions,
            "gates": gates,
        },
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
    frame = add_market_context(pd.read_parquet(feature_path))
    features = model_feature_columns(frame)
    spread = audit_market(
        frame, features, "actual_margin", "market_home_margin", "market_spread_fair_home",
        "home_spread_odds", "away_spread_odds",
    )
    total = audit_market(
        frame, features, "actual_total", "market_total", "market_total_fair_over",
        "over_odds", "under_odds",
    )
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "actionable": False,
        "officialTrackingChanged": False,
        "featureCount": len(features),
        "trainingSeasons": TRAIN_SEASONS,
        "selectionSeasons": SELECTION_SEASONS,
        "confirmationSeasons": CONFIRMATION_SEASONS,
        "spread": spread,
        "total": total,
        "launchGate": {
            "status": "historical_confirmation_only" if (
                spread["confirmation"]["gates"]["historicalConfirmationPassed"]
                or total["confirmation"]["gates"]["historicalConfirmationPassed"]
            ) else "rejected",
        },
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
