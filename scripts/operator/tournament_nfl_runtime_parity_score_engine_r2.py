#!/usr/bin/env python3
"""Runtime-parity NFL score engine development replay.

Research/shadow only. The matching predeclaration explicitly forbids a live
cutover from the already-open 2024-2025 replay.
"""

from __future__ import annotations

import json
import pathlib
import time
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

import tournament_nfl_weekly_joint_score_engine_r1 as r1
from tournament_nfl_market_context_residual_r1 import (
    FEATURE_RELEASE,
    add_market_context,
    sha256_file,
)


TOURNAMENT_RELEASE = "nfl_runtime_parity_score_engine_tournament_2026_09_25_r2"
TRAIN_SEASONS = tuple(range(2018, 2023))
SELECTION_SEASON = 2023
DEVELOPMENT_REPLAY_SEASONS = (2024, 2025)
MARKET_WEIGHTS = tuple(value / 10.0 for value in range(11))
RUNTIME_METRICS = (
    "points", "plays", "sack_rate", "turnover_rate", "redzone_td_rate",
)
RUNTIME_CONTEXT = (
    "elo", "games_state", "rest", "injury_weight", "qb_injury_weight",
    "out_count", "injury_reported_count", "roster_continuity",
    "coach_continuity",
)


@dataclass(frozen=True)
class Recipe:
    name: str
    components: tuple[str, ...]
    margin_market_weight: float
    total_market_weight: float


def allowed_suffix(suffix: str) -> bool:
    return suffix in RUNTIME_CONTEXT or any(suffix.endswith(f"_{metric}") for metric in RUNTIME_METRICS)


