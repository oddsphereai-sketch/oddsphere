#!/usr/bin/env python3
"""Frozen NFL weekly joint-score engine tournament.

Research only. This script never writes predictions, grades, tracking rows, or
production state. See the matching 2026-09-25 predeclaration.
"""

from __future__ import annotations

import json
import math
import pathlib
import time
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.base import RegressorMixin
from sklearn.compose import TransformedTargetRegressor
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import RobustScaler, StandardScaler

from tournament_nfl_market_context_residual_r1 import (
    FEATURE_RELEASE,
    action_report,
    add_market_context,
    sha256_file,
)


TOURNAMENT_RELEASE = "nfl_weekly_joint_score_engine_tournament_2026_09_25_r1"
TRAIN_SEASONS = tuple(range(2018, 2023))
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
MARKET_WEIGHTS = tuple(value / 10.0 for value in range(10))
RANDOM_STATE = 25092026


@dataclass(frozen=True)
class Recipe:
    name: str
    components: tuple[str, ...]
    market_weight: float


def estimator_factories() -> dict[str, Callable[[], RegressorMixin]]:
    def ridge(alpha: float) -> Pipeline:
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
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=False)),
            ("model", model),
        ])

    return {
        "ridge_100": lambda: ridge(100.0),
        "ridge_300": lambda: ridge(300.0),
        "robust_ridge_300": lambda: robust(300.0),
        "hist_leaf40": lambda: tree(HistGradientBoostingRegressor(
            learning_rate=0.035,
            max_iter=300,
            max_leaf_nodes=15,
            min_samples_leaf=40,
            l2_regularization=16.0,
            random_state=RANDOM_STATE,
        )),
        "extra_trees": lambda: tree(ExtraTreesRegressor(
            n_estimators=500,
            min_samples_leaf=10,
            max_features=0.65,
            n_jobs=-1,
            random_state=RANDOM_STATE,
        )),
    }


