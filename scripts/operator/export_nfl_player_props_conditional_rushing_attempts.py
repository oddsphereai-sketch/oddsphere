#!/usr/bin/env python3
"""Export the research-only conditional-participation Rushing Attempts head."""

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
DEFAULT_MANIFEST = ROOT / "football-research/cache/nfl-player-props-history/nfl_player_props_2016_2025_r1.manifest.json"
DEFAULT_INPUT = ROOT / "lib/services/football/modelArtifacts/nflPlayerPropsRuntimeMarketRushingAttempts.json"
DEFAULT_OUTPUT = ROOT / "football-research/cache/nfl-player-props-projection-accuracy/nflPlayerPropsRuntimeMarketRushingAttemptsCandidate.json"
DEFAULT_REPORT = ROOT / "football-research/cache/nfl-player-props-projection-accuracy/nfl_player_props_conditional_rushing_attempts_export_r1.json"
MARKET = "rushing_attempts"
CONDITIONAL_WEIGHT = 0.75


def load_module(name: str, path: pathlib.Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if not spec or not spec.loader:
        raise RuntimeError(f"cannot load {path}")
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=pathlib.Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--input", type=pathlib.Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--report", type=pathlib.Path, default=DEFAULT_REPORT)
    args = parser.parse_args()
    baseline = load_module("props_ra_export_baseline", ROOT / "scripts/operator/tournament_nfl_player_props_baseline.py")
    matchup = load_module("props_ra_export_matchup", ROOT / "scripts/operator/tournament_nfl_player_props_matchup_features.py")
    trainer = load_module("props_ra_export_trainer", ROOT / "scripts/operator/train_nfl_player_props_full_family.py")
    recalibration = load_module("props_ra_export_recalibration", ROOT / "scripts/operator/recalibrate_nfl_player_props_distributions.py")
    portable = load_module("props_ra_export_portable", ROOT / "scripts/operator/export_nfl_player_props_runtime_artifact.py")
    contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsBaselineContract.json").read_text())
    calibration_contract = json.loads((ROOT / "lib/services/football/nflPlayerPropsCalibrationContract.json").read_text())
    frame, manifest = baseline.load_verified_dataset(args.manifest, contract)
    frame, base_features = baseline.prepare_features(frame, manifest)
    matchup_rows, matchup_names = matchup.add_shifted_team_features(matchup.team_game_metrics(manifest))
    environment, environment_names = matchup.game_environment(manifest)
    frame = frame.merge(matchup_rows, on=["season", "week", "game_id", "team"], how="left", validate="many_to_one")
    frame = frame.merge(environment, on=["season", "week", "game_id"], how="left", validate="many_to_one")
    enhanced_features = [*base_features, *matchup_names, *environment_names]
    eligible = baseline.market_eligible(frame, contract["markets"][MARKET])

    point_components: list[dict[str, Any]] = []
    for weight, conditional in ((1.0 - CONDITIONAL_WEIGHT, False), (CONDITIONAL_WEIGHT, True)):
        training = frame[eligible & (frame["participated"].eq(1) if conditional else True)]
        components, _ = trainer.fit_recipe(training, training.iloc[:1], MARKET, base_features, enhanced_features)
        if len(components) != 1:
            raise RuntimeError("Rushing Attempts recipe unexpectedly changed")
        point_components.append({**components[0], "weight": weight})

    calibration_actual: list[np.ndarray] = []
    calibration_prediction: list[np.ndarray] = []
    for season in (2023, 2024):
        test = frame[eligible & frame["participated"].eq(1) & frame["season"].eq(season)]
        unconditional_train = frame[eligible & frame["season"].lt(season)]
        conditional_train = frame[eligible & frame["participated"].eq(1) & frame["season"].lt(season)]
        _, unconditional = trainer.fit_recipe(unconditional_train, test, MARKET, base_features, enhanced_features)
        _, conditional = trainer.fit_recipe(conditional_train, test, MARKET, base_features, enhanced_features)
        calibration_actual.append(test[MARKET].to_numpy(float))
        calibration_prediction.append((1.0 - CONDITIONAL_WEIGHT) * unconditional + CONDITIONAL_WEIGHT * conditional)
    actual = np.concatenate(calibration_actual)
    prediction = np.concatenate(calibration_prediction)
    distribution = recalibration.bucketed_empirical_distribution(
        actual - prediction,
        prediction,
        int(calibration_contract["empiricalQuantileGridSize"]),
        int(calibration_contract["minimumBucketRows"]),
        bucket_count=5,
    )
    source = json.loads(args.input.read_text(encoding="utf-8"))
    candidate = {
        **source,
        "model": portable.export_weighted_components(point_components),
        "distribution": portable.portable_distribution(distribution),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(candidate, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    report = {
        "release": "nfl_player_props_conditional_rushing_attempts_export_2026_10_07_r1",
        "researchOnly": True,
        "historicalFeatureSha256": manifest["featureFileSha256"],
        "market": MARKET,
        "conditionalWeight": CONDITIONAL_WEIGHT,
        "incumbentWeight": 1.0 - CONDITIONAL_WEIGHT,
        "calibrationRows": int(len(actual)),
        "calibrationBuckets": len(distribution.get("buckets", [])),
        "inputSha256": sha256(args.input),
        "outputSha256": sha256(args.output),
        "output": str(args.output),
    }
    args.report.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
