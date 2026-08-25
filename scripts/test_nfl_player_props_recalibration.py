#!/usr/bin/env python3
"""Focused contract and distribution checks for NFL props recalibration r2."""

from __future__ import annotations

import importlib.util
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
assert global_distribution["family"] == "empirical_residual"
assert bucketed_distribution["family"] == "empirical_residual_mean_bucket"
assert len(bucketed_distribution["buckets"]) == 4

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

print("NFL player-props recalibration: chronology, empirical distributions, and selection gate passed")