def oriented_team_frame(games: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    excluded_suffixes = {
        "score", "moneyline", "spread_odds", "home_margin", "total",
    }
    paired_suffixes = sorted({
        column.removeprefix("home_").removeprefix("away_")
        for column in games.columns
        if (column.startswith("home_") or column.startswith("away_"))
        and pd.api.types.is_numeric_dtype(games[column])
        and column.removeprefix("home_").removeprefix("away_") not in excluded_suffixes
        and f"home_{column.removeprefix('home_').removeprefix('away_')}" in games.columns
        and f"away_{column.removeprefix('home_').removeprefix('away_')}" in games.columns
    })
    shared = [
        "week", "neutral_site", "division_game", "temperature", "wind",
        "roof_indoor", "surface_grass",
    ]
    rows: list[dict[str, Any]] = []
    for game_row, game in games.reset_index(drop=True).iterrows():
        market_margin = float(game["market_home_margin"])
        market_total = float(game["market_total"])
        for side in ("home", "away"):
            opponent = "away" if side == "home" else "home"
            oriented_margin = market_margin if side == "home" else -market_margin
            row: dict[str, Any] = {
                "game_row": int(game_row),
                "game_id": str(game["game_id"]),
                "season": int(game["season"]),
                "side": side,
                "team_score": float(game[f"{side}_score"]),
                "market_implied_score": (market_total + oriented_margin) / 2.0,
                "home_indicator": float(side == "home"),
            }
            for column in shared:
                row[column] = float(game[column])
            for suffix in paired_suffixes:
                row[f"team_{suffix}"] = float(game[f"{side}_{suffix}"])
                row[f"opponent_{suffix}"] = float(game[f"{opponent}_{suffix}"])
            rows.append(row)
    frame = pd.DataFrame(rows)
    identifiers = {
        "game_row", "game_id", "season", "side", "team_score",
        "market_implied_score",
    }
    features = sorted(column for column in frame.columns if column not in identifiers)
    non_numeric = [column for column in features if not pd.api.types.is_numeric_dtype(frame[column])]
    if non_numeric:
        raise RuntimeError(f"non-numeric independent features: {non_numeric}")
    forbidden = [column for column in features if "market" in column or "score" in column]
    if forbidden:
        raise RuntimeError(f"market/result leakage in independent features: {forbidden}")
    return frame, features


def prediction_sets(models: dict[str, RegressorMixin], frame: pd.DataFrame, features: list[str]) -> dict[str, np.ndarray]:
    base = {name: np.asarray(model.predict(frame[features]), dtype=float) for name, model in models.items()}
    base["linear_ensemble"] = np.mean(np.vstack([
        base["ridge_100"], base["ridge_300"], base["robust_ridge_300"],
    ]), axis=0)
    base["nonlinear_ensemble"] = np.mean(np.vstack([
        base["hist_leaf40"], base["extra_trees"],
    ]), axis=0)
    base["all_ensemble"] = np.mean(np.vstack([
        base["ridge_100"], base["ridge_300"], base["robust_ridge_300"],
        base["hist_leaf40"], base["extra_trees"],
    ]), axis=0)
    return base


def recipe_components(name: str) -> tuple[str, ...]:
    if name == "linear_ensemble":
        return ("ridge_100", "ridge_300", "robust_ridge_300")
    if name == "nonlinear_ensemble":
        return ("hist_leaf40", "extra_trees")
    if name == "all_ensemble":
        return tuple(estimator_factories())
    return (name,)


def fit_models(team_frame: pd.DataFrame, features: list[str], components: tuple[str, ...] | None = None) -> dict[str, RegressorMixin]:
    factories = estimator_factories()
    selected = tuple(factories) if components is None else components
    result: dict[str, RegressorMixin] = {}
    for name in selected:
        model = factories[name]()
        model.fit(team_frame[features], team_frame["team_score"].to_numpy(float))
        result[name] = model
    return result


def apply_recipe(team_frame: pd.DataFrame, independent: np.ndarray, market_weight: float) -> np.ndarray:
    market = team_frame["market_implied_score"].to_numpy(float)
    return (1.0 - market_weight) * independent + market_weight * market


def pair_games(games: pd.DataFrame, teams: pd.DataFrame, team_scores: np.ndarray) -> dict[str, np.ndarray]:
    scored = teams[["game_row", "side"]].copy()
    scored["score"] = team_scores
    home = scored[scored["side"].eq("home")].sort_values("game_row")
    away = scored[scored["side"].eq("away")].sort_values("game_row")
    if len(home) != len(games) or not np.array_equal(home["game_row"], away["game_row"]):
        raise RuntimeError("home/away score pairing failed")
    home_score = home["score"].to_numpy(float)
    away_score = away["score"].to_numpy(float)
    return {
        "home": home_score,
        "away": away_score,
        "margin": home_score - away_score,
        "total": home_score + away_score,
    }


def point_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "bias": float(np.mean(predicted - actual)),
    }


def accuracy(predicted: np.ndarray, actual: np.ndarray, boundary: np.ndarray | float) -> dict[str, Any]:
    boundary_values = np.full(len(actual), float(boundary)) if np.isscalar(boundary) else np.asarray(boundary, dtype=float)
    resolved = actual != boundary_values
    called = predicted != boundary_values
    keep = resolved & called
    correct = (predicted[keep] > boundary_values[keep]) == (actual[keep] > boundary_values[keep])
    return {
        "resolved": int(keep.sum()),
        "correct": int(correct.sum()),
        "accuracy": float(correct.mean()) if len(correct) else None,
        "positive": int(np.sum(predicted[keep] > boundary_values[keep])),
        "negative": int(np.sum(predicted[keep] < boundary_values[keep])),
    }


