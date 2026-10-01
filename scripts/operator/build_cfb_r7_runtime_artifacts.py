#!/usr/bin/env python3
"""Build the selected CFB r7 compact independent-score runtime artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor
from sklearn.pipeline import Pipeline

from tournament_cfb_v1_model import ROLLING_KEYS, build_dataset, normalized_name, read_sources
from tournament_cfb_symmetric_matchup_score_r4 import direct_features, model_families, team_rows


BASE_RELEASE = "cfb_professional_joint_score_artifact_2026_10_01_r7_compact48"
WEEKLY_RELEASE = "cfb_professional_weekly_runtime_2026_10_01_r7_compact48"
MODEL_RELEASE = "cfb_professional_independent_score_model_2026_10_01_r7_compact48"
DISTRIBUTION_RELEASE = "cfb_professional_empirical_joint_distribution_2026_10_01_r7_compact48"
PROBABILITY_RELEASE = "cfb_professional_joint_probability_2026_10_01_r7_compact48"
REPRESENTATIVE_RELEASE = "cfb_professional_reachable_score_2026_10_01_r7_compact48"
PRIOR_GAMES = 4.0
TREES = 48
DOMAIN_THRESHOLD = 7.0


def checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def finite_or_none(value: object) -> float | None:
    try:
        parsed = float(value)
        return parsed if np.isfinite(parsed) else None
    except (TypeError, ValueError):
        return None


def imputer_payload(pipeline: Pipeline, features: list[str]) -> dict[str, Any]:
    imputer = pipeline.named_steps["imputer"]
    indicator = list(getattr(imputer.indicator_, "features_", [])) if getattr(imputer, "indicator_", None) is not None else []
    return {
        "inputFeatures": features,
        "imputerStatistics": [finite_or_none(value) for value in imputer.statistics_],
        "missingIndicatorFeatureIndexes": [int(value) for value in indicator],
    }


def linear_artifact(pipeline: Pipeline, features: list[str]) -> dict[str, Any]:
    payload = imputer_payload(pipeline, features)
    scaler = pipeline.named_steps["scale"]
    model = pipeline.named_steps["model"]
    return {**payload, "kind": "linear_regressor", "scalerMean": [float(value) for value in scaler.mean_], "scalerScale": [float(value) for value in scaler.scale_], "coefficients": [float(value) for value in model.coef_], "intercept": float(model.intercept_)}


def forest_artifact(pipeline: Pipeline, features: list[str]) -> dict[str, Any]:
    payload = imputer_payload(pipeline, features)
    model = pipeline.named_steps["model"]
    if not isinstance(model, ExtraTreesRegressor):
        raise TypeError(type(model))
    trees = []
    for estimator in model.estimators_:
        tree = estimator.tree_
        missing = getattr(tree, "missing_go_to_left", np.zeros(tree.node_count, dtype=bool))
        nodes = []
        for index in range(tree.node_count):
            leaf = int(tree.children_left[index]) == int(tree.children_right[index])
            threshold = float(tree.threshold[index])
            nodes.append([float(np.ravel(tree.value[index])[0]), int(tree.feature[index]), threshold if np.isfinite(threshold) else (1e308 if threshold > 0 else -1e308), 1 if bool(missing[index]) else 0, int(tree.children_left[index]), int(tree.children_right[index]), 1 if leaf else 0])
        trees.append({"nodes": nodes})
    return {**payload, "kind": "extra_trees_regressor", "trees": trees}


def hgb_artifact(pipeline: Pipeline, features: list[str]) -> dict[str, Any]:
    payload = imputer_payload(pipeline, features)
    model = pipeline.named_steps["model"]
    if not isinstance(model, HistGradientBoostingRegressor):
        raise TypeError(type(model))
    iterations = []
    for iteration in model._predictors:  # noqa: SLF001 - frozen sklearn export
        trees = []
        for predictor in iteration:
            nodes = []
            for node in predictor.nodes:
                if bool(node["is_categorical"]):
                    raise RuntimeError("categorical HGB nodes are unsupported")
                threshold = float(node["num_threshold"])
                nodes.append([float(node["value"]), int(node["feature_idx"]), threshold if np.isfinite(threshold) else (1e308 if threshold > 0 else -1e308), 1 if bool(node["missing_go_to_left"]) else 0, int(node["left"]), int(node["right"]), 1 if bool(node["is_leaf"]) else 0])
            trees.append({"nodes": nodes})
        iterations.append(trees)
    return {**payload, "kind": "hgb_regressor", "baseline": float(np.ravel(model._baseline_prediction)[0]), "trees": iterations}  # noqa: SLF001


def compact_forest(seed: int) -> Pipeline:
    pipeline = model_families(seed)["extra_trees"]
    pipeline.set_params(model__n_estimators=TREES)
    return pipeline


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", required=True)
    parser.add_argument("--base-output", default="lib/services/football/modelArtifacts/cfbProfessionalScoreArtifact.json")
    parser.add_argument("--weekly-output", default="lib/services/football/modelArtifacts/cfbProfessionalScoreWeeklyArtifact.json")
    parser.add_argument("--season", type=int, default=2026)
    parser.add_argument("--seed", type=int, default=20260930)
    args = parser.parse_args()

    frames, checksums = read_sources(Path(args.source_dir))
    data = build_dataset(frames, current_season_prior_games=PRIOR_GAMES, include_opponent_adjusted_matchups=True).replace([np.inf, -np.inf], np.nan)
    historical = data[data.home_score.notna() & data.away_score.notna()].copy()
    runtime_seed = args.seed + args.season
    team_x, team_y, _ = team_rows(historical)
    margin_x = direct_features(historical, "margin")
    total_x = direct_features(historical, "total")
    actual_margin = historical.home_score.to_numpy(float) - historical.away_score.to_numpy(float)
    actual_total = historical.home_score.to_numpy(float) + historical.away_score.to_numpy(float)
    score_model = model_families(runtime_seed)["elastic_net"]
    margin_model = compact_forest(runtime_seed + 101)
    total_hist_model = model_families(runtime_seed + 202)["hist_gradient_boosting"]
    total_forest_model = compact_forest(runtime_seed + 202)
    score_model.fit(team_x, team_y)
    margin_model.fit(margin_x, actual_margin)
    total_hist_model.fit(total_x, actual_total)
    total_forest_model.fit(total_x, actual_total)

    shared = score_model.predict(team_x)
    n = len(historical)
    shared_margin = shared[:n] - shared[n:]
    shared_total = shared[:n] + shared[n:]
    selected_margin = 0.75 * shared_margin + 0.25 * margin_model.predict(margin_x)
    selected_home = (shared_total + selected_margin) / 2.0
    selected_away = (shared_total - selected_margin) / 2.0
    residuals = np.column_stack([historical.home_score.to_numpy(float) - selected_home, historical.away_score.to_numpy(float) - selected_away])
    residual_stride = max(1, len(residuals) // 1500)
    residual_sample = residuals[::residual_stride].copy()
    residual_sample -= residual_sample.mean(axis=0, keepdims=True)
    base = {
        "artifactRelease": BASE_RELEASE, "modelRelease": MODEL_RELEASE,
        "distributionRelease": DISTRIBUTION_RELEASE, "probabilityRelease": PROBABILITY_RELEASE,
        "representativeScoreRelease": REPRESENTATIVE_RELEASE, "generatedAt": "2026-10-01T00:00:00.000Z",
        "source": {"qualificationReleases": ["cfb_symmetric_matchup_score_tournament_2026_09_30_r4", "cfb_cross_family_domain_arbitration_tournament_2026_10_01_r7", "cfb_r7_compact_runtime_parity_tournament_2026_10_01_r14"], "historicalChecksums": {Path(path).name: value for path, value in checksums.items()}},
        "chronology": {"historical": [2023, 2024, 2025], "currentMarketMarriage": 2026, "sameGameOutcomeLeakage": False},
        "domain": {"weeklyActivationThreshold": DOMAIN_THRESHOLD, "correctionStrength": 1.0},
        "models": {"sharedScore": linear_artifact(score_model, list(team_x.columns)), "directMargin": forest_artifact(margin_model, list(margin_x.columns)), "domainTotalHist": hgb_artifact(total_hist_model, list(total_x.columns)), "domainTotalForest": forest_artifact(total_forest_model, list(total_x.columns))},
        "weights": {"sharedMargin": 0.75, "directMargin": 0.25},
        "residualSample": [[float(first), float(second)] for first, second in residual_sample], "forecasts": [],
    }

    schedules = frames["schedules"].copy()
    schedules["game_date"] = pd.to_datetime(schedules["game_date"], utc=True)
    teams = sorted({str(team) for column in ("home_team", "away_team") for team in schedules[column].dropna().tolist() if normalized_name(team)}, key=normalized_name)
    future = pd.DataFrame([{"game_id": 9_100_000 + index, "season": args.season, "week": 1, "season_type": 2, "game_date": "2026-08-25T12:00:00Z", "neutral_site": False, "conference_competition": False, "home_team": team, "away_team": team, "home_score": np.nan, "away_score": np.nan, "home_team_spread": np.nan, "over_under": np.nan, "odds_source": "none"} for index, team in enumerate(teams)])
    generated = build_dataset(frames, future, current_season_prior_games=PRIOR_GAMES, include_opponent_adjusted_matchups=True)
    generated = generated[generated.season.eq(args.season) & generated.home_score.isna()].copy()
    if len(generated) != len(teams):
        raise RuntimeError(f"Portable CFB profile generation produced {len(generated)}/{len(teams)} rows")
    last_played: dict[str, str] = {}
    for row in schedules.sort_values(["game_date", "game_id"]).to_dict("records"):
        date = pd.Timestamp(row["game_date"]).isoformat().replace("+00:00", "Z")
        last_played[normalized_name(row["home_team"])] = date
        last_played[normalized_name(row["away_team"])] = date
    profiles: dict[str, dict[str, Any]] = {}
    for row in generated.to_dict("records"):
        name = normalized_name(row["home_team"])
        offense = {key: finite_or_none(row.get(f"home_{key}")) for key in ROLLING_KEYS}
        defense = {}
        for key in ROLLING_KEYS:
            matchup_sum = finite_or_none(row.get(f"matchup_{key}_sum"))
            attack = offense[key]
            defense[key] = None if matchup_sum is None or attack is None else matchup_sum / 2.0 - attack
        personnel = {}
        for key in ("roster_continuity", "roster_experience", "returning_qb"):
            total = finite_or_none(row.get(f"{key}_sum"))
            personnel[key] = None if total is None else total / 2.0
        elo_sum = finite_or_none(row.get("elo_sum_strength"))
        profiles[name] = {"displayName": str(row["home_team"]), "elo": 1500.0 + (elo_sum or 0.0) / 2.0, "lastPlayedAt": last_played.get(name), "priorGames": int(float(row.get("home_prior_games") or 0)), "rolling": offense, "defenseRolling": defense, "personnel": personnel}
    if len(profiles) < 180:
        raise RuntimeError(f"Expected broad CFB profile coverage, found {len(profiles)} teams")
    serialized_base = json.dumps(base, separators=(",", ":"), sort_keys=True) + "\n"
    weekly = {"artifactRelease": WEEKLY_RELEASE, "baseArtifactRelease": BASE_RELEASE, "modelRelease": MODEL_RELEASE, "season": args.season, "generatedAt": "2026-10-01T00:00:00.000Z", "currentSeasonPriorGames": PRIOR_GAMES, "source": {"baseArtifactSha256": hashlib.sha256(serialized_base.encode()).hexdigest(), "historicalChecksums": {Path(path).name: value for path, value in checksums.items()}}, "globalMeans": {**{key: 0.0 for key in ROLLING_KEYS}, "points_for": 28.0, "points_against": 28.0, "margin": 0.0, "total": 56.0, "pace": 68.0, "drives": 12.0}, "teamProfiles": profiles}
    base_output = Path(args.base_output)
    weekly_output = Path(args.weekly_output)
    base_output.write_text(serialized_base)
    weekly_output.write_text(json.dumps(weekly, separators=(",", ":"), sort_keys=True) + "\n")
    print(json.dumps({"baseOutput": str(base_output), "weeklyOutput": str(weekly_output), "trees": TREES, "residuals": len(residual_sample), "teams": len(profiles), "baseBytes": base_output.stat().st_size, "weeklyBytes": weekly_output.stat().st_size, "baseSha256": checksum(base_output), "weeklySha256": checksum(weekly_output)}, indent=2))


if __name__ == "__main__":
    main()
