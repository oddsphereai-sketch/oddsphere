#!/usr/bin/env python3
"""Runtime-parity NFL spread/total outcome-head development replay."""

from __future__ import annotations

import json
import pathlib
import time
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.base import ClassifierMixin
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

import tournament_nfl_weekly_joint_score_engine_r1 as r1
import tournament_nfl_runtime_parity_score_engine_r2 as r2
from tournament_nfl_market_context_residual_r1 import FEATURE_RELEASE, add_market_context, sha256_file


TOURNAMENT_RELEASE = "nfl_runtime_parity_outcome_heads_2026_09_25_r4"
TRAIN_SEASONS = tuple(range(2018, 2023))
SELECTION_SEASON = 2023
DEVELOPMENT_SEASONS = (2024, 2025)
SHRINKAGES = (0.25, 0.5, 0.75, 1.0)
RANDOM_STATE = 25092026


@dataclass(frozen=True)
class Recipe:
    spread_model: str
    total_model: str
    spread_shrinkage: float
    total_shrinkage: float


def game_frame(games: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    teams, team_features = r2.oriented_team_frame(games)
    home = teams[teams["side"].eq("home")].sort_values("game_row").reset_index(drop=True)
    away = teams[teams["side"].eq("away")].sort_values("game_row").reset_index(drop=True)
    if len(home) != len(games) or not np.array_equal(home["game_row"], away["game_row"]):
        raise RuntimeError("runtime-parity game pairing failed")
    rows: dict[str, Any] = {
        "game_id": games["game_id"].astype(str).to_numpy(),
        "season": games["season"].astype(int).to_numpy(),
        "spread_target": (games["actual_margin"] > games["market_home_margin"]).astype(int).to_numpy(),
        "total_target": (games["actual_total"] > games["market_total"]).astype(int).to_numpy(),
        "spread_resolved": (games["actual_margin"] != games["market_home_margin"]).to_numpy(),
        "total_resolved": (games["actual_total"] != games["market_total"]).to_numpy(),
        "market_home_margin": games["market_home_margin"].to_numpy(float),
        "market_total": games["market_total"].to_numpy(float),
    }
    shared = {
        "week", "neutral_site", "division_game", "temperature", "wind",
        "roof_indoor", "surface_grass",
    }
    for feature in team_features:
        home_values = home[feature].to_numpy(float)
        away_values = away[feature].to_numpy(float)
        if feature in shared or feature == "home_indicator":
            rows[feature] = home_values
        else:
            rows[f"difference_{feature}"] = home_values - away_values
            rows[f"average_{feature}"] = 0.5 * (home_values + away_values)
    frame = pd.DataFrame(rows)
    features = sorted(column for column in frame.columns if column not in {
        "game_id", "season", "spread_target", "total_target",
        "spread_resolved", "total_resolved",
    })
    return frame, features


def factories() -> dict[str, Callable[[], ClassifierMixin]]:
    def logistic(c: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", LogisticRegression(C=c, max_iter=3000, random_state=RANDOM_STATE)),
        ])

    def hist(leaf: int, regularization: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median")),
            ("model", HistGradientBoostingClassifier(
                learning_rate=0.035,
                max_iter=300,
                max_leaf_nodes=15,
                min_samples_leaf=leaf,
                l2_regularization=regularization,
                random_state=RANDOM_STATE,
            )),
        ])

    return {
        "logistic_c001": lambda: logistic(0.01),
        "logistic_c01": lambda: logistic(0.1),
        "logistic_c1": lambda: logistic(1.0),
        "hist_leaf40": lambda: hist(40, 16.0),
        "hist_leaf80": lambda: hist(80, 32.0),
    }


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, features: list[str], target: str) -> dict[str, np.ndarray]:
    resolved = train[f"{target.removesuffix('_target')}_resolved"].to_numpy(bool)
    result: dict[str, np.ndarray] = {}
    for name, factory in factories().items():
        model = factory()
        model.fit(train.loc[resolved, features], train.loc[resolved, target])
        result[name] = model.predict_proba(test[features])[:, 1]
    return result