def score_metrics(games: pd.DataFrame, scores: dict[str, np.ndarray]) -> dict[str, Any]:
    actual_home = games["home_score"].to_numpy(float)
    actual_away = games["away_score"].to_numpy(float)
    actual_margin = games["actual_margin"].to_numpy(float)
    actual_total = games["actual_total"].to_numpy(float)
    market_margin = games["market_home_margin"].to_numpy(float)
    market_total = games["market_total"].to_numpy(float)
    market_home = (market_total + market_margin) / 2.0
    market_away = (market_total - market_margin) / 2.0
    return {
        "teamScore": point_metrics(
            np.concatenate([actual_home, actual_away]),
            np.concatenate([scores["home"], scores["away"]]),
        ),
        "margin": point_metrics(actual_margin, scores["margin"]),
        "total": point_metrics(actual_total, scores["total"]),
        "moneylineDirection": accuracy(scores["margin"], actual_margin, 0.0),
        "spreadDirection": accuracy(scores["margin"], actual_margin, market_margin),
        "totalDirection": accuracy(scores["total"], actual_total, market_total),
        "market": {
            "teamScore": point_metrics(
                np.concatenate([actual_home, actual_away]),
                np.concatenate([market_home, market_away]),
            ),
            "margin": point_metrics(actual_margin, market_margin),
            "total": point_metrics(actual_total, market_total),
            "moneylineDirection": accuracy(market_margin, actual_margin, 0.0),
        },
    }


def recipe_rank(metrics: dict[str, Any], market_weight: float, name: str) -> tuple[float, ...]:
    market = metrics["market"]
    joint = (
        metrics["teamScore"]["mae"] / market["teamScore"]["mae"]
        + metrics["margin"]["mae"] / market["margin"]["mae"]
        + metrics["total"]["mae"] / market["total"]["mae"]
    )
    return (
        joint,
        -float(metrics["moneylineDirection"]["accuracy"] or 0.0),
        -float(metrics["spreadDirection"]["accuracy"] or 0.0),
        -float(metrics["totalDirection"]["accuracy"] or 0.0),
        market_weight,
        float(len(recipe_components(name))),
    )


def select_recipe(games: pd.DataFrame, teams: pd.DataFrame, features: list[str]) -> tuple[Recipe, list[dict[str, Any]]]:
    train_games = games[games["season"].isin(TRAIN_SEASONS)].reset_index(drop=True)
    selection_games = games[games["season"].eq(SELECTION_SEASON)].reset_index(drop=True)
    train_teams, train_features = oriented_team_frame(train_games)
    selection_teams, selection_features = oriented_team_frame(selection_games)
    if train_features != features or selection_features != features:
        raise RuntimeError("independent feature schema drift")
    models = fit_models(train_teams, features)
    candidates = prediction_sets(models, selection_teams, features)
    rankings: list[dict[str, Any]] = []
    for name, independent in candidates.items():
        independent_metrics = score_metrics(selection_games, pair_games(selection_games, selection_teams, independent))
        for market_weight in MARKET_WEIGHTS:
            recipe = Recipe(name, recipe_components(name), market_weight)
            scores = pair_games(
                selection_games,
                selection_teams,
                apply_recipe(selection_teams, independent, market_weight),
            )
            metrics = score_metrics(selection_games, scores)
            rankings.append({
                "recipe": recipe,
                "metrics": metrics,
                "independentMetrics": independent_metrics,
                "rank": recipe_rank(metrics, market_weight, name),
            })
    rankings.sort(key=lambda row: row["rank"])
    return rankings[0]["recipe"], rankings


def predict_season(
    games: pd.DataFrame,
    features: list[str],
    recipe: Recipe,
    season: int,
) -> tuple[pd.DataFrame, dict[str, np.ndarray], dict[str, np.ndarray]]:
    train_games = games[(games["season"] >= min(TRAIN_SEASONS)) & (games["season"] < season)].reset_index(drop=True)
    test_games = games[games["season"].eq(season)].reset_index(drop=True)
    train_teams, train_features = oriented_team_frame(train_games)
    test_teams, test_features = oriented_team_frame(test_games)
    if train_features != features or test_features != features:
        raise RuntimeError("season feature schema drift")
    models = fit_models(train_teams, features, recipe.components)
    component_predictions = [np.asarray(models[name].predict(test_teams[features]), dtype=float) for name in recipe.components]
    independent = np.mean(np.vstack(component_predictions), axis=0)
    independent_scores = pair_games(test_games, test_teams, independent)
    calibrated_scores = pair_games(
        test_games,
        test_teams,
        apply_recipe(test_teams, independent, recipe.market_weight),
    )
    return test_games, independent_scores, calibrated_scores


