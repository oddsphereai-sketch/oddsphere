#!/usr/bin/env python3
"""Frozen NFL independent margin/total architecture tournament.

Research only. This script never writes predictions, grades, stakes, tracking
rows, member snapshots, or production state. See the matching predeclaration.
"""

from __future__ import annotations

import hashlib
import json
import math
import pathlib
import time
from dataclasses import asdict, dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.base import RegressorMixin
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


TOURNAMENT_RELEASE = "nfl_independent_score_rebuild_tournament_2026_10_15_r1"
FEATURE_RELEASE = "nfl_real_pregame_features_2016_2025_2026_10_15_r2_independent_rebuild"
TRAIN_END = 2022
SELECTION_SEASON = 2023
CONFIRMATION_SEASONS = (2024, 2025)
RANDOM_STATE = 15102026

METRIC_PRIORS = {
    "epa": 0.0,
    "pass_epa": 0.0,
    "rush_epa": 0.0,
    "success": 0.43,
    "early_down_pass_epa": 0.0,
    "explosive_rate": 0.105,
    "sack_rate": 0.070,
    "turnover_rate": 0.022,
    "plays": 64.0,
    "redzone_td_rate": 0.55,
    "no_huddle_rate": 0.10,
    "pass_oe": 0.0,
    "points": 22.5,
}

AVAILABILITY_METRICS = (
    "injury_weight",
    "injury_snap_weight",
    "qb_injury_weight",
    "last_qb_injury_weight",
    "out_count",
    "injury_reported_count",
    "roster_continuity",
    "qb_epa",
    "qb_cpoe",
    "qb_sack_rate",
    "qb_turnover_rate",
    "qb_log_dropbacks",
    "coach_continuity",
)


@dataclass(frozen=True)
class Recipe:
    feature_family: str
    name: str
    components: tuple[str, ...]


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def estimator_factories() -> dict[str, Callable[[], RegressorMixin]]:
    def ridge(alpha: float) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=True)),
            ("scale", StandardScaler()),
            ("model", Ridge(alpha=alpha)),
        ])

    def tree(model: RegressorMixin) -> Pipeline:
        return Pipeline([
            ("imputer", SimpleImputer(strategy="median", add_indicator=False)),
            ("model", model),
        ])

    return {
        "ridge_30": lambda: ridge(30.0),
        "ridge_100": lambda: ridge(100.0),
        "ridge_300": lambda: ridge(300.0),
        "hist_regularized": lambda: tree(HistGradientBoostingRegressor(
            learning_rate=0.035,
            max_iter=300,
            max_leaf_nodes=15,
            min_samples_leaf=40,
            l2_regularization=16.0,
            random_state=RANDOM_STATE,
        )),
        "extra_trees_regularized": lambda: tree(ExtraTreesRegressor(
            n_estimators=500,
            min_samples_leaf=12,
            max_features=0.65,
            n_jobs=-1,
            random_state=RANDOM_STATE,
        )),
    }


def recipe_definitions(feature_family: str) -> tuple[Recipe, ...]:
    base = tuple(
        Recipe(feature_family, name, (name,))
        for name in estimator_factories()
    )
    return base + (
        Recipe(feature_family, "ridge_ensemble", ("ridge_30", "ridge_100", "ridge_300")),
        Recipe(feature_family, "all_ensemble", tuple(estimator_factories())),
    )


