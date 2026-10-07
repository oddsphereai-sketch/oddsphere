#!/usr/bin/env python3
"""Focused contract and distribution checks for NFL props recalibration r2."""

from __future__ import annotations

import importlib.util
import hashlib
import json
import pathlib
import sys

import numpy as np


path = pathlib.Path(__file__).parent / "operator" / "recalibrate_nfl_player_props_distributions.py"
spec = importlib.util.spec_from_file_location("nfl_props_recalibration", path)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

contract = json.loads(module.CONTRACT_PATH.read_text(encoding="utf-8"))
assert contract["chronology"] == {
    "projectionTrainingEnd": 2022,
    "calibrationFit": 2023,
    "calibrationSelection": 2024,
    "lockedEvaluation": 2025,
}
assert contract["actionable"] is False
assert contract["lineProbabilityReady"] is False
assert set(contract["projectionChampions"]) == {
    "passing_attempts", "passing_completions", "passing_yards", "rushing_attempts",
    "rushing_yards", "receptions", "receiving_yards",
}

residuals = np.linspace(-5.0, 5.0, 501)
means = np.linspace(10.0, 30.0, 501)
global_distribution = module.empirical_distribution(residuals, 101)
bucketed_distribution = module.bucketed_empirical_distribution(residuals, means, 101, 50)
quintile_distribution = module.bucketed_empirical_distribution(residuals, means, 101, 50, bucket_count=5)
assert global_distribution["family"] == "empirical_residual"
assert bucketed_distribution["family"] == "empirical_residual_mean_bucket"
assert len(bucketed_distribution["buckets"]) == 4
assert len(quintile_distribution["buckets"]) == 5
try:
    module.bucketed_empirical_distribution(residuals, means, 101, 50, bucket_count=1)
    raise AssertionError("invalid bucket count did not fail closed")
except ValueError:
    pass

y = means + residuals
metrics = module.empirical_metrics(y, means, global_distribution)
assert metrics["crps"] >= 0
assert 0 <= metrics["pitMean"] <= 1
assert 0 <= metrics["coverage_90"] <= 1

eligible = {"coverage_80": 0.80, "coverage_90": 0.90, "crps": 2.0}
ineligible = {"coverage_80": 0.65, "coverage_90": 0.70, "crps": 1.0}
assert module.selection_key(eligible, contract) < module.selection_key(ineligible, contract)

source = path.read_text(encoding="utf-8")
selection_block = source[source.index("selection_y ="):source.index("# Refit only the frozen calibration family")]
assert "2025" not in selection_block

artifact_root = pathlib.Path("lib/services/football/modelArtifacts")
manifest_path = artifact_root / "nflPlayerPropsDistributionConditioningManifest.json"
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
assert manifest["pointModelsByteIdentical"] is True
assert manifest["historicalFeatureSha256"] == "f80b1479ca27ddf91c256ff791bcd6dea1f435fd6248a95f1f63665b4c8cd8bd"
assert manifest["promotedMarkets"] == [
    "passing_attempts", "passing_yards", "receiving_yards", "rushing_attempts", "rushing_yards",
]
assert manifest["deferredMarkets"] == ["passing_completions", "receptions"]
for market, values in manifest["marketArtifacts"].items():
    assert values["pointModelByteIdentical"] is True, market
    promoted = market in manifest["promotedMarkets"]
    assert values["meanQuintilePromoted"] is promoted, market
    assert values["bucketCount"] == (5 if promoted else 4), market
    filename = {
        "passing_attempts": "nflPlayerPropsRuntimeMarketPassingAttempts.json",
        "passing_completions": "nflPlayerPropsRuntimeMarketPassingCompletions.json",
        "passing_yards": "nflPlayerPropsRuntimeMarketPassingYards.json",
        "rushing_attempts": "nflPlayerPropsRuntimeMarketRushingAttempts.json",
        "rushing_yards": "nflPlayerPropsRuntimeMarketRushingYards.json",
        "receptions": "nflPlayerPropsRuntimeMarketReceptions.json",
        "receiving_yards": "nflPlayerPropsRuntimeMarketReceivingYards.json",
    }[market]
    artifact_path = artifact_root / filename
    assert hashlib.sha256(artifact_path.read_bytes()).hexdigest() == values["candidateSha256"]
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert len(artifact["distribution"]["buckets"]) == (5 if promoted else 4)
    if not promoted:
        assert values["candidateSha256"] == values["precedingSha256"], market

print("NFL player-props recalibration: chronology, empirical distributions, and selection gate passed")
