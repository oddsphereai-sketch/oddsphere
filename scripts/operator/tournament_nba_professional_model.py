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


RELEASE = "nba_professional_tournament_2026_10_15_r33_abstaining_market_selection"
FEATURE_RELEASE = "nba_point_in_time_features_2026_10_15_r13_season_regime_state"
DEPLOYMENT_CANDIDATE_RELEASE = "nba_professional_deployment_candidate_2026_10_15_r13_abstaining_market_selection"
MINIMUM_CONFIRMATION_EXACT_PRICE_BETS = 100
MINIMUM_CONFIRMATION_EXACT_PRICE_COVERAGE = 0.75
MINIMUM_SELECTION_WILSON_LOWER = 0.50
MINIMUM_SELECTION_EXACT_PRICE_COVERAGE = 0.75
MULTI_SEASON_SHORTLIST = 20
MAXIMUM_WORST_SEASON_RELATIVE_JOINT_SCORE = 1.03
R1_CONFIRMATION = {
    "season": 2025,
    "games": 1230,
    "teamScoreMae": 9.6001,
    "marginMae": 10.9252,
    "totalMae": 15.6065,
    "winnerAccuracy": 0.6480,
}
PRODUCT_LIFETIME_REFERENCE = {
    "moneyline": {"wins": 1395, "bets": 2010, "accuracy": 0.694},
    "total": {"wins": 706, "bets": 1326, "accuracy": 0.532},
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
    "evaluation_opening_moneyline_home_price",
    "evaluation_opening_moneyline_away_price",
    "evaluation_opening_home_spread",
    "evaluation_opening_home_cover_probability",
    "evaluation_opening_home_spread_price",
    "evaluation_opening_away_spread_price",
    "evaluation_opening_total",
    "evaluation_opening_over_probability",
    "evaluation_opening_over_price",
    "evaluation_opening_under_price",
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
    parser.add_argument("--minimum-games-per-season", type=int, default=1_200)
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

    regime = chosen((
        "league_current_", "league_prior_", "league_regime_",
    ))
    ratings = chosen((
        "league_off_rating", "adjusted_", "offRating_", "defRating_", "pace_",
        "home_margin_", "away_margin_", "current_games", "prior_games", "elo_", "baseline_",
    ))
    elo = chosen(("league_off_rating", "elo_"))
    adjusted_ratings = chosen(("league_off_rating", "adjusted_", "baseline_", "pace_prior"))
    schedule = chosen((
        "rest_days", "back_to_back", "games_last_4_days", "games_last_7_days",
        "travel_", "time_zones_", "consecutive_road_games_", "venue_altitude_", "altitude_change_",
    ))
    four_factors = chosen((
        "efg_", "turnoverRate_", "offensiveReboundRate_", "freeThrowRate_", "opponent",
        "matchup_home_efg_", "matchup_away_efg_", "matchup_home_turnover_",
        "matchup_away_turnover_", "matchup_home_rebound_", "matchup_away_rebound_",
        "matchup_home_free_throw_", "matchup_away_free_throw_", "matchup_pace_",
    ))
    volatility = chosen(("margin_sd_", "total_rating_sd_", "matchup_margin_volatility_", "matchup_total_volatility_"))
    rotation = chosen((
        "rotationPlayers_", "top3MinutesShare_", "top8MinutesShare_", "rotationMinutesEntropy_",
        "rotation_expected_", "rotation_continuity_", "rotation_latest_",
    ))
    tracking_style = chosen((
        "pointsPaintShare_", "pointsFastBreakShare_", "pointsSecondChanceShare_",
        "pointsOffTurnoversShare_", "passesPer100_", "touchesPer100_",
        "secondaryAssistsPer100_", "screenAssistPointsPer100_", "deflectionsPer100_",
        "contestedShotsPer100_", "defendedAtRimAttemptsPer100_", "defendedAtRimFgPct_",
        "reboundChancesPer100_", "rotationEstimatedNetRating_", "usageWeighted_",
        "usageMax_", "usageConcentration_", "distancePer48_", "speedWeighted_",
        "matchup_pointsPaintShare_", "matchup_pointsFastBreakShare_",
        "matchup_pointsSecondChanceShare_", "matchup_pointsOffTurnoversShare_",
        "matchup_passesPer100_", "matchup_touchesPer100_", "matchup_deflectionsPer100_",
        "matchup_contestedShotsPer100_", "matchup_defendedAtRimFgPct_",
        "matchup_reboundChancesPer100_", "matchup_usageConcentration_",
        "playerImpactEstimate_", "assistPercentage_", "turnoverRatio_",
        "trueShootingPercentage_", "threePointAttemptShare_",
        "offensiveReboundPercentage_", "defensiveReboundPercentage_",
        "freeThrowAttemptRate_", "foulsDrawnPer100_", "looseBallsRecoveredPer100_",
        "chargesDrawnPer100_", "switchesOnPer100_", "contestedFgPct_",
        "uncontestedFgPct_", "matchupFgPct_", "matchupThreePointPct_",
        "screenAssistsPer100_", "reboundChancesOffPer100_", "reboundChancesDefPer100_",
    ))
    groups = {
        "elo_only": sorted(set(elo)),
        "elo_season_regime": sorted(set(elo + regime)),
        "adjusted_ratings": sorted(set(adjusted_ratings)),
        "adjusted_ratings_season_regime": sorted(set(adjusted_ratings + regime)),
        "ratings": sorted(set(ratings)),
        "ratings_season_regime": sorted(set(ratings + regime)),
        "ratings_schedule": sorted(set(ratings + schedule)),
        "ratings_schedule_season_regime": sorted(set(ratings + schedule + regime)),
        "four_factors_schedule": sorted(set(ratings + schedule + four_factors + volatility)),
        "rotation_schedule": sorted(set(ratings + schedule + four_factors + volatility + rotation)),
        "tracking_style": sorted(set(ratings + schedule + four_factors + volatility + rotation + tracking_style)),
        "all_declared": sorted(set(
            ratings + schedule + four_factors + volatility + rotation + tracking_style + regime
        )),
    }
    for name, columns in groups.items():
        if not columns:
            raise ValueError(f"NBA feature group {name} is empty")
    return groups


def feature_coverage_report(
    frame: pd.DataFrame,
    features: list[str],
    selected_features: list[str],
) -> dict[str, Any]:
    selected = set(selected_features)
    rows: list[dict[str, Any]] = []
    for feature in features:
        values = pd.to_numeric(frame[feature], errors="coerce")
        present = values.notna()
        finite_values = values[present].to_numpy(float)
        by_season = {}
        for season, indexes in frame.groupby("season").groups.items():
            season_present = present.loc[indexes]
            by_season[str(int(season))] = {
                "rows": int(len(indexes)),
                "present": int(season_present.sum()),
                "coverage": float(season_present.mean()),
            }
        rows.append({
            "feature": feature,
            "selected": feature in selected,
            "rows": int(len(frame)),
            "present": int(present.sum()),
            "coverage": float(present.mean()),
            "distinctFiniteValues": int(len(np.unique(finite_values))),
            "bySeason": by_season,
        })
    return {
        "method": "pregame_feature_nonnull_coverage_by_chronological_season",
        "features": len(rows),
        "selectedFeatures": len(selected),
        "fullyMissing": [row["feature"] for row in rows if row["present"] == 0],
        "belowHalfCoverage": [row["feature"] for row in rows if row["coverage"] < 0.5],
        "constantWhenPresent": [row["feature"] for row in rows if row["distinctFiniteValues"] <= 1],
        "rows": rows,
    }


def candidate_feature_quality(frame: pd.DataFrame, features: list[str]) -> dict[str, Any]:
    """Gate nominally rich candidates whose training inputs are mostly absent or inert."""
    rows: list[dict[str, Any]] = []
    for feature in features:
        values = pd.to_numeric(frame[feature], errors="coerce").to_numpy(float)
        finite = np.isfinite(values)
        finite_values = values[finite]
        coverage = float(finite.mean())
        distinct = int(len(np.unique(finite_values)))
        rows.append({
            "feature": feature,
            "coverage": coverage,
            "distinctFiniteValues": distinct,
            "usable": bool(coverage >= 0.50 and distinct > 1),
        })
    usable = sum(int(row["usable"]) for row in rows)
    minimum_usable = max(1, math.ceil(len(rows) * 0.80))
    return {
        "evaluatedOn": "training_partition_only",
        "minimumCoverage": 0.50,
        "minimumUsableFraction": 0.80,
        "features": len(rows),
        "usableFeatures": usable,
        "minimumUsableFeatures": minimum_usable,
        "gatePassed": bool(usable >= minimum_usable),
        "unusable": [row for row in rows if not row["usable"]],
    }


def joint_selection_score(candidate: dict[str, Any], baseline: dict[str, Any]) -> float:
    """Balance score accuracy and probability quality; lower is better."""
    weights = {
        "teamScoreMae": 0.25,
        "marginMae": 0.20,
        "totalMae": 0.20,
        "homeWinBrier": 0.20,
        "homeWinLogLoss": 0.10,
    }
    score = sum(
        weight * float(candidate[metric]) / max(float(baseline[metric]), 1e-9)
        for metric, weight in weights.items()
    )
    candidate_error = 1 - float(candidate["winnerAccuracy"])
    baseline_error = max(1e-9, 1 - float(baseline["winnerAccuracy"]))
    return score + 0.05 * candidate_error / baseline_error


def candidate_model_specs() -> list[dict[str, Any]]:
    """Return the predeclared, bounded-complexity estimator grid."""
    return [
        *[{"family": "ridge", "alpha": alpha} for alpha in (0.1, 1.0, 10.0, 100.0, 1000.0)],
        {"family": "huber_ridge", "alpha": 1.0, "epsilon": 1.35},
        {"family": "huber_ridge", "alpha": 10.0, "epsilon": 1.75},
        {"family": "spline_ridge", "alpha": 10.0, "knots": [0.75]},
        {"family": "spline_ridge", "alpha": 100.0, "knots": [0.75, 1.5]},
        {"family": "ridge", "alpha": 10.0, "halfLifeDays": 365.0},
        {"family": "ridge", "alpha": 100.0, "halfLifeDays": 730.0},
        {"family": "huber_ridge", "alpha": 10.0, "epsilon": 1.75, "halfLifeDays": 365.0},
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
    finite_columns = np.isfinite(raw_train).any(axis=0)
    medians = np.zeros(raw_train.shape[1], dtype=float)
    medians[finite_columns] = np.nanmedian(raw_train[:, finite_columns], axis=0)
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
    pre_spline_design_columns = int(x_train.shape[1])
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
        "rawFeatureMedians": medians.tolist(),
        "designMeans": means.tolist(),
        "designStandardDeviations": deviations.tolist(),
        "preSplineDesignColumns": pre_spline_design_columns,
        "splineKnots": list(model.get("knots", [])),
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
    base_weights: np.ndarray | None = None,
) -> np.ndarray:
    normalized_base = None
    if base_weights is not None:
        normalized_base = base_weights / max(float(base_weights.mean()), 1e-9)
    coefficients = solve_ridge(x_train, y_train, float(model["alpha"]), normalized_base)
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
        if normalized_base is not None:
            weights *= normalized_base
        updated = solve_ridge(x_train, y_train, float(model["alpha"]), weights)
        if np.max(np.abs(updated - coefficients)) < 1e-7:
            coefficients = updated
            break
        coefficients = updated
    return coefficients


def predict_regressor(x: np.ndarray, coefficients: np.ndarray) -> np.ndarray:
    return np.column_stack([x, np.ones(len(x))]) @ coefficients


def deployment_design_matrix(frame: pd.DataFrame, design: dict[str, Any]) -> np.ndarray:
    """Reconstruct the fitted design matrix using only exported candidate state."""
    features = [str(feature) for feature in design["features"]]
    missing_feature_indices = [
        features.index(str(feature)) for feature in design["missingIndicatorColumns"]
    ]
    raw = frame[features].to_numpy(float)
    medians = np.asarray(design["rawFeatureMedians"], dtype=float)
    if raw.shape[1] != len(medians):
        raise ValueError("deployment feature and median dimensions differ")
    missing = np.isnan(raw)
    transformed = np.where(missing, medians, raw)
    if missing_feature_indices:
        transformed = np.column_stack([
            transformed,
            missing[:, missing_feature_indices].astype(float),
        ])
    means = np.asarray(design["designMeans"], dtype=float)
    deviations = np.asarray(design["designStandardDeviations"], dtype=float)
    if transformed.shape[1] != len(means) or len(means) != len(deviations):
        raise ValueError("deployment standardization dimensions differ")
    transformed = (transformed - means) / deviations
    knots = [float(knot) for knot in design["splineKnots"]]
    if knots:
        base = np.clip(transformed, -5.0, 5.0)
        parts = [base]
        for threshold in knots:
            parts.extend([
                np.maximum(0.0, base - threshold),
                np.maximum(0.0, -base - threshold),
            ])
        transformed = np.column_stack(parts)
    if transformed.shape[1] != int(design["designColumns"]):
        raise ValueError("replayed deployment design has unexpected dimensions")
    return transformed


def predict_deployment_candidate(
    frame: pd.DataFrame,
    artifact: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray]:
    """Score rows from the portable candidate artifact without refitting."""
    transformed = deployment_design_matrix(frame, artifact["design"])
    coefficients = {
        target: np.asarray(values, dtype=float)
        for target, values in artifact["coefficients"].items()
    }
    expected_coefficient_count = transformed.shape[1] + 1
    if any(len(values) != expected_coefficient_count for values in coefficients.values()):
        raise ValueError("deployment coefficient and design dimensions differ")
    if artifact["architecture"] == "team_scores":
        return (
            predict_regressor(transformed, coefficients["target_home_score"]),
            predict_regressor(transformed, coefficients["target_away_score"]),
        )
    if artifact["architecture"] == "margin_total":
        margin = predict_regressor(transformed, coefficients["target_home_margin"])
        total = predict_regressor(transformed, coefficients["target_total"])
        return (total + margin) / 2, (total - margin) / 2
    if artifact["architecture"] == "residual_margin_total":
        anchor_margin, anchor_total = regime_anchors(frame)
        margin = anchor_margin + predict_regressor(
            transformed, coefficients["target_home_margin_residual"],
        )
        total = anchor_total + predict_regressor(
            transformed, coefficients["target_total_residual"],
        )
        return (total + margin) / 2, (total - margin) / 2
    raise ValueError(f"unsupported deployment architecture {artifact['architecture']}")


def regime_anchors(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    """Build leakage-safe score anchors on each game's own league and pace regime."""
    pace = np.full(len(frame), np.nan, dtype=float)
    for column in ("matchup_pace_mean_15", "matchup_pace_mean_5", "matchup_pace_mean_prior"):
        if column in frame:
            values = frame[column].to_numpy(float)
            pace = np.where(np.isfinite(pace), pace, values)
    for window in ("15", "5", "prior"):
        home_column = f"home_pace_{window}"
        away_column = f"away_pace_{window}"
        if home_column in frame and away_column in frame:
            values = (
                frame[home_column].to_numpy(float) + frame[away_column].to_numpy(float)
            ) / 2
            pace = np.where(np.isfinite(pace), pace, values)
    pace = np.where(np.isfinite(pace), pace, 100.0)
    home_offense = frame["home_adjusted_offense"].to_numpy(float)
    home_defense = frame["home_adjusted_defense"].to_numpy(float)
    away_offense = frame["away_adjusted_offense"].to_numpy(float)
    away_defense = frame["away_adjusted_defense"].to_numpy(float)
    derived_margin = home_offense + away_defense - away_offense - home_defense
    league_total = 2 * frame["league_off_rating"].to_numpy(float)
    derived_total = home_offense + away_defense + away_offense + home_defense - league_total
    margin_pp100 = (
        frame["baseline_expected_margin_pp100"].to_numpy(float)
        if "baseline_expected_margin_pp100" in frame else derived_margin
    )
    total_pp100 = (
        frame["baseline_expected_total_pp100"].to_numpy(float)
        if "baseline_expected_total_pp100" in frame else derived_total
    )
    margin_pp100 = np.where(np.isfinite(margin_pp100), margin_pp100, 0.0)
    total_pp100 = np.where(np.isfinite(total_pp100), total_pp100, league_total)
    return margin_pp100 * pace / 100, total_pp100 * pace / 100


def fit_predict(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    features: list[str],
    model: dict[str, Any],
    architecture: str,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    x_train, x_evaluate, design = design_matrices(train, evaluate, features, model)
    weights = None
    half_life_days = model.get("halfLifeDays")
    if half_life_days is not None:
        cutoff = pd.to_datetime(train["feature_cutoff"], utc=True)
        ages = (cutoff.max() - cutoff).dt.total_seconds().to_numpy(float) / 86_400
        weights = np.power(0.5, ages / float(half_life_days))
    models: dict[str, Any] = {"design": design, "model": model}
    if architecture == "team_scores":
        for target in ("target_home_score", "target_away_score"):
            models[target] = fit_regressor(x_train, train[target].to_numpy(float), model, weights)
        home = predict_regressor(x_evaluate, models["target_home_score"])
        away = predict_regressor(x_evaluate, models["target_away_score"])
        return home, away, models
    if architecture == "margin_total":
        for target in ("target_home_margin", "target_total"):
            models[target] = fit_regressor(x_train, train[target].to_numpy(float), model, weights)
        margin = predict_regressor(x_evaluate, models["target_home_margin"])
        total = predict_regressor(x_evaluate, models["target_total"])
        return (total + margin) / 2, (total - margin) / 2, models
    if architecture == "residual_margin_total":
        train_anchor_margin, train_anchor_total = regime_anchors(train)
        evaluate_anchor_margin, evaluate_anchor_total = regime_anchors(evaluate)
        residual_targets = {
            "target_home_margin_residual": train["target_home_margin"].to_numpy(float) - train_anchor_margin,
            "target_total_residual": train["target_total"].to_numpy(float) - train_anchor_total,
        }
        for target, values in residual_targets.items():
            models[target] = fit_regressor(x_train, values, model, weights)
        margin = evaluate_anchor_margin + predict_regressor(
            x_evaluate, models["target_home_margin_residual"],
        )
        total = evaluate_anchor_total + predict_regressor(
            x_evaluate, models["target_total_residual"],
        )
        return (total + margin) / 2, (total - margin) / 2, models
    raise ValueError(f"unsupported architecture {architecture}")


def normal_cdf(values: np.ndarray) -> np.ndarray:
    erf = np.vectorize(math.erf)
    return 0.5 * (1.0 + erf(values / math.sqrt(2.0)))


def exact_price_return(
    wins: np.ndarray,
    prices: np.ndarray,
    sportsbooks: np.ndarray | None = None,
) -> dict[str, Any]:
    profits = np.where(prices > 0, prices / 100, 100 / -prices)
    units = np.where(wins, profits, -1.0)
    book_counts: dict[str, int] = {}
    if sportsbooks is not None:
        for raw in sportsbooks:
            book = str(raw).strip().lower() if isinstance(raw, str) else ""
            key = book if book else "unavailable"
            book_counts[key] = book_counts.get(key, 0) + 1
    priced_with_book = sum(value for key, value in book_counts.items() if key != "unavailable")
    return {
        "bets": int(len(units)),
        "wins": int(wins.sum()),
        "losses": int((~wins).sum()),
        "units": float(units.sum()),
        "roi": float(units.mean()),
        "averageAmericanPrice": float(prices.mean()),
        "sportsbookCoverage": (
            float(priced_with_book / len(prices)) if len(prices) > 0 and sportsbooks is not None else None
        ),
        "sportsbooks": dict(sorted(book_counts.items())),
    }


def wilson_lower_bound(wins: int, bets: int, z: float = 1.96) -> float | None:
    if bets <= 0:
        return None
    rate = wins / bets
    denominator = 1 + z * z / bets
    center = rate + z * z / (2 * bets)
    margin = z * math.sqrt(rate * (1 - rate) / bets + z * z / (4 * bets * bets))
    return float((center - margin) / denominator)


def actionable_candidate_report(
    frame: pd.DataFrame,
    home: np.ndarray,
    away: np.ndarray,
    margin_sigma: float,
    total_sigma: float,
    market: str,
    threshold: float,
) -> dict[str, Any]:
    actual_margin = frame["target_home_margin"].to_numpy(float)
    actual_total = frame["target_total"].to_numpy(float)
    predicted_margin = home - away
    predicted_total = home + away
    if market == "moneyline":
        probability = np.clip(normal_cdf(predicted_margin / max(margin_sigma, 1e-6)), 0.001, 0.999)
        market_home_probability = frame["evaluation_opening_market_home_probability"].to_numpy(float)
        selected_first = probability >= market_home_probability
        selected_probability = np.where(selected_first, probability, 1 - probability)
        selected_market_probability = np.where(
            selected_first, market_home_probability, 1 - market_home_probability
        )
        first_price = frame["evaluation_opening_moneyline_home_price"].to_numpy(float)
        second_price = frame["evaluation_opening_moneyline_away_price"].to_numpy(float)
        first_book = frame.get(
            "evaluation_opening_moneyline_home_sportsbook", pd.Series(None, index=frame.index)
        ).to_numpy(object)
        second_book = frame.get(
            "evaluation_opening_moneyline_away_sportsbook", pd.Series(None, index=frame.index)
        ).to_numpy(object)
        price = np.where(selected_first, first_price, second_price)
        sportsbook = np.where(selected_first, first_book, second_book)
        eligible = (
            np.isfinite(market_home_probability)
            & (selected_probability - selected_market_probability >= threshold)
        )
        wins = selected_first == (actual_margin > 0)
        selection_rule = "minimum_model_probability_edge_vs_no_vig_opening_consensus"
    elif market == "spread":
        line = frame["evaluation_opening_home_spread"].to_numpy(float)
        probability = np.clip(normal_cdf(
            (predicted_margin + line) / max(margin_sigma, 1e-6)
        ), 0.001, 0.999)
        selected_first = probability >= 0.5
        selected_probability = np.where(selected_first, probability, 1 - probability)
        first_price = frame["evaluation_opening_home_spread_price"].to_numpy(float)
        second_price = frame["evaluation_opening_away_spread_price"].to_numpy(float)
        first_book = frame.get(
            "evaluation_opening_home_spread_sportsbook", pd.Series(None, index=frame.index)
        ).to_numpy(object)
        second_book = frame.get(
            "evaluation_opening_away_spread_sportsbook", pd.Series(None, index=frame.index)
        ).to_numpy(object)
        price = np.where(selected_first, first_price, second_price)
        sportsbook = np.where(selected_first, first_book, second_book)
        resolved = np.isfinite(line) & ~np.isclose(actual_margin + line, 0.0)
        eligible = resolved & (selected_probability - 0.5 >= threshold)
        wins = selected_first == (actual_margin + line > 0)
        selection_rule = "minimum_calibrated_cover_probability_edge"
    elif market == "total":
        line = frame["evaluation_opening_total"].to_numpy(float)
        probability = np.clip(normal_cdf(
            (predicted_total - line) / max(total_sigma, 1e-6)
        ), 0.001, 0.999)
        selected_first = probability >= 0.5
        selected_probability = np.where(selected_first, probability, 1 - probability)
        first_price = frame["evaluation_opening_over_price"].to_numpy(float)
        second_price = frame["evaluation_opening_under_price"].to_numpy(float)
        first_book = frame.get(
            "evaluation_opening_over_sportsbook", pd.Series(None, index=frame.index)
        ).to_numpy(object)
        second_book = frame.get(
            "evaluation_opening_under_sportsbook", pd.Series(None, index=frame.index)
        ).to_numpy(object)
        price = np.where(selected_first, first_price, second_price)
        sportsbook = np.where(selected_first, first_book, second_book)
        resolved = np.isfinite(line) & ~np.isclose(actual_total - line, 0.0)
        eligible = resolved & (selected_probability - 0.5 >= threshold)
        wins = selected_first == (actual_total > line)
        selection_rule = "minimum_calibrated_over_under_probability_edge"
    else:
        raise ValueError(f"unsupported NBA actionable market {market}")
    selected_wins = wins[eligible]
    selected_probability_values = selected_probability[eligible]
    bets = int(eligible.sum())
    win_count = int(selected_wins.sum())
    priced = eligible & np.isfinite(price) & (price != 0)
    priced_bets = int(priced.sum())
    return {
        "market": market,
        "selectionRule": selection_rule,
        "threshold": threshold,
        "bets": bets,
        "wins": win_count,
        "losses": bets - win_count,
        "accuracy": float(selected_wins.mean()) if bets > 0 else None,
        "wilson95Lower": wilson_lower_bound(win_count, bets),
        "brier": float(np.square(selected_probability_values - selected_wins.astype(float)).mean())
            if bets > 0 else None,
        "exactPriceCoverage": float(priced_bets / bets) if bets > 0 else None,
        "exactPrice": exact_price_return(
            wins[priced], price[priced], sportsbook[priced]
        ) if priced.any() else None,
    }


def select_actionable_thresholds(
    frame: pd.DataFrame,
    home: np.ndarray,
    away: np.ndarray,
    margin_sigma: float,
    total_sigma: float,
) -> dict[str, Any]:
    # The threshold partition is the later 40% of the selection season. A
    # full NBA season therefore has enough rows to require 100 decisions;
    # small synthetic contract fixtures retain a proportional floor.
    minimum_bets = min(100, max(20, math.ceil(len(frame) * 0.25)))
    grids = {
        "moneyline": (0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.075, 0.10),
        "spread": (0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08),
        "total": (0.0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08),
    }
    selected: dict[str, Any] = {}
    for market, thresholds in grids.items():
        candidates = [
            actionable_candidate_report(
                frame, home, away, margin_sigma, total_sigma, market, threshold
            )
            for threshold in thresholds
        ]
        sample_eligible = [candidate for candidate in candidates if candidate["bets"] >= minimum_bets]
        if market == "moneyline":
            # A value-moneyline strategy may intentionally choose underdogs,
            # so raw accuracy is not its economic gate. Without timestamped
            # exact prices in selection, however, ROI is unknowable and the
            # professional decision is to abstain.
            eligible = [
                candidate for candidate in sample_eligible
                if candidate["exactPriceCoverage"] is not None
                and candidate["exactPriceCoverage"] >= MINIMUM_SELECTION_EXACT_PRICE_COVERAGE
                and candidate["exactPrice"] is not None
                and candidate["exactPrice"]["bets"] >= minimum_bets
                and candidate["exactPrice"]["units"] > 0
            ]
            eligible.sort(key=lambda item: (
                -(item["exactPrice"]["roi"] if item["exactPrice"] else -math.inf),
                -(item["wilson95Lower"] or -math.inf),
                -item["bets"],
            ))
        else:
            eligible = [
                candidate for candidate in sample_eligible
                if candidate["wilson95Lower"] is not None
                and candidate["wilson95Lower"] >= MINIMUM_SELECTION_WILSON_LOWER
            ]
            eligible.sort(key=lambda item: (
                -(item["wilson95Lower"] or -math.inf),
                -(item["accuracy"] or -math.inf),
                -item["bets"],
            ))
        selected[market] = {
            "minimumSelectionBets": minimum_bets,
            "minimumSelectionWilsonLower": (
                None if market == "moneyline" else MINIMUM_SELECTION_WILSON_LOWER
            ),
            "minimumSelectionExactPriceCoverage": (
                MINIMUM_SELECTION_EXACT_PRICE_COVERAGE if market == "moneyline" else None
            ),
            "selected": eligible[0] if eligible else None,
            "candidates": candidates,
        }
    return selected


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
    home_price_column = "evaluation_opening_moneyline_home_price"
    away_price_column = "evaluation_opening_moneyline_away_price"
    if home_price_column in frame and away_price_column in frame:
        home_price = frame[home_price_column].to_numpy(float)
        away_price = frame[away_price_column].to_numpy(float)
        home_book = frame.get(
            "evaluation_opening_moneyline_home_sportsbook", pd.Series(None, index=frame.index)
        ).to_numpy(object)
        away_book = frame.get(
            "evaluation_opening_moneyline_away_sportsbook", pd.Series(None, index=frame.index)
        ).to_numpy(object)
        selected_home = probabilities >= 0.5
        price = np.where(selected_home, home_price, away_price)
        sportsbook = np.where(selected_home, home_book, away_book)
        available = np.isfinite(price) & (price != 0)
        if available.any():
            wins = selected_home[available] == (outcomes[available] > 0.5)
            market_evaluation["moneyline"] = {
                "games": int(available.sum()),
                "directionAccuracy": float(wins.mean()),
                "exactPrice": exact_price_return(wins, price[available], sportsbook[available]),
            }
    spread_column = "evaluation_opening_home_spread"
    if spread_column in frame:
        spread = frame[spread_column].to_numpy(float)
        available = np.isfinite(spread) & ~np.isclose(actual_margin + spread, 0.0)
        if available.any():
            model_probability = np.clip(normal_cdf(
                (predicted_margin[available] + spread[available]) / max(margin_sigma, 1e-6)
            ), 0.001, 0.999)
            outcome = (actual_margin[available] + spread[available] > 0).astype(float)
            selected_home = model_probability >= 0.5
            home_price = frame["evaluation_opening_home_spread_price"].to_numpy(float)[available]
            away_price = frame["evaluation_opening_away_spread_price"].to_numpy(float)[available]
            home_book = frame.get(
                "evaluation_opening_home_spread_sportsbook", pd.Series(None, index=frame.index)
            ).to_numpy(object)[available]
            away_book = frame.get(
                "evaluation_opening_away_spread_sportsbook", pd.Series(None, index=frame.index)
            ).to_numpy(object)[available]
            selected_price = np.where(selected_home, home_price, away_price)
            selected_book = np.where(selected_home, home_book, away_book)
            priced = np.isfinite(selected_price) & (selected_price != 0)
            wins = selected_home[priced] == (outcome[priced] > 0.5)
            market_evaluation["spread"] = {
                "games": int(available.sum()),
                "directionAccuracy": float(((model_probability >= 0.5) == (outcome > 0.5)).mean()),
                "brier": float(np.square(model_probability - outcome).mean()),
                "exactPrice": exact_price_return(
                    wins, selected_price[priced], selected_book[priced]
                ) if priced.any() else None,
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
            selected_over = model_probability >= 0.5
            over_price = frame["evaluation_opening_over_price"].to_numpy(float)[available]
            under_price = frame["evaluation_opening_under_price"].to_numpy(float)[available]
            over_book = frame.get(
                "evaluation_opening_over_sportsbook", pd.Series(None, index=frame.index)
            ).to_numpy(object)[available]
            under_book = frame.get(
                "evaluation_opening_under_sportsbook", pd.Series(None, index=frame.index)
            ).to_numpy(object)[available]
            selected_price = np.where(selected_over, over_price, under_price)
            selected_book = np.where(selected_over, over_book, under_book)
            priced = np.isfinite(selected_price) & (selected_price != 0)
            wins = selected_over[priced] == (outcome[priced] > 0.5)
            market_evaluation["total"] = {
                "games": int(available.sum()),
                "directionAccuracy": float(((model_probability >= 0.5) == (outcome > 0.5)).mean()),
                "brier": float(np.square(model_probability - outcome).mean()),
                "exactPrice": exact_price_return(
                    wins, selected_price[priced], selected_book[priced]
                ) if priced.any() else None,
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


def apply_reference_market_marriage(
    frame: pd.DataFrame,
    independent_home: np.ndarray,
    independent_away: np.ndarray,
    margin_independent_weight: float,
    total_independent_weight: float,
) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    """Blend scores with a pregame market reference without breaking coherence.

    The spread is converted to expected home margin, while the total remains in
    points. Missing market heads fall back to the independent projection. This
    is deliberately limited to score-level evidence that can be replayed; line
    movement and public splits are not silently approximated.
    """
    independent_margin = independent_home - independent_away
    independent_total = independent_home + independent_away
    spread = frame.get(
        "evaluation_opening_home_spread",
        pd.Series(np.nan, index=frame.index),
    ).to_numpy(float)
    market_total = frame.get(
        "evaluation_opening_total",
        pd.Series(np.nan, index=frame.index),
    ).to_numpy(float)
    margin_available = np.isfinite(spread)
    total_available = np.isfinite(market_total)
    market_margin = -spread
    final_margin = np.where(
        margin_available,
        margin_independent_weight * independent_margin
        + (1 - margin_independent_weight) * market_margin,
        independent_margin,
    )
    final_total = np.where(
        total_available,
        total_independent_weight * independent_total
        + (1 - total_independent_weight) * market_total,
        independent_total,
    )
    return (
        (final_total + final_margin) / 2,
        (final_total - final_margin) / 2,
        {
            "games": int(len(frame)),
            "marginAvailable": int(margin_available.sum()),
            "totalAvailable": int(total_available.sum()),
            "bothAvailable": int((margin_available & total_available).sum()),
        },
    )


def chronological_market_marriage_partition(
    frame: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, int]:
    """Reserve later selection games for threshold choice after blend choice."""
    ordered = frame.sort_values(["feature_cutoff", "game_id"]).copy()
    if len(ordered) < 10:
        raise ValueError("NBA market marriage requires at least 10 selection games")
    split = max(1, min(len(ordered) - 1, int(round(len(ordered) * 0.60))))
    return ordered.iloc[:split].copy(), ordered.iloc[split:].copy(), split


def select_reference_market_marriage(
    frame: pd.DataFrame,
    independent_home: np.ndarray,
    independent_away: np.ndarray,
    independent_margin_sigma: float,
    independent_total_sigma: float,
) -> dict[str, Any]:
    """Select bounded market weights before the confirmation season is opened."""
    marriage_fit, threshold_selection, split = chronological_market_marriage_partition(frame)
    provenance = frame.get(
        "evaluation_market_provenance",
        pd.Series("unavailable", index=frame.index),
    ).fillna("unavailable").astype(str)
    provenance_counts = {
        str(key): int(value) for key, value in provenance.value_counts().sort_index().items()
    }
    minimum_authoritative_rows = max(100, math.ceil(len(provenance) * 0.95))
    timestamped_rows = provenance == "balldontlie_timestamped_opening"
    documented_rows = provenance.isin({
            "balldontlie_timestamped_opening",
            "independent_multibook_consensus_documented_opening_snapshot_timestamp_unavailable",
    })
    unavailable_rows = provenance == "unavailable"
    timestamped_selection_authority = bool(
        int(timestamped_rows.sum()) >= minimum_authoritative_rows
        and (timestamped_rows | unavailable_rows).all()
    )
    documented_opening_selection_authority = bool(
        int(documented_rows.sum()) >= minimum_authoritative_rows
        and (documented_rows | unavailable_rows).all()
    )
    fit_home = independent_home[:split]
    fit_away = independent_away[:split]
    threshold_home = independent_home[split:]
    threshold_away = independent_away[split:]
    independent_fit_metrics = metrics(
        marriage_fit,
        fit_home,
        fit_away,
        independent_margin_sigma,
        independent_total_sigma,
    )
    candidates: list[dict[str, Any]] = []
    for margin_weight in (0.0, 0.25, 0.50, 0.75, 1.0):
        for total_weight in (0.0, 0.25, 0.50, 0.75, 1.0):
            home, away, coverage = apply_reference_market_marriage(
                marriage_fit,
                fit_home,
                fit_away,
                margin_weight,
                total_weight,
            )
            candidate_metrics = metrics(
                marriage_fit,
                home,
                away,
                independent_margin_sigma,
                independent_total_sigma,
            )
            score = joint_selection_score(candidate_metrics, independent_fit_metrics)
            eligible = (
                candidate_metrics["teamScoreMae"] <= independent_fit_metrics["teamScoreMae"] + 0.05
                and candidate_metrics["marginMae"] <= independent_fit_metrics["marginMae"] + 0.05
                and candidate_metrics["totalMae"] <= independent_fit_metrics["totalMae"] + 0.05
                and candidate_metrics["winnerAccuracy"] >= independent_fit_metrics["winnerAccuracy"] - 0.002
                and candidate_metrics["homeWinBrier"] <= independent_fit_metrics["homeWinBrier"] + 0.001
            )
            candidates.append({
                "marginIndependentWeight": margin_weight,
                "totalIndependentWeight": total_weight,
                "metrics": candidate_metrics,
                "coverage": coverage,
                "relativeJointScore": score,
                "eligible": bool(eligible),
            })
    candidates.sort(key=lambda item: (
        not item["eligible"],
        item["relativeJointScore"],
        item["metrics"]["teamScoreMae"],
    ))
    selected = candidates[0]
    if not selected["eligible"] or selected["relativeJointScore"] >= 0.998:
        selected = next(
            item for item in candidates
            if item["marginIndependentWeight"] == 1.0
            and item["totalIndependentWeight"] == 1.0
        )
    fit_final_home, fit_final_away, _ = apply_reference_market_marriage(
        marriage_fit,
        fit_home,
        fit_away,
        float(selected["marginIndependentWeight"]),
        float(selected["totalIndependentWeight"]),
    )
    margin_sigma, total_sigma = calibrated_distribution_scales(
        marriage_fit,
        fit_final_home,
        fit_final_away,
    )
    threshold_final_home, threshold_final_away, threshold_coverage = apply_reference_market_marriage(
        threshold_selection,
        threshold_home,
        threshold_away,
        float(selected["marginIndependentWeight"]),
        float(selected["totalIndependentWeight"]),
    )
    market_only_home, market_only_away, market_only_coverage = apply_reference_market_marriage(
        marriage_fit,
        fit_home,
        fit_away,
        0.0,
        0.0,
    )
    market_only_margin_sigma, market_only_total_sigma = calibrated_distribution_scales(
        marriage_fit,
        market_only_home,
        market_only_away,
    )
    return {
        "method": "earlier_selection_market_weights_later_selection_action_thresholds",
        "readerValidationStatus": "opening_reference_only_not_line_movement_or_splits_validation",
        "selectionMarketProvenance": provenance_counts,
        "timestampedSelectionAuthority": timestamped_selection_authority,
        "documentedOpeningSelectionAuthority": documented_opening_selection_authority,
        "minimumAuthoritativeSelectionRows": minimum_authoritative_rows,
        "selectionRows": int(len(frame)),
        "weightSelectionRows": int(len(marriage_fit)),
        "thresholdSelectionRows": int(len(threshold_selection)),
        "selected": selected,
        "gatePassed": bool(
            documented_opening_selection_authority
            and selected["relativeJointScore"] < 0.998
            and (
                selected["marginIndependentWeight"] < 1.0
                or selected["totalIndependentWeight"] < 1.0
            )
        ),
        "independentWeightSelection": independent_fit_metrics,
        "marketOnlyWeightSelection": metrics(
            marriage_fit,
            market_only_home,
            market_only_away,
            independent_margin_sigma,
            independent_total_sigma,
        ),
        "marketOnlyCoverage": market_only_coverage,
        "marketOnlyDistribution": {
            "marginSigma": market_only_margin_sigma,
            "totalSigma": market_only_total_sigma,
            "calibratedOn": "earlier_weight_selection_partition",
        },
        "finalDistribution": {
            "marginSigma": margin_sigma,
            "totalSigma": total_sigma,
            "calibratedOn": "earlier_weight_selection_partition",
        },
        "_thresholdFrame": threshold_selection,
        "_thresholdHome": threshold_final_home,
        "_thresholdAway": threshold_final_away,
        "thresholdCoverage": threshold_coverage,
        "candidates": candidates,
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
        market_provenance = row.get("evaluation_market_provenance")
        moneyline_home_price = finite_float(row.get("evaluation_opening_moneyline_home_price"))
        moneyline_away_price = finite_float(row.get("evaluation_opening_moneyline_away_price"))
        moneyline_home_sportsbook = row.get("evaluation_opening_moneyline_home_sportsbook")
        moneyline_away_sportsbook = row.get("evaluation_opening_moneyline_away_sportsbook")
        opening_home_spread = finite_float(row.get("evaluation_opening_home_spread"))
        opening_home_spread_price = finite_float(row.get("evaluation_opening_home_spread_price"))
        opening_away_spread_price = finite_float(row.get("evaluation_opening_away_spread_price"))
        opening_home_spread_sportsbook = row.get("evaluation_opening_home_spread_sportsbook")
        opening_away_spread_sportsbook = row.get("evaluation_opening_away_spread_sportsbook")
        opening_total = finite_float(row.get("evaluation_opening_total"))
        opening_over_price = finite_float(row.get("evaluation_opening_over_price"))
        opening_under_price = finite_float(row.get("evaluation_opening_under_price"))
        opening_over_sportsbook = row.get("evaluation_opening_over_sportsbook")
        opening_under_sportsbook = row.get("evaluation_opening_under_sportsbook")
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
                "provenance": market_provenance if isinstance(market_provenance, str) else None,
                "homeWinProbability": market_home_probability,
                "moneylineHomePrice": moneyline_home_price,
                "moneylineHomeSportsbook": moneyline_home_sportsbook if isinstance(moneyline_home_sportsbook, str) else None,
                "moneylineAwayPrice": moneyline_away_price,
                "moneylineAwaySportsbook": moneyline_away_sportsbook if isinstance(moneyline_away_sportsbook, str) else None,
                "homeSpread": opening_home_spread,
                "homeSpreadPrice": opening_home_spread_price,
                "homeSpreadSportsbook": opening_home_spread_sportsbook if isinstance(opening_home_spread_sportsbook, str) else None,
                "awaySpreadPrice": opening_away_spread_price,
                "awaySpreadSportsbook": opening_away_spread_sportsbook if isinstance(opening_away_spread_sportsbook, str) else None,
                "total": opening_total,
                "overPrice": opening_over_price,
                "overSportsbook": opening_over_sportsbook if isinstance(opening_over_sportsbook, str) else None,
                "underPrice": opening_under_price,
                "underSportsbook": opening_under_sportsbook if isinstance(opening_under_sportsbook, str) else None,
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


def calibrated_distribution_scales(
    frame: pd.DataFrame,
    home: np.ndarray,
    away: np.ndarray,
) -> tuple[float, float]:
    """Fit uncertainty on later, out-of-fit forecasts rather than training residuals."""
    residual_margin_sigma, total_sigma = residual_sigmas(frame, home, away)
    predicted_margin = home - away
    outcomes = (frame["target_home_margin"].to_numpy(float) > 0).astype(float)
    candidates = np.linspace(
        max(1.0, residual_margin_sigma * 0.5),
        max(1.01, residual_margin_sigma * 2.0),
        301,
    )
    losses = []
    for scale in candidates:
        probabilities = np.clip(normal_cdf(predicted_margin / scale), 0.001, 0.999)
        losses.append(float(-(
            outcomes * np.log(probabilities) + (1 - outcomes) * np.log(1 - probabilities)
        ).mean()))
    margin_sigma = float(candidates[int(np.argmin(losses))])
    return margin_sigma, total_sigma


def chronological_calibration_partition(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Return earlier development and later calibration rows without outcome overlap."""
    ordered = frame.sort_values(["feature_cutoff", "game_id"]).copy()
    seasons = sorted(int(value) for value in ordered["season"].unique())
    if len(seasons) >= 2:
        calibration_season = seasons[-1]
        development = ordered[ordered["season"] < calibration_season].copy()
        calibration = ordered[ordered["season"] == calibration_season].copy()
    else:
        split = max(1, min(len(ordered) - 1, int(len(ordered) * 0.70)))
        development = ordered.iloc[:split].copy()
        calibration = ordered.iloc[split:].copy()
    if development.empty or calibration.empty:
        raise ValueError("NBA probability calibration requires nonempty chronological partitions")
    return development, calibration


def model_calibration_scales(
    frame: pd.DataFrame,
    features: list[str],
    model: dict[str, Any],
    architecture: str,
) -> tuple[float, float, dict[str, Any]]:
    development, calibration = chronological_calibration_partition(frame)
    home, away, _ = fit_predict(development, calibration, features, model, architecture)
    margin_sigma, total_sigma = calibrated_distribution_scales(calibration, home, away)
    return margin_sigma, total_sigma, {
        "method": "strictly_earlier_fit_later_probability_calibration_log_loss_margin_scale",
        "developmentRows": int(len(development)),
        "calibrationRows": int(len(calibration)),
        "developmentSeasons": sorted(int(value) for value in development["season"].unique()),
        "calibrationSeasons": sorted(int(value) for value in calibration["season"].unique()),
        "marginSigma": margin_sigma,
        "totalSigma": total_sigma,
    }


def baseline_calibration_scales(frame: pd.DataFrame) -> tuple[float, float, dict[str, Any]]:
    development, calibration = chronological_calibration_partition(frame)
    del development
    home, away = rating_baseline(calibration, 2.2)
    margin_sigma, total_sigma = calibrated_distribution_scales(calibration, home, away)
    return margin_sigma, total_sigma, {
        "method": "later_chronological_rating_baseline_probability_calibration",
        "calibrationRows": int(len(calibration)),
        "calibrationSeasons": sorted(int(value) for value in calibration["season"].unique()),
        "marginSigma": margin_sigma,
        "totalSigma": total_sigma,
    }


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
        margin_sigma, total_sigma, calibration = model_calibration_scales(
            train, features, model, architecture
        )
        rows.append({
            "trainingSeasons": sorted(int(value) for value in train["season"].unique()),
            "evaluationSeason": evaluation_season,
            "probabilityCalibration": calibration,
            "metrics": metrics(evaluate, home, away, margin_sigma, total_sigma),
        })
    return rows


def main() -> None:
    args = parse_args()
    frame = validate(read_jsonl(args.features))
    if args.minimum_games_per_season < 1:
        raise ValueError("NBA minimum games per season must be positive")
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
    season_counts = {
        int(season): int(count)
        for season, count in frame.groupby("season")["game_id"].count().sort_index().items()
    }
    undersized = {
        season: count for season, count in season_counts.items()
        if count < args.minimum_games_per_season
    }
    if undersized:
        raise ValueError(
            "NBA tournament refuses partial-season evidence: "
            f"minimum={args.minimum_games_per_season}, observed={undersized}"
        )

    groups = feature_catalog(frame)
    model_specs = candidate_model_specs()
    candidates: list[dict[str, Any]] = []
    for group_name, features in groups.items():
        feature_quality = candidate_feature_quality(train, features)
        for architecture in ("team_scores", "margin_total", "residual_margin_total"):
            for model in model_specs:
                home, away, _ = fit_predict(train, selection, features, model, architecture)
                margin_sigma, total_sigma, probability_calibration = model_calibration_scales(
                    train, features, model, architecture
                )
                candidates.append({
                    "group": group_name,
                    "featureCount": len(features),
                    "featureQuality": feature_quality,
                    "architecture": architecture,
                    "model": model,
                    "probabilityCalibration": probability_calibration,
                    "selection": metrics(selection, home, away, margin_sigma, total_sigma),
                })
    baseline_home, baseline_away = rating_baseline(selection, 2.2)
    baseline_margin_sigma, baseline_total_sigma, baseline_calibration = baseline_calibration_scales(train)
    selection_baseline = metrics(
        selection, baseline_home, baseline_away, baseline_margin_sigma, baseline_total_sigma
    )
    for candidate in candidates:
        candidate["jointSelectionScore"] = joint_selection_score(
            candidate["selection"], selection_baseline
        )
    candidates.sort(key=lambda item: (
        item["jointSelectionScore"],
        item["selection"]["teamScoreMae"],
        item["selection"]["homeWinBrier"],
    ))
    eligible_candidates = [
        item for item in candidates
        if item["featureQuality"]["gatePassed"]
        and item["selection"]["teamScoreMae"] < selection_baseline["teamScoreMae"]
        and item["selection"]["marginMae"] <= selection_baseline["marginMae"] + 0.10
        and item["selection"]["totalMae"] <= selection_baseline["totalMae"] + 0.10
        and item["selection"]["winnerAccuracy"] >= selection_baseline["winnerAccuracy"] - 0.005
        and item["selection"]["homeWinBrier"] <= selection_baseline["homeWinBrier"]
        and item["selection"]["homeWinLogLoss"] <= selection_baseline["homeWinLogLoss"] + 0.005
    ]
    # A single season can reward a model that merely matches that year's pace,
    # officiating, or shot-profile environment. Shortlist on the designated
    # selection season, then rank the shortlist on rolling-origin seasons that
    # all precede confirmation. The worst-season cap prevents a strong average
    # from hiding a material regime failure.
    robustness_frame = frame[frame["season"] <= selection_season].copy()
    robustness_seasons = [
        season for season in sorted(int(value) for value in robustness_frame["season"].unique())
        if not robustness_frame[robustness_frame["season"] < season].empty
    ]
    origin_baselines: dict[int, dict[str, Any]] = {}
    for evaluation_season in robustness_seasons:
        origin_train = robustness_frame[robustness_frame["season"] < evaluation_season].copy()
        origin_evaluate = robustness_frame[robustness_frame["season"] == evaluation_season].copy()
        origin_home, origin_away = rating_baseline(origin_evaluate, 2.2)
        origin_margin_sigma, origin_total_sigma, _ = baseline_calibration_scales(origin_train)
        origin_baselines[evaluation_season] = metrics(
            origin_evaluate,
            origin_home,
            origin_away,
            origin_margin_sigma,
            origin_total_sigma,
        )

    shortlist = (eligible_candidates if eligible_candidates else candidates)[:MULTI_SEASON_SHORTLIST]
    for candidate in shortlist:
        stability = rolling_origin_stability(
            robustness_frame,
            selection_season,
            groups[str(candidate["group"])],
            dict(candidate["model"]),
            str(candidate["architecture"]),
        )
        scored_origins = [{
            **origin,
            "relativeJointScore": joint_selection_score(
                origin["metrics"],
                origin_baselines[int(origin["evaluationSeason"])],
            ),
        } for origin in stability]
        relative_scores = [float(origin["relativeJointScore"]) for origin in scored_origins]
        mean_score = float(np.mean(relative_scores))
        worst_score = float(max(relative_scores))
        robust_score = mean_score + 0.25 * max(0.0, worst_score - 1.0)
        candidate["multiSeasonSelection"] = {
            "method": "selection_shortlist_then_prior_rolling_origins_with_worst_season_penalty",
            "origins": scored_origins,
            "meanRelativeJointScore": mean_score,
            "worstRelativeJointScore": worst_score,
            "robustSelectionScore": robust_score,
            "maximumWorstSeasonRelativeJointScore": MAXIMUM_WORST_SEASON_RELATIVE_JOINT_SCORE,
            "gatePassed": bool(
                len(scored_origins) == len(robustness_seasons)
                and worst_score <= MAXIMUM_WORST_SEASON_RELATIVE_JOINT_SCORE
            ),
        }
    stable_shortlist = [
        candidate for candidate in shortlist
        if candidate["multiSeasonSelection"]["gatePassed"]
    ]
    ranked_shortlist = sorted(
        stable_shortlist if stable_shortlist else shortlist,
        key=lambda item: (
            item["multiSeasonSelection"]["robustSelectionScore"],
            item["jointSelectionScore"],
        ),
    )
    selected = ranked_shortlist[0]
    selection_gate_passed = bool(eligible_candidates and stable_shortlist)

    selected_features = groups[selected["group"]]
    selection_home, selection_away, _ = fit_predict(
        train,
        selection,
        selected_features,
        dict(selected["model"]),
        str(selected["architecture"]),
    )
    selection_margin_sigma = float(selected["probabilityCalibration"]["marginSigma"])
    selection_total_sigma = float(selected["probabilityCalibration"]["totalSigma"])
    market_marriage = select_reference_market_marriage(
        selection,
        selection_home,
        selection_away,
        selection_margin_sigma,
        selection_total_sigma,
    )
    final_margin_sigma = float(market_marriage["finalDistribution"]["marginSigma"])
    final_total_sigma = float(market_marriage["finalDistribution"]["totalSigma"])
    actionable_selection = select_actionable_thresholds(
        market_marriage["_thresholdFrame"],
        market_marriage["_thresholdHome"],
        market_marriage["_thresholdAway"],
        final_margin_sigma,
        final_total_sigma,
    )

    fit = pd.concat([train, selection], ignore_index=True)
    independent_home, independent_away, _ = fit_predict(
        fit,
        confirmation,
        selected_features,
        dict(selected["model"]),
        str(selected["architecture"]),
    )
    independent_margin_sigma, independent_total_sigma, confirmation_probability_calibration = model_calibration_scales(
        fit,
        selected_features,
        dict(selected["model"]),
        str(selected["architecture"]),
    )
    independent_confirmation_metrics = metrics(
        confirmation,
        independent_home,
        independent_away,
        independent_margin_sigma,
        independent_total_sigma,
    )
    final_home, final_away, confirmation_market_coverage = apply_reference_market_marriage(
        confirmation,
        independent_home,
        independent_away,
        float(market_marriage["selected"]["marginIndependentWeight"]),
        float(market_marriage["selected"]["totalIndependentWeight"]),
    )
    final_confirmation_metrics = metrics(
        confirmation,
        final_home,
        final_away,
        final_margin_sigma,
        final_total_sigma,
    )
    market_only_home, market_only_away, market_only_confirmation_coverage = apply_reference_market_marriage(
        confirmation,
        independent_home,
        independent_away,
        0.0,
        0.0,
    )
    market_only_confirmation_metrics = metrics(
        confirmation,
        market_only_home,
        market_only_away,
        float(market_marriage["marketOnlyDistribution"]["marginSigma"]),
        float(market_marriage["marketOnlyDistribution"]["totalSigma"]),
    )
    actionable_confirmation = {
        market: None if details["selected"] is None else actionable_candidate_report(
            confirmation,
            final_home,
            final_away,
            final_margin_sigma,
            final_total_sigma,
            market,
            float(details["selected"]["threshold"]),
        )
        for market, details in actionable_selection.items()
    }
    actionable_benchmark_gates = {
        "moneylineAccuracyMeetsLifetimeReference": (
            actionable_confirmation["moneyline"] is not None and
            actionable_confirmation["moneyline"]["accuracy"] is not None and
            actionable_confirmation["moneyline"]["accuracy"] >= PRODUCT_LIFETIME_REFERENCE["moneyline"]["accuracy"]
        ),
        "totalAccuracyMeetsLifetimeReference": (
            actionable_confirmation["total"] is not None and
            actionable_confirmation["total"]["accuracy"] is not None and
            actionable_confirmation["total"]["accuracy"] >= PRODUCT_LIFETIME_REFERENCE["total"]["accuracy"]
        ),
        "spreadExactPricePositive": (
            actionable_confirmation["spread"] is not None and
            actionable_confirmation["spread"]["exactPriceCoverage"] is not None and
            actionable_confirmation["spread"]["exactPriceCoverage"] >= MINIMUM_CONFIRMATION_EXACT_PRICE_COVERAGE and
            actionable_confirmation["spread"]["exactPrice"] is not None and
            actionable_confirmation["spread"]["exactPrice"]["bets"] >= MINIMUM_CONFIRMATION_EXACT_PRICE_BETS and
            actionable_confirmation["spread"]["exactPrice"]["sportsbookCoverage"] == 1.0 and
            actionable_confirmation["spread"]["exactPrice"]["units"] > 0
        ),
        "totalExactPricePositive": (
            actionable_confirmation["total"] is not None and
            actionable_confirmation["total"]["exactPriceCoverage"] is not None and
            actionable_confirmation["total"]["exactPriceCoverage"] >= MINIMUM_CONFIRMATION_EXACT_PRICE_COVERAGE and
            actionable_confirmation["total"]["exactPrice"] is not None and
            actionable_confirmation["total"]["exactPrice"]["bets"] >= MINIMUM_CONFIRMATION_EXACT_PRICE_BETS and
            actionable_confirmation["total"]["exactPrice"]["sportsbookCoverage"] == 1.0 and
            actionable_confirmation["total"]["exactPrice"]["units"] > 0
        ),
        "moneylineExactPricePositive": (
            actionable_confirmation["moneyline"] is not None and
            actionable_confirmation["moneyline"]["exactPriceCoverage"] is not None and
            actionable_confirmation["moneyline"]["exactPriceCoverage"] >= MINIMUM_CONFIRMATION_EXACT_PRICE_COVERAGE and
            actionable_confirmation["moneyline"]["exactPrice"] is not None and
            actionable_confirmation["moneyline"]["exactPrice"]["bets"] >= MINIMUM_CONFIRMATION_EXACT_PRICE_BETS and
            actionable_confirmation["moneyline"]["exactPrice"]["sportsbookCoverage"] == 1.0 and
            actionable_confirmation["moneyline"]["exactPrice"]["units"] > 0
        ),
    }

    confirmation_baseline_home, confirmation_baseline_away = rating_baseline(confirmation, 2.2)
    confirmation_baseline_margin_sigma, confirmation_baseline_total_sigma, confirmation_baseline_calibration = (
        baseline_calibration_scales(fit)
    )
    confirmation_baseline = metrics(
        confirmation,
        confirmation_baseline_home,
        confirmation_baseline_away,
        confirmation_baseline_margin_sigma,
        confirmation_baseline_total_sigma,
    )
    correction_ledger = winner_corrections_and_harms(
        confirmation,
        final_home,
        final_away,
        confirmation_baseline_home,
        confirmation_baseline_away,
    )
    market_correction_ledger = winner_corrections_and_harms(
        confirmation,
        final_home,
        final_away,
        independent_home,
        independent_away,
    )
    final_product_gates = {
        "combinedTeamScoreMaeImprovesIndependent": (
            final_confirmation_metrics["teamScoreMae"] < independent_confirmation_metrics["teamScoreMae"]
        ),
        "combinedMarginMaeNoMaterialRegression": (
            final_confirmation_metrics["marginMae"] <= independent_confirmation_metrics["marginMae"] + 0.10
        ),
        "combinedTotalMaeNoMaterialRegression": (
            final_confirmation_metrics["totalMae"] <= independent_confirmation_metrics["totalMae"] + 0.10
        ),
        "combinedWinnerAccuracyNoMaterialRegression": (
            final_confirmation_metrics["winnerAccuracy"] >= independent_confirmation_metrics["winnerAccuracy"] - 0.005
        ),
        "combinedHomeWinBrierNoMaterialRegression": (
            final_confirmation_metrics["homeWinBrier"] <= independent_confirmation_metrics["homeWinBrier"] + 0.005
        ),
        "combinedHomeWinLogLossNoMaterialRegression": (
            final_confirmation_metrics["homeWinLogLoss"] <= independent_confirmation_metrics["homeWinLogLoss"] + 0.005
        ),
        "marketWinnerNetCorrectionsNonnegative": market_correction_ledger["netCorrections"] >= 0,
        "marketMarriageSelectedBeforeConfirmation": True,
        "documentedOpeningMarketSelectionValidated": bool(
            market_marriage["documentedOpeningSelectionAuthority"]
        ),
        "timestampedMarketSelectionValidated": bool(market_marriage["timestampedSelectionAuthority"]),
        "historicalMovementReaderValidated": False,
        "historicalSplitsReaderValidated": False,
        **actionable_benchmark_gates,
    }
    final_product_gate_passed = all(final_product_gates.values())
    uncertainty = bootstrap_confirmation(
        confirmation,
        final_home,
        final_away,
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
            "teamScoreMaeImproves": final_confirmation_metrics["teamScoreMae"] < R1_CONFIRMATION["teamScoreMae"],
            "marginMaeNoWorse": final_confirmation_metrics["marginMae"] <= R1_CONFIRMATION["marginMae"],
            "totalMaeNoWorse": final_confirmation_metrics["totalMae"] <= R1_CONFIRMATION["totalMae"],
            "winnerAccuracyNoWorse": final_confirmation_metrics["winnerAccuracy"] >= R1_CONFIRMATION["winnerAccuracy"],
        }

    prediction_rows = build_prediction_ledger(
        confirmation,
        final_home,
        final_away,
        final_margin_sigma,
        final_total_sigma,
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
    _, _, deployment_state = fit_predict(
        frame,
        frame.iloc[:1].copy(),
        selected_features,
        dict(selected["model"]),
        str(selected["architecture"]),
    )
    deployment_coefficients = {
        key: value.tolist()
        for key, value in deployment_state.items()
        if isinstance(value, np.ndarray)
    }
    deployment_artifact = {
        "release": DEPLOYMENT_CANDIDATE_RELEASE,
        "tournamentRelease": RELEASE,
        "featureRelease": FEATURE_RELEASE,
        "status": "research_candidate_not_authorized_for_production",
        "promotionAuthorized": False,
        "trainingRows": int(len(frame)),
        "trainingSeasons": seasons,
        "featureFileSha256": hashlib.sha256(args.features.read_bytes()).hexdigest(),
        "featureGroup": selected["group"],
        "architecture": selected["architecture"],
        "model": selected["model"],
        "design": deployment_state["design"],
        "coefficients": deployment_coefficients,
        "marketMarriage": {
            "marginIndependentWeight": market_marriage["selected"]["marginIndependentWeight"],
            "totalIndependentWeight": market_marriage["selected"]["totalIndependentWeight"],
        },
        "distribution": {
            "family": "normal_residual",
            "marginSigma": final_margin_sigma,
            "totalSigma": final_total_sigma,
            "calibratedOn": "earlier_weight_selection_partition",
        },
        "actionableThresholds": {
            market: None if details["selected"] is None else {
                "selectionRule": details["selected"]["selectionRule"],
                "threshold": details["selected"]["threshold"],
                "minimumSelectionBets": details["minimumSelectionBets"],
            }
            for market, details in actionable_selection.items()
        },
    }
    deployment_artifact_path = args.output / "deployment-candidate.json"
    deployment_artifact_body = json.dumps(deployment_artifact, indent=2, sort_keys=True) + "\n"
    deployment_artifact_path.write_text(deployment_artifact_body)
    predictions_path = args.output / "confirmation-predictions.jsonl"
    predictions_body = "".join(json.dumps(row, sort_keys=True) + "\n" for row in prediction_rows)
    predictions_path.write_text(predictions_body)
    diagnostics_path = args.output / "confirmation-diagnostics.json"
    diagnostics_body = json.dumps(diagnostics, indent=2, sort_keys=True) + "\n"
    diagnostics_path.write_text(diagnostics_body)
    feature_coverage = feature_coverage_report(
        frame,
        groups["all_declared"],
        selected_features,
    )
    feature_coverage_path = args.output / "feature-coverage.json"
    feature_coverage_body = json.dumps(feature_coverage, indent=2, sort_keys=True) + "\n"
    feature_coverage_path.write_text(feature_coverage_body)

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
        "sampleBoundary": {
            "competition": "NBA",
            "seasonType": "regular_season_only",
            "preseasonEligible": False,
            "postseasonEligible": False,
            "minimumGamesPerSeason": args.minimum_games_per_season,
            "gamesBySeason": season_counts,
        },
        "selected": selected,
        "selectionGatePassed": selection_gate_passed,
        "selectionGate": {
            "ranking": "selection_shortlist_then_multiseason_robust_relative_joint_score",
            "shortlistSize": MULTI_SEASON_SHORTLIST,
            "maximumWorstSeasonRelativeJointScore": MAXIMUM_WORST_SEASON_RELATIVE_JOINT_SCORE,
            "rankingWeights": {
                "teamScoreMae": 0.25,
                "marginMae": 0.20,
                "totalMae": 0.20,
                "homeWinBrier": 0.20,
                "homeWinLogLoss": 0.10,
                "winnerErrorRate": 0.05,
            },
            "featureQuality": {
                "evaluatedOn": "training_partition_only",
                "minimumCoverage": 0.50,
                "minimumUsableFraction": 0.80,
            },
            "requiresTeamScoreMaeImprovement": True,
            "marginMaeMaximumRegression": 0.10,
            "totalMaeMaximumRegression": 0.10,
            "winnerAccuracyMaximumRegression": 0.005,
            "homeWinBrierMaximumRegression": 0.0,
            "homeWinLogLossMaximumRegression": 0.005,
        },
        "selectionBaseline": selection_baseline,
        "selectionBaselineProbabilityCalibration": baseline_calibration,
        "confirmation": final_confirmation_metrics,
        "independentConfirmation": independent_confirmation_metrics,
        "marketOnlyConfirmation": market_only_confirmation_metrics,
        "finalCombinedConfirmation": final_confirmation_metrics,
        "marketMarriage": {
            **{key: value for key, value in market_marriage.items() if not key.startswith("_")},
            "confirmationCoverage": confirmation_market_coverage,
            "marketOnlyConfirmationCoverage": market_only_confirmation_coverage,
            "confirmationCorrectionsVsIndependent": market_correction_ledger,
            "limitations": [
                "Public historical references with unknown timestamps can test score anchoring only.",
                "Timestamped BALLDONTLIE openings are required before opener economics are authoritative.",
                "Historical line movement and split sequences are unavailable, so those reader rules remain forward-validation only.",
            ],
        },
        "confirmationDistribution": {
            "marginSigma": final_margin_sigma,
            "totalSigma": final_total_sigma,
            "source": "frozen_market_marriage_selection_partition",
        },
        "confirmationProbabilityCalibration": confirmation_probability_calibration,
        "confirmationRatingBaseline": confirmation_baseline,
        "confirmationRatingBaselineProbabilityCalibration": confirmation_baseline_calibration,
        "confirmationWinnerChangesVsRatingBaseline": correction_ledger,
        "confirmationUncertainty": uncertainty,
        "rollingOriginStability": stability,
        "publishedR1Confirmation": R1_CONFIRMATION,
        "publishedR1DirectlyComparable": r1_comparable,
        "publishedR1Gates": r1_gates,
        "productLifetimeReference": PRODUCT_LIFETIME_REFERENCE,
        "actionableThresholdSelection": actionable_selection,
        "actionableConfirmation": actionable_confirmation,
        "actionableBenchmarkGates": actionable_benchmark_gates,
        "actionableExactPriceGate": {
            "minimumBets": MINIMUM_CONFIRMATION_EXACT_PRICE_BETS,
            "minimumSignalCoverage": MINIMUM_CONFIRMATION_EXACT_PRICE_COVERAGE,
            "requiresCompleteSportsbookProvenance": True,
            "requiresPositiveUnits": True,
        },
        "finalProductGates": final_product_gates,
        "finalProductGatePassed": final_product_gate_passed,
        "promotionAuthorized": False,
        "promotionNote": "Score confirmation alone cannot authorize production; market, exact-price, board-impact, runtime, and lock gates remain.",
        "deploymentCandidate": {
            "release": DEPLOYMENT_CANDIDATE_RELEASE,
            "file": deployment_artifact_path.name,
            "sha256": hashlib.sha256(deployment_artifact_body.encode()).hexdigest(),
            "promotionAuthorized": False,
        },
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
        "featureCoverage": {
            "file": feature_coverage_path.name,
            "sha256": hashlib.sha256(feature_coverage_body.encode()).hexdigest(),
            "features": feature_coverage["features"],
            "selectedFeatures": feature_coverage["selectedFeatures"],
            "fullyMissing": feature_coverage["fullyMissing"],
            "belowHalfCoverage": feature_coverage["belowHalfCoverage"],
            "constantWhenPresent": feature_coverage["constantWhenPresent"],
        },
        "errorLedgers": error_artifacts,
    }
    report_path = args.output / "report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "report": str(report_path),
        "selected": selected,
        "independentConfirmation": independent_confirmation_metrics,
        "finalCombinedConfirmation": final_confirmation_metrics,
    }, indent=2))


if __name__ == "__main__":
    main()
