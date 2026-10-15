#!/usr/bin/env python3
"""Research-only nonlinear NBA score challengers with sealed confirmation.

Candidates are ranked on rolling-origin 2022-24 seasons relative to the stable
ridge incumbent. The 2025 confirmation season is evaluated only after one
candidate has been selected. No production artifact or database row is written.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.impute import SimpleImputer

from scripts.operator import tournament_nba_professional_model as professional


RELEASE = "nba_nonlinear_challenger_audit_2026_10_15_r1_season_robust"
INCUMBENT = {
    "group": "ratings_schedule",
    "architecture": "margin_total",
    "model": {"family": "ridge", "alpha": 1000.0},
}
GROUPS = (
    "ratings_schedule_season_regime",
    "four_factors_schedule",
    "rotation_schedule",
)
MODEL_SPECS: tuple[dict[str, Any], ...] = (
    {
        "family": "hist_gradient_boosting",
        "loss": "squared_error",
        "learning_rate": 0.035,
        "max_iter": 250,
        "max_leaf_nodes": 15,
        "min_samples_leaf": 30,
        "l2_regularization": 10.0,
    },
    {
        "family": "hist_gradient_boosting",
        "loss": "absolute_error",
        "learning_rate": 0.04,
        "max_iter": 225,
        "max_leaf_nodes": 15,
        "min_samples_leaf": 40,
        "l2_regularization": 10.0,
    },
    {
        "family": "extra_trees",
        "n_estimators": 350,
        "max_depth": 10,
        "min_samples_leaf": 15,
        "max_features": 0.75,
    },
    {
        "family": "random_forest",
        "n_estimators": 350,
        "max_depth": 10,
        "min_samples_leaf": 15,
        "max_features": 0.75,
    },
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--features", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--confirmation-season", type=int, default=2025)
    return parser.parse_args()


def usable_features(train: pd.DataFrame, requested: list[str]) -> list[str]:
    usable = []
    for column in requested:
        values = pd.to_numeric(train[column], errors="coerce")
        if float(values.notna().mean()) < 0.50 or int(values.nunique(dropna=True)) < 2:
            continue
        usable.append(column)
    if len(usable) < 6:
        raise ValueError("nonlinear NBA candidate has fewer than six usable features")
    return usable


def build_estimator(spec: dict[str, Any], seed: int):
    kwargs = {key: value for key, value in spec.items() if key != "family"}
    family = str(spec["family"])
    if family == "hist_gradient_boosting":
        return HistGradientBoostingRegressor(**kwargs, random_state=seed)
    if family == "extra_trees":
        return ExtraTreesRegressor(**kwargs, random_state=seed, n_jobs=-1)
    if family == "random_forest":
        return RandomForestRegressor(**kwargs, random_state=seed, n_jobs=-1)
    raise ValueError(f"unsupported nonlinear NBA family {family}")


def fit_predict(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    requested_features: list[str],
    spec: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    features = usable_features(train, requested_features)
    imputer = SimpleImputer(strategy="median", add_indicator=True, keep_empty_features=False)
    x_train = imputer.fit_transform(train[features].to_numpy(float))
    x_evaluate = imputer.transform(evaluate[features].to_numpy(float))
    predictions: dict[str, np.ndarray] = {}
    for offset, target in enumerate(("target_home_margin", "target_total")):
        estimator = build_estimator(spec, 20261015 + offset)
        estimator.fit(x_train, train[target].to_numpy(float))
        predictions[target] = estimator.predict(x_evaluate)
    margin = predictions["target_home_margin"]
    total = predictions["target_total"]
    return (total + margin) / 2, (total - margin) / 2, features


def score(frame: pd.DataFrame, home: np.ndarray, away: np.ndarray) -> dict[str, float | int]:
    actual_home = frame["target_home_score"].to_numpy(float)
    actual_away = frame["target_away_score"].to_numpy(float)
    actual_margin = actual_home - actual_away
    actual_total = actual_home + actual_away
    predicted_margin = home - away
    predicted_total = home + away
    return {
        "games": int(len(frame)),
        "teamScoreMae": float(((np.abs(home - actual_home) + np.abs(away - actual_away)) / 2).mean()),
        "marginMae": float(np.abs(predicted_margin - actual_margin).mean()),
        "totalMae": float(np.abs(predicted_total - actual_total).mean()),
        "winnerAccuracy": float(((predicted_margin > 0) == (actual_margin > 0)).mean()),
        "marginSignedBias": float((predicted_margin - actual_margin).mean()),
        "totalSignedBias": float((predicted_total - actual_total).mean()),
    }


def relative_score(candidate: dict[str, Any], incumbent: dict[str, Any]) -> float:
    winner_error = max(1e-9, 1 - float(candidate["winnerAccuracy"]))
    incumbent_winner_error = max(1e-9, 1 - float(incumbent["winnerAccuracy"]))
    return float(
        0.30 * float(candidate["teamScoreMae"]) / float(incumbent["teamScoreMae"])
        + 0.25 * float(candidate["marginMae"]) / float(incumbent["marginMae"])
        + 0.25 * float(candidate["totalMae"]) / float(incumbent["totalMae"])
        + 0.20 * winner_error / incumbent_winner_error
    )


def incumbent_predictions(
    train: pd.DataFrame,
    evaluate: pd.DataFrame,
    groups: dict[str, list[str]],
) -> tuple[np.ndarray, np.ndarray]:
    home, away, _ = professional.fit_predict(
        train,
        evaluate,
        groups[str(INCUMBENT["group"])],
        dict(INCUMBENT["model"]),
        str(INCUMBENT["architecture"]),
    )
    return home, away


def stage_cohorts(frame: pd.DataFrame, home: np.ndarray, away: np.ndarray) -> list[dict[str, Any]]:
    team_games = np.minimum(
        frame["home_current_games"].to_numpy(float),
        frame["away_current_games"].to_numpy(float),
    )
    stages = (
        ("opening", team_games < 5),
        ("developing", (team_games >= 5) & (team_games < 15)),
        ("established", team_games >= 15),
    )
    return [{"stage": name, **score(frame.loc[mask], home[mask], away[mask])}
            for name, mask in stages if int(mask.sum()) > 0]


def main() -> None:
    args = parse_args()
    frame = professional.validate(professional.read_jsonl(args.features))
    groups = professional.feature_catalog(frame)
    confirmation = frame[frame["season"] == args.confirmation_season].copy()
    selection_frame = frame[frame["season"] < args.confirmation_season].copy()
    origins = [
        season for season in sorted(int(value) for value in selection_frame["season"].unique())
        if not selection_frame[selection_frame["season"] < season].empty
    ]
    if len(origins) < 2 or confirmation.empty:
        raise ValueError("NBA nonlinear audit needs multiple pre-confirmation origins and a sealed confirmation season")

    incumbent_by_origin: dict[int, dict[str, Any]] = {}
    for season in origins:
        train = selection_frame[selection_frame["season"] < season].copy()
        evaluate = selection_frame[selection_frame["season"] == season].copy()
        home, away = incumbent_predictions(train, evaluate, groups)
        incumbent_by_origin[season] = score(evaluate, home, away)

    candidates: list[dict[str, Any]] = []
    for group in GROUPS:
        for spec in MODEL_SPECS:
            origin_rows = []
            final_feature_count = 0
            for season in origins:
                train = selection_frame[selection_frame["season"] < season].copy()
                evaluate = selection_frame[selection_frame["season"] == season].copy()
                home, away, features = fit_predict(train, evaluate, groups[group], dict(spec))
                final_feature_count = len(features)
                metrics = score(evaluate, home, away)
                origin_rows.append({
                    "evaluationSeason": season,
                    "metrics": metrics,
                    "incumbent": incumbent_by_origin[season],
                    "relativeScore": relative_score(metrics, incumbent_by_origin[season]),
                })
            relative_scores = [float(row["relativeScore"]) for row in origin_rows]
            worst = max(relative_scores)
            mean = float(np.mean(relative_scores))
            candidates.append({
                "group": group,
                "usableFeatureCount": final_feature_count,
                "model": spec,
                "origins": origin_rows,
                "meanRelativeScore": mean,
                "worstRelativeScore": worst,
                "robustScore": mean + 0.25 * max(0.0, worst - 1.0),
                "selectionGatePassed": bool(mean < 0.995 and worst <= 1.02),
            })
    candidates.sort(key=lambda row: (row["robustScore"], row["worstRelativeScore"]))
    selected = candidates[0]

    fit = selection_frame.copy()
    nonlinear_home, nonlinear_away, selected_features = fit_predict(
        fit,
        confirmation,
        groups[str(selected["group"])],
        dict(selected["model"]),
    )
    incumbent_home, incumbent_away = incumbent_predictions(fit, confirmation, groups)
    nonlinear_confirmation = score(confirmation, nonlinear_home, nonlinear_away)
    incumbent_confirmation = score(confirmation, incumbent_home, incumbent_away)
    confirmation_gate = bool(
        nonlinear_confirmation["teamScoreMae"] < incumbent_confirmation["teamScoreMae"]
        and nonlinear_confirmation["marginMae"] <= incumbent_confirmation["marginMae"] + 0.05
        and nonlinear_confirmation["totalMae"] <= incumbent_confirmation["totalMae"] + 0.05
        and nonlinear_confirmation["winnerAccuracy"] >= incumbent_confirmation["winnerAccuracy"] - 0.002
    )
    report = {
        "release": RELEASE,
        "status": "research_only_no_production_change",
        "method": "rolling_origin_selection_2022_2024_then_single_2025_confirmation",
        "seasonRegimePolicy": "features are leakage-safe and scored separately by season; no pooled raw historical baseline",
        "incumbent": INCUMBENT,
        "selectionOrigins": origins,
        "selected": selected,
        "selectedUsableFeatures": selected_features,
        "confirmationSeason": args.confirmation_season,
        "confirmation": {
            "nonlinear": nonlinear_confirmation,
            "incumbent": incumbent_confirmation,
            "relativeScore": relative_score(nonlinear_confirmation, incumbent_confirmation),
            "nonlinearSeasonStages": stage_cohorts(confirmation, nonlinear_home, nonlinear_away),
            "incumbentSeasonStages": stage_cohorts(confirmation, incumbent_home, incumbent_away),
            "gatePassed": confirmation_gate,
        },
        "promotionEligible": bool(selected["selectionGatePassed"] and confirmation_gate),
        "candidates": candidates,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({
        "report": str(args.output),
        "selected": {
            "group": selected["group"],
            "model": selected["model"],
            "meanRelativeScore": selected["meanRelativeScore"],
            "worstRelativeScore": selected["worstRelativeScore"],
            "selectionGatePassed": selected["selectionGatePassed"],
        },
        "confirmation": report["confirmation"],
        "promotionEligible": report["promotionEligible"],
    }, indent=2))


if __name__ == "__main__":
    main()