def engineered_features(frame: pd.DataFrame, family: str) -> pd.DataFrame:
    values: dict[str, Any] = {
        "home_field": 1.0 - frame["neutral_site"].astype(float),
        "neutral_site": frame["neutral_site"].astype(float),
        "division_game": frame["division_game"].astype(float),
        "rest_diff": frame["rest_diff"].astype(float),
        "rest_sum": frame["home_rest"].astype(float) + frame["away_rest"].astype(float),
        "roof_indoor": frame["roof_indoor"].astype(float),
        "surface_grass": frame["surface_grass"].astype(float),
        "week": frame["week"].astype(float),
        "elo_diff": frame["elo_diff"].astype(float),
        "elo_sum_centered": frame["home_elo"].astype(float) + frame["away_elo"].astype(float) - 3000.0,
        "games_state_min": np.minimum(frame["home_games_state"], frame["away_games_state"]).astype(float),
    }
    for metric, prior in METRIC_PRIORS.items():
        for speed in ("fast", "slow"):
            home = frame[f"home_matchup_{speed}_{metric}"].astype(float)
            away = frame[f"away_matchup_{speed}_{metric}"].astype(float)
            values[f"matchup_{speed}_{metric}_diff"] = home - away
            values[f"matchup_{speed}_{metric}_sum"] = home + away - 2.0 * prior

        home_adjusted = (
            frame[f"home_off_adj_{metric}"].astype(float)
            - (frame[f"away_def_adj_{metric}"].astype(float) - prior)
        )
        away_adjusted = (
            frame[f"away_off_adj_{metric}"].astype(float)
            - (frame[f"home_def_adj_{metric}"].astype(float) - prior)
        )
        values[f"matchup_adjusted_{metric}_diff"] = home_adjusted - away_adjusted
        values[f"matchup_adjusted_{metric}_sum"] = home_adjusted + away_adjusted - 2.0 * prior

    if family == "availability":
        for metric in AVAILABILITY_METRICS:
            home = frame[f"home_{metric}"].astype(float)
            away = frame[f"away_{metric}"].astype(float)
            values[f"availability_{metric}_diff"] = away - home
            values[f"availability_{metric}_sum"] = away + home
    elif family != "core":
        raise ValueError(f"unknown feature family {family}")

    result = pd.DataFrame(values, index=frame.index)
    forbidden = [
        column for column in result.columns
        if any(token in column for token in ("market", "moneyline", "odds", "actual", "score"))
    ]
    if forbidden:
        raise RuntimeError(f"independent feature leakage: {forbidden}")
    return result


def fit_components(features: pd.DataFrame, target: np.ndarray, components: tuple[str, ...] | None = None) -> dict[str, RegressorMixin]:
    factories = estimator_factories()
    selected = tuple(factories) if components is None else components
    models: dict[str, RegressorMixin] = {}
    for name in selected:
        model = factories[name]()
        model.fit(features, target)
        models[name] = model
    return models


def component_predictions(models: dict[str, RegressorMixin], features: pd.DataFrame) -> dict[str, np.ndarray]:
    return {name: np.asarray(model.predict(features), dtype=float) for name, model in models.items()}


def recipe_prediction(recipe: Recipe, predictions: dict[str, np.ndarray]) -> np.ndarray:
    return np.mean(np.vstack([predictions[name] for name in recipe.components]), axis=0)


def point_metrics(actual: np.ndarray, prediction: np.ndarray) -> dict[str, float]:
    actual = np.asarray(actual, dtype=float)
    prediction = np.asarray(prediction, dtype=float)
    correlation = float(np.corrcoef(actual, prediction)[0, 1]) if len(actual) > 1 else math.nan
    return {
        "mae": float(mean_absolute_error(actual, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(actual, prediction))),
        "bias": float(np.mean(prediction - actual)),
        "correlation": correlation,
    }


def select_head(train: pd.DataFrame, selection: pd.DataFrame, target_name: str) -> tuple[Recipe, list[dict[str, Any]]]:
    target = train[target_name].to_numpy(float)
    actual = selection[target_name].to_numpy(float)
    ranked: list[dict[str, Any]] = []
    for family in ("core", "availability"):
        train_features = engineered_features(train, family)
        selection_features = engineered_features(selection, family)
        models = fit_components(train_features, target)
        predictions = component_predictions(models, selection_features)
        for recipe in recipe_definitions(family):
            metric = point_metrics(actual, recipe_prediction(recipe, predictions))
            ranked.append({"recipe": recipe, **metric})
    ranked.sort(key=lambda row: (row["mae"], row["rmse"], len(row["recipe"].components), row["recipe"].name))
    serializable = [
        {"recipe": asdict(row["recipe"]), **{key: value for key, value in row.items() if key != "recipe"}}
        for row in ranked
    ]
    return ranked[0]["recipe"], serializable


def fit_predict_recipe(train: pd.DataFrame, test: pd.DataFrame, target_name: str, recipe: Recipe) -> np.ndarray:
    train_features = engineered_features(train, recipe.feature_family)
    test_features = engineered_features(test, recipe.feature_family)
    models = fit_components(train_features, train[target_name].to_numpy(float), recipe.components)
    return recipe_prediction(recipe, component_predictions(models, test_features))


def selected_side_record(predicted: np.ndarray, actual: np.ndarray, boundary: np.ndarray | float, improvement: float = 0.0) -> dict[str, Any]:
    prediction = np.asarray(predicted, dtype=float)
    outcome = np.asarray(actual, dtype=float)
    line = np.full(len(outcome), float(boundary)) if np.isscalar(boundary) else np.asarray(boundary, dtype=float)
    edge = prediction - line
    selected = np.sign(edge)
    selected = np.where(selected == 0.0, 1.0, selected)
    result = selected * (outcome - line) + improvement
    wins = int(np.sum(result > 0.0))
    losses = int(np.sum(result < 0.0))
    pushes = int(np.sum(result == 0.0))
    resolved = wins + losses
    return {
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "resolved": resolved,
        "hitRate": wins / resolved if resolved else None,
        "positiveSelections": int(np.sum(selected > 0.0)),
        "negativeSelections": int(np.sum(selected < 0.0)),
    }


