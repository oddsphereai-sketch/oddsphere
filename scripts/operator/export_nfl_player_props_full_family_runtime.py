#!/usr/bin/env python3
"""Export the validated NFL props full-family artifact to production JSON."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
from typing import Any

import joblib
import numpy as np
import pandas as pd


ROOT = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = pathlib.Path(
    "/private/tmp/oddsphere-nfl-player-props-joint-qb-r3/football-research/cache/"
    "nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
)
DEFAULT_TRAINING = pathlib.Path(
    "football-research/cache/nfl-player-props-full-family/nfl_player_props_full_family_r1.joblib"
)
DEFAULT_OUTPUT = pathlib.Path("lib/services/football/modelArtifacts/nflPlayerPropsRuntime.json")
DEFAULT_JOINT_OUTPUT = pathlib.Path("lib/services/football/modelArtifacts/nflPlayerPropsRuntimeJoint.json")
RETAINED_QB_MARKETS = {"passing_attempts", "passing_completions"}


def module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def ewm(values: pd.Series) -> float | None:
    clean = pd.to_numeric(values, errors="coerce").dropna()
    return float(clean.ewm(alpha=0.35, adjust=False).mean().iloc[-1]) if len(clean) else None


def matchup_states(rows: pd.DataFrame) -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    identities = {"season", "week", "game_id", "team", "opponent"}
    metrics = [column for column in rows.columns if column not in identities]
    teams = sorted(set(rows["team"]).union(rows["opponent"]))
    own_states: dict[str, dict[str, float]] = {}
    allowed_states: dict[str, dict[str, float]] = {}
    for team in teams:
        own = rows[rows["team"].eq(team)].sort_values(["season", "week", "game_id"])
        allowed = rows[rows["opponent"].eq(team)].sort_values(["season", "week", "game_id"])
        own_state: dict[str, float] = {}
        allowed_state: dict[str, float] = {}
        for metric in metrics:
            own_values = pd.to_numeric(own[metric], errors="coerce").dropna()
            allowed_values = pd.to_numeric(allowed[metric], errors="coerce").dropna()
            for window in (3, 5):
                if len(own_values):
                    own_state[f"matchup_team_{metric}_avg{window}"] = float(own_values.tail(window).mean())
                if len(allowed_values):
                    allowed_state[f"matchup_opponent_allowed_{metric}_avg{window}"] = float(allowed_values.tail(window).mean())
            own_ewm = ewm(own_values)
            allowed_ewm = ewm(allowed_values)
            if own_ewm is not None:
                own_state[f"matchup_team_{metric}_ewm"] = own_ewm
            if allowed_ewm is not None:
                allowed_state[f"matchup_opponent_allowed_{metric}_ewm"] = allowed_ewm
        own_states[str(team)] = own_state
        allowed_states[str(team)] = allowed_state
    return own_states, allowed_states


def predict_components(components: list[dict[str, Any]], inputs: dict[str, Any]) -> float:
    total = 0.0
    for component in components:
        features = list(component["features"])
        row = pd.DataFrame([{name: inputs.get(name, np.nan) for name in features}])
        total += float(component["weight"]) * max(0.0, float(component["model"].predict(row)[0]))
    return total


def predict_model(model: Any, features: list[str], inputs: dict[str, Any], transform: str) -> float:
    row = pd.DataFrame([{name: inputs.get(name, np.nan) for name in features}])
    raw = float(model.predict(row)[0])
    if transform == "logistic":
        return 1 / (1 + np.exp(-np.clip(raw, -20, 20)))
    if transform == "expm1":
        return max(0.0, float(np.expm1(raw)))
    return raw


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--training", type=pathlib.Path, default=DEFAULT_TRAINING)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--joint-output", type=pathlib.Path, default=DEFAULT_JOINT_OUTPUT)
    args = parser.parse_args()

    baseline = module("props_full_export_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = module("props_full_export_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    exporter = module("props_full_export_portable", ROOT / "scripts/operator/export_nfl_player_props_runtime_artifact.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, contract)
    training = joblib.load(args.training)
    if training["sourceHistorySha256"] != manifest["featureFileSha256"]:
        raise RuntimeError("NFL props full-family training/history checksum mismatch")
    existing = exporter.read_existing_runtime()
    existing_joint = json.loads((ROOT / args.joint_output).read_text(encoding="utf-8"))
    team_rows = matchup.team_game_metrics(manifest)
    own_states, allowed_states = matchup_states(team_rows)
    team_states = {
        team: {**existing.get("teamStates", {}).get(team, {}), **state}
        for team, state in own_states.items()
    }
    opponent_states = {
        team: {**existing.get("opponentStates", {}).get(team, {}), **state}
        for team, state in allowed_states.items()
    }

    markets: dict[str, Any] = {}
    for market, value in training["markets"].items():
        current = existing["markets"][market]
        if market in RETAINED_QB_MARKETS:
            markets[market] = current
            continue
        components = value["components"]
        portable = (
            exporter.export_model(components[0]["model"], list(components[0]["features"]))
            if len(components) == 1 and float(components[0]["weight"]) == 1.0
            else exporter.export_weighted_components(components)
        )
        markets[market] = {
            **current,
            "model": portable,
            "distribution": exporter.portable_distribution(value["distribution"]),
        }

    parity: list[dict[str, Any]] = []
    for prior in existing["parity"][:4]:
        inputs = dict(prior["inputs"])
        projections = dict(prior["projections"])
        for market in training["markets"]:
            if market not in RETAINED_QB_MARKETS:
                projections[market] = predict_components(training["markets"][market]["components"], inputs)
        if inputs.get("position_qb") == 1:
            attempts = projections["passing_attempts"]
            joint = training["qbJoint"]
            yards_per_attempt = predict_model(
                joint["yardsPerAttemptModel"], training["enhancedFeatures"], inputs, "expm1"
            )
            projections["passing_yards"] = max(0.0,
                float(joint["jointWeight"]) * attempts * yards_per_attempt
                + float(joint["directWeight"]) * projections["passing_yards"])
        parity.append({
            "inputs": inputs,
            "participationProbability": prior["participationProbability"],
            "projections": projections,
            "touchdownProbability": prior["touchdownProbability"],
        })

    output = {
        **existing,
        "runtimeRelease": "nfl_player_props_runtime_2026_09_29_r6_full_family_matchup",
        "modelRelease": "nfl_player_props_distribution_model_2026_09_29_r14_full_family_matchup",
        "calibrationRelease": "nfl_player_props_distribution_calibration_2026_09_29_r15_full_family_matchup",
        "decisionRelease": "nfl_player_props_decision_2026_09_29_r18_full_family_matchup",
        "sourceChecksums": {
            **existing["sourceChecksums"],
            "fullFamilyArtifact": exporter.sha256_file(args.training),
            "sourceHistory": manifest["featureFileSha256"],
        },
        "featureNames": training["enhancedFeatures"],
        "markets": markets,
        "teamStates": team_states,
        "opponentStates": opponent_states,
        "parity": parity,
        "trainingThrough": 2025,
    }
    total_bytes = exporter.write_runtime_shards(args.output, output)

    joint = training["qbJoint"]
    joint_output = {
        **existing_joint,
        "release": "nfl_player_props_joint_runtime_2026_09_29_r2_full_family_matchup",
        "featureNames": training["enhancedFeatures"],
        "passingYards": {
            "jointWeight": float(joint["jointWeight"]),
            "directWeight": float(joint["directWeight"]),
            "yardsPerAttemptModel": exporter.export_model(
                joint["yardsPerAttemptModel"], training["enhancedFeatures"]
            ),
        },
        "coherence": {
            **existing_joint["coherence"],
            "passingYardsRule": "opportunity_times_matchup_conditional_efficiency_blended_with_direct",
        },
        "holdout": {
            **existing_joint["holdout"],
            "passingYards": {
                "precedingChampion": existing_joint["holdout"]["passingYards"]["candidate"],
                "candidate": training["reports"]["passing_yards"]["holdout"],
            },
        },
    }
    args.joint_output.write_text(json.dumps(joint_output, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output), "runtimeBytes": total_bytes,
        "runtimeMiB": total_bytes / (1024 * 1024),
        "jointOutput": str(args.joint_output), "jointBytes": args.joint_output.stat().st_size,
        "markets": sorted(markets), "teams": len(team_states),
    }, indent=2))


if __name__ == "__main__":
    main()
