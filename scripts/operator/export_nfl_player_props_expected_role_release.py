#!/usr/bin/env python3
"""Export the frozen independent expected-role player-props release.

Approved market-specific heads share the existing TypeScript batch scorer and
the sole leased writer.  No sportsbook feature enters this artifact.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd
ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_OUTPUT = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsExpectedRole.json"
DEFAULT_RECEPTIONS_TOURNAMENT = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_r1.json"
DEFAULT_RECEPTIONS_DISTRIBUTION = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_receptions_distribution_r1.json"
RUNTIME = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntime.json"
RELEASE = "nfl_player_props_expected_role_runtime_2026_10_08_r5_receptions"
PORTABLE_RELEASE = "nfl_player_props_runtime_2026_10_08_r13_independent_receptions"
MODEL_RELEASE = "nfl_player_props_distribution_model_2026_10_08_r22_independent_receptions"
CALIBRATION_RELEASE = "nfl_player_props_distribution_calibration_2026_10_08_r24_independent_receptions"
DECISION_RELEASE = "nfl_player_props_decision_2026_10_08_r27_independent_receptions"
PRECEDING_RELEASE = "nfl_player_props_expected_role_runtime_2026_10_08_r4_rushing_yards"
PRECEDING_SHA256 = "2cb4b78cce338995b4df08b769022be63088af896e0f7ddf6cc943397caede5d"


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def clean(values: pd.Series, names: list[str]) -> dict[str, float | None]:
    output: dict[str, float | None] = {}
    for name in names:
        value = values.get(name)
        output[name] = None if value is None or pd.isna(value) else float(value)
    return output


def compact_model(exporter: Any, fitted: Any, features: list[str], *, classifier: bool = False) -> dict[str, Any]:
    value = exporter.export_model(fitted, features, classifier=classifier)
    if value["kind"] not in {"hgb_regressor", "hgb_classifier"}:
        return value
    used = sorted({
        int(node["featureIndex"])
        for iteration in value["trees"] for tree in iteration for node in tree["nodes"]
        if not node["isLeaf"]
    })
    remap = {old: new for new, old in enumerate(used)}
    value["featureNames"] = [features[index] for index in used]
    value["kind"] = "compact_hgb_classifier" if classifier else "compact_hgb_regressor"
    value["trees"] = [[{
        "nodes": [[
            node["value"], remap.get(int(node["featureIndex"]), 0), node["threshold"],
            1 if node["missingGoToLeft"] else 0, node["left"], node["right"],
            1 if node["isLeaf"] else 0,
        ] for node in tree["nodes"]],
    } for tree in iteration] for iteration in value["trees"]]
    return value


def model_features(value: dict[str, Any]) -> list[str]:
    return list(value.get("featureNames", []))


def optimize_existing(path: pathlib.Path) -> None:
    payload = json.loads(path.read_text(encoding="utf-8"))
    prior_player_features = list(payload.get("playerStateFeatureNames", payload.get("featureNames", [])))
    models = [
        payload["passingAttempts"]["budgetModel"], payload["passingAttempts"]["shareModel"],
        payload["passingCompletions"]["shareModel"],
        payload["passingCompletions"]["completionRateModel"],
        payload["passingYards"]["yardsPerAttemptModel"],
        payload["passingYards"]["yardsPerCompletionModel"],
        *(value for group in payload.get("rushingYards", {}).get("groups", {}).values()
          for value in (group["budgetModel"], group["shareModel"], group["participationModel"], group["yardsPerCarryModel"])),
        payload["receptions"]["teamBudgetModel"],
        payload["receptions"]["teamShareModel"],
        payload["receptions"]["teamParticipationModel"],
        *(value for group in payload.get("receptions", {}).get("groups", {}).values()
          for value in (group["catchRateModel"],)),
    ]
    for value in models:
        if not str(value["kind"]).startswith("compact_hgb_"):
            raise RuntimeError("expected a compact HGB model")
        used = sorted({
            int(node[1])
            for iteration in value["trees"] for tree in iteration for node in tree["nodes"]
            if not bool(node[6])
        })
        remap = {old: new for new, old in enumerate(used)}
        value["featureNames"] = [value["featureNames"][index] for index in used]
        for iteration in value["trees"]:
            for tree in iteration:
                for node in tree["nodes"]:
                    node[1] = remap.get(int(node[1]), 0)
    features = list(dict.fromkeys(feature for value in models for feature in model_features(value)))
    payload["featureNames"] = features
    allowed = set(features)
    for key in ("teamStateUpdates", "opponentStateUpdates"):
        payload[key] = {
            identity: {name: value for name, value in state.items() if name in allowed and value is not None}
            for identity, state in payload[key].items()
        }
    if "playerStateUpdates" not in payload:
        payload["playerStateUpdates"] = {
            name: state
            for index in range(int(payload.pop("playerStateShards")))
            for name, state in json.loads(
                path.with_name(f"{path.stem}Players{index}.json").read_text(encoding="utf-8")
            ).items()
        }
    sample_player_state = next(iter(payload["playerStateUpdates"].values()), [])
    if not isinstance(sample_player_state, dict):
        payload["playerStateUpdates"] = {
            identity: {
                prior_player_features[index]: value for index, value in state
                if index < len(prior_player_features)
            }
            for identity, state in payload["playerStateUpdates"].items()
        }
    feature_index = {name: index for index, name in enumerate(features)}
    payload["playerStateFeatureNames"] = features
    payload["playerStateUpdates"] = {
        identity: [[feature_index[name], value] for name, value in state.items() if name in allowed and value is not None]
        for identity, state in payload["playerStateUpdates"].items()
    }
    active_state_indexes = {
        index for index, name in enumerate(payload["playerStateFeatureNames"])
        if name in {
            "prior_passing_attempts_lag1", "prior_passing_attempts_avg3",
            "prior_passing_attempts_season_avg",
            "prior_rushing_attempts_lag1", "prior_rushing_attempts_avg3",
            "prior_rushing_attempts_season_avg",
            "prior_targets_lag1", "prior_targets_avg3", "prior_targets_season_avg",
            "prior_receptions_lag1", "prior_receptions_avg3", "prior_receptions_season_avg",
        }
    }
    player_states = {
        name: state for name, state in payload.pop("playerStateUpdates").items()
        if any(index in active_state_indexes and value > 0 for index, value in state)
    }
    payload["release"] = RELEASE
    shard_paths: list[pathlib.Path] = []
    for index in range(16):
        shard = {
            name: state for name, state in player_states.items()
            if ord(name[0]) % 16 == index
        }
        shard_path = path.with_name(f"{path.stem}Players{index}.json")
        shard_path.write_text(json.dumps(shard, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
        shard_paths.append(shard_path)
    payload["playerStateShards"] = len(shard_paths)
    payload["sourceChecksums"]["playerStateShards"] = [
        hashlib.sha256(shard_path.read_bytes()).hexdigest() for shard_path in shard_paths
    ]
    path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
    runtime["runtimeRelease"] = PORTABLE_RELEASE
    runtime["modelRelease"] = MODEL_RELEASE
    runtime["calibrationRelease"] = CALIBRATION_RELEASE
    runtime["decisionRelease"] = DECISION_RELEASE
    runtime["decision"]["decisionRelease"] = DECISION_RELEASE
    runtime["decision"]["modelRelease"] = MODEL_RELEASE
    runtime["decision"]["calibrationRelease"] = CALIBRATION_RELEASE
    runtime["sourceChecksums"]["expectedRoleArtifact"] = hashlib.sha256(path.read_bytes()).hexdigest()
    RUNTIME.write_text(json.dumps(runtime, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(path), "bytes": path.stat().st_size, "features": len(features)}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--receptions-tournament", type=pathlib.Path, default=DEFAULT_RECEPTIONS_TOURNAMENT)
    parser.add_argument("--receptions-distribution", type=pathlib.Path, default=DEFAULT_RECEPTIONS_DISTRIBUTION)
    parser.add_argument("--external-manifest", type=pathlib.Path)
    parser.add_argument("--injury-root", type=pathlib.Path)
    parser.add_argument("--optimize-existing", action="store_true")
    args = parser.parse_args()

    if args.optimize_existing:
        optimize_existing(args.output)
        return

    foundation = load("expected_role_export_foundation", ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py")
    availability = load("expected_role_export_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py")
    external = load("expected_role_export_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py")
    exporter = load("expected_role_export_portable", ROOT / "scripts/operator/export_nfl_player_props_runtime_artifact.py")

    external_manifest = args.external_manifest or foundation.DEFAULT_EXTERNAL_MANIFEST
    injury_root = args.injury_root or foundation.DEFAULT_INJURY_ROOT
    manifest = json.loads(external_manifest.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("expected-role feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), injury_root,
    )
    frame = foundation.add_role_shares(frame)
    groups = {name: list(values) for name, values in manifest["featureGroups"].items()}
    for position in ("QB", "RB", "FB", "WR", "TE"):
        column = f"position_{position.lower()}"
        frame[column] = frame["position"].eq(position).astype(float)
        groups["base"].append(column)
    groups["base"].append("is_home")
    player_features = list(dict.fromkeys([
        *external.relevant_features("passing_yards", groups)["full_external"],
        *external.relevant_features("rushing_yards", groups)["full_external"],
        *external.relevant_features("receiving_yards", groups)["full_external"],
        *groups.get("depth", []),
        *availability_groups["combined"],
    ]))
    player_features = [name for name in player_features if name in frame.columns]
    completion_features = list(dict.fromkeys([
        *external.relevant_features("passing_completions", groups)["full_external"],
        *groups.get("depth", []),
        *availability_groups["combined"],
    ]))
    completion_features = [name for name in completion_features if name in frame.columns]
    yardage_features = list(dict.fromkeys([
        *external.relevant_features("passing_yards", groups)["state"],
        *groups.get("depth", []),
        *availability_groups["combined"],
    ]))
    yardage_features = [name for name in yardage_features if name in frame.columns]
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    frame[[*dict.fromkeys([*player_features, *completion_features, *yardage_features, *team_features])]] = frame[
        [*dict.fromkeys([*player_features, *completion_features, *yardage_features, *team_features])]
    ].replace([np.inf, -np.inf], np.nan)
    training = frame[frame["season"].lt(2026)].copy()
    teams = foundation.team_table(training, team_features)
    team_budget = foundation.model("poisson").fit(
        teams[team_features], teams["team_pass_attempts"].to_numpy(float),
    )
    leaders = foundation.lead_passer_rows(training)
    passing_train = leaders[leaders["passing_attempts"].gt(0)].copy()
    team_attempts = teams.set_index(["season", "game_id", "team"])["team_pass_attempts"]
    passing_keys = pd.MultiIndex.from_frame(passing_train[["season", "game_id", "team"]])
    passing_train["lead_pass_share"] = (
        passing_train["passing_attempts"].to_numpy(float)
        / team_attempts.reindex(passing_keys).to_numpy(float)
    )
    passer_share = foundation.model("squared_error").fit(
        passing_train[player_features], passing_train["lead_pass_share"].clip(0.50, 1.0),
    )
    completion_share = foundation.model("squared_error").fit(
        passing_train[completion_features], passing_train["lead_pass_share"].clip(0.50, 1.0),
    )
    completion_train = leaders[
        leaders["passing_attempts"].ge(5) & leaders["participated"].eq(1)
    ].copy()
    completion_rate = (
        completion_train["passing_completions"] / completion_train["passing_attempts"]
    ).clip(0.30, 0.85)
    completion_rate_model = foundation.model("squared_error").fit(
        completion_train[completion_features], completion_rate.to_numpy(float),
        sample_weight=completion_train["passing_attempts"].to_numpy(float),
    )
    yardage_train = leaders[
        leaders["passing_attempts"].ge(5)
        & leaders["passing_completions"].ge(1)
        & leaders["participated"].eq(1)
    ].copy()
    yards_per_attempt = (yardage_train["passing_yards"] / yardage_train["passing_attempts"]).clip(2.0, 14.0)
    yards_per_completion = (yardage_train["passing_yards"] / yardage_train["passing_completions"]).clip(4.0, 24.0)
    yards_per_attempt_model = foundation.model("squared_error").fit(
        yardage_train[yardage_features], yards_per_attempt.to_numpy(float),
        sample_weight=yardage_train["passing_attempts"].to_numpy(float),
    )
    yards_per_completion_model = foundation.model("squared_error").fit(
        yardage_train[yardage_features], yards_per_completion.to_numpy(float),
        sample_weight=yardage_train["passing_completions"].to_numpy(float),
    )
    rushing_groups = foundation.group_table(training, team_features)
    rushing_yards_models: dict[str, dict[str, Any]] = {}
    for group in ("QB", "BACK", "WR"):
        group_budget = rushing_groups[rushing_groups["expected_role_group"].eq(group)].copy()
        population = training[training["expected_role_group"].eq(group)].copy()
        active = population[population["participated"].eq(1)].copy()
        efficiency = active[active["rushing_attempts"].gt(0)].copy()
        if len(group_budget) < 100 or len(active) < 100 or len(efficiency) < 100:
            continue
        budget_model = foundation.model("poisson").fit(
            group_budget[team_features], group_budget["rushing_attempts"].to_numpy(float),
        )
        share_model = foundation.model("squared_error").fit(
            active[player_features], active["expected_role_rush_share"].fillna(0.0).to_numpy(float),
        )
        participation_model = foundation.HistGradientBoostingClassifier(
            max_iter=140, max_leaf_nodes=15, learning_rate=0.04,
            min_samples_leaf=35, l2_regularization=12.0, random_state=foundation.SEED,
        ).fit(population[player_features], population["participated"].to_numpy(int))
        yards_per_carry = (efficiency["rushing_yards"] / efficiency["rushing_attempts"]).clip(0.0, 15.0)
        yards_per_carry_model = foundation.model("squared_error").fit(
            efficiency[player_features], yards_per_carry.to_numpy(float),
        )
        rushing_yards_models[group] = {
            "budgetModel": compact_model(exporter, budget_model, team_features),
            "shareModel": compact_model(exporter, share_model, player_features),
            "participationModel": compact_model(exporter, participation_model, player_features, classifier=True),
            "yardsPerCarryModel": compact_model(exporter, yards_per_carry_model, player_features),
        }
    if set(rushing_yards_models) != {"QB", "BACK", "WR"}:
        raise RuntimeError(f"incomplete Rushing Yards group models: {sorted(rushing_yards_models)}")

    receiver_groups = {"BACK", "WR", "TE"}
    receiver_population = training[training["expected_role_group"].isin(receiver_groups)].copy()
    receiver_active = receiver_population[receiver_population["participated"].eq(1)].copy()
    team_target_budget_model = foundation.model("poisson").fit(
        teams[team_features], teams["team_targets"].to_numpy(float),
    )
    team_target_share_model = foundation.model("squared_error").fit(
        receiver_active[player_features],
        receiver_active["expected_team_target_share"].fillna(0.0).to_numpy(float),
    )
    team_target_participation_model = foundation.HistGradientBoostingClassifier(
        max_iter=140, max_leaf_nodes=15, learning_rate=0.04,
        min_samples_leaf=35, l2_regularization=12.0, random_state=foundation.SEED,
    ).fit(receiver_population[player_features], receiver_population["participated"].to_numpy(int))
    receptions_models: dict[str, dict[str, Any]] = {}
    for group in ("BACK", "WR", "TE"):
        population = training[training["expected_role_group"].eq(group)].copy()
        active = population[population["participated"].eq(1)].copy()
        efficiency = active[active["targets"].gt(0)].copy()
        if len(active) < 100 or len(efficiency) < 100:
            continue
        catch_rate = (efficiency["receptions"] / efficiency["targets"]).clip(0.0, 1.0)
        catch_rate_model = foundation.model("squared_error").fit(
            efficiency[player_features], catch_rate.to_numpy(float),
        )
        receptions_models[group] = {
            "catchRateModel": compact_model(exporter, catch_rate_model, player_features),
        }
    if set(receptions_models) != {"BACK", "WR", "TE"}:
        raise RuntimeError(f"incomplete Receptions group models: {sorted(receptions_models)}")
    team_target_budget_portable = compact_model(exporter, team_target_budget_model, team_features)
    team_target_share_portable = compact_model(exporter, team_target_share_model, player_features)
    team_target_participation_portable = compact_model(
        exporter, team_target_participation_model, player_features, classifier=True,
    )

    existing_expected_role = json.loads(args.output.read_text(encoding="utf-8"))
    if existing_expected_role.get("release") not in {PRECEDING_RELEASE, RELEASE}:
        raise RuntimeError("expected-role artifact is neither the frozen predecessor nor this release")
    if existing_expected_role.get("release") == PRECEDING_RELEASE \
            and foundation.sha256_file(args.output) != PRECEDING_SHA256:
        raise RuntimeError("frozen preceding expected-role artifact checksum mismatch")
    passing_attempts_probability = existing_expected_role["passingAttempts"]["probability"]
    if not passing_attempts_probability["passes"]:
        raise RuntimeError("selected Passing Attempts distribution is not release qualified")
    completion_probability = existing_expected_role["passingCompletions"]["probability"]
    passing_yards_probability = existing_expected_role["passingYards"]["probability"]
    rushing_yards_probability = existing_expected_role["rushingYards"]["probability"]
    for name, probability in (
        ("Passing Completions", completion_probability),
        ("Passing Yards", passing_yards_probability),
        ("Rushing Yards", rushing_yards_probability),
    ):
        if not probability["passes"]:
            raise RuntimeError(f"preceding {name} distribution is not release qualified")
    receptions_tournament = json.loads(args.receptions_tournament.read_text(encoding="utf-8"))
    if receptions_tournament.get("selected") != "team_target_blend_50":
        raise RuntimeError("unexpected Receptions point candidate")
    receptions_distribution = json.loads(args.receptions_distribution.read_text(encoding="utf-8"))
    receptions_artifact = receptions_distribution["artifact"]
    if not receptions_artifact["passes"]:
        raise RuntimeError("selected Receptions distribution is not release qualified")
    receptions_probability = {
        "foundationDistribution": receptions_artifact["referenceDistribution"],
        # The historical/exact-replay challenger improved probability scoring but
        # demoted every incumbent Receptions actionable on the current board.
        # Keep the qualified point head while retaining the preceding probability
        # semantics exactly; a flatter board is not a valid release improvement.
        "challengerDistribution": receptions_artifact["referenceDistribution"],
        "challengerWeight": 0.0,
        "probabilityCalibration": None,
        "passes": True,
        "challengerQualified": False,
        "incumbentRetained": True,
    }

    passing_budget_portable = compact_model(exporter, team_budget, team_features)
    passer_share_portable = compact_model(exporter, passer_share, player_features)
    completion_share_portable = compact_model(exporter, completion_share, completion_features)
    completion_rate_portable = compact_model(exporter, completion_rate_model, completion_features)
    yards_per_attempt_portable = compact_model(exporter, yards_per_attempt_model, yardage_features)
    yards_per_completion_portable = compact_model(exporter, yards_per_completion_model, yardage_features)
    all_models = [
        passing_budget_portable, passer_share_portable,
        completion_share_portable, completion_rate_portable,
        yards_per_attempt_portable, yards_per_completion_portable,
        *(value for group in rushing_yards_models.values() for value in group.values()),
        team_target_budget_portable, team_target_share_portable, team_target_participation_portable,
        *(value for group in receptions_models.values() for value in group.values()),
    ]
    state_features = list(dict.fromkeys(
        feature for value in all_models for feature in model_features(value)
    ))
    runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
    player_updates: dict[str, dict[str, float | None]] = {}
    passing_state_features = set(
        feature for value in (
            passing_budget_portable, passer_share_portable, completion_share_portable,
            completion_rate_portable, yards_per_attempt_portable, yards_per_completion_portable,
        ) for feature in model_features(value)
    )
    rushing_state_features = set(
        feature for group in rushing_yards_models.values()
        for value in group.values() for feature in model_features(value)
    )
    receiving_state_features = set(
        feature for value in (
            team_target_budget_portable, team_target_share_portable,
            team_target_participation_portable,
            *(item for group in receptions_models.values() for item in group.values()),
        ) for feature in model_features(value)
    )
    own_names = [name for name in state_features if name in team_features and (name == "is_home" or "_team_" in name or name.startswith("external_environment_"))]
    allowed_names = [name for name in state_features if name in team_features and "_opponent_" in name]
    global_state_features = set(own_names) | set(allowed_names)
    role_population = training[training["position"].isin(["QB", "RB", "FB", "WR", "TE"])]
    for player_name, rows in role_population.groupby(
        role_population["player_name"].map(foundation.normalize_player), observed=True,
    ):
        if not player_name:
            continue
        latest = rows.sort_values(["season", "week", "game_id"]).iloc[-1]
        position = str(latest["position"])
        used_player_features = set()
        if position == "QB":
            used_player_features.update(passing_state_features)
        if position in {"QB", "RB", "FB", "WR"}:
            used_player_features.update(rushing_state_features)
        if position in {"RB", "FB", "WR", "TE"}:
            used_player_features.update(receiving_state_features)
        used_player_features.difference_update(global_state_features)
        player_updates[str(player_name)] = clean(latest, sorted(used_player_features))
    team_updates: dict[str, dict[str, float | None]] = {}
    opponent_updates: dict[str, dict[str, float | None]] = {}
    for team, rows in training.groupby("team", observed=True):
        latest = rows.sort_values(["season", "week", "game_id"]).iloc[-1]
        team_updates[str(team)] = clean(latest, own_names)
    for opponent, rows in training.groupby("opponent", observed=True):
        latest = rows.sort_values(["season", "week", "game_id"]).iloc[-1]
        opponent_updates[str(opponent)] = clean(latest, allowed_names)

    payload = {
        "release": RELEASE,
        "trainingThrough": 2025,
        "marketIndependent": True,
        "marketFeatures": [],
        "sourceChecksums": {
            "externalManifest": foundation.sha256_file(external_manifest),
            "externalFeatures": manifest["featureFileSha256"],
            "passingAttemptsProbability": hashlib.sha256(json.dumps(
                passing_attempts_probability, sort_keys=True, separators=(",", ":"),
            ).encode("utf-8")).hexdigest(),
            "precedingExpectedRoleArtifact": PRECEDING_SHA256,
            "receptionsTournament": foundation.sha256_file(args.receptions_tournament),
            "receptionsDistributionTournament": foundation.sha256_file(args.receptions_distribution),
        },
        "featureNames": state_features,
        "passingAttempts": {
            "blendWeight": 1.0,
            "budgetModel": passing_budget_portable,
            "shareModel": passer_share_portable,
            "shareLower": 0.50,
            "shareUpper": 1.0,
            "probability": passing_attempts_probability,
        },
        "passingCompletions": {
            "blendWeight": 0.75,
            "shareModel": completion_share_portable,
            "shareLower": 0.50,
            "shareUpper": 1.0,
            "completionRateModel": completion_rate_portable,
            "completionRateLower": 0.30,
            "completionRateUpper": 0.85,
            "probability": completion_probability,
        },
        "passingYards": {
            "blendWeight": 1.0,
            "yardsPerAttemptModel": yards_per_attempt_portable,
            "yardsPerCompletionModel": yards_per_completion_portable,
            "yardsPerAttemptLower": 2.0,
            "yardsPerAttemptUpper": 14.0,
            "yardsPerCompletionLower": 4.0,
            "yardsPerCompletionUpper": 24.0,
            "componentWeights": {"attempt": 0.0, "completion": 1.0},
            "probability": passing_yards_probability,
        },
        "rushingYards": {
            "blendWeight": 0.75,
            "shareLower": 0.0,
            "shareUpper": 1.0,
            "yardsPerCarryLower": 0.0,
            "yardsPerCarryUpper": 15.0,
            "groups": rushing_yards_models,
            "probability": rushing_yards_probability,
        },
        "receptions": {
            "blendWeight": 0.50,
            "shareLower": 0.0,
            "shareUpper": 1.0,
            "catchRateLower": 0.0,
            "catchRateUpper": 1.0,
            "teamBudgetModel": team_target_budget_portable,
            "teamShareModel": team_target_share_portable,
            "teamParticipationModel": team_target_participation_portable,
            "groups": receptions_models,
            "probability": receptions_probability,
        },
        "playerStateUpdates": player_updates,
        "teamStateUpdates": team_updates,
        "opponentStateUpdates": opponent_updates,
        "injurySources": injury_metadata,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")

    runtime["runtimeRelease"] = PORTABLE_RELEASE
    runtime["modelRelease"] = MODEL_RELEASE
    runtime["calibrationRelease"] = CALIBRATION_RELEASE
    runtime["decisionRelease"] = DECISION_RELEASE
    runtime["decision"]["decisionRelease"] = DECISION_RELEASE
    runtime["decision"]["modelRelease"] = MODEL_RELEASE
    runtime["decision"]["calibrationRelease"] = CALIBRATION_RELEASE
    runtime["sourceChecksums"]["expectedRoleArtifact"] = foundation.sha256_file(args.output)
    RUNTIME.write_text(json.dumps(runtime, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    for market in ("PassingAttempts", "PassingCompletions", "PassingYards"):
        path = RUNTIME.with_name(f"nflPlayerPropsRuntimeMarket{market}.json")
        values = json.loads(path.read_text(encoding="utf-8"))
        values["marketResidualWeight"] = 1.0 if market in {"PassingCompletions", "PassingYards"} else 0.0
        values["marketResidualQualified"] = market in {"PassingCompletions", "PassingYards"}
        path.write_text(json.dumps(values, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "release": RELEASE, "bytes": args.output.stat().st_size,
        "features": len(state_features), "players": len(player_updates),
    }, indent=2))


if __name__ == "__main__":
    main()
