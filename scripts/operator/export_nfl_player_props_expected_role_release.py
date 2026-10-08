#!/usr/bin/env python3
"""Export the frozen Passing Attempts expected-role production release.

The research tournament also qualified a Receptions challenger, but its current
board implementation failed the anti-flattening gate. This exporter therefore
ships only the approved Passing Attempts head into the existing TypeScript batch
scorer; it does not create a second writer.
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
RUNTIME = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntime.json"
RELEASE = "nfl_player_props_expected_role_runtime_2026_10_08_r1_passing_attempts"
PORTABLE_RELEASE = "nfl_player_props_runtime_2026_10_08_r9_independent_passing_attempts"
MODEL_RELEASE = "nfl_player_props_distribution_model_2026_10_08_r18_independent_passing_attempts"
CALIBRATION_RELEASE = "nfl_player_props_distribution_calibration_2026_10_08_r20_independent_passing_attempts"
DECISION_RELEASE = "nfl_player_props_decision_2026_10_08_r23_independent_passing_attempts"


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
    passing_state_indexes = {
        index for index, name in enumerate(payload["playerStateFeatureNames"])
        if name in {
            "prior_passing_attempts_lag1", "prior_passing_attempts_avg3",
            "prior_passing_attempts_season_avg",
        }
    }
    player_states = {
        name: state for name, state in payload.pop("playerStateUpdates").items()
        if any(index in passing_state_indexes and value > 0 for index, value in state)
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
    parser.add_argument("--optimize-existing", action="store_true")
    args = parser.parse_args()

    if args.optimize_existing:
        optimize_existing(args.output)
        return

    foundation = load("expected_role_export_foundation", ROOT / "scripts/operator/tournament_nfl_player_props_expected_role_system.py")
    availability = load("expected_role_export_availability", ROOT / "scripts/operator/tournament_nfl_player_props_availability_role.py")
    external = load("expected_role_export_external", ROOT / "scripts/operator/tournament_nfl_player_props_external_features.py")
    exporter = load("expected_role_export_portable", ROOT / "scripts/operator/export_nfl_player_props_runtime_artifact.py")

    manifest = json.loads(foundation.DEFAULT_EXTERNAL_MANIFEST.read_text(encoding="utf-8"))
    feature_path = pathlib.Path(manifest["featureFile"])
    if foundation.sha256_file(feature_path) != manifest["featureFileSha256"] or manifest.get("marketFeatures") != []:
        raise RuntimeError("expected-role feature safety contract mismatch")
    frame, injury_metadata, availability_groups = availability.injury_features(
        pd.read_parquet(feature_path), foundation.DEFAULT_INJURY_ROOT,
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
    team_features = [
        name for name in [*groups["base"], *groups["state"]]
        if name == "is_home" or name.startswith((
            "prior_team_", "prior_opponent_", "external_state_team_",
            "external_state_opponent_", "external_environment_",
        ))
    ]
    frame[[*dict.fromkeys([*player_features, *team_features])]] = frame[
        [*dict.fromkeys([*player_features, *team_features])]
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

    distribution = json.loads(args.distribution.read_text(encoding="utf-8"))
    selected = distribution["selectedArtifacts"]
    if not selected["passing_attempts"]["passes"]:
        raise RuntimeError("selected Passing Attempts distribution is not release qualified")

    passing_budget_portable = compact_model(exporter, team_budget, team_features)
    passer_share_portable = compact_model(exporter, passer_share, player_features)
    all_models = [passing_budget_portable, passer_share_portable]
    state_features = list(dict.fromkeys(
        feature for value in all_models for feature in model_features(value)
    ))
    runtime = json.loads(RUNTIME.read_text(encoding="utf-8"))
    player_updates: dict[str, dict[str, float | None]] = {}
    used_player_features = [name for name in state_features if name in player_features]
    passing_population = training[training["position"].eq("QB")]
    for player_name, rows in passing_population.groupby(
        passing_population["player_name"].map(foundation.normalize_player), observed=True,
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
            "externalManifest": foundation.sha256_file(foundation.DEFAULT_EXTERNAL_MANIFEST),
            "externalFeatures": manifest["featureFileSha256"],
            "distributionTournament": foundation.sha256_file(args.distribution),
        },
        "featureNames": state_features,
        "passingAttempts": {
            "blendWeight": 1.0,
            "budgetModel": passing_budget_portable,
            "shareModel": passer_share_portable,
            "shareLower": 0.50,
            "shareUpper": 1.0,
            "probability": selected["passing_attempts"],
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
    for market in ("PassingAttempts",):
        path = RUNTIME.with_name(f"nflPlayerPropsRuntimeMarket{market}.json")
        values = json.loads(path.read_text(encoding="utf-8"))
        values["marketResidualWeight"] = 0.0
        values["marketResidualQualified"] = False
        path.write_text(json.dumps(values, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "release": RELEASE, "bytes": args.output.stat().st_size,
        "features": len(state_features), "players": len(player_updates),
    }, indent=2))


if __name__ == "__main__":
    main()
