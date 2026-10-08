#!/usr/bin/env python3
"""Export the frozen independent Passing Attempts, Completions, and Yards release.

The research tournament also qualified a Receptions challenger, but its current
board implementation failed the anti-flattening gate. This exporter ships only
approved heads into the existing TypeScript batch scorer; it does not create a
second writer.
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
DEFAULT_DISTRIBUTION = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_independent_distribution_release_r1.json"
DEFAULT_COMPLETIONS_DISTRIBUTION = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_completions_distribution_r1.json"
DEFAULT_PASSING_YARDS_DISTRIBUTION = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_passing_yards_distribution_r1.json"
DEFAULT_RUSHING_YARDS_DISTRIBUTION = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_distribution_r1.json"
RUNTIME = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntime.json"
RELEASE = "nfl_player_props_expected_role_runtime_2026_10_08_r4_rushing_yards"
PORTABLE_RELEASE = "nfl_player_props_runtime_2026_10_08_r12_independent_rushing_yards"
MODEL_RELEASE = "nfl_player_props_distribution_model_2026_10_08_r21_independent_rushing_yards"
CALIBRATION_RELEASE = "nfl_player_props_distribution_calibration_2026_10_08_r23_independent_rushing_yards"
DECISION_RELEASE = "nfl_player_props_decision_2026_10_08_r26_independent_rushing_yards"


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
        }
    }
    player_states = {
        name: state for name, state in payload.pop("playerStateUpdates").items()
        if any(index in active_state_indexes and value > 0 for index, value in state)
    }
    payload.pop("receptions", None)
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
    parser.add_argument("--distribution", type=pathlib.Path, default=DEFAULT_DISTRIBUTION)
    parser.add_argument("--completions-distribution", type=pathlib.Path, default=DEFAULT_COMPLETIONS_DISTRIBUTION)
    parser.add_argument("--passing-yards-distribution", type=pathlib.Path, default=DEFAULT_PASSING_YARDS_DISTRIBUTION)
    parser.add_argument("--rushing-yards-distribution", type=pathlib.Path, default=DEFAULT_RUSHING_YARDS_DISTRIBUTION)
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

    existing_expected_role = json.loads(args.output.read_text(encoding="utf-8"))
    passing_attempts_probability = existing_expected_role["passingAttempts"]["probability"]
    if not passing_attempts_probability["passes"]:
        raise RuntimeError("selected Passing Attempts distribution is not release qualified")
    completions_distribution = json.loads(args.completions_distribution.read_text(encoding="utf-8"))
    completion_artifact = completions_distribution["artifact"]
    if not completion_artifact["passes"]:
        raise RuntimeError("selected Passing Completions distribution is not release qualified")
    completion_probability = {
        "foundationDistribution": completion_artifact["referenceDistribution"],
        "challengerDistribution": completion_artifact["challengerDistribution"],
        "challengerWeight": completion_artifact["challengerWeight"],
        "probabilityCalibration": completion_artifact["probabilityCalibration"],
        "passes": True,
    }
    passing_yards_distribution = json.loads(args.passing_yards_distribution.read_text(encoding="utf-8"))
    passing_yards_artifact = passing_yards_distribution["artifact"]
    probability_challenger_qualified = bool(passing_yards_artifact["passes"])
    if not probability_challenger_qualified and passing_yards_distribution.get("selected") is not None:
        raise RuntimeError("rejected Passing Yards distribution cannot be exported as an incumbent fallback")
    passing_yards_probability = {
        "foundationDistribution": passing_yards_artifact["referenceDistribution"],
        "challengerDistribution": passing_yards_artifact["challengerDistribution"]
        if probability_challenger_qualified else passing_yards_artifact["referenceDistribution"],
        "challengerWeight": passing_yards_artifact["challengerWeight"]
        if probability_challenger_qualified else 0.0,
        "probabilityCalibration": passing_yards_artifact["probabilityCalibration"]
        if probability_challenger_qualified else None,
        "passes": True,
        "challengerQualified": probability_challenger_qualified,
        "incumbentRetained": not probability_challenger_qualified,
    }
    rushing_yards_distribution = json.loads(args.rushing_yards_distribution.read_text(encoding="utf-8"))
    rushing_yards_artifact = rushing_yards_distribution["artifact"]
    rushing_probability_challenger_qualified = bool(rushing_yards_artifact["passes"])
    if not rushing_probability_challenger_qualified and rushing_yards_distribution.get("selected") is not None:
        raise RuntimeError("rejected Rushing Yards distribution cannot be exported as an incumbent fallback")
    rushing_yards_probability = {
        "foundationDistribution": rushing_yards_artifact["referenceDistribution"],
        "challengerDistribution": rushing_yards_artifact["challengerDistribution"]
        if rushing_probability_challenger_qualified else rushing_yards_artifact["referenceDistribution"],
        "challengerWeight": rushing_yards_artifact["challengerWeight"]
        if rushing_probability_challenger_qualified else 0.0,
        "probabilityCalibration": rushing_yards_artifact["probabilityCalibration"]
        if rushing_probability_challenger_qualified else None,
        "passes": True,
        "challengerQualified": rushing_probability_challenger_qualified,
        "incumbentRetained": not rushing_probability_challenger_qualified,
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
    ]
    state_features = list(dict.fromkeys(
        feature for value in all_models for feature in model_features(value)
    ))
    runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
    player_updates: dict[str, dict[str, float | None]] = {}
    used_player_features = [
        name for name in state_features if name in set(player_features) | set(completion_features) | set(yardage_features)
    ]
    role_population = training[training["position"].isin(["QB", "RB", "FB", "WR"])]
    for player_name, rows in role_population.groupby(
        role_population["player_name"].map(foundation.normalize_player), observed=True,
    ):
        if not player_name:
            continue
        latest = rows.sort_values(["season", "week", "game_id"]).iloc[-1]
        player_updates[str(player_name)] = clean(latest, used_player_features)
    team_updates: dict[str, dict[str, float | None]] = {}
    opponent_updates: dict[str, dict[str, float | None]] = {}
    own_names = [name for name in state_features if name in team_features and (name == "is_home" or "_team_" in name or name.startswith("external_environment_"))]
    allowed_names = [name for name in state_features if name in team_features and "_opponent_" in name]
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
            "passingCompletionsTournament": foundation.sha256_file(args.completions_distribution),
            "passingYardsTournament": foundation.sha256_file(args.passing_yards_distribution),
            "rushingYardsTournament": foundation.sha256_file(args.rushing_yards_distribution),
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