def shrink(probability: np.ndarray, weight: float) -> np.ndarray:
    return 0.5 + weight * (probability - 0.5)


def head_metrics(probability: np.ndarray, target: np.ndarray, resolved: np.ndarray) -> dict[str, Any]:
    p = np.clip(probability[resolved], 0.001, 0.999)
    y = target[resolved].astype(int)
    calls = p >= 0.5
    return {
        "rows": int(len(y)),
        "correct": int(np.sum(calls == y)),
        "accuracy": float(np.mean(calls == y)),
        "positive": int(np.sum(calls)),
        "negative": int(np.sum(~calls)),
        **r1.probability_metrics(p, y),
        "calibrationGap": float(abs(np.mean(p) - np.mean(y))),
    }


def select(frame: pd.DataFrame, features: list[str]) -> tuple[Recipe, list[dict[str, Any]]]:
    train = frame[frame["season"].isin(TRAIN_SEASONS)].reset_index(drop=True)
    selection = frame[frame["season"].eq(SELECTION_SEASON)].reset_index(drop=True)
    spread = fit_predict(train, selection, features, "spread_target")
    total = fit_predict(train, selection, features, "total_target")
    candidates: list[dict[str, Any]] = []
    for spread_name, spread_raw in spread.items():
        for total_name, total_raw in total.items():
            for spread_weight in SHRINKAGES:
                spread_probability = shrink(spread_raw, spread_weight)
                spread_metrics = head_metrics(
                    spread_probability,
                    selection["spread_target"].to_numpy(int),
                    selection["spread_resolved"].to_numpy(bool),
                )
                for total_weight in SHRINKAGES:
                    total_probability = shrink(total_raw, total_weight)
                    total_metrics = head_metrics(
                        total_probability,
                        selection["total_target"].to_numpy(int),
                        selection["total_resolved"].to_numpy(bool),
                    )
                    recipe = Recipe(spread_name, total_name, spread_weight, total_weight)
                    rank = (
                        spread_metrics["brier"] + total_metrics["brier"],
                        -(spread_metrics["accuracy"] + total_metrics["accuracy"]),
                        spread_metrics["calibrationGap"] + total_metrics["calibrationGap"],
                        spread_weight + total_weight,
                        spread_name,
                        total_name,
                    )
                    candidates.append({"recipe": recipe, "spread": spread_metrics, "total": total_metrics, "rank": rank})
    candidates.sort(key=lambda row: row["rank"])
    return candidates[0]["recipe"], candidates


def predict_season(frame: pd.DataFrame, features: list[str], recipe: Recipe, season: int) -> tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    train = frame[(frame["season"] >= min(TRAIN_SEASONS)) & (frame["season"] < season)].reset_index(drop=True)
    test = frame[frame["season"].eq(season)].reset_index(drop=True)
    spread = fit_predict(train, test, features, "spread_target")[recipe.spread_model]
    total = fit_predict(train, test, features, "total_target")[recipe.total_model]
    return test, shrink(spread, recipe.spread_shrinkage), shrink(total, recipe.total_shrinkage)


def scores_from_probabilities(games: pd.DataFrame, spread_probability: np.ndarray, total_probability: np.ndarray,
                              margin_sigma: float, total_sigma: float) -> dict[str, np.ndarray]:
    margin = games["market_home_margin"].to_numpy(float) + margin_sigma * norm.ppf(np.clip(spread_probability, 0.01, 0.99))
    total = games["market_total"].to_numpy(float) + total_sigma * norm.ppf(np.clip(total_probability, 0.01, 0.99))
    return {"home": (total + margin) / 2.0, "away": (total - margin) / 2.0, "margin": margin, "total": total}