def build_oos_residuals(games: pd.DataFrame, features: list[str], recipe: Recipe) -> tuple[np.ndarray, np.ndarray]:
    margins: list[np.ndarray] = []
    totals: list[np.ndarray] = []
    for season in range(2020, SELECTION_SEASON + 1):
        test, _, scores = predict_season(games, features, recipe, season)
        margins.append(test["actual_margin"].to_numpy(float) - scores["margin"])
        totals.append(test["actual_total"].to_numpy(float) - scores["total"])
    return np.concatenate(margins), np.concatenate(totals)


def probability_metrics(probability: np.ndarray, outcome: np.ndarray) -> dict[str, float]:
    p = np.clip(probability, 0.001, 0.999)
    y = outcome.astype(int)
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
    }


def probability_report(
    games: pd.DataFrame,
    scores: dict[str, np.ndarray],
    margin_sigma: float,
    total_sigma: float,
) -> dict[str, Any]:
    actual_margin = games["actual_margin"].to_numpy(float)
    actual_total = games["actual_total"].to_numpy(float)
    market_margin = games["market_home_margin"].to_numpy(float)
    market_total = games["market_total"].to_numpy(float)
    home_win = norm.cdf(scores["margin"] / margin_sigma)
    home_cover = norm.cdf((scores["margin"] - market_margin) / margin_sigma)
    over = norm.cdf((scores["total"] - market_total) / total_sigma)
    definitions = {
        "moneyline": {
            "probability": home_win,
            "fair": games["market_moneyline_fair_home"].to_numpy(float),
            "outcome": actual_margin > 0,
            "push": actual_margin == 0,
            "prices": ("home_moneyline", "away_moneyline"),
        },
        "spread": {
            "probability": home_cover,
            "fair": games["market_spread_fair_home"].to_numpy(float),
            "outcome": actual_margin > market_margin,
            "push": actual_margin == market_margin,
            "prices": ("home_spread_odds", "away_spread_odds"),
        },
        "total": {
            "probability": over,
            "fair": games["market_total_fair_over"].to_numpy(float),
            "outcome": actual_total > market_total,
            "push": actual_total == market_total,
            "prices": ("over_odds", "under_odds"),
        },
    }
    result: dict[str, Any] = {}
    for name, definition in definitions.items():
        keep = ~definition["push"]
        result[name] = {
            "candidate": probability_metrics(definition["probability"][keep], definition["outcome"][keep]),
            "market": probability_metrics(definition["fair"][keep], definition["outcome"][keep]),
            "actions": action_report(
                games.reset_index(drop=True),
                definition["probability"],
                definition["fair"],
                definition["outcome"],
                definition["push"],
                definition["prices"][0],
                definition["prices"][1],
            ),
        }
    return result


