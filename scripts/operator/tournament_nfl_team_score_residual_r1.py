#!/usr/bin/env python3
"""Locked orientation-symmetric NFL team-score residual tournament."""

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
from sklearn.base import RegressorMixin
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import brier_score_loss, log_loss, mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from tournament_nfl_market_context_residual_r1 import (
    ACTION_EDGE,
    CONFIRMATION_SEASONS,
    FEATURE_RELEASE,
    PROBABILITY_SCALES,
    SELECTION_SEASONS,
    TRAIN_SEASONS,
    action_report,
    add_market_context,
    no_vig,
    sha256_file,
)


TOURNAMENT_RELEASE = "nfl_team_score_residual_tournament_2026_09_21_r1"
RANDOM_STATE = 21092027
POINT_WEIGHTS = (0.10, 0.20, 0.33, 0.50)
TEAM_CAPS = (1.5, 2.5, 3.5)


@dataclass(frozen=True)
class ScoreRecipe:
    estimator: str
    weight: float
    cap: float


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
        "hist_leaf40": lambda: hist(40, 20.0),
        "hist_leaf80": lambda: hist(80, 30.0),
    }


def oriented_team_frame(games: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    rows: list[dict[str, Any]] = []
    excluded = {
        "home_score", "away_score", "actual_margin", "actual_total", "season", "week",
        "game_id", "gameday", "home_team", "away_team", "feature_release",
    }
    numeric_home_away = [
        column for column in games.columns
        if (column.startswith("home_") or column.startswith("away_"))
        and column not in excluded and pd.api.types.is_numeric_dtype(games[column])
    ]
    paired_suffixes = sorted({
        column.removeprefix("home_").removeprefix("away_")
        for column in numeric_home_away
        if f"home_{column.removeprefix('home_').removeprefix('away_')}" in games.columns
        and f"away_{column.removeprefix('home_').removeprefix('away_')}" in games.columns
    })
    shared = [
        "neutral_site", "division_game", "temperature", "wind", "roof_indoor", "surface_grass",
        "market_total", "market_abs_margin", "market_total_centered", "market_early_week",
        "market_margin_total_interaction", "market_indoor_total_interaction",
        "market_wind_total_interaction",
    ]
    for game_index, game in games.reset_index(drop=True).iterrows():
        for side in ("home", "away"):
            opponent = "away" if side == "home" else "home"
            orientation = 1.0 if side == "home" else -1.0
            market_margin = orientation * float(game["market_home_margin"])
            team_score = float(game[f"{side}_score"])
            row: dict[str, Any] = {
                "game_row": int(game_index),
                "game_id": str(game["game_id"]),
                "season": int(game["season"]),
                "week_raw": float(game["week"]),
                "side": side,
                "home_indicator": float(side == "home"),
                "oriented_rest_diff": orientation * float(game["rest_diff"]),
                "oriented_elo_diff": orientation * float(game["elo_diff"]),
                "oriented_market_margin": market_margin,
                "team_implied_points": (float(game["market_total"]) + market_margin) / 2.0,
                "opponent_implied_points": (float(game["market_total"]) - market_margin) / 2.0,
                "team_fair_moneyline": (
                    float(game["market_moneyline_fair_home"])
                    if side == "home" else 1.0 - float(game["market_moneyline_fair_home"])
                ),
                "team_fair_spread": (
                    float(game["market_spread_fair_home"])
                    if side == "home" else 1.0 - float(game["market_spread_fair_home"])
                ),
                "team_score": team_score,
            }
            row["team_score_residual"] = team_score - row["team_implied_points"]
            for column in shared:
                row[column] = float(game[column])
            for suffix in paired_suffixes:
                row[f"team_{suffix}"] = float(game[f"{side}_{suffix}"])
                row[f"opponent_{suffix}"] = float(game[f"{opponent}_{suffix}"])
            rows.append(row)
    team_frame = pd.DataFrame(rows)
    identifiers = {"game_row", "game_id", "season", "side", "team_score", "team_score_residual"}
    features = sorted(column for column in team_frame.columns if column not in identifiers)
    non_numeric = [column for column in features if not pd.api.types.is_numeric_dtype(team_frame[column])]
    if non_numeric:
        raise RuntimeError(f"non-numeric team features: {non_numeric}")
    return team_frame, features


def point_metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "bias": float(np.mean(predicted - actual)),
    }


