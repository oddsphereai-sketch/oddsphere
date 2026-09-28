#!/usr/bin/env python3
"""Chronological joint NFL player-props outcome-model tournament.

The incumbent fits every displayed market independently.  This tournament keeps
the proven opportunity heads but evaluates conditional rate/efficiency heads so
the displayed marginals are generated from one plausible player stat line.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
from typing import Any, Callable

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error


BASELINE_PATH = pathlib.Path("scripts/operator/tournament_nfl_player_props_baseline.py")
DEFAULT_MANIFEST = pathlib.Path(
    "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
)
DEFAULT_OUTPUT = pathlib.Path(
    "football-research/cache/nfl-player-props-joint/nfl_player_props_joint_model_r3.json"
)
SEED = 20260825
BLEND_GRID = (0.0, 0.25, 0.5, 0.75, 1.0)


def load_baseline() -> Any:
    spec = importlib.util.spec_from_file_location("nfl_props_joint_baseline", BASELINE_PATH)
    if not spec or not spec.loader:
        raise RuntimeError("NFL props baseline module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def hgb() -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss="squared_error",
        max_iter=140,
        max_leaf_nodes=15,
        learning_rate=0.05,
        l2_regularization=2.0,
        random_state=SEED,
    )


def matrix(rows: pd.DataFrame, features: list[str], imputer: SimpleImputer | None = None) -> tuple[np.ndarray, SimpleImputer]:
    fitted = imputer or SimpleImputer(strategy="median")
    values = fitted.fit_transform(rows[features]) if imputer is None else fitted.transform(rows[features])
    return np.asarray(values, dtype=float), fitted


def fit_direct(train: pd.DataFrame, test: pd.DataFrame, features: list[str], target: str) -> np.ndarray:
    model = hgb().fit(train[features], train[target].to_numpy(float))
    return np.clip(np.asarray(model.predict(test[features]), dtype=float), 0.0, None)


def fit_conditional_rate(
    train: pd.DataFrame,
    test: pd.DataFrame,
    features: list[str],
    numerator: str,
    denominator: str,
) -> np.ndarray:
    usable = train[train[denominator].gt(0)].copy()
    league_rate = float(usable[numerator].sum() / usable[denominator].sum())
    # One league-average opportunity is an empirical-Bayes stabilizer for the
    # extreme zero/one game-level rates; the opportunity count remains the fit weight.
    probability = (usable[numerator].to_numpy(float) + league_rate) / (usable[denominator].to_numpy(float) + 1.0)
    logit = np.log(np.clip(probability, 1e-5, 1 - 1e-5) / np.clip(1 - probability, 1e-5, 1))
    model = hgb().fit(usable[features], logit, sample_weight=np.maximum(usable[denominator].to_numpy(float), 1.0))
    raw = np.asarray(model.predict(test[features]), dtype=float)
    return 1.0 / (1.0 + np.exp(-np.clip(raw, -20, 20)))


def fit_conditional_efficiency(
    train: pd.DataFrame,
    test: pd.DataFrame,
    features: list[str],
    numerator: str,
    denominator: str,
) -> np.ndarray:
    usable = train[train[denominator].gt(0)].copy()
    efficiency = np.clip(usable[numerator].to_numpy(float) / usable[denominator].to_numpy(float), 0.0, None)
    model = hgb().fit(
        usable[features],
        np.log1p(efficiency),
        sample_weight=np.sqrt(np.maximum(usable[denominator].to_numpy(float), 1.0)),
    )
    return np.expm1(np.asarray(model.predict(test[features]), dtype=float)).clip(0.0)


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | int]:
    return {
        "rows": int(len(actual)),
        "mae": float(mean_absolute_error(actual, predicted)),
        "rmse": float(math.sqrt(mean_squared_error(actual, predicted))),
        "bias": float(np.mean(predicted - actual)),
    }


def choose_blend(actual: np.ndarray, direct: np.ndarray, joint: np.ndarray) -> tuple[float, dict[str, dict[str, float]]]:
    direct_mae = float(mean_absolute_error(actual, direct))
    direct_rmse = float(math.sqrt(mean_squared_error(actual, direct)))
    scores = {}
    for weight in BLEND_GRID:
        prediction = weight * joint + (1.0 - weight) * direct
        mae = float(mean_absolute_error(actual, prediction))
        rmse = float(math.sqrt(mean_squared_error(actual, prediction)))
        scores[str(weight)] = {
            "mae": mae,
            "rmse": rmse,
            "normalizedJointLoss": mae / direct_mae + rmse / direct_rmse,
        }
    selected = min(BLEND_GRID, key=lambda weight: (scores[str(weight)]["normalizedJointLoss"], -weight))
    return selected, scores


def predict_qb(train: pd.DataFrame, test: pd.DataFrame, features: list[str]) -> dict[str, np.ndarray]:
    attempts = fit_direct(train, test, features, "passing_attempts")
    direct_completions = fit_direct(train, test, features, "passing_completions")
    completion_rate = fit_conditional_rate(train, test, features, "passing_completions", "passing_attempts")
    joint_completions = np.minimum(attempts, attempts * completion_rate)
    direct_yards = fit_direct(train, test, features, "passing_yards")
    yards_per_attempt = fit_conditional_efficiency(train, test, features, "passing_yards", "passing_attempts")
    joint_yards = attempts * yards_per_attempt
    return {
        "passing_attempts": attempts,
        "passing_completions_direct": direct_completions,
        "passing_completions_joint": joint_completions,
        "passing_yards_direct": direct_yards,
        "passing_yards_joint": joint_yards,
        "completion_rate": completion_rate,
        "yards_per_attempt": yards_per_attempt,
    }


def predict_receiving(train: pd.DataFrame, test: pd.DataFrame, features: list[str]) -> dict[str, np.ndarray]:
    targets = fit_direct(train, test, features, "targets")
    direct_receptions = fit_direct(train, test, features, "receptions")
    catch_rate = fit_conditional_rate(train, test, features, "receptions", "targets")
    joint_receptions = np.minimum(targets, targets * catch_rate)
    direct_yards = fit_direct(train, test, features, "receiving_yards")
    yards_per_target = fit_conditional_efficiency(train, test, features, "receiving_yards", "targets")
    joint_yards = targets * yards_per_target
    return {
        "targets": targets,
        "receptions_direct": direct_receptions,
        "receptions_joint": joint_receptions,
        "receiving_yards_direct": direct_yards,
        "receiving_yards_joint": joint_yards,
        "catch_rate": catch_rate,
        "yards_per_target": yards_per_target,
    }


def predict_rushing(train: pd.DataFrame, test: pd.DataFrame, features: list[str]) -> dict[str, np.ndarray]:
    attempts = fit_direct(train, test, features, "rushing_attempts")
    direct_yards = fit_direct(train, test, features, "rushing_yards")
    yards_per_carry = fit_conditional_efficiency(train, test, features, "rushing_yards", "rushing_attempts")
    return {
        "rushing_attempts": attempts,
        "rushing_yards_direct": direct_yards,
        "rushing_yards_joint": attempts * yards_per_carry,
        "yards_per_carry": yards_per_carry,
    }


def season_predictions(
    frame: pd.DataFrame,
    eligible: pd.Series,
    season: int,
    features: list[str],
    predictor: Callable[[pd.DataFrame, pd.DataFrame, list[str]], dict[str, np.ndarray]],
) -> tuple[pd.DataFrame, dict[str, np.ndarray]]:
    train = frame[eligible & frame["season"].lt(season)].copy()
    test = frame[eligible & frame["season"].eq(season)].copy()
    if min(len(train), len(test)) < 100:
        raise RuntimeError(f"insufficient rows for season {season}")
    return test, predictor(train, test, features)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    baseline = load_baseline()
    contract = json.loads(baseline.CONTRACT_PATH.read_text(encoding="utf-8"))
    frame, manifest = baseline.load_verified_dataset(args.manifest, contract)
    frame, features = baseline.prepare_features(frame, manifest)

    qb_eligible = baseline.market_eligible(frame, contract["markets"]["passing_attempts"])
    receiving_eligible = baseline.market_eligible(frame, contract["markets"]["receptions"])
    rushing_eligible = baseline.market_eligible(frame, contract["markets"]["rushing_attempts"])
    families = {
        "qb": (qb_eligible, predict_qb, ("passing_completions", "passing_yards")),
        "receiving": (receiving_eligible, predict_receiving, ("receptions", "receiving_yards")),
        "rushing": (rushing_eligible, predict_rushing, ("rushing_yards",)),
    }

    report: dict[str, Any] = {
        "release": "nfl_player_props_joint_tournament_2026_09_28_r3",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "families": {},
    }
    for family, (eligible, predictor, dependent_markets) in families.items():
        print(f"joint tournament {family}...", flush=True)
        season_rows: dict[int, pd.DataFrame] = {}
        season_predictions_map: dict[int, dict[str, np.ndarray]] = {}
        for season in (2023, 2024, 2025):
            season_rows[season], season_predictions_map[season] = season_predictions(
                frame, eligible, season, features, predictor,
            )
        family_report: dict[str, Any] = {"rows": {str(year): len(season_rows[year]) for year in season_rows}, "markets": {}}
        for market in dependent_markets:
            selection_y = season_rows[2023][market].to_numpy(float)
            selected_weight, selection_scores = choose_blend(
                selection_y,
                season_predictions_map[2023][f"{market}_direct"],
                season_predictions_map[2023][f"{market}_joint"],
            )
            confirmation_y = season_rows[2024][market].to_numpy(float)
            confirmation_direct = season_predictions_map[2024][f"{market}_direct"]
            confirmation_joint = season_predictions_map[2024][f"{market}_joint"]
            confirmation_candidate = selected_weight * confirmation_joint + (1.0 - selected_weight) * confirmation_direct
            # A selected joint contribution is rejected if it fails to repeat within one percent on 2024.
            confirmed_weight = selected_weight
            confirmation_candidate_mae = mean_absolute_error(confirmation_y, confirmation_candidate)
            confirmation_direct_mae = mean_absolute_error(confirmation_y, confirmation_direct)
            confirmation_candidate_rmse = math.sqrt(mean_squared_error(confirmation_y, confirmation_candidate))
            confirmation_direct_rmse = math.sqrt(mean_squared_error(confirmation_y, confirmation_direct))
            if confirmation_candidate_mae > confirmation_direct_mae or confirmation_candidate_rmse > confirmation_direct_rmse * 1.005:
                confirmed_weight = 0.0
            holdout_y = season_rows[2025][market].to_numpy(float)
            holdout_direct = season_predictions_map[2025][f"{market}_direct"]
            holdout_joint = season_predictions_map[2025][f"{market}_joint"]
            holdout_candidate = confirmed_weight * holdout_joint + (1.0 - confirmed_weight) * holdout_direct
            if market in {"passing_completions", "receptions"}:
                opportunity = season_predictions_map[2025]["passing_attempts" if family == "qb" else "targets"]
                holdout_candidate = np.minimum(opportunity, holdout_candidate)
            family_report["markets"][market] = {
                "selectionMaeByJointWeight": selection_scores,
                "selectedJointWeight": selected_weight,
                "confirmedJointWeight": confirmed_weight,
                "confirmation": {
                    "direct": metrics(confirmation_y, confirmation_direct),
                    "candidate": metrics(confirmation_y, confirmation_candidate),
                },
                "holdout": {
                    "direct": metrics(holdout_y, holdout_direct),
                    "candidate": metrics(holdout_y, holdout_candidate),
                    "maeDelta": float(mean_absolute_error(holdout_y, holdout_candidate) - mean_absolute_error(holdout_y, holdout_direct)),
                    "clusteredMaeDelta": baseline.cluster_bootstrap_delta(
                        season_rows[2025],
                        np.abs(holdout_y - holdout_candidate),
                        np.abs(holdout_y - holdout_direct),
                    ),
                },
            }
        if family == "qb":
            attempts = season_predictions_map[2025]["passing_attempts"]
            completions = (
                family_report["markets"]["passing_completions"]["confirmedJointWeight"]
                * season_predictions_map[2025]["passing_completions_joint"]
                + (1.0 - family_report["markets"]["passing_completions"]["confirmedJointWeight"])
                * season_predictions_map[2025]["passing_completions_direct"]
            )
            completions = np.minimum(attempts, np.clip(completions, 0.0, None))
            family_report["holdoutCoherence"] = {
                "completionGreaterThanAttemptsRows": int(np.sum(completions > attempts + 1e-9)),
                "minimumCompletionRate": float(np.min(completions / np.maximum(attempts, 1e-9))),
                "maximumCompletionRate": float(np.max(completions / np.maximum(attempts, 1e-9))),
            }
        report["families"][family] = family_report

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "holdout": {
            family: {
                market: values["holdout"]
                for market, values in family_report["markets"].items()
            }
            for family, family_report in report["families"].items()
        },
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
