#!/usr/bin/env python3
"""Fit, select, calibrate, and hold out the real local NFL pregame model.

Development/selection stops at 2024. The script opens 2025 once after model,
market-anchor, residual-distribution, and calibration rules are frozen.
Nothing here writes predictions, grades, tracking, or production state.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from dataclasses import dataclass
from typing import Any, Callable

import joblib
import numpy as np
import pandas as pd
from scipy.special import expit, logit
from scipy.stats import norm
from sklearn.base import RegressorMixin
from sklearn.compose import TransformedTargetRegressor
from sklearn.ensemble import ExtraTreesRegressor, GradientBoostingRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler, StandardScaler


TOURNAMENT_RELEASE = "nfl_real_pregame_model_tournament_2026_08_19_r1"
MODEL_RELEASE = "nfl_pregame_real_local_candidate_2026_08_19_r2"
CALIBRATION_RELEASE = "nfl_empirical_residual_probability_2026_08_19_r1"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_08_19_r1"
TRAIN_START = 2018
SELECTION_SEASON = 2024
HOLDOUT_SEASON = 2025
RANDOM_STATE = 19082026
KERNEL_BANDWIDTH = 1.5


@dataclass(frozen=True)
class Recipe:
    name: str
    components: tuple[tuple[str, float], ...]


@dataclass(frozen=True)
class MarketRecipe:
    name: str
    kind: str
    independent_weight: float = 0.0
    residual_model: str | None = None
    residual_weight: float = 0.0


class ProbabilityCalibrator:
    def __init__(self, method: str):
        self.method = method
        self.model: Any = None

    def fit(self, probabilities: np.ndarray, outcomes: np.ndarray) -> "ProbabilityCalibrator":
        p = np.clip(np.asarray(probabilities, dtype=float), 0.001, 0.999)
        y = np.asarray(outcomes, dtype=int)
        if self.method == "identity":
            return self
        if self.method == "platt":
            self.model = LogisticRegression(C=10.0, solver="lbfgs", random_state=RANDOM_STATE)
            self.model.fit(logit(p).reshape(-1, 1), y)
            return self
        if self.method == "isotonic":
            self.model = IsotonicRegression(y_min=0.01, y_max=0.99, out_of_bounds="clip")
            self.model.fit(p, y)
            return self
        raise ValueError(f"unknown calibration method {self.method}")

    def predict(self, probabilities: np.ndarray) -> np.ndarray:
        p = np.clip(np.asarray(probabilities, dtype=float), 0.001, 0.999)
        if self.method == "identity":
            return p
        if self.method == "platt":
            return self.model.predict_proba(logit(p).reshape(-1, 1))[:, 1]
        return np.asarray(self.model.predict(p), dtype=float)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def estimator_factories() -> dict[str, Callable[[], RegressorMixin]]:
    def linear(alpha: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", Ridge(alpha=alpha)),
        ])

    def robust(alpha: float) -> TransformedTargetRegressor:
        return TransformedTargetRegressor(
            regressor=Pipeline([
                ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
                ("scale", RobustScaler()),
                ("model", Ridge(alpha=alpha)),
            ]),
            transformer=RobustScaler(),
        )

    def tree(model: RegressorMixin) -> Pipeline:
        return Pipeline([("imputer", SimpleImputer(strategy="median", add_indicator=False)), ("model", model)])

    return {
        "ridge_30": lambda: linear(30.0),
        "ridge_100": lambda: linear(100.0),
        "ridge_300": lambda: linear(300.0),
        "robust_ridge_100": lambda: robust(100.0),
        "hist_leaf20": lambda: HistGradientBoostingRegressor(
            learning_rate=0.035, max_iter=300, max_leaf_nodes=15, min_samples_leaf=20,
            l2_regularization=8.0, random_state=RANDOM_STATE,
        ),
        "hist_leaf40": lambda: HistGradientBoostingRegressor(
            learning_rate=0.04, max_iter=260, max_leaf_nodes=15, min_samples_leaf=40,
            l2_regularization=12.0, random_state=RANDOM_STATE,
        ),
        "gbr_huber": lambda: tree(GradientBoostingRegressor(
            loss="huber", learning_rate=0.025, n_estimators=320, max_depth=2,
            min_samples_leaf=12, max_features=0.7, random_state=RANDOM_STATE,
        )),
        "extra_trees": lambda: tree(ExtraTreesRegressor(
            n_estimators=500, min_samples_leaf=8, max_features=0.65,
            n_jobs=-1, random_state=RANDOM_STATE,
        )),
        "random_forest": lambda: tree(RandomForestRegressor(
            n_estimators=500, min_samples_leaf=10, max_features=0.65,
            n_jobs=-1, random_state=RANDOM_STATE,
        )),
    }


def feature_columns(frame: pd.DataFrame) -> list[str]:
    context = {
        "week", "neutral_site", "division_game", "home_rest", "away_rest", "rest_diff",
        "temperature", "wind", "roof_indoor", "surface_grass", "home_elo", "away_elo",
        "elo_diff", "home_games_state", "away_games_state",
        "home_injury_weight", "away_injury_weight", "home_qb_injury_weight", "away_qb_injury_weight",
        "home_out_count", "away_out_count", "home_injury_reported_count", "away_injury_reported_count",
        "home_roster_continuity", "away_roster_continuity", "home_qb_epa", "away_qb_epa",
        "home_qb_cpoe", "away_qb_cpoe", "home_qb_sack_rate", "away_qb_sack_rate",
        "home_qb_turnover_rate", "away_qb_turnover_rate", "home_qb_log_dropbacks", "away_qb_log_dropbacks",
        "home_qb_same_as_last_start", "away_qb_same_as_last_start", "home_coach_continuity", "away_coach_continuity",
    }
    prefixes = (
        "home_matchup_fast_", "away_matchup_fast_", "home_matchup_slow_", "away_matchup_slow_",
        "home_off_adj_", "away_off_adj_", "home_def_adj_", "away_def_adj_",
    )
    selected = [column for column in frame.columns if column in context or column.startswith(prefixes)]
    non_numeric = [column for column in selected if not pd.api.types.is_numeric_dtype(frame[column])]
    if non_numeric:
        raise RuntimeError(f"non-numeric model features: {non_numeric}")
    return sorted(selected)


def fit_models(
    train: pd.DataFrame,
    feature_names: list[str],
    target: np.ndarray,
    names: set[str] | None = None,
) -> dict[str, RegressorMixin]:
    factories = estimator_factories()
    selected = sorted(names or set(factories))
    models: dict[str, RegressorMixin] = {}
    for name in selected:
        model = factories[name]()
        model.fit(train[feature_names], target)
        models[name] = model
    return models


def predict_models(models: dict[str, RegressorMixin], test: pd.DataFrame, feature_names: list[str]) -> dict[str, np.ndarray]:
    return {name: np.asarray(model.predict(test[feature_names]), dtype=float) for name, model in models.items()}


def recipe_predictions(predictions: dict[str, np.ndarray]) -> dict[str, tuple[Recipe, np.ndarray]]:
    result: dict[str, tuple[Recipe, np.ndarray]] = {}
    for name, values in predictions.items():
        recipe = Recipe(name=name, components=((name, 1.0),))
        result[name] = (recipe, values)
    names = sorted(predictions)
    for first_index, first in enumerate(names):
        for second in names[first_index + 1:]:
            for first_weight in [0.25, 0.5, 0.75]:
                second_weight = 1.0 - first_weight
                name = f"blend_{first_weight:.2f}_{first}__{second}"
                recipe = Recipe(name, ((first, first_weight), (second, second_weight)))
                result[name] = (recipe, first_weight * predictions[first] + second_weight * predictions[second])
    return result


def predict_recipe(models: dict[str, RegressorMixin], test: pd.DataFrame, feature_names: list[str], recipe: Recipe) -> np.ndarray:
    return sum(weight * np.asarray(models[name].predict(test[feature_names]), dtype=float) for name, weight in recipe.components)


def point_metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float]:
    error = prediction - actual
    return {
        "mae": float(mean_absolute_error(actual, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(actual, prediction))),
        "bias": float(np.mean(error)),
        "correlation": float(np.corrcoef(actual, prediction)[0, 1]),
    }


def select_independent_recipe(predictions: dict[str, np.ndarray], actual: np.ndarray) -> tuple[Recipe, list[dict[str, Any]]]:
    ranked = []
    for recipe, values in recipe_predictions(predictions).values():
        ranked.append({"recipe": recipe, **point_metrics(actual, values)})
    ranked.sort(key=lambda item: (item["mae"], item["rmse"], len(item["recipe"].components)))
    return ranked[0]["recipe"], [
        {**{key: value for key, value in row.items() if key != "recipe"}, "recipe": row["recipe"].name,
         "components": row["recipe"].components}
        for row in ranked[:20]
    ]


def select_market_recipe(
    actual: np.ndarray,
    market: np.ndarray,
    independent: np.ndarray,
    residual_predictions: dict[str, np.ndarray],
) -> tuple[MarketRecipe, list[dict[str, Any]]]:
    candidates: list[tuple[MarketRecipe, np.ndarray]] = [(MarketRecipe("market_only", "market_only"), market)]
    for weight in np.arange(0.1, 1.01, 0.1):
        candidates.append((
            MarketRecipe(f"blend_independent_{weight:.1f}", "independent_blend", independent_weight=float(weight)),
            market + float(weight) * (independent - market),
        ))
    for name, residual in residual_predictions.items():
        for weight in [0.25, 0.5, 0.75, 1.0]:
            candidates.append((
                MarketRecipe(f"market_plus_{weight:.2f}_{name}_residual", "residual", residual_model=name, residual_weight=weight),
                market + weight * residual,
            ))
    ranked = [{"recipe": recipe, **point_metrics(actual, values)} for recipe, values in candidates]
    ranked.sort(key=lambda item: (item["mae"], item["rmse"], item["recipe"].name))
    return ranked[0]["recipe"], [
        {**{key: value for key, value in row.items() if key != "recipe"}, "recipe": row["recipe"].name,
         "kind": row["recipe"].kind}
        for row in ranked[:20]
    ]


def apply_market_recipe(
    recipe: MarketRecipe,
    market: np.ndarray,
    independent: np.ndarray,
    residual_models: dict[str, RegressorMixin] | None,
    test: pd.DataFrame,
    feature_names: list[str],
) -> np.ndarray:
    if recipe.kind == "market_only":
        return market.copy()
    if recipe.kind == "independent_blend":
        return market + recipe.independent_weight * (independent - market)
    if recipe.residual_model is None or residual_models is None:
        raise RuntimeError("residual market recipe requires a fitted residual model")
    residual = np.asarray(residual_models[recipe.residual_model].predict(test[feature_names]), dtype=float)
    return market + recipe.residual_weight * residual


def empirical_probability(prediction: np.ndarray, threshold: np.ndarray | float, residuals: np.ndarray) -> np.ndarray:
    center = np.asarray(prediction, dtype=float)[:, None] + np.asarray(residuals, dtype=float)[None, :]
    cut = np.asarray(threshold, dtype=float)
    if cut.ndim == 0:
        cut = np.full(len(prediction), float(cut))
    return np.mean(norm.cdf((center - cut[:, None]) / KERNEL_BANDWIDTH), axis=1)


def calibration_metrics(probabilities: np.ndarray, outcomes: np.ndarray) -> dict[str, float]:
    p = np.clip(np.asarray(probabilities, dtype=float), 0.001, 0.999)
    y = np.asarray(outcomes, dtype=int)
    bins = np.minimum(9, np.floor(p * 10).astype(int))
    ece = 0.0
    for index in range(10):
        mask = bins == index
        if mask.any():
            ece += float(mask.mean()) * abs(float(p[mask].mean()) - float(y[mask].mean()))
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
        "ece10": ece,
        "meanProbability": float(p.mean()),
        "outcomeRate": float(y.mean()),
    }


def american_implied(price: np.ndarray) -> np.ndarray:
    values = np.asarray(price, dtype=float)
    return np.where(values > 0, 100.0 / (values + 100.0), -values / (-values + 100.0))


def no_vig(first: np.ndarray, second: np.ndarray) -> np.ndarray:
    a = american_implied(first)
    b = american_implied(second)
    return a / (a + b)


def profit_one(price: float) -> float:
    return price / 100.0 if price > 0 else 100.0 / abs(price)


def simulate_market(
    probabilities: np.ndarray,
    fair_probabilities: np.ndarray,
    first_prices: np.ndarray,
    second_prices: np.ndarray,
    first_outcome: np.ndarray,
    pushes: np.ndarray,
    threshold: float,
) -> dict[str, Any]:
    first_edge = probabilities - fair_probabilities
    take_first = first_edge >= threshold
    take_second = -first_edge >= threshold
    selected = take_first | take_second
    units = 0.0
    wins = 0
    losses = 0
    push_count = 0
    for index in np.where(selected)[0]:
        if pushes[index]:
            push_count += 1
            continue
        won = bool(first_outcome[index]) if take_first[index] else not bool(first_outcome[index])
        price = float(first_prices[index] if take_first[index] else second_prices[index])
        units += profit_one(price) if won else -1.0
        wins += int(won)
        losses += int(not won)
    return {
        "minimumEdge": threshold,
        "boardCount": int(selected.sum()),
        "resolved": wins + losses,
        "wins": wins,
        "losses": losses,
        "pushes": push_count,
        "units": units,
        "roiPerUnitRisked": units / int(selected.sum()) if selected.any() else None,
    }


def recipe_json(recipe: Recipe) -> dict[str, Any]:
    return {"name": recipe.name, "components": [{"model": name, "weight": weight} for name, weight in recipe.components]}


def market_recipe_json(recipe: MarketRecipe) -> dict[str, Any]:
    return {
        "name": recipe.name, "kind": recipe.kind, "independentWeight": recipe.independent_weight,
        "residualModel": recipe.residual_model, "residualWeight": recipe.residual_weight,
    }


def fit_target(
    frame: pd.DataFrame,
    feature_names: list[str],
    target_column: str,
    market_column: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    development = frame[(frame["season"] >= TRAIN_START) & (frame["season"] < SELECTION_SEASON)]
    selection = frame[frame["season"] == SELECTION_SEASON]
    y_dev = development[target_column].to_numpy(float)
    y_selection = selection[target_column].to_numpy(float)
    market_selection = selection[market_column].to_numpy(float)

    development_models = fit_models(development, feature_names, y_dev)
    selection_predictions = predict_models(development_models, selection, feature_names)
    independent_recipe, independent_ranking = select_independent_recipe(selection_predictions, y_selection)
    independent_selection = sum(
        weight * selection_predictions[name] for name, weight in independent_recipe.components
    )

    residual_dev = y_dev - development[market_column].to_numpy(float)
    residual_models = fit_models(development, feature_names, residual_dev)
    residual_selection = predict_models(residual_models, selection, feature_names)
    market_recipe, market_ranking = select_market_recipe(
        y_selection, market_selection, independent_selection, residual_selection
    )

    required_independent = {name for name, _ in independent_recipe.components}
    required_residual = {market_recipe.residual_model} if market_recipe.residual_model else set()
    oos_rows: list[pd.DataFrame] = []
    for test_season in range(2020, SELECTION_SEASON + 1):
        train = frame[(frame["season"] >= TRAIN_START) & (frame["season"] < test_season)]
        test = frame[frame["season"] == test_season].copy()
        independent_models = fit_models(train, feature_names, train[target_column].to_numpy(float), required_independent)
        independent = predict_recipe(independent_models, test, feature_names, independent_recipe)
        fitted_residuals = None
        if required_residual:
            residual_target = train[target_column].to_numpy(float) - train[market_column].to_numpy(float)
            fitted_residuals = fit_models(train, feature_names, residual_target, required_residual)
        market_aware = apply_market_recipe(
            market_recipe, test[market_column].to_numpy(float), independent,
            fitted_residuals, test, feature_names,
        )
        test["independent_prediction"] = independent
        test["market_prediction"] = market_aware
        test["residual"] = test[target_column] - market_aware
        oos_rows.append(test)
    oos = pd.concat(oos_rows, ignore_index=True).sort_values(["season", "week", "game_id"])

    final_train = frame[(frame["season"] >= TRAIN_START) & (frame["season"] < HOLDOUT_SEASON)]
    holdout = frame[frame["season"] == HOLDOUT_SEASON].copy()
    final_independent_models = fit_models(
        final_train, feature_names, final_train[target_column].to_numpy(float), required_independent
    )
    holdout_independent = predict_recipe(final_independent_models, holdout, feature_names, independent_recipe)
    final_residual_models = None
    if required_residual:
        residual_target = final_train[target_column].to_numpy(float) - final_train[market_column].to_numpy(float)
        final_residual_models = fit_models(final_train, feature_names, residual_target, required_residual)
    holdout_market = apply_market_recipe(
        market_recipe, holdout[market_column].to_numpy(float), holdout_independent,
        final_residual_models, holdout, feature_names,
    )
    holdout["independent_prediction"] = holdout_independent
    holdout["market_prediction"] = holdout_market

    selection_market_prediction = apply_market_recipe(
        market_recipe, market_selection, independent_selection, residual_models, selection, feature_names
    )
    report = {
        "target": target_column,
        "marketColumn": market_column,
        "independentRecipe": recipe_json(independent_recipe),
        "marketRecipe": market_recipe_json(market_recipe),
        "selection": {
            "season": SELECTION_SEASON,
            "rows": len(selection),
            "independent": point_metrics(y_selection, independent_selection),
            "marketAware": point_metrics(y_selection, selection_market_prediction),
            "marketOnly": point_metrics(y_selection, market_selection),
        },
        "holdout": {
            "season": HOLDOUT_SEASON,
            "rows": len(holdout),
            "independent": point_metrics(holdout[target_column].to_numpy(float), holdout_independent),
            "marketAware": point_metrics(holdout[target_column].to_numpy(float), holdout_market),
            "marketOnly": point_metrics(holdout[target_column].to_numpy(float), holdout[market_column].to_numpy(float)),
        },
        "topIndependentSelection": independent_ranking,
        "topMarketSelection": market_ranking,
    }
    artifact = {
        "independentRecipe": independent_recipe,
        "marketRecipe": market_recipe,
        "independentModels": final_independent_models,
        "residualModels": final_residual_models,
        "oos": oos,
        "holdout": holdout,
    }
    return report, artifact


def calibrate_probabilities(
    margin_artifact: dict[str, Any],
    total_artifact: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, ProbabilityCalibrator], pd.DataFrame]:
    margin_oos = margin_artifact["oos"]
    total_oos = total_artifact["oos"]
    keys = ["game_id", "season", "week"]
    oos = margin_oos.merge(
        total_oos[keys + ["market_prediction", "residual"]], on=keys, suffixes=("_margin", "_total"), validate="one_to_one"
    )
    probability_rows: list[pd.DataFrame] = []
    for season in range(2021, SELECTION_SEASON + 1):
        test = oos[oos["season"] == season].copy()
        margin_residuals = oos[oos["season"] < season]["residual_margin"].to_numpy(float)
        total_residuals = oos[oos["season"] < season]["residual_total"].to_numpy(float)
        if len(margin_residuals) < 200 or len(total_residuals) < 200:
            raise RuntimeError("insufficient prior out-of-sample residuals for calibration")
        test["raw_home_win"] = empirical_probability(test["market_prediction_margin"].to_numpy(float), 0.0, margin_residuals)
        test["raw_home_cover"] = empirical_probability(
            test["market_prediction_margin"].to_numpy(float), test["market_home_margin"].to_numpy(float), margin_residuals
        )
        test["raw_over"] = empirical_probability(
            test["market_prediction_total"].to_numpy(float), test["market_total"].to_numpy(float), total_residuals
        )
        probability_rows.append(test)
    probabilities = pd.concat(probability_rows, ignore_index=True)
    definitions = {
        "moneyline": ("raw_home_win", probabilities["actual_margin"].gt(0), probabilities["actual_margin"].eq(0)),
        "spread": (
            "raw_home_cover", probabilities["actual_margin"].gt(probabilities["market_home_margin"]),
            probabilities["actual_margin"].eq(probabilities["market_home_margin"]),
        ),
        "total": (
            "raw_over", probabilities["actual_total"].gt(probabilities["market_total"]),
            probabilities["actual_total"].eq(probabilities["market_total"]),
        ),
    }
    calibrators: dict[str, ProbabilityCalibrator] = {}
    calibration_report: dict[str, Any] = {}
    for market, (probability_column, outcomes_series, pushes_series) in definitions.items():
        market_frame = probabilities.assign(outcome=outcomes_series.astype(int), push=pushes_series.astype(bool))
        training = market_frame[(market_frame["season"] <= 2023) & ~market_frame["push"]]
        selection = market_frame[(market_frame["season"] == SELECTION_SEASON) & ~market_frame["push"]]
        ranked: list[dict[str, Any]] = []
        for method in ["identity", "platt", "isotonic"]:
            calibrator = ProbabilityCalibrator(method).fit(
                training[probability_column].to_numpy(float), training["outcome"].to_numpy(int)
            )
            prediction = calibrator.predict(selection[probability_column].to_numpy(float))
            ranked.append({"method": method, **calibration_metrics(prediction, selection["outcome"].to_numpy(int))})
        ranked.sort(key=lambda item: (item["brier"], item["logLoss"], ["identity", "platt", "isotonic"].index(item["method"])))
        selected_method = ranked[0]["method"]
        all_development = market_frame[~market_frame["push"]]
        calibrator = ProbabilityCalibrator(selected_method).fit(
            all_development[probability_column].to_numpy(float), all_development["outcome"].to_numpy(int)
        )
        calibrators[market] = calibrator
        calibration_report[market] = {
            "selectedMethod": selected_method,
            "selectionRanking": ranked,
            "developmentRows": len(all_development),
        }

    margin_holdout = margin_artifact["holdout"]
    total_holdout = total_artifact["holdout"]
    holdout = margin_holdout.merge(
        total_holdout[keys + ["market_prediction"]], on=keys, suffixes=("_margin", "_total"), validate="one_to_one"
    )
    margin_residuals = margin_artifact["oos"]["residual"].to_numpy(float)
    total_residuals = total_artifact["oos"]["residual"].to_numpy(float)
    holdout["home_win_probability"] = calibrators["moneyline"].predict(empirical_probability(
        holdout["market_prediction_margin"].to_numpy(float), 0.0, margin_residuals
    ))
    holdout["home_cover_probability"] = calibrators["spread"].predict(empirical_probability(
        holdout["market_prediction_margin"].to_numpy(float), holdout["market_home_margin"].to_numpy(float), margin_residuals
    ))
    holdout["over_probability"] = calibrators["total"].predict(empirical_probability(
        holdout["market_prediction_total"].to_numpy(float), holdout["market_total"].to_numpy(float), total_residuals
    ))

    holdout_evaluation = {}
    for market, probability_column, outcome, push in [
        ("moneyline", "home_win_probability", holdout["actual_margin"].gt(0), holdout["actual_margin"].eq(0)),
        ("spread", "home_cover_probability", holdout["actual_margin"].gt(holdout["market_home_margin"]), holdout["actual_margin"].eq(holdout["market_home_margin"])),
        ("total", "over_probability", holdout["actual_total"].gt(holdout["market_total"]), holdout["actual_total"].eq(holdout["market_total"])),
    ]:
        keep = ~push.to_numpy(bool)
        holdout_evaluation[market] = calibration_metrics(
            holdout.loc[keep, probability_column].to_numpy(float), outcome.to_numpy(int)[keep]
        )

    report = {
        "calibrationRelease": CALIBRATION_RELEASE,
        "kernelBandwidthPoints": KERNEL_BANDWIDTH,
        "calibrationSelection": calibration_report,
        "holdout": holdout_evaluation,
        "marginResidualStdDev": float(np.std(margin_residuals, ddof=1)),
        "totalResidualStdDev": float(np.std(total_residuals, ddof=1)),
        "marginResidualQuantiles": {
            str(q): float(np.quantile(margin_residuals, q)) for q in [0.05, 0.25, 0.5, 0.75, 0.95]
        },
        "totalResidualQuantiles": {
            str(q): float(np.quantile(total_residuals, q)) for q in [0.05, 0.25, 0.5, 0.75, 0.95]
        },
    }
    return report, calibrators, holdout


def betting_report(holdout: pd.DataFrame) -> dict[str, Any]:
    valid_prices = holdout[[
        "home_moneyline", "away_moneyline", "home_spread_odds", "away_spread_odds", "over_odds", "under_odds"
    ]].notna().all(axis=1)
    frame = holdout[valid_prices].copy()
    fair_ml = no_vig(frame["home_moneyline"].to_numpy(float), frame["away_moneyline"].to_numpy(float))
    fair_spread = no_vig(frame["home_spread_odds"].to_numpy(float), frame["away_spread_odds"].to_numpy(float))
    fair_total = no_vig(frame["over_odds"].to_numpy(float), frame["under_odds"].to_numpy(float))
    outcomes = {
        "moneyline": (frame["actual_margin"].gt(0).to_numpy(bool), frame["actual_margin"].eq(0).to_numpy(bool)),
        "spread": (
            frame["actual_margin"].gt(frame["market_home_margin"]).to_numpy(bool),
            frame["actual_margin"].eq(frame["market_home_margin"]).to_numpy(bool),
        ),
        "total": (
            frame["actual_total"].gt(frame["market_total"]).to_numpy(bool),
            frame["actual_total"].eq(frame["market_total"]).to_numpy(bool),
        ),
    }
    configs = {
        "moneyline": (
            frame["home_win_probability"].to_numpy(float), fair_ml,
            frame["home_moneyline"].to_numpy(float), frame["away_moneyline"].to_numpy(float),
        ),
        "spread": (
            frame["home_cover_probability"].to_numpy(float), fair_spread,
            frame["home_spread_odds"].to_numpy(float), frame["away_spread_odds"].to_numpy(float),
        ),
        "total": (
            frame["over_probability"].to_numpy(float), fair_total,
            frame["over_odds"].to_numpy(float), frame["under_odds"].to_numpy(float),
        ),
    }
    return {
        market: [
            simulate_market(probability, fair, first_price, second_price, outcomes[market][0], outcomes[market][1], threshold)
            for threshold in [0.0, 0.02, 0.03, 0.04, 0.05]
        ]
        for market, (probability, fair, first_price, second_price) in configs.items()
    }


def main() -> None:
    root = pathlib.Path.cwd()
    feature_manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    feature_manifest = json.loads(feature_manifest_path.read_text(encoding="utf-8"))
    if feature_manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature manifest release mismatch")
    feature_path = pathlib.Path(feature_manifest["featureFile"])
    if sha256_file(feature_path) != feature_manifest["featureFileSha256"]:
        raise RuntimeError("feature artifact checksum mismatch")
    frame = pd.read_parquet(feature_path)
    features = feature_columns(frame)
    if len(features) < 100 or frame["game_id"].duplicated().any():
        raise RuntimeError("unexpected model feature shape or duplicate game identity")
    print(f"model features: {len(features)}; games: {len(frame)}")

    margin_report, margin_artifact = fit_target(frame, features, "actual_margin", "market_home_margin")
    print("margin selection", json.dumps(margin_report["selection"], indent=2))
    print("margin holdout", json.dumps(margin_report["holdout"], indent=2))
    total_report, total_artifact = fit_target(frame, features, "actual_total", "market_total")
    print("total selection", json.dumps(total_report["selection"], indent=2))
    print("total holdout", json.dumps(total_report["holdout"], indent=2))
    calibration_report, calibrators, holdout = calibrate_probabilities(margin_artifact, total_artifact)
    wagering = betting_report(holdout)

    artifact_root = root / "football-research/cache/nfl-model"
    model_artifact_path = artifact_root / "nfl_pregame_real_local_candidate_2026_08_19_r2.joblib"
    artifact = {
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "featureNames": features,
        "margin": {key: value for key, value in margin_artifact.items() if key not in {"oos", "holdout"}},
        "total": {key: value for key, value in total_artifact.items() if key not in {"oos", "holdout"}},
        "calibrators": calibrators,
        "marginResiduals": margin_artifact["oos"]["residual"].to_numpy(float),
        "totalResiduals": total_artifact["oos"]["residual"].to_numpy(float),
        "kernelBandwidthPoints": KERNEL_BANDWIDTH,
        "trainedThrough": "2024-12-31",
    }
    joblib.dump(artifact, model_artifact_path, compress=3)
    holdout_path = artifact_root / "nfl_2025_holdout_predictions_r2.parquet"
    holdout.to_parquet(holdout_path, index=False)

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "modelRelease": MODEL_RELEASE,
        "calibrationRelease": CALIBRATION_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "actionable": False,
        "officialTrackingChanged": False,
        "preseasonIncluded": False,
        "trainingStartSeason": TRAIN_START,
        "selectionSeason": SELECTION_SEASON,
        "holdoutSeason": HOLDOUT_SEASON,
        "featureCount": len(features),
        "featureArtifactSha256": feature_manifest["featureFileSha256"],
        "modelArtifact": str(model_artifact_path),
        "modelArtifactSha256": sha256_file(model_artifact_path),
        "holdoutPredictionSha256": sha256_file(holdout_path),
        "margin": margin_report,
        "total": total_report,
        "probabilities": calibration_report,
        "holdoutWagerSimulationAtTerminalPrices": wagering,
        "launchGate": {
            "status": "shadow_forward_validation_required",
            "reason": "2025 is an untouched historical holdout, but no model release is promoted from a single historical holdout; 2026 locked forward predictions are required",
            "preseasonTracking": "permanently_excluded",
            "regularSeasonTracking": "append_to_existing_nfl_lifetime_only_after_launch_approval",
        },
        "limitations": [
            "nflverse spread/total and American prices are terminal game lines, not timestamped OddSphere weekly lock snapshots",
            "historical starting quarterback identity is known, but current-week starter certainty still requires a timestamped depth/availability feed",
            "public and sharp split history is not available at comparable timestamps and is excluded from model fitting",
            "preseason games are absent from the training sources and are not scored by this regular-season release",
            "wager simulation is threshold sensitivity at terminal prices and is not an official tracked record",
        ],
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "modelRelease": MODEL_RELEASE,
        "marginHoldout": margin_report["holdout"],
        "totalHoldout": total_report["holdout"],
        "probabilityHoldout": calibration_report["holdout"],
        "wageringAt3pp": {market: rows[2] for market, rows in wagering.items()},
        "report": str(report_path),
        "artifactSha256": report["modelArtifactSha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
