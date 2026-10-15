#!/usr/bin/env python3
"""Promote the frozen RB Rushing Yards head into the portable runtime artifact.

This is deliberately a narrow successor-artifact builder: every non-Rushing-
Yards model and every stored player/team/opponent state from r6 is preserved.
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


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXPECTED_ROLE = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsExpectedRole.json"
RUNTIME = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntime.json"
PROBABILITY = ROOT / "football-research/cache/nfl-player-props-external/tournament/nfl_player_props_rushing_yards_rb_nonqb_residual_r1.json"
PRECEDING_RELEASE = "nfl_player_props_expected_role_runtime_2026_10_09_r6_receiving_yards"
PRECEDING_SHA256 = "e7cc0ccadd722890b57aaa3a77713c4cdcec49aa1149ebdff951d8794c50479d"
RELEASE = "nfl_player_props_expected_role_runtime_2026_10_15_r7_independent_rushing_yards"
PORTABLE_RELEASE = "nfl_player_props_runtime_2026_10_15_r15_independent_rushing_yards"
MODEL_RELEASE = "nfl_player_props_distribution_model_2026_10_15_r26_independent_rushing_yards"
CALIBRATION_RELEASE = "nfl_player_props_distribution_calibration_2026_10_15_r28_independent_rushing_yards"
DECISION_RELEASE = "nfl_player_props_decision_2026_10_15_r32_independent_rushing_yards"


def load(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=pathlib.Path, default=EXPECTED_ROLE)
    parser.add_argument("--runtime", type=pathlib.Path, default=RUNTIME)
    parser.add_argument("--probability", type=pathlib.Path, default=PROBABILITY)
    args = parser.parse_args()

    factorization = load(
        "rushing_yards_release_factorization",
        ROOT / "scripts/operator/tournament_nfl_player_props_rushing_yards_team_factorization.py",
    )
    portable = load(
        "rushing_yards_release_portable",
        ROOT / "scripts/operator/export_nfl_player_props_runtime_artifact.py",
    )
    release_export = load(
        "rushing_yards_release_compactor",
        ROOT / "scripts/operator/export_nfl_player_props_expected_role_release.py",
    )

    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    artifact_release = artifact.get("release")
    if artifact_release not in {PRECEDING_RELEASE, RELEASE}:
        raise RuntimeError("expected the frozen predecessor or this exact successor release")
    if artifact_release == PRECEDING_RELEASE and sha256(args.artifact) != PRECEDING_SHA256:
        raise RuntimeError("frozen preceding expected-role artifact mismatch")
    if artifact_release == RELEASE and artifact.get("sourceChecksums", {}).get(
        "precedingExpectedRoleArtifact",
    ) != PRECEDING_SHA256:
        raise RuntimeError("successor artifact does not retain the frozen predecessor checksum")
    if "playerStateUpdates" in artifact or artifact.get("playerStateShards") != 16:
        raise RuntimeError("expected optimized predecessor with immutable player-state shards")

    frame, player_features, team_features, _ = factorization.prepare_frame(
        factorization.MANIFEST, factorization.INJURY_ROOT,
    )
    training = frame[frame["season"].lt(2026)].copy()
    teams = factorization.team_table(training, team_features)
    positions = training["position"].isin(factorization.POSITIONS)
    population = training[positions].copy()
    active = population[population["participated"].eq(1)].copy()

    team_model = factorization.regression("poisson").fit(
        teams[team_features], teams["team_rush_attempts"].to_numpy(float),
    )
    share_model = factorization.regression("squared_error").fit(
        active[player_features], active["team_rush_share"].fillna(0.0).to_numpy(float),
    )
    participation_model = factorization.HistGradientBoostingClassifier(
        max_iter=140, max_leaf_nodes=15, learning_rate=0.04,
        min_samples_leaf=35, l2_regularization=12.0, random_state=factorization.SEED,
    ).fit(population[player_features], population["participated"].to_numpy(int))
    efficiency = active[active["rushing_attempts"].gt(0)].copy()
    yards_per_carry = (efficiency["rushing_yards"] / efficiency["rushing_attempts"]).clip(0.0, 15.0)
    yards_per_carry_model = factorization.regression("squared_error").fit(
        efficiency[player_features], yards_per_carry.to_numpy(float),
        sample_weight=efficiency["rushing_attempts"].to_numpy(float),
    )
    candidate = {
        "budgetModel": release_export.compact_model(portable, team_model, team_features),
        "shareModel": release_export.compact_model(portable, share_model, player_features),
        "participationModel": release_export.compact_model(
            portable, participation_model, player_features, classifier=True,
        ),
        "yardsPerCarryModel": release_export.compact_model(
            portable, yards_per_carry_model, player_features,
        ),
    }
    candidate_features = {
        name for model in candidate.values() for name in model.get("featureNames", [])
    }
    dynamic_features = {
        "is_home", "position_qb", "position_rb", "position_fb", "position_wr", "position_te",
        "team_implied_touchdowns", "matchup_week", "matchup_temperature_f", "matchup_wind_mph",
        "matchup_roof_fixed", "matchup_roof_outdoor", "external_environment_temperature_f",
        "external_environment_wind_mph", "external_environment_fixed_roof",
        "external_environment_outdoor", "external_depth_listed", "external_depth_slot_rank",
        "external_depth_overall_rank", "external_depth_starter",
        "external_depth_snapshot_age_hours", "availability_evidence",
        "availability_severity_combined",
    }
    missing_features = sorted(candidate_features - set(artifact["featureNames"]) - dynamic_features)
    if missing_features:
        raise RuntimeError(f"candidate requires unstored runtime state: {missing_features}")

    report = json.loads(args.probability.read_text(encoding="utf-8"))
    if not report["confirmation2025"]["passes"] or not report["currentSeason"]["passes"]:
        raise RuntimeError("RB residual probability candidate is not release qualified")
    residuals = report["currentSeason"]["residualQuantiles"]
    if len(residuals) != 1001:
        raise RuntimeError("RB residual probability candidate must contain 1,001 quantiles")
    preceding_probability = artifact["rushingYards"]["probability"]
    artifact["release"] = RELEASE
    artifact["rushingYards"]["teamWide"] = candidate
    artifact["rushingYards"]["challengerPositions"] = ["RB"]
    artifact["rushingYards"]["probability"] = {
        "foundationDistribution": preceding_probability["foundationDistribution"],
        "challengerDistribution": {
            "family": "conditional_empirical_residual",
            "roleConditioned": False,
            "meanBins": 1,
            "fallbackResidualQuantiles": residuals,
            "groups": [],
        },
        "challengerWeight": 1.0,
        "challengerPositions": ["RB"],
        "probabilityCalibration": None,
        "passes": True,
        "challengerQualified": True,
        "incumbentRetained": True,
    }
    artifact["sourceChecksums"]["precedingExpectedRoleArtifact"] = PRECEDING_SHA256
    artifact["sourceChecksums"]["rushingYardsProbabilityTournament"] = sha256(args.probability)
    args.artifact.write_text(json.dumps(artifact, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")

    runtime = json.loads(args.runtime.read_text(encoding="utf-8"))
    runtime["runtimeRelease"] = PORTABLE_RELEASE
    runtime["modelRelease"] = MODEL_RELEASE
    runtime["calibrationRelease"] = CALIBRATION_RELEASE
    runtime["decisionRelease"] = DECISION_RELEASE
    runtime["decision"]["decisionRelease"] = DECISION_RELEASE
    runtime["decision"]["modelRelease"] = MODEL_RELEASE
    runtime["decision"]["calibrationRelease"] = CALIBRATION_RELEASE
    runtime["sourceChecksums"]["expectedRoleArtifact"] = sha256(args.artifact)
    args.runtime.write_text(json.dumps(runtime, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "artifact": str(args.artifact), "release": RELEASE,
        "candidateFeatures": len(candidate_features), "probabilityQuantiles": len(residuals),
        "artifactSha256": sha256(args.artifact),
    }, indent=2))


if __name__ == "__main__":
    main()