def probability_metrics(probability: np.ndarray, outcome: np.ndarray) -> dict[str, float]:
    p = np.clip(probability, 0.001, 0.999)
    y = outcome.astype(int)
    return {
        "rows": int(len(y)),
        "brier": float(brier_score_loss(y, p)),
        "logLoss": float(log_loss(y, p, labels=[0, 1])),
    }


def predict_games(
    games: pd.DataFrame,
    teams: pd.DataFrame,
    model: RegressorMixin,
    features: list[str],
    recipe: ScoreRecipe,
) -> dict[str, np.ndarray]:
    team_prediction = np.asarray(model.predict(teams[features]), dtype=float)
    team_correction = np.clip(recipe.weight * team_prediction, -recipe.cap, recipe.cap)
    corrected_team_score = teams["team_implied_points"].to_numpy(float) + team_correction
    scored = teams[["game_row", "side"]].copy()
    scored["correction"] = team_correction
    scored["predicted_score"] = corrected_team_score
    home = scored[scored["side"].eq("home")].sort_values("game_row")
    away = scored[scored["side"].eq("away")].sort_values("game_row")
    if not np.array_equal(home["game_row"].to_numpy(), away["game_row"].to_numpy()):
        raise RuntimeError("home/away pairing mismatch")
    if len(home) != len(games):
        raise RuntimeError("game/team row count mismatch")
    home_score = home["predicted_score"].to_numpy(float)
    away_score = away["predicted_score"].to_numpy(float)
    return {
        "home_score": home_score,
        "away_score": away_score,
        "margin": home_score - away_score,
        "total": home_score + away_score,
        "margin_correction": home["correction"].to_numpy(float) - away["correction"].to_numpy(float),
        "total_correction": home["correction"].to_numpy(float) + away["correction"].to_numpy(float),
        "mean_abs_team_correction": float(np.mean(np.abs(team_correction))),
    }


def probability_for(fair: np.ndarray, correction: np.ndarray, scale: float) -> np.ndarray:
    return expit(logit(np.clip(fair, 0.001, 0.999)) + scale * correction)


def choose_scale(
    fair: np.ndarray, correction: np.ndarray, outcome: np.ndarray, push: np.ndarray
) -> tuple[float, list[dict[str, Any]]]:
    keep = ~push
    ranked = []
    for scale in PROBABILITY_SCALES:
        metrics = probability_metrics(probability_for(fair, correction, scale)[keep], outcome[keep])
        ranked.append({"scale": scale, **metrics})
    ranked.sort(key=lambda row: (row["brier"], row["logLoss"], row["scale"]))
    return float(ranked[0]["scale"]), ranked


