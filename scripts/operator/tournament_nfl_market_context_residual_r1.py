#!/usr/bin/env python3
"""Locked NFL market-context residual tournament.

This research-only script follows the 2026-09-21 predeclaration.  It never
writes predictions, grades, tracking, or production state.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy.special import expit, logit
from sklearn.base import RegressorMixin
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


TOURNAMENT_RELEASE = "nfl_market_context_residual_tournament_2026_09_21_r1"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
TRAIN_SEASONS = tuple(range(2018, 2022))
SELECTION_SEASONS = (2022, 2023)
CONFIRMATION_SEASONS = (2024, 2025)
RANDOM_STATE = 21092026
POINT_WEIGHTS = (0.10, 0.20, 0.33, 0.50)
POINT_CAPS = (2.0, 3.0, 4.0)
PROBABILITY_SCALES = (0.04, 0.08, 0.12, 0.16)
ACTION_EDGE = 0.02


@dataclass(frozen=True)
class PointRecipe:
    estimator: str
    weight: float
    cap: float


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def american_implied(values: np.ndarray) -> np.ndarray:
    prices = np.asarray(values, dtype=float)
    return np.where(prices > 0, 100.0 / (prices + 100.0), -prices / (-prices + 100.0))


def no_vig(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    first_implied = american_implied(first)
    second_implied = american_implied(second)
    return first_implied / (first_implied + second_implied)


def add_market_context(frame: pd.DataFrame) -> pd.DataFrame:
    result = frame.copy()
    result["market_abs_margin"] = result["market_home_margin"].abs()
    result["market_total_centered"] = result["market_total"] - 44.0
    result["market_spread_fair_home"] = no_vig(
        result["home_spread_odds"].to_numpy(float), result["away_spread_odds"].to_numpy(float)
    )
    result["market_total_fair_over"] = no_vig(
        result["over_odds"].to_numpy(float), result["under_odds"].to_numpy(float)
    )
    result["market_moneyline_fair_home"] = no_vig(
        result["home_moneyline"].to_numpy(float), result["away_moneyline"].to_numpy(float)
    )
    result["market_early_week"] = result["week"].le(4).astype(float)
    result["market_margin_total_interaction"] = (
        result["market_abs_margin"] * result["market_total_centered"]
    )
    result["market_indoor_total_interaction"] = result["roof_indoor"] * result["market_total_centered"]
    result["market_wind_total_interaction"] = result["wind"] * result["market_total_centered"]
    return result


def football_feature_columns(frame: pd.DataFrame) -> list[str]:
    context = {
        "week", "neutral_site", "division_game", "home_rest", "away_rest", "rest_diff",
        "temperature", "wind", "roof_indoor", "surface_grass", "home_elo", "away_elo",
        "elo_diff", "home_games_state", "away_games_state",
        "home_injury_weight", "away_injury_weight", "home_qb_injury_weight", "away_qb_injury_weight",
        "home_out_count", "away_out_count", "home_injury_reported_count", "away_injury_reported_count",
        "home_roster_continuity", "away_roster_continuity", "home_qb_epa", "away_qb_epa",
        "home_qb_cpoe", "away_qb_cpoe", "home_qb_sack_rate", "away_qb_sack_rate",
        "home_qb_turnover_rate", "away_qb_turnover_rate", "home_qb_log_dropbacks", "away_qb_log_dropbacks",
        "home_qb_same_as_last_start", "away_qb_same_as_last_start", "home_coach_continuity",
        "away_coach_continuity",
    }
    prefixes = (
        "home_matchup_fast_", "away_matchup_fast_", "home_matchup_slow_", "away_matchup_slow_",
        "home_off_adj_", "away_off_adj_", "home_def_adj_", "away_def_adj_",
    )
    return sorted(column for column in frame.columns if column in context or column.startswith(prefixes))


def model_feature_columns(frame: pd.DataFrame) -> list[str]:
    market = [
        "market_home_margin", "market_total", "market_abs_margin", "market_total_centered",
        "market_spread_fair_home", "market_total_fair_over", "market_moneyline_fair_home",
        "market_early_week", "market_margin_total_interaction", "market_indoor_total_interaction",
        "market_wind_total_interaction",
    ]
    features = sorted(set(football_feature_columns(frame) + market))
    non_numeric = [column for column in features if not pd.api.types.is_numeric_dtype(frame[column])]
    if non_numeric:
        raise RuntimeError(f"non-numeric features: {non_numeric}")
    return features


def estimator_factories() -> dict[str, Callable[[], RegressorMixin]]:
    def ridge(alpha: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", Ridge(alpha=alpha)),
        ])

    def hist(minimum_leaf: int, l2: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=False)),
            ("model", HistGradientBoostingRegressor(
                learning_rate=0.03,
                max_iter=240,
                max_leaf_nodes=15,
                min_samples_leaf=minimum_leaf,
                l2_regularization=l2,
                random_state=RANDOM_STATE,
            )),
        ])

    return {
        "ridge_100": lambda: ridge(100.0),
        "ridge_300": lambda: ridge(300.0),
        "ridge_1000": lambda: ridge(1000.0),
        "hist_leaf20": lambda: hist(20, 12.0),
        "hist_leaf40": lambda: hist(40, 20.0),
    }


def point_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "bias": float(np.mean(predicted - actual)),
    }


def probability_metrics(probability: np.ndarray, outcome: np.ndarray) -> dict[str, float]:
    p = np.clip(np.asarray(probability, dtype=float), 0.001, 0.999)
    y = np.asarray(outcome, dtype=int)
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
    }


def apply_correction(market: np.ndarray, residual_prediction: np.ndarray, recipe: PointRecipe) -> tuple[np.ndarray, np.ndarray]:
    correction = np.clip(recipe.weight * residual_prediction, -recipe.cap, recipe.cap)
    return market + correction, correction


def per_season_point(frame: pd.DataFrame, target: str, prediction: np.ndarray, market: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for season in sorted(frame["season"].unique()):
        keep = frame["season"].eq(season).to_numpy()
        result[str(int(season))] = {
            "candidate": point_metrics(frame.loc[keep, target].to_numpy(float), prediction[keep]),
            "market": point_metrics(frame.loc[keep, target].to_numpy(float), frame.loc[keep, market].to_numpy(float)),
        }
    return result


def probability_for(fair: np.ndarray, correction: np.ndarray, scale: float) -> np.ndarray:
    return expit(logit(np.clip(fair, 0.001, 0.999)) + scale * correction)


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def action_report(
    frame: pd.DataFrame,
    probability: np.ndarray,
    fair: np.ndarray,
    outcome: np.ndarray,
    push: np.ndarray,
    first_price_column: str,
    second_price_column: str,
) -> dict[str, Any]:
    edge = probability - fair
    take_first = edge >= ACTION_EDGE
    take_second = edge <= -ACTION_EDGE
    selected = take_first | take_second
    rows: list[dict[str, Any]] = []
    for index in np.where(selected)[0]:
        if push[index]:
            rows.append({"season": int(frame.iloc[index]["season"]), "push": True, "units": 0.0})
            continue
        won = bool(outcome[index]) if take_first[index] else not bool(outcome[index])
        price_column = first_price_column if take_first[index] else second_price_column
        price = float(frame.iloc[index][price_column])
        rows.append({
            "season": int(frame.iloc[index]["season"]),
            "push": False,
            "won": won,
            "units": profit_one(price) if won else -1.0,
        })

    def summarize(subset: list[dict[str, Any]]) -> dict[str, Any]:
        resolved = [row for row in subset if not row["push"]]
        units = float(sum(row["units"] for row in subset))
        return {
            "boardCount": len(subset),
            "resolved": len(resolved),
            "wins": sum(bool(row.get("won")) for row in resolved),
            "losses": sum(not bool(row.get("won")) for row in resolved),
            "pushes": sum(bool(row["push"]) for row in subset),
            "units": units,
            "roiPerUnitRisked": units / len(subset) if subset else None,
        }

    return {
        "minimumEdge": ACTION_EDGE,
        "directions": {"first": int(take_first.sum()), "second": int(take_second.sum())},
        "pooled": summarize(rows),
        "bySeason": {
            str(int(season)): summarize([row for row in rows if row["season"] == season])
            for season in sorted(frame["season"].unique())
        },
    }


def audit_market(
    frame: pd.DataFrame,
    features: list[str],
    target: str,
    market: str,
    fair_column: str,
    first_price_column: str,
    second_price_column: str,
) -> dict[str, Any]:
    training = frame[frame["season"].isin(TRAIN_SEASONS)].copy()
    selection = frame[frame["season"].isin(SELECTION_SEASONS)].copy()
    actual_training = training[target].to_numpy(float)
    market_training = training[market].to_numpy(float)
    actual_selection = selection[target].to_numpy(float)
    market_selection = selection[market].to_numpy(float)
    residual_target = actual_training - market_training

    point_rankings: list[dict[str, Any]] = []
    for estimator_name, factory in estimator_factories().items():
        model = factory()
        model.fit(training[features], residual_target)
        residual_prediction = np.asarray(model.predict(selection[features]), dtype=float)
        for weight in POINT_WEIGHTS:
            for cap in POINT_CAPS:
                recipe = PointRecipe(estimator_name, weight, cap)
                predicted, correction = apply_correction(market_selection, residual_prediction, recipe)
                season_metrics = per_season_point(selection, target, predicted, market)
                metrics = point_metrics(actual_selection, predicted)
                point_rankings.append({
                    "recipe": recipe,
                    "metrics": metrics,
                    "bySeason": season_metrics,
                    "correctionMeanAbs": float(np.mean(np.abs(correction))),
                })

    complexity = {name: index for index, name in enumerate(estimator_factories())}
    point_rankings.sort(key=lambda row: (
        row["metrics"]["mae"], row["metrics"]["rmse"], row["recipe"].weight,
        row["recipe"].cap, complexity[row["recipe"].estimator],
    ))
    market_selection_metrics = point_metrics(actual_selection, market_selection)
    qualifying = [
        row for row in point_rankings
        if row["metrics"]["mae"] < market_selection_metrics["mae"]
        and all(
            values["candidate"]["mae"] <= values["market"]["mae"] + 0.15
            for values in row["bySeason"].values()
        )
    ]
    selected_point = qualifying[0] if qualifying else point_rankings[0]
    recipe: PointRecipe = selected_point["recipe"]

    selected_model = estimator_factories()[recipe.estimator]()
    selected_model.fit(training[features], residual_target)
    selection_residual_prediction = np.asarray(selected_model.predict(selection[features]), dtype=float)
    selection_prediction, selection_correction = apply_correction(
        market_selection, selection_residual_prediction, recipe
    )
    selection_fair = selection[fair_column].to_numpy(float)
    selection_push = actual_selection == market_selection
    selection_outcome = actual_selection > market_selection
    scale_rankings: list[dict[str, Any]] = []
    for scale in PROBABILITY_SCALES:
        probability = probability_for(selection_fair, selection_correction, scale)
        keep = ~selection_push
        scale_rankings.append({
            "scale": scale,
            **probability_metrics(probability[keep], selection_outcome[keep]),
        })
    scale_rankings.sort(key=lambda row: (row["brier"], row["logLoss"], row["scale"]))
    selected_scale = float(scale_rankings[0]["scale"])

    confirmation_training = frame[frame["season"].between(2018, 2023)].copy()
    confirmation = frame[frame["season"].isin(CONFIRMATION_SEASONS)].copy()
    confirmation_model = estimator_factories()[recipe.estimator]()
    confirmation_model.fit(
        confirmation_training[features],
        confirmation_training[target].to_numpy(float) - confirmation_training[market].to_numpy(float),
    )
    confirmation_residual_prediction = np.asarray(confirmation_model.predict(confirmation[features]), dtype=float)
    actual_confirmation = confirmation[target].to_numpy(float)
    market_confirmation = confirmation[market].to_numpy(float)
    confirmation_prediction, confirmation_correction = apply_correction(
        market_confirmation, confirmation_residual_prediction, recipe
    )
    confirmation_fair = confirmation[fair_column].to_numpy(float)
    confirmation_probability = probability_for(
        confirmation_fair, confirmation_correction, selected_scale
    )
    confirmation_push = actual_confirmation == market_confirmation
    confirmation_outcome = actual_confirmation > market_confirmation
    keep = ~confirmation_push

    probability_by_season: dict[str, Any] = {}
    for season in CONFIRMATION_SEASONS:
        season_keep = confirmation["season"].eq(season).to_numpy() & keep
        probability_by_season[str(season)] = {
            "candidate": probability_metrics(
                confirmation_probability[season_keep], confirmation_outcome[season_keep]
            ),
            "market": probability_metrics(
                confirmation_fair[season_keep], confirmation_outcome[season_keep]
            ),
        }

    actual_residual = actual_confirmation - market_confirmation
    direction_keep = keep & ~np.isclose(confirmation_correction, 0.0)
    direction_correct = np.sign(confirmation_correction[direction_keep]) == np.sign(actual_residual[direction_keep])
    actions = action_report(
        confirmation.reset_index(drop=True), confirmation_probability, confirmation_fair,
        confirmation_outcome, confirmation_push, first_price_column, second_price_column,
    )
    candidate_point = point_metrics(actual_confirmation, confirmation_prediction)
    baseline_point = point_metrics(actual_confirmation, market_confirmation)
    candidate_probability = probability_metrics(confirmation_probability[keep], confirmation_outcome[keep])
    baseline_probability = probability_metrics(confirmation_fair[keep], confirmation_outcome[keep])
    point_by_season = per_season_point(confirmation, target, confirmation_prediction, market)

    gates = {
        "pooledMaeImproves": candidate_point["mae"] < baseline_point["mae"],
        "pooledBrierImproves": candidate_probability["brier"] < baseline_probability["brier"],
        "neitherSeasonWorseOnBoth": all(
            not (
                point_by_season[str(season)]["candidate"]["mae"] > point_by_season[str(season)]["market"]["mae"]
                and probability_by_season[str(season)]["candidate"]["brier"]
                > probability_by_season[str(season)]["market"]["brier"]
            )
            for season in CONFIRMATION_SEASONS
        ),
        "directionAccuracyAtLeastHalf": bool(direction_correct.mean() >= 0.5),
        "bothForecastDirections": bool(
            np.any(confirmation_correction > 0) and np.any(confirmation_correction < 0)
        ),
        "atLeastThirtyResolvedActions": actions["pooled"]["resolved"] >= 30,
        "positivePooledActionRoi": bool((actions["pooled"]["roiPerUnitRisked"] or -1.0) > 0),
        "neitherSeasonActionRoiBelowMinusFivePercent": all(
            values["roiPerUnitRisked"] is not None and values["roiPerUnitRisked"] >= -0.05
            for values in actions["bySeason"].values()
        ),
        "bothActionDirections": actions["directions"]["first"] > 0 and actions["directions"]["second"] > 0,
    }
    gates["historicalConfirmationPassed"] = all(gates.values())

    def serialize_point(row: dict[str, Any]) -> dict[str, Any]:
        candidate_recipe: PointRecipe = row["recipe"]
        return {
            **{key: value for key, value in row.items() if key != "recipe"},
            "recipe": {
                "estimator": candidate_recipe.estimator,
                "weight": candidate_recipe.weight,
                "cap": candidate_recipe.cap,
            },
        }

    return {
        "selection": {
            "rows": len(selection),
            "qualifyingPointRecipes": len(qualifying),
            "marketPoint": market_selection_metrics,
            "selectedPoint": serialize_point(selected_point),
            "topPointRecipes": [serialize_point(row) for row in point_rankings[:10]],
            "selectedProbabilityScale": selected_scale,
            "probabilityScaleRanking": scale_rankings,
        },
        "confirmation": {
            "rows": len(confirmation),
            "candidatePoint": candidate_point,
            "marketPoint": baseline_point,
            "candidateProbability": candidate_probability,
            "marketProbability": baseline_probability,
            "pointBySeason": point_by_season,
            "probabilityBySeason": probability_by_season,
            "meanAbsoluteCorrection": float(np.mean(np.abs(confirmation_correction))),
            "directionAccuracy": float(direction_correct.mean()),
            "forecastDirections": {
                "positive": int(np.sum(confirmation_correction > 0)),
                "negative": int(np.sum(confirmation_correction < 0)),
                "zero": int(np.sum(np.isclose(confirmation_correction, 0.0))),
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
    if frame["game_id"].duplicated().any():
        raise RuntimeError("duplicate game identity")
    features = model_feature_columns(frame)
    if len(features) < 150:
        raise RuntimeError(f"unexpected feature count: {len(features)}")

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
        "trainingSeasons": TRAIN_SEASONS,
        "selectionSeasons": SELECTION_SEASONS,
        "confirmationSeasons": CONFIRMATION_SEASONS,
        "featureCount": len(features),
        "featureArtifactSha256": manifest["featureFileSha256"],
        "spread": spread,
        "total": total,
        "launchGate": {
            "status": "historical_confirmation_only",
            "reason": "current-board replay, release implementation, mandatory verification, and forward evidence remain required",
        },
        "limitations": [
            "nflverse prices and lines are terminal observations, not OddSphere weekly lock snapshots",
            "2026 Week 2 was diagnosis only and was not used for fit, selection, or confirmation",
            "public and sharp split history is unavailable at comparable timestamps and is excluded",
        ],
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