def oriented_team_frame(games: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    paired_suffixes = sorted({
        column.removeprefix("home_").removeprefix("away_")
        for column in games.columns
        if (column.startswith("home_") or column.startswith("away_"))
        and pd.api.types.is_numeric_dtype(games[column])
        and allowed_suffix(column.removeprefix("home_").removeprefix("away_"))
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
                team_value = float(game[f"{side}_{suffix}"])
                opponent_value = float(game[f"{opponent}_{suffix}"])
                row[f"team_{suffix}"] = team_value
                row[f"opponent_{suffix}"] = opponent_value
                if suffix.startswith(("off_fast_", "off_slow_", "off_adj_")):
                    defensive_suffix = suffix.replace("off_", "def_", 1)
                    opponent_defensive = f"{opponent}_{defensive_suffix}"
                    if opponent_defensive in games.columns:
                        row[f"matchup_{suffix}"] = team_value - float(game[opponent_defensive])
            rows.append(row)
    frame = pd.DataFrame(rows)
    identifiers = {
        "game_row", "game_id", "season", "side", "team_score",
        "market_implied_score",
    }
    features = sorted(column for column in frame.columns if column not in identifiers)
    forbidden_tokens = (
        "market", "score", "epa", "success", "explosive", "pass_oe", "cpoe",
    )
    forbidden = [column for column in features if any(token in column for token in forbidden_tokens)]
    if forbidden:
        raise RuntimeError(f"runtime-parity feature boundary violated: {forbidden}")
    return frame, features


def calibrated_scores(
    games: pd.DataFrame,
    independent: dict[str, np.ndarray],
    margin_market_weight: float,
    total_market_weight: float,
) -> dict[str, np.ndarray]:
    market_margin = games["market_home_margin"].to_numpy(float)
    market_total = games["market_total"].to_numpy(float)
    margin = (1.0 - margin_market_weight) * independent["margin"] + margin_market_weight * market_margin
    total = (1.0 - total_market_weight) * independent["total"] + total_market_weight * market_total
    return {
        "home": (total + margin) / 2.0,
        "away": (total - margin) / 2.0,
        "margin": margin,
        "total": total,
    }


def fit_prediction_set(
    train_games: pd.DataFrame,
    test_games: pd.DataFrame,
    expected_features: list[str],
    components: tuple[str, ...] | None = None,
) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
    train_teams, train_features = oriented_team_frame(train_games)
    test_teams, test_features = oriented_team_frame(test_games)
    if train_features != expected_features or test_features != expected_features:
        raise RuntimeError("runtime-parity feature schema drift")
    models = r1.fit_models(train_teams, expected_features, components)
    if components is not None:
        return test_teams, {
            name: np.asarray(model.predict(test_teams[expected_features]), dtype=float)
            for name, model in models.items()
        }
    return test_teams, r1.prediction_sets(models, test_teams, expected_features)


def rank(metrics: dict[str, Any], recipe: Recipe) -> tuple[float, ...]:
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
        recipe.margin_market_weight + recipe.total_market_weight,
        float(len(recipe.components)),
    )


def select_recipe(games: pd.DataFrame, features: list[str]) -> tuple[Recipe, list[dict[str, Any]]]:
    train = games[games["season"].isin(TRAIN_SEASONS)].reset_index(drop=True)
    selection = games[games["season"].eq(SELECTION_SEASON)].reset_index(drop=True)
    selection_teams, predictions = fit_prediction_set(train, selection, features)
    rankings: list[dict[str, Any]] = []
    for name, team_prediction in predictions.items():
        independent = r1.pair_games(selection, selection_teams, team_prediction)
        independent_metrics = r1.score_metrics(selection, independent)
        for margin_weight in MARKET_WEIGHTS:
            for total_weight in MARKET_WEIGHTS:
                recipe = Recipe(name, r1.recipe_components(name), margin_weight, total_weight)
                scores = calibrated_scores(selection, independent, margin_weight, total_weight)
                metrics = r1.score_metrics(selection, scores)
                rankings.append({
                    "recipe": recipe,
                    "metrics": metrics,
                    "independentMetrics": independent_metrics,
                    "rank": rank(metrics, recipe),
                })
    rankings.sort(key=lambda row: row["rank"])
    return rankings[0]["recipe"], rankings


def predict_season(
    games: pd.DataFrame,
    features: list[str],
    recipe: Recipe,
    season: int,
) -> tuple[pd.DataFrame, dict[str, np.ndarray], dict[str, np.ndarray]]:
    train = games[(games["season"] >= min(TRAIN_SEASONS)) & (games["season"] < season)].reset_index(drop=True)
    test = games[games["season"].eq(season)].reset_index(drop=True)
    test_teams, predictions = fit_prediction_set(train, test, features, recipe.components)
    team_prediction = np.mean(np.vstack([predictions[name] for name in recipe.components]), axis=0)
    independent = r1.pair_games(test, test_teams, team_prediction)
    return test, independent, calibrated_scores(
        test, independent, recipe.margin_market_weight, recipe.total_market_weight,
    )


def build_residuals(games: pd.DataFrame, features: list[str], recipe: Recipe) -> tuple[np.ndarray, np.ndarray]:
    margins: list[np.ndarray] = []
    totals: list[np.ndarray] = []
    for season in range(2020, SELECTION_SEASON + 1):
        test, _, scores = predict_season(games, features, recipe, season)
        margins.append(test["actual_margin"].to_numpy(float) - scores["margin"])
        totals.append(test["actual_total"].to_numpy(float) - scores["total"])
    return np.concatenate(margins), np.concatenate(totals)


def serialize_recipe(recipe: Recipe) -> dict[str, Any]:
    return {
        "name": recipe.name,
        "components": list(recipe.components),
        "marginMarketWeight": recipe.margin_market_weight,
        "marginIndependentWeight": 1.0 - recipe.margin_market_weight,
        "totalMarketWeight": recipe.total_market_weight,
        "totalIndependentWeight": 1.0 - recipe.total_market_weight,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("feature checksum mismatch")
    games = add_market_context(pd.read_parquet(feature_path)).sort_values(
        ["season", "week", "game_id"]
    ).reset_index(drop=True)
    teams, features = oriented_team_frame(games)
    if games["game_id"].duplicated().any() or len(teams) != 2 * len(games):
        raise RuntimeError("unexpected runtime-parity identity shape")

    selected, rankings = select_recipe(games, features)
    margin_residuals, total_residuals = build_residuals(games, features, selected)
    margin_sigma = float(np.std(margin_residuals, ddof=1))
    total_sigma = float(np.std(total_residuals, ddof=1))

    replay_games: list[pd.DataFrame] = []
    independent_parts: dict[str, list[np.ndarray]] = {key: [] for key in ("home", "away", "margin", "total")}
    calibrated_parts: dict[str, list[np.ndarray]] = {key: [] for key in ("home", "away", "margin", "total")}
    by_season: dict[str, Any] = {}
    for season in DEVELOPMENT_REPLAY_SEASONS:
        test, independent, calibrated = predict_season(games, features, selected, season)
        replay_games.append(test)
        for key in independent_parts:
            independent_parts[key].append(independent[key])
            calibrated_parts[key].append(calibrated[key])
        by_season[str(season)] = {
            "independent": r1.score_metrics(test, independent),
            "calibrated": r1.score_metrics(test, calibrated),
            "probability": r1.probability_report(test, calibrated, margin_sigma, total_sigma),
        }

    pooled_games = pd.concat(replay_games, ignore_index=True)
    pooled_independent = {key: np.concatenate(value) for key, value in independent_parts.items()}
    pooled_calibrated = {key: np.concatenate(value) for key, value in calibrated_parts.items()}
    pooled_score = r1.score_metrics(pooled_games, pooled_calibrated)
    pooled_probability = r1.probability_report(pooled_games, pooled_calibrated, margin_sigma, total_sigma)
    gates = {
        "teamScoreMaeImproves": pooled_score["teamScore"]["mae"] < pooled_score["market"]["teamScore"]["mae"],
        "marginMaeImproves": pooled_score["margin"]["mae"] < pooled_score["market"]["margin"]["mae"],
        "totalMaeImproves": pooled_score["total"]["mae"] < pooled_score["market"]["total"]["mae"],
        "moneylineAccuracyNonRegression": (
            pooled_score["moneylineDirection"]["accuracy"] >= pooled_score["market"]["moneylineDirection"]["accuracy"]
        ),
        "spreadDirectionAtLeastHalf": (pooled_score["spreadDirection"]["accuracy"] or 0.0) >= 0.5,
        "totalDirectionAtLeastHalf": (pooled_score["totalDirection"]["accuracy"] or 0.0) >= 0.5,
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
        "forwardPromotionEligible": False,
    }
    gates["developmentReplayPassed"] = all(
        value for key, value in gates.items() if key != "forwardPromotionEligible"
    )

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
        "productionChanged": False,
        "promotionEligible": False,
        "promotionBoundary": "frozen 2026 release-stamped forward shadow required",
        "trainingSeasons": list(TRAIN_SEASONS),
        "selectionSeason": SELECTION_SEASON,
        "developmentReplaySeasons": list(DEVELOPMENT_REPLAY_SEASONS),
        "featureCount": len(features),
        "selected": ranking_row(rankings[0]),
        "selectionTopTen": [ranking_row(row) for row in rankings[:10]],
        "residualScale": {"margin": margin_sigma, "total": total_sigma},
        "developmentReplay": {
            "independent": r1.score_metrics(pooled_games, pooled_independent),
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
        "featureCount": len(features),
        "selected": report["selected"],
        "developmentIndependent": report["developmentReplay"]["independent"],
        "developmentCalibrated": report["developmentReplay"]["calibrated"],
        "developmentProbability": report["developmentReplay"]["probability"],
        "gates": gates,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