def per_season(
    games: pd.DataFrame,
    target: np.ndarray,
    predicted: np.ndarray,
    market: np.ndarray,
    probability: np.ndarray,
    fair: np.ndarray,
    outcome: np.ndarray,
    push: np.ndarray,
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for season in sorted(games["season"].unique()):
        rows = games["season"].eq(season).to_numpy()
        keep = rows & ~push
        result[str(int(season))] = {
            "candidatePoint": point_metrics(target[rows], predicted[rows]),
            "marketPoint": point_metrics(target[rows], market[rows]),
            "candidateProbability": probability_metrics(probability[keep], outcome[keep]),
            "marketProbability": probability_metrics(fair[keep], outcome[keep]),
        }
    return result


def evaluate_market(
    games: pd.DataFrame,
    predicted: dict[str, np.ndarray],
    market_name: str,
    scale: float,
) -> dict[str, Any]:
    if market_name == "spread":
        target = games["actual_margin"].to_numpy(float)
        market = games["market_home_margin"].to_numpy(float)
        correction = predicted["margin_correction"]
        fair = games["market_spread_fair_home"].to_numpy(float)
        first_price, second_price = "home_spread_odds", "away_spread_odds"
    else:
        target = games["actual_total"].to_numpy(float)
        market = games["market_total"].to_numpy(float)
        correction = predicted["total_correction"]
        fair = games["market_total_fair_over"].to_numpy(float)
        first_price, second_price = "over_odds", "under_odds"
    point_prediction = market + correction
    push = target == market
    outcome = target > market
    probability = probability_for(fair, correction, scale)
    keep = ~push
    direction_keep = keep & ~np.isclose(correction, 0.0)
    direction_correct = np.sign(correction[direction_keep]) == np.sign((target - market)[direction_keep])
    actions = action_report(
        games.reset_index(drop=True), probability, fair, outcome, push, first_price, second_price
    )
    by_season = per_season(games, target, point_prediction, market, probability, fair, outcome, push)
    candidate_point = point_metrics(target, point_prediction)
    market_point = point_metrics(target, market)
    candidate_probability = probability_metrics(probability[keep], outcome[keep])
    market_probability = probability_metrics(fair[keep], outcome[keep])
    gates = {
        "pooledMaeImproves": candidate_point["mae"] < market_point["mae"],
        "pooledBrierImproves": candidate_probability["brier"] < market_probability["brier"],
        "neitherSeasonWorseOnBoth": all(
            not (
                row["candidatePoint"]["mae"] > row["marketPoint"]["mae"]
                and row["candidateProbability"]["brier"] > row["marketProbability"]["brier"]
            )
            for row in by_season.values()
        ),
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
    return {
        "candidatePoint": candidate_point,
        "marketPoint": market_point,
        "candidateProbability": candidate_probability,
        "marketProbability": market_probability,
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

    games = add_market_context(pd.read_parquet(feature_path)).reset_index(drop=True)
    teams, features = oriented_team_frame(games)
    if games["game_id"].duplicated().any() or len(teams) != 2 * len(games):
        raise RuntimeError("unexpected game/team identity shape")

    train_games = games[games["season"].isin(TRAIN_SEASONS)].reset_index(drop=True)
    selection_games = games[games["season"].isin(SELECTION_SEASONS)].reset_index(drop=True)
    train_teams, train_features = oriented_team_frame(train_games)
    selection_teams, selection_features = oriented_team_frame(selection_games)
    if train_features != features or selection_features != features:
        raise RuntimeError("team feature schema drift")

    market_margin_mae = mean_absolute_error(
        selection_games["actual_margin"], selection_games["market_home_margin"]
    )
    market_total_mae = mean_absolute_error(
        selection_games["actual_total"], selection_games["market_total"]
    )
    rankings: list[dict[str, Any]] = []
    for estimator_name, factory in estimator_factories().items():
        model = factory()
        model.fit(train_teams[features], train_teams["team_score_residual"].to_numpy(float))
        for weight in POINT_WEIGHTS:
            for cap in TEAM_CAPS:
                recipe = ScoreRecipe(estimator_name, weight, cap)
                prediction = predict_games(selection_games, selection_teams, model, features, recipe)
                margin_mae = mean_absolute_error(selection_games["actual_margin"], prediction["margin"])
                total_mae = mean_absolute_error(selection_games["actual_total"], prediction["total"])
                margin_ratio = margin_mae / market_margin_mae
                total_ratio = total_mae / market_total_mae
                rankings.append({
                    "recipe": recipe,
                    "marginMae": float(margin_mae),
                    "totalMae": float(total_mae),
                    "marginRatio": float(margin_ratio),
                    "totalRatio": float(total_ratio),
                    "jointRatio": float(margin_ratio + total_ratio),
                    "worstRatio": float(max(margin_ratio, total_ratio)),
                    "meanAbsoluteTeamCorrection": prediction["mean_abs_team_correction"],
                })
    complexity = {name: index for index, name in enumerate(estimator_factories())}
    rankings.sort(key=lambda row: (
        row["jointRatio"], row["worstRatio"], row["recipe"].weight,
        row["recipe"].cap, complexity[row["recipe"].estimator],
    ))
    qualifying = [
        row for row in rankings
        if row["marginMae"] <= market_margin_mae + 0.02
        and row["totalMae"] <= market_total_mae + 0.02
        and (
            row["marginMae"] <= market_margin_mae - 0.02
            or row["totalMae"] <= market_total_mae - 0.02
        )
    ]
    selected = qualifying[0] if qualifying else rankings[0]
    recipe: ScoreRecipe = selected["recipe"]

    selection_model = estimator_factories()[recipe.estimator]()
    selection_model.fit(train_teams[features], train_teams["team_score_residual"].to_numpy(float))
    selection_prediction = predict_games(selection_games, selection_teams, selection_model, features, recipe)
    spread_scale, spread_scale_ranking = choose_scale(
        selection_games["market_spread_fair_home"].to_numpy(float),
        selection_prediction["margin_correction"],
        selection_games["actual_margin"].to_numpy(float) > selection_games["market_home_margin"].to_numpy(float),
        selection_games["actual_margin"].to_numpy(float) == selection_games["market_home_margin"].to_numpy(float),
    )
    total_scale, total_scale_ranking = choose_scale(
        selection_games["market_total_fair_over"].to_numpy(float),
        selection_prediction["total_correction"],
        selection_games["actual_total"].to_numpy(float) > selection_games["market_total"].to_numpy(float),
        selection_games["actual_total"].to_numpy(float) == selection_games["market_total"].to_numpy(float),
    )

    confirmation_train_games = games[games["season"].between(2018, 2023)].reset_index(drop=True)
    confirmation_games = games[games["season"].isin(CONFIRMATION_SEASONS)].reset_index(drop=True)
    confirmation_train_teams, confirmation_train_features = oriented_team_frame(confirmation_train_games)
    confirmation_teams, confirmation_features = oriented_team_frame(confirmation_games)
    if confirmation_train_features != features or confirmation_features != features:
        raise RuntimeError("confirmation feature schema drift")
    confirmation_model = estimator_factories()[recipe.estimator]()
    confirmation_model.fit(
        confirmation_train_teams[features],
        confirmation_train_teams["team_score_residual"].to_numpy(float),
    )
    confirmation_prediction = predict_games(
        confirmation_games, confirmation_teams, confirmation_model, features, recipe
    )
    spread = evaluate_market(confirmation_games, confirmation_prediction, "spread", spread_scale)
    total = evaluate_market(confirmation_games, confirmation_prediction, "total", total_scale)
    joint_pass = spread["gates"]["historicalConfirmationPassed"] and total["gates"]["historicalConfirmationPassed"]

    def recipe_json(row: dict[str, Any]) -> dict[str, Any]:
        item: ScoreRecipe = row["recipe"]
        return {
            **{key: value for key, value in row.items() if key != "recipe"},
            "recipe": {"estimator": item.estimator, "weight": item.weight, "cap": item.cap},
        }

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
        "selection": {
            "marketMarginMae": float(market_margin_mae),
            "marketTotalMae": float(market_total_mae),
            "qualifyingRecipes": len(qualifying),
            "selected": recipe_json(selected),
            "topRecipes": [recipe_json(row) for row in rankings[:10]],
            "spreadProbabilityScale": spread_scale,
            "spreadScaleRanking": spread_scale_ranking,
            "totalProbabilityScale": total_scale,
            "totalScaleRanking": total_scale_ranking,
        },
        "confirmation": {"spread": spread, "total": total, "jointHistoricalPass": joint_pass},
        "launchGate": {
            "status": "historical_confirmation_only" if joint_pass else "rejected",
            "reason": "current-board replay and every mandatory production safety gate remain required" if joint_pass
            else "the shared score recipe failed one or more predeclared confirmation gates",
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
        "selection": report["selection"],
        "confirmation": report["confirmation"],
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
