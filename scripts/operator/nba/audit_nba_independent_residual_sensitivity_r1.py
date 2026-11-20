#!/usr/bin/env python3
"""Leakage-aware NBA independent residual sensitivity audit.

This is an offline research operator. It rebuilds the incumbent r15 recipe in
each chronological fold, then tests a bounded residual family selected only on
2023-24. The already-opened 2025 season is replication evidence, never a new
pristine holdout. It has no production, writer, DB, or shadow authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd


RELEASE = "nba_independent_error_sensitivity_2026_10_29_r1"
FEATURE_RELEASE = "nba_point_in_time_features_2026_10_15_r13_season_regime_state"
BASE_ALPHA = 1_000.0
RESIDUAL_ALPHAS = (100.0, 1_000.0, 10_000.0)
SELECTION_SEASONS = (2023, 2024)
REPLICATION_SEASON = 2025


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def load_jsonl(path: Path) -> pd.DataFrame:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    if not rows:
        raise ValueError("NBA feature ledger is empty")
    frame = pd.DataFrame(rows).sort_values(["feature_cutoff", "game_id"]).reset_index(drop=True)
    if set(frame["release"].unique()) != {FEATURE_RELEASE}:
        raise ValueError("NBA feature ledger has a mixed or unsupported release")
    if frame["game_id"].duplicated().any():
        raise ValueError("NBA feature ledger contains duplicate games")
    return frame


def ridge(x: np.ndarray, y: np.ndarray, alpha: float, intercept: bool) -> np.ndarray:
    design = np.column_stack([x, np.ones(len(x))]) if intercept else x
    penalty = np.eye(design.shape[1]) * alpha
    if intercept:
        penalty[-1, -1] = 0.0
    return np.linalg.solve(design.T @ design + penalty, design.T @ y)


def apply_beta(x: np.ndarray, beta: np.ndarray, intercept: bool) -> np.ndarray:
    design = np.column_stack([x, np.ones(len(x))]) if intercept else x
    return design @ beta


def transform_fit(
    train: pd.DataFrame,
    test: pd.DataFrame,
    features: list[str],
    missing_indicators: list[str],
) -> tuple[np.ndarray, np.ndarray]:
    train_raw = train.reindex(columns=features).apply(pd.to_numeric, errors="coerce")
    test_raw = test.reindex(columns=features).apply(pd.to_numeric, errors="coerce")
    medians = train_raw.median(axis=0).fillna(0.0)
    train_missing = train_raw.isna()
    test_missing = test_raw.isna()
    train_values = train_raw.fillna(medians).to_numpy(float)
    test_values = test_raw.fillna(medians).to_numpy(float)
    indexes = [features.index(feature) for feature in missing_indicators if feature in features]
    if indexes:
        train_values = np.column_stack([train_values, train_missing.iloc[:, indexes].to_numpy(float)])
        test_values = np.column_stack([test_values, test_missing.iloc[:, indexes].to_numpy(float)])
    means = train_values.mean(axis=0)
    deviations = train_values.std(axis=0)
    deviations[~np.isfinite(deviations) | (deviations < 1e-9)] = 1.0
    return (train_values - means) / deviations, (test_values - means) / deviations


def fit_base(
    train: pd.DataFrame,
    test: pd.DataFrame,
    features: list[str],
    missing: list[str],
) -> tuple[np.ndarray, np.ndarray]:
    x_train, x_test = transform_fit(train, test, features, missing)
    margin_beta = ridge(x_train, train["target_home_margin"].to_numpy(float), BASE_ALPHA, True)
    total_beta = ridge(x_train, train["target_total"].to_numpy(float), BASE_ALPHA, True)
    return apply_beta(x_test, margin_beta, True), apply_beta(x_test, total_beta, True)


def available(frame: pd.DataFrame, candidates: list[str]) -> list[str]:
    return [column for column in candidates if column in frame and frame[column].notna().any()]


def context_groups(frame: pd.DataFrame) -> dict[str, list[str]]:
    columns = list(frame.columns)
    def tokens(*needles: str) -> list[str]:
        return sorted({column for column in columns if any(needle in column for needle in needles)})
    return {
        "season_stage": available(frame, [
            "home_current_games", "away_current_games", "home_prior_games", "away_prior_games",
            "league_current_team_games", "league_prior_team_games",
            "league_current_vs_prior_off_rating_delta", "league_current_vs_prior_pace_delta",
        ]),
        "rating_shape": available(frame, [
            "baseline_expected_margin_pp100", "baseline_expected_total_pp100",
            "elo_rating_delta", "elo_home_win_probability", "home_adjusted_offense",
            "home_adjusted_defense", "away_adjusted_offense", "away_adjusted_defense",
        ]),
        "form_volatility": tokens("margin_sd_", "home_margin_5", "away_margin_5", "home_margin_15", "away_margin_15"),
        "pace_matchup": tokens("matchup_pace_", "home_pace_", "away_pace_"),
        "schedule": tokens(
            "rest_days", "back_to_back", "games_last_4_days", "games_last_7_days",
            "travel_", "time_zones_", "altitude_", "consecutive_road_games_",
        ),
        "rotation": tokens(
            "rotationPlayers_", "top3MinutesShare_", "top8MinutesShare_",
            "rotationMinutesEntropy_", "rotation_continuity_", "rotation_expected_",
        ),
    }


def context_matrix(
    train: pd.DataFrame,
    test: pd.DataFrame,
    train_margin: np.ndarray,
    test_margin: np.ndarray,
    train_total: np.ndarray,
    test_total: np.ndarray,
    columns: list[str],
    splines: bool,
) -> tuple[np.ndarray, np.ndarray]:
    train_raw = train.reindex(columns=columns).apply(pd.to_numeric, errors="coerce")
    test_raw = test.reindex(columns=columns).apply(pd.to_numeric, errors="coerce")
    medians = train_raw.median(axis=0).fillna(0.0)
    train_values = train_raw.fillna(medians).to_numpy(float)
    test_values = test_raw.fillna(medians).to_numpy(float)
    derived_train = [train_margin, np.abs(train_margin), train_total]
    derived_test = [test_margin, np.abs(test_margin), test_total]
    if splines:
        for knot in (3.0, 6.0, 9.0, 12.0):
            derived_train.append(np.sign(train_margin) * np.maximum(np.abs(train_margin) - knot, 0.0))
            derived_test.append(np.sign(test_margin) * np.maximum(np.abs(test_margin) - knot, 0.0))
    train_values = np.column_stack([train_values, *derived_train])
    test_values = np.column_stack([test_values, *derived_test])
    means = train_values.mean(axis=0)
    deviations = train_values.std(axis=0)
    deviations[~np.isfinite(deviations) | (deviations < 1e-9)] = 1.0
    return (train_values - means) / deviations, (test_values - means) / deviations


def normal_cdf(value: np.ndarray) -> np.ndarray:
    return np.vectorize(lambda item: 0.5 * (1.0 + math.erf(item / math.sqrt(2.0))))(value)


def mixture_cdf(value: np.ndarray, sigma: float) -> np.ndarray:
    core = max(1e-6, sigma * 0.85)
    tail = max(1e-6, sigma * 2.5)
    return 0.85 * normal_cdf(value / core) + 0.15 * normal_cdf(value / tail)


def mixture_quantile(probability: float, sigma: float) -> float:
    low, high = -10.0 * sigma, 10.0 * sigma
    for _ in range(80):
        middle = (low + high) / 2.0
        if float(mixture_cdf(np.array([middle]), sigma)[0]) < probability:
            low = middle
        else:
            high = middle
    return (low + high) / 2.0


def metrics(
    frame: pd.DataFrame,
    margin: np.ndarray,
    total: np.ndarray,
    sigma: float,
    band_margin: np.ndarray,
) -> dict[str, Any]:
    actual_margin = frame["target_home_margin"].to_numpy(float)
    actual_total = frame["target_total"].to_numpy(float)
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    predicted_home = (total + margin) / 2.0
    predicted_away = (total - margin) / 2.0
    home_win = (actual_margin > 0).astype(float)
    probability = np.clip(mixture_cdf(margin, sigma), 1e-6, 1 - 1e-6)
    variance = float(np.var(margin))
    slope = float(np.cov(margin, actual_margin, ddof=0)[0, 1] / variance) if variance > 1e-9 else None
    tail_probability = 1.0 - (
        mixture_cdf(20.0 - margin, sigma) - mixture_cdf(-20.0 - margin, sigma)
    )
    tail_actual = (np.abs(actual_margin) >= 20).astype(float)
    intervals = {}
    for level in (0.80, 0.90, 0.95):
        radius = mixture_quantile((1.0 + level) / 2.0, sigma)
        intervals[str(level)] = float(np.mean(np.abs(actual_margin - margin) <= radius))
    bands = {}
    boundaries = (("0_3", 0, 3), ("3_6", 3, 6), ("6_9", 6, 9), ("9_12", 9, 12), ("12_plus", 12, math.inf))
    absolute_band = np.abs(band_margin)
    for name, lower, upper in boundaries:
        selected = (absolute_band >= lower) & (absolute_band < upper)
        if not selected.any():
            continue
        bands[name] = {
            "games": int(selected.sum()),
            "marginMae": float(np.mean(np.abs(margin[selected] - actual_margin[selected]))),
            "marginBias": float(np.mean(margin[selected] - actual_margin[selected])),
            "winnerAccuracy": float(np.mean((margin[selected] > 0) == (actual_margin[selected] > 0))),
        }
    return {
        "games": len(frame),
        "teamScoreMae": float(np.mean((np.abs(predicted_home - actual_home) + np.abs(predicted_away - actual_away)) / 2.0)),
        "marginMae": float(np.mean(np.abs(margin - actual_margin))),
        "totalMae": float(np.mean(np.abs(total - actual_total))),
        "marginBias": float(np.mean(margin - actual_margin)),
        "totalBias": float(np.mean(total - actual_total)),
        "winnerAccuracy": float(np.mean((margin > 0) == (actual_margin > 0))),
        "winnerBrier": float(np.mean((probability - home_win) ** 2)),
        "winnerLogLoss": float(-np.mean(home_win * np.log(probability) + (1 - home_win) * np.log(1 - probability))),
        "predictedMarginSd": float(np.std(margin)),
        "actualMarginSd": float(np.std(actual_margin)),
        "actualOnPredictedMarginSlope": slope,
        "tail20Brier": float(np.mean((tail_probability - tail_actual) ** 2)),
        "tail20Observed": float(np.mean(tail_actual)),
        "tail20Predicted": float(np.mean(tail_probability)),
        "marginIntervalCoverage": intervals,
        "incumbentMarginBands": bands,
    }


def delta(candidate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, float]:
    keys = ("teamScoreMae", "marginMae", "totalMae", "winnerAccuracy", "winnerBrier", "winnerLogLoss", "tail20Brier")
    return {key: float(candidate[key] - baseline[key]) for key in keys}


def main() -> None:
    options = args()
    frame = load_jsonl(options.features)
    artifact = json.loads(options.artifact.read_text())
    features = list(artifact["design"]["features"])
    missing = list(artifact["design"]["missingIndicatorColumns"])
    for target in ("target_home_score", "target_away_score", "target_home_margin", "target_total"):
        frame[target] = pd.to_numeric(frame[target], errors="raise")
    seasons = sorted(int(value) for value in frame["season"].unique())
    if seasons != [2021, 2022, 2023, 2024, 2025]:
        raise ValueError(f"unexpected NBA seasons: {seasons}")

    base_predictions: dict[int, tuple[np.ndarray, np.ndarray]] = {}
    for season in seasons[1:]:
        train = frame[frame["season"] < season]
        test = frame[frame["season"] == season]
        base_predictions[season] = fit_base(train, test, features, missing)

    groups = {name: columns for name, columns in context_groups(frame).items() if columns}
    all_columns = sorted({column for columns in groups.values() for column in columns})
    variants: dict[str, tuple[list[str], bool]] = {
        **{f"add_{name}": (columns, False) for name, columns in groups.items()},
        "all_context": (all_columns, False),
        "all_context_margin_splines": (all_columns, True),
        **{
            f"drop_{name}": (sorted(set(all_columns) - set(columns)), False)
            for name, columns in groups.items()
        },
    }

    folds: dict[int, dict[str, Any]] = {}
    candidate_results: dict[str, dict[int, dict[str, Any]]] = {}
    for season in (*SELECTION_SEASONS, REPLICATION_SEASON):
        test = frame[frame["season"] == season].reset_index(drop=True)
        test_margin, test_total = base_predictions[season]
        residual_frames = []
        residual_margin_predictions = []
        residual_total_predictions = []
        for prior in seasons[1:]:
            if prior >= season:
                break
            prior_frame = frame[frame["season"] == prior].reset_index(drop=True)
            prior_margin, prior_total = base_predictions[prior]
            residual_frames.append(prior_frame)
            residual_margin_predictions.append(prior_margin)
            residual_total_predictions.append(prior_total)
        residual_frame = pd.concat(residual_frames, ignore_index=True)
        residual_margin = np.concatenate(residual_margin_predictions)
        residual_total = np.concatenate(residual_total_predictions)
        actual_residual_margin = residual_frame["target_home_margin"].to_numpy(float) - residual_margin
        actual_residual_total = residual_frame["target_total"].to_numpy(float) - residual_total
        base_sigma = float(np.std(actual_residual_margin))
        baseline = metrics(test, test_margin, test_total, base_sigma, test_margin)
        folds[season] = {"baseline": baseline, "candidates": {}}

        for variant, (columns, splines) in variants.items():
            x_train, x_test = context_matrix(
                residual_frame, test, residual_margin, test_margin,
                residual_total, test_total, columns, splines,
            )
            for alpha in RESIDUAL_ALPHAS:
                key = f"{variant}__alpha_{int(alpha)}"
                margin_beta = ridge(x_train, actual_residual_margin, alpha, False)
                total_beta = ridge(x_train, actual_residual_total, alpha, False)
                corrected_train_margin = residual_margin + apply_beta(x_train, margin_beta, False)
                corrected_margin = test_margin + apply_beta(x_test, margin_beta, False)
                corrected_total = test_total + apply_beta(x_test, total_beta, False)
                corrected_sigma = float(np.std(
                    residual_frame["target_home_margin"].to_numpy(float) - corrected_train_margin
                ))
                candidate = metrics(test, corrected_margin, corrected_total, corrected_sigma, test_margin)
                result = {
                    "variant": variant,
                    "alpha": alpha,
                    "columns": columns,
                    "splines": splines,
                    "metrics": candidate,
                    "delta": delta(candidate, baseline),
                }
                folds[season]["candidates"][key] = result
                candidate_results.setdefault(key, {})[season] = result

    eligible: list[tuple[float, str]] = []
    for key, by_season in candidate_results.items():
        if not all(season in by_season for season in SELECTION_SEASONS):
            continue
        passed = True
        scores = []
        for season in SELECTION_SEASONS:
            change = by_season[season]["delta"]
            if not (
                change["teamScoreMae"] < 0 and change["marginMae"] <= 0 and
                change["totalMae"] <= 0.10 and change["winnerBrier"] <= 0
            ):
                passed = False
            baseline = folds[season]["baseline"]
            candidate = by_season[season]["metrics"]
            scores.append(np.mean([
                candidate["teamScoreMae"] / baseline["teamScoreMae"],
                candidate["marginMae"] / baseline["marginMae"],
                candidate["totalMae"] / baseline["totalMae"],
                candidate["winnerBrier"] / baseline["winnerBrier"],
            ]))
        if passed:
            eligible.append((float(np.mean(scores)), key))
    eligible.sort()
    selected_key = eligible[0][1] if eligible else None

    report = {
        "release": RELEASE,
        "mode": "offline_research_only",
        "productionAuthority": False,
        "providerCalls": 0,
        "databaseReads": 0,
        "databaseWrites": 0,
        "featureRelease": FEATURE_RELEASE,
        "artifactReleaseReference": artifact["release"],
        "featureLedgerSha256": hashlib.sha256(options.features.read_bytes()).hexdigest(),
        "seasons": seasons,
        "boundary": {
            "baseRecipe": "ratings_schedule_ridge_alpha_1000_refit_inside_each_fold",
            "residualTraining": "rolling_origin_out_of_fold_base_residuals_only",
            "selectionSeasons": list(SELECTION_SEASONS),
            "replicationSeason": REPLICATION_SEASON,
            "replicationIsPristineHoldout": False,
            "marketInputs": False,
            "rosterResidualIncluded": False,
        },
        "contextGroups": groups,
        "selectionGate": {
            "teamScoreMae": "improve_each_selection_season",
            "marginMae": "nonworse_each_selection_season",
            "totalMae": "delta_at_most_0.10_each_selection_season",
            "winnerBrier": "nonworse_each_selection_season",
        },
        "selected": selected_key,
        "eligibleSelectionCandidates": [key for _, key in eligible],
        "folds": folds,
        "selectedReplication": None if selected_key is None else {
            "baseline": folds[REPLICATION_SEASON]["baseline"],
            "candidate": candidate_results[selected_key][REPLICATION_SEASON],
        },
        "interpretationBoundary": (
            "This audit identifies residual structure only. A 2025 replication win is not "
            "forward confirmation and cannot authorize a live or persisted shadow model."
        ),
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "report": str(options.output),
        "selected": selected_key,
        "eligible": len(eligible),
        "replication": report["selectedReplication"],
    }, indent=2))


if __name__ == "__main__":
    main()
