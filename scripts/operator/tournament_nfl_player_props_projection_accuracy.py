#!/usr/bin/env python3
"""Chronological NFL player-props point-head residual-correction tournament.

The candidate layer is deliberately price- and line-blind. It learns only from
strictly prior-season out-of-sample errors made by the released full-family
point recipes. Selection uses 2023, confirmation uses 2024, and the selected
family is evaluated once on 2025.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-projection-accuracy/nfl_player_props_projection_accuracy_r1.json"
MARKETS = (
    "passing_attempts", "passing_completions", "passing_yards",
    "rushing_attempts", "rushing_yards", "receptions", "receiving_yards",
)
OOS_SEASONS = tuple(range(2019, 2026))
EVALUATION_SEASONS = (2023, 2024, 2025)
SEED = 20261007


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def correction_feature_names(market: str, available: list[str]) -> list[str]:
    common = [
        "_base_prediction", "is_home", "position_qb", "position_rb", "position_fb",
        "position_wr", "position_te", "prior_participations",
        "prior_offense_snap_pct_avg3", "prior_offense_snap_pct_avg5",
        "prior_offense_snap_pct_ewm", "prior_team_offensive_plays_avg5",
        "prior_opponent_allowed_offensive_plays_avg5", "matchup_week",
    ]
    families = {
        "passing_attempts": ("passing_attempts", "pass_attempt_share", "team_pass_attempts", "opponent_allowed_pass_attempts"),
        "passing_completions": ("passing_completions", "passing_attempts", "pass_attempt_share", "team_completions", "opponent_allowed_completions"),
        "passing_yards": ("passing_yards", "passing_attempts", "pass_attempt_share", "team_passing_yards", "opponent_allowed_passing_yards"),
        "rushing_attempts": ("rushing_attempts", "rush_attempt_share", "team_rush_attempts", "opponent_allowed_rush_attempts"),
        "rushing_yards": ("rushing_yards", "rushing_attempts", "rush_attempt_share", "team_rushing_yards", "opponent_allowed_rushing_yards"),
        "receptions": ("receptions", "targets", "target_share", "team_targets", "opponent_allowed_targets"),
        "receiving_yards": ("receiving_yards", "receptions", "targets", "target_share", "team_targets", "opponent_allowed_passing_yards"),
    }
    tokens = families[market]
    selected = list(common)
    for name in available:
        if not name.startswith("prior_"):
            continue
        if any(token in name for token in tokens) and name.endswith(("lag1", "avg3", "avg5", "ewm", "season_avg")):
            selected.append(name)
    matchup_tokens = {
        "passing_attempts": ("pass_rate", "sack_rate"),
        "passing_completions": ("completion_rate", "passing_cpoe", "sack_rate"),
        "passing_yards": ("pass_yards_per_attempt", "pass_epa_per_dropback", "explosive_pass_rate", "air_yards_per_target", "yac_per_target", "sack_rate"),
        "rushing_attempts": ("pass_rate", "rush_epa_per_attempt"),
        "rushing_yards": ("rush_yards_per_attempt", "rush_epa_per_attempt", "explosive_rush_rate"),
        "receptions": ("completion_rate", "air_yards_per_target"),
        "receiving_yards": ("completion_rate", "pass_yards_per_attempt", "air_yards_per_target", "yac_per_target", "explosive_pass_rate"),
    }[market]
    selected.extend(name for name in available if name.startswith("matchup_") and any(token in name for token in matchup_tokens))
    return list(dict.fromkeys(name for name in selected if name in available or name == "_base_prediction"))


def design(rows: pd.DataFrame, base: np.ndarray, features: list[str]) -> pd.DataFrame:
    values = rows.copy()
    values["_base_prediction"] = base
    return values[features].replace([np.inf, -np.inf], np.nan)


def fit_candidates(
    calibration_rows: pd.DataFrame,
    calibration_base: np.ndarray,
    evaluation_rows: pd.DataFrame,
    evaluation_base: np.ndarray,
    market: str,
    features: list[str],
) -> dict[str, np.ndarray]:
    y = calibration_rows[market].to_numpy(float)
    residual = y - calibration_base
    train_x = design(calibration_rows, calibration_base, features)
    test_x = design(evaluation_rows, evaluation_base, features)
    output: dict[str, np.ndarray] = {
        "global_mean_bias": evaluation_base + float(np.mean(residual)),
        "global_median_bias": evaluation_base + float(np.median(residual)),
    }

    isotonic = IsotonicRegression(out_of_bounds="clip", y_min=0.0).fit(calibration_base, y)
    output["isotonic_base"] = np.asarray(isotonic.predict(evaluation_base), dtype=float)

    direct_ridge = make_pipeline(
        SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=100.0),
    ).fit(train_x, y)
    output["direct_ridge"] = np.asarray(direct_ridge.predict(test_x), dtype=float)

    residual_ridge = make_pipeline(
        SimpleImputer(strategy="median"), StandardScaler(), Ridge(alpha=250.0),
    ).fit(train_x, residual)
    ridge_correction = np.asarray(residual_ridge.predict(test_x), dtype=float)
    for weight in (0.25, 0.50, 0.75, 1.0):
        output[f"residual_ridge_{int(weight * 100)}"] = evaluation_base + weight * ridge_correction

    for loss in ("squared_error", "absolute_error"):
        model = HistGradientBoostingRegressor(
            loss=loss, max_iter=140, max_leaf_nodes=7, learning_rate=0.04,
            min_samples_leaf=100, l2_regularization=12.0, random_state=SEED,
        ).fit(train_x, residual)
        correction = np.asarray(model.predict(test_x), dtype=float)
        prefix = "residual_hgb_squared" if loss == "squared_error" else "residual_hgb_absolute"
        for weight in (0.25, 0.50, 0.75, 1.0):
            output[f"{prefix}_{int(weight * 100)}"] = evaluation_base + weight * correction
    return {name: np.clip(values, 0.0, None) for name, values in output.items()}


def point_metrics(y: np.ndarray, prediction: np.ndarray) -> dict[str, float | int]:
    residual = prediction - y
    return {
        "rows": int(len(y)),
        "mae": float(mean_absolute_error(y, prediction)),
        "rmse": float(math.sqrt(mean_squared_error(y, prediction))),
        "medianAbsoluteError": float(np.median(np.abs(residual))),
        "bias": float(np.mean(residual)),
        "underpredictionRate": float(np.mean(prediction < y)),
    }


def clustered_delta(rows: pd.DataFrame, candidate_error: np.ndarray, incumbent_error: np.ndarray) -> dict[str, float | int]:
    grouped = pd.DataFrame({
        "game_id": rows["game_id"].to_numpy(),
        "delta": candidate_error - incumbent_error,
    }).groupby("game_id", observed=True)["delta"].agg(["sum", "count"])
    values = grouped.to_numpy(float)
    rng = np.random.default_rng(SEED)
    draws = np.empty(2000)
    for index in range(len(draws)):
        sample = values[rng.integers(0, len(values), len(values))]
        draws[index] = sample[:, 0].sum() / sample[:, 1].sum()
    return {
        "meanDelta": float(np.mean(draws)),
        "ciLow": float(np.quantile(draws, 0.025)),
        "ciHigh": float(np.quantile(draws, 0.975)),
        "gameClusters": int(len(values)),
    }


def segment_metrics(rows: pd.DataFrame, y: np.ndarray, incumbent: np.ndarray, candidate: np.ndarray) -> list[dict[str, Any]]:
    ordered = np.argsort(pd.to_datetime(rows["game_date"]).to_numpy())
    segments = np.array_split(ordered, 4)
    output: list[dict[str, Any]] = []
    for index, segment in enumerate(segments, start=1):
        output.append({
            "segment": index,
            "rows": int(len(segment)),
            "incumbentMae": float(mean_absolute_error(y[segment], incumbent[segment])),
            "candidateMae": float(mean_absolute_error(y[segment], candidate[segment])),
            "maeDelta": float(mean_absolute_error(y[segment], candidate[segment]) - mean_absolute_error(y[segment], incumbent[segment])),
        })
    return output


def distribution_report(
    recalibration: Any,
    contract: dict[str, Any],
    actual: dict[int, np.ndarray],
    prediction: dict[int, np.ndarray],
) -> dict[str, Any]:
    grid = int(contract["empiricalQuantileGridSize"])
    minimum = int(contract["minimumBucketRows"])
    fit_y, select_y, holdout_y = (actual[season] for season in EVALUATION_SEASONS)
    fit_mu, select_mu, holdout_mu = (prediction[season] for season in EVALUATION_SEASONS)
    candidates = {
        "global": recalibration.empirical_distribution(fit_y - fit_mu, grid),
        "mean_quartile": recalibration.bucketed_empirical_distribution(fit_y - fit_mu, fit_mu, grid, minimum, bucket_count=4),
        "mean_quintile": recalibration.bucketed_empirical_distribution(fit_y - fit_mu, fit_mu, grid, minimum, bucket_count=5),
    }
    selection = {
        name: recalibration.empirical_metrics(select_y, select_mu, distribution)
        for name, distribution in candidates.items()
    }
    selected = min(selection, key=lambda name: recalibration.selection_key(selection[name], contract))
    combined_y = np.concatenate([fit_y, select_y])
    combined_mu = np.concatenate([fit_mu, select_mu])
    final = (
        recalibration.empirical_distribution(combined_y - combined_mu, grid)
        if selected == "global"
        else recalibration.bucketed_empirical_distribution(
            combined_y - combined_mu, combined_mu, grid, minimum,
            bucket_count=4 if selected == "mean_quartile" else 5,
        )
    )
    return {
        "selected": selected,
        "selection": selection[selected],
        "holdout": recalibration.empirical_metrics(holdout_y, holdout_mu, final),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    baseline = load_module("props_accuracy_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_accuracy_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("props_accuracy_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    opportunity = load_module("props_accuracy_opportunity", ROOT / "scripts/operator/tournament_nfl_player_props_opportunity_budget.py")
    recalibration = load_module("props_accuracy_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    history_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, history_contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    matchup_rows, matchup_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *matchup_names, *environment_names]
    eligible = {market: baseline.market_eligible(frame, history_contract["markets"][market]) for market in MARKETS}

    rows: dict[str, dict[int, pd.DataFrame]] = {market: {} for market in MARKETS}
    actual: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    incumbent: dict[str, dict[int, np.ndarray]] = {market: {} for market in MARKETS}
    for season in OOS_SEASONS:
        print(f"incumbent out-of-sample season {season}...", flush=True)
        season_rows, predictions, _ = opportunity.incumbent_predictions(
            trainer, frame, eligible, season, base_features, enhanced_features,
        )
        for market in MARKETS:
            rows[market][season] = season_rows[market]
            actual[market][season] = season_rows[market][market].to_numpy(float)
            incumbent[market][season] = predictions[market]

    candidates: dict[str, dict[str, dict[int, np.ndarray]]] = {market: {} for market in MARKETS}
    feature_report: dict[str, list[str]] = {}
    for market in MARKETS:
        features = correction_feature_names(market, enhanced_features)
        feature_report[market] = features
        for season in EVALUATION_SEASONS:
            source_seasons = [value for value in OOS_SEASONS if value < season]
            calibration_rows = pd.concat([rows[market][value] for value in source_seasons], ignore_index=True)
            calibration_base = np.concatenate([incumbent[market][value] for value in source_seasons])
            predictions = fit_candidates(
                calibration_rows, calibration_base, rows[market][season], incumbent[market][season], market, features,
            )
            for name, prediction in predictions.items():
                candidates[market].setdefault(name, {})[season] = prediction

    report: dict[str, Any] = {}
    for market in MARKETS:
        selection_y = actual[market][2023]
        selection_reference = point_metrics(selection_y, incumbent[market][2023])
        selection = {
            name: point_metrics(selection_y, predictions[2023])
            for name, predictions in candidates[market].items()
        }
        selectable = [name for name, values in selection.items() if (
            float(values["mae"]) < float(selection_reference["mae"])
            and float(values["rmse"]) < float(selection_reference["rmse"])
        )]
        selected = min(selectable, key=lambda name: (
            float(selection[name]["mae"]) / float(selection_reference["mae"])
            + float(selection[name]["rmse"]) / float(selection_reference["rmse"])
        )) if selectable else None

        confirmation_y = actual[market][2024]
        confirmation_reference = point_metrics(confirmation_y, incumbent[market][2024])
        confirmation_candidate = point_metrics(confirmation_y, candidates[market][selected][2024]) if selected else None
        confirmed = bool(selected and confirmation_candidate
                         and float(confirmation_candidate["mae"]) < float(confirmation_reference["mae"])
                         and float(confirmation_candidate["rmse"]) < float(confirmation_reference["rmse"]))
        chosen = candidates[market][selected] if confirmed and selected else incumbent[market]

        holdout_y = actual[market][2025]
        holdout_reference = point_metrics(holdout_y, incumbent[market][2025])
        holdout_candidate = point_metrics(holdout_y, chosen[2025])
        mae_bootstrap = clustered_delta(
            rows[market][2025], np.abs(chosen[2025] - holdout_y), np.abs(incumbent[market][2025] - holdout_y),
        )
        bias_bootstrap = clustered_delta(
            rows[market][2025], chosen[2025] - holdout_y, incumbent[market][2025] - holdout_y,
        )
        segments = segment_metrics(rows[market][2025], holdout_y, incumbent[market][2025], chosen[2025])
        incumbent_distribution = distribution_report(recalibration, calibration_contract, actual[market], incumbent[market])
        candidate_distribution = distribution_report(recalibration, calibration_contract, actual[market], chosen)
        market_mean = float(np.mean(holdout_y))
        point_pass = bool(
            confirmed
            and float(holdout_candidate["mae"]) < float(holdout_reference["mae"])
            and float(holdout_candidate["rmse"]) < float(holdout_reference["rmse"])
            and float(mae_bootstrap["ciHigh"]) < 0.0
            and abs(float(holdout_candidate["bias"])) <= abs(float(holdout_reference["bias"])) + 0.0025 * market_mean
            and float(holdout_candidate["underpredictionRate"]) <= float(holdout_reference["underpredictionRate"]) + 0.0025
            and all(float(segment["maeDelta"]) <= 0.0 for segment in segments)
        )
        incumbent_dist = incumbent_distribution["holdout"]
        candidate_dist = candidate_distribution["holdout"]
        distribution_pass = bool(
            float(candidate_dist["crps"]) < float(incumbent_dist["crps"])
            and float(candidate_dist["nll"]) <= float(incumbent_dist["nll"]) * 1.005
            and abs(float(candidate_dist["coverage_80"]) - 0.8) <= float(calibration_contract["selection"]["maximumAbsoluteCoverage80Error"])
            and abs(float(candidate_dist["coverage_90"]) - 0.9) <= float(calibration_contract["selection"]["maximumAbsoluteCoverage90Error"])
        )
        report[market] = {
            "features": features,
            "selection": {"incumbent": selection_reference, "candidates": selection, "selected": selected},
            "confirmation": {"incumbent": confirmation_reference, "candidate": confirmation_candidate, "confirmed": confirmed},
            "holdout": {
                "incumbent": holdout_reference,
                "candidate": holdout_candidate,
                "clusteredMaeDelta": mae_bootstrap,
                "clusteredBiasDelta": bias_bootstrap,
                "chronologicalSegments": segments,
            },
            "distribution": {"incumbent": incumbent_distribution, "candidate": candidate_distribution},
            "passes": {"point": point_pass, "distribution": distribution_pass, "all": bool(point_pass and distribution_pass)},
        }

    output = {
        "release": "nfl_player_props_projection_accuracy_tournament_2026_10_07_r1",
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "chronology": {
            "rollingOosCorrectionFit": [2019, 2022],
            "selection": 2023,
            "confirmation": 2024,
            "holdout": 2025,
        },
        "lineOrPriceFeatures": [],
        "candidateFamilies": [
            "global_mean_bias", "global_median_bias", "isotonic_base", "direct_ridge",
            "residual_ridge", "residual_hgb_squared", "residual_hgb_absolute",
        ],
        "features": feature_report,
        "markets": report,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "markets": {
            market: {
                "selected": values["selection"]["selected"],
                "confirmed": values["confirmation"]["confirmed"],
                "holdout": values["holdout"],
                "distribution": values["distribution"],
                "passes": values["passes"],
            }
            for market, values in report.items()
        },
    }, indent=2), flush=True)


if __name__ == "__main__":
    main()