def serialize_recipe(recipe: Recipe) -> dict[str, Any]:
    return {
        "name": recipe.name,
        "components": list(recipe.components),
        "marketWeight": recipe.market_weight,
        "independentWeight": 1.0 - recipe.market_weight,
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
    games = add_market_context(pd.read_parquet(feature_path)).sort_values(
        ["season", "week", "game_id"]
    ).reset_index(drop=True)
    teams, features = oriented_team_frame(games)
    if games["game_id"].duplicated().any() or len(teams) != 2 * len(games):
        raise RuntimeError("unexpected game identity shape")

    selected, rankings = select_recipe(games, teams, features)
    margin_residuals, total_residuals = build_oos_residuals(games, features, selected)
    margin_sigma = float(np.std(margin_residuals, ddof=1))
    total_sigma = float(np.std(total_residuals, ddof=1))

    confirmation_games: list[pd.DataFrame] = []
    confirmation_independent: dict[str, list[np.ndarray]] = {key: [] for key in ("home", "away", "margin", "total")}
    confirmation_calibrated: dict[str, list[np.ndarray]] = {key: [] for key in ("home", "away", "margin", "total")}
    by_season: dict[str, Any] = {}
    for season in CONFIRMATION_SEASONS:
        test, independent, calibrated = predict_season(games, features, selected, season)
        confirmation_games.append(test)
        for key in confirmation_independent:
            confirmation_independent[key].append(independent[key])
            confirmation_calibrated[key].append(calibrated[key])
        by_season[str(season)] = {
            "independent": score_metrics(test, independent),
            "calibrated": score_metrics(test, calibrated),
            "probability": probability_report(test, calibrated, margin_sigma, total_sigma),
        }

    pooled_games = pd.concat(confirmation_games, ignore_index=True)
    pooled_independent = {key: np.concatenate(values) for key, values in confirmation_independent.items()}
    pooled_calibrated = {key: np.concatenate(values) for key, values in confirmation_calibrated.items()}
    pooled_score = score_metrics(pooled_games, pooled_calibrated)
    pooled_probability = probability_report(pooled_games, pooled_calibrated, margin_sigma, total_sigma)
    gates = {
        "teamScoreMaeImproves": pooled_score["teamScore"]["mae"] < pooled_score["market"]["teamScore"]["mae"],
        "marginMaeImproves": pooled_score["margin"]["mae"] < pooled_score["market"]["margin"]["mae"],
        "totalMaeImproves": pooled_score["total"]["mae"] < pooled_score["market"]["total"]["mae"],
        "neitherSeasonWorseOnBothMarginAndTotal": all(not (
            row["calibrated"]["margin"]["mae"] > row["calibrated"]["market"]["margin"]["mae"]
            and row["calibrated"]["total"]["mae"] > row["calibrated"]["market"]["total"]["mae"]
        ) for row in by_season.values()),
        "moneylineAccuracyNonRegression": (
            pooled_score["moneylineDirection"]["accuracy"] >= pooled_score["market"]["moneylineDirection"]["accuracy"]
        ),
        "spreadDirectionAtLeastHalf": pooled_score["spreadDirection"]["accuracy"] >= 0.5,
        "totalDirectionAtLeastHalf": pooled_score["totalDirection"]["accuracy"] >= 0.5,
        "allBrierNonRegression": all(
            row["candidate"]["brier"] <= row["market"]["brier"]
            for row in pooled_probability.values()
        ),
        "bothSpreadDirections": (
            pooled_score["spreadDirection"]["positive"] > 0
            and pooled_score["spreadDirection"]["negative"] > 0
        ),
        "bothTotalDirections": (
            pooled_score["totalDirection"]["positive"] > 0
            and pooled_score["totalDirection"]["negative"] > 0
        ),
        "allActionLanesQualify": all(
            row["actions"]["pooled"]["resolved"] >= 30
            and (row["actions"]["pooled"]["roiPerUnitRisked"] or -1.0) > 0
            and all(
                season["roiPerUnitRisked"] is not None and season["roiPerUnitRisked"] >= -0.05
                for season in row["actions"]["bySeason"].values()
            )
            and row["actions"]["directions"]["first"] > 0
            and row["actions"]["directions"]["second"] > 0
            for row in pooled_probability.values()
        ),
    }
    gates["historicalConfirmationPassed"] = all(gates.values())

    def ranking_row(row: dict[str, Any]) -> dict[str, Any]:
        return {
            "recipe": serialize_recipe(row["recipe"]),
            "metrics": row["metrics"],
            "independentMetrics": row["independentMetrics"],
            "jointLoss": row["rank"][0],
        }

    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "localOnly": True,
        "actionable": False,
        "productionChanged": False,
        "trainingSeasons": list(TRAIN_SEASONS),
        "selectionSeason": SELECTION_SEASON,
        "confirmationSeasons": list(CONFIRMATION_SEASONS),
        "featureCount": len(features),
        "selected": ranking_row(rankings[0]),
        "selectionTopTen": [ranking_row(row) for row in rankings[:10]],
        "residualScale": {"margin": margin_sigma, "total": total_sigma},
        "confirmation": {
            "independent": score_metrics(pooled_games, pooled_independent),
            "calibrated": pooled_score,
            "probability": pooled_probability,
            "bySeason": by_season,
            "gates": gates,
        },
    }
    report_root = root / "football-research/reports"
    report_root.mkdir(parents=True, exist_ok=True)
    report_path = report_root / f"{TOURNAMENT_RELEASE}.json"
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "report": str(report_path),
        "selected": report["selected"],
        "confirmationIndependent": report["confirmation"]["independent"],
        "confirmationCalibrated": report["confirmation"]["calibrated"],
        "confirmationProbability": report["confirmation"]["probability"],
        "gates": gates,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
