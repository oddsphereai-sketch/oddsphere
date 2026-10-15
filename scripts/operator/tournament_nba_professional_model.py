#!/usr/bin/env python3
"""Chronological NBA independent-score tournament.

This research-only operator consumes the leakage-safe feature JSONL. It selects
one candidate on the penultimate season, refits on training plus selection, and
opens the final confirmation season once. It never writes production tables or
runtime artifacts.
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


RELEASE = "nba_professional_tournament_2026_10_15_r5_bounded_model_stability"
FEATURE_RELEASE = "nba_point_in_time_features_2026_10_15_r3"
R1_CONFIRMATION = {
    "season": 2025,
    "games": 1230,
    "teamScoreMae": 9.6001,
    "marginMae": 10.9252,
    "totalMae": 15.6065,
    "winnerAccuracy": 0.6480,
}
TARGETS = [
    "target_home_score",
    "target_away_score",
    "target_home_margin",
    "target_total",
    "target_home_win",
]
IDENTITY = [
    "release",
    "game_id",
    "season",
    "feature_cutoff",
    "home_team_id",
    "away_team_id",
    "home_team",
    "away_team",
]
EVALUATION_ONLY = [
    # Optional timestamp-valid market benchmark. This may segment and score
    # independent forecasts, but it is never eligible to enter a feature set.
    "evaluation_opening_market_home_probability",
    "evaluation_opening_home_spread",
    "evaluation_opening_home_cover_probability",
    "evaluation_opening_total",
    "evaluation_opening_over_probability",
]
EVALUATION_PROBABILITIES = [
    "evaluation_opening_market_home_probability",
    "evaluation_opening_home_cover_probability",
    "evaluation_opening_over_probability",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--selection-season", type=int)
    parser.add_argument("--confirmation-season", type=int)
    return parser.parse_args()


def read_jsonl(path: Path) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    with path.open() as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            value = json.loads(line)
            if not isinstance(value, dict):
                raise ValueError(f"{path}:{line_number} is not an object")
            rows.append(value)
    if not rows:
        raise ValueError("NBA feature file is empty")
    return pd.DataFrame(rows)


def validate(frame: pd.DataFrame) -> pd.DataFrame:
    required = set(IDENTITY + TARGETS)
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"NBA feature file is missing columns: {sorted(missing)}")
    if set(frame["release"].unique()) != {FEATURE_RELEASE}:
        raise ValueError("NBA feature release is mixed or unsupported")
    if frame["game_id"].duplicated().any():
        raise ValueError("NBA feature file contains duplicate games")
    frame = frame.copy()
    frame["feature_cutoff"] = pd.to_datetime(frame["feature_cutoff"], utc=True, errors="raise")
    frame = frame.sort_values(["feature_cutoff", "game_id"]).reset_index(drop=True)
    for target in TARGETS:
        frame[target] = pd.to_numeric(frame[target], errors="raise")
    for column in EVALUATION_ONLY:
        if column not in frame:
            continue
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    for column in EVALUATION_PROBABILITIES:
        if column not in frame:
            continue
        present = frame[column].dropna()
        if (present <= 0).any() or (present >= 1).any():
            raise ValueError(f"NBA evaluation probability {column} must be strictly between zero and one")
    if not np.allclose(
        frame["target_home_score"] - frame["target_away_score"],
        frame["target_home_margin"],
    ):
        raise ValueError("NBA target margin is incoherent with team scores")
    if not np.allclose(
        frame["target_home_score"] + frame["target_away_score"],
        frame["target_total"],
    ):
        raise ValueError("NBA target total is incoherent with team scores")
    return frame


def feature_catalog(frame: pd.DataFrame) -> dict[str, list[str]]:
    numeric = [
        column for column in frame.columns
        if column not in IDENTITY + TARGETS + EVALUATION_ONLY and pd.api.types.is_numeric_dtype(frame[column])
    ]

    def chosen(tokens: tuple[str, ...]) -> list[str]:
        return [column for column in numeric if any(token in column for token in tokens)]

    ratings = chosen(("league_off_rating", "adjusted_", "offRating_", "defRating_", "pace_", "current_games", "prior_games"))
    schedule = chosen(("rest_days", "back_to_back", "games_last_4_days", "games_last_7_days"))
    four_factors = chosen(("efg_", "turnoverRate_", "offensiveReboundRate_", "freeThrowRate_", "opponent"))
    volatility = chosen(("margin_sd_", "total_rating_sd_"))
    rotation = chosen(("rotationPlayers_", "top3MinutesShare_", "top8MinutesShare_", "rotationMinutesEntropy_"))
    tracking_style = chosen((
        "pointsPaintShare_", "pointsFastBreakShare_", "pointsSecondChanceShare_",
        "pointsOffTurnoversShare_", "passesPer100_", "touchesPer100_",
        "secondaryAssistsPer100_", "screenAssistPointsPer100_", "deflectionsPer100_",
        "contestedShotsPer100_", "defendedAtRimAttemptsPer100_", "defendedAtRimFgPct_",
        "reboundChancesPer100_", "rotationEstimatedNetRating_", "usageWeighted_",
        "usageMax_", "usageConcentration_", "distancePer48_", "speedWeighted_",
    ))
    groups = {
        "ratings": sorted(set(ratings)),
        "ratings_schedule": sorted(set(ratings + schedule)),
        "four_factors_schedule": sorted(set(ratings + schedule + four_factors + volatility)),
        "all_declared": sorted(set(
            ratings + schedule + four_factors + volatility + rotation + tracking_style
        )),
    }
    for name, columns in groups.items():
        if not columns:
            raise ValueError(f"NBA feature group {name} is empty")
    return groups


def candidate_model_specs() -> list[dict[str, Any]]:
    """Return the predeclared, bounded-complexity estimator grid."""
    return [
        *[{"family": "ridge", "alpha": alpha} for alpha in (0.1, 1.0, 10.0, 100.0, 1000.0)],
        {"family": "huber_ridge", "alpha": 1.0, "epsilon": 1.35},
        {"family": "huber_ridge", "alpha": 10.0, "epsilon": 1.75},
        {"family": "spline_ridge", "alpha": 10.0, "knots": [0.75]},
        {"family": "spline_ridge", "alpha": 100.0, "knots": [0.75, 1.5]},
    ]


def design_matrices(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    features: list[str],
    model: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    raw_train = train[features].to_numpy(float)
    raw_evaluate = evaluate[features].to_numpy(float)
    missing_columns = np.isnan(raw_train).any(axis=0)
    medians = np.nanmedian(raw_train, axis=0)
    medians = np.where(np.isfinite(medians), medians, 0.0)
    train_missing = np.isnan(raw_train)
    evaluate_missing = np.isnan(raw_evaluate)
    x_train = np.where(train_missing, medians, raw_train)
    x_evaluate = np.where(evaluate_missing, medians, raw_evaluate)
    if missing_columns.any():
        x_train = np.column_stack([x_train, train_missing[:, missing_columns].astype(float)])
        x_evaluate = np.column_stack([x_evaluate, evaluate_missing[:, missing_columns].astype(float)])
    means = x_train.mean(axis=0)
    deviations = x_train.std(axis=0)
    deviations = np.where(deviations > 1e-12, deviations, 1.0)
    x_train = (x_train - means) / deviations
    x_evaluate = (x_evaluate - means) / deviations
    if model["family"] == "spline_ridge":
        base_train = np.clip(x_train, -5.0, 5.0)
        base_evaluate = np.clip(x_evaluate, -5.0, 5.0)
        train_parts = [base_train]
        evaluate_parts = [base_evaluate]
        for knot in model["knots"]:
            threshold = float(knot)
            train_parts.extend([
                np.maximum(0.0, base_train - threshold),
                np.maximum(0.0, -base_train - threshold),
            ])
            evaluate_parts.extend([
                np.maximum(0.0, base_evaluate - threshold),
                np.maximum(0.0, -base_evaluate - threshold),
            ])
        x_train = np.column_stack(train_parts)
        x_evaluate = np.column_stack(evaluate_parts)
    return x_train, x_evaluate, {
        "features": features,
        "missingIndicatorColumns": [features[index] for index in np.flatnonzero(missing_columns)],
        "designColumns": int(x_train.shape[1]),
    }


def solve_ridge(
    x: np.ndarray,
    y: np.ndarray,
    alpha: float,
    weights: np.ndarray | None = None,
) -> np.ndarray:
    design = np.column_stack([x, np.ones(len(x))])
    if weights is None:
        weighted_design = design
        weighted_y = y
    else:
        root = np.sqrt(weights)
        weighted_design = design * root[:, None]
        weighted_y = y * root
    penalty = np.eye(design.shape[1]) * alpha
    penalty[-1, -1] = 0.0
    system = weighted_design.T @ weighted_design + penalty
    target = weighted_design.T @ weighted_y
    try:
        return np.linalg.solve(system, target)
    except np.linalg.LinAlgError:
        return np.linalg.pinv(system) @ target


def fit_regressor(
    x_train: np.ndarray,
    y_train: np.ndarray,
    model: dict[str, Any],
) -> np.ndarray:
    coefficients = solve_ridge(x_train, y_train, float(model["alpha"]))
    if model["family"] != "huber_ridge":
        return coefficients
    design = np.column_stack([x_train, np.ones(len(x_train))])
    epsilon = float(model["epsilon"])
    for _ in range(50):
        residual = y_train - design @ coefficients
        center = np.median(residual)
        scale = 1.4826 * np.median(np.abs(residual - center))
        if not np.isfinite(scale) or scale <= 1e-9:
            break
        standardized = np.abs(residual - center) / scale
        weights = np.ones(len(residual))
        outliers = standardized > epsilon
        weights[outliers] = epsilon / standardized[outliers]
        updated = solve_ridge(x_train, y_train, float(model["alpha"]), weights)
        if np.max(np.abs(updated - coefficients)) < 1e-7:
            coefficients = updated
            break
        coefficients = updated
    return coefficients


def predict_regressor(x: np.ndarray, coefficients: np.ndarray) -> np.ndarray:
    return np.column_stack([x, np.ones(len(x))]) @ coefficients


def fit_predict(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    features: list[str],
    model: dict[str, Any],
    architecture: str,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    x_train, x_evaluate, design = design_matrices(train, evaluate, features, model)
    models: dict[str, Any] = {"design": design, "model": model}
    if architecture == "team_scores":
        for target in ("target_home_score", "target_away_score"):
            models[target] = fit_regressor(x_train, train[target].to_numpy(float), model)
        home = predict_regressor(x_evaluate, models["target_home_score"])
        away = predict_regressor(x_evaluate, models["target_away_score"])
        return home, away, models
    if architecture == "margin_total":
        for target in ("target_home_margin", "target_total"):
            models[target] = fit_regressor(x_train, train[target].to_numpy(float), model)
        margin = predict_regressor(x_evaluate, models["target_home_margin"])
        total = predict_regressor(x_evaluate, models["target_total"])
        return (total + margin) / 2, (total - margin) / 2, models
    raise ValueError(f"unsupported architecture {architecture}")


def normal_cdf(values: np.ndarray) -> np.ndarray:
    erf = np.vectorize(math.erf)
    return 0.5 * (1.0 + erf(values / math.sqrt(2.0)))


def metrics(
    frame: pd.DataFrame,
    home: np.ndarray,
    away: np.ndarray,
    margin_sigma: float,
    total_sigma: float,
) -> dict[str, Any]:
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    actual_margin = actual_home - actual_away
    actual_total = actual_home + actual_away
    predicted_margin = home - away
    predicted_total = home + away
    probabilities = np.clip(normal_cdf(predicted_margin / max(margin_sigma, 1e-6)), 0.001, 0.999)
    outcomes = (actual_margin > 0).astype(float)
    bins = np.minimum((probabilities * 10).astype(int), 9)
    calibration = []
    for bucket in range(10):
        keep = bins == bucket
        if keep.any():
            calibration.append({
                "lower": bucket / 10,
                "upper": (bucket + 1) / 10,
                "games": int(keep.sum()),
                "meanProbability": float(probabilities[keep].mean()),
                "winRate": float(outcomes[keep].mean()),
            })
    upset = None
    market_column = "evaluation_opening_market_home_probability"
    if market_column in frame:
        market_home = frame[market_column].to_numpy(float)
        available = np.isfinite(market_home) & (market_home != 0.5)
        if available.any():
            favorite_home = market_home[available] > 0.5
            actual_home_win = outcomes[available] > 0.5
            predicted_home_win = probabilities[available] >= 0.5
            actual_upset = actual_home_win != favorite_home
            predicted_upset = predicted_home_win != favorite_home
            correct_upsets = actual_upset & predicted_upset & (predicted_home_win == actual_home_win)
            false_upsets = predicted_upset & ~actual_upset
            favorite_strength = np.maximum(market_home[available], 1 - market_home[available])
            strength_bands = []
            for lower, upper in ((0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 1.0)):
                keep = (favorite_strength >= lower) & (favorite_strength < upper)
                if keep.any():
                    strength_bands.append({
                        "lower": lower,
                        "upper": upper,
                        "games": int(keep.sum()),
                        "actualUpsets": int(actual_upset[keep].sum()),
                        "predictedUpsets": int(predicted_upset[keep].sum()),
                        "winnerAccuracy": float((predicted_home_win[keep] == actual_home_win[keep]).mean()),
                        "homeWinBrier": float(np.square(probabilities[available][keep] - actual_home_win[keep]).mean()),
                    })
            upset = {
                "benchmark": "opening_market_no_vig_evaluation_only",
                "games": int(available.sum()),
                "actualUpsets": int(actual_upset.sum()),
                "predictedUpsets": int(predicted_upset.sum()),
                "correctUpsets": int(correct_upsets.sum()),
                "underdogWinRecall": (
                    float(correct_upsets.sum() / actual_upset.sum()) if actual_upset.any() else None
                ),
                "falseUpsetRate": (
                    float(false_upsets.sum() / predicted_upset.sum()) if predicted_upset.any() else None
                ),
                "favoriteStrengthBands": strength_bands,
            }
    market_evaluation: dict[str, Any] = {}
    spread_column = "evaluation_opening_home_spread"
    if spread_column in frame:
        spread = frame[spread_column].to_numpy(float)
        available = np.isfinite(spread) & ~np.isclose(actual_margin + spread, 0.0)
        if available.any():
            model_probability = np.clip(normal_cdf(
                (predicted_margin[available] + spread[available]) / max(margin_sigma, 1e-6)
            ), 0.001, 0.999)
            outcome = (actual_margin[available] + spread[available] > 0).astype(float)
            market_evaluation["spread"] = {
                "games": int(available.sum()),
                "directionAccuracy": float(((model_probability >= 0.5) == (outcome > 0.5)).mean()),
                "brier": float(np.square(model_probability - outcome).mean()),
            }
    total_column = "evaluation_opening_total"
    if total_column in frame:
        line = frame[total_column].to_numpy(float)
        available = np.isfinite(line) & ~np.isclose(actual_total - line, 0.0)
        if available.any():
            model_probability = np.clip(normal_cdf(
                (predicted_total[available] - line[available]) / max(total_sigma, 1e-6)
            ), 0.001, 0.999)
            outcome = (actual_total[available] > line[available]).astype(float)
            market_evaluation["total"] = {
                "games": int(available.sum()),
                "directionAccuracy": float(((model_probability >= 0.5) == (outcome > 0.5)).mean()),
                "brier": float(np.square(model_probability - outcome).mean()),
            }
    return {
        "games": int(len(frame)),
        "teamScoreMae": float((np.abs(home - actual_home).mean() + np.abs(away - actual_away).mean()) / 2),
        "teamScoreRmse": float(math.sqrt((np.square(home - actual_home).mean() + np.square(away - actual_away).mean()) / 2)),
        "marginMae": float(np.abs(predicted_margin - actual_margin).mean()),
        "marginRmse": float(math.sqrt(np.square(predicted_margin - actual_margin).mean())),
        "totalMae": float(np.abs(predicted_total - actual_total).mean()),
        "totalRmse": float(math.sqrt(np.square(predicted_total - actual_total).mean())),
        "winnerAccuracy": float((np.sign(predicted_margin) == np.sign(actual_margin)).mean()),
        "homeWinBrier": float(np.square(probabilities - outcomes).mean()),
        "homeWinLogLoss": float(-(outcomes * np.log(probabilities) + (1 - outcomes) * np.log(1 - probabilities)).mean()),
        "meanPredictedHomeWinProbability": float(probabilities.mean()),
        "homeWinRate": float(outcomes.mean()),
        "calibration": calibration,
        "upsetEvaluation": upset,
        "openingMarketEvaluation": market_evaluation or None,
    }


def finite_float(value: Any) -> float | None:
    """Return a JSON-safe finite float without inventing a missing value."""
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def selected_feature_state(row: pd.Series, features: list[str]) -> dict[str, float | None]:
    return {feature: finite_float(row.get(feature)) for feature in features}


def build_prediction_ledger(
    frame: pd.DataFrame,
    home: np.ndarray,
    away: np.ndarray,
    margin_sigma: float,
    total_sigma: float,
    selected_features: list[str],
    audit_features: list[str] | None = None,
    baseline_home: np.ndarray | None = None,
    baseline_away: np.ndarray | None = None,
) -> list[dict[str, Any]]:
    """Persist enough row-level evidence to reproduce every aggregate claim.

    Cause labels here describe observable disagreement only. They deliberately do
    not call an error "luck"; that requires timestamp-valid postgame component
    evidence (shooting, turnovers, availability, and rotation realization).
    """
    records: list[dict[str, Any]] = []
    reset = frame.reset_index(drop=True)
    for index, row in reset.iterrows():
        predicted_home = float(home[index])
        predicted_away = float(away[index])
        predicted_margin = predicted_home - predicted_away
        predicted_total = predicted_home + predicted_away
        actual_home = float(row["target_home_score"])
        actual_away = float(row["target_away_score"])
        actual_margin = actual_home - actual_away
        actual_total = actual_home + actual_away
        margin_error = predicted_margin - actual_margin
        total_error = predicted_total - actual_total
        home_error = predicted_home - actual_home
        away_error = predicted_away - actual_away
        predicted_home_win_probability = float(np.clip(
            normal_cdf(np.array([predicted_margin / max(margin_sigma, 1e-6)]))[0],
            0.001,
            0.999,
        ))
        predicted_home_win = predicted_margin > 0
        actual_home_win = actual_margin > 0
        winner_correct = predicted_home_win == actual_home_win

        market_home_probability = finite_float(row.get("evaluation_opening_market_home_probability"))
        opening_home_spread = finite_float(row.get("evaluation_opening_home_spread"))
        opening_total = finite_float(row.get("evaluation_opening_total"))
        spread_edge = None if opening_home_spread is None else predicted_margin + opening_home_spread
        spread_result = None if opening_home_spread is None else actual_margin + opening_home_spread
        total_edge = None if opening_total is None else predicted_total - opening_total
        total_result = None if opening_total is None else actual_total - opening_total

        error_context = "winner_correct"
        if not winner_correct:
            if market_home_probability is None or math.isclose(market_home_probability, 0.5):
                error_context = "winner_wrong_market_benchmark_unavailable"
            else:
                market_home_favorite = market_home_probability > 0.5
                error_context = (
                    "model_and_opening_market_favorite_lost"
                    if predicted_home_win == market_home_favorite
                    else "model_upset_call_failed"
                )

        baseline = None
        if baseline_home is not None and baseline_away is not None:
            baseline_predicted_home = float(baseline_home[index])
            baseline_predicted_away = float(baseline_away[index])
            baseline_margin = baseline_predicted_home - baseline_predicted_away
            baseline_total = baseline_predicted_home + baseline_predicted_away
            baseline = {
                "predictedHome": baseline_predicted_home,
                "predictedAway": baseline_predicted_away,
                "predictedMargin": baseline_margin,
                "predictedTotal": baseline_total,
                "marginAbsoluteError": abs(baseline_margin - actual_margin),
                "totalAbsoluteError": abs(baseline_total - actual_total),
                "winnerCorrect": (baseline_margin > 0) == actual_home_win,
            }

        records.append({
            "gameId": int(row["game_id"]),
            "season": int(row["season"]),
            "featureCutoff": row["feature_cutoff"].isoformat(),
            "homeTeam": {"id": int(row["home_team_id"]), "name": str(row["home_team"])},
            "awayTeam": {"id": int(row["away_team_id"]), "name": str(row["away_team"])},
            "prediction": {
                "homeScore": predicted_home,
                "awayScore": predicted_away,
                "homeMargin": predicted_margin,
                "total": predicted_total,
                "homeWinProbability": predicted_home_win_probability,
                "winner": "home" if predicted_home_win else "away",
            },
            "actual": {
                "homeScore": actual_home,
                "awayScore": actual_away,
                "homeMargin": actual_margin,
                "total": actual_total,
                "winner": "home" if actual_home_win else "away",
            },
            "error": {
                "homeScoreSigned": home_error,
                "awayScoreSigned": away_error,
                "homeScoreAbsolute": abs(home_error),
                "awayScoreAbsolute": abs(away_error),
                "marginSigned": margin_error,
                "marginAbsolute": abs(margin_error),
                "totalSigned": total_error,
                "totalAbsolute": abs(total_error),
                "winnerCorrect": winner_correct,
            },
            "openingMarketEvaluationOnly": {
                "homeWinProbability": market_home_probability,
                "homeSpread": opening_home_spread,
                "total": opening_total,
                "spreadModelSide": None if spread_edge is None else ("home" if spread_edge > 0 else "away"),
                "spreadResultSide": None if spread_result is None or math.isclose(spread_result, 0) else ("home" if spread_result > 0 else "away"),
                "spreadDirectionCorrect": None if spread_edge is None or spread_result is None or math.isclose(spread_result, 0) else (spread_edge > 0) == (spread_result > 0),
                "totalModelSide": None if total_edge is None else ("over" if total_edge > 0 else "under"),
                "totalResultSide": None if total_result is None or math.isclose(total_result, 0) else ("over" if total_result > 0 else "under"),
                "totalDirectionCorrect": None if total_edge is None or total_result is None or math.isclose(total_result, 0) else (total_edge > 0) == (total_result > 0),
                "totalModelProbability": None if total_edge is None else float(np.clip(
                    normal_cdf(np.array([total_edge / max(total_sigma, 1e-6)]))[0], 0.001, 0.999,
                )),
            },
            "ratingBaseline": baseline,
            "errorContext": error_context,
            "causeAttribution": {
                "status": "not_attributed",
                "reason": "requires timestamp-valid postgame component evidence; result surprise alone is not evidence of luck",
            },
            "selectedFeatureState": selected_feature_state(row, selected_features),
            "auditFeatureState": selected_feature_state(row, audit_features or selected_features),
        })
    return records


def summarize_records(records: list[dict[str, Any]]) -> dict[str, Any]:
    if not records:
        return {"games": 0}
    home_errors = np.array([row["error"]["homeScoreSigned"] for row in records], dtype=float)
    away_errors = np.array([row["error"]["awayScoreSigned"] for row in records], dtype=float)
    margin_errors = np.array([row["error"]["marginSigned"] for row in records], dtype=float)
    total_errors = np.array([row["error"]["totalSigned"] for row in records], dtype=float)
    winner = np.array([row["error"]["winnerCorrect"] for row in records], dtype=bool)
    return {
        "games": len(records),
        "homeScoreSignedBias": float(home_errors.mean()),
        "awayScoreSignedBias": float(away_errors.mean()),
        "teamScoreSignedBias": float(np.concatenate([home_errors, away_errors]).mean()),
        "teamScoreMae": float(np.concatenate([np.abs(home_errors), np.abs(away_errors)]).mean()),
        "marginSignedBias": float(margin_errors.mean()),
        "marginMae": float(np.abs(margin_errors).mean()),
        "totalSignedBias": float(total_errors.mean()),
        "totalMae": float(np.abs(total_errors).mean()),
        "winnerAccuracy": float(winner.mean()),
        "winnerErrors": int((~winner).sum()),
        "marginOvershootRate": float((margin_errors > 0).mean()),
        "totalOvershootRate": float((total_errors > 0).mean()),
    }


def cohort_report(records: list[dict[str, Any]], key) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        label = key(record)
        if label is None:
            continue
        grouped.setdefault(str(label), []).append(record)
    return [
        {"cohort": label, **summarize_records(grouped[label])}
        for label in sorted(grouped)
    ]


def prediction_diagnostics(records: list[dict[str, Any]]) -> dict[str, Any]:
    def margin_band(record: dict[str, Any]) -> str:
        margin = abs(record["prediction"]["homeMargin"])
        if margin < 3: return "00-02.99"
        if margin < 7: return "03-06.99"
        if margin < 12: return "07-11.99"
        return "12-plus"

    def confidence_band(record: dict[str, Any]) -> str:
        probability = max(
            record["prediction"]["homeWinProbability"],
            1 - record["prediction"]["homeWinProbability"],
        )
        if probability < 0.60: return "50-59.99"
        if probability < 0.70: return "60-69.99"
        if probability < 0.80: return "70-79.99"
        return "80-plus"

    def rest_state(record: dict[str, Any]) -> str | None:
        state = record["auditFeatureState"]
        home = finite_float(state.get("home_rest_days"))
        away = finite_float(state.get("away_rest_days"))
        if home is None or away is None: return None
        difference = home - away
        if difference >= 2: return "home_rest_edge_2plus"
        if difference <= -2: return "away_rest_edge_2plus"
        return "rest_difference_under_2"

    team_records: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        for side in ("home", "away"):
            team = record[f"{side}Team"]["name"]
            score_error = record["error"][f"{side}ScoreSigned"]
            margin_error = record["error"]["marginSigned"] * (1 if side == "home" else -1)
            team_records.setdefault(team, []).append({
                "scoreError": score_error,
                "marginError": margin_error,
                "winnerCorrect": record["error"]["winnerCorrect"],
            })
    team_cohorts = []
    for team in sorted(team_records):
        rows = team_records[team]
        score = np.array([row["scoreError"] for row in rows], dtype=float)
        margin = np.array([row["marginError"] for row in rows], dtype=float)
        team_cohorts.append({
            "team": team,
            "games": len(rows),
            "scoreSignedBias": float(score.mean()),
            "scoreMae": float(np.abs(score).mean()),
            "teamPerspectiveMarginSignedBias": float(margin.mean()),
            "teamPerspectiveMarginMae": float(np.abs(margin).mean()),
            "winnerAccuracy": float(np.mean([row["winnerCorrect"] for row in rows])),
        })

    return {
        "method": "descriptive_error_localization_only_not_causal_attribution",
        "overall": summarize_records(records),
        "cohorts": {
            "calendarMonth": cohort_report(records, lambda row: row["featureCutoff"][5:7]),
            "predictedMarginBand": cohort_report(records, margin_band),
            "predictedWinnerConfidenceBand": cohort_report(records, confidence_band),
            "restState": cohort_report(records, rest_state),
            "errorContext": cohort_report(records, lambda row: row["errorContext"]),
            "team": team_cohorts,
        },
        "worstMisses": {
            "margin": sorted(records, key=lambda row: row["error"]["marginAbsolute"], reverse=True)[:25],
            "total": sorted(records, key=lambda row: row["error"]["totalAbsolute"], reverse=True)[:25],
            "singleTeamScore": sorted(
                records,
                key=lambda row: max(row["error"]["homeScoreAbsolute"], row["error"]["awayScoreAbsolute"]),
                reverse=True,
            )[:25],
        },
        "attributionWarning": "These cohorts identify repeatable error concentration. They do not prove cause and never relabel an unexplained result as luck.",
    }


def rating_baseline(frame: pd.DataFrame, home_advantage: float) -> tuple[np.ndarray, np.ndarray]:
    required = [
        "home_adjusted_offense", "home_adjusted_defense",
        "away_adjusted_offense", "away_adjusted_defense",
        "league_off_rating",
    ]
    if any(column not in frame for column in required):
        raise ValueError("NBA adjusted-rating baseline inputs are missing")
    league = frame["league_off_rating"].to_numpy(float)
    home_per_100 = frame["home_adjusted_offense"].to_numpy(float) + frame["away_adjusted_defense"].to_numpy(float) - league
    away_per_100 = frame["away_adjusted_offense"].to_numpy(float) + frame["home_adjusted_defense"].to_numpy(float) - league
    pace_candidates = pd.concat([
        frame.get("home_pace_15", pd.Series(index=frame.index, dtype=float)),
        frame.get("away_pace_15", pd.Series(index=frame.index, dtype=float)),
        frame.get("home_pace_prior", pd.Series(index=frame.index, dtype=float)),
        frame.get("away_pace_prior", pd.Series(index=frame.index, dtype=float)),
    ], axis=1)
    pace = pace_candidates.mean(axis=1, skipna=True).fillna(99.0).to_numpy(float)
    return (
        home_per_100 * pace / 100 + home_advantage / 2,
        away_per_100 * pace / 100 - home_advantage / 2,
    )


def residual_sigmas(
    frame: pd.DataFrame,
    home: np.ndarray,
    away: np.ndarray,
) -> tuple[float, float]:
    return (
        float(np.std(frame["target_home_margin"].to_numpy(float) - (home - away), ddof=1)),
        float(np.std(frame["target_total"].to_numpy(float) - (home + away), ddof=1)),
    )


def winner_corrections_and_harms(
    frame: pd.DataFrame,
    candidate_home: np.ndarray,
    candidate_away: np.ndarray,
    baseline_home: np.ndarray,
    baseline_away: np.ndarray,
) -> dict[str, int]:
    actual_home_win = frame["target_home_margin"].to_numpy(float) > 0
    candidate_correct = ((candidate_home - candidate_away) > 0) == actual_home_win
    baseline_correct = ((baseline_home - baseline_away) > 0) == actual_home_win
    return {
        "corrections": int((candidate_correct & ~baseline_correct).sum()),
        "harms": int((~candidate_correct & baseline_correct).sum()),
        "netCorrections": int(candidate_correct.sum() - baseline_correct.sum()),
        "unchangedCorrect": int((candidate_correct & baseline_correct).sum()),
        "unchangedWrong": int((~candidate_correct & ~baseline_correct).sum()),
    }


def bootstrap_confirmation(
    frame: pd.DataFrame,
    candidate_home: np.ndarray,
    candidate_away: np.ndarray,
    baseline_home: np.ndarray,
    baseline_away: np.ndarray,
    samples: int = 2_000,
) -> dict[str, Any]:
    """Deterministic game-cluster bootstrap for metric levels and paired deltas."""
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    actual_margin = actual_home - actual_away
    actual_total = actual_home + actual_away
    candidate_margin = candidate_home - candidate_away
    candidate_total = candidate_home + candidate_away
    baseline_margin = baseline_home - baseline_away
    baseline_total = baseline_home + baseline_away
    arrays = {
        "teamScoreMae": (
            (np.abs(candidate_home - actual_home) + np.abs(candidate_away - actual_away)) / 2,
            (np.abs(baseline_home - actual_home) + np.abs(baseline_away - actual_away)) / 2,
        ),
        "marginMae": (np.abs(candidate_margin - actual_margin), np.abs(baseline_margin - actual_margin)),
        "totalMae": (np.abs(candidate_total - actual_total), np.abs(baseline_total - actual_total)),
        "winnerAccuracy": (
            ((candidate_margin > 0) == (actual_margin > 0)).astype(float),
            ((baseline_margin > 0) == (actual_margin > 0)).astype(float),
        ),
    }
    rng = np.random.default_rng(20261015)
    indexes = rng.integers(0, len(frame), size=(samples, len(frame)))
    output: dict[str, Any] = {
        "method": "deterministic_game_cluster_bootstrap",
        "samples": samples,
        "seed": 20261015,
        "deltaConvention": "candidate_minus_rating_baseline; negative is better for error, positive is better for accuracy",
        "metrics": {},
    }
    for name, (candidate, baseline) in arrays.items():
        candidate_samples = candidate[indexes].mean(axis=1)
        delta_samples = candidate_samples - baseline[indexes].mean(axis=1)
        output["metrics"][name] = {
            "candidate": float(candidate.mean()),
            "candidate95Interval": [
                float(np.quantile(candidate_samples, 0.025)),
                float(np.quantile(candidate_samples, 0.975)),
            ],
            "ratingBaseline": float(baseline.mean()),
            "pairedDelta": float(candidate.mean() - baseline.mean()),
            "pairedDelta95Interval": [
                float(np.quantile(delta_samples, 0.025)),
                float(np.quantile(delta_samples, 0.975)),
            ],
        }
    return output


def rolling_origin_stability(
    frame: pd.DataFrame,
    selection_season: int,
    features: list[str],
    model: dict[str, Any],
    architecture: str,
) -> list[dict[str, Any]]:
    """Report prior-season stability without consulting confirmation outcomes."""
    rows: list[dict[str, Any]] = []
    seasons = sorted(int(value) for value in frame["season"].unique())
    for evaluation_season in seasons:
        if evaluation_season > selection_season:
            continue
        train = frame[frame["season"] < evaluation_season].copy()
        evaluate = frame[frame["season"] == evaluation_season].copy()
        if train.empty or evaluate.empty:
            continue
        home, away, _ = fit_predict(train, evaluate, features, model, architecture)
        train_home, train_away, _ = fit_predict(train, train, features, model, architecture)
        margin_sigma, total_sigma = residual_sigmas(train, train_home, train_away)
        rows.append({
            "trainingSeasons": sorted(int(value) for value in train["season"].unique()),
            "evaluationSeason": evaluation_season,
            "metrics": metrics(evaluate, home, away, margin_sigma, total_sigma),
        })
    return rows


def main() -> None:
    args = parse_args()
    frame = validate(read_jsonl(args.features))
    seasons = sorted(int(value) for value in frame["season"].unique())
    if len(seasons) < 3:
        raise ValueError("NBA tournament requires at least three chronological seasons")
    selection_season = args.selection_season or seasons[-2]
    confirmation_season = args.confirmation_season or seasons[-1]
    if selection_season >= confirmation_season:
        raise ValueError("NBA selection season must precede confirmation")
    train = frame[frame["season"] < selection_season].copy()
    selection = frame[frame["season"] == selection_season].copy()
    confirmation = frame[frame["season"] == confirmation_season].copy()
    if train.empty or selection.empty or confirmation.empty:
        raise ValueError("NBA tournament has an empty chronological partition")

    groups = feature_catalog(frame)
    model_specs = candidate_model_specs()
    candidates: list[dict[str, Any]] = []
    for group_name, features in groups.items():
        for architecture in ("team_scores", "margin_total"):
            for model in model_specs:
                home, away, _ = fit_predict(train, selection, features, model, architecture)
                train_home, train_away, _ = fit_predict(train, train, features, model, architecture)
                margin_sigma, total_sigma = residual_sigmas(train, train_home, train_away)
                candidates.append({
                    "group": group_name,
                    "featureCount": len(features),
                    "architecture": architecture,
                    "model": model,
                    "selection": metrics(selection, home, away, margin_sigma, total_sigma),
                })
    baseline_home, baseline_away = rating_baseline(selection, 2.2)
    baseline_fit_home, baseline_fit_away = rating_baseline(train, 2.2)
    baseline_margin_sigma = float(np.std(
        train["target_home_margin"].to_numpy(float) - (baseline_fit_home - baseline_fit_away), ddof=1,
    ))
    baseline_total_sigma = float(np.std(
        train["target_total"].to_numpy(float) - (baseline_fit_home + baseline_fit_away), ddof=1,
    ))
    selection_baseline = metrics(
        selection, baseline_home, baseline_away, baseline_margin_sigma, baseline_total_sigma
    )
    candidates.sort(key=lambda item: (
        item["selection"]["teamScoreMae"],
        item["selection"]["marginMae"],
        item["selection"]["totalMae"],
    ))
    eligible_candidates = [
        item for item in candidates
        if item["selection"]["teamScoreMae"] < selection_baseline["teamScoreMae"]
        and item["selection"]["marginMae"] <= selection_baseline["marginMae"] + 0.10
        and item["selection"]["totalMae"] <= selection_baseline["totalMae"] + 0.10
        and item["selection"]["winnerAccuracy"] >= selection_baseline["winnerAccuracy"] - 0.005
    ]
    selected = eligible_candidates[0] if eligible_candidates else candidates[0]
    selection_gate_passed = bool(eligible_candidates)

    fit = pd.concat([train, selection], ignore_index=True)
    selected_features = groups[selected["group"]]
    home, away, _ = fit_predict(
        fit,
        confirmation,
        selected_features,
        dict(selected["model"]),
        str(selected["architecture"]),
    )
    fit_home, fit_away, _ = fit_predict(
        fit,
        fit,
        selected_features,
        dict(selected["model"]),
        str(selected["architecture"]),
    )
    margin_sigma, total_sigma = residual_sigmas(fit, fit_home, fit_away)
    confirmation_metrics = metrics(confirmation, home, away, margin_sigma, total_sigma)

    confirmation_baseline_home, confirmation_baseline_away = rating_baseline(confirmation, 2.2)
    confirmation_baseline = metrics(
        confirmation,
        confirmation_baseline_home,
        confirmation_baseline_away,
        baseline_margin_sigma,
        baseline_total_sigma,
    )
    correction_ledger = winner_corrections_and_harms(
        confirmation,
        home,
        away,
        confirmation_baseline_home,
        confirmation_baseline_away,
    )
    uncertainty = bootstrap_confirmation(
        confirmation,
        home,
        away,
        confirmation_baseline_home,
        confirmation_baseline_away,
    )
    stability = rolling_origin_stability(
        frame[frame["season"] < confirmation_season].copy(),
        selection_season,
        selected_features,
        dict(selected["model"]),
        str(selected["architecture"]),
    )

    r1_comparable = confirmation_season == R1_CONFIRMATION["season"] and len(confirmation) == R1_CONFIRMATION["games"]
    r1_gates = None
    if r1_comparable:
        r1_gates = {
            "teamScoreMaeImproves": confirmation_metrics["teamScoreMae"] < R1_CONFIRMATION["teamScoreMae"],
            "marginMaeNoWorse": confirmation_metrics["marginMae"] <= R1_CONFIRMATION["marginMae"],
            "totalMaeNoWorse": confirmation_metrics["totalMae"] <= R1_CONFIRMATION["totalMae"],
            "winnerAccuracyNoWorse": confirmation_metrics["winnerAccuracy"] >= R1_CONFIRMATION["winnerAccuracy"],
        }

    prediction_rows = build_prediction_ledger(
        confirmation,
        home,
        away,
        margin_sigma,
        total_sigma,
        selected_features,
        groups["all_declared"],
        confirmation_baseline_home,
        confirmation_baseline_away,
    )
    diagnostics = prediction_diagnostics(prediction_rows)
    winner_errors = [row for row in prediction_rows if not row["error"]["winnerCorrect"]]
    spread_errors = [
        row for row in prediction_rows
        if row["openingMarketEvaluationOnly"]["spreadDirectionCorrect"] is False
    ]
    total_errors = [
        row for row in prediction_rows
        if row["openingMarketEvaluationOnly"]["totalDirectionCorrect"] is False
    ]

    args.output.mkdir(parents=True, exist_ok=True)
    predictions_path = args.output / "confirmation-predictions.jsonl"
    predictions_body = "".join(json.dumps(row, sort_keys=True) + "\n" for row in prediction_rows)
    predictions_path.write_text(predictions_body)
    diagnostics_path = args.output / "confirmation-diagnostics.json"
    diagnostics_body = json.dumps(diagnostics, indent=2, sort_keys=True) + "\n"
    diagnostics_path.write_text(diagnostics_body)

    error_artifacts: dict[str, dict[str, Any]] = {}
    for label, rows in (
        ("winner", winner_errors),
        ("spread", spread_errors),
        ("total", total_errors),
    ):
        path = args.output / f"confirmation-{label}-errors.jsonl"
        body = "".join(json.dumps(row, sort_keys=True) + "\n" for row in rows)
        path.write_text(body)
        error_artifacts[label] = {
            "file": path.name,
            "rows": len(rows),
            "sha256": hashlib.sha256(body.encode()).hexdigest(),
        }
    report = {
        "release": RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "chronology": {
            "trainingSeasons": sorted(int(value) for value in train["season"].unique()),
            "selectionSeason": selection_season,
            "confirmationSeason": confirmation_season,
        },
        "selected": selected,
        "selectionGatePassed": selection_gate_passed,
        "selectionGate": {
            "requiresTeamScoreMaeImprovement": True,
            "marginMaeMaximumRegression": 0.10,
            "totalMaeMaximumRegression": 0.10,
            "winnerAccuracyMaximumRegression": 0.005,
        },
        "selectionBaseline": selection_baseline,
        "confirmation": confirmation_metrics,
        "confirmationDistribution": {
            "marginSigma": margin_sigma,
            "totalSigma": total_sigma,
        },
        "confirmationRatingBaseline": confirmation_baseline,
        "confirmationWinnerChangesVsRatingBaseline": correction_ledger,
        "confirmationUncertainty": uncertainty,
        "rollingOriginStability": stability,
        "publishedR1Confirmation": R1_CONFIRMATION,
        "publishedR1DirectlyComparable": r1_comparable,
        "publishedR1Gates": r1_gates,
        "promotionAuthorized": False,
        "promotionNote": "Score confirmation alone cannot authorize production; market, exact-price, board-impact, runtime, and lock gates remain.",
        "topSelectionCandidates": candidates[:10],
        "predictions": {
            "file": predictions_path.name,
            "rows": len(prediction_rows),
            "sha256": hashlib.sha256(predictions_body.encode()).hexdigest(),
        },
        "diagnostics": {
            "file": diagnostics_path.name,
            "sha256": hashlib.sha256(diagnostics_body.encode()).hexdigest(),
            "causeAttributionPolicy": "never infer luck from an outcome; require timestamp-valid postgame component evidence",
        },
        "errorLedgers": error_artifacts,
    }
    report_path = args.output / "report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"report": str(report_path), "selected": selected, "confirmation": confirmation_metrics}, indent=2))


if __name__ == "__main__":
    main()
