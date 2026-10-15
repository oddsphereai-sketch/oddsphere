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
from sklearn.impute import SimpleImputer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


RELEASE = "nba_professional_tournament_2026_10_15_r1"
FEATURE_RELEASE = "nba_point_in_time_features_2026_10_15_r1"
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
        if column not in IDENTITY + TARGETS and pd.api.types.is_numeric_dtype(frame[column])
    ]

    def chosen(tokens: tuple[str, ...]) -> list[str]:
        return [column for column in numeric if any(token in column for token in tokens)]

    ratings = chosen(("league_off_rating", "adjusted_", "offRating_", "defRating_", "pace_", "current_games", "prior_games"))
    schedule = chosen(("rest_days", "back_to_back", "games_last_4_days", "games_last_7_days"))
    four_factors = chosen(("efg_", "turnoverRate_", "offensiveReboundRate_", "freeThrowRate_", "opponent"))
    volatility = chosen(("margin_sd_", "total_rating_sd_"))
    rotation = chosen(("rotationPlayers_", "top3MinutesShare_", "top8MinutesShare_", "rotationMinutesEntropy_"))
    groups = {
        "ratings": sorted(set(ratings)),
        "ratings_schedule": sorted(set(ratings + schedule)),
        "four_factors_schedule": sorted(set(ratings + schedule + four_factors + volatility)),
        "all_declared": sorted(set(ratings + schedule + four_factors + volatility + rotation)),
    }
    for name, columns in groups.items():
        if not columns:
            raise ValueError(f"NBA feature group {name} is empty")
    return groups


def pipeline(alpha: float) -> Pipeline:
    return Pipeline([
        ("impute", SimpleImputer(strategy="median", add_indicator=True)),
        ("scale", StandardScaler()),
        ("ridge", Ridge(alpha=alpha)),
    ])


def fit_predict(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    features: list[str],
    alpha: float,
    architecture: str,
) -> tuple[np.ndarray, np.ndarray, dict[str, Pipeline]]:
    x_train = train[features]
    x_evaluate = evaluate[features]
    models: dict[str, Pipeline] = {}
    if architecture == "team_scores":
        for target in ("target_home_score", "target_away_score"):
            models[target] = pipeline(alpha).fit(x_train, train[target])
        home = models["target_home_score"].predict(x_evaluate)
        away = models["target_away_score"].predict(x_evaluate)
        return home, away, models
    if architecture == "margin_total":
        for target in ("target_home_margin", "target_total"):
            models[target] = pipeline(alpha).fit(x_train, train[target])
        margin = models["target_home_margin"].predict(x_evaluate)
        total = models["target_total"].predict(x_evaluate)
        return (total + margin) / 2, (total - margin) / 2, models
    raise ValueError(f"unsupported architecture {architecture}")


def normal_cdf(values: np.ndarray) -> np.ndarray:
    erf = np.vectorize(math.erf)
    return 0.5 * (1.0 + erf(values / math.sqrt(2.0)))


def metrics(frame: pd.DataFrame, home: np.ndarray, away: np.ndarray, sigma: float) -> dict[str, Any]:
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    actual_margin = actual_home - actual_away
    actual_total = actual_home + actual_away
    predicted_margin = home - away
    predicted_total = home + away
    probabilities = np.clip(normal_cdf(predicted_margin / max(sigma, 1e-6)), 0.001, 0.999)
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
    alphas = [0.1, 1.0, 10.0, 100.0, 1000.0]
    candidates: list[dict[str, Any]] = []
    for group_name, features in groups.items():
        for architecture in ("team_scores", "margin_total"):
            for alpha in alphas:
                home, away, _ = fit_predict(train, selection, features, alpha, architecture)
                train_home, train_away, _ = fit_predict(train, train, features, alpha, architecture)
                sigma = float(np.std(
                    train["target_home_margin"].to_numpy(float) - (train_home - train_away), ddof=1,
                ))
                candidates.append({
                    "group": group_name,
                    "featureCount": len(features),
                    "architecture": architecture,
                    "alpha": alpha,
                    "selection": metrics(selection, home, away, sigma),
                })
    baseline_home, baseline_away = rating_baseline(selection, 2.2)
    baseline_fit_home, baseline_fit_away = rating_baseline(train, 2.2)
    baseline_sigma = float(np.std(
        train["target_home_margin"].to_numpy(float) - (baseline_fit_home - baseline_fit_away), ddof=1,
    ))
    selection_baseline = metrics(selection, baseline_home, baseline_away, baseline_sigma)
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
        float(selected["alpha"]),
        str(selected["architecture"]),
    )
    fit_home, fit_away, _ = fit_predict(
        fit,
        fit,
        selected_features,
        float(selected["alpha"]),
        str(selected["architecture"]),
    )
    sigma = float(np.std(
        fit["target_home_margin"].to_numpy(float) - (fit_home - fit_away), ddof=1,
    ))
    confirmation_metrics = metrics(confirmation, home, away, sigma)

    confirmation_baseline_home, confirmation_baseline_away = rating_baseline(confirmation, 2.2)
    confirmation_baseline = metrics(confirmation, confirmation_baseline_home, confirmation_baseline_away, baseline_sigma)

    r1_comparable = confirmation_season == R1_CONFIRMATION["season"] and len(confirmation) == R1_CONFIRMATION["games"]
    r1_gates = None
    if r1_comparable:
        r1_gates = {
            "teamScoreMaeImproves": confirmation_metrics["teamScoreMae"] < R1_CONFIRMATION["teamScoreMae"],
            "marginMaeNoWorse": confirmation_metrics["marginMae"] <= R1_CONFIRMATION["marginMae"],
            "totalMaeNoWorse": confirmation_metrics["totalMae"] <= R1_CONFIRMATION["totalMae"],
            "winnerAccuracyNoWorse": confirmation_metrics["winnerAccuracy"] >= R1_CONFIRMATION["winnerAccuracy"],
        }

    prediction_rows = []
    for index, (_, row) in enumerate(confirmation.reset_index(drop=True).iterrows()):
        prediction_rows.append({
            "gameId": int(row["game_id"]),
            "featureCutoff": row["feature_cutoff"].isoformat(),
            "actualHome": float(row["target_home_score"]),
            "actualAway": float(row["target_away_score"]),
            "predictedHome": float(home[index]),
            "predictedAway": float(away[index]),
        })

    args.output.mkdir(parents=True, exist_ok=True)
    predictions_path = args.output / "confirmation-predictions.jsonl"
    predictions_body = "".join(json.dumps(row, sort_keys=True) + "\n" for row in prediction_rows)
    predictions_path.write_text(predictions_body)
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
        "confirmationRatingBaseline": confirmation_baseline,
        "publishedR1Confirmation": R1_CONFIRMATION,
        "publishedR1DirectlyComparable": r1_comparable,
        "publishedR1Gates": r1_gates,
        "promotionAuthorized": False,
        "promotionNote": "Score confirmation alone cannot authorize production; market, exact-price, board-impact, runtime, and lock gates remain.",
        "topSelectionCandidates": candidates[:10],
        "predictions": {
            "file": predictions_path.name,
            "sha256": hashlib.sha256(predictions_body.encode()).hexdigest(),
        },
    }
    report_path = args.output / "report.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"report": str(report_path), "selected": selected, "confirmation": confirmation_metrics}, indent=2))


if __name__ == "__main__":
    main()
