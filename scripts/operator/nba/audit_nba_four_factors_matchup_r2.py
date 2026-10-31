#!/usr/bin/env python3
"""Chronological NBA Four Factors matchup add-one audit.

Research-only. Refit the released independent recipe and two frozen direct
add-one candidates inside every fold. Do not touch providers, databases,
predictions, grades, locks, or any persisted shadow path.
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


RELEASE = "nba_four_factors_matchup_add_one_2026_10_29_r2"
FEATURE_RELEASE = "nba_point_in_time_features_2026_10_15_r13_season_regime_state"
ARTIFACT_RELEASE = "nba_professional_deployment_candidate_2026_10_15_r15_comparable_benchmark_gates"
LEDGER_SHA256 = "1d5b8f861950c83acfc7b4442e221cceb15c31754f41da12721f9a6f03b3449c"
BASE_ALPHA = 1_000.0
CANDIDATE_ALPHAS = (1_000.0, 10_000.0)
SELECTION_SEASONS = (2023, 2024)
REPLICATION_SEASON = 2025
BOOTSTRAP_SAMPLES = 2_000
BOOTSTRAP_SEED = 20_261_029
FOUR_FACTORS = ("efg", "turnover", "rebound", "free_throw")


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def load_jsonl(path: Path) -> pd.DataFrame:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != LEDGER_SHA256:
        raise ValueError(f"unexpected NBA feature ledger SHA-256: {digest}")
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    frame = pd.DataFrame(rows).sort_values(["feature_cutoff", "game_id"]).reset_index(drop=True)
    if frame.empty or set(frame["release"].unique()) != {FEATURE_RELEASE}:
        raise ValueError("NBA feature ledger is empty, mixed, or unsupported")
    if frame["game_id"].duplicated().any():
        raise ValueError("NBA feature ledger contains duplicate games")
    return frame


def numeric(frame: pd.DataFrame, name: str) -> pd.Series:
    if name not in frame:
        return pd.Series(np.nan, index=frame.index, dtype=float)
    return pd.to_numeric(frame[name], errors="coerce")


def add_blended_four_factor_features(frame: pd.DataFrame) -> list[str]:
    home_games = numeric(frame, "home_current_games")
    away_games = numeric(frame, "away_current_games")
    current_weight = np.minimum(np.minimum(home_games, away_games).clip(lower=0) / 15.0, 1.0)
    derived: list[str] = []
    for factor in FOUR_FACTORS:
        team_edges: dict[str, pd.Series] = {}
        for side in ("home", "away"):
            current = numeric(frame, f"matchup_{side}_{factor}_edge_15")
            prior = numeric(frame, f"matchup_{side}_{factor}_edge_prior")
            blended = current_weight * current + (1.0 - current_weight) * prior
            blended = blended.where(current.notna() & prior.notna(), current.where(current.notna(), prior))
            team_edges[side] = blended
        advantage = f"four_factor_{factor}_home_advantage"
        environment = f"four_factor_{factor}_environment"
        frame[advantage] = team_edges["home"] - team_edges["away"]
        frame[environment] = team_edges["home"] + team_edges["away"]
        derived.extend((advantage, environment))
    return derived


def ridge(x: np.ndarray, y: np.ndarray, alpha: float) -> np.ndarray:
    design = np.column_stack([x, np.ones(len(x))])
    penalty = np.eye(design.shape[1]) * alpha
    penalty[-1, -1] = 0.0
    return np.linalg.solve(design.T @ design + penalty, design.T @ y)


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
    indexes = [features.index(name) for name in missing_indicators if name in features]
    if indexes:
        train_values = np.column_stack([train_values, train_missing.iloc[:, indexes].to_numpy(float)])
        test_values = np.column_stack([test_values, test_missing.iloc[:, indexes].to_numpy(float)])
    means = train_values.mean(axis=0)
    scales = train_values.std(axis=0)
    scales[~np.isfinite(scales) | (scales < 1e-9)] = 1.0
    return (train_values - means) / scales, (test_values - means) / scales


def fit_predict(
    train: pd.DataFrame,
    test: pd.DataFrame,
    features: list[str],
    missing_indicators: list[str],
    alpha: float,
) -> tuple[np.ndarray, np.ndarray]:
    x_train, x_test = transform_fit(train, test, features, missing_indicators)
    margin_beta = ridge(x_train, train["target_home_margin"].to_numpy(float), alpha)
    total_beta = ridge(x_train, train["target_total"].to_numpy(float), alpha)
    design = np.column_stack([x_test, np.ones(len(x_test))])
    return design @ margin_beta, design @ total_beta


def rolling_oof_sigma(
    frame: pd.DataFrame,
    before_season: int,
    features: list[str],
    missing_indicators: list[str],
    alpha: float,
) -> float:
    residuals: list[np.ndarray] = []
    seasons = sorted(int(value) for value in frame["season"].unique())
    for season in seasons[1:]:
        if season >= before_season:
            break
        train = frame[frame["season"] < season]
        test = frame[frame["season"] == season]
        margin, _ = fit_predict(train, test, features, missing_indicators, alpha)
        residuals.append(test["target_home_margin"].to_numpy(float) - margin)
    if not residuals:
        raise ValueError(f"no rolling-origin scale rows before {before_season}")
    sigma = float(np.std(np.concatenate(residuals)))
    if not math.isfinite(sigma) or sigma <= 0:
        raise ValueError(f"invalid rolling-origin scale before {before_season}")
    return sigma


def normal_cdf(value: np.ndarray) -> np.ndarray:
    return np.vectorize(lambda item: 0.5 * (1.0 + math.erf(item / math.sqrt(2.0))))(value)


def mixture_cdf(value: np.ndarray, sigma: np.ndarray) -> np.ndarray:
    core = np.maximum(1e-6, sigma * 0.85)
    tail = np.maximum(1e-6, sigma * 2.5)
    return 0.85 * normal_cdf(value / core) + 0.15 * normal_cdf(value / tail)


def mixture_unit_quantile(probability: float) -> float:
    low, high = -10.0, 10.0
    unit = np.ones(1)
    for _ in range(80):
        middle = (low + high) / 2.0
        if float(mixture_cdf(np.array([middle]), unit)[0]) < probability:
            low = middle
        else:
            high = middle
    return (low + high) / 2.0


def per_game_errors(frame: pd.DataFrame, margin: np.ndarray, total: np.ndarray) -> dict[str, np.ndarray]:
    actual_margin = frame["target_home_margin"].to_numpy(float)
    actual_total = frame["target_total"].to_numpy(float)
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    predicted_home = (total + margin) / 2.0
    predicted_away = (total - margin) / 2.0
    return {
        "teamScoreMae": (np.abs(predicted_home - actual_home) + np.abs(predicted_away - actual_away)) / 2.0,
        "marginMae": np.abs(margin - actual_margin),
        "totalMae": np.abs(total - actual_total),
    }


def metrics(
    frame: pd.DataFrame,
    margin: np.ndarray,
    total: np.ndarray,
    sigma: np.ndarray,
    incumbent_margin: np.ndarray,
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
    coverage: dict[str, float] = {}
    for level in (0.80, 0.90, 0.95):
        radius = mixture_unit_quantile((1.0 + level) / 2.0) * sigma
        coverage[str(level)] = float(np.mean(np.abs(actual_margin - margin) <= radius))
    bands: dict[str, Any] = {}
    absolute_incumbent = np.abs(incumbent_margin)
    for name, lower, upper in (("0_2", 0, 2), ("2_5", 2, 5), ("5_10", 5, 10), ("10_plus", 10, math.inf)):
        selected = (absolute_incumbent >= lower) & (absolute_incumbent < upper)
        if selected.any():
            bands[name] = {
                "games": int(selected.sum()),
                "marginMae": float(np.mean(np.abs(margin[selected] - actual_margin[selected]))),
                "winnerAccuracy": float(np.mean((margin[selected] > 0) == (actual_margin[selected] > 0))),
            }
    return {
        "games": len(frame),
        "teamScoreMae": float(np.mean((np.abs(predicted_home - actual_home) + np.abs(predicted_away - actual_away)) / 2.0)),
        "teamScoreRmse": float(np.sqrt(np.mean(((predicted_home - actual_home) ** 2 + (predicted_away - actual_away) ** 2) / 2.0))),
        "marginMae": float(np.mean(np.abs(margin - actual_margin))),
        "marginRmse": float(np.sqrt(np.mean((margin - actual_margin) ** 2))),
        "totalMae": float(np.mean(np.abs(total - actual_total))),
        "totalRmse": float(np.sqrt(np.mean((total - actual_total) ** 2))),
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
        "marginIntervalCoverage": coverage,
        "incumbentMarginBands": bands,
    }


def metric_delta(candidate: dict[str, Any], baseline: dict[str, Any]) -> dict[str, float]:
    names = (
        "teamScoreMae", "teamScoreRmse", "marginMae", "marginRmse", "totalMae", "totalRmse",
        "winnerAccuracy", "winnerBrier", "winnerLogLoss", "tail20Brier",
    )
    return {name: float(candidate[name] - baseline[name]) for name in names}


def paired_interval(candidate: np.ndarray, baseline: np.ndarray, seed: int) -> dict[str, float]:
    differences = candidate - baseline
    rng = np.random.default_rng(seed)
    draws = np.empty(BOOTSTRAP_SAMPLES)
    for index in range(BOOTSTRAP_SAMPLES):
        sample = rng.integers(0, len(differences), len(differences))
        draws[index] = float(np.mean(differences[sample]))
    return {
        "delta": float(np.mean(differences)),
        "lower95": float(np.quantile(draws, 0.025)),
        "upper95": float(np.quantile(draws, 0.975)),
        "samples": BOOTSTRAP_SAMPLES,
    }


def concatenate_folds(folds: list[dict[str, Any]], key: str) -> np.ndarray:
    return np.concatenate([fold[key] for fold in folds])


def evaluate(
    frame: pd.DataFrame,
    seasons: tuple[int, ...],
    features: list[str],
    missing: list[str],
    alpha: float,
    baseline_folds: dict[int, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for season in seasons:
        train = frame[frame["season"] < season]
        test = frame[frame["season"] == season].reset_index(drop=True)
        margin, total = fit_predict(train, test, features, missing, alpha)
        sigma = rolling_oof_sigma(frame, season, features, missing, alpha)
        incumbent = margin if baseline_folds is None else baseline_folds[season]["margin"]
        output.append({
            "season": season,
            "frame": test,
            "margin": margin,
            "total": total,
            "sigma": np.full(len(test), sigma),
            "metrics": metrics(test, margin, total, np.full(len(test), sigma), incumbent),
        })
    return output


def serializable_fold(fold: dict[str, Any]) -> dict[str, Any]:
    return {
        "season": fold["season"],
        "games": len(fold["frame"]),
        "rollingOriginMarginSigma": float(fold["sigma"][0]),
        "metrics": fold["metrics"],
    }


def main() -> None:
    options = arguments()
    frame = load_jsonl(options.features)
    artifact = json.loads(options.artifact.read_text())
    if artifact.get("release") != ARTIFACT_RELEASE:
        raise ValueError(f"unexpected incumbent artifact: {artifact.get('release')}")
    for target in ("target_home_score", "target_away_score", "target_home_margin", "target_total"):
        frame[target] = pd.to_numeric(frame[target], errors="raise")
    seasons = sorted(int(value) for value in frame["season"].unique())
    if seasons != [2021, 2022, 2023, 2024, 2025]:
        raise ValueError(f"unexpected NBA seasons: {seasons}")

    base_features = list(artifact["design"]["features"])
    base_missing = list(artifact["design"]["missingIndicatorColumns"])
    derived = add_blended_four_factor_features(frame)
    coverage = {name: float(frame[name].notna().mean()) for name in derived}
    candidate_features = [*base_features, *derived]
    candidate_missing = [*base_missing, *derived]

    baseline_list = evaluate(frame, SELECTION_SEASONS, base_features, base_missing, BASE_ALPHA)
    baseline_by_season = {fold["season"]: fold for fold in baseline_list}
    pooled_frame = pd.concat([fold["frame"] for fold in baseline_list], ignore_index=True)
    base_margin = concatenate_folds(baseline_list, "margin")
    base_total = concatenate_folds(baseline_list, "total")
    base_sigma = concatenate_folds(baseline_list, "sigma")
    baseline_pooled = metrics(pooled_frame, base_margin, base_total, base_sigma, base_margin)
    base_errors = per_game_errors(pooled_frame, base_margin, base_total)

    candidates: dict[str, Any] = {}
    eligible: list[str] = []
    for candidate_index, alpha in enumerate(CANDIDATE_ALPHAS):
        key = f"four_factors_blended_matchup__alpha_{int(alpha)}"
        candidate_list = evaluate(
            frame, SELECTION_SEASONS, candidate_features, candidate_missing, alpha, baseline_by_season,
        )
        candidate_margin = concatenate_folds(candidate_list, "margin")
        candidate_total = concatenate_folds(candidate_list, "total")
        candidate_sigma = concatenate_folds(candidate_list, "sigma")
        candidate_pooled = metrics(
            pooled_frame, candidate_margin, candidate_total, candidate_sigma, base_margin,
        )
        candidate_errors = per_game_errors(pooled_frame, candidate_margin, candidate_total)
        intervals = {
            name: paired_interval(candidate_errors[name], base_errors[name], BOOTSTRAP_SEED + candidate_index * 10 + offset)
            for offset, name in enumerate(("teamScoreMae", "marginMae", "totalMae"))
        }
        delta = metric_delta(candidate_pooled, baseline_pooled)
        season_deltas = {
            str(fold["season"]): metric_delta(fold["metrics"], baseline_by_season[fold["season"]]["metrics"])
            for fold in candidate_list
        }
        cohort_gates: dict[str, Any] = {}
        cohorts_pass = True
        for name, base_band in baseline_pooled["incumbentMarginBands"].items():
            candidate_band = candidate_pooled["incumbentMarginBands"][name]
            gated = base_band["games"] >= 150
            margin_change = candidate_band["marginMae"] - base_band["marginMae"]
            direction_change = candidate_band["winnerAccuracy"] - base_band["winnerAccuracy"]
            passed = (not gated) or (margin_change <= 0.5 and direction_change >= -0.02)
            cohorts_pass = cohorts_pass and passed
            cohort_gates[name] = {
                "games": base_band["games"],
                "gated": gated,
                "marginMaeDelta": margin_change,
                "winnerAccuracyDelta": direction_change,
                "passed": passed,
            }
        coverage_gates: dict[str, Any] = {}
        coverage_pass = True
        for level in ("0.8", "0.9", "0.95"):
            nominal = float(level)
            base_error = abs(baseline_pooled["marginIntervalCoverage"][level] - nominal)
            candidate_error = abs(candidate_pooled["marginIntervalCoverage"][level] - nominal)
            passed = candidate_error - base_error <= 0.02
            coverage_pass = coverage_pass and passed
            coverage_gates[level] = {
                "baselineAbsoluteError": base_error,
                "candidateAbsoluteError": candidate_error,
                "degradation": candidate_error - base_error,
                "passed": passed,
            }
        gates = {
            "teamScoreMae": delta["teamScoreMae"] <= -0.10 and intervals["teamScoreMae"]["upper95"] < 0,
            "marginMae": delta["marginMae"] <= 0 and intervals["marginMae"]["upper95"] < 0.10,
            "totalMae": delta["totalMae"] <= 0 and intervals["totalMae"]["upper95"] < 0.10,
            "winnerBrier": delta["winnerBrier"] <= 0,
            "winnerLogLoss": delta["winnerLogLoss"] <= 0,
            "winnerAccuracy": delta["winnerAccuracy"] >= -0.005,
            "compressionSlope": abs(candidate_pooled["actualOnPredictedMarginSlope"] - 1) < abs(baseline_pooled["actualOnPredictedMarginSlope"] - 1),
            "tail20Brier": delta["tail20Brier"] <= 0,
            "intervalCoverage": coverage_pass,
            "cohorts": cohorts_pass,
            "eachSelectionSeason": all(
                change["teamScoreMae"] < 0 and change["marginMae"] < 0.10 and change["totalMae"] < 0.10
                for change in season_deltas.values()
            ),
        }
        passed = all(gates.values())
        if passed:
            eligible.append(key)
        candidates[key] = {
            "alpha": alpha,
            "features": derived,
            "folds": [serializable_fold(fold) for fold in candidate_list],
            "pooledMetrics": candidate_pooled,
            "pooledDelta": delta,
            "pairedBootstrap": intervals,
            "seasonDeltas": season_deltas,
            "cohortGates": cohort_gates,
            "coverageGates": coverage_gates,
            "gates": gates,
            "passed": passed,
        }

    eligible.sort(key=lambda key: (
        candidates[key]["pooledMetrics"]["teamScoreMae"],
        candidates[key]["pooledMetrics"]["marginMae"],
        candidates[key]["pooledMetrics"]["totalMae"],
        candidates[key]["pooledMetrics"]["winnerBrier"],
        -candidates[key]["alpha"],
    ))
    selected = eligible[0] if eligible else None
    replication: dict[str, Any] | None = None
    if selected is not None:
        selected_alpha = float(candidates[selected]["alpha"])
        baseline_replication = evaluate(
            frame, (REPLICATION_SEASON,), base_features, base_missing, BASE_ALPHA,
        )[0]
        candidate_replication = evaluate(
            frame, (REPLICATION_SEASON,), candidate_features, candidate_missing,
            selected_alpha, {REPLICATION_SEASON: baseline_replication},
        )[0]
        replication = {
            "season": REPLICATION_SEASON,
            "pristineHoldout": False,
            "baseline": serializable_fold(baseline_replication),
            "candidate": serializable_fold(candidate_replication),
            "delta": metric_delta(candidate_replication["metrics"], baseline_replication["metrics"]),
        }

    report = {
        "release": RELEASE,
        "mode": "offline_research_only",
        "productionAuthority": False,
        "providerCalls": 0,
        "databaseReads": 0,
        "databaseWrites": 0,
        "featureRelease": FEATURE_RELEASE,
        "featureLedgerSha256": LEDGER_SHA256,
        "artifactReleaseReference": ARTIFACT_RELEASE,
        "seasons": seasons,
        "selectionSeasons": list(SELECTION_SEASONS),
        "replicationSeason": REPLICATION_SEASON,
        "replicationScored": selected is not None,
        "derivedFeatureCoverage": coverage,
        "baseline": {
            "alpha": BASE_ALPHA,
            "features": base_features,
            "folds": [serializable_fold(fold) for fold in baseline_list],
            "pooledMetrics": baseline_pooled,
        },
        "candidates": candidates,
        "eligible": eligible,
        "selected": selected,
        "replication": replication,
        "interpretationBoundary": (
            "A historical pass would still be opened replication evidence only. This report cannot "
            "change a live model, score, prediction, grade, stake, lock, or persisted shadow row."
        ),
    }
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "report": str(options.output),
        "selected": selected,
        "eligible": eligible,
        "replicationScored": selected is not None,
        "candidateGateFailures": {
            key: [name for name, passed in value["gates"].items() if not passed]
            for key, value in candidates.items()
        },
    }, indent=2))


if __name__ == "__main__":
    main()
