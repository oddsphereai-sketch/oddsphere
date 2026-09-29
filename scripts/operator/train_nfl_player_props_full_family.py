#!/usr/bin/env python3
"""Fit the validated full-family NFL player-props matchup release.

This script is deterministic and local-only. It consumes the checksum-verified
2016-2025 official-outcome dataset, reproduces the frozen 2023/2024/2025
chronology, recalibrates each selected point head from out-of-sample residuals,
and writes a joblib artifact for portable-runtime export.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import pathlib
import sys
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = pathlib.Path(
    "/private/tmp/oddsphere-nfl-player-props-joint-qb-r3/football-research/cache/"
    "nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
)
DEFAULT_OUTPUT_ROOT = pathlib.Path("football-research/cache/nfl-player-props-full-family")
SEED = 20260928
INCUMBENT_SEED = 20260825
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)

# Every recipe improved both MAE and RMSE in 2023 selection, 2024 confirmation,
# and untouched 2025 holdout versus the direct incumbent used in the tournament.
RECIPES: dict[str, tuple[tuple[float, str], ...]] = {
    "passing_attempts": ((1.0, "incumbent"),),
    "passing_completions": ((0.50, "incumbent"), (0.50, "poisson")),
    "passing_yards": ((0.25, "incumbent"), (0.75, "regularized")),
    "rushing_attempts": ((1.0, "poisson"),),
    "rushing_yards": ((1.0, "forest_stable_24"),),
    "receptions": ((0.25, "incumbent"), (0.75, "poisson")),
    "receiving_yards": ((0.75, "incumbent"), (0.25, "forest_compact_32")),
}


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def model_for(kind: str) -> Any:
    if kind == "incumbent":
        return HistGradientBoostingRegressor(
            loss="squared_error", max_iter=140, max_leaf_nodes=15,
            learning_rate=0.05, l2_regularization=2.0,
            random_state=INCUMBENT_SEED,
        )
    if kind == "poisson":
        return HistGradientBoostingRegressor(
            loss="poisson", max_iter=180, max_leaf_nodes=15,
            learning_rate=0.045, min_samples_leaf=25,
            l2_regularization=4.0, random_state=SEED,
        )
    if kind == "regularized":
        return HistGradientBoostingRegressor(
            loss="squared_error", max_iter=180, max_leaf_nodes=15,
            learning_rate=0.045, min_samples_leaf=45,
            l2_regularization=8.0, random_state=SEED,
        )
    if kind == "forest_stable_24":
        return ExtraTreesRegressor(
            n_estimators=24, max_depth=10, min_samples_leaf=20,
            max_features=0.75, n_jobs=-1, random_state=SEED,
        )
    if kind == "forest_compact_32":
        return ExtraTreesRegressor(
            n_estimators=32, max_depth=12, min_samples_leaf=14,
            max_features=0.65, n_jobs=-1, random_state=SEED,
        )
    raise ValueError(kind)


def fit_recipe(
    train: pd.DataFrame,
    test: pd.DataFrame,
    target: str,
    base_features: list[str],
    enhanced_features: list[str],
) -> tuple[list[dict[str, Any]], np.ndarray]:
    prediction = np.zeros(len(test), dtype=float)
    fitted: list[dict[str, Any]] = []
    for weight, kind in RECIPES[target]:
        features = base_features if kind == "incumbent" else enhanced_features
        model = model_for(kind)
        model.fit(train[features], train[target].to_numpy(float))
        component = np.clip(np.asarray(model.predict(test[features]), dtype=float), 0.0, None)
        prediction += weight * component
        fitted.append({"weight": weight, "kind": kind, "features": features, "model": model})
    return fitted, prediction


def fit_rate_model(
    train: pd.DataFrame,
    test: pd.DataFrame,
    features: list[str],
    numerator: str,
    denominator: str,
    probability: bool,
) -> tuple[Any, np.ndarray]:
    usable = train[train[denominator].gt(0)].copy()
    if probability:
        league = float(usable[numerator].sum() / usable[denominator].sum())
        target = (usable[numerator].to_numpy(float) + league) / (usable[denominator].to_numpy(float) + 1.0)
        target = np.log(np.clip(target, 1e-5, 1 - 1e-5) / np.clip(1 - target, 1e-5, 1))
        weight = np.maximum(usable[denominator].to_numpy(float), 1.0)
    else:
        target = np.log1p(np.clip(usable[numerator].to_numpy(float) / usable[denominator].to_numpy(float), 0.0, None))
        weight = np.sqrt(np.maximum(usable[denominator].to_numpy(float), 1.0))
    model = HistGradientBoostingRegressor(
        loss="squared_error", max_iter=180, max_leaf_nodes=15,
        learning_rate=0.045, min_samples_leaf=20,
        l2_regularization=3.0, random_state=SEED,
    ).fit(usable[features], target, sample_weight=weight)
    raw = np.asarray(model.predict(test[features]), dtype=float)
    return model, (1 / (1 + np.exp(-np.clip(raw, -20, 20)))) if probability else np.expm1(raw).clip(0.0)


def point_metrics(y: np.ndarray, prediction: np.ndarray) -> dict[str, Any]:
    return {
        "rows": int(len(y)),
        "mae": float(mean_absolute_error(y, prediction)),
        "rmse": float(np.sqrt(mean_squared_error(y, prediction))),
        "bias": float(np.mean(prediction - y)),
    }


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output-root", type=pathlib.Path, default=DEFAULT_OUTPUT_ROOT)
    args = parser.parse_args()

    baseline = load_module("props_full_family_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_full_family_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    recalibration = load_module("props_full_family_recal", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    team_features, team_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(team_features, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *team_names, *environment_names]

    eligible = {market: baseline.market_eligible(frame, contract["markets"][market]) for market in MARKETS}
    predictions: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    qb_auxiliary: dict[int, dict[str, np.ndarray]] = {}
    for season in (2023, 2024, 2025):
        print(f"full-family out-of-sample season {season}...", flush=True)
        fitted_predictions: dict[str, np.ndarray] = {}
        for market in MARKETS:
            train = frame[eligible[market] & frame["season"].lt(season)]
            test = frame[eligible[market] & frame["season"].eq(season)]
            rows[market][season] = test
            _, fitted_predictions[market] = fit_recipe(train, test, market, base_features, enhanced_features)
            predictions[market][season] = fitted_predictions[market]
        qb_train = frame[eligible["passing_attempts"] & frame["season"].lt(season)]
        qb_test = rows["passing_attempts"][season]
        _, completion_rate = fit_rate_model(qb_train, qb_test, enhanced_features, "passing_completions", "passing_attempts", True)
        _, yards_per_attempt = fit_rate_model(qb_train, qb_test, enhanced_features, "passing_yards", "passing_attempts", False)
        attempts = fitted_predictions["passing_attempts"]
        completions = np.minimum(attempts, 0.75 * attempts * completion_rate + 0.25 * fitted_predictions["passing_completions"])
        yards = 0.75 * attempts * yards_per_attempt + 0.25 * fitted_predictions["passing_yards"]
        predictions["passing_completions"][season] = np.clip(completions, 0.0, None)
        predictions["passing_yards"][season] = np.clip(yards, 0.0, None)
        qb_auxiliary[season] = {"attempts": attempts, "completionRate": completion_rate, "yardsPerAttempt": yards_per_attempt}

    reports: dict[str, Any] = {}
    distributions: dict[str, Any] = {}
    for market in MARKETS:
        fit_rows, select_rows, holdout_rows = rows[market][2023], rows[market][2024], rows[market][2025]
        fit_y, select_y, holdout_y = (part[market].to_numpy(float) for part in (fit_rows, select_rows, holdout_rows))
        fit_mu, select_mu, holdout_mu = (predictions[market][year] for year in (2023, 2024, 2025))
        candidates = {
            "empirical_residual_global": recalibration.empirical_distribution(
                fit_y - fit_mu, int(calibration_contract["empiricalQuantileGridSize"]),
            ),
            "empirical_residual_mean_quartile": recalibration.bucketed_empirical_distribution(
                fit_y - fit_mu, fit_mu, int(calibration_contract["empiricalQuantileGridSize"]),
                int(calibration_contract["minimumBucketRows"]),
            ),
        }
        selection_metrics = {
            name: recalibration.empirical_metrics(select_y, select_mu, distribution)
            for name, distribution in candidates.items()
        }
        selected = min(selection_metrics, key=lambda name: recalibration.selection_key(selection_metrics[name], calibration_contract))
        combined_y = np.concatenate([fit_y, select_y])
        combined_mu = np.concatenate([fit_mu, select_mu])
        final_distribution = (
            recalibration.empirical_distribution(combined_y - combined_mu, int(calibration_contract["empiricalQuantileGridSize"]))
            if selected == "empirical_residual_global"
            else recalibration.bucketed_empirical_distribution(
                combined_y - combined_mu, combined_mu, int(calibration_contract["empiricalQuantileGridSize"]),
                int(calibration_contract["minimumBucketRows"]),
            )
        )
        distributions[market] = final_distribution
        reports[market] = {
            "recipe": RECIPES[market],
            "selection": point_metrics(fit_y, fit_mu),
            "confirmation": point_metrics(select_y, select_mu),
            "holdout": point_metrics(holdout_y, holdout_mu),
            "selectedDistribution": selected,
            "distributionSelection": selection_metrics,
            "distributionHoldout": recalibration.empirical_metrics(holdout_y, holdout_mu, final_distribution),
        }

    fitted_markets: dict[str, Any] = {}
    for market in MARKETS:
        training = frame[eligible[market]]
        components, _ = fit_recipe(training, training.iloc[:1], market, base_features, enhanced_features)
        fitted_markets[market] = {"components": components, "distribution": distributions[market]}
    qb_training = frame[eligible["passing_attempts"]]
    completion_rate_model, _ = fit_rate_model(
        qb_training, qb_training.iloc[:1], enhanced_features, "passing_completions", "passing_attempts", True,
    )
    yards_per_attempt_model, _ = fit_rate_model(
        qb_training, qb_training.iloc[:1], enhanced_features, "passing_yards", "passing_attempts", False,
    )
    usable_qb = qb_training[qb_training["passing_attempts"].gt(0)]
    artifact = {
        "release": "nfl_player_props_full_family_training_2026_09_29_r1",
        "sourceHistorySha256": manifest["featureFileSha256"],
        "trainingThrough": 2025,
        "baseFeatures": base_features,
        "enhancedFeatures": enhanced_features,
        "teamFeatureNames": team_names,
        "environmentFeatureNames": environment_names,
        "markets": fitted_markets,
        "qbJoint": {
            "completionRateModel": completion_rate_model,
            "yardsPerAttemptModel": yards_per_attempt_model,
            "jointWeight": 0.75,
            "directWeight": 0.25,
            "leagueCompletionRate": float(usable_qb["passing_completions"].sum() / usable_qb["passing_attempts"].sum()),
            "leagueYardsPerAttempt": float(usable_qb["passing_yards"].sum() / usable_qb["passing_attempts"].sum()),
        },
        "reports": reports,
    }
    args.output_root.mkdir(parents=True, exist_ok=True)
    artifact_path = args.output_root / "nfl_player_props_full_family_r1.joblib"
    report_path = args.output_root / "nfl_player_props_full_family_r1.json"
    joblib.dump(artifact, artifact_path)
    report = {
        "release": artifact["release"],
        "sourceHistorySha256": artifact["sourceHistorySha256"],
        "chronology": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025},
        "featureFamilies": [
            "player_role_and_share", "team_and_opponent_play_mix", "passing_and_rushing_efficiency",
            "sack_pressure", "first_down_and_explosive_rates", "turnovers", "air_yards_and_yac",
            "weather_roof_and_week", "coherent_qb_opportunity_rate_efficiency",
        ],
        "markets": reports,
        "artifact": str(artifact_path),
        "artifactSha256": sha256(artifact_path),
    }
    report_path.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "artifact": str(artifact_path), "artifactSha256": report["artifactSha256"],
        "report": str(report_path),
        "holdout": {market: values["holdout"] for market, values in reports.items()},
    }, indent=2))


if __name__ == "__main__":
    main()