def score_report(games: pd.DataFrame, margin: np.ndarray, total: np.ndarray) -> dict[str, Any]:
    actual_margin = games["actual_margin"].to_numpy(float)
    actual_total = games["actual_total"].to_numpy(float)
    actual_home = games["home_score"].to_numpy(float)
    actual_away = games["away_score"].to_numpy(float)
    market_margin = games["market_home_margin"].to_numpy(float)
    market_total = games["market_total"].to_numpy(float)
    home = (total + margin) / 2.0
    away = (total - margin) / 2.0
    team_actual = np.concatenate([actual_home, actual_away])
    team_predicted = np.concatenate([home, away])
    return {
        "games": len(games),
        "teamScore": point_metrics(team_actual, team_predicted),
        "margin": point_metrics(actual_margin, margin),
        "total": point_metrics(actual_total, total),
        "moneyline": selected_side_record(margin, actual_margin, 0.0),
        "spread": selected_side_record(margin, actual_margin, market_margin),
        "spreadPlus3": selected_side_record(margin, actual_margin, market_margin, 3.0),
        "spreadPlus6": selected_side_record(margin, actual_margin, market_margin, 6.0),
        "totalSide": selected_side_record(total, actual_total, market_total),
        "totalPlus3": selected_side_record(total, actual_total, market_total, 3.0),
        "totalPlus6": selected_side_record(total, actual_total, market_total, 6.0),
        "coherentScores": bool(np.isfinite(home).all() and np.isfinite(away).all()),
    }


def select_anchor_weight(actual: np.ndarray, independent: np.ndarray, market: np.ndarray) -> tuple[float, list[dict[str, Any]]]:
    ranked: list[dict[str, Any]] = []
    for independent_weight in np.arange(0.0, 1.01, 0.1):
        predicted = independent_weight * independent + (1.0 - independent_weight) * market
        ranked.append({
            "independentWeight": float(independent_weight),
            **point_metrics(actual, predicted),
        })
    ranked.sort(key=lambda row: (row["mae"], row["rmse"], row["independentWeight"]))
    return float(ranked[0]["independentWeight"]), ranked


def subset_report(frame: pd.DataFrame, margin: np.ndarray, total: np.ndarray, seasons: tuple[int, ...]) -> dict[str, Any]:
    keep = frame["season"].isin(seasons).to_numpy()
    games = frame.loc[keep].reset_index(drop=True)
    independent = score_report(games, margin[keep], total[keep])
    market = score_report(
        games,
        games["market_home_margin"].to_numpy(float),
        games["market_total"].to_numpy(float),
    )
    return {"independent": independent, "market": market}


