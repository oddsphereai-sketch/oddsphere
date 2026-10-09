#!/usr/bin/env python3
"""Chronological, market-free NFL Anytime Touchdown model tournament.

Production artifacts are read only. The script evaluates the predeclared direct and
team-budget/role candidates against official play-by-play outcomes through 2026 Week 4.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

from audit_nfl_player_props_touchdown_scorer_quality import (
    BetaCalibrator,
    PlattCalibrator,
    scorer_metrics,
)
from tournament_nfl_player_props_touchdowns import add_touchdown_features


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXTERNAL_MANIFEST = ROOT / "football-research/cache/nfl-player-props-external/features/nfl_player_props_external_features_2016_2026_r3.manifest.json"
HISTORICAL_MANIFEST = ROOT / "football-research/cache/nflverse/real-model-r1/manifest.json"
CURRENT_PBP = ROOT / "football-research/cache/nfl-player-props-external/current/pbp/2026.parquet"
TOUCHDOWN_ARTIFACT = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeTouchdown.json"
SEED = 20261009
POSITIONS = ("QB", "RB", "FB", "WR", "TE")
POLICIES = (
    "team", "team_largest_remainder", "game",
    *(f"week_x{multiplier:.2f}" for multiplier in (0.75, 0.80, 0.85, 0.90, 0.95, 1.00, 1.05, 1.10, 1.15, 1.20, 1.25)),
)


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_pbp() -> pd.DataFrame:
    manifest = json.loads(HISTORICAL_MANIFEST.read_text(encoding="utf-8"))
    paths = [pathlib.Path(item["filename"]) for item in manifest["files"] if item["dataset"] == "pbp" and 2016 <= int(item["season"]) <= 2025]
    paths.append(CURRENT_PBP)
    columns = [
        "season", "week", "game_id", "home_team", "away_team", "posteam", "defteam",
        "yardline_100", "goal_to_go", "touchdown", "td_team", "td_player_id",
        "pass_attempt", "rush_attempt", "receiver_player_id", "rusher_player_id",
        "spread_line", "total_line",
    ]
    frames = []
    for path in paths:
        available = set(pq.read_schema(path).names)
        frames.append(pq.read_table(path, columns=[name for name in columns if name in available]).to_pandas())
    return pd.concat(frames, ignore_index=True)


def market_context_from_pbp(pbp: pd.DataFrame) -> pd.DataFrame:
    columns = ["game_id", "home_team", "away_team", "spread_line", "total_line"]
    games = pbp[columns].copy()
    games["spread_line"] = pd.to_numeric(games["spread_line"], errors="coerce")
    games["total_line"] = pd.to_numeric(games["total_line"], errors="coerce")
    games = games.dropna(subset=["spread_line", "total_line"]).drop_duplicates("game_id", keep="last")
    return games


def freeze_non_runtime_touchdown_opportunity(rows: pd.DataFrame) -> pd.DataFrame:
    """Mirror production: current stats refresh TD rate, but not RZ/goal-line opportunity."""
    result = rows.copy()
    columns = [
        "prior_redzone_opportunity_avg5", "prior_redzone_opportunity_ewm",
        "prior_goal_line_opportunity_avg5", "prior_goal_line_opportunity_ewm",
    ]
    baseline = (
        result[result["season"].eq(2026) & result["week"].eq(1)]
        .sort_values(["player_id", "game_id"])
        .drop_duplicates("player_id")
        .set_index("player_id")[columns]
    )
    current = result["season"].eq(2026)
    for column in columns:
        mapped = result.loc[current, "player_id"].map(baseline[column])
        result.loc[current, column] = mapped.to_numpy()
    return result


def add_model_features(rows: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    result = rows.copy()
    for position in POSITIONS:
        result[f"position_{position.lower()}"] = result["position"].eq(position).astype(float)
    result, relative = add_relative_role_features_market_free(result)
    for prefix, numerator, denominator in (
        ("team_pass_yards_per_attempt", "prior_team_passing_yards_ewm", "prior_team_pass_attempts_ewm"),
        ("team_rush_yards_per_attempt", "prior_team_rushing_yards_ewm", "prior_team_rush_attempts_ewm"),
        ("opponent_pass_yards_per_attempt", "prior_opponent_allowed_passing_yards_ewm", "prior_opponent_allowed_pass_attempts_ewm"),
        ("opponent_rush_yards_per_attempt", "prior_opponent_allowed_rushing_yards_ewm", "prior_opponent_allowed_rush_attempts_ewm"),
    ):
        den = pd.to_numeric(result[denominator], errors="coerce")
        num = pd.to_numeric(result[numerator], errors="coerce")
        result[prefix] = np.where(den.gt(0), num / den, np.nan)
    return result, relative


def add_relative_role_features_market_free(rows: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    result = rows.copy()
    sources = [
        "prior_anytime_td_ewm", "prior_anytime_td_avg5",
        "prior_redzone_opportunity_ewm", "prior_redzone_opportunity_avg5",
        "prior_goal_line_opportunity_ewm", "prior_goal_line_opportunity_avg5",
        "prior_rush_attempt_share_ewm", "prior_rush_attempt_share_avg3",
        "prior_target_share_ewm", "prior_target_share_avg3",
        "prior_offense_snap_pct_ewm", "prior_participated_ewm",
    ]
    group_keys = [result["season"], result["week"], result["game_id"], result["team"]]
    added = []
    for source in sources:
        safe = pd.to_numeric(result[source], errors="coerce").clip(lower=0).fillna(0.0)
        total = safe.groupby(group_keys, observed=True).transform("sum")
        target = f"relative_{source.removeprefix('prior_')}"
        result[target] = np.where(total.gt(0), safe / total, 0.0)
        added.append(target)
    result["relative_combined_role_ewm"] = (
        0.30 * result["relative_goal_line_opportunity_ewm"]
        + 0.15 * result["relative_redzone_opportunity_ewm"]
        + 0.25 * result["relative_rush_attempt_share_ewm"]
        + 0.20 * result["relative_target_share_ewm"]
        + 0.05 * result["relative_offense_snap_pct_ewm"]
        + 0.05 * result["relative_participated_ewm"]
    )
    added.append("relative_combined_role_ewm")
    return result, added


def probability_metrics(y: np.ndarray, probability: np.ndarray) -> dict[str, float | int]:
    probability = np.clip(np.asarray(probability, dtype=float), 0.0025, 0.9975)
    bins = pd.qcut(probability, q=10, duplicates="drop")
    grouped = pd.DataFrame({"p": probability, "y": y, "bin": bins}).groupby("bin", observed=True).agg(predicted=("p", "mean"), observed=("y", "mean"), rows=("y", "size"))
    return {
        "rows": int(len(y)), "positiveRate": float(np.mean(y)),
        "observedPositives": int(np.sum(y)), "expectedPositives": float(np.sum(probability)),
        "expectedPositiveError": float(abs(np.sum(probability) - np.sum(y))),
        "brier": float(brier_score_loss(y, probability)),
        "logLoss": float(log_loss(y, probability)),
        "auc": float(roc_auc_score(y, probability)),
        "calibrationGap": float(np.average(abs(grouped["predicted"] - grouped["observed"]), weights=grouped["rows"])),
    }


def expit(value: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-np.asarray(value, dtype=float)))


def predict_portable(model: dict[str, Any], rows: pd.DataFrame) -> np.ndarray:
    inputs = rows[list(model["featureNames"])].to_numpy(float)
    value = np.full(len(rows), float(model["baseline"]), dtype=float)
    for iteration in model["trees"]:
        for tree in iteration:
            output = np.empty(len(rows), dtype=float)
            for row_index, features in enumerate(inputs):
                node_index = 0
                while True:
                    node = tree["nodes"][node_index]
                    if node["isLeaf"]:
                        output[row_index] = float(node["value"])
                        break
                    feature = features[int(node["featureIndex"])]
                    go_left = (not np.isfinite(feature) and bool(node["missingGoToLeft"])) or (np.isfinite(feature) and feature <= float(node["threshold"]))
                    node_index = int(node["left"] if go_left else node["right"])
            value += output
    return expit(value) if str(model["kind"]).endswith("classifier") else value


TEAM_FEATURES = [
    "prior_team_td_avg5", "prior_opponent_td_allowed_avg5",
    "prior_team_pass_attempts_avg3", "prior_team_pass_attempts_ewm",
    "prior_team_passing_yards_avg3", "prior_team_passing_yards_ewm",
    "prior_team_rush_attempts_avg3", "prior_team_rush_attempts_ewm",
    "prior_team_rushing_yards_avg3", "prior_team_rushing_yards_ewm",
    "prior_team_offensive_plays_avg3", "prior_team_offensive_plays_ewm",
    "prior_opponent_allowed_pass_attempts_avg3", "prior_opponent_allowed_pass_attempts_ewm",
    "prior_opponent_allowed_passing_yards_avg3", "prior_opponent_allowed_passing_yards_ewm",
    "prior_opponent_allowed_rush_attempts_avg3", "prior_opponent_allowed_rush_attempts_ewm",
    "prior_opponent_allowed_rushing_yards_avg3", "prior_opponent_allowed_rushing_yards_ewm",
    "prior_opponent_allowed_offensive_plays_avg3", "prior_opponent_allowed_offensive_plays_ewm",
    "team_pass_yards_per_attempt", "team_rush_yards_per_attempt",
    "opponent_pass_yards_per_attempt", "opponent_rush_yards_per_attempt",
    "is_home", "external_environment_temperature_f", "external_environment_wind_mph",
    "external_environment_outdoor", "external_environment_fixed_roof",
]


@dataclass(frozen=True)
class Candidate:
    name: str
    features: list[str]
    hierarchical: bool = False
    blend: bool = False
    incumbent_player: bool = False


def classifier(incumbent: bool = False) -> HistGradientBoostingClassifier:
    return HistGradientBoostingClassifier(
        max_iter=160 if incumbent else 220,
        max_leaf_nodes=15,
        learning_rate=0.05 if incumbent else 0.04,
        l2_regularization=3.0 if incumbent else 5.0,
        min_samples_leaf=20 if incumbent else 40,
        random_state=20260825 if incumbent else SEED,
    )


def team_model() -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(loss="poisson", max_iter=180, max_leaf_nodes=15, learning_rate=0.04, l2_regularization=8.0, min_samples_leaf=40, random_state=SEED)


def fit_predict_raw(candidate: Candidate, train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    player = classifier(candidate.name == "market_free_incumbent_hgb" or candidate.incumbent_player)
    player.fit(train[candidate.features], train["anytime_td"])
    direct = np.clip(player.predict_proba(test[candidate.features])[:, 1], 0.0025, 0.9975)
    if not candidate.hierarchical and not candidate.blend:
        return direct
    train_team = train.sort_values(["season", "week", "game_id", "team", "player_id"]).groupby(["season", "week", "game_id", "team"], observed=True).first().reset_index()
    test_team = test.sort_values(["season", "week", "game_id", "team", "player_id"]).groupby(["season", "week", "game_id", "team"], observed=True).first().reset_index()
    budget = team_model()
    budget.fit(train_team[TEAM_FEATURES], train_team["team_touchdowns"])
    predicted_budget = np.clip(budget.predict(test_team[TEAM_FEATURES]), 0.05, 6.0)
    budget_by_key = dict(zip(test_team["team_key"], predicted_budget, strict=True))
    intensity = -np.log1p(-direct)
    total = pd.Series(intensity, index=test.index).groupby(test["team_key"], observed=True).transform("sum").to_numpy(float)
    shares = np.divide(intensity, total, out=np.full_like(intensity, 1.0), where=total > 0)
    hierarchy = 1 - np.exp(-shares * test["team_key"].map(budget_by_key).to_numpy(float))
    hierarchy = np.clip(hierarchy, 0.0025, 0.9975)
    return np.clip(0.5 * direct + 0.5 * hierarchy, 0.0025, 0.9975) if candidate.blend else hierarchy


CALIBRATORS: dict[str, Callable[[], Any]] = {"platt": PlattCalibrator, "beta": BetaCalibrator}


def calibrated_predictions(candidate: Candidate, frame: pd.DataFrame, eligible: pd.Series, evaluation_season: int, calibrator_name: str) -> tuple[np.ndarray, Any, Any]:
    calibration_season = evaluation_season - 1
    calibration_train = frame[eligible & frame["season"].lt(calibration_season)]
    calibration_rows = frame[eligible & frame["season"].eq(calibration_season)]
    raw_calibration = fit_predict_raw(candidate, calibration_train, calibration_rows)
    calibrator = CALIBRATORS[calibrator_name]().fit(raw_calibration, calibration_rows["anytime_td"].to_numpy(int))
    train = frame[eligible & frame["season"].lt(evaluation_season)]
    evaluation = frame[eligible & frame["season"].eq(evaluation_season)]
    raw = fit_predict_raw(candidate, train, evaluation)
    return np.clip(calibrator.predict(raw), 0.0025, 0.9975), calibrator, (train, evaluation)


def choose_calibrator(candidate: Candidate, frame: pd.DataFrame, eligible: pd.Series) -> tuple[str, dict[str, Any]]:
    train = frame[eligible & frame["season"].le(2023)]
    rows = frame[eligible & frame["season"].eq(2024)]
    raw = fit_predict_raw(candidate, train, rows)
    fit = rows["week"].le(9).to_numpy(bool)
    y = rows["anytime_td"].to_numpy(int)
    report: dict[str, Any] = {}
    for name, factory in CALIBRATORS.items():
        calibrator = factory().fit(raw[fit], y[fit])
        report[name] = probability_metrics(y[~fit], calibrator.predict(raw[~fit]))
    selected = min(report, key=lambda name: (report[name]["brier"], report[name]["logLoss"]))
    return selected, report


def choose_policy(rows: pd.DataFrame, probability: np.ndarray) -> tuple[str, dict[str, Any]]:
    late = rows["week"].gt(9).to_numpy(bool)
    report = {name: scorer_metrics(rows.loc[late], probability[late], name) for name in POLICIES}
    selected = max(report, key=lambda name: (report[name]["f1"], report[name]["recall"], report[name]["precision"]))
    return selected, report


def by_position(rows: pd.DataFrame, probability: np.ndarray) -> dict[str, Any]:
    result = {}
    groups = {"QB": {"QB"}, "RB_FB": {"RB", "FB"}, "WR": {"WR"}, "TE": {"TE"}}
    for name, positions in groups.items():
        mask = rows["position"].isin(positions).to_numpy(bool)
        result[name] = probability_metrics(rows.loc[mask, "anytime_td"].to_numpy(int), probability[mask])
    return result


def clustered_delta(rows: pd.DataFrame, incumbent: np.ndarray, challenger: np.ndarray, iterations: int = 4000) -> dict[str, Any]:
    y = rows["anytime_td"].to_numpy(int)
    games = rows["game_id"].astype(str).to_numpy()
    unique = np.unique(games)
    squared_delta = (challenger - y) ** 2 - (incumbent - y) ** 2
    log_delta = -(y * np.log(challenger) + (1 - y) * np.log(1 - challenger)) + (y * np.log(incumbent) + (1 - y) * np.log(1 - incumbent))
    rng = np.random.default_rng(SEED)
    brier, loss = [], []
    for _ in range(iterations):
        sample = rng.choice(unique, size=len(unique), replace=True)
        indices = np.concatenate([np.flatnonzero(games == game) for game in sample])
        brier.append(float(np.mean(squared_delta[indices])))
        loss.append(float(np.mean(log_delta[indices])))
    return {
        "challengerMinusIncumbentBrier": float(np.mean(squared_delta)),
        "brier95": [float(np.quantile(brier, 0.025)), float(np.quantile(brier, 0.975))],
        "challengerMinusIncumbentLogLoss": float(np.mean(log_delta)),
        "logLoss95": [float(np.quantile(loss, 0.025)), float(np.quantile(loss, 0.975))],
        "games": int(len(unique)), "iterations": iterations,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--r2-only", action="store_true")
    parser.add_argument("--r3-only", action="store_true")
    args = parser.parse_args()
    if args.r2_only and args.r3_only:
        raise SystemExit("choose only one bounded redesign")
    manifest = json.loads(EXTERNAL_MANIFEST.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if sha256_file(feature_path) != manifest["featureFileSha256"]:
        raise RuntimeError("external feature checksum mismatch")
    frame = pd.read_parquet(feature_path)
    pbp = read_pbp()
    market_context = market_context_from_pbp(pbp)
    frame, touchdown_features = add_touchdown_features(frame, pbp, market_context)
    released_frame = freeze_non_runtime_touchdown_opportunity(frame)
    if not args.r3_only:
        frame = released_frame
    frame, relative_features = add_model_features(frame)
    released_frame, _ = add_model_features(released_frame)
    frame["team_key"] = frame["game_id"].astype(str) + "|" + frame["team"].astype(str)
    team_td = frame.groupby(["season", "week", "game_id", "team"], observed=True)["touchdowns"].transform("sum")
    frame["team_touchdowns"] = team_td

    base_features = [
        *manifest["featureGroups"]["base"],
        *[name for name in touchdown_features if name != "team_implied_touchdowns"],
        "is_home", *(f"position_{position.lower()}" for position in POSITIONS),
    ]
    role_features = [
        *base_features, *relative_features,
        "external_depth_listed", "external_depth_slot_rank", "external_depth_overall_rank",
        "external_depth_starter", "external_depth_snapshot_age_hours",
        "external_environment_temperature_f", "external_environment_wind_mph",
        "external_environment_outdoor", "external_environment_fixed_roof",
    ]
    candidates = [
        Candidate("market_free_incumbent_hgb", base_features),
        Candidate("market_free_role_hgb", role_features),
        Candidate("market_free_team_budget_role", role_features, hierarchical=True),
        Candidate("market_free_direct_hierarchy_50", role_features, blend=True),
        Candidate("market_free_incumbent_team_budget", base_features, hierarchical=True, incumbent_player=True),
        Candidate("market_free_incumbent_direct_hierarchy_50", base_features, blend=True, incumbent_player=True),
        Candidate("market_free_current_opportunity_team_budget", role_features, hierarchical=True),
    ]
    if args.r2_only:
        candidates = [candidate for candidate in candidates if candidate.name.startswith("market_free_incumbent_") and candidate.name != "market_free_incumbent_hgb"]
    if args.r3_only:
        candidates = [candidate for candidate in candidates if candidate.name in {
            "market_free_incumbent_team_budget",
            "market_free_incumbent_direct_hierarchy_50",
            "market_free_current_opportunity_team_budget",
        }]
    eligible = frame["prior_participations"].ge(1) & frame["position"].isin(POSITIONS)

    selection_rows = frame[eligible & frame["season"].eq(2023)]
    selection_train = frame[eligible & frame["season"].le(2022)]
    selection = {}
    for candidate in candidates:
        selection[candidate.name] = probability_metrics(selection_rows["anytime_td"].to_numpy(int), fit_predict_raw(candidate, selection_train, selection_rows))
    redesign_names = {candidate.name for candidate in candidates} if args.r2_only or args.r3_only else {
        "market_free_incumbent_team_budget", "market_free_incumbent_direct_hierarchy_50"
    }
    selected_name = min(redesign_names, key=lambda name: (selection[name]["brier"], selection[name]["logLoss"], -selection[name]["auc"]))

    results: dict[str, Any] = {}
    predictions_2026: dict[str, np.ndarray] = {}
    rows_2025 = frame[eligible & frame["season"].eq(2025)]
    rows_2026 = frame[eligible & frame["season"].eq(2026)]
    for candidate in candidates:
        calibrator_name, calibration_selection = choose_calibrator(candidate, frame, eligible)
        probability_2025, _, _ = calibrated_predictions(candidate, frame, eligible, 2025, calibrator_name)
        probability_2026, _, _ = calibrated_predictions(candidate, frame, eligible, 2026, calibrator_name)
        policy, policy_selection = choose_policy(frame[eligible & frame["season"].eq(2024)], calibrated_predictions(candidate, frame, eligible, 2024, calibrator_name)[0])
        predictions_2026[candidate.name] = probability_2026
        results[candidate.name] = {
            "calibrator": calibrator_name,
            "calibrationSelection2024Late": calibration_selection,
            "scorerPolicy": policy,
            "scorerPolicySelection2024Late": policy_selection,
            "holdout2025": probability_metrics(rows_2025["anytime_td"].to_numpy(int), probability_2025),
            "holdout2025ByPosition": by_position(rows_2025, probability_2025),
            "holdout2025Scorer": scorer_metrics(rows_2025, probability_2025, policy),
            "holdout2025ScorerByPolicy": {name: scorer_metrics(rows_2025, probability_2025, name) for name in POLICIES},
            "confirmation2026": probability_metrics(rows_2026["anytime_td"].to_numpy(int), probability_2026),
            "confirmation2026ByWeek": {str(int(week)): probability_metrics(group["anytime_td"].to_numpy(int), probability_2026[rows_2026.index.get_indexer(group.index)]) for week, group in rows_2026.groupby("week", observed=True)},
            "confirmation2026ByPosition": by_position(rows_2026, probability_2026),
            "confirmation2026Scorer": scorer_metrics(rows_2026, probability_2026, policy),
            "confirmation2026ScorerByWeek": {
                str(int(week)): scorer_metrics(group, probability_2026[rows_2026.index.get_indexer(group.index)], policy)
                for week, group in rows_2026.groupby("week", observed=True)
            },
            "confirmation2026ScorerByPolicy": {name: scorer_metrics(rows_2026, probability_2026, name) for name in POLICIES},
        }

    incumbent_artifact = json.loads(TOUCHDOWN_ARTIFACT.read_text(encoding="utf-8"))
    incumbent_frame = released_frame.loc[rows_2026.index].copy()
    required = list(incumbent_artifact["model"]["featureNames"])
    missing = [name for name in required if name not in incumbent_frame]
    if missing:
        raise RuntimeError(f"released artifact features missing: {missing}")
    incumbent_raw = predict_portable(incumbent_artifact["model"], incumbent_frame)
    logit = np.log(np.clip(incumbent_raw, 1e-5, 1 - 1e-5) / np.clip(1 - incumbent_raw, 1e-5, 1))
    incumbent_2026 = expit(float(incumbent_artifact["calibrator"]["intercept"]) + float(incumbent_artifact["calibrator"]["coefficient"]) * logit)
    incumbent_report = {
        "confirmation2026": probability_metrics(rows_2026["anytime_td"].to_numpy(int), incumbent_2026),
        "confirmation2026ByWeek": {str(int(week)): probability_metrics(group["anytime_td"].to_numpy(int), incumbent_2026[rows_2026.index.get_indexer(group.index)]) for week, group in rows_2026.groupby("week", observed=True)},
        "confirmation2026ByPosition": by_position(rows_2026, incumbent_2026),
        "confirmation2026ScorerTeam": scorer_metrics(rows_2026, incumbent_2026, "team"),
        "confirmation2026ScorerTeamByWeek": {
            str(int(week)): scorer_metrics(group, incumbent_2026[rows_2026.index.get_indexer(group.index)], "team")
            for week, group in rows_2026.groupby("week", observed=True)
        },
    }
    for name, probability in predictions_2026.items():
        results[name]["confirmation2026VsReleasedClustered"] = clustered_delta(rows_2026, incumbent_2026, probability)
        weeks_2_4 = rows_2026["week"].ge(2).to_numpy(bool)
        results[name]["confirmation2026Weeks2To4"] = probability_metrics(rows_2026.loc[weeks_2_4, "anytime_td"].to_numpy(int), probability[weeks_2_4])

    result = {
        "auditRelease": "nfl_player_props_anytime_td_independent_2026_10_09_r3" if args.r3_only else "nfl_player_props_anytime_td_independent_2026_10_09_r2" if args.r2_only else "nfl_player_props_anytime_td_independent_2026_10_09_r1",
        "predeclaration": "docs/model-audits/2026-10-09-nfl-player-props-anytime-touchdown-r3-data-contract-predeclaration.md" if args.r3_only else "docs/model-audits/2026-10-09-nfl-player-props-anytime-touchdown-r2-predeclaration.md" if args.r2_only else "docs/model-audits/2026-10-09-nfl-player-props-anytime-touchdown-predeclaration.md",
        "inputs": {
            "externalFeatureRelease": manifest["release"], "externalFeatureSha256": manifest["featureFileSha256"],
            "historicalPbpManifestSha256": sha256_file(HISTORICAL_MANIFEST), "current2026PbpSha256": sha256_file(CURRENT_PBP),
            "releasedTouchdownArtifactSha256": sha256_file(TOUCHDOWN_ARTIFACT), "marketFeatures": manifest["marketFeatures"],
        },
        "chronology": {"train": "2016-2022", "selection": 2023, "calibrationAndPolicy": 2024, "holdout": 2025, "ownerPriorityConfirmation": "2026 Weeks 1-4"},
        "eligibleRows": {str(year): int((eligible & frame["season"].eq(year)).sum()) for year in (2023, 2024, 2025, 2026)},
        "selection2023": selection, "selectedCandidate": selected_name,
        "releasedIndependent2026": incumbent_report,
        "candidates": results,
    }
    encoded = json.dumps(result, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")


if __name__ == "__main__":
    main()