def recipe_json(recipe: Recipe) -> dict[str, Any]:
    return {
        "spreadModel": recipe.spread_model,
        "totalModel": recipe.total_model,
        "spreadShrinkage": recipe.spread_shrinkage,
        "totalShrinkage": recipe.total_shrinkage,
    }


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if manifest.get("featureRelease") != FEATURE_RELEASE or sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("feature artifact mismatch")
    games = add_market_context(pd.read_parquet(feature_path)).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    frame, features = game_frame(games)
    selected, rankings = select(frame, features)

    residual_train = games[games["season"].between(2018, SELECTION_SEASON)].reset_index(drop=True)
    margin_sigma = float(np.std(residual_train["actual_margin"] - residual_train["market_home_margin"], ddof=1))
    total_sigma = float(np.std(residual_train["actual_total"] - residual_train["market_total"], ddof=1))
    replay_games: list[pd.DataFrame] = []
    spread_probabilities: list[np.ndarray] = []
    total_probabilities: list[np.ndarray] = []
    score_parts: dict[str, list[np.ndarray]] = {key: [] for key in ("home", "away", "margin", "total")}
    by_season: dict[str, Any] = {}
    for season in DEVELOPMENT_SEASONS:
        test_frame, spread_probability, total_probability = predict_season(frame, features, selected, season)
        test_games = games[games["season"].eq(season)].reset_index(drop=True)
        scores = scores_from_probabilities(test_games, spread_probability, total_probability, margin_sigma, total_sigma)
        replay_games.append(test_games)
        spread_probabilities.append(spread_probability)
        total_probabilities.append(total_probability)
        for key in score_parts:
            score_parts[key].append(scores[key])
        by_season[str(season)] = {
            "score": r1.score_metrics(test_games, scores),
            "spread": head_metrics(spread_probability, test_frame["spread_target"].to_numpy(int), test_frame["spread_resolved"].to_numpy(bool)),
            "total": head_metrics(total_probability, test_frame["total_target"].to_numpy(int), test_frame["total_resolved"].to_numpy(bool)),
        }

    replay = pd.concat(replay_games, ignore_index=True)
    scores = {key: np.concatenate(value) for key, value in score_parts.items()}
    spread_probability = np.concatenate(spread_probabilities)
    total_probability = np.concatenate(total_probabilities)
    replay_frame = frame[frame["season"].isin(DEVELOPMENT_SEASONS)].reset_index(drop=True)
    score = r1.score_metrics(replay, scores)
    spread_metrics = head_metrics(spread_probability, replay_frame["spread_target"].to_numpy(int), replay_frame["spread_resolved"].to_numpy(bool))
    total_metrics = head_metrics(total_probability, replay_frame["total_target"].to_numpy(int), replay_frame["total_resolved"].to_numpy(bool))
    gates = {
        "teamScoreMaeImproves": score["teamScore"]["mae"] < score["market"]["teamScore"]["mae"],
        "marginMaeImproves": score["margin"]["mae"] < score["market"]["margin"]["mae"],
        "totalMaeImproves": score["total"]["mae"] < score["market"]["total"]["mae"],
        "moneylineAccuracyNonRegression": score["moneylineDirection"]["accuracy"] >= score["market"]["moneylineDirection"]["accuracy"],
        "spreadDirectionAtLeastHalf": spread_metrics["accuracy"] >= 0.5,
        "totalDirectionAtLeastHalf": total_metrics["accuracy"] >= 0.5,
        "bothSpreadDirections": spread_metrics["positive"] > 0 and spread_metrics["negative"] > 0,
        "bothTotalDirections": total_metrics["positive"] > 0 and total_metrics["negative"] > 0,
        "forwardPromotionEligible": False,
    }
    gates["developmentReplayPassed"] = all(value for key, value in gates.items() if key != "forwardPromotionEligible")
    report = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "productionChanged": False,
        "promotionEligible": False,
        "featureCount": len(features),
        "selected": recipe_json(selected),
        "selectionTopTen": [{
            "recipe": recipe_json(row["recipe"]), "spread": row["spread"], "total": row["total"],
        } for row in rankings[:10]],
        "residualScale": {"margin": margin_sigma, "total": total_sigma},
        "developmentReplay": {
            "score": score,
            "spread": spread_metrics,
            "total": total_metrics,
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
        "score": score,
        "spread": spread_metrics,
        "total": total_metrics,
        "bySeason": by_season,
        "gates": gates,
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