def main() -> None:
    root = pathlib.Path.cwd()
    manifest_path = root / "football-research/cache/nfl-model/nfl_pregame_features_2016_2025_r1.manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("featureRelease") != FEATURE_RELEASE:
        raise RuntimeError("feature release mismatch")
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest.get("featureFileSha256"):
        raise RuntimeError("feature checksum mismatch")

    games = pd.read_parquet(feature_path).sort_values(["season", "week", "game_id"]).reset_index(drop=True)
    if games[["market_home_margin", "market_total"]].isna().any().any():
        raise RuntimeError("market comparator has missing lines")
    train = games[games["season"].le(TRAIN_END)].reset_index(drop=True)
    selection = games[games["season"].eq(SELECTION_SEASON)].reset_index(drop=True)

    margin_recipe, margin_rankings = select_head(train, selection, "actual_margin")
    total_recipe, total_rankings = select_head(train, selection, "actual_total")
    selection_margin = fit_predict_recipe(train, selection, "actual_margin", margin_recipe)
    selection_total = fit_predict_recipe(train, selection, "actual_total", total_recipe)

    margin_independent_weight, margin_anchor_rankings = select_anchor_weight(
        selection["actual_margin"].to_numpy(float),
        selection_margin,
        selection["market_home_margin"].to_numpy(float),
    )
    total_independent_weight, total_anchor_rankings = select_anchor_weight(
        selection["actual_total"].to_numpy(float),
        selection_total,
        selection["market_total"].to_numpy(float),
    )

    confirmation_frames: list[pd.DataFrame] = []
    confirmation_margins: list[np.ndarray] = []
    confirmation_totals: list[np.ndarray] = []
    for season in CONFIRMATION_SEASONS:
        expanding_train = games[games["season"].lt(season)].reset_index(drop=True)
        season_frame = games[games["season"].eq(season)].reset_index(drop=True)
        confirmation_frames.append(season_frame)
        confirmation_margins.append(fit_predict_recipe(expanding_train, season_frame, "actual_margin", margin_recipe))
        confirmation_totals.append(fit_predict_recipe(expanding_train, season_frame, "actual_total", total_recipe))

    confirmation = pd.concat(confirmation_frames, ignore_index=True)
    confirmation_margin = np.concatenate(confirmation_margins)
    confirmation_total = np.concatenate(confirmation_totals)
    anchor_margin = (
        margin_independent_weight * confirmation_margin
        + (1.0 - margin_independent_weight) * confirmation["market_home_margin"].to_numpy(float)
    )
    anchor_total = (
        total_independent_weight * confirmation_total
        + (1.0 - total_independent_weight) * confirmation["market_total"].to_numpy(float)
    )

    by_season = {
        str(season): subset_report(confirmation, confirmation_margin, confirmation_total, (season,))
        for season in CONFIRMATION_SEASONS
    }
    combined = subset_report(confirmation, confirmation_margin, confirmation_total, CONFIRMATION_SEASONS)
    selection_report = {
        "independent": score_report(selection, selection_margin, selection_total),
        "market": score_report(
            selection,
            selection["market_home_margin"].to_numpy(float),
            selection["market_total"].to_numpy(float),
        ),
    }
    anchor_report = score_report(confirmation, anchor_margin, anchor_total)
    market_report = combined["market"]
    gates = {
        "finiteCoherentScores": bool(combined["independent"]["coherentScores"]),
        "marginErrorBelowAuditedFantasyCenterScale": combined["independent"]["margin"]["mae"] < 10.0912,
        "totalErrorBelowAuditedFantasyCenterScale": combined["independent"]["total"]["mae"] < 9.8923,
        "anchorMarginImprovesMarket": anchor_report["margin"]["mae"] < market_report["margin"]["mae"],
        "anchorTotalImprovesMarket": anchor_report["total"]["mae"] < market_report["total"]["mae"],
    }
    gates["advanceToExact2026Replay"] = bool(
        gates["finiteCoherentScores"]
        and gates["marginErrorBelowAuditedFantasyCenterScale"]
        and gates["totalErrorBelowAuditedFantasyCenterScale"]
        and (gates["anchorMarginImprovesMarket"] or gates["anchorTotalImprovesMarket"])
    )

    payload = {
        "tournamentRelease": TOURNAMENT_RELEASE,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "featureRelease": FEATURE_RELEASE,
        "featureSha256": manifest["featureFileSha256"],
        "split": {
            "training": [2016, TRAIN_END],
            "selection": SELECTION_SEASON,
            "confirmation": list(CONFIRMATION_SEASONS),
            "confirmationPolicy": "expanding prior-season refit with frozen recipes",
        },
        "selected": {
            "margin": asdict(margin_recipe),
            "total": asdict(total_recipe),
            "marginIndependentWeightInConsensusDiagnostic": margin_independent_weight,
            "totalIndependentWeightInConsensusDiagnostic": total_independent_weight,
        },
        "featureCounts": {
            family: len(engineered_features(train.head(1), family).columns)
            for family in ("core", "availability")
        },
        "selection": selection_report,
        "confirmationBySeason": by_season,
        "confirmationCombined": combined,
        "confirmationAnchorBlend": anchor_report,
        "gates": gates,
        "selectionRankings": {
            "margin": margin_rankings,
            "total": total_rankings,
            "marginAnchor": margin_anchor_rankings,
            "totalAnchor": total_anchor_rankings,
        },
        "restrictions": [
            "research-only",
            "no production writer",
            "no locked-record mutation",
            "no competitor superiority claim without matched sample",
            "consensus blend is not the professional market-reader marriage",
        ],
    }
    output_root = root / "football-research/reports/nfl-independent-score-rebuild-r1"
    output_root.mkdir(parents=True, exist_ok=True)
    output_path = output_root / "tournament.json"
    output_path.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "tournamentRelease": TOURNAMENT_RELEASE,
        "selected": payload["selected"],
        "selection": selection_report,
        "confirmationCombined": combined,
        "confirmationAnchorBlend": anchor_report,
        "gates": gates,
        "output": str(output_path),
    }, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
