#!/usr/bin/env python3
"""Fit and export the validated joint NFL player-props runtime components."""

from __future__ import annotations

import argparse
import importlib.util
import json
import pathlib
import sys
from typing import Any

import numpy as np
import pandas as pd


BASELINE_PATH = pathlib.Path("scripts/operator/tournament_nfl_player_props_baseline.py")
JOINT_PATH = pathlib.Path("scripts/operator/tournament_nfl_player_props_joint_model.py")
EXPORTER_PATH = pathlib.Path("scripts/operator/export_nfl_player_props_runtime_artifact.py")
DEFAULT_MANIFEST = pathlib.Path(
    "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
)
DEFAULT_REPORT = pathlib.Path(
    "football-research/cache/nfl-player-props-joint/nfl_player_props_joint_model_r3.json"
)
DEFAULT_OUTPUT = pathlib.Path("lib/services/football/modelArtifacts/nflPlayerPropsRuntimeJoint.json")


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--report", type=pathlib.Path, default=DEFAULT_REPORT)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    baseline = load_module("nfl_props_joint_export_baseline", BASELINE_PATH)
    joint = load_module("nfl_props_joint_export_model", JOINT_PATH)
    exporter = load_module("nfl_props_joint_export_portable", EXPORTER_PATH)
    contract = json.loads(baseline.CONTRACT_PATH.read_text(encoding="utf-8"))
    report = json.loads(args.report.read_text(encoding="utf-8"))
    frame, manifest = baseline.load_verified_dataset(args.manifest, contract)
    frame, features = baseline.prepare_features(frame, manifest)
    eligible = baseline.market_eligible(frame, contract["markets"]["passing_attempts"])
    qb = frame[eligible].copy()
    usable = qb[qb["passing_attempts"].gt(0)].copy()
    league_completion_rate = float(usable["passing_completions"].sum() / usable["passing_attempts"].sum())
    completion_probability = (
        usable["passing_completions"].to_numpy(float) + league_completion_rate
    ) / (usable["passing_attempts"].to_numpy(float) + 1.0)
    completion_logit = np.log(
        np.clip(completion_probability, 1e-5, 1 - 1e-5)
        / np.clip(1 - completion_probability, 1e-5, 1)
    )
    completion_rate_model = joint.hgb().fit(
        usable[features],
        completion_logit,
        sample_weight=np.maximum(usable["passing_attempts"].to_numpy(float), 1.0),
    )
    yards_per_attempt = np.clip(
        usable["passing_yards"].to_numpy(float) / usable["passing_attempts"].to_numpy(float),
        0.0,
        None,
    )
    ypa_model = joint.hgb().fit(
        usable[features],
        np.log1p(yards_per_attempt),
        sample_weight=np.sqrt(np.maximum(usable["passing_attempts"].to_numpy(float), 1.0)),
    )
    league_yards_per_attempt = float(usable["passing_yards"].sum() / usable["passing_attempts"].sum())
    passing_report = report["families"]["qb"]["markets"]
    output = {
        "release": "nfl_player_props_joint_runtime_2026_09_28_r1_qb_latent_workload",
        "sourceHistorySha256": manifest["featureFileSha256"],
        "trainingThrough": 2025,
        "featureNames": features,
        "leaguePriors": {
            "completionRate": league_completion_rate,
            "yardsPerAttempt": league_yards_per_attempt,
            "completionRateParticipationStrength": 4.0,
            "yardsPerAttemptParticipationStrength": 8.0,
        },
        "passingCompletions": {
            "jointWeight": float(passing_report["passing_completions"]["confirmedJointWeight"]),
            "directWeight": 1.0 - float(passing_report["passing_completions"]["confirmedJointWeight"]),
            "completionRateModel": exporter.export_model(completion_rate_model, features),
        },
        "passingYards": {
            "jointWeight": float(passing_report["passing_yards"]["confirmedJointWeight"]),
            "directWeight": 1.0 - float(passing_report["passing_yards"]["confirmedJointWeight"]),
            "yardsPerAttemptModel": exporter.export_model(ypa_model, features),
        },
        "coherence": {
            "completionRule": "opportunity_times_conditional_rate_blended_with_direct_then_clipped_to_attempts",
            "marketMarriage": "target_book_excluded_cross_market_latent_workload",
        },
        "holdout": {
            "passingCompletions": passing_report["passing_completions"]["holdout"],
            "passingYards": passing_report["passing_yards"]["holdout"],
            "completionGreaterThanAttemptsRows": report["families"]["qb"]["holdoutCoherence"]["completionGreaterThanAttemptsRows"],
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({
        "output": str(args.output),
        "bytes": args.output.stat().st_size,
        "release": output["release"],
        "leaguePriors": output["leaguePriors"],
        "passingYardsWeights": {
            "joint": output["passingYards"]["jointWeight"],
            "direct": output["passingYards"]["directWeight"],
        },
        "passingCompletionsWeights": {
            "joint": output["passingCompletions"]["jointWeight"],
            "direct": output["passingCompletions"]["directWeight"],
        },
    }, indent=2))


if __name__ == "__main__":
    main()
