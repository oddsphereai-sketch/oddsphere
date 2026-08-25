#!/usr/bin/env python3
"""Focused chronology, eligibility, and distribution tests for NFL props baseline."""

from __future__ import annotations

import importlib.util
import pathlib
import sys

import numpy as np
import pandas as pd


path = pathlib.Path(__file__).parent / "operator" / "tournament_nfl_player_props_baseline.py"
spec = importlib.util.spec_from_file_location("nfl_props_baseline", path)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

frame = pd.DataFrame({
    "season": [2022, 2023, 2024, 2025], "position": ["QB"] * 4,
    "prior_participations": [3.0] * 4, "prior_passing_attempts_avg5": [20.0] * 4,
})
contract = {"splits": {"trainingEnd": 2022, "selection": 2023, "confirmation": 2024, "holdout": 2025}}
masks = module.split_masks(frame, contract)
assert masks["training"].tolist() == [True, False, False, False]
assert masks["holdout"].tolist() == [False, False, False, True]
eligible = module.market_eligible(frame, {"positions": ["QB"], "roleMetric": "passing_attempts", "minimumPriorAverage": 8.0})
assert eligible.all()

y = np.array([10, 15, 20, 25], dtype=float)
mu = np.array([11, 14, 19, 26], dtype=float)
normal = module.normal_distribution_metrics(y, mu, 3.0)
count = module.count_distribution_metrics(y, mu, "negative_binomial", 0.1)
assert normal["nll"] > 0 and normal["crps"] >= 0
assert count["nll"] > 0 and count["crps"] >= 0
assert 0 <= normal["coverage_80"] <= 1
assert 0 <= count["pitMean"] <= 1

clusters = pd.DataFrame({"game_id": ["a", "a", "b", "b"]})
delta = module.cluster_bootstrap_delta(clusters, np.array([1.0, 1.0, 2.0, 2.0]), np.array([2.0, 2.0, 2.0, 2.0]), iterations=50)
assert delta["gameClusters"] == 2
assert delta["meanMaeDelta"] <= 0

scorer_path = pathlib.Path(__file__).parents[1] / "lib" / "services" / "football" / "nfl_player_props_shadow_model.py"
scorer_spec = importlib.util.spec_from_file_location("nfl_props_scorer", scorer_path)
assert scorer_spec and scorer_spec.loader
scorer = importlib.util.module_from_spec(scorer_spec)
sys.modules[scorer_spec.name] = scorer
scorer_spec.loader.exec_module(scorer)
for distribution in (
    {"family": "poisson"},
    {"family": "negative_binomial", "alpha": 0.2},
    {"family": "normal_residual", "scale": 20.0},
    {"family": "empirical_residual", "residualQuantiles": [-2.0, -1.0, 0.0, 1.0, 2.0]},
    {
        "family": "empirical_residual_mean_bucket",
        "buckets": [{"lower": 0.0, "upper": 15.0, "distribution": {"residualQuantiles": [-2.0, 0.0, 2.0]}}],
        "fallback": {"residualQuantiles": [-3.0, 0.0, 3.0]},
    },
):
    probabilities = scorer.over_probability(np.array([10.0, 20.0]), np.array([9.5, 19.5]), distribution)
    assert np.all((probabilities >= 0) & (probabilities <= 1))

print("NFL player-props baseline: chronology, eligibility, distribution, cluster, and scorer checks passed")
